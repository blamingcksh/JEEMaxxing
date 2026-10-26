// qa-telemetry-ui.mjs - QA for the cognitive-density telemetry layer:
// Domain Zone header/rows, Question Matrix reticle cards, solver Stage A
// (confidence ghost + visible reveal control) and Stage B (diagnostic audit +
// process grade), plus the retention SVG gauge.
//
// Run: node scripts/qa-telemetry-ui.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8978;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const MIME = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
    '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();

await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch (_) {}
});

const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/Drive|gapi|Gemini|net::|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

let pass = 0, fail = 0;
const assert = (cond, name) => {
    if (cond) { pass++; console.log('  ok ', name); }
    else { fail++; console.error('  FAIL', name); }
};

await page.goto(BASE, { waitUntil: 'commit', timeout: 45000 });
for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.bootseq').count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
}
await page.waitForFunction(() => window.AppState && Array.isArray(window.AppState.questionBank), null, { timeout: 15000 });
await page.waitForTimeout(700);

const seeded = await page.evaluate(async () => {
    const { AppState, saveAllAsync } = await import('./storage.js');
    const iso = new Date().toISOString();
    AppState.chapters = { physics: ['Kinematics'], chemistry: [], maths: [] };
    AppState.questionBank = [
        {
            id: 'qa_tele_1', subject: 'physics', chapter: 'Kinematics',
            extractedText: 'A block of 2 kg moves with $v = 4 m/s$. Calculate the kinetic energy.',
            options: ['A) 8 J', 'B) 16 J', 'C) 32 J', 'D) 4 J'], correctAnswer: 'B) 16 J',
            type: 'mcq', status: 'solved', firstAttemptResult: 'correct',
            qElo: 1450, timeTaken: 55, targetTimeMins: 3,
            lastReviewedAt: iso, stability: 30, difficultyD: 5, easeFactor: 2.5,
            reps: 4, historyLogs: [],
        },
        {
            id: 'qa_tele_2', subject: 'physics', chapter: 'Kinematics',
            extractedText: 'A particle starts from rest with uniform acceleration 3 m/s². Find its velocity after 4 s.',
            options: ['A) 6 m/s', 'B) 9 m/s', 'C) 12 m/s', 'D) 15 m/s'], correctAnswer: 'C) 12 m/s',
            type: 'mcq', status: 'wrong', firstAttemptResult: 'incorrect',
            errorReason: 'concept gap', qElo: 1350, timeTaken: 120, targetTimeMins: 3,
            lastReviewedAt: iso, stability: 10, difficultyD: 6, easeFactor: 2.3,
            reps: 2, historyLogs: [],
        },
        {
            id: 'qa_tele_3', subject: 'physics', chapter: 'Kinematics',
            extractedText: 'A train decelerates uniformly from 20 m/s to rest in 5 s. Find the distance covered.',
            options: ['A) 40 m', 'B) 50 m', 'C) 60 m', 'D) 80 m'], correctAnswer: 'B) 50 m',
            type: 'mcq', status: 'unsolved', optionsSelected: [],
            qElo: 1400, targetTimeMins: 4, historyLogs: [],
        },
        {
            id: 'qa_tele_4', subject: 'physics', chapter: 'Kinematics',
            extractedText: 'A stone is dropped from rest. Find its speed after 2 s (g = 10 m/s²).',
            options: ['A) 10 m/s', 'B) 20 m/s', 'C) 30 m/s', 'D) 40 m/s'], correctAnswer: 'B) 20 m/s',
            type: 'mcq', status: 'error', firstAttemptResult: 'incorrect',
            errorReason: 'sign error', qElo: 1300, timeTaken: 90, targetTimeMins: 3,
            lastReviewedAt: iso, stability: 8, difficultyD: 6, easeFactor: 2.1,
            reps: 1, historyLogs: [],
        },
    ];
    await saveAllAsync();
    window.updateUI();
    return AppState.questionBank.length;
});
assert(seeded === 4, 'telemetry fixture seeded');

await page.evaluate(() => window.selectSubject('physics'));
await page.waitForTimeout(500);
await page.evaluate(() => window.updateUI());
await page.waitForTimeout(300);

const subjectBand = await page.evaluate(() => {
    const card = document.querySelector('.subject-col[data-subject="physics"] .subject-card');
    return card ? {
        band: card.dataset.band,
        ring: card.style.getPropertyValue('--ring-pct'),
        ringSvg: !!card.querySelector('.subject-ring-arc'),
        label: (card.querySelector('.subject-tele-label') || {}).textContent || '',
    } : null;
});
assert(subjectBand && ['ready', 'fading', 'critical'].includes(subjectBand.band), 'Arena subject band set (got ' + (subjectBand && subjectBand.band) + ')');
assert(subjectBand && Number(subjectBand.ring) >= 0, 'Arena subject ring percentage set (got ' + (subjectBand && subjectBand.ring) + ')');
assert(subjectBand && subjectBand.ringSvg, 'Arena subject ring SVG present');
assert(subjectBand && subjectBand.label.includes('SUBJECT // PHYSICS'), 'Arena subject telemetry label present');

const domain = await page.evaluate(() => ({
    chip: (document.getElementById('chapters-subject-chip') || {}).textContent || '',
    title: (document.getElementById('chapters-subject-title') || {}).textContent || '',
    back: (document.querySelector('#practice-chapters-view .dz-back') || {}).textContent || '',
    options: [...document.querySelectorAll('#question-filter option')].map(o => o.textContent),
}));
assert(domain.chip.trim() === 'DOMAIN // PHYSICS', 'Domain Zone subject chip (got ' + domain.chip + ')');
assert(domain.title.trim() === 'Chapters', 'Domain Zone title retained');
assert(domain.back.includes('ARENA'), 'Domain Zone back control reads ARENA');
assert(domain.options.includes('Verified') && domain.options.includes('Flagged'), 'Question filter uses VERIFIED/FLAGGED lexicon');

const chapterRow = await page.evaluate(() => {
    const row = document.querySelector('#chapters-list-container .chapter-item');
    return row ? {
        reticle: !!row.querySelector('.chapter-reticle svg'),
        rate: (row.querySelector('.chapter-item-rate') || {}).textContent || '',
        coverage: (row.querySelector('.chapter-coverage') || {}).textContent || '',
        purge: !!row.querySelector('.delete-chapter'),
    } : null;
});
assert(chapterRow && chapterRow.reticle, 'Domain row reticle rendered');
assert(chapterRow && /% HIT/.test(chapterRow.rate), 'Domain row hit rate rendered');
assert(chapterRow && /RESOLVED/.test(chapterRow.coverage), 'Domain row resolved coverage rendered');
assert(chapterRow && chapterRow.purge, 'Domain row purge affordance rendered');

await page.evaluate(() => window.openChapterDetail('Kinematics'));
await page.waitForTimeout(500);

const cardState = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#questions-grid-container .question-card')];
    return {
        count: cards.length,
        singleBtns: document.querySelectorAll('#questions-grid-container .practice-single-btn').length,
        heads: cards.filter(c => c.querySelector('.qm-card-head .qm-card-id')).length,
        edits: cards.filter(c => c.querySelector('.qm-card-edit')).length,
        textCards: cards.filter(c => c.querySelector('.question-preview-text.is-text')).length,
        statuses: cards.map(c => (c.querySelector('.status-badge') || {}).textContent || ''),
        statsReticle: !!document.querySelector('#stats-row .qm-reticle-wrap svg'),
        readouts: document.querySelectorAll('#stats-row .qm-readout').length,
    };
});
assert(cardState.count >= 1, 'Question Matrix cards render');
assert(cardState.singleBtns === 0, 'Legacy per-card Grind buttons removed');
assert(cardState.heads === cardState.count, 'Every card has Q-index head');
assert(cardState.edits === cardState.count, 'Every card retains an edit affordance');
assert(cardState.textCards >= 1, 'Text-only cards align to the top');
assert(cardState.statuses.some(s => s.includes('VERIFIED')), 'Verified card status rendered');
assert(cardState.statuses.some(s => s.includes('FAILED')), 'Failed card status rendered');
assert(cardState.statuses.some(s => s.includes('FLAGGED')), 'Flagged card status rendered');
assert(cardState.statsReticle, 'Question Matrix stats reticle rendered');
assert(cardState.readouts >= 2, 'Question Matrix mono readouts rendered');

const qmGlobal = await page.evaluate(() => {
    const read = () => {
        const el = [...document.querySelectorAll('#stats-row .qm-readout')]
            .find(n => n.textContent.includes('RESOLVED'));
        return el ? el.querySelector('b').textContent.trim() : null;
    };
    const before = read();
    const select = document.getElementById('question-filter');
    select.value = 'wrong';
    window.applyFilter();
    const flagged = read();
    select.value = 'all';
    window.applyFilter();
    return { before, flagged, restored: read() };
});
assert(qmGlobal.before === '1/4' && qmGlobal.flagged === '1/4' && qmGlobal.restored === '1/4',
    'Question Matrix RESOLVED stays chapter-global across filters (got: ' + JSON.stringify(qmGlobal) + ')');

await page.evaluate(() => {
    const card = document.querySelector('#questions-grid-container .question-card');
    if (card) card.click();
});
await page.waitForTimeout(600);

const stageA = await page.evaluate(() => {
    const modal = document.getElementById('practice-modal');
    const ghost = document.getElementById('pq-conf-ghost');
    const hint = document.getElementById('pq-hold-hint');
    const strip = document.getElementById('practice-footer');
    return {
        active: modal.classList.contains('active'),
        state: modal.getAttribute('data-pq-state'),
        ghostDisplay: ghost ? getComputedStyle(ghost).display : null,
        ghostButtons: ghost ? ghost.querySelectorAll('button').length : 0,
        hint: hint ? hint.textContent : '',
        stripOpacity: strip ? getComputedStyle(strip).opacity : null,
        diagDisplay: getComputedStyle(document.getElementById('pq-diag')).display,
        ghostRect: ghost ? ghost.getBoundingClientRect().toJSON() : null,
        submitRect: (() => {
            const btn = document.getElementById('practice-submit-btn');
            return btn ? btn.getBoundingClientRect().toJSON() : null;
        })(),
    };
});
assert(stageA.active, 'Practice modal opened from card click');
assert(stageA.state === 'solving', 'Stage A starts in solving state');
assert(stageA.ghostDisplay === 'flex' && stageA.ghostButtons === 3, 'Stage A confidence ghost visible with 3 controls');
assert(stageA.hint.includes('HOLD 800MS'), 'Stage A hold hint shows 800ms copy');
assert(stageA.stripOpacity === '1', 'Stage A Reveal control strip is visible');
assert(stageA.diagDisplay === 'none', 'Stage B diagnostic hidden during solve');
assert(stageA.ghostRect && stageA.submitRect &&
    (stageA.ghostRect.bottom <= stageA.submitRect.top || stageA.ghostRect.top >= stageA.submitRect.bottom),
    'Confidence ghost clears the lock-in control');

await page.keyboard.press('2');
await page.waitForTimeout(120);
const confidence = await page.evaluate(() => ({
    pending: window._pendingSolveConfidence,
    pressed: document.querySelector('#pq-conf-ghost [data-conf="likely"]').getAttribute('aria-pressed'),
}));
assert(confidence.pending === 'likely', 'Confidence key 2 stores likely');
assert(confidence.pressed === 'true', 'Confidence control reflects pressed state');

await page.evaluate(() => {
    const opt = document.querySelector('#practice-modal-content .mcq-option');
    if (opt) opt.click();
    const submit = document.getElementById('practice-submit-btn');
    if (submit) submit.click();
});
await page.waitForTimeout(800);

const stageB = await page.evaluate(() => {
    const diag = document.getElementById('pq-diag');
    return {
        state: document.getElementById('practice-modal').getAttribute('data-pq-state'),
        display: getComputedStyle(diag).display,
        text: diag.textContent,
        grades: diag.querySelectorAll('[data-pq-grade]').length,
    };
});
assert(stageB.state === 'answered', 'Stage B unlocked after submit');
assert(stageB.display === 'block', 'Stage B diagnostic visible after submit');
assert(/TIME/.test(stageB.text) && /ELO/.test(stageB.text) && /RETENTION/.test(stageB.text), 'Stage B shows TIME/ELO/RETENTION audit');
assert(stageB.grades === 3, 'Stage B exposes three process grades');

await page.keyboard.press('3');
await page.waitForTimeout(250);
const grade = await page.evaluate(async () => {
    const { AppState } = await import('./storage.js');
    return {
        g: AppState.currentQ && AppState.currentQ.selfGrade ? AppState.currentQ.selfGrade.g : null,
        pressed: (document.querySelector('#pq-diag [data-pq-grade="3"]') || {}).getAttribute
            ? document.querySelector('#pq-diag [data-pq-grade="3"]').getAttribute('aria-pressed')
            : null,
    };
});
assert(grade.g === 3, 'Process grade 3 writes selfGrade');
assert(grade.pressed === 'true', 'Process grade control reflects pressed state');

await page.evaluate(() => window.closePracticeModal());
await page.waitForTimeout(300);

await page.evaluate(() => window.switchTab('dashboard', document.querySelector('.nav-item[data-tab="dashboard"]')));
await page.waitForTimeout(500);
const retentionSvg = await page.evaluate(() => {
    const svg = document.querySelector('#chapter-decay-grid svg.ret-svg');
    const line = svg ? svg.querySelector('.rh-line') : null;
    return { svg: !!svg, line: !!line, offset: line ? line.getAttribute('stroke-dashoffset') : null };
});
assert(retentionSvg.svg && retentionSvg.line, 'Retention ledger uses SVG stroke gauge');
assert(retentionSvg.offset != null, 'Retention stroke uses dash-offset progress');

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('CONSOLE/PAGE ERRORS:\n' + errors.slice(0, 10).join('\n---\n'));
else console.log('zero console/page errors');

await browser.close();
server.close();
process.exit(fail || errors.length ? 1 : 0);
