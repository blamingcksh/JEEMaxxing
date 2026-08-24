// audit-scroll-perf.mjs — measures scroll jank on the home dashboard at iPad
// size, twice: baseline vs backdrop-filter disabled. Reports dropped-frame
// ratios + long frames. READ-ONLY.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8975;
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg' };
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

let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }

async function measure(label, disableBF) {
    const ctx = await browser.newContext({
        viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2,
        hasTouch: true,
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
    if (disableBF) {
        await page.addStyleTag({ content: '*{backdrop-filter:none !important;-webkit-backdrop-filter:none !important}' });
        await page.waitForTimeout(600);
    }
    // Scroll the main scroller up/down repeatedly for 6s using touch-like wheel
    const stats = await page.evaluate(async () => {
        const scroller = document.scrollingElement || document.documentElement;
        // find actual scrollable container (main content)
        let el = document.querySelector('.main-content') || document.querySelector('main') || scroller;
        if (el && el.scrollHeight <= el.clientHeight + 10) el = scroller;
        window.__frames.length = 0;
        const start = performance.now();
        let dir = 1;
        while (performance.now() - start < 6000) {
            el.scrollBy(0, dir * 260);
            if (el.scrollHeight - el.clientHeight - el.scrollTop < 4) dir = -1;
            if (el.scrollTop <= 0 && dir === -1) dir = 1;
            await new Promise(r => requestAnimationFrame(r));
        }
        await new Promise(r => setTimeout(r, 400));
        const f = window.__frames;
        let dropped = 0, long = 0;
        for (let i = 1; i < f.length; i++) {
            const d = f[i] - f[i - 1];
            if (d > 25) dropped++;
            if (d > 50) long++;
        }
        return {
            frames: f.length,
            avgFps: f.length > 1 ? Math.round((f.length / ((f[f.length - 1] - f[0]) / 1000))) : 0,
            droppedFramesOver25ms: dropped,
            longFramesOver50ms: long,
            scrolledEl: el.className ? String(el.className).slice(0, 40) : el.tagName,
            maxScroll: el.scrollHeight - el.clientHeight,
        };
    }).catch(e => ({ evalError: String(e) }));
    console.log(`[${label}]`, JSON.stringify(stats));
    await ctx.close();
}

await measure('baseline(backdrop-filter ON)', false);
await measure('no-backdrop-filter      ', true);

await browser.close();
server.close();
