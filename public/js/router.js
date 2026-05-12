// ============================================
// router.js — Клиентский роутер (SPA)
// ============================================
// Обеспечивает навигацию без перезагрузки:
// — Перехватывает клики по ссылкам
// — Меняет URL в адресной строке
// — Загружает нужный компонент
// — Управляет историей (кнопка "назад")
// — Управляет таб-баром
//
// Без библиотек — чистый JavaScript.
// Весь роутер ~100 строк.
// ============================================

const Router = (() => {

  // ==========================================
  // Хранилище маршрутов
  // ==========================================
  // Каждый маршрут — это объект с:
  // — path: строка или RegExp
  // — handler: функция отрисовки
  // — tab: какая вкладка подсвечивается
  // ==========================================

  const routes = [];

  // Текущий путь
  let currentPath = '/';

  // DOM элементы
  const contentEl = document.getElementById('content');
  const tabBar = document.getElementById('tab-bar');


  // ==========================================
  // Регистрация маршрутов
  // ==========================================

  /**
   * Добавить маршрут
   *
   * @param {string} path — путь ("/settings", "/user/:id")
   * @param {function} handler — функция(params) → HTML или Promise<HTML>
   * @param {string} tab — ID вкладки для подсветки
   *
   * Поддержка параметров:
   *   "/user/:id" → params.id = "123"
   *   "/skill/:skillId" → params.skillId = "5"
   */
  function addRoute(path, handler, tab = null) {
    // Превращаем строку с :param в RegExp
    // "/user/:id" → /^\/user\/([^/]+)$/
    const paramNames = [];
    const regexStr = path.replace(/:([^/]+)/g, (match, paramName) => {
      paramNames.push(paramName);
      return '([^/]+)';
    });
    const regex = new RegExp(`^${regexStr}$`);

    routes.push({ path, regex, paramNames, handler, tab });
  }


  // ==========================================
  // Навигация
  // ==========================================

  /**
   * Перейти на страницу
   *
   * @param {string} path — путь
   * @param {boolean} pushState — добавлять в историю (true)
   *                               или заменять (false)
   */
  async function navigate(path, pushState = true) {
    // Не навигировать на текущую страницу
    // (если не принудительное обновление)
    if (path === currentPath && pushState) return;

    currentPath = path;

    // Ищем подходящий маршрут
    let matchedRoute = null;
    let params = {};

    for (const route of routes) {
      const match = path.match(route.regex);
      if (match) {
        matchedRoute = route;
        // Извлекаем параметры из URL
        route.paramNames.forEach((name, index) => {
          params[name] = match[index + 1];
        });
        break;
      }
    }

    // Маршрут не найден
    if (!matchedRoute) {
      contentEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🤷</div>
          <div class="empty-title">Страница не найдена</div>
          <button class="btn btn-primary" onclick="Router.navigate('/')">
            На главную
          </button>
        </div>
      `;
      return;
    }

    // Обновляем URL в адресной строке
    if (pushState) {
      history.pushState({ path }, '', path);
    }

    // Обновляем активную вкладку
    updateActiveTab(matchedRoute.tab);

    // Показываем загрузку если контент пустой
    // (при первом переходе)
    const previousContent = contentEl.innerHTML;

    try {
      // Скролл наверх при переходе
      contentEl.scrollTop = 0;

      // Вызываем обработчик маршрута
      // Он может быть async (возвращать Promise)
      const html = await matchedRoute.handler(params);

      // Вставляем HTML
      if (typeof html === 'string') {
        contentEl.innerHTML = html;
      }

      // Telegram haptic feedback при навигации
      if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.selectionChanged();
      }

    } catch (error) {
      console.error('❌ Ошибка навигации:', error);

      contentEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">❌</div>
          <div class="empty-title">Ошибка загрузки</div>
          <div class="empty-text">${error.message}</div>
          <button class="btn btn-primary" onclick="Router.navigate('/')">
            На главную
          </button>
        </div>
      `;
    }
  }


  /**
   * Обновить активную вкладку в таб-баре
   */
  function updateActiveTab(tabId) {
    if (!tabBar || !tabId) return;

    // Снимаем active со всех
    tabBar.querySelectorAll('.tab-item').forEach(tab => {
      tab.classList.remove('active');
    });

    // Ставим active на нужную
    const activeTab = tabBar.querySelector(`[data-tab="${tabId}"]`);
    if (activeTab) {
      activeTab.classList.add('active');
    }
  }


  // ==========================================
  // Обработка кликов и истории
  // ==========================================

  /**
   * Инициализация роутера
   * Вызывается один раз при запуске приложения
   */
  function init() {

    // ---- Перехват кликов по таб-бару ----
    if (tabBar) {
      tabBar.addEventListener('click', (e) => {
        // Ищем ближайший элемент с data-link
        const tabItem = e.target.closest('[data-link]');
        if (!tabItem) return;

        e.preventDefault();
        const href = tabItem.getAttribute('href');
        if (href) navigate(href);
      });
    }

    // ---- Перехват всех кликов по ссылкам с data-link ----
    document.addEventListener('click', (e) => {
      const link = e.target.closest('[data-link]');
      if (!link) return;

      // Игнорируем если уже обработано таб-баром
      if (link.closest('.tab-bar')) return;

      e.preventDefault();
      const href = link.getAttribute('href') || link.getAttribute('data-href');
      if (href) navigate(href);
    });

    // ---- Кнопка "назад" в браузере / Telegram ----
    window.addEventListener('popstate', (e) => {
      const path = e.state?.path || '/';
      navigate(path, false); // false = не добавлять в историю повторно
    });

    // ---- Telegram кнопка "назад" ----
    if (tg) {
      tg.BackButton.onClick(() => {
        if (currentPath !== '/') {
          history.back();
        }
      });
    }

    // ---- Начальная навигация ----
    // Берём текущий URL или переходим на главную
    const initialPath = window.location.pathname || '/';
    history.replaceState({ path: initialPath }, '', initialPath);
  }


  /**
   * Обновить кнопку "назад" в Telegram
   * Показывать если не на главной странице
   */
  function updateBackButton() {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    if (currentPath !== '/') {
      tg.BackButton.show();
    } else {
      tg.BackButton.hide();
    }
  }


  // ==========================================
  // Публичный интерфейс
  // ==========================================

  // Ссылка на Telegram WebApp
  const tg = window.Telegram?.WebApp;

  return {
    addRoute,
    navigate,
    init,
    updateBackButton,

    // Геттер текущего пути
    get currentPath() { return currentPath; }
  };

})();
