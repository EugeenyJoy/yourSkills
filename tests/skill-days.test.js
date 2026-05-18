'use strict';

const assert = require('assert');
const SkillDays = require('../lib/skillDays');
const Ranks = require('../lib/ranks');

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(error.message);
    process.exitCode = 1;
  }
}

test('График 5/2 за 1 год', () => {
  const days = SkillDays.calcDaysBySchedule({
    periodUnit: 'years',
    periodValue: 1,
    work: 5,
    rest: 2
  });
  assert.strictEqual(days, Math.round(365 * (5 / 7)));
});

test('График custom 2/1 за 12 месяцев', () => {
  const days = SkillDays.calcDaysBySchedule({
    periodUnit: 'months',
    periodValue: 12,
    work: 2,
    rest: 1
  });
  assert.strictEqual(days, Math.round(360 * (2 / 3)));
});

test('Частота several_week за 1 год', () => {
  const days = SkillDays.calcDaysByFrequency({
    periodUnit: 'years',
    periodValue: 1,
    sessionsPerWeek: SkillDays.FREQUENCY_PRESETS.several_week
  });
  assert.strictEqual(days, Math.round(365 * (4 / 7)));
});

test('Частота daily за 6 месяцев', () => {
  const days = SkillDays.calcDaysByFrequency({
    periodUnit: 'months',
    periodValue: 6,
    sessionsPerWeek: SkillDays.FREQUENCY_PRESETS.daily
  });
  assert.strictEqual(days, 180);
});

test('Превью ранга совпадает с getRankByDays', () => {
  const samples = [0, 7, 30, 90, 180, 365, 730];
  for (const days of samples) {
    assert.strictEqual(SkillDays.getRankByDaysPreview(days), Ranks.getRankByDays(days));
  }
});

if (!process.exitCode) {
  console.log('🎉 skill-days tests passed');
}
