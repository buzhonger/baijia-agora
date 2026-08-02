import React, { useState } from 'react';

// 法官控制台：狼人杀节点暂停时弹出，法官可 @公开提问 / 私聊一或多个 AI / 继续推进。
// judgeTurn: { node, label, players:[{name,emoji}] }
// onAction(action)  action: {type:'ask',target,text} | {type:'private',targets:[],text} | {type:'continue'}
export default function JudgeConsole({ judgeTurn, onAction }) {
  const [mode, setMode] = useState('ask'); // 'ask' 公开提问单个 | 'private' 私聊多个
  const [target, setTarget] = useState('');       // ask 模式：被问的人
  const [targets, setTargets] = useState([]);      // private 模式：私聊对象们
  const [text, setText] = useState('');

  const players = judgeTurn.players || [];

  function toggleTarget(name) {
    setTargets((t) => t.includes(name) ? t.filter((x) => x !== name) : [...t, name]);
  }
  function submit() {
    if (!text.trim()) return;
    if (mode === 'ask') {
      if (!target) return;
      onAction({ type: 'ask', target, text: text.trim() });
    } else {
      if (!targets.length) return;
      onAction({ type: 'private', targets, text: text.trim() });
    }
    setText('');
  }

  return (
    <div className="confirm-box" style={{ borderColor: 'var(--accent)', width: 500 }}>
      <h4 style={{ color: 'var(--accent)' }}>🎭 法官时间 · {judgeTurn.label}</h4>
      <p className="inline-note">公开@提问：所有 AI 可见。私聊：仅所选 AI 可见，其他人不知情。完成后点「继续游戏」。</p>

      <div className="btn-row" style={{ marginBottom: 8 }}>
        <button className={`btn ${mode === 'ask' ? '' : 'ghost'} sm`} onClick={() => setMode('ask')}>公开@提问</button>
        <button className={`btn ${mode === 'private' ? '' : 'ghost'} sm`} onClick={() => setMode('private')}>私聊（可多人）</button>
      </div>

      {mode === 'ask' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {players.map((p) => (
            <button key={p.name} className="btn ghost sm" onClick={() => setTarget(p.name)}
              style={{ background: target === p.name ? 'var(--accent)' : undefined }}>{p.emoji} {p.name}</button>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {players.map((p) => (
            <button key={p.name} className="btn ghost sm" onClick={() => toggleTarget(p.name)}
              style={{ background: targets.includes(p.name) ? 'var(--accent)' : undefined }}>{targets.includes(p.name) ? '✓ ' : ''}{p.emoji} {p.name}</button>
          ))}
        </div>
      )}

      <textarea value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
        placeholder={mode === 'ask' ? '当众问他的问题…（Ctrl+Enter 发送）' : '私下问他们的问题…（Ctrl+Enter 发送）'}
        style={{ width: '100%', minHeight: 54, background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: 8, fontFamily: 'inherit' }} />

      <div className="btn-row" style={{ marginTop: 8 }}>
        <button className="btn" onClick={submit}>发送</button>
        <button className="btn ghost" onClick={() => onAction({ type: 'continue' })}>▶ 继续游戏</button>
      </div>
    </div>
  );
}
