// qa-vault-katex.mjs — KaTeX parity probe: vault chapter PREVIEW vs practice DRAWER.
//
// Complaint: in The Vault the chapter PREVIEW renders math fine, but opening the
// SAME question into the practice drawer renders KaTeX broken.
//
// Drives both REAL production paths on identical fixture text and diffs them:
//   PREVIEW  app.js showQuestionList() -> .question-preview-text  (escapeHtml +
//            global KaTeX observer)
//   DRAWER   matrix.js openPracticeDrawer() -> #sr-question-text   (its own
//            _renderKatexIn)
// Per fixture it records katex count, surviving prose, phantom tags, and an
// overflow/geometry read, then screenshots both side by side.
//
// Run: node scripts/qa-vault-katex.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8833;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '.qa-shots');
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

let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }

const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(String(e)));

let pass = 0, fail = 0;
const assert = (cond, name) => {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { console.error('  FAIL ' + name); fail++; }
};

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// Realistic JEE fixtures. `prose` = fragments of non-math text that MUST still
// be readable after rendering.
const FIXTURES = [
    { id: 'kx1', label: 'prose "<" hugging a letter',
      text: 'If a<b and b<c, then \\frac{b-a}{c-b} is:',
      prose: ['then', 'is:'], minKatex: 1 },
    { id: 'kx2', label: 'prose ">" plus two inline frags',
      text: 'If x > 0 and y > 0, then $x^2+y^2>0$ holds so $xy$ is positive.',
      prose: ['If x > 0 and y > 0, then', 'holds so', 'is positive.'], minKatex: 2 },
    { id: 'kx3', label: 'bare delimiter-less LaTeX',
      text: 'The acceleration of the disc is \\frac{g\\sin\\theta}{1+I/mR^2} down the incline.',
      prose: ['The acceleration of the disc is', 'down the incline.'], minKatex: 1 },
    { id: 'kx4', label: 'display block on its own line',
      text: 'Evaluate the integral:\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\nby the fundamental theorem.',
      prose: ['Evaluate the integral:', 'by the fundamental theorem.'], minKatex: 1 },
    { id: 'kx5', label: 'cases environment',
      text: 'Let $f(x)=\\begin{cases} x^2, & x\\ge 0\\\\ -x, & x<0 \\end{cases}$ Find f(-2).',
      prose: ['Find f(-2).'], minKatex: 1 },
    { id: 'kx6', label: 'HTML-ish prose: & and angle brackets',
      text: 'For A && B with C & D where p<q<r, K_c = $\\frac{[C]}{[D]}$.',
      prose: ['For A && B with C & D where p<q<r, K_c =', '.'], minKatex: 1 },
];

await page.goto(BASE, { waitUntil: 'networkidle' });
for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.bootseq').count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(250);
}
await page.waitForTimeout(800);

assert(await page.evaluate(() => typeof window.katex !== 'undefined'), 'KaTeX engine loaded (vendor/katex)');
assert(await page.evaluate(() => typeof window.showQuestionList === 'function'), 'chapter preview renderer exposed');
assert(await page.evaluate(() => typeof window.openPracticeDrawer === 'function'), 'vault practice drawer exposed');

// Seeding MUST run AFTER switchTab and render in the SAME evaluate: the app
// re-hydrates AppState from storage during boot/tab activation, so a bank
// written in an earlier evaluate gets wiped before the list renders.
await page.evaluate(() => { window.switchTab('practice', document.querySelector('[data-tab="practice"]')); });
await page.waitForTimeout(200);
const seeded = await page.evaluate((fixtures) => import('./storage.js').then(({ AppState }) => {
    const now = Date.now();
    const iso = (d) => new Date(now + d * 86400000).toISOString();
    AppState.questionBank = fixtures.map((f) => ({
        id: f.id, subject: 'physics', chapter: 'KaTeX Probe',
        extractedText: f.text,
        options: ['A) $a<b$', 'B) $\\frac{1}{2}$', 'C) x > y & z', 'D) none'],
        correctAnswer: 'A', type: 'mcq',
        status: 'wrong', errorReason: 'conceptual',
        hint: 'Rearrange to $v^2=u^2+2as$ and note a<0.',
        solution: 'Substituting gives $a<b$, hence \\frac{1}{2}.',
        createdAt: iso(-3), lastReviewedAt: iso(-2),
        easeFactor: 2.5, currentInterval: 3, historyLogs: [],
        qElo: 1400, targetTimeMins: 5,
    }));
    AppState.currentSubject = 'physics';
    AppState.currentChapter = 'KaTeX Probe';
    AppState.currentFilter = 'all';
    window.showQuestionList();
    return AppState.questionBank.length;
}), FIXTURES);
assert(seeded === FIXTURES.length, 'fixtures seeded into the bank');

// The preview list was rendered inside the seed evaluate above (single render
// point — a second showQuestionList() here would only re-read the same bank).
await page.waitForTimeout(900);   // let the KaTeX MutationObserver flush

const previewStats = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#questions-grid-container .question-preview-text')).map(el => ({
        katex: el.querySelectorAll('.katex').length,
        text: el.textContent,
        strayTags: el.querySelectorAll('b, i, em, strong, u, s').length,
    }));
});
console.log('preview cards: ' + previewStats.length);

for (let i = 0; i < FIXTURES.length; i++) {
    const f = FIXTURES[i];
    const p = previewStats[i] || { katex: -1, text: '(no card)', strayTags: 0 };

    await page.evaluate((id) => window.openPracticeDrawer(id), f.id);
    await page.waitForTimeout(220);
    const d = await page.evaluate(() => {
        const el = document.getElementById('sr-question-text');
        if (!el) return { katex: -1, text: '(no drawer)', strayTags: 0, mcqKatex: 0, hintKatex: -1 };
        const hint = document.getElementById('sr-hint-body');
        return {
            katex: el.querySelectorAll('.katex').length,
            text: el.textContent,
            strayTags: el.querySelectorAll('b, i, em, strong, u, s').length,
            mcqKatex: document.querySelectorAll('#sr-answer-stage .sr-mcq-text .katex').length,
            hintKatex: hint ? hint.querySelectorAll('.katex').length : -1,
        };
    });
    if (f.id === 'kx1' || f.id === 'kx6') {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, 'vault-katex-drawer-' + f.id + '.png') });
    }
    await page.evaluate(() => window.closePracticeDrawer());
    await page.waitForTimeout(60);

    console.log('\n[' + f.id + ' · ' + f.label + ']');
    console.log('  preview: katex=' + p.katex + ' stray=' + p.strayTags);
    console.log('  drawer : katex=' + d.katex + ' stray=' + d.strayTags + ' mcq=' + d.mcqKatex + ' hint=' + d.hintKatex);
    console.log('  preview text: ' + norm(p.text).slice(0, 110));
    console.log('  drawer  text: ' + norm(d.text).slice(0, 110));

    assert(d.katex >= f.minKatex, 'drawer hydrated math (got ' + d.katex + ', want >=' + f.minKatex + ')');
    assert(d.katex === p.katex, 'drawer math count == preview (' + d.katex + ' vs ' + p.katex + ')');
    assert(norm(d.text) === norm(p.text), 'drawer prose == preview prose');
    for (const t of f.prose) assert(norm(d.text).includes(norm(t)), 'drawer keeps prose "' + t.slice(0, 40) + '"');
    assert(d.strayTags === 0, 'drawer has no phantom tags (' + d.strayTags + ')');
}

fs.mkdirSync(SHOTS, { recursive: true });
await page.evaluate(() => window.openPracticeDrawer('kx1'));
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(SHOTS, 'vault-katex-preview-list.png'), clip: { x: 0, y: 0, width: 1440, height: 1100 } });

console.log('\nconsole/page errors: ' + (consoleErrors.length ? consoleErrors.slice(0, 8).join(' | ') : 'none'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
