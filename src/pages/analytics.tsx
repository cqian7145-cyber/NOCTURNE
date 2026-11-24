import { DeepInsights } from '../ui/deep-insights';
import { useMemo, useState } from 'react';
import { BarChart3, ChartNoAxesCombined, Flame } from 'lucide-react';
import { useJournal } from '../app/journal';
import { dateLabel, minDay, validDay } from '../core/dates';
import { grouped, lastDays, pct, summarize } from '../core/stats';
import { Heatmap, WeekChart } from '../ui/charts';
import { HabitIcon } from '../ui/habits';
import { Empty, Field, PageHeading, PanelHeading } from '../ui/primitives';

const ranges = { '7': '近 7 天', '30': '近 30 天', '90': '近 90 天', year: '本年', custom: '自定义' } as const;
type Range = keyof typeof ranges;

export function Analytics() {
  const { data, stats, today } = useJournal();
  const [range, setRange] = useState<Range>('30');
  const [customStart, setCustomStart] = useState(lastDays(today, 30));
  const [customEnd, setCustomEnd] = useState(today);
  const [group, setGroup] = useState<'day' | 'week' | 'month'>('day');
  const start = range === 'custom' ? customStart : range === 'year' ? today.slice(0, 4) + '-01-01' : lastDays(today, +range);
  const end = range === 'custom' ? minDay(customEnd, today) : today;
  const valid = validDay(start) && validDay(end) && start <= end;
  const longRange = valid && start < lastDays(end, 90);
  const unit = group === 'day' && longRange ? 'week' : group;
  const rows = useMemo(() => valid ? stats.range(start, end) : [], [stats, valid, start, end]);
  const summary = summarize(rows);
  const weekly = grouped(rows, 'week', data.settings.weekStartsOn);
  const trend = unit === 'day' ? rows : grouped(rows, unit, data.settings.weekStartsOn);
  const performance = useMemo(() => valid ? stats.habitPerformance(start, end) : [], [stats, valid, start, end]);
  const allTime = stats.overall();

  function select(next: Range) {
    setRange(next);
    setGroup(next === 'year' ? 'month' : next === '90' ? 'week' : 'day');
  }

  return <>
    <PageHeading title="数据洞察" description="用实际完成记录衡量每个计划日。" />
    <div className="filter-line">
      <div className="segmented" aria-label="统计范围">
        {Object.entries(ranges).map(([value, label]) => <button key={value} type="button" aria-pressed={value === range}
          onClick={() => select(value as Range)}>{label}</button>)}
      </div>
      {valid && <span className="range-caption">{start} 至 {end}</span>}
    </div>
    {range === 'custom' && <div className="custom-range">
      <Field label="起始日期"><input type="date" min="1900-01-01" max={today} value={customStart} onChange={event => setCustomStart(event.target.value)} /></Field>
      <Field label="截止日期"><input type="date" min={customStart || '1900-01-01'} max={today} value={customEnd} onChange={event => setCustomEnd(event.target.value)} /></Field>
      {!valid && <p role="alert" className="form-error">请选择有效的起止日期。</p>}
    </div>}
    <section className="panel insights-summary" aria-label="周期概况">
      <dl>
        <div><dt>计划次数</dt><dd>{summary.planned}</dd></div>
        <div><dt>完成次数</dt><dd>{summary.done}</dd></div>
        <div><dt>周期完成率</dt><dd>{pct(summary.rate)}</dd></div>
        <div><dt>打卡天数</dt><dd>{summary.active}</dd></div>
        <div><dt>全勤天数</dt><dd>{summary.perfect}</dd></div>
        <div><dt><Flame size={15} aria-hidden />当前 / 最长全勤</dt><dd>{allTime.current}<small> / {allTime.longest} 天</small></dd></div>
      </dl>
    </section>
    <div className="insights-grid">
      <section className="panel">
        <PanelHeading title="完成率趋势" action={<div className="segmented compact" aria-label="时间聚合">
          <button type="button" disabled={longRange} aria-pressed={unit === 'day'} onClick={() => setGroup('day')}>日</button>
          <button type="button" aria-pressed={unit === 'week'} onClick={() => setGroup('week')}>周</button>
          <button type="button" aria-pressed={unit === 'month'} onClick={() => setGroup('month')}>月</button>
        </div>} />
        <WeekChart key={range + unit + start + end} rows={trend} unit={unit} />
      </section>
      <section className="panel">
        <PanelHeading title="每周完成次数" />
        <WeekChart key={range + start + end} rows={weekly} unit="week" kind="bar" />
      </section>
    </div>
    <section className="panel">
      <PanelHeading title="习惯表现" detail="周期完成率及该习惯的历史连续记录" />
      {performance.length ? <ul className="performance-list">{performance.map(item => {
        const streak = stats.habitStreak(item.habit);
        const value = item.rate ?? 0;
        return <li key={item.habit.id} className="performance-row" data-color={item.habit.color}>
          <HabitIcon habit={item.habit} />
          <div className="performance-main">
            <strong>{item.habit.name}</strong>
            <small>当前 {streak.current} 天 · 最长 {streak.longest} 天 · 累计 {streak.total} 次{streak.last && ' · 最近 ' + dateLabel(streak.last)}</small>
          </div>
          <div className="performance-bar" role="progressbar" aria-label={item.habit.name + ' 完成率'} aria-valuenow={value}>
            <span style={{ width: value + '%' }} />
          </div>
          <span className="performance-metric"><strong>{pct(item.rate)}</strong><small>{item.done} / {item.planned} 项</small></span>
        </li>;
      })}</ul> : <Empty icon={BarChart3} title="暂无习惯表现">选中的日期有计划后，即可比较不同习惯。</Empty>}
    </section>
    {valid && <DeepInsights start={start} end={end} />}
    <Heatmap />
    <p className="insights-note"><ChartNoAxesCombined size={16} aria-hidden />全勤按计划日计算。今天尚未完成时，保留截至昨天的连续天数。</p>
  </>;
}
