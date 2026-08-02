import React, { useRef, useEffect } from 'react';
import { Avatar } from './Settings.jsx';
import Markdown from './Markdown.jsx';

// 私聊面板：右侧分屏。标签条切换多个私聊，左边缘可拖拽调宽，×关当前、−最小化全部。
// props:
//  chats: { [agentId]: { agent, messages, input } }
//  order: agentId[]（标签顺序）
//  activeId, onActivate(id)
//  onSend(agentId, text), onInputChange(agentId, text)
//  onClose(agentId), onMinimize()
//  onPublish(agentId, agentMsg) 公开某条回复
//  width(%), onResize(pct)
export default function PrivateChatPanel({ chats, order, activeId, onActivate, onSend, onInputChange, onClose, onMinimize, onPublish, width, onResize }) {
  const streamRef = useRef(null);
  const active = chats[activeId];

  useEffect(() => { const el = streamRef.current; if (el) el.scrollTop = el.scrollHeight; }, [active?.messages]);

  // 左边缘拖拽调宽
  function startDrag(e) {
    e.preventDefault();
    const onMove = (ev) => {
      const pct = ((window.innerWidth - ev.clientX) / window.innerWidth) * 100;
      onResize(Math.max(25, Math.min(70, pct)));
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  }

  if (!active) return null;

  return (
    <div className="pc-panel" style={{ width: `${width}%` }}>
      <div className="pc-drag" onMouseDown={startDrag} title="拖拽调整宽度" />
      {/* 标签条 */}
      <div className="pc-tabs">
        {order.map((id) => {
          const c = chats[id]; if (!c) return null;
          return (
            <div key={id} className={`pc-tab ${id === activeId ? 'active' : ''}`} onClick={() => onActivate(id)}>
              <Avatar value={c.agent.avatar} color={c.agent.color} size={16} />
              <span className="pc-tab-name">{c.agent.name}</span>
              <span className="pc-tab-x" onClick={(e) => { e.stopPropagation(); onClose(id); }}>✕</span>
            </div>
          );
        })}
        <div className="spacer" />
        <button className="btn ghost sm pc-minimize-btn" title="最小化全部私聊（折叠为悬浮球）" onClick={onMinimize}>⊟ 最小化</button>
      </div>

      {/* 消息流 */}
      <div className="pc-stream" ref={streamRef}>
        <div className="inline-note" style={{ textAlign: 'center', padding: 8 }}>
          🔒 与 {active.agent.name} 的私聊，其他 AI 看不到。它能看到主对话全部内容。
        </div>
        {(active.messages || []).map((m) => (
          <PcMessage key={m.id} m={m} agent={active.agent} onPublish={onPublish} />
        ))}
      </div>

      {/* 输入区 */}
      <div className="pc-composer">
        <textarea value={active.input || ''}
          onChange={(e) => onInputChange(activeId, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSend(activeId, active.input || ''); }}
          placeholder={`私聊 ${active.agent.name}…（Ctrl+Enter 发送）`} />
        <button className="btn" onClick={() => onSend(activeId, active.input || '')} disabled={!(active.input || '').trim()}>发送</button>
      </div>
    </div>
  );
}

function PcMessage({ m, agent, onPublish }) {
  const isUser = m.role === 'user';
  const isSystem = m.role === 'system';
  const color = agent.color || 'var(--muted)';
  return (
    <div className={`msg ${isUser ? 'user' : isSystem ? 'system' : 'agent'}`}>
      <div className="head">
        {!isUser && !isSystem && <Avatar value={agent.avatar} color={color} size={20} />}
        <span className="who" style={{ color: !isUser && !isSystem ? color : undefined }}>{isUser ? '我' : isSystem ? '系统' : agent.name}</span>
      </div>
      <div className="bubble" style={{ borderLeftColor: !isUser && !isSystem ? color : 'var(--border)' }}>
        {!isUser && !isSystem
          ? <span className={m.meta?.streaming ? 'cursor' : ''}><Markdown text={m.text} /></span>
          : <span>{m.text || ' '}</span>}
      </div>
      {/* AI 回复下方的"公开到主对话"图标 */}
      {!isUser && !isSystem && !m.meta?.streaming && m.text && (
        <button className="pc-publish" onClick={() => onPublish(agent.id, m)} title="公开这段到主对话">📢 公开给其他成员</button>
      )}
    </div>
  );
}
