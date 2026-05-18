// ============================================
// routes/auth.js — Авторизация v4
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const badgeLib = require('../lib/badges');
const { RANK_ORDER, getTitleByRank } = require('../lib/ranks');

// ID создателя
const CREATOR_ID = parseInt(process.env.CREATOR_ID) || null;

// ============================================
// Подготовленные запросы
// ============================================

const findUser = db.prepare('SELECT * FROM users WHERE id = ?');

const createUser = db.prepare(`
  INSERT INTO users (id, first_name, last_name, username, photo_url, language_code)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const updateUser = db.prepare(`
  UPDATE users
  SET first_name = ?, last_name = ?, username = ?, photo_url = ?,
      language_code = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

// Сортируем скиллы: сначала по числовому рангу (DESC), потом по уник. дням чекинов
const getUserSkills = db.prepare(`
  SELECT us.*, s.name, s.slug, s.description,
         sc.name as subcategory_name, sc.icon as subcategory_icon,
         c.name as category_name, c.icon as category_icon, c.id as category_id,
         (COALESCE(us.initial_days, 0) + (
           SELECT COUNT(DISTINCT date) FROM checkins
           WHERE user_id = us.user_id AND skill_id = us.skill_id
         )) as days
  FROM user_skills us
  JOIN skills s ON us.skill_id = s.id
  JOIN subcategories sc ON s.subcategory_id = sc.id
  JOIN categories c ON sc.category_id = c.id
  WHERE us.user_id = ?
`);

const getUserAchievements = db.prepare(`
  SELECT a.*, ua.earned_at, ua.skill_id
  FROM user_achievements ua
  JOIN achievements a ON ua.achievement_id = a.id
  WHERE ua.user_id = ?
  ORDER BY ua.earned_at DESC
`);

const getFollowCounts = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM follows WHERE following_id = ?) as followers,
    (SELECT COUNT(*) FROM follows WHERE follower_id = ?) as following
`);


// ============================================
// Хелперы
// ============================================

// Базовый ранг без + ('A+' → 'A')
function baseOf(rank) {
  return String(rank || 'F').replace('+', '');
}

// Числовой индекс ранга для сортировки (F=0 ... S=6)
function rankIndex(rank) {
  return RANK_ORDER.indexOf(baseOf(rank));
}

// Сериализация скилла для ответа
function formatSkill(s) {
  const rank = s.rank || 'F';
  const base = baseOf(rank);
  const plus = rank.endsWith('+');
  return {
    id: s.skill_id,
    name: s.name,
    slug: s.slug,
    rank,                                    // 'F' .. 'S', может с '+'
    baseRank: base,
    plus,
    title: getTitleByRank(base),             // 'Практик'... или null
    days: s.days || 0,                       // уник. дней чекинов
    initialDays: s.initial_days || 0,
    classVisible: Number(s.class_visible) === 1,
    streak: s.current_streak || 0,
    bestStreak: s.best_streak || 0,
    categoryIcon: s.category_icon,
    subcategoryIcon: s.subcategory_icon,
  };
}


// ============================================
// POST /api/auth/login
// ============================================

router.post('/login', (req, res) => {
  try {
    const { initData } = req.body;

    if (!initData && process.env.NODE_ENV !== 'development') {
      return res.status(400).json({ error: 'initData обязателен' });
    }

    const tgUser = req.app.validateTelegramData(initData || '');
    if (!tgUser) {
      return res.status(403).json({ error: 'Невалидные данные Telegram' });
    }

    let user = findUser.get(tgUser.id);
    let isNew = false;

    if (!user) {
      isNew = true;
      createUser.run(
        tgUser.id,
        tgUser.username || tgUser.first_name || 'User',
        tgUser.last_name || '',
        tgUser.username || '',
        tgUser.photo_url || '',
        tgUser.language_code || 'ru'
      );
      user = findUser.get(tgUser.id);
      console.log(`👤 Новый пользователь: ${user.first_name} (#${user.id})`);

      if (CREATOR_ID && tgUser.id === CREATOR_ID) {
        badgeLib.grantBadge(tgUser.id, 'creator', 'system');
      }
    } else {
      updateUser.run(
        user.first_name || tgUser.username || tgUser.first_name || 'User',
        user.last_name  || tgUser.last_name || '',
        user.username   || tgUser.username  || '',
        tgUser.photo_url || user.photo_url,
        tgUser.language_code || user.language_code,
        tgUser.id
      );
      user = findUser.get(tgUser.id);

      if (CREATOR_ID && tgUser.id === CREATOR_ID) {
        badgeLib.grantBadge(tgUser.id, 'creator', 'system');
      }
    }

    // Временно: бейдж early_adopter выдаётся всем пользователям по умолчанию
    badgeLib.maybeGrantEarlyAdopter(tgUser.id);

    // Скиллы и сортировка по рангу
    const rawSkills = getUserSkills.all(user.id);
    rawSkills.sort((a, b) => {
      const ra = rankIndex(a.rank);
      const rb = rankIndex(b.rank);
      if (rb !== ra) return rb - ra;       // выше ранг — выше в списке
      return (b.days || 0) - (a.days || 0); // потом по дням
    });

    const achievements = getUserAchievements.all(user.id);
    const social = getFollowCounts.get(user.id, user.id);

    // Группировка по категориям
    const categoriesMap = new Map();
    for (const skill of rawSkills) {
      if (!categoriesMap.has(skill.category_id)) {
        categoriesMap.set(skill.category_id, {
          id: skill.category_id,
          name: skill.category_name,
          icon: skill.category_icon,
          skills: []
        });
      }
      categoriesMap.get(skill.category_id).skills.push(formatSkill(skill));
    }

    // Возвращаем visibility, чтобы клиент корректно скрывал бейджи на карточке
    const badgeDetails = badgeLib.getUserBadgesForApi(user.id, { includeVisibility: true });
    const badgeKeys = [...new Set(badgeLib.getVisibleUserBadgeKeys(user.id))];

    const totalCheckins = db.prepare(
      'SELECT COUNT(*) as c FROM checkins WHERE user_id = ?'
    ).get(user.id).c;

    const totalEndorsements = db.prepare(
      'SELECT COUNT(*) as c FROM endorsements WHERE to_user_id = ?'
    ).get(user.id).c;

    const overallRank = user.overall_rank || 'F';
    const overallBase = baseOf(overallRank);

    res.json({
      isNew,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        profileText: user.profile_text || '',
        showProfileText: !!user.show_profile_text,
        photoUrl: user.photo_url,
        overallRank,                                 // 'F'..'S', может с '+'
        overallBaseRank: overallBase,
        overallPlus: overallRank.endsWith('+'),
        overallTitle: getTitleByRank(overallBase),   // 'Мастер' и т.п. или null
        badges: badgeDetails,
        badgeKeys,
        createdAt: user.created_at,
      },
      skills: rawSkills.map(formatSkill),
      categories: Array.from(categoriesMap.values()),
      achievements: achievements.map(a => ({
        id: a.id,
        code: a.code,
        name: a.name,
        description: a.description,
        icon: a.icon,
        rarity: a.rarity,
        earnedAt: a.earned_at,
      })),
      social: {
        followers: social.followers,
        following: social.following,
      },
      stats: {
        totalSkills: rawSkills.length,
        totalCheckins,
        receivedEndorsements: totalEndorsements,
      }
    });

  } catch (error) {
    console.error('❌ Ошибка авторизации:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// GET /api/auth/check
// ============================================

router.get('/check', (req, res) => {
  try {
    const initData = req.headers['x-telegram-init-data'];
    if (!initData) return res.status(401).json({ authorized: false });

    const tgUser = req.app.validateTelegramData(initData);
    if (!tgUser) return res.status(403).json({ authorized: false });

    const user = findUser.get(tgUser.id);
    if (!user) return res.json({ authorized: false });

    res.json({
      authorized: true,
      user: {
        id: user.id,
        firstName: user.first_name,
        overallRank: user.overall_rank || 'F',
      }
    });
  } catch (error) {
    console.error('❌ Проверка авторизации:', error.message);
    res.status(500).json({ error: 'ошибка сервера' });
  }
});


module.exports = router;
