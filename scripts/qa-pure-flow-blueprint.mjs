// qa-pure-flow-blueprint.mjs — Verification for the Pure-Display Flow Blueprint
// Covers:
// 1. Clock/Top Island removal: .pq-top is gone, #question-timer is sr-hidden.
// 2. 720px centered focus column: max-width <= 720px.
// 3. Exactly 2 warm skins: Roast (#1b130d) with moon ON, Parchment (#F3EFE6) with moon OFF.
// 4. Diagram blend: mix-blend-mode multiply, clip-path inset(4px).
// 5. Saccadic anchors: .param-highlight and isolated .question-goal.
// 6. Hold-to-reveal gesture on free response.
//
// Run: node scripts/qa-pure-flow-blueprint.mjs

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8849;
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
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});

const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

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
await page.waitForTimeout(600);

// Switch to practice tab
await page.evaluate(() => { window.switchTab('practice', document.querySelector('[data-tab="practice"]')); });
await page.waitForTimeout(200);

// Seed a free response question with variables and a diagram
await page.evaluate(() => import('./storage.js').then(({ AppState }) => {
    AppState.questionBank = [{
        id: 'flow-q1',
        subject: 'physics',
        chapter: 'FlowThermodynamics',
        extractedText: 'One mole of an ideal monoatomic gas is trapped in the tube and held so that length is h₀ meter. Vapour pressure is negligible. How much heat must be supplied to the gas to increase temperature by ΔT?',
        diagramImageUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/><circle cx="50" cy="50" r="30" fill="black"/></svg>',
        correctAnswer: 'nRΔT',
        type: 'text',
        status: 'unsolved',
        solution: 'Worked solution for flow test.',
        qElo: 1450,
        targetTimeMins: 3
    }];
    AppState.currentSubject = 'physics';
    AppState.currentChapter = 'FlowThermodynamics';
    AppState.currentFilter = 'all';
    window.showQuestionList();
}));
await page.waitForTimeout(300);

// Open practice modal
await page.evaluate(() => {
    const btn = document.querySelector('#questions-grid-container .practice-single-btn');
    if (btn) btn.click();
});
await page.waitForTimeout(400);

// 1. Check layout & chrome deletion
const layoutCheck = await page.evaluate(() => {
    const topIsland = document.querySelector('.pq-top');
    const timerEl = document.getElementById('question-timer');
    const paceLine = document.getElementById('pq-pace');
    const shell = document.querySelector('.pq-shell');
    const shellWidth = shell ? shell.getBoundingClientRect().width : 0;
    const timerRect = timerEl ? timerEl.getBoundingClientRect() : null;

    return {
        topIslandPresent: !!topIsland,
        paceLinePresent: !!paceLine,
        shellWidthMax720: shellWidth <= 720 && shellWidth > 0,
        timerHiddenFromView: timerRect ? (timerRect.width <= 1 || timerRect.height <= 1) : false
    };
});

assert(!layoutCheck.topIslandPresent, 'Top island pill (.pq-top) is completely eliminated');
assert(layoutCheck.paceLinePresent, '2px Ambient Pace Line (#pq-pace) is present');
assert(layoutCheck.shellWidthMax720, 'Focus column (.pq-shell) constrained to <= 720px');
assert(layoutCheck.timerHiddenFromView, 'Timer display is visually hidden from viewport');

// 2. Check Saccadic highlighting & Goal isolation
const textCheck = await page.evaluate(() => {
    const highlights = Array.from(document.querySelectorAll('#latex-render .param-highlight')).map(el => el.textContent.trim());
    const goalEl = document.querySelector('#latex-render .question-goal');
    return {
        highlightsCount: highlights.length,
        hasMonoatomicOrMole: highlights.some(h => /mole|monoatomic|ideal/i.test(h)),
        goalText: goalEl ? goalEl.textContent : null
    };
});
assert(textCheck.highlightsCount >= 2, 'Saccadic anchors generated (found ' + textCheck.highlightsCount + ')');
assert(textCheck.hasMonoatomicOrMole, 'Physical parameters highlighted');
assert(textCheck.goalText && textCheck.goalText.includes('How much heat must be supplied'), 'Target goal isolated with question-goal border');

// 3. Check Diagram blend
const diagramCheck = await page.evaluate(() => {
    const img = document.querySelector('.pq-qa-media img, #practice-modal-img');
    if (!img) return null;
    const style = window.getComputedStyle(img);
    return {
        mixBlendMode: style.mixBlendMode,
        clipPath: style.clipPath
    };
});
assert(diagramCheck && diagramCheck.mixBlendMode === 'multiply', 'Diagram has mix-blend-mode: multiply');
assert(diagramCheck && diagramCheck.clipPath.includes('inset(4px)'), 'Diagram has 4px inner clip-path');

// 4. Check Roast & Parchment skins
const roastColors = await page.evaluate(() => {
    const modal = document.getElementById('practice-modal');
    return {
        isImmersive: document.body.classList.contains('immersive-active'),
        bg: window.getComputedStyle(modal).backgroundColor
    };
});
assert(roastColors.isImmersive, 'Default stage opens in Roast (moon ON)');
// rgb(27, 19, 13) is #1b130d
assert(roastColors.bg === 'rgb(27, 19, 13)', 'Roast background is warm coffee #1b130d (got: ' + roastColors.bg + ')');

// Toggle to Parchment
await page.evaluate(() => window.toggleImmersive());
await page.waitForTimeout(450);

const parchmentColors = await page.evaluate(() => {
    const modal = document.getElementById('practice-modal');
    return {
        isImmersive: document.body.classList.contains('immersive-active'),
        bg: window.getComputedStyle(modal).backgroundColor
    };
});
assert(!parchmentColors.isImmersive, 'Moon button toggles to Parchment (moon OFF)');
// rgb(243, 239, 230) is #F3EFE6
assert(parchmentColors.bg === 'rgb(243, 239, 230)', 'Parchment background is warm aged paper #F3EFE6 (got: ' + parchmentColors.bg + ')');

// 5. Test Hold-to-reveal gesture on free response
// Before hold, state is 'solving'
const stateBefore = await page.evaluate(() => document.getElementById('practice-modal').getAttribute('data-pq-state'));
assert(stateBefore === 'solving', 'Initial practice state is solving');

// A quick tap (100ms) should NOT reveal
const modalBox = await page.locator('#practice-modal').boundingBox();
await page.mouse.move(modalBox.x + 200, modalBox.y + 200);
await page.mouse.down();
await page.waitForTimeout(100);
await page.mouse.up();
await page.waitForTimeout(150);

const stateAfterQuickTap = await page.evaluate(() => document.getElementById('practice-modal').getAttribute('data-pq-state'));
assert(stateAfterQuickTap === 'solving', 'Quick tap does NOT trigger reveal (accidental tap guard works)');

// Now perform 0.85s hold
await page.mouse.move(modalBox.x + 200, modalBox.y + 200);
await page.mouse.down();
await page.waitForTimeout(900);
await page.mouse.up();
await page.waitForTimeout(300);

const stateAfterHold = await page.evaluate(() => {
    const modal = document.getElementById('practice-modal');
    const banner = document.querySelector('#practice-modal-content .result-banner');
    return {
        state: modal.getAttribute('data-pq-state'),
        bannerText: banner ? banner.textContent : null
    };
});

assert(stateAfterHold.state === 'answered', '0.8s hold reveals answer (state flipped to answered)');
assert(stateAfterHold.bannerText && stateAfterHold.bannerText.includes('nRΔT'), 'Answer revealed in banner');

console.log('page errors: ' + (errs.length ? errs.slice(0, 4).join(' | ') : 'none'));
console.log(pass + ' passed, ' + fail + ' failed');
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
