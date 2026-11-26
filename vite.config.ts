import { defineConfig, type Plugin } from 'vite';

function offlineShell(): Plugin {
  return {
    name: 'nocturne-offline-shell',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const files = [...Object.keys(bundle).filter(file => file !== 'index.html'), 'icon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'index.html'].sort();
      const html = bundle['index.html'];
      const contents = files.join('\n') + (html?.type === 'asset' ? String(html.source) : '');
      let hash = 2166136261;
      for (let index = 0; index < contents.length; index++) {
        hash = Math.imul(hash ^ contents.charCodeAt(index), 16777619);
      }
      const source = 'const files = ' + JSON.stringify(files) + ';\nconst version = "' + (hash >>> 0).toString(16) + '";\n' + String.raw`
const scope = self.registration.scope;
const prefix = "nocturne-offline:" + scope + ":";
const key = prefix + version;
const urls = new Set(files.map(file => new URL(file, scope).href));
const index = new URL("index.html", scope).href;

self.addEventListener("install", event => {
  const requests = [...urls].map(url => new Request(url, { cache: "reload" }));
  event.waitUntil(caches.open(key).then(cache => cache.addAll(requests)));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const previous = (await caches.keys()).filter(name => name.startsWith(prefix) && name !== key);
    await Promise.all(previous.map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const absolute = url.origin + url.pathname;
  const navigation = request.mode === "navigate" && (absolute === scope || absolute === index);
  if (!navigation && !urls.has(request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(key);
    // Each URL here is an immutable, same-origin app resource. Navigation
    // and module requests can send different Origin headers than precaching.
    const found = await cache.match(navigation ? index : request.url, { ignoreVary: true });
    return found || fetch(request);
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(scope));
    if (existing) await existing.focus();
    else await self.clients.openWindow(scope);
  })());
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [offlineShell()],
  build: {
    rolldownOptions: {
      onLog(level, log, report) {
        // The browser-only build does not need the dependencies' React Server Component directives.
        if (log.code === 'MODULE_LEVEL_DIRECTIVE' && log.message.includes('"use client"')
          && /[\\/]node_modules[\\/](framer-motion|react-router)[\\/]/.test(log.id ?? log.message)) return;
        report(level, log);
      },
      output: {
        codeSplitting: {
          groups: [
            { name:'math',test:/[\\/]node_modules[\\/]katex[\\/]/ },
            { name:'markdown',test:/[\\/]node_modules[\\/](marked|highlight.js|dompurify)[\\/]/ },
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
            { name: 'motion', test: /[\\/]node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/ },
            { name: 'journal', test: /[\\/]node_modules[\\/](dexie|zod)[\\/]/ },
          ],
        },
      },
    },
  },
});
