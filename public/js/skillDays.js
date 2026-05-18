(function (global) {
  const DEFAULT_PERIOD = { unit: 'years', value: 1 };

  const FREQUENCY_PRESETS = {
    rarely: 1,
    couple_week: 2,
    several_week: 4,
    daily: 7
  };

  const SCHEDULE_PRESETS = {
    two_one: { work: 2, rest: 1 },
    five_two: { work: 5, rest: 2 },
    six_one: { work: 6, rest: 1 },
    two_two: { work: 2, rest: 2 },
    one_one: { work: 1, rest: 1 }
  };

  function periodToDays(unit, value) {
    const safeValue = Math.max(0, Number(value) || 0);
    if (unit === 'months') return safeValue * 30;
    return safeValue * 365;
  }

  function calcDaysBySchedule({ periodUnit, periodValue, work, rest }) {
    const total = periodToDays(periodUnit, periodValue);
    const w = Math.max(0, Number(work) || 0);
    const r = Math.max(0, Number(rest) || 0);
    const denom = w + r;
    if (denom <= 0) return 0;
    return Math.round(total * (w / denom));
  }

  function calcDaysByFrequency({ periodUnit, periodValue, sessionsPerWeek }) {
    const total = periodToDays(periodUnit, periodValue);
    const freq = Math.max(0, Number(sessionsPerWeek) || 0);
    return Math.round(total * (freq / 7));
  }

  function clampInitialDays(days) {
    return Math.max(0, Math.min(20000, Math.floor(Number(days) || 0)));
  }

  function getRankByDaysPreview(days) {
    const d = clampInitialDays(days);
    if (d >= 730) return 'S';
    if (d >= 365) return 'A';
    if (d >= 180) return 'B';
    if (d >= 90) return 'C';
    if (d >= 30) return 'D';
    if (d >= 7) return 'E';
    return 'F';
  }

  global.SkillDays = {
    DEFAULT_PERIOD,
    FREQUENCY_PRESETS,
    SCHEDULE_PRESETS,
    periodToDays,
    calcDaysBySchedule,
    calcDaysByFrequency,
    clampInitialDays,
    getRankByDaysPreview
  };
})(window);
