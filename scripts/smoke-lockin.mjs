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
globalThis.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };
globalThis.Event = class Event { constructor(type) { this.type = type; } };
globalThis.MutationObserver = class { observe() {} disconnect() {} };

let fakeNowOffset = 0;
const realDateNow = Date.now.bind(Date);
Date.now = () => realDateNow() + fakeNowOffset;

let practiceClosedCount = 0;
let practiceExitedCount = 0;
let resumedSessions = [];
globalThis.closePracticeModal = () => {
    practiceClosedCount++;
    document.getElementById('practice-modal').classList.remove('active');
};
globalThis.exitPracticeMode = () => {
    practiceExitedCount++;
    document.getElementById('practice-modal').classList.remove('active');
};
globalThis.__resumePracticeFromLockinBreak = (sess) => {
    resumedSessions.push({ mode: sess.mode, round: sess.currentSession, subject: sess.subject });
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

console.log(`\nALL LOCK-IN SMOKE TESTS PASSED! (${passed} assertions)\n`);
process.exit(0);
