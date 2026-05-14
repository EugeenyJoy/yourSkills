// ============================================
// routes/profile.js — Профили и подписки v3
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const authMiddleware = require('../middleware/auth');
const badgeLib = require('../lib/badges');


router.use(authMiddleware);


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

  // Бейджи (таблица user_badges)
  const normalizedBadges = badgeLib.getUserBadgesForApi(userId);
  const badgeKeys = [...new Set(badgeLib.getVisibleUserBadgeKeys(userId))];

  const mapBadgeToClient = (b) => ({
    code: b.code || '',
    name: b.name || '',
    icon: b.icon || '🏷️',
    color: b.color || '#888',
    visible: b.visible !== false
  });

  // На карточке профиля: владелец видит все свои бейджи; остальные — только с visible
  const badgeDetails = (userId === viewerId ? normalizedBadges : normalizedBadges.filter(b => b.visible !== false))
    .map(mapBadgeToClient);

  const userPayload = {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    username: user.username,
    profileText: user.profile_text || '',
    showProfileText: !!user.show_profile_text,
    photoUrl: user.photo_url,
    overallRank: user.overall_rank || 'F',
    overallXP: user.overall_xp || 0,
    overallRankInfo: skillsRouter.getRankInfo(user.overall_xp || 0),
    badges: badgeDetails,
    badgeKeys,
    isOwn: userId === viewerId,
    createdAt: user.created_at,
  };

  // Полный список с видимостью — только для владельца (экран настроек)
  if (userId === viewerId) {
    userPayload.badgesAll = normalizedBadges.map(mapBadgeToClient);
  }

  return {
    user: userPayload,
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
    const profileText = String(req.body.profileText || '').trim();
    const showProfileText = req.body.showProfileText ? 1 : 0;

    if (!firstName) {
      return res.status(400).json({ error: 'Имя не может быть пустым' });
    }

    if (firstName.length > 64 || lastName.length > 64) {
      return res.status(400).json({ error: 'Слишком длинное имя' });
    }

    if (profileText.length > 48) {
      return res.status(400).json({ error: 'Слишком длинный текст профиля' });
    }

    // Видимость бейджей (только существующие строки в user_badges)
    if (req.body.badges && Array.isArray(req.body.badges)) {
      for (const b of req.body.badges) {
        const code = String(b?.code || '').trim();
        if (!code) continue;
        if (!badgeLib.hasBadge(req.userId, code)) continue;
        badgeLib.setBadgeVisibility(req.userId, code, b.visible !== false);
      }
    }

    const query = `
      UPDATE users
      SET first_name = ?, last_name = ?, profile_text = ?, show_profile_text = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    const params = [firstName, lastName, profileText, showProfileText, req.userId];

    db.prepare(query).run(...params);

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
// POST /api/profile/me/reset
// Сброс прогресса профиля (без удаления пользователя)
// ============================================
router.post('/me/reset', (req, res) => {
  try {
    const userId = req.userId;

    const tx = db.transaction(() => {
      const ownEventIds = db.prepare(
        'SELECT id FROM feed_events WHERE user_id = ?'
      ).all(userId).map(r => r.id);

      if (ownEventIds.length > 0) {
        const placeholders = ownEventIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM feed_reactions WHERE event_id IN (${placeholders})`).run(...ownEventIds);
      }

      db.prepare('DELETE FROM feed_reactions WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM feed_events WHERE user_id = ?').run(userId);

      db.prepare('DELETE FROM endorsements WHERE from_user_id = ? OR to_user_id = ?')
        .run(userId, userId);
      db.prepare('DELETE FROM checkins WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM user_achievements WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM user_skills WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?')
        .run(userId, userId);

      db.prepare('DELETE FROM user_badges WHERE user_id = ?').run(userId);

      db.prepare(`
        UPDATE users
        SET overall_rank = 'F',
            overall_xp = 0,
            badges = '[]',
            profile_text = '',
            show_profile_text = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(userId);
    });

    tx();

    res.json({ message: 'Профиль сброшен' });
  } catch (error) {
    console.error('❌ Сброс профиля:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ============================================
// DELETE /api/profile/me
// Полное удаление профиля из приложения
// ============================================
router.delete('/me', (req, res) => {
  try {
    const userId = req.userId;

    const tx = db.transaction(() => {
      const ownEventIds = db.prepare(
        'SELECT id FROM feed_events WHERE user_id = ?'
      ).all(userId).map(r => r.id);

      if (ownEventIds.length > 0) {
        const placeholders = ownEventIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM feed_reactions WHERE event_id IN (${placeholders})`).run(...ownEventIds);
      }

      db.prepare('DELETE FROM feed_reactions WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM feed_events WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM endorsements WHERE from_user_id = ? OR to_user_id = ?')
        .run(userId, userId);
      db.prepare('DELETE FROM checkins WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM user_achievements WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM user_skills WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?')
        .run(userId, userId);
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    });

    tx();

    res.json({ message: 'Профиль удалён' });
  } catch (error) {
    console.error('❌ Удаление профиля:', error.message);
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
    const sliced = rows.slice(0, limit);
    const badgeMap = badgeLib.getVisibleBadgeKeysMap(sliced.map(r => r.id));
    const users = sliced.map(u => ({
      id: u.id,
      firstName: u.first_name,
      lastName: u.last_name,
      username: u.username,
      photoUrl: u.photo_url,
      rank: u.overall_rank || 'F',
      xp: u.overall_xp || 0,
      skillRank: u.skill_rank || null,
      badgeKeys: badgeMap.get(u.id) || [],
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

    const rows = db.prepare(`
      SELECT id, first_name, last_name, username,
             photo_url, overall_rank, overall_xp
      FROM users
      WHERE overall_xp > 0
      ORDER BY overall_xp DESC
      LIMIT ?
    `).all(limit);

    const badgeMap = badgeLib.getVisibleBadgeKeysMap(rows.map(r => r.id));

    res.json({
      users: rows.map((u, i) => ({
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        username: u.username,
        photoUrl: u.photo_url,
        rank: u.overall_rank || 'F',
        xp: u.overall_xp || 0,
        position: i + 1,
        badgeKeys: badgeMap.get(u.id) || [],
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

    const badgeMap = badgeLib.getVisibleBadgeKeysMap(users.map(u => u.id));

    const total = db.prepare(
      'SELECT COUNT(*) as c FROM follows WHERE following_id = ?'
    ).get(userId).c;

    res.json({
      users: users.map(u => ({
        id: u.id, firstName: u.first_name, lastName: u.last_name,
        username: u.username, photoUrl: u.photo_url,
        rank: u.overall_rank || 'F', xp: u.overall_xp || 0,
        badgeKeys: badgeMap.get(u.id) || [],
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

    const badgeMap = badgeLib.getVisibleBadgeKeysMap(users.map(u => u.id));

    const total = db.prepare(
      'SELECT COUNT(*) as c FROM follows WHERE follower_id = ?'
    ).get(userId).c;

    res.json({
      users: users.map(u => ({
        id: u.id, firstName: u.first_name, lastName: u.last_name,
        username: u.username, photoUrl: u.photo_url,
        rank: u.overall_rank || 'F', xp: u.overall_xp || 0,
        badgeKeys: badgeMap.get(u.id) || [],
      })),
      total
    });

  } catch (error) {
    console.error('❌ Подписки:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


module.exports = router;
