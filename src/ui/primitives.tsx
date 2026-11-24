import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, Check, CircleAlert, X, type LucideIcon } from 'lucide-react';

export const ease = [0.22, 1, 0.36, 1] as const;
export const timing = { quick: 0.12, normal: 0.24, slow: 0.42, page: 0.48 };

export function IconButton({ label, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" {...props} title={label} aria-label={label} className={'icon-button ' + (className ?? '')}>{children}</button>;
}

export function PageHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <header className="page-heading">
    <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {action}
  </header>;
}

export function PanelHeading({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <header className="panel-heading">
    <div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>
    {action}
  </header>;
}

export function Empty({ icon: Icon, title, children, action }: {
  icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode;
}) {
  return <div className="empty">
    {Icon && <span className="empty-icon"><Icon size={21} strokeWidth={1.5} aria-hidden /></span>}
    <p className="empty-title">{title}</p>
    {children && <p className="empty-description">{children}</p>}
    {action}
  </div>;
}

export function Field({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className={'field' + (wide ? ' field-wide' : '')}>
    <span>{label}</span>
    {children}
    {hint && <small>{hint}</small>}
  </label>;
}

export function Dialog({ title, children, onClose, busy, reduced, sheet, className = '' }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; reduced?: boolean; sheet?: boolean; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} data-reduced={Boolean(reduced)}
    className={'dialog ' + (sheet ? 'sheet ' : '') + className}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <motion.div className="dialog-inner"
      initial={reduced ? false : { opacity: 0, y: sheet ? 12 : 8, scale: sheet ? 1 : 0.982 }}
      animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: timing.normal, ease }}>
      <header className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <IconButton label="关闭" onClick={onClose} disabled={busy}><X size={19} aria-hidden /></IconButton>
      </header>
      {children}
    </motion.div>
  </dialog>;
}

export function Ring({ progress, reduced, children, className = '' }: {
  progress: number; reduced: boolean; children: ReactNode; className?: string;
}) {
  const id = useId();
  const length = 2 * Math.PI * 89;
  return <div className={'ring ' + className}>
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <linearGradient id={id} x2="1" y2="1" gradientUnits="objectBoundingBox">
          <stop stopColor="var(--ring-light, #e1e1ff)" /><stop offset="1" stopColor="var(--ring-dark, #8498e0)" />
        </linearGradient>
      </defs>
      <circle className="ring-track" cx="100" cy="100" r="89" fill="none" strokeWidth="3" />
      <motion.circle cx="100" cy="100" r="89" fill="none" strokeWidth="4"
        stroke={'url(#' + id + ')'} strokeLinecap="round" strokeDasharray={length}
        transform="rotate(-90 100 100)" initial={false}
        animate={{ strokeDashoffset: length * (1 - Math.min(100, Math.max(0, progress)) / 100) }}
        transition={{ duration: reduced ? 0 : timing.slow, ease }} />
    </svg>
    <div className="ring-content">{children}</div>
  </div>;
}

export type ToastData = { id: number; text: string; kind: 'success' | 'error' | 'reminder'; action?: { label: string; run: () => void } };

function ToastItem({ toast, dismiss, reduced }: {
  toast: ToastData; dismiss: (id: number) => void; reduced: boolean;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(() => dismiss(toast.id), toast.action || toast.kind !== 'success' ? 14_000 : 4800);
    return () => window.clearTimeout(timeout);
  }, [dismiss, toast]);
  const Icon = toast.kind === 'error' ? CircleAlert : toast.kind === 'reminder' ? Bell : Check;
  return <motion.div className="toast" data-kind={toast.kind} layout={!reduced}
    initial={reduced ? false : { opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }}
    exit={reduced ? undefined : { opacity: 0, y: 5 }} transition={{ duration: reduced ? 0 : timing.normal, ease }}>
    <Icon className="toast-icon" size={18} aria-hidden />
    <div className="toast-text" role={toast.kind === 'error' ? 'alert' : 'status'}>{toast.text}</div>
    {toast.action && <button type="button" className="text-button" onClick={() => {
      dismiss(toast.id); toast.action?.run();
    }}>{toast.action.label}</button>}
    <IconButton label="关闭消息" onClick={() => dismiss(toast.id)}><X size={16} aria-hidden /></IconButton>
  </motion.div>;
}

export function Toasts({ data, dismiss, reduced }: {
  data: ToastData[]; dismiss: (id: number) => void; reduced: boolean;
}) {
  return <div className="toast-stack"><AnimatePresence initial={false}>
    {data.map(item => <ToastItem key={item.id} toast={item} dismiss={dismiss} reduced={reduced} />)}
  </AnimatePresence></div>;
}
