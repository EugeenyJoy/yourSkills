// ============================================
// routes/endorsements.js — Подтверждения v4
// ============================================
// Эндорсменты не начисляют очки.
// Их единственная функция — гейт для рангов A и S.
// Уникальность (from, to, skill) обеспечивает БД.
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const authMiddleware = require('../middleware/auth');
const { getTitleByRank } = require('../lib/ranks');

router.use(authMiddleware);


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
    if (fromId === toId) {
      return res.status(400).json({ error: 'Нельзя подтверждать свои навыки' });
    }

    // Проверяем что навык есть у целевого пользователя
    const targetSkill = db.prepare(
      'SELECT id FROM user_skills WHERE user_id = ? AND skill_id = ?'
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

    // Создаём подтверждение
    db.prepare(
      'INSERT INTO endorsements (from_user_id, to_user_id, skill_id) VALUES (?, ?, ?)'
    ).run(fromId, toId, skillId);

    const skillsRouter = require('./skills');

    // Пересчитываем ранг навыка (может проскочить на A или S)
    const result = skillsRouter.recalcSkill(toId, skillId);

    // Достижения для получателя — по количеству полученных
    const receivedCount = db.prepare(
      'SELECT COUNT(*) as c FROM endorsements WHERE to_user_id = ?'
    ).get(toId).c;

    if (receivedCount >= 1)   skillsRouter.grantAchievement(toId, 'first_endorsement');
    if (receivedCount >= 5)   skillsRouter.grantAchievement(toId, 'five_endorsements');
    if (receivedCount >= 10)  skillsRouter.grantAchievement(toId, 'ten_endorsements');
    if (receivedCount >= 25)  skillsRouter.grantAchievement(toId, 'twenty_five_endorse');
    if (receivedCount >= 50)  skillsRouter.grantAchievement(toId, 'fifty_endorsements');
    if (receivedCount >= 100) skillsRouter.grantAchievement(toId, 'hundred_endorsements');

    // Достижения для подтверждающего — по количеству выданных
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
    const fromUserData = db.prepare(
      'SELECT first_name FROM users WHERE id = ?'
    ).get(fromId);

    db.prepare(`
      INSERT INTO feed_events (user_id, event_type, event_data)
      VALUES (?, 'endorsement', ?)
    `).run(toId, JSON.stringify({
      fromUser: fromUserData?.first_name || 'Кто-то',
      fromUserId: fromId,
      skill: skill?.name || '???',
      skillId
    }));

    res.json({
      message: 'Навык подтверждён',
      skill: result // {rank, baseRank, plus, title, ...}
    });

  } catch (error) {
    console.error('❌ Подтверждение:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// GET /api/endorsements/:userId/:skillId
// ============================================
// Возвращает список подтверждающих + общую статистику.
// Ранг подтверждающего берём из user_skills (его ранг по ЭТОМУ скиллу).

router.get('/:userId/:skillId', (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const skillId = parseInt(req.params.skillId);

    if (isNaN(userId) || isNaN(skillId)) {
      return res.status(400).json({ error: 'Неверные параметры' });
    }

    const endorsers = db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.username,
             u.photo_url, u.overall_rank,
             us.rank AS skill_rank,
             e.created_at
      FROM endorsements e
      JOIN users u ON e.from_user_id = u.id
      LEFT JOIN user_skills us
        ON us.user_id = e.from_user_id AND us.skill_id = e.skill_id
      WHERE e.to_user_id = ? AND e.skill_id = ?
      ORDER BY e.created_at DESC
      LIMIT 50
    `).all(userId, skillId);

    const totalCount = db.prepare(
      'SELECT COUNT(*) as c FROM endorsements WHERE to_user_id = ? AND skill_id = ?'
    ).get(userId, skillId).c;

    res.json({
      endorsers: endorsers.map(e => ({
        rank: e.skill_rank || e.overall_rank || 'F',
        rankLabel: (() => {
          const rank = e.skill_rank || e.overall_rank || 'F';
          const title = getTitleByRank(rank);
          return title ? `Ранг ${rank} · ${title}` : `Ранг ${rank}`;
        })(),
        id: e.id,
        firstName: e.first_name,
        lastName: e.last_name,
        username: e.username,
        photoUrl: e.photo_url,
        overallRank: e.overall_rank || 'F',
        skillRank: e.skill_rank || 'F',  // ранг подтверждающего по этому скиллу
        createdAt: e.created_at
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

    if (isNaN(toId) || isNaN(skillId)) {
      return res.status(400).json({ error: 'Неверные параметры' });
    }

    const result = db.prepare(
      'DELETE FROM endorsements WHERE from_user_id = ? AND to_user_id = ? AND skill_id = ?'
    ).run(fromId, toId, skillId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Подтверждение не найдено' });
    }

    // Пересчёт может уронить ранг с A/S обратно вниз — это нормально
    const skillsRouter = require('./skills');
    const skill = skillsRouter.recalcSkill(toId, skillId);

    res.json({ message: 'Подтверждение отозвано', skill });

  } catch (error) {
    console.error('❌ Удаление подтверждения:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


module.exports = router;
