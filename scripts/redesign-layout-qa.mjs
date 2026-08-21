import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8801;
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
try { browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 20000 }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 20000 }); }

let pass = 0, fail = 0;
const assert = (c, n) => { if (c) { pass++; console.log('  ok', n); } else { fail++; console.error('  FAIL', n); } };
const TABS = ['dashboard', 'pomodoro', 'errors', 'practice', 'analysis', 'settings'];

async function auditViewport(page, w, h) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(500);
    for (const tab of TABS) {
        await page.locator('.nav-item[data-tab="' + tab + '"]').click({ timeout: 5000 });
        await page.waitForTimeout(650);
        // 1. no horizontal panning possible (decorative fixed layers are clipped)
        const pan = await page.evaluate(() => { window.scrollTo(80, 0); const x = window.scrollX; window.scrollTo(0, 0); return Math.abs(x); });
        assert(pan === 0, `[${w}x${h}] ${tab}: no horizontal panning (${pan}px)`);
        // 2. active view visible
        const active = await page.evaluate(t => {
            const v = document.getElementById('view-' + t);
            return !!(v && v.classList.contains('active') && v.offsetHeight > 40);
        }, tab);
        assert(active, `[${w}x${h}] ${tab}: view renders`);
        // 3. nav item clickable at center (not covered)
        const clickable = await page.evaluate(t => {
            const el = document.querySelector('.nav-item[data-tab="' + t + '"]');
            const r = el.getBoundingClientRect();
            if (r.width < 4) return true; // icon-only collapsed is fine
            const hit = document.elementFromPoint(Math.min(r.x + r.width / 2, innerWidth - 1), Math.min(r.y + r.height / 2, innerHeight - 1));
            return !hit || !!hit.closest('.nav-item');
        }, tab);
        assert(clickable, `[${w}x${h}] ${tab}: nav item clickable`);
        // 4. zero page errors accumulated
    }
    // header only exists on dashboard/analysis/settings — check overlap there
    await page.locator('.nav-item[data-tab="dashboard"]').click({ timeout: 5000 });
    await page.waitForTimeout(500);
    const hdrVisible = await page.evaluate(() => {
        const h = document.getElementById('main-header');
        return !!(h && h.offsetHeight > 0 && getComputedStyle(h).display !== 'none');
    });
    // HUD collision probes: floating chrome must not cover interactive header/nav
    const hudHit = await page.evaluate(() => {
        const targets = ['.nav-item[data-tab="dashboard"]', '.stat-chip', '.header-actions .icon-btn'].filter(s => document.querySelector(s));
        const bad = [];
        for (const s of targets) {
            const el = document.querySelector(s);
            const r = el.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) continue;
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            if (hit && !hit.closest('.nav-item, .badge, .icon-btn, .header-badges, .header-copy, #main-header, .nav-menu')) {
                bad.push(s + ' <- ' + (hit.id || hit.className));
            }
        }
        return bad;
    });
    assert(hudHit.length === 0, `[${w}x${h}] chrome: no HUD collisions (${hudHit.join('; ')})`);
    if (hdrVisible) {
        const overlap = await page.evaluate(() => {
            const copy = document.querySelector('.header-copy')?.getBoundingClientRect();
            const badges = document.querySelector('.header-badges')?.getBoundingClientRect();
            if (!copy || !badges) return false;
            return !(copy.right < badges.x || badges.right < copy.x || copy.bottom < badges.y || badges.bottom < copy.y);
        });
        assert(!overlap, `[${w}x${h}] header: copy and badges do not overlap`);
    }
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(8000);
await page.addInitScript(() => {
    try {
        localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA'));
        localStorage.setItem('jeemax_fx_prefs', JSON.stringify({ sound: false, effects: false, haptics: false }));
    } catch {}
});
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(2200);
for (let i = 0; i < 6; i++) { if (!(await page.locator('.bootseq').count())) break; await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(200); }

await auditViewport(page, 1440, 900);
await auditViewport(page, 1024, 768);
await auditViewport(page, 768, 900);
await auditViewport(page, 390, 844);

assert(errors.length === 0, `zero page errors across all viewports (${errors.slice(0, 2).join(' | ')})`);
await browser.close();
server.close();
console.log(`RESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
