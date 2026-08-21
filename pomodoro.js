// ==================== POMODORO MODULE ====================
import { formatTime, formatStudyDuration, saveAllAsync, studySecs } from './storage.js';
import { GalleryBreak } from './gallery-break.js';
import { NightGuard } from './nightguard.js';

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
    isRunning: () => pomoState !== 'IDLE',
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
    const arc = document.getElementById('mini-ring-arc');
    if (!arc) return;
    const p = Math.min(1, Math.max(0, percent || 0));
    arc.style.strokeDashoffset = String(MINI_RING_CIRC * (1 - p));
}

/** data-state drives the whole widget skin: idle | study | break */
function syncWidget(state) {
    const w = document.getElementById('pomo-mini-widget');
    if (!w || typeof w.setAttribute !== 'function') return;   // stub-safe
    w.setAttribute('data-state', state);
}

function syncWidgetPaused(paused) {
    const w = document.getElementById('pomo-mini-widget');
    if (!w) return;
    if (typeof w.setAttribute !== 'function') return;         // stub-safe
    if (paused) w.setAttribute('data-paused', '');
    else w.removeAttribute('data-paused');
}

/** "ends 14:35" — the wall-clock moment the live block pays out. */
function _updateMiniEnd() {
    const el = document.getElementById('mini-end');
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
    const el = document.getElementById('mini-tally');
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
    const filterEl = document.getElementById('question-filter');
    if (filterEl) filterEl.disabled = pomoState !== 'IDLE';
}
let timerTotalSeconds = 0;        // total seconds for countdown
let stopwatchAccumulated = 0;    // seconds already counted before pause (stopwatch mode)
let timerEndTriggered = false;   // prevent multiple handleTimerEnd calls
let pausedElapsed = 0;           // countdown seconds elapsed at pause (preserved across resume)
let lastTickAt = null;           // wall-clock anchor for per-second study credit
let lastSavedStudyMinute = 0;    // save watermark for whole-minute study credit
let _resetPomoTimer = null;      // pending quitTimer UI reset

let bellAudioCtx = null;
let _pomoPendingAction = null;   // replaces window._pomoPendingAction

// ── Pomodoro config persistence ────────────────────────────────────────────
// The last-used timer setup is snapshotted to localStorage the moment a
// session starts, then re-applied at boot. This keeps returning users' Focus
// Mode settings stable across reloads, and lets the Daily Briefing flow
// pre-fill / auto-arm the timer with the exact configuration last run.
// Best-effort only — private mode / quota failures degrade silently.
const POMO_CONFIG_KEY = 'jeemax_pomo_config';

export function savePomoConfig() {
    try {
        const cfg = {
            subject: studySubject,
            study: parseInt(document.getElementById('pomo-study').value, 10) || 50,
            break: parseInt(document.getElementById('pomo-break').value, 10) || 10,
            sessions: parseInt(document.getElementById('pomo-sessions').value, 10) || 1,
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
        const el = document.getElementById(id);
        if (el) el.value = val;
    };
    setVal('pomo-study', cfg.study);
    setVal('pomo-break', cfg.break);
    setVal('pomo-sessions', cfg.sessions);
    const subjectEl = document.getElementById('pomo-subject');
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
        document.getElementById('timer-display').textContent = formatTime(secondsLeft);
        document.getElementById('mini-time').textContent = formatTime(secondsLeft);
        return;
    }

    // Recalculate time based on real elapsed time
    const elapsed = Math.floor((Date.now() - timerStartTime) / 1000);
    const remaining = Math.max(0, timerTotalSeconds - elapsed);
    secondsLeft = remaining;

    // Update display
    document.getElementById('timer-display').textContent = formatTime(secondsLeft);
    document.getElementById('mini-time').textContent = formatTime(secondsLeft);
    const percent = timerTotalSeconds ? ((timerTotalSeconds - remaining) / timerTotalSeconds) * 100 : 0;
    if (visualMode === 'bar') {
        document.getElementById('pomo-progress').style.width = `${percent}%`;
    } else {
        document.getElementById('pomo-beaker-fill').style.height = `${percent}%`;
    }
    _updateMiniRing(percent / 100);
    if (pomoState === 'BREAK') GalleryBreak.setProgress(percent / 100);

    // If the timer should have finished while we were away, trigger end now
    if (remaining <= 0 && !timerEndTriggered) {
        timerEndTriggered = true; // set synchronously — no duplicate end UI
        clearInterval(timerInterval);
        await saveAllAsync().catch(console.error);
        handleTimerEnd();
    }
});

// ---- Visual toggles ----
export function toggleVisualizer() {
    visualMode = visualMode === 'bar' ? 'beaker' : 'bar';
    document.getElementById('vis-bar').style.display = visualMode === 'bar' ? 'block' : 'none';
    document.getElementById('vis-beaker').style.display = visualMode === 'beaker' ? 'block' : 'none';
}

export function toggleMiniWidget() {
    const widget = document.getElementById('pomo-mini-widget');
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
    popMinutes = cfg ? cfg.study : (parseInt(document.getElementById('pomo-study')?.value, 10) || 25);
    popRounds = cfg ? cfg.sessions : 1;
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
    const mEl = document.getElementById('pop-minutes');
    if (mEl) mEl.textContent = String(popMinutes);
    const rEl = document.getElementById('pop-rounds');
    if (rEl) rEl.textContent = String(popRounds);
    const reasonEl = document.getElementById('pop-reason');
    if (reasonEl) reasonEl.textContent = _popReason();
    document.querySelectorAll('#pop-subjects .pop-sub').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.subject === studySubject);
    });
    const dyn = document.getElementById('pop-dynamic');
    if (dyn) dyn.classList.toggle('on', dynamicSubject);
    // Idle pill preview mirrors the suggestion.
    const timeEl = document.getElementById('mini-time');
    if (timeEl && pomoState === 'IDLE') timeEl.textContent = formatTime(popMinutes * 60);
    const statusEl = document.getElementById('mini-status');
    if (statusEl && pomoState === 'IDLE') statusEl.textContent = 'SPRINT';
    _updateMiniTally();
    const reason2 = document.getElementById('mini-reason');
    if (reason2) reason2.textContent = focusLedger.done > 0 ? '' : 'tap ▶ to lock in';
}

export function openPomoPop() {
    // Running? The pill body becomes a shortcut to the full Focus view.
    if (pomoState !== 'IDLE') {
        if (window.switchTab) window.switchTab('pomodoro', null);
        return;
    }
    popOpen = true;
    const pop = document.getElementById('pomo-pop');
    const w = document.getElementById('pomo-mini-widget');
    if (pop) pop.classList.add('open');
    if (w && typeof w.setAttribute === 'function') w.setAttribute('data-pop', '');
    _syncPopControls();
}

export function closePomoPop() {
    popOpen = false;
    const pop = document.getElementById('pomo-pop');
    const w = document.getElementById('pomo-mini-widget');
    if (pop) pop.classList.remove('open');
    if (w && typeof w.removeAttribute === 'function') w.removeAttribute('data-pop');
}

// Outside click closes the popover (module-level, guarded for stubs).
if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', (e) => {
        if (!popOpen) return;
        const w = document.getElementById('pomo-mini-widget');
        if (w && !w.contains(e.target)) closePomoPop();
    });
}

export function popSetSubject(sub) {
    if (!isValidSubjectKey(sub)) return;
    const select = document.getElementById('pomo-subject');
    if (select) { select.value = sub; changeStudySubject(); }
    else { studySubject = sub; updateMiniSubject(); }
    _syncPopControls();
}

export function popAdjustMinutes(delta) {
    _seedPopConfig();
    popMinutes = Math.min(120, Math.max(5, popMinutes + delta));
    const input = document.getElementById('pomo-study');
    if (input) input.value = String(popMinutes);   // write-through: form stays source of truth
    updateProjection();
    _syncPopControls();
}

export function popAdjustRounds(delta) {
    _seedPopConfig();
    popRounds = Math.min(8, Math.max(1, popRounds + delta));
    const input = document.getElementById('pomo-sessions');
    if (input) input.value = String(popRounds);
    updateProjection();
    _syncPopControls();
}

/** Shared launch path for ▶ (idle pill) and the popover's Start button. */
export function startSprintFromWidget() {
    if (pomoState !== 'IDLE') return;
    _seedPopConfig();
    const studyInput = document.getElementById('pomo-study');
    if (studyInput) studyInput.value = String(popMinutes);
    const sessionsInput = document.getElementById('pomo-sessions');
    if (sessionsInput) sessionsInput.value = String(popRounds);
    const select = document.getElementById('pomo-subject');
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
    const btn = document.getElementById('mini-pause');
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
    const select = document.getElementById('pomo-subject');
    if (!select || !isValidSubjectKey(select.value)) return;
    studySubject = select.value;
    updateMiniSubject();

    // Live status line refresh while a session is underway.
    const status = document.getElementById('timer-status');
    if (!status) return;
    if (pomoState === 'STOPWATCH') {
        status.textContent = `Stopwatch: ${studySubject.toUpperCase()}`;
    } else if (pomoState === 'STUDY') {
        status.textContent = `Studying ${studySubject.toUpperCase()} (${currentSession}/${totalSessions})`;
    }
}

function updateMiniSubject() {
    const badge = document.getElementById('mini-subject');
    if (badge) badge.textContent = studySubject.toUpperCase();
}

export function updateStudyTimeHeader() {
    const total = studySecs.physics + studySecs.chemistry + studySecs.maths;
    const th = Math.floor(total / 3600);
    const tm = Math.floor((total % 3600) / 60);
    document.getElementById('top-study-time').textContent = th > 0 ? `${th}h ${tm}m` : `${tm}m`;
    document.getElementById('stat-hrs-physics').textContent = formatStudyDuration(studySecs.physics);
    document.getElementById('stat-hrs-chemistry').textContent = formatStudyDuration(studySecs.chemistry);
    document.getElementById('stat-hrs-maths').textContent = formatStudyDuration(studySecs.maths);
}

// ── Commitment projection ─────────────────────────────────────────────────
// Before locking in, the form states the contract in plain numbers: what
// you're signing up for and what it pays. Updates live on every input.
export function updateProjection() {
    const el = document.getElementById('pomo-projection');
    if (!el) return;
    const study = parseInt(document.getElementById('pomo-study')?.value, 10) || 0;
    const chill = parseInt(document.getElementById('pomo-break')?.value, 10) || 0;
    const rounds = parseInt(document.getElementById('pomo-sessions')?.value, 10) || 1;
    if (study <= 0 || rounds <= 0) { el.textContent = ''; return; }
    const totalMin = study * rounds + chill * Math.max(0, rounds - 1);
    const h = Math.floor(totalMin / 60);
    const label = h > 0 ? `${h}h ${totalMin % 60}m` : `${totalMin}m`;
    el.textContent = `${study}m × ${rounds} round${rounds > 1 ? 's' : ''} ≈ ${label} committed · every solve banks ×1.5 ELO while you're locked in`;
}

// ── Focus view hydration (ledger strip + chain pips) ──────────────────────
export function hydrateFocusStats() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('fs-done', String(focusLedger.done));
    set('fs-deep', formatStudyDuration(focusLedger.deep));
    set('fs-chain', String(focusLedger.chain));
    set('fs-best', String(focusLedger.best));
    set('fs-forfeit', String(focusLedger.forfeit));
    const pips = document.getElementById('chain-pips');
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
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateProjection);
    });
} catch (_) {}

// ---- Improved bell (persistent AudioContext) ----
export function initAudioContext() {
    if (!bellAudioCtx) {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) bellAudioCtx = new AudioContext();
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

// ---- Timer Notification Popup ----
// receiptHTML (optional) renders a session receipt — what the finished block
// paid out — inside the modal. Kept as escaped, pre-built markup rows.
function showTimerNotification(title, icon, message, nextAction, receiptHTML) {
    _pomoPendingAction = nextAction;
    document.getElementById('notify-title').textContent = title;
    document.getElementById('notify-icon').textContent = icon;
    document.getElementById('notify-message').textContent = message;

    const receipt = document.getElementById('notify-receipt');
    if (receipt) {
        if (receiptHTML) { receipt.innerHTML = receiptHTML; receipt.hidden = false; }
        else { receipt.innerHTML = ''; receipt.hidden = true; }
    }
    const secondary = document.getElementById('notify-secondary');
    if (secondary) secondary.style.display = 'none';

    playBell(); // bell now safe to call

    document.getElementById('timer-notify-modal').classList.add('active');

    document.getElementById('btn-start').style.display = 'none';
    document.getElementById('btn-pause').style.display = 'none';
    document.getElementById('btn-quit').style.display = 'none';
    document.getElementById('break-actions').classList.remove('active');
    document.getElementById('pomo-mini-widget').classList.add('hidden');
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
    document.getElementById('timer-notify-modal').classList.remove('active');
    const secondary = document.getElementById('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    if (_pomoPendingAction) {
        const action = _pomoPendingAction;
        _pomoPendingAction = null;
        action();
    } else {
        resetPomoUI();
    }
}

/** "Keep Going" on the quit-confirm — un-breaks the clock and resumes. */
export function notifyKeepGoing() {
    document.getElementById('timer-notify-modal').classList.remove('active');
    const secondary = document.getElementById('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    _pomoPendingAction = null;
    document.getElementById('pomo-mini-widget').classList.remove('hidden');
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

    document.getElementById('notify-title').textContent = 'Break the chain?';
    document.getElementById('notify-icon').textContent = '⛓️';
    document.getElementById('notify-message').textContent =
        `${formatTime(elapsed)} of ${studySubject.toUpperCase()} still counts — but your ${focusLedger.chain}-block chain resets to zero.`;

    const receipt = document.getElementById('notify-receipt');
    if (receipt) {
        receipt.innerHTML = _receiptRows([
            { k: 'Kept', v: `${formatTime(elapsed)} logged to ${studySubject.toUpperCase()}` },
            { k: 'Lost', v: focusLedger.chain > 0 ? `chain of ${focusLedger.chain} → 0` : 'nothing — no chain live' },
            { k: 'Forfeits today', v: String(focusLedger.forfeit + 1) },
        ]);
        receipt.hidden = false;
    }
    const secondary = document.getElementById('notify-secondary');
    if (secondary) secondary.style.display = 'block';

    // No bell here — this modal is a warning, not a reward.
    document.getElementById('timer-notify-modal').classList.add('active');
    document.getElementById('btn-start').style.display = 'none';
    document.getElementById('btn-pause').style.display = 'none';
    document.getElementById('btn-quit').style.display = 'none';
    document.getElementById('break-actions').classList.remove('active');
    document.getElementById('pomo-mini-widget').classList.add('hidden');
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

    document.getElementById('timer-notify-modal').classList.remove('active');
    const secondary = document.getElementById('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    _pomoPendingAction = null;

    if (countForfeit && pomoState === 'STUDY') {
        const elapsed = isPaused ? pausedElapsed : Math.max(0, Math.floor((Date.now() - timerStartTime) / 1000));
        _ledgerForfeit(elapsed);
    } else if (pomoState === 'STOPWATCH') {
        // Stopping a stopwatch is finishing it — real minutes were logged.
        focusLedger.deep += stopwatchAccumulated;
        if (stopwatchAccumulated >= 300) _ledgerCompleteBlock(stopwatchAccumulated);
        else _saveFocusLedger();
    }

    timerEndTriggered = true; // prevent handleTimerEnd from firing later
    lastTickAt = null;
    document.getElementById('timer-status').textContent = countForfeit ? "Session Forfeit." : "Tracking Stopped.";
    hydrateFocusStats();
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
        document.getElementById('timer-display').textContent = formatTime(secondsLeft);
        document.getElementById('mini-time').textContent = formatTime(secondsLeft);

        // Update study seconds and save periodically
        creditStudySeconds(studySubject, deltaSecs);

    } else {
        // Countdown: recalc remaining from true elapsed time
        secondsLeft = Math.max(0, timerTotalSeconds - elapsed);
        document.getElementById('timer-display').textContent = formatTime(secondsLeft);
        document.getElementById('mini-time').textContent = formatTime(secondsLeft);

        const percent = timerTotalSeconds ? ((timerTotalSeconds - secondsLeft) / timerTotalSeconds) * 100 : 0;
        if (visualMode === 'bar') {
            document.getElementById('pomo-progress').style.width = `${percent}%`;
        } else {
            document.getElementById('pomo-beaker-fill').style.height = `${percent}%`;
        }
        _updateMiniRing(percent / 100);

        // Gallery Break: the burn reveal tracks break progress 1:1 (pause
        // stops the ticks, freezing the burn mid-char).
        if (pomoState === 'BREAK') GalleryBreak.setProgress(percent / 100);

        // Study time tracking (counts real seconds passed since last tick)
        if (pomoState === 'STUDY') {
            creditStudySeconds(studySubject, Math.min(deltaSecs, secondsLeft));
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
    document.getElementById('pomo-mini-widget').classList.add('hidden');
    _setDeepWorkActive(false);   // block over — the ×1.5 window closes with it

    if (pomoState === 'STUDY') {
        // ── Ledger: a block that ran to its planned end is a completed block.
        _ledgerCompleteBlock(timerTotalSeconds);
        const receipt = _blockCompletionReceipt(timerTotalSeconds);
        _blockEloSnap = null;
        hydrateFocusStats();
        if (currentSession < totalSessions) {
            showTimerNotification(
                '🍅 Focus Session Done!',
                '🧘',
                'Take a break. You earned it.',
                startBreakAfterPopup,
                receipt
            );
        } else {
            showTimerNotification(
                '🏁 All Focus Blocks Complete',
                '🎉',
                'Pomodoro cycle finished. Great work!',
                finishAllAfterPopup,
                receipt
            );
        }
    } else if (pomoState === 'BREAK') {
        currentSession++;
        // Gallery Break replaces the "☕ Break Over" popup: full reveal → quote
        // → Continue → reverse burn → next study session. Falls back to the
        // classic popup if the overlay never came up (defensive).
        if (GalleryBreak.isActive()) {
            playBell();
            GalleryBreak.finish(startStudyAfterBreakPopup);
        } else {
            showTimerNotification(
                '☕ Break Over',
                '⚡',
                `Ready for session ${currentSession} of ${totalSessions}?`,
                startStudyAfterBreakPopup
            );
        }
    }
}

function startBreakAfterPopup() {
    document.getElementById('pomo-mini-widget').classList.remove('hidden');
    transitionToBreak();
}

function startStudyAfterBreakPopup() {
    document.getElementById('pomo-mini-widget').classList.remove('hidden');
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
    const targetBtn = document.getElementById('stopwatch-toggle-btn');
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
    const targetBtn = document.getElementById('dynamic-subject-btn');
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
        const select = document.getElementById('pomo-subject');
        if (select) select.disabled = !dynamicSubject;
    }
}

export function toggleStopwatchMode(btn) {
    isStopwatchMode = !isStopwatchMode;

    if (pomoState !== 'IDLE') quitTimer(true);   // mode switch: no chain-break drama
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
    const chosenSubject = document.getElementById('pomo-subject').value;
    studySubject = isValidSubjectKey(chosenSubject) ? chosenSubject : 'physics';
    document.querySelectorAll('#view-pomodoro .pomo-input, #view-pomodoro .pomo-select').forEach(el => el.disabled = true);
    if (dynamicSubject) document.getElementById('pomo-subject').disabled = false;
    updateMiniSubject();
    document.getElementById('btn-start').style.display = 'none';

    // Initialize audio context on user gesture
    initAudioContext();
    // Soft ignition chord — counterweight to playBell() at session end
    playStartChime();

    if (isStopwatchMode) {
        transitionToStopwatch();
    } else {
        totalSessions = parseInt(document.getElementById('pomo-sessions').value) || 1;
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
    document.getElementById('timer-status').textContent = `Stopwatch: ${studySubject.toUpperCase()}`;

    document.getElementById('pomo-mini-widget').classList.remove('hidden');
    document.getElementById('mini-status').textContent = 'STOPWATCH';
    document.getElementById('mini-status').className = 'mini-status study';
    updateMiniSubject();
    syncWidget('study');
    syncWidgetPaused(false);
    _setDeepWorkActive(true);   // stopwatch grind earns the ×1.5 too
    // Soundscape bridge: stopwatch grind gets the bed too (if enabled).
    try { if (window.FocusSound && window.FocusSound.autoStart) window.FocusSound.autoStart(); } catch (_) {}
    _updateMiniRing(1);
    _updateMiniTally();

    document.getElementById('btn-pause').style.display = 'inline-block';
    document.getElementById('btn-pause').textContent = "Pause";
    document.getElementById('btn-pause').onclick = pauseTimer;
    document.getElementById('btn-quit').style.display = 'inline-block';
    document.getElementById('btn-quit').textContent = "Stop";
    document.getElementById('break-actions').classList.remove('active');

    document.getElementById('pomo-progress').style.background = 'var(--gradient-glow)';
    document.getElementById('pomo-progress').style.width = '100%';

    isPaused = false;
    timerStartTime = Date.now(); // mark real start
    lastTickAt = Date.now();
    timerInterval = setInterval(executeTimerTick, 1000);
}

export function transitionToStudy() {
    pomoState = 'STUDY';
    const studyVal = parseInt(document.getElementById('pomo-study').value) || 50;
    timerTotalSeconds = studyVal * 60;
    secondsLeft = timerTotalSeconds;
    document.getElementById('timer-status').textContent = `Studying ${studySubject.toUpperCase()} (${currentSession}/${totalSessions})`;

    document.getElementById('pomo-mini-widget').classList.remove('hidden');
    document.getElementById('mini-status').textContent = `STUDY ${currentSession}/${totalSessions}`;
    document.getElementById('mini-status').className = 'mini-status study';
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

    document.getElementById('btn-pause').style.display = 'inline-block';
    document.getElementById('btn-pause').textContent = "Pause";
    document.getElementById('btn-pause').onclick = pauseTimer;
    document.getElementById('btn-quit').style.display = 'inline-block';
    document.getElementById('btn-quit').textContent = "Quit";
    document.getElementById('break-actions').classList.remove('active');

    document.getElementById('pomo-progress').style.background = 'var(--gradient-glow)';
    document.getElementById('pomo-progress').style.width = '0%';
    document.getElementById('pomo-beaker-fill').style.height = '0%';

    isPaused = false;
    timerStartTime = Date.now();
    timerEndTriggered = false; // a fresh study session must be able to end
    lastTickAt = Date.now();
    timerInterval = setInterval(executeTimerTick, 1000);
}

export function transitionToBreak() {
    pomoState = 'BREAK';
    const breakVal = parseInt(document.getElementById('pomo-break').value) || 10;
    timerTotalSeconds = breakVal * 60;
    secondsLeft = timerTotalSeconds;
    document.getElementById('timer-status').textContent = `Break Time ☕ (${currentSession}/${totalSessions})`;

    document.getElementById('pomo-mini-widget').classList.remove('hidden');
    document.getElementById('mini-status').textContent = 'BREAK';
    document.getElementById('mini-status').className = 'mini-status break';
    updateMiniSubject();
    syncWidget('break');
    syncWidgetPaused(false);
    _setDeepWorkActive(false);   // breaks don't pay the focus bonus
    _blockEloSnap = null;
    _updateMiniRing(0);
    _updateMiniEnd();

    document.getElementById('btn-pause').style.display = 'inline-block';
    document.getElementById('btn-pause').textContent = "Pause";
    document.getElementById('btn-pause').onclick = pauseTimer;
    document.getElementById('btn-quit').style.display = 'inline-block';
    document.getElementById('btn-quit').textContent = "Skip Break";
    document.getElementById('break-actions').classList.remove('active');

    document.getElementById('pomo-progress').style.background = 'var(--gradient-glow)';
    document.getElementById('pomo-progress').style.width = '0%';
    document.getElementById('pomo-beaker-fill').style.height = '0%';

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
    document.getElementById('timer-status').textContent = (pomoState === 'STOPWATCH') ? "Stopwatch Paused" : "Timer Paused";
    document.getElementById('btn-pause').textContent = "Resume";
    document.getElementById('btn-pause').onclick = resumeTimer;
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
        document.getElementById('timer-status').textContent = `Stopwatch: ${studySubject.toUpperCase()}`;
    } else if (pomoState === 'STUDY') {
        document.getElementById('timer-status').textContent = `Studying ${studySubject.toUpperCase()} (${currentSession}/${totalSessions})`;
    } else {
        document.getElementById('timer-status').textContent = `Break Time ☕ (${currentSession}/${totalSessions})`;
    }
    updateMiniSubject();
    if (pomoState === 'STUDY' || pomoState === 'STOPWATCH') _setDeepWorkActive(true);
    syncWidgetPaused(false);
    _updateMiniEnd();

    document.getElementById('btn-pause').textContent = "Pause";
    document.getElementById('btn-pause').onclick = pauseTimer;
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
    document.getElementById('timer-notify-modal').classList.remove('active');
    const secondary = document.getElementById('notify-secondary');
    if (secondary) secondary.style.display = 'none';
    _pomoPendingAction = null;
    if (_resetPomoTimer) { clearTimeout(_resetPomoTimer); _resetPomoTimer = null; }
    _setDeepWorkActive(false);
    _blockEloSnap = null;
    syncWidgetPaused(false);

    document.querySelectorAll('#view-pomodoro .pomo-input, #view-pomodoro .pomo-select').forEach(el => el.disabled = false);
    document.getElementById('btn-start').style.display = 'inline-block';
    document.getElementById('btn-pause').style.display = 'none';
    document.getElementById('btn-quit').style.display = 'none';
    document.getElementById('btn-quit').textContent = "Quit";
    document.getElementById('break-actions').classList.remove('active');

    document.getElementById('pomo-progress').style.width = '0%';
    document.getElementById('pomo-beaker-fill').style.height = '0%';

    timerStartTime = null;
    timerEndTriggered = false;
    pausedElapsed = 0;
    lastTickAt = null;
    lastSavedStudyMinute = 0;

    if (isStopwatchMode) {
        document.getElementById('timer-display').textContent = "00:00";
        document.getElementById('timer-status').textContent = "Ready to Track";
    } else {
        const studyVal = parseInt(document.getElementById('pomo-study').value) || 50;
        document.getElementById('timer-display').textContent = formatTime(studyVal * 60);
        document.getElementById('timer-status').textContent = "Ready to Focus";
    }

    // Back to the always-visible idle pill — the one-tap entry point.
    const widget = document.getElementById('pomo-mini-widget');
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
    document.getElementById('timer-display').textContent = formatTime(secondsLeft);
    document.getElementById('mini-time').textContent = formatTime(secondsLeft);
    _updateMiniEnd();
    // The next tick will handle the rest
}

export function finishAll() {
    clearInterval(timerInterval);
    saveAllAsync().catch(console.error);
    document.getElementById('pomo-mini-widget').classList.add('hidden');
    document.getElementById('timer-display').textContent = "00:00";
    document.getElementById('timer-status').textContent = "All sessions complete!";
    // Reset UI fully
    resetPomoUI();
}

// ── Boot hydration of the always-visible surfaces ─────────────────────────
// The idle pill and the Focus view ledger must be truthful from the first
// paint, not only after the first session ends. Guarded — module may load
// under DOM stubs in the smoke tests.
try { hydrateFocusStats(); } catch (_) {}
try { _syncPopControls(); } catch (_) {}