import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8798;
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.redesign-shots');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = await new Promise(resolve => {
    const s = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        fs.readFile(path.join(ROOT, p), (err, data) => {
            if (err) { res.writeHead(404); res.end('nf'); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
});

let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 20000 }); }
catch { try { browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 20000 }); } catch (e) { console.log('NO_BROWSER'); process.exit(2); } }

const TL = 6000;
let pass = 0, fail = 0;
const assert = (cond, name) => { if (cond) { pass++; console.log('  ok', name); } else { fail++; console.error('  FAIL', name); } };

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(TL);
await page.addInitScript(() => {
    try {
        localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA'));
        localStorage.setItem('jeemax_fx_prefs', JSON.stringify({ sound: false, effects: false, haptics: false }));
    } catch {}
    try { localStorage.setItem('jeemax_nightguard_v1', JSON.stringify({ dismissed: true })); } catch {}
});
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(2500);
for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.bootseq').count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
}

assert(await page.locator('.nav-item .icon svg').count() === 6, 'nav has 6 svg icons');
const hitOk = await page.evaluate(() => {
    const el = document.querySelector('.nav-item[data-tab="dashboard"]');
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !hit || !!hit.closest('.nav-item');
});
assert(hitOk, 'dashboard nav clickable (no overlay collision)');
await page.evaluate(() => window.JEEMaxTheme && window.JEEMaxTheme.set('glacier'));
await page.waitForTimeout(250);
const glacierIcon = await page.locator('.nav-item.active .icon').evaluate(el => getComputedStyle(el).color);
assert(glacierIcon.includes('56, 189, 248'), `active icon follows glacier accent (${glacierIcon})`);
await page.evaluate(() => window.JEEMaxTheme && window.JEEMaxTheme.set('furnace'));
await page.waitForTimeout(200);
assert((await page.locator('#view-title').textContent()) === 'Grind Hub', 'title Grind Hub');
await page.locator('.nav-item[data-tab="dashboard"]').click({ timeout: TL });
await page.waitForTimeout(400);
const themeW = await page.locator('#theme-btn').evaluate(el => Math.round(el.getBoundingClientRect().width));
assert(themeW <= 40, `theme btn compact (${themeW})`);
const fbW = await page.locator('#forest-bg-btn').evaluate(el => Math.round(el.getBoundingClientRect().width));
assert(fbW <= 40, `world btn compact (${fbW})`);
await page.locator('.collapse-btn').click({ timeout: TL });
await page.waitForTimeout(350);
assert(await page.locator('.collapse-btn svg').count() === 1, 'chevron survives collapse toggle');
assert(await page.locator('#sidebar').evaluate(el => el.classList.contains('collapsed')), 'collapsed class set');
await page.locator('.collapse-btn').click({ timeout: TL });
await page.waitForTimeout(300);
assert(await page.locator('.stat-chip #top-streak').count() === 1, '#top-streak kept');
assert(await page.locator('.header-actions .icon-btn').count() === 1, 'calendar icon-btn');
const barH = await page.locator('#sidebar').evaluate(el => Math.round(el.getBoundingClientRect().height));
assert(barH === 64, `bar height 64 (${barH})`);
assert(errors.length === 0, `no page errors (${errors.slice(0,2).join('|')})`);

await page.screenshot({ path: path.join(OUT, 'v4-dashboard.png') });
await browser.close();
server.close();
console.log(`RESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
