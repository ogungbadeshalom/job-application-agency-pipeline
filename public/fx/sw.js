/* Pitchr Currency Converter — Service Worker
 *
 * Strategy:
 *  - APP SHELL (html, manifest, icons): cache-first with network fallback.
 *    Once installed it opens instantly, even fully offline.
 *  - RATES (open.er-api.com): network-first, fall back to the last successful
 *    rates. So the converter always has numbers even without signal, and
 *    self-updates the moment a connection returns.
 *
 * Versioning: bump CACHE (or the SW file) to force installed devices to fetch
 * the new shell on next load.
 */
const CACHE = 'pitchr-fx-v4';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
const FX_ORIGIN = 'https://open.er-api.com';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Only ever manage FX paths — the SW must NOT touch /login, /api/auth, or
  // any app route. (Bug fix Oct 26: the old handler cached every same-origin
  // GET, which served stale auth responses and broke logins in browsers that
  // had installed the SW. New cache version forces the fix to every device.)
  if (!url.pathname.startsWith('/fx/') && url.origin !== FX_ORIGIN) return;

  // Live FX rates: network-first, stash each success, fall back to cache.
  if (url.origin === FX_ORIGIN) {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request).then((r) => r || Response.error()))
    );
    return;
  }

  // Everything same-origin (app shell): cache-first.
  if (e.request.method === 'GET') {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      }))
    );
  }
});