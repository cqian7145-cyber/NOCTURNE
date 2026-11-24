import { useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useJournal, useMedia } from '../app/journal';
import { addDays, dateLabel, dayKeys, monthShift, monthStart, validDay, weekStart } from '../core/dates';
import { weekdays } from '../core/model';
import { heatLevel, pct, rate } from '../core/stats';
import { describeDay } from '../ui/charts';
import { HabitRows } from '../ui/habits';
import { Dialog, Empty, IconButton, PageHeading, PanelHeading } from '../ui/primitives';

const monthLabel = { year: 'numeric', month: 'long' } as const;
const fullLabel = { month: 'long', day: 'numeric', weekday: 'long' } as const;

function DateDetails({ date, heading }: { date: string; heading: boolean }) {
  const { stats, today } = useJournal();
  const row = stats.daily(date);
  const due = stats.due(date);
  const future = date > today;
  return <>
    {heading && <PanelHeading title={dateLabel(date, fullLabel)} detail={date === today ? '今天' : date} />}
    {due.length ? <>
      <div className="date-rollup">
        <span>{future ? '计划执行' : '完成进度'}</span>
        <strong>{future ? due.length + ' 项' : row.done + ' / ' + row.planned + ' 项'}</strong>
        {!future && <span className="trend-pill">{pct(rate(row))}</span>}
      </div>
      <HabitRows habits={due} date={date} showTimes />
      {future && <p className="field-note"><Clock3 size={14} aria-hidden />到当天即可打卡。</p>}
      {date < today && <p className="field-note"><Clock3 size={14} aria-hidden />补卡计入选中日期，并保留实际录入时间。</p>}
    </> : <Empty icon={CalendarDays} title="当天没有计划" />}
  </>;
}

export function Calendar() {
  const { data, stats, today, reduced } = useJournal();
  const [query, setQuery] = useSearchParams();
  const queryDate = query.get('date') ?? '';
  const date = validDay(queryDate) ? queryDate : today;
  const month = monthStart(date);
  const first = weekStart(month, data.settings.weekStartsOn);
  const days = dayKeys(first, addDays(first, 41));
  const start = data.settings.weekStartsOn === 'monday' ? 1 : 0;
  const mobile = useMedia('(max-width: 700px)');
  const [sheet, setSheet] = useState(Boolean(queryDate));
  const [focused, setFocused] = useState('');
  const refs = useRef(new Map<string, HTMLButtonElement>());

  function choose(next: string, show = false) {
    if (!validDay(next)) return;
    setFocused(next);
    setQuery({ date: next });
    if (show) setSheet(true);
  }

  function seek(event: KeyboardEvent<HTMLButtonElement>, from: string) {
    const offsets: Record<string, number> = { ArrowUp: -7, ArrowDown: 7, ArrowLeft: -1, ArrowRight: 1 };
    const offset = offsets[event.key];
    if (offset === undefined) return;
    const next = addDays(from, offset);
    if (!validDay(next)) return;
    event.preventDefault();
    if (refs.current.has(next)) {
      setFocused(next);
      refs.current.get(next)?.focus();
    } else {
      choose(next);
      requestAnimationFrame(() => refs.current.get(next)?.focus());
    }
  }

  return <>
    <PageHeading title="日历" description="查看每天的计划、打卡与历史记录。"
      action={<button type="button" className="button secondary" onClick={() => choose(today, mobile)}>
        <CalendarDays size={16} aria-hidden />回到今天
      </button>} />
    <div className="calendar-layout">
      <section className="panel calendar-panel">
        <PanelHeading title={dateLabel(month, monthLabel)} action={<div className="stepper">
          <IconButton label="上个月" onClick={() => choose(monthShift(month, -1))} disabled={month <= '1900-01-01'}><ChevronLeft size={18} aria-hidden /></IconButton>
          <IconButton label="下个月" onClick={() => choose(monthShift(month, 1))} disabled={month >= '2199-12-01'}><ChevronRight size={18} aria-hidden /></IconButton>
        </div>} />
        <div className="calendar-grid">
          {Array.from({ length: 7 }, (_, index) => <span className="calendar-weekday" key={index}>周{weekdays[(start + index) % 7]}</span>)}
          {days.map(day => {
            const row = stats.daily(day);
            const outside = monthStart(day) !== month;
            const label = dateLabel(day, { ...fullLabel, year: 'numeric' }) + '，' + describeDay(row, today);
            return <button type="button" className="calendar-day" key={day} disabled={!validDay(day)}
              data-level={heatLevel(row, today)} data-outside={outside}
              aria-current={day === today ? 'date' : undefined} aria-pressed={day === date} aria-label={label}
              tabIndex={day === (days.includes(focused) ? focused : date) ? 0 : -1}
              ref={element => { if (element) refs.current.set(day, element); else refs.current.delete(day); }}
              onClick={() => choose(day, true)} onFocus={() => setFocused(day)} onKeyDown={event => seek(event, day)}>
              <span className="day-number">{Number(day.slice(8))}</span>
              {row.planned > 0 && <span className="calendar-status"><i /><span>{row.done}/{row.planned}</span></span>}
            </button>;
          })}
        </div>
      </section>
      {!mobile && <section className="panel calendar-details"><DateDetails date={date} heading /></section>}
    </div>
    {mobile && !sheet && <section className="panel calendar-mobile-summary">
      <PanelHeading title={dateLabel(date, fullLabel)} detail={describeDay(stats.daily(date), today)}
        action={<button type="button" className="button secondary" onClick={() => setSheet(true)}>查看当日</button>} />
    </section>}
    {mobile && sheet && <Dialog title={dateLabel(date, fullLabel)} sheet reduced={reduced} onClose={() => setSheet(false)}>
      <div className="dialog-body"><DateDetails date={date} heading={false} /></div>
    </Dialog>}
  </>;
}
