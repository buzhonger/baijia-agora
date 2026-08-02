// 私聊编排：用户与单个 AI 成员的私密对话。
// AI 能看到主对话全场 + 本私聊记录；其他 AI 看不到本私聊。
// 复用工具调用能力（读写文件/命令，危险操作确认）。
import { streamChat } from './providers.js';
import { runTool, TOOL_DEFS, DANGEROUS_TOOLS } from './tools.js';
import { buildPrivateContextFor, addPrivateMessage, saveSession } from './sessions.js';
import { loadConfig } from './config.js';
import { resolveConfirm as _rc } from './orchestrator.js';

// 私聊 AI 应答。emit 事件都带 agentId，前端据此路由到对应私聊面板。
export async function runPrivateTurn({ session, agent, emit, signal, askConfirm }) {
  const cfg = loadConfig();
  const provider = cfg.providers[agent.providerId];
  if (!provider || !provider.apiKey) {
    const m = addPrivateMessage(session, agent.id, { role: 'system', text: `⚠️ 供应商未配置或缺少 API Key。` });
    emit({ type: 'pc_message_added', agentId: agent.id, message: m });
    return;
  }

  // 私聊系统提示：让 AI 知道自己在私聊、其他 AI 看不到、用户可选择公开
  let systemPrompt = agent.systemPrompt || '';
  systemPrompt += `\n\n【私聊情境】你正在与用户进行一对一的私聊。`
    + `重要：你收到的对话记录中已经完整包含了主对话（公共频道）的历史内容，你完全可以看到并引用主聊天中的所有信息。`
    + `私聊的含义只是"这个私聊频道中你们之间说的话，其他 AI 成员看不到"，而不是说你看不到主聊天——主聊天历史已经在上下文中，你可以直接引用。`
    + `用户可以选择把你的某条回复"公开"到主对话让其他成员看到（仅公开那一次的问答，私聊其他内容不会泄漏）。`
    + `当你觉得某个结论适合让全体知道时，可以提示用户"这条可以点公开给其他成员看"。`
    + `\n【格式要求】直接输出你要说的话，不要在开头加"【我】："、"【${agent.name}】："之类的说话人前缀（上下文里的前缀只是用来区分历史发言者的，不代表你要照抄这个格式）。`;

  const msg = addPrivateMessage(session, agent.id, {
    role: 'agent', authorName: agent.name, color: agent.color, avatar: agent.avatar,
    text: '', meta: { model: agent.model, streaming: true },
  });
  emit({ type: 'pc_message_added', agentId: agent.id, message: msg });

  const pc = cfg.agents.find((a) => a.id === agent.id) || agent;
  const toolsOn = true; // 私聊里允许工具（读写文件/命令），受危险操作确认
  let toolMessages = [];
  const MAX_ROUNDS = 8;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const baseContext = buildPrivateContextFor(session, agent.id);
    const messages = [...baseContext, ...toolMessages];
    if (!messages.length) messages.push({ role: 'user', content: '(开始)' });
    const toolCalls = [];
    try {
      for await (const evt of streamChat({
        provider, model: agent.model, system: systemPrompt,
        messages, tools: toolsOn ? TOOL_DEFS : undefined, signal, maxTokens: agent.maxTokens,
      })) {
        if (signal?.aborted) break;
        if (evt.type === 'text') {
          msg.text += evt.text;
          emit({ type: 'pc_message_delta', agentId: agent.id, messageId: msg.id, text: evt.text });
        } else if (evt.type === 'tool_call') toolCalls.push(evt);
      }
    } catch (err) {
      const e = `\n\n⚠️ 调用出错：${err.message}`;
      msg.text += e; emit({ type: 'pc_message_delta', agentId: agent.id, messageId: msg.id, text: e });
      break;
    }
    if (!toolCalls.length) break;

    const toolResults = [];
    for (const call of toolCalls) {
      const dangerous = DANGEROUS_TOOLS.has(call.name);
      let approved = true;
      if (dangerous && askConfirm) {
        emit({ type: 'pc_message_delta', agentId: agent.id, messageId: msg.id, text: `\n\n🔧 请求执行：\`${call.name}\` ${JSON.stringify(call.input)}` });
        approved = await askConfirm({ agentName: agent.name, tool: call.name, input: call.input });
      } else {
        emit({ type: 'pc_message_delta', agentId: agent.id, messageId: msg.id, text: `\n\n🔧 ${call.name}: ${JSON.stringify(call.input).slice(0, 200)}` });
      }
      let result;
      if (!approved) { result = { ok: false, error: '用户拒绝了此操作' }; emit({ type: 'pc_message_delta', agentId: agent.id, messageId: msg.id, text: `\n❌ 已拒绝` }); }
      else {
        const ws = (session.workspace && session.workspace.trim()) ? session.workspace : cfg.workspace;
        result = await runTool({ workspace: ws, name: call.name, input: call.input });
        emit({ type: 'pc_message_delta', agentId: agent.id, messageId: msg.id, text: `\n${result.ok ? '✅ 完成' : '❌ ' + (result.error || '失败')}` });
      }
      toolResults.push({ call, result });
    }
    saveSession(session);
    const lines = ['(以下是工具执行结果，请据此继续)'];
    for (const { call, result } of toolResults) { lines.push(`工具 ${call.name}(${JSON.stringify(call.input)}) 返回：`, JSON.stringify(result).slice(0, 8000)); }
    toolMessages.push({ role: 'user', content: lines.join('\n') });
  }

  // 安全网：剥掉 AI 可能误加的开头"【xxx】："说话人前缀
  const cleaned = msg.text.replace(/^\s*【[^】]*】\s*[:：]\s*/, '');
  if (cleaned !== msg.text) msg.text = cleaned;
  msg.meta.streaming = false;
  saveSession(session);
  emit({ type: 'pc_message_done', agentId: agent.id, messageId: msg.id, finalText: msg.text });
  return msg;
}
