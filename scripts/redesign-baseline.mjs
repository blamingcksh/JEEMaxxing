import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8797;
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
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
    try {
        localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA'));
        localStorage.setItem('jeemax_fx_prefs', JSON.stringify({ sound: false, effects: false, haptics: false }));
    } catch {}
});
await page.goto(BASE, { waitUntil: 'networkidle' });
for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.bootseq').count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(250);
}
await page.waitForTimeout(800);

const tabs = ['dashboard', 'pomodoro', 'errors', 'practice', 'settings'];
for (const t of tabs) {
    try {
        await page.evaluate(tab => { const el = document.querySelector('.nav-item[data-tab="' + tab + '"]'); if (el) el.click(); }, t);
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(OUT, t + '.png') });
        console.log('shot', t);
    } catch (e) { console.log('ERR', t, String(e).slice(0, 120)); }
}
await browser.close();
server.close();
console.log('done');
