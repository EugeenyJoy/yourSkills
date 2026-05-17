// ============================================
// database.js — База данных v4 (ранговая)
// ============================================
// Ранги: F → E → D → C → B → A → S
// Источник истины — чекины, без XP
// ============================================

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'yourskills.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');


// ============================================
// ТАБЛИЦЫ
// ============================================

db.exec(`

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT DEFAULT '',
    username TEXT DEFAULT '',
    photo_url TEXT DEFAULT '',
    language_code TEXT DEFAULT 'ru',
    overall_rank TEXT DEFAULT 'F',
    profile_text TEXT DEFAULT '',
    show_profile_text INTEGER DEFAULT 0,
    last_seen_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Категории (верхний уровень)
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    icon TEXT DEFAULT '📌',
    sort_order INTEGER DEFAULT 0
  );

  -- Подкатегории
  CREATE TABLE IF NOT EXISTS subcategories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    icon TEXT DEFAULT '📎',
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );

  -- Навыки (привязаны к подкатегории)
  CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subcategory_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (subcategory_id) REFERENCES subcategories(id)
  );

  CREATE TABLE IF NOT EXISTS user_skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    skill_id INTEGER NOT NULL,
    active_years REAL DEFAULT 0,
    rank TEXT DEFAULT 'F',
    current_streak INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, skill_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (skill_id) REFERENCES skills(id)
  );

  CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    skill_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, skill_id, date),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (skill_id) REFERENCES skills(id)
  );

  CREATE TABLE IF NOT EXISTS endorsements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    skill_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_user_id, to_user_id, skill_id),
    FOREIGN KEY (from_user_id) REFERENCES users(id),
    FOREIGN KEY (to_user_id) REFERENCES users(id),
    FOREIGN KEY (skill_id) REFERENCES skills(id)
  );

  CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '🏆',
    rarity TEXT DEFAULT 'common',
    category TEXT DEFAULT 'general'
  );

  CREATE TABLE IF NOT EXISTS user_achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    achievement_id INTEGER NOT NULL,
    skill_id INTEGER,
    earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, achievement_id, skill_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (achievement_id) REFERENCES achievements(id)
  );

  CREATE TABLE IF NOT EXISTS follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_id INTEGER NOT NULL,
    following_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(follower_id, following_id),
    FOREIGN KEY (follower_id) REFERENCES users(id),
    FOREIGN KEY (following_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS feed_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    event_data TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS feed_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    reaction TEXT NOT NULL DEFAULT '👏',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_id, user_id),
    FOREIGN KEY (event_id) REFERENCES feed_events(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_reactions_event ON feed_reactions(event_id);

  -- Индексы
  CREATE INDEX IF NOT EXISTS idx_skills_subcat ON skills(subcategory_id);
  CREATE INDEX IF NOT EXISTS idx_subcat_cat ON subcategories(category_id);
  CREATE INDEX IF NOT EXISTS idx_user_skills_user ON user_skills(user_id);
  CREATE INDEX IF NOT EXISTS idx_user_skills_skill ON user_skills(skill_id);
  CREATE INDEX IF NOT EXISTS idx_checkins_user_skill ON checkins(user_id, skill_id);
  CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(date);
  CREATE INDEX IF NOT EXISTS idx_endorsements_to ON endorsements(to_user_id, skill_id);
  CREATE INDEX IF NOT EXISTS idx_endorsements_from ON endorsements(from_user_id);
  CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
  CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
  CREATE INDEX IF NOT EXISTS idx_feed_user ON feed_events(user_id);
  CREATE INDEX IF NOT EXISTS idx_feed_created ON feed_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);
`);

// Мета-приложения (одноразовые миграции)
db.exec(`
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Бейджи пользователей (многие-ко-многим, без дублей по паре user + badge)
db.exec(`
  CREATE TABLE IF NOT EXISTS user_badges (
    user_id INTEGER NOT NULL,
    badge_key TEXT NOT NULL,
    granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    granted_by TEXT DEFAULT 'system',
    visible INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, badge_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);
`);

// ============================================
// СООБЩЕНИЯ (личная переписка)
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dialog_key TEXT NOT NULL,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_dialog
    ON messages(dialog_key, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_to_unread
    ON messages(to_user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_messages_from
    ON messages(from_user_id);
`);


// ============================================
// КАТАЛОГ: Категории → Подкатегории → Навыки
// ============================================

const categoriesCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;

if (categoriesCount === 0) {
  console.log('📝 Заполняем каталог навыков...');

  const insCategory = db.prepare(
    'INSERT INTO categories (name, slug, icon, sort_order) VALUES (?, ?, ?, ?)'
  );
  const insSubcategory = db.prepare(
    'INSERT INTO subcategories (category_id, name, slug, icon, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  const insSkill = db.prepare(
    'INSERT INTO skills (subcategory_id, name, slug, description) VALUES (?, ?, ?, ?)'
  );

  const catalog = [
    // ==========================================
    // 💻 ПРОГРАММИРОВАНИЕ
    // ==========================================
    {
      name: 'Программирование', slug: 'programming', icon: '💻', order: 1,
      subs: [
        {
          name: 'Веб-фронтенд', slug: 'web-frontend', icon: '🌐', order: 1,
          skills: [
            ['JavaScript', 'javascript', 'Основной язык веба'],
            ['TypeScript', 'typescript', 'Типизированный JS'],
            ['React', 'react', 'Библиотека UI от Meta'],
            ['Vue.js', 'vuejs', 'Прогрессивный фреймворк'],
            ['Angular', 'angular', 'Фреймворк от Google'],
            ['Svelte', 'svelte', 'Компилируемый фреймворк'],
            ['Next.js', 'nextjs', 'React-фреймворк с SSR'],
            ['HTML/CSS', 'html-css', 'Разметка и стили'],
            ['Tailwind CSS', 'tailwind', 'Утилитарный CSS-фреймворк'],
            ['SASS/SCSS', 'sass', 'CSS-препроцессор'],
            ['WebGL/Three.js', 'webgl', '3D-графика в браузере'],
          ]
        },
        {
          name: 'Веб-бэкенд', slug: 'web-backend', icon: '⚙️', order: 2,
          skills: [
            ['Node.js', 'nodejs', 'JavaScript на сервере'],
            ['Python (Django)', 'django', 'Python веб-фреймворк'],
            ['Python (FastAPI)', 'fastapi', 'Быстрый Python API'],
            ['PHP', 'php', 'Классический веб-язык'],
            ['Laravel', 'laravel', 'PHP-фреймворк'],
            ['Ruby on Rails', 'rails', 'Ruby веб-фреймворк'],
            ['Go', 'golang', 'Быстрый язык от Google'],
            ['Rust (Actix)', 'rust-web', 'Rust для веба'],
            ['Java (Spring)', 'spring', 'Enterprise Java'],
            ['C# (ASP.NET)', 'aspnet', '.NET веб-фреймворк'],
            ['GraphQL', 'graphql', 'Язык запросов API'],
            ['REST API', 'rest-api', 'Проектирование API'],
          ]
        },
        {
          name: 'Мобильная разработка', slug: 'mobile-dev', icon: '📱', order: 3,
          skills: [
            ['Swift', 'swift', 'iOS/macOS разработка'],
            ['Kotlin', 'kotlin', 'Android разработка'],
            ['Flutter', 'flutter', 'Кроссплатформа от Google'],
            ['React Native', 'react-native', 'Мобильный React'],
            ['SwiftUI', 'swiftui', 'Декларативный UI для Apple'],
            ['Jetpack Compose', 'jetpack-compose', 'Современный Android UI'],
          ]
        },
        {
          name: 'Системное программирование', slug: 'systems', icon: '🔧', order: 4,
          skills: [
            ['C', 'c-lang', 'Основа всех языков'],
            ['C++', 'cpp', 'Игры, системы, производительность'],
            ['Rust', 'rust', 'Безопасное системное программирование'],
            ['Assembly', 'assembly', 'Низкоуровневое программирование'],
            ['Linux/Unix', 'linux', 'Системное администрирование'],
            ['Embedded', 'embedded', 'Встраиваемые системы'],
          ]
        },
        {
          name: 'Data & AI', slug: 'data-ai', icon: '🤖', order: 5,
          skills: [
            ['Python', 'python', 'Универсальный язык'],
            ['Machine Learning', 'ml', 'Классическое ML'],
            ['Deep Learning', 'deep-learning', 'Нейронные сети'],
            ['PyTorch', 'pytorch', 'Фреймворк глубокого обучения'],
            ['TensorFlow', 'tensorflow', 'ML-фреймворк от Google'],
            ['Data Science', 'data-science', 'Анализ данных'],
            ['Computer Vision', 'cv', 'Компьютерное зрение'],
            ['NLP', 'nlp', 'Обработка языка'],
            ['R', 'r-lang', 'Статистика и анализ'],
            ['SQL', 'sql', 'Язык запросов к базам данных'],
            ['Pandas', 'pandas', 'Анализ данных в Python'],
          ]
        },
        {
          name: 'DevOps & инфраструктура', slug: 'devops', icon: '🏗️', order: 6,
          skills: [
            ['Docker', 'docker', 'Контейнеризация'],
            ['Kubernetes', 'kubernetes', 'Оркестрация контейнеров'],
            ['CI/CD', 'cicd', 'Непрерывная интеграция'],
            ['AWS', 'aws', 'Облако Amazon'],
            ['Git', 'git', 'Контроль версий'],
            ['Terraform', 'terraform', 'Инфраструктура как код'],
            ['Nginx', 'nginx', 'Веб-сервер и прокси'],
            ['PostgreSQL', 'postgresql', 'Реляционная БД'],
            ['MongoDB', 'mongodb', 'NoSQL база данных'],
            ['Redis', 'redis', 'Кэш и брокер сообщений'],
          ]
        },
        {
          name: 'Безопасность', slug: 'security', icon: '🔒', order: 7,
          skills: [
            ['Кибербезопасность', 'cybersecurity', 'Защита систем'],
            ['Пентест', 'pentesting', 'Тестирование на проникновение'],
            ['Криптография', 'cryptography', 'Шифрование данных'],
            ['Reverse Engineering', 'reverse-eng', 'Обратная инженерия'],
            ['Форензика', 'forensics', 'Цифровая криминалистика'],
          ]
        },
        {
          name: 'Блокчейн & Web3', slug: 'blockchain', icon: '⛓️', order: 8,
          skills: [
            ['Solidity', 'solidity', 'Смарт-контракты Ethereum'],
            ['Web3.js', 'web3js', 'Взаимодействие с блокчейном'],
            ['DeFi', 'defi', 'Децентрализованные финансы'],
            ['NFT разработка', 'nft-dev', 'Создание NFT'],
          ]
        },
        {
          name: 'Игровая разработка', slug: 'gamedev', icon: '🎮', order: 9,
          skills: [
            ['Unity', 'unity', 'Игровой движок C#'],
            ['Unreal Engine', 'unreal', 'AAA-игры, C++'],
            ['Godot', 'godot', 'Открытый игровой движок'],
            ['Lua (скрипты)', 'lua', 'Roblox, моддинг'],
            ['Игровой дизайн', 'game-design-dev', 'Механики, левел-дизайн'],
            ['Шейдеры', 'shaders', 'GLSL, HLSL визуальные эффекты'],
          ]
        },
      ]
    },

    // ==========================================
    // 🎨 ДИЗАЙН
    // ==========================================
    {
      name: 'Дизайн', slug: 'design', icon: '🎨', order: 2,
      subs: [
        {
          name: 'UI/UX', slug: 'ui-ux', icon: '📐', order: 1,
          skills: [
            ['UI-дизайн', 'ui-design', 'Визуальные интерфейсы'],
            ['UX-дизайн', 'ux-design', 'Пользовательский опыт'],
            ['UX-исследования', 'ux-research', 'Интервью, тесты'],
            ['Прототипирование', 'prototyping', 'Интерактивные прототипы'],
            ['Дизайн-системы', 'design-systems', 'Компонентные библиотеки'],
            ['Figma', 'figma', 'Главный инструмент UI'],
            ['Sketch', 'sketch', 'Инструмент для macOS'],
          ]
        },
        {
          name: 'Графика', slug: 'graphic-design', icon: '🖼️', order: 2,
          skills: [
            ['Графический дизайн', 'graphic-design-skill', 'Логотипы, полиграфия'],
            ['Photoshop', 'photoshop', 'Растровая графика'],
            ['Illustrator', 'illustrator', 'Векторная графика'],
            ['Типографика', 'typography', 'Шрифты и вёрстка'],
            ['Брендинг', 'branding', 'Айдентика, логотипы'],
            ['Инфографика', 'infographic', 'Визуализация данных'],
          ]
        },
        {
          name: '3D и анимация', slug: '3d-animation', icon: '🎬', order: 3,
          skills: [
            ['3D-моделирование', '3d-modeling', 'Blender, Maya'],
            ['3D-анимация', '3d-animation-skill', 'Ригинг, анимирование'],
            ['ZBrush', 'zbrush', 'Цифровая скульптура'],
            ['Motion-дизайн', 'motion-design', 'After Effects'],
            ['2D-анимация', '2d-animation', 'Покадровая, spine'],
            ['Рендеринг', 'rendering', 'V-Ray, Octane, Cycles'],
          ]
        },
        {
          name: 'Иллюстрация', slug: 'illustration', icon: '✏️', order: 4,
          skills: [
            ['Цифровая иллюстрация', 'digital-illustration', 'Procreate, Photoshop'],
            ['Концепт-арт', 'concept-art', 'Концепты для игр/кино'],
            ['Комиксы/манга', 'comics-manga', 'Рисование историй'],
            ['Пиксель-арт', 'pixel-art', 'Ретро-графика'],
            ['Акварель', 'watercolor', 'Традиционная техника'],
            ['Карандашный рисунок', 'pencil-drawing', 'Скетчи, портреты'],
            ['Каллиграфия', 'calligraphy', 'Красивое письмо'],
          ]
        },
        {
          name: 'Веб-дизайн', slug: 'web-design', icon: '🌐', order: 5,
          skills: [
            ['Лендинги', 'landing-design', 'Одностраничные сайты'],
            ['Дизайн интернет-магазинов', 'ecommerce-design', 'UI магазинов'],
            ['Email-дизайн', 'email-design', 'Рассылки, шаблоны'],
            ['Дизайн мобильных приложений', 'mobile-app-design', 'UI приложений'],
          ]
        },
      ]
    },

    // ==========================================
    // 🎵 МУЗЫКА
    // ==========================================
    {
      name: 'Музыка', slug: 'music', icon: '🎵', order: 3,
      subs: [
        {
          name: 'Струнные', slug: 'strings', icon: '🎸', order: 1,
          skills: [
            ['Акустическая гитара', 'acoustic-guitar', 'Фингерстайл, аккорды'],
            ['Электрогитара', 'electric-guitar', 'Рок, блюз, соло'],
            ['Бас-гитара', 'bass-guitar', 'Ритм-секция'],
            ['Укулеле', 'ukulele', 'Маленькая гитара'],
            ['Скрипка', 'violin', 'Классика, фолк'],
            ['Виолончель', 'cello', 'Оркестр, соло'],
            ['Банджо', 'banjo', 'Кантри, блюграсс'],
            ['Балалайка', 'balalaika', 'Русский народный'],
          ]
        },
        {
          name: 'Клавишные', slug: 'keys', icon: '🎹', order: 2,
          skills: [
            ['Фортепиано', 'piano', 'Классика, джаз'],
            ['Синтезатор', 'synthesizer', 'Электронные клавишные'],
            ['Орган', 'organ', 'Классический, церковный'],
            ['Аккордеон', 'accordion', 'Народная музыка'],
          ]
        },
        {
          name: 'Ударные', slug: 'percussion', icon: '🥁', order: 3,
          skills: [
            ['Барабаны', 'drums', 'Ударная установка'],
            ['Перкуссия', 'percussion-skill', 'Конги, бонги, кахон'],
            ['Электронные ударные', 'electronic-drums', 'Драм-пэды'],
          ]
        },
        {
          name: 'Духовые', slug: 'wind', icon: '🎷', order: 4,
          skills: [
            ['Саксофон', 'saxophone', 'Джаз, блюз, поп'],
            ['Флейта', 'flute', 'Классическая, народная'],
            ['Труба', 'trumpet', 'Джаз, оркестр'],
            ['Кларнет', 'clarinet', 'Джаз, классика'],
            ['Губная гармоника', 'harmonica', 'Блюз, фолк'],
          ]
        },
        {
          name: 'Вокал', slug: 'vocal', icon: '🎤', order: 5,
          skills: [
            ['Вокал (чистый)', 'clean-vocals', 'Поп, рок, классика'],
            ['Рэп', 'rap', 'Читка, фристайл'],
            ['Битбокс', 'beatbox', 'Вокальная перкуссия'],
            ['Оперный вокал', 'opera', 'Академическое пение'],
            ['Горловое пение', 'throat-singing', 'Хоомей, каргыраа'],
          ]
        },
        {
          name: 'Продакшн', slug: 'music-production', icon: '🎛️', order: 6,
          skills: [
            ['Битмейкинг', 'beatmaking', 'Создание битов'],
            ['Микширование', 'mixing', 'Сведение треков'],
            ['Мастеринг', 'mastering', 'Финальная обработка'],
            ['Звукорежиссура', 'sound-engineering', 'Запись, обработка'],
            ['Ableton Live', 'ableton', 'DAW для продакшна'],
            ['FL Studio', 'fl-studio', 'DAW для битмейкинга'],
            ['Logic Pro', 'logic-pro', 'DAW для macOS'],
            ['DJ-инг', 'djing', 'Сведение, миксы'],
            ['Саунд-дизайн', 'sound-design', 'Создание звуков'],
          ]
        },
        {
          name: 'Теория', slug: 'music-theory', icon: '📝', order: 7,
          skills: [
            ['Музыкальная теория', 'music-theory-skill', 'Гармония, ритм'],
            ['Сольфеджио', 'solfege', 'Слух, интонирование'],
            ['Композиция', 'composition', 'Написание музыки'],
            ['Аранжировка', 'arrangement', 'Обработка, оркестровка'],
          ]
        },
      ]
    },

    // ==========================================
    // 🌍 ЯЗЫКИ
    // ==========================================
    {
      name: 'Языки', slug: 'languages', icon: '🌍', order: 4,
      subs: [
        {
          name: 'Европейские', slug: 'european-langs', icon: '🇪🇺', order: 1,
          skills: [
            ['Английский', 'english', 'Международный'],
            ['Испанский', 'spanish', '500M+ носителей'],
            ['Французский', 'french', 'Дипломатия, культура'],
            ['Немецкий', 'german', 'Наука, инженерия'],
            ['Итальянский', 'italian', 'Культура, кухня'],
            ['Португальский', 'portuguese', 'Бразилия, Португалия'],
            ['Нидерландский', 'dutch', 'Нидерланды, Бельгия'],
            ['Польский', 'polish', 'Центральная Европа'],
            ['Шведский', 'swedish', 'Скандинавия'],
            ['Чешский', 'czech', 'Центральная Европа'],
            ['Греческий', 'greek', 'Древняя культура'],
          ]
        },
        {
          name: 'Азиатские', slug: 'asian-langs', icon: '🏯', order: 2,
          skills: [
            ['Китайский (мандарин)', 'chinese', '1B+ носителей'],
            ['Японский', 'japanese', 'Аниме, бизнес'],
            ['Корейский', 'korean', 'K-pop, дорамы'],
            ['Хинди', 'hindi', 'Индия, 600M+'],
            ['Вьетнамский', 'vietnamese', 'Юго-Восточная Азия'],
            ['Тайский', 'thai', 'Таиланд'],
            ['Индонезийский', 'indonesian', '270M+ жителей'],
          ]
        },
        {
          name: 'Ближневосточные', slug: 'middle-east-langs', icon: '🕌', order: 3,
          skills: [
            ['Арабский', 'arabic', '400M+ носителей'],
            ['Турецкий', 'turkish', '80M+ носителей'],
            ['Фарси (персидский)', 'farsi', 'Иран, Таджикистан'],
            ['Иврит', 'hebrew', 'Израиль'],
          ]
        },
        {
          name: 'Славянские', slug: 'slavic-langs', icon: '🇷🇺', order: 4,
          skills: [
            ['Украинский', 'ukrainian', 'Украина'],
            ['Белорусский', 'belarusian', 'Беларусь'],
            ['Сербский', 'serbian', 'Балканы'],
            ['Болгарский', 'bulgarian', 'Болгария'],
          ]
        },
        {
          name: 'Другие', slug: 'other-langs', icon: '🗺️', order: 5,
          skills: [
            ['Латынь', 'latin', 'Мёртвый язык, основа'],
            ['Эсперанто', 'esperanto', 'Искусственный язык'],
            ['Язык жестов', 'sign-language', 'Жестовая коммуникация'],
          ]
        },
      ]
    },

    // ==========================================
    // 🍳 КУЛИНАРИЯ
    // ==========================================
    {
      name: 'Кулинария', slug: 'cooking', icon: '🍳', order: 5,
      subs: [
        {
          name: 'Кондитерское дело', slug: 'pastry', icon: '🍰', order: 1,
          skills: [
            ['Торты', 'cakes', 'Бисквиты, муссовые, свадебные'],
            ['Пирожные', 'pastries', 'Эклеры, тарты, профитроли'],
            ['Конфеты и трюфели', 'chocolates', 'Ручные конфеты'],
            ['Шоколатье', 'chocolatier', 'Работа с шоколадом'],
            ['Макаронс', 'macarons', 'Французские сладости'],
            ['Мороженое', 'ice-cream', 'Джелато, сорбеты'],
            ['Украшение тортов', 'cake-decoration', 'Мастика, крем, цветы'],
            ['Карамель', 'caramel', 'Карамельные техники'],
          ]
        },
        {
          name: 'Выпечка', slug: 'baking', icon: '🍞', order: 2,
          skills: [
            ['Хлеб', 'bread', 'Дрожжевой, закваска, чиабатта'],
            ['Пироги', 'pies', 'Сладкие и солёные'],
            ['Булочки', 'buns', 'Синнабоны, бриоши'],
            ['Печенье', 'cookies', 'Овсяное, шоколадное, имбирное'],
            ['Круассаны', 'croissants', 'Слоёное тесто'],
            ['Пицца', 'pizza-baking', 'Тесто, начинки, выпекание'],
            ['Блины', 'pancakes', 'Тонкие, американские, оладьи'],
            ['Хачапури', 'khachapuri', 'Грузинская выпечка'],
          ]
        },
        {
          name: 'Национальные кухни', slug: 'national-cuisine', icon: '🍜', order: 3,
          skills: [
            ['Итальянская', 'italian-cuisine', 'Паста, ризотто, антипасти'],
            ['Японская', 'japanese-cuisine', 'Суши, рамен, темпура'],
            ['Французская', 'french-cuisine', 'Соусы, техники, haute cuisine'],
            ['Китайская', 'chinese-cuisine', 'Вок, дим-самы, Сычуань'],
            ['Индийская', 'indian-cuisine', 'Карри, тандури, специи'],
            ['Мексиканская', 'mexican-cuisine', 'Тако, буррито, сальса'],
            ['Грузинская', 'georgian-cuisine', 'Хинкали, сациви, харчо'],
            ['Тайская', 'thai-cuisine', 'Пад тай, том ям, карри'],
            ['Корейская', 'korean-cuisine', 'Кимчи, пибимпап, BBQ'],
            ['Узбекская', 'uzbek-cuisine', 'Плов, лагман, самса'],
            ['Турецкая', 'turkish-cuisine', 'Кебаб, баклава, мезе'],
          ]
        },
        {
          name: 'Техники и методы', slug: 'cooking-techniques', icon: '🔪', order: 4,
          skills: [
            ['Гриль и BBQ', 'grilling', 'Мясо, овощи, копчение'],
            ['Sous vide', 'sous-vide', 'Готовка при низкой температуре'],
            ['Ферментация', 'fermentation', 'Квашение, комбуча'],
            ['Копчение', 'smoking', 'Горячее и холодное'],
            ['Работа с ножом', 'knife-skills', 'Нарезка, шинковка'],
            ['Консервация', 'preserving', 'Заготовки, маринады'],
          ]
        },
        {
          name: 'Напитки', slug: 'beverages', icon: '☕', order: 5,
          skills: [
            ['Кофе (бариста)', 'barista', 'Эспрессо, латте-арт'],
            ['Чай', 'tea', 'Заваривание, церемонии'],
            ['Коктейли', 'cocktails', 'Миксология, классика'],
            ['Вино', 'wine', 'Сомелье, дегустация'],
            ['Домашнее пиво', 'homebrewing', 'Варка крафтового пива'],
            ['Смузи и соки', 'smoothies', 'Здоровые напитки'],
          ]
        },
        {
          name: 'Специализации', slug: 'cooking-special', icon: '🥗', order: 6,
          skills: [
            ['Вегетарианская кухня', 'vegetarian', 'Без мяса'],
            ['Веганская кухня', 'vegan', 'Без продуктов животных'],
            ['Безглютеновая', 'gluten-free', 'Без пшеницы'],
            ['Спортивное питание', 'sports-nutrition', 'Для атлетов'],
            ['Молекулярная кухня', 'molecular', 'Наука + кулинария'],
          ]
        },
      ]
    },

    // ==========================================
    // ⚽ СПОРТ
    // ==========================================
    {
      name: 'Спорт', slug: 'sports', icon: '⚽', order: 6,
      subs: [
        {
          name: 'Кардио', slug: 'cardio', icon: '🏃', order: 1,
          skills: [
            ['Бег', 'running', 'Спринт, марафон, трейл'],
            ['Плавание', 'swimming', 'Вольный, брасс, баттерфляй'],
            ['Велоспорт', 'cycling', 'Шоссе, MTB, трек'],
            ['Триатлон', 'triathlon', 'Бег + плав + вело'],
            ['Лыжи', 'skiing', 'Беговые, горные'],
            ['Гребля', 'rowing', 'Академическая, каяк'],
          ]
        },
        {
          name: 'Силовые', slug: 'strength', icon: '💪', order: 2,
          skills: [
            ['Тренажёрный зал', 'gym', 'Железо, тренажёры'],
            ['Пауэрлифтинг', 'powerlifting', 'Присед, жим, тяга'],
          ]
        },
      ]
    },

    // ==========================================
    // 📸 МЕДИА
    // ==========================================
    {
      name: 'Медиа', slug: 'media', icon: '📸', order: 7,
      subs: [
        {
          name: 'Фотография', slug: 'photography', icon: '📷', order: 1,
          skills: [
            ['Портретная съёмка', 'portrait-photo', 'Студия, свет'],
            ['Пейзажная съёмка', 'landscape-photo', 'Природа, город'],
            ['Стрит-фотография', 'street-photo', 'Уличная съёмка'],
            ['Предметная съёмка', 'product-photo', 'Товары, еда'],
            ['Свадебная съёмка', 'wedding-photo', 'Репортаж, постановка'],
            ['Макросъёмка', 'macro-photo', 'Детали, насекомые'],
            ['Астрофотография', 'astrophotography', 'Звёзды, Млечный путь'],
            ['Мобильная фотография', 'mobile-photo', 'iPhone, Android'],
          ]
        },
        {
          name: 'Обработка фото', slug: 'photo-editing', icon: '🖌️', order: 2,
          skills: [
            ['Lightroom', 'lightroom', 'Обработка RAW'],
            ['Ретушь', 'retouching', 'Кожа, детали'],
            ['Цветокоррекция фото', 'color-correction-photo', 'Стиль, тонирование'],
          ]
        },
        {
          name: 'Видеопроизводство', slug: 'video-production', icon: '🎬', order: 3,
          skills: [
            ['Видеосъёмка', 'videography', 'Камера, кадрирование'],
            ['Видеомонтаж', 'video-editing', 'Premiere, DaVinci'],
            ['Цветокоррекция видео', 'color-grading', 'DaVinci Resolve'],
            ['Аэросъёмка', 'drone-filming', 'Дроны, FPV'],
            ['Документальное кино', 'documentary', 'Документалистика'],
            ['Короткометражки', 'short-films', 'Художественное кино'],
          ]
        },
        {
          name: 'Контент', slug: 'content-creation', icon: '📱', order: 4,
          skills: [
            ['YouTube', 'youtube', 'Видеоблог, контент'],
            ['TikTok / Reels', 'short-video', 'Короткие ролики'],
            ['Стриминг', 'streaming', 'Twitch, YouTube Live'],
            ['Подкастинг', 'podcasting', 'Аудиоконтент'],
            ['Блогинг', 'blogging', 'Текстовый контент'],
          ]
        },
      ]
    },

    // ==========================================
    // 🌿 LIFESTYLE
    // ==========================================
    {
      name: 'Lifestyle', slug: 'lifestyle', icon: '🌿', order: 11,
      subs: [
        {
          name: 'Садоводство', slug: 'gardening', icon: '🌱', order: 1,
          skills: [
            ['Огород', 'vegetable-garden', 'Овощи, зелень'],
            ['Цветоводство', 'floriculture', 'Цветы, клумбы'],
            ['Комнатные растения', 'houseplants', 'Уход, пересадка'],
            ['Ландшафтный дизайн', 'landscape-design', 'Участок, сад'],
            ['Гидропоника', 'hydroponics', 'Без почвы'],
          ]
        },
        {
          name: 'Автомобили', slug: 'automotive', icon: '🚗', order: 2,
          skills: [
            ['Вождение', 'driving', 'Легковой, внедорожник'],
            ['Мотоцикл', 'motorcycle', 'Управление мотоциклом'],
            ['Автомеханика', 'car-mechanics', 'Ремонт, обслуживание'],
            ['Детейлинг', 'detailing', 'Полировка, защита'],
            ['Дрифт', 'drifting', 'Управляемый занос'],
          ]
        },
        {
          name: 'Домоводство', slug: 'home', icon: '🏠', order: 3,
          skills: [
            ['Ремонт квартиры', 'home-repair', 'Стены, полы, потолки'],
            ['Электрика', 'home-electrical', 'Проводка, розетки'],
            ['Сантехника', 'plumbing', 'Трубы, краны'],
            ['Интерьерный дизайн', 'interior-design', 'Обстановка, стиль'],
            ['Организация пространства', 'organizing', 'Порядок, хранение'],
          ]
        },
        {
          name: 'Здоровье', slug: 'health', icon: '🧘', order: 4,
          skills: [
            ['Медитация', 'meditation', 'Осознанность, дыхание'],
            ['Нутрициология', 'nutrition', 'Питание, диеты'],
            ['Массаж', 'massage', 'Спортивный, расслабляющий'],
            ['Первая помощь', 'first-aid', 'Экстренная помощь'],
          ]
        },
        {
          name: 'Животные', slug: 'animals', icon: '🐾', order: 5,
          skills: [
            ['Дрессировка собак', 'dog-training', 'Команды, поведение'],
            ['Аквариумистика', 'aquaristics', 'Рыбки, акваскейп'],
            ['Верховая езда', 'horse-riding', 'Конный спорт'],
            ['Кинология', 'cynology', 'Породы, разведение'],
          ]
        },
      ]
    },

    // ==========================================
    // 🎲 ХОББИ
    // ==========================================
    {
      name: 'Хобби', slug: 'hobbies', icon: '🎲', order: 12,
      subs: [
        {
          name: 'Настольные игры', slug: 'board-games', icon: '🎲', order: 1,
          skills: [
            ['Настольные игры', 'board-games-skill', 'Стратегии, пати-геймы'],
            ['Настольные ролевые', 'tabletop-rpg', 'D&D, Pathfinder'],
            ['Варгеймы', 'wargames', 'Warhammer, миниатюры'],
            ['Покраска миниатюр', 'miniature-painting', 'Хобби-миниатюры'],
          ]
        },
        {
          name: 'Коллекционирование', slug: 'collecting', icon: '🏛️', order: 2,
          skills: [
            ['Нумизматика', 'numismatics', 'Монеты, медали'],
            ['Филателия', 'philately', 'Марки'],
            ['Коллекция фигурок', 'figure-collecting', 'Аниме, комиксы'],
            ['Коллекция винила', 'vinyl-collecting', 'Пластинки, музыка'],
          ]
        },
        {
          name: 'Писательство', slug: 'writing', icon: '✍️', order: 3,
          skills: [
            ['Художественная проза', 'fiction-writing', 'Рассказы, романы'],
            ['Поэзия', 'poetry', 'Стихи, лирика'],
            ['Сценарное дело', 'screenwriting', 'Сценарии фильмов'],
            ['Фанфикшн', 'fanfiction', 'Фанатские истории'],
            ['Нон-фикшн', 'nonfiction', 'Эссе, статьи, книги'],
            ['Мемуары', 'memoir-writing', 'Личные истории'],
          ]
        },
        {
          name: 'Моделизм', slug: 'modeling', icon: '✈️', order: 4,
          skills: [
            ['Авиамоделизм', 'aircraft-modeling', 'Самолёты, дроны'],
            ['Судомоделизм', 'ship-modeling', 'Корабли, лодки'],
            ['Стендовый моделизм', 'scale-modeling', 'Танки, машины'],
            ['Железнодорожный', 'model-trains', 'Макеты железных дорог'],
            ['RC-модели', 'rc-models', 'Радиоуправляемые модели'],
          ]
        },
        {
          name: 'Активный отдых', slug: 'outdoor', icon: '🏕️', order: 5,
          skills: [
            ['Походы', 'hiking', 'Трекинг, горы'],
            ['Кемпинг', 'camping', 'Палатки, выживание'],
            ['Рыбалка', 'fishing', 'Спиннинг, нахлыст, фидер'],
            ['Охота', 'hunting', 'Оружие, выслеживание'],
            ['Ориентирование', 'orienteering', 'Карта, компас, GPS'],
            ['Выживание', 'survival', 'Навыки в дикой природе'],
            ['Альпинизм', 'mountaineering', 'Горы, экспедиции'],
          ]
        },
        {
          name: 'Магия и фокусы', slug: 'magic', icon: '🎩', order: 6,
          skills: [
            ['Карточные фокусы', 'card-magic', 'Манипуляции с картами'],
            ['Иллюзионизм', 'illusionism', 'Сценическая магия'],
            ['Жонглирование', 'juggling', 'Мячи, кольца, булавы'],
            ['Кардистри', 'cardistry', 'Вращение карт'],
          ]
        },
      ]
    },

    // ==========================================
    // 🎭 СЦЕНА И МЕДИА
    // ==========================================
    {
      name: 'Сцена и медиа', slug: 'performing', icon: '🎭', order: 13,
      subs: [
        {
          name: 'Актёрское мастерство', slug: 'acting', icon: '🎬', order: 1,
          skills: [
            ['Драматическое искусство', 'drama', 'Театр, кино'],
            ['Комедийное мастерство', 'comedy', 'Стендап, импровизация'],
            ['Озвучивание', 'voice-acting', 'Дубляж, аудиокниги'],
            ['Стендап', 'standup', 'Сольные юмористические выступления'],
            ['Импровизация', 'improvisation', 'Театральная импровизация'],
          ]
        },
        {
          name: 'Режиссура', slug: 'directing', icon: '🎥', order: 2,
          skills: [
            ['Кинорежиссура', 'film-directing', 'Управление съёмками'],
            ['Театральная режиссура', 'theater-directing', 'Постановки'],
            ['Монтаж кино', 'film-editing', 'Нарратив, ритм'],
          ]
        },
        {
          name: 'Звук для медиа', slug: 'media-sound', icon: '🔊', order: 3,
          skills: [
            ['Саунд-дизайн для кино', 'film-sound-design', 'SFX, атмосфера'],
            ['Фоли', 'foley', 'Имитация звуков'],
            ['Аудиокниги', 'audiobook-narration', 'Чтение и запись'],
          ]
        },
      ]
    },

    // ==========================================
    // 📚 ОБРАЗОВАНИЕ
    // ==========================================
    {
      name: 'Образование', slug: 'education', icon: '📚', order: 14,
      subs: [
        {
          name: 'Преподавание', slug: 'teaching', icon: '👨‍🏫', order: 1,
          skills: [
            ['Преподавание', 'teaching-skill', 'Обучение других'],
            ['Репетиторство', 'tutoring', 'Индивидуальные занятия'],
            ['Менторство', 'mentoring', 'Наставничество'],
            ['Создание курсов', 'course-creation', 'Онлайн-обучение'],
          ]
        },
        {
          name: 'Саморазвитие', slug: 'self-development', icon: '🧠', order: 2,
          skills: [
            ['Скорочтение', 'speed-reading', 'Быстрое чтение'],
            ['Мнемотехника', 'mnemonics', 'Техники запоминания'],
            ['Тайм-менеджмент', 'time-management', 'Управление временем'],
            ['Критическое мышление', 'critical-thinking', 'Анализ, логика'],
            ['Публичные дебаты', 'debating', 'Аргументация, риторика'],
          ]
        },
      ]
    }
  ];

  // ---- Заполняем каталог в транзакции ----
  let totalSkills = 0;
  let totalSubs = 0;

  const fillCatalog = db.transaction(() => {
    for (const cat of catalog) {
      const catResult = insCategory.run(cat.name, cat.slug, cat.icon, cat.order);
      const categoryId = catResult.lastInsertRowid;

      for (const sub of cat.subs) {
        const subResult = insSubcategory.run(
          categoryId, sub.name, sub.slug, sub.icon, sub.order
        );
        const subcategoryId = subResult.lastInsertRowid;
        totalSubs++;

        for (const [name, slug, description] of sub.skills) {
          insSkill.run(subcategoryId, name, slug, description);
          totalSkills++;
        }
      }
    }
  });

  fillCatalog();
  console.log(`   ✅ ${catalog.length} категорий, ${totalSubs} подкатегорий, ${totalSkills} навыков`);
}


// ============================================
// ДОСТИЖЕНИЯ (декоративные, без XP)
// ============================================

const achievementsCount = db.prepare('SELECT COUNT(*) as c FROM achievements').get().c;

if (achievementsCount === 0) {
  console.log('🏆 Заполняем достижения...');

  const insAchievement = db.prepare(
    'INSERT INTO achievements (code, name, description, icon, rarity, category) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const achievements = [
    // ========== НАВЫКИ ==========
    ['first_skill',        'Первый шаг',           'Добавь первый навык',                         '🌱', 'common',    'skills'],
    ['three_skills',       'Троица',                'Добавь 3 навыка',                             '🎯', 'common',    'skills'],
    ['five_skills',        'Мультиталант',          'Добавь 5 навыков',                            '🎯', 'common',    'skills'],
    ['ten_skills',         'Коллекционер',          'Добавь 10 навыков',                           '📚', 'uncommon',  'skills'],
    ['twenty_skills',      'Энциклопедист',         'Добавь 20 навыков',                           '🧠', 'rare',      'skills'],
    ['thirty_skills',      'Ходячая библиотека',    'Добавь 30 навыков',                           '📖', 'epic',      'skills'],
    ['fifty_skills',       'Мастер на все руки',    'Добавь 50 навыков — максимум!',               '👑', 'legendary', 'skills'],
    ['three_categories',   'Разносторонний',        'Навыки в 3 разных категориях',                '🎨', 'common',    'skills'],
    ['five_categories',    'Полимат',               'Навыки в 5 разных категориях',                '💎', 'uncommon',  'skills'],
    ['eight_categories',   'Ренессанс',             'Навыки в 8 разных категориях',                '🏛️', 'rare',      'skills'],
    ['all_categories',     'Человек-оркестр',       'Навыки в каждой категории',                   '🌈', 'legendary', 'skills'],

    // ========== СТРИКИ ==========
    ['first_checkin',      'Начало пути',           'Сделай первый чекин',                         '✅', 'common',    'streaks'],
    ['streak_3',           'Три дня подряд',        'Стрик 3 дня',                                 '🔥', 'common',    'streaks'],
    ['streak_7',           'Неделя огня',           'Стрик 7 дней',                                '🔥', 'common',    'streaks'],
    ['streak_14',          'Две недели',            'Стрик 14 дней',                               '🔥', 'uncommon',  'streaks'],
    ['streak_21',          'Три недели',            'Стрик 21 день — привычка!',                   '💪', 'uncommon',  'streaks'],
    ['streak_30',          'Месяц стабильности',    'Стрик 30 дней',                               '💪', 'uncommon',  'streaks'],
    ['streak_60',          'Два месяца!',           'Стрик 60 дней',                               '⚡', 'rare',      'streaks'],
    ['streak_90',          'Квартал!',              'Стрик 90 дней — четверть года',                '⚡', 'rare',      'streaks'],
    ['streak_100',         'Сотня!',                'Стрик 100 дней',                              '💎', 'rare',      'streaks'],
    ['streak_150',         'Полгода почти',         'Стрик 150 дней',                              '💎', 'epic',      'streaks'],
    ['streak_200',         'Несокрушимый',          'Стрик 200 дней',                              '🏔️', 'epic',      'streaks'],
    ['streak_300',         'Машина',                'Стрик 300 дней — почти год!',                 '🤖', 'epic',      'streaks'],
    ['streak_365',         'Годовой марафон',       'Стрик 365 дней!',                             '👑', 'legendary', 'streaks'],
    ['total_checkins_10',  'Десятка',               '10 чекинов всего',                            '📊', 'common',    'streaks'],
    ['total_checkins_50',  'Полтинник',             '50 чекинов всего',                            '📊', 'common',    'streaks'],
    ['total_checkins_100', 'Сотня отметок',         '100 чекинов всего',                           '📈', 'uncommon',  'streaks'],
    ['total_checkins_500', 'Пятьсот!',              '500 чекинов всего',                           '📈', 'rare',      'streaks'],
    ['total_checkins_1000','Тысячник',              '1000 чекинов всего',                          '🏆', 'epic',      'streaks'],
    ['multi_streak_3',     'Жонглёр',               'Стрик 7+ дней по 3 навыкам одновременно',     '🤹', 'uncommon',  'streaks'],
    ['multi_streak_5',     'Многозадачный',         'Стрик 7+ дней по 5 навыкам одновременно',     '🤖', 'rare',      'streaks'],
    ['multi_streak_10',    'Абсолютная дисциплина', 'Стрик 7+ дней по 10 навыкам одновременно',    '👁️', 'epic',      'streaks'],
    ['weekend_warrior',    'Воин выходных',         '4 выходных подряд с чекинами',                '⚔️', 'common',    'streaks'],
    ['perfectionist_week', 'Перфекционист',         'Все навыки отмечены 7 дней подряд',            '✨', 'rare',      'streaks'],
    ['perfectionist_month','Абсолют',               'Все навыки отмечены 30 дней подряд',           '🌟', 'epic',      'streaks'],

    // ========== РАНГИ ==========
    ['rank_e',             'Ранг E',                'Достичь ранга E в навыке',                    '⚪', 'common',    'ranks'],
    ['rank_d',             'Ранг D — Практик',      'Достичь ранга D в навыке',                    '🟢', 'common',    'ranks'],
    ['rank_c',             'Ранг C — Знаток',       'Достичь ранга C в навыке',                    '🔵', 'uncommon',  'ranks'],
    ['rank_b',             'Ранг B — Эксперт',      'Достичь ранга B в навыке',                    '🟣', 'rare',      'ranks'],
    ['rank_a',             'Ранг A — Мастер',       'Достичь ранга A в навыке',                    '🟠', 'epic',      'ranks'],
    ['rank_s',             'Ранг S — Легенда',      'Достичь ранга S в навыке',                    '🔴', 'legendary', 'ranks'],
    ['overall_e',          'Общий E',               'Общий ранг E',                                '⚪', 'common',    'ranks'],
    ['overall_d',          'Общий D',               'Общий ранг D',                                '🟢', 'common',    'ranks'],
    ['overall_c',          'Общий C',               'Общий ранг C',                                '🔵', 'uncommon',  'ranks'],
    ['overall_b',          'Общий B',               'Общий ранг B',                                '🟣', 'rare',      'ranks'],
    ['overall_a',          'Общий A',               'Общий ранг A',                                '🟠', 'epic',      'ranks'],
    ['overall_s',          'Общий S — Легенда',     'Общий ранг S. Ты легенда!',                   '👑', 'legendary', 'ranks'],
    ['multi_rank_b',       'B× три',                'Ранг B+ в 3 разных навыках',                  '💜', 'rare',      'ranks'],
    ['multi_rank_a',       'A× два',                'Ранг A+ в 2 разных навыках',                  '🧡', 'epic',      'ranks'],
    ['multi_rank_a3',      'A× три',                'Ранг A+ в 3 разных навыках',                  '🔥', 'legendary', 'ranks'],

    // ========== СОЦИАЛЬНЫЕ ==========
    ['first_endorsement',  'Первое признание',      'Получи первое подтверждение',                  '🤝', 'common',    'social'],
    ['five_endorsements',  'Одобренный',             'Получи 5 подтверждений',                      '🤝', 'common',    'social'],
    ['ten_endorsements',   'Признанный',             'Получи 10 подтверждений',                     '🤝', 'uncommon',  'social'],
    ['twenty_five_endorse','Уважаемый',              'Получи 25 подтверждений',                     '🤝', 'uncommon',  'social'],
    ['fifty_endorsements', 'Авторитет',              'Получи 50 подтверждений',                     '🤝', 'rare',      'social'],
    ['hundred_endorsements','Гуру сообщества',       'Получи 100 подтверждений',                    '🤝', 'epic',      'social'],
    ['endorser_5',         'Поддержка×5',            'Подтверди 5 навыков другим',                   '👏', 'common',    'social'],
    ['endorser_10',        'Поддержка×10',           'Подтверди 10 навыков другим',                  '👏', 'common',    'social'],
    ['endorser_25',        'Помощник',               'Подтверди 25 навыков другим',                  '👏', 'uncommon',  'social'],
    ['endorser_50',        'Менторство',             'Подтверди 50 навыков другим',                  '🎓', 'rare',      'social'],
    ['endorser_100',       'Наставник',              'Подтверди 100 навыков другим',                 '🧙', 'epic',      'social'],
    ['first_follower',     'Первый фолловер',        'Кто-то подписался на тебя',                   '👤', 'common',    'social'],
    ['ten_followers',      'Популярный',             '10 подписчиков',                              '👥', 'uncommon',  'social'],
    ['twenty_five_follow', 'Известный',              '25 подписчиков',                              '🌟', 'uncommon',  'social'],
    ['fifty_followers',    'Звезда',                 '50 подписчиков',                              '⭐', 'rare',      'social'],
    ['hundred_followers',  'Инфлюенсер',             '100 подписчиков',                             '💫', 'epic',      'social'],

    // ========== ОСОБЫЕ ==========
    ['early_bird',         'Ранняя пташка',          'Чекин до 7 утра',                             '🐦', 'common',    'special'],
    ['night_owl',          'Ночная сова',            'Чекин после полуночи',                        '🦉', 'common',    'special'],
    ['new_year',           'Новогодний',             'Чекин 1 января',                              '🎆', 'uncommon',  'special'],
    ['halloween',          'Хэллоуинский',           'Чекин 31 октября',                            '🎃', 'uncommon',  'special'],
    ['birthday_streak',    'День рождения стрика',   'Стрик ровно 365 дней',                        '🎂', 'legendary', 'special'],
    ['comeback',           'Возвращение',            'Вернись после 30+ дней без чекинов',           '🔄', 'uncommon',  'special'],
    ['speed_learner',      'Быстрый старт',          'Добавь 5 навыков в первый день',               '⚡', 'uncommon',  'special'],
    ['diverse_day',        'Разнообразный день',     'Чекин по 5+ навыкам за один день',             '🌈', 'common',    'special'],
    ['marathon_day',       'Марафон',                'Чекин по 10+ навыкам за один день',            '🏃', 'uncommon',  'special'],
  ];

  const fillAchievements = db.transaction(() => {
    for (const [code, name, desc, icon, rarity, category] of achievements) {
      insAchievement.run(code, name, desc, icon, rarity, category);
    }
  });

  fillAchievements();
  console.log(`   ✅ ${achievements.length} достижений`);
}


console.log('📦 База данных готова');

module.exports = db;