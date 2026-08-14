// 会话存储：一个 session 就是一条"共享对话流"。
// 所有参与者（你 + 各个 AI）的消息按时间顺序存在同一个数组里，
// 每条消息标记作者。这是本项目和 ChatALL 的本质区别：真正的共享上下文。
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SESSIONS_DIR } from './paths.js';

function sessionFile(id) {
  return join(SESSIONS_DIR, `${id}.json`);
}

export function listSessions() {
  if (!existsSync(SESSIONS_DIR)) return [];
  return readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const s = JSON.parse(readFileSync(join(SESSIONS_DIR, f), 'utf8'));
        return { id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, messageCount: s.messages.length, participants: s.participants || [], pinned: Boolean(s.pinned), pinnedAt: s.pinnedAt || 0, game: s.game || null };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    // 收藏(置顶)的排最前，收藏内按收藏时间新→旧；其余按更新时间新→旧
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.pinned && b.pinned) return (b.pinnedAt || 0) - (a.pinnedAt || 0);
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
}

// 切换收藏(置顶)。pinned=true 时记录收藏时间用于排序。
export function setPinned(session, pinned) {
  session.pinned = Boolean(pinned);
  session.pinnedAt = pinned ? Date.now() : 0;
  // 直接写盘，不更新 updatedAt（收藏不应改变"最近活跃"时间）
  writeFileSync(sessionFile(session.id), JSON.stringify(session, null, 2), 'utf8');
  return session;
}

export function getSession(id) {
  const f = sessionFile(id);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

// participants: 该对话里参与的成员及其在本对话内的职责限制。
// 每项：{ agentId, canUseTools, sessionPrompt }
//   canUseTools=false 表示这个成员在本对话里不能读写文件/跑命令（比如只做设计的）
//   sessionPrompt 是叠加在成员自身系统提示词之上的、仅本对话生效的职责说明
export function createSession(title = '新协作', participants = [], options = {}) {
  const now = Date.now();
  const session = {
    id: randomUUID(), title, createdAt: now, updatedAt: now,
    participants: normalizeParticipants(participants),
    // 第2层：一次用户请求，全场（所有 AI 加起来）最多发言几次，防止无限接力烧 token
    maxTurnsPerRequest: clampTurns(options.maxTurnsPerRequest),
    // 本对话专属工作区。空 = 用全局默认工作区。可让不同对话在不同目录干活。
    workspace: options.workspace ? String(options.workspace) : '',
    // 纯聊天模式：所有 AI 不调用工具，只用文字回复
    chatOnly: Boolean(options.chatOnly),
    // 内心思考：AI 输出分"思考(仅主持人可见)"和"发言(其他AI可见)"。默认开启。
    mindThinking: options.mindThinking !== false,
    // 思考区默认是否展开（false=折叠）
    thinkingExpanded: Boolean(options.thinkingExpanded),
    messages: [],
  };
  writeFileSync(sessionFile(session.id), JSON.stringify(session, null, 2), 'utf8');
  return session;
}

function clampTurns(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 6; // 默认全场 6 次
  return Math.max(1, Math.min(30, n));
}

function normalizeParticipants(list) {
  if (!Array.isArray(list)) return [];
  return list.map((p) => ({
    agentId: p.agentId,
    canUseTools: p.canUseTools !== false, // 默认允许
    sessionPrompt: p.sessionPrompt || '',
  })).filter((p) => p.agentId);
}

export function setParticipants(session, participants, options = {}) {
  session.participants = normalizeParticipants(participants);
  if ('maxTurnsPerRequest' in options) session.maxTurnsPerRequest = clampTurns(options.maxTurnsPerRequest);
  if ('workspace' in options) session.workspace = options.workspace ? String(options.workspace) : '';
  if ('chatOnly' in options) session.chatOnly = Boolean(options.chatOnly);
  if ('mindThinking' in options) session.mindThinking = Boolean(options.mindThinking);
  if ('thinkingExpanded' in options) session.thinkingExpanded = Boolean(options.thinkingExpanded);
  if (options.title) session.title = String(options.title);
  return saveSession(session);
}

// 拿到某个成员在本对话里的配置（没配则返回默认：可用工具、无额外提示）
export function participantConfig(session, agentId) {
  const p = (session.participants || []).find((x) => x.agentId === agentId);
  return p || { agentId, canUseTools: true, sessionPrompt: '' };
}

export function saveSession(session) {
  session.updatedAt = Date.now();
  writeFileSync(sessionFile(session.id), JSON.stringify(session, null, 2), 'utf8');
  return session;
}

export function deleteSession(id) {
  const f = sessionFile(id);
  if (existsSync(f)) unlinkSync(f);
}

// 一条消息：
// { id, authorType: 'user'|'agent'|'system', authorId, authorName, color, text, ts, meta }
export function addMessage(session, msg) {
  const message = {
    id: randomUUID(),
    ts: Date.now(),
    text: '',
    ...msg,
  };
  session.messages.push(message);
  saveSession(session);
  return message;
}

// 从对话流删除某条消息（用于撤回"过"这类无实质内容的跳过回复）
export function removeMessage(session, messageId) {
  session.messages = session.messages.filter((m) => m.id !== messageId);
  saveSession(session);
}

// 把共享对话流转成某个 agent 视角的输入。
// 关键点：其他 AI / 你的发言，都被这个 agent 看成 user 消息，
// 只有它自己的历史发言算 assistant。这样它就"看得到"全场对话。
export function buildContextFor(session, selfAgentId) {
  const out = [];
  for (const m of session.messages) {
    if (m.authorType === 'system') continue;
    const isSelf = m.authorType === 'agent' && m.authorId === selfAgentId;
    const role = isSelf ? 'assistant' : 'user';
    // 给非本人的发言加上作者前缀，让 AI 知道这句是谁说的。
    // 注意：别人的内心思考存在 m.meta.thinking 里，从不进入这里
    //  —— 这是"思考不泄露给其他 AI"的物理隔离点。
    let content = m.text || '';
    if (isSelf && m.meta && m.meta.thinking && m.meta.thinking.trim()) {
      // 自己的历史消息：按【思考】【发言】格式重建，让模型看到自己过往输出
      // 的格式示范，避免它在后续回合"忘记"该用格式（自己的思考给自己看无泄露问题）。
      content = `【思考】\n${m.meta.thinking}\n【发言】\n${content}`;
    }
    if (!isSelf && m.authorName) {
      content = `【${m.authorName}】: ${content}`;
    }
    if (!content.trim()) continue;
    // 合并连续同 role 的消息（API 要求 user/assistant 交替）
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content += `\n\n${content}`;
    } else {
      out.push({ role, content });
    }
  }
  // 保证首条是 user
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

// ===== 私聊（用户与单个 AI 成员的私密对话，其他 AI 看不到）=====

// 取某成员的私聊（没有则初始化）
export function getPrivateChat(session, agentId) {
  if (!session.privateChats) session.privateChats = {};
  if (!session.privateChats[agentId]) session.privateChats[agentId] = { messages: [] };
  return session.privateChats[agentId];
}

// 往私聊里加一条消息
export function addPrivateMessage(session, agentId, msg) {
  const pc = getPrivateChat(session, agentId);
  const message = { id: randomUUID(), ts: Date.now(), text: '', ...msg };
  pc.messages.push(message);
  saveSession(session);
  return message;
}

// 构建私聊 AI 的上下文：主对话（该 AI 视角）+ 它的私聊记录。
// 私聊里用户消息=user，该 AI 的回复=assistant。
export function buildPrivateContextFor(session, agentId) {
  const out = buildContextFor(session, agentId); // 先拿主对话（含它看得到的全场）
  const pc = getPrivateChat(session, agentId);
  for (const m of pc.messages) {
    const role = m.role === 'agent' ? 'assistant' : 'user';
    const content = m.text || '';
    if (!content.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

// 把一段私聊（用户消息 + AI 回复）公开到主对话，其他 AI 即可看到。
// 只公开这一对，不含私聊其他上下文。
export function publishPrivateExchange(session, agentId, userText, agentMsg) {
  const results = [];
  if (userText && userText.trim()) {
    results.push(addMessage(session, {
      authorType: 'user', authorName: '我', text: userText,
      meta: { fromPrivate: agentMsg?.authorName || '私聊' },
    }));
  }
  results.push(addMessage(session, {
    authorType: 'agent', authorId: agentId, authorName: agentMsg.authorName,
    color: agentMsg.color, avatar: agentMsg.avatar, text: agentMsg.text,
    meta: { model: agentMsg.model, fromPrivate: true },
  }));
  return results;
}
