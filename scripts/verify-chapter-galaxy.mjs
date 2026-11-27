// End-to-end unit + Playwright QA for the Astrolabe Galaxy chapter navigator
// Run: node scripts/verify-chapter-galaxy.mjs
import assert from 'node:assert';
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    classifyChapterUnit,
    computeConstellationLayout,
    computeOrreryLayout,
    abbreviateChapterName,
    resolveLabelCollisions,
} from '../chapter-galaxy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(ROOT, '.qa-shots');
if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

let passed = 0;
let failed = 0;
function check(cond, msg) {
    if (cond) {
        passed++;
        console.log('  ✓', msg);
    } else {
        failed++;
        console.error('  ✗ FAIL:', msg);
    }
}

// ── 1. Pure Unit Tests (Node) ───────────────────────────────────────────────
console.log('── [1] Pure Layout & Collision Unit Tests ──');
{
    check(classifyChapterUnit('physics', 'Rotational Mechanics').id === 'mechanics', 'Physics Rotational Mechanics → mechanics');
    check(classifyChapterUnit('physics', 'Electromagnetic Induction').id === 'electrodynamics', 'Physics EMI → electrodynamics');
    check(classifyChapterUnit('physics', 'Geometrical Optics').id === 'optics', 'Physics Geometrical Optics → optics');
    check(classifyChapterUnit('chemistry', 'General Organic Chemistry').id === 'organic', 'Chemistry GOC → organic');
    check(classifyChapterUnit('chemistry', 'Coordination Compounds').id === 'inorganic', 'Chemistry Coordination → inorganic');
    check(classifyChapterUnit('maths', 'Definite Integration').id === 'calculus', 'Maths Definite Integration → calculus');
    check(classifyChapterUnit('physics', 'Mock Test 12', true).id === 'mocks', 'Mock chapter → mocks Transit');
    check(abbreviateChapterName('Electromagnetic Induction') === 'EMI', 'Abbreviates Electromagnetic Induction → EMI');
    check(abbreviateChapterName('Limits Continuity and Differentiability') === 'Limits & Cont.', 'Abbreviates long calculus name cleanly');

    const physChapters = [
        'Kinematics', 'Laws of Motion', 'Work Power and Energy', 'Rotational Mechanics',
        'Gravitation', 'Mechanical Properties of Solids', 'Mechanical Properties of Fluids',
        'Units and Dimensions', 'Vectors', 'Experimental Physics',
        'Electrostatics', 'Capacitance', 'Current Electricity', 'Magnetic Effects of Current',
        'Electromagnetic Induction', 'Alternating Current', 'Geometrical Optics', 'Wave Optics',
        'Thermodynamics', 'Kinetic Theory of Gases', 'Thermal Properties of Matter',
        'Oscillations', 'Waves', 'Sound', 'Modern Physics',
        'Dual Nature of Matter and Radiation', 'Atoms and Nuclei', 'Semiconductors',
        'Mock: Paper 01', 'Mock: Paper 02',
    ].map((name, i) => ({
        name,
        qCount: 15 + (i % 12),
        solved: i % 10,
        attempted: 10,
        correct: 6,
        hitPct: 60,
        doneFrac: (i % 10) / 15,
        health: (i === 3 || i % 4 === 0) ? 24 : (i % 3 === 0 ? 86 : 62),
        dueErrors: (i === 3 || i % 5 === 0) ? 3 : 0,
        flowCount: 6,
        isMock: name.startsWith('Mock:'),
        weight: i % 3 === 0 ? 1.0 : 0.65,
    }));

    const cl = computeConstellationLayout(physChapters, 'physics', { aspect: 0.85 });
    check(cl.positions.size === 30, 'Constellation layout places all 30 chapters');
    check(cl.edges.length >= 20, 'Constellation layout builds sector MST filaments');
    check(cl.sectors.length >= 6, 'Constellation layout groups into syllabus sectors + Transits');

    const ol = computeOrreryLayout(physChapters, 'physics', { aspect: 0.85 });
    check(ol.positions.size === 30, 'Orrery layout places all 30 chapters');
    check(ol.positions.get('rotational mechanics').ringId === 'priority', 'Critical health Rotational Mechanics lands on Priority inner ring');

    // Simulate 30 labels on iPad portrait 768x1024
    const simItems = physChapters.map((ch, idx) => {
        const pos = cl.positions.get(ch.name.toLowerCase());
        const sx = pos.x * 0.78 + 370;
        const sy = pos.y * 0.78 + 390;
        return {
            key: ch.name.toLowerCase(),
            sx, sy,
            starR: 12,
            fullW: Math.min(180, ch.name.length * 6.8 + 20),
            shortW: Math.min(130, abbreviateChapterName(ch.name).length * 6.8 + 18),
            labelH: 22,
            priority: ch.weight,
            forceVisible: idx === 0,
        };
    });
    const placed = resolveLabelCollisions(simItems, { width: 740, height: 820 }, { left: 12, right: 12, top: 56, bottom: 58 });
    const visRects = Array.from(placed.values()).filter(r => r.visible);
    let unitOverlaps = 0;
    for (let i = 0; i < visRects.length; i++) {
        for (let j = i + 1; j < visRects.length; j++) {
            const a = visRects[i], b = visRects[j];
            if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) unitOverlaps++;
        }
    }
    check(unitOverlaps === 0, `Collision solver produces 0 overlaps across ${visRects.length}/30 visible portrait labels`);
    check(visRects.length >= 18, `Majority of 30 portrait labels stay visible (${visRects.length}/30)`);
}

// ── 2. Playwright E2E + Visual QA ───────────────────────────────────────────
const PORT = 8809;
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg',
};

const server = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
        let p = decodeURIComponent((req.url || '/').split('?')[0]);
        if (p === '/') p = '/index.html';
        const full = path.normalize(path.join(ROOT, p));
        if (!full.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
        fs.readFile(full, (err, data) => {
            if (err) { res.writeHead(404); res.end('not found'); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
});

let browser;
try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
} catch {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
}

const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
const page = await context.newPage();

page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
page.on('console', (m) => {
    if (m.type() === 'error') {
        const txt = m.text();
        if (!/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|fontsource|accounts\.google|gsi/i.test(txt)) {
            errors.push('console.error: ' + txt);
        }
    }
});

async function measureVisibleLabelOverlaps(labelCountMin = 10) {
    return page.evaluate((minVis) => {
        const labels = Array.from(document.querySelectorAll('#chapter-galaxy-stage .cg-label'))
            .filter(el => el.dataset.tier !== 'hidden' && getComputedStyle(el).opacity !== '0');
        const rects = labels.map(el => {
            const r = el.getBoundingClientRect();
            return { key: el.dataset.cgKey, left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
        });
        const overlaps = [];
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i], b = rects[j];
                const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (ox > 1 && oy > 1) {
                    overlaps.push(`${a.key} × ${b.key} (${ox.toFixed(1)}x${oy.toFixed(1)})`);
                }
            }
        }
        return { total: document.querySelectorAll('#chapter-galaxy-stage .cg-label').length, visible: rects.length, overlaps, okMin: rects.length >= minVis };
    }, labelCountMin);
}

try {
    console.log('\n── [2] Browser Boot & Seed 28 Physics Chapters ──');
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.AppState && window.selectSubject && window.ChapterGalaxy), { timeout: 12000 });
    await page.waitForTimeout(300);

    // Seed 28 realistic Physics chapters + mixed questions
    await page.evaluate(() => {
        const chapters = [
            'Kinematics', 'Laws of Motion', 'Work Power and Energy', 'Rotational Mechanics',
            'Gravitation', 'Mechanical Properties of Solids', 'Mechanical Properties of Fluids',
            'Units and Dimensions', 'Vectors', 'Electrostatics', 'Capacitance',
            'Current Electricity', 'Magnetic Effects of Current', 'Electromagnetic Induction',
            'Alternating Current', 'Geometrical Optics', 'Wave Optics', 'Thermodynamics',
            'Kinetic Theory of Gases', 'Thermal Properties of Matter', 'Oscillations',
            'Waves', 'Sound', 'Modern Physics', 'Dual Nature of Matter and Radiation',
            'Atoms and Nuclei', 'Semiconductors', 'Mock: Test 01',
        ];
        window.AppState.chapters.physics = chapters.slice();
        const bank = [];
        const pastIso = new Date(Date.now() - 40 * 86400000).toISOString();
        const recentIso = new Date(Date.now() - 3600000).toISOString();
        chapters.forEach((ch, idx) => {
            const total = idx === 24 ? 0 : 12 + (idx % 7);
            for (let k = 0; k < total; k++) {
                const isCrit = idx % 5 === 0;
                const isMastered = idx % 4 === 1;
                let status = 'unsolved';
                let nextReviewAt;
                let lastReviewedAt;
                let firstAttemptResult;
                if (isMastered && k < total - 1) {
                    status = 'solved';
                    lastReviewedAt = recentIso;
                    firstAttemptResult = 'correct';
                } else if (k < 4) {
                    if (isCrit) {
                        status = k < 2 ? 'error' : 'wrong';
                        nextReviewAt = pastIso;
                        lastReviewedAt = pastIso;
                        firstAttemptResult = 'wrong';
                    } else {
                        status = k < 2 ? 'solved' : 'unsolved';
                        if (status === 'solved') {
                            lastReviewedAt = recentIso;
                            firstAttemptResult = 'correct';
                        }
                    }
                }
                bank.push({
                    id: `qa_${idx}_${k}`,
                    subject: 'physics',
                    chapter: ch,
                    status,
                    type: 'mcq',
                    options: ['A', 'B', 'C', 'D'],
                    correctAnswer: 'A',
                    qElo: 1150 + ((idx * 37 + k * 90) % 950),
                    extractedText: `${ch} question ${k + 1}`,
                    nextReviewAt,
                    lastReviewedAt,
                    firstAttemptResult,
                    stability: isCrit ? 1 : (isMastered ? 40 : 8),
                    easeFactor: 2.5,
                });
            }
        });
        window.AppState.questionBank = bank;
        window.selectSubject('physics');
    });

    await page.waitForSelector('#practice-chapters-view.active.cg-mode-galaxy', { timeout: 5000 });
    await page.waitForTimeout(400);

    const desktopConst = await measureVisibleLabelOverlaps(22);
    check(desktopConst.total === 28, `Desktop renders all 28 chapter stars (${desktopConst.total})`);
    check(desktopConst.overlaps.length === 0, `Desktop Constellations has 0 label overlaps (visible ${desktopConst.visible}/28)`);
    check(desktopConst.okMin, `Desktop Constellations keeps >=22 labels visible (${desktopConst.visible}/28)`);
    await page.screenshot({ path: path.join(SHOTS_DIR, 'galaxy-desktop-constellations.png') });

    console.log('\n── [3] Orrery Lens Spring-Morph & Persistence ──');
    await page.click('#cg-lens-seg [data-cg-lens="orrery"]');
    await page.waitForTimeout(550);
    const lensStored = await page.evaluate(() => localStorage.getItem('jeemax_chapters_lens'));
    check(lensStored === 'orrery', 'Orrery lens persisted to localStorage');
    const desktopOrr = await measureVisibleLabelOverlaps(20);
    check(desktopOrr.overlaps.length === 0, `Desktop Orrery has 0 label overlaps (visible ${desktopOrr.visible}/28)`);
    await page.screenshot({ path: path.join(SHOTS_DIR, 'galaxy-desktop-orrery.png') });

    // Morph back to Constellations
    await page.click('#cg-lens-seg [data-cg-lens="constellations"]');
    await page.waitForTimeout(550);

    console.log('\n── [4] Unit Sector Focus & Search Beam ──');
    await page.click('.cg-sector-pill[data-cg-sector="electrodynamics"]');
    await page.waitForTimeout(450);
    const secZoomed = await page.evaluate(() => window.ChapterGalaxy.getDebugState().cam.zoom);
    check(secZoomed > 1.05, `Clicking Electrodynamics sector zooms camera in (zoom=${secZoomed.toFixed(2)})`);
    await page.click('.cg-sector-pill[data-cg-sector="all"]');
    await page.waitForTimeout(450);

    await page.keyboard.press('/');
    await page.keyboard.type('rot');
    await page.waitForTimeout(150);
    const searchState = await page.evaluate(() => window.ChapterGalaxy.getDebugState().searchMatches);
    check(searchState.includes('rotational mechanics'), 'Search beam "/" highlights Rotational Mechanics');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);

    console.log('\n── [5] Warp Dive, Clean Question View, & Interruption Safety ──');
    // Hover + click Rotational Mechanics label (desktop)
    const rotLabel = page.locator('#chapter-galaxy-stage .cg-label[data-cg-key="rotational mechanics"]');
    await rotLabel.click();
    await page.waitForFunction(() => {
        const qv = document.getElementById('practice-question-list-view');
        const veil = document.getElementById('cg-warp-veil');
        return qv && qv.classList.contains('active') && veil && veil.hidden === true;
    }, { timeout: 2500 });
    const inQuestions = await page.evaluate(() => {
        const qv = document.getElementById('practice-question-list-view');
        const veil = document.getElementById('cg-warp-veil');
        return {
            qvActive: qv && qv.classList.contains('active'),
            veilHidden: veil && veil.hidden === true,
            flowMode: window.AppState.practiceFlowMode,
        };
    });
    check(inQuestions.qvActive, 'Clicking star enters #practice-question-list-view');
    check(inQuestions.veilHidden, 'Warp veil clears cleanly after transition');
    check(inQuestions.flowMode === 'standard', 'Normal tap/click does NOT activate Flow mode');

    // Return via ← Chapters
    await page.click('#practice-question-list-view button[onclick="goToChapters()"]');
    await page.waitForTimeout(550);
    const backInGalaxy = await page.evaluate(() => document.getElementById('practice-chapters-view').classList.contains('active'));
    check(backInGalaxy, '← Chapters returns cleanly to Galaxy');

    // Rapid mid-warp Esc interruption (trigger click directly so Playwright's
    // post-click settle doesn't outlast the 200ms warp window)
    await page.evaluate(() => {
        const el = document.querySelector('#chapter-galaxy-stage .cg-label[data-cg-key="rotational mechanics"]');
        if (el) el.click();
    });
    await page.waitForTimeout(40);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(260);
    const afterEsc = await page.evaluate(() => {
        const veil = document.getElementById('cg-warp-veil');
        const chActive = document.getElementById('practice-chapters-view').classList.contains('active');
        return { veilHidden: veil && veil.hidden === true, chActive };
    });
    check(afterEsc.veilHidden && afterEsc.chActive, 'Rapid mid-warp Escape cancels dive and leaves zero stuck veil');
    if (!afterEsc.chActive) {
        await page.evaluate(() => window.goToChapters && window.goToChapters());
        await page.waitForTimeout(250);
    }

    console.log('\n── [6] Flow Flight-Path Mode & Shift+Click ──');
    await page.click('#chapters-mode-flow');
    await page.waitForTimeout(150);
    await page.locator('#chapter-galaxy-stage .cg-label[data-cg-key="rotational mechanics"]').click();
    await page.locator('#chapter-galaxy-stage .cg-label[data-cg-key="electrostatics"]').click();
    await page.locator('#chapter-galaxy-stage .cg-label[data-cg-key="geometrical optics"]').click();
    await page.waitForTimeout(200);
    const flowState = await page.evaluate(() => window.ChapterGalaxy.getDebugState());
    check(flowState.flowMode === true && flowState.flowPath.length === 3, 'Flow flight-path chains 3 chapters cleanly');
    await page.screenshot({ path: path.join(SHOTS_DIR, 'galaxy-flow-path.png') });
    await page.click('.cg-flow-tool[data-cg-flow-act="done"]');
    await page.waitForTimeout(150);

    // Shift+Click enters Flow Flight-Path directly with the clicked star
    const shiftCoords = await page.evaluate(() => {
        const canvas = document.querySelector('#chapter-galaxy-stage .cg-canvas');
        const st = canvas.getBoundingClientRect();
        const cg = window.ChapterGalaxy;
        const nd = cg._nodeByKey.get('thermodynamics');
        const p = cg._worldToScreen(nd.x, nd.y);
        return { x: st.left + p.x, y: st.top + p.y };
    });
    await page.keyboard.down('Shift');
    await page.mouse.click(shiftCoords.x, shiftCoords.y);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(150);
    const shiftFlow = await page.evaluate(() => window.ChapterGalaxy.getDebugState());
    check(shiftFlow.flowMode === true && shiftFlow.flowPath.includes('thermodynamics'), `Shift+Click activates Flow Flight-Path with clicked star (${JSON.stringify(shiftFlow)})`);
    if (shiftFlow.flowMode) {
        await page.click('.cg-flow-tool[data-cg-flow-act="done"]');
        await page.waitForTimeout(120);
    }

    console.log('\n── [7] iPad Landscape (1024x768) & iPad Portrait (768x1024) + Touch Lock ──');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(350);
    const ipadLand = await measureVisibleLabelOverlaps(18);
    check(ipadLand.overlaps.length === 0, `iPad Landscape has 0 label overlaps (visible ${ipadLand.visible}/28)`);
    await page.screenshot({ path: path.join(SHOTS_DIR, 'galaxy-ipad-landscape.png') });

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(350);
    const ipadPort = await measureVisibleLabelOverlaps(16);
    check(ipadPort.overlaps.length === 0, `iPad Portrait has 0 label overlaps (visible ${ipadPort.visible}/28)`);
    await page.screenshot({ path: path.join(SHOTS_DIR, 'galaxy-ipad-portrait.png') });

    // Touch tap-1 locks star & opens inspector; tap-2 enters
    const starBox = await page.evaluate(() => {
        const st = document.getElementById('chapter-galaxy-stage').getBoundingClientRect();
        const dbg = window.ChapterGalaxy.getDebugState();
        const lbl = document.querySelector('#chapter-galaxy-stage .cg-label[data-cg-key="electrostatics"]');
        // Dispatch synthetic touch pointer events directly on canvas at star position
        return { left: st.left, top: st.top, hasLbl: !!lbl, dbg };
    });
    check(starBox.hasLbl, 'Touch targets ready on iPad Portrait');
    const tapCoords = await page.evaluate(() => {
        const canvas = document.querySelector('#chapter-galaxy-stage .cg-canvas');
        const st = canvas.getBoundingClientRect();
        const cg = window.ChapterGalaxy;
        const nd = cg._nodeByKey.get('electrostatics');
        const p = cg._worldToScreen(nd.x, nd.y);
        return { x: st.left + p.x, y: st.top + p.y };
    });
    await page.touchscreen.tap(tapCoords.x, tapCoords.y);
    await page.waitForTimeout(150);
    const touchLock = await page.evaluate(() => {
        const ins = document.querySelector('#chapter-galaxy-stage .cg-inspector');
        return ins && !ins.hidden && ins.classList.contains('is-locked') && ins.textContent.includes('Enter Chapter');
    });
    check(touchLock, 'iPad first touch tap locks star & shows Enter Chapter CTA');
    if (touchLock) await page.click('.cg-ins-close');

    console.log('\n── [8] Galaxy ↔ Ledger Toggle & Reload Persistence ──');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('#cg-view-toggle [data-cg-view="ledger"]');
    await page.waitForTimeout(180);
    const ledgerCheck = await page.evaluate(() => ({
        stored: localStorage.getItem('jeemax_chapters_view'),
        hasClass: document.getElementById('practice-chapters-view').classList.contains('cg-mode-ledger'),
        rowCount: document.querySelectorAll('#chapters-list-container .chapter-item').length,
    }));
    check(ledgerCheck.stored === 'ledger' && ledgerCheck.hasClass && ledgerCheck.rowCount === 28, `Ledger mode renders all 28 rows and persists (${JSON.stringify(ledgerCheck)})`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.ChapterGalaxy), { timeout: 10000 });
    check((await page.evaluate(() => window.ChapterGalaxy.getViewMode())) === 'ledger', 'Ledger preference survives reload');

    // Switch back to Galaxy & verify fx-effects-off stops rAF
    await page.evaluate(() => {
        localStorage.setItem('jeemax_chapters_view', 'galaxy');
        window.ChapterGalaxy.setViewMode('galaxy');
        window.selectSubject('physics');
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => {
        document.documentElement.classList.add('fx-effects-off');
    });
    await page.waitForTimeout(120);
    const f1 = await page.evaluate(() => window.ChapterGalaxy.getDebugState());
    await page.waitForTimeout(400);
    const f2 = await page.evaluate(() => window.ChapterGalaxy.getDebugState());
    check(!f2.rafRunning && f1.frameCount === f2.frameCount, 'fx-effects-off halts rAF loop (zero idle CPU/battery)');

    await page.evaluate(() => document.documentElement.classList.remove('fx-effects-off'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(120);
    const rm1 = await page.evaluate(() => window.ChapterGalaxy.getDebugState());
    await page.waitForTimeout(350);
    const rm2 = await page.evaluate(() => window.ChapterGalaxy.getDebugState());
    check(!rm2.rafRunning && rm1.frameCount === rm2.frameCount, 'prefers-reduced-motion: reduce halts rAF loop');

    check(errors.length === 0, `Zero console/page errors (${errors.length} errors)`);
    if (errors.length) console.error('Errors:', errors);
} finally {
    await browser.close();
    server.close();
}

console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
