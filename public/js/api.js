// ============================================
// api.js — Запросы к серверу v3
// ============================================

const API = (() => {

  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';

  // ==========================================
  // Кэш с TTL
  // ==========================================

  const cache = new Map();
  const CACHE_TTL = 30000; // 30 секунд

  function getCached(key) {
    const item = cache.get(key);
    if (!item) return null;
    if (Date.now() - item.time > CACHE_TTL) {
      cache.delete(key);
      return null;
    }
    return item.data;
  }

  function setCache(key, data) {
    cache.set(key, { data, time: Date.now() });
  }

  function clearCache(prefix) {
    if (prefix) {
      for (const key of cache.keys()) {
        if (key.includes(prefix)) cache.delete(key);
      }
    } else {
      cache.clear();
    }
  }

  // ==========================================
  // Базовый запрос
  // ==========================================

  class APIError extends Error {
    constructor(message, status, data = null) {
      super(message);
      this.name = 'APIError';
      this.status = status;
      this.data = data;
    }
  }

  async function request(path, options = {}) {
    const {
      method = 'GET',
      body = null,
      useCache = false
    } = options;

    const cacheKey = `${method}:${path}`;

    // Кэш для GET
    if (useCache && method === 'GET') {
      const cached = getCached(cacheKey);
      if (cached) return cached;
    }

    try {
      const fetchOptions = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Init-Data': initData
        }
      };

      if (body && method !== 'GET') {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(`/api${path}`, fetchOptions);
      const data = await response.json();

      if (!response.ok) {
        throw new APIError(
          data.error || 'Ошибка сервера',
          response.status,
          data
        );
      }

      // Кэшируем GET
      if (useCache && method === 'GET') {
        setCache(cacheKey, data);
      }

      return data;

    } catch (error) {
      if (error instanceof APIError) throw error;

      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new APIError('Нет соединения с сервером', 0);
      }

      throw new APIError(error.message || 'Неизвестная ошибка', 500);
    }
  }

  // ==========================================
  // АВТОРИЗАЦИЯ
  // ==========================================

  async function login() {
    const result = await request('/auth/login', {
      method: 'POST',
      body: { initData }
    });
    setCache('GET:/profile/me', result);
    return result;
  }

  // ==========================================
  // ПРОФИЛЬ
  // ==========================================

  async function getMyProfile() {
    return request('/profile/me', { useCache: true });
  }

  async function getProfile(userId) {
    return request(`/profile/${userId}`, { useCache: true });
  }

  async function updateMyProfile(payload) {
    const result = await request('/profile/me', {
      method: 'PUT',
      body: payload
    });
    clearCache('/profile');
    return result;
  }

  async function follow(userId) {
    const result = await request(`/profile/${userId}/follow`, { method: 'POST' });
    clearCache('/profile');
    return result;
  }

  async function unfollow(userId) {
    const result = await request(`/profile/${userId}/follow`, { method: 'DELETE' });
    clearCache('/profile');
    return result;
  }

  async function getFollowers(userId, page = 0) {
    return request(`/profile/${userId}/followers?page=${page}`);
  }

  async function getFollowing(userId, page = 0) {
    return request(`/profile/${userId}/following?page=${page}`);
  }

  async function searchUsers(query, options = {}) {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (options.skill) params.set('skill', options.skill);
    if (options.rank) params.set('rank', options.rank);
    if (options.page) params.set('page', options.page);
    return request(`/profile/search/users?${params}`);
  }

  async function getTopUsers(options = {}) {
    const params = new URLSearchParams();
    if (options.skill) params.set('skill', options.skill);
    if (options.limit) params.set('limit', options.limit);
    return request(`/profile/top/users?${params}`, { useCache: true });
  }

  // ==========================================
  // НАВЫКИ
  // ==========================================

  async function getCatalog() {
    return request('/skills/catalog', { useCache: true });
  }

  async function searchSkills(query) {
    if (!query || query.length < 2) return [];
    return request(`/skills/search?q=${encodeURIComponent(query)}`);
  }

  async function addSkill(skillId, totalYears, activeYears) {
    const result = await request('/skills/add', {
      method: 'POST',
      body: {
        skillId: parseInt(skillId),
        totalYears: parseFloat(totalYears) || 0,
        activeYears: parseFloat(activeYears) || 0
      }
    });
    clearCache('/profile');
    clearCache('/streaks');
    return result;
  }

  async function updateSkill(skillId, totalYears, activeYears) {
    const result = await request(`/skills/${skillId}`, {
      method: 'PUT',
      body: { totalYears, activeYears }
    });
    clearCache('/profile');
    return result;
  }

  async function deleteSkill(skillId) {
    const result = await request(`/skills/${skillId}`, { method: 'DELETE' });
    clearCache('/profile');
    clearCache('/streaks');
    return result;
  }

  async function getSkillDetails(skillId) {
    return request(`/skills/${skillId}/details`);
  }

  // ==========================================
  // СТРИКИ
  // ==========================================

  async function checkin(skillId, note = '') {
    const result = await request('/streaks/checkin', {
      method: 'POST',
      body: { skillId, note }
    });
    clearCache('/streaks');
    clearCache('/profile');
    return result;
  }

  async function getTodayStatus() {
    return request('/streaks/today');
  }

  async function getStreakHistory(skillId) {
    return request(`/streaks/history/${skillId}`);
  }

  async function getStreakStats() {
    return request('/streaks/stats', { useCache: true });
  }

  // ==========================================
  // ПОДТВЕРЖДЕНИЯ
  // ==========================================

  async function endorse(userId, skillId) {
    const result = await request('/endorsements', {
      method: 'POST',
      body: { userId, skillId }
    });
    clearCache('/endorsements');
    clearCache('/profile');
    return result;
  }

  async function getEndorsements(userId, skillId) {
    return request(`/endorsements/${userId}/${skillId}`);
  }

  async function removeEndorsement(userId, skillId) {
    const result = await request(`/endorsements/${userId}/${skillId}`, {
      method: 'DELETE'
    });
    clearCache('/endorsements');
    clearCache('/profile');
    return result;
  }

  // ==========================================
  // ЛЕНТА
  // ==========================================

  async function getFeed(page = 0) {
    return request(`/feed?page=${page}`);
  }

  async function getGlobalFeed(page = 0) {
    return request(`/feed/global?page=${page}`);
  }

  async function getUserFeed(userId, page = 0) {
    return request(`/feed/user/${userId}?page=${page}`);
  }

  // ==========================================
  // РЕАКЦИИ
  // ==========================================

  async function reactToEvent(eventId, reaction) {
    const result = await request(`/feed/${eventId}/react`, {
      method: 'POST',
      body: { reaction }
    });
    return result;
  }

  async function removeReaction(eventId) {
    const result = await request(`/feed/${eventId}/react`, {
      method: 'DELETE'
    });
    return result;
  }

  // ==========================================
  // Публичный интерфейс
  // ==========================================

  return {
    clearCache,

    // Авторизация
    login,

    // Профиль
    getMyProfile,
    getProfile,
    updateMyProfile,
    follow,
    unfollow,
    getFollowers,
    getFollowing,
    searchUsers,
    getTopUsers,

    // Навыки
    getCatalog,
    searchSkills,
    addSkill,
    updateSkill,
    deleteSkill,
    getSkillDetails,

    // Стрики
    checkin,
    getTodayStatus,
    getStreakHistory,
    getStreakStats,

    // Подтверждения
    endorse,
    getEndorsements,
    removeEndorsement,

    // Лента
    getFeed,
    getGlobalFeed,
    getUserFeed,

    // Реакции
    reactToEvent,
    removeReaction,
  };

})();
