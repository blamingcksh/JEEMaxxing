// Visual + functional QA for the Today's Progress card — "Output Meter"
// redesign (segmented LED day meter + subject ledger strips).
// Usage:
//   node scripts/qa-redesign-daily.mjs --before   → screenshots only (pre-redesign capture)
//   node scripts/qa-redesign-daily.mjs            → full assertions + AFTER screenshots + design audit
// Serves the repo on 127.0.0.1:8811, drives headless Edge (fallback Chrome),
// seeds localStorage to skip the boot briefing, collects console/page errors,
// drops shots into <repo>/.qa-shots/redesign-daily-*.png.
// NOTE: the session model cannot view images, so an aesthetic proxy lives in
// dumpAudit(): computed type scale / spacing / color metrics printed as JSON.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODE = process.argv.includes('--before') ? 'before' : 'after';
const PORT = 8811;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '.qa-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
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
console.log('server up on', PORT);

let browser;
try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
} catch {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
}

const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',           // sw.js must not serve stale assets
});
const page = await context.newPage();
// Pre-seed the boot-briefing daily guard so the overlay never mounts
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});
const errors = [];
// Known FOREIGN error (pre-existing, outside DAILY's file territory):
// grove-islands.js:621 calls easeOutCubic(), which is defined nowhere in the
// repo; it fires whenever logging a solve plants a grove tree (plant-FX
// shockwave) — reproducible on pristine HEAD, unrelated to this card.
const KNOWN_FOREIGN = (t) => t.includes('easeOutCubic');
page.on('console', m => { if (m.type() === 'error' && !KNOWN_FOREIGN(m.text())) errors.push(m.text()); });
page.on('pageerror', e => { if (!KNOWN_FOREIGN(String(e))) errors.push(String(e)); });
const flushErrors = () => {
    if (errors.length) fs.writeFileSync(path.join(SHOTS, 'redesign-daily-errors.txt'), errors.join('\n'));
};

let pass = 0, fail = 0;
const assert = (cond, name) => {
    if (cond) { pass++; console.log('  ok', name); }
    else { fail++; console.error('  FAIL', name); }
};

// Query-string cache-bust in case a persistent SW ever sneaks past blocking.
// domcontentloaded + fixed settle: CDN font fetches can stall 'networkidle'.
await page.goto(`http://127.0.0.1:${PORT}/index.html?v=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);
for (let i = 0; i < 6; i++) {
    const overlay = page.locator('.bootseq');
    if (!(await overlay.count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
}
assert(!(await page.locator('.bootseq').count()), 'boot briefing dismissed');
await page.waitForTimeout(900);

const card = page.locator('.dash-card-tracker');
assert(await card.isVisible(), 'tracker card visible');

// Numeric stand-in for art direction (session model cannot see images):
// dumps computed geometry/type/color for every key node of the card.
async function dumpAudit(tag) {
    const audit = await card.evaluate((root) => {
        const pick = (el, props) => {
            if (!el) return null;
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            const o = { rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } };
            for (const p of props) o[p] = cs.getPropertyValue(p);
            return o;
        };
        const q = (s) => root.querySelector(s);
        const qa = (s) => [...root.querySelectorAll(s)];
        return {
            card: pick(root, ['padding', 'border-radius', 'background-color', 'animation-name', 'background-image']),
            kicker: pick(q('.kicker'), ['font-family', 'font-size', 'font-weight', 'letter-spacing', 'color', 'text-transform']),
            title: pick(q('.box-title'), ['font-family', 'font-size', 'font-weight', 'color', 'margin-bottom']),
            variance: pick(q('.tp-variance'), ['font-family', 'font-size', 'padding', 'border-style', 'background-color', 'color']),
            varianceBeforeContent: q('.tp-variance') ? getComputedStyle(q('.tp-variance'), '::before').content : null,
            totalNum: pick(q('#tp-total'), ['font-family', 'font-size', 'font-weight', 'letter-spacing', 'color']),
            totalTarget: pick(q('.tp-meter-target'), ['font-family', 'font-size', 'color']),
            caption: pick(q('.tp-meter-caption'), ['font-family', 'font-size', 'letter-spacing', 'color', 'text-transform']),
            meterTrack: pick(q('.tp-meter'), ['height', 'border-radius', 'background-image']),
            meterFill: pick(q('.tp-meter-fill'), ['width', 'background-image', 'mask-image']),
            rows: qa('[data-subject]').map(row => ({
                subject: row.dataset.subject,
                subjVar: getComputedStyle(row).getPropertyValue('--subj').trim(),
                dot: pick(row.querySelector('.tp-dot'), ['background-color', 'box-shadow']),
                name: pick(row.querySelector('h4'), ['font-family', 'font-size', 'font-weight', 'color', 'letter-spacing', 'text-transform']),
                num: pick(row.querySelector('.tp-num'), ['font-family', 'font-size', 'font-weight', 'color']),
                tgtLabel: pick(row.querySelector('.tp-tgt'), ['font-size', 'color']),
                track: pick(row.querySelector('.tp-sub-meter'), ['height', 'background-color']),
                fill: pick(row.querySelector('.tp-sub-fill'), ['background-image']),
                fillW: row.querySelector('[id$="-bar"]')?.style.width || null,
                btns: [...row.querySelectorAll('button')].map(b => {
                    const cs = getComputedStyle(b); const r = b.getBoundingClientRect();
                    return { label: b.getAttribute('aria-label'), w: +r.width.toFixed(1), h: +r.height.toFixed(1), fontSize: cs.fontSize, borderStyle: cs.borderStyle, borderRadius: cs.borderRadius };
                }),
                rowH: +row.getBoundingClientRect().height.toFixed(1),
            })),
            gaps: {
                headToMeterboard: q('.tp-meterboard') ? +(q('.tp-meterboard').getBoundingClientRect().y - root.querySelector('.dash-card-head').getBoundingClientRect().bottom).toFixed(1) : null,
                meterToLedger: (q('.tp-ledger') && q('.tp-meter')) ? +(q('.tp-ledger').getBoundingClientRect().y - q('.tp-meter').getBoundingClientRect().bottom).toFixed(1) : null,
            },
            legacyArtifacts: {
                ringNodes: root.querySelectorAll('.tp-ring, .tp-arc-physics').length,
                glyphNodes: root.querySelectorAll('.subj-glyph').length,
                pillNodes: root.querySelectorAll('.distribution-pill').length,
                heroStrokeNodes: root.querySelectorAll('.tp-hero-stroke, .tp-entry-stroke').length,
            },
        };
    });
    fs.writeFileSync(path.join(SHOTS, `redesign-daily-audit-${tag}.json`), JSON.stringify(audit, null, 2));
    console.log(`audit[${tag}] written`);
}

if (MODE === 'before') {
    await dumpAudit('before');
    await card.screenshot({ path: path.join(SHOTS, 'redesign-daily-before.png') });
    await page.setViewportSize({ width: 420, height: 940 });
    await page.waitForTimeout(500);
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);
    await card.screenshot({ path: path.join(SHOTS, 'redesign-daily-before-narrow.png') }).catch(e => console.error('narrow shot failed:', String(e).slice(0, 120)));
    console.log(`${pass} passed, ${fail} failed (BEFORE capture — no redesign assertions)`);
    flushErrors();
    if (errors.length) { console.log('CONSOLE ERRORS (first 5):'); errors.slice(0, 5).forEach(e => console.log('  ·', e.slice(0, 220))); }
    else console.log('no console/page errors');
    await browser.close(); server.close();
    process.exit(errors.length ? 1 : 0);
}

// ── Structure ──
assert(await page.locator('#tp-total').isVisible(), 'hero total numeral present');
assert(await page.locator('#tp-total-bar').count() === 1, 'unified hero stroke present');
assert(await page.locator('.dash-card-tracker .tp-variance').isVisible(), 'variance readout in header');
assert(await page.locator('.dash-card-tracker [data-subject]').count() === 3, 'three subject rows');
assert(await page.locator('.dash-card-tracker [data-subject="physics"] button').count() === 2, 'physics stepper pair present');
assert(await page.locator('#physics-bar').count() === 1 &&
       await page.locator('#chemistry-bar').count() === 1 &&
       await page.locator('#maths-bar').count() === 1, 'three subject strokes present');
// elo-monitor injection anchor survives (app.js inserts before .tp-row-top > .tp-count)
assert(await page.locator('.dash-card-tracker .tp-row-top .tp-count').count() === 3, 'elo anchor .tp-row-top > .tp-count ×3');

// ── Output Meter structure ──
assert(await page.locator('.dash-card-tracker .tp-meter').isVisible(), 'segmented day meter present');
assert(await page.locator('.dash-card-tracker .tp-meter-fill').count() === 1, 'day meter fill present');
assert(await page.locator('.dash-card-tracker .tp-dot').count() === 3, 'subject series dots ×3');
assert(await page.locator('.dash-card-tracker .tp-sub-meter').count() === 3, 'subject meters ×3');
const cardAnim = await card.evaluate(el => getComputedStyle(el).animationName);
assert(cardAnim === 'none' || cardAnim === '', `no spinning border animation (${cardAnim})`);
const cardBg = await card.evaluate(el => getComputedStyle(el).backgroundImage);
assert(!cardBg.includes('conic'), 'no conic rainbow border on the card');

// ── Empty-state shot before any interaction ──
await card.screenshot({ path: path.join(SHOTS, 'redesign-daily-after-empty.png') });
await dumpAudit('empty');

// ── Interaction: log solves (seeds the AFTER state too) ──
const physPlus = page.locator('[data-subject="physics"] button[aria-label*="Increment"]');
for (let i = 0; i < 7; i++) await physPlus.click();
await page.locator('[data-subject="chemistry"] button[aria-label*="Increment"]').click();
await page.waitForTimeout(700);

const physCount = (await page.locator('#physics-count').textContent()).trim();
assert(physCount === '7', `physics counter hydrated (${physCount})`);
const chemCount = (await page.locator('#chemistry-count').textContent()).trim();
assert(chemCount === '1', `chemistry counter hydrated (${chemCount})`);

const total = (await page.locator('#tp-total').textContent()).trim();
assert(total === '8', `hero total = 8 (${total})`);
const tgt = (await page.locator('#tp-total-tgt').textContent()).trim();
assert(tgt === '/ 30', `hero target label (${tgt})`);

const variance = (await page.locator('#variance-val').textContent()).trim();
assert(variance.includes('-'), `variance negative while under target (${variance})`);

// Hero stroke reflects combined progress: 8/30 ≈ 26.7%
const heroW = await page.locator('#tp-total-bar').evaluate(el => parseFloat(el.style.width));
assert(Math.abs(heroW - (8 / 30) * 100) < 1.5, `hero stroke at ~26.7% (${heroW?.toFixed(1)}%)`);
// Physics stroke at 70%
const physW = await page.locator('#physics-bar').evaluate(el => parseFloat(el.style.width));
assert(Math.abs(physW - 70) < 1.5, `physics stroke at 70% (${physW?.toFixed(1)}%)`);

// Decrement works and total follows
await page.locator('[data-subject="physics"] button[aria-label*="Decrement"]').click();
await page.waitForTimeout(350);
assert((await page.locator('#physics-count').textContent()).trim() === '6', 'decrement works');
assert((await page.locator('#tp-total').textContent()).trim() === '7', 'total updates on decrement');
// restore seeded state: physics back to 7
await physPlus.click();
await page.waitForTimeout(450);

// ── Deficit lockdown pulse survives the redesign (alarm border must win) ──
await page.locator('.dash-card-tracker [data-subject="chemistry"]').evaluate(el => el.classList.add('lowest-subject-pulse'));
await page.waitForTimeout(120);
const alarmBorder = await page.locator('.dash-card-tracker [data-subject="chemistry"]').evaluate(el => getComputedStyle(el).borderColor);
assert(alarmBorder.includes('248, 113, 113'), `lockdown alarm border wins (${alarmBorder})`);
await page.locator('.dash-card-tracker [data-subject="chemistry"]').evaluate(el => el.classList.remove('lowest-subject-pulse'));

// ── Completion states: subject at target, then a full day ──
for (let i = 0; i < 3; i++) await physPlus.click();          // physics 7 → 10
await page.waitForTimeout(400);
assert(await page.locator('.dash-card-tracker [data-subject="physics"]').evaluate(el => el.classList.contains('tp-sub-done')),
    'physics row lit .tp-sub-done at 10/10');
const physWDone = await page.locator('#physics-bar').evaluate(el => parseFloat(el.style.width));
assert(Math.abs(physWDone - 100) < 0.01, `physics meter pinned at 100% (${physWDone}%)`);

// Fast-forward the rest of the day through the public counter API
await page.evaluate(() => { window.changeCount('chemistry', 9); window.changeCount('maths', 10); });
await page.waitForTimeout(600);
assert(await card.evaluate(el => el.classList.contains('tp-day-done')), 'card lit .tp-day-done at 30/30');
const heroDoneW = await page.locator('#tp-total-bar').evaluate(el => parseFloat(el.style.width));
assert(Math.abs(heroDoneW - 100) < 0.01, `day meter pinned at 100% (${heroDoneW}%)`);

// Drop one solve: day-done must switch straight back off
await page.evaluate(() => { window.changeCount('chemistry', -1); });
await page.waitForTimeout(400);
assert(!(await card.evaluate(el => el.classList.contains('tp-day-done'))), 'tp-day-done clears below target');
assert((await page.locator('#tp-total').textContent()).trim() === '29', 'total = 29 after decrement');

// AFTER shot state: physics 10 (done) · chemistry 9 · maths 10 (done) · 29/30
await page.screenshot({ path: path.join(SHOTS, 'dashboard-after-full.png') });
await card.screenshot({ path: path.join(SHOTS, 'redesign-daily-after.png') });
await dumpAudit('after');

// ── Narrow (~420px viewport) ──
await page.setViewportSize({ width: 420, height: 940 });
await page.waitForTimeout(600);
await card.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(300);
const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
assert(noHScroll, 'no horizontal overflow at 420px');
await card.screenshot({ path: path.join(SHOTS, 'redesign-daily-after-narrow.png') });
await dumpAudit('narrow');

console.log(`\n${pass} passed, ${fail} failed`);
flushErrors();
if (errors.length) { console.log('CONSOLE ERRORS (first 5):'); errors.slice(0, 5).forEach(e => console.log('  ·', e.slice(0, 220))); }
else console.log('no console/page errors');

await browser.close();
server.close();
process.exit(fail || errors.length ? 1 : 0);
