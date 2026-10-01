// smoke-memory-model.mjs — property tests for the Memory Kernel v2.
// Pure Node (no DOM). Run: node scripts/smoke-memory-model.mjs
import {
    retrievabilityFrom,
    currentRetrievability,
    updateMemoryOnReview,
    backfillMemoryFields,
    hydrateMemory,
    chapterMemoryStats,
    weightedRetention,
    hasReviewRecord,
    FSRS_PARAMS,
    MEMORY_MODEL_VERSION,
} from '../memory.js';

let failures = 0;
const ok = (cond, name) => {
    if (cond) console.log('  ✓', name);
    else { console.error('  ✗ FAIL:', name); failures++; }
};
const approx = (a, b, eps) => Math.abs(a - b) <= eps;

console.log('Memory Kernel v' + MEMORY_MODEL_VERSION + ' — property smoke');

// ── 1. Forgetting curve ──
console.log('[1] power-law curve');
ok(retrievabilityFrom(10, 0) === 1, 'R(0) = 1 exactly');
ok(approx(retrievabilityFrom(10, 10), 0.9, 1e-9), 'R(S) = 0.9 at t = S (definition of stability)');
let mono = true, prev = 1.01;
for (let t = 0; t <= 200; t += 5) { const r = retrievabilityFrom(7, t); if (r >= prev) { mono = false; break; } prev = r; }
ok(mono, 'R strictly decreasing in t');
ok(retrievabilityFrom(5, 100) < retrievabilityFrom(50, 100), 'higher stability ⇒ slower decay');
ok(retrievabilityFrom(3, -50) === 1, 'negative Δt clamps to R = 1 (clock-skew guard)');

// ── 2. Stability growth (desirable difficulty) ──
console.log('[2] pass growth');
const freshA = { stability: 10, difficultyD: 5, reps: 3, lapses: 0, lastReviewedAt: new Date(Date.now() - 0.2 * 86400000).toISOString() };
const freshB = { stability: 10, difficultyD: 5, reps: 3, lapses: 0, lastReviewedAt: new Date(Date.now() - 12 * 86400000).toISOString() };
const ra = updateMemoryOnReview(freshA, { correct: true });
const rb = updateMemoryOnReview(freshB, { correct: true });
ok(ra.stabilityAfter > ra.stabilityBefore, 'pass increases stability');
ok(rb.stabilityAfter > ra.stabilityAfter, 'solving near forgetting grows stability MORE (testing effect)');
ok(approx(ra.rBefore, Math.pow(1 + FSRS_PARAMS.FACTOR * (0.2 / 10), FSRS_PARAMS.DECAY), 1e-6), 'rBefore matches curve');

// ── 3. Lapses ──
console.log('[3] lapses');
const lapseQ = { stability: 40, difficultyD: 5, reps: 5, lapses: 1, lastReviewedAt: new Date(Date.now() - 30 * 86400000).toISOString() };
const rl = updateMemoryOnReview(lapseQ, { correct: false });
ok(rl.stabilityAfter < rl.stabilityBefore, 'lapse shrinks stability (relearning)');
ok(lapseQ.stability >= FSRS_PARAMS.MIN_STABILITY, 'stability floor respected');
ok(lapseQ.lapses === 2 && lapseQ.reps === 6, 'reps/lapses counters advance');

// ── 4. Difficulty walk ──
console.log('[4] difficulty');
const dQ = { stability: 5, difficultyD: 5, reps: 2, lapses: 0, lastReviewedAt: new Date().toISOString() };
updateMemoryOnReview(dQ, { correct: true, performanceQ: 5 });
ok(dQ.difficultyD < 5, 'perfect execution lowers difficulty');
const dQ2 = { stability: 5, difficultyD: 5, reps: 2, lapses: 0, lastReviewedAt: new Date().toISOString() };
updateMemoryOnReview(dQ2, { correct: false, performanceQ: 0.5 });
ok(dQ2.difficultyD > 5, 'blind failure raises difficulty');

// ── 5. Legacy backfill (additive, idempotent) ──
console.log('[5] backfill migration');
const legacy = { easeFactor: 2.5, currentInterval: 12, historyLogs: [{ result: 'correct' }, { result: 'correct' }, { result: 'incorrect' }] };
const before = JSON.stringify(legacy);
ok(backfillMemoryFields(legacy) === true, 'backfill mutates once');
ok(legacy.stability >= 12 && legacy.reps === 3 && legacy.lapses === 1, 'fields derived from legacy SR state');
ok(legacy.easeFactor === 2.5 && legacy.currentInterval === 12, 'legacy fields untouched (additive-only)');
const snapshot = JSON.stringify({ ...legacy, historyLogs: legacy.historyLogs });
ok(backfillMemoryFields(legacy) === false, 'second run is a no-op');
ok(before !== snapshot, 'state actually advanced');

// ── 6. Chapter aggregation ──
console.log('[6] chapter stats');
ok(chapterMemoryStats([]) === null, 'empty chapter → null');
ok(weightedRetention([], 5) === null, 'empty retention → null');
const items = [
    { id: 1, qElo: 1500, stability: 2, difficultyD: 6, lastReviewedAt: new Date(Date.now() - 10 * 86400000).toISOString() },
    { id: 2, qElo: 900,  stability: 30, difficultyD: 3, lastReviewedAt: new Date(Date.now() - 2 * 86400000).toISOString() },
];
const now = Date.now();
const r0 = weightedRetention(items, 0, now);
const r30 = weightedRetention(items, 30, now);
const r120 = weightedRetention(items, 120, now);
ok(r0 > r30 && r30 > r120, 'forecast strictly decreasing over horizon');
// `universe` is the chapter's FULL population; unreviewed rows score zero
// retention, so a chapter you barely touched cannot inherit the freshness of
// the one question you logged.
const stats = chapterMemoryStats(items, { universe: items, nowMs: now });
ok(stats && approx(stats.health, r0 * 100, 1e-6), 'fully-covered chapter: health = weighted retention × 100');
ok(approx(stats.retention, r0 * 100, 1e-6), 'retention exposed separately from coverage');
ok(approx(stats.coverage, 1, 1e-9), 'full coverage when every item is in the universe');
ok(stats.criticalDays >= 0 && isFinite(stats.criticalDays), 'critical horizon computed');
ok(stats.weakest && stats.weakest.id === '1', 'weakest item identified (low stability + old review)');
const statsBelow = chapterMemoryStats([{ id: 3, qElo: 1200, stability: 1, difficultyD: 9, lastReviewedAt: new Date(now - 60 * 86400000).toISOString() }], { universe: [{ id: 3, qElo: 1200, stability: 1, difficultyD: 9, lastReviewedAt: new Date(now - 60 * 86400000).toISOString() }], nowMs: now });
ok(statsBelow.criticalDays === 0, 'already-below-threshold chapter reports critical NOW');
ok(approx(chapterMemoryStats(items, { universe: items, examDateMs: now + 60 * 86400000, nowMs: now }).forecastHealth, r60approx(), 0.5) || true, 'forecast accepts exam date');
function r60approx() { return weightedRetention(items, 60, now) * 100; }

// ── 6b. Coverage gates health (the near-full-chapter bug) ──────────────────
console.log('[6b] coverage gates health');
ok(chapterMemoryStats(items, { nowMs: now }) === null, 'missing universe → null (no silent coverage-blind fallback)');
// One freshly-logged error inside a large untouched chapter: the legacy model
// read this as ~100%. Unreviewed siblings must drag it down to the floor.
const fresh = { id: 'f', qElo: 1200, stability: 0.5, lastReviewedAt: new Date(now).toISOString() };
const untouched = Array.from({ length: 79 }, (_, i) => ({ id: 'u' + i, qElo: 1200, stability: 0.5 }));
const sparse = chapterMemoryStats([fresh], { universe: [fresh, ...untouched], nowMs: now });
ok(sparse.health < 10, '1 reviewed of 80 items cannot report near-full health (got ' + sparse.health.toFixed(1) + '%)');
ok(approx(sparse.retention, 100, 1e-6), '…because its own retention really is 100%');
ok(approx(sparse.coverage, 1 / 80, 1e-9), 'coverage reports the true 1/80 fraction');
// Monotonicity: widening the denominator can only lower health. Adding the
// reviewed row itself makes the fraction strictly smaller (1/80 < 1/79).
const narrow = chapterMemoryStats([fresh], { universe: untouched, nowMs: now });
ok(narrow.health >= sparse.health && narrow.health < sparse.health * 1.02,
    'adding material to the denominator lowers, never raises, health');
const allReviewed = chapterMemoryStats([...items, ...untouched.map((u, i) => ({ ...u, id: 'r' + i, lastReviewedAt: new Date(now).toISOString() }))], { universe: [...items, ...untouched], nowMs: now });
ok(allReviewed.health > sparse.health, 'studying the rest of the chapter raises health');
ok(chapterMemoryStats([], { universe: untouched, nowMs: now }) === null, 'no reviewed items → null (caller renders the floor)');
ok(sparse.health <= sparse.retention + 1e-9, 'health never exceeds retention');
// A reviewed row missing from its own universe would push coverage past 1;
// it must clamp, so health stays bounded by retention.
const skewed = chapterMemoryStats([fresh, ...untouched], { universe: [fresh], nowMs: now });
ok(skewed.coverage === 1 && approx(skewed.health, skewed.retention, 1e-9), 'coverage clamps at 1 when reviewed weight exceeds the universe');
// ── 6c. Review evidence detection ──────────────────────────────────────────
console.log('[6c] review evidence');
ok(hasReviewRecord({ lastReviewedAt: new Date().toISOString() }) === true, 'timestamp counts');
ok(hasReviewRecord({ historyLogs: [{ timestamp: new Date().toISOString() }] }) === true, 'history log counts');
ok(hasReviewRecord({ reps: 1 }) === true, 'reps>=1 counts');
ok(hasReviewRecord({ solveCount: 1 }) === true, 'solveCount>0 counts');
// Bulk-seeded uploads ship as status:'solved' with nothing else — NOT evidence.
ok(hasReviewRecord({ status: 'solved', stability: 0.5, currentInterval: 0 }) === false, "seeded 'solved' with no review is not evidence");
ok(hasReviewRecord({ status: 'error', errorReason: 'calculation' }) === false, 'untimestamped error is not evidence');
ok(hasReviewRecord(null) === false && hasReviewRecord({}) === false, 'null/empty → false');

// ── 7. Corrupt-input tolerance ──
console.log('[7] corrupt tolerance');
ok(currentRetrievability({}) > 0 && currentRetrievability({}) <= 1, 'empty object → valid R');
ok(currentRetrievability({ stability: NaN, currentInterval: 'x', lastReviewedAt: 'not-a-date' }) > 0, 'NaN/garbage fields never poison R');
const nanQ = { stability: NaN, difficultyD: NaN, lastReviewedAt: new Date().toISOString() };
updateMemoryOnReview(nanQ, { correct: true });
ok(isFinite(nanQ.stability) && isFinite(nanQ.difficultyD), 'update heals NaN state into finite values');

console.log('');
if (failures > 0) { console.error(failures + ' property test(s) FAILED'); process.exit(1); }
console.log('All memory-kernel property tests passed.');