/**
 * mock.js — Mock Mode v2: paper builder (3 sources) + exam runner + scorer + review.
 *
 * Two layers:
 *   PURE (exported, Node-testable): answer normalization, grading under real
 *   JEE marking schemes (v2: grades against the PAPER'S OWN answer key when
 *   one exists — the bank answer is only a fallback), scorecard computation,
 *   predicted-score model.
 *   UI (browser-only, guarded): Studio (paper list / builder / bank picker /
 *   key pass with bulk paste), full-screen exam runner with palette + paper
 *   clock, results screen with per-question review + Vault logging.
 *
 * Design contracts:
 *   • The mock's sections[subject].keys map is the authoritative key for that
 *     paper. gradeAnswer(q, value, keyOverride) — computeMockScorecard always
 *     passes the paper key. Fixing a key on a done paper flags
 *     m.scorecardStale so the scorecard recomputes on next view.
 *   • Questions enter a paper three ways: bank picker, one-click auto-build
 *     (sampled from the bank), or AI-dump linking while a draft panel is
 *     active. Dump linking stamps q.mockSource / q.reservedForMock; the stamp
 *     clears when the question is unlinked or the paper deleted, and when a
 *     paper finalizes.
 *   • NO Elo movement from mocks — marks + readiness data only.
 *   • Runner persists into the mock continuously (refresh-safe); the clock is
 *     deadline-based (endsAt), so reload resumes honestly. Exit (⤢) hides the
 *     runner but the clock keeps running.
 *   • Wrong answers are NOT auto-logged to the Vault — the review screen
 *     offers one-tap logging per question through the same error-reason modal
 *     the practice flow uses (AppState.pendingWrongQ → confirmErrorLog).
 *
 * Ingestion linkage: while AppState.mockDraftContext = {mockId, subject} is
 * set, app.js's Save-All hook calls linkQuestion() for every committed
 * question. The context is cleared when the Mocks view deactivates and when
 * another builder opens — a stale context can never swallow practice dumps.
 */

import {
    AppState,
    saveAllAsync,
    MARKS_SCHEMES,
    CONFIDENCE_ANCHORS,
    getPatternForQuestion,
    getSchemeIdForQuestion,
} from './storage.js';

// Smart Mistake Report engine — post-mock tag × difficulty autopsy (pure).
import { buildMockAutopsy } from './report.js';

// Browser bridge alias — Node smoke tests have no window; UI handlers attach
// through this so importing the module for its pure functions never crashes.
const win = (typeof window !== 'undefined') ? window : {};

const SUBJECTS = ['physics', 'chemistry', 'maths'];
const SUBJECT_GLYPH = { physics: '⚛️ Physics', chemistry: '🧪 Chemistry', maths: '📐 Maths' };

function _esc(s) { return String(s == null ? '' : s).replace(/[&<>\""']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function _num(v, d) { const n = Number(v); return (typeof n === 'number' && isFinite(n)) ? n : d; }
function _toast(msg) {
    if (typeof win.__jmaxAppToast === 'function') { try { win.__jmaxAppToast(msg); } catch (_) {} }
    else if (typeof console !== 'undefined') console.log('[mock] ' + msg);
}

// ════════════════════════════════════════════════════════════════════════════
// PURE SCORING CORE — no DOM, no AppState mutation. Exported for smoke tests.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Normalize a raw user/key entry into canonical form for its pattern.
 * Letters: uppercase unique sorted array. Numeric: trimmed string. Else: string.
 */
export function normalizeAnswerInput(raw, pattern) {
    if (raw == null) return pattern === 'multi' || pattern === 'single' ? [] : '';
    const s = String(raw).trim();
    if (!s) return pattern === 'multi' || pattern === 'single' ? [] : '';
    if (pattern === 'single' || pattern === 'multi') {
        const letters = [...new Set(s.toUpperCase().replace(/[^A-D]/g, '').split(''))].sort();
        return letters;
    }
    return s;
}

/** A stored key counts only when it normalizes to something gradable. */
export function hasKey(k) {
    return k != null && k !== '' && !(Array.isArray(k) && k.length === 0);
}

/**
 * Grade one answer under its JEE scheme.
 * @param keyOverride  the paper's own answer key (from sections[s].keys).
 *                     When present it wins over the bank's correctAnswer.
 * @returns {{attempted:boolean, correct:boolean, marks:number, schemeId:string}}
 */
export function gradeAnswer(q, value, keyOverride) {
    const pattern = getPatternForQuestion(q);
    const schemeId = getSchemeIdForQuestion(q);
    const norm = normalizeAnswerInput(value, pattern);
    const attempted = Array.isArray(norm) ? norm.length > 0 : String(norm).length > 0;
    if (!attempted) return { attempted: false, correct: false, marks: 0, schemeId };

    const key = hasKey(keyOverride) ? keyOverride : q.correctAnswer;

    if (pattern === 'single') {
        const ca = normalizeAnswerInput(key, 'single');
        const correct = ca.length > 0 && norm[0] === ca[0];
        return { attempted: true, correct, marks: correct ? MARKS_SCHEMES['adv-single'].correct : MARKS_SCHEMES['adv-single'].wrong, schemeId };
    }
    if (pattern === 'numeric') {
        const u = parseFloat(norm); const c = parseFloat(key);
        const correct = isFinite(u) && isFinite(c) && Math.abs(u - c) < 1e-6;
        return { attempted: true, correct, marks: correct ? MARKS_SCHEMES['adv-numeric'].correct : MARKS_SCHEMES['adv-numeric'].wrong, schemeId };
    }
    // multi — JEE Advanced style: exact ⇒ +full · any wrong selection ⇒ penalty ·
    // otherwise +partialPerCorrect per correctly chosen option.
    const ca = normalizeAnswerInput(key, 'multi');
    const S = new Set(norm), C = new Set(ca);
    let hits = 0, wrongSel = 0;
    for (const l of S) (C.has(l) ? hits++ : wrongSel++);
    const sch = MARKS_SCHEMES['adv-multi'];
    if (wrongSel > 0) return { attempted: true, correct: false, marks: sch.anyWrongPenalty, schemeId };
    if (ca.length > 0 && S.size === C.size && hits === C.size) return { attempted: true, correct: true, marks: sch.full, schemeId };
    return { attempted: true, correct: false, marks: Math.min(hits * sch.partialPerCorrect, sch.full - 1), schemeId };
}

/** Logistic win probability (σ=400 Elo convention). */
export function pWin(userElo, qElo) {
    return 1 / (1 + Math.pow(10, ((_num(qElo, 1200)) - (_num(userElo, 1200))) / 400));
}

/**
 * Full scorecard for a finished/running paper.
 * Grades against the paper's own key (sections[s].keys) when present; the
 * bank's correctAnswer is only the fallback for keyless legacy papers.
 * @param {object} mock  mock entry (sections + run.answers)
 * @param {Object} qById map id → question
 * @returns scorecard object (pure)
 */
export function computeMockScorecard(mock, qById) {
    const answers = (mock.run && mock.run.answers) || {};
    const sections = [];
    let total = 0, maxTotal = 0, predicted = 0;
    let attempted = 0, correctCount = 0, answered = 0;
    let brierSum = 0, brierN = 0;
    const wrongIds = [];
    for (const subj of SUBJECTS) {
        const sec = (mock.sections && mock.sections[subj]) || { questionIds: [] };
        const keys = (mock.sections && mock.sections[subj] && mock.sections[subj].keys) || {};
        const row = { subject: subj, marks: 0, max: 0, correct: 0, wrong: 0, skipped: 0 };
        for (const qid of sec.questionIds) {
            const q = qById[qid];
            if (!q) continue;
            row.max += 4;
            maxTotal += 4;
            const g = gradeAnswer(q, answers[qid] && answers[qid].value, keys[qid]);
            row.marks += g.marks;
            total += g.marks;
            if (g.attempted) {
                row.attempted = (row.attempted || 0) + 1; attempted++;
                if (g.correct) { row.correct++; correctCount++; } else { row.wrong++; wrongIds.push(qid); }
            } else row.skipped++;
            const conf = answers[qid] && answers[qid].confidence;
            if (g.attempted && conf && CONFIDENCE_ANCHORS[conf] != null) {
                brierSum += Math.pow(CONFIDENCE_ANCHORS[conf] - (g.correct ? 1 : 0), 2); brierN++;
            }
            if (AppState.elo && typeof AppState.elo[subj] !== 'undefined') {
                predicted += 4 * pWin(AppState.elo[subj], q.qElo);
            }
        }
        sections.push(row);
    }
    return {
        sections, total, max: maxTotal, predicted: Math.round(predicted),
        attempted, correctCount, wrongIds,
        accuracy: attempted > 0 ? correctCount / attempted : 0,
        brier: brierN > 0 ? brierSum / brierN : null, brierN,
    };
}

/** Parse a pasted bulk key block: lines like "1 A" / "2) AC" / "3: 42". */
export function parseBulkKey(text) {
    const out = {};
    String(text || '').split(/\n+/).forEach(line => {
        const m = line.trim().match(/^#?(\d{1,3})\s*[).:\-]?\s+(.+)$/i);
        if (m) out[m[1]] = m[2].trim();
    });
    return out;
}

// ════════════════════════════════════════════════════════════════════════════
// STATE HELPERS
// ════════════════════════════════════════════════════════════════════════════

function ensureState() {
    if (!Array.isArray(AppState.mocks)) AppState.mocks = [];
    if (!AppState.mockFocus || typeof AppState.mockFocus !== 'object') AppState.mockFocus = {};
}
function getMock(id) { ensureState(); return AppState.mocks.find(m => m.id === id) || null; }
function persist() { saveAllAsync().catch(console.error); }
function newId(p) { return p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function emptySections() { return { physics: { questionIds: [], keys: {} }, chemistry: { questionIds: [], keys: {} }, maths: { questionIds: [], keys: {} } }; }
function qById(id) { return AppState.questionBank.find(x => String(x.id) === String(id)) || null; }
function qByIdMap() {
    const map = {};
    for (const q of AppState.questionBank) map[String(q.id)] = q;
    return map;
}

/**
 * Strict key prefill from a bank question's own correctAnswer. Only accepts
 * shapes a Gem dump legitimately produces — never "answers" extracted out of
 * prose like "Both A and B", which normalizeAnswerInput would mangle.
 */
export function prefillKeyFor(q) {
    if (!q) return null;
    const pattern = getPatternForQuestion(q);
    const raw = q.correctAnswer;
    if (pattern === 'numeric') {
        const s = String(raw == null ? '' : raw).trim();
        return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
    }
    let letters = null;
    if (Array.isArray(raw)) {
        letters = raw.map(x => String(x).trim().toUpperCase()).filter(x => /^[A-D]$/.test(x));
    } else {
        const s = String(raw == null ? '' : raw).trim().toUpperCase();
        if (/^[A-D](\s*[,\/]?\s*[A-D])*$/.test(s)) letters = s.replace(/[^A-D]/g, '').split('');
    }
    if (!letters || !letters.length) return null;
    return [...new Set(letters)].sort();
}

/** Called by app.js Save-All hook while a draft section is open for filling. */
function linkQuestion(ctx, newQ) {
    const m = getMock(ctx.mockId);
    if (!m || (m.status !== 'building' && m.status !== 'ready')) return;
    const sec = m.sections[ctx.subject];
    if (!sec || !newQ || !newQ.id) return;
    // Mixed-subject dumps are legal. Placement (q.subject) follows the
    // session context (saveAllQuestions contract), so the dump's OWN claim —
    // gemSubject provenance — is what decides mock routing: a chemistry
    // question dumped into an open physics panel stays in the bank.
    const gemSubj = String(newQ.gemSubject || '').toLowerCase();
    const effSubj = ['physics', 'chemistry', 'maths'].includes(gemSubj)
        ? gemSubj
        : String(newQ.subject || '').toLowerCase();
    if (effSubj !== String(ctx.subject).toLowerCase()) return;
    if (sec.questionIds.includes(newQ.id)) return;
    newQ.mockSource = m.id;
    newQ.reservedForMock = m.id;
    sec.questionIds.push(newQ.id);
    if (!hasKey(sec.keys[newQ.id])) {
        const k = prefillKeyFor(newQ);
        if (k) sec.keys[newQ.id] = k;
    }
    persist();
    scheduleBuilderRefresh(m.id);
}

function unlinkQuestion(mockId, qid) {
    const m = getMock(mockId); if (!m) return;
    for (const s of SUBJECTS) {
        const sec = m.sections[s];
        const i = sec.questionIds.indexOf(qid);
        if (i >= 0) {
            sec.questionIds.splice(i, 1); delete sec.keys[qid];
            const q = qById(qid);
            if (q) { delete q.reservedForMock; delete q.mockSource; }
        }
    }
    persist();
}

function allQuestionIds(m) { return SUBJECTS.flatMap(s => m.sections[s].questionIds); }
function canFinalize(m) {
    const ids = allQuestionIds(m);
    if (!ids.length) return false;
    return ids.every(qid => SUBJECTS.some(s => hasKey(m.sections[s].keys[qid])));
}
function totalQuestions(m) { return allQuestionIds(m).length; }

function finalizeMock(id) {
    const m = getMock(id); if (!m || m.status !== 'building') return false;
    if (!canFinalize(m)) return false;
    m.status = 'ready';
    for (const qid of allQuestionIds(m)) {
        const q = qById(qid);
        if (q) delete q.reservedForMock; // finalized paper owns them now
    }
    persist();
    return true;
}

function deleteMock(id) {
    const m = getMock(id); if (!m) return;
    for (const qid of allQuestionIds(m)) {
        const q = qById(qid);
        if (q) { delete q.reservedForMock; delete q.mockSource; }
    }
    AppState.mocks = AppState.mocks.filter(x => x.id !== id);
    persist();
}

/** Bank questions eligible for papers: not reserved, not anomalous. */
function eligiblePool(subject) {
    return AppState.questionBank.filter(q => q.subject === subject && !q.reservedForMock && !q.isAnomaly);
}
function subjectAvailability() {
    const out = {};
    for (const s of SUBJECTS) out[s] = eligiblePool(s).length;
    return out;
}

/** Papers reward speed: budget ≈ 75% of summed per-question band targets. */
function suggestDurationMins(qids) {
    const total = (qids || []).reduce((sum, qid) => sum + _num(qById(qid) && qById(qid).targetTimeMins, 3), 0);
    return Math.max(10, Math.min(240, Math.round(total * 0.75)));
}

// ── Difficulty tiers & fair-mix allotment ──
// qElo bands collapse into three paper tiers; a mix (percentage triple) is
// allotted via largest-remainder rounding, and any tier that runs dry hands
// its deficit to its neighbours so the paper still fills to the requested size.
const TIER_OF = (qElo) => {
    const e = _num(qElo, 1200);
    return e >= 1700 ? 'hard' : (e >= 1300 ? 'medium' : 'easy');
};
const TIERS = ['easy', 'medium', 'hard'];
const TIER_GLYPH = { easy: '🟢 Easy · <1300', medium: '🟡 Medium · 1300–1699', hard: '🔴 Hard · 1700+' };

const DIFF_MIX_PRESETS = {
    balanced: { label: '⚖️ Balanced — ⅓ each', easy: 34, medium: 33, hard: 33 },
    jeemain: { label: '🎯 JEE Main vibe — 35/45/20', easy: 35, medium: 45, hard: 20 },
    jeeadv: { label: '🔥 Advanced vibe — 15/40/45', easy: 15, medium: 40, hard: 45 },
    foundation: { label: '🧱 Foundation check — 60/30/10', easy: 60, medium: 30, hard: 10 },
};
const DIFF_MIX_DEFAULT = 'jeemain';

/** Largest-remainder split of `total` across tiers per the mix percentages. */
function allotByMix(total, mix) {
    const sumW = Math.max(1, (mix.easy || 0) + (mix.medium || 0) + (mix.hard || 0));
    const out = {}; let assigned = 0;
    const frac = [];
    for (const t of TIERS) {
        const exact = total * _num(mix[t], 0) / sumW;
        out[t] = Math.floor(exact);
        assigned += out[t];
        frac.push([exact - out[t], t]);
    }
    frac.sort((a, b) => b[0] - a[0]);
    for (const [, t] of frac) { if (assigned >= total) break; out[t]++; assigned++; }
    return out;
}

/**
 * Sample `want` questions from `pool` honouring the tier mix. Tiers that run
 * short push their deficit to the adjacent tiers (easy↔medium↔hard), so the
 * paper still fills to `want` whenever the pool allows. Returns the picks.
 */
function sampleByMix(pool, want, mix) {
    const tiers = { easy: [], medium: [], hard: [] };
    for (const q of pool) tiers[TIER_OF(q.qElo)].push(q);
    for (const t of TIERS) shuffle(tiers[t]);
    const allot = allotByMix(want, mix);
    const picked = [];
    const deficit = {};
    for (const t of TIERS) {
        const take = Math.min(allot[t], tiers[t].length);
        picked.push(...tiers[t].splice(0, take));
        deficit[t] = allot[t] - take;
    }
    const neighbourOrder = { easy: ['medium', 'hard'], medium: ['hard', 'easy'], hard: ['medium', 'easy'] };
    for (const t of TIERS) {
        let need = deficit[t];
        for (const alt of neighbourOrder[t]) {
            if (need <= 0) break;
            const take = Math.min(need, tiers[alt].length);
            picked.push(...tiers[alt].splice(0, take));
            need -= take;
        }
    }
    return picked;
}

function tierCountsOf(questions) {
    const out = { easy: 0, medium: 0, hard: 0 };
    for (const q of questions) out[TIER_OF(q.qElo)]++;
    return out;
}

// Coalesced builder re-render — linkQuestion fires once per committed question,
// so a 30-question dump must not re-render the panel 30 times.
let _builderRefreshT = null;
function scheduleBuilderRefresh(mockId) {
    if (_builderRefreshT) return;
    _builderRefreshT = setTimeout(() => {
        _builderRefreshT = null;
        const target = document.getElementById('view-mocks');
        if (!target || !target.classList.contains('active')) return;
        if (_studioMode.view === 'builder' && _studioMode.mockId === mockId) renderMocksView();
    }, 350);
}

// ════════════════════════════════════════════════════════════════════════════
// RUNNER
// ════════════════════════════════════════════════════════════════════════════

let _runTick = null;
let _curQid = null;
let _activeMockId = null;

function startMock(id) {
    const m = getMock(id); if (!m) return;
    const qids = allQuestionIds(m);
    // Validate bank presence; drop missing with warning.
    const valid = qids.filter(qid => qById(qid));
    if (valid.length !== qids.length) {
        _toast((qids.length - valid.length) + ' question(s) were deleted from the bank — dropped from this paper.');
        for (const s of SUBJECTS) m.sections[s].questionIds = m.sections[s].questionIds.filter(q => valid.includes(q));
    }
    if (!valid.length) { _toast('This paper has no questions yet — add some in the builder.'); return; }
    if (m.status === 'building') { if (!finalizeMock(id)) { _toast('Every question needs a valid answer-key entry before starting.'); return; } }
    if (m.status === 'done') { showResults(m); return; }
    if (!m.run || m.run.expired) {
        const minutes = _num(m.durationMins, 0) > 0 ? Math.round(m.durationMins) : suggestDurationMins(valid);
        m.run = { startedAt: Date.now(), endsAt: Date.now() + minutes * 60000, order: shuffle(valid.slice()), answers: {}, marked: [], cur: 0, events: {} };
        m.status = 'in-progress';
    }
    persist();
    openRunner(m);
}

function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function openRunner(m) {
    _activeMockId = m.id;
    document.querySelectorAll('.mock-runner').forEach(o => o.remove());
    const ov = document.createElement('div');
    ov.className = 'mock-runner';
    ov.innerHTML = '<div class="mr-shell"><div class="mr-topbar">' +
        '<span class="mr-name">📝 ' + _esc(m.name) + '</span>' +
        '<span class="mr-clock" id="mr-clock">--:--</span>' +
        '<button class="mr-iconbtn" onclick="window.mrExit()" type="button" title="Exit — clock keeps running">⤢</button>' +
        '<button class="mr-iconbtn" onclick="window.mrTogglePalette()" type="button" title="Question palette">☰</button>' +
        '</div><div class="mr-clockbar"><div id="mr-clockfill"></div></div>' +
        '<div class="mr-body"><div class="mr-qarea" id="mr-qarea"></div>' +
        '<div class="mr-palette" id="mr-palette"></div></div>' +
        '<div class="mr-footer">' +
        '<button class="mr-navbtn" onclick="window.mrNav(-1)" type="button">← Prev</button>' +
        '<button class="mr-markbtn" id="mr-markbtn" onclick="window.mrToggleMark()" type="button">⚑ Mark</button>' +
        '<button class="mr-navbtn mr-submit" onclick="window.mrAskSubmit()" type="button">Submit paper</button>' +
        '<button class="mr-navbtn" onclick="window.mrNav(1)" type="button">Next →</button>' +
        '</div></div>' +
        '<div class="mr-confirm" id="mr-confirm" style="display:none"></div>';
    document.body.appendChild(ov);
    document.body.classList.add('mock-running');
    renderMrQuestion();
    renderMrPalette();
    if (_runTick) clearInterval(_runTick);
    _runTick = setInterval(mrTick, 1000);
    mrTick();
    _attachKeys();
}

function mrActive() { const m = getMock(_activeMockId); return (m && m.status === 'in-progress') ? m : null; }

/** MM:SS under an hour, H:MM:SS above — a 3h paper is "2:59:59", not "179:59". */
function fmtClock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const two = n => String(n).padStart(2, '0');
    return h > 0 ? h + ':' + two(m) + ':' + two(sec) : two(m) + ':' + two(sec);
}

function mrTick() {
    const m = mrActive(); if (!m) return;
    const remainMs = m.run.endsAt - Date.now();
    const fill = document.getElementById('mr-clockfill');
    const clock = document.getElementById('mr-clock');
    if (!clock) return;
    if (remainMs <= 0) { clock.textContent = 'TIME UP'; if (fill) fill.style.width = '0%'; mrDoSubmit(true); return; }
    clock.textContent = fmtClock(remainMs);
    const totalSpan = m.run.endsAt - m.run.startedAt;
    const frac = Math.max(0, Math.min(100, (remainMs / totalSpan) * 100));
    if (fill) {
        fill.style.width = frac + '%';
        fill.className = frac < 5 ? 'crit' : (frac < 20 ? 'warn' : '');
    }
}

function qPatternOf(qid) {
    const q = qById(qid);
    return q ? getPatternForQuestion(q) : 'numeric';
}

function renderMrQuestion() {
    const m = mrActive(); if (!m) return;
    const qid = m.run.order[m.run.cur];
    _curQid = qid;
    const q = qById(qid);
    const area = document.getElementById('mr-qarea');
    if (!q) { area.innerHTML = '<p>Missing question.</p>'; return; }
    if (!m.run.events[qid]) m.run.events[qid] = [];
    m.run.events[qid].push({ t: 'seen', at: Date.now() });
    const ans = m.run.answers[qid] || {};
    const pattern = getPatternForQuestion(q);
    const subj = SUBJECTS.find(s => m.sections[s].questionIds.includes(qid)) || '';
    let body = '';
    if (q.imageDataUrl) body += '<img class="mr-img" src="' + q.imageDataUrl + '">';
    if (q.diagramImageUrl) body += '<img class="mr-img" src="' + q.diagramImageUrl + '">';
    if (q.extractedText) body += '<div class="mr-text latex">' + _esc(q.extractedText) + '</div>';
    if (pattern === 'numeric') {
        body += '<input type="text" inputmode="decimal" class="mr-numeric" id="mr-numinput" placeholder="Your answer" value="' + _esc(ans.value != null && !Array.isArray(ans.value) ? ans.value : '') + '" oninput="window.mrNum(this.value)">';
    } else {
        const isMulti = pattern === 'multi';
        const sel = Array.isArray(ans.value) ? ans.value : [];
        body += '<div class="mr-opts">' + (q.options || []).map((o, i) => {
            const L = String.fromCharCode(65 + i);
            return '<div class="mr-opt' + (sel.includes(L) ? ' sel' : '') + '" data-letter="' + L + '" onclick="window.mrPick(this)" role="button">' +
                '<b>' + L + '</b> ' + _esc(o) + '</div>';
        }).join('') + '</div>' + (isMulti ? '<div class="mr-multihint">Multiple options may be correct</div>' : '');
    }
    const conf = ans.confidence || null;
    area.innerHTML =
        '<div class="mr-qhead"><span class="mr-qnum">Q' + (m.run.cur + 1) + ' / ' + m.run.order.length + '</span>' +
        '<span class="mr-pattern">' + _esc(subj ? SUBJECT_GLYPH[subj].split(' ')[1] : '') + ' · ' + pattern.toUpperCase() + '</span>' +
        '<span class="mr-conf">' + ['sure', 'likely', 'guess'].map(c =>
            '<button class="mr-confbtn' + (conf === c ? ' sel' : '') + '" data-c="' + c + '" onclick="window.mrConf(\'' + c + '\')">' + c[0].toUpperCase() + '</button>').join('') +
        '</span></div>' + body;
    try { if (typeof win.processElementMath === 'function') win.processElementMath(area); } catch (_) {}
    updateMarkBtn();
    persistThrottled();
}

function updateMarkBtn() {
    const m = mrActive(); if (!m || !_curQid) return;
    const btn = document.getElementById('mr-markbtn');
    if (btn) { const mk = m.run.marked.includes(_curQid); btn.textContent = mk ? '⚑ Marked' : '⚑ Mark'; btn.classList.toggle('on', mk); }
}

win.mrPick = function (el) {
    const m = mrActive(); if (!m || !_curQid) return;
    const L = el.getAttribute('data-letter');
    const pattern = qPatternOf(_curQid);
    const a = m.run.answers[_curQid] = m.run.answers[_curQid] || {};
    if (pattern === 'multi') {
        const sel = Array.isArray(a.value) ? a.value.slice() : [];
        const i = sel.indexOf(L);
        if (i >= 0) sel.splice(i, 1); else sel.push(L);
        a.value = sel.sort();
        el.classList.toggle('sel');
    } else {
        a.value = [L];
        document.querySelectorAll('.mr-opt').forEach(o => o.classList.remove('sel'));
        el.classList.add('sel');
    }
    a.tSec = Math.round((Date.now() - m.run.startedAt) / 1000);
    m.run.events[_curQid].push({ t: 'ans', at: Date.now(), value: a.value });
    persistThrottled(); renderMrPalette();
};

win.mrNum = function (v) {
    const m = mrActive(); if (!m || !_curQid) return;
    const a = m.run.answers[_curQid] = m.run.answers[_curQid] || {};
    a.value = v; a.tSec = Math.round((Date.now() - m.run.startedAt) / 1000);
    persistThrottled();
};

win.mrConf = function (level) {
    const m = mrActive(); if (!m || !_curQid) return;
    const a = m.run.answers[_curQid] = m.run.answers[_curQid] || {};
    a.confidence = level;
    document.querySelectorAll('.mr-confbtn').forEach(b => b.classList.toggle('sel', b.getAttribute('data-c') === level));
    persistThrottled();
};

win.mrToggleMark = function () {
    const m = mrActive(); if (!m || !_curQid) return;
    const i = m.run.marked.indexOf(_curQid);
    if (i >= 0) m.run.marked.splice(i, 1); else m.run.marked.push(_curQid);
    updateMarkBtn(); renderMrPalette(); persistThrottled();
};

win.mrNav = function (delta) {
    const m = mrActive(); if (!m) return;
    m.run.cur = Math.max(0, Math.min(m.run.order.length - 1, m.run.cur + delta));
    persistThrottled(); renderMrQuestion(); renderMrPalette();
};

win.mrGoto = function (i) {
    const m = mrActive(); if (!m) return;
    m.run.cur = Math.max(0, Math.min(m.run.order.length - 1, i));
    persistThrottled(); renderMrQuestion(); renderMrPalette();
    const p = document.getElementById('mr-palette');
    if (p && window.matchMedia && window.matchMedia('(max-width: 760px)').matches) p.classList.remove('open');
};

win.mrTogglePalette = function () {
    const p = document.getElementById('mr-palette');
    if (p) p.classList.toggle('open');
};

win.mrExit = function () {
    const ov = document.querySelector('.mock-runner');
    if (ov) ov.style.display = 'none';
    document.body.classList.remove('mock-running');
    _detachKeys();
    persist();
    renderMocksView();
    _toast('Paper paused — the clock is still running.');
};

function renderMrPalette() {
    const m = mrActive(); if (!m) return;
    const p = document.getElementById('mr-palette'); if (!p) return;
    let nAns = 0;
    m.run.order.forEach(qid => {
        const a = m.run.answers[qid];
        if (a && a.value && (!Array.isArray(a.value) || a.value.length)) nAns++;
    });
    p.innerHTML = '<div class="mr-pal-title">Questions</div>' +
        '<div class="mr-pal-legend">' +
        '<span><i class="lg-ans"></i>' + nAns + ' answered</span>' +
        '<span><i class="lg-un"></i>' + (m.run.order.length - nAns) + ' left</span>' +
        '<span><i class="lg-mk"></i>' + m.run.marked.length + ' marked</span></div>' +
        m.run.order.map((qid, i) => {
            const a = m.run.answers[qid];
            const cls = a && ((Array.isArray(a.value) && a.value.length) || (!Array.isArray(a.value) && a.value)) ? 'ans' : 'un';
            const mk = m.run.marked.includes(qid) ? ' mk' : '';
            const cur = i === m.run.cur ? ' cur' : '';
            return '<button class="mr-pal-cell ' + cls + mk + cur + '" onclick="window.mrGoto(' + i + ')" type="button">' + (i + 1) + '</button>';
        }).join('');
}

win.mrAskSubmit = function () {
    const m = mrActive(); if (!m) return;
    const unanswered = m.run.order.filter(q => { const a = m.run.answers[q]; return !a || !a.value || (Array.isArray(a.value) && !a.value.length); }).length;
    const box = document.getElementById('mr-confirm');
    box.style.display = 'block';
    box.innerHTML = '<div class="mr-confirm-card"><h3>Submit paper?</h3>' +
        '<p>' + unanswered + ' unanswered · ' + m.run.marked.length + ' marked</p>' +
        '<p class="mr-warn">Clock keeps running until you confirm.</p>' +
        '<button class="mr-navbtn mr-submit" onclick="window.mrDoSubmit()" type="button">Confirm submit</button>' +
        '<button class="mr-navbtn" onclick="document.getElementById(\'mr-confirm\').style.display=\'none\'" type="button">Keep solving</button></div>';
};

win.mrDoSubmit = function (auto) {
    const m = mrActive(); if (!m) return;
    if (_runTick) { clearInterval(_runTick); _runTick = null; }
    m.run.expired = !!auto;
    m.finishedAt = Date.now();
    m.scorecard = computeMockScorecard(m, qByIdMap());
    m.status = 'done';
    m.scorecardStale = false;
    // Feed the self-correcting loop: chapter::pattern loss mass.
    try { accumulateMockFocus(m); } catch (_) {}
    persist();
    if (auto) _toast('⏰ Time was up — the paper was auto-submitted.');
    showResults(m);
};

function accumulateMockFocus(m) {
    ensureState();
    const sc = m.scorecard; if (!sc) return;
    const map = qByIdMap();
    for (const qid of sc.wrongIds) {
        const q = map[String(qid)]; if (!q) continue;
        const key = String(q.chapter || 'Uncategorized').toLowerCase() + '::' + getPatternForQuestion(q);
        AppState.mockFocus[key] = (AppState.mockFocus[key] || 0) + 1;
    }
}

// ── Keyboard shortcuts (runner only) ──
function _onRunnerKey(e) {
    const m = mrActive(); if (!m) return;
    const t = e.target;
    const typing = t && ((t.tagName === 'INPUT' && t.id !== 'mr-numinput') || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.key === 'Escape') {
        const c = document.getElementById('mr-confirm');
        if (c && c.style.display !== 'none') { c.style.display = 'none'; return; }
        const p = document.getElementById('mr-palette');
        if (p && p.classList.contains('open')) { p.classList.remove('open'); }
        return;
    }
    if (typing) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); win.mrNav(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); win.mrNav(1); }
    else if (/^[a-dA-D]$/.test(e.key)) {
        const opt = document.querySelector('.mr-opt[data-letter="' + e.key.toUpperCase() + '"]');
        if (opt) win.mrPick(opt);
    }
    else if (e.key === 'm' || e.key === 'M') win.mrToggleMark();
}
function _attachKeys() { document.addEventListener('keydown', _onRunnerKey); }
function _detachKeys() { document.removeEventListener('keydown', _onRunnerKey); }

// ── Results screen: scorecard + per-question review ──
let _resultsMockId = null;
let _resultsFilter = 'all';
let _revRows = [];
const _revExpanded = new Set();

/** Grade one paper question for the review list: paper key + your answer. */
function _gradeRow(m, qid, index) {
    const q = qById(qid);
    if (!q) return null;
    let key = null;
    for (const s of SUBJECTS) {
        const sec = m.sections[s];
        if (sec && sec.keys && hasKey(sec.keys[qid])) { key = sec.keys[qid]; break; }
    }
    const pattern = getPatternForQuestion(q);
    const ans = (m.run && m.run.answers && m.run.answers[qid]) || {};
    const g = gradeAnswer(q, ans.value, key);
    const keyStr = Array.isArray(key) ? key.join(', ') : (key != null ? String(key) : '');
    const ansStr = Array.isArray(ans.value) ? ans.value.join(', ') : (ans.value != null && ans.value !== '' ? String(ans.value) : '');
    const skipped = !g.attempted;
    const st = skipped ? 'skip' : (g.correct ? 'ok' : 'bad');
    return {
        qid, q, pattern, key, keyStr, ansStr, g, ans, st, index,
        marked: !!(m.run && m.run.marked && m.run.marked.includes(qid)),
    };
}

function _revBodyHtml(r) {
    const q = r.q;
    let h = '';
    if (q.imageDataUrl) h += '<img class="mr-img" src="' + q.imageDataUrl + '">';
    if (q.diagramImageUrl) h += '<img class="mr-img" src="' + q.diagramImageUrl + '">';
    if (q.extractedText) h += '<div class="mr-text latex">' + _esc(q.extractedText) + '</div>';
    if (r.pattern === 'numeric') {
        h += '<div class="mr-rev-ansline" style="font-size:12px;">Your answer: ' + _esc(r.ansStr || '—') + ' · Key: ' + _esc(r.keyStr || '?') + '</div>';
    } else {
        const sel = Array.isArray(r.ans.value) ? r.ans.value : [];
        const keySet = new Set(Array.isArray(r.key) ? r.key : String(r.key || '').replace(/[^A-D]/g, '').split(''));
        h += '<div class="mr-opts">' + (q.options || []).map((o, i) => {
            const L = String.fromCharCode(65 + i);
            return '<div class="mr-rev-opt' + (keySet.has(L) ? ' correct' : '') + (sel.includes(L) ? ' you' : '') + '"><b>' + L + '</b>' + _esc(o) + '</div>';
        }).join('') + '</div>';
    }
    if (q.solution) h += '<div class="mr-rev-sol"><b>💡 Solution</b><br>' + _esc(q.solution) + '</div>';
    if (r.st === 'bad') {
        h += '<div class="mr-rev-actions">' + (q.status === 'error'
            ? '<span class="mr-invault">🗂 Already in the Vault</span>'
            : '<button class="mr-vaultbtn" onclick="window.mrVault(\'' + r.qid + '\')" type="button">🗂 Log to Vault</button>') + '</div>';
    }
    return h;
}

function showResults(m) {
    _detachKeys();
    closeRunnerChrome();
    // Remove every runner overlay first — the old code stacked the results
    // screen on top of the still-live runner DOM.
    document.querySelectorAll('.mock-runner').forEach(o => o.remove());
    const qMap = qByIdMap();
    if (m.scorecardStale || !m.scorecard) {
        m.scorecard = computeMockScorecard(m, qMap);
        m.scorecardStale = false;
        persist();
    }
    const sc = m.scorecard;
    if (_resultsMockId !== m.id) { _resultsFilter = 'all'; _revExpanded.clear(); }
    _resultsMockId = m.id;

    const order = (m.run && m.run.order && m.run.order.length) ? m.run.order : allQuestionIds(m);
    _revRows = order.map((qid, i) => _gradeRow(m, qid, i)).filter(Boolean);
    const nOk = _revRows.filter(r => r.st === 'ok').length;
    const nBad = _revRows.filter(r => r.st === 'bad').length;
    const nSkip = _revRows.filter(r => r.st === 'skip').length;
    const nMarked = _revRows.filter(r => r.marked).length;

    const filt = (f, label, n) =>
        '<button class="mr-fchip' + (_resultsFilter === f ? ' on' : '') + '" onclick="window.mrRevFilter(\'' + f + '\')" type="button">' + label + ' ' + n + '</button>';

    const reviewHtml = _revRows.map((r, i) => {
        if (_resultsFilter === 'bad' && r.st !== 'bad') return '';
        if (_resultsFilter === 'skip' && r.st !== 'skip') return '';
        if (_resultsFilter === 'ok' && r.st !== 'ok') return '';
        if (_resultsFilter === 'marked' && !r.marked) return '';
        const extract = (r.q.extractedText || '(image question)').slice(0, 100);
        const stCls = r.st === 'ok' ? 'ok' : (r.st === 'bad' ? 'bad' : 'skip');
        const stIcon = r.st === 'ok' ? '✓' : (r.st === 'bad' ? '✗' : '—');
        const mkCls = r.st === 'ok' ? 'pos' : (r.st === 'bad' ? 'neg' : 'zero');
        const marksTxt = (r.g.marks > 0 ? '+' : '') + r.g.marks;
        const ansline = r.st === 'skip'
            ? 'Skipped · Key: ' + _esc(r.keyStr || '?')
            : 'You: ' + _esc(r.ansStr || '—') + ' · Key: ' + _esc(r.keyStr || '?');
        const expanded = _revExpanded.has(i);
        return '<div class="mr-rev-item">' +
            '<button class="mr-rev-row" onclick="window.mrRevToggle(' + i + ')" type="button">' +
            '<span class="mr-rev-num">' + (r.index + 1) + '</span>' +
            '<span class="mr-st ' + stCls + '">' + stIcon + '</span>' +
            '<span class="mr-rev-main"><span class="mr-rev-extract">' + _esc(extract) + '</span>' +
            '<span class="mr-rev-ansline">' + ansline + '</span></span>' +
            '<span class="mr-rev-marks ' + mkCls + '">' + marksTxt + '</span>' +
            '</button>' +
            // Pre-render expanded bodies — a filter change or Vault-refresh
            // rebuilds this DOM, and an empty "open" body would look broken.
            '<div class="mr-rev-body" id="mr-rev-body-' + i + '" data-open="' + (expanded ? '1' : '0') + '"' +
            (expanded ? '>' + _revBodyHtml(r) + '</div>' : ' hidden></div>') +
            '</div>';
    }).join('') || '<div class="mr-emptyline">Nothing matches this filter.</div>';

    const subjRows = sc.sections.map(r => {
        const pct = r.max > 0 ? Math.max(0, Math.min(100, (r.marks / r.max) * 100)) : 0;
        return '<div class="mr-subjrow"><span class="sname">' + SUBJECT_GLYPH[r.subject] + '</span>' +
            '<span class="mr-bar"><i style="width:' + pct.toFixed(1) + '%"></i></span>' +
            '<span class="snums">' + r.marks + '/' + r.max + ' · ✓' + r.correct + ' ✗' + r.wrong + ' —' + r.skipped + '</span></div>';
    }).join('');

    // ── Post-mock autopsy: tag × difficulty breakdown of the losses. Fresh on
    // submit, then cached on the mock so reopening shows the same breakdown.
    let autopsy = null;
    if (sc.wrongIds.length) {
        if (m.autopsy && Array.isArray(m.autopsy.byTag)) {
            autopsy = m.autopsy;
            win._lastAutopsyText = m.autopsy.text || '';
        } else {
            autopsy = buildMockAutopsy(sc.wrongIds, qMap);
            if (autopsy) {
                m.autopsy = { total: autopsy.total, byTag: autopsy.byTag, byBand: autopsy.byBand, text: autopsy.text, generatedAt: Date.now() };
                win._lastAutopsyText = autopsy.text;
            }
        }
    }
    const autopsyHtml = autopsy
        ? '<details class="mr-autopsy"><summary>🔍 Mistake autopsy — what actually cost you</summary>' +
          '<table class="mr-table"><tr><th>Topic</th><th>✗</th></tr>' +
          autopsy.byTag.slice(0, 6).map(t => '<tr><td>' + _esc(t.tag) + '</td><td class="rp-bad">' + t.count + '</td></tr>').join('') +
          '</table><div style="margin-top:8px;">' +
          autopsy.byBand.map(b => '<span class="rp-chip" title="' + _esc(b.label) + '">' + _esc(b.label.split('·')[0].trim()) + ' ×' + b.count + '</span>').join(' ') +
          '</div><button class="mr-navbtn" style="margin-top:10px;" onclick="window.mockCopyAutopsy()" type="button">📋 Copy autopsy</button></details>'
        : '';

    const durMs = (m.finishedAt && m.run && m.run.startedAt) ? (m.finishedAt - m.run.startedAt) : 0;
    const timeChip = durMs > 0 ? '<span class="mr-chip time">⏱ ' + fmtClock(durMs) + '</span>' : '';
    const accChip = sc.attempted > 0
        ? '<span class="mr-chip acc">' + Math.round(sc.accuracy * 100) + '% accuracy</span>' : '';
    const predChip = sc.max > 0 ? '<span class="mr-chip pred">Predicted ~' + sc.predicted + '</span>' : '';
    const brierLine = sc.brier != null
        ? '<div class="mr-res-line">Calibration Brier: <b>' + sc.brier.toFixed(3) + '</b> over ' + sc.brierN + ' confidence-tagged answers (lower = honest)</div>'
        : '';

    const ov = document.createElement('div');
    ov.className = 'mock-runner';
    ov.innerHTML = '<div class="mr-shell results">' +
        '<div class="mr-res-head"><div class="mr-res-title">📊 ' + _esc(m.name) + '</div>' +
        '<div class="mr-scoreline"><span class="mr-total">' + sc.total + ' <span>/ ' + sc.max + '</span></span>' +
        predChip + accChip + timeChip + '</div>' +
        (sc.wrongIds.length
            ? '<div class="mr-res-line">❌ ' + sc.wrongIds.length + ' wrong — review below and log them to The Vault.</div>'
            : '<div class="mr-res-line">Clean paper. 😤</div>') +
        '</div>' +
        '<div class="mr-res-body">' + brierLine +
        '<div class="mr-subjgrid">' + subjRows + '</div>' +
        '<div class="mr-filters">' +
        filt('all', 'All', _revRows.length) +
        filt('bad', '✗ Wrong', nBad) +
        filt('skip', '— Skipped', nSkip) +
        filt('marked', '⚑ Marked', nMarked) +
        filt('ok', '✓ Correct', nOk) +
        '</div>' +
        '<div class="mr-revlist">' + reviewHtml + '</div>' +
        autopsyHtml +
        '<div style="margin-top:16px; display:flex; gap:8px; justify-content:center;">' +
        '<button class="mr-navbtn" onclick="window.mockCloseResults()" type="button">Back to Studio</button></div></div></div>';
    document.body.appendChild(ov);
    // Hydrate math across the sheet — pre-rendered review bodies contain
    // .latex blocks that need the same treatment the runner gives its area.
    try { ov.removeAttribute('data-math-rendered'); if (typeof win.processElementMath === 'function') win.processElementMath(ov); } catch (_) {}
};

win.mrRevToggle = function (i) {
    const body = document.getElementById('mr-rev-body-' + i);
    if (!body) return;
    if (body.dataset.open === '1') { body.hidden = true; body.dataset.open = '0'; _revExpanded.delete(i); return; }
    if (!body.dataset.rendered) {
        const r = _revRows[i]; if (!r) return;
        body.innerHTML = _revBodyHtml(r);
        body.dataset.rendered = '1';
        try { if (typeof win.processElementMath === 'function') win.processElementMath(body); } catch (_) {}
    }
    body.hidden = false; body.dataset.open = '1';
    _revExpanded.add(i);
};

win.mrRevFilter = function (f) {
    _resultsFilter = f;
    const m = getMock(_resultsMockId);
    if (m) showResults(m);
};

win.mrVault = function (qid) {
    const q = qById(qid); if (!q) return;
    AppState.pendingWrongQ = q;
    if (typeof win.openModal === 'function') win.openModal('error-reason-modal');
    else _toast('Open The Vault from the sidebar to log this question.');
};

/** Clipboard copy of the last rendered autopsy text (with legacy fallback). */
win.mockCopyAutopsy = function () {
    const txt = win._lastAutopsyText || '';
    if (!txt) return;
    const done = () => _toast('Autopsy copied — paste it anywhere.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done).catch(() => _fallbackCopyAutopsy(txt));
    } else _fallbackCopyAutopsy(txt);
};

function _fallbackCopyAutopsy(txt) {
    try {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        _toast('Autopsy copied — paste it anywhere.');
    } catch (_) {
        _toast('Copy failed. Autopsy text:\n\n' + txt);
    }
}

win.mockCloseResults = function () {
    document.querySelectorAll('.mock-runner').forEach(o => o.remove());
    document.body.classList.remove('mock-running');
    _detachKeys();
    _resultsMockId = null;
    renderMocksView();
};

function closeRunnerChrome() {
    if (_runTick) { clearInterval(_runTick); _runTick = null; }
    document.body.classList.remove('mock-running');
    _detachKeys();
}

// ── throttled persistence ──
let _pt = null;
function persistThrottled() {
    if (_pt) return;
    _pt = setTimeout(() => { _pt = null; persist(); }, 1200);
}

// ════════════════════════════════════════════════════════════════════════════
// STUDIO UI
// ════════════════════════════════════════════════════════════════════════════

let _studioMode = { view: 'home' };

function rootEl() { return document.getElementById('mock-studio-root'); }

function renderMocksView() {
    const root = rootEl(); if (!root) return;
    ensureState();
    _syncMockLinkBanner();
    if (_studioMode.view === 'builder') renderBuilder(root);
    else if (_studioMode.view === 'keys') renderKeyPass(root);
    else if (_studioMode.view === 'analysis') renderAnalysis(root);
    else renderHome(root);
}

function renderHome(root) {
    const drafts = AppState.mocks.slice().reverse();
    const avail = subjectAvailability();
    root.innerHTML =
        '<div class="mk-head"><div><span class="kicker">// EXAM SIMULATION</span><h2 class="box-title">Mock Tests</h2>' +
        '<p class="box-desc">Real papers, real clocks, real marking. No feedback until you submit.</p></div>' +
        '<div class="mk-create"><input id="mk-name" class="pomo-input" placeholder="Paper name (e.g., Allen Major 7)" onkeydown="if(event.key===\'Enter\')window.mockCreate()"><button class="btn btn-primary" onclick="window.mockCreate()" type="button">+ New Mock</button></div></div>' +
        '<div class="mk-tools"><button class="btn btn-secondary btn-sm" onclick="window.mockAutoBuild()" type="button">⚡ Auto-build from bank</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="window.mockWeakPoints()" type="button">🔍 Weak points & analysis</button></div>' +
        '<div class="mk-auto" id="mk-auto" hidden>' +
        '<div class="mk-note" style="margin-top:0;">Sample questions from your bank into a fresh draft — the difficulty mix allots how many land in each qElo tier, borrowing from neighbouring tiers when one runs short. You\'ll land on the answer-key pass to review keys before starting.</div>' +
        '<div class="mk-auto-mix">' +
        '<select id="mk-auto-mix" class="pomo-select" onchange="window.mockAutoMixPreset(this.value)">' +
        Object.entries(DIFF_MIX_PRESETS).map(([k, p]) => '<option value="' + k + '"' + (k === DIFF_MIX_DEFAULT ? ' selected' : '') + '>' + _esc(p.label) + '</option>').join('') +
        '<option value="custom">✏️ Custom mix</option>' +
        '</select>' +
        TIERS.map(t => '<span class="mk-mix-cell"><label>' + TIER_GLYPH[t].split(' ')[0] + '</label>' +
            '<input id="mk-mix-' + t + '" type="number" min="0" max="100" value="' + DIFF_MIX_PRESETS[DIFF_MIX_DEFAULT][t] + '" onchange="window.mockAutoMixEdit()">% </span>').join('') +
        '</div>' +
        '<div class="mk-auto-grid">' +
        SUBJECTS.map(s => {
            const tc = tierCountsOf(eligiblePool(s));
            return '<div class="mk-auto-cell"><label>' + SUBJECT_GLYPH[s] + ' · ' + avail[s] + ' available' +
                ' <span class="mk-avail">(' + tc.easy + '🟢 ' + tc.medium + '🟡 ' + tc.hard + '🔴)</span></label>' +
                '<input id="mk-auto-' + s + '" type="number" min="0" max="' + avail[s] + '" value="' + Math.min(20, avail[s]) + '"></div>';
        }).join('') +
        '</div>' +
        '<button class="btn btn-primary btn-sm" onclick="window.mockAutoBuildGo()" type="button">🎲 Draft paper</button>' +
        '</div>' +
        '<div id="mk-list"></div>';
    const list = document.getElementById('mk-list');
    if (!drafts.length) {
        list.innerHTML = '<div class="mk-empty">No papers yet. Auto-build one from your bank, create an empty paper and add questions, or dump fresh ones via AI while a subject panel is active.</div>';
        return;
    }
    list.innerHTML = drafts.map(m => {
        const counts = SUBJECTS.map(s => SUBJECT_GLYPH[s].split(' ')[0] + ' ' + m.sections[s].questionIds.length).join(' · ');
        const nQ = totalQuestions(m);
        const dur = _num(m.durationMins, 0) > 0 ? m.durationMins + ' min' : suggestDurationMins(allQuestionIds(m)) + ' min (auto)';
        let stLabel = { building: '🔨 Building', ready: '🟢 Ready', 'in-progress': '⏳ In progress', done: '✅ Done' }[m.status] || m.status;
        if (m.status === 'in-progress' && m.run) {
            stLabel += (m.run.endsAt > Date.now()) ? ' · ' + fmtClock(m.run.endsAt - Date.now()) + ' left' : ' · time up';
        }
        let actions = '';
        if (m.status === 'building') {
            actions = '<button class="btn btn-primary btn-sm" onclick="window.mockOpenBuilder(\'' + m.id + '\')" type="button">Continue building</button>';
        } else if (m.status === 'ready') {
            actions = '<button class="btn btn-primary btn-sm" onclick="window.mockStart(\'' + m.id + '\')" type="button">▶ Start paper</button>' +
                '<button class="btn btn-secondary btn-sm" onclick="window.mockKeysFor(\'' + m.id + '\')" type="button">🔑 Keys</button>';
        } else if (m.status === 'in-progress') {
            actions = '<button class="btn btn-primary btn-sm" onclick="window.mockStart(\'' + m.id + '\')" type="button">⏳ Resume</button>';
        } else {
            actions = '<button class="btn btn-secondary btn-sm" onclick="window.mockStart(\'' + m.id + '\')" type="button">📊 Scorecard</button>' +
                '<button class="btn btn-secondary btn-sm" onclick="window.mockKeysFor(\'' + m.id + '\')" type="button">🔑 Keys</button>';
        }
        actions += ' <button class="btn btn-danger btn-sm" onclick="window.mockDelete(\'' + m.id + '\')" type="button" title="Delete paper">🗑</button>';
        return '<div class="mk-card"><div class="mk-card-main"><b>' + _esc(m.name) + '</b>' +
            '<span class="mk-status ' + m.status + '">' + stLabel + '</span>' +
            '<span class="mk-counts">' + nQ + ' Q · ' + counts + ' · ⏱ ' + dur + '</span></div>' +
            '<div class="mk-card-actions">' + actions + '</div></div>';
    }).join('');
}

win.mockCreate = function () {
    const inp = document.getElementById('mk-name');
    const name = (inp && inp.value.trim()) || ('Mock ' + new Date().toLocaleDateString());
    if (inp) inp.value = '';
    ensureState();
    const m = { id: newId('mock'), name, kind: 'real', tier: 'standard', status: 'building', createdAt: Date.now(), sections: emptySections(), run: null, scorecard: null };
    AppState.mocks.push(m);
    persist();
    _studioMode = { view: 'builder', mockId: m.id };
    renderMocksView();
};

win.mockAutoBuild = function () {
    const p = document.getElementById('mk-auto');
    if (p) p.hidden = !p.hidden;
};

win.mockAutoMixPreset = function (key) {
    const mix = DIFF_MIX_PRESETS[key];
    if (!mix) return; // custom — leave the editable percentages alone
    for (const t of TIERS) {
        const inp = document.getElementById('mk-mix-' + t);
        if (inp) inp.value = mix[t];
    }
};

win.mockAutoMixEdit = function () {
    const sel = document.getElementById('mk-auto-mix');
    if (sel) sel.value = 'custom';
};

function _mixFromInputs() {
    const mix = {};
    for (const t of TIERS) {
        const inp = document.getElementById('mk-mix-' + t);
        mix[t] = Math.max(0, _num(inp && inp.value, 0));
    }
    if (mix.easy + mix.medium + mix.hard <= 0) return DIFF_MIX_PRESETS[DIFF_MIX_DEFAULT];
    return mix;
}

win.mockAutoBuildGo = function () {
    ensureState();
    const mix = _mixFromInputs();
    const m = {
        id: newId('mock'), name: 'Auto paper · ' + new Date().toLocaleDateString(),
        kind: 'real', tier: 'standard', status: 'building', createdAt: Date.now(),
        sections: emptySections(), run: null, scorecard: null,
    };
    let total = 0;
    const spread = { easy: 0, medium: 0, hard: 0 };
    for (const s of SUBJECTS) {
        const inp = document.getElementById('mk-auto-' + s);
        const want = Math.max(0, Math.min(_num(inp && inp.value, 0), 200));
        const picked = sampleByMix(eligiblePool(s), want, mix);
        for (const q of picked) {
            m.sections[s].questionIds.push(q.id);
            q.reservedForMock = m.id; q.mockSource = m.id;
            const k = prefillKeyFor(q);
            if (k) m.sections[s].keys[q.id] = k;
        }
        const tc = tierCountsOf(picked);
        for (const t of TIERS) spread[t] += tc[t];
        total += picked.length;
    }
    if (!total) { _toast('No eligible questions in your bank yet — dump some via AI first.'); return; }
    AppState.mocks.push(m);
    persist();
    _studioMode = { view: 'keys', mockId: m.id };
    renderMocksView();
    _toast('Drafted ' + total + ' questions — ' + spread.easy + ' easy · ' + spread.medium + ' medium · ' + spread.hard + ' hard. Check the keys, then finalize.');
};

win.mockOpenBuilder = function (id) {
    // A stale dump-link context pointing at another paper would silently
    // swallow fresh questions — clear it on any builder switch.
    if (AppState.mockDraftContext && AppState.mockDraftContext.mockId !== id) {
        AppState.mockDraftContext = null;
        persist();
    }
    _studioMode = { view: 'builder', mockId: id };
    renderMocksView();
};
win.mockDelete = function (id) {
    if (_pk && _pk.mockId === id) _closePicker();
    if (confirm('Delete this mock? Linked questions stay in your bank.')) { deleteMock(id); if (_studioMode.mockId === id) _studioMode = { view: 'home' }; renderMocksView(); }
};
win.mockStart = function (id) { startMock(id); };
win.mockKeysFor = function (id) {
    const m = getMock(id); if (!m) return;
    if (!totalQuestions(m)) { _toast('Add questions first.'); return; }
    _studioMode = { view: 'keys', mockId: id };
    renderMocksView();
};

function renderBuilder(root) {
    const m = getMock(_studioMode.mockId);
    if (!m) { _studioMode = { view: 'home' }; renderHome(root); return; }
    const durVal = _num(m.durationMins, 0) > 0 ? m.durationMins : suggestDurationMins(allQuestionIds(m));
    root.innerHTML = '<div class="mk-head"><button class="btn btn-secondary btn-sm" onclick="window.mockBackHome()" type="button">← Papers</button>' +
        '<h2 class="box-title">' + _esc(m.name) + '</h2></div>' +
        '<div class="mk-note">Fill each panel by <b>picking from your bank</b> or <b>linking a Gem dump</b> — linking opens Feed Questions on the Gem Text Track, and every imported question lands in the active panel. ' +
        'Any subset of subjects works — finalize once every present question has a key.</div>' +
        '<div class="mk-duration">⏱ Duration <input id="mk-dur" type="number" min="10" max="240" value="' + durVal + '" onchange="window.mockSetDuration(this.value)"> min' +
        '<span class="mk-dur-hint">' + (_num(m.durationMins, 0) > 0 ? '' : '(auto = 75% of per-question target time)') + '</span></div>' +
        '<div class="mk-subjects"></div>' +
        (canFinalize(m)
            ? '<div style="text-align:center; margin-top:14px;"><button class="btn btn-primary" onclick="window.mockGoKeys()" type="button">🔑 Answer-key pass → Finalize</button></div>'
            : '<div class="mk-note" style="text-align:center; opacity:.7;">Add at least one question and set every key to finalize.</div>');
    const wrap = root.querySelector('.mk-subjects');
    wrap.innerHTML = SUBJECTS.map(s => {
        const active = AppState.mockDraftContext && AppState.mockDraftContext.mockId === m.id && AppState.mockDraftContext.subject === s;
        const ids = m.sections[s].questionIds;
        const rows = ids.map((qid, i) => {
            const q = qById(qid);
            const title = q ? (q.extractedText || '(image question)').slice(0, 70) : '(deleted)';
            return '<div class="mk-qrow"><span class="mk-qnum">' + (i + 1) + '</span><span class="mk-qtitle">' + _esc(title) + '</span>' +
                '<button class="mk-qdel" onclick="window.mockUnlink(\'' + m.id + '\',\'' + qid + '\')" type="button" title="Remove from paper">✕</button></div>';
        }).join('');
        return '<div class="mk-subj-panel' + (active ? ' active' : '') + '">' +
            '<div class="mk-subj-head"><b>' + SUBJECT_GLYPH[s] + '</b><span>' + ids.length + ' Q</span></div>' +
            '<div class="mk-subj-body">' + (rows || '<div class="mk-none">Empty — add from the bank or link a dump below.</div>') + '</div>' +
            '<div class="mk-subj-actions">' +
            '<button class="btn btn-secondary btn-sm" onclick="window.mockPickOpen(\'' + m.id + '\',\'' + s + '\')" type="button">➕ From bank</button>' +
            '<button class="btn ' + (active ? 'btn-danger' : 'btn-primary') + ' btn-sm" onclick="window.mockToggleIngest(\'' + m.id + '\',\'' + s + '\')" type="button">' +
            (active ? '⏹ Stop linking' : '🧠 Link AI dumps') + '</button></div></div>';
    }).join('');
}

win.mockBackHome = function () {
    _closePicker();
    AppState.mockDraftContext = null;
    _syncMockLinkBanner();
    _studioMode = { view: 'home' };
    persist(); renderMocksView();
};

win.mockToggleIngest = function (mockId, subject) {
    const cur = AppState.mockDraftContext;
    if (cur && cur.mockId === mockId && cur.subject === subject) {
        AppState.mockDraftContext = null;
        _syncMockLinkBanner();
        persist(); renderMocksView();
        return;
    }
    AppState.mockDraftContext = { mockId, subject };
    AppState.currentSubject = subject;   // placement parity with normal dumps
    persist();
    renderMocksView();
    if (typeof win.openModal === 'function') {
        // Open the REAL dump terminal (Feed Questions), on the Gem Text Track —
        // the ai-dump-modal this used to open is the Smart Mistake Report.
        if (typeof win.switchIngestionTrack === 'function') {
            try { win.switchIngestionTrack('texttrack'); } catch (_) {}
        }
        _syncMockLinkBanner();
        win.openModal('upload-modal');
    } else {
        _toast('Linking active — open Feed Questions and paste your Gem dump. Every saved question lands in ' + SUBJECT_GLYPH[subject] + '.');
    }
};

/**
 * Mirror of the dump-link context inside the Feed Questions modal: a banner
 * telling the user exactly which paper + panel every saved question lands in,
 * with one-tap Stop / Copy-prompt actions. Hidden when no context is active.
 */
function _syncMockLinkBanner() {
    const content = document.querySelector('#upload-modal .modal-content');
    if (!content) return;
    let banner = document.getElementById('mk-link-banner');
    const ctx = AppState.mockDraftContext;
    if (!ctx) {
        if (banner) banner.remove();
        return;
    }
    const m = getMock(ctx.mockId);
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'mk-link-banner';
        banner.className = 'mk-link-banner';
        content.insertBefore(banner, content.firstChild.nextSibling || null);
    }
    banner.innerHTML = '<div style="flex:1;min-width:200px;">🔗 Dumping into <b>' + _esc(m ? m.name : 'paper') +
        '</b> · <b>' + _esc(String(ctx.subject || '').toUpperCase()) + '</b> — every imported question lands in that panel.' +
        '<br><span style="font-size:10px;opacity:.8;">Paste a Gem dump below (or upload a .json) and hit Execute.</span></div>' +
        '<button class="btn btn-secondary btn-sm" onclick="window.copyGemDumpPrompt && window.copyGemDumpPrompt()" type="button">📋 Gem prompt</button>' +
        '<button class="btn btn-danger btn-sm" onclick="window.mockToggleIngest(\'' + ctx.mockId + '\',\'' + ctx.subject + '\')" type="button">⏹ Stop</button>';
}

win.mockUnlink = function (mockId, qid) { unlinkQuestion(mockId, qid); renderMocksView(); };

win.mockSetDuration = function (v) {
    const m = getMock(_studioMode.mockId); if (!m) return;
    const n = parseInt(v, 10);
    m.durationMins = (n >= 10 && n <= 240) ? n : null;
    persist();
    // Re-render so the "(auto)" hint reflects the new state.
    const root = rootEl();
    if (root && _studioMode.view === 'builder') renderBuilder(root);
};

// ── Bank picker overlay ──
let _pk = null; // { mockId, subject, sel:Set, chapter:'', q:'' }

function _closePicker() {
    _pk = null;
    const ov = document.getElementById('mk-picker');
    if (ov) ov.remove();
}

win.mockPickOpen = function (mockId, subject) {
    _pk = { mockId, subject, sel: new Set(), chapter: '', q: '', tier: '' };
    renderPicker();
};

win.mockPickClose = function () { _closePicker(); };

win.mockPickChapter = function (ch) {
    if (!_pk) return;
    _pk.chapter = (_pk.chapter === ch) ? '' : ch;
    renderPicker();
};

win.mockPickTier = function (t) {
    if (!_pk) return;
    _pk.tier = (_pk.tier === t) ? '' : t;
    renderPickerList();
    // Chip states live in the tools row — flip them without a full re-render
    // would desync, so re-render chips only.
    const chipRow = document.getElementById('mk-pk-tiers');
    if (chipRow) {
        const pool = pickerPoolBase();
        const counts = tierCountsOf(pool);
        chipRow.innerHTML = _tierChipHtml(counts);
    }
};

/** Subject pool before the tier filter — used for the tier chip counts. */
function pickerPoolBase() {
    const m = getMock(_pk.mockId);
    const inPaper = m ? new Set(allQuestionIds(m)) : new Set();
    return eligiblePool(_pk.subject).filter(q => !inPaper.has(q.id));
}

win.mockPickSearch = function (v) {
    if (!_pk) return;
    _pk.q = String(v || '').toLowerCase();
    renderPickerList();
};

win.mockPickToggle = function (qid, el) {
    if (!_pk) return;
    if (_pk.sel.has(qid)) { _pk.sel.delete(qid); if (el) el.classList.remove('sel'); }
    else { _pk.sel.add(qid); if (el) el.classList.add('sel'); }
    const cnt = document.getElementById('mk-pk-count');
    if (cnt) cnt.textContent = _pk.sel.size + ' selected';
    const add = document.getElementById('mk-pk-add');
    if (add) add.disabled = _pk.sel.size === 0;
};

win.mockPickCommit = function () {
    if (!_pk) return;
    const m = getMock(_pk.mockId);
    if (!m) { _closePicker(); return; }
    const sec = m.sections[_pk.subject];
    const subject = _pk.subject;
    let added = 0;
    for (const qid of _pk.sel) {
        if (sec.questionIds.includes(qid)) continue;
        const q = qById(qid);
        if (!q) continue;
        q.reservedForMock = m.id; q.mockSource = m.id;
        sec.questionIds.push(qid);
        const k = prefillKeyFor(q);
        if (k) sec.keys[qid] = k;
        added++;
    }
    if (added) persist();
    _closePicker();
    renderMocksView();
    _toast(added + ' question' + (added === 1 ? '' : 's') + ' added to ' + SUBJECT_GLYPH[subject] + '.');
};

function pickerPool() {
    return pickerPoolBase()
        .filter(q => !_pk.tier || TIER_OF(q.qElo) === _pk.tier)
        .filter(q => !_pk.chapter || String(q.chapter || '') === _pk.chapter)
        .filter(q => !_pk.q || String(q.extractedText || '').toLowerCase().includes(_pk.q) || String(q.chapter || '').toLowerCase().includes(_pk.q));
}

function _tierChipHtml(counts) {
    return '<button class="mk-pk-chip' + (_pk.tier === '' ? ' on' : '') + '" onclick="window.mockPickTier(\'\')" type="button">All difficulties</button>' +
        TIERS.map(t => '<button class="mk-pk-chip' + (_pk.tier === t ? ' on' : '') + '" onclick="window.mockPickTier(\'' + t + '\')" type="button">' + TIER_GLYPH[t].split(' ')[0] + ' ' + TIER_GLYPH[t].split(' ')[1] + ' · ' + counts[t] + '</button>').join('');
}

function renderPicker() {
    if (!_pk) return;
    let ov = document.getElementById('mk-picker');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'mk-picker';
        ov.className = 'mk-picker';
        ov.onclick = (e) => { if (e.target === ov) _closePicker(); };
        document.body.appendChild(ov);
    }
    const pool = pickerPool();
    const chapters = [...new Set(eligiblePool(_pk.subject).map(q => String(q.chapter || 'Uncategorized')))].sort();
    ov.innerHTML = '<div class="mk-picker-card">' +
        '<div class="mk-pk-head"><b>➕ ' + SUBJECT_GLYPH[_pk.subject] + ' — pick from bank</b>' +
        '<button class="mk-pk-close" onclick="window.mockPickClose()" type="button">✕</button></div>' +
        '<div class="mk-pk-tools">' +
        '<input class="mk-pk-search" id="mk-pk-search" placeholder="Search text or chapter…" oninput="window.mockPickSearch(this.value)">' +
        '<div class="mk-pk-chips" id="mk-pk-tiers">' + _tierChipHtml(tierCountsOf(pickerPoolBase())) + '</div>' +
        '<div class="mk-pk-chips"><button class="mk-pk-chip' + (_pk.chapter === '' ? ' on' : '') + '" onclick="window.mockPickChapter(\'\')" type="button">All chapters</button>' +
        chapters.map(ch => {
            // JS-escape first, then HTML-escape — the other order would decode
            // &#39; back into a raw quote inside the JS string literal.
            const jsCh = _esc(String(ch).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
            return '<button class="mk-pk-chip' + (_pk.chapter === ch ? ' on' : '') + '" onclick="window.mockPickChapter(\'' + jsCh + '\')" type="button">' + _esc(ch) + '</button>';
        }).join('') +
        '</div></div>' +
        '<div class="mk-pk-list" id="mk-pk-list"></div>' +
        '<div class="mk-pk-foot"><span class="mk-pk-count" id="mk-pk-count">0 selected</span>' +
        '<button class="btn btn-secondary btn-sm" onclick="window.mockPickClose()" type="button">Cancel</button>' +
        '<button class="btn btn-primary btn-sm" id="mk-pk-add" disabled onclick="window.mockPickCommit()" type="button">Add selected</button></div>' +
        '</div>';
    renderPickerList();
    const search = document.getElementById('mk-pk-search');
    if (search) search.focus();
}

function renderPickerList() {
    const listEl = document.getElementById('mk-pk-list');
    if (!listEl || !_pk) return;
    const pool = pickerPool();
    if (!pool.length) {
        listEl.innerHTML = '<div class="mr-emptyline">No eligible questions match. Questions already in this paper, reserved ones, and anomalies are excluded.</div>';
        return;
    }
    const stDot = { solved: '🟢', wrong: '🔴', error: '🗂', unsolved: '⚪' };
    listEl.innerHTML = pool.slice(0, 300).map(q => {
        const sel = _pk.sel.has(q.id) ? ' sel' : '';
        const meta = _esc(String(q.chapter || 'Uncategorized')) + ' · ' + (stDot[q.status] || '⚪') + ' ' + _esc(q.status || 'unsolved') + ' · ' + TIER_GLYPH[TIER_OF(q.qElo)].split(' ')[0] + ' T' + _esc(getEloTierShort(q.qElo));
        const title = (q.extractedText || '(image question)').slice(0, 140);
        return '<div class="mk-pk-row' + sel + '" data-qid="' + q.id + '" onclick="window.mockPickToggle(\'' + q.id + '\', this)" role="button">' +
            '<span class="mk-pk-tick">✓</span>' +
            '<span class="mk-pk-main"><span class="mk-pk-meta">' + meta + '</span>' +
            '<span class="mk-pk-title">' + _esc(title) + '</span></span></div>';
    }).join('');
}

function getEloTierShort(qElo) {
    const e = _num(qElo, 1200);
    if (e >= 2300) return '7';
    if (e >= 2000) return '6';
    if (e >= 1700) return '5';
    if (e >= 1500) return '4';
    if (e >= 1300) return '3';
    if (e >= 1100) return '2';
    return '1';
}

// ── Key pass + finalize ──
win.mockGoKeys = function () {
    const m = getMock(_studioMode.mockId); if (!m) return;
    if (!totalQuestions(m)) { _toast('Add questions first.'); return; }
    _studioMode = { view: 'keys', mockId: m.id };
    renderMocksView();
};

function renderKeyPass(root) {
    const m = getMock(_studioMode.mockId);
    if (!m) { _studioMode = { view: 'home' }; renderHome(root); return; }
    const total = totalQuestions(m);
    if (!total) {
        root.innerHTML = '<div class="mk-head"><button class="btn btn-secondary btn-sm" onclick="window.mockOpenBuilder(\'' + m.id + '\')" type="button">← Builder</button>' +
            '<h2 class="box-title">Answer-key pass</h2></div>' +
            '<div class="mk-empty">No questions in this paper yet — add some in the builder first.</div>';
        return;
    }
    let n = 0;
    const secHtml = SUBJECTS.map(s => {
        const sec = m.sections[s];
        return sec.questionIds.map(qid => {
            n++;
            const q = qById(qid);
            const pattern = q ? getPatternForQuestion(q) : 'numeric';
            const cur = sec.keys[qid];
            const shown = Array.isArray(cur) ? cur.join('') : (cur != null ? String(cur) : '');
            return '<tr><td>' + n + '</td><td>' + s + '</td><td>' + pattern + '</td>' +
                '<td><input class="mk-key-in" data-mock="' + m.id + '" data-subj="' + s + '" data-qid="' + qid + '" data-pattern="' + pattern + '" value="' + _esc(shown) + '" onchange="window.mockKeyChange(this)" placeholder="' + (pattern === 'numeric' ? 'e.g. 42' : 'e.g. A / AC') + '"></td>' +
                '<td>' + (hasKey(cur) ? '✅' : '⬜') + '</td></tr>';
        }).join('');
    }).join('');
    const isBuilding = m.status === 'building';
    const ready = canFinalize(m);
    root.innerHTML = '<div class="mk-head"><button class="btn btn-secondary btn-sm" onclick="window.mockOpenBuilder(\'' + m.id + '\')" type="button">← Builder</button>' +
        '<h2 class="box-title">Answer-key pass</h2></div>' +
        '<div class="mk-note">Keys prefilled where your dump knew the answer. This paper is scored against <b>these keys</b> — the bank\'s stored answers are only a fallback.</div>' +
        '<div class="mk-bulk"><b style="font-size:12px;">📋 Bulk paste</b>' +
        '<textarea id="mk-bulk" rows="3" placeholder="1 A&#10;2) 42&#10;3 AC"></textarea>' +
        '<div class="mk-bulk-row"><button class="btn btn-secondary btn-sm" onclick="window.mockBulkApply()" type="button">Apply keys</button>' +
        '<span class="mk-keynote">One line per question: row number + answer ("1 A", "2) AC", "3: 42").</span></div></div>' +
        '<table class="mk-key-table"><thead><tr><th>#</th><th>Subj</th><th>Type</th><th>Correct answer</th><th></th></tr></thead><tbody>' + secHtml + '</tbody></table>' +
        '<div style="text-align:center; margin:16px 0 30px;">' +
        (isBuilding
            ? '<button class="btn btn-primary" ' + (ready ? '' : 'disabled style="opacity:.45; cursor:not-allowed;" ') + 'onclick="window.mockDoFinalize()" type="button">🔒 Finalize paper (' + (ready ? 'all keys set' : 'missing keys') + ')</button>'
            : '<span class="mk-keynote">Edits are saved — ' + (m.status === 'done' ? 'the scorecard recomputes next time you open it.' : 'the paper starts against these keys.') + '</span>') +
        '</div>';
}

win.mockKeyChange = function (inp) {
    const m = getMock(inp.getAttribute('data-mock')); if (!m) return;
    const s = inp.getAttribute('data-subj'); const qid = inp.getAttribute('data-qid');
    const pattern = inp.getAttribute('data-pattern');
    const norm = normalizeAnswerInput(inp.value, pattern);
    m.sections[s].keys[qid] = norm;
    if (m.status === 'done') m.scorecardStale = true;
    persist();
    inp.closest('tr').children[4].textContent = hasKey(norm) ? '✅' : '⬜';
};

win.mockBulkApply = function () {
    const m = getMock(_studioMode.mockId); if (!m) return;
    const ta = document.getElementById('mk-bulk');
    if (!ta) return;
    const parsed = parseBulkKey(ta.value);
    const nums = Object.keys(parsed);
    if (!nums.length) { _toast('Nothing parsed — use lines like "1 A" or "3: 42".'); return; }
    // Global row numbering must match the table: subjects in order, paper order within each.
    const map = {};
    let n = 0;
    for (const s of SUBJECTS) {
        for (const qid of m.sections[s].questionIds) { n++; map[n] = { s, qid }; }
    }
    let applied = 0;
    for (const num of nums) {
        const t = map[parseInt(num, 10)];
        if (!t) continue;
        const q = qById(t.qid);
        const pattern = q ? getPatternForQuestion(q) : 'numeric';
        const norm = normalizeAnswerInput(parsed[num], pattern);
        if (hasKey(norm)) { m.sections[t.s].keys[t.qid] = norm; applied++; }
    }
    if (m.status === 'done') m.scorecardStale = true;
    persist();
    renderMocksView();
    _toast(applied + ' of ' + nums.length + ' keys applied.');
};

win.mockDoFinalize = function () {
    const id = _studioMode.mockId;
    if (finalizeMock(id)) {
        _studioMode = { view: 'home' };
        renderMocksView();
        _toast('Paper finalized — ready to start.');
    } else _toast('Some questions are still missing valid key entries.');
};

// ── Weak points & analysis ──
// Chapter selection + the Smart Mistake Report engine, embedded in the
// studio, plus the mock-loss map (AppState.mockFocus — chapter::pattern loss
// mass accumulated by every submitted mock, previously write-only data).
win.mockWeakPoints = function () {
    _studioMode = { view: 'analysis' };
    renderMocksView();
};

function renderAnalysis(root) {
    const focusEntries = Object.entries(AppState.mockFocus || {})
        .map(([key, count]) => {
            const i = key.lastIndexOf('::');
            return { chapter: key.slice(0, i) || key, pattern: key.slice(i + 2) || '?', count: _num(count, 0) };
        })
        .filter(e => e.count > 0)
        .sort((a, b) => b.count - a.count);
    const maxCount = focusEntries.length ? focusEntries[0].count : 1;
    const lossMapHtml = focusEntries.length
        ? '<div class="mk-losslist">' + focusEntries.slice(0, 10).map(e => {
            const pct = Math.max(6, Math.round((e.count / maxCount) * 100));
            return '<div class="mk-lossrow"><span class="mk-loss-ch">' + _esc(e.chapter) + '</span>' +
                '<span class="mk-loss-pat">' + _esc(e.pattern.toUpperCase()) + '</span>' +
                '<span class="mk-loss-bar"><i style="width:' + pct + '%"></i></span>' +
                '<span class="mk-loss-n">' + e.count + ' ✗</span></div>';
        }).join('') + '</div>'
        : '<div class="mk-empty" style="padding:18px 14px;">No mock losses recorded yet — submit a paper and every wrong answer lands here by chapter × question type.</div>';

    root.innerHTML = '<div class="mk-head"><button class="btn btn-secondary btn-sm" onclick="window.mockBackHome()" type="button">← Papers</button>' +
        '<h2 class="box-title">🔍 Weak points & analysis</h2></div>' +
        '<div class="mk-wp-section"><div class="rp-h">📉 What your mocks cost you</div>' +
        '<div class="mk-note" style="margin-top:2px;">Loss mass by chapter × question type, accumulated from every submitted paper.</div>' +
        lossMapHtml + '</div>' +
        '<div class="mk-wp-section"><div class="rp-h">🧠 Chapter scope & mistake analysis</div>' +
        '<div id="mk-wp-mount" class="mk-wp-mount"></div>' +
        '<div style="text-align:center; margin-top:12px;"><button class="btn btn-primary" onclick="window.mockBuildFromWeakPoints()" type="button">🎯 Build targeted paper from selected chapters</button></div></div>';

    const mount = document.getElementById('mk-wp-mount');
    if (mount && typeof win.renderWeakPointsPanel === 'function') {
        try { win.renderWeakPointsPanel(mount); } catch (e) { console.error('[mock] weak-points panel failed:', e); }
    } else if (mount) {
        mount.innerHTML = '<div class="mk-note">Analysis engine unavailable.</div>';
    }
}

win.mockBuildFromWeakPoints = function () {
    const mount = document.getElementById('mk-wp-mount');
    const scope = (typeof win.getWeakPointsScope === 'function') ? win.getWeakPointsScope(mount) : null;
    if (!scope || !scope.length) { _toast('Tick at least one chapter first.'); return; }
    ensureState();
    const byChapter = new Set(scope.map(s => String(s.chapter).toLowerCase()));
    const bySubject = {};
    scope.forEach(s => { (bySubject[s.subject] = bySubject[s.subject] || new Set()).add(String(s.chapter).toLowerCase()); });
    const m = {
        id: newId('mock'), name: 'Weak-points drill · ' + new Date().toLocaleDateString(),
        kind: 'real', tier: 'standard', status: 'building', createdAt: Date.now(),
        sections: emptySections(), run: null, scorecard: null,
    };
    let total = 0;
    const spread = { easy: 0, medium: 0, hard: 0 };
    for (const s of SUBJECTS) {
        const chapters = bySubject[s];
        if (!chapters) continue;
        const pool = eligiblePool(s).filter(q => chapters.has(String(q.chapter || '').toLowerCase()));
        const picked = sampleByMix(pool, 8, DIFF_MIX_PRESETS.balanced);
        for (const q of picked) {
            m.sections[s].questionIds.push(q.id);
            q.reservedForMock = m.id; q.mockSource = m.id;
            const k = prefillKeyFor(q);
            if (k) m.sections[s].keys[q.id] = k;
        }
        const tc = tierCountsOf(picked);
        for (const t of TIERS) spread[t] += tc[t];
        total += picked.length;
    }
    if (!total) { _toast('No unreserved questions in the selected chapters yet.'); return; }
    AppState.mocks.push(m);
    persist();
    _studioMode = { view: 'keys', mockId: m.id };
    renderMocksView();
    _toast('Drafted ' + total + ' targeted questions from ' + byChapter.size + ' chapter(s) — ' + spread.easy + ' easy · ' + spread.medium + ' medium · ' + spread.hard + ' hard. Check keys, then finalize.');
};

// ── Boot + external bridge ──
function bootMockUI() {
    const target = document.getElementById('view-mocks');
    if (target) {
        const mo = new MutationObserver(() => {
            if (target.classList.contains('active')) {
                renderMocksView();
            } else if (AppState.mockDraftContext) {
                // Leaving Mocks with a dump-link context active would funnel
                // every future practice dump into the draft — tear it down.
                AppState.mockDraftContext = null;
                _syncMockLinkBanner();
                persist();
            }
        });
        mo.observe(target, { attributes: true, attributeFilter: ['class'] });
    }
    // Refresh the review screen after the Vault reason modal closes, so the
    // "Log to Vault" row flips to "Already in the Vault" immediately.
    const erm = document.getElementById('error-reason-modal');
    if (erm) {
        const eo = new MutationObserver(() => {
            if (!erm.classList.contains('active') && _resultsMockId) {
                const m = getMock(_resultsMockId);
                if (m && m.status === 'done' && document.querySelector('.mock-runner')) showResults(m);
            }
        });
        eo.observe(erm, { attributes: true, attributeFilter: ['class'] });
    }
}

if (typeof document !== 'undefined' && document.getElementById('view-mocks')) {
    bootMockUI();
    win.MockEngine = { linkQuestion, computeMockScorecard, gradeAnswer, normalizeAnswerInput, parseBulkKey };
} else if (typeof document !== 'undefined') {
    // DOM present but view not yet parsed (module import order) — retry once DOM settles.
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('view-mocks')) { bootMockUI(); win.MockEngine = { linkQuestion, computeMockScorecard, gradeAnswer, normalizeAnswerInput, parseBulkKey }; }
    });
}

// Default export surface for app.js Save-All hook (works even pre-boot).
const MockEngine = { linkQuestion, computeMockScorecard, gradeAnswer, normalizeAnswerInput, parseBulkKey };
export default MockEngine;
