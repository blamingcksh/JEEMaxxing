/* ============================================================================
 * sw.js — JEEMaxxing service worker
 *
 * Strategy: stale-while-revalidate for the app shell + CDN assets, so the
 * add-to-home-screen (PWA) build on iPad / iPhone opens instantly with zero
 * network waits and keeps working offline. NEVER caches Drive/Gemini API
 * calls (only GET requests to static assets are intercepted).
 * ============================================================================ */
'use strict';

const VERSION = 'jeemax-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles.css',
  './app.js',
  './storage.js',
  './checkpoint.js',
  './fx.js',
  './matrix.js',
  './pomodoro.js',
  './theme.js',
  './dashboard-clean.js',
  './forest-bg.js',
  './forest-island.js',
  './forest-island-full.js',
  './forest-island-juice.js',
  './forest-juice.js',
  './gallery-break.js',
  './candlestick-engine.js',
  './cns-load.js',
  './deload.js',
  './leaderboard.js',
  './lifeline.js',
  './nightguard.js',
  './accountability.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon-180.png'
];

const CDN_PREFIXES = [
  'https://cdn.jsdelivr.net',      // katex, fonts, three.js fallbacks
  'https://esm.sh',                // three.js primary
  'https://unpkg.com',             // three.js fallback
  'https://accounts.google.com/gsi/client'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isCDN(url) {
  return CDN_PREFIXES.some((p) => url.startsWith(p));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never touch Drive / Gemini / any API endpoint.
  if (url.origin === 'https://www.googleapis.com' || url.origin === 'https://generativelanguage.googleapis.com') {
    return;
  }

  const isLocal = url.origin === self.location.origin;
  const isCdn = isCDN(req.url);
  if (!isLocal && !isCdn) return;

  // Only cache same-origin http(s) + cross-origin CDN GETs (skip query-noise
  // for local files — index.html is served with ?v= hashing in some setups).
  if (isLocal && url.pathname.includes('.') && !/(\.js|\.css|\.png|\.webmanifest|\.ico)$/.test(url.pathname)) {
    return;
  }

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: isLocal });
      const fetchPromise = fetch(req).then((res) => {
        if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
          try { cache.put(req, res.clone()); } catch (_) {}
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
