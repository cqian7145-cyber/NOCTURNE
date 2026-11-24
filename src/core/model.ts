import { z } from 'zod';
import { systemZone, validDay, validZone } from './dates';

export const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
export const categories = ['学习', '健康', '创作', '生活'] as const;
export const colors = ['lilac', 'sage', 'amber', 'blue', 'rose'] as const;
export const icons = ['book', 'code', 'dumbbell', 'moon', 'leaf', 'pen', 'globe', 'spark'] as const;
export const schedules = { daily: '每天', weekdays: '工作日', weekends: '周末', custom: '自定义' } as const;
export const goalTypes = { count: '累计打卡', completionRate: '周期完成率', streak: '连续计划日' } as const;
export const modes = { focus: '专注', short: '短休息', long: '长休息', stopwatch: '正计时' } as const;
export const modeMinutes = { focus: 25, short: 5, long: 15, stopwatch: 0 } as const;

const id = z.string().regex(/^[a-zA-Z0-9-]{1,96}$/);
const day = z.string().refine(validDay, '无效的日历日期');
const instant = z.iso.datetime();
const label = z.string().trim().min(1).max(90);
const stamp = { id, updatedAt: instant };
const domain = z.object({ ...stamp, title: label, description: z.string().max(300), color: z.enum(colors) });
const routine = z.object({ ...stamp, title: label });
const event = z.object({ ...stamp, title: label, date: day, domainId: id.optional(), note: z.string().max(500) });
const pause = z.object({ start: day, end: day }).refine(range => range.start <= range.end, '暂停结束日期必须晚于或等于起始日期');
export const milestoneSchema = z.object({ id, title: label, doneOn: day.optional() });
export type Domain = z.infer<typeof domain>;
export type Routine = z.infer<typeof routine>;
export type ChronicleEvent = z.infer<typeof event>;
export type Milestone = z.infer<typeof milestoneSchema>;
export const parseDomain = (value: Domain) => domain.parse(value);
export const parseRoutine = (value: Routine) => routine.parse(value);
export const parseEvent = (value: ChronicleEvent) => event.parse(value);
const type = z.enum(['daily', 'weekdays', 'weekends', 'custom']);
const schedule = z.object({ type, weekdays: z.array(z.number().int().min(0).max(6)).max(7), quota: z.number().int().min(1).max(7).optional() })
  .refine(s => s.type !== 'custom' || (s.weekdays.length > 0 && new Set(s.weekdays).size === s.weekdays.length), '请选择有效的星期')
  .refine(s => !s.quota || s.quota <= ({ daily: 7, weekdays: 5, weekends: 2, custom: s.weekdays.length }[s.type]), '每周次数超过可执行日期');
const interval = z.object({ effective: day, schedule: schedule.nullable() });
const habitFields = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300),
  icon: z.enum(icons),
  color: z.enum(colors),
  category: z.enum(categories),
  startDate: day,
  schedule,
  reminderTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  reminderEnabled: z.boolean(),
  domainId: id.optional(), routineId: id.optional(),
  measurement: z.object({ unit: z.string().trim().min(1).max(16), minimum: z.number().positive().max(1_000_000) }).optional(),
  pauses: z.array(pause).max(500).optional(),
});
const habit = habitFields.extend({
  id, revisions: z.array(interval).min(1).max(3000), sortOrder: z.number().int().nonnegative(),
  archivedAt: instant.optional(), createdAt: instant, updatedAt: instant,
}).refine(h => h.revisions.every((r, i, all) => i === 0 || all[i - 1].effective < r.effective), '计划版本必须按日期递增');
const entry = z.object({ habitId: id, date: day, completed: z.boolean(), quantity: z.number().positive().max(1_000_000).optional(), skipReason: z.string().trim().min(1).max(160).optional(), createdAt: instant, updatedAt: instant });
const focusMode = z.enum(['focus', 'short', 'long', 'stopwatch']);
const goalType = z.enum(['count', 'completionRate', 'streak']);
const seconds = z.number().int().min(1).max(86_400);
const epoch = z.number().int().min(0).max(8_640_000_000_000_000);
const sessionLinks = { goalId: id.optional(), domainId: id.optional(), task: z.string().trim().max(120).optional() };
const timer = z.object({
  ...sessionLinks, elapsedMs: z.number().int().min(0).max(86_400_000).optional(), runningSince: epoch.optional(),
  id, mode: focusMode, habitId: id.optional(), startedAt: epoch,
  plannedSeconds: seconds, remainingMs: z.number().int().min(0).max(10_800_000),
  deadline: epoch.nullable(),
}).refine(t => t.remainingMs <= t.plannedSeconds * 1000, '计时参数无效');
const session = z.object({
  ...sessionLinks,
  id, mode: focusMode, habitId: id.optional(), startedAt: instant, endedAt: instant,
  plannedSeconds: seconds, actualSeconds: seconds, completed: z.boolean(),
}).refine(s => s.endedAt >= s.startedAt && s.actualSeconds <= s.plannedSeconds, '会话时长无效');
const goalFields = z.object({
  title: z.string().trim().min(1).max(90), description: z.string().trim().max(400),
  habitIds: z.array(id).min(1).max(250).refine(ids => new Set(ids).size === ids.length),
  domainId: id.optional(), parentId: id.optional(), dependencies: z.array(id).max(100).optional(),
  milestones: z.array(milestoneSchema).max(100).optional(),
  goalType, targetValue: z.number().int().min(1).max(100_000), startDate: day, endDate: day.optional(),
}).refine(g => (!g.endDate || g.endDate >= g.startDate) &&
  (g.goalType !== 'completionRate' || (g.targetValue <= 100 && !!g.endDate)), '请检查目标值和截止日期');
const goal = goalFields.safeExtend({ id, createdAt: instant, updatedAt: instant });
const review = z.object({
  type: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']), periodKey: day,
  reflection: z.tuple([z.string().max(4000), z.string().max(4000), z.string().max(4000)]), updatedAt: instant,
});
const settings = z.object({
  theme: z.enum(['antique', 'blue', 'ink']).optional(), compactNav: z.boolean().optional(),
  zone: z.string().max(100).refine(validZone), reminders: z.boolean(),
  reducedMotion: z.boolean(), weekStartsOn: z.enum(['monday', 'sunday']),
});

const currentSnapshot = z.object({
  version: z.literal(2),
  domains: z.array(domain).max(100), routines: z.array(routine).max(100), events: z.array(event).max(10_000),
  habits: z.array(habit).max(250), entries: z.array(entry).max(500_000),
  goals: z.array(goal).max(2000), sessions: z.array(session).max(100_000),
  reviews: z.array(review).max(6000), settings, timer: timer.nullable(),
  reminded: z.object({ date: day, items: z.array(id).max(250) }).nullable(),
}).superRefine((data, context) => {
  const habits = new Set(data.habits.map(h => h.id));
  const unique = <T>(rows: T[], key: (row: T) => string) => new Set(rows.map(key)).size === rows.length;
  const duplicates = habits.size !== data.habits.length || !unique(data.entries, entryKey) ||
    !unique(data.goals, g => g.id) || !unique(data.sessions, s => s.id) || !unique(data.reviews, reviewKey);
  const missing = data.entries.some(e => !habits.has(e.habitId)) ||
    data.goals.some(g => g.habitIds.some(h => !habits.has(h))) ||
    data.sessions.some(s => s.habitId && !habits.has(s.habitId)) ||
    (data.timer?.habitId && !habits.has(data.timer.habitId));
  const domainIds = new Set(data.domains.map(item => item.id));
  const routineIds = new Set(data.routines.map(item => item.id));
  const goalIssue = goalGraphIssue(data.goals);
  const links = [...data.habits, ...data.goals, ...data.events, ...data.sessions, ...(data.timer ? [data.timer] : [])];
  if (!unique(data.domains, item => item.id) || !unique(data.routines, item => item.id) || !unique(data.events, item => item.id)) {
    context.addIssue({ code: 'custom', message: '成长档案包含重复标识' });
  }
  if (links.some(item => item.domainId && !domainIds.has(item.domainId)) || data.habits.some(item => item.routineId && !routineIds.has(item.routineId))) {
    context.addIssue({ code: 'custom', message: '成长档案包含无效关联' });
  }
  const goalIds = new Set(data.goals.map(goal => goal.id));
  if ([...data.sessions, ...(data.timer ? [data.timer] : [])].some(item => item.goalId && !goalIds.has(item.goalId))) {
    context.addIssue({ code: 'custom', message: '专注记录包含无效目标' });
  }
  if (goalIssue) context.addIssue({ code: 'custom', message: goalIssue });
  if (duplicates || missing) context.addIssue({ code: 'custom', message: duplicates ? '备份包含重复记录' : '备份包含缺失的习惯关联' });
});

export const snapshotSchema = z.preprocess(raw => {
  if (typeof raw === 'object' && raw !== null && 'version' in raw && raw.version === 1) {
    return { ...raw, version: 2, domains: [], routines: [], events: [] };
  }
  return raw;
}, currentSnapshot);

export type Snapshot = z.infer<typeof snapshotSchema>;
export function goalGraphIssue(goals: Goal[]): string | undefined {
  const nodes = new Map(goals.map(goal => [goal.id, goal]));
  const state = new Map<string, 'visiting' | 'visited'>();
  function visit(id: string): string | undefined {
    const goal = nodes.get(id);
    if (!goal) return '目标关联已不存在。';
    if (state.get(id) === 'visiting') return '目标的上下级或依赖关系不能形成循环。';
    if (state.get(id) === 'visited') return;
    if (new Set(goal.milestones?.map(item => item.id)).size !== (goal.milestones?.length ?? 0)) return '里程碑标识重复。';
    state.set(id, 'visiting');
    for (const link of [...(goal.dependencies ?? []), ...(goal.parentId ? [goal.parentId] : [])]) {
      const issue = visit(link);
      if (issue) return issue;
    }
    state.set(id, 'visited');
  }
  for (const goal of goals) {
    const issue = visit(goal.id);
    if (issue) return issue;
  }
}
export type Habit = z.infer<typeof habit>;
export type HabitFields = z.infer<typeof habitFields>;
export type Schedule = z.infer<typeof schedule>;
export type Entry = z.infer<typeof entry>;
export type Goal = z.infer<typeof goal>;
export type GoalFields = z.infer<typeof goalFields>;
export type Timer = z.infer<typeof timer>;
export type FocusMode = z.infer<typeof focusMode>;
export type Review = z.infer<typeof review>;
export type Settings = z.infer<typeof settings>;

export const entryKey = (e: Pick<Entry, 'habitId' | 'date'>) => e.habitId + ':' + e.date;
export const reviewKey = (r: Pick<Review, 'type' | 'periodKey'>) => r.type + ':' + r.periodKey;

export function emptySnapshot(): Snapshot {
  return {
    version: 2, domains: [], routines: [], events: [], habits: [], entries: [], goals: [], sessions: [], reviews: [], timer: null, reminded: null,
    settings: { zone: systemZone(), reminders: true, reducedMotion: false, weekStartsOn: 'monday' },
  };
}

export const parseHabit = (value: HabitFields) => habitFields.parse(value);
export const parseGoal = (value: GoalFields) => goalFields.parse(value);
export const parseReview = (value: Review) => review.parse(value);
export const parseSettings = (value: Settings) => settings.parse(value);

export function parseBackup(text: string) {
  if (text.length > 80_000_000) throw new Error('备份文件过大。');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('请选择有效的 JSON 备份。'); }
  const result = snapshotSchema.safeParse(parsed);
  if (!result.success) throw new Error('备份无法导入：' + result.error.issues[0].message);
  return result.data;
}

export function mergeBackup(current: Snapshot, imported: Snapshot): Snapshot {
  function merge<T>(local: T[], incoming: T[], key: (value: T) => string, stamp: (value: T) => string) {
    const map = new Map(local.map(value => [key(value), value]));
    for (const value of incoming) {
      const previous = map.get(key(value));
      if (!previous || stamp(value) > stamp(previous)) map.set(key(value), value);
    }
    return [...map.values()];
  }
  const result: Snapshot = {
    ...current,
    domains: merge(current.domains, imported.domains, d => d.id, d => d.updatedAt),
    routines: merge(current.routines, imported.routines, r => r.id, r => r.updatedAt),
    events: merge(current.events, imported.events, e => e.id, e => e.updatedAt),
    habits: merge(current.habits, imported.habits, h => h.id, h => h.updatedAt),
    entries: merge(current.entries, imported.entries, entryKey, e => e.updatedAt),
    goals: merge(current.goals, imported.goals, g => g.id, g => g.updatedAt),
    sessions: merge(current.sessions, imported.sessions, s => s.id, s => s.endedAt),
    reviews: merge(current.reviews, imported.reviews, reviewKey, r => r.updatedAt),
  };
  return snapshotSchema.parse(result);
}
