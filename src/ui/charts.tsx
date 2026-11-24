import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Activity, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router';
import { useJournal } from '../app/journal';
import { addDays, asDate, dateLabel, dayKeys, weekStart, weekday } from '../core/dates';
import { weekdays } from '../core/model';
import { heatLevel, pct, rate, summarize, type DayStat } from '../core/stats';
import { ease, Empty, IconButton, PanelHeading, timing } from './primitives';

const short = { month: 'numeric', day: 'numeric' } as const;
const dated = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' } as const;

export function describeDay(row: DayStat, today: string) {
  if (row.date > today) return '未来日期';
  if (!row.planned) return '无计划';
  return '完成 ' + row.done + ' / ' + row.planned + ' 项，完成率 ' + pct(rate(row));
}

export function WeekChart({ rows, unit = 'day', kind = 'line', summarizeData = true }: {
  rows: DayStat[]; unit?: 'day' | 'week' | 'month'; kind?: 'line' | 'bar'; summarizeData?: boolean;
}) {
  const { reduced } = useJournal();
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const pointRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const chartName = kind === 'line' ? '完成率趋势' : '每周完成次数';
  const label = (date: string) => unit === 'month' ? dateLabel(date, { month: 'long' }) : dateLabel(date, short);
  const readout = (row: DayStat) => row.planned ? row.done + ' / ' + row.planned + ' 项 · ' + pct(rate(row)) : '无计划';
  const height = 150;
  const width = 600;
  const hasRows = rows.some(row => row.planned);
  const maximum = kind === 'line' ? 100 : Math.ceil(Math.max(4, ...rows.map(row => row.done)) / 4) * 4;
  const x = (i: number) => ((i + 0.5) / Math.max(1, rows.length)) * width;
  const y = (value: number) => (height - 8) - value / maximum * (height - 16);
  const axis = [1, 0.75, 0.5, 0.25, 0];
  const segments: Array<Array<[number, number]>> = [];
  if (kind === 'line') {
    let segment: Array<[number, number]> = [];
    rows.forEach((row, index) => {
      if (row.planned) segment.push([x(index), y(rate(row) ?? 0)]);
      else if (segment.length) { segments.push(segment); segment = []; }
    });
    if (segment.length) segments.push(segment);
  }
  const activeRow = active === null ? undefined : rows[active];

  function seek(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : null;
    if (next === null) return;
    event.preventDefault();
    pointRefs.current[Math.max(0, Math.min(rows.length - 1, next))]?.focus();
  }

  if (!hasRows) return <Empty icon={Activity} title="这个周期没有计划">添加习惯后，这里会显示你的实际完成情况。</Empty>;

  return <div className="chart" aria-label={chartName}>
    <div className="chart-readout" aria-live="polite">
      {activeRow ? <span className="chart-tooltip"><strong>{label(activeRow.date)}</strong><span>{readout(activeRow)}</span></span>
        : <span>{kind === 'line' ? '按计划日统计' : '每周已完成的打卡'}</span>}
    </div>
    <div className="chart-body">
      <div className="chart-y" aria-hidden="true">
        {axis.map(fraction => <span key={fraction} style={{ top: y(fraction * maximum) / height * 100 + '%' }}>
          {fraction * maximum}{kind === 'line' && '%'}
        </span>)}
      </div>
      <div className="chart-visual">
        <svg viewBox={'0 0 ' + width + ' ' + height} preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#a8adef" stopOpacity=".24" /><stop offset="1" stopColor="#a8adef" stopOpacity="0" />
          </linearGradient></defs>
          {axis.map(fraction => <line key={fraction} x1="0" x2={width} y1={y(fraction * maximum)} y2={y(fraction * maximum)}
            className="chart-grid-line" vectorEffect="non-scaling-stroke" />)}
          {active !== null && <line x1={x(active)} x2={x(active)} y1="0" y2={height} className="chart-cursor" vectorEffect="non-scaling-stroke" />}
          {kind === 'line' ? segments.map((segment, index) => {
            const line = 'M' + segment.map(point => point.join(',')).join(' L');
            if (segment.length === 1) return <circle key={index} cx={segment[0][0]} cy={segment[0][1]} r="3.5" className="chart-point" />;
            const area = line + ' L' + segment.at(-1)?.[0] + ',' + y(0) + ' L' + segment[0][0] + ',' + y(0) + ' Z';
            return <g key={index}>
              <motion.path d={area} fill={'url(#' + id + ')'} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ duration: reduced ? 0 : timing.slow }} />
              <motion.path d={line} fill="none" className="chart-line" vectorEffect="non-scaling-stroke"
                initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }}
                transition={{ duration: reduced ? 0 : timing.slow, ease }} />
            </g>;
          }) : rows.map((row, index) => {
            if (!row.planned) return null;
            const barWidth = Math.min(24, width / rows.length * 0.58);
            const size = Math.max(2, y(0) - y(row.done));
            return <motion.rect key={row.date} x={x(index) - barWidth / 2} width={barWidth} rx="2"
              className={index === active ? 'chart-bar is-active' : 'chart-bar'}
              initial={reduced ? false : { y: y(0), height: 0 }} animate={{ y: y(0) - size, height: size }}
              transition={{ duration: reduced ? 0 : timing.slow, ease }} />;
          })}
        </svg>
        <div className="chart-hit-list" onPointerLeave={() => setActive(null)}>
          {rows.map((row, index) => <button type="button" key={row.date} className="chart-hit"
            ref={element => { pointRefs.current[index] = element; }} aria-label={label(row.date) + '，' + readout(row)}
            tabIndex={index === (active ?? rows.length - 1) ? 0 : -1}
            onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)}
            onBlur={() => setActive(null)} onClick={() => setActive(index)} onKeyDown={event => seek(event, index)} />)}
        </div>
        <div className="chart-x" aria-hidden="true">
          {rows.map((row, index) => {
            const ticks = Math.max(1, Math.ceil((rows.length - 1) / 6));
            if (index % ticks !== 0 && index !== rows.length - 1) return null;
            if (index !== rows.length - 1 && rows.length > 8 && (rows.length - 1 - index) / rows.length < 0.08) return null;
            const align = index === 0 ? 'first' : index === rows.length - 1 ? 'last' : 'middle';
            return <span key={row.date} data-align={align} style={{ left: x(index) / width * 100 + '%' }}>
              {unit === 'day' && rows.length === 7 ? '周' + weekdays[weekday(row.date)] : label(row.date)}
            </span>;
          })}
        </div>
      </div>
    </div>
    {summarizeData && <details className="chart-data">
      <summary>查看图表数据</summary>
      <div className="table-scroll"><table><thead><tr><th scope="col">日期</th><th scope="col">计划</th><th scope="col">完成</th><th scope="col">完成率</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.date}><th scope="row">{row.date}</th><td>{row.planned}</td><td>{row.done}</td><td>{pct(rate(row))}</td></tr>)}</tbody>
      </table></div>
    </details>}
  </div>;
}

const levels = ['none', 'zero', 'level-1', 'level-2', 'level-3', 'level-4', 'level-5', 'future'];

export function Heatmap() {
  const { data, stats, today } = useJournal();
  const currentYear = Number(today.slice(0, 4));
  const [chosenYear, setChosenYear] = useState<number>();
  const year = chosenYear ?? currentYear;
  const [focused, setFocused] = useState('');
  const [selected, setSelected] = useState('');
  const [hovered, setHovered] = useState('');
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const scroll = useRef<HTMLDivElement>(null);
  const start = year + '-01-01';
  const end = year + '-12-31';
  const first = weekStart(start, data.settings.weekStartsOn);
  const rows = useMemo(() => dayKeys(start, end).map(date => stats.daily(date)), [start, end, stats]);
  const firstSlot = Math.round((+asDate(start) - +asDate(first)) / 86_400_000);
  const columns = Math.ceil((rows.length + firstSlot) / 7);
  const yearStats = useMemo(() => summarize(rows), [rows]);
  const defaultDay = today.slice(0, 4) === String(year) ? today : start;
  const tabDay = focused.startsWith(String(year) + '-') ? focused : defaultDay;
  const viewed = rows.find(row => row.date === (hovered || selected));

  useEffect(() => {
    const container = scroll.current;
    const cell = refs.current.get(defaultDay);
    if (!container || !cell) return;
    const offset = cell.getBoundingClientRect().left - container.getBoundingClientRect().left;
    container.scrollLeft += offset - container.clientWidth / 2;
  }, [defaultDay]);

  function shift(offset: number) {
    setChosenYear(year + offset);
    setFocused('');
    setSelected('');
    setHovered('');
  }

  function move(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const shifts: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    const offset = shifts[event.key];
    let destination: string;
    if (event.key === 'Home') destination = start;
    else if (event.key === 'End') destination = end;
    else if (offset !== undefined) destination = addDays(date, offset);
    else return;
    event.preventDefault();
    if (destination < start || destination > end) return;
    setFocused(destination);
    refs.current.get(destination)?.focus();
  }

  return <section className="panel heat-panel">
    <PanelHeading title="年度热力图" detail="每格代表一天，颜色越亮表示当日完成率越高。"
      action={<div className="stepper heat-stepper">
        <IconButton label="上一年" onClick={() => shift(-1)} disabled={year <= 1900}><ChevronLeft size={16} aria-hidden /></IconButton>
        <span aria-live="polite">{year} 年</span>
        <IconButton label="下一年" onClick={() => shift(1)} disabled={year >= currentYear}><ChevronRight size={16} aria-hidden /></IconButton>
      </div>} />
    <div className="heat-summary">
      <span><strong>{yearStats.done}</strong> 次完成</span>
      <span><strong>{yearStats.active}</strong> 天打卡</span>
      <span><strong>{yearStats.perfect}</strong> 天全勤</span>
    </div>
    <div className="heat-scroll" ref={scroll}>
      <div className="heat-body" style={{ gridTemplateColumns: '24px repeat(' + columns + ', minmax(9px, 1fr))' }}>
        {rows.map((row, index) => {
          if (!row.date.endsWith('-01')) return null;
          return <span key={row.date} className="heat-month" style={{ gridColumn: Math.floor((index + firstSlot) / 7) + 2, gridRow: 1 }}>
            {Number(row.date.slice(5, 7))}月
          </span>;
        })}
        {[0, 2, 4].map(row => <span className="heat-weekday" key={row} aria-hidden="true" style={{ gridColumn: 1, gridRow: row + 2 }}>
          {weekdays[(row + (data.settings.weekStartsOn === 'monday' ? 1 : 0)) % 7]}
        </span>)}
        {rows.map((row, index) => {
          const slot = index + firstSlot;
          const spoken = dateLabel(row.date, dated) + '，' + describeDay(row, today);
          return <button type="button" key={row.date} className="heat-cell" data-level={heatLevel(row, today)}
            aria-label={spoken} aria-pressed={row.date === selected} data-today={row.date === today}
            style={{ gridColumn: Math.floor(slot / 7) + 2, gridRow: slot % 7 + 2 }} tabIndex={row.date === tabDay ? 0 : -1}
            ref={element => { if (element) refs.current.set(row.date, element); else refs.current.delete(row.date); }}
            onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(row.date); }}
            onPointerLeave={() => setHovered('')} onFocus={() => { setFocused(row.date); setHovered(row.date); }}
            onBlur={() => setHovered('')} onClick={() => setSelected(value => value === row.date ? '' : row.date)}
            onKeyDown={event => move(event, row.date)} />;
        })}
      </div>
    </div>
    <footer className="heat-footer">
      <div className="heat-view" aria-live="polite">
        {viewed ? <><span>{dateLabel(viewed.date, short)} · {describeDay(viewed, today)}</span>
          {selected === viewed.date && <Link to={'/calendar?date=' + viewed.date}>查看日历</Link>}</>
          : <span>选中日期查看详情</span>}
      </div>
      <div className="heat-legend" aria-label="图例">
        <span title="无计划"><i data-level={levels[0]} />无计划</span>
        <span title="计划未完成"><i data-level={levels[1]} />未完成</span>
        <span title="完成率从低到高" className="heat-legend-scale">{levels.slice(2, 7).map(level => <i key={level} data-level={level} />)}全勤</span>
        <span title="未来日期"><i data-level={levels[7]} />未来</span>
      </div>
    </footer>
  </section>;
}
