/**
 * cns-load.js — CNS Load Index + "Junk Reps" Multiplier
 *
 * Self-contained module. Tracks rolling accuracy windows, temporal divergence
 * (τ) history, and session length per subject to compute a continuous
 * CNS_LOAD score in [0, 1]. Applies a stepped ELO yield multiplier to
 * prevent grind-to-zero — the brain isn't a muscle, but the metaphor is
 * operationally useful for a study app.
 *
 * Architecture:
 *   • PURE READ over studySecs / AppState.elo (never mutates them)
 *   • Persists per-subject rolling history in localStorage
 *   • Called from calculateEloMigration() BEFORE the ELO delta is finalised
 *   • Multiplier applies to subject ELO gain ONLY (NOT qElo drift)
 *
 * Dependencies: AppState.elo (window), studySecs (window.storage import)
 */

// ==================== CONSTANTS ====================

const LS_KEY = 'jeemax_cns_load_v1';

const SUBJECTS = ['physics', 'chemistry', 'maths'];

/** Rolling window sizes for accuracy tracking */
const ROLLING_10 = 10;
const ROLLING_50 = 50;

/** τ history window: median of last N solves */
const TAU_WINDOW = 8;

/** 7-day baseline for τ (milliseconds) */
const BASELINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Session length considered "normal" before t_severity starts climbing */
const SESSION_NORMAL_MIN = 90; // minutes

/** Streak threshold for strain bonus */
const STREAK_STRAIN_THRESHOLD = 10; // days

// ==================== YIELD TABLE ====================

/**
 * Stepped yield multiplier.
 * Anchors tabled from Bompa's supercompensation research on training-load
 * tapering. Each band also specifies a τ cap for the next 5 question picks.
 */
const YIELD_TABLE = [
    { lo: 0.00, hi: 0.30,  multiplier: 1.00, tauCap: null,  badge: '🌿',  label: 'Soil moisture adequate. Roots still absorbing.',                    cssClass: 'cns-green' },
    { lo: 0.30, hi: 0.55,  multiplier: 0.85, tauCap: 1.50,  badge: '🪴',  label: 'Photosynthesis slowing. Sap dropping. Pace the watering.',         cssClass: 'cns-warn' },
    { lo: 0.55, hi: 0.75,  multiplier: 0.65, tauCap: 1.25,  badge: '🥀',  label: 'Drought setting in. Trees can survive, but new ones won\'t take.',   cssClass: 'cns-amber' },
    { lo: 0.75, hi: 0.90,  multiplier: 0.40, tauCap: 1.10,  badge: '🪦',  label: 'Cannot plant new seeds today. Existing saplings will drain if over-watered.', cssClass: 'cns-red' },
    { lo: 0.90, hi: 1.01,  multiplier: 0.20, tauCap: 0.95,  badge: '🌑',  label: 'Stop grinding — sleep debt is real.',                              cssClass: 'cns-black' },
];

// ==================== STATE ====================

/**
 * Per-subject rolling history.
 *
 *   accLog:      array of { correct: bool, ts: ISO } (max ROLLING_50 entries)
 *   tauLog:      array of { tau: number, ts: ISO }    (max TAU_WINDOW entries)
 *   sessionStart: ISO timestamp of first solve today (null if not started)
 *   lastSolveTs:  ISO timestamp of last solve
 *   cnsReading:   last computed CNS_LOAD (cached for cat-banner)
 *   cnsReadingTs: ISO timestamp of last reading
 */
let _state = null;

function _defaultState() {
    const out = {};
    for (const s of SUBJECTS) {
        out[s] = {
            accLog: [],
            tauLog: [],
            sessionStart: null,
            _sessionBaselineSecs: 0,  // studySecs snapshot at last pomodoro quit (for tSeverity subtraction)
            lastSolveTs: null,
            cnsReading: 0,
            cnsReadingTs: null,
        };
    }
    // Global cross-subject accumulator
    out._global = {
        /** Rolling list of CNS_LOAD readings for the last 2 days (for consecutive-day checks) */
        dailyCnsReadings: [],   // { date: 'YYYY-MM-DD', maxCns: number }
    };
    return out;
}

// ==================== PERSISTENCE ====================

function _load() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            const def = _defaultState();
            // Merge: ensure all subjects exist
            for (const s of SUBJECTS) {
                if (!parsed[s]) parsed[s] = def[s];
                if (!parsed[s].accLog) parsed[s].accLog = [];
                if (!parsed[s].tauLog) parsed[s].tauLog = [];
                if (parsed[s].sessionStart == null) parsed[s].sessionStart = null;
                if (parsed[s]._sessionBaselineSecs == null) parsed[s]._sessionBaselineSecs = 0;
                if (parsed[s].cnsReading == null) parsed[s].cnsReading = 0;
            }
            if (!parsed._global) parsed._global = def._global;
            if (!parsed._global.dailyCnsReadings) parsed._global.dailyCnsReadings = [];
            _state = parsed;
        } else {
            _state = _defaultState();
        }
    } catch (e) {
        _state = _defaultState();
    }
}

function _save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(_state)); } catch (e) {}
}

// ==================== HELPERS ====================

function _clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function _median(arr) {
    if (!arr || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function _todayKey(d) {
    return (d || new Date()).toLocaleDateString('en-CA'); // YYYY-MM-DD
}

function _normalizeSubjectKey(subj) {
    if (!subj) return 'physics';
    const s = String(subj).toLowerCase();
    if (s === 'math' || s === 'maths' || s === 'mathematics') return 'maths';
    if (s === 'phys' || s === 'physics') return 'physics';
    if (s === 'chem' || s === 'chemistry') return 'chemistry';
    return 'physics';
}

// ==================== SESSION LENGTH (t_severity) ====================

/**
 * Computes the time-severity factor: how far beyond 90 minutes the current
 * session has run. Uses studySecs for the given subject, minus the baseline
 * set at the last pomodoro quit.
 *
 * t_severity = clamp01((sessionMinutes - 90) / 90)
 * i.e. 90 min → 0, 135 min → 0.5, 180 min → 1.0
 *
 * Pomodoro quit subtracts the session by snapshotting the current studySecs
 * value as a baseline, so the next solve sees a reset tSeverity.
 */
function _tSeverity(subject, studySecsObj) {
    const ns = _normalizeSubjectKey(subject);
    const sub = _state && _state[ns];
    const rawSecs = Math.max(0, Math.floor(Number((studySecsObj && studySecsObj[ns]) || 0)));
    const baseline = sub ? (sub._sessionBaselineSecs || 0) : 0;
    const secs = Math.max(0, rawSecs - baseline);
    const mins = secs / 60;
    if (mins <= SESSION_NORMAL_MIN) return 0;
    return _clamp01((mins - SESSION_NORMAL_MIN) / SESSION_NORMAL_MIN);
}

// ==================== ACCURACY COLLAPSE ====================

/**
 * Accuracy collapse: how much worse is the recent rolling-10 accuracy
 * compared to the longer rolling-50 baseline?
 *
 * accuracy_collapse = max(0, acc_50 - acc_10)
 * Cap at 1.0 (i.e., going from 100% to 0% is a full collapse)
 */
function _accuracyCollapse(subject) {
    if (!_state) return 0;
    const sub = _state[subject] || _state[_normalizeSubjectKey(subject)];
    if (!sub || !sub.accLog || sub.accLog.length < ROLLING_10) return 0;

    const r10 = sub.accLog.slice(-ROLLING_10);
    const acc10 = r10.filter(e => e.correct).length / r10.length;

    // Rolling-50 uses whatever is available (min ROLLING_10 to ROLLING_50)
    const r50 = sub.accLog.slice(-ROLLING_50);
    const acc50 = r50.filter(e => e.correct).length / r50.length;

    const collapse = Math.max(0, acc50 - acc10);
    return _clamp01(collapse);
}

// ==================== τ INFLATION ====================

/**
 * Computes τ (tau) for a single solve: actual_time / chapter_average_time.
 *
 * @param {number} actualTime - time taken in seconds
 * @param {number} chapterAvgTime - chapter average in seconds (from _getChapterAvgTime)
 * @returns {number} tau value
 */
function computeTau(actualTime, chapterAvgTime) {
    const T_act = Math.max(0, Number(actualTime) || 0);
    const T_avg = Math.max(1, Number(chapterAvgTime) || 1);
    return T_act > 0 ? T_act / T_avg : 1;
}

/**
 * τ inflation: how much slower is the median τ over the last 8 solves
 * compared to the user's 7-day baseline?
 *
 * τ_inflation = clamp01((medianRecent / medianBaseline) - 1)
 *
 * Baseline uses τ log entries from the last 7 days.
 */
function _tauInflation(subject) {
    if (!_state) return 0;
    const sub = _state[subject] || _state[_normalizeSubjectKey(subject)];
    if (!sub || !sub.tauLog || sub.tauLog.length < 2) return 0;

    const now = Date.now();
    const cutoff = now - BASELINE_WINDOW_MS;

    // Recent: last TAU_WINDOW entries
    const recent = sub.tauLog.slice(-TAU_WINDOW);
    const recentVals = recent.map(e => e.tau);
    const medianRecent = _median(recentVals);

    // Baseline: all entries from last 7 days (including recent)
    const baseline = sub.tauLog.filter(e => {
        const ts = new Date(e.ts).getTime();
        return !isNaN(ts) && ts >= cutoff;
    }).map(e => e.tau);

    if (baseline.length < 3) return 0; // not enough baseline data

    const medianBaseline = _median(baseline);
    if (medianBaseline <= 0) return 0;

    const inflation = (medianRecent / medianBaseline) - 1;
    return _clamp01(inflation * 2); // scale: 50% slower = 1.0
}

// ==================== STREAK STRAIN ====================

/**
 * Streak strain bonus: mild extra weight after 10+ day streaks.
 * Reads from the DOM's #top-streak element text.
 *
 * Returns 1.0 (full strain activation) for streaks ≥ 30 days.
 * Linearly interpolated between 10 and 30 days.
 */
function _streakStrainBonus() {
    try {
        const el = document.getElementById('top-streak');
        if (!el) return 0;
        const match = (el.textContent || '').match(/(\d+)/);
        if (!match) return 0;
        const streak = parseInt(match[1], 10) || 0;
        if (streak < STREAK_STRAIN_THRESHOLD) return 0;
        return _clamp01((streak - STREAK_STRAIN_THRESHOLD) / 20); // max at 30 days
    } catch (e) {
        return 0;
    }
}

// ==================== CORE: CNS_LOAD ====================

/**
 * Computes the CNS_LOAD index for a given subject + global factors.
 *
 * CNS_LOAD = clamp01(
 *     0.50 * t_severity_factor
 *   + 0.30 * accuracy_collapse
 *   + 0.20 * tau_inflation
 *   + 0.05 * streak_strain_bonus
 * )
 *
 * @param {string} subject - 'physics' | 'chemistry' | 'maths'
 * @param {object} studySecsObj - the studySecs object from storage.js
 * @returns {object} { cnsLoad, band, multiplier, tauCap, badge, label, cssClass, components }
 */
export function computeCnsLoad(subject, studySecsObj) {
    if (!_state) _load();
    const ns = _normalizeSubjectKey(subject);

    const tSev    = _tSeverity(ns, studySecsObj);
    const accCol  = _accuracyCollapse(ns);
    const tauInf  = _tauInflation(ns);
    const streak  = _streakStrainBonus();

    const raw = 0.50 * tSev + 0.30 * accCol + 0.20 * tauInf + 0.05 * streak;
    const cnsLoad = _clamp01(raw);

    // Find matching band
    let band = YIELD_TABLE[0];
    for (const b of YIELD_TABLE) {
        if (cnsLoad >= b.lo && cnsLoad < b.hi) {
            band = b;
            break;
        }
    }

    // ── Anti-cheat veto: ×0.20 band requires two consecutive solves with
    // rolling-10 accuracy < 0.40. A single outlier can't gate the student. ──
    if (band.multiplier === 0.20 && !isCns09Allowed(subject)) {
        // Clamp to next band up (×0.40)
        band = YIELD_TABLE[3]; // index 3 = 0.75-0.90, ×0.40
    }

    // ── Early-days guard: when rolling windows are too thin to produce a
    // meaningful accuracy/τ signal, cap CNS_LOAD at 0.55 (×0.85 max). This
    // prevents false positives from tSeverity alone driving the score. ──
    const sub = _state[ns];
    let _effectiveCns = cnsLoad; // may be capped below
    if (sub && sub.accLog.length < ROLLING_10 && cnsLoad > 0.55) {
        _effectiveCns = 0.55;
        // Re-resolve band under the cap
        for (const b of YIELD_TABLE) {
            if (_effectiveCns >= b.lo && _effectiveCns < b.hi) {
                band = b;
                break;
            }
        }
    }

    // Cache reading (uses the effective/capped value for daily tracking)
    if (_state && _state[ns]) {
        _state[ns].cnsReading = _effectiveCns;
        _state[ns].cnsReadingTs = new Date().toISOString();
        _updateDailyCnsMax(_effectiveCns);
        _save();
    }

    return {
        cnsLoad: _effectiveCns,
        band,
        multiplier: band.multiplier,
        tauCap: band.tauCap,
        badge: band.badge,
        label: band.label,
        cssClass: band.cssClass,
        components: { tSeverity: tSev, accuracyCollapse: accCol, tauInflation: tauInf, streakStrain: streak },
    };
}

function _updateDailyCnsMax(cnsLoad) {
    if (!_state || !_state._global) return;
    const today = _todayKey();
    const readings = _state._global.dailyCnsReadings;
    // Find or create today's entry
    let entry = readings.find(r => r.date === today);
    if (!entry) {
        entry = { date: today, maxCns: cnsLoad };
        readings.push(entry);
        // Keep last 14 days
        while (readings.length > 14) readings.shift();
    } else {
        entry.maxCns = Math.max(entry.maxCns, cnsLoad);
    }
}

/**
 * Check if CNS_LOAD has been ≥ threshold for N consecutive days.
 * Used for deload auto-eligibility (CNS_LOAD ≥ 0.85 for 2 days).
 */
export function consecutiveCnsDays(threshold, n) {
    if (!_state || !_state._global) return false;
    const readings = _state._global.dailyCnsReadings;
    if (readings.length < n) return false;

    // Get last N days chronologically
    const recent = readings.slice(-n);
    return recent.every(r => r.maxCns >= threshold);
}

// ==================== LOG SOLVE ====================

/**
 * Called after every solve to update the rolling accuracy and τ windows.
 *
 * @param {string} subject - 'physics' | 'chemistry' | 'maths'
 * @param {boolean} correct - whether the answer was correct
 * @param {number} timeTaken - actual time in seconds
 * @param {number} chapterAvgTime - chapter average time from _getChapterAvgTime
 */
export function logSolve(subject, correct, timeTaken, chapterAvgTime) {
    if (!_state) _load();
    const ns = _normalizeSubjectKey(subject);
    if (!_state[ns]) _state[ns] = _defaultState()[ns];

    const sub = _state[ns];
    const now = new Date().toISOString();

    // -- Session start tracking --
    const today = _todayKey();
    if (!sub.sessionStart || _todayKey(new Date(sub.sessionStart)) !== today) {
        sub.sessionStart = now;
    }

    // -- Accuracy log --
    sub.accLog.push({ correct: !!correct, ts: now });
    // Trim to ROLLING_50
    while (sub.accLog.length > ROLLING_50) sub.accLog.shift();

    // -- τ log --
    const tau = computeTau(timeTaken, chapterAvgTime);
    sub.tauLog.push({ tau, ts: now });
    while (sub.tauLog.length > TAU_WINDOW * 2) sub.tauLog.shift(); // keep some history for baseline

    // -- Last solve --
    sub.lastSolveTs = now;

    _save();
}

// ==================== ANTI-CHEAT VETO ====================

/**
 * Anti-cheat: crossing into ×0.20 band requires two consecutive solves
 * where rolling-10 accuracy drops below 0.40.
 *
 * @returns {boolean} true if the ×0.20 band should be allowed
 */
export function isCns09Allowed(subject) {
    if (!_state) _load();
    const ns = _normalizeSubjectKey(subject);
    const sub = _state[ns];
    if (!sub || !sub.accLog || sub.accLog.length < 2) return false;

    // Check last 2 entries: both must have rolling-10 accuracy < 0.40
    const last2 = sub.accLog.slice(-2);
    for (const entry of last2) {
        // Recompute rolling-10 accuracy AS OF that entry's position
        const idx = sub.accLog.indexOf(entry);
        if (idx < ROLLING_10 - 1) return false;
        const window10 = sub.accLog.slice(idx - ROLLING_10 + 1, idx + 1);
        const acc = window10.filter(e => e.correct).length / window10.length;
        if (acc >= 0.40) return false;
    }
    return true;
}

// ==================== SESSION RESET (Pomodoro Quit) ====================

/**
 * Called when the user quits the pomodoro timer.
 * Subtracts the current pomodoro session's study time from the CNS tracking,
 * effectively resetting the session-length component of CNS_LOAD.
 *
 * Only applies the reset if a pomodoro was actively running.
 */
export function onPomodoroQuit(subject) {
    if (!_state) _load();
    const ns = _normalizeSubjectKey(subject);
    const sub = _state[ns];
    if (!sub) return;

    // Snapshot the current studySecs value so tSeverity starts counting
    // from zero again for the next session (the spec's "Session length is
    // subtractable with a Pomodoro quit"). We reach into the imported
    // studySecs via the global bridge set up by app.js.
    sub._sessionBaselineSecs = Math.max(0, Math.floor(
        Number((window._studySecsForCns && window._studySecsForCns[ns]) || 0)
    ));
    sub.sessionStart = null;
    _save();
}

// ==================== CACHED READING (for cat-banner) ====================

/**
 * Returns the last cached CNS_LOAD reading for the given subject.
 * Does NOT recompute.
 */
export function getLastCnsReading(subject) {
    if (!_state) _load();
    const ns = _normalizeSubjectKey(subject);
    const sub = _state[ns];
    if (!sub) return 0;
    return sub.cnsReading || 0;
}

/**
 * Returns the max CNS_LOAD across all 3 subjects (cached readings).
 */
export function getMaxCnsReading() {
    let max = 0;
    for (const s of SUBJECTS) {
        max = Math.max(max, getLastCnsReading(s));
    }
    return max;
}

// ==================== DAILY RESET (call at midnight) ====================

export function resetDaily() {
    if (!_state) return;
    for (const s of SUBJECTS) {
        if (_state[s]) {
            _state[s].sessionStart = null;
            _state[s]._sessionBaselineSecs = 0; // fresh day, fresh baseline
        }
    }
    _save();
}

// ==================== INIT ====================

function init() {
    _load();
}

// Auto-init on import
init();

// ==================== PUBLIC API ====================

export const CNSLoad = {
    computeCnsLoad,
    logSolve,
    onPomodoroQuit,
    getLastCnsReading,
    getMaxCnsReading,
    consecutiveCnsDays,
    isCns09Allowed,
    resetDaily,
    computeTau,
    get state() { return _state; },
};

// Window global for cross-module and debug access
window.__cnsLoad = CNSLoad;
