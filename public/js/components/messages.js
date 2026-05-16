// ============================================
// messages.js — Личные сообщения
// ============================================

const MessagesPage = (() => {

  // ==========================================
  // Утилиты
  // ==========================================

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays < 7) {
      return d.toLocaleDateString('ru-RU', { weekday: 'short' });
    }
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  // HTML одного сообщения (используется и в первичном рендере, и при polling)
    function messageHtml(m, myId) {
    const mine = m.from_user_id === myId;
    const text = escapeHtml(m.text);
    const time = formatTime(m.created_at);
    const bg = mine ? 'var(--accent)' : 'var(--bg-card)';
    const color = mine ? '#fff' : 'var(--text-primary)';
    const align = mine ? 'flex-end' : 'flex-start';
    const radius = mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px';
    const timeColor = mine ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)';

    const readIndicator = (mine && !m.is_read) ? `
    <span
        class="msg-read-dot"
        title="Отправлено"
        style="
        flex-shrink:0;
        width:6px;height:6px;
        border-radius:50%;
        background:rgba(255,255,255,0.9);
        margin-bottom:4px;
        "
    ></span>
    ` : '';

    return `
        <div class="msg-row" data-msg-id="${m.id}" style="display:flex;justify-content:${align};margin-bottom:6px;">
        <div style="
            max-width:75%;
            background:${bg};
            color:${color};
            padding:8px 12px;
            border-radius:${radius};
            word-wrap:break-word;
            overflow-wrap:break-word;
            white-space:pre-wrap;
            display:inline-flex;
            align-items:flex-end;
            gap:8px;
            font-size:15px;
            line-height:1.4;
        ">
            <span>${text}</span>
            <span style="
            font-size:11px;
            color:${timeColor};
            flex-shrink:0;
            margin-bottom:1px;
            white-space:nowrap;
            display:inline-flex;
            align-items:center;
            gap:4px;
            ">${time}${readIndicator}</span>
        </div>
        </div>
    `;
    }

  function fullName(u) {
    if (!u) return 'Пользователь';
    return escapeHtml([u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Без имени');
  }

  function avatarHtml(u, size = 48) {
    if (u?.photo_url) {
      return `<img src="${escapeHtml(u.photo_url)}" alt="" style="
        width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;
      ">`;
    }
    const initial = (u?.first_name || u?.username || '?').charAt(0).toUpperCase();
    return `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:var(--accent);color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-weight:600;font-size:${Math.round(size*0.4)}px;flex-shrink:0;
    ">${escapeHtml(initial)}</div>`;
  }

  // ==========================================
  // Экран 1: Список диалогов
  // ==========================================

  async function renderDialogsList() {
    stopPolling(); // выходим из диалога — глушим
    try {
      const data = await API.getDialogs();
      const dialogs = data.dialogs || [];

      if (dialogs.length === 0) {
        return `
          <div style="padding:16px;">
            <h2 style="margin:0 0 16px 0;color:var(--text-primary);">💬 Сообщения</h2>
            <div style="
              background:var(--bg-card);border-radius:12px;padding:32px 16px;text-align:center;
            ">
              <div style="font-size:48px;margin-bottom:12px;">📭</div>
              <div style="color:var(--text-secondary);font-size:15px;">
                Пока нет диалогов
              </div>
              <div style="color:var(--text-muted);font-size:13px;margin-top:8px;">
                Писать можно тем, на кого вы подписаны взаимно
              </div>
            </div>
          </div>
        `;
      }

      const items = dialogs.map(d => {
        const u = d.other_user;
        const name = fullName(u);
        const preview = escapeHtml((d.last_text || '').slice(0, 80));
        const prefix = d.last_from_me ? '<span style="color:var(--text-muted);">Вы: </span>' : '';
        const time = formatTime(d.last_at);
        const unread = d.unread_count > 0
          ? `<div style="
              background:var(--accent);color:#fff;border-radius:10px;
              min-width:20px;height:20px;padding:0 6px;
              display:flex;align-items:center;justify-content:center;
              font-size:12px;font-weight:600;
            ">${d.unread_count}</div>`
          : '';

        return `
          <div onclick="Router.navigate('/messages/${u.id}')" style="
            display:flex;align-items:center;gap:12px;
            padding:12px;background:var(--bg-card);
            border-radius:12px;margin-bottom:8px;cursor:pointer;
          ">
            ${avatarHtml(u, 48)}
            <div style="flex:1;min-width:0;">
              <div style="display:flex;justify-content:space-between;gap:8px;">
                <div style="font-weight:600;color:var(--text-primary);
                  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
                ">${name}</div>
                <div style="font-size:12px;color:var(--text-muted);flex-shrink:0;">${time}</div>
              </div>
              <div style="
                display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:2px;
              ">
                <div style="
                  color:var(--text-secondary);font-size:14px;
                  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
                ">${prefix}${preview}</div>
                ${unread}
              </div>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div style="padding:16px;">
          <h2 style="margin:0 0 16px 0;color:var(--text-primary);">💬 Сообщения</h2>
          ${items}
        </div>
      `;
    } catch (err) {
      console.error(err);
      return `<div style="padding:16px;color:var(--text-muted);">Ошибка загрузки: ${escapeHtml(err.message)}</div>`;
    }
  }

  // ==========================================
  // Экран 2: Диалог с пользователем
  // ==========================================

  async function renderDialog(userId) {
    userId = Number(userId);
    try {
      const data = await API.getMessagesWith(userId);

      // Стартуем polling новых сообщений
      startPolling(userId, data.messages || []);

      // Помечаем прочитанным (fire-and-forget)
      API.markMessagesRead(userId).catch(() => {});

      const u = data.other_user;
      const name = fullName(u);
      const messages = data.messages || [];
      const canSend = !!data.can_send;
      const mutual = !!data.mutual_follow;

      const myId = App.state.user?.id;

      const messagesHtml = messages.length === 0
        ? `<div style="text-align:center;color:var(--text-muted);padding:32px 16px;font-size:14px;">
             Сообщений пока нет. Напишите первым 👋
           </div>`
            : messages.map(m => messageHtml(m, myId)).join('');

      // Подвал — поле ввода или плашка
      let footer = '';
      if (!mutual) {
        footer = `
          <div style="padding:12px;background:var(--bg-card);border-radius:12px;color:var(--text-muted);text-align:center;font-size:14px;">
            Для переписки нужна взаимная подписка
          </div>
        `;
      } else if (!canSend) {
        footer = `
          <div style="padding:12px;background:var(--bg-card);border-radius:12px;color:var(--text-muted);text-align:center;font-size:14px;">
            ⏳ Дождитесь ответа собеседника
          </div>
        `;
      } else {
        footer = `
          <div style="display:flex;gap:8px;align-items:flex-end;">
            <textarea
              id="msg-input"
              placeholder="Сообщение..."
              maxlength="2000"
              rows="1"
              oninput="MessagesPage.autoGrow(this)"
              style="
                flex:1;background:var(--bg-card);color:var(--text-primary);
                border:none;border-radius:18px;padding:10px 14px;
                font-size:15px;resize:none;max-height:120px;outline:none;
                font-family:inherit;
              "></textarea>
            <button
              onclick="MessagesPage.send(${u.id})"
              style="
                background:var(--accent);color:#fff;border:none;
                border-radius:50%;width:40px;height:40px;
                cursor:pointer;font-size:18px;flex-shrink:0;
              "
            >➤</button>
          </div>
        `;
      }

      return `
        <div style="display:flex;flex-direction:column;height:100%;padding:12px;gap:12px;">

          <!-- Шапка -->
          <div style="display:flex;align-items:center;gap:12px;padding:8px;">
            <button onclick="Router.navigate('/messages')" style="
              background:none;border:none;color:var(--accent);font-size:20px;cursor:pointer;padding:0;
            ">←</button>
            <div onclick="Router.navigate('/user/${u.id}')" style="display:flex;align-items:center;gap:10px;cursor:pointer;flex:1;">
              ${avatarHtml(u, 40)}
              <div>
                <div style="font-weight:600;color:var(--text-primary);">${name}</div>
                <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(u.username ? '@' + u.username : '')}</div>
              </div>
            </div>
          </div>

          <!-- Лента сообщений -->
          <div id="messages-list" style="
            flex:1;overflow-y:auto;
            display:flex;flex-direction:column;
            padding:4px 0;
          ">
            ${messagesHtml}
          </div>

          <!-- Подвал -->
            <div id="msg-footer" data-state="${!mutual ? 'no-mutual' : !canSend ? 'wait' : 'input'}">
                ${footer}
            </div>
        </div>
      `;
    } catch (err) {
      console.error(err);
      return `<div style="padding:16px;color:var(--text-muted);">Ошибка: ${escapeHtml(err.message)}</div>`;
    }
  }

  // ==========================================
  // Действия
  // ==========================================

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  async function send(userId) {
    const input = document.getElementById('msg-input');
    if (!input) return;
    const text = (input.value || '').trim();
    if (!text) return;

    const btn = input.nextElementSibling;
    if (btn) btn.disabled = true;

    try {
        await API.sendMessage(userId, text);
        input.value = '';
        autoGrow(input);

        if (App.tg?.HapticFeedback) {
        App.tg.HapticFeedback.impactOccurred('light');
        }

        // Перерисовываем диалог (startPolling вызовется внутри renderDialog)
        stopPolling();
        const html = await renderDialog(userId);
        document.getElementById('content').innerHTML = html;

        const list = document.getElementById('messages-list');
        if (list) list.scrollTop = list.scrollHeight;
    } catch (err) {
        App.showToast(err.message || 'Не удалось отправить', '❌');
        if (btn) btn.disabled = false;
    }
    }

  // ==========================================
  // Авто-скролл вниз после рендера
  // ==========================================

  function scrollToBottom() {
    const list = document.getElementById('messages-list');
    if (list) list.scrollTop = list.scrollHeight;
  }

  // ==========================================
    // Polling новых сообщений в открытом диалоге
    // ==========================================

    let pollTimer = null;
    let pollUserId = null;
    let lastMessageId = 0;

    const POLL_INTERVAL_MS = 4000;

    function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    pollUserId = null;
    lastMessageId = 0;
    }

    function startPolling(userId, initialMessages) {
    stopPolling();
    pollUserId = userId;
    lastMessageId = initialMessages.length
        ? Math.max(...initialMessages.map(m => m.id))
        : 0;

    pollTimer = setInterval(() => pollTick(userId), POLL_INTERVAL_MS);
    }

    async function pollTick(userId) {
        // Если экран чата исчез (юзер ушёл) — глушим
        const list = document.getElementById('messages-list');
        if (!list || pollUserId !== userId) {
            stopPolling();
            return;
        }

        // Если вкладка скрыта — не дёргаем сервер
        if (document.hidden) return;

        try {
            const data = await API.getMessagesWith(userId);
            const messages = data.messages || [];
            const myId = App.state.user?.id;

            // Проверяем ещё раз, что мы всё ещё в этом диалоге
            const stillHere = document.getElementById('messages-list');
            if (!stillHere || pollUserId !== userId) return;

            // 1. Дорисовываем новые сообщения
            const newOnes = messages.filter(m => m.id > lastMessageId);
            if (newOnes.length) {
                const wasAtBottom =
                    stillHere.scrollHeight - stillHere.scrollTop - stillHere.clientHeight < 80;

                const html = newOnes.map(m => messageHtml(m, myId)).join('');
                stillHere.insertAdjacentHTML('beforeend', html);
                lastMessageId = Math.max(...newOnes.map(m => m.id));

                if (wasAtBottom) {
                    stillHere.scrollTop = stillHere.scrollHeight;
                }

                if (newOnes.some(m => m.to_user_id === myId)) {
                    API.markMessagesRead(userId).catch(() => {});
                }
            }

            // 2. Убираем кружок «непрочитано» на своих сообщениях, которые уже прочитаны
            for (const m of messages) {
                if (m.from_user_id !== myId) continue;
                if (!m.is_read) continue;

                const dot = stillHere.querySelector(
                    `.msg-row[data-msg-id="${m.id}"] .msg-read-dot`
                );
                if (dot) dot.remove();
            }

            // 3. Обновляем футер, если изменились права на отправку
            updateFooter(userId, !!data.can_send, !!data.mutual_follow);

        } catch (err) {
            console.warn('poll error:', err.message);
        }
    }

    function updateFooter(userId, canSend, mutual) {
        const footer = document.getElementById('msg-footer');
        if (!footer) return;

        // Текущее состояние определяем по наличию input'а
        const hasInput = !!document.getElementById('msg-input');
        const desiredState = !mutual ? 'no-mutual'
                            : !canSend ? 'wait'
                            : 'input';
        const currentState = footer.getAttribute('data-state');

        if (currentState === desiredState) return; // ничего не менялось

        footer.setAttribute('data-state', desiredState);

        if (desiredState === 'no-mutual') {
            footer.innerHTML = `
            <div style="padding:12px;background:var(--bg-card);border-radius:12px;color:var(--text-muted);text-align:center;font-size:14px;">
                Для переписки нужна взаимная подписка
            </div>
            `;
        } else if (desiredState === 'wait') {
            footer.innerHTML = `
            <div style="padding:12px;background:var(--bg-card);border-radius:12px;color:var(--text-muted);text-align:center;font-size:14px;">
                ⏳ Дождитесь ответа собеседника
            </div>
            `;
        } else {
            footer.innerHTML = `
            <div style="display:flex;gap:8px;align-items:flex-end;">
                <textarea
                id="msg-input"
                placeholder="Сообщение..."
                maxlength="2000"
                rows="1"
                oninput="MessagesPage.autoGrow(this)"
                style="
                    flex:1;background:var(--bg-card);color:var(--text-primary);
                    border:none;border-radius:18px;padding:10px 14px;
                    font-size:15px;resize:none;max-height:120px;outline:none;
                    font-family:inherit;
                "></textarea>
                <button
                onclick="MessagesPage.send(${userId})"
                style="
                    background:var(--accent);color:#fff;border:none;
                    border-radius:50%;width:40px;height:40px;
                    cursor:pointer;font-size:18px;flex-shrink:0;
                "
                >➤</button>
            </div>
            `;
        }
        }

    return {
        // Главный entry-point под стиль роутера
        render: renderDialogsList,
        renderDialog,

        // Внутренние действия (вызываются из onclick)
        send,
        autoGrow,
        scrollToBottom,
        stopPolling
    };

})();