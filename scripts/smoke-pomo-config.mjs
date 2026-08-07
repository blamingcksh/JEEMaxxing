// Smoke test — P1 pomodoro config persistence (Node, no browser).
// Stubs browser globals minimally, imports the REAL pomodoro.js, and
// round-trips savePomoConfig → readPomoConfig → applyPomoConfig.
//
// Run: node scripts/smoke-pomo-config.mjs

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};

const elements = new Map();
function fakeEl(init = {}) {
    const el = {
        textContent: '', disabled: false,
        style: {},
        // Tracked classList so 'on'-state assertions actually verify toggles.
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
        ...init,
    };
    // Real DOM inputs coerce every assignment to a string.
    let _value = el.value == null ? '' : String(el.value);
    Object.defineProperty(el, 'value', {
        get() { return _value; },
        set(v) { _value = String(v); },
    });
    return el;
}
['pomo-study', 'pomo-break', 'pomo-sessions', 'pomo-subject',
 'mini-subject', 'timer-status', 'stopwatch-toggle-btn', 'dynamic-subject-btn',
 'question-filter', 'timer-notify-modal', 'pomo-mini-widget', 'btn-start',
 'btn-pause', 'btn-quit', 'break-actions', 'pomo-progress', 'pomo-beaker-fill',
 'timer-display']
    .forEach(id => elements.set(id, fakeEl()));

globalThis.document = {
    addEventListener() {},
    getElementById(id) { return elements.get(id) || null; },
    querySelectorAll() { return []; },
    body: null,
    createElement() { return fakeEl(); },
};
globalThis.window = globalThis;

const pomo = await import('../pomodoro.js');

let pass = 0, fail = 0;
function assert(cond, name) {
    if (cond) { pass++; console.log('  ✔', name); }
    else { fail++; console.error('  ✘', name); }
}

// 1. Nothing stored → null / false
assert(pomo.readPomoConfig() === null, 'readPomoConfig() → null when nothing stored');
assert(pomo.applyPomoConfig() === false, 'applyPomoConfig() → false when nothing stored');

// 2. Corrupt payload → null
localStorage.setItem('jeemax_pomo_config', '{not json');
assert(pomo.readPomoConfig() === null, 'corrupt JSON → null');

// 3. Sanitization of a hostile payload
localStorage.setItem('jeemax_pomo_config', JSON.stringify({
    subject: 'astrophysics', study: 0, break: 0, sessions: 999, stopwatch: 1, dynamic: 'yes',
}));
const sanitized = pomo.readPomoConfig();
assert(sanitized.subject === 'physics', 'invalid subject → physics');
assert(sanitized.study === 50, 'study 0 → default 50');
assert(sanitized.break === 10, 'break 0 → default 10');
assert(sanitized.sessions === 999, 'sessions 999 kept (positive)');
assert(sanitized.stopwatch === true, 'stopwatch coerced to boolean');
assert(sanitized.dynamic === true, 'dynamic coerced to boolean');

// 4. Round trip: simulate a session start, then restore
elements.get('pomo-subject').value = 'chemistry';
elements.get('pomo-study').value = '45';
elements.get('pomo-break').value = '7';
elements.get('pomo-sessions').value = '3';
pomo.changeStudySubject();          // sync module studySubject to the select
pomo.savePomoConfig();

const saved = JSON.parse(localStorage.getItem('jeemax_pomo_config'));
assert(saved.subject === 'chemistry' && saved.study === 45 && saved.break === 7 && saved.sessions === 3,
    'savePomoConfig() persisted {chemistry, 45, 7, 3}');
assert(pomo.readPomoConfig().subject === 'chemistry', 'readPomoConfig() → saved subject');

// 5. applyPomoConfig writes the inputs back (stopwatch/dynamic both off in
//    this stored config, so no toggle-UI paths are exercised)
elements.get('pomo-subject').value = 'physics';
elements.get('pomo-study').value = '50';
pomo.applyPomoConfig();
assert(elements.get('pomo-subject').value === 'chemistry', 'applyPomoConfig() restores subject select');
assert(elements.get('pomo-study').value === '45', 'applyPomoConfig() restores study input');
assert(elements.get('pomo-break').value === '7', 'applyPomoConfig() restores break input');
assert(elements.get('pomo-sessions').value === '3', 'applyPomoConfig() restores sessions input');

// 6. window.__pomodoro.getConfig() bridge
assert(globalThis.__pomodoro.getConfig().subject === 'chemistry',
    'window.__pomodoro.getConfig() bridge works');

// 7. Stopwatch + dynamic restore paths (the toggle-UI side-effect paths)
elements.get('pomo-subject').value = 'maths';
pomo.changeStudySubject();           // studySubject → 'maths'
elements.get('pomo-study').value = '25';
elements.get('pomo-break').value = '5';
elements.get('pomo-sessions').value = '2';
pomo.toggleStopwatchMode();          // ON (runs resetPomoUI internally)
pomo.toggleDynamicSubject();         // ON
pomo.savePomoConfig();               // stored {maths, 25, 5, 2, stopwatch:true, dynamic:true}

// Flip the modes OFF so module state diverges from the stored config — exactly
// the "boot restore" condition applyPomoConfig() is built for.
pomo.toggleStopwatchMode();          // OFF
pomo.toggleDynamicSubject();         // OFF
const swBtn = elements.get('stopwatch-toggle-btn');
const dynBtn = elements.get('dynamic-subject-btn');
swBtn.textContent = 'Off';
dynBtn.classList.remove('on');
elements.get('pomo-subject').value = 'physics';
elements.get('pomo-study').value = '50';
elements.get('pomo-break').value = '10';
elements.get('pomo-sessions').value = '1';

pomo.applyPomoConfig();
assert(elements.get('pomo-subject').value === 'maths', 'applyPomoConfig() restores subject (stopwatch path)');
assert(elements.get('pomo-study').value === '25', 'applyPomoConfig() restores study (stopwatch path)');
assert(swBtn.textContent === 'On', 'applyPomoConfig() flips stopwatch button back to On');
assert(dynBtn.classList.contains('on'), 'applyPomoConfig() restores dynamic-mode button');
assert(pomo.readPomoConfig().stopwatch === true && pomo.readPomoConfig().dynamic === true,
    'saved config kept stopwatch+dynamic');

console.log(`\n${pass} passed, ${fail} failed`);
// Imported app modules may leave retry timers on the event loop; exit explicitly.
process.exit(fail ? 1 : 0);
