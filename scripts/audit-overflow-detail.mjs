// audit-overflow-detail.mjs — identifies exactly which elements overflow the
// viewport at narrow widths (Slide Over 375 / Split View 678) and whether
// they are clipped-unreachable or cause real scroll. READ-ONLY.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8977;
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

let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }

for (const width of [375, 678, 820]) {
    const ctx = await browser.newContext({ viewport: { width, height: 1024 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
        try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2200);
    const out = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const report = [];
        for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if ((r.right > vw + 1 || r.left < -1) && r.width > 10 && r.height > 10 && el.children.length < 4) {
                const cs = getComputedStyle(el);
                // walk ancestors to find a clipping ancestor (overflow hidden)
                let clippedBy = null, anc = el.parentElement;
                while (anc && anc !== document.body) {
                    const acs = getComputedStyle(anc);
                    if (/(hidden|clip)/.test(acs.overflow + acs.overflowX)) { clippedBy = anc.className || anc.id || anc.tagName; break; }
                    anc = anc.parentElement;
                }
                report.push({
                    tag: el.tagName.toLowerCase(),
                    cls: String(el.className).slice(0, 60),
                    id: el.id || '',
                    rect: `L${Math.round(r.left)} R${Math.round(r.right)} T${Math.round(r.top)} W${Math.round(r.width)}xH${Math.round(r.height)}`,
                    pos: cs.position,
                    clippedBy: clippedBy ? String(clippedBy).slice(0, 40) : '(none)',
                    text: (el.textContent || '').trim().slice(0, 25),
                });
                if (report.length >= 14) break;
            }
        }
        return {
            vw,
            htmlOverflowX: getComputedStyle(document.documentElement).overflowX,
            bodyOverflowX: getComputedStyle(document.body).overflowX,
            docScrollablePx: document.documentElement.scrollWidth - vw,
            bodyScrollablePx: document.body.scrollWidth - vw,
            sidebarVisible: (() => { const s = document.querySelector('.sidebar'); if (!s) return 'none'; const r = s.getBoundingClientRect(); return `L${Math.round(r.left)} R${Math.round(r.right)} W${Math.round(r.width)}`; })(),
            report,
        };
    }).catch(e => ({ evalError: String(e) }));
    console.log(`\n===== width ${width} =====`);
    console.log(`html overflow-x=${out.htmlOverflowX} body overflow-x=${out.bodyOverflowX} doc+${out.docScrollablePx}px body+${out.bodyScrollablePx}px sidebar[${out.sidebarVisible}]`);
    for (const r of (out.report || [])) console.log(` ${r.tag}.${r.cls}#${r.id} ${r.rect} pos=${r.pos} clip=${r.clippedBy} "${r.text}"`);
    if (out.evalError) console.log('EVAL ERROR:', out.evalError);
    await ctx.close();
}
await browser.close();
server.close();
