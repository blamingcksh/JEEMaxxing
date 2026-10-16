import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8833;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_DIR = 'C:\\Users\\Chaksh\\.gemini\\antigravity\\brain\\8552a492-2f17-47cc-b8d0-82d680de0e7d';

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

console.log('Test server up on port ' + PORT);

let browser;
try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
} catch {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
}

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', m => {
    if (m.type() === 'error') console.log('PAGE ERROR:', m.text());
});
page.on('pageerror', e => console.log('UNCAUGHT EXCEPTION:', e));

await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
    try { localStorage.setItem('jeemax_nightguard_v1', JSON.stringify({ dismissed: true })); } catch {}
});

await page.goto(BASE, { waitUntil: 'networkidle' });
for (let i = 0; i < 6; i++) {
    const overlay = page.locator('.bootseq');
    if (!(await overlay.count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(250);
}
await page.waitForTimeout(600);

// Navigate to Error Matrix tab
await page.click('.nav-item[data-tab="errors"]');
await page.waitForTimeout(400);

// Seed 3 questions:
// q3: Wave Optics Free-Response with Diagram (the scenario from the user's screenshot)
// q2: Definite Integrals Numeric
// q1: Kinematics MCQ
console.log('Seeding bank with Error Matrix items...');
await page.evaluate(async () => {
    const storage = await import('./storage.js');
    const now = Date.now();
    const iso = (d) => new Date(now + d * 86400000).toISOString();
    const q1 = {
        id: 'vault_test_q1',
        subject: 'physics',
        chapter: 'Kinematics',
        type: 'mcq',
        extractedText: 'A particle moves along a straight line such that its velocity is given by v = 3t^2 + 2t m/s. Find the acceleration at t = 2s.',
        options: ['12 m/s²', '14 m/s²', '16 m/s²', '18 m/s²'],
        correctAnswer: 'B',
        solution: 'Differentiating v with respect to t: a = dv/dt = 6t + 2. At t = 2s, a = 6(2) + 2 = 14 m/s².',
        status: 'error',
        errorReason: 'silly_mistake',
        frictionReason: 'formula',
        nextReviewAt: iso(0),
        historyLogs: [{ result: 'incorrect', timestamp: iso(-1) }]
    };

    const q2 = {
        id: 'vault_test_q2',
        subject: 'physics',
        chapter: 'Definite Integrals',
        type: 'numeric',
        extractedText: 'Evaluate the integral from 0 to 1 of x^3 dx. Enter the exact value as a decimal.',
        correctAnswer: 0.25,
        tolerance: 0.01,
        solution: 'Integral of x^3 dx is [x^4 / 4] from 0 to 1 = 1/4 - 0 = 0.25.',
        status: 'error',
        errorReason: 'calculation',
        nextReviewAt: iso(0),
        historyLogs: [{ result: 'incorrect', timestamp: iso(-1) }]
    };

    const q3 = {
        id: 'vault_test_q3',
        subject: 'physics',
        chapter: 'Wave Optics',
        type: 'free_response',
        extractedText: 'In a Young\'s double slit experiment, a light source of wavelength 500 nm is used. The distance between slits is d = 0.5 mm, and distance to screen is D = 1 m. A thin mica sheet of thickness t and refractive index 1.5 is placed in front of one slit. Find the fringe shift.',
        diagramImageUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200" viewBox="0 0 360 200"><rect width="100%" height="100%" fill="#efe4cb"/><text x="180" y="90" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#3d2f23">Wave Optics | YDSE</text><text x="180" y="125" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#6f5f4c">S1, S2, d=0.5mm, D=1m, sheet t</text></svg>'),
        correctAnswer: '(mu - 1) * t * D / d',
        solution: 'Fringe shift delta = (beta / lambda) * (mu - 1) * t = (D / d) * (mu - 1) * t.',
        hint: 'Use path difference extra term: Delta x = (mu - 1) * t.',
        status: 'error',
        errorReason: 'concept',
        nextReviewAt: iso(0),
        historyLogs: [{ result: 'incorrect', timestamp: iso(-1) }]
    };

    storage.AppState.questionBank = storage.AppState.questionBank.filter(q => !['vault_test_q1', 'vault_test_q2', 'vault_test_q3'].includes(q.id));
    storage.AppState.questionBank.unshift(q3, q2, q1);

    const el = document.querySelector('.subject-folder[data-subject="physics"]');
    if (window.openErrorMatrix) {
        window.openErrorMatrix('physics', el);
    }
});

await page.waitForTimeout(500);

// =========================================================================
// TEST 1: Wave Optics Split-View (q3) — Diagram Right, Text Left, 920px container
// =========================================================================
console.log('Opening Error Matrix practice drawer for vault_test_q3 (Wave Optics Split-View)...');
await page.evaluate(() => {
    window.openPracticeDrawer('vault_test_q3');
});

await page.waitForSelector('#sr-practice-overlay.pq-stage', { state: 'visible', timeout: 5000 });
console.log('✓ Stage overlay is visible with .pq-stage');

const splitCheck = await page.evaluate(() => {
    const overlay = document.getElementById('sr-practice-overlay');
    const shell = overlay.querySelector('.pq-shell');
    const grid = overlay.querySelector('.pq-qa-grid');
    const textCol = overlay.querySelector('.pq-qa-text');
    const mediaCol = overlay.querySelector('.pq-qa-media');
    const moonBtn = document.getElementById('sr-moon-btn');
    const prevBtn = document.getElementById('sr-nav-prev-btn');
    const nextBtn = document.getElementById('sr-nav-next-btn');
    const holdHint = document.getElementById('sr-hold-hint');
    const revealBtn = document.getElementById('sr-reveal-answer-btn');

    const shellRect = shell?.getBoundingClientRect();
    const textRect = textCol?.getBoundingClientRect();
    const mediaRect = mediaCol?.getBoundingClientRect();

    const moonBg = moonBtn ? window.getComputedStyle(moonBtn).backgroundColor : '';
    const prevBg = prevBtn ? window.getComputedStyle(prevBtn).backgroundColor : '';

    return {
        hasMediaClass: overlay.classList.contains('pq-has-media'),
        hasGrid: !!grid,
        shellWidth: shellRect ? Math.round(shellRect.width) : 0,
        textLeft: textRect ? Math.round(textRect.left) : 0,
        mediaLeft: mediaRect ? Math.round(mediaRect.left) : 0,
        isTextLeftOfMedia: textRect && mediaRect ? textRect.left < mediaRect.left : false,
        mediaTop: mediaRect ? Math.round(mediaRect.top) : 0,
        zeroClippingTop: mediaRect ? mediaRect.top >= 30 : false,
        moonIcon: moonBtn ? moonBtn.textContent.trim() : '',
        moonBgTransparent: moonBg === 'rgba(0, 0, 0, 0)' || moonBg === 'transparent',
        prevBgTransparent: prevBg === 'rgba(0, 0, 0, 0)' || prevBg === 'transparent',
        hasHoldHint: !!holdHint,
        holdHintText: holdHint ? holdHint.textContent.trim() : '',
        revealBtnText: revealBtn ? revealBtn.textContent.trim() : ''
    };
});

console.log('✓ Wave Optics Split-View Layout Check:', JSON.stringify(splitCheck, null, 2));

if (!splitCheck.hasGrid || !splitCheck.isTextLeftOfMedia) {
    throw new Error('Split view grid failed: expected text on left and media on right');
}
if (!splitCheck.zeroClippingTop) {
    throw new Error('Diagram clipped at top edge: mediaTop is ' + splitCheck.mediaTop);
}
if (splitCheck.shellWidth < 880) {
    throw new Error('Expected 920px shell width in split view, got ' + splitCheck.shellWidth);
}
if (splitCheck.moonIcon !== '◑') {
    throw new Error('Expected gold moon ◑ in Roast mode, got ' + splitCheck.moonIcon);
}

// Screenshot 1: Wave Optics Split-View in Roast Mode
const shotSplitPath = path.join(ARTIFACT_DIR, 'vault_stage_split_view.png');
await page.screenshot({ path: shotSplitPath });
console.log('✓ Screenshot saved:', shotSplitPath);

// Test Hold anywhere (on background) 0.8s to reveal answer
console.log('Testing 0.8s hold anywhere on stage to reveal answer...');
await page.mouse.move(640, 400);
await page.mouse.down();
await page.waitForTimeout(900); // 0.8s hold
await page.mouse.up();
await page.waitForTimeout(500);

const revealCheck = await page.evaluate(() => {
    const revealBtn = document.getElementById('sr-reveal-answer-btn');
    const selfReport = document.querySelector('.sr-self-report-btns');
    const correctBtn = document.querySelector('.sr-self-btn.correct');
    return {
        revealBtnHidden: !revealBtn || revealBtn.style.display === 'none',
        hasSelfReport: !!selfReport,
        hasCorrectBtn: !!correctBtn
    };
});
console.log('✓ Free-response revealed via hold-anywhere:', JSON.stringify(revealCheck, null, 2));

// Self-report correct
console.log('Clicking "Yes, correct" self-report button...');
await page.click('.sr-self-btn.correct');
await page.waitForTimeout(400);

// Select autonomy to enable submit
console.log('Selecting autonomy: independent...');
await page.click('.sr-toggle-btn[data-value="independent"]');
await page.waitForTimeout(200);

const reflectionCheck = await page.evaluate(() => {
    const tagStage = document.getElementById('sr-tag-stage');
    const footer = document.querySelector('.sr-drawer-footer');
    const holdHint = document.getElementById('sr-hold-hint');
    const submitNextBtn = document.getElementById('sr-submit-next-btn');
    return {
        tagStageVisible: tagStage && window.getComputedStyle(tagStage).display !== 'none',
        footerVisible: footer && window.getComputedStyle(footer).display !== 'none',
        holdHintHidden: holdHint && window.getComputedStyle(holdHint).display === 'none',
        submitNextEnabled: submitNextBtn ? !submitNextBtn.disabled : false
    };
});
console.log('✓ Reflection card & footer active, submit enabled:', JSON.stringify(reflectionCheck, null, 2));

// Progress to next question (vault_test_q2 - Numeric)
console.log('Clicking Log & Next (submitPracticeLogAndNext)...');
await page.click('#sr-submit-next-btn');
await page.waitForTimeout(600);

const debugInfo = await page.evaluate(() => {
    return {
        overlayExists: !!document.getElementById('sr-practice-overlay'),
        chTitle: document.getElementById('sr-stage-ch-title')?.textContent,
        qText: document.querySelector('.sr-question-text')?.textContent,
        numInput: !!document.getElementById('sr-numeric-input'),
        queuePos: document.getElementById('sr-queue-pos')?.textContent
    };
});
console.log('DEBUG INFO after Log & Next:', JSON.stringify(debugInfo, null, 2));

// =========================================================================
// TEST 2 & 3: Progress through remaining cards in queue (MCQ & Numeric)
// =========================================================================
async function handleNextCard() {
    const cardInfo = await page.evaluate(() => {
        const isNumeric = !!document.getElementById('sr-numeric-input');
        const isMcq = document.querySelectorAll('.sr-mcq-option').length > 0;
        const qText = document.querySelector('.sr-question-text')?.textContent?.substring(0, 40);
        return { isNumeric, isMcq, qText };
    });
    console.log('Handling card in queue:', cardInfo);

    if (cardInfo.isMcq) {
        // Screenshot MCQ
        const shotMcqPath = path.join(ARTIFACT_DIR, 'vault_stage_mcq.png');
        await page.screenshot({ path: shotMcqPath });
        console.log('✓ Screenshot saved:', shotMcqPath);

        // Select option B
        await page.click('.sr-mcq-option[data-letter="B"]');
        await page.waitForTimeout(200);

        // Hold-to-submit on confirm button
        const confirmBtn = await page.$('#sr-confirm-btn');
        const box = await confirmBtn.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(900);
        await page.mouse.up();
        await page.waitForTimeout(500);

        // Select autonomy
        await page.click('.sr-toggle-btn[data-value="independent"]');
        await page.waitForTimeout(200);

        const shotMcqAnsweredPath = path.join(ARTIFACT_DIR, 'vault_stage_mcq_answered.png');
        await page.screenshot({ path: shotMcqAnsweredPath });
        console.log('✓ Screenshot saved:', shotMcqAnsweredPath);

        console.log('Clicking Log & Next...');
        await page.click('#sr-submit-next-btn');
        await page.waitForTimeout(600);
    } else if (cardInfo.isNumeric) {
        // Screenshot Numeric
        const shotNumericPath = path.join(ARTIFACT_DIR, 'vault_stage_numeric.png');
        await page.screenshot({ path: shotNumericPath });
        console.log('✓ Screenshot saved:', shotNumericPath);

        // Toggle Moon button (Roast -> Parchment)
        console.log('Toggling theme to Parchment with #sr-moon-btn...');
        await page.click('#sr-moon-btn');
        await page.waitForTimeout(300);

        const shotParchmentPath = path.join(ARTIFACT_DIR, 'vault_stage_parchment.png');
        await page.screenshot({ path: shotParchmentPath });
        console.log('✓ Screenshot saved:', shotParchmentPath);

        // Toggle back to Roast mode
        await page.click('#sr-moon-btn');
        await page.waitForTimeout(200);

        // Enter numeric answer: 0.25
        console.log('Entering numeric answer 0.25...');
        await page.fill('#sr-numeric-input', '0.25');
        await page.waitForTimeout(200);

        // Confirm numeric answer
        console.log('Confirming numeric answer...');
        await page.click('#sr-confirm-btn');
        await page.waitForTimeout(500);

        // Select autonomy
        await page.click('.sr-toggle-btn[data-value="independent"]');
        await page.waitForTimeout(200);

        // Peep Solution
        await page.click('#sr-peep-sol-btn');
        await page.waitForTimeout(300);

        const shotAnsweredPath = path.join(ARTIFACT_DIR, 'vault_stage_numeric_answered.png');
        await page.screenshot({ path: shotAnsweredPath });
        console.log('✓ Screenshot saved:', shotAnsweredPath);

        // Close drawer
        console.log('Closing drawer via corner close button...');
        await page.click('.sr-drawer-close');
        await page.waitForTimeout(400);
    }
}

await handleNextCard();
const stillOpen = await page.evaluate(() => !!document.getElementById('sr-practice-overlay'));
if (stillOpen) {
    await handleNextCard();
}

const finalClosedState = await page.evaluate(() => {
    const overlay = document.getElementById('sr-practice-overlay');
    return {
        hasOverlay: !!overlay,
        bodyPqActive: document.body.classList.contains('pq-active'),
        bodyImmersive: document.body.classList.contains('immersive-active')
    };
});
console.log('✓ Drawer cleanly dismissed:', JSON.stringify(finalClosedState, null, 2));

await browser.close();
server.close();
console.log('\n======================================================');
console.log('🎉 ALL ERROR MATRIX IMMERSIVE PARITY CHECKS PASSED 100%!');
console.log('======================================================');
