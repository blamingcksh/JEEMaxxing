// End-to-end Playwright verification for KLSR Heartbeat Void & Psychological Survival Engine
// Run: node scripts/verify-heartbeat.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8799;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = `http://127.0.0.1:${PORT}/index.html`;

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg',
};

const server = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
        let p = decodeURIComponent((req.url || '/').split('?')[0]);
        if (p === '/__offline_gap') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<!doctype html><html><head><link rel="icon" href="data:,"></head><body>offline</body></html>');
            return;
        }
        if (p === '/') p = '/index.html';
        const full = path.normalize(path.join(ROOT, p));
        if (!full.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
        fs.readFile(full, (err, data) => {
            if (err) { console.error('HTTP 404:', p); res.writeHead(404); res.end('not found'); return; }
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

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
page.on('console', (m) => {
    if (m.type() === 'error') {
        const txt = m.text();
        // Ignore optional offline CDN font/network noise in headless local testing
        if (!/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|fontsource|accounts\.google|gsi/i.test(txt)) {
            errors.push('console.error: ' + txt);
        }
    }
});

let pass = 0;
let fail = 0;
function check(cond, label) {
    if (cond) {
        pass++;
        console.log('  ✓', label);
    } else {
        fail++;
        console.error('  ✗ FAIL:', label);
    }
}

try {
    console.log('── [1] Boot Intro, Pure Black Void & Stripped Chrome ──');
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#heartbeat-void', { timeout: 10000 });

    const sidebarHidden = await page.evaluate(() => getComputedStyle(document.getElementById('sidebar')).display === 'none');
    const dashHidden = await page.evaluate(() => getComputedStyle(document.getElementById('view-dashboard')).display === 'none');
    const ordersHidden = await page.evaluate(() => getComputedStyle(document.getElementById('arena-orders-strip')).display === 'none');
    check(sidebarHidden, '#sidebar is hidden');
    check(dashHidden, '#view-dashboard is hidden');
    check(ordersHidden, '#arena-orders-strip (Todays Orders) is hidden');

    // During first ~900ms boot hold, controls should be invisible (opacity 0, pointer-events none)
    const bootingState = await page.evaluate(() => {
        const voidEl = document.getElementById('heartbeat-void');
        const btn = document.querySelector('.hb-subj-btn');
        const cs = getComputedStyle(btn);
        return {
            hasBooting: voidEl.classList.contains('hb-booting'),
            hasReady: voidEl.classList.contains('hb-ready'),
            pointerEvents: cs.pointerEvents,
        };
    });
    check(bootingState.hasBooting && !bootingState.hasReady && bootingState.pointerEvents === 'none',
        'Controls are hidden and non-interactive during 2.5s boot ignition');

    // Wait for 2.5s boot intro to finish
    await page.waitForFunction(() => document.getElementById('heartbeat-void')?.classList.contains('hb-ready'), null, { timeout: 15000 });
    await page.waitForTimeout(950); // allow fade-in transition to settle

    const readyState = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('.hb-subj-btn')).map(b => b.textContent.trim());
        const util = Array.from(document.querySelectorAll('.hb-pill-btn')).map(b => b.textContent.trim());
        const eloRow = document.getElementById('global-mmr-row');
        const stakes = document.getElementById('lockin-duel-stakes');
        return {
            btns,
            util,
            hasEloRow: !!eloRow,
            hasStakes: !!stakes,
            bodyVoid: document.body.classList.contains('hb-void-active'),
            canvasBox: document.getElementById('heartbeat-canvas').getBoundingClientRect(),
        };
    });
    check(JSON.stringify(readyState.btns) === JSON.stringify(['PHYSICS', 'CHEMISTRY', 'MATHS']),
        'Three minimal subject buttons (PHYSICS, CHEMISTRY, MATHS) appear after intro');
    check(readyState.util.includes('VITALS') && readyState.util.includes('PACT') && readyState.util.includes('≡'),
        'Minimal utility buttons (VITALS, PACT, ≡) appear after intro');
    check(!readyState.hasEloRow && !readyState.hasStakes, 'User ELO row and Shadow Duel stakes are absent');
    check(readyState.bodyVoid && readyState.canvasBox.width === 1440 && readyState.canvasBox.height === 900,
        'Full-viewport 1440x900 void active');

    console.log('── [2] Vitals Popover, Nav Menu, Pact Modal & Subject Routing ──');
    await page.click('#hb-vitals-btn');
    await page.waitForSelector('#heartbeat-vitals-overlay:not([hidden])');
    const vitalsText = await page.locator('#heartbeat-vitals-overlay').innerText();
    check(vitalsText.includes('SPEED') && vitalsText.includes('LUMINESCENCE') && vitalsText.includes('PERSISTENCE') && vitalsText.includes('SPREAD'),
        'Vitals popover shows all 4 KLSR parameters');
    check(vitalsText.includes('0.50 / 0.50') && vitalsText.includes('XENON WHITE'),
        'Initial seeded Vitals shows 0.50 max spread and XENON WHITE spectrum');
    check(vitalsText.includes('20.0u') && vitalsText.includes('240m'),
        'Vitals deficit prescription displays 20.0u P/C/M and 240m Pact targets');
    await page.click('#hb-vitals-close');

    // Open Pact modal from void
    await page.click('#hb-pact-btn');
    await page.waitForSelector('#lockin-setup-modal.active');
    check(await page.locator('#lockin-duel-stakes').count() === 0, 'Lock-In modal has no ELO/Shield stake controls');
    await page.click('#lockin-setup-modal .close-btn');

    // Open Nav menu -> Vault -> return via [ ← VOID ]
    await page.click('#hb-nav-btn');
    await page.waitForSelector('#heartbeat-nav-menu:not([hidden])');
    await page.click('#heartbeat-nav-menu [data-hb-nav="errors"]');
    await page.waitForFunction(() => document.getElementById('view-errors')?.classList.contains('active'));
    check(!(await page.evaluate(() => document.body.classList.contains('hb-void-active'))), 'Void pauses when entering Vault');
    await page.click('#hb-back-void-btn');
    await page.waitForFunction(() => document.body.classList.contains('hb-void-active'));
    check(true, '[ ← VOID ] returns cleanly from Vault to Heartbeat void');

    // Subject button -> Chapters -> [ ← VOID ]
    await page.click('.hb-subj-btn[data-subject="physics"]');
    await page.waitForFunction(() => document.getElementById('practice-chapters-view')?.classList.contains('active'));
    await page.click('#hb-back-void-btn');
    await page.waitForFunction(() => document.body.classList.contains('hb-void-active'));
    check(true, 'Subject button enters Chapters and [ ← VOID ] returns cleanly');

    console.log('── [3] Real-Time Clock Drain, Active Pact Freeze & Spectrum Interpolation ──');
    // Unload live app first (like closing the tab), backdate timestamps 12h, then reopen
    await page.goto(`http://127.0.0.1:${PORT}/__offline_gap`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
        const raw = JSON.parse(localStorage.getItem('jeemax_heartbeat_v1'));
        raw.lastTickAt = Date.now() - 12 * 3600 * 1000;
        raw.highWaterMark = raw.lastTickAt;
        localStorage.setItem('jeemax_heartbeat_v1', JSON.stringify(raw));
        // Mirror to IDB too
        const mod = await import('./storage.js');
        await mod.idbSet('jeemax_heartbeat_v1', raw);
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.Heartbeat && !!document.getElementById('heartbeat-void')?.classList.contains('hb-ready'), null, { timeout: 15000 });

    const after12h = await page.evaluate(() => window.Heartbeat.getVitals());
    check(after12h.reservoirHours > 17.9 && after12h.reservoirHours < 18.05,
        `Real-time 12h elapsed drained 30.0h → ${after12h.reservoirHours.toFixed(2)}h`);
    check(after12h.spectrum.name === 'ION SILVER', `18h spectrum stage is ION SILVER (got ${after12h.spectrum.name})`);
    check(Math.abs(after12h.spread - 0.30) <= 0.02, `Reverse spread collapsed from 0.50 → ${after12h.spread.toFixed(2)}`);
    check(after12h.speed > 0.60 && after12h.speed < 0.65, `Speed scaled to reservoir ratio (${after12h.speed.toFixed(2)})`);

    // Anti-rollback clock check: moving backward does not restore time
    const beforeRollback = after12h.reservoirHours;
    const afterRollback = await page.evaluate(() => {
        window.Heartbeat.tickClock(Date.now() - 5 * 3600 * 1000);
        return window.Heartbeat.getVitals().reservoirHours;
    });
    check(afterRollback <= beforeRollback, 'Clock rollback does not increase reservoir hours');

    // 4:00 AM day rollover check
    const rollover = await page.evaluate(async () => {
        const mod = await import('./storage.js');
        return {
            at0230: mod.todayLocalKey(new Date(2026, 4, 10, 2, 30, 0)),
            at0405: mod.todayLocalKey(new Date(2026, 4, 10, 4, 5, 0)),
        };
    });
    check(rollover.at0230 === '2026-05-09' && rollover.at0405 === '2026-05-10',
        `Day boundary rolls over at 4:00 AM local (${rollover.at0230} at 02:30 -> ${rollover.at0405} at 04:05)`);

    // Active Pact Freeze: holds across 25m T7 derivation, expires >35m idle, caps at 3h max
    const freezeAudit = await page.evaluate(() => {
        const t0 = Date.now();
        const hb = window.Heartbeat;
        hb.touchActivity(t0);
        const before = hb.getVitals(t0).reservoirHours;

        window._pomoRunning = true;
        document.body.classList.add('pomo-active');

        // 25-minute paper derivation without DOM touches -> still frozen
        hb.tickClock(t0 + 25 * 60 * 1000);
        const after25m = hb.getVitals(t0 + 25 * 60 * 1000).reservoirHours;

        // 60 minutes without solve/interaction (>35m idle limit) -> freeze expires & drains
        hb.tickClock(t0 + 60 * 60 * 1000);
        const after60mIdle = hb.getVitals(t0 + 60 * 60 * 1000).reservoirHours;

        // Restart active window and keep touching activity -> 3h continuous freeze cap still enforces unfreeze
        window._pomoRunning = false;
        document.body.classList.remove('pomo-active');
        hb.isDecayFrozen(t0 + 60 * 60 * 1000);

        const t2 = t0 + 60 * 60 * 1000;
        hb.touchActivity(t2);
        window._pomoRunning = true;
        document.body.classList.add('pomo-active');
        hb.isDecayFrozen(t2); // anchor _freezeStartedAt = t2
        hb.touchActivity(t2 + 160 * 60 * 1000);
        const stillFrozenBeforeCap = hb.isDecayFrozen(t2 + 170 * 60 * 1000);
        hb.touchActivity(t2 + 185 * 60 * 1000);
        const frozenPast3hCap = hb.isDecayFrozen(t2 + 185 * 60 * 1000);

        window._pomoRunning = false;
        document.body.classList.remove('pomo-active');
        hb.isDecayFrozen(t2 + 185 * 60 * 1000);
        return { before, after25m, after60mIdle, stillFrozenBeforeCap, frozenPast3hCap };
    });
    check(Math.abs(freezeAudit.before - freezeAudit.after25m) < 0.001,
        'Active Pact freeze holds across a 25-minute T7 derivation without UI clicks');
    check(freezeAudit.after60mIdle < freezeAudit.after25m - 0.3,
        `Idle Pact/stopwatch unfreezes after 35m inactivity (${freezeAudit.after25m.toFixed(2)}h -> ${freezeAudit.after60mIdle.toFixed(2)}h)`);
    check(freezeAudit.stillFrozenBeforeCap && !freezeAudit.frozenPast3hCap,
        'Continuous stopwatch/freeze caps strictly at 3h max even with active input');

    console.log('── [4] Difficulty Tiers, Solved/Dissection Parity, Pact Recharge & Real Practice Flow ──');
    const unitResults = await page.evaluate(async () => {
        const hb = window.Heartbeat;
        const w1 = hb.getQuestionUnitWeight({ qElo: 950, qEloSource: 'gem-stamped' });
        const w3 = hb.getQuestionUnitWeight({ qElo: 1400, qEloSource: 'gem-stamped' });
        const w5 = hb.getQuestionUnitWeight({ qElo: 1950, qEloSource: 'gem-stamped' });
        const w7 = hb.getQuestionUnitWeight({ qElo: 2350, qEloSource: 'gem-stamped' });

        // Cold-start morning Luminescence must blend smoothly across solve #1 (no cliff to 0)
        const morningTs = new Date().setHours(8, 0, 0, 0);
        const lumBeforeFirstSolve = hb.getVitals(morningTs).luminescence;

        const r1 = hb.recordProblemUnit({ id: 'hb-q1', subject: 'physics', qElo: 950, qEloSource: 'gem-stamped' }, 'solve');
        const lumAfterFirstSolve = hb.getVitals(morningTs).luminescence;
        const rDup = hb.recordProblemUnit({ id: 'hb-q1', subject: 'physics', qElo: 950, qEloSource: 'gem-stamped' }, 'solve');

        // Repeat solves across days: non-due repeat -> 0%, due SR review -> 50%
        const rRepeatNotDue = hb.recordProblemUnit(
            { id: 'hb-prev-notdue', subject: 'physics', qElo: 1400, qEloSource: 'gem-stamped' },
            'solve',
            { wasAlreadySolved: true, isDue: false }
        );
        const rRepeatDue = hb.recordProblemUnit(
            { id: 'hb-prev-due', subject: 'physics', qElo: 1400, qEloSource: 'gem-stamped' },
            'solve',
            { wasAlreadySolved: true, isDue: true }
        );

        // Error dissection: dropdown-only pays 0u; >=30 char note pays 70% & locks 30% until solved due in Vault
        const rBadDissect = hb.recordProblemUnit(
            { id: 'hb-bad-dissect', subject: 'chemistry', qElo: 2350, qEloSource: 'gem-stamped', errorReason: 'conceptual' },
            'dissection',
            { reason: 'conceptual', note: 'short note' }
        );
        const vaultQ = {
            id: 'hb-q2',
            subject: 'chemistry',
            qElo: 2350,
            qEloSource: 'gem-stamped',
            errorReason: 'conceptual',
        };
        const rDissect70 = hb.recordProblemUnit(vaultQ, 'dissection', {
            reason: 'conceptual',
            note: 'Forgot Gauss law Gaussian cylinder symmetry boundary term for non-uniform charge.',
        });
        const rVaultEarly = hb.recordProblemUnit(vaultQ, 'solve', { isDue: false });
        const rVaultDueUnlock30 = hb.recordProblemUnit(vaultQ, 'solve', { isDue: true });

        const rMath1 = hb.recordProblemUnit({ id: 'hb-q3', subject: 'maths', qElo: 950, qEloSource: 'gem-stamped' }, 'solve');

        // Log 240m Pact with all 3 subjects touched but low (<2u each): minP escrow must keep bulk of +9.0h locked
        const pactRes = hb.recordPactBlock(240, 'physics');
        const earlyEscrowVitals = hb.getVitals();

        // Spam physics to 20u only -> Luminescence starved & Pact hours remain locked
        for (let i = 0; i < 20; i++) {
            hb.recordProblemUnit({ id: `hb-p-${i}`, subject: 'physics', qElo: 1400, qEloSource: 'gem-stamped' }, 'solve');
        }
        const imbalancedVitals = hb.getVitals();

        // Open Vitals UI briefly to confirm locked Pact escrow banner renders cleanly
        hb.openVitals();
        const vitalsLockedText = document.getElementById('heartbeat-vitals-overlay')?.innerText || '';
        hb.closeVitals();

        // Now bring Chemistry (30x 70% dissections = 21u) and Maths (20u solves) up to 20u+ -> releases locked Pact hours
        for (let i = 0; i < 30; i++) {
            hb.recordProblemUnit(
                { id: `hb-c-${i}`, subject: 'chemistry', qElo: 1400, qEloSource: 'gem-stamped', errorReason: 'calculation' },
                'dissection',
                { reason: 'calculation', note: 'Sign error on differentiating implicit integral limits under radical.' }
            );
        }
        for (let i = 0; i < 20; i++) {
            hb.recordProblemUnit({ id: `hb-m-${i}`, subject: 'maths', qElo: 1400, qEloSource: 'gem-stamped' }, 'solve');
        }
        const balancedVitals = hb.getVitals();

        return {
            w1, w3, w5, w7,
            lumBeforeFirstSolve, lumAfterFirstSolve,
            r1, rDup, rRepeatNotDue, rRepeatDue, rBadDissect, rDissect70, rVaultEarly, rVaultDueUnlock30, rMath1,
            earlyEscrowVitals, imbalancedVitals, vitalsLockedText, pactRes, balancedVitals,
        };
    });

    check(unitResults.w1 === 0.75 && unitResults.w3 === 1.0 && unitResults.w5 === 1.35 && unitResults.w7 === 1.75,
        'Question difficulty tiers yield exact weights (0.75u / 1.00u / 1.35u / 1.75u)');
    check(unitResults.lumAfterFirstSolve >= unitResults.lumBeforeFirstSolve * 0.85,
        `Morning cold-start Luminescence blends smoothly after solve #1 (${unitResults.lumBeforeFirstSolve.toFixed(2)} -> ${unitResults.lumAfterFirstSolve.toFixed(2)})`);
    check(unitResults.r1.credited && !unitResults.rDup.credited && unitResults.rDup.reason === 'duplicate',
        'Same question ID cannot be double-credited on the same day');
    check(!unitResults.rRepeatNotDue.credited && unitResults.rRepeatNotDue.reason === 'repeat-not-due',
        'Repeating an already-solved problem when not due pays 0u');
    check(unitResults.rRepeatDue.credited && unitResults.rRepeatDue.weight === 0.50,
        'Due SR repeat of an already-solved T3 problem pays 50% (0.50u)');
    check(!unitResults.rBadDissect.credited && unitResults.rBadDissect.reason === 'dissection-incomplete',
        'Dropdown-only error log (<30 char note) pays 0u');
    check(unitResults.rDissect70.credited && unitResults.rDissect70.weight === 1.22 && !unitResults.rVaultEarly.credited && unitResults.rVaultDueUnlock30.credited && unitResults.rVaultDueUnlock30.weight === 0.53,
        `Dissection w/ >=30c note pays 70% (${unitResults.rDissect70.weight}u), blocks non-due fix, unlocks remaining 30% when due (${unitResults.rVaultDueUnlock30.weight}u)`);
    check(unitResults.earlyEscrowVitals.lockedPactHours > 5.0 && unitResults.earlyEscrowVitals.pactMultiplier < 0.35,
        `minP Pact escrow locks +${unitResults.earlyEscrowVitals.lockedPactHours.toFixed(2)}h when all subjects <2u (mult ${Math.round(unitResults.earlyEscrowVitals.pactMultiplier * 100)}%)`);
    check(unitResults.vitalsLockedText.includes('LOCKED') && unitResults.vitalsLockedText.includes('feed'),
        'Vitals UI surfaces locked Pact hours and weakest subject release prompt');
    check(unitResults.imbalancedVitals.luminescence < 0.40,
        `Spamming Physics alone leaves Luminescence starved (${unitResults.imbalancedVitals.luminescence.toFixed(2)})`);
    check(unitResults.balancedVitals.luminescence === 1.00 && unitResults.balancedVitals.persistence === 1.00 && unitResults.balancedVitals.lockedPactHours === 0,
        `Balancing P/C/M to 20u+ unlocks full Pact escrow (0h locked), Luminescence (${unitResults.balancedVitals.luminescence.toFixed(2)}), and Persistence (${unitResults.balancedVitals.persistence.toFixed(2)})`);
    check(unitResults.balancedVitals.reservoirHours > 28.0 && unitResults.balancedVitals.spectrum.name === 'XENON WHITE',
        `Break-even + overflow recharge restored reservoir to ${unitResults.balancedVitals.reservoirHours.toFixed(2)}h (XENON WHITE)`);

    // Real UI practice solve check + TIER cell (no User ELO)
    await page.evaluate(async () => {
        const mod = await import('./storage.js');
        mod.AppState.chapters.physics = ['Electrostatics'];
        mod.AppState.questionBank.push({
            id: 'ui-test-q1',
            subject: 'physics',
            chapter: 'Electrostatics',
            type: 'mcq',
            options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
            correctAnswer: 'A',
            qElo: 1920,
            qEloSource: 'gem-stamped',
            status: 'unsolved',
            extractedText: 'Test Electrostatics Question',
        });
        await mod.saveAllAsync();
    });
    await page.click('.hb-subj-btn[data-subject="physics"]');
    await page.waitForSelector('.chapter-item');
    await page.click('.chapter-item');
    await page.waitForSelector('.question-card');
    await page.click('.question-card');
    await page.waitForSelector('#practice-modal.active');
    await page.click('.mcq-option');
    await page.click('#practice-submit-btn');
    await page.waitForSelector('#pq-diag .pq-diag-grid');
    const diagInfo = await page.evaluate(() => ({
        diagText: document.getElementById('pq-diag')?.innerText || '',
        eloSlotHtml: document.getElementById('elo-header-slot')?.innerHTML || '',
        hbCredited: window.Heartbeat.getState().daily.creditedIds.includes('ui-test-q1'),
    }));
    check(diagInfo.diagText.includes('TIER') && diagInfo.diagText.includes('1.35u') && !diagInfo.diagText.includes('ELO'),
        'Practice diagnostic displays TIER (T5 · 1.35u) with zero User ELO');
    check(diagInfo.eloSlotHtml === '', 'Practice header ELO shift chip is empty');
    check(diagInfo.hbCredited, 'UI solve automatically credited Heartbeat unit for ui-test-q1');
    await page.click('#practice-modal .pq-corner-close');

    console.log('── [5] 0.0h Flatline Death Sequence, Scorched-Earth Wipe & Anti-Save-Scumming ──');
    // Export pre-wipe backup before triggering flatline
    const preWipeBackup = await page.evaluate(async () => {
        const mod = await import('./storage.js');
        return await mod.buildFullBackup();
    });
    check(preWipeBackup && Array.isArray(preWipeBackup.idb), 'Captured pre-wipe full backup');

    // Advance offline drain past 30h ceiling while app is closed -> reopen -> must flatline and wipe everything
    await page.goto(`http://127.0.0.1:${PORT}/__offline_gap`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
        const raw = JSON.parse(localStorage.getItem('jeemax_heartbeat_v1'));
        raw.lastTickAt = Date.now() - 35 * 3600 * 1000;
        raw.highWaterMark = raw.lastTickAt;
        localStorage.setItem('jeemax_heartbeat_v1', JSON.stringify(raw));
        const mod = await import('./storage.js');
        await mod.idbSet('jeemax_heartbeat_v1', raw);
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#heartbeat-flatline-overlay:not([hidden])', { timeout: 15000 });
    await page.waitForFunction(() => {
        const btn = document.getElementById('hb-flatline-reset-btn');
        return btn && !btn.disabled && btn.textContent.includes('BEGIN FROM ZERO');
    }, null, { timeout: 15000 });

    const postWipeAudit = await page.evaluate(async () => {
        const mod = await import('./storage.js');
        const entries = await mod.idbGetAllEntries();
        const cpEntries = await mod.cpdbGetAllEntries();
        const epoch = mod.getWipeEpoch();
        let restoreError = null;
        try {
            await mod.applyFullBackup(window.__preWipeBackupTest);
        } catch (e) {
            restoreError = e && e.message;
        }
        return {
            bankLen: mod.AppState.questionBank.length,
            idbKeys: entries.map(([k]) => k),
            cpCount: cpEntries.length,
            epoch,
            lsKeys: Object.keys(localStorage),
        };
    });
    // Also test applyFullBackup rejection by passing preWipeBackup directly
    const restoreRejectedMsg = await page.evaluate(async (bak) => {
        const mod = await import('./storage.js');
        try {
            await mod.applyFullBackup(bak);
            return 'ALLOWED';
        } catch (e) {
            return e && e.message;
        }
    }, preWipeBackup);

    check(postWipeAudit.bankLen === 0 && !postWipeAudit.idbKeys.includes('jeemax_question_bank'),
        'Scorched-earth wipe erased questionBank and jeemaxxing_db data');
    check(postWipeAudit.cpCount === 0, 'Scorched-earth wipe cleared checkpoint-db');
    check(postWipeAudit.epoch > 0 && postWipeAudit.lsKeys.includes('jeemax_wipe_epoch'),
        'Permanent jeemax_wipe_epoch stamped after flatline');
    check(String(restoreRejectedMsg).includes('Flatline wipe'),
        `Pre-wipe backup restore rejected (${restoreRejectedMsg})`);

    // Click BEGIN FROM ZERO -> restarts fresh 30h life
    await page.click('#hb-flatline-reset-btn');
    await page.waitForFunction(() => document.getElementById('heartbeat-flatline-overlay')?.hidden === true);
    const rebootVitals = await page.evaluate(() => window.Heartbeat.getVitals());
    check(rebootVitals.reservoirHours > 29.9 && !rebootVitals.flatlined,
        `BEGIN FROM ZERO initialized fresh 30.0h life (${rebootVitals.reservoirHours.toFixed(2)}h)`);

    check(errors.length === 0, `Zero uncaught runtime errors (${errors.length} seen${errors.length ? ': ' + errors.join(' | ') : ''})`);
} finally {
    await browser.close();
    server.close();
}

console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
