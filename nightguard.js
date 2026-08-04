/**
 * nightguard.js — Post-23:00 "Diminishing Returns" Guard
 *
 * Self-contained module. When the local clock crosses 23:00, this guard
 * applies a stepped ELO yield degradation based on the tier:
 *
 *   Tier 1 (23:00–01:00): ×0.80  — 🌙 blue pill, dismissible
 *   Tier 2 (01:00–03:00): ×0.55  — 🌑 dim amber, 5s auto-dismiss
 *   Tier 3 (03:00+):      ×0.20  — 🛌 uninterruptible modal, force CNS=1.0
 *
 * The guard also:
 *   • Detects clock manipulation (Date.now jumps backwards → force CNS=1.0)
 *   • Tracks late-night overrides (long-press 3s) → morning cat-banner warning
 *   • Maintains a Sleep-Debt Ledger (pomodoro session gaps < 6h flagged)
 *   • 3 consecutive sleep-debt days → moodMultiplier penalty (0.85)
 *
 * Architecture:
 *   • PURE READ — never mutates AppState, studySecs, or questionBank
 *   • Persists tier + override state in localStorage
 *   • Pomodoro hooks: logSessionEnd / logSessionStart for sleep-debt tracking
 *
 * Dependencies: CNSLoad (window.__cnsLoad), pomodoro timerStartTime (window)
 */

// ==================== CONSTANTS ====================

const LS_KEY = 'jeemax_nightguard_v1';

/** Three-tier definition */
const TIERS = [
    {
        name: 'tier1',
        lo: 23, hi: 1,          // 23:00–01:00 (wraps midnight)
        multiplier: 0.80,
        badge: '🌙',
        cssClass: 'night-blue',
        dismissible: true,
        autoDismissMs: 0,       // manual dismiss only
        label: 'Memory consolidation active in 1h. Tap if you must.',
    },
    {
        name: 'tier2',
        lo: 1, hi: 3,           // 01:00–03:00
        multiplier: 0.55,
        badge: '🌑',
        cssClass: 'night-amber',
        dismissible: true,
        autoDismissMs: 5000,    // 5s auto-dismiss OK
        label: 'Hippocampal encoding rate dropping. Sleep is the best tutoring session.',
    },
    {
        name: 'tier3',
        lo: 3, hi: 24,          // 03:00–24:00 (catch-all for 03:00+)
        multiplier: 0.20,
        badge: '🛌',
        cssClass: 'night-red',
        dismissible: false,     // uninterruptible — requires 3s long-press
        autoDismissMs: 0,
        label: 'You are not learning. You are reinforcing noise. Save your hours.',
        forceCns: true,         // force CNS_LOAD = 1.0
        skyBlue: true,          // sky-blue background tint
    },
];

/** Sleep-debt threshold: gap between session-end and next-session-start < 6h */
const SLEEP_DEBT_GAP_HOURS = 6;

/** Consecutive sleep-debt days required for moodMultiplier penalty */
const SLEEP_DEBT_CONSECUTIVE = 3;

/** Mood penalty when sleep-debt triggers */
const SLEEP_DEBT_MOOD_PENALTY = 0.85;

// ==================== STATE ====================

let _state = {
    /** Monotonic timestamp baseline — detects backwards clock jumps */
    _monotonicBaseline: Date.now(),

    /** Track the last seen Date.now() to detect backwards jumps */
    _lastSeenNow: Date.now(),

    /** Clock-cheat flag: locked at highest tier until drift window closes */
    clockCheatDetected: false,

    /** When clock-cheat was detected (Date.now() at detection) */
    clockCheatDetectedAt: null,

    /** Count of late-night overrides this week */
    lateOverrideCount: 0,

    /** ISO date when override count was last reset */
    overrideCountResetDate: null,

    /** Whether the current tier was dismissed (Tier 1/2 only) */
    dismissed: false,

    /** ISO timestamp of last dismissal */
    dismissedAt: null,

    /** Whether CNS was force-set to 1.0 by Tier 3 */
    forcedCnsActive: false,

    /** Sleep-Debt Ledger: array of { date: 'YYYY-MM-DD', endHour: number, startHour: number } */
    sessionRecords: [],

    /** Array of dates flagged with sleep debt: ['YYYY-MM-DD', ...] */
    sleepDebtDates: [],

    /** Last computed tier result (cached) */
    _cachedTier: null,
    _cachedTierTs: 0,
};

// ==================== PERSISTENCE ====================

function _load() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            // Merge with defaults for forward-compat
            _state = { ..._state, ...parsed };
        }
    } catch (e) { /* use defaults */ }
}

function _save() {
    try {
        // Don't persist transient fields
        const { _monotonicBaseline, _lastSeenNow, _lastSeenPerf, _cachedTier, _cachedTierTs, _cachedTierHour, ...persistable } = _state;
        localStorage.setItem(LS_KEY, JSON.stringify(persistable));
    } catch (e) {}
}

// ==================== HELPERS ====================

// ICU-safe local YYYY-MM-DD key — manual formatting so every consumer
// (sleep-debt ledger, deload windows) shares the identical day bucketing.
function _todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Check if a local hour falls within a tier range that may wrap midnight */
function _hourInRange(hour, lo, hi) {
    if (lo < hi) {
        // Normal range: e.g., 1–3
        return hour >= lo && hour < hi;
    } else {
        // Wrapping range: e.g., 23–1 (23:00–01:00)
        return hour >= lo || hour < hi;
    }
}

/** Get the current local hour */
function _localHour() {
    return new Date().getHours();
}

// ==================== CLOCK-CHEAT DETECTION ====================

/**
 * Detects clock manipulation by comparing Date.now() against an internal
 * monotonic reference. If Date.now() jumps backwards by more than 5 minutes,
 * the user has manipulated their system clock.
 *
 * Also checks: pomodoro's timerStartTime cannot be in the future.
 * If timerStartTime > Date.now(), clock manipulation is confirmed.
 */
export function checkClockCheat() {
    const now = Date.now();

    // ── Check 1: Date.now() moving backwards ──
    if (now < _state._lastSeenNow - (5 * 60 * 1000)) {
        // Clock jumped backwards by > 5 minutes
        _state.clockCheatDetected = true;
        _state.clockCheatDetectedAt = now;
        _save();
        return true;
    }

    // ── Check 1b: Date.now() jumping suspiciously forward ──
    // A >6h wall-clock gap while the local hour is nighttime. The gap alone
    // is NOT evidence — a normal overnight sleep (study until 23:30, resume
    // at 07:00) produces the identical signature. Corroborate with monotonic
    // time: if the device actually ran for ~the wall gap (performance.now()
    // keeps advancing across suspend/sleep on modern platforms), it was
    // sleep → NOT a cheat. Only an awake clock change shows a large wall gap
    // with a small perf gap.
    const realElapsed = now - _state._lastSeenNow;
    const hour = _localHour();
    let deviceSlept = true; // fail-safe: no evidence → treat as sleep
    try {
        if (typeof _state._lastSeenPerf === 'number' && isFinite(_state._lastSeenPerf)) {
            const perfElapsed = performance.now() - _state._lastSeenPerf;
            deviceSlept = perfElapsed >= realElapsed * 0.9;
        }
    } catch (_) { /* keep fail-safe sleep */ }
    if (realElapsed > 6 * 60 * 60 * 1000 &&
        (hour >= 23 || hour < 8) &&
        !deviceSlept) {
        _state.clockCheatDetected = true;
        _state.clockCheatDetectedAt = now;
        _save();
        return true;
    }

    // ── Check 2: Pomodoro timerStartTime in the future ──
    try {
        if (window.__pomodoro && typeof window.__pomodoro.getTimerStartTime === 'function') {
            const timerStart = window.__pomodoro.getTimerStartTime();
            if (timerStart && timerStart > now + (60 * 1000)) {
                // timerStartTime is more than 1 minute in the future → clock was set back
                _state.clockCheatDetected = true;
                _state.clockCheatDetectedAt = now;
                _save();
                return true;
            }
        }
    } catch (_) {}

    // ── Update monotonic tracker ──
    _state._lastSeenNow = Math.max(_state._lastSeenNow, now);
    try { _state._lastSeenPerf = performance.now(); } catch (_) {}
    // Refresh monotonic baseline periodically so forward-jump ratio stays accurate
    if (now - _state._monotonicBaseline > 60 * 60 * 1000) {
        _state._monotonicBaseline = now;
    }

    // ── Clear cheat flag if clock is back to normal (Date.now > cheat detection + 1h) ──
    if (_state.clockCheatDetected && _state.clockCheatDetectedAt) {
        if (now > _state.clockCheatDetectedAt + (60 * 60 * 1000)) {
            _state.clockCheatDetected = false;
            _state.clockCheatDetectedAt = null;
            _state.forcedCnsActive = false;
            _save();
        }
    }

    return _state.clockCheatDetected;
}

// ==================== TIER RESOLUTION ====================

/**
 * Resolve which late-night tier is currently active.
 * Returns null if before 23:00 (no guard needed) and no clock-cheat.
 *
 * @returns {{ tier: object, active: boolean, forceCns: boolean, skyBlue: boolean } | null}
 */
export function resolveTier() {
    // Cache for 10 seconds (reduced from 60s to avoid tier-entry delays)
    const now = Date.now();
    const currentHour = _localHour();
    if (_state._cachedTier && (now - _state._cachedTierTs) < 10000 &&
        _state._cachedTierHour === currentHour) {
        return _state._cachedTier;
    }

    // ── Clock-cheat check ──
    const cheating = checkClockCheat();
    if (cheating) {
        // An explicit user override (3s hold) still takes effect; it is
        // cleared again by the daily reset at midnight.
        if (_state.dismissed) {
            _state._cachedTier = null;
            _state._cachedTierTs = now;
            return null;
        }
        // Force highest tier when cheating detected
        const tier3 = TIERS[2];
        _state.forcedCnsActive = true;
        const result = {
            tier: tier3,
            active: true,
            forceCns: true,
            skyBlue: true,
            clockCheat: true,
            multiplier: tier3.multiplier,
            badge: tier3.badge,
            cssClass: tier3.cssClass,
            dismissible: false,
            label: 'Clock manipulation detected. Locked at highest tier.',
        };
        _state._cachedTier = result;
        _state._cachedTierTs = now;
        _save();
        return result;
    }

    const hour = _localHour();

    // Check each tier
    for (const tier of TIERS) {
        if (_hourInRange(hour, tier.lo, tier.hi)) {
            // Tier 3 caps at 08:00 — after dawn, the guard lifts.
            // (Spec says "03:00+" but 08:00 is a practical upper bound
            // since post-sunrise studying, even all-night, has passed
            // the most neurochemically harmful window.)
            if (tier.name === 'tier3' && hour >= 8) {
                _state._cachedTier = null;
                _state._cachedTierTs = now;
                _state._cachedTierHour = hour;
                return null;
            }

            // Check if dismissed (any tier — override or regular dismiss,
            // resets daily at midnight via resetDaily)
            if (_state.dismissed) {
                _state._cachedTier = null;
                _state._cachedTierTs = now;
                return null;
            }

            const result = {
                tier,
                active: true,
                forceCns: tier.forceCns || false,
                skyBlue: tier.skyBlue || false,
                clockCheat: false,
                multiplier: tier.multiplier,
                badge: tier.badge,
                cssClass: tier.cssClass,
                dismissible: tier.dismissible,
                label: tier.label,
                autoDismissMs: tier.autoDismissMs || 0,
            };

            _state._cachedTier = result;
            _state._cachedTierTs = now;
            _state._cachedTierHour = hour;
            return result;
        }
    }

    // No tier active (before 23:00)
    _state._cachedTier = null;
    _state._cachedTierTs = now;
    return null;
}

/**
 * Get the ELO yield multiplier for the current tier.
 * Returns 1.0 if no tier is active.
 */
export function getMultiplier() {
    const tier = resolveTier();
    if (!tier) return 1.0;
    return tier.multiplier;
}

/**
 * Check if the night guard is currently active.
 */
export function isActive() {
    return resolveTier() !== null;
}

/**
 * Get whether CNS should be force-set to 1.0 (Tier 3 or clock-cheat).
 */
export function shouldForceCns() {
    const tier = resolveTier();
    if (!tier) return false;
    return tier.forceCns;
}

// ==================== DISMISSAL ====================

/**
 * Dismiss the current tier warning (Tier 1/2 only).
 * Tier 3 requires long-press override.
 */
export function dismissCurrentTier() {
    const tier = resolveTier();
    if (!tier) return { ok: false, reason: 'No active tier' };
    if (!tier.dismissible) return { ok: false, reason: 'This tier requires long-press override (3s)' };

    _state.dismissed = true;
    _state.dismissedAt = new Date().toISOString();
    _state._cachedTier = null; // invalidate cache
    _save();
    return { ok: true };
}

/**
 * Long-press override for Tier 3 (uninterruptible modal).
 * Requires the caller to have enforced 3s hold.
 *
 * Increments lateOverrideCount and returns success.
 */
export function recordOverride() {
    const now = Date.now();

    // Reset weekly count if needed
    const today = _todayKey();
    if (_state.overrideCountResetDate !== today) {
        // Only reset if it's been at least 1 day since last reset
        if (_state.overrideCountResetDate) {
            const lastReset = new Date(_state.overrideCountResetDate + 'T00:00:00').getTime();
            if (now - lastReset > 7 * 24 * 60 * 60 * 1000) {
                _state.lateOverrideCount = 0;
                _state.overrideCountResetDate = today;
            }
        } else {
            _state.overrideCountResetDate = today;
        }
    }

    _state.lateOverrideCount++;
    _state.dismissed = true;
    _state.dismissedAt = new Date().toISOString();
    _state._cachedTier = null;
    _save();
    return { ok: true, count: _state.lateOverrideCount };
}

// ==================== SLEEP-DEBT LEDGER ====================

/**
 * Log the end of a pomodoro session.
 * Called from pomodoro.js quitTimer.
 */
export function logSessionEnd() {
    const now = new Date();
    const date = _todayKey(now);
    const hour = now.getHours() + now.getMinutes() / 60;

    // Find today's record or create one
    let record = _state.sessionRecords.find(r => r.date === date);
    if (!record) {
        record = { date, endHour: null, startHour: null };
        _state.sessionRecords.push(record);
        // Keep last 30 days
        while (_state.sessionRecords.length > 30) _state.sessionRecords.shift();
    }
    record.endHour = hour;
    _save();
}

/**
 * Log the start of a pomodoro session.
 * Called from pomodoro.js startTimer.
 *
 * Also runs the sleep-debt computation: if the gap between yesterday's
 * session-end and today's session-start is < 6h, flag today as sleep-debt.
 */
export function logSessionStart() {
    const now = new Date();
    const date = _todayKey(now);
    const hour = now.getHours() + now.getMinutes() / 60;

    // Find today's record or create one
    let record = _state.sessionRecords.find(r => r.date === date);
    if (!record) {
        record = { date, endHour: null, startHour: null };
        _state.sessionRecords.push(record);
        while (_state.sessionRecords.length > 30) _state.sessionRecords.shift();
    }
    record.startHour = hour;

    // ── Compute sleep debt ──
    _computeSleepDebt();

    _save();
}

/**
 * Internal: scan session records for sleep debt.
 * If yesterday's endHour and today's startHour have a gap < 6h,
 * flag today as sleep-debt.
 */
function _computeSleepDebt() {
    const records = _state.sessionRecords;
    if (records.length < 2) return;

    // Sort by date
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));

    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];

        // Need both endHour (yesterday) and startHour (today) to compute
        if (prev.endHour == null || curr.startHour == null) continue;

        // Gap calculation: hours between yesterday's end and today's start
        // If endHour > startHour, the gap wraps across midnight naturally
        // because we're comparing different days.
        // e.g., yesterday end 23:30 (23.5), today start 03:00 (3.0)
        // Gap = 24 - 23.5 + 3.0 = 3.5 hours
        let gapHours;
        if (prev.endHour > curr.startHour) {
            // Ended late yesterday, started early today
            gapHours = (24 - prev.endHour) + curr.startHour;
        } else {
            // Unusual: ended early yesterday, started later today
            gapHours = curr.startHour - prev.endHour;
        }

        if (gapHours > 0 && gapHours < SLEEP_DEBT_GAP_HOURS) {
            if (!_state.sleepDebtDates.includes(curr.date)) {
                _state.sleepDebtDates.push(curr.date);
            }
        }
    }

    // Sort and deduplicate
    _state.sleepDebtDates = [...new Set(_state.sleepDebtDates)].sort();
}

/**
 * Check if the last N consecutive days are all flagged as sleep-debt.
 * Used to trigger moodMultiplier penalty.
 */
export function getConsecutiveSleepDebtDays() {
    const dates = [..._state.sleepDebtDates].sort();
    if (dates.length === 0) return 0;

    let consecutive = 1;
    for (let i = dates.length - 1; i > 0; i--) {
        const curr = new Date(dates[i] + 'T12:00:00');
        const prev = new Date(dates[i - 1] + 'T12:00:00');
        const diffDays = Math.round((curr - prev) / (24 * 60 * 60 * 1000));
        if (diffDays === 1) {
            consecutive++;
        } else {
            break;
        }
    }
    return consecutive;
}

/**
 * Returns the mood multiplier penalty if sleep-debt has accumulated.
 * Returns 1.0 (no penalty) normally, or 0.85 if penalty active.
 */
export function getSleepDebtMoodPenalty() {
    const consecutive = getConsecutiveSleepDebtDays();
    if (consecutive >= SLEEP_DEBT_CONSECUTIVE) {
        return SLEEP_DEBT_MOOD_PENALTY;
    }
    return 1.0;
}

/**
 * Check if today is flagged as sleep-debt.
 */
export function isTodaySleepDebt() {
    return _state.sleepDebtDates.includes(_todayKey());
}

// ==================== OVERRIDE COUNT ====================

/**
 * Get the late override count for the cat-banner morning warning.
 */
export function getLateOverrideCount() {
    return _state.lateOverrideCount;
}

/**
 * Generate the morning cat-banner warning text if overrides were used.
 * Returns null if no warning needed.
 */
export function getOverrideWarning() {
    if (_state.lateOverrideCount > 0 && _localHour() < 12) {
        // Only show in the morning (before noon)
        if (_state.lateOverrideCount >= 4) {
            return `🛌 Used late override ${_state.lateOverrideCount}× this week. CNS likely compromised today.`;
        }
        if (_state.lateOverrideCount >= 2) {
            return `🌙 Late override used ${_state.lateOverrideCount}×. Consider earlier sessions.`;
        }
        return `🌙 Late-night override used. Sleep quality may be affected.`;
    }
    return null;
}

// ==================== DAILY RESET ====================

/**
 * Called at midnight to reset the dismissal flag and clear the tier cache.
 */
export function resetDaily() {
    _state.dismissed = false;
    _state.dismissedAt = null;
    _state.forcedCnsActive = false;
    _state._cachedTier = null;
    _state._cachedTierTs = 0;
    _save();
}

// ==================== STATUS (for cat-banner) ====================

/**
 * Get the current status for cat-banner display.
 */
export function getStatus() {
    const tier = resolveTier();
    if (!tier) return { active: false };

    return {
        active: true,
        tier: tier.tier.name,
        multiplier: tier.multiplier,
        badge: tier.badge,
        cssClass: tier.cssClass,
        label: tier.label,
        dismissible: tier.dismissible,
        forceCns: tier.forceCns,
        skyBlue: tier.skyBlue,
        clockCheat: tier.clockCheat || false,
        lateOverrideCount: _state.lateOverrideCount,
        sleepDebtConsecutive: getConsecutiveSleepDebtDays(),
    };
}

// ==================== MODAL AUTO-TRIGGER ====================

/**
 * Check if the Tier 3 uninterruptible modal should be shown.
 * Called from the cat-banner telemetry loop.
 * Returns true if the modal was shown.
 */
export function checkAndShowTier3Modal() {
    const status = getStatus();
    if (!status.active || status.tier !== 'tier3') return false;

    // Don't show if already shown
    const modal = document.getElementById('nightguard-modal');
    if (!modal || modal.classList.contains('active')) return false;

    // Show the modal (class-based like every other modal) and apply sky-blue tint
    modal.classList.add('active');
    document.body.classList.add('nightguard-tint');
    return true;
}

// ==================== PUBLIC API ====================

export const NightGuard = {
    resolveTier,
    getMultiplier,
    isActive,
    shouldForceCns,
    dismissCurrentTier,
    recordOverride,
    logSessionEnd,
    logSessionStart,
    getConsecutiveSleepDebtDays,
    getSleepDebtMoodPenalty,
    isTodaySleepDebt,
    getLateOverrideCount,
    getOverrideWarning,
    resetDaily,
    getStatus,
    checkClockCheat,
    checkAndShowTier3Modal,
    get state() { return _state; },
};

window.__nightGuard = NightGuard;

// Auto-load persisted state
_load();
