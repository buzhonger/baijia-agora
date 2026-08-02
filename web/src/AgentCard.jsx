import React from 'react';
import { Avatar } from './Settings.jsx';
import { cleanLabel } from './utils.js';

// 成员名片：点头像弹出，显示 头像/名字/角色/模型 四项 + 私聊按钮。
// agent: 成员对象；providerLabel: 供应商名（已 cleanLabel）；onPrivate: 开私聊；onClose
export default function AgentCard({ agent, providerLabel, onPrivate, onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 320 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <Avatar value={agent.avatar} color={agent.color} size={64} />
          <div style={{ fontSize: 18, fontWeight: 600, color: agent.color }}>{agent.name}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', marginTop: 4 }}>
            <Row label="角色" value={agent.role || '未设定'} />
            <Row label="模型" value={agent.model} />
          </div>
          <button className="btn" style={{ width: '100%', marginTop: 10 }} onClick={() => onPrivate(agent)}>💬 私聊</button>
          <button className="btn ghost sm" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 8px', background: 'var(--panel-2)', borderRadius: 6 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
