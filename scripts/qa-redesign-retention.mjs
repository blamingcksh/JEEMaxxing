// qa-redesign-retention.mjs — visual + functional QA for the redesigned
// Retention Health card (.dash-card-decay / #chapter-decay-grid).
// Serves the repo on 127.0.0.1:8812, seeds a realistic memory ledger
// (healthy ~95% · fading 80-90% · critical <75%, one very long chapter name,
// varied coverage), drives headless Edge/Chrome, asserts hydration +
// statuses + drilldown, and drops screenshots into .qa-shots.
//
// Usage: node scripts/qa-redesign-retention.mjs [before|after]
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODE = (process.argv[2] || 'before').toLowerCase();
const PORT = 8812;
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '.qa-shots');
fs.mkdirSync(SHOTS, { recursive: true });

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
            res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            res.end(data);
        });
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
});
console.log('server up on ' + BASE);

let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 20000 }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 20000 }); }

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();

// Pre-seed the boot-briefing daily guard so the overlay never mounts
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});

const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/Drive|gapi|Gemini|net::|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

let pass = 0, fail = 0;
const assert = (cond, name) => {
    if (cond) { pass++; console.log('  ok ', name); }
    else { fail++; console.error('  FAIL', name); }
};

await page.goto(BASE, { waitUntil: 'commit', timeout: 45000 });
await page.waitForFunction(() => document.readyState === 'interactive' || document.readyState === 'complete', null, { timeout: 45000 });
for (let i = 0; i < 6; i++) {
    const overlay = page.locator('.bootseq');
    if (!(await overlay.count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
}
assert(!(await page.locator('.bootseq').count()), 'boot briefing dismissed');
await page.waitForFunction(() => window.AppState && Array.isArray(window.AppState.questionBank), null, { timeout: 15000 });
await page.waitForTimeout(1200); // let boot settle

// ── Seed a realistic retention ledger ─────────────────────────────────────
// R(t) = (1 + 0.2345·t/S)^-0.5  ⇒  t = S·(R^-2 − 1)/0.2345 days ago.
const seeded = await page.evaluate(() => {
    const DAY = 86400000;
    const FACTOR = 19 / 81; // FSRS params mirror of memory.js
    const DECAY = -0.5;
    const daysAgoFor = (R, S) => S * (Math.pow(R, -2) - 1) / FACTOR;
    let uid = 0;
    const iso = d => new Date(Date.now() - d * DAY).toISOString();
    const item = (subject, chapter, R, S, extra = {}) => ({
        id: 'qa_r_' + (++uid),
        subject, chapter,
        type: ['mcq', 'numerical', 'short'][uid % 3],
        status: extra.status || 'solved',
        errorReason: extra.errorReason || 'concept gap',
        qElo: extra.qElo || (1000 + ((uid * 137) % 500)),
        easeFactor: extra.ef || 2.5,
        stability: S,
        difficultyD: extra.d ?? 5,
        reps: extra.reps ?? 4,
        lapses: extra.lapses ?? 0,
        lastReviewedAt: iso(daysAgoFor(R, S)),
        timeTaken: extra.tt || 0,
        targetTimeMins: extra.tgt || 0,
    });
    const filler = (subject, chapter, n) => Array.from({ length: n }, (_, k) => ({
        id: 'qa_f_' + (++uid), subject, chapter, type: 'mcq', status: 'solved',
        qElo: 1100 + k * 17, easeFactor: 2.5,
    }));
    const LONG = 'Chemical Bonding & Molecular Structure — Hybridisation, VSEPR and the MO Theory of Diatomic Species';
    const bank = [];
    // physics
    bank.push(
        item('physics', 'Rotational Motion', 0.95, 45, { qElo: 1400 }),
        item('physics', 'Rotational Motion', 0.96, 45, { ef: 2.6, tt: 95, tgt: 3 }),
        item('physics', 'Rotational Motion', 0.94, 45),
        item('physics', 'Rotational Motion', 0.95, 50, { status: 'wrong', errorReason: 'silly mistake' }),
        ...filler('physics', 'Rotational Motion', 14),
        item('physics', 'Electrostatics', 0.70, 8, { status: 'error', errorReason: 'formula recall' }),
        item('physics', 'Electrostatics', 0.66, 8, { d: 7, lapses: 2 }),
        item('physics', 'Electrostatics', 0.72, 9),
        ...filler('physics', 'Electrostatics', 8),
        item('physics', 'Current Electricity', 0.83, 20, { tt: 210, tgt: 4 }),
        item('physics', 'Current Electricity', 0.81, 20),
        item('physics', 'Current Electricity', 0.85, 22),
        ...filler('physics', 'Current Electricity', 2)
    );
    // chemistry
    bank.push(
        item('chemistry', 'Thermodynamics', 0.93, 50, { qElo: 1450 }),
        item('chemistry', 'Thermodynamics', 0.94, 55, { tt: 120, tgt: 3 }),
        item('chemistry', 'Thermodynamics', 0.92, 48),
        item('chemistry', 'Thermodynamics', 0.94, 52),
        ...filler('chemistry', 'Thermodynamics', 20),
        item('chemistry', 'Coordination Compounds', 0.86, 25),
        item('chemistry', 'Coordination Compounds', 0.84, 25, { ef: 2.3 }),
        item('chemistry', 'Coordination Compounds', 0.85, 26),
        item(LONG.slice(0, 0) ? '' : 'chemistry', LONG, 0.58, 6, { status: 'wrong', errorReason: 'never stuck', d: 8, lapses: 3 }),
        item('chemistry', LONG, 0.55, 6),
        item('chemistry', LONG, 0.61, 7),
        item('chemistry', 'Biomolecules', 0.63, 7, { status: 'error', errorReason: 'concept gap' }),
        item('chemistry', 'Biomolecules', 0.60, 7)
    );
    // maths
    bank.push(
        item('maths', 'Definite Integration', 0.84, 22, { tt: 260, tgt: 5 }),
        item('maths', 'Definite Integration', 0.83, 22),
        item('maths', 'Definite Integration', 0.85, 23),
        ...filler('maths', 'Definite Integration', 5),
        item('maths', 'Sequences & Series', 0.96, 60, { qElo: 1500 }),
        item('maths', 'Sequences & Series', 0.97, 65),
        item('maths', 'Sequences & Series', 0.95, 58),
        item('maths', 'Sequences & Series', 0.96, 60),
        item('maths', 'Vectors & 3D Geometry', 0.88, 30),
        item('maths', 'Vectors & 3D Geometry', 0.87, 30)
    );
    AppState.questionBank.push(...bank);
    // Exam ~90 days out so exam-day projections differ per stability
    const examIso = new Date(Date.now() + 90 * DAY).toISOString().slice(0, 10);
    try { window._setExamDate(examIso); } catch (_) { AppState.examDate = examIso; }
    try { window.renderChapterDecayGrid(); } catch (e) { return 'RENDER_ERR:' + e.message; }
    return 'seeded ' + bank.length + ' questions, exam ' + examIso;
});
console.log('  ·  ' + seeded);
assert(String(seeded).startsWith('seeded'), 'ledger seeded + grid rendered');

// ── Card structure ──
const card = page.locator('.dash-card-decay');
assert(await card.isVisible(), 'retention card visible');

const rowCount = await page.evaluate(() =>
    document.querySelectorAll('#chapter-decay-grid [onclick], #chapter-decay-grid .rh-row, #chapter-decay-grid .decay-row').length);
assert(rowCount > 0, `grid populated (${rowCount} chapter rows)`);

// Statuses represented — parse "retention NN%" out of each row tooltip
const bands = await page.evaluate(() => {
    const out = { ready: 0, fading: 0, critical: 0 };
    const texts = [];
    document.querySelectorAll('#chapter-decay-grid [title]').forEach(el => texts.push(el.getAttribute('title')));
    // Legacy SVG rows carry tooltips as <title> child nodes, not attributes
    document.querySelectorAll('#chapter-decay-grid title').forEach(t => texts.push(t.textContent));
    texts.forEach(txt => {
        const m = /retention (\d+)%/.exec(txt || '');
        if (!m) return;
        const h = Number(m[1]);
        if (h >= 90) out.ready++; else if (h >= 80) out.fading++; else out.critical++;
    });
    return out;
});
assert(bands.ready > 0 && bands.fading > 0 && bands.critical > 0,
    `all three bands represented ${JSON.stringify(bands)}`);

// Drilldown opens from a row tap (synthesized click exercises the same
// delegated handler path without depending on scroll/sticky-header geometry)
let drillOk = false;
try {
    await page.waitForTimeout(300);
    drillOk = await page.evaluate(() => {
        const row = document.querySelector('#chapter-decay-grid .rh-row, #chapter-decay-grid [onclick]');
        if (!row) return false;
        row.click();
        return !!document.querySelector('.decay-drill-overlay');
    });
    await page.keyboard.press('Escape');
} catch (_) {}
assert(drillOk, 'row tap opens item drilldown');

// Long name must not wrap ugly — single-line ellipsis enforced
const truncOk = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#chapter-decay-grid [title]')]
        .filter(el => (el.getAttribute('title') || '').includes('MO Theory'));
    return els.length === 0 || els.every(el => el.scrollHeight <= el.clientHeight + 2);
});
assert(truncOk, 'long chapter name clipped without wrap');

// ── Screenshots ──
await page.waitForTimeout(600);
await card.screenshot({ path: path.join(SHOTS, `redesign-retention-${MODE}.png`) });
await page.screenshot({ path: path.join(SHOTS, `dashboard-context-${MODE}.png`), fullPage: false });

// ── Narrow (420px): container-query reflow, NO manual re-render ──
await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(700);
assert(await card.isVisible(), 'narrow: card still visible');
const narrowRows = await page.evaluate(() =>
    document.querySelectorAll('#chapter-decay-grid [onclick], #chapter-decay-grid .rh-row').length);
assert(narrowRows > 0, 'narrow: rows survive reflow');
const noHScroll = await page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth + 1);
assert(noHScroll, 'narrow: no horizontal overflow');
await card.screenshot({ path: path.join(SHOTS, `redesign-retention-${MODE}-narrow.png`) });

console.log(`\n${pass} passed, ${fail} failed (mode=${MODE})`);
if (errors.length) console.log('CONSOLE/PAGE ERRORS:\n' + errors.slice(0, 10).join('\n---\n'));
else console.log('zero console/page errors');

await browser.close();
server.close();
process.exit(fail || errors.length ? 1 : 0);