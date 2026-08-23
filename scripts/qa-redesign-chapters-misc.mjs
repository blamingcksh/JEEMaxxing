// One-off live checks: calm-mode (fx-effects-off) animation kill, narrow
// padding token, and a final fresh screenshot set.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '.qa-shots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
process.on('uncaughtException', err => { console.error('UNCAUGHT:', err && err.message || err); process.exit(1); });
const server = await new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        fs.readFile(path.join(ROOT, p), (err, data) => {
            if (err) { res.writeHead(404); res.end('nf'); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    s.on('error', reject);
    s.listen(8815, '127.0.0.1', () => resolve(s));
});
let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:8815')) return route.continue();
    return route.fulfill({ status: 200, contentType: url.includes('/css/') ? 'text/css' : 'application/javascript', body: '' }).catch(() => {});
});
let pass = 0, fail = 0;
const assert = (c, n, x = '') => { if (c) { pass++; console.log('  ok', n, x); } else { fail++; console.error('  FAIL', n, x); } };

await page.goto('http://127.0.0.1:8815/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(3000);
for (let i = 0; i < 6; i++) { if (!(await page.locator('.bootseq').count())) break; await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(350); }

await page.evaluate(() => {
    const chapters = { physics: ['Rotational Motion','Electrostatics'], chemistry: ['Mole Concept'], maths: ['Calculus'] };
    const bank = [
        { id: 'a1', subject: 'physics', chapter: 'Rotational Motion', status: 'unsolved' },
        { id: 'a2', subject: 'physics', chapter: 'Electrostatics', status: 'solved' },
        { id: 'a3', subject: 'chemistry', chapter: 'Mole Concept', status: 'solved' },
        { id: 'a4', subject: 'maths', chapter: 'Calculus', status: 'solved' },
        { id: 'a5', subject: 'maths', chapter: 'Calculus', status: 'solved' },
    ];
    window.AppState.chapters = chapters;
    window.AppState.questionBank = bank;
});

// Calm mode ON before first paint of the card: animation must be dead
await page.evaluate(() => document.documentElement.classList.add('fx-effects-off'));
await page.evaluate(() => window.renderChapterProgressList());
await new Promise(r => setTimeout(r, 400));
const calm = await page.evaluate(() => {
    const el = document.querySelector('.cpx-track i');
    return getComputedStyle(el).animationName;
});
assert(calm === 'none' || calm === '', 'fx-effects-off kills the grow animation', calm);
await page.evaluate(() => document.documentElement.classList.remove('fx-effects-off'));
// Fresh first-paint with motion allowed; sample mid-animation (~150ms in)
await page.evaluate(() => { delete document.getElementById('chapter-progress-list').dataset.cpxReady; window.renderChapterProgressList(); });
await new Promise(r => setTimeout(r, 150));
const alive = await page.evaluate(() => getComputedStyle(document.querySelector('.cpx-track i')).animationName);
assert(alive === 'cpx-grow', 'motion returns in normal mode', alive);

// Narrow padding via token
await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(500);
const padNarrow = await page.evaluate(() => getComputedStyle(document.querySelector('.dash-card-progress')).paddingLeft);
assert(parseFloat(padNarrow) === 22, 'narrow padding lands via --card-pad token', padNarrow);
const padDesk = await page.evaluate(() => { window.dispatchEvent(new Event('resize')); return null; });
void padDesk;
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(400);
const padWide = await page.evaluate(() => getComputedStyle(document.querySelector('.dash-card-progress')).paddingLeft);
assert(parseFloat(padWide) === 38, 'desktop padding restored', padWide);

console.log(pass + ' passed, ' + fail + ' failed');
if (errors.length) console.log('CONSOLE ERRORS: ' + errors.slice(0, 4).join(' | ')); else console.log('no console/page errors');
await browser.close();
server.close();
process.exit(fail || errors.length ? 1 : 0);
