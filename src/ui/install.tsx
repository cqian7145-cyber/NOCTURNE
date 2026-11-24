import { useSyncExternalStore } from 'react';
import { Download } from 'lucide-react';
import { PanelHeading } from './primitives';

type InstallEvent = Event & { prompt: () => Promise<{ outcome: 'accepted' | 'dismissed' }> };
let invitation: InstallEvent | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
function refresh() { listeners.forEach(listener => listener()); }

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  invitation = event as InstallEvent;
  refresh();
});
window.addEventListener('appinstalled', () => { invitation = undefined; refresh(); });

export function InstallPanel() {
  const ready = useSyncExternalStore(subscribe, () => !!invitation);
  const installed = window.matchMedia('(display-mode: standalone)').matches;
  return <section className="panel">
    <PanelHeading title="安装与离线" detail={installed ? '当前以独立应用运行。' : '首次缓存完成后，可以离线重新打开。'} />
    {ready ? <button className="button primary" onClick={async () => {
      const request = invitation;
      invitation = undefined;
      refresh();
      await request?.prompt();
    }}><Download size={16} />安装 NOCTURNE</button>
      : !installed && <p className="field-note">使用浏览器的「安装应用」菜单。iPhone 或 iPad 可通过 Safari 的分享菜单「添加到主屏幕」。</p>}
  </section>;
}
