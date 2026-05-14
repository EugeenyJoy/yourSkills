// ============================================
// routes/skills.js — Навыки, XP, Ранги v3
// ============================================
// Ранги: F → E → D → C → B → A → S
// Подкатегории
// Два типа опыта: total_years + active_years
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const authMiddleware = require('../middleware/auth');


// ============================================
// КОНСТАНТЫ
// ============================================

const RANK_THRESHOLDS = [
  { rank: 'S', min: 30000 },
  { rank: 'A', min: 15000 },
  { rank: 'B', min: 7000 },
  { rank: 'C', min: 2500 },
  { rank: 'D', min: 800 },
  { rank: 'E', min: 200 },
  { rank: 'F', min: 0 },
];

const RANK_VALUES = { 'F': 0, 'E': 1, 'D': 2, 'C': 3, 'B': 4, 'A': 5, 'S': 6 };

// XP за реальный опыт (active_years)
const ACTIVE_XP_TABLE = [
  { years: 20, xp: 10000 },
  { years: 15, xp: 8000 },
  { years: 10, xp: 6000 },
  { years: 7,  xp: 4500 },
  { years: 5,  xp: 3500 },
  { years: 3,  xp: 2000 },
  { years: 2,  xp: 1200 },
  { years: 1,  xp: 600 },
  { years: 0.5, xp: 300 },
  { years: 0,  xp: 0 },
];

// XP за общий стаж (total_years) — бонус
const TOTAL_XP_TABLE = [
  { years: 20, xp: 2000 },
  { years: 15, xp: 1500 },
  { years: 10, xp: 1000 },
  { years: 5,  xp: 500 },
  { years: 3,  xp: 300 },
  { years: 1,  xp: 100 },
  { years: 0,  xp: 0 },
];

// Вес подтверждения по рангу подтверждающего
const ENDORSEMENT_WEIGHT = {
  'S': 300, 'A': 150, 'B': 80, 'C': 40, 'D': 20, 'E': 10, 'F': 5
};

// Стрик множители
const STREAK_MULTIPLIERS = [
  { days: 365, mult: 3.0 },
  { days: 200, mult: 2.7 },
  { days: 100, mult: 2.3 },
  { days: 60,  mult: 2.0 },
  { days: 30,  mult: 1.7 },
  { days: 14,  mult: 1.4 },
  { days: 7,   mult: 1.2 },
  { days: 3,   mult: 1.1 },
  { days: 0,   mult: 1.0 },
];

// XP за ежедневный чекин (зависит от стрика)
const STREAK_DAILY_XP = [
  { days: 365, xp: 120 },
  { days: 200, xp: 80 },
  { days: 100, xp: 60 },
  { days: 60,  xp: 40 },
  { days: 30,  xp: 30 },
  { days: 14,  xp: 20 },
  { days: 7,   xp: 12 },
  { days: 3,   xp: 8 },
  { days: 0,   xp: 5 },
];


// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function getRank(xp) {
  for (const t of RANK_THRESHOLDS) {
    if (xp >= t.min) return t.rank;
  }
  return 'F';
}

function getRankInfo(xp) {
  let current = RANK_THRESHOLDS[RANK_THRESHOLDS.length - 1];
  let next = null;

  for (let i = 0; i < RANK_THRESHOLDS.length; i++) {
    if (xp >= RANK_THRESHOLDS[i].min) {
      current = RANK_THRESHOLDS[i];
      next = i > 0 ? RANK_THRESHOLDS[i - 1] : null;
      break;
    }
  }

  let progress = 100;
  if (next) {
    const range = next.min - current.min;
    progress = range > 0 ? Math.floor(((xp - current.min) / range) * 100) : 100;
    progress = Math.max(0, Math.min(100, progress));
  }

  return {
    rank: current.rank,
    xp,
    progress,
    nextRank: next ? next.rank : null,
    nextRankAt: next ? next.min : null,
    xpToNext: next ? Math.max(0, next.min - xp) : 0
  };
}

function calcActiveXP(years) {
  for (const t of ACTIVE_XP_TABLE) {
    if (years >= t.years) return t.xp;
  }
  return 0;
}

function calcTotalXP(years) {
  for (const t of TOTAL_XP_TABLE) {
    if (years >= t.years) return t.xp;
  }
  return 0;
}

function getStreakMultiplier(days) {
  for (const t of STREAK_MULTIPLIERS) {
    if (days >= t.days) return t.mult;
  }
  return 1.0;
}

function getStreakDailyXP(days) {
  for (const t of STREAK_DAILY_XP) {
    if (days >= t.days) return t.xp;
  }
  return 5;
}

function rankValue(rank) {
  return RANK_VALUES[rank] || 0;
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function dateOffset(offset, from) {
  const d = from ? new Date(from) : new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

function daysBetween(d1, d2) {
  return Math.floor(Math.abs(new Date(d2) - new Date(d1)) / 86400000);
}


// ============================================
// СТРИК
// ============================================

function calcStreak(userId, skillId) {
  const rows = db.prepare(`
    SELECT date FROM checkins
    WHERE user_id = ? AND skill_id = ?
    ORDER BY date DESC LIMIT 400
  `).all(userId, skillId);

  if (rows.length === 0) return 0;

  const today = todayStr();
  const yesterday = dateOffset(-1);
  const latest = rows[0].date;

  // Стрик считается если последний чекин — сегодня или вчера
  if (latest !== today && latest !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < rows.length; i++) {
    const expected = dateOffset(-i, latest);
    if (rows[i].date === expected) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}


// ============================================
// ДЕГРАДАЦИЯ БОНУСА
// ============================================

function decayBonus(bonusXP, daysInactive) {
  if (daysInactive <= 30) return bonusXP;
  // После 30 дней: теряем 1% в день, максимум 100%
  const decay = Math.min(0.01 * (daysInactive - 30), 1.0);
  return Math.floor(bonusXP * (1 - decay));
}


// ============================================
// ПЕРЕСЧЁТ XP НАВЫКА
// ============================================

function recalcSkill(userId, skillId) {
  const us = db.prepare(
    'SELECT * FROM user_skills WHERE user_id = ? AND skill_id = ?'
  ).get(userId, skillId);
  if (!us) return null;

  // 1. XP за опыт
  const activeXP = calcActiveXP(us.active_years || 0);
  const totalXP = calcTotalXP(us.total_years || 0);
  const experienceXP = activeXP + totalXP;

  // 2. XP за подтверждения
  const endorseXP = db.prepare(`
    SELECT COALESCE(SUM(xp_given), 0) as total
    FROM endorsements WHERE to_user_id = ? AND skill_id = ?
  `).get(userId, skillId).total;

  // 3. XP за достижения привязанные к этому навыку
  const achieveXP = db.prepare(`
    SELECT COALESCE(SUM(a.xp_reward), 0) as total
    FROM user_achievements ua
    JOIN achievements a ON ua.achievement_id = a.id
    WHERE ua.user_id = ? AND ua.skill_id = ?
  `).get(userId, skillId).total;

  // 4. Фундамент (не деградирует)
  const foundationXP = experienceXP + endorseXP + achieveXP;

  // 5. Бонус (стрик — деградирует)
  const streak = calcStreak(userId, skillId);
  let bonusXP = us.bonus_xp || 0;

  if (streak === 0) {
    const last = db.prepare(`
      SELECT date FROM checkins
      WHERE user_id = ? AND skill_id = ?
      ORDER BY date DESC LIMIT 1
    `).get(userId, skillId);

    if (last) {
      bonusXP = decayBonus(bonusXP, daysBetween(last.date, todayStr()));
    }
  }

  // 6. Итого
  const total = foundationXP + bonusXP;
  const newRank = getRank(total);
  const oldRank = us.rank || 'F';

  // 7. Сохраняем
  db.prepare(`
    UPDATE user_skills
    SET foundation_xp = ?, bonus_xp = ?, rank = ?,
        current_streak = ?, best_streak = MAX(best_streak, ?)
    WHERE user_id = ? AND skill_id = ?
  `).run(foundationXP, bonusXP, newRank, streak, streak, userId, skillId);

  // 8. Повышение ранга?
  if (rankValue(newRank) > rankValue(oldRank)) {
    onRankUp(userId, skillId, oldRank, newRank);
  }

  // 9. Общий ранг
  recalcOverallRank(userId);

  return {
    foundationXP,
    bonusXP,
    totalXP: total,
    rank: newRank,
    rankInfo: getRankInfo(total),
    streak,
    bestStreak: Math.max(us.best_streak || 0, streak),
    multiplier: getStreakMultiplier(streak)
  };
}


// ============================================
// ПОВЫШЕНИЕ РАНГА
// ============================================

function onRankUp(userId, skillId, oldRank, newRank) {
  const skill = db.prepare('SELECT name FROM skills WHERE id = ?').get(skillId);

  // Событие в ленту
  db.prepare(`
    INSERT INTO feed_events (user_id, event_type, event_data)
    VALUES (?, 'rank_up', ?)
  `).run(userId, JSON.stringify({
    skill: skill?.name || '???',
    skillId,
    oldRank,
    newRank
  }));

  // Достижения за ранг навыка
  const rankCodes = {
    'E': 'rank_e', 'D': 'rank_d', 'C': 'rank_c',
    'B': 'rank_b', 'A': 'rank_a', 'S': 'rank_s'
  };
  if (rankCodes[newRank]) {
    grantAchievement(userId, rankCodes[newRank], skillId);
  }

  // Достижения за множественные ранги
  const bPlus = db.prepare(`
    SELECT COUNT(*) as c FROM user_skills
    WHERE user_id = ? AND rank IN ('B','A','S')
  `).get(userId).c;
  if (bPlus >= 3) grantAchievement(userId, 'multi_rank_b');

  const aPlus = db.prepare(`
    SELECT COUNT(*) as c FROM user_skills
    WHERE user_id = ? AND rank IN ('A','S')
  `).get(userId).c;
  if (aPlus >= 2) grantAchievement(userId, 'multi_rank_a');
  if (aPlus >= 3) grantAchievement(userId, 'multi_rank_a3');
}


// ============================================
// ОБЩИЙ РАНГ
// ============================================

function recalcOverallRank(userId) {
  // Берём лучший навык из каждой КАТЕГОРИИ (не подкатегории)
  const perCategory = db.prepare(`
    SELECT c.id,
           MAX(us.foundation_xp + us.bonus_xp) as best_xp
    FROM user_skills us
    JOIN skills s ON us.skill_id = s.id
    JOIN subcategories sc ON s.subcategory_id = sc.id
    JOIN categories c ON sc.category_id = c.id
    WHERE us.user_id = ?
    GROUP BY c.id
  `).all(userId);

  if (perCategory.length === 0) {
    db.prepare('UPDATE users SET overall_xp = 0, overall_rank = ? WHERE id = ?')
      .run('F', userId);
    return;
  }

  // Среднее XP по лучшим навыкам категорий + бонус за разнообразие
  const avg = perCategory.reduce((s, c) => s + c.best_xp, 0) / perCategory.length;
  const diversityBonus = Math.min(perCategory.length * 300, 2000);
  const overallXP = Math.floor(avg + diversityBonus);
  const overallRank = getRank(overallXP);

  const old = db.prepare('SELECT overall_rank FROM users WHERE id = ?').get(userId);
  const oldRank = old ? old.overall_rank : 'F';

  db.prepare('UPDATE users SET overall_xp = ?, overall_rank = ? WHERE id = ?')
    .run(overallXP, overallRank, userId);

  // Достижения за общий ранг
  if (rankValue(overallRank) > rankValue(oldRank)) {
    const codes = {
      'E': 'overall_e', 'D': 'overall_d', 'C': 'overall_c',
      'B': 'overall_b', 'A': 'overall_a', 'S': 'overall_s'
    };
    if (codes[overallRank]) grantAchievement(userId, codes[overallRank]);
  }
}


// ============================================
// ДОСТИЖЕНИЯ
// ============================================

function grantAchievement(userId, code, skillId) {
  const a = db.prepare('SELECT * FROM achievements WHERE code = ?').get(code);
  if (!a) return null;

  const sid = skillId || null;

  // Проверяем что ещё не получено
  const exists = db.prepare(`
    SELECT id FROM user_achievements
    WHERE user_id = ? AND achievement_id = ?
      AND (skill_id IS ? OR (skill_id IS NULL AND ? IS NULL))
  `).get(userId, a.id, sid, sid);

  if (exists) return null;

  db.prepare(`
    INSERT INTO user_achievements (user_id, achievement_id, skill_id)
    VALUES (?, ?, ?)
  `).run(userId, a.id, sid);

  // Событие в ленту
  db.prepare(`
    INSERT INTO feed_events (user_id, event_type, event_data)
    VALUES (?, 'achievement', ?)
  `).run(userId, JSON.stringify({
    code: a.code, name: a.name, icon: a.icon,
    xp: a.xp_reward, rarity: a.rarity
  }));

  return a;
}

function checkSkillAchievements(userId) {
  const count = db.prepare(
    'SELECT COUNT(*) as c FROM user_skills WHERE user_id = ?'
  ).get(userId).c;

  if (count >= 1)  grantAchievement(userId, 'first_skill');
  if (count >= 3)  grantAchievement(userId, 'three_skills');
  if (count >= 5)  grantAchievement(userId, 'five_skills');
  if (count >= 10) grantAchievement(userId, 'ten_skills');
  if (count >= 20) grantAchievement(userId, 'twenty_skills');
  if (count >= 30) grantAchievement(userId, 'thirty_skills');
  if (count >= 50) grantAchievement(userId, 'fifty_skills');

  // Количество КАТЕГОРИЙ (не подкатегорий)
  const catCount = db.prepare(`
    SELECT COUNT(DISTINCT c.id) as c
    FROM user_skills us
    JOIN skills s ON us.skill_id = s.id
    JOIN subcategories sc ON s.subcategory_id = sc.id
    JOIN categories c ON sc.category_id = c.id
    WHERE us.user_id = ?
  `).get(userId).c;

  if (catCount >= 3)  grantAchievement(userId, 'three_categories');
  if (catCount >= 5)  grantAchievement(userId, 'five_categories');
  if (catCount >= 8)  grantAchievement(userId, 'eight_categories');

  const totalCats = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
  if (catCount >= totalCats) grantAchievement(userId, 'all_categories');
}

function checkVeteranAchievements(userId, skillId, activeYears) {
  if (activeYears >= 3)  grantAchievement(userId, 'veteran_3', skillId);
  if (activeYears >= 5)  grantAchievement(userId, 'veteran_5', skillId);
  if (activeYears >= 10) grantAchievement(userId, 'veteran_10', skillId);
  if (activeYears >= 15) grantAchievement(userId, 'veteran_15', skillId);
  if (activeYears >= 20) grantAchievement(userId, 'veteran_20', skillId);
}

function checkStreakAchievements(userId, skillId, streak) {
  if (streak >= 3)   grantAchievement(userId, 'streak_3', skillId);
  if (streak >= 7)   grantAchievement(userId, 'streak_7', skillId);
  if (streak >= 14)  grantAchievement(userId, 'streak_14', skillId);
  if (streak >= 21)  grantAchievement(userId, 'streak_21', skillId);
  if (streak >= 30)  grantAchievement(userId, 'streak_30', skillId);
  if (streak >= 60)  grantAchievement(userId, 'streak_60', skillId);
  if (streak >= 90)  grantAchievement(userId, 'streak_90', skillId);
  if (streak >= 100) grantAchievement(userId, 'streak_100', skillId);
  if (streak >= 150) grantAchievement(userId, 'streak_150', skillId);
  if (streak >= 200) grantAchievement(userId, 'streak_200', skillId);
  if (streak >= 300) grantAchievement(userId, 'streak_300', skillId);
  if (streak >= 365) grantAchievement(userId, 'streak_365', skillId);

  // Мульти-стрик
  const activeStreaks = db.prepare(`
    SELECT COUNT(*) as c FROM user_skills
    WHERE user_id = ? AND current_streak >= 7
  `).get(userId).c;

  if (activeStreaks >= 3)  grantAchievement(userId, 'multi_streak_3');
  if (activeStreaks >= 5)  grantAchievement(userId, 'multi_streak_5');
  if (activeStreaks >= 10) grantAchievement(userId, 'multi_streak_10');
}

function checkCheckinAchievements(userId) {
  const total = db.prepare(
    'SELECT COUNT(*) as c FROM checkins WHERE user_id = ?'
  ).get(userId).c;

  if (total >= 1)    grantAchievement(userId, 'first_checkin');
  if (total >= 10)   grantAchievement(userId, 'total_checkins_10');
  if (total >= 50)   grantAchievement(userId, 'total_checkins_50');
  if (total >= 100)  grantAchievement(userId, 'total_checkins_100');
  if (total >= 500)  grantAchievement(userId, 'total_checkins_500');
  if (total >= 1000) grantAchievement(userId, 'total_checkins_1000');

  // Сколько навыков отмечено сегодня
  const today = todayStr();
  const todayCount = db.prepare(
    'SELECT COUNT(*) as c FROM checkins WHERE user_id = ? AND date = ?'
  ).get(userId, today).c;

  if (todayCount >= 5)  grantAchievement(userId, 'diverse_day');
  if (todayCount >= 10) grantAchievement(userId, 'marathon_day');

  // Время суток
  const hour = new Date().getHours();
  if (hour < 7)                grantAchievement(userId, 'early_bird');
  if (hour >= 0 && hour < 4)   grantAchievement(userId, 'night_owl');

  // Дата
  const now = new Date();
  if (now.getMonth() === 0 && now.getDate() === 1) grantAchievement(userId, 'new_year');
  if (now.getMonth() === 9 && now.getDate() === 31) grantAchievement(userId, 'halloween');
}


// ============================================
// БЕЙДЖИ (хранение в user_badges, см. lib/badges.js)
// ============================================

const badgeLib = require('../lib/badges');
const BADGE_INFO = badgeLib.BADGE_INFO;

function addBadge(userId, badge) {
  const r = badgeLib.grantBadge(userId, badge, 'system');
  return r.granted;
}

function getUserBadges(userId) {
  return badgeLib.getUserBadgeKeys(userId);
}


// ============================================
// MIDDLEWARE — авторизация
// ============================================

router.use(authMiddleware);


// ============================================
// GET /api/skills/catalog
// ============================================

router.get('/catalog', (req, res) => {
  try {
    const categories = db.prepare(
      'SELECT * FROM categories ORDER BY sort_order'
    ).all();

    const subcategories = db.prepare(
      'SELECT * FROM subcategories ORDER BY sort_order'
    ).all();

    const skills = db.prepare(
      'SELECT * FROM skills ORDER BY name'
    ).all();

    const catalog = categories.map(cat => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      icon: cat.icon,
      subcategories: subcategories
        .filter(sub => sub.category_id === cat.id)
        .map(sub => ({
          id: sub.id,
          name: sub.name,
          slug: sub.slug,
          icon: sub.icon,
          skills: skills
            .filter(s => s.subcategory_id === sub.id)
            .map(s => ({
              id: s.id,
              name: s.name,
              slug: s.slug,
              description: s.description
            }))
        }))
    }));

    res.json(catalog);
  } catch (error) {
    console.error('❌ Каталог:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// GET /api/skills/search
// ============================================

router.get('/search', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);

    const results = db.prepare(`
      SELECT s.*, sc.name as subcategory_name, sc.icon as subcategory_icon,
             c.name as category_name, c.icon as category_icon
      FROM skills s
      JOIN subcategories sc ON s.subcategory_id = sc.id
      JOIN categories c ON sc.category_id = c.id
      WHERE s.name LIKE ?
      ORDER BY s.name
      LIMIT 30
    `).all(`%${q.slice(0, 50)}%`);

    res.json(results.map(s => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      description: s.description,
      subcategory: s.subcategory_name,
      subcategoryIcon: s.subcategory_icon,
      category: s.category_name,
      categoryIcon: s.category_icon
    })));
  } catch (error) {
    console.error('❌ Поиск:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// POST /api/skills/add
// ============================================

router.post('/add', (req, res) => {
  try {
    const userId = req.userId;
    const { skillId, totalYears, activeYears } = req.body;

    if (!skillId || !Number.isInteger(skillId)) {
      return res.status(400).json({ error: 'Неверный ID навыка' });
    }

    // Проверяем что навык существует
    const skill = db.prepare(`
      SELECT s.*, sc.icon as subcategory_icon, sc.name as subcategory_name,
             c.icon as category_icon, c.name as category_name
      FROM skills s
      JOIN subcategories sc ON s.subcategory_id = sc.id
      JOIN categories c ON sc.category_id = c.id
      WHERE s.id = ?
    `).get(skillId);

    if (!skill) return res.status(404).json({ error: 'Навык не найден' });

    // Валидация опыта
    const tYears = Math.max(0, Math.min(80, parseFloat(totalYears) || 0));
    const aYears = Math.max(0, Math.min(80, parseFloat(activeYears) || 0));

    if (aYears > tYears) {
      return res.status(400).json({
        error: 'Реальный опыт не может быть больше общего стажа'
      });
    }

    // Проверяем дубликат
    const exists = db.prepare(
      'SELECT id FROM user_skills WHERE user_id = ? AND skill_id = ?'
    ).get(userId, skillId);
    if (exists) return res.status(409).json({ error: 'Навык уже добавлен' });

    // Проверяем лимит
    const count = db.prepare(
      'SELECT COUNT(*) as c FROM user_skills WHERE user_id = ?'
    ).get(userId).c;
    if (count >= 50) {
      return res.status(400).json({ error: 'Максимум 50 навыков' });
    }

    // Добавляем
    db.prepare(`
      INSERT INTO user_skills (user_id, skill_id, total_years, active_years)
      VALUES (?, ?, ?, ?)
    `).run(userId, skillId, tYears, aYears);

    // Пересчитываем XP
    const result = recalcSkill(userId, skillId);

    // Проверяем достижения
    checkSkillAchievements(userId);
    checkVeteranAchievements(userId, skillId, aYears);

    // Событие в ленту
    db.prepare(`
      INSERT INTO feed_events (user_id, event_type, event_data)
      VALUES (?, 'new_skill', ?)
    `).run(userId, JSON.stringify({
      skill: skill.name,
      skillId: skill.id,
      category: skill.category_name,
      categoryIcon: skill.category_icon,
      totalYears: tYears,
      activeYears: aYears
    }));

    res.status(201).json({
      message: `"${skill.name}" добавлен!`,
      skill: {
        id: skill.id,
        name: skill.name,
        categoryIcon: skill.category_icon,
        subcategoryIcon: skill.subcategory_icon,
        ...result
      }
    });

  } catch (error) {
    console.error('❌ Добавление навыка:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// PUT /api/skills/:skillId
// ============================================

router.put('/:skillId', (req, res) => {
  try {
    const userId = req.userId;
    const skillId = parseInt(req.params.skillId);
    const { totalYears, activeYears } = req.body;

    if (isNaN(skillId)) return res.status(400).json({ error: 'Неверный ID' });

    const us = db.prepare(
      'SELECT * FROM user_skills WHERE user_id = ? AND skill_id = ?'
    ).get(userId, skillId);
    if (!us) return res.status(404).json({ error: 'Навык не найден в профиле' });

    // Обновляем опыт
    const tYears = totalYears !== undefined
      ? Math.max(0, Math.min(80, parseFloat(totalYears) || 0))
      : us.total_years;

    const aYears = activeYears !== undefined
      ? Math.max(0, Math.min(80, parseFloat(activeYears) || 0))
      : us.active_years;

    if (aYears > tYears) {
      return res.status(400).json({
        error: 'Реальный опыт не может быть больше общего стажа'
      });
    }

    db.prepare(`
      UPDATE user_skills SET total_years = ?, active_years = ?
      WHERE user_id = ? AND skill_id = ?
    `).run(tYears, aYears, userId, skillId);

    const result = recalcSkill(userId, skillId);
    checkVeteranAchievements(userId, skillId, aYears);

    res.json({
      message: 'Навык обновлён',
      skill: result
    });

  } catch (error) {
    console.error('❌ Обновление навыка:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// DELETE /api/skills/:skillId
// ============================================

router.delete('/:skillId', (req, res) => {
  try {
    const userId = req.userId;
    const skillId = parseInt(req.params.skillId);

    if (isNaN(skillId)) return res.status(400).json({ error: 'Неверный ID' });

    const us = db.prepare(
      'SELECT * FROM user_skills WHERE user_id = ? AND skill_id = ?'
    ).get(userId, skillId);
    if (!us) return res.status(404).json({ error: 'Навык не найден' });

    // Удаляем всё связанное
    db.prepare('DELETE FROM checkins WHERE user_id = ? AND skill_id = ?')
      .run(userId, skillId);
    db.prepare('DELETE FROM endorsements WHERE to_user_id = ? AND skill_id = ?')
      .run(userId, skillId);
    db.prepare('DELETE FROM user_achievements WHERE user_id = ? AND skill_id = ?')
      .run(userId, skillId);
    db.prepare('DELETE FROM user_skills WHERE user_id = ? AND skill_id = ?')
      .run(userId, skillId);

    // Пересчитываем общий ранг
    recalcOverallRank(userId);

    res.json({ message: 'Навык удалён' });

  } catch (error) {
    console.error('❌ Удаление навыка:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// GET /api/skills/:skillId/details
// ============================================

router.get('/:skillId/details', (req, res) => {
  try {
    const userId = req.userId;
    const skillId = parseInt(req.params.skillId);

    if (isNaN(skillId)) return res.status(400).json({ error: 'Неверный ID' });

    const us = db.prepare(
      'SELECT * FROM user_skills WHERE user_id = ? AND skill_id = ?'
    ).get(userId, skillId);
    if (!us) return res.status(404).json({ error: 'Навык не найден' });

    const skill = db.prepare(`
      SELECT s.*, sc.name as subcategory_name, sc.icon as subcategory_icon,
             c.name as category_name, c.icon as category_icon
      FROM skills s
      JOIN subcategories sc ON s.subcategory_id = sc.id
      JOIN categories c ON sc.category_id = c.id
      WHERE s.id = ?
    `).get(skillId);

    // Подсчёт подтверждений
    const endorseCount = db.prepare(
      'SELECT COUNT(*) as c FROM endorsements WHERE to_user_id = ? AND skill_id = ?'
    ).get(userId, skillId).c;

    const endorseXP = db.prepare(
      'SELECT COALESCE(SUM(xp_given), 0) as t FROM endorsements WHERE to_user_id = ? AND skill_id = ?'
    ).get(userId, skillId).t;

    const achieveXP = db.prepare(`
      SELECT COALESCE(SUM(a.xp_reward), 0) as t
      FROM user_achievements ua
      JOIN achievements a ON ua.achievement_id = a.id
      WHERE ua.user_id = ? AND ua.skill_id = ?
    `).get(userId, skillId).t;

    const streak = calcStreak(userId, skillId);
    const totalXP = (us.foundation_xp || 0) + (us.bonus_xp || 0);

    res.json({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      category: skill.category_name,
      categoryIcon: skill.category_icon,
      subcategory: skill.subcategory_name,
      subcategoryIcon: skill.subcategory_icon,
      rank: us.rank || 'F',
      rankInfo: getRankInfo(totalXP),
      totalYears: us.total_years || 0,
      activeYears: us.active_years || 0,
      streak,
      bestStreak: us.best_streak || 0,
      multiplier: getStreakMultiplier(streak),
      xpBreakdown: {
        total: totalXP,
        foundation: us.foundation_xp || 0,
        bonus: us.bonus_xp || 0,
        experience: calcActiveXP(us.active_years || 0) + calcTotalXP(us.total_years || 0),
        endorsements: endorseXP,
        endorsementCount: endorseCount,
        achievements: achieveXP,
      }
    });

  } catch (error) {
    console.error('❌ Детали навыка:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// Экспортируем для использования в других модулях
// ============================================

// Делаем функции доступными
router.recalcSkill = recalcSkill;
router.recalcOverallRank = recalcOverallRank;
router.grantAchievement = grantAchievement;
router.checkStreakAchievements = checkStreakAchievements;
router.checkCheckinAchievements = checkCheckinAchievements;
router.getStreakDailyXP = getStreakDailyXP;
router.getStreakMultiplier = getStreakMultiplier;
router.calcStreak = calcStreak;
router.getRank = getRank;
router.getRankInfo = getRankInfo;
router.rankValue = rankValue;
router.addBadge = addBadge;
router.getUserBadges = getUserBadges;
router.BADGE_INFO = BADGE_INFO;
router.ENDORSEMENT_WEIGHT = ENDORSEMENT_WEIGHT;

module.exports = router;