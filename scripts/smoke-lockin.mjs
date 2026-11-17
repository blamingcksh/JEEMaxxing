// Smoke test for Lock-In Ritual Chamber & Background Escrow Timer (pomodoro.js)
// Run: node scripts/smoke-lockin.mjs

import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
};

const elements = new Map();
function makeEl(id) {
    const classes = new Set();
    const attrs = new Map();
    const el = {
        id,
        value: '',
        textContent: '',
        innerHTML: '',
        hidden: false,
        disabled: false,
        dataset: {},
        style: { setProperty() {} },
        classList: {
            add: (...cs) => cs.forEach(c => classes.add(c)),
            remove: (...cs) => cs.forEach(c => classes.delete(c)),
            toggle: (c, force) => {
                const on = force === undefined ? !classes.has(c) : !!force;
                if (on) classes.add(c); else classes.delete(c);
                return on;
            },
            contains: (c) => classes.has(c),
        },
        setAttribute: (k, v) => attrs.set(k, String(v)),
        getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
        removeAttribute: (k) => attrs.delete(k),
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
        appendChild: (c) => c,
        removeChild() {},
        remove() {},
        querySelector: () => null,
        querySelectorAll: () => [],
    };
    elements.set(id, el);
    return el;
}

const presetBtns = [
    { dataset: { grind: '25', chill: '5' }, classList: makeEl('_p25').classList },
    { dataset: { grind: '50', chill: '10' }, classList: makeEl('_p50').classList },
    { dataset: { grind: '90', chill: '15' }, classList: makeEl('_p90').classList },
];
const scopeSubjBtns = {
    physics: makeEl('_lsc_phys'),
    chemistry: makeEl('_lsc_chem'),
    maths: makeEl('_lsc_math'),
};
const scopeModalStub = makeEl('lockin-scope-modal');
scopeModalStub.querySelector = (sel) => {
    const m = /^\.lsc-subj-btn\[data-subject="([^"]+)"\]$/.exec(sel);
    return (m && scopeSubjBtns[m[1]]) || null;
};

const visibilityListeners = [];
globalThis.document = {
    hidden: false,
    body: makeEl('body'),
    getElementById: (id) => elements.get(id) || makeEl(id),
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '#lockin-presets .lockin-preset' ? presetBtns : []),
    addEventListener: (ev, fn) => { if (ev === 'visibilitychange') visibilityListeners.push(fn); },
    createElement: (tag) => makeEl(tag),
};
globalThis.window = globalThis;
globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
globalThis.Event = class Event { constructor(type) { this.type = type; } };
globalThis.MutationObserver = class { observe() {} disconnect() {} };

let fakeNowOffset = 0;
const realDateNow = Date.now.bind(Date);
Date.now = () => realDateNow() + fakeNowOffset;

let practiceClosedCount = 0;
let practiceClosedOpts = [];
let practiceExitedCount = 0;
let flowUiExitedCount = 0;
let pendingRecapPlayedCount = 0;
let resumedSessions = [];
let launchedScopes = [];
let mockCatalog = {
    physics: { totalEligible: 3, chapters: [{ name: 'Electrostatics', count: 3 }] },
    chemistry: { totalEligible: 4, chapters: [{ name: 'Electrochemistry', count: 4 }] },
    maths: { totalEligible: 0, chapters: [] },
};
let galleryMockActive = false;
let galleryFinishOpts = null;
let galleryFinishCb = null;
let galleryAbortedCount = 0;
let galleryReversedCount = 0;
globalThis.GalleryBreak = {
    begin() { galleryMockActive = true; },
    setProgress() {},
    finish(cb, opts) { galleryFinishCb = cb; galleryFinishOpts = opts || null; },
    reverseOut(cb) { galleryReversedCount++; galleryMockActive = false; if (cb) cb(); },
    abort() { galleryMockActive = false; galleryAbortedCount++; },
    isActive: () => galleryMockActive,
};
globalThis.closePracticeModal = (opts) => {
    practiceClosedCount++;
    practiceClosedOpts.push(opts || {});
    document.getElementById('practice-modal').classList.remove('active');
};
globalThis.exitPracticeMode = () => {
    practiceExitedCount++;
    document.getElementById('practice-modal').classList.remove('active');
};
globalThis.__exitLockinFlowUi = () => { flowUiExitedCount++; };
globalThis.__playPendingSessionRecapIfAny = () => { pendingRecapPlayedCount++; };
globalThis.__getLockinScopeCatalog = () => JSON.parse(JSON.stringify(mockCatalog));
globalThis.__launchLockinScope = (sess, opts) => {
    launchedScopes.push({ subject: sess.subject, chapter: sess.chapter, opts: opts || {} });
    document.getElementById('practice-modal').classList.add('active');
    return true;
};
globalThis.__resumePracticeFromLockinBreak = (sess) => {
    resumedSessions.push({ mode: sess.mode, round: sess.currentSession, subject: sess.subject, chapter: sess.chapter });
    document.getElementById('practice-modal').classList.add('active');
};
globalThis.AppState = { elo: { physics: 1200, chemistry: 1200, maths: 1200, global: 1200 } };

const pomo = await import('../pomodoro.js');
const state = await import('../storage.js');

let passed = 0;
function ok(cond, label) {
    assert.ok(cond, label);
    passed++;
    console.log(`  ✓ ${label}`);
}

console.log('── [1] Mode-Reactive Lock-In Chamber Setup & Presets ──');
{
    window.AppState.flowSlider = 72;
    let confirmedMode = null;
    const opened = pomo.openLockinSetupModal('hardcore', { subject: 'maths', chapter: 'Calculus' }, (sess) => {
        confirmedMode = sess.mode;
    });
    ok(opened === true, 'openLockinSetupModal returns true for hardcore');
    const modal = document.getElementById('lockin-setup-modal');
    ok(modal.classList.contains('active'), '#lockin-setup-modal gains .active');
    ok(modal.getAttribute('data-lockin-mode') === 'hardcore', 'data-lockin-mode="hardcore" set on modal');
    ok(document.getElementById('lockin-title').textContent === 'Enter the Crucible', 'Hardcore title hydrated');
    ok(document.getElementById('lockin-rounds').value === '2', 'Default rounds = 2 for Break + Auto-Resume');

    pomo.applyLockinPreset(25, 5);
    ok(document.getElementById('lockin-grind').value === '25', 'Preset 25/5 sets grind=25');
    ok(document.getElementById('lockin-chill').value === '5', 'Preset 25/5 sets chill=5');
    ok(presetBtns[0].classList.contains('active') && !presetBtns[1].classList.contains('active'), 'Preset active pill synced');

    pomo.stepLockinField('grind', 5);
    ok(document.getElementById('lockin-grind').value === '30', 'stepLockinField increments grind to 30');

    const trackHtml = document.getElementById('lockin-timeline-track').innerHTML;
    ok(trackHtml.includes('GRIND 30m') && trackHtml.includes('REST 5m'), 'Proportional timeline renders GRIND and REST blocks');

    pomo.confirmLockinSetup();
    ok(!modal.classList.contains('active'), 'confirmLockinSetup closes #lockin-setup-modal');
    ok(confirmedMode === 'hardcore', 'confirmLockinSetup invokes onConfirmStart callback');
    ok(pomo.lockinSession.active && pomo.lockinSession.running, 'lockinSession is active and running');
    ok(pomo.lockinSession.phase === 'STUDY', 'lockinSession starts in STUDY phase');
    ok(window._pomoRunning === true && document.body.classList.contains('pomo-active'), 'Deep Work ×1.5 multiplier is active during STUDY');
    pomo.endLockinSession();
}

console.log('── [2] Silent Expiry While Question On Screen & Deferred Break Transition ──');
{
    window.AppState.flowSlider = 72;
    state.studySecs.physics = 0;
    pomo.openLockinSetupModal('flow', { subject: 'physics', chapter: 'Electrostatics' }, () => {
        document.getElementById('practice-modal').classList.add('active');
    });
    document.getElementById('lockin-grind').value = '5';
    document.getElementById('lockin-chill').value = '2';
    document.getElementById('lockin-rounds').value = '2';
    pomo.confirmLockinSetup();

    ok(document.getElementById('practice-modal').classList.contains('active'), 'Practice modal is open');
    // Fast-forward wall clock by 5 minutes + 2 seconds and trigger tick via visibilitychange catch-up:
    fakeNowOffset += 302 * 1000;
    visibilityListeners.forEach(fn => fn());

    ok(pomo.lockinSession.expiredPendingTransition === true, 'Real _lockinTick() sets expiredPendingTransition = true at 00:00');
    ok(document.getElementById('practice-modal').classList.contains('active'), 'Silent expiry does NOT close practice modal mid-question');
    ok(document.getElementById('practice-modal').classList.contains('pq-lockin-complete-glow'), 'Peripheral glow added on silent expiry');
    ok(state.studySecs.physics === 0, 'Escrow study time is not banked until question completes');

    // Now user clicks Continue / Skip / Close -> consumePendingLockinExpiry()
    const consumed = pomo.consumePendingLockinExpiry();
    ok(consumed === true, 'consumePendingLockinExpiry() intercepts transition');
    ok(!document.getElementById('practice-modal').classList.contains('active'), 'Practice modal auto-closed for break');
    ok(!document.getElementById('practice-modal').classList.contains('pq-lockin-complete-glow'), 'Peripheral glow cleared');
    ok(state.studySecs.physics === 300, 'Full 5m (300s) escrow block banked to physics studySecs');
    ok(pomo.lockinSession.phase === 'BREAK', 'Session transitioned to BREAK phase');
    ok(document.getElementById('lockin-break-hud').classList.contains('active'), 'Floating Museum Break HUD is active');
}

console.log('── [3] Earned Break HUD Controls & Auto-Resume Into Same Mode ──');
{
    const beforeTime = document.getElementById('lbh-time').textContent;
    pomo.addLockinRest(2);
    const afterTime = document.getElementById('lbh-time').textContent;
    ok(beforeTime !== afterTime, '+2m Rest updates Break HUD countdown immediately');

    resumedSessions = [];
    pomo.skipLockinRest();
    ok(!document.getElementById('lockin-break-hud').classList.contains('active'), 'Break HUD hides when break ends');
    ok(pomo.lockinSession.phase === 'STUDY', 'Session returns to STUDY phase for Round 2');
    ok(pomo.lockinSession.currentSession === 2, 'currentSession incremented to 2');
    ok(resumedSessions.length === 1 && resumedSessions[0].mode === 'flow', 'Auto-resumed practice in exact same mode (flow)');
    ok(document.getElementById('practice-modal').classList.contains('active'), 'Practice modal re-opened automatically');
}

console.log('── [4] Contract Breach Early-Exit Warning (Stay Locked In vs Void Block) ──');
{
    const bankedBefore = state.studySecs.physics;
    ok(pomo.isLockinStudyRunning() === true, 'Study block is actively running');

    // User tries to close practice modal mid-block
    const intercepted = pomo.requestLockinEarlyExitConfirm();
    ok(intercepted === true, 'requestLockinEarlyExitConfirm intercepts early close');
    const notifyModal = document.getElementById('timer-notify-modal');
    ok(notifyModal.classList.contains('active'), 'Notification modal opens');
    ok(notifyModal.getAttribute('data-notify-variant') === 'breach', 'Modal has data-notify-variant="breach"');
    ok(document.getElementById('notify-primary').textContent.includes('Stay Locked In'), 'Primary CTA is Stay Locked In');
    ok(document.getElementById('notify-secondary').textContent.includes('Void Block'), 'Secondary CTA is Void Block & Exit');

    // Click "Stay Locked In" (primary)
    pomo.confirmTimerNotification();
    ok(!notifyModal.classList.contains('active'), 'Breach modal closes on Stay Locked In');
    ok(pomo.isLockinStudyRunning() === true, 'Study timer resumes running');

    // Trigger breach again and click "Void Block & Exit" (secondary)
    pomo.requestLockinEarlyExitConfirm();
    pomo.notifyKeepGoing();
    ok(pomo.lockinSession.active === false, 'Session terminated on Void Block');
    ok(state.studySecs.physics === bankedBefore, 'Uncommitted block time was NOT counted (escrow voided)');
    ok(pomo.getFocusLedger().chain === 0, 'Unbroken block chain reset to 0 on void');
}

console.log('── [5] Mid-Timer Question Pool Exhaustion (Arena Cleared Victory Banner) ──');
{
    const bankedBefore = state.studySecs.physics;
    pomo.openLockinSetupModal('hardcore', { subject: 'physics', chapter: 'Optics' }, () => {
        document.getElementById('practice-modal').classList.add('active');
    });
    document.getElementById('lockin-grind').value = '25';
    pomo.confirmLockinSetup();
    pomo.noteLockinSolve();
    pomo.noteLockinSolve();
    pomo.noteLockinSolve();

    const exhausted = pomo.completeLockinOnPoolExhausted();
    ok(exhausted === true, 'completeLockinOnPoolExhausted returns true');
    ok(pomo.lockinSession.active === false, 'Timer stops immediately on pool exhaustion');
    const notifyModal = document.getElementById('timer-notify-modal');
    ok(notifyModal.classList.contains('active'), 'Victory banner modal opens');
    ok(notifyModal.getAttribute('data-notify-variant') === 'victory', 'Modal has data-notify-variant="victory"');
    ok(document.getElementById('notify-title').textContent.includes('Cleared'), 'Victory title displayed');
    ok(document.getElementById('notify-receipt').innerHTML.includes('3'), 'Victory receipt shows 3 solved questions');
    pomo.confirmTimerNotification();
}

console.log('── [6] Break Subject Switcher & Queue-to-Next-Round ──');
{
    window.AppState.flowSlider = 72;
    window.AppState.elo = { physics: 1200, chemistry: 1450, maths: 1300, global: 1316 };
    pomo.openLockinSetupModal('flow', { subject: 'physics', chapter: 'Electrostatics' }, () => {
        document.getElementById('practice-modal').classList.add('active');
    });
    document.getElementById('lockin-grind').value = '10';
    document.getElementById('lockin-chill').value = '5';
    document.getElementById('lockin-rounds').value = '2';
    pomo.confirmLockinSetup();

    // Advance Round 1 to completion and enter BREAK
    fakeNowOffset += 602 * 1000;
    visibilityListeners.forEach(fn => fn());
    pomo.consumePendingLockinExpiry();
    ok(pomo.lockinSession.phase === 'BREAK', 'Entered BREAK after Round 1');

    // Open Switch Subject during BREAK
    const openedSwitch = pomo.openLockinBreakSwitch();
    ok(openedSwitch === true, 'openLockinBreakSwitch opens during BREAK');
    ok(scopeModalStub.classList.contains('active'), '#lockin-scope-modal opens');
    ok(scopeModalStub.getAttribute('data-scope-mode') === 'break', 'Scope modal opens in break mode');
    ok(scopeSubjBtns.maths.disabled === true, 'Subject with 0 eligible questions is disabled');

    // Select Chemistry and confirm queue
    pomo.lockinScopeSelectSubject('chemistry');
    pomo.lockinScopeConfirm();
    ok(!scopeModalStub.classList.contains('active'), 'Scope modal closes after queueing');
    ok(pomo.lockinSession.pendingScope && pomo.lockinSession.pendingScope.subject === 'chemistry', 'Chemistry queued as pendingScope');
    ok(document.getElementById('lbh-next').textContent.includes('CHEM'), 'Break HUD next line reflects queued Chemistry target');
    ok(document.getElementById('lbh-switch-btn').classList.contains('is-queued'), 'Switch button marks queued state');

    // Skip rest -> resumes directly into Chemistry
    resumedSessions = [];
    pomo.skipLockinRest();
    ok(pomo.lockinSession.phase === 'STUDY', 'Session enters Round 2 STUDY');
    ok(pomo.lockinSession.subject === 'chemistry', 'lockinSession switched to chemistry');
    ok(resumedSessions.length === 1 && resumedSessions[0].subject === 'chemistry', 'Resumed practice in chemistry');

    // Earn some ELO in chemistry, finish Round 2, check multi-subject receipt
    window.AppState.elo.physics += 10;
    window.AppState.elo.chemistry += 15;
    pomo.noteLockinSolve(true);
    fakeNowOffset += 602 * 1000;
    visibilityListeners.forEach(fn => fn());
    pomo.consumePendingLockinExpiry();
    ok(pomo.lockinSession.active === false, 'Cycle completed after Round 2');
    const receiptHtml = document.getElementById('notify-receipt').innerHTML;
    ok(receiptHtml.includes('PHYS') && receiptHtml.includes('CHEM') && receiptHtml.includes('+25'),
        'Multi-subject ELO receipt sums per-subject deltas accurately (+25) instead of cross-subject diff');
    pomo.confirmTimerNotification();
}

console.log('── [7] Break Expiry While Break Scope Switcher Is Open → 90s Grace Expiry ──');
{
    window.AppState.flowSlider = 72;
    pomo.openLockinSetupModal('flow', { subject: 'physics', chapter: 'Electrostatics' }, () => {
        document.getElementById('practice-modal').classList.add('active');
    });
    document.getElementById('lockin-grind').value = '5';
    document.getElementById('lockin-chill').value = '2';
    document.getElementById('lockin-rounds').value = '2';
    pomo.confirmLockinSetup();

    fakeNowOffset += 302 * 1000;
    visibilityListeners.forEach(fn => fn());
    pomo.consumePendingLockinExpiry();
    ok(pomo.lockinSession.phase === 'BREAK', 'Entered BREAK');

    pomo.openLockinBreakSwitch();
    ok(scopeModalStub.getAttribute('data-scope-mode') === 'break', 'Switcher open during break');

    // Let break expire while switcher is open
    fakeNowOffset += 122 * 1000;
    visibilityListeners.forEach(fn => fn());
    ok(scopeModalStub.classList.contains('active'), 'Switcher stays open when break hits 00:00');
    ok(scopeModalStub.getAttribute('data-scope-mode') === 'break-end', 'Switcher upgraded in-place to break-end mode');
    ok(pomo.lockinSession.awaitingBreakSwitch === true, 'awaitingBreakSwitch flag set');

    // Let 90s grace expire without picking
    fakeNowOffset += 91 * 1000;
    visibilityListeners.forEach(fn => fn());
    ok(!scopeModalStub.classList.contains('active'), 'Switcher closes cleanly after 90s grace expiry');
    ok(pomo.lockinSession.active === false, 'Session finishes cleanly with banked blocks');
    ok(document.getElementById('timer-notify-modal').getAttribute('data-notify-variant') === 'complete',
        'Complete receipt shown for already-sealed Round 1 (no void penalty)');
    pomo.confirmTimerNotification();
}

console.log('── [8] Mid-Block Pool Exhaustion → Refill Gate & Per-Subject studySecs Split ──');
{
    state.studySecs.physics = 0;
    state.studySecs.chemistry = 0;
    const chainBefore = pomo.getFocusLedger().chain;
    pomo.openLockinSetupModal('flow', { subject: 'physics', chapter: 'Electrostatics' }, () => {
        document.getElementById('practice-modal').classList.add('active');
    });
    document.getElementById('lockin-grind').value = '20';
    document.getElementById('lockin-chill').value = '5';
    document.getElementById('lockin-rounds').value = '1';
    pomo.confirmLockinSetup();

    // Grind Physics for 5 minutes (300s) -> 15m (900s) remain >= 180s threshold
    pomo.noteLockinSolve(true);
    fakeNowOffset += 300 * 1000;
    practiceClosedOpts = [];
    launchedScopes = [];
    const res = pomo.handleLockinPoolExhausted({ catalog: mockCatalog });
    ok(res.handled === true && res.action === 'refill', 'handleLockinPoolExhausted enters Refill Gate when >=3m left and chapters available');
    ok(pomo.isLockinAwaitingRefill() === true && pomo.lockinSession.running === false, 'Study clock pauses cleanly in Refill Gate');
    ok(scopeModalStub.classList.contains('active') && scopeModalStub.getAttribute('data-scope-mode') === 'refill', 'Refill modal opens');
    ok(practiceClosedOpts.some(o => o.skipRecap === true && o.keepModeHistory === true), 'Practice modal closed silently with skipRecap & keepModeHistory');
    ok(state.studySecs.physics === 0, 'Nothing deposited yet while still inside escrow block');

    // Switch to Chemistry and resume block
    pomo.lockinScopeSelectSubject('chemistry');
    pomo.lockinScopeConfirm();
    ok(pomo.isLockinAwaitingRefill() === false && pomo.lockinSession.running === true, 'Study clock resumes immediately on launch');
    ok(pomo.lockinSession.subject === 'chemistry', 'Active subject updated to chemistry');
    ok(launchedScopes.length === 1 && launchedScopes[0].opts.preserveRecap === true && launchedScopes[0].opts.preserveSeen === true,
        'Scope launched preserving SessionRecap and seen history');
    ok(Math.abs(pomo.getLockinLeftSecs() - 900) <= 1, 'Remaining time preserved at ~900s');

    // Finish remaining 15m (900s) in Chemistry
    fakeNowOffset += 902 * 1000;
    visibilityListeners.forEach(fn => fn());
    pomo.consumePendingLockinExpiry();
    ok(state.studySecs.physics === 300, 'Physics credited exact 300s worked before switch');
    ok(state.studySecs.chemistry === 900, 'Chemistry credited exact 900s worked after switch');
    ok(pomo.getFocusLedger().chain === chainBefore + 1, 'Completed multi-chapter block advances focus chain by 1');
    pomo.confirmTimerNotification();
}

console.log('── [9] Anti-Exploit: 2:00 Refill Grace Expiry & <5m Early-Exhaustion Shield Guard ──');
{
    state.studySecs.physics = 0;
    localStorage.setItem('jeemax_ck_shields', '0');
    const chainBefore = pomo.getFocusLedger().chain;
    pomo.openLockinSetupModal('hardcore', { subject: 'physics', chapter: 'Electrostatics' }, () => {
        document.getElementById('practice-modal').classList.add('active');
    });
    document.getElementById('lockin-grind').value = '25';
    document.getElementById('lockin-rounds').value = '1';
    pomo.confirmLockinSetup();

    // Solve 1 question in 60s, exhaust chapter -> Refill Gate
    pomo.noteLockinSolve(true);
    fakeNowOffset += 60 * 1000;
    pendingRecapPlayedCount = 0;
    flowUiExitedCount = 0;
    const res = pomo.handleLockinPoolExhausted({ catalog: mockCatalog });
    ok(res.action === 'refill', 'Entered Refill Gate after 60s');

    // Let 2:00 (120s) grace timer expire without picking
    fakeNowOffset += 121 * 1000;
    visibilityListeners.forEach(fn => fn());
    ok(pomo.lockinSession.active === false && pomo.isLockinAwaitingRefill() === false, 'Session finalized on 2:00 grace expiry');
    ok(state.studySecs.physics === 60, 'Genuine 60s study time still credited to physics');
    ok(pomo.getFocusLedger().chain === chainBefore, 'Focus chain did NOT increment for <5m early exhaustion');
    ok(localStorage.getItem('jeemax_ck_shields') === '0', 'Hardcore Streak Shield NOT minted for <5m early exhaustion');
    ok(pendingRecapPlayedCount === 1 && flowUiExitedCount === 1, 'Pending recap played and flow UI cleaned up on refill exit');
    ok(document.getElementById('notify-receipt').innerHTML.includes('no shield'), 'Victory receipt transparently notes no shield under 5m');
    pomo.confirmTimerNotification();
}

console.log('── [10] Shadow Duel + Sudden Death Tie-Breaker & Run-It-Back Rematch ──');
{
    localStorage.clear();
    state.studySecs.physics = 0;
    state.studySecs.chemistry = 0;
    state.studySecs.maths = 0;
    globalThis.AppState = { elo: { physics: 1500, chemistry: 1500, maths: 1500, global: 1500 } };

    let duelEloCalls = [];
    globalThis.__applyDuelEloDelta = (subj, delta) => {
        duelEloCalls.push({ subj, delta });
        globalThis.AppState.elo[subj] = (globalThis.AppState.elo[subj] || 1200) + delta;
        return delta;
    };
    let sdLaunched = 0;
    let sdAvailable = true;
    globalThis.__hasSuddenDeathQuestion = () => sdAvailable;
    globalThis.__launchSuddenDeathQuestion = () => {
        sdLaunched++;
        document.getElementById('practice-modal').classList.add('active');
        return true;
    };

    const duelMod = await import('../shadow-duel.js');
    pomo.openLockinSetupModal('flow', { subject: 'physics', chapter: 'Electrostatics' }, () => {
        document.getElementById('practice-modal').classList.add('active');
    });
    document.getElementById('lockin-grind').value = '10';
    document.getElementById('lockin-rounds').value = '1';
    pomo.lockinDuelPreset('rival100');
    pomo.lockinDuelStake('elo10');
    pomo.confirmLockinSetup();

    ok(pomo.lockinSession.duel && pomo.lockinSession.duel.active === true && pomo.lockinSession.duel.preset === 'rival100',
        'Sign the Pact initializes live Shadow Duel on lockinSession');

    // Play 4 questions ending tied 2-2 (Speed Wins vs Speed Losses)
    const d = pomo.lockinSession.duel;
    for (let i = 1; i <= 4; i++) {
        const userWinsSplit = i % 2 === 1;
        d.currentGhost = { qId: `sd-${i}`, qElo: 1500, targetSecs: 180, ghostElo: 1600, verdict: 'correct', secs: 100, source: 'model' };
        duelMod.resolveDuelQuestion(d, { id: `sd-${i}`, subject: 'physics', chapter: 'Electrostatics' }, {
            userCorrect: true,
            userSecs: userWinsSplit ? 80 : 120,
        });
        pomo.noteLockinSolve(true);
    }
    ok(d.userPts === 2 && d.ghostPts === 2 && d.gradedCount === 4, 'Match finishes regular block tied 2-2 across 4 graded Qs');

    // Expire clock while inside Practice -> silent expiry -> advance triggers consumePendingLockinExpiry
    fakeNowOffset += 605 * 1000;
    visibilityListeners.forEach(fn => fn());
    ok(pomo.lockinSession.expiredPendingTransition === true, 'Expired final block defers cleanly until solve finishes');

    const consumed = pomo.consumePendingLockinExpiry();
    ok(consumed === true, 'consumePendingLockinExpiry runs on advance');
    ok(state.studySecs.physics === 600, 'Regular 600s study block is safely banked BEFORE Sudden Death starts');
    ok(document.getElementById('timer-notify-modal').getAttribute('data-notify-variant') === 'sudden-death',
        'Tied final match offers Sudden Death tie-breaker modal');

    // Enter Sudden Death
    pomo.confirmTimerNotification();
    ok(pomo.isLockinSuddenDeath() === true && sdLaunched === 1, 'Confirming enters SUDDEN_DEATH phase and launches decider Q');

    // User steals Sudden Death decider Q
    d.currentGhost = { qId: 'sd-decider', qElo: 1640, targetSecs: 180, ghostElo: 1600, verdict: 'wrong', secs: 140, source: 'model' };
    duelMod.resolveDuelQuestion(d, { id: 'sd-decider', subject: 'physics', chapter: 'Electrostatics' }, {
        userCorrect: true,
        userSecs: 95,
    });
    ok(d.suddenDeathPlayed === true && d.userPts === 4 && d.ghostPts === 2, 'Sudden Death steal gives +2 and flips match to 4-2');

    // Finish Sudden Death
    pomo.completeLockinSuddenDeath({ conceded: false });
    ok(pomo.lockinSession.active === false && !pomo.isLockinSuddenDeath(), 'Cycle settles cleanly after Sudden Death');
    ok(duelEloCalls.length === 1 && duelEloCalls[0].subj === 'physics' && duelEloCalls[0].delta === 20,
        'Winning 10 ELO Duel deposits +20 ELO into physics via __applyDuelEloDelta');
    ok(globalThis.AppState.elo.physics === 1520, 'Physics ELO rose from 1500 to 1520');
    const receiptHtml = document.getElementById('notify-receipt').innerHTML;
    ok(document.getElementById('timer-notify-modal').getAttribute('data-notify-variant') === 'duel-win',
        'Winning Duel themes notification modal with duel-win variant');
    ok(document.getElementById('notify-kicker').textContent.includes('VICTORY (4–2)'),
        'Win kicker clearly announces VICTORY (4–2)');
    ok(receiptHtml.includes('Shadow Duel: WIN (4–2') && receiptHtml.includes('da-hero') && receiptHtml.includes('da-tape'),
        'Final receipt renders full Duel Autopsy scoreboard & split-by-split tape');
    ok(document.getElementById('notify-rematch').style.display !== 'none', 'Run It Back rematch button is visible on Duel completion');

    // Rematch restores previous setup & duel prefs cleanly, then play a LOSS round to verify DEFEATED urgency UI
    pomo.rematchLastDuel();
    ok(document.getElementById('lockin-setup-modal').classList.contains('active'), 'Rematch reopens Sign the Pact modal');
    ok(!document.getElementById('lockin-duel-intel').hidden && document.getElementById('lockin-launch').textContent.includes('−10 ELO'),
        'Setup chamber shows live enemy intel & escrow stake on launch CTA');

    document.getElementById('lockin-grind').value = '5';
    document.getElementById('lockin-rounds').value = '1';
    pomo.confirmLockinSetup();
    const dLoss = pomo.lockinSession.duel;
    for (let i = 1; i <= 4; i++) {
        dLoss.currentGhost = { qId: `dl-${i}`, qElo: 1550, targetSecs: 180, ghostElo: 1620, verdict: 'correct', secs: 75, source: 'model' };
        duelMod.resolveDuelQuestion(dLoss, { id: `dl-${i}`, subject: 'physics', chapter: 'Magnetism' }, {
            userCorrect: i <= 2,
            userSecs: 120,
        });
        pomo.noteLockinSolve(i <= 2);
    }
    fakeNowOffset += 305 * 1000;
    visibilityListeners.forEach(fn => fn());
    pomo.consumePendingLockinExpiry();
    ok(document.getElementById('timer-notify-modal').getAttribute('data-notify-variant') === 'duel-loss',
        'Losing Duel switches completion modal to crimson duel-loss variant (never celebratory)');
    ok(document.getElementById('notify-kicker').textContent.includes('DEFEATED') && document.getElementById('notify-title').textContent.includes('Outclassed'),
        'Defeat modal names defeat & opponent clearly');
    ok(document.getElementById('notify-rematch').textContent.includes('Avenge Defeat') && document.getElementById('notify-primary').textContent.includes('Accept Defeat'),
        'Loss prioritizes Avenge Defeat rematch over Accept Defeat');
    ok(document.getElementById('notify-receipt').innerHTML.includes('TURNING POINT'),
        'Loss split tape highlights the exact Turning Point Q');
    pomo.confirmTimerNotification();
}

console.log(`\nALL LOCK-IN SMOKE TESTS PASSED! (${passed} assertions)\n`);
process.exit(0);
