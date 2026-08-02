// 轻量国际化：简体中文 / 英语。语言存 localStorage，默认简中。
import { useSyncExternalStore } from 'react';

const STORE_KEY = 'ai-collab-lang';
let current = (typeof localStorage !== 'undefined' && localStorage.getItem(STORE_KEY)) || 'zh';
const listeners = new Set();

export function getLang() { return current; }
export function setLang(lang) {
  current = lang === 'en' ? 'en' : 'zh';
  try { localStorage.setItem(STORE_KEY, current); } catch {}
  listeners.forEach((l) => l());
}
function subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); }

// 文案字典。key 用点分层。缺失时回退到中文、再回退到 key 本身。
const DICT = {
  zh: {
    'app.title': '百家 · Agora',
    'sidebar.new': '+ 新建协作',
    'sidebar.werewolf': '🎮 玩法 · AI 狼人杀',
    'sidebar.sessions': '协作会话',
    'sidebar.empty': '还没有会话，点上方新建。',
    'sidebar.settings': '⚙ 设置',
    'status.connected': '● 已连接',
    'status.connecting': '○ 连接中…',
    'top.pickSession': '选择或新建一个对话。',
    'top.noParticipants': '这个对话还没有参与的 AI，点右侧「管理参与者」添加。',
    'top.manage': '👥 管理参与者',
    'top.export': '⬇ 导出',
    'top.autoflow': '▶ 自动协作一轮',
    'top.stopAuto': '■ 停止自动协作',
    'empty.pickOrNew': '选择或新建一个协作会话开始。',
    'empty.startHint': '在下方输入需求，然后点某个 AI 成员让它发言，或点「自动协作」。',
    'composer.placeholder': '输入需求…（Ctrl+Enter 发送）。输入 @ 可点名某个 AI，@所有人 让全体依次回应',
    'composer.placeholderIdle': '先新建或选择一个会话',
    'composer.send': '发送',
    'composer.hint': '发送后点上方成员让 AI 应答，或用 @名字 点名，@所有人 让全体依次回应。',
    'mention.everyone': '所有人',
    'mention.everyoneHint': '（全体依次回应）',
    'settings.title': '设置',
    'settings.lang': '语言 / Language',
    'sponsor.btn': '❤ 赞助支持',
    'sponsor.title': '❤ 赞助支持本项目',
    'sponsor.desc': '这个工具完全免费开源。如果它帮到了你，欢迎微信扫码请作者喝杯咖啡～ 你的支持是持续更新的动力。',
    'sponsor.perk': '赞助者福利：新 AI 游戏模板抢先体验、优先反馈通道。',
    'sponsor.thanks': '感谢每一位支持者 🙏',
    'sponsor.noqr': '（收款码待作者放入 web/public/sponsor-qr.png）',
    'common.cancel': '取消',
    'common.save': '保存',
    'common.delete': '删除',
    'common.confirm': '确认',
    'delete.title': '删除对话',
    'delete.confirm': '确认删除',
  },
  en: {
    'app.title': 'Agora · 百家',
    'sidebar.new': '+ New Chat',
    'sidebar.werewolf': '🎮 Game · AI Werewolf',
    'sidebar.sessions': 'Sessions',
    'sidebar.empty': 'No sessions yet. Click above to create one.',
    'sidebar.settings': '⚙ Settings',
    'status.connected': '● Connected',
    'status.connecting': '○ Connecting…',
    'top.pickSession': 'Select or create a chat.',
    'top.noParticipants': 'No AI in this chat yet. Click "Manage Participants" on the right.',
    'top.manage': '👥 Manage Participants',
    'top.export': '⬇ Export',
    'top.autoflow': '▶ Auto Collab (1 round)',
    'top.stopAuto': '■ Stop Auto',
    'empty.pickOrNew': 'Select or create a session to start.',
    'empty.startHint': 'Type your request below, then click an AI member to speak, or click "Auto Collab".',
    'composer.placeholder': 'Type here… (Ctrl+Enter to send). Use @ to mention an AI, @everyone for all in turn',
    'composer.placeholderIdle': 'Create or select a session first',
    'composer.send': 'Send',
    'composer.hint': 'After sending, click a member to reply, or use @name, or @everyone for all in turn.',
    'mention.everyone': 'everyone',
    'mention.everyoneHint': '(all reply in turn)',
    'settings.title': 'Settings',
    'settings.lang': '语言 / Language',
    'sponsor.btn': '❤ Sponsor',
    'sponsor.title': '❤ Sponsor this project',
    'sponsor.desc': 'This tool is free and open-source. If it helps you, feel free to buy the author a coffee via WeChat. Your support keeps it updated.',
    'sponsor.perk': 'Sponsor perks: early access to new AI game templates, priority feedback channel.',
    'sponsor.thanks': 'Thanks to every supporter 🙏',
    'sponsor.noqr': '(Place your QR code at web/public/sponsor-qr.png)',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.delete': 'Delete',
    'common.confirm': 'Confirm',
    'delete.title': 'Delete Chat',
    'delete.confirm': 'Confirm Delete',
  },
};

// React hook：返回翻译函数 t，语言变化时自动重渲染。
export function useI18n() {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  const t = (key) => (DICT[lang] && DICT[lang][key]) || DICT.zh[key] || key;
  return { t, lang, setLang };
}
