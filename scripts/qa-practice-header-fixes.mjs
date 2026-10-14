import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8856;
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

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
await page.waitForTimeout(400);

console.log('── 1. Unit Tests for _pqDecorateText ──');
const unitTests = await page.evaluate(async () => {
    const { _pqDecorateText } = await import('./app.js');
    const results = {};

    // Screen 3 units
    const t1 = _pqDecorateText('Solar radiation is 1.4 kW/m² and temperature is 290 K and R_e = 6000 km.');
    results.t1_nowrap = t1.includes('1.4 kW/m²') && t1.includes('ph-nowrap') && t1.includes('290 K') && t1.includes('R_e = 6000 km');

    // Whitespace around punctuation
    const t2 = _pqDecorateText('An ideal gas. It expands isothermally.');
    results.t2_snug_period = t2.includes('ideal gas</span>.') && t2.includes('ph-tight-r');

    // Parentheses ( $V$ )
    const t3 = _pqDecorateText('Consider potential difference ( $V$ ) across terminal.');
    results.t3_snug_parens = t3.includes('(<span class="param-highlight ph-nowrap ph-tight-l ph-tight-r">$V$</span>)') || t3.includes('(<span class="param-highlight ph-tight-l ph-tight-r');

    // Imperative goal detection
    const t4 = _pqDecorateText('A block of 2 kg slides down. Calculate the acceleration.');
    results.t4_imperative = t4.includes('<div class="question-goal">Calculate the acceleration.</div>');

    // Subpart markers and vertical breathing room
    const t5 = _pqDecorateText('In the circuit: (a) find the current (b) find the power.');
    results.t5_subparts = t5.includes('class="pq-subpart"') && t5.includes('(a)') && t5.includes('(b)');

    // Trailing bracketed hint after ?
    const t6 = _pqDecorateText('A block slides on a rough surface. What is the final speed? [Given cos 36° = 0.8]');
    results.t6_bracket_hint = t6.includes('<div class="question-goal">') &&
        t6.includes('What is the final speed?') &&
        t6.includes('[Given cos 36° = 0.8]') &&
        t6.indexOf('What is the final speed?') > t6.indexOf('<div class="question-goal">') &&
        t6.indexOf('[Given cos 36° = 0.8]') > t6.indexOf('<div class="question-goal">') &&
        !t6.startsWith('<div class="question-goal">');

    // Trailing parenthesized hint after ?
    const t7 = _pqDecorateText('A stone is dropped from a cliff. What is the time taken? (Use g = 10 m/s²)');
    results.t7_paren_hint = t7.includes('<div class="question-goal">') &&
        t7.includes('What is the time taken?') &&
        t7.includes('Use') &&
        t7.includes('/s²') &&
        t7.indexOf('What is the time taken?') > t7.indexOf('<div class="question-goal">') &&
        t7.indexOf('Use') > t7.indexOf('<div class="question-goal">') &&
        !t7.startsWith('<div class="question-goal">');

    return results;
});

assert(unitTests.t1_nowrap, 'Screen 3 units (1.4 kW/m², 290 K, R_e = 6000 km) have ph-nowrap');
assert(unitTests.t2_snug_period, 'ideal gas. has snug period with ph-tight-r and no detached space');
assert(unitTests.t3_snug_parens, '( $V$ ) is snug without ballooned spaces and has tight padding');
assert(unitTests.t4_imperative, 'Trailing sentence starting with Calculate is styled as .question-goal');
assert(unitTests.t5_subparts, 'Subparts (a) and (b) are wrapped with .pq-subpart in goal block');
assert(unitTests.t6_bracket_hint, 'Trailing [Given ...] block after ? is included in .question-goal');
assert(unitTests.t7_paren_hint, 'Trailing (Use ...) block after ? is included in .question-goal');

console.log('── 2. Diagram Enlargement in Split View ──');
await page.evaluate(() => { window.switchTab('practice', document.querySelector('[data-tab="practice"]')); });
await page.waitForTimeout(200);

// Seed a question with BOTH image and text (triggers split view)
await page.evaluate(() => import('./storage.js').then(({ AppState }) => {
    AppState.questionBank = [{
        id: 'split-q1',
        subject: 'physics',
        chapter: 'Optics',
        type: 'text',
        extractedText: 'A light ray passes through a prism of angle 60°. Calculate the angle of deviation.',
        imageDataUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="%23ddd"/><text x="50%" y="50%" text-anchor="middle">Prism</text></svg>',
        correctAnswer: '30°',
        solution: 'Use prism deviation formula: $\\delta = i + e - A$.',
        status: 'unsolved',
        qElo: 1350
    }];
    AppState.currentSubject = 'physics';
    AppState.currentChapter = 'Optics';
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

const splitMetrics = await page.evaluate(() => {
    const shell = document.querySelector('.pq-shell');
    const grid = document.querySelector('.pq-qa-grid');
    const media = document.querySelector('.pq-qa-media');
    const img = document.querySelector('.pq-qa-media img');
    const shellStyle = shell ? window.getComputedStyle(shell) : null;
    const gridStyle = grid ? window.getComputedStyle(grid) : null;
    const imgStyle = img ? window.getComputedStyle(img) : null;

    return {
        hasGrid: !!grid,
        shellMaxWidth: shellStyle ? shellStyle.maxWidth : null,
        gridGap: gridStyle ? gridStyle.gap : null,
        imgMaxHeight: imgStyle ? imgStyle.maxHeight : null,
        imgMinWidth: imgStyle ? imgStyle.minWidth : null,
        imgObjectFit: imgStyle ? imgStyle.objectFit : null
    };
});

assert(splitMetrics.hasGrid, '.pq-qa-grid is active when diagram and text are present');
assert(splitMetrics.shellMaxWidth === '920px', '.pq-shell widens to max-width: 920px (got: ' + splitMetrics.shellMaxWidth + ')');
assert(splitMetrics.gridGap === '36px', '.pq-qa-grid gap is 36px (got: ' + splitMetrics.gridGap + ')');
assert(splitMetrics.imgMaxHeight === '380px', '.pq-qa-media img max-height is 380px (got: ' + splitMetrics.imgMaxHeight + ')');
assert(splitMetrics.imgMinWidth === '280px', '.pq-qa-media img min-width is 280px (got: ' + splitMetrics.imgMinWidth + ')');
assert(splitMetrics.imgObjectFit === 'contain', '.pq-qa-media img object-fit is contain (got: ' + splitMetrics.imgObjectFit + ')');

// Switch to Parchment mode (moon off) to verify light mode background
await page.evaluate(() => {
    document.body.classList.remove('immersive-active');
});
await page.waitForTimeout(100);

const parchmentBg = await page.evaluate(() => {
    const media = document.querySelector('.pq-qa-media');
    return media ? window.getComputedStyle(media).backgroundColor : null;
});
assert(parchmentBg === 'rgb(243, 239, 230)', 'Parchment .pq-qa-media has background-color: var(--pq-bg) (got: ' + parchmentBg + ')');

// Verify streak fire is HIDDEN in Light mode while solving
const streakSolvingLight = await page.evaluate(() => {
    const viz = document.querySelector('#practice-modal #streak-visualizer');
    const mini = document.querySelector('#practice-modal .pq-mini-status');
    return {
        vizDisplay: viz ? window.getComputedStyle(viz).display : null,
        miniDisplay: mini ? window.getComputedStyle(mini).display : null
    };
});
assert(streakSolvingLight.vizDisplay === 'none', 'Streak visualizer is hidden in Light mode while solving (got: ' + streakSolvingLight.vizDisplay + ')');
assert(streakSolvingLight.miniDisplay === 'none', '.pq-mini-status is hidden in Light mode while solving (got: ' + streakSolvingLight.miniDisplay + ')');

// Check Roast mode backing patch padding and background
await page.evaluate(() => {
    document.body.classList.add('immersive-active');
});
await page.waitForTimeout(100);

const roastStyles = await page.evaluate(() => {
    const media = document.querySelector('.pq-qa-media');
    if (!media) return null;
    const s = window.getComputedStyle(media);
    return { padding: s.padding, bg: s.backgroundColor };
});
assert(roastStyles && roastStyles.padding === '14px', 'Roast parchment backing patch padding is 14px (got: ' + (roastStyles ? roastStyles.padding : null) + ')');
assert(roastStyles && roastStyles.bg === 'rgb(239, 228, 203)', 'Roast .pq-qa-media backing patch is #efe4cb (got: ' + (roastStyles ? roastStyles.bg : null) + ')');

console.log('── 3. Post-Reveal Collapse and [CLEAN LOCK] Fix ──');
// Reveal the answer
await page.evaluate(() => {
    const btn = document.getElementById('practice-submit-btn');
    if (btn) btn.click();
});
await page.waitForTimeout(300);

// Click "Clean Lock ✅"
await page.evaluate(() => {
    const btn = document.getElementById('text-correct-btn');
    if (btn) btn.click();
});
await page.waitForTimeout(300);

const postReveal = await page.evaluate(() => {
    const content = document.getElementById('practice-modal-content');
    const headerSlot = document.getElementById('elo-header-slot');
    const eloPill = headerSlot ? headerSlot.querySelector('.elo-header-chip') : null;
    const contentPill = content ? content.querySelector('.elo-shift-chip') : null;

    // Check for redundant banner and keep-going
    const cleanBanner = Array.from(content.querySelectorAll('.result-banner')).filter(b => b.textContent.includes('Clean lock'));
    const keepGoing = content.querySelectorAll('.pm-keep-going');
    const revealRow = content.querySelector('.pq-reveal-row');
    const peepBtn = revealRow ? revealRow.querySelector('.show-solution-btn') : null;
    const contBtn = document.getElementById('practice-continue-btn');

    return {
        pillText: eloPill ? eloPill.textContent : '',
        pillClasses: eloPill ? eloPill.className : '',
        headerChipCount: headerSlot ? headerSlot.querySelectorAll('.elo-header-chip').length : 0,
        contentChipCount: content ? content.querySelectorAll('.elo-shift-chip').length : 0,
        hasRedundantCleanBanner: cleanBanner.length > 0,
        hasKeepGoing: keepGoing.length > 0,
        hasRevealRow: !!revealRow,
        hasPeepBtn: !!peepBtn,
        continueVisible: contBtn && contBtn.style.display !== 'none',
        continueText: contBtn ? contBtn.textContent : '',
        streakDisplay: window.getComputedStyle(document.querySelector('#practice-modal #streak-visualizer')).display
    };
});

assert(postReveal.pillText.includes('[CLEAN LOCK]'), 'Elo pill displays [CLEAN LOCK] (got: ' + postReveal.pillText + ')');
assert(!postReveal.pillText.includes('[SKILL ISSUE]'), 'Elo pill does NOT display [SKILL ISSUE]');
assert(postReveal.headerChipCount === 1, 'Exactly one header Elo chip rendered (got: ' + postReveal.headerChipCount + ')');
assert(postReveal.contentChipCount === 0, 'Duplicate content chip removed (got: ' + postReveal.contentChipCount + ')');
assert(!postReveal.hasRedundantCleanBanner, 'Redundant "Clean lock. Marked correct." banner removed');
assert(!postReveal.hasKeepGoing, 'Redundant "10 more to today\'s target" line removed');
assert(postReveal.hasRevealRow, 'Row 1 is .pq-reveal-row');
assert(postReveal.hasPeepBtn, 'Peep Solution button rendered in reveal row');
assert(postReveal.continueVisible && postReveal.continueText.includes('Next Question'), 'Row 2 footer contains "Next Question →"');
assert(postReveal.streakDisplay === 'flex', 'Streak fire is visible post-reveal in Roast mode (got: ' + postReveal.streakDisplay + ')');

// Check streak fire is ALSO visible post-reveal in Light mode (Parchment)
await page.evaluate(() => { document.body.classList.remove('immersive-active'); });
const streakLightRevealed = await page.evaluate(() => {
    const viz = document.querySelector('#practice-modal #streak-visualizer');
    return viz ? window.getComputedStyle(viz).display : null;
});
assert(streakLightRevealed === 'flex', 'Streak fire is visible post-reveal in Light mode (got: ' + streakLightRevealed + ')');

console.log('── 4. Peep Solution Popup Above Practice Modal ──');
// Click "Peep Solution" button
await page.evaluate(() => {
    const btn = document.querySelector('.show-solution-btn');
    if (btn) btn.click();
});
await page.waitForTimeout(300);

const solutionModalMetrics = await page.evaluate(() => {
    const solModal = document.getElementById('solution-modal');
    const pracModal = document.getElementById('practice-modal');
    const solCard = solModal ? solModal.querySelector('.solution-modal-card') : null;
    const solStyle = solModal ? window.getComputedStyle(solModal) : null;
    const pracStyle = pracModal ? window.getComputedStyle(pracModal) : null;

    // Check hit testing: point at center of solution-modal card
    let hitTarget = null;
    if (solCard) {
        const rect = solCard.getBoundingClientRect();
        hitTarget = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }

    return {
        solActive: solModal && solModal.classList.contains('active'),
        solZIndex: solStyle ? parseInt(solStyle.zIndex, 10) : null,
        pracZIndex: pracStyle ? parseInt(pracStyle.zIndex, 10) : null,
        hitInSolCard: solCard && hitTarget ? solCard.contains(hitTarget) : false
    };
});

assert(solutionModalMetrics.solActive, '#solution-modal is active after clicking Peep Solution');
assert(solutionModalMetrics.solZIndex >= 6000, '#solution-modal z-index is >= 6000 (got: ' + solutionModalMetrics.solZIndex + ')');
assert(solutionModalMetrics.solZIndex > solutionModalMetrics.pracZIndex, '#solution-modal z-index (' + solutionModalMetrics.solZIndex + ') > #practice-modal z-index (' + solutionModalMetrics.pracZIndex + ')');
assert(solutionModalMetrics.hitInSolCard, 'Topmost clickable element at center is inside #solution-modal card, not obscured by practice modal');

// Close solution modal
await page.evaluate(() => {
    const closeBtn = document.querySelector('#solution-modal .close-btn');
    if (closeBtn) closeBtn.click();
});
await page.waitForTimeout(300);

const closedSolMetrics = await page.evaluate(() => {
    const solModal = document.getElementById('solution-modal');
    const pracModal = document.getElementById('practice-modal');
    return {
        solActive: solModal && solModal.classList.contains('active'),
        pracActive: pracModal && pracModal.classList.contains('active')
    };
});
assert(!closedSolMetrics.solActive, '#solution-modal closed cleanly');
assert(closedSolMetrics.pracActive, '#practice-modal remains open beneath it');

console.log('\nResults: ' + pass + ' passed, ' + fail + ' failed');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
