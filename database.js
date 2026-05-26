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
    card_expanded_default INTEGER NOT NULL DEFAULT 0,
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
    initial_days INTEGER NOT NULL DEFAULT 0,
    class_visible INTEGER NOT NULL DEFAULT 0,
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

function getTableColumns(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map(r => r.name);
}

function rebuildUserSkillsWithoutLegacyYears() {
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_skills_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        skill_id INTEGER NOT NULL,
        initial_days INTEGER NOT NULL DEFAULT 0,
        rank TEXT DEFAULT 'F',
        current_streak INTEGER DEFAULT 0,
        best_streak INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, skill_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (skill_id) REFERENCES skills(id)
      );
    `);

    db.exec(`
      INSERT INTO user_skills_new (
        id, user_id, skill_id, initial_days, rank, current_streak, best_streak, created_at
      )
      SELECT
        id,
        user_id,
        skill_id,
        COALESCE(initial_days, 0),
        COALESCE(rank, 'F'),
        COALESCE(current_streak, 0),
        COALESCE(best_streak, 0),
        created_at
      FROM user_skills;
    `);

    db.exec('DROP TABLE user_skills;');
    db.exec('ALTER TABLE user_skills_new RENAME TO user_skills;');
    db.exec('CREATE INDEX IF NOT EXISTS idx_user_skills_user ON user_skills(user_id);');
    db.exec('CREATE INDEX IF NOT EXISTS idx_user_skills_skill ON user_skills(skill_id);');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Миграция legacy-полей стажа -> initial_days
{
  const userCols = getTableColumns('users');
  if (!userCols.includes('card_expanded_default')) {
    db.exec('ALTER TABLE users ADD COLUMN card_expanded_default INTEGER NOT NULL DEFAULT 0;');
  }

  const cols = getTableColumns('user_skills');
  const hasInitialDays = cols.includes('initial_days');
  if (!hasInitialDays) {
    db.exec('ALTER TABLE user_skills ADD COLUMN initial_days INTEGER NOT NULL DEFAULT 0;');
    if (cols.includes('active_years')) {
      // Сохраняем старый смысл как приближённый старт по дням
      db.exec('UPDATE user_skills SET initial_days = CAST(ROUND(COALESCE(active_years, 0) * 365.0) AS INTEGER);');
    }
  }

  const colsAfter = getTableColumns('user_skills');
  if (colsAfter.includes('active_years') || colsAfter.includes('years_known') || colsAfter.includes('years_practiced')) {
    rebuildUserSkillsWithoutLegacyYears();
  }

  const finalCols = getTableColumns('user_skills');
  if (!finalCols.includes('class_visible')) {
    db.exec('ALTER TABLE user_skills ADD COLUMN class_visible INTEGER NOT NULL DEFAULT 0;');
    // По ТЗ: классы не показываются, пока пользователь сам не включит их в настройках
    db.exec('UPDATE user_skills SET class_visible = 0;');
  }
}

// Мета-приложения (одноразовые миграции)
db.exec(`
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Одноразовый перевод на новый UX: классы скрыты до ручного включения в настройках
const classesDefaultMigrated = db.prepare(
  'SELECT value FROM app_meta WHERE key = ?'
).get('classes_default_hidden_v1');
if (!classesDefaultMigrated) {
  db.exec('UPDATE user_skills SET class_visible = 0;');
  db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run('classes_default_hidden_v1', '1');
}

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
          name: 'Языки программирования', slug: 'programming-languages', icon: '📜', order: 1,
          skills: [
            ['Python', 'python', 'Универсальный язык'],
            ['JavaScript', 'javascript', 'Язык веба'],
            ['TypeScript', 'typescript', 'Типизированный JavaScript'],
            ['Java', 'java', 'Enterprise, Android'],
            ['C#', 'csharp', '.NET, Unity, игры'],
            ['C', 'c-lang', 'Низкоуровневый системный'],
            ['C++', 'cpp', 'Системы, игры, производительность'],
            ['Go', 'golang', 'Бэкенд, микросервисы'],
            ['Rust', 'rust', 'Безопасные системы'],
            ['Swift', 'swift', 'iOS, macOS'],
            ['Kotlin', 'kotlin', 'Android, бэкенд'],
            ['PHP', 'php', 'Веб-разработка'],
            ['Ruby', 'ruby', 'Веб, скрипты'],
            ['Dart', 'dart', 'Flutter, веб'],
            ['Scala', 'scala', 'JVM, функциональный'],
            ['Elixir', 'elixir', 'Распределённые системы'],
            ['Haskell', 'haskell', 'Функциональное программирование'],
            ['Clojure', 'clojure', 'Lisp на JVM'],
            ['Lua', 'lua', 'Скрипты, Roblox, моддинг'],
            ['R', 'r-lang', 'Статистика, аналитика'],
            ['MATLAB', 'matlab', 'Инженерия, наука'],
            ['Assembly', 'assembly', 'Ассемблер, низкий уровень'],
            ['Bash / Shell', 'bash', 'Автоматизация в Unix'],
            ['PowerShell', 'powershell', 'Автоматизация в Windows'],
          ]
        },
        {
          name: 'Веб-фронтенд', slug: 'web-frontend', icon: '🌐', order: 2,
          skills: [
            ['HTML / CSS', 'html-css', 'Разметка и стили'],
            ['React', 'react', 'Библиотека UI от Meta'],
            ['Vue.js', 'vuejs', 'Прогрессивный фреймворк'],
            ['Angular', 'angular', 'Фреймворк от Google'],
            ['Svelte', 'svelte', 'Компилируемый фреймворк'],
            ['Next.js', 'nextjs', 'React с SSR'],
            ['Nuxt.js', 'nuxtjs', 'Vue с SSR'],
            ['Astro', 'astro', 'Контентные сайты'],
            ['Tailwind CSS', 'tailwind', 'Утилитарный CSS'],
            ['SASS / SCSS', 'sass', 'CSS-препроцессор'],
            ['Webpack / Vite', 'bundlers', 'Сборщики проектов'],
            ['WebGL / Three.js', 'webgl', '3D в браузере'],
            ['PWA', 'pwa', 'Прогрессивные веб-приложения'],
            ['Web Components', 'web-components', 'Нативные компоненты'],
            ['Доступность (a11y)', 'accessibility', 'Веб для всех'],
          ]
        },
        {
          name: 'Веб-бэкенд', slug: 'web-backend', icon: '⚙️', order: 3,
          skills: [
            ['Node.js', 'nodejs', 'JS на сервере'],
            ['Express / Fastify', 'express', 'Node.js фреймворки'],
            ['NestJS', 'nestjs', 'Архитектурный Node.js'],
            ['Django', 'django', 'Python веб-фреймворк'],
            ['FastAPI', 'fastapi', 'Современный Python API'],
            ['Flask', 'flask', 'Минималистичный Python'],
            ['Laravel', 'laravel', 'PHP фреймворк'],
            ['Symfony', 'symfony', 'Enterprise PHP'],
            ['Ruby on Rails', 'rails', 'Ruby веб-фреймворк'],
            ['Spring (Java)', 'spring', 'Enterprise Java'],
            ['ASP.NET', 'aspnet', '.NET веб-фреймворк'],
            ['Phoenix (Elixir)', 'phoenix', 'Realtime веб'],
            ['Gin / Echo (Go)', 'go-web', 'Go веб-фреймворки'],
            ['Actix (Rust)', 'rust-web', 'Rust для веба'],
            ['REST API', 'rest-api', 'Проектирование REST'],
            ['GraphQL', 'graphql', 'Альтернатива REST'],
            ['gRPC', 'grpc', 'Высокопроизводительные API'],
            ['WebSocket', 'websocket', 'Realtime связь'],
            ['Аутентификация / OAuth', 'auth', 'JWT, OAuth, SSO'],
          ]
        },
        {
          name: 'Мобильная разработка', slug: 'mobile-dev', icon: '📱', order: 4,
          skills: [
            ['Swift', 'swift-mobile', 'iOS разработка'],
            ['SwiftUI', 'swiftui', 'Декларативный iOS UI'],
            ['Kotlin (Android)', 'kotlin-android', 'Android разработка'],
            ['Jetpack Compose', 'jetpack-compose', 'Современный Android UI'],
            ['Flutter', 'flutter', 'Кроссплатформа от Google'],
            ['React Native', 'react-native', 'Мобильный React'],
            ['Ionic', 'ionic', 'Web → мобайл'],
            ['Xamarin / .NET MAUI', 'maui', 'Мобильный C#'],
            ['Публикация в App Store', 'app-store', 'Релиз iOS приложений'],
            ['Публикация в Google Play', 'google-play', 'Релиз Android приложений'],
          ]
        },
        {
          name: 'Базы данных', slug: 'databases', icon: '🗄️', order: 5,
          skills: [
            ['SQL', 'sql', 'Язык запросов'],
            ['PostgreSQL', 'postgresql', 'Мощная реляционная БД'],
            ['MySQL / MariaDB', 'mysql', 'Популярная реляционная БД'],
            ['SQLite', 'sqlite', 'Встраиваемая БД'],
            ['MongoDB', 'mongodb', 'Документная NoSQL'],
            ['Redis', 'redis', 'In-memory хранилище'],
            ['Elasticsearch', 'elasticsearch', 'Поиск и аналитика'],
            ['ClickHouse', 'clickhouse', 'Аналитическая БД'],
            ['Cassandra', 'cassandra', 'Распределённая NoSQL'],
            ['Firebase / Firestore', 'firebase', 'BaaS от Google'],
            ['Supabase', 'supabase', 'Open-source Firebase'],
            ['Проектирование БД', 'db-design', 'Схемы, нормализация'],
            ['Оптимизация запросов', 'query-optimization', 'Индексы, EXPLAIN'],
          ]
        },
        {
          name: 'Data Science и AI', slug: 'data-ai', icon: '🤖', order: 6,
          skills: [
            ['Анализ данных', 'data-analysis', 'EDA, статистика'],
            ['Pandas', 'pandas', 'Работа с данными в Python'],
            ['NumPy', 'numpy', 'Численные вычисления'],
            ['Matplotlib / Seaborn', 'data-viz', 'Визуализация данных'],
            ['Machine Learning', 'ml', 'Классическое ML'],
            ['Deep Learning', 'deep-learning', 'Нейронные сети'],
            ['PyTorch', 'pytorch', 'Фреймворк DL'],
            ['TensorFlow', 'tensorflow', 'ML от Google'],
            ['Scikit-learn', 'scikit-learn', 'Классическое ML на Python'],
            ['Computer Vision', 'cv', 'Компьютерное зрение'],
            ['NLP', 'nlp', 'Обработка естественного языка'],
            ['LLM / GPT', 'llm', 'Большие языковые модели'],
            ['Prompt Engineering', 'prompt-eng', 'Работа с промптами'],
            ['LangChain', 'langchain', 'Приложения с LLM'],
            ['RAG-системы', 'rag', 'Retrieval Augmented Generation'],
            ['MLOps', 'mlops', 'ML в продакшене'],
            ['Big Data (Spark, Hadoop)', 'big-data', 'Большие данные'],
            ['Data Engineering', 'data-engineering', 'ETL, пайплайны'],
            ['Рекомендательные системы', 'recsys', 'Рекомендации'],
            ['Reinforcement Learning', 'rl', 'Обучение с подкреплением'],
          ]
        },
        {
          name: 'Аналитика и BI', slug: 'analytics-bi', icon: '📊', order: 7,
          skills: [
            ['Excel / Google Sheets', 'excel', 'Формулы, сводные таблицы'],
            ['Power BI', 'power-bi', 'BI от Microsoft'],
            ['Tableau', 'tableau', 'Визуализация данных'],
            ['Looker / Metabase', 'looker', 'BI-платформы'],
            ['Google Analytics', 'google-analytics', 'Веб-аналитика'],
            ['Product Analytics', 'product-analytics', 'Amplitude, Mixpanel'],
            ['A/B тестирование', 'ab-testing', 'Эксперименты на продукте'],
            ['Бизнес-аналитика', 'business-analytics', 'Анализ для бизнеса'],
          ]
        },
        {
          name: 'DevOps и инфраструктура', slug: 'devops', icon: '🏗️', order: 8,
          skills: [
            ['Linux / Unix', 'linux', 'Операционная система'],
            ['Docker', 'docker', 'Контейнеризация'],
            ['Kubernetes', 'kubernetes', 'Оркестрация контейнеров'],
            ['CI / CD', 'cicd', 'Непрерывная интеграция'],
            ['GitHub Actions', 'github-actions', 'CI/CD пайплайны'],
            ['Jenkins', 'jenkins', 'Автоматизация сборок'],
            ['Terraform', 'terraform', 'Infrastructure as Code'],
            ['Ansible', 'ansible', 'Управление конфигурациями'],
            ['AWS', 'aws', 'Облако Amazon'],
            ['Google Cloud', 'gcp', 'Облако Google'],
            ['Azure', 'azure', 'Облако Microsoft'],
            ['Cloudflare', 'cloudflare', 'CDN, защита, edge'],
            ['Nginx', 'nginx', 'Веб-сервер и прокси'],
            ['Мониторинг (Grafana, Prometheus)', 'monitoring', 'Логи, метрики'],
            ['SRE', 'sre', 'Site Reliability Engineering'],
          ]
        },
        {
          name: 'Тестирование и QA', slug: 'qa-testing', icon: '🧪', order: 9,
          skills: [
            ['Ручное тестирование', 'manual-testing', 'QA вручную'],
            ['Автоматизация тестов', 'test-automation', 'Авто-тесты'],
            ['Unit-тестирование', 'unit-testing', 'Тестирование функций'],
            ['Selenium', 'selenium', 'UI-автоматизация'],
            ['Cypress / Playwright', 'cypress', 'E2E тестирование'],
            ['Jest / Vitest', 'jest', 'JS тесты'],
            ['Pytest', 'pytest', 'Python тесты'],
            ['Postman', 'postman', 'Тестирование API'],
            ['Нагрузочное тестирование', 'load-testing', 'JMeter, k6'],
            ['Тест-дизайн', 'test-design', 'Кейсы, чек-листы'],
          ]
        },
        {
          name: 'Безопасность', slug: 'security', icon: '🔒', order: 10,
          skills: [
            ['Кибербезопасность', 'cybersecurity', 'Защита систем'],
            ['Пентест', 'pentesting', 'Тестирование на проникновение'],
            ['Web Security', 'web-security', 'OWASP, XSS, CSRF'],
            ['Криптография', 'cryptography', 'Шифрование данных'],
            ['Reverse Engineering', 'reverse-eng', 'Обратная инженерия'],
            ['Форензика', 'forensics', 'Цифровая криминалистика'],
            ['CTF', 'ctf', 'Capture the Flag соревнования'],
            ['Bug Bounty', 'bug-bounty', 'Поиск уязвимостей за награду'],
            ['Безопасность приложений', 'appsec', 'Application Security'],
          ]
        },
        {
          name: 'Архитектура и подходы', slug: 'architecture', icon: '🏛️', order: 11,
          skills: [
            ['Системный дизайн', 'system-design', 'Проектирование систем'],
            ['Микросервисы', 'microservices', 'Распределённая архитектура'],
            ['Event-Driven архитектура', 'event-driven', 'События, очереди'],
            ['Паттерны проектирования', 'design-patterns', 'GoF и не только'],
            ['Чистый код', 'clean-code', 'Читаемость, поддержка'],
            ['SOLID, DRY, KISS', 'solid', 'Принципы разработки'],
            ['DDD', 'ddd', 'Domain-Driven Design'],
            ['TDD', 'tdd', 'Test-Driven Development'],
            ['Agile / Scrum', 'agile', 'Гибкие методологии'],
            ['Git', 'git', 'Контроль версий'],
            ['Code Review', 'code-review', 'Ревью кода'],
          ]
        },
        {
          name: 'Системное программирование', slug: 'systems', icon: '🔧', order: 12,
          skills: [
            ['Операционные системы', 'os-dev', 'Ядра, драйверы'],
            ['Сетевое программирование', 'network-programming', 'TCP/IP, сокеты'],
            ['Embedded / Микроконтроллеры', 'embedded', 'Arduino, STM32'],
            ['Компиляторы', 'compilers', 'Создание языков'],
            ['Виртуальные машины', 'vm-dev', 'Реализация VM'],
            ['Параллельное программирование', 'concurrency', 'Многопоточность'],
          ]
        },
        {
          name: 'Игровая разработка', slug: 'gamedev', icon: '🎮', order: 13,
          skills: [
            ['Unity', 'unity', 'Движок на C#'],
            ['Unreal Engine', 'unreal', 'AAA на C++'],
            ['Godot', 'godot', 'Open-source движок'],
            ['GameMaker', 'gamemaker', '2D-игры'],
            ['Roblox Studio', 'roblox', 'Игры на Roblox'],
            ['Игровой дизайн (разработка)', 'game-design-dev', 'Механики, баланс'],
            ['Левел-дизайн', 'level-design', 'Проектирование уровней'],
            ['Шейдеры (GLSL/HLSL)', 'shaders', 'Графические эффекты'],
            ['Физика в играх', 'game-physics', 'Симуляции'],
            ['ИИ в играх', 'game-ai', 'Поведение NPC'],
            ['Мультиплеер / Netcode', 'multiplayer', 'Сетевые игры'],
            ['VR / AR разработка', 'vr-ar-dev', 'Виртуальная реальность'],
          ]
        },
        {
          name: 'Блокчейн и Web3', slug: 'blockchain', icon: '⛓️', order: 14,
          skills: [
            ['Solidity', 'solidity', 'Смарт-контракты Ethereum'],
            ['Rust для блокчейна', 'rust-blockchain', 'Solana, Near'],
            ['Web3.js / Ethers.js', 'web3js', 'Работа с блокчейном'],
            ['Смарт-контракты', 'smart-contracts', 'Логика на блокчейне'],
            ['DeFi', 'defi', 'Децентрализованные финансы'],
            ['NFT разработка', 'nft-dev', 'Создание NFT'],
            ['DAO', 'dao', 'Децентрализованные организации'],
            ['Аудит смарт-контрактов', 'smart-contract-audit', 'Безопасность'],
          ]
        },
        {
          name: 'Low-code и автоматизация', slug: 'lowcode', icon: '⚡', order: 15,
          skills: [
            ['Zapier / Make', 'zapier', 'Автоматизация процессов'],
            ['n8n', 'n8n', 'Self-hosted автоматизация'],
            ['Notion (продвинутый)', 'notion-advanced', 'Базы, формулы'],
            ['Airtable', 'airtable', 'No-code базы'],
            ['Bubble', 'bubble', 'No-code веб-приложения'],
            ['Webflow', 'webflow', 'No-code сайты'],
            ['Tilda', 'tilda', 'Конструктор сайтов'],
            ['Telegram-боты', 'telegram-bots', 'Создание ботов'],
            ['Discord-боты', 'discord-bots', 'Боты для Discord'],
            ['Скрипты автоматизации', 'automation-scripts', 'Python, Bash'],
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
          name: 'UI/UX дизайн', slug: 'ui-ux', icon: '📐', order: 1,
          skills: [
            ['UI-дизайн', 'ui-design', 'Визуальные интерфейсы'],
            ['UX-дизайн', 'ux-design', 'Пользовательский опыт'],
            ['UX-исследования', 'ux-research', 'Интервью, юзабилити-тесты'],
            ['Прототипирование', 'prototyping', 'Интерактивные прототипы'],
            ['Wireframing', 'wireframing', 'Каркасы интерфейсов'],
            ['Дизайн-системы', 'design-systems', 'Компонентные библиотеки'],
            ['Микроанимации', 'microinteractions', 'UI-анимации'],
            ['Информационная архитектура', 'info-architecture', 'Структура продукта'],
            ['Юзабилити-аудит', 'usability-audit', 'Анализ интерфейсов'],
            ['Дизайн для доступности', 'a11y-design', 'Accessibility'],
            ['Product Design', 'product-design', 'Продуктовый дизайн целиком'],
          ]
        },
        {
          name: 'Веб-дизайн', slug: 'web-design', icon: '🌐', order: 2,
          skills: [
            ['Лендинги', 'landing-design', 'Одностраничники'],
            ['Корпоративные сайты', 'corporate-sites', 'Многостраничники'],
            ['Дизайн интернет-магазинов', 'ecommerce-design', 'UI магазинов'],
            ['Email-дизайн', 'email-design', 'Рассылки, шаблоны'],
            ['Дизайн на Tilda', 'tilda-design', 'Конструктор сайтов'],
            ['Дизайн на Webflow', 'webflow-design', 'No-code сайты'],
            ['Адаптивный дизайн', 'responsive-design', 'Для всех устройств'],
          ]
        },
        {
          name: 'Дизайн мобильных приложений', slug: 'mobile-design', icon: '📱', order: 3,
          skills: [
            ['Дизайн iOS приложений', 'ios-design', 'Human Interface Guidelines'],
            ['Дизайн Android приложений', 'android-design', 'Material Design'],
            ['Дизайн мобильных игр', 'mobile-game-ui', 'UI для игр'],
            ['Иконки приложений', 'app-icons', 'Иконография'],
          ]
        },
        {
          name: 'Графический дизайн', slug: 'graphic-design', icon: '🖼️', order: 4,
          skills: [
            ['Логотипы', 'logo-design', 'Создание логотипов'],
            ['Брендинг', 'branding', 'Айдентика, фирстиль'],
            ['Гайдлайны бренда', 'brand-guidelines', 'Brandbook'],
            ['Полиграфия', 'print-design', 'Визитки, листовки, буклеты'],
            ['Упаковка', 'packaging-design', 'Дизайн упаковки'],
            ['Постеры и плакаты', 'poster-design', 'Афиши, постеры'],
            ['Книжная вёрстка', 'book-design', 'Книги, журналы'],
            ['Инфографика', 'infographic', 'Визуализация данных'],
            ['Типографика', 'typography', 'Работа со шрифтами'],
            ['Шрифтовой дизайн', 'type-design', 'Создание шрифтов'],
            ['Леттеринг', 'lettering', 'Рисованные буквы'],
          ]
        },
        {
          name: 'Дизайн для соцсетей', slug: 'social-media-design', icon: '📲', order: 5,
          skills: [
            ['Обложки и баннеры', 'social-banners', 'Соцсети, YouTube'],
            ['Карточки для постов', 'post-cards', 'Instagram, ВК'],
            ['Сторис', 'stories-design', 'Дизайн сторис'],
            ['Хайлайты Instagram', 'instagram-highlights', 'Иконки хайлайтов'],
            ['Превью YouTube', 'youtube-thumbnails', 'Кликабельные превью'],
            ['Аватары и баннеры профилей', 'profile-design', 'Оформление профилей'],
            ['Мемы и контент', 'meme-design', 'Развлекательный контент'],
            ['Шаблоны для соцсетей', 'social-templates', 'Готовые шаблоны'],
          ]
        },
        {
          name: 'Презентации', slug: 'presentations', icon: '📊', order: 6,
          skills: [
            ['Дизайн презентаций', 'presentation-design', 'PPT, Keynote'],
            ['Pitch-deck', 'pitch-deck', 'Презентации для инвесторов'],
            ['Инфографика в презентациях', 'presentation-infographic', 'Графики, схемы'],
            ['PowerPoint', 'powerpoint', 'MS PowerPoint'],
            ['Keynote', 'keynote', 'Apple Keynote'],
            ['Google Slides', 'google-slides', 'Слайды от Google'],
            ['Figma для презентаций', 'figma-presentations', 'Презы во Figma'],
          ]
        },
        {
          name: 'Иллюстрация (цифровая)', slug: 'digital-illustration', icon: '🖌️', order: 7,
          skills: [
            ['Цифровая иллюстрация', 'digital-illustration-skill', 'Procreate, Photoshop'],
            ['Концепт-арт', 'concept-art', 'Концепты для игр и кино'],
            ['Персонажный дизайн', 'character-design', 'Дизайн персонажей'],
            ['Environment Art', 'environment-art', 'Окружение'],
            ['Mat Painting', 'matte-painting', 'Цифровые фоны'],
            ['Пиксель-арт', 'pixel-art', 'Ретро-графика'],
            ['Векторная иллюстрация', 'vector-illustration', 'Векторная графика'],
            ['Стикеры', 'stickers-design', 'Стикеры для мессенджеров'],
            ['Иконки', 'icon-design', 'Иконография'],
            ['Эмодзи', 'emoji-design', 'Дизайн эмодзи'],
            ['Комиксы', 'comics', 'Рисование комиксов'],
            ['Манга', 'manga', 'Японские комиксы'],
            ['Детская иллюстрация', 'kids-illustration', 'Для детских книг'],
            ['Редакционная иллюстрация', 'editorial-illustration', 'Для медиа'],
            ['NFT-арт', 'nft-art', 'Цифровое искусство для NFT'],
          ]
        },
        {
          name: 'Традиционная иллюстрация', slug: 'traditional-art', icon: '✏️', order: 8,
          skills: [
            ['Карандашный рисунок', 'pencil-drawing', 'Скетчи, портреты'],
            ['Скетчинг', 'sketching', 'Быстрые наброски'],
            ['Урбан-скетчинг', 'urban-sketching', 'Зарисовки города'],
            ['Акварель', 'watercolor', 'Акварельная живопись'],
            ['Гуашь', 'gouache', 'Гуашевая живопись'],
            ['Масляная живопись', 'oil-painting', 'Маслом'],
            ['Акрил', 'acrylic-painting', 'Акриловая живопись'],
            ['Пастель', 'pastel', 'Сухая и масляная пастель'],
            ['Тушь и линер', 'ink-drawing', 'Графика чернилами'],
            ['Каллиграфия', 'calligraphy', 'Красивое письмо'],
            ['Графика', 'graphics', 'Художественная графика'],
          ]
        },
        {
          name: '3D-моделирование', slug: '3d-modeling', icon: '🧊', order: 9,
          skills: [
            ['Blender', 'blender', 'Универсальный 3D-софт'],
            ['Maya', 'maya', 'Профессиональный 3D'],
            ['3ds Max', '3ds-max', '3D для архитектуры и игр'],
            ['Cinema 4D', 'cinema-4d', 'Motion и моушн-графика'],
            ['ZBrush', 'zbrush', 'Цифровая скульптура'],
            ['Substance Painter', 'substance', 'Текстурирование'],
            ['Hard-surface моделирование', 'hard-surface', 'Техника, оружие'],
            ['Органическое моделирование', 'organic-modeling', 'Персонажи, существа'],
            ['Топология и ретопология', 'topology', 'Подготовка моделей'],
            ['UV-развёртка', 'uv-mapping', 'Развёртка моделей'],
            ['3D для печати', '3d-printing-modeling', 'Подготовка под печать'],
            ['Архитектурная визуализация', 'arch-viz', 'Визуализация интерьеров'],
            ['Game-Ready модели', 'game-ready-3d', '3D для игр'],
          ]
        },
        {
          name: 'Анимация', slug: 'animation', icon: '🎬', order: 10,
          skills: [
            ['2D-анимация', '2d-animation', 'Покадровая, риг'],
            ['3D-анимация', '3d-animation-skill', 'Анимация в 3D'],
            ['Риггинг', 'rigging', 'Подготовка моделей к анимации'],
            ['Анимация персонажей', 'character-animation', 'Походки, эмоции'],
            ['Motion Graphics', 'motion-graphics', 'Анимация графики'],
            ['Моушн-дизайн', 'motion-design', 'After Effects'],
            ['Анимация в After Effects', 'after-effects', 'AE'],
            ['Анимация в Spine', 'spine-animation', 'Анимация спрайтов'],
            ['Стоп-моушн', 'stop-motion', 'Покадровая съёмка'],
            ['Анимация для UI', 'ui-animation', 'Микроанимации интерфейса'],
            ['Lottie-анимация', 'lottie', 'Векторная для веба'],
            ['Frame-by-frame', 'frame-by-frame', 'Классическая покадровая'],
          ]
        },
        {
          name: 'Рендеринг и визуализация', slug: 'rendering', icon: '✨', order: 11,
          skills: [
            ['V-Ray', 'vray', 'Фотореалистичный рендер'],
            ['Octane Render', 'octane', 'GPU-рендер'],
            ['Cycles (Blender)', 'cycles', 'Рендер в Blender'],
            ['Unreal Engine для виза', 'unreal-viz', 'Real-time виз'],
            ['Свет и композиция', 'lighting', 'Свет в 3D'],
            ['Текстурирование', 'texturing', 'Создание текстур'],
            ['Composite в Nuke', 'nuke', 'Композитинг'],
          ]
        },
        {
          name: 'Дизайн игр (визуал)', slug: 'game-design-visual', icon: '🎮', order: 12,
          skills: [
            ['Game UI / UX', 'game-ui-ux', 'Интерфейсы игр'],
            ['Иконки для игр', 'game-icons', 'Внутриигровые иконки'],
            ['Game-арт', 'game-art', 'Художественный стиль игры'],
            ['Спрайты и тайлы', 'sprites-tiles', '2D игровая графика'],
            ['Анимация в играх', 'game-animation', 'Анимация спрайтов и моделей'],
          ]
        },
        {
          name: 'Интерьер и пространство', slug: 'interior-design', icon: '🏠', order: 13,
          skills: [
            ['Дизайн интерьера', 'interior-design-skill', 'Жилые пространства'],
            ['Дизайн общественных пространств', 'public-spaces', 'Кафе, офисы'],
            ['Скандинавский стиль', 'scandinavian-style', 'Минимализм, дерево'],
            ['Лофт', 'loft-style', 'Индустриальный стиль'],
            ['Классика', 'classic-interior', 'Классический интерьер'],
            ['Цветовые решения', 'color-design', 'Колористика в интерьере'],
            ['Освещение', 'lighting-design', 'Дизайн освещения'],
            ['Меблировка', 'furniture-selection', 'Подбор мебели'],
          ]
        },
        {
          name: 'Архитектура и САПР', slug: 'architecture-cad', icon: '🏛️', order: 14,
          skills: [
            ['Архитектурное проектирование', 'architecture', 'Здания'],
            ['AutoCAD', 'autocad', 'Чертежи'],
            ['ArchiCAD', 'archicad', 'Архитектурный софт'],
            ['Revit / BIM', 'revit-bim', 'Информационное моделирование'],
            ['SketchUp', 'sketchup', 'Простое 3D'],
            ['Ландшафтная архитектура', 'landscape-architecture', 'Внешние пространства'],
            ['Урбанистика', 'urbanism', 'Городское планирование'],
          ]
        },
        {
          name: 'Промышленный и предметный дизайн', slug: 'industrial-design', icon: '🪑', order: 15,
          skills: [
            ['Промышленный дизайн', 'industrial-design-skill', 'Дизайн товаров'],
            ['Дизайн мебели', 'furniture-design', 'Проектирование мебели'],
            ['Дизайн ювелирных изделий', 'jewelry-design', 'Украшения'],
            ['Дизайн транспорта', 'transport-design', 'Автомобили, техника'],
            ['CAD для промдизайна', 'fusion-360', 'Fusion 360, Rhino'],
            ['KeyShot (рендер продукта)', 'keyshot', 'Рендер изделий'],
          ]
        },
        {
          name: 'Fashion и текстиль', slug: 'fashion-design', icon: '👗', order: 16,
          skills: [
            ['Дизайн одежды', 'clothing-design', 'Создание одежды'],
            ['Конструирование одежды', 'pattern-making', 'Лекала, выкройки'],
            ['Принты и паттерны', 'prints-patterns', 'Текстильные узоры'],
            ['Модные иллюстрации', 'fashion-illustration', 'Эскизы одежды'],
            ['Дизайн обуви', 'shoe-design', 'Обувная мода'],
            ['Дизайн аксессуаров', 'accessory-design', 'Сумки, шляпы'],
            ['Стилистика', 'fashion-styling', 'Стиль и образ'],
          ]
        },
        {
          name: 'Дизайн-инструменты', slug: 'design-tools', icon: '🛠️', order: 17,
          skills: [
            ['Figma', 'figma', 'Главный UI-инструмент'],
            ['Sketch', 'sketch', 'macOS UI-софт'],
            ['Adobe XD', 'adobe-xd', 'UI-софт от Adobe'],
            ['Photoshop', 'photoshop', 'Растровая графика'],
            ['Illustrator', 'illustrator', 'Векторная графика'],
            ['InDesign', 'indesign', 'Вёрстка полиграфии'],
            ['Procreate', 'procreate', 'Цифровое рисование на iPad'],
            ['Affinity Designer', 'affinity', 'Альтернатива Adobe'],
            ['CorelDRAW', 'coreldraw', 'Векторная графика'],
            ['Canva', 'canva', 'Простой дизайн для всех'],
            ['Framer', 'framer', 'Прототипы и сайты'],
          ]
        },
        {
          name: 'Дизайн-теория и арт-навыки', slug: 'design-theory', icon: '🎓', order: 18,
          skills: [
            ['Композиция', 'composition', 'Построение кадра/работы'],
            ['Колористика', 'color-theory', 'Теория цвета'],
            ['Перспектива', 'perspective', 'Линейная и воздушная'],
            ['Анатомия для художников', 'anatomy', 'Рисование человека'],
            ['История искусств', 'art-history', 'История живописи и дизайна'],
            ['Арт-критика', 'art-critique', 'Анализ работ'],
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
          name: 'Гитары и струнные с грифом', slug: 'guitars', icon: '🎸', order: 1,
          skills: [
            ['Акустическая гитара', 'acoustic-guitar', 'Фингерстайл, аккорды'],
            ['Классическая гитара', 'classical-guitar', 'Нейлоновые струны'],
            ['Электрогитара', 'electric-guitar', 'Рок, блюз, метал'],
            ['Бас-гитара', 'bass-guitar', 'Ритм-секция'],
            ['Слайд-гитара', 'slide-guitar', 'Игра слайдом'],
            ['12-струнная гитара', '12-string-guitar', 'Богатое звучание'],
            ['Укулеле', 'ukulele', 'Гавайская мини-гитара'],
            ['Банджо', 'banjo', 'Кантри, блюграсс'],
            ['Мандолина', 'mandolin', 'Народная, классика'],
            ['Балалайка', 'balalaika', 'Русский народный'],
            ['Домра', 'domra', 'Русский народный'],
            ['Гусли', 'gusli', 'Древнерусский инструмент'],
            ['Ситар', 'sitar', 'Индийский инструмент'],
            ['Лютня', 'lute', 'Старинный инструмент'],
          ]
        },
        {
          name: 'Смычковые', slug: 'bowed-strings', icon: '🎻', order: 2,
          skills: [
            ['Скрипка', 'violin', 'Классика, фолк, джаз'],
            ['Альт', 'viola', 'Среднее звучание'],
            ['Виолончель', 'cello', 'Оркестр, соло'],
            ['Контрабас', 'double-bass', 'Низкие струнные'],
            ['Эрху', 'erhu', 'Китайская скрипка'],
          ]
        },
        {
          name: 'Клавишные', slug: 'keys', icon: '🎹', order: 3,
          skills: [
            ['Фортепиано', 'piano', 'Классика, джаз, поп'],
            ['Электрическое пианино', 'electric-piano', 'Rhodes, Wurlitzer'],
            ['Синтезатор', 'synthesizer', 'Электронные клавишные'],
            ['MIDI-клавиатура', 'midi-keyboard', 'Управление DAW'],
            ['Орган', 'organ', 'Церковный, Hammond'],
            ['Клавесин', 'harpsichord', 'Барочная клавишная'],
            ['Аккордеон', 'accordion', 'Народная музыка'],
            ['Баян', 'bayan', 'Русский аккордеон'],
            ['Гармонь', 'harmonika', 'Русская народная'],
            ['Мелодика', 'melodica', 'Духовая клавишная'],
          ]
        },
        {
          name: 'Арфы и щипковые', slug: 'plucked', icon: '🪕', order: 4,
          skills: [
            ['Арфа', 'harp', 'Концертная арфа'],
            ['Кельтская арфа', 'celtic-harp', 'Маленькая арфа'],
            ['Кото', 'koto', 'Японская цитра'],
            ['Цимбалы', 'cymbalom', 'Венгерский инструмент'],
          ]
        },
        {
          name: 'Ударные', slug: 'percussion', icon: '🥁', order: 5,
          skills: [
            ['Барабанная установка', 'drum-kit', 'Полный набор'],
            ['Электронные ударные', 'electronic-drums', 'Драм-пэды, V-Drums'],
            ['Кахон', 'cajon', 'Перкуссионный ящик'],
            ['Джембе', 'djembe', 'Африканский барабан'],
            ['Конги', 'congas', 'Кубинские барабаны'],
            ['Бонги', 'bongos', 'Парные барабаны'],
            ['Дарбука', 'darbuka', 'Ближневосточный барабан'],
            ['Ханг / Handpan', 'handpan', 'Стальная тарелка'],
            ['Вибрафон', 'vibraphone', 'Металлофон'],
            ['Маримба / Ксилофон', 'marimba', 'Деревянные пластины'],
            ['Тарелки и литавры', 'cymbals-timpani', 'Оркестровые ударные'],
          ]
        },
        {
          name: 'Духовые деревянные', slug: 'woodwinds', icon: '🎵', order: 6,
          skills: [
            ['Флейта', 'flute', 'Классическая поперечная'],
            ['Блок-флейта', 'recorder', 'Учебная флейта'],
            ['Кларнет', 'clarinet', 'Джаз, классика'],
            ['Саксофон', 'saxophone', 'Джаз, блюз, поп'],
            ['Гобой', 'oboe', 'Оркестр'],
            ['Фагот', 'bassoon', 'Низкий деревянный'],
            ['Губная гармоника', 'harmonica', 'Блюз, фолк'],
            ['Окарина', 'ocarina', 'Глиняная флейта'],
            ['Дудук', 'duduk', 'Армянский инструмент'],
            ['Кавал / Най', 'kaval', 'Восточная флейта'],
            ['Шакухати', 'shakuhachi', 'Японская флейта'],
            ['Волынка', 'bagpipes', 'Шотландская, ирландская'],
            ['Диджериду', 'didgeridoo', 'Австралийский инструмент'],
          ]
        },
        {
          name: 'Духовые медные', slug: 'brass', icon: '🎺', order: 7,
          skills: [
            ['Труба', 'trumpet', 'Джаз, оркестр'],
            ['Тромбон', 'trombone', 'Кулисный медный'],
            ['Валторна', 'french-horn', 'Оркестровая'],
            ['Туба', 'tuba', 'Низкий медный'],
            ['Корнет', 'cornet', 'Малая труба'],
          ]
        },
        {
          name: 'Вокал', slug: 'vocal', icon: '🎤', order: 8,
          skills: [
            ['Эстрадный вокал', 'pop-vocals', 'Поп, эстрада'],
            ['Академический вокал', 'academic-vocals', 'Классическое пение'],
            ['Оперный вокал', 'opera', 'Опера'],
            ['Джазовый вокал', 'jazz-vocals', 'Джаз, скэт'],
            ['Рок-вокал', 'rock-vocals', 'Рок и его жанры'],
            ['Экстрим-вокал', 'extreme-vocals', 'Гроул, скрим'],
            ['Народное пение', 'folk-vocals', 'Народная манера'],
            ['Хоровое пение', 'choir-singing', 'Пение в хоре'],
            ['Рэп', 'rap', 'Читка, фристайл'],
            ['Битбокс', 'beatbox', 'Вокальная перкуссия'],
            ['Горловое пение', 'throat-singing', 'Хоомей, каргыраа'],
            ['Постановка голоса', 'voice-coaching', 'Техника пения'],
            ['Бэк-вокал', 'backing-vocals', 'Подпевки'],
          ]
        },
        {
          name: 'Музыкальный продакшн', slug: 'music-production', icon: '🎛️', order: 9,
          skills: [
            ['Битмейкинг', 'beatmaking', 'Создание битов'],
            ['Аранжировка в DAW', 'daw-arrangement', 'Сборка композиций'],
            ['Сведение (Mixing)', 'mixing', 'Микс треков'],
            ['Мастеринг', 'mastering', 'Финальная обработка'],
            ['Запись вокала', 'vocal-recording', 'Запись и обработка вокала'],
            ['Запись инструментов', 'instrument-recording', 'Звукозапись'],
            ['Саунд-дизайн', 'sound-design', 'Создание звуков и тембров'],
            ['Синтез звука', 'sound-synthesis', 'Работа с синтезаторами'],
            ['Сэмплирование', 'sampling', 'Работа с сэмплами'],
            ['Программирование драм-машин', 'drum-programming', 'Биты в DAW'],
            ['Полевая запись', 'field-recording', 'Запись окружения'],
          ]
        },
        {
          name: 'DAW и софт', slug: 'daw-software', icon: '💿', order: 10,
          skills: [
            ['Ableton Live', 'ableton', 'DAW для электроники'],
            ['FL Studio', 'fl-studio', 'DAW для битов'],
            ['Logic Pro', 'logic-pro', 'DAW для macOS'],
            ['Cubase', 'cubase', 'Профессиональная DAW'],
            ['Pro Tools', 'pro-tools', 'Студийный стандарт'],
            ['Reaper', 'reaper', 'Гибкая DAW'],
            ['Studio One', 'studio-one', 'Современная DAW'],
            ['GarageBand', 'garageband', 'Бесплатная DAW Apple'],
            ['Bitwig Studio', 'bitwig', 'Модульная DAW'],
            ['Reason', 'reason', 'Виртуальная студия'],
            ['VST-плагины', 'vst-plugins', 'Виртуальные инструменты и эффекты'],
            ['Серум / Massive (синтез)', 'soft-synths', 'Программные синтезаторы'],
          ]
        },
        {
          name: 'DJ и живые выступления', slug: 'dj-live', icon: '🎧', order: 11,
          skills: [
            ['DJ-инг', 'djing', 'Сведение треков'],
            ['Скретчинг', 'scratching', 'Турнтаблизм'],
            ['Live-выступления (Ableton)', 'live-set', 'Живые сеты'],
            ['Контроллеры (DJ)', 'dj-controllers', 'Pioneer, Traktor'],
            ['Винил (DJ)', 'vinyl-djing', 'Классический DJ-инг'],
            ['Подбор треков (selecting)', 'track-selection', 'Музыкальный вкус DJ'],
          ]
        },
        {
          name: 'Теория и грамота', slug: 'music-theory', icon: '📝', order: 12,
          skills: [
            ['Музыкальная теория', 'music-theory-skill', 'Гармония, лад'],
            ['Сольфеджио', 'solfege', 'Слух и интонирование'],
            ['Гармония', 'harmony', 'Аккорды и их связи'],
            ['Музыкальный анализ', 'music-analysis', 'Разбор произведений'],
            ['Чтение с листа', 'sight-reading', 'Игра по нотам'],
            ['Нотная запись', 'music-notation', 'Sibelius, MuseScore, Dorico'],
            ['Развитие слуха', 'ear-training', 'Музыкальный слух'],
            ['Ритмика', 'rhythm', 'Чувство ритма'],
          ]
        },
        {
          name: 'Композиция и сонграйтинг', slug: 'composition', icon: '✏️', order: 13,
          skills: [
            ['Написание песен', 'songwriting', 'Сонграйтинг'],
            ['Написание текстов', 'lyric-writing', 'Тексты песен'],
            ['Композиция', 'composition-skill', 'Создание музыки'],
            ['Аранжировка', 'arrangement', 'Оркестровка, обработка'],
            ['Оркестровка', 'orchestration', 'Партитуры для оркестра'],
            ['Музыка для кино', 'film-scoring', 'Саундтреки'],
            ['Музыка для игр', 'game-music', 'Игровые саундтреки'],
            ['Музыка для рекламы', 'jingle-writing', 'Джинглы'],
            ['Импровизация', 'improvisation-music', 'Музыкальная импровизация'],
            ['Транскрипция', 'transcription', 'Снятие на слух'],
          ]
        },
        {
          name: 'Жанры (исполнение)', slug: 'genres', icon: '🎼', order: 14,
          skills: [
            ['Классическая музыка', 'classical-music', 'Академическая'],
            ['Джаз', 'jazz', 'Импровизация, свинг'],
            ['Блюз', 'blues', 'Корни рока'],
            ['Рок', 'rock', 'Рок-музыка'],
            ['Метал', 'metal', 'Тяжёлая музыка'],
            ['Поп-музыка', 'pop-music', 'Эстрадная'],
            ['Хип-хоп', 'hip-hop', 'Рэп, бит-музыка'],
            ['R&B / Соул', 'rnb-soul', 'Ритм-н-блюз'],
            ['Электронная музыка', 'electronic-music', 'House, techno, EDM'],
            ['House', 'house', 'House-музыка'],
            ['Techno', 'techno', 'Techno'],
            ['Drum & Bass', 'drum-and-bass', 'DnB'],
            ['Lo-fi / Chillhop', 'lofi', 'Расслабляющая'],
            ['Reggae / Ska', 'reggae', 'Ямайская музыка'],
            ['Country', 'country', 'Кантри'],
            ['Folk / Народная', 'folk-music', 'Народная музыка'],
            ['Авторская песня / Бардовская', 'singer-songwriter', 'Бардовская'],
            ['Шансон', 'chanson', 'Русский шансон, французский шансон'],
            ['Этническая музыка', 'world-music', 'World music'],
          ]
        },
        {
          name: 'Музыкальное образование и работа', slug: 'music-career', icon: '🎓', order: 15,
          skills: [
            ['Преподавание музыки', 'music-teaching', 'Уроки игры'],
            ['Игра в группе', 'band-playing', 'Игра в ансамбле'],
            ['Дирижирование', 'conducting', 'Управление оркестром/хором'],
            ['Концертная деятельность', 'performing', 'Выступления'],
            ['Музыкальная критика', 'music-criticism', 'Рецензии, обзоры'],
            ['Музыкальный менеджмент', 'music-management', 'Продвижение артистов'],
            ['Цифровая дистрибуция музыки', 'music-distribution', 'Релизы на стриминги'],
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
          name: 'Самые распространённые', slug: 'top-languages', icon: '⭐', order: 1,
          skills: [
            ['Английский', 'english', 'Международный язык'],
            ['Китайский (мандарин)', 'chinese-mandarin', '1.1B+ носителей'],
            ['Испанский', 'spanish', '500M+ носителей'],
            ['Арабский', 'arabic', '400M+ носителей'],
            ['Хинди', 'hindi', '600M+ носителей'],
            ['Французский', 'french', 'Дипломатия, культура'],
            ['Португальский', 'portuguese', 'Бразилия, Португалия'],
            ['Русский', 'russian', '250M+ носителей'],
          ]
        },
        {
          name: 'Западноевропейские', slug: 'western-european', icon: '🇪🇺', order: 2,
          skills: [
            ['Немецкий', 'german', 'Германия, Австрия, Швейцария'],
            ['Итальянский', 'italian', 'Италия, Швейцария'],
            ['Нидерландский', 'dutch', 'Нидерланды, Бельгия'],
            ['Шведский', 'swedish', 'Швеция'],
            ['Норвежский', 'norwegian', 'Норвегия'],
            ['Датский', 'danish', 'Дания'],
            ['Финский', 'finnish', 'Финляндия'],
            ['Исландский', 'icelandic', 'Исландия'],
            ['Ирландский (гэльский)', 'irish', 'Ирландия'],
            ['Валлийский', 'welsh', 'Уэльс'],
            ['Каталанский', 'catalan', 'Каталония'],
            ['Греческий', 'greek', 'Греция, Кипр'],
          ]
        },
        {
          name: 'Восточноевропейские', slug: 'eastern-european', icon: '🏰', order: 3,
          skills: [
            ['Польский', 'polish', 'Польша'],
            ['Чешский', 'czech', 'Чехия'],
            ['Словацкий', 'slovak', 'Словакия'],
            ['Венгерский', 'hungarian', 'Венгрия'],
            ['Румынский', 'romanian', 'Румыния, Молдова'],
            ['Болгарский', 'bulgarian', 'Болгария'],
            ['Сербский', 'serbian', 'Сербия'],
            ['Хорватский', 'croatian', 'Хорватия'],
            ['Словенский', 'slovenian', 'Словения'],
            ['Македонский', 'macedonian', 'Северная Македония'],
            ['Албанский', 'albanian', 'Албания, Косово'],
            ['Литовский', 'lithuanian', 'Литва'],
            ['Латышский', 'latvian', 'Латвия'],
            ['Эстонский', 'estonian', 'Эстония'],
          ]
        },
        {
          name: 'Славянские', slug: 'slavic', icon: '🪆', order: 4,
          skills: [
            ['Украинский', 'ukrainian', 'Украина'],
            ['Белорусский', 'belarusian', 'Беларусь'],
          ]
        },
        {
          name: 'Восточноазиатские', slug: 'east-asian', icon: '🏯', order: 5,
          skills: [
            ['Японский', 'japanese', 'Япония'],
            ['Корейский', 'korean', 'Корея'],
            ['Китайский (кантонский)', 'cantonese', 'Гонконг, юг Китая'],
            ['Монгольский', 'mongolian', 'Монголия'],
          ]
        },
        {
          name: 'Юго-Восточная Азия', slug: 'southeast-asian', icon: '🌴', order: 6,
          skills: [
            ['Вьетнамский', 'vietnamese', 'Вьетнам'],
            ['Тайский', 'thai', 'Таиланд'],
            ['Индонезийский', 'indonesian', '270M+ носителей'],
            ['Малайский', 'malay', 'Малайзия, Сингапур'],
            ['Тагалог / Филиппинский', 'tagalog', 'Филиппины'],
            ['Бирманский', 'burmese', 'Мьянма'],
            ['Кхмерский', 'khmer', 'Камбоджа'],
            ['Лаосский', 'lao', 'Лаос'],
          ]
        },
        {
          name: 'Южная Азия', slug: 'south-asian', icon: '🕉️', order: 7,
          skills: [
            ['Урду', 'urdu', 'Пакистан, Индия'],
            ['Бенгальский', 'bengali', 'Бангладеш, Индия'],
            ['Тамильский', 'tamil', 'Юг Индии, Шри-Ланка'],
            ['Телугу', 'telugu', 'Индия'],
            ['Маратхи', 'marathi', 'Индия'],
            ['Гуджарати', 'gujarati', 'Индия'],
            ['Панджаби', 'punjabi', 'Индия, Пакистан'],
            ['Непальский', 'nepali', 'Непал'],
            ['Сингальский', 'sinhala', 'Шри-Ланка'],
          ]
        },
        {
          name: 'Ближний Восток и Северная Африка', slug: 'middle-east-langs', icon: '🕌', order: 8,
          skills: [
            ['Турецкий', 'turkish', 'Турция'],
            ['Фарси (персидский)', 'farsi', 'Иран'],
            ['Иврит', 'hebrew', 'Израиль'],
            ['Курдский', 'kurdish', 'Курдистан'],
            ['Пушту', 'pashto', 'Афганистан, Пакистан'],
            ['Дари', 'dari', 'Афганистан'],
          ]
        },
        {
          name: 'Кавказ и Центральная Азия', slug: 'caucasus-central-asia', icon: '⛰️', order: 9,
          skills: [
            ['Грузинский', 'georgian', 'Грузия'],
            ['Армянский', 'armenian', 'Армения'],
            ['Азербайджанский', 'azerbaijani', 'Азербайджан'],
            ['Казахский', 'kazakh', 'Казахстан'],
            ['Узбекский', 'uzbek', 'Узбекистан'],
            ['Киргизский', 'kyrgyz', 'Киргизия'],
            ['Таджикский', 'tajik', 'Таджикистан'],
            ['Туркменский', 'turkmen', 'Туркменистан'],
            ['Чеченский', 'chechen', 'Чечня'],
            ['Татарский', 'tatar', 'Татарстан, Поволжье'],
            ['Башкирский', 'bashkir', 'Башкортостан'],
            ['Якутский', 'yakut', 'Якутия'],
            ['Бурятский', 'buryat', 'Бурятия'],
          ]
        },
        {
          name: 'Африканские', slug: 'african', icon: '🌍', order: 10,
          skills: [
            ['Суахили', 'swahili', 'Восточная Африка'],
            ['Амхарский', 'amharic', 'Эфиопия'],
            ['Зулу', 'zulu', 'ЮАР'],
            ['Африкаанс', 'afrikaans', 'ЮАР, Намибия'],
            ['Йоруба', 'yoruba', 'Нигерия'],
            ['Хауса', 'hausa', 'Западная Африка'],
          ]
        },
        {
          name: 'Древние и редкие', slug: 'ancient-rare', icon: '📜', order: 11,
          skills: [
            ['Латынь', 'latin', 'Древний Рим, академическая'],
            ['Древнегреческий', 'ancient-greek', 'Античность, философия'],
            ['Старославянский', 'old-slavonic', 'Церковный язык'],
            ['Древнеегипетский', 'ancient-egyptian', 'Иероглифы'],
            ['Санскрит', 'sanskrit', 'Древняя Индия'],
            ['Эсперанто', 'esperanto', 'Искусственный язык'],
            ['Идиш', 'yiddish', 'Германо-еврейский'],
          ]
        },
        {
          name: 'Жестовые и невербальные', slug: 'sign-langs', icon: '🤟', order: 12,
          skills: [
            ['Русский жестовый язык (РЖЯ)', 'rsl', 'РЖЯ'],
            ['Американский жестовый (ASL)', 'asl', 'ASL'],
            ['Международные жесты', 'international-signs', 'Универсальные жесты'],
            ['Чтение по губам', 'lip-reading', 'Чтение губ'],
          ]
        },
        {
          name: 'Навыки изучения и работы с языком', slug: 'language-skills', icon: '🧠', order: 13,
          skills: [
            ['Методики изучения языков', 'language-learning', 'Полиглотские методы'],
            ['Самостоятельное изучение', 'self-study-languages', 'Самообучение'],
            ['Постановка произношения', 'pronunciation', 'Акцент, фонетика'],
            ['Письменный перевод', 'translation', 'Перевод текстов'],
            ['Устный перевод', 'interpretation', 'Устный последовательный'],
            ['Синхронный перевод', 'simultaneous-interpretation', 'Синхрон'],
            ['Преподавание иностранных языков', 'language-teaching', 'Уроки языков'],
            ['Подготовка к IELTS / TOEFL', 'ielts-toefl', 'Языковые экзамены'],
            ['Деловой английский', 'business-english', 'Business English'],
            ['Технический английский', 'technical-english', 'IT-английский'],
            ['Грамматика и лингвистика', 'linguistics', 'Языкознание'],
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
          name: 'Базовые техники готовки', slug: 'cooking-techniques', icon: '🔪', order: 1,
          skills: [
            ['Работа с ножом', 'knife-skills', 'Нарезка, шинковка'],
            ['Жарка', 'frying', 'Сковорода, фритюр'],
            ['Варка и припускание', 'boiling', 'Варка, отваривание'],
            ['Тушение', 'stewing', 'Медленная готовка'],
            ['Запекание', 'baking-cooking', 'Духовка'],
            ['Готовка на пару', 'steaming', 'Пар, бамбуковые корзины'],
            ['Sous-vide', 'sous-vide', 'Готовка в вакууме'],
            ['Конфи', 'confit', 'Томление в жире'],
            ['Бланширование', 'blanching', 'Кратковременная варка'],
            ['Карамелизация', 'caramelization', 'Сахар, лук'],
            ['Работа со специями', 'spices', 'Приправы и пряности'],
            ['Соусы', 'sauces', 'Базовые и сложные соусы'],
            ['Бульоны и фоны', 'stocks', 'Основы кухни'],
          ]
        },
        {
          name: 'Выпечка и десерты', slug: 'baking-desserts', icon: '🥐', order: 2,
          skills: [
            ['Хлеб', 'bread-baking', 'Домашний хлеб'],
            ['Хлеб на закваске', 'sourdough', 'Sourdough'],
            ['Бездрожжевая выпечка', 'no-yeast-baking', 'Содовая, на кефире'],
            ['Сдобная выпечка', 'sweet-bread', 'Булочки, пироги'],
            ['Круассаны и слоёное', 'croissants', 'Слоёное тесто'],
            ['Пицца', 'pizza', 'Тесто и сборка'],
            ['Торты', 'cakes', 'Многослойные торты'],
            ['Бисквиты', 'sponge-cakes', 'Бисквитные основы'],
            ['Чизкейки', 'cheesecakes', 'Чизкейки'],
            ['Муссовые торты', 'mousse-cakes', 'Современная кондитерка'],
            ['Капкейки и маффины', 'cupcakes', 'Порционная выпечка'],
            ['Печенье', 'cookies', 'Куки, песочное'],
            ['Макаронс', 'macarons', 'Французское миндальное'],
            ['Эклеры и заварное', 'eclairs', 'Заварное тесто'],
            ['Пироги', 'pies', 'Открытые и закрытые'],
            ['Шоколад и трюфели', 'chocolate-work', 'Работа с шоколадом'],
            ['Карамель', 'caramel-work', 'Карамельные изделия'],
            ['Мороженое и сорбеты', 'ice-cream', 'Домашнее мороженое'],
            ['Десерты в стаканах', 'verrines', 'Парфе, тирамису'],
            ['Декор тортов', 'cake-decoration', 'Украшение тортов'],
            ['Сахарная мастика', 'fondant', 'Мастика и фигурки'],
            ['Айсинг и роспись', 'royal-icing', 'Роспись пряников'],
          ]
        },
        {
          name: 'Мясо, птица, дичь', slug: 'meat-poultry', icon: '🥩', order: 3,
          skills: [
            ['Стейки', 'steaks', 'Степени прожарки'],
            ['Запечённое мясо', 'roast-meat', 'Буженина, ростбиф'],
            ['Котлеты и фарш', 'meatballs', 'Из фарша'],
            ['Шашлык / Кебаб', 'kebab', 'Маринады, мангал'],
            ['Птица целиком', 'whole-poultry', 'Курица, утка, индейка'],
            ['Утка / Дичь', 'duck-game', 'Утка, кролик, дичь'],
            ['Бургеры', 'burgers', 'Котлеты, сборка'],
            ['Колбасы домашние', 'homemade-sausages', 'Колбаса своими руками'],
            ['Паштеты и террины', 'pates', 'Паштеты'],
            ['Субпродукты', 'offal', 'Печень, сердце, язык'],
            ['Разделка мяса', 'butchering', 'Работа с тушей'],
          ]
        },
        {
          name: 'Гриль, мангал, BBQ', slug: 'grill-bbq', icon: '🔥', order: 4,
          skills: [
            ['Шашлык', 'shashlik', 'Классический шашлык'],
            ['BBQ (американский)', 'bbq', 'Smoking, brisket'],
            ['Копчение', 'smoking-food', 'Холодное и горячее'],
            ['Гриль (овощи и рыба)', 'grilling', 'На решётке'],
            ['Тандыр', 'tandoor', 'Готовка в тандыре'],
            ['Казан / Плов на огне', 'kazan-cooking', 'Казан, открытый огонь'],
            ['Маринады для гриля', 'marinades', 'Маринование'],
          ]
        },
        {
          name: 'Рыба и морепродукты', slug: 'seafood', icon: '🐟', order: 5,
          skills: [
            ['Разделка рыбы', 'fish-butchering', 'Филетирование'],
            ['Запечённая рыба', 'baked-fish', 'Целиком, филе'],
            ['Жареная рыба', 'fried-fish', 'На сковороде'],
            ['Стейки из рыбы', 'fish-steaks', 'Лосось, тунец'],
            ['Уха и рыбные супы', 'fish-soups', 'Уха, буйабес'],
            ['Креветки и моллюски', 'shellfish', 'Креветки, мидии'],
            ['Кальмары и осьминоги', 'cephalopods', 'Головоногие'],
            ['Засолка рыбы', 'fish-curing', 'Соление, гравлакс'],
            ['Копчёная рыба', 'smoked-fish', 'Копчение рыбы'],
            ['Севиче и тартар', 'ceviche', 'Сырая рыба'],
          ]
        },
        {
          name: 'Супы и первые блюда', slug: 'soups', icon: '🍲', order: 6,
          skills: [
            ['Борщ', 'borsch', 'Классический борщ'],
            ['Щи', 'shchi', 'Русские щи'],
            ['Солянка', 'solyanka', 'Солянка'],
            ['Крем-супы', 'cream-soups', 'Супы-пюре'],
            ['Холодные супы', 'cold-soups', 'Окрошка, гаспачо'],
            ['Бульоны прозрачные', 'clear-broths', 'Консоме'],
            ['Лагман / Шурпа', 'lagman', 'Восточные супы'],
            ['Том ям и азиатские супы', 'asian-soups', 'Том-ям, фо, рамэн'],
          ]
        },
        {
          name: 'Гарниры, овощи, крупы', slug: 'sides', icon: '🥗', order: 7,
          skills: [
            ['Каши', 'porridge', 'Гречка, рис, овсянка'],
            ['Плов', 'pilaf', 'Узбекский, азербайджанский'],
            ['Ризотто', 'risotto', 'Итальянский рис'],
            ['Паста (приготовление)', 'pasta-cooking', 'Спагетти, паппарделле'],
            ['Гноки', 'gnocchi', 'Итальянские клёцки'],
            ['Картофель (все способы)', 'potato-dishes', 'Жареный, пюре, запечённый'],
            ['Овощи на гриле', 'grilled-vegetables', 'Гриль овощей'],
            ['Запечённые овощи', 'roasted-vegetables', 'В духовке'],
            ['Бобовые', 'legumes', 'Фасоль, нут, чечевица'],
          ]
        },
        {
          name: 'Салаты и закуски', slug: 'salads-appetizers', icon: '🥬', order: 8,
          skills: [
            ['Классические салаты', 'classic-salads', 'Цезарь, оливье, греческий'],
            ['Тёплые салаты', 'warm-salads', 'Тёплая подача'],
            ['Заправки и дрессинги', 'dressings', 'Соусы для салатов'],
            ['Закуски (тапас, антипасти)', 'appetizers', 'Холодные закуски'],
            ['Канапе и брускетты', 'canapes', 'Маленькие закуски'],
            ['Брускетты и тосты', 'bruschetta', 'Тосты с начинкой'],
            ['Намазки и дипы', 'dips-spreads', 'Хумус, гуакамоле'],
          ]
        },
        {
          name: 'Завтраки', slug: 'breakfast', icon: '🍳', order: 9,
          skills: [
            ['Яйца (все способы)', 'eggs', 'Омлеты, пашот, бенедикт'],
            ['Сырники и творожное', 'syrniki', 'Сырники, запеканки'],
            ['Блины и оладьи', 'pancakes', 'Блины, оладьи, панкейки'],
            ['Каши на завтрак', 'breakfast-porridge', 'Овсянка, гранола'],
            ['Тосты и сэндвичи', 'toasts', 'Авокадо-тост и др.'],
            ['Смузи и боулы', 'smoothie-bowls', 'Smoothie bowls'],
            ['Гранола и мюсли', 'granola', 'Домашняя гранола'],
          ]
        },
        {
          name: 'Ферментация и заготовки', slug: 'fermentation-preserves', icon: '🫙', order: 10,
          skills: [
            ['Квашение овощей', 'fermenting-vegetables', 'Квашеная капуста, кимчи'],
            ['Соление и маринование', 'pickling', 'Огурцы, грибы'],
            ['Консервация', 'canning', 'Заготовки на зиму'],
            ['Варенье и джемы', 'jam-making', 'Варенье, конфитюры'],
            ['Соусы домашние (заготовки)', 'homemade-sauces', 'Аджика, ткемали'],
            ['Закваски и хлебная закваска', 'starters', 'Натуральные закваски'],
            ['Комбуча', 'kombucha', 'Чайный гриб'],
            ['Сушка продуктов', 'food-drying', 'Сушка, дегидратор'],
            ['Заморозка продуктов', 'food-freezing', 'Правильная заморозка'],
          ]
        },
        {
          name: 'Молочное и сыры', slug: 'dairy-cheese', icon: '🧀', order: 11,
          skills: [
            ['Домашние сыры', 'homemade-cheese', 'Свежие сыры'],
            ['Творог домашний', 'homemade-curd', 'Творог дома'],
            ['Йогурт и кефир', 'yogurt-kefir', 'Домашние кисломолочные'],
            ['Сметана и крем-фреш', 'sour-cream', 'Кисломолочные сливки'],
            ['Сливочное масло', 'butter-making', 'Домашнее масло'],
            ['Сыроварение (выдержанные)', 'cheesemaking', 'Твёрдые и плесневые'],
          ]
        },
        {
          name: 'Напитки безалкогольные', slug: 'soft-drinks', icon: '🧃', order: 12,
          skills: [
            ['Лимонады домашние', 'lemonades', 'Домашние лимонады'],
            ['Морсы и компоты', 'kompots', 'Морсы, компоты'],
            ['Смузи', 'smoothies', 'Фруктовые, овощные'],
            ['Свежевыжатые соки', 'fresh-juices', 'Соки и фреши'],
            ['Молочные коктейли', 'milkshakes', 'Milkshake'],
            ['Какао и горячий шоколад', 'cocoa', 'Горячие напитки'],
            ['Квас домашний', 'kvass', 'Домашний квас'],
            ['Сбитень и иван-чай', 'sbiten', 'Традиционные русские'],
          ]
        },
        {
          name: 'Кофе', slug: 'coffee', icon: '☕', order: 13,
          skills: [
            ['Эспрессо и кофемашина', 'espresso', 'Эспрессо-кофеварка'],
            ['Латте-арт', 'latte-art', 'Рисунки на молоке'],
            ['Альтернатива (V60, Aeropress)', 'pour-over', 'Воронки, аэропресс'],
            ['Турка', 'turkish-coffee', 'Кофе в турке'],
            ['Френч-пресс', 'french-press', 'French press'],
            ['Обжарка кофе', 'coffee-roasting', 'Домашняя обжарка'],
            ['Бариста-навыки', 'barista', 'Профессия бариста'],
          ]
        },
        {
          name: 'Чай', slug: 'tea', icon: '🍵', order: 14,
          skills: [
            ['Чайная церемония (китайская)', 'gongfu-tea', 'Гунфу-ча'],
            ['Чайная церемония (японская)', 'japanese-tea', 'Тядо'],
            ['Знание сортов чая', 'tea-varieties', 'Пуэр, улун, зелёный и др.'],
            ['Матча', 'matcha', 'Японский порошковый чай'],
            ['Травяные сборы', 'herbal-teas', 'Травяные чаи'],
            ['Бабл-ти', 'bubble-tea', 'Тайваньский чай с тапиокой'],
          ]
        },
        {
          name: 'Алкоголь (приготовление)', slug: 'home-brewing', icon: '🍷', order: 15,
          skills: [
            ['Домашнее вино', 'homemade-wine', 'Винификация'],
            ['Пивоварение', 'homebrewing', 'Домашнее пиво'],
            ['Самогоноварение', 'distilling', 'Дистилляция'],
            ['Настойки и наливки', 'infusions', 'Алкогольные настойки'],
            ['Медоварение', 'mead-making', 'Медовуха'],
            ['Сидр', 'cider-making', 'Яблочный сидр'],
          ]
        },
        {
          name: 'Барное дело и коктейли', slug: 'bartending', icon: '🍸', order: 16,
          skills: [
            ['Классические коктейли', 'classic-cocktails', 'Маргарита, мохито, негрони'],
            ['Авторские коктейли', 'craft-cocktails', 'Свои рецепты'],
            ['Безалкогольные коктейли', 'mocktails', 'Мокктейли'],
            ['Флейринг', 'flair-bartending', 'Жонглирование бутылками'],
            ['Знание спиртных напитков', 'spirits-knowledge', 'Виски, ром, джин и др.'],
            ['Винная карта (сомелье)', 'sommelier', 'Сомелье'],
            ['Дегустация (вино, виски)', 'tasting', 'Дегустация'],
          ]
        },
        {
          name: 'Кухни мира', slug: 'world-cuisines', icon: '🌎', order: 17,
          skills: [
            ['Итальянская кухня', 'italian-cuisine', 'Паста, пицца, ризотто'],
            ['Французская кухня', 'french-cuisine', 'Классика гастрономии'],
            ['Испанская кухня', 'spanish-cuisine', 'Паэлья, тапас'],
            ['Греческая кухня', 'greek-cuisine', 'Сувлаки, мусака'],
            ['Японская кухня', 'japanese-cuisine', 'Суши, рамэн'],
            ['Суши и роллы', 'sushi-making', 'Сашими, нигири, роллы'],
            ['Китайская кухня', 'chinese-cuisine', 'Вок, дим-сам'],
            ['Корейская кухня', 'korean-cuisine', 'Кимчи, бибимбап'],
            ['Тайская кухня', 'thai-cuisine', 'Том-ям, пад-тай'],
            ['Вьетнамская кухня', 'vietnamese-cuisine', 'Фо, спринг-роллы'],
            ['Индийская кухня', 'indian-cuisine', 'Карри, тандури'],
            ['Ближневосточная кухня', 'middle-eastern-cuisine', 'Хумус, фалафель'],
            ['Турецкая кухня', 'turkish-cuisine', 'Кебаб, мезе'],
            ['Грузинская кухня', 'georgian-cuisine', 'Хачапури, хинкали'],
            ['Армянская кухня', 'armenian-cuisine', 'Долма, лаваш'],
            ['Узбекская кухня', 'uzbek-cuisine', 'Плов, лагман, манты'],
            ['Азербайджанская кухня', 'azerbaijani-cuisine', 'Долма, кутабы'],
            ['Русская кухня', 'russian-cuisine', 'Пельмени, борщ, блины'],
            ['Украинская кухня', 'ukrainian-cuisine', 'Вареники, борщ'],
            ['Мексиканская кухня', 'mexican-cuisine', 'Тако, гуакамоле'],
            ['Американская кухня', 'american-cuisine', 'Бургеры, BBQ'],
            ['Эфиопская кухня', 'ethiopian-cuisine', 'Инжера, ваты'],
          ]
        },
        {
          name: 'Спецдиеты и здоровое питание', slug: 'special-diets', icon: '🥦', order: 18,
          skills: [
            ['Вегетарианская кухня', 'vegetarian', 'Без мяса'],
            ['Веганская кухня', 'vegan', 'Без продуктов животного происхождения'],
            ['Сыроедение (raw)', 'raw-food', 'Сырые продукты'],
            ['Безглютеновая кухня', 'gluten-free', 'Без глютена'],
            ['Кето-кухня', 'keto-cooking', 'Низкоуглеводная'],
            ['Палео', 'paleo', 'Палеодиета'],
            ['Низкокалорийная', 'low-calorie', 'ПП-кухня'],
            ['ЗОЖ-кухня', 'healthy-cooking', 'Здоровое питание'],
            ['Детское питание', 'kids-food', 'Готовка для детей'],
            ['Диабетическая кухня', 'diabetic-cooking', 'Для диабетиков'],
          ]
        },
        {
          name: 'Подача и сервировка', slug: 'plating-serving', icon: '🍽️', order: 19,
          skills: [
            ['Подача блюд (плейтинг)', 'plating', 'Plating, food styling'],
            ['Food-фотография (стилизация)', 'food-styling', 'Стилизация для съёмок'],
            ['Сервировка стола', 'table-setting', 'Праздничная сервировка'],
            ['Карвинг (фигурная резка)', 'carving', 'Резьба по овощам и фруктам'],
            ['Меню-планирование', 'menu-planning', 'Составление меню'],
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
          name: 'Командные игровые', slug: 'team-sports', icon: '🏆', order: 1,
          skills: [
            ['Футбол', 'football', 'Классический футбол'],
            ['Мини-футбол / Футзал', 'futsal', 'Зальный футбол'],
            ['Пляжный футбол', 'beach-football', 'На песке'],
            ['Баскетбол', 'basketball', 'Классический баскетбол'],
            ['Стритбол / 3x3', 'streetball', 'Уличный баскетбол'],
            ['Волейбол', 'volleyball', 'Классический волейбол'],
            ['Пляжный волейбол', 'beach-volleyball', 'На песке'],
            ['Гандбол', 'handball', 'Ручной мяч'],
            ['Хоккей', 'hockey', 'Ледовый хоккей'],
            ['Хоккей с мячом', 'bandy', 'Бенди'],
            ['Хоккей на траве', 'field-hockey', 'Полевой хоккей'],
            ['Регби', 'rugby', 'Классическое регби'],
            ['Регби-7', 'rugby-7', 'Укороченный формат'],
            ['Американский футбол', 'american-football', 'NFL-формат'],
            ['Флорбол', 'floorball', 'Напольный хоккей'],
            ['Водное поло', 'water-polo', 'В бассейне'],
            ['Бейсбол', 'baseball', 'Американская классика'],
            ['Крикет', 'cricket', 'Британская классика'],
            ['Лакросс', 'lacrosse', 'С сеткой на клюшке'],
            ['Нетбол', 'netball', 'Женский баскетбол без щита'],
            ['Кёрлинг', 'curling', 'Ледовый кёрлинг'],
            ['Фрисби / Алтимейт', 'ultimate-frisbee', 'Диск'],
          ]
        },
        {
          name: 'Ракеточные и мячовые', slug: 'racket-sports', icon: '🎾', order: 2,
          skills: [
            ['Теннис', 'tennis', 'Большой теннис'],
            ['Настольный теннис', 'table-tennis', 'Пинг-понг'],
            ['Бадминтон', 'badminton', 'Воланчик'],
            ['Сквош', 'squash', 'Закрытый корт'],
            ['Падел', 'padel', 'Испанский теннис'],
            ['Пиклбол', 'pickleball', 'Растущий спорт'],
            ['Гольф', 'golf', 'Поле с лунками'],
            ['Боулинг', 'bowling', 'Кегельбан'],
            ['Бильярд', 'billiards', 'Классический'],
            ['Снукер', 'snooker', 'Британский бильярд'],
            ['Пул', 'pool-billiards', 'Американский бильярд'],
            ['Петанк', 'petanque', 'Французские шары'],
          ]
        },
        {
          name: 'Единоборства ударные', slug: 'striking-arts', icon: '🥊', order: 3,
          skills: [
            ['Бокс', 'boxing', 'Классический бокс'],
            ['Кикбоксинг', 'kickboxing', 'Удары руками и ногами'],
            ['Муай-тай', 'muay-thai', 'Тайский бокс'],
            ['Карате', 'karate', 'Традиционное каратэ'],
            ['Каратэ Кёкусинкай', 'kyokushin', 'Контактное каратэ'],
            ['Тхэквондо', 'taekwondo', 'Корейские удары'],
            ['Ушу (ударное)', 'wushu-striking', 'Саньда, ушу'],
            ['Кунг-фу', 'kung-fu', 'Китайское боевое искусство'],
            ['Савате', 'savate', 'Французский бокс'],
            ['Кадаф / Капоэйра', 'capoeira', 'Бразильская капоэйра'],
          ]
        },
        {
          name: 'Единоборства борцовские', slug: 'grappling-arts', icon: '🤼', order: 4,
          skills: [
            ['Дзюдо', 'judo', 'Японская борьба'],
            ['Самбо', 'sambo', 'Советское боевое самбо'],
            ['Греко-римская борьба', 'greco-roman', 'Олимпийская борьба'],
            ['Вольная борьба', 'freestyle-wrestling', 'Вольная'],
            ['Бразильское джиу-джитсу (BJJ)', 'bjj', 'Грэпплинг'],
            ['Джиу-джитсу (японское)', 'jujutsu', 'Традиционное'],
            ['Айкидо', 'aikido', 'Японское боевое'],
            ['Сумо', 'sumo', 'Японская борьба'],
            ['Пехлеван / Куреш', 'kurash', 'Среднеазиатская борьба'],
            ['Грэпплинг', 'grappling', 'Без ударов'],
          ]
        },
        {
          name: 'Смешанные и комплексные единоборства', slug: 'mma', icon: '🥋', order: 5,
          skills: [
            ['MMA', 'mma', 'Смешанные единоборства'],
            ['Нинзюцу', 'ninjutsu', 'Ниндзя-искусство'],
            ['Крав-мага', 'krav-maga', 'Израильская система'],
            ['Systema', 'systema', 'Русская система'],
            ['Hapkido', 'hapkido', 'Корейское'],
            ['Пенчак-силат', 'silat', 'Малайское'],
          ]
        },
        {
          name: 'Лёгкая атлетика', slug: 'athletics', icon: '🏃', order: 6,
          skills: [
            ['Бег (спринт)', 'sprinting', '100м, 200м, 400м'],
            ['Бег на средние дистанции', 'middle-distance', '800м, 1500м'],
            ['Бег на длинные дистанции', 'long-distance-running', '5км, 10км'],
            ['Марафон', 'marathon', '42.195км'],
            ['Полумарафон', 'half-marathon', '21км'],
            ['Бег с препятствиями', 'obstacle-running', 'Spartan, OCR'],
            ['Прыжки в высоту', 'high-jump', 'Прыжок в высоту'],
            ['Прыжки в длину', 'long-jump', 'Прыжок в длину'],
            ['Прыжки с шестом', 'pole-vault', 'Шест'],
            ['Тройной прыжок', 'triple-jump', 'Тройной'],
            ['Толкание ядра', 'shot-put', 'Метание ядра'],
            ['Метание диска', 'discus', 'Диск'],
            ['Метание копья', 'javelin', 'Копьё'],
            ['Метание молота', 'hammer-throw', 'Молот'],
            ['Спортивная ходьба', 'race-walking', 'Ходьба'],
            ['Десятиборье', 'decathlon', 'Многоборье'],
            ['Кросс', 'cross-country', 'Бег по пересечённой местности'],
          ]
        },
        {
          name: 'Фитнес и тренировки', slug: 'fitness', icon: '💪', order: 7,
          skills: [
            ['Силовые тренировки', 'strength-training', 'Тренажёрный зал'],
            ['Пауэрлифтинг', 'powerlifting', 'Жим, приседание, становая'],
            ['Тяжёлая атлетика', 'weightlifting', 'Рывок, толчок'],
            ['Гиревой спорт', 'kettlebell-sport', 'Гири'],
            ['Бодибилдинг', 'bodybuilding', 'Массонабор, сушка'],
            ['Кроссфит', 'crossfit', 'Функциональный фитнес'],
            ['Калистеника', 'calisthenics', 'Вес собственного тела'],
            ['Воркаут', 'workout', 'Уличные тренировки'],
            ['Функциональный тренинг', 'functional-training', 'Функциональные движения'],
            ['TRX', 'trx', 'Петлевой тренинг'],
            ['Аэробика', 'aerobics', 'Классическая аэробика'],
            ['Степ-аэробика', 'step-aerobics', 'Степ'],
            ['Зумба', 'zumba', 'Танцевальный фитнес'],
            ['Табата', 'tabata', 'Интервальный тренинг'],
            ['HIIT', 'hiit', 'Высокоинтенсивный интервальный'],
            ['Стретчинг', 'stretching', 'Растяжка'],
            ['Фасциальный фитнес', 'fascial-fitness', 'Работа с фасциями'],
            ['Плиометрика', 'plyometrics', 'Взрывная сила'],
          ]
        },
        {
          name: 'Йога и восточные практики', slug: 'yoga-eastern', icon: '🧘', order: 8,
          skills: [
            ['Хатха-йога', 'hatha-yoga', 'Классическая йога'],
            ['Виньяса-йога', 'vinyasa-yoga', 'Поточная йога'],
            ['Аштанга-йога', 'ashtanga-yoga', 'Динамичная система'],
            ['Кундалини-йога', 'kundalini-yoga', 'Энергетическая'],
            ['Инь-йога', 'yin-yoga', 'Медленная, глубокая'],
            ['Акро-йога', 'acro-yoga', 'Парная акробатическая'],
            ['Пилатес', 'pilates', 'Работа с корпусом'],
            ['Тайцзи (тай-чи)', 'tai-chi', 'Китайская практика'],
            ['Цигун', 'qigong', 'Энергетические практики'],
            ['Капоэйра', 'capoeira-practice', 'Движение и практика'],
          ]
        },
        {
          name: 'Водные виды', slug: 'water-sports', icon: '🏊', order: 9,
          skills: [
            ['Плавание', 'swimming', 'Все стили'],
            ['Плавание (кроль)', 'freestyle-swimming', 'Вольный стиль'],
            ['Плавание (баттерфляй)', 'butterfly-swimming', 'Баттерфляй'],
            ['Плавание (брасс)', 'breaststroke', 'Брасс'],
            ['Плавание (на спине)', 'backstroke', 'На спине'],
            ['Синхронное плавание', 'synchronized-swimming', 'Артистическое'],
            ['Прыжки в воду', 'diving', 'С вышки и трамплина'],
            ['Водные прыжки (фридайвинг)', 'freediving', 'Фридайвинг'],
            ['Дайвинг (с аквалангом)', 'scuba-diving', 'PADI, CMAS'],
            ['Триатлон', 'triathlon', 'Плавание+вело+бег'],
            ['Серфинг', 'surfing', 'Морские волны'],
            ['Виндсёрфинг', 'windsurfing', 'Парус и доска'],
            ['Кайтсёрфинг', 'kitesurfing', 'Кайт'],
            ['Вейкбординг', 'wakeboarding', 'За катером'],
            ['Каноэ / Байдарка', 'kayaking', 'Гребля'],
            ['Гребля (академическая)', 'rowing', 'Академическая'],
            ['Рафтинг', 'rafting', 'Горные реки'],
            ['Паддлборд (SUP)', 'sup', 'Stand up paddle'],
          ]
        },
        {
          name: 'Зимние виды', slug: 'winter-sports', icon: '⛷️', order: 10,
          skills: [
            ['Горные лыжи', 'alpine-skiing', 'Горнолыжный спорт'],
            ['Беговые лыжи', 'cross-country-skiing', 'Лыжные гонки'],
            ['Биатлон', 'biathlon', 'Лыжи + стрельба'],
            ['Сноуборд', 'snowboarding', 'Снежная доска'],
            ['Фристайл (лыжи)', 'freestyle-skiing', 'Могул, хаф-пайп'],
            ['Прыжки с трамплина', 'ski-jumping', 'Лыжные прыжки'],
            ['Фигурное катание', 'figure-skating', 'Лёд'],
            ['Скоростной бег на коньках', 'speed-skating', 'Конькобежный спорт'],
            ['Шорт-трек', 'short-track', 'Короткая дорожка'],
            ['Бобслей', 'bobsled', 'Бобслей'],
            ['Скелетон', 'skeleton', 'Скелетон'],
            ['Санный спорт', 'luge', 'Сани'],
            ['Ски-альпинизм', 'ski-mountaineering', 'Лыжный альпинизм'],
            ['Снегоступы', 'snowshoeing', 'Ходьба по снегу'],
            ['Айс-дайвинг', 'ice-diving', 'Подлёдный дайвинг'],
          ]
        },
        {
          name: 'Велоспорт', slug: 'cycling', icon: '🚴', order: 11,
          skills: [
            ['Шоссейный велоспорт', 'road-cycling', 'Гонки по шоссе'],
            ['Горный велосипед (MTB)', 'mountain-biking', 'Трейлы, даунхилл'],
            ['BMX', 'bmx', 'Трюки и гонки'],
            ['Трековый велоспорт', 'track-cycling', 'Велотрек'],
            ['Велотриал', 'bike-trial', 'Техническое мастерство'],
            ['Циклокросс', 'cyclocross', 'Бездорожье'],
            ['Велотуризм', 'bicycle-touring', 'Дальние поездки'],
            ['Фиксед-гир', 'fixie', 'Фиксированная передача'],
          ]
        },
        {
          name: 'Конный спорт', slug: 'equestrian', icon: '🐎', order: 12,
          skills: [
            ['Верховая езда', 'horse-riding', 'Общая верховая'],
            ['Выездка', 'dressage', 'Классическая выездка'],
            ['Конкур', 'show-jumping', 'Прыжки на лошади'],
            ['Троеборье', 'eventing', 'Троеборье'],
            ['Поло', 'polo', 'Конное поло'],
            ['Скачки', 'horse-racing', 'Гоночный спорт'],
            ['Вольтижировка', 'vaulting', 'Акробатика на лошади'],
          ]
        },
        {
          name: 'Стрелковый спорт', slug: 'shooting-sports', icon: '🎯', order: 13,
          skills: [
            ['Стрельба из лука', 'archery', 'Лук и стрелы'],
            ['Блочный лук', 'compound-bow', 'Блочный'],
            ['Пулевая стрельба', 'target-shooting', 'Огнестрельное оружие'],
            ['Стендовая стрельба', 'clay-shooting', 'По тарелочкам'],
            ['Практическая стрельба', 'practical-shooting', 'IPSC'],
            ['Пейнтбол', 'paintball', 'Командная игра'],
            ['Страйкбол', 'airsoft', 'Тактические игры'],
            ['Дартс', 'darts', 'Метание дротиков'],
          ]
        },
        {
          name: 'Экстрим и приключения', slug: 'extreme-sports', icon: '🪂', order: 14,
          skills: [
            ['Скалолазание', 'rock-climbing', 'Спортивное скалолазание'],
            ['Боулдеринг', 'bouldering', 'Без верёвки'],
            ['Альпинизм', 'mountaineering', 'Горовосхождение'],
            ['Паркур', 'parkour', 'Городское движение'],
            ['Фриран', 'freerunning', 'Акробатика + паркур'],
            ['Скейтбординг', 'skateboarding', 'Доска и трюки'],
            ['Лонгборд', 'longboard', 'Длинная доска'],
            ['Роликовые коньки', 'rollerblade', 'Ролики'],
            ['Агрессивные ролики', 'aggressive-inline', 'Трюки на роликах'],
            ['Самокат (трюки)', 'scooter-tricks', 'Спортивный самокат'],
            ['Прыжки с парашютом', 'skydiving', 'Парашютный спорт'],
            ['Вингсьют', 'wingsuit', 'Полёт в костюме'],
            ['Банджи-джампинг', 'bungee-jumping', 'Прыжки на резинке'],
            ['Слэклайн', 'slacklining', 'Хождение по ленте'],
            ['Хайлайн', 'highlining', 'Над пропастью'],
            ['Трейлраннинг', 'trail-running', 'Бег по горам'],
            ['Трекинг', 'trekking', 'Пешие походы'],
            ['Мотокросс', 'motocross', 'Кросс на мото'],
          ]
        },
        {
          name: 'Гимнастика и акробатика', slug: 'gymnastics', icon: '🤸', order: 15,
          skills: [
            ['Спортивная гимнастика', 'artistic-gymnastics', 'Снаряды'],
            ['Художественная гимнастика', 'rhythmic-gymnastics', 'Лента, обруч'],
            ['Акробатика', 'acrobatics', 'Трюки, стойки'],
            ['Акробатический рок-н-ролл', 'acro-rock', 'Парная акробатика'],
            ['Прыжки на батуте', 'trampolining', 'Батут'],
            ['Черлидинг', 'cheerleading', 'Поддержка команды'],
            ['Воздушная гимнастика', 'aerial-gymnastics', 'Полотна, кольцо, трапеция'],
            ['Воздушное полотно', 'aerial-silks', 'Цирковое полотно'],
            ['Воздушное кольцо', 'aerial-hoop', 'Лира'],
            ['Пилон (pole sport)', 'pole-sport', 'Спортивный пилон'],
          ]
        },
        {
          name: 'Танцевальный спорт', slug: 'dance-sports', icon: '💃', order: 16,
          skills: [
            ['Спортивные бальные танцы', 'ballroom-dancing', 'Стандарт и латина'],
            ['Брейк-данс (Breaking)', 'breakdancing', 'Олимпийский вид'],
            ['Капоэйра', 'capoeira-dance', 'Боевой танец'],
          ]
        },
        {
          name: 'Интеллектуальный спорт', slug: 'mind-sports', icon: '♟️', order: 17,
          skills: [
            ['Шахматы', 'chess', 'Классические шахматы'],
            ['Шашки', 'checkers', 'Классические шашки'],
            ['Го (игра)', 'go-game', 'Японская стратегия'],
            ['Нарды', 'backgammon', 'Длинные и короткие нарды'],
            ['Маджонг', 'mahjong', 'Китайская игра'],
            ['Спортивный покер', 'poker-sport', 'Покер как спорт'],
            ['Спортивное ориентирование', 'orienteering', 'Карта и компас'],
          ]
        },
        {
          name: 'Киберспорт', slug: 'esports', icon: '🎮', order: 18,
          skills: [
            ['CS2 / CS:GO', 'cs2', 'Тактический шутер'],
            ['Dota 2', 'dota2', 'MOBA'],
            ['League of Legends', 'lol', 'MOBA'],
            ['Valorant', 'valorant', 'Тактический шутер'],
            ['Apex Legends', 'apex', 'Батл-рояль'],
            ['Fortnite', 'fortnite', 'Батл-рояль'],
            ['StarCraft II', 'sc2', 'Стратегия'],
            ['Hearthstone', 'hearthstone', 'Карточная игра'],
            ['FIFA / FC', 'fifa', 'Футбольный симулятор'],
            ['Rocket League', 'rocket-league', 'Авто-футбол'],
            ['Overwatch', 'overwatch', 'Командный шутер'],
            ['PUBG', 'pubg', 'Батл-рояль'],
            ['Street Fighter / Fighting', 'fighting-games', 'Файтинги'],
            ['Speedrunning', 'speedrunning', 'Быстрое прохождение'],
          ]
        },
        {
          name: 'Тренерство и судейство', slug: 'coaching-refereeing', icon: '📋', order: 19,
          skills: [
            ['Тренерство (общее)', 'sports-coaching', 'Тренер по спорту'],
            ['Персональный тренер (фитнес)', 'personal-trainer', 'PT'],
            ['Судейство', 'refereeing', 'Арбитр в спорте'],
            ['Спортивное питание (знание)', 'sports-nutrition', 'Диета атлета'],
            ['Спортивная психология', 'sports-psychology', 'Ментальная подготовка'],
            ['Физическая реабилитация', 'sports-rehab', 'Восстановление'],
            ['Составление программ тренировок', 'training-programs', 'Программирование'],
            ['Видеоанализ игры', 'game-analysis', 'Разбор матчей'],
          ]
        },
      ]
    },

    // ==========================================
    // 📸 МЕДИА
    // ==========================================
    {
      name: 'Медиа', slug: 'media', icon: '📺', order: 7,
      subs: [
        {
          name: 'Фотография', slug: 'photography', icon: '📷', order: 1,
          skills: [
            ['Портретная фотография', 'portrait-photo', 'Студийные и выездные портреты'],
            ['Свадебная фотография', 'wedding-photo', 'Свадебная съёмка'],
            ['Семейная фотография', 'family-photo', 'Семейные фотосессии'],
            ['Детская фотография', 'kids-photo', 'Newborn, дети'],
            ['Репортажная фотография', 'reportage-photo', 'События, мероприятия'],
            ['Стрит-фотография', 'street-photo', 'Уличная съёмка'],
            ['Документальная фотография', 'documentary-photo', 'Документалистика'],
            ['Тревел-фотография', 'travel-photo', 'Путешествия'],
            ['Пейзажная фотография', 'landscape-photo', 'Природа, ландшафты'],
            ['Архитектурная фотография', 'architecture-photo', 'Здания, интерьеры'],
            ['Интерьерная съёмка', 'interior-photo', 'Для каталогов, риелторов'],
            ['Предметная съёмка', 'product-photo', 'Товары, e-commerce'],
            ['Food-фотография', 'food-photo', 'Еда и напитки'],
            ['Fashion-фотография', 'fashion-photo', 'Мода, lookbook'],
            ['Бьюти-съёмка', 'beauty-photo', 'Макро лица, косметика'],
            ['Будуарная фотография', 'boudoir-photo', 'Чувственная съёмка'],
            ['Ню-фотография', 'nude-photo', 'Художественное обнажённое'],
            ['Спортивная фотография', 'sports-photo', 'Динамика, спорт'],
            ['Концертная съёмка', 'concert-photo', 'Сцена, музыканты'],
            ['Аэрофотосъёмка (с дрона)', 'aerial-photo', 'Drone photography'],
            ['Макросъёмка', 'macro-photo', 'Крупный план'],
            ['Астрофотография', 'astrophotography', 'Звёздное небо'],
            ['Подводная съёмка', 'underwater-photo', 'Дайвинг + фото'],
            ['Чёрно-белая фотография', 'bw-photo', 'B&W'],
            ['Плёночная фотография', 'film-photography', 'Аналоговая фото'],
            ['Полароид и моментальная', 'instant-photo', 'Polaroid, Instax'],
          ]
        },
        {
          name: 'Обработка фото', slug: 'photo-editing', icon: '🎨', order: 2,
          skills: [
            ['Adobe Lightroom', 'lightroom', 'Базовая обработка, цвет'],
            ['Adobe Photoshop (ретушь)', 'photoshop-retouch', 'Глубокая ретушь'],
            ['Capture One', 'capture-one', 'Профессиональная обработка'],
            ['Бьюти-ретушь', 'beauty-retouch', 'Кожа, лицо, dodge & burn'],
            ['Цветокоррекция фото', 'photo-color-grading', 'Цветовая стилизация'],
            ['Коллажи и арт', 'photo-collage', 'Композитинг'],
            ['Реставрация старых фото', 'photo-restoration', 'Восстановление'],
            ['Удаление фона', 'background-removal', 'Маскирование, вырезка'],
            ['Пресеты и LUTs', 'presets', 'Создание пресетов'],
            ['Мобильная обработка', 'mobile-photo-editing', 'Snapseed, VSCO'],
            ['AI-обработка фото', 'ai-photo', 'Topaz, Luminar, нейросети'],
          ]
        },
        {
          name: 'Видеосъёмка', slug: 'videography', icon: '🎥', order: 3,
          skills: [
            ['Свадебная видеосъёмка', 'wedding-video', 'Свадебное видео'],
            ['Корпоративное видео', 'corporate-video', 'Промо компаний'],
            ['Рекламное видео', 'commercial-video', 'Реклама, ТВ-ролики'],
            ['Музыкальные клипы', 'music-videos', 'Клипы'],
            ['Документальное видео', 'documentary-video', 'Документалистика'],
            ['Короткометражки', 'short-films', 'Короткий метр'],
            ['Кинопроизводство', 'filmmaking', 'Полный метр'],
            ['Репортажная съёмка', 'reportage-video', 'События'],
            ['Видеоблог (vlog)', 'vlogging', 'Влоги'],
            ['Travel-видео', 'travel-video', 'Путешествия'],
            ['Спортивное видео', 'sports-video', 'Action, экстрим'],
            ['Съёмка с дрона', 'drone-video', 'Аэровидео'],
            ['Подводная видеосъёмка', 'underwater-video', 'Подводное видео'],
            ['Гимбал-операторство', 'gimbal-operator', 'Стабилизаторы'],
            ['Стедикам', 'steadicam', 'Стедикам'],
            ['Multicam-съёмка', 'multicam', 'Многокамерная съёмка'],
            ['Slow-motion и high-speed', 'slow-motion', 'Высокоскоростная съёмка'],
            ['Тайм-лапс и гипер-лапс', 'timelapse', 'Time-lapse'],
            ['Стоп-моушн', 'stop-motion', 'Покадровая анимация'],
            ['Работа со светом (видео)', 'video-lighting', 'Свет на площадке'],
            ['Работа с камерой (cinema)', 'cinema-camera', 'RED, ARRI, Blackmagic'],
          ]
        },
        {
          name: 'Монтаж и постпродакшн', slug: 'video-editing', icon: '✂️', order: 4,
          skills: [
            ['Adobe Premiere Pro', 'premiere-pro', 'Монтаж в Premiere'],
            ['DaVinci Resolve', 'davinci-resolve', 'Монтаж и цвет'],
            ['Final Cut Pro', 'final-cut', 'Apple FCP'],
            ['Avid Media Composer', 'avid', 'Профессиональный монтаж'],
            ['CapCut', 'capcut', 'Мобильный/десктоп монтаж'],
            ['Цветокоррекция видео', 'video-color-grading', 'Color grading'],
            ['Моушн-дизайн', 'motion-design', 'Motion graphics'],
            ['Adobe After Effects', 'after-effects', 'AE, композитинг'],
            ['VFX (визуальные эффекты)', 'vfx', 'Спецэффекты'],
            ['Композитинг (Nuke)', 'nuke-compositing', 'Nuke, Fusion'],
            ['Rotoscoping', 'rotoscoping', 'Рото-маски'],
            ['Хромакей и кеинг', 'chroma-key', 'Зелёный фон'],
            ['3D-трекинг и матчмувинг', 'matchmoving', '3D-трекинг'],
            ['Титры и графика', 'titles-graphics', 'Тайтлы и нижние плашки'],
            ['Субтитры и локализация', 'subtitles', 'Субтитры и перевод'],
            ['Мобильный видеомонтаж', 'mobile-video-editing', 'CapCut, InShot'],
            ['Монтаж Reels / Shorts / TikTok', 'short-video-editing', 'Вертикальный монтаж'],
          ]
        },
        {
          name: 'Звук и аудиопродакшн', slug: 'audio-production', icon: '🎙️', order: 5,
          skills: [
            ['Звукорежиссура', 'sound-engineering', 'Sound engineer'],
            ['Запись звука на площадке', 'production-sound', 'Live sound recording'],
            ['Запись подкастов', 'podcast-recording', 'Запись podcast'],
            ['Запись вокала', 'vocal-recording', 'Студийная запись вокала'],
            ['Запись инструментов', 'instrument-recording', 'Запись live-инструментов'],
            ['Сведение (mixing)', 'audio-mixing', 'Mix engineer'],
            ['Мастеринг', 'audio-mastering', 'Mastering engineer'],
            ['Звуковой дизайн', 'sound-design', 'Sound design для видео/игр'],
            ['Foley (шумовое озвучание)', 'foley', 'Foley artist'],
            ['Реставрация аудио', 'audio-restoration', 'Чистка, шумоподавление'],
            ['Озвучка (дубляж)', 'voice-acting', 'Голос за кадром, дубляж'],
            ['Дикторская работа', 'voice-over', 'Voice-over'],
            ['Постановка голоса', 'voice-coaching', 'Работа с речью'],
            ['Adobe Audition', 'audition', 'AU'],
            ['Pro Tools', 'pro-tools', 'Pro Tools'],
            ['Logic Pro', 'logic-pro', 'Logic'],
            ['Ableton Live', 'ableton', 'Ableton'],
            ['Reaper', 'reaper', 'REAPER DAW'],
          ]
        },
        {
          name: 'Сценарий и режиссура', slug: 'directing-writing', icon: '🎬', order: 6,
          skills: [
            ['Сценарное мастерство', 'screenwriting', 'Сценарии'],
            ['Сторителлинг', 'storytelling', 'Истории и нарратив'],
            ['Режиссура', 'directing', 'Режиссура фильма'],
            ['Режиссура монтажа', 'editing-directing', 'Editor as director'],
            ['Продюсирование', 'producing', 'Producer'],
            ['Кастинг', 'casting', 'Подбор актёров'],
            ['Раскадровка (storyboarding)', 'storyboarding', 'Storyboards'],
            ['Локейшн-менеджмент', 'location-scouting', 'Поиск локаций'],
            ['Художник-постановщик', 'production-design', 'Production design'],
            ['Костюмер', 'costume-design', 'Костюмы для кино'],
            ['Реквизит', 'props', 'Реквизитор'],
            ['Грим (кино)', 'film-makeup', 'Грим для кино, спецэффекты'],
          ]
        },
        {
          name: 'Подкастинг', slug: 'podcasting', icon: '🎧', order: 7,
          skills: [
            ['Запуск подкаста', 'launching-podcast', 'Концепция и старт'],
            ['Ведение подкаста', 'podcast-hosting', 'Хост подкаста'],
            ['Интервьюирование (подкаст)', 'podcast-interviewing', 'Интервью гостей'],
            ['Монтаж подкастов', 'podcast-editing', 'Постпродакшн'],
            ['Дистрибуция подкаста', 'podcast-distribution', 'RSS, платформы'],
            ['Сценарии для подкастов', 'podcast-scripting', 'Структура выпусков'],
            ['Видеоподкаст', 'video-podcast', 'YouTube-формат'],
          ]
        },
        {
          name: 'Стриминг и live-вещание', slug: 'streaming', icon: '🔴', order: 8,
          skills: [
            ['Twitch-стриминг', 'twitch-streaming', 'Стримы на Twitch'],
            ['YouTube Live', 'youtube-live', 'Прямые эфиры YouTube'],
            ['Kick и альтернативные платформы', 'kick-streaming', 'Kick, Trovo и др.'],
            ['Игровые стримы', 'gaming-streams', 'Геймплей'],
            ['IRL-стримы', 'irl-streaming', 'Real life стримы'],
            ['Just chatting', 'just-chatting', 'Разговорные стримы'],
            ['OBS Studio', 'obs', 'OBS, vMix'],
            ['Стрим-дизайн (overlays)', 'stream-design', 'Оверлеи, алерты'],
            ['Модерация чата', 'chat-moderation', 'Twitch/YT модерация'],
            ['Прямые трансляции мероприятий', 'event-live-streaming', 'Live events'],
          ]
        },
        {
          name: 'Блогинг и контент', slug: 'blogging-content', icon: '✍️', order: 9,
          skills: [
            ['Ведение блога (текст)', 'text-blogging', 'Письменный блог'],
            ['Instagram-блогинг', 'instagram-blogging', 'Контент в Instagram'],
            ['TikTok-блогинг', 'tiktok-blogging', 'Короткие видео'],
            ['YouTube-блогинг', 'youtube-blogging', 'YouTube-канал'],
            ['Telegram-канал', 'telegram-blogging', 'Авторский канал'],
            ['Twitter / X блогинг', 'twitter-blogging', 'Шорт-форма'],
            ['LinkedIn-контент', 'linkedin-content', 'Профессиональный контент'],
            ['Reels и Shorts', 'reels-shorts', 'Короткие видео всех платформ'],
            ['Контент-планирование', 'content-planning', 'Контент-план'],
            ['Сценарии для Reels/Shorts', 'short-video-scripting', 'Сценарии коротких'],
            ['Личный бренд', 'personal-branding', 'Building personal brand'],
            ['Монетизация блога', 'blog-monetization', 'Партнёрки, рекламные интеграции'],
            ['Работа с рекламодателями', 'brand-deals', 'Brand deals, медиа-кит'],
          ]
        },
        {
          name: 'SMM и соцсети', slug: 'smm', icon: '📱', order: 10,
          skills: [
            ['SMM-стратегия', 'smm-strategy', 'Стратегия в соцсетях'],
            ['Ведение Instagram', 'instagram-management', 'Бизнес-аккаунты'],
            ['Ведение TikTok', 'tiktok-management', 'TikTok для брендов'],
            ['Ведение Telegram', 'telegram-management', 'Каналы и чаты'],
            ['Ведение VK', 'vk-management', 'ВКонтакте'],
            ['Ведение YouTube-канала', 'youtube-management', 'YouTube для брендов'],
            ['Ведение LinkedIn', 'linkedin-management', 'B2B соцсети'],
            ['Контент-маркетинг', 'content-marketing', 'Content marketing'],
            ['Комьюнити-менеджмент', 'community-management', 'Управление сообществом'],
            ['Аналитика соцсетей', 'social-media-analytics', 'Метрики, отчёты'],
            ['Таргетированная реклама', 'targeted-ads', 'Таргет в соцсетях'],
            ['Работа с инфлюенсерами', 'influencer-marketing', 'Influencer marketing'],
            ['Чат-боты и автоворонки', 'chatbots-smm', 'Боты в SMM'],
            ['Карусели и инфографика', 'carousel-design', 'Дизайн постов'],
          ]
        },
        {
          name: 'Журналистика', slug: 'journalism', icon: '📰', order: 11,
          skills: [
            ['Новостная журналистика', 'news-journalism', 'Новости'],
            ['Расследовательская журналистика', 'investigative-journalism', 'Расследования'],
            ['Деловая журналистика', 'business-journalism', 'Бизнес и экономика'],
            ['Спортивная журналистика', 'sports-journalism', 'Спорт'],
            ['Культурная журналистика', 'culture-journalism', 'Культура, искусство'],
            ['Научная журналистика', 'science-journalism', 'Наука и популяризация'],
            ['Военная журналистика', 'war-journalism', 'Военкоры'],
            ['Тревел-журналистика', 'travel-journalism', 'Путешествия'],
            ['Фотожурналистика', 'photojournalism', 'Документальное фото'],
            ['Видеожурналистика', 'video-journalism', 'Video reporting'],
            ['Интервьюирование', 'interviewing', 'Брать интервью'],
            ['Репортаж', 'reporting', 'Жанр репортажа'],
            ['Аналитическая статья', 'feature-writing', 'Лонгриды, аналитика'],
            ['Колумнистика', 'column-writing', 'Авторские колонки'],
            ['Fact-checking', 'fact-checking', 'Проверка фактов'],
            ['OSINT-журналистика', 'osint-journalism', 'Bellingcat-стиль'],
            ['Этика журналиста', 'journalism-ethics', 'Профэтика'],
          ]
        },
        {
          name: 'Радио и ТВ', slug: 'radio-tv', icon: '📻', order: 12,
          skills: [
            ['Радиоведение', 'radio-hosting', 'Радиоведущий'],
            ['Диджеинг (радио)', 'radio-dj', 'Radio DJ'],
            ['Телеведение', 'tv-hosting', 'ТВ-ведущий'],
            ['Закадровый голос (ТВ)', 'tv-voice-over', 'ТВ-озвучка'],
            ['Работа в кадре', 'on-camera-skills', 'Поведение перед камерой'],
            ['Импровизация в эфире', 'live-improvisation', 'Импровизация'],
            ['Модерация ток-шоу', 'talk-show-hosting', 'Talk-show'],
            ['Работа с телесуфлёром', 'teleprompter', 'Teleprompter'],
          ]
        },
        {
          name: 'Графика и оформление медиа', slug: 'media-graphics', icon: '🖼️', order: 13,
          skills: [
            ['Дизайн thumbnail (YouTube)', 'youtube-thumbnails', 'Превью для YouTube'],
            ['Обложки подкастов', 'podcast-covers', 'Cover art подкаста'],
            ['Обложки альбомов', 'album-covers', 'Cover art музыки'],
            ['Постер-дизайн', 'poster-design', 'Постеры кино, событий'],
            ['Постеры фильмов', 'movie-posters', 'Movie posters'],
            ['Анимированные превью', 'animated-previews', 'GIF / motion'],
          ]
        },
        {
          name: 'Технические навыки медиа', slug: 'media-tech', icon: '🛠️', order: 14,
          skills: [
            ['Работа со светом (фото/видео)', 'lighting', 'Студийный и выездной свет'],
            ['Оборудование (камеры)', 'camera-equipment', 'Знание техники'],
            ['Студийная съёмка', 'studio-shooting', 'Работа в студии'],
            ['Подбор оптики', 'lens-knowledge', 'Объективы'],
            ['Цветовые профили и калибровка', 'color-management', 'ICC, мониторы'],
            ['Архивирование медиа', 'media-archiving', 'Хранение, бэкапы'],
            ['DAM (Digital Asset Management)', 'dam', 'Управление архивами'],
          ]
        },
      ]
    },

    // ==========================================
    // 🌿 LIFESTYLE
    // ==========================================
    {
      name: 'Lifestyle', slug: 'lifestyle', icon: '✨', order: 8,
      subs: [
        {
          name: 'Мода и стиль', slug: 'fashion-style', icon: '👗', order: 1,
          skills: [
            ['Личный стиль', 'personal-style', 'Создание своего образа'],
            ['Капсульный гардероб', 'capsule-wardrobe', 'Капсула'],
            ['Подбор одежды по типу фигуры', 'body-type-styling', 'Стилизация под фигуру'],
            ['Цветотип и колористика гардероба', 'color-analysis', 'Цветотипы'],
            ['Стилистика (как стилист)', 'styling', 'Работа стилиста'],
            ['Шопинг-сопровождение', 'personal-shopping', 'Personal shopper'],
            ['Винтаж и second-hand', 'vintage-fashion', 'Винтажная мода'],
            ['Стрит-стайл', 'streetwear', 'Уличный стиль'],
            ['Деловой стиль', 'business-attire', 'Бизнес-дресс-код'],
            ['Вечерний стиль', 'evening-style', 'Вечерние образы'],
            ['Sustainable fashion', 'sustainable-fashion', 'Осознанная мода'],
            ['Подбор аксессуаров', 'accessorizing', 'Аксессуары'],
            ['Знание брендов и истории моды', 'fashion-knowledge', 'Эрудиция в моде'],
            ['Тренды и инфлюенс', 'fashion-trends', 'Следить за модой'],
          ]
        },
        {
          name: 'Красота и уход', slug: 'beauty-care', icon: '💄', order: 2,
          skills: [
            ['Уход за кожей (skincare)', 'skincare', 'Уход за лицом'],
            ['Корейский уход', 'korean-skincare', 'K-beauty'],
            ['Уход за телом', 'body-care', 'Скрабы, кремы, ритуалы'],
            ['Уход за волосами', 'hair-care', 'Восстановление, маски'],
            ['Укладка волос (самостоятельно)', 'hair-styling-self', 'Укладки дома'],
            ['Окрашивание дома', 'home-hair-coloring', 'Краска и тонирование'],
            ['Дневной макияж', 'daily-makeup', 'Повседневный мейк'],
            ['Вечерний макияж', 'evening-makeup', 'Вечерний мейк'],
            ['Свадебный макияж (себе)', 'wedding-makeup', 'Невеста'],
            ['Брови (уход самостоятельно)', 'brow-care', 'Свои брови'],
            ['Ресницы (наращивание, ламинирование — знание)', 'lash-knowledge', 'Знание процедур'],
            ['Маникюр (себе)', 'self-manicure', 'Свои ногти'],
            ['Педикюр (себе)', 'self-pedicure', 'Свои стопы'],
            ['Ароматы и парфюмерия', 'perfumery', 'Знание ароматов'],
            ['Стоматологическая гигиена', 'dental-care', 'Уход за зубами'],
            ['Депиляция и эпиляция (дома)', 'home-hair-removal', 'Шугаринг, воск дома'],
          ]
        },
        {
          name: 'Здоровье и тело', slug: 'health-wellness', icon: '💚', order: 3,
          skills: [
            ['Здоровый сон (sleep hygiene)', 'sleep-hygiene', 'Гигиена сна'],
            ['Правильная осанка', 'posture', 'Работа с осанкой'],
            ['Дыхательные практики', 'breathing-practices', 'Дыхание Вим Хофа и др.'],
            ['Холодные практики (закаливание)', 'cold-exposure', 'Холодный душ, моржевание'],
            ['Сауна и баня (практики)', 'sauna-practice', 'Сауна, банный ритуал'],
            ['Самомассаж', 'self-massage', 'Массаж себе'],
            ['Работа с напряжением (триггер-точки)', 'trigger-points', 'МФР, ролы'],
            ['Биохакинг', 'biohacking', 'Оптимизация тела'],
            ['Wearables и трекинг (Apple Watch, кольца)', 'health-tracking', 'Отслеживание здоровья'],
            ['Женское здоровье и цикл', 'womens-health', 'Понимание цикла'],
            ['Мужское здоровье', 'mens-health', 'Тестостерон, тело'],
            ['Профилактика и чек-апы', 'health-checkups', 'Регулярные обследования'],
            ['Первая помощь', 'first-aid', 'Базовые навыки спасения'],
          ]
        },
        {
          name: 'Питание и пищевые привычки', slug: 'nutrition-habits', icon: '🍎', order: 4,
          skills: [
            ['Осознанное питание', 'mindful-eating', 'Mindful eating'],
            ['Интервальное голодание', 'intermittent-fasting', 'IF, 16/8'],
            ['Подсчёт калорий и БЖУ', 'calorie-tracking', 'Tracking macros'],
            ['Меал-преп (заготовки еды)', 'meal-prep', 'Meal prep'],
            ['Гидратация (питьевой режим)', 'hydration', 'Вода в день'],
            ['Витамины и БАДы', 'supplements', 'Добавки'],
            ['Отказ от сахара', 'no-sugar', 'Sugar-free lifestyle'],
            ['Отказ от алкоголя (sober life)', 'sober-life', 'Безалкогольный образ жизни'],
            ['Растительное питание', 'plant-based-lifestyle', 'Plant-based'],
            ['Чтение этикеток и составов', 'reading-labels', 'Понимание состава'],
          ]
        },
        {
          name: 'Дом и быт', slug: 'home-living', icon: '🏠', order: 5,
          skills: [
            ['Уборка и клининг', 'cleaning', 'Эффективная уборка'],
            ['Глубокая уборка', 'deep-cleaning', 'Генеральная'],
            ['Стирка и уход за тканями', 'laundry', 'Стирка по типам'],
            ['Глажка и отпаривание', 'ironing', 'Глажка'],
            ['Уход за обувью', 'shoe-care', 'Чистка обуви'],
            ['Уход за кожаными вещами', 'leather-care', 'Кожа: уход и реставрация'],
            ['Организация пространства', 'home-organization', 'Konmari, FlyLady и др.'],
            ['Метод Мари Кондо', 'konmari', 'KonMari'],
            ['Хранение вещей', 'storage-solutions', 'Системы хранения'],
            ['Декор дома', 'home-decor', 'Декорирование'],
            ['Сезонный декор', 'seasonal-decor', 'Декор к праздникам'],
            ['Уют (хюгге и т.п.)', 'hygge', 'Хюгге, lagom, ваби-саби'],
            ['Ароматизация дома', 'home-fragrance', 'Свечи, диффузоры'],
            ['Комнатные растения', 'houseplants', 'Уход за домашними растениями'],
            ['Базовый ремонт быта (мелочи)', 'home-fixing', 'Починить кран, лампочку'],
            ['Стирка деликатных вещей', 'delicate-care', 'Шёлк, шерсть, кашемир'],
            ['Энергоэффективность дома', 'home-efficiency', 'Экономия ресурсов'],
            ['Безопасность дома', 'home-safety', 'Сигнализация, замки'],
          ]
        },
        {
          name: 'Финансы личные', slug: 'personal-finance', icon: '💰', order: 6,
          skills: [
            ['Личный бюджет', 'budgeting', 'Ведение бюджета'],
            ['Финансовая грамотность', 'financial-literacy', 'Базовая грамотность'],
            ['Накопления и подушка безопасности', 'savings', 'Финподушка'],
            ['Учёт расходов', 'expense-tracking', 'Tracking трат'],
            ['Осознанное потребление', 'mindful-spending', 'Mindful consumption'],
            ['Скидки и кэшбек', 'cashback-deals', 'Кэшбек-стратегии'],
            ['Налоги (личные)', 'personal-taxes', 'Декларации, вычеты'],
            ['Кредиты и долги', 'debt-management', 'Управление долгом'],
          ]
        },
        {
          name: 'Саморазвитие и осознанность', slug: 'self-development', icon: '🧠', order: 7,
          skills: [
            ['Медитация', 'meditation', 'Регулярная практика'],
            ['Mindfulness', 'mindfulness', 'Осознанность'],
            ['Ведение дневника (journaling)', 'journaling', 'Journaling'],
            ['Утренние страницы', 'morning-pages', 'Morning pages'],
            ['Целеполагание', 'goal-setting', 'Постановка целей'],
            ['Планирование (личное)', 'personal-planning', 'Планировщики, ежедневники'],
            ['Bullet journal', 'bullet-journal', 'BuJo'],
            ['Тайм-менеджмент', 'time-management', 'Управление временем'],
            ['Привычки и хабит-трекинг', 'habit-building', 'Atomic Habits'],
            ['Утренние ритуалы', 'morning-routines', 'Утренние рутины'],
            ['Вечерние ритуалы', 'evening-routines', 'Вечерние рутины'],
            ['Цифровой детокс', 'digital-detox', 'Отказ от соцсетей'],
            ['Минимализм', 'minimalism', 'Минималистичная жизнь'],
            ['Эссенциализм', 'essentialism', 'Essentialism'],
            ['Slow life', 'slow-living', 'Slow living'],
            ['Чтение книг', 'reading-habit', 'Регулярное чтение'],
            ['Скорочтение', 'speed-reading', 'Speed reading'],
            ['Работа со стрессом', 'stress-management', 'Stress management'],
            ['Эмоциональный интеллект', 'emotional-intelligence', 'EQ'],
            ['Самонаблюдение и рефлексия', 'self-reflection', 'Рефлексия'],
          ]
        },
        {
          name: 'Духовные практики', slug: 'spiritual-practices', icon: '🕊️', order: 8,
          skills: [
            ['Религиозная практика', 'religious-practice', 'Любая конфессия'],
            ['Медитация (буддийская и др.)', 'spiritual-meditation', 'Випассана, дзен'],
            ['Випассана', 'vipassana', 'Випассана-ретриты'],
            ['Молитвенная практика', 'prayer', 'Молитва'],
            ['Йога как духовная практика', 'yoga-spiritual', 'Не как фитнес'],
            ['Астрология (увлечение)', 'astrology', 'Натальные карты'],
            ['Таро (увлечение)', 'tarot', 'Карты Таро'],
            ['Нумерология', 'numerology', 'Числа и судьба'],
            ['Эзотерика (общее)', 'esoterics', 'Эзотерические практики'],
            ['Шаманские практики', 'shamanic-practices', 'Шаманизм'],
            ['Работа с энергией', 'energy-work', 'Рейки, ци'],
            ['Кристаллы и камни', 'crystals', 'Литотерапия (любительски)'],
          ]
        },
        {
          name: 'Отношения и общение', slug: 'relationships', icon: '💕', order: 9,
          skills: [
            ['Романтические отношения', 'romantic-relationships', 'Построение отношений'],
            ['Знакомства и дейтинг', 'dating', 'Свидания, dating apps'],
            ['Семейные отношения', 'family-relationships', 'Семья'],
            ['Дружеские связи', 'friendships', 'Дружба'],
            ['Нетворкинг (личный)', 'personal-networking', 'Расширение круга'],
            ['Коммуникативные навыки', 'communication-skills', 'Эффективное общение'],
            ['Активное слушание', 'active-listening', 'Active listening'],
            ['Эмпатия', 'empathy', 'Эмпатическое общение'],
            ['Разрешение конфликтов', 'conflict-resolution', 'Conflict resolution'],
            ['Личные границы', 'boundaries', 'Установление границ'],
            ['Small talk', 'small-talk', 'Светский разговор'],
            ['Публичные выступления', 'public-speaking', 'Speaking skills'],
            ['Сторителлинг в общении', 'personal-storytelling', 'Истории в разговоре'],
            ['Этикет', 'etiquette', 'Современный этикет'],
            ['Деловой этикет', 'business-etiquette', 'B2B-этикет'],
            ['Застольный этикет', 'dining-etiquette', 'Поведение за столом'],
          ]
        },
        {
          name: 'Родительство', slug: 'parenting', icon: '👶', order: 10,
          skills: [
            ['Беременность и подготовка к родам', 'pregnancy', 'Период беременности'],
            ['Уход за новорождённым', 'newborn-care', 'Newborn'],
            ['Грудное вскармливание', 'breastfeeding', 'ГВ'],
            ['Прикорм', 'baby-food-introduction', 'Введение прикорма'],
            ['Раннее развитие', 'early-development', 'Развитие 0-3'],
            ['Воспитание (дошкольники)', 'preschool-parenting', '3-7 лет'],
            ['Воспитание (школьники)', 'school-age-parenting', '7-12 лет'],
            ['Воспитание подростков', 'teen-parenting', 'Подростки'],
            ['Игры с детьми', 'playing-with-kids', 'Совместные игры'],
            ['Чтение детям', 'reading-to-kids', 'Чтение вслух'],
            ['Развивающие занятия', 'developmental-activities', 'Занятия дома'],
            ['Дисциплина без насилия', 'gentle-parenting', 'Gentle parenting'],
            ['Поддержка эмоций ребёнка', 'emotional-coaching', 'Emotional coaching'],
            ['Работа со школой', 'parent-school-relations', 'Взаимодействие со школой'],
            ['Подбор кружков и секций', 'kids-activities', 'Внешкольное образование'],
            ['Семейные ритуалы', 'family-rituals', 'Традиции семьи'],
            ['Совместные путешествия с детьми', 'family-travel', 'Travel with kids'],
            ['Многодетное родительство', 'multi-kid-parenting', 'Многодетность'],
          ]
        },
        {
          name: 'Питомцы', slug: 'pets', icon: '🐶', order: 11,
          skills: [
            ['Уход за собакой', 'dog-care', 'Содержание собаки'],
            ['Дрессировка собак', 'dog-training', 'Базовая дрессировка'],
            ['Выгул и активность собаки', 'dog-walking', 'Прогулки'],
            ['Груминг собак (дома)', 'home-dog-grooming', 'Стрижка дома'],
            ['Уход за кошкой', 'cat-care', 'Содержание кошки'],
            ['Уход за грызунами', 'rodent-care', 'Хомяки, морские свинки'],
            ['Уход за птицами', 'bird-care', 'Попугаи и др.'],
            ['Аквариумистика', 'aquarium', 'Аквариумные рыбки'],
            ['Террариумистика', 'terrarium', 'Рептилии'],
            ['Уход за лошадью (любительски)', 'horse-keeping', 'Личная лошадь'],
            ['Кормление и питание питомцев', 'pet-nutrition', 'Diet для животных'],
            ['Первая помощь питомцу', 'pet-first-aid', 'Базовая ветпомощь'],
            ['Социализация животных', 'pet-socialization', 'Социализация'],
            ['Путешествия с питомцами', 'traveling-with-pets', 'Перевозки животных'],
          ]
        },
        {
          name: 'Путешествия и travel-навыки', slug: 'travel-lifestyle', icon: '✈️', order: 12,
          skills: [
            ['Самостоятельные путешествия', 'solo-travel', 'Solo travel'],
            ['Бэкпэкинг', 'backpacking', 'Рюкзак и в путь'],
            ['Бюджетные путешествия', 'budget-travel', 'Travel hacking'],
            ['Travel hacking (мили, баллы)', 'travel-hacking', 'Бонусы, мили'],
            ['Планирование маршрутов', 'trip-planning', 'Планирование'],
            ['Бронирование (отели, авиа)', 'travel-booking', 'Booking и аналоги'],
            ['Упаковка чемодана', 'packing', 'Packing skills'],
            ['Удалённая работа в путешествии (digital nomad)', 'digital-nomad', 'Кочевой образ жизни'],
            ['Жизнь в разных странах', 'expat-living', 'Релокация и жизнь экспата'],
            ['Кэмпинг и палаточный отдых', 'camping', 'Жизнь в палатке'],
            ['Караванинг (трейлер, кемпер)', 'caravanning', 'Кемпер, дом на колёсах'],
            ['Hitchhiking (автостоп)', 'hitchhiking', 'Автостоп'],
            ['Каучсёрфинг', 'couchsurfing', 'Couchsurfing'],
            ['Местная культура и обычаи', 'cultural-awareness', 'Culture knowledge'],
            ['Безопасность в путешествиях', 'travel-safety', 'Travel safety'],
            ['Навигация без интернета', 'offline-navigation', 'Maps offline'],
          ]
        },
        {
          name: 'Эко и осознанное потребление', slug: 'sustainable-living', icon: '🌱', order: 13,
          skills: [
            ['Zero waste', 'zero-waste', 'Без отходов'],
            ['Раздельный сбор мусора', 'recycling', 'Сортировка дома'],
            ['Эко-косметика и DIY', 'eco-cosmetics', 'Своя косметика'],
            ['Многоразовые альтернативы', 'reusables', 'Многоразовое'],
            ['Осознанное потребление', 'conscious-consumption', 'Mindful consumption'],
            ['Веганский образ жизни', 'vegan-lifestyle', 'Не еда, а стиль'],
            ['Slow fashion', 'slow-fashion', 'Медленная мода'],
            ['Энергосбережение в быту', 'energy-saving', 'Экономия энергии'],
            ['Compost дома', 'composting', 'Компостирование'],
          ]
        },
        {
          name: 'Развлечения и культурная жизнь', slug: 'entertainment-culture', icon: '🎭', order: 14,
          skills: [
            ['Кинолюбительство (киноман)', 'cinephile', 'Знание кино'],
            ['Сериаломания', 'tv-series-fan', 'Сериалы'],
            ['Театралство', 'theater-going', 'Посещение театров'],
            ['Музейный туризм', 'museum-visiting', 'Музеи и галереи'],
            ['Концертная жизнь', 'concert-going', 'Концерты'],
            ['Фестивальная культура', 'festival-going', 'Музыкальные фестивали'],
            ['Книжный клуб', 'book-club', 'Книжные сообщества'],
            ['Настольные игры (как развлечение)', 'board-games', 'Настолки'],
            ['Видеоигры (как хобби)', 'video-games', 'Гейминг'],
            ['Винные дегустации', 'wine-tasting', 'Wine appreciation'],
            ['Чайные церемонии как лайфстайл', 'tea-lifestyle', 'Чай как ритуал'],
            ['Кофейная культура', 'coffee-culture', 'Specialty coffee'],
            ['Гастрономический туризм', 'food-tourism', 'Food travel'],
          ]
        },
      ]
    },

    // ==========================================
    // 🎲 ХОББИ
    // ==========================================
    {
      name: 'Хобби', slug: 'hobbies', icon: '🎨', order: 9,
      subs: [
        {
          name: 'Рисование и изобразительное', slug: 'visual-arts-hobby', icon: '🖌️', order: 1,
          skills: [
            ['Рисование (общее)', 'drawing', 'Карандаш, ручка'],
            ['Скетчинг', 'sketching', 'Быстрые зарисовки'],
            ['Акварель', 'watercolor', 'Акварельная живопись'],
            ['Масло', 'oil-painting', 'Масляная живопись'],
            ['Акрил', 'acrylic-painting', 'Акриловая живопись'],
            ['Гуашь', 'gouache', 'Гуашь'],
            ['Пастель', 'pastel', 'Пастель сухая и масляная'],
            ['Цветные карандаши', 'colored-pencils', 'Цветной карандаш'],
            ['Маркеры (Copic и др.)', 'markers', 'Спиртовые маркеры'],
            ['Цифровой рисунок', 'digital-drawing', 'Procreate, Wacom'],
            ['Комиксы и манга', 'comics-manga', 'Рисование комиксов'],
            ['Каллиграфия', 'calligraphy', 'Классическая каллиграфия'],
            ['Леттеринг', 'lettering', 'Художественный леттеринг'],
            ['Граффити', 'graffiti', 'Уличное искусство'],
            ['Дудлинг и зентангл', 'doodling-zentangle', 'Медитативные узоры'],
            ['Мандалы', 'mandalas', 'Рисование мандал'],
            ['Портретный рисунок', 'portrait-drawing', 'Портреты'],
            ['Пленэр', 'plein-air', 'Рисование на природе'],
            ['Аниме-арт', 'anime-art', 'Рисование в стиле аниме'],
            ['Пиксель-арт', 'pixel-art', 'Пиксельная графика'],
          ]
        },
        {
          name: 'Рукоделие и ремёсла', slug: 'crafts', icon: '🧶', order: 2,
          skills: [
            ['Вязание спицами', 'knitting', 'Спицы'],
            ['Вязание крючком', 'crocheting', 'Крючок'],
            ['Амигуруми', 'amigurumi', 'Вязаные игрушки'],
            ['Вышивка', 'embroidery', 'Ручная вышивка'],
            ['Вышивка крестом', 'cross-stitch', 'Крестик'],
            ['Вышивка лентами', 'ribbon-embroidery', 'Ленты'],
            ['Шитьё', 'sewing', 'Шитьё на машинке'],
            ['Пэчворк', 'patchwork', 'Лоскутное шитьё'],
            ['Квилтинг', 'quilting', 'Стёганые изделия'],
            ['Макраме', 'macrame', 'Плетение из верёвок'],
            ['Плетение (корзины, лоза)', 'basket-weaving', 'Лозоплетение'],
            ['Ткачество', 'weaving', 'Ручное ткачество'],
            ['Валяние из шерсти', 'felting', 'Сухое и мокрое валяние'],
            ['Скрапбукинг', 'scrapbooking', 'Альбомы-скрапбуки'],
            ['Кардмейкинг', 'cardmaking', 'Открытки вручную'],
            ['Оригами', 'origami', 'Бумажное искусство'],
            ['Киригами', 'kirigami', 'Бумага и ножницы'],
            ['Декупаж', 'decoupage', 'Декупаж'],
            ['Канзаши', 'kanzashi', 'Японские украшения из лент'],
            ['Бисероплетение', 'beading', 'Бисер'],
            ['Создание украшений', 'jewelry-making', 'Украшения руками'],
            ['Полимерная глина', 'polymer-clay', 'Fimo, Sculpey'],
            ['Папье-маше', 'papier-mache', 'Папье-маше'],
            ['Свечеварение', 'candle-making', 'Свечи'],
            ['Мыловарение', 'soap-making', 'Мыло'],
            ['Создание косметики DIY', 'diy-cosmetics', 'Крема, бальзамы'],
            ['Батик', 'batik', 'Роспись ткани'],
            ['Роспись по дереву', 'wood-painting', 'Деревянные изделия'],
            ['Роспись по камню', 'rock-painting', 'Камни'],
            ['Торцевание', 'quilling-tortsevanie', 'Торцевание бумаги'],
            ['Квиллинг', 'quilling', 'Бумажные узоры'],
          ]
        },
        {
          name: 'Работа с деревом и металлом', slug: 'woodworking-metalworking', icon: '🪵', order: 3,
          skills: [
            ['Столярное дело', 'woodworking', 'Работа с деревом'],
            ['Резьба по дереву', 'wood-carving', 'Резьба'],
            ['Токарное дело (дерево)', 'wood-turning', 'Токарный станок'],
            ['Выжигание по дереву', 'pyrography', 'Пирография'],
            ['Сборка мебели', 'furniture-assembly', 'IKEA и сложнее'],
            ['Изготовление мебели', 'furniture-making', 'С нуля'],
            ['Реставрация мебели', 'furniture-restoration', 'Старая мебель'],
            ['Работа с фанерой и ДСП', 'plywood-work', 'Листовые материалы'],
            ['Металлообработка (любительски)', 'metalworking-hobby', 'Ножи, украшения'],
            ['Сварка (любительски)', 'welding-hobby', 'Любительская сварка'],
            ['Ковка (хобби)', 'blacksmithing', 'Кузнечное дело'],
            ['Создание ножей', 'knife-making', 'Knife making'],
            ['Чеканка', 'metal-engraving', 'Чеканка по металлу'],
            ['Ювелирное дело (хобби)', 'jewelry-craft', 'Любительское ювелирство'],
          ]
        },
        {
          name: 'Технические хобби', slug: 'tech-hobbies', icon: '🔧', order: 4,
          skills: [
            ['3D-печать', '3d-printing', 'FDM, Resin принтеры'],
            ['3D-моделирование (хобби)', '3d-modeling-hobby', 'Blender, Fusion 360'],
            ['Arduino', 'arduino', 'Микроконтроллеры'],
            ['Raspberry Pi', 'raspberry-pi', 'Одноплатные компьютеры'],
            ['Электроника DIY', 'diy-electronics', 'Паяльник и схемы'],
            ['Радиолюбительство', 'amateur-radio', 'Ham radio'],
            ['Дроны (хобби)', 'drone-hobby', 'FPV и фото-дроны'],
            ['FPV-гонки дронов', 'fpv-racing', 'FPV drone racing'],
            ['Моделирование (масштабные модели)', 'scale-modeling', 'Airfix, Tamiya'],
            ['Сборка ПК', 'pc-building', 'Building PC'],
            ['Моддинг ПК', 'pc-modding', 'PC modding'],
            ['Ретро-компьютеры', 'retro-computing', 'Vintage computers'],
            ['Кастомизация клавиатур', 'keyboard-hobby', 'Mechanical keyboards'],
            ['Умный дом (DIY)', 'smart-home-diy', 'Home automation'],
            ['Лазерная гравировка', 'laser-engraving', 'Лазерные граверы'],
            ['CNC-фрезеровка', 'cnc-hobby', 'CNC дома'],
            ['Пайка и электроника', 'soldering', 'Паяльная работа'],
          ]
        },
        {
          name: 'Настольные и карточные игры', slug: 'board-card-games', icon: '♟️', order: 5,
          skills: [
            ['Настольные игры (общее)', 'board-games-general', 'Настолки'],
            ['Варгеймы', 'wargames', 'Warhammer и др.'],
            ['Ролевые настольные игры (TTRPG)', 'ttrpg', 'D&D, Pathfinder'],
            ['Dungeon Master / Мастер игры', 'game-mastering', 'DM / GM'],
            ['Коллекционные карточные игры (TCG)', 'tcg', 'Magic, Pokemon'],
            ['Magic: The Gathering', 'mtg', 'MTG'],
            ['Pokémon TCG', 'pokemon-tcg', 'Pokemon карты'],
            ['Yu-Gi-Oh!', 'yugioh', 'Yu-Gi-Oh!'],
            ['Poker', 'poker', 'Покер'],
            ['Преферанс', 'preferans', 'Преферанс'],
            ['Бридж', 'bridge', 'Карточный бридж'],
            ['Маджонг', 'mahjong-game', 'Маджонг'],
            ['Шахматы (хобби)', 'chess-hobby', 'Шахматы'],
            ['Го (хобби)', 'go-hobby', 'Игра Го'],
            ['Нарды (хобби)', 'backgammon-hobby', 'Нарды'],
            ['Разработка настольных игр', 'board-game-design', 'Создание игр'],
            ['Лего (коллекция и сборка)', 'lego', 'LEGO'],
            ['Пазлы', 'puzzles', 'Сборка пазлов'],
          ]
        },
        {
          name: 'Видеоигры (хобби)', slug: 'video-games-hobby', icon: '🎮', order: 6,
          skills: [
            ['RPG игры', 'rpg-games', 'Ролевые'],
            ['Стратегии', 'strategy-games', 'RTS, TBS'],
            ['Симуляторы', 'simulation-games', 'Sims, Euro Truck'],
            ['Инди-игры', 'indie-games', 'Indie gaming'],
            ['Ретро-игры', 'retro-gaming', 'Ретро'],
            ['Speedrunning', 'speedrun-hobby', 'Быстрое прохождение'],
            ['Платинирование трофеев', 'trophy-hunting', 'Achievement hunting'],
            ['Разработка игр (любительски)', 'game-dev-hobby', 'GameMaker, Unity'],
            ['Модинг игр', 'game-modding', 'Моды для игр'],
          ]
        },
        {
          name: 'Коллекционирование', slug: 'collecting', icon: '🏺', order: 7,
          skills: [
            ['Коллекционирование монет (нумизматика)', 'numismatics', 'Монеты'],
            ['Коллекционирование марок (филателия)', 'philately', 'Марки'],
            ['Коллекционирование банкнот', 'banknote-collecting', 'Бумажные деньги'],
            ['Коллекционирование виниловых пластинок', 'vinyl-collecting', 'Винил'],
            ['Коллекционирование книг', 'book-collecting', 'Букинистика'],
            ['Коллекционирование комиксов', 'comic-collecting', 'Comics'],
            ['Коллекционирование фигурок', 'figure-collecting', 'Аниме, pop culture'],
            ['Коллекционирование игрушек (vintage)', 'vintage-toys', 'Ретро-игрушки'],
            ['Коллекционирование кроссовок', 'sneaker-collecting', 'Sneakerhead'],
            ['Коллекционирование часов', 'watch-collecting', 'Часы'],
            ['Коллекционирование вин', 'wine-collecting', 'Вино'],
            ['Коллекционирование виски', 'whisky-collecting', 'Виски'],
            ['Коллекционирование карт (TCG)', 'card-collecting', 'Pokemon, Magic карты'],
            ['Антиквариат', 'antiques', 'Антиквариат'],
            ['Коллекционирование минералов', 'mineral-collecting', 'Камни и кристаллы'],
            ['Коллекционирование оружия (легально)', 'weapon-collecting', 'Холодное, историческое'],
            ['Коллекционирование марок автомобилей', 'car-memorabilia', 'Автоколлекция'],
            ['NFT и цифровой арт (коллекционирование)', 'nft-collecting', 'Digital collectibles'],
          ]
        },
        {
          name: 'Природа и outdoor', slug: 'nature-outdoor', icon: '🌿', order: 8,
          skills: [
            ['Рыбалка', 'fishing', 'Рыбная ловля'],
            ['Нахлыстовая рыбалка', 'fly-fishing', 'Fly fishing'],
            ['Подводная охота', 'spearfishing', 'Спирфишинг'],
            ['Охота', 'hunting', 'Охота'],
            ['Грибная охота', 'mushroom-hunting', 'Тихая охота'],
            ['Сбор ягод и трав', 'foraging', 'Форажинг'],
            ['Выживание в природе', 'bushcraft', 'Bushcraft'],
            ['Ориентирование на местности', 'navigation', 'Карта и компас'],
            ['Бёрдвотчинг (наблюдение за птицами)', 'birdwatching', 'Birding'],
            ['Наблюдение за дикой природой', 'wildlife-watching', 'Wildlife'],
            ['Астронаблюдение (любительски)', 'stargazing', 'Телескоп и звёзды'],
            ['Садоводство', 'gardening', 'Сад и огород'],
            ['Огородничество', 'vegetable-gardening', 'Выращивание овощей'],
            ['Цветоводство', 'flower-gardening', 'Цветы'],
            ['Бонсай', 'bonsai', 'Дерево-миниатюра'],
            ['Террариум / Флорариум', 'florarium', 'Экосистемы в стекле'],
            ['Пчеловодство', 'beekeeping', 'Мёд и пчёлы'],
            ['Геокэшинг', 'geocaching', 'GPS-игра в природе'],
            ['Метеорология (любительски)', 'amateur-meteorology', 'Погодная станция'],
          ]
        },
        {
          name: 'Кулинарные хобби', slug: 'culinary-hobbies', icon: '🍳', order: 9,
          skills: [
            ['Домашняя выпечка', 'home-baking', 'Хлеб, торты'],
            ['Домашнее пивоварение', 'home-brewing', 'Пиво'],
            ['Домашнее виноделие', 'home-winemaking', 'Вино'],
            ['Самогоноварение (легально)', 'home-distilling', 'Дистилляция'],
            ['Ферментация', 'fermentation', 'Квас, кефир, кимчи'],
            ['Сыроделие', 'cheesemaking', 'Домашний сыр'],
            ['Консервирование', 'canning-preserving', 'Закатки, варенье'],
            ['Декор тортов', 'cake-decorating', 'Украшение выпечки'],
            ['Шоколатье (хобби)', 'chocolate-making', 'Шоколад дома'],
            ['Барное хобби (коктейли)', 'home-bartending', 'Миксология дома'],
            ['Кофе (хобби)', 'coffee-hobby', 'Авторский кофе дома'],
            ['Чай (хобби)', 'tea-hobby', 'Чайная культура'],
          ]
        },
        {
          name: 'Музыкальные хобби', slug: 'music-hobby', icon: '🎸', order: 10,
          skills: [
            ['Игра на гитаре (хобби)', 'guitar-hobby', 'Для себя'],
            ['Игра на пианино (хобби)', 'piano-hobby', 'Для себя'],
            ['Игра на барабанах (хобби)', 'drums-hobby', 'Для себя'],
            ['Пение (хобби)', 'singing-hobby', 'Для себя'],
            ['Домашняя студия (хобби)', 'home-studio-hobby', 'Запись для себя'],
            ['Beatmaking (хобби)', 'beatmaking-hobby', 'Биты для себя'],
            ['Диджеинг (хобби)', 'dj-hobby', 'DJ дома'],
            ['Хоровое пение', 'choir', 'Участие в хоре'],
            ['Участие в любительской группе', 'band-hobby', 'Гаражная группа'],
            ['Изучение нотной грамоты', 'music-theory-hobby', 'Теория музыки'],
          ]
        },
        {
          name: 'Чтение и письмо', slug: 'reading-writing', icon: '📚', order: 11,
          skills: [
            ['Чтение художественной литературы', 'fiction-reading', 'Романы, рассказы'],
            ['Чтение нон-фикшн', 'nonfiction-reading', 'Нон-фикшн'],
            ['Фанфикшн', 'fanfiction', 'Фанфики'],
            ['Поэзия (писать)', 'poetry-writing', 'Стихи'],
            ['Короткие рассказы', 'short-story-writing', 'Рассказы'],
            ['Написание романа', 'novel-writing', 'Роман'],
            ['Дневник', 'diary-writing', 'Личный дневник'],
            ['Эссе', 'essay-writing', 'Личные эссе'],
            ['Биография (писать о себе)', 'memoir-writing', 'Мемуары'],
            ['Книжный блог', 'book-blogging', 'Рецензии, обзоры книг'],
            ['Участие в книжных клубах', 'book-club-hobby', 'Клуб читателей'],
          ]
        },
        {
          name: 'Танцы как хобби', slug: 'dance-hobby', icon: '💃', order: 12,
          skills: [
            ['Сальса', 'salsa', 'Латинский танец'],
            ['Бачата', 'bachata', 'Доминиканский'],
            ['Кизомба', 'kizomba', 'Африканский танец'],
            ['Танго', 'tango', 'Аргентинское танго'],
            ['Свинг', 'swing-dance', 'Линди-хоп, джайв'],
            ['Хип-хоп танцы', 'hip-hop-dance', 'Хип-хоп'],
            ['Контемпорари', 'contemporary-dance', 'Современный танец'],
            ['Народные танцы', 'folk-dance', 'Национальные танцы'],
            ['Ирландские танцы', 'irish-dance', 'Степ'],
            ['Восточные танцы', 'belly-dance', 'Танец живота'],
            ['Фламенко', 'flamenco', 'Испанский'],
            ['Клубные танцы', 'club-dancing', 'Freestyling'],
            ['Ритм-степ', 'tap-dance', 'Чечётка'],
          ]
        },
        {
          name: 'Путешествия как хобби', slug: 'travel-hobby', icon: '🗺️', order: 13,
          skills: [
            ['Коллекционирование стран', 'country-collecting', 'Passport stamps'],
            ['Споттинг (авиа)', 'plane-spotting', 'Planespotting'],
            ['Жд-туризм (railfan)', 'railfan', 'Железная дорога'],
            ['Городские исследования (урбанистика)', 'urban-exploration', 'Urbex'],
            ['Подземные экскурсии (диггерство)', 'urban-digging', 'Диггерство'],
            ['Картографирование', 'mapping-hobby', 'OpenStreetMap и др.'],
          ]
        },
      ]
    },

    // ==========================================
    // 🎭 СЦЕНА И МЕДИА
    // ==========================================
    {
      name: 'Сцена', slug: 'performing', icon: '🎭', order: 13,
      subs: [
        {
          name: 'Актёрское мастерство', slug: 'acting', icon: '🎬', order: 1,
          skills: [
            ['Драматическое искусство', 'drama', 'Театр, кино'],
            ['Психологический реализм (Станиславский)', 'stanislavski', 'Метод Станиславского'],
            ['Метод-актинг', 'method-acting', 'Lee Strasberg, погружение'],
            ['Физический театр', 'physical-theater', 'Тело как инструмент'],
            ['Пластика актёра', 'actor-plastique', 'Пластическая выразительность'],
            ['Сценическая речь', 'stage-speech', 'Дикция, голос на сцене'],
            ['Работа с партнёром', 'acting-partnership', 'Парные сцены'],
            ['Работа с текстом (разбор роли)', 'script-analysis', 'Анализ роли'],
            ['Актёрское мастерство в кино', 'screen-acting', 'Съёмочная площадка'],
            ['Актёрское мастерство в театре', 'stage-acting', 'Живая сцена'],
            ['Актёрское мастерство в рекламе', 'commercial-acting', 'Рекламные съёмки'],
            ['Кастинг (как актёр)', 'audition-skills', 'Пробы, self-tape'],
            ['Self-tape (домашний кастинг)', 'self-tape', 'Запись проб дома'],
            ['Работа на камеру', 'on-camera-acting', 'Camera acting'],
            ['Сериальное актёрство', 'tv-acting', 'Сериалы'],
            ['Озвучивание (дубляж)', 'dubbing', 'Дубляж фильмов'],
            ['Озвучивание (аудиокниги)', 'audiobook-narration', 'Аудиокниги'],
            ['Озвучивание (персонажи/игры)', 'character-voice-acting', 'Игры, мультики'],
            ['Моушн-захват (motion capture)', 'mocap', 'Mo-cap acting'],
          ]
        },
        {
          name: 'Театр', slug: 'theater', icon: '🎭', order: 2,
          skills: [
            ['Драматический театр', 'drama-theater', 'Классика и современность'],
            ['Музыкальный театр', 'musical-theater', 'Мюзикл'],
            ['Оперный театр', 'opera', 'Опера'],
            ['Оперетта', 'operetta', 'Оперетта'],
            ['Кукольный театр', 'puppet-theater', 'Куклы'],
            ['Театр теней', 'shadow-theater', 'Тени'],
            ['Документальный театр', 'documentary-theater', 'Вербатим'],
            ['Иммерсивный театр', 'immersive-theater', 'Sleep No More и др.'],
            ['Уличный театр', 'street-theater', 'Перформанс на улице'],
            ['Детский театр', 'childrens-theater', 'Для детей'],
            ['Монодрама', 'monodrama', 'Один актёр на сцене'],
            ['Режиссура театральная', 'theater-directing', 'Постановки'],
            ['Сценография', 'scenography', 'Оформление сцены'],
            ['Работа со светом (театр)', 'theater-lighting', 'Световой дизайн'],
            ['Театральный грим', 'stage-makeup', 'Грим для сцены'],
            ['Театральный костюм', 'theater-costume', 'Костюмы'],
            ['Суфлёрство', 'prompter', 'Суфлёр'],
            ['Театральная педагогика', 'theater-pedagogy', 'Обучение театру'],
          ]
        },
        {
          name: 'Комедия и стендап', slug: 'comedy-standup', icon: '🎤', order: 3,
          skills: [
            ['Стендап-комедия', 'standup-comedy', 'Stand-up'],
            ['Написание стендап-материала', 'standup-writing', 'Шутки, биты'],
            ['Открытые микрофоны (опен-маки)', 'open-mic', 'Open mic'],
            ['Импровизация (театральная)', 'improv-theater', 'Yes-and'],
            ['Импров-форматы (Harold, etc.)', 'improv-formats', 'Harold, shortform'],
            ['Скетч-комедия', 'sketch-comedy', 'Скетчи'],
            ['Написание скетчей', 'sketch-writing', 'Сценарии скетчей'],
            ['Пародия и имитация', 'parody-impression', 'Пародии на персон'],
            ['Клоунада', 'clowning', 'Клоун'],
            ['Буффонада', 'buffoonery', 'Гротескная комедия'],
            ['Кабаре и варьете', 'cabaret', 'Кабаре'],
            ['Конферансье', 'mc-hosting', 'Ведущий шоу'],
            ['Ситком-актёрство', 'sitcom-acting', 'Комедийные сериалы'],
            ['Комедийное написание (для медиа)', 'comedy-writing', 'Сценарии для комедий'],
          ]
        },
        {
          name: 'Цирк и перформанс', slug: 'circus-performance', icon: '🎪', order: 4,
          skills: [
            ['Воздушная гимнастика', 'aerial-acrobatics', 'Полотна, обруч, ремни'],
            ['Воздушное полотно', 'aerial-silks', 'Silks'],
            ['Воздушный обруч (lyra)', 'aerial-hoop', 'Lyra'],
            ['Воздушные ремни', 'aerial-straps', 'Straps'],
            ['Трапеция', 'trapeze', 'Статичная и летящая'],
            ['Акробатика (цирковая)', 'circus-acrobatics', 'Акробатика'],
            ['Жонглирование', 'juggling', 'Мячи, кольца, кегли'],
            ['Эквилибристика', 'equilibristics', 'Баланс'],
            ['Хождение по проволоке', 'tightrope', 'Слэклайн, проволока'],
            ['Unicycle (одноколёсный велосипед)', 'unicycle', 'Моноцикл'],
            ['Пои и файер-шоу', 'poi-fire-show', 'Пои, огонь'],
            ['Диаболо', 'diabolo', 'Диаболо'],
            ['Devil sticks', 'devil-sticks', 'Девил стикс'],
            ['Хула-хуп (перформанс)', 'hula-hoop-performance', 'Обруч'],
            ['Мимическое искусство', 'mime', 'Мим'],
            ['Пантомима', 'pantomime', 'Пантомима'],
            ['Буто (танец-перформанс)', 'butoh', 'Японский перформанс'],
            ['Современный перформанс-арт', 'performance-art', 'Performance art'],
            ['Физический театр', 'physical-theater-perf', 'Тело и пространство'],
          ]
        },
        {
          name: 'Магия и иллюзионизм', slug: 'magic', icon: '🎩', order: 5,
          skills: [
            ['Карточная магия', 'card-magic', 'Карточные фокусы'],
            ['Монетные фокусы', 'coin-magic', 'Монеты'],
            ['Сценическая магия', 'stage-magic', 'Большая сцена'],
            ['Клозап-магия', 'close-up-magic', 'Close-up'],
            ['Ментализм', 'mentalism', 'Чтение мыслей'],
            ['Иллюзионизм', 'illusionism', 'Масштабные иллюзии'],
            ['Street magic', 'street-magic', 'Уличная магия'],
            ['Манипуляция', 'manipulation-magic', 'Шарики, карты, монеты'],
            ['Эскапизм (освобождение)', 'escapology', 'Гудини-стиль'],
            ['Вентрилоквизм', 'ventriloquism', 'Чревовещание'],
          ]
        },
        {
          name: 'Публичные выступления', slug: 'public-speaking', icon: '🎤', order: 6,
          skills: [
            ['Публичные выступления', 'public-speaking-skill', 'Выступления перед аудиторией'],
            ['Ораторское искусство', 'oratory', 'Риторика'],
            ['Питчинг', 'pitching', 'Презентация идей'],
            ['TED-формат выступлений', 'ted-talks', 'TED-стиль'],
            ['Конференц-спикерство', 'conference-speaking', 'Спикер конференций'],
            ['Свадебные тосты и речи', 'wedding-speeches', 'Тосты'],
            ['Траурные речи', 'eulogy', 'Прощальные речи'],
            ['Дебаты', 'debating', 'Дебаты'],
            ['Модерация дискуссий', 'discussion-moderation', 'Фасилитация'],
            ['Ведение мероприятий (MC)', 'event-mc', 'Ивент MC'],
            ['Свадебный ведущий (тамада)', 'wedding-host', 'Тамада'],
            ['Корпоративный ведущий', 'corporate-host', 'Корпоратив'],
            ['Телеведение', 'tv-presenting', 'Ведущий ТВ'],
            ['Радиоведение', 'radio-presenting', 'Ведущий радио'],
            ['Подкаст-ведение', 'podcast-presenting', 'Хост подкаста'],
            ['Сторителлинг (устный)', 'oral-storytelling', 'Spoken word'],
            ['Slam-поэзия', 'poetry-slam', 'Poetry slam'],
            ['Работа с залом', 'audience-engagement', 'Взаимодействие с публикой'],
            ['Работа с микрофоном', 'mic-technique', 'Техника микрофона'],
          ]
        },
        {
          name: 'Танец (сценический)', slug: 'stage-dance', icon: '💃', order: 7,
          skills: [
            ['Балет', 'ballet', 'Классический балет'],
            ['Современная хореография', 'contemporary-choreography', 'Постановки'],
            ['Джаз-танец', 'jazz-dance', 'Jazz'],
            ['Степ (чечётка)', 'tap-dance-stage', 'Tap dance'],
            ['Хип-хоп (сценический)', 'hip-hop-stage', 'Хип-хоп шоу'],
            ['Брейк-данс (на сцене)', 'breakdance-stage', 'Breakdance перформанс'],
            ['Мюзикл (хореография)', 'musical-dance', 'Танец в мюзикле'],
            ['Народный танец (сценический)', 'folk-dance-stage', 'Ансамбли'],
            ['Хореография (постановка)', 'choreography', 'Создание танцев'],
            ['Танцевальное шоу', 'dance-show', 'Шоу-программы'],
          ]
        },
        {
          name: 'Вокал и музыка на сцене', slug: 'stage-music', icon: '🎵', order: 8,
          skills: [
            ['Сольное пение (концерт)', 'solo-singing-concert', 'Сольные концерты'],
            ['Мюзикл (вокал)', 'musical-singing', 'Пение в мюзикле'],
            ['Опера (вокал)', 'opera-singing', 'Оперный вокал'],
            ['A cappella', 'acappella', 'Без инструментов'],
            ['Хоровое пение', 'choir-singing', 'Хор'],
            ['Концертное выступление (инструмент)', 'instrument-concert', 'Живой концерт'],
            ['Музыкальный руководитель шоу', 'music-director-show', 'MD мюзикла'],
            ['Фронтмен группы', 'band-frontman', 'Лидер группы'],
            ['Бэк-вокал', 'backup-vocals', 'Бэк-вокалист'],
            ['Дирижирование', 'conducting', 'Оркестр, хор'],
          ]
        },
      ]
    },

    // ==========================================
    // 📚 ОБРАЗОВАНИЕ
    // ==========================================
    {
      name: 'Образование', slug: 'education', icon: '🎓', order: 14,
      subs: [
        {
          name: 'Преподавание', slug: 'teaching', icon: '👨‍🏫', order: 1,
          skills: [
            ['Преподавание в школе', 'school-teaching', 'Учитель'],
            ['Преподавание в вузе', 'university-teaching', 'Лектор, преподаватель'],
            ['Частное репетиторство', 'tutoring', 'Репетитор'],
            ['Групповые занятия', 'group-teaching', 'Ведение группы'],
            ['Индивидуальные занятия', 'individual-teaching', 'One-on-one'],
            ['Преподавание иностранных языков', 'language-teaching', 'ESL, RFL и др.'],
            ['Преподавание математики', 'math-teaching', 'Математика'],
            ['Преподавание точных наук', 'science-teaching', 'Физика, химия, биология'],
            ['Преподавание гуманитарных наук', 'humanities-teaching', 'История, литература'],
            ['Преподавание искусства', 'art-teaching', 'Рисование, музыка'],
            ['Преподавание спорта', 'sports-teaching', 'Физкультура, тренерство'],
            ['Преподавание программирования', 'coding-teaching', 'Технические дисциплины'],
            ['Корпоративное обучение', 'corporate-training', 'Тренинги в компаниях'],
            ['Профессиональные тренинги', 'professional-training', 'Hard skills тренинги'],
            ['Коучинг (обучающий)', 'educational-coaching', 'Развитие через коучинг'],
            ['Менторство', 'mentoring', 'Наставничество'],
            ['Наставничество (онбординг)', 'onboarding-mentoring', 'Новые сотрудники'],
            ['Обучение пожилых', 'senior-education', 'Цифровая грамотность и др.'],
          ]
        },
        {
          name: 'Педагогика и методология', slug: 'pedagogy', icon: '📖', order: 2,
          skills: [
            ['Педагогика (общая)', 'general-pedagogy', 'Теория обучения'],
            ['Дидактика', 'didactics', 'Методы преподавания'],
            ['Разработка учебных программ', 'curriculum-design', 'Curriculum design'],
            ['Составление урока', 'lesson-planning', 'Планирование занятий'],
            ['Методика преподавания', 'teaching-methodology', 'Методики'],
            ['Дифференцированное обучение', 'differentiated-instruction', 'Разные уровни'],
            ['Инклюзивное образование', 'inclusive-education', 'Особые потребности'],
            ['Проектное обучение (PBL)', 'project-based-learning', 'Project-based'],
            ['Проблемное обучение', 'problem-based-learning', 'Problem-based'],
            ['Перевёрнутый класс', 'flipped-classroom', 'Flipped classroom'],
            ['Геймификация в обучении', 'gamification-education', 'Игровые механики'],
            ['Сократовский метод', 'socratic-method', 'Вопросы и диалог'],
            ['Метод Монтессори', 'montessori-method', 'Монтессори'],
            ['Вальдорфская педагогика', 'waldorf-pedagogy', 'Вальдорф'],
            ['Система Финляндии (феномен)', 'finnish-education', 'Finnish approach'],
            ['Обучение взрослых (андрагогика)', 'andragogy', 'Андрагогика'],
            ['Оценивание и обратная связь', 'assessment-feedback', 'Assessment'],
            ['Формирующее оценивание', 'formative-assessment', 'Formative assessment'],
            ['Работа с мотивацией учеников', 'student-motivation', 'Мотивация'],
            ['Управление классом', 'classroom-management', 'Дисциплина и атмосфера'],
          ]
        },
        {
          name: 'Онлайн-образование', slug: 'online-education', icon: '💻', order: 3,
          skills: [
            ['Создание онлайн-курсов', 'online-course-creation', 'Курсы на Udemy, Stepik'],
            ['Instructional design', 'instructional-design', 'ID'],
            ['LMS-платформы (Moodle, Canvas)', 'lms-platforms', 'Learning Management Systems'],
            ['Zoom/Meet занятия', 'video-teaching', 'Онлайн уроки'],
            ['Создание обучающих видео', 'educational-video', 'Запись лекций'],
            ['Скринкаст-обучение', 'screencasting', 'Screencast'],
            ['Создание вебинаров', 'webinar-creation', 'Вебинары'],
            ['Подкаст как обучающий формат', 'educational-podcast', 'Обучающий подкаст'],
            ['MOOC-разработка', 'mooc-development', 'Массовые онлайн-курсы'],
            ['Микрообучение (microlearning)', 'microlearning', 'Короткие форматы'],
            ['Геймификация курсов', 'course-gamification', 'Значки, рейтинги'],
            ['Сообщество вокруг курса', 'learning-community', 'Cohort-based learning'],
            ['Когортное обучение', 'cohort-based-learning', 'Cohort learning'],
            ['Автоворонки и автокурсы', 'automated-courses', 'Evergreen курсы'],
          ]
        },
        {
          name: 'Учебный контент', slug: 'educational-content', icon: '📝', order: 4,
          skills: [
            ['Написание учебников', 'textbook-writing', 'Учебники'],
            ['Написание методичек', 'methodical-writing', 'Методические пособия'],
            ['Разработка тестов и заданий', 'test-design', 'Контрольные, тесты'],
            ['Создание презентаций (обучение)', 'educational-presentations', 'Слайды для обучения'],
            ['Инфографика для обучения', 'educational-infographics', 'Визуальное объяснение'],
            ['Создание воркбуков', 'workbook-creation', 'Рабочие тетради'],
            ['E-learning контент (SCORM)', 'scorm-content', 'SCORM-модули'],
            ['Иллюстрации к учебным материалам', 'educational-illustration', 'Обучающие картинки'],
            ['Симуляции и интерактив', 'educational-simulations', 'Симуляторы'],
            ['Квизы и интерактивные тесты', 'quiz-creation', 'Kahoot, Mentimeter'],
          ]
        },
        {
          name: 'Дошкольное и детское образование', slug: 'early-childhood-education', icon: '🧒', order: 5,
          skills: [
            ['Дошкольная педагогика', 'preschool-pedagogy', 'Дети 2-6 лет'],
            ['Воспитатель детского сада', 'kindergarten-teacher', 'Детский сад'],
            ['Методика раннего развития', 'early-development-methods', 'Домана, Монтессори'],
            ['Методика Глена Домана', 'doman-method', 'Карточки Домана'],
            ['Методика Зайцева', 'zaitsev-method', 'Кубики Зайцева'],
            ['Подготовка к школе', 'school-preparation', 'Подготовишки'],
            ['Логопедия (базовые навыки)', 'basic-speech-therapy', 'Развитие речи'],
            ['Сенсорное развитие', 'sensory-development', 'Сенсорика'],
            ['Развитие мелкой моторики', 'fine-motor-skills', 'Пальчиковые игры'],
            ['Игровое обучение', 'play-based-learning', 'Обучение через игру'],
            ['Работа с особыми детьми', 'special-needs-children', 'Дети с ОВЗ'],
            ['Арт-терапия с детьми', 'art-therapy-children', 'Творчество и психология'],
          ]
        },
        {
          name: 'Специальное образование', slug: 'special-education', icon: '♿', order: 6,
          skills: [
            ['Работа с детьми с ОВЗ', 'children-with-disabilities', 'ОВЗ'],
            ['Работа с детьми с аутизмом', 'autism-education', 'РАС'],
            ['Работа с детьми с СДВГ', 'adhd-education', 'СДВГ'],
            ['Дефектология', 'defectology', 'Дефектолог'],
            ['Логопедия', 'speech-therapy', 'Постановка речи'],
            ['Сурдопедагогика', 'deaf-education', 'Обучение глухих'],
            ['Тифлопедагогика', 'blind-education', 'Обучение слепых'],
            ['Олигофренопедагогика', 'intellectual-disability-education', 'УО'],
            ['Адаптивное обучение', 'adaptive-learning', 'Индивидуализация'],
            ['Поведенческий анализ (ABA)', 'aba-therapy', 'ABA'],
          ]
        },
        {
          name: 'Управление образованием', slug: 'education-management', icon: '🏫', order: 7,
          skills: [
            ['Управление школой', 'school-management', 'Директор школы'],
            ['Управление учебным центром', 'learning-center-management', 'Руководство центром'],
            ['Образовательный менеджмент', 'educational-management', 'EdManagement'],
            ['Аккредитация и лицензирование', 'education-accreditation', 'Получение лицензий'],
            ['Образовательная политика', 'education-policy', 'Реформы образования'],
            ['EdTech (управление продуктом)', 'edtech-product', 'Образовательные продукты'],
            ['Фандрайзинг для образования', 'education-fundraising', 'Гранты, спонсоры'],
            ['Образовательные стартапы', 'edtech-startup', 'EdTech startup'],
          ]
        },
        {
          name: 'Самообразование и учёба', slug: 'self-learning', icon: '🧠', order: 8,
          skills: [
            ['Техники запоминания', 'memorization-techniques', 'Мнемоника'],
            ['Метод интервального повторения', 'spaced-repetition', 'Anki, SRS'],
            ['Ментальные карты (mindmaps)', 'mindmapping', 'Mind maps'],
            ['Метод Фейнмана', 'feynman-technique', 'Объясни простыми словами'],
            ['Активное чтение', 'active-reading', 'Конспектирование, вопросы'],
            ['Метод Корнелла (конспекты)', 'cornell-notes', 'Cornell notes'],
            ['Скорочтение', 'speed-reading-skill', 'Быстрое чтение'],
            ['Работа с научными статьями', 'reading-research-papers', 'Academic papers'],
            ['Написание конспектов', 'note-taking', 'Note-taking системы'],
            ['Система Zettelkasten', 'zettelkasten', 'Zettelkasten'],
            ['Система Notion для учёбы', 'notion-learning', 'PKM в Notion'],
            ['Обучение иностранным языкам (методы)', 'language-learning-methods', 'Как учить языки'],
            ['Постановка учебных целей', 'learning-goals', 'Study planning'],
            ['Управление вниманием при учёбе', 'study-focus', 'Deep work для учёбы'],
            ['Подготовка к экзаменам', 'exam-preparation', 'Exam prep'],
          ]
        },
        {
          name: 'Академическое и научное', slug: 'academic-research', icon: '🔬', order: 9,
          skills: [
            ['Научное исследование', 'scientific-research', 'Research'],
            ['Написание научных статей', 'academic-writing', 'Публикации'],
            ['Написание диссертации', 'dissertation-writing', 'Диссертация'],
            ['Академическое письмо', 'academic-writing-style', 'Academic style'],
            ['Работа с литературой (обзор)', 'literature-review', 'Literature review'],
            ['Цитирование и библиографии', 'citation-management', 'APA, Chicago, ГОСТ'],
            ['Статистика для исследований', 'research-statistics', 'SPSS, R'],
            ['Качественные методы исследования', 'qualitative-research', 'Интервью, наблюдение'],
            ['Количественные методы', 'quantitative-research', 'Опросы, данные'],
            ['Гранты и заявки', 'grant-writing', 'Grant writing'],
            ['Рецензирование (peer review)', 'peer-review', 'Рецензия на статьи'],
            ['Конференц-доклады', 'academic-presentations', 'Academic talks'],
            ['Популяризация науки', 'science-communication', 'Scicomm'],
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
