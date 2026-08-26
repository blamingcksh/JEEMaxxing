// audit-vault-perf.mjs — large-bank vault render/scroll benchmark at iPad size.
// Measures: cortex context build (cold/warm), board render, filter pass,
// daily-queue snapshot build, scroll frame stability on the Errors view, and
// visible backdrop-filter count. READ-ONLY.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8979;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const server = await new Promise(r => {
    const s = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        fs.readFile(path.join(ROOT, p), (e, d) => {
            if (e) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
            res.end(d);
        });
    });
    s.listen(PORT, '127.0.0.1', () => r(s));
});
let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
const page = await browser.newPage({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true });
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
    window.__frames = [];
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => orig(t => { window.__frames.push(t); cb(t); });
});
page.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0, 200)));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 8; i++) {
    if (!(await page.locator('.bootseq').count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
}
await page.waitForTimeout(1200);
console.log('pointerCoarse:', await page.evaluate(() => matchMedia('(pointer: coarse)').matches));

// ── Seed a realistic large bank: 600 tracked errors with history + tags ──
await page.evaluate(async () => {
    const storage = await import('./storage.js');
    const AppState = storage.AppState;
    const now = Date.now();
    const iso = d => new Date(now + d * 86400000).toISOString();
    const chapters = { physics: ['Rotational Motion', 'Electrostatics', 'SHM', 'Thermo'], chemistry: ['Mole Concept', 'Equilibrium', 'GOC'], maths: ['Matrices', 'Integrals', 'Probability'] };
    const tagPool = ['torque', 'rolling motion', 'gyroscope', 'capacitors', 'enthalpy', 'isomerism', 'determinants', 'definite integrals', 'bayes theorem'];
    const reasons = ['conceptual', 'calculation', 'misread'];
    let n = 0;
    for (let i = 0; i < 600; i++) {
        const subj = ['physics', 'chemistry', 'maths'][i % 3];
        const ch = chapters[subj][i % chapters[subj].length];
        const overdue = -(i % 9);
        n++;
        AppState.questionBank.push({
            id: 'pv-' + n,
            subject: subj, chapter: ch,
            extractedText: 'Perf probe question ' + n,
            options: [], correctAnswer: '', type: 'text',
            status: i % 7 === 0 ? 'solved' : 'error',
            errorReason: reasons[i % 3],
            currentInterval: i % 12, easeFactor: 2.5 - (i % 10) * 0.1,
            nextReviewAt: iso(overdue), targetTimeMins: 5, isMastered: false,
            qElo: 1000 + (i % 1000),
            createdAt: iso(-(i % 80) - 2),
            lastReviewedAt: iso(-(i % 20)),
            lastSolvedAt: (i % 5 === 0) ? iso(-(i % 15)) : null,
            tags: [tagPool[i % tagPool.length], tagPool[(i + 3) % tagPool.length]],
            historyLogs: [
                { id: 'h' + n + 'a', timestamp: iso(-((i % 30) + 5)), result: i % 3 ? 'incorrect' : 'correct', frictionTypes: JSON.stringify([i % 2 ? 'CONCEPT' : 'CALC']) },
                { id: 'h' + n + 'b', timestamp: iso(-(i % 6)), result: i % 4 ? 'incorrect' : 'correct', frictionTypes: '[]' },
            ],
            stability: 3 + (i % 25), difficultyD: 4 + (i % 4), reps: 2 + (i % 5), lapses: i % 3,
        });
    }
});

await page.evaluate(() => {
    const el = document.querySelector('.subject-folder[data-subject="physics"]');
    window.openErrorMatrix('physics', el);
});

const results = {};
// ── Render timings (median of 3) ──
results.renderMs = await page.evaluate(async () => {
    const t = async (fn) => {
        const s = performance.now(); fn();
        await new Promise(r => setTimeout(r, 0));
        return Math.round(performance.now() - s);
    };
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await t(() => window.renderErrorMatrixFromBank()));
    return { boardRender: runs };
});
results.filterMs = await page.evaluate(async () => {
    const runs = [];
    for (let i = 0; i < 3; i++) {
        const s = performance.now();
        window.filterErrors && window.filterErrors();
        await new Promise(r => setTimeout(r, 0));
        runs.push(Math.round(performance.now() - s));
    }
    return runs;
});
results.queueSnapshotMs = await page.evaluate(() => {
    const s = performance.now();
    const ids = window._getDailyQueueSnapshot();
    return { ms: Math.round(performance.now() - s), eligible: ids.length };
});
// ── Cortex priority memo sanity: second full sort should be ~free ──
results.resortMs = await page.evaluate(() => {
    const s = performance.now();
    window.renderErrorMatrixFromBank();
    return Math.round(performance.now() - s);
});
// ── Scroll frames on the errors view ──
results.scroll = await page.evaluate(async () => {
    const el = document.querySelector('.main-content') || document.scrollingElement;
    window.__frames.length = 0;
    const start = performance.now();
    let dir = 1;
    while (performance.now() - start < 5000) {
        el.scrollBy(0, dir * 300);
        if (el.scrollHeight - el.clientHeight - el.scrollTop < 4) dir = -1;
        if (el.scrollTop <= 0 && dir === -1) dir = 1;
        await new Promise(r => requestAnimationFrame(r));
    }
    await new Promise(r => setTimeout(r, 300));
    const f = window.__frames;
    let dropped = 0, long = 0;
    for (let i = 1; i < f.length; i++) {
        const d = f[i] - f[i - 1];
        if (d > 25) dropped++;
        if (d > 50) long++;
    }
    return { frames: f.length, avgFps: f.length > 1 ? Math.round(f.length / ((f[f.length - 1] - f[0]) / 1000)) : 0, droppedOver25: dropped, longOver50: long };
});
// ── Visible blur census on this view ──
results.visibleBlurred = await page.evaluate(() => {
    let v = 0;
    for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (!cs.backdropFilter || cs.backdropFilter === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden') v++;
    }
    return v;
});
console.log(JSON.stringify(results, null, 1));
await browser.close(); server.close();
