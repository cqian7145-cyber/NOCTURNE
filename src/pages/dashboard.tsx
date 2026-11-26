import {MemoryDashboard} from '../ui/memory-integration';
import { useSearchParams } from 'react-router';
import { useState } from 'react';
import { isWork } from '../core/growth';
import { ArrowUpRight, CalendarDays, ChevronRight, CircleCheck, Flame, Plus, Timer, TrendingUp } from 'lucide-react';
import { Link } from 'react-router';
import { useJournal } from '../app/journal';
import { dateLabel, weekStart } from '../core/dates';
import { lastDays, pct, rate, summarize } from '../core/stats';
import { Heatmap, WeekChart } from '../ui/charts';
import { HabitRows, useHabitEditor } from '../ui/habits';
import { Empty, PanelHeading, Ring } from '../ui/primitives';

function greeting(time: string) {
  if (time < '11:00' && time >= '05:00') return '早上好';
  if (time < '14:00' && time >= '11:00') return '中午好';
  if (time < '18:00' && time >= '14:00') return '下午好';
  return '晚上好';
}

export function Dashboard() {
  const { data, stats, today, time, reduced } = useJournal();
  const openEditor = useHabitEditor();
  const daily = stats.daily(today);
  const [query, setQuery] = useSearchParams();
  const [routine, setRoutine] = useState('');
  const habits = stats.due(today).filter(habit => !routine || query.has('habit') || habit.routineId === routine);
  const week = summarize(stats.range(weekStart(today, data.settings.weekStartsOn), today));
  const recent = stats.range(lastDays(today, 7), today);
  const best = stats.habitPerformance(lastDays(today, 7), today).find(item => item.done > 0);
  const streak = stats.overall();
  const minutes = Math.round(data.sessions.filter(isWork)
    .reduce((total, session) => total + session.actualSeconds, 0) / 60);
  const todayRate = rate(daily);
  const welcome = !daily.planned ? (stats.due(today).length ? '今天可以执行本周的弹性习惯。' : '从一个愿意持续做的小动作开始。') : daily.done === daily.planned
    ? '今天的计划已全部完成。' : '今天还有 ' + (daily.planned - daily.done) + ' 项习惯等待打卡。';

  return <>
    <div className="dashboard-toolbar">
      <p>今日总览</p>
      <button type="button" className="button primary" onClick={() => openEditor()}><Plus size={17} aria-hidden />新建习惯</button>
    </div>
    <section className="hero" aria-label="今日进度">
      <div className="hero-copy">
        <div className="hero-date"><CalendarDays size={15} aria-hidden />{dateLabel(today, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</div>
        <h1 lang="en">Make today count<span>.</span></h1>
        <p>{greeting(time)}。{welcome}</p>
        <Link to="/focus" className="hero-link"><Timer size={16} aria-hidden />开始专注<ArrowUpRight size={14} aria-hidden /></Link>
      </div>
      <div className="hero-orbit">
        <Ring progress={todayRate ?? 0} reduced={reduced} className="today-ring">
          <span className="ring-kicker">今日完成</span>
          <span className="ring-number" aria-label={'今日完成 ' + daily.done + ' / ' + daily.planned + ' 项'}>{daily.done}<small> / {daily.planned}</small></span>
          <span className="ring-caption">{daily.planned ? pct(todayRate) : stats.due(today).length ? '弹性周计划' : '暂无计划'}</span>
        </Ring>
      </div>
    </section>

    <MemoryDashboard/>
    <dl className="dashboard-metrics">
      <div><dt><Flame size={16} aria-hidden />连续全勤</dt><dd>{streak.current} <small>天</small></dd></div>
      <div><dt><TrendingUp size={16} aria-hidden />本周完成率</dt><dd>{pct(week.rate)}</dd></div>
      <div><dt><Timer size={16} aria-hidden />累计专注</dt><dd>{minutes} <small>分钟</small></dd></div>
    </dl>

    <div className="dashboard-grid">
      <section className="panel habit-panel">
        <PanelHeading title="今日习惯" detail={daily.planned ? daily.done + ' / ' + daily.planned + ' 项已完成' : undefined}
          action={<Link to="/settings#habits" className="panel-link">管理习惯<ChevronRight size={16} aria-hidden /></Link>} />
        {data.routines.length > 0 && <div className="growth-choices"><button className="choice" aria-pressed={!routine} onClick={() => setRoutine('')}>全部</button>{data.routines.map(item => <button className="choice" key={item.id} aria-pressed={routine === item.id} onClick={() => setRoutine(item.id)}>{item.title}</button>)}</div>}
        {habits.length ? <HabitRows habits={habits} date={today} edit startRecord={query.get('habit') ?? undefined} closeRecord={() => setQuery({})} />
          : <Empty icon={CircleCheck} title={data.habits.length ? '今天没有安排' : '从一个习惯开始'}
            action={<button type="button" className="button secondary" onClick={() => openEditor()}><Plus size={15} aria-hidden />{data.habits.length ? '添加习惯' : '选择模板或自建'}</button>}>
            {data.habits.length ? '到日历查看接下来的计划。' : '英语、阅读、健身，选一件愿意每天做的事。'}
          </Empty>}
      </section>
      <section className="panel dashboard-chart">
        <PanelHeading title="近 7 天" detail={best ? '完成率最高 · ' + best.habit.name : '每日习惯完成率'}
          action={<Link to="/analytics" className="panel-link">查看洞察<ChevronRight size={16} aria-hidden /></Link>} />
        <WeekChart rows={recent} summarizeData={false} />
      </section>
    </div>
    <Heatmap />
  </>;
}
