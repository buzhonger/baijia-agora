import React, { useState } from 'react';
import { Avatar } from './Settings.jsx';

// 对话进行中，实时调整某个 AI 成员的发言限制与职责。改完即时生效。
// agent 带了本对话的 canUseTools / sessionPrompt（来自 sessionAgents）。
export default function AdjustAgent({ agent, onSave, onClose }) {
  const [maxReplies, setMaxReplies] = useState(agent.maxRepliesPerRound || 1);
  const [maxTokens, setMaxTokens] = useState(agent.maxTokens || 2048);
  const [canUseTools, setCanUseTools] = useState(agent.canUseTools !== false);
  const [sessionPrompt, setSessionPrompt] = useState(agent.sessionPrompt || '');

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar value={agent.avatar} color={agent.color} size={26} /> 调整「{agent.name}」
          </h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <p className="inline-note">对话进行中随时改，保存后立刻生效。适合分阶段调节：比如前期让设计师多说、中期让程序员多说。</p>

        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>每轮最多发言次数（1–10）</label>
            <input type="number" min="1" max="10" value={maxReplies} onChange={(e) => setMaxReplies(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>单次回复最长 token（256–8192）</label>
            <input type="number" min="256" max="8192" step="256" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0 12px', fontSize: 13 }}>
          <input type="checkbox" checked={canUseTools} onChange={(e) => setCanUseTools(e.target.checked)} />
          允许它在本对话读写文件 / 执行命令（关掉 = 只出主意，不动代码）
        </label>

        <div className="field">
          <label>本对话职责（仅本对话生效，可随阶段修改）</label>
          <textarea value={sessionPrompt} placeholder="如：现阶段你主导架构设计，多发表意见"
            onChange={(e) => setSessionPrompt(e.target.value)} />
        </div>

        <div className="btn-row">
          <button className="btn" onClick={() => onSave(agent, {
            maxRepliesPerRound: Number(maxReplies) || 1,
            maxTokens: Number(maxTokens) || 2048,
            canUseTools, sessionPrompt,
          })}>保存并生效</button>
          <button className="btn ghost" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
