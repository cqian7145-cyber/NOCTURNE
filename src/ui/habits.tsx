import { createContext, useContext, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, Code2, Dumbbell, Earth, Feather, Leaf, Moon, Pencil, Sparkles } from 'lucide-react';
import { useJournal } from '../app/journal';
import { addDays, dateLabel } from '../core/dates';
import { categories, colors, entryKey, icons, schedules, weekdays, type Habit, type HabitFields } from '../core/model';
import { repository } from '../core/repository';
import { weeklyCommitment } from '../core/stats';
import { DomainSelect } from './growth-fields';
import { Dialog, ease, Field, IconButton, timing } from './primitives';

const glyphs = { book: BookOpen, code: Code2, dumbbell: Dumbbell, moon: Moon, leaf: Leaf, pen: Feather, globe: Earth, spark: Sparkles };
const colorLabels = { lilac: '雾紫', sage: '鼠尾草绿', amber: '琥珀', blue: '雾蓝', rose: '浅玫瑰' };
const iconLabels = { book: '书本', code: '代码', dumbbell: '哑铃', moon: '月亮', leaf: '叶片', pen: '羽毛笔', globe: '地球', spark: '星光' };

type Preset = Pick<HabitFields, 'name' | 'category' | 'icon' | 'color'>;
const presets: Preset[] = [
  { name: '英语学习', category: '学习', icon: 'globe', color: 'blue' },
  { name: '编程', category: '学习', icon: 'code', color: 'lilac' },
  { name: '阅读', category: '学习', icon: 'book', color: 'lilac' },
  { name: '健身', category: '健康', icon: 'dumbbell', color: 'sage' },
  { name: '早睡', category: '健康', icon: 'moon', color: 'blue' },
  { name: '冥想', category: '生活', icon: 'leaf', color: 'sage' },
  { name: '写作', category: '创作', icon: 'pen', color: 'amber' },
];

export function HabitIcon({ habit, size = 18 }: { habit: Pick<Habit, 'icon' | 'color'>; size?: number }) {
  const Icon = glyphs[habit.icon];
  return <span className="habit-icon" data-color={habit.color}><Icon size={size} strokeWidth={1.65} aria-hidden /></span>;
}

export function frequencyLabel(habit: Habit) {
  if (habit.schedule.quota) return '每周 ' + habit.schedule.quota + ' 次（弹性）';
  return habit.schedule.type === 'custom'
    ? habit.schedule.weekdays.map(index => '周' + weekdays[index]).join('、')
    : schedules[habit.schedule.type];
}

function HabitDialog({ habit, close }: { habit?: Habit; close: () => void }) {
  const { data, today, reduced, commit } = useJournal();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<HabitFields>(() => habit ?? ({
    name: '', description: '', category: '学习', icon: 'spark', color: 'lilac', startDate: today,
    schedule: { type: 'daily', weekdays: [] }, reminderEnabled: false, reminderTime: '20:00',
  }));

  function set<K extends keyof HabitFields>(key: K, value: HabitFields[K]) {
    setFields(previous => ({ ...previous, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!fields.name.trim() || (fields.schedule.type === 'custom' && !fields.schedule.weekdays.length)) {
      setError(fields.name.trim() ? '请选择至少一个计划日。' : '请输入习惯名称。');
      return;
    }
    setError('');
    setBusy(true);
    const saved = await commit(() => repository.saveHabit(fields, habit?.id), habit ? '习惯已更新。' : '习惯已创建。', setError);
    if (saved) close();
    else setBusy(false);
  }

  return <Dialog title={habit ? '编辑习惯' : '创建习惯'} onClose={close} busy={busy} reduced={reduced}>
    <form onSubmit={save} className="dialog-body">
      {!habit && <fieldset className="pick-field">
        <legend>从常用习惯开始</legend>
        <div className="choice-list">
          {presets.map(preset => <button type="button" className="choice" key={preset.name}
            onClick={() => setFields(previous => ({ ...previous, ...preset }))}>{preset.name}</button>)}
        </div>
      </fieldset>}
      <div className="form-grid">
        <Field label="习惯名称" wide><input required maxLength={80} value={fields.name} placeholder="例如，每天读十页"
          onChange={event => set('name', event.target.value)} /></Field>
        <Field label="描述（可选）" wide><textarea rows={2} maxLength={300} value={fields.description}
          onChange={event => set('description', event.target.value)} /></Field>
        <Field label="分类"><select value={fields.category} onChange={event => set('category', event.target.value as HabitFields['category'])}>
          {categories.map(category => <option key={category}>{category}</option>)}
        </select></Field>
        <Field label="开始日期"><input type="date" required min="1900-01-01" max="2199-12-31" value={fields.startDate}
          onChange={event => set('startDate', event.target.value)} /></Field>
        <Field label="计划频率"><select value={fields.schedule.type} onChange={event => set('schedule', {
          type: event.target.value as HabitFields['schedule']['type'], weekdays: fields.schedule.weekdays,
        })}>
          {Object.entries(schedules).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        </select></Field>
        <Field label="图标"><select value={fields.icon} onChange={event => set('icon', event.target.value as HabitFields['icon'])}>
          {icons.map(icon => <option key={icon} value={icon}>{iconLabels[icon]}</option>)}
        </select></Field>
      </div>
      {fields.schedule.type === 'custom' && <fieldset className="pick-field">
        <legend>计划星期</legend>
        <div className="choice-list">
          {[1, 2, 3, 4, 5, 6, 0].map(day => {
            const selected = fields.schedule.weekdays.includes(day);
            return <button type="button" key={day} className="choice" aria-pressed={selected} onClick={() => set('schedule', {
              ...fields.schedule, weekdays: selected ? fields.schedule.weekdays.filter(index => index !== day) : [...fields.schedule.weekdays, day].sort(),
            })}>周{weekdays[day]}</button>;
          })}
        </div>
      </fieldset>}
      <div className="form-grid">
        <DomainSelect value={fields.domainId} change={value => set('domainId', value)} />
        <Field label="例行组合"><select value={fields.routineId ?? ''} onChange={event => set('routineId', event.target.value || undefined)}>
          <option value="">未加入组合</option>{data.routines.map(routine => <option key={routine.id} value={routine.id}>{routine.title}</option>)}
        </select></Field>
        <Field label="每周次数（可选）"><input type="number" min={1} max={7} value={fields.schedule.quota ?? ''}
          onChange={event => set('schedule', { ...fields.schedule, quota: Number(event.target.value) || undefined })} /></Field>
      </div>
      <label className="check-field"><input type="checkbox" checked={!!fields.measurement} onChange={event => set('measurement',
        event.target.checked ? { unit: '分钟', minimum: 10 } : undefined)} />按数量打卡</label>
      {fields.measurement && <div className="form-grid">
        <Field label="计量单位"><input required maxLength={16} value={fields.measurement.unit} onChange={event => set('measurement', { ...fields.measurement!, unit: event.target.value })} /></Field>
        <Field label="最低执行标准"><input required type="number" min=".01" max="1000000" step="any" value={fields.measurement.minimum || ''}
          onChange={event => set('measurement', { ...fields.measurement!, minimum: Number(event.target.value) })} /></Field>
      </div>}
      <fieldset className="pick-field"><legend>计划暂停</legend>
        {(fields.pauses ?? []).map((pause, index) => {
          const frozen = (habit?.pauses ?? []).some(item => item.start === pause.start && item.end === pause.end && item.start <= today);
          const dates = (next: typeof pause) => set('pauses', fields.pauses?.map((item, i) => i === index ? next : item));
          return <div className="form-grid pause-form" key={index}>
            <Field label="暂停开始"><input required type="date" min={addDays(today, 1)} value={pause.start} disabled={frozen} onChange={event => dates({ ...pause, start: event.target.value })} /></Field>
            <Field label="暂停结束"><input required type="date" min={pause.start} value={pause.end} disabled={frozen} onChange={event => dates({ ...pause, end: event.target.value })} /></Field>
            {!frozen && <button type="button" className="text-button" onClick={() => set('pauses', fields.pauses?.filter((_, i) => index !== i))}>移除暂停</button>}
          </div>;
        })}
        <button type="button" className="text-button" onClick={() => {
          const tomorrow = addDays(today, 1);
          set('pauses', [...(fields.pauses ?? []), { start: tomorrow, end: tomorrow }]);
        }}>添加暂停区间</button>
      </fieldset>
      <fieldset className="pick-field">
        <legend>习惯颜色</legend>
        <div className="choice-list">
          {colors.map(color => <button type="button" className="swatch" data-color={color} key={color} aria-label={colorLabels[color]}
            title={colorLabels[color]} aria-pressed={fields.color === color} onClick={() => set('color', color)} />)}
        </div>
      </fieldset>
      <div className="form-grid reminder-field">
        <label className="check-field"><input type="checkbox" checked={fields.reminderEnabled}
          onChange={event => set('reminderEnabled', event.target.checked)} />定时提醒</label>
        {fields.reminderEnabled && <Field label="提醒时间"><input type="time" required value={fields.reminderTime}
          onChange={event => set('reminderTime', event.target.value)} /></Field>}
      </div>
      {habit && <p className="field-note">已开始的习惯最早从明天应用新计划，今天和过去的统计继续按原计划计算。</p>}
      {!habit && fields.startDate && fields.startDate < today && <p className="field-note">从 {dateLabel(fields.startDate)} 起的计划计入统计，可在日历补卡。</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="dialog-actions">
        <button type="button" className="button secondary" onClick={close} disabled={busy}>取消</button>
        <button type="submit" className="button primary" disabled={busy}>{busy ? '保存中…' : '保存习惯'}</button>
      </footer>
    </form>
  </Dialog>;
}

const HabitEditorContext = createContext<(habit?: Habit) => void>(() => undefined);

export function HabitEditorProvider({ children }: { children: ReactNode }) {
  const [editor, setEditor] = useState<{ habit?: Habit } | null>(null);
  return <HabitEditorContext.Provider value={habit => setEditor({ habit })}>
    {children}
    {editor && <HabitDialog habit={editor.habit} close={() => setEditor(null)} />}
  </HabitEditorContext.Provider>;
}

export const useHabitEditor = () => useContext(HabitEditorContext);

export function HabitRows({ habits, date, edit = false, showTimes = false, startRecord, closeRecord }: {
  habits: Habit[]; date: string; edit?: boolean; showTimes?: boolean; startRecord?: string; closeRecord?: () => void;
}) {
  const { data, stats, today, toggle, saving, reduced } = useJournal();
  const openEditor = useHabitEditor();
  const [manual, setRecording] = useState<Habit>();
  const recording = manual ?? habits.find(habit => habit.id === startRecord);
  const [limit, setLimit] = useState(48);
  const timeLabel = new Intl.DateTimeFormat('zh-CN', {
    timeZone: data.settings.zone, year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  return <><ul className="habit-list"><AnimatePresence initial={false}>
    {habits.slice(0, limit).map(habit => {
      const entry = stats.findEntry(habit.id, date);
      const completed = Boolean(entry?.completed);
      const weekly = weeklyCommitment(habit, date, data.settings.weekStartsOn, data.entries);
      const busy = saving.has(entryKey({ habitId: habit.id, date }));
      return <motion.li className="habit-row" layout={reduced ? false : 'position'} data-done={completed}
        key={habit.id} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
        exit={reduced ? undefined : { opacity: 0 }} transition={{ duration: reduced ? 0 : timing.normal, ease }}>
        <HabitIcon habit={habit} />
        <div className="habit-copy">
          <span className="habit-name">{habit.name}</span>
          <span className="habit-meta">{data.domains.find(item => item.id === habit.domainId)?.title ?? habit.category}{habit.description && ' · ' + habit.description}</span>
          {weekly && <span className="habit-meta">本周 {weekly.done} / {weekly.target} 次</span>}
          {entry?.quantity !== undefined && <span className="habit-meta">{entry.completed ? '已达标' : '部分完成'} · {entry.quantity} {habit.measurement?.unit}</span>}
          {entry?.skipReason && <span className="habit-meta">跳过 · {entry.skipReason}</span>}
          {showTimes && entry && <span className="habit-meta entry-time">
            录入于 {timeLabel.format(new Date(entry.createdAt))}
            {entry.updatedAt !== entry.createdAt && ' · 更新于 ' + timeLabel.format(new Date(entry.updatedAt))}
          </span>}
        </div>
        {date <= today && <motion.button type="button" className="habit-check" aria-label={
          (completed ? '撤销打卡 ' : '完成打卡 ') + habit.name
        } aria-pressed={completed} aria-busy={busy} disabled={busy}
          whileTap={reduced ? undefined : { scale: 0.91 }}
          onClick={() => { if (habit.measurement && !completed) setRecording(habit); else void toggle(habit, date, completed); }}>
          <AnimatePresence initial={false}>
            {completed && <motion.svg width="17" height="17" viewBox="0 0 20 20" aria-hidden="true"
              initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : timing.quick }}>
              <motion.path d="m4 10 4 4 8-8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
                initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }}
                transition={{ duration: reduced ? 0 : timing.normal, ease }} />
            </motion.svg>}
          </AnimatePresence>
        </motion.button>}
        {date <= today && <IconButton label={'记录详情 ' + habit.name} onClick={() => setRecording(habit)}>⋯</IconButton>}
        {edit && <IconButton label={'编辑 ' + habit.name} onClick={() => openEditor(habit)}><Pencil size={15} aria-hidden /></IconButton>}
      </motion.li>;
    })}
  </AnimatePresence></ul>
    {limit < habits.length && <button type="button" className="text-button" onClick={() => setLimit(value => value + 48)}>显示更多习惯</button>}
    {recording && <RecordDialog key={recording.id + date} habit={recording} date={date} close={() => { setRecording(undefined); closeRecord?.(); }} />}
  </>;
}

function RecordDialog({ habit, date, close }: { habit: Habit; date: string; close: () => void }) {
  const { stats, reduced, commit } = useJournal();
  const entry = stats.findEntry(habit.id, date);
  const [action, setAction] = useState(entry?.skipReason ? 'skip' : 'perform');
  const [quantity, setQuantity] = useState(entry?.quantity ?? habit.measurement?.minimum ?? 1);
  const [reason, setReason] = useState(entry?.skipReason ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision] = useState(entry?.updatedAt ?? null);

  async function save(remove = false) {
    setBusy(true);
    setError('');
    const detail = { revision, quantity: !remove && action === 'perform' && habit.measurement ? quantity : undefined,
      skipReason: !remove && action === 'skip' ? reason : undefined };
    const saved = await commit(() => repository.setEntry(habit.id, date, !remove && action === 'perform', !!entry?.completed, detail), '打卡记录已更新。', setError);
    setBusy(false);
    if (saved) close();
  }

  return <Dialog title={habit.name} reduced={reduced} busy={busy} onClose={close}>
    <form className="dialog-body" onSubmit={event => { event.preventDefault(); if (action !== 'skip' || reason.trim()) void save(); }}>
      <p>{dateLabel(date)}</p>
      <Field label="记录状态"><select value={action} onChange={event => setAction(event.target.value)}>
        <option value="perform">{habit.measurement ? '记录实际数量' : '已完成'}</option><option value="skip">跳过并记录原因</option>
      </select></Field>
      {action === 'skip' ? <Field label="跳过原因" hint="临时跳过仍计入应做计划。提前安排的暂停不计入。"><input required maxLength={160} value={reason} onChange={event => setReason(event.target.value)} /></Field>
        : habit.measurement && <Field label={'实际数量（' + habit.measurement.unit + '）'} hint={'最低执行标准 ' + habit.measurement.minimum + ' ' + habit.measurement.unit}>
          <input required type="number" min=".01" max="1000000" step="any" value={quantity || ''} onChange={event => setQuantity(Number(event.target.value))} />
        </Field>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="dialog-actions">
        {(entry?.completed || entry?.skipReason || entry?.quantity) && <button type="button" className="button secondary" disabled={busy} onClick={() => { void save(true); }}>清除当日记录</button>}
        <button type="submit" className="button primary" disabled={busy}>保存记录</button>
      </footer>
    </form>
  </Dialog>;
}
