import React, { useState, useEffect } from 'react';
import { api } from './api.js';
import { cleanLabel } from './utils.js';

// 狼人杀配置弹窗：选场次 → 选你的身份（法官/玩家）→ 为每个 AI 座位选模型 → 开始。
// 模型可下拉预置也可手输，开始前校验手输模型是否真实存在。
export default function Werewolf({ config, templates = {}, onStart, onClose }) {
  const [presets, setPresets] = useState(null);
  const [scenario, setScenario] = useState('novice6');
  const [seats, setSeats] = useState([]);
  const [myRole, setMyRole] = useState('judge'); // 'judge'=当法官旁观 | 'player'=当其中一名玩家
  const [mySeat, setMySeat] = useState(0);        // 当玩家时，占第几个座位
  const [models, setModels] = useState({});       // providerId -> 发现到的模型列表
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [showIdentity, setShowIdentity] = useState(false); // 按身份显示头像+名字标注身份
  // 暂停节点（默认全选）：夜晚行动后 / 白天发言后 / 自由讨论后 / 投票前 / 有人死亡后
  const [pausePoints, setPausePoints] = useState({ night: true, daySpeech: false, freeTalk: false, beforeVote: true });

  const providerIds = Object.keys(config.providers);

  useEffect(() => { api.werewolfPresets().then(setPresets); }, []);

  const [refreshing, setRefreshing] = useState(false);

  // 拉取各供应商实时可用模型。force=true 时忽略缓存重新拉（厂商出新模型后点刷新即可更新）。
  async function discoverAll(force = false) {
    setRefreshing(true);
    await Promise.all(providerIds.map(async (pid) => {
      if (models[pid] && !force) return;
      try { const { models: ms } = await api.discoverModels(pid); setModels((m) => ({ ...m, [pid]: ms })); } catch {}
    }));
    setRefreshing(false);
  }

  // 进入时自动发现一遍（失败不影响手输）
  useEffect(() => { discoverAll(false); }, [config]);

  // 换场次时按玩家数生成座位，用已有供应商轮流填充
  useEffect(() => {
    if (!presets) return;
    const scen = presets.scenarios.find((s) => s.key === scenario);
    if (!scen) return;
    const defaultModel = (pid) => config.providers[pid]?.defaultModel || '';
    setSeats(Array.from({ length: scen.count }, (_, i) => {
      const pid = providerIds[i % Math.max(providerIds.length, 1)] || '';
      return { name: `玩家${i + 1}`, providerId: pid, model: defaultModel(pid) };
    }));
    if (mySeat >= scen.count) setMySeat(0);
  }, [scenario, presets]);

  if (!presets) return null;
  const scen = presets.scenarios.find((s) => s.key === scenario);

  function updateSeat(i, patch) {
    setSeats((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    setError('');
  }

  // 需要校验模型的 AI 座位（当玩家时，你占的那个座位不算 AI，不校验）
  function aiSeats() {
    return seats.filter((_, i) => !(myRole === 'player' && i === mySeat));
  }

  async function start() {
    setError('');
    const ai = aiSeats();
    if (ai.some((s) => !s.providerId || !s.model)) { setError('每个 AI 座位都要选供应商和模型。'); return; }

    // 校验手输模型是否存在。合法集合 = 发现列表 + 模板预置列表 + 供应商默认模型。
    // （/models 接口有时列不全，所以模板预置和默认值也算合法，避免误拦。）
    setChecking(true);
    for (const s of ai) {
      const discovered = models[s.providerId] || [];
      const preset = templates[s.providerId]?.models || [];
      const def = config.providers[s.providerId]?.defaultModel;
      const allowed = new Set([...discovered, ...preset, ...(def ? [def] : [])]);
      // 只有当我们确实掌握了一份非空的合法名单、且该模型不在其中时，才拦截
      if (allowed.size > 0 && !allowed.has(s.model)) {
        setChecking(false);
        setError(`「${config.providers[s.providerId]?.label || s.providerId}」可能不存在模型「${s.model}」。请从下拉选择，或确认名称无误。如有疑问，请联系作者。`);
        return;
      }
    }
    setChecking(false);
    onStart({ scenario, seats, myRole, mySeat: myRole === 'player' ? mySeat : -1, showIdentity, pausePoints });
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 720 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>🐺 AI 狼人杀 · 开新局</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        {providerIds.length === 0 && <p className="inline-note" style={{ color: 'var(--danger)' }}>请先在设置里配置至少一个 API 供应商。</p>}

        <h3>你的身份</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="card" onClick={() => setMyRole('judge')} style={{ flex: 1, cursor: 'pointer', marginBottom: 0, outline: myRole === 'judge' ? '1.5px solid var(--accent)' : 'none' }}>
            <strong>🎭 当法官</strong>
            <div className="inline-note" style={{ marginTop: 4 }}>你旁观全局、能看到所有身份，可随时和 AI 交流。全程 AI 自动进行。</div>
          </div>
          <div className="card" onClick={() => setMyRole('player')} style={{ flex: 1, cursor: 'pointer', marginBottom: 0, outline: myRole === 'player' ? '1.5px solid var(--accent)' : 'none' }}>
            <strong>🧑 当玩家</strong>
            <div className="inline-note" style={{ marginTop: 4 }}>你占一个座位，和 AI 同台竞技。轮到你发言/投票时由你操作，上帝由系统主持。</div>
          </div>
        </div>

        <h3>选择场次</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {presets.scenarios.map((s) => (
            <div key={s.key} className="card" onClick={() => setScenario(s.key)}
              style={{ cursor: 'pointer', outline: scenario === s.key ? '1.5px solid var(--accent)' : 'none', marginBottom: 0 }}>
              <strong>{s.name}</strong>
              <div className="inline-note" style={{ margin: '4px 0' }}>{s.desc}</div>
              <div style={{ fontSize: 13 }}>{s.roleCounts.map((r) => `${r.emoji}${r.role}×${r.count}`).join('  ')}</div>
            </div>
          ))}
        </div>

        <h3>显示选项</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={showIdentity} onChange={(e) => setShowIdentity(e.target.checked)} />
          按身份显示（头像用角色图标，名字标注身份，如「玩家1（狼人）」）
        </label>

        <h3>法官在哪些节点暂停介入</h3>
        <p className="inline-note">勾选的节点会暂停，供你 @提问 / 私聊 / 追问 AI。节点越多参与感越强，token 消耗也越多。</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {[['night','天亮·夜晚结果公布后（推荐）'],['daySpeech','白天首轮发言后'],['freeTalk','自由讨论后'],['beforeVote','投票前（推荐）']].map(([k, label]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}>
              <input type="checkbox" checked={pausePoints[k]} onChange={(e) => setPausePoints((p) => ({ ...p, [k]: e.target.checked }))} />
              {label}
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ margin: 0 }}>座位与模型（{scen?.count} 名玩家）</h3>
          <button type="button" className="btn ghost sm" onClick={() => discoverAll(true)} disabled={refreshing}
            title="向各厂商重新拉取当前可用模型（出了新模型点这里更新）">{refreshing ? '刷新中…' : '🔄 刷新模型列表'}</button>
        </div>
        <p className="inline-note">身份由系统随机分配。模型可从下拉选，也可手输；手输不存在的版本无法开始。厂商出新模型时点"刷新模型列表"即可更新。</p>
        {seats.map((seat, i) => {
          const isMe = myRole === 'player' && i === mySeat;
          const listId = `models-${seat.providerId}`;
          return (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <input value={seat.name} onChange={(e) => updateSeat(i, { name: e.target.value })}
                style={{ width: 90, background: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 8px' }} />
              {isMe ? (
                <div style={{ flex: 2, padding: '6px 8px', background: 'rgba(124,92,255,0.15)', border: '1px solid var(--accent)', borderRadius: 6, fontSize: 13 }}>
                  🧑 这是你（真人玩家），无需选模型
                </div>
              ) : (
                <>
                  <select value={seat.providerId} onChange={(e) => updateSeat(i, { providerId: e.target.value, model: config.providers[e.target.value]?.defaultModel || '' })}
                    style={{ flex: 1, background: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 8px' }}>
                    <option value="">选供应商…</option>
                    {providerIds.map((pid) => <option key={pid} value={pid}>{cleanLabel(config.providers[pid].label) || pid}</option>)}
                  </select>
                  <input value={seat.model} placeholder="选或输入模型" list={listId}
                    onChange={(e) => updateSeat(i, { model: e.target.value })}
                    style={{ flex: 1, background: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 8px' }} />
                  <datalist id={listId}>
                    {[...new Set([...(templates[seat.providerId]?.models || []), ...(models[seat.providerId] || [])])].map((m) => <option key={m} value={m} />)}
                  </datalist>
                </>
              )}
              {myRole === 'player' && <button type="button" className="btn ghost sm" onClick={() => setMySeat(i)}
                style={{ background: isMe ? 'var(--accent)' : undefined }}>{isMe ? '✓ 我' : '选我'}</button>}
            </div>
          );
        })}

        {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>⚠️ {error}</p>}

        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn" disabled={providerIds.length === 0 || checking} onClick={start}>{checking ? '校验模型中…' : '▶ 开始游戏'}</button>
          <button className="btn ghost" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
