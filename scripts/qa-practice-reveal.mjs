// qa-practice-reveal.mjs — regression guard for the practice-modal solve flow.
//
// Drives the REAL user path: Grind Station chapter list -> "Grind" button ->
// #practice-modal -> pick option -> submit -> result banner -> solution popup.
// Asserts KaTeX hydration and prose survival on every math surface in that
// chain (question stem, MCQ selection integrity, reveal banner, solution).
// Guards the v45 fixes: scan-root-bounded math walk + option double-decode.
//
// Run: node scripts/qa-practice-reveal.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8843;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json' };
const server = await new Promise(r => { const s = http.createServer((q, res) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); }); s.listen(PORT, '127.0.0.1', () => r(s)); });
let browser; try { browser = await chromium.launch({ channel: 'msedge', headless: true }); } catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() => { try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {} });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

let pass = 0, fail = 0;
const assert = (cond, name) => {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { console.error('  FAIL ' + name); fail++; }
};

await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'networkidle' });
for (let i = 0; i < 6; i++) { if (!(await page.locator('.bootseq').count())) break; await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(250); }
await page.waitForTimeout(800);

// step 1: switch tab FIRST — storage re-hydration during boot/tab activation
// wipes any bank seeded before this point.
await page.evaluate(() => { window.switchTab('practice', document.querySelector('[data-tab="practice"]')); });
await page.waitForTimeout(250);
// step 2: seed + render in ONE evaluate (see qa-vault-katex.mjs for why).
const seeded = await page.evaluate(() => import('./storage.js').then(({ AppState }) => {
    const now = Date.now(); const iso = d => new Date(now + d * 86400000).toISOString();
    AppState.questionBank = [{
        id: 'rv1', subject: 'physics', chapter: 'RevealProbe',
        extractedText: 'If a<b and b<c, then $\\frac{b-a}{c-b}$ is:',
        options: ['A) $a<b$', 'B) $\\frac{1}{2}$', 'C) x > y', 'D) none'],
        correctAnswer: 'A) $a<b$', type: 'mcq',
        status: 'unsolved',
        solution: 'Since a<b<c, the numerator $b-a>0$ and denominator $c-b>0$, so $\\frac{b-a}{c-b}>0$.',
        createdAt: iso(-3), easeFactor: 2.5, currentInterval: 3, historyLogs: [], qElo: 1400, targetTimeMins: 5,
    }];
    AppState.currentSubject = 'physics'; AppState.currentChapter = 'RevealProbe'; AppState.currentFilter = 'all';
    window.showQuestionList();
    return AppState.questionBank.length;
}));
assert(seeded === 1, 'fixture seeded into the bank');
await page.waitForTimeout(500);
// step 3: open the practice modal via the real Grind button
await page.evaluate(() => {
    const btn = document.querySelector('#questions-grid-container .practice-single-btn');
    if (btn) btn.click();
});
await page.waitForTimeout(400);
const qKatex = await page.evaluate(() => document.querySelectorAll('#latex-render .katex').length);
const qText = await page.evaluate(() => (document.getElementById('latex-render') || {}).textContent || '');
assert(qKatex >= 1, 'practice modal stem hydrated math (got ' + qKatex + ')');
assert(qText.includes('a<b and b<c'), 'stem prose survived ("<" intact, got: ' + qText.slice(0, 40) + ')');
// step 4: select option A (contains "<" — the double-decode canary), submit
const dialogs = [];
page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
await page.evaluate(() => {
    const optA = document.querySelector('#practice-modal-content .mcq-option');
    if (optA) optA.click();
});
await page.waitForTimeout(120);
const selState = await page.evaluate(() => import('./storage.js').then(({ AppState }) => ({
    selectedMcq: AppState.selectedMcq,
    optSelected: !!document.querySelector('#practice-modal-content .mcq-option.selected'),
})));
assert(selState.selectedMcq === 'A) $a<b$', 'option with "<" selected verbatim (got: ' + JSON.stringify(selState.selectedMcq) + ')');
assert(selState.optSelected, 'option shows selected state');
await page.evaluate(() => { const b = document.getElementById('practice-submit-btn'); if (b) b.click(); });
await page.waitForTimeout(450);
assert(dialogs.length === 0, 'no reject alerts on submit (got: ' + JSON.stringify(dialogs) + ')');
const banner = await page.evaluate(() => {
    const el = document.querySelector('#practice-modal-content .result-banner');
    return el ? { katex: el.querySelectorAll('.katex').length, text: el.textContent, correct: el.classList.contains('correct') } : null;
});
assert(!!banner, 'result banner rendered after submit');
assert(!!banner && banner.correct, 'answer graded correct');
assert(!!banner && banner.katex >= 1, 'banner answer math hydrated (got ' + (banner ? banner.katex : -1) + ')');
// step 5: solution popup
await page.evaluate(() => { const b = document.querySelector('#practice-modal-content .show-solution-btn'); if (b) b.click(); });
await page.waitForTimeout(500);
const sol = await page.evaluate(() => {
    const el = document.getElementById('solution-content');
    return {
        katex: el ? el.querySelectorAll('.katex').length : -1,
        text: el ? el.textContent : '',
    };
});
assert(sol.katex >= 3, 'solution popup hydrated all math (got ' + sol.katex + ')');
assert(sol.text.includes('a<b<c'), 'solution prose survived ("<" intact)');

console.log('page errors: ' + (errs.length ? errs.slice(0, 4).join(' | ') : 'none'));
console.log(pass + ' passed, ' + fail + ' failed');
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
