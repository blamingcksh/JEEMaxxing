// audit-cpu-profile.mjs — boots the app once under an iPad-like context and
// captures a CDP CPU profile of the startup path. Prints the heaviest
// self-time functions grouped per script URL. READ-ONLY.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8973;
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

const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});

const cdp = await ctx.newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.start');

const t0 = Date.now();
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
const dceMs = Date.now() - t0;
await page.waitForTimeout(6000); // capture post-DCE hydration too
const { profile } = await cdp.send('Profiler.stop');

// Aggregate self time per (url,functionName)
const nodesById = new Map(profile.nodes.map(n => [n.id, n]));
const selfTime = new Map();
let total = 0;
for (const td of profile.samples ? [] : []) {}
// Compute deltas between consecutive sample timestamps attributed to node ids
const samples = profile.samples || [];
const ts = profile.timeDeltas || [];
for (let i = 0; i < samples.length; i++) {
    const node = nodesById.get(samples[i]);
    if (!node) continue;
    const d = ts[i] || 0;
    total += d;
    const f = node.callFrame;
    const url = (f.url || '').replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*/, '') || '(native)';
    const key = `${url} :: ${f.functionName || '(anonymous)'}`;
    selfTime.set(key, (selfTime.get(key) || 0) + d);
}
const top = [...selfTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
console.log(`DOMContentLoaded after ${dceMs}ms | profiled ${(total / 1000).toFixed(0)}ms total`);
console.log('\nTop self-time:');
for (const [k, v] of top) console.log(`${String(Math.round(v / 1000)).padStart(6)}ms  ${k}`);

fs.writeFileSync(path.join(ROOT, '.qa-shots', 'cpu-profile.json'), JSON.stringify(
    top.map(([k, v]) => ({ ms: Math.round(v / 1000), where: k })), null, 2));

await browser.close();
server.close();
