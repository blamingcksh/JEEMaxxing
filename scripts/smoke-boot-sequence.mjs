// Smoke test — daily mood check popup (Node, no browser).
// Stubs browser globals, imports the REAL boot-sequence.js, and verifies:
//   • overlay mounts once per day
//   • guard key is only written on finish (skip counts as seen)
//   • skip() tears the overlay down cleanly
//   • same-day re-show is blocked by the guard
//   • a mood pick calls calibrateMood and closes the popup
//
// Run: node scripts/smoke-boot-sequence.mjs

// ---- localStorage stub ----
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};

// ---- fake element factory ----
function fakeEl(tag = 'div') {
    const el = {
        tag, className: '', id: '', textContent: '',
        style: {}, parentNode: null, children: [], focusCount: 0,
        classList: {
            _set: new Set(),
            add(c) { this._set.add(c); },
            remove(c) { this._set.delete(c); },
            toggle(c, force) {
                if (force === undefined) {
                    if (this._set.has(c)) { this._set.delete(c); return false; }
                    this._set.add(c); return true;
                }
                if (force) this._set.add(c); else this._set.delete(c);
                return !!force;
            },
            contains(c) { return this._set.has(c); },
        },
        setAttribute() {},
        focus() { this.focusCount++; },
        addEventListener() {},
        appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
        removeChild(c) {
            const i = this.children.indexOf(c);
            if (i >= 0) this.children.splice(i, 1);
            c.parentNode = null;
            return c;
        },
        querySelector(sel) {
            this._qs = this._qs || new Map();
            if (!this._qs.has(sel)) this._qs.set(sel, fakeEl());
            return this._qs.get(sel);
        },
    };
    // Real-DOM semantics: assigning innerHTML replaces all children.
    Object.defineProperty(el, 'innerHTML', {
        get() { return this._html || ''; },
        set(v) { this._html = v; this.children.length = 0; },
    });
    return el;
}

const body = fakeEl('body');
const head = fakeEl('head');
const created = [];
globalThis.document = {
    body,
    head,
    createElement(tag) { const e = fakeEl(tag); created.push(e); return e; },
    getElementById() { return null; },
    querySelector() { return null; },
    addEventListener() {},
    removeEventListener() {},
};
globalThis.window = globalThis;

await import('../boot-sequence.js');

let pass = 0, fail = 0;
function assert(cond, name) {
    if (cond) { pass++; console.log('  ✔', name); }
    else { fail++; console.error('  ✘', name); }
}

const BS = window.BootSequence;
const today = BS._test.todayKey();

// 1. Public surface
assert(BS && typeof BS.maybeShow === 'function' && typeof BS.skip === 'function',
    'window.BootSequence exposes maybeShow + skip');

// 2. First show mounts the overlay
BS.maybeShow();
assert(body.children.length === 1, 'maybeShow() mounts the overlay');
assert(body.children[0].className === 'bootseq', 'overlay has bootseq class');
assert(BS._test.isActive === true, 'isActive flips on while mounted');
assert(localStorage.getItem(BS._test.lsKey) === null, 'guard key NOT written before finish');

// 3. Double-invocation while active does not stack a second overlay
BS.maybeShow();
assert(body.children.length === 1, 'second maybeShow() while active is a no-op');

// 4. Styles injected once
assert(created.some(e => e.tag === 'style' && e.id === 'boot-seq-styles'), 'runtime <style> injected');
assert(head.children.length === 1, 'style appended to <head> exactly once');

// 5. skip() tears down + writes the daily guard
BS.skip();
assert(body.children.length === 0, 'skip() removes the overlay');
assert(BS._test.isActive === false, 'isActive flips off after finish');
assert(localStorage.getItem(BS._test.lsKey) === today, 'skip() writes today\'s guard key');

// 6. Same-day re-show is blocked
BS.maybeShow();
assert(body.children.length === 0, 'same-day re-show blocked by guard');

// 7. Forced day change allows the flow again (next-day simulation)
store.set(BS._test.lsKey, '2000-01-01');
BS.maybeShow();
assert(body.children.length === 1, 'next-day simulation re-shows the overlay');
BS.skip();
assert(body.children.length === 0 && localStorage.getItem(BS._test.lsKey) === today,
    'second finish cleanly resets guard to today');

// 8. Conflicting overlay defers (Night Guard active) instead of stacking
store.set(BS._test.lsKey, '2000-01-01');
const ngModal = fakeEl('div');
document.getElementById = (id) => (id === 'nightguard-modal' ? ngModal : null);
ngModal.classList.add('active');
BS.maybeShow();
assert(body.children.length === 0, 'defers while Night Guard modal owns the screen');
ngModal.classList.remove('active');
BS.skip(); // clear the pending retry timer

// 9. Mood pick via keyboard: calibrateMood called, popup closes, guard written
store.set(BS._test.lsKey, '2000-01-01');
document.getElementById = () => null; // no Night Guard conflict now
const moodCalls = [];
window.calibrateMood = (m) => moodCalls.push(m);
BS.maybeShow();
BS._test.press('2');
assert(moodCalls.length === 1 && moodCalls[0] === 'neutral', 'key 2 calls calibrateMood("neutral")');
assert(body.children.length === 0, 'popup closed after mood pick');
assert(localStorage.getItem(BS._test.lsKey) === today, 'guard written on mood pick');

// 10. Undismissable: ESC does nothing, guard stays unwritten, mood untouched
store.set(BS._test.lsKey, '2000-01-01');
BS.maybeShow();
BS._test.press('Escape');
assert(body.children.length === 1, 'Escape does NOT close the popup');
assert(BS._test.isActive === true, 'popup stays active after Escape');
assert(localStorage.getItem(BS._test.lsKey) !== today, 'Escape does NOT write the guard');
assert(moodCalls.length === 1, 'Escape does NOT call calibrateMood');
assert(!body.children[0]._html || !/moodpop-skip|moodpop-close/.test(body.children[0]._html),
    'no skip/close affordances rendered');
BS.skip(); // QA escape hatch — clean up for the next scenario

// 11. Remaining mood keys map correctly
store.set(BS._test.lsKey, '2000-01-01');
BS.maybeShow();
BS._test.press('1');
assert(moodCalls.length === 2 && moodCalls[1] === 'sad', 'key 1 calls calibrateMood("sad")');

store.set(BS._test.lsKey, '2000-01-01');
BS.maybeShow();
BS._test.press('3');
assert(moodCalls.length === 3 && moodCalls[2] === 'happy', 'key 3 calls calibrateMood("happy")');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
