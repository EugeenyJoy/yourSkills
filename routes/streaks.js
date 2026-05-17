// ============================================
// routes/streaks.js — Чекины и стрики v4
// ============================================
// Чекин = единственный источник правды по практике.
// Ранг считается в lib/ranks.js на основе уникальных дней + регулярности.
// Стрик 🔥 — декоративный, на ранг не влияет.
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const authMiddleware = require('../middleware/auth');

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
      'SELECT id FROM user_skills WHERE user_id = ? AND skill_id = ?'
    ).get(userId, skillId);
    if (!us) return res.status(404).json({ error: 'Навык не найден в профиле' });

    const today = new Date().toISOString().split('T')[0];

    // Дубль за сегодня
    const existing = db.prepare(
      'SELECT id FROM checkins WHERE user_id = ? AND skill_id = ? AND date = ?'
    ).get(userId, skillId, today);

    if (existing) {
      return res.status(409).json({
        error: 'Уже отмечено сегодня',
        alreadyCheckedIn: true
      });
    }

    // Записываем чекин
    db.prepare(
      'INSERT INTO checkins (user_id, skill_id, date, note) VALUES (?, ?, ?, ?)'
    ).run(userId, skillId, today, (note || '').slice(0, 500));

    const skillsRouter = require('./skills');

    // Считаем стрик ПО ЧЕКИНАМ (декоративно)
    const streak = skillsRouter.calcStreak(userId, skillId);

    // Обновляем стрики
    db.prepare(`
      UPDATE user_skills
      SET current_streak = ?,
          best_streak = MAX(COALESCE(best_streak, 0), ?)
      WHERE user_id = ? AND skill_id = ?
    `).run(streak, streak, userId, skillId);

    // Полный пересчёт ранга (учтёт +1 уникальный день, регулярность, эндорсменты)
    const result = skillsRouter.recalcSkill(userId, skillId);

    // Ачивки
    skillsRouter.checkStreakAchievements(userId, skillId, streak);
    skillsRouter.checkCheckinAchievements(userId);

    // Имя скилла для ленты и ответа
    const skill = db.prepare('SELECT name FROM skills WHERE id = ?').get(skillId);

    // Майлстоуны стрика → лента
    const milestones = [365, 300, 200, 150, 100, 90, 60, 30, 21, 14, 7, 3];
    if (milestones.includes(streak)) {
      db.prepare(`
        INSERT INTO feed_events (user_id, event_type, event_data)
        VALUES (?, 'streak_milestone', ?)
      `).run(userId, JSON.stringify({
        skill: skill?.name, skillId, streak
      }));
    }

    // Сообщение
    let message = 'Чекин засчитан ✅';
    if (streak >= 7) message += ` 🔥 Стрик ${streak} дн.`;

    res.json({
      message,
      skill: {
        id: skillId,
        name: skill?.name,
        rank: result.rank,           // напр. 'A+' или 'C'
        baseRank: result.baseRank,   // напр. 'A'
        title: result.title || null  // 'Мастер' и т.п.
      },
      streak: {
        current: streak,
        best: Math.max(streak, result.bestStreak || 0)
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

    // Навыки пользователя
    const userSkills = db.prepare(`
      SELECT us.skill_id, us.rank, us.current_streak, us.best_streak,
             s.name,
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

      return {
        skillId: us.skill_id,
        name: us.name,
        rank: us.rank || 'F',
        streak: us.current_streak || 0,
        bestStreak: us.best_streak || 0,
        checkedIn: isChecked,
        categoryIcon: us.category_icon,
        subcategoryIcon: us.subcategory_icon
      };
    });

    res.json({
      skills,
      summary: {
        checked,
        total: skills.length,
        allDone: checked >= skills.length && skills.length > 0
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

    const days = 90;
    const checkins = db.prepare(`
      SELECT date FROM checkins
      WHERE user_id = ? AND skill_id = ?
        AND date >= date('now', '-${days} days')
      ORDER BY date
    `).all(userId, skillId);

    const checkedDates = new Set(checkins.map(c => c.date));

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
      uniqueDays
    });

  } catch (error) {
    console.error('❌ Статистика:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


module.exports = router;
