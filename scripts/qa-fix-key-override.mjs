// qa-fix-key-override.mjs — regression guard for the inline Fix Key / Override
// Result workflow in the post-attempt practice modal.
//
// Covers: MCQ key flip + Vault unflag, same-outcome key correction, manual
// correct→wrong override, numeric key correction, and free-response
// self-report correction. Includes an idempotence check for exact-ELO restore.
//
// Run: node scripts/qa-fix-key-override.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8856;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
const server = await new Promise(resolve => {
    const s = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        const file = path.join(ROOT, p);
        if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
        fs.readFile(file, (err, data) => {
            if (err) { res.writeHead(404); res.end('not found'); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            res.end(data);
        });
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
});

let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
const page = await context.newPage();
await page.addInitScript(() => { try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch (_) {} });

const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/Drive|gapi|Gemini|net::|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

let pass = 0, fail = 0;
const assert = (cond, name) => {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { fail++; console.error('  FAIL ' + name); }
};
const near = (a, b, eps = 1e-6) => Math.abs(Number(a) - Number(b)) <= eps;
const state = () => page.evaluate(async () => {
    const { AppState, solved } = await import('./storage.js');
    const q = AppState.currentQ || {};
    const snap = (AppState._pqAttemptSnapByIdx || {})[AppState.currentPracticeIndex || 0];
    return {
        status: q.status,
        correctAnswer: q.correctAnswer,
        errorReason: q.errorReason,
        firstAttemptResult: q.firstAttemptResult,
        timeTaken: q.timeTaken,
        subjectElo: AppState.elo.physics,
        globalElo: AppState.elo.global,
        solvedPhysics: Number(solved.physics) || 0,
        streak: Number(AppState.practiceCorrectStreak) || 0,
        snap: snap ? {
            userSelectedOption: snap.userSelectedOption,
            isCorrect: snap.isCorrect,
            solvedDeltaApplied: snap.solvedDeltaApplied,
            eloDelta: snap.eloDelta,
            preStatus: snap.preQ && snap.preQ.status,
        } : null,
        keyBadge: (AppState._pqKeyUpdatedByIdx || {})[AppState.currentPracticeIndex || 0] || null,
    };
});

await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'commit', timeout: 45000 });
for (let i = 0; i < 8; i++) {
    if (!(await page.locator('.bootseq').count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(250);
}
await page.waitForFunction(() => window.AppState && Array.isArray(window.AppState.questionBank), null, { timeout: 15000 });
await page.waitForTimeout(500);

async function start(q) {
    await page.evaluate(async (fixture) => {
        const { AppState, saveAllAsync } = await import('./storage.js');
        AppState.questionBank = [fixture];
        AppState.currentSubject = fixture.subject;
        AppState.currentChapter = fixture.chapter;
        AppState.currentFilter = 'all';
        await saveAllAsync();
        window.switchTab('practice', document.querySelector('[data-tab="practice"]'));
        window.startPracticeWithQuestion(AppState.questionBank, 0);
    }, q);
    await page.waitForTimeout(300);
    await page.waitForSelector('#practice-modal.active', { timeout: 5000 });
}

async function clickOption(index) {
    await page.locator('#practice-modal-content .mcq-option').nth(index).click();
    await page.waitForTimeout(80);
}
async function submit() {
    await page.evaluate(() => { const b = document.getElementById('practice-submit-btn'); if (b) b.click(); });
    await page.waitForSelector('#practice-modal-content .pq-reveal-row', { timeout: 5000 });
    await page.waitForTimeout(180);
}
async function openFix() {
    await page.locator('#pq-fix-key-btn').click();
    await page.waitForSelector('#pq-override-bar:not([hidden])', { timeout: 3000 });
}
async function saveFix() {
    await page.locator('#pq-override-save').click();
    await page.waitForTimeout(350);
}

// ── 1. MCQ: wrong attempt, erroneous key, Vault logged, then flip to correct
const mcq = {
    id: 'qa_fix_1', subject: 'physics', chapter: 'FixKeyProbe',
    extractedText: 'A block of 2 kg moves at 4 m/s. Find its kinetic energy.',
    options: ['A) 16 J', 'B) 8 J', 'C) 32 J', 'D) 4 J'],
    correctAnswer: 'B) 8 J', type: 'mcq', status: 'unsolved',
    solution: 'KE = 1/2 m v^2 = 16 J.', qElo: 1400, targetTimeMins: 3,
    createdAt: new Date().toISOString(), easeFactor: 2.5, historyLogs: [],
};
await start(mcq);
const before1 = await state();
await clickOption(0); // genuinely correct answer A, but stored key says B
await submit();
const wrong1 = await state();
assert(wrong1.status === 'wrong', 'MCQ with bad key graded wrong before correction');
assert(wrong1.solvedPhysics === before1.solvedPhysics, 'wrong attempt did not increment solved counter');

await page.locator('.pq-vault-btn').click();
await page.waitForSelector('#error-reason-modal.active', { timeout: 3000 });
await page.locator('#error-reason-select').selectOption({ index: 1 });
await page.evaluate(() => window.confirmErrorLog());
await page.waitForTimeout(300);
const vaulted1 = await state();
assert(vaulted1.status === 'error' && !!vaulted1.errorReason, 'wrong answer logged to Vault');

await openFix();
await page.locator('#pq-override-bar [data-key="A"]').click();
const inferred = await page.evaluate(() => {
    const btn = document.querySelector('#pq-override-bar [data-override-outcome="correct"]');
    return !!btn && btn.classList.contains('is-selected');
});
assert(inferred, 'MCQ key change auto-infers ACTUALLY CORRECT from user pick');
await saveFix();
const fixed1 = await state();
assert(fixed1.status === 'solved', 'key correction flipped status to solved');
assert(fixed1.correctAnswer === 'A', 'correctAnswer persisted as the corrected letter (got ' + JSON.stringify(fixed1.correctAnswer) + ')');
assert(fixed1.errorReason === undefined, 'Vault errorReason cleared on wrong→correct override');
assert(fixed1.solvedPhysics === before1.solvedPhysics + 1, 'solved counter gained exactly one solve (got ' + fixed1.solvedPhysics + ' from ' + before1.solvedPhysics + ')');
assert(fixed1.subjectElo > wrong1.subjectElo, 'ELO re-priced upward after key correction (got ' + fixed1.subjectElo + ' vs wrong ' + wrong1.subjectElo + ')');
assert(!!fixed1.keyBadge && fixed1.keyBadge.includes('A'), 'KEY UPDATED badge recorded');
const banner1 = await page.evaluate(() => {
    const el = document.querySelector('#practice-modal-content .result-banner');
    return el ? { text: el.textContent, correct: el.classList.contains('correct') } : null;
});
assert(!!banner1 && banner1.correct && banner1.text.includes('PASSED'), 'PASSED banner rendered after correction');

// ── 2. Same-outcome key fix: no counter/ELO movement
const before2 = await state();
await openFix();
await page.locator('#pq-override-bar [data-key="C"]').click();
await page.locator('#pq-override-bar [data-override-outcome="correct"]').click();
await saveFix();
const fixed2 = await state();
assert(fixed2.status === 'solved', 'same-outcome key fix leaves status solved');
assert(fixed2.correctAnswer === 'C', 'same-outcome key fix stores new key (got ' + JSON.stringify(fixed2.correctAnswer) + ')');
assert(fixed2.solvedPhysics === before2.solvedPhysics, 'same-outcome key fix does not touch solved counter');
assert(near(fixed2.subjectElo, before2.subjectElo), 'same-outcome key fix does not re-price ELO');
assert(!!fixed2.keyBadge && fixed2.keyBadge.includes('C'), 'KEY UPDATED badge shows corrected letter');

// ── 3. Correct → wrong override: exact rollback of the solve + ELO
const mcq3 = {
    id: 'qa_fix_3', subject: 'physics', chapter: 'FixKeyProbe',
    extractedText: 'A particle accelerates uniformly from rest at 3 m/s² for 4 s. Find v.',
    options: ['A) 6 m/s', 'B) 9 m/s', 'C) 12 m/s', 'D) 15 m/s'],
    correctAnswer: 'C) 12 m/s', type: 'mcq', status: 'unsolved',
    solution: 'v = u + at = 12 m/s.', qElo: 1400, targetTimeMins: 3,
    createdAt: new Date().toISOString(), easeFactor: 2.5, historyLogs: [],
};
await start(mcq3);
const before3 = await state();
await clickOption(2);
await submit();
const correct3 = await state();
assert(correct3.status === 'solved', 'correct attempt solved before override');
assert(correct3.solvedPhysics === before3.solvedPhysics + 1, 'correct attempt added one solve');

await openFix();
await page.locator('#pq-override-bar [data-override-outcome="wrong"]').click();
await saveFix();
const overridden3 = await state();
assert(overridden3.status === 'wrong', 'manual ACTUALLY WRONG override flips status to wrong');
assert(overridden3.solvedPhysics === before3.solvedPhysics, 'manual correct→wrong override removes exactly one solve');
assert(overridden3.subjectElo < correct3.subjectElo, 'manual correct→wrong override lowers ELO');
assert(near(overridden3.subjectElo, before3.subjectElo + overridden3.snap.eloDelta), 'override ELO is pre-attempt ELO + new delta (no double application)');
const vaultBtn3 = await page.locator('.pq-vault-btn').count();
assert(vaultBtn3 === 1, 'Vault action is available after correct→wrong override');

// ── 4. Numeric key correction
const num = {
    id: 'qa_fix_4', subject: 'physics', chapter: 'FixKeyProbe',
    extractedText: 'What is 2 + 2?', correctAnswer: '5', type: 'numeric',
    status: 'unsolved', solution: '4.', qElo: 1400, targetTimeMins: 2,
    createdAt: new Date().toISOString(), easeFactor: 2.5, historyLogs: [],
};
await start(num);
const before4 = await state();
await page.locator('#numeric-answer-input').fill('4');
await submit();
const wrong4 = await state();
assert(wrong4.status === 'wrong', 'numeric question graded wrong against bad key');

await openFix();
await page.locator('#pq-override-key-input').fill('4');
await page.waitForTimeout(80);
const inferred4 = await page.evaluate(() => {
    const btn = document.querySelector('#pq-override-bar [data-override-outcome="correct"]');
    return !!btn && btn.classList.contains('is-selected');
});
assert(inferred4, 'numeric key change auto-infers ACTUALLY CORRECT');
await saveFix();
const fixed4 = await state();
assert(fixed4.status === 'solved' && Number(fixed4.correctAnswer) === 4, 'numeric key correction stores 4 and solves');
assert(fixed4.solvedPhysics === before4.solvedPhysics + 1, 'numeric correction adds one solve');
assert(!!fixed4.keyBadge && fixed4.keyBadge === '4', 'numeric KEY UPDATED badge shows 4');

// ── 5. Free-response self-report: FAILED then override to correct
const text = {
    id: 'qa_fix_5', subject: 'physics', chapter: 'FixKeyProbe',
    extractedText: 'Write the expression for kinetic energy.', correctAnswer: '1/2 m v^2',
    type: 'text', status: 'unsolved', solution: 'KE = 1/2 m v^2.',
    qElo: 1400, targetTimeMins: 4,
    createdAt: new Date().toISOString(), easeFactor: 2.5, historyLogs: [],
};
await start(text);
const before5 = await state();
await page.evaluate(() => { const b = document.getElementById('practice-submit-btn'); if (b) b.click(); });
await page.waitForSelector('#text-wrong-btn', { timeout: 5000 });
await page.locator('#text-wrong-btn').click();
await page.waitForSelector('#pq-fix-key-btn', { timeout: 5000 });
const wrong5 = await state();
assert(wrong5.status === 'wrong', 'self-report FAILED starts as wrong');
assert(!!wrong5.snap, 'self-report attempt captured a rollback snapshot');

await openFix();
await page.locator('#pq-override-bar [data-override-outcome="correct"]').click();
await saveFix();
const fixed5 = await state();
assert(fixed5.status === 'solved', 'self-report wrong→correct override solves');
assert(fixed5.errorReason === undefined, 'self-report override leaves no Vault errorReason');
assert(fixed5.solvedPhysics === before5.solvedPhysics + 1, 'self-report override adds exactly one solve');

// ── 6. Multi-select MCQ: bad stored multi key, pill-toggle correction
const multi = {
    id: 'qa_fix_6', subject: 'physics', chapter: 'FixKeyProbe',
    extractedText: 'Which of the following are scalars?',
    options: ['A) Speed', 'B) Velocity', 'C) Temperature', 'D) Acceleration'],
    correctAnswer: ['B) Velocity', 'D) Acceleration'], type: 'mcq', status: 'unsolved',
    solution: 'Speed and temperature are scalars.', qElo: 1400, targetTimeMins: 3,
    createdAt: new Date().toISOString(), easeFactor: 2.5, historyLogs: [],
};
await start(multi);
const before6 = await state();
await page.locator('#practice-modal-content .mcq-option').nth(0).click();
await page.locator('#practice-modal-content .mcq-option').nth(2).click();
await page.waitForTimeout(80);
await submit();
const wrong6 = await state();
assert(wrong6.status === 'wrong', 'multi question graded wrong against bad multi key');

await openFix();
const initialSelection = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#pq-override-bar .pq-override-opt.is-selected')).map(b => b.dataset.key).join(','));
assert(initialSelection === 'B,D', 'override bar shows stored multi key B,D selected (got ' + initialSelection + ')');
// Toggle: swap B,D off, A,C on — pills must accumulate, not replace
await page.locator('#pq-override-bar [data-key="B"]').click();
await page.locator('#pq-override-bar [data-key="D"]').click();
await page.locator('#pq-override-bar [data-key="A"]').click();
await page.locator('#pq-override-bar [data-key="C"]').click();
const inferred6 = await page.evaluate(() => {
    const btn = document.querySelector('#pq-override-bar [data-override-outcome="correct"]');
    return !!btn && btn.classList.contains('is-selected')
        && document.querySelectorAll('#pq-override-bar .pq-override-opt.is-selected').length === 2;
});
assert(inferred6, 'multi key toggle accumulates A,C and auto-infers ACTUALLY CORRECT');
await saveFix();
const fixed6 = await state();
assert(fixed6.status === 'solved', 'multi key correction flips status to solved');
assert(Array.isArray(fixed6.correctAnswer) && fixed6.correctAnswer.join(',') === 'A,C',
    'multi correctAnswer persisted as an array (got ' + JSON.stringify(fixed6.correctAnswer) + ')');
assert(fixed6.solvedPhysics === before6.solvedPhysics + 1, 'multi correction adds exactly one solve');

console.log('page errors: ' + (errors.length ? errors.slice(0, 5).join(' | ') : 'none'));
console.log(pass + ' passed, ' + fail + ' failed');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
