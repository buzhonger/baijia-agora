// 配置存储：API 供应商密钥 + agent（AI 角色）定义 + 工作区路径。
// 存在本地 data/config.json。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { CONFIG_FILE, DEFAULT_WORKSPACE } from './paths.js';

// 内置的供应商模板。用户只需填 apiKey 即可启用。
// 预置供应商模板。选好后 Base URL / 模型自动填好，用户只需贴 key。
// apply 地址 + hint 用于前端引导用户去哪拿 key。
export const PROVIDER_TEMPLATES = {
  deepseek: {
    label: 'DeepSeek 深度求索',
    kind: 'openai', // DeepSeek 用 OpenAI 兼容协议
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    apply: 'https://platform.deepseek.com/',
    hint: '便宜、中文强、代码强。v4-flash 快而省，v4-pro 更强(推理型,回复较慢)。模型名以官方为准，可点"发现可用模型"核对。',
  },
  zhipu: {
    label: '智谱 GLM',
    kind: 'openai',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4.5-air', 'glm-4.5', 'glm-4.6', 'glm-4.7', 'glm-5-turbo', 'glm-5'],
    apply: 'https://open.bigmodel.cn/',
    hint: 'glm-4-flash 免费且稳定，适合闲聊/情绪价值。旗舰款(glm-4.5/4.6/5 等)更强但付费。注：新出的 glm-4.7-flash 实测偶发空回复，暂不推荐。',
  },
  kimi: {
    label: 'Kimi 月之暗面',
    kind: 'openai',
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k3',
    // 新版账号用 kimi-k* 系列；老账号可能是 moonshot-v1-* 系列，都列上
    models: ['kimi-k3', 'kimi-k2.6', 'kimi-k2.7-code', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    apply: 'https://platform.moonshot.cn/',
    hint: '超长上下文、读长文档强。kimi-k3 是推理型(回复较慢、需给足输出长度)。模型名以你账号为准，可点"发现可用模型"核对。',
  },
  qwen: {
    label: '通义千问（阿里）',
    kind: 'openai',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-turbo',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-flash', 'qwen-long'],
    apply: 'https://dashscope.aliyun.com/',
    hint: 'qwen-turbo 便宜、中文强、稳定。注：qwen-plus/max/flash 可能需在阿里云控制台单独开通权限，否则报 403。模型名可点"发现可用模型"核对。',
  },
  doubao: {
    label: '豆包（火山方舟）',
    kind: 'openai',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: '',
    models: [],
    apply: 'https://www.volcengine.com/product/ark',
    hint: '要在火山控制台创建"推理接入点"，模型名填接入点 ID（ep-xxxx）。较麻烦，需实名付费。',
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    models: ['claude-opus-4-1', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
    apply: 'https://console.anthropic.com/',
    hint: '代码/长文推理顶尖。需 sk-ant-api03- 开头的真 API key，海外卡付费。',
  },
  openai: {
    label: 'OpenAI',
    kind: 'openai',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'o1'],
    apply: 'https://platform.openai.com/',
    hint: '综合最强之一。国内访问需处理网络，海外卡付费。',
  },
  openai_compatible: {
    label: '自定义 (OpenAI 兼容)',
    kind: 'openai',
    baseURL: '',
    defaultModel: '',
    models: [],
    apply: '',
    hint: '任何 OpenAI 兼容端点。手动填 Base URL 和模型名。',
  },
};

const DEFAULT_CONFIG = {
  workspace: DEFAULT_WORKSPACE,
  providers: {}, // providerId -> { apiKey, baseURL, kind, ... }
  agents: [],    // { id, name, providerId, model, systemPrompt, role, color, enabled }
};

let cache = null;

export function loadConfig() {
  if (cache) return cache;
  if (existsSync(CONFIG_FILE)) {
    try {
      cache = { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) };
    } catch {
      cache = { ...DEFAULT_CONFIG };
    }
  } else {
    cache = { ...DEFAULT_CONFIG };
  }
  return cache;
}

export function saveConfig(next) {
  cache = next;
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return cache;
}

// 返回给前端时抹掉密钥明文，只标记是否已配置。
export function publicConfig() {
  const cfg = loadConfig();
  const providers = {};
  for (const [id, p] of Object.entries(cfg.providers)) {
    providers[id] = { ...p, apiKey: undefined, hasKey: Boolean(p.apiKey) };
  }
  return { ...cfg, providers };
}

export function upsertProvider(id, patch) {
  const cfg = loadConfig();
  const template = PROVIDER_TEMPLATES[patch.template || id] || {};
  const existing = cfg.providers[id] || {};
  // apiKey 为空字符串表示"不修改"，保留原值
  const apiKey = patch.apiKey ? patch.apiKey : existing.apiKey;
  cfg.providers[id] = {
    kind: patch.kind || existing.kind || template.kind || 'openai',
    label: patch.label || existing.label || template.label || id,
    baseURL: patch.baseURL || existing.baseURL || template.baseURL || '',
    apiKey,
  };
  return saveConfig(cfg);
}

export function removeProvider(id) {
  const cfg = loadConfig();
  delete cfg.providers[id];
  cfg.agents = cfg.agents.filter((a) => a.providerId !== id);
  return saveConfig(cfg);
}

const AGENT_COLORS = ['#7c5cff', '#ff7a59', '#22c1a4', '#f2c14e', '#4e9cf2', '#e857a0'];

// 把值夹到 [min,max] 的整数，非法/缺省则用 fallback
function clampInt(v, fallback, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function upsertAgent(agent) {
  const cfg = loadConfig();
  if (agent.id) {
    const idx = cfg.agents.findIndex((a) => a.id === agent.id);
    if (idx >= 0) {
      const merged = { ...cfg.agents[idx], ...agent };
      // 编辑时也把限制字段归一化，防止前端传来非法值
      if ('maxRepliesPerRound' in agent) merged.maxRepliesPerRound = clampInt(agent.maxRepliesPerRound, 1, 1, 10);
      if ('maxTokens' in agent) merged.maxTokens = clampInt(agent.maxTokens, 2048, 256, 8192);
      cfg.agents[idx] = merged;
      return saveConfig(cfg);
    }
  }
  const color = agent.color || AGENT_COLORS[cfg.agents.length % AGENT_COLORS.length];
  const AVATAR_POOL = ['🤖', '🧠', '💡', '🛠️', '🔍', '🎯', '📐', '⚡'];
  cfg.agents.push({
    id: randomUUID(),
    name: agent.name || '未命名',
    providerId: agent.providerId,
    model: agent.model,
    systemPrompt: agent.systemPrompt || '',
    role: agent.role || '',
    color,
    avatar: agent.avatar || AVATAR_POOL[cfg.agents.length % AVATAR_POOL.length],
    enabled: agent.enabled !== false,
    // 第1层：一轮（一次用户请求）内这个成员最多发言几次，默认 1
    maxRepliesPerRound: clampInt(agent.maxRepliesPerRound, 1, 1, 10),
    // 第3层：单次回复最大 token，默认 2048
    maxTokens: clampInt(agent.maxTokens, 2048, 256, 8192),
  });
  return saveConfig(cfg);
}

export function removeAgent(id) {
  const cfg = loadConfig();
  cfg.agents = cfg.agents.filter((a) => a.id !== id);
  return saveConfig(cfg);
}

export function setWorkspace(dir) {
  const cfg = loadConfig();
  cfg.workspace = dir;
  return saveConfig(cfg);
}
