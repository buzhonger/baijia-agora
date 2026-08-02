// 供应商抽象层：把不同 AI 的 API 统一成一个 streamChat 接口。
// 支持两种协议：anthropic（Claude）和 openai（DeepSeek/OpenAI/兼容端点）。
// 所有回复都以流式（token 逐步吐出）返回，方便界面实时显示。

// 统一的消息格式：{ role: 'user'|'assistant', content: string }
// 工具定义：{ name, description, input_schema }（JSON Schema）

// ---- Anthropic 协议 ----
async function* streamAnthropic({ provider, model, system, messages, tools, signal, maxTokens }) {
  const body = {
    model,
    max_tokens: maxTokens || 2048,
    stream: true,
    messages,
  };
  if (system) body.system = system;
  if (tools?.length) body.tools = tools;

  const res = await fetch(`${provider.baseURL}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 500)}`);
  }

  // 累积工具调用（Anthropic 用 content_block 分块）
  const toolBlocks = {}; // index -> { id, name, jsonParts: [] }

  for await (const evt of parseSSE(res.body, signal)) {
    if (!evt.data || evt.data === '[DONE]') continue;
    let json;
    try { json = JSON.parse(evt.data); } catch { continue; }

    if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
      toolBlocks[json.index] = { id: json.content_block.id, name: json.content_block.name, jsonParts: [] };
    } else if (json.type === 'content_block_delta') {
      if (json.delta?.type === 'text_delta') {
        yield { type: 'text', text: json.delta.text };
      } else if (json.delta?.type === 'input_json_delta' && toolBlocks[json.index]) {
        toolBlocks[json.index].jsonParts.push(json.delta.partial_json || '');
      }
    } else if (json.type === 'message_delta' && json.delta?.stop_reason === 'tool_use') {
      // 工具调用收尾时统一吐出
      for (const b of Object.values(toolBlocks)) {
        let input = {};
        try { input = JSON.parse(b.jsonParts.join('') || '{}'); } catch {}
        yield { type: 'tool_call', id: b.id, name: b.name, input };
      }
    }
  }
}

// ---- OpenAI 兼容协议（DeepSeek/OpenAI）----
async function* streamOpenAI({ provider, model, system, messages, tools, signal, maxTokens }) {
  const oaMessages = [];
  if (system) oaMessages.push({ role: 'system', content: system });
  for (const m of messages) oaMessages.push(m);

  const body = { model, stream: true, messages: oaMessages, max_tokens: maxTokens || 2048 };
  if (tools?.length) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
  }

  const res = await fetch(`${provider.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI-compat API ${res.status}: ${errText.slice(0, 500)}`);
  }

  const toolCalls = {}; // index -> { id, name, argParts: [] }

  for await (const evt of parseSSE(res.body, signal)) {
    if (!evt.data || evt.data === '[DONE]') continue;
    let json;
    try { json = JSON.parse(evt.data); } catch { continue; }
    const delta = json.choices?.[0]?.delta;
    if (!delta) continue;

    if (delta.content) yield { type: 'text', text: delta.content };

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCalls[idx]) toolCalls[idx] = { id: tc.id, name: '', argParts: [] };
        if (tc.id) toolCalls[idx].id = tc.id;
        if (tc.function?.name) toolCalls[idx].name = tc.function.name;
        if (tc.function?.arguments) toolCalls[idx].argParts.push(tc.function.arguments);
      }
    }

    const finish = json.choices?.[0]?.finish_reason;
    if (finish === 'tool_calls') {
      for (const c of Object.values(toolCalls)) {
        let input = {};
        try { input = JSON.parse(c.argParts.join('') || '{}'); } catch {}
        yield { type: 'tool_call', id: c.id, name: c.name, input };
      }
    }
  }
}

// ---- SSE 解析器：把字节流切成 { data } 事件 ----
async function* parseSSE(stream, signal) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLines = [];
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        }
        if (dataLines.length) yield { data: dataLines.join('\n') };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// 统一入口：根据供应商类型分派
export function streamChat(opts) {
  const kind = opts.provider.kind;
  if (kind === 'anthropic') return streamAnthropic(opts);
  return streamOpenAI(opts);
}

// 发现某个供应商实际可用的模型列表。
// OpenAI 兼容：查 /models 端点（我们诊断 Kimi 就是这么做的）。
// Anthropic：没有公开的 list 接口，返回已知模型。
export async function listModels(provider) {
  if (provider.kind === 'anthropic') {
    return ['claude-opus-4-1', 'claude-sonnet-4-5', 'claude-haiku-4-5'];
  }
  const base = provider.baseURL.replace(/\/$/, '');
  const res = await fetch(`${base}/models`, {
    headers: { authorization: `Bearer ${provider.apiKey}` },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`查询模型失败 ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const list = (data.data || data.models || []).map((m) => m.id || m.name).filter(Boolean);
  return list.sort();
}
