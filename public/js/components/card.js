// ============================================
// card.js — Компонент карточки профиля
// ============================================
// Главный визуальный элемент приложения.
// Карточка с аватаром, рангом, навыками,
// подсветкой по рангу и анимациями.
//
// Используется на:
// — Главной странице (своя карточка)
// — Странице профиля (своя/чужая)
// — В результатах поиска (мини-версия)
// ============================================

const Card = (() => {

  /**
   * Полная карточка профиля
   * Большая, с подсветкой по рангу
   *
   * @param {object} data — данные профиля
   * @param {object} data.user — пользователь
   * @param {object} data.social — подписчики/подписки
   * @param {object} data.stats — статистика
   * @param {array} data.categories — категории с навыками
   * @returns {string} — HTML
   */
  function renderFull(data) {
    const { user, social, stats, categories, achievements } = data;
    const rank = (user.overallRank || 'E').toLowerCase();
    const avatarUrl = App.getAvatarUrl(user);

    return `
      <!-- ======== КАРТОЧКА ======== -->
      <div class="profile-card rank-${rank}">

        <!-- Заголовок: аватар + имя + ранг -->
        <div class="card-header">
          <img
            class="card-avatar"
            src="${escapeHtml(avatarUrl)}"
            alt="Аватар"
            onerror="this.src='https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}'"
          >
          <div class="card-info">
            <div class="card-name">${escapeHtml(user.firstName)} ${escapeHtml(user.lastName || '')}</div>
            ${user.username
              ? `<div class="card-username">@${escapeHtml(user.username)}</div>`
              : ''
            }
          </div>
          <div class="card-rank-badge rank-${rank}">
            ${user.overallRank || 'E'}
          </div>
        </div>

        ${renderUserBadges(user.badges)}

        <!-- Прогресс-бар XP -->
        ${renderXPBar(user.overallRankInfo || user)}

        <!-- Статистика -->
        <div class="card-stats">
          <div class="card-stat">
            <div class="card-stat-value">${App.formatNumber(stats?.totalSkills || 0)}</div>
            <div class="card-stat-label">Навыки</div>
          </div>
          <div class="card-stat">
            <div class="card-stat-value">${App.formatNumber(social?.followers || 0)}</div>
            <div class="card-stat-label">Подписчики</div>
          </div>
          <div class="card-stat">
            <div class="card-stat-value">${App.formatNumber(stats?.receivedEndorsements || 0)}</div>
            <div class="card-stat-label">Подтверждения</div>
          </div>
          <div class="card-stat">
            <div class="card-stat-value">${App.formatNumber(user.overallXP || 0)}</div>
            <div class="card-stat-label">XP</div>
          </div>
        </div>
      </div>

      <!-- ======== КНОПКИ ДЕЙСТВИЙ (для чужого профиля) ======== -->
      ${!user.isOwn ? renderProfileActions(user, social) : ''}

      <!-- ======== НАВЫКИ ПО КАТЕГОРИЯМ ======== -->
      ${renderCategoriesSection(categories, user.isOwn)}

      <!-- ======== ДОСТИЖЕНИЯ ======== -->
      ${achievements && achievements.length > 0
        ? renderAchievementsSection(achievements)
        : ''
      }
    `;
  }


  /**
   * Прогресс-бар XP до следующего ранга
   */
  function renderXPBar(rankInfo) {
    // Если передан просто user без rankInfo
    const progress = rankInfo.progress || 0;
    const rank = (rankInfo.rank || rankInfo.overallRank || 'E').toLowerCase();
    const nextRank = rankInfo.nextRank;
    const xp = rankInfo.xp || rankInfo.overallXP || 0;
    const xpToNext = rankInfo.xpToNext || 0;

    return `
      <div class="xp-progress">
        <div class="xp-label">
          <span>${App.formatNumber(xp)} XP</span>
          <span>${nextRank ? `до ${nextRank}: ${App.formatNumber(xpToNext)}` : 'Максимальный ранг!'}</span>
        </div>
        <div class="xp-bar">
          <div
            class="xp-bar-fill rank-${rank}"
            style="width: ${progress}%"
          ></div>
        </div>
      </div>
    `;
  }

  /**
   * Публичные бейджи пользователя на карточке
   */
  function renderUserBadges(badges) {
    if (!badges || badges.length === 0) return '';
    return `
      <div class="card-badges-row">
        ${badges.map(b => `
          <div class="card-badge-item" style="
            background: ${b.color}22;
            color: ${b.color};
            border: 1px solid ${b.color}44;
          ">
            ${b.icon} ${escapeHtml(b.name)}
          </div>
        `).join('')}
      </div>
    `;
  }


  /**
   * Кнопки подписки / подтверждения на чужом профиле
   */
  function renderProfileActions(user, social) {
    const isFollowing = social?.isFollowing;

    return `
      <div class="profile-actions" style="display: flex; gap: 8px; margin-bottom: 16px;">
        <button
          class="btn ${isFollowing ? 'btn-secondary' : 'btn-primary'} btn-full"
          onclick="ProfilePage.toggleFollow(${user.id}, ${isFollowing})"
        >
          ${isFollowing ? '✓ Вы подписаны' : '+ Подписаться'}
        </button>
      </div>
    `;
  }


  /**
   * Секция навыков по категориям
   */
  function renderCategoriesSection(categories, isOwn) {
    if (!categories || categories.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <div class="empty-title">${isOwn ? 'Нет навыков' : 'Навыки не добавлены'}</div>
          ${isOwn
            ? `<div class="empty-text">Добавь свои способности</div>
               <button class="btn btn-primary" onclick="SkillDetailPage.showCatalog()">
                 + Добавить навык
               </button>`
            : ''
          }
        </div>
      `;
    }

    let html = '';

    // Кнопка добавления (для своего профиля)
    if (isOwn) {
      html += `
        <div class="section-header" style="margin-bottom: 12px;">
          <h3 class="section-title">Мои навыки</h3>
          <button class="section-action" onclick="SkillDetailPage.showCatalog()">
            + Добавить
          </button>
        </div>
      `;
    }

    // Рендерим каждую категорию
    categories.forEach(category => {
      html += `
        <div class="section">
          <div class="section-header">
            <span class="section-title">${category.icon} ${escapeHtml(category.name)}</span>
          </div>
          <div class="skill-list">
            ${category.skills.map(skill => renderSkillItem(skill, isOwn)).join('')}
          </div>
        </div>
      `;
    });

    return html;
  }


  /**
   * Одна строка навыка в списке
   */
  function renderSkillItem(skill, isOwn) {
    const rank = (skill.rank || 'E').toLowerCase();
    const totalXP = skill.totalXP || (skill.foundationXP + skill.bonusXP) || 0;

    return `
      <div
        class="skill-item"
        onclick="Router.navigate('/skill/${skill.id}')"
        data-link
      >
        <div class="skill-icon">${skill.categoryIcon || '📌'}</div>
        <div class="skill-info">
          <div class="skill-name">${escapeHtml(skill.name)}</div>
          <div class="skill-meta">
            ${App.formatNumber(totalXP)} XP
            ${skill.experienceYears > 0
              ? ` · ${skill.experienceYears} ${pluralYears(skill.experienceYears)}`
              : ''
            }
          </div>
          ${skill.streak > 0
            ? `<div class="skill-streak">🔥 ${skill.streak} ${pluralDays(skill.streak)}</div>`
            : ''
          }
        </div>
        <div class="skill-rank rank-${rank}">${skill.rank || 'E'}</div>
      </div>
    `;
  }


  /**
   * Секция достижений
   */
  function renderAchievementsSection(achievements) {
    return `
      <div class="section">
        <div class="section-header">
          <span class="section-title">🏆 Достижения</span>
          <span class="section-action">${achievements.length}</span>
        </div>
        <div class="achievement-grid">
          ${achievements.map(a => `
            <div class="achievement-item" title="${escapeHtml(a.description)}">
              <div class="achievement-icon">${a.icon}</div>
              <div class="achievement-name">${escapeHtml(a.name)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }


  /**
   * Мини-карточка пользователя (для списков)
   */
  function renderUserItem(user, options = {}) {
    const avatarUrl = App.getAvatarUrl(user);
    const rank = (user.rank || 'E').toLowerCase();

    return `
      <div
        class="user-item"
        data-link
        href="/user/${user.id}"
      >
        <img
          class="user-avatar"
          src="${escapeHtml(avatarUrl)}"
          alt=""
          onerror="this.src='https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}'"
        >
        <div class="skill-info">
          <div class="user-name">${escapeHtml(user.firstName)} ${escapeHtml(user.lastName || '')}</div>
          <div class="user-rank" style="color: var(--rank-${rank})">
            Ранг ${user.rank || 'E'}
            ${user.xp ? ` · ${App.formatNumber(user.xp)} XP` : ''}
            ${user.skillRank ? ` · ${user.skillRank} в навыке` : ''}
          </div>
        </div>
        ${options.position
          ? `<div class="card-rank-badge rank-${rank}" style="width:32px;height:32px;font-size:14px;">
               #${options.position}
             </div>`
          : `<div class="skill-rank rank-${rank}">${user.rank || 'E'}</div>`
        }
      </div>
    `;
  }


  // ==========================================
  // Вспомогательные функции
  // ==========================================

  /**
   * Экранирование HTML (защита от XSS)
   * Любой пользовательский текст ОБЯЗАТЕЛЬНО
   * пропускаем через эту функцию!
   */
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  /**
   * Склонение слова "год"
   */
  function pluralYears(n) {
    n = Math.floor(n);
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return 'лет';
    if (last > 1 && last < 5) return 'года';
    if (last === 1) return 'год';
    return 'лет';
  }

  /**
   * Склонение слова "день"
   */
  function pluralDays(n) {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return 'дней';
    if (last > 1 && last < 5) return 'дня';
    if (last === 1) return 'день';
    return 'дней';
  }


  // ==========================================
  // Публичный интерфейс
  // ==========================================

  return {
    renderFull,
    renderXPBar,
    renderSkillItem,
    renderUserItem,
    renderAchievementsSection,
    escapeHtml,
    pluralYears,
    pluralDays
  };

})();
