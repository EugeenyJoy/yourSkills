// ============================================
// routes/endorsements.js — Подтверждения v3
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
// POST /api/endorsements
// ============================================

router.post('/', (req, res) => {
  try {
    const fromId = req.userId;
    const { userId: toId, skillId } = req.body;

    if (!toId || !skillId) {
      return res.status(400).json({ error: 'userId и skillId обязательны' });
    }

    // Нельзя подтверждать себе
    if (fromId === toId) {
      return res.status(400).json({ error: 'Нельзя подтверждать свои навыки' });
    }

    // Проверяем что навык есть у целевого пользователя
    const targetSkill = db.prepare(
      'SELECT * FROM user_skills WHERE user_id = ? AND skill_id = ?'
    ).get(toId, skillId);
    if (!targetSkill) {
      return res.status(404).json({ error: 'Навык не найден у пользователя' });
    }

    // Проверяем дубликат
    const existing = db.prepare(
      'SELECT id FROM endorsements WHERE from_user_id = ? AND to_user_id = ? AND skill_id = ?'
    ).get(fromId, toId, skillId);
    if (existing) {
      return res.status(409).json({ error: 'Вы уже подтверждали этот навык' });
    }

    // Рассчитываем XP на основе ранга подтверждающего
    const fromUser = db.prepare('SELECT overall_rank FROM users WHERE id = ?').get(fromId);
    const fromRank = fromUser?.overall_rank || 'F';

    const skillsRouter = require('./skills');
    const xpGiven = skillsRouter.ENDORSEMENT_WEIGHT[fromRank] || 5;

    // Создаём подтверждение
    db.prepare(
      'INSERT INTO endorsements (from_user_id, to_user_id, skill_id, xp_given) VALUES (?, ?, ?, ?)'
    ).run(fromId, toId, skillId, xpGiven);

    // Пересчитываем навык
    skillsRouter.recalcSkill(toId, skillId);

    // Достижения для получателя
    const receivedCount = db.prepare(
      'SELECT COUNT(*) as c FROM endorsements WHERE to_user_id = ?'
    ).get(toId).c;

    if (receivedCount >= 1)   skillsRouter.grantAchievement(toId, 'first_endorsement');
    if (receivedCount >= 5)   skillsRouter.grantAchievement(toId, 'five_endorsements');
    if (receivedCount >= 10)  skillsRouter.grantAchievement(toId, 'ten_endorsements');
    if (receivedCount >= 25)  skillsRouter.grantAchievement(toId, 'twenty_five_endorse');
    if (receivedCount >= 50)  skillsRouter.grantAchievement(toId, 'fifty_endorsements');
    if (receivedCount >= 100) skillsRouter.grantAchievement(toId, 'hundred_endorsements');

    // Достижения для подтверждающего
    const givenCount = db.prepare(
      'SELECT COUNT(*) as c FROM endorsements WHERE from_user_id = ?'
    ).get(fromId).c;

    if (givenCount >= 5)   skillsRouter.grantAchievement(fromId, 'endorser_5');
    if (givenCount >= 10)  skillsRouter.grantAchievement(fromId, 'endorser_10');
    if (givenCount >= 25)  skillsRouter.grantAchievement(fromId, 'endorser_25');
    if (givenCount >= 50)  skillsRouter.grantAchievement(fromId, 'endorser_50');
    if (givenCount >= 100) skillsRouter.grantAchievement(fromId, 'endorser_100');

    // Событие в ленту
    const skill = db.prepare('SELECT name FROM skills WHERE id = ?').get(skillId);
    const fromUserData = db.prepare('SELECT first_name FROM users WHERE id = ?').get(fromId);

    db.prepare(`
      INSERT INTO feed_events (user_id, event_type, event_data)
      VALUES (?, 'endorsement', ?)
    `).run(toId, JSON.stringify({
      fromUser: fromUserData?.first_name || 'Кто-то',
      fromUserId: fromId,
      skill: skill?.name || '???',
      skillId,
      xpGiven
    }));

    res.json({
      message: `Навык подтверждён (+${xpGiven} XP)`,
      xpGiven
    });

  } catch (error) {
    console.error('❌ Подтверждение:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// GET /api/endorsements/:userId/:skillId
// ============================================

router.get('/:userId/:skillId', (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const skillId = parseInt(req.params.skillId);

    const endorsers = db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.username,
             u.photo_url, u.overall_rank, e.xp_given, e.created_at
      FROM endorsements e
      JOIN users u ON e.from_user_id = u.id
      WHERE e.to_user_id = ? AND e.skill_id = ?
      ORDER BY e.created_at DESC
      LIMIT 50
    `).all(userId, skillId);

    const totalCount = db.prepare(
      'SELECT COUNT(*) as c FROM endorsements WHERE to_user_id = ? AND skill_id = ?'
    ).get(userId, skillId).c;

    res.json({
      endorsers: endorsers.map(e => ({
        id: e.id,
        firstName: e.first_name,
        lastName: e.last_name,
        username: e.username,
        photoUrl: e.photo_url,
        rank: e.overall_rank || 'F',
        xpGiven: e.xp_given,
        createdAt: e.created_at,
      })),
      totalCount
    });

  } catch (error) {
    console.error('❌ Список подтверждений:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// DELETE /api/endorsements/:userId/:skillId
// ============================================

router.delete('/:userId/:skillId', (req, res) => {
  try {
    const fromId = req.userId;
    const toId = parseInt(req.params.userId);
    const skillId = parseInt(req.params.skillId);

    const result = db.prepare(
      'DELETE FROM endorsements WHERE from_user_id = ? AND to_user_id = ? AND skill_id = ?'
    ).run(fromId, toId, skillId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Подтверждение не найдено' });
    }

    const skillsRouter = require('./skills');
    skillsRouter.recalcSkill(toId, skillId);

    res.json({ message: 'Подтверждение отозвано' });

  } catch (error) {
    console.error('❌ Удаление подтверждения:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


module.exports = router;