import { addDays, dayKeys, minDay, monthStart, weekStart, weekday, type WeekStart } from './dates';
import { entryKey, type Goal, type Habit, type Schedule, type Snapshot } from './model';

export type DayStat = { date: string; planned: number; done: number };
export const rate = ({ planned, done }: Pick<DayStat, 'planned' | 'done'>) => planned ? done / planned * 100 : null;
export const pct = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value) + '%';

export function applies(schedule: Schedule, date: string) {
  const day = weekday(date);
  if (schedule.type === 'daily') return true;
  if (schedule.type === 'weekdays') return day >= 1 && day <= 5;
  if (schedule.type === 'weekends') return day === 0 || day === 6;
  return schedule.weekdays.includes(day);
}

function revisionOn(habit: Habit, date: string) {
  for (let index = habit.revisions.length - 1; index >= 0; index--) {
    if (habit.revisions[index].effective <= date) return habit.revisions[index];
  }
}

export function scheduled(habit: Habit, date: string) {
  const schedule = revisionOn(habit, date)?.schedule;
  return !!schedule && applies(schedule, date) && !habit.pauses?.some(pause => pause.start <= date && date <= pause.end);
}

export function weeklyCommitment(habit: Habit, date: string, startOfWeek: WeekStart, entries: Snapshot['entries']) {
  const revision = revisionOn(habit, date);
  const quota = revision?.schedule?.quota;
  if (!quota) return null;
  const start = weekStart(date, startOfWeek);
  const days = dayKeys(start, addDays(start, 6)).filter(day => revisionOn(habit, day) === revision && scheduled(habit, day));
  return { target: Math.min(quota, days.length), done: entries.filter(entry => entry.habitId === habit.id && entry.completed && days.includes(entry.date) && entry.date <= date).length };
}

export function summarize(rows: DayStat[]) {
  const totals = { planned: 0, done: 0, active: 0, perfect: 0 };
  for (const row of rows) {
    totals.planned += row.planned;
    totals.done += row.done;
    totals.active += Number(row.done > 0);
    totals.perfect += Number(row.planned > 0 && row.done === row.planned);
  }
  return { ...totals, rate: rate(totals) };
}

export function streak(rows: DayStat[], today: string) {
  let current = 0;
  let longest = 0;
  let last: string | undefined;
  let total = 0;
  for (const row of rows) {
    total += row.done;
    if (row.done) last = row.date;
    if (!row.planned) continue;
    if (row.done === row.planned) current++;
    else if (row.date < today) current = 0;
    longest = Math.max(current, longest);
  }
  return { current, longest, last, total };
}

export function grouped(rows: DayStat[], unit: 'week' | 'month', start: WeekStart = 'monday') {
  const map = new Map<string, DayStat>();
  for (const row of rows) {
    const date = unit === 'week' ? weekStart(row.date, start) : monthStart(row.date);
    const group = map.get(date) ?? { date, planned: 0, done: 0 };
    group.planned += row.planned;
    group.done += row.done;
    map.set(date, group);
  }
  return [...map.values()];
}

export function heatLevel(row: DayStat, today: string) {
  if (row.date > today) return 'future';
  if (!row.planned) return 'none';
  if (!row.done) return 'zero';
  return 'level-' + (row.done === row.planned ? 5 : Math.ceil((row.done / row.planned) * 4));
}

export function makeStats(data: Snapshot, today: string) {
  const entries = new Map(data.entries.map(entry => [entryKey(entry), entry]));
  const habits = [...data.habits].sort((a, b) => a.sortOrder - b.sortOrder);
  const earliest = habits.reduce((date, habit) => minDay(date, habit.revisions[0].effective), today);
  const findEntry = (habitId: string, date: string) => entries.get(entryKey({ habitId, date }));
  const eligible = (habit: Habit, date: string) => scheduled(habit, date);
  const due = (date: string, selected = habits) => selected.filter(habit => eligible(habit, date));
  const quotaCache = new Map<string, Set<string>>();

  // Flexible weekly commitments count performed dates immediately and charge any
  // unmet slots on the last eligible dates after the week closes.
  function counted(habit: Habit, date: string) {
    if (!eligible(habit, date)) return false;
    const revision = revisionOn(habit, date);
    const quota = revision?.schedule?.quota;
    if (!quota) return true;
    const start = weekStart(date, data.settings.weekStartsOn);
    const end = addDays(start, 6);
    const key = habit.id + ':' + start + ':' + revision.effective;
    let allocation = quotaCache.get(key);
    if (!allocation) {
      const candidates = dayKeys(start, end).filter(day => revisionOn(habit, day) === revision && eligible(habit, day));
      const completed = candidates.filter(day => day <= today && findEntry(habit.id, day)?.completed);
      const missing = Math.min(quota, candidates.length) - completed.length;
      allocation = new Set(completed);
      if (end < today && missing > 0) {
        candidates.filter(day => !allocation!.has(day)).slice(-missing).forEach(day => allocation!.add(day));
      }
      quotaCache.set(key, allocation);
    }
    return allocation.has(date);
  }

  function daily(date: string, selected?: Habit[]): DayStat {
    // Future days may show their plan in Calendar but never add to statistics.
    if (date > today) return { date, planned: 0, done: 0 };
    const planned = (selected ?? habits).filter(habit => counted(habit, date));
    return { date, planned: planned.length, done: planned.filter(habit => findEntry(habit.id, date)?.completed).length };
  }

  const range = (start: string, end: string, selected?: Habit[]) => dayKeys(start, minDay(end, today)).map(date => daily(date, selected));
  const habitStreak = (habit: Habit) => streak(range(habit.revisions[0].effective, today, [habit]), today);
  const habitPerformance = (start: string, end: string) => habits.map(habit => ({
    habit, ...summarize(range(start, end, [habit])),
  })).filter(row => row.planned).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || b.done - a.done);
  let aggregate: ReturnType<typeof streak> | undefined;
  const overall = () => aggregate ??= streak(range(earliest, today), today);

  const goalResults = new Map<Goal, ReturnType<typeof calculateGoal>>();
  function calculateGoal(goal: Goal): { value: number | null; status: string; progress: number; summary: ReturnType<typeof summarize> } {
    const linked = habits.filter(h => goal.habitIds.includes(h.id));
    const rows = range(goal.startDate, goal.endDate ?? today, linked);
    const summary = summarize(rows);
    const value = goal.goalType === 'count' ? summary.done : goal.goalType === 'streak' ? streak(rows, today).longest : summary.rate;
    const actionProgress = Math.min(100, (value ?? 0) / goal.targetValue * 100);
    const milestones = goal.milestones ?? [];
    const marked = milestones.filter(item => item.doneOn && item.doneOn <= today).length;
    const progress = milestones.length ? actionProgress * 0.75 + 25 * marked / milestones.length : actionProgress;
    const blocked = goal.dependencies?.some(id => {
      const dependency = data.goals.find(item => item.id === id);
      return !dependency || goalProgress(dependency).status !== '达成';
    });
    const reached = progress >= 100 && !blocked;
    const expired = !!goal.endDate && goal.endDate < today;
    const upcoming = goal.startDate > today;
    let status = '进行中';
    if (upcoming) status = '待开始';
    else if (reached) status = goal.goalType === 'completionRate' && !expired ? '暂达标' : '达成';
    else if (expired) status = '已截止';
    else if (blocked) status = '等待前置目标';
    return { value, status, progress, summary };
  }

  function goalProgress(goal: Goal) {
    const cached = goalResults.get(goal);
    if (cached) return cached;
    const result = calculateGoal(goal);
    goalResults.set(goal, result);
    return result;
  }

  return { today, habits, findEntry, due, counted, daily, range, habitStreak, habitPerformance, overall, goalProgress };
}

export const lastDays = (today: string, count: number) => addDays(today, 1 - count);
export type Stats = ReturnType<typeof makeStats>;
