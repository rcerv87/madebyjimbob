// Service worker: makes the site installable, opens fast from the Home Screen, and shows push
// notifications. The API, WebSockets, and video (Cloudflare) are never cached, so content stays live.
const CACHE = 'mbjb-shell-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
// Every deploy brings new hashed files; keep the newest this many so the cache doesn't grow forever.
const MAX_ASSETS = 60;

async function trimAssets(cache) {
  // keys() lists entries oldest first.
  const assets = (await cache.keys()).filter((r) => new URL(r.url).pathname.startsWith('/assets/'));
  await Promise.all(assets.slice(0, -MAX_ASSETS).map((r) => cache.delete(r)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return;

  // Pages: network first so updates show immediately; the cached shell only when offline. Only a good
  // page is kept as the shell (not a 404 or an error page).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Built files have content hashes in their names, so a cached copy never goes stale.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy).then(() => trimAssets(c)));
            }
            return res;
          }),
      ),
    );
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'MadeByJimBob', body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'MadeByJimBob', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag,
      data: { url: data.url || '/' },
    }),
  );
});

// Tapping a notification opens that video at that moment, reusing an open window if there is one.
// (A window this worker doesn't control can't be navigated; open a new one instead.)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (!existing) return self.clients.openWindow(url);
      return existing
        .focus()
        .then((w) => w.navigate(url))
        .catch(() => self.clients.openWindow(url));
    }),
  );
});
