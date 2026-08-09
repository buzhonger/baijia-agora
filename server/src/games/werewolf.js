// 狼人杀游戏引擎。复用 streamChat 调各家 AI；发言以消息形式写入会话，实时推给界面。
// 法官（用户）能看到全部，包括夜晚私密行动（以系统消息形式）。
import { streamChat } from '../providers.js';
import { addMessage, saveSession } from '../sessions.js';
import { loadConfig } from '../config.js';
import { ROLES, SCENARIOS } from './werewolf-presets.js';

// 正在运行的游戏：sessionId -> { controller }
const running = new Map();
export function stopGame(sessionId) {
  const r = running.get(sessionId);
  if (r) r.controller.abort();
  running.delete(sessionId);
}
export function isGameRunning(sessionId) { return running.has(sessionId); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 等待人类玩家输入的挂起请求：inputId -> resolve
const pendingHuman = new Map();
export function resolveHumanInput(inputId, text) {
  const p = pendingHuman.get(inputId);
  if (p) { pendingHuman.delete(inputId); p(text); }
}

// 向人类玩家要一次输入（发言/选人）。emit 通知前端弹出输入框，挂起直到前端回传。
function askHuman(g, emit, prompt, signal) {
  const inputId = `${g.sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return new Promise((resolve) => {
    pendingHuman.set(inputId, resolve);
    emit({ type: 'game_input_request', inputId, prompt });
    // 中止时解除挂起
    const onAbort = () => { if (pendingHuman.has(inputId)) { pendingHuman.delete(inputId); resolve(''); } };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

// 调一个玩家。人类座位走 askHuman 等你输入；AI 座位走 streamChat。
async function ask(seat, sys, userText, signal, maxTokens = 260, g = null, emit = null) {
  if (seat.isHuman && g && emit) {
    const ans = await askHuman(g, emit, userText, signal);
    return (ans || '').trim() || '(你没有发言)';
  }
  const cfg = loadConfig();
  const provider = cfg.providers[seat.providerId];
  if (!provider || !provider.apiKey) return '(该供应商未配置)';
  let out = '';
  try {
    for await (const e of streamChat({ provider, model: seat.model, system: sys,
      messages: [{ role: 'user', content: userText }], signal, maxTokens })) {
      if (e.type === 'text') out += e.text;
    }
  } catch (e) { out = `(${seat.name}出错:${String(e.message).slice(0, 50)})`; }
  return out.trim() || '(未发言)';
}

// 让 AI 在做选择的同时说出理由（供法官看其"内心"）。
// 要求它先用一句话说理由，再另起一行只写目标名字。返回 { reason, choice文本 }。
async function askWithReason(seat, sys, task, signal, g, emit) {
  const prompt = `${task}\n\n请先用1-2句话说明你的理由（你的真实想法，其他玩家看不到），然后另起一行，只写你的最终选择（一个名字或"救"/"不救"/"不用"）。格式：\n理由：xxx\n选择：xxx`;
  const ans = await ask(seat, sys, prompt, signal, 300, g, emit);
  // 解析理由和选择
  let reason = '', choice = ans;
  const rM = ans.match(/理由[：:]\s*([\s\S]*?)(?:\n|选择[：:])/);
  const cM = ans.match(/选择[：:]\s*(.+)$/m);
  if (rM) reason = rM[1].trim();
  if (cM) choice = cM[1].trim();
  else if (!rM) choice = ans; // 没按格式就整段当选择
  return { reason, choice, raw: ans };
}

// 法官指令等待：sessionId -> resolve。前端发来 judge_action 时解析。
const pendingJudge = new Map();
export function resolveJudgeAction(sessionId, action) {
  const p = pendingJudge.get(sessionId);
  if (p) p(action || { type: 'continue' });
}
function waitJudgeAction(g, signal) {
  return new Promise((resolve) => {
    pendingJudge.set(g.sessionId, (a) => { pendingJudge.delete(g.sessionId); resolve(a); });
    const onAbort = () => { if (pendingJudge.has(g.sessionId)) { pendingJudge.delete(g.sessionId); resolve({ type: 'continue' }); } };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

// 法官介入节点。node=节点标识；若该节点未勾选或用户当玩家(非法官)，直接跳过。
// 循环处理法官指令：ask(公开@提问,被问AI可拒答) / private(私聊单个或多个,仅法官可见) / continue(继续)。
async function judgePause(g, emit, signal, node, label) {
  if (g.humanRole !== 'judge') return;         // 只有法官模式才暂停给用户操作
  if (!g.pausePoints || g.pausePoints[node] !== true) return; // 仅在该节点被明确勾选时暂停
  emit({ type: 'game_judge_turn', node, label, players: alive(g).map((s) => ({ name: s.name, emoji: s.emoji })) });
  while (!signal?.aborted) {
    const action = await waitJudgeAction(g, signal);
    if (!action || action.type === 'continue') break;

    if (action.type === 'ask') {
      // 公开提问：所有玩家可见
      const target = byName(g, action.target);
      if (!target) continue;
      post(g, emit, { text: `🎤 法官问 @${target.name}：${action.text}` });
      const ans = await ask(target, roleBrief(g, target) + ' 法官当众问你一个问题，其他玩家都能看到你的回答。你可以据实回答，也可以按自身立场选择性回应或婉拒。',
        `法官问你：「${action.text}」`, signal, 200, g, emit);
      post(g, emit, { player: target, text: ans });
    } else if (action.type === 'private') {
      // 私聊一个或多个 AI：仅该 AI 与法官可见
      const targets = (action.targets || []).map((n) => byName(g, n)).filter(Boolean);
      for (const target of targets) {
        post(g, emit, { secret: true, text: `🔒 你私下问 ${target.name}：${action.text}` });
        const ans = await ask(target, roleBrief(g, target) + ' 法官私下与你交谈，其他玩家不会看到。你可以坦诚，也可以继续伪装，按你的策略回应。',
          `法官私下问你：「${action.text}」`, signal, 200, g, emit);
        post(g, emit, { secret: true, text: `🔒 ${target.name} 私下回复：${ans}` });
      }
    }
    // 处理完一条指令，继续等下一条（前端可再发 ask/private 或 continue）
    emit({ type: 'game_judge_turn', node, label, players: alive(g).map((s) => ({ name: s.name, emoji: s.emoji })) });
  }
  emit({ type: 'game_judge_done' });
}

// 自由讨论：谁想说谁说，不限顺序，每人最多发言 1 次。想说的都说完即止。
// AI 自然发言：可以反驳、拉票、@点名质问、为自己辩护等，发言进入公开记录并影响后续投票。
async function freeDiscussion(g, emit, signal, log) {
  post(g, emit, { text: '💬 进入自由讨论：玩家可以互相质问、反驳、拉票、为自己辩护。' });
  const spoke = new Set();
  let anySpoke = true;
  const firstDay = g.round <= 1;
  const dayNotice = firstDay ? '【注意】今天是第1天白天，不存在"昨天白天"——请勿引用不存在的昨日白天内容。\n' : '';
  for (let round = 0; round < 2 && anySpoke; round++) {
    anySpoke = false;
    for (const p of alive(g)) {
      if (signal?.aborted) return;
      if (spoke.has(p.name)) continue;
      const others = alive(g).filter((x) => x.name !== p.name).map((x) => x.name).join('、');
      const hint = p._seerNote ? ` （只有你知道：${p._seerNote}）` : '';
      const speech = await ask(p,
        roleBrief(g, p) + hint + ` 现在是自由讨论环节。你可以质疑、反驳、拉票、为自己辩护，也可以用「@名字」直接点名质问某人。其他存活玩家：${others}。`,
        `${dayNotice}【当前公开记录】\n${log()}\n\n如果此刻发言对你的处境有利，就说一段有立场的话（1-3句，可以针对具体某人）。如果你认为保持沉默更好，只回复"过"。`,
        signal, 240, g, emit);
      const s = (speech || '').trim();
      // 只回"过"/"沉默"等，视为不发言
      if (!s || /^(过|沉默|不发言|pass|skip|略过)[。.!！]?$/i.test(s)) continue;
      post(g, emit, { player: p, text: s });
      spoke.add(p.name);
      anySpoke = true;
      await sleep(120);
    }
  }
}

// 角色的私有设定（其他玩家看不到）
function roleBrief(g, seat) {
  const r = ROLES[seat.role];
  const names = g.seats.map((s) => s.name).join('、');
  let s = `你在玩狼人杀。你的名字「${seat.name}」，全场玩家：${names}。你的身份是【${r.name}】：${r.desc}`;
  if (seat.role === 'wolf') {
    const mates = g.seats.filter((x) => x.role === 'wolf' && x.name !== seat.name).map((x) => x.name);
    s += ` 你的狼队友：${mates.join('、') || '无'}。目标：隐藏身份、误导好人、票出好人。`;
    if (mates.length) s += ` 你和狼队友互相认识，可以在白天发言中暗中配合、呼应，但要伪装成好人；你们夜间密谋的内容只有狼队自己知道。`;
  } else {
    s += ' 目标：找出并票出所有狼人。';
  }
  s += ' 发言简短有立场（2-3句），像真人玩家，不要暴露这是AI。';
  s += ' 【日夜规则·严格遵守】'
    + '①夜晚没有公开发言：白天才是公开发言环节，夜晚各玩家静默执行角色行动，不存在"今晚某人公开说了什么""昨晚的发言"这类说法——夜晚没有可被所有人听到的发言。'
    + '（唯一例外：狼人互相认识，知道自己队内的夜间密谋，可以据此在白天行动；但其他非狼玩家绝无此特权。）'
    + '②夜晚行动对外私密：你看不到也听不到其他玩家的夜间行动，白天不能说"昨晚观察到/感觉到某人的行为"——你不可能知道。'
    + '③发言只依据：白天公开发言 + 法官公布的死亡结果，其余不知道。';
  return s;
}

// helpers
const alive = (g) => g.seats.filter((s) => s.alive);
const aliveWolves = (g) => alive(g).filter((s) => s.role === 'wolf');
const aliveGoods = (g) => alive(g).filter((s) => s.role !== 'wolf');
const byName = (g, n) => g.seats.find((s) => s.name === n);
// 从 AI 回复里挑一个候选名字
function pickName(text, candidates) {
  for (const c of candidates) if (text && text.includes(c.name)) return c;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// 给默认颜色/头像
const SEAT_COLORS = ['#e05c5c', '#5c9ce0', '#5ce0a4', '#e0c14e', '#a45ce0', '#e05ca0', '#5ce0e0', '#e0855c', '#8ae05c', '#5c6ce0', '#e05cc1', '#b0b0b0'];

// 用配置发起一局。config: { scenario, seats:[{name,providerId,model,role}] }
// 若 seats 未指定 role，则按场次自动分配。
function buildGame(session, gameConfig) {
  const scen = SCENARIOS[gameConfig.scenario] || SCENARIOS.novice6;
  const seats = (gameConfig.seats || []).slice(0, scen.count);
  const humanSeat = (gameConfig.myRole === 'player') ? (gameConfig.mySeat ?? -1) : -1;
  // 洗牌角色分配
  const roleKeys = [...scen.roles];
  for (let i = roleKeys.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [roleKeys[i], roleKeys[j]] = [roleKeys[j], roleKeys[i]]; }
  const g = {
    sessionId: session.id, session, scenario: scen, round: 0,
    humanRole: gameConfig.myRole || 'judge', // judge=你旁观 | player=你占一个座位
    seats: seats.map((s, i) => {
      const role = s.role || roleKeys[i];
      // name 始终用真名（进 AI 上下文/公开记录，绝不能含身份，否则泄漏）。
      // 身份标注/角色头像只在前端按 showIdentity 显示。
      return {
        name: (i === humanSeat) ? (s.name && s.name !== `玩家${i + 1}` ? s.name : '你') : (s.name || `玩家${i + 1}`),
        isHuman: i === humanSeat,
        providerId: s.providerId, model: s.model,
        role,
        alive: true, color: SEAT_COLORS[i % SEAT_COLORS.length],
        emoji: (i === humanSeat) ? '🧑' : '👤', // 统一中性头像，避免从头像泄漏身份
      };
    }),
    witch: { heal: true, poison: true }, // 女巫药剂
    lastGuard: null,                       // 守卫上一晚守护对象
    showIdentity: Boolean(gameConfig.showIdentity),
    pausePoints: gameConfig.pausePoints || { night: true, daySpeech: true, freeTalk: true, beforeVote: true, death: true },
  };
  return g;
}

// 往会话里写一条消息并广播。kind: 'judge'(法官/系统) | 'player'
function post(g, emit, { player, text, secret }) {
  const msg = addMessage(g.session, player
    ? { authorType: 'agent', authorId: player.name, authorName: player.name, color: player.color, avatar: player.emoji, text, meta: { model: player.model, game: true } }
    : { authorType: 'system', authorName: '🎭 法官', text, meta: { secret: Boolean(secret) } });
  emit({ type: 'message_added', message: msg });
  return msg;
}

// 夜晚：守卫→狼刀→女巫→预言家，返回本晚真正死亡的玩家数组
async function nightPhase(g, emit, signal) {
  post(g, emit, { text: `🌙 第 ${g.round} 夜降临，天黑请闭眼。` });
  let guarded = null;
  const firstNight = g.round <= 1;
  // 夜晚共享的局势说明：首夜明确"还没有白天"，避免各角色编造不存在的白天信息
  const nightCtx = firstNight
    ? '现在是第 1 夜，游戏刚开始，白天尚未到来，没有任何发言记录，请勿提及任何"白天表现"。'
    : `当前是第 ${g.round} 夜，此前已经历若干轮白天讨论。`;

  // 守卫
  const guard = alive(g).find((s) => s.role === 'guard');
  if (guard) {
    const targets = alive(g).filter((s) => s.name !== g.lastGuard);
    const { reason, choice } = await askWithReason(guard, roleBrief(g, guard) + ' 现在是夜晚，只有你能看到。',
      `${nightCtx}\n你要守护一人免遭狼刀（不能连守同一人；上晚守了：${g.lastGuard || '无'}）。存活：${targets.map((t) => t.name).join('、')}。守护谁？`, signal, g, emit);
    guarded = pickName(choice, targets);
    g.lastGuard = guarded.name;
    if (reason) post(g, emit, { secret: true, text: `🛡️ 守卫（${guard.name}）想法：${reason}` });
    post(g, emit, { secret: true, text: `🛡️ 守卫守护了 ${guarded.name}` });
  }

  // 狼刀
  let killed = null;
  const wolves = aliveWolves(g);
  const preys = aliveGoods(g);
  if (wolves.length && preys.length) {
    const lead = wolves[0];
    const mateNames = wolves.slice(1).map((w) => w.name).join('、');
    // 给狼队真实的局势上下文：公开发言记录（首夜为空则明确告知），避免 AI 凭空编造"白天表现"
    const publicLog = g.session.messages
      .filter((m) => m.meta?.game || (m.authorType === 'system' && !m.meta?.secret))
      .map((m) => `${m.authorName}: ${m.text}`).slice(-30).join('\n');
    const firstNight = g.round <= 1;
    const context = firstNight
      ? '现在是第 1 天夜晚，游戏刚开始，白天还没到来，没有任何人发过言，你手里没有任何白天信息，只能凭身份和位置判断。'
      : `当前是第 ${g.round} 夜。以下是目前为止的公开记录（白天的发言与投票）：\n${publicLog || '（无）'}`;
    const task = `${context}\n\n存活好人：${preys.map((t) => t.name).join('、')}。\n`
      + `请作为狼队代表思考今晚的击杀策略：可以考虑刀谁威胁最大（如可能的预言家/女巫）、要不要打保守刀、甚至是否自刀骗信任。`
      + (firstNight ? '注意：这是第一夜，不要提及任何"白天发言/表现"之类不存在的信息。' : '')
      + '\n最后决定击杀一人。';
    const { reason, choice } = await askWithReason(lead,
      roleBrief(g, lead) + ` 现在是夜晚，只有你和狼队友(${mateNames || '无'})能看到你的思考。`,
      task, signal, g, emit);
    killed = pickName(choice, preys);
    if (reason) post(g, emit, { secret: true, text: `🐺 狼队（${wolves.map((w) => w.name).join('、')}）密谋：${reason}` });
    post(g, emit, { secret: true, text: `🐺 狼队决定击杀 ${killed.name}` });
  }

  // 守卫挡刀
  if (killed && guarded && killed.name === guarded.name) {
    post(g, emit, { secret: true, text: `🛡️ ${killed.name} 被守卫守护，狼刀无效！` });
    killed = null;
  }

  const deaths = [];
  // 女巫
  const witch = alive(g).find((s) => s.role === 'witch');
  if (witch) {
    // 解药：救今晚被刀的人
    if (killed && g.witch.heal) {
      const { reason, choice } = await askWithReason(witch, roleBrief(g, witch) + ' 现在是夜晚，只有你能看到。',
        `今晚 ${killed.name} 被狼击杀。你还有一瓶解药，要救他吗？`, signal, g, emit);
      if (reason) post(g, emit, { secret: true, text: `🧪 女巫（${witch.name}）想法：${reason}` });
      if (choice.includes('救') && !choice.includes('不救')) {
        g.witch.heal = false;
        post(g, emit, { secret: true, text: `🧪 女巫用解药救了 ${killed.name}` });
        killed = null;
      }
    }
    // 毒药
    if (g.witch.poison) {
      const others = alive(g).filter((s) => s.name !== witch.name && (!killed || s.name !== killed.name));
      if (others.length) {
        const { reason, choice } = await askWithReason(witch, roleBrief(g, witch) + ' 现在是夜晚，只有你能看到。',
          `你还有一瓶毒药。要毒谁吗？存活：${others.map((o) => o.name).join('、')}。（不想用就选"不用"）`, signal, g, emit);
        if (!choice.includes('不用')) {
          const poisoned = others.find((o) => choice.includes(o.name));
          if (poisoned) { g.witch.poison = false; poisoned._poisoned = true; deaths.push(poisoned);
            if (reason) post(g, emit, { secret: true, text: `🧪 女巫（${witch.name}）想法：${reason}` });
            post(g, emit, { secret: true, text: `🧪 女巫对 ${poisoned.name} 使用了毒药` }); }
        }
      }
    }
  }
  if (killed) deaths.push(killed);
  // 关键：把本晚所有死者真正标记为出局，否则白天仍会被当活人叫去发言
  for (const d of deaths) d.alive = false;

  // 预言家验人
  const seer = alive(g).find((s) => s.role === 'seer');
  if (seer) {
    const others = alive(g).filter((s) => s.name !== seer.name);
    const { reason, choice } = await askWithReason(seer, roleBrief(g, seer) + ' 现在是夜晚，只有你能看到。',
      `${nightCtx}\n你要查验谁的身份？存活：${others.map((o) => o.name).join('、')}。`, signal, g, emit);
    const pick = pickName(choice, others);
    const res = pick.role === 'wolf' ? '狼人' : '好人';
    seer._seerNote = (seer._seerNote || '') + `第${g.round}夜查验【${pick.name}】=【${res}】。`;
    if (reason) post(g, emit, { secret: true, text: `🔮 预言家（${seer.name}）想法：${reason}` });
    post(g, emit, { secret: true, text: `🔮 预言家查验 ${pick.name} → ${res}` });
  }

  return deaths;
}

// 猎人开枪：被放逐或被狼杀（非毒杀）时触发
async function hunterShoot(g, emit, signal, hunter, reason) {
  if (hunter._poisoned) { post(g, emit, { text: `🔫 ${hunter.name} 是猎人，但被毒杀无法开枪。` }); return; }
  const targets = alive(g).filter((s) => s.name !== hunter.name);
  if (!targets.length) return;
  const ans = await ask(hunter, roleBrief(g, hunter),
    `你是猎人，你${reason}了，现在可以开枪带走一人。存活：${targets.map((t) => t.name).join('、')}。只回复一个名字。`, signal, 30, g, emit);
  const shot = pickName(ans, targets);
  shot.alive = false;
  post(g, emit, { text: `🔫 猎人 ${hunter.name} 开枪带走了 ${shot.name}（身份：${ROLES[shot.role].name}）` });
  if (shot.role === 'hunter') await hunterShoot(g, emit, signal, shot, '被带走');
}

// 公开发言 + 投票放逐
async function dayPhase(g, emit, signal, deaths) {
  const log = () => g.session.messages.filter((m) => m.meta?.game || (m.authorType === 'system' && !m.meta?.secret)).map((m) => `${m.authorName}: ${m.text}`).slice(-40).join('\n');
  post(g, emit, { text: `☀️ 第 ${g.round} 天亮了。${deaths.length ? `昨晚倒下的是：${deaths.map((d) => d.name).join('、')}。` : '昨晚是平安夜。'}` });

  // 死者若是猎人（被狼杀），开枪 + 遗言
  for (const d of deaths) {
    await lastWords(g, emit, signal, d, log, '昨晚死亡');
    if (d.role === 'hunter') await hunterShoot(g, emit, signal, d, '被击杀');
  }
  if (deaths.length) { const w = checkWin(g); if (w) return; }
  // "夜晚行动后"节点：天亮、死讯公布后暂停（此时 AI 才看得到昨晚情况）
  await judgePause(g, emit, signal, 'night', deaths.length ? '天亮·有人死亡' : '天亮·平安夜');

  // 第一轮固定发言：每人依次说一次
  const firstDay = g.round <= 1;
  const dayNotice = firstDay
    ? '【注意】今天是第1天白天，这是整局游戏的第一次白天发言。之前没有任何"昨天白天"——那完全不存在，绝对不要提及或引用不存在的"上一轮白天发言/行为"。你只知道昨晚法官公布的死亡结果。\n'
    : '';
  for (const p of alive(g)) {
    if (signal?.aborted) return;
    const hint = p._seerNote ? ` （只有你知道：${p._seerNote}）` : '';
    const speech = await ask(p, roleBrief(g, p) + hint,
      `${dayNotice}【当前公开记录】\n${log()}\n\n轮到你发言，根据以上公开信息说出你的怀疑和理由（2-3句）。`, signal, 260, g, emit);
    post(g, emit, { player: p, text: speech });
    await sleep(120);
  }
  await judgePause(g, emit, signal, 'daySpeech', '白天发言后');

  // 自由讨论（谁想说谁说，每人最多1次）
  await freeDiscussion(g, emit, signal, log);
  await judgePause(g, emit, signal, 'freeTalk', '自由讨论后');

  await judgePause(g, emit, signal, 'beforeVote', '投票前');

  // 投票（匿名心理：投票不公布被放逐者身份）
  post(g, emit, { text: '🗳️ 进入投票，请各位指认最可疑的人。' });
  const tally = {};
  for (const p of alive(g)) {
    if (signal?.aborted) return;
    const others = alive(g).filter((x) => x.name !== p.name);
    const ans = await ask(p, roleBrief(g, p),
      `【公开记录】\n${log()}\n\n投票放逐一人。存活：${others.map((o) => o.name).join('、')}。只回复一个名字。`, signal, 24, g, emit);
    const t = pickName(ans, others);
    tally[t.name] = (tally[t.name] || 0) + 1;
    post(g, emit, { text: `　${p.name} 投给了 ${t.name}` });
  }
  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const exiled = byName(g, sorted[0][0]);
  exiled.alive = false;
  // 不公布身份，只说被放逐
  post(g, emit, { text: `📢 投票结果：${sorted.map(([n, c]) => `${n} ${c}票`).join('，')}。${exiled.name} 被放逐出局。` });
  await lastWords(g, emit, signal, exiled, log, '被投票放逐');
  if (exiled.role === 'hunter') await hunterShoot(g, emit, signal, exiled, '被放逐');
}

// 遗言：出局者留遗言，由它自己决定怎么说（浑水摸鱼/报身份/带节奏都行，身份不强制公开）
async function lastWords(g, emit, signal, dead, log, how) {
  if (!dead) return;
  const speech = await ask(dead, roleBrief(g, dead) + ` 你${how}，现在是你的遗言时间。直接说遗言内容，不要加"遗言"二字前缀。`,
    `【公开记录】\n${log()}\n\n你已经出局，可以留一句遗言。你可以选择表明身份、给好人留线索、或继续伪装浑水摸鱼——完全按你的策略来。也可以简短告别。`, signal, 200, g, emit);
  const clean = (speech || '').replace(/^【?遗言】?[:：]?\s*/g, '').trim();
  post(g, emit, { player: dead, text: `【遗言】${clean}` });
}

function checkWin(g) {
  const w = aliveWolves(g).length;
  const good = aliveGoods(g).length;
  if (w === 0) return 'good';
  if (w >= good) return 'wolf';
  return null;
}

// 主流程
async function runGame(session, gameConfig, emit) {
  if (running.has(session.id)) { emit({ type: 'system_note', text: '已有游戏在进行。' }); return; }
  const controller = new AbortController();
  running.set(session.id, { controller });
  try {
    const g = buildGame(session, gameConfig);
    // 给会话打游戏标记，前端据此渲染游戏专属控制栏（而非普通对话的"管理参与者"等）
    session.game = { type: 'werewolf', status: 'running', scenario: g.scenario.key, humanRole: g.humanRole,
      showIdentity: g.showIdentity,
      // 身份对照表（供前端"按身份显示"用；法官模式本就可见身份，玩家模式前端应只显示自己的）
      roles: g.showIdentity ? g.seats.map((s) => ({ name: s.name, role: ROLES[s.role].name, emoji: ROLES[s.role].emoji })) : null };
    saveSession(session);
    emit({ type: 'game_state', game: session.game });
    post(g, emit, { text: `🎭 ${g.scenario.name} 开局！玩家：${g.seats.map((s) => s.name).join('、')}。祝好运。` });
    // 身份表只给法官看（secret）
    post(g, emit, { secret: true, text: `【身份表·仅法官可见】\n${g.seats.map((s) => `${s.name}（${s.model}）= ${ROLES[s.role].name}`).join('\n')}` });

    let winner = null;
    while (!winner && g.round < 8 && !controller.signal.aborted) {
      g.round += 1;
      const deaths = await nightPhase(g, emit, controller.signal);
      winner = checkWin(g); if (winner || controller.signal.aborted) break;
      // 暂停节点在 dayPhase 内、天亮公布死讯之后（此时 AI 才看得到昨晚情况，问它们才有意义）
      await dayPhase(g, emit, controller.signal, deaths);
      winner = checkWin(g);
    }
    if (!controller.signal.aborted) {
      post(g, emit, { text: winner === 'good' ? '🏆 好人阵营胜利！所有狼人已出局。' : winner === 'wolf' ? '🏆 狼人阵营胜利！' : '游戏结束（达到回合上限）。' });
      post(g, emit, { text: `📜 全场身份揭晓：\n${g.seats.map((s) => `${s.name} = ${ROLES[s.role].name}${s.alive ? '（存活）' : ''}`).join('\n')}` });
      post(g, emit, { text: '——本局结束。你可以继续和 AI 们复盘这局、聊聊心得，或点上方「🔄 再来一局」。' });
      session.game = { type: 'werewolf', status: 'finished', scenario: g.scenario.key, humanRole: g.humanRole,
        seats: g.seats.map((s) => ({ name: s.name, role: s.role, providerId: s.providerId, model: s.model, alive: s.alive, color: s.color, emoji: s.emoji })),
        winner };
      saveSession(session);
      emit({ type: 'game_state', game: session.game });
    } else {
      // 玩家手动终止：仍输出结局揭示，让 AI 可以复盘已发生的内容（只能看到终止前已输出的信息）
      post(g, emit, { text: `🏳️ 本局游戏已终止（进行至第 ${g.round} 轮）。` });
      post(g, emit, { text: `📜 身份揭晓：\n${g.seats.map((s) => `${s.name} = ${ROLES[s.role].name}${s.alive ? '（存活）' : '（已出局）'}`).join('\n')}` });
      post(g, emit, { text: '——复盘时 AI 只能看到终止前已输出的内容。可点「🔄 再来一局」重开。' });
      session.game = { type: 'werewolf', status: 'finished', scenario: g.scenario.key, humanRole: g.humanRole,
        seats: g.seats.map((s) => ({ name: s.name, role: s.role, providerId: s.providerId, model: s.model, alive: s.alive, color: s.color, emoji: s.emoji })),
        winner: null };
      saveSession(session);
      emit({ type: 'game_state', game: session.game });
    }
    emit({ type: 'game_over', sessionId: session.id, winner: winner || null });
  } finally {
    running.delete(session.id);
    saveSession(session);
  }
}

export { ask, roleBrief, alive, aliveWolves, aliveGoods, byName, pickName, running, sleep, buildGame, post, nightPhase, dayPhase, checkWin, runGame };
