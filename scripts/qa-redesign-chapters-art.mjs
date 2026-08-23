// Art-direction audit for the redesigned Chapter Progress card.
// Numeric stand-in for eyes: measures rhythm/alignment from the DOM and ink
// economy (whitespace ratio, accent restraint, hairline truth) by sampling the
// element screenshot through an in-page canvas.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '.qa-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
process.on('uncaughtException', err => {
    console.error('UNCAUGHT:', err && err.message || err);
    try { browser && browser.close(); } catch {}
    try { server && server.close(); } catch {}
    process.exit(1);
});
const server = await new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        fs.readFile(path.join(ROOT, p), (err, data) => {
            if (err) { res.writeHead(404); res.end('nf'); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    s.on('error', reject);
    s.listen(8814, '127.0.0.1', () => resolve(s));
});
let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:8814')) return route.continue();
    return route.fulfill({ status: 200, contentType: url.includes('/css/') ? 'text/css' : 'application/javascript', body: '' }).catch(() => {});
});

let pass = 0, fail = 0;
const assert = (cond, name, extra = '') => {
    if (cond) { pass++; console.log('  ok', name, extra); }
    else { fail++; console.error('  FAIL', name, extra); }
};

await page.goto('http://127.0.0.1:8814/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(3000);
for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.bootseq').count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
}

await page.evaluate(() => {
    const chapters = {
        physics: ['Units & Dimensions','Rotational Motion','Electrostatics','Current Electricity',
          'A Very Long Chapter Name To Verify Graceful Truncation Behaviour In Ledger Rows','Modern Physics'],
        chemistry: ['Mole Concept','Chemical Bonding','Thermodynamics','Periodic Table'],
        maths: ['Quadratic Equations','Sequences & Series','Straight Lines','Limits Continuity & Differentiability','Probability'],
    };
    const bank = []; let id = 1;
    const mix = (s, c, sv, un) => { for (let i=0;i<sv;i++) bank.push({id:'q'+id++,subject:s,chapter:c,status:'solved'}); for (let i=0;i<un;i++) bank.push({id:'q'+id++,subject:s,chapter:c,status:'unsolved'}); };
    mix('physics','Rotational Motion',1,8); mix('physics','Electrostatics',3,6);
    mix('physics','Current Electricity',5,5);
    mix('physics','A Very Long Chapter Name To Verify Graceful Truncation Behaviour In Ledger Rows',1,7);
    mix('physics','Modern Physics',12,0);
    mix('chemistry','Mole Concept',2,6); mix('chemistry','Chemical Bonding',7,7);
    mix('chemistry','Thermodynamics',9,3); mix('chemistry','Periodic Table',3,5);
    mix('maths','Quadratic Equations',6,2); mix('maths','Sequences & Series',1,5);
    mix('maths','Straight Lines',4,4); mix('maths','Limits Continuity & Differentiability',8,8);
    mix('maths','Probability',5,1);
    window.AppState.chapters = chapters;
    window.AppState.questionBank = bank;
    window.renderChapterProgressList();
});
await page.waitForTimeout(900);

console.log('- GEOMETRY / RHYTHM -');
const geo = await page.evaluate(() => {
    const csCard = document.querySelector('.dash-card-progress');
    const cs = getComputedStyle(csCard);
    const vis = sel => [...document.querySelectorAll(sel)].filter(el => el.checkVisibility());
    const r = el => el.getBoundingClientRect();
    const rows = vis('#chapter-progress-list .cpx-row');
    return {
        padL: parseFloat(cs.paddingLeft),
        rowHeights: rows.map(el => Math.round(r(el).height * 10) / 10),
        nameX: [...new Set(vis('.cpx-name').map(el => Math.round(r(el).left)))],
        pctRight: [...new Set(vis('.cpx-pct').map(el => Math.round(r(el).right)))],
        subjX: [...new Set(vis('.cpx-subj').map(el => Math.round(r(el).left)))],
        trackW: [...new Set(vis('.cpx-track').map(el => Math.round(r(el).width)))],
        trackH: [...new Set(vis('.cpx-track').map(el => Math.round(r(el).height * 10) / 10))],
        listOverflow: (() => { const l = document.getElementById('chapter-progress-list'); return l.scrollWidth - l.clientWidth; })(),
    };
});
assert(new Set(geo.rowHeights).size <= 3 && Math.abs(geo.rowHeights[0] - geo.rowHeights[geo.rowHeights.length - 1]) < 1,
    'rows share one rhythm height', JSON.stringify(geo.rowHeights));
assert(Math.min(...geo.rowHeights) >= 44, 'rows generous, not cramped', 'minH=' + Math.min(...geo.rowHeights));
assert(geo.nameX.length === 1 && geo.pctRight.length === 1,
    'columns optically aligned across rows', JSON.stringify({ nameX: geo.nameX, pctRight: geo.pctRight }));
assert(geo.trackW.length === 1 && geo.trackH.every(h => h === 2), 'tracks identical width, exactly 2px',
    JSON.stringify({ w: geo.trackW, h: geo.trackH }));
assert(geo.padL >= 28 && geo.padL <= 40, 'card padding inside 28-40 spec', String(geo.padL));
assert(geo.listOverflow <= 0, 'no horizontal overflow in list');
// box-desc is intentionally hidden on the dashboard (v2 declutter pass); no
// desc-margin check — header air comes from .dash-card-head margin instead.

console.log('- INK ECONOMY (pixel truth) -');
const cardLoc = page.locator('.dash-card-progress');
const buf = await cardLoc.screenshot();
const b64 = buf.toString('base64');
const analysis = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const lum = i => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const lums = [];
    for (let i = 0; i < d.length; i += 40) lums.push(lum(i));
    lums.sort((a, b) => a - b);
    const bg = lums[Math.floor(lums.length / 2)];
    let inked = 0, total = 0;
    const accentRows = new Set();
    for (let y = 0; y < cv.height; y++) {
        for (let x = 0; x < cv.width; x++) {
            const i = (y * cv.width + x) * 4;
            total++;
            if (Math.abs(lum(i) - bg) > 10) inked++;
            const r = d[i], g = d[i + 1], b = d[i + 2];
            if (r > g + 30 && r > b + 40 && r > 120) accentRows.add(y);
        }
    }
    const ys = [...accentRows].sort((a, b) => a - b);
    const bands = [];
    for (const y of ys) {
        if (!bands.length || y - bands[bands.length - 1][1] > 8) bands.push([y, y]);
        else bands[bands.length - 1][1] = y;
    }
    return { w: cv.width, h: cv.height, whitespaceShare: 1 - inked / total,
             accentPixels: ys.length, accentBands: bands.length };
}, b64);
assert(analysis.whitespaceShare > 0.55, 'whitespace dominates (>55%)',
    (analysis.whitespaceShare * 100).toFixed(1) + '%');
assert(analysis.accentBands <= 3, 'accent confined to <=3 bands (corner tick chrome + kicker + weakest row)',
    'bands=' + analysis.accentBands);
assert(analysis.accentPixels / (analysis.w * analysis.h) < 0.02, 'accent used sparingly (<2% of card)',
    (100 * analysis.accentPixels / (analysis.w * analysis.h)).toFixed(3) + '%');

const lineScan = await page.evaluate(async ({ b64 }) => {
    const card = document.querySelector('.dash-card-progress').getBoundingClientRect();
    const trk = document.querySelector('.cpx-row.is-flag .cpx-track').getBoundingClientRect();
    const strip = { x: Math.round(trk.left - card.left + trk.width * 0.5), yTop: Math.round(trk.top - card.top), yBot: Math.round(trk.bottom - card.top) };
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const lum = (x, y) => { const i = (y * cv.width + x) * 4; return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; };
    const baseY = Math.max(0, strip.yTop - 4);
    let n = 0;
    for (let y = baseY; y < Math.min(cv.height, strip.yBot + 4); y++) {
        if (Math.abs(lum(strip.x, y) - lum(strip.x, baseY)) > 12) n++;
    }
    return { band: n };
}, { b64 });
assert(lineScan.band >= 1 && lineScan.band <= 3, 'weakest-row progress reads as a hairline', 'band=' + lineScan.band + 'px');

console.log('- TOKEN CONSISTENCY -');
const tokens = await page.evaluate(() => {
    const cc = el => getComputedStyle(el).color;
    const kick = document.querySelector('.dash-card-progress .kicker');
    const flagPct = document.querySelector('.cpx-row.is-flag .cpx-pct');
    const voidPct = document.querySelector('.cpx-row.is-void .cpx-pct');
    const fam = el => getComputedStyle(el).fontFamily.split(',')[0];
    return {
        kicker: cc(kick), flag: cc(flagPct), voidC: voidPct ? cc(voidPct) : '',
        nameFont: fam(document.querySelector('.cpx-name')),
        pctFont: fam(document.querySelector('.cpx-pct')),
        pctWeight: getComputedStyle(document.querySelector('.cpx-pct')).fontWeight,
        pctTabular: getComputedStyle(document.querySelector('.cpx-pct')).fontVariantNumeric,
        kickerFont: fam(kick),
    };
});
assert(tokens.kicker === tokens.flag, 'one accent, identical color on both jobs', tokens.kicker);
// The weakest row is usually ALSO void (0%) — the accent must still win there.
// What must never happen: more than one pct wearing the accent.
const accentPctCount = await page.evaluate(() => {
    const want = getComputedStyle(document.querySelector('.cpx-row.is-flag .cpx-pct')).color;
    return [...document.querySelectorAll('.cpx-pct')]
        .filter(el => el.checkVisibility() && getComputedStyle(el).color === want).length;
});
assert(accentPctCount === 1, 'exactly one percentage wears the accent', 'count=' + accentPctCount);
assert(/Space Grotesk/i.test(tokens.pctFont) && /IBM Plex/i.test(tokens.nameFont) && /Chakra/i.test(tokens.kickerFont),
    'type roles correct (num/name/kicker)', [tokens.pctFont, tokens.nameFont, tokens.kickerFont].join(' | '));
assert(tokens.pctTabular.includes('tabular-nums'), 'numerals are tabular');
assert(['300', '400', '500'].includes(tokens.pctWeight), 'numerals light-to-medium', tokens.pctWeight);

console.log('- THEME SWEEP -');
const sweepBad = await page.evaluate(async () => {
    const html = document.documentElement;
    const savedT = html.getAttribute('data-theme');
    const savedM = html.getAttribute('data-mode');
    const themeList = ['midnight', 'dusk', 'crimson', 'forest', 'ocean', 'royal', 'mono'];
    const modeList = ['midnight', 'dusk'];
    const bad = [];
    let combos = 0;
    for (const t of themeList) {
        html.setAttribute('data-theme', t);
        for (const m of modeList) {
            html.setAttribute('data-mode', m);
            await new Promise(r => setTimeout(r, 50));
            combos++;
            const pctEl = document.querySelector('.cpx-row.is-flag .cpx-pct');
            const fillEl = document.querySelector('.cpx-row.is-flag .cpx-track i');
            const col = pctEl ? getComputedStyle(pctEl).color : '';
            const fillBg = fillEl ? getComputedStyle(fillEl).backgroundColor : '';
            if (!col || col.includes('NaN') || !fillBg || fillBg.includes('NaN')) bad.push({ t, m, col, fillBg });
        }
    }
    html.setAttribute('data-theme', savedT || '');
    html.setAttribute('data-mode', savedM || '');
    return { bad, combos };
});
assert(sweepBad.bad.length === 0, 'all theme x mode combos resolve clean colors',
    sweepBad.bad.length ? JSON.stringify(sweepBad.bad.slice(0, 3)) : '(' + sweepBad.combos + ' combos)');

await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(500);
const narrowGeo = await page.evaluate(() => {
    const l = document.getElementById('chapter-progress-list');
    const n = document.querySelector('.cpx-name');
    return { overflow: l.scrollWidth - l.clientWidth, clip: getComputedStyle(n).textOverflow };
});
assert(narrowGeo.overflow <= 0 && narrowGeo.clip === 'ellipsis', 'narrow 420px clean');
await page.locator('.dash-card-progress').screenshot({ path: path.join(SHOTS, 'art-audit-narrow.png') });

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.slice(0, 6).join('\n'));
else console.log('no console/page errors');
await browser.close();
server.close();
process.exit(fail || errors.length ? 1 : 0);
