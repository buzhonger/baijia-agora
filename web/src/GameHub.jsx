import React from 'react';

// 玩法入口：统一管理所有 AI 玩法。新增玩法只需往 GAMES 里加一项。
// 每项：{ key, name, emoji, desc, available, onPick? }
const GAMES = [
  { key: 'werewolf', name: 'AI 狼人杀', emoji: '🐺', available: true,
    desc: '多个 AI 扮演狼人/预言家/女巫等角色，你当法官或玩家，看它们博弈推理、互相试探。' },
];

export default function GameHub({ onClose, onPickWerewolf }) {
  function pick(g) {
    if (!g.available) return;
    if (g.key === 'werewolf') onPickWerewolf();
  }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>🎮 玩法入口</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <p className="inline-note">选择一个 AI 玩法开始。更多玩法陆续加入。</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
          {GAMES.map((g) => (
            <div key={g.key} className="card" onClick={() => pick(g)}
              style={{ cursor: g.available ? 'pointer' : 'default', marginBottom: 0 }}>
              <div style={{ fontSize: 22 }}>{g.emoji}</div>
              <strong>{g.name}</strong>
              <div className="inline-note" style={{ marginTop: 4 }}>{g.desc}</div>
            </div>
          ))}

          {/* 占位：更多玩法开发中 */}
          <div className="card" style={{ marginBottom: 0, opacity: 0.55, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
            <div style={{ fontSize: 22 }}>✨</div>
            <strong>更多玩法</strong>
            <div className="inline-note" style={{ marginTop: 4 }}>正在开发中…</div>
          </div>
        </div>
      </div>
    </div>
  );
}
