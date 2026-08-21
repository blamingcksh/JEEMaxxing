import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const PORT = 8805;
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {} });
    try { localStorage.setItem('jeemax_nightguard_v1', JSON.stringify({ dismissed: true })); } catch {}
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(2200);
for (let i = 0; i < 6; i++) { if (!(await page.locator('.bootseq').count())) break; await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(180); }

const THEMES = {
  furnace: '255, 178, 36', synthwave: '192, 132, 252', glacier: '56, 189, 248',
  overgrowth: '52, 211, 153', bloodmoon: '239, 68, 68', sakura: '244, 114, 182', stealth: '229, 231, 235'
};
let pass = 0, fail = 0;
const assert = (c, n) => { if (c) { pass++; console.log('  ok', n); } else { fail++; console.error('  FAIL', n); } };

for (const mode of ['midnight', 'dusk']) {
  await page.evaluate(m => window.JEEMaxTheme.setMode(m), mode);
  await page.waitForTimeout(150);
  for (const [name, rgb] of Object.entries(THEMES)) {
    await page.evaluate(t => window.JEEMaxTheme.set(t), name);
    await page.waitForTimeout(120);
    const res = await page.evaluate(() => {
      const icon = getComputedStyle(document.querySelector('.nav-item.active .icon')).color;
      const kicker = getComputedStyle(document.querySelector('#view-dashboard .kicker') || document.querySelector('.kicker')).color;
      const barH = Math.round(document.getElementById('sidebar').getBoundingClientRect().height);
      return { icon, kicker, barH };
    });
    assert(res.icon.includes(rgb), `${mode}/${name}: nav icon accent (${res.icon})`);
    assert(res.kicker.includes(rgb), `${mode}/${name}: kicker accent (${res.kicker})`);
    assert(res.barH === (mode === 'dusk' ? 64 : 64), `${mode}/${name}: bar 64 (${res.barH})`);
  }
}
assert(errors.length === 0, `zero page errors (${errors.slice(0,2).join('|')})`);
await browser.close();
server.close();
console.log(`RESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
