// QA pass — Analysis tab in a real headless Chromium.
// Serves the app itself on 127.0.0.1:8787 (module scripts need HTTP), seeds a
// synthetic question bank through the app's own IndexedDB mirror, reloads so
// loadDataAsync() picks it up, then walks the Analysis tab end to end:
//
//   A  Nav → Analysis tab: view active, hero candlesticks drawn, all panels
//      (KPI / subject / chapter / error / SR / ELO) populated, zero errors.
//   B  Metric + range pills re-render without errors.
//   C  Chapter row click → lands on The Vault with the chapter search set.
//   D  Empty-bank fallback: cleared profile renders graceful empty states.
//
// Screenshots land in /tmp/qa-analysis-shots/.

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8787/index.html';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
function startServer(port = 8787) {
    const server = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        fs.readFile(path.join(ROOT, p), (err, data) => {
            if (err) { res.writeHead(404); res.end('not found'); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
const SHOTS = '/tmp/qa-analysis-shots';
const EXEC = '/home/codespace/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';

try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

let pass = 0, fail = 0;
const notes = [];
function assert(cond, name) {
    if (cond) { pass++; console.log('  ✔', name); }
    else { fail++; console.error('  ✘', name); }
}
function note(msg) { notes.push(msg); }

const server = await startServer();
console.log('QA server up on 127.0.0.1:8787');

let browser;
try {
    browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
} catch (_) {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

async function newPage() {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // Pre-write the daily-briefing guard so the boot overlay never mounts and
    // blocks pointer events mid-scenario (fresh context = fresh localStorage).
    await context.addInitScript(() => {
        try {
            const d = new Date();
            const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            localStorage.setItem('jeemax_boot_seq_date', k);
        } catch (_) {}
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
    return { context, page, errors };
}

const shot = async (page, name) => {
    try { await page.screenshot({ path: `${SHOTS}/${name}.png` }); } catch (_) {}
};

// Boot overlay (daily briefing) owns the screen on a fresh profile. Escape
// aborts it and writes the daily guard — cleanest way to reach the app.
async function dismissBoot(page) {
    try { await page.waitForSelector('.bootseq', { timeout: 25000 }); } catch (_) { /* maybe no overlay */ }
    try {
        const visible = await page.locator('.bootseq').count();
        if (visible) await page.keyboard.press('Escape');
    } catch (_) {}
    await page.waitForTimeout(600);
    // Night Guard tier-3 modal can also own the screen at boot.
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

// ─────────────────────────────── Scenario A ───────────────────────────────
// Nav → Analysis: full populated render, no errors.
try {
    const { context, page, errors } = await newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await dismissBoot(page);
    await page.evaluate(() => {
        window.__analysisSeedChapters = {
            physics: ['Kinematics', 'Rotational Motion', 'Thermodynamics', 'Optics', 'Electrostatics'],
            chemistry: ['Mole Concept', 'Thermodynamics', 'Equilibrium', 'Organic Chem', 'Coordination'],
            maths: ['Calculus', 'Algebra', 'Vectors', 'Probability', 'Trigonometry'],
        };
    });
    await page.evaluate(() => {
        const SUBJECTS = ['physics', 'chemistry', 'maths'];
        const CHAPTERS = window.__analysisSeedChapters;
        const STATUSES = ['solved', 'solved', 'solved', 'wrong', 'error', 'unsolved'];
        const bank = [];
        const now = Date.now();
        const DAY = 86400000;
        for (let i = 0; i < 120; i++) {
            const subj = SUBJECTS[i % 3];
            const chapter = CHAPTERS[subj][i % 5];
            const status = STATUSES[i % 6];
            const d = new Date(now - ((i % 30) * DAY) - ((i % 7) * 3600e3));
            const firstResult = status === 'solved' ? 'correct' : (status === 'unsolved' ? null : 'incorrect');
            const reason = !firstResult || firstResult === 'correct'
                ? null : (i % 3 === 0 ? 'conceptual' : i % 3 === 1 ? 'calculation' : 'misread');
            const logs = [];
            if (status !== 'unsolved' && i % 2 === 0) {
                logs.push({
                    id: 'log-' + i, timestamp: d.toISOString(), result: status === 'solved' ? 'correct' : 'incorrect',
                    autonomy: 'independent', frictionTypes: JSON.stringify(['CALC', 'CONCEPT']),
                    timeSpentMins: 3 + (i % 5), performanceQ: 0.7, newInterval: 2, newEaseFactor: 2.5,
                });
            }
            bank.push({
                id: 'seed-' + i, subject: subj, chapter, status, firstAttemptResult: firstResult,
                errorReason: reason, qElo: 1050 + ((i * 37) % 700), qEloSource: 'uncalibrated',
                qEloStampedBy: null, qEloStampedAt: null, solveCount: status === 'solved' ? 1 : 0,
                lastReviewedAt: status === 'solved' ? d.toISOString() : null,
                lastSolvedAt: status === 'solved' ? d.toISOString() : null,
                timeTaken: 90 + ((i * 13) % 240), imageDataUrl: null, diagramImageUrl: null,
                extractedText: 'seed question ' + i, options: [], correctAnswer: 'C', type: 'mcq',
                solution: '', hint: '', tags: [], currentInterval: i % 7,
                easeFactor: 1.8 + ((i % 10) * 0.1),
                nextReviewAt: new Date(now - ((i % 11) * DAY)).toISOString(),
                targetTimeMins: 5, isMastered: i % 9 === 0, historyLogs: logs,
                difficulty: 0.5, difficultyLabel: 'mid', growSeconds: 10800, createdAt: d.toISOString(),
            });
        }
        return window._idbMirror.set('jeemax_question_bank', bank)
            .then(() => window._idbMirror.set('jeemax_chapters', {
                physics: CHAPTERS.physics, chemistry: CHAPTERS.chemistry, maths: CHAPTERS.maths,
            }));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await dismissBoot(page);

    // Open the Analysis tab through the real nav.
    await page.evaluate(() => {
        const nav = document.querySelector('.nav-item[data-tab="analysis"]');
        if (nav) nav.click();
    });
    await page.waitForTimeout(1600); // switchTab awaits flushSaves + loadDataAsync

    const state = await page.evaluate(() => {
        const v = document.getElementById('view-analysis');
        const graph = document.getElementById('analysis-progress-graph');
        return {
            active: !!(v && v.classList.contains('active')),
            navActive: !!document.querySelector('.nav-item[data-tab="analysis"].active'),
            candleNodes: graph ? graph.querySelectorAll('rect,line,path,polyline').length : 0,
            kpis: document.querySelectorAll('#analysis-kpi-grid .analysis-kpi').length,
            subjectRows: document.querySelectorAll('#analysis-subject-body .analysis-bar-row').length,
            chapterRows: document.querySelectorAll('#analysis-chapter-body .analysis-chapter-row').length,
            errCols: document.querySelectorAll('#analysis-error-body .analysis-err-cols').length,
            srStats: document.querySelectorAll('#analysis-sr-body .analysis-stat-line').length,
            eloBars: document.querySelectorAll('#analysis-elo-body .analysis-bar-row').length,
            heroMeta: (document.getElementById('analysis-hero-meta') || {}).textContent || '',
        };
    });
    assert(state.active, 'A: analysis view is active');
    assert(state.navActive, 'A: analysis nav item is active');
    assert(state.candleNodes > 15, `A: candlestick chart rendered (${state.candleNodes} svg nodes)`);
    assert(state.kpis === 8, `A: 8 KPI tiles rendered (${state.kpis})`);
    assert(state.subjectRows === 3, `A: 3 subject rows rendered (${state.subjectRows})`);
    assert(state.chapterRows >= 5, `A: chapter ranking rendered (${state.chapterRows} rows)`);
    assert(state.errCols === 1, 'A: error-matrix forensics two-column panel rendered');
    assert(state.srStats >= 5, `A: vault SR health stats rendered (${state.srStats})`);
    assert(state.eloBars === 3, `A: ELO panel rendered (${state.eloBars} subject bars)`);
    assert(/slope/.test(state.heroMeta), 'A: hero meta strip (slope / r²) rendered');
    await shot(page, '01-analysis-full');
    assert(!errors.length, 'A: zero console/page errors');
    if (errors.length) note('A log: ' + JSON.stringify(errors, null, 2));
    await context.close();
} catch (e) {
    assert(false, 'A: scenario threw — ' + e.message);
}

// ─────────────────────────────── Scenario B ───────────────────────────────
// Metric + range pills swap the hero series without errors.
try {
    const { context, page, errors } = await newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await dismissBoot(page);
    await page.evaluate(() => {
        const nav = document.querySelector('.nav-item[data-tab="analysis"]');
        if (nav) nav.click();
    });
    await page.waitForTimeout(1600);

    // Fresh context → fresh IndexedDB. Seed via the live AppState instead
    // (renderAnalysis reads AppState directly).
    await page.evaluate(() => {
        const now = Date.now(), DAY = 86400000;
        for (let i = 0; i < 40; i++) {
            const d = new Date(now - (i * DAY));
            window.AppState.questionBank.push({
                id: 'b-' + i, subject: 'physics', chapter: 'Kinematics',
                status: 'solved', firstAttemptResult: 'correct', errorReason: null,
                qElo: 1300, lastReviewedAt: d.toISOString(), timeTaken: 150,
                easeFactor: 2.5, currentInterval: 3,
                nextReviewAt: new Date(now + 86400000).toISOString(),
                isMastered: false, historyLogs: [],
            });
        }
    });
    await page.evaluate(() => window.renderAnalysis());
    await page.waitForTimeout(800);

    // Metric → Raw Solves
    await page.click('#analysis-metric-pills button[data-metric="solves"]');
    await page.waitForTimeout(700);
    // Range → ALL
    await page.click('#analysis-range-pills button[data-range="all"]');
    await page.waitForTimeout(700);
    // Metric → Error Fixes, Range → 30
    await page.click('#analysis-metric-pills button[data-metric="fixes"]');
    await page.waitForTimeout(500);
    await page.click('#analysis-range-pills button[data-range="30"]');
    await page.waitForTimeout(700);

    const pillState = await page.evaluate(() => ({
        metric: document.querySelector('#analysis-metric-pills .matrix-pill.active')?.getAttribute('data-metric'),
        range: document.querySelector('#analysis-range-pills .matrix-pill.active')?.getAttribute('data-range'),
        candleNodes: document.getElementById('analysis-progress-graph').querySelectorAll('rect,line,path,polyline').length,
    }));
    assert(pillState.metric === 'fixes', `B: metric pill active = fixes (${pillState.metric})`);
    assert(pillState.range === '30', `B: range pill active = 30 (${pillState.range})`);
    assert(pillState.candleNodes > 10, `B: chart re-rendered after pill swaps (${pillState.candleNodes} nodes)`);
    await shot(page, '02-analysis-fixes-30');
    assert(!errors.length, 'B: zero console/page errors across pill swaps');
    if (errors.length) note('B log: ' + JSON.stringify(errors, null, 2));
    await context.close();
} catch (e) {
    assert(false, 'B: scenario threw — ' + e.message);
}

// ─────────────────────────────── Scenario C ───────────────────────────────
// Chapter row click → vault tab + chapter search applied.
try {
    const { context, page, errors } = await newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await dismissBoot(page);
    // Seed through the app's IDB mirror BEFORE the tab switch, because
    // switchTab() re-hydrates the bank from IndexedDB (wiping in-memory pushes).
    await page.evaluate(() => {
        const q = {
            // Apostrophe in the chapter name exercises the inline-onclick
            // encoding (encodeURIComponent + %27 hardening) in analysis.js.
            id: 'c-1', subject: 'physics', chapter: "Thermo's",
            status: 'wrong', firstAttemptResult: 'incorrect', errorReason: 'conceptual',
            qElo: 1500, timeTaken: 200, easeFactor: 2.0, currentInterval: 1,
            nextReviewAt: new Date().toISOString(), isMastered: false,
            historyLogs: [{ id: 'l1', timestamp: new Date().toISOString(), result: 'incorrect', autonomy: 'independent', frictionTypes: '["CONCEPT"]', timeSpentMins: 4, performanceQ: 0.3, newInterval: 1, newEaseFactor: 2.0 }],
            imageDataUrl: null, diagramImageUrl: null,
        };
        return window._idbMirror.set('jeemax_question_bank', [q]);
    });
    await page.evaluate(() => {
        const nav = document.querySelector('.nav-item[data-tab="analysis"]');
        if (nav) nav.click();
    });
    await page.waitForTimeout(1600);

    await page.click('#analysis-chapter-body .analysis-chapter-row:first-child');
    await page.waitForTimeout(1600); // switchTab + folder click + matrix search

    const vaultState = await page.evaluate(() => {
        const v = document.getElementById('view-errors');
        const search = document.getElementById('filter-tag');
        const rows = document.querySelectorAll('#error-list-container .error-block');
        return {
            vaultActive: !!(v && v.classList.contains('active')),
            searchVal: search ? search.value : '',
            visibleRows: Array.from(rows).filter(r => !r.classList.contains('hidden')).length,
        };
    });
    assert(vaultState.vaultActive, 'C: vault (#view-errors) is active after chapter jump');
    assert(vaultState.searchVal === "Thermo's", `C: vault search seeded with decoded chapter name ("${vaultState.searchVal}")`);
    assert(!errors.length, 'C: zero console/page errors on chapter jump');
    if (errors.length) note('C log: ' + JSON.stringify(errors, null, 2));
    await shot(page, '03-chapter-jump-vault');
    await context.close();
} catch (e) {
    assert(false, 'C: scenario threw — ' + e.message);
}

// ─────────────────────────────── Scenario D ───────────────────────────────
// Empty bank → graceful empty states, no crash.
try {
    const { context, page, errors } = await newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await dismissBoot(page);
    await page.evaluate(() => {
        const nav = document.querySelector('.nav-item[data-tab="analysis"]');
        if (nav) nav.click();
    });
    await page.waitForTimeout(1600);

    const emptyState = await page.evaluate(() => {
        const texts = [
            document.getElementById('analysis-subject-body'),
            document.getElementById('analysis-chapter-body'),
            document.getElementById('analysis-error-body'),
            document.getElementById('analysis-sr-body'),
        ].map(el => (el ? el.textContent : ''));
        return {
            kpis: document.querySelectorAll('#analysis-kpi-grid .analysis-kpi').length,
            emptyBodies: texts.filter(t => t.includes('No') || t.includes('Feed')).length,
            subjectEmpty: (texts[0] || '').includes('Feed some questions'),
        };
    });
    assert(emptyState.kpis === 8, `D: KPI tiles still render on empty bank (${emptyState.kpis})`);
    assert(emptyState.subjectEmpty, 'D: subject panel shows the feed-first empty state');
    assert(!errors.length, 'D: zero console/page errors on empty bank');
    if (errors.length) note('D log: ' + JSON.stringify(errors, null, 2));
    await shot(page, '04-analysis-empty');
    await context.close();
} catch (e) {
    assert(false, 'D: scenario threw — ' + e.message);
}

await browser.close();
server.close();

console.log(`\n${pass} passed, ${fail} failed`);
if (notes.length) console.log('\n--- captured console/page log ---\n' + notes.join('\n'));
console.log('\nScreenshots: ' + SHOTS + '/*.png');
process.exit(fail ? 1 : 0);
