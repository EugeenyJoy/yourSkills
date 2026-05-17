// ============================================
// bot.js — Telegram бот для уведомлений
// ============================================
// Бот выполняет две функции:
//
// 1. НАПОМИНАНИЯ — каждый вечер проверяет
//    кто не сделал чекин и пишет в личку:
//    "Твой стрик по Выпечке горит! 🔥"
//
// 2. КОМАНДЫ — базовые команды бота:
//    /start — приветствие + кнопка Mini App
//    /stats — быстрая статистика
//    /card — карточка профиля текстом
//
// Бот НЕ занимается авторизацией —
// это делает Mini App через initData.
// ============================================

const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');

// Токен из .env
const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL;

// Проверяем что токен есть
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не указан в .env');
  process.exit(1);
}

// Создаём бота
// polling: true — бот сам запрашивает обновления у Telegram
// (для продакшена лучше webhook, но для старта polling проще)
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 Telegram бот запущен');


// ============================================
// КОМАНДА: /start
// ============================================
// Первое сообщение при запуске бота.
// Показывает приветствие и кнопку Mini App.
// ============================================

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'друг';

  // Текст приветствия
  const welcomeText = [
    `👋 Привет, ${firstName}!`,
    '',
    '🎴 *yourSkills* — карточная соцсеть способностей',
    '',
    'Здесь ты можешь:',
    '🏆 Создать карточку со своими навыками',
    '📊 Прокачивать ранги от E до S',
    '🔥 Отмечать ежедневный прогресс',
    '🤝 Подтверждать навыки других',
    '👥 Находить интересных людей',
    '',
    '💬 [Сообщество моих проектов](https://t.me/Eugeenyjoy_ART)',
    '',
    'Нажми кнопку ниже чтобы открыть приложение 👇'
  ].join('\n');

  // Кнопка открытия Mini App
  await bot.sendMessage(chatId, welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{
          text: '🚀 Открыть yourSkills',
          web_app: { url: APP_URL }
        }]
      ]
    }
  });
});


// ============================================
// КОМАНДА: /stats
// ============================================
// Быстрая статистика прямо в чате.
// Не нужно открывать Mini App.
// ============================================

bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    // Ищем пользователя
    const user = db.prepare(
      'SELECT * FROM users WHERE id = ?'
    ).get(userId);

    if (!user) {
      return bot.sendMessage(chatId,
        '❌ Ты ещё не зарегистрирован. Открой приложение через /start'
      );
    }

    // Получаем навыки + дни чекинов для сортировки
    const skills = db.prepare(`
      SELECT
        us.*, s.name as skill_name,
        sc.icon as subcategory_icon,
        c.icon as category_icon,
        (SELECT COUNT(DISTINCT date) FROM checkins
           WHERE user_id = us.user_id AND skill_id = us.skill_id) as days
      FROM user_skills us
      JOIN skills s ON us.skill_id = s.id
      JOIN subcategories sc ON s.subcategory_id = sc.id
      JOIN categories c ON sc.category_id = c.id
      WHERE us.user_id = ?
    `).all(userId);

    // Сортируем по рангу (без +), потом по дням
    const RANK_IDX = { F:0, E:1, D:2, C:3, B:4, A:5, S:6 };
    skills.sort((a, b) => {
      const da = RANK_IDX[(a.rank || 'F').replace('+','')] || 0;
      const db_ = RANK_IDX[(b.rank || 'F').replace('+','')] || 0;
      if (db_ !== da) return db_ - da;
      return (b.days || 0) - (a.days || 0);
    });

    // Статистика
    const followers = db.prepare(
      'SELECT COUNT(*) as count FROM follows WHERE following_id = ?'
    ).get(userId).count;

    const endorsements = db.prepare(
      'SELECT COUNT(*) as count FROM endorsements WHERE to_user_id = ?'
    ).get(userId).count;

    const checkins = db.prepare(
      'SELECT COUNT(*) as count FROM checkins WHERE user_id = ?'
    ).get(userId).count;

    // Формируем текст
    let text = [
      `📊 *Статистика: ${user.first_name}*`,
      '',
      `⚡ Общий ранг: *${user.overall_rank}*`,
      `👥 Подписчики: ${followers}`,
      `🤝 Подтверждений: ${endorsements}`,
      `📅 Всего чекинов: ${checkins}`,
      '',
    ];

    if (skills.length > 0) {
      text.push('*Навыки:*');

      skills.forEach(skill => {
        const streak = skill.current_streak > 0
          ? ` 🔥${skill.current_streak}`
          : '';
        const daysStr = skill.days > 0 ? ` · ${skill.days}д` : '';
        text.push(
          `${skill.category_icon} ${skill.skill_name} — ` +
          `*${skill.rank}*${daysStr}${streak}`
        );
      });
    } else {
      text.push('_Навыки не добавлены_');
    }

    await bot.sendMessage(chatId, text.join('\n'), {
      parse_mode: 'Markdown'
    });

  } catch (error) {
    console.error('❌ Ошибка /stats:', error.message);
    bot.sendMessage(chatId, '❌ Произошла ошибка');
  }
});


// ============================================
// КОМАНДА: /card
// ============================================
// Текстовая карточка профиля.
// Красивый формат для пересылки друзьям.
// ============================================

bot.onText(/\/card/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    const user = db.prepare(
      'SELECT * FROM users WHERE id = ?'
    ).get(userId);

    if (!user) {
      return bot.sendMessage(chatId,
        '❌ Ты ещё не зарегистрирован. Открой приложение через /start'
      );
    }

    // Топ-3 навыка — сортировка по рангу (числовой индекс) и дням
    const topSkills = db.prepare(`
      SELECT
        us.skill_id,
        us.rank,
        us.current_streak,
        s.name as skill_name,
        c.icon as category_icon,
        (SELECT COUNT(DISTINCT date) FROM checkins
           WHERE user_id = us.user_id AND skill_id = us.skill_id) as days,
        CASE REPLACE(COALESCE(us.rank,'F'),'+','')
          WHEN 'F' THEN 0 WHEN 'E' THEN 1 WHEN 'D' THEN 2 WHEN 'C' THEN 3
          WHEN 'B' THEN 4 WHEN 'A' THEN 5 WHEN 'S' THEN 6 ELSE 0
        END as rank_num
      FROM user_skills us
      JOIN skills s ON us.skill_id = s.id
      JOIN subcategories sc ON s.subcategory_id = sc.id
      JOIN categories c ON sc.category_id = c.id
      WHERE us.user_id = ?
      ORDER BY rank_num DESC, days DESC
      LIMIT 3
    `).all(userId);

    // Счётчики
    const skillCount = db.prepare(
      'SELECT COUNT(*) as count FROM user_skills WHERE user_id = ?'
    ).get(userId).count;

    const achievementCount = db.prepare(
      'SELECT COUNT(*) as count FROM user_achievements WHERE user_id = ?'
    ).get(userId).count;

    // Формируем карточку
    const rankEmoji = {
      'S': '🔴', 'A': '🟠', 'B': '🟣',
      'C': '🔵', 'D': '🟢', 'E': '⚪', 'F': '⚫'
    };
    const baseRank = (user.overall_rank || 'F').replace('+','');

    let card = [
      '┌─────────────────────┐',
      `│  ${rankEmoji[baseRank] || '⚫'} Ранг: *${user.overall_rank}*`,
      '│',
      `│  👤 *${user.first_name}${user.last_name ? ' ' + user.last_name : ''}*`,
    ];

    if (user.username) {
      card.push(`│  @${user.username}`);
    }

    card.push('│');

    if (topSkills.length > 0) {
      card.push('│  📋 *Навыки:*');
      topSkills.forEach(skill => {
        const streak = skill.current_streak > 0
          ? ` 🔥${skill.current_streak}д`
          : '';
        card.push(
          `│  ${skill.category_icon} ${skill.skill_name} [${skill.rank}]${streak}`
        );
      });

      if (skillCount > 3) {
        card.push(`│  _...и ещё ${skillCount - 3}_`);
      }
    } else {
      card.push('│  _Навыки не добавлены_');
    }

    card.push('│');
    card.push(`│  🏆 Достижений: ${achievementCount}`);
    card.push('└─────────────────────┘');
    card.push('');
    card.push('🎴 _yourSkills — покажи свои способности_');

    await bot.sendMessage(chatId, card.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{
            text: '🔗 Открыть профиль',
            web_app: { url: APP_URL }
          }]
        ]
      }
    });

  } catch (error) {
    console.error('❌ Ошибка /card:', error.message);
    bot.sendMessage(chatId, '❌ Произошла ошибка');
  }
});


// ============================================
// КОМАНДА: /help
// ============================================
// Справка по командам бота.
// ============================================

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;

  const helpText = [
    '📖 *Команды бота yourSkills:*',
    '',
    '/start — Приветствие и запуск приложения',
    '/stats — Твоя статистика',
    '/card — Карточка профиля',
    '/streak — Статус стриков',
    '/help — Эта справка',
    '',
    '🔔 Бот автоматически напомнит если ты',
    'забудешь отметить прогресс!',
  ].join('\n');

  await bot.sendMessage(chatId, helpText, {
    parse_mode: 'Markdown'
  });
});


// ============================================
// КОМАНДА: /streak
// ============================================
// Текущие стрики по всем навыкам.
// ============================================

bot.onText(/\/streak/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    const user = db.prepare(
      'SELECT id FROM users WHERE id = ?'
    ).get(userId);

    if (!user) {
      return bot.sendMessage(chatId,
        '❌ Ты ещё не зарегистрирован. Открой приложение через /start'
      );
    }

    const today = new Date().toISOString().split('T')[0];

    // Навыки с данными стрика
    const skills = db.prepare(`
      SELECT
        us.skill_id,
        us.current_streak,
        us.best_streak,
        s.name as skill_name,
        c.icon as category_icon
      FROM user_skills us
      JOIN skills s ON us.skill_id = s.id
      JOIN categories c ON s.category_id = c.id
      WHERE us.user_id = ?
      ORDER BY us.current_streak DESC
    `).all(userId);

    if (skills.length === 0) {
      return bot.sendMessage(chatId,
        '📋 У тебя пока нет навыков. Добавь через приложение!'
      );
    }

    let text = ['🔥 *Твои стрики:*', ''];

    skills.forEach(skill => {
      // Проверяем чекин сегодня
      const checkedToday = db.prepare(
        'SELECT 1 FROM checkins WHERE user_id = ? AND skill_id = ? AND date = ?'
      ).get(userId, skill.skill_id, today);

      const status = checkedToday ? '✅' : '⬜';
      const streak = skill.current_streak > 0
        ? `🔥 ${skill.current_streak} дн.`
        : '💤 нет серии';

      const best = skill.best_streak > 0
        ? ` (рекорд: ${skill.best_streak})`
        : '';

      text.push(
        `${status} ${skill.category_icon} *${skill.skill_name}*`
      );
      text.push(`   ${streak}${best}`);
    });

    // Итого
    const checkedCount = skills.filter(s => {
      return db.prepare(
        'SELECT 1 FROM checkins WHERE user_id = ? AND skill_id = ? AND date = ?'
      ).get(userId, s.skill_id, today);
    }).length;

    text.push('');
    text.push(`📊 Сегодня: ${checkedCount}/${skills.length}`);

    if (checkedCount < skills.length) {
      text.push('');
      text.push('👇 Не забудь отметить прогресс!');
    } else {
      text.push('');
      text.push('🎉 Все навыки отмечены! Молодец!');
    }

    await bot.sendMessage(chatId, text.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{
            text: '📝 Отметить прогресс',
            web_app: { url: APP_URL }
          }]
        ]
      }
    });

  } catch (error) {
    console.error('❌ Ошибка /streak:', error.message);
    bot.sendMessage(chatId, '❌ Произошла ошибка');
  }
});

// ============================================
// КОМАНДА: /recalc (админская)
// ============================================
// Запускает ночной пересчёт рангов вручную.
// Доступна только владельцу бота (см. ADMIN_ID в .env).

bot.onText(/\/recalc/, async (msg) => {
  const chatId = msg.chat.id;

  // ADMIN_IDS — через запятую: "12345,67890"
  const adminIds = (process.env.ADMIN_IDS || '')
    .split(',')
    .map(s => parseInt(s.trim()))
    .filter(n => Number.isFinite(n));

  if (!adminIds.includes(msg.from.id)) {
    return; // молча игнорируем не-админов
  }

  await bot.sendMessage(chatId, '🌙 Запускаю пересчёт...');

  try {
    const skillsRouter = require('./routes/skills');
    const result = skillsRouter.recalcAllSkillsForAllUsers();
    await bot.sendMessage(chatId,
      `✅ Готово за ${result.elapsed}с\n` +
      `Юзеров: ${result.usersProcessed}\n` +
      `Скиллов: ${result.skillsProcessed}\n` +
      `Падений ранга: ${result.demotions}`
    );
  } catch (err) {
    await bot.sendMessage(chatId, `❌ ${err.message}`);
  }
});


// ============================================
// АВТОМАТИЧЕСКИЕ НАПОМИНАНИЯ
// ============================================
// Каждый день в 20:00 (по серверному времени)
// проверяем кто не сделал чекин и напоминаем.
//
// Это ГЛАВНАЯ механика удержания.
// Без напоминаний люди забывают заходить.
// ============================================

/**
 * Отправляет напоминания пользователям
 * у которых есть активные стрики
 * но они не сделали чекин сегодня.
 */
async function sendStreakReminders() {
  console.log('🔔 Отправка напоминаний о стриках...');

  const today = new Date().toISOString().split('T')[0];

  try {
    // Находим пользователей у которых:
    // 1. Есть навыки со стриком > 0
    // 2. Нет чекина сегодня по этим навыкам
    const usersToRemind = db.prepare(`
      SELECT DISTINCT
        us.user_id,
        u.first_name,
        us.skill_id,
        us.current_streak,
        s.name as skill_name
      FROM user_skills us
      JOIN users u ON us.user_id = u.id
      JOIN skills s ON us.skill_id = s.id
      WHERE us.current_streak > 0
        AND NOT EXISTS (
          SELECT 1 FROM checkins c
          WHERE c.user_id = us.user_id
            AND c.skill_id = us.skill_id
            AND c.date = ?
        )
      ORDER BY us.current_streak DESC
    `).all(today);

    // Группируем по пользователю
    // (один пользователь может иметь несколько неотмеченных навыков)
    const grouped = {};
    usersToRemind.forEach(row => {
      if (!grouped[row.user_id]) {
        grouped[row.user_id] = {
          firstName: row.first_name,
          skills: []
        };
      }
      grouped[row.user_id].skills.push({
        name: row.skill_name,
        streak: row.current_streak
      });
    });

    // Отправляем напоминания
    let sentCount = 0;

    for (const [userId, data] of Object.entries(grouped)) {
      try {
        // Формируем текст напоминания
        let text = [`⚠️ ${data.firstName}, твои стрики горят!`, ''];

        data.skills.forEach(skill => {
          text.push(`🔥 *${skill.name}* — ${skill.streak} дн. подряд`);
        });

        text.push('');
        text.push('Не дай серии прерваться! 💪');

        await bot.sendMessage(userId, text.join('\n'), {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{
                text: '📝 Отметить прогресс',
                web_app: { url: APP_URL }
              }]
            ]
          }
        });

        sentCount++;

        // Пауза между сообщениями — Telegram лимит
        // 30 сообщений в секунду, но лучше не рисковать
        await sleep(100);

      } catch (sendError) {
        // Пользователь заблокировал бота — это нормально
        if (sendError.response?.statusCode === 403) {
          console.log(`👤 Пользователь ${userId} заблокировал бота`);
        } else {
          console.error(`❌ Ошибка отправки ${userId}:`, sendError.message);
        }
      }
    }

    console.log(`🔔 Отправлено ${sentCount} напоминаний`);

  } catch (error) {
    console.error('❌ Ошибка отправки напоминаний:', error.message);
  }
}


/**
 * Задержка в миллисекундах
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ============================================
// ПЛАНИРОВЩИК НАПОМИНАНИЙ
// ============================================
// Запускаем проверку каждый час.
// Напоминание отправляется только один раз в день
// (в 20:00 по серверному времени).
//
// Почему не cron? Потому что это Node.js процесс
// и нам не нужна внешняя зависимость.
// ============================================

// Храним дату последней отправки чтобы не слать повторно
let lastReminderDate = null;
let lastRankRecalcDate = null;

setInterval(() => {
  const now = new Date();
  const hour = now.getHours();
  const today = now.toISOString().split('T')[0];

  // 20:00 — напоминания о стриках
  if (hour === 20 && lastReminderDate !== today) {
    lastReminderDate = today;
    sendStreakReminders();
  }

  // 03:00 — ночной пересчёт рангов
  if (hour === 3 && lastRankRecalcDate !== today) {
    lastRankRecalcDate = today;
    try {
      const skillsRouter = require('./routes/skills');
      skillsRouter.recalcAllSkillsForAllUsers();
    } catch (err) {
      console.error('❌ Ночной пересчёт упал:', err.message);
    }
  }
}, 60 * 60 * 1000); // Проверяем каждый час


// ============================================
// ОБРАБОТКА ОШИБОК БОТА
// ============================================
// Telegram бот может упасть из-за сетевых ошибок.
// Ловим и логируем, но не роняем весь сервер.
// ============================================

bot.on('polling_error', (error) => {
  // Игнорируем ETIMEOUT — это нормально для polling
  if (error.code === 'ETIMEOUT') return;
  if (
    process.env.NODE_ENV === 'development' &&
    error.code === 'ETELEGRAM' &&
    error.message?.includes('404 Not Found')
  ) {
    return;
  }
  console.error('❌ Ошибка polling бота:', error.message);
});

bot.on('error', (error) => {
  console.error('❌ Ошибка бота:', error.message);
});

// ============================================
// ХЕЛПЕР: уведомление о новом личном сообщении
// ============================================
// Шлём пользователю личку от бота.
// Проверку online/offline делает routes/messages.js.
// Здесь только антиспам + отправка.
// ============================================

// Антиспам-кэш: ключ "fromId->toId" → timestamp последней отправки
const _msgNotifyCache = new Map();
const NOTIFY_COOLDOWN_MS = 2 * 60 * 1000; // не чаще 1 раза в 2 мин на пару

/**
 * Отправляет получателю Telegram-уведомление о новом сообщении.
 *
 * @param {number} toUserId    — ID получателя
 * @param {object} fromUser    — { id, first_name, username }
 * @param {string} messageText — текст сообщения для превью
 */
async function notifyNewMessage(toUserId, fromUser, messageText) {
  try {
    const cacheKey = `${fromUser.id}->${toUserId}`;
    const lastNotify = _msgNotifyCache.get(cacheKey) || 0;
    if (Date.now() - lastNotify < NOTIFY_COOLDOWN_MS) {
      return;
    }
    _msgNotifyCache.set(cacheKey, Date.now());

    const preview = messageText.length > 100
      ? messageText.slice(0, 100) + '…'
      : messageText;

    const safeName = escapeMd(fromUser.first_name || 'Кто-то');
    const safePreview = escapeMd(preview);

    const text = [
      `💬 *Новое сообщение от ${safeName}*`,
      '',
      `_${safePreview}_`,
      '',
      'Открой приложение чтобы ответить 👇'
    ].join('\n');

    await bot.sendMessage(toUserId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '💬 Открыть чат', web_app: { url: APP_URL } }
        ]]
      }
    });

  } catch (err) {
    if (err.response?.statusCode === 403) {
      console.log(`👤 Пользователь ${toUserId} заблокировал бота`);
    } else {
      console.error('❌ Ошибка notifyNewMessage:', err.message);
    }
  }
}

/**
 * Экранирование символов Markdown
 */
function escapeMd(text) {
  return String(text).replace(/([_*`\[])/g, '\\$1');
}

// Делаем хелпер доступным извне
bot.notifyNewMessage = notifyNewMessage;


// ============================================
// Экспорт
// ============================================
module.exports = bot;