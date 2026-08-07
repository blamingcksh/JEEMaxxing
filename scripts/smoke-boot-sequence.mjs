// Smoke test — P2 boot-sequence skeleton (Node, no browser).
// Stubs browser globals, imports the REAL boot-sequence.js, and verifies:
//   • overlay mounts once per day
//   • guard key is only written on finish (SKIP counts as seen)
//   • skip() tears the overlay down cleanly
//   • same-day re-show is blocked by the guard
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

// 9. Step machine: boot → subject → mood → path → land
store.set(BS._test.lsKey, '2000-01-01');
document.getElementById = () => null; // no Night Guard conflict now
BS.maybeShow();
assert(BS._test.step === 'boot', 'starts on the boot step');
assert(body.children.length === 1, 'overlay mounted for the step machine');

BS._test.press('Enter');
assert(BS._test.step === 'subject', 'any key advances boot → subject');

BS._test.press('2');
assert(BS._test.ctx.subject === 'chemistry', 'number key 2 picks Chemistry');
assert(BS._test.step === 'mood', 'subject selection advances → mood');

const moodCalls = [];
window.calibrateMood = (m) => moodCalls.push(m);
BS._test.press('1');
assert(moodCalls.length === 1 && moodCalls[0] === 'sad', 'mood step calls calibrateMood("sad")');
assert(BS._test.ctx.mood === 'sad', 'ctx.mood recorded');
assert(BS._test.step === 'path', 'mood advances → path');

const tabCalls = [];
window.switchTab = (id) => tabCalls.push(id);
BS._test.press('1');
assert(BS._test.ctx.path === 'matrix', 'path choice 1 records Error Matrix');
assert(tabCalls.length === 1 && tabCalls[0] === 'errors', 'lands on the errors tab');
assert(body.children.length === 0, 'overlay closed after path choice');
assert(localStorage.getItem(BS._test.lsKey) === today, 'guard written on path finish');

// 10. Back navigation + ESC abort
store.set(BS._test.lsKey, '2000-01-01');
BS.maybeShow();
BS._test.press('Enter');      // boot → subject
BS._test.press('3');          // maths → mood
BS._test.press('Backspace');  // mood → subject
assert(BS._test.step === 'subject', 'Backspace goes back mood → subject');
assert(BS._test.ctx.subject === 'maths', 'ctx.subject preserved across back');
BS._test.press('Escape');
assert(body.children.length === 0, 'Escape aborts the whole briefing');
assert(localStorage.getItem(BS._test.lsKey) === today, 'Escape also writes the daily guard');

// 11. Full Question Bank path: pomodoro → chapter (weakest first) → mode → launch
window.AppState = {
    chapters: { physics: ['Kinematics', 'Thermo'], chemistry: ['Mole Concept'], maths: ['Calculus'] },
    questionBank: [
        // Thermo holds one genuinely untouched question → Flow/Hardcore stay
        // eligible for the physics arena in the scenarios below.
        { subject: 'physics', chapter: 'Thermo', status: 'unsolved' },
        { subject: 'physics', chapter: 'Kinematics', easeFactor: 2.5, status: 'solved' },
        { subject: 'physics', chapter: 'Kinematics', easeFactor: 2.5, status: 'solved' },
    ],
    hardcoreDailyDate: null,
    hardcoreDailyCount: 0,
    currentChapterQuestions: [],
};
// Same bridge matrix.js exposes — Thermo(10) weaker than Kinematics(71).
window.getChapterHealth = (subject, chapter) =>
    chapter === 'Thermo' ? 10 : (chapter === 'Kinematics' ? 71 : 50);
const launched = { flow: 0, hc: 0, std: 0, subject: null, chapter: null };
window.startFlowPractice = () => { launched.flow++; };
window.startHardcorePractice = () => { launched.hc++; };
window.startPracticeWithQuestion = (qs, idx) => { launched.std++; };
window.selectSubject = (s) => { launched.subject = s; };
window.openChapterDetail = (ch) => {
    launched.chapter = ch;
    window.AppState.currentChapterQuestions = [{ id: 'q1' }];
};

store.set(BS._test.lsKey, '2000-01-01');
document.getElementById = () => null;
BS.maybeShow();
BS._test.press('Enter');          // boot → subject
BS._test.press('1');              // Physics
BS._test.press('3');              // happy → mood
BS._test.press('2');              // path → Question Bank
assert(BS._test.step === 'pomo', 'Question Bank advances → pomo step');

BS._test.press('2');              // Raw Dog (no timer)
assert(BS._test.step === 'chapter', 'raw-dog advances → chapter step');

// Weakest-first: Thermo (health 10) must rank before Kinematics (health 71).
BS._test.press('1');
assert(BS._test.ctx.chapter === 'Thermo', 'weakest chapter (Thermo) picked first');
assert(BS._test.step === 'mode', 'chapter selection advances → mode step');

BS._test.press('1');              // Flow State
await new Promise(r => setTimeout(r, 0)); // let switchTab.then(doLaunch) run
assert(launched.flow === 1, 'Flow mode launches startFlowPractice');
assert(launched.subject === 'physics' && launched.chapter === 'Thermo', 'drills into chosen chapter');
assert(launched.hc === 0 && launched.std === 0, 'no other launcher fired');
assert(body.children.length === 0, 'overlay closed on QB launch');
assert(localStorage.getItem(BS._test.lsKey) === today, 'guard written on QB launch');

// 12. Pomodoro arm: holds during the 3s grace, then startTimer + advance
store.set(BS._test.lsKey, '2000-01-01');
let timerStarts = 0;
window.startTimer = () => { timerStarts++; };
window.initAudioContext = () => {};
window.applyPomoConfig = () => {};
window.changeStudySubject = () => {};
const subjInput = fakeEl('input');
document.getElementById = (id) => (id === 'pomo-subject' ? subjInput : null);

BS.maybeShow();
BS._test.press('Enter');          // boot → subject
BS._test.press('2');              // Chemistry
BS._test.press('1');              // sad → mood
BS._test.press('2');              // Question Bank
BS._test.press('1');              // Lock In (arm)
assert(BS._test.step === 'pomo', 'arming holds on the pomo step');
assert(timerStarts === 0, 'timer NOT started during the 3s grace');
assert(subjInput.value === 'chemistry', 'pomodoro subject set to the arena subject');

BS._test.armNow();                // force the countdown to complete
assert(timerStarts === 1, 'arm completion calls startTimer exactly once');
assert(BS._test.step === 'chapter', 'arming advances → chapter step');
BS._test.press('Escape');         // abort the rest
assert(localStorage.getItem(BS._test.lsKey) === today, 'guard written after arm+abort');

// 13. Hardcore daily-cap gate blocks that option on the mode step
store.set(BS._test.lsKey, '2000-01-01');
document.getElementById = () => null;
window.AppState.hardcoreDailyDate = BS._test.todayKey();
window.AppState.hardcoreDailyCount = 8;

BS.maybeShow();
BS._test.press('Enter');          // boot → subject
BS._test.press('1');              // Physics
BS._test.press('2');              // neutral → mood
BS._test.press('2');              // Question Bank
BS._test.press('2');              // Raw Dog
BS._test.press('1');              // chapter: Thermo
assert(BS._test.step === 'mode', 'mode step reached');
BS._test.press('2');              // Hardcore — capped
assert(launched.hc === 0, 'hardcore launch blocked at the daily cap');
assert(BS._test.step === 'mode', 'still on mode step after blocked hardcore');
BS._test.press('3');              // Standard
await new Promise(r => setTimeout(r, 0));
assert(launched.std === 1, 'standard launches startPracticeWithQuestion');

// 14. Empty chapter bank → no options, still abortable
store.set(BS._test.lsKey, '2000-01-01');
document.getElementById = () => null;
window.AppState.chapters.chemistry = [];
const modalCalls = [];
window.openModal = (id) => modalCalls.push(id);

BS.maybeShow();
BS._test.press('Enter');          // boot → subject
BS._test.press('2');              // Chemistry
BS._test.press('3');              // happy
BS._test.press('2');              // Question Bank
BS._test.press('2');              // Raw Dog
assert(BS._test.step === 'chapter', 'chapter step reached with empty bank');
BS._test.press('1');
assert(BS._test.step === 'chapter', 'no chapter options on an empty bank');
BS._test.press('Escape');
assert(body.children.length === 0, 'abort works on the empty-bank screen');

// 15. Error Matrix branch: vault + Daily Fix Queue + auto-open priority solving
store.set(BS._test.lsKey, '2000-01-01');
document.getElementById = () => null;
window.AppState = {
    chapters: { physics: ['Kinematics'], chemistry: [], maths: [] },
    questionBank: [
        { id: 'e1', subject: 'physics', chapter: 'Kinematics', status: 'wrong', errorReason: 'FORMULA', easeFactor: 2.5 },
        { id: 'e2', subject: 'physics', chapter: 'Kinematics', status: 'error', errorReason: 'CALC', easeFactor: 1.2 },
    ],
    hardcoreDailyDate: null,
    hardcoreDailyCount: 0,
    currentChapterQuestions: [],
};
window._getDailyQueueSnapshot = () => ['e2', 'e1']; // priority order (weakest easeFactor first)
let toggleCalls = 0;
window.activateDailyQueue = () => { toggleCalls++; };
const matrixLaunches = [];
window.startPracticeWithQuestion = (qs, idx) => { matrixLaunches.push(qs.map(q => q.id)); };

BS.maybeShow();
BS._test.press('Enter');      // boot → subject
BS._test.press('1');          // Physics
BS._test.press('2');          // neutral → mood
BS._test.press('1');          // ERROR MATRIX
await new Promise(r => setTimeout(r, 0)); // switchTab.then(doLaunch)
assert(toggleCalls === 1, 'vault Daily Fix Queue force-armed');
assert(matrixLaunches.length === 1, 'priority solving auto-opened');
assert(matrixLaunches[0][0] === 'e2' && matrixLaunches[0][1] === 'e1',
    'practice pool preserves queue priority order (weakest first)');
assert(window.AppState.currentSubject === 'physics' && window.AppState.currentChapter === 'Kinematics',
    'vault context seeded from the first queue question');
assert(body.children.length === 0, 'overlay closed on matrix launch');
assert(localStorage.getItem(BS._test.lsKey) === today, 'guard written on matrix launch');

// 16. Empty queue → lands on the vault without auto-opening a modal
store.set(BS._test.lsKey, '2000-01-01');
window._getDailyQueueSnapshot = () => [];
matrixLaunches.length = 0;
toggleCalls = 0;

BS.maybeShow();
BS._test.press('Enter');
BS._test.press('3');          // Maths
BS._test.press('1');          // sad → mood
BS._test.press('1');          // ERROR MATRIX
await new Promise(r => setTimeout(r, 0));
assert(toggleCalls === 1, 'queue toggled even when the queue is empty');
assert(matrixLaunches.length === 0, 'no modal auto-opened for an empty queue');

// 17. FX sound hooks fire on the right user actions (FX stubbed)
store.set(BS._test.lsKey, '2000-01-01');
const sfxLog = [];
window.FX = { sound(name) { sfxLog.push(name); } };
document.getElementById = () => null;
window.AppState = {
    chapters: { physics: ['Thermo'], chemistry: [], maths: [] },
    questionBank: [{ subject: 'physics', chapter: 'Thermo', status: 'unsolved' }],
    hardcoreDailyDate: null,
    hardcoreDailyCount: 0,
    currentChapterQuestions: [],
};
window.getChapterHealth = () => 30;
window.startFlowPractice = () => {};
sfxLog.length = 0;

BS.maybeShow();
assert(sfxLog.includes('blip'), 'blip plays on overlay mount');
BS._test.press('Enter');            // boot → subject
BS._test.press('1');                // Physics
assert(sfxLog[sfxLog.length - 1] === 'select', 'select plays on subject pick');
BS._test.press('3');                // happy → mood
BS._test.press('2');                // Question Bank
assert(sfxLog[sfxLog.length - 1] === 'select', 'select plays on path pick');
BS._test.press('2');                // Raw Dog
BS._test.press('1');                // chapter Thermo
assert(sfxLog[sfxLog.length - 1] === 'select', 'select plays on chapter pick');
BS._test.press('3');                // Standard → launch
await new Promise(r => setTimeout(r, 0));
assert(sfxLog[sfxLog.length - 1] === 'confirm', 'confirm plays on mode launch');
assert(!sfxLog.includes('modalClose'), 'launch finish suppresses the close chime');

// 18. Backspace mid-arming clears the countdown (no phantom startTimer) + re-arm
store.set(BS._test.lsKey, '2000-01-01');
let armStarts = 0;
window.startTimer = () => { armStarts++; };
window.applyPomoConfig = () => {};
window.changeStudySubject = () => {};
const subjInput3 = fakeEl('input');
document.getElementById = (id) => (id === 'pomo-subject' ? subjInput3 : null);
sfxLog.length = 0;

BS.maybeShow();
BS._test.press('Enter');          // boot → subject
BS._test.press('1');              // Physics
BS._test.press('2');              // neutral → mood
BS._test.press('2');              // Question Bank
BS._test.press('1');              // Lock In → arm
assert(BS._test.arming === true, 'arming flag set during the countdown');
await new Promise(r => setTimeout(r, 1100)); // let the first countdown tick play
assert(sfxLog.includes('tick'), 'arming countdown ticks play');
BS._test.press('Backspace');      // abort the arm
assert(BS._test.arming === false, 'Backspace exits the arming state');
assert(BS._test.step === 'pomo', 'Backspace mid-arm returns to the pomo prompt');
assert(BS._test.pendingTimers === 0, 'Backspace clears the countdown interval');
assert(armStarts === 0, 'no phantom startTimer after aborting the arm');
BS._test.press('1');              // re-arm
assert(BS._test.arming === true, 're-arm after Backspace re-enters the countdown');
BS._test.armNow();
assert(armStarts === 1, 're-armed countdown completes → startTimer exactly once');
assert(sfxLog.includes('success'), 'arm completion plays success');
BS._test.press('Escape');

// 19. HUD progress dots + dialog focus + hint
store.set(BS._test.lsKey, '2000-01-01');
document.getElementById = () => null;
BS.maybeShow();
const overlayEl = body.children[0];
const progressEl = overlayEl._qs.get('.bootseq-progress');
const hintEl = overlayEl._qs.get('.bootseq-hint');
assert(overlayEl.focusCount === 1, 'dialog claims focus on mount');
assert(progressEl.children.length === 6, 'HUD renders 6 step dots (boot excluded)');
BS._test.press('Enter');          // boot → subject
assert(progressEl.children[0].classList.contains('is-active'), 'subject dot active on the subject step');
BS._test.press('1');              // Physics → mood
assert(progressEl.children[0].classList.contains('is-done'), 'subject dot marked done after advancing');
assert(progressEl.children[1].classList.contains('is-active'), 'mood dot active on the mood step');
assert(hintEl.textContent.includes('[1-3] SELECT'), 'hint shows the active option range');
BS._test.press('Escape');

// 20. Abort/skip chime + back chime
store.set(BS._test.lsKey, '2000-01-01');
sfxLog.length = 0;
BS.maybeShow();
BS._test.press('Enter');
BS._test.press('1');              // Physics → mood
sfxLog.length = 0;
BS._test.press('Backspace');
assert(sfxLog.includes('soft'), 'back plays the soft chime');
BS._test.press('Escape');
assert(sfxLog[sfxLog.length - 1] === 'modalClose', 'ESC abort plays the modalClose chime');

console.log(`\n${pass} passed, ${fail} failed`);
// boot-sequence schedules typing timers — exit explicitly, don't wait on the loop.
process.exit(fail ? 1 : 0);
