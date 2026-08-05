import React, { useState } from 'react';
import { Avatar } from './Settings.jsx';

// 参与者选择弹层：从全局成员池里挑谁参与本对话，并设定每人在本对话的职责限制。
// value: 当前参与者数组 [{ agentId, canUseTools, sessionPrompt }]
// allAgents: 全局成员池
// onConfirm(participants), onClose
export default function Participants({ title, allAgents, value, maxTurns, workspace, defaultWorkspace, chatOnly, sessionTitle, editMode, onConfirm, onClose, onAddMember, confirmLabel = '确定' }) {
  // 用 map 方便按 agentId 存取
  const [picked, setPicked] = useState(() => {
    const m = {};
    for (const p of value || []) m[p.agentId] = { canUseTools: p.canUseTools !== false, sessionPrompt: p.sessionPrompt || '' };
    return m;
  });
  // 第2层：本对话全场发言总上限
  const [turnCap, setTurnCap] = useState(maxTurns || 6);
  // 本对话专属工作区（空 = 用全局默认）
  const [ws, setWs] = useState(workspace || '');
  // 纯聊天模式
  const [chatOnlyVal, setChatOnlyVal] = useState(chatOnly || false);
  // 对话名称（编辑模式）
  const [titleVal, setTitleVal] = useState(sessionTitle || '');

  function toggle(id) {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = { canUseTools: true, sessionPrompt: '' };
      return next;
    });
  }
  function update(id, patch) {
    setPicked((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function confirm() {
    const list = Object.entries(picked).map(([agentId, cfg]) => ({ agentId, ...cfg }));
    onConfirm(list, { maxTurnsPerRequest: Number(turnCap) || 6, workspace: ws.trim(), chatOnly: chatOnlyVal, title: titleVal.trim() || undefined });
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>{title || '选择参与本对话的 AI'}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <p className="inline-note">勾选哪些 AI 参与这个对话。可为每个 AI 设定本对话内的职责，并决定它能否动手写代码/跑命令。</p>

        {editMode && (
          <div className="field" style={{ marginBottom: 12 }}>
            <label>对话名称</label>
            <input value={titleVal} onChange={(e) => setTitleVal(e.target.value)} placeholder="新协作" />
          </div>
        )}

        {allAgents.length === 0 && <p className="inline-note" style={{ color: 'var(--danger)' }}>成员池是空的，请先到「⚙ 设置 → AI 成员」添加。</p>}

        {allAgents.map((a) => {
          const on = Boolean(picked[a.id]);
          const cfg = picked[a.id] || {};
          return (
            <div className="card" key={a.id} style={{ outline: on ? '1.5px solid var(--accent)' : 'none' }}>
              <div className="card-head">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(a.id)} />
                  <Avatar value={a.avatar} color={a.color} size={26} />
                  <strong>{a.name}</strong>{a.role && <span className="tag">{a.role}</span>}
                </label>
                <span className="inline-note">{a.model}</span>
              </div>
              {on && (
                <div style={{ marginTop: 8, paddingLeft: 4 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={cfg.canUseTools !== false}
                      onChange={(e) => update(a.id, { canUseTools: e.target.checked })} />
                    允许它读写文件 / 执行命令（关掉 = 它只能出主意，不动代码）
                  </label>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>本对话职责（可选，仅本对话生效）</label>
                    <textarea value={cfg.sessionPrompt || ''} placeholder="如：只负责项目设计与架构，不写具体代码"
                      onChange={(e) => update(a.id, { sessionPrompt: e.target.value })} />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {onAddMember && (
          <button className="btn ghost" style={{ width: '100%', marginTop: 4 }} onClick={onAddMember}>+ 添加新成员（去设置）</button>
        )}

        <h3 style={{ marginTop: 20 }}>省 token 总闸</h3>
        <div className="field">
          <label>本对话每次请求，全场最多发言次数（1–30）</label>
          <input type="number" min="1" max="30" value={turnCap} onChange={(e) => setTurnCap(e.target.value)} />
          <span className="inline-note">自动协作时，所有 AI 加起来说到这个数就强制停，防止互相接力停不下来。</span>
        </div>

        <h3 style={{ marginTop: 20 }}>纯聊天模式</h3>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={chatOnlyVal} onChange={(e) => setChatOnlyVal(e.target.checked)} />
          禁止所有 AI 调用工具（纯聊天）
        </label>
        <p className="inline-note" style={{ margin: 0 }}>开启后，本对话中所有 AI 都不会执行文件读写或命令（如 list_dir、run_command），只会用文字回复。适合纯讨论、录视频素材。</p>

        <h3 style={{ marginTop: 20 }}>本对话工作区（可选）</h3>
        <div className="field">
          <label>AI 在本对话里读写文件的目录（留空 = 用全局默认）</label>
          <input value={ws} onChange={(e) => setWs(e.target.value)}
            placeholder={defaultWorkspace ? `留空则用：${defaultWorkspace}` : '如 C:/我的项目/对话A'} />
          <span className="inline-note">给不同对话设不同目录，就能把它们的文件操作隔开，用于不同用途。</span>
        </div>

        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={confirm}>{confirmLabel}</button>
          <button className="btn ghost" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
