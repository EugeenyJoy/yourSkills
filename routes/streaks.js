// ============================================
// routes/streaks.js — Чекины и стрики v3
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const authMiddleware = require('../middleware/auth');


// ============================================
// MIDDLEWARE
// ============================================

router.use(authMiddleware);


// ============================================
// POST /api/streaks/checkin
// ============================================

router.post('/checkin', (req, res) => {
  try {
    const userId = req.userId;
    const { skillId, note } = req.body;

    if (!skillId) return res.status(400).json({ error: 'skillId обязателен' });

    // Проверяем что навык принадлежит пользователю
    const us = db.prepare(
      'SELECT * FROM user_skills WHERE user_id = ? AND skill_id = ?'
    ).get(userId, skillId);
    if (!us) return res.status(404).json({ error: 'Навык не найден в профиле' });

    const today = new Date().toISOString().split('T')[0];

    // Проверяем что сегодня ещё не было чекина
    const existing = db.prepare(
      'SELECT id FROM checkins WHERE user_id = ? AND skill_id = ? AND date = ?'
    ).get(userId, skillId, today);

    if (existing) {
      return res.status(409).json({
        error: 'Уже отмечено сегодня',
        alreadyCheckedIn: true
      });
    }

    // Создаём чекин
    db.prepare(
      'INSERT INTO checkins (user_id, skill_id, date, note) VALUES (?, ?, ?, ?)'
    ).run(userId, skillId, today, (note || '').slice(0, 500));

    // Получаем функции из skills роутера
    const skillsRouter = require('./skills');

    // Считаем стрик
    const streak = skillsRouter.calcStreak(userId, skillId);
    const multiplier = skillsRouter.getStreakMultiplier(streak);
    const dailyXP = skillsRouter.getStreakDailyXP(streak);
    const earnedXP = Math.floor(dailyXP * multiplier);

    // Добавляем бонусный XP
    db.prepare(`
      UPDATE user_skills
      SET bonus_xp = bonus_xp + ?,
          current_streak = ?,
          best_streak = MAX(best_streak, ?)
      WHERE user_id = ? AND skill_id = ?
    `).run(earnedXP, streak, streak, userId, skillId);

    // Пересчитываем полный XP
    const result = skillsRouter.recalcSkill(userId, skillId);

    // Проверяем достижения
    skillsRouter.checkStreakAchievements(userId, skillId, streak);
    skillsRouter.checkCheckinAchievements(userId);

    // Получаем имя навыка
    const skill = db.prepare('SELECT name FROM skills WHERE id = ?').get(skillId);

    // Стрик-рекорды в ленту
    const milestones = [365, 300, 200, 150, 100, 90, 60, 30, 21, 14, 7, 3];
    for (const m of milestones) {
      if (streak === m) {
        db.prepare(`
          INSERT INTO feed_events (user_id, event_type, event_data)
          VALUES (?, 'streak_milestone', ?)
        `).run(userId, JSON.stringify({
          skill: skill?.name, skillId, streak: m
        }));
        break;
      }
    }

    // Формируем сообщение
    let message = `+${earnedXP} XP за практику!`;
    if (streak >= 7) message += ` 🔥 Стрик ${streak} дней!`;
    if (multiplier > 1) message += ` (x${multiplier})`;

    res.json({
      message,
      skill: {
        id: skillId,
        name: skill?.name,
        rank: result.rank,
        totalXP: result.totalXP,
      },
      streak: {
        current: streak,
        best: result.bestStreak,
        multiplier,
        earnedXP,
      }
    });

  } catch (error) {
    console.error('❌ Чекин:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// GET /api/streaks/today
// ============================================

router.get('/today', (req, res) => {
  try {
    const userId = req.userId;
    const today = new Date().toISOString().split('T')[0];
    const skillsRouter = require('./skills');

    // Все навыки пользователя
    const userSkills = db.prepare(`
      SELECT us.*, s.name, s.slug,
             sc.icon as subcategory_icon,
             c.icon as category_icon
      FROM user_skills us
      JOIN skills s ON us.skill_id = s.id
      JOIN subcategories sc ON s.subcategory_id = sc.id
      JOIN categories c ON sc.category_id = c.id
      WHERE us.user_id = ?
      ORDER BY s.name
    `).all(userId);

    // Чекины за сегодня
    const todayCheckins = db.prepare(
      'SELECT skill_id FROM checkins WHERE user_id = ? AND date = ?'
    ).all(userId, today);
    const checkedSet = new Set(todayCheckins.map(c => c.skill_id));

    let checked = 0;
    const skills = userSkills.map(us => {
      const isChecked = checkedSet.has(us.skill_id);
      if (isChecked) checked++;

      const streak = us.current_streak || 0;
      const multiplier = skillsRouter.getStreakMultiplier(streak);
      const dailyXP = skillsRouter.getStreakDailyXP(streak);
      const potentialXP = Math.floor(dailyXP * multiplier);

      return {
        skillId: us.skill_id,
        name: us.name,
        rank: us.rank || 'F',
        totalXP: (us.foundation_xp || 0) + (us.bonus_xp || 0),
        streak,
        multiplier,
        potentialXP,
        checkedIn: isChecked,
        categoryIcon: us.category_icon,
        subcategoryIcon: us.subcategory_icon,
      };
    });

    res.json({
      skills,
      summary: {
        checked,
        total: skills.length,
        allDone: checked >= skills.length && skills.length > 0,
      }
    });

  } catch (error) {
    console.error('❌ Статус дня:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// GET /api/streaks/history/:skillId
// ============================================

router.get('/history/:skillId', (req, res) => {
  try {
    const userId = req.userId;
    const skillId = parseInt(req.params.skillId);
    if (isNaN(skillId)) return res.status(400).json({ error: 'Неверный ID' });

    // Последние 90 дней
    const days = 90;
    const checkins = db.prepare(`
      SELECT date FROM checkins
      WHERE user_id = ? AND skill_id = ?
        AND date >= date('now', '-${days} days')
      ORDER BY date
    `).all(userId, skillId);

    const checkedDates = new Set(checkins.map(c => c.date));

    // Генерируем массив 90 дней
    const calendar = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      calendar.push({
        date: dateStr,
        checked: checkedDates.has(dateStr)
      });
    }

    const totalCheckins = db.prepare(
      'SELECT COUNT(*) as c FROM checkins WHERE user_id = ? AND skill_id = ?'
    ).get(userId, skillId).c;

    res.json({ calendar, totalCheckins });

  } catch (error) {
    console.error('❌ История:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// GET /api/streaks/stats
// ============================================

router.get('/stats', (req, res) => {
  try {
    const userId = req.userId;

    const totalCheckins = db.prepare(
      'SELECT COUNT(*) as c FROM checkins WHERE user_id = ?'
    ).get(userId).c;

    const bestStreak = db.prepare(
      'SELECT MAX(best_streak) as m FROM user_skills WHERE user_id = ?'
    ).get(userId).m || 0;

    const activeStreaks = db.prepare(
      'SELECT COUNT(*) as c FROM user_skills WHERE user_id = ? AND current_streak > 0'
    ).get(userId).c;

    const uniqueDays = db.prepare(
      'SELECT COUNT(DISTINCT date) as c FROM checkins WHERE user_id = ?'
    ).get(userId).c;

    res.json({
      totalCheckins,
      bestStreak,
      activeStreaks,
      uniqueDays,
    });

  } catch (error) {
    console.error('❌ Статистика:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


module.exports = router;