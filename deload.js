/**
 * deload.js — Deload Day Streak Protection
 *
 * Self-contained module. Implements the "Earned Rest" (manual) and
 * "Biodemand" (forced) deload-day flavours from the supercompensation
 * design spec. Deload days preserve streaks and decay CNS Load —
 * letting the student's brain consolidate like a muscle between sets.
 *
 * Architecture:
 *   • Persists deload state in localStorage
 *  • Integrates with CNSLoad.consecutiveCnsDays() for auto-eligibility
 *  • Scheduled from the Config panel via app.js scheduleDeloadFromUi()
 *   • Anti-cheat: cooldown timers, circuit breaker, 48h missed-day block
 *
 * Dependencies: CNSLoad (window.__cnsLoad), AppState.moodMultiplier (window)
 */

// ==================== CONSTANTS ====================

const LS_KEY = 'jeemax_deload_v1';

const DELOAD_COOLDOWN_DAYS = 14;
const DELOAD_MIN_STREAK = 7;
const FORCED_CNS_THRESHOLD = 0.85;
const FORCED_CONSECUTIVE_DAYS = 2;
const FORCED_OVERRIDE_WINDOW_MIN = 30;  // minutes to override with mood calibration
const MISSED_DAY_BLOCK_HOURS = 48;       // can't schedule manual deload within 48h of missed day
const CIRCUIT_BREAKER_MAX = 3;           // max manual deloads in...
const CIRCUIT_BREAKER_WINDOW = 30;       // ...days before lock
const CIRCUIT_BREAKER_LOCK = 60;         // days locked out after breaker fires

// ==================== STATE ====================

let _state = null;

function _defaultState() {
    return {
        version: 1,
        manualDeloads: [],        // [{ date: 'YYYY-MM-DD', scheduledAt: ISO }]
        forcedDeloads: [],        // [{ date: 'YYYY-MM-DD', triggeredAt: ISO, overridden: bool }]
        lastManualDeloadDate: null,
        lastForcedDeloadDate: null,
        forcedOverrideTimestamp: null,  // Date.now() + 30min window
        forcedOverrideUsed: false,
        circuitBreaker: {
            manualCountWindow: [],    // [{ date: ISO }] — dates of manual deloads in last 30 days
            lockedUntil: null,       // 'YYYY-MM-DD' — locked until this date
        },
    };
}

// ==================== PERSISTENCE ====================

function _load() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            const def = _defaultState();
            _state = { ...def, ...parsed };
            if (!_state.circuitBreaker) _state.circuitBreaker = def.circuitBreaker;
            if (!_state.circuitBreaker.manualCountWindow) _state.circuitBreaker.manualCountWindow = [];
            if (!_state.manualDeloads) _state.manualDeloads = [];
            if (!_state.forcedDeloads) _state.forcedDeloads = [];
        } else {
            _state = _defaultState();
        }
    } catch (e) {
        _state = _defaultState();
    }
}

function _save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(_state)); }
    catch (e) { console.warn('[deload] localStorage write failed (quota/private mode):', e); }
}

// ==================== HELPERS ====================

// ICU-safe local YYYY-MM-DD key — manual formatting (toLocaleDateString
// variants can emit non-ISO shapes, corrupting the cooldown window keys).
function _todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Calendar-day key N days back — DST-safe (Date.now() - 86400000 can land on
// the SAME day during spring-forward and skip a genuinely missed day).
function _daysBackKey(daysBack) {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    return _todayKey(d);
}

function _daysBetween(a, b) {
    const da = new Date(a + 'T12:00:00');
    const db = new Date(b + 'T12:00:00');
    if (isNaN(da.getTime()) || isNaN(db.getTime())) {
        // Corrupt stored date — report an IMPOSSIBLE state (-1). Returning the
        // threshold itself was NOT fail-closed: the gate reads
        // daysSince < DELOAD_COOLDOWN_DAYS, and 14 < 14 is false, so a
        // corrupt date still bypassed the cooldown exactly like NaN did.
        // The call site turns -1 into an explicit refusal with its own message.
        return -1;
    }
    return Math.round((db - da) / 86400000);
}

function _isDeloadDate(dateStr) {
    if (!_state) _load();
    const manual = _state.manualDeloads.some(d => d.date === dateStr);
    const forced = _state.forcedDeloads.some(d => d.date === dateStr && !d.overridden);
    return manual || forced;
}

// Read the streak from the ledger history directly instead of the #top-streak
// DOM element, which can be stale ("0 Days (start something)") before the
// async history load resolves.
function _getStreakDays() {
    try {
        const fn = window._deloadDailyHistoryFn;
        if (fn) {
            const history = fn();
            if (Array.isArray(history) && history.length > 0) {
                const active = new Set(
                    history.filter(h => h && h.count > 0 && h.date).map(h => h.date)
                );
                let streak = 0;
                const check = new Date();
                if (!active.has(_todayKey(check))) check.setDate(check.getDate() - 1);
                while (active.has(_todayKey(check))) {
                    streak++;
                    check.setDate(check.getDate() - 1);
                }
                return streak;
            }
        }
    } catch (e) { /* fall through to DOM read */ }
    try {
        const el = document.getElementById('top-streak');
        if (!el) return 0;
        const match = (el.textContent || '').match(/(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
    } catch (e) { return 0; }
}

// ==================== MANUAL DELOAD ("Earned Rest") ====================

/**
 * Check if the user is eligible to schedule a manual deload today.
 * Returns { ok, reason }.
 */
export function canScheduleManualDeload() {
    if (!_state) _load();
    const today = _todayKey();

    // Already a deload day?
    if (_isDeloadDate(today)) {
        return { ok: false, reason: 'Today is already a deload day.' };
    }

    // Streak minimum
    const streak = _getStreakDays();
    if (streak < DELOAD_MIN_STREAK) {
        return { ok: false, reason: `Need ≥ ${DELOAD_MIN_STREAK}-day streak. You have ${streak}.` };
    }

    // 14-day cooldown
    if (_state.lastManualDeloadDate) {
        const daysSince = _daysBetween(_state.lastManualDeloadDate, today);
        if (daysSince === -1) {
            // Corrupt stored date — refuse to schedule rather than silently
            // passing the gate (fail-closed; see _daysBetween).
            return { ok: false, reason: 'Cooldown check unavailable — stored deload date is corrupt.' };
        }
        if (daysSince < DELOAD_COOLDOWN_DAYS) {
            const remaining = DELOAD_COOLDOWN_DAYS - daysSince;
            return { ok: false, reason: `Cooldown: ${remaining} day${remaining > 1 ? 's' : ''} until next manual deload.` };
        }
    }

    // Circuit breaker
    if (_state.circuitBreaker.lockedUntil && today < _state.circuitBreaker.lockedUntil) {
        return { ok: false, reason: `Circuit breaker active. Manual deloads locked until ${_state.circuitBreaker.lockedUntil}.` };
    }

    // 48h missed-day block: cannot schedule deload within 48h of a missed
    // day. Checks both yesterday AND two days ago (the "48h" window).
    // On fresh installs with empty history, skip the check — the user
    // hasn't had a chance to miss a day yet. ──
    const yesterday = _daysBackKey(1);
    const twoDaysAgo = _daysBackKey(2);
    try {
        const history = window._deloadDailyHistoryFn ? window._deloadDailyHistoryFn() : null;
        if (history && history.length > 0) {
            const yd = history.find(h => h.date === yesterday);
            const td = history.find(h => h.date === twoDaysAgo);
            const ydMissed = !yd || (yd.count || 0) === 0;
            const tdMissed = !td || (td.count || 0) === 0;
            if (ydMissed || tdMissed) {
                return { ok: false, reason: 'Cannot schedule deload within 48h of a missed day. Rebuild momentum first.' };
            }
        }
        // Empty history (fresh install) → skip 48h check; the user hasn't missed any days
    } catch (_) { /* history unavailable, allow */ }

    return { ok: true, reason: '' };
}

/**
 * Schedule a manual deload for today.
 * Returns { ok, reason, deload }.
 */
export function scheduleManualDeload() {
    if (!_state) _load();
    const check = canScheduleManualDeload();
    if (!check.ok) return check;

    const today = _todayKey();
    const now = new Date().toISOString();

    _state.manualDeloads.push({ date: today, scheduledAt: now });
    _state.lastManualDeloadDate = today;

    // Circuit breaker tracking
    _state.circuitBreaker.manualCountWindow.push({ date: today });
    // Prune old entries
    const cutoff = _daysBackKey(CIRCUIT_BREAKER_WINDOW);
    _state.circuitBreaker.manualCountWindow = _state.circuitBreaker.manualCountWindow
        .filter(d => d.date >= cutoff);

    if (_state.circuitBreaker.manualCountWindow.length >= CIRCUIT_BREAKER_MAX) {
        const lockDate = new Date();
        lockDate.setDate(lockDate.getDate() + CIRCUIT_BREAKER_LOCK);
        _state.circuitBreaker.lockedUntil = _todayKey(lockDate);
        _state.circuitBreaker.manualCountWindow = []; // reset counter after lock
    }

    _save();
    return { ok: true, reason: '', deload: { date: today, type: 'manual', badge: '🌿' } };
}

// ==================== FORCED DELOAD ("Biodemand") ====================

/**
 * Check if the user is eligible for a forced (auto) deload today.
 * Requires: CNS_LOAD ≥ 0.85 for 2 consecutive days AND mood-multiplier at 0.70.
 */
export function isForcedDeloadEligible() {
    if (!_state) _load();
    const today = _todayKey();

    // Already a deload day?
    if (_isDeloadDate(today)) {
        return { eligible: false, reason: 'Today is already a deload day.' };
    }

    // Streak minimum
    const streak = _getStreakDays();
    if (streak < DELOAD_MIN_STREAK) {
        return { eligible: false, reason: `Need ≥ ${DELOAD_MIN_STREAK}-day streak.` };
    }

    // CNS_LOAD check
    let cnsTriggered = false;
    try {
        if (window.__cnsLoad && typeof window.__cnsLoad.consecutiveCnsDays === 'function') {
            cnsTriggered = window.__cnsLoad.consecutiveCnsDays(FORCED_CNS_THRESHOLD, FORCED_CONSECUTIVE_DAYS);
        }
    } catch (_) {}

    if (!cnsTriggered) {
        return { eligible: false, reason: `CNS_LOAD not ≥ ${Math.round(FORCED_CNS_THRESHOLD * 100)}% for ${FORCED_CONSECUTIVE_DAYS} consecutive days.` };
    }

    // Mood check
    const moodMultiplier = (window.AppState && window.AppState.moodMultiplier) || 1.0;
    if (moodMultiplier > 0.70) {
        return { eligible: false, reason: 'Mood not in fried state (mood multiplier must be 0.70).' };
    }

    // Check if already triggered today
    const alreadyTriggered = _state.forcedDeloads.some(d => d.date === today);
    if (alreadyTriggered) {
        return { eligible: false, reason: 'Forced deload already active today.' };
    }

    return { eligible: true, reason: '' };
}

/**
 * Trigger a forced deload for today. Locks in unless overridden within
 * 30 minutes via mood calibration to 1.0.
 */
export function triggerForcedDeload() {
    if (!_state) _load();
    const check = isForcedDeloadEligible();
    if (!check.eligible) return { ok: false, reason: check.reason };

    const today = _todayKey();
    const now = Date.now();

    _state.forcedDeloads.push({ date: today, triggeredAt: new Date().toISOString(), overridden: false });
    _state.lastForcedDeloadDate = today;
    _state.forcedOverrideTimestamp = now + FORCED_OVERRIDE_WINDOW_MIN * 60 * 1000;
    _state.forcedOverrideUsed = false;

    _save();
    return {
        ok: true,
        reason: '',
        deload: { date: today, type: 'forced', badge: '🌿🌿', overrideWindowMs: FORCED_OVERRIDE_WINDOW_MIN * 60 * 1000 },
    };
}

/**
 * Attempt to override today's forced deload via mood calibration.
 * Only works if within the 30-minute override window and mood is set to 1.0.
 */
export function overrideForcedDeload(moodMultiplier) {
    if (!_state) _load();
    const today = _todayKey();

    const forced = _state.forcedDeloads.find(d => d.date === today && !d.overridden);
    if (!forced) return { ok: false, reason: 'No active forced deload to override.' };

    if (_state.forcedOverrideUsed) {
        return { ok: false, reason: 'Override already used today.' };
    }

    if (!_state.forcedOverrideTimestamp || Date.now() > _state.forcedOverrideTimestamp) {
        return { ok: false, reason: 'Override window expired (30 min from trigger).' };
    }

    if (moodMultiplier !== 1.0) {
        return { ok: false, reason: 'Override requires mood calibration to baseline (1.0).' };
    }

    forced.overridden = true;
    _state.forcedOverrideUsed = true;
    _save();

    return { ok: true, reason: '', overridden: true };
}

// ==================== QUERIES ====================

/**
 * Check if today is an active deload day (manual or non-overridden forced).
 */
export function isTodayDeload() {
    if (!_state) _load();
    return _isDeloadDate(_todayKey());
}

/**
 * Get the deload status for today.
 * Returns { active, type, badge, label } or null.
 */
export function getTodayDeloadStatus() {
    if (!_state) _load();
    const today = _todayKey();

    const manual = _state.manualDeloads.find(d => d.date === today);
    if (manual) {
        return { active: true, type: 'manual', badge: '🌿', label: 'Earned Rest' };
    }

    const forced = _state.forcedDeloads.find(d => d.date === today && !d.overridden);
    if (forced) {
        return { active: true, type: 'forced', badge: '🌿🌿', label: 'Bio-demand Recovery' };
    }

    return null;
}

/**
 * Return whether a given date is a deload day (for rendering on calendar/heat map).
 */
export function isDeloadDate(dateStr) {
    if (!_state) _load();
    return _isDeloadDate(dateStr);
}

/**
 * Get frame (forest metaphor) text for the current deload state.
 */
export function getDeloadFrame() {
    const status = getTodayDeloadStatus();
    if (!status) return null;

    if (status.type === 'manual') {
        return 'Took a deload. Your brain is consolidating — like a muscle between sets. Tree-wilted leaves are pruned, not dead. Streak preserved.';
    }
    return 'Bio-demand recovery active. CNS overload detected — the forest is forcing a rest cycle. Override with mood calibration within 30 min, or let the roots drink.';
}

// ==================== DAILY RESET ====================

export function resetDaily() {
    // Cleanup old deload entries (older than 60 days)
    if (!_state) return;
    const cutoff = _todayKey(new Date(Date.now() - 60 * 86400000));
    _state.manualDeloads = _state.manualDeloads.filter(d => d.date >= cutoff);
    _state.forcedDeloads = _state.forcedDeloads.filter(d => d.date >= cutoff);
    // Clear stale forced override state from yesterday
    _state.forcedOverrideTimestamp = null;
    _state.forcedOverrideUsed = false;
    _save();
}

// ==================== INIT ====================

function init() {
    _load();
}

init();

// ==================== PUBLIC API ====================

export const DeloadEngine = {
    canScheduleManualDeload,
    scheduleManualDeload,
    isForcedDeloadEligible,
    triggerForcedDeload,
    overrideForcedDeload,
    isTodayDeload,
    getTodayDeloadStatus,
    isDeloadDate,
    getDeloadFrame,
    resetDaily,
    get state() { return _state; },
};

window.__deload = DeloadEngine;
