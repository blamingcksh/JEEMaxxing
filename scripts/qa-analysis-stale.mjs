// QA pass — "Analysis tab is dead" reproduction.
//
// The user pushed the Analysis-tab build, then the tab showed up in the nav
// but nothing rendered. Root cause: the PWA service worker serves the OLD
// app.js (cached stale-while-revalidate) against the NEW index.html
// (network-first) on the first load after deploy. New HTML = the Analysis
// nav + empty view; old JS = no renderAnalysis wiring. Result: a dead tab.
//
// The headless-shell build available here cannot run service workers, so we
// reproduce the EXACT mixed-version state the stale cache delivers, by
// serving the new index.html alongside the pre-Analysis app.js (pulled from
// git 697e0bd), then verify the fixed state with the current app.js.
//
//   A  MIXED STALE STATE  — new index.html + old app.js:
//      • Analysis nav exists, but the tab is DEAD (view active, panels empty)
//      • the rest of the app still works (dashboard renders) — matching the
//        user's "everything else is fine" report
//   B  CURRENT BUILD  — Analysis tab fully renders, and Raw Solves draws
//      NON-ZERO candles from the real ledger shape ({physics, chemistry,
//      maths, count}).

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:8788/index.html';
const EXEC = '/home/codespace/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

// Pre-Analysis app.js (commit 697e0bd) — has NO Analysis wiring.
const OLD_APP_JS = execSync('git show 697e0bd:app.js', { cwd: ROOT }).toString();

// One server, mutable config.
const serverCfg = { staleApp: false };
function startServer() {
    const server = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        const name = p.replace(/^\.?\//, '');

        const send = (data, mime) => {
            res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
            res.end(data);
        };
        const sendFile = (file, mime) => {
            fs.readFile(file, (err, data) => {
                if (err) { res.writeHead(404); res.end('not found'); return; }
                send(data, mime);
            });
        };

        if (name === 'app.js' && serverCfg.staleApp) {
            return send(OLD_APP_JS, 'text/javascript'); // stale cached build
        }
        sendFile(path.join(ROOT, p.replace(/^\//, '')), MIME[path.extname(p)] || 'application/octet-stream');
    });
    return new Promise(resolve => server.listen(8788, '127.0.0.1', () => resolve(server)));
}

let pass = 0, fail = 0;
function assert(cond, name) {
    if (cond) { pass++; console.log('  ✔', name); }
    else { fail++; console.error('  ✘', name); }
}

const server = await startServer();
console.log('QA server up on 127.0.0.1:8788');

let browser;
try {
    browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
} catch (_) {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

async function newContext() {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
        try {
            const d = new Date();
            const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            localStorage.setItem('jeemax_boot_seq_date', k);
        } catch (_) {}
    });
    return context;
}

async function dismissOverlays(page) {
    await page.waitForTimeout(400);
    try {
        await page.evaluate(() => {
            const m = document.getElementById('nightguard-modal');
            if (m && m.classList.contains('active')) {
                if (window.__nightGuard && typeof window.__nightGuard.recordOverride === 'function') {
                    try { window.__nightGuard.recordOverride(); } catch (_) {}
                }
                m.classList.remove('active');
                document.body.classList.remove('nightguard-tint');
            }
        });
    } catch (_) {}
    await page.waitForTimeout(400);
}

// ════════════ Phase A — MIXED STALE STATE: new index.html + old app.js ════════════
try {
    serverCfg.staleApp = true;
    const context = await newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await dismissOverlays(page);

    const stale = await page.evaluate(() => {
        const nav = document.querySelector('.nav-item[data-tab="analysis"]');
        if (nav) nav.click();
        const v = document.getElementById('view-analysis');
        return {
            hasNav: !!nav,
            hasAnalysisFn: typeof window.renderAnalysis === 'function',
            viewActive: !!(v && v.classList.contains('active')),
            kpis: document.querySelectorAll('#analysis-kpi-grid .analysis-kpi').length,
            subjChildren: (document.getElementById('analysis-subject-body') || {}).children ? document.getElementById('analysis-subject-body').children.length : -1,
            heroMeta: ((document.getElementById('analysis-hero-meta') || {}).textContent || '').trim(),
        };
    });
    assert(stale.hasNav, 'A: NEW index.html ships the Analysis nav item');
    assert(!stale.hasAnalysisFn, 'A: stale cache served the OLD app.js (no renderAnalysis)');
    assert(stale.viewActive && stale.kpis === 0 && stale.subjChildren === 0 && !stale.heroMeta,
        `A: ⚠️ DEAD TAB reproduced — Analysis view active but empty (kpis=${stale.kpis}, subject children=${stale.subjChildren}, hero meta="${stale.heroMeta}")`);

    // The rest of the app still works — dashboard renders fine.
    const dashboard = await page.evaluate(() => {
        const nav = document.querySelector('.nav-item[data-tab="dashboard"]');
        if (nav) nav.click();
        const v = document.getElementById('view-dashboard');
        return {
            active: !!(v && v.classList.contains('active')),
            graph: !!document.getElementById('dynamic-graph'),
        };
    });
    assert(dashboard.active && dashboard.graph, 'A: dashboard still renders — matches "everything else is fine"');
    await context.close();
} catch (e) {
    assert(false, 'A: scenario threw — ' + e.message);
}

// ════════ Phase B — CURRENT BUILD: full render + non-zero candles ════════
try {
    serverCfg.staleApp = false;
    const context = await newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await dismissOverlays(page);

    // Seed the bank through the app's own IDB mirror with solve stamps spread
    // over the last 15 days → persistSolvedByDate builds the real ledger
    // ({physics, chemistry, maths, count}) on the next getDailyHistory().
    await page.evaluate(() => {
        const now = Date.now(), DAY = 86400000;
        const bank = [];
        const SUBJ = ['physics', 'chemistry', 'maths'];
        for (let d = 0; d < 15; d++) {
            const n = 3 + ((d * 7) % 9); // 3..11 solves per day
            for (let i = 0; i < n; i++) {
                bank.push({
                    id: 'p3-' + d + '-' + i, subject: SUBJ[i % 3], chapter: 'Kinematics',
                    status: 'solved', firstAttemptResult: 'correct', errorReason: null,
                    qElo: 1150 + ((d * 40 + i * 13) % 500),
                    lastReviewedAt: new Date(now - (d * DAY) - (i * 3600e3)).toISOString(),
                    timeTaken: 60 + ((d * 17 + i * 11) % 240), easeFactor: 2.5,
                    currentInterval: 3, nextReviewAt: new Date(now + 86400000).toISOString(),
                    isMastered: false, historyLogs: [],
                });
            }
        }
        return window._idbMirror.set('jeemax_question_bank', bank);
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await dismissOverlays(page);

    await page.evaluate(() => { const n = document.querySelector('.nav-item[data-tab="analysis"]'); if (n) n.click(); });
    await page.waitForTimeout(1800);

    // Raw Solves metric → candles must rise off the baseline (non-zero bodies).
    await page.click('#analysis-metric-pills button[data-metric="solves"]');
    await page.waitForTimeout(900);
    const candles = await page.evaluate(() => {
        const svg = document.getElementById('analysis-progress-graph');
        const rects = svg ? Array.from(svg.querySelectorAll('rect')) : [];
        const bodyHeights = rects
            .map(r => parseFloat(r.getAttribute('height') || '0'))
            .filter(h => isFinite(h));
        const maxBody = bodyHeights.length ? Math.max(...bodyHeights) : 0;
        const nBodies = bodyHeights.filter(h => h > 2).length;
        return { maxBody, nBodies, totalRects: rects.length };
    });
    assert(candles.totalRects > 5, `B: candle chart rendered (${candles.totalRects} rects)`);
    assert(candles.nBodies > 0,
        `B: Raw Solves draws NON-ZERO candles from the real ledger (${candles.nBodies} bodies > 2px, max ${candles.maxBody.toFixed(1)}px)`);

    const full = await page.evaluate(() => ({
        kpis: document.querySelectorAll('#analysis-kpi-grid .analysis-kpi').length,
        subj: document.querySelectorAll('#analysis-subject-body .analysis-bar-row').length,
        elo: document.querySelectorAll('#analysis-elo-body .analysis-bar-row').length,
    }));
    assert(full.kpis === 8 && full.subj === 3 && full.elo === 3, `B: full render on the current build (kpis=${full.kpis}, subj=${full.subj}, elo=${full.elo})`);
    assert(!errors.length, 'B: zero console/page errors');
    if (errors.length) console.log('B log: ' + JSON.stringify(errors));
    await context.close();
} catch (e) {
    assert(false, 'B: scenario threw — ' + e.message);
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
