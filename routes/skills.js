// ============================================
// routes/skills.js — Навыки и ранги
// ============================================
// Источник истины — checkins.
// Ранги: F E D C B A S, плюсы только для B+ и A+.
// Логика рангов вынесена в lib/ranks.js.
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const authMiddleware = require('../middleware/auth');
const ranks = require('../lib/ranks');


// ============================================
// УТИЛИТЫ ДАТ
// ============================================

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function dateOffset(offset, from) {
  const d = from ? new Date(from) : new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

// ISO-неделя в формате "YYYY-WW" по дате-строке "YYYY-MM-DD"
function isoWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  // ISO week
  const target = new Date(d.valueOf());
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  const week = 1 + Math.ceil((firstThursday - target) / 604800000);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}


// ============================================
// ДАННЫЕ ИЗ ЧЕКИНОВ
// ============================================

// Уникальные дни чекинов по скиллу
function getSkillDays(userId, skillId) {
  return db.prepare(`
    SELECT COUNT(DISTINCT date) AS c
    FROM checkins
    WHERE user_id = ? AND skill_id = ?
  `).get(userId, skillId).c;
}

// Уникальные дни чекинов по всем скиллам пользователя
function getOverallDays(userId) {
  return db.prepare(`
    SELECT COUNT(DISTINCT date) AS c
    FROM checkins
    WHERE user_id = ?
  `).get(userId).c;
}

// Число ISO-недель с ≥1 чекином по скиллу
function getSkillRegularWeeks(userId, skillId) {
  const rows = db.prepare(`
    SELECT DISTINCT date FROM checkins
    WHERE user_id = ? AND skill_id = ?
  `).all(userId, skillId);
  const set = new Set();
  for (const r of rows) set.add(isoWeekKey(r.date));
  return set.size;
}

// Число ISO-недель с ≥1 любым чекином
function getOverallRegularWeeks(userId) {
  const rows = db.prepare(`
    SELECT DISTINCT date FROM checkins WHERE user_id = ?
  `).all(userId);
  const set = new Set();
  for (const r of rows) set.add(isoWeekKey(r.date));
  return set.size;
}


// ============================================
// СТРИК (декоративный)
// ============================================

function calcStreak(userId, skillId) {
  const rows = db.prepare(`
    SELECT DISTINCT date FROM checkins
    WHERE user_id = ? AND skill_id = ?
    ORDER BY date DESC LIMIT 400
  `).all(userId, skillId);

  if (rows.length === 0) return 0;

  const today = todayStr();
  const yesterday = dateOffset(-1);
  const latest = rows[0].date;

  if (latest !== today && latest !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < rows.length; i++) {
    const expected = dateOffset(-i, latest);
    if (rows[i].date === expected) streak++;
    else break;
  }
  return streak;
}


// ============================================
// ЭНДОРСМЕНТЫ — гейт A/S
// ============================================
// Возвращает { fromA, fromS }: сколько подтверждений
// получил юзер по этому скиллу от тех, у кого ранг A/S
// по тому же скиллу (rank в user_skills, базовый, без +).

function getEndorsersByRank(userId, skillId) {
  const rows = db.prepare(`
    SELECT us.rank AS r
    FROM endorsements e
    LEFT JOIN user_skills us
      ON us.user_id = e.from_user_id AND us.skill_id = e.skill_id
    WHERE e.to_user_id = ? AND e.skill_id = ?
  `).all(userId, skillId);

  let fromA = 0, fromS = 0;
  for (const row of rows) {
    // Базовый ранг — отрезаем + если есть
    const base = (row.r || 'F').replace('+', '');
    if (base === 'A') fromA++;
    else if (base === 'S') fromS++;
  }
  return { fromA, fromS };
}


// ============================================
// ПЕРЕСЧЁТ РАНГА НАВЫКА
// ============================================

function recalcSkill(userId, skillId) {
  const us = db.prepare(
    'SELECT * FROM user_skills WHERE user_id = ? AND skill_id = ?'
  ).get(userId, skillId);
  if (!us) return null;

  const days = getSkillDays(userId, skillId);
  const regularWeeks = getSkillRegularWeeks(userId, skillId);
  const endorsements = getEndorsersByRank(userId, skillId);

  const rankObj = ranks.getEffectiveSkillRank({ days, regularWeeks, endorsements });
  const newRank = rankObj.rank; // включает + если есть
  const oldRank = us.rank || 'F';

  const streak = calcStreak(userId, skillId);
  const bestStreak = Math.max(us.best_streak || 0, streak);

  db.prepare(`
    UPDATE user_skills
    SET rank = ?, current_streak = ?, best_streak = ?
    WHERE user_id = ? AND skill_id = ?
  `).run(newRank, streak, bestStreak, userId, skillId);

  // Повышение базового ранга?
  if (ranks.RANK_ORDER.indexOf(rankObj.baseRank) >
      ranks.RANK_ORDER.indexOf((oldRank || 'F').replace('+', ''))) {
    onRankUp(userId, skillId, oldRank, newRank, rankObj);
  }

  // Общий ранг
  recalcOverallRank(userId);

  return {
    rank: newRank,
    baseRank: rankObj.baseRank,
    plus: rankObj.plus,
    title: rankObj.title,
    days,
    regularWeeks,
    endorsements,
    streak,
    bestStreak
  };
}


// ============================================
// ПОВЫШЕНИЕ РАНГА
// ============================================

function onRankUp(userId, skillId, oldRank, newRank, rankObj) {
  const skill = db.prepare('SELECT name FROM skills WHERE id = ?').get(skillId);

  db.prepare(`
    INSERT INTO feed_events (user_id, event_type, event_data)
    VALUES (?, 'rank_up', ?)
  `).run(userId, JSON.stringify({
    skill: skill?.name || '???',
    skillId,
    oldRank,
    newRank,
    title: rankObj.title
  }));

  // Достижения за достигнутый базовый ранг
  const rankCodes = {
    'E': 'rank_e', 'D': 'rank_d', 'C': 'rank_c',
    'B': 'rank_b', 'A': 'rank_a', 'S': 'rank_s'
  };
  if (rankCodes[rankObj.baseRank]) {
    grantAchievement(userId, rankCodes[rankObj.baseRank], skillId);
  }

  // Множественные ранги — считаем по базовому рангу
  const counts = db.prepare(`
    SELECT rank FROM user_skills WHERE user_id = ?
  `).all(userId);
  let bPlus = 0, aPlus = 0;
  for (const row of counts) {
    const base = (row.rank || 'F').replace('+', '');
    if (['B', 'A', 'S'].includes(base)) bPlus++;
    if (['A', 'S'].includes(base)) aPlus++;
  }
  if (bPlus >= 3) grantAchievement(userId, 'multi_rank_b');
  if (aPlus >= 2) grantAchievement(userId, 'multi_rank_a');
  if (aPlus >= 3) grantAchievement(userId, 'multi_rank_a3');
}


// ============================================
// ОБЩИЙ РАНГ
// ============================================

function recalcOverallRank(userId) {
  const userSkills = db.prepare(`
    SELECT rank FROM user_skills WHERE user_id = ?
  `).all(userId);

  // getOverallRank ждёт массив строк базовых рангов
  const skillsBase = userSkills.map(s => (s.rank || 'F').replace('+', ''));

  const totalRegularWeeks = getOverallRegularWeeks(userId);
  const overallObj = ranks.getOverallRank(skillsBase, totalRegularWeeks);

  const oldRow = db.prepare('SELECT overall_rank FROM users WHERE id = ?').get(userId);
  const oldOverall = oldRow ? (oldRow.overall_rank || 'F') : 'F';

  db.prepare('UPDATE users SET overall_rank = ? WHERE id = ?')
    .run(overallObj.rank, userId);

  // Достижения за общий ранг — по базовому
  const oldBase = oldOverall.replace('+', '');
  if (ranks.RANK_ORDER.indexOf(overallObj.baseRank) >
      ranks.RANK_ORDER.indexOf(oldBase)) {
    const codes = {
      'E': 'overall_e', 'D': 'overall_d', 'C': 'overall_c',
      'B': 'overall_b', 'A': 'overall_a', 'S': 'overall_s'
    };
    if (codes[overallObj.baseRank]) {
      grantAchievement(userId, codes[overallObj.baseRank]);
    }
  }
}


// ============================================
// ДОСТИЖЕНИЯ
// ============================================

function grantAchievement(userId, code, skillId) {
  const a = db.prepare('SELECT * FROM achievements WHERE code = ?').get(code);
  if (!a) return null;

  const sid = skillId || null;

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

  db.prepare(`
    INSERT INTO feed_events (user_id, event_type, event_data)
    VALUES (?, 'achievement', ?)
  `).run(userId, JSON.stringify({
    code: a.code, name: a.name, icon: a.icon, rarity: a.rarity
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

  const catCount = db.prepare(`
    SELECT COUNT(DISTINCT c.id) as c
    FROM user_skills us
    JOIN skills s ON us.skill_id = s.id
    JOIN subcategories sc ON s.subcategory_id = sc.id
    JOIN categories c ON sc.category_id = c.id
    WHERE us.user_id = ?
  `).get(userId).c;

  if (catCount >= 3) grantAchievement(userId, 'three_categories');
  if (catCount >= 5) grantAchievement(userId, 'five_categories');
  if (catCount >= 8) grantAchievement(userId, 'eight_categories');

  const totalCats = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
  if (catCount >= totalCats) grantAchievement(userId, 'all_categories');
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

  const today = todayStr();
  const todayCount = db.prepare(
    'SELECT COUNT(*) as c FROM checkins WHERE user_id = ? AND date = ?'
  ).get(userId, today).c;

  if (todayCount >= 5)  grantAchievement(userId, 'diverse_day');
  if (todayCount >= 10) grantAchievement(userId, 'marathon_day');

  const hour = new Date().getHours();
  if (hour < 7)                grantAchievement(userId, 'early_bird');
  if (hour >= 0 && hour < 4)   grantAchievement(userId, 'night_owl');

  const now = new Date();
  if (now.getMonth() === 0 && now.getDate() === 1) grantAchievement(userId, 'new_year');
  if (now.getMonth() === 9 && now.getDate() === 31) grantAchievement(userId, 'halloween');
}


// ============================================
// БЕЙДЖИ (декор, миграция в Фазу 5)
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
// MIDDLEWARE
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
              id: s.id, name: s.name, slug: s.slug, description: s.description
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
      id: s.id, name: s.name, slug: s.slug, description: s.description,
      subcategory: s.subcategory_name, subcategoryIcon: s.subcategory_icon,
      category: s.category_name, categoryIcon: s.category_icon
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
    const { skillId, activeYears } = req.body;

    if (!skillId || !Number.isInteger(skillId)) {
      return res.status(400).json({ error: 'Неверный ID навыка' });
    }

    const skill = db.prepare(`
      SELECT s.*, sc.icon as subcategory_icon, sc.name as subcategory_name,
             c.icon as category_icon, c.name as category_name
      FROM skills s
      JOIN subcategories sc ON s.subcategory_id = sc.id
      JOIN categories c ON sc.category_id = c.id
      WHERE s.id = ?
    `).get(skillId);

    if (!skill) return res.status(404).json({ error: 'Навык не найден' });

    const aYears = Math.max(0, Math.min(80, parseFloat(activeYears) || 0));

    const exists = db.prepare(
      'SELECT id FROM user_skills WHERE user_id = ? AND skill_id = ?'
    ).get(userId, skillId);
    if (exists) return res.status(409).json({ error: 'Навык уже добавлен' });

    const count = db.prepare(
      'SELECT COUNT(*) as c FROM user_skills WHERE user_id = ?'
    ).get(userId).c;
    if (count >= 50) {
      return res.status(400).json({ error: 'Максимум 50 навыков' });
    }

    db.prepare(`
      INSERT INTO user_skills (user_id, skill_id, active_years)
      VALUES (?, ?, ?)
    `).run(userId, skillId, aYears);

    // Пересчитываем ранг (для нового скилла будет F, но всё равно создаём корректную запись)
    const result = recalcSkill(userId, skillId);

    // Достижения
    checkSkillAchievements(userId);

    // Событие в ленту
    db.prepare(`
      INSERT INTO feed_events (user_id, event_type, event_data)
      VALUES (?, 'new_skill', ?)
    `).run(userId, JSON.stringify({
      skill: skill.name,
      skillId: skill.id,
      category: skill.category_name,
      categoryIcon: skill.category_icon,
      activeYears: aYears
    }));

    res.status(201).json({
      message: `"${skill.name}" добавлен!`,
      skill: {
        id: skill.id,
        name: skill.name,
        categoryIcon: skill.category_icon,
        subcategoryIcon: skill.subcategory_icon,
        activeYears: aYears,
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
// Можно менять только activeYears (декор).
// На ранг не влияет, но обновляет запись.

router.put('/:skillId', (req, res) => {
  try {
    const userId = req.userId;
    const skillId = parseInt(req.params.skillId);
    const { activeYears } = req.body;

    if (isNaN(skillId)) return res.status(400).json({ error: 'Неверный ID' });

    const us = db.prepare(
      'SELECT * FROM user_skills WHERE user_id = ? AND skill_id = ?'
    ).get(userId, skillId);
    if (!us) return res.status(404).json({ error: 'Навык не найден в профиле' });

    const aYears = activeYears !== undefined
      ? Math.max(0, Math.min(80, parseFloat(activeYears) || 0))
      : us.active_years;

    db.prepare(`
      UPDATE user_skills SET active_years = ?
      WHERE user_id = ? AND skill_id = ?
    `).run(aYears, userId, skillId);

    // На ранг не влияет, но возвращаем актуальное состояние
    const result = recalcSkill(userId, skillId);

    res.json({
      message: 'Навык обновлён',
      skill: { ...result, activeYears: aYears }
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

    db.prepare('DELETE FROM checkins WHERE user_id = ? AND skill_id = ?')
      .run(userId, skillId);
    db.prepare('DELETE FROM endorsements WHERE to_user_id = ? AND skill_id = ?')
      .run(userId, skillId);
    db.prepare('DELETE FROM user_achievements WHERE user_id = ? AND skill_id = ?')
      .run(userId, skillId);
    db.prepare('DELETE FROM user_skills WHERE user_id = ? AND skill_id = ?')
      .run(userId, skillId);

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

    const days = getSkillDays(userId, skillId);
    const regularWeeks = getSkillRegularWeeks(userId, skillId);
    const endorsements = getEndorsersByRank(userId, skillId);
    const endorseCount = db.prepare(
      'SELECT COUNT(*) as c FROM endorsements WHERE to_user_id = ? AND skill_id = ?'
    ).get(userId, skillId).c;

    const streak = calcStreak(userId, skillId);

    const rankObj = ranks.getEffectiveSkillRank({ days, regularWeeks, endorsements });
    const label = ranks.formatRankLabel(skill.name, rankObj);

    res.json({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      category: skill.category_name,
      categoryIcon: skill.category_icon,
      subcategory: skill.subcategory_name,
      subcategoryIcon: skill.subcategory_icon,

      rank: rankObj.rank,           // с + если есть, например "A+"
      baseRank: rankObj.baseRank,   // без +, например "A"
      plus: rankObj.plus,           // bool
      title: rankObj.title,         // "Мастер" / null
      label,                        // "Гитара · Титул ранга A+"

      days,
      regularWeeks,
      endorsementCount: endorseCount,
      endorsersByRank: endorsements, // { fromA, fromS }

      activeYears: us.active_years || 0,
      streak,
      bestStreak: us.best_streak || 0
    });

  } catch (error) {
    console.error('❌ Детали навыка:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ============================================
// ПЕРЕСЧЁТ ВСЕХ СКИЛЛОВ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ
// ============================================
// Запускается кроном раз в сутки (см. bot.js).
// Нужен чтобы ранги "падали" если условия
// (регулярность, эндорсменты) перестали соблюдаться.
//
// Стоимость: ~30мс на юзера со средним числом скиллов.
// На 1000 юзеров — около 30 секунд работы.

function recalcAllSkillsForAllUsers() {
  const startedAt = Date.now();
  const users = db.prepare(
    'SELECT DISTINCT user_id FROM user_skills'
  ).all();

  let usersProcessed = 0;
  let skillsProcessed = 0;
  let demotions = 0;

  for (const u of users) {
    const skills = db.prepare(
      'SELECT skill_id, rank FROM user_skills WHERE user_id = ?'
    ).all(u.user_id);

    for (const s of skills) {
      const oldRank = s.rank || 'F';
      const result = recalcSkill(u.user_id, s.skill_id);
      skillsProcessed++;

      if (result && rankIndex(result.rank) < rankIndex(oldRank)) {
        demotions++;
      }
    }
    usersProcessed++;
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `🌙 Ночной пересчёт: ${usersProcessed} юзеров, ` +
    `${skillsProcessed} скиллов, ${demotions} падений ранга, ${elapsed}с`
  );

  return { usersProcessed, skillsProcessed, demotions, elapsed };
}

// Хелпер для сравнения рангов с учётом +
function rankIndex(rank) {
  const base = (rank || 'F').replace('+', '');
  const idx = ranks.RANK_ORDER.indexOf(base);
  return idx * 2 + (rank.endsWith('+') ? 1 : 0);
}

// ============================================
// Экспорт для других модулей
// ============================================

router.recalcSkill = recalcSkill;
router.recalcOverallRank = recalcOverallRank;
router.grantAchievement = grantAchievement;
router.checkSkillAchievements = checkSkillAchievements;
router.checkStreakAchievements = checkStreakAchievements;
router.checkCheckinAchievements = checkCheckinAchievements;
router.calcStreak = calcStreak;
router.getSkillDays = getSkillDays;
router.getOverallDays = getOverallDays;
router.getSkillRegularWeeks = getSkillRegularWeeks;
router.getOverallRegularWeeks = getOverallRegularWeeks;
router.getEndorsersByRank = getEndorsersByRank;
router.addBadge = addBadge;
router.getUserBadges = getUserBadges;
router.BADGE_INFO = BADGE_INFO;
router.recalcAllSkillsForAllUsers = recalcAllSkillsForAllUsers;

module.exports = router;
