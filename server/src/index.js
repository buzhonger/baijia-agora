// 主服务器：REST API（配置/会话管理）+ WebSocket（实时对话流）。
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { ensureDirs, ROOT_DIR } from './paths.js';
import {
  publicConfig, loadConfig, upsertProvider, removeProvider,
  upsertAgent, removeAgent, setWorkspace, PROVIDER_TEMPLATES,
} from './config.js';
import {
  listSessions, getSession, createSession, deleteSession, addMessage, setParticipants, setPinned,
  addPrivateMessage, publishPrivateExchange,
} from './sessions.js';
import { runAgentTurn, resolveConfirm, parseMentions } from './orchestrator.js';
import { runPrivateTurn } from './private-chat.js';
import { runAutoFlow, stopAutoFlow, isAutoFlowRunning } from './autoflow.js';
import { listModels, streamChat } from './providers.js';
import { runGame, stopGame, resolveHumanInput, resolveJudgeAction } from './games/werewolf.js';
import { publicPresets } from './games/werewolf-presets.js';

ensureDirs();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ---- 配置相关 ----
app.get('/api/config', (req, res) => res.json(publicConfig()));
app.get('/api/provider-templates', (req, res) => res.json(PROVIDER_TEMPLATES));
app.get('/api/games/werewolf/presets', (req, res) => res.json(publicPresets()));

app.put('/api/providers/:id', (req, res) => {
  upsertProvider(req.params.id, req.body || {});
  res.json(publicConfig());
});
app.delete('/api/providers/:id', (req, res) => {
  removeProvider(req.params.id);
  res.json(publicConfig());
});
// 发现某供应商实际可用的模型列表（问它的 /models 接口）
app.get('/api/providers/:id/models', async (req, res) => {
  const cfg = loadConfig();
  const provider = cfg.providers[req.params.id];
  if (!provider || !provider.apiKey) return res.status(400).json({ error: '该供应商未配置或缺少 API Key' });
  try {
    res.json({ models: await listModels(provider) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
// 模型调试：发一句 ping，测某供应商+模型能否真的对话，返回延迟和样例回复
app.post('/api/providers/:id/test', async (req, res) => {
  const cfg = loadConfig();
  const provider = cfg.providers[req.params.id];
  const model = req.body?.model;
  if (!provider || !provider.apiKey) return res.status(400).json({ ok: false, error: '该供应商未配置或缺少 API Key' });
  if (!model) return res.status(400).json({ ok: false, error: '未指定模型' });
  const t0 = Date.now();
  try {
    let out = '';
    for await (const e of streamChat({ provider, model, system: '你是连接测试助手，用一句话回答。',
      messages: [{ role: 'user', content: '用中文说：连接成功' }], maxTokens: 50 })) {
      if (e.type === 'text') out += e.text;
    }
    res.json({ ok: true, latencyMs: Date.now() - t0, reply: out.trim() });
  } catch (e) {
    res.status(502).json({ ok: false, latencyMs: Date.now() - t0, error: e.message });
  }
});

app.post('/api/agents', (req, res) => {
  upsertAgent(req.body || {});
  res.json(publicConfig());
});
app.delete('/api/agents/:id', (req, res) => {
  removeAgent(req.params.id);
  res.json(publicConfig());
});

app.put('/api/workspace', (req, res) => {
  setWorkspace(req.body?.workspace || '');
  res.json(publicConfig());
});

// ---- 会话相关 ----
app.get('/api/sessions', (req, res) => res.json(listSessions()));
app.get('/api/sessions/:id', (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(s);
});
app.post('/api/sessions', (req, res) => res.json(createSession(req.body?.title, req.body?.participants, { maxTurnsPerRequest: req.body?.maxTurnsPerRequest, workspace: req.body?.workspace })));
app.put('/api/sessions/:id/participants', (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  const opts = { maxTurnsPerRequest: req.body?.maxTurnsPerRequest };
  if ('workspace' in (req.body || {})) opts.workspace = req.body.workspace;
  res.json(setParticipants(s, req.body?.participants || [], opts));
});
app.put('/api/sessions/:id/pin', (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(setPinned(s, req.body?.pinned));
});
app.delete('/api/sessions/:id', (req, res) => {
  deleteSession(req.params.id);
  res.json({ ok: true });
});

// ---- 生产环境：托管前端构建产物 ----
const webDist = join(ROOT_DIR, 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(webDist, 'index.html'));
  });
}

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// 每个 session 的活跃连接集合，用于广播
const rooms = new Map(); // sessionId -> Set<ws>
const pendingPcConfirm = new Map(); // 私聊危险操作确认：confirmId -> resolve

function broadcast(sessionId, event) {
  const set = rooms.get(sessionId);
  if (!set) return;
  const data = JSON.stringify(event);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

wss.on('connection', (ws) => {
  ws.sessionId = null;
  ws.abortControllers = new Set();
  // 心跳保活：每 25 秒 ping 一次，防止长响应/空闲期间连接被中间层关闭而中止请求
  const keepAlive = setInterval(() => {
    if (ws.readyState === ws.OPEN) { try { ws.ping(); } catch {} } else { clearInterval(keepAlive); }
  }, 25000);
  ws.on('close', () => clearInterval(keepAlive));

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // 加入某个会话房间
    if (msg.type === 'join') {
      if (ws.sessionId) rooms.get(ws.sessionId)?.delete(ws);
      ws.sessionId = msg.sessionId;
      if (!rooms.has(ws.sessionId)) rooms.set(ws.sessionId, new Set());
      rooms.get(ws.sessionId).add(ws);
      return;
    }

    const emit = (event) => broadcast(ws.sessionId, event);

    // 用户发言
    if (msg.type === 'user_message') {
      const session = getSession(ws.sessionId);
      if (!session) return;
      const m = addMessage(session, {
        authorType: 'user', authorName: '我', text: msg.text || '',
      });
      broadcast(ws.sessionId, { type: 'message_added', message: m });
      return;
    }

    // 触发一个或多个 agent 依次应答。
    // trigger_agent: 单个；trigger_agents: 用户 @ 了多人，全部依次回复。
    // 每个人发言后若 @ 了新人，把新人加入队列继续（形成接力链）。全场上限是硬闸。
    if (msg.type === 'trigger_agent' || msg.type === 'trigger_agents') {
      const session = getSession(ws.sessionId);
      const cfg = loadConfig();
      const initialIds = msg.type === 'trigger_agents' ? (msg.agentIds || []) : [msg.agentId];
      const queue = initialIds.map((id) => cfg.agents.find((a) => a.id === id)).filter(Boolean);
      if (!session || !queue.length) return;
      const controller = new AbortController();
      ws.abortControllers.add(controller);

      (async () => {
        // 用户直接 @ 的人数作为保底：这些人一定都要发言，不被上限砍。
        // 上限只在"AI 之间接力"超出保底后才生效，防止失控。
        const initialSet = new Set(initialIds); // 用户直接 @ 的保底成员（一定要发言）
        const cap = Math.max(queue.length, session.maxTurnsPerRequest || 6);
        let turns = 0;
        let lastSpoker = null;
        while (queue.length && turns < cap && !controller.signal.aborted) {
          const current = queue.shift();
          const isInitial = initialSet.has(current.id);
          // 紧邻重复只在非保底时跳过（保底成员即使刚被提及也要发言）
          if (current.id === lastSpoker && !isInitial) continue;
          const produced = await runAgentTurn({ session, agent: current, emit, signal: controller.signal });
          turns += 1;
          lastSpoker = current.id;

          // 它 @ 了谁：被点名的人插到队列【最前面】，这样"点名→立刻接着说"，
          // 提示和真实发言顺序一致（之前加到末尾会导致提示与下一个发言者对不上）。
          // noRelay=true 时禁止自动接龙。
          if (!msg.noRelay) {
            const fresh = getSession(ws.sessionId);
            const mentioned = parseMentions(produced?.text, fresh, cfg.agents, current.id);
            // 按 @ 出现顺序，逆序 unshift，保证最终队首顺序 = 提及顺序
            for (let i = mentioned.length - 1; i >= 0; i--) {
              const nx = mentioned[i];
              if (nx.id === lastSpoker) continue; // 别立刻让自己再说
              // 若已在队列里，先移除，避免重复；再插到最前
              const idx = queue.findIndex((q) => q.id === nx.id);
              if (idx >= 0) queue.splice(idx, 1);
              queue.unshift(nx);
              const note = addMessage(fresh, {
                authorType: 'system', authorName: '系统',
                text: `↪ 「${current.name}」点名了 @${nx.name}，接下来由他发言`,
              });
              emit({ type: 'message_added', message: note });
            }
          }
        }
        if (turns >= cap && queue.length) {
          const s2 = getSession(ws.sessionId);
          const note = addMessage(s2, { authorType: 'system', authorName: '系统', text: `⏹ 已达全场发言上限（${cap} 次），停止接力以节省 token。可调高上限或分批 @。` });
          emit({ type: 'message_added', message: note });
        }
      })().finally(() => ws.abortControllers.delete(controller));
      return;
    }

    // 启动自动协作。默认接力顺序 = 本对话的参与者名单
    if (msg.type === 'start_autoflow') {
      const session = getSession(ws.sessionId);
      const cfg = loadConfig();
      if (!session) return;
      const participantIds = (session.participants || []).map((p) => p.agentId);
      runAutoFlow({
        session, agents: cfg.agents,
        order: msg.order || participantIds,
        emit,
      });
      return;
    }

    if (msg.type === 'stop_autoflow') {
      stopAutoFlow(ws.sessionId);
      emit({ type: 'system_note', text: '已停止自动协作。' });
      return;
    }

    // 启动一局狼人杀（msg.game = { scenario, seats }）
    if (msg.type === 'start_game') {
      const session = getSession(ws.sessionId);
      if (!session) return;
      runGame(session, msg.game || {}, emit);
      return;
    }
    if (msg.type === 'stop_game') {
      stopGame(ws.sessionId);
      emit({ type: 'system_note', text: '已终止游戏。' });
      return;
    }
    // 人类玩家在狼人杀里输入（发言/选人），回传给挂起的游戏引擎
    if (msg.type === 'game_input') {
      resolveHumanInput(msg.inputId, msg.text || '');
      return;
    }
    // 法官介入指令（@公开提问 / 私聊 / 继续）
    if (msg.type === 'judge_action') {
      resolveJudgeAction(ws.sessionId, msg.action || { type: 'continue' });
      return;
    }

    // 危险操作确认结果
    if (msg.type === 'confirm_response') {
      resolveConfirm(msg.confirmId, Boolean(msg.approved));
      return;
    }

    // 私聊：用户发消息给某个成员，触发其私聊应答。私聊事件只发给本连接。
    if (msg.type === 'pc_send') {
      const session = getSession(ws.sessionId);
      const cfg = loadConfig();
      const agent = cfg.agents.find((a) => a.id === msg.agentId);
      if (!session || !agent) return;
      // 先存用户消息
      const um = addPrivateMessage(session, agent.id, { role: 'user', authorName: '我', text: msg.text || '' });
      const pcEmit = (event) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event)); };
      pcEmit({ type: 'pc_message_added', agentId: agent.id, message: um });
      const controller = new AbortController();
      ws.abortControllers.add(controller);
      // 危险操作确认：复用主确认弹窗机制
      const askConfirm = (payload) => new Promise((resolve) => {
        const confirmId = `pc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        pendingPcConfirm.set(confirmId, resolve);
        pcEmit({ type: 'confirm_request', confirmId, ...payload });
        setTimeout(() => { if (pendingPcConfirm.has(confirmId)) { pendingPcConfirm.delete(confirmId); resolve(false); } }, 5 * 60 * 1000);
      });
      runPrivateTurn({ session, agent, emit: pcEmit, signal: controller.signal, askConfirm })
        .finally(() => ws.abortControllers.delete(controller));
      return;
    }
    // 私聊确认结果
    if (msg.type === 'pc_confirm_response') {
      const r = pendingPcConfirm.get(msg.confirmId);
      if (r) { pendingPcConfirm.delete(msg.confirmId); r(Boolean(msg.approved)); }
      return;
    }
    // 公开一段私聊到主对话（其他 AI 可见）
    if (msg.type === 'pc_publish') {
      const session = getSession(ws.sessionId);
      if (!session) return;
      const added = publishPrivateExchange(session, msg.agentId, msg.userText, msg.agentMsg || {});
      for (const m of added) broadcast(ws.sessionId, { type: 'message_added', message: m });
      return;
    }
  });

  ws.on('close', () => {
    if (ws.sessionId) rooms.get(ws.sessionId)?.delete(ws);
    for (const c of ws.abortControllers) c.abort();
  });
});

const PORT = process.env.PORT || 8787;
server.listen(PORT, () => {
  console.log(`\n🤝 AI 协作工作台后端已启动`);
  console.log(`   API:  http://localhost:${PORT}/api`);
  console.log(`   WS:   ws://localhost:${PORT}/ws`);
  if (existsSync(webDist)) console.log(`   界面: http://localhost:${PORT}\n`);
  else console.log(`   (开发模式：前端请另跑 npm --prefix web run dev)\n`);
});
