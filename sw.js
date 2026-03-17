/**
 * Service Worker — enables PWA installability + basic offline caching
 * Static assets are cached on install; API calls always go to the network.
 */
const CACHE_NAME = 'mm-picks-v2';
const STATIC_ASSETS = ['/', '/style.css', '/app.js', '/Joe.png'];

// Cache static assets on install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Remove old caches when a new version activates
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Serve static assets from cache; always fetch API calls from network
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return; // never cache API

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
