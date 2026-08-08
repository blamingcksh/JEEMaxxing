// Smoke test — Flow State / Hardcore practice-mode Prev/Next navigation.
// Imports the REAL app.js (with stubbed browser globals + an ESM loader that
// short-circuits the https esm.sh import in leaderboard.js) and drives the
// real practiceNext() / practicePrev() through a real mode entry, asserting:
//   • Next always serves a genuinely fresh question (never repeats)
//   • Prev reviews previously served questions (browser-style back stack)
//   • Next re-advances through the forward stack after going back
//   • submitted flags are preserved across navigation
//   • exhausting the eligible pool exits the mode gracefully
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

const currentId = () => {
    const q = AppState.practiceQuestions[AppState.currentPracticeIndex];
    return q && q.id;
};
const currentSubmitted = () => AppState.practiceSubmittedFlags[AppState.currentPracticeIndex];

console.log('── Flow State: Next serves fresh questions, Prev reviews ──');
{
    seedBank(4, 'physics', 'Thermo', 920, 1200);
    globalThis.startFlowPractice();
    ok(AppState.practiceFlowMode === 'flow', 'startFlowPractice activates flow mode');
    ok(AppState.practiceQuestions.length === 1, 'mode keeps a single-question pool');

    const served = [currentId()];
    practiceNext(); served.push(currentId());
    practiceNext(); served.push(currentId());
    ok(new Set(served).size === 3, 'three Next taps serve three distinct questions (no repeats)');

    const q3 = served[2], q2 = served[1], q1 = served[0];
    practicePrev();
    ok(currentId() === q2, 'Prev reviews the previously served question');
    practicePrev();
    ok(currentId() === q1, 'Prev walks back to the first question');
    practicePrev();
    ok(currentId() === q1, 'Prev at the start of the run is a safe no-op');

    practiceNext();
    ok(currentId() === q2, 'Next replays the forward stack (back to q2)');
    practiceNext();
    ok(currentId() === q3, 'Next replays the forward stack (back to q3)');
    practiceNext();
    ok(currentId() === 'q3', 'Next drains the forward stack then serves a fresh 4th question');
    ok(new Set(served.concat(currentId())).size === 4, 'all four questions in the run are distinct');

    practiceNext();
    ok(AppState.practiceFlowMode === 'standard', 'exhausting the eligible pool exits the mode');
    ok(AppState.practiceQuestions.length === 0, 'queue is cleared on exhaustion');
}

console.log('── Flow State: submitted flags survive Prev/Next ──');
{
    seedBank(3, 'physics', 'Thermo', 920, 1200);
    globalThis.startFlowPractice();
    const q1 = currentId();
    practiceNext(); // q2
    ok(currentSubmitted() === false, 'fresh question starts unsubmitted');
    AppState.practiceSubmittedFlags[0] = true; // simulate "solved"
    practiceNext(); // q3
    practicePrev(); // back to q2
    ok(currentId() !== q1 && currentSubmitted() === true, 'Prev restores the submitted flag for review');
    practiceNext(); // forward replay → q3
    ok(currentSubmitted() === false, 'forward replay restores q3 as unsubmitted');
}

console.log('── Hardcore: same navigation contract ──');
{
    seedBank(3, 'physics', 'Thermo', 1850, 1850);
    globalThis.startHardcorePractice();
    ok(AppState.practiceFlowMode === 'hardcore', 'startHardcorePractice activates hardcore mode');
    const q1 = currentId();
    practiceNext();
    ok(currentId() !== q1, 'Hardcore Next serves a different question');
    practicePrev();
    ok(currentId() === q1, 'Hardcore Prev reviews the previous question');
    practiceNext();
    ok(currentId() !== q1, 'Hardcore Next re-advances after Prev');
    practiceNext();
    ok(currentId() === 'q2', 'Hardcore drains the pool to the last question');
    practiceNext();
    ok(AppState.practiceFlowMode === 'standard', 'Hardcore exits gracefully when the pool is empty');
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

console.log('\nAll practice-nav assertions passed (' + passed + ' checks).');
// Boot machinery (KaTeX watchdog, coalesced-save timers, …) keeps the event
// loop alive in a stub environment — exit explicitly. Failures above throw
// and crash with a nonzero code before this line runs.
process.exit(0);
