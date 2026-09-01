/* ============================================================================
   directive.js — DAILY DIRECTIVE (target-system v2)
   Replaces the static 10/10/10 solve quota + dead 5/5/5 fix quota + 24h lock
   with a computed daily Contract denominated in Load Units (LU), a quest
   layer, variable rewards (Voltage Spin) and dynamic difficulty adjustment.

   Design: docs/daily-directive-design.md

   Data inputs (all already tracked by the app):
     - AppState.moodMultiplier        → capacity (includes Night Guard sleep debt)
     - AppState.elo / q.qElo          → difficulty multiplier
     - chapter weights (user>AI>static) → weight multiplier
     - AppState.chapterTheta          → headline quest selection
     - question bank due queue        → demand term + Debt Collector quest
     - jeemax_focus_ledger (pomodoro) → Deep Dive quest + focus LU
     - AppState.calibrationLog        → Confidence Game quest
     - bounty system                  → Bounty Hunt quest
     - jeemax_directive_history       → 7-day base + DDA hit-rate

   Contract with the rest of the app:
     - storage.js changeCount() fires the registered `onSolveLogged` UI callback
       for every solve unit (single chokepoint — no path can be missed and none
       can double-count). Rich paths (practice modal, SR drawer) call
       Directive.markPending() FIRST to upgrade that unit's pricing.
     - app.js runNewDayCycle() calls Directive.settle() before zeroing counters.
     - AppState.activeTargets is DERIVED from the contract so every legacy
       visual (heatmap, candles, streak) keeps working on top of v2 targets.
   ============================================================================ */

import { AppState, idbGet, idbSet, todayLocalKey } from './storage.js';
import { getChapterWeight } from './chapter-weights.js';

const SUBJECTS = ['physics', 'chemistry', 'maths'];
const STATE_KEY = 'jeemax_directive_v1';
const HISTORY_KEY = 'jeemax_directive_history';
const META_KEY = 'jeemax_directive_meta';

const COLD_START_LU = 12;          // per-subject contract before 7 days of history
const FLOOR_RATIO = 0.6;           // contract can never sink below 60% of trailing base
const CEIL_RATIO = 1.4;            // …nor balloon above 140%
const EXPECTED_LU_PER_SOLVE = 1.3; // derives legacy solve-count targets from the LU contract
const DDA_TARGET_HIT_RATE = 0.78;  // flow channel: aim to win ~78% of days
const FULL_CLEAR_KEYS = 4;         // legacy cap for reward math only

/** Day cleared = BOTH side quests + the headline when one exists (an empty
 *  question bank has no headline — demanding it there would make clearing
 *  permanently unreachable for new users). */
function _requiredKeys() {
    return (state.headline ? 1 : 0) + 2;
}

const _today = () => todayLocalKey();
const _clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const _round1 = v => Math.round(v * 10) / 10;
const _median = arr => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ── Module state ────────────────────────────────────────────────────────────
let state = null;    // today's directive (see _freshState)
let meta = null;     // cross-day: DDA factor, rest tokens, golden flame, quest stats
let _pendingDetail = null; // one-shot enrichment for the next onSolveLogged unit
let _saving = null;  // coalesce state writes

function _freshState(date) {
    return {
        date,
        contract: { physics: COLD_START_LU, chemistry: COLD_START_LU, maths: COLD_START_LU },
        lu: { physics: 0, chemistry: 0, maths: 0 },
        luByChapter: {},
        solveUnits: { physics: 0, chemistry: 0, maths: 0 }, // decay counters
        fixes: 0,
        focusBlocks: { physics: 0, chemistry: 0, maths: 0 },
        accuracy: { correct: 0, total: 0 },
        beats: 0,            // target-time beats (Beat-the-clock quest)
        taxActive: false,    // accuracy < 40% halts full LU accrual until a fix lands
        headline: null,      // {subject, chapter, luNeeded, prog, done, due}
        quests: [],          // [{id, type, label, target, prog, done}]
        keys: 0,
        fullCleared: false,
        spinPending: false,
        settled: false,
        grade: null,
        bountyTaxed: false,
        mockDay: null,       // {running, done} — the mock replaces the contract
        recoveryDay: false,  // two misses in a row → visibly smaller, winnable day
    };
}

function _freshMeta() {
    return {
        ddaFactor: 1.0,
        hitWindow: [],       // last 28 {date, hit}
        missStreak: 0,       // consecutive missed days → triggers recovery days
        settledCount: 0,
        weeklyLine: null,    // once-a-week "rank runway" line for the debrief
        restTokens: 0,
        goldenUntil: 0,
        overcharge: null,    // {date, contractMul, luMul} consumed by ensureToday
        questStats: {},      // type → {offered, done}
        spins: 0,
    };
}

function _save() {
    if (_saving) return _saving;
    _saving = (async () => {
        try {
            await idbSet(STATE_KEY, state);
            await idbSet(META_KEY, meta);
        } catch (e) { console.error('directive save fault', e); }
        _saving = null;
    })();
    return _saving;
}

async function _loadAll() {
    const [s, m] = await Promise.all([idbGet(STATE_KEY), idbGet(META_KEY)]);
    state = (s && s.date === _today()) ? Object.assign(_freshState(_today()), s) : null;
    meta = Object.assign(_freshMeta(), (m && typeof m === 'object') ? m : {});
    if (!Array.isArray(meta.hitWindow)) meta.hitWindow = [];
}

// ── Pricing: Load Units ─────────────────────────────────────────────────────

/** Per-question band target time (seconds) — local stand-in for app.js's
 *  _eloBandTargetTime so directive.js stays decoupled from the Elo module. */
function _bandTargetSecs(qElo) {
    return _clamp(120 + ((Number(qElo) || 1200) - 1200) * 0.3, 60, 600);
}

function _decay(sub) {
    const n = state.solveUnits[sub] || 0;
    return 1 / (1 + 0.06 * n);
}

function _modeMul() {
    const m = AppState.practiceFlowMode || AppState.practiceMode;
    if (m === 'hardcore') return 1.3;
    if (m === 'flow') return 1.1;
    return 1.0;
}

function _accuracyRate() {
    return state.accuracy.total >= 5 ? state.accuracy.correct / state.accuracy.total : 1;
}

/** Unit price for one logged solve/fix, in LU. */
function _priceUnit(detail) {
    const sub = detail.subject;
    const decay = _decay(sub);
    state.solveUnits[sub] = (state.solveUnits[sub] || 0) + 1;
    const tax = state.taxActive ? 0.5 : 1;

    if (detail.type === 'fix') return 1.4 * decay * tax;

    let lu = 1 * decay * tax;
    const maps = { overrides: AppState.userChapterWeights, ai: AppState.chapterWeights };
    lu *= 0.8 + 1.2 * getChapterWeight(detail.chapter, maps);
    const qElo = Number(detail.qElo);
    const userElo = Number(AppState.elo && AppState.elo[sub]) || 1200;
    if (qElo > 0) lu *= _clamp(qElo / userElo, 0.55, 1.9);
    lu *= _modeMul();
    if (detail.firstTry) lu *= 1.15;
    // Conquest headline chapter pays 1.5× for the day.
    if (state.headline && detail.chapter === state.headline.chapter && !state.headline.done) lu *= 1.5;
    // Overcharge reward: all LU ×1.25 for the overcharged day.
    if (meta.overcharge && meta.overcharge.date === _today()) lu *= meta.overcharge.luMul;
    // Rushed vanity solves: under 20% of the band target earns almost nothing.
    if (detail.timeMins != null && detail.timeMins * 60 < 0.2 * _bandTargetSecs(detail.qElo)) lu = Math.min(lu, 0.3);
    return lu;
}

// ── Solve chokepoint (wired via app.js registerUiCallbacks) ─────────────────

/** Called by app.js for every changeCount unit (positive delta only).
 *  Consumes a pending detail if a rich path left one; otherwise prices a
 *  plain unit (dashboard steppers, legacy paths). */
function onSolveLogged(subject, delta) {
    if (!state || (delta | 0) <= 0) return;
    _ensureTodaySync();
    const sub = subject;
    const detail = { ...(_pendingDetail || {}), subject: sub };
    detail.type = (_pendingDetail && _pendingDetail.type === 'fix') ? 'fix' : 'solve';
    _pendingDetail = null;

    let gained = 0;
    for (let i = 0; i < (delta | 0); i++) {
        gained += detail.type === 'fix' ? _priceUnit({ ...detail, type: 'fix' })
                                        : _priceUnit({ ...detail, type: 'solve' });
    }
    if (detail.type === 'fix') state.fixes += 1;
    if (detail.type === 'solve') {
        state.accuracy.total += 1;
        if (detail.isCorrect !== false && detail.firstTry !== false) state.accuracy.correct += 1;
        if (detail.timeMins != null && detail.timeMins * 60 <= _bandTargetSecs(detail.qElo)) state.beats += 1;
        // Accuracy tax arms once the day has enough samples to be meaningful.
        if (state.accuracy.total >= 8 && state.accuracy.correct / state.accuracy.total < 0.4) state.taxActive = true;
    }
    state.lu[sub] = _round1((state.lu[sub] || 0) + gained);
    if (detail.chapter) state.luByChapter[detail.chapter] = _round1((state.luByChapter[detail.chapter] || 0) + gained);
    _afterActivity();
}

/** Rich paths call this BEFORE their changeCount() so the unit is priced
 *  with full context. One-shot: consumed by the next onSolveLogged. */
function markPending(detail) {
    if (!detail || !detail.subject) return;
    _pendingDetail = detail;
}

// ── Non-solve LU sources ────────────────────────────────────────────────────

function awardFocus(subject) {
    if (!state) return;
    _ensureTodaySync();
    const sub = SUBJECTS.indexOf(subject) >= 0 ? subject : 'physics';
    if (state.focusBlocks[sub] >= 3) return; // focus can't replace solving
    state.focusBlocks[sub] += 1;
    state.lu[sub] = _round1(state.lu[sub] + (state.taxActive ? 1 : 2));
    _afterActivity('focus');
}

/** Bounty failure tax (replaces the old baseTargets +=5 / re-lock behaviour). */
function applyBountyTax(subject) {
    if (!state || state.bountyTaxed) return;
    _ensureTodaySync();
    const sub = SUBJECTS.indexOf(subject) >= 0 ? subject : 'physics';
    state.contract[sub] = Math.round(state.contract[sub] * 1.25);
    state.bountyTaxed = true;
    _deriveLegacyTargets();
    _save();
}

// ── Post-award pipeline: quests → FULL CLEAR → spin ─────────────────────────

function _afterActivity(kind) {
    _updateQuestProgress();
    const wasCleared = state.fullCleared;
    if (!state.fullCleared && state.keys >= _requiredKeys()) {
        state.fullCleared = true;
        state.spinPending = true;
    }
    _save();
    // Never block the solve path on UI work.
    Promise.resolve().then(() => {
        try { window.dispatchEvent(new CustomEvent('jmax:directive-updated')); } catch (_) {}
        if (!wasCleared && state.fullCleared) _openSpin('FULL CLEAR — Voltage Spin unlocked');
    });
}

function _updateQuestProgress() {
    // Mock day: the mock IS the contract. A finished paper clears the day.
    if (state.mockDay) {
        state.mockDay = _detectMockDay() || state.mockDay;
        if (state.mockDay.done && !state.fullCleared) {
            state.fullCleared = true;
            state.spinPending = true;
        }
        return;
    }
    let keysBefore = state.keys;
    state.quests.forEach(q => {
        if (q.done) return;
        q.prog = _questProgress(q);
        if (q.prog >= q.target) {
            q.done = true;
            const st = meta.questStats[q.type] || (meta.questStats[q.type] = { offered: 0, done: 0 });
            st.done += 1;
            state.keys += 1;
        }
    });
    if (state.headline && !state.headline.done) {
        const got = state.luByChapter[state.headline.chapter] || 0;
        state.headline.prog = _round1(got);
        if (got >= state.headline.luNeeded) {
            state.headline.done = true;
            state.keys += 1;
        }
    }
    if (state.keys !== keysBefore) {
        try { window.FX && window.FX.sound && window.FX.sound('success'); } catch (_) {}
    }
}

function _questProgress(q) {
    switch (q.type) {
        case 'sharpshooter': return Math.min(state.accuracy.total, q.target) >= q.target
            ? q.target * (state.accuracy.correct / Math.max(1, state.accuracy.total) >= 0.7 ? 1 : 0)
            : Math.min(state.accuracy.total, q.target);
        case 'speedrun': return Math.min(state.beats, q.target);
        case 'deepdive': {
            const total = SUBJECTS.reduce((a, s) => a + (state.focusBlocks[s] || 0), 0);
            return Math.min(total, q.target);
        }
        case 'debtcollector': return Math.min(state.fixes, q.target);
        case 'bountyhunt': {
            const b = AppState.bounty;
            return (b && b.done && b.date === _today()) ? 1 : 0;
        }
        default: return 0;
    }
}

const QUEST_POOL = [
    { type: 'sharpshooter', label: 'Keep accuracy above 70% across 10 solves', target: 10 },
    { type: 'speedrun',     label: 'Beat the clock on 5 questions', target: 5 },
    { type: 'deepdive',     label: 'Two deep focus blocks', target: 2 },
    { type: 'debtcollector', label: 'Clear 4 old mistakes', target: 4 },
    { type: 'bountyhunt',   label: 'Win today\u2019s bounty', target: 1 },
];

/** ε-greedy draw (ε = 0.2). TWO side quests + the headline = the whole day —
 *  three plain sentences, never more (simplification pass v2.1). */
function _drawQuests(dueCount) {
    const pool = QUEST_POOL.filter(q => q.type !== 'debtcollector' || dueCount > 0);
    const scored = pool.map(q => {
        const st = meta.questStats[q.type] || { offered: 0, done: 0 };
        const rate = st.offered > 0 ? st.done / st.offered : 0.5;
        return { q, key: rate + Math.random() * 0.4 }; // learn what you actually finish
    }).sort((a, b) => a.key - b.key);
    let picked;
    if (Math.random() < 0.2) {
        picked = [...pool].sort(() => Math.random() - 0.5).slice(0, 2);
    } else {
        picked = scored.slice(0, 2).map(s => s.q);
    }
    picked.forEach(q => {
        const st = meta.questStats[q.type] || (meta.questStats[q.type] = { offered: 0, done: 0 });
        st.offered += 1;
    });
    return picked.map(q => ({ ...q, prog: 0, done: false }));
}

// ── Headline quest: argmax(weight × weakness × leak × neglect) ──────────────

function _pickHeadline() {
    const bank = Array.isArray(AppState.questionBank) ? AppState.questionBank : [];
    const byChapter = {};
    const now = Date.now();
    bank.forEach(q => {
        const ch = q.chapter; if (!ch) return;
        const c = byChapter[ch] || (byChapter[ch] = { n: 0, due: 0, lastSolved: 0 });
        c.n += 1;
        if ((q.errorReason || q.status === 'error' || q.status === 'wrong') &&
            (!q.nextReviewAt || q.nextReviewAt <= now)) c.due += 1;
        if (q.lastSolvedAt) c.lastSolved = Math.max(c.lastSolved, q.lastSolvedAt);
    });
    const theta = AppState.chapterTheta || {};
    let best = null, bestScore = -1;
    Object.keys(byChapter).forEach(ch => {
        const c = byChapter[ch];
        if (c.n < 2) return;
        const maps = { overrides: AppState.userChapterWeights, ai: AppState.chapterWeights };
        const w = getChapterWeight(ch, maps);
        const weak = 1 - _clamp(Number(theta[ch]) ?? 0.5, 0, 1);
        const leak = Math.min(1, c.due / 5);
        const daysIdle = c.lastSolved ? (now - c.lastSolved) / 86400000 : 14;
        const neglect = Math.min(1, daysIdle / 14);
        const score = w * weak * (0.5 + leak) * (0.5 + neglect);
        if (score > bestScore) { bestScore = score; best = { ch, w, due: c.due }; }
    });
    if (!best) return null;
    const subject = (() => {
        const q = bank.find(q => q.chapter === best.ch);
        return q ? normSubjKeyCompat(q.subject) : 'physics';
    })();
    return {
        subject,
        chapter: best.ch,
        luNeeded: 5 + Math.round(4 * best.w),
        prog: 0,
        done: false,
        due: best.due,
    };
}

// storage.js normSubjKey is not imported (avoid pulling mutation deps); local canon.
function normSubjKeyCompat(s) {
    s = String(s || '').toLowerCase().trim();
    if (s === 'math' || s === 'mathematics') return 'maths';
    return SUBJECTS.indexOf(s) >= 0 ? s : 'physics';
}

// ── Contract computation ────────────────────────────────────────────────────

function _dueCountBySubject() {
    const bank = Array.isArray(AppState.questionBank) ? AppState.questionBank : [];
    const now = Date.now();
    const out = { physics: 0, chemistry: 0, maths: 0 };
    bank.forEach(q => {
        if (!(q.errorReason || q.status === 'error' || q.status === 'wrong')) return;
        if (q.nextReviewAt && q.nextReviewAt > now) return;
        out[normSubjKeyCompat(q.subject)] += 1;
    });
    return out;
}

async function _historyLU(sub) {
    try {
        const h = await idbGet(HISTORY_KEY);
        if (!Array.isArray(h)) return [];
        return h.slice(-7).map(d => (d.earned && d.earned[sub]) || 0).filter(v => v > 0);
    } catch (_) { return []; }
}

/** Mock day: a scheduled/run mock REPLACES the contract (the mock IS the day).
 *  Detected from the mock ledger — a run started or a paper finished today. */
function _detectMockDay() {
    try {
        const mocks = Array.isArray(AppState.mocks) ? AppState.mocks : [];
        const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
        let running = false, done = false;
        mocks.forEach(m => {
            if (m && m.run && m.run.startedAt && m.run.startedAt >= midnight.getTime()) running = true;
            if (m && m.finishedAt && m.finishedAt >= midnight.getTime()) done = true;
        });
        return (running || done) ? { running: running && !done, done } : null;
    } catch (_) { return null; }
}

async function _computeContract(preserveQuests) {
    const due = _dueCountBySubject();
    const capacity = _clamp(AppState.moodMultiplier || 1.0, 0.6, 1.25);
    const over = meta.overcharge && meta.overcharge.date === _today() ? meta.overcharge : null;
    // Death-spiral insurance: two consecutive misses → tomorrow is immediately,
    // visibly smaller. DDA is too slow for this; the chain must survive.
    const recovery = (meta.missStreak || 0) >= 2;
    state.recoveryDay = recovery;
    state.mockDay = _detectMockDay();

    for (const sub of SUBJECTS) {
        const hist = await _historyLU(sub);
        const base = _median(hist) || COLD_START_LU;
        const demand = 1 + 0.15 * Math.min(1, due[sub] / 8);
        let c = base * capacity * demand * (meta.ddaFactor || 1.0);
        if (recovery) c *= 0.7;
        if (over) c *= over.contractMul;
        c = Math.round(_clamp(c, Math.ceil(base * FLOOR_RATIO), Math.ceil(base * CEIL_RATIO)));
        state.contract[sub] = Math.max(4, c);
    }
    if (!preserveQuests) {
        state.headline = _pickHeadline();
        state.quests = _drawQuests(SUBJECTS.reduce((a, s) => a + due[s], 0));
    }
    if (over) meta.overcharge = null; // consumed
}

/** Derive legacy per-subject solve-count targets so the heatmap, candles and
 *  streak all keep flowing from v2 targets without touching their code. */
function _deriveLegacyTargets() {
    const total = SUBJECTS.reduce((a, s) => a + state.contract[s], 0);
    SUBJECTS.forEach(sub => {
        AppState.activeTargets[sub] = Math.max(3, Math.round(state.contract[sub] / EXPECTED_LU_PER_SOLVE));
    });
    return total;
}

/** Recompute today's contract against the CURRENT capacity (mood/sleep) while
 *  preserving quest progress — used after morning mood calibration. */
async function recalibrateCapacity() {
    if (!state) { await ensureToday(); return; }
    await _computeContract(true);
    _deriveLegacyTargets();
    await _save();
    try { window.dispatchEvent(new CustomEvent('jmax:directive-updated')); } catch (_) {}
}

/** Idempotent, async-safe daily bootstrap. Returns the live state. */
async function ensureToday() {
    await _loadAll();
    if (!state) {
        state = _freshState(_today());
        await _computeContract();
        await _save();
        _toastDirective();
    }
    _deriveLegacyTargets();
    return state;
}

/** Synchronous guard used inside award paths (contract already exists). */
function _ensureTodaySync() {
    if (!state || state.date !== _today()) {
        state = state && state.date !== _today() ? _freshState(_today()) : (state || _freshState(_today()));
        // Contract fields keep cold-start values until the async ensure runs;
        // awards still accrue against them so nothing is lost.
    }
}

/** One-sentence morning debrief (simplification pass v2.1): yesterday in
 *  native units, today's size, and — when real — the leak teaser. */
async function _toastDirective() {
    if (typeof window.__jmaxAppToast !== 'function') return;
    const parts = [];
    try {
        const h = await idbGet(HISTORY_KEY);
        const y = Array.isArray(h) && h.length ? h[h.length - 1] : null;
        if (y) {
            const probs = Math.round(SUBJECTS.reduce((a, s) => a + ((y.earned && y.earned[s]) || 0), 0) / EXPECTED_LU_PER_SOLVE);
            const acc = (y.acc != null) ? ` at ${Math.round(y.acc * 100)}% accuracy` : '';
            parts.push(`Yesterday: ${probs} problems${acc}.`);
        }
    } catch (_) {}
    if (state.recoveryDay) parts.push('Recovery day — smaller target, the chain is alive.');
    const totalRemaining = Math.max(0, SUBJECTS.reduce((a, s) => a + state.contract[s], 0));
    parts.push(`Today: ~${Math.max(1, Math.round(totalRemaining / EXPECTED_LU_PER_SOLVE))} problems.`);
    if (state.headline && (state.headline.due || 0) > 0) {
        parts.push(`Something\u2019s leaking in ${state.headline.chapter}.`);
    }
    if (state.mockDay) parts.push('Mock day — the mock IS today\u2019s target.');
    if (meta.weeklyLine) { parts.push(meta.weeklyLine); meta.weeklyLine = null; _save(); }
    window.__jmaxAppToast(`⚡ ${parts.join(' ')}`);
}

// ── Native-language day summary (consumed by app.js updateUI + the card) ────

const _hourNow = () => new Date().getHours();

/** Fraction of the productive day elapsed (07:00→23:00), for the pace tick. */
function getPaceFraction() {
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const start = 7 * 60, end = 23 * 60;
    return _clamp((mins - start) / (end - start), 0, 1);
}

/** Whole problems left today, weighted (LU ÷ typical LU-per-solve). */
function problemsRemaining(sub) {
    if (!state) return 0;
    const c = sub ? (state.contract[sub] || 0) : SUBJECTS.reduce((a, s) => a + state.contract[s], 0);
    const e = sub ? (state.lu[sub] || 0) : SUBJECTS.reduce((a, s) => a + (state.lu[s] || 0), 0);
    return Math.max(0, Math.ceil((c - e) / EXPECTED_LU_PER_SOLVE));
}

function isNightCalm() { return _hourNow() >= 23; }

// ── Settlement (called from runNewDayCycle BEFORE counters zero) ────────────

function _gradeOf(heat, acc) {
    if (heat >= 1.3 && state.keys >= _requiredKeys() && acc >= 0.75) return 'S';
    if (heat >= 1.0) return 'A';
    if (heat >= 0.7) return 'B';
    return 'C';
}

async function settle() {
    // The app may boot straight into a new day (user didn't have it open at
    // midnight) — hydrate yesterday's stored directive from IDB before
    // deciding there's nothing to archive. Raw read: _loadAll() deliberately
    // discards stale-date states, which is exactly what we want here.
    if (!state) {
        try {
            const s = await idbGet(STATE_KEY);
            if (s && s.date) state = Object.assign(_freshState(s.date), s);
        } catch (_) {}
    }
    if (!state || state.settled || state.date === _today()) { state = null; return; }
    const totalContract = SUBJECTS.reduce((a, s) => a + state.contract[s], 0);
    const totalEarned = SUBJECTS.reduce((a, s) => a + state.lu[s], 0);
    const heat = totalContract > 0 ? totalEarned / totalContract : 0;
    const acc = state.accuracy.total >= 5 ? state.accuracy.correct / state.accuracy.total : null;
    const hit = heat >= 1.0 || (state.mockDay && state.mockDay.done);
    const grade = _gradeOf(heat, acc == null ? (heat >= 1 ? 0.8 : 0) : acc);
    state.grade = grade;
    state.settled = true;

    // Death-spiral insurance bookkeeping: a miss raises the streak (which
    // shrinks tomorrow immediately), a hit clears it.
    meta.missStreak = hit ? 0 : (meta.missStreak || 0) + 1;
    meta.settledCount = (meta.settledCount || 0) + 1;

    // History append (cap ~400 days) — same append-only discipline as the ledger.
    try {
        const h = await idbGet(HISTORY_KEY);
        const arr = Array.isArray(h) ? h : [];
        arr.push({
            date: state.date,
            contract: { ...state.contract },
            earned: { ...state.lu },
            grade,
            keys: state.keys,
            hit,
            acc,
        });
        await idbSet(HISTORY_KEY, arr.slice(-400));
    } catch (e) { console.error('directive history fault', e); }

    // DDA: nudge the factor toward the 78% flow channel (damped, clamped).
    meta.hitWindow.push({ date: state.date, hit });
    if (meta.hitWindow.length > 28) meta.hitWindow = meta.hitWindow.slice(-28);
    const rate = meta.hitWindow.length >= 3
        ? meta.hitWindow.filter(d => d.hit).length / meta.hitWindow.length
        : DDA_TARGET_HIT_RATE;
    meta.ddaFactor = _clamp((meta.ddaFactor || 1.0) + (DDA_TARGET_HIT_RATE - rate) * 0.08, 0.65, 1.45);

    // Weekly runway line (debrief only, every 7th settled day): pace vs the
    // contract, and the rough distance to the exam horizon.
    if (meta.settledCount % 7 === 0) {
        try {
            const h = await idbGet(HISTORY_KEY);
            const last7 = (Array.isArray(h) ? h : []).slice(-7);
            const earned = last7.reduce((a, d) => a + SUBJECTS.reduce((x, s) => x + ((d.earned && d.earned[s]) || 0), 0), 0);
            const planned = last7.reduce((a, d) => a + SUBJECTS.reduce((x, s) => x + ((d.contract && d.contract[s]) || 0), 0), 0);
            meta.weeklyLine = `This week you banked ${Math.round(earned / EXPECTED_LU_PER_SOLVE)} of ~${Math.round(planned / EXPECTED_LU_PER_SOLVE)} problems (${planned > 0 ? Math.round(100 * earned / planned) : 0}% pace) · ${_daysToAdvanced()} days to Advanced.`;
        } catch (_) { meta.weeklyLine = null; }
    }

    state = null; // fresh state computed by next boot's ensureToday()
    await idbSet(META_KEY, meta).catch(() => {});
    await idbSet(STATE_KEY, null).catch(() => {});
}

/** Rough horizon: days until the next late-May JEE Advanced window. */
function _daysToAdvanced() {
    const now = new Date(); now.setHours(12, 0, 0, 0);
    let year = now.getFullYear();
    const advanced = (y) => new Date(y, 4, 25); // ~late May
    let target = advanced(year);
    if (target.getTime() < now.getTime()) target = advanced(year + 1);
    return Math.round((target - now) / 86400000);
}

// ── The Box (mystery reward; opens when the day is cleared) ─────────────────
// Three legible prizes only (simplification pass v2.1). Odds stay hidden —
// variance is what drives the dopamine, not a visible table.

const BOX_PRIZES = [
    { tier: 'rest',    w: 0.45, title: 'REST TOKEN',   desc: 'An Earned Rest is now claimable — spend it before burnout spends you.' },
    { tier: 'lighter', w: 0.40, title: 'LIGHTER TOMORROW', desc: 'Tomorrow\u2019s target shrinks by a fifth. Bank it or bank rest — both are wins.' },
    { tier: 'golden',  w: 0.15, title: 'GOLDEN FLAME', desc: 'Seven days of golden fire + bounty payoff ×3. Legendary week begins.' },
];

async function _rollSpin() {
    const roll = Math.random();
    let acc = 0, picked = BOX_PRIZES[0];
    for (const t of BOX_PRIZES) { acc += t.w; if (roll <= acc) { picked = t; break; } }
    await _applyReward(picked.tier);
    await idbSet(META_KEY, meta).catch(() => {});
    return picked;
}

async function _applyReward(tier) {
    if (tier === 'rest') {
        meta.restTokens += 1;
    } else if (tier === 'lighter') {
        // Pure contract relief, no multiplier strings attached.
        meta.overcharge = { date: _addDays(_today(), 1), contractMul: 0.8, luMul: 1.0 };
    } else if (tier === 'golden') {
        meta.goldenUntil = Date.now() + 7 * 86400000;
    }
    await _save();
}

function _addDays(key, n) {
    const d = new Date(key + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Public API ──────────────────────────────────────────────────────────────

function _heatTotal() {
    if (!state) return 0;
    const c = SUBJECTS.reduce((a, s) => a + state.contract[s], 0);
    const e = SUBJECTS.reduce((a, s) => a + (state.lu[s] || 0), 0);
    return c > 0 ? e / c : 0;
}

function getSubjectProgress(sub) {
    if (!state) return { lu: 0, contract: 0, heat: 0 };
    const c = state.contract[sub] || 0;
    const lu = state.lu[sub] || 0;
    return { lu, contract: c, heat: c > 0 ? lu / c : 0 };
}

function getState() { return state; }
function getMeta() { return meta; }
function isGolden() { return !!(meta && meta.goldenUntil > Date.now()); }
function getRestTokens() { return meta ? meta.restTokens : 0; }
function consumeRestToken() {
    if (meta && meta.restTokens > 0) { meta.restTokens -= 1; idbSet(META_KEY, meta).catch(() => {}); return true; }
    return false;
}
function getOverchargeLuMul() {
    return (meta && meta.overcharge && meta.overcharge.date === _today()) ? meta.overcharge.luMul : 1.0;
}

// ── Rendering: dashboard Directive card ─────────────────────────────────────

/** Native-language quest label: plain sentences, problems not LU. */
function _questSummary(q) {
    if (q.done) return 'done';
    switch (q.type) {
        case 'sharpshooter': {
            const rate = state.accuracy.total > 0 ? Math.round(100 * state.accuracy.correct / state.accuracy.total) : null;
            return rate != null ? `${state.accuracy.total}/10 at ${rate}%` : `${q.prog}/${q.target}`;
        }
        default: {
            const left = Math.max(0, q.target - q.prog);
            return `${left} to go`;
        }
    }
}

function _headlineLine() {
    const h = state.headline;
    if (!h) return '';
    const name = (h.due || 0) > 0
        ? `Yesterday\u2019s slip in ${h.chapter} is today\u2019s conquest`
        : `Conquest: ${h.chapter}`;
    const left = h.done ? 'secured' : `~${Math.max(1, Math.ceil((h.luNeeded - (h.prog || 0)) / EXPECTED_LU_PER_SOLVE))} to go`;
    return `<li class="dir-item dir-item-headline ${h.done ? 'dir-item-done' : ''}">
        <span class="dir-item-check">${h.done ? '✓' : ''}</span>
        <span class="dir-item-label">${name}</span>
        <span class="dir-item-meta">${left}</span>
    </li>`;
}

function renderDashboardCard() {
    const host = document.getElementById('directive-card-body');
    if (!host || !state) return;
    const night = isNightCalm();

    // ── Mock day: one line, no checklist. The mock IS the target. ──
    if (state.mockDay) {
        host.innerHTML = `
            <div class="dir-today-row"><span class="dir-today">Today is a mock day.</span></div>
            <p class="dir-mock-line">${state.mockDay.done
                ? 'Mock banked. Day cleared — the box is ready.'
                : 'The mock IS today\u2019s target. Nothing else is asked of you.'}</p>
            ${state.spinPending ? `<div class="dir-foot"><button class="btn btn-primary dir-box-btn" onclick="window.DIRECTIVE_UI.spin()">🎁 Open the box</button></div>` : ''}`;
        return;
    }

    const remaining = problemsRemaining();
    const clearedCount = (state.headline && state.headline.done ? 1 : 0) + state.quests.filter(q => q.done).length;
    const required = _requiredKeys();

    const status = state.fullCleared
        ? `<span class="dir-status dir-status-cleared">Day cleared ✓</span>`
        : `<span class="dir-status">${clearedCount} of ${required}</span>`;

    const todayLine = state.recoveryDay
        ? `<span class="dir-today dir-today-recovery">Recovery day</span>`
        : `<span class="dir-today">Today${remaining > 0 ? `: ~${remaining} problems` : ' is done'}</span>`;

    const boxBtn = state.spinPending
        ? `<button class="btn btn-primary dir-box-btn" onclick="window.DIRECTIVE_UI.spin()">🎁 Open the box</button>`
        : '';

    const foot = night
        ? `<div class="dir-foot dir-night-calm">Done is done. Tomorrow\u2019s is ready.</div>`
        : `<div class="dir-foot">${boxBtn || `<span class="dir-box-hint">🎁 Clear the day to open the box</span>`}</div>`;

    host.innerHTML = `
        <div class="dir-today-row">${todayLine}${status}</div>
        <ol class="dir-list">
            ${_headlineLine()}
            ${state.quests.map(q => `<li class="dir-item ${q.done ? 'dir-item-done' : ''}">
                <span class="dir-item-check">${q.done ? '✓' : ''}</span>
                <span class="dir-item-label">${q.label}</span>
                <span class="dir-item-meta">${_questSummary(q)}</span>
            </li>`).join('')}
        </ol>
        ${foot}
    `;
}

function renderSettingsPanel() {
    const host = document.getElementById('directive-settings-body');
    if (!host || !state) return;
    host.innerHTML = `
        <p class="dir-set-note">Targets adapt to you automatically — lighter when you\u2019re wrecked or after a miss, heavier when you\u2019re rolling. Three things a day, cleared at midnight. Nothing to configure.</p>
        <div class="dir-set-actions">
            <button class="btn btn-secondary" onclick="window.DIRECTIVE_UI.recalibrate()"> ↻ Recalibrate now</button>
            <button class="btn btn-secondary" onclick="window.DIRECTIVE_UI.useRestToken()" ${meta.restTokens > 0 ? '' : 'disabled'}> 🌿 Rest Token ×${meta.restTokens}</button>
        </div>`;
}

// ── The Box modal ───────────────────────────────────────────────────────────

function _openSpin(reason) {
    if (document.getElementById('directive-spin-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'directive-spin-modal';
    modal.className = 'modal-overlay dir-spin-overlay';
    modal.innerHTML = `
        <div class="modal-box dir-spin-box">
            <span class="dir-kicker">DAY CLEARED</span>
            <h2 class="dir-spin-title">${reason || 'The box opens…'}</h2>
            <div class="dir-spin-reel" id="dir-spin-reel"><div class="dir-spin-cell">🎁</div></div>
            <button class="btn btn-primary dir-spin-go" id="dir-spin-go">Open</button>
        </div>`;
    document.body.appendChild(modal);
    try { window.FX && window.FX.sound && window.FX.sound('confirm'); } catch (_) {}
    modal.querySelector('#dir-spin-go').addEventListener('click', async () => {
        const go = modal.querySelector('#dir-spin-go');
        go.disabled = true; go.textContent = '…';
        const reel = modal.querySelector('#dir-spin-reel');
        reel.classList.add('dir-spin-rolling');
        const reward = await _rollSpin();
        state.spinPending = false;
        await _save();
        let ticks = 0;
        const iv = setInterval(() => {
            reel.querySelector('.dir-spin-cell').textContent = BOX_PRIZES[ticks % 3].title;
            ticks++;
            if (ticks > 12) {
                clearInterval(iv);
                reel.classList.remove('dir-spin-rolling');
                reel.querySelector('.dir-spin-cell').textContent = reward.title;
                reel.className = 'dir-spin-reel dir-tier-' + reward.tier;
                modal.querySelector('.dir-spin-box').insertAdjacentHTML('beforeend',
                    `<p class="dir-spin-desc">${reward.desc}</p>`);
                try { window.FX && window.FX.sound && window.FX.sound('success'); } catch (_) {}
                try {
                    const r = reel.getBoundingClientRect();
                    if (typeof window.burstEmojis === 'function') {
                        window.burstEmojis(r.left + r.width / 2, r.top + r.height / 2, 22, ['🎉', '🌿', '✨', '🔥'], 1.2);
                    }
                } catch (_) {}
                const done = document.createElement('button');
                done.className = 'btn btn-primary';
                done.textContent = 'Claim';
                done.addEventListener('click', () => { modal.remove(); renderDashboardCard(); });
                modal.querySelector('.dir-spin-box').appendChild(done);
                go.remove();
            }
        }, 120);
    });
}

// ── Public UI surface (wired to window.DIRECTIVE_UI in app.js) ──────────────

const Directive = {
    ensureToday,
    recalibrateCapacity,
    settle,
    onSolveLogged,
    markPending,
    awardFocus,
    applyBountyTax,
    getSubjectProgress,
    problemsRemaining,
    getPaceFraction,
    isNightCalm,
    getState,
    getMeta,
    isGolden,
    getRestTokens,
    consumeRestToken,
    getOverchargeLuMul,
    openSpin: (reason) => _openSpin(reason),
    renderDashboardCard,
    renderSettingsPanel,
    get hasContract() { return !!state; },
};

export { Directive };
