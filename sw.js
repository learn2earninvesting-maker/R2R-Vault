/* R2R Vault service worker — offline app shell + CDN caching.
   Bump CACHE when you change the app so clients update. */
const CACHE = 'r2r-vault-v2';

/* Same-origin files to precache. '.' covers whatever the host serves as the
   document (index.html or r2r-vault.html). Missing files fail silently. */
const CORE = [
  '.', 'index.html', 'r2r-vault.html',
  'manifest.webmanifest', 'icon.svg',
  'icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'icon-180.png'
];

/* Cross-origin CDN hosts we want available offline after first load. */
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(CORE.map(u => c.add(u)));
    // Do NOT skipWaiting here: let the page prompt the user to reload.
  })());
});

// Page asks us to activate the freshly-installed worker.
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // never touch POST etc.
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isCDN = CDN_HOSTS.includes(url.hostname);

  // Anything else (e.g. Yahoo Finance price API) → let the browser handle it.
  if (!sameOrigin && !isCDN) return;

  if (sameOrigin && req.mode === 'navigate') {
    // App document: network-first so updates land, fall back to cache offline.
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(CACHE); c.put(req, net.clone());
        return net;
      } catch {
        return (await caches.match(req)) || (await caches.match('index.html'))
            || (await caches.match('r2r-vault.html')) || (await caches.match('.'))
            || Response.error();
      }
    })());
    return;
  }

  // Static assets + CDN: cache-first, then network (and cache the result).
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const net = await fetch(req);
      if (net && net.status === 200) { const c = await caches.open(CACHE); c.put(req, net.clone()); }
      return net;
    } catch {
      return cached || Response.error();
    }
  })());
});
