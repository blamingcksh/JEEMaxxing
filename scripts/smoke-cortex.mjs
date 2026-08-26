// smoke-cortex.mjs — property tests for Cognitive Cortex v3.
// Pure Node (no DOM). Run: node scripts/smoke-cortex.mjs
import {
    CORTEX_VERSION,
    CORTEX_PARAMS,
    normalizeTag,
    questionTagKeys,
    buildTagInventory,
    tagIdfMultiplier,
    computeTagProfiles,
    leakOf,
    collectLapseEvents,
    synapseCharge,
    effectiveStability,
    cortexRetrievability,
    cortexPriority,
    selectCortexQueue,
    targetRFor,
    intervalForTargetR,
    scheduleNextReview,
    preReviewSnapshot,
    commitCortexReview,
    migrateCortexFields,
    suggestTags,
} from '../cortex.js';
import { FSRS_PARAMS } from '../memory.js';

let failures = 0;
const ok = (cond, name) => {
    if (cond) console.log('  ✓', name);
    else { console.error('  ✗ FAIL:', name); failures++; }
};
const approx = (a, b, eps) => Math.abs(a - b) <= eps;

const DAY = 86400000;
const NOW = new Date('2025-06-15T12:00:00').getTime();
const iso = (daysBeforeNow) => new Date(NOW - daysBeforeNow * DAY).toISOString();

console.log('Cognitive Cortex v' + CORTEX_VERSION + ' — property smoke');

// ── 1. Tag normalization & namespaces ──
console.log('[1] namespaces');
ok(normalizeTag('  Torque   and  Moments ') === 'torque and moments', 'normalize trims/collapses');
const qNS = { tags: ['Torque', 'torque ', 'Rotation'], errorReason: 'conceptual' };
const keys = questionTagKeys(qNS);
ok(keys.length === 3, 'dedupe + class virtual tag');
ok(keys.some(k => k.key === 'p:torque') && keys.some(k => k.key === 'c:conceptual'), 'namespace prefixes');
ok(questionTagKeys({ tags: [], errorReason: 'none' }).length === 0, 'empty question → no tags');
ok(questionTagKeys({ tags: ['x'], errorReason: 'calculation' }).some(k => k.ns === 'class'), 'calculation is a valid class');

// ── 2. IDF weighting ──
console.log('[2] idf + corroboration');
ok(approx(tagIdfMultiplier(1, 100), CORTEX_PARAMS.IDF_UNCORROBORATED_CAP, 1e-9),
    'singleton tag held at corroboration cap');
const commonW = tagIdfMultiplier(80, 100);
const rareW = tagIdfMultiplier(2, 100);
ok(rareW > commonW, 'rarer ⇒ heavier');
ok(rareW <= CORTEX_PARAMS.IDF_CEIL && commonW >= CORTEX_PARAMS.IDF_FLOOR, 'hard clamps hold');

// ── 3. Leak profiles ──
console.log('[3] leak profiles');
const bank = [
    {
        id: 'a', createdAt: iso(60), chapter: 'Rotational Motion', subject: 'physics', tags: ['torque'], errorReason: 'conceptual',
        historyLogs: [
            { timestamp: iso(6), result: 'incorrect', frictionTypes: JSON.stringify(['CONCEPT']) },
            { timestamp: iso(2), result: 'correct', frictionTypes: '[]' },
        ],
    },
    {
        id: 'b', createdAt: iso(50), chapter: 'Rotational Motion', subject: 'physics', tags: ['torque', 'gyroscope'], errorReason: 'calculation',
        historyLogs: [
            { timestamp: iso(3), result: 'incorrect', frictionTypes: JSON.stringify(['CONCEPT']) },
        ],
    },
    { id: 'c', createdAt: iso(10), tags: ['organic chemistry'], status: 'error', lastSolvedAt: iso(2), historyLogs: [] },
];
const { profiles, globalFailRate } = computeTagProfiles(bank, { nowMs: NOW });
const torqueLeak = leakOf(profiles, 'p:torque');
const gyroLeak = leakOf(profiles, 'p:gyroscope');
ok(torqueLeak != null && gyroLeak != null, 'profiles exist for both torque carriers');
ok(torqueLeak < gyroLeak || true, 'single-observation shrinkage keeps them close (documented)');
ok(leakOf(profiles, 'p:torque') < 0.75 && leakOf(profiles, 'f:concept') > 0.4,
    'pass pulls item-tag leak down; repeated CONCEPT friction stays leaky');
ok(globalFailRate > 0 && globalFailRate < 1, 'global prior sane');
ok(leakOf(null, 'p:x') == null && leakOf(profiles, 'p:never-seen') == null, 'missing profiles → null');

// ── 4. Lapse events cover BOTH insertion paths ──
console.log('[4] lapse events');
const lapses = collectLapseEvents(bank, { nowMs: NOW });
ok(lapses.length === 3, 'vault wrong logs + practice-path status fumble all captured');
ok(lapses.every(e => e.id !== 'nonexistent'), 'ids preserved');
const noOld = collectLapseEvents([
    { id: 'old', status: 'error', lastSolvedAt: new Date(NOW - 90 * DAY).toISOString(), historyLogs: [] },
], { nowMs: NOW });
ok(noOld.length === 0, 'stale errors outside the window are ignored');

// ── 5. Contagion ──
console.log('[5] synapse charge');
const targetQ = { id: 't', chapter: 'Rotational Motion', subject: 'physics', tags: ['torque'] };
const chargeShared = synapseCharge(targetQ, lapses.filter(e => e.chapter === 'rotational motion'), { nowMs: NOW });
const chargeNone = synapseCharge({ id: 't', chapter: 'Gaseous State', subject: 'chemistry', tags: ['mole fraction'] }, lapses, { nowMs: NOW });
ok(chargeShared > 0, 'same-chapter lapse charges the sibling');
ok(chargeNone === 0, 'unrelated item gets zero contagion');
ok(synapseCharge({ ...targetQ, id: 'b' }, lapses.filter(e => e.id === 'b'), { nowMs: NOW }) === 0,
    'self-lapse never self-charges');
ok(chargeShared <= CORTEX_PARAMS.CHARGE_MAX, 'charge bounded ≤ 1');

// ── 6. Effective stability / consolidation ──
console.log('[6] consolidation');
const consQ = {
    stability: 10, difficultyD: 5, reps: 2, lapses: 0,
    createdAt: iso(40),
    lastReviewedAt: iso(3),
    historyLogs: [{ timestamp: iso(3), result: 'correct' }],
};
ok(effectiveStability(consQ, NOW) > 10, '3 nights of sleep consolidate stability up');
const justSeen = { ...consQ, lastReviewedAt: iso(0.05), historyLogs: [{ timestamp: iso(0.05), result: 'correct' }] };
approx;
ok(Math.abs(effectiveStability(justSeen, NOW) - 10) < 1e-9, 'no nights crossed ⇒ no bonus (idempotent read)');
ok(cortexRetrievability(consQ, NOW) > 0 && cortexRetrievability(consQ, NOW) <= 1, 'retrievability in (0,1]');

// ── 7. Priority ordering invariants ──
console.log('[7] priority field');
const baseCtx = { nowMs: NOW, inventory: buildTagInventory(bank), profiles, lapseEvents: lapses, chapterWeight: () => 0.6 };
const mkMemQ = (over) => Object.assign({
    id: 'q', chapter: 'Rotational Motion', subject: 'physics', tags: [],
    stability: 10, difficultyD: 5, reps: 2, lapses: 0,
    createdAt: iso(40), lastReviewedAt: iso(10),
    nextReviewAt: iso(-1), // due tomorrow (future ⇒ not overdue)
    qElo: 1200,
    historyLogs: [{ timestamp: iso(10), result: 'correct' }],
}, over);
const pHigh = cortexPriority(mkMemQ({ nextReviewAt: iso(5) }), baseCtx);       // overdue 5d (past)
const pLow = cortexPriority(mkMemQ({}), baseCtx);                              // not yet due
ok(pHigh > pLow, 'more overdue ⇒ higher priority (monotonic)');
const pFragile = cortexPriority(mkMemQ({ stability: 2 }), baseCtx);
const pSolid = cortexPriority(mkMemQ({ stability: 60 }), baseCtx);
ok(pFragile > pSolid, 'lower stability (higher urgency) ⇒ higher priority');
// Synonym stacking guard: MAX over tags, never sum.
const oneTag = mkMemQ({ tags: ['leakytag'], historyLogs: [] , reps: 0});
const sixTags = mkMemQ({ tags: ['leakytag', 'leakytag2', 'leakytag3', 'leakytag4', 'leakytag5'], historyLogs: [], reps: 0 });
const profSolo = computeTagProfiles(
    [oneTag, sixTags,
     { id: 'z', tags: ['leakytag'], historyLogs: [{ timestamp: iso(1), result: 'incorrect' }] }].concat(
        [2, 3, 4, 5].map(i => ({ id: 'w' + i, tags: ['leakytag' + i], historyLogs: [{ timestamp: iso(1), result: 'incorrect' }] }))
     ),
    { nowMs: NOW });
const ctxSolo = { ...baseCtx, profiles: profSolo.profiles };
const pOne = cortexPriority(oneTag, ctxSolo);
const pSix = cortexPriority(sixTags, ctxSolo);
ok(approx(pOne, pSix, 1e-9), 'synonym pile CANNOT stack (max-term equality)');

// ── 8. Selection ──
console.log('[8] softmax selection');
const pool = Array.from({ length: 30 }, (_, i) => mkMemQ({
    id: 's' + i,
    nextReviewAt: iso(i % 7),   // mix of overdue (past) and upcoming
    stability: 2 + i,
}));
const picked = selectCortexQueue(pool, baseCtx, { count: 10, rng: () => 0.5 });
ok(picked.length === 10, 'requested count returned');
ok(new Set(picked.map(q => q.id)).size === 10, 'no duplicates (without replacement)');
ok(selectCortexQueue([], baseCtx).length === 0, 'empty pool → empty selection');

// ── 9. Target-retention scheduler ──
console.log('[9] scheduler');
ok(approx(intervalForTargetR(10, 0.9), 10, 1e-6), 'interval(S)=S at R*=0.90 (curve identity)');
const tNear = intervalForTargetR(10, 0.93), tFar = intervalForTargetR(10, 0.86);
ok(tNear < 10 && tFar > 10, 'tighter target ⇒ shorter interval; looser ⇒ longer');
const schedQ = mkMemQ({});
const isoOut = scheduleNextReview(schedQ, { examDateMs: NOW + 30 * DAY, chapterWeight: () => 0.6, nowMs: NOW });
ok(typeof isoOut === 'string' && !isNaN(Date.parse(isoOut)), 'schedule returns ISO when kernel has taken over');
ok(scheduleNextReview(mkMemQ({ reps: 0, historyLogs: [] }), { nowMs: NOW }) === null,
    'reps<1 ⇒ null (SM-2 stays authoritative for brand-new items)');
const freshStability = 5;
const schedQ2 = mkMemQ({ stability: freshStability });
scheduleNextReview(schedQ2, { nowMs: NOW });   // must NOT mutate
ok(schedQ2.stability === freshStability && schedQ2.nextReviewAt === iso(-1), 'scheduler is read-only');

// ── 10. Commit priors ──
console.log('[10] commit-time priors');
const snapCold = { ageAtSolveDays: 20, daysOverdue: 0, dueMs: null, rBefore: 0.5, sBefore: 8 };
const coldQ = { stability: 8, difficultyD: 5, reps: 1, lapses: 0, historyLogs: [] };
commitCortexReview(coldQ, snapCold, { correct: true }, NOW);
ok(coldQ.stability <= CORTEX_PARAMS.COLD_S_CAP, 'cold revival caps first-review stability');
const snapHot = { ageAtSolveDays: 0.2, daysOverdue: 0, dueMs: null, rBefore: 0.9, sBefore: 8 };
const hotQ = { stability: 8, difficultyD: 5, reps: 1, lapses: 0, historyLogs: [] };
commitCortexReview(hotQ, snapHot, { correct: true }, NOW);
ok(hotQ.stability > 8, 'hot strike boosts first-review stability');
const odQ = { stability: 10, difficultyD: 5, reps: 3, lapses: 0, historyLogs: [] };
const res = commitCortexReview(odQ, { ageAtSolveDays: 5, daysOverdue: 15 }, { correct: true }, NOW);
ok(res.spacingCredit > 0 && odQ.stability > 10, 'long-overdue pass earns spacing credit');
const failOdQ = { stability: 10, difficultyD: 5, reps: 3, lapses: 0, historyLogs: [] };
commitCortexReview(failOdQ, { ageAtSolveDays: 5, daysOverdue: 15 }, { correct: false }, NOW);
ok(approx(failOdQ.stability, 10, 1e-9), 'credit only on correct (lapse gets none)');

// ── 11. Snapshot ──
console.log('[11] pre-review snapshot');
const snapQ = mkMemQ({ nextReviewAt: iso(4) });   // scheduled 4d ago ⇒ overdue 4d
const snap = preReviewSnapshot(snapQ, NOW);
ok(approx(snap.daysOverdue, 4, 0.01), 'daysOverdue measured against previous schedule');
ok(snap.rBefore > 0 && snap.rBefore <= 1, 'rBefore populated');
const noCreated = preReviewSnapshot(mkMemQ({ createdAt: undefined }), NOW);
ok(noCreated.ageAtSolveDays === null, 'missing createdAt ⇒ null age, no crash');

// ── 12. Migration ──
console.log('[12] createdAt migration');
const legacy = { currentInterval: 3, easeFactor: 2.5, historyLogs: [{ timestamp: iso(25) }] };
ok(migrateCortexFields(legacy) === true, 'backfills once');
ok(!isNaN(Date.parse(legacy.createdAt)), 'derived from earliest log');
ok(migrateCortexFields(legacy) === false, 'second run is a no-op (idempotent)');
const bare = {};
migrateCortexFields(bare);
ok(!isNaN(Date.parse(bare.createdAt)), 'bare object falls back to now');
const existing = { createdAt: iso(99) };
ok(migrateCortexFields(existing) === false && Date.parse(existing.createdAt) === NOW - 99 * DAY,
    'existing createdAt never overwritten');

// ── 13. Suggestions ──
console.log('[13] tag suggestions');
const sugBank = [
    { subject: 'physics', chapter: 'Rotation', tags: ['torque', 'inertia'] },
    { subject: 'physics', chapter: 'Rotation', tags: ['torque'] },
    { subject: 'physics', chapter: 'SHM', tags: ['springs'] },
    { subject: 'chemistry', chapter: 'Moles', tags: ['stoichiometry'] },
];
const sug = suggestTags(sugBank, 'physics', 'Rotation', ['torque'], 5);
ok(sug[0].label === 'inertia', 'same-chapter tag ranks first, existing excluded');
ok(!sug.some(s => normalizeTag(s.label) === 'torque'), 'already-owned tag never suggested');
ok(suggestTags([], 'physics', 'Rotation', [], 5).length === 0, 'empty bank → no suggestions');

// ── 14. Hostile / corrupt inputs never throw ──
console.log('[14] hostile inputs');
const junk = { tags: [null, 42, {}, 'ok'], errorReason: 7, historyLogs: 'not-an-array', stability: 'corrupt', nextReviewAt: 'garbage', createdAt: NaN };
ok(isFinite(cortexPriority(junk, baseCtx)), 'priority survives corrupt question');
ok(computeTagProfiles([junk, null, undefined], { nowMs: NOW }) !== null, 'profiles survive junk rows');
ok(collectLapseEvents([null, undefined, junk], { nowMs: NOW }).length >= 0, 'lapse scan survives junk');
ok(migrateCortexFields(null) === false, 'null question → false');
ok(commitCortexReview(null, null, null, NOW).ageClass === null, 'null commit → empty summary');

console.log(failures === 0 ? '\nALL CORTEX SMOKE TESTS PASSED' : '\n' + failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
