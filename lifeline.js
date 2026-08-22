/**
 * lifeline.js — Flow-State Dynamic Lifeline
 *
 * Self-contained module. When CNS_LOAD crosses the LIFELINE_FIRE_THRESHOLD
 * (≥0.80), the lifeline shifts the practice-mode P_win windows toward easier
 * problems — rebalancing the challenge-skill equation back into
 * Csikszentmihalyi's flow channel. The lifeline isn't free: ELO yield is
 * multiplied by 0.65 on lifeline-assisted solves.
 *
 * Architecture:
 *   • Reads CNS_LOAD from window.__cnsLoad (cns-load.js)
 *   • Opt-out toggle persists for ONE solve only
 *   • Auto-disables when CNS_LOAD recovers below 0.40
 *   • Lookback check: chapter must have ≥3 unsolved in the easier band
 *
 * Dependencies: CNSLoad (window.__cnsLoad)
 */

// ==================== CONSTANTS ====================

const LIFELINE_FIRE_THRESHOLD = 0.80;
const LIFELINE_DISABLE_THRESHOLD = 0.40; // auto-disable if recovered mid-session
const LIFELINE_ELO_MULTIPLIER = 0.65;
const LIFELINE_LOOKBACK_MIN = 3; // chapter needs ≥3 unsolved in easier band

/**
 * Per-mode P_win offsets when lifeline is active.
 * The spec: "shift from default window toward easier problems"
 *
 *   P_win = 1 / (1 + 10^((Q - E) / 400))
 *   Higher P_win = easier questions (qElo below userElo)
 */
const LIFELINE_MODE_OFFSETS = {
    standard: { PwinMin: 0.80, PwinMax: 0.90 },   // shift from implicit 0.70-0.85
    flow:     { PwinMin: 0.88, PwinMax: 0.96 },   // shift from 0.75-0.85
    hardcore: { PwinMin: 0.55, PwinMax: 0.72 },   // shift from 0.35-0.50 (relative relief)
};

// ==================== STATE ====================

let _state = {
    active: false,               // lifeline is currently active
    dismissedForSolve: false,    // user opted out for THIS solve only
    currentSolveId: null,        // question ID of the current solve being lifelined
};

// ==================== CORE ====================

/**
 * Check if the lifeline should fire for the current question context.
 * PURE QUERY — does not mutate state. Call `activateLifeline()` separately
 * after a question is actually picked.
 *
 * @param {string} subject - 'physics' | 'chemistry' | 'maths'
 * @param {string} chapter - chapter name
 * @param {string} mode - 'standard' | 'flow' | 'hardcore'
 * @param {number} userElo - current subject ELO
 * @param {Array} questionBank - AppState.questionBank (for lookback check)
 * @returns {{ active: boolean, pwinMin: number|null, pwinMax: number|null, reason: string }}
 */
export function evaluateLifeline(subject, chapter, mode, userElo, questionBank) {
    // ── Step 1: CNS_LOAD check ──
    // Cross-subject MAX, same source the dismiss re-fire check and getStatus
    // use. The per-subject last reading here disagreed with them: the banner
    // could claim a lifeline was active for a subject whose own evaluation
    // said otherwise (and vice versa).
    let cnsLoad = 0;
    try {
        if (window.__cnsLoad) {
            cnsLoad = window.__cnsLoad.getMaxCnsReading();
        }
    } catch (_) {}

    // Auto-disable: if CNS_LOAD recovered mid-session, lifeline deactivates
    if (cnsLoad < LIFELINE_DISABLE_THRESHOLD) {
        _state.active = false;  // clear stale state
        return { active: false, pwinMin: null, pwinMax: null, reason: 'CNS below disable threshold', cnsLoad };
    }

    // Fire threshold not met
    if (cnsLoad < LIFELINE_FIRE_THRESHOLD) {
        return { active: false, pwinMin: null, pwinMax: null, reason: `CNS_LOAD ${Math.round(cnsLoad * 100)}% < ${Math.round(LIFELINE_FIRE_THRESHOLD * 100)}%`, cnsLoad };
    }

    // ── Step 2: Opt-out check (dismissed for this solve) ──
    if (_state.dismissedForSolve) {
        return { active: false, pwinMin: null, pwinMax: null, reason: 'Opted out for this solve', cnsLoad };
    }

    // ── Step 3: Mode offset lookup ──
    const offsets = LIFELINE_MODE_OFFSETS[mode] || LIFELINE_MODE_OFFSETS.standard;

    // ── Step 4: Lookback — chapter must have ≥3 unsolved in the easier band ──
    if (questionBank) {
        const easierQElo = _invertPwinToQElo(userElo, offsets.PwinMin);
        const unsolvedInBand = questionBank.filter(q => {
            return q && q.subject === subject && q.chapter === chapter
                && (q.status === 'unsolved' || !q.status || q.status === 'error')
                && typeof q.qElo === 'number' && isFinite(q.qElo)
                && q.qElo <= easierQElo
                && !q.isAnomaly;
        });
        if (unsolvedInBand.length < LIFELINE_LOOKBACK_MIN) {
            return { active: false, pwinMin: null, pwinMax: null, reason: `Only ${unsolvedInBand.length} easier questions available (need ≥${LIFELINE_LOOKBACK_MIN})`, cnsLoad };
        }
    }

    // ── Lifeline eligible: return offsets WITHOUT mutating state ──
    return {
        active: true,
        pwinMin: offsets.PwinMin,
        pwinMax: offsets.PwinMax,
        reason: 'Lifeline eligible',
        cnsLoad,
    };
}

/**
 * Activate the lifeline state. Call this ONLY when a question was actually
 * picked under lifeline conditions (after evaluateLifeline returned active).
 */
export function activateLifeline() {
    _state.active = true;
    _state.dismissedForSolve = false;
}

let _dismissReFireTimer = null;

/**
 * Opt out of the lifeline for the current solve only.
 * The dismissal persists for ONLY the next solve — reverts after.
 * Per spec: "The dismissal should still re-fire after 20 minutes if
 * CNS_LOAD hasn't dropped" — a setTimeout auto-resets the dismissal.
 */
export function dismissForCurrentSolve() {
    _state.dismissedForSolve = true;
    _state.active = false;
    // Clear any pending re-fire
    if (_dismissReFireTimer) { clearTimeout(_dismissReFireTimer); _dismissReFireTimer = null; }
    // Re-fire after 20 minutes per spec — re-activates the lifeline
    // if CNS_LOAD is still above threshold
    _dismissReFireTimer = setTimeout(() => {
        _state.dismissedForSolve = false;
        // Re-evaluate CNS: if still above fire threshold, re-activate
        let cnsLoad = 0;
        try { if (window.__cnsLoad) cnsLoad = window.__cnsLoad.getMaxCnsReading(); } catch (_) {}
        if (cnsLoad >= LIFELINE_FIRE_THRESHOLD) {
            _state.active = true;
        }
        _dismissReFireTimer = null;
    }, 20 * 60 * 1000);
}

/**
 * Reset dismissal — called after a solve completes so the lifeline
 * re-evaluates on the next question. Also clears the 20-min re-fire
 * timer since the dismissal was already consumed.
 */
export function resetAfterSolve() {
    _state.dismissedForSolve = false;
    if (_dismissReFireTimer) { clearTimeout(_dismissReFireTimer); _dismissReFireTimer = null; }
}

/**
 * Mark the current solve as lifeline-assisted (for telemetry tagging).
 */
export function tagCurrentSolve(questionId) {
    _state.currentSolveId = questionId;
    // Reset dismissal so next solve re-evaluates
    _state.dismissedForSolve = false;
}

/**
 * Check if a given solve was lifeline-assisted.
 */
export function isLifelineAssisted(questionId) {
    return _state.active && _state.currentSolveId === questionId;
}

/**
 * Get the lifeline ELO yield multiplier.
 */
export function getEloMultiplier() {
    return _state.active ? LIFELINE_ELO_MULTIPLIER : 1.0;
}

/**
 * Get the lifeline status for UI rendering.
 */
export function getStatus() {
    let cnsLoad = 0;
    try {
        if (window.__cnsLoad) cnsLoad = window.__cnsLoad.getMaxCnsReading();
    } catch (_) {}
    return {
        active: _state.active && !_state.dismissedForSolve && cnsLoad >= LIFELINE_FIRE_THRESHOLD,
        cnsLoad,
        dismissed: _state.dismissedForSolve,
        threshold: LIFELINE_FIRE_THRESHOLD,
    };
}

// ==================== HELPERS ====================

/**
 * Invert P_win → qElo.
 * P_win = 1 / (1 + 10^((Q - E) / 400))
 * => Q = E + 400 * log10((1 / P_win) - 1)
 */
function _invertPwinToQElo(userElo, pwin) {
    const clampedPwin = Math.max(0.01, Math.min(0.99, pwin));
    const ratio = (1 / clampedPwin) - 1;
    if (ratio <= 0) return userElo;
    return Math.round(userElo + 400 * Math.log10(ratio));
}

// ==================== PUBLIC API ====================

export const Lifeline = {
    evaluateLifeline,
    activateLifeline,
    dismissForCurrentSolve,
    resetAfterSolve,
    tagCurrentSolve,
    isLifelineAssisted,
    getEloMultiplier,
    getStatus,
    get state() { return _state; },
};

window.__lifeline = Lifeline;
