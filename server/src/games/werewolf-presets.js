// 狼人杀角色与场次预设。用户不用懂规则，选场次即可；也可自定义角色配比。

// 角色定义。camp: 'wolf'|'good'。night: 夜晚是否有私密行动。
export const ROLES = {
  wolf:     { key: 'wolf',     name: '狼人',   camp: 'wolf', night: true,  emoji: '🐺',
    desc: '每晚与狼队友共同击杀一名玩家，白天伪装成好人。' },
  seer:     { key: 'seer',     name: '预言家', camp: 'good', night: true,  emoji: '🔮',
    desc: '每晚查验一名玩家的真实阵营（好人/狼人）。' },
  witch:    { key: 'witch',    name: '女巫',   camp: 'good', night: true,  emoji: '🧪',
    desc: '有一瓶解药（救人）和一瓶毒药（毒人），各只能用一次，同一晚不能同时用。' },
  hunter:   { key: 'hunter',   name: '猎人',   camp: 'good', night: false, emoji: '🔫',
    desc: '被投票放逐或被狼击杀时，可开枪带走一名玩家（被女巫毒死则不能开枪）。' },
  guard:    { key: 'guard',    name: '守卫',   camp: 'good', night: true,  emoji: '🛡️',
    desc: '每晚守护一名玩家使其免被狼击杀，不能连续两晚守护同一人。' },
  villager: { key: 'villager', name: '村民',   camp: 'good', night: false, emoji: '👤',
    desc: '没有特殊能力，靠发言和推理找出狼人。' },
};

// 场次预设：不同角色组合。count 必须等于 roles 长度。
export const SCENARIOS = {
  novice6: {
    key: 'novice6', name: '新手局（6人）', count: 6,
    roles: ['wolf', 'wolf', 'seer', 'villager', 'villager', 'villager'],
    desc: '2 狼 + 预言家 + 3 村民。最简单，适合快速体验。',
  },
  witch8: {
    key: 'witch8', name: '女巫局（8人）', count: 8,
    roles: ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager', 'villager', 'villager'],
    desc: '2 狼 + 预言家 + 女巫 + 4 村民。加入女巫的解药与毒药。',
  },
  guard9: {
    key: 'guard9', name: '守卫局（9人）', count: 9,
    roles: ['wolf', 'wolf', 'wolf', 'seer', 'witch', 'guard', 'villager', 'villager', 'villager'],
    desc: '3 狼 + 预言家 + 女巫 + 守卫 + 3 村民。守卫可挡刀。',
  },
  hunter9: {
    key: 'hunter9', name: '猎人局（9人）', count: 9,
    roles: ['wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager'],
    desc: '3 狼 + 预言家 + 女巫 + 猎人 + 3 村民。猎人死亡可开枪。',
  },
  standard12: {
    key: 'standard12', name: '标准局（12人）', count: 12,
    roles: ['wolf', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'guard', 'villager', 'villager', 'villager', 'villager'],
    desc: '4 狼 + 预言家 + 女巫 + 猎人 + 守卫 + 4 村民。经典标准板子。',
  },
};

// 给前端用：精简的公开信息
export function publicPresets() {
  return {
    scenarios: Object.values(SCENARIOS).map((s) => ({
      key: s.key, name: s.name, count: s.count, desc: s.desc,
      roleCounts: countRoles(s.roles),
    })),
    roles: Object.values(ROLES).map((r) => ({ key: r.key, name: r.name, emoji: r.emoji, camp: r.camp, desc: r.desc })),
  };
}

function countRoles(roleKeys) {
  const m = {};
  for (const k of roleKeys) m[k] = (m[k] || 0) + 1;
  return Object.entries(m).map(([k, c]) => ({ role: ROLES[k].name, emoji: ROLES[k].emoji, count: c }));
}
