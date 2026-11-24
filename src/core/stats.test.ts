import { describe, expect, it } from 'vitest';
import { addDays, clock, dayKeys, monthEnd, validDay, weekStart } from './dates';
import { finishTimer, millisecondsLeft } from './focus';
import { emptySnapshot, parseBackup, type Goal, type Habit, type Schedule, type Snapshot } from './model';
import { applies, grouped, heatLevel, makeStats, pct, rate, streak, summarize } from './stats';

const stamp = '2024-02-26T02:00:00.000Z';
const daily: Schedule = { type: 'daily', weekdays: [] };
const weekday: Schedule = { type: 'weekdays', weekdays: [] };
const today = '2024-03-02';

function habit(id: string, schedule = daily, effective = '2024-02-26'): Habit {
  return {
    id, name: id, description: '', icon: 'book', color: 'lilac', category: '学习', startDate: effective,
    schedule, revisions: [{ effective, schedule }], reminderTime: '20:00', reminderEnabled: false,
    sortOrder: 0, createdAt: stamp, updatedAt: stamp,
  };
}

function records(habits: Habit[], entries: Array<[string, string, boolean?]>): Snapshot {
  return {
    ...emptySnapshot(), habits,
    entries: entries.map(([habitId, date, completed = true]) => ({ habitId, date, completed, createdAt: stamp, updatedAt: stamp })),
  };
}

const goal: Goal = {
  id: 'goal-1', title: '阅读计划', description: '', habitIds: ['book'], goalType: 'count', targetValue: 2,
  startDate: '2024-02-26', createdAt: stamp, updatedAt: stamp,
};

describe('civil dates', () => {
  it('keeps leap day valid and advances across year boundaries', () => {
    expect(validDay('2024-02-29')).toBe(true);
    expect(validDay('2023-02-29')).toBe(false);
    expect(validDay('2024-02-31')).toBe(false);
    expect(monthEnd(today)).toBe('2024-03-31');
    expect(dayKeys('2024-02-28', '2024-03-01')).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
  });

  it('uses the selected zone and handles a DST jump', () => {
    expect(clock('Asia/Shanghai', new Date('2024-03-01T16:00:00Z'))).toEqual({ date: '2024-03-02', time: '00:00' });
    expect(clock('America/New_York', new Date('2024-03-10T06:59:00Z')).time).toBe('01:59');
    expect(clock('America/New_York', new Date('2024-03-10T07:00:00Z')).time).toBe('03:00');
    expect(weekStart(today)).toBe('2024-02-26');
    expect(weekStart(today, 'sunday')).toBe('2024-02-25');
  });

  it('checks daily, workday, weekend and selected-day plans', () => {
    expect(applies(daily, today)).toBe(true);
    expect(applies(weekday, today)).toBe(false);
    expect(applies({ type: 'weekends', weekdays: [] }, today)).toBe(true);
    expect(applies({ type: 'custom', weekdays: [1, 6] }, today)).toBe(true);
    expect(applies({ type: 'custom', weekdays: [1, 6] }, '2024-02-29')).toBe(false);
  });
});

describe('habit statistics', () => {
  it('excludes days before start and future days from weighted totals', () => {
    const data = records([habit('book', daily, '2024-02-29'), habit('code', weekday, '2024-03-01')], [
      ['book', '2024-02-29'], ['book', '2024-03-01'], ['code', '2024-03-01'],
    ]);
    const stats = makeStats(data, today);
    expect(stats.daily('2024-02-28')).toMatchObject({ planned: 0, done: 0 });
    expect(stats.daily('2024-03-01')).toMatchObject({ planned: 2, done: 2 });
    expect(stats.daily('2024-03-03')).toMatchObject({ planned: 0, done: 0 });
    expect(stats.due('2024-03-03')).toHaveLength(1);
    const summary = summarize(stats.range('2024-02-26', '2024-03-15'));
    expect(summary).toEqual({ planned: 4, done: 3, rate: 75, active: 2, perfect: 2 });
  });

  it('calculates week and month buckets across a month boundary', () => {
    const stats = makeStats(records([habit('book')], [['book', '2024-02-29']]), today);
    const rows = stats.range('2024-02-26', '2024-04-01');
    expect(grouped(rows, 'week', 'sunday')).toEqual([{ date: '2024-02-25', planned: 6, done: 1 }]);
    expect(grouped(rows, 'month')).toEqual([
      { date: '2024-02-01', planned: 4, done: 1 },
      { date: '2024-03-01', planned: 2, done: 0 },
    ]);
  });

  it('returns a missing rate when there are zero plans', () => {
    expect(rate({ planned: 0, done: 0 })).toBeNull();
    expect(pct(summarize([]).rate)).toBe('—');
    expect(pct(100 / 3)).toBe('33.3%');
  });

  it('preserves the latest streak while today is unfinished and skips unplanned dates', () => {
    const work = habit('code', weekday, '2024-02-29');
    const stats = makeStats(records([work], [['code', '2024-02-29'], ['code', '2024-03-01']]), '2024-03-04');
    expect(stats.habitStreak(work)).toEqual({ current: 2, longest: 2, last: '2024-03-01', total: 2 });
    expect(stats.overall().current).toBe(2);
  });

  it('breaks streaks on a missed past plan and rebuilds after a backfill', () => {
    const data = records([habit('book', daily, '2024-02-29')], [['book', '2024-02-29'], ['book', today]]);
    expect(makeStats(data, today).overall()).toMatchObject({ current: 1, longest: 1 });
    data.entries.push({ habitId: 'book', date: '2024-03-01', completed: true, createdAt: stamp, updatedAt: stamp });
    expect(makeStats(data, today).overall()).toMatchObject({ current: 3, longest: 3 });
    data.entries[0].completed = false;
    expect(makeStats(data, today).overall().current).toBe(2);
  });

  it('requires all plans for a global streak and skips an archived interval', () => {
    const book = habit('book', daily, '2024-02-29');
    book.revisions.push({ effective: '2024-03-01', schedule: null }, { effective: '2024-03-03', schedule: daily });
    const data = records([book, habit('code', daily, '2024-02-29')], [
      ['book', '2024-02-29'], ['book', '2024-03-03'], ['code', '2024-03-02'], ['code', '2024-03-03'],
    ]);
    const stats = makeStats(data, '2024-03-03');
    expect(stats.habitStreak(book).current).toBe(2);
    expect(stats.overall().current).toBe(2);
    expect(stats.daily('2024-02-29').done).toBe(1);
    expect(streak(stats.range('2024-02-29', '2024-03-01'), '2024-03-01').longest).toBe(0);
  });

  it('distinguishes all heatmap states', () => {
    const level = (done: number) => heatLevel({ date: today, planned: 100, done }, today);
    expect([0, 25, 50, 75, 99, 100].map(level)).toEqual(['zero', 'level-1', 'level-2', 'level-3', 'level-4', 'level-5']);
    expect(heatLevel({ date: today, planned: 0, done: 0 }, today)).toBe('none');
    expect(heatLevel({ date: '2024-03-03', planned: 0, done: 0 }, today)).toBe('future');
  });

  it('derives count, completion rate and streak goals from linked habits', () => {
    const stats = makeStats(records([habit('book'), habit('code')], [
      ['book', '2024-02-29'], ['book', '2024-03-01'], ['code', '2024-03-01'],
    ]), today);
    expect(stats.goalProgress(goal)).toMatchObject({ value: 2, status: '达成', progress: 100 });
    expect(stats.goalProgress({ ...goal, goalType: 'streak', targetValue: 3 })).toMatchObject({ value: 2, status: '进行中' });
    const rateGoal: Goal = { ...goal, goalType: 'completionRate', targetValue: 50, startDate: '2024-02-29', endDate: '2024-03-03' };
    expect(stats.goalProgress(rateGoal)).toMatchObject({ status: '暂达标', progress: 100 });
    expect(stats.goalProgress({ ...rateGoal, endDate: '2024-03-01' }).status).toBe('达成');
    expect(stats.goalProgress({ ...rateGoal, targetValue: 110, endDate: '2024-03-01' }).status).toBe('已截止');
    expect(stats.goalProgress({ ...goal, startDate: '2024-03-03' }).status).toBe('待开始');
  });
});

describe('timer and backup validation', () => {
  it('uses an absolute deadline, keeps pauses stable and records a focus session once', () => {
    const startedAt = Date.parse(stamp);
    const deadline = startedAt + 60_000;
    const data = emptySnapshot();
    data.timer = { id: 'timer-1', mode: 'focus', startedAt, plannedSeconds: 60, remainingMs: 60_000, deadline };
    expect(millisecondsLeft(data.timer, startedAt + 20_000)).toBe(40_000);
    expect(millisecondsLeft({ ...data.timer, deadline: null, remainingMs: 39_000 }, deadline + 2000)).toBe(39_000);
    expect(finishTimer(data, deadline - 1)).toBe(false);
    expect(finishTimer(data, deadline + 1000)).toBe(true);
    expect(finishTimer(data, deadline + 2000)).toBe(false);
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0]).toMatchObject({ actualSeconds: 60, endedAt: new Date(deadline).toISOString(), completed: true });
  });

  it('rejects malformed, incompatible, duplicative and orphaned backup input', () => {
    const good = records([habit('book')], [['book', today]]);
    expect(parseBackup(JSON.stringify(good))).toEqual(good);
    expect(() => parseBackup('{')).toThrow(/JSON/);
    expect(() => parseBackup(JSON.stringify({ ...good, version: 3 }))).toThrow(/导入/);
    expect(() => parseBackup(JSON.stringify({ ...good, entries: [...good.entries, ...good.entries] }))).toThrow(/重复/);
    expect(() => parseBackup(JSON.stringify({ ...good, habits: [] }))).toThrow(/关联/);
  });
});
