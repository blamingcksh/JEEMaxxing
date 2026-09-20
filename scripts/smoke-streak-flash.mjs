// Smoke test — streak badge flash window (Flow State / Hardcore practice).
// Imports the REAL app.js with stubbed browser globals (same pattern as
// smoke-practice-nav.mjs) and drives real graded answers, asserting:
//   • the HUD streak badge is hidden before any answer
//   • a graded answer reveals it (.streak-flash on #streak-visualizer)
//   • the reveal auto-hides after 10000ms
//   • a second answer restarts the window instead of stacking timers
// Timers are faked so the 10s window is verified deterministically.
//
// Run: node scripts/smoke-streak-flash.mjs

import assert from 'node:assert';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
await register(pathToFileURL(path.join(HERE, 'loaders', 'esm-sh-stub.mjs')).href, import.meta.url);

// ── Fake timers: nothing fires unless the test fires it ─────────────────────
const pending = new Map(); // handle -> { fn, delay }
let nextHandle = 1;
globalThis.setTimeout = (fn, delay) => { const h = nextHandle++; pending.set(h, { fn, delay }); return h; };
globalThis.clearTimeout = (h) => { pending.delete(h); };
globalThis.setInterval = () => nextHandle++;
globalThis.clearInterval = () => {};

// ── Browser-global stubs (mirror smoke-practice-nav.mjs) ────────────────────
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
globalThis.alert = () => {};
globalThis.confirm = () => false;
globalThis.Image = class { set src(_) {} };
// Silence the storage layer's unhandled IndexedDB rejection under the stub DOM.
process.on('unhandledRejection', () => {});

const localStorageStore = new Map();
globalThis.localStorage = {
    getItem: (k) => (localStorageStore.has(k) ? localStorageStore.get(k) : null),
    setItem: (k, v) => localStorageStore.set(k, String(v)),
    removeItem: (k) => localStorageStore.delete(k),
};

const ctx2d = new Proxy({}, { get: () => () => {} });
function fakeEl(tag) {
    const classes = new Set();
    const el = {
        tagName: String(tag || 'div').toUpperCase(),
        nodeType: 1, nodeValue: null, parentNode: null, children: [], childNodes: [],
        style: { setProperty() {}, getPropertyValue: () => '', removeProperty() {} },
        dataset: {}, textContent: '', innerText: '', scrollTop: 0, value: '',
        classList: {
            add: (...c) => c.forEach(x => classes.add(x)),
            remove: (...c) => c.forEach(x => classes.delete(x)),
            toggle: (c) => (classes.has(c) ? (classes.delete(c), false) : (classes.add(c), true)),
            contains: (c) => classes.has(c),
        },
        _attrs: {},
        setAttribute(k, v) { this._attrs[k] = String(v); },
        getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
        hasAttribute: (k) => k in this._attrs,
        removeAttribute(k) { delete this._attrs[k]; },
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

const { AppState } = await import(pathToFileURL(path.join(ROOT, 'storage.js')).href);
const appMod = await import(pathToFileURL(path.join(ROOT, 'app.js')).href);

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); }

const viz = document.getElementById('streak-visualizer');

function seedGradedQuestion(status) {
    AppState.practiceCorrectStreak = status === 'solved' ? 1 : 0;
    AppState.currentQ = {
        id: 'f0', subject: 'physics', chapter: 'Thermo', status, type: 'free_response',
        options: ['A', 'B', 'C', 'D'], correctAnswer: 'A', qElo: 1200,
        extractedText: 'Q', timeTaken: 0, solveCount: 0,
    };
    AppState.practiceQuestions = [AppState.currentQ];
    AppState.currentPracticeIndex = 0;
    AppState.practiceSubmittedFlags = [false];
}

// 1. Hidden before any answer — the CSS base rule owns visibility, JS only reveals.
ok(!viz.classList.contains('streak-flash'), 'streak badge hidden before any answer');

// 2. A graded answer reveals the badge and schedules its 10s hide.
seedGradedQuestion('unsolved');
pending.clear();
appMod.practiceSubmit();
ok(viz.classList.contains('streak-flash'), 'graded answer reveals the streak badge');
const flashHandle = [...pending.entries()].find(([, t]) => t.delay === 10000);
ok(!!flashHandle, 'auto-hide timer scheduled for 10000ms');

// 3. When that timer fires, the badge hides again.
flashHandle[1].fn();
ok(!viz.classList.contains('streak-flash'), 'badge hides when the 10s window lapses');

// 4. A second answer restarts the window — previous timer cleared, not stacked.
seedGradedQuestion('solved');
pending.clear();
appMod.practiceSubmit();
const firstHandle = [...pending.entries()].find(([, t]) => t.delay === 10000)[0];
appMod.practiceSubmit();
ok(!pending.has(firstHandle), 'second answer clears the pending 10s timer');
const second = [...pending.values()].filter(t => t.delay === 10000);
ok(second.length === 1 && viz.classList.contains('streak-flash'),
    'second answer schedules a fresh 10s window and keeps the badge visible');

console.log(`\nAll streak-flash assertions passed (${passed} checks).`);
process.exit(0);
