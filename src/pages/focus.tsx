import {memoria,useQuery} from '../app/memoria';
import {useNavigate} from 'react-router';
import { isWork } from '../core/growth';
import { useSearchParams } from 'react-router';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Clock3, Coffee, Pause, Play, RotateCcw, Timer as TimerIcon } from 'lucide-react';
import { useJournal, useNow, timerLabel } from '../app/journal';
import { clock } from '../core/dates';
import { millisecondsLeft, timerRunning } from '../core/focus';
import { modeMinutes, modes, type FocusMode } from '../core/model';
import { repository } from '../core/repository';
import { Empty, Field, PageHeading, PanelHeading, Ring } from '../ui/primitives';

export function Focus() {
  const { data, stats, today, commit, notify, reduced } = useJournal();
  const [mode, setMode] = useState<FocusMode>('focus');
  const [minutes, setMinutes] = useState<number>(modeMinutes.focus);
  const [query] = useSearchParams();
  const [habit, setHabit] = useState(query.get('habit') ?? '');
  const navigate=useNavigate();
  const {value:memory}=useQuery(()=>memoria.overview());
  const [deckId,setDeckId]=useState(''),[nodeId,setNodeId]=useState('');
  const [task, setTask] = useState('');
  const [goal, setGoal] = useState(query.get('goal') ?? '');
  const [immersive, setImmersive] = useState(false);
  const [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const workMode = mode === 'focus' || mode === 'stopwatch';
  useEffect(() => () => { if (audio.current) void audio.current.close(); }, []);
  useEffect(() => {
    if (!immersive) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setImmersive(false); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [immersive]);
  async function toggleSound() {
    if (audio.current) {
      await audio.current.close(); audio.current = null; setSound(false); return;
    }
    try {
      const context = new AudioContext();
      audio.current = context;
      const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 1; i < samples.length; i++) samples[i] = .97 * samples[i - 1] + (Math.random() - .5) * .04;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(context.destination);
      source.start();
      await context.resume();
      setSound(true);
    } catch {
      if (audio.current) void audio.current.close().catch(() => undefined);
      audio.current = null;
      notify('当前设备无法播放环境音。', 'error');
    }
  }
  const [busy, setBusy] = useState(false);
  const timer = data.timer;
  const currentMode = timer?.mode ?? mode;
  const currentMinutes = timer ? timer.plannedSeconds / 60 : minutes;
  const running = timerRunning(timer);
  const now = useNow(running);
  const progress = timer && timer.mode !== 'stopwatch' ? 100 * (1 - millisecondsLeft(timer, now) / (timer.plannedSeconds * 1000)) : 0;
  const number = timer ? timerLabel(timer, now) : String(minutes).padStart(2, '0') + ':00';
  const sessions = useMemo(() => data.sessions.filter(isWork).sort((a, b) => b.endedAt.localeCompare(a.endedAt)), [data.sessions]);
  const todaySessions = useMemo(() => sessions.filter(session => clock(data.settings.zone, new Date(session.endedAt)).date === today), [data.settings.zone, sessions, today]);
  const todayMinutes = todaySessions.reduce((total, session) => total + session.actualSeconds, 0) / 60;
  const format = new Intl.DateTimeFormat('zh-CN', {
    timeZone: data.settings.zone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });

  async function start(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await commit(() => repository.startTimer(mode, minutes, workMode && habit ? habit : undefined, workMode ? { task, goalId: goal || undefined,deckId:deckId||undefined,nodeId:nodeId||undefined } : undefined));
    setBusy(false);
  }

  async function update(action: 'pause' | 'resume' | 'reset' | 'stop') {
    if (!timer) return;
    setBusy(true);
    const ok = await commit(async () => {
      const finished = await repository.updateTimer(action, timer.id);
      if (finished) notify(finished === 'focus' || finished === 'stopwatch' ? '专注完成，已记录本次会话。' : '休息时间结束。');
    });
    if (ok && action === 'reset') {
      setMode(timer.mode);
      setMinutes(timer.plannedSeconds / 60);
      setHabit(timer.habitId ?? '');
    }
    setBusy(false);
  }

  return <>
    <PageHeading title="专注" description="设定一段时间，只做一件事。" />
    <div className="focus-layout">
      <section className={'panel focus-stage' + (immersive ? ' focus-immersive' : '')} aria-label="专注计时器">
        <div className="inline-actions focus-tools">
          <button type="button" className="choice" aria-pressed={immersive} onClick={() => setImmersive(value => !value)}>{immersive ? '退出沉浸' : '沉浸模式'}</button>
          <button type="button" className="choice" aria-pressed={sound} onClick={() => { void toggleSound(); }}>{sound ? '关闭环境音' : '播放环境音'}</button>
        </div>
        <div className="segmented focus-modes" aria-label="计时模式">
          {(Object.keys(modes) as FocusMode[]).map(key => <button type="button" key={key} aria-pressed={currentMode === key} disabled={!!timer}
            onClick={() => { setMode(key); setMinutes(modeMinutes[key]); }}>{modes[key]}</button>)}
        </div>
        <div className="focus-orbit">
          <Ring progress={progress} reduced={reduced} className="focus-ring">
            <span className="ring-kicker">{modes[currentMode]}</span>
            <output className="timer-number" aria-label={currentMode === 'stopwatch' ? '已专注时间' : '剩余时间'} aria-live="off">{number}</output>
            <span className="ring-caption">{timer ? running ? '计时中' : '已暂停' : '准备就绪'}</span>
          </Ring>
        </div>
        {timer ? <>
          <div className="timer-controls">
            <button type="button" className="button primary" disabled={busy} onClick={() => { void update(running ? 'pause' : 'resume'); }}>
              {running ? <Pause size={17} aria-hidden /> : <Play size={17} aria-hidden />}{running ? '暂停' : '继续'}
            </button>
            {timer.mode === 'stopwatch' && <button type="button" className="button secondary" disabled={busy} onClick={() => { void update('stop'); }}>结束并保存</button>}
            <button type="button" className="button secondary" disabled={busy} onClick={() => { void update('reset'); }}>
              <RotateCcw size={16} aria-hidden />重置
            </button>
          </div>
          {(timer.deckId||timer.nodeId)&&<button className="button secondary" onClick={()=>void commit(async()=>{const s=await memoria.startSession('focus',timer.deckId,timer.nodeId,false,timer.id);navigate('/memoria/recall?session='+s.id);})}>在本次专注中复习</button>}
          <p className="field-note">{timer.mode !== 'stopwatch' && currentMinutes + ' 分钟'}{timer.task && ' · ' + timer.task}{timer.habitId && ' · ' + (stats.habits.find(item => item.id === timer.habitId)?.name ?? '')}</p>
        </> : <form onSubmit={start} className="timer-setup">
          <div className="form-grid">
            {workMode&&<><Field label="学习卡组"><select value={deckId} onChange={e=>setDeckId(e.target.value)}><option value="">不关联</option>{memory?.decks.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field><Field label="知识节点"><select value={nodeId} onChange={e=>setNodeId(e.target.value)}><option value="">不关联</option>{memory?.nodes.filter(n=>!n.trashed).map(n=><option key={n.id} value={n.id}>{n.title}</option>)}</select></Field></>}
            {mode !== 'stopwatch' && <Field label="时长（分钟）"><input type="number" min="1" max="180" required value={minutes || ''}
              onChange={event => setMinutes(Number(event.target.value))} /></Field>}
            {workMode && <Field label="关联习惯（可选）"><select value={habit} onChange={event => setHabit(event.target.value)}>
              <option value="">选择习惯</option>
              {stats.habits.filter(item => !item.archivedAt).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select></Field>}
            {workMode && <Field label="本次任务"><input value={task} maxLength={120} onChange={event => setTask(event.target.value)} /></Field>}
            {workMode && <Field label="关联目标"><select value={goal} onChange={event => setGoal(event.target.value)}>
              <option value="">选择目标</option>{data.goals.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
            </select></Field>}
          </div>
          <button type="submit" className="button primary" disabled={busy}><Play size={17} aria-hidden />{workMode ? '开始专注' : '开始休息'}</button>
        </form>}
      </section>
      <aside className="focus-side">
        <section className="panel">
          <PanelHeading title="今日专注" />
          <dl className="focus-stats">
            <div><dt><TimerIcon size={16} aria-hidden />专注时间</dt><dd>{todayMinutes} <small>分钟</small></dd></div>
            <div><dt><Coffee size={16} aria-hidden />完成会话</dt><dd>{todaySessions.length} <small>次</small></dd></div>
          </dl>
        </section>
        <section className="panel">
          <PanelHeading title="专注历史" detail={sessions.length > 12 ? '最近 12 次会话' : undefined} />
          {sessions.length ? <ul className="session-list">{sessions.slice(0, 12).map(session => <li key={session.id}>
            <Clock3 size={17} aria-hidden />
            <div><strong>{session.task || data.goals.find(item => item.id === session.goalId)?.title || stats.habits.find(item => item.id === session.habitId)?.name || '专注会话'}</strong>
              <small>{format.format(new Date(session.startedAt))}–{format.format(new Date(session.endedAt))}</small></div>
            <span>{session.actualSeconds / 60} 分钟</span>
          </li>)}</ul> : <Empty icon={Clock3} title="暂无专注记录">完成第一轮后，会话会出现在这里。</Empty>}
        </section>
      </aside>
    </div>
  </>;
}
