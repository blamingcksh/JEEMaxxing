// Visual + functional QA for the redesigned Chapter Progress card (.dash-card-progress).
// Usage: node scripts/qa-redesign-chapters.mjs [before|after]
//   before -> screenshots land as redesign-chapters-before.png (legacy markup sanity only)
//   after  -> full redesign assertions + redesign-chapters-after.png / -after-narrow.png
// Serves the repo on 127.0.0.1:8813, drives headless Edge/Chrome, requires ZERO
// console/page errors, seeds a realistic mixed-completion registry + bank.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODE = (process.argv[2] || 'after').toLowerCase();           // 'before' | 'after'
const BASE = 'http://127.0.0.1:8813/index.html';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '.qa-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, `redesign-chapters-${name}.png`);

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
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
            if (err) { res.writeHead(404); res.end('not found'); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    s.on('error', reject);
    s.listen(8813, '127.0.0.1', () => resolve(s));
});
console.log('server up on 8813');

let browser;
try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
} catch {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
    // Service worker / cache hygiene: never serve stale assets in QA.
    try {
        if (navigator.serviceWorker?.getRegistrations) {
            navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
        }
        if (window.caches?.keys) {
            caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {});
        }
    } catch {}
});

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

// Keep the QA hermetic AND error-free: anything that isn't our local server
// (CDN fonts, GSI client) gets a valid empty response instead of a hang/error.
await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:8813')) return route.continue();
    const isCss = url.includes('/css/');
    return route.fulfill({
        status: 200,
        contentType: isCss ? 'text/css' : 'application/javascript',
        body: '',
    }).catch(() => {});
});

let pass = 0, fail = 0;
const assert = (cond, name) => {
    if (cond) { pass++; console.log('  ok', name); }
    else { fail++; console.error('  FAIL', name); }
};

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(3000);
for (let i = 0; i < 6; i++) {
    const overlay = page.locator('.bootseq');
    if (!(await overlay.count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
}
assert(!(await page.locator('.bootseq').count()), 'boot briefing dismissed');
await page.waitForTimeout(800);

// ── Seed a realistic registry: mixed completion, a 0-question chapter,
//    a 100% chapter, and one deliberately long chapter name. ──
const SEED = {
    chapters: {
        physics: [
            'Units & Dimensions',          // 0 questions in bank -> 0%
            'Rotational Motion',           // weakest with questions
            'Electrostatics',
            'Current Electricity',
            'A Very Long Chapter Name To Verify Graceful Truncation Behaviour In Ledger Rows',
            'Modern Physics',              // fully solved -> 100%
        ],
        chemistry: [
            'Mole Concept',
            'Chemical Bonding',
            'Thermodynamics',
            'Periodic Table',
        ],
        maths: [
            'Quadratic Equations',
            'Sequences & Series',
            'Straight Lines',
            'Limits Continuity & Differentiability',
            'Probability',
        ],
    },
    bank: [],
};
let qid = 1;
const pushQ = (subject, chapter, status) =>
    SEED.bank.push({ id: 'qa' + qid++, subject, chapter, status, difficulty: 'medium', easeFactor: 2.5 });
const mix = (subject, chapter, solved, unsolved) => {
    for (let i = 0; i < solved; i++) pushQ(subject, chapter, 'solved');
    for (let i = 0; i < unsolved; i++) pushQ(subject, chapter, 'unsolved');
};
// physics: Units 0q(0%) · Rotational 1/9(11%) · Long 1/8(13%) · Electrostatics 3/9(33%) · Current 5/10(50%) · Modern 12/12(100%)
mix('physics', 'Rotational Motion', 1, 8);
mix('physics', 'Electrostatics', 3, 6);
mix('physics', 'Current Electricity', 5, 5);
mix('physics', 'A Very Long Chapter Name To Verify Graceful Truncation Behaviour In Ledger Rows', 1, 7);
mix('physics', 'Modern Physics', 12, 0);
mix('chemistry', 'Mole Concept', 2, 6);      // 25%
mix('chemistry', 'Chemical Bonding', 7, 7);  // 50%
mix('chemistry', 'Thermodynamics', 9, 3);    // 75%
mix('chemistry', 'Periodic Table', 3, 5);    // 38%
mix('maths', 'Quadratic Equations', 6, 2);   // 75%
mix('maths', 'Sequences & Series', 1, 5);    // 17%
mix('maths', 'Straight Lines', 4, 4);        // 50%
mix('maths', 'Limits Continuity & Differentiability', 8, 8); // 50%
mix('maths', 'Probability', 5, 1);           // 83%

await page.evaluate(seed => {
    window.AppState.chapters = seed.chapters;
    window.AppState.questionBank = seed.bank.map(q => ({ ...q }));
    window.renderChapterProgressList();
}, SEED);
await page.waitForTimeout(700);

const TOTAL_CHAPTERS = 15; // 6 + 4 + 5

// Visible-row counter: the ledger keeps the whole tail in the DOM (CSS-capped),
// so raw locator counts over-count. checkVisibility() sees what users see.
const visRows = () => page.evaluate(() =>
    [...document.querySelectorAll('#chapter-progress-list .cpx-row')]
        .filter(el => el.checkVisibility ? el.checkVisibility() : el.getClientRects().length > 0).length);

if (MODE === 'before') {
    // Baseline sanity only: legacy card renders populated rows.
    const rows = await page.locator('#chapter-progress-list .cp-row').count();
    assert(rows > 0, `legacy card populated (${rows} rows)`);
    const card = page.locator('.dash-card-progress');
    assert(await card.isVisible(), 'progress card visible');
    await card.screenshot({ path: shot('before') });
    console.log('before screenshot saved');
} else {
    const card = page.locator('.dash-card-progress');
    assert(await card.isVisible(), 'progress card visible');

    // ── Structure ──
    const rows = page.locator('.cpx-row');
    assert(await rows.count() === TOTAL_CHAPTERS, `full ledger in DOM (got ${await rows.count()})`);
    assert(await visRows() === 7, `visible rows capped at 7 (got ${await visRows()})`);
    assert(await page.locator('.cpx-cols').isVisible(), 'ledger column header present');
    assert(await page.locator('.cpx-more').isVisible(), '+N more affordance present');
    const moreText = (await page.locator('.cpx-more').textContent()).trim();
    assert(moreText.includes('8'), `more label counts the tail (${moreText})`);

    // ── Weakest-first ordering holds across visible rows ──
    const pcts = await page.evaluate(() =>
        [...document.querySelectorAll('.cpx-row')].map(r => Number(r.dataset.pct)));
    const sortedOk = pcts.every((v, i) => i === 0 || pcts[i - 1] <= v);
    assert(sortedOk, `ordering weakest -> strongest [${pcts.join(',')}]`);
    assert(pcts[0] === 0, 'weakest row is the 0-question chapter (0%)');

    // ── Single-accent discipline: exactly one flagged row ──
    assert(await page.locator('.cpx-row.is-flag').count() === 1, 'exactly one flagged (accent) row');

    // ── Long name stays on one line ──
    const longRow = page.locator('.cpx-row', { hasText: 'A Very Long Chapter Name' });
    const clipped = await longRow.evaluate(el => {
        const cs = getComputedStyle(el.querySelector('.cpx-name'));
        return cs.whiteSpace === 'nowrap' && cs.overflowX === 'hidden' &&
               cs.textOverflow === 'ellipsis' && el.getBoundingClientRect().height < 64;
    });
    assert(clipped, 'long chapter name ellipsizes on a single row line');

    // ── Hairline tracks present, no legacy candy classes ──
    const visTracks = await page.evaluate(() =>
    [...document.querySelectorAll('#chapter-progress-list .cpx-track')]
        .filter(el => el.checkVisibility ? el.checkVisibility() : el.getClientRects().length > 0).length);
assert(visTracks === 7, `hairline track on every visible row (${visTracks})`);
    assert(await page.locator('.cp-row').count() === 0, 'no legacy cp-* rows leak in');

    // ── Desktop screenshot (pristine, pre-interaction) ──
    await card.screenshot({ path: shot('after') });
    console.log('after screenshot saved');

    // ── Expand / collapse affordance works ──
    await page.locator('.cpx-more').click();
    await page.waitForTimeout(450);
    const expClipped = await page.locator('.cpx-row', { hasText: 'A Very Long Chapter Name' }).evaluate(el => {
        const cs = getComputedStyle(el.querySelector('.cpx-name'));
        return cs.whiteSpace === 'nowrap' && cs.overflowX === 'hidden' &&
               cs.textOverflow === 'ellipsis' && el.getBoundingClientRect().height < 64;
    });
    assert(expClipped, 'long name clips cleanly while expanded too');
    assert(await rows.count() === TOTAL_CHAPTERS, `expanded shows all ${TOTAL_CHAPTERS} chapters (got ${await rows.count()})`);
    const expandedPcts = await page.evaluate(() =>
        [...document.querySelectorAll('.cpx-row')].map(r => Number(r.dataset.pct)));
    assert(expandedPcts.every((v, i) => i === 0 || expandedPcts[i - 1] <= v),
        'expanded ordering still weakest -> strongest');
    await page.locator('.cpx-more').click();
    await page.waitForTimeout(350);
    assert(await visRows() === 7, 'collapse restores the capped view');

    // ── Row click routes through openChapterProgress without error ──
    await page.evaluate(() => {
        window.__qaOpened = [];
        window.openChapterDetail = (name) => window.__qaOpened.push(name); // spy (detail view stubbed)
    });
    await page.locator('.cpx-row').first().click();
    await page.waitForTimeout(500);
    const opened = await page.evaluate(() => window.__qaOpened);
    assert(opened.length === 1 && opened[0] === 'Units & Dimensions',
        `row click opened chapter detail (${JSON.stringify(opened)})`);
    const practiceActive = await page.evaluate(() =>
        document.querySelector('[data-tab="practice"]')?.classList.contains('active') ||
        document.getElementById('view-practice')?.classList.contains('active'));
    assert(!!practiceActive, 'practice tab activated after row click');

    // Return to the dashboard so later steps can see the card again
    await page.evaluate(() => {
        const nav = document.querySelector('[data-tab="dashboard"]');
        window.switchTab('dashboard', nav);
    });
    await page.waitForTimeout(500);

    // ── Empty state is beautiful AND functional ──
    await page.evaluate(() => {
        window.AppState.chapters = { physics: [], chemistry: [], maths: [] };
        window.AppState.questionBank = [];
        window.renderChapterProgressList();
    });
    await page.waitForTimeout(300);
    assert(await page.locator('.cpx-empty').isVisible(), 'empty state renders');
    await card.screenshot({ path: shot('after-empty') });

    // Restore populated state, then narrow viewport shot
    await page.evaluate(seed => {
        window.AppState.chapters = seed.chapters;
        window.AppState.questionBank = seed.bank.map(q => ({ ...q }));
        window.renderChapterProgressList();
    }, SEED);

    await page.setViewportSize({ width: 420, height: 900 });
    await page.waitForTimeout(600);
    const narrowClipped = await page.locator('.cpx-row').first().evaluate(el => {
        const name = el.querySelector('.cpx-name');
        return name.scrollWidth <= name.clientWidth + 1;
    });
    assert(narrowClipped, 'narrow 420px: names still clip cleanly');
    await card.screenshot({ path: shot('after-narrow') });
    console.log('narrow screenshot saved');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.slice(0, 10).join('\n'));
else console.log('no console/page errors');

await browser.close();
server.close();
process.exit(fail || errors.length ? 1 : 0);
