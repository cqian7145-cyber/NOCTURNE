import Dexie, { liveQuery, type Table } from 'dexie';
import { addDays, clock, maxDay, validDay } from './dates';
import { elapsedStopwatch, finishTimer, millisecondsLeft, saveWorkSession } from './focus';
import {
  emptySnapshot, goalGraphIssue, mergeBackup, parseDomain, parseEvent, parseGoal, parseHabit, parseReview, parseRoutine, parseSettings, snapshotSchema,
  type ChronicleEvent, type Domain, type FocusMode, type GoalFields, type Habit, type HabitFields, type Review, type Settings, type Snapshot,
} from './model';
import { scheduled, weeklyCommitment } from './stats';

type Record = { id: 'current'; value: Snapshot };
type Mutation<T> = (draft: Snapshot) => T;
const recordId = 'current';
const timestamp = () => new Date().toISOString();
const id = () => crypto.randomUUID();

class JournalDatabase extends Dexie {
  journal!: Table<Record, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ journal: 'id' });
    this.version(2).stores({ journal: 'id' }).upgrade(transaction => transaction.table<Record>('journal')
      .toCollection().modify(row => { row.value = snapshotSchema.parse(row.value); }));
    this.on('populate', async () => {
      await this.journal.add({ id: recordId, value: emptySnapshot() });
    });
  }
}

function upsert<T extends { id: string }>(items: T[], item: T, max: number) {
  const index = items.findIndex(current => current.id === item.id);
  if (index < 0) {
    if (items.length >= max) throw new Error('此类记录已达数量上限。');
    return [...items, item];
  }
  return items.map((current, position) => position === index ? item : current);
}

function removeGoals(data: Snapshot, removed: Set<string>) {
  if (!removed.size) return;
  data.goals = data.goals.filter(goal => !removed.has(goal.id));
  for (const goal of data.goals) {
    if (goal.parentId && removed.has(goal.parentId)) { delete goal.parentId; goal.updatedAt = timestamp(); }
    if (goal.dependencies?.some(id => removed.has(id))) {
      goal.dependencies = goal.dependencies.filter(id => !removed.has(id));
      goal.updatedAt = timestamp();
    }
  }
  for (const session of [...data.sessions, ...(data.timer ? [data.timer] : [])]) {
    if (session.goalId && removed.has(session.goalId)) delete session.goalId;
  }
}

function reachedWeeklyCommitment(data: Snapshot, habit: Habit, date: string) {
  const commitment = weeklyCommitment(habit, date, data.settings.weekStartsOn, data.entries);
  return !!commitment && commitment.done >= commitment.target;
}

export function createRepository(name = 'nocturne') {
  const db = new JournalDatabase(name);

  async function read() {
    const row = await db.journal.get(recordId);
    return row ? snapshotSchema.parse(row.value) : emptySnapshot();
  }

  async function change<T>(mutate: Mutation<T>, write: (result: T) => boolean = () => true): Promise<T> {
    return db.transaction('rw', db.journal, async () => {
      const row = await db.journal.get(recordId);
      const data = row?.value ?? emptySnapshot();
      const result = mutate(data);
      if (write(result)) await db.journal.put({ id: recordId, value: data });
      return result;
    });
  }

  function findHabit(data: Snapshot, habitId: string) {
    const habit = data.habits.find(item => item.id === habitId);
    if (!habit) throw new Error('这个习惯已不存在。');
    return habit;
  }

  function scheduleAt(habit: Habit, effective: string, value: Habit['revisions'][number]['schedule']) {
    habit.revisions = [...habit.revisions.filter(rule => rule.effective < effective), { effective, schedule: value }];
  }

  return {
    read,
    connect: () => db.open(),
    observe: () => liveQuery(read),
    close: () => db.close(),
    resetConnection: () => db.close({ disableAutoOpen: false }),
    saveHabit(input: HabitFields, habitId?: string) {
      const fields = parseHabit(input);
      return change(data => {
        const today = clock(data.settings.zone).date;
        const now = timestamp();
        if (fields.domainId && !data.domains.some(d => d.id === fields.domainId)) throw new Error('领域已不存在。');
        if (fields.routineId && !data.routines.some(r => r.id === fields.routineId)) throw new Error('例行组合已不存在。');
        if (!habitId) {
          if (data.habits.length >= 250) throw new Error('习惯数量已达 250 项。');
          data.habits.push({
            ...fields, id: id(), sortOrder: Math.max(0, ...data.habits.map(h => h.sortOrder + 1)),
            revisions: [{ effective: fields.startDate, schedule: fields.schedule }], createdAt: now, updatedAt: now,
          });
          return;
        }

        const habit = findHabit(data, habitId);
        const oldPast = (habit.pauses ?? []).filter(range => range.start <= today);
        const newPast = (fields.pauses ?? []).filter(range => range.start <= today);
        if (JSON.stringify(oldPast) !== JSON.stringify(newPast)) throw new Error('已开始的暂停区间保留在历史中。');
        const startChanged = fields.startDate !== habit.startDate;
        const scheduleChanged = JSON.stringify(fields.schedule) !== JSON.stringify(habit.schedule);
        const fieldsToApply = { ...fields };
        if (startChanged || scheduleChanged) {
          if (habit.startDate > today && !habit.archivedAt && habit.revisions.length === 1) {
            fieldsToApply.startDate = maxDay(fields.startDate, today);
            habit.revisions = [{ effective: fieldsToApply.startDate, schedule: fields.schedule }];
          } else if (!habit.archivedAt) {
            const tomorrow = addDays(today, 1);
            fieldsToApply.startDate = startChanged ? maxDay(fields.startDate, tomorrow) : habit.startDate;
            const effective = maxDay(fieldsToApply.startDate, tomorrow);
            if (effective > tomorrow) scheduleAt(habit, tomorrow, null);
            scheduleAt(habit, effective, fields.schedule);
          } else if (startChanged) {
            fieldsToApply.startDate = maxDay(today, fields.startDate);
          }
        }
        Object.assign(habit, fieldsToApply, { updatedAt: now });
      });
    },
    archive(habitId: string, archived: boolean) {
      return change(data => {
        const habit = findHabit(data, habitId);
        if (!!habit.archivedAt === archived) return;
        const today = clock(data.settings.zone).date;
        const now = timestamp();
        if (archived) {
          scheduleAt(habit, addDays(today, 1), null);
          habit.archivedAt = now;
        } else {
          const pause = habit.revisions.at(-1);
          const effective = maxDay(maxDay(today, habit.startDate), pause?.schedule === null ? pause.effective : today);
          scheduleAt(habit, effective, habit.schedule);
          delete habit.archivedAt;
        }
        habit.updatedAt = now;
      });
    },
    resumeHabit(habitId: string) {
      return change(data => {
        const habit = findHabit(data, habitId);
        const today = clock(data.settings.zone).date;
        habit.pauses = habit.pauses?.flatMap(pause => {
          if (pause.end < today || pause.start > today) return [pause];
          return pause.start === today ? [] : [{ ...pause, end: addDays(today, -1) }];
        });
        habit.updatedAt = timestamp();
      });
    },
    move(habitId: string, direction: -1 | 1) {
      return change(data => {
        const list = data.habits.filter(h => !h.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder);
        const from = list.findIndex(h => h.id === habitId);
        const to = from + direction;
        if (from < 0 || to < 0 || to >= list.length) return;
        [list[from], list[to]] = [list[to], list[from]];
        const now = timestamp();
        list.forEach((habit, order) => {
          if (habit.sortOrder !== order) Object.assign(habit, { sortOrder: order, updatedAt: now });
        });
      });
    },
    deleteHabit(habitId: string) {
      return change(data => {
        data.habits = data.habits.filter(h => h.id !== habitId);
        data.entries = data.entries.filter(e => e.habitId !== habitId);
        const now = timestamp();
        data.goals = data.goals.map(goal => goal.habitIds.includes(habitId)
          ? { ...goal, habitIds: goal.habitIds.filter(h => h !== habitId), updatedAt: now } : goal);
        removeGoals(data, new Set(data.goals.filter(goal => !goal.habitIds.length).map(goal => goal.id)));
        data.sessions.forEach(session => { if (session.habitId === habitId) delete session.habitId; });
        if (data.timer?.habitId === habitId) delete data.timer.habitId;
        if (data.reminded) data.reminded.items = data.reminded.items.filter(h => h !== habitId);
      });
    },
    setEntry(habitId: string, date: string, completed: boolean, expected: boolean, detail?: { quantity?: number; skipReason?: string; revision?: string | null }) {
      return change(data => {
        const habit = findHabit(data, habitId);
        if (!validDay(date) || date > clock(data.settings.zone).date || !scheduled(habit, date)) throw new Error('该日期没有可更新的计划。');
        const entry = data.entries.find(e => e.habitId === habitId && e.date === date);
        if ((entry?.completed ?? false) !== expected) throw new Error('这条打卡已在其他标签页更新。');
        if (detail?.revision !== undefined && (entry?.updatedAt ?? null) !== detail.revision) throw new Error('这条记录已在其他标签页更新。');
        const quantity = detail?.quantity;
        const skipReason = detail?.skipReason?.trim();
        if (quantity !== undefined && (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || !habit.measurement)) throw new Error('请输入有效的量化记录。');
        if (skipReason && (skipReason.length > 160 || quantity !== undefined)) throw new Error('请输入有效的跳过原因。');
        const done = skipReason ? false : quantity === undefined ? completed : quantity >= habit.measurement!.minimum;
        const values = { completed: done, quantity, skipReason: skipReason || undefined };
        const now = timestamp();
        if (entry) Object.assign(entry, values, { updatedAt: now });
        else {
          if (data.entries.length >= 500_000) throw new Error('打卡记录已达到本地容量上限。');
          data.entries.push({ habitId, date, ...values, createdAt: now, updatedAt: now });
        }
      });
    },
    saveGoal(input: GoalFields, goalId?: string) {
      const fields = parseGoal(input);
      return change(data => {
        if (fields.habitIds.some(h => !data.habits.some(item => item.id === h))) throw new Error('关联习惯已不存在。');
        if (fields.domainId && !data.domains.some(d => d.id === fields.domainId)) throw new Error('领域已不存在。');
        const now = timestamp();
        if (goalId) {
          const existing = data.goals.find(goal => goal.id === goalId);
          if (!existing) throw new Error('目标已不存在。');
          Object.assign(existing, fields, { updatedAt: now });
        } else {
          if (data.goals.length >= 2000) throw new Error('目标数量已达到上限。');
          data.goals.push({ ...fields, id: id(), createdAt: now, updatedAt: now });
        }
        const invalid = goalGraphIssue(data.goals);
        if (invalid) throw new Error(invalid);
      });
    },
    setMilestone(goalId: string, milestoneId: string, completed: boolean) {
      return change(data => {
        const goal = data.goals.find(item => item.id === goalId);
        const milestone = goal?.milestones?.find(item => item.id === milestoneId);
        if (!goal || !milestone) throw new Error('里程碑已不存在。');
        milestone.doneOn = completed ? clock(data.settings.zone).date : undefined;
        goal.updatedAt = timestamp();
      });
    },
    deleteGoal(goalId: string) {
      return change(data => { removeGoals(data, new Set([goalId])); });
    },
    saveDomain(value: Omit<Domain, 'id' | 'updatedAt'>, existing?: string) {
      return change(data => {
        const item = parseDomain({ ...value, id: existing ?? id(), updatedAt: timestamp() });
        data.domains = upsert(data.domains, item, 100);
      });
    },
    saveRoutine(title: string, existing?: string) {
      return change(data => {
        const item = parseRoutine({ title, id: existing ?? id(), updatedAt: timestamp() });
        data.routines = upsert(data.routines, item, 100);
      });
    },
    saveEvent(value: Omit<ChronicleEvent, 'id' | 'updatedAt'>, existing?: string) {
      return change(data => {
        const item = parseEvent({ ...value, id: existing ?? id(), updatedAt: timestamp() });
        if (item.date > clock(data.settings.zone).date) throw new Error('只可记录已经发生的事件。');
        if (item.domainId && !data.domains.some(d => d.id === item.domainId)) throw new Error('领域已不存在。');
        data.events = upsert(data.events, item, 10_000);
      });
    },
    deleteEvent(eventId: string) {
      return change(data => { data.events = data.events.filter(item => item.id !== eventId); });
    },
    saveReview(type: Review['type'], periodKey: string, reflection: Review['reflection']) {
      return change(data => {
        const value = parseReview({ type, periodKey, reflection, updatedAt: timestamp() });
        const index = data.reviews.findIndex(r => r.type === type && r.periodKey === periodKey);
        if (index >= 0) data.reviews[index] = value;
        else {
          if (data.reviews.length >= 6000) throw new Error('复盘记录已达到本地容量上限。');
          data.reviews.push(value);
        }
      });
    },
    saveSettings(value: Settings) {
      const settings = parseSettings(value);
      return change(data => { data.settings = settings; });
    },
    startTimer(mode: FocusMode, minutes: number, habitId?: string, details?: { goalId?: string; task?: string }) {
      if (mode !== 'stopwatch' && (!Number.isInteger(minutes) || minutes < 1 || minutes > 180)) throw new Error('请输入 1–180 分钟。');
      return change(data => {
        const now = Date.now();
        finishTimer(data, now);
        if (data.timer) throw new Error('当前已有计时，请先结束或重置。');
        const remainingMs = minutes * 60_000;
        const habit = habitId ? findHabit(data, habitId) : undefined;
        const goal = data.goals.find(item => item.id === details?.goalId);
        if (details?.goalId && !goal) throw new Error('关联目标已不存在。');
        const task = details?.task?.trim();
        if (task && task.length > 120) throw new Error('专注任务名称过长。');
        const timing = mode === 'stopwatch'
          ? { plannedSeconds: 86_400, remainingMs: 0, deadline: null, elapsedMs: 0, runningSince: now }
          : { plannedSeconds: minutes * 60, remainingMs, deadline: now + remainingMs };
        data.timer = { id: id(), mode, habitId, goalId: goal?.id, domainId: goal?.domainId ?? habit?.domainId, task, startedAt: now, ...timing };
      });
    },
    updateTimer(action: 'pause' | 'resume' | 'reset' | 'tick' | 'stop', timerId: string) {
      return change(data => {
        const timer = data.timer;
        if (!timer || timer.id !== timerId) return null;
        const now = Date.now();
        if (timer.mode === 'stopwatch') {
          if (action === 'reset') data.timer = null;
          if (action === 'pause') {
            timer.elapsedMs = elapsedStopwatch(timer, now);
            delete timer.runningSince;
          }
          if (action === 'resume') timer.runningSince ??= now;
          if (action === 'stop') {
            const elapsed = Math.floor(elapsedStopwatch(timer, now) / 1000);
            if (!elapsed) throw new Error('计时至少达到 1 秒才能保存。');
            saveWorkSession(data, timer, now, elapsed);
            data.timer = null;
            return timer.mode;
          }
          return null;
        }
        if (finishTimer(data, now)) return timer.mode;
        if (action === 'reset') data.timer = null;
        if (action === 'pause' && timer.deadline !== null) {
          timer.remainingMs = millisecondsLeft(timer, now);
          timer.deadline = null;
        }
        if (action === 'resume' && timer.deadline === null) timer.deadline = now + timer.remainingMs;
        return null;
      });
    },
    claimReminders() {
      return change(data => {
        if (!data.settings.reminders) return [];
        const { date, time } = clock(data.settings.zone);
        if (data.reminded?.date !== date) data.reminded = { date, items: [] };
        const due = data.habits.filter(habit => !habit.archivedAt && habit.reminderEnabled &&
          habit.reminderTime <= time && scheduled(habit, date) && !data.reminded?.items.includes(habit.id) &&
          !reachedWeeklyCommitment(data, habit, date) &&
          !data.entries.some(entry => entry.habitId === habit.id && entry.date === date && entry.completed));
        data.reminded.items.push(...due.map(habit => habit.id));
        return due.map(habit => habit.name);
      }, due => due.length > 0);
    },
    async backup() {
      return JSON.stringify(await read(), null, 2);
    },
    restore(imported: Snapshot, mode: 'merge' | 'replace') {
      const incoming = snapshotSchema.parse(imported);
      return change(data => {
        const restored = mode === 'merge' ? mergeBackup(data, incoming) : incoming;
        Object.assign(data, restored);
      });
    },
    clear() {
      return change(data => { Object.assign(data, emptySnapshot()); });
    },
  };
}

export const repository = createRepository();
