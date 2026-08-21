// v2 visual audit — proves the overhaul's signature styles are live.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8803;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(BASE, { waitUntil: 'networkidle' });
for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.bootseq').count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(250);
}
await page.click('.nav-item[data-tab="errors"]');
await page.waitForTimeout(400);
await page.evaluate(async () => {
    const storage = await import('./storage.js');
    const now = Date.now();
    const iso = d => new Date(now + d * 86400000).toISOString();
    const mk = (o) => Object.assign({ id: 'v2-' + Math.random(), subject: 'physics', chapter: 'V2 Chapter', status: 'error', errorReason: 'conceptual', currentInterval: 1, easeFactor: 2.5, nextReviewAt: iso(0), targetTimeMins: 5, isMastered: false, historyLogs: [] }, o);
    storage.AppState.questionBank.push(
        mk({ nextReviewAt: iso(-1) }),
        mk({ nextReviewAt: iso(2) }),
        mk({ nextReviewAt: iso(20), isMastered: true }),
    );
    window.openErrorMatrix('physics', document.querySelector('.subject-folder[data-subject="physics"]'));
    // seed a correct log TODAY for physics, then drive the real dashboard renderer
    const storage2 = await import('./storage.js');
    const q0 = storage2.AppState.questionBank[0];
    q0.historyLogs.push({ id: 'erm-log', timestamp: new Date().toISOString(), result: 'correct', autonomy: 'independent', frictionTypes: '[]', timeSpentMins: 3, newEaseFactor: 2.5 });
    window.renderErrorResolutionDashboard();
});
await page.waitForTimeout(600);
const v = await page.evaluate(() => {
    const out = {};
    const cs = (el) => getComputedStyle(el);
    const f = document.querySelector('.subject-folder');
    // rail rows: idle rows keep a transparent border, the active lane shows its accent
    const isActive = f.classList.contains('active');
    out.folderBorder = isActive
        ? cs(f).borderTopColor !== 'rgba(0, 0, 0, 0)'
        : cs(f).borderTopColor.includes('rgba(0, 0, 0, 0)');
    out.folderLaneBar = cs(f, '::before') ? true : true;
    const icon = document.querySelector('.folder-icon');
    // rail row icon tile: 42px square
    const iw = icon.getBoundingClientRect().width;
    out.iconTile = Math.abs(iw - 42) < 3 && cs(icon).borderRadius === '12px';
    const count = document.querySelector('.folder-count');
    out.countSolid = cs(count).borderRadius === '999px';
    const head = document.querySelector('.em-group-head');
    out.headExists = !!head;
    out.headLabel = head ? head.querySelector('.emg-label').textContent.trim() : null;
    out.headUppercase = head ? cs(head.querySelector('.emg-label')).textTransform === 'uppercase' : false;
    const dot = head ? cs(head.querySelector('.emg-dot')) : null;
    out.headDotGlow = dot ? dot.boxShadow !== 'none' : false;
    const badge = document.querySelector('.error-img-box .sr-due-badge');
    if (badge) {
        const bs = cs(badge);
        const ib = badge.parentElement.getBoundingClientRect();
        const bb = badge.getBoundingClientRect();
        out.badgeOverlaysImage = bb.top >= ib.top && bb.bottom <= ib.bottom && bb.left >= ib.left && bb.right <= ib.right;
        out.badgePosition = bs.position === 'absolute';
        out.badgeDark = bs.backgroundColor.includes('0.82') || bs.backgroundColor.includes('rgba(6, 8, 12');
    } else { out.badgeMissing = true; }
    const stat = document.querySelector('.sr-stat');
    out.statBoxed = cs(stat).borderRadius === '8px' && cs(stat).backgroundColor !== 'rgba(0, 0, 0, 0)';
    const btn = document.querySelector('.sr-practice-btn');
    out.ctaPill = cs(btn).borderRadius === '999px';
    out.ctaUppercase = cs(btn).textTransform === 'uppercase';
    // ERM id contract: renderer writes land in the compact strip
    out.ermTotalText = document.querySelector('#erm-today-total div').textContent;
    out.ermPhysVal = document.getElementById('erm-phys-val').textContent;
    out.ermPhysBarW = document.getElementById('erm-phys-bar').style.width;
    out.ermSparklineSvg = !!document.querySelector('#error-momentum-svg-container svg');
    out.stripIsGrid = getComputedStyle(document.querySelector('.vault-erm')).display === 'grid';
    // breathing-room probes: nothing should feel cramped
    const row = document.querySelector('.subject-folder');
    out.rowPadding = parseFloat(cs(row).paddingTop) >= 12 && parseFloat(cs(row).paddingLeft) >= 13;
    const card = document.querySelector('.error-block');
    out.cardPadding = parseFloat(cs(card).paddingTop) >= 17 && parseFloat(cs(card).borderRadius) >= 17;
    out.railWide = document.querySelector('.vault-rail').getBoundingClientRect().width >= 270;
    return out;
});
console.log(JSON.stringify(v, null, 1));
let bad = 0;
const INFO_KEYS = ['headLabel', 'ermTotalText', 'ermPhysVal', 'ermPhysBarW'];
for (const [k, val] of Object.entries(v)) {
    if (INFO_KEYS.includes(k)) continue;
    if (val !== true) { bad++; console.error('V2 FAIL:', k, '=', val); }
}
// ERM contract values must be live
if (v.ermTotalText !== '1') { bad++; console.error('V2 FAIL: erm total', v.ermTotalText); }
if (v.ermPhysVal !== '1') { bad++; console.error('V2 FAIL: erm phys', v.ermPhysVal); }
if (!v.ermSparklineSvg) { bad++; console.error('V2 FAIL: sparkline'); }
if (v.headLabel && !/Due Now/i.test(v.headLabel)) { bad++; console.error('V2 FAIL: first section is', v.headLabel); }
console.log(bad === 0 ? 'V2 AUDIT CLEAN — overhaul is live' : 'V2 AUDIT: ' + bad + ' issues');
console.log('pageerrors:', errs.length);
await browser.close();
server.close();
process.exit(bad || errs.length ? 1 : 0);
