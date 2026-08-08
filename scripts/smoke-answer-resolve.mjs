// Smoke test — MCQ correct-answer → option-letter resolution (Node, no browser).
// Imports the REAL matrix.js (with stubbed browser globals) and drives the
// exported resolveMcqCorrectLetters() across the answer shapes that actually
// arrive from the Gemini-imported question bank, asserting:
//   • bare letters ("B"), letter lists ("B, C", "B and C"), compact ("AB")
//   • full-option-string answers ("B) \frac{I}{4}") resolve to the leading letter
//   • prose / LaTeX that merely CONTAINS A-D chars never lights up stray options
//   • resolved letters are validated against the question's option count
//   • null / no-options answers never resolve (free-text part labels stay safe)
//
// Run: node scripts/smoke-answer-resolve.mjs

import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

// ── Browser-global stubs (mirror the smoke-practice-nav pattern — matrix.js
// only imports from storage.js, no esm.sh dependency, so no loader needed) ──
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

const { resolveMcqCorrectLetters } = await import(pathToFileURL(path.join(ROOT, 'matrix.js')).href);

let passed = 0;
function ok(cond, msg) {
    assert.ok(cond, msg);
    passed++;
    console.log('  ✓ ' + msg);
}
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const q4 = (answer) => ({ correctAnswer: answer, options: ['A) one', 'B) two', 'C) three', 'D) four'] });

console.log('── Bare letters & letter lists ──');
ok(deepEq(resolveMcqCorrectLetters(q4('B')), ['B']), '"B" → [B]');
ok(deepEq(resolveMcqCorrectLetters(q4('b')), ['B']), 'lowercase "b" → [B]');
ok(deepEq(resolveMcqCorrectLetters(q4('B, C')), ['B', 'C']), '"B, C" → [B, C]');
ok(deepEq(resolveMcqCorrectLetters(q4('B C')), ['B', 'C']), '"B C" → [B, C]');
ok(deepEq(resolveMcqCorrectLetters(q4('B and C')), ['B', 'C']), '"B and C" → [B, C]');
ok(deepEq(resolveMcqCorrectLetters(q4('AB')), ['A', 'B']), 'compact "AB" → [A, B]');
ok(deepEq(resolveMcqCorrectLetters(q4('ACD')), ['A', 'C', 'D']), 'compact "ACD" → [A, C, D]');

console.log('── Full-option-string answers resolve to the leading letter ──');
ok(deepEq(resolveMcqCorrectLetters(q4('B) \\frac{I}{4}')), ['B']),
    '"B) \\frac{I}{4}" → [B] (the I inside LaTeX is not option 8)');
ok(deepEq(resolveMcqCorrectLetters(q4('(C) v = u + at')), ['C']), '"(C) v = u + at" → [C]');
ok(deepEq(resolveMcqCorrectLetters(q4('D. 3.14')), ['D']), '"D. 3.14" → [D]');
ok(deepEq(resolveMcqCorrectLetters(q4('B: x^2')), ['B']), '"B: x^2" → [B]');

console.log('── Prose / LaTeX containing A-D chars must NOT light up stray options ──');
ok(deepEq(resolveMcqCorrectLetters(q4('\\frac{I}{4}')), []),
    '"\\frac{I}{4}" alone → [] (no option text matches, no stray letters)');
ok(deepEq(resolveMcqCorrectLetters(q4('Towards the centre')), []),
    'prose containing a+d → [] (never A,D)');
ok(deepEq(resolveMcqCorrectLetters({ correctAnswer: '1/2', options: ['A) 1/2', 'B) 1/4', 'C) 3/4', 'D) 1'] }), ['A']),
    'exact option-text match → [A]');

console.log('── Array-form answers ──');
ok(deepEq(resolveMcqCorrectLetters({ correctAnswer: ['B', 'C'], options: ['x', 'y', 'z', 'w'] }), ['B', 'C']),
    '["B", "C"] → [B, C]');
ok(deepEq(resolveMcqCorrectLetters({ correctAnswer: ['B) p', 'C) q'], options: ['x', 'y', 'z', 'w'] }), ['B', 'C']),
    '["B) p", "C) q"] → [B, C]');
ok(deepEq(resolveMcqCorrectLetters({ correctAnswer: ['B)', 'C)'], options: ['x', 'y', 'z', 'w'] }), ['B', 'C']),
    '["B)", "C)"] bare-prefix entries → [B, C]');

console.log('── Option-count validation & null safety ──');
ok(deepEq(resolveMcqCorrectLetters({ correctAnswer: 'B', options: ['only'] }), []),
    '"B" on a 1-option question → [] (no such index)');
ok(deepEq(resolveMcqCorrectLetters({ correctAnswer: 'I', options: ['A) P', 'B) Q', 'C) R', 'D) S'] }), []),
    'stray letter not in option range → []');
ok(deepEq(resolveMcqCorrectLetters({ correctAnswer: '(a) free text', options: [] }), []),
    'free-text part labels with NO options → [] (never resolves to A)');
ok(deepEq(resolveMcqCorrectLetters({ correctAnswer: null, options: ['A)', 'B)'] }), []),
    'null answer → []');
ok(deepEq(resolveMcqCorrectLetters(null), []), 'null question → []');
ok(deepEq(resolveMcqCorrectLetters({ correctAnswer: '   ', options: ['A)', 'B)'] }), []),
    'whitespace-only answer → []');

console.log('\nAll answer-resolution assertions passed (' + passed + ' checks).');
process.exit(0);
