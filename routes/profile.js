// ============================================
// routes/profile.js — Профили и подписки v3
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../database');


router.use((req, res, next) => {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) return res.status(401).json({ error: 'Требуется авторизация' });

  const user = req.app.validateTelegramData(initData);
  if (!user) return res.status(403).json({ error: 'Невалидные данные' });

  req.userId = user.id;
  next();
});


// ============================================
// Вспомогательная: собрать полный профиль
// ============================================

function buildProfile(userId, viewerId) {
  const skillsRouter = require('./skills');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;

  // Навыки
  const skills = db.prepare(`
    SELECT us.*, s.name, s.slug, s.description,
           sc.name as subcategory_name, sc.icon as subcategory_icon,
           c.name as category_name, c.icon as category_icon, c.id as category_id
    FROM user_skills us
    JOIN skills s ON us.skill_id = s.id
    JOIN subcategories sc ON s.subcategory_id = sc.id
    JOIN categories c ON sc.category_id = c.id
    WHERE us.user_id = ?
    ORDER BY (us.foundation_xp + us.bonus_xp) DESC
  `).all(userId);

  // Группируем по категориям
  const catMap = new Map();
  for (const s of skills) {
    if (!catMap.has(s.category_id)) {
      catMap.set(s.category_id, {
        id: s.category_id,
        name: s.category_name,
        icon: s.category_icon,
        skills: []
      });
    }
    catMap.get(s.category_id).skills.push({
      id: s.skill_id,
      name: s.name,
      rank: s.rank || 'F',
      totalXP: (s.foundation_xp || 0) + (s.bonus_xp || 0),
      foundationXP: s.foundation_xp || 0,
      bonusXP: s.bonus_xp || 0,
      totalYears: s.total_years || 0,
      activeYears: s.active_years || 0,
      streak: s.current_streak || 0,
      categoryIcon: s.category_icon,
      subcategoryIcon: s.subcategory_icon,
    });
  }

  // Достижения
  const achievements = db.prepare(`
    SELECT a.*, ua.earned_at
    FROM user_achievements ua
    JOIN achievements a ON ua.achievement_id = a.id
    WHERE ua.user_id = ?
    ORDER BY ua.earned_at DESC
  `).all(userId);

  // Социальное
  const followers = db.prepare(
    'SELECT COUNT(*) as c FROM follows WHERE following_id = ?'
  ).get(userId).c;

  const following = db.prepare(
    'SELECT COUNT(*) as c FROM follows WHERE follower_id = ?'
  ).get(userId).c;

  const isFollowing = viewerId !== userId
    ? !!db.prepare(
        'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?'
      ).get(viewerId, userId)
    : false;

  // Статистика
  const totalCheckins = db.prepare(
    'SELECT COUNT(*) as c FROM checkins WHERE user_id = ?'
  ).get(userId).c;

  const totalEndorsements = db.prepare(
    'SELECT COUNT(*) as c FROM endorsements WHERE to_user_id = ?'
  ).get(userId).c;

  // Бейджи
  let badges = [];
  try { badges = JSON.parse(user.badges || '[]'); } catch { }
  const badgeDetails = badges.map(b => ({
    code: b,
    ...(skillsRouter.BADGE_INFO[b] || { name: b, icon: '🏷️', color: '#888' })
  }));

  return {
    user: {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      photoUrl: user.photo_url,
      overallRank: user.overall_rank || 'F',
      overallXP: user.overall_xp || 0,
      overallRankInfo: skillsRouter.getRankInfo(user.overall_xp || 0),
      badges: badgeDetails,
      isOwn: userId === viewerId,
      createdAt: user.created_at,
    },
    categories: Array.from(catMap.values()),
    achievements: achievements.map(a => ({
      id: a.id, code: a.code, name: a.name,
      description: a.description, icon: a.icon, rarity: a.rarity,
    })),
    social: { followers, following, isFollowing },
    stats: {
      totalSkills: skills.length,
      totalCheckins,
      receivedEndorsements: totalEndorsements,
    }
  };
}


// ============================================
// GET /api/profile/me
// ============================================

router.get('/me', (req, res) => {
  try {
    const data = buildProfile(req.userId, req.userId);
    if (!data) return res.status(404).json({ error: 'Профиль не найден' });
    res.json(data);
  } catch (error) {
    console.error('❌ Мой профиль:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ============================================
// PUT /api/profile/me
// Редактирование только своего профиля
// ============================================
router.put('/me', (req, res) => {
  try {
    const firstName = String(req.body.firstName || '').trim();
    const lastName = String(req.body.lastName || '').trim();
    const usernameRaw = String(req.body.username || '').trim();
    const username = usernameRaw.replace(/^@+/, '');

    if (!firstName) {
      return res.status(400).json({ error: 'Имя не может быть пустым' });
    }

    if (firstName.length > 64 || lastName.length > 64) {
      return res.status(400).json({ error: 'Слишком длинное имя' });
    }

    if (username.length > 64) {
      return res.status(400).json({ error: 'Слишком длинный username' });
    }

    db.prepare(`
      UPDATE users
      SET first_name = ?, last_name = ?, username = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(firstName, lastName, username, req.userId);

    const data = buildProfile(req.userId, req.userId);
    res.json({
      message: 'Профиль обновлён',
      user: data.user
    });
  } catch (error) {
    console.error('❌ Обновление профиля:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// GET /api/profile/:userId
// ============================================

router.get('/search/users', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const skill = req.query.skill;
    const rank = req.query.rank;
    const page = parseInt(req.query.page) || 0;
    const limit = 20;

    let query, params;

    if (skill) {
      // Поиск по навыку
      query = `
        SELECT DISTINCT u.id, u.first_name, u.last_name, u.username,
               u.photo_url, u.overall_rank, u.overall_xp,
               us.rank as skill_rank,
               (us.foundation_xp + us.bonus_xp) as skill_xp
        FROM users u
        JOIN user_skills us ON u.id = us.user_id
        JOIN skills s ON us.skill_id = s.id
        WHERE s.slug = ?
        ${rank ? 'AND us.rank = ?' : ''}
        ORDER BY skill_xp DESC
        LIMIT ? OFFSET ?
      `;
      params = rank ? [skill, rank, limit + 1, page * limit] : [skill, limit + 1, page * limit];
    } else if (q.length >= 2) {
      // Поиск по имени
      query = `
        SELECT id, first_name, last_name, username,
               photo_url, overall_rank, overall_xp
        FROM users
        WHERE first_name LIKE ? OR last_name LIKE ? OR username LIKE ?
        ORDER BY overall_xp DESC
        LIMIT ? OFFSET ?
      `;
      const like = `%${q.slice(0, 50)}%`;
      params = [like, like, like, limit + 1, page * limit];
    } else {
      return res.json({ users: [], total: 0, hasMore: false, page });
    }

    const rows = db.prepare(query).all(...params);
    const hasMore = rows.length > limit;
    const users = rows.slice(0, limit).map(u => ({
      id: u.id,
      firstName: u.first_name,
      lastName: u.last_name,
      username: u.username,
      photoUrl: u.photo_url,
      rank: u.overall_rank || 'F',
      xp: u.overall_xp || 0,
      skillRank: u.skill_rank || null,
    }));

    res.json({ users, hasMore, page });

  } catch (error) {
    console.error('❌ Поиск:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


router.get('/top/users', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const users = db.prepare(`
      SELECT id, first_name, last_name, username,
             photo_url, overall_rank, overall_xp
      FROM users
      WHERE overall_xp > 0
      ORDER BY overall_xp DESC
      LIMIT ?
    `).all(limit);

    res.json({
      users: users.map((u, i) => ({
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        username: u.username,
        photoUrl: u.photo_url,
        rank: u.overall_rank || 'F',
        xp: u.overall_xp || 0,
        position: i + 1,
      }))
    });

  } catch (error) {
    console.error('❌ Топ:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


router.get('/:userId', (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: 'Неверный ID' });

    const data = buildProfile(userId, req.userId);
    if (!data) return res.status(404).json({ error: 'Пользователь не найден' });

    res.json(data);
  } catch (error) {
    console.error('❌ Профиль:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// Подписки
// ============================================

router.post('/:userId/follow', (req, res) => {
  try {
    const followerId = req.userId;
    const followingId = parseInt(req.params.userId);

    if (followerId === followingId) {
      return res.status(400).json({ error: 'Нельзя подписаться на себя' });
    }

    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(followingId);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

    db.prepare(
      'INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)'
    ).run(followerId, followingId);

    // Достижения
    const skillsRouter = require('./skills');
    const followerCount = db.prepare(
      'SELECT COUNT(*) as c FROM follows WHERE following_id = ?'
    ).get(followingId).c;

    if (followerCount >= 1)   skillsRouter.grantAchievement(followingId, 'first_follower');
    if (followerCount >= 10)  skillsRouter.grantAchievement(followingId, 'ten_followers');
    if (followerCount >= 25)  skillsRouter.grantAchievement(followingId, 'twenty_five_follow');
    if (followerCount >= 50)  skillsRouter.grantAchievement(followingId, 'fifty_followers');
    if (followerCount >= 100) skillsRouter.grantAchievement(followingId, 'hundred_followers');

    res.json({ message: 'Подписка оформлена' });

  } catch (error) {
    console.error('❌ Подписка:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


router.delete('/:userId/follow', (req, res) => {
  try {
    const followerId = req.userId;
    const followingId = parseInt(req.params.userId);

    db.prepare(
      'DELETE FROM follows WHERE follower_id = ? AND following_id = ?'
    ).run(followerId, followingId);

    res.json({ message: 'Подписка отменена' });

  } catch (error) {
    console.error('❌ Отписка:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


router.get('/:userId/followers', (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const page = parseInt(req.query.page) || 0;
    const limit = 20;

    const users = db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.username,
             u.photo_url, u.overall_rank, u.overall_xp
      FROM follows f
      JOIN users u ON f.follower_id = u.id
      WHERE f.following_id = ?
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, limit, page * limit);

    const total = db.prepare(
      'SELECT COUNT(*) as c FROM follows WHERE following_id = ?'
    ).get(userId).c;

    res.json({
      users: users.map(u => ({
        id: u.id, firstName: u.first_name, lastName: u.last_name,
        username: u.username, photoUrl: u.photo_url,
        rank: u.overall_rank || 'F', xp: u.overall_xp || 0,
      })),
      total
    });

  } catch (error) {
    console.error('❌ Подписчики:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


router.get('/:userId/following', (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const page = parseInt(req.query.page) || 0;
    const limit = 20;

    const users = db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.username,
             u.photo_url, u.overall_rank, u.overall_xp
      FROM follows f
      JOIN users u ON f.following_id = u.id
      WHERE f.follower_id = ?
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, limit, page * limit);

    const total = db.prepare(
      'SELECT COUNT(*) as c FROM follows WHERE follower_id = ?'
    ).get(userId).c;

    res.json({
      users: users.map(u => ({
        id: u.id, firstName: u.first_name, lastName: u.last_name,
        username: u.username, photoUrl: u.photo_url,
        rank: u.overall_rank || 'F', xp: u.overall_xp || 0,
      })),
      total
    });

  } catch (error) {
    console.error('❌ Подписки:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


module.exports = router;
