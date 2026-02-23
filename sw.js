// sw.js
const CACHE_VERSION = 'ravito-denik-v2';
const OFFLINE_URL = '/Denik/offline.html';
const PRECACHE_URLS = [
  '/Denik/',
  '/Denik/index.html',
  '/Denik/styles.css',
  '/Denik/app.js',
  '/Denik/db.js',
  '/Denik/ui.js',
  '/Denik/offline.html',
  '/Denik/manifest.webmanifest',
  '/Denik/assets/icons/icon-192.png',
  '/Denik/assets/icons/icon-512.png',
  '/Denik/assets/icons/maskable-192.png',
  '/Denik/assets/icons/maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(PRECACHE_URLS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_VERSION ? caches.delete(k) : null)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;

    try {
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type === 'basic') cache.put(req, fresh.clone());
      return fresh;
    } catch {
      if (req.mode === 'navigate') {
        const offline = await cache.match(OFFLINE_URL);
        return offline || new Response('Offline', { status: 503 });
      }
      return new Response('', { status: 503 });
    }
  })());
});
