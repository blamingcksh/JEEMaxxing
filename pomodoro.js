// ==================== POMODORO MODULE ====================
import { formatTime, formatStudyDuration, saveAllAsync, studySecs } from './storage.js';

// ---- Pomodoro-specific state (module-scoped) ----
let timerInterval, secondsLeft, totalSecondsForState, pomoState = 'IDLE',
    currentSession = 1,
    totalSessions = 1,
    studySubject = 'physics';
let isPaused = false;
let visualMode = 'bar';

let isStopwatchMode = false;
let timerStartTime = null;        // Date.now() at start/resume
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

export function playBell() {
    if (window.FX && !window.FX.wantSound()) return;
    initAudioContext(); // ensure context exists and is resumed
    if (!bellAudioCtx) return;

    const now = bellAudioCtx.currentTime;
    const osc = bellAudioCtx.createOscillator();
    const gain = bellAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(bellAudioCtx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    osc.start(now);
    osc.stop(now + 0.5);
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
        showTimerNotification(
            '☕ Break Over',
            '⚡',
            `Ready for session ${currentSession} of ${totalSessions}?`,
            startStudyAfterBreakPopup
        );
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
    studySubject = document.getElementById('pomo-subject').value;
    document.querySelectorAll('.pomo-input, .pomo-select').forEach(el => el.disabled = true);
    document.getElementById('btn-start').style.display = 'none';

    // Initialize audio context on user gesture
    initAudioContext();

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
    saveAllAsync().catch(console.error);
    document.getElementById('timer-notify-modal').classList.remove('active');
    _pomoPendingAction = null;
    timerEndTriggered = true; // prevent handleTimerEnd from firing later
    document.getElementById('timer-status').textContent = isStopwatchMode ? "Tracking Stopped." : "Session Forfeit.";
    setTimeout(() => resetPomoUI(), 1000);
}

export function resetPomoUI() {
    pomoState = 'IDLE';
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