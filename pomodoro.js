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
let timerStartTime = null;        // Date.now() at start/resume

// ── Night Guard bridge: exposes timerStartTime for clock-cheat cross-check ──
window.__pomodoro = { getTimerStartTime: () => timerStartTime };
let timerTotalSeconds = 0;        // total seconds for countdown
let stopwatchAccumulated = 0;    // seconds already counted before pause (stopwatch mode)
let timerEndTriggered = false;   // prevent multiple handleTimerEnd calls

let bellAudioCtx = null;
let _pomoPendingAction = null;   // replaces window._pomoPendingAction

// ---- Page Visibility Listener (fixes background freezing) ----
document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    if (pomoState === 'IDLE' || pomoState === 'STOPWATCH' || !timerStartTime || isPaused) return;

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
export function executeTimerTick() {
    if (!timerStartTime) return; // safety

    const now = Date.now();
    const elapsed = Math.floor((now - timerStartTime) / 1000);

    if (pomoState === 'STOPWATCH') {
        // Count up from previous accumulated time
        secondsLeft = stopwatchAccumulated + elapsed;
        document.getElementById('timer-display').textContent = formatTime(secondsLeft);
        document.getElementById('mini-time').textContent = formatTime(secondsLeft);

        // Update study seconds and save periodically
        studySecs[studySubject]++;
        updateStudyTimeHeader();
        if (studySecs[studySubject] % 60 === 0) saveAllAsync().catch(console.error);

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
            // We don't rely on tick frequency, so we just increment once per call.
            studySecs[studySubject]++;
            updateStudyTimeHeader();
            if (studySecs[studySubject] % 60 === 0) saveAllAsync().catch(console.error);
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
export function toggleStopwatchMode(btn) {
    isStopwatchMode = !isStopwatchMode;

    const targetBtn = btn || document.getElementById('stopwatch-toggle-btn');
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

    if (pomoState !== 'IDLE') quitTimer();
    resetPomoUI();
}

// ---- Start timer (real-time initialisation) ----
export function startTimer() {
    if (pomoState !== 'IDLE') return;
    // ── Night Guard: log session start for sleep-debt ledger ──
    try { NightGuard.logSessionStart(); } catch (_) {}
    studySubject = document.getElementById('pomo-subject').value;
    document.querySelectorAll('.pomo-input, .pomo-select').forEach(el => el.disabled = true);
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
    timerInterval = setInterval(executeTimerTick, 1000);

    // Gallery Break: start the burn reveal — whatever is open on screen
    // begins to char away from the center, revealing the painting.
    try { GalleryBreak.begin(); } catch (e) { console.warn('GalleryBreak failed to start', e); }
}

export function pauseTimer() {
    clearInterval(timerInterval);
    saveAllAsync().catch(console.error);
    isPaused = true;

    if (pomoState === 'STOPWATCH') {
        // Accumulate the time that has passed
        const elapsed = Math.floor((Date.now() - timerStartTime) / 1000);
        stopwatchAccumulated += elapsed;
        secondsLeft = stopwatchAccumulated; // show current total
    }
    // For countdown, we just stop the interval; secondsLeft already holds the remaining
    document.getElementById('timer-status').textContent = (pomoState === 'STOPWATCH') ? "Stopwatch Paused" : "Timer Paused";
    document.getElementById('btn-pause').textContent = "Resume";
    document.getElementById('btn-pause').onclick = resumeTimer;
}

export function resumeTimer() {
    isPaused = false;
    timerStartTime = Date.now(); // reset start point for real-time calculation
    timerEndTriggered = false;

    if (pomoState === 'STOPWATCH') {
        document.getElementById('timer-status').textContent = `Stopwatch: ${studySubject.toUpperCase()}`;
    } else if (pomoState === 'STUDY') {
        document.getElementById('timer-status').textContent = `Studying ${studySubject.toUpperCase()} (${currentSession}/${totalSessions})`;
    } else {
        document.getElementById('timer-status').textContent = `Break Time ☕ (${currentSession}/${totalSessions})`;
    }

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
    document.getElementById('timer-status').textContent = isStopwatchMode ? "Tracking Stopped." : "Session Forfeit.";
    setTimeout(() => resetPomoUI(), 1000);
}

export function resetPomoUI() {
    pomoState = 'IDLE';
    GalleryBreak.abort();
    document.getElementById('timer-notify-modal').classList.remove('active');
    _pomoPendingAction = null;
    document.getElementById('pomo-mini-widget').classList.add('hidden');

    document.querySelectorAll('.pomo-input, .pomo-select').forEach(el => el.disabled = false);
    document.getElementById('btn-start').style.display = 'inline-block';
    document.getElementById('btn-pause').style.display = 'none';
    document.getElementById('btn-quit').style.display = 'none';
    document.getElementById('btn-quit').textContent = "Quit";
    document.getElementById('break-actions').classList.remove('active');

    document.getElementById('pomo-progress').style.width = '0%';
    document.getElementById('pomo-beaker-fill').style.height = '0%';

    timerStartTime = null;
    timerEndTriggered = false;

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