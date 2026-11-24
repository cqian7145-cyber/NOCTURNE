import { useEffect, useRef, useState } from 'react';
import { Command, Search } from 'lucide-react';
import { useNavigate } from 'react-router';
import { repository } from '../core/repository';
import { useJournal } from '../app/journal';
import { useHabitEditor } from './habits';
import { Dialog, Field } from './primitives';

type Action = { label: string; detail: string; run: () => void };

export function CommandCenter({ pages }: { pages: readonly { path: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) requestAnimationFrame(() => search.current?.focus()); }, [open]);
  const { data, stats, today, reduced, toggle, commit } = useJournal();
  const edit = useHabitEditor();
  const navigate = useNavigate();
  function show() { setQuery(''); setIndex(0); setOpen(true); }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 'k' || event.repeat) return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault(); show();
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const actions: Action[] = [
    { label: '新建习惯', detail: '行动', run: () => edit() },
    { label: '新建目标', detail: '行动', run: () => navigate('/goals?create=1') },
    { label: '开始专注', detail: '计时', run: () => navigate('/focus') },
    { label: '快速启动 25 分钟专注', detail: '计时', run: () => {
      if (!data.timer) void commit(() => repository.startTimer('focus', 25));
      navigate('/focus');
    } },
    { label: '开始周复盘', detail: '回顾', run: () => navigate('/reviews') },
    ...stats.due(today).filter(habit => !stats.findEntry(habit.id, today)?.completed).map(habit => ({
      label: '打卡 ' + habit.name, detail: habit.measurement ? '填写数量' : '今日',
      run: () => habit.measurement
        ? navigate('/?habit=' + habit.id)
        : void toggle(habit, today, false),
    })),
    ...pages.map(page => ({ label: page.label, detail: '页面', run: () => navigate(page.path) })),
    ...data.goals.map(goal => ({ label: goal.title, detail: '目标', run: () => navigate('/goals?goal=' + goal.id) })),
  ];
  const visible = actions.filter(item => (item.label + item.detail).toLowerCase().includes(query.trim().toLowerCase())).slice(0, 18);
  function activate(action?: Action) {
    if (!action) return;
    setOpen(false);
    action.run();
  }
  return <>
    <button type="button" className="button ghost command-trigger" aria-label="打开命令中心" onClick={show}><Command size={16} /><kbd>Ctrl K</kbd></button>
    {open && <Dialog title="命令中心" reduced={reduced} onClose={() => setOpen(false)}>
      <div className="dialog-body command-dialog">
        <Field label="搜索操作、习惯或目标">
          <input ref={search} value={query} placeholder="输入关键词" onChange={event => { setQuery(event.target.value); setIndex(0); }}
            onKeyDown={event => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setIndex(value => Math.min(Math.max(0, visible.length - 1), Math.max(0, value + (event.key === 'ArrowDown' ? 1 : -1))));
              }
              if (event.key === 'Enter') { event.preventDefault(); activate(visible[index]); }
            }} />
        </Field>
        {visible.length ? <ul className="command-list">{visible.map((item, i) => <li key={item.detail + item.label + i}>
          <button type="button" data-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => activate(item)}>
            <Search size={15} /><span>{item.label}</span><small>{item.detail}</small>
          </button>
        </li>)}</ul> : <p className="field-note">没有匹配的操作或记录。</p>}
      </div>
    </Dialog>}
  </>;
}
