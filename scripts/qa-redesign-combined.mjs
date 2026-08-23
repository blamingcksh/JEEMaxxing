// Combined integration sweep v2 — all three redesigned dashboard components in ONE boot.
// Every step logged to an in-memory buffer AND persisted to .qa-shots/redesign-all-report.txt
// (stdout through pipes can drop buffered lines on process.exit).
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8814/index.html';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '.qa-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const LOG = [];
const say = (line) => { LOG.push(line); };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
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
  s.listen(8814, '127.0.0.1', () => resolve(s));
});
say('server up');

let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.route('**/sw.js', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
await page.addInitScript(() => {
  try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
  navigator.serviceWorker?.getRegistrations?.().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
});
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; say('  ok   ' + n); } else { fail++; say('  FAIL ' + n); } };
const step = async (name, fn) => { try { await fn(); } catch (e) { fail++; say('  FAIL ' + name + ' threw: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | ').slice(0, 300)); } };

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.bootseq').count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
  }
  ok(!(await page.locator('.bootseq').count()), 'boot briefing dismissed');

  ok(await page.locator('.dash-card-tracker').isVisible(), 'DAILY card visible');
  ok(await page.locator('.dash-card-decay').isVisible(), 'RETENTION card visible');
  ok(await page.locator('.dash-card-progress').isVisible(), 'CHAPTERS card visible');
  ok(await page.locator('#chapter-progress-list').count() > 0, 'chapter list container mounted');
  ok(await page.locator('#chapter-decay-grid').count() > 0, 'decay grid container mounted');

  // How many steppers does a row actually have now?
  await step('row stepper probe', async () => {
    const n = await page.locator('.compact-subject-card[data-subject="physics"] button').count();
    say('  info physics row button count = ' + n);
  });

  await step('click steppers', async () => {
    const btns = page.locator('.compact-subject-card[data-subject="physics"] button');
    const n = await btns.count();
    if (n >= 2) { await btns.nth(1).click(); await btns.nth(1).click(); }
    else if (n === 1) { await btns.nth(0).click(); await btns.nth(0).click(); }
    const chem = page.locator('.compact-subject-card[data-subject="chemistry"] button');
    await (await chem.count()) >= 2 ? chem.nth(1).click() : chem.first().click();
    await page.waitForTimeout(900);
  });

  await step('hero total check', async () => {
    const total = ((await page.locator('#tp-total').textContent()) || '').trim();
    ok(total === '3', 'hero total updates to 3 (got "' + total + '")');
  });

  await step('variance check', async () => {
    const v = ((await page.locator('#variance-val').textContent()) || '').trim();
    ok(v.length > 0, 'variance readout populated ("' + v + '")');
  });

  await step('group screenshot', async () => {
    await page.waitForTimeout(400);
    await page.locator('#view-dashboard').screenshot({ path: path.join(SHOTS, 'redesign-all-after.png') });
    say('  info shot saved: .qa-shots/redesign-all-after.png');
  });
} catch (e) {
  fail++;
  say('  FAIL outer exception: ' + String(e && e.stack || e).slice(0, 400));
}

ok(errors.length === 0, 'zero console/page errors (' + errors.length + ')');
errors.slice(0, 8).forEach(e => say('  err: ' + e.slice(0, 200)));

say('');
say('COMBINED SWEEP: ' + pass + ' passed, ' + fail + ' failed');

browser.close().catch(() => {});
server.close();
fs.writeFileSync(path.join(SHOTS, 'redesign-all-report.txt'), LOG.join('\n') + '\n');
