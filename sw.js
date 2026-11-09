// Service Worker – Alpha order tracker (PWA)
// Strategy: the page itself is always fetched from the network first, so every
// deploy reaches users immediately. Only when there is no connection a short
// "no connection" screen is shown. Other origins (CDNs, Firebase/Firestore)
// are never intercepted – the browser and Firebase handle them as before.
// Bump CACHE_VERSION when the files in STATIC_ASSETS change.

const CACHE_VERSION = 'aot-v1';
const STATIC_ASSETS = [
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#17597C">
<title>אין חיבור לאינטרנט</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#f8fafc;color:#1e293b;font-family:Arial,sans-serif;text-align:center;padding:16px;box-sizing:border-box}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px 24px;max-width:360px;width:100%;
        box-shadow:0 1px 3px rgba(0,0,0,.06)}
  img{width:72px;height:72px;border-radius:16px}
  h1{font-size:20px;margin:16px 0 8px}
  p{color:#64748b;margin:0 0 20px;line-height:1.5}
  button{background:#17597C;color:#fff;border:0;border-radius:10px;padding:12px 24px;font-size:16px;cursor:pointer}
</style></head>
<body><div class="card">
  <img src="./icons/icon-192.png" alt="">
  <h1>אין חיבור לאינטרנט</h1>
  <p>מערכת ההזמנות צריכה חיבור כדי להציג נתונים עדכניים.<br>בדוק את החיבור ונסה שוב.</p>
  <button onclick="location.reload()">נסה שוב</button>
</div></body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // CDNs / Firebase: untouched

  // The page: network first, offline screen as fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      )
    );
    return;
  }

  // Icons / manifest: served from cache, refreshed in the background.
  if (STATIC_ASSETS.some((p) => url.pathname.endsWith(p.slice(1)))) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
