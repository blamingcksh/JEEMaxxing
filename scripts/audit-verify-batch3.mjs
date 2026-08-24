// audit-verify-batch3.mjs — verifies the iPad hardening batch end-to-end:
// stylesheet present & last in cascade, input font sizes ≥16 under coarse
// pointers, slider hit heights, FAB stacking, safe-area calc application,
// and zero new console errors. READ-ONLY.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8981;
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

const errors = [];
const ctx = await browser.newContext({
    viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3500);

const results = await page.evaluate(() => {
    const out = {};
    // 1. styles-ipad.css loaded and is the LAST stylesheet
    const sheets = [...document.styleSheets].map(s => (s.href || 'inline').split('/').pop());
    out.sheetOrderTail = sheets.slice(-3);
    out.ipadSheetLoaded = sheets.includes('styles-ipad.css');
    out.ipadSheetIsLastCss = sheets[sheets.length - 1] === 'styles-ipad.css' || sheets.indexOf('styles-ipad.css') > sheets.indexOf('styles.css');
    // 2. probe computed styles
    function cs(sel, prop) {
        const el = document.querySelector(sel);
        if (!el) return null;
        return getComputedStyle(el)[prop];
    }
    out.matrixSearchFontSize = cs('.matrix-search', 'fontSize');
    out.pomoInputFontSize = cs('.pomo-input', 'fontSize');
    // sliders: find any fx-range / sc-range / metro-range
    out.sliderHeights = ['.fx-range', '#view-pomodoro .sc-range', '.metro-range'].map(sel => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).height : null;
    }).filter(Boolean);
    // 3. metro fab vs layout fab boxes
    const mf = document.getElementById('metro-fab') || document.querySelector('.metro-fab');
    const lf = document.getElementById('dc-layout-fab');
    if (mf && lf) {
        const a = mf.getBoundingClientRect(), b = lf.getBoundingClientRect();
        const overlap = !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        out.fabsOverlap = overlap;
        out.metroFabBottom = getComputedStyle(mf).bottom;
    } else {
        out.fabsOverlap = 'n/a (fabs not both present)';
        if (mf) out.metroFabBottom = getComputedStyle(mf).bottom;
    }
    // 4. safe-area calc applied somewhere
    if (mf) out.metroFabBottomRaw = mf.getAttribute('style') || '';
    const cpHub = document.getElementById('cp-hub');
    out.cpHubBottom = cpHub ? getComputedStyle(cpHub).bottom : null;
    // 5. wide modal rule exists in any sheet
    out.wideModalRuleFound = [...document.styleSheets].some(s => {
        try { return [...s.cssRules].some(r => r.selectorText && r.selectorText.includes('.modal-content.wide')); }
        catch (e) { return false; }
    });
    // 6. counter-btn hit expansion pseudo exists (computed via stylesheet scan)
    out.hitExpandRuleFound = (() => {
        for (const s of document.styleSheets) {
            try {
                for (const r of s.cssRules) {
                    if (r.selectorText && r.selectorText.includes('.tp-step-btn::after')) return true;
                    if (r instanceof CSSMediaRule) {
                        for (const r2 of r.cssRules) {
                            if (r2.selectorText && r2.selectorText.includes('.tp-step-btn::after')) return true;
                        }
                    }
                }
            } catch (e) {}
        }
        return false;
    })();
    // 7. touch target recount on home screen
    const small = [];
    let checked = 0;
    for (const el of document.querySelectorAll('button, [onclick], a.nav-item')) {
        if (checked++ > 1200) break;
        const r = el.getBoundingClientRect();
        const c = getComputedStyle(el);
        if (!r.width || !r.height || c.display === 'none' || c.visibility === 'hidden' || c.pointerEvents === 'none') continue;
        if (r.width < 40 || r.height < 40) small.push(`${Math.round(r.width)}x${Math.round(r.height)} ${String(el.className).slice(0, 30)}`);
    }
    out.smallTargetsNow = small.length;
    out.smallTargetSamples = small.slice(0, 12);
    out.domNodes = document.getElementsByTagName('*').length;
    return out;
}).catch(e => ({ evalError: String(e) }));

console.log(JSON.stringify(results, null, 2));
console.log('console/page errors:', errors.length ? errors.slice(0, 10) : 'none');
await browser.close();
server.close();
