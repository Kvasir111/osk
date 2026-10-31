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
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('osk-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if(request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('authorization') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;
  if(request.mode === 'navigate' && !/\\.[^/]+$/.test(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match('/index.html')).then(response => response || fetch(request)));
  } else if(ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(response => response || fetch(request)));
  }
});
`
  await writeFile(resolve(root, 'sw.js'), worker)
  console.log(`PWA: ${urls.length} public assets prepared for offline use (${cache}).`)
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  await buildPwa(process.argv[2] || (process.env.NITRO_PRESET === 'netlify' ? 'dist' : '.output/public'))
}
