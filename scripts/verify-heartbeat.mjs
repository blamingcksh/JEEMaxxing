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
    check(readyState.util.includes('VITALS') && readyState.util.includes('PACT') && readyState.util.includes('AUDIO') && readyState.util.includes('≡'),
        'Minimal utility buttons (VITALS, PACT, AUDIO, ≡) appear after intro');

    // Toggle industrial audio button ON -> MUTED -> ON cleanly
    await page.click('#hb-audio-btn');
    const audioMuted = await page.evaluate(() => ({
        enabled: window.HeartbeatAudio?.isEnabled(),
        label: document.querySelector('#hb-audio-btn .hb-audio-lbl')?.textContent,
    }));
    await page.click('#hb-audio-btn');
    const audioRestored = await page.evaluate(async () => {
        const unlocked = await window.HeartbeatAudio?.unlock();
        window.HeartbeatAudio?.playClick();
        window.HeartbeatAudio?.playChamberLoad();
        return {
            enabled: window.HeartbeatAudio?.isEnabled(),
            label: document.querySelector('#hb-audio-btn .hb-audio-lbl')?.textContent,
            unlocked,
        };
    });
    check(audioMuted.enabled === false && audioMuted.label === 'MUTED' && audioRestored.enabled === true && audioRestored.label === 'AUDIO' && audioRestored.unlocked === true,
        'Procedural industrial background audio toggles, unlocks AudioContext & fires SFX cleanly (AUDIO ↔ MUTED)');
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

    console.log('── [3] Real-Time Clock Drain, Sleep Freeze, Active Pact Freeze & Spectrum Interpolation ──');
    // Unload live app first (like closing the tab), backdate by exactly 8.0 waking hours
    // (skipping any 00:00–08:00 sleep freeze) so this assertion is 100% deterministic at any hour.
    await page.goto(`http://127.0.0.1:${PORT}/__offline_gap`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
        const hbMod = await import('./heartbeat.js');
        const mod = await import('./storage.js');
        const now = Date.now();
        let lo = now - 24 * 3600 * 1000;
        let hi = now;
        const targetDrainMs = 8 * 3600 * 1000;
        for (let i = 0; i < 45; i++) {
            const mid = Math.floor((lo + hi) / 2);
            if (hbMod.computeDrainableMs(mid, now) > targetDrainMs) lo = mid;
            else hi = mid;
        }
        const raw = JSON.parse(localStorage.getItem('jeemax_heartbeat_v1'));
        raw.lastTickAt = hi;
        raw.highWaterMark = hi;
        localStorage.setItem('jeemax_heartbeat_v1', JSON.stringify(raw));
        await mod.idbSet('jeemax_heartbeat_v1', raw);
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.Heartbeat && !!document.getElementById('heartbeat-void')?.classList.contains('hb-ready'), null, { timeout: 15000 });

    const after8h = await page.evaluate(() => window.Heartbeat.getVitals());
    check(after8h.reservoirHours > 9.9 && after8h.reservoirHours < 10.1,
        `Real-time 8h waking elapsed drained 18.0h → ${after8h.reservoirHours.toFixed(2)}h`);
    check(after8h.spectrum.name === 'ION SILVER', `10h spectrum stage is ION SILVER (got ${after8h.spectrum.name})`);
    check(Math.abs(after8h.spread - 0.28) <= 0.02, `Reverse spread collapsed from 0.50 → ${after8h.spread.toFixed(2)}`);
    check(after8h.speed > 0.55 && after8h.speed < 0.61, `Speed scaled to reservoir ratio (${after8h.speed.toFixed(2)})`);

    // Anti-rollback clock check: moving backward does not restore time
    const beforeRollback = after8h.reservoirHours;
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
        const d = new Date();
        const hr = d.getHours();
        let t0;
        if (hr >= 8 && hr < 21) {
            t0 = d.getTime();
        } else {
            const next8 = new Date(d);
            if (hr >= 21) next8.setDate(next8.getDate() + 1);
            next8.setHours(8, 0, 0, 0);
            t0 = next8.getTime();
        }
        const hb = window.Heartbeat;
        hb.tickClock(t0);
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
        const neutralTs = new Date().setHours(15, 0, 0, 0);
        const w1 = hb.getQuestionUnitWeight({ qElo: 950, qEloSource: 'gem-stamped' });
        const w3 = hb.getQuestionUnitWeight({ qElo: 1400, qEloSource: 'gem-stamped' });
        const w5 = hb.getQuestionUnitWeight({ qElo: 1950, qEloSource: 'gem-stamped' });
        const w7 = hb.getQuestionUnitWeight({ qElo: 2350, qEloSource: 'gem-stamped' });

        // Cold-start morning Luminescence must blend smoothly across solve #1 (no cliff to 0)
        const morningTs = new Date().setHours(8, 0, 0, 0);
        const lumBeforeFirstSolve = hb.getVitals(morningTs).luminescence;

        const r1 = hb.recordProblemUnit({ id: 'hb-q1', subject: 'physics', qElo: 950, qEloSource: 'gem-stamped' }, 'solve', { nowMs: neutralTs });
        const lumAfterFirstSolve = hb.getVitals(morningTs).luminescence;
        const rDup = hb.recordProblemUnit({ id: 'hb-q1', subject: 'physics', qElo: 950, qEloSource: 'gem-stamped' }, 'solve', { nowMs: neutralTs });

        // Repeat solves across days: non-due repeat -> 0%, due SR review -> 50%
        const rRepeatNotDue = hb.recordProblemUnit(
            { id: 'hb-prev-notdue', subject: 'physics', qElo: 1400, qEloSource: 'gem-stamped' },
            'solve',
            { wasAlreadySolved: true, isDue: false, nowMs: neutralTs }
        );
        const rRepeatDue = hb.recordProblemUnit(
            { id: 'hb-prev-due', subject: 'physics', qElo: 1400, qEloSource: 'gem-stamped' },
            'solve',
            { wasAlreadySolved: true, isDue: true, nowMs: neutralTs }
        );

        // Error dissection: dropdown-only pays 0u; >=30 char note pays 70% & locks 30% until solved due in Vault
        const rBadDissect = hb.recordProblemUnit(
            { id: 'hb-bad-dissect', subject: 'chemistry', qElo: 2350, qEloSource: 'gem-stamped', errorReason: 'conceptual' },
            'dissection',
            { reason: 'conceptual', note: 'short note', nowMs: neutralTs }
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
            nowMs: neutralTs,
        });
        const rVaultEarly = hb.recordProblemUnit(vaultQ, 'solve', { isDue: false, nowMs: neutralTs });
        const rVaultDueUnlock30 = hb.recordProblemUnit(vaultQ, 'solve', { isDue: true, nowMs: neutralTs });

        const rMath1 = hb.recordProblemUnit({ id: 'hb-q3', subject: 'maths', qElo: 950, qEloSource: 'gem-stamped' }, 'solve', { nowMs: neutralTs });

        // Log 240m Pact with all 3 subjects touched but low (<2u each): minP escrow must keep bulk of +4.0h locked
        const pactRes = hb.recordPactBlock(240, 'physics');
        const earlyEscrowVitals = hb.getVitals();

        // Spam physics to 20u only -> Luminescence starved & Pact hours remain locked
        for (let i = 0; i < 20; i++) {
            hb.recordProblemUnit({ id: `hb-p-${i}`, subject: 'physics', qElo: 1400, qEloSource: 'gem-stamped' }, 'solve', { nowMs: neutralTs });
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
                { reason: 'calculation', note: 'Sign error on differentiating implicit integral limits under radical.', nowMs: neutralTs }
            );
        }
        for (let i = 0; i < 20; i++) {
            hb.recordProblemUnit({ id: `hb-m-${i}`, subject: 'maths', qElo: 1400, qEloSource: 'gem-stamped' }, 'solve', { nowMs: neutralTs });
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
    check(unitResults.earlyEscrowVitals.lockedPactHours > 2.0 && unitResults.earlyEscrowVitals.pactMultiplier < 0.35,
        `minP Pact escrow locks +${unitResults.earlyEscrowVitals.lockedPactHours.toFixed(2)}h when all subjects <2u (mult ${Math.round(unitResults.earlyEscrowVitals.pactMultiplier * 100)}%)`);
    check(unitResults.vitalsLockedText.includes('LOCKED') && unitResults.vitalsLockedText.includes('feed'),
        'Vitals UI surfaces locked Pact hours and weakest subject release prompt');
    check(unitResults.imbalancedVitals.luminescence < 0.40,
        `Spamming Physics alone leaves Luminescence starved (${unitResults.imbalancedVitals.luminescence.toFixed(2)})`);
    check(unitResults.balancedVitals.luminescence === 1.00 && unitResults.balancedVitals.persistence === 1.00 && unitResults.balancedVitals.lockedPactHours === 0,
        `Balancing P/C/M to 20u+ unlocks full Pact escrow (0h locked), Luminescence (${unitResults.balancedVitals.luminescence.toFixed(2)}), and Persistence (${unitResults.balancedVitals.persistence.toFixed(2)})`);
    check(unitResults.balancedVitals.reservoirHours > 16.0 && unitResults.balancedVitals.spectrum.name === 'XENON WHITE',
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

    console.log('── [4b] Zero-Escape-Hatch & Data-Safety Guards (No Backups/Drive, Corrupt State, Clock Glitches, Multi-Tab) ──');
    // (0) Confirm all backup & Google Drive escape hatches are stripped from DOM & JS API
    const noEscapeCheck = await page.evaluate(async () => {
        const mod = await import('./storage.js');
        let buildErr = null, applyErr = null;
        try { await mod.buildFullBackup(); } catch (e) { buildErr = e && e.message; }
        try { await mod.applyFullBackup({ __jmaxBackup: true, idb: [] }); } catch (e) { applyErr = e && e.message; }
        return {
            hasBackupBtn: !!document.getElementById('backup-download-btn'),
            hasRestoreInput: !!document.getElementById('restore-backup-input'),
            hasDriveBtn: !!document.getElementById('btn-drive-auth'),
            hasManualSync: !!document.getElementById('manual-sync-btn'),
            hasExportGlobal: typeof window.exportFullBackup === 'function',
            hasRestoreGlobal: typeof window.restoreFullBackup === 'function',
            buildErr,
            applyErr,
        };
    });
    check(!noEscapeCheck.hasBackupBtn && !noEscapeCheck.hasRestoreInput && !noEscapeCheck.hasDriveBtn && !noEscapeCheck.hasManualSync,
        'Backup export/restore and Google Drive sync controls are completely removed from UI');
    check(!noEscapeCheck.hasExportGlobal && !noEscapeCheck.hasRestoreGlobal &&
          String(noEscapeCheck.buildErr).includes('permanently disabled') &&
          String(noEscapeCheck.applyErr).includes('permanently disabled'),
        'buildFullBackup() and applyFullBackup() are permanently disabled');

    // (a) Absurd >1yr CMOS forward clock jump must NOT trigger false flatline
    const afterAbsurdJump = await page.evaluate(() => {
        const before = window.Heartbeat.getVitals().reservoirHours;
        window.Heartbeat.tickClock(Date.now() + 500 * 24 * 3600 * 1000);
        const after = window.Heartbeat.getVitals();
        return { before, afterHrs: after.reservoirHours, flatlined: after.flatlined };
    });
    check(!afterAbsurdJump.flatlined && Math.abs(afterAbsurdJump.before - afterAbsurdJump.afterHrs) < 0.01,
        'Absurd +500d CMOS clock jump is ignored instead of causing false flatline');

    // (b) Corrupt reservoirHours ("" / "NaN") in storage must heal safely instead of becoming 0 and wiping
    await page.goto(`http://127.0.0.1:${PORT}/__offline_gap`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
        const raw = JSON.parse(localStorage.getItem('jeemax_heartbeat_v1'));
        raw.reservoirHours = '';
        localStorage.setItem('jeemax_heartbeat_v1', JSON.stringify(raw));
        const mod = await import('./storage.js');
        await mod.idbSet('jeemax_heartbeat_v1', { ...raw, reservoirHours: Number.NaN });
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.Heartbeat && !!document.getElementById('heartbeat-void')?.classList.contains('hb-ready'), null, { timeout: 15000 });
    const afterCorrupt = await page.evaluate(async () => {
        const mod = await import('./storage.js');
        return {
            v: window.Heartbeat.getVitals(),
            hasQ: mod.AppState.questionBank.some(q => q.id === 'ui-test-q1'),
        };
    });
    check(!afterCorrupt.v.flatlined && afterCorrupt.v.reservoirHours > 17.5 && afterCorrupt.hasQ,
        `Corrupt NaN/empty reservoirHours healed safely (${afterCorrupt.v.reservoirHours.toFixed(2)}h) with question bank intact`);

    // (c) Multi-tab sync: sibling tab solve propagates immediately via BroadcastChannel/storage
    const page2 = await context.newPage();
    await page2.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page2.waitForFunction(() => !!window.Heartbeat && !!document.getElementById('heartbeat-void')?.classList.contains('hb-ready'), null, { timeout: 15000 });
    await page2.evaluate(() => {
        window.Heartbeat.recordProblemUnit({ id: 'hb-tab2-q1', subject: 'physics', qElo: 1400, qEloSource: 'gem-stamped' }, 'solve');
    });
    await page.waitForFunction(() => window.Heartbeat.getState().daily.creditedIds.includes('hb-tab2-q1'), null, { timeout: 5000 });
    check(true, 'Sibling tab solve propagated immediately to open tab via multi-tab Heartbeat sync');
    await page2.close();

    // (d) Pre-wipe rescue: stale tab hitting 0.0h aborts wipe if persisted storage is alive
    const rescueResult = await page.evaluate(async () => {
        const mod = await import('./storage.js');
        const futureTs = Date.now() + 48 * 3600 * 1000;
        const aliveRecord = {
            ...window.Heartbeat.getState(),
            reservoirHours: 16.5,
            lastTickAt: futureTs,
            highWaterMark: futureTs,
            flatlined: false,
        };
        localStorage.setItem('jeemax_heartbeat_v1', JSON.stringify(aliveRecord));
        await mod.idbSet('jeemax_heartbeat_v1', aliveRecord);
        // Tab in memory still has <=18h at now -> jumping +48h (+32h drainable) drains in-memory to 0,
        // invoking _enterFlatlineSequence, which must re-read disk and ABORT wipe.
        window.Heartbeat.tickClock(futureTs);
        await new Promise(r => setTimeout(r, 350));
        const v = window.Heartbeat.getVitals(futureTs);
        return {
            flatlined: v.flatlined,
            hrs: v.reservoirHours,
            hasQ: mod.AppState.questionBank.some(q => q.id === 'ui-test-q1'),
            overlayHidden: document.getElementById('heartbeat-flatline-overlay')?.hidden !== false,
        };
    });
    check(!rescueResult.flatlined && rescueResult.hrs > 16.0 && rescueResult.hasQ && rescueResult.overlayHidden,
        `Pre-wipe verification rescued stale tab (${rescueResult.hrs.toFixed(2)}h, question bank intact, wipe aborted)`);

    // (f) Cleared localStorage recovers cleanly from IDB mirror without data loss
    await page.goto(`http://127.0.0.1:${PORT}/__offline_gap`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
        const mod = await import('./storage.js');
        const idbHb = await mod.idbGet('jeemax_heartbeat_v1');
        // Normalize timestamps back to now so IDB holds a clean 16.0h living copy
        idbHb.reservoirHours = 16.0;
        idbHb.lastTickAt = Date.now();
        idbHb.highWaterMark = idbHb.lastTickAt;
        await mod.idbSet('jeemax_heartbeat_v1', idbHb);
        localStorage.clear();
    });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.Heartbeat && !!document.getElementById('heartbeat-void')?.classList.contains('hb-ready'), null, { timeout: 15000 });
    const afterLsClear = await page.evaluate(async () => {
        const mod = await import('./storage.js');
        return {
            v: window.Heartbeat.getVitals(),
            hasQ: mod.AppState.questionBank.some(q => q.id === 'ui-test-q1'),
        };
    });
    check(!afterLsClear.v.flatlined && afterLsClear.v.reservoirHours > 15.8 && afterLsClear.v.reservoirHours <= 16.05 && afterLsClear.hasQ,
        `Cleared localStorage recovered cleanly from IDB mirror (${afterLsClear.v.reservoirHours.toFixed(2)}h, question bank intact)`);

    console.log('── [4c] Sleep Freeze Integrator, Circadian Multipliers & Leash Purity ──');
    const sleepCirc = await page.evaluate(async () => {
        const hb = window.Heartbeat;
        const mod = await import('./storage.js');

        // Sleep freeze exact math
        const t2330 = new Date(2026, 4, 10, 23, 30, 0).getTime();
        const t0930 = new Date(2026, 4, 11, 9, 30, 0).getTime();
        const t0000 = new Date(2026, 4, 11, 0, 0, 0).getTime();
        const t0800 = new Date(2026, 4, 11, 8, 0, 0).getTime();
        const tDay1 = new Date(2026, 4, 10, 8, 0, 0).getTime();
        const tDay3 = new Date(2026, 4, 12, 8, 0, 0).getTime();

        const dOvernight = hb.computeDrainableMs(t2330, t0930);
        const dSleepOnly = hb.computeDrainableMs(t0000, t0800);
        const dTwoDays = hb.computeDrainableMs(tDay1, tDay3);

        // Live tickClock inside 01:00 -> 07:00 drains 0.0h (run on clean future window, then restore state)
        const saved = hb.getState();
        const baseSleep = new Date();
        baseSleep.setDate(baseSleep.getDate() + 1);
        baseSleep.setHours(1, 0, 0, 0);
        const sleepStartMs = baseSleep.getTime();
        const sleepEndMs = new Date(baseSleep.getFullYear(), baseSleep.getMonth(), baseSleep.getDate(), 7, 0, 0, 0).getTime();
        const sleepTestRec = {
            ...saved,
            reservoirHours: 12.0,
            lastTickAt: sleepStartMs,
            highWaterMark: sleepStartMs,
            flatlined: false,
        };
        localStorage.setItem('jeemax_heartbeat_v1', JSON.stringify(sleepTestRec));
        await mod.idbSet('jeemax_heartbeat_v1', sleepTestRec);

        // Fresh tab evaluates sleep window & circadian multipliers without mutating main bank
        return {
            dOvernightHrs: dOvernight / 3600000,
            dSleepOnlyMs: dSleepOnly,
            dTwoDaysHrs: dTwoDays / 3600000,
            sleepStartMs,
            sleepEndMs,
        };
    });
    check(Math.abs(sleepCirc.dOvernightHrs - 2.0) < 0.001,
        `computeDrainableMs(23:30 → 09:30) = ${sleepCirc.dOvernightHrs.toFixed(2)}h (8h sleep freeze excluded)`);
    check(sleepCirc.dSleepOnlyMs === 0,
        'computeDrainableMs(00:00 → 08:00) = 0ms');
    check(Math.abs(sleepCirc.dTwoDaysHrs - 32.0) < 0.001,
        `computeDrainableMs(Day1 08:00 → Day3 08:00) = ${sleepCirc.dTwoDaysHrs.toFixed(2)}h`);

    // Verify tickClock inside 01:00 -> 07:00 and circadian multiplier behavior in fresh page
    const sleepAndCircPage = await context.newPage();
    await sleepAndCircPage.goto(BASE, { waitUntil: 'domcontentloaded' });
    await sleepAndCircPage.waitForFunction(() => !!window.Heartbeat && !!document.getElementById('heartbeat-void')?.classList.contains('hb-ready'), null, { timeout: 15000 });
    const circAudit = await sleepAndCircPage.evaluate(({ sleepStartMs, sleepEndMs }) => {
        const hb = window.Heartbeat;
        hb.tickClock(sleepEndMs);
        const afterSleepHrs = hb.getVitals(sleepEndMs).reservoirHours;

        // Reset clean day at 10:00 AM after draining 4h to make room for recharge measurement
        const t1000 = new Date(2026, 4, 15, 10, 0, 0).getTime();
        const t1500 = new Date(2026, 4, 15, 15, 0, 0).getTime();
        const t1900 = new Date(2026, 4, 15, 19, 0, 0).getTime();
        const t0200 = new Date(2026, 4, 15, 2, 0, 0).getTime();

        const dayKey = '2099-05-15';
        const freshRec = {
            version: 1,
            reservoirHours: 10.0,
            lastTickAt: Date.now(),
            highWaterMark: Date.now(),
            seededAt: Date.now(),
            lastParity: 1.0,
            flatlined: false,
            daily: {
                date: dayKey,
                units: { physics: 0, chemistry: 0, maths: 0 },
                effectiveUnits: { physics: 0, chemistry: 0, maths: 0 },
                morningRawUnits: { physics: 0, chemistry: 0, maths: 0 },
                pactMins: 0,
                creditedIds: [],
                creditedPactHours: 0,
                creditedSubjHours: { physics: 0, chemistry: 0, maths: 0 },
            },
            leash: {
                epoch: 1,
                floors: { physics: 20, chemistry: 20, maths: 20 },
                pendingDays: [],
                history: [],
                lastCalibration: null,
            },
        };
        localStorage.setItem('jeemax_heartbeat_v1', JSON.stringify(freshRec));
        // Reloading isn't needed if we inject via storage? Wait: _hb is module-private!
        // Instead let's verify getCircadianContext + recordProblemUnit on a fresh page after seeding localStorage+IDB!
        return { afterSleepHrs, sleepStartMs, sleepEndMs, t1000, t1500, t1900, t0200 };
    }, { sleepStartMs: sleepCirc.sleepStartMs, sleepEndMs: sleepCirc.sleepEndMs });
    check(Math.abs(circAudit.afterSleepHrs - 12.0) < 0.001,
        `tickClock inside 01:00 → 07:00 sleep freeze drains 0.0h (${circAudit.afterSleepHrs.toFixed(2)}h)`);

    // Seed clean 10.0h record on __offline_gap then test circadian multipliers in sleepAndCircPage
    await sleepAndCircPage.goto(`http://127.0.0.1:${PORT}/__offline_gap`, { waitUntil: 'domcontentloaded' });
    await sleepAndCircPage.evaluate(async () => {
        const mod = await import('./storage.js');
        const today = mod.todayLocalKey();
        const rec = {
            version: 1,
            reservoirHours: 10.0,
            lastTickAt: Date.now(),
            highWaterMark: Date.now(),
            seededAt: Date.now(),
            lastParity: 1.0,
            flatlined: false,
            daily: {
                date: today,
                units: { physics: 0, chemistry: 0, maths: 0 },
                effectiveUnits: { physics: 0, chemistry: 0, maths: 0 },
                morningRawUnits: { physics: 0, chemistry: 0, maths: 0 },
                pactMins: 0,
                creditedIds: [],
                creditedPactHours: 0,
                creditedSubjHours: { physics: 0, chemistry: 0, maths: 0 },
            },
            leash: {
                epoch: 1,
                floors: { physics: 20, chemistry: 20, maths: 20 },
                pendingDays: [],
                history: [],
                lastCalibration: null,
            },
        };
        localStorage.setItem('jeemax_heartbeat_v1', JSON.stringify(rec));
        await mod.idbSet('jeemax_heartbeat_v1', rec);
    });
    await sleepAndCircPage.goto(BASE, { waitUntil: 'domcontentloaded' });
    await sleepAndCircPage.waitForFunction(() => !!window.Heartbeat && !!document.getElementById('heartbeat-void')?.classList.contains('hb-ready'), null, { timeout: 15000 });
    const multRes = await sleepAndCircPage.evaluate(() => {
        const hb = window.Heartbeat;
        const t1000 = new Date(2026, 4, 15, 10, 0, 0).getTime();
        const t1500 = new Date(2026, 4, 15, 15, 0, 0).getTime();
        const t1900 = new Date(2026, 4, 15, 19, 0, 0).getTime();
        const t0200 = new Date(2026, 4, 15, 2, 0, 0).getTime();

        // 14u before 14:00 at x1.20 -> 15th unit must revert to x1.00
        const amResults = [];
        for (let i = 0; i < 15; i++) {
            amResults.push(hb.recordProblemUnit({ id: `am-p-${i}`, subject: 'physics', qElo: 1400, qEloSource: 'gem-stamped' }, 'solve', { nowMs: t1000 }));
        }
        const physRawAfter15 = hb.getState().daily.units.physics;
        // Max out physics to 26u+ -> verify hard subject cap of 3.90h (1.3 * 3.0h)
        for (let i = 15; i < 30; i++) {
            hb.recordProblemUnit({ id: `am-p-${i}`, subject: 'physics', qElo: 1400, qEloSource: 'gem-stamped' }, 'solve', { nowMs: t1000 });
        }
        const physHoursCapped = hb.getState().daily.creditedSubjHours.physics;

        // 15:00 neutral -> x1.00 (0.15h/u)
        const pmRes = hb.recordProblemUnit({ id: 'pm-c-1', subject: 'chemistry', qElo: 1400, qEloSource: 'gem-stamped' }, 'solve', { nowMs: t1500 });
        // 19:00 fresh solve -> x0.70 (0.105h/u)
        const evFresh = hb.recordProblemUnit({ id: 'ev-c-1', subject: 'chemistry', qElo: 1400, qEloSource: 'gem-stamped' }, 'solve', { nowMs: t1900 });
        // 19:00 Vault dissection -> exempt -> x1.00
        const evDissect = hb.recordProblemUnit(
            { id: 'ev-c-dis', subject: 'chemistry', qElo: 1400, qEloSource: 'gem-stamped', errorReason: 'conceptual' },
            'dissection',
            { reason: 'conceptual', note: 'Missed conservation of angular momentum pivot constraint.', nowMs: t1900 }
        );
        // 19:00 Due Vault repeat -> exempt -> x1.00
        const evDueRepeat = hb.recordProblemUnit(
            { id: 'ev-c-rep', subject: 'chemistry', qElo: 1400, qEloSource: 'gem-stamped' },
            'solve',
            { wasAlreadySolved: true, isDue: true, nowMs: t1900 }
        );
        // 02:00 AM late night -> x0.50
        const nightRes = hb.recordProblemUnit({ id: 'night-m-1', subject: 'maths', qElo: 1400, qEloSource: 'gem-stamped' }, 'solve', { nowMs: t0200 });

        return {
            amFirst: amResults[0],
            am14th: amResults[13],
            am15th: amResults[14],
            physRawAfter15,
            physHoursCapped,
            pmRes,
            evFresh,
            evDissect,
            evDueRepeat,
            nightRes,
        };
    });
    check(multRes.amFirst.multiplier === 1.20 && Math.abs(multRes.amFirst.hoursAdded - 0.18) < 0.002 &&
          multRes.am14th.multiplier === 1.20 && multRes.am15th.multiplier === 1.00 &&
          Math.abs(multRes.am15th.hoursAdded - 0.15) < 0.002 && multRes.physRawAfter15 === 15,
        `Morning x1.20 applies up to 70% floor (14u @ +0.18h -> 15th @ +0.15h) with pure raw units (${multRes.physRawAfter15}u)`);
    check(Math.abs(multRes.physHoursCapped - 3.90) < 0.005,
        `Subject overflow hard-caps strictly at 3.90h (${multRes.physHoursCapped.toFixed(3)}h)`);
    check(multRes.pmRes.multiplier === 1.00 && Math.abs(multRes.pmRes.hoursAdded - 0.15) < 0.002,
        `15:00 solve pays x1.00 (+${multRes.pmRes.hoursAdded.toFixed(3)}h)`);
    check(multRes.evFresh.multiplier === 0.70 && Math.abs(multRes.evFresh.hoursAdded - 0.105) < 0.002,
        `19:00 fresh solve pays x0.70 (+${multRes.evFresh.hoursAdded.toFixed(3)}h)`);
    check(multRes.evDissect.multiplier === 1.00 && multRes.evDueRepeat.multiplier === 1.00,
        `19:00 Vault dissection (x${multRes.evDissect.multiplier}) & due repeat (x${multRes.evDueRepeat.multiplier}) stay exempt at x1.00`);
    check(multRes.nightRes.multiplier === 0.50 && Math.abs(multRes.nightRes.hoursAdded - 0.075) < 0.002,
        `02:00 AM solve pays x0.50 (+${multRes.nightRes.hoursAdded.toFixed(3)}h)`);

    console.log('── [4d] Zero-Wipe Grandfathering Migration (Pre-Overhaul >18h User State) ──');
    await sleepAndCircPage.goto(`http://127.0.0.1:${PORT}/__offline_gap`, { waitUntil: 'domcontentloaded' });
    await sleepAndCircPage.evaluate(async () => {
        const mod = await import('./storage.js');
        const today = mod.todayLocalKey();
        // Legacy pre-overhaul schema: NO effectiveUnits, NO morningRawUnits, 25.4h reservoir, 3.0h already credited
        const legacyRecord = {
            version: 1,
            reservoirHours: 25.4,
            lastTickAt: Date.now(),
            highWaterMark: Date.now(),
            seededAt: Date.now() - 10 * 86400000,
            lastParity: 1.0,
            flatlined: false,
            daily: {
                date: today,
                units: { physics: 12, chemistry: 0, maths: 0 },
                pactMins: 0,
                creditedIds: ['legacy-q1'],
                creditedPactHours: 0,
                creditedSubjHours: { physics: 3.0, chemistry: 0, maths: 0 },
            },
            leash: {
                epoch: 1,
                floors: { physics: 20, chemistry: 20, maths: 20 },
                pendingDays: [],
                history: [],
                lastCalibration: null,
            },
        };
        localStorage.setItem('jeemax_heartbeat_v1', JSON.stringify(legacyRecord));
        await mod.idbSet('jeemax_heartbeat_v1', legacyRecord);
        mod.AppState.chapters.physics = ['Electrostatics'];
        mod.AppState.questionBank = [{
            id: 'legacy-q1',
            subject: 'physics',
            chapter: 'Electrostatics',
            type: 'mcq',
            options: ['A', 'B', 'C', 'D'],
            correctAnswer: 'A',
            qElo: 1400,
            qEloSource: 'gem-stamped',
            status: 'solved',
            extractedText: 'Legacy preserved question',
        }];
        await mod.saveAllAsync();
    });
    await sleepAndCircPage.goto(BASE, { waitUntil: 'domcontentloaded' });
    await sleepAndCircPage.waitForFunction(() => !!window.Heartbeat && !!document.getElementById('heartbeat-void')?.classList.contains('hb-ready'), null, { timeout: 15000 });
    const legacyAudit = await sleepAndCircPage.evaluate(async () => {
        const mod = await import('./storage.js');
        const hb = window.Heartbeat;
        const vBefore = hb.getVitals();
        const stBefore = hb.getState();
        // Solving a new question must NOT drop grandfathered 25.4h down to 18.0h
        const solveRes = hb.recordProblemUnit({ id: 'legacy-q2', subject: 'chemistry', qElo: 1400, qEloSource: 'gem-stamped' }, 'solve');
        const vAfter = hb.getVitals();
        return {
            hrsBefore: vBefore.reservoirHours,
            hrsAfter: vAfter.reservoirHours,
            flatlined: vBefore.flatlined,
            physCredited: stBefore.daily.creditedSubjHours.physics,
            hasLegacyQ: mod.AppState.questionBank.some(q => q.id === 'legacy-q1'),
            speedCapped: vBefore.speed <= 1.0 && vBefore.spread <= 0.50,
            solveRes,
        };
    });
    check(!legacyAudit.flatlined && legacyAudit.hrsBefore > 25.2 && legacyAudit.hrsBefore <= 25.45 && legacyAudit.hasLegacyQ,
        `Legacy >18h balance preserved intact (${legacyAudit.hrsBefore.toFixed(2)}h, question bank intact)`);
    check(legacyAudit.physCredited >= 3.0 && legacyAudit.hrsAfter >= legacyAudit.hrsBefore && legacyAudit.speedCapped,
        `Legacy mid-day credits untouched (${legacyAudit.physCredited.toFixed(2)}h) and post-solve balance kept grandfathered (${legacyAudit.hrsAfter.toFixed(2)}h)`);
    await sleepAndCircPage.close();

    // Re-seed clean 16.0h living state in main page before section [5] flatline test
    await page.goto(`http://127.0.0.1:${PORT}/__offline_gap`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
        const mod = await import('./storage.js');
        const rec = {
            version: 1,
            reservoirHours: 16.0,
            lastTickAt: Date.now(),
            highWaterMark: Date.now(),
            seededAt: Date.now(),
            lastParity: 1.0,
            flatlined: false,
            daily: {
                date: mod.todayLocalKey(),
                units: { physics: 0, chemistry: 0, maths: 0 },
                effectiveUnits: { physics: 0, chemistry: 0, maths: 0 },
                morningRawUnits: { physics: 0, chemistry: 0, maths: 0 },
                pactMins: 0,
                creditedIds: [],
                creditedPactHours: 0,
                creditedSubjHours: { physics: 0, chemistry: 0, maths: 0 },
            },
            leash: {
                epoch: 1,
                floors: { physics: 20, chemistry: 20, maths: 20 },
                pendingDays: [],
                history: [],
                lastCalibration: null,
            },
        };
        localStorage.setItem('jeemax_heartbeat_v1', JSON.stringify(rec));
        await mod.idbSet('jeemax_heartbeat_v1', rec);
    });

    console.log('── [5] 0.0h Flatline Death Sequence, Scorched-Earth Wipe & Anti-Save-Scumming ──');

    // Advance offline drain past 18h ceiling while app is closed (48h wall = 32h waking > 18h) -> reopen -> must flatline and wipe
    await page.goto(`http://127.0.0.1:${PORT}/__offline_gap`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
        const raw = JSON.parse(localStorage.getItem('jeemax_heartbeat_v1'));
        raw.lastTickAt = Date.now() - 48 * 3600 * 1000;
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
            await mod.applyFullBackup({ __jmaxBackup: true, idb: [] });
        } catch (e) {
            restoreError = e && e.message;
        }
        return {
            bankLen: mod.AppState.questionBank.length,
            idbKeys: entries.map(([k]) => k),
            cpCount: cpEntries.length,
            epoch,
            lsKeys: Object.keys(localStorage),
            restoreError,
        };
    });

    check(postWipeAudit.bankLen === 0 && !postWipeAudit.idbKeys.includes('jeemax_question_bank'),
        'Scorched-earth wipe erased questionBank and jeemaxxing_db data');
    check(postWipeAudit.cpCount === 0, 'Scorched-earth wipe cleared checkpoint-db');
    check(postWipeAudit.epoch > 0 && postWipeAudit.lsKeys.includes('jeemax_wipe_epoch'),
        'Permanent jeemax_wipe_epoch stamped after flatline');
    check(String(postWipeAudit.restoreError).includes('permanently disabled'),
        `Post-wipe backup restore stays permanently blocked (${postWipeAudit.restoreError})`);

    // Click BEGIN FROM ZERO -> restarts fresh 18h life & survives immediate reload
    await page.click('#hb-flatline-reset-btn');
    await page.waitForFunction(() => document.getElementById('heartbeat-flatline-overlay')?.hidden === true);
    const rebootVitals = await page.evaluate(() => window.Heartbeat.getVitals());
    check(rebootVitals.reservoirHours > 17.9 && rebootVitals.reservoirHours <= 18.05 && !rebootVitals.flatlined,
        `BEGIN FROM ZERO initialized fresh 18.0h life (${rebootVitals.reservoirHours.toFixed(2)}h)`);

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.Heartbeat && !!document.getElementById('heartbeat-void')?.classList.contains('hb-ready'), null, { timeout: 15000 });
    const afterRebootReload = await page.evaluate(() => window.Heartbeat.getVitals());
    check(!afterRebootReload.flatlined && afterRebootReload.reservoirHours > 17.9 && afterRebootReload.reservoirHours <= 18.05,
        `Immediate reload after BEGIN FROM ZERO stays alive cleanly (${afterRebootReload.reservoirHours.toFixed(2)}h)`);

    check(errors.length === 0, `Zero uncaught runtime errors (${errors.length} seen${errors.length ? ': ' + errors.join(' | ') : ''})`);
} finally {
    await browser.close();
    server.close();
}

console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
