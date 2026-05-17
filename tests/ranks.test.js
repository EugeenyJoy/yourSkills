// ============================================
// tests/ranks.test.js — Тесты ранговой системы
// Запуск: node tests/ranks.test.js
// ============================================

'use strict';

const R = require('../lib/ranks');

let passed = 0;
let failed = 0;
const failures = [];

function eq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push({ name, actual, expected });
    console.log(`  ❌ ${name}`);
    console.log(`     ожидалось: ${JSON.stringify(expected)}`);
    console.log(`     получено:  ${JSON.stringify(actual)}`);
  }
}

function section(title) {
  console.log(`\n━━━ ${title} ━━━`);
}

// ============================================
// 1. getRankByDays — границы
// ============================================
section('getRankByDays');

eq(R.getRankByDays(0), 'F', '0 дней → F');
eq(R.getRankByDays(6), 'F', '6 дней → F');
eq(R.getRankByDays(7), 'E', '7 дней → E');
eq(R.getRankByDays(29), 'E', '29 дней → E');
eq(R.getRankByDays(30), 'D', '30 дней → D');
eq(R.getRankByDays(89), 'D', '89 дней → D');
eq(R.getRankByDays(90), 'C', '90 дней → C');
eq(R.getRankByDays(179), 'C', '179 дней → C');
eq(R.getRankByDays(180), 'B', '180 дней → B');
eq(R.getRankByDays(364), 'B', '364 дня → B');
eq(R.getRankByDays(365), 'A', '365 дней → A (по дням)');
eq(R.getRankByDays(729), 'A', '729 дней → A');
eq(R.getRankByDays(730), 'S', '730 дней → S (по дням)');
eq(R.getRankByDays(99999), 'S', 'много → S');
eq(R.getRankByDays(-5), 'F', 'отрицательное → F');

// ============================================
// 2. getTitleByRank
// ============================================
section('getTitleByRank');

eq(R.getTitleByRank('F'), null, 'F → нет титула');
eq(R.getTitleByRank('E'), null, 'E → нет титула');
eq(R.getTitleByRank('D'), 'Практик', 'D → Практик');
eq(R.getTitleByRank('C'), 'Знаток', 'C → Знаток');
eq(R.getTitleByRank('B'), 'Эксперт', 'B → Эксперт');
eq(R.getTitleByRank('A'), 'Мастер', 'A → Мастер');
eq(R.getTitleByRank('S'), 'Легенда', 'S → Легенда');
eq(R.getTitleByRank('B+'), 'Эксперт', 'B+ → Эксперт (титул базового)');
eq(R.getTitleByRank('A+'), 'Мастер', 'A+ → Мастер');

// ============================================
// 3. hasEnoughEndorsements
// ============================================
section('hasEnoughEndorsements');

eq(R.hasEnoughEndorsements('A', { fromA: 5, fromS: 0 }), true, 'A: 5 от A → OK');
eq(R.hasEnoughEndorsements('A', { fromA: 4, fromS: 0 }), false, 'A: 4 от A → НЕТ');
eq(R.hasEnoughEndorsements('A', { fromA: 0, fromS: 1 }), true, 'A: 1 от S → OK');
eq(R.hasEnoughEndorsements('A', { fromA: 0, fromS: 0 }), false, 'A: ноль → НЕТ');
eq(R.hasEnoughEndorsements('S', { fromA: 10, fromS: 0 }), true, 'S: 10 от A → OK');
eq(R.hasEnoughEndorsements('S', { fromA: 9, fromS: 0 }), false, 'S: 9 от A → НЕТ');
eq(R.hasEnoughEndorsements('S', { fromA: 0, fromS: 3 }), true, 'S: 3 от S → OK');
eq(R.hasEnoughEndorsements('S', { fromA: 0, fromS: 2 }), false, 'S: 2 от S → НЕТ');
eq(R.hasEnoughEndorsements('B', { fromA: 0, fromS: 0 }), true, 'B не требует');

// ============================================
// 4. getEffectiveSkillRank
// ============================================
section('getEffectiveSkillRank');

eq(
  R.getEffectiveSkillRank({ days: 50 }),
  { rank: 'D', baseRank: 'D', plus: false, title: 'Практик' },
  '50 дней → D'
);

eq(
  R.getEffectiveSkillRank({ days: 200 }),
  { rank: 'B', baseRank: 'B', plus: false, title: 'Эксперт' },
  '200 дней → B (без условий)'
);

eq(
  R.getEffectiveSkillRank({
    days: 400,
    regularWeeks: 26,
    endorsements: { fromA: 5, fromS: 0 }
  }),
  { rank: 'A', baseRank: 'A', plus: false, title: 'Мастер' },
  '400 дней + 26 недель + 5 от A → A'
);

eq(
  R.getEffectiveSkillRank({
    days: 400,
    regularWeeks: 26,
    endorsements: { fromA: 0, fromS: 1 }
  }),
  { rank: 'A', baseRank: 'A', plus: false, title: 'Мастер' },
  '400 дней + 26 недель + 1 от S → A'
);

eq(
  R.getEffectiveSkillRank({
    days: 400,
    regularWeeks: 26,
    endorsements: { fromA: 4, fromS: 0 }
  }),
  { rank: 'B+', baseRank: 'B', plus: true, title: 'Эксперт' },
  '400 дней + 26 недель, но 4 от A → B+'
);

eq(
  R.getEffectiveSkillRank({
    days: 400,
    regularWeeks: 10,
    endorsements: { fromA: 5, fromS: 0 }
  }),
  { rank: 'B+', baseRank: 'B', plus: true, title: 'Эксперт' },
  '400 дней + 5 от A, но мало недель → B+'
);

eq(
  R.getEffectiveSkillRank({
    days: 400,
    regularWeeks: 0,
    endorsements: {}
  }),
  { rank: 'B+', baseRank: 'B', plus: true, title: 'Эксперт' },
  'A по дням, ничего больше → B+'
);

// S-ранг
eq(
  R.getEffectiveSkillRank({
    days: 800,
    regularWeeks: 52,
    endorsements: { fromA: 10, fromS: 0 }
  }),
  { rank: 'S', baseRank: 'S', plus: false, title: 'Легенда' },
  '800 + 52 недели + 10 от A → S'
);

eq(
  R.getEffectiveSkillRank({
    days: 800,
    regularWeeks: 52,
    endorsements: { fromA: 0, fromS: 3 }
  }),
  { rank: 'S', baseRank: 'S', plus: false, title: 'Легенда' },
  '800 + 52 + 3 от S → S'
);

eq(
  R.getEffectiveSkillRank({
    days: 800,
    regularWeeks: 52,
    endorsements: { fromA: 9, fromS: 2 }
  }),
  { rank: 'A+', baseRank: 'A', plus: true, title: 'Мастер' },
  '800 дней + 52 недели, но условия только для A → A+'
);

eq(
  R.getEffectiveSkillRank({
    days: 800,
    regularWeeks: 26,
    endorsements: { fromA: 5, fromS: 0 }
  }),
  { rank: 'A+', baseRank: 'A', plus: true, title: 'Мастер' },
  '800 дней, A-условия сошлись, S-нет → A+'
);

eq(
  R.getEffectiveSkillRank({
    days: 800,
    regularWeeks: 0,
    endorsements: {}
  }),
  { rank: 'B+', baseRank: 'B', plus: true, title: 'Эксперт' },
  '800 дней, ничего больше → B+'
);

// ============================================
// 5. getOverallRank — свёртка
// ============================================
section('getOverallRank (свёртка)');

eq(
  R.getOverallRank([], 0),
  { rank: 'F', baseRank: 'F', plus: false, title: null },
  'пусто → F'
);

eq(
  R.getOverallRank(['F'], 0),
  { rank: 'F', baseRank: 'F', plus: false, title: null },
  '1 F → F'
);

eq(
  R.getOverallRank(['F', 'F', 'F'], 0),
  { rank: 'E', baseRank: 'E', plus: false, title: null },
  '3 F → E'
);

eq(
  R.getOverallRank(['F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F'], 0),
  { rank: 'D', baseRank: 'D', plus: false, title: 'Практик' },
  '9 F → D'
);

eq(
  R.getOverallRank(['D', 'D', 'D', 'D', 'D', 'D'], 0),
  { rank: 'C', baseRank: 'C', plus: false, title: 'Знаток' },
  '6 D → 2 C → общий C (твой пример)'
);

eq(
  R.getOverallRank(['E', 'E', 'E', 'E', 'E', 'E', 'E', 'E', 'E'], 0),
  { rank: 'C', baseRank: 'C', plus: false, title: 'Знаток' },
  '9 E → 3 D → 1 C → общий C'
);

eq(
  R.getOverallRank(['C', 'D', 'D', 'D'], 0),
  { rank: 'C', baseRank: 'C', plus: false, title: 'Знаток' },
  '1 C + 3 D → 2 C → C'
);

eq(
  R.getOverallRank(['C', 'F', 'F'], 0),
  { rank: 'C', baseRank: 'C', plus: false, title: 'Знаток' },
  '1 C + 2 F → C (F не сворачиваются)'
);

// Потолок A
eq(
  R.getOverallRank(['A', 'A', 'A'], 26),
  { rank: 'A', baseRank: 'A', plus: false, title: 'Мастер' },
  '3 A + 26 недель → A (не S, потому что нет реального S)'
);

eq(
  R.getOverallRank(['A', 'A', 'A'], 0),
  { rank: 'B+', baseRank: 'B', plus: true, title: 'Эксперт' },
  '3 A без регулярности → B+ (свёртка дала A, но нет недель)'
);

eq(
  R.getOverallRank(['A'], 26),
  { rank: 'A', baseRank: 'A', plus: false, title: 'Мастер' },
  '1 A + регулярность → A'
);

eq(
  R.getOverallRank(['A'], 0),
  { rank: 'B+', baseRank: 'B', plus: true, title: 'Эксперт' },
  '1 A без регулярности → B+'
);

// Реальный S
eq(
  R.getOverallRank(['S'], 52),
  { rank: 'S', baseRank: 'S', plus: false, title: 'Легенда' },
  '1 S → S общий'
);

eq(
  R.getOverallRank(['S', 'F'], 0),
  { rank: 'S', baseRank: 'S', plus: false, title: 'Легенда' },
  'S + F → общий S (S всегда даёт S)'
);

// Зерг-раш
eq(
  R.getOverallRank(['B', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F', 'F'], 0),
  { rank: 'B', baseRank: 'B', plus: false, title: 'Эксперт' },
  '1 B + 9 F → 9F даёт 1 D → общий B'
);

// ============================================
// 6. formatRankLabel
// ============================================
section('formatRankLabel');

eq(
  R.formatRankLabel('Готовка', { rank: 'D', title: 'Практик' }),
  'Готовка · Практик ранга D',
  'D с титулом'
);

eq(
  R.formatRankLabel('Python', { rank: 'F', title: null }),
  'Python · ранг F',
  'F без титула'
);

eq(
  R.formatRankLabel('Rust', { rank: 'B+', title: 'Эксперт' }),
  'Rust · Эксперт ранга B+',
  'B+ с титулом'
);

eq(
  R.formatRankLabel('Гитара', { rank: 'S', title: 'Легенда' }),
  'Гитара · Легенда ранга S',
  'S с титулом'
);

// ============================================
// 7. rankToIdx / idxToRank
// ============================================
section('rankToIdx / idxToRank');

eq(R.rankToIdx('F'), 0, 'F → 0');
eq(R.rankToIdx('S'), 6, 'S → 6');
eq(R.rankToIdx('B+'), 4, 'B+ → 4 (плюс игнорируется)');
eq(R.rankToIdx('A+'), 5, 'A+ → 5');
eq(R.rankToIdx(''), 0, 'пусто → 0');
eq(R.rankToIdx(null), 0, 'null → 0');

eq(R.idxToRank(0), 'F', '0 → F');
eq(R.idxToRank(6), 'S', '6 → S');
eq(R.idxToRank(-1), 'F', '-1 → F');
eq(R.idxToRank(99), 'S', '99 → S');

// ============================================
// Итог
// ============================================
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Прошло: ${passed}`);
console.log(`Упало:  ${failed}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (failed > 0) {
  console.log('\nДетали ошибок:');
  for (const f of failures) {
    console.log(`\n❌ ${f.name}`);
    console.log(`   ожидалось: ${JSON.stringify(f.expected)}`);
    console.log(`   получено:  ${JSON.stringify(f.actual)}`);
  }
  process.exit(1);
}

console.log('\n✅ Все тесты прошли.');
process.exit(0);