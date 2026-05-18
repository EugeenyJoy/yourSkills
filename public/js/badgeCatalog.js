// ============================================
// Каталог бейджей на клиенте (состав как на сервере)
// ============================================

(function (global) {
  const BADGE_INFO = {
    creator: { name: 'Создатель', icon: '⚡', color: '#fbbf24' },
    early_adopter: { name: 'α пользователь', icon: '🌱', color: '#a78bfa' },
    verified: { name: 'Верифицирован', icon: '✅', color: '#34d399' },
    contributor: { name: 'Контрибьютор', icon: '🔧', color: '#60a5fa' },
    moderator: { name: 'Модератор', icon: '🛡️', color: '#f472b6' },
  };

  const PRESTIGE_ORDER = ['creator', 'moderator', 'verified', 'contributor', 'early_adopter'];

  function prestigeRank(key) {
    const i = PRESTIGE_ORDER.indexOf(key);
    return i === -1 ? 999 : i;
  }

  function sortKeysByPrestige(keys) {
    return [...new Set(keys || [])]
      .filter(k => BADGE_INFO[k])
      .sort((a, b) => prestigeRank(a) - prestigeRank(b));
  }

  /**
   * @param {string[]} keys
   * @param {number} max
   * @returns {{ show: string[], more: number }}
   */
  function compactBadgeMeta(keys, max) {
    const sorted = sortKeysByPrestige(keys);
    const lim = max || 3;
    const show = sorted.slice(0, lim);
    const more = Math.max(0, sorted.length - show.length);
    return { show, more };
  }

  global.BadgeCatalog = {
    BADGE_INFO,
    sortKeysByPrestige,
    compactBadgeMeta,
    prestigeRank,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
