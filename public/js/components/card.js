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
  function renderFull(data, options = {}) {
    const { user, social, stats, categories, achievements } = data;
    const isOwn = isOwnProfile(data);
    const skills = (categories || []).flatMap(c => c.skills || []);
    const rank = (user.overallRank || 'F').replace('+', '').toLowerCase();
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
            ${user.showProfileText && user.profileText
              ? `<div class="card-username" style="opacity:0.9;">${escapeHtml(user.profileText)}</div>`
              : ''
            }
          </div>
          <div class="card-rank-badge rank-${rank}">
            ${user.overallRank || 'E'}
          </div>
        </div>

        ${renderSkillClasses(categories)}
        ${renderUserBadges(user.badges)}

         <!-- Прогресс-бар ранга -->
         ${renderRankBar(user, skills)}

        <!-- Статистика -->
        <div class="card-stats">
          <div class="card-stat">
            <div class="card-stat-value">${App.formatNumber(stats?.totalSkills || 0)}</div>
            <div class="card-stat-label">Навыки</div>
          </div>
          <div
            class="card-stat"
            style="cursor: pointer;"
            onclick="UserProfilePage.showFollowers(${user.id})"
          >
            <div class="card-stat-value">${App.formatNumber(social?.followers || 0)}</div>
            <div class="card-stat-label">Подписчики</div>
          </div>
          <div
            class="card-stat"
            style="cursor: pointer;"
            onclick="UserProfilePage.showFollowing(${user.id})"
          >
            <div class="card-stat-value">${App.formatNumber(social?.following || 0)}</div>
            <div class="card-stat-label">Подписки</div>
          </div>
          <div class="card-stat">
            <div class="card-stat-value">${App.formatNumber(stats?.receivedEndorsements || 0)}</div>
            <div class="card-stat-label">Подтверждения</div>
          </div>
        </div>
      </div>

        <!-- ======== КНОПКИ ДЕЙСТВИЙ ======== -->
      ${renderProfileActions(user, social)}

      <!-- ======== НАВЫКИ ПО КАТЕГОРИЯМ ======== -->
      ${renderCategoriesSection(categories, isOwn)}

      <!-- ======== ДОСТИЖЕНИЯ ======== -->
      ${achievements && achievements.length > 0
        ? renderAchievementsSection(achievements, options)
        : ''
      }
    `;
  }

  function rankTitleByBase(baseRank) {
    const map = {
      D: 'Практик',
      C: 'Знаток',
      B: 'Эксперт',
      A: 'Мастер',
      S: 'Легенда'
    };
    return map[baseRank] || null;
  }

  function extractSkillClasses(categories = []) {
    const skills = (categories || []).flatMap(c => c.skills || []);
    return skills
      .filter(s => s && s.rank && rankTitleByBase(String(s.rank).replace('+', '')))
      .map(s => {
        const baseRank = String(s.rank || 'F').replace('+', '');
        return {
          icon: s.categoryIcon || '📌',
          skillName: s.name || 'Навык',
          rank: s.rank || baseRank,
          baseRank,
          title: s.title || rankTitleByBase(baseRank)
        };
      });
  }

  function renderSkillClassesFromList(skillClasses) {
    if (!Array.isArray(skillClasses) || skillClasses.length === 0) return '';
    return `
      <div class="card-classes-row">
        ${skillClasses.map(item => `
          <div class="card-class-item rank-${item.baseRank.toLowerCase()}">
            <span class="card-class-main">${item.icon} ${escapeHtml(item.skillName)}</span>
            <span class="card-class-meta">${escapeHtml(item.title)} ранга ${escapeHtml(item.rank)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderSkillClasses(categories = []) {
    return renderSkillClassesFromList(extractSkillClasses(categories));
  }

  function normalizeId(id) {
    const num = Number(id);
    return Number.isFinite(num) ? num : String(id);
  }

  function isOwnProfile(data) {
    const user = data?.user || {};
    if (data?.isOwn === true || user?.isOwn === true) return true;
    const appUserId = App?.state?.user?.id;
    if (appUserId == null || user?.id == null) return false;
    return normalizeId(appUserId) === normalizeId(user.id);
  }


  /**
   * Прогресс-бар общего ранга.
   *  SKILL       — overall == max_skill: дни лучшего скилла до следующего ранга
   *  CONVOLUTION — overall > max_skill: "X / 3 скиллов RANK" (как было)
   */
  function renderRankBar(user, skills = []) {
    const RANK_ORDER = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
    const RANK_DAYS  = { F: 0, E: 7, D: 30, C: 90, B: 180, A: 365, S: 730 };
    const baseOf = (r) => String(r || 'F').replace('+', '');
    const idxOf  = (r) => RANK_ORDER.indexOf(baseOf(r));

    const overallBase = baseOf(user.overallBaseRank || user.overallRank || 'F');
    const overallIdx  = idxOf(overallBase);

    // Нет скиллов — показываем нулевой бар к E
    if (!skills || skills.length === 0) {
      return `
        <div class="rank-progress">
          <div class="rank-label">
            <span>0 / 3 скиллов F</span>
            <span>до E</span>
          </div>
          <div class="rank-bar">
            <div class="rank-bar-fill rank-f" style="width: 0%"></div>
          </div>
        </div>
      `;
    }

    // Лучший скилл (skills уже отсортированы DESC по рангу+дням на бэке)
    const top = skills[0];
    const topIdx = idxOf(top.rank);

    // ===== РЕЖИМ SKILL: overall совпадает с лучшим скиллом =====
    if (overallIdx === topIdx && overallBase !== 'S') {
      const topBase = baseOf(top.rank);
      const nextRank = RANK_ORDER[topIdx + 1];
      const curThreshold  = RANK_DAYS[topBase];
      const nextThreshold = RANK_DAYS[nextRank];
      const days = Math.max(0, top.days || 0);

      const span    = Math.max(1, nextThreshold - curThreshold);
      const passed  = Math.max(0, days - curThreshold);
      const percent = Math.min(100, Math.round((passed / span) * 100));

      const skillName = top.name || 'Навык';
      return `
        <div class="rank-progress">
          <div class="rank-label">
            <span>${skillName}: ${days} / ${nextThreshold} дней</span>
            <span>до ${nextRank}</span>
          </div>
          <div class="rank-bar">
            <div class="rank-bar-fill rank-${topBase.toLowerCase()}" style="width: ${percent}%"></div>
          </div>
        </div>
      `;
    }

    // ===== РЕЖИМ CONVOLUTION (как было) =====
    const skillsAtBase = skills.filter(s => baseOf(s.rank) === overallBase).length;
    const current  = Math.min(skillsAtBase, 3);
    const nextRank = RANK_ORDER[overallIdx + 1];
    const percent  = Math.min(100, Math.round((current / 3) * 100));

    return `
      <div class="rank-progress">
        <div class="rank-label">
          <span>${current} / 3 скиллов ${overallBase}</span>
          <span>${nextRank ? `до ${nextRank}` : 'Максимальный ранг'}</span>
        </div>
        <div class="rank-bar">
          <div class="rank-bar-fill rank-${overallBase.toLowerCase()}" style="width: ${percent}%"></div>
        </div>
      </div>
    `;
  }

  /**
   * Публичные бейджи пользователя на карточке (полный профиль — все видимые, без дублей)
   */
  function renderUserBadges(badges) {
    if (!badges || badges.length === 0) return '';
    const cat = typeof BadgeCatalog !== 'undefined' ? BadgeCatalog.BADGE_INFO : null;
    const seen = new Set();
    const list = [];
    for (const raw of badges) {
      const code = typeof raw === 'string'
        ? String(raw).trim()
        : String(raw?.code || '').trim();
      if (!code || seen.has(code)) continue;
      if (cat && !cat[code]) continue;
      const vis = typeof raw === 'string' ? true : raw.visible !== false;
      if (!vis) continue;
      seen.add(code);
      const meta = cat && cat[code]
        ? cat[code]
        : {
            name: (raw && raw.name) || code,
            icon: (raw && raw.icon) || '🏷️',
            color: (raw && raw.color) || '#888',
          };
      list.push({ code, name: meta.name, icon: meta.icon, color: meta.color });
    }
    if (list.length === 0) return '';
    return `
      <div class="card-badges-row">
        ${list.map(item => `
          <div class="card-badge-item" style="
            background: ${item.color}22;
            color: ${item.color};
            border: 1px solid ${item.color}44;
          ">
            ${item.icon} ${escapeHtml(item.name)}
          </div>
        `).join('')}
      </div>
    `;
  }

  /**
   * Компактно: до 3 бейджей по престижу, затем +N (топ, поиск, лента)
   */
  function renderCompactUserBadges(badgeKeys) {
    if (typeof BadgeCatalog === 'undefined') return '';
    const keys = [...new Set(badgeKeys || [])];
    const { show, more } = BadgeCatalog.compactBadgeMeta(keys, 3);
    if (show.length === 0 && more === 0) return '';
    let chips = show.map(key => {
      const b = BadgeCatalog.BADGE_INFO[key];
      return `
        <span class="card-badge-item" style="
          display:inline-flex;align-items:center;gap:4px;
          padding:4px 8px;font-size:12px;font-weight:600;
          background:${b.color}22;color:${b.color};border:1px solid ${b.color}44;
          border-radius:999px;
        ">${b.icon} ${escapeHtml(b.name)}</span>`;
    }).join('');
    if (more > 0) {
      chips += `<span class="card-badge-item" style="
        display:inline-flex;align-items:center;padding:4px 8px;font-size:12px;font-weight:600;
        opacity:0.85;border-radius:999px;border:1px solid rgba(255,255,255,0.15);
      ">+${more}</span>`;
    }
    return `<div class="card-badges-row" style="flex-wrap:wrap;gap:6px;margin-top:2px;">${chips}</div>`;
  }


    /**
   * Кнопки действий: для своего профиля — «Сообщения»,
   * для чужого — «Подписаться» + «Написать» (при взаимной подписке)
   */
  function renderProfileActions(user, social) {
    // Свой профиль — кнопка перехода к диалогам
    if (isOwnProfile({ user })) {
      return `
        <div class="profile-actions" style="display: flex; gap: 8px; margin-bottom: 16px;">
          <button
            class="btn btn-primary btn-full"
            onclick="Router.navigate('/messages')"
          >
            ✉️ Мои сообщения
          </button>
        </div>
      `;
    }

    // Чужой профиль
    const isFollowing = social?.isFollowing;
    const mutualFollow = social?.mutualFollow;

    const messageBtn = mutualFollow
      ? `
        <button
          class="btn btn-secondary btn-full"
          onclick="Router.navigate('/messages/${user.id}')"
          title="Написать сообщение"
        >
          ✉️ Написать
        </button>
      `
      : '';

    return `
      <div class="profile-actions" style="display: flex; gap: 8px; margin-bottom: 16px;">
        <button
          class="btn ${isFollowing ? 'btn-secondary' : 'btn-primary'} btn-full"
          onclick="UserProfilePage.toggleFollow(${user.id}, ${isFollowing})"
        >
          ${isFollowing ? '✓ Вы подписаны' : '+ Подписаться'}
        </button>
        ${messageBtn}
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
    const rank = (skill.rank || 'F').replace('+', '').toLowerCase();
    const days = skill.days || 0;

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
            ${App.formatNumber(days)} ${pluralDays(days)}
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
  function renderAchievementsSection(achievements, options = {}) {
    const collapse = Boolean(options.collapseAchievements);
    const dedupe = Boolean(options.dedupeAchievements);

    const groupedAchievements = dedupe
      ? Array.from(
          achievements.reduce((map, a) => {
            const key = a.id != null
              ? `id:${a.id}`
              : `${a.icon || ''}|${a.name || ''}|${a.description || ''}`;

            if (!map.has(key)) {
              map.set(key, { achievement: a, count: 1 });
            } else {
              map.get(key).count += 1;
            }
            return map;
          }, new Map()).values()
        )
      : achievements.map(a => ({ achievement: a, count: 1 }));

    const headerCount = dedupe ? groupedAchievements.length : achievements.length;
    const previewHtml = collapse
      ? `
        <div class="achievement-preview-wrap">
          <div class="achievement-grid achievement-grid-preview">
            ${groupedAchievements.slice(0, 4).map(({ achievement, count }) => `
              <div class="achievement-item" title="${escapeHtml(achievement.description)}">
                <div class="achievement-icon">${achievement.icon}</div>
                <div class="achievement-name">${escapeHtml(achievement.name)}</div>
                ${count > 1
                  ? `<div style="margin-top: 4px; font-size: 11px; color: var(--text-secondary);">x${count}</div>`
                  : ''
                }
              </div>
            `).join('')}
          </div>
        </div>
      `
      : '';

    const summaryText = collapse
      ? `<summary class="achievement-summary">
           <div class="section-header">
             <span class="section-title">🏆 Достижения</span>
             <span style="display:flex; align-items:center; gap:8px;">
               <span class="section-action">${headerCount}</span>
               <span class="achievement-chevron">▾</span>
             </span>
           </div>
           ${previewHtml}
         </summary>`
      : `<div class="section-header">
           <span class="section-title">🏆 Достижения</span>
           <span class="section-action">${headerCount}</span>
         </div>`;

    const gridHtml = `
      <div class="achievement-grid">
        ${groupedAchievements.map(({ achievement, count }) => `
          <div class="achievement-item" title="${escapeHtml(achievement.description)}">
            <div class="achievement-icon">${achievement.icon}</div>
            <div class="achievement-name">${escapeHtml(achievement.name)}</div>
            ${count > 1
              ? `<div style="margin-top: 4px; font-size: 11px; color: var(--text-secondary);">x${count}</div>`
              : ''
            }
          </div>
        `).join('')}
      </div>
    `;

    return `
      <${collapse ? 'details' : 'div'} class="section ${collapse ? 'achievement-collapsible' : ''}">
        ${summaryText}
        ${gridHtml}
      </${collapse ? 'details' : 'div'}>
      ${collapse ? `
        <style>
          .achievement-collapsible .achievement-summary {
            cursor: pointer;
            list-style: none;
            display: block;
          }
          .achievement-collapsible .achievement-summary::-webkit-details-marker {
            display: none;
          }
          .achievement-collapsible .achievement-chevron {
            transition: transform var(--transition-fast);
            color: var(--text-secondary);
            font-size: 14px;
          }
          .achievement-collapsible[open] .achievement-chevron {
            transform: rotate(180deg);
          }
          .achievement-collapsible .achievement-preview-wrap {
            position: relative;
            margin-top: 8px;
          }
          .achievement-collapsible[open] .achievement-preview-wrap {
            display: none;
          }
          .achievement-collapsible .achievement-grid {
            margin-top: 8px;
          }
          .achievement-collapsible:not([open]) > .achievement-grid {
            display: none;
          }
        </style>
      ` : ''}
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
        style="flex-direction:column;align-items:stretch;"
      >
        <div style="display:flex;align-items:center;gap:12px;width:100%;">
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
        ${renderCompactUserBadges(user.badgeKeys)}
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
    renderRankBar,
    renderSkillItem,
    renderUserItem,
    extractSkillClasses,
    renderSkillClasses,
    renderSkillClassesFromList,
    renderCompactUserBadges,
    renderAchievementsSection,
    escapeHtml,
    pluralYears,
    pluralDays
  };

})();
