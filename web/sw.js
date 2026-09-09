/* Service Worker：静态资源网络优先（保持新鲜）、离线走预缓存；/api 永远走网络 */
const CACHE = 'health-log-v14';
const ASSETS = [
  '/',
  '/css/app.css',
  '/js/main.js',
  '/js/ui.js',
  '/js/api.js',
  '/js/store.js',
  '/js/ai.js',
  '/js/charts.js',
  '/js/nav.js',
  '/js/views/today.js',
  '/js/views/meals.js',
  '/js/views/workout.js',
  '/js/views/sleep.js',
  '/js/views/supps.js',
  '/js/views/trends.js',
  '/js/views/settings.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if(e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  // no-cache：每次都向服务器重新验证，应用更新后立即生效
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        const cp = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, cp));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then(r => r || new Response('离线且无缓存', { status: 504, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })))
  );
});
