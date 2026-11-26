import {useQuery,memoria} from './memoria';
import {learningGoalValues} from '../core/memoria/analytics';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MotionConfig, useReducedMotion } from 'motion/react';
import { ArrowDownToLine, CircleAlert } from 'lucide-react';
import { clock } from '../core/dates';
import { elapsedStopwatch, millisecondsLeft } from '../core/focus';
import { entryKey, type Habit, type Snapshot } from '../core/model';
import { repository } from '../core/repository';
import { makeStats, type Stats } from '../core/stats';
import { Toasts, type ToastData } from '../ui/primitives';

const messageOf = (error: unknown) => error instanceof Error && error.name==='QuotaExceededError' ? '设备存储已满，请先导出备份并释放空间后重试。' : error instanceof Error
  ? (('issues' in error && Array.isArray(error.issues) && typeof error.issues[0]?.message === 'string') ? error.issues[0].message : error.message)
  : '请重试。';

type Journal = {
  data: Snapshot;
  stats: Stats;
  today: string;
  time: string;
  reduced: boolean;
  notify: (text: string, kind?: ToastData['kind'], action?: ToastData['action']) => void;
  commit: (action: () => Promise<unknown>, success?: string, failed?: (message: string) => void) => Promise<boolean>;
  toggle: (habit: Habit, date: string, completed: boolean, undo?: boolean) => Promise<void>;
  saving: ReadonlySet<string>;
};

const JournalContext = createContext<Journal | null>(null);

export function useJournal() {
  const context = useContext(JournalContext);
  if (!context) throw new Error('JournalProvider is required.');
  return context;
}

export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function notificationPermission() {
  return window.isSecureContext && 'Notification' in window ? Notification.permission : 'unsupported' as const;
}

async function showNotification(body: string, tag: string) {
  if (notificationPermission() !== 'granted') return;
  try {
    const worker = await navigator.serviceWorker?.getRegistration();
    if (worker?.active) {
      await worker.showNotification('NOCTURNE 习惯提醒', { body, tag });
      return;
    }
    new Notification('NOCTURNE 习惯提醒', { body, tag });
  } catch {
    // The in-app reminder is already visible if the OS cannot show a notification.
  }
}

function BackgroundTasks() {
  const { data, today, time, notify } = useJournal();
  const timerId = data.timer?.id;
  const deadline = data.timer?.deadline;

  useEffect(() => {
    if (!timerId || deadline == null) return;
    let running = false;
    let timeout: number;
    const check = async () => {
      if (running || Date.now() < deadline) return;
      running = true;
      try {
        const mode = await repository.updateTimer('tick', timerId);
        if (mode) notify(mode === 'focus' ? '专注完成，已记录本次会话。' : '休息时间结束。');
      } catch {
        notify('计时结果暂未保存。重新打开专注页可重试。', 'error');
      } finally {
        running = false;
      }
    };
    const schedule = () => {
      window.clearTimeout(timeout);
      const remaining = deadline - Date.now();
      if (remaining <= 0) void check();
      else timeout = window.setTimeout(schedule, Math.min(remaining, 60_000));
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('focus', schedule);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('focus', schedule);
    };
  }, [deadline, notify, timerId]);

  useEffect(() => {
    if (!data.settings.reminders || !data.habits.some(habit => habit.reminderEnabled && !habit.archivedAt)) return;
    let checking = false;
    const check = () => {
      if (checking || document.visibilityState !== 'visible') return;
      checking = true;
      void repository.claimReminders().then(names => {
        if (!names.length) return;
        const listed = names.slice(0, 3).join('、');
        const body = listed + (names.length > 3 ? '等 ' + names.length + ' 项习惯' : '') + '还没打卡。';
        notify(body, 'reminder');
        void showNotification(body, 'nocturne-' + today);
      }).catch(() => notify('暂时无法读取习惯提醒。', 'error')).finally(() => { checking = false; });
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [data.habits, data.settings.reminders, notify, time, today]);

  return null;
}

export function timerLabel(timer: Snapshot['timer'], now: number) {
  const total = timer?.mode === 'stopwatch' ? Math.floor(elapsedStopwatch(timer, now) / 1000) : timer ? Math.ceil(millisecondsLeft(timer, now) / 1000) : 0;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

export function useNow(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    if (!ticking) return;
    const timeout = window.setInterval(update, 250);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timeout);
      document.removeEventListener('visibilitychange', update);
    };
  }, [ticking]);
  return ticking ? now : Date.now();
}

export function JournalProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Snapshot>();
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const serial = useRef(0);
  const systemReduced = useReducedMotion();
  const reduced = Boolean(systemReduced || data?.settings.reducedMotion);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    void repository.connect().then(() => {
      if (!mounted) return;
      const subscription = repository.observe().subscribe({
        next: snapshot => { setData(snapshot); setLoadError(false); },
        error: () => setLoadError(true),
      });
      unsubscribe = () => subscription.unsubscribe();
    }).catch(() => { if (mounted) setLoadError(true); });
    return () => { mounted = false; unsubscribe?.(); };
  }, [attempt]);

  useEffect(() => {
    const update = () => setNow(new Date());
    const interval = window.setInterval(update, 10_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  const notify = useCallback<Journal['notify']>((text, kind = 'success', action) => {
    serial.current++;
    const toast = { id: serial.current, text, kind, action };
    setToasts(previous => [...previous.slice(-3), toast]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(previous => previous.filter(toast => toast.id !== id));
  }, []);

  const commit = useCallback<Journal['commit']>(async (action, success, failed) => {
    try {
      await action();
      if (success) notify(success);
      return true;
    } catch (error) {
      if (failed) failed(messageOf(error));
      else notify('未保存。' + messageOf(error), 'error');
      return false;
    }
  }, [notify]);

  const toggle = useCallback<Journal['toggle']>(async function update(habit, date, completed, undo = true) {
    const key = entryKey({ habitId: habit.id, date });
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setSaving(new Set(inFlight.current));
    try {
      await repository.setEntry(habit.id, date, !completed, completed);
      notify(completed ? '已撤销「' + habit.name + '」的打卡。' : '已完成「' + habit.name + '」。', 'success',
        undo ? { label: '撤销', run: () => { void update(habit, date, !completed, false); } } : undefined);
    } catch (error) {
      notify('打卡更新失败。' + messageOf(error), 'error');
    } finally {
      inFlight.current.delete(key);
      setSaving(new Set(inFlight.current));
    }
  }, [notify]);

  useEffect(()=>{if(data)void memoria.refreshBridge().catch(()=>{});},[data]);
  const { date: today, time } = data ? clock(data.settings.zone, now) : { date: '', time: '' };
  const {value:learning}=useQuery(()=>data?learningGoalValues(memoria.db,data):Promise.resolve({}),[data]);
  const stats = useMemo(() => data ? makeStats(data, today,learning) : null, [data, today,learning]);

  if (loadError) return (
    <main className="startup">
      <CircleAlert size={32} aria-hidden />
      <h1>本地日志无法打开</h1>
      <p>请确认浏览器允许此站点保存数据，再重试。</p>
      <button type="button" className="button primary" onClick={() => {
        setLoadError(false); setData(undefined); repository.resetConnection(); setAttempt(value => value + 1);
      }}>重试</button>
    </main>
  );

  if (!data || !stats) return (
    <main className="startup" aria-busy="true">
      <ArrowDownToLine size={28} aria-hidden />
      <p role="status">正在打开本地日志</p>
    </main>
  );

  return (
    <JournalContext.Provider value={{ data, today, time, stats, reduced, notify, commit, toggle, saving }}>
      <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
        <div className="application" data-reduced={reduced} data-theme={data.settings.theme ?? 'antique'}>
          {children}
          <BackgroundTasks />
          <Toasts data={toasts} dismiss={dismiss} reduced={reduced} />
        </div>
      </MotionConfig>
    </JournalContext.Provider>
  );
}
