// ============================================
// routes/profile.js — Профили и подписки v4
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const authMiddleware = require('../middleware/auth');
const badgeLib = require('../lib/badges');
const { RANK_ORDER, getTitleByRank } = require('../lib/ranks');


router.use(authMiddleware);


// ============================================
// Хелперы рангов
// ============================================

function baseOf(rank) {
  return String(rank || 'F').replace('+', '');
}
function rankIndex(rank) {
  return RANK_ORDER.indexOf(baseOf(rank));
}

function normalizeUserId(id) {
  const num = Number(id);
  return Number.isFinite(num) ? num : String(id);
}

function isSameUserId(a, b) {
  return normalizeUserId(a) === normalizeUserId(b);
}

// SQL-выражение для числового индекса ранга (для сортировки в БД)
// F=0, E=1, D=2, C=3, B=4, A=5, S=6 — '+' игнорируем через REPLACE
const RANK_NUM_SQL = `
  CASE REPLACE(COALESCE(overall_rank,'F'),'+','')
    WHEN 'F' THEN 0 WHEN 'E' THEN 1 WHEN 'D' THEN 2 WHEN 'C' THEN 3
    WHEN 'B' THEN 4 WHEN 'A' THEN 5 WHEN 'S' THEN 6 ELSE 0
  END
`;
// Для алиаса us.overall_rank (в JOIN-ах юзаем us.rank)
const SKILL_RANK_NUM_SQL = `
  CASE REPLACE(COALESCE(us.rank,'F'),'+','')
    WHEN 'F' THEN 0 WHEN 'E' THEN 1 WHEN 'D' THEN 2 WHEN 'C' THEN 3
    WHEN 'B' THEN 4 WHEN 'A' THEN 5 WHEN 'S' THEN 6 ELSE 0
  END
`;
// Для u.overall_rank в JOIN-ах
const U_RANK_NUM_SQL = `
  CASE REPLACE(COALESCE(u.overall_rank,'F'),'+','')
    WHEN 'F' THEN 0 WHEN 'E' THEN 1 WHEN 'D' THEN 2 WHEN 'C' THEN 3
    WHEN 'B' THEN 4 WHEN 'A' THEN 5 WHEN 'S' THEN 6 ELSE 0
  END
`;

function formatSkillRow(s) {
  const rank = s.rank || 'F';
  const base = baseOf(rank);
  return {
    id: s.skill_id,
    name: s.name,
    rank,
    baseRank: base,
    plus: rank.endsWith('+'),
    title: getTitleByRank(base),
    days: s.days || 0,
    activeYears: s.active_years || 0,
    streak: s.current_streak || 0,
    bestStreak: s.best_streak || 0,
    categoryIcon: s.category_icon,
    subcategoryIcon: s.subcategory_icon,
  };
}


// ============================================
// Вспомогательная: собрать полный профиль
// ============================================

function buildProfile(userId, viewerId) {
  const ownProfile = isSameUserId(userId, viewerId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;

  // Навыки + уник. дни чекинов
  const skills = db.prepare(`
    SELECT us.*, s.name, s.slug, s.description,
           sc.name as subcategory_name, sc.icon as subcategory_icon,
           c.name as category_name, c.icon as category_icon, c.id as category_id,
           (SELECT COUNT(DISTINCT date) FROM checkins
              WHERE user_id = us.user_id AND skill_id = us.skill_id) as days
    FROM user_skills us
    JOIN skills s ON us.skill_id = s.id
    JOIN subcategories sc ON s.subcategory_id = sc.id
    JOIN categories c ON sc.category_id = c.id
    WHERE us.user_id = ?
  `).all(userId);

  // Сортировка по рангу (DESC), потом по дням
  skills.sort((a, b) => {
    const d = rankIndex(b.rank) - rankIndex(a.rank);
    if (d !== 0) return d;
    return (b.days || 0) - (a.days || 0);
  });

  // Группировка по категориям
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
    catMap.get(s.category_id).skills.push(formatSkillRow(s));
  }

  // Достижения
  const achievements = db.prepare(`
    SELECT a.*, ua.earned_at
    FROM user_achievements ua
    JOIN achievements a ON ua.achievement_id = a.id
    WHERE ua.user_id = ?
    ORDER BY ua.earned_at DESC
  `).all(userId);

  // Социалка
  const followers = db.prepare(
    'SELECT COUNT(*) as c FROM follows WHERE following_id = ?'
  ).get(userId).c;

  const following = db.prepare(
    'SELECT COUNT(*) as c FROM follows WHERE follower_id = ?'
  ).get(userId).c;

  const isFollowing = !ownProfile
    ? !!db.prepare(
        'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?'
      ).get(viewerId, userId)
    : false;

  const followsMe = !ownProfile
    ? !!db.prepare(
        'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?'
      ).get(userId, viewerId)
    : false;

  const mutualFollow = isFollowing && followsMe;

  // Статистика
  const totalCheckins = db.prepare(
    'SELECT COUNT(*) as c FROM checkins WHERE user_id = ?'
  ).get(userId).c;

  const totalEndorsements = db.prepare(
    'SELECT COUNT(*) as c FROM endorsements WHERE to_user_id = ?'
  ).get(userId).c;

  // Бейджи
  const publicBadges = badgeLib.getUserBadgesForApi(userId);
  const badgeKeys = [...new Set(badgeLib.getVisibleUserBadgeKeys(userId))];

  const mapBadgeToClient = (b) => ({
    code: b.code || '',
    name: b.name || '',
    icon: b.icon || '🏷️',
    color: b.color || '#888',
    ...(b.description ? { description: b.description } : {}),
    ...(b.earned_at ? { earned_at: b.earned_at } : {}),
    ...(Object.prototype.hasOwnProperty.call(b, 'visible')
      ? { visible: b.visible !== false }
      : {})
  });

  const badgeDetails = publicBadges.map(mapBadgeToClient);

  const overallRank = user.overall_rank || 'F';
  const overallBase = baseOf(overallRank);

  const userPayload = {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    username: user.username,
    profileText: user.profile_text || '',
    showProfileText: !!user.show_profile_text,
    photoUrl: user.photo_url,
    overallRank,
    overallBaseRank: overallBase,
    overallPlus: overallRank.endsWith('+'),
    overallTitle: getTitleByRank(overallBase),
    badges: badgeDetails,
    badgeKeys,
    isOwn: ownProfile,
    createdAt: user.created_at,
  };

  if (ownProfile) {
    const ownerBadges = badgeLib.getUserBadgesForApi(userId, { includeVisibility: true });
    userPayload.badgesAll = ownerBadges.map(mapBadgeToClient);
  }

  return {
    user: userPayload,
    categories: Array.from(catMap.values()),
    achievements: achievements.map(a => ({
      id: a.id, code: a.code, name: a.name,
      description: a.description, icon: a.icon, rarity: a.rarity,
    })),
    social: { followers, following, isFollowing, followsMe, mutualFollow },
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
// ============================================
router.put('/me', (req, res) => {
  try {
    const firstName = String(req.body.firstName || '').trim();
    const lastName = String(req.body.lastName || '').trim();
    const profileText = String(req.body.profileText || '').trim();
    const showProfileText = req.body.showProfileText ? 1 : 0;

    if (!firstName) return res.status(400).json({ error: 'Имя не может быть пустым' });
    if (firstName.length > 64 || lastName.length > 64) {
      return res.status(400).json({ error: 'Слишком длинное имя' });
    }
    if (profileText.length > 48) {
      return res.status(400).json({ error: 'Слишком длинный текст профиля' });
    }

    if (req.body.badges && Array.isArray(req.body.badges)) {
      for (const b of req.body.badges) {
        const code = String(b?.code || '').trim();
        if (!code) continue;
        if (!badgeLib.hasBadge(req.userId, code)) continue;
        badgeLib.setBadgeVisibility(req.userId, code, b.visible !== false);
      }
    }

    db.prepare(`
      UPDATE users
      SET first_name = ?, last_name = ?, profile_text = ?, show_profile_text = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(firstName, lastName, profileText, showProfileText, req.userId);

    const data = buildProfile(req.userId, req.userId);
    res.json({ message: 'Профиль обновлён', user: data.user });
  } catch (error) {
    console.error('❌ Обновление профиля:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// POST /api/profile/me/reset
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
      db.prepare('DELETE FROM user_badges WHERE user_id = ?').run(userId);
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
// GET /api/profile/search/users
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
      // Поиск по навыку — сортируем по рангу скилла (числовой индекс)
      query = `
        SELECT DISTINCT u.id, u.first_name, u.last_name, u.username,
               u.photo_url, u.overall_rank,
               us.rank as skill_rank,
               ${SKILL_RANK_NUM_SQL} as skill_rank_num
        FROM users u
        JOIN user_skills us ON u.id = us.user_id
        JOIN skills s ON us.skill_id = s.id
        WHERE s.slug = ?
        ${rank ? 'AND REPLACE(us.rank,\'+\',\'\') = ?' : ''}
        ORDER BY skill_rank_num DESC
        LIMIT ? OFFSET ?
      `;
      params = rank
        ? [skill, baseOf(rank), limit + 1, page * limit]
        : [skill, limit + 1, page * limit];
    } else if (q.length >= 2) {
      // Поиск по имени — сортируем по общему рангу
      query = `
        SELECT id, first_name, last_name, username,
               photo_url, overall_rank,
               ${RANK_NUM_SQL} as rank_num
        FROM users
        WHERE first_name LIKE ? OR last_name LIKE ? OR username LIKE ?
        ORDER BY rank_num DESC
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

    const users = sliced.map(u => {
      const r = u.overall_rank || 'F';
      return {
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        username: u.username,
        photoUrl: u.photo_url,
        rank: r,
        baseRank: baseOf(r),
        plus: r.endsWith('+'),
        title: getTitleByRank(baseOf(r)),
        skillRank: u.skill_rank || null,
        badgeKeys: badgeMap.get(u.id) || [],
      };
    });

    res.json({ users, hasMore, page });

  } catch (error) {
    console.error('❌ Поиск:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// GET /api/profile/top/users  (лидерборд)
// ============================================

router.get('/top/users', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    // Топ: только те, у кого есть хотя бы один чекин (есть прогресс)
    const rows = db.prepare(`
      SELECT id, first_name, last_name, username,
             photo_url, overall_rank,
             ${RANK_NUM_SQL} as rank_num,
             (SELECT COUNT(*) FROM checkins WHERE user_id = users.id) as total_checkins
      FROM users
      WHERE EXISTS (SELECT 1 FROM checkins WHERE user_id = users.id)
      ORDER BY rank_num DESC, total_checkins DESC
      LIMIT ?
    `).all(limit);

    const badgeMap = badgeLib.getVisibleBadgeKeysMap(rows.map(r => r.id));

    res.json({
      users: rows.map((u, i) => {
        const r = u.overall_rank || 'F';
        return {
          id: u.id,
          firstName: u.first_name,
          lastName: u.last_name,
          username: u.username,
          photoUrl: u.photo_url,
          rank: r,
          baseRank: baseOf(r),
          plus: r.endsWith('+'),
          title: getTitleByRank(baseOf(r)),
          position: i + 1,
          badgeKeys: badgeMap.get(u.id) || [],
        };
      })
    });

  } catch (error) {
    console.error('❌ Топ:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// GET /api/profile/:userId
// ============================================

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

    const skillsRouter = require('./skills');
    const followerCount = db.prepare(
      'SELECT COUNT(*) as c FROM follows WHERE following_id = ?'
    ).get(followingId).c;

    if (followerCount >= 1)   skillsRouter.grantAchievement?.(followingId, 'first_follower');
    if (followerCount >= 10)  skillsRouter.grantAchievement?.(followingId, 'ten_followers');
    if (followerCount >= 25)  skillsRouter.grantAchievement?.(followingId, 'twenty_five_follow');
    if (followerCount >= 50)  skillsRouter.grantAchievement?.(followingId, 'fifty_followers');
    if (followerCount >= 100) skillsRouter.grantAchievement?.(followingId, 'hundred_followers');

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
             u.photo_url, u.overall_rank
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
      users: users.map(u => {
        const r = u.overall_rank || 'F';
        return {
          id: u.id,
          firstName: u.first_name,
          lastName: u.last_name,
          username: u.username,
          photoUrl: u.photo_url,
          rank: r,
          baseRank: baseOf(r),
          plus: r.endsWith('+'),
          title: getTitleByRank(baseOf(r)),
          badgeKeys: badgeMap.get(u.id) || [],
        };
      }),
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
             u.photo_url, u.overall_rank
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
      users: users.map(u => {
        const r = u.overall_rank || 'F';
        return {
          id: u.id,
          firstName: u.first_name,
          lastName: u.last_name,
          username: u.username,
          photoUrl: u.photo_url,
          rank: r,
          baseRank: baseOf(r),
          plus: r.endsWith('+'),
          title: getTitleByRank(baseOf(r)),
          badgeKeys: badgeMap.get(u.id) || [],
        };
      }),
      total
    });

  } catch (error) {
    console.error('❌ Подписки:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


module.exports = router;
