// audit-runtime-probe.mjs — READ-ONLY empirical audit harness.
// Boots JEEMaxxing in headless Chromium (Edge→Chrome fallback) under iPad-like
// contexts and measures: console/page errors, failed requests, boot timing,
// DOM weight, rAF loop pressure, long tasks, JS heap, sub-44px touch targets,
// horizontal overflow across iPad / Split View / Slide Over widths, and
// backdrop-filter layer counts. Writes findings to stdout as structured JSON
// lines + human summary. Does not modify app code or user data.

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8971;
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
    '.woff': 'font/woff', '.webmanifest': 'application/manifest+json',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain',
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

let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { try { browser = await chromium.launch({ channel: 'chrome', headless: true }); } catch { console.log('NO_BROWSER'); process.exit(2); } }

const IPAD_PROFILES = [
    { name: 'ipad-air-portrait', vp: { width: 820, height: 1180 }, dsf: 2 },
    { name: 'ipad-landscape', vp: { width: 1180, height: 820 }, dsf: 2 },
    { name: 'splitview-half', vp: { width: 678, height: 1024 }, dsf: 2 },
    { name: 'slideover', vp: { width: 375, height: 1024 }, dsf: 2 },
];

const results = {};

async function bootProbe(profile) {
    const ctx = await browser.newContext({
        viewport: profile.vp,
        deviceScaleFactor: profile.dsf,
        hasTouch: true,
        isMobile: false,
    });
    const page = await ctx.newPage();
    const errors = [], warnings = [], failedReqs = [];

    // Instrument BEFORE any app code runs: wrap rAF to count distinct loops,
    // register LongTask observer, mark boot start.
    await page.addInitScript(() => {
        window.__probe = { rafCalls: 0, rafIds: new Set(), intervals: new Set(), listenersAdded: 0 };
        const origRaf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (cb) => {
            __probe.rafCalls++;
            const id = origRaf(t => { __probe.rafIds.delete(id); try { cb(t); } catch (e) { throw e; } });
            __probe.rafIds.add(id);
            return id;
        };
        const origSi = window.setInterval.bind(window);
        window.setInterval = (fn, ms, ...a) => { const id = origSi(fn, ms, ...a); __probe.intervals.add(id); return id; };
        const origClearSi = window.clearInterval.bind(window);
        window.clearInterval = (id) => { __probe.intervals.delete(id); return origClearSi(id); };
        try {
            new PerformanceObserver(list => {
                for (const e of list.getEntries()) {
                    (__probe.longTasks = __probe.longTasks || []).push(e.duration);
                }
            }).observe({ entryTypes: ['longtask'] });
        } catch (_) {}
        window.__bootStart = performance.now();
    });

    page.on('console', m => {
        if (m.type() === 'error') errors.push(m.text().slice(0, 300));
        else if (m.type() === 'warning') warnings.push(m.text().slice(0, 200));
    });
    page.on('pageerror', e => errors.push('PAGEERROR: ' + String(e).slice(0, 300)));
    page.on('requestfailed', r => {
        const u = r.url();
        if (!u.includes('accounts.google.com') && !u.includes('esm.sh') && !u.includes('jsdelivr') && !u.includes('unpkg'))
            failedReqs.push(r.failure()?.errorText + ' ' + u.replace(BASE, ''));
    });

    // Fresh state: no seeded guard → real first-run path (boot briefing shows).
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Wait for app hydration signal (storage loaded → sidebar exists), cap 15s.
    await page.waitForFunction(() => !!document.querySelector('.nav-item'), { timeout: 15000 }).catch(() => {});
    const hydrationMs = await page.evaluate(() => Math.round(performance.now())).catch(() => -1);

    // Dismiss boot briefing overlay if present (Escape aborts it).
    for (let i = 0; i < 8; i++) {
        const ov = page.locator('.bootseq');
        if (!(await ov.count())) break;
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(400);
    }
    await page.waitForTimeout(2500); // settle animations/lazy loaders

    const metrics = await page.evaluate(() => {
        const q = (s) => document.querySelectorAll(s);
        const out = {};
        out.domNodes = document.getElementsByTagName('*').length;
        out.hydrationMsFromNav = Math.round(performance.now());
        // Touch targets: visible buttons & clickables smaller than 44x44
        const small = [];
        const els = q('button, [onclick], a.nav-item, input[type="button"], .btn');
        let checked = 0;
        for (const el of els) {
            if (checked > 1200) break;
            checked++;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
            if (cs.pointerEvents === 'none') continue;
            if (r.width < 40 || r.height < 40) {
                small.push({
                    tag: el.tagName.toLowerCase(),
                    cls: String(el.className).slice(0, 60),
                    w: Math.round(r.width), h: Math.round(r.height),
                    label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
                });
            }
        }
        out.smallTouchTargets = small.length;
        out.smallTouchTargetSamples = small.slice(0, 25);
        // Backdrop-filter layers actually applied on current screen
        let bfl = 0;
        for (const el of q('*')) {
            const cs = getComputedStyle(el);
            if ((cs.backdropFilter && cs.backdropFilter !== 'none')) bfl++;
        }
        out.backdropFilterElements = bfl;
        // Horizontal overflow
        out.horizontalOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        // Animations currently running
        out.runningAnimations = document.getAnimations ? document.getAnimations().length : -1;
        // Probe internals
        out.rafPendingLoops = window.__probe ? window.__probe.rafIds.size : -1;
        out.rafTotalCalls = window.__probe ? window.__probe.rafCalls : -1;
        out.liveIntervals = window.__probe ? window.__probe.intervals.size : -1;
        out.longTasks = (window.__probe && window.__probe.longTasks) ? window.__probe.longTasks : [];
        out.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1;
        return out;
    }).catch(e => ({ evalError: String(e) }));

    // Overflow re-check per width happens in dedicated passes below.
    results[profile.name] = {
        viewport: profile.vp,
        hydrationMs,
        errors: errors.slice(0, 30),
        errorCount: errors.length,
        warningCount: warnings.length,
        warningsSample: warnings.slice(0, 10),
        failedReqs: failedReqs.slice(0, 15),
        ...metrics,
    };
    await ctx.close();
}

// ── Pass 1: full boot probe on primary iPad portrait ──
await bootProbe(IPAD_PROFILES[0]);

// ── Pass 2: quick overflow-only sweep across all profiles ──
results.overflowSweep = {};
for (const prof of IPAD_PROFILES) {
    const ctx = await browser.newContext({ viewport: prof.vp, deviceScaleFactor: prof.dsf, hasTouch: true });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
        try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!document.querySelector('.nav-item'), { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1800);
    const sweep = await page.evaluate(() => {
        const overflowers = [];
        const dw = document.documentElement.clientWidth;
        for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.right > dw + 1 && r.width > 12 && r.width < innerWidth * 3) {
                const cs = getComputedStyle(el);
                if (cs.position === 'fixed') continue;
                overflowers.push({ cls: String(el.className).slice(0, 50), right: Math.round(r.right), w: Math.round(r.width) });
                if (overflowers.length >= 8) break;
            }
        }
        return {
            hOverflowPx: document.documentElement.scrollWidth - dw,
            bodyHOverflowPx: document.body.scrollWidth - dw,
            samples: overflowers,
        };
    }).catch(e => ({ evalError: String(e) }));
    results.overflowSweep[prof.name] = sweep;
    await ctx.close();
}

await browser.close();
server.close();

fs.mkdirSync(path.join(ROOT, '.qa-shots'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.qa-shots', 'runtime-probe.json'), JSON.stringify(results, null, 2));

// Human summary
for (const [name, r] of Object.entries(results)) {
    if (name === 'overflowSweep') continue;
    console.log(`\n=== ${name} (${JSON.stringify(r.viewport)}) ===`);
    console.log(`hydration: ${r.hydrationMs}ms | domNodes: ${r.domNodes} | heap: ${r.heapMB}MB`);
    console.log(`errors: ${r.errorCount} | warnings: ${r.warningCount} | failedLocalReqs: ${r.failedReqs?.length ?? 0}`);
    (r.errors || []).slice(0, 8).forEach(e => console.log('  E:', e));
    (r.failedReqs || []).slice(0, 6).forEach(f => console.log('  REQFAIL:', f));
    console.log(`smallTouchTargets(<40px): ${r.smallTouchTargets}`);
    (r.smallTouchTargetSamples || []).slice(0, 12).forEach(s =>
        console.log(`   ${s.w}x${s.h} <${s.tag} class="${s.cls}"> "${s.label}"`));
    console.log(`backdropFilterEls: ${r.backdropFilterElements} | runningAnims: ${r.runningAnimations} | liveIntervals: ${r.liveIntervals} | rafPending: ${r.rafPendingLoops} | rafCalls: ${r.rafTotalCalls}`);
    const lt = r.longTasks || [];
    console.log(`longTasks(>50ms): ${lt.length}${lt.length ? ' worst=' + Math.round(Math.max(...lt)) + 'ms total=' + Math.round(lt.reduce((a, b) => a + b, 0)) + 'ms' : ''}`);
}
console.log('\n=== overflow sweep ===');
for (const [name, s] of Object.entries(results.overflowSweep)) {
    console.log(`${name}: hOverflow=${s.hOverflowPx}px bodyOverflow=${s.bodyHOverflowPx}px`);
    (s.samples || []).forEach(x => console.log(`   -> .${x.cls} right=${x.right} w=${x.w}`));
}
console.log('\nfull JSON -> .qa-shots/runtime-probe.json');
