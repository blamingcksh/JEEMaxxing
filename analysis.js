/**
 * analysis.js — "Analysis" tab for JEEMaxxing.
 *
 * A full analytics cockpit over the question bank + error matrix:
 *
 *   • Hero candlestick chart — the same OHLC momentum engine that powers the
 *     dashboard (#dynamic-graph), rendered big, with three switchable daily
 *     metrics (Cognitive Yield / Raw Solves / Error Fixes) and a range
 *     selector (15 / 30 / 90 / ALL days). Regression projection, Protocol-Zero
 *     penalty overlay and the target LOCK line all carry over.
 *
 *   • KPI tiles — bank totals, first-attempt accuracy, avg solve time,
 *     vault/SR health, global MMR, streak, today's output.
 *
 *   • Subject breakdown — per-subject accuracy / time / difficulty.
 *
 *   • Chapter ranking — weakest-first chapter table (weakest at top).
 *
 *   • Error-matrix forensics — mistake-type breakdown (conceptual /
 *     calculation / misread) + SR friction profile (PERFECT / CALC /
 *     FORMULA / CONCEPT / APPROACH) mined from every attempt log.
 *
 *   • Vault SR health — due-status distribution, avg ease factor, re-attempt
 *     success rate.
 *
 *   • Cognitive MMR panel — subject + global ELO vs the calibrated band grid.
 *
 * Pure vanilla ESM. Data graph is kept one-directional: analysis.js imports
 * storage.js / candlestick-engine.js / matrix.js only — NEVER app.js. The
 * yield engine lives in app.js, so app.js hands it over at boot via
 * registerAnalysisDataSources() (yieldForDate / macroScalar / subjectWeights).
 * Without registration the hero falls back to raw solved counts.
 */

import {
    AppState,
    solved,
    studySecs,
    baseTargets,
    baseErrorTargets,
    getDailyHistory,
    getDueStatus,
    getEloBand,
    SR_FRICTION_LABELS,
} from './storage.js';
import { drawCandlesticks } from './candlestick-engine.js';

// ──────────────────────────────────────────────────────────────────────────
//  Data sources handed over by app.js (yield engine) — never required.
// ──────────────────────────────────────────────────────────────────────────
const _sources = { yieldForDate: null, macroScalar: null, subjectWeights: null };

export function registerAnalysisDataSources(s) {
    Object.assign(_sources, s || {});
}

// ──────────────────────────────────────────────────────────────────────────
//  Module state (metric + range pills persist for the session only)
// ──────────────────────────────────────────────────────────────────────────
let _metric = 'yield';   // 'yield' | 'solves' | 'fixes'
let _range = '15';       // '15' | '30' | '90' | 'all'
// Monotonic render token — renderAnalysis() awaits getDailyHistory, so rapid
// pill clicks / tab switches could otherwise let an OLDER async render resolve
// AFTER a newer one and clobber the chart with stale data. Each render
// captures the current token and bails before drawing if it was superseded.
let _renderToken = 0;

const SUBJECTS = ['physics', 'chemistry', 'maths'];
const SUBJECT_META = {
    physics:   { glyph: '⚛️', grad: 'linear-gradient(90deg,#3b82f6,#8b5cf6)' },
    chemistry: { glyph: '🧪', grad: 'linear-gradient(90deg,#14b8a6,#06b6d4)' },
    maths:     { glyph: '📐', grad: 'linear-gradient(90deg,#f97316,#fb7185)' },
};

const ERROR_TYPE_META = {
    calculation: { label: 'Calc Fumble',  icon: '🧮', color: '#eab308' },
    conceptual:  { label: 'Brain Fade',   icon: '🧠', color: '#f87171' },
    misread:     { label: 'Read Fail',    icon: '📖', color: '#f59e0b' },
};

const FRICTION_COLORS = {
    PERFECT:  '#22c55e',
    CALC:     '#eab308',
    FORMULA:  '#3ddcff',
    CONCEPT:  '#f87171',
    APPROACH: '#a78bfa',
};

const BAND_LABELS = {
    T1_FOUNDATION: 'Foundation',
    T2_CORE_MAINS: 'Core Mains',
    T3_STD_MAINS:  'Std Mains',
    T4_ADV_EASY:   'Adv Easy',
    T5_PAPER_ADV:  'Paper Adv',
    T6_ELITE:      'Elite',
    T7_OLYMP:      'Olymp',
};

// ──────────────────────────────────────────────────────────────────────────
//  Small helpers (self-contained — do not import from app.js)
// ──────────────────────────────────────────────────────────────────────────
function _normSubj(s) {
    const raw = String(s || '').trim().toLowerCase();
    return raw === 'math' || raw === 'mathematics' ? 'maths' : raw;
}

function _esc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _num(v, fallback) {
    const n = Number(v);
    return isFinite(n) ? n : fallback;
}

function _todayKey(date) {
    const d = date || new Date();
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * First-attempt result — mirrors app.js _firstAttemptResult() (locked on the
 * first practice, never overwritten). Accuracy counts the FIRST attempt of
 * each question only.
 */
function _firstAttemptResult(q) {
    if (q.firstAttemptResult === 'correct' || q.firstAttemptResult === 'incorrect') {
        return q.firstAttemptResult;
    }
    if (Array.isArray(q.historyLogs) && q.historyLogs.length > 0) {
        const first = q.historyLogs[0];
        if (first && (first.result === 'correct' || first.result === 'incorrect')) {
            return first.result;
        }
    }
    if (q.status === 'solved') return 'correct';
    if (q.status === 'wrong' || q.status === 'error') return 'incorrect';
    return null;
}

// frictionTypes may be a JSON STRING or (legacy) a raw array.
function _parseFrictionTypes(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(String);
    try {
        const p = JSON.parse(raw);
        return Array.isArray(p) ? p.map(String) : [];
    } catch (_) {
        return [];
    }
}

function _fmtDuration(sec) {
    sec = Math.round(sec);
    if (!isFinite(sec) || sec <= 0) return '—';
    if (sec < 60) return sec + 's';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
}

function _fmtMins(mins) {
    mins = _num(mins, 0);
    if (mins <= 0) return '—';
    if (mins < 60) return `${mins.toFixed(1)}m`;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
}

// ──────────────────────────────────────────────────────────────────────────
//  Aggregations over the bank (pure reads — never mutate AppState)
// ──────────────────────────────────────────────────────────────────────────
function _bank() {
    return Array.isArray(AppState.questionBank) ? AppState.questionBank : [];
}

function _bankStats() {
    const bank = _bank();
    const out = {
        total: 0, solved: 0, wrong: 0, error: 0, untouched: 0,
        attempted: 0, correctFirst: 0,
        timeSum: 0, timeN: 0, eloSum: 0, eloN: 0,
        mastered: 0, dueSoon: 0,
        vault: 0, attempts: 0, correctLogs: 0, easeSum: 0, easeN: 0, intervalSum: 0, intervalN: 0,
    };
    for (const q of bank) {
        if (!q || typeof q !== 'object') continue;
        out.total++;
        const status = q.status || 'unsolved';
        if (status === 'solved') out.solved++;
        else if (status === 'wrong') out.wrong++;
        else if (status === 'error') out.error++;
        else out.untouched++;

        const r = _firstAttemptResult(q);
        if (r) { out.attempted++; if (r === 'correct') out.correctFirst++; }

        const t = _num(q.timeTaken, 0);
        if (t > 0) { out.timeSum += t; out.timeN++; }
        const e = _num(q.qElo, 1200);
        if (e > 0) { out.eloSum += e; out.eloN++; }

        // Vault / SR dimension
        const inVault = !!q.errorReason || (Array.isArray(q.historyLogs) && q.historyLogs.length > 0);
        if (inVault) {
            out.vault++;
            if (q.isMastered) out.mastered++;
            else if (getDueStatus(q).status === 'due_soon') out.dueSoon++;
            out.easeSum += _num(q.easeFactor, 2.5);
            out.easeN++;
            out.intervalSum += Math.max(0, _num(q.currentInterval, 0));
            out.intervalN++;
            if (Array.isArray(q.historyLogs)) {
                for (const log of q.historyLogs) {
                    if (!log) continue;
                    out.attempts++;
                    if (log.result === 'correct') out.correctLogs++;
                }
            }
        }
    }
    out.accuracy = out.attempted > 0 ? (out.correctFirst / out.attempted) * 100 : 0;
    out.avgTime = out.timeN > 0 ? out.timeSum / out.timeN : 0;
    out.avgElo = out.eloN > 0 ? out.eloSum / out.eloN : 1200;
    out.avgEase = out.easeN > 0 ? out.easeSum / out.easeN : 0;
    out.avgInterval = out.intervalN > 0 ? out.intervalSum / out.intervalN : 0;
    out.retryRate = out.attempts > 0 ? (out.correctLogs / out.attempts) * 100 : 0;
    return out;
}

function _subjectStats() {
    const rows = {};
    SUBJECTS.forEach(s => {
        rows[s] = { total: 0, solved: 0, wrong: 0, error: 0, untouched: 0,
                    attempted: 0, correctFirst: 0, timeSum: 0, timeN: 0,
                    eloSum: 0, eloN: 0, errors: 0 };
    });
    for (const q of _bank()) {
        if (!q || typeof q !== 'object') continue;
        const subj = _normSubj(q.subject);
        if (!rows[subj]) continue;
        const row = rows[subj];
        row.total++;
        const status = q.status || 'unsolved';
        if (status === 'solved') row.solved++;
        else if (status === 'wrong') row.wrong++;
        else if (status === 'error') row.error++;
        else row.untouched++;
        const r = _firstAttemptResult(q);
        if (r) { row.attempted++; if (r === 'correct') row.correctFirst++; }
        const t = _num(q.timeTaken, 0);
        if (t > 0) { row.timeSum += t; row.timeN++; }
        const e = _num(q.qElo, 1200);
        if (e > 0) { row.eloSum += e; row.eloN++; }
        if (q.errorReason) row.errors++;
    }
    SUBJECTS.forEach(s => {
        const row = rows[s];
        row.accuracy = row.attempted > 0 ? (row.correctFirst / row.attempted) * 100 : 0;
        row.avgTime = row.timeN > 0 ? row.timeSum / row.timeN : 0;
        row.avgElo = row.eloN > 0 ? row.eloSum / row.eloN : 1200;
    });
    return rows;
}

function _chapterRows() {
    const map = {};
    for (const q of _bank()) {
        if (!q || typeof q !== 'object') continue;
        const subj = _normSubj(q.subject);
        const ch = (q.chapter || 'Uncategorized').trim() || 'Uncategorized';
        const key = subj + '||' + ch;
        let row = map[key];
        if (!row) {
            row = map[key] = { subj, ch, total: 0, attempted: 0, correct: 0, errors: 0, eloSum: 0, eloN: 0, mastered: 0 };
        }
        row.total++;
        const r = _firstAttemptResult(q);
        if (r) { row.attempted++; if (r === 'correct') row.correct++; }
        if (q.errorReason) row.errors++;
        const e = _num(q.qElo, 1200);
        if (e > 0) { row.eloSum += e; row.eloN++; }
        if (q.isMastered) row.mastered++;
    }
    const rows = Object.values(map);
    rows.forEach(row => {
        row.accuracy = row.attempted > 0 ? (row.correct / row.attempted) * 100 : 0;
        row.avgElo = row.eloN > 0 ? row.eloSum / row.eloN : 1200;
    });
    // Weakest first: lowest accuracy on top, then most errors, then highest difficulty.
    rows.sort((a, b) => {
        if (a.accuracy !== b.accuracy) return a.accuracy - b.accuracy;
        if (b.errors !== a.errors) return b.errors - a.errors;
        return b.avgElo - a.avgElo;
    });
    return rows;
}

function _errorTypeBreakdown() {
    const types = { calculation: 0, conceptual: 0, misread: 0 };
    const bySubject = {};
    SUBJECTS.forEach(s => { bySubject[s] = { calculation: 0, conceptual: 0, misread: 0 }; });
    for (const q of _bank()) {
        if (!q || !q.errorReason) continue;
        const reason = ERROR_TYPE_META[q.errorReason] ? q.errorReason : 'conceptual';
        types[reason]++;
        const subj = _normSubj(q.subject);
        if (bySubject[subj]) bySubject[subj][reason]++;
    }
    const total = types.calculation + types.conceptual + types.misread;
    return { types, bySubject, total };
}

function _frictionBreakdown() {
    const counts = { PERFECT: 0, CALC: 0, FORMULA: 0, CONCEPT: 0, APPROACH: 0 };
    for (const q of _bank()) {
        if (!q || !Array.isArray(q.historyLogs)) continue;
        for (const log of q.historyLogs) {
            const frictions = _parseFrictionTypes(log && log.frictionTypes);
            const primary = frictions[0];
            if (counts[primary] !== undefined) counts[primary]++;
        }
    }
    return counts;
}

function _srStatusBreakdown() {
    const counts = { ready: 0, due_soon: 0, scheduled: 0, mastered: 0 };
    for (const q of _bank()) {
        if (!q || typeof q !== 'object') continue;
        const inVault = !!q.errorReason || (Array.isArray(q.historyLogs) && q.historyLogs.length > 0);
        if (!inVault) continue;
        const d = getDueStatus(q);
        if (counts[d.status] !== undefined) counts[d.status]++;
    }
    return counts;
}

function _fixesToday() {
    const today = _todayKey();
    let n = 0;
    for (const q of _bank()) {
        if (!q || !Array.isArray(q.historyLogs)) continue;
        for (const log of q.historyLogs) {
            // historyLogs store ISO/UTC strings — slicing the string buckets by
            // UTC day while every comparison key here is LOCAL. A fix logged
            // 00:00–05:29 IST landed on "yesterday" and vanished from the KPI.
            const d = log && log.result === 'correct' && log.timestamp ? _todayKey(new Date(log.timestamp)) : null;
            if (d && d === today) n++;
        }
    }
    return n;
}

// ──────────────────────────────────────────────────────────────────────────
//  Hero chart series builders
// ──────────────────────────────────────────────────────────────────────────
function _penaltySet() {
    const set = new Set();
    try {
        const raw = JSON.parse(localStorage.getItem('checkpoint:protocolZero') || '[]');
        if (Array.isArray(raw)) raw.forEach(d => set.add(d));
    } catch (_) { /* corrupt penalty log → treat as empty */ }
    return set;
}

// One-pass map of { date: fixCount } from every SR attempt log.
// Keys are LOCAL day strings — same bucketing as getDailyHistory — derived
// from the parsed timestamp rather than the UTC prefix of the ISO string.
function _fixesByDate() {
    const map = {};
    for (const q of _bank()) {
        if (!q || !Array.isArray(q.historyLogs)) continue;
        for (const log of q.historyLogs) {
            if (log && log.result === 'correct' && log.timestamp) {
                const d = _todayKey(new Date(log.timestamp));
                if (!d) continue;                       // corrupt timestamp — skip, never NaN a candle
                map[d] = (map[d] || 0) + 1;
            }
        }
    }
    return map;
}

async function _buildHeroSeries() {
    const history = await getDailyHistory();
    const arr = Array.isArray(history) ? history : [];
    if (!arr.length) return { counts: [], flags: [], labels: [], target: 0, rawHistory: arr };

    let counts;
    if (_metric === 'yield') {
        const cMacro = typeof _sources.macroScalar === 'function' ? _sources.macroScalar() : 1;
        counts = arr.map(h => {
            if (typeof _sources.yieldForDate === 'function') {
                const g = _sources.yieldForDate(h.date);
                if (g && g.hasGranular) return g.yield;
            }
            return (Number(h.count) || 0) * cMacro;
        });
    } else if (_metric === 'solves') {
        counts = arr.map(h => Number(h.count) || 0);
    } else {
        const fixes = _fixesByDate();
        counts = arr.map(h => fixes[h.date] || 0);
    }

    const rangeN = _range === 'all' ? arr.length : Math.min(Math.max(1, Number(_range) || 15), arr.length);
    const start = Math.max(0, arr.length - rangeN);
    const slice = counts.slice(start);
    const sliceHist = arr.slice(start);
    const penalty = _penaltySet();
    const flags = sliceHist.map(h => penalty.has(h.date));

    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const labels = sliceHist.map(h => {
        const d = new Date(h.date + 'T00:00:00');
        if (isNaN(d.getTime())) return h.date || '';
        return `${DOW[d.getDay()]} ${d.getDate()}`;
    });

    let target = 0;
    const w = _sources.subjectWeights || { maths: 0.50, physics: 0.30, chemistry: 0.20 };
    if (_metric === 'yield') {
        target = (w.maths * baseTargets.maths) + (w.physics * baseTargets.physics) + (w.chemistry * baseTargets.chemistry);
    } else if (_metric === 'solves') {
        target = baseTargets.physics + baseTargets.chemistry + baseTargets.maths;
    } else {
        target = baseErrorTargets.physics + baseErrorTargets.chemistry + baseErrorTargets.maths;
    }

    return { counts: slice, flags, labels, target, rawHistory: sliceHist };
}

// ──────────────────────────────────────────────────────────────────────────
//  Renderers
// ──────────────────────────────────────────────────────────────────────────
function _emptyState(msg) {
    return `<div class="analysis-empty">${msg}</div>`;
}

async function _renderHero(token) {
    const svg = document.getElementById('analysis-progress-graph');
    const container = document.querySelector('.analysis-graph-display');
    if (!svg || !container) return;

    const series = await _buildHeroSeries();
    if (token !== _renderToken) return; // superseded while awaiting history
    const body = document.getElementById('analysis-hero-meta');
    if (!series.counts.length) {
        if (body) body.innerHTML = _emptyState('No daily history yet — go solve something, then the candles appear.');
        svg.innerHTML = '';
        return;
    }

    const width = Math.max(container.clientWidth || 720, 320);
    const height = 280;

    const valueLabel = _metric === 'yield' ? 'Yield Pts'
        : _metric === 'solves' ? 'solves' : 'fixes';
    const precision = _metric === 'yield' ? 2 : 1;

    const metrics = drawCandlesticks(svg, series.counts, {
        width,
        height,
        penaltyFlags: series.flags,
        showPrediction: true,
        predDays: 5,
        compact: false,
        invert: false,
        valueLabel,
        valuePrecision: precision,
        labelFn: (i) => series.labels[i] || `Day ${i + 1}`,
        targetValue: series.target,
    });

    // Meta strip under the chart: projection slope + r² + range label.
    if (body && metrics && typeof metrics.slope === 'number') {
        const slopeTxt = metrics.slope >= 0 ? '+' : '';
        const trendCls = metrics.slope > 0.1 ? 'trend-up' : (metrics.slope < -0.1 ? 'trend-down' : 'trend-flat');
        const days = _range === 'all' ? series.rawHistory.length : Number(_range);
        body.innerHTML = `
            <span class="analysis-hero-stat ${trendCls}">Momentum slope <b>${slopeTxt}${metrics.slope.toFixed(2)}</b>/day</span>
            <span class="analysis-hero-stat">Fit quality <b>r² ${(metrics.r2 || 0).toFixed(2)}</b></span>
            <span class="analysis-hero-stat">Window <b>${days}d</b></span>
            <span class="analysis-hero-stat">Green = target met · Red = target missed · Purple = 5-day projection</span>`;
    }
}

function _renderKPIs(stats) {
    const grid = document.getElementById('analysis-kpi-grid');
    if (!grid) return;
    const todayTotal = (Number(solved.physics) || 0) + (Number(solved.chemistry) || 0) + (Number(solved.maths) || 0);
    const fixesToday = _fixesToday();
    const studyMin = ((Number(studySecs.physics) || 0) + (Number(studySecs.chemistry) || 0) + (Number(studySecs.maths) || 0)) / 60;
    const globalElo = _num(AppState.elo && AppState.elo.global, 1200);

    const tiles = [
        { label: 'Question Bank', val: stats.total, sub: `${stats.solved} solved`, accent: '#3ddcff' },
        { label: 'First-Attempt Accuracy', val: stats.accuracy.toFixed(0) + '%', sub: `${stats.correctFirst}/${stats.attempted} clutched`, accent: '#22c55e' },
        { label: 'Avg Solve Time', val: _fmtDuration(stats.avgTime), sub: 'per solved Q', accent: '#a78bfa' },
        { label: 'Friction Points', val: stats.vault, sub: `${stats.mastered} mastered`, accent: '#f87171' },
        { label: 'Due Soon', val: stats.dueSoon, sub: 'SR re-attempts', accent: '#eab308' },
        { label: 'Today', val: todayTotal, sub: `+ ${fixesToday} fixes`, accent: '#f97316' },
        { label: 'Study Today', val: _fmtMins(studyMin), sub: 'across subjects', accent: '#2dd4bf' },
        { label: 'Global MMR', val: Math.round(globalElo), sub: _bandLabel(globalElo), accent: '#ffb224' },
    ];
    grid.innerHTML = tiles.map(t => `
        <div class="analysis-kpi" style="--kpi-accent:${t.accent};">
            <span class="analysis-kpi-label">${t.label}</span>
            <span class="analysis-kpi-val">${t.val}</span>
            <span class="analysis-kpi-sub">${t.sub}</span>
        </div>`).join('');
}

function _bandLabel(elo) {
    const band = getEloBand(Number(elo));
    return band ? (BAND_LABELS[band] || band) : '—';
}

function _renderSubjects(rows) {
    const body = document.getElementById('analysis-subject-body');
    if (!body) return;
    if (!_bank().length) { body.innerHTML = _emptyState('Feed some questions and their stats will show up here.'); return; }
    body.innerHTML = SUBJECTS.map(s => {
        const r = rows[s];
        const meta = SUBJECT_META[s];
        const accColor = r.accuracy >= 75 ? '#22c55e' : r.accuracy >= 45 ? '#eab308' : '#f87171';
        return `
            <div class="analysis-bar-row">
                <div class="analysis-bar-head">
                    <span class="analysis-bar-name"><span class="analysis-glyph">${meta.glyph}</span>${s[0].toUpperCase() + s.slice(1)}</span>
                    <span class="analysis-bar-chips">
                        <span class="analysis-chip chip-green">${r.solved} solved</span>
                        <span class="analysis-chip chip-red">${r.wrong + r.error} fumbled</span>
                        <span class="analysis-chip chip-mute">${r.untouched} untouched</span>
                    </span>
                </div>
                <div class="analysis-bar-track"><div class="analysis-bar-fill" style="width:${r.accuracy.toFixed(1)}%;background:${meta.grad};"></div></div>
                <div class="analysis-bar-meta">
                    <span style="color:${accColor};font-weight:700;">${r.accuracy.toFixed(0)}% accuracy</span>
                    <span>${_fmtDuration(r.avgTime)} avg</span>
                    <span>QElo ${Math.round(r.avgElo)}</span>
                    <span>${r.errors} error pts</span>
                </div>
            </div>`;
    }).join('');
}

function _renderChapters(rows) {
    const body = document.getElementById('analysis-chapter-body');
    if (!body) return;
    if (!rows.length) { body.innerHTML = _emptyState('No chapters with questions yet.'); return; }
    const SHOW = 10;
    const visible = rows.slice(0, SHOW);
    const hidden = rows.length - visible.length;
    body.innerHTML = visible.map(row => {
        const meta = SUBJECT_META[row.subj] || { glyph: '📚' };
        const accColor = row.accuracy >= 75 ? '#22c55e' : row.accuracy >= 45 ? '#eab308' : '#f87171';
        // The chapter name rides through the inline onclick as a JS string, so
        // encodeURIComponent ALONE is not enough — it leaves apostrophes
        // unescaped ("Thermo's" would become invalid JS). Force them to %27.
        const jsCh = encodeURIComponent(row.ch).replace(/'/g, '%27');
        return `
            <div class="analysis-chapter-row" onclick="jumpToChapter('${_esc(row.subj)}','${jsCh}')" title="Open in The Vault">
                <div class="analysis-chapter-head">
                    <span class="analysis-chapter-name"><span class="analysis-glyph">${meta.glyph}</span>${_esc(row.ch)}</span>
                    <span class="analysis-chapter-nums" style="color:${accColor};">${row.accuracy.toFixed(0)}% · ${row.attempted}Q</span>
                </div>
                <div class="analysis-bar-track"><div class="analysis-bar-fill" style="width:${row.accuracy.toFixed(1)}%;background:${meta.grad};"></div></div>
            </div>`;
    }).join('') + (hidden > 0 ? `<div class="analysis-more">+ ${hidden} more chapters below the fold</div>` : '');
}

function _renderErrors(err, friction) {
    const body = document.getElementById('analysis-error-body');
    if (!body) return;
    const typeTotal = err.total;
    const typeBars = Object.keys(ERROR_TYPE_META).map(k => {
        const m = ERROR_TYPE_META[k];
        const n = err.types[k];
        const pct = typeTotal > 0 ? (n / typeTotal) * 100 : 0;
        return `
            <div class="analysis-bar-row analysis-sm">
                <div class="analysis-bar-head">
                    <span class="analysis-bar-name">${m.icon} ${m.label}</span>
                    <span class="analysis-bar-chips"><span class="analysis-chip chip-red">${n}</span></span>
                </div>
                <div class="analysis-bar-track"><div class="analysis-bar-fill" style="width:${pct.toFixed(1)}%;background:${m.color};"></div></div>
                <div class="analysis-bar-meta"><span>${pct.toFixed(0)}% of all errors</span></div>
            </div>`;
    }).join('');

    const frictionTotal = Object.values(friction).reduce((a, b) => a + b, 0);
    const frictionBars = Object.keys(friction).map(k => {
        const n = friction[k];
        const pct = frictionTotal > 0 ? (n / frictionTotal) * 100 : 0;
        return `
            <div class="analysis-bar-row analysis-sm">
                <div class="analysis-bar-head">
                    <span class="analysis-bar-name">${_esc(SR_FRICTION_LABELS[k] || k)}</span>
                    <span class="analysis-bar-chips"><span class="analysis-chip chip-mute">${n}</span></span>
                </div>
                <div class="analysis-bar-track"><div class="analysis-bar-fill" style="width:${pct.toFixed(1)}%;background:${FRICTION_COLORS[k] || '#a78bfa'};"></div></div>
                <div class="analysis-bar-meta"><span>${pct.toFixed(0)}% of attempt logs</span></div>
            </div>`;
    }).join('');

    body.innerHTML = `
        <div class="analysis-err-cols">
            <div>
                <div class="analysis-col-title">Mistake Types <span class="analysis-col-sub">(errorReason)</span></div>
                ${typeTotal ? typeBars : _emptyState('No logged mistakes yet — the vault is clean.')}
            </div>
            <div>
                <div class="analysis-col-title">Friction Profile <span class="analysis-col-sub">(attempt logs)</span></div>
                ${frictionTotal ? frictionBars : _emptyState('No SR attempt logs yet.')}
            </div>
        </div>`;
}

function _renderSR(stats, statuses) {
    const body = document.getElementById('analysis-sr-body');
    if (!body) return;
    if (!stats.vault) { body.innerHTML = _emptyState('Nothing in the vault yet — log a mistake to start the SR loop.'); return; }
    const statusRows = [
        { k: 'ready', label: '🟢 Ready now', color: '#10B981' },
        { k: 'due_soon', label: '⏳ Due soon', color: '#f59e0b' },
        { k: 'scheduled', label: '🗓️ Scheduled', color: '#60a5fa' },
        { k: 'mastered', label: '💤 Mastered', color: '#a78bfa' },
    ].map(s => {
        const n = statuses[s.k] || 0;
        const pct = stats.vault > 0 ? (n / stats.vault) * 100 : 0;
        return `
            <div class="analysis-bar-row analysis-sm">
                <div class="analysis-bar-head">
                    <span class="analysis-bar-name">${s.label}</span>
                    <span class="analysis-bar-chips"><span class="analysis-chip chip-mute">${n}</span></span>
                </div>
                <div class="analysis-bar-track"><div class="analysis-bar-fill" style="width:${pct.toFixed(1)}%;background:${s.color};"></div></div>
            </div>`;
    }).join('');

    body.innerHTML = `
        <div class="analysis-sr-cols">
            <div>${statusRows}</div>
            <div class="analysis-sr-stats">
                <div class="analysis-stat-line"><span>Avg ease factor</span><b>${stats.avgEase ? stats.avgEase.toFixed(2) : '—'}</b></div>
                <div class="analysis-stat-line"><span>Avg review interval</span><b>${stats.avgInterval ? stats.avgInterval.toFixed(1) + 'd' : '—'}</b></div>
                <div class="analysis-stat-line"><span>Re-attempt success</span><b>${stats.retryRate.toFixed(0)}%</b></div>
                <div class="analysis-stat-line"><span>Mastered rate</span><b>${stats.vault ? ((stats.mastered / stats.vault) * 100).toFixed(0) + '%' : '—'}</b></div>
                <div class="analysis-stat-line"><span>Total attempt logs</span><b>${stats.attempts}</b></div>
            </div>
        </div>`;
}

function _renderElo() {
    const body = document.getElementById('analysis-elo-body');
    if (!body) return;
    const e = AppState.elo || {};
    const elo = {
        physics: _num(e.physics, 1200),
        chemistry: _num(e.chemistry, 1200),
        maths: _num(e.maths, 1200),
        global: _num(e.global, 1200),
    };
    const MIN = 800, MAX = 2600;
    const pct = v => Math.max(2, Math.min(100, ((v - MIN) / (MAX - MIN)) * 100));

    const bars = SUBJECTS.map(s => {
        const meta = SUBJECT_META[s];
        const v = elo[s];
        return `
            <div class="analysis-bar-row analysis-sm">
                <div class="analysis-bar-head">
                    <span class="analysis-bar-name">${meta.glyph} ${s[0].toUpperCase() + s.slice(1)}</span>
                    <span class="analysis-bar-chips"><span class="analysis-chip chip-elo">${_bandLabel(v)}</span></span>
                </div>
                <div class="analysis-bar-track"><div class="analysis-bar-fill" style="width:${pct(v).toFixed(1)}%;background:${meta.grad};"></div></div>
                <div class="analysis-bar-meta"><span style="font-weight:700;">${Math.round(v)}</span><span>band ${_bandLabel(v)}</span></div>
            </div>`;
    }).join('');

    body.innerHTML = `
        <div class="analysis-elo-cols">
            <div class="analysis-elo-global">
                <span class="analysis-kpi-label">Global MMR</span>
                <span class="analysis-elo-big">${Math.round(elo.global)}</span>
                <span class="analysis-chip chip-elo">${_bandLabel(elo.global)}</span>
            </div>
            <div>${bars}</div>
        </div>`;
}

// ──────────────────────────────────────────────────────────────────────────
//  Entry point
// ──────────────────────────────────────────────────────────────────────────
export async function renderAnalysis() {
    const token = ++_renderToken;
    try {
        const stats = _bankStats();
        _renderKPIs(stats);
        _renderSubjects(_subjectStats());
        _renderChapters(_chapterRows());
        _renderErrors(_errorTypeBreakdown(), _frictionBreakdown());
        _renderSR(stats, _srStatusBreakdown());
        _renderElo();
        await _renderHero(token); // async (getDailyHistory)
    } catch (err) {
        console.error('[analysis] render failed:', err);
        // Never let a broken panel take the whole tab down.
        try {
            const body = document.getElementById('analysis-hero-meta');
            if (body) body.innerHTML = _emptyState('Analytics hiccup — try again in a sec.');
        } catch (_) {}
    }
}

// ── Global hooks (inline onclick pills + cross-tab chapter jump) ──
window.setAnalysisMetric = function (metric, el) {
    _metric = metric;
    document.querySelectorAll('#analysis-metric-pills .matrix-pill').forEach(p =>
        p.classList.toggle('active', p === el));
    renderAnalysis();
};
window.setAnalysisRange = function (range, el) {
    _range = range;
    document.querySelectorAll('#analysis-range-pills .matrix-pill').forEach(p =>
        p.classList.toggle('active', p === el));
    renderAnalysis();
};
window.jumpToChapter = function (subj, encodedChapter) {
    const chapter = decodeURIComponent(String(encodedChapter || ''));
    const navEl = document.querySelector('.nav-item[data-tab="errors"]');
    Promise.resolve(window.switchTab('errors', navEl || null)).then(() => {
        try {
            const idx = SUBJECTS.indexOf(_normSubj(subj));
            const folders = document.querySelectorAll('.subject-folder');
            if (folders[idx]) folders[idx].click();
            if (typeof window.setMatrixSearch === 'function') window.setMatrixSearch(chapter);
        } catch (_) {}
    });
};
window.renderAnalysis = renderAnalysis;
