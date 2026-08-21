/* ============================================================================
 * sw.js — JEEMaxxing service worker
 *
 * Strategy: network-first for the HTML shell (so a cached index.html can
 * never pin old code), stale-while-revalidate for JS/CSS/fonts/CDN assets,
 * so the add-to-home-screen (PWA) build on iPad / iPhone opens instantly
 * with zero network waits and keeps working offline. NEVER caches
 * Drive/Gemini API calls (only GET requests to static assets are
 * intercepted).
 * ============================================================================ */
'use strict';

const VERSION = 'jeemax-v29'; // Soundscape production pass — seamless real-recording loops, longer regenerated beds, remapped knobs, widget v2 polish
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
  './focus-sound.js',
  './theme.js',
  './dashboard-clean.js',
  './forest-bg.js',
  './grove-islands.js',
  './gallery-break.js',
  './candlestick-engine.js',
  './cns-load.js',
  './deload.js',
  './lifeline.js',
  './nightguard.js',
  './boot-sequence.js',
  './analysis.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon-180.png',
  // KaTeX engine + CSS + fonts — vendored locally so math rendering works
  // offline and never depends on a CDN being reachable.
  './vendor/katex/katex.min.js',
  './vendor/katex/katex.min.css',
  './vendor/katex/fonts/KaTeX_AMS-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2',
  './vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2',
  './vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Main-Bold.woff2',
  './vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2',
  './vendor/katex/fonts/KaTeX_Main-Italic.woff2',
  './vendor/katex/fonts/KaTeX_Main-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2',
  './vendor/katex/fonts/KaTeX_Math-Italic.woff2',
  './vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2',
  './vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2',
  './vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Script-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Size1-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Size2-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Size3-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Size4-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2'
];

// CDN assets fetched lazily at runtime (three.js, fonts) — never part of the
// install-critical shell. KaTeX is vendored locally and lives in SHELL above.
const CDN_SHELL = [];

const CDN_PREFIXES = [
  'https://cdn.jsdelivr.net',      // katex, fonts, three.js fallbacks
  'https://esm.sh',                // three.js primary
  'https://unpkg.com',             // three.js fallback
  'https://accounts.google.com/gsi/client'
];

self.addEventListener('install', (event) => {
  // ALL-SETTLED SHELL PRECACHE — a single 404 must never brick updates.
  // cache.addAll() rejects the WHOLE install when any shell asset fails to
  // fetch (a stale CDN, a not-yet-deployed file, a dropped font request). A
  // failed install means the previous SW version stays active forever, and
  // that stale worker keeps serving the OLD app.js against the NEW
  // index.html — the exact "Analysis tab is dead / new nav does nothing"
  // failure. With allSettled, every asset that CAN be cached is, activation
  // always proceeds, and the network-first HTML fetch + stale-while-
  // revalidate asset path cover anything that missed the cache.
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) =>
        Promise.allSettled([
          ...SHELL.map((u) => cache.add(u)),
          ...CDN_SHELL.map((u) => cache.add(u)),
        ])
      )
      .then(() => self.skipWaiting())
  );
});self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
  // ── Force stale pages to reload — THE iPad PWA update fix ────────────────
  // iOS keeps an installed PWA "running" in the app switcher for days; opening
  // the icon just foregrounds the OLD page, which keeps executing OLD code and
  // never picks up fixes. When a new SW version activates, navigate every open
  // window client so it loads the fresh shell exactly once. Runs on activation
  // of a NEW version only — the reloaded page re-checks the SW, finds the same
  // bytes, and doesn't activate again, so there is no reload loop.
  //
  // CRITICAL: this must NEVER be able to fail the activation. client.navigate()
  // returns a promise, and on Safari/WebKit (and some desktop browsers) it
  // rejects for cross-context/control reasons — the old try/catch only caught
  // synchronous throws. An unhandled rejection rejects event.waitUntil and
  // ABORTS the entire activation: the browser discards the new SW, the OLD SW
  // keeps serving its stale caches (old index.html + old app.js) forever, and
  // no update ever lands again. Swallow every failure.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => Promise.allSettled(clients.map((client) =>
        Promise.resolve().then(() => client.navigate(client.url || './')).catch(() => {})
      )))
      .catch(() => {})
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

  // ── HTML navigations: network-first ────────────────────────────────────
  // Stale-while-revalidate for the SHELL HTML is what left devices running
  // OLD code after an update: the cached index.html (which references the old
  // app.js) is served first, indefinitely, and even a hard refresh never
  // bypasses a service worker. Serve the FRESH shell on every load and fall
  // back to the cached copy only when offline.
  if (isLocal && (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => { try { cache.put(req, copy); } catch (_) {} });
        }
        return res;
      }).catch(() =>
        caches.match(req, { ignoreSearch: true }).then((cached) => cached || caches.match('./'))
      )
    );
    return;
  }

  // Only cache same-origin http(s) + cross-origin CDN GETs (skip query-noise
  // for local files — index.html is served with ?v= hashing in some setups).
  // .html included so the manifest start_url (./index.html) is served from
  // cache offline; .woff2 for the vendored KaTeX fonts.
  if (isLocal && url.pathname.includes('.') && !/(\.js|\.css|\.png|\.webmanifest|\.ico|\.woff2?|\.html|\.mp3|\.wav)$/.test(url.pathname)) {
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
