// Layout probes for the Focus Engine redesign — verifies geometry/overlap
// and theme legibility where a screenshot can't be eyeballed.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8796;
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
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }

let pass = 0, fail = 0;
const assert = (cond, name) => { if (cond) { pass++; console.log('  ok', name); } else { fail++; console.error('  FAIL', name); } };
const overlap = (a, b) => a && b && !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });
for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.bootseq').count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
}
await page.waitForTimeout(500);

// ── A · Desktop idle: widget clear of the dashboard layout FAB ──────────
const wbox = await page.locator('#pomo-mini-widget').boundingBox();
const fab = await page.locator('#dc-layout-fab').boundingBox();
assert(fab && fab.width > 0, 'dashboard layout FAB present');
assert(!overlap(wbox, fab), `widget docked clear of layout FAB (widget bottom=${Math.round(wbox.y + wbox.height)}, fab top=${Math.round(fab?.y || 0)})`);
// v2 polish: idle chrome is neutral (furnace glow is earned by running)
const idleBorder = await page.locator('#pomo-mini-widget').evaluate(el => getComputedStyle(el).borderColor);
assert(idleBorder.includes('255, 255, 255') || idleBorder.includes('255,255,255'), `idle border neutral (${idleBorder})`);
assert(!(await page.locator('#pomo-mini-widget .mini-reason').isVisible()), 'idle caption hidden (▶ is self-explanatory)');

// ── B · Popover opens above the pill, inside the viewport ───────────────
await page.locator('#pomo-mini-widget .mini-content').click();
await page.waitForTimeout(250);
const popBox = await page.locator('#pomo-pop').boundingBox();
assert(popBox && popBox.x >= 0 && popBox.y >= 0 && popBox.x + popBox.width <= 1440 && popBox.y + popBox.height <= 900,
    `popover inside viewport (${JSON.stringify(popBox)})`);
assert(popBox && popBox.y + popBox.height <= wbox.y + 4, 'popover sits above the pill');
await page.keyboard.press('Escape');
await page.mouse.click(600, 400);   // outside click closes the popover
await page.waitForTimeout(200);
assert(!(await page.locator('#pomo-pop.open').count()), 'outside click dismisses popover');

// ── C · Mobile idle: docked above the FAB + safe area, popover usable ───
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const mbox = await page.locator('#pomo-mini-widget').boundingBox();
assert(mbox.y + mbox.height <= 844 - 60, `mobile: widget docked above FAB zone (bottom=${Math.round(mbox.y + mbox.height)})`);
assert(mbox.x + mbox.width <= 390 - 8, 'mobile: widget inside right edge');
await page.locator('#pomo-mini-widget .mini-content').click();
await page.waitForTimeout(250);
const mpop = await page.locator('#pomo-pop').boundingBox();
assert(mpop && mpop.x >= 0 && mpop.y >= 0 && mpop.x + mpop.width <= 390, `mobile popover inside viewport (${JSON.stringify(mpop)})`);
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);

// ── D · Running state: controls anchored, ring inside widget ────────────
await page.locator('#pomo-mini-widget .mini-content').click();   // reopen popover
await page.waitForTimeout(150);
await page.locator('.pop-start').click();
await page.waitForTimeout(400);
const wRun = await page.locator('#pomo-mini-widget').boundingBox();
const pauseBtn = await page.locator('#mini-pause').boundingBox();
assert(pauseBtn && pauseBtn.y >= wRun.y - 2 && pauseBtn.y + pauseBtn.height <= wRun.y + wRun.height + 2,
    'running controls anchored inside widget');

// ── E · Focus view: one-line ledger + stats, projection hydration ───────
await page.locator('[data-tab="pomodoro"]').click();
await page.waitForTimeout(500);
const ledgerDisplay = await page.locator('#focus-ledger').evaluate(el => getComputedStyle(el).display);
assert(ledgerDisplay === 'flex', `ledger is a one-line flex strip (${ledgerDisplay})`);
const ledgerH = await page.locator('#focus-ledger').evaluate(el => el.getBoundingClientRect().height);
assert(ledgerH < 70, `ledger line is slim (${Math.round(ledgerH)}px < 70px)`);
const statsVisible = await page.locator('#focus-stats-row').isVisible();
assert(statsVisible, 'all-time stats row visible');
const proj = await page.locator('#pomo-projection');
assert(await proj.isVisible() && (await proj.textContent()).length > 10, 'projection line hydrated on tab entry');
const autoBox = await page.locator('#sc-auto');
assert(await autoBox.isVisible() && await autoBox.isChecked(), 'soundscape auto-play toggle visible + default on');

// ── F · Receipt row fits inside the modal card ──────────────────────────
await page.evaluate(() => {
    document.getElementById('notify-title').textContent = 'T';
    document.getElementById('timer-notify-modal').classList.add('active');
    const r = document.getElementById('notify-receipt');
    r.innerHTML = '<div class="receipt-row"><span>Block</span><b>50:00 · PHYSICS</b></div>';
    r.hidden = false;
});
await page.waitForTimeout(200);
const rowBox = await page.locator('.receipt-row').boundingBox();
const modalBox = await page.locator('#timer-notify-modal .modal-content').boundingBox();
assert(rowBox && modalBox && rowBox.x >= modalBox.x && rowBox.x + rowBox.width <= modalBox.x + modalBox.width + 2,
    'receipt row fits inside modal card');
await page.evaluate(() => document.getElementById('timer-notify-modal').classList.remove('active'));

// ── G · Dusk theme keeps the widget surface legible ─────────────────────
await page.evaluate(() => document.documentElement.setAttribute('data-mode', 'dusk'));
await page.waitForTimeout(200);
const bg = await page.locator('#pomo-mini-widget').evaluate(el => getComputedStyle(el).backgroundColor);
assert(bg !== 'rgba(0, 0, 0, 0)', `dusk mode keeps widget surface (${bg})`);

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('PAGE ERRORS:\n' + errors.slice(0, 5).join('\n'));
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
