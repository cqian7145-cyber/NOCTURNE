import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBackup, type HabitFields } from './model';
import { createRepository } from './repository';
import { makeStats } from './stats';

const today = '2026-11-23';
const tuesday = '2026-11-24';
const wednesday = '2026-11-25';
const fields: HabitFields = {
  name: '英语学习', description: '', icon: 'book', color: 'lilac', category: '学习', startDate: '2026-11-20',
  schedule: { type: 'daily', weekdays: [] }, reminderEnabled: false, reminderTime: '09:00',
};
const setTime = (date: string, localHour = '10:00') => {
  vi.setSystemTime(new Date(date + 'T' + localHour + ':00+08:00'));
};

let name: string;
let repo: ReturnType<typeof createRepository>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  setTime(today);
  name = 'nocturne-test-' + crypto.randomUUID();
  repo = createRepository(name);
  const initial = await repo.read();
  await repo.saveSettings({ ...initial.settings, zone: 'Asia/Shanghai' });
});

afterEach(async () => {
  repo.close();
  await Dexie.delete(name);
  vi.useRealTimers();
});

async function addHabit(overrides: Partial<HabitFields> = {}) {
  await repo.saveHabit({ ...fields, ...overrides });
  return (await repo.read()).habits.at(-1)!;
}

describe('IndexedDB repository', () => {
  it('creates, checks, reopens and undoes without duplicating an entry', async () => {
    const h = await addHabit();
    await repo.setEntry(h.id, today, true, false);
    repo.close();
    repo = createRepository(name);
    const first = (await repo.read()).entries[0];
    expect(first).toMatchObject({ habitId: h.id, date: today, completed: true });
    setTime(today, '10:02');
    await repo.setEntry(h.id, today, false, true);
    expect((await repo.read()).entries).toEqual([{ ...first, completed: false, updatedAt: '2026-11-23T02:02:00.000Z' }]);
  });

  it('updates rules tomorrow and preserves same-day and historical records', async () => {
    const h = await addHabit();
    await repo.setEntry(h.id, '2026-11-21', true, false);
    await repo.saveHabit({ ...fields, name: '英语听力', schedule: { type: 'weekends', weekdays: [] } }, h.id);
    const data = await repo.read();
    const stats = makeStats(data, today);
    expect(stats.daily('2026-11-21').done).toBe(1);
    expect(stats.daily(today).planned).toBe(1);
    expect(stats.due(tuesday)).toHaveLength(0);
    expect(data.habits[0].name).toBe('英语听力');
  });

  it('preserves today when undoing same-day archive, even after a plan edit', async () => {
    const h = await addHabit();
    await repo.saveHabit({ ...fields, schedule: { type: 'weekends', weekdays: [] } }, h.id);
    await repo.archive(h.id, true);
    await repo.archive(h.id, false);
    const stats = makeStats(await repo.read(), today);
    expect(stats.due(today)).toHaveLength(1);
    expect(stats.due(tuesday)).toHaveLength(0);
  });

  it('skips archived days and retains checks after restoring', async () => {
    const h = await addHabit({ startDate: today });
    await repo.setEntry(h.id, today, true, false);
    await repo.archive(h.id, true);
    setTime(wednesday);
    await repo.archive(h.id, false);
    await repo.setEntry(h.id, wednesday, true, false);
    const stats = makeStats(await repo.read(), wednesday);
    expect(stats.daily(today).done).toBe(1);
    expect(stats.daily(tuesday).planned).toBe(0);
    expect(stats.overall().current).toBe(2);
  });

  it('rejects future, off-plan and invalid day changes atomically', async () => {
    const h = await addHabit({ startDate: today });
    await expect(repo.setEntry(h.id, tuesday, true, false)).rejects.toThrow(/计划/);
    await expect(repo.setEntry(h.id, '2026-11-22', true, false)).rejects.toThrow(/计划/);
    await expect(repo.setEntry(h.id, '2026-11-00', true, false)).rejects.toThrow(/计划/);
    expect((await repo.read()).entries).toEqual([]);
  });

  it('handles concurrent writes without creating duplicate records or losing unrelated checks', async () => {
    const a = await addHabit();
    const b = await addHabit({ name: '阅读' });
    const another = createRepository(name);
    try {
      const writes = await Promise.allSettled([
        repo.setEntry(a.id, today, true, false),
        another.setEntry(a.id, today, true, false),
        another.setEntry(b.id, today, true, false),
      ]);
      expect(writes.filter(result => result.status === 'fulfilled')).toHaveLength(2);
      expect((await another.read()).entries).toHaveLength(2);
    } finally { another.close(); }
  });

  it('persists goals and review edits and preserves them in backups', async () => {
    const h = await addHabit();
    await repo.saveGoal({ title: '读书十次', description: '', habitIds: [h.id], goalType: 'count', targetValue: 10, startDate: today });
    await repo.saveReview('weekly', today, ['继续', '', '']);
    await repo.saveReview('weekly', today, ['继续阅读', '时间', '改到早上']);
    const backup = parseBackup(await repo.backup());
    expect(backup.goals).toHaveLength(1);
    expect(backup.reviews.map(review => review.reflection)).toEqual([['继续阅读', '时间', '改到早上']]);
    await repo.clear();
    expect((await repo.read()).reviews).toHaveLength(0);
    await repo.restore(backup, 'replace');
    expect((await repo.read()).settings.zone).toBe('Asia/Shanghai');
    expect((await repo.read()).goals[0].habitIds).toEqual([h.id]);
  });

  it('merges by timestamp and leaves the local snapshot untouched on invalid restore', async () => {
    const h = await addHabit();
    await repo.setEntry(h.id, today, true, false);
    const previous = parseBackup(await repo.backup());
    setTime(today, '10:10');
    await repo.setEntry(h.id, today, false, true);
    await repo.restore(previous, 'merge');
    expect((await repo.read()).entries[0].completed).toBe(false);
    const before = await repo.backup();
    await expect(async () => repo.restore({ ...previous, habits: [] }, 'replace')).rejects.toThrow();
    expect(await repo.backup()).toBe(before);
  });

  it('reminds once per local day and skips a habit already completed', async () => {
    const h = await addHabit({ name: '已完成', reminderEnabled: true });
    await repo.setEntry(h.id, today, true, false);
    await addHabit({ name: '到点提醒', reminderEnabled: true });
    await addHabit({ name: '稍后提醒', reminderEnabled: true, reminderTime: '11:00' });
    const another = createRepository(name);
    try {
      const reminders = await Promise.all([repo.claimReminders(), another.claimReminders()]);
      expect(reminders.flat()).toEqual(['到点提醒']);
      setTime(today, '11:01');
      expect(await repo.claimReminders()).toEqual(['稍后提醒']);
    } finally { another.close(); }
  });

  it('stores paused and resumed timer state and only records a finished focus once', async () => {
    const h = await addHabit();
    await repo.startTimer('focus', 1, h.id);
    const timer = (await repo.read()).timer!;
    vi.setSystemTime(new Date(timer.startedAt + 2000));
    await repo.updateTimer('pause', timer.id);
    expect((await repo.read()).timer).toMatchObject({ deadline: null, remainingMs: 58_000 });
    vi.setSystemTime(new Date(timer.startedAt + 120_000));
    expect(await repo.updateTimer('tick', timer.id)).toBeNull();
    await repo.updateTimer('resume', timer.id);
    vi.setSystemTime(new Date(timer.startedAt + 185_000));
    const results = await Promise.all([repo.updateTimer('tick', timer.id), repo.updateTimer('tick', timer.id)]);
    expect(results).toEqual(['focus', null]);
    const data = await repo.read();
    expect(data.timer).toBeNull();
    expect(data.sessions).toHaveLength(1);
    expect(data.entries).toEqual([]);
  });
});
