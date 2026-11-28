/*
 * Conservative service worker for the driver PWA (SPEC US-D11).
 *
 * Rules:
 *  - Only same-origin GET requests are ever considered.
 *  - /api/* is NEVER intercepted or cached (authenticated, time-sensitive data; the server is the source of truth).
 *  - HTML navigations are NEVER cached (pages render per user session); when the network is down a small
 *    built-in Persian offline page is shown instead.
 *  - Only immutable build assets (/_next/static/*) and the public icon/manifest are cached (cache-first).
 *  - Responses marked no-store/private or not 200/basic are not cached.
 */
const VERSION = 'v1';
const CACHE = `cb-static-${VERSION}`;
const PRECACHE = ['/icon.svg', '/manifest.webmanifest'];

const OFFLINE_HTML = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>اتصال برقرار نیست</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F1F5F9;
font-family:Vazirmatn,Tahoma,sans-serif;color:#0F172A;padding:16px;box-sizing:border-box;text-align:center}
.c{background:#fff;border-radius:24px;padding:24px;max-width:360px;box-shadow:0 4px 12px rgba(15,23,42,.08)}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#475569;margin:0 0 16px}
button{font:inherit;background:#1E40AF;color:#fff;border:0;border-radius:12px;padding:10px 20px;cursor:pointer}</style>
</head><body><div class="c"><h1>اتصال به اینترنت برقرار نیست</h1>
<p>برای دیدن سالن، نوبت و بارها باید آنلاین باشید. اتصال را بررسی کنید و دوباره تلاش کنید.</p>
<button onclick="location.reload()">تلاش دوباره</button></div></body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('cb-') && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function isCacheableAsset(url) {
  return url.pathname.startsWith('/_next/static/') || PRECACHE.includes(url.pathname);
}

function storable(res) {
  if (!res || res.status !== 200 || res.type !== 'basic') return false;
  const cc = (res.headers.get('Cache-Control') || '').toLowerCase();
  return !cc.includes('no-store') && !cc.includes('private');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return; // never touch the API

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(OFFLINE_HTML, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
      ),
    );
    return;
  }

  if (!isCacheableAsset(url)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (storable(res)) await cache.put(req, res.clone());
      return res;
    }),
  );
});
