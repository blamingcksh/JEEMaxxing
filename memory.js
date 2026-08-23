/**
 * memory.js — Memory Kernel v2 (FSRS-style three-state model).
 *
 * PURE module: zero DOM / zero AppState dependencies. Everything takes plain
 * question objects so it runs identically in the browser and under Node
 * (scripts/smoke-memory-model.mjs property-tests it directly).
 *
 * WHY IT EXISTS — the legacy model treated `easeFactor` (a dimensionless SM-2
 * multiplier clamped to [1.3, 3.0]) as a stability-in-days, capping every
 * item's memory half-life at 3 days. Anything unreviewed for a week read as
 * ~0% retention regardless of true mastery. This kernel replaces that with an
 * explicit per-item memory state grounded in the modern spaced-repetition
 * literature (open-spaced-repetition FSRS; Settles & Meeder half-life
 * regression; Bjork's New Theory of Disuse):
 *
 *     Difficulty   D ∈ [1, 10]        — how hardful this item is FOR YOU
 *     Stability    S ∈ [0.5, ∞) days  — time for retrievability to hit 90%
 *     Retrievability R(t) ∈ (0, 1]    — predicted recall prob at elapsed t
 *
 * Power-law forgetting curve (matches FSRS ≥4.5 and empirical forgetting
 * data better than a pure exponential):
 *
 *     R(t, S) = (1 + FACTOR · t / S)^DECAY      DECAY=-0.5, FACTOR=19/81
 *
 * so R(S) = 0.9 exactly — S is literally "days until 90% recall".
 *
 * Desirable-difficulty growth: solving near the verge of forgetting (low R)
 * grows stability far more than solving a just-reviewed item (testing effect):
 *
 *     pass:  S' = S · (1 + G · ((11-D)/10) · S^PS · (e^(PR·(1-R)) - 1))
 *     lapse: S' = max(MIN_STABILITY, F_BASE · ((S+1)^FS - 1) · e^(FR·(1-R)) / D^FD)
 *
 * All constants live in FSRS_PARAMS and are seed values — editable, not law.
 */

export const MEMORY_MODEL_VERSION = 2;

export const FSRS_PARAMS = {
    DECAY: -0.5,          // power-law exponent
    FACTOR: 19 / 81,      // normalizer so R(S) === 0.9
    MIN_STABILITY: 0.5,   // days — post-lapse floor
    MAX_DIFFICULTY: 10,
    MIN_DIFFICULTY: 1,
    // Pass-growth parameters
    PASS_GAIN: 1.0,       // overall gain scalar
    PASS_D: 1.1,          // difficulty damping scale ((11-D)/10)
    PASS_S: -0.15,        // diminishing returns on already-stable items
    PASS_R: 0.4,          // retrievability salience (low R ⇒ big gain)
    // Lapse parameters
    FAIL_BASE: 2.5,
    FAIL_S: 0.25,
    FAIL_R: 0.3,
    FAIL_D: 0.2,
    // Difficulty walk
    D_STEP: 0.9,          // difficulty moved per unit of (3 - q)
    D_REVERT: 0.15,       // gentle mean-reversion toward D_MEAN
    D_MEAN: 4,
};

const P = FSRS_PARAMS;
const MS_PER_DAY = 86400000;

/** Safe-number coercion with fallback (NaN/undefined/corrupt tolerant). */
function _num(v, fallback) {
    const n = Number(v);
    return (typeof n === 'number' && isFinite(n)) ? n : fallback;
}

/**
 * Hydrate the memory state of a question WITHOUT mutating it.
 * Falls back per the legacy blueprint: stability from currentInterval,
 * difficulty from easeFactor, reps/lapses from historyLogs.
 * @returns {{stability:number, difficultyD:number, reps:number, lapses:number, lastMs:number}}
 */
export function hydrateMemory(q) {
    let stability = _num(q && q.stability, NaN);
    if (!(stability > 0)) {
        const interval = _num(q && q.currentInterval, 0);
        // R(interval) ≈ 0.9 by construction, so the scheduled interval IS a
        // decent stability estimate for legacy items.
        stability = Math.max(P.MIN_STABILITY, interval > 0 ? interval : P.MIN_STABILITY);
    }
    let difficultyD = _num(q && q.difficultyD, NaN);
    if (!(difficultyD >= P.MIN_DIFFICULTY && difficultyD <= P.MAX_DIFFICULTY)) {
        const ef = _num(q && q.easeFactor, 2.5);
        difficultyD = Math.min(P.MAX_DIFFICULTY, Math.max(P.MIN_DIFFICULTY, 11 - 3 * ef));
    }
    let reps = _num(q && q.reps, 0);
    let lapses = _num(q && q.lapses, 0);
    if ((!q || q.reps == null) && Array.isArray(q && q.historyLogs)) {
        reps = q.historyLogs.length;
        lapses = q.historyLogs.filter(l => l && l.result !== 'correct').length;
    }
    let lastMs = NaN;
    const lra = q && q.lastReviewedAt;
    if (lra) { const t = new Date(lra).getTime(); if (!isNaN(t)) lastMs = t; }
    if (isNaN(lastMs) && Array.isArray(q && q.historyLogs)) {
        let latest = NaN;
        for (const log of q.historyLogs) {
            if (log && log.timestamp) { const t = new Date(log.timestamp).getTime(); if (!isNaN(t) && (isNaN(latest) || t > latest)) latest = t; }
        }
        lastMs = latest;
    }
    return { stability, difficultyD, reps, lapses, lastMs };
}

/**
 * One-time backfill of the additive memory fields onto a question.
 * Legacy fields are NEVER removed or overwritten — pure additive migration.
 * @returns {boolean} true if the question was mutated (caller persists).
 */
export function backfillMemoryFields(q) {
    if (!q) return false;
    // Decide ALL needs up front, then hydrate EXACTLY ONCE from the original
    // legacy state. (Assigning fields between hydrate calls made later calls
    // see partially-migrated data — e.g. a freshly written q.reps suppressed
    // the historyLogs recount and lapses silently stayed 0.)
    const needsStability = !(typeof q.stability === 'number' && q.stability > 0);
    const needsDifficulty = !(typeof q.difficultyD === 'number' && q.difficultyD >= P.MIN_DIFFICULTY && q.difficultyD <= P.MAX_DIFFICULTY);
    const needsReps = typeof q.reps !== 'number';
    const needsLapses = typeof q.lapses !== 'number';
    if (!needsStability && !needsDifficulty && !needsReps && !needsLapses) return false;
    const mem = hydrateMemory(q);
    if (needsStability) q.stability = mem.stability;
    if (needsDifficulty) q.difficultyD = mem.difficultyD;
    if (needsReps) q.reps = mem.reps;
    if (needsLapses) q.lapses = mem.lapses;
    return true;
}

/** Power-law retrievability for an explicit stability + elapsed days. */
export function retrievabilityFrom(stability, deltaDays) {
    const s = Math.max(P.MIN_STABILITY, _num(stability, P.MIN_STABILITY));
    const t = Math.max(0, _num(deltaDays, 0));
    return Math.pow(1 + P.FACTOR * t / s, P.DECAY);
}

/** Retrievability of a question at an explicit wall-clock ms timestamp. */
export function retrievabilityAt(q, whenMs) {
    const mem = hydrateMemory(q);
    const ref = isNaN(mem.lastMs) ? _num(whenMs, Date.now()) : mem.lastMs;
    const now = _num(whenMs, Date.now());
    const deltaDays = Math.max(0, (now - ref) / MS_PER_DAY);
    return retrievabilityFrom(mem.stability, deltaDays);
}

/** Current retrievability of a question (Δt measured to Date.now()). */
export function currentRetrievability(q) {
    return retrievabilityAt(q, Date.now());
}

/**
 * Update the memory state after ONE graded review. Reads the PRE-review
 * retrievability (that's what makes low-R successes grow stability most),
 * then mutates stability / difficultyD / reps / lapses in place.
 * Does NOT touch lastReviewedAt — callers own their review-stamp timing.
 * @param {object} q       question (mutated in place)
 * @param {object} attempt { correct:boolean, performanceQ?:number [0..5] }
 * @returns {{rBefore:number, stabilityBefore:number, stabilityAfter:number}}
 */
export function updateMemoryOnReview(q, attempt) {
    if (!q) return { rBefore: 0, stabilityBefore: 0, stabilityAfter: 0 };
    const mem = hydrateMemory(q);
    const deltaDays = isNaN(mem.lastMs)
        ? 0
        : Math.max(0, (Date.now() - mem.lastMs) / MS_PER_DAY);
    const rBefore = retrievabilityFrom(mem.stability, deltaDays);
    const correct = !!(attempt && attempt.correct);
    let sNew;
    if (correct) {
        const dNorm = (11 - mem.difficultyD) / 10;                       // easy items grow more
        const dim = Math.pow(Math.max(0.35, mem.stability), P.PASS_S);   // diminishing returns
        const salient = Math.exp(P.PASS_R * (1 - rBefore)) - 1;          // low R ⇒ big gain
        sNew = mem.stability * (1 + P.PASS_GAIN * dNorm * dim * salient);
        q.reps = mem.reps + 1;
    } else {
        const dTerm = Math.pow(Math.max(1, mem.difficultyD), P.FAIL_D);
        sNew = (P.FAIL_BASE * (Math.pow(mem.stability + 1, P.FAIL_S) - 1) * Math.exp(P.FAIL_R * (1 - rBefore))) / dTerm;
        q.reps = mem.reps + 1;
        q.lapses = mem.lapses + 1;
    }
    q.stability = Math.max(P.MIN_STABILITY, sNew);

    // Difficulty walk — q comes from the SR drawer when available; the Elo
    // path passes a timing-adjusted proxy. Mean-reversion keeps extreme
    // streaks from pinning D at the rails.
    const qPerf = _num(attempt && attempt.performanceQ, correct ? 4 : 1.5);
    const dRaw = mem.difficultyD - P.D_STEP * (qPerf - 3) + P.D_REVERT * (P.D_MEAN - mem.difficultyD);
    q.difficultyD = Math.min(P.MAX_DIFFICULTY, Math.max(P.MIN_DIFFICULTY, dRaw));

    return { rBefore, stabilityBefore: mem.stability, stabilityAfter: q.stability };
}

/**
 * Post-tag difficulty refinement — called by the SR drawer once the honest
 * friction/autonomy performanceQ exists. Nudges ONLY difficulty (stability/
 * reps were already committed at the Elo moment) so no aspect double-counts.
 * @returns {number} the new difficultyD
 */
export function refineDifficultyAfterTag(q, performanceQ) {
    if (!q) return P.D_MEAN;
    const cur = _num(q.difficultyD, hydrateMemory(q).difficultyD);
    const qp = Math.min(5, Math.max(0, _num(performanceQ, 3)));
    const dRaw = cur - P.D_STEP * (qp - 3) * 0.5 + P.D_REVERT * (P.D_MEAN - cur);
    q.difficultyD = Math.min(P.MAX_DIFFICULTY, Math.max(P.MIN_DIFFICULTY, dRaw));
    return q.difficultyD;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chapter aggregation
// ─────────────────────────────────────────────────────────────────────────────

/** Item weight — qElo-weighted with a sane floor so fresh rows never zero out. */
function _itemWeight(q) {
    const e = _num(q && q.qElo, 1200);
    return Math.max(200, e);
}

/** Weighted mean retention of `items`, optionally projected `daysAhead`. */
export function weightedRetention(items, daysAhead, nowMs) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const now = _num(nowMs, Date.now());
    let wSum = 0, rSum = 0;
    for (const q of items) {
        const w = _itemWeight(q);
        rSum += w * retrievabilityAt(q, now + Math.max(0, _num(daysAhead, 0)) * MS_PER_DAY);
        wSum += w;
    }
    return wSum > 0 ? rSum / wSum : null;
}

export const RETENTION_CRITICAL = 0.80;   // "exam-ready" threshold
const MAX_FORECAST_HORIZON_DAYS = 730;

/**
 * Full chapter memory statistics for the Decay Grid v2.
 * @param {object[]} items  vault questions belonging to one chapter
 * @param {object} opts     { examDateMs?:number, nowMs?:number }
 * @returns {{count:number, health:number, forecastHealth:number|null,
 *                 criticalDays:number, weakest:{id:string,R:number}|null}|null}
 */
export function chapterMemoryStats(items, opts) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const o = opts || {};
    const health01 = weightedRetention(items, 0, o.nowMs);
    if (health01 == null) return null;

    let forecast01 = null;
    let criticalDays = health01 < RETENTION_CRITICAL ? 0 : Infinity;
    if (typeof o.examDateMs === 'number' && isFinite(o.examDateMs)) {
        const now = _num(o.nowMs, Date.now());
        const daysToExam = Math.max(0, (o.examDateMs - now) / MS_PER_DAY);
        forecast01 = weightedRetention(items, daysToExam, o.nowMs);
    }
    // Days until weighted retention crosses the critical line: binary search
    // over a monotone-decreasing curve — closed form is awkward with mixed
    // stabilities, and 40 probes give sub-day precision over a 2y horizon.
    if (criticalDays === Infinity) {
        let lo = 0, hi = MAX_FORECAST_HORIZON_DAYS;
        if (weightedRetention(items, hi, o.nowMs) >= RETENTION_CRITICAL) {
            criticalDays = Infinity; // rock solid beyond horizon
        } else {
            for (let i = 0; i < 40; i++) {
                const mid = (lo + hi) / 2;
                if (weightedRetention(items, mid, o.nowMs) < RETENTION_CRITICAL) hi = mid; else lo = mid;
            }
            criticalDays = hi;
        }
    }
    let weakest = null;
    const now = _num(o.nowMs, Date.now());
    for (const q of items) {
        const R = retrievabilityAt(q, now);
        if (!weakest || R < weakest.R) weakest = { id: String(q.id), R };
    }
    return {
        count: items.length,
        health: health01 * 100,
        forecastHealth: forecast01 == null ? null : forecast01 * 100,
        criticalDays,
        weakest,
    };
}