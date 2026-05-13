// ============================================
// routes/feed.js — Лента событий v3 + реакции
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
// Вспомогательные функции
// ============================================

function timeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60)    return 'только что';
  if (diff < 3600)  return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} дн назад`;
  return new Date(dateStr).toLocaleDateString('ru-RU');
}


function formatEvent(row) {
  let data = {};
  try { data = JSON.parse(row.event_data || '{}'); } catch {}

  const base = {
    id: row.id,
    type: row.event_type,
    data,
    createdAt: row.created_at,
    timeAgo: timeAgo(row.created_at),
    user: {
      id: row.user_id,
      firstName: row.first_name || 'User',
      lastName: row.last_name || '',
      rank: row.overall_rank || 'F',
      avatarUrl: row.photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${row.user_id}`,
    },
    reactions: [],
    userReaction: null
  };

  switch (row.event_type) {
    case 'rank_up':
      base.icon = '⬆️';
      base.title = `Повышение до ${data.newRank}!`;
      base.text = `${data.skill || '???'}: ${data.oldRank} → ${data.newRank}`;
      base.accent = data.newRank === 'S' ? 'gold'
        : data.newRank === 'A' ? 'orange'
        : data.newRank === 'B' ? 'purple'
        : 'blue';
      break;

    case 'achievement':
      base.icon = data.icon || '🏆';
      base.title = data.name || 'Достижение';
      base.text = `+${data.xp || 0} XP`;
      base.accent = data.rarity === 'legendary' ? 'gold'
        : data.rarity === 'epic' ? 'orange'
        : data.rarity === 'rare' ? 'blue'
        : 'green';
      break;

    case 'streak_milestone':
      base.icon = '🔥';
      base.title = `Стрик ${data.streak || 0} дней!`;
      base.text = data.skill || '';
      base.accent = 'orange';
      break;

    case 'new_skill':
      base.icon = data.categoryIcon || '🌱';
      base.title = `Новый навык: ${data.skill || '???'}`;
      base.text = data.activeYears > 0
        ? `${data.activeYears} лет реального опыта`
        : 'Начало пути';
      base.accent = 'green';
      break;

    case 'endorsement':
      base.icon = '🤝';
      base.title = `${data.fromUser || 'Кто-то'} подтвердил навык`;
      base.text = `${data.skill || '???'} (+${data.xpGiven || 0} XP)`;
      base.accent = 'blue';
      break;

    default:
      base.icon = '📌';
      base.title = row.event_type;
      base.text = '';
      base.accent = 'gray';
  }

  return base;
}


/**
 * Подгружает реакции к массиву событий
 */
function attachReactions(events, userId) {
  if (events.length === 0) return events;

  const ids = events.map(e => e.id);
  const placeholders = ids.map(() => '?').join(',');

  // Все реакции сгруппированные
  const allReactions = db.prepare(`
    SELECT event_id, reaction, COUNT(*) as count
    FROM feed_reactions
    WHERE event_id IN (${placeholders})
    GROUP BY event_id, reaction
  `).all(...ids);

  // Реакции текущего пользователя
  const userReactions = db.prepare(`
    SELECT event_id, reaction
    FROM feed_reactions
    WHERE event_id IN (${placeholders}) AND user_id = ?
  `).all(...ids, userId);

  // Собираем в Map
  const reactionsMap = new Map();
  allReactions.forEach(r => {
    if (!reactionsMap.has(r.event_id)) reactionsMap.set(r.event_id, []);
    reactionsMap.get(r.event_id).push({ emoji: r.reaction, count: r.count });
  });

  const userReactionMap = new Map();
  userReactions.forEach(r => userReactionMap.set(r.event_id, r.reaction));

  // Прикрепляем к событиям
  return events.map(e => ({
    ...e,
    reactions: reactionsMap.get(e.id) || [],
    userReaction: userReactionMap.get(e.id) || null,
  }));
}


/**
 * Общая логика загрузки ленты
 */
function loadFeed(query, params, userId, page, limit) {
  const rows = db.prepare(query).all(...params);
  const hasMore = rows.length > limit;

  const events = rows.slice(0, limit).map(row => {
    const formatted = formatEvent(row);
    formatted.id = row.id; // Гарантируем id
    return formatted;
  });

  const enriched = attachReactions(events, userId);

  return { events: enriched, hasMore, page };
}


// ============================================
// GET /api/feed — Персональная лента
// ============================================

router.get('/', (req, res) => {
  try {
    const userId = req.userId;
    const page = parseInt(req.query.page) || 0;
    const limit = 20;

    const result = loadFeed(
      `SELECT fe.*, u.first_name, u.last_name, u.photo_url, u.overall_rank
       FROM feed_events fe
       JOIN users u ON fe.user_id = u.id
       WHERE fe.user_id IN (
         SELECT following_id FROM follows WHERE follower_id = ?
       ) OR fe.user_id = ?
       ORDER BY fe.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, userId, limit + 1, page * limit],
      userId,
      page,
      limit
    );

    res.json(result);

  } catch (error) {
    console.error('❌ Лента:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// GET /api/feed/global — Глобальная лента
// ============================================

router.get('/global', (req, res) => {
  try {
    const userId = req.userId;
    const page = parseInt(req.query.page) || 0;
    const limit = 20;
    const rank = req.query.rank; // Фильтр по рангу

    let query = `
      SELECT fe.*, u.first_name, u.last_name, u.photo_url, u.overall_rank
      FROM feed_events fe
      JOIN users u ON fe.user_id = u.id
      WHERE fe.event_type IN ('rank_up', 'achievement', 'streak_milestone')
    `;
    const params = [];

    // Фильтр по рангу пользователя
    if (rank && ['F','E','D','C','B','A','S'].includes(rank)) {
      query += ' AND u.overall_rank = ?';
      params.push(rank);
    }

    query += ' ORDER BY fe.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit + 1, page * limit);

    const result = loadFeed(query, params, userId, page, limit);
    res.json(result);

  } catch (error) {
    console.error('❌ Глобальная лента:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// GET /api/feed/user/:userId — Лента пользователя
// ============================================

router.get('/user/:userId', (req, res) => {
  try {
    const viewerId = req.userId;
    const targetId = parseInt(req.params.userId);
    const page = parseInt(req.query.page) || 0;
    const limit = 20;

    if (isNaN(targetId)) {
      return res.status(400).json({ error: 'Неверный ID' });
    }

    const result = loadFeed(
      `SELECT fe.*, u.first_name, u.last_name, u.photo_url, u.overall_rank
       FROM feed_events fe
       JOIN users u ON fe.user_id = u.id
       WHERE fe.user_id = ?
       ORDER BY fe.created_at DESC
       LIMIT ? OFFSET ?`,
      [targetId, limit + 1, page * limit],
      viewerId,
      page,
      limit
    );

    res.json(result);

  } catch (error) {
    console.error('❌ Лента пользователя:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// POST /api/feed/:eventId/react — Поставить реакцию
// ============================================

router.post('/:eventId/react', (req, res) => {
  try {
    const userId = req.userId;
    const eventId = parseInt(req.params.eventId);
    const { reaction } = req.body;

    if (isNaN(eventId)) {
      return res.status(400).json({ error: 'Неверный ID события' });
    }

    // Список разрешённых реакций
    const allowed = ['👏', '🔥', '💪', '❤️', '🎉', '⚡'];
    const emoji = allowed.includes(reaction) ? reaction : '👏';

    // Проверяем что событие существует
    const event = db.prepare('SELECT id FROM feed_events WHERE id = ?').get(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Событие не найдено' });
    }

    // Вставляем или обновляем реакцию
    db.prepare(`
      INSERT INTO feed_reactions (event_id, user_id, reaction)
      VALUES (?, ?, ?)
      ON CONFLICT(event_id, user_id)
      DO UPDATE SET reaction = ?, created_at = CURRENT_TIMESTAMP
    `).run(eventId, userId, emoji, emoji);

    // Возвращаем обновлённые реакции
    const reactions = db.prepare(`
      SELECT reaction as emoji, COUNT(*) as count
      FROM feed_reactions
      WHERE event_id = ?
      GROUP BY reaction
    `).all(eventId);

    res.json({
      reactions,
      userReaction: emoji
    });

  } catch (error) {
    console.error('❌ Реакция:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


// ============================================
// DELETE /api/feed/:eventId/react — Убрать реакцию
// ============================================

router.delete('/:eventId/react', (req, res) => {
  try {
    const userId = req.userId;
    const eventId = parseInt(req.params.eventId);

    if (isNaN(eventId)) {
      return res.status(400).json({ error: 'Неверный ID события' });
    }

    db.prepare(
      'DELETE FROM feed_reactions WHERE event_id = ? AND user_id = ?'
    ).run(eventId, userId);

    // Возвращаем обновлённые реакции
    const reactions = db.prepare(`
      SELECT reaction as emoji, COUNT(*) as count
      FROM feed_reactions
      WHERE event_id = ?
      GROUP BY reaction
    `).all(eventId);

    res.json({
      reactions,
      userReaction: null
    });

  } catch (error) {
    console.error('❌ Удаление реакции:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


module.exports = router;
