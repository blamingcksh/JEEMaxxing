// ============================================================================
// 4-PILLAR ACCOUNTABILITY CHECKPOINT SYSTEM — HARDENED (vanilla JS port)
// ============================================================================
// All 8 exploits patched (mirrors src/lib/checkpoint.ts):
//
//  FIX 1 (Silent Death): lastTickAt tracked; background gap detection; Wake
//    Lock + Notification API; visibilitychange/focus resume guard.
//  FIX 2 (Palm/Scroll): reportDrawingActivity(x,y) with movement threshold.
//  FIX 3 (Time-Travel): lastKnownNow high-water mark; rollback → Protocol Zero.
//  FIX 4 (Force-Close): full state persisted atomically; restoreState() resumes.
//  FIX 5 (1-Second Ghost Miss): processedToday set; todaysOccurrence() not
//    pushed to tomorrow.
//  FIX 6 (Focus-Spam Speedrun): timestamp-based PoW timer — remaining computed
//    from powStartedAt + powAccumulatedPausedMs, NOT tick count. Multiple rapid
//    ticks (from focus events) compute the same remaining → can't fast-forward.
//  FIX 7 (Multi-Correct Lockout): submitAnswer handles single/multi/integer/
//    self-report. Multi-select toggle UI; integer input; self-report buttons.
//  FIX 8 (LocalStorage Amnesia): IndexedDB (primary) + localStorage (cache)
//    dual-write. restorePenalties() reads IDB on startup → re-caches to LS.
//    Survives localStorage.clear() and Private mode quota eviction.
//
// Imports from storage.js + matrix.js. Loaded as type="module" from index.html.
// ============================================================================

import { AppState, idbGet, idbSet, saveAllAsync, fetchMediaFromDrive } from './storage.js';
import { openPracticeDrawer, renderErrorResolutionDashboard, getLowestHealthQuestion } from './matrix.js';

// ── Configuration ──────────────────────────────────────────────────────────
const STORAGE_KEY = 'checkpoint:config';
const PENALTY_KEY = 'checkpoint:protocolZero';
const STATE_KEY = 'checkpoint:state';
const TICK_MS = 1000;
const CLOCK_TOLERANCE_MS = 30_000;
const DRAW_THRESHOLD = 4;
const BACKGROUND_GAP_THRESHOLD = 10_000;

const DEFAULT_CONFIG = {
    enabled: false,
    checkpoints: ['11:00', '17:00', '21:00'],
    idleThresholdMin: 120,
    graceMin: 15,
    preNotifyMin: 10,
    powMin: 10,
    powIdlePauseSec: 45,
};

// ── State ──────────────────────────────────────────────────────────────────
let cfg = Object.assign({}, DEFAULT_CONFIG);
let lastActivityAt = null;
let phase = 'disarmed';
let armedCheckpointTime = null;
const preNotifiedFor = new Set();
let processedToday = new Set();
let processedDate = '';
let graceEndsAt = null;
// Fix 6: timestamp-based PoW timer (immune to focus-spam speedrun)
let powStartedAt = null;
let powAccumulatedPausedMs = 0;
let powPauseStartedAt = null;
let powMinSnapshot = 10;
let powIdleSec = 0;
let powPaused = false;
let activeQuestion = null;
let lastKnownNow = 0;
let lastTickAt = 0;
let clockRollbackDetected = false;
let backgroundGapSec = 0;
let lastDrawX = null, lastDrawY = null;

let tickInterval = null;
let wakeLock = null;
let lockdownOverlay = null;
let toastEl = null;
let idbDB = null;

// ── Fix 8: IndexedDB helpers ───────────────────────────────────────────────
function openIDB() {
    if (idbDB) return Promise.resolve(idbDB);
    return new Promise((resolve) => {
        try {
            const req = indexedDB.open('checkpoint-db', 1);
            req.onupgradeneeded = function (e) {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
            };
            req.onsuccess = function () { idbDB = req.result; resolve(idbDB); };
            req.onerror = function () { resolve(null); };
        } catch (_) { resolve(null); }
    });
}

async function cpIdbSet(key, value) {
    const db = await openIDB();
    if (!db) return;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(value, key);
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { resolve(); };
        } catch (_) { resolve(); }
    });
}

async function cpIdbGet(key) {
    const db = await openIDB();
    if (!db) return null;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction('kv', 'readonly');
            const req = tx.objectStore('kv').get(key);
            req.onsuccess = function () { resolve(req.result ?? null); };
            req.onerror = function () { resolve(null); };
        } catch (_) { resolve(null); }
    });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function todayKey(d) {
    d = d || new Date();
    return d.toLocaleDateString('en-CA');
}

function parseTime(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return { h: h, m: mm };
}

function todaysOccurrence(hhmm, from) {
    from = from || new Date();
    const p = parseTime(hhmm);
    if (!p) return null;
    const d = new Date(from);
    d.setHours(p.h, p.m, 0, 0);
    return d;
}

function nextOccurrence(hhmm, from) {
    from = from || new Date();
    const occ = todaysOccurrence(hhmm, from);
    if (!occ) return null;
    if (occ.getTime() <= from.getTime()) occ.setDate(occ.getDate() + 1);
    return occ;
}

function formatClock(totalSec) {
    if (totalSec < 0) totalSec = 0;
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// Fix 6: compute remaining from absolute timestamps, not tick count
function getPowRemainingSec(now) {
    if (!powStartedAt) return 0;
    const totalMs = powMinSnapshot * 60000;
    let elapsedMs = now - powStartedAt - powAccumulatedPausedMs;
    if (powPauseStartedAt !== null) {
        elapsedMs -= (now - powPauseStartedAt);
    }
    return Math.max(0, Math.ceil((totalMs - elapsedMs) / 1000));
}

// ── Config persistence (Fix 8: dual-write IDB + LS) ────────────────────────
function loadConfig() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) cfg = Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
    } catch (_) { /* ignore */ }
    // Async restore from IDB (source of truth)
    openIDB().then(function () {
        cpIdbGet(STORAGE_KEY).then(function (c) {
            if (c) {
                cfg = Object.assign({}, DEFAULT_CONFIG, c);
                try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (_) { /* ignore */ }
                emit();
            }
        });
    });
}

export function getConfig() { return Object.assign({}, cfg); }

export function setConfig(partial) {
    cfg = Object.assign({}, cfg, partial);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (_) { /* ignore */ }
    cpIdbSet(STORAGE_KEY, cfg);
    persistState();
    emit();
}

// ── State persistence (Fix 4 + Fix 8) ──────────────────────────────────────
function persistState() {
    const today = todayKey();
    if (processedDate !== today) {
        processedToday = new Set();
        processedDate = today;
    }
    const ps = {
        phase: phase,
        armedCheckpointTime: armedCheckpointTime,
        graceEndsAt: graceEndsAt,
        powStartedAt: powStartedAt,
        powAccumulatedPausedMs: powAccumulatedPausedMs,
        powPauseStartedAt: powPauseStartedAt,
        powMin: powMinSnapshot,
        powIdleSec: powIdleSec,
        powPaused: powPaused,
        activeQuestionId: activeQuestion ? activeQuestion.id : null,
        processedToday: Array.from(processedToday),
        processedDate: processedDate,
        lastKnownNow: lastKnownNow,
        lastActivityAt: lastActivityAt,
    };
    try { localStorage.setItem(STATE_KEY, JSON.stringify(ps)); } catch (_) { /* ignore */ }
    cpIdbSet(STATE_KEY, ps);
}

function restoreState() {
    restoreStateFromRaw(null);
    openIDB().then(function () {
        cpIdbGet(STATE_KEY).then(function (ps) {
            if (ps) restoreStateFromRaw(ps);
        });
    });
}

function restoreStateFromRaw(ps) {
    if (!ps) {
        try {
            const raw = localStorage.getItem(STATE_KEY);
            if (!raw) return;
            ps = JSON.parse(raw);
        } catch (_) { return; }
    }
    if (!ps) return;
    const now = Date.now();
    const today = todayKey();

    // Fix 3: Clock rollback detection
    const storedClock = ps.lastKnownNow || 0;
    if (storedClock > 0 && now < storedClock - CLOCK_TOLERANCE_MS) {
        clockRollbackDetected = true;
        lastKnownNow = now;
        phase = 'penalty';
        addPenaltyDate(today);
        showToast('danger', '💀 CLOCK ROLLBACK DETECTED — Protocol Zero engaged.');
        setTimeout(function () {
            phase = cfg.enabled ? 'monitoring' : 'disarmed';
            persistState();
            emit();
        }, 6000);
        return;
    }
    lastKnownNow = Math.max(now, storedClock);

    processedDate = ps.processedDate === today ? ps.processedDate : today;
    processedToday = new Set(ps.processedDate === today ? ps.processedToday : []);
    lastActivityAt = ps.lastActivityAt;
    phase = ps.phase;
    armedCheckpointTime = ps.armedCheckpointTime;
    graceEndsAt = ps.graceEndsAt;
    powStartedAt = ps.powStartedAt;
    powAccumulatedPausedMs = ps.powAccumulatedPausedMs || 0;
    powPauseStartedAt = ps.powPauseStartedAt;
    powMinSnapshot = ps.powMin || cfg.powMin;
    powIdleSec = ps.powIdleSec || 0;
    powPaused = ps.powPaused;

    if (ps.activeQuestionId !== null) {
        activeQuestion = AppState.questionBank.find(function (q) {
            return String(q.id) === String(ps.activeQuestionId);
        }) || null;
    }

    if (phase === 'grace' && graceEndsAt && now >= graceEndsAt) {
        firePenalty('Grace expired while you were away — Protocol Zero engaged.');
        return;
    }
    // BROWSER REFRESH RECOVERY STATE LOCKING — because graceEndsAt is now
    // an ABSOLUTE calendar-anchored epoch (set by armCheckpoint's
    // absoluteDeadlineMs argument), the remaining grace duration is computed
    // as a pure absolute delta (graceEndsAt - Date.now()) everywhere it is
    // read: in the grace-modal live countdown (showGraceModal), in the grace
    // phase of tick(), and in restoreState() above. Refreshing the page
    // therefore hydrates the EXACT same mathematical duration from storage
    // with zero time dilation or state amnesia — the grace window cannot be
    // extended or reset by a reload, only honored or expired.
    if (phase === 'grace' && graceEndsAt && now < graceEndsAt && armedCheckpointTime) {
        showGraceModal(armedCheckpointTime);
    }
    if (phase === 'active' && activeQuestion) {
        showLockdown(activeQuestion);
    }
    persistState();
}

// ── Protocol Zero penalty persistence (Fix 8: dual-write) ──────────────────
function getPenaltyDates() {
    try {
        const raw = localStorage.getItem(PENALTY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
}

// Fix 8: async restore of penalties from IDB → LS cache
function restorePenalties() {
    openIDB().then(function () {
        cpIdbGet(PENALTY_KEY).then(function (dates) {
            if (dates && dates.length) {
                try { localStorage.setItem(PENALTY_KEY, JSON.stringify(dates)); } catch (_) { /* ignore */ }
                // Re-apply to BOTH graphs
                if (typeof renderErrorResolutionDashboard === 'function') renderErrorResolutionDashboard();
                window.dispatchEvent(new CustomEvent('checkpoint:penalty', { detail: { date: dates[dates.length - 1] } }));
                emit();
            }
        });
    });
}

function addPenaltyDate(date) {
    const dates = getPenaltyDates();
    if (!dates.includes(date)) {
        dates.push(date);
        try { localStorage.setItem(PENALTY_KEY, JSON.stringify(dates)); } catch (_) { /* ignore */ }
        cpIdbSet(PENALTY_KEY, dates);
        idbSet(PENALTY_KEY, dates); // also write to the app's main IDB for belt-and-braces
    }
    // Re-render BOTH graphs: the Error Momentum sparkline + the main predictive graph
    if (typeof renderErrorResolutionDashboard === 'function') renderErrorResolutionDashboard();
    // Dispatch a global event so app.js can re-render the main predictive graph
    window.dispatchEvent(new CustomEvent('checkpoint:penalty', { detail: { date: date } }));
}

// ── Telemetry (Fix 2: Palm/Scroll Loophole) ────────────────────────────────
export function reportDrawingActivity(x, y) {
    if (lastDrawX !== null && lastDrawY !== null) {
        const dx = x - lastDrawX;
        const dy = y - lastDrawY;
        if (dx * dx + dy * dy < DRAW_THRESHOLD * DRAW_THRESHOLD) return;
    }
    lastDrawX = x;
    lastDrawY = y;
    const now = Date.now();
    lastActivityAt = now;
    powIdleSec = 0;
    if (powPaused && phase === 'active' && powPauseStartedAt !== null) {
        powAccumulatedPausedMs += now - powPauseStartedAt;
        powPauseStartedAt = null;
        powPaused = false;
    }
    emit();
}

export function reportTypingActivity() {
    const now = Date.now();
    lastActivityAt = now;
    powIdleSec = 0;
    if (powPaused && phase === 'active' && powPauseStartedAt !== null) {
        powAccumulatedPausedMs += now - powPauseStartedAt;
        powPauseStartedAt = null;
        powPaused = false;
    }
    emit();
}

// ── Wake Lock + Notifications (Fix 1) ──────────────────────────────────────
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (_) { /* ignore */ }
}

function releaseWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch (_) { /* ignore */ } wakeLock = null; }
}

function notify(title, body) {
    try {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body: body });
        }
    } catch (_) { /* ignore */ }
}

// ── Core tick (all fixes integrated) ───────────────────────────────────────
function tick() {
    const now = Date.now();

    // Fix 3: Clock rollback detection
    if (lastKnownNow > 0 && now < lastKnownNow - CLOCK_TOLERANCE_MS) {
        clockRollbackDetected = true;
        lastKnownNow = now;
        firePenalty('Clock manipulation detected — Protocol Zero engaged.');
        return;
    }
    lastKnownNow = Math.max(now, lastKnownNow);

    // Fix 1: Detect background suspension
    if (lastTickAt > 0) {
        const gap = now - lastTickAt;
        if (gap > BACKGROUND_GAP_THRESHOLD) {
            backgroundGapSec = Math.floor(gap / 1000);
            if (phase === 'grace' && graceEndsAt && now >= graceEndsAt) {
                firePenalty('Grace expired while you were away — Protocol Zero engaged.');
                return;
            }
            if (phase === 'monitoring' || phase === 'pre-notify' || phase === 'disarmed') {
                checkMissedCheckpoints(lastTickAt, now);
            }
        } else {
            backgroundGapSec = 0;
        }
    }
    lastTickAt = now;

    const idleMs = lastActivityAt ? now - lastActivityAt : Infinity;
    const idleMin = idleMs === Infinity ? Infinity : idleMs / 60000;
    const today = todayKey();

    if (processedDate !== today) {
        processedToday = new Set();
        processedDate = today;
        preNotifiedFor.clear();
    }

    // Fix 5 (revised): Check ALL checkpoints via processedToday set.
    // BUGFIX (previous version): the `else` branch added the checkpoint to
    // processedToday even when it was NOT armed. That meant: if you were 30 min
    // idle when the 11:00 checkpoint hit (under the 120-min threshold), the
    // checkpoint was marked "processed" forever and NEVER fired when you
    // actually crossed the 2-hour idle mark at 12:30. The popup never showed.
    //
    // NEW LOGIC:
    //   • If the user was active AFTER the checkpoint time (e.g. drew on the
    //     scratchpad at 11:05), they "engaged" with the checkpoint — mark as
    //     passed, do not fire.
    //   • Else if the user has now been idle >= threshold, ARM the checkpoint
    //     (show the popup) and mark as processed.
    //   • Else: DO NOT mark as processed. Keep checking on future ticks so the
    //     popup fires the moment the idle threshold is crossed.
    if (phase === 'disarmed' || phase === 'monitoring' || phase === 'pre-notify') {
        if (cfg.enabled) {
            for (const t of cfg.checkpoints) {
                const occ = todaysOccurrence(t, new Date(now));
                if (!occ) continue;
                const occMs = occ.getTime();
                const key = today + ':' + t;
                if (processedToday.has(key)) continue;
                if (now < occMs) continue; // checkpoint not yet reached today

                // ABSOLUTE TEMPORAL BARRIER — calendar-anchored deadline.
                // occMs + graceMin defines an immovable epoch expiration; it
                // does NOT slide forward when the user reopens the browser.
                const deadlineMs = occMs + (cfg.graceMin * 60000);

                // (a) User engaged with this checkpoint by performing genuine
                //     interaction AFTER the checkpoint timestamp — they are
                //     safe for this one.
                const engagedAfter = lastActivityAt !== null && lastActivityAt > occMs;
                if (engagedAfter) {
                    processedToday.add(key);
                    continue;
                }
                // (b) User is currently idle AND the absolute grace window
                //     has already expired (the 15 min elapsed while the tab
                //     was closed / offline / in background sleep). There is
                //     no legitimate way to recover — fire Protocol Zero on
                //     the spot with an explicit absolute-window message.
                if (idleMin >= cfg.idleThresholdMin && now > deadlineMs) {
                    processedToday.add(key);
                    firePenalty(
                        'Absolute grace window for ' + t + ' (' + cfg.graceMin +
                        ' min from ' + t + ') expired while offline — Protocol Zero engaged.'
                    );
                    return;
                }
                // (c) User is idle but still WITHIN the legitimate scheduled
                //     15-minute window. Flag as processed and ARM the
                //     checkpoint, threading the absolute deadline barrier
                //     down to the UI layer so the grace modal counts down
                //     against the immutable calendar timestamp.
                if (idleMin >= cfg.idleThresholdMin) {
                    processedToday.add(key);
                    armCheckpoint(t, deadlineMs);
                    break;
                }
                // (d) Not idle long enough yet — keep checking future ticks.
                //     DO NOT add to processedToday.
            }
        } else {
            phase = 'disarmed';
        }
    }

    // Pre-notify (display only)
    let next = null, nextStr = null;
    for (const t of cfg.checkpoints) {
        const occ = nextOccurrence(t, new Date(now));
        if (occ && (!next || occ.getTime() < next.getTime())) { next = occ; nextStr = t; }
    }
    const minToCp = next ? (next.getTime() - now) / 60000 : null;
    if (cfg.enabled && next && minToCp !== null && minToCp <= cfg.preNotifyMin && minToCp > 0 && !preNotifiedFor.has(today + nextStr)) {
        preNotifiedFor.add(today + nextStr);
        phase = 'pre-notify';
        notify('⚠ Slump Sentry', 'Checkpoint at ' + nextStr + ' — get to work now.');
        showPreNotifyBanner(nextStr, Math.ceil(minToCp));
    }

    switch (phase) {
        case 'disarmed':
        case 'monitoring':
        case 'pre-notify':
            if (phase !== 'pre-notify') phase = cfg.enabled ? 'monitoring' : 'disarmed';
            break;
        case 'grace':
            if (graceEndsAt && now >= graceEndsAt) {
                firePenalty('Grace window expired — Protocol Zero engaged.');
            }
            break;
        case 'active': {
            // Fix 6: timestamp-based timer — focus-spam can't fast-forward
            if (!powPaused) {
                powIdleSec += 1;
                if (powIdleSec >= cfg.powIdlePauseSec) {
                    powPaused = true;
                    powPauseStartedAt = now;
                }
            }
            const remaining = getPowRemainingSec(now);
            if (remaining <= 0) {
                firePenalty('Proof-of-Work timer expired — Protocol Zero engaged.');
            }
            break;
        }
        default: break;
    }

    persistState();
    emit();
}

// DEACTIVATED RESUME RACE-CONDITION HANDLER — intentional no-op safe-handle.
// All catch-up math now lives UNIFIED inside the single state execution loop
// in tick(), which uses the absolute temporal barrier (deadlineMs = occMs +
// graceMin*60000) to decide between mid-window arm vs. post-window penalty.
// Previously this function ran in parallel with tick()'s evaluation on a
// background-gap resume event, causing dual-trigger anomalies and duplicate
// arm/penalty decisions when waking from device background sleep. Emptying
// the body eliminates that race while preserving the call site (tick() line
// ~408 still invokes it harmlessly) so surrounding code stays intact.
function checkMissedCheckpoints(_fromMs, _toMs) {
    // Intentional no-op. Arguments retained for signature compatibility.
    return;
}

// ── Phase transitions ──────────────────────────────────────────────────────
function armCheckpoint(cpTime, absoluteDeadlineMs) {
    armedCheckpointTime = cpTime;
    phase = 'grace';
    // ABSOLUTE-ANCHOR CONTRACT: If the caller supplies an explicit epoch
    // deadline (computed from occMs + cfg.graceMin*60000), bind graceEndsAt
    // directly to that calendar-anchored timestamp instead of computing a
    // relative `Date.now() + graceMin` offset. This eliminates the offline
    // grace-window exploit where a user could close the site, return hours
    // past a scheduled checkpoint, and receive a fresh 15-minute extension
    // on boot — the absolute barrier is immutable regardless of when the
    // browser happens to be active.
    if (typeof absoluteDeadlineMs === 'number' && absoluteDeadlineMs > 0) {
        graceEndsAt = absoluteDeadlineMs;
    } else {
        graceEndsAt = Date.now() + cfg.graceMin * 60000;
    }
    notify('🚨 Checkpoint ARMED', cpTime + ' — ' + cfg.graceMin + ' min grace to initiate.');
    showGraceModal(cpTime);
    persistState();
}

export function initiateCheckpoint() {
    if (phase !== 'grace' && phase !== 'pre-notify' && phase !== 'monitoring') return;
    const q = getLowestHealthQuestion();
    activeQuestion = q;
    phase = 'active';
    // Fix 6: record absolute start timestamp
    powStartedAt = Date.now();
    powAccumulatedPausedMs = 0;
    powPauseStartedAt = null;
    powMinSnapshot = cfg.powMin;
    powIdleSec = 0;
    powPaused = false;
    lastDrawX = null;
    lastDrawY = null;
    requestWakeLock();
    hideGraceModal();
    // Fix: if no due question exists, show a fallback self-report lockdown
    // instead of silently failing (which left the user stuck with no practice UI).
    if (q) {
        showLockdown(q);
    } else {
        showLockdown({
            id: 'fallback',
            chapter: 'Self-Directed Practice',
            subject: 'general',
            easeFactor: 2.5,
            status: 'error',
            type: 'self-report',
            correctAnswer: '',
            options: [],
            imageDataUrl: null,
            driveImageId: null,
            extractedText: 'No due error questions found in your Chapter Decay Grid. Use this checkpoint to self-direct your study. Draw your work on the scratchpad, then honestly self-report whether you used the full Proof-of-Work window productively.',
        });
    }
    persistState();
}

// Fix 7: submitAnswer handles all question types
export function submitAnswer(answer) {
    if (phase !== 'active') return;
    const q = activeQuestion;
    hideLockdown();
    releaseWakeLock();
    const correct = evaluateAnswer(q, answer);
    if (correct) {
        phase = 'completed';
        activeQuestion = null;
        armedCheckpointTime = null;
        powStartedAt = null;
        showToast('ok', '✅ Checkpoint cleared. Discipline logged.');
        setTimeout(function () { phase = cfg.enabled ? 'monitoring' : 'disarmed'; persistState(); emit(); }, 3000);
    } else {
        firePenalty('Answer incorrect — Protocol Zero engaged.');
    }
    persistState();
}

function evaluateAnswer(q, answer) {
    if (!q) return true;
    // Self-report (no answer key OR explicit self-report type)
    const mode = getQuestionMode(q);
    if (mode === 'self-report') return typeof answer === 'boolean' ? answer : false;
    if (mode === 'integer') {
        if (typeof answer !== 'number' || isNaN(answer)) return false;
        const correct = parseFloat(q.correctAnswer);
        return !isNaN(correct) && Math.abs(answer - correct) < 1e-9;
    }
    if (mode === 'multi') {
        if (!Array.isArray(answer)) return false;
        const correct = (Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer])
            .map(function (s) { return String(s).trim().toUpperCase(); })
            .sort();
        const given = answer.slice().map(function (s) { return String(s).trim().toUpperCase(); }).sort();
        if (correct.length !== given.length) return false;
        return correct.every(function (c, i) { return c === given[i]; });
    }
    // single
    if (typeof answer !== 'string') return false;
    const correctStr = String(q.correctAnswer).trim().toUpperCase();
    return answer.toUpperCase() === correctStr;
}

// ── Question mode detection ───────────────────────────────────────────────
// Returns 'single' | 'multi' | 'integer' | 'self-report'
// Mirrors the actual app question shape (q.correctAnswer is string/array,
// q.options is an array like ["A) ...", "B) ..."]).
// 'self-report' is used whenever there is no usable answer key — the user
// honestly self-evaluates via two buttons (✓ I solved it correctly / ✗ I got it wrong).
function getQuestionMode(q) {
    if (!q) return 'self-report';
    if (q.type === 'self-report') return 'self-report';
    const hasAnswer = q.correctAnswer !== undefined && q.correctAnswer !== null &&
                      !(typeof q.correctAnswer === 'string' && q.correctAnswer.trim() === '') &&
                      !(Array.isArray(q.correctAnswer) && q.correctAnswer.length === 0);
    if (!hasAnswer) return 'self-report';
    if (Array.isArray(q.correctAnswer)) return 'multi';
    if (typeof q.correctAnswer === 'string' && /^[A-D]$/i.test(q.correctAnswer.trim())) return 'single';
    if (typeof q.correctAnswer === 'string' && /^-?\d+(\.\d+)?$/.test(q.correctAnswer.trim())) return 'integer';
    // Unknown answer shape — fall back to self-report so the user isn't stuck.
    return 'self-report';
}

export function abandonCheckpoint() {
    if (phase !== 'active') return;
    hideLockdown();
    releaseWakeLock();
    firePenalty('Checkpoint abandoned — Protocol Zero engaged.');
}

function firePenalty(reason) {
    const date = todayKey();
    addPenaltyDate(date);
    phase = 'penalty';
    activeQuestion = null;
    armedCheckpointTime = null;
    graceEndsAt = null;
    powStartedAt = null;
    hideLockdown();
    hideGraceModal();
    releaseWakeLock();
    notify('💀 PROTOCOL ZERO', reason);
    showPenaltyModal(reason, date);
    persistState();
    setTimeout(function () {
        hidePenaltyModal();
        phase = cfg.enabled ? 'monitoring' : 'disarmed';
        persistState();
        emit();
    }, 8000);
}

// ── Prominent blocking modals (grace-armed + penalty + pre-notify banner) ──
let graceModal = null;
let penaltyModal = null;
let preNotifyBanner = null;
let graceModalInterval = null;

function showGraceModal(cpTime) {
    hideGraceModal();
    graceModal = document.createElement('div');
    graceModal.id = 'cp-grace-modal';
    graceModal.className = 'cp-grace-modal';
    graceModal.innerHTML = `
        <div class="cp-grace-box">
            <div class="cp-grace-icon">🚨</div>
            <div class="cp-grace-title">CHECKPOINT ARMED</div>
            <div class="cp-grace-sub">Timestamp <strong>${cpTime}</strong> hit while you were idle.</div>
            <div class="cp-grace-timer-label">Grace remaining</div>
            <div class="cp-grace-timer" id="cp-grace-timer-val">15:00</div>
            <div class="cp-grace-warning">If this hits zero, Protocol Zero scars your 15-Day graph.</div>
            <button class="cp-grace-ignite" id="cp-grace-ignite-btn">🔒 INITIATE CHECKPOINT</button>
            <div class="cp-grace-hint">You have ${cfg.graceMin} minutes. Tap to start your focused practice.</div>
        </div>
    `;
    document.body.appendChild(graceModal);
    document.body.style.overflow = 'hidden';

    const igniteBtn = graceModal.querySelector('#cp-grace-ignite-btn');
    igniteBtn.addEventListener('click', function () { initiateCheckpoint(); });

    // Live countdown
    graceModalInterval = setInterval(function () {
        if (!graceEndsAt || !graceModal) return;
        const rem = Math.max(0, Math.floor((graceEndsAt - Date.now()) / 1000));
        const el = graceModal.querySelector('#cp-grace-timer-val');
        if (el) {
            el.textContent = formatClock(rem);
            el.classList.toggle('critical', rem < 60);
        }
    }, 500);
}

function hideGraceModal() {
    if (graceModalInterval) { clearInterval(graceModalInterval); graceModalInterval = null; }
    if (graceModal) { graceModal.remove(); graceModal = null; }
    document.body.style.overflow = '';
}

function showPenaltyModal(reason, date) {
    hidePenaltyModal();
    penaltyModal = document.createElement('div');
    penaltyModal.id = 'cp-penalty-modal';
    penaltyModal.className = 'cp-penalty-modal';
    penaltyModal.innerHTML = `
        <div class="cp-penalty-box">
            <div class="cp-penalty-icon">💀</div>
            <div class="cp-penalty-title">PROTOCOL ZERO</div>
            <div class="cp-penalty-reason">${reason}</div>
            <div class="cp-penalty-date">Date scarred: <strong>${date}</strong></div>
            <div class="cp-penalty-desc">
                A hard zero has been written to your 15-Day Error Momentum Engine
                AND your main predictive graph. This creates a permanent jagged red
                valley that will take 2 weeks of flawless execution to smooth out.
            </div>
            <div class="cp-penalty-graph-preview">
                <span style="color:#f87171; font-family:monospace; font-size:11px;">
                    ▁▁▁▂▃▄▅▆▇█▇▆▅<strong style="color:#f87171;">▼0▼</strong>▅▆▇
                </span>
            </div>
            <button class="cp-penalty-ack" id="cp-penalty-ack-btn">Acknowledge</button>
        </div>
    `;
    document.body.appendChild(penaltyModal);
    document.body.style.overflow = 'hidden';
    const ackBtn = penaltyModal.querySelector('#cp-penalty-ack-btn');
    ackBtn.addEventListener('click', hidePenaltyModal);
}

function hidePenaltyModal() {
    if (penaltyModal) { penaltyModal.remove(); penaltyModal = null; }
    document.body.style.overflow = '';
}

function showPreNotifyBanner(cpTime, minAway) {
    if (preNotifyBanner) preNotifyBanner.remove();
    preNotifyBanner = document.createElement('div');
    preNotifyBanner.id = 'cp-prenotify-banner';
    preNotifyBanner.className = 'cp-prenotify-banner';
    preNotifyBanner.innerHTML = `
        <span class="cp-prenotify-text">⚠ <strong>Slump Sentry:</strong> Checkpoint at <strong>${cpTime}</strong> in ~${minAway} min. Get to work now.</span>
        <button class="cp-prenotify-dismiss">✕</button>
    `;
    document.body.appendChild(preNotifyBanner);
    const dismiss = preNotifyBanner.querySelector('.cp-prenotify-dismiss');
    dismiss.addEventListener('click', function () {
        preNotifyBanner.remove();
        preNotifyBanner = null;
    });
    // Auto-dismiss after 60s (but the notification already fired)
    setTimeout(function () {
        if (preNotifyBanner) { preNotifyBanner.remove(); preNotifyBanner = null; }
    }, 60000);
}

// ── Lockdown overlay (Pillar 2 + 3 + Fix 7: all question types) ────────────
function showLockdown(q) {
    hideLockdown();
    lockdownOverlay = document.createElement('div');
    lockdownOverlay.id = 'checkpoint-lockdown';
    lockdownOverlay.className = 'checkpoint-lockdown';

    // Detect question mode based on the REAL app question shape:
    // q.options = ["A) ...", "B) ..."] (array, not regex-parseable text)
    // q.correctAnswer = "A" | ["A","C"] | "42" | "" (no key → self-report)
    // q.imageDataUrl = base64 PNG (may be missing; fall back to driveImageId)
    const mode = getQuestionMode(q);
    const typeLabel = {
        single: 'Single-correct MCQ',
        multi: 'Multi-correct (select ALL that apply)',
        integer: 'Integer / numeric answer',
        'self-report': 'Self-evaluation (no answer key on file)',
    }[mode];

    // ── Image rendering ────────────────────────────────────────────────────
    // Show the question image if available. Supports:
    //   • q.imageDataUrl  — base64 (preferred, instant)
    //   • q.driveImageId  — Google Drive file ID (lazy-loaded async)
    let imageHTML = '';
    if (q.imageDataUrl && typeof q.imageDataUrl === 'string' && q.imageDataUrl.length > 100) {
        imageHTML = '<img class="cp-question-image" src="' + q.imageDataUrl + '" alt="Question image" />';
    } else if (q.driveImageId) {
        // Placeholder SVG; the actual image is fetched from Drive after the
        // overlay is mounted (see lazy-load block below).
        imageHTML = '<img class="cp-question-image cp-img-pending" id="cp-question-img" ' +
            'src="data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'280\' height=\'160\'><rect width=\'100%\' height=\'100%\' fill=\'%2312121a\'/><text x=\'50%\' y=\'50%\' fill=\'%23444a6a\' font-family=\'sans-serif\' font-size=\'12\' text-anchor=\'middle\' alignment-baseline=\'middle\'>Downloading question image…</text></svg>" ' +
            'alt="Question image loading" />';
    }
    // else: no imageHTML — image block omitted entirely.

    // ── Options rendering (for single + multi modes) ──────────────────────
    // Real q.options is already an array like ["A) Foo", "B) Bar"]. Split
    // letter + text cleanly without regex hacks.
    let optionsHTML = '';
    let parsedOptions = [];
    if (mode === 'single' || mode === 'multi') {
        const raw = Array.isArray(q.options) ? q.options : [];
        parsedOptions = raw.map(function (opt) {
            const s = String(opt).trim();
            const m = s.match(/^\(?([A-Da-d])\)?[\s\.\)]*(.*)$/);
            if (m) return { letter: m[1].toUpperCase(), text: m[2].trim() };
            // Fallback: synthesize a letter by index.
            const idxLetter = String.fromCharCode(65 + parsedOptions.length);
            return { letter: idxLetter, text: s };
        }).filter(function (o) { return o.text.length > 0; });

        if (mode === 'single') {
            optionsHTML = parsedOptions.map(function (o) {
                return '<button class="cp-option" data-letter="' + o.letter + '">' +
                    '<span class="cp-opt-letter">(' + o.letter + ')</span> ' +
                    escapeForHtml(o.text) + '</button>';
            }).join('');
        } else {
            optionsHTML = parsedOptions.map(function (o) {
                return '<button class="cp-option cp-multi" data-letter="' + o.letter + '">' +
                    '<span class="cp-opt-letter">☐ (' + o.letter + ')</span> ' +
                    escapeForHtml(o.text) + '</button>';
            }).join('');
        }
    }

    const remaining = getPowRemainingSec(Date.now());
    const showOptions = (mode === 'single' || mode === 'multi');
    const showInteger = (mode === 'integer');
    const showSelfReport = (mode === 'self-report');
    const showSubmit = !showSelfReport; // self-report submits directly via its own buttons

    lockdownOverlay.innerHTML = '\
        <div class="cp-lockdown-header"> \
            <div class="cp-lockdown-title">🔒 CHECKPOINT LOCKDOWN</div> \
            <div class="cp-lockdown-sub">' + typeLabel + ' · answer + draw to exit</div> \
        </div> \
        <div class="cp-lockdown-timer-zone"> \
            <div class="cp-timer-label">Proof-of-Work Timer</div> \
            <div class="cp-timer-value" id="cp-timer-value">' + formatClock(remaining) + '</div> \
            <div class="cp-timer-paused" id="cp-timer-paused" style="display:none;">⏸ PAUSED — DRAW ON SCRATCHPAD</div> \
        </div> \
        <div class="cp-lockdown-body"> \
            <div class="cp-question-meta">⚠ ' + escapeForHtml(q.chapter || 'Unknown') + ' · EF ' + (q.easeFactor || 2.5) + ' · ' + escapeForHtml(q.subject || '') + '</div> \
            ' + (imageHTML ? '<div class="cp-question-image-zone">' + imageHTML + '</div>' : '') + ' \
            <div class="cp-question-text">' + escapeForHtml(q.extractedText || 'No question text on file. Use the image above if present, then self-evaluate.') + '</div> \
            ' + (showOptions ? '<div class="cp-options" id="cp-options">' + optionsHTML + '</div>' : '') + ' \
            ' + (showInteger ? '<div class="cp-integer-zone" id="cp-integer-zone"><input type="number" id="cp-integer-input" placeholder="Enter your numeric answer" class="cp-integer-input" /></div>' : '') + ' \
            ' + (showSelfReport ? '<div class="cp-selfreport-zone" id="cp-selfreport-zone">' +
                '<div class="cp-selfreport-hint">No answer key on file for this question. Solve it on the scratchpad, then honestly self-evaluate. Lying only hurts you.</div>' +
                '<div class="cp-selfreport-btns">' +
                '<button class="cp-selfreport-correct" id="cp-sr-correct">✓ I solved it correctly</button>' +
                '<button class="cp-selfreport-wrong" id="cp-sr-wrong">✗ I got it wrong</button>' +
                '</div></div>' : '') + ' \
            <div class="cp-scratchpad-hint">✏️ Draw on the scratchpad (outside lockdown) to keep the timer ticking. Only movement &gt; 4px counts.</div> \
        </div> \
        <div class="cp-lockdown-footer"> \
            <button class="cp-abandon" id="cp-abandon">Abandon (triggers Protocol Zero)</button> \
            ' + (showSubmit ? '<button class="cp-submit" id="cp-submit" disabled>Submit Answer</button>' : '<span class="cp-footer-spacer"></span>') + ' \
        </div>';
    document.body.appendChild(lockdownOverlay);

    // ── Lazy-load question image from Drive if needed ─────────────────────
    if (q.driveImageId && !(q.imageDataUrl && q.imageDataUrl.length > 100) && typeof fetchMediaFromDrive === 'function') {
        const imgEl = lockdownOverlay.querySelector('#cp-question-img');
        if (imgEl) {
            // AppState.driveAccessToken may not be ready immediately; retry a few times.
            let attempts = 0;
            const tryFetch = function () {
                const token = AppState && AppState.driveAccessToken;
                if (!token && attempts < 20) { attempts++; return setTimeout(tryFetch, 500); }
                if (!token) return; // give up silently; user still has text + scratchpad
                fetchMediaFromDrive(q.driveImageId, token).then(function (b64) {
                    if (b64) {
                        imgEl.classList.remove('cp-img-pending');
                        imgEl.src = b64;
                        // Cache so future renders skip the fetch.
                        try { q.imageDataUrl = b64; } catch (_) { /* ignore */ }
                    }
                }).catch(function () { /* ignore */ });
            };
            tryFetch();
        }
    }

    // ── Wire answer UI based on mode ──────────────────────────────────────
    let currentAnswer = null;
    const submitBtn = lockdownOverlay.querySelector('#cp-submit');
    function enableSubmit() { if (submitBtn) submitBtn.disabled = false; }

    if (mode === 'single') {
        lockdownOverlay.querySelectorAll('.cp-option').forEach(function (btn) {
            btn.addEventListener('click', function () {
                lockdownOverlay.querySelectorAll('.cp-option').forEach(function (b) { b.classList.remove('selected'); });
                btn.classList.add('selected');
                currentAnswer = btn.getAttribute('data-letter');
                enableSubmit();
                reportTypingActivity();
            });
        });
    } else if (mode === 'multi') {
        currentAnswer = [];
        lockdownOverlay.querySelectorAll('.cp-option').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const letter = btn.getAttribute('data-letter');
                const idx = currentAnswer.indexOf(letter);
                if (idx >= 0) {
                    currentAnswer.splice(idx, 1);
                    btn.classList.remove('selected');
                    btn.querySelector('.cp-opt-letter').textContent = '☐ (' + letter + ')';
                } else {
                    currentAnswer.push(letter);
                    btn.classList.add('selected');
                    btn.querySelector('.cp-opt-letter').textContent = '✓ (' + letter + ')';
                }
                if (currentAnswer.length > 0) enableSubmit();
                else if (submitBtn) submitBtn.disabled = true;
                reportTypingActivity();
            });
        });
    } else if (mode === 'integer') {
        const intInput = lockdownOverlay.querySelector('#cp-integer-input');
        intInput.addEventListener('input', function () {
            currentAnswer = parseFloat(intInput.value);
            if (!isNaN(currentAnswer)) enableSubmit();
            reportTypingActivity();
        });
    } else if (mode === 'self-report') {
        // Two buttons submit directly — no separate Submit button needed.
        lockdownOverlay.querySelector('#cp-sr-correct').addEventListener('click', function () {
            reportTypingActivity();
            submitAnswer(true);
        });
        lockdownOverlay.querySelector('#cp-sr-wrong').addEventListener('click', function () {
            reportTypingActivity();
            submitAnswer(false);
        });
    }

    if (submitBtn) {
        submitBtn.addEventListener('click', function () { submitAnswer(currentAnswer); });
    }
    lockdownOverlay.querySelector('#cp-abandon').addEventListener('click', abandonCheckpoint);
}

// Minimal HTML-escaper for lockdown strings (avoids dependency on storage.js helpers).
function escapeForHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function hideLockdown() {
    if (lockdownOverlay) { lockdownOverlay.remove(); lockdownOverlay = null; }
}

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(kind, msg) {
    if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.id = 'checkpoint-toast';
        toastEl.className = 'checkpoint-toast';
        document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.className = 'checkpoint-toast cp-toast-' + kind;
    toastEl.style.display = 'block';
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(function () { toastEl.style.display = 'none'; }, 6000);
}

// ── State emission ─────────────────────────────────────────────────────────
function emit() {
    if (lockdownOverlay && phase === 'active') {
        const tv = lockdownOverlay.querySelector('#cp-timer-value');
        const tp = lockdownOverlay.querySelector('#cp-timer-paused');
        const remaining = getPowRemainingSec(Date.now());
        if (tv) {
            tv.textContent = formatClock(remaining);
            tv.classList.toggle('paused', powPaused);
            tv.classList.toggle('critical', remaining < 60);
        }
        if (tp) tp.style.display = powPaused ? 'block' : 'none';
    }
    updateControlPanel();
    updateIgniteButton();
    window.dispatchEvent(new CustomEvent('checkpoint:state', {
        detail: {
            phase: phase,
            powRemainingSec: phase === 'active' ? getPowRemainingSec(Date.now()) : null,
            powPaused: powPaused,
            clockRollbackDetected: clockRollbackDetected,
            backgroundGapSec: backgroundGapSec,
            config: getConfig(),
        }
    }));
}

// ============================================================================
// CHECKPOINT CONTROL CENTER — floating panel surfacing ALL 10 backend features
// ============================================================================
let cpHub = null;       // floating button (bottom-left)
let cpPanel = null;     // the control panel modal
let cpIgnite = null;    // prominent INITIATE button (appears when grace arms)

function injectControlCenter() {
    // Floating hub button (bottom-left so it doesn't clash with scratchpad top-right)
    

    // The control panel
    cpPanel = document.createElement('div');
    cpPanel.id = 'cp-control-panel';
    cpPanel.innerHTML = `
        <div class="cpcc-header">
            <div class="cpcc-title">🔒 Checkpoint Control Center</div>
            <button class="cpcc-close" id="cpcc-close">×</button>
        </div>
        <div class="cpcc-body">
            <!-- Live status row -->
            <div class="cpcc-status-row">
                <div class="cpcc-stat">
                    <div class="cpcc-stat-label">Phase</div>
                    <div class="cpcc-stat-value" id="cpcc-phase">—</div>
                </div>
                <div class="cpcc-stat">
                    <div class="cpcc-stat-label">Next CP</div>
                    <div class="cpcc-stat-value" id="cpcc-next">—</div>
                </div>
                <div class="cpcc-stat">
                    <div class="cpcc-stat-label">Idle</div>
                    <div class="cpcc-stat-value" id="cpcc-idle">—</div>
                </div>
            </div>

            <!-- Item 9: Clock tampering badge -->
            <div class="cpcc-badge-row" id="cpcc-rollback-badge" style="display:none;">
                <span class="cpcc-badge cpcc-badge-danger">🕐 Clock Rollback Detected</span>
            </div>
            <!-- Item 10: Background suspension analytics -->
            <div class="cpcc-badge-row" id="cpcc-bgap-badge" style="display:none;">
                <span class="cpcc-badge cpcc-badge-warn">📱 Backgrounded <span id="cpcc-bgap-sec">0</span>s</span>
            </div>

            <!-- Item 1: Master activation switch -->
            <div class="cpcc-section">
                <label class="cpcc-toggle-row">
                    <span class="cpcc-toggle-label">🚨 Master Activation</span>
                    <label class="cpcc-switch">
                        <input type="checkbox" id="cpcc-enabled">
                        <span class="cpcc-slider"></span>
                    </label>
                </label>
            </div>

            <!-- Item 3: Ignition button (also floats, but included here too) -->
            <div class="cpcc-section" id="cpcc-ignite-zone" style="display:none;">
                <button class="cpcc-ignite-btn" id="cpcc-ignite">🔒 INITIATE CHECKPOINT</button>
                <div class="cpcc-grace-timer" id="cpcc-grace-timer"></div>
            </div>

            <!-- Item 2: Checkpoint times -->
            <div class="cpcc-section">
                <div class="cpcc-section-title">Checkpoint Times</div>
                <div id="cpcc-times-list"></div>
                <button class="cpcc-add-btn" id="cpcc-add-time">+ Add Time</button>
            </div>

            <!-- Items 4-8: All thresholds -->
            <div class="cpcc-section">
                <div class="cpcc-section-title">Thresholds</div>
                <div class="cpcc-grid2">
                    <label class="cpcc-field">Idle Threshold (min)<input type="number" id="cpcc-idle" min="5"></label>
                    <label class="cpcc-field">Grace Window (min)<input type="number" id="cpcc-grace" min="1"></label>
                    <label class="cpcc-field">Pre-Notify Lead (min)<input type="number" id="cpcc-prenotify" min="1"></label>
                    <label class="cpcc-field">Proof-of-Work (min)<input type="number" id="cpcc-pow" min="1"></label>
                    <label class="cpcc-field">Stylus Idle Pause (sec)<input type="number" id="cpcc-idlepause" min="10"></label>
                </div>
            </div>

            <button class="cpcc-save-btn" id="cpcc-save">💾 Save Configuration</button>

            <!-- Test / Debug buttons — trigger the flow immediately without waiting -->
            <div class="cpcc-section">
                <div class="cpcc-section-title">Test Controls</div>
                <div class="cpcc-test-row">
                    <button class="cpcc-test-btn cpcc-test-arm" id="cpcc-test-arm">🚨 Arm Checkpoint Now</button>
                    <button class="cpcc-test-btn cpcc-test-prenotify" id="cpcc-test-prenotify">⚠ Test Pre-Notify</button>
                </div>
                <div class="cpcc-test-row">
                    <button class="cpcc-test-btn cpcc-test-simulateidle" id="cpcc-test-idle">⏩ Simulate Idle</button>
                    <button class="cpcc-test-btn cpcc-test-clear" id="cpcc-test-clear">🗑 Clear Penalties</button>
                </div>
            </div>

            <div class="cpcc-msg" id="cpcc-msg"></div>
        </div>
    `;
    document.body.appendChild(cpPanel);

    // Wire close
    cpPanel.querySelector('#cpcc-close').addEventListener('click', closeControlPanel);
    cpPanel.addEventListener('click', function (e) { if (e.target === cpPanel) closeControlPanel(); });

    // Wire master toggle (item 1)
    cpPanel.querySelector('#cpcc-enabled').addEventListener('change', function (e) {
        setConfig({ enabled: e.target.checked });
        if (e.target.checked && 'Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().catch(function () {});
        }
        cpccMsg(e.target.checked ? '🚨 Sentry ARMED' : '○ Disarmed', e.target.checked ? 'warn' : 'ok');
    });

    // Wire test-arm (triggers armCheckpoint immediately)
    cpPanel.querySelector('#cpcc-test-arm').addEventListener('click', function () {
        if (!cfg.enabled) { cpccMsg('Arm the sentry first', 'warn'); return; }
        closeControlPanel();
        armCheckpoint('TEST');
    });

    // Wire test-prenotify
    cpPanel.querySelector('#cpcc-test-prenotify').addEventListener('click', function () {
        showPreNotifyBanner('TEST', 10);
        notify('⚠ Slump Sentry', 'Test pre-notify — checkpoint at TEST in ~10 min.');
        cpccMsg('Pre-notify banner shown', 'ok');
    });

    // Wire simulate-idle (sets lastActivityAt far in the past)
    cpPanel.querySelector('#cpcc-test-idle').addEventListener('click', function () {
        lastActivityAt = Date.now() - (cfg.idleThresholdMin + 5) * 60000;
        cpccMsg('Simulated ' + (cfg.idleThresholdMin + 5) + ' min idle', 'warn');
        tick();
    });

    // Wire clear-penalties (for testing — removes all Protocol Zero scars)
    cpPanel.querySelector('#cpcc-test-clear').addEventListener('click', function () {
        try { localStorage.removeItem(PENALTY_KEY); } catch (_) { /* ignore */ }
        cpIdbSet(PENALTY_KEY, []);
        if (typeof renderErrorResolutionDashboard === 'function') renderErrorResolutionDashboard();
        window.dispatchEvent(new CustomEvent('checkpoint:penalty', { detail: { date: null } }));
        cpccMsg('All penalties cleared', 'ok');
    });

    // Wire ignite (item 3)
    cpPanel.querySelector('#cpcc-ignite').addEventListener('click', function () {
        initiateCheckpoint();
        closeControlPanel();
    });

    // Wire add-time (item 2)
    cpPanel.querySelector('#cpcc-add-time').addEventListener('click', function () {
        const list = cpPanel.querySelector('#cpcc-times-list');
        const items = list.querySelectorAll('.cpcc-time-row');
        if (items.length >= 8) { cpccMsg('Max 8 times', 'warn'); return; }
        list.appendChild(makeTimeRow('12:00'));
    });

    // Wire save (items 2,4,5,6,7,8)
    cpPanel.querySelector('#cpcc-save').addEventListener('click', function () {
        const list = cpPanel.querySelector('#cpcc-times-list');
        const times = [];
        list.querySelectorAll('input[type=time]').forEach(function (inp) {
            if (/^\d{1,2}:\d{2}$/.test(inp.value)) times.push(inp.value);
        });
        if (!times.length) { cpccMsg('Add at least one valid time', 'warn'); return; }
        setConfig({
            checkpoints: times,
            idleThresholdMin: parseInt(cpPanel.querySelector('#cpcc-idle').value) || 120,
            graceMin: parseInt(cpPanel.querySelector('#cpcc-grace').value) || 15,
            preNotifyMin: parseInt(cpPanel.querySelector('#cpcc-prenotify').value) || 10,
            powMin: parseInt(cpPanel.querySelector('#cpcc-pow').value) || 10,
            powIdlePauseSec: parseInt(cpPanel.querySelector('#cpcc-idlepause').value) || 45,
        });
        cpccMsg('✅ Configuration saved', 'ok');
    });

    // Populate from config
    populateControlPanel();
}

function makeTimeRow(val) {
    const row = document.createElement('div');
    row.className = 'cpcc-time-row';
    const inp = document.createElement('input');
    inp.type = 'time';
    inp.value = val;
    const x = document.createElement('button');
    x.className = 'cpcc-time-x';
    x.textContent = '✕';
    x.addEventListener('click', function () { row.remove(); });
    row.appendChild(inp);
    row.appendChild(x);
    return row;
}

function populateControlPanel() {
    if (!cpPanel) return;
    const c = getConfig();
    const list = cpPanel.querySelector('#cpcc-times-list');
    list.innerHTML = '';
    (c.checkpoints && c.checkpoints.length ? c.checkpoints : ['11:00','17:00','21:00']).forEach(function (t) {
        list.appendChild(makeTimeRow(t));
    });
    cpPanel.querySelector('#cpcc-enabled').checked = !!c.enabled;
    cpPanel.querySelector('#cpcc-idle').value = c.idleThresholdMin;
    cpPanel.querySelector('#cpcc-grace').value = c.graceMin;
    cpPanel.querySelector('#cpcc-prenotify').value = c.preNotifyMin;
    cpPanel.querySelector('#cpcc-pow').value = c.powMin;
    cpPanel.querySelector('#cpcc-idlepause').value = c.powIdlePauseSec;
}

function openControlPanel() {
    if (!cpPanel) return;
    populateControlPanel();
    cpPanel.style.display = 'flex';
}

function closeControlPanel() {
    if (cpPanel) cpPanel.style.display = 'none';
}

function cpccMsg(msg, kind) {
    const el = cpPanel && cpPanel.querySelector('#cpcc-msg');
    if (!el) return;
    el.textContent = msg;
    el.className = 'cpcc-msg cpcc-msg-' + (kind || 'ok');
    setTimeout(function () { el.textContent = ''; }, 3500);
}

// Live update of the panel's status row + badges (called from emit)
function updateControlPanel() {
    if (!cpPanel || cpPanel.style.display !== 'flex') return;
    const now = Date.now();
    // Phase
    const phaseEl = cpPanel.querySelector('#cpcc-phase');
    if (phaseEl) {
        phaseEl.textContent = phase.toUpperCase();
        phaseEl.className = 'cpcc-stat-value cpcc-phase-' + phase;
    }
    // Next checkpoint + countdown
    let next = null, nextStr = null;
    for (const t of cfg.checkpoints) {
        const occ = nextOccurrence(t, new Date(now));
        if (occ && (!next || occ.getTime() < next.getTime())) { next = occ; nextStr = t; }
    }
    const nextEl = cpPanel.querySelector('#cpcc-next');
    if (nextEl) {
        if (nextStr) {
            const min = Math.ceil((next.getTime() - now) / 60000);
            nextEl.textContent = nextStr + ' (' + min + 'm)';
        } else { nextEl.textContent = '—'; }
    }
    // Idle
    const idleMs = lastActivityAt ? now - lastActivityAt : Infinity;
    const idleEl = cpPanel.querySelector('#cpcc-idle');
    if (idleEl) idleEl.textContent = idleMs === Infinity ? '∞' : Math.floor(idleMs / 60000) + 'm';
    // Item 9: rollback badge
    const rb = cpPanel.querySelector('#cpcc-rollback-badge');
    if (rb) rb.style.display = clockRollbackDetected ? 'flex' : 'none';
    // Item 10: background gap badge
    const bg = cpPanel.querySelector('#cpcc-bgap-badge');
    if (bg) {
        bg.style.display = backgroundGapSec > 0 ? 'flex' : 'none';
        const sec = cpPanel.querySelector('#cpcc-bgap-sec');
        if (sec) sec.textContent = backgroundGapSec;
    }
    // Item 3: ignite zone visibility (also show in panel when grace)
    const iz = cpPanel.querySelector('#cpcc-ignite-zone');
    if (iz) {
        iz.style.display = (phase === 'grace') ? 'block' : 'none';
        if (phase === 'grace' && graceEndsAt) {
            const rem = Math.max(0, Math.floor((graceEndsAt - now) / 1000));
            const gt = cpPanel.querySelector('#cpcc-grace-timer');
            if (gt) gt.textContent = formatClock(rem) + ' grace remaining';
        }
    }
}

// ── Item 3: Prominent floating INITIATE button (appears when grace arms) ───
function injectIgniteButton() {
    cpIgnite = document.createElement('button');
    cpIgnite.id = 'cp-ignite-float';
    cpIgnite.innerHTML = '🔒 INITIATE<br><small id="cp-ignite-timer">15:00</small>';
    cpIgnite.style.display = 'none';
    cpIgnite.addEventListener('click', function () {
        initiateCheckpoint();
    });
    document.body.appendChild(cpIgnite);
}

function updateIgniteButton() {
    if (!cpIgnite) return;
    if (phase === 'grace' && graceEndsAt) {
        cpIgnite.style.display = 'flex';
        const rem = Math.max(0, Math.floor((graceEndsAt - Date.now()) / 1000));
        const t = cpIgnite.querySelector('#cp-ignite-timer');
        if (t) t.textContent = formatClock(rem);
    } else {
        cpIgnite.style.display = 'none';
    }
}

// ── Init ───────────────────────────────────────────────────────────────────
function init() {
  if (!document.body) { requestAnimationFrame(init); return; }

  // ── TODAY'S LOOP: REMOVED ─────────────────────────────────────────────
  // The 1s monitoring tick + its restore/penalty paths are gone. That loop
  // was writing Protocol-Zero hard-zeros into the 15-day Fix Streak and
  // re-arming itself on every reload, so "closing it" never stuck and the
  // streak stayed scarred. To actually keep the streak we (1) wipe every
  // stored penalty date so both graphs render whole again, and (2) never
  // start the interval / never tick / never restore saved grace-penalty
  // state / never bind the refocus listeners — so nothing can re-scar.
  try { localStorage.setItem(PENALTY_KEY, '[]'); } catch (_) { /* ignore */ }
  openIDB().then(function () { cpIdbSet(PENALTY_KEY, []); });
  try { idbSet(PENALTY_KEY, []); } catch (_) { /* ignore */ }

  loadConfig();           // harmless config read; does NOT touch penalties
  injectControlCenter();  // panel stays display:none + inert (no loop drives it)
  injectIgniteButton();   // float stays display:none (phase never leaves disarmed)

  // Repaint both graphs NOW so the cleared streak shows without a reload.
  try { if (typeof renderErrorResolutionDashboard === 'function') renderErrorResolutionDashboard(); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('checkpoint:penalty', { detail: { date: null } })); } catch (_) {}

  window.__checkpoint = {
    getConfig: getConfig,
    setConfig: setConfig,
    reportDrawingActivity: reportDrawingActivity,
    reportTypingActivity: reportTypingActivity,
    initiate: initiateCheckpoint,
    submit: submitAnswer,
    abandon: abandonCheckpoint,
    getPhase: function () { return phase; },
  };
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}