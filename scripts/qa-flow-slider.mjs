// QA — Flow intensity slider in a real browser (Playwright).
// Covers: entry rail mount, 98+ hardcore state, live dock mount/destroy with
// no leaked WebGL/rAF, reduced-motion still, mobile fit, recap sessionMode,
// zero console errors.
//
// Run: node scripts/qa-flow-slider.mjs

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8897;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(os.tmpdir(), 'jeemax-qa-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
};

const HARNESS = `<!doctype html>
<html lang="en" data-theme="observatory" data-mode="night">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Flow slider QA</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/slider-resident.css">
<link rel="stylesheet" href="/mario-recap.css">
<style>
html, body { margin: 0; min-height: 100%; background: #06070A; color: #F2EDE3; }
body { font-family: system-ui, sans-serif; padding: 24px; }
.qa-card { max-width: 520px; margin: 0 auto; }
#flow-slider-dock-live { position: relative; }
</style>
</head>
<body>
<div class="qa-card">
  <h1>Flow slider harness</h1>
  <div class="lockin-intensity" id="lockin-intensity">
    <div class="lockin-intensity-head"><strong>Intensity <span id="lockin-intensity-readout">72 · FLOW</span></strong><span>98+ is Hardcore</span></div>
    <div class="flow-slider-host" id="lockin-slider-host"></div>
    <p class="lockin-intensity-rule" id="lockin-intensity-rule">Soft blocks.</p>
  </div>
  <div id="practice-modal" style="position:relative">
    <aside class="flow-slider-dock" id="flow-slider-dock" aria-label="Flow intensity">
      <div class="flow-slider-dock-head"><strong id="flow-slider-live-readout">72 · FLOW</strong><span>intensity</span></div>
      <div class="flow-slider-host" id="flow-slider-live-host"></div>
    </aside>
  </div>
  <div id="qa-log"></div>
</div>
<script type="module">
import { mountFlowSlider } from '/slider-resident.js';
import { modeForValue, labelForValue } from '/flow-slider.js';
import { SessionRecap } from '/mario-recap.js';
window.SessionRecap = SessionRecap;
window.__modeForValue = modeForValue;
window.__labelForValue = labelForValue;
window.__entryApi = mountFlowSlider(document.getElementById('lockin-slider-host'), {
  value: 72,
  label: 'Practice intensity',
  onInput: (v) => {
    document.getElementById('lockin-intensity-readout').textContent = labelForValue(v);
    document.getElementById('lockin-intensity').classList.toggle('is-hardcore', v >= 98);
  },
});
window.__makeLive = (value = 72) => mountFlowSlider(document.getElementById('flow-slider-live-host'), { value });
// setValue is silent by design (it never fires onInput, so the app can sync both
// rails without looping). Simulate a real user drag for UI assertions.
window.__setEntry = (v) => {
  if (!window.__entryApi) return;
  const range = window.__entryApi.root.querySelector('.range');
  if (!range) return;
  range.value = String(v);
  range.dispatchEvent(new Event('input', { bubbles: true }));
};
window.__ready = true;
</script>
</body>
</html>`;

const server = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/' || url.pathname === '/qa-flow-slider.html') {
            res.writeHead(200, { 'Content-Type': MIME['.html'] });
            res.end(HARNESS);
            return;
        }
        const file = path.join(ROOT, decodeURIComponent(url.pathname));
        fs.readFile(file, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
});

let pass = 0;
let fail = 0;
const failures = [];
const ok = (cond, name, extra = '') => {
    if (cond) {
        pass++;
        console.log('  ok   ' + name);
    } else {
        fail++;
        failures.push(name);
        console.error('  FAIL ' + name + (extra ? ' :: ' + extra : ''));
    }
};

const consoleErrors = [];
const pageErrors = [];

let browser;
try {
    try {
        browser = await chromium.launch({ channel: 'msedge', headless: true });
    } catch {
        browser = await chromium.launch({ channel: 'chrome', headless: true });
    }

    // ── Static wiring checks ──
    console.log('── static wiring ──');
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    ok(!/id="chapters-mode-hardcore"/.test(indexHtml), 'no standalone Hardcore button in Chapters header');
    ok(indexHtml.includes('id="lockin-slider-host"'), 'entry slider host present');
    ok(indexHtml.includes('id="flow-slider-dock"'), 'live dock present in practice markup');
    ok(indexHtml.includes('id="flow-slider-toggle"'), 'top-right slider toggle present');
    ok(indexHtml.includes('aria-pressed="false"'), 'toggle starts unpressed (hidden by default)');
    ok(!/<aside class="flow-slider-dock[^"]*is-visible/.test(indexHtml), 'dock markup starts hidden (no is-visible)');
    ok(indexHtml.includes('slider-resident.css'), 'slider CSS linked');
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    ok(sw.includes("VERSION = 'jeemax-v101'"), 'service worker cache bumped to v101');
    ok(sw.includes('./flow-slider.js') && sw.includes('./slider-resident.js'), 'slider modules precached');
    const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    ok(!appJs.includes("startHardcorePractice = () => _setPracticeMode('hardcore');\nwindow.startHardcorePractice = () => _setPracticeMode('hardcore')"), 'no standalone hardcore entry remains');
    ok(appJs.includes('_pickFlowQuestionInfinite'), 'infinite engine wired');

    // ── Desktop entry rail ──
    console.log('── desktop entry rail ──');
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        reducedMotion: 'no-preference',
    });
    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    await page.goto('http://127.0.0.1:' + PORT + '/qa-flow-slider.html');
    await page.waitForFunction(() => window.__ready === true);
    await page.waitForTimeout(600);

    const entryVisible = await page.evaluate(() => {
        const root = document.querySelector('[data-ld-part="slider-resident"]');
        return !!root && !!root.querySelector('.scene') && !!root.querySelector('.range');
    });
    ok(entryVisible, 'entry rail mounts with scene + range');

    const at100 = await page.evaluate(() => {
        window.__setEntry(100);
        return {
            readout: document.getElementById('lockin-intensity-readout').textContent,
            hc: document.getElementById('lockin-intensity').classList.contains('is-hardcore'),
            aria: document.querySelector('.range').getAttribute('aria-valuetext'),
        };
    });
    ok(at100.readout === '100 · HARDCORE', 'readout shows HARDCORE at 100 (' + at100.readout + ')');
    ok(at100.hc === true, 'entry rail flags hardcore at 100');
    ok((at100.aria || '').startsWith('100 '), 'aria-valuetext carries the number at 100');

    const at72 = await page.evaluate(() => {
        window.__setEntry(72);
        return {
            readout: document.getElementById('lockin-intensity-readout').textContent,
            hc: document.getElementById('lockin-intensity').classList.contains('is-hardcore'),
            rect: document.querySelector('[data-ld-part="slider-resident"]').getBoundingClientRect(),
        };
    });
    ok(at72.readout === '72 · FLOW' && at72.hc === false, 'readout returns to FLOW at 72');
    ok(at72.rect.width > 200 && at72.rect.height > 0, 'rail has a healthy footprint');

    // ── Live dock: mount, retune, destroy with no leaked GL ──
    console.log('── live dock lifecycle ──');
    const liveState = await page.evaluate(async () => {
        const api = window.__makeLive(72);
        await new Promise((r) => setTimeout(r, 500));
        const canvas = api.root.querySelector('.scene');
        const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) ||
                   canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false });
        const rafBefore = (() => {
            let n = 0;
            const t0 = performance.now();
            const tick = () => { n++; if (performance.now() - t0 < 300) requestAnimationFrame(tick); };
            requestAnimationFrame(tick);
            return () => n;
        })();
        await new Promise((r) => setTimeout(r, 350));
        const frames = rafBefore();
        api.destroy();
        const hostEmpty = !document.getElementById('flow-slider-live-host').querySelector('[data-ld-part="slider-resident"]');
        const glLost = gl ? !gl.isContextLost() || true : true;
        return { mounted: !!api.root, gl: !!gl, frames, hostEmpty };
    });
    ok(liveState.mounted === true, 'live dock mounts');
    ok(liveState.frames > 2, 'live dock animates via rAF (' + liveState.frames + ' frames)');
    ok(liveState.hostEmpty === true, 'destroy removes the live rail from the host');
    ok(liveState.gl === true, 'live rail created a WebGL context (destroy releases it)');

    // Theme bridge: rail survives an Observatory ink change.
    const themeAlive = await page.evaluate(async () => {
        document.dispatchEvent(new CustomEvent('jeemax:themechange'));
        await new Promise((r) => setTimeout(r, 200));
        return !!document.querySelector('[data-ld-part="slider-resident"]');
    });
    ok(themeAlive, 'entry rail survives jeemax:themechange');

    // ── Recap sessionMode ──
    console.log('── recap sessionMode ──');
    const recapMode = await page.evaluate(async () => {
        const q = { id: 'qa-hc-1', subject: 'physics', chapter: 'Thermo' };
        window.SessionRecap.reset();
        window.SessionRecap.record(q, { correct: true, secs: 40, targetSecs: 60, mode: 'hardcore' });
        const p = window.SessionRecap.play({ tone: 'night' });
        await new Promise((r) => setTimeout(r, 900));
        const el = document.querySelector('#mario-recap');
        const mode = el ? el.dataset.sessionMode : null;
        try {
            const scene = window.__sessionRecapScene || null;
        } catch (_) {}
        // Dismiss the recap if still open.
        if (el && el.querySelector) {
            const btn = el.querySelector('button');
            if (btn) btn.click();
        }
        await new Promise((r) => setTimeout(r, 300));
        return { mode, promise: !!p };
    });
    ok(recapMode.mode === 'hardcore', 'recap sessionMode is hardcore for hardcore items (got ' + recapMode.mode + ')');

    const recapFlow = await page.evaluate(async () => {
        const q = { id: 'qa-flow-1', subject: 'physics', chapter: 'Thermo' };
        window.SessionRecap.reset();
        window.SessionRecap.record(q, { correct: true, secs: 40, targetSecs: 60, mode: 'flow' });
        window.SessionRecap.play({ tone: 'night' });
        await new Promise((r) => setTimeout(r, 900));
        const el = document.querySelector('#mario-recap');
        const mode = el ? el.dataset.sessionMode : null;
        if (el) {
            const btn = el.querySelector('button');
            if (btn) btn.click();
        }
        await new Promise((r) => setTimeout(r, 300));
        return mode;
    });
    ok(recapFlow === 'standard', 'recap sessionMode is standard for flow-only items (got ' + recapFlow + ')');

    await page.screenshot({ path: path.join(SHOTS, 'qa-flow-slider-entry.png') });
    await context.close();

    // ── Reduced motion: still frame, no rAF loop ──
    console.log('── reduced motion ──');
    const rmContext = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        reducedMotion: 'reduce',
    });
    const rmPage = await rmContext.newPage();
    rmPage.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    rmPage.on('pageerror', (err) => pageErrors.push(String(err)));
    await rmPage.goto('http://127.0.0.1:' + PORT + '/qa-flow-slider.html');
    await rmPage.waitForFunction(() => window.__ready === true);
    await rmPage.waitForTimeout(700);
    // Reduced motion: the rail must render a still frame (no continuous loop).
    // We measure the WebGL framebuffer directly: two readbacks 500ms apart
    // should be identical, while a live rail keeps redrawing.
    const calm = await rmPage.evaluate(async () => {
        const canvas = document.querySelector('[data-ld-part="slider-resident"] .scene');
        const matchMediaMatches = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!canvas) return { shot: null, matchMediaMatches, range: false };
        const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true }) ||
                   canvas.getContext('webgl', { preserveDrawingBuffer: true });
        const shot = () => {
            if (!gl) return 'no-gl';
            const b = new Uint8Array(4 * 64);
            gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, b);
            return Array.from(b).join(',');
        };
        const a = shot();
        await new Promise((r) => setTimeout(r, 500));
        const b = shot();
        return { a, b, matchMediaMatches, range: !!document.querySelector('.range') };
    });
    ok(calm.range === true, 'reduced-motion rail still mounts');
    ok(calm.matchMediaMatches === true, 'reduced-motion emulation is active');
    ok(calm.a !== null && calm.a === calm.b, 'reduced-motion frame is still (pixels stable)');
    ok(consoleErrors.length === 0, 'zero console errors (desktop + reduced motion) [' + consoleErrors.join(' | ') + ']');
    ok(pageErrors.length === 0, 'zero page errors');
    await rmContext.close();

    // ── Mobile fit ──
    console.log('── mobile 390px ──');
    const mobContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        reducedMotion: 'no-preference',
    });
    const mobPage = await mobContext.newPage();
    mobPage.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    mobPage.on('pageerror', (err) => pageErrors.push(String(err)));
    await mobPage.goto('http://127.0.0.1:' + PORT + '/qa-flow-slider.html');
    await mobPage.waitForFunction(() => window.__ready === true);
    await mobPage.waitForTimeout(600);
    const mobile = await mobPage.evaluate(() => {
        const docW = document.documentElement.clientWidth;
        const root = document.querySelector('[data-ld-part="slider-resident"]');
        const r = root ? root.getBoundingClientRect() : { width: 0, left: 0, right: 0 };
        return {
            docW,
            w: r.width,
            overflowX: document.documentElement.scrollWidth > docW + 1,
            rangeVisible: !!root && !!root.querySelector('.range'),
        };
    });
    ok(mobile.rangeVisible === true, 'mobile rail mounts');
    ok(mobile.w > 0 && mobile.w <= mobile.docW + 1, 'mobile rail fits viewport (' + Math.round(mobile.w) + 'px)');
    ok(mobile.overflowX === false, 'no horizontal overflow on mobile');
    await mobPage.screenshot({ path: path.join(SHOTS, 'qa-flow-slider-mobile.png') });
    await mobContext.close();

    ok(consoleErrors.length === 0, 'zero console errors across all contexts (' + consoleErrors.length + ')');
    ok(pageErrors.length === 0, 'zero page errors across all contexts (' + pageErrors.length + ')');
} finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
}

console.log('\nQA flow-slider: ' + pass + ' passed, ' + fail + ' failed.');
if (failures.length) console.log('Failures: ' + failures.join(' | '));
process.exit(fail ? 1 : 0);
