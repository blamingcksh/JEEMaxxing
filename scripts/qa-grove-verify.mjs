// qa-grove-verify.mjs - objective verification for the grove v2 rebuild.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shots = path.join(root, '.redesign-shots', 'grove-v2');
fs.mkdirSync(shots, { recursive: true });

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  fs.readFile(path.join(root, p), (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    const ext = path.extname(p);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime });
    res.end(data);
  });
});
await new Promise(r => server.listen(8799, '127.0.0.1', r));

const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = ymd(new Date());

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try { return await chromium.launch({ channel, headless: true }); } catch (e) {}
  }
  return await chromium.launch({ headless: true });
}

const browser = await launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((t) => {
  localStorage.setItem('jeemax_forest_bg', '1');
  localStorage.setItem('jeemax_forest_daily_v1', JSON.stringify({ [t]: { physics: 8, chemistry: 4, maths: 3 } }));
  localStorage.setItem('jeemax_grove_v1', JSON.stringify({ activeBiome: 'temperate', activeSpecies: 'pine', subjectSpecies: { physics: 'pine', chemistry: 'oak', maths: 'pine' }, daily: {} }));
  localStorage.setItem('jeemax_boot_seq_date', t);
  localStorage.setItem('jeemax_fx_prefs', JSON.stringify({ effects: true, audio: false }));
}, today);
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('http://127.0.0.1:8799/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => !!document.getElementById('gi-host'), null, { timeout: 30000 });
await page.waitForFunction(() => window.__groveIslands && window.__groveIslands.trees() > 0, null, { timeout: 30000 });
await page.waitForTimeout(2500);

const api = await page.evaluate(() => ({
  trees: window.__groveIslands.trees(),
  elo: window.__groveIslands.elo(),
  view: window.__groveIslands.view(),
  biome: window.__groveIslands.state().activeBiome
}));
console.log('API state:', JSON.stringify(api));

await page.click('#gi-btn-full');
await page.waitForSelector('#gi-full-overlay.open', { timeout: 5000 });
await page.waitForTimeout(2200);
await page.screenshot({ path: path.join(shots, 'after-full-explorer.png') });
const fullInfo = await page.evaluate(() => ({
  trees: document.getElementById('gi-full-trees').textContent,
  meta: document.getElementById('gi-full-meta').textContent
}));
console.log('full explorer:', JSON.stringify(fullInfo));
await page.click('#gi-full-periods button[data-period="week"]');
await page.waitForTimeout(1200);
console.log('period after switch:', await page.evaluate(() => window.__groveIslands.view().period));
await page.click('#gi-full-close');
await page.waitForTimeout(400);

await page.click('#gi-btn-store');
await page.waitForSelector('#gi-store-overlay.open', { timeout: 5000 });
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(shots, 'after-store.png') });
await page.click('button.gi-tab-btn[data-tab="trees"]');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(shots, 'after-store-trees.png') });
console.log('store species cards:', await page.evaluate(() => document.querySelectorAll('#gi-tab-trees .gi-store-card').length));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

await page.click('#gi-btn-map');
await page.waitForSelector('#gi-map-overlay.open', { timeout: 5000 });
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(shots, 'after-map.png') });
console.log('unlocked map nodes:', await page.evaluate(() => document.querySelectorAll('#gi-map-svg .gi-node:not(.gi-node-locked)').length));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

await page.evaluate(() => window.__groveIslands.travel('temperate', true));
await page.waitForTimeout(1500);

const host = await page.$('#gi-host');
await host.screenshot({ path: path.join(shots, 'after-island-widget.png') });
await page.screenshot({ path: path.join(shots, 'after-full-dashboard.png') });

const pixel = await page.evaluate(() => {
  const c = document.getElementById('gi-card');
  const t = document.createElement('canvas');
  t.width = c.width; t.height = c.height;
  const g = t.getContext('2d');
  g.drawImage(c, 0, 0);
  const w = t.width, h = t.height;
  function band(y0, y1) {
    let r = 0, gg = 0, b = 0, n = 0;
    const colors = new Set();
    const img = g.getImageData(0, Math.floor(h * y0), w, Math.max(1, Math.floor(h * (y1 - y0))));
    const d = img.data;
    for (let y = 0; y < img.height; y += 2) {
      for (let x = 0; x < w; x += 3) {
        const i = (y * w + x) * 4;
        r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
        colors.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
      }
    }
    return { r: Math.round(r / n), g: Math.round(gg / n), b: Math.round(b / n), distinct: colors.size };
  }
  return { sky: band(0.02, 0.18), mid: band(0.40, 0.60), low: band(0.75, 0.95) };
});
console.log('PIXEL BANDS avgRGB/distinct:', JSON.stringify(pixel));
const verdict = {
  skyIsBlueish: pixel.sky.b > pixel.sky.r,
  midHasGreen: pixel.mid.g >= pixel.mid.r && pixel.mid.distinct > 8,
  lowHasWater: pixel.low.b > pixel.low.r,
  rich: pixel.mid.distinct > 8 && pixel.sky.distinct > 2
};
console.log('VERDICT:', JSON.stringify(verdict));
console.log('pageerrors/console errors:', errors.length ? JSON.stringify(errors) : 'none');
server.close();
await browser.close();
process.exit(errors.length ? 1 : 0);