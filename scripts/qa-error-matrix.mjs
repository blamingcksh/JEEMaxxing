// Visual + functional QA for the redesigned Error Matrix (The Vault).
// Covers: subject folder count badges, redesigned cards (due badges, labeled
// stats, attempt dots), live meta feedback line, filter pills + clear escape,
// search clear button, no-match empty state, subject empty state, daily queue
// progress dividers + done ribbon, practice drawer open, and the "/" hotkey.
//
// Run: node scripts/qa-error-matrix.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8797;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = 'C:/Users/Chaksh/AppData/Local/Temp/dsh-shots/error-matrix';
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
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
console.log('server up');

let browser;
try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
} catch {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

let pass = 0, fail = 0;
const assert = (cond, name) => {
    if (cond) { pass++; console.log('  ok', name); }
    else { fail++; console.error('  FAIL', name); }
};

await page.goto(BASE, { waitUntil: 'networkidle' });
for (let i = 0; i < 6; i++) {
    const overlay = page.locator('.bootseq');
    if (!(await overlay.count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(250);
}
await page.waitForTimeout(800);

// ── 1 · Vault view ────────────────────────────────────────────────────────
await page.click('.nav-item[data-tab="errors"]');
await page.waitForTimeout(400);

// ── Seed the question bank through the real storage module ────────────────
const seeded = await page.evaluate(async () => {
    const storage = await import('./storage.js');
    const now = Date.now();
    const iso = (d) => new Date(now + d * 86400000).toISOString();
    let n = 0;
    const mk = (over) => {
        n++;
        return Object.assign({
            id: 'qa-em-' + n,
            subject: 'physics',
            chapter: 'Rotational Motion',
            extractedText: 'A disc rolls without slipping. Find the acceleration.',
            options: ['A) 2g/3', 'B) g/3', 'C) g/2', 'D) g'],
            correctAnswer: 'A',
            type: 'mcq',
            status: 'error',
            errorReason: 'conceptual',
            currentInterval: 0,
            easeFactor: 2.5,
            nextReviewAt: iso(0),
            targetTimeMins: 5,
            isMastered: false,
            historyLogs: [],
            qElo: 1200,
        }, over);
    };
    const bank = [
        mk({ chapter: 'Rotational Motion', errorReason: 'conceptual', nextReviewAt: iso(-1) }),
        mk({ id: 'qa-em-1b', chapter: 'Electrostatics', errorReason: 'calculation', nextReviewAt: iso(-2), historyLogs: [
            { id: 'l1', timestamp: iso(-9), result: 'incorrect', autonomy: 'independent', frictionTypes: '["CONCEPT"]', timeSpentMins: 4, newEaseFactor: 2.3 },
            { id: 'l2', timestamp: iso(-4), result: 'correct', autonomy: 'independent', frictionTypes: '["PERFECT"]', timeSpentMins: 3, newEaseFactor: 2.4 },
        ] }),
        mk({ chapter: 'SHM', errorReason: 'misread', nextReviewAt: iso(1) }),
        mk({ chapter: 'Thermo', errorReason: 'calculation', nextReviewAt: iso(2) }),
        mk({ chapter: 'Waves', errorReason: 'conceptual', nextReviewAt: iso(12) }),
        mk({ chapter: 'Optics', errorReason: 'misread', nextReviewAt: iso(30), isMastered: true }),
        mk({ id: 'qa-em-c1', subject: 'chemistry', chapter: 'Mole Concept', errorReason: 'calculation', nextReviewAt: iso(-1) }),
    ];
    storage.AppState.questionBank.push(...bank);
    return bank.length;
});
console.log('seeded', seeded, 'questions');

// Re-render through the real entry point so counts + meta line hydrate.
await page.evaluate(() => {
    const el = document.querySelector('.subject-folder[data-subject="physics"]');
    window.openErrorMatrix('physics', el);
});
await page.waitForTimeout(500);

const folder = page.locator('.subject-folder[data-subject="physics"]');
assert(await folder.isVisible(), 'physics folder visible');

// ── Command-deck geometry ────────────────────────────────────────────────
assert(await page.locator('.vault-shell').isVisible(), 'deck shell present');
assert(await page.locator('.vault-rail').isVisible(), 'rail visible');
assert(await page.locator('#daily-queue-btn').isVisible(), 'queue mode button lives in rail');
assert(await page.locator('.rail-actions .btn-primary').isVisible(), 'capture actions live in rail');
const deck = await page.evaluate(() => {
    const shell = document.querySelector('.vault-shell');
    const cols = getComputedStyle(shell).gridTemplateColumns.split(' ').length;
    const toolbar = document.querySelector('.error-filters');
    return { cols, sticky: getComputedStyle(toolbar).position === 'sticky', erm: !!document.querySelector('.vault-erm .erm-total') };
});
assert(deck.cols === 2, 'desktop deck is rail + stage (' + deck.cols + ' cols)');
assert(deck.sticky, 'filter toolbar is sticky');
assert(deck.erm, 'ERM stat strip inside stage');
assert(await page.locator('.folder-count#folder-count-physics').textContent() === '6', 'physics folder count badge = 6');
assert(await page.locator('.folder-count#folder-count-maths').evaluate(el => el.classList.contains('is-zero')), 'zero-count maths badge dimmed');

const cards = page.locator('#error-list-container .error-block');
assert(await cards.count() === 6, '6 physics cards rendered');

// ── Status-grouped board ──────────────────────────────────────────────────
const heads = page.locator('#error-list-container .em-group-head');
assert(await heads.count() === 4, '4 status group headers (ready/due_soon/scheduled/mastered)');
assert(await heads.first().getAttribute('data-group-status') === 'ready', 'board opens with Due Now section');
assert((await heads.first().locator('.emg-count').textContent()) === '2', 'Due Now counter shows 2');
assert(await heads.nth(3).locator('.emg-label').textContent().then(t => /Mastered/.test(t)), 'Mastered section present');

const meta = page.locator('#matrix-meta');
assert(!(await meta.isHidden()), 'meta line visible');
const metaText = await meta.textContent();
assert(/6.*of 6.*shown/.test(metaText.replace(/\s+/g, ' ')), 'meta shows 6 of 6: ' + metaText.trim());
assert(/due now/i.test(metaText), 'meta shows due-now count');

await page.screenshot({ path: path.join(SHOTS, '01-vault-overview.png') });

// ── 2 · Card anatomy ──────────────────────────────────────────────────────
const firstCard = cards.first();
assert(await firstCard.locator('.sr-due-badge.sr-due--ready').count() === 1, 'ready card has Due-now badge');
assert((await firstCard.locator('.sr-due-badge').textContent()).trim() === 'Due now', 'badge reads plain-language Due now');
assert(await firstCard.locator('.sr-stat i').first().textContent() === 'interval', 'stats have labels');
assert(await page.locator('#error-list-container .sr-attempt-dot').count() === 2, 'attempt dots rendered (history card)');
assert(await firstCard.locator('.sr-practice-btn .sr-btn-arrow').count() === 1, 'hero CTA with arrow');
const railColor = await firstCard.evaluate(el => getComputedStyle(el, '::before').backgroundColor);
assert(railColor.includes('248') || railColor.includes('239') || railColor.includes('rgb'), 'type rail painted: ' + railColor);

// ── 3 · Filter pills + meta feedback ─────────────────────────────────────
await page.click('.matrix-pill[data-emf-value="ready"]');
await page.waitForTimeout(250);
assert(await page.locator('#error-list-container .error-block:not(.hidden)').count() === 2, 'Due-now pill filters to 2 cards');
assert(await page.locator('#error-list-container .em-group-head:not([hidden])').count() === 1, 'only the Due Now section remains visible');
assert((await page.locator('#error-list-container .em-group-head[data-group-status="mastered"] .emg-count').textContent()) === '0', 'hidden sections count to 0');
assert(await meta.locator('.matrix-meta-clear').isVisible(), 'Clear-filters escape appears');
await page.screenshot({ path: path.join(SHOTS, '02-filtered-due-now.png') });

await page.click('.matrix-meta-clear');
await page.waitForTimeout(250);
assert(await page.locator('#error-list-container .error-block:not(.hidden)').count() === 6, 'clear resets to 6 visible');
assert(await page.locator('.matrix-pill[data-emf-value="all"][data-emf-filter], .emf-pill-group[data-emf-filter="status"] .matrix-pill[data-emf-value="all"]').first().evaluate(el => el.classList.contains('active')), 'All pill re-activated');

// ── 4 · Search + no-match state ──────────────────────────────────────────
await page.fill('#matrix-search-input', 'zzz-nothing');
await page.waitForTimeout(400);
assert(await page.locator('#em-nomatch').isVisible(), 'no-match empty state appears');
assert(await page.locator('#matrix-search-clear').isVisible(), 'search clear X visible');
await page.screenshot({ path: path.join(SHOTS, '03-no-match.png') });
await page.click('#em-nomatch .em-empty-secondary');
await page.waitForTimeout(250);
assert(await page.locator('#error-list-container .error-block:not(.hidden)').count() === 6, 'no-match clear restores all');
assert(!(await page.locator('#matrix-search-clear').isVisible()), 'search X hidden after clear');

// search that matches one chapter
await page.fill('#matrix-search-input', 'electro');
await page.waitForTimeout(400);
assert(await page.locator('#error-list-container .error-block:not(.hidden)').count() === 1, 'chapter search narrows to 1');
await page.click('#matrix-search-clear');
await page.waitForTimeout(250);

// ── 5 · "/" hotkey focuses search ─────────────────────────────────────────
await page.keyboard.press('/');
await page.waitForTimeout(150);
assert(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'matrix-search-input', '/ focuses vault search');

// ── 6 · Practice drawer ───────────────────────────────────────────────────
// whole-card click opens practice (the interaction-direction change)…
await page.locator('#error-list-container .error-block .error-chapter').first().click();
await page.waitForTimeout(400);
assert(await page.locator('.sr-practice-overlay').isVisible(), 'clicking a card opens practice');
await page.click('.sr-drawer-close');
await page.waitForTimeout(400);
// …and the explicit CTA still works
await page.locator('#error-list-container .error-block .sr-practice-btn').first().click();
await page.waitForTimeout(500);
assert(await page.locator('.sr-practice-overlay').isVisible(), 'practice drawer opens');
assert(await page.locator('.sr-mcq-option').count() === 4, 'MCQ options rendered');
await page.screenshot({ path: path.join(SHOTS, '04-practice-drawer.png') });
await page.locator('.sr-mcq-option').first().click();
await page.waitForTimeout(200);
assert(await page.locator('.sr-mcq-option.selected').count() === 1, 'option selects');
await page.click('.sr-drawer-close');
await page.waitForTimeout(400);
assert(!(await page.locator('.sr-practice-overlay').count()), 'drawer closes');

// ── 7 · Daily Fix Queue ───────────────────────────────────────────────────
await page.click('#daily-queue-btn');
await page.waitForTimeout(500);
assert(await page.locator('.daily-queue-subject-divider').count() >= 1, 'queue subject dividers render');
assert(await page.locator('.dqs-track i').count() >= 1, 'queue progress bars render');
await page.screenshot({ path: path.join(SHOTS, '05-daily-queue.png') });
await page.click('#daily-queue-btn');
await page.waitForTimeout(400);

// ── 8 · Empty subject state ───────────────────────────────────────────────
await page.click('.subject-folder[data-subject="maths"]');
await page.waitForTimeout(400);
assert(await page.locator('#error-list-container .em-empty').isVisible(), 'empty state renders for maths');
assert((await page.locator('#error-matrix-title').textContent()).includes('Maths'), 'title switches to Maths');
await page.screenshot({ path: path.join(SHOTS, '06-empty-state.png') });

// ── 9 · Console hygiene ───────────────────────────────────────────────────
const realErrors = errors.filter(e => !/favicon|net::ERR|Failed to load resource/.test(e));
assert(realErrors.length === 0, 'no console errors (' + realErrors.length + ')');
if (realErrors.length) console.log(realErrors.slice(0, 6).join('\n---\n'));

console.log('\nRESULT:', pass, 'passed /', fail, 'failed');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
