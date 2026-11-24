import type { Snapshot, Timer } from './model';

export function millisecondsLeft(timer: Timer, now: number) {
  return Math.max(0, timer.deadline === null ? timer.remainingMs : Math.min(timer.remainingMs, timer.deadline - now));
}

export function elapsedStopwatch(timer: Timer, now: number) {
  return Math.min(86_400_000, (timer.elapsedMs ?? 0) + (timer.runningSince === undefined ? 0 : Math.max(0, now - timer.runningSince)));
}

export const timerRunning = (timer: Timer | null) => !!timer && (timer.deadline !== null || timer.runningSince !== undefined);

export function saveWorkSession(data: Snapshot, timer: Timer, end: number, seconds: number) {
  if (data.sessions.some(item => item.id === timer.id)) return;
  if (data.sessions.length >= 100_000) throw new Error('专注记录已达到容量上限。');
  data.sessions.push({
    id: timer.id, habitId: timer.habitId, goalId: timer.goalId, domainId: timer.domainId, task: timer.task, mode: timer.mode,
    startedAt: new Date(timer.startedAt).toISOString(), endedAt: new Date(Math.max(timer.startedAt, end)).toISOString(),
    plannedSeconds: timer.mode === 'stopwatch' ? seconds : timer.plannedSeconds, actualSeconds: seconds, completed: true,
  });
}

export function finishTimer(data: Snapshot, now: number) {
  const timer = data.timer;
  if (!timer || timer.deadline === null || millisecondsLeft(timer, now) > 0) return false;
  if (timer.mode === 'focus') saveWorkSession(data, timer, timer.deadline, timer.plannedSeconds);
  data.timer = null;
  return true;
}
