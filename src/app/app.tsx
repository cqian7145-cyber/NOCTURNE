import { CommandCenter } from '../ui/command';
import { repository } from '../core/repository';
import { timerRunning } from '../core/focus';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BarChart3, CalendarDays, Ellipsis, FileText, LayoutGrid, Settings, Target, Timer, Layers3, BookOpen, PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { modes } from '../core/model';
import { Dashboard } from '../pages/dashboard';
import { HabitEditorProvider } from '../ui/habits';
import { Dialog, ease, timing } from '../ui/primitives';
import { JournalProvider, timerLabel, useJournal, useNow } from './journal';

const Analytics = lazy(() => import('../pages/analytics').then(module => ({ default: module.Analytics })));
const Calendar = lazy(() => import('../pages/calendar').then(module => ({ default: module.Calendar })));
const Focus = lazy(() => import('../pages/focus').then(module => ({ default: module.Focus })));
const Goals = lazy(() => import('../pages/goals').then(module => ({ default: module.Goals })));
const Reviews = lazy(() => import('../pages/reviews').then(module => ({ default: module.Reviews })));
const SettingsPage = lazy(() => import('../pages/settings').then(module => ({ default: module.SettingsPage })));
const Domains = lazy(() => import('../pages/domains').then(module => ({ default: module.Domains })));
const Chronicle = lazy(() => import('../pages/chronicle').then(module => ({ default: module.Chronicle })));
const pages: { path: string; label: string; short: string; icon: LucideIcon; Component: React.ComponentType; mobile?: boolean }[] = [
  { path: '/', label: '今日总览', short: '今日', icon: LayoutGrid, Component: Dashboard, mobile: true },
  { path: '/calendar', label: '日历', short: '日历', icon: CalendarDays, Component: Calendar, mobile: true },
  { path: '/analytics', label: '数据洞察', short: '洞察', icon: BarChart3, Component: Analytics, mobile: true },
  { path: '/domains', label: '人生领域', short: '领域', icon: Layers3, Component: Domains },
  { path: '/chronicle', label: '成长编年史', short: '编年史', icon: BookOpen, Component: Chronicle },
  { path: '/goals', label: '目标', short: '目标', icon: Target, Component: Goals },
  { path: '/focus', label: '专注', short: '专注', icon: Timer, Component: Focus, mobile: true },
  { path: '/reviews', label: '复盘', short: '复盘', icon: FileText, Component: Reviews },
  { path: '/settings', label: '设置', short: '设置', icon: Settings, Component: SettingsPage },
];

function Brand() {
  return <Link to="/" className="brand" aria-label="NOCTURNE 今日总览">
    <span className="brand-mark" aria-hidden><img src={import.meta.env.BASE_URL + 'icon.svg'} alt="" /></span>
    <span className="brand-type">NOCTURNE<span>个人成长控制台</span></span>
  </Link>;
}

function SidebarStatus() {
  const { data } = useJournal();
  const timer = data.timer;
  const now = useNow(timerRunning(timer));
  return timer ? <Link to="/focus" className="sidebar-status running">
    <span className="status-dot" /><span>{modes[timer.mode]}{!timerRunning(timer) && '已暂停'}</span><strong>{timerLabel(timer, now)}</strong>
  </Link> : <div className="sidebar-status"><span className="status-dot" />数据保存在此设备</div>;
}

function Sidebar() {
  const { data, commit, reduced } = useJournal();
  const compact = data.settings.compactNav;
  const Collapse = compact ? PanelLeftOpen : PanelLeftClose;
  return <aside className="sidebar">
    <Brand />
    <nav aria-label="主导航" className="desktop-nav">
      {pages.map(({ path, label, icon: Icon }) => <NavLink to={path} key={path} end className="nav-link" aria-label={label} title={label}>
        {({ isActive }) => <>
          {isActive && <motion.span className="nav-active" layoutId={reduced ? undefined : 'active-nav'}
            transition={{ duration: reduced ? 0 : timing.normal, ease }} aria-hidden />}
          <Icon size={18} strokeWidth={1.65} aria-hidden /><span>{label}</span>
        </>}
      </NavLink>)}
    </nav>
    <button type="button" className="button ghost sidebar-collapse" aria-label={compact ? '展开侧边栏' : '收起侧边栏'} onClick={() => {
      void commit(() => repository.saveSettings({ ...data.settings, compactNav: !compact }));
    }}><Collapse size={17} /><span>{compact ? '展开' : '收起侧边栏'}</span></button>
    <SidebarStatus />
  </aside>;
}

function MobileNavigation() {
  const { reduced, data } = useJournal();
  const location = useLocation();
  const [more, setMore] = useState(false);
  const moreActive = pages.some(page => page.path === location.pathname && !page.mobile);
  return <>
    <nav className="mobile-nav" aria-label="移动导航">
      {pages.filter(page => page.mobile).map(({ path, short, icon: Icon }) => <NavLink to={path} key={path} end className="mobile-link">
        <span className="mobile-glyph"><Icon size={19} strokeWidth={1.7} aria-hidden />{path === '/focus' && data.timer && <i className="status-dot" />}</span>
        <span>{short}</span>
      </NavLink>)}
      <button type="button" className="mobile-link mobile-more" data-active={moreActive} aria-expanded={more}
        aria-haspopup="dialog" onClick={() => setMore(true)}>
        <span className="mobile-glyph"><Ellipsis size={20} aria-hidden /></span><span>更多</span>
      </button>
    </nav>
    {more && <Dialog title="更多页面" sheet reduced={reduced} onClose={() => setMore(false)}>
      <nav aria-label="更多导航" className="dialog-body mobile-menu">
        {pages.filter(page => !page.mobile).map(({ path, label, icon: Icon }) => <NavLink to={path} key={path} className="nav-link" onClick={() => setMore(false)}>
          <Icon size={18} aria-hidden />{label}
        </NavLink>)}
      </nav>
    </Dialog>}
  </>;
}

function Shell() {
  const location = useLocation();
  const { data, reduced } = useJournal();
  const main = useRef<HTMLElement>(null);
  const previous = useRef(location.pathname);

  useEffect(() => {
    const page = pages.find(page => page.path === location.pathname);
    document.title = page ? page.label + ' · NOCTURNE' : 'NOCTURNE · 个人成长控制台';
    if (previous.current !== location.pathname) {
      previous.current = location.pathname;
      window.scrollTo({ top: 0, behavior: 'instant' });
      main.current?.focus({ preventScroll: true });
    }
  }, [location.pathname]);

  return <>
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); main.current?.focus(); }}>跳到主要内容</a>
    <div className="layout" data-compact={!!data.settings.compactNav}>
      <Sidebar />
      <header className="mobile-brand"><Brand /></header>
      <main className="main" ref={main} id="main" tabIndex={-1}>
        <CommandCenter pages={pages} />
        <AnimatePresence initial={false} mode="wait">
          <motion.div className="route" key={location.pathname}
            initial={reduced ? false : { opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -3, transition: { duration: timing.quick } }}
            transition={{ duration: reduced ? 0 : timing.normal, ease }}>
            <Suspense fallback={<div className="panel" role="status">正在打开页面…</div>}><Routes location={location}>
              {pages.map(({ path, Component }) => <Route key={path} path={path} element={<Component />} />)}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes></Suspense>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
    <MobileNavigation />
  </>;
}

export function App() {
  return <JournalProvider><HabitEditorProvider><Shell /></HabitEditorProvider></JournalProvider>;
}
