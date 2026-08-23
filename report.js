/**
 * report.js — Smart Mistake Report engine (pure, Node-testable).
 *
 * Replaces the "generic dump" (a per-question wall of text) with an
 * aggregated analytics view: which TAGS produced how many MISTAKES,
 * at what DIFFICULTY (qElo bands), with what friction (why), plus
 * deterministic next-actions.
 *
 * Data sources (already persisted by the app — nothing new is collected):
 *   • q.tags[]        — topic tags from Gem dumps / manual logging
 *   • q.qElo          — implied difficulty rating; getEloBand() maps it onto
 *                       the calibrated T1..T7 grid (storage.js)
 *   • q.errorReason   — vault mistake type (conceptual/calculation/misread)
 *   • q.historyLogs[] — practice attempts {timestamp, result, autonomy,
 *                       frictionTypes(JSON string), timeSpentMins, confidence}
 *   • mock scorecards — sc.wrongIds + per-answer confidence (mock autopsy)
 *
 * Design contracts:
 *   • PURE — no DOM, no AppState. Same pattern as mock.js so Node smoke
 *     tests can import this module directly.
 *   • Only imports getEloBand/ELO_BANDS from storage.js. The logistic win
 *     probability mirrors mock.js pWin but is intentionally local: mock.js
 *     imports THIS module for the results-screen autopsy, and a back-import
 *     would create a module cycle.
 *   • All HTML rendering escapes every interpolated value (stored-XSS safe —
 *     tags/chapters come from pasted Gem dumps and are attacker-controllable).
 */

import { ELO_BANDS, BAND_TARGET_TIME, getEloBand } from './storage.js';

// ── Constants ───────────────────────────────────────────────────────────────

export const UNTAGGED = 'untagged';
export const UNRATED = 'Unrated';

/** Display order for the calibrated band grid (+ the honest fallback bucket). */
export const BAND_ORDER = [
    'T1_FOUNDATION', 'T2_CORE_MAINS', 'T3_STD_MAINS', 'T4_ADV_EASY',
    'T5_PAPER_ADV', 'T6_ELITE', 'T7_OLYMP', UNRATED,
];

const BAND_LABELS = {
    T1_FOUNDATION: 'T1 · Foundation',
    T2_CORE_MAINS: 'T2 · Core Mains',
    T3_STD_MAINS: 'T3 · Std Mains',
    T4_ADV_EASY: 'T4 · Adv Easy',
    T5_PAPER_ADV: 'T5 · Paper Adv',
    T6_ELITE: 'T6 · Elite',
    T7_OLYMP: 'T7 · Olympiad',
    [UNRATED]: 'Unrated',
};

/** SR friction taxonomy (mirrors storage.js SR_FRICTION_LABELS) + misread. */
const FRICTION_LABELS = {
    PERFECT: 'Perfect execution',
    CALC: 'Calculation error',
    FORMULA: 'Formula lapse',
    CONCEPT: 'Concept gap',
    APPROACH: 'Approach blank',
    MISREAD: 'Misread',
};

/** Vault errorReason → canonical friction bucket (for questions with no logs). */
const ERROR_REASON_TO_FRICTION = {
    conceptual: 'CONCEPT',
    calculation: 'CALC',
    misread: 'MISREAD',
};

/** Rolling window (days) for the recent-vs-prior trend split. */
const TREND_RECENT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Small helpers ───────────────────────────────────────────────────────────

function _num(v, d) {
    const n = Number(v);
    return (typeof n === 'number' && isFinite(n)) ? n : d;
}

function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

/** Parse a historyLog frictionTypes field — stored as a JSON string by matrix.js. */
export function parseFrictionTypes(ft) {
    if (Array.isArray(ft)) return ft.map(String);
    if (typeof ft === 'string') {
        try {
            const arr = JSON.parse(ft);
            if (Array.isArray(arr)) return arr.map(String);
        } catch (_) { /* bare single token */ }
        if (ft) return [ft];
    }
    return [];
}

/**
 * Logistic win probability — mirror of mock.js pWin (kept local to avoid an
 * import cycle: mock.js imports this module for its results autopsy).
 */
export function expectedWinProb(userElo, qElo) {
    return 1 / (1 + Math.pow(10, (_num(qElo, 1200) - _num(userElo, 1200)) / 400));
}

function _pct(part, whole) {
    return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function _bandLabel(key) { return BAND_LABELS[key] || key; }

// ── Per-question facts ──────────────────────────────────────────────────────

/**
 * Normalize one bank question into analysis facts.
 * @param {object} q    question from AppState.questionBank
 * @param {number} now  epoch ms for trend windows (defaults to Date.now())
 */
export function buildQuestionFacts(q, now) {
    const t = _num(now, Date.now());
    const tags = (Array.isArray(q.tags) && q.tags.length)
        ? [...new Set(q.tags.map(x => String(x).trim()).filter(Boolean))]
        : [];
    if (!tags.length) tags.push(UNTAGGED);

    const qElo = (typeof q.qElo === 'number' && isFinite(q.qElo)) ? q.qElo : null;
    const band = getEloBand(qElo == null ? NaN : qElo) || UNRATED;

    // ── Normalize attempt logs ──
    const rawLogs = Array.isArray(q.historyLogs) ? q.historyLogs : [];
    const logs = rawLogs.map(l => ({
        ts: l && l.timestamp ? Date.parse(l.timestamp) : NaN,
        result: l ? String(l.result || '') : '',
        autonomy: l ? String(l.autonomy || '') : '',
        frictions: parseFrictionTypes(l && l.frictionTypes),
        timeMins: _num(l && l.timeSpentMins, 0),
        confidence: l ? String(l.confidence || '') : '',
    })).filter(l => l.result); // only real attempts count

    const wrongLogs = logs.filter(l => l.result !== 'correct');
    const rightLogs = logs.filter(l => l.result === 'correct');
    const wrongEvents = wrongLogs.length;

    const errorReason = (q.errorReason && String(q.errorReason) !== 'none')
        ? String(q.errorReason) : '';

    // A question counts as a mistake when the Vault logged it as one OR any
    // recorded attempt went wrong.
    const isMistake = Boolean(errorReason) || wrongEvents > 0;

    // Friction profile: prefer real attempt frictions; fall back to the vault's
    // errorReason mapping when the mistake never went through a tagged retry.
    const frictionCounts = {};
    let frictionSource = 'logs';
    for (const l of wrongLogs) {
        for (const f of l.frictions) {
            if (FRICTION_LABELS[f]) frictionCounts[f] = (frictionCounts[f] || 0) + 1;
            else frictionCounts.OTHER = (frictionCounts.OTHER || 0) + 1;
        }
    }
    if (!Object.keys(frictionCounts).length && errorReason) {
        const mapped = ERROR_REASON_TO_FRICTION[errorReason.toLowerCase()];
        if (mapped) { frictionCounts[mapped] = 1; frictionSource = 'vault'; }
    }

    const wrongT = wrongLogs.filter(l => l.timeMins > 0);
    const rightT = rightLogs.filter(l => l.timeMins > 0);
    const mean = arr => arr.length ? arr.reduce((s, l) => s + l.timeMins, 0) / arr.length : null;
    const tWrong = mean(wrongT);
    const tRight = mean(rightT);

    // Time signal per question: slow-wrong ≈ concept gap, fast-wrong ≈ misread/rush.
    // Baseline preference: YOUR own correct-attempt pace → the question's
    // difficulty-band target time (difficulty-aware, works on first miss) → 3 min.
    let timeSignal = null;
    const bandKey = band !== UNRATED ? band.split('_')[0] : null;
    const bandTarget = bandKey ? _num(BAND_TARGET_TIME[bandKey], null) : null;
    const expectedMins = (tRight != null && tRight > 0) ? tRight
        : (bandTarget != null ? bandTarget : 3);
    if (tWrong != null) {
        if (tWrong >= expectedMins * 1.5) timeSignal = 'slow';
        else if (tWrong <= Math.max(expectedMins * 0.5, 0.25)) timeSignal = 'fast';
    }

    const overconfidentWrongs = wrongLogs.filter(l => l.confidence === 'sure').length;

    const recentCut = t - TREND_RECENT_DAYS * DAY_MS;
    const priorCut = t - 2 * TREND_RECENT_DAYS * DAY_MS;
    const recentWrongs = wrongLogs.filter(l => isFinite(l.ts) && l.ts >= recentCut).length;
    const priorWrongs = wrongLogs.filter(l => isFinite(l.ts) && l.ts >= priorCut && l.ts < recentCut).length;

    return {
        id: String(q.id == null ? '' : q.id),
        subject: String(q.subject || 'unknown'),
        chapter: String(q.chapter || 'Uncategorized'),
        tags,
        qElo,
        band,
        status: String(q.status || ''),
        isMastered: Boolean(q.isMastered),
        errorReason,
        isMistake,
        attempts: logs.length,
        correctEvents: rightLogs.length,
        wrongEvents,
        lastResult: logs.length ? logs[logs.length - 1].result : '',
        frictionCounts,
        frictionSource,
        timeSignal,           // 'slow' | 'fast' | null
        tWrong, tRight,       // minutes or null
        overconfidentWrongs,
        repeatOffender: wrongEvents >= 2,
        recentWrongs, priorWrongs,
    };
}

// ── Aggregations ────────────────────────────────────────────────────────────

function _emptyTagRow(tag) {
    return {
        tag,
        questions: 0, mistakes: 0, attempts: 0, correctEvents: 0, wrongEvents: 0,
        ratedQeloSum: 0, ratedN: 0,
        bandHist: {},
        frictionCounts: {},
        overconfident: 0, repeatOffenders: 0,
        slowWrong: 0, fastWrong: 0,
        lossMass: 0,          // Σ win-prob of lost questions — difficulty-weighted pain
        recentWrongs: 0, priorWrongs: 0,
    };
}

function _foldFact(row, f, eloForSubject) {
    row.questions += 1;
    row.attempts += f.attempts;
    row.correctEvents += f.correctEvents;
    row.wrongEvents += f.wrongEvents;
    if (f.isMistake) {
        row.mistakes += 1;
        row.lossMass += expectedWinProb(eloForSubject, f.qElo);
        row.recentWrongs += f.recentWrongs;
        row.priorWrongs += f.priorWrongs;
        if (f.band !== UNRATED) { row.ratedQeloSum += f.qElo; row.ratedN += 1; }
        row.bandHist[f.band] = (row.bandHist[f.band] || 0) + 1;
        if (f.repeatOffender) row.repeatOffenders += 1;
        if (f.timeSignal === 'slow') row.slowWrong += 1;
        if (f.timeSignal === 'fast') row.fastWrong += 1;
        for (const k of Object.keys(f.frictionCounts)) {
            row.frictionCounts[k] = (row.frictionCounts[k] || 0) + f.frictionCounts[k];
        }
    } else if (f.band !== UNRATED) {
        row.ratedQeloSum += f.qElo; row.ratedN += 1;
        row.bandHist[f.band] = (row.bandHist[f.band] || 0) + 1;
    }
}

/**
 * Dominant friction key of a folded row. Higher count wins; ties resolve by
 * SEVERITY (approach-blank worst → perfect best), because a tag tied between
 * concept gaps and calc fumbles should be reported as the deeper problem.
 */
const FRICTION_SEVERITY = ['APPROACH', 'CONCEPT', 'OTHER', 'FORMULA', 'MISREAD', 'CALC', 'PERFECT'];
function _dominantFriction(counts) {
    let best = null;
    for (const k of Object.keys(counts)) {
        if (best === null) { best = k; continue; }
        if (counts[k] !== counts[best]) {
            if (counts[k] > counts[best]) best = k;
        } else if (FRICTION_SEVERITY.indexOf(k) < FRICTION_SEVERITY.indexOf(best)) {
            best = k;
        }
    }
    return best;
}

function _bandMix(bandHist) {
    return BAND_ORDER
        .filter(b => bandHist[b])
        .map(b => b.startsWith('T') ? b.split('_')[0] : b)
        .join('·');
}

function _trendArrow(recent, prior) {
    if (!prior && !recent) return '';
    if (recent > prior) return 'worse';
    if (recent < prior) return 'better';
    return 'flat';
}

/**
 * Aggregate facts per tag. Every fact folds into EACH of its tags (a question
 * carrying two tags contributes to both — tag accountability, not partition).
 * @param {object[]} facts   output of buildQuestionFacts
 * @param {object} opts.elo  optional {physics, chemistry, maths} user Elo map
 */
export function aggregateTags(facts, opts) {
    const eloMap = (opts && opts.elo) || {};
    const rows = {};
    for (const f of facts) {
        const userElo = _num(eloMap[f.subject], 1200);
        for (const tag of f.tags) {
            if (!rows[tag]) rows[tag] = _emptyTagRow(tag);
            _foldFact(rows[tag], f, userElo);
        }
    }
    return Object.values(rows).map(r => ({
        tag: r.tag,
        questions: r.questions,
        mistakes: r.mistakes,
        attempts: r.attempts,
        accuracyPct: r.attempts > 0 ? _pct(r.correctEvents, r.attempts) : null,
        mistakeRatePct: _pct(r.mistakes, r.questions),
        avgQelo: r.ratedN > 0 ? Math.round(r.ratedQeloSum / r.ratedN) : null,
        bandMix: _bandMix(r.bandHist),
        dominantFriction: _dominantFriction(r.frictionCounts),
        frictionCounts: r.frictionCounts,
        overconfident: r.overconfident,
        repeatOffenders: r.repeatOffenders,
        slowWrong: r.slowWrong,
        fastWrong: r.fastWrong,
        lossMass: Math.round(r.lossMass * 100) / 100,
        recentWrongs: r.recentWrongs,
        priorWrongs: r.priorWrongs,
        trend: _trendArrow(r.recentWrongs, r.priorWrongs),
    })).sort((a, b) =>
        (b.mistakes - a.mistakes) || (b.lossMass - a.lossMass) ||
        a.tag.localeCompare(b.tag));
}

/**
 * Aggregate facts across the difficulty grid. Unrated questions (no/out-of-grid
 * qElo) land in their own honest bucket instead of being silently dropped.
 */
export function aggregateBands(facts) {
    const rows = {};
    for (const b of BAND_ORDER) {
        rows[b] = { band: b, questions: 0, mistakes: 0, attempts: 0, correctEvents: 0 };
    }
    for (const f of facts) {
        const r = rows[f.band] || rows[UNRATED];
        r.questions += 1;
        r.attempts += f.attempts;
        r.correctEvents += f.correctEvents;
        if (f.isMistake) r.mistakes += 1;
    }
    return BAND_ORDER.map(b => ({
        band: b,
        label: _bandLabel(b),
        questions: rows[b].questions,
        mistakes: rows[b].mistakes,
        attempts: rows[b].attempts,
        accuracyPct: rows[b].attempts > 0 ? _pct(rows[b].correctEvents, rows[b].attempts) : null,
    }));
}

// ── Report assembly ─────────────────────────────────────────────────────────

const PRESCRIPTIONS = {
    CONCEPT: 'Re-read the theory block, then redo 3–5 guided examples before re-attempting.',
    APPROACH: 'Drill worked solutions first-pass: study the setup, then re-solve cold.',
    FORMULA: 'Rebuild the formula sheet from memory, self-recall it on 3 separate days.',
    CALC: 'Timed calculation drills; write every intermediate step, no mental math.',
    MISREAD: 'Underline qualifiers/units before solving; restate what is asked in one line.',
    OTHER: 'Mixed drill set; review full solutions before the next retry.',
};

function _prescriptionFor(frictionKey) {
    return PRESCRIPTIONS[frictionKey] || PRESCRIPTIONS.OTHER;
}

/**
 * Build the full mistake report from raw bank questions.
 * @param {object[]} questions  bank slice to analyze
 * @param {object} opts
 *   - scopeText: human label of what was analyzed
 *   - elo:       {physics, chemistry, maths} user Elo map for loss weighting
 *   - now:       epoch ms override (tests)
 */
export function buildMistakeReport(questions, opts) {
    const o = opts || {};
    const now = _num(o.now, Date.now());
    const facts = (Array.isArray(questions) ? questions : []).map(q => buildQuestionFacts(q, now));

    const mistakes = facts.filter(f => f.isMistake);
    const attempts = facts.reduce((s, f) => s + f.attempts, 0);
    const correctEvents = facts.reduce((s, f) => s + f.correctEvents, 0);

    // Difficulty leak profile — where do mistakes concentrate on the grid?
    let foundation = 0, stretch = 0, unrated = 0;
    for (const f of mistakes) {
        if (f.band === UNRATED) unrated += 1;
        else if (f.band === 'T1_FOUNDATION' || f.band === 'T2_CORE_MAINS') foundation += 1;
        else if (f.band === 'T5_PAPER_ADV' || f.band === 'T6_ELITE' || f.band === 'T7_OLYMP') stretch += 1;
    }

    const tagRows = aggregateTags(facts, { elo: o.elo });
    const bandRows = aggregateBands(facts);

    // Subject rollup.
    const subjMap = {};
    for (const f of facts) {
        if (!subjMap[f.subject]) subjMap[f.subject] = { subject: f.subject, questions: 0, mistakes: 0 };
        subjMap[f.subject].questions += 1;
        if (f.isMistake) subjMap[f.subject].mistakes += 1;
    }
    const bySubject = Object.values(subjMap).sort((a, b) => b.mistakes - a.mistakes);

    // ── Signals (deterministic, rule-based) ──
    const signals = [];
    const mCount = mistakes.length;
    const foundationShare = _pct(foundation, mCount);
    const stretchShare = _pct(stretch, mCount);
    if (mCount >= 3 && foundationShare >= 35) {
        signals.push('Foundation crack: ' + foundationShare + '% of your mistakes are on T1–T2 material. This is not a difficulty problem — it is retention.');
    }
    if (mCount >= 3 && stretchShare >= 35) {
        signals.push('Stretch wall: ' + stretchShare + '% of your mistakes sit at T5+. Expected at your stage — bank these, do not grind them blindly.');
    }
    const overconfidentTotal = facts.reduce((s, f) => s + f.overconfidentWrongs, 0);
    if (overconfidentTotal >= 2) {
        signals.push('Blind spots: ' + overconfidentTotal + ' answer(s) marked "sure" still went wrong — calibration gap, revisit those topics first.');
    }
    const slowCluster = facts.filter(f => f.timeSignal === 'slow').length;
    const fastCluster = facts.filter(f => f.timeSignal === 'fast').length;
    if (slowCluster >= 2 && slowCluster >= fastCluster) {
        signals.push('You run slow when wrong (' + slowCluster + ' questions at ≥1.5× your usual solve time) — classic concept-gap signature.');
    } else if (fastCluster >= 2) {
        signals.push('Fast-fail cluster (' + fastCluster + ' questions dropped well under your usual time) — misread/rush errors, not knowledge gaps.');
    }
    const worsening = tagRows.filter(r => r.trend === 'worse' && r.mistakes >= 2).slice(0, 3);
    if (worsening.length) {
        signals.push('Trending worse (last 30d vs prior): ' + worsening.map(r => r.tag).join(', ') + '.');
    }

    // ── Next actions: top ≤3 weak tags with a prescription each ──
    const actions = tagRows
        .filter(r => r.mistakes >= 2)
        .slice(0, 3)
        .map(r => ({
            tag: r.tag,
            mistakes: r.mistakes,
            questions: r.questions,
            dominantFriction: r.dominantFriction,
            action: _prescriptionFor(r.dominantFriction),
        }));

    return {
        meta: {
            generatedAt: new Date(now).toISOString(),
            scopeText: o.scopeText || 'All chapters',
            engineVersion: 1,
        },
        kpis: {
            questions: facts.length,
            mistakes: mCount,
            mistakeRatePct: _pct(mCount, facts.length),
            attempts,
            attemptAccuracyPct: attempts > 0 ? _pct(correctEvents, attempts) : null,
            mastered: facts.filter(f => f.isMastered).length,
        },
        bySubject,
        tagRows,
        bandRows,
        leak: {
            foundation, stretch, unrated,
            foundationSharePct: foundationShare,
            stretchSharePct: stretchShare,
        },
        signals,
        actions,
    };
}

// ── Renderers ───────────────────────────────────────────────────────────────

const _pad = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); };
const _padL = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s; };

/**
 * Compact fixed-width text report — bounded regardless of bank size.
 * Suitable for download / paste into Gemini.
 */
export function renderReportText(report, opts) {
    const maxTags = _num(opts && opts.maxTags, 14);
    const L = [];
    const d = new Date(report.meta.generatedAt);
    L.push('════════════════════════════════════════════════════');
    L.push('  JEEMAXXING · SMART MISTAKE REPORT');
    L.push('  ' + d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
        ' · Scope: ' + report.meta.scopeText);
    L.push('════════════════════════════════════════════════════');
    const k = report.kpis;
    L.push('');
    L.push('BANK ' + k.questions + ' Qs · MISTAKES ' + k.mistakes + ' (' + k.mistakeRatePct + '%)' +
        ' · ATTEMPTS ' + k.attempts +
        (k.attemptAccuracyPct != null ? ' · ACCURACY ' + k.attemptAccuracyPct + '%' : '') +
        (k.mastered ? ' · MASTERED ' + k.mastered : ''));

    // ── Tag leaderboard ──
    L.push('');
    L.push('── WHERE IT HURTS (tags ranked by mistakes) ─────────');
    if (!report.tagRows.length) {
        L.push('  (no tagged questions in scope)');
    } else {
        L.push(_pad('TAG', 26) + _padL('Qs', 4) + _padL('✗', 4) + _padL('ACC%', 6) +
            _padL('avgElo', 8) + '  ' + _pad('BANDS', 12) + 'WHY / TREND');
        const shown = report.tagRows.slice(0, maxTags);
        for (const r of shown) {
            const whyBits = [];
            if (r.dominantFriction) whyBits.push(FRICTION_LABELS[r.dominantFriction] || r.dominantFriction);
            if (r.overconfident) whyBits.push(r.overconfident + '× overconfident');
            if (r.repeatOffenders) whyBits.push(r.repeatOffenders + '× repeat');
            const trend = r.trend === 'worse' ? ' ↑worse' : r.trend === 'better' ? ' ↓better' : '';
            L.push(
                _pad(r.tag.slice(0, 25), 26) +
                _padL(r.questions, 4) + _padL(r.mistakes, 4) +
                _padL(r.accuracyPct != null ? r.accuracyPct + '%' : '—', 6) +
                _padL(r.avgQelo != null ? r.avgQelo : '—', 8) + '  ' +
                _pad(r.bandMix || '—', 12) +
                _pad(whyBits.join(', '), 34) + trend);
        }
        const rest = report.tagRows.length - shown.length;
        if (rest > 0) L.push('  … +' + rest + ' more low-activity tags (full data in JSON export)');
    }

    // ── Difficulty profile ──
    L.push('');
    L.push('── DIFFICULTY PROFILE (where mistakes live) ─────────');
    const maxM = Math.max.apply(null, report.bandRows.map(b => b.mistakes).concat([1]));
    for (const b of report.bandRows) {
        if (!b.questions) continue;
        const bar = '█'.repeat(Math.round((b.mistakes / maxM) * 18)) || '·';
        L.push(_pad(b.label, 16) + _pad(bar, 20) +
            _padL(b.mistakes + '/' + b.questions, 8) +
            (b.accuracyPct != null ? ' acc ' + b.accuracyPct + '%' : ''));
    }
    const lk = report.leak;
    if (lk.foundationSharePct >= 35 && lk.foundation > 0) L.push('  ⚠ LEAK: ' + lk.foundationSharePct + '% of mistakes are ≤T2 (foundation cracks).');
    if (lk.stretchSharePct >= 35 && lk.stretch > 0) L.push('  ▲ STRETCH: ' + lk.stretchSharePct + '% of mistakes are T5+ (hard-material frontier).');

    // ── Subjects ──
    if (report.bySubject.length > 1) {
        L.push('');
        L.push('── BY SUBJECT ───────────────────────────────────────');
        for (const s of report.bySubject) {
            L.push(_pad(s.subject.toUpperCase(), 12) + s.mistakes + '/' + s.questions + ' Qs carrying mistakes');
        }
    }

    // ── Signals + actions ──
    if (report.signals.length) {
        L.push('');
        L.push('── SIGNALS ──────────────────────────────────────────');
        for (const s of report.signals) L.push('  • ' + s);
    }
    if (report.actions.length) {
        L.push('');
        L.push('── NEXT ACTIONS ─────────────────────────────────────');
        report.actions.forEach((a, i) => {
            L.push('  ' + (i + 1) + '. [' + a.tag + '] ' + a.mistakes + '/' + a.questions + ' wrong' +
                (a.dominantFriction ? ' (' + String(FRICTION_LABELS[a.dominantFriction] || a.dominantFriction).toLowerCase() + ')' : ''));
            L.push('     → ' + a.action);
        });
    }
    L.push('');
    L.push('Generated locally by JEEMaxxing report engine v' + report.meta.engineVersion + '.');
    return L.join('\n');
}

/**
 * Inline HTML preview for the AI Dump modal. Everything escaped; display-only.
 * @returns {string} html
 */
export function renderReportHtml(report, opts) {
    const maxTags = _num(opts && opts.maxTags, 12);
    const k = report.kpis;

    const kpi = (label, value) =>
        '<div class="rp-kpi"><span class="rp-kpi-v">' + _esc(value) + '</span><span class="rp-kpi-l">' + _esc(label) + '</span></div>';

    let html = '<div class="rp-kpis">' +
        kpi('Questions', k.questions) +
        kpi('Mistakes', k.mistakes + ' (' + k.mistakeRatePct + '%)') +
        kpi('Accuracy', k.attemptAccuracyPct != null ? k.attemptAccuracyPct + '%' : '—') +
        kpi('Attempts', k.attempts) +
        '</div>';

    // Tag leaderboard
    html += '<div class="rp-section"><div class="rp-h">🎯 Where it hurts — tags ranked by mistakes</div>';
    if (!report.tagRows.length) {
        html += '<div class="rp-empty">No tagged questions in this scope yet.</div>';
    } else {
        html += '<table class="rp-table"><thead><tr><th>Tag</th><th>Qs</th><th>✗</th><th>Acc</th><th>Difficulty</th><th>Why</th></tr></thead><tbody>';
        for (const r of report.tagRows.slice(0, maxTags)) {
            const why = [];
            if (r.dominantFriction) why.push('<span class="rp-chip">' + _esc(FRICTION_LABELS[r.dominantFriction] || r.dominantFriction) + '</span>');
            if (r.overconfident) why.push('<span class="rp-chip rp-chip-warn">' + _esc(r.overconfident + '× overconfident') + '</span>');
            if (r.repeatOffenders) why.push('<span class="rp-chip">' + _esc(r.repeatOffenders + '× repeat') + '</span>');
            const trendMark = r.trend === 'worse'
                ? ' <span class="rp-trend-bad" title="more mistakes in the last 30 days than the 30 before">↑</span>'
                : r.trend === 'better'
                    ? ' <span class="rp-trend-good" title="fewer mistakes in the last 30 days than the 30 before">↓</span>'
                    : '';
            html += '<tr>' +
                '<td class="rp-tagcell">' + _esc(r.tag) + trendMark + '</td>' +
                '<td>' + r.questions + '</td>' +
                '<td class="' + (r.mistakes > 0 ? 'rp-bad' : 'rp-good') + '">' + r.mistakes + '</td>' +
                '<td>' + (r.accuracyPct != null ? r.accuracyPct + '%' : '—') + '</td>' +
                '<td class="rp-mono">' + _esc(r.avgQelo != null ? String(r.avgQelo) : '—') +
                (r.bandMix ? ' <span class="rp-bandmix">' + _esc(r.bandMix) + '</span>' : '') + '</td>' +
                '<td>' + (why.join(' ') || '<span class="rp-dim">clean</span>') + '</td>' +
                '</tr>';
        }
        html += '</tbody></table>';
        const rest = report.tagRows.length - Math.min(maxTags, report.tagRows.length);
        if (rest > 0) html += '<div class="rp-more">+' + rest + ' more tags in the downloaded report</div>';
    }
    html += '</div>';

    // Difficulty distribution bars
    html += '<div class="rp-section"><div class="rp-h">📊 Difficulty profile — where mistakes live</div>';
    const maxM = Math.max.apply(null, report.bandRows.map(b => b.mistakes).concat([1]));
    html += '<div class="rp-bars">';
    for (const b of report.bandRows) {
        if (!b.questions) continue;
        const w = Math.round((b.mistakes / maxM) * 100);
        html += '<div class="rp-bar-row"><span class="rp-bar-label">' + _esc(b.label) + '</span>' +
            '<span class="rp-bar-track"><span class="rp-bar-fill" style="width:' + w + '%"></span></span>' +
            '<span class="rp-bar-val">' + b.mistakes + '/' + b.questions + '</span></div>';
    }
    html += '</div>';
    const lk = report.leak;
    if (lk.foundation > 0 || lk.stretch > 0) {
        html += '<div class="rp-leakline">';
        if (lk.foundationSharePct >= 35 && lk.foundation > 0) html += '<span class="rp-chip rp-chip-warn">⚠ ' + lk.foundationSharePct + '% of mistakes ≤T2 — foundation cracks</span> ';
        if (lk.stretchSharePct >= 35 && lk.stretch > 0) html += '<span class="rp-chip">▲ ' + lk.stretchSharePct + '% at T5+ — stretch frontier</span>';
        html += '</div>';
    }
    html += '</div>';

    // Signals
    if (report.signals.length) {
        html += '<div class="rp-section"><div class="rp-h">🔍 Signals</div>';
        for (const s of report.signals) html += '<div class="rp-signal">• ' + _esc(s) + '</div>';
        html += '</div>';
    }

    // Actions
    if (report.actions.length) {
        html += '<div class="rp-section"><div class="rp-h">🧭 Next actions</div>';
        report.actions.forEach((a, i) => {
            html += '<div class="rp-action"><b>' + (i + 1) + '. ' + _esc(a.tag) + '</b> (' + a.mistakes + '/' + a.questions + ' wrong)' +
                '<div class="rp-action-body">→ ' + _esc(a.action) + '</div></div>';
        });
        html += '</div>';
    }

    return html;
}

// ── Mock autopsy (results screen) ───────────────────────────────────────────

/**
 * Group a finished paper's wrong questions by tag × difficulty band.
 * Pure — used by mock.js showResults and Node smoke tests.
 * @param {string[]} wrongIds
 * @param {Object} qById      id → question
 * @param {number} now        epoch ms override (tests)
 * @returns {{total:number, byTag:{tag,count}[], byBand:{band,label,count}[], text:string}|null}
 */
export function buildMockAutopsy(wrongIds, qById, now) {
    const ids = (Array.isArray(wrongIds) ? wrongIds : []).map(String);
    if (!ids.length) return null;
    const qs = ids.map(id => qById[id]).filter(Boolean);
    if (!qs.length) return null;
    const facts = qs.map(q => buildQuestionFacts(q, now));

    const tagCounts = {};
    for (const f of facts) {
        for (const tag of f.tags) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
    const byTag = Object.entries(tagCounts)
        .map(pair => ({ tag: pair[0], count: pair[1] }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

    const bandCounts = {};
    for (const f of facts) bandCounts[f.band] = (bandCounts[f.band] || 0) + 1;
    const byBand = BAND_ORDER
        .filter(b => bandCounts[b])
        .map(b => ({ band: b, label: _bandLabel(b), count: bandCounts[b] }));

    const frictionTotals = {};
    for (const f of facts) {
        for (const kk of Object.keys(f.frictionCounts)) {
            frictionTotals[kk] = (frictionTotals[kk] || 0) + f.frictionCounts[kk];
        }
    }
    const topFrictions = Object.entries(frictionTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(pair => (FRICTION_LABELS[pair[0]] || pair[0]) + ' ×' + pair[1]);

    const lines = [];
    lines.push('By topic: ' + byTag.map(t2 => t2.tag + ' ×' + t2.count).join(' · '));
    lines.push('By difficulty: ' + byBand.map(b => b.label.split('·')[0].trim() + ' ×' + b.count).join(' · '));
    if (topFrictions.length) lines.push('Likely cause: ' + topFrictions.join(', '));

    return { total: qs.length, byTag, byBand, lines, text: lines.join('\n') };
}
