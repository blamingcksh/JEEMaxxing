/**
 * cortex.js — Cognitive Cortex v3 (brain-like scheduling layer over the
 * Memory Kernel v2).
 *
 * PURE module: zero DOM / zero AppState dependencies (same contract as
 * memory.js — everything takes plain question objects / arrays so it runs
 * identically in the browser and under Node smoke tests).
 *
 * WHY IT EXISTS — the Memory Kernel models ONE memory (D/S/R per item). A
 * brain does more than that: it generalizes across structurally similar
 * traces ("this CONCEPT-lapse smells like my other torque mistakes"), it
 * feels how LONG something has been neglected, it consolidates during sleep,
 * and it allocates rehearsal by SALIENCE (exam weight × specificity), not by
 * a single fragility scalar. Cortex adds those layers on top, driven by the
 * signals the user actually leaves behind:
 *
 *   • Personal tags        (q.tags — free-form, experience-based vocabulary)
 *   • Mistake class        (errorReason: calculation/conceptual/misread)
 *   • Solve-event friction (PERFECT/CALC/FORMULA/CONCEPT/APPROACH pills)
 *   • Age-at-solve         (how long after logging the mistake was attacked)
 *   • Days-left-overdue    (how long a scheduled review sat ignored)
 *
 * THE THREE NAMESPACES (each review folds into ALL of them):
 *   A  personal tags      nsWeight 1.0   key prefix "p:"
 *   B  mistake class      nsWeight 0.7   key prefix "c:"
 *   C  friction pills     nsWeight 0.5   key prefix "f:" (event-scoped)
 * Chapter acts as the implicit root node every item hangs from.
 *
 * ANTI-GAMING / ANTI-NOISE GUARDS (see plan review):
 *   • IDF hard-clamped to [ns×0.3, ns×1.2]; tags seen on <2 questions are
 *     held at ns×0.5 (corroboration rule — a typo can't become ultra-signal).
 *   • Priority boost uses MAX over the item's tags, never a sum — synonym
 *     piles ("torque"+"rotational motion"+…) cannot stack multiplicatively.
 *   • Synapse edge weights are log1p-compressed and capped — overlapping
 *     tags give diminishing returns.
 *
 * Everything derived here is COMPUTED, not persisted (except createdAt via
 * migrateCortexFields): profiles/graphs rebuild from historyLogs per session
 * render and memoize upstream, so cloud merge / restore / multi-tab flows
 * carry no new schema and cannot corrupt.
 */

import {
    FSRS_PARAMS,
    hydrateMemory,
    retrievabilityFrom,
} from './memory.js';

export const CORTEX_VERSION = 3;

export const CORTEX_PARAMS = {
    // ── Priority field ──
    URGENCY_GAMMA: 1.3,        // emphasis curve on (1 − R)
    OVERDUE_KAPPA: 0.6,        // saturating overdue pressure amplitude
    OVERDUE_TAU_DAYS: 10,      // saturation horizon for overdue stress
    TAG_LEAK_LAMBDA: 0.5,      // tag-boost amplitude (on the MAX leak term)
    CONTAGION_CHI: 0.8,        // synapse-charge amplitude
    NEGLECT_RATE: 0.3,         // never-revisited boost amplitude
    NEGLECT_HORIZON_DAYS: 60,  // age over which neglect saturates
    FATIGUE_BRAKE_DEPTH: 0.7,  // just-reviewed suppression depth
    FATIGUE_TAU_HOURS: 4,      // recovery constant of the brake
    SOFTMAX_TAU: 0.35,         // exploration temperature (winner-take-all-ish)
    QUEUE_TOPK: 12,            // candidates entering the softmax pool

    // ── IDF weighting ──
    IDF_FLOOR: 0.3,
    IDF_CEIL: 1.2,
    IDF_UNCORROBORATED_CAP: 0.5, // df < 2 ⇒ held here regardless of rarity

    // ── Namespace weights ──
    NS_PERSONAL: 1.0,
    NS_ERRORCLASS: 0.7,
    NS_FRICTION: 0.5,

    // ── Leak estimator (shrunk binomial) ──
    LEAK_PRIOR_STRENGTH: 4,          // pseudo-observations of the prior
    LEAK_PRIOR_DEFAULT: 0.45,        // fallback prior fail rate
    LEAK_RECENCY_DAYS: 45,           // exponential recency window
    TREND_RECENT_DAYS: 30,

    // ── Synapse graph ──
    EDGE_CHAPTER_BASE: 0.35,
    EDGE_MAX: 2.5,
    LAPSE_EVENT_WINDOW_DAYS: 21,
    LAPSE_EVENT_CAP: 200,
    CHARGE_HALF_LIFE_DAYS: 3,
    CHARGE_LAPSE_IMPACT: 0.55,
    CHARGE_MAX: 1.0,

    // ── Age-at-solve priors ──
    HOT_STRIKE_DAYS: 1,        // first attack < 1d after logging
    HOT_S_MULT: 1.15,
    COLD_REVIVAL_DAYS: 7,      // first attack > 7d after logging
    COLD_S_CAP: 3,             // you re-derived it, you didn't recall it

    // ── Overdue spacing credit ──
    SPACING_CREDIT_MIN_OVERDUE: 3,
    SPACING_CREDIT_RATE: 0.10,
    SPACING_CREDIT_SAT_DAYS: 30,

    // ── Sleep consolidation (derived-only, never persisted) ──
    CONSOLIDATION_PER_NIGHT: 0.03,
    CONSOLIDATION_MAX_NIGHTS: 5,

    // ── Target-retention scheduler ──
    TARGET_R_LOW: 0.86,
    TARGET_R_BASE: 0.90,
    TARGET_R_EXAM: 0.93,
    EXAM_RAMP_DAYS: 90,
    LOW_WEIGHT_CW: 0.4,        // below this chapter weight ⇒ LOW target
    MIN_INTERVAL_DAYS: 0.04,   // ≈ 1 hour — never reschedule into the same tick
    MAX_INTERVAL_DAYS: 365,
};

const P = CORTEX_PARAMS;
const MS_PER_DAY = 86400000;
const MS_PER_HOUR = 3600000;

/** Safe-number coercion with fallback (NaN/undefined/corrupt tolerant). */
function _num(v, fallback) {
    const n = Number(v);
    return (typeof n === 'number' && isFinite(n)) ? n : fallback;
}

function _clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function _parseMs(iso) {
    if (!iso) return NaN;
    const t = new Date(iso).getTime();
    return isNaN(t) ? NaN : t;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tag normalization & namespaces
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical tag key normalization: trim, lowercase, collapse whitespace. */
export function normalizeTag(t) {
    return String(t == null ? '' : t).trim().toLowerCase().replace(/\s+/g, ' ');
}

const ERROR_CLASS_SET = { calculation: 1, conceptual: 1, misread: 1 };

/**
 * Persistent namespaces attached to a question: personal tags (A) + the
 * mistake-class virtual tag (B). Friction pills are EVENT tags (C) and only
 * exist at review-fold time — they are intentionally NOT stable item tags.
 * @returns {{key:string, ns:'personal'|'class'}[]} deduped, order-stable
 */
export function questionTagKeys(q) {
    const out = [];
    const seen = Object.create(null);
    if (q && Array.isArray(q.tags)) {
        for (const raw of q.tags) {
            const n = normalizeTag(raw);
            if (!n || seen['p:' + n]) continue;
            seen['p:' + n] = 1;
            out.push({ key: 'p:' + n, ns: 'personal' });
        }
    }
    const cls = q && q.errorReason ? normalizeTag(q.errorReason) : '';
    if (cls && ERROR_CLASS_SET[cls] && !seen['c:' + cls]) {
        seen['c:' + cls] = 1;
        out.push({ key: 'c:' + cls, ns: 'class' });
    }
    return out;
}

function _nsWeight(ns) {
    return ns === 'personal' ? P.NS_PERSONAL : ns === 'class' ? P.NS_ERRORCLASS : P.NS_FRICTION;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tag inventory (document frequencies → IDF weights)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Document frequency census over the bank's PERSONAL tag space.
 * Class/friction namespaces are excluded from IDF: they are a controlled
 * vocabulary whose ubiquity is meaningful, not noise.
 * @returns {{n:number, df:Map<string,number>, display:Map<string,string>}}
 */
export function buildTagInventory(bank) {
    const df = new Map();
    const display = new Map();
    const idfMemo = new Map();   // norm → clamped multiplier (hot-path memo)
    let n = 0;
    if (!Array.isArray(bank)) return { n, df, display, idfMemo };
    for (const q of bank) {
        n++;
        if (!q || !Array.isArray(q.tags)) continue;
        const local = new Set();
        for (const raw of q.tags) {
            const norm = normalizeTag(raw);
            if (!norm || local.has(norm)) continue;
            local.add(norm);
            df.set(norm, (df.get(norm) || 0) + 1);
            if (!display.has(norm) && typeof raw === 'string' && raw.trim()) {
                display.set(norm, raw.trim());
            }
        }
    }
    // Precompute every multiplier once per inventory build: tagIdfMultiplier
    // does two Math.log calls, and priority/tag-weight lookups hit this per
    // question per render — a Map lookup beats that by ~50x on big banks.
    for (const [norm, count] of df) idfMemo.set(norm, tagIdfMultiplier(count, n));
    return { n, df, display, idfMemo };
}

/**
 * IDF multiplier for one personal tag. Rare-and-corroborated tags weigh the
 * most; singletons are capped (corroboration rule); everything is clamped.
 */
export function tagIdfMultiplier(dfCount, bankN) {
    const df = Math.max(0, _num(dfCount, 0));
    const n = Math.max(1, _num(bankN, 1));
    const u = Math.log(1 + n / (1 + df)) / Math.log(1 + n);   // (0, 1]
    let mult = P.IDF_FLOOR + 0.9 * u;
    if (df < 2) mult = Math.min(mult, P.IDF_UNCORROBORATED_CAP);
    return _clamp(mult, P.IDF_FLOOR, P.IDF_CEIL);
}

/** Weight of one namespaced tag given the inventory (memoized when possible). */
function _tagKeyWeight(key, ns, inventory) {
    const w = _nsWeight(ns);
    if (!inventory || ns !== 'personal') return w;
    const norm = key.slice(2); // strip "p:"
    if (inventory.idfMemo instanceof Map) {
        const m = inventory.idfMemo.get(norm);
        if (m !== undefined) return w * m;
    }
    const df = inventory.df instanceof Map ? (inventory.df.get(norm) || 0) : 0;
    return w * tagIdfMultiplier(df, inventory.n);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Leak profiles — per-tag empirical forgetting signal
// ─────────────────────────────────────────────────────────────────────────────

function _parseFrictionArray(raw) {
    if (Array.isArray(raw)) return raw.filter(Boolean);
    if (typeof raw !== 'string' || !raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (_) { return []; }
}

function _blankProfile() {
    return {
        nW: 0,             // recency-weighted observation mass
        failsW: 0,         // recency-weighted failures
        recentN: 0, recentFails: 0,   // raw counts inside the trend window
        priorN: 0, priorFails: 0,     // raw counts before it
        lastFoldMs: NaN,
    };
}

/**
 * Recompute per-tag leak profiles from the bank's full attempt history.
 * Deterministic and persistence-free: cloud merges and restores can never
 * desync a stored profile because none exists.
 *
 * Every review folds into ALL namespaces live on the question (A + B) plus
 * the friction pills chosen ON that review (C) — tag accountability, matching
 * report.js's fold-everything convention.
 *
 * @returns {{profiles:Map<string,object>, globalFailRate:number}}
 */
export function computeTagProfiles(bank, opts) {
    const o = opts || {};
    const nowMs = _num(o.nowMs, Date.now());
    const recentCut = nowMs - P.TREND_RECENT_DAYS * MS_PER_DAY;
    const profiles = new Map();
    let gFails = 0, gObs = 0;

    const fold = (key, fail, w, ts) => {
        let prof = profiles.get(key);
        if (!prof) { prof = _blankProfile(); profiles.set(key, prof); }
        prof.nW += w;
        if (fail) prof.failsW += w;
        if (ts >= recentCut) { prof.recentN++; if (fail) prof.recentFails++; }
        else { prof.priorN++; if (fail) prof.priorFails++; }
        if (isNaN(prof.lastFoldMs) || ts > prof.lastFoldMs) prof.lastFoldMs = ts;
    };

    if (Array.isArray(bank)) {
        for (const q of bank) {
            if (!q || !Array.isArray(q.historyLogs) || q.historyLogs.length === 0) continue;
            const nsKeys = questionTagKeys(q);
            if (nsKeys.length === 0) continue;
            // Chronological walk: delay measured from the previous attempt
            // (or creation for the first) — that Δt is what the outcome tests.
            const times = q.historyLogs.map(l => _parseMs(l && l.timestamp)).filter(t => !isNaN(t));
            times.sort((a, b) => a - b);
            const createdMs = _parseMs(q.createdAt);
            let prevMs = (!isNaN(createdMs) && times.length && createdMs <= times[0]) ? createdMs : NaN;

            for (const log of q.historyLogs) {
                const ts = _parseMs(log && log.timestamp);
                if (isNaN(ts)) continue;
                const fail = String((log && log.result) || '') !== 'correct';
                const obsAgeDays = Math.max(0, (nowMs - ts) / MS_PER_DAY);
                const w = Math.exp(-obsAgeDays / P.LEAK_RECENCY_DAYS);
                gObs += 1; if (fail) gFails += 1;
                for (const { key } of nsKeys) fold(key, fail, w, ts);
                for (const f of _parseFrictionArray(log && log.frictionTypes)) {
                    fold('f:' + normalizeTag(f), fail, w, ts);
                }
                prevMs = ts; // delay itself unused by the shrunk estimator today;
                             // kept in the walk shape so a delay-conditioned
                             // model can slot in without re-plumbing callers.
            }
        }
    }

    const prior = gObs >= 8 ? gFails / gObs : P.LEAK_PRIOR_DEFAULT;
    const m = P.LEAK_PRIOR_STRENGTH;
    for (const prof of profiles.values()) {
        prof.leak = (prof.failsW + m * prior) / (prof.nW + m);
        const rOk = prof.recentN >= 2, pOk = prof.priorN >= 2;
        prof.trend = (rOk && pOk)
            ? ((prof.recentFails / prof.recentN) - (prof.priorFails / prof.priorN))
            : null;
    }
    return { profiles, globalFailRate: prior };
}

/** Leak [0,1] for one tag key, or null when never observed. */
export function leakOf(profiles, key) {
    if (!profiles || !(profiles instanceof Map)) return null;
    const prof = profiles.get(key);
    return prof ? _clamp(prof.leak, 0, 1) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Contagion — spreading activation over chapter/tag synapses
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recent lapse events across BOTH insertion paths:
 *   • vault historyLogs with a wrong result, AND
 *   • practice-mode fumbles (status error/wrong + recent lastSolvedAt — these
 *     never append a historyLog; see confirmErrorLog).
 * @returns {Array<{id:string, ms:number, chapter:string, subject:string, keys:string[]}>}
 */
export function collectLapseEvents(bank, opts) {
    const o = opts || {};
    const nowMs = _num(o.nowMs, Date.now());
    const windowMs = _num(o.windowDays, P.LAPSE_EVENT_WINDOW_DAYS) * MS_PER_DAY;
    const cap = Math.max(1, _num(o.cap, P.LAPSE_EVENT_CAP));
    const cutoff = nowMs - windowMs;
    const events = [];
    if (!Array.isArray(bank)) return events;

    for (const q of bank) {
        if (!q || q.id == null) continue;
        const keys = questionTagKeys(q).map(k => k.key);
        const chapter = String(q.chapter || '').trim().toLowerCase();
        const subject = String(q.subject || '').trim().toLowerCase();
        const seenMs = new Set();
        const push = (ms) => {
            // Decay is identical for every consumer within this collection
            // instant — bake it once here so synapseCharge's per-question loop
            // stays free of Math.pow (O(N×L) → O(L) pow calls per render).
            const decay = Math.pow(0.5, Math.max(0, nowMs - ms) /
                (P.CHARGE_HALF_LIFE_DAYS * MS_PER_DAY));
            events.push({ id: String(q.id), ms, chapter, subject, keys, _decay: decay });
        };

        if (Array.isArray(q.historyLogs)) {
            for (const log of q.historyLogs) {
                if (!log || String(log.result || '') === 'correct') continue;
                const ts = _parseMs(log.timestamp);
                if (isNaN(ts) || ts < cutoff || ts > nowMs || seenMs.has(ts)) continue;
                seenMs.add(ts);
                push(ts);
            }
        }
        // Practice-path fumble: status says error/wrong and the engine stamped
        // a fresh lastSolvedAt — treat it as one lapse at that instant.
        const st = String(q.status || '');
        if (st === 'error' || st === 'wrong') {
            const ls = _parseMs(q.lastSolvedAt);
            if (!isNaN(ls) && ls >= cutoff && ls <= nowMs && !seenMs.has(ls)) {
                push(ls);
            }
        }
    }
    events.sort((a, b) => b.ms - a.ms);
    return events.length > cap ? events.slice(0, cap) : events;
}

/**
 * Bounded spreading activation: how much do RECENT lapses of synaptically
 * related items raise this item's salience? Same chapter forms the baseline
 * edge; every shared tag adds an idf-weighted, log-compressed increment.
 * @param {object[]} lapseEvents output of collectLapseEvents
 * @param {Function} [weightFn] (tagKey) => weight — supply idf-weighted
 */
export function synapseCharge(q, lapseEvents, opts) {
    const o = opts || {};
    const nowMs = _num(o.nowMs, Date.now());
    if (!q || !Array.isArray(lapseEvents) || lapseEvents.length === 0) return 0;
    const myKeys = new Set(questionTagKeys(q).map(k => k.key));
    const myChapter = String(q.chapter || '').trim().toLowerCase();
    const mySubject = String(q.subject || '').trim().toLowerCase();
    const myId = q.id == null ? '' : String(q.id);
    const weightFn = typeof o.weightFn === 'function' ? o.weightFn : (() => 1);

    let charge = 0;
    for (const ev of lapseEvents) {
        if (ev.id === myId) continue;                       // never self-charge
        if (ev.subject && mySubject && ev.subject !== mySubject) continue;
        const sameChapter = !!ev.chapter && !!myChapter && ev.chapter === myChapter;
        let tagSum = 0;
        if (myKeys.size && Array.isArray(ev.keys)) {
            for (const k of ev.keys) {
                if (myKeys.has(k)) {
                    tagSum += weightFn(k);
                    if (tagSum > 20) break;                 // bounded loop work
                }
            }
        }
        if (!sameChapter && tagSum <= 0) continue;          // no synapse at all
        const edge = Math.min(P.EDGE_MAX,
            (sameChapter ? P.EDGE_CHAPTER_BASE : 0) + Math.log1p(tagSum));
        const decay = (ev._decay !== undefined) ? ev._decay
            : Math.pow(0.5, Math.max(0, nowMs - ev.ms) /
                (P.CHARGE_HALF_LIFE_DAYS * MS_PER_DAY));
        charge += edge * P.CHARGE_LAPSE_IMPACT * decay;
        if (charge >= P.CHARGE_MAX) break;                  // saturated
    }
    return _clamp(charge, 0, P.CHARGE_MAX);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Effective memory state — sleep consolidation (derived, never persisted)
// ─────────────────────────────────────────────────────────────────────────────

/** Local-midnight crossings between two instants (DST-safe enough for ±1h). */
function _nightsBetween(fromMs, toMs) {
    if (!isFinite(fromMs) || !isFinite(toMs) || toMs <= fromMs) return 0;
    const d = new Date(fromMs);
    d.setHours(24, 0, 0, 0);                    // next local midnight
    let nights = 0;
    while (d.getTime() <= toMs && nights < 30) { nights++; d.setDate(d.getDate() + 1); }
    return nights;
}

/**
 * Stability as the brain holds it RIGHT NOW: committed kernel stability,
 * inflated by up to CONSOLIDATION_MAX_NIGHTS of offline consolidation since
 * the last successful retrieval. Derived-only — persisting it would make a
 * later save double-count the same nights.
 */
export function effectiveStability(q, nowMs) {
    const mem = hydrateMemory(q);
    const now = _num(nowMs, Date.now());
    let anchorMs = NaN;
    if (Array.isArray(q && q.historyLogs)) {
        for (let i = q.historyLogs.length - 1; i >= 0; i--) {
            const log = q.historyLogs[i];
            if (log && String(log.result || '') === 'correct') {
                const t = _parseMs(log.timestamp);
                if (!isNaN(t)) { anchorMs = t; break; }
            }
        }
    }
    if (isNaN(anchorMs)) anchorMs = _parseMs(q && q.lastReviewedAt);
    const nights = Math.min(P.CONSOLIDATION_MAX_NIGHTS, _nightsBetween(anchorMs, now));
    return Math.max(FSRS_PARAMS.MIN_STABILITY, mem.stability * (1 + P.CONSOLIDATION_PER_NIGHT * nights));
}

/** Current retrievability under the consolidated (effective) stability. */
export function cortexRetrievability(q, nowMs) {
    const now = _num(nowMs, Date.now());
    const mem = hydrateMemory(q);
    let ref = isNaN(mem.lastMs) ? _parseMs(q && q.createdAt) : mem.lastMs;
    if (isNaN(ref)) ref = now;   // no anchor at all ⇒ treat as just-seen
    const deltaDays = Math.max(0, (now - ref) / MS_PER_DAY);
    return retrievabilityFrom(effectiveStability(q, now), deltaDays);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Priority field — the composite salience that replaces flat EF/R sorts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Composite priority. Higher = rehearse sooner. Pure read; never mutates.
 *
 * P = (1−R)^γ · Overdue · Importance · TagBoost(max) · Neglect · Contagion · FatigueBrake
 *
 * ctx: { nowMs?, examDateMs?, inventory?, profiles?, lapseEvents?,
 *        chapterWeight?(chapter)=>number }
 */
export function cortexPriority(q, ctx) {
    if (!q) return 0;
    const c = ctx || {};
    const now = _num(c.nowMs, Date.now());
    const mem = hydrateMemory(q);

    // ── Urgency: closeness to forgetting (consolidation-aware R) ──
    const effS = effectiveStability(q, now);
    const ref = !isNaN(mem.lastMs) ? mem.lastMs : _parseMs(q.createdAt);
    const deltaDays = Math.max(0, (now - (isNaN(ref) ? now : ref)) / MS_PER_DAY);
    const R = retrievabilityFrom(effS, deltaDays);
    const urgency = Math.pow(Math.max(0, 1 - R), P.URGENCY_GAMMA);

    // ── Overdue stress: saturating, superlinear-but-bounded ──
    const dueMs = _parseMs(q.nextReviewAt);
    const daysOverdue = (isNaN(dueMs) || dueMs <= 0)
        ? 0
        : Math.max(0, (now - dueMs) / MS_PER_DAY);
    const overdueF = 1 + P.OVERDUE_KAPPA * (1 - Math.exp(-daysOverdue / P.OVERDUE_TAU_DAYS));

    // ── Importance: implied difficulty × exam yield × exam proximity ──
    const qEloN = Math.sqrt(_clamp(_num(q.qElo, 1200), 400, 2550) / 2550);
    const cwRaw = typeof c.chapterWeight === 'function'
        ? _num(c.chapterWeight(q.chapter), 0.5) : 0.5;
    const cw = _clamp(cwRaw, 0.05, 1.2);
    let examRamp = 1;
    if (isFinite(c.examDateMs) && c.examDateMs > now) {
        const dte = (c.examDateMs - now) / MS_PER_DAY;
        examRamp = 1 + 0.4 * (1 - Math.min(1, dte / P.EXAM_RAMP_DAYS));
    }
    const importance = qEloN * cw * examRamp;

    // ── Tag boost: MAX over the item's tags of leak × idf × nsWeight ──
    //    max(), NEVER a sum — synonymous tag piles cannot stack (plan risk #4).
    let bestTagTerm = 0;
    if (c.profiles instanceof Map) {
        for (const { key, ns } of questionTagKeys(q)) {
            const L = leakOf(c.profiles, key);
            if (L == null) continue;
            const term = L * _tagKeyWeight(key, ns, c.inventory);
            if (term > bestTagTerm) bestTagTerm = term;
        }
    }
    const tagBoost = 1 + P.TAG_LEAK_LAMBDA * bestTagTerm;

    // ── Neglect: never-revisited mistakes slowly demand attention ──
    const createdMs = _parseMs(q.createdAt);
    const ageDays = isNaN(createdMs) ? 0 : Math.max(0, (now - createdMs) / MS_PER_DAY);
    const neglect = (mem.reps === 0)
        ? 1 + P.NEGLECT_RATE * Math.min(1, ageDays / P.NEGLECT_HORIZON_DAYS)
        : 1;

    // ── Contagion: bounded spreading activation from siblings' lapses ──
    const charge = Array.isArray(c.lapseEvents)
        ? synapseCharge(q, c.lapseEvents, { nowMs: now, weightFn: (k) => _tagKeyWeight(k, 'personal', c.inventory) })
        : 0;
    const contagionF = 1 + P.CONTAGION_CHI * charge;

    // ── Fatigue brake: don't re-serve what was just rehearsed ──
    const hoursSince = deltaDays * 24;
    const brake = 1 - P.FATIGUE_BRAKE_DEPTH * Math.exp(-Math.max(0, hoursSince) / P.FATIGUE_TAU_HOURS);

    return urgency * overdueF * importance * tagBoost * neglect * contagionF * brake;
}

/**
 * Winner-take-all-with-exploration selection: score, take the top-K pool,
 * draw without replacement by softmax temperature τ. Deterministic when the
 * caller injects an rng (tests pass () => 0.5).
 * @returns {object[]} ordered selected questions
 */
export function selectCortexQueue(candidates, ctx, opts) {
    const o = opts || {};
    const k = Math.max(1, _num(o.topK, P.QUEUE_TOPK));
    const want = Math.max(1, _num(o.count, candidates ? candidates.length : 0));
    const tau = Math.max(0.01, _num(o.tau, P.SOFTMAX_TAU));
    const rng = typeof o.rng === 'function' ? o.rng : Math.random;
    if (!Array.isArray(candidates) || candidates.length === 0) return [];

    const scored = candidates
        .map(q => ({ q, p: Math.max(0, _num(cortexPriority(q, ctx), 0)) }))
        .sort((a, b) => b.p - a.p || String(a.q.id).localeCompare(String(b.q.id)));
    const pool = scored.slice(0, Math.min(k, scored.length));

    const picked = [];
    const rest = pool.slice();
    const overflow = scored.slice(pool.length);
    while (picked.length < want && (rest.length || overflow.length)) {
        const source = rest.length ? rest : overflow;
        let total = 0;
        const ws = source.map(x => { const w = Math.exp(x.p / tau); total += w; return w; });
        let r = rng() * total, idx = 0;
        for (; idx < ws.length - 1; idx++) { r -= ws[idx]; if (r <= 0) break; }
        picked.push(source[idx].q);
        if (rest.length) rest.splice(idx, 1); else overflow.splice(idx, 1);
        // Pool drained but more candidates existed → refill from overflow.
        if (!rest.length && picked.length < want && overflow.length) {
            rest.push(...overflow.splice(0, Math.min(k, overflow.length)));
        }
    }
    return picked;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Target-retention scheduler — unifies WHEN across the dual engines
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Desired retention at schedule time. Far from the exam (or exam-less +
 * low-yield chapters) the brain is allowed to forget efficiently (0.86);
 * as exam day approaches retention targets tighten toward 0.93.
 */
export function targetRFor(q, opts) {
    const o = opts || {};
    const now = _num(o.nowMs, Date.now());
    const cwRaw = typeof o.chapterWeight === 'function' ? _num(o.chapterWeight(q && q.chapter), 0.5) : 0.5;
    const cw = _clamp(cwRaw, 0.05, 1.2);
    if (isFinite(o.examDateMs) && o.examDateMs > now) {
        const dte = (o.examDateMs - now) / MS_PER_DAY;
        const prox = 1 - Math.min(1, Math.max(0, dte) / P.EXAM_RAMP_DAYS);
        return P.TARGET_R_LOW + (P.TARGET_R_EXAM - P.TARGET_R_LOW) * prox;
    }
    return cw < P.LOW_WEIGHT_CW ? P.TARGET_R_LOW : P.TARGET_R_BASE;
}

/**
 * Interval achieving exactly `targetR` on the power-law curve:
 *   R(t,S) = (1 + F·t/S)^DECAY = targetR   ⇒   t = (S/F)(targetR^{1/DECAY} − 1)
 * Committed stability only — consolidation is an ephemeral read bonus and
 * must not double-count into the schedule.
 */
export function intervalForTargetR(stability, targetR) {
    const s = Math.max(FSRS_PARAMS.MIN_STABILITY, _num(stability, FSRS_PARAMS.MIN_STABILITY));
    const tr = _clamp(_num(targetR, P.TARGET_R_BASE), 0.5, 0.99);
    const t = (s / FSRS_PARAMS.FACTOR) * (Math.pow(tr, 1 / FSRS_PARAMS.DECAY) - 1);
    return _clamp(t, P.MIN_INTERVAL_DAYS, P.MAX_INTERVAL_DAYS);
}

/**
 * Cortex-authoritative next review instant for a question whose kernel state
 * was JUST committed. Returns null when the kernel hasn't taken over yet
 * (reps < 1 / corrupt state) so legacy SM-2 output remains authoritative for
 * brand-new items.
 * @returns {string|null} ISO timestamp
 */
export function scheduleNextReview(q, opts) {
    if (!q) return null;
    const mem = hydrateMemory(q);
    if (!(mem.reps >= 1) || !(mem.stability > 0)) return null;
    const targetR = targetRFor(q, opts);
    const days = intervalForTargetR(mem.stability, targetR);
    return new Date((_num(opts && opts.nowMs, Date.now())) + days * MS_PER_DAY).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Commit-time enrichment — age-at-solve priors + overdue spacing credit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capture the PRE-commit state a review is about to test against. Callers
 * MUST take this BEFORE writing new SR fields (nextReviewAt gets overwritten
 * by the commit itself).
 */
export function preReviewSnapshot(q, nowMs) {
    const now = _num(nowMs, Date.now());
    const dueMs = _parseMs(q && q.nextReviewAt);
    const createdMs = _parseMs(q && q.createdAt);
    const mem = hydrateMemory(q);
    const ref = !isNaN(mem.lastMs) ? mem.lastMs : createdMs;
    return {
        nowMs: now,
        dueMs: isNaN(dueMs) ? null : dueMs,
        daysOverdue: isNaN(dueMs) ? 0 : Math.max(0, (now - dueMs) / MS_PER_DAY),
        ageAtSolveDays: isNaN(createdMs) ? null : Math.max(0, (now - createdMs) / MS_PER_DAY),
        rBefore: cortexRetrievability(q, now),
        sBefore: mem.stability,
    };
}

/**
 * Apply cortex priors AFTER the kernel + SM-2 have committed their fields.
 * Mutates ONLY q.stability (single-aspect rule, mirroring
 * refineDifficultyAfterTag's no-double-counting discipline):
 *   • First vault review latency: <1d hot strike ⇒ S×1.15 (the mistake
 *     context was vivid); >7d cold revival ⇒ S capped at 3d (re-derived ≠
 *     recalled). Fires via attempt.vaultFirst (first drawer review of the
 *     item) OR automatically when the kernel shows this was its very first
 *     review ever (mem.reps === 1) — practice-fumbled items carry prior
 *     kernel reps, so the vault-first signal is the authoritative one.
 *   • Passing ≥3d overdue earns extra growth — the spacing effect worked
 *     FOR you; credit it (saturating at 30d late).
 * @returns {{ageClass:'hot'|'mid'|'cold'|null, spacingCredit:number}}
 */
export function commitCortexReview(q, snapshot, attempt, nowMs) {
    const empty = { ageClass: null, spacingCredit: 0 };
    if (!q) return empty;
    try {
        const mem = hydrateMemory(q);
        const out = { ageClass: null, spacingCredit: 0 };

        const vaultFirst = !!(attempt && attempt.vaultFirst);
        if ((vaultFirst || mem.reps === 1) && snapshot && isFinite(snapshot.ageAtSolveDays)) {
            const lat = snapshot.ageAtSolveDays;
            if (lat < P.HOT_STRIKE_DAYS) {
                out.ageClass = 'hot';
                q.stability = Math.min(180, q.stability * P.HOT_S_MULT);
            } else if (lat > P.COLD_REVIVAL_DAYS) {
                out.ageClass = 'cold';
                q.stability = Math.min(q.stability, P.COLD_S_CAP);
            } else {
                out.ageClass = 'mid';
            }
        }

        const correct = !!(attempt && attempt.correct);
        const od = snapshot ? Math.max(0, _num(snapshot.daysOverdue, 0)) : 0;
        if (correct && od >= P.SPACING_CREDIT_MIN_OVERDUE) {
            out.spacingCredit = P.SPACING_CREDIT_RATE *
                Math.min(1, od / P.SPACING_CREDIT_SAT_DAYS);
            q.stability = q.stability * (1 + out.spacingCredit);
        }
        return out;
    } catch (_) {
        return empty;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Migration — additive, idempotent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-time backfill of `createdAt`. Never removes or overwrites anything.
 * Derivation chain: EARLIEST historyLog timestamp → lastSolvedAt →
 * lastReviewedAt → nextReviewAt → now. Returns true if mutated.
 */
export function migrateCortexFields(q) {
    if (!q) return false;
    if (typeof q.createdAt === 'string' && q.createdAt && !isNaN(Date.parse(q.createdAt))) return false;
    let best = NaN;
    if (Array.isArray(q.historyLogs)) {
        for (const log of q.historyLogs) {
            const t = _parseMs(log && log.timestamp);
            if (!isNaN(t) && (isNaN(best) || t < best)) best = t;
        }
    }
    if (isNaN(best)) best = _parseMs(q.lastSolvedAt);
    if (isNaN(best)) best = _parseMs(q.lastReviewedAt);
    if (isNaN(best)) best = _parseMs(q.nextReviewAt);
    q.createdAt = new Date(isNaN(best) ? Date.now() : best).toISOString();
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Tag suggestions — prevention at input (synonym-drift defense #1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rank the bank's existing vocabulary for suggestion chips: same-chapter use
 * counts ×3, same-subject ×2, everything else ×1. Existing tags excluded.
 * @returns {{label:string, count:number}[]}
 */
export function suggestTags(bank, subject, chapter, existingTags, limit) {
    const lim = Math.max(1, _num(limit, 5));
    const exclude = new Set((Array.isArray(existingTags) ? existingTags : []).map(normalizeTag));
    const mySubj = normalizeTag(subject);
    const myChap = normalizeTag(chapter);
    const score = new Map();   // norm → {w, label}
    if (!Array.isArray(bank)) return [];
    for (const q of bank) {
        if (!q || !Array.isArray(q.tags)) continue;
        const sameSubj = mySubj && normalizeTag(q.subject) === mySubj;
        const sameChap = sameSubj && myChap && normalizeTag(q.chapter) === myChap;
        for (const raw of q.tags) {
            const norm = normalizeTag(raw);
            if (!norm || exclude.has(norm)) continue;
            const w = sameChap ? 3 : sameSubj ? 2 : 1;
            let e = score.get(norm);
            if (!e) { e = { w: 0, label: String(raw).trim() }; score.set(norm, e); }
            e.w += w;
        }
    }
    return [...score.entries()]
        .sort((a, b) => b[1].w - a[1].w || a[0].localeCompare(b[0]))
        .slice(0, lim)
        .map(([norm, e]) => ({ label: e.label || norm, count: e.w }));
}
