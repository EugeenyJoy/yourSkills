// ============================================
// tests/integration.test.js — Интеграционные тесты рангов
// Запуск: node tests/integration.test.js
// ============================================

'use strict';

const Database = require('better-sqlite3');
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

function dateOffset(offset) {
  const d = new Date('2026-01-01T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function isoWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const target = new Date(d.valueOf());
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  const week = 1 + Math.ceil((firstThursday - target) / 604800000);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      overall_rank TEXT DEFAULT 'F'
    );
    CREATE TABLE user_skills (
      user_id INTEGER NOT NULL,
      skill_id INTEGER NOT NULL,
      rank TEXT DEFAULT 'F',
      PRIMARY KEY (user_id, skill_id)
    );
    CREATE TABLE checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      skill_id INTEGER NOT NULL,
      date TEXT NOT NULL
    );
    CREATE TABLE endorsements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id INTEGER NOT NULL,
      to_user_id INTEGER NOT NULL,
      skill_id INTEGER NOT NULL
    );
  `);
  return db;
}

function addCheckins(db, userId, skillId, days, startOffset = 0) {
  const ins = db.prepare('INSERT INTO checkins (user_id, skill_id, date) VALUES (?, ?, ?)');
  for (let i = 0; i < days; i++) {
    ins.run(userId, skillId, dateOffset(startOffset + i));
  }
}

function getSkillDays(db, userId, skillId) {
  return db.prepare(`
    SELECT COUNT(DISTINCT date) AS c
    FROM checkins
    WHERE user_id = ? AND skill_id = ?
  `).get(userId, skillId).c;
}

function getSkillRegularWeeks(db, userId, skillId) {
  const rows = db.prepare(`
    SELECT DISTINCT date FROM checkins
    WHERE user_id = ? AND skill_id = ?
  `).all(userId, skillId);
  const weeks = new Set(rows.map(r => isoWeekKey(r.date)));
  return weeks.size;
}

function getEndorsersByRank(db, userId, skillId) {
  const rows = db.prepare(`
    SELECT us.rank AS r
    FROM endorsements e
    LEFT JOIN user_skills us
      ON us.user_id = e.from_user_id AND us.skill_id = e.skill_id
    WHERE e.to_user_id = ? AND e.skill_id = ?
  `).all(userId, skillId);

  let fromA = 0;
  let fromS = 0;
  for (const row of rows) {
    const base = String(row.r || 'F').replace('+', '');
    if (base === 'A') fromA++;
    if (base === 'S') fromS++;
  }
  return { fromA, fromS };
}

function getOverallRegularWeeks(db, userId) {
  const rows = db.prepare('SELECT DISTINCT date FROM checkins WHERE user_id = ?').all(userId);
  const weeks = new Set(rows.map(r => isoWeekKey(r.date)));
  return weeks.size;
}

section('Базовый сценарий 3 скилла');
{
  const db = createDb();
  db.prepare('INSERT INTO users (id, overall_rank) VALUES (?, ?)').run(1, 'F');
  db.prepare('INSERT INTO user_skills (user_id, skill_id, rank) VALUES (1, 101, ?), (1, 102, ?), (1, 103, ?)')
    .run('F', 'F', 'F');

  addCheckins(db, 1, 101, 30, 0);   // D
  addCheckins(db, 1, 102, 95, 100); // C
  addCheckins(db, 1, 103, 5, 250);  // F

  const s1 = R.getEffectiveSkillRank({
    days: getSkillDays(db, 1, 101),
    regularWeeks: getSkillRegularWeeks(db, 1, 101),
    endorsements: getEndorsersByRank(db, 1, 101),
  });
  const s2 = R.getEffectiveSkillRank({
    days: getSkillDays(db, 1, 102),
    regularWeeks: getSkillRegularWeeks(db, 1, 102),
    endorsements: getEndorsersByRank(db, 1, 102),
  });
  const s3 = R.getEffectiveSkillRank({
    days: getSkillDays(db, 1, 103),
    regularWeeks: getSkillRegularWeeks(db, 1, 103),
    endorsements: getEndorsersByRank(db, 1, 103),
  });

  eq(s1, { rank: 'D', baseRank: 'D', plus: false, title: 'Практик' }, '30 дней → D');
  eq(s2, { rank: 'C', baseRank: 'C', plus: false, title: 'Знаток' }, '95 дней → C');
  eq(s3, { rank: 'F', baseRank: 'F', plus: false, title: null }, '5 дней → F');

  const overall = R.getOverallRank(
    [s1.baseRank, s2.baseRank, s3.baseRank],
    getOverallRegularWeeks(db, 1)
  );
  eq(overall, { rank: 'C', baseRank: 'C', plus: false, title: 'Знаток' }, 'C + D + F → общий C');
}

section('Гейты A/S и регулярность');
{
  const db = createDb();
  db.prepare('INSERT INTO users (id, overall_rank) VALUES (?, ?)').run(2, 'F');
  db.prepare('INSERT INTO user_skills (user_id, skill_id, rank) VALUES (2, 201, ?), (2, 202, ?), (2, 203, ?)')
    .run('F', 'F', 'F');

  // Входные данные: хватает дней на A/S
  addCheckins(db, 2, 201, 400, 0);   // A по дням
  addCheckins(db, 2, 202, 800, 500); // S по дням
  addCheckins(db, 2, 203, 800, 1400);

  // Эндорсеры ранга A/S по тем же скиллам
  for (let u = 10; u < 15; u++) {
    db.prepare('INSERT INTO users (id, overall_rank) VALUES (?, ?)').run(u, 'A');
    db.prepare('INSERT INTO user_skills (user_id, skill_id, rank) VALUES (?, 201, ?), (?, 202, ?), (?, 203, ?)')
      .run(u, 'A', u, 'A', u, 'A');
  }
  for (let u = 30; u < 33; u++) {
    db.prepare('INSERT INTO users (id, overall_rank) VALUES (?, ?)').run(u, 'S');
    db.prepare('INSERT INTO user_skills (user_id, skill_id, rank) VALUES (?, 202, ?)')
      .run(u, 'S');
  }

  // Для skill 201: ровно 5 от A
  for (let u = 10; u < 15; u++) {
    db.prepare('INSERT INTO endorsements (from_user_id, to_user_id, skill_id) VALUES (?, 2, 201)')
      .run(u);
  }
  // Для skill 202: 10 от A
  for (let i = 0; i < 10; i++) {
    const uid = 100 + i;
    db.prepare('INSERT INTO users (id, overall_rank) VALUES (?, ?)').run(uid, 'A');
    db.prepare('INSERT INTO user_skills (user_id, skill_id, rank) VALUES (?, 202, ?)').run(uid, 'A');
    db.prepare('INSERT INTO endorsements (from_user_id, to_user_id, skill_id) VALUES (?, 2, 202)').run(uid);
  }
  // Для skill 203: только 4 от A (недостаточно для A)
  for (let u = 10; u < 14; u++) {
    db.prepare('INSERT INTO endorsements (from_user_id, to_user_id, skill_id) VALUES (?, 2, 203)')
      .run(u);
  }

  const aSkill = R.getEffectiveSkillRank({
    days: getSkillDays(db, 2, 201),
    regularWeeks: getSkillRegularWeeks(db, 2, 201),
    endorsements: getEndorsersByRank(db, 2, 201),
  });
  const sSkill = R.getEffectiveSkillRank({
    days: getSkillDays(db, 2, 202),
    regularWeeks: getSkillRegularWeeks(db, 2, 202),
    endorsements: getEndorsersByRank(db, 2, 202),
  });
  const plusSkill = R.getEffectiveSkillRank({
    days: getSkillDays(db, 2, 203),
    regularWeeks: getSkillRegularWeeks(db, 2, 203),
    endorsements: getEndorsersByRank(db, 2, 203),
  });

  eq(aSkill.rank, 'A', 'A-гейт: 400 дней + 26+ недель + 5 от A');
  eq(sSkill.rank, 'S', 'S-гейт: 800 дней + 52+ недель + 10 от A');
  eq(plusSkill.rank, 'B+', 'B+: дней на A хватает, но условия не сошлись');
}

section('Свёртка и потолок');
{
  const byFold = R.getOverallRank(['D', 'D', 'D'], 0);
  eq(byFold, { rank: 'C', baseRank: 'C', plus: false, title: 'Знаток' }, '3xD → 1xC');

  const cap = R.getOverallRank(['A', 'A', 'A'], 30);
  eq(cap, { rank: 'A', baseRank: 'A', plus: false, title: 'Мастер' }, 'потолок свёртки = A');
}

console.log(`\nИтог: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
