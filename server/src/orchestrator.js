// 编排器：驱动一个 agent 在共享对话流里应答。
// 负责：拼上下文 → 调用 AI（流式）→ 处理工具调用（含危险操作确认）→ 把结果写回对话流。
// 通过 emit 回调把实时事件推给 WebSocket。
import { streamChat } from './providers.js';
import { runTool, TOOL_DEFS, DANGEROUS_TOOLS } from './tools.js';
import { buildContextFor, addMessage, saveSession, participantConfig, getPrivateChat } from './sessions.js';
import { loadConfig } from './config.js';

// 待确认的危险操作：confirmId -> { resolve }
const pendingConfirms = new Map();

export function resolveConfirm(confirmId, approved) {
  const p = pendingConfirms.get(confirmId);
  if (p) {
    pendingConfirms.delete(confirmId);
    p.resolve(approved);
  }
}

function askConfirm(emit, payload) {
  const confirmId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    pendingConfirms.set(confirmId, { resolve });
    emit({ type: 'confirm_request', confirmId, ...payload });
    // 5 分钟无响应则默认拒绝
    setTimeout(() => {
      if (pendingConfirms.has(confirmId)) {
        pendingConfirms.delete(confirmId);
        resolve(false);
      }
    }, 5 * 60 * 1000);
  });
}

// 让某个 agent 在 session 里应答一次。
// emit(event) 会把事件推给前端；signal 用于中止。
export async function runAgentTurn({ session, agent, emit, signal, enableTools = true, inAutoflow = false, toolMode = 'normal' }) {
  const cfg = loadConfig();
  const provider = cfg.providers[agent.providerId];
  if (!provider || !provider.apiKey) {
    const m = addMessage(session, {
      authorType: 'system', authorName: '系统', text: `⚠️ agent「${agent.name}」的供应商未配置或缺少 API Key。`,
    });
    emit({ type: 'message_added', message: m });
    return;
  }

  // 读取该成员在本对话里的职责配置
  const pc = participantConfig(session, agent.id);
  // 工具开关：全局 enableTools 且本对话允许该成员用工具，才真正启用
  const toolsOn = enableTools && pc.canUseTools !== false;
  // 系统提示词 = 成员自身设定 + 本对话职责说明 + 工具受限说明 + 在场成员名单
  let systemPrompt = agent.systemPrompt || '';
  if (pc.sessionPrompt) systemPrompt += `\n\n【本对话职责】${pc.sessionPrompt}`;
  if (!toolsOn) systemPrompt += `\n\n【限制】在本对话中你不能读写文件或执行命令，只能通过文字参与讨论。`;
  // 告诉它在场有哪些队友，可以用 @名字 点名让对方接着发言
  const teammates = (session.participants || [])
    .map((p) => cfg.agents.find((a) => a.id === p.agentId))
    .filter((a) => a && a.id !== agent.id)
    .map((a) => a.name);
  if (teammates.length) {
    systemPrompt += `\n\n【团队】你是「${agent.name}」。在场的其他队友有：${teammates.join('、')}。`
      + `\n【身份边界——务必遵守】`
      + `\n• 你只需要以「${agent.name}」的身份，说出【你自己】的这一段发言。`
      + `\n• 【绝对禁止】在一条回复里模拟出多个成员的对话，例如写成"${teammates[0]}：……\n${teammates[1] || '某队友'}：……"这种把别人台词也一起编出来的格式——那是幻觉，别人会自己发言。`
      + `\n• 即使用户要求"每个人给出自己的答案"，你也【只给你自己那一份】，其余成员会各自回答，不要替他们代答。`
      + `\n• 引用、提到、赞同或反驳其他队友的观点是完全可以的（例如"我同意${teammates[0]}关于…的看法，但我认为…"），这很好；只是不要凭空替他们说出整段发言。`
      + `\n• 例外：只有当用户明确要求你帮某位队友起草/代拟内容时，才可以那样做。`
      + `\n【@点名规则——务必严格遵守】`
      + `\n• "@ + 名字"是一个特殊指令，含义是"让这位队友接着发言"。系统会自动触发该队友回复。`
      + `\n• 因此：只有当你确实想让某位队友【接下来立即发言】时，才写「@名字」（例如 @${teammates[0]}）。`
      + `\n• 每条回复最多只能 @ 一位队友（你想让谁接力就 @ 谁一个人）。`
      + `\n• 如果你只是提到、感谢、引用某位队友（例如"谢谢${teammates[0]}的观点"），直接写名字，【绝对不要加 @】，否则会错误触发对方发言。`
      + `\n• 不需要别人接力时，正常回复，不要 @ 任何人。`
      + `\n• 绝不要 @ 你自己（${agent.name}）。`;
  }

  // ===关键=== 注入该 AI 与用户的私聊历史（仅此 AI 可见，其他 AI 的上下文里没有这段）
  // 这样 AI 在主聊天发言时能记住私聊里答应的事、被交代的任务，确保私聊承诺得到履行。
  const privateChat = getPrivateChat(session, agent.id);
  if (privateChat.messages && privateChat.messages.length > 0) {
    const pcMsgs = privateChat.messages.filter((m) => m.text && m.text.trim());
    if (pcMsgs.length > 0) {
      systemPrompt += `\n\n【私聊历史·仅你(${agent.name})可见，其他 AI 看不到这部分】\n`
        + `以下是你与用户之间的私聊记录。你必须记住并遵守私聊中的承诺和指示，在此次主对话回复中体现：\n`;
      for (const m of pcMsgs) {
        const who = m.role === 'user' || m.authorType === 'user' ? '用户' : `你(${agent.name})`;
        systemPrompt += `${who}：${m.text}\n`;
      }
      systemPrompt += `【强制要求】你在私聊中做出的承诺或收到的指示，在本次主对话回复里必须履行。不得与私聊内容矛盾。`;
    }
  }

  // 自动协作模式：没有实质内容可补充时允许跳过，避免凑满次数浪费 token
  if (inAutoflow) {
    systemPrompt += `\n\n【自动协作提示】当前是多轮自动协作模式。如果前面的讨论已经充分解决了问题，`
      + `你没有实质性新内容可补充，请只回复一个字"过"，系统会跳过本轮以节省 token。否则正常发言。`;
  }

  // 先创建一条空的 assistant 消息，流式往里填
  const msg = addMessage(session, {
    authorType: 'agent', authorId: agent.id, authorName: agent.name, color: agent.color, avatar: agent.avatar, text: '',
    meta: { model: agent.model, streaming: true },
  });
  emit({ type: 'message_added', message: msg });

  // 工具调用循环：AI 可能要多轮调用工具后才给出最终答复
  let toolMessages = []; // 累积本轮的工具往返，供下一次调用
  const MAX_ROUNDS = 8;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const baseContext = buildContextFor(session, agent.id);
    // 把本轮已发生的工具往返附加到上下文末尾
    const messages = [...baseContext, ...toolMessages];
    if (!messages.length) messages.push({ role: 'user', content: '(开始)' });

    let gotText = false;
    const toolCalls = [];

    try {
      for await (const evt of streamChat({
        provider, model: agent.model, system: systemPrompt,
        messages, tools: toolsOn ? TOOL_DEFS : undefined, signal,
        maxTokens: agent.maxTokens,
      })) {
        if (signal?.aborted) break;
        if (evt.type === 'text') {
          gotText = true;
          msg.text += evt.text;
          emit({ type: 'message_delta', messageId: msg.id, text: evt.text });
        } else if (evt.type === 'tool_call') {
          toolCalls.push(evt);
        }
      }
    } catch (err) {
      // 区分"中止"和"真正的错误"：中止（连接断开/用户停止）不显示吓人的报错
      const aborted = signal?.aborted || err.name === 'AbortError' || /aborted/i.test(err.message || '');
      if (!aborted) {
        msg.text += `\n\n⚠️ 调用出错：${err.message}`;
        emit({ type: 'message_delta', messageId: msg.id, text: `\n\n⚠️ 调用出错：${err.message}` });
      }
      break;
    }

    if (!toolCalls.length) break; // 没有工具调用，本轮结束

    // 执行每个工具调用
    const toolResults = [];
    for (const call of toolCalls) {
      const isDangerous = DANGEROUS_TOOLS.has(call.name);
      // toolMode='auto': 只有高危操作弹确认；'normal': 所有工具都弹确认
      const needConfirm = toolMode === 'auto' ? isDangerous : true;
      let approved = true;
      if (needConfirm) {
        emit({ type: 'message_delta', messageId: msg.id, text: `\n\n🔧 请求执行：\`${call.name}\` ${JSON.stringify(call.input).slice(0, 200)}` });
        approved = await askConfirm(emit, {
          agentName: agent.name, tool: call.name, input: call.input,
        });
      } else {
        emit({ type: 'message_delta', messageId: msg.id, text: `\n\n🔧 ${call.name}: ${JSON.stringify(call.input).slice(0, 200)}` });
      }

      let result;
      if (!approved) {
        result = { ok: false, error: '用户拒绝了此操作' };
        emit({ type: 'message_delta', messageId: msg.id, text: `\n❌ 已拒绝` });
      } else {
        // 对话级工作区优先，没设则用全局默认
        const ws = (session.workspace && session.workspace.trim()) ? session.workspace : cfg.workspace;
        try {
          result = await runTool({ workspace: ws, name: call.name, input: call.input });
        } catch (e) {
          result = { ok: false, error: e.message || '工具执行出错' };
        }
        const summary = result.ok ? '✅ 完成' : `❌ ${result.error || '失败'}`;
        emit({ type: 'message_delta', messageId: msg.id, text: `\n${summary}` });
      }
      toolResults.push({ call, result });
    }

    saveSession(session);
    // 把工具往返按协议格式追加，进入下一轮让 AI 看到结果
    toolMessages.push(...formatToolRoundtrip(provider.kind, toolResults));
  }

  // 空回复自动重试：有些模型（如 deepseek-v4-flash）偶发返回空，会打断接力链。
  // 若正文为空，用非流式方式再请求一次补上。
  if (!msg.text.trim() && !signal?.aborted) {
    try {
      let retry = '';
      const baseContext = buildContextFor(session, agent.id);
      const messages = baseContext.length ? baseContext : [{ role: 'user', content: '(请回复)' }];
      for await (const evt of streamChat({
        provider, model: agent.model, system: systemPrompt,
        messages, tools: undefined, signal, maxTokens: agent.maxTokens,
      })) {
        if (signal?.aborted) break;
        if (evt.type === 'text') { retry += evt.text; }
      }
      if (retry.trim()) {
        msg.text = retry;
        emit({ type: 'message_delta', messageId: msg.id, text: retry });
      } else {
        msg.text = '（该模型这次没有返回内容，可稍后重试或换用更稳定的模型）';
        emit({ type: 'message_delta', messageId: msg.id, text: msg.text });
      }
    } catch { /* 重试失败就保持空，不阻塞流程 */ }
  }

  msg.meta.streaming = false;
  saveSession(session);
  emit({ type: 'message_done', messageId: msg.id });
  return msg;
}

// 从一段文本里解析出被 @ 的在场成员。
// 关键：返回结果按 @ 在文字里【出现的先后位置】排序，
// 这样"@1号 …@小可爱"会先接力 1号 再到小可爱，形成正确的连续指派链条。
// excludeId：要排除的成员（通常是发言者自己，避免自己 @ 自己）。
export function parseMentions(text, session, agents, excludeId = null) {
  if (!text) return [];
  const inSession = (session.participants || [])
    .map((p) => agents.find((a) => a.id === p.agentId))
    .filter(Boolean);
  // 匹配时名字长的优先，避免"1号"吃掉"11号"这类子串问题
  const byLen = [...inSession].sort((a, b) => b.name.length - a.name.length);
  const found = []; // { agent, pos }
  for (const a of byLen) {
    if (a.id === excludeId) continue; // 不把发言者自己算作被点名
    const m = text.match(new RegExp('@\\s*' + a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    if (m && !found.some((f) => f.agent === a)) found.push({ agent: a, pos: m.index });
  }
  // 按出现位置从前到后排序，返回 agent 数组
  return found.sort((x, y) => x.pos - y.pos).map((f) => f.agent);
}

// 把工具调用+结果转成对应协议的消息，追加给下一轮。
// 为兼容简单，这里统一用文本形式喂回（两种协议都能理解）。
function formatToolRoundtrip(kind, toolResults) {
  const lines = ['(以下是工具执行结果，请据此继续)'];
  for (const { call, result } of toolResults) {
    lines.push(`工具 ${call.name}(${JSON.stringify(call.input)}) 返回：`);
    lines.push('```json');
    lines.push(JSON.stringify(result).slice(0, 8000));
    lines.push('```');
  }
  // 作为一条 user 消息喂回
  return [{ role: 'user', content: lines.join('\n') }];
}
