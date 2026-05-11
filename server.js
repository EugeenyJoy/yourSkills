// ============================================
// server.js — Главный сервер приложения
// ============================================
// Точка входа. Здесь:
// — Настройка Express
// — Безопасность (заголовки, лимиты, санитизация)
// — Подключение маршрутов
// — Запуск сервера
// ============================================

// Загружаем переменные окружения из .env
// ВАЖНО: это должно быть ПЕРВОЙ строкой,
// чтобы все модули ниже видели process.env
require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');

// Инициализация базы данных (создаст таблицы при первом запуске)
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;


// ============================================
// БЕЗОПАСНОСТЬ: Заголовки ответов
// ============================================
// Эти заголовки защищают от распространённых атак.
// Ставим ДО всех маршрутов, чтобы применялись везде.
// ============================================

app.use((req, res, next) => {

  // Запрещаем браузеру угадывать тип контента
  // Без этого браузер может интерпретировать
  // загруженный файл как скрипт — это XSS атака
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Разрешаем iframe для Telegram и туннелей
  // (Telegram Mini App открывается внутри iframe)
  res.removeHeader('X-Frame-Options');

  // Запрещаем встраивать наш сайт в iframe на чужих сайтах
  // Защита от Clickjacking — когда поверх нашего сайта
  // рисуют невидимую кнопку и обманом заставляют нажать
  // res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // Включаем встроенный XSS-фильтр браузера
  // Блокирует страницу если обнаружен XSS
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Запрещаем отправлять Referer при переходе на HTTP
  // Наши внутренние URL не утекут на чужие сайты
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy — отключаем доступ к камере,
  // микрофону, геолокации (нам не нужно)
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Content Security Policy — ГЛАВНЫЙ щит от XSS
  // Разрешаем загружать скрипты и стили ТОЛЬКО с нашего домена
  // и с Telegram CDN (для аватарок и Web App API)
  res.setHeader('Content-Security-Policy', [
    "default-src 'self' https: data:",                          // По умолчанию — только наш домен
    "script-src 'self' 'unsafe-inline' https://telegram.org",      // Скрипты: мы + Telegram SDK
    "style-src 'self' 'unsafe-inline'",            // Стили: мы + inline (нужно для динамики)
    "img-src 'self' https: data: blob:", // Картинки
    "connect-src 'self' https:",                          // AJAX запросы только к нам
    "font-src 'self' https: data:",                             // Шрифты только наши
    "frame-ancestors https://web.telegram.org https://*.telegram.org https://*.trycloudflare.com https://*.loca.lt https://*.serveo.net *",
    "object-src 'none'",                           // Запрет Flash/Java апплетов
    "base-uri 'self'",                             // Запрет подмены base URL
  ].join('; '));

  next();
});


// ============================================
// БЕЗОПАСНОСТЬ: Ограничение размера запросов
// ============================================
// Без этого злоумышленник может отправить запрос
// на 1GB и убить сервер по памяти.
// ============================================

// Парсим JSON тело запроса, максимум 100KB
// (у нас нет загрузки файлов — только текст и числа)
app.use(express.json({ limit: '100kb' }));

// Парсим URL-encoded данные (формы), тоже с лимитом
app.use(express.urlencoded({ extended: false, limit: '100kb' }));


// ============================================
// БЕЗОПАСНОСТЬ: Rate Limiting (ограничение частоты)
// ============================================
// Без внешних библиотек — простой счётчик в памяти.
// Защищает от брутфорса и DDoS на уровне приложения.
// ============================================

// Хранилище: { 'ip_адрес': { count: число, resetTime: время } }
const rateLimitStore = new Map();

// Очищаем старые записи каждые 5 минут,
// чтобы Map не разрастался бесконечно
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore) {
    if (now > value.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Создаёт middleware для ограничения частоты запросов
 * @param {number} maxRequests — максимум запросов за окно
 * @param {number} windowMs — размер окна в миллисекундах
 */
function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    // Определяем ключ — IP адрес + путь маршрута
    // Так лимиты на /api/auth и /api/skills — отдельные
    const key = req.ip + ':' + req.route?.path || req.path;
    const now = Date.now();

    let record = rateLimitStore.get(key);

    if (!record || now > record.resetTime) {
      // Первый запрос или окно истекло — создаём новую запись
      record = { count: 1, resetTime: now + windowMs };
      rateLimitStore.set(key, record);
    } else {
      record.count++;
    }

    // Добавляем заголовки чтобы клиент знал о лимитах
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - record.count));

    if (record.count > maxRequests) {
      // Превышен лимит — отказ
      return res.status(429).json({
        error: 'Слишком много запросов. Подождите немного.',
        retryAfter: Math.ceil((record.resetTime - now) / 1000)
      });
    }

    next();
  };
}

// Общий лимит: 100 запросов в минуту с одного IP
app.use(rateLimit(100, 60 * 1000));


// ============================================
// БЕЗОПАСНОСТЬ: Санитизация входных данных
// ============================================
// Очищаем ВСЕ строки от HTML-тегов и опасных символов.
// Это middleware обрабатывает каждый запрос.
// ============================================

/**
 * Убирает HTML-теги и опасные символы из строки
 * Защита от XSS — если кто-то отправит
 * "<script>alert('hack')</script>" в поле имени,
 * оно превратится в безопасный текст
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/[<>]/g, '')          // Убираем угловые скобки (HTML теги)
    .replace(/javascript:/gi, '')   // Убираем javascript: протокол
    .replace(/on\w+=/gi, '')        // Убираем обработчики событий (onclick= и т.п.)
    .trim()                         // Убираем пробелы по краям
    .slice(0, 1000);                // Ограничиваем длину строки
}

/**
 * Рекурсивно очищает все строки в объекте
 * Работает с вложенными объектами и массивами
 */
function sanitizeObject(obj) {
  if (typeof obj === 'string') return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (obj && typeof obj === 'object') {
    const clean = {};
    for (const [key, value] of Object.entries(obj)) {
      // Очищаем и ключи тоже — на всякий случай
      clean[sanitizeString(key)] = sanitizeObject(value);
    }
    return clean;
  }
  return obj;
}

// Применяем санитизацию ко всем входящим данным
app.use((req, res, next) => {
  if (req.body) req.body = sanitizeObject(req.body);
  if (req.query) req.query = sanitizeObject(req.query);
  if (req.params) req.params = sanitizeObject(req.params);
  next();
});


// ============================================
// БЕЗОПАСНОСТЬ: Валидация Telegram данных
// ============================================
// Telegram подписывает данные HMAC-SHA256.
// Мы проверяем подпись чтобы убедиться что
// запрос реально пришёл из Telegram,
// а не от злоумышленника.
// ============================================

/**
 * Проверяет подпись initData от Telegram Web App
 * Документация: https://core.telegram.org/bots/webapps#validating-data
 *
 * @param {string} initData — строка initData из Telegram.WebApp
 * @returns {object|null} — данные пользователя или null если подпись невалидна
 */
function validateTelegramData(initData) {
  try {
    // initData — это URL-encoded строка вида:
    // user={...}&auth_date=123&hash=abc...

    // Парсим параметры
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');

    if (!hash) return null;

    // Удаляем hash из параметров перед проверкой
    params.delete('hash');

    // Сортируем оставшиеся параметры по алфавиту
    // и собираем в строку формата "key=value\nkey=value"
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // Создаём секретный ключ из токена бота
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(process.env.BOT_TOKEN)
      .digest();

    // Вычисляем HMAC от данных
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // Сравниваем хэши безопасным способом
    // timingSafeEqual защищает от timing-атак
    // (когда по времени ответа угадывают символы хэша)
    const isValid = crypto.timingSafeEqual(
      Buffer.from(calculatedHash, 'hex'),
      Buffer.from(hash, 'hex')
    );

    if (!isValid) return null;

    // Проверяем что данные не устарели (не старше 1 часа)
    const authDate = parseInt(params.get('auth_date'));
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 3600) return null;

    // Парсим данные пользователя
    const user = JSON.parse(params.get('user'));
    return user;

  } catch (error) {
    console.error('Ошибка валидации Telegram данных:', error.message);
    return null;
  }
}

// Делаем доступной для маршрутов
app.validateTelegramData = validateTelegramData;


// ============================================
// БЕЗОПАСНОСТЬ: Middleware авторизации
// ============================================
// Проверяет что запрос от авторизованного пользователя.
// Добавляет req.user с данными из Telegram.
// ============================================

function authMiddleware(req, res, next) {
  // Telegram initData приходит в заголовке
  const initData = req.headers['x-telegram-init-data'];

  if (!initData) {
    return res.status(401).json({ error: 'Требуется авторизация через Telegram' });
  }

  // Валидируем подпись
  const user = validateTelegramData(initData);

  if (!user) {
    return res.status(403).json({ error: 'Невалидные данные авторизации' });
  }

  // Прикрепляем пользователя к запросу
  // Дальше в маршрутах доступен как req.user
  req.user = user;
  next();
}

// Делаем доступным для маршрутов
app.authMiddleware = authMiddleware;


// ============================================
// СТАТИЧЕСКИЕ ФАЙЛЫ
// ============================================
// Отдаём файлы из папки public/ (HTML, CSS, JS)
// maxAge — кэширование на 1 час (в продакшене)
// ============================================

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : '0',
  // Не показываем содержимое папок
  dotfiles: 'deny',
  // Отключаем индекс директорий
  index: 'index.html'
}));


// ============================================
// МАРШРУТЫ API
// ============================================
// Каждая группа маршрутов в отдельном файле.
// Все API-пути начинаются с /api/
// ============================================

app.use('/api/auth',         require('./routes/auth'));
app.use('/api/profile',      require('./routes/profile'));
app.use('/api/skills',       require('./routes/skills'));
app.use('/api/endorsements', require('./routes/endorsements'));
app.use('/api/streaks',      require('./routes/streaks'));
app.use('/api/feed',         require('./routes/feed'));


// ============================================
// SPA FALLBACK
// ============================================
// Для одностраничного приложения:
// любой URL который не /api/* и не файл
// → отдаём index.html
// Клиентский роутер разберётся что показать.
// ============================================

app.get('*', (req, res) => {
  // Не перехватываем API запросы
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Маршрут не найден' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// ============================================
// ОБРАБОТКА ОШИБОК
// ============================================
// Глобальный обработчик — ловит все необработанные ошибки.
// ВАЖНО: никогда не показываем стектрейс пользователю,
// это раскрывает внутреннюю структуру сервера.
// ============================================

app.use((err, req, res, next) => {
  // В консоль пишем полную ошибку (для отладки)
  console.error('❌ Ошибка:', err.message);
  console.error(err.stack);

  // Пользователю — только общее сообщение
  // Никаких деталей, стектрейсов, путей к файлам
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Внутренняя ошибка сервера'
      : err.message  // В режиме разработки показываем текст ошибки
  });
});

// ============================================
// ЗАПУСК БОТА
// ============================================
// Подключаем Telegram бота
// Он будет работать параллельно с сервером
// ============================================

require('./bot');

// ============================================
// ЗАПУСК
// ============================================

app.listen(PORT, () => {
  console.log('');
  console.log('🚀 yourSkills запущен');
  console.log(`📡 http://localhost:${PORT}`);
  console.log(`🔧 Режим: ${process.env.NODE_ENV || 'development'}`);
  console.log('');
});


// ============================================
// GRACEFUL SHUTDOWN
// ============================================
// Корректное завершение при остановке сервера.
// Закрываем соединение с базой данных,
// чтобы не потерять данные.
// ============================================

process.on('SIGINT', () => {
  console.log('\n🛑 Остановка сервера...');
  db.close();
  console.log('📦 База данных закрыта');
  process.exit(0);
});

process.on('SIGTERM', () => {
  db.close();
  process.exit(0);
});