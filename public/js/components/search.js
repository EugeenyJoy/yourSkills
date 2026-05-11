// ============================================
// search.js — Поиск людей и навыков
// ============================================
// Два режима поиска:
// 1. По людям — ввод имени/username
// 2. По навыкам — найти людей с конкретным навыком
//
// Также показывает:
// — Топ пользователей
// — Категории навыков для просмотра
// — Фильтр по рангу
// ============================================

const SearchPage = (() => {

  // Таймер для debounce поиска
  // (чтобы не слать запрос на каждую букву)
  let searchTimer = null;

  // Текущий режим поиска
  let currentMode = 'people'; // 'people' | 'skills'


  /**
   * Рендер страницы поиска
   */
  async function render() {
    // Загружаем топ пользователей для начального экрана
    let topUsers = [];
    try {
      const topData = await API.getTopUsers({ limit: 10 });
      topUsers = topData.users || [];
    } catch (e) {
      console.warn('Не удалось загрузить топ:', e.message);
    }

    return `
      <div class="search-page">

        <!-- Поле поиска -->
        <div class="search-input-wrap">
          <span class="search-icon">🔍</span>
          <input
            class="search-input"
            id="search-input"
            placeholder="Поиск людей или навыков..."
            oninput="SearchPage.onSearchInput(this.value)"
            autocomplete="off"
          >
        </div>

        <!-- Переключатель режимов -->
        <div class="search-tabs" style="
          display: flex;
          gap: 8px;
          margin-bottom: 16px;
        ">
          <button
            class="search-tab-btn active"
            id="tab-people"
            onclick="SearchPage.switchMode('people')"
          >
            👥 Люди
          </button>
          <button
            class="search-tab-btn"
            id="tab-skills"
            onclick="SearchPage.switchMode('skills')"
          >
            🎯 По навыку
          </button>
          <button
            class="search-tab-btn"
            id="tab-top"
            onclick="SearchPage.switchMode('top')"
          >
            🏆 Топ
          </button>
        </div>

        <!-- Результаты -->
        <div id="search-results">
          ${renderTopUsers(topUsers)}
        </div>

      </div>

      <style>
        .search-tab-btn {
          flex: 1;
          padding: 10px;
          background: var(--bg-card);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: var(--radius-md);
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-fast);
        }
        .search-tab-btn.active {
          background: var(--accent);
          color: white;
          border-color: var(--accent);
        }
        .search-tab-btn:active {
          transform: scale(0.97);
        }

        .rank-filter {
          display: flex;
          gap: 6px;
          margin-bottom: 12px;
          overflow-x: auto;
          padding-bottom: 4px;
        }
        .rank-filter-btn {
          padding: 6px 12px;
          background: var(--bg-card);
          border: none;
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          transition: all var(--transition-fast);
        }
        .rank-filter-btn.active {
          color: white;
        }
        .rank-filter-btn.rank-e.active { background: var(--rank-e); }
        .rank-filter-btn.rank-d.active { background: var(--rank-d); }
        .rank-filter-btn.rank-c.active { background: var(--rank-c); }
        .rank-filter-btn.rank-b.active { background: var(--rank-b); }
        .rank-filter-btn.rank-a.active { background: var(--rank-a); }
        .rank-filter-btn.rank-s.active {
          background: linear-gradient(135deg, var(--rank-s), var(--rank-s-gold));
        }
      </style>
    `;
  }


  /**
   * Переключение режима поиска
   */
  async function switchMode(mode) {
    currentMode = mode;

    // Обновляем вкладки
    document.querySelectorAll('.search-tab-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`tab-${mode}`);
    if (activeBtn) activeBtn.classList.add('active');

    // Обновляем placeholder
    const input = document.getElementById('search-input');
    if (input) {
      switch (mode) {
        case 'people':
          input.placeholder = 'Введите имя или @username';
          break;
        case 'skills':
          input.placeholder = 'Введите название навыка...';
          break;
        case 'top':
          input.placeholder = 'Навык для топа (или пусто = общий)';
          break;
      }
    }

    // Показываем начальное содержимое
    const resultsEl = document.getElementById('search-results');

    switch (mode) {
      case 'people':
        const query = input?.value?.trim();
        if (query && query.length >= 2) {
          await searchPeople(query);
        } else {
          resultsEl.innerHTML = renderSearchHint('people');
        }
        break;

      case 'skills':
        await showSkillCategories();
        break;

      case 'top':
        await showTop();
        break;
    }
  }


  /**
   * Обработчик ввода в поле поиска
   * Debounce — ждём 400мс после последнего нажатия
   */
  function onSearchInput(value) {
    // Очищаем предыдущий таймер
    if (searchTimer) clearTimeout(searchTimer);

    const query = value.trim();

    // Минимум 2 символа
    if (query.length < 2) {
      const resultsEl = document.getElementById('search-results');
      if (currentMode === 'skills') {
        showSkillCategories();
      } else if (currentMode === 'top') {
        showTop();
      } else {
        resultsEl.innerHTML = renderSearchHint('people');
      }
      return;
    }

    // Запускаем поиск через 400мс
    searchTimer = setTimeout(async () => {
      switch (currentMode) {
        case 'people':
          await searchPeople(query);
          break;
        case 'skills':
          await searchBySkill(query);
          break;
        case 'top':
          await showTop(query);
          break;
      }
    }, 400);
  }


  /**
   * Поиск людей по имени
   */
  async function searchPeople(query) {
    const resultsEl = document.getElementById('search-results');
    resultsEl.innerHTML = renderLoading();

    try {
      const data = await API.searchUsers(query);

      if (data.users.length === 0) {
        resultsEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">🔍</div>
            <div class="empty-title">Никого не найдено</div>
            <div class="empty-text">Попробуйте другой запрос</div>
          </div>
        `;
        return;
      }

      resultsEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${data.users.map(user => Card.renderUserItem(user)).join('')}
        </div>
        ${data.hasMore ? `
          <button
            class="btn btn-secondary btn-full"
            style="margin-top: 12px;"
            onclick="SearchPage.loadMorePeople('${Card.escapeHtml(query)}', ${data.page + 1})"
          >
            Показать ещё
          </button>
        ` : ''}
      `;

    } catch (error) {
      resultsEl.innerHTML = renderError(error.message);
    }
  }


  /**
   * Загрузить ещё результатов
   */
  async function loadMorePeople(query, page) {
    try {
      const data = await API.searchUsers(query, { page });

      // Находим контейнер со списком
      const listEl = document.querySelector('#search-results > div');
      if (!listEl) return;

      // Убираем кнопку "Показать ещё"
      const moreBtn = document.querySelector('#search-results > button');
      if (moreBtn) moreBtn.remove();

      // Добавляем результаты
      data.users.forEach(user => {
        listEl.insertAdjacentHTML('beforeend', Card.renderUserItem(user));
      });

      // Кнопка для следующей страницы
      if (data.hasMore) {
        listEl.insertAdjacentHTML('afterend', `
          <button
            class="btn btn-secondary btn-full"
            style="margin-top: 12px;"
            onclick="SearchPage.loadMorePeople('${Card.escapeHtml(query)}', ${page + 1})"
          >
            Показать ещё
          </button>
        `);
      }

    } catch (error) {
      App.showToast('Ошибка загрузки', '❌');
    }
  }

  async function showSubcategories(categorySlug) {
    const resultsEl = document.getElementById('search-results');
    resultsEl.innerHTML = renderLoading();

    try {
      const catalog = await API.getCatalog();
      const category = catalog.find(c => c.slug === categorySlug);
      if (!category) { resultsEl.innerHTML = renderError('Не найдена'); return; }

      resultsEl.innerHTML = `
        <button class="btn btn-secondary btn-sm" style="margin-bottom: 12px;"
          onclick="SearchPage.showSkillCategories()">← Назад</button>

        <div class="section-header">
          <span class="section-title">${category.icon} ${Card.escapeHtml(category.name)}</span>
        </div>

        ${(category.subcategories || []).map(sub => `
          <div class="section">
            <div class="section-header">
              <span class="section-title">${sub.icon} ${Card.escapeHtml(sub.name)}</span>
            </div>
            <div class="skill-list">
              ${(sub.skills || []).map(skill => `
                <div class="skill-item"
                  onclick="SearchPage.searchUsersBySkill('${Card.escapeHtml(skill.slug)}', '${Card.escapeHtml(skill.name)}')"
                >
                  <div class="skill-icon">${sub.icon}</div>
                  <div class="skill-info">
                    <div class="skill-name">${Card.escapeHtml(skill.name)}</div>
                    <div class="skill-meta">${Card.escapeHtml(skill.description || '')}</div>
                  </div>
                  <div style="color: var(--text-muted);">→</div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      `;
    } catch (error) {
      resultsEl.innerHTML = renderError(error.message);
    }
  }
  
  /**
   * Показать категории навыков
   */
    async function showSkillCategories() {
    const resultsEl = document.getElementById('search-results');
    resultsEl.innerHTML = renderLoading();

    try {
      const catalog = await API.getCatalog();

      resultsEl.innerHTML = `
        <div style="margin-bottom: 12px; color: var(--text-secondary); font-size: 14px;">
          Выберите категорию
        </div>
        <div class="category-grid">
          ${catalog.map(cat => `
            <div
              class="category-item"
              onclick="SearchPage.showSubcategories('${Card.escapeHtml(cat.slug)}')"
            >
              <div class="category-icon">${cat.icon}</div>
              <div class="category-name">${Card.escapeHtml(cat.name)}</div>
              <div style="font-size: 11px; color: var(--text-muted);">
                ${cat.subcategories ? cat.subcategories.length : 0} подкатегорий
              </div>
            </div>
          `).join('')}
        </div>
      `;

    } catch (error) {
      resultsEl.innerHTML = renderError(error.message);
    }
  }


  /**
   * Показать навыки в категории
   */
  async function showSkillsInCategory(categorySlug, categoryName, categoryIcon) {
    const resultsEl = document.getElementById('search-results');
    resultsEl.innerHTML = renderLoading();

    try {
      const catalog = await API.getCatalog();
      const category = catalog.find(c => c.slug === categorySlug);

      if (!category) {
        resultsEl.innerHTML = renderError('Категория не найдена');
        return;
      }

      resultsEl.innerHTML = `
        <button
          class="btn btn-secondary btn-sm"
          style="margin-bottom: 12px;"
          onclick="SearchPage.showSkillCategories()"
        >
          ← Назад к категориям
        </button>

        <div class="section-header">
          <span class="section-title">${categoryIcon} ${Card.escapeHtml(categoryName)}</span>
        </div>

        <div class="skill-list">
          ${category.skills.map(skill => `
            <div
              class="skill-item"
              onclick="SearchPage.searchUsersBySkill('${Card.escapeHtml(skill.slug)}', '${Card.escapeHtml(skill.name)}')"
            >
              <div class="skill-icon">${categoryIcon}</div>
              <div class="skill-info">
                <div class="skill-name">${Card.escapeHtml(skill.name)}</div>
                <div class="skill-meta">${Card.escapeHtml(skill.description)}</div>
              </div>
              <div style="color: var(--text-muted);">→</div>
            </div>
          `).join('')}
        </div>
      `;

    } catch (error) {
      resultsEl.innerHTML = renderError(error.message);
    }
  }


  /**
   * Поиск по тексту навыка (быстрый поиск)
   */
  async function searchBySkill(query) {
    const resultsEl = document.getElementById('search-results');
    resultsEl.innerHTML = renderLoading();

    try {
      const skills = await API.searchSkills(query);

      if (skills.length === 0) {
        resultsEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">🔍</div>
            <div class="empty-title">Навык не найден</div>
            <div class="empty-text">Попробуйте другое название</div>
          </div>
        `;
        return;
      }

      resultsEl.innerHTML = `
        <div class="skill-list">
          ${skills.map(skill => `
            <div
              class="skill-item"
              onclick="SearchPage.searchUsersBySkill('${Card.escapeHtml(skill.slug)}', '${Card.escapeHtml(skill.name)}')"
            >
              <div class="skill-icon">${skill.categoryIcon}</div>
              <div class="skill-info">
                <div class="skill-name">${Card.escapeHtml(skill.name)}</div>
                <div class="skill-meta">
                  ${Card.escapeHtml(skill.category)} · ${Card.escapeHtml(skill.description)}
                </div>
              </div>
              <div style="color: var(--text-muted);">→</div>
            </div>
          `).join('')}
        </div>
      `;

    } catch (error) {
      resultsEl.innerHTML = renderError(error.message);
    }
  }


  // Текущий фильтр ранга
  let currentRankFilter = null;

  /**
   * Найти людей с определённым навыком
   */
  async function searchUsersBySkill(skillSlug, skillName, rankFilter = null) {
    const resultsEl = document.getElementById('search-results');
    resultsEl.innerHTML = renderLoading();
    currentRankFilter = rankFilter;

    try {
      const options = { skill: skillSlug };
      if (rankFilter) options.rank = rankFilter;

      const data = await API.searchUsers(null, options);

      resultsEl.innerHTML = `
        <!-- Кнопка назад -->
        <button
          class="btn btn-secondary btn-sm"
          style="margin-bottom: 12px;"
          onclick="SearchPage.switchMode('skills')"
        >
          ← Назад
        </button>

        <div class="section-header">
          <span class="section-title">
            Люди с навыком "${Card.escapeHtml(skillName)}"
          </span>
          <span style="font-size: 13px; color: var(--text-secondary);">
            ${data.total}
          </span>
        </div>

        <!-- Фильтр по рангу -->
        <div class="rank-filter">
          <button
            class="rank-filter-btn ${!rankFilter ? 'active' : ''}"
            style="${!rankFilter ? 'background: var(--accent); color: white;' : ''}"
            onclick="SearchPage.searchUsersBySkill('${Card.escapeHtml(skillSlug)}', '${Card.escapeHtml(skillName)}')"
          >
            Все
          </button>
          ${['S', 'A', 'B', 'C', 'D', 'E'].map(r => `
            <button
              class="rank-filter-btn rank-${r.toLowerCase()} ${rankFilter === r ? 'active' : ''}"
              onclick="SearchPage.searchUsersBySkill('${Card.escapeHtml(skillSlug)}', '${Card.escapeHtml(skillName)}', '${r}')"
            >
              ${r}
            </button>
          `).join('')}
        </div>

        ${data.users.length > 0 ? `
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${data.users.map(user => Card.renderUserItem(user)).join('')}
          </div>
        ` : `
          <div class="empty-state">
            <div class="empty-icon">🤷</div>
            <div class="empty-title">Никого не найдено</div>
            ${rankFilter
              ? '<div class="empty-text">Попробуйте другой ранг</div>'
              : ''
            }
          </div>
        `}
      `;

    } catch (error) {
      resultsEl.innerHTML = renderError(error.message);
    }
  }


  /**
   * Показать топ пользователей
   */
  async function showTop(skillSlug = null) {
    const resultsEl = document.getElementById('search-results');
    resultsEl.innerHTML = renderLoading();

    try {
      const options = { limit: 20 };
      if (skillSlug) options.skill = skillSlug;

      const data = await API.getTopUsers(options);

      resultsEl.innerHTML = `
        ${data.myPosition ? `
          <div style="
            padding: 12px;
            background: var(--bg-card);
            border-radius: var(--radius-md);
            margin-bottom: 12px;
            text-align: center;
          ">
            Твоя позиция: <strong>#${data.myPosition}</strong>
          </div>
        ` : ''}

        ${data.users.length > 0 ? `
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${data.users.map(user =>
              Card.renderUserItem(user, { position: user.position })
            ).join('')}
          </div>
        ` : `
          <div class="empty-state">
            <div class="empty-icon">🏆</div>
            <div class="empty-title">Пока пусто</div>
            <div class="empty-text">Добавьте навыки чтобы попасть в топ</div>
          </div>
        `}
      `;

    } catch (error) {
      resultsEl.innerHTML = renderError(error.message);
    }
  }


  /**
   * Топ пользователей (для начального экрана)
   */
  function renderTopUsers(users) {
    if (users.length === 0) {
      return renderSearchHint('people');
    }

    return `
      <div class="section">
        <div class="section-header">
          <span class="section-title">🏆 Топ пользователей</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${users.map(user =>
            Card.renderUserItem(user, { position: user.position })
          ).join('')}
        </div>
      </div>
    `;
  }


  // ==========================================
  // Вспомогательные рендеры
  // ==========================================

  function renderSearchHint(mode) {
    return `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">
          ${mode === 'people' ? 'Найти людей' : 'Найти по навыку'}
        </div>
        <div class="empty-text">
          ${mode === 'people'
            ? 'Введите имя или @username'
            : 'Введите название навыка'
          }
        </div>
      </div>
    `;
  }

  function renderLoading() {
    return `
      <div style="text-align: center; padding: 40px;">
        <div class="loading-spinner" style="margin: 0 auto;"></div>
      </div>
    `;
  }

  function renderError(message) {
    return `
      <div class="empty-state">
        <div class="empty-icon">❌</div>
        <div class="empty-title">Ошибка</div>
        <div class="empty-text">${Card.escapeHtml(message)}</div>
      </div>
    `;
  }


  // ==========================================
  // Публичный интерфейс
  // ==========================================

  return {
    render,
    switchMode,
    onSearchInput,
    searchUsersBySkill,
    showSkillCategories,
    showSubcategories,
    showSkillsInCategory,
    loadMorePeople,
    showTop
  };

})();