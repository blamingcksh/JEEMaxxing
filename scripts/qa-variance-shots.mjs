// Visual QA for the Daily Variance contribution graph (green ramp).
// Serves the repo, seeds a synthetic year of solve history, renders the
// heatmap, and screenshots the variance card to .qa-shots/<name>.png.
// Usage: node scripts/qa-variance-shots.mjs <name> [port]
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const name = process.argv[2] || 'variance';
const PORT = Number(process.argv[3] || 8797);
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';
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
            res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
});

let browser;
try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
} catch {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });
for (let i = 0; i < 6; i++) {
    const overlay = page.locator('.bootseq');
    if (!(await overlay.count())) break;
    if (!(await overlay.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
}
await page.locator('#view-dashboard .dash-card-variance').waitFor({ state: 'visible', timeout: 15000 });

// Seed a deterministic synthetic year: rest days, partial days, on-target
// days and overshoot days so all four ramp levels appear. A getter/setter
// guard keeps late boot hydration from wiping the synthetic ledger.
await page.evaluate(() => {
    const TARGET = 30;
    let seed = 42;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const buckets = [0, 0.25, 0.55, 0.8, 1.05, 1.4];
    const today = new Date();
    const start = new Date(today.getFullYear(), 0, 1, 12);
    const entries = [];
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
        const pick = buckets[Math.floor(rand() * buckets.length)];
        const count = Math.round(TARGET * pick * (0.85 + rand() * 0.3));
        const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const third = Math.round(count / 3);
        entries.push({ date: key, physics: third, chemistry: third, maths: count - 2 * third, count });
    }
    let hold = entries;
    Object.defineProperty(window, '_dailyHistoryCache', {
        configurable: true,
        get() { return hold; },
        set() { /* boot hydration must not wipe the synthetic ledger */ },
    });
});

let counts = {};
for (let attempt = 0; attempt < 5; attempt++) {
    await page.evaluate(async () => {
        const mod = await import('/app.js');
        await mod.renderDailyVarianceHeatmap();
    });
    await page.waitForTimeout(350);
    counts = await page.evaluate(() => {
        const dots = Array.from(document.querySelectorAll('.daily-variance-dot'));
        const byLevel = {};
        for (const d of dots) byLevel[d.dataset.level] = (byLevel[d.dataset.level] || 0) + 1;
        return byLevel;
    });
    if ((counts['1'] || 0) + (counts['2'] || 0) + (counts['3'] || 0) + (counts['4'] || 0) > 10) break;
    console.log('retry', attempt, JSON.stringify(counts));
}
console.log('dot levels:', JSON.stringify(counts));

// Quantify the ramp: composited dot colors per level over the card surface.
const ramp = await page.evaluate(() => {
    const card = document.querySelector('.dash-card-variance');
    const cs = getComputedStyle(card);
    const track = cs.getPropertyValue('--dv-track').trim();
    const out = { track };
    for (let lvl = 1; lvl <= 4; lvl++) {
        const dot = document.querySelector('.daily-variance-dot[data-level="' + lvl + '"]');
        if (!dot) continue;
        const s = getComputedStyle(dot);
        out['L' + lvl] = { bg: s.backgroundColor, shadow: s.boxShadow.slice(0, 80) };
    }
    return out;
});
console.log('ramp:', JSON.stringify(ramp, null, 1));

const card = page.locator('#view-dashboard .dash-card-variance');
await card.screenshot({ path: path.join(SHOTS, name + '.png') });
console.log('shot:', path.join(SHOTS, name + '.png'));
if (errors.length) console.log('pageerrors:', errors.slice(0, 5));

await browser.close();
server.close();