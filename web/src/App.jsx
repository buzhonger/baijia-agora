import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api, connectWS } from './api.js';
import Settings, { Avatar } from './Settings.jsx';
import Participants from './Participants.jsx';
import Markdown from './Markdown.jsx';
import { exportMarkdown, exportJSON } from './export.js';
import Werewolf from './Werewolf.jsx';
import AdjustAgent from './AdjustAgent.jsx';
import JudgeConsole from './JudgeConsole.jsx';
import GameHub from './GameHub.jsx';
import AgentCard from './AgentCard.jsx';
import PrivateChatPanel from './PrivateChatPanel.jsx';
import { cleanLabel } from './utils.js';
import { useI18n } from './i18n.js';

export default function App() {
  const { t } = useI18n();
  const [config, setConfig] = useState(null);
  const [templates, setTemplates] = useState({});
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState('providers'); // 打开设置时定位到哪个tab
  const [connected, setConnected] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [confirm, setConfirm] = useState(null); // 危险操作确认
  const [input, setInput] = useState('');
  const [noRelay, setNoRelay] = useState(false); // 禁止AI自行接龙（持续开关）
  const [toolMode, setToolMode] = useState('normal'); // 工具确认模式：normal=全部确认 / auto=仅高危确认
  const [noTriggerHint, setNoTriggerHint] = useState(false); // 发了没@人的消息时的温和提示
  const [session, setSession] = useState(null);   // 当前会话完整对象（含 participants）
  const [participantsUI, setParticipantsUI] = useState(null); // 参与者弹层：{ mode:'new'|'edit' }
  const [exportOpen, setExportOpen] = useState(false);
  const [modelMenuFor, setModelMenuFor] = useState(null); // 正在切模型的 agentId
  const [discoveredModels, setDiscoveredModels] = useState({}); // providerId -> models
  const [adjustFor, setAdjustFor] = useState(null); // 对话中调整某成员限制：agent 对象
  const [confirmDelete, setConfirmDelete] = useState(null); // 待确认删除的会话 {id,title}
  const [escArmed, setEscArmed] = useState(false); // 第一次按 Esc 已就绪，再按一次终止本轮
  const [showSponsor, setShowSponsor] = useState(false); // 赞助弹窗
  const [gameInput, setGameInput] = useState(null); // 狼人杀轮到人类：{ inputId, prompt }
  const [gameInputText, setGameInputText] = useState('');
  const [gameState, setGameState] = useState(null); // 当前会话的游戏状态 { type, status, ... } | null
  const [judgeTurn, setJudgeTurn] = useState(null); // 法官介入节点：{ node, label, players } | null
  // 私聊：名片弹窗、各私聊内容、标签顺序、当前标签、是否最小化、面板宽度、危险操作确认
  const [agentCard, setAgentCard] = useState(null); // 点头像弹出的名片 agent
  const [pcChats, setPcChats] = useState({}); // { agentId: { agent, messages, input } }
  const [pcOrder, setPcOrder] = useState([]); // 标签顺序
  const [pcActive, setPcActive] = useState(null); // 当前标签 agentId
  const [pcMinimized, setPcMinimized] = useState(false);
  const [pcWidth, setPcWidth] = useState(42); // 面板宽度 %
  const [pcConfirm, setPcConfirm] = useState(null); // 私聊危险操作确认
  const [publishConfirm, setPublishConfirm] = useState(null); // 公开私聊确认
  const [mentionMenu, setMentionMenu] = useState(null); // @补全：{ query, matches } | null
  const [showGameHub, setShowGameHub] = useState(false); // 玩法入口选择器
  const [showWerewolf, setShowWerewolf] = useState(false);
  const [gameRunning, setGameRunning] = useState(false);
  const [clickToAt, setClickToAt] = useState(() => localStorage.getItem('agora_clickToAt') !== 'false');
  const inputRef = useRef(null);
  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const [atBottom, setAtBottom] = useState(true); // 视图是否在底部（决定要不要跟随滚动）
  const [newCount, setNewCount] = useState(0);     // 滚上去后错过的新消息条数
  const prevLenRef = useRef(0);                     // 上次消息条数，用于算新增

  const refreshConfig = useCallback(async () => {
    const [c, t] = await Promise.all([api.getConfig(), api.getProviderTemplates()]);
    setConfig(c); setTemplates(t);
  }, []);
  const refreshSessions = useCallback(async () => setSessions(await api.listSessions()), []);

  useEffect(() => { refreshConfig(); refreshSessions(); }, [refreshConfig, refreshSessions]);

  // 建立 WebSocket，处理实时事件
  useEffect(() => {
    const ws = connectWS((evt) => {
      if (evt.type === '_open') setConnected(true);
      else if (evt.type === '_close') setConnected(false);
      else if (evt.type === 'message_added') {
        setMessages((m) => m.some((x) => x.id === evt.message.id) ? m : [...m, evt.message]);
      } else if (evt.type === 'message_delta') {
        setMessages((m) => m.map((x) => x.id === evt.messageId ? { ...x, text: x.text + evt.text } : x));
      } else if (evt.type === 'message_done') {
        setMessages((m) => m.map((x) => x.id === evt.messageId ? { ...x, meta: { ...x.meta, streaming: false } } : x));
        refreshSessions();
      } else if (evt.type === 'confirm_request') {
        // pc- 前缀是私聊里的危险操作确认，单独弹
        if (String(evt.confirmId).startsWith('pc-')) setPcConfirm(evt);
        else setConfirm(evt);
      } else if (evt.type === 'pc_message_added') {
        setPcChats((c) => c[evt.agentId] ? { ...c, [evt.agentId]: { ...c[evt.agentId], messages: [...(c[evt.agentId].messages || []), evt.message] } } : c);
      } else if (evt.type === 'pc_message_delta') {
        setPcChats((c) => { const chat = c[evt.agentId]; if (!chat) return c;
          return { ...c, [evt.agentId]: { ...chat, messages: chat.messages.map((x) => x.id === evt.messageId ? { ...x, text: x.text + evt.text } : x) } }; });
      } else if (evt.type === 'pc_message_done') {
        setPcChats((c) => { const chat = c[evt.agentId]; if (!chat) return c;
          return { ...c, [evt.agentId]: { ...chat, messages: chat.messages.map((x) => x.id === evt.messageId ? { ...x, text: evt.finalText != null ? evt.finalText : x.text, meta: { ...x.meta, streaming: false } } : x) } }; });
      } else if (evt.type === 'message_retract') {
        // 自动协作里 AI 回了"过"（没有实质内容），系统撤回那条消息，不显示在对话里
        setMessages((m) => m.filter((x) => x.id !== evt.messageId));
      } else if (evt.type === 'autoflow_done') {
        setAutoRunning(false);
      } else if (evt.type === 'game_state') {
        setGameState(evt.game);
        if (evt.game?.status === 'finished') { setGameRunning(false); setGameInput(null); }
        else if (evt.game?.status === 'running') setGameRunning(true);
      } else if (evt.type === 'game_over') {
        setGameRunning(false);
        setGameInput(null);
        setJudgeTurn(null);
      } else if (evt.type === 'game_input_request') {
        setGameInput({ inputId: evt.inputId, prompt: evt.prompt });
        setGameInputText('');
      } else if (evt.type === 'game_judge_turn') {
        setJudgeTurn({ node: evt.node, label: evt.label, players: evt.players || [] });
      } else if (evt.type === 'game_judge_done') {
        setJudgeTurn(null);
      } else if (evt.type === 'system_note') {
        // 轻量系统提示，直接塞进消息流
        setMessages((m) => [...m, { id: `note-${Date.now()}`, authorType: 'system', authorName: '系统', text: evt.text, ts: Date.now() }]);
      }
    });
    wsRef.current = ws;
    return () => ws.close();
  }, [refreshSessions]);

  // 切换会话时加载历史并加入房间
  useEffect(() => {
    if (!activeId) { setSession(null); setMessages([]); setGameState(null); return; }
    api.getSession(activeId).then((s) => { setSession(s); setMessages(s?.messages || []); setGameState(s?.game || null); });
    wsRef.current?.send({ type: 'join', sessionId: activeId });
    // 切换会话：回到底部、清零未读
    setAtBottom(true); setNewCount(0); prevLenRef.current = 0;
  }, [activeId, connected]);

  // 切换对话时清空私聊面板：私聊是按对话隔离的，不能把上一个对话的私聊带到新对话里显示。
  // 只依赖 activeId（不含 connected），避免断线重连时误清空。
  useEffect(() => {
    setPcChats({});
    setPcOrder([]);
    setPcActive(null);
    setPcMinimized(false);
  }, [activeId]);

  // 全局双击 Esc 终止本轮：第一次按下弹提示并"就绪"，2 秒内再按一次才真正终止
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (mentionMenu) return; // 提及菜单打开时，Esc 交给它关闭，不触发终止
      if (!activeId || gameState) return; // 无对话或游戏中不处理
      if (escArmed) {
        stopTurn();
      } else {
        setEscArmed(true);
        setTimeout(() => setEscArmed(false), 2000); // 2 秒内没再按就取消就绪
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [escArmed, mentionMenu, activeId, gameState]);

  // 智能滚动：在底部才跟随最新；用户滚上去看历史时不打扰，改为统计未读新消息
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    const prevLen = prevLenRef.current;
    const grew = messages.length - prevLen;
    prevLenRef.current = messages.length;
    if (atBottom) {
      el.scrollTop = el.scrollHeight; // 在底部：跟随流式输出
    } else if (grew > 0) {
      setNewCount((n) => n + grew);   // 已滚上去：累计错过的新消息条数
    }
  }, [messages, atBottom]);

  // 监听滚动：判断是否贴底；贴底则清零未读
  function onStreamScroll() {
    const el = streamRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAtBottom(bottom);
    if (bottom) setNewCount(0);
  }
  // 点按钮：跳回底部
  function scrollToBottom() {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
    setNewCount(0);
  }

  // 新建对话：先弹参与者选择，选完再真正建会话
  function newSession() {
    if (!config?.agents?.length) { setShowSettings(true); return; }
    setParticipantsUI({ mode: 'new' });
  }

  async function confirmParticipants(list, options = {}) {
    if (participantsUI?.mode === 'new') {
      const s = await api.createSession('新协作', list, options);
      await refreshSessions();
      setActiveId(s.id);
    } else if (activeId) {
      const s = await api.setParticipants(activeId, list, options);
      setSession(s);
      await refreshSessions();
    }
    setParticipantsUI(null);
  }

  function send() {
    if (!input.trim() || !activeId) return;
    const text = input;
    wsRef.current?.send({ type: 'user_message', text });
    setInput('');
    setMentionMenu(null);
    setNoTriggerHint(false);
    // @所有人 / @everyone：本对话全部参与者按成员顺序依次回应（全体通知 / 上帝命令）
    if (/@\s*(所有人|everyone|全体|all)/i.test(text)) {
      const allIds = sessionAgents.map((a) => a.id);
      if (allIds.length) setTimeout(() => wsRef.current?.send({ type: 'trigger_agents', agentIds: allIds, noRelay, toolMode }), 150);
      return;
    }
    // 用户 @ 了谁，这些人就都要依次回复（按 @ 出现的先后顺序），一个不落。
    const mentioned = sessionAgents
      .map((a) => ({ a, pos: text.search(new RegExp('@\\s*' + a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))) }))
      .filter((x) => x.pos >= 0)
      .sort((x, y) => x.pos - y.pos)
      .map((x) => x.a.id);
    if (mentioned.length) {
      // 把所有被点名的人按顺序发给后端，后端依次让他们都发言
      setTimeout(() => wsRef.current?.send({ type: 'trigger_agents', agentIds: mentioned, noRelay, toolMode }), 150);
    } else if (sessionAgents.length) {
      // 没 @ 任何人、也不是@所有人 → 不会有 AI 回复，给新手一个温和提示
      setNoTriggerHint(true);
    }
  }

  // 输入变化时检测 @补全：光标前若是 @关键字，弹出匹配的参与者
  function onInputChange(e) {
    const val = e.target.value;
    setInput(val);
    const pos = e.target.selectionStart;
    const before = val.slice(0, pos);
    const match = before.match(/@([^\s@]*)$/);
    if (match) {
      const q = match[1].toLowerCase();
      // 特殊项"所有人"排最前（匹配空/所/all/every 等）
      const everyone = { id: '__everyone__', name: '所有人', isEveryone: true };
      const showEveryone = !q || '所有人everyoneall全体'.includes(q) || q.split('').some((ch) => '所有人everyoneall全体'.includes(ch));
      const matches = sessionAgents.filter((a) => a.name.toLowerCase().includes(q));
      const list = showEveryone ? [everyone, ...matches] : matches;
      setMentionMenu(list.length ? { query: match[1], matches: list } : null);
    } else {
      setMentionMenu(null);
    }
  }

  // 选中补全项：把光标前最后一个 @query 替换成 @名字
  function pickMention(name) {
    const el = inputRef.current;
    const pos = el ? el.selectionStart : input.length;
    const before = input.slice(0, pos).replace(/@([^\s@]*)$/, `@${name} `);
    const after = input.slice(pos);
    setInput(before + after);
    setMentionMenu(null);
    setTimeout(() => el?.focus(), 0);
  }

  function triggerAgent(agentId) {
    if (!activeId) return;
    setNoTriggerHint(false);
    wsRef.current?.send({ type: 'trigger_agent', agentId, noRelay, toolMode });
  }

  function startAuto() {
    if (!activeId) return;
    const order = sessionAgents.map((a) => a.id);
    if (!order.length) return;
    setAutoRunning(true);
    wsRef.current?.send({ type: 'start_autoflow', order, rounds: 1, toolMode });
  }

  function stopAuto() {
    wsRef.current?.send({ type: 'stop_autoflow' });
    setAutoRunning(false);
  }

  // 终止本轮：中止后台正在跑的接力/自动协作，回到输入态。未发言的 AI 不进上下文。
  function stopTurn() {
    wsRef.current?.send({ type: 'stop_turn' });
    setAutoRunning(false);
    setEscArmed(false);
  }

  // 开一局狼人杀：新建一个专用会话，再发 start_game
  async function startWerewolf(game) {
    setShowWerewolf(false);
    const scenName = game.scenario;
    const s = await api.createSession(`🐺 狼人杀-${scenName}`, [], { maxTurnsPerRequest: 99 });
    await refreshSessions();
    setActiveId(s.id);
    // 等 join 生效再开局
    setTimeout(() => {
      wsRef.current?.send({ type: 'join', sessionId: s.id });
      setTimeout(() => { wsRef.current?.send({ type: 'start_game', game }); setGameRunning(true); }, 200);
    }, 200);
  }
  function stopGame() {
    wsRef.current?.send({ type: 'stop_game' });
    setGameRunning(false);
  }

  function answerConfirm(approved) {
    wsRef.current?.send({ type: 'confirm_response', confirmId: confirm.confirmId, approved });
    setConfirm(null);
  }

  // 狼人杀轮到人类玩家时，提交你的发言/选择
  function submitGameInput() {
    if (!gameInput) return;
    wsRef.current?.send({ type: 'game_input', inputId: gameInput.inputId, text: gameInputText });
    setGameInput(null);
    setGameInputText('');
  }

  // 法官控制台发指令（@提问/私聊/继续）。继续时先清掉控制台，让游戏往下走。
  function sendJudgeAction(action) {
    if (action.type === 'continue') setJudgeTurn(null);
    wsRef.current?.send({ type: 'judge_action', action });
  }

  // ===== 私聊 =====
  // 打开与某成员的私聊（若已有则激活标签；加载已存历史）
  function openPrivateChat(agent) {
    setAgentCard(null);
    setPcMinimized(false);
    setPcActive(agent.id);
    setPcOrder((o) => o.includes(agent.id) ? o : [...o, agent.id]);
    setPcChats((c) => {
      if (c[agent.id]) return c; // 已开，保留内容
      // 从会话已存私聊记录加载历史
      const hist = session?.privateChats?.[agent.id]?.messages || [];
      return { ...c, [agent.id]: { agent, messages: hist, input: '' } };
    });
  }
  function pcSend(agentId, text) {
    if (!text.trim()) return;
    wsRef.current?.send({ type: 'pc_send', agentId, text });
    setPcChats((c) => ({ ...c, [agentId]: { ...c[agentId], input: '' } }));
  }
  function pcInputChange(agentId, text) {
    setPcChats((c) => ({ ...c, [agentId]: { ...c[agentId], input: text } }));
  }
  function pcClose(agentId) {
    setPcOrder((o) => { const next = o.filter((x) => x !== agentId);
      if (pcActive === agentId) setPcActive(next[next.length - 1] || null);
      return next; });
    // 内容保留在 pcChats，不删（下次打开继续）
  }
  function pcPublish(agentId, agentMsg) {
    // 找该回复前面最近的用户消息作为这一段的问
    const chat = pcChats[agentId];
    let userText = '';
    if (chat) { const idx = chat.messages.findIndex((x) => x.id === agentMsg.id);
      for (let i = idx - 1; i >= 0; i--) if (chat.messages[i].role === 'user') { userText = chat.messages[i].text; break; } }
    setPublishConfirm({ agentId, agentMsg, userText });
  }
  function doPublish() {
    const p = publishConfirm; if (!p) return;
    wsRef.current?.send({ type: 'pc_publish', agentId: p.agentId, userText: p.userText,
      agentMsg: { authorName: pcChats[p.agentId]?.agent.name, color: pcChats[p.agentId]?.agent.color, avatar: pcChats[p.agentId]?.agent.avatar, model: p.agentMsg.meta?.model, text: p.agentMsg.text } });
    setPublishConfirm(null);
  }
  function answerPcConfirm(approved) {
    wsRef.current?.send({ type: 'pc_confirm_response', confirmId: pcConfirm.confirmId, approved });
    setPcConfirm(null);
  }

  // 顶栏快速切换某成员的模型（闲聊切便宜版、干活切强版），不用进设置
  async function openModelMenu(agent) {
    setModelMenuFor(agent.id);
    // 每次打开都重新拉最新模型列表（和设置/狼人杀界面一致：厂商出新模型即可见）
    try {
      const { models } = await api.discoverModels(agent.providerId);
      setDiscoveredModels((d) => ({ ...d, [agent.providerId]: models }));
    } catch { /* 发现失败就只显示当前模型 */ }
  }
  async function switchModel(agent, model) {
    await api.upsertAgent({ id: agent.id, model });
    setModelMenuFor(null);
    await refreshConfig();
  }

  // 对话进行中实时调整某成员：发言次数/单次token 是成员级(upsertAgent)，
  // 职责/能否写代码 是对话级(setParticipants)，改完即时生效。
  async function saveAdjust(agent, patch) {
    // 成员级
    if ('maxRepliesPerRound' in patch || 'maxTokens' in patch) {
      await api.upsertAgent({ id: agent.id, maxRepliesPerRound: patch.maxRepliesPerRound, maxTokens: patch.maxTokens });
    }
    // 对话级：更新该成员在本会话的 canUseTools / sessionPrompt
    if (('canUseTools' in patch || 'sessionPrompt' in patch) && session) {
      const list = (session.participants || []).map((p) =>
        p.agentId === agent.id ? { ...p, canUseTools: patch.canUseTools, sessionPrompt: patch.sessionPrompt } : p);
      const s = await api.setParticipants(session.id, list, { maxTurnsPerRequest: session.maxTurnsPerRequest });
      setSession(s);
    }
    await refreshConfig();
    setAdjustFor(null);
  }

  // 收藏(置顶)/取消收藏
  async function togglePin(s, e) {
    e.stopPropagation();
    await api.pinSession(s.id, !s.pinned);
    await refreshSessions();
  }
  // 删除对话（需二次确认）
  async function doDelete(id, e) {
    e.stopPropagation();
    await api.deleteSession(id);
    if (activeId === id) { setActiveId(null); setSession(null); setMessages([]); }
    setConfirmDelete(null);
    await refreshSessions();
  }

  const allAgents = config?.agents || [];
  // 本对话的参与者：按 participants 名单从成员池映射，保留每人的对话内配置
  const sessionAgents = (session?.participants || [])
    .map((p) => {
      const a = allAgents.find((x) => x.id === p.agentId);
      return a ? { ...a, canUseTools: p.canUseTools !== false, sessionPrompt: p.sessionPrompt } : null;
    })
    .filter(Boolean);

  return (
    <div className="app">
      <aside className="sidebar">
        <h1 style={{ marginBottom: 2 }}><span className="dot">◆</span> {t('app.title')}</h1>
        <div className="inline-note" style={{ padding: '0 16px 10px' }}>
          作者：<a href="https://space.bilibili.com/1871554482" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>只想要低调</a>
        </div>
        <div className="sidebar-section" style={{ borderBottom: '1px solid var(--border)' }}>
          <button className="btn" style={{ width: '100%' }} onClick={newSession}>{t('sidebar.new')}</button>
          <button className="btn ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowGameHub(true)} disabled={!config?.providers || Object.keys(config?.providers || {}).length === 0}>🎮 玩法入口</button>
        </div>
        <div className="sidebar-section" style={{ flex: 1 }}>
          <div className="label">{t('sidebar.sessions')}</div>
          {sessions.map((s) => {
            const partAgents = (s.participants || []).map((p) => allAgents.find((a) => a.id === p.agentId)).filter(Boolean);
            return (
              <div key={s.id} className={`session-item ${s.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(s.id)}>
                <span className="title">{s.pinned && <span style={{ color: 'var(--accent)' }}>★ </span>}{s.title}</span>
                <span className="session-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {partAgents.slice(0, 3).map((a) => <Avatar key={a.id} value={a.avatar} color={a.color} size={16} />)}
                  <span className="count">{s.messageCount}</span>
                  <button className="row-icon" title="对话设置" onClick={(e) => { e.stopPropagation(); if (s.id === activeId) { setParticipantsUI({ mode: 'edit' }); } else { setActiveId(s.id); setTimeout(() => setParticipantsUI({ mode: 'edit' }), 300); } }}>⚙</button>
                  <button className="row-icon" title={s.pinned ? '取消收藏' : '收藏置顶'} onClick={(e) => togglePin(s, e)}
                    style={{ color: s.pinned ? 'var(--accent)' : undefined }}>{s.pinned ? '★' : '☆'}</button>
                  <button className="row-icon" title="删除对话" onClick={(e) => { e.stopPropagation(); setConfirmDelete({ id: s.id, title: s.title }); }}>🗑</button>
                </span>
              </div>
            );
          })}
          {!sessions.length && <div className="inline-note">{t('sidebar.empty')}</div>}
        </div>
        <div className="sidebar-section" style={{ borderTop: '1px solid var(--border)' }}>
          <button className="btn ghost" style={{ width: '100%' }} onClick={() => setShowSettings(true)}>{t('sidebar.settings')}</button>
          <button className="btn ghost" style={{ width: '100%', marginTop: 8, color: '#ff6b8a' }} onClick={() => setShowSponsor(true)}>{t('sponsor.btn')}</button>
          <div className="inline-note" style={{ marginTop: 8 }}>{connected ? t('status.connected') : t('status.connecting')}</div>
        </div>
      </aside>

      <main className="main">
        {!connected && (
          <div style={{ background: 'var(--danger)', color: '#fff', padding: '8px 16px', textAlign: 'center', fontSize: 13, fontWeight: 500 }}>
            ⚠ 与后端的连接已断开，正在自动重连… 当前操作可能不会生效。
          </div>
        )}
        <div className="topbar">
          {!activeId && <span className="inline-note">{t('top.pickSession')}</span>}
          {/* 游戏会话：显示游戏专属控制栏，不显示普通对话的成员/管理/导出 */}
          {activeId && gameState && (
            <>
              <span style={{ fontWeight: 600 }}>🐺 AI 狼人杀</span>
              <span className="inline-note">
                {gameState.status === 'running' ? '· 进行中' : gameState.status === 'finished' ? '· 已结束（可复盘/再来一局）' : ''}
              </span>
              <div className="spacer" />
              {gameState.status === 'finished' && <button className="btn sm" onClick={() => setShowWerewolf(true)}>🔄 再来一局</button>}
              {gameRunning && <button className="btn danger sm" onClick={stopGame}>■ 终止游戏</button>}
              <span style={{ position: 'relative' }}>
                <button className="btn ghost sm" onClick={() => setExportOpen((v) => !v)}>{t('top.export')}</button>
                {exportOpen && (
                  <div className="mention-menu" style={{ top: '100%', bottom: 'auto', marginTop: 6, right: 0, left: 'auto' }}>
                    <div className="item" onClick={() => { exportMarkdown({ ...session, messages }); setExportOpen(false); }}>导出为 Markdown</div>
                    <div className="item" onClick={() => { exportJSON({ ...session, messages }); setExportOpen(false); }}>导出为 JSON</div>
                  </div>
                )}
              </span>
            </>
          )}
          {/* 普通对话：原有成员栏 */}
          {activeId && !gameState && sessionAgents.length === 0 && <span className="inline-note">{t('top.noParticipants')}</span>}
          {activeId && !gameState && sessionAgents.map((a) => (
            <span key={a.id} style={{ position: 'relative', display: 'inline-flex' }}>
              <button className="agent-chip"
                title={clickToAt ? `左键: 在输入框插入 @${a.name}  |  右键: 查看信息/私聊` : `左键: 让它发言  |  右键: 查看信息/私聊`}
                onClick={() => {
                  if (clickToAt) {
                    setInput(prev => prev + `@${a.name} `);
                    document.querySelector('textarea')?.focus();
                  } else {
                    triggerAgent(a.id);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setAgentCard(a);
                }}
                disabled={!activeId}>
                <Avatar value={a.avatar} color={a.color} size={20} />
                {a.name}{a.role ? ` · ${a.role}` : ''}
                {!a.canUseTools && <span title="不写代码" style={{ opacity: 0.6 }}>💭</span>}
                <span className="model-tag" title="点击切换模型" onClick={(e) => { e.stopPropagation(); openModelMenu(a); }}>{a.model} ▾</span>
              </button>
              {modelMenuFor === a.id && (
                <div className="mention-menu" style={{ top: '100%', bottom: 'auto', marginTop: 4 }}>
                  <div className="inline-note" style={{ padding: '4px 12px' }}>切换模型：</div>
                  {(discoveredModels[a.providerId] || [a.model]).map((m) => (
                    <div key={m} className={`item ${m === a.model ? 'active' : ''}`} onClick={() => switchModel(a, m)}>{m}</div>
                  ))}
                  <div className="item" style={{ borderTop: '1px solid var(--border)' }} onClick={() => { setAdjustFor(a); setModelMenuFor(null); }}>⚙ 调整发言次数 / 职责…</div>
                  <div className="item" style={{ color: 'var(--muted)', fontSize: 12 }} onClick={() => setModelMenuFor(null)}>关闭</div>
                </div>
              )}
            </span>
          ))}
          {!gameState && <div className="spacer" />}
          {activeId && !gameState && <button className="btn ghost sm" onClick={() => setParticipantsUI({ mode: 'edit' })}>{t('top.manage')}</button>}
          {activeId && !gameState && session && (
            <span style={{ position: 'relative' }}>
              <button className="btn ghost sm" onClick={() => setExportOpen((v) => !v)}>{t('top.export')}</button>
              {exportOpen && (
                <div className="mention-menu" style={{ top: '100%', bottom: 'auto', marginTop: 6, right: 0, left: 'auto' }}>
                  <div className="item" onClick={() => { exportMarkdown({ ...session, messages }); setExportOpen(false); }}>导出为 Markdown</div>
                  <div className="item" onClick={() => { exportJSON({ ...session, messages }); setExportOpen(false); }}>导出为 JSON</div>
                </div>
              )}
            </span>
          )}
          {!gameState && sessionAgents.length > 1 && (autoRunning
            ? <button className="btn danger sm" onClick={stopAuto}>{t('top.stopAuto')}</button>
            : <button className="btn sm" onClick={startAuto} disabled={!activeId}>{t('top.autoflow')}</button>)}
        </div>

        <div className="stream-wrap">
          <div className="stream" ref={streamRef} onScroll={onStreamScroll}>
            {!activeId && <div className="empty">{t('empty.pickOrNew')}</div>}
            {activeId && !messages.length && <div className="empty">{t('empty.startHint')}</div>}
            {messages.map((m) => <Message key={m.id} m={m} mentionNames={allAgents.map((a) => a.name)} roleMap={gameState?.showIdentity ? (gameState.roles || null) : null}
              onAvatarClick={!gameState && m.authorType === 'agent' ? () => { const a = allAgents.find((x) => x.id === m.authorId); if (a) setAgentCard(a); } : null} />)}
          </div>
          {activeId && !atBottom && (
            <button className="scroll-bottom-btn" onClick={scrollToBottom}>
              ↓ {newCount > 0 ? `${newCount} 条新消息` : '回到最新'}
            </button>
          )}
        </div>

        <div className="composer" style={{ position: 'relative' }}>
          {escArmed && (
            <div className="inline-note" style={{ marginBottom: 6, color: 'var(--danger)', fontWeight: 500 }}>
              ⏹ 再按一次 <b>Esc</b> 终止本轮对话（未发言的 AI 不计入上下文）
            </div>
          )}
          {mentionMenu && (
            <div className="mention-menu" style={{ left: 16 }}>
              {mentionMenu.matches.map((a) => (
                <div key={a.id} className="item" onClick={() => pickMention(a.name)}>
                  {a.isEveryone
                    ? <><span style={{ fontSize: 18 }}>📢</span><b>{t('mention.everyone')}</b><span className="inline-note">{t('mention.everyoneHint')}</span></>
                    : <><Avatar value={a.avatar} color={a.color} size={20} />{a.name}{a.role ? ` · ${a.role}` : ''}</>}
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); if (e.key === 'Escape') setMentionMenu(null); if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); setToolMode(m => m === 'normal' ? 'auto' : 'normal'); } }}
            placeholder={activeId ? t('composer.placeholder') : t('composer.placeholderIdle')}
            disabled={!activeId}
          />
          {noTriggerHint && (
            <div style={{ marginBottom: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(124,92,255,0.12)', border: '1px solid var(--accent)', fontSize: 12, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>💡 消息已发出，但还没人回复——想让 AI 回复，请 <b>@某个成员</b>、<b>@所有人</b>，或点上方成员头像。</span>
              <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => setNoTriggerHint(false)}>✕</button>
            </div>
          )}
          {noRelay && <div className="inline-note" style={{ color: 'var(--accent)', marginBottom: 4 }}>本次输入已开启禁止自行接龙</div>}
          <div className="row" style={{ marginBottom: 6 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}
              title="勾选后，被@的AI各答一次即停，不会自动@其他AI接龙分析。持续生效直到取消。">
              <input type="checkbox" checked={noRelay} onChange={(e) => setNoRelay(e.target.checked)} />禁止AI自行接龙
            </label>
          </div>
          <div className="row">
            <button className="btn" onClick={send} disabled={!activeId || !input.trim()}>{t('composer.send')}</button>
            <button
              className={`tool-mode-btn ${toolMode === 'auto' ? 'auto' : ''}`}
              onClick={() => setToolMode(m => m === 'normal' ? 'auto' : 'normal')}
              title="切换工具确认模式 (Shift+Tab)：Normal=所有工具操作需确认 / Auto=仅高危操作需确认"
            >{toolMode === 'auto' ? '⚡ Auto' : '🛡 Normal'}</button>
            <span className="inline-note">{t('composer.hint')}</span>
          </div>
        </div>
      </main>

      {/* 私聊分屏面板 */}
      {pcActive && !pcMinimized && (
        <PrivateChatPanel
          chats={pcChats} order={pcOrder} activeId={pcActive}
          onActivate={setPcActive} onSend={pcSend} onInputChange={pcInputChange}
          onClose={pcClose} onMinimize={() => setPcMinimized(true)} onPublish={pcPublish}
          width={pcWidth} onResize={setPcWidth} />
      )}
      {/* 最小化后的悬浮球 */}
      {pcOrder.length > 0 && pcMinimized && (
        <button className="pc-ball" title="展开私聊" onClick={() => setPcMinimized(false)}>💬<span className="pc-ball-badge">{pcOrder.length}</span></button>
      )}

      {agentCard && (
        <AgentCard agent={agentCard}
          providerLabel={cleanLabel(config?.providers?.[agentCard.providerId]?.label)}
          onPrivate={openPrivateChat} onClose={() => setAgentCard(null)} />
      )}

      {showSettings && config && (
        <Settings config={config} templates={templates}
          initialTab={settingsTab}
          onClose={() => { setShowSettings(false); setClickToAt(localStorage.getItem('agora_clickToAt') !== 'false'); }}
          onChanged={refreshConfig} />
      )}

      {participantsUI && (
        <Participants
          title={participantsUI.mode === 'new' ? '选择参与新对话的 AI' : '管理本对话的参与者'}
          confirmLabel={participantsUI.mode === 'new' ? '创建对话' : '保存'}
          allAgents={allAgents}
          value={participantsUI.mode === 'edit' ? (session?.participants || []) : []}
          maxTurns={participantsUI.mode === 'edit' ? session?.maxTurnsPerRequest : 6}
          workspace={participantsUI.mode === 'edit' ? (session?.workspace || '') : ''}
          defaultWorkspace={config?.workspace || ''}
          chatOnly={session?.chatOnly || false}
          sessionTitle={session?.title}
          editMode={participantsUI?.mode === 'edit'}
          onConfirm={confirmParticipants}
          onAddMember={() => { setParticipantsUI(null); setSettingsTab('agents'); setShowSettings(true); }}
          onClose={() => setParticipantsUI(null)} />
      )}

      {showGameHub && (
        <GameHub onClose={() => setShowGameHub(false)}
          onPickWerewolf={() => { setShowGameHub(false); setShowWerewolf(true); }} />
      )}

      {showWerewolf && config && (
        <Werewolf config={config} templates={templates} onStart={startWerewolf} onClose={() => setShowWerewolf(false)} />
      )}

      {showSponsor && (
        <div className="overlay" onClick={() => setShowSponsor(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 420, textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>{t('sponsor.title')}</h2>
              <button className="icon-btn" onClick={() => setShowSponsor(false)}>✕</button>
            </div>
            <p className="inline-note" style={{ textAlign: 'left', marginTop: 12 }}>{t('sponsor.desc')}</p>
            <div style={{ margin: '16px auto', width: 200, height: 200, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <img src="/sponsor-qr.png" alt="收款码" style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }} />
              <span className="inline-note" style={{ display: 'none', padding: 12 }}>{t('sponsor.noqr')}</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--accent)' }}>{t('sponsor.perk')}</p>
            <p className="inline-note">{t('sponsor.thanks')}</p>
          </div>
        </div>
      )}

      {gameInput && (
        <div className="confirm-box" style={{ borderColor: 'var(--accent)', width: 460 }}>
          <h4 style={{ color: 'var(--accent)' }}>🎮 轮到你了</h4>
          <p style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{gameInput.prompt}</p>
          <textarea value={gameInputText} autoFocus
            onChange={(e) => setGameInputText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitGameInput(); }}
            placeholder="输入你的发言 / 选择的名字…（Ctrl+Enter 提交）"
            style={{ width: '100%', minHeight: 60, background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: 8, fontFamily: 'inherit' }} />
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={submitGameInput}>提交</button>
          </div>
        </div>
      )}

      {judgeTurn && !gameInput && (
        <JudgeConsole judgeTurn={judgeTurn} onAction={sendJudgeAction} />
      )}

      {/* 公开私聊确认 */}
      {publishConfirm && (
        <div className="overlay" onClick={() => setPublishConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 440 }}>
            <h2>公开这段私聊？</h2>
            <p className="inline-note">只会把下面这一次的问答公开到主对话，让其他 AI 看到。私聊里的其他内容不会泄漏。</p>
            <div className="card" style={{ background: 'var(--panel-2)' }}>
              {publishConfirm.userText && <p style={{ margin: '0 0 6px' }}><b>我：</b>{publishConfirm.userText}</p>}
              <p style={{ margin: 0 }}><b>{pcChats[publishConfirm.agentId]?.agent.name}：</b>{(publishConfirm.agentMsg.text || '').slice(0, 200)}</p>
            </div>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={doPublish}>确认公开</button>
              <button className="btn ghost" onClick={() => setPublishConfirm(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 私聊里的危险操作确认 */}
      {pcConfirm && (
        <div className="confirm-box">
          <h4>⚠️ 危险操作需要确认（私聊）</h4>
          <p><strong>{pcConfirm.agentName}</strong> 想执行 <code>{pcConfirm.tool}</code>：</p>
          <pre>{JSON.stringify(pcConfirm.input, null, 2)}</pre>
          <div className="btn-row">
            <button className="btn" onClick={() => answerPcConfirm(true)}>允许执行</button>
            <button className="btn ghost" onClick={() => answerPcConfirm(false)}>拒绝</button>
          </div>
        </div>
      )}

      {adjustFor && (
        <AdjustAgent agent={adjustFor} onSave={saveAdjust} onClose={() => setAdjustFor(null)} />
      )}

      {confirmDelete && (
        <div className="overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 400 }}>
            <h2>删除对话</h2>
            <p>确定要删除「<b>{confirmDelete.title}</b>」吗？此操作不可恢复。</p>
            <div className="btn-row">
              <button className="btn danger" onClick={(e) => doDelete(confirmDelete.id, e)}>确认删除</button>
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="confirm-box">
          <h4>⚠️ 危险操作需要确认</h4>
          <p><strong>{confirm.agentName}</strong> 想执行 <code>{confirm.tool}</code>：</p>
          <pre>{JSON.stringify(confirm.input, null, 2)}</pre>
          <div className="btn-row">
            <button className="btn" onClick={() => answerConfirm(true)}>允许执行</button>
            <button className="btn ghost" onClick={() => answerConfirm(false)}>拒绝</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="msg-copy-btn"
      title="复制这段内容"
      onClick={() => {
        navigator.clipboard.writeText(text || '').then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >{copied ? '✓ 已复制' : '⧉ 复制'}</button>
  );
}

function Message({ m, mentionNames, roleMap, onAvatarClick }) {
  const color = m.color || 'var(--muted)';
  const cls = m.authorType === 'user' ? 'user' : m.authorType === 'system' ? 'system' : 'agent';
  // 游戏"按身份显示"时，在作者名旁标注身份（纯前端，AI 看不到）
  const idInfo = (roleMap && m.authorType === 'agent') ? roleMap.find((r) => r.name === m.authorName) : null;
  return (
    <div className={`msg ${cls}`}>
      <div className="head">
        {m.authorType === 'agent' && <span onClick={onAvatarClick || undefined} style={{ cursor: onAvatarClick ? 'pointer' : 'default' }} title={onAvatarClick ? '点击查看名片 / 私聊' : undefined}><Avatar value={idInfo ? idInfo.emoji : m.avatar} color={color} size={24} /></span>}
        <span className="who" style={{ color: m.authorType === 'agent' ? color : undefined }}>{m.authorName || '未知'}{idInfo && <span style={{ color: 'var(--muted)', fontWeight: 400 }}>（{idInfo.role}）</span>}</span>
        {m.meta?.model && <span className="model">{m.meta.model}</span>}
      </div>
      <div className="bubble" style={{ borderLeftColor: m.authorType === 'agent' ? color : 'var(--border)' }}>
        {m.authorType === 'agent'
          ? <span className={m.meta?.streaming ? 'cursor' : ''}><Markdown text={m.text} mentionNames={mentionNames} /></span>
          : <span>{m.text || ' '}</span>}
        {/* 复制按钮：非系统消息、且输出完成（非流式）时显示在右下角 */}
        {m.authorType !== 'system' && !m.meta?.streaming && (m.text || '').trim() && (
          <div className="bubble-actions"><CopyButton text={m.text} /></div>
        )}
      </div>
    </div>
  );
}
