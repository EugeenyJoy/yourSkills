// ============================================
// profile.js — Настройки и публичные профили
// ============================================

const AccountPage = (() => {

  /** Черновик видимости бейджей в настройках (до «Сохранить профиль») */
  let settingsBadgesDraft = null;

  /**
   * Нормализация бейджей в единый формат
   */
  function normalizeBadges(badges) {
    if (!Array.isArray(badges)) return [];
    return badges.map(b => {
      if (typeof b === 'string') {
        return { code: b, name: b, icon: '🏷️', color: '#888', visible: true };
      }
      return {
        code: b.code || '',
        name: b.name || b.code || '',
        icon: b.icon || '🏷️',
        color: b.color || '#888',
        visible: b.visible !== false
      };
    });
  }

  function cloneBadgesForDraft(badges) {
    return normalizeBadges(badges).map(b => ({ ...b }));
  }

  function renderBadgesListHtml(badges) {
    return badges.map((b, idx) => `
      <button type="button" onclick="SettingsPage.toggleBadgeVisibility(${idx})" style="
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 10px;
        border-radius: 999px;
        border: 2px solid ${(b.color || '#888')}55;
        background: ${(b.visible ? (b.color || '#888') + '22' : 'rgba(100,100,100,0.08)')};
        color: ${(b.visible ? (b.color || '#888') : '#666666')};
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        opacity: ${(b.visible ? '1' : '0.5')};
      " title="${(b.visible ? 'Нажмите, чтобы скрыть' : 'Нажмите, чтобы показать')} (сохраните профиль)">
        <span>${b.icon || '🏷️'}</span>
        <span>${Card.escapeHtml(b.name || b.code || 'Badge')}</span>
      </button>
    `).join('');
  }

  /**
   * Рендер своего экрана настроек
   *
   * @returns {Promise<string>}
   */
  async function renderSettings() {
    try {
      Router.updateBackButton();
      const data = await API.getMyProfile();
      return renderSettingsPage(data);
    } catch (error) {
      console.error('❌ Ошибка настроек:', error);
      return `
        <div class="empty-state">
          <div class="empty-icon">😔</div>
          <div class="empty-title">Ошибка загрузки настроек</div>
          <div class="empty-text">${Card.escapeHtml(error.message)}</div>
          <button class="btn btn-primary" data-link href="/">
            На главную
          </button>
        </div>
      `;
    }
  }

  /**
   * Рендер чужого публичного профиля
   */
  async function renderUserProfile(userId) {
    try {
      const data = await API.getProfile(userId);
      Router.updateBackButton();

      return `
        <div class="profile-page">
          ${Card.renderFull(data)}

          <!-- Лента активности профиля -->
          <div class="section" id="profile-feed">
            <div class="section-header">
              <span class="section-title">📰 Активность</span>
            </div>
            <div id="profile-feed-list">
              <div style="text-align: center; padding: 20px; color: var(--text-muted);">
                Загрузка...
              </div>
            </div>
          </div>
        </div>
      `;

      // Подгружаем ленту после отрисовки основного контента
      // (не блокируем показ профиля)

    } catch (error) {
      console.error('❌ Ошибка профиля:', error);
      return `
        <div class="empty-state">
          <div class="empty-icon">😔</div>
          <div class="empty-title">Профиль не найден</div>
          <div class="empty-text">${Card.escapeHtml(error.message)}</div>
          <button class="btn btn-primary" data-link href="/">
            На главную
          </button>
        </div>
      `;
    }
  }

  function renderSettingsPage(data) {
    const user = data.user || {};
    // В API для владельца: badges — только видимые на карточке, badgesAll — полный список для настроек
    const rawBadges = Array.isArray(user.badgesAll)
      ? user.badgesAll
      : (Array.isArray(user.badges) ? user.badges : []);
    // Черновик только для экрана настроек — в App.state и на карточке не трогаем до сохранения
    settingsBadgesDraft = cloneBadgesForDraft(rawBadges);
    const badges = settingsBadgesDraft;
    
    const safeFirstName = Card.escapeHtml(user.firstName || '');
    const safeLastName = Card.escapeHtml(user.lastName || '');
    const safeProfileText = Card.escapeHtml(user.profileText || '');
    const showProfileText = !!user.showProfileText;

    const html = `
      <div class="settings-page">
        <div class="section">
          <div class="section-header">
            <span class="section-title">⚙️ Настройки</span>
          </div>

          <div style="display: grid; gap: 10px;">
            <label style="display: grid; gap: 6px;">
              <span style="font-size: 13px; color: var(--text-secondary);">Имя</span>
              <input id="settings-first-name" type="text" maxlength="64" value="${safeFirstName}" style="
                width: 100%;
                padding: 10px 12px;
                border-radius: 10px;
                border: 1px solid rgba(255,255,255,0.12);
                background: var(--bg-elevated);
                color: var(--text-primary);
                font-size: 14px;
              ">
            </label>

            <label style="display: grid; gap: 6px;">
              <span style="font-size: 13px; color: var(--text-secondary);">Фамилия</span>
              <input id="settings-last-name" type="text" maxlength="64" value="${safeLastName}" style="
                width: 100%;
                padding: 10px 12px;
                border-radius: 10px;
                border: 1px solid rgba(255,255,255,0.12);
                background: var(--bg-elevated);
                color: var(--text-primary);
                font-size: 14px;
              ">
            </label>

            <div style="display: grid; gap: 6px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                <span style="font-size: 13px; color: var(--text-secondary);">Текст профиля</span>
                <span style="font-size: 12px; color: var(--text-muted);" id="char-count">0/48</span>
              </div>
              <div style="display: flex; gap: 8px; align-items: flex-start;">
                <input id="settings-profile-text" type="text" maxlength="48" placeholder="Например: Frontend-разработчик и ментор" value="${safeProfileText}" style="
                  flex: 1;
                  padding: 10px 12px;
                  border-radius: 10px;
                  border: 1px solid rgba(255,255,255,0.12);
                  background: var(--bg-elevated);
                  color: var(--text-primary);
                  font-size: 14px;
                  transition: opacity 0.2s ease;
                  opacity: ${showProfileText ? '1' : '0.5'};
                " onInput="SettingsPage.updateCharCount()">
                <label style="
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  width: 40px;
                  height: 40px;
                  border-radius: 10px;
                  border: 1px solid rgba(255,255,255,0.12);
                  background: var(--bg-elevated);
                  cursor: pointer;
                  transition: all 0.2s ease;
                ">
                  <input id="settings-show-profile-text" type="checkbox" ${showProfileText ? 'checked' : ''} style="
                    display: none;
                  " onchange="SettingsPage.toggleProfileTextVisibility()">
                  <span style="font-size: 18px;" id="toggle-icon">${showProfileText ? '✓' : '✗'}</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-header">
            <span class="section-title">🏷️ Мои бейджи</span>
            <span class="section-action">${badges.length}</span>
          </div>
          ${badges.length === 0
            ? `
              <div style="color: var(--text-secondary); font-size: 14px;">
                Пока нет бейджей.
              </div>
            `
            : `
              <div style="display: flex; flex-wrap: wrap; gap: 8px;" id="badges-list">
                ${renderBadgesListHtml(badges)}
              </div>
            `
          }

          <button class="btn btn-primary" style="margin-top: 16px; width: 100%;" onclick="SettingsPage.saveMyProfile()">
            💾 Сохранить профиль
          </button>
        </div>

        <div class="section">
          <div class="section-header">
            <span class="section-title">🛡️ Управление профилем</span>
          </div>

          <div style="
            color: var(--text-secondary);
            font-size: 13px;
            line-height: 1.4;
            margin-bottom: 12px;
          ">
            Telegram-аккаунт не удаляется. Действия ниже работают только с данными в приложении yourSkills.
          </div>

          <div style="display: grid; gap: 8px;">
            <button
              class="btn btn-full"
              style="background: rgba(255, 159, 10, 0.12); border: 1px solid rgba(255, 159, 10, 0.45); color: #ffbe5c;"
              onclick="SettingsPage.confirmResetProfile()"
            >
              ♻️ Сбросить прогресс профиля
            </button>
          </div>
        </div>
      </div>
    `;

    // Инициализация функций после рендера
    setTimeout(() => {
      AccountPage.updateCharCount();
      AccountPage.toggleProfileTextVisibility();
    }, 0);

    return html;
  }

  async function saveMyProfile() {
    try {
      const firstNameEl = document.getElementById('settings-first-name');
      const lastNameEl = document.getElementById('settings-last-name');
      const profileTextEl = document.getElementById('settings-profile-text');
      const showProfileTextEl = document.getElementById('settings-show-profile-text');

      const firstName = (firstNameEl?.value || '').trim();
      const lastName = (lastNameEl?.value || '').trim();
      const profileText = (profileTextEl?.value || '').trim();
      const showProfileText = !!showProfileTextEl?.checked;

      if (!firstName) {
        App.showToast('Имя не может быть пустым', '⚠️');
        return;
      }

      const badges = settingsBadgesDraft || [];
      const fullBadges = badges.map(b => ({
        code: b.code || (typeof b === 'string' ? b : ''),
        name: b.name || '',
        icon: b.icon || '🏷️',
        color: b.color || '#888',
        visible: b.visible !== false
      })).filter(b => b.code); // Фильтруем пустые коды

      const result = await API.updateMyProfile({
        firstName,
        lastName,
        profileText,
        showProfileText,
        badges: fullBadges
      });
      API.clearCache();
      await App.refreshProfile();
      App.state.user = { ...(App.state.user || {}), ...result.user, isOwn: true };
      const savedAll = result.user?.badgesAll || result.user?.badges;
      if (savedAll) {
        settingsBadgesDraft = cloneBadgesForDraft(savedAll);
      }
      App.showToast(result.message || 'Сохранено', '✅');

      if (Router.currentPath.startsWith('/user/')) {
        const userId = App.state.user.id;
        const html = await renderUserProfile(userId);
        document.getElementById('content').innerHTML = html;
      }
    } catch (error) {
      App.showToast(error.message || 'Ошибка сохранения', '❌');
    }
  }

  function updateCharCount() {
    const textEl = document.getElementById('settings-profile-text');
    const countEl = document.getElementById('char-count');
    if (textEl && countEl) {
      countEl.textContent = (textEl.value || '').length + '/48';
    }
  }

  function toggleProfileTextVisibility() {
    const checkboxEl = document.getElementById('settings-show-profile-text');
    const textEl = document.getElementById('settings-profile-text');
    const iconEl = document.getElementById('toggle-icon');
    
    if (checkboxEl && textEl && iconEl) {
      const isChecked = checkboxEl.checked;
      textEl.style.opacity = isChecked ? '1' : '0.5';
      iconEl.textContent = isChecked ? '✓' : '✗';
    }
  }

  function toggleBadgeVisibility(badgeIndex) {
    const badges = settingsBadgesDraft;
    if (!badges || !badges[badgeIndex]) return;

    badges[badgeIndex].visible = !badges[badgeIndex].visible;

    const badgesList = document.getElementById('badges-list');
    if (badgesList) {
      badgesList.innerHTML = renderBadgesListHtml(badges);
    }

    if (App.tg?.HapticFeedback) {
      App.tg.HapticFeedback.impactOccurred('light');
    }
  }

  async function confirmResetProfile() {
    const ok = window.confirm(
      'Сбросить прогресс профиля?\n\nБудут удалены навыки, чекины, достижения и подписки в приложении. Telegram-аккаунт не затронется.'
    );
    if (!ok) return;

    try {
      const result = await API.resetMyProfile();
      await App.refreshProfile();
      App.showToast(result.message || 'Профиль сброшен', '♻️');
      Router.navigate('/', false);
    } catch (error) {
      App.showToast(error.message || 'Ошибка сброса', '❌');
    }
  }


  /**
   * Подписаться / отписаться
   *
   * @param {number} userId — ID пользователя
   * @param {boolean} isFollowing — текущий статус
   */
  async function toggleFollow(userId, isFollowing) {
    try {
      let result;

      if (isFollowing) {
        result = await API.unfollow(userId);
      } else {
        result = await API.follow(userId);
      }

      // Haptic feedback
      if (App.tg?.HapticFeedback) {
        App.tg.HapticFeedback.impactOccurred('light');
      }

      App.showToast(result.message, isFollowing ? '👋' : '✅');

      // Перерисовываем страницу
      const html = await renderUserProfile(userId);
      document.getElementById('content').innerHTML = html;

    } catch (error) {
      App.showToast(error.message || 'Ошибка', '❌');
    }
  }


  /**
   * Показать подписчиков
   */
  async function showFollowers(userId) {
    try {
      const data = await API.getFollowers(userId);

      let html = '';

      if (data.users.length === 0) {
        html = `
          <div style="text-align: center; padding: 20px; color: var(--text-muted);">
            Нет подписчиков
          </div>
        `;
      } else {
        html = `
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${data.users.map(user => Card.renderUserItem(user)).join('')}
          </div>
        `;
      }

      App.showModal(`Подписчики (${data.total})`, html);

    } catch (error) {
      App.showToast('Ошибка загрузки', '❌');
    }
  }


  /**
   * Показать подписки
   */
  async function showFollowing(userId) {
    try {
      const data = await API.getFollowing(userId);

      let html = '';

      if (data.users.length === 0) {
        html = `
          <div style="text-align: center; padding: 20px; color: var(--text-muted);">
            Нет подписок
          </div>
        `;
      } else {
        html = `
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${data.users.map(user => Card.renderUserItem(user)).join('')}
          </div>
        `;
      }

      App.showModal(`Подписки (${data.total})`, html);

    } catch (error) {
      App.showToast('Ошибка загрузки', '❌');
    }
  }


  /**
   * Подтвердить навык пользователя
   *
   * @param {number} userId — кому подтверждаем
   * @param {number} skillId — какой навык
   * @param {HTMLElement} buttonEl — кнопка (для обновления)
   */
  async function endorseSkill(userId, skillId, buttonEl) {
    try {
      const result = await API.endorse(userId, skillId);

      // Haptic
      if (App.tg?.HapticFeedback) {
        App.tg.HapticFeedback.notificationOccurred('success');
      }

      // Обновляем кнопку
      if (buttonEl) {
        buttonEl.textContent = '✓ Подтверждено';
        buttonEl.disabled = true;
        buttonEl.classList.remove('btn-primary');
        buttonEl.classList.add('btn-secondary');
      }

      App.showToast(result.message, '🤝');

    } catch (error) {
      App.showToast(error.message || 'Ошибка', '❌');
    }
  }


  // ==========================================
  // Публичный интерфейс
  // ==========================================

  return {
    renderSettings,
    renderUserProfile,
    saveMyProfile,
    updateCharCount,
    toggleProfileTextVisibility,
    toggleBadgeVisibility,
    toggleFollow,
    showFollowers,
    showFollowing,
    endorseSkill,
    confirmResetProfile
  };

})();

const SettingsPage = {
  render: () => AccountPage.renderSettings(),
  saveMyProfile: (...args) => AccountPage.saveMyProfile(...args),
  updateCharCount: (...args) => AccountPage.updateCharCount(...args),
  toggleProfileTextVisibility: (...args) => AccountPage.toggleProfileTextVisibility(...args),
  toggleBadgeVisibility: (...args) => AccountPage.toggleBadgeVisibility(...args),
  confirmResetProfile: (...args) => AccountPage.confirmResetProfile(...args)
};

const UserProfilePage = {
  render: (userId) => AccountPage.renderUserProfile(userId),
  toggleFollow: (...args) => AccountPage.toggleFollow(...args),
  showFollowers: (...args) => AccountPage.showFollowers(...args),
  showFollowing: (...args) => AccountPage.showFollowing(...args),
  endorseSkill: (...args) => AccountPage.endorseSkill(...args)
};


// ============================================
// SkillDetailPage — Детальная страница навыка
// ============================================
// Показывает:
// — Подробности навыка (ранг, стрики, календарь)
// — Календарь стриков
// — Список подтвердивших
// — Кнопка подтверждения (для чужого)
// — Каталог навыков (модалка добавления)
// ============================================

const SkillDetailPage = (() => {

  /**
   * Рендер страницы навыка
   */
  async function render(skillId) {
    try {
      // Загружаем данные параллельно
      const [details, history, endorsements] = await Promise.all([
        API.getSkillDetails(skillId),
        API.getStreakHistory(skillId).catch(() => null),
        API.getEndorsements(App.state.user.id, skillId).catch(() => null)
      ]);

      Router.updateBackButton();

      const rank = (details.rank || 'E').toLowerCase();

      return `
        <div class="skill-detail-page">

          <!-- Заголовок навыка -->
          <div class="profile-card rank-${rank}" style="margin-bottom: 16px;">
            <div style="text-align: center;">
              <div style="font-size: 36px; margin-bottom: 8px;">
                ${details.categoryIcon}
              </div>
              <div style="font-size: 22px; font-weight: 700; margin-bottom: 4px;">
                ${Card.escapeHtml(details.name)}
              </div>
              <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 12px;">
                ${Card.escapeHtml(details.category)}
                ${details.activeYears > 0
                  ? ` · ${details.activeYears} ${Card.pluralYears(details.activeYears)} опыта`
                  : ''
                }
              </div>

              <!-- Большой бейдж ранга -->
              <div class="card-rank-badge rank-${rank}" style="
                width: 64px; height: 64px; font-size: 32px;
                margin: 0 auto 12px;
              ">
                ${details.rank}
              </div>

            </div>
          </div>

          <!-- Стрик -->
          ${renderStreakSection(details, history)}

          <!-- Календарь -->
          ${history ? renderCalendar(history) : ''}

          <!-- Подтверждения -->
          ${endorsements ? renderEndorsementsSection(endorsements, skillId) : ''}

          <!-- Кнопка удаления -->
          <div style="margin-top: 24px;">
            <button
              class="btn btn-danger btn-full"
              onclick="SkillDetailPage.confirmDelete(${skillId}, '${Card.escapeHtml(details.name)}')"
            >
              🗑 Удалить навык
            </button>
          </div>

        </div>
      `;

    } catch (error) {
      console.error('❌ Ошибка деталей навыка:', error);
      return `
        <div class="empty-state">
          <div class="empty-icon">❌</div>
          <div class="empty-title">Ошибка загрузки</div>
          <button class="btn btn-primary" data-link href="/">На главную</button>
        </div>
      `;
    }
  }


  /**
   * Секция стрика
   */
  function renderStreakSection(details, history) {
    return `
      <div class="section">
        <div style="
          display: flex;
          justify-content: space-around;
          padding: 16px;
          background: var(--bg-card);
          border-radius: var(--radius-lg);
        ">
          <div style="text-align: center;">
            <div style="font-size: 24px; font-weight: 700; color: var(--streak-fire);">
              🔥 ${details.streak}
            </div>
            <div style="font-size: 12px; color: var(--text-secondary);">
              Текущий стрик
            </div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 24px; font-weight: 700;">
              ${details.bestStreak}
            </div>
            <div style="font-size: 12px; color: var(--text-secondary);">
              Лучший стрик
            </div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 24px; font-weight: 700; color: var(--accent-light);">
              x${details.multiplier}
            </div>
            <div style="font-size: 12px; color: var(--text-secondary);">
              Множитель
            </div>
          </div>
        </div>
      </div>
    `;
  }


  /**
   * Календарь стриков (90 дней)
   */
  function renderCalendar(history) {
    if (!history || !history.calendar) return '';

    return `
      <div class="section">
        <div class="section-header">
          <span class="section-title">📅 Последние 90 дней</span>
          <span style="font-size: 13px; color: var(--text-secondary);">
            ${history.totalCheckins} чекинов
          </span>
        </div>
        <div class="streak-calendar">
          ${history.calendar.map(day => `
            <div
              class="streak-day ${day.checked ? 'active' : ''}"
              title="${day.date}"
            ></div>
          `).join('')}
        </div>
      </div>
    `;
  }


  /**
   * Секция подтверждений
   */
  function renderEndorsementsSection(data, skillId) {
    const rankLabel = (endorser) => {
      if (endorser.rankLabel) return endorser.rankLabel;
      const rawRank = endorser.skillRank || endorser.overallRank || endorser.rank || null;
      if (!rawRank) return 'Ранг F';
      return `Ранг ${rawRank}`;
    };

    return `
      <div class="section">
        <div class="section-header">
          <span class="section-title">🤝 Подтверждения (${data.totalCount})</span>
        </div>

        ${data.endorsers.length > 0 ? `
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${data.endorsers.slice(0, 5).map(e => `
              <div class="user-item" data-link href="/user/${e.id}">
                <img
                  class="user-avatar"
                  src="${Card.escapeHtml(App.getAvatarUrl(e))}"
                  alt=""
                  onerror="this.src='https://api.dicebear.com/7.x/avataaars/svg?seed=${e.id}'"
                >
                <div class="skill-info">
                  <div class="user-name">${Card.escapeHtml(e.firstName)}</div>
                  <div style="font-size: 12px; color: var(--text-secondary);">
                    ${rankLabel(e)}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div style="
            text-align: center;
            padding: 20px;
            color: var(--text-muted);
            background: var(--bg-card);
            border-radius: var(--radius-md);
          ">
            Пока нет подтверждений
          </div>
        `}
      </div>
    `;
  }


  /**
   * Показать каталог навыков для добавления
   */
    async function showCatalog() {
    try {
      const catalog = await API.getCatalog();

      let categoriesHtml = '';

      catalog.forEach(cat => {
        let skillsHtml = '';

        // Теперь навыки внутри подкатегорий
        if (cat.subcategories) {
          cat.subcategories.forEach(sub => {
            skillsHtml += `
              <div class="subcategory-header" style="
                font-size: 13px;
                font-weight: 600;
                color: var(--text-secondary);
                padding: 8px 0 4px 0;
                margin-top: 8px;
              ">
                ${sub.icon} ${Card.escapeHtml(sub.name)}
              </div>
            `;

            if (sub.skills) {
              sub.skills.forEach(skill => {
                skillsHtml += `
                  <div
                    class="skill-item catalog-skill"
                    data-name="${Card.escapeHtml(skill.name.toLowerCase())}"
                    onclick="SkillDetailPage.promptAddSkill(${skill.id}, '${Card.escapeHtml(skill.name).replace(/'/g, "\\'")}')"
                  >
                    <div class="skill-icon">${sub.icon || cat.icon}</div>
                    <div class="skill-info">
                      <div class="skill-name">${Card.escapeHtml(skill.name)}</div>
                      <div class="skill-meta">${Card.escapeHtml(skill.description || '')}</div>
                    </div>
                    <div style="color: var(--accent-light); font-size: 20px;">+</div>
                  </div>
                `;
              });
            }
          });
        }

        categoriesHtml += `
          <div class="section catalog-category" data-category="${Card.escapeHtml(cat.slug)}">
            <div class="section-header" style="cursor: pointer;"
              onclick="this.parentElement.classList.toggle('collapsed')"
            >
              <span class="section-title">${cat.icon} ${Card.escapeHtml(cat.name)}</span>
              <span style="font-size: 12px; color: var(--text-muted);">
                ${cat.subcategories ? cat.subcategories.reduce((s, sub) => s + (sub.skills ? sub.skills.length : 0), 0) : 0} навыков
              </span>
            </div>
            <div class="catalog-skills-list">
              ${skillsHtml}
            </div>
          </div>
        `;
      });

      const html = `
        <!-- Поиск -->
        <div class="search-input-wrap" style="margin-bottom: 16px;">
          <span class="search-icon">🔍</span>
          <input
            class="search-input"
            placeholder="Поиск навыка..."
            oninput="SkillDetailPage.filterCatalog(this.value)"
          >
        </div>

        <!-- Стиль для сворачивания -->
        <style>
          .catalog-category.collapsed .catalog-skills-list {
            display: none;
          }
          .catalog-category.collapsed .section-header::after {
            content: '▸';
            margin-left: 8px;
          }
          .catalog-category .section-header::after {
            content: '▾';
            margin-left: 8px;
            font-size: 12px;
          }
        </style>

        <!-- Категории -->
        <div id="catalog-content">
          ${categoriesHtml}
        </div>
      `;

      App.showModal('Добавить навык', html);

      // Сворачиваем все категории кроме первой
      setTimeout(() => {
        const cats = document.querySelectorAll('.catalog-category');
        cats.forEach((cat, i) => {
          if (i > 0) cat.classList.add('collapsed');
        });
      }, 100);

    } catch (error) {
      console.error('❌ Каталог:', error);
      App.showToast('Ошибка загрузки каталога', '❌');
    }
  }


  /**
   * Фильтрация каталога по поиску
   */
  function filterCatalog(query) {
    const items = document.querySelectorAll('.catalog-skill');
    const categories = document.querySelectorAll('.catalog-category');
    const q = query.toLowerCase().trim();

    if (!q) {
      // Показываем всё
      items.forEach(el => el.style.display = '');
      categories.forEach(el => el.style.display = '');
      return;
    }

    // Скрываем не подходящие
    categories.forEach(cat => {
      const skills = cat.querySelectorAll('.catalog-skill');
      let hasVisible = false;

      skills.forEach(skill => {
        const name = skill.dataset.name || '';
        if (name.includes(q)) {
          skill.style.display = '';
          hasVisible = true;
        } else {
          skill.style.display = 'none';
        }
      });

      cat.style.display = hasVisible ? '' : 'none';
    });
  }


  /**
   * Запрос стажа перед добавлением навыка
   */
    function promptAddSkill(skillId, skillName) {
    const html = `
      <div style="padding: 8px 0;">
        <div style="margin-bottom: 20px; text-align: center;">
          <div style="font-size: 18px; font-weight: 600; margin-bottom: 4px;">
            ${Card.escapeHtml(skillName)}
          </div>
        </div>

        <!-- Общий стаж -->
        <div style="margin-bottom: 16px;">
          <label style="font-size: 13px; color: var(--text-secondary); display: block; margin-bottom: 6px;">
            📅 Знакомы с навыком (общий стаж)
          </label>
          <input
            type="number"
            id="total-years-input"
            class="search-input"
            placeholder="Например: 5"
            min="0" max="80" step="0.5"
            value="0"
            style="text-align: center; font-size: 20px;"
            oninput="SkillDetailPage.validateYears()"
          >
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px; text-align: center;">
            Сколько лет назад впервые столкнулись
          </div>
        </div>

        <!-- Реальный опыт -->
        <div style="margin-bottom: 16px;">
          <label style="font-size: 13px; color: var(--text-secondary); display: block; margin-bottom: 6px;">
            💪 Реально практиковали (активный опыт)
          </label>
          <input
            type="number"
            id="active-years-input"
            class="search-input"
            placeholder="Например: 2"
            min="0" max="80" step="0.5"
            value="0"
            style="text-align: center; font-size: 20px;"
            oninput="SkillDetailPage.validateYears()"
          >
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px; text-align: center;">
            Сколько лет реально работали/практиковали (без перерывов)
          </div>
        </div>

        <!-- Быстрый выбор -->
        <div style="margin-bottom: 8px; font-size: 12px; color: var(--text-secondary);">
          Быстрый выбор (общий / активный):
        </div>
        <div style="display: flex; gap: 6px; margin-bottom: 20px; flex-wrap: wrap; justify-content: center;">
          <button class="btn btn-secondary btn-sm" onclick="SkillDetailPage.setYears(0, 0)">Новичок</button>
          <button class="btn btn-secondary btn-sm" onclick="SkillDetailPage.setYears(1, 0.5)">1 / 0.5</button>
          <button class="btn btn-secondary btn-sm" onclick="SkillDetailPage.setYears(2, 1)">2 / 1</button>
          <button class="btn btn-secondary btn-sm" onclick="SkillDetailPage.setYears(3, 2)">3 / 2</button>
          <button class="btn btn-secondary btn-sm" onclick="SkillDetailPage.setYears(5, 3)">5 / 3</button>
          <button class="btn btn-secondary btn-sm" onclick="SkillDetailPage.setYears(10, 5)">10 / 5</button>
          <button class="btn btn-secondary btn-sm" onclick="SkillDetailPage.setYears(15, 10)">15 / 10</button>
          <button class="btn btn-secondary btn-sm" onclick="SkillDetailPage.setYears(20, 15)">20 / 15</button>
        </div>

        <!-- Ошибка валидации -->
        <div id="years-error" style="
          color: var(--rank-s);
          font-size: 13px;
          text-align: center;
          margin-bottom: 12px;
          display: none;
        "></div>

        <button
          class="btn btn-primary btn-full"
          id="add-skill-btn"
          onclick="SkillDetailPage.addSkill(${skillId})"
        >
          Добавить навык
        </button>
      </div>
    `;

    App.showModal('Добавить навык', html);
  }


  function setYears(total, active) {
    document.getElementById('total-years-input').value = total;
    document.getElementById('active-years-input').value = active;
    validateYears();
  }


  function validateYears() {
    const total = parseFloat(document.getElementById('total-years-input').value) || 0;
    const active = parseFloat(document.getElementById('active-years-input').value) || 0;
    const errorEl = document.getElementById('years-error');
    const btnEl = document.getElementById('add-skill-btn');

    if (active > total) {
      errorEl.textContent = 'Активный опыт не может быть больше общего стажа';
      errorEl.style.display = 'block';
      btnEl.disabled = true;
    } else {
      errorEl.style.display = 'none';
      btnEl.disabled = false;
    }
  }


  /**
   * Добавить навык
   */
    async function addSkill(skillId) {
    const totalYears = parseFloat(document.getElementById('total-years-input')?.value) || 0;
    const activeYears = parseFloat(document.getElementById('active-years-input')?.value) || 0;

    if (activeYears > totalYears) {
      App.showToast('Активный опыт не может быть больше общего', '❌');
      return;
    }

    try {
      const result = await API.addSkill(skillId, totalYears, activeYears);

      App.hideModal();
      App.showToast(result.message, '🌱');

      if (App.tg?.HapticFeedback) {
        App.tg.HapticFeedback.notificationOccurred('success');
      }

      await App.refreshProfile();
      Router.refresh();

    } catch (error) {
      App.showToast(error.message || 'Ошибка', '❌');
    }
  }


  /**
   * Подтверждение удаления навыка
   */
  function confirmDelete(skillId, skillName) {
    const html = `
      <div style="text-align: center; padding: 16px 0;">
        <div style="font-size: 48px; margin-bottom: 12px;">⚠️</div>
        <div style="font-size: 16px; margin-bottom: 8px;">
          Удалить навык <strong>${Card.escapeHtml(skillName)}</strong>?
        </div>
        <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 20px;">
          Все чекины и подтверждения будут удалены.
          Это действие нельзя отменить.
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary btn-full" onclick="App.hideModal()">
            Отмена
          </button>
          <button class="btn btn-danger btn-full" onclick="SkillDetailPage.deleteSkill(${skillId})">
            Удалить
          </button>
        </div>
      </div>
    `;

    App.showModal('Удаление навыка', html);
  }


  /**
   * Удалить навык
   */
  async function deleteSkill(skillId) {
    try {
      await API.deleteSkill(skillId);

      App.hideModal();
      App.showToast('Навык удалён', '🗑');

      await App.refreshProfile();
      Router.refresh();

    } catch (error) {
      App.showToast(error.message || 'Ошибка', '❌');
    }
  }


  return {
    render,
    showCatalog,
    filterCatalog,
    promptAddSkill,
    addSkill,
    confirmDelete,
    deleteSkill,
    setYears,
    validateYears
  };

})();
