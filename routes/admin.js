// ============================================
// Админ: выдача / отзыв бейджей
// ============================================

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const badges = require('../lib/badges');

router.use(authMiddleware);

function parseAdminIds() {
  const raw = process.env.ADMIN_IDS || '';
  return raw
    .split(',')
    .map(s => parseInt(String(s).trim(), 10))
    .filter(n => !Number.isNaN(n) && n > 0);
}

function requireAdmin(req, res, next) {
  const ids = parseAdminIds();
  if (ids.length === 0) {
    return res.status(403).json({ error: 'Админ-доступ не настроен' });
  }
  if (!ids.includes(req.userId)) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  next();
}

router.post('/badges/grant', requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.body.user_id, 10);
    const badgeKey = String(req.body.badge_key || '').trim();
    if (!userId || !badgeKey) {
      return res.status(400).json({ error: 'Нужны user_id и badge_key' });
    }
    const result = badges.grantBadge(userId, badgeKey, String(req.userId));
    if (result.invalid) {
      return res.status(400).json({ error: 'Неизвестный badge_key' });
    }
    res.json({
      ok: true,
      granted: result.granted,
      already_exists: result.alreadyExists,
    });
  } catch (e) {
    console.error('admin grant badge:', e.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/badges/revoke', requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.body.user_id, 10);
    const badgeKey = String(req.body.badge_key || '').trim();
    if (!userId || !badgeKey) {
      return res.status(400).json({ error: 'Нужны user_id и badge_key' });
    }
    const revoked = badges.revokeBadge(userId, badgeKey);
    res.json({ ok: true, revoked });
  } catch (e) {
    console.error('admin revoke badge:', e.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
