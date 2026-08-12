// Smoke test — Flow State / Hardcore adaptive practice (Skip + Continue).
// Imports the REAL app.js (with stubbed browser globals + an ESM loader that
// short-circuits the https esm.sh import in leaderboard.js) and drives the
// real mode entry points, asserting:
//   • Next/Prev are no-ops inside a mode (advancement is Skip / Continue)
//   • Continue serves genuinely fresh, never-repeated questions
//   • exhausting the eligible pool exits the mode gracefully
//   • Skip is no-regret: no Elo/qElo/solveCount/status/time mutation
//   • Skip reason tunes the next pick ("too easy" → harder next)
//   • "already know" retires a question from future mode picks
//   • Hardcore keeps the ≥1800 floor; Flow/Hardcore pick different questions
//   • standard practice Prev/Next navigation is untouched
//
// Run: node scripts/smoke-practice-nav.mjs

import assert from 'node:assert';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
await register(path.join(HERE, 'loaders', 'esm-sh-stub.mjs'), import.meta.url);

// ── Browser-global stubs (mirror the smoke-boot-sequence pattern) ───────────
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
globalThis.setInterval = () => Symbol('interval'); // no-op: timers are not needed
globalThis.clearInterval = () => {};
globalThis.alert = () => {};
globalThis.confirm = () => false;
globalThis.Image = class { set src(_) {} };
// The CK engine's boot touches stub DOM nodes at module eval and logs its own
// caught errors — harmless noise, filter it so real failures stay visible.
const _origError = console.error;
console.error = (...args) => {
    if (String(args[0] || '').startsWith('[CK engine tick]')) return;
    _origError(...args);
};

const localStorageStore = new Map();
globalThis.localStorage = {
    getItem: (k) => (localStorageStore.has(k) ? localStorageStore.get(k) : null),
    setItem: (k, v) => localStorageStore.set(k, String(v)),
    removeItem: (k) => localStorageStore.delete(k),
};

const ctx2d = new Proxy({}, { get: () => () => {} });
function fakeEl(tag) {
    const el = {
        tagName: String(tag || 'div').toUpperCase(),
        nodeType: 1, nodeValue: null, parentNode: null, children: [], childNodes: [],
        style: {
            setProperty() {}, getPropertyValue: () => '', removeProperty() {},
        },
        dataset: {}, textContent: '', innerText: '', scrollTop: 0, value: '',
        classList: {
            add() {}, remove() {}, toggle() {}, contains: () => false,
        },
        setAttribute() {}, hasAttribute: () => false, removeAttribute() {},
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

// ── Import the real modules (the same instances app.js binds to) ────────────
const { AppState } = await import(pathToFileURL(path.join(ROOT, 'storage.js')).href);
const appMod = await import(pathToFileURL(path.join(ROOT, 'app.js')).href);
const { practiceNext, practicePrev } = appMod;

let passed = 0;
function ok(cond, msg) {
    assert.ok(cond, msg);
    passed++;
    console.log('  ✓ ' + msg);
}

function seedBank(n, subject, chapter, baseElo, userElo) {
    AppState.questionBank = [];
    for (let i = 0; i < n; i++) {
        AppState.questionBank.push({
            id: 'q' + i, subject, chapter, status: 'unsolved', type: 'mcq',
            options: ['A', 'B', 'C', 'D'], correctAnswer: 'A',
            qElo: baseElo + i * 10, extractedText: 'Question ' + i,
        });
    }
    AppState.currentSubject = subject;
    AppState.currentChapter = chapter;
    AppState.elo = { physics: userElo, chemistry: userElo, maths: userElo, global: userElo };
    AppState.practiceFlowMode = 'standard';
    AppState.practiceQuestions = [];
    AppState.practiceSubmittedFlags = [];
    AppState.currentPracticeIndex = 0;
    AppState.practiceSeconds = 0;
    AppState.practiceTimer = null;
    AppState.hardcoreDailyCount = 0;
    AppState.hardcoreDailyDate = null;
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
const currentSubmitted = () => AppState.practiceSubmittedFlags[AppState.currentPracticeIndex];

console.log('── Flow mode: Next/Prev no-ops; Continue advances ──');
{
    seedBank(0, 'physics', 'Thermo', 0, 1200);
    AppState.questionBank = [mk('f0', 1000), mk('f1', 1010), mk('f2', 1020), mk('f3', 1030)];
    globalThis.startFlowPractice();
    const q1 = currentId();
    ok(AppState.practiceFlowMode === 'flow', 'startFlowPractice activates flow mode');
    ok(AppState.practiceQuestions.length === 1, 'mode keeps a single-question pool');

    practiceNext();
    ok(currentId() === q1, 'Next is a no-op in Flow mode');
    practicePrev();
    ok(currentId() === q1, 'Prev is a no-op in Flow mode');

    globalThis.continuePractice();
    const q2 = currentId();
    ok(q2 !== q1, 'Continue serves a fresh question');
    globalThis.continuePractice();
    const q3 = currentId();
    ok(q3 !== q1 && q3 !== q2, 'Continue never re-serves an earlier question');
    globalThis.continuePractice();
    ok(currentId() !== q1 && currentId() !== q2 && currentId() !== q3, 'Continue drains all four questions');
    ok(AppState.practiceFlowMode === 'flow', 'Continue keeps Flow mode active');

    globalThis.continuePractice();
    ok(AppState.practiceFlowMode === 'standard', 'exhausting the pool exits the mode');
    ok(AppState.practiceQuestions.length === 0, 'queue is cleared on exhaustion');
}

console.log('── Flow mode: Skip is no-regret and advances ──');
{
    seedBank(0, 'physics', 'Thermo', 0, 1200);
    AppState.questionBank = [mk('s0', 1300), mk('s1', 1320), mk('s2', 1340)];
    globalThis.startFlowPractice();
    const q0 = currentId();
    const q0Obj = AppState.practiceQuestions[0];
    const eloBefore = AppState.elo.physics;
    const globalBefore = AppState.elo.global;

    globalThis.skipQuestion('too hard');

    ok(currentId() !== q0, 'Skip advances to a fresh question');
    ok(AppState.practiceFlowMode === 'flow', 'Skip keeps Flow mode active');
    ok(q0Obj.status === 'unsolved', 'Skip does not change status');
    ok((q0Obj.solveCount || 0) === 0, 'Skip does not increment solveCount');
    ok(q0Obj.qElo === 1300, 'Skip does not drift qElo');
    ok((q0Obj.skips || 0) === 1, 'Skip stamps skips=1');
    ok(Array.isArray(q0Obj.skipReasons) && q0Obj.skipReasons.includes('too hard'), 'Skip records the reason');
    ok(AppState.elo.physics === eloBefore && AppState.elo.global === globalBefore, 'Skip does not change Elo');
    ok(q0Obj.lastReviewedAt === undefined && q0Obj.timeTaken === undefined && !q0Obj.firstAttemptResult, 'Skip leaves review/time/attempt untouched');
}

console.log('── Flow mode: Skip "too easy" serves a harder next question ──');
{
    seedBank(0, 'physics', 'Thermo', 0, 1200);
    AppState.questionBank = [mk('e0', 1000), mk('e1', 1300), mk('e2', 1600), mk('e3', 1900)];
    globalThis.startFlowPractice();
    const first = AppState.practiceQuestions[0];
    ok(first.id === 'e0', 'Flow starts on the easiest question (got ' + first.id + ')');
    globalThis.skipQuestion('too easy');
    const next = AppState.practiceQuestions[0];
    ok(next.id !== 'e0', 'Skip advances past the skipped question');
    ok(next.qElo > first.qElo, 'Skip "too easy" serves a harder next question (' + next.qElo + ' > ' + first.qElo + ')');
}

console.log('── Flow mode: "already know" retires the question from mode picks ──');
{
    seedBank(0, 'physics', 'Thermo', 0, 1200);
    AppState.questionBank = [mk('k0', 1000), mk('k1', 1300), mk('k2', 1600)];
    globalThis.startFlowPractice();
    const q0 = AppState.practiceQuestions[0];
    globalThis.skipQuestion('already know');
    ok(q0.modeRetired === true, '"already know" sets modeRetired');
    ok(q0.status === 'unsolved' && (q0.solveCount || 0) === 0, 'retired-but-unattempted question is otherwise untouched');

    globalThis.exitPracticeMode();
    globalThis.startFlowPractice();
    const firstAgain = AppState.practiceQuestions[0];
    ok(firstAgain.id !== 'k0', 'a modeRetired question is never re-served (got ' + firstAgain.id + ')');
}

console.log('── Hardcore: ≥1800 floor enforced + Continue advances ──');
{
    seedBank(0, 'physics', 'Thermo', 0, 1200);
    AppState.questionBank = [mk('h0', 1850), mk('h1', 1900), mk('h2', 1950)];
    globalThis.startHardcorePractice();
    ok(AppState.practiceFlowMode === 'hardcore', 'startHardcorePractice activates hardcore mode');
    const hElo = AppState.practiceQuestions[0] && AppState.practiceQuestions[0].qElo;
    ok(hElo >= 1800, 'Hardcore serves a ≥1800 question (got ' + hElo + ')');
    const q1 = currentId();
    globalThis.continuePractice();
    ok(currentId() !== q1, 'Hardcore Continue serves a different question');
    ok(AppState.practiceFlowMode === 'hardcore', 'Hardcore Continue keeps mode active');
}

console.log('── Standard practice: classic index navigation is untouched ──');
{
    seedBank(0, 'physics', 'Thermo', 920, 1200); // clear mode state
    AppState.practiceFlowMode = 'standard';
    const qs = [0, 1, 2].map(i => ({
        id: 's' + i, subject: 'physics', chapter: 'Thermo', status: 'unsolved', type: 'mcq',
        options: ['A', 'B', 'C', 'D'], correctAnswer: 'A', qElo: 1200, extractedText: 'S' + i,
    }));
    appMod.startPracticeWithQuestion(qs, 0);
    ok(AppState.practiceFlowMode === 'standard', 'standard session does not enter a mode');
    ok(currentId() === 's0', 'standard session starts at the given index');
    practiceNext();
    ok(currentId() === 's1', 'standard Next advances the index');
    practiceNext();
    ok(currentId() === 's2', 'standard Next advances to the last question');
    practicePrev();
    ok(currentId() === 's1', 'standard Prev walks back one');
    practicePrev();
    practicePrev();
    ok(currentId() === 's0', 'standard Prev clamps at the first question');
    practiceNext();
    practiceNext();
    practiceNext();
    ok(AppState.practiceQuestions.length === 3 && AppState.practiceFlowMode === 'standard',
        'standard end-of-queue closes without mode interference');
}

console.log('── Flow vs Hardcore serve DIFFERENT questions (hardcore floor) ──');
{
    const mixed = [
        mk('e0', 1200), mk('e1', 1250), mk('e2', 1300),
        mk('h0', 1900), mk('h1', 1950), mk('h2', 2000),
    ];

    seedBank(0, 'physics', 'Thermo', 0, 1200);
    AppState.questionBank = mixed.slice();
    globalThis.startFlowPractice();
    const flowPick = currentId();
    const flowElo = AppState.practiceQuestions[0] && AppState.practiceQuestions[0].qElo;
    ok(AppState.practiceFlowMode === 'flow', 'Flow activates on a mixed chapter');
    ok(flowElo < 1800, 'Flow serves a non-hardcore question (got ' + flowElo + ')');

    seedBank(0, 'physics', 'Thermo', 0, 1200);
    AppState.questionBank = mixed.slice();
    globalThis.startHardcorePractice();
    const hardPick = currentId();
    const hardElo = AppState.practiceQuestions[0] && AppState.practiceQuestions[0].qElo;
    ok(AppState.practiceFlowMode === 'hardcore', 'Hardcore activates on a mixed chapter');
    ok(hardElo >= 1800, 'Hardcore serves a ≥1800 question (got ' + hardElo + ')');
    ok(hardPick !== flowPick, 'Flow and Hardcore do NOT serve the same question (' + flowPick + ' vs ' + hardPick + ')');
}

console.log('\nAll practice-nav assertions passed (' + passed + ' checks).');
// Boot machinery (KaTeX watchdog, coalesced-save timers, …) keeps the event
// loop alive in a stub environment — exit explicitly. Failures above throw
// and crash with a nonzero code before this line runs.
process.exit(0);
