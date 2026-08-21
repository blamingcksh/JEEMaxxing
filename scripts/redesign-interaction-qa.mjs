import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const PORT = 8806;
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
catch { browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 20000 }); }
let pass = 0, fail = 0;
const assert = (c, n) => { if (c) { pass++; console.log('  ok', n); } else { fail++; console.error('  FAIL', n); } };
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(8000);
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
await page.waitForTimeout(2200);
for (let i = 0; i < 6; i++) { if (!(await page.locator('.bootseq').count())) break; await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(180); }

// 1 · Sprint starts from the widget and ticks
await page.locator('#pomo-mini-widget .mini-go').click({ timeout: 5000 });
await page.waitForTimeout(1600);
const st = await page.evaluate(() => ({
    state: document.getElementById('pomo-mini-widget').dataset.state,
    status: document.getElementById('mini-status').textContent,
    time: document.getElementById('mini-time').textContent
}));
assert(st.state === 'study', `widget sprint state=study (${st.state})`);
assert(/STUDY|SPRINT/.test(st.status), `widget status live (${st.status})`);
// pause → resume via widget toggle
await page.locator('#mini-pause').click({ timeout: 5000 });
await page.waitForTimeout(300);
const paused = await page.evaluate(() => document.getElementById('timer-status').textContent);
assert(/Paused/i.test(paused), `pause works (${paused})`);
await page.locator('#mini-pause').click({ timeout: 5000 });
await page.waitForTimeout(300);
// quit (quit-confirm modal appears for study) — confirm ends the session
await page.locator('#mini-stop').click({ timeout: 5000 });
await page.waitForTimeout(400);
const confirmUp = await page.evaluate(() => document.getElementById('timer-notify-modal').classList.contains('active'));
assert(confirmUp, 'quit-confirm modal opens');
await page.evaluate(() => { const b = document.querySelector('#timer-notify-modal .btn-primary'); if (b) b.click(); });
await page.waitForTimeout(800);
const confirmClosed = await page.evaluate(() => !document.getElementById('timer-notify-modal').classList.contains('active'));
assert(confirmClosed, 'quit-confirm closes cleanly');

// 2 · Calendar modal opens from header icon-btn
await page.locator('.header-actions .icon-btn').click({ timeout: 5000 });
await page.waitForTimeout(350);
const calOpen = await page.evaluate(() => {
    const m = document.getElementById('calendar-modal');
    return m && m.classList.contains('active');
});
assert(calOpen, 'calendar modal opens');
await page.keyboard.press('Escape');
// close via closeModalStr button
await page.evaluate(() => window.closeModalStr && closeModalStr('calendar-modal'));
await page.waitForTimeout(250);

// 3 · Upload modal (Feed Questions) renders both tracks
await page.evaluate(() => openModal('upload-modal'));
await page.waitForTimeout(350);
const tracks = await page.evaluate(() => ({
    a: !!document.getElementById('ingestion-panel-multicrop'),
    b: !!document.getElementById('ingestion-panel-texttrack'),
    active: document.querySelector('.ingestion-panel.active') ? document.querySelector('.ingestion-panel.active').id : null
}));
assert(tracks.a && tracks.b && tracks.active === 'ingestion-panel-multicrop', 'upload modal tracks intact');
await page.evaluate(() => closeModalStr('upload-modal'));

// 4 · Vault: switch subject folder re-renders title
await page.locator('.nav-item[data-tab="errors"]').click({ timeout: 5000 });
await page.waitForTimeout(900);
await page.locator('.subject-folder[data-subject="maths"]').click({ timeout: 5000 });
await page.waitForTimeout(500);
const vaultTitle = await page.evaluate(() => document.getElementById('error-matrix-title').textContent);
assert(/maths/i.test(vaultTitle), `vault subject switches (${vaultTitle})`);
// daily queue button present + enabled
const qBtn = await page.evaluate(() => { const b = document.getElementById('daily-queue-btn'); return !!(b && typeof window.toggleDailyQueue === 'function'); });
assert(qBtn, 'daily fix queue wired');

// 5 · Practice flow reaches chapter list
await page.locator('.nav-item[data-tab="practice"]').click({ timeout: 5000 });
await page.waitForTimeout(700);
await page.locator('.subject-card').first().click({ timeout: 5000 });
await page.waitForTimeout(600);
const chaptersVisible = await page.evaluate(() => {
    const v = document.getElementById('practice-chapters-view');
    return v && v.classList.contains('active');
});
assert(chaptersVisible, 'chapter subview activates');

assert(errors.length === 0, `zero page errors (${errors.slice(0,2).join('|')})`);
await browser.close();
server.close();
console.log(`RESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
