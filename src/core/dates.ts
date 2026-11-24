const dayMs = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();
const labels = new Map<string, Intl.DateTimeFormat>();

export type WeekStart = 'monday' | 'sunday';

export const systemZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function validZone(value: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function clock(zone: string, now = new Date()) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    formatters.set(zone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  return { date: [parts.year, parts.month, parts.day].join('-'), time: [parts.hour, parts.minute].join(':') };
}

export const asDate = (day: string) => new Date(day + 'T00:00:00Z');
export const keyOf = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (day: string, count: number) => keyOf(new Date(+asDate(day) + count * dayMs));
export const weekday = (day: string) => asDate(day).getUTCDay();
export const weekStart = (day: string, start: WeekStart = 'monday') => addDays(day, -((weekday(day) + (start === 'monday' ? 6 : 0)) % 7));
export const monthStart = (day: string) => day.slice(0, 7) + '-01';

export function monthShift(day: string, count: number) {
  const date = asDate(monthStart(day));
  date.setUTCMonth(date.getUTCMonth() + count);
  return keyOf(date);
}

export const monthEnd = (day: string) => addDays(monthShift(day, 1), -1);

export function dayKeys(start: string, end: string) {
  const length = Math.max(0, Math.round((+asDate(end) - +asDate(start)) / dayMs) + 1);
  return Array.from({ length }, (_, index) => addDays(start, index));
}

export function dateLabel(day: string, options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' }) {
  const key = JSON.stringify(options);
  let formatter = labels.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('zh-CN', { ...options, timeZone: 'UTC' });
    labels.set(key, formatter);
  }
  return formatter.format(asDate(day));
}

export function validDay(day: string) {
  if (!/^(19\d\d|20\d\d|21\d\d)-\d{2}-\d{2}$/.test(day)) return false;
  const date = asDate(day);
  return Number.isFinite(+date) && keyOf(date) === day;
}

export const minDay = (a: string, b: string) => a < b ? a : b;
export const maxDay = (a: string, b: string) => a > b ? a : b;
