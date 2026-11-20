// ==================== POMODORO MODULE ====================
import { formatTime, formatStudyDuration, saveAllAsync, studySecs, SessionFocus, MODE_TUNING } from './storage.js';
import { GalleryBreak } from './gallery-break.js';
import { NightGuard } from './nightguard.js';
import {
    HARDCORE_THRESHOLD,
    clampFlowValue,
    modeForValue as flowModeForValue,
    labelForValue as flowLabelForValue,
    describeValue as flowDescribeValue,
} from './flow-slider.js';
import { mountFlowSlider } from './slider-resident.js';
import {
    DUEL_PRESETS,
    DUEL_STAKES,
    createDuelState,
    finalizeDuel,
    formatSplitSecs,
    getDuelPreviewIntel,
    loadDuelStats,
    loadLastDuelPrefs,
    saveLastDuelPrefs,
} from './shadow-duel.js';

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

function _ledgerCompleteBlock(secsDeep, opts) {
    const escrowMul = Math.max(1, Number(opts && opts.escrowMul) || 1);
    const subj = (opts && opts.subject) || (typeof studySubject !== 'undefined' ? studySubject : null);
    focusLedger.done += 1;
    focusLedger.chain += 1;
    focusLedger.best = Math.max(focusLedger.best, focusLedger.chain);
    focusLedger.deep += Math.max(0, secsDeep | 0);
    if (escrowMul >= 2) {
        focusLedger.hardcoreBlocks = (focusLedger.hardcoreBlocks | 0) + 1;
    }
    _saveFocusLedger();
    if (escrowMul >= 2) {
        try {
            if (window.CK_ENGINE && typeof window.CK_ENGINE.addShield === 'function') {
                window.CK_ENGINE.addShield(1);
            } else if (typeof localStorage !== 'undefined') {
                const cur = parseInt(localStorage.getItem('jeemax_ck_shields') || '0', 10) || 0;
                localStorage.setItem('jeemax_ck_shields', String(cur + 1));
            }
            if (typeof window.__jmaxAppToast === 'function') {
                window.__jmaxAppToast('⚡ Hardcore Escrow 2× Sealed · +1 Streak Shield & Doubled Drop!');
            }
        } catch (_) {}
    }
    // KLSR Heartbeat: feed completed deep Pact minutes into Persistence & Reservoir.
    try {
        if (typeof window !== 'undefined' && window.Heartbeat && typeof window.Heartbeat.recordPactBlock === 'function') {
            window.Heartbeat.recordPactBlock(secsDeep / 60, subj);
        }
    } catch (_) {}
    // Daily Directive: a completed deep-focus block pays +2 LU (2× in Hardcore)
    // to the active subject (capped at 3 blocks/day/subject inside directive.js).
    import('./directive.js').then(m => {
        try { m.Directive.awardFocus(subj, { mul: escrowMul }); } catch (_) {}
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
    // Settle real-time drain right before freezing or unfreezing the Heartbeat clock.
    try {
        if (typeof window !== 'undefined' && window.Heartbeat) {
            if (on && typeof window.Heartbeat.touchActivity === 'function') window.Heartbeat.touchActivity();
            if (typeof window.Heartbeat.tickClock === 'function') window.Heartbeat.tickClock();
        }
        if (on && typeof window !== 'undefined' && window.HeartbeatAudio && typeof window.HeartbeatAudio.playChamberLoad === 'function') {
            window.HeartbeatAudio.playChamberLoad();
        }
    } catch (_) {}
    try {
        if (document.body) document.body.classList.toggle('pomo-active', !!on);
    } catch (_) {}
    window._pomoRunning = !!on;
    _updateDeepWorkBeacon();
}

/** Sync #deep-work-beacon in top/side navigation chrome (hidden when idle). */
function _updateDeepWorkBeacon() {
    try {
        const b = $('deep-work-beacon');
        if (!b || typeof b.setAttribute !== 'function') return;
        if (!b._dwBound && typeof b.addEventListener === 'function') {
            b._dwBound = true;
            b.addEventListener('click', () => {
                try {
                    if (lockinSession.active) {
                        if (lockinSession.awaitingRefill || lockinSession.awaitingBreakSwitch) {
                            const sm = document.getElementById('lockin-scope-modal');
                            if (sm) { sm.style.display = 'flex'; sm.classList.add('active'); }
                            return;
                        }
                        if (lockinSession.phase === 'BREAK') {
                            const hud = document.getElementById('lockin-break-hud');
                            if (hud) hud.classList.add('active');
                            return;
                        }
                        const pm = document.getElementById('practice-modal');
                        if (pm && typeof window.openModal === 'function') {
                            window.openModal('practice-modal');
                        }
                    } else if (typeof window.openLockinSetupModal === 'function') {
                        openLockinSetupModal(lockinSession.mode || 'flow');
                    }
                } catch (_) {}
            });
        }
        if (lockinSession.active) {
            b.hidden = false;
            const mmss = formatTime(Math.max(0, _lockinLeftSecs));
            const rTag = `R${lockinSession.currentSession}/${lockinSession.totalSessions}`;
            if (lockinSession.phase === 'SUDDEN_DEATH') {
                const d = lockinSession.duel;
                b.textContent = d ? `⚡ SUDDEN DEATH · ${d.userPts}–${d.ghostPts}` : '⚡ SUDDEN DEATH';
                b.setAttribute('data-state', 'hot');
            } else if (lockinSession.awaitingRefill) {
                b.textContent = `⏸ REFILL · ${mmss} · ${rTag}`;
                b.setAttribute('data-state', 'paused');
            } else if (lockinSession.awaitingBreakSwitch) {
                b.textContent = `⇄ SWITCHING · ${rTag}`;
                b.setAttribute('data-state', 'break');
            } else if (lockinSession.phase === 'BREAK') {
                b.textContent = `☕ BREAK · ${mmss} · ${rTag}`;
                b.setAttribute('data-state', 'break');
            } else if (!lockinSession.running) {
                b.textContent = `⏸ PAUSED · ${mmss}`;
                b.setAttribute('data-state', 'paused');
            } else {
                const mulTag = lockinSession.mode === 'hardcore' ? '🔥 ×1.8 HARDCORE' : '⚡ ×1.5 DEEP';
                const sr = lockinSession.streakInRun || 0;
                const hotTag = sr >= 4 ? ' · HOT ZONE' : (sr > 0 ? ` · ${sr}/4🔥` : '');
                b.textContent = `${mulTag} · ${mmss} · ${rTag}${hotTag}`;
                b.setAttribute('data-state', sr >= 4 ? 'hot' : 'study');
            }
            return;
        }
        if (pomoState !== 'IDLE') {
            b.hidden = false;
            if (isPaused) {
                b.textContent = `⏸ PAUSED · ${formatTime(Math.max(0, secondsLeft))}`;
                b.setAttribute('data-state', 'paused');
            } else if (pomoState === 'BREAK') {
                b.textContent = `☕ BREAK · ${formatTime(Math.max(0, secondsLeft))}`;
                b.setAttribute('data-state', 'break');
            } else if (pomoState === 'STOPWATCH') {
                b.textContent = `⏱ FLOW · ${formatTime(Math.max(0, secondsLeft))}`;
                b.setAttribute('data-state', 'study');
            } else {
                b.textContent = `⚡ ×1.5 DEEP · ${formatTime(Math.max(0, secondsLeft))}`;
                b.setAttribute('data-state', 'study');
            }
            return;
        }
        b.hidden = true;
        b.textContent = '';
        if (typeof b.removeAttribute === 'function') b.removeAttribute('data-state');
    } catch (_) {}
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
    if (!document.hidden && lockinSession.active && (lockinSession.awaitingRefill || lockinSession.awaitingBreakSwitch)) {
        _scopeGraceTick();
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
    const kicker = $('notify-kicker');
    if (kicker) kicker.hidden = true;
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
    const rematch = $('notify-rematch');
    if (rematch) rematch.style.display = 'none';
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

function _escHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _duelDeltaLabel(s) {
    if (!s) return { text: '0 EVEN', tone: 'draw' };
    if (s.outcome === 'steal') return { text: '+2 STEAL', tone: 'win' };
    if (s.outcome === 'speed_win') return { text: `+1 (${Math.abs(s.paceDeltaSecs)}s faster)`, tone: 'win' };
    if (s.outcome === 'blunder') return { text: '−2 BLUNDER', tone: 'loss' };
    if (s.outcome === 'speed_loss') return { text: `−1 (${Math.abs(s.paceDeltaSecs)}s slower)`, tone: 'loss' };
    if (s.outcome === 'skip_punished') return { text: '−1 SKIP COST', tone: 'loss' };
    if (s.outcome === 'smart_triage') return { text: '0 TRAP TRIAGE', tone: 'draw' };
    return { text: '0 DRAW', tone: 'draw' };
}

function _renderDuelAutopsyHtml(d, duel) {
    const u = duel.userStats || { pts: duel.userPts, graded: duel.gradedCount, correct: 0, accuracyPct: 0, avgSecs: 0 };
    const g = duel.ghostStats || { pts: duel.ghostPts, elo: null, graded: duel.gradedCount, correct: 0, accuracyPct: 0, avgSecs: 0 };
    const outcomeCls = duel.outcome === 'win' ? 'is-win'
        : ((duel.outcome === 'loss' || duel.outcome === 'forfeit') ? 'is-loss' : 'is-draw');
    const tag = duel.outcome === 'win' ? 'WIN'
        : (duel.outcome === 'loss' ? 'LOSS'
            : (duel.outcome === 'forfeit' ? 'FORFEIT'
                : (duel.outcome === 'draw' ? 'DRAW' : 'UNRANKED')));

    const stakeParts = [`${tag} (${duel.userPts}–${duel.ghostPts})`];
    if (duel.eloDelta) stakeParts.push(`${duel.eloDelta > 0 ? '+' : ''}${duel.eloDelta} ELO`);
    if (duel.shieldDelta) stakeParts.push(`${duel.shieldDelta > 0 ? '+' : ''}${duel.shieldDelta} 🛡`);
    if (duel.streakShieldEarned) stakeParts.push('3🔥 +1 🛡');

    const avgGap = Number(duel.paceAvgGapSecs) || 0;
    const gapText = avgGap === 0 ? 'Even pace'
        : (avgGap > 0 ? `${Math.abs(avgGap)}s/Q faster` : `${Math.abs(avgGap)}s/Q slower`);

    const splitsHtml = (duel.splits || []).map(s => {
        const uStr = s.isSkip ? 'SKIP' : `${s.userCorrect ? '✓' : '✗'} ${formatSplitSecs(s.userSecs)}`;
        const gStr = s.ghostVerdict === 'skip'
            ? 'SKIP'
            : `${s.ghostVerdict === 'correct' ? '✓' : '✗'} ${formatSplitSecs(s.ghostSecs)}`;
        const delta = _duelDeltaLabel(s);
        const chap = _escHtml(s.chapter || (s.subject || '').toUpperCase() || 'Question');
        const tagSuffix = s.isTurningPoint
            ? ' · TURNING POINT'
            : (s.isBestMoment ? ' · BEST STEAL' : '');
        const rowCls = s.isTurningPoint ? 'is-turning-point' : (s.isBestMoment ? 'is-best' : '');
        return `<div class="da-row ${rowCls}">
            <span class="da-qnum">Q${s.index}${s.isSuddenDeath ? ' ⚡' : ''}</span>
            <span class="da-mid">
                <span class="da-chap">${chap}${tagSuffix}</span>
                <span class="da-comp">YOU ${uStr} · GHOST ${gStr}</span>
            </span>
            <span class="da-delta is-${delta.tone}">${_escHtml(delta.text)}</span>
        </div>`;
    }).join('');

    const eloVal = d.eloText || `${(d.netElo || 0) >= 0 ? '+' : ''}${d.netElo || 0}`;
    const metaParts = [
        `Shadow Duel: ${tag} (${duel.userPts}–${duel.ghostPts})`,
        `Grind ${formatStudyDuration(d.elapsed || 0)}`,
        `Solve ELO ${eloVal}`,
        `Chain ${d.chain != null ? d.chain : focusLedger.chain}`,
    ];
    if (duel.winStreak >= 1) metaParts.push(`Streak ${duel.winStreak}🔥`);

    return `
        <div class="da-hero">
            <div class="da-side">
                <span class="da-side-tag">YOU</span>
                <span class="da-side-pts">${duel.userPts}</span>
                <span class="da-side-sub">${u.correct}/${u.graded} ✓ (${u.accuracyPct}%) · ${formatSplitSecs(u.avgSecs)}/Q</span>
            </div>
            <div class="da-vs">
                <span class="da-vs-badge ${outcomeCls}">${_escHtml(stakeParts.join(' · '))}</span>
                <span class="da-vs-gap">${_escHtml(gapText)}</span>
            </div>
            <div class="da-side is-right">
                <span class="da-side-tag">${_escHtml(duel.shortLabel)}${g.elo ? ` · ${g.elo}` : ''}</span>
                <span class="da-side-pts">${duel.ghostPts}</span>
                <span class="da-side-sub">${g.correct}/${Math.max(1, g.graded)} ✓ (${g.accuracyPct}%) · ${formatSplitSecs(g.avgSecs)}/Q</span>
            </div>
        </div>
        <div class="da-verdict ${outcomeCls}">${_escHtml(duel.verdictHeadline || '')}</div>
        ${splitsHtml ? `<div class="da-tape">${splitsHtml}</div>` : ''}
        <div class="da-meta">${_escHtml(metaParts.join(' · '))}</div>
    `;
}

function _applyNotifyRematchButton(duel) {
    const rematch = $('notify-rematch');
    if (!rematch) return;
    if (duel && duel.outcome) {
        rematch.style.display = 'block';
        if (duel.outcome === 'loss' || duel.outcome === 'forfeit') {
            rematch.textContent = `Avenge Defeat vs ${duel.shortLabel} ↻`;
        } else if (duel.outcome === 'unqualified') {
            rematch.textContent = 'Run Full 4+ Q Duel ↻';
        } else {
            rematch.textContent = 'Run It Back ↻';
        }
    } else {
        rematch.style.display = 'none';
    }
}

function _showDuelCompletionModal(d) {
    const duel = d.duel;
    const isLoss = duel.outcome === 'loss' || duel.outcome === 'forfeit';
    const isWin = duel.outcome === 'win';
    const variant = isWin ? 'duel-win' : (isLoss ? 'duel-loss' : 'duel-draw');
    _setNotifyVariant(variant);

    const kicker = $('notify-kicker');
    if (kicker) {
        kicker.hidden = false;
        kicker.textContent = isWin
            ? `SHADOW DUEL · VICTORY (${duel.userPts}–${duel.ghostPts})`
            : (isLoss
                ? `SHADOW DUEL · ${duel.outcome === 'forfeit' ? 'FORFEITED' : 'DEFEATED'} (${duel.userPts}–${duel.ghostPts})`
                : (duel.outcome === 'unqualified'
                    ? `SHADOW DUEL · UNRANKED (${duel.gradedCount}/4 Qs)`
                    : `SHADOW DUEL · STALEMATE (${duel.userPts}–${duel.ghostPts})`));
    }

    $('notify-icon').textContent = isWin ? '⚔️' : (isLoss ? '💀' : (duel.outcome === 'unqualified' ? '⏱️' : '⚖️'));
    if (isWin) {
        $('notify-title').textContent = duel.preset === 'yesterday'
            ? 'You Beat Yesterday You'
            : `You Broke ${duel.label}`;
        const winParts = [];
        if (duel.eloDelta) winParts.push(`+${duel.eloDelta} ELO`);
        if (duel.shieldDelta) winParts.push(`+${duel.shieldDelta} 🛡`);
        $('notify-message').textContent = winParts.length
            ? `Escrow conquered: ${winParts.join(' & ')} deposited cleanly.`
            : 'Match won. Keep the momentum rolling.';
    } else if (isLoss) {
        $('notify-title').textContent = duel.preset === 'yesterday'
            ? 'Yesterday You Beat You'
            : `${duel.label} Outclassed You`;
        const lossParts = [];
        if (duel.eloDelta) lossParts.push(`${duel.eloDelta} ELO deducted`);
        if (duel.shieldDelta) lossParts.push(`${duel.shieldDelta} 🛡 burned`);
        $('notify-message').textContent = lossParts.length
            ? `${lossParts.join(' & ')}. Study the tape below and run it back.`
            : 'Duel streak snapped to 0. Inspect where the match slipped below.';
    } else if (duel.outcome === 'unqualified') {
        $('notify-title').textContent = `${duel.userPts}–${duel.ghostPts} Warm-Up Split`;
        $('notify-message').textContent = 'Stakes refunded because fewer than 4 graded problems were completed.';
    } else {
        $('notify-title').textContent = `Deadlocked vs ${duel.label}`;
        $('notify-message').textContent = 'Escrow returned cleanly. Neither side blinked.';
    }

    const receipt = $('notify-receipt');
    if (receipt) {
        receipt.innerHTML = _renderDuelAutopsyHtml(d, duel);
        receipt.hidden = false;
    }
    const secondary = $('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    _applyNotifyRematchButton(duel);
    const primary = $('notify-primary');
    if (primary) {
        primary.textContent = isLoss ? 'Accept Defeat & Exit' : (isWin ? 'Bank Win & Continue' : 'Done');
    }
    if (!isLoss) playBell();
    $('timer-notify-modal').classList.add('active');
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
    return _receiptRows(rows);
}

export function confirmTimerNotification() {
    const variant = _notifyVariant;
    $('timer-notify-modal').classList.remove('active');
    const kicker = $('notify-kicker');
    if (kicker) kicker.hidden = true;
    const secondary = $('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    const rematch = $('notify-rematch');
    if (rematch) rematch.style.display = 'none';
    _setNotifyVariant('');
    // Lock-In variants own their own confirm semantics.
    if (variant === 'breach') { stayLockedIn(); return; }
    if (variant === 'sudden-death') { startLockinSuddenDeath(); return; }
    if (variant === 'victory' || variant === 'complete' ||
        variant === 'duel-win' || variant === 'duel-loss' || variant === 'duel-draw') return;
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
    const kicker = $('notify-kicker');
    if (kicker) kicker.hidden = true;
    const secondary = $('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    const rematch = $('notify-rematch');
    if (rematch) rematch.style.display = 'none';
    _setNotifyVariant('');
    _pomoPendingAction = null;
    if (variant === 'breach') { voidLockinBlock(); return; }
    if (variant === 'sudden-death') { declineLockinSuddenDeath(); return; }
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
        // Cap stopwatch freeze & continuous run at 3 hours max (prevents infinite idle freeze).
        const STOPWATCH_MAX_SECS = 3 * 3600;
        secondsLeft = stopwatchAccumulated + elapsed;
        if (secondsLeft >= STOPWATCH_MAX_SECS) {
            stopwatchAccumulated = STOPWATCH_MAX_SECS;
            timerStartTime = now;
            $('timer-display').textContent = formatTime(STOPWATCH_MAX_SECS);
            $('mini-time').textContent = formatTime(STOPWATCH_MAX_SECS);
            quitTimer(false);
            return;
        }
        $('timer-display').textContent = formatTime(secondsLeft);
        $('mini-time').textContent = formatTime(secondsLeft);

        // Update study seconds and save periodically
        creditStudySeconds(studySubject, deltaSecs);
        _updateDeepWorkBeacon();

    } else {
        // Countdown: recalc remaining from true elapsed time
        secondsLeft = Math.max(0, timerTotalSeconds - elapsed);
        $('timer-display').textContent = formatTime(secondsLeft);
        $('mini-time').textContent = formatTime(secondsLeft);
        _updateDeepWorkBeacon();

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

    if (pomoState === 'STUDY') {
        // ── Night Guard: a naturally-completed focus block is a session end
        // for the sleep-debt ledger (quit already logs its own).
        try { NightGuard.logSessionEnd(); } catch (_) {}
        // ── Ledger: a block that ran to its planned end is a completed block.
        // Credit Pact minutes BEFORE unfreezing decay so a low-reservoir finish never clips 0.0h.
        const deepSecs = Math.max(0, Math.min(_blockCreditedSecs | 0, timerTotalSeconds | 0));
        _ledgerCompleteBlock(deepSecs);
        _setDeepWorkActive(false);   // block over — the ×1.5 window closes with it
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
    try { if (typeof window !== 'undefined' && window.Metro && typeof window.Metro.resumeAfterInterruption === 'function') window.Metro.resumeAfterInterruption(); } catch (_) {}
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
    try { if (typeof window !== 'undefined' && window.Metro && typeof window.Metro.pauseForInterruption === 'function') window.Metro.pauseForInterruption(); } catch (_) {}
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
    else _updateDeepWorkBeacon();
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
    try { if (typeof window !== 'undefined' && window.Metro && typeof window.Metro.resumeAfterInterruption === 'function') window.Metro.resumeAfterInterruption(); } catch (_) {}
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
const LOCKIN_REFILL_MIN_LEFT_SECS = 180;      // < 3m left on exhaustion -> finish block directly
const LOCKIN_REFILL_GRACE_SECS = 120;         // 2m grace window to pick next chapter on exhaustion
const LOCKIN_BREAK_END_GRACE_SECS = 90;       // 90s grace window if switching at break end
const LOCKIN_EARLY_EXHAUST_MIN_SECS = 300;    // 5m (or >=50% block) floor for chain/shield on early exhaust

/** Live Lock-In session state (also handed to app.js on confirm / resume). */
export const lockinSession = {
    active: false,
    mode: 'flow',
    subject: 'physics',
    chapter: '',
    chapterSelection: null,
    pendingScope: null,             // queued { subject, chapter, chapterSelection } for next round
    awaitingRefill: false,          // true while STUDY pauses in Refill Gate after pool exhaustion
    awaitingBreakSwitch: false,     // true while picking new scope at break-end
    duel: null,                     // Shadow Duel state when opted in at setup
    segmentSecs: { physics: 0, chemistry: 0, maths: 0 },
    startEloBySubject: {},
    subjectsTouched: [],
    studyMins: 50,
    breakMins: 10,
    totalSessions: 1,
    currentSession: 1,
    phase: 'STUDY',                 // 'STUDY' | 'BREAK' | 'SUDDEN_DEATH'
    expiredPendingTransition: false,
    solvedInRun: 0,
    solvedInBlock: 0,
    streakInRun: 0,
    startElo: 1200,
    running: false,
    voided: false,
};

let _lockinTimer = null;
let _lockinEndsAt = 0;
let _lockinTotalSecs = 0;
let _lockinLeftSecs = 0;
let _lockinCreditedSecs = 0;       // escrow seconds accrued this STUDY block
let _lockinFlushedSecs = 0;        // seconds already flushed into segmentSecs this block
let _lockinPausedLeft = 0;
let _lockinOnConfirm = null;
let _lockinSliderApi = null;       // entry intensity rail handle (pomodoro side)
let _duelDraft = { preset: 'off', stake: 'none', airTier: 'air1000' };
let _lastSetupCtx = null;
let _lastRematchCtx = null;

// Scope Switcher modal state (Break / Break-End / Refill Gate)
let _scopeModalMode = null;        // null | 'break' | 'break-end' | 'refill'
let _scopeCatalog = null;
let _scopeSelectedSubject = 'physics';
let _scopeSelectedChapters = new Set();
let _scopeGraceTimer = null;
let _scopeGraceEndsAt = 0;
let _scopeGraceLeftSecs = 0;

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

function _entrySliderValue() {
    try {
        const A = window.AppState;
        if (A && isFinite(Number(A.flowSlider))) return clampFlowValue(A.flowSlider);
    } catch (_) {}
    return 72;
}

function _syncLockinLaunchCopy() {
    try {
        const launch = document.getElementById('lockin-launch');
        if (!launch) return;
        const v = _entrySliderValue();
        const hardcore = v >= HARDCORE_THRESHOLD;
        const eff = _effectiveDuelPreset();
        if (eff === 'off') {
            launch.textContent = hardcore ? 'Ignite' : 'Lock in';
            return;
        }
        launch.textContent = hardcore ? 'Ignite Duel' : 'Enter Duel';
    } catch (_) {}
}

function _syncLockinIntensityUI() {
    const v = _entrySliderValue();
    const mode = flowModeForValue(v);
    const hardcore = v >= HARDCORE_THRESHOLD;
    try {
        const readout = document.getElementById('lockin-intensity-readout');
        if (readout) readout.textContent = flowLabelForValue(v);
        const wrap = document.getElementById('lockin-intensity');
        if (wrap) wrap.classList.toggle('is-hardcore', hardcore);
        const rule = document.getElementById('lockin-intensity-rule');
        if (rule) rule.textContent = hardcore
            ? 'HARDCORE · 1.8x wins — banked time pays double while you grind.'
            : 'Soft blocks for steady hours. Drag to 98+ for Hardcore.';
        const title = document.getElementById('lockin-title');
        if (title) title.textContent = hardcore ? 'Enter the Crucible' : 'Sign the Pact';
        const modal = document.getElementById('lockin-setup-modal');
        if (modal && typeof modal.setAttribute === 'function') modal.setAttribute('data-lockin-mode', mode);
    } catch (_) {}
    lockinSession.mode = mode;
    _syncLockinLaunchCopy();
}

function _mountEntrySlider() {
    const host = document.getElementById('lockin-slider-host');
    if (!host) return;
    // Reuse the mounted rail; rebuild only if the host was wiped.
    if (_lockinSliderApi && typeof host.contains === 'function' && host.contains(_lockinSliderApi.root)) return;
    if (_lockinSliderApi) {
        try { _lockinSliderApi.destroy(); } catch (_) {}
        _lockinSliderApi = null;
    }
    if (typeof document === 'undefined' || typeof window === 'undefined' ||
        typeof window.matchMedia !== 'function' ||
        typeof IntersectionObserver !== 'function' || typeof ResizeObserver !== 'function') return;
    try { host.innerHTML = ''; } catch (_) {}
    try {
        const api = mountFlowSlider(host, {
            value: _entrySliderValue(),
            label: 'Practice intensity',
            describe: (v) => flowDescribeValue(v),
            onInput: (v) => {
                try {
                    if (typeof window.__setFlowSlider === 'function') window.__setFlowSlider(v);
                    else if (window.AppState) window.AppState.flowSlider = clampFlowValue(v);
                } catch (_) {}
                _syncLockinIntensityUI();
                if (_lockinSliderApi && typeof _lockinSliderApi.setHardcore === 'function') {
                    _lockinSliderApi.setHardcore(v >= HARDCORE_THRESHOLD);
                }
            },
        });
        _lockinSliderApi = api;
        try { if (typeof window !== 'undefined') window.__lockinSliderApi = api; } catch (_) {}
        if (api && typeof api.setHardcore === 'function') {
            api.setHardcore(_entrySliderValue() >= HARDCORE_THRESHOLD);
        }
    } catch (e) {
        _lockinSliderApi = null;
    }
    _syncLockinIntensityUI();
}

function _destroyEntrySlider() {
    if (_lockinSliderApi) {
        try { _lockinSliderApi.destroy(); } catch (_) {}
        _lockinSliderApi = null;
    }
    try {
        if (typeof window !== 'undefined') window.__lockinSliderApi = null;
    } catch (_) {}
    try {
        const host = document.getElementById('lockin-slider-host');
        if (host) host.innerHTML = '';
    } catch (_) {}
}

function _availableShields() {
    try {
        if (typeof window !== 'undefined' && window.CK_ENGINE && typeof window.CK_ENGINE.state === 'function') {
            return Math.max(0, window.CK_ENGINE.state().shields | 0);
        }
        if (typeof localStorage !== 'undefined') {
            return Math.max(0, parseInt(localStorage.getItem('jeemax_ck_shields') || '0', 10) || 0);
        }
    } catch (_) {}
    return 0;
}

function _effectiveDuelPreset() {
    return _duelDraft.preset === 'air' ? (_duelDraft.airTier || 'air1000') : (_duelDraft.preset || 'off');
}

function _initDuelDraft(prefs) {
    const p = prefs || loadLastDuelPrefs();
    const raw = p.preset || 'off';
    if (String(raw).startsWith('air')) {
        _duelDraft = {
            preset: 'air',
            airTier: DUEL_PRESETS[raw] ? raw : (p.airTier || 'air1000'),
            stake: 'none',
        };
    } else {
        _duelDraft = {
            preset: DUEL_PRESETS[raw] ? raw : 'off',
            airTier: DUEL_PRESETS[p.airTier] ? p.airTier : 'air1000',
            stake: 'none',
        };
    }
}

function _syncLockinDuelUI() {
    const eff = _effectiveDuelPreset();
    const active = eff !== 'off';
    _duelDraft.stake = 'none';

    const presetsWrap = document.getElementById('lockin-duel-presets');
    if (presetsWrap && typeof presetsWrap.querySelectorAll === 'function') {
        presetsWrap.querySelectorAll('.ld-pill').forEach(btn => {
            const k = btn.dataset && btn.dataset.duel;
            if (btn.classList) btn.classList.toggle('active', k === _duelDraft.preset);
        });
    }
    const airRow = document.getElementById('lockin-duel-air-row');
    if (airRow) {
        airRow.hidden = _duelDraft.preset !== 'air';
        if (typeof airRow.querySelectorAll === 'function') {
            airRow.querySelectorAll('.ld-chip').forEach(btn => {
                const t = btn.dataset && btn.dataset.air;
                if (btn.classList) btn.classList.toggle('active', t === _duelDraft.airTier);
            });
        }
    }
    const stakesRow = document.getElementById('lockin-duel-stakes');
    if (stakesRow) stakesRow.hidden = true;
    const intel = getDuelPreviewIntel({
        preset: eff,
        stake: _duelDraft.stake,
        userElo: _currentSubjectElo(lockinSession.subject),
        subject: lockinSession.subject,
    });
    const recEl = document.getElementById('lockin-duel-record');
    if (recEl) {
        if (intel.recordText) {
            recEl.hidden = false;
            recEl.textContent = intel.recordText;
            if (recEl.classList) {
                recEl.classList.toggle('is-debt', intel.recordTone === 'debt');
                recEl.classList.toggle('is-hot', intel.recordTone === 'hot');
            }
        } else {
            recEl.hidden = true;
        }
    }
    const intelBox = document.getElementById('lockin-duel-intel');
    const intelTitle = document.getElementById('lockin-duel-intel-title');
    const intelSub = document.getElementById('lockin-duel-intel-sub');
    if (intelBox) {
        intelBox.hidden = !active;
        if (active) {
            if (intelTitle) intelTitle.textContent = intel.intelTitle;
            if (intelSub) intelSub.textContent = intel.intelDetail;
        }
    }
    const ruleEl = document.getElementById('lockin-duel-rule');
    if (ruleEl) {
        ruleEl.hidden = !active;
        if (active) {
            ruleEl.textContent = intel.stakesLine;
            if (ruleEl.classList) {
                ruleEl.classList.toggle('is-high-stakes',
                    _duelDraft.stake === 'elo25' || _duelDraft.stake === 'shield' || (intel.lossStreak || 0) >= 2);
            }
        }
    }
    _syncLockinLaunchCopy();
}

export function lockinDuelPreset(kind) {
    if (!['off', 'yesterday', 'rival100', 'air'].includes(kind)) return;
    _duelDraft.preset = kind;
    _syncLockinDuelUI();
}

export function lockinDuelAir(tier) {
    if (!DUEL_PRESETS[tier]) return;
    _duelDraft.airTier = tier;
    _duelDraft.preset = 'air';
    _syncLockinDuelUI();
}

export function lockinDuelStake() {
    _duelDraft.stake = 'none';
    _syncLockinDuelUI();
}

export function openLockinSetupModal(mode, context, onConfirmStart) {
    if (!LOCKIN_MODES.includes(mode)) return false;
    const ctx = context || {};
    // The dial is the source of truth. A legacy 'hardcore' caller is upgraded
    // to the top of the dial; a 'flow' caller keeps whatever the dial holds.
    if (mode === 'hardcore' && _entrySliderValue() < HARDCORE_THRESHOLD) {
        try {
            if (typeof window.__setFlowSlider === 'function') window.__setFlowSlider(100);
            else if (window.AppState) window.AppState.flowSlider = 100;
        } catch (_) {}
    }
    const resolved = flowModeForValue(_entrySliderValue());
    lockinSession.mode = resolved;
    lockinSession.subject = isValidSubjectKey(ctx.subject) ? ctx.subject
        : (isValidSubjectKey(studySubject) ? studySubject : 'physics');
    lockinSession.chapter = ctx.chapter || '';
    lockinSession.chapterSelection = Array.isArray(ctx.chapterSelection) ? ctx.chapterSelection.slice() : null;
    lockinSession.pendingScope = null;
    lockinSession.awaitingRefill = false;
    lockinSession.awaitingBreakSwitch = false;
    lockinSession.duel = null;
    lockinSession.startElo = _currentSubjectElo(lockinSession.subject);
    lockinSession.voided = false;
    _lockinOnConfirm = typeof onConfirmStart === 'function' ? onConfirmStart : null;
    _lastSetupCtx = {
        mode: resolved,
        subject: lockinSession.subject,
        chapter: lockinSession.chapter,
        chapterSelection: lockinSession.chapterSelection ? lockinSession.chapterSelection.slice() : null,
        onConfirm: _lockinOnConfirm,
    };

    // Seed the draft from the last-used config so returning users land on
    // their habitual block length (preserving explicit 1-round runs).
    const cfg = readPomoConfig();
    const defRounds = (cfg && Number.isFinite(Number(cfg.sessions)) && cfg.sessions >= 1) ? cfg.sessions : 2;
    _setInputVal('lockin-grind', _clamp(cfg ? cfg.study : 50, 5, 180));
    _setInputVal('lockin-chill', _clamp(cfg ? cfg.break : 10, 1, 60));
    _setInputVal('lockin-rounds', _clamp(defRounds, 1, 8));

    _initDuelDraft(ctx.duelPrefs || loadLastDuelPrefs());
    _syncLockinDuelUI();

    _mountEntrySlider();
    _syncLockinIntensityUI();

    _syncLockinPresetActive();
    _renderLockinTimeline();
    _bindLockinEscOnce();
    const modal = document.getElementById('lockin-setup-modal');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
    }
    return true;
}

function _bindLockinEscOnce() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function' ||
        typeof window === 'undefined' || window._lockinEscBound) return;
    window._lockinEscBound = true;
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const scopeEl = document.getElementById('lockin-scope-modal');
        if (scopeEl && scopeEl.classList && scopeEl.classList.contains('active')) {
            e.preventDefault();
            e.stopPropagation();
            if (_scopeModalMode === 'break') lockinScopeCancel();
            return;
        }
        const el = document.getElementById('lockin-setup-modal');
        if (el && el.classList && el.classList.contains('active')) {
            e.preventDefault();
            e.stopPropagation();
            closeLockinSetupModal();
        }
    }, true);
}

export function closeLockinSetupModal() {
    const el = document.getElementById('lockin-setup-modal');
    if (el) {
        el.classList.remove('active');
        setTimeout(() => { if (!el.classList.contains('active')) el.style.display = 'none'; }, 250);
    }
    _destroyEntrySlider();
    _lockinOnConfirm = null;
}

/** Commit the pact: persist the draft, chime, start the block, open practice. */
export function confirmLockinSetup() {
    const study = _clamp(_inputVal('lockin-grind'), 5, 180);
    const chill = _clamp(_inputVal('lockin-chill'), 1, 60);
    const rounds = _clamp(_inputVal('lockin-rounds'), 1, 8);
    // The dial wins: whatever the rail currently shows is what we enter.
    lockinSession.mode = flowModeForValue(_entrySliderValue());
    lockinSession.studyMins = study;
    lockinSession.breakMins = chill;
    lockinSession.totalSessions = rounds;
    lockinSession.currentSession = 1;
    lockinSession.active = true;
    lockinSession.pendingScope = null;
    lockinSession.awaitingRefill = false;
    lockinSession.awaitingBreakSwitch = false;
    lockinSession.solvedInRun = 0;
    lockinSession.solvedInBlock = 0;
    lockinSession.streakInRun = 0;
    lockinSession.startEloBySubject = {};
    lockinSession.subjectsTouched = [];
    lockinSession.startElo = _currentSubjectElo(lockinSession.subject);
    _ensureSubjectTracked(lockinSession.subject);
    studySubject = lockinSession.subject;

    const effPreset = _effectiveDuelPreset();
    const stakeChoice = 'none';
    saveLastDuelPrefs({ preset: effPreset, stake: stakeChoice, airTier: _duelDraft.airTier });
    lockinSession.duel = effPreset !== 'off'
        ? createDuelState({ preset: effPreset, stake: stakeChoice, subject: lockinSession.subject })
        : null;
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

// ── Multi-subject & scope helpers ─────────────────────────────────────────
function _subjTag(subj) {
    const s = isValidSubjectKey(subj) ? subj : 'physics';
    return s === 'chemistry' ? 'CHEM' : (s === 'maths' ? 'MATH' : 'PHYS');
}

function _formatScopeLabel(scope) {
    if (!scope) return '';
    const tag = _subjTag(scope.subject);
    const ch = scope.chapter ? String(scope.chapter) : '';
    if (!ch) return tag;
    const shortCh = ch.length > 24 ? (ch.slice(0, 23) + '…') : ch;
    return `${tag} · ${shortCh}`;
}

function _ensureSubjectTracked(subj) {
    const s = isValidSubjectKey(subj) ? subj : 'physics';
    if (!lockinSession.startEloBySubject || typeof lockinSession.startEloBySubject !== 'object') {
        lockinSession.startEloBySubject = {};
    }
    if (!(s in lockinSession.startEloBySubject)) {
        lockinSession.startEloBySubject[s] = _currentSubjectElo(s);
    }
    if (!Array.isArray(lockinSession.subjectsTouched)) lockinSession.subjectsTouched = [];
    if (!lockinSession.subjectsTouched.includes(s)) lockinSession.subjectsTouched.push(s);
}

function _applyScopeToLockinSession(scope) {
    if (!scope || !isValidSubjectKey(scope.subject)) return;
    lockinSession.subject = scope.subject;
    lockinSession.chapter = scope.chapter || '';
    lockinSession.chapterSelection = Array.isArray(scope.chapterSelection) ? scope.chapterSelection.slice() : null;
    studySubject = lockinSession.subject;
    _ensureSubjectTracked(lockinSession.subject);
}

function _flushCurrentLockinSegment() {
    if (lockinSession.phase !== 'STUDY') return;
    if (lockinSession.running && _lockinEndsAt > 0) {
        _lockinLeftSecs = Math.max(0, Math.round((_lockinEndsAt - Date.now()) / 1000));
    }
    const totalElapsed = Math.max(0, Math.min(_lockinTotalSecs, _lockinTotalSecs - _lockinLeftSecs));
    const segDelta = Math.max(0, totalElapsed - _lockinFlushedSecs);
    if (segDelta > 0) {
        const subj = isValidSubjectKey(lockinSession.subject) ? lockinSession.subject : 'physics';
        if (!lockinSession.segmentSecs || typeof lockinSession.segmentSecs !== 'object') {
            lockinSession.segmentSecs = { physics: 0, chemistry: 0, maths: 0 };
        }
        lockinSession.segmentSecs[subj] = (lockinSession.segmentSecs[subj] || 0) + segDelta;
        _lockinFlushedSecs = totalElapsed;
    }
}

function _buildRunNetEloData() {
    const touched = Array.isArray(lockinSession.subjectsTouched) && lockinSession.subjectsTouched.length
        ? lockinSession.subjectsTouched
        : [lockinSession.subject];
    const startMap = lockinSession.startEloBySubject || {};
    if (touched.length <= 1) {
        const s = touched[0] || lockinSession.subject;
        const base = (s in startMap) ? startMap[s] : lockinSession.startElo;
        const net = _currentSubjectElo(s) - base;
        return { netElo: net, eloText: `${net >= 0 ? '+' : ''}${net}` };
    }
    let total = 0;
    const parts = [];
    for (const s of touched) {
        const base = (s in startMap) ? startMap[s] : _currentSubjectElo(s);
        const d = _currentSubjectElo(s) - base;
        total += d;
        parts.push(`${_subjTag(s)} ${d >= 0 ? '+' : ''}${d}`);
    }
    return {
        netElo: total,
        eloText: `${total >= 0 ? '+' : ''}${total} (${parts.join(' · ')})`,
        multiSubject: true,
    };
}

// ── Study / break phase machine ───────────────────────────────────────────
function _startLockinStudy() {
    lockinSession.phase = 'STUDY';
    lockinSession.running = true;
    lockinSession.expiredPendingTransition = false;
    lockinSession.awaitingRefill = false;
    lockinSession.awaitingBreakSwitch = false;
    lockinSession.solvedInBlock = 0;
    lockinSession.segmentSecs = { physics: 0, chemistry: 0, maths: 0 };
    _lockinFlushedSecs = 0;
    studySubject = lockinSession.subject;
    _ensureSubjectTracked(lockinSession.subject);
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
    const delta = Math.max(0, _lockinLeftSecs - left);
    _lockinLeftSecs = left;
    if (lockinSession.phase === 'STUDY') {
        _lockinCreditedSecs += delta;
        _updateDeepWorkBeacon();
        if (left <= 0) { _onLockinStudyExpire(); return; }
    } else {
        _updateLockinBreakHud();
        _updateDeepWorkBeacon();
        if (left <= 0) { _onLockinBreakExpire(); return; }
    }
}

function _elapsedStudySecs() {
    const fromLeft = Math.max(0, _lockinTotalSecs - _lockinLeftSecs);
    return Math.min(_lockinTotalSecs, Math.max(fromLeft, _lockinCreditedSecs | 0));
}

/** Deposit the escrowed block into the day's ledger + study-time counters. */
function _commitCompletedStudyBlock(opts) {
    _flushCurrentLockinSegment();
    _lockinCreditedSecs = 0;
    const segs = lockinSession.segmentSecs || {};
    let totalSecs = 0;
    let dominantSubj = lockinSession.subject;
    let maxSeg = -1;
    for (const s of SUBJECT_KEYS) {
        const v = Math.max(0, segs[s] | 0);
        if (v > 0) {
            studySecs[s] += v;
            totalSecs += v;
            if (v > maxSeg) {
                maxSeg = v;
                dominantSubj = s;
            }
        }
    }
    const fallbackSecs = _elapsedStudySecs();
    if (totalSecs <= 0 && fallbackSecs > 0) {
        const s = isValidSubjectKey(lockinSession.subject) ? lockinSession.subject : 'physics';
        studySecs[s] += fallbackSecs;
        totalSecs = fallbackSecs;
        dominantSubj = s;
    }
    if (totalSecs <= 0) return { secs: 0, shieldGranted: false, meetsMinBlock: false };

    const mode = lockinSession.mode || 'flow';
    const escrowMul = (MODE_TUNING[mode] && MODE_TUNING[mode].escrowBonusMultiplier) || 1.0;
    const earlyExhaustion = !!(opts && opts.earlyExhaustion);
    const meetsMinBlock = !earlyExhaustion || (
        (lockinSession.solvedInBlock | 0) > 0 &&
        (totalSecs >= LOCKIN_EARLY_EXHAUST_MIN_SECS || totalSecs >= Math.floor(_lockinTotalSecs * 0.5))
    );

    studySubject = dominantSubj;
    try { updateStudyTimeHeader(); } catch (_) {}
    if (meetsMinBlock) {
        _ledgerCompleteBlock(totalSecs, { escrowMul, subject: dominantSubj });
    } else {
        focusLedger.deep += totalSecs;
        _saveFocusLedger();
    }
    try { saveAllAsync().catch(() => {}); } catch (_) {}
    try {
        window.dispatchEvent(new CustomEvent('jmax:pomo-block-done', {
            detail: {
                mode,
                escrowBonusMultiplier: meetsMinBlock ? escrowMul : 1.0,
                subject: dominantSubj,
                secs: totalSecs,
                segmentSecs: { ...segs },
            }
        }));
    } catch (_) {}
    return {
        secs: totalSecs,
        shieldGranted: meetsMinBlock && escrowMul >= 2,
        meetsMinBlock,
    };
}

/** Sync live intensity slider flips across Flow/Hardcore into active Lock-In session. */
export function syncLockinMode(mode) {
    if (!lockinSession.active || !LOCKIN_MODES.includes(mode)) return;
    if (lockinSession.mode === mode) return;
    lockinSession.mode = mode;
    _syncLockinIntensityUI(mode);
    if (lockinSession.phase === 'BREAK') {
        _updateLockinBreakHud();
    }
}

function _settleLockinDuel(opts) {
    const d = lockinSession.duel;
    if (!d || !d.active) return null;
    const settlement = finalizeDuel(d, { forfeit: !!(opts && opts.forfeit) });
    if (!settlement) return null;

    if (_lastSetupCtx) {
        _lastRematchCtx = {
            ..._lastSetupCtx,
            duelPrefs: settlement.rematchPrefs,
        };
    }
    return settlement;
}

function _shouldOfferSuddenDeath() {
    const d = lockinSession.duel;
    if (!d || !d.active) return false;
    if (d.suddenDeathPlayed || d.suddenDeathDeclined) return false;
    if (lockinSession.currentSession < lockinSession.totalSessions) return false;
    if (d.gradedCount < 3 || d.userPts !== d.ghostPts) return false;
    try {
        return typeof window !== 'undefined'
            && typeof window.__hasSuddenDeathQuestion === 'function'
            && !!window.__hasSuddenDeathQuestion(lockinSession);
    } catch (_) { return false; }
}

export function startLockinSuddenDeath() {
    const d = lockinSession.duel;
    if (!lockinSession.active || !d || !d.active) {
        _finishLockinCycle();
        return false;
    }
    lockinSession.phase = 'SUDDEN_DEATH';
    lockinSession.running = false;
    _lockinLeftSecs = 0;
    d.suddenDeathActive = true;
    _updateDeepWorkBeacon();

    let launched = false;
    try {
        if (typeof window !== 'undefined' && typeof window.__launchSuddenDeathQuestion === 'function') {
            launched = !!window.__launchSuddenDeathQuestion(lockinSession);
        }
    } catch (e) { console.warn('[lockin] sudden death launch failed', e); }

    if (!launched) {
        d.suddenDeathActive = false;
        _finishLockinCycle();
        return false;
    }
    return true;
}

export function declineLockinSuddenDeath() {
    if (lockinSession.duel) {
        lockinSession.duel.suddenDeathDeclined = true;
        lockinSession.duel.suddenDeathActive = false;
    }
    if (!lockinSession.active) return;
    _finishLockinCycle();
}

export function completeLockinSuddenDeath(opts) {
    if (!lockinSession.active) return false;
    const d = lockinSession.duel;
    const conceded = !!(opts && opts.conceded);
    if (d) {
        if (conceded && !d.suddenDeathPlayed && d.userPts <= d.ghostPts) {
            d.ghostPts += 1;
            d.splits.push({
                index: d.splits.length + 1,
                qId: 'sd-concede',
                subject: lockinSession.subject,
                chapter: 'Sudden Death',
                targetSecs: 180,
                isSkip: false,
                userCorrect: false,
                userSecs: 0,
                ghostVerdict: 'correct',
                ghostSecs: 90,
                ghostSource: 'model',
                userPtsDelta: 0,
                ghostPtsDelta: 1,
                outcome: 'blunder',
                paceDeltaSecs: -90,
                isSuddenDeath: true,
            });
        }
        d.suddenDeathActive = false;
        d.suddenDeathPlayed = true;
    }
    lockinSession.phase = 'STUDY';
    _finishLockinCycle();
    return true;
}

export function isLockinSuddenDeath() {
    return !!(lockinSession.active && lockinSession.phase === 'SUDDEN_DEATH');
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
    if (_shouldOfferSuddenDeath()) {
        _setDeepWorkActive(false);
        _removePaceGlow();
        try { NightGuard.logSessionEnd(); } catch (_) {}
        _afterPendingRecap(() => showLockinSuddenDeathPrompt());
        return;
    }
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

function _afterPendingRecap(fn) {
    try {
        const p = (typeof window !== 'undefined') ? window.__jmaxPendingRecapPromise : null;
        if (p && typeof p.then === 'function') {
            Promise.resolve(p).finally(() => { try { fn(); } catch (e) { console.warn('[lockin] post-recap fault', e); } });
            return;
        }
    } catch (_) {}
    fn();
}

function _startLockinBreak() {
    try { if (typeof window !== 'undefined' && window.Metro && typeof window.Metro.pauseForInterruption === 'function') window.Metro.pauseForInterruption(); } catch (_) {}
    lockinSession.phase = 'BREAK';
    lockinSession.running = true;
    lockinSession.pendingScope = null;
    lockinSession.awaitingBreakSwitch = false;
    _lockinTotalSecs = Math.max(1, lockinSession.breakMins) * 60;
    _lockinLeftSecs = _lockinTotalSecs;
    _lockinCreditedSecs = 0;
    _lockinEndsAt = Date.now() + _lockinTotalSecs * 1000;
    _clearLockinTick();
    _lockinTimer = setInterval(_lockinTick, 1000);
    playBell();
    try { GalleryBreak.begin(); } catch (e) { console.warn('[lockin] GalleryBreak failed', e); }
    _showLockinBreakHud();
    _updateDeepWorkBeacon();
}

function _onLockinBreakExpire() {
    _clearLockinTick();
    lockinSession.running = false;
    _hideLockinBreakHud();
    playBell();
    if (_scopeModalMode === 'break') {
        try {
            if (GalleryBreak.isActive()) {
                GalleryBreak.finish(null, { shouldHideQuote: () => true });
            }
        } catch (_) {}
        _transitionBreakSwitchToBreakEnd();
        return;
    }
    try {
        if (GalleryBreak.isActive()) {
            const nextTarget = lockinSession.pendingScope || lockinSession;
            const label = _formatScopeLabel(nextTarget);
            GalleryBreak.finish(() => _endLockinBreak(true), {
                continueLabel: label ? `Continue · ${label}` : 'Continue',
                secondaryLabel: 'Change Subject',
                onSecondary: () => _openBreakEndScopePicker(),
            });
            return;
        }
    } catch (_) {}
    _endLockinBreak(true);
}

export function skipLockinRest() {
    if (!lockinSession.active || lockinSession.phase !== 'BREAK') return;
    _clearLockinTick();
    _closeScopeModal();
    lockinSession.running = false;
    _endLockinBreak(false);
}

export function addLockinRest(mins) {
    if (!lockinSession.active || lockinSession.phase !== 'BREAK') return;
    const extra = Math.max(0, parseInt(mins, 10) || 0) * 60;
    _lockinTotalSecs += extra;
    _lockinLeftSecs += extra;
    _lockinEndsAt += extra * 1000;
    _updateLockinBreakHud();
}

function _endLockinBreak(natural = false) {
    if (!natural) {
        try { GalleryBreak.abort(); } catch (_) {}
    }
    _hideLockinBreakHud();
    _closeScopeModal();
    lockinSession.awaitingBreakSwitch = false;
    try { if (typeof window !== 'undefined' && window.Metro && typeof window.Metro.resumeAfterInterruption === 'function') window.Metro.resumeAfterInterruption(); } catch (_) {}
    if (!lockinSession.active) return;
    if (lockinSession.pendingScope) {
        _applyScopeToLockinSession(lockinSession.pendingScope);
        lockinSession.pendingScope = null;
    }
    if (typeof window !== 'undefined' && typeof window.__applyLockinScopeToAppState === 'function') {
        try { window.__applyLockinScopeToAppState(lockinSession); } catch (_) {}
    }
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
    _closeScopeModal();
    lockinSession.running = false;
    try { GalleryBreak.abort(); } catch (_) {}
    _hideLockinBreakHud();
    try { if (typeof window !== 'undefined' && window.Metro && typeof window.Metro.resumeAfterInterruption === 'function') window.Metro.resumeAfterInterruption(); } catch (_) {}
    _setDeepWorkActive(false);
    const duelRes = _settleLockinDuel({ forfeit: false });
    _resetLockinState();
    try { if (typeof window.closePracticeModal === 'function') window.closePracticeModal({ skipLockinCheck: true }); } catch (_) {}
    if (duelRes && duelRes.outcome !== 'unqualified' && typeof window !== 'undefined' && typeof window.__jmaxAppToast === 'function') {
        const sign = duelRes.eloDelta > 0 ? '+' : '';
        const eloMsg = duelRes.eloDelta ? ` (${sign}${duelRes.eloDelta} ELO)` : '';
        window.__jmaxAppToast(`Shadow Duel settled: ${duelRes.outcome.toUpperCase()} ${duelRes.userPts}–${duelRes.ghostPts}${eloMsg}`);
    }
}

function _finishLockinCycle(opts) {
    _flushCurrentLockinSegment();
    const eloData = _buildRunNetEloData();
    const blocksDone = Math.max(1, (opts && opts.blocksCompleted) || lockinSession.totalSessions || 1);
    const lastSegSecs = Object.values(lockinSession.segmentSecs || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    const totalSecs = Math.max(lastSegSecs, blocksDone * Math.max(1, lockinSession.studyMins || 25) * 60);
    const duel = _settleLockinDuel({ forfeit: false });
    const summary = {
        blocks: blocksDone,
        elapsed: totalSecs,
        solved: lockinSession.solvedInRun | 0,
        netElo: eloData.netElo,
        eloText: eloData.eloText,
        chain: focusLedger.chain,
        mode: lockinSession.mode,
        duel,
    };
    _removePaceGlow();
    _resetLockinState();
    try { if (typeof window.closePracticeModal === 'function') window.closePracticeModal({ skipLockinCheck: true }); } catch (_) {}
    _afterPendingRecap(() => showLockinComplete(summary));
}

function _resetLockinState() {
    _clearLockinTick();
    _closeScopeModal();
    lockinSession.active = false;
    lockinSession.running = false;
    lockinSession.expiredPendingTransition = false;
    lockinSession.awaitingRefill = false;
    lockinSession.awaitingBreakSwitch = false;
    lockinSession.pendingScope = null;
    lockinSession.duel = null;
    lockinSession.phase = 'STUDY';
    lockinSession.currentSession = 1;
    lockinSession.solvedInRun = 0;
    lockinSession.solvedInBlock = 0;
    lockinSession.streakInRun = 0;
    lockinSession.segmentSecs = { physics: 0, chemistry: 0, maths: 0 };
    lockinSession.startEloBySubject = {};
    lockinSession.subjectsTouched = [];
    _lockinCreditedSecs = 0;
    _lockinFlushedSecs = 0;
    _lockinPausedLeft = 0;
    _lockinLeftSecs = 0;
    _lockinTotalSecs = 0;
    _removePaceGlow();
    _updateDeepWorkBeacon();
}

// ── Public queries / hooks consumed by app.js ─────────────────────────────
export function isLockinStudyRunning() {
    return !!(lockinSession.active && lockinSession.phase === 'STUDY' &&
        lockinSession.running && !lockinSession.expiredPendingTransition &&
        !lockinSession.awaitingRefill && _lockinLeftSecs > 0);
}

export function isLockinAwaitingRefill() {
    return !!(lockinSession.active && lockinSession.awaitingRefill);
}

export function getLockinLeftSecs() {
    if (!lockinSession.active) return 0;
    if (lockinSession.running && _lockinEndsAt > 0) {
        return Math.max(0, Math.round((_lockinEndsAt - Date.now()) / 1000));
    }
    return Math.max(0, _lockinLeftSecs);
}

/** Count a solved question toward the run's telemetry receipt + 4-solve Hot-Zone streak. */
export function noteLockinSolve(isCorrect = true) {
    if (!lockinSession.active) return { hotZone: false, streakInRun: 0 };
    lockinSession.solvedInRun += 1;
    lockinSession.solvedInBlock += 1;
    if (isCorrect === false) {
        lockinSession.streakInRun = 0;
        _updateDeepWorkBeacon();
        return { hotZone: false, streakInRun: 0 };
    }
    lockinSession.streakInRun = (lockinSession.streakInRun || 0) + 1;
    const hitHotZone = lockinSession.streakInRun > 0 && lockinSession.streakInRun % 4 === 0;
    _updateDeepWorkBeacon();
    if (hitHotZone) {
        try {
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                window.dispatchEvent(new CustomEvent('jmax:lockin-hotzone', {
                    detail: { streakInRun: lockinSession.streakInRun, solvedInRun: lockinSession.solvedInRun, mode: lockinSession.mode }
                }));
            }
        } catch (_) {}
    }
    return { hotZone: hitHotZone, streakInRun: lockinSession.streakInRun };
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
    // Close the practice stage first so any SessionRecap plays cleanly BEFORE Break / Complete / Sudden Death overlays.
    try { if (typeof window.closePracticeModal === 'function') window.closePracticeModal({ skipLockinCheck: true }); } catch (_) {}
    if (_shouldOfferSuddenDeath()) {
        _setDeepWorkActive(false);
        try { NightGuard.logSessionEnd(); } catch (_) {}
        _afterPendingRecap(() => showLockinSuddenDeathPrompt());
        return true;
    }
    _afterPendingRecap(() => _advanceToBreakOrFinish());
    return true;
}

/**
 * Mid-timer answer-pool exhaustion coordinator:
 *  - If >= 3 min remain and other chapters have untouched questions, pause the
 *    study block briefly inside the Refill Gate (2:00 grace) so the user can
 *    pick another chapter/subject and resume seamlessly.
 *  - Otherwise (< 3 min left or zero eligible chapters anywhere), complete and
 *    show the Victory banner cleanly.
 */
export function handleLockinPoolExhausted(opts) {
    if (!lockinSession.active || lockinSession.phase !== 'STUDY') {
        return { handled: false, action: 'none' };
    }
    if (lockinSession.expiredPendingTransition) {
        consumePendingLockinExpiry();
        return { handled: true, action: 'expired' };
    }
    const left = getLockinLeftSecs();
    _lockinLeftSecs = left;
    if (left <= 0) {
        _onLockinStudyExpire();
        if (lockinSession.expiredPendingTransition) consumePendingLockinExpiry();
        return { handled: true, action: 'expired' };
    }
    const catalog = (opts && opts.catalog)
        || (typeof window !== 'undefined' && typeof window.__getLockinScopeCatalog === 'function'
            ? window.__getLockinScopeCatalog(lockinSession.mode)
            : null);
    let totalAvail = 0;
    if (catalog) {
        for (const s of SUBJECT_KEYS) {
            totalAvail += (catalog[s] && catalog[s].totalEligible) || 0;
        }
    }
    if (left < LOCKIN_REFILL_MIN_LEFT_SECS || totalAvail <= 0) {
        completeLockinOnPoolExhausted({ earlyExhaustion: true });
        return { handled: true, action: 'victory' };
    }

    // Enter bounded Refill Gate: freeze block timer, preserve accumulated recap/seen history, open Scope Switcher.
    _flushCurrentLockinSegment();
    _clearLockinTick();
    lockinSession.running = false;
    lockinSession.awaitingRefill = true;
    _lockinPausedLeft = left;
    _setDeepWorkActive(false);
    _removePaceGlow();
    try {
        if (typeof window.closePracticeModal === 'function') {
            window.closePracticeModal({ skipLockinCheck: true, skipRecap: true, keepModeHistory: true });
        } else {
            const pm = document.getElementById('practice-modal');
            if (pm) pm.classList.remove('active');
        }
    } catch (_) {}
    _openScopeModal('refill', { catalog, remainingSecs: left, graceSecs: LOCKIN_REFILL_GRACE_SECS });
    _updateDeepWorkBeacon();
    return { handled: true, action: 'refill' };
}

/** Mid-timer answer-pool exhaustion — bank everything and crown the run. */
export function completeLockinOnPoolExhausted(opts) {
    if (!lockinSession.active) return false;
    const commitRes = _commitCompletedStudyBlock({ earlyExhaustion: !!(opts && opts.earlyExhaustion) });
    const elapsed = commitRes.secs;
    const solved = lockinSession.solvedInRun | 0;
    const mode = lockinSession.mode;
    const eloData = _buildRunNetEloData();
    const chain = focusLedger.chain;
    const duel = _settleLockinDuel({ forfeit: false });
    _clearLockinTick();
    lockinSession.running = false;
    _setDeepWorkActive(false);
    _resetLockinState();
    if (_isPracticeOpen()) {
        if (typeof window.closePracticeModal === 'function') {
            try { window.closePracticeModal({ skipLockinCheck: true }); } catch (_) {}
        } else {
            const pm = document.getElementById('practice-modal');
            if (pm) pm.classList.remove('active');
        }
    } else if (typeof window !== 'undefined' && typeof window.__playPendingSessionRecapIfAny === 'function') {
        try { window.__playPendingSessionRecapIfAny(); } catch (_) {}
    }
    _afterPendingRecap(() => showLockinVictory({
        elapsed,
        solved,
        netElo: eloData.netElo,
        eloText: eloData.eloText,
        chain,
        mode,
        shieldGranted: commitRes.shieldGranted,
        meetsMinBlock: commitRes.meetsMinBlock,
        earlyExhaustion: !!(opts && opts.earlyExhaustion),
        graceExpired: !!(opts && opts.graceExpired),
        duel,
    }));
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
    if (lockinSession.phase !== 'STUDY' || lockinSession.expiredPendingTransition || lockinSession.awaitingRefill) return;
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
    try { if (typeof window !== 'undefined' && window.Metro && typeof window.Metro.resumeAfterInterruption === 'function') window.Metro.resumeAfterInterruption(); } catch (_) {}
    const duelForfeit = wasActive ? _settleLockinDuel({ forfeit: true }) : null;
    if (wasActive) {
        _ledgerForfeit(0);
        try { window.dispatchEvent(new CustomEvent('jmax:pomo-forfeit')); } catch (_) {}
    }
    _resetLockinState();
    try { if (typeof window.exitPracticeMode === 'function') window.exitPracticeMode(); } catch (_) {}
    if (duelForfeit && duelForfeit.outcome === 'forfeit' && typeof window !== 'undefined' && typeof window.__jmaxAppToast === 'function') {
        const lossMsg = duelForfeit.eloDelta ? `${duelForfeit.eloDelta} ELO` : `${duelForfeit.shieldDelta} 🛡`;
        window.__jmaxAppToast(`Shadow Duel forfeited · ${lossMsg}`);
    }
}

// ── Scope Switcher Modal (Break / Break-End / Refill Gate) ────────────────
function _clearScopeGraceTimer() {
    if (_scopeGraceTimer) { clearInterval(_scopeGraceTimer); _scopeGraceTimer = null; }
    _scopeGraceEndsAt = 0;
    _scopeGraceLeftSecs = 0;
}

function _startScopeGraceTimer(secs) {
    _clearScopeGraceTimer();
    _scopeGraceLeftSecs = Math.max(1, secs | 0);
    _scopeGraceEndsAt = Date.now() + _scopeGraceLeftSecs * 1000;
    _renderScopeGraceUI();
    _scopeGraceTimer = setInterval(_scopeGraceTick, 1000);
}

function _scopeGraceTick() {
    if (!_scopeModalMode || (_scopeModalMode !== 'refill' && _scopeModalMode !== 'break-end')) return;
    if (_scopeGraceEndsAt <= 0) return;
    const left = Math.max(0, Math.round((_scopeGraceEndsAt - Date.now()) / 1000));
    _scopeGraceLeftSecs = left;
    _renderScopeGraceUI();
    if (left <= 0) {
        _clearScopeGraceTimer();
        _onScopeGraceExpired();
    }
}

function _renderScopeGraceUI() {
    const graceEl = document.getElementById('lockin-scope-grace');
    if (!graceEl) return;
    if (_scopeModalMode !== 'refill' && _scopeModalMode !== 'break-end') {
        graceEl.hidden = true;
        return;
    }
    graceEl.hidden = false;
    graceEl.textContent = `Pick within ${formatTime(_scopeGraceLeftSecs)}`;
    if (graceEl.classList) graceEl.classList.toggle('is-urgent', _scopeGraceLeftSecs <= 20);
}

function _onScopeGraceExpired() {
    const modeWas = _scopeModalMode;
    if (modeWas === 'refill') {
        _finalizeRefillExit(true);
    } else if (modeWas === 'break-end') {
        _finalizeBreakEndExit(true);
    }
}

function _fetchScopeCatalog() {
    if (typeof window !== 'undefined' && typeof window.__getLockinScopeCatalog === 'function') {
        try { return window.__getLockinScopeCatalog(lockinSession.mode); } catch (_) {}
    }
    return {
        physics: { totalEligible: 0, chapters: [] },
        chemistry: { totalEligible: 0, chapters: [] },
        maths: { totalEligible: 0, chapters: [] },
    };
}

function _pickInitialScopeSubject(catalog, preferredSubj) {
    const pref = isValidSubjectKey(preferredSubj) ? preferredSubj : 'physics';
    if (catalog && catalog[pref] && catalog[pref].totalEligible > 0) return pref;
    for (const s of SUBJECT_KEYS) {
        if (catalog && catalog[s] && catalog[s].totalEligible > 0) return s;
    }
    return pref;
}

function _seedScopeChaptersForSubject(subj) {
    _scopeSelectedChapters = new Set();
    const list = (_scopeCatalog && _scopeCatalog[subj] && _scopeCatalog[subj].chapters) || [];
    const avail = list.filter(c => c.count > 0);
    if (!avail.length) return;
    const refScope = lockinSession.pendingScope || lockinSession;
    if (refScope && refScope.subject === subj) {
        const refSet = Array.isArray(refScope.chapterSelection) && refScope.chapterSelection.length
            ? refScope.chapterSelection
            : (refScope.chapter ? [refScope.chapter] : []);
        for (const ch of avail) {
            if (refSet.some(r => String(r || '').trim().toLowerCase() === String(ch.name || '').trim().toLowerCase())) {
                _scopeSelectedChapters.add(ch.name);
            }
        }
    }
    if (_scopeSelectedChapters.size === 0) {
        _scopeSelectedChapters.add(avail[0].name);
    }
}

function _renderScopeModal() {
    const modal = document.getElementById('lockin-scope-modal');
    if (!modal) return;
    if (typeof modal.setAttribute === 'function') modal.setAttribute('data-scope-mode', _scopeModalMode || 'break');

    const titleEl = document.getElementById('lockin-scope-title');
    const subEl = document.getElementById('lockin-scope-sub');
    const closeBtn = document.getElementById('lockin-scope-close');
    const statusRow = document.getElementById('lockin-scope-status');
    const remEl = document.getElementById('lockin-scope-remaining');
    const secBtn = document.getElementById('lockin-scope-secondary');
    const confBtn = document.getElementById('lockin-scope-confirm');

    if (_scopeModalMode === 'break') {
        if (titleEl) titleEl.textContent = 'Switch Next Target';
        if (subEl) subEl.textContent = 'Break clock keeps running — pick the subject & chapter(s) for your next round.';
        if (closeBtn) closeBtn.hidden = false;
        if (statusRow) statusRow.hidden = true;
        if (secBtn) {
            secBtn.textContent = 'Cancel';
            if (secBtn.classList) secBtn.classList.remove('is-danger');
        }
        if (confBtn) confBtn.textContent = 'Queue Next Round';
    } else if (_scopeModalMode === 'break-end') {
        const nextRound = Math.min(lockinSession.totalSessions, lockinSession.currentSession + 1);
        if (titleEl) titleEl.textContent = 'Pick Next Target';
        if (subEl) subEl.textContent = 'Choose a subject and chapter(s) — the timer ignites when the first question loads.';
        if (closeBtn) closeBtn.hidden = true;
        if (statusRow) statusRow.hidden = false;
        if (remEl) remEl.textContent = `Round ${nextRound}/${lockinSession.totalSessions} · ${lockinSession.studyMins}m`;
        if (secBtn) {
            secBtn.textContent = 'End Session';
            if (secBtn.classList) secBtn.classList.add('is-danger');
        }
        if (confBtn) confBtn.textContent = `Start Round ${nextRound}`;
    } else if (_scopeModalMode === 'refill') {
        if (titleEl) titleEl.textContent = 'Chapter Pool Cleared';
        if (subEl) subEl.textContent = 'Pick your next chapter(s) to continue this block right where you left off.';
        if (closeBtn) closeBtn.hidden = true;
        if (statusRow) statusRow.hidden = false;
        if (remEl) remEl.textContent = `${formatTime(_lockinPausedLeft || _lockinLeftSecs)} left in Block ${lockinSession.currentSession}/${lockinSession.totalSessions}`;
        if (secBtn) {
            secBtn.textContent = 'Bank & End Here';
            if (secBtn.classList) secBtn.classList.add('is-danger');
        }
        if (confBtn) confBtn.textContent = 'Continue Lock-In';
    }

    _renderScopeGraceUI();

    for (const s of SUBJECT_KEYS) {
        const cnt = (_scopeCatalog && _scopeCatalog[s] && _scopeCatalog[s].totalEligible) || 0;
        const cntEl = document.getElementById(`lsc-count-${s}`);
        if (cntEl) cntEl.textContent = String(cnt);
        const btn = modal.querySelector ? modal.querySelector(`.lsc-subj-btn[data-subject="${s}"]`) : null;
        if (btn) {
            btn.disabled = cnt <= 0;
            if (btn.classList) btn.classList.toggle('active', s === _scopeSelectedSubject);
        }
    }

    const chListEl = document.getElementById('lockin-scope-chapters');
    const chapters = (_scopeCatalog && _scopeCatalog[_scopeSelectedSubject] && _scopeCatalog[_scopeSelectedSubject].chapters) || [];
    if (chListEl) {
        chListEl.innerHTML = '';
        if (!chapters.length) {
            const empty = document.createElement('div');
            empty.className = 'lsc-empty-msg';
            empty.textContent = 'No chapters in this subject yet.';
            chListEl.appendChild(empty);
        } else {
            for (const ch of chapters) {
                const label = document.createElement('label');
                const isAvail = ch.count > 0;
                const isChecked = isAvail && _scopeSelectedChapters.has(ch.name);
                label.className = `multi-chapter-option${isAvail ? '' : ' is-empty'}${isChecked ? ' is-selected' : ''}`;

                const input = document.createElement('input');
                input.type = 'checkbox';
                input.value = ch.name;
                input.checked = isChecked;
                input.disabled = !isAvail;
                input.addEventListener('change', () => {
                    if (input.checked) _scopeSelectedChapters.add(ch.name);
                    else _scopeSelectedChapters.delete(ch.name);
                    if (label.classList) label.classList.toggle('is-selected', input.checked);
                    _renderScopeSelectionSummary();
                });

                const nameSpan = document.createElement('span');
                nameSpan.className = 'mco-name';
                nameSpan.textContent = ch.name;

                const countSpan = document.createElement('span');
                countSpan.className = 'mco-count';
                countSpan.textContent = String(ch.count);

                label.appendChild(input);
                label.appendChild(nameSpan);
                label.appendChild(countSpan);
                chListEl.appendChild(label);
            }
        }
    }
    _renderScopeSelectionSummary();
}

function _renderScopeSelectionSummary() {
    const chapters = (_scopeCatalog && _scopeCatalog[_scopeSelectedSubject] && _scopeCatalog[_scopeSelectedSubject].chapters) || [];
    let qCount = 0;
    for (const ch of chapters) {
        if (_scopeSelectedChapters.has(ch.name)) qCount += ch.count;
    }
    const sumEl = document.getElementById('lockin-scope-summary');
    if (sumEl) {
        const chNum = _scopeSelectedChapters.size;
        sumEl.textContent = chNum
            ? `${qCount} eligible question${qCount === 1 ? '' : 's'} · ${chNum} chapter${chNum === 1 ? '' : 's'}`
            : 'Select at least 1 available chapter';
    }
    const confBtn = document.getElementById('lockin-scope-confirm');
    if (confBtn) confBtn.disabled = _scopeSelectedChapters.size === 0 || qCount <= 0;
}

function _openScopeModal(mode, opts) {
    if (!lockinSession.active) return false;
    _bindLockinEscOnce();
    _scopeModalMode = mode;
    _scopeCatalog = (opts && opts.catalog) || _fetchScopeCatalog();
    const prefSubj = (lockinSession.pendingScope && lockinSession.pendingScope.subject) || lockinSession.subject;
    _scopeSelectedSubject = _pickInitialScopeSubject(_scopeCatalog, prefSubj);
    _seedScopeChaptersForSubject(_scopeSelectedSubject);

    if (mode === 'refill') {
        _startScopeGraceTimer((opts && opts.graceSecs) || LOCKIN_REFILL_GRACE_SECS);
    } else if (mode === 'break-end') {
        _startScopeGraceTimer((opts && opts.graceSecs) || LOCKIN_BREAK_END_GRACE_SECS);
    } else {
        _clearScopeGraceTimer();
    }

    try { if (SessionFocus && SessionFocus.acquire) SessionFocus.acquire('lockin-scope'); } catch (_) {}
    _renderScopeModal();
    const modal = document.getElementById('lockin-scope-modal');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
    }
    return true;
}

function _closeScopeModal() {
    _clearScopeGraceTimer();
    _scopeModalMode = null;
    _scopeCatalog = null;
    try { if (SessionFocus && SessionFocus.release) SessionFocus.release('lockin-scope'); } catch (_) {}
    const modal = document.getElementById('lockin-scope-modal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
}

function _transitionBreakSwitchToBreakEnd() {
    if (!_scopeModalMode) return;
    _scopeModalMode = 'break-end';
    lockinSession.awaitingBreakSwitch = true;
    _startScopeGraceTimer(LOCKIN_BREAK_END_GRACE_SECS);
    _renderScopeModal();
    _updateDeepWorkBeacon();
}

function _openBreakEndScopePicker() {
    if (!lockinSession.active) return;
    lockinSession.awaitingBreakSwitch = true;
    _openScopeModal('break-end', { graceSecs: LOCKIN_BREAK_END_GRACE_SECS });
    _updateDeepWorkBeacon();
}

function _finalizeRefillExit(graceExpired = false) {
    _closeScopeModal();
    lockinSession.awaitingRefill = false;
    completeLockinOnPoolExhausted({ earlyExhaustion: true, graceExpired: !!graceExpired });
    if (typeof window !== 'undefined' && typeof window.__exitLockinFlowUi === 'function') {
        try { window.__exitLockinFlowUi(); } catch (_) {}
    }
    if (graceExpired && typeof window.__jmaxAppToast === 'function') {
        window.__jmaxAppToast('Refill window expired — solved progress & study time banked.');
    }
}

function _finalizeBreakEndExit(graceExpired = false) {
    const completed = Math.max(1, lockinSession.currentSession || 1);
    _closeScopeModal();
    lockinSession.awaitingBreakSwitch = false;
    try { GalleryBreak.abort(); } catch (_) {}
    try { if (typeof window !== 'undefined' && window.Metro && typeof window.Metro.resumeAfterInterruption === 'function') window.Metro.resumeAfterInterruption(); } catch (_) {}
    _setDeepWorkActive(false);
    _finishLockinCycle({ blocksCompleted: completed });
    if (graceExpired && typeof window.__jmaxAppToast === 'function') {
        window.__jmaxAppToast('Switch window expired — completed rounds sealed.');
    }
}

export function openLockinBreakSwitch() {
    if (!lockinSession.active || lockinSession.phase !== 'BREAK') return false;
    const catalog = _fetchScopeCatalog();
    let totalAvail = 0;
    for (const s of SUBJECT_KEYS) totalAvail += (catalog[s] && catalog[s].totalEligible) || 0;
    if (totalAvail <= 0) {
        if (typeof window.__jmaxAppToast === 'function') {
            window.__jmaxAppToast('No untouched Flow questions left in any subject.');
        }
        return false;
    }
    return _openScopeModal('break', { catalog });
}

export function lockinScopeSelectSubject(subj) {
    if (!isValidSubjectKey(subj) || !_scopeCatalog) return;
    if (!_scopeCatalog[subj] || _scopeCatalog[subj].totalEligible <= 0) return;
    _scopeSelectedSubject = subj;
    _seedScopeChaptersForSubject(subj);
    _renderScopeModal();
}

export function lockinScopeSelectAll() {
    if (!_scopeCatalog || !_scopeSelectedSubject) return;
    const chapters = (_scopeCatalog[_scopeSelectedSubject] && _scopeCatalog[_scopeSelectedSubject].chapters) || [];
    const avail = chapters.filter(c => c.count > 0);
    if (!avail.length) return;
    const allPicked = avail.every(c => _scopeSelectedChapters.has(c.name));
    _scopeSelectedChapters = new Set();
    if (!allPicked) {
        for (const c of avail) _scopeSelectedChapters.add(c.name);
    } else {
        _scopeSelectedChapters.add(avail[0].name);
    }
    _renderScopeModal();
}

export function lockinScopeConfirm() {
    if (!_scopeModalMode) return;
    const chapters = Array.from(_scopeSelectedChapters);
    if (!chapters.length) return;
    const chosenScope = {
        subject: _scopeSelectedSubject,
        chapter: chapters.length === 1 ? chapters[0] : chapters.join(' • '),
        chapterSelection: chapters.length === 1 ? null : chapters.slice(),
    };
    const mode = _scopeModalMode;

    if (mode === 'break') {
        lockinSession.pendingScope = chosenScope;
        _closeScopeModal();
        _updateLockinBreakHud();
        if (typeof window.__jmaxAppToast === 'function') {
            window.__jmaxAppToast(`Next round queued: ${_formatScopeLabel(chosenScope)}`);
        }
        return;
    }

    if (mode === 'break-end') {
        lockinSession.pendingScope = chosenScope;
        lockinSession.awaitingBreakSwitch = false;
        _closeScopeModal();
        try {
            if (GalleryBreak.isActive() && typeof GalleryBreak.reverseOut === 'function') {
                GalleryBreak.reverseOut(() => _endLockinBreak(true));
                return;
            }
        } catch (_) {}
        _endLockinBreak(false);
        return;
    }

    if (mode === 'refill') {
        const pausedLeft = Math.max(1, _lockinPausedLeft || _lockinLeftSecs || 1);
        lockinSession.awaitingRefill = false;
        _applyScopeToLockinSession(chosenScope);
        _closeScopeModal();

        let launched = false;
        if (typeof window.__launchLockinScope === 'function') {
            try {
                launched = !!window.__launchLockinScope(lockinSession, { preserveRecap: true, preserveSeen: true });
            } catch (e) { console.warn('[lockin] refill launch failed', e); }
        }
        if (!launched) {
            completeLockinOnPoolExhausted({ earlyExhaustion: true });
            return;
        }
        lockinSession.phase = 'STUDY';
        lockinSession.running = true;
        lockinSession.expiredPendingTransition = false;
        _lockinLeftSecs = pausedLeft;
        _lockinEndsAt = Date.now() + _lockinLeftSecs * 1000;
        _setDeepWorkActive(true);
        _clearLockinTick();
        _lockinTimer = setInterval(_lockinTick, 1000);
        _updateDeepWorkBeacon();
    }
}

export function lockinScopeSecondary() {
    if (_scopeModalMode === 'break') {
        _closeScopeModal();
    } else if (_scopeModalMode === 'break-end') {
        _finalizeBreakEndExit(false);
    } else if (_scopeModalMode === 'refill') {
        _finalizeRefillExit(false);
    }
}

export function lockinScopeCancel() {
    if (_scopeModalMode === 'break') {
        _closeScopeModal();
    }
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
    const target = lockinSession.pendingScope || lockinSession;
    if (nextEl) {
        const icon = lockinSession.mode === 'hardcore' ? 'Hardcore' : 'Flow State';
        const scopeStr = _formatScopeLabel(target);
        const d = lockinSession.duel;
        let duelStr = '';
        if (d && d.active) {
            duelStr = d.userPts < d.ghostPts
                ? ` · DOWN ${d.userPts}–${d.ghostPts} ${_escHtml(d.shortLabel)} (AT RISK)`
                : (d.userPts > d.ghostPts
                    ? ` · UP ${d.userPts}–${d.ghostPts} ${_escHtml(d.shortLabel)}`
                    : ` · TIED ${d.userPts}–${d.ghostPts} ${_escHtml(d.shortLabel)}`);
        }
        nextEl.textContent = `Next: Round ${lockinSession.currentSession + 1}/${lockinSession.totalSessions} · ${icon}${scopeStr ? ` · ${scopeStr}` : ''}${duelStr}`;
    }
    const swBtn = document.getElementById('lbh-switch-btn');
    if (swBtn) {
        const queued = !!lockinSession.pendingScope;
        if (swBtn.classList) swBtn.classList.toggle('is-queued', queued);
        swBtn.textContent = queued ? 'Switch Queued ✓' : 'Switch Subject';
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
    if (d.duel) {
        _showDuelCompletionModal(d);
        return;
    }
    _setNotifyVariant('victory');
    const kicker = $('notify-kicker');
    if (kicker) kicker.hidden = true;
    $('notify-icon').textContent = '🏆';
    $('notify-title').textContent = d.earlyEnded ? 'Block Banked Early' : 'Chapter Pool Cleared!';
    $('notify-message').textContent = d.graceExpired
        ? 'The refill timer expired — your worked study time has been banked cleanly.'
        : 'You conquered every eligible question before the clock ran out. The lock-in timer stops here — all elapsed time has been banked.';
    const receipt = $('notify-receipt');
    if (receipt) {
        const isHc = d.mode === 'hardcore';
        const eloVal = d.eloText || `${(d.netElo || 0) >= 0 ? '+' : ''}${d.netElo || 0}`;
        let payoutVal = '1.0× Flow';
        if (isHc) {
            payoutVal = d.shieldGranted === false
                ? 'Elapsed Time Banked (< 5m · no shield)'
                : '2.0× Hardcore Bonus (+1 🛡)';
        } else if (d.meetsMinBlock === false) {
            payoutVal = 'Elapsed Time Banked (< 5m · chain unchanged)';
        }
        const rows = [
            { k: 'Elapsed grind credited', v: formatStudyDuration(d.elapsed || 0) },
            { k: 'Questions solved', v: String(d.solved || 0) },
            { k: 'Focus chain', v: String(d.chain || 0) },
            { k: 'Escrow payout', v: payoutVal },
        ];
        receipt.innerHTML = _receiptRows(rows);
        receipt.hidden = false;
    }
    const secondary = $('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    _applyNotifyRematchButton(null);
    const primary = $('notify-primary');
    if (primary) primary.textContent = "Let's Go";
    playBell();
    $('timer-notify-modal').classList.add('active');
}

export function showLockinSuddenDeathPrompt() {
    const d = lockinSession.duel;
    if (!d || !d.active) { _finishLockinCycle(); return; }
    const stake = DUEL_STAKES[d.stake] || DUEL_STAKES.elo10;
    _setNotifyVariant('sudden-death');
    const kicker = $('notify-kicker');
    if (kicker) {
        kicker.hidden = false;
        kicker.textContent = 'FINAL BLOCK TIED · ALL-OR-NOTHING';
    }
    $('notify-icon').textContent = '⚡';
    $('notify-title').textContent = 'SUDDEN DEATH · TIED MATCH';
    $('notify-message').textContent = `You and ${d.label} finished level at ${d.userPts}–${d.ghostPts}. Your study block is already banked — settle the duel on 1 high-ELO decider question?`;
    const receipt = $('notify-receipt');
    if (receipt) {
        receipt.innerHTML = _receiptRows([
            { k: 'Match score', v: `YOU ${d.userPts} – ${d.ghostPts} ${_escHtml(d.shortLabel)} (${d.gradedCount} Qs)` },
            { k: 'Pot at stake', v: _escHtml(stake.desc) },
            { k: 'Protection', v: 'Study time & chain already safely banked' },
        ]);
        receipt.hidden = false;
    }
    const secondary = $('notify-secondary');
    if (secondary) { secondary.textContent = 'Split Pot (Draw)'; secondary.style.display = 'block'; }
    const rematch = $('notify-rematch');
    if (rematch) rematch.style.display = 'none';
    const primary = $('notify-primary');
    if (primary) primary.textContent = 'Enter Sudden Death ⚡';
    playBell();
    $('timer-notify-modal').classList.add('active');
}

export function showLockinBreach() {
    _setNotifyVariant('breach');
    const kicker = $('notify-kicker');
    if (kicker) kicker.hidden = true;
    const elapsed = _elapsedStudySecs();
    $('notify-icon').textContent = '⛓️';
    $('notify-title').textContent = 'Void This Lock-In Block?';
    $('notify-message').textContent = "Closing the practice stage now ends your lock-in timer early. This specific block's time period will NOT be counted.";
    const receipt = $('notify-receipt');
    if (receipt) {
        const rows = [
            { k: 'Escrow time voided', v: `${formatTime(elapsed)} (0m will be counted)` },
            { k: 'Focus chain', v: `chain of ${focusLedger.chain} → 0` },
            { k: 'Mode multiplier', v: lockinSession.mode === 'hardcore' ? '1.8× WIN bonus lost' : '×1.5 Deep Work bonus lost' },
        ];
        const d = lockinSession.duel;
        if (d && d.active && (d.gradedCount >= 2 || d.userPts < d.ghostPts)) {
            rows.push({ k: 'Shadow Duel risk', v: 'Counts as Forfeit' });
        }
        receipt.innerHTML = _receiptRows(rows);
        receipt.hidden = false;
    }
    const secondary = $('notify-secondary');
    if (secondary) { secondary.textContent = 'Void Block & Exit'; secondary.style.display = 'block'; }
    const rematch = $('notify-rematch');
    if (rematch) rematch.style.display = 'none';
    const primary = $('notify-primary');
    if (primary) primary.textContent = 'Stay Locked In →';
    // No bell — this is a warning, not a reward.
    $('timer-notify-modal').classList.add('active');
}

export function showLockinComplete(data) {
    const d = data || {};
    if (d.duel) {
        _showDuelCompletionModal(d);
        return;
    }
    _setNotifyVariant('complete');
    const kicker = $('notify-kicker');
    if (kicker) kicker.hidden = true;
    $('notify-icon').textContent = '🎉';
    $('notify-title').textContent = 'Lock-In Cycle Complete';
    $('notify-message').textContent = 'Every block sealed. Time banked, chain grown. Take the win — you earned the rest.';
    const receipt = $('notify-receipt');
    if (receipt) {
        const blocks = Math.max(1, d.blocks || lockinSession.totalSessions || 1);
        const solved = d.solved != null ? d.solved : (lockinSession.solvedInRun | 0);
        const netElo = d.netElo != null ? d.netElo : 0;
        const eloVal = d.eloText || `${netElo >= 0 ? '+' : ''}${netElo}`;
        const isHc = (d.mode || lockinSession.mode) === 'hardcore';
        const rows = [
            { k: 'Blocks sealed', v: String(blocks) },
            { k: 'Questions solved', v: String(solved) },
            { k: 'Escrow payout', v: isHc ? '2.0× Hardcore Bonus (+1 🛡)' : '1.0× Flow' },
            { k: 'Deep today', v: formatStudyDuration(focusLedger.deep) },
            { k: 'Focus chain', v: String(focusLedger.chain) },
        ];
        receipt.innerHTML = _receiptRows(rows);
        receipt.hidden = false;
    }
    const secondary = $('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    _applyNotifyRematchButton(null);
    const primary = $('notify-primary');
    if (primary) primary.textContent = "Let's Go";
    playBell();
    $('timer-notify-modal').classList.add('active');
}

export function rematchLastDuel() {
    $('timer-notify-modal').classList.remove('active');
    const kicker = $('notify-kicker');
    if (kicker) kicker.hidden = true;
    const secondary = $('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    const rematch = $('notify-rematch');
    if (rematch) rematch.style.display = 'none';
    _setNotifyVariant('');

    const ctx = _lastRematchCtx || _lastSetupCtx;
    if (!ctx) return false;
    const onConfirm = typeof ctx.onConfirm === 'function'
        ? ctx.onConfirm
        : ((sess) => {
            if (typeof window !== 'undefined' && typeof window.__launchLockinScope === 'function') {
                window.__launchLockinScope(sess);
            }
        });
    return openLockinSetupModal(ctx.mode || 'flow', {
        subject: ctx.subject,
        chapter: ctx.chapter,
        chapterSelection: ctx.chapterSelection,
        duelPrefs: ctx.duelPrefs,
    }, onConfirm);
}

// ── Inline-onclick bridges (index.html) ───────────────────────────────────
try {
    window.openLockinSetupModal = openLockinSetupModal;
    window.lockinClose = closeLockinSetupModal;
    window.lockinConfirm = confirmLockinSetup;
    window.lockinPreset = applyLockinPreset;
    window.lockinStep = stepLockinField;
    window.lockinRefresh = refreshLockinTimeline;
    window.lockinDuelPreset = lockinDuelPreset;
    window.lockinDuelAir = lockinDuelAir;
    window.lockinDuelStake = lockinDuelStake;
    window.rematchLastDuel = rematchLastDuel;
    window.skipLockinRest = skipLockinRest;
    window.addLockinRest = addLockinRest;
    window.endLockinSession = endLockinSession;
    window.voidLockinBlock = voidLockinBlock;
    window.stayLockedIn = stayLockedIn;
    window.openLockinBreakSwitch = openLockinBreakSwitch;
    window.lockinScopeSelectSubject = lockinScopeSelectSubject;
    window.lockinScopeSelectAll = lockinScopeSelectAll;
    window.lockinScopeConfirm = lockinScopeConfirm;
    window.lockinScopeSecondary = lockinScopeSecondary;
    window.lockinScopeCancel = lockinScopeCancel;
} catch (_) {}

// ── Tuck-In / bridge focus-ledger bridge (app.js reads window.POMO_API) ────
try { window.POMO_API = { getFocusLedger, getLockinSession: () => ({ ...lockinSession }), startLockinSuddenDeath, completeLockinSuddenDeath, isLockinSuddenDeath }; } catch (_) {}
