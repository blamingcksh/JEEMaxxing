// Visual + functional QA for the redesigned Today's Progress card.
// Serves the repo on 127.0.0.1:8791, drives the card in headless Edge/Chrome,
// asserts hydration + interactions, and drops screenshots into SHOTS.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8793/index.html';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = 'C:/Users/Chaksh/AppData/Local/Temp/opencode/tp-shots';
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
            res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    s.listen(8793, '127.0.0.1', () => resolve(s));
});
console.log('server up');

let browser;
try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
} catch {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// Pre-seed the boot-briefing daily guard so the overlay never mounts
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

let pass = 0, fail = 0;
const assert = (cond, name) => {
    if (cond) { pass++; console.log('  ok', name); }
    else { fail++; console.error('  FAIL', name); }
};

await page.goto(BASE, { waitUntil: 'networkidle' });
// Dismiss the boot-sequence briefing if it appears (Escape aborts it)
for (let i = 0; i < 6; i++) {
    const overlay = page.locator('.bootseq');
    if (!(await overlay.count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
}
assert(!(await page.locator('.bootseq').count()), 'boot briefing dismissed');
await page.waitForTimeout(800);

const card = page.locator('.dash-card-tracker');
assert(await card.isVisible(), 'tracker card visible');

// ── Structure (v2 redesign: hero figure + compact ledger, no SVG ring) ──
assert(await page.locator('.dash-card-tracker .tp-hero-stroke').isVisible(), 'hero stroke present');
assert(await page.locator('#tp-total-bar').count() === 1, 'hero fill bar present');
assert(await page.locator('.dash-card-tracker .compact-subject-card').count() === 3, 'three subject cards');
assert(await page.locator('.dash-card-tracker .tp-variance').isVisible(), 'variance chip in header');
const rowH = await page.locator('.dash-card-tracker .compact-subject-card').first().evaluate(el => el.getBoundingClientRect().height);
assert(rowH > 0 && rowH <= 120, `row is a slim ledger entry (${Math.round(rowH)}px ≤ 120px)`);

// ── Interaction: log solves ──
const physPlus = page.locator('.compact-subject-card[data-subject="physics"] .tp-step-btn').nth(1);
const chemPlus = page.locator('.compact-subject-card[data-subject="chemistry"] .tp-step-btn').nth(1);
for (let i = 0; i < 7; i++) await physPlus.click();
await chemPlus.click();
await page.waitForTimeout(700);

const physCount = await page.locator('#physics-count').textContent();
assert(physCount.trim() === '7', `physics counter hydrated (${physCount})`);
const chemCount = await page.locator('#chemistry-count').textContent();
assert(chemCount.trim() === '1', `chemistry counter hydrated (${chemCount})`);

// Hero fill mirrors progress: physics 7/10 → 70%
const physFill = await page.locator('#physics-bar').evaluate(el => el.style.width);
assert(physFill === '70%', `physics fill at 70% (width ${physFill})`);
const total = await page.locator('#tp-total').textContent();
assert(total.trim() === '8', `hub total = 8 (${total})`);
const tgt = await page.locator('#tp-total-tgt').textContent();
assert(tgt.trim() === '/ 30', `hub target label (${tgt})`);
const variance = await page.locator('#variance-val').textContent();
assert(variance.includes('-'), `variance negative while under target (${variance})`);

// Decrement works too
await page.locator('.compact-subject-card[data-subject="physics"] .tp-step-btn').first().click();
await page.waitForTimeout(300);
assert((await page.locator('#physics-count').textContent()).trim() === '6', 'decrement works');
assert((await page.locator('#tp-total').textContent()).trim() === '7', 'hub total updates on decrement');

// fx bump class lands on the counter (fx.js fix)
await chemPlus.click();
const bumped = await page.evaluate(() => new Promise(res => {
    const btn = document.querySelector('.compact-subject-card[data-subject="chemistry"] .tp-step-btn:last-child');
    btn.click();
    setTimeout(() => res(document.querySelector('#chemistry-count').classList.contains('fx-bump')), 120);
}));
assert(bumped, 'fx-bump lands on the counter span');

await page.screenshot({ path: path.join(SHOTS, 'dashboard-full.png') });
await card.screenshot({ path: path.join(SHOTS, 'tracker-card.png') });

// ── Narrow card: ledger must stay single-column and never overflow ──
await page.setViewportSize({ width: 400, height: 900 });
await page.waitForTimeout(500);
const narrowOk = await page.evaluate(() => {
    const doc = document.documentElement;
    const noHScroll = doc.scrollWidth - doc.clientWidth <= 0;
    const ledger = document.querySelector('.dash-card-tracker .tp-ledger');
    return noHScroll && !!ledger && ledger.getBoundingClientRect().height > 40;
});
assert(narrowOk, 'narrow viewport: ledger intact, no horizontal overflow');
await card.screenshot({ path: path.join(SHOTS, 'tracker-narrow.png') });

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.slice(0, 10).join('\n'));
else console.log('no console/page errors');

await browser.close();
server.close();
process.exit(fail || errors.length ? 1 : 0);
