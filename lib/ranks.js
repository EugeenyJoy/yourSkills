// ============================================
// lib/ranks.js — Ранговая система v1.0
// Чистая логика без зависимостей от БД.
// ============================================

'use strict';

// ============================================
// Константы
// ============================================

const RANK_ORDER = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];

const RANK_DAYS = {
  F: 0,
  E: 7,
  D: 30,
  C: 90,
  B: 180,
  A: 365,
  S: 730
};

const RANK_TITLES = {
  F: null,
  E: null,
  D: 'Практик',
  C: 'Знаток',
  B: 'Эксперт',
  A: 'Мастер',
  S: 'Легенда'
};

const MERGE_FACTOR = 3;

const ENDORSE_REQ = {
  A: { sameRank: 5, higherRank: 1 },  // 5 от A ИЛИ 1 от S
  S: { sameRank: 10, higherRank: 3 }  // 10 от A ИЛИ 3 от S
};

const REGULARITY_WEEKS = {
  A: 26,
  S: 52
};

// ============================================
// Базовые конверторы
// ============================================

function rankToIdx(rank) {
  if (typeof rank !== 'string') return 0;
  const clean = rank.replace('+', '');
  const idx = RANK_ORDER.indexOf(clean);
  return idx === -1 ? 0 : idx;
}

function idxToRank(idx) {
  if (idx < 0) return 'F';
  if (idx >= RANK_ORDER.length) return 'S';
  return RANK_ORDER[idx];
}

// ============================================
// Ранг по дням (без учёта подтверждений и регулярности)
// ============================================

function getRankByDays(days) {
  const d = Math.max(0, Math.floor(days || 0));
  let rank = 'F';
  for (const r of RANK_ORDER) {
    if (d >= RANK_DAYS[r]) rank = r;
    else break;
  }
  return rank;
}

function getTitleByRank(rank) {
  const clean = (rank || 'F').replace('+', '');
  return RANK_TITLES[clean] || null;
}

// ============================================
// Проверка подтверждений
// endorsements = { fromA: число, fromS: число }
// ============================================

function hasEnoughEndorsements(targetRank, endorsements) {
  const req = ENDORSE_REQ[targetRank];
  if (!req) return true; // для рангов ниже A — не требуется

  const fromA = endorsements?.fromA || 0;
  const fromS = endorsements?.fromS || 0;

  // Для A: 5 от A ИЛИ 1 от S
  // Для S: 10 от A ИЛИ 3 от S
  return fromA >= req.sameRank || fromS >= req.higherRank;
}

// ============================================
// Эффективный ранг скилла (с учётом B+/A+)
// input = { days, regularWeeks, endorsements: {fromA, fromS} }
// output = { rank: 'B'|'B+'|..., baseRank: 'B'|..., plus: bool, title: string|null }
// ============================================

function getEffectiveSkillRank({ days = 0, regularWeeks = 0, endorsements = {} } = {}) {
  const byDays = getRankByDays(days);
  const byDaysIdx = rankToIdx(byDays);
  const A_IDX = rankToIdx('A');
  const S_IDX = rankToIdx('S');

  // Если по дням ниже A — никаких условий
  if (byDaysIdx < A_IDX) {
    return {
      rank: byDays,
      baseRank: byDays,
      plus: false,
      title: getTitleByRank(byDays)
    };
  }

  // Проверяем выполнимость условий для A и S
  const meetsA =
    regularWeeks >= REGULARITY_WEEKS.A &&
    hasEnoughEndorsements('A', endorsements);
  const meetsS =
    regularWeeks >= REGULARITY_WEEKS.S &&
    hasEnoughEndorsements('S', endorsements);

  // Дней хватает на S
  if (byDaysIdx >= S_IDX) {
    if (meetsS) {
      return { rank: 'S', baseRank: 'S', plus: false, title: getTitleByRank('S') };
    }
    if (meetsA) {
      // По дням S, но условия только для A → A+
      return { rank: 'A+', baseRank: 'A', plus: true, title: getTitleByRank('A') };
    }
    // Ни A, ни S не вышло → B+
    return { rank: 'B+', baseRank: 'B', plus: true, title: getTitleByRank('B') };
  }

  // Дней хватает только на A (но не на S)
  if (meetsA) {
    return { rank: 'A', baseRank: 'A', plus: false, title: getTitleByRank('A') };
  }
  return { rank: 'B+', baseRank: 'B', plus: true, title: getTitleByRank('B') };
}

// ============================================
// Общий ранг (свёртка)
// skills = массив строк (эффективные ранги без плюсов: 'F','E','D','C','B','A','S')
// totalRegularWeeks = недели регулярности по ЛЮБОМУ чекину
// hasRealS = bool, есть ли скилл реального S-ранга
// ============================================

function getOverallRank(skills = [], totalRegularWeeks = 0) {
  // Считаем по уровням
  const counts = new Array(RANK_ORDER.length).fill(0);
  let hasRealS = false;

  for (const s of skills) {
    const clean = (s || 'F').replace('+', '');
    const idx = rankToIdx(clean);
    counts[idx] += 1;
    if (clean === 'S') hasRealS = true;
  }

  // Свёртка с потолком A (idx=5)
  const A_IDX = rankToIdx('A');
  for (let i = 0; i < A_IDX; i++) {
    const promoted = Math.floor(counts[i] / MERGE_FACTOR);
    counts[i + 1] += promoted;
    counts[i] = counts[i] % MERGE_FACTOR;
  }

  // Находим максимальный уровень, где есть скиллы
  let maxIdx = 0;
  for (let i = RANK_ORDER.length - 1; i >= 0; i--) {
    if (counts[i] > 0) { maxIdx = i; break; }
  }
  let baseRank = idxToRank(maxIdx);

  // Особый случай: реальный S
  if (hasRealS) {
    // Реальный S может стать общим S только если регулярность ≥ 52 недели
    // (логично: легенда не пропадает на месяцы)
    // Но это спорно — на старте дадим S автоматом, если есть реальный S.
    return {
      rank: 'S',
      baseRank: 'S',
      plus: false,
      title: getTitleByRank('S')
    };
  }

  // Если свёрткой получили A — проверяем регулярность 26 недель
  if (baseRank === 'A') {
    if (totalRegularWeeks >= REGULARITY_WEEKS.A) {
      return { rank: 'A', baseRank: 'A', plus: false, title: getTitleByRank('A') };
    }
    // Нет регулярности → B+
    return { rank: 'B+', baseRank: 'B', plus: true, title: getTitleByRank('B') };
  }

  // Для всех остальных уровней — без плюсов
  return {
    rank: baseRank,
    baseRank,
    plus: false,
    title: getTitleByRank(baseRank)
  };
}

// ============================================
// Форматирование для UI
// ============================================

function formatRankLabel(skillName, rankObj) {
  const { rank, title } = rankObj || {};
  if (!rank) return skillName || '';
  if (title) return `${skillName} · ${title} ранга ${rank}`;
  return `${skillName} · ранг ${rank}`;
}

// ============================================
// Экспорт
// ============================================

module.exports = {
  // Константы (для тестов и UI)
  RANK_ORDER,
  RANK_DAYS,
  RANK_TITLES,
  MERGE_FACTOR,
  ENDORSE_REQ,
  REGULARITY_WEEKS,

  // Базовые
  rankToIdx,
  idxToRank,

  // Расчёт
  getRankByDays,
  getTitleByRank,
  hasEnoughEndorsements,
  getEffectiveSkillRank,
  getOverallRank,

  // UI
  formatRankLabel
};