// Smoke test — Flow intensity slider (flow-slider.js + app integration).
// Pure part: zones, P(win) curve, anchor blend, binary reward profile.
// App part: single source of truth, uncapped Hardcore, served-mode stamp, infinite pool.
//
// Run: node scripts/smoke-flow-slider.mjs

import assert from 'node:assert';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
await register(pathToFileURL(path.join(HERE, 'loaders', 'esm-sh-stub.mjs')).href, import.meta.url);

globalThis.window = globalThis;
globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } };
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
globalThis.setInterval = () => Symbol('interval');
globalThis.clearInterval = () => {};
globalThis.alert = () => {};
globalThis.confirm = () => false;
globalThis.Image = class { set src(_) {} };

const localStorageStore = new Map();
globalThis.localStorage = {
    getItem: (k) => (localStorageStore.has(k) ? localStorageStore.get(k) : null),
    setItem: (k, v) => localStorageStore.set(k, String(v)),
    removeItem: (k) => localStorageStore.delete(k),
};

const ctx2d = new Proxy({}, { get: () => () => {} });
function fakeEl(tag) {
    const classes = new Set();
    const attrs = new Map();
    const el = {
        tagName: String(tag || 'div').toUpperCase(),
        nodeType: 1, nodeValue: null, parentNode: null, children: [], childNodes: [],
        style: { setProperty() {}, getPropertyValue: () => '', removeProperty() {} },
        dataset: {}, textContent: '', innerText: '', scrollTop: 0, value: '',
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
        hasAttribute: (k) => attrs.has(k),
        removeAttribute: (k) => attrs.delete(k),
        appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
        removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
        remove() {}, addEventListener() {}, removeEventListener() {},
        querySelector: () => null, querySelectorAll: () => [], closest: () => null,
        focus() {}, blur() {}, click() {}, getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }),
        getContext: () => ctx2d, toDataURL: () => '',
    };
    Object.defineProperty(el, 'innerHTML', {
        get() { return this._html || ''; },
        set(v) { this._html = String(v); this.children.length = 0; },
    });
    return el;
}
const els = new Map();
globalThis.document = {
    getElementById: (id) => { if (!els.has(id)) els.set(id, fakeEl('div')); return els.get(id); },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => fakeEl(tag),
    createElementNS: () => fakeEl('svg'),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text), nodeValue: String(text) }),
    createTreeWalker: () => ({ nextNode: () => null }),
    addEventListener() {}, removeEventListener() {},
    body: fakeEl('body'), head: fakeEl('head'), documentElement: fakeEl('html'),
    readyState: 'complete', hidden: false,
};

const {
    FLOW_ZONES,
    zoneForValue,
    modeForValue,
    pWinForValue,
    eloForPWin,
    centerElo,
    profileForValue,
    labelForValue,
    describeValue,
    clampFlowValue,
    isHardcoreValue,
} = await import(pathToFileURL(path.join(ROOT, 'flow-slider.js')).href);
const { AppState } = await import(pathToFileURL(path.join(ROOT, 'storage.js')).href);
await import(pathToFileURL(path.join(ROOT, 'app.js')).href);

let passed = 0;
function ok(cond, msg) {
    assert.ok(cond, msg);
    passed++;
    console.log('  ✓ ' + msg);
}
const mk = (id, qElo, extra) => ({
    id, subject: 'physics', chapter: 'Thermo', status: 'unsolved', type: 'mcq',
    options: ['A', 'B', 'C', 'D'], correctAnswer: 'A', qElo, extractedText: 'Q ' + id,
    ...(extra || {}),
});
const currentId = () => {
    const q = AppState.practiceQuestions[AppState.currentPracticeIndex];
    return q && q.id;
};

console.log('── flow-slider: zones + mode gate ──');
ok(FLOW_ZONES.length === 4, 'four zones');
ok(zoneForValue(0).id === 'read' && zoneForValue(30).id === 'read', '0–30 rest');
ok(zoneForValue(31).id === 'tap' && zoneForValue(62).id === 'tap', '31–62 steady');
ok(zoneForValue(63).id === 'dance' && zoneForValue(97).id === 'dance', '63–97 flow');
ok(zoneForValue(98).id === 'wild' && zoneForValue(100).id === 'wild', '98–100 hardcore');
ok(modeForValue(0) === 'flow' && modeForValue(97) === 'flow', 'below 98 is flow');
ok(modeForValue(98) === 'hardcore' && modeForValue(99) === 'hardcore' && modeForValue(100) === 'hardcore', '98–100 is hardcore');
ok(isHardcoreValue(97) === false && isHardcoreValue(98) === true, 'hardcore threshold helper');
ok(clampFlowValue(-5) === 0 && clampFlowValue(150) === 100 && clampFlowValue(NaN) === 72, 'clamp rounds + NaN fallback to 72');
ok(labelForValue(72) === '72 · FLOW' && labelForValue(100) === '100 · HARDCORE', 'readout labels');
ok(describeValue(0).startsWith('0 ') && describeValue(50).startsWith('50 ') && describeValue(100).startsWith('100 '), 'aria descriptions carry the number');

console.log('── flow-slider: P(win) curve + centre ──');
ok(Math.abs(pWinForValue(0) - 0.94) < 1e-9 && Math.abs(pWinForValue(30) - 0.87) < 1e-9, 'rest keyframes');
ok(Math.abs(pWinForValue(62) - 0.80) < 1e-9 && Math.abs(pWinForValue(98) - 0.50) < 1e-9, 'flow/hardcore keyframes');
ok(Math.abs(pWinForValue(100) - 0.34) < 1e-9, 'max overload keyframe');
{
    let prev = 2;
    let mono = true;
    for (let v = 0; v <= 100; v++) {
        const p = pWinForValue(v);
        if (p > prev + 1e-9) mono = false;
        prev = p;
    }
    ok(mono, 'P(win) is non-increasing across the dial');
}
ok(Math.abs(eloForPWin(1200, 0.5) - 1200) < 1e-6, 'P(win)=0.5 centres on user Elo');
ok(centerElo(1200, 0, 1500) < centerElo(1200, 62, 1500), 'low dial centres easy');
ok(centerElo(1200, 62, 1500) < centerElo(1200, 97, 1500), 'rising dial centres harder');
ok(centerElo(1200, 97, 1500) < centerElo(1200, 100, 1500), 'hardcore centres harder again');
ok(centerElo(1200, 100, 1500) > 1500, 'overload anchor pulls 100 toward the chapter ceiling');
{
    // v<=62 is purely relative: chapter average is ignored there.
    ok(Math.abs(centerElo(1200, 62, 1500) - centerElo(1200, 62, 2400)) < 1e-9, 'no anchor below 63');
}

console.log('── flow-slider: binary reward profile ──');
ok(profileForValue(72).winsMultiplier === 1.0 && profileForValue(72).lossMultiplier === 1.0, 'flow rewards 1.0x / 1.0x');
ok(profileForValue(97).winsMultiplier === 1.0, '97 still uses flow rewards');
ok(profileForValue(98).winsMultiplier === 1.8 && profileForValue(98).lossMultiplier === 0.6, '98 uses hardcore rewards');
ok(profileForValue(98).escrowBonusMultiplier === 2.0, 'hardcore escrow stays doubled');
ok(!('capPerDay' in profileForValue(100)) && !('capPerDay' in globalThis.MODE_TUNING.hardcore), 'Hardcore profiles have no daily cap');
ok(profileForValue(72).mode === 'flow' && profileForValue(100).mode === 'hardcore', 'profile mode matches gate');

console.log('── app: slider is the source of truth ──');
{
    AppState.questionBank = [mk('a0', 1100), mk('a1', 1200), mk('a2', 1300), mk('a3', 1900)];
    AppState.currentSubject = 'physics';
    AppState.currentChapter = 'Thermo';
    AppState.currentChapterSelection = null;
    AppState.elo = { physics: 1200, chemistry: 1200, maths: 1200, global: 1200 };
    AppState.practiceFlowMode = 'standard';
    AppState.flowSlider = 72;
    AppState._pqServedMode = 'standard';
    AppState._flowSessionActive = false;
    AppState.practiceQuestions = [];
    AppState.practiceSubmittedFlags = [];
    AppState.currentPracticeIndex = 0;

    ok(typeof globalThis.__setFlowSlider === 'function', '__setFlowSlider exposed');
    ok(typeof globalThis.__getFlowSliderState === 'function', '__getFlowSliderState exposed');
    globalThis.__setFlowSlider(100);
    ok(AppState.flowSlider === 100, '__setFlowSlider(100) pins the dial');
    const st = globalThis.__getFlowSliderState();
    ok(st.mode === 'hardcore' && st.hardcore === true && st.value === 100, 'state snapshot reports hardcore at 100');
    globalThis.__setFlowSlider(72);
    ok(AppState.flowSlider === 72, 'dial eases back to 72');

    globalThis.__setFlowSlider(100);
    globalThis.startFlowPractice();
    ok(AppState.practiceFlowMode === 'hardcore', 'startFlowPractice derives hardcore from dial 100');
    ok(AppState._pqServedMode === 'hardcore', 'served mode stamped hardcore');
    ok(AppState.practiceQuestions.length === 1, 'one-item pool at hardcore');
    const hcId = currentId();
    ok(AppState.practiceQuestions[0].qElo >= 1800, 'hardcore serves a boss question (got ' + AppState.practiceQuestions[0].qElo + ')');

    // Mid-question retune is non-destructive: current question and served stamp
    // survive; only the next pick adopts the new dial.
    globalThis.__setFlowSlider(72);
    ok(AppState.practiceFlowMode === 'flow', 'live dial rewrites the reward gate for the next question');
    ok(AppState._pqServedMode === 'hardcore', 'served stamp survives the retune (no reward exploit)');
    ok(currentId() === hcId, 'current question is not rebuilt by the retune');
    ok(AppState.flowSlider === 72, 'dial holds the retuned value');
}

console.log('── app: Hardcore has no daily cap ──');
{
    const d = new Date();
    const localKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    AppState.hardcoreDailyCount = 100;
    AppState.hardcoreDailyDate = localKey;
    AppState.questionBank = Array.from({ length: 12 }, (_, i) => mk('uncapped-' + i, 1900, { qEloSource: i % 2 ? 'gem-stamped' : 'imported' }));
    AppState.flowSlider = 72;
    for (const value of [98, 99, 100]) {
        ok(globalThis.__setFlowSlider(value) === value, 'old daily wins do not block intensity ' + value);
    }
    globalThis.startFlowPractice();
    ok(AppState.practiceFlowMode === 'hardcore', 'Hardcore starts despite old daily wins');
    for (let i = 0; i < 10; i++) {
        const q = AppState.practiceQuestions[AppState.currentPracticeIndex];
        ok(!!q, 'Hardcore question ' + (i + 1) + ' is available');
        globalThis.calculateEloMigration('physics', 60, 1, 60, q);
        ok(AppState.flowSlider === 100 && AppState.practiceFlowMode === 'hardcore', 'win ' + (i + 1) + ' does not lower intensity');
        globalThis.continuePractice();
        ok(AppState.practiceFlowMode === 'hardcore', 'Hardcore continues after win ' + (i + 1));
    }
    const snap = globalThis.__getFlowSliderState();
    ok(snap.hardcore === true && !('dailyCap' in snap) && !('capReached' in snap), 'state has no daily restriction');
    delete AppState.hardcoreDailyCount;
    delete AppState.hardcoreDailyDate;
}

console.log('── app: untouched-only engine (solved pool does not flow) ──');
{
    AppState.questionBank = [
        mk('z0', 1100, { status: 'solved', solveCount: 2, lastSolvedAt: new Date().toISOString() }),
        mk('z1', 1200, { status: 'solved', solveCount: 1, lastSolvedAt: new Date().toISOString() }),
    ];
    AppState.currentSubject = 'physics';
    AppState.currentChapter = 'Thermo';
    AppState.currentChapterSelection = null;
    AppState.elo = { physics: 1200, chemistry: 1200, maths: 1200, global: 1200 };
    AppState.practiceFlowMode = 'standard';
    AppState.flowSlider = 72;
    AppState._pqServedMode = 'standard';
    AppState._flowSessionActive = false;
    AppState.practiceQuestions = [];
    AppState.practiceSubmittedFlags = [];
    AppState.currentPracticeIndex = 0;

    globalThis.startFlowPractice();
    ok(AppState.practiceFlowMode === 'standard', 'fully-solved chapter does not enter Flow');
    ok(AppState.practiceQuestions.length === 0, 'no solved question is served');
}

console.log('── app: Flow only serves untouched questions ──');
{
    AppState.questionBank = [
        mk('u0', 1100, { status: 'solved', solveCount: 2, lastSolvedAt: new Date().toISOString() }),
        mk('u1', 1200),
        mk('u2', 1300),
    ];
    AppState.currentSubject = 'physics';
    AppState.currentChapter = 'Thermo';
    AppState.currentChapterSelection = null;
    AppState.elo = { physics: 1200, chemistry: 1200, maths: 1200, global: 1200 };
    AppState.practiceFlowMode = 'standard';
    AppState.flowSlider = 72;
    AppState._pqServedMode = 'standard';
    AppState._flowSessionActive = false;
    AppState.practiceQuestions = [];
    AppState.practiceSubmittedFlags = [];
    AppState.currentPracticeIndex = 0;

    globalThis.startFlowPractice();
    ok(AppState.practiceFlowMode === 'flow', 'Flow enters when untouched questions exist');
    ok(currentId() !== 'u0', 'solved question is never served (got ' + currentId() + ')');
    globalThis.continuePractice();
    ok(AppState.practiceFlowMode === 'flow', 'Flow stays while untouched questions remain');
    ok(currentId() !== 'u0', 'second pick is also untouched (got ' + currentId() + ')');
    globalThis.continuePractice();
    ok(AppState.practiceFlowMode === 'standard', 'Flow exits once untouched pool is drained');
}

console.log('── app: live dock toggle (hidden by default) ──');
{
    AppState.questionBank = [mk('t0', 1100), mk('t1', 1200), mk('t2', 1300)];
    AppState.currentSubject = 'physics';
    AppState.currentChapter = 'Thermo';
    AppState.currentChapterSelection = null;
    AppState.elo = { physics: 1200, chemistry: 1200, maths: 1200, global: 1200 };
    AppState.practiceFlowMode = 'standard';
    AppState.flowSlider = 72;
    AppState.flowSliderVisible = false;
    AppState._pqServedMode = 'standard';
    AppState._flowSessionActive = false;
    AppState.practiceQuestions = [];
    AppState.practiceSubmittedFlags = [];
    AppState.currentPracticeIndex = 0;

    ok(AppState.flowSliderVisible === false, 'live dock preference defaults to hidden');
    ok(globalThis.__getFlowSliderState().visible === false, 'state snapshot reports hidden');
    ok(typeof globalThis.toggleFlowSliderVisibility === 'function', 'top-right toggle exposed');
    const dock = document.getElementById('flow-slider-dock');
    const btn = document.getElementById('flow-slider-toggle');
    ok(!dock.classList.contains('is-visible'), 'dock starts without is-visible');

    globalThis.startFlowPractice();
    ok(!dock.classList.contains('is-visible'), 'entering Flow does not auto-show the dock');
    ok(btn.getAttribute('aria-pressed') === 'false', 'toggle starts unpressed');
    ok(btn.getAttribute('aria-label') === 'Show intensity slider', 'toggle label invites showing');

    globalThis.toggleFlowSliderVisibility();
    ok(AppState.flowSliderVisible === true, 'toggle opts into visibility');
    ok(globalThis.__getFlowSliderState().visible === true, 'state snapshot reports visible');
    ok(dock.classList.contains('is-visible'), 'toggle reveals the dock');
    ok(btn.getAttribute('aria-pressed') === 'true', 'toggle reports pressed');
    ok(btn.getAttribute('aria-label') === 'Hide intensity slider', 'toggle label offers hiding');

    // The choice survives a refuel (Continue / skip path calls _serveModeEntry).
    globalThis.continuePractice();
    ok(dock.classList.contains('is-visible'), 'dock stays visible across Continue');
    ok(AppState.practiceFlowMode === 'flow', 'Continue still advances while the dock is open');

    globalThis.toggleFlowSliderVisibility();
    ok(AppState.flowSliderVisible === false, 'toggle hides again');
    ok(!dock.classList.contains('is-visible'), 'dock hides');
    ok(btn.getAttribute('aria-pressed') === 'false', 'toggle reports unpressed again');
}

console.log('\nAll flow-slider assertions passed (' + passed + ' checks).');
process.exit(0);
