// 自动协作：让多个 agent 按顺序接力发言，形成"规划→写码→审查→修改"的协作链。
// 每个 agent 都能看到前面所有人（包括其他 AI）的发言，因为共享同一条对话流。
import { runAgentTurn } from './orchestrator.js';
import { addMessage, removeMessage } from './sessions.js';

// 判断是否是"跳过"信号（没有实质内容，自动协作可以跳过）
function isPassReply(text) {
  const t = (text || '').trim();
  if (!t) return true; // 空回复也视为跳过
  if (t.length >= 60) return false; // 超过60字必然有实质内容
  return /^(过|pass|skip|略过|暂无补充|无需补充|没有补充|没有新内容|无新内容|已充分|同意以上|不需要补充|无需发言)[\s。.！!?？]*$/i.test(t);
}

// 正在运行的自动流：sessionId -> { abort }
const running = new Map();

export function stopAutoFlow(sessionId) {
  const r = running.get(sessionId);
  if (r) r.controller.abort();
  running.delete(sessionId);
}

export function isAutoFlowRunning(sessionId) {
  return running.has(sessionId);
}

// order: agent id 数组，定义接力顺序
// 三层限制在这里落地：
//   第1层 每人 maxRepliesPerRound：单个成员在这次自动协作里最多发言几次
//   第2层 session.maxTurnsPerRequest：全场（所有成员加起来）最多发言几次，硬上限
export async function runAutoFlow({ session, agents, order, emit, toolMode = 'normal' }) {
  if (running.has(session.id)) {
    emit({ type: 'system_note', text: '已有自动协作在运行中。' });
    return;
  }
  const controller = new AbortController();
  running.set(session.id, { controller });

  const byId = new Map(agents.map((a) => [a.id, a]));
  const globalCap = session.maxTurnsPerRequest || 6; // 第2层
  const spoken = new Map(); // agentId -> 已发言次数
  let totalTurns = 0;

  try {
    // 轮询接力：一圈一圈过 order，谁还有配额谁就说；某圈没人发言 或 触顶 就停
    let progressed = true;
    while (progressed && !controller.signal.aborted) {
      progressed = false;
      for (const agentId of order) {
        if (controller.signal.aborted) break;
        const agent = byId.get(agentId);
        if (!agent || agent.enabled === false) continue;

        const quota = agent.maxRepliesPerRound || 1;   // 第1层
        const used = spoken.get(agentId) || 0;
        if (used >= quota) continue; // 这个成员配额用完，跳过

        if (totalTurns >= globalCap) {                 // 第2层硬上限
          const note = addMessage(session, {
            authorType: 'system', authorName: '系统',
            text: `⏹ 已达本次请求的全场发言上限（${globalCap} 次），自动停止以节省 token。`,
          });
          emit({ type: 'message_added', message: note });
          controller.abort();
          break;
        }

        const note = addMessage(session, {
          authorType: 'system', authorName: '系统',
          text: `▶ 轮到「${agent.name}」${agent.role ? `（${agent.role}）` : ''}（第 ${used + 1}/${quota} 次）`,
        });
        emit({ type: 'message_added', message: note });

        const produced = await runAgentTurn({ session, agent, emit, signal: controller.signal, inAutoflow: true, toolMode });

        // 检测"过"跳过信号——AI 认为没有实质内容要补充，直接跳过本轮、不消耗配额
        if (produced && isPassReply(produced.text)) {
          // 撤回"▶ 轮到..."提示和 AI 的"过"回复，避免污染对话流
          removeMessage(session, note.id);
          removeMessage(session, produced.id);
          emit({ type: 'message_retract', messageId: note.id });
          emit({ type: 'message_retract', messageId: produced.id });
          // 不计入配额，不标记为 progressed，继续下一个成员
          continue;
        }

        spoken.set(agentId, used + 1);
        totalTurns += 1;
        progressed = true;
      }
    }
    emit({ type: 'autoflow_done', sessionId: session.id });
  } finally {
    running.delete(session.id);
  }
}
