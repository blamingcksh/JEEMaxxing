// audit-retention.mjs — quantitative art-direction for the redesigned
// Retention Health card: DOM geometry (column alignment, rhythm, type)
// + canvas pixel metrics from the card screenshots (ink density, color
// budget, whitespace). Read-only; complements qa-redesign-retention.mjs.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8813;
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '.qa-shots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();
await page.addInitScript(() => { try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {} });

await page.goto(BASE, { waitUntil: 'commit' });
await page.waitForFunction(() => document.readyState === 'complete' || document.readyState === 'interactive', null, { timeout: 45000 });
for (let i = 0; i < 6; i++) { if (!(await page.locator('.bootseq').count())) break; await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(350); }
await page.waitForFunction(() => window.AppState && Array.isArray(window.AppState.questionBank), null, { timeout: 15000 });
await page.waitForTimeout(1000);

// Seed the same ledger as the QA harness (compact duplicate)
await page.evaluate(() => {
    const DAY = 86400000, F = 19 / 81;
    const ago = (R, S) => S * (Math.pow(R, -2) - 1) / F;
    let uid = 0;
    const item = (subject, chapter, R, S, x = {}) => ({ id: 'au_' + (++uid), subject, chapter, type: 'mcq', status: x.st || 'solved', errorReason: x.er || 'concept gap', qElo: x.e || 1200, easeFactor: 2.5, stability: S, difficultyD: 5, reps: 4, lapses: x.l || 0, lastReviewedAt: new Date(Date.now() - ago(R, S) * DAY).toISOString(), timeTaken: x.tt || 0, targetTimeMins: x.tg || 0 });
    const fill = (s, c, n) => Array.from({ length: n }, (_, k) => ({ id: 'af_' + (++uid), subject: s, chapter: c, type: 'mcq', status: 'solved', qElo: 1100 + k * 17, easeFactor: 2.5 }));
    const LONG = 'Chemical Bonding & Molecular Structure — Hybridisation, VSEPR and the MO Theory of Diatomic Species';
    AppState.questionBank.push(
        item('physics', 'Rotational Motion', .95, 45), item('physics', 'Rotational Motion', .96, 45), ...fill('physics', 'Rotational Motion', 14),
        item('physics', 'Electrostatics', .70, 8), item('physics', 'Electrostatics', .66, 8), ...fill('physics', 'Electrostatics', 8),
        item('physics', 'Current Electricity', .83, 20), item('physics', 'Current Electricity', .81, 20), ...fill('physics', 'Current Electricity', 2),
        item('chemistry', 'Thermodynamics', .93, 50), ...fill('chemistry', 'Thermodynamics', 20),
        item('chemistry', 'Coordination Compounds', .86, 25), item('chemistry', 'Coordination Compounds', .84, 25),
        item('chemistry', LONG, .58, 6, { l: 3 }), item('chemistry', LONG, .55, 6),
        item('chemistry', 'Biomolecules', .63, 7), item('chemistry', 'Biomolecules', .60, 7),
        item('maths', 'Definite Integration', .84, 22), ...fill('maths', 'Definite Integration', 5),
        item('maths', 'Sequences & Series', .96, 60), item('maths', 'Sequences & Series', .97, 65),
        item('maths', 'Vectors & 3D Geometry', .88, 30)
    );
    try { window._setExamDate(new Date(Date.now() + 90 * DAY).toISOString().slice(0, 10)); } catch (_) {}
    window.renderChapterDecayGrid();
});
await page.waitForTimeout(900); // entrance animations settle

// ── 1. Geometry audit ────────────────────────────────────────────────────
const geo = await page.evaluate(() => {
    const card = document.querySelector('.dash-card-decay');
    const grid = document.getElementById('chapter-decay-grid');
    const headCells = [...document.querySelectorAll('.rh-head > span')].map(el => { const r = el.getBoundingClientRect(); return { t: el.textContent.trim().slice(0, 12), x: +r.x.toFixed(1), right: +r.right.toFixed(1), y: +r.y.toFixed(1), h: +r.height.toFixed(1) }; });
    const rows = [...document.querySelectorAll('.rh-row')].map(el => {
        const r = el.getBoundingClientRect();
        const name = el.querySelector('.rh-name').getBoundingClientRect();
        const gauge = el.querySelector('.rh-gauge').getBoundingClientRect();
        const val = el.querySelector('.rh-val').getBoundingClientRect();
        const hz = el.querySelector('.rh-hz').getBoundingClientRect();
        const dot = el.querySelector('.rh-dot').getBoundingClientRect();
        const line = el.querySelector('.rh-line').getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { h: +r.height.toFixed(1), nameX: +name.x.toFixed(1), gaugeX: +gauge.x.toFixed(1), gaugeW: +gauge.width.toFixed(1), valRight: +val.right.toFixed(1), hzRight: +hz.right.toFixed(1), dotCx: +((dot.x + dot.width / 2 - gauge.x) / gauge.width * 100).toFixed(1), lineW: +(line.width / gauge.width * 100).toFixed(1), padY: cs.paddingTop + '/' + cs.paddingBottom, borderB: cs.borderBottomWidth };
    });
    const legend = [...document.querySelectorAll('.legend-chip')].map(el => { const cs = getComputedStyle(el); return { txt: el.textContent.trim(), bg: cs.backgroundColor, border: cs.borderTopWidth, fs: cs.fontSize, ls: cs.letterSpacing, tt: cs.textTransform, before: getComputedStyle(el, '::before').backgroundColor }; });
    const cardPad = getComputedStyle(card).padding;
    const nameStyle = (() => { const cs = getComputedStyle(document.querySelector('.rh-name')); return { ff: cs.fontFamily.split(',')[0], fs: cs.fontSize, fw: cs.fontWeight, col: cs.color }; })();
    const valStyle = (() => { const cs = getComputedStyle(document.querySelector('.rh-val')); return { ff: cs.fontFamily.split(',')[0], fs: cs.fontSize, fw: cs.fontWeight }; })();
    const headStyle = (() => { const cs = getComputedStyle(document.querySelector('.rh-head span')); return { fs: cs.fontSize, ls: cs.letterSpacing, tt: cs.textTransform, col: cs.color }; })();
    const fcTicks = document.querySelectorAll('.rh-fc').length;
    const fcSample = document.querySelector('.rh-fc') ? getComputedStyle(document.querySelector('.rh-fc')).backgroundColor : null;
    return { cardPad, rowsN: rows.length, headCells, rows, legend, nameStyle, valStyle, headStyle, fcTicks, fcSample };
});
console.log(JSON.stringify(geo, null, 1));

// ── 2. Pixel-metric audit of the AFTER screenshot ───────────────────────
async function pixelMetrics(file) {
    const b64 = fs.readFileSync(path.join(SHOTS, file)).toString('base64');
    const p2 = await context.newPage();
    const out = await p2.evaluate(async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let ink = 0, colored = 0; const hues = { amber: 0, green: 0, red: 0, yellow: 0, other: 0 };
        const lums = [];
        for (let i = 0; i < d.length; i += 4) {
            const r = d[i], gg = d[i + 1], b = d[i + 2];
            const lum = .2126 * r + .7152 * gg + .0722 * b;
            lums.push(lum);
            if (lum > 42) ink++;
            const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
            if (mx > 60 && (mx - mn) / mx > .28) {
                colored++;
                let hue = 0; const df = mx - mn;
                if (mx === r) hue = ((gg - b) / df) % 6; else if (mx === gg) hue = (b - r) / df + 2; else hue = (r - gg) / df + 4;
                hue = (hue * 60 + 360) % 360;
                if (hue < 20 || hue >= 330) hues.red++;
                else if (hue < 48) hues.amber++;
                else if (hue < 70) hues.yellow++;
                else if (hue < 180) hues.green++;
                else hues.other++;
            }
        }
        const tot = d.length / 4;
        return { w: c.width, hgt: c.height, inkPct: +(ink / tot * 100).toFixed(2), colorPct: +(colored / tot * 100).toFixed(2), hues };
    }, b64);
    await p2.close();
    return out;
}
for (const f of ['redesign-retention-after.png', 'redesign-retention-after-narrow.png']) {
    try { console.log(f, JSON.stringify(await pixelMetrics(f))); } catch (e) { console.log(f, 'ERR', e.message.slice(0, 80)); }
}

// ── 3. Narrow container-query behaviour ────────────────────────────────
await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(600);
const narrow = await page.evaluate(() => ({
    hzDisplay: getComputedStyle(document.querySelector('.rh-hz')).display,
    cols: getComputedStyle(document.querySelector('.rh-row')).gridTemplateColumns.split(' ').length,
    nameFs: getComputedStyle(document.querySelector('.rh-name')).fontSize,
}));
console.log('narrow:', JSON.stringify(narrow));

await browser.close(); server.close();
