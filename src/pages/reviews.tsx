import { deepWork, period, reviewSummary } from '../core/growth';
import { useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, FileText, Minus, Target, TrendingDown, TrendingUp } from 'lucide-react';
import { useJournal } from '../app/journal';
import { addDays, asDate, dateLabel, minDay } from '../core/dates';
import type { Review } from '../core/model';
import { repository } from '../core/repository';
import { grouped, makeStats, pct, rate, streak, summarize } from '../core/stats';
import { WeekChart } from '../ui/charts';
import { Empty, Field, IconButton, PageHeading, PanelHeading } from '../ui/primitives';

const labels = {
  daily: ['今天做成了什么？', '今天遇到什么阻碍？', '明天先做哪一步？'],
  quarterly: ['本季度有什么进展？', '什么方向值得调整？', '下个季度关注什么？'],
  yearly: ['今年最重要的进展是什么？', '哪些习惯或目标值得改变？', '明年希望从哪里开始？'],
  weekly: ['这周做得最好的是什么？', '什么阻碍了执行？', '下周准备调整什么？'],
  monthly: ['这个月最值得保留的做法是什么？', '哪些计划需要调整？', '下个月想达成什么？'],
};

function Notes({ type, start, saved }: { type: Review['type']; start: string; saved?: Review }) {
  const { commit, data } = useJournal();
  const [draft, setDraft] = useState<Review['reflection']>();
  const [busy, setBusy] = useState(false);
  const reflection = draft ?? saved?.reflection ?? ['', '', ''];

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await commit(() => repository.saveReview(type, start, reflection), '复盘反思已保存。');
    setBusy(false);
  }

  const noChanges = saved?.reflection.every((value, index) => reflection[index] === value) ?? !reflection.some(value => value.trim());
  return <section className="panel">
    <PanelHeading title={type === 'monthly' ? '月度总结' : '个人反思'}
      detail={saved ? '更新于 ' + new Intl.DateTimeFormat('zh-CN', { timeZone: data.settings.zone,
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(saved.updatedAt)) : undefined} />
    <form onSubmit={save} className="reflection-form">
      {labels[type].map((label, index) => <Field key={label} label={label}>
        <textarea rows={3} maxLength={4000} value={reflection[index]}
          onChange={event => {
            const updated: Review['reflection'] = [...reflection];
            updated[index] = event.target.value;
            setDraft(updated);
          }} />
      </Field>)}
      <div className="inline-actions">
        <button type="submit" className="button primary" disabled={busy || noChanges}>{busy ? '保存中…' : '保存反思'}</button>
        {!noChanges && <span className="field-note">有未保存修改</span>}
      </div>
    </form>
  </section>;
}

export function Reviews() {
  const { data, stats, today } = useJournal();
  const [kind, setKind] = useState<Review['type']>('weekly');
  const [chosen, setChosen] = useState<string>();
  const weekly = kind === 'weekly';
  const current = period(kind, today, data.settings.weekStartsOn).start;
  const selected = period(kind, chosen ?? current, data.settings.weekStartsOn);
  const { start, end } = selected;
  const cutoff = minDay(today, end);
  const previous = selected.shift(-1);
  const elapsed = Math.round((+asDate(cutoff) - +asDate(start)) / 86_400_000);
  const previousEnd = minDay(addDays(previous, elapsed), period(kind, previous, data.settings.weekStartsOn).end);
  const minutes = deepWork(data, start, cutoff).reduce((total, session) => total + session.actualSeconds / 60, 0);
  const rows = stats.range(start, cutoff);
  const summary = summarize(rows);
  const prior = summarize(stats.range(previous, previousEnd));
  const difference = summary.rate !== null && prior.rate !== null ? Math.round((summary.rate - prior.rate) * 10) / 10 : null;
  const ranking = stats.habitPerformance(start, cutoff);
  const stable = ranking.find(item => item.done > 0);
  const saved = data.reviews.find(note => note.type === kind && note.periodKey === start);
  const recent = data.reviews.filter(note => note.type === kind).sort((a, b) => b.periodKey.localeCompare(a.periodKey)).slice(0, 6);
  const weeks = grouped(rows, 'week', data.settings.weekStartsOn);
  const bestWeek = [...weeks].filter(row => row.done).sort((a, b) => (rate(b) ?? 0) - (rate(a) ?? 0) || b.done - a.done)[0];
  const missed = rows.filter(row => row.date < today).reduce((total, row) => total + row.planned - row.done, 0);
  const currentStreak = streak(rows, today);
  const changeLabel = difference === null ? '暂无可比较的前期计划' : difference === 0 ? '与前一周期持平'
    : '较前一周期' + (difference > 0 ? '提高 ' : '下降 ') + Math.abs(difference) + ' 个百分点';
  const Direction = difference === null || difference === 0 ? Minus : difference > 0 ? TrendingUp : TrendingDown;
  const goals = weekly ? [] : data.goals.filter(goal => goal.startDate <= cutoff && (!goal.endDate || goal.endDate >= start));
  const monthStats = cutoff === today ? stats : makeStats(data, cutoff);

  function shift(direction: -1 | 1) {
    const next = selected.shift(direction);
    setChosen(next < current ? next : undefined);
  }

  return <>
    <PageHeading title="复盘" description="回顾做过的事，记下接下来要调整的事。" />
    <div className="filter-line">
      <div className="segmented" aria-label="复盘类型">
        <button type="button" aria-pressed={weekly} onClick={() => { setKind('weekly'); setChosen(undefined); }}>周报</button>
        <button type="button" aria-pressed={kind === 'monthly'} onClick={() => { setKind('monthly'); setChosen(undefined); }}>月报</button>
        {([['daily', '日报'], ['quarterly', '季报'], ['yearly', '年报']] as const).map(([key, label]) =>
          <button type="button" key={key} aria-pressed={kind === key} onClick={() => { setKind(key); setChosen(undefined); }}>{label}</button>)}
      </div>
      <div className="stepper review-stepper">
        <IconButton label={weekly ? '上一周' : kind === 'monthly' ? '上个月' : '上一周期'} onClick={() => shift(-1)} disabled={previous < '1900-01-01'}><ChevronLeft size={17} aria-hidden /></IconButton>
        <span className="range-caption">{dateLabel(start)} 至 {dateLabel(end)}</span>
        <IconButton label={weekly ? '下一周' : kind === 'monthly' ? '下个月' : '下一周期'} disabled={start >= current} onClick={() => shift(1)}><ChevronRight size={17} aria-hidden /></IconButton>
      </div>
    </div>
    <div className="review-layout">
      <div className="review-stack">
        <section className="panel review-report">
          <PanelHeading title={({ daily:'当日回顾', weekly:'本周回顾', monthly:'本月回顾', quarterly:'季度回顾', yearly:'年度回顾' })[kind]} detail={start === current ? '统计截至今天' : start + ' 至 ' + end} />
          <p className="field-note">{reviewSummary(stats, selected)} 本期专注 {Math.round(minutes)} 分钟。</p>
          {summary.planned ? <>
            <div className="report-numbers">
              <div><span>{pct(summary.rate)}</span><small>周期完成率</small></div>
              <div><span>{summary.done} <small>/ {summary.planned}</small></span><small>已完成 / 计划次数</small></div>
            </div>
            <div className="report-change" data-negative={difference !== null && difference < 0}>
              <Direction size={17} aria-hidden />{changeLabel}{cutoff < end && difference !== null && '（按同期天数）'}
            </div>
            <dl className="report-facts">
              <div><dt>最稳定习惯</dt><dd>{stable ? stable.habit.name + ' · ' + pct(stable.rate) : '—'}</dd></div>
              <div><dt>已过计划遗漏</dt><dd>{missed} 次</dd></div>
              <div><dt>周期最长全勤</dt><dd>{currentStreak.longest} 天</dd></div>
              {!weekly && <div><dt>表现最好的一周</dt><dd>{bestWeek ? dateLabel(bestWeek.date) + ' 起 · ' + pct(rate(bestWeek)) : '—'}</dd></div>}
            </dl>
            {!weekly && <WeekChart rows={weeks} unit="week" />}
          </> : <Empty icon={FileText} title="这个周期没有计划">可以先记下反思，打卡后再回来查看数据。</Empty>}
        </section>
        {!weekly && ranking.length > 0 && <section className="panel">
          <PanelHeading title="习惯完成排名" />
          <ol className="review-ranking">{ranking.map(item => <li key={item.habit.id}><span>{item.habit.name}</span><strong>{pct(item.rate)}</strong></li>)}</ol>
        </section>}
        {!weekly && <section className="panel">
          <PanelHeading title="月末目标进度" detail={start === current ? '截至今日' : '截至 ' + dateLabel(cutoff)} />
          {goals.length ? <ul className="review-goals">{goals.map(goal => {
            const progress = monthStats.goalProgress(goal);
            return <li key={goal.id}><Target size={16} aria-hidden /><span>{goal.title}</span><strong>{Math.round(progress.progress)}%</strong></li>;
          })}</ul> : <Empty title="本月没有关联目标" />}
        </section>}
      </div>
      <div className="review-stack">
        <Notes key={kind + start} type={kind} start={start} saved={saved} />
        {recent.length > 0 && <section className="panel">
          <PanelHeading title="已保存的复盘" />
          <div className="revision-list">
            {recent.map(note => <button type="button" key={note.periodKey} className="choice" aria-pressed={note.periodKey === start}
              onClick={() => setChosen(note.periodKey)}>{note.periodKey}</button>)}
          </div>
        </section>}
      </div>
    </div>
  </>;
}
