import {parseFull,type FullBackup} from '../core/memoria/exchange';
import { decryptBackup, encryptBackup, isEncrypted } from '../core/encryption';
import { InstallPanel } from '../ui/install';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Archive, ArrowDown, ArrowUp, Bell, Download, HardDrive, Pencil, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { notificationPermission, useJournal } from '../app/journal';
import { systemZone } from '../core/dates';
import { type Habit, type Settings } from '../core/model';
import { repository } from '../core/repository';
import { frequencyLabel, HabitIcon, useHabitEditor } from '../ui/habits';
import { Dialog, Empty, Field, IconButton, PageHeading, PanelHeading } from '../ui/primitives';

function HabitManagement({ exportData }: { exportData: () => Promise<void> }) {
  const { stats, today, reduced, commit, notify } = useJournal();
  const editHabit = useHabitEditor();
  const [deleting, setDeleting] = useState<Habit>();
  const [busy, setBusy] = useState(false);
  const active = stats.habits.filter(habit => !habit.archivedAt);
  const archived = stats.habits.filter(habit => habit.archivedAt);

  async function archive(habit: Habit) {
    const willArchive = !habit.archivedAt;
    if (await commit(() => repository.archive(habit.id, willArchive))) {
      notify(willArchive ? '已归档，明天起停止排入计划。' : '习惯已恢复。', 'success', {
        label: '撤销', run: () => { void commit(() => repository.archive(habit.id, !willArchive), '已撤销变更。'); },
      });
    }
  }

  function rows(habits: Habit[], isArchived: boolean) {
    return <ul className="manage-list">
      {habits.map((habit, index) => <li className="manage-row" key={habit.id}>
        <HabitIcon habit={habit} />
        <div className="habit-copy"><strong className="habit-name">{habit.name}</strong>
          <span className="habit-meta">{habit.category} · {frequencyLabel(habit)}
            {habit.reminderEnabled && ' · ' + habit.reminderTime + ' 提醒'}</span>
        </div>
        <div className="manage-actions">
          {!isArchived && <>
            <IconButton label={'上移 ' + habit.name} disabled={index === 0} onClick={() => { void commit(() => repository.move(habit.id, -1)); }}>
              <ArrowUp size={15} aria-hidden />
            </IconButton>
            <IconButton label={'下移 ' + habit.name} disabled={index === habits.length - 1} onClick={() => { void commit(() => repository.move(habit.id, 1)); }}>
              <ArrowDown size={15} aria-hidden />
            </IconButton>
          </>}
          {habit.pauses?.some(range => range.start <= today && today <= range.end) && <IconButton label={'结束暂停 ' + habit.name} onClick={() => { void commit(() => repository.resumeHabit(habit.id), '习惯已重新安排。'); }}><RotateCcw size={15} aria-hidden /></IconButton>}
          <IconButton label={'编辑 ' + habit.name} onClick={() => editHabit(habit)}><Pencil size={15} aria-hidden /></IconButton>
          <IconButton label={(isArchived ? '恢复 ' : '归档 ') + habit.name} onClick={() => { void archive(habit); }}>
            {isArchived ? <RotateCcw size={15} aria-hidden /> : <Archive size={15} aria-hidden />}
          </IconButton>
          <IconButton label={'删除 ' + habit.name} onClick={() => setDeleting(habit)}><Trash2 size={15} aria-hidden /></IconButton>
        </div>
      </li>)}
    </ul>;
  }

  return <section id="habits" className="panel">
    <PanelHeading title="习惯管理" detail="调整顺序、编辑计划频率或归档。"
      action={<button type="button" className="button secondary" onClick={() => editHabit()}><Plus size={16} aria-hidden />新建习惯</button>} />
    {active.length ? rows(active, false) : <Empty title="没有进行中的习惯" />}
    {archived.length ? <div className="archived-habits"><h3>已归档</h3>{rows(archived, true)}</div> : null}
    {deleting && <Dialog title="永久删除习惯" busy={busy} reduced={reduced} onClose={() => setDeleting(undefined)}>
      <div className="dialog-body">
        <p>「{deleting.name}」及其打卡记录将被删除。目标将解除关联，失去所有关联的目标会一并删除。已完成的专注会话会保留。</p>
        <button type="button" className="text-button" disabled={busy} onClick={() => { void exportData(); }}>先导出备份</button>
        <footer className="dialog-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={() => setDeleting(undefined)}>取消</button>
          <button type="button" className="button danger" disabled={busy} onClick={async () => {
            setBusy(true);
            if (await commit(() => repository.deleteHabit(deleting.id), '习惯已删除。')) setDeleting(undefined);
            setBusy(false);
          }}>永久删除</button>
        </footer>
      </div>
    </Dialog>}
  </section>;
}

const timeZones = [...new Set(['Asia/Shanghai', 'UTC', systemZone(), ...(Intl.supportedValuesOf?.('timeZone') ?? [])])];
const permissionHelp = {
  unsupported: '当前环境不支持浏览器通知，仍可使用应用内提醒。',
  denied: '浏览器已拒绝通知。可以在站点权限设置中修改。',
  default: '授权后，可以同时接收系统通知。',
  granted: '浏览器通知已授权。',
};

function Preferences() {
  const { data, commit, notify } = useJournal();
  const [draft, setDraft] = useState<Settings>();
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState(notificationPermission);
  const value = draft ?? data.settings;
  const changed = JSON.stringify(value) !== JSON.stringify(data.settings);

  useEffect(() => {
    const sync = () => setPermission(notificationPermission());
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, []);

  function set<K extends keyof Settings>(key: K, next: Settings[K]) {
    setDraft({ ...value, [key]: next });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await commit(() => repository.saveSettings({ ...value, zone: value.zone.trim() }), '设置已保存。');
    setBusy(false);
  }

  async function askPermission() {
    if (notificationPermission() !== 'default') return;
    try { setPermission(await Notification.requestPermission()); } catch {
      notify('浏览器暂时无法请求通知权限。', 'error');
    }
  }

  return <section className="panel">
    <PanelHeading title="偏好与提醒" />
    <form className="settings-form" onSubmit={save}>
      <div className="form-grid">
        <Field label="时区" hint="决定日期切换与提醒时间">
          <input list="time-zones" required maxLength={100} value={value.zone} onChange={event => set('zone', event.target.value)} />
          <datalist id="time-zones">{timeZones.map(zone => <option value={zone} key={zone} />)}</datalist>
        </Field>
        <Field label="每周起始日"><select value={value.weekStartsOn} onChange={event => set('weekStartsOn', event.target.value as Settings['weekStartsOn'])}>
          <option value="monday">星期一</option><option value="sunday">星期日</option>
        </select></Field>
      </div>
      <Field label="界面主题"><select value={value.theme ?? 'antique'} onChange={event => set('theme', event.target.value as Settings['theme'])}>
        <option value="antique">Gothic 古铜</option><option value="blue">午夜蓝</option><option value="ink">墨黑</option>
      </select></Field>
      <label className="check-field"><input type="checkbox" checked={value.reducedMotion}
        onChange={event => set('reducedMotion', event.target.checked)} />减少动效</label>
      <label className="check-field"><input type="checkbox" checked={value.reminders}
        onChange={event => set('reminders', event.target.checked)} />启用习惯提醒</label>
      <div className="reminder-info">
        <Bell size={18} aria-hidden />
        <div><strong>应用打开时提醒</strong>
          <p>编辑习惯即可设置提醒时间。页面打开，同时还有未完成计划时提醒。关闭页面后暂停提醒。</p>
          <p>{permissionHelp[permission]}</p>
          {permission === 'default' && <button type="button" className="text-button" onClick={() => { void askPermission(); }}>启用浏览器通知</button>}
        </div>
      </div>
      <div className="inline-actions"><button type="submit" className="button primary" disabled={!changed || busy}>{busy ? '保存中…' : '保存偏好'}</button></div>
    </form>
  </section>;
}

function Backup({ exportData }: { exportData: (password?: string) => Promise<void> }) {
  const { commit, notify, reduced } = useJournal();
  const [incoming, setIncoming] = useState<{ name: string; snapshot: FullBackup }>();
  const [historyChoice,setHistoryChoice]=useState<'local'|'incoming'>();
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [confirmation, setConfirmation] = useState<'replace' | 'clear'>();
  const [word, setWord] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [encrypted, setEncrypted] = useState<{ name: string; text: string }>();
  const [encrypting, setEncrypting] = useState(false);
  const [password, setPassword] = useState('');

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setReading(true);
    setIncoming(undefined);
    setMode('merge');
    try {
      if (file.size > 108_000_000) throw new Error('备份文件过大。');
      const text = await file.text();
      setError(''); setPassword('');
      if (isEncrypted(text)) setEncrypted({ name: file.name, text });
      else setIncoming({ name: file.name, snapshot: parseFull(text) });
    } catch (error) {
      notify(error instanceof Error ? error.message : '无法读取备份。', 'error');
    } finally {
      setReading(false);
    }
  }

  async function restore() {
    if (!incoming) return;
    setBusy(true);
    setError('');
    if (await commit(() => repository.restore(incoming.snapshot, mode, historyChoice), '备份已恢复。', setError)) {
      setIncoming(undefined);
      setConfirmation(undefined);
    }
    setBusy(false);
  }

  async function clear() {
    if (word.trim() !== '清空') return;
    setBusy(true);
    setError('');
    if (await commit(repository.clear, '本地数据已清空。', setError)) {
      setConfirmation(undefined);
      setIncoming(undefined);
    }
    setBusy(false);
  }

  return <section className="panel backup-panel">
    <PanelHeading title="数据备份" detail="清理浏览器站点数据可能移除记录。导出 JSON 可在另一台设备恢复。" />
    <div className="inline-actions">
      <button type="button" className="button secondary" onClick={() => { void exportData(); }}><Download size={17} aria-hidden />导出备份</button>
      <button type="button" className="button secondary" onClick={() => { setPassword(''); setError(''); setEncrypting(true); }}>导出加密备份</button>
      <label className="button secondary file-button">
        <Upload size={17} aria-hidden />{reading ? '读取中…' : '导入备份'}
        <input type="file" aria-label="选择 JSON 备份" accept=".json,application/json" onChange={readFile} disabled={reading || busy} />
      </label>
    </div>
    {incoming && <div className="import-preview">
      <h3>导入预览</h3>
      <p className="file-name">{incoming.name}</p>
      <dl className="import-counts">
        {([['习惯', 'habits'], ['打卡记录', 'entries'], ['目标', 'goals'], ['专注会话', 'sessions'], ['复盘', 'reviews']] as const)
          .map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{incoming.snapshot.journal[key].length}</dd></div>)}
      </dl>
      <fieldset className="pick-field">
        <legend>恢复方式</legend>
        <label className="check-field"><input type="radio" name="restore" checked={mode === 'merge'} onChange={() => setMode('merge')} />合并记录；学习历史分叉时需选择处理方式</label>
        <label className="check-field"><input type="radio" name="restore" checked={mode === 'replace'} onChange={() => setMode('replace')} />完全替换，包括偏好和计时状态</label>
      </fieldset>
<p>知识 {incoming.snapshot.memory.nodes.length} 条 · 卡片 {incoming.snapshot.memory.cards.length} 张 · 复习日志 {incoming.snapshot.memory.logs.length} 条 · 附件 {incoming.snapshot.memory.attachments.length} 个</p>
      <Field label="学习历史冲突策略"><select value={historyChoice??''} onChange={e=>setHistoryChoice(e.target.value as 'local'|'incoming')}><option value="">检测到分叉时停止导入</option><option value="local">保留本地卡片状态</option><option value="incoming">采用导入卡片状态</option></select></Field>
      {!confirmation && error && <p className="form-error" role="alert">{error}</p>}
      <div className="inline-actions">
        <button type="button" className="button primary" disabled={busy} onClick={() => {
          setError('');
          if (mode === 'replace') setConfirmation('replace'); else void restore();
        }}>{mode === 'replace' ? '继续替换' : '合并备份'}</button>
        <button type="button" className="button ghost" onClick={() => setIncoming(undefined)} disabled={busy}>取消导入</button>
      </div>
    </div>}
    <div className="data-danger">
      <div><HardDrive size={17} aria-hidden /><span>删除此浏览器中的记录和偏好</span></div>
      <button type="button" className="button danger-quiet" onClick={() => { setWord(''); setError(''); setConfirmation('clear'); }}>清空数据</button>
    </div>
    {(encrypting || encrypted) && <Dialog title={encrypting ? '导出加密备份' : '解密备份'} reduced={reduced} busy={busy}
      onClose={() => { setEncrypting(false); setEncrypted(undefined); setPassword(''); }}>
      <form className="dialog-body" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError('');
        try {
          if (encrypted) setIncoming({ name: encrypted.name, snapshot: parseFull(await decryptBackup(encrypted.text, password)) });
          else await exportData(password);
          setEncrypting(false); setEncrypted(undefined); setPassword('');
        } catch (cause) { setError(cause instanceof Error ? cause.message : '无法处理加密备份。'); }
        finally { setBusy(false); }
      }}>
        <Field label="备份密码" hint={encrypting ? '至少 12 个字符，恢复备份时需输入同一密码。' : undefined}>
          <input required type="password" minLength={encrypting ? 12 : 1} maxLength={256} value={password}
            autoComplete={encrypting ? 'new-password' : 'current-password'} onChange={event => setPassword(event.target.value)} />
        </Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="dialog-actions"><button type="submit" className="button primary" disabled={busy}>{encrypting ? '加密并下载' : '解密并预览'}</button></footer>
      </form>
    </Dialog>}
    {confirmation && <Dialog title={confirmation === 'replace' ? '替换本地记录' : '清空本地数据'} reduced={reduced} busy={busy}
      onClose={() => setConfirmation(undefined)}>
      <div className="dialog-body">
        {confirmation === 'replace' ? <p>当前习惯、打卡、知识、卡片、图片、复习、专注、目标及偏好会被所选备份替换。</p>
          : <Field label="输入「清空」确认" wide><input value={word} onChange={event => setWord(event.target.value)} /></Field>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="button" className="text-button" disabled={busy} onClick={() => { void exportData(); }}>先导出备份</button>
        <footer className="dialog-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={() => setConfirmation(undefined)}>取消</button>
          <button type="button" className="button danger" disabled={busy || (confirmation === 'clear' && word.trim() !== '清空')}
            onClick={() => { if (confirmation === 'replace') void restore(); else void clear(); }}>
            {confirmation === 'replace' ? '确认替换' : '确认清空'}
          </button>
        </footer>
      </div>
    </Dialog>}
  </section>;
}

export function SettingsPage() {
  const { data, notify, today } = useJournal();
  async function exportData(password?: string) {
    try {
      const plain = await repository.backup();
      const text = password ? await encryptBackup(plain, password) : plain;
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'NOCTURNE-' + today + (password ? '.encrypted.json' : '.json');
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      notify('备份已准备，可在浏览器下载中查看。');
    } catch (cause) { if (password) throw cause; notify('备份导出失败，请重试。', 'error'); }
  }
  return <>
    <PageHeading title="设置" description="管理计划、提醒与设备上的数据。" />
    <HabitManagement exportData={exportData} />
    <InstallPanel />
    <div className="settings-layout"><Preferences key={JSON.stringify(data.settings)} /><Backup exportData={exportData} /></div>
  </>;
}
