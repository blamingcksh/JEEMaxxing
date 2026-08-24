// audit-bf-diet-ab.mjs — A/B for the backdrop-filter diet on dash cards.
// Boots the dashboard at iPad size, screenshots baseline, injects the
// "solid card" treatment (the app's own bento-dragging recipe) as an override,
// screenshots again, computes pixel-diff % and runs the scroll-frame probe
// under both conditions. READ-ONLY against source files.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8987;
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = await new Promise(res => {
    const s = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        fs.readFile(path.join(ROOT, p), (err, data) => {
            if (err) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    s.listen(PORT, '127.0.0.1', () => res(s));
});

const DIET_CSS = `
#view-dashboard .dash-card,
html[data-mode] #view-dashboard .dash-card,
html[data-mode="dusk"] #view-dashboard .dash-card {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    background: linear-gradient(180deg, rgba(20,22,32,.97), rgba(11,13,20,.98)) !important;
}`;

let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }

async function session(mode) { // mode: 'baseline' | 'diet'
    const ctx = await browser.newContext({
        viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
        try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
        window.__frames = [];
        const orig = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = cb => orig(t => { window.__frames.push(t); cb(t); });
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    if (mode === 'diet') {
        await page.addStyleTag({ content: DIET_CSS });
        await page.waitForTimeout(500);
    }
    // Screenshot of the dashboard viewport (clip main area, skip browser chrome)
    const shot = await page.screenshot();
    // Scroll probe
    const stats = await page.evaluate(async () => {
        const el = document.querySelector('.main-content') || document.scrollingElement;
        window.__frames.length = 0;
        const start = performance.now();
        let dir = 1;
        while (performance.now() - start < 6000) {
            el.scrollBy(0, dir * 260);
            if (el.scrollHeight - el.clientHeight - el.scrollTop < 4) dir = -1;
            if (el.scrollTop <= 0 && dir === -1) dir = 1;
            await new Promise(r => requestAnimationFrame(r));
        }
        await new Promise(r => setTimeout(r, 300));
        const f = window.__frames;
        let dropped = 0;
        for (let i = 1; i < f.length; i++) if (f[i] - f[i - 1] > 25) dropped++;
        return { frames: f.length, dropped };
    }).catch(() => ({ frames: -1, dropped: -1 }));
    await ctx.close();
    return { shot, stats };
}

console.log('running baseline...');
const base = await session('baseline');
console.log('running diet...');
const diet = await session('diet');

// Pixel diff (decode PNGs via canvas in a throwaway page? Simpler: compare
// byte length ratio is NOT meaningful. Use Playwright's own image decode by
// drawing both into canvases inside a data-url page.)
const cmpCtx = await browser.newContext();
const cmpPage = await cmpCtx.newPage();
const b64a = base.shot.toString('base64');
const b64b = diet.shot.toString('base64');
const diff = await cmpPage.setContent(`<canvas id="c"></canvas>`).then(async () => {
    return cmpPage.evaluate(async ({ b64a, b64b }) => {
        function load(src) {
            return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = src; });
        }
        const [ia, ib] = await Promise.all([load('data:image/png;base64,' + b64a), load('data:image/png;base64,' + b64b)]);
        const w = Math.min(ia.width, ib.width) / 2 | 0, h = Math.min(ia.height, ib.height) / 2 | 0;
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d');
        cx.drawImage(ia, 0, 0, w, h);
        const da = cx.getImageData(0, 0, w, h).data;
        cx.clearRect(0, 0, w, h);
        cx.drawImage(ib, 0, 0, w, h);
        const db = cx.getImageData(0, 0, w, h).data;
        let changed = 0, n = 0;
        for (let i = 0; i < da.length; i += 4) {
            const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
            n++;
            if (d > 30) changed++; // ignore near-identical pixels (AA/noise)
        }
        return { changedPct: +(100 * changed / n).toFixed(2), sampled: n };
    }, { b64a, b64b });
});
await cmpCtx.close();

console.log('pixel diff (pixels changed >30/765):', JSON.stringify(diff));
console.log('baseline scroll:', JSON.stringify(base.stats));
console.log('diet     scroll:', JSON.stringify(diet.stats));

await browser.close();
server.close();
