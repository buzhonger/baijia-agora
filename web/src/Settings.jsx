import React, { useState } from 'react';
import { api } from './api.js';
import { useI18n } from './i18n.js';
import { cleanLabel } from './utils.js';

// 设置弹层：配置 API 供应商 + agent 角色 + 工作区。按 供应商→成员→工作区 顺序引导。
const TABS = [
  { key: 'providers', label: '① API 供应商' },
  { key: 'agents', label: '② AI 成员' },
  { key: 'workspace', label: '③ 工作区' },
];
export default function Settings({ config, templates, onClose, onChanged, initialTab }) {
  const { t, lang, setLang } = useI18n();
  const [tab, setTab] = useState(initialTab || 'providers');
  const idx = TABS.findIndex((t) => t.key === tab);
  const isLast = idx === TABS.length - 1;
  const goNext = () => { if (isLast) onClose(); else setTab(TABS[idx + 1].key); };

  const hasProviders = Object.keys(config.providers || {}).length > 0;
  const hasAgents = (config.agents || []).length > 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>{t('settings.title')}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="inline-note">{t('settings.lang')}:</span>
            <button className={`btn ${lang === 'zh' ? '' : 'ghost'} sm`} onClick={() => setLang('zh')}>简体中文</button>
            <button className={`btn ${lang === 'en' ? '' : 'ghost'} sm`} onClick={() => setLang('en')}>English</button>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* 醒目引导：说清楚"设置只是配置，开始对话要去左上角新建协作" */}
        <div className="card" style={{ background: 'rgba(124,92,255,0.12)', borderColor: 'var(--accent)' }}>
          <div style={{ fontSize: 13 }}>
            按 <b>① 配供应商 → ② 加 AI 成员 → ③ 设工作区</b> 走一遍。
            <br />配置完成后，<b>关闭这里</b>，点左侧 <b>「+ 新建协作」</b> 才是开始对话。设置本身不会开启对话。
          </div>
        </div>

        <div className="btn-row" style={{ margin: '14px 0 16px' }}>
          {TABS.map((tb) => (
            <button key={tb.key} className={`btn ${tab === tb.key ? '' : 'ghost'} sm`} onClick={() => setTab(tb.key)}>
              {tb.label}{tb.key === 'providers' && hasProviders ? ' ✓' : ''}{tb.key === 'agents' && hasAgents ? ' ✓' : ''}
            </button>
          ))}
        </div>

        {tab === 'providers' && <ProvidersTab config={config} templates={templates} onChanged={onChanged} />}
        {tab === 'agents' && <AgentsTab config={config} templates={templates} onChanged={onChanged} />}
        {tab === 'workspace' && <WorkspaceTab config={config} onChanged={onChanged} />}

        {/* 底部统一导航：下一步 / 完成 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <span className="inline-note">{isLast ? '都配好了？点"完成并关闭"，然后去「+ 新建协作」。' : `第 ${idx + 1} / ${TABS.length} 步`}</span>
          <button className="btn" onClick={goNext}>{isLast ? '完成并关闭 ✓' : `下一步：${TABS[idx + 1].label} →`}</button>
        </div>
      </div>
    </div>
  );
}

function ProvidersTab({ config, templates, onChanged }) {
  const [pick, setPick] = useState('deepseek');
  const [key, setKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [showHelp, setShowHelp] = useState(false); // 提示帮助面板
  const t = templates[pick] || {};
  const isCustom = pick === 'openai_compatible';

  async function add() {
    await api.upsertProvider(pick, {
      template: pick, kind: t.kind, label: t.label,
      baseURL: (isCustom ? baseURL : t.baseURL) || t.baseURL, apiKey: key,
    });
    setKey(''); setBaseURL('');
    onChanged();
  }

  return (
    <div>
      <p className="inline-note">选供应商 → 贴 API Key → 添加。密钥只存本地 data/config.json，不上传任何地方。</p>
      {Object.entries(config.providers).map(([id, p]) => (
        <div className="card" key={id}>
          <div className="card-head">
            <strong>{cleanLabel(p.label) || id}</strong>
            <span className={`tag ${p.hasKey ? 'ok' : ''}`}>{p.hasKey ? '已配置密钥' : '无密钥'}</span>
          </div>
          <div className="inline-note">{p.baseURL}</div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn danger sm" onClick={async () => { await api.removeProvider(id); onChanged(); }}>移除</button>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 10px' }}>
        <h3 style={{ margin: 0 }}>添加供应商</h3>
        <button type="button" title="查看各家 AI 提示（哪个免费、优缺点等）" onClick={() => setShowHelp(true)}
          style={{ width: 20, height: 20, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>?</button>
        <span className="inline-note">提示</span>
      </div>
      <div className="field">
        <label>选择供应商（预置好了地址，选完贴 key 即可）</label>
        <select value={pick} onChange={(e) => { setPick(e.target.value); setBaseURL(''); }}>
          {Object.entries(templates).map(([id, tpl]) => <option key={id} value={id}>{cleanLabel(tpl.label)}</option>)}
        </select>
      </div>
      {/* 只保留申请链接，杂乱的 tips 收进"提示"面板 */}
      {t.apply && (
        <div style={{ marginBottom: 12 }}>
          <a href={t.apply} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 13 }}>→ 去这里申请 {cleanLabel(t.label)} 的 API Key</a>
        </div>
      )}
      {isCustom && (
        <div className="field">
          <label>Base URL（OpenAI 兼容端点）</label>
          <input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://your-endpoint/v1" />
        </div>
      )}
      <div className="field">
        <label>API Key</label>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="粘贴你的密钥" />
      </div>
      <button className="btn" onClick={add} disabled={!key || (isCustom && !baseURL)}>添加 / 更新</button>

      {showHelp && (
        <div className="overlay" onClick={() => setShowHelp(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>💡 各家 AI 提示</h2>
              <button className="icon-btn" onClick={() => setShowHelp(false)}>✕</button>
            </div>
            <p className="inline-note">哪家免费、擅长什么、去哪申请，都在这里。选供应商时按需参考。</p>
            {Object.entries(templates).map(([id, tpl]) => (
              <div className="card" key={id} style={{ background: 'var(--panel-2)' }}>
                <strong>{cleanLabel(tpl.label)}</strong>
                {tpl.hint && <div className="inline-note" style={{ color: 'var(--text)', marginTop: 4 }}>{tpl.hint}</div>}
                {tpl.baseURL && <div className="inline-note" style={{ marginTop: 4 }}>接口地址：{tpl.baseURL}</div>}
                {tpl.apply && <div style={{ marginTop: 6 }}>
                  <a href={tpl.apply} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 13 }}>→ 去申请 API Key</a>
                </div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ROLE_PRESETS = [
  { role: '规划师', avatar: '📐', systemPrompt: '你是项目规划师。负责把需求拆解成清晰的计划书和工作流，列出步骤、分工和验收标准。你会看到团队里其他 AI 和用户的发言，请基于全局上下文协作。' },
  { role: '开发', avatar: '🛠️', systemPrompt: '你是开发工程师。你能读写工作区文件、执行命令。请根据规划师的计划实现代码。你能看到其他成员的发言，写完后简要说明你做了什么，方便他人审查。' },
  { role: '审查员', avatar: '🔍', systemPrompt: '你是代码审查员。检查其他成员产出的代码与计划，指出问题并提出具体修改要求。你可以直接向特定成员提出要求。' },
];

// 头像展示组件：图片 URL / data URL 显示成圆形图，否则当 emoji 文字显示。
export function Avatar({ value, color, size = 28 }) {
  const isImg = typeof value === 'string' && (value.startsWith('data:') || value.startsWith('http'));
  const style = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: size * 0.6, background: color ? `${color}22` : 'var(--panel-2)',
    border: color ? `1.5px solid ${color}` : '1px solid var(--border)', overflow: 'hidden',
  };
  if (isImg) return <span style={style}><img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></span>;
  return <span style={style}>{value || '🤖'}</span>;
}

const EMOJI_CHOICES = ['🤖', '🧠', '💡', '🛠️', '🔍', '🎯', '📐', '⚡', '🦊', '🐧', '🦉', '🐙', '🌟', '🚀', '🧩', '📊'];
const EMPTY_AGENT = { name: '', providerId: '', model: '', role: '', systemPrompt: '', avatar: '🤖', maxRepliesPerRound: 1, maxTokens: 2048 };

function AgentsTab({ config, templates, onChanged }) {
  const [form, setForm] = useState(EMPTY_AGENT);
  const [editingId, setEditingId] = useState(null);
  const [discovered, setDiscovered] = useState({}); // providerId -> 发现到的模型数组
  const [discovering, setDiscovering] = useState(false);
  const providers = Object.keys(config.providers);
  // 选中供应商对应的模板（拿预置模型列表）。供应商 id 就是模板 id。
  const pickedTpl = templates?.[form.providerId] || {};
  // 优先用发现到的实际模型，否则用模板预置的
  const modelOptions = discovered[form.providerId] || pickedTpl.models || [];

  async function discover() {
    if (!form.providerId) return;
    setDiscovering(true);
    try {
      const { models } = await api.discoverModels(form.providerId);
      setDiscovered((d) => ({ ...d, [form.providerId]: models }));
    } catch (e) {
      alert('发现模型失败：' + (e.message || e));
    } finally {
      setDiscovering(false);
    }
  }

  function applyPreset(p) {
    setForm((f) => ({ ...f, role: p.role, systemPrompt: p.systemPrompt, name: f.name || p.role, avatar: f.avatar || p.avatar }));
  }

  // 图片上传：转成 base64 data URL 存进配置（小图，随配置一起保存）
  function onPickImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) { alert('图片请小于 512KB'); return; }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, avatar: reader.result }));
    reader.readAsDataURL(file);
  }

  function startEdit(a) {
    setEditingId(a.id);
    setForm({ id: a.id, name: a.name, providerId: a.providerId, model: a.model, role: a.role || '', systemPrompt: a.systemPrompt || '', avatar: a.avatar || '🤖', maxRepliesPerRound: a.maxRepliesPerRound || 1, maxTokens: a.maxTokens || 2048 });
  }

  function resetForm() { setForm(EMPTY_AGENT); setEditingId(null); }

  async function save() {
    if (!form.providerId || !form.model) return;
    await api.upsertAgent(form);
    resetForm();
    onChanged();
  }

  return (
    <div>
      <p className="inline-note">每个 AI 成员绑定一个供应商+模型，并有自己的角色设定。可以让不同成员用不同的 AI。</p>
      {config.agents.map((a) => (
        <div className="card" key={a.id}>
          <div className="card-head">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Avatar value={a.avatar} color={a.color} size={28} />
              <strong>{a.name}</strong> {a.role && <span className="tag">{a.role}</span>}</span>
            <span className="btn-row">
              <button className="btn ghost sm" onClick={() => startEdit(a)}>编辑</button>
              <button className="btn danger sm" onClick={async () => { await api.removeAgent(a.id); onChanged(); }}>删除</button>
            </span>
          </div>
          <div className="inline-note">{config.providers[a.providerId]?.label || a.providerId} · {a.model} · 每轮≤{a.maxRepliesPerRound || 1}次 · ≤{a.maxTokens || 2048}token</div>
        </div>
      ))}

      <h3>{editingId ? '编辑成员' : '添加 AI 成员'}</h3>
      {providers.length === 0 && <p className="inline-note" style={{ color: 'var(--danger)' }}>请先在「API 供应商」里添加至少一个供应商。</p>}
      <div className="btn-row" style={{ marginBottom: 10 }}>
        {ROLE_PRESETS.map((p) => <button key={p.role} className="btn ghost sm" onClick={() => applyPreset(p)}>用「{p.role}」模板</button>)}
      </div>
      <div className="field">
        <label>头像</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <Avatar value={form.avatar} color={form.color} size={44} />
          <label className="btn ghost sm" style={{ cursor: 'pointer' }}>
            上传图片
            <input type="file" accept="image/*" onChange={onPickImage} style={{ display: 'none' }} />
          </label>
          <span className="inline-note">选 emoji 或上传图片（&lt;512KB）</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {EMOJI_CHOICES.map((e) => (
            <button key={e} type="button"
              onClick={() => setForm({ ...form, avatar: e })}
              style={{ fontSize: 20, width: 34, height: 34, borderRadius: 8, cursor: 'pointer',
                background: form.avatar === e ? 'var(--accent)' : 'var(--panel-2)',
                border: '1px solid var(--border)' }}>{e}</button>
          ))}
        </div>
      </div>
      <div className="field"><label>名字</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 Claude、DeepSeek、小规" /></div>
      <div className="field"><label>供应商</label>
        <select value={form.providerId} onChange={(e) => {
          const pid = e.target.value;
          const tpl = templates?.[pid] || {};
          // 选供应商时自动带上它的默认模型（没有则清空让用户填）
          setForm((f) => ({ ...f, providerId: pid, model: tpl.defaultModel || '' }));
        }}>
          <option value="">选择…</option>
          {providers.map((id) => <option key={id} value={id}>{cleanLabel(config.providers[id].label) || id}</option>)}
        </select></div>
      <div className="field">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ margin: 0 }}>模型</label>
          {form.providerId && <button type="button" className="btn ghost sm" onClick={discover} disabled={discovering}>
            {discovering ? '发现中…' : '🔍 发现可用模型'}</button>}
        </div>
        <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="如 deepseek-chat / glm-4-flash" />
        {modelOptions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {modelOptions.map((m) => (
              <button key={m} type="button" className="btn ghost sm"
                onClick={() => setForm({ ...form, model: m })}
                style={{ background: form.model === m ? 'var(--accent)' : undefined }}>{m}</button>
            ))}
          </div>
        )}
        {discovered[form.providerId] && <span className="inline-note">↑ 这是从该供应商实际查到的模型（贵/便宜版都在这，按需选）</span>}
      </div>
      <div className="field"><label>角色（可选）</label>
        <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="规划师 / 开发 / 审查员" /></div>
      <div className="field"><label>系统提示词（定义它的职责与协作方式）</label>
        <textarea value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} /></div>

      <h3>省 token 限制（这个成员单独设）</h3>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>每轮最多发言次数（1–10）</label>
          <input type="number" min="1" max="10" value={form.maxRepliesPerRound}
            onChange={(e) => setForm({ ...form, maxRepliesPerRound: e.target.value })} />
          <span className="inline-note">自动协作时，这个 AI 在一次请求里最多说几次。想让它多聊就调大。</span>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>单次回复最长（token，256–8192）</label>
          <input type="number" min="256" max="8192" step="256" value={form.maxTokens}
            onChange={(e) => setForm({ ...form, maxTokens: e.target.value })} />
          <span className="inline-note">话痨的调小省钱，需要长输出的调大。</span>
        </div>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={save} disabled={!form.providerId || !form.model}>{editingId ? '保存修改' : '添加成员'}</button>
        {editingId && <button className="btn ghost" onClick={resetForm}>取消</button>}
      </div>
    </div>
  );
}

function WorkspaceTab({ config, onChanged }) {
  const [ws, setWs] = useState(config.workspace || '');
  const [saved, setSaved] = useState(false);
  const [clickToAt, setClickToAtLocal] = useState(() => localStorage.getItem('agora_clickToAt') !== 'false');
  async function save() {
    await api.setWorkspace(ws);
    await onChanged();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
  return (
    <div>
      <p className="inline-note">AI 执行本地操作（读写文件、跑命令）时，只能在这个工作区目录内活动。这是可选项，不影响开始对话。</p>
      <div className="field"><label>工作区绝对路径</label>
        <input value={ws} onChange={(e) => setWs(e.target.value)} /></div>
      <div className="btn-row" style={{ alignItems: 'center' }}>
        <button className="btn" onClick={save}>保存工作区路径</button>
        {saved && <span style={{ color: 'var(--ok)' }}>✓ 已保存</span>}
      </div>

      <h3 style={{ marginTop: 20 }}>界面行为</h3>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={clickToAt} onChange={(e) => {
          const val = e.target.checked;
          setClickToAtLocal(val);
          localStorage.setItem('agora_clickToAt', val ? 'true' : 'false');
        }} />
        左键点击顶部成员头像时，插入 @名字 到输入框（而非直接触发发言）
      </label>
      <p className="inline-note" style={{ margin: '4px 0' }}>开启后，左键点击顶部 AI 头像会在输入框插入 @名字，避免误触直接触发发言。关闭则恢复原来的"点击即发言"。右键始终显示成员信息/私聊面板。</p>
    </div>
  );
}
