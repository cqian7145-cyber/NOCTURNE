import { useState } from 'react';
import { Layers3, Plus, Pencil, Target } from 'lucide-react';
import { Link } from 'react-router';
import { useJournal } from '../app/journal';
import { growthSummary } from '../core/growth';
import { colors, type Domain, type Routine } from '../core/model';
import { repository } from '../core/repository';
import { lastDays, pct } from '../core/stats';
import { WeekChart } from '../ui/charts';
import { useHabitEditor } from '../ui/habits';
import { Dialog, Empty, Field, IconButton, PageHeading, PanelHeading } from '../ui/primitives';

const suggestions = [
  ['智识', '阅读、语言与数学'], ['技术', '编程、AI 与工程实践'], ['商业', '研究、访谈与销售'],
  ['体魄', '健身与运动'], ['创作', '写作、摄影与表达'], ['生活', '睡眠与日常秩序'],
] as const;

export function Domains() {
  const { data, stats, today, commit, reduced } = useJournal();
  const editHabit = useHabitEditor();
  const [editor, setEditor] = useState<{ kind: 'domain' | 'routine'; item?: Domain | Routine }>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<Domain['color']>('amber');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { areas } = growthSummary(data, stats, lastDays(today, 30), today);

  function open(kind: 'domain' | 'routine', item?: Domain | Routine) {
    setTitle(item?.title ?? '');
    setDescription(item && 'description' in item ? item.description : '');
    setColor(item && 'color' in item ? item.color : 'amber');
    setError('');
    setEditor({ kind, item });
  }

  return <>
    <PageHeading title="人生领域" description="把习惯、目标与专注时间归入你关心的领域。" action={<button className="button primary" onClick={() => open('domain')}><Plus size={16} />新建领域</button>} />
    {areas.length ? <div className="domain-grid">{areas.map(({ domain, habits, goals, summary, history, minutes }) =>
      <section className="panel domain-panel" key={domain.id} data-color={domain.color}>
        <PanelHeading title={domain.title} detail={domain.description} action={<IconButton label={'编辑 ' + domain.title} onClick={() => open('domain', domain)}><Pencil size={15} /></IconButton>} />
        <dl className="growth-metrics"><div><dt>近 30 天完成率</dt><dd>{pct(summary.rate)}</dd></div><div><dt>专注分钟</dt><dd>{Math.round(minutes)}</dd></div><div><dt>关联目标</dt><dd>{goals.length}</dd></div></dl>
        <details><summary>查看趋势与关联</summary>
          <WeekChart rows={history} summarizeData={false} />
          <div className="inline-actions">{habits.map(habit => <button key={habit.id} className="choice" onClick={() => editHabit(habit)}>{habit.name}</button>)}
            {goals.map(goal => <Link key={goal.id} className="choice" to={'/goals?goal=' + goal.id}><Target size={13} /> {goal.title}</Link>)}</div>
        </details>
      </section>)}</div> : <section className="panel"><Empty icon={Layers3} title="建立第一个领域">可以从学习、创业或体能开始。</Empty></section>}
    <section className="panel">
      <PanelHeading title="例行组合" detail="在习惯编辑器中选择组合，今日总览可按组合筛选。" action={<button className="button secondary" onClick={() => open('routine')}>新建组合</button>} />
      <ul className="domain-routines">{data.routines.map(routine => <li key={routine.id}><strong>{routine.title}</strong><span>{data.habits.filter(habit => habit.routineId === routine.id).length} 项</span>
        <IconButton label={'编辑 ' + routine.title} onClick={() => open('routine', routine)}><Pencil size={15} /></IconButton></li>)}</ul>
      {!data.routines.length && <Empty title="还没有例行组合">晨间例行与睡前例行可以分别管理。</Empty>}
    </section>
    {editor && <Dialog title={editor.kind === 'domain' ? '编辑人生领域' : '编辑例行组合'} reduced={reduced} busy={busy} onClose={() => setEditor(undefined)}>
      <form className="dialog-body" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError('');
        const saved = await commit(() => editor.kind === 'domain'
          ? repository.saveDomain({ title, description, color }, editor.item?.id) : repository.saveRoutine(title, editor.item?.id), '已保存。', setError);
        setBusy(false); if (saved) setEditor(undefined);
      }}>
        {editor.kind === 'domain' && !editor.item && <div className="choice-list">{suggestions.map(([name, detail]) =>
          <button type="button" key={name} className="choice" onClick={() => { setTitle(name); setDescription(detail); }}>{name}</button>)}</div>}
        <Field label="名称"><input required maxLength={90} value={title} onChange={event => setTitle(event.target.value)} /></Field>
        {editor.kind === 'domain' && <>
          <Field label="领域说明"><textarea maxLength={300} value={description} onChange={event => setDescription(event.target.value)} /></Field>
          <fieldset className="pick-field"><legend>领域色</legend><div className="choice-list">{colors.map((swatch, index) =>
            <button type="button" key={swatch} className="swatch" data-color={swatch} aria-pressed={swatch === color}
              aria-label={['雾紫','青绿','古铜','灰蓝','浅红'][index]} onClick={() => setColor(swatch)} />)}</div></fieldset>
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="dialog-actions"><button type="submit" className="button primary" disabled={busy}>保存</button></footer>
      </form>
    </Dialog>}
  </>;
}
