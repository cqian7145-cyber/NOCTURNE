import {memoria,useQuery} from '../app/memoria';
import { useSearchParams } from 'react-router';
import { orderGoals } from '../core/growth';
import { DomainSelect } from '../ui/growth-fields';
import { useState, type FormEvent } from 'react';
import { Check, ChevronDown, Flag, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useJournal } from '../app/journal';
import { dateLabel } from '../core/dates';
import { goalTypes, type Goal, type GoalFields } from '../core/model';
import { repository } from '../core/repository';
import { pct } from '../core/stats';
import { HabitIcon } from '../ui/habits';
import { Dialog, ease, Empty, Field, IconButton, PageHeading, timing } from '../ui/primitives';

function GoalForm({ goal, close }: { goal?: Goal; close: () => void }) {
  const { data, stats, today, commit, reduced } = useJournal();
  const {value:memory}=useQuery(()=>memoria.overview());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<GoalFields>(() => goal ?? {
    title: '', description: '', habitIds: stats.habits.length === 1 ? [stats.habits[0].id] : [],
    goalType: 'count', targetValue: 30, startDate: today,
  });

  function set<K extends keyof GoalFields>(key: K, value: GoalFields[K]) {
    setFields(previous => ({ ...previous, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!fields.title.trim() || ['count','completionRate','streak'].includes(fields.goalType)&&!fields.habitIds.length) {
      setError('请输入目标名称，并至少关联一项习惯。');
      return;
    }
    setBusy(true);
    setError('');
    const saved = await commit(() => repository.saveGoal(fields, goal?.id), goal ? '目标已更新。' : '目标已创建。', setError);
    if (saved) close();
    else setBusy(false);
  }

  return <Dialog title={goal ? '编辑目标' : '创建目标'} onClose={close} reduced={reduced} busy={busy}>
    <form className="dialog-body" onSubmit={save}>
      <div className="form-grid">
        <Field label="目标名称" wide><input required maxLength={90} value={fields.title} placeholder="例如，连续阅读 30 个计划日"
          onChange={event => set('title', event.target.value)} /></Field>
        <Field label="描述（可选）" wide><textarea rows={2} maxLength={400} value={fields.description}
          onChange={event => set('description', event.target.value)} /></Field>
        <Field label="学习卡组（学习目标可选）"><select value={fields.studyDeckId??''} onChange={e=>set('studyDeckId',e.target.value||undefined)}><option value="">全部卡组</option>{memory?.decks.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="目标类型"><select value={fields.goalType} onChange={event => {
          const goalType = event.target.value as GoalFields['goalType'];
          setFields(previous => ({ ...previous, goalType, targetValue: goalType === 'completionRate' ? 80 : 30 }));
        }}>{Object.entries(goalTypes).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
        <Field label={fields.goalType === 'completionRate' ? '目标完成率（%）' : fields.goalType === 'streak' ? '连续计划天数' : fields.goalType==='studyMinutes'?'目标学习分钟':fields.goalType==='reviews'?'目标正式复习次数':fields.goalType==='matureCards'?'目标成熟卡片数':fields.goalType==='recallRate'?'目标回忆率（%）':'目标打卡次数'}>
          <input required type="number" value={fields.targetValue || ''} min="1" max={fields.goalType === 'completionRate' ? 100 : 100_000}
            onChange={event => set('targetValue', Number(event.target.value))} />
        </Field>
        <Field label="开始日期"><input type="date" min="1900-01-01" max="2199-12-31" required value={fields.startDate}
          onChange={event => set('startDate', event.target.value)} /></Field>
        <Field label={fields.goalType === 'completionRate' ? '截止日期' : '截止日期（可选）'}>
          <input type="date" min={fields.startDate || '1900-01-01'} max="2199-12-31" required={fields.goalType === 'completionRate'}
            value={fields.endDate ?? ''} onChange={event => set('endDate', event.target.value || undefined)} />
        </Field>
      </div>
      <fieldset className="pick-field">
        <legend>关联习惯</legend>
        <div className="linked-habits">
          {stats.habits.map(habit => <label className="check-field" key={habit.id}>
            <input type="checkbox" checked={fields.habitIds.includes(habit.id)} onChange={event => set('habitIds',
              event.target.checked ? [...fields.habitIds, habit.id] : fields.habitIds.filter(id => id !== habit.id))} />
            <HabitIcon habit={habit} size={14} /><span>{habit.name}{habit.archivedAt && '（已归档）'}</span>
          </label>)}
        </div>
      </fieldset>
      <div className="form-grid">
        <DomainSelect value={fields.domainId} change={value => set('domainId', value)} />
        <Field label="上级目标"><select value={fields.parentId ?? ''} onChange={event => set('parentId', event.target.value || undefined)}>
          <option value="">顶级目标</option>{data.goals.filter(item => item.id !== goal?.id).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select></Field>
      </div>
      <fieldset className="pick-field"><legend>依赖的前置目标</legend>
        <div className="linked-habits">{data.goals.filter(item => item.id !== goal?.id).map(item => <label className="check-field" key={item.id}>
          <input type="checkbox" checked={fields.dependencies?.includes(item.id) ?? false}
            onChange={event => set('dependencies', event.target.checked ? [...(fields.dependencies ?? []), item.id] : fields.dependencies?.filter(id => id !== item.id))} />
          {item.title}
        </label>)}</div>
      </fieldset>
      <fieldset className="pick-field"><legend>自定义里程碑</legend>
        {(fields.milestones ?? []).map((item, index) => <div className="milestone-form" key={item.id}>
          <Field label={'第 ' + (index + 1) + ' 个里程碑'}><input required maxLength={90} value={item.title} onChange={event => set('milestones',
            fields.milestones?.map(value => value.id === item.id ? { ...value, title: event.target.value } : value))} /></Field>
          <button className="text-button" type="button" onClick={() => set('milestones', fields.milestones?.filter(value => value.id !== item.id))}>移除</button>
        </div>)}
        <button className="text-button" type="button" onClick={() => set('milestones', [...(fields.milestones ?? []), { id: crypto.randomUUID(), title: '' }])}>添加里程碑</button>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="dialog-actions">
        <button type="button" className="button secondary" onClick={close} disabled={busy}>取消</button>
        <button type="submit" className="button primary" disabled={busy}>{busy ? '保存中…' : '保存目标'}</button>
      </footer>
    </form>
  </Dialog>;
}

export function Goals() {
  const { stats, data, reduced, commit } = useJournal();

  const [editor, setEditor] = useState<{ goal?: Goal } | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const [busy, setBusy] = useState(false);
  const unit = { count: '次', completionRate: '%', streak: '天',studyMinutes:'分钟',reviews:'次',matureCards:'张',recallRate:'%' };
  const [query, setQuery] = useSearchParams();
  const creating = query.has('create');
  const goals = orderGoals([...data.goals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  return <>
    <PageHeading title="目标" description="选定一个可衡量的目标，让每次打卡累积成进度。"
      action={<button type="button" className="button primary" onClick={() => setEditor({})}>
        <Plus size={17} aria-hidden />新建目标
      </button>} />
    {goals.length ? <div className="goal-grid">
      {goals.map(({ goal, depth }) => {
        const { value, status, progress, summary } = stats.goalProgress(goal);
        const target = goal.targetValue + unit[goal.goalType];
        const actual = value === null ? '—' : ['completionRate','recallRate'].includes(goal.goalType) ? pct(value) : value + ' ' + unit[goal.goalType];
        return <article key={goal.id} className="panel goal-card" data-depth={Math.min(3, depth)}>
          <div className="goal-title">
            <span className="goal-icon"><Target size={21} strokeWidth={1.55} aria-hidden /></span>
            <div><h2>{goal.title}</h2><p>{goalTypes[goal.goalType]}{goal.parentId && ' · 上级 ' + (data.goals.find(item => item.id === goal.parentId)?.title ?? '')}</p></div>
            <span className="trend-pill" data-achieved={status === '达成' || status === '暂达标'}>{status}</span>
          </div>
          <div className="goal-values"><strong>{actual}</strong><span>目标 {target}</span></div>
          <div className="goal-track" role="progressbar" aria-label={goal.title + ' 进度'} aria-valuenow={Math.round(progress)}>
            <motion.span initial={false} animate={{ width: progress + '%' }} transition={{ duration: reduced ? 0 : timing.slow, ease }} />
          </div>
          <div className="milestones" aria-label="目标里程碑">
            {[25, 50, 75, 100].map(step => <span key={step} data-achieved={progress >= step}>
              {progress >= step ? <Check size={12} aria-label="已达到" /> : <Flag size={12} aria-hidden />}{step}%
            </span>)}
          </div>
          <details className="goal-details" open={query.get('goal') === goal.id || undefined}>
            <summary><span>目标详情</span><ChevronDown size={16} aria-hidden /></summary>
            <div className="goal-detail-body">
              {goal.description && <p>{goal.description}</p>}
              <p>开始于 {dateLabel(goal.startDate, { year: 'numeric', month: 'long', day: 'numeric' })}{goal.endDate && '，截止 ' + dateLabel(goal.endDate, { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <p>关联习惯：{stats.habits.filter(habit => goal.habitIds.includes(habit.id)).map(habit => habit.name).join('、')}</p>
              <p>周期内完成 {summary.done} / {summary.planned} 项。</p>
              {!!goal.dependencies?.length && <p>前置目标 {goal.dependencies.map(id => data.goals.find(item => item.id === id)?.title).join('、')}</p>}
              {!!goal.milestones?.length && <fieldset className="pick-field"><legend>完成里程碑</legend>
                {goal.milestones.map(item => <label className="check-field" key={item.id}><input type="checkbox" checked={!!item.doneOn}
                  onChange={() => { void commit(() => repository.setMilestone(goal.id, item.id, !item.doneOn), '里程碑已更新。'); }} />{item.title}</label>)}
              </fieldset>}
              <div className="inline-actions">
                <IconButton label={'编辑目标 ' + goal.title} onClick={() => setEditor({ goal })}><Pencil size={16} aria-hidden /></IconButton>
                <IconButton label={'删除目标 ' + goal.title} onClick={() => setDeleting(goal)}><Trash2 size={16} aria-hidden /></IconButton>
              </div>
            </div>
          </details>
        </article>;
      })}
    </div> : <section className="panel empty-panel">
      <Empty icon={Target} title="还没有长期目标">{stats.habits.length ? '试着从一个月内完成 20 次打卡开始。' : '创建一项习惯后，即可把它关联到目标。'}</Empty>
    </section>}
    {(editor || creating) && <GoalForm goal={editor?.goal} close={() => { setEditor(null); if (creating) setQuery({}); }} />}
    {deleting && <Dialog title="删除目标" onClose={() => setDeleting(null)} busy={busy} reduced={reduced}>
      <div className="dialog-body">
        <p>将删除「{deleting.title}」的目标与里程碑。习惯打卡记录会保留。</p>
        <footer className="dialog-actions">
          <button type="button" className="button secondary" onClick={() => setDeleting(null)} disabled={busy}>取消</button>
          <button type="button" className="button danger" disabled={busy} onClick={async () => {
            setBusy(true);
            if (await commit(() => repository.deleteGoal(deleting.id), '目标已删除。')) setDeleting(null);
            setBusy(false);
          }}>删除目标</button>
        </footer>
      </div>
    </Dialog>}
  </>;
}
