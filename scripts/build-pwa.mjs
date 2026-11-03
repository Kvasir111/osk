import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, relative, sep } from 'node:path'

export async function buildPwa(directory) {
  const root = resolve(directory)
  const files = []
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = resolve(folder, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if ((entry.name === 'robots.txt' || /\.(?:html|js|css|png|svg|ico|webp|woff2?|webmanifest)$/.test(entry.name) || (entry.name.endsWith('.json') && relative(root, path).split(sep).join('/').startsWith('_nuxt/builds/'))) && entry.name !== 'sw.js') files.push(path)
    }
  }
  await walk(root)
  // Nuxt's explicitly prerendered root is a public shell, with no user session data.
  if (!files.includes(resolve(root, 'index.html'))) throw new Error('PWA build requires a prerendered index.html shell.')
  files.sort()
  const hash = createHash('sha256')
  const urls = []
  for (const file of files) {
    const url = '/' + relative(root, file).split(sep).join('/')
    hash.update(url).update(await readFile(file)); urls.push(url)
  }
  const cache = `osk-shell-${hash.digest('hex').slice(0, 20)}`
  const worker = `// Generated from this build's public assets. Never cache APIs or session requests.
const CACHE = ${JSON.stringify(cache)};
const ASSETS = ${JSON.stringify(urls)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, {cache:'reload', credentials:'omit'})))));
});
async function pruneShellCaches(ignoredClients = []) {
  const windows = await self.clients.matchAll({type:'window', includeUncontrolled:true});
  if(windows.some(client => !ignoredClients.includes(client.id))) return;
  const keys = await caches.keys();
  // CacheStorage preserves creation order. Never delete a newer cache being installed by a waiting worker.
  const current = keys.indexOf(CACHE);
  if(current < 0) return;
  await Promise.all(keys.slice(0, current).filter(key => key.startsWith('osk-shell-')).map(key => caches.delete(key)));
}
self.addEventListener('activate', event => {
  // Other tabs may still use old chunks or have unfinished forms. Retain their shell assets.
  event.waitUntil(pruneShellCaches().then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if(event.data?.type === 'OSK_ACTIVATE_UPDATE' && event.source?.url && new URL(event.source.url).origin === self.location.origin) event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if(request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('authorization') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;
  if(request.mode === 'navigate' && !/\\.[^/]+$/.test(url.pathname)) {
    // A full navigation replacing the last app window can retire old public shells safely.
    event.waitUntil(pruneShellCaches([event.replacesClientId, event.resultingClientId].filter(Boolean)));
    event.respondWith(caches.open(CACHE).then(cache => cache.match('/index.html')).then(response => response || fetch(request)));
  } else if(ASSETS.includes(url.pathname) || url.pathname.startsWith('/_nuxt/')) {
    event.respondWith((async () => {
      const current = await caches.open(CACHE).then(cache => cache.match(url.pathname));
      if(current) return current;
      if(url.pathname.startsWith('/_nuxt/')) {
        for(const key of await caches.keys()) {
          if(!key.startsWith('osk-shell-') || key === CACHE) continue;
          const old = await caches.open(key).then(cache => cache.match(url.pathname));
          if(old) return old;
        }
      }
      return fetch(request);
    })());
  }
});
`
  await writeFile(resolve(root, 'sw.js'), worker)
  console.log(`PWA: ${urls.length} public assets prepared for offline use (${cache}).`)
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  await buildPwa(process.argv[2] || (process.env.NITRO_PRESET === 'netlify' ? 'dist' : '.output/public'))
}
