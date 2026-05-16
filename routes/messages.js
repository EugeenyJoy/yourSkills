// ============================================
// routes/messages.js — личные сообщения
// ============================================
// Правила:
//   - Писать можно только при взаимной подписке
//   - Лимит 20 сообщений в диалоге (общий)
//   - При превышении удаляем самое старое
//   - Антиспам: 2 сообщения подряд без ответа собеседника
//   - Уведомление в TG только если получатель не онлайн
// ============================================

const express = require('express');
const router = express.Router();
const db = require('../database');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// ============================================
// Хелперы
// ============================================

/**
 * Ключ диалога — всегда "меньшийId_большийId".
 * Нужен чтобы индекс работал на любую пару юзеров.
 */
function makeDialogKey(a, b) {
  const x = Number(a);
  const y = Number(b);
  return x < y ? `${x}_${y}` : `${y}_${x}`;
}

/**
 * Проверка взаимной подписки.
 * Возвращает true, если оба подписаны друг на друга.
 */
function isMutualFollow(userA, userB) {
  const row = db.prepare(`
    SELECT
      EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?) AS a,
      EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?) AS b
  `).get(userA, userB, userB, userA);
  return Boolean(row.a && row.b);
}

/**
 * Проверка антиспама.
 * Смотрим хвост диалога: сколько подряд сообщений от userId
 * идут в самом конце (до первого сообщения собеседника).
 * Если >= 2 — писать нельзя, ждём ответа.
 */
function canSendMessage(userId, otherId) {
  const dialogKey = makeDialogKey(userId, otherId);
  // Берём последние 2 сообщения в диалоге
  const last = db.prepare(`
    SELECT from_user_id
    FROM messages
    WHERE dialog_key = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 2
  `).all(dialogKey);

  // Если меньше 2 сообщений — точно можно
  if (last.length < 2) return true;
  // Если оба последних от меня — нельзя
  if (last[0].from_user_id === userId && last[1].from_user_id === userId) {
    return false;
  }
  return true;
}

/**
 * Получить минимальные данные о юзере для отображения.
 */
function getUserBrief(userId) {
  return db.prepare(`
    SELECT id, first_name, last_name, username, photo_url, overall_rank, last_seen_at
    FROM users WHERE id = ?
  `).get(userId);
}

// ============================================
// GET /api/messages/dialogs
// Список моих диалогов
// ============================================
router.get('/dialogs', (req, res) => {
  try {
    const userId = req.userId;

    // Берём по одной "последней" записи на каждый dialog_key, где я участвую
    const dialogs = db.prepare(`
      SELECT
        m.dialog_key,
        m.text         AS last_text,
        m.from_user_id AS last_from,
        m.created_at   AS last_at,
        CASE WHEN m.from_user_id = ? THEN m.to_user_id ELSE m.from_user_id END AS other_id,
        (
          SELECT COUNT(*) FROM messages m2
          WHERE m2.dialog_key = m.dialog_key
            AND m2.to_user_id = ?
            AND m2.is_read = 0
        ) AS unread_count
      FROM messages m
      WHERE m.id IN (
        SELECT MAX(id) FROM messages
        WHERE from_user_id = ? OR to_user_id = ?
        GROUP BY dialog_key
      )
      ORDER BY m.created_at DESC
    `).all(userId, userId, userId, userId);

    // Подмешиваем данные собеседника
    const result = dialogs.map(d => {
      const other = getUserBrief(d.other_id);
      return {
        other_user: other,
        last_text: d.last_text,
        last_from_me: d.last_from === userId,
        last_at: d.last_at,
        unread_count: d.unread_count
      };
    });

    res.json({ dialogs: result });
  } catch (err) {
    console.error('❌ GET /messages/dialogs:', err.message);
    res.status(500).json({ error: 'Ошибка получения диалогов' });
  }
});

// ============================================
// GET /api/messages/with/:userId
// Переписка с конкретным юзером
// ============================================
router.get('/with/:userId', (req, res) => {
  try {
    const me = req.userId;
    const other = Number(req.params.userId);
    if (!other || other === me) {
      return res.status(400).json({ error: 'Некорректный собеседник' });
    }

    const otherUser = getUserBrief(other);
    if (!otherUser) return res.status(404).json({ error: 'Пользователь не найден' });

    const mutual = isMutualFollow(me, other);
    const dialogKey = makeDialogKey(me, other);

    const messages = db.prepare(`
      SELECT id, from_user_id, to_user_id, text, is_read, created_at
      FROM messages
      WHERE dialog_key = ?
      ORDER BY created_at ASC, id ASC
    `).all(dialogKey);

    const canSend = mutual && canSendMessage(me, other);

    res.json({
      other_user: otherUser,
      mutual_follow: mutual,
      can_send: canSend,
      messages
    });
  } catch (err) {
    console.error('❌ GET /messages/with:', err.message);
    res.status(500).json({ error: 'Ошибка получения переписки' });
  }
});

// ============================================
// POST /api/messages/with/:userId
// Отправить сообщение
// ============================================
router.post('/with/:userId', (req, res) => {
  try {
    const me = req.userId;
    const other = Number(req.params.userId);
    const text = String(req.body?.text || '').trim();

    if (!other || other === me) {
      return res.status(400).json({ error: 'Некорректный получатель' });
    }
    if (!text) {
      return res.status(400).json({ error: 'Пустое сообщение' });
    }
    if (text.length > 2000) {
      return res.status(400).json({ error: 'Сообщение слишком длинное (макс. 2000)' });
    }

    const otherUser = getUserBrief(other);
    if (!otherUser) {
      return res.status(404).json({ error: 'Получатель не найден' });
    }

    if (!isMutualFollow(me, other)) {
      return res.status(403).json({ error: 'Нужна взаимная подписка' });
    }

    if (!canSendMessage(me, other)) {
      return res.status(429).json({ error: 'Дождись ответа собеседника' });
    }

    const dialogKey = makeDialogKey(me, other);

    // Транзакция: вставка + чистка лимита
    const sendTx = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO messages (dialog_key, from_user_id, to_user_id, text)
        VALUES (?, ?, ?, ?)
      `).run(dialogKey, me, other, text);

      // Если в диалоге больше 20 — удаляем самое старое
      const count = db.prepare(
        'SELECT COUNT(*) AS c FROM messages WHERE dialog_key = ?'
      ).get(dialogKey).c;

      if (count > 20) {
        const overflow = count - 20;
        db.prepare(`
          DELETE FROM messages
          WHERE id IN (
            SELECT id FROM messages
            WHERE dialog_key = ?
            ORDER BY created_at ASC, id ASC
            LIMIT ?
          )
        `).run(dialogKey, overflow);
      }

      return info.lastInsertRowid;
    });

    const newId = sendTx();
    const created = db.prepare(`
      SELECT id, from_user_id, to_user_id, text, is_read, created_at
      FROM messages WHERE id = ?
    `).get(newId);

    // Уведомление в TG — только если получатель не онлайн (последняя активность > 60 сек назад)
    try {
      const notify = req.app.get('notifyNewMessage');
      if (typeof notify === 'function') {
        const ONLINE_WINDOW_MS = 60 * 1000;
        let isOnline = false;
        if (otherUser.last_seen_at) {
          const lastSeen = new Date(otherUser.last_seen_at + 'Z').getTime();
          if (!Number.isNaN(lastSeen)) {
            isOnline = (Date.now() - lastSeen) < ONLINE_WINDOW_MS;
          }
        }
        if (!isOnline) {
          const fromUser = getUserBrief(me);
          // не блокируем ответ — fire and forget
          notify(other, fromUser, text).catch(e =>
            console.error('notifyNewMessage error:', e.message)
          );
        }
      }
    } catch (e) {
      console.error('notify hook error:', e.message);
    }

    res.json({ message: created });
  } catch (err) {
    console.error('❌ POST /messages/with:', err.message);
    res.status(500).json({ error: 'Ошибка отправки сообщения' });
  }
});

// ============================================
// POST /api/messages/with/:userId/read
// Пометить все входящие в этом диалоге прочитанными
// ============================================
router.post('/with/:userId/read', (req, res) => {
  try {
    const me = req.userId;
    const other = Number(req.params.userId);
    if (!other || other === me) {
      return res.status(400).json({ error: 'Некорректный собеседник' });
    }

    const dialogKey = makeDialogKey(me, other);
    const info = db.prepare(`
      UPDATE messages
      SET is_read = 1
      WHERE dialog_key = ? AND to_user_id = ? AND is_read = 0
    `).run(dialogKey, me);

    res.json({ updated: info.changes });
  } catch (err) {
    console.error('❌ POST /messages/with/read:', err.message);
    res.status(500).json({ error: 'Ошибка отметки прочтения' });
  }
});

// ============================================
// GET /api/messages/unread-count
// Общий счётчик непрочитанных (для бейджа в UI)
// ============================================
router.get('/unread-count', (req, res) => {
  try {
    const me = req.userId;
    const row = db.prepare(`
      SELECT COUNT(*) AS c
      FROM messages
      WHERE to_user_id = ? AND is_read = 0
    `).get(me);
    res.json({ unread: row.c });
  } catch (err) {
    console.error('❌ GET /messages/unread-count:', err.message);
    res.status(500).json({ error: 'Ошибка' });
  }
});

module.exports = router;