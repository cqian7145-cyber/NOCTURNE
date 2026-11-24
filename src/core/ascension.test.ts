import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptBackup, encryptBackup } from './encryption';
import { association, deepWork, period, timeline } from './growth';
import { emptySnapshot, parseBackup, type HabitFields } from './model';
import { createRepository } from './repository';
import { makeStats, summarize } from './stats';

const monday = '2026-11-23';
const input: HabitFields = {
  name: '阅读', description: '', category: '学习', icon: 'book', color: 'amber', startDate: monday,
  schedule: { type: 'daily', weekdays: [] }, reminderEnabled: false, reminderTime: '20:00',
};
let dbName: string;
let repo: ReturnType<typeof createRepository>;

beforeEach(async () => {
  dbName = 'nocturne-v2-test-' + crypto.randomUUID();
  repo = createRepository(dbName);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T02:00:00.000Z'));
});
afterEach(async () => {
  repo.close();
  await Dexie.delete(dbName);
  vi.useRealTimers();
});

describe('Ascension data', () => {
  it('upgrades a real v1 IndexedDB record and imports its backup without changing checks', async () => {
    const db = new Dexie(dbName);
    db.version(1).stores({ journal: 'id' });
    const stamp = new Date().toISOString();
    const { domains, routines, events, ...empty } = emptySnapshot();
    const legacy = {
      ...empty, version: 1,
      habits: [{ ...input, id: 'legacy', revisions: [{ effective: monday, schedule: input.schedule }], sortOrder: 0, createdAt: stamp, updatedAt: stamp }],
      entries: [{ habitId: 'legacy', date: monday, completed: true, createdAt: stamp, updatedAt: stamp }],
    };
    await db.table('journal').put({ id: 'current', value: legacy });
    db.close();
    const actual = await repo.read();
    expect(actual).toEqual({ ...legacy, version: 2, domains, routines, events });
    expect(parseBackup(JSON.stringify(legacy))).toEqual(actual);
    expect(makeStats(actual, monday).daily(monday).done).toBe(1);
  });

  it('records partial amounts and explicit skips without confusing either with a completed habit', async () => {
    await repo.saveHabit({ ...input, measurement: { minimum: 10, unit: '分钟' } });
    const habit = (await repo.read()).habits[0];
    await repo.setEntry(habit.id, monday, true, false, { quantity: 4 });
    expect((await repo.read()).entries[0]).toMatchObject({ quantity: 4, completed: false });
    await repo.setEntry(habit.id, monday, false, false, { skipReason: '考试' });
    const skipped = await repo.read();
    expect(skipped.entries[0]).toMatchObject({ completed: false, skipReason: '考试' });
    expect(makeStats(skipped, monday).daily(monday)).toMatchObject({ planned: 1, done: 0 });
    await repo.setEntry(habit.id, monday, true, false, { quantity: 13 });
    expect((await repo.read()).entries[0]).toMatchObject({ completed: true, quantity: 13, skipReason: undefined });
  });

  it('charges flexible weekly misses once the week closes and excludes scheduled rest', async () => {
    await repo.saveHabit({ ...input, schedule: { ...input.schedule, quota: 3 }, pauses: [{ start: '2026-11-27', end: '2026-11-27' }] });
    const habit = (await repo.read()).habits[0];
    await repo.setEntry(habit.id, monday, true, false);
    const data = await repo.read();
    data.settings.weekStartsOn = 'monday';
    const inProgress = makeStats(data, '2026-11-28');
    expect(inProgress.due('2026-11-27')).toHaveLength(0);
    expect(summarize(inProgress.range(monday, '2026-11-29'))).toMatchObject({ planned: 1, done: 1 });
    const closed = makeStats(data, '2026-11-30');
    expect(summarize(closed.range(monday, '2026-11-29'))).toMatchObject({ planned: 3, done: 1 });
    expect(association(closed, habit, habit, monday, '2026-11-29').value).toBeNull();
  });

  it('rejects cyclic goals and preserves dependency and focus references after deleting their last linked habit', async () => {
    await repo.saveHabit(input);
    await repo.saveHabit({ ...input, name: '写作' });
    const [habit, second] = (await repo.read()).habits;
    const value = { title: '阅读目标', description: '', habitIds: [habit.id], goalType: 'count' as const, targetValue: 1, startDate: monday };
    await repo.saveGoal(value);
    const [parent] = (await repo.read()).goals;
    await repo.saveGoal({ ...value, title: '写作目标', habitIds: [second.id], parentId: parent.id, dependencies: [parent.id],
      milestones: [{ id: 'first', title: '第一篇' }] });
    const child = (await repo.read()).goals[1];
    await expect(repo.saveGoal({ ...value, parentId: child.id }, parent.id)).rejects.toThrow(/循环/);
    await repo.setEntry(second.id, monday, true, false);
    expect(makeStats(await repo.read(), monday).goalProgress(child)).toMatchObject({ progress: 75, status: '等待前置目标' });
    await repo.setMilestone(child.id, 'first', true);
    await repo.startTimer('stopwatch', 0, second.id, { goalId: parent.id, task: '阅读' });
    await repo.deleteHabit(habit.id);
    const cleaned = await repo.read();
    expect(cleaned.goals[0].parentId).toBeUndefined();
    expect(cleaned.goals[0].dependencies).toEqual([]);
    expect(cleaned.timer?.goalId).toBeUndefined();
  });

  it('restores stopwatch elapsed time through pause and reload and builds the chronicle', async () => {
    const origin = Date.now();
    await repo.saveDomain({ title: '技术', description: '', color: 'amber' });
    const area = (await repo.read()).domains[0];
    await repo.saveHabit({ ...input, domainId: area.id });
    const habit = (await repo.read()).habits[0];
    await repo.startTimer('stopwatch', 0, habit.id, { task: '源码学习' });
    const timer = (await repo.read()).timer!;
    vi.setSystemTime(new Date(origin + 20_000));
    await repo.updateTimer('pause', timer.id);
    repo.close(); repo = createRepository(dbName);
    vi.setSystemTime(new Date(origin + 80_000));
    await repo.updateTimer('resume', timer.id);
    vi.setSystemTime(new Date(origin + 95_000));
    await repo.updateTimer('stop', timer.id);
    const data = await repo.read();
    expect(deepWork(data, monday, monday)[0]).toMatchObject({ actualSeconds: 35, area: area.id });
    expect(timeline(data, monday)).toEqual([expect.objectContaining({ title: '源码学习', domainId: area.id })]);
  });

  it('aligns quarterly and yearly reviews including leap years', () => {
    expect(period('quarterly', '2024-02-29', 'monday')).toMatchObject({ start: '2024-01-01', end: '2024-03-31' });
    expect(period('daily', '2024-02-29', 'monday').shift(1)).toBe('2024-03-01');
    expect(period('yearly', '2024-12-31', 'monday').shift(1)).toBe('2025-01-01');
  });

  it('round-trips encrypted backups and rejects wrong passwords or altered ciphertext', async () => {
    const raw = JSON.stringify({ ...emptySnapshot(), events: [] });
    const sealed = await encryptBackup(raw, 'a-long-backup-passphrase');
    expect(sealed).not.toContain('"habits"');
    expect(await decryptBackup(sealed, 'a-long-backup-passphrase')).toBe(raw);
    await expect(decryptBackup(sealed, 'a-wrong-backup-passphrase')).rejects.toThrow(/无法解密/);
    const value = JSON.parse(sealed);
    value.payload = (value.payload.startsWith('A') ? 'B' : 'A') + value.payload.slice(1);
    await expect(decryptBackup(JSON.stringify(value), 'a-long-backup-passphrase')).rejects.toThrow(/无法解密/);
  });
});
