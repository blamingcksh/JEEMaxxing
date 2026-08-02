/**
 * storage.js — Data persistence, IndexedDB, cloud sync, and shared mutable state.
 *
 * Cross-module imports (resolved when other modules are extracted):
 *   - lockTargetsOnly  → from settings.js (or ui.js)
 *   - updateUI         → from ui.js
 *   - updateStudyTimeHeader → from ui.js
 *   - renderGraph      → from ui.js
 *   - renderErrorMatrixFromBank → from ui.js
 *
 * These are imported lazily via getUiCallbacks() so the module can be
 * unit-tested without the full DOM graph present.
 */

// ---------------------------------------------------------------------------
//  Lazy UI-callback bridge — set from app.js during bootstrap
// ---------------------------------------------------------------------------
let _uiCallbacks = {};

/** Called once by app.js to inject UI functions that storage depends on. */
export function registerUiCallbacks(callbacks) {
    _uiCallbacks = callbacks;
}

function _ui(fnName, ...args) {
    if (typeof _uiCallbacks[fnName] === 'function') return _uiCallbacks[fnName](...args);
}

// ==================== INDEXEDDB STORAGE LAYER ====================
export const DB_NAME = 'jeemaxxing_db';
export const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('storage')) {
                db.createObjectStore('storage', { keyPath: 'key' });
            }
        };
    });
    return dbPromise;
}

export async function idbSet(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('storage', 'readwrite');
        const store = tx.objectStore('storage');
        store.put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function idbGet(key) {
    const db = await openDB();
    const tx = db.transaction('storage', 'readonly');
    const store = tx.objectStore('storage');
    const request = store.get(key);
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result ? request.result.value : null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Read many keys in ONE readwrite-free transaction. iPad Safari pays a fixed
 * per-transaction cost, so collapsing the ~20 boot reads into a single
 * transaction cuts cold-start time substantially.
 */
export async function idbGetMany(keys) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('storage', 'readonly');
        const store = tx.objectStore('storage');
        const out = {};
        for (const key of keys) {
            const req = store.get(key);
            req.onsuccess = () => { out[key] = req.result ? req.result.value : null; };
        }
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Write many records in ONE readwrite transaction (single commit). The old
 * per-key await sequence opened a fresh transaction per key on every save —
 * on iPad that serializes ~15 commits per solve / pomodoro tick.
 */
export async function idbSetMany(entries) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('storage', 'readwrite');
        const store = tx.objectStore('storage');
        for (const [key, value] of entries) store.put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('idbSetMany aborted'));
    });
}

export async function idbRemove(key) {
    const db = await openDB();
    const tx = db.transaction('storage', 'readwrite');
    const store = tx.objectStore('storage');
    store.delete(key);
    await tx.complete;
}

export async function idbClear() {
    const db = await openDB();
    const tx = db.transaction('storage', 'readwrite');
    const store = tx.objectStore('storage');
    store.clear();
    await tx.complete;
}

// ==================== IMAGE VAULT (persistent, unbounded) ====================
// Every uploaded image is kept FOREVER — nothing is evicted or stashed. The
// bank itself persists lightweight (imageDataUrl / diagramImageUrl stripped)
// so saveAllAsync() stays a small text-only write; images live in this vault
// keyed by question id and are re-attached to the bank on load. Lag from many
// images is handled at RENDER time instead: cards draw a tiny placeholder and
// swap in the real base64 only when the card nears the viewport (see
// initErrorLazyLoaders / initPracticeLazyLoaders), so the DOM never embeds
// hundreds of blobs at once.
export const IMAGE_CACHE_KEY = 'jeemax_image_cache';

let _imageCache = {};                                   // qid -> { imageDataUrl, diagramImageUrl, ts }
let _imageCachePersistedSig = '';
let _imageCacheLoaded = false;                          // cold-boot IDB read happens once/session

function _imgSample(data) {
    // Tiny fingerprint sample (cheap — never copies the whole base64 payload).
    if (typeof data !== 'string' || data.length === 0) return '';
    return data.length + ':' + data.slice(0, 24) + data.slice(-24);
}

function _imageCacheSignature(cache) {
    const ids = Object.keys(cache).sort();
    let sig = ids.length + '|';
    for (const id of ids) {
        sig += id + '=' + _imgSample(cache[id].imageDataUrl) + '/' + _imgSample(cache[id].diagramImageUrl) + ';';
    }
    return sig;
}

function _collectImageCacheFromBank() {
    const cache = {};
    const now = Date.now();
    for (const q of AppState.questionBank) {
        if (!q || q.id == null) continue;
        const id = String(q.id);
        const img = (q.imageDataUrl && q.imageDataUrl.length > 100) ? q.imageDataUrl : null;
        const diag = (q.diagramImageUrl && q.diagramImageUrl.length > 100) ? q.diagramImageUrl : null;
        if (!img && !diag) continue;
        const prev = _imageCache[id];
        // Keep the previous timestamp when content is unchanged (prevents
        // recency churn from the constant saves).
        const ts = (prev && prev.imageDataUrl === img && prev.diagramImageUrl === diag) ? prev.ts : now;
        cache[id] = { imageDataUrl: img, diagramImageUrl: diag, ts };
    }
    return cache;
}

/**
 * Persist the image vault. Cheap no-op on the hot save path when contents are
 * unchanged (signature compare — no base64 serialization).
 */
export async function persistImageCacheIfChanged() {
    const cache = _collectImageCacheFromBank();
    const sig = _imageCacheSignature(cache);
    if (sig === _imageCachePersistedSig) return;
    // Write FIRST, then advance the persisted-signature — if the write fails
    // (quota exceeded / private mode), the sig stays stale so the next save
    // retries instead of silently dropping the cache update.
    await idbSet(IMAGE_CACHE_KEY, cache);
    _imageCachePersistedSig = sig;
    _imageCache = cache;
}

/**
 * Load the image cache from IndexedDB and re-attach cached images onto the
 * live bank so rendering stays instant without a Drive round-trip.
 */
export async function hydrateImageCache() {
    // In-session the in-memory cache mirror is always current (saveAllAsync
    // updates it on every persist), so we skip the (up to ~60MB) IndexedDB
    // re-read on every tab switch — it only happens on cold boot.
    if (!_imageCacheLoaded) {
        try {
            const cached = await idbGet(IMAGE_CACHE_KEY);
            _imageCache = (cached && typeof cached === 'object') ? cached : {};
        } catch (_) {
            _imageCache = {};
        }
        _imageCacheLoaded = true;
        _imageCachePersistedSig = _imageCacheSignature(_imageCache);
    }
    for (const q of AppState.questionBank) {
        if (!q || q.id == null) continue;
        const e = _imageCache[String(q.id)];
        if (!e) continue;
        // Never clobber a fresh image fetched in-session with older cache data.
        if (!q.imageDataUrl && e.imageDataUrl) q.imageDataUrl = e.imageDataUrl;
        if (!q.diagramImageUrl && e.diagramImageUrl) q.diagramImageUrl = e.diagramImageUrl;
    }
}

// ==================== GLOBAL STATE ====================
export const AppState = {
    // User-specified reactive states
    currentSubject: 'physics',
    currentChapter: '',
    currentChapterQuestions: [],
    practiceQuestions: [],
    currentPracticeIndex: 0,
    practiceSeconds: 0,
    selectedMcq: null,
    currentQ: null,
    pendingWrongQ: null,
    photoHidden: false,
    practiceSubmittedFlags: [],
    currentFilter: 'all',
    bountyMode: false,
    profilePicData: null,
    newErrorPicData: null,
    moodMultiplier: 1.0,
    currentErrorSubject: 'physics',
    calMonthOffset: 0,
    geminiApiKey: '',
    practiceCorrectStreak: 0,
    extractedItems: [],
    practiceFlowMode: 'standard',
    hardcoreDailyCount: 0,
    hardcoreDailyDate: null,
    // Additional cross-module mutable state
    questionBank: [],
    practiceTimer: null,
    chapters: { physics: ["Kinematics", "Thermodynamics"], chemistry: ["Mole Concept"], maths: ["Calculus"] },
    bounty: {
        date: null,
        questionId: null,
        timeLimit: 0,
        active: false,
        payoffCount: 0,
        done: false
    },
    activeTargets: { physics: 10, chemistry: 10, maths: 10 },
    driveAccessToken: null,
    cloudFolderId: null,
    tokenClient: undefined,
    imageFetchCache: {},
    cropState: {
        currentBase64: null,
        questions: [],
        resolve: null,
        canvas: null,
        ctx: null,
        imageElement: null,
        startX: 0,
        startY: 0,
        drawing: false,
        rect: null,
        isDiagramCrop: false
    },
    visualMode: 'bar',
    // ── Error Matrix: active practice log drawer state ──
    activePracticeDrawerId: null,
    // ── Cognitive MMR / Elo Matrix ──
    // Subject-segregated, uncapped matchmaking ratings with a consolidated
    // global meta-MMR. Foundational baseline = 1200 for every axis. These are
    // hydrated instantly in loadDataAsync() with protective fallback defaults
    // so a missing/corrupt profile never produces data gaps.
    elo: {
        physics: 1200,
        chemistry: 1200,
        maths: 1200,
        global: 1200,
    },
};


export const baseTargets = { physics: 10, chemistry: 10, maths: 10 };
export const baseErrorTargets = { physics: 5, chemistry: 5, maths: 5 };
export const solved = { physics: 0, chemistry: 0, maths: 0 };
export const studySecs = { physics: 0, chemistry: 0, maths: 0 };
// Single source of truth for the "day" boundary: LOCAL calendar date
// (YYYY-MM-DD). All daily counters, cloud payloads and history keys must use
// this so counters reset at local midnight, not UTC midnight.
export function todayLocalKey(date) {
    return (date || new Date()).toLocaleDateString('en-CA');
}
export const monthNamesCal = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

// Core data mutation: increment/decrement solved counter for a subject
// Core data mutation: increment/decrement solved counter for a subject
export function changeCount(subject, delta) {
    solved[subject] = Math.max(0, solved[subject] + delta);
    saveAllAsync().catch(console.error);
    
    // ⚡ INSTANT DASHBOARD HOT-RELOAD: Push data updates live to the UI without forcing a page refresh
    _ui('updateUI');
    _ui('updateStudyTimeHeader');
    _ui('renderGraph');
    _ui('renderErrorMatrixFromBank');
}

// ==================== SPACED REPETITION ENGINE ====================
// Multi-variable SM-2 variant for JEEMaxxing Error Matrix.

export const SR_FRICTION_WEIGHTS = {
    PERFECT:  1.20,
    CALC:     0.85,
    FORMULA:  0.60,
    CONCEPT:  0.35,
    APPROACH: 0.15,
};

export const SR_FRICTION_LABELS = {
    PERFECT:  'Perfect Execution',
    CALC:     'Calculation Error',
    FORMULA:  'Formula / Property Lapse',
    CONCEPT:  'Conceptual Gap',
    APPROACH: 'Application / Approach Blank',
};

export const SR_AUTONOMY_SCORES = {
    independent:   1.0,
    hint_used:     0.5,
    solution_read: 0.0,
};

export const SR_FRICTION_TYPES = ['PERFECT', 'CALC', 'FORMULA', 'CONCEPT', 'APPROACH'];

// ─────────────────────────────────────────────────────────────────────────────
// Cognitive MMR / qElo band system
// ─────────────────────────────────────────────────────────────────────────────
// 7-band implied-difficulty rating grid (universal across physics / chemistry / maths).
// The grid is calibrated against JEEMaxxing's existing anchor points:
//   • forest-juice.js:378 — easy=1000, medium=1600, hard=2500 (±70 noise)
//   • app.js — dark oak is a ~10% per-solved-question roll (q.oak stamped at solve)
//   • storage.js:~352 — global qElo fallback = 1200 (used as the chapter
//     baseline when no chapter history exists)
//   • app.js:3555 — auto-quarantine (isAnomaly) when |newQ − chapterAvg| > 600

export const ELO_BANDS = {
    T1_FOUNDATION:   [800, 1099],
    T2_CORE_MAINS:   [1100, 1299],
    T3_STD_MAINS:    [1300, 1549],
    T4_ADV_EASY:     [1550, 1799],
    T5_PAPER_ADV:    [1800, 2099],
    T6_ELITE:        [2100, 2299],
    T7_OLYMP:        [2300, 2550],
};

export const BAND_TARGET_TIME = { T1: 2, T2: 3, T3: 5, T4: 7, T5: 9, T6: 11, T7: 15 };

/**
 * Lookup the band key for an integer qElo. Returns 'T1_FOUNDATION' .. 'T7_OLYMP'
 * or null if the value falls outside the calibrated grid.
 */
export function getEloBand(qElo) {
    if (typeof qElo !== 'number' || !isFinite(qElo)) return null;
    if (qElo < ELO_BANDS.T1_FOUNDATION[0]) return null;
    if (qElo <= ELO_BANDS.T1_FOUNDATION[1]) return 'T1_FOUNDATION';
    if (qElo <= ELO_BANDS.T2_CORE_MAINS[1])   return 'T2_CORE_MAINS';
    if (qElo <= ELO_BANDS.T3_STD_MAINS[1])    return 'T3_STD_MAINS';
    if (qElo <= ELO_BANDS.T4_ADV_EASY[1])     return 'T4_ADV_EASY';
    if (qElo <= ELO_BANDS.T5_PAPER_ADV[1])   return 'T5_PAPER_ADV';
    if (qElo <= ELO_BANDS.T6_ELITE[1])        return 'T6_ELITE';
    if (qElo <= ELO_BANDS.T7_OLYMP[1])        return 'T7_OLYMP';
    return null; // above ceiling — out of calibration
}

/**
 * Tune constants for the delta-based ELO reward branch (app.js
 * calculateEloMigration). These fire when the question's qElo is already
 * trusted — either because Gemini stamped it during ingestion
 * (qEloSource === 'gem-stamped') or because the engine has accumulated enough
 * solves to consider it calibrated (qEloSource === 'learned' and
 * solveCount ≥ CALIBRATED_SOLVE_THRESHOLD).
 *
 *   K_user  = the standard chess-style K-factor for the subject ELO update.
 *   K_q     = tiny K-factor for the question qElo drift (we trust the stamp,
 *             so drift is intentionally tiny).
 *   STINGINESS_MULT = extra penalty on misfires (underdog upset only).
 *
 * The math is the canonical ELO update:
 *   rawSubjectDelta = K_user · (S − P_win) · timeMult   (S=1 for correct, 0 for wrong)
 *   qEloDrift      = K_q     · ((1 − S) − P_q_win)      (question also moves)
 * where P_win = 1 / (1 + 10^((Q − E) / 400)) is the user's expected win prob.
 * This naturally rewards upsets (low E beats high Q) and stingily rewards
 * favourites (high E beats low Q) without ad-hoc piecewise multipliers.
 */
export const ELO_GEM_STAMP_TUNING = {
    K_user: 32,                 // Subject ELO swing per solve
    K_q: 6,                     // qElo drift per solve (small — trust the stamp)
    misfireExtraMult: 1.4,      // Extra penalty on wrong solves on easier-than-you questions
    timeMin: 0.5,               // τ lower clamp
    physicsTauBuffer: 0.85,     // Mirror app.js legacy physics calculation buffer
    chemistrySlowThreshold: 1.25,
    chemistrySlowPenalty: 0.4,
    ceiling: 2999.99,           // Hard cap on subject ELO (matches existing cap)
};

/** Number of solves required before a legacy/uncalibrated qElo is trusted. */
export const CALIBRATED_SOLVE_THRESHOLD = 1;

// Per-chapter Practice Modes: Flow State vs Hardcore / Overclock
export const PRACTICE_MODES = ['standard', 'flow', 'hardcore'];

/**
 * Mode tuning constants. Drive BOTH:
 *   1. The picker's P_win window filter (which problems the mode surfaces)
 *   2. The reward deltas during calculateEloMigration (mode multipliers
 *      on the subject-ELO delta, on the escrow/legendary bonus, and on
 *      the time-curve inflection points).
 *
 * P_win math: P_win = 1 / (1 + 10^((Q − E) / 400))
 *   • Flow     Pwin 0.75 → 0.85  ≈ qElo in [userElo+50,  userElo+120]
 *   • Hardcore Pwin 0.35 → 0.50  ≈ qElo in [userElo+300, userElo+500]
 */
export const MODE_TUNING = {
    standard: {
        winsMultiplier: 1.0,
        lossMultiplier: 1.0,
        escrowBonusMultiplier: 1.0,
        winSweetSpot: 0.8,
        lossFastGrace: 0.5,
    },
    flow: {
        PwinMin: 0.75, PwinMax: 0.85,
        PwinFallbackMin: 0.65, PwinFallbackMax: 0.90,
        winsMultiplier: 1.0,
        lossMultiplier: 1.0,
        escrowBonusMultiplier: 1.0,
        winSweetSpot: 0.6,            // gentle fast bonus zone
        lossFastGrace: 0.5,
        label: '🎯 FLOW STATE',
    },
    hardcore: {
        PwinMin: 0.35, PwinMax: 0.50,
        PwinFallbackMin: 0.20, PwinFallbackMax: 0.65,
        minQeloFloor: 1800,
        winsMultiplier: 1.8,            // 1.8× subject-ELO payout on win
        lossMultiplier: 0.6,            // sympathy multiplier on underdog misfire
        escrowBonusMultiplier: 2.0,    // doubled legendary drop rate
        winSweetSpot: 0.45,
        lossFastGrace: 0.3,
        capPerDay: 8,                    // anti-grind circuit-breaker
        label: '⚡ HARDCORE / OVERCLOCK',
    },
};

/**
 * Step 1 — Friction Severity Weight (Wf)
 * Uses the worst (lowest) friction weight among selections.
 */
export function calculateFrictionWeight(frictionTypes) {
    if (!frictionTypes || frictionTypes.length === 0) return 0.60;
    const weights = frictionTypes.map(f => SR_FRICTION_WEIGHTS[f] ?? 0.60);
    return Math.min(...weights);
}

/**
 * Step 2 — Performance Quality (q), clamped [0.0, 5.0]
 *
 * q = (A × 3.0) + max(0.0, 2.0 − Rt)
 *   A  = autonomy score
 *   Rt = timeSpentMins / targetTimeMins
 */
export function calculatePerformanceQ(autonomy, timeSpentMins, targetTimeMins) {
    const A  = SR_AUTONOMY_SCORES[autonomy] ?? 0.5;
    const Rt = targetTimeMins > 0 ? timeSpentMins / targetTimeMins : 1.0;
    const q  = (A * 3.0) + Math.max(0.0, 2.0 - Rt);
    return Math.min(5.0, Math.max(0.0, q));
}

/**
 * Step 3 — Update Ease Factor (EF)
 *
 * EF_new = EF_current + (0.1 − (5.0 − q) × (0.08 + (5.0 − q) × 0.02))
 * Floor: max(1.3, EF_new)
 */
export function calculateNewEaseFactor(currentEF, performanceQ) {
    const qGap      = 5.0 - performanceQ;
    const adjustment = 0.1 - qGap * (0.08 + qGap * 0.02);
    const newEF     = currentEF + adjustment;
    return Math.max(1.3, newEF);
}

/**
 * Step 4 — Compute Next Interval (I_next)
 *
 * Correct:
 *   I_current == 0 → 1 day
 *   I_current == 1 → 3 days
 *   else           → ceil(I_current × EF_new × Wf)
 *
 * Incorrect:
 *   max(1, floor(I_current × Wf))
 */
export function calculateNextInterval(currentInterval, result, newEaseFactor, frictionWeight) {
    if (result === 'correct') {
        if (currentInterval === 0) return 1;
        if (currentInterval === 1) return 3;
        return Math.ceil(currentInterval * newEaseFactor * frictionWeight);
    } else {
        return Math.max(1, Math.floor(currentInterval * frictionWeight));
    }
}

/**
 * Master pipeline — runs all 4 SR steps and returns computed values.
 *
 * @param {Object} question  — question object from AppState.questionBank
 * @param {Object} attempt   — { result, autonomy, frictionTypes[], timeSpentMins }
 * @returns {{ newInterval, newEaseFactor, performanceQ, frictionWeight, nextReviewAt, isMastered }}
 */
export function computeSR(question, attempt) {
    const currentInterval = question.currentInterval ?? 0;
    const currentEF       = question.easeFactor ?? 2.5;
    const targetTime      = question.targetTimeMins ?? 5;

    const Wf = calculateFrictionWeight(attempt.frictionTypes);
    const q  = calculatePerformanceQ(attempt.autonomy, attempt.timeSpentMins, targetTime);
    const EF = calculateNewEaseFactor(currentEF, q);
    const In = calculateNextInterval(currentInterval, attempt.result, EF, Wf);

    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + In);

    const isMastered = In > 30 && EF > 2.5 && attempt.result === 'correct';

    return {
        newInterval:     In,
        newEaseFactor:   Math.round(EF * 1000) / 1000,
        performanceQ:    Math.round(q * 100) / 100,
        frictionWeight:  Wf,
        nextReviewAt:    nextReviewAt.toISOString(),
        isMastered,
    };
}

/**
 * Derive a human-readable due status from a question's SR state.
 *
 * Returns: { status: 'ready'|'due_soon'|'scheduled'|'mastered', label: string, daysUntil: number }
 */
export function getDueStatus(question) {
    if (question.isMastered) {
        return { status: 'mastered', label: '💤 Mastered', daysUntil: Infinity };
    }

    const next = new Date(question.nextReviewAt || question.createdAt || Date.now());
    const now  = new Date();
    const diffMs = next.getTime() - now.getTime();
    const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (daysUntil <= 0) {
        return { status: 'ready', label: '🟢 Ready', daysUntil: 0 };
    }
    if (daysUntil <= 3) {
        return { status: 'due_soon', label: `⏳ Due in ${daysUntil}d`, daysUntil };
    }
    return { status: 'scheduled', label: `📅 Due in ${daysUntil}d`, daysUntil };
}

/**
 * Format a Date for tooltip display.
 */
export function formatSRDate(isoString) {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

/**
 * One-time migration: backfill SR fields onto every question in the bank
 * that doesn't have them yet.  Call once from initApp().
 */
export function migrateQuestionBankSR() {
    let dirty = false;
    for (const q of AppState.questionBank) {
        if (q.currentInterval === undefined) { q.currentInterval = 0; dirty = true; }
        if (q.easeFactor      === undefined) { q.easeFactor      = 2.5; dirty = true; }
        if (q.targetTimeMins  === undefined) { q.targetTimeMins  = 5;   dirty = true; }
        if (q.isMastered      === undefined) { q.isMastered      = false; dirty = true; }
        if (!q.nextReviewAt)  { q.nextReviewAt = new Date().toISOString(); dirty = true; }
        if (!Array.isArray(q.historyLogs)) { q.historyLogs = []; dirty = true; }
        // ── Bound text-bloat: keep only the most recent attempt logs per
        // question (the UI renders the last 5 dots / reversed list anyway). ──
        if (q.historyLogs.length > 30) { q.historyLogs = q.historyLogs.slice(-30); dirty = true; }
        // ── Cognitive MMR: backfill the dynamic question difficulty rating
        // (qElo = Implied Difficulty Rating). Legacy questions default to
        // 1200; the engine retro-mutates this toward its true implied
        // difficulty on every subsequent attempt. isAnomaly flags questions
        // whose qElo shoots >600 pts past their chapter baseline so they are
        // dropped from normal Elo iteration filters. ──
        if (q.qElo === undefined || q.qElo === null) { q.qElo = 1200; dirty = true; }
        if (q.isAnomaly === undefined) { q.isAnomaly = false; dirty = true; }
        // ── NEW (pre-ELO schema, post-Cognitive MMR): provenance tracking.
        // qEloSource tells calculateEloMigration whether to use the legacy
        // R_perf warmup formula (uncalibrated) or the new delta-based reward
        // (gem-stamped | learned). solveCount flips an 'uncalibrated' question
        // to 'learned' once it crosses CALIBRATED_SOLVE_THRESHOLD solves —
        // the existing R_perf migration has produced enough signal at that
        // point that we can trust qElo and switch to the calibrated branch.
        if (q.qEloSource  === undefined) { q.qEloSource   = 'uncalibrated'; dirty = true; }
        if (q.qEloStampedBy === undefined) { q.qEloStampedBy = null; dirty = true; }
        if (q.qEloStampedAt === undefined) { q.qEloStampedAt = null; dirty = true; }
        if (typeof q.solveCount !== 'number') { q.solveCount = 0; dirty = true; }
        if (q.lastSolvedAt === undefined) { q.lastSolvedAt = null; dirty = true; }
        // Anti-cheat flags populated by processGemTextDump on ingest.
        if (q.stampBatchSuspiciousDistribution === undefined) { q.stampBatchSuspiciousDistribution = false; dirty = true; }
        if (q.stampBatchSuspiciousStdev === undefined) { q.stampBatchSuspiciousStdev = false; dirty = true; }
        // Carry over the canonical tags field so qElo picker can filter later.
        if (!Array.isArray(q.tags)) { q.tags = []; dirty = true; }
    }
    if (dirty) saveAllAsync().catch(console.error);
}

// ==================== CLOUD INFRASTRUCTURE (G-DRIVE) ====================
export const MODEL_FALLBACK = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"];
export const CLIENT_ID = '463564668669-2vplpgdd8li1kn47f65f1d0t1q3bb57p.apps.googleusercontent.com';
export const SCOPES = 'https://www.googleapis.com/auth/drive.file';

let syncIntervalId = null;

export function waitForDriveToken(callback) {
    if (AppState.driveAccessToken) {
        callback();
    } else {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if (AppState.driveAccessToken) {
                clearInterval(interval);
                callback();
            } else if (attempts > 20) {
                clearInterval(interval);
                console.warn('Drive token never arrived – lazy loading aborted');
            }
        }, 500);
    }
}

export function handleDriveAuth() {
    AppState.tokenClient.requestAccessToken({ prompt: 'consent' });
}

export async function handleAuthExpiry() {
    await idbRemove('jeemax_drive_token');
    AppState.driveAccessToken = null;
    AppState.cloudFolderId = null;

    document.getElementById('btn-drive-auth').style.display = 'inline-block';
    document.getElementById('drive-status').style.display = 'none';

    const subText = document.getElementById('sync-sub-text');
    if (subText) {
        subText.textContent = "Session Expired. Reconnect Drive.";
        subText.style.color = "var(--glow-red)";
    }
    hideLoading();
}

// ==================== UTILITY FUNCTIONS ====================
export function cleanAndParseJson(rawText) {
    let sanitized = rawText.replace(/```json|```/g, '').trim();
    try { return JSON.parse(sanitized); } catch (initialError) {
        try {
            let multiEscaped = sanitized.replace(/\\([^"\\\/bfnrtu])/g, '\\\\$1');
            return JSON.parse(multiEscaped);
        } catch (secondaryError) {
            throw new Error("Unable to parse JSON: " + secondaryError.message);
        }
    }
}

export async function callGeminiWithFallback(apiKey, prompt, imageBase64Data, mimeType, statusCallback, isJson) {
    let lastError = null;
    for (let model of MODEL_FALLBACK) {
        try {
            if (statusCallback) statusCallback(`Trying model: ${model}...`);
            const parts = [{ text: prompt }];
            if (imageBase64Data && mimeType) parts.push({ inline_data: { mime_type: mimeType,
                    data: imageBase64Data.split(',')[1] } });
            const payload = { contents: [{ parts }] };
            if (isJson) payload.generationConfig = { responseMimeType: "application/json",
                temperature: 0.0 };
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(`${model} failed (${response.status})`);
            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error(`${model} returned empty response`);
            if (statusCallback) statusCallback(`✅ Used model: ${model}`);
            return { text, model };
        } catch (err) { lastError = err; if (statusCallback) statusCallback(
                `⚠️ ${model} failed, trying next...`); }
    }
    throw new Error(`All models failed. Last error: ${lastError?.message}`);
}

export async function cropImageFromBBox(originalDataUrl, bbox) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const width = img.width, height = img.height;
            const x = bbox.x * width, y = bbox.y * height,
                  w = bbox.w * width, h = bbox.h * height;
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
            resolve(canvas.toDataURL('image/png'));
        };
        img.src = originalDataUrl;
    });
}

let loadingTimeout = null;

export function showLoading(msg) {
    document.getElementById('loading-text').innerText = msg;
    document.getElementById('loading-overlay').classList.add('active');
    clearTimeout(loadingTimeout);
    loadingTimeout = setTimeout(() => {
        console.warn('⚠️ Loading overlay auto-hidden after 10s (possible hang)');
        hideLoading();
    }, 10000);
}

export function hideLoading() {
    clearTimeout(loadingTimeout);
    document.getElementById('loading-overlay').classList.remove('active');
}

export function readFileAsBase64(file) {
    return new Promise((resolve, reject) => { let r = new FileReader();
        r.onload = e => resolve(e.target.result);
        r.onerror = reject;
        r.readAsDataURL(file); });
}

export function escapeHtml(str) { return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]); }

export function escapeAttribute(str) {
  return str.replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
}

export function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

export function formatStudyDuration(totalSecs) {
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

// ==================== DATA PERSISTENCE ====================
export async function saveAllAsync() {
    // Persist the bank WITHOUT inline images (kept in the bounded image cache)
    // so every save is a small text-only payload — this was the intent of
    // `lightweightBank`; the previous code saved the image-laden bank instead,
    // which serialized megabytes of base64 on every solve / pomodoro tick.
    const lightweightBank = AppState.questionBank.map(q => ({
        ...q,
        imageDataUrl: null,
        diagramImageUrl: null
    }));

    // ── Single-transaction commit: ~15 sequential IDB transactions used to
    //    fire per save; now one commit. The image vault is signature-gated
    //    separately below (only rewrites when an image actually changed). ──
    const entries = [];
    entries.push(['jeemax_question_bank', lightweightBank]);
    entries.push(['jeemax_chapters', AppState.chapters]);
    entries.push(['jeemax_solved', solved]);
    entries.push(['jeemax_study_secs', studySecs]);
    entries.push(['jeemax_bounty', AppState.bounty]);
    entries.push(['jeemax_mood_multiplier', AppState.moodMultiplier]);
    // ── Hydrate Cognitive MMR / Elo Matrix (subject + global meta-MMR) ──
    entries.push(['jeemax_elo', {
        physics:   AppState.elo.physics   ?? 1200,
        chemistry: AppState.elo.chemistry ?? 1200,
        maths:     AppState.elo.maths     ?? 1200,
        global:    AppState.elo.global    ?? 1200,
    }]);
    // Practice mode + hardcore daily counter persistence
    entries.push(['jeemax_practice_mode', AppState.practiceFlowMode || 'standard']);
    entries.push(['jeemax_hardcore_daily', {
        date: AppState.hardcoreDailyDate,
        count: AppState.hardcoreDailyCount || 0,
    }]);
    entries.push(['jeemax_username', document.getElementById('display-username').textContent]);
    entries.push(['bounty_data', AppState.bounty]);

    // Persist error resolution targets under separate keys
    entries.push(['baseErrPhys', baseErrorTargets.physics]);
    entries.push(['baseErrChem', baseErrorTargets.chemistry]);
    entries.push(['baseErrMath', baseErrorTargets.maths]);

    if (AppState.profilePicData) {
        entries.push(['jeemax_profile_pic', AppState.profilePicData]);
    }

    await idbSetMany(entries);

    // Only touch the image vault when its signature actually changed.
    await persistImageCacheIfChanged();
    await updateDailyHistory();

    // ── Bump the app-wide "data changed" counter so memoized derivations
    //    (nav rings / badges) can invalidate instantly instead of polling. ──
    try { window.__jmaxDataDirty = (window.__jmaxDataDirty || 0) + 1; } catch (_) {}

    if (typeof AppState.driveAccessToken !== 'undefined' && AppState.driveAccessToken) {
        syncStateToCloud();
    }
}

/**
 * One-time defensive repair for banked questions that can never be valid
 * as stored (legacy ingestion bugs):
 *   1. type 'mcq' with NO options — an impossible state. The old parser
 *      comma-split free-text answers ("(a) ..., (b)(i) ...") into arrays and
 *      forced type='mcq', which rendered a "Reveal Answer" button while
 *      practiceSubmit demanded an option selection. Downgrade to 'text' so
 *      every flow (practice modal, matrix drawer, checkpoint) treats them as
 *      self-report instead of blocking on a selection that can't exist.
 *   2. Array answers with NO options — arrays only mean anything for
 *      multi-correct MCQs (which always carry options). Collapse back to a
 *      single joined string so checkpoint's getQuestionMode can't take the
 *      'multi' branch with zero options to render.
 * Type values are also lower-cased so exotic casing ("MCQ", "Text") can never
 * bypass the canonical 'mcq'/'numeric'/'text' checks.
 *
 * Idempotent and non-destructive: valid questions (mcq+options, arrays with
 * options, numeric, subjective, etc.) are never touched. Runs at every cold
 * load; the repaired shape persists on the next save.
 */
function _repairQuestionBank() {
    const bank = AppState.questionBank;
    if (!Array.isArray(bank)) return;
    for (const q of bank) {
        if (!q || typeof q !== 'object') continue;
        if (typeof q.type === 'string') q.type = q.type.trim().toLowerCase();
        const noOptions = !Array.isArray(q.options) || q.options.length === 0;
        if (q.type === 'mcq' && noOptions) q.type = 'text';
        if (Array.isArray(q.correctAnswer) && q.correctAnswer.length > 0 && noOptions) {
            q.correctAnswer = q.correctAnswer.join(', ');
        }
    }
}

export async function loadDataAsync() {
    // ── Single-transaction cold boot: ~20 sequential IDB reads used to run
    //    one after another; now they resolve in one transaction. ──
    const g = await idbGetMany([
        'jeemax_question_bank', 'jeemax_chapters', 'bounty_data',
        'jeemax_solved', 'jeemax_study_secs', 'jeemax_mood_multiplier',
        'jeemax_elo', 'jeemax_practice_mode', 'jeemax_hardcore_daily',
        'jeemax_username', 'jeemax_profile_pic', 'gemini_api_key',
        'jeeTargetLockDate', 'basePhys', 'baseChem', 'baseMath',
        'baseErrPhys', 'baseErrChem', 'baseErrMath',
    ]);
    const bank = g['jeemax_question_bank'];
    const ch = g['jeemax_chapters'];
    const savedBounty = g['bounty_data'];
    const s = g['jeemax_solved'];
    const secs = g['jeemax_study_secs'];
    const mood = g['jeemax_mood_multiplier'];
    const savedElo = g['jeemax_elo'];
    const savedMode = g['jeemax_practice_mode'];
    const hcDaily = g['jeemax_hardcore_daily'];
    const username = g['jeemax_username'];
    const pfp = g['jeemax_profile_pic'];
    const savedKey = g['gemini_api_key'];
    const lockDate = g['jeeTargetLockDate'];
    const basePhys = g['basePhys'];
    const baseChem = g['baseChem'];
    const baseMath = g['baseMath'];
    const errPhys = g['baseErrPhys'];
    const errChem = g['baseErrChem'];
    const errMath = g['baseErrMath'];

    if (bank) AppState.questionBank = bank;
    _repairQuestionBank();

    // Re-attach cached images (bounded LRU cache) onto the live bank.
    await hydrateImageCache();

    if (ch) AppState.chapters = ch;

    if (savedBounty) {
        AppState.bounty.date = savedBounty.date;
        AppState.bounty.active = savedBounty.active;
        AppState.bounty.questionId = savedBounty.questionId;
        AppState.bounty.timeLimit = savedBounty.timeLimit;
        AppState.bounty.payoffCount = savedBounty.payoffCount;
        AppState.bounty.done = savedBounty.done;
    }

    if (s) {
        solved.physics = s.physics || 0;
        solved.chemistry = s.chemistry || 0;
        solved.maths = s.maths || 0;
    }

    if (secs) {
        studySecs.physics = secs.physics || 0;
        studySecs.chemistry = secs.chemistry || 0;
        studySecs.maths = secs.maths || 0;
    }

    if (mood !== null) AppState.moodMultiplier = parseFloat(mood);

    // ── Hydrate Cognitive MMR / Elo Matrix instantly with fallback defaults ──
    // Every axis is guarded so a missing/corrupt profile field can never
    // produce a NaN data gap — it always falls back to the 1200 baseline.
    if (savedElo && typeof savedElo === 'object') {
        AppState.elo.physics   = (typeof savedElo.physics   === 'number' && isFinite(savedElo.physics))   ? savedElo.physics   : 1200;
        AppState.elo.chemistry = (typeof savedElo.chemistry === 'number' && isFinite(savedElo.chemistry)) ? savedElo.chemistry : 1200;
        AppState.elo.maths     = (typeof savedElo.maths     === 'number' && isFinite(savedElo.maths))     ? savedElo.maths     : 1200;
        AppState.elo.global    = (typeof savedElo.global    === 'number' && isFinite(savedElo.global))    ? savedElo.global    : 1200;
    } else {
        AppState.elo.physics   = 1200;
        AppState.elo.chemistry = 1200;
        AppState.elo.maths     = 1200;
        AppState.elo.global    = 1200;
    }

    // Hydrate active practice mode + hardcore daily counter (resets daily)
    if (savedMode && PRACTICE_MODES.includes(savedMode)) AppState.practiceFlowMode = savedMode;
    if (hcDaily && typeof hcDaily === 'object') {
        const today = new Date().toISOString().slice(0, 10);
        AppState.hardcoreDailyDate   = hcDaily.date || null;
        AppState.hardcoreDailyCount  = (hcDaily.date === today) ? (hcDaily.count || 0) : 0;
    }

    if (username) {
        document.getElementById('display-username').textContent = username;
        document.getElementById('set-username').value = username;
    }

    if (pfp) {
        AppState.profilePicData = pfp;
        document.getElementById('display-pfp').src = pfp;
    }

    if (savedKey) {
        AppState.geminiApiKey = savedKey;
    }
    const geminiKeyInput = document.getElementById('gemini-key');
    if (geminiKeyInput) geminiKeyInput.value = AppState.geminiApiKey;

    if (lockDate) {
        const diff = (new Date() - new Date(lockDate)) / (1000 * 60 * 60 * 24);
        if (diff < 1) _ui('lockTargetsOnly');
    }

    if (basePhys !== null) baseTargets.physics = parseInt(basePhys);
    if (baseChem !== null) baseTargets.chemistry = parseInt(baseChem);
    if (baseMath !== null) baseTargets.maths = parseInt(baseMath);

    document.getElementById('set-tgt-phys').value = baseTargets.physics;
    document.getElementById('set-tgt-chem').value = baseTargets.chemistry;
    document.getElementById('set-tgt-math').value = baseTargets.maths;

    // ── Load error resolution targets from separate IndexedDB keys ──
    if (errPhys !== null) baseErrorTargets.physics = parseInt(errPhys);
    if (errChem !== null) baseErrorTargets.chemistry = parseInt(errChem);
    if (errMath !== null) baseErrorTargets.maths = parseInt(errMath);

    const errPhysEl = document.getElementById('set-err-phys');
    const errChemEl = document.getElementById('set-err-chem');
    const errMathEl = document.getElementById('set-err-math');
    if (errPhysEl) errPhysEl.value = baseErrorTargets.physics;
    if (errChemEl) errChemEl.value = baseErrorTargets.chemistry;
    if (errMathEl) errMathEl.value = baseErrorTargets.maths;

    // ── Backfill SR fields on legacy question data ──
    migrateQuestionBankSR();
}

// ==================== DRIVE MEDIA HANDLERS ====================

export async function uploadMediaToDrive(base64, filename, folderId, token) {
    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    const contentType = base64.split(';')[0].split(':')[1];
    const base64Data = base64.split(',')[1];

    const metadata = { name: filename, mimeType: contentType, parents: [folderId] };

    const multipartRequestBody =
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: ' + contentType + '\r\n' +
        'Content-Transfer-Encoding: base64\r\n\r\n' +
        base64Data +
        close_delim;

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'multipart/related; boundary=' + boundary
        },
        body: multipartRequestBody
    });
    const data = await res.json();
    return data.id;
}

export async function fetchMediaFromDrive(fileId, token) {
    if (AppState.imageFetchCache[fileId]) {
        return AppState.imageFetchCache[fileId];
    }

    const fetchPromise = (async () => {
        try {
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) return null;
            const blob = await res.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (err) {
            console.error(`Fault fetching file ${fileId}:`, err);
            return null;
        }
    })();

    AppState.imageFetchCache[fileId] = fetchPromise;
    return fetchPromise;
}

export async function cacheAllDriveImages() {
  if (!AppState.driveAccessToken) { alert('Please connect Google Drive first.'); return; }
  showLoading('Caching all Drive images locally…');
  let fixed = 0;
  for (const q of AppState.questionBank) {
    if (q.driveImageId && !q.imageDataUrl) {
      try { q.imageDataUrl = await fetchMediaFromDrive(q.driveImageId, AppState.driveAccessToken); fixed++; } catch (e) {}
    }
    if (q.driveDiagramId && !q.diagramImageUrl) {
      try { q.diagramImageUrl = await fetchMediaFromDrive(q.driveDiagramId, AppState.driveAccessToken); fixed++; } catch (e) {}
    }
  }
  await saveAllAsync();
  hideLoading();    if (fixed > 0) { alert(`✅ Cached ${fixed} images locally — they're kept on this device for good.`); }
  else { alert('All images are already cached locally.'); }
}

// ==================== DRIVE MEDIA DELETION ENGINE ====================
export async function deleteMediaFromDrive(fileId, token) {
    if (!fileId || !token) return;
    try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
            method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.ok) console.log(`🗑️ Successfully deleted orphaned cloud asset: ${fileId}`);
        else if (res.status === 404) console.warn(`Cloud asset ${fileId} already absent or deleted from Drive.`);
        else console.warn(`Drive API delete request for file ${fileId} returned status: ${res.status}`);
    } catch (err) { console.error(`Network fault while trying to delete file ${fileId} from Drive:`, err); }
}

// ==================== DRIVE INIT & HEARTBEAT ====================

export async function initDrive() {
    AppState.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                AppState.driveAccessToken = tokenResponse.access_token;
                idbSet('jeemax_drive_token', AppState.driveAccessToken);
                document.getElementById('btn-drive-auth').style.display = 'none';
                document.getElementById('drive-status').style.display = 'block';
                initializeCloudFolder();
                setupSyncHeartbeat();
            }
        },
    });

    let savedToken = await idbGet('jeemax_drive_token');
    if (savedToken) {
        AppState.driveAccessToken = savedToken;
        isDriveTokenValid().then(isValid => {
            if (isValid) {
                document.getElementById('btn-drive-auth').style.display = 'none';
                document.getElementById('drive-status').style.display = 'block';
                initializeCloudFolder().catch(console.error);
                setupSyncHeartbeat();
            } else { AppState.driveAccessToken = null; }
        }).catch(err => console.error("Background token validation failed", err));
    } else {
        document.getElementById('btn-drive-auth').style.display = 'inline-block';
        document.getElementById('drive-status').style.display = 'none';
    }
}

export function setupSyncHeartbeat() {
    if (syncIntervalId) clearInterval(syncIntervalId);
    syncIntervalId = setInterval(() => {
        if (AppState.driveAccessToken && AppState.cloudFolderId) loadStateFromCloud(true);
    }, 120000);
}

export async function isDriveTokenValid() {
    if (!AppState.driveAccessToken) return false;
    try {
        const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
            headers: { Authorization: `Bearer ${AppState.driveAccessToken}` }
        });
        if (response.ok) return true;
        await idbRemove('jeemax_drive_token');
        AppState.driveAccessToken = null;
        AppState.cloudFolderId = null;
        document.getElementById('btn-drive-auth').style.display = 'inline-block';
        document.getElementById('drive-status').style.display = 'none';
        const syncSubText = document.getElementById('sync-sub-text');
        if (syncSubText) { syncSubText.textContent = "Drive disconnected – reconnect in Settings"; syncSubText.color = "var(--glow-red)"; }
        return false;
    } catch (err) { console.error("Token validation error:", err); return false; }
}

export async function initializeCloudFolder() {
    const query = "mimeType='application/vnd.google-apps.folder' and name='JEEMaxxing_Cloud' and trashed=false";
    try {
        let response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
            headers: { Authorization: `Bearer ${AppState.driveAccessToken}` }
        });
        let data = await response.json();
        if (data.files && data.files.length > 0) {
            AppState.cloudFolderId = data.files[0].id;
            await loadStateFromCloud();
        } else {
            let createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
                method: 'POST',
                headers: { Authorization: `Bearer ${AppState.driveAccessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'JEEMaxxing_Cloud', mimeType: 'application/vnd.google-apps.folder' })
            });
            let createData = await createRes.json();
            AppState.cloudFolderId = createData.id;
            syncStateToCloud();
        }
    } catch (e) { console.error("Cloud Folder Init Failed:", e); }
}

// ==================== CLOUD SYNC OPERATIONS ====================

export async function getCloudSolvedTotal() {
    try {
        const query = `name='system_state.json' and '${AppState.cloudFolderId}' in parents and trashed=false`;
        let searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
            headers: { Authorization: `Bearer ${AppState.driveAccessToken}` }
        });
        let searchData = await searchRes.json();
        if (searchData.files && searchData.files.length > 0) {
            let fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}?alt=media`, {
                headers: { Authorization: `Bearer ${AppState.driveAccessToken}` }
            });
            let cloudState = await fileRes.json();
            return (cloudState.solved?.physics || 0) + (cloudState.solved?.chemistry || 0) + (cloudState.solved?.maths || 0);
        }
    } catch (e) {}
    return 0;
}

export async function executeUnifiedSync() {
    const valid = await isDriveTokenValid();
    if (!valid || !AppState.driveAccessToken || !AppState.cloudFolderId) {
        alert("Google Drive connection lost. Please reconnect in Settings."); return;
    }
    const btn = document.getElementById('manual-sync-btn');
    const subText = document.getElementById('sync-sub-text');
    if (btn) btn.classList.add('spinning');
    if (subText) subText.textContent = "Downloading cloud dataset...";

    try {
        const query = `name='system_state.json' and '${AppState.cloudFolderId}' in parents and trashed=false`;
        let searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
            headers: { Authorization: `Bearer ${AppState.driveAccessToken}` }
        });
        let fileId = null;
        if (searchRes.ok) {
            let searchData = await searchRes.json();
            if (searchData.files && searchData.files.length > 0) {
                fileId = searchData.files[0].id;
                let fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                    headers: { Authorization: `Bearer ${AppState.driveAccessToken}` }
                });
                if (fileRes.ok) {
                    let cloudState = await fileRes.json();
                    if (subText) subText.textContent = "Merging runtime variables...";
                    if (cloudState.questionBank) {
                        const localIds = new Set(AppState.questionBank.map(q => q.id));
                        cloudState.questionBank.forEach(cloudQ => {
                            if (!localIds.has(cloudQ.id)) { AppState.questionBank.push(cloudQ); }
                            else {
                                let localQ = AppState.questionBank.find(q => q.id === cloudQ.id);
                                if (cloudQ.status === 'solved' && localQ.status !== 'solved') localQ.status = 'solved';
                            }
                        });
                    }
                    if (cloudState.chapters) {
                        for (let subj in cloudState.chapters) {
                            if (!AppState.chapters[subj]) AppState.chapters[subj] = [];
                            cloudState.chapters[subj].forEach(ch => { if (!AppState.chapters[subj].includes(ch)) AppState.chapters[subj].push(ch); });
                        }
                    }
                    const todayStr = todayLocalKey();
                    if (cloudState.date === todayStr) {
                        if (cloudState.solved) {
                            solved.physics   = Math.max(solved.physics,   cloudState.solved.physics || 0);
                            solved.chemistry = Math.max(solved.chemistry, cloudState.solved.chemistry || 0);
                            solved.maths    = Math.max(solved.maths,    cloudState.solved.maths || 0);
                        }
                        if (cloudState.studySecs) {
                            studySecs.physics   = Math.max(studySecs.physics,   cloudState.studySecs.physics || 0);
                            studySecs.chemistry = Math.max(studySecs.chemistry, cloudState.studySecs.chemistry || 0);
                            studySecs.maths    = Math.max(studySecs.maths,    cloudState.studySecs.maths || 0);
                        }
                    }
                    // ── Elo Matrix: high-water-mark merge (same as solved/studySecs) ──
                    if (cloudState.elo && typeof cloudState.elo === 'object') {
                        const ce = cloudState.elo;
                        if (typeof ce.physics   === 'number' && isFinite(ce.physics))   AppState.elo.physics   = Math.max(AppState.elo.physics,   ce.physics);
                        if (typeof ce.chemistry === 'number' && isFinite(ce.chemistry)) AppState.elo.chemistry = Math.max(AppState.elo.chemistry, ce.chemistry);
                        if (typeof ce.maths     === 'number' && isFinite(ce.maths))     AppState.elo.maths     = Math.max(AppState.elo.maths,     ce.maths);
                        if (typeof ce.global    === 'number' && isFinite(ce.global))    AppState.elo.global    = Math.max(AppState.elo.global,    ce.global);
                    }
                }
            }
        }
        if (subText) subText.textContent = "Updating interface fields...";
        await idbSet('jeemax_question_bank', AppState.questionBank.map(q => ({ ...q, imageDataUrl: null, diagramImageUrl: null })));
        await persistImageCacheIfChanged();
        await idbSet('jeemax_chapters', AppState.chapters);
        await idbSet('jeemax_solved', solved);
        await idbSet('jeemax_study_secs', studySecs);
        await updateDailyHistory();
        _ui('updateUI'); _ui('updateStudyTimeHeader'); _ui('renderGraph'); _ui('renderErrorMatrixFromBank');

        if (subText) subText.textContent = "Uploading consolidated data...";
        const localTotal = (solved.physics || 0) + (solved.chemistry || 0) + (solved.maths || 0);
        if (localTotal === 0) {
            const cloudTotal = await getCloudSolvedTotal();
            if (cloudTotal > 0) {
                if (subText) { subText.textContent = "Sync skipped – preserving cloud data"; subText.style.color = "#fbbf24"; setTimeout(() => { subText.textContent = "System Idle"; subText.style.color = "#fff"; }, 3000); }
                return;
            }
        }
        // Strip inline images from the cloud payload (mirrors syncStateToCloud)
        // — driveImageId re-fetches them on demand; keeps Drive JSON lean.
        const payload = { date: todayLocalKey(), questionBank: AppState.questionBank.map(q => ({ ...q, imageDataUrl: null, diagramImageUrl: null })), chapters: AppState.chapters, solved, studySecs, elo: { ...AppState.elo }, dailyHistory: await getDailyHistory() };
        if (!fileId) {
            let createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
                method: 'POST', headers: { Authorization: `Bearer ${AppState.driveAccessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'system_state.json', parents: [AppState.cloudFolderId] })
            });
            let createData = await createRes.json(); fileId = createData.id;
        }
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
            method: 'PATCH', headers: { Authorization: `Bearer ${AppState.driveAccessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (subText) { subText.textContent = "Synced & Secured ✔"; subText.style.color = "var(--glow-green)"; setTimeout(() => { subText.textContent = "System Idle"; subText.style.color = "#fff"; }, 3000); }
    } catch (e) {
        console.error("Unified Manual Synchronization pipeline error:", e);
        if (subText) { subText.textContent = "Execution Error ✖"; subText.style.color = "var(--glow-red)"; }
    } finally { if (btn) btn.classList.remove('spinning'); }
}

// Coalesce auto cloud pushes: the full bank (minus images) is uploaded on
// every save when Drive is linked — that is megabytes of JSON + image uploads
// per solve on iPad. Throttle to one push per 30s (manual sync bypasses).
const CLOUD_PUSH_THROTTLE_MS = 30000;
let _lastCloudPushAt = 0;

export async function syncStateToCloud(force = false) {
    if (!AppState.driveAccessToken || !AppState.cloudFolderId) return;
    if (!force) {
        const now = Date.now();
        if (now - _lastCloudPushAt < CLOUD_PUSH_THROTTLE_MS) return; // coalesced
        if (document.hidden) return;                                  // skip when backgrounded
        _lastCloudPushAt = now;
    }
    try {
        const subText = document.getElementById('sync-sub-text');
        if (subText) subText.textContent = "Processing media files...";
        let cloudQuestionBank = [];
        let newlyUploaded = false;
        for (let i = 0; i < AppState.questionBank.length; i++) {
            let q = AppState.questionBank[i];
            if (q.imageDataUrl && q.imageDataUrl.length > 100 && !q.driveImageId) {
                try { q.driveImageId = await uploadMediaToDrive(q.imageDataUrl, `Q_${q.id}.png`, AppState.cloudFolderId, AppState.driveAccessToken); newlyUploaded = true; } catch (err) { console.error(`Failed to upload asset frame for Q_${q.id}:`, err); }
            }
            if (q.diagramImageUrl && q.diagramImageUrl.length > 100 && !q.driveDiagramId) {
                try { q.driveDiagramId = await uploadMediaToDrive(q.diagramImageUrl, `Diag_${q.id}.png`, AppState.cloudFolderId, AppState.driveAccessToken); newlyUploaded = true; } catch (err) { console.error(`Failed to upload diagram frame for Q_${q.id}:`, err); }
            }
            let cloudQ = { ...q }; cloudQ.imageDataUrl = null; cloudQ.diagramImageUrl = null;
            cloudQuestionBank.push(cloudQ);
        }
        if (newlyUploaded) {
            await idbSet('jeemax_question_bank', AppState.questionBank.map(q => ({ ...q, imageDataUrl: null, diagramImageUrl: null })));
            await persistImageCacheIfChanged();
        }
        if (subText) subText.textContent = "Syncing system state...";
        const payload = { date: todayLocalKey(), questionBank: cloudQuestionBank, chapters: AppState.chapters, solved, studySecs, elo: { ...AppState.elo }, dailyHistory: await getDailyHistory() };
        const query = `name='system_state.json' and '${AppState.cloudFolderId}' in parents and trashed=false`;
        let searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${AppState.driveAccessToken}` } });
        if (!searchRes.ok) { if (searchRes.status === 404) throw new Error("Target cloud storage folder directory not found."); throw new Error(`Drive connection interface dropped with code: ${searchRes.status}`); }
        let searchData = await searchRes.json();
        let fileId = searchData.files && searchData.files.length > 0 ? searchData.files[0].id : null;
        if (!fileId) {
            let createRes = await fetch('https://www.googleapis.com/drive/v3/files', { method: 'POST', headers: { Authorization: `Bearer ${AppState.driveAccessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'system_state.json', parents: [AppState.cloudFolderId] }) });
            if (!createRes.ok) throw new Error(`Failed to generate system JSON metadata container file shell.`);
            let createData = await createRes.json(); fileId = createData.id;
        }
        if (fileId) {
            let uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, { method: 'PATCH', headers: { Authorization: `Bearer ${AppState.driveAccessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!uploadRes.ok) throw new Error(`State content array matrix synchronization delivery fault.`);
            if (subText) { subText.textContent = "Sync Complete ✔"; subText.style.color = "var(--glow-green)"; setTimeout(() => { subText.textContent = "System Idle"; subText.style.color = "#fff"; }, 3000); }
        }
    } catch (e) {
        console.error("Sync Engine Exception:", e);
        const subText = document.getElementById('sync-sub-text');
        if (subText) { subText.textContent = "Sync Failed ✖"; subText.style.color = "var(--glow-red)"; }
    }
}

export async function loadStateFromCloud(isBackground = false) {
    if (!AppState.driveAccessToken || !AppState.cloudFolderId) return;
    if (!isBackground) showLoading("Syncing with cloud architecture...");
    const query = `name='system_state.json' and '${AppState.cloudFolderId}' in parents and trashed=false`;
    try {
        let searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${AppState.driveAccessToken}` } });
        let searchData = await searchRes.json();
        if (searchData.files && searchData.files.length > 0) {
            const fileId = searchData.files[0].id;
            let fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${AppState.driveAccessToken}` } });
            let cloudState = await fileRes.json();
            if (cloudState.questionBank) {
                const localIds = new Set(AppState.questionBank.map(q => q.id));
                cloudState.questionBank.forEach(cloudQ => {
                    if (!localIds.has(cloudQ.id)) { AppState.questionBank.push(cloudQ); }
                    else { const localQ = AppState.questionBank.find(q => q.id === cloudQ.id); if (cloudQ.status === 'solved' && localQ.status !== 'solved') localQ.status = 'solved'; }
                });
            }
            if (cloudState.chapters) {
                for (let subj in cloudState.chapters) { if (!AppState.chapters[subj]) AppState.chapters[subj] = []; cloudState.chapters[subj].forEach(ch => { if (!AppState.chapters[subj].includes(ch)) AppState.chapters[subj].push(ch); }); }
            }
            if (cloudState.dailyHistory) {
                let localHistory = []; try { localHistory = await idbGet('jeemax_daily_history') || []; } catch (e) { localHistory = []; }
                const mergedMap = new Map();
                localHistory.forEach(entry => mergedMap.set(entry.date, entry.count));
                cloudState.dailyHistory.forEach(entry => { const existing = mergedMap.get(entry.date); if (existing === undefined || entry.count > existing) mergedMap.set(entry.date, entry.count); });
                const merged = Array.from(mergedMap.entries()).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)).slice(-15);
                await idbSet('jeemax_daily_history', merged);
            }
            // ══════════════════════════════════════════════════════════════════════
            // ✅ FIX: SAFE ROLLOVER — preserve local progress on date mismatch
            //
            // Previous code had a destructive `else` branch that zeroed out
            // `solved` and `studySecs` whenever cloudState.date !== todayStr.
            // This wiped today's local progress whenever a date-rollover or
            // a stale cloud sync occurred.
            //
            // New strategy:
            //   • Same-date  → merge via Math.max (no data loss, unchanged).
            //   • Stale-date → leave local counters INTACT. The cloud data
            //     belongs to a previous day and must NOT overwrite today's
            //     tracking. A stale cloud snapshot is simply ignored for
            //     daily counters; it was already folded into dailyHistory
            //     above. Local state is always authoritative for the
            //     *current* tracking window.
            // ══════════════════════════════════════════════════════════════════════
            const todayStr = todayLocalKey();
            if (cloudState.date === todayStr) {
                // Cloud is current — high-water-mark merge preserves the
                // larger of local vs. cloud for each subject.
                if (cloudState.solved) {
                    solved.physics   = Math.max(solved.physics,   cloudState.solved.physics   || 0);
                    solved.chemistry = Math.max(solved.chemistry, cloudState.solved.chemistry || 0);
                    solved.maths     = Math.max(solved.maths,     cloudState.solved.maths     || 0);
                }
                if (cloudState.studySecs) {
                    studySecs.physics   = Math.max(studySecs.physics,   cloudState.studySecs.physics   || 0);
                    studySecs.chemistry = Math.max(studySecs.chemistry, cloudState.studySecs.chemistry || 0);
                    studySecs.maths     = Math.max(studySecs.maths,     cloudState.studySecs.maths     || 0);
                }
            }
            // ── Elo Matrix: high-water-mark merge. Ratings are cumulative
            // skill capital — unlike daily counters, they are NOT date-scoped,
            // so the cloud's higher rating always wins regardless of date. ──
            if (cloudState.elo && typeof cloudState.elo === 'object') {
                const ce = cloudState.elo;
                if (typeof ce.physics   === 'number' && isFinite(ce.physics))   AppState.elo.physics   = Math.max(AppState.elo.physics,   ce.physics);
                if (typeof ce.chemistry === 'number' && isFinite(ce.chemistry)) AppState.elo.chemistry = Math.max(AppState.elo.chemistry, ce.chemistry);
                if (typeof ce.maths     === 'number' && isFinite(ce.maths))     AppState.elo.maths     = Math.max(AppState.elo.maths,     ce.maths);
                if (typeof ce.global    === 'number' && isFinite(ce.global))    AppState.elo.global    = Math.max(AppState.elo.global,    ce.global);
            }
            // else: stale cloud date — LOCAL WINS. Intentionally no-op.
            // The daily counters belong to the current local day; a
            // yesterday-cloud snapshot has no authority to zero them out.
            _ui('updateUI'); _ui('updateStudyTimeHeader'); _ui('renderGraph'); _ui('renderErrorMatrixFromBank');
        }
    } catch (e) { console.error("Failed to download state from cloud:", e); } finally { if (!isBackground) hideLoading(); }
}

// ==================== 15-DAY DAILY HISTORY TRACKER ====================
export async function getDailyHistory() {
    let history = await idbGet('jeemax_daily_history');
    if (!history) history = [];
    const todayStr = todayLocalKey();
    const todayTotal = (solved.physics || 0) + (solved.chemistry || 0) + (solved.maths || 0);
    const todayEntry = history.find(entry => entry.date === todayStr);
    if (todayEntry) { todayEntry.count = todayTotal; } else { history.push({ date: todayStr, count: todayTotal }); if (history.length > 15) history.shift(); }
    await idbSet('jeemax_daily_history', history);
    // ── Seed the sync daily history cache for Deload Engine's 48h missed-day check ──
    try { window._dailyHistoryCache = history; } catch (_) {}
    return history;
}

export async function updateDailyHistory() { await getDailyHistory(); }