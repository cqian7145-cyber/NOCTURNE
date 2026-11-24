import { useMemo, useState } from 'react';
import { clock, monthShift, monthStart, weekStart, addDays } from '../core/dates';
import { association, growthSummary } from '../core/growth';
import { grouped, rate, summarize } from '../core/stats';
import { useJournal } from '../app/journal';
import { Field, PanelHeading } from './primitives';

export function DeepInsights({ start, end }: { start: string; end: string }) {
  const { data, stats, today } = useJournal();
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const { areas, hours, minutes } = useMemo(() => growthSummary(data, stats, start, end), [data, stats, start, end]);
  const maximum = Math.max(...hours);
  const topHours = maximum ? hours.map((count, hour) => ({ count, hour })).filter(item => item.count === maximum) : [];
  const firstHabit = stats.habits.find(habit => habit.id === first);
  const secondHabit = stats.habits.find(habit => habit.id === second);
  const relation = firstHabit && secondHabit && firstHabit.id !== secondHabit.id ? association(stats, firstHabit, secondHabit, start, end) : null;
  const elapsed = Number(today.slice(8, 10));
  const month = monthStart(today);
  const priorMonth = monthShift(month, -1);
  const priorYear = monthShift(month, -12);
  function through(start: string) {
    const last = addDays(monthShift(start, 1), -1);
    const day = addDays(start, elapsed - 1);
    return day <= last ? day : last;
  }
  function comparison(other: string) {
    const now = summarize(stats.range(month, today)).rate;
    const previous = summarize(stats.range(other, through(other))).rate;
    if (now === null || previous === null) return '—';
    return new Intl.NumberFormat('zh-CN', { signDisplay: 'exceptZero', maximumFractionDigits: 1 }).format(now - previous) + ' pp';
  }
  const lastWeek = addDays(weekStart(today, data.settings.weekStartsOn), -1);
  const firstWeek = addDays(lastWeek, -27);
  const stability = stats.habits.map(habit => {
    const weeks = grouped(stats.range(firstWeek, lastWeek, [habit]), 'week', data.settings.weekStartsOn)
      .map(rate).filter(value => value !== null);
    const failures = stats.range(start, addDays(end, end === today ? -1 : 0), [habit]);
    let run = 0, longest = 0;
    for (const row of failures) {
      if (!row.planned) continue;
      run = row.done ? 0 : run + 1;
      longest = Math.max(longest, run);
    }
    const spread = weeks.length >= 2 ? Math.round(Math.max(...weeks) - Math.min(...weeks)) : null;
    return { habit, spread, longest };
  }).filter(row => row.spread !== null || row.longest > 0);
  return <>
    <div className="insights-grid">
      <section className="panel">
        <PanelHeading title="时间投入" detail="按会话结束时的本地日期统计。" />
        <dl className="growth-metrics"><div><dt>专注小时</dt><dd>{(minutes / 60).toFixed(1)}</dd></div>
          <div><dt>本月环比</dt><dd>{comparison(priorMonth)}</dd></div><div><dt>本月同比</dt><dd>{comparison(priorYear)}</dd></div></dl>
        <ul className="insight-rows">{areas.map(item => <li key={item.domain.id}>
          <span>{item.domain.title}</span><progress max={minutes || 1} value={item.minutes} aria-label={item.domain.title + '的专注分钟'} /><strong>{Math.round(item.minutes)} 分</strong>
        </li>)}</ul>
        <p className="field-note">比较本月至今与上月、去年同月同期。领域占比以全部专注时间为分母。</p>
      </section>
      <section className="panel">
        <PanelHeading title="常见执行时段" detail="按当天达标的记录统计，历史补卡不参与时段计算。" />
        <div className="hour-chart" aria-label="打卡时段分布">{hours.map((value, hour) => <span title={hour + ':00 · ' + value + ' 次'}
          aria-label={hour + ' 点完成 ' + value + ' 次'} key={hour} style={{ height: Math.max(3, value / (maximum || 1) * 100) + '%' }} />)}</div>
        <p className="field-note">{topHours.length ? '最常打卡 ' + topHours.map(item => item.hour + ':00').join('、') + ' · ' + maximum + ' 次' : '暂无可用时段。'} · {clock(data.settings.zone).date === today ? data.settings.zone : '所选时区'}</p>
      </section>
    </div>
    <div className="insights-grid">
      <section className="panel"><PanelHeading title="习惯稳定性" detail="近四个完整周的完成率波动，以及所选范围内最长连续缺做。" />
        {stability.length ? <ul className="insight-rows">{stability.map(row => <li key={row.habit.id}>
          <span>{row.habit.name}</span><span>{row.spread === null ? '周样本不足' : '波动 ' + row.spread + ' pp'}</span><strong>缺做 {row.longest} 次</strong>
        </li>)}</ul> : <p className="field-note">积累计划与打卡后查看稳定性。</p>}
      </section>
      <section className="panel"><PanelHeading title="习惯关联" detail="比较两项习惯在同时计入计划的日期内，达标状态如何一起变化。" />
        <div className="form-grid">
          <Field label="第一项习惯"><select value={first} onChange={event => setFirst(event.target.value)}><option value="">请选择</option>
            {stats.habits.map(habit => <option value={habit.id} key={habit.id}>{habit.name}</option>)}</select></Field>
          <Field label="第二项习惯"><select value={second} onChange={event => setSecond(event.target.value)}><option value="">请选择</option>
            {stats.habits.map(habit => <option value={habit.id} key={habit.id}>{habit.name}</option>)}</select></Field>
        </div>
        <p className="field-note">{relation ? '共同计划日 ' + relation.n + ' 天 · 关联强度 ' + (relation.value?.toFixed(2) ?? '样本不足或状态无变化') : '选择两项不同的习惯。'} 统计关系不代表因果。</p>
      </section>
    </div>
  </>;
}
