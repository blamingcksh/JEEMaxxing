// QA harness — reusable screenshot harness + BEFORE captures of the current
// forest/grove visuals (prep for the grove-v2 rewrite).
//
// Conventions follow the existing QA scripts (redesign-baseline.mjs,
// qa-boot-sequence.mjs):
//   • self-contained static server (node:http) serving the repo root
//     (module scripts need HTTP, not file://)
//   • playwright-core Chromium via channel fallback: msedge → chrome →
//     Playwright's own registry lookup. NO browser downloads here — if every
//     attempt fails we print the exact resolution error and exit 1.
//   • console errors + pageerror capture; exit code 1 when a pageerror fires.
//
// Forest/grove forcing (persisted-key route — no app source is modified):
//   • jeemax_forest_bg = '1'      forest-bg.js boot(): localStorage gate that
//                                 flips the Living World layer on at startup.
//   • jeemax_forest_bg_op='0.5'   wallpaper opacity (documented slider range).
//   • jeemax_grove_v1             valid defaultGrove() shape (grove-islands.js
//                                 loadGrove) so no first-run toast pollutes shots.
//   • jeemax_forest_daily_v1      documented schema { 'YYYY-MM-DD':
//                                 {physics,chemistry,maths} } (forestStoreToday/
//                                 seedStore). Seeding today's counts lets the
//                                 app's own tick() attribute solves and plant
//                                 trees so the island widget is non-empty.
//   • jeemax_boot_seq_date        skips the once-a-day boot sequence overlay
//                                 (same trick as redesign-baseline.mjs).
//   • jeemax_fx_prefs             documented shape {sound,hover,effects,haptics,
//                                 volume}; audio muted for headless, visual
//                                 effects kept ON so BEFORE shots are faithful.
//
// Run: node scripts/qa-grove-shots.mjs

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8798;
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.redesign-shots', 'grove-v2');
fs.mkdirSync(OUT, { recursive: true });
const SHOT_FULL = path.join(OUT, 'before-full-dashboard.png');
const SHOT_ISLAND = path.join(OUT, 'before-island-widget.png');
const VIEWPORT = { width: 1440, height: 900 };

// Self-contained static server (same shape as redesign-baseline.mjs).
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
const server = await new Promise(resolve => {
    const s = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        fs.readFile(path.join(ROOT, p), (err, data) => {
            if (err) { res.writeHead(404); res.end('not found'); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
});
console.log(`QA server up on ${BASE}`);

// Chromium resolution — same channel-fallback convention the redesign-* QA
// scripts use on this machine. Every failure reason is kept for the report;
// we never download a browser.
async function launchChromium() {
    const attempts = [
        ['channel "msedge"', () => chromium.launch({ channel: 'msedge', headless: true })],
        ['channel "chrome"', () => chromium.launch({ channel: 'chrome', headless: true })],
        ['playwright-core registry (default lookup)', () => chromium.launch({ headless: true })],
    ];
    const errs = [];
    for (const [name, fn] of attempts) {
        try {
            const b = await fn();
            console.log('Chromium launched via ' + name);
            return b;
        } catch (e) {
            errs.push('  - ' + name + ': ' + String(e.message || e).split('\n')[0]);
        }
    }
    console.error('\nChromium resolution failed — no browser downloaded (by design).\nAttempts:\n' + errs.join('\n'));
    server.close();
    process.exit(1);
}
const browser = await launchChromium();

const context = await browser.newContext({ viewport: VIEWPORT });

// Preset persisted state BEFORE any page script runs.
await context.addInitScript(() => {
    try {
        var ymd = function () {
            var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
            return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        };
        // Skip the once-a-day boot-sequence overlay.
        localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA'));
        // FX prefs (fx.js DEFAULT shape): mute audio, keep visual effects ON.
        localStorage.setItem('jeemax_fx_prefs', JSON.stringify({
            sound: false, hover: false, effects: true, haptics: true, volume: 0.7,
        }));
        // Living World layer ON — forest-bg.js reads this exact key in boot().
        localStorage.setItem('jeemax_forest_bg', '1');
        localStorage.setItem('jeemax_forest_bg_op', '0.5');
        // Grove state: valid loadGrove() object (no first-run welcome toast).
        localStorage.setItem('jeemax_grove_v1', JSON.stringify({
            activeBiome: 'temperate',
            activeSpecies: 'pine',
            subjectSpecies: { physics: 'pine', chemistry: 'oak', maths: 'pine' },
            daily: {},
        }));
        // Demo solve state via the documented daily-count schema; 15 solves →
        // grove-islands.js plants 5 mature trees on its first tick().
        localStorage.setItem('jeemax_forest_daily_v1', JSON.stringify({
            [ymd()]: { physics: 8, chemistry: 4, maths: 3, updatedAt: Date.now() },
        }));
    } catch (e) { console.warn('[qa-grove-shots] init seed failed:', e && e.message); }
});

const page = await context.newPage();
const consoleErrors = [];
const consoleWarnings = [];
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message || e)));
page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(m.text());
    else if (m.type() === 'warning') consoleWarnings.push(m.text());
});

let pass = 0, fail = 0;
const notes = [];
function assert(cond, name) {
    if (cond) { pass++; console.log('  ✔', name); }
    else { fail++; console.error('  ✘', name); }
}
function note(msg) { notes.push(msg); }

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });

// Sidebar toggle injection proves forest-bg.js booted (it retries until the
// sidebar exists, then injects #forest-bg-btn).
try {
    await page.waitForSelector('#forest-bg-btn', { timeout: 20000 });
    assert(true, 'forest-bg booted (sidebar toggle #forest-bg-btn injected)');
} catch (_) {
    assert(false, 'forest-bg toggle never appeared — forest-bg.js did not boot');
}

// Defensive: dismiss the Night Guard recovery modal the legit way if it owns
// the screen at boot (same handling as qa-boot-sequence.mjs).
const ngDismissed = await page.evaluate(() => {
    const m = document.getElementById('nightguard-modal');
    if (!(m && m.classList.contains('active'))) return false;
    try {
        if (window.__nightGuard && typeof window.__nightGuard.recordOverride === 'function') {
            window.__nightGuard.recordOverride();
        }
    } catch (_) {}
    m.classList.remove('active');
    document.body.classList.remove('nightguard-tint');
    return true;
});
if (ngDismissed) note('Night Guard recovery modal was up at boot — dismissed');

// ── Settle: forest layer ──────────────────────────────────────────────────
// setEnabled(true) flips the canvas opacity synchronously; the THREE scene
// itself builds asynchronously after a CDN import, so give it room and watch
// for the module's own failure toasts.
let forestOn = false;
try {
    await page.waitForFunction(() => {
        const c = document.getElementById('forest-bg-canvas');
        return !!c && c.style.opacity && c.style.opacity !== '0';
    }, { timeout: 15000 });
    forestOn = true;
    assert(true, 'forest canvas is visible (#forest-bg-canvas opacity > 0)');
} catch (_) {
    assert(false, 'forest canvas never became visible');
}
await page.waitForTimeout(5000); // CDN import + scene build + first rendered frames

// ── Settle: grove island ──────────────────────────────────────────────────
let treeCount = -1;
try {
    await page.waitForSelector('#gi-host', { timeout: 15000 });
    assert(true, 'grove card mounted (#gi-host present)');
} catch (_) {
    assert(false, 'grove card never mounted (#gi-host absent)');
}
try {
    await page.waitForFunction(() => window.__groveIslands && window.__groveIslands.trees() > 0,
        { timeout: 45000 });
    treeCount = await page.evaluate(() => window.__groveIslands.trees());
    assert(treeCount > 0, `island is non-empty (${treeCount} trees planted)`);
} catch (_) {
    assert(false, 'island stayed empty — grove 3D engine likely failed to load (see toasts/warnings)');
}
const islandState = await page.evaluate(() => {
    const t = (sel) => { const e = document.querySelector(sel); return e ? e.textContent.trim() : null; };
    const emptyEl = document.getElementById('gi-empty');
    return {
        biome: t('#gi-name'),
        sub: t('#gi-sub'),
        elo: typeof window.__groveIslands === 'object' ? window.__groveIslands.elo() : null,
        emptyVisible: !!emptyEl && emptyEl.style.display !== 'none',
        forestBtnActive: (document.getElementById('forest-bg-btn') || {}).classList?.contains('active') || false,
    };
});
console.log('  island:', JSON.stringify(islandState));
assert(!islandState.emptyVisible, 'grove "empty" placeholder hidden');

// Module failure toasts (both modules toast on CDN/build failure).
const failToasts = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#gi-toasts .gi-toast').forEach(t => out.push(t.textContent.trim()));
    document.querySelectorAll('body > div').forEach(d => {
        if ((d.textContent || '').startsWith('⚠')) out.push(d.textContent.trim());
    });
    return out.filter(t => t.includes('⚠'));
});
if (failToasts.length) note('failure toasts on page: ' + JSON.stringify(failToasts));

// Final settle: tree spring scale-in (~1–2 s), forest fade-in (.7 s), HUD paint.
await page.waitForTimeout(3500);

// ── Shot 1: full dashboard, 1440×900 ─────────────────────────────────────
const dashActive = await page.evaluate(() => {
    const d = document.getElementById('view-dashboard');
    return !!(d && d.classList.contains('active'));
});
assert(dashActive, 'dashboard view is active before the full shot');
await page.screenshot({ path: SHOT_FULL });
console.log('  shot → ' + SHOT_FULL);

// ── Shot 2: island widget element screenshot ─────────────────────────────
// The task names #forest-island-host; at runtime the live widget host is
// #gi-host (grove-islands.js mountCard). #forest-island-host survives only as
// legacy CSS selectors in styles.css — fall back and say so.
let islandSel = '#forest-island-host';
if (await page.locator(islandSel).count() === 0) {
    islandSel = '#gi-host';
    note('#forest-island-host not in DOM (id exists only in legacy styles.css rules) — captured the live island widget host #gi-host instead');
}
const islandLoc = page.locator(islandSel).first();
await islandLoc.scrollIntoViewIfNeeded();
await page.waitForTimeout(500); // post-scroll repaint / parallax settle
await islandLoc.screenshot({ path: SHOT_ISLAND });
console.log('  shot → ' + SHOT_ISLAND + '  (element: ' + islandSel + ')');

await browser.close();
server.close();

// ── Verify artifacts ──────────────────────────────────────────────────────
console.log('\n--- artifacts ---');
for (const p of [SHOT_FULL, SHOT_ISLAND]) {
    try {
        const sz = fs.statSync(p).size;
        console.log(`${sz>10000?'✔':'✘'} ${p} (${sz} bytes)`);
        if (sz <= 10000) fail++;
    } catch (e) {
        console.error('✘ MISSING: ' + p);
        fail++;
    }
}

// ── Error report ──────────────────────────────────────────────────────────
console.log('\n--- console/page log ---');
console.log('pageerrors (' + pageErrors.length + '):');
pageErrors.forEach(e => console.log('  PAGEERROR: ' + e));
console.log('console errors (' + consoleErrors.length + '):');
consoleErrors.forEach(e => console.log('  CONSOLE ERROR: ' + e.slice(0, 400)));
console.log('console warnings (' + consoleWarnings.length + '):');
[...new Set(consoleWarnings)].forEach(w => console.log('  CONSOLE WARN: ' + w.slice(0, 300)));
if (notes.length) console.log('\nnotes:\n' + notes.map(n => '  • ' + n).join('\n'));

console.log(`\n${pass} passed, ${fail} failed`);
// Contract: exit code 1 whenever a pageerror occurred during load.
process.exit(pageErrors.length || fail ? 1 : 0);
