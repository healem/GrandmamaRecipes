/* Grandmama's Recipes service worker: app shell is precached, everything else is
   stale-while-revalidate so the site works offline and picks up updates on the next load. */
const VERSION = 'gr-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'vendor/minisearch.js', 'data/recipes.json', 'data/tips.json', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    return cached || (await network) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }));
});
