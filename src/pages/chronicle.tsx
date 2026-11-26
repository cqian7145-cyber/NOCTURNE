import {StudyMilestones} from '../ui/memory-integration';
import { useMemo, useState } from 'react';
import { BookOpen, Flag, Plus, Timer, Check, Pencil } from 'lucide-react';
import { useJournal } from '../app/journal';
import { dateLabel } from '../core/dates';
import { deepWork, timeline } from '../core/growth';
import type { ChronicleEvent } from '../core/model';
import { repository } from '../core/repository';
import { pct, summarize } from '../core/stats';
import { DomainSelect } from '../ui/growth-fields';
import { Dialog, Empty, Field, IconButton, PageHeading } from '../ui/primitives';

const kinds = { event: '人生事件', habit: '习惯里程碑', goal: '目标', focus: '深度工作' };
const icons = { event: BookOpen, habit: Check, goal: Flag, focus: Timer };
const rowHeight = 98;
const overscan = 5;
const windowRows = 10;

export function Chronicle() {
  const { data, stats, today, commit, reduced } = useJournal();
  const [year, setYear] = useState(today.slice(0, 4));
  const [area, setArea] = useState<string>();
  const [kind, setKind] = useState('');
  const [top, setTop] = useState(0);
  const [editor, setEditor] = useState<ChronicleEvent | null>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const items = useMemo(() => timeline(data, today), [data, today]);
  const years = [...new Set([today.slice(0, 4), ...items.map(item => item.date.slice(0, 4))])].sort().reverse();
  const picked = items.filter(item => item.date.startsWith(year) && (!area || item.domainId === area) && (!kind || item.kind === kind));
  const offset = Math.min(Math.max(0, picked.length - 1), Math.max(0, Math.floor(top / rowHeight) - overscan));
  const end = Math.min(picked.length, offset + windowRows + overscan * 2);
  const goals = data.goals.filter(goal => (!area || goal.domainId === area) && goal.startDate.slice(0, 4) === year);
  const totals = summarize(stats.range(year + '-01-01', year + '-12-31', area ? stats.habits.filter(habit => habit.domainId === area) : undefined));
  const minutes = deepWork(data, year + '-01-01', year + '-12-31').filter(item => !area || item.area === area).reduce((sum, item) => sum + item.actualSeconds / 60, 0);

  function change(field: Partial<ChronicleEvent>) {
    setEditor(previous => previous ? { ...previous, ...field } : previous);
  }

  return <>
    <PageHeading title="成长编年史" description="回看自己做过的事，以及值得留下的时刻。" action={<button className="button primary" onClick={() => {
      setError(''); setEditor({ id: '', title: '', note: '', date: today, updatedAt: '' });
    }}><Plus size={16} />记录事件</button>} />
    <section className="panel chronicle-hero"><div><span className="range-caption">{year} 年成长档案</span><h2 lang="en">The Becoming.</h2></div>
      <dl className="growth-metrics"><div><dt>完成率</dt><dd>{pct(totals.rate)}</dd></div><div><dt>专注小时</dt><dd>{(minutes / 60).toFixed(1)}</dd></div>
        <div><dt>新建目标</dt><dd>{goals.length}</dd></div></dl></section>
    <StudyMilestones/>
    <div className="growth-filters">
      <Field label="档案年份"><select value={year} onChange={event => { setYear(event.target.value); setTop(0); }}>{years.map(value => <option key={value}>{value}</option>)}</select></Field>
      <DomainSelect value={area} change={value => { setArea(value); setTop(0); }} />
      <Field label="事件类型"><select value={kind} onChange={event => { setKind(event.target.value); setTop(0); }}>
        <option value="">全部事件</option>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></Field>
    </div>
    {picked.length ? <div key={year + ':' + (area ?? '') + ':' + kind} className="chronicle-scroll" role="region" aria-label="成长事件" tabIndex={0}
      onScroll={event => setTop(event.currentTarget.scrollTop)}>
      <ol className="chronicle-list" style={{ paddingBlockStart: offset * rowHeight, paddingBlockEnd: (picked.length - end) * rowHeight }}>
      {picked.slice(offset, end).map((item, index) => {
      const Icon = icons[item.kind];
      return <li key={item.kind + item.id} aria-posinset={offset + index + 1} aria-setsize={picked.length}><time dateTime={item.date}>{dateLabel(item.date)}</time><span className="chronicle-icon"><Icon size={18} /></span>
        <div><h3 title={item.title}>{item.title}</h3><p>{kinds[item.kind]}{item.domainId && ' · ' + (data.domains.find(domain => domain.id === item.domainId)?.title ?? '')}</p>{item.note && <p title={item.note}>{item.note}</p>}</div>
        {item.kind === 'event' && <IconButton label={'编辑 ' + item.title} onClick={() => { setError(''); setEditor(data.events.find(event => event.id === item.id)); }}><Pencil size={15} /></IconButton>}
      </li>;
    })}</ol></div> : <section className="panel"><Empty icon={BookOpen} title="这里还没有事件">打卡、完成专注或手动记录事件后，时间线会逐步展开。</Empty></section>}
    {editor && <Dialog title={editor.id ? '编辑事件' : '记录人生事件'} reduced={reduced} busy={busy} onClose={() => setEditor(undefined)}>
      <form className="dialog-body" onSubmit={async event => {
        event.preventDefault(); setBusy(true);
        const { title, note, date, domainId, id } = editor;
        const saved = await commit(() => repository.saveEvent({ title, note, date, domainId }, id || undefined), '事件已保存。', setError);
        setBusy(false); if (saved) { setYear(date.slice(0, 4)); setEditor(undefined); }
      }}>
        <Field label="事件标题"><input required value={editor.title} maxLength={90} onChange={event => change({ title: event.target.value })} /></Field>
        <Field label="事件日期"><input required type="date" min="1900-01-01" max={today} value={editor.date} onChange={event => change({ date: event.target.value })} /></Field>
        <DomainSelect value={editor.domainId} change={domainId => change({ domainId })} />
        <Field label="备注"><textarea maxLength={500} value={editor.note} onChange={event => change({ note: event.target.value })} /></Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="dialog-actions">
          {editor.id && <button type="button" className="button danger-quiet" disabled={busy} onClick={async () => {
            if (!window.confirm('删除这个人生事件？')) return;
            setBusy(true); const removed = await commit(() => repository.deleteEvent(editor.id), '事件已删除。', setError);
            setBusy(false); if (removed) setEditor(undefined);
          }}>删除事件</button>}
          <button type="submit" className="button primary" disabled={busy}>保存事件</button>
        </footer>
      </form>
    </Dialog>}
  </>;
}
