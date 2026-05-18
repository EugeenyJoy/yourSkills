// ============================================
// Каталог бейджей (состав не менять)
// ============================================

const BADGE_INFO = {
  creator: { name: 'Создатель', icon: '⚡', color: '#fbbf24' },
  early_adopter: { name: 'α пользователь', icon: '🌱', color: '#a78bfa' },
  verified: { name: 'Верифицирован', icon: '✅', color: '#34d399' },
  contributor: { name: 'Контрибьютор', icon: '🔧', color: '#60a5fa' },
  moderator: { name: 'Модератор', icon: '🛡️', color: '#f472b6' },
};

const BADGE_KEYS = new Set(Object.keys(BADGE_INFO));

/** Чем меньше число — тем «выше» престиж (для сортировки в компактном виде) */
const PRESTIGE_RANK = {
  creator: 0,
  moderator: 1,
  verified: 2,
  contributor: 3,
  early_adopter: 4,
};

function isValidBadgeKey(key) {
  return typeof key === 'string' && BADGE_KEYS.has(key);
}

function prestigeRank(key) {
  if (!isValidBadgeKey(key)) return 999;
  return PRESTIGE_RANK[key] ?? 999;
}

/** Лимит legacy-поведения (больше не используется, оставлен для совместимости) */
const EARLY_ADOPTER_MAX_USERS = parseInt(process.env.EARLY_ADOPTER_MAX_USERS || '100', 10);

module.exports = {
  BADGE_INFO,
  BADGE_KEYS,
  PRESTIGE_RANK,
  isValidBadgeKey,
  prestigeRank,
  EARLY_ADOPTER_MAX_USERS,
};
