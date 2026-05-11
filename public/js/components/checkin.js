// ============================================
// checkin.js — Экран ежедневного чекина
// ============================================
// Самый важный экран для вовлечённости.
// Пользователь видит список своих навыков
// и отмечает какие практиковал сегодня.
//
// Механика:
// — Большая кнопка 🔥 для каждого навыка
// — Показывает потенциальный XP до нажатия
// — Анимация и haptic feedback при чекине
// — Заметка (необязательно)
// — Статус: сколько отмечено из всех
// ============================================

const CheckinPage = (() => {

  /**
   * Рендер страницы чекина
   */
  async function render() {
    try {
      // Получаем статус на сегодня
      const data = await API.getTodayStatus();

      return `
        <div class="checkin-page">

          <!-- Заголовок с датой и прогрессом -->
          ${renderHeader(data)}

          <!-- Мотивационное сообщение -->
          ${renderMotivation(data.summary)}

          <!-- Список навыков для чекина -->
          <div class="checkin-list" id="checkin-list">
            ${data.skills.map(skill => renderCheckinItem(skill)).join('')}
          </div>

          <!-- Пустое состояние -->
          ${data.skills.length === 0 ? renderEmpty() : ''}

        </div>
      `;

    } catch (error) {
      console.error('❌ Ошибка загрузки чекина:', error);
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
   * Заголовок: дата + прогресс
   */
  function renderHeader(data) {
    const today = new Date();
    const dayNames = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда',
                      'Четверг', 'Пятница', 'Суббота'];
    const monthNames = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                        'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

    const dayName = dayNames[today.getDay()];
    const day = today.getDate();
    const month = monthNames[today.getMonth()];

    const { checked, total, allDone } = data.summary;

    return `
      <div class="checkin-header">
        <div class="checkin-date">
          <div class="checkin-day-name">${dayName}</div>
          <div class="checkin-day-number">${day} ${month}</div>
        </div>

        <div class="checkin-progress">
          <div class="checkin-progress-circle ${allDone ? 'all-done' : ''}">
            <span class="checkin-progress-text">${checked}/${total}</span>
          </div>
        </div>
      </div>

      <style>
        .checkin-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
          padding: 16px;
          background: var(--bg-card);
          border-radius: var(--radius-lg);
        }
        .checkin-day-name {
          font-size: 14px;
          color: var(--text-secondary);
        }
        .checkin-day-number {
          font-size: 22px;
          font-weight: 700;
        }
        .checkin-progress-circle {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          border: 3px solid var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all var(--transition-normal);
        }
        .checkin-progress-circle.all-done {
          border-color: var(--rank-d);
          background: var(--rank-d-glow);
          animation: done-pulse 1.5s ease-in-out infinite;
        }
        @keyframes done-pulse {
          0%, 100% { box-shadow: 0 0 10px var(--rank-d-glow); }
          50% { box-shadow: 0 0 25px var(--rank-d-glow); }
        }
        .checkin-progress-text {
          font-size: 16px;
          font-weight: 700;
        }
      </style>
    `;
  }


  /**
   * Мотивационное сообщение
   */
  function renderMotivation(summary) {
    const { checked, total, allDone } = summary;

    if (total === 0) return '';

    let text, icon;

    if (allDone) {
      const messages = [
        '🎉 Все навыки отмечены! Великолепно!',
        '⚡ Полный чекин! Ты машина!',
        '🔥 Всё сделано! Стрики растут!',
        '💪 Отличная работа! До завтра!',
        '🏆 100% — ты на пути к мастерству!'
      ];
      text = messages[Math.floor(Math.random() * messages.length)];
      icon = '';
    } else if (checked === 0) {
      text = 'Отметь свой прогресс за сегодня';
      icon = '👇';
    } else {
      const remaining = total - checked;
      text = `Осталось ${remaining} ${Card.pluralDays(remaining).replace('дн', 'навык').replace('ей','ов').replace('я','а')}`;
      icon = '💪';
    }

    return `
      <div class="checkin-motivation" style="
        text-align: center;
        padding: 12px;
        margin-bottom: 16px;
        font-size: 15px;
        color: var(--text-secondary);
      ">
        ${icon} ${text}
      </div>
    `;
  }


  /**
   * Один элемент навыка для чекина
   */
  function renderCheckinItem(skill) {
    const isChecked = skill.checkedIn;
    const rank = (skill.rank || 'E').toLowerCase();

    return `
      <div
        class="checkin-item ${isChecked ? 'checked' : 'unchecked'}"
        id="checkin-skill-${skill.skillId}"
      >
        <!-- Кнопка чекина -->
        <button
          class="checkin-button ${isChecked ? 'done' : ''}"
          onclick="CheckinPage.doCheckin(${skill.skillId}, this)"
          ${isChecked ? 'disabled' : ''}
        >
          ${isChecked ? '✓' : '🔥'}
        </button>

        <!-- Информация о навыке -->
        <div class="skill-info" style="flex: 1;">
          <div class="skill-name">
            ${skill.categoryIcon} ${Card.escapeHtml(skill.name)}
          </div>
          <div class="skill-meta">
            Ранг ${skill.rank} · ${App.formatNumber(skill.totalXP)} XP
            ${skill.streak > 0
              ? ` · 🔥 ${skill.streak} ${Card.pluralDays(skill.streak)}`
              : ''
            }
          </div>

          <!-- Потенциальный XP (если ещё не отмечен) -->
          ${!isChecked && skill.potentialXP > 0
            ? `<div class="checkin-potential">
                 +${skill.potentialXP} XP за практику
               </div>`
            : ''
          }
        </div>

        <!-- Множитель стрика -->
        ${skill.multiplier > 1
          ? `<div class="streak-multiplier" style="
               font-size: 12px;
               color: var(--streak-fire);
               font-weight: 700;
               background: rgba(255, 107, 53, 0.1);
               padding: 4px 8px;
               border-radius: 8px;
             ">
               x${skill.multiplier}
             </div>`
          : ''
        }
      </div>
    `;
  }


  /**
   * Пустое состояние (нет навыков)
   */
  function renderEmpty() {
    return `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-title">Нет навыков</div>
        <div class="empty-text">
          Добавь навыки чтобы отслеживать прогресс
        </div>
        <button
          class="btn btn-primary"
          onclick="SkillDetailPage.showCatalog()"
        >
          + Добавить навык
        </button>
      </div>
    `;
  }


  // ==========================================
  // Действия
  // ==========================================

  /**
   * Выполнить чекин по навыку
   *
   * @param {number} skillId — ID навыка
   * @param {HTMLElement} buttonEl — кнопка (для анимации)
   */
  async function doCheckin(skillId, buttonEl) {
    // Блокируем кнопку чтобы не нажали дважды
    if (buttonEl.disabled) return;
    buttonEl.disabled = true;

    try {
      // Отправляем чекин на сервер
      const result = await API.checkin(skillId);

      // Haptic feedback — успех!
      if (App.tg?.HapticFeedback) {
        App.tg.HapticFeedback.notificationOccurred('success');
      }

      // Анимация кнопки
      buttonEl.classList.add('done');
      buttonEl.textContent = '✓';

      // Обновляем элемент
      const itemEl = document.getElementById(`checkin-skill-${skillId}`);
      if (itemEl) {
        itemEl.classList.remove('unchecked');
        itemEl.classList.add('checked');

        // Анимация появления XP
        const xpPopup = document.createElement('div');
        xpPopup.textContent = `+${result.streak.earnedXP} XP`;
        xpPopup.style.cssText = `
          position: absolute;
          right: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--rank-d);
          font-weight: 700;
          font-size: 16px;
          animation: xp-fly 1s ease-out forwards;
          pointer-events: none;
        `;
        itemEl.style.position = 'relative';
        itemEl.appendChild(xpPopup);

        // Убираем popup через секунду
        setTimeout(() => xpPopup.remove(), 1000);

        // Обновляем мета-информацию
        const metaEl = itemEl.querySelector('.skill-meta');
        if (metaEl) {
          metaEl.textContent = `Ранг ${result.skill.rank} · ${App.formatNumber(result.skill.totalXP)} XP · 🔥 ${result.streak.current} ${Card.pluralDays(result.streak.current)}`;
        }

        // Убираем потенциальный XP
        const potentialEl = itemEl.querySelector('.checkin-potential');
        if (potentialEl) potentialEl.remove();
      }

      // Toast
      App.showToast(result.message, '🔥');

      // Обновляем счётчик в заголовке
      updateHeaderCounter();

      // Обновляем состояние приложения
      await App.refreshProfile();

    } catch (error) {
      // Разблокируем кнопку при ошибке
      buttonEl.disabled = false;

      if (error.data?.alreadyCheckedIn) {
        App.showToast('Уже отмечено сегодня', '✅');
        buttonEl.classList.add('done');
        buttonEl.textContent = '✓';
      } else {
        App.showToast(error.message || 'Ошибка', '❌');
        console.error('❌ Ошибка чекина:', error);
      }
    }
  }


  /**
   * Обновить счётчик в заголовке после чекина
   */
  function updateHeaderCounter() {
    const circle = document.querySelector('.checkin-progress-text');
    if (!circle) return;

    const [checked, total] = circle.textContent.split('/').map(Number);
    const newChecked = checked + 1;

    circle.textContent = `${newChecked}/${total}`;

    // Если всё отмечено — зелёная анимация
    if (newChecked >= total) {
      const circleWrap = document.querySelector('.checkin-progress-circle');
      if (circleWrap) {
        circleWrap.classList.add('all-done');
      }

      // Обновляем мотивацию
      const motiv = document.querySelector('.checkin-motivation');
      if (motiv) {
        motiv.textContent = '🎉 Все навыки отмечены! Великолепно!';
      }
    }
  }


  // ==========================================
  // Добавляем CSS-анимацию для XP
  // ==========================================

  const style = document.createElement('style');
  style.textContent = `
    @keyframes xp-fly {
      0% {
        opacity: 1;
        transform: translateY(-50%) scale(1);
      }
      100% {
        opacity: 0;
        transform: translateY(-100%) scale(1.5);
      }
    }
  `;
  document.head.appendChild(style);


  // ==========================================
  // Публичный интерфейс
  // ==========================================

  return {
    render,
    doCheckin
  };

})();


// ============================================
// HomePage — Главная страница
// ============================================
// Показывает:
// — Свою карточку
// — Быстрый чекин (неотмеченные навыки)
// — Краткую ленту последних событий
// ============================================

// ============================================
// HomePage — Главная страница (ПЕРЕДЕЛАНА)
// ============================================

const HomePage = (() => {

  async function render() {
    try {
      const [profileData, todayData] = await Promise.all([
        API.getMyProfile(),
        API.getTodayStatus()
      ]);

      App.state.user = profileData.user;

      const user = profileData.user;
      const stats = profileData.stats;
      const rank = (user.overallRank || 'F').toLowerCase();
      const unchecked = todayData.skills.filter(s => !s.checkedIn);
      const checked = todayData.skills.filter(s => s.checkedIn);

      // Последние достижения (3 штуки)
      const recentAchievements = (profileData.achievements || []).slice(0, 3);

      // Активные стрики (топ 3)
      const topStreaks = todayData.skills
        .filter(s => s.streak > 0)
        .sort((a, b) => b.streak - a.streak)
        .slice(0, 3);

      return `
        <div class="home-page">

          <!-- Приветствие + ранг -->
          <div class="home-header">
            <div class="home-greeting">
              <div class="home-hello">Привет, ${Card.escapeHtml(user.firstName)}! 👋</div>
              <div class="home-date">${formatDate()}</div>
            </div>
            <div class="card-rank-badge rank-${rank}" style="width:48px;height:48px;font-size:24px;">
              ${user.overallRank || 'F'}
            </div>
          </div>

          <!-- Быстрая статистика -->
          <div class="home-stats-row">
            <div class="home-stat-card">
              <div class="home-stat-value">${App.formatNumber(user.overallXP || 0)}</div>
              <div class="home-stat-label">XP</div>
            </div>
            <div class="home-stat-card">
              <div class="home-stat-value">${stats?.totalSkills || 0}</div>
              <div class="home-stat-label">Навыки</div>
            </div>
            <div class="home-stat-card">
              <div class="home-stat-value">${topStreaks.length > 0 ? '🔥' : '—'}</div>
              <div class="home-stat-label">${topStreaks.length} стриков</div>
            </div>
            <div class="home-stat-card">
              <div class="home-stat-value">${profileData.achievements?.length || 0}</div>
              <div class="home-stat-label">Ачивки</div>
            </div>
          </div>

          <!-- XP прогресс -->
          ${user.overallRankInfo ? Card.renderXPBar(user.overallRankInfo) : ''}

          <!-- ===== ЧЕКИН СЕКЦИЯ ===== -->
          ${renderCheckinSection(unchecked, checked, todayData.summary)}

          <!-- ===== АКТИВНЫЕ СТРИКИ ===== -->
          ${topStreaks.length > 0 ? `
            <div class="section">
              <div class="section-header">
                <span class="section-title">🔥 Активные стрики</span>
              </div>
              <div class="streaks-row">
                ${topStreaks.map(s => `
                  <div class="streak-card">
                    <div class="streak-card-fire">🔥${s.streak}</div>
                    <div class="streak-card-name">${Card.escapeHtml(s.name)}</div>
                    <div class="streak-card-mult">x${s.multiplier}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- ===== ПОСЛЕДНИЕ ДОСТИЖЕНИЯ ===== -->
          ${recentAchievements.length > 0 ? `
            <div class="section">
              <div class="section-header">
                <span class="section-title">🏆 Последние достижения</span>
                <span class="section-action" data-link href="/profile">Все →</span>
              </div>
              <div class="achievements-row">
                ${recentAchievements.map(a => `
                  <div class="achievement-card">
                    <div class="achievement-card-icon">${a.icon}</div>
                    <div class="achievement-card-name">${Card.escapeHtml(a.name)}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- ===== БЫСТРЫЕ ССЫЛКИ ===== -->
          <div class="home-actions">
            <button class="home-action-btn" data-link href="/search">
              <span>🔍</span>
              <span>Найти людей</span>
            </button>
            <button class="home-action-btn" data-link href="/feed">
              <span>📢</span>
              <span>Лента</span>
            </button>
          </div>

        </div>

        <style>
          .home-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
          }
          .home-hello {
            font-size: 22px;
            font-weight: 700;
          }
          .home-date {
            font-size: 13px;
            color: var(--text-secondary);
            margin-top: 2px;
          }
          .home-stats-row {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
            margin-bottom: 16px;
          }
          .home-stat-card {
            background: var(--bg-card);
            border-radius: var(--radius-md);
            padding: 12px 8px;
            text-align: center;
          }
          .home-stat-value {
            font-size: 18px;
            font-weight: 700;
          }
          .home-stat-label {
            font-size: 11px;
            color: var(--text-muted);
            margin-top: 2px;
          }
          .streaks-row, .achievements-row {
            display: flex;
            gap: 8px;
            overflow-x: auto;
            padding-bottom: 4px;
          }
          .streak-card {
            flex-shrink: 0;
            background: var(--bg-card);
            border-radius: var(--radius-md);
            padding: 12px;
            text-align: center;
            min-width: 100px;
          }
          .streak-card-fire {
            font-size: 20px;
            font-weight: 700;
            color: var(--streak-fire);
          }
          .streak-card-name {
            font-size: 12px;
            color: var(--text-secondary);
            margin-top: 4px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 100px;
          }
          .streak-card-mult {
            font-size: 11px;
            color: var(--accent-light);
            font-weight: 600;
            margin-top: 2px;
          }
          .achievement-card {
            flex-shrink: 0;
            background: var(--bg-card);
            border-radius: var(--radius-md);
            padding: 12px;
            text-align: center;
            min-width: 90px;
          }
          .achievement-card-icon {
            font-size: 28px;
          }
          .achievement-card-name {
            font-size: 11px;
            color: var(--text-secondary);
            margin-top: 4px;
          }
          .home-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-top: 8px;
          }
          .home-action-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 14px;
            background: var(--bg-card);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: var(--radius-md);
            color: var(--text-primary);
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all var(--transition-fast);
          }
          .home-action-btn:active {
            transform: scale(0.97);
            background: var(--bg-elevated);
          }
          .checkin-section {
            background: var(--bg-card);
            border-radius: var(--radius-lg);
            padding: 16px;
            margin-bottom: 16px;
          }
          .checkin-section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
          }
          .checkin-section-title {
            font-size: 15px;
            font-weight: 700;
          }
          .checkin-section-counter {
            font-size: 13px;
            color: var(--text-secondary);
          }
        </style>
      `;

    } catch (error) {
      console.error('❌ Главная:', error);
      return `
        <div class="empty-state">
          <div class="empty-icon">❌</div>
          <div class="empty-title">Ошибка загрузки</div>
          <div class="empty-text">${Card.escapeHtml(error.message)}</div>
        </div>
      `;
    }
  }

  function formatDate() {
    const d = new Date();
    const days = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
    const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
    return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
  }

  function renderCheckinSection(unchecked, checked, summary) {
    if (summary.total === 0) {
      return `
        <div class="checkin-section">
          <div style="text-align: center;">
            <div style="font-size: 32px; margin-bottom: 8px;">📋</div>
            <div style="font-weight: 600; margin-bottom: 4px;">Нет навыков</div>
            <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 12px;">
              Добавь навыки чтобы отслеживать прогресс
            </div>
            <button class="btn btn-primary" onclick="SkillDetailPage.showCatalog()">
              + Добавить навык
            </button>
          </div>
        </div>
      `;
    }

    if (summary.allDone) {
      return `
        <div class="checkin-section" style="border: 1px solid var(--rank-d); background: rgba(52,211,153,0.05);">
          <div style="text-align: center;">
            <div style="font-size: 32px; margin-bottom: 8px;">🎉</div>
            <div style="font-weight: 600; color: var(--rank-d);">Все ${summary.total} навыков отмечены!</div>
            <div style="font-size: 13px; color: var(--text-secondary);">
              Приходи завтра
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="checkin-section">
        <div class="checkin-section-header">
          <div class="checkin-section-title">🔥 Отметь прогресс</div>
          <div class="checkin-section-counter">
            ${summary.checked}/${summary.total}
            <a style="color: var(--accent-light); margin-left: 8px; cursor: pointer;"
               data-link href="/checkin">Все →</a>
          </div>
        </div>

        <div class="checkin-list">
          ${unchecked.slice(0, 5).map(s => `
            <div class="checkin-item unchecked" id="checkin-skill-${s.skillId}">
              <button class="checkin-button"
                onclick="CheckinPage.doCheckin(${s.skillId}, this)">
                🔥
              </button>
              <div class="skill-info" style="flex:1;">
                <div class="skill-name">${s.categoryIcon} ${Card.escapeHtml(s.name)}</div>
                <div class="skill-meta">
                  ${s.streak > 0 ? `🔥${s.streak} · ` : ''}+${s.potentialXP} XP
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        ${unchecked.length > 5 ? `
          <div style="text-align: center; margin-top: 8px;">
            <a style="font-size: 13px; color: var(--accent-light); cursor: pointer;"
               data-link href="/checkin">
              Ещё ${unchecked.length - 5} навыков →
            </a>
          </div>
        ` : ''}
      </div>
    `;
  }

  return { render };
})();
