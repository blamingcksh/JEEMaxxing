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
};

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

// ---- Timer Notification Popup (unchanged UI logic) ----
function showTimerNotification(title, icon, message, nextAction) {
    _pomoPendingAction = nextAction;
    document.getElementById('notify-title').textContent = title;
    document.getElementById('notify-icon').textContent = icon;
    document.getElementById('notify-message').textContent = message;

    playBell(); // bell now safe to call

    document.getElementById('timer-notify-modal').classList.add('active');

    document.getElementById('btn-start').style.display = 'none';
    document.getElementById('btn-pause').style.display = 'none';
    document.getElementById('btn-quit').style.display = 'none';
    document.getElementById('break-actions').classList.remove('active');
    document.getElementById('pomo-mini-widget').classList.add('hidden');
}

export function confirmTimerNotification() {
    document.getElementById('timer-notify-modal').classList.remove('active');
    if (_pomoPendingAction) {
        const action = _pomoPendingAction;
        _pomoPendingAction = null;
        action();
    } else {
        resetPomoUI();
    }
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

    if (pomoState === 'STUDY') {
        if (currentSession < totalSessions) {
            showTimerNotification(
                '🍅 Focus Session Done!',
                '🧘',
                'Take a break. You earned it.',
                startBreakAfterPopup
            );
        } else {
            showTimerNotification(
                '🏁 All Focus Blocks Complete',
                '🎉',
                'Pomodoro cycle finished. Great work!',
                finishAllAfterPopup
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

    // While running, keep the subject picker usable (or re-lock it).
    if (pomoState !== 'IDLE') {
        const select = document.getElementById('pomo-subject');
        if (select) select.disabled = !dynamicSubject;
    }
}

export function toggleStopwatchMode(btn) {
    isStopwatchMode = !isStopwatchMode;

    if (pomoState !== 'IDLE') quitTimer();
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

    document.getElementById('btn-pause').textContent = "Pause";
    document.getElementById('btn-pause').onclick = pauseTimer;
    timerInterval = setInterval(executeTimerTick, 1000);
}

export function quitTimer() {
    clearInterval(timerInterval);
    // ── Night Guard: log session end for sleep-debt ledger ──
    try { NightGuard.logSessionEnd(); } catch (_) {}
    saveAllAsync().catch(console.error);
    GalleryBreak.abort();
    // ── CNS Load: pomodoro quit resets session-length tracking ──
    try { if (window.__cnsLoad) window.__cnsLoad.onPomodoroQuit(studySubject); } catch (_) {}
    document.getElementById('timer-notify-modal').classList.remove('active');
    _pomoPendingAction = null;
    timerEndTriggered = true; // prevent handleTimerEnd from firing later
    lastTickAt = null;
    document.getElementById('timer-status').textContent = isStopwatchMode ? "Tracking Stopped." : "Session Forfeit.";
    if (_resetPomoTimer) clearTimeout(_resetPomoTimer);
    _resetPomoTimer = setTimeout(() => resetPomoUI(), 1000);
}

export function resetPomoUI() {
    pomoState = 'IDLE';
    syncFilterLock();
    GalleryBreak.abort();
    document.getElementById('timer-notify-modal').classList.remove('active');
    _pomoPendingAction = null;
    if (_resetPomoTimer) { clearTimeout(_resetPomoTimer); _resetPomoTimer = null; }
    document.getElementById('pomo-mini-widget').classList.add('hidden');

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