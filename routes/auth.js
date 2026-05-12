// ============================================
// routes/auth.js — Авторизация v3
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../database');

// ID создателя — ЗАМЕНИ НА СВОЙ Telegram ID
const CREATOR_ID = parseInt(process.env.CREATOR_ID) || null;

// ============================================
// Подготовленные запросы
// ============================================

const findUser = db.prepare('SELECT * FROM users WHERE id = ?');

const createUser = db.prepare(`
  INSERT INTO users (id, first_name, last_name, username, photo_url, language_code, badges)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const updateUser = db.prepare(`
  UPDATE users
  SET first_name = ?, last_name = ?, username = ?, photo_url = ?,
      language_code = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const getUserSkills = db.prepare(`
  SELECT us.*, s.name, s.slug, s.description,
         sc.name as subcategory_name, sc.icon as subcategory_icon,
         c.name as category_name, c.icon as category_icon, c.id as category_id
  FROM user_skills us
  JOIN skills s ON us.skill_id = s.id
  JOIN subcategories sc ON s.subcategory_id = sc.id
  JOIN categories c ON sc.category_id = c.id
  WHERE us.user_id = ?
  ORDER BY (us.foundation_xp + us.bonus_xp) DESC
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
// POST /api/auth/login
// ============================================

router.post('/login', (req, res) => {
  try {
    const { initData } = req.body;

    // В DEV пропускаем без initData
    if (!initData && process.env.NODE_ENV !== 'development') {
      return res.status(400).json({ error: 'initData обязателен' });
    }

    // Валидируем данные Telegram
    const tgUser = req.app.validateTelegramData(initData || '');
    if (!tgUser) {
      return res.status(403).json({ error: 'Невалидные данные Telegram' });
    }

    // Ищем или создаём пользователя
    let user = findUser.get(tgUser.id);
    let isNew = false;

    if (!user) {
      // Новый пользователь
      isNew = true;

      // Бейджи для нового пользователя
      const badges = [];
      if (CREATOR_ID && tgUser.id === CREATOR_ID) {
        badges.push('creator');
      }

      createUser.run(
        tgUser.id,
        tgUser.first_name || 'User',
        tgUser.last_name || '',
        tgUser.username || '',
        tgUser.photo_url || '',
        tgUser.language_code || 'ru',
        JSON.stringify(badges)
      );

      user = findUser.get(tgUser.id);
      console.log(`👤 Новый пользователь: ${user.first_name} (#${user.id})`);

    } else {
      // Обновляем данные
      updateUser.run(
        tgUser.first_name || user.first_name,
        tgUser.last_name || user.last_name,
        tgUser.username || user.username,
        tgUser.photo_url || user.photo_url,
        tgUser.language_code || user.language_code,
        tgUser.id
      );
      user = findUser.get(tgUser.id);

      // Проверяем бейдж создателя
      if (CREATOR_ID && tgUser.id === CREATOR_ID) {
        const skillsRouter = require('./skills');
        skillsRouter.addBadge(tgUser.id, 'creator');
      }
    }

    // Собираем данные профиля
    const skills = getUserSkills.all(user.id);
    const achievements = getUserAchievements.all(user.id);
    const social = getFollowCounts.get(user.id, user.id);

    // Группируем навыки по категориям
    const categoriesMap = new Map();
    for (const skill of skills) {
      if (!categoriesMap.has(skill.category_id)) {
        categoriesMap.set(skill.category_id, {
          id: skill.category_id,
          name: skill.category_name,
          icon: skill.category_icon,
          skills: []
        });
      }
      categoriesMap.get(skill.category_id).skills.push({
        id: skill.skill_id,
        name: skill.name,
        slug: skill.slug,
        rank: skill.rank || 'F',
        totalXP: (skill.foundation_xp || 0) + (skill.bonus_xp || 0),
        foundationXP: skill.foundation_xp || 0,
        bonusXP: skill.bonus_xp || 0,
        totalYears: skill.total_years || 0,
        activeYears: skill.active_years || 0,
        streak: skill.current_streak || 0,
        bestStreak: skill.best_streak || 0,
        categoryIcon: skill.category_icon,
        subcategoryIcon: skill.subcategory_icon,
      });
    }

    // Парсим бейджи
    let badges = [];
    try { badges = JSON.parse(user.badges || '[]'); }
    catch { badges = []; }

    const skillsRouter = require('./skills');
    const badgeDetails = badges.map(b => ({
      code: b,
      ...(skillsRouter.BADGE_INFO[b] || { name: b, icon: '🏷️', color: '#888' })
    }));

    // Статистика
    const totalCheckins = db.prepare(
      'SELECT COUNT(*) as c FROM checkins WHERE user_id = ?'
    ).get(user.id).c;

    const totalEndorsements = db.prepare(
      'SELECT COUNT(*) as c FROM endorsements WHERE to_user_id = ?'
    ).get(user.id).c;

    res.json({
      isNew,
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
        createdAt: user.created_at,
      },
      skills: skills.map(s => ({
        id: s.skill_id,
        name: s.name,
        rank: s.rank || 'F',
        totalXP: (s.foundation_xp || 0) + (s.bonus_xp || 0),
        streak: s.current_streak || 0,
        categoryIcon: s.category_icon,
      })),
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
        totalSkills: skills.length,
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
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


module.exports = router;