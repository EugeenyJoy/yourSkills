// ============================================
// app.js — Инициализация приложения
// ============================================
// Запускается последним (после всех модулей).
// Порядок:
// 1. Настроить Telegram Web App
// 2. Зарегистрировать маршруты
// 3. Авторизоваться
// 4. Показать приложение
// ============================================

const App = (() => {

  // ==========================================
  // Глобальное состояние
  // ==========================================
  // Хранит данные текущего пользователя.
  // Доступно из любого компонента как App.state
  // ==========================================

  const state = {
    user: null,        // Данные пользователя
    skills: [],        // Навыки пользователя
    categories: [],    // Категории с навыками
    stats: null,       // Статистика
    achievements: [],  // Достижения
    isReady: false     // Приложение загружено
  };


  // ==========================================
  // Telegram Web App настройка
  // ==========================================

  const tg = window.Telegram?.WebApp;

  function setupTelegram() {
    if (!tg) {
      console.warn('⚠️ Telegram WebApp не доступен (открыто не в Telegram)');
      return;
    }

    // Сообщаем Telegram что приложение готово
    tg.ready();

    // Раскрываем на весь экран
    tg.expand();

    // Устанавливаем цвет заголовка
    tg.setHeaderColor('#0a0a0f');
    tg.setBackgroundColor('#0a0a0f');

    // Включаем подтверждение закрытия
    // (чтобы случайно не закрыть)
    tg.enableClosingConfirmation();

    console.log('📱 Telegram WebApp настроен');
  }


  // ==========================================
  // Регистрация маршрутов
  // ==========================================

  function setupRoutes() {

    // Главная — статус чекинов + карточка
    Router.addRoute('/', async () => {
      return await HomePage.render();
    }, 'home');

    // Чекин — отметка прогресса
    Router.addRoute('/checkin', async () => {
      return await CheckinPage.render();
    }, 'checkin');

    // Поиск людей и навыков
    Router.addRoute('/search', async () => {
      return await SearchPage.render();
    }, 'search');

    // Лента событий
    Router.addRoute('/feed', async () => {
      return await FeedPage.render();
    }, 'feed');

    // Настройки
    Router.addRoute('/settings', async () => {
      return await SettingsPage.render();
    }, 'settings');

    // Обратная совместимость старой ссылки
    Router.addRoute('/profile', async () => {
      return await SettingsPage.render();
    }, 'settings');

    // Чужой профиль
    Router.addRoute('/user/:id', async (params) => {
      return await UserProfilePage.render(params.id);
    }, null);

    // Детали навыка
    Router.addRoute('/skill/:id', async (params) => {
      return await SkillDetailPage.render(params.id);
    }, null);

    // Список диалогов
    Router.addRoute('/messages', async () => {
      return await MessagesPage.render();
    }, null);

    // Конкретный диалог
    Router.addRoute('/messages/:id', async (params) => {
      const html = await MessagesPage.renderDialog(params.id);
      // Авто-скролл вниз после вставки в DOM
      setTimeout(() => MessagesPage.scrollToBottom(), 0);
      return html;
    }, null);

    console.log('🛤️ Маршруты зарегистрированы');
  }


  // ==========================================
  // Авторизация
  // ==========================================

  async function authenticate() {
    try {
      // Пробуем авторизоваться через Telegram
      const data = await API.login();

      // Сохраняем в состояние
      state.user = data.user;
      state.skills = data.skills;
      state.categories = data.categories;
      state.stats = data.stats;
      state.achievements = data.achievements;
      state.isReady = true;

      console.log(`👤 Авторизован: ${state.user.firstName} (ранг ${state.user.overallRank})`);

      return true;

    } catch (error) {
      console.error('❌ Ошибка авторизации:', error.message);

      // Если нет Telegram — показываем заглушку
      if (!tg || !tg.initData) {
        showDevMode();
        return false;
      }

      showError('Не удалось авторизоваться. Попробуйте перезапустить приложение.');
      return false;
    }
  }


  // ==========================================
  // Режим разработки (без Telegram)
  // ==========================================

  function showDevMode() {
    const loading = document.getElementById('loading-screen');
    if (loading) loading.classList.add('hidden');

    const app = document.getElementById('app');
    app.classList.remove('hidden');

    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔧</div>
        <div class="empty-title">Режим разработки</div>
        <div class="empty-text">
          Приложение работает только внутри Telegram Mini App.
          <br><br>
          Чтобы протестировать:
          <br>1. Откройте @BotFather
          <br>2. Настройте Mini App
          <br>3. Откройте бота и нажмите кнопку приложения
        </div>
      </div>
    `;
  }


  // ==========================================
  // Показ ошибки
  // ==========================================

  function showError(message) {
    const loading = document.getElementById('loading-screen');
    if (loading) {
      loading.querySelector('.loading-subtitle').textContent = message;
      loading.querySelector('.loading-spinner').classList.add('hidden');
    }
  }


  // ==========================================
  // Показ приложения (скрытие загрузки)
  // ==========================================

  function showApp() {
    const loading = document.getElementById('loading-screen');
    const app = document.getElementById('app');

    // Плавное исчезновение загрузочного экрана
    if (loading) {
      loading.classList.add('fade-out');
      setTimeout(() => loading.classList.add('hidden'), 500);
    }

    // Показываем приложение
    app.classList.remove('hidden');
  }


  // ==========================================
  // Toast уведомления
  // ==========================================

  /**
   * Показать уведомление
   *
   * @param {string} text — текст
   * @param {string} icon — эмодзи-иконка
   * @param {number} duration — длительность в мс
   */
  function showToast(text, icon = '✅', duration = 3000) {
    const toast = document.getElementById('toast');
    const toastIcon = document.getElementById('toast-icon');
    const toastText = document.getElementById('toast-text');

    toastIcon.textContent = icon;
    toastText.textContent = text;

    // Показываем
    toast.classList.remove('hidden', 'fade-out');

    // Haptic feedback
    if (tg?.HapticFeedback) {
      tg.HapticFeedback.notificationOccurred('success');
    }

    // Скрываем через duration мс
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.classList.add('hidden'), 300);
    }, duration);
  }


  // ==========================================
  // Модальное окно
  // ==========================================

  /**
   * Открыть модалку
   *
   * @param {string} title — заголовок
   * @param {string} html — HTML содержимое
   */
  function showModal(title, html) {
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');

    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modal.classList.remove('hidden');

    // Закрытие по кнопке ✕
    document.getElementById('modal-close').onclick = hideModal;

    // Закрытие по клику на затемнение
    modal.querySelector('.modal-backdrop').onclick = hideModal;

    // Haptic
    if (tg?.HapticFeedback) {
      tg.HapticFeedback.impactOccurred('light');
    }
  }

  /**
   * Закрыть модалку
   */
  function hideModal() {
    const modal = document.getElementById('modal');
    modal.classList.add('hidden');
  }


  // ==========================================
  // Обновление состояния
  // ==========================================

  /**
   * Перезагрузить данные профиля из сервера
   * Вызывается после действий (чекин, добавление навыка и т.п.)
   */
  async function refreshProfile() {
    try {
      API.clearCache();
      const data = await API.login();

      state.user = data.user;
      state.skills = data.skills;
      state.categories = data.categories;
      state.stats = data.stats;
      state.achievements = data.achievements;

    } catch (error) {
      console.error('❌ Ошибка обновления профиля:', error.message);
    }
  }


  // ==========================================
  // Вспомогательные функции для компонентов
  // ==========================================

  /**
   * Генерирует URL аватара
   * Своё фото или генерируемый SVG
   */
  function getAvatarUrl(user) {
    if (user.photoUrl || user.avatarUrl) {
      return user.photoUrl || user.avatarUrl;
    }
    // DiceBear — бесплатный генератор аватаров
    // Уникальный аватар для каждого ID
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`;
  }

  /**
   * Возвращает CSS класс ранга
   */
  function rankClass(rank) {
    return `rank-${(rank || 'e').toLowerCase()}`;
  }

  /**
   * Форматирует число (1000 → 1K)
   */
  function formatNumber(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }


  // ==========================================
  // ЗАПУСК
  // ==========================================

  async function init() {
    console.log('🚀 yourSkills запускается...');

    // 1. Настраиваем Telegram
    setupTelegram();

    // 2. Регистрируем маршруты
    setupRoutes();

    // 3. Инициализируем роутер
    Router.init();

    // 4. Авторизуемся
    const success = await authenticate();
    if (!success) return;

    // 5. Показываем приложение
    showApp();

    // 6. Переходим на главную (pushState=false чтобы принудительно отрисовать первый экран)
    Router.navigate('/', false);

    console.log('✅ yourSkills готов');
  }


  // ==========================================
  // Публичный интерфейс
  // ==========================================

  return {
    init,
    state,
    showToast,
    showModal,
    hideModal,
    refreshProfile,
    getAvatarUrl,
    rankClass,
    formatNumber,

    // Ссылка на Telegram WebApp
    tg
  };

})();


// ==========================================
// Запуск при загрузке DOM
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
