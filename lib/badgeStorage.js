// ============================================
// SQL-слой бейджей (принимает db для тестов)
// ============================================

const { BADGE_INFO, isValidBadgeKey, EARLY_ADOPTER_MAX_USERS } = require('./badgeConstants');

/**
 * @returns {{ granted: boolean, alreadyExists: boolean, invalid?: boolean }}
 */
function grantBadge(db, userId, badgeKey, grantedBy = 'system') {
  if (!isValidBadgeKey(badgeKey)) {
    return { granted: false, alreadyExists: false, invalid: true };
  }
  const by = String(grantedBy || 'system').slice(0, 64);
  const info = db.prepare(`
    INSERT OR IGNORE INTO user_badges (user_id, badge_key, granted_at, granted_by, visible)
    VALUES (?, ?, datetime('now'), ?, 1)
  `).run(userId, badgeKey, by);

  if (info.changes > 0) {
    return { granted: true, alreadyExists: false };
  }
  return { granted: false, alreadyExists: true };
}

function revokeBadge(db, userId, badgeKey) {
  const r = db.prepare(
    'DELETE FROM user_badges WHERE user_id = ? AND badge_key = ?'
  ).run(userId, badgeKey);
  return r.changes > 0;
}

/**
 * Строки из БД в порядке granted_at ASC
 */
function listUserBadgeRows(db, userId) {
  return db.prepare(`
    SELECT badge_key, granted_at, granted_by, visible
    FROM user_badges
    WHERE user_id = ?
    ORDER BY granted_at ASC, badge_key ASC
  `).all(userId);
}

function getUserBadgeKeys(db, userId) {
  return listUserBadgeRows(db, userId).map(r => r.badge_key);
}

function getVisibleUserBadgeKeys(db, userId) {
  return db.prepare(`
    SELECT badge_key FROM user_badges
    WHERE user_id = ? AND visible = 1
    ORDER BY granted_at ASC, badge_key ASC
  `).all(userId).map(r => r.badge_key);
}

function hasBadge(db, userId, badgeKey) {
  const row = db.prepare(
    'SELECT 1 AS ok FROM user_badges WHERE user_id = ? AND badge_key = ?'
  ).get(userId, badgeKey);
  return !!row;
}

/**
 * Обогащённые объекты для API (как раньше: code, name, icon, color, visible)
 */
function getUserBadgesForApi(db, userId) {
  return listUserBadgeRows(db, userId)
    .map(row => {
      const key = row.badge_key;
      const info = BADGE_INFO[key];
      if (!info) return null;
      return {
        code: key,
        name: info.name,
        icon: info.icon,
        color: info.color,
        visible: row.visible !== 0,
      };
    })
    .filter(Boolean);
}

function setBadgeVisibility(db, userId, badgeKey, visible) {
  const r = db.prepare(`
    UPDATE user_badges SET visible = ?
    WHERE user_id = ? AND badge_key = ?
  `).run(visible ? 1 : 0, userId, badgeKey);
  return r.changes > 0;
}

/**
 * Каркас: первым N пользователям — early_adopter. Не вызывать без ENABLE_AUTO_EARLY_ADOPTER=1
 */
function maybeGrantEarlyAdopter(db, newUserId) {
  if (process.env.ENABLE_AUTO_EARLY_ADOPTER !== '1') return { granted: false, skipped: true };
  const total = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (total > EARLY_ADOPTER_MAX_USERS) return { granted: false, skipped: true };
  return grantBadge(db, newUserId, 'early_adopter', 'system');
}

/**
 * Видимые ключи бейджей для набора пользователей (порядок: granted_at ASC, без дублей)
 */
function getVisibleBadgeKeysMap(db, userIds) {
  const map = new Map();
  if (!userIds || userIds.length === 0) return map;
  const ids = [...new Set(userIds)];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT user_id, badge_key FROM user_badges
    WHERE user_id IN (${placeholders}) AND visible = 1
    ORDER BY user_id, granted_at ASC, badge_key ASC
  `).all(...ids);
  for (const id of ids) map.set(id, []);
  for (const r of rows) {
    if (!map.has(r.user_id)) continue;
    const list = map.get(r.user_id);
    if (!list.includes(r.badge_key)) list.push(r.badge_key);
  }
  return map;
}

module.exports = {
  grantBadge,
  revokeBadge,
  listUserBadgeRows,
  getUserBadgeKeys,
  getVisibleUserBadgeKeys,
  hasBadge,
  getUserBadgesForApi,
  setBadgeVisibility,
  maybeGrantEarlyAdopter,
  getVisibleBadgeKeysMap,
};
