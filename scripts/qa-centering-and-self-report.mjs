import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8852;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
    '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
    '.css':'text/css', '.json':'application/json', '.png':'image/png',
    '.woff2':'font/woff2', '.webmanifest':'application/manifest+json'
};

const server = await new Promise(r => {
    const s = http.createServer((q, res) => {
        let p = decodeURIComponent(q.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        fs.readFile(path.join(ROOT, p), (e, d) => {
            if (e) { res.writeHead(404); res.end('nf'); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
            res.end(d);
        });
    });
    s.listen(PORT, '127.0.0.1', () => r(s));
});

let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});

let pass = 0, fail = 0;
const assert = (cond, name) => {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { console.error('  FAIL ' + name); fail++; }
};

await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'networkidle' });
for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.bootseq').count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
}
await page.waitForTimeout(500);

// Switch to practice tab
await page.evaluate(() => { window.switchTab('practice', document.querySelector('[data-tab="practice"]')); });
await page.waitForTimeout(200);

// Seed a free response question
await page.evaluate(() => import('./storage.js').then(({ AppState }) => {
    AppState.questionBank = [{
        id: 'centering-q1',
        subject: 'physics',
        chapter: 'WindowsCenteringTest',
        extractedText: 'One mole of an ideal monoatomic gas is trapped in the tube and held so that length is h₀ meter. Find the heat supplied to raise temperature by ΔT.',
        correctAnswer: '5/2 R ΔT',
        type: 'text',
        status: 'unsolved',
        solution: 'Heat Q = 5/2 R ΔT.',
        qElo: 1500,
        targetTimeMins: 3
    }];
    AppState.currentSubject = 'physics';
    AppState.currentChapter = 'WindowsCenteringTest';
    AppState.currentFilter = 'all';
    window.showQuestionList();
}));
await page.waitForTimeout(300);

// Open practice modal via Grind button
await page.evaluate(() => {
    const btn = document.querySelector('#questions-grid-container .practice-single-btn');
    if (btn) btn.click();
});
await page.waitForTimeout(500);

// 1. Check Centering at 1920x1080
const geom = await page.evaluate(() => {
    const modal = document.getElementById('practice-modal');
    const shell = document.querySelector('.pq-shell');
    const modalRect = modal.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const modalStyle = window.getComputedStyle(modal);
    return {
        modalWidth: modalRect.width,
        shellX: shellRect.x,
        shellWidth: shellRect.width,
        flexDirection: modalStyle.flexDirection,
        alignItems: modalStyle.alignItems
    };
});

assert(geom.flexDirection === 'column', 'practice-modal flex-direction is column (got ' + geom.flexDirection + ')');
assert(geom.alignItems === 'center', 'practice-modal alignItems is center (got ' + geom.alignItems + ')');
const expectedX = (geom.modalWidth - geom.shellWidth) / 2;
const xDiff = Math.abs(geom.shellX - expectedX);
assert(xDiff <= 25, 'Focus column .pq-shell is horizontally centered on Windows (diff ' + xDiff + 'px, shellX=' + geom.shellX + ', expected=' + expectedX + ')');

// 2. Perform 0.85s hold on free response
const shellBox = await page.locator('.pq-shell').boundingBox();
// Mouse down on empty space in shell
await page.mouse.move(shellBox.x + 50, shellBox.y + 50);
await page.mouse.down();
await page.waitForTimeout(900);
await page.mouse.up();
await page.waitForTimeout(300);

// Check that modal did NOT auto-exit
const modalActive = await page.evaluate(() => {
    const modal = document.getElementById('practice-modal');
    return modal.classList.contains('active') && modal.style.display !== 'none';
});
assert(modalActive, 'practice-modal is STILL OPEN after 0.8s hold and release (did not auto-exit)');

// Check self-report buttons presence
const selfReportButtons = await page.evaluate(() => {
    const correctBtn = document.getElementById('text-correct-btn');
    const wrongBtn = document.getElementById('text-wrong-btn');
    return {
        hasCorrect: !!correctBtn && correctBtn.offsetParent !== null,
        hasWrong: !!wrongBtn && wrongBtn.offsetParent !== null,
        correctText: correctBtn ? correctBtn.textContent : null,
        wrongText: wrongBtn ? wrongBtn.textContent : null
    };
});
assert(selfReportButtons.hasCorrect, 'Clean Lock button is visible and present: ' + selfReportButtons.correctText);
assert(selfReportButtons.hasWrong, 'Skill Issue button is visible and present: ' + selfReportButtons.wrongText);

// 3. Click backdrop / empty space — verify modal does NOT dismiss
await page.mouse.click(100, 100);
await page.waitForTimeout(200);
const stillOpenAfterBackdropTap = await page.evaluate(() => {
    const modal = document.getElementById('practice-modal');
    return modal.classList.contains('active') && modal.style.display !== 'none';
});
assert(stillOpenAfterBackdropTap, 'Modal remains open after clicking on background paper');

// 4. Click Clean Lock button
await page.evaluate(() => {
    const btn = document.getElementById('text-correct-btn');
    if (btn) btn.click();
});
await page.waitForTimeout(300);

const outcome = await page.evaluate(() => import('./storage.js').then(({ AppState }) => {
    const contBtn = document.getElementById('practice-continue-btn');
    return {
        status: AppState.currentQ ? AppState.currentQ.status : null,
        continueVisible: contBtn && contBtn.style.display !== 'none',
        continueText: contBtn ? contBtn.textContent : null
    };
}));
assert(outcome.status === 'solved', 'Question marked solved upon Clean Lock');
assert(outcome.continueVisible, 'Next Question button visible in footer after self-reporting');

// 5. Click top-right ✕ to close modal
await page.evaluate(() => window.closePracticeModal());
await page.waitForTimeout(400);

const closedAfterX = await page.evaluate(() => {
    const modal = document.getElementById('practice-modal');
    return !modal.classList.contains('active');
});
assert(closedAfterX, 'Practice modal successfully closed via top-right ✕ button');

console.log(pass + ' passed, ' + fail + ' failed');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
