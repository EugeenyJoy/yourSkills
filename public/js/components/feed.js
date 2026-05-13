// ============================================
// feed.js — Лента событий
// ============================================
// Два режима:
// 1. Персональная — события от подписок
// 2. Глобальная — значимые события всех
//
// Автоматически генерируется из действий:
// — Повышение ранга
// — Достижения
// — Стрик-рекорды
// — Новые навыки
// — Подтверждения
// ============================================

const FeedPage = (() => {

  // Текущий режим ленты
  let currentTab = 'global';

  // Текущая страница (для подгрузки)
  let currentPage = 0;


  /**
   * Рендер страницы ленты
   */
  async function render() {
    currentTab = 'global';
    currentPage = 0;

    return `
      <div class="feed-page">

        <!-- Переключатель -->
        <div class="feed-tabs">
          <button
            class="feed-tab-btn active"
            id="feed-tab-global"
            onclick="FeedPage.switchTab('global')"
          >
            🌍 Все
          </button>
          <button
            class="feed-tab-btn"
            id="feed-tab-personal"
            onclick="FeedPage.switchTab('personal')"
          >
            👥 Подписки
          </button>
        </div>

        <!-- Список событий -->
        <div id="feed-list">
          ${await renderFeedContent('global', 0)}
        </div>

      </div>

      <!-- Стили для цветных акцентов -->
      <style>
        .feed-page {
          width: 100%;
          max-width: 100%;
          padding: 0;
        }
        .feed-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 16px;
        }
        .feed-tab-btn {
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 12px;
          background: rgba(255,255,255,0.03);
          color: var(--text-secondary);
          padding: 10px 12px;
          font-size: clamp(13px, 3.4vw, 14px);
          font-weight: 600;
          line-height: 1.2;
          cursor: pointer;
          transition: all var(--transition-fast);
        }
        .feed-tab-btn.active {
          background: linear-gradient(135deg, rgba(65,140,255,0.24), rgba(65,140,255,0.1));
          color: var(--text-primary);
          border-color: rgba(65,140,255,0.55);
          box-shadow: 0 8px 20px rgba(65,140,255,0.18);
        }
        .feed-tab-btn:active {
          transform: scale(0.98);
        }
        .feed-item {
          display: block !important;
          position: relative;
          background: var(--bg-card);
          border-radius: 16px;
          padding: 14px 12px 12px 16px;
          margin-bottom: 12px;
          overflow: hidden;
        }
        .feed-item-accent {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
          border-radius: 3px 0 0 3px;
        }
        .feed-user-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
          cursor: pointer;
          width: 100%;
        }
        .feed-user-avatar {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
        }
        .feed-user-name {
          font-size: clamp(13px, 3.3vw, 14px);
          font-weight: 600;
          color: var(--text-secondary);
          flex: 1;
          min-width: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .feed-rank-tag {
          font-size: 11px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
          background: rgba(255,255,255,0.06);
        }
        .feed-time {
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .feed-content {
          display: grid;
          grid-template-columns: 1fr;
          gap: 6px;
          align-items: flex-start;
          width: 100%;
        }
        .feed-icon-wrap {
          font-size: clamp(22px, 6vw, 26px);
          line-height: 1;
        }
        .feed-body {
          width: 100%;
        }
        .feed-title {
          font-size: clamp(18px, 4.8vw, 28px);
          font-weight: 600;
          line-height: 1.25;
          word-break: break-word;
        }
        .feed-text {
          font-size: clamp(13px, 3.5vw, 15px);
          color: var(--text-secondary);
          margin-top: 4px;
          line-height: 1.35;
          word-break: break-word;
        }

        .reactions-row {
          display: flex;
          gap: 6px;
          margin-top: 10px;
          flex-wrap: wrap;
          justify-content: flex-start;
          width: 100%;
          clear: both;
        }
        .feed-reactions {
          display: block;
          width: 100%;
        }
        .reaction-btn {
          display: flex;
          align-items: center;
          gap: 3px;
          padding: 4px 8px;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 20px;
          background: transparent;
          cursor: pointer;
          transition: all var(--transition-fast);
          font-size: 14px;
        }
        .reaction-btn:not(.has-count) {
          opacity: 0.4;
          padding: 4px 6px;
        }
        .reaction-btn:not(.has-count):hover,
        .reaction-btn:not(.has-count):active {
          opacity: 0.8;
        }
        .reaction-btn.active {
          background: var(--accent);
          border-color: var(--accent);
          opacity: 1;
        }
        .reaction-btn.has-count {
          opacity: 1;
          background: rgba(255,255,255,0.04);
        }
        .reaction-btn:active {
          transform: scale(0.9);
        }
        .reaction-emoji {
          font-size: 16px;
        }
        .reaction-count {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
        }
        .reaction-btn.active .reaction-count {
          color: white;
        }
        @media (max-width: 380px) {
          .feed-tab-btn {
            padding: 9px 10px;
          }
          .feed-rank-tag {
            padding: 2px 5px;
          }
          .feed-item {
            padding-right: 10px;
          }
        }
      </style>
    `;
  }


  /**
   * Переключение вкладки ленты
   */
  async function switchTab(tab) {
    currentTab = tab;
    currentPage = 0;

    // Обновляем вкладки
    document.querySelectorAll('.feed-page .feed-tab-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`feed-tab-${tab}`);
    if (activeBtn) activeBtn.classList.add('active');

    // Загружаем контент
    const feedList = document.getElementById('feed-list');
    feedList.innerHTML = `
      <div style="text-align: center; padding: 40px;">
        <div class="loading-spinner" style="margin: 0 auto;"></div>
      </div>
    `;

    feedList.innerHTML = await renderFeedContent(tab, 0);
  }


  /**
   * Загрузить и отрендерить контент ленты
   */
  async function renderFeedContent(tab, page) {
    try {
      let data;

      if (tab === 'personal') {
        data = await API.getFeed(page);
      } else {
        data = await API.getGlobalFeed(page);
      }

      if (data.events.length === 0 && page === 0) {
        return renderEmptyFeed(tab);
      }

      let html = `
        <div class="feed-list" id="feed-events-list">
          ${data.events.map(event => renderFeedItem(event)).join('')}
        </div>
      `;

      // Кнопка "Загрузить ещё"
      if (data.hasMore) {
        html += `
          <button
            class="btn btn-secondary btn-full"
            style="margin-top: 12px;"
            id="feed-load-more"
            onclick="FeedPage.loadMore()"
          >
            Загрузить ещё
          </button>
        `;
      }

      return html;

    } catch (error) {
      console.error('❌ Ошибка ленты:', error);
      return `
        <div class="empty-state">
          <div class="empty-icon">❌</div>
          <div class="empty-title">Ошибка загрузки</div>
          <div class="empty-text">${Card.escapeHtml(error.message)}</div>
        </div>
      `;
    }
  }


  /**
   * Один элемент ленты
   */
    function renderFeedItem(event) {
    const accentColor = getAccentColor(event.accent);

    return `
      <div class="feed-item" data-event-id="${event.id}">
        <div class="feed-item-accent" style="background: ${accentColor};"></div>

        <div class="feed-user-row" data-link href="/user/${event.user.id}">
          <img class="feed-user-avatar"
            src="${Card.escapeHtml(event.user.avatarUrl)}"
            alt=""
            onerror="this.src='https://api.dicebear.com/7.x/avataaars/svg?seed=${event.user.id}'"
          >
          <span class="feed-user-name">
            ${Card.escapeHtml(event.user.firstName)}
          </span>
          <span class="feed-rank-tag rank-${(event.user.rank || 'f').toLowerCase()}">
            ${event.user.rank || 'F'}
          </span>
          <span class="feed-time">${Card.escapeHtml(event.timeAgo)}</span>
        </div>

        <div class="feed-content">
          <div class="feed-icon-wrap">${event.icon || '📌'}</div>
          <div class="feed-body">
            <div class="feed-title">${Card.escapeHtml(event.title)}</div>
            ${event.text ? `<div class="feed-text">${Card.escapeHtml(event.text)}</div>` : ''}
          </div>
        </div>

        <!-- Реакции -->
        <div class="feed-reactions" id="reactions-${event.id}">
          ${renderReactions(event)}
        </div>
      </div>
    `;
  }


  function renderReactions(event) {
    const emojis = ['👏', '🔥', '💪', '❤️', '🎉', '⚡'];
    const reactionsMap = new Map();
    (event.reactions || []).forEach(r => reactionsMap.set(r.emoji, r.count));

    let html = '<div class="reactions-row">';

    emojis.forEach(emoji => {
      const count = reactionsMap.get(emoji) || 0;
      const isActive = event.userReaction === emoji;

      html += `
        <button
          class="reaction-btn ${isActive ? 'active' : ''} ${count > 0 ? 'has-count' : ''}"
          onclick="FeedPage.toggleReaction(${event.id}, '${emoji}', ${isActive})"
        >
          <span class="reaction-emoji">${emoji}</span>
          ${count > 0 ? `<span class="reaction-count">${count}</span>` : ''}
        </button>
      `;
    });

    html += '</div>';
    return html;
  }

    async function toggleReaction(eventId, emoji, isActive) {
    try {
      let result;
      if (isActive) {
        result = await API.removeReaction(eventId);
      } else {
        result = await API.reactToEvent(eventId, emoji);
      }

      if (App.tg?.HapticFeedback) {
        App.tg.HapticFeedback.impactOccurred('light');
      }

      // Обновляем UI
      const container = document.getElementById(`reactions-${eventId}`);
      if (container) {
        container.innerHTML = renderReactions({
          id: eventId,
          reactions: result.reactions,
          userReaction: result.userReaction
        });
      }

    } catch (error) {
      console.error('❌ Реакция:', error);
    }
  }


  /**
   * Кнопки взаимодействия с событием
   */
  function renderFeedActions(event) {
    // Для повышения ранга — кнопка подтвердить навык
    if (event.type === 'rank_up' && event.data?.skillId) {
      // Не показываем для своих событий
      if (event.user.id === App.state.user?.id) return '';

      return `
        <div style="margin-top: 8px; padding-left: 50px;">
          <button
            class="btn btn-secondary btn-sm"
            onclick="FeedPage.endorseFromFeed(${event.user.id}, ${event.data.skillId}, this)"
          >
            🤝 Подтвердить навык
          </button>
        </div>
      `;
    }

    // Для стрик-рекордов — текст поддержки
    if (event.type === 'streak_milestone' && event.data?.streak >= 30) {
      return `
        <div style="
          margin-top: 8px;
          padding-left: 50px;
          font-size: 12px;
          color: var(--streak-fire);
        ">
          ${getStreakEmoji(event.data.streak)} Невероятная серия!
        </div>
      `;
    }

    return '';
  }


  /**
   * Подтвердить навык прямо из ленты
   */
  async function endorseFromFeed(userId, skillId, buttonEl) {
    try {
      const result = await API.endorse(userId, skillId);

      buttonEl.textContent = '✓ Подтверждено';
      buttonEl.disabled = true;
      buttonEl.classList.remove('btn-secondary');
      buttonEl.style.color = 'var(--rank-d)';

      App.showToast(result.message, '🤝');

      // Haptic
      if (App.tg?.HapticFeedback) {
        App.tg.HapticFeedback.notificationOccurred('success');
      }

    } catch (error) {
      if (error.message.includes('уже подтверждали')) {
        buttonEl.textContent = '✓ Уже подтверждено';
        buttonEl.disabled = true;
      } else {
        App.showToast(error.message || 'Ошибка', '❌');
      }
    }
  }


  /**
   * Загрузить ещё событий
   */
  async function loadMore() {
    currentPage++;

    const loadMoreBtn = document.getElementById('feed-load-more');
    if (loadMoreBtn) {
      loadMoreBtn.textContent = 'Загрузка...';
      loadMoreBtn.disabled = true;
    }

    try {
      let data;

      if (currentTab === 'personal') {
        data = await API.getFeed(currentPage);
      } else {
        data = await API.getGlobalFeed(currentPage);
      }

      // Добавляем новые события
      const listEl = document.getElementById('feed-events-list');
      if (listEl) {
        data.events.forEach(event => {
          listEl.insertAdjacentHTML('beforeend', renderFeedItem(event));
        });
      }

      // Убираем кнопку
      if (loadMoreBtn) loadMoreBtn.remove();

      // Добавляем новую кнопку если есть ещё
      if (data.hasMore) {
        listEl?.insertAdjacentHTML('afterend', `
          <button
            class="btn btn-secondary btn-full"
            style="margin-top: 12px;"
            id="feed-load-more"
            onclick="FeedPage.loadMore()"
          >
            Загрузить ещё
          </button>
        `);
      }

    } catch (error) {
      App.showToast('Ошибка загрузки', '❌');

      // Возвращаем кнопку
      if (loadMoreBtn) {
        loadMoreBtn.textContent = 'Загрузить ещё';
        loadMoreBtn.disabled = false;
      }

      currentPage--; // Откатываем страницу
    }
  }


  /**
   * Пустая лента
   */
  function renderEmptyFeed(tab) {
    if (tab === 'personal') {
      return `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <div class="empty-title">Лента пуста</div>
          <div class="empty-text">
            Подпишитесь на людей чтобы видеть их достижения
          </div>
          <button
            class="btn btn-primary"
            data-link href="/search"
          >
            🔍 Найти людей
          </button>
        </div>
      `;
    }

    return `
      <div class="empty-state">
        <div class="empty-icon">🌍</div>
        <div class="empty-title">Пока нет событий</div>
        <div class="empty-text">
          Добавьте навыки и практикуйтесь — ваши достижения появятся здесь
        </div>
      </div>
    `;
  }


  // ==========================================
  // Вспомогательные функции
  // ==========================================

  /**
   * Цвет акцента для события
   */
  function getAccentColor(accent) {
    const colors = {
      'gold':   'var(--rank-s-gold)',
      'orange': 'var(--streak-fire)',
      'green':  'var(--rank-d)',
      'blue':   'var(--rank-c)',
      'purple': 'var(--rank-b)',
      'red':    'var(--rank-s)',
      'gray':   'var(--text-muted)'
    };
    return colors[accent] || colors.gray;
  }

  /**
   * Эмодзи для стрик-рекордов
   */
  function getStreakEmoji(streak) {
    if (streak >= 365) return '👑';
    if (streak >= 100) return '⚡';
    if (streak >= 50)  return '💎';
    if (streak >= 30)  return '🌟';
    return '🔥';
  }


  // ==========================================
  // Публичный интерфейс
  // ==========================================

  return {
    render,
    switchTab,
    loadMore,
    endorseFromFeed,
    toggleReaction
  };

})();
