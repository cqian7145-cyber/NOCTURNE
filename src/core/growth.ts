import { addDays, clock, minDay, monthEnd, monthShift, monthStart, weekStart } from './dates';
import type { Goal, Habit, Review, Snapshot } from './model';
import { makeStats, pct, summarize, type Stats } from './stats';

export const isWork = (item: { mode: string; completed: boolean }) => item.completed && (item.mode === 'focus' || item.mode === 'stopwatch');

export function period(type: Review['type'], date: string, start: Snapshot['settings']['weekStartsOn']) {
  if (type === 'daily') return { start: date, end: date, shift: (step: number) => addDays(date, step) };
  if (type === 'weekly') {
    const first = weekStart(date, start);
    return { start: first, end: addDays(first, 6), shift: (step: number) => addDays(first, step * 7) };
  }
  const months = type === 'yearly' ? 12 : type === 'quarterly' ? 3 : 1;
  const first = monthShift(monthStart(date), -((Number(date.slice(5, 7)) - 1) % months));
  return { start: first, end: monthEnd(monthShift(first, months - 1)), shift: (step: number) => monthShift(first, step * months) };
}

export function deepWork(data: Snapshot, start: string, end: string) {
  return data.sessions.filter(session => isWork(session)).map(session => ({
    ...session, date: clock(data.settings.zone, new Date(session.endedAt)).date,
    area: session.domainId ?? data.goals.find(goal => goal.id === session.goalId)?.domainId
      ?? data.habits.find(habit => habit.id === session.habitId)?.domainId,
  })).filter(session => start <= session.date && session.date <= end);
}

export function growthSummary(data: Snapshot, stats: Stats, start: string, end: string) {
  const work = deepWork(data, start, end);
  const areas = data.domains.map(domain => {
    const habits = data.habits.filter(habit => habit.domainId === domain.id);
    return { domain, habits, goals: data.goals.filter(goal => goal.domainId === domain.id),
      minutes: work.filter(session => session.area === domain.id).reduce((sum, row) => sum + row.actualSeconds / 60, 0),
      history: stats.range(start, end, habits), summary: summarize(stats.range(start, end, habits)) };
  });
  const hours = Array.from({ length: 24 }, () => 0);
  for (const item of data.entries) {
    if (!item.completed || item.date < start || item.date > end) continue;
    const recorded = clock(data.settings.zone, new Date(item.updatedAt));
    if (recorded.date === item.date) hours[Number(recorded.time.slice(0, 2))]++;
  }
  return { areas, hours, minutes: work.reduce((sum, row) => sum + row.actualSeconds / 60, 0) };
}

export function association(stats: Stats, first: Habit, second: Habit, start: string, end: string) {
  let both = 0, one = 0, other = 0, neither = 0;
  for (const { date } of stats.range(start, end, [])) {
    if (!stats.counted(first, date) || !stats.counted(second, date)) continue;
    const a = stats.findEntry(first.id, date)?.completed;
    const b = stats.findEntry(second.id, date)?.completed;
    if (a && b) both++;
    else if (a) one++;
    else if (b) other++;
    else neither++;
  }
  const n = both + one + other + neither;
  const denominator = Math.sqrt((both + one) * (both + other) * (one + neither) * (other + neither));
  return { n, value: n >= 7 && denominator ? (both * neither - one * other) / denominator : null };
}

export type TimelineItem = { id: string; title: string; date: string; kind: 'event' | 'habit' | 'goal' | 'focus'; domainId?: string; note?: string };
export function timeline(data: Snapshot, today: string): TimelineItem[] {
  const events: TimelineItem[] = data.events.map(event => ({ ...event, kind: 'event' }));
  const habits = new Map(data.habits.map(habit => [habit.id, habit]));
  const checks = new Map<string, string[]>();
  for (const entry of data.entries) {
    if (!entry.completed || entry.date > today) continue;
    const dates = checks.get(entry.habitId) ?? [];
    dates.push(entry.date);
    checks.set(entry.habitId, dates);
  }
  const stats = makeStats(data, today);
  for (const [habitId, dates] of checks) {
    const habit = habits.get(habitId);
    if (!habit) continue;
    dates.sort();
    dates.forEach((date, index) => {
      const count = index + 1;
      if ([1, 7, 14, 20, 30, 50, 100].includes(count) || count % 100 === 0) {
        events.push({ id: habitId + ':' + count, title: habit.name + ' · 第 ' + count + ' 次达标', date, kind: 'habit', domainId: habit.domainId });
      }
    });
    let streak = 0;
    for (const row of stats.range(dates[0], today, [habit])) {
      if (!row.planned) continue;
      streak = row.done ? streak + 1 : 0;
      if ([7, 14, 30, 60, 100].includes(streak)) {
        events.push({ id: habitId + ':' + row.date + ':streak', title: habit.name + ' · 连续完成 ' + streak + ' 个计划日',
          date: row.date, kind: 'habit', domainId: habit.domainId });
      }
    }
  }
  for (const goal of data.goals) {
    events.push({ id: goal.id, title: '设立目标「' + goal.title + '」', date: clock(data.settings.zone, new Date(goal.createdAt)).date, kind: 'goal', domainId: goal.domainId });
    for (const milestone of goal.milestones ?? []) if (milestone.doneOn) {
      events.push({ id: goal.id + ':' + milestone.id, title: milestone.title, note: goal.title, date: milestone.doneOn, kind: 'goal', domainId: goal.domainId });
    }
  }
  for (const item of deepWork(data, '1900-01-01', today)) {
    events.push({ id: item.id, title: item.task || '完成专注', note: Math.round(item.actualSeconds / 60 * 10) / 10 + ' 分钟', date: item.date, kind: 'focus', domainId: item.area });
  }
  return events.filter(event => event.date <= today).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export function reviewSummary(stats: Stats, range: ReturnType<typeof period>) {
  const totals = summarize(stats.range(range.start, minDay(range.end, stats.today)));
  return totals.planned
    ? '已完成 ' + totals.done + ' / ' + totals.planned + ' 次计划，完成率 ' + pct(totals.rate) + '。'
    : '这个周期尚无到期计划。';
}

export function orderGoals(goals: Goal[]) {
  const branches = new Map<string | undefined, Goal[]>();
  for (const goal of goals) {
    const group = branches.get(goal.parentId) ?? [];
    group.push(goal);
    branches.set(goal.parentId, group);
  }
  const ordered: { goal: Goal; depth: number }[] = [];
  function visit(parent: string | undefined, depth: number) {
    for (const goal of branches.get(parent) ?? []) {
      ordered.push({ goal, depth });
      visit(goal.id, depth + 1);
    }
  }
  visit(undefined, 0);
  return ordered;
}
