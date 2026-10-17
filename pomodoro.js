// ==================== POMODORO MODULE ====================
import { formatTime, formatStudyDuration, saveAllAsync, studySecs, SessionFocus } from './storage.js';
import { GalleryBreak } from './gallery-break.js';
import { NightGuard } from './nightguard.js';

// ── Null-safe element lookup ──────────────────────────────────────────────
// The standalone Focus Mode view and the Ambient Sprint widget were removed in
// the Integrated Lock-In overhaul. Legacy render paths (and the Node smoke
// tests' DOM stubs) may still look them up, so every lookup returns a detached
// no-op element instead of null — a missing node can never throw mid-tick.
function _stubEl() {
    return {
        textContent: '', innerHTML: '', value: '', disabled: false, hidden: false,
        onclick: null, style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
        setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
        addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
        appendChild(c) { return c; }, removeChild() {}, remove() {},
        querySelector() { return null; }, querySelectorAll() { return []; },
        contains() { return false; }, focus() {}, blur() {}, click() {},
        getBoundingClientRect() { return { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 }; },
    };
}
function $(id) {
    try {
        const el = document.getElementById(id);
        return el || _stubEl();
    } catch (_) { return _stubEl(); }
}

// ---- Pomodoro-specific state (module-scoped) ----
let timerInterval, secondsLeft, totalSecondsForState, pomoState = 'IDLE',
    currentSession = 1,
    totalSessions = 1,
    studySubject = 'physics';
let isPaused = false;
let visualMode = 'bar';

let isStopwatchMode = false;
let dynamicSubject = false;      // live mid-session subject switching
const SUBJECT_KEYS = ['physics', 'chemistry', 'maths'];
let timerStartTime = null;        // Date.now() at start/resume

// ── Night Guard bridge: exposes timerStartTime for clock-cheat cross-check ──
// isRunning() lets app.js lock the question filter while a session is live.
// getConfig() exposes the persisted last-used setup (Daily Briefing / restore).
window.__pomodoro = {
    getTimerStartTime: () => timerStartTime,
    isRunning: () => pomoState !== 'IDLE' || (lockinSession && lockinSession.active),
    getConfig: () => readPomoConfig(),
    getLedger: () => getFocusLedger(),
};

// ═══════════════════════════════════════════════════════════════════════════
// DEEP WORK LEDGER — the focus engine's memory of *today*.
//  done    blocks completed to their planned end (or ≥5min stopwatch stop)
//  forfeit blocks abandoned mid-study
//  chain   consecutive completed blocks without a forfeit (resets on quit)
//  best    best chain reached today
//  deep    seconds actually spent in study phases today
// This is what makes starting "cost" something: quitting visibly breaks the
// chain, completing visibly grows it. Stored per-day in localStorage.
const FOCUS_LEDGER_KEY = 'jeemax_focus_ledger';

function _todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _loadFocusLedger() {
    try {
        const raw = JSON.parse(localStorage.getItem(FOCUS_LEDGER_KEY) || 'null');
        if (raw && raw.d === _todayKey()) {
            return { d: raw.d, done: raw.done | 0, forfeit: raw.forfeit | 0, chain: raw.chain | 0, best: raw.best | 0, deep: raw.deep | 0 };
        }
    } catch (_) { /* corrupt payload → fresh day */ }
    return { d: _todayKey(), done: 0, forfeit: 0, chain: 0, best: 0, deep: 0 };
}

let focusLedger = _loadFocusLedger();

function _saveFocusLedger() {
    try { localStorage.setItem(FOCUS_LEDGER_KEY, JSON.stringify(focusLedger)); } catch (_) {}
}

/** Sanitized copy of today's ledger (for UI hydration / QA). */
export function getFocusLedger() {
    return { ...focusLedger };
}

function _ledgerCompleteBlock(secsDeep) {
    focusLedger.done += 1;
    focusLedger.chain += 1;
    focusLedger.best = Math.max(focusLedger.best, focusLedger.chain);
    focusLedger.deep += Math.max(0, secsDeep | 0);
    _saveFocusLedger();
    // Daily Directive: a completed deep-focus block pays +2 LU to the active
    // subject (capped at 3 blocks/day/subject inside directive.js).
    import('./directive.js').then(m => {
        try { m.Directive.awardFocus(typeof studySubject !== 'undefined' ? studySubject : null); } catch (_) {}
    }).catch(() => {});
}

function _ledgerForfeit(secsDeep) {
    focusLedger.forfeit += 1;
    focusLedger.chain = 0;
    focusLedger.deep += Math.max(0, secsDeep | 0);
    _saveFocusLedger();
}

// ── Real Deep Work ×1.5 wiring ────────────────────────────────────────────
// app.js's _getDeepWorkBlockMultiplier() grants ×1.5 ELO on solves while
// `body.pomo-active` (or window._pomoRunning) is set. Nothing ever set it,
// so the bonus was dead code. Every running study phase now sets it; pause,
// break, quit and reset clear it — the badge never lies.
function _setDeepWorkActive(on) {
    try {
        if (document.body) document.body.classList.toggle('pomo-active', !!on);
    } catch (_) {}
    window._pomoRunning = !!on;
}

// ── Ambient Sprint Widget helpers ─────────────────────────────────────────
const MINI_RING_CIRC = 2 * Math.PI * 15.5;   // matches r=15.5 in index.html

function _updateMiniRing(percent) {
    const arc = $('mini-ring-arc');
    if (!arc) return;
    const p = Math.min(1, Math.max(0, percent || 0));
    arc.style.strokeDashoffset = String(MINI_RING_CIRC * (1 - p));
}

/** data-state drives the whole widget skin: idle | study | break */
function syncWidget(state) {
    const w = $('pomo-mini-widget');
    if (!w || typeof w.setAttribute !== 'function') return;   // stub-safe
    w.setAttribute('data-state', state);
}

function syncWidgetPaused(paused) {
    const w = $('pomo-mini-widget');
    if (!w) return;
    if (typeof w.setAttribute !== 'function') return;         // stub-safe
    if (paused) w.setAttribute('data-paused', '');
    else w.removeAttribute('data-paused');
}

/** "ends 14:35" — the wall-clock moment the live block pays out. */
function _updateMiniEnd() {
    const el = $('mini-end');
    if (!el) return;
    if (isPaused || pomoState === 'IDLE' || pomoState === 'STOPWATCH' || !timerStartTime || !timerTotalSeconds) {
        el.textContent = '';
        return;
    }
    const t = new Date(timerStartTime + timerTotalSeconds * 1000);
    try {
        el.textContent = 'ends ' + t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) { el.textContent = ''; }
}

function _updateMiniTally() {
    const el = $('mini-tally');
    if (!el) return;
    el.textContent = focusLedger.done > 0 ? `${focusLedger.done} done today` : '';
}

// ── Block ELO snapshot (session receipt shows what the block earned) ──────
let _blockEloSnap = null;
function _eloSnapshot() {
    try {
        const A = window.AppState;
        if (!A || !A.elo) return null;
        return { g: A.elo.global || 0, s: A.elo[studySubject] || 0, subj: studySubject };
    } catch (_) { return null }
}

// Lock/unlock the chapter-question filter dropdown while the timer runs.
function syncFilterLock() {
    const filterEl = $('question-filter');
    if (filterEl) filterEl.disabled = pomoState !== 'IDLE';
}
let timerTotalSeconds = 0;        // total seconds for countdown
let stopwatchAccumulated = 0;    // seconds already counted before pause (stopwatch mode)
let timerEndTriggered = false;   // prevent multiple handleTimerEnd calls
let pausedElapsed = 0;           // countdown seconds elapsed at pause (preserved across resume)
let lastTickAt = null;           // wall-clock anchor for per-second study credit
let lastSavedStudyMinute = 0;    // save watermark for whole-minute study credit
let _resetPomoTimer = null;      // pending quitTimer UI reset
let _blockCreditedSecs = 0;      // study seconds actually credited this block (pauses excluded) — feeds the deep-work ledger

let bellAudioCtx = null;
let _pomoPendingAction = null;   // replaces window._pomoPendingAction
let _notifyVariant = null;       // '' | 'victory' | 'breach' | 'complete' — themes #timer-notify-modal

// ── Pomodoro config persistence ────────────────────────────────────────────
// The last-used timer setup is snapshotted to localStorage the moment a
// session starts, then re-applied at boot. This keeps returning users' Focus
// Mode settings stable across reloads, and lets the Daily Briefing flow
// pre-fill / auto-arm the timer with the exact configuration last run.
// Best-effort only — private mode / quota failures degrade silently.
const POMO_CONFIG_KEY = 'jeemax_pomo_config';

export function savePomoConfig() {
    try {
        // The Lock-In Ritual Chamber (#lockin-grind/#lockin-chill/#lockin-rounds)
        // is the live setup surface now; fall back to the legacy Focus Mode
        // inputs when it isn't mounted (smoke tests / stripped shells).
        const lg = document.getElementById('lockin-grind');
        const lb = document.getElementById('lockin-chill');
        const lr = document.getElementById('lockin-rounds');
        const cfg = {
            subject: studySubject,
            study: lg ? (parseInt(lg.value, 10) || 50) : (parseInt($('pomo-study').value, 10) || 50),
            break: lb ? (parseInt(lb.value, 10) || 10) : (parseInt($('pomo-break').value, 10) || 10),
            sessions: lr ? (parseInt(lr.value, 10) || 1) : (parseInt($('pomo-sessions').value, 10) || 1),
            stopwatch: isStopwatchMode,
            dynamic: dynamicSubject,
        };
        localStorage.setItem(POMO_CONFIG_KEY, JSON.stringify(cfg));
    } catch (err) {
        console.warn('[pomodoro] config save failed:', err);
    }
}

/** Sanitized last-used config, or null when nothing valid is stored. */
export function readPomoConfig() {
    try {
        const raw = localStorage.getItem(POMO_CONFIG_KEY);
        if (!raw) return null;
        const cfg = JSON.parse(raw);
        if (!cfg || typeof cfg !== 'object') return null;
        return {
            subject: isValidSubjectKey(cfg.subject) ? cfg.subject : 'physics',
            study: Math.max(1, parseInt(cfg.study, 10) || 50),
            break: Math.max(1, parseInt(cfg.break, 10) || 10),
            sessions: Math.max(1, parseInt(cfg.sessions, 10) || 1),
            stopwatch: !!cfg.stopwatch,
            dynamic: !!cfg.dynamic,
        };
    } catch (err) {
        // Corrupt payload — treat as no saved config, never crash boot.
        console.warn('[pomodoro] config read failed:', err);
        return null;
    }
}

/** Write the last-used config back onto the Focus Mode inputs (idempotent). */
export function applyPomoConfig() {
    const cfg = readPomoConfig();
    if (!cfg) return false;
    const setVal = (id, val) => {
        const el = $(id);
        if (el) el.value = val;
    };
    setVal('pomo-study', cfg.study);
    setVal('pomo-break', cfg.break);
    setVal('pomo-sessions', cfg.sessions);
    const subjectEl = $('pomo-subject');
    if (subjectEl && isValidSubjectKey(cfg.subject)) {
        subjectEl.value = cfg.subject;
        if (studySubject !== cfg.subject) changeStudySubject();
    }
    // Apply stopwatch / dynamic directly (same module — legal) then reflect via
    // the shared pure UI helpers. Calling the public toggles here would trigger
    // their side effects: toggleStopwatchMode() always runs resetPomoUI().
    if (cfg.stopwatch !== isStopwatchMode) {
        isStopwatchMode = cfg.stopwatch;
        _syncStopwatchUI();
    }
    if (cfg.dynamic !== dynamicSubject) {
        dynamicSubject = cfg.dynamic;
        _syncDynamicSubjectUI();
    }
    return true;
}

// ---- Page Visibility Listener (fixes background freezing) ----
document.addEventListener('visibilitychange', async () => {
    if (!document.hidden && lockinSession.active && lockinSession.running) {
        _lockinTick();
    }
    if (document.hidden) return;
    if (pomoState === 'IDLE' || !timerStartTime || isPaused) return;

    if (pomoState === 'STOPWATCH') {
        // Wall-clock catch-up: a stopwatch must keep counting while hidden.
        const elapsed = Math.floor((Date.now() - timerStartTime) / 1000);
        if (elapsed > 0) {
            stopwatchAccumulated += elapsed;
            timerStartTime = Date.now();
            secondsLeft = stopwatchAccumulated;
            creditStudySeconds(studySubject, elapsed);
        }
        $('timer-display').textContent = formatTime(secondsLeft);
        $('mini-time').textContent = formatTime(secondsLeft);
        return;
    }

    // Recalculate time based on real elapsed time
    const elapsed = Math.floor((Date.now() - timerStartTime) / 1000);
    const remaining = Math.max(0, timerTotalSeconds - elapsed);
    secondsLeft = remaining;

    // Update display
    $('timer-display').textContent = formatTime(secondsLeft);
    $('mini-time').textContent = formatTime(secondsLeft);
    const percent = timerTotalSeconds ? ((timerTotalSeconds - remaining) / timerTotalSeconds) * 100 : 0;
    if (visualMode === 'bar') {
        $('pomo-progress').style.width = `${percent}%`;
    } else {
        $('pomo-beaker-fill').style.height = `${percent}%`;
    }
    _updateMiniRing(percent / 100);
    if (pomoState === 'BREAK') GalleryBreak.setProgress(percent / 100);

    // If the timer should have finished while we were away, trigger end now
    if (remaining <= 0 && !timerEndTriggered) {
        timerEndTriggered = true; // set synchronously — no duplicate end UI
        clearInterval(timerInterval);
        // Fire-and-forget save, exactly like the tick-path end below — an
        // await here used to delay the end modal by the storage write.
        saveAllAsync().catch(console.error);
        handleTimerEnd();
    }
});

// ---- Visual toggles ----
export function toggleVisualizer() {
    visualMode = visualMode === 'bar' ? 'beaker' : 'bar';
    $('vis-bar').style.display = visualMode === 'bar' ? 'block' : 'none';
    $('vis-beaker').style.display = visualMode === 'beaker' ? 'block' : 'none';
}

export function toggleMiniWidget() {
    const widget = $('pomo-mini-widget');
    widget.classList.toggle('collapsed');
}

// ── Ambient Sprint Widget: idle pill + config popover ─────────────────────
// The focus engine's primary surface lives on EVERY tab now: one tap on ▶
// starts a sprint with the suggested length; the pill body opens a compact
// config popover (subject / minutes / rounds). No tab-switching required.
let popMinutes = null;   // lazy-seeded from the persisted config
let popRounds = null;
let popOpen = false;

function _seedPopConfig() {
    if (popMinutes != null && popRounds != null) return;
    const cfg = readPomoConfig();
    // Live form values win — the user may have just edited them without
    // starting; the persisted config is only a fallback for empty inputs.
    // (Seeding from the stale config first used to make ▶ run the OLD length
    // and silently rewrite the input the user had just changed.)
    popMinutes = parseInt($('pomo-study')?.value, 10) || (cfg ? cfg.study : 25);
    popRounds = parseInt($('pomo-sessions')?.value, 10) || (cfg ? cfg.sessions : 1);
    popMinutes = Math.min(120, Math.max(5, popMinutes));
    popRounds = Math.min(8, Math.max(1, popRounds));
}

function _popReason() {
    if (popMinutes >= 45) return 'deep zone';
    if (popMinutes >= 25) return 'classic sprint';
    return 'quick strike';
}

function _syncPopControls() {
    _seedPopConfig();
    const mEl = $('pop-minutes');
    if (mEl) mEl.textContent = String(popMinutes);
    const rEl = $('pop-rounds');
    if (rEl) rEl.textContent = String(popRounds);
    const reasonEl = $('pop-reason');
    if (reasonEl) reasonEl.textContent = _popReason();
    document.querySelectorAll('#pop-subjects .pop-sub').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.subject === studySubject);
    });
    const dyn = $('pop-dynamic');
    if (dyn) dyn.classList.toggle('on', dynamicSubject);
    // Idle pill preview mirrors the suggestion.
    const timeEl = $('mini-time');
    if (timeEl && pomoState === 'IDLE') timeEl.textContent = formatTime(popMinutes * 60);
    const statusEl = $('mini-status');
    if (statusEl && pomoState === 'IDLE') statusEl.textContent = 'SPRINT';
    _updateMiniTally();
    const reason2 = $('mini-reason');
    if (reason2) reason2.textContent = focusLedger.done > 0 ? '' : 'tap ▶ to lock in';
}

export function openPomoPop() {
    // Running? The pill body becomes a shortcut to the full Focus view.
    if (pomoState !== 'IDLE') {
        if (window.switchTab) window.switchTab('pomodoro', null);
        return;
    }
    popOpen = true;
    const pop = $('pomo-pop');
    const w = $('pomo-mini-widget');
    if (pop) pop.classList.add('open');
    if (w && typeof w.setAttribute === 'function') w.setAttribute('data-pop', '');
    _syncPopControls();
}

export function closePomoPop() {
    popOpen = false;
    const pop = $('pomo-pop');
    const w = $('pomo-mini-widget');
    if (pop) pop.classList.remove('open');
    if (w && typeof w.removeAttribute === 'function') w.removeAttribute('data-pop');
}

// Outside click closes the popover (module-level, guarded for stubs).
if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', (e) => {
        if (!popOpen) return;
        const w = $('pomo-mini-widget');
        if (w && !w.contains(e.target)) closePomoPop();
    });
}

export function popSetSubject(sub) {
    if (!isValidSubjectKey(sub)) return;
    const select = $('pomo-subject');
    if (select) { select.value = sub; changeStudySubject(); }
    else { studySubject = sub; updateMiniSubject(); }
    _syncPopControls();
}

export function popAdjustMinutes(delta) {
    _seedPopConfig();
    popMinutes = Math.min(120, Math.max(5, popMinutes + delta));
    const input = $('pomo-study');
    if (input) input.value = String(popMinutes);   // write-through: form stays source of truth
    updateProjection();
    _syncPopControls();
}

export function popAdjustRounds(delta) {
    _seedPopConfig();
    popRounds = Math.min(8, Math.max(1, popRounds + delta));
    const input = $('pomo-sessions');
    if (input) input.value = String(popRounds);
    updateProjection();
    _syncPopControls();
}

/** Shared launch path for ▶ (idle pill) and the popover's Start button. */
export function startSprintFromWidget() {
    if (pomoState !== 'IDLE') return;
    _seedPopConfig();
    const studyInput = $('pomo-study');
    if (studyInput) studyInput.value = String(popMinutes);
    const sessionsInput = $('pomo-sessions');
    if (sessionsInput) sessionsInput.value = String(popRounds);
    const select = $('pomo-subject');
    if (select && isValidSubjectKey(studySubject)) select.value = studySubject;
    closePomoPop();
    startTimer();
}

export function popStart() {
    closePomoPop();
    startSprintFromWidget();
}

/**
 * Widget pause button — a true toggle. The inline onclick can't be swapped
 * the way the big form button's is, so the widget needs one entry point that
 * checks the live state instead (old bug: tapping ▮▮ twice double-paused).
 */
export function widgetPauseToggle() {
    if (pomoState === 'IDLE') return;
    const btn = $('mini-pause');
    if (isPaused) {
        resumeTimer();
        if (btn) btn.textContent = '▮▮';
    } else {
        pauseTimer();
        if (btn) btn.textContent = '▶';
    }
}

// ── Dynamic subject mode ──────────────────────────────────────────────────
// Lets the subject switch live mid-session: each tick's second is credited
// to whichever subject is active at that moment. The subject picker stays
// unlocked while the timer runs, and the mini widget badge always shows the
// subject currently being tracked.
function isValidSubjectKey(value) {
    return SUBJECT_KEYS.includes(value);
}

export function toggleDynamicSubject(btn) {
    dynamicSubject = !dynamicSubject;
    _syncDynamicSubjectUI();
}

export function changeStudySubject() {
    const select = $('pomo-subject');
    if (!select || !isValidSubjectKey(select.value)) return;
    studySubject = select.value;
    updateMiniSubject();

    // Live status line refresh while a session is underway.
    const status = $('timer-status');
    if (!status) return;
    if (pomoState === 'STOPWATCH') {
        status.textContent = `Stopwatch: ${studySubject.toUpperCase()}`;
    } else if (pomoState === 'STUDY') {
        status.textContent = `Studying ${studySubject.toUpperCase()} (${currentSession}/${totalSessions})`;
    }
}

function updateMiniSubject() {
    const badge = $('mini-subject');
    if (badge) badge.textContent = studySubject.toUpperCase();
}

export function updateStudyTimeHeader() {
    const total = studySecs.physics + studySecs.chemistry + studySecs.maths;
    const th = Math.floor(total / 3600);
    const tm = Math.floor((total % 3600) / 60);
    const headTime = $('top-study-time'); // header chip removed — stay null-safe
    if (headTime) headTime.textContent = th > 0 ? `${th}h ${tm}m` : `${tm}m`;
    $('stat-hrs-physics').textContent = formatStudyDuration(studySecs.physics);
    $('stat-hrs-chemistry').textContent = formatStudyDuration(studySecs.chemistry);
    $('stat-hrs-maths').textContent = formatStudyDuration(studySecs.maths);
}

// ── Commitment projection ─────────────────────────────────────────────────
// Before locking in, the form states the contract in plain numbers: what
// you're signing up for and what it pays. Updates live on every input.
export function updateProjection() {
    const el = $('pomo-projection');
    if (!el) return;
    const study = parseInt($('pomo-study')?.value, 10) || 0;
    const chill = parseInt($('pomo-break')?.value, 10) || 0;
    const rounds = parseInt($('pomo-sessions')?.value, 10) || 1;
    if (study <= 0 || rounds <= 0) { el.textContent = ''; return; }
    const totalMin = study * rounds + chill * Math.max(0, rounds - 1);
    const h = Math.floor(totalMin / 60);
    const label = h > 0 ? `${h}h ${totalMin % 60}m` : `${totalMin}m`;
    el.textContent = `${study}m × ${rounds} round${rounds > 1 ? 's' : ''} ≈ ${label} committed · every solve banks ×1.5 ELO while you're locked in`;
}

// ── Focus view hydration (ledger strip + chain pips) ──────────────────────
export function hydrateFocusStats() {
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('fs-done', String(focusLedger.done));
    set('fs-deep', formatStudyDuration(focusLedger.deep));
    set('fs-chain', String(focusLedger.chain));
    set('fs-best', String(focusLedger.best));
    set('fs-forfeit', String(focusLedger.forfeit));
    const pips = $('chain-pips');
    if (pips) {
        const slots = Math.max(5, focusLedger.chain, Math.min(focusLedger.best, 10));
        let html = '';
        for (let i = 0; i < slots; i++) {
            html += `<span class="chain-pip${i < focusLedger.chain ? ' lit' : ''}${i === focusLedger.chain - 1 ? ' tip' : ''}"></span>`;
        }
        pips.innerHTML = html;
    }
    _updateMiniTally();
    updateProjection();
}

// Bind the projection to form edits (guarded — module may load under stubs).
try {
    ['pomo-study', 'pomo-break', 'pomo-sessions'].forEach(id => {
        const el = $(id);
        if (el) el.addEventListener('input', updateProjection);
    });
} catch (_) {}

export function setPomoPreset(grind, chill) {
    const studyInput = $('pomo-study');
    const breakInput = $('pomo-break');
    if (studyInput) {
        studyInput.value = grind;
        studyInput.dispatchEvent(new Event('input', { bubbles: true }));
        studyInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (breakInput) {
        breakInput.value = chill;
        breakInput.dispatchEvent(new Event('input', { bubbles: true }));
        breakInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (typeof updateProjection === 'function') updateProjection();
    if (typeof updateDisplay === 'function' && !_pomoRunning) {
        timeLeft = grind * 60;
        updateDisplay();
    }
    document.querySelectorAll('.pomo-preset-btn').forEach(btn => {
        const g = parseInt(btn.dataset.grind, 10);
        btn.classList.toggle('active', g === grind);
    });
}
try { window.setPomoPreset = setPomoPreset; } catch (_) {}

// ---- Improved bell (persistent AudioContext) ----
export function initAudioContext() {
    if (!bellAudioCtx) {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                bellAudioCtx = new AudioContext();
                // iPadOS flips the context to 'interrupted'/'suspended' after
                // alarms, Siri or phone calls. focus-sound.js already recovers
                // this way; the session-end bell must survive interruptions
                // too, so auto-resume whenever the state leaves 'running'.
                try {
                    bellAudioCtx.addEventListener('statechange', () => {
                        if (bellAudioCtx && bellAudioCtx.state !== 'running') {
                            bellAudioCtx.resume().catch(() => {});
                        }
                    });
                } catch (_) {}
            }
        } catch (e) {
            console.warn("Audio not supported", e);
        }
    }
    if (bellAudioCtx && bellAudioCtx.state === 'suspended') {
        bellAudioCtx.resume().catch(e => console.warn("Audio resume failed", e));
    }
}

// Soothing singing-bowl style bell — replaces the old sharp 880Hz blip.
// Pair of pure sines (A3 fundamental + perfect-fifth E4) with a slow
// attack and ~2.2s exponential decay. Peak gain is well below the prior
// 0.30 so the chime feels warm rather than piercing.
export function playBell() {
    if (window.FX && !window.FX.wantSound()) return;
    initAudioContext(); // ensure context exists and is resumed
    if (!bellAudioCtx) return;

    // Duck the ambient bed so the chime cuts through the rain (etc.).
    try { if (window.FocusSound && window.FocusSound.duck) window.FocusSound.duck(); } catch (_) {}

    // FX exposes prefs.volume (not a vol() getter); 0.7 mirrors fx.js default.
    // Bail when muted — exponentialRampToValueAtTime rejects 0-valued targets,
    // and an inaudible chime doesn't need any oscillators scheduled.
    const vol = (window.FX && window.FX.prefs && typeof window.FX.prefs.volume === 'number')
        ? window.FX.prefs.volume : 0.7;
    if (vol <= 0) return;
    const floor = 0.0001;
    const now = bellAudioCtx.currentTime;
    const partials = [
        { f: 220.00, g: 0.18, dur: 2.20 },   // A3 — warm fundamental
        { f: 329.63, g: 0.10, dur: 2.45 },   // E4 — perfect-fifth shimmer, longer tail
    ];
    for (const p of partials) {
        const osc = bellAudioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = p.f;
        const gain = bellAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(bellAudioCtx.destination);
        gain.gain.setValueAtTime(floor, now);
        gain.gain.exponentialRampToValueAtTime(p.g * vol, now + 0.06);       // soft attack
        gain.gain.exponentialRampToValueAtTime(floor, now + p.dur);          // long exhale
        osc.start(now);
        osc.stop(now + p.dur + 0.05);
    }
}

// Gentle ascending ignition chime played the moment a pomodoro / stopwatch
// session starts. Two soft sines a fifth apart, second tone staggered so the
// pair feels like an inhale rather than a ding — matches the soothing tone
// of playBell() so start and stop share the same emotional register.
export function playStartChime() {
    if (window.FX && !window.FX.wantSound()) return;
    initAudioContext();
    if (!bellAudioCtx) return;

    const vol = (window.FX && window.FX.prefs && typeof window.FX.prefs.volume === 'number')
        ? window.FX.prefs.volume : 0.7;
    if (vol <= 0) return;
    const floor = 0.0001;
    const now = bellAudioCtx.currentTime;
    const partials = [
        { f: 261.63, g: 0.10, at: 0.00, dur: 1.10 }, // C4 — soft root
        { f: 392.00, g: 0.10, at: 0.18, dur: 1.30 }, // G4 — staggered perfect-fifth up
    ];
    for (const p of partials) {
        const osc = bellAudioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = p.f;
        const gain = bellAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(bellAudioCtx.destination);
        const startAt = now + p.at;
        gain.gain.setValueAtTime(floor, startAt);
        gain.gain.exponentialRampToValueAtTime(p.g * vol, startAt + 0.05);   // soft attack
        gain.gain.exponentialRampToValueAtTime(floor, startAt + p.dur);      // gentle decay
        osc.start(startAt);
        osc.stop(startAt + p.dur + 0.05);
    }
}

// ── Interruption gate [AUDIT P0-1] ─────────────────────────────────────────
// The phase-end modal must never stack invisibly under an open practice
// session, vault drawer or mock exam (z-tie + DOM order used to bury it while
// the state machine waited on a button nobody could see). While any of those
// own the user's attention, queue the notification instead: the bell still
// plays now, and the modal appears the instant focus frees.
let _queuedNotify = null;
function notifyOrQueue(title, icon, message, nextAction, receiptHTML) {
    if (SessionFocus.isBusy()) {
        _queuedNotify = { title, icon, message, nextAction, receiptHTML };
        playBell();
        _focusToast('⏳ Block finished — your receipt pops up as soon as you close this session.');
        return;
    }
    showTimerNotification(title, icon, message, nextAction, receiptHTML);
}
function _flushQueuedNotify() {
    if (!_queuedNotify) return;
    // Macrotask defer so a same-tick release→re-acquire (drawer swap) wins.
    setTimeout(() => {
        if (!_queuedNotify) return;
        if (SessionFocus.isBusy()) return;
        if (typeof timerInterval !== 'undefined' && timerInterval) { _queuedNotify = null; return; } // new block started meanwhile — stale
        const q = _queuedNotify; _queuedNotify = null;
        showTimerNotification(q.title, q.icon, q.message, q.nextAction, q.receiptHTML);
    }, 0);
}
try { document.addEventListener('jmax:focus-released', _flushQueuedNotify); } catch (_) {}
try { document.addEventListener('visibilitychange', () => { if (!document.hidden) _flushQueuedNotify(); }); } catch (_) {}

function _focusToast(msg) {
    try {
        document.querySelectorAll('.pomo-focus-toast').forEach(t => t.remove());
        const t = document.createElement('div');
        t.className = 'pomo-focus-toast';
        t.textContent = msg;
        t.style.cssText = 'position:fixed;z-index:100001;bottom:calc(22px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);max-width:86vw;padding:10px 16px;background:rgba(15,17,26,.96);border:1px solid rgba(255,178,36,.35);border-radius:999px;color:#ffd9a0;font-size:12.5px;box-shadow:0 8px 30px rgba(0,0,0,.45);pointer-events:none;';
        document.body.appendChild(t);
        setTimeout(() => { try { t.remove(); } catch (_) {} }, 4200);
    } catch (_) {}
}

// ---- Timer Notification Popup ----
// receiptHTML (optional) renders a session receipt — what the finished block
// paid out — inside the modal. Kept as escaped, pre-built markup rows.
function showTimerNotification(title, icon, message, nextAction, receiptHTML) {    _pomoPendingAction = nextAction;
    _setNotifyVariant('');
    $('notify-title').textContent = title;
    $('notify-icon').textContent = icon;
    $('notify-message').textContent = message;

    const receipt = $('notify-receipt');
    if (receipt) {
        if (receiptHTML) { receipt.innerHTML = receiptHTML; receipt.hidden = false; }
        else { receipt.innerHTML = ''; receipt.hidden = true; }
    }
    const secondary = $('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    const primary = $('notify-primary');
    if (primary) primary.textContent = "Let's Go";

    playBell(); // bell now safe to call

    $('timer-notify-modal').classList.add('active');

    $('btn-start').style.display = 'none';
    $('btn-pause').style.display = 'none';
    $('btn-quit').style.display = 'none';
    $('break-actions').classList.remove('active');
    $('pomo-mini-widget').classList.add('hidden');
}

/** Theme #timer-notify-modal for the Lock-In variants (victory/breach/complete). */
function _setNotifyVariant(variant) {
    _notifyVariant = variant || null;
    const modal = document.getElementById('timer-notify-modal');
    if (!modal || typeof modal.setAttribute !== 'function') return;
    if (variant) modal.setAttribute('data-notify-variant', variant);
    else modal.removeAttribute('data-notify-variant');
}

function _receiptRows(rows) {
    return rows.map(r => `<div class="receipt-row"><span>${r.k}</span><b>${r.v}</b></div>`).join('');
}

/** Receipt for a completed study block: payout, chain state, ELO earned. */
function _blockCompletionReceipt(plannedSecs) {
    const rows = [
        { k: 'Block', v: `${formatTime(plannedSecs)} · ${studySubject.toUpperCase()}` },
        { k: 'Chain', v: `${focusLedger.chain} deep block${focusLedger.chain === 1 ? '' : 's'} without a forfeit` },
        { k: 'Deep today', v: formatStudyDuration(focusLedger.deep) },
    ];
    try {
        const A = window.AppState;
        if (_blockEloSnap && A && A.elo) {
            // Snapshot subject — dynamic mode may have switched mid-block.
            const subj = _blockEloSnap.subj || studySubject;
            const dSubject = Math.round((A.elo[subj] || 0) - _blockEloSnap.s);
            if (dSubject !== 0) rows.push({ k: 'Earned this block', v: `${dSubject > 0 ? '+' : ''}${dSubject} ${subj.toUpperCase()} ELO` });
        }
    } catch (_) {}
    return _receiptRows(rows);
}

export function confirmTimerNotification() {
    const variant = _notifyVariant;
    $('timer-notify-modal').classList.remove('active');
    const secondary = $('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    _setNotifyVariant('');
    // Lock-In variants own their own confirm semantics.
    if (variant === 'breach') { stayLockedIn(); return; }
    if (variant === 'victory' || variant === 'complete') return;
    if (_pomoPendingAction) {
        const action = _pomoPendingAction;
        _pomoPendingAction = null;
        action();
    } else {
        resetPomoUI();
    }
}

/** "Keep Going" / "Stay Locked In" — un-breaks the clock and resumes. */
export function notifyKeepGoing() {
    const variant = _notifyVariant;
    $('timer-notify-modal').classList.remove('active');
    const secondary = $('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    _setNotifyVariant('');
    _pomoPendingAction = null;
    if (variant === 'breach') { voidLockinBlock(); return; }
    $('pomo-mini-widget').classList.remove('hidden');
    resumeTimer();
}

// ── Quit friction ─────────────────────────────────────────────────────────
// Abandoning a live study block is the one destructive action in the focus
// engine, so it costs a confirmation that names the price: the seconds that
// still count, and the chain that doesn't survive.
function requestQuitConfirm() {
    // Freeze the clock exactly like pauseTimer so "Keep Going" resumes clean.
    clearInterval(timerInterval);
    // Elapsed must respect an already-paused clock: while paused,
    // timerStartTime is stale and pausedElapsed holds the truth.
    const elapsed = isPaused
        ? Math.max(0, pausedElapsed)
        : Math.max(0, Math.floor((Date.now() - timerStartTime) / 1000));
    isPaused = true;
    lastTickAt = null;
    pausedElapsed = elapsed;

    _pomoPendingAction = () => _finalizeQuit(true);

    $('notify-title').textContent = 'Break the chain?';
    $('notify-icon').textContent = '⛓️';
    $('notify-message').textContent =
        `${formatTime(elapsed)} of ${studySubject.toUpperCase()} still counts — but your ${focusLedger.chain}-block chain resets to zero.`;

    const receipt = $('notify-receipt');
    if (receipt) {
        receipt.innerHTML = _receiptRows([
            { k: 'Kept', v: `${formatTime(elapsed)} logged to ${studySubject.toUpperCase()}` },
            { k: 'Lost', v: focusLedger.chain > 0 ? `chain of ${focusLedger.chain} → 0` : 'nothing — no chain live' },
            { k: 'Forfeits today', v: String(focusLedger.forfeit + 1) },
        ]);
        receipt.hidden = false;
    }
    const secondary = $('notify-secondary');
    if (secondary) secondary.style.display = 'block';

    // No bell here — this modal is a warning, not a reward.
    $('timer-notify-modal').classList.add('active');
    $('btn-start').style.display = 'none';
    $('btn-pause').style.display = 'none';
    $('btn-quit').style.display = 'none';
    $('break-actions').classList.remove('active');
    $('pomo-mini-widget').classList.add('hidden');
}

/** Actual teardown. countForfeit=true burns the chain and logs the forfeit. */
function _finalizeQuit(countForfeit) {
    clearInterval(timerInterval);
    // ── Night Guard: log session end for sleep-debt ledger ──
    try { NightGuard.logSessionEnd(); } catch (_) {}
    saveAllAsync().catch(console.error);
    GalleryBreak.abort();
    // ── CNS Load: pomodoro quit resets session-length tracking ──
    try { if (window.__cnsLoad) window.__cnsLoad.onPomodoroQuit(studySubject); } catch (_) {}
    _setDeepWorkActive(false);
    syncWidgetPaused(false);

    $('timer-notify-modal').classList.remove('active');
    const secondary = $('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    _pomoPendingAction = null;

    if (countForfeit && pomoState === 'STUDY') {
        const elapsed = isPaused ? pausedElapsed : Math.max(0, Math.floor((Date.now() - timerStartTime) / 1000));
        _ledgerForfeit(elapsed);
        try { window.dispatchEvent(new CustomEvent('jmax:pomo-forfeit')); } catch (_) {}   // sprout-isle: gentle forfeit cue
    } else if (pomoState === 'STOPWATCH') {
        // Stopping a stopwatch is finishing it — real minutes were logged.
        // _ledgerCompleteBlock owns the deep tally for qualifying runs; adding
        // stopwatchAccumulated here as well used to DOUBLE-count every
        // stopwatch stop (audit: "Deep today" inflated 2×).
        if (stopwatchAccumulated >= 300) _ledgerCompleteBlock(stopwatchAccumulated);
        else { focusLedger.deep += Math.max(0, stopwatchAccumulated | 0); _saveFocusLedger(); }
    }

    timerEndTriggered = true; // prevent handleTimerEnd from firing later
    lastTickAt = null;
    $('timer-status').textContent = countForfeit ? "Session Forfeit." : "Tracking Stopped.";
    hydrateFocusStats();
    try {
        const _h = new Date().getHours();
        if ((_h >= 21 || _h < 5) && window.TuckIn && typeof window.TuckIn.renderDoor === 'function') {
            window.TuckIn.renderDoor();
        }
    } catch (_) {}
    if (_resetPomoTimer) clearTimeout(_resetPomoTimer);
    _resetPomoTimer = setTimeout(() => resetPomoUI(), 1000);
}

// ---- Core timer tick (real-time based) ----
function tickDelta() {
    const now = Date.now();
    if (lastTickAt === null) lastTickAt = now;
    const delta = Math.max(1, Math.floor((now - lastTickAt) / 1000));
    lastTickAt = now;
    return delta;
}

// Credit real wall-clock seconds to the active subject (survives background
// throttling, which would otherwise undercount study time and skip saves).
function creditStudySeconds(subject, deltaSecs) {
    if (!deltaSecs || deltaSecs < 1) return;
    studySecs[subject] += deltaSecs;
    updateStudyTimeHeader();
    const minute = Math.floor(studySecs[subject] / 60);
    if (minute > lastSavedStudyMinute) {
        lastSavedStudyMinute = minute;
        saveAllAsync().catch(console.error);
    }
}

export function executeTimerTick() {
    if (!timerStartTime) return; // safety

    const now = Date.now();
    const deltaSecs = tickDelta();
    const elapsed = Math.floor((now - timerStartTime) / 1000);

    if (pomoState === 'STOPWATCH') {
        // Count up from previous accumulated time
        secondsLeft = stopwatchAccumulated + elapsed;
        $('timer-display').textContent = formatTime(secondsLeft);
        $('mini-time').textContent = formatTime(secondsLeft);

        // Update study seconds and save periodically
        creditStudySeconds(studySubject, deltaSecs);

    } else {
        // Countdown: recalc remaining from true elapsed time
        secondsLeft = Math.max(0, timerTotalSeconds - elapsed);
        $('timer-display').textContent = formatTime(secondsLeft);
        $('mini-time').textContent = formatTime(secondsLeft);

        const percent = timerTotalSeconds ? ((timerTotalSeconds - secondsLeft) / timerTotalSeconds) * 100 : 0;
        if (visualMode === 'bar') {
            $('pomo-progress').style.width = `${percent}%`;
        } else {
            $('pomo-beaker-fill').style.height = `${percent}%`;
        }
        _updateMiniRing(percent / 100);

        // Gallery Break: the burn reveal tracks break progress 1:1 (pause
        // stops the ticks, freezing the burn mid-char).
        if (pomoState === 'BREAK') GalleryBreak.setProgress(percent / 100);

        // Study time tracking (counts real seconds passed since last tick)
        if (pomoState === 'STUDY') {
            const credited = Math.min(deltaSecs, secondsLeft);
            creditStudySeconds(studySubject, credited);
            _blockCreditedSecs += credited;
        }

        // End condition
        if (secondsLeft <= 0 && !timerEndTriggered) {
            timerEndTriggered = true;
            clearInterval(timerInterval);
            saveAllAsync().catch(console.error);
            handleTimerEnd();
        }
    }
}

// ---- What happens when timer reaches 0 ----
function handleTimerEnd() {
    $('pomo-mini-widget').classList.add('hidden');
    _setDeepWorkActive(false);   // block over — the ×1.5 window closes with it

    if (pomoState === 'STUDY') {
        // ── Night Guard: a naturally-completed focus block is a session end
        // for the sleep-debt ledger (quit already logs its own).
        try { NightGuard.logSessionEnd(); } catch (_) {}
        // ── Ledger: a block that ran to its planned end is a completed block.
        // Deep-time counts seconds actually credited (pause froze the clock);
        // billing the planned total used to log phantom deep minutes whenever
        // the block was paused along the way.
        const deepSecs = Math.max(0, Math.min(_blockCreditedSecs | 0, timerTotalSeconds | 0));
        _ledgerCompleteBlock(deepSecs);
        try { window.dispatchEvent(new CustomEvent('jmax:pomo-block-done')); } catch (_) {}   // sprout-isle: rain moment
        const receipt = _blockCompletionReceipt(timerTotalSeconds);
        _blockEloSnap = null;
        hydrateFocusStats();
        if (currentSession < totalSessions) {
            notifyOrQueue(
                '🍅 Focus Session Done!',
                '🧘',
                'Take a break. You earned it.',
                startBreakAfterPopup,
                receipt
            );
        } else {
            notifyOrQueue(
                '🏁 All Focus Blocks Complete',
                '🎉',
                'Pomodoro cycle finished. Great work!',
                finishAllAfterPopup,
                receipt
            );
        }
        try {
            const _h = new Date().getHours();
            if ((_h >= 21 || _h < 5) && window.TuckIn && typeof window.TuckIn.renderDoor === 'function') {
                window.TuckIn.renderDoor();
            }
        } catch (_) {}
    } else if (pomoState === 'BREAK') {
        currentSession++;
        // Gallery Break replaces the "☕ Break Over" popup: full reveal → quote
        // → Continue → reverse burn → next study session. Falls back to the
        // classic popup if the overlay never came up (defensive).
        if (GalleryBreak.isActive()) {
            playBell();
            GalleryBreak.finish(startStudyAfterBreakPopup);
        } else {
            notifyOrQueue(
                '☕ Break Over',
                '⚡',
                `Ready for session ${currentSession} of ${totalSessions}?`,
                startStudyAfterBreakPopup
            );
        }
    }
}

function startBreakAfterPopup() {
    $('pomo-mini-widget').classList.remove('hidden');
    transitionToBreak();
}

function startStudyAfterBreakPopup() {
    $('pomo-mini-widget').classList.remove('hidden');
    transitionToStudy();
}

function finishAllAfterPopup() {
    finishAll();
}

// ---- Stopwatch toggle (unchanged UI) ----
// Pure UI reflection of isStopwatchMode — no state mutation, no side effects.
// Shared by the user toggle AND applyPomoConfig (boot restore) so a config
// restore never trips toggle side effects (e.g. toggleStopwatchMode always
// runs resetPomoUI()).
function _syncStopwatchUI() {
    const targetBtn = $('stopwatch-toggle-btn');
    if (targetBtn) {
        targetBtn.textContent = isStopwatchMode ? 'On' : 'Off';
        targetBtn.style.background = isStopwatchMode ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.08)';
        targetBtn.style.borderColor = isStopwatchMode ? 'rgba(34, 197, 94, 0.4)' : 'rgba(255, 255, 255, 0.1)';
        targetBtn.style.color = isStopwatchMode ? '#4ade80' : '#fff';
    }

    const inputs = document.querySelectorAll('.pomodoro-controls .input-group');
    if (inputs.length >= 4) {
        inputs[1].style.display = isStopwatchMode ? 'none' : 'flex';
        inputs[2].style.display = isStopwatchMode ? 'none' : 'flex';
        inputs[3].style.display = isStopwatchMode ? 'none' : 'flex';
    }
}

// Pure UI reflection of dynamicSubject — same rationale as _syncStopwatchUI.
function _syncDynamicSubjectUI() {
    const targetBtn = $('dynamic-subject-btn');
    if (targetBtn) {
        targetBtn.classList.toggle('on', dynamicSubject);
        targetBtn.title = dynamicSubject
            ? 'Dynamic mode ON: switch subject mid-session — time is tracked per subject'
            : 'Dynamic mode OFF: subject is locked for the session';
    }
    // Tells the Focus tab CSS to keep the setup strip fully live while a
    // dynamic session runs (mid-block subject switching stays usable).
    try { if (document.body) document.body.classList.toggle('pomo-dynamic', !!dynamicSubject); } catch (_) {}

    // While running, keep the subject picker usable (or re-lock it).
    if (pomoState !== 'IDLE') {
        const select = $('pomo-subject');
        if (select) select.disabled = !dynamicSubject;
    }
}

export function toggleStopwatchMode(btn) {
    isStopwatchMode = !isStopwatchMode;

    // Mode switch: no chain-break drama — tear down WITHOUT the forfeit
    // bookkeeping a manual STUDY quit triggers (quitTimer(true) used to burn
    // the chain and log a forfeit for an ordinary settings toggle).
    if (pomoState !== 'IDLE') _finalizeQuit(false);
    _syncStopwatchUI();
    resetPomoUI();
}

// ---- Start timer (real-time initialisation) ----
export function startTimer() {
    if (pomoState !== 'IDLE') return;
    // Cancel any pending quitTimer UI reset so a fresh session is not stomped.
    if (_resetPomoTimer) { clearTimeout(_resetPomoTimer); _resetPomoTimer = null; }
    // ── Night Guard: log session start for sleep-debt ledger ──
    try { NightGuard.logSessionStart(); } catch (_) {}
    syncFilterLock();
    const chosenSubject = $('pomo-subject').value;
    studySubject = isValidSubjectKey(chosenSubject) ? chosenSubject : 'physics';
    document.querySelectorAll('#view-pomodoro .pomo-input, #view-pomodoro .pomo-select').forEach(el => el.disabled = true);
    if (dynamicSubject) $('pomo-subject').disabled = false;
    updateMiniSubject();
    $('btn-start').style.display = 'none';

    // Initialize audio context on user gesture
    initAudioContext();
    // Soft ignition chord — counterweight to playBell() at session end
    playStartChime();

    if (isStopwatchMode) {
        transitionToStopwatch();
    } else {
        totalSessions = parseInt($('pomo-sessions').value) || 1;
        currentSession = 1;
        transitionToStudy();
    }

    // Set start time and reset end flag
    timerStartTime = Date.now();
    timerEndTriggered = false;

// Persist the exact configuration this session was launched with, so a
// later boot (or the Daily Briefing flow) can restore it verbatim.
// Mode toggles (stopwatch / dynamic) are captured here too — only started
// sessions persist config; a bare toggle alone isn't saved until a session
// actually begins.
savePomoConfig();
}

export function transitionToStopwatch() {
    pomoState = 'STOPWATCH';
    secondsLeft = 0;
    stopwatchAccumulated = 0; // start fresh
    timerTotalSeconds = 0;    // not used
    $('timer-status').textContent = `Stopwatch: ${studySubject.toUpperCase()}`;

    $('pomo-mini-widget').classList.remove('hidden');
    $('mini-status').textContent = 'STOPWATCH';
    $('mini-status').className = 'mini-status study';
    updateMiniSubject();
    syncWidget('study');
    syncWidgetPaused(false);
    _setDeepWorkActive(true);   // stopwatch grind earns the ×1.5 too
    // Soundscape bridge: stopwatch grind gets the bed too (if enabled).
    try { if (window.FocusSound && window.FocusSound.autoStart) window.FocusSound.autoStart(); } catch (_) {}
    _updateMiniRing(1);
    _updateMiniTally();

    $('btn-pause').style.display = 'inline-block';
    $('btn-pause').textContent = "Pause";
    $('btn-pause').onclick = pauseTimer;
    $('btn-quit').style.display = 'inline-block';
    $('btn-quit').textContent = "Stop";
    $('break-actions').classList.remove('active');

    $('pomo-progress').style.background = 'var(--gradient-glow)';
    $('pomo-progress').style.width = '100%';

    isPaused = false;
    timerStartTime = Date.now(); // mark real start
    lastTickAt = Date.now();
    timerInterval = setInterval(executeTimerTick, 1000);
}

export function transitionToStudy() {
    pomoState = 'STUDY';
    const studyVal = parseInt($('pomo-study').value) || 50;
    timerTotalSeconds = studyVal * 60;
    secondsLeft = timerTotalSeconds;
    $('timer-status').textContent = `Studying ${studySubject.toUpperCase()} (${currentSession}/${totalSessions})`;

    $('pomo-mini-widget').classList.remove('hidden');
    $('mini-status').textContent = `STUDY ${currentSession}/${totalSessions}`;
    $('mini-status').className = 'mini-status study';
    updateMiniSubject();
    syncWidget('study');
    syncWidgetPaused(false);
    _setDeepWorkActive(true);   // live ×1.5 deep-work window opens now
    _blockEloSnap = _eloSnapshot();   // receipt measures what this block earns
    // Soundscape bridge: start the user's bed with the block (if enabled).
    try { if (window.FocusSound && window.FocusSound.autoStart) window.FocusSound.autoStart(); } catch (_) {}
    _updateMiniRing(0);
    _updateMiniEnd();
    _updateMiniTally();

    $('btn-pause').style.display = 'inline-block';
    $('btn-pause').textContent = "Pause";
    $('btn-pause').onclick = pauseTimer;
    $('btn-quit').style.display = 'inline-block';
    $('btn-quit').textContent = "Quit";
    // Back to quit semantics (a BREAK phase rebinds this to skipBreak).
    $('btn-quit').onclick = () => quitTimer();
    $('break-actions').classList.remove('active');

    $('pomo-progress').style.background = 'var(--gradient-glow)';
    $('pomo-progress').style.width = '0%';
    $('pomo-beaker-fill').style.height = '0%';

    isPaused = false;
    timerStartTime = Date.now();
    timerEndTriggered = false; // a fresh study session must be able to end
    _blockCreditedSecs = 0;    // fresh block → fresh deep-time tally
    lastTickAt = Date.now();
    timerInterval = setInterval(executeTimerTick, 1000);
}

export function transitionToBreak() {
    pomoState = 'BREAK';
    const breakVal = parseInt($('pomo-break').value) || 10;
    timerTotalSeconds = breakVal * 60;
    secondsLeft = timerTotalSeconds;
    $('timer-status').textContent = `Break Time ☕ (${currentSession}/${totalSessions})`;

    $('pomo-mini-widget').classList.remove('hidden');
    $('mini-status').textContent = 'BREAK';
    $('mini-status').className = 'mini-status break';
    updateMiniSubject();
    syncWidget('break');
    syncWidgetPaused(false);
    _setDeepWorkActive(false);   // breaks don't pay the focus bonus
    _blockEloSnap = null;
    _updateMiniRing(0);
    _updateMiniEnd();

    $('btn-pause').style.display = 'inline-block';
    $('btn-pause').textContent = "Pause";
    $('btn-pause').onclick = pauseTimer;
    $('btn-quit').style.display = 'inline-block';
    $('btn-quit').textContent = "Skip Break";
    // The markup wires this button to quitTimer(); left alone it would tear
    // the whole run down ("Tracking Stopped.") instead of advancing to the
    // next study block. Rebind it to skipBreak for the break phase.
    $('btn-quit').onclick = skipBreak;
    $('break-actions').classList.remove('active');

    $('pomo-progress').style.background = 'var(--gradient-glow)';
    $('pomo-progress').style.width = '0%';
    $('pomo-beaker-fill').style.height = '0%';

    isPaused = false;
    timerStartTime = Date.now();
    timerEndTriggered = false;
    lastTickAt = Date.now();
    timerInterval = setInterval(executeTimerTick, 1000);

    // Gallery Break: start the burn reveal — whatever is open on screen
    // begins to char away from the center, revealing the painting.
    try { GalleryBreak.begin(); } catch (e) { console.warn('GalleryBreak failed to start', e); }
}

export function pauseTimer() {
    clearInterval(timerInterval);
    saveAllAsync().catch(console.error);
    isPaused = true;
    lastTickAt = null;

    const elapsed = Math.floor((Date.now() - timerStartTime) / 1000);
    if (pomoState === 'STOPWATCH') {
        // Accumulate the time that has passed
        stopwatchAccumulated += elapsed;
        secondsLeft = stopwatchAccumulated; // show current total
    } else {
        // Remember how far the countdown got so resume() can re-anchor the
        // real-time clock instead of restarting at full duration.
        pausedElapsed = elapsed;
    }
    _setDeepWorkActive(false);   // paused clock ≠ deep work — bonus closes
    syncWidgetPaused(true);
    _updateMiniEnd();
    $('timer-status').textContent = (pomoState === 'STOPWATCH') ? "Stopwatch Paused" : "Timer Paused";
    $('btn-pause').textContent = "Resume";
    $('btn-pause').onclick = resumeTimer;
}

export function resumeTimer() {
    isPaused = false;
    timerEndTriggered = false;
    lastTickAt = null;

    if (pomoState === 'STOPWATCH') {
        timerStartTime = Date.now(); // reset start point for real-time calculation
    } else {
        // Back-date the start point by the elapsed-so-far so the countdown
        // resumes from where it was paused, not from full duration.
        timerStartTime = Date.now() - pausedElapsed * 1000;
        pausedElapsed = 0;
    }

    if (pomoState === 'STOPWATCH') {
        $('timer-status').textContent = `Stopwatch: ${studySubject.toUpperCase()}`;
    } else if (pomoState === 'STUDY') {
        $('timer-status').textContent = `Studying ${studySubject.toUpperCase()} (${currentSession}/${totalSessions})`;
    } else {
        $('timer-status').textContent = `Break Time ☕ (${currentSession}/${totalSessions})`;
    }
    updateMiniSubject();
    if (pomoState === 'STUDY' || pomoState === 'STOPWATCH') _setDeepWorkActive(true);
    syncWidgetPaused(false);
    _updateMiniEnd();

    $('btn-pause').textContent = "Pause";
    $('btn-pause').onclick = pauseTimer;
    timerInterval = setInterval(executeTimerTick, 1000);
}

// Quitting a live STUDY block asks for confirmation first — the modal names
// the price (chain → 0) and offers "Keep Going". `force` skips the gate for
// programmatic callers (stopwatch mode toggle) and non-study states.
export function quitTimer(force) {
    if (pomoState === 'IDLE') return;
    if (!force && pomoState === 'STUDY' && !timerEndTriggered) {
        requestQuitConfirm();
        return;
    }
    _finalizeQuit(pomoState === 'STUDY');
}

export function resetPomoUI() {
    pomoState = 'IDLE';
    syncFilterLock();
    GalleryBreak.abort();
    $('timer-notify-modal').classList.remove('active');
    const secondary = $('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    _pomoPendingAction = null;
    if (_resetPomoTimer) { clearTimeout(_resetPomoTimer); _resetPomoTimer = null; }
    _setDeepWorkActive(false);
    _blockEloSnap = null;
    syncWidgetPaused(false);

    document.querySelectorAll('#view-pomodoro .pomo-input, #view-pomodoro .pomo-select').forEach(el => el.disabled = false);
    $('btn-start').style.display = 'inline-block';
    $('btn-pause').style.display = 'none';
    $('btn-quit').style.display = 'none';
    $('btn-quit').textContent = "Quit";
    $('break-actions').classList.remove('active');

    $('pomo-progress').style.width = '0%';
    $('pomo-beaker-fill').style.height = '0%';

    timerStartTime = null;
    timerEndTriggered = false;
    pausedElapsed = 0;
    lastTickAt = null;
    lastSavedStudyMinute = 0;

    if (isStopwatchMode) {
        $('timer-display').textContent = "00:00";
        $('timer-status').textContent = "Ready to Track";
    } else {
        const studyVal = parseInt($('pomo-study').value) || 50;
        $('timer-display').textContent = formatTime(studyVal * 60);
        $('timer-status').textContent = "Ready to Focus";
    }

    // Back to the always-visible idle pill — the one-tap entry point.
    const widget = $('pomo-mini-widget');
    if (widget) widget.classList.remove('hidden');
    syncWidget('idle');
    _updateMiniRing(0);
    hydrateFocusStats();
    _syncPopControls();
}

export function skipBreak() {
    clearInterval(timerInterval);
    saveAllAsync().catch(console.error);
    GalleryBreak.abort();   // skipped breaks don't get the reveal
    // If more sessions remain, go to next study; otherwise finish
    if (currentSession < totalSessions) {
        currentSession++;
        transitionToStudy();
    } else {
        finishAll();
    }
}

export function addBreakTime(extraMinutes) {
    if (pomoState !== 'BREAK') return;
    // Add extra minutes to the break (keep real‑time tracking)
    const extraSeconds = extraMinutes * 60;
    timerTotalSeconds += extraSeconds;
    secondsLeft += extraSeconds;
    // Update the timer display immediately
    $('timer-display').textContent = formatTime(secondsLeft);
    $('mini-time').textContent = formatTime(secondsLeft);
    _updateMiniEnd();
    // The next tick will handle the rest
}

export function finishAll() {
    clearInterval(timerInterval);
    saveAllAsync().catch(console.error);
    $('pomo-mini-widget').classList.add('hidden');
    $('timer-display').textContent = "00:00";
    $('timer-status').textContent = "All sessions complete!";
    // Reset UI fully
    resetPomoUI();
}

// ── Boot hydration of the always-visible surfaces ─────────────────────────
// The idle pill and the Focus view ledger must be truthful from the first
// paint, not only after the first session ends. Guarded — module may load
// under DOM stubs in the smoke tests.
try { hydrateFocusStats(); } catch (_) {}
try { _syncPopControls(); } catch (_) {}

// ═══════════════════════════════════════════════════════════════════════════
// LOCK-IN RITUAL ENGINE
// ---------------------------------------------------------------------------
// The deeply-integrated focus timer for Flow / Hardcore practice. There is no
// visible countdown while a question is on screen (zero clock anxiety): the
// background block runs in escrow, silently expires, and banks its time only
// when the block actually completes. Earned breaks bloom a Museum Glass HUD
// over the GalleryBreak painting and auto-ignite back into the same mode.
// ═══════════════════════════════════════════════════════════════════════════

const LOCKIN_MODES = ['flow', 'hardcore'];
const LOCKIN_KICKERS = {
    flow: '// FLOW STATE LOCK-IN · P(WIN) 75–85% · ×1.5 ELO',
    hardcore: '// OVERCLOCK CRUCIBLE · P(WIN) 35–50% · 1.8× WIN × 1.5× DEEP WORK',
};

/** Live Lock-In session state (also handed to app.js on confirm / resume). */
export const lockinSession = {
    active: false,
    mode: 'flow',
    subject: 'physics',
    chapter: '',
    chapterSelection: null,
    studyMins: 50,
    breakMins: 10,
    totalSessions: 1,
    currentSession: 1,
    phase: 'STUDY',                 // 'STUDY' | 'BREAK'
    expiredPendingTransition: false,
    solvedInRun: 0,
    startElo: 1200,
    running: false,
    voided: false,
};

let _lockinTimer = null;
let _lockinEndsAt = 0;
let _lockinTotalSecs = 0;
let _lockinLeftSecs = 0;
let _lockinCreditedSecs = 0;       // escrow seconds accrued this STUDY block
let _lockinPausedLeft = 0;
let _lockinOnConfirm = null;

// ── small helpers ─────────────────────────────────────────────────────────
function _clamp(n, lo, hi) { n = parseInt(n, 10); if (!isFinite(n)) n = lo; return Math.min(hi, Math.max(lo, n)); }
function _inputVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function _setInputVal(id, v) { const el = document.getElementById(id); if (el) el.value = String(v); }
function _currentSubjectElo(subj) {
    try { const A = window.AppState; return (A && A.elo && A.elo[subj]) || 1200; } catch (_) { return 1200; }
}
function _clearLockinTick() { if (_lockinTimer) { clearInterval(_lockinTimer); _lockinTimer = null; } }
function _isPracticeOpen() {
    const m = document.getElementById('practice-modal');
    return !!(m && m.classList && typeof m.classList.contains === 'function' && m.classList.contains('active'));
}
function _addPaceGlow() { const m = document.getElementById('practice-modal'); if (m) m.classList.add('pq-lockin-complete-glow'); }
function _removePaceGlow() { const m = document.getElementById('practice-modal'); if (m) m.classList.remove('pq-lockin-complete-glow'); }

// ── Session configuration draft / setup chamber ───────────────────────────
export function openLockinSetupModal(mode, context, onConfirmStart) {
    if (!LOCKIN_MODES.includes(mode)) return false;
    const ctx = context || {};
    lockinSession.mode = mode;
    lockinSession.subject = isValidSubjectKey(ctx.subject) ? ctx.subject
        : (isValidSubjectKey(studySubject) ? studySubject : 'physics');
    lockinSession.chapter = ctx.chapter || '';
    lockinSession.chapterSelection = Array.isArray(ctx.chapterSelection) ? ctx.chapterSelection.slice() : null;
    lockinSession.startElo = _currentSubjectElo(lockinSession.subject);
    lockinSession.voided = false;
    _lockinOnConfirm = typeof onConfirmStart === 'function' ? onConfirmStart : null;

    // Seed the draft from the last-used config so returning users land on
    // their habitual block length.
    const cfg = readPomoConfig();
    const defRounds = cfg && cfg.sessions >= 2 ? cfg.sessions : 2;
    _setInputVal('lockin-grind', _clamp(cfg ? cfg.study : 50, 5, 180));
    _setInputVal('lockin-chill', _clamp(cfg ? cfg.break : 10, 1, 60));
    _setInputVal('lockin-rounds', _clamp(defRounds, 1, 8));

    const modal = document.getElementById('lockin-setup-modal');
    if (modal && typeof modal.setAttribute === 'function') modal.setAttribute('data-lockin-mode', mode);
    const kicker = document.getElementById('lockin-kicker');
    if (kicker) kicker.textContent = LOCKIN_KICKERS[mode] || LOCKIN_KICKERS.flow;
    const title = document.getElementById('lockin-title');
    if (title) title.textContent = mode === 'hardcore' ? 'Enter the Crucible' : 'Sign the Pact';

    _syncLockinPresetActive();
    _renderLockinTimeline();
    _renderLockinChain();
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
    }
    return true;
}

export function closeLockinSetupModal() {
    const el = document.getElementById('lockin-setup-modal');
    if (el) {
        el.classList.remove('active');
        setTimeout(() => { if (!el.classList.contains('active')) el.style.display = 'none'; }, 250);
    }
    _lockinOnConfirm = null;
}

/** Commit the pact: persist the draft, chime, start the block, open practice. */
export function confirmLockinSetup() {
    const study = _clamp(_inputVal('lockin-grind'), 5, 180);
    const chill = _clamp(_inputVal('lockin-chill'), 1, 60);
    const rounds = _clamp(_inputVal('lockin-rounds'), 1, 8);
    lockinSession.studyMins = study;
    lockinSession.breakMins = chill;
    lockinSession.totalSessions = rounds;
    lockinSession.currentSession = 1;
    lockinSession.active = true;
    lockinSession.solvedInRun = 0;
    lockinSession.startElo = _currentSubjectElo(lockinSession.subject);
    studySubject = lockinSession.subject;
    try {
        localStorage.setItem(POMO_CONFIG_KEY, JSON.stringify({
            subject: lockinSession.subject, study, break: chill, sessions: rounds,
            stopwatch: false, dynamic: false,
        }));
    } catch (_) {}

    const cb = _lockinOnConfirm;
    _lockinOnConfirm = null;
    closeLockinSetupModal();
    _removePaceGlow();
    initAudioContext();
    playStartChime();
    _startLockinStudy();

    if (cb) { try { cb(lockinSession); } catch (e) { console.warn('[lockin] confirm callback failed', e); } }
}

export function applyLockinPreset(grind, chill) {
    _setInputVal('lockin-grind', _clamp(grind, 5, 180));
    _setInputVal('lockin-chill', _clamp(chill, 1, 60));
    _syncLockinPresetActive();
    _renderLockinTimeline();
}

export function stepLockinField(field, delta) {
    const map = { grind: ['lockin-grind', 5, 180], chill: ['lockin-chill', 1, 60], rounds: ['lockin-rounds', 1, 8] };
    const spec = map[field];
    if (!spec) return;
    const [id, lo, hi] = spec;
    const cur = parseInt(_inputVal(id), 10) || lo;
    _setInputVal(id, _clamp(cur + (parseInt(delta, 10) || 0), lo, hi));
    _syncLockinPresetActive();
    _renderLockinTimeline();
}

export function refreshLockinTimeline() { _syncLockinPresetActive(); _renderLockinTimeline(); }

function _syncLockinPresetActive() {
    const grind = parseInt(_inputVal('lockin-grind'), 10);
    const chill = parseInt(_inputVal('lockin-chill'), 10);
    const btns = document.querySelectorAll('#lockin-presets .lockin-preset');
    if (!btns || !btns.forEach) return;
    btns.forEach(btn => {
        const g = parseInt(btn.dataset && btn.dataset.grind, 10);
        const c = parseInt(btn.dataset && btn.dataset.chill, 10);
        btn.classList.toggle('active', g === grind && c === chill);
    });
}

function _renderLockinTimeline() {
    const study = _clamp(_inputVal('lockin-grind'), 5, 180);
    const chill = _clamp(_inputVal('lockin-chill'), 1, 60);
    const rounds = _clamp(_inputVal('lockin-rounds'), 1, 8);
    const total = study * rounds + chill * Math.max(0, rounds - 1);

    const track = document.getElementById('lockin-timeline-track');
    if (track) {
        let html = '';
        for (let r = 0; r < rounds; r++) {
            html += `<span class="lt-block lt-grind" style="flex:${study} 1 0">GRIND ${study}m</span>`;
            if (r < rounds - 1) html += `<span class="lt-block lt-rest" style="flex:${chill} 1 0">REST ${chill}m</span>`;
        }
        track.innerHTML = html;
    }
    const totalEl = document.getElementById('lockin-total-time');
    if (totalEl) {
        const h = Math.floor(total / 60);
        totalEl.textContent = (h > 0 ? `${h}h ${total % 60}m` : `${total}m`) + ' committed';
    }
    const fin = document.getElementById('lockin-finish-time');
    if (fin) {
        const end = new Date(Date.now() + total * 60 * 1000);
        let label = '--:--';
        try { label = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (_) {}
        fin.textContent = 'Finishes at ' + label;
    }
}

function _renderLockinChain() {
    const pips = document.getElementById('lockin-chain-pips');
    if (pips) {
        const n = focusLedger.chain;
        const slots = Math.max(5, n, Math.min(focusLedger.best, 10));
        let html = '';
        for (let i = 0; i < slots; i++) html += `<span class="chain-pip${i < n ? ' lit' : ''}${i === n - 1 ? ' tip' : ''}"></span>`;
        pips.innerHTML = html;
    }
    const cn = document.getElementById('lockin-chain-n');
    if (cn) cn.textContent = String(focusLedger.chain);
}

// ── Study / break phase machine ───────────────────────────────────────────
function _startLockinStudy() {
    lockinSession.phase = 'STUDY';
    lockinSession.running = true;
    lockinSession.expiredPendingTransition = false;
    studySubject = lockinSession.subject;
    _lockinTotalSecs = Math.max(1, lockinSession.studyMins) * 60;
    _lockinLeftSecs = _lockinTotalSecs;
    _lockinCreditedSecs = 0;
    _lockinEndsAt = Date.now() + _lockinTotalSecs * 1000;
    _setDeepWorkActive(true);
    _removePaceGlow();
    _clearLockinTick();
    _lockinTimer = setInterval(_lockinTick, 1000);
    try { NightGuard.logSessionStart(); } catch (_) {}
}

function _lockinTick() {
    if (!lockinSession.active || !lockinSession.running) return;
    const left = Math.max(0, Math.round((_lockinEndsAt - Date.now()) / 1000));
    const delta = Math.max(1, _lockinLeftSecs - left);
    _lockinLeftSecs = left;
    if (lockinSession.phase === 'STUDY') {
        _lockinCreditedSecs += delta;
        if (left <= 0) { _onLockinStudyExpire(); return; }
    } else {
        _updateLockinBreakHud();
        if (left <= 0) { _onLockinBreakExpire(); return; }
    }
}

function _elapsedStudySecs() {
    const fromLeft = Math.max(0, _lockinTotalSecs - _lockinLeftSecs);
    return Math.min(_lockinTotalSecs, Math.max(fromLeft, _lockinCreditedSecs | 0));
}

/** Deposit the escrowed block into the day's ledger + study-time counters. */
function _commitCompletedStudyBlock() {
    const secs = _elapsedStudySecs();
    _lockinCreditedSecs = 0;
    if (secs <= 0) return 0;
    const subj = lockinSession.subject;
    studySubject = subj;
    studySecs[subj] += secs;
    try { updateStudyTimeHeader(); } catch (_) {}
    _ledgerCompleteBlock(secs);
    try { saveAllAsync().catch(() => {}); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('jmax:pomo-block-done')); } catch (_) {}
    return secs;
}

function _onLockinStudyExpire() {
    _clearLockinTick();
    lockinSession.running = false;
    _lockinLeftSecs = 0;
    // Silent expiry — never interrupt a live solve.
    if (_isPracticeOpen()) {
        lockinSession.expiredPendingTransition = true;
        _addPaceGlow();
        return;
    }
    _commitCompletedStudyBlock();
    _advanceToBreakOrFinish();
}

function _advanceToBreakOrFinish() {
    _setDeepWorkActive(false);
    _removePaceGlow();
    try { NightGuard.logSessionEnd(); } catch (_) {}
    if (lockinSession.currentSession < lockinSession.totalSessions) {
        _startLockinBreak();
    } else {
        _finishLockinCycle();
    }
}

function _startLockinBreak() {
    lockinSession.phase = 'BREAK';
    lockinSession.running = true;
    _lockinTotalSecs = Math.max(1, lockinSession.breakMins) * 60;
    _lockinLeftSecs = _lockinTotalSecs;
    _lockinCreditedSecs = 0;
    _lockinEndsAt = Date.now() + _lockinTotalSecs * 1000;
    _clearLockinTick();
    _lockinTimer = setInterval(_lockinTick, 1000);
    playBell();
    try { GalleryBreak.begin(); } catch (e) { console.warn('[lockin] GalleryBreak failed', e); }
    _showLockinBreakHud();
}

function _onLockinBreakExpire() {
    _clearLockinTick();
    lockinSession.running = false;
    _endLockinBreak();
}

export function skipLockinRest() {
    if (!lockinSession.active || lockinSession.phase !== 'BREAK') return;
    _clearLockinTick();
    lockinSession.running = false;
    _endLockinBreak();
}

export function addLockinRest(mins) {
    if (!lockinSession.active || lockinSession.phase !== 'BREAK') return;
    const extra = Math.max(0, parseInt(mins, 10) || 0) * 60;
    _lockinTotalSecs += extra;
    _lockinLeftSecs += extra;
    _lockinEndsAt += extra * 1000;
    _updateLockinBreakHud();
}

function _endLockinBreak() {
    try { GalleryBreak.abort(); } catch (_) {}
    _hideLockinBreakHud();
    if (!lockinSession.active) return;
    lockinSession.currentSession += 1;
    _startLockinStudy();
    // Auto-ignition: re-open the practice stage in the exact same mode.
    const resume = (typeof window !== 'undefined') ? window.__resumePracticeFromLockinBreak : null;
    if (typeof resume === 'function') {
        try { resume(lockinSession); } catch (e) { console.warn('[lockin] resume failed', e); }
    }
}

/** Clean exit from the break HUD after a completed block — no penalty. */
export function endLockinSession() {
    if (!lockinSession.active) return;
    // The HUD only shows between blocks; guard a mid-study call anyway.
    if (lockinSession.phase === 'STUDY' && lockinSession.running && !lockinSession.expiredPendingTransition) {
        requestLockinEarlyExitConfirm();
        return;
    }
    _clearLockinTick();
    lockinSession.running = false;
    try { GalleryBreak.abort(); } catch (_) {}
    _hideLockinBreakHud();
    _setDeepWorkActive(false);
    _resetLockinState();
    try { if (typeof window.closePracticeModal === 'function') window.closePracticeModal(); } catch (_) {}
}

function _finishLockinCycle() {
    _removePaceGlow();
    _resetLockinState();
    try { if (typeof window.closePracticeModal === 'function') window.closePracticeModal(); } catch (_) {}
    showLockinComplete();
}

function _resetLockinState() {
    _clearLockinTick();
    lockinSession.active = false;
    lockinSession.running = false;
    lockinSession.expiredPendingTransition = false;
    lockinSession.phase = 'STUDY';
    lockinSession.currentSession = 1;
    lockinSession.solvedInRun = 0;
    _lockinCreditedSecs = 0;
    _lockinLeftSecs = 0;
    _lockinTotalSecs = 0;
    _removePaceGlow();
}

// ── Public queries / hooks consumed by app.js ─────────────────────────────
export function isLockinStudyRunning() {
    return !!(lockinSession.active && lockinSession.phase === 'STUDY' &&
        lockinSession.running && !lockinSession.expiredPendingTransition && _lockinLeftSecs > 0);
}

/** Count a solved question toward the run's telemetry receipt. */
export function noteLockinSolve() {
    if (lockinSession.active) lockinSession.solvedInRun += 1;
}

/**
 * Called when the user advances, skips, parks or closes the practice stage.
 * If the background block already expired, banks its escrow time and moves to
 * the earned break (or final receipt). Returns true when it handled the exit
 * (the caller should not proceed with its own advance).
 */
export function consumePendingLockinExpiry() {
    if (!lockinSession.active) return false;
    if (!lockinSession.expiredPendingTransition) return false;
    lockinSession.expiredPendingTransition = false;
    _removePaceGlow();
    _commitCompletedStudyBlock();
    // Close the practice stage first so the earned painting can bloom unblocked.
    try { if (typeof window.closePracticeModal === 'function') window.closePracticeModal(); } catch (_) {}
    _advanceToBreakOrFinish();
    return true;
}

/** Mid-timer answer-pool exhaustion — bank everything and crown the run. */
export function completeLockinOnPoolExhausted() {
    if (!lockinSession.active) return false;
    const elapsed = _elapsedStudySecs();
    const solved = lockinSession.solvedInRun | 0;
    const mode = lockinSession.mode;
    const subject = lockinSession.subject;
    const netElo = _currentSubjectElo(subject) - lockinSession.startElo;
    const chain = focusLedger.chain;
    _commitCompletedStudyBlock();
    _clearLockinTick();
    lockinSession.running = false;
    _setDeepWorkActive(false);
    _resetLockinState();
    const pm = document.getElementById('practice-modal');
    if (pm && !pm.classList.contains('hidden')) {
        if (typeof window.closePracticeModal === 'function') {
            try { window.closePracticeModal({ skipLockinCheck: true }); } catch (_) {}
        } else {
            pm.classList.add('hidden');
        }
    }
    showLockinVictory({ elapsed, solved, netElo, chain, mode });
    return true;
}

/** Contract-breach gate — pause the clock and ask before voiding the block. */
export function requestLockinEarlyExitConfirm() {
    if (!isLockinStudyRunning()) return false;
    _lockinPausedLeft = _lockinLeftSecs;
    _clearLockinTick();
    lockinSession.running = false;
    _setDeepWorkActive(false);
    showLockinBreach();
    return true;
}

/** "Stay Locked In" — resume the paused block. */
export function stayLockedIn() {
    if (!lockinSession.active) return;
    if (lockinSession.phase !== 'STUDY' || lockinSession.expiredPendingTransition) return;
    lockinSession.running = true;
    _lockinLeftSecs = Math.max(1, _lockinPausedLeft || _lockinLeftSecs);
    _lockinEndsAt = Date.now() + _lockinLeftSecs * 1000;
    _setDeepWorkActive(true);
    _clearLockinTick();
    _lockinTimer = setInterval(_lockinTick, 1000);
}

/** "Void Block & Exit" — discard the uncommitted escrow, break the chain. */
export function voidLockinBlock() {
    _clearLockinTick();
    const wasActive = lockinSession.active;
    lockinSession.running = false;
    lockinSession.active = false;
    lockinSession.voided = true;
    _lockinCreditedSecs = 0;
    _setDeepWorkActive(false);
    _removePaceGlow();
    try { GalleryBreak.abort(); } catch (_) {}
    _hideLockinBreakHud();
    if (wasActive) {
        _ledgerForfeit(0);
        try { window.dispatchEvent(new CustomEvent('jmax:pomo-forfeit')); } catch (_) {}
    }
    _resetLockinState();
    try { if (typeof window.exitPracticeMode === 'function') window.exitPracticeMode(); } catch (_) {}
}

// ── Break HUD ─────────────────────────────────────────────────────────────
function _showLockinBreakHud() {
    const hud = document.getElementById('lockin-break-hud');
    if (!hud) return;
    _updateLockinBreakHud();
    hud.classList.add('active');
}
function _hideLockinBreakHud() {
    const hud = document.getElementById('lockin-break-hud');
    if (hud) hud.classList.remove('active');
}
function _updateLockinBreakHud() {
    const badge = document.getElementById('lbh-badge');
    if (badge) badge.textContent = `✦ BLOCK ${lockinSession.currentSession}/${lockinSession.totalSessions} SEALED · +${lockinSession.studyMins}m BANKED`;
    const timeEl = document.getElementById('lbh-time');
    if (timeEl) timeEl.textContent = formatTime(Math.max(0, _lockinLeftSecs));
    const nextEl = document.getElementById('lbh-next');
    if (nextEl) {
        const icon = lockinSession.mode === 'hardcore' ? '⚡ Hardcore' : '🎯 Flow State';
        const chap = lockinSession.chapter ? ` (${lockinSession.chapter})` : '';
        nextEl.textContent = `Next: Round ${lockinSession.currentSession + 1}/${lockinSession.totalSessions} · ${icon}${chap}`;
    }
    const arc = document.getElementById('lbh-ring-arc');
    const p = _lockinTotalSecs ? Math.min(1, Math.max(0, 1 - (_lockinLeftSecs / _lockinTotalSecs))) : 0;
    try { GalleryBreak.setProgress(p); } catch (_) {}
    if (arc) {
        const circ = 2 * Math.PI * 19;
        arc.style.strokeDasharray = String(circ);
        arc.style.strokeDashoffset = String(circ * (1 - p));
    }
}

// ── Notification variants ─────────────────────────────────────────────────
export function showLockinVictory(data) {
    const d = data || {};
    _setNotifyVariant('victory');
    $('notify-icon').textContent = '🏆';
    $('notify-title').textContent = 'Chapter Pool Cleared!';
    $('notify-message').textContent = 'You conquered every eligible question before the clock ran out. The lock-in timer stops here — all elapsed time has been banked.';
    const receipt = $('notify-receipt');
    if (receipt) {
        receipt.innerHTML = _receiptRows([
            { k: 'Elapsed grind credited', v: formatStudyDuration(d.elapsed || 0) },
            { k: 'Questions solved', v: String(d.solved || 0) },
            { k: 'Net subject ELO', v: `${(d.netElo || 0) >= 0 ? '+' : ''}${d.netElo || 0}` },
            { k: 'Focus chain', v: String(d.chain || 0) },
        ]);
        receipt.hidden = false;
    }
    const secondary = $('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    const primary = $('notify-primary');
    if (primary) primary.textContent = "Let's Go";
    playBell();
    $('timer-notify-modal').classList.add('active');
}

export function showLockinBreach() {
    _setNotifyVariant('breach');
    const elapsed = _elapsedStudySecs();
    $('notify-icon').textContent = '⛓️';
    $('notify-title').textContent = 'Void This Lock-In Block?';
    $('notify-message').textContent = "Closing the practice stage now ends your lock-in timer early. This specific block's time period will NOT be counted.";
    const receipt = $('notify-receipt');
    if (receipt) {
        receipt.innerHTML = _receiptRows([
            { k: 'Escrow time voided', v: `${formatTime(elapsed)} (0m will be counted)` },
            { k: 'Focus chain', v: `chain of ${focusLedger.chain} → 0` },
            { k: 'Mode multiplier', v: lockinSession.mode === 'hardcore' ? '1.8× WIN bonus lost' : '×1.5 Deep Work bonus lost' },
        ]);
        receipt.hidden = false;
    }
    const secondary = $('notify-secondary');
    if (secondary) { secondary.textContent = 'Void Block & Exit'; secondary.style.display = 'block'; }
    const primary = $('notify-primary');
    if (primary) primary.textContent = 'Stay Locked In →';
    // No bell — this is a warning, not a reward.
    $('timer-notify-modal').classList.add('active');
}

export function showLockinComplete() {
    _setNotifyVariant('complete');
    $('notify-icon').textContent = '🎉';
    $('notify-title').textContent = '🏁 Lock-In Cycle Complete';
    $('notify-message').textContent = 'Every block sealed. Time banked, chain grown. Take the win — you earned the rest.';
    const receipt = $('notify-receipt');
    if (receipt) {
        receipt.innerHTML = _receiptRows([
            { k: 'Blocks sealed', v: String(Math.max(1, lockinSession.totalSessions)) },
            { k: 'Deep today', v: formatStudyDuration(focusLedger.deep) },
            { k: 'Focus chain', v: String(focusLedger.chain) },
        ]);
        receipt.hidden = false;
    }
    const secondary = $('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    const primary = $('notify-primary');
    if (primary) primary.textContent = "Let's Go";
    playBell();
    $('timer-notify-modal').classList.add('active');
}

// ── Inline-onclick bridges (index.html) ───────────────────────────────────
try {
    window.lockinClose = closeLockinSetupModal;
    window.lockinConfirm = confirmLockinSetup;
    window.lockinPreset = applyLockinPreset;
    window.lockinStep = stepLockinField;
    window.lockinRefresh = refreshLockinTimeline;
    window.skipLockinRest = skipLockinRest;
    window.addLockinRest = addLockinRest;
    window.endLockinSession = endLockinSession;
    window.voidLockinBlock = voidLockinBlock;
    window.stayLockedIn = stayLockedIn;
} catch (_) {}

// ── Tuck-In / bridge focus-ledger bridge (app.js reads window.POMO_API) ────
try { window.POMO_API = { getFocusLedger, getLockinSession: () => ({ ...lockinSession }) }; } catch (_) {}
