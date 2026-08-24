/**
 * mock.js — Mock Mode v1: staged paper builder + exam runner + scorer.
 *
 * Two layers:
 *   PURE (exported, Node-testable): answer normalization, grading under real
 *   JEE marking schemes, scorecard computation, predicted-score model.
 *   UI (browser-only, guarded): Studio (draft list / builder / key pass),
 *   full-screen exam runner with palette + paper clock, results screen.
 *
 * Design contracts:
 *   • Questions live in the normal bank; a mock references ids and stamps
 *     q.mockSource / q.reservedForMock while its draft is unfinished.
 *   • NO Elo movement from mocks — marks + readiness data only.
 *   • Runner persists into the mock object continuously (refresh-safe); the
 *     clock is deadline-based (endsAt), so reload resumes honestly.
 *
 * Ingestion linkage: while AppState.mockDraftContext = {mockId, subject} is
 * set, app.js's Save-All hook calls linkQuestion() for every committed
 * question — that's how Gem dumps land inside a draft section.
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

// ════════════════════════════════════════════════════════════════════════════
// PURE SCORING CORE — no DOM, no AppState. Exported for smoke tests.
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

/**
 * Grade one answer under its JEE scheme.
 * @returns {{attempted:boolean, correct:boolean, marks:number, schemeId:string}}
 */
export function gradeAnswer(q, value) {
    const pattern = getPatternForQuestion(q);
    const schemeId = getSchemeIdForQuestion(q);
    const norm = normalizeAnswerInput(value, pattern);
    const attempted = Array.isArray(norm) ? norm.length > 0 : String(norm).length > 0;
    if (!attempted) return { attempted: false, correct: false, marks: 0, schemeId };

    if (pattern === 'single') {
        const ca = normalizeAnswerInput(q.correctAnswer, 'single');
        const correct = ca.length > 0 && norm[0] === ca[0];
        return { attempted: true, correct, marks: correct ? MARKS_SCHEMES['adv-single'].correct : MARKS_SCHEMES['adv-single'].wrong, schemeId };
    }
    if (pattern === 'numeric') {
        const u = parseFloat(norm); const c = parseFloat(q.correctAnswer);
        const correct = isFinite(u) && isFinite(c) && Math.abs(u - c) < 1e-6;
        return { attempted: true, correct, marks: correct ? MARKS_SCHEMES['adv-numeric'].correct : MARKS_SCHEMES['adv-numeric'].wrong, schemeId };
    }
    // multi — JEE Advanced style: exact ⇒ +full · any wrong selection ⇒ penalty ·
    // otherwise +partialPerCorrect per correctly chosen option.
    const ca = normalizeAnswerInput(q.correctAnswer, 'multi');
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
        const row = { subject: subj, marks: 0, max: 0, correct: 0, wrong: 0, skipped: 0 };
        for (const qid of sec.questionIds) {
            const q = qById[qid];
            if (!q) continue;
            row.max += 4;
            maxTotal += 4;
            const g = gradeAnswer(q, answers[qid] && answers[qid].value);
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

/** Called by app.js Save-All hook while a draft section is open for filling. */
function linkQuestion(ctx, newQ) {
    const m = getMock(ctx.mockId);
    if (!m || m.status !== 'building') return;
    const sec = m.sections[ctx.subject];
    if (!sec || !newQ || !newQ.id) return;
    if (sec.questionIds.includes(newQ.id)) return;
    newQ.mockSource = m.id;
    newQ.reservedForMock = m.id;
    sec.questionIds.push(newQ.id);
    persist();
}

function unlinkQuestion(mockId, qid) {
    const m = getMock(mockId); if (!m) return;
    for (const s of SUBJECTS) {
        const sec = m.sections[s];
        const i = sec.questionIds.indexOf(qid);
        if (i >= 0) {
            sec.questionIds.splice(i, 1); delete sec.keys[qid];
            const q = AppState.questionBank.find(x => String(x.id) === String(qid));
            if (q) { delete q.reservedForMock; delete q.mockSource; }
        }
    }
    persist();
}

function allQuestionIds(m) { return SUBJECTS.flatMap(s => m.sections[s].questionIds); }
function sectionComplete(m, s) { return m.sections[s].questionIds.every(qid => m.sections[s].keys[qid] != null && m.sections[s].keys[qid] !== ''); }

function finalizeMock(id) {
    const m = getMock(id); if (!m || m.status !== 'building') return false;
    for (const s of SUBJECTS) if (!sectionComplete(m, s)) return false;
    m.status = 'ready';
    for (const qid of allQuestionIds(m)) {
        const q = AppState.questionBank.find(x => String(x.id) === String(qid));
        if (q) delete q.reservedForMock; // finalized paper owns them now
    }
    persist();
    return true;
}

function deleteMock(id) {
    const m = getMock(id); if (!m) return;
    for (const qid of allQuestionIds(m)) {
        const q = AppState.questionBank.find(x => String(x.id) === String(qid));
        if (q) { delete q.reservedForMock; delete q.mockSource; }
    }
    AppState.mocks = AppState.mocks.filter(x => x.id !== id);
    persist();
}

// ════════════════════════════════════════════════════════════════════════════
// RUNNER
// ════════════════════════════════════════════════════════════════════════════

let _runTick = null;
let _curQid = null;

function startMock(id) {
    const m = getMock(id); if (!m) return;
    const qids = allQuestionIds(m);
    // Validate bank presence; drop missing with warning.
    const valid = qids.filter(qid => AppState.questionBank.some(x => String(x.id) === String(qid)));
    if (valid.length !== qids.length) {
        alert((qids.length - valid.length) + ' question(s) were deleted from the bank — dropped from this paper.');
        for (const s of SUBJECTS) m.sections[s].questionIds = m.sections[s].questionIds.filter(q => valid.includes(q));
    }
    if (m.status === 'building') { if (!finalizeMock(id)) { alert('Every question needs an answer-key entry before starting.'); return; } }
    if (m.status === 'done') { showResults(m); return; }
    if (!m.run || m.run.expired) {
        const minutes = Math.max(10, Math.min(240, Math.round(valid.reduce((sum, qid) => {
            const q = AppState.questionBank.find(x => String(x.id) === String(qid));
            return sum + _num(q && q.targetTimeMins, 3);
        }, 0) * 0.75))); // papers reward speed: budget ≈ 75% of summed band targets
        m.run = { startedAt: Date.now(), endsAt: Date.now() + minutes * 60000, order: shuffle(valid.slice()), answers: {}, marked: [], cur: 0, events: {} };
        m.status = 'in-progress';
    }
    persist();
    openRunner(m);
}

function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

let _activeMockId = null;

function openRunner(m) {
    _activeMockId = m.id;
    document.querySelectorAll('.mock-runner').forEach(o => o.remove());
    const ov = document.createElement('div');
    ov.className = 'mock-runner';
    ov.innerHTML = '<div class="mr-shell"><div class="mr-topbar">' +
        '<span class="mr-name">📝 ' + _esc(m.name) + '</span>' +
        '<span class="mr-clock" id="mr-clock">--:--</span>' +
        '<button class="mr-palette-btn" onclick="window.mrTogglePalette()" type="button">☰</button>' +
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
}

function mrActive() { const m = getMock(_activeMockId); return (m && m.status === 'in-progress') ? m : null; }

function mrTick() {
    const m = mrActive(); if (!m) return;
    const remainMs = m.run.endsAt - Date.now();
    const fill = document.getElementById('mr-clockfill');
    const clock = document.getElementById('mr-clock');
    if (!clock) return;
    if (remainMs <= 0) { clock.textContent = 'TIME UP'; if (fill) fill.style.width = '0%'; mrDoSubmit(true); return; }
    const mm = Math.floor(remainMs / 60000), ss = Math.floor((remainMs % 60000) / 1000);
    clock.textContent = String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    const totalSpan = m.run.endsAt - m.run.startedAt;
    const frac = Math.max(0, Math.min(100, (remainMs / totalSpan) * 100));
    if (fill) {
        fill.style.width = frac + '%';
        fill.className = frac < 5 ? 'crit' : (frac < 20 ? 'warn' : '');
    }
}

function qPatternOf(qid) {
    const q = AppState.questionBank.find(x => String(x.id) === String(qid));
    return q ? getPatternForQuestion(q) : 'numeric';
}

function renderMrQuestion() {
    const m = mrActive(); if (!m) return;
    const qid = m.run.order[m.run.cur];
    _curQid = qid;
    const q = AppState.questionBank.find(x => String(x.id) === String(qid));
    const area = document.getElementById('mr-qarea');
    if (!q) { area.innerHTML = '<p>Missing question.</p>'; return; }
    if (!m.run.events[qid]) m.run.events[qid] = [];
    m.run.events[qid].push({ t: 'seen', at: Date.now() });
    const ans = m.run.answers[qid] || {};
    const pattern = getPatternForQuestion(q);
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
            return '<div class="mr-opt' + (sel.includes(L) ? ' sel' : '') + '" data-letter="' + L + '" onclick="window.mrPick(this)\" role="button">' +
                '<b>' + L + '</b> ' + _esc(o) + '</div>';
        }).join('') + '</div>' + (isMulti ? '<div class="mr-multihint">Multiple options may be correct</div>' : '');
    }
    const conf = ans.confidence || null;
    area.innerHTML =
        '<div class="mr-qhead"><span class="mr-qnum">Q' + (m.run.cur + 1) + ' / ' + m.run.order.length + '</span>' +
        '<span class="mr-pattern">' + pattern.toUpperCase() + '</span>' +
        '<span class="mr-conf">' + ['sure', 'likely', 'guess'].map(c =>
            '<button class="mr-confbtn' + (conf === c ? ' sel' : '') + '\" data-c=\"' + c + '\" onclick=\"window.mrConf(\'' + c + '\')\">' + c[0].toUpperCase() + '</button>').join('') +
        '</span></div>' + body +
        '<div class=\"mr-lockednote\" style=\"display:none\"></div>';
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
};

win.mrTogglePalette = function () {
    const p = document.getElementById('mr-palette');
    if (p) p.classList.toggle('open');
};

function renderMrPalette() {
    const m = mrActive(); if (!m) return;
    const p = document.getElementById('mr-palette'); if (!p) return;
    p.innerHTML = '<div class=\"mr-pal-title\">Questions</div>' + m.run.order.map((qid, i) => {
        const a = m.run.answers[qid];
        const cls = a && ((Array.isArray(a.value) && a.value.length) || (!Array.isArray(a.value) && a.value)) ? 'ans' : 'un';
        const mk = m.run.marked.includes(qid) ? ' mk' : '';
        const cur = i === m.run.cur ? ' cur' : '';
        return '<button class=\"mr-pal-cell ' + cls + mk + cur + '\" onclick=\"window.mrGoto(' + i + ')\" type=\"button\">' + (i + 1) + '</button>';
    }).join('');
};

win.mrAskSubmit = function () {
    const m = mrActive(); if (!m) return;
    const unanswered = m.run.order.filter(q => { const a = m.run.answers[q]; return !a || !a.value || (Array.isArray(a.value) && !a.value.length); }).length;
    const box = document.getElementById('mr-confirm');
    box.style.display = 'block';
    box.innerHTML = '<div class=\"mr-confirm-card\"><h3>Submit paper?</h3>' +
        '<p>' + unanswered + ' unanswered · ' + m.run.marked.length + ' marked</p>' +
        '<p class=\"mr-warn\">Clock keeps running until you confirm.</p>' +
        '<button class=\"mr-navbtn mr-submit\" onclick=\"window.mrDoSubmit()\" type=\"button\">Confirm submit</button>' +
        '<button class=\"mr-navbtn\" onclick=\"document.getElementById(\'mr-confirm\').style.display=\'none\'\" type=\"button\">Keep solving</button></div>';
};

win.mrDoSubmit = function (auto) {
    const m = mrActive(); if (!m) return;
    if (_runTick) { clearInterval(_runTick); _runTick = null; }
    m.run.expired = !!auto;
    m.finishedAt = Date.now();
    m.scorecard = computeMockScorecard(m, qByIdMap());
    m.status = 'done';
    // Feed the self-correcting loop: chapter::pattern loss mass.
    try { accumulateMockFocus(m); } catch (_) {}
    persist();
    showResults(m);
};

function qByIdMap() {
    const map = {};
    for (const q of AppState.questionBank) map[String(q.id)] = q;
    return map;
}

function accumulateMockFocus(m) {
    ensureState();
    const sc = m.scorecard; if (!sc) return;
    for (const qid of sc.wrongIds) {
        const q = qByIdMap()[String(qid)]; if (!q) continue;
        const key = String(q.chapter || 'Uncategorized').toLowerCase() + '::' + getPatternForQuestion(q);
        AppState.mockFocus[key] = (AppState.mockFocus[key] || 0) + 1;
    }
}

// ── Results screen ──
function showResults(m) {
    closeRunnerChrome();
    const qMap = qByIdMap();
    const sc = m.scorecard || computeMockScorecard(m, qMap);
    const rows = sc.sections.map(r =>
        '<tr><td>' + SUBJECT_GLYPH[r.subject] + '</td><td>' + r.marks + ' / ' + r.max + '</td><td>' + (r.attempted || 0) + '</td><td>' + r.correct + '</td><td>' + r.wrong + '</td><td>' + r.skipped + '</td></tr>').join('');
    const brierLine = sc.brier != null
        ? '<div class=\"mr-res-line\">Calibration Brier: <b>' + sc.brier.toFixed(3) + '</b> over ' + sc.brierN + ' confidence-tagged answers (lower = honest)</div>'
        : '';
    // ── Post-mock autopsy: which tags × difficulty bands produced the losses.
    // Fresh on submit, then cached on the mock so reopening this scorecard
    // later shows the same breakdown even as the bank evolves underneath.
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
        ? '<div class=\"mr-autopsy\"><div class=\"rp-h\">🔍 Mistake autopsy — what actually cost you</div>' +
          '<table class=\"mr-table\"><tr><th>Topic</th><th>✗</th></tr>' +
          autopsy.byTag.slice(0, 6).map(t => '<tr><td>' + _esc(t.tag) + '</td><td class=\"rp-bad\">' + t.count + '</td></tr>').join('') +
          '</table><div style=\"margin-top:8px;\">' +
          autopsy.byBand.map(b => '<span class=\"rp-chip\" title=\"' + _esc(b.label) + '\">' + _esc(b.label.split('·')[0].trim()) + ' ×' + b.count + '</span>').join(' ') +
          '</div><button class=\"mr-navbtn\" style=\"margin-top:10px;\" onclick=\"window.mockCopyAutopsy()\" type=\"button\">📋 Copy autopsy</button></div>'
        : '';
    const ov = document.createElement('div');
    ov.className = 'mock-runner';
    ov.innerHTML = '<div class=\"mr-shell results\"><h2>📊 ' + _esc(m.name) + ' — Scorecard</h2>' +
        '<div class=\"mr-total\">' + sc.total + ' <span>/ ' + sc.max + '</span></div>' +
        '<div class=\"mr-res-line\">Predicted from your ratings: ~' + sc.predicted + '</div>' + brierLine +
        '<table class=\"mr-table\"><tr><th></th><th>Marks</th><th>Att</th><th>✓</th><th>✗</th><th>Skip</th></tr>' + rows + '</table>' +
        (sc.wrongIds.length ? '<div class=\"mr-res-line\">❌ ' + sc.wrongIds.length + ' to review — they are waiting in <b>The Vault</b> for friction tagging.</div>' : '<div class=\"mr-res-line\">Clean paper. 😤</div>') +
        autopsyHtml +
        '<div style=\"margin-top:14px; display:flex; gap:8px; justify-content:center;\">' +
        '<button class=\"mr-navbtn\" onclick=\"window.mockCloseResults()\" type=\"button\">Back to Studio</button></div></div>';
    document.body.appendChild(ov);
    persist();
};

/** Clipboard copy of the last rendered autopsy text (with legacy fallback). */
win.mockCopyAutopsy = function () {
    const txt = win._lastAutopsyText || '';
    if (!txt) return;
    // Non-blocking confirmation instead of a native dialog [AUDIT P2].
    const done = () => (window.__jmaxAppToast || alert)('Autopsy copied — paste it anywhere.');
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
        (window.__jmaxAppToast || alert)('Autopsy copied — paste it anywhere.');
    } catch (_) {
        (window.__jmaxAppToast || alert)('Copy failed. Autopsy text:\n\n' + txt);
    }
}

win.mockCloseResults = function () {
    document.querySelectorAll('.mock-runner').forEach(o => o.remove());
    document.body.classList.remove('mock-running');
    renderMocksView();
};

function closeRunnerChrome() {
    if (_runTick) { clearInterval(_runTick); _runTick = null; }
    document.body.classList.remove('mock-running');
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
    if (_studioMode.view === 'builder') renderBuilder(root);
    else if (_studioMode.view === 'keys') renderKeyPass(root);
    else renderHome(root);
}

function renderHome(root) {
    const drafts = AppState.mocks.slice().reverse();
    root.innerHTML =
        '<div class=\"mk-head\"><div><span class=\"kicker\">// EXAM SIMULATION</span><h2 class=\"box-title\">Mock Tests</h2>' +
        '<p class=\"box-desc\">Real papers, real clocks, real marking. No feedback until you submit.</p></div>' +
        '<div class=\"mk-create\"><input id=\"mk-name\" class=\"pomo-input\" placeholder=\"Paper name (e.g., Allen Major 7)\"><button class=\"btn btn-primary\" onclick=\"window.mockCreate()\" type=\"button\">+ New Mock</button></div></div>' +
        '<div id=\"mk-list\"></div>';
    const list = document.getElementById('mk-list');
    if (!drafts.length) {
        list.innerHTML = '<div class=\"mk-empty\">No papers yet. Create one, then feed each subject via your AI dump — questions auto-link into the open panel while it is active.</div>';
        return;
    }
    list.innerHTML = drafts.map(m => {
        const counts = SUBJECTS.map(s => SUBJECT_GLYPH[s].split(' ')[0] + ' ' + m.sections[s].questionIds.length).join(' · ');
        const stLabel = { building: '🔨 Building', ready: '🟢 Ready', 'in-progress': '⏳ In progress', done: '✅ Done' }[m.status] || m.status;
        const actions = m.status === 'building'
            ? '<button class=\"btn btn-primary btn-sm\" onclick=\"window.mockOpenBuilder(\'' + m.id + '\')\" type=\"button\">Continue building</button>'
            : (m.status === 'ready'
                ? '<button class=\"btn btn-primary btn-sm\" onclick=\"window.mockStart(\'' + m.id + '\')\" type=\"button\">▶ Start paper</button>'
                : (m.status === 'in-progress'
                    ? '<button class=\"btn btn-primary btn-sm\" onclick=\"window.mockStart(\'' + m.id + '\')\" type=\"button\">⏳ Resume</button>'
                    : '<button class=\"btn btn-secondary btn-sm\" onclick=\"window.mockStart(\'' + m.id + '\')\" type=\"button\">📊 Scorecard</button>')) +
              ' <button class=\"btn btn-danger btn-sm\" onclick=\"window.mockDelete(\'' + m.id + '\')\" type=\"button\">🗑</button>';
        return '<div class=\"mk-card\"><div class=\"mk-card-main\"><b>' + _esc(m.name) + '</b>' +
            '<span class=\"mk-status\">' + stLabel + '</span><span class=\"mk-counts\">' + counts + '</span></div>' +
            '<div class=\"mk-card-actions\">' + actions + '</div></div>';
    }).join('');
}

win.mockCreate = function () {
    const inp = document.getElementById('mk-name');
    const name = (inp && inp.value.trim()) || ('Mock ' + new Date().toLocaleDateString());
    ensureState();
    const m = { id: newId('mock'), name, kind: 'real', tier: 'standard', status: 'building', createdAt: Date.now(), sections: emptySections(), run: null, scorecard: null };
    AppState.mocks.push(m);
    persist();
    _studioMode = { view: 'builder', mockId: m.id };
    renderMocksView();
};

win.mockOpenBuilder = function (id) { _studioMode = { view: 'builder', mockId: id }; renderMocksView(); };
win.mockDelete = function (id) { if (confirm('Delete this mock? Linked questions stay in your bank.')) { deleteMock(id); renderMocksView(); } };
win.mockStart = function (id) { startMock(id); };

function renderBuilder(root) {
    const m = getMock(_studioMode.mockId);
    if (!m) { _studioMode = { view: 'home' }; renderHome(root); return; }
    root.innerHTML = '<div class=\"mk-head\"><button class=\"btn btn-secondary btn-sm\" onclick=\"window.mockBackHome()\" type=\"button\">← Papers</button>' +
        '<h2 class=\"box-title\">' + _esc(m.name) + '</h2></div>' +
        '<div class=\"mk-note\">While a subject panel below is <b>active</b>, every AI-dump you paste commits straight into it. Set the right chapter context before dumping, review crops like usual.</div>' +
        '<div class=\"mk-subjects\"></div>' +
        (SUBJECTS.every(s => sectionComplete(m, s))
            ? '<div style=\"text-align:center; margin-top:14px;\"><button class=\"btn btn-primary\" onclick=\"window.mockGoKeys()\" type=\"button\">🔑 Answer-key pass → Finalize</button></div>'
            : '<div class=\"mk-note\" style=\"text-align:center; opacity:.7;\">Fill every subject, then complete the answer-key pass to finalize.</div>');
    const wrap = root.querySelector('.mk-subjects');
    wrap.innerHTML = SUBJECTS.map(s => {
        const active = AppState.mockDraftContext && AppState.mockDraftContext.mockId === m.id && AppState.mockDraftContext.subject === s;
        const ids = m.sections[s].questionIds;
        const rows = ids.map((qid, i) => {
            const q = AppState.questionBank.find(x => String(x.id) === String(qid));
            const title = q ? (q.extractedText || '(image question)').slice(0, 70) : '(deleted)';
            return '<div class=\"mk-qrow\"><span class=\"mk-qnum\">' + (i + 1) + '</span><span class=\"mk-qtitle\">' + _esc(title) + '</span>' +
                '<button class=\"mk-qdel\" onclick=\"window.mockUnlink(\'' + m.id + '\',\'' + qid + '\')\" type=\"button\">✕</button></div>';
        }).join('');
        return '<div class=\"mk-subj-panel' + (active ? ' active' : '') + '\">' +
            '<div class=\"mk-subj-head\"><b>' + SUBJECT_GLYPH[s] + '</b><span>' + ids.length + ' Q</span></div>' +
            '<div class=\"mk-subj-body\">' + (rows || '<div class=\"mk-none\">Empty — paste your dump below.</div>') + '</div>' +
            '<button class=\"btn ' + (active ? 'btn-danger' : 'btn-primary') + ' btn-sm\" style=\"width:100%; margin-top:8px;\" onclick=\"window.mockToggleIngest(\'' + m.id + '\',\'' + s + '\')\" type=\"button\">' +
            (active ? '⏹ Stop linking dumps here' : '🧠 Link AI dumps to this panel') + '</button></div>';
    }).join('');
}

win.mockBackHome = function () {
    AppState.mockDraftContext = null;
    _studioMode = { view: 'home' };
    persist(); renderMocksView();
};

win.mockToggleIngest = function (mockId, subject) {
    const cur = AppState.mockDraftContext;
    if (cur && cur.mockId === mockId && cur.subject === subject) {
        AppState.mockDraftContext = null;
        persist(); renderMocksView();
        return;
    }
    AppState.mockDraftContext = { mockId, subject };
    AppState.currentSubject = subject;   // placement parity with normal dumps
    persist();
    renderMocksView();
    if (typeof win.populateAiDumpChapters === 'function') win.populateAiDumpChapters();
    if (typeof win.openModal === 'function') win.openModal('ai-dump-modal');
    else alert('Linking active — open your AI dump modal and paste. Every saved question lands in ' + SUBJECT_GLYPH[subject] + '.');
};

win.mockUnlink = function (mockId, qid) { unlinkQuestion(mockId, qid); renderMocksView(); };

// ── Key pass + finalize ──
win.mockGoKeys = function () {
    const m = getMock(_studioMode.mockId); if (!m) return;
    _studioMode = { view: 'keys', mockId: m.id };
    renderMocksView();
};

function renderKeyPass(root) {
    const m = getMock(_studioMode.mockId);
    if (!m) { _studioMode = { view: 'home' }; renderHome(root); return; }
    let n = 0;
    const secHtml = SUBJECTS.map(s => {
        const sec = m.sections[s];
        const rows = sec.questionIds.map(qid => {
            n++;
            const q = AppState.questionBank.find(x => String(x.id) === String(qid));
            const pattern = q ? getPatternForQuestion(q) : 'numeric';
            const cur = sec.keys[qid];
            const shown = Array.isArray(cur) ? cur.join('') : (cur != null ? String(cur) : '');
            return '<tr><td>' + n + '</td><td>' + s + '</td><td>' + pattern + '</td>' +
                '<td><input class=\"mk-key-in\" data-mock=\"' + m.id + '\" data-subj=\"' + s + '\" data-qid=\"' + qid + '\" data-pattern=\"' + pattern + '\" value=\"' + _esc(shown) + '\" onchange=\"window.mockKeyChange(this)\" placeholder=\"' + (pattern === 'numeric' ? 'e.g. 42' : 'e.g. A / AC') + '\"></td>' +
                '<td>' + (sec.keys[qid] ? '✅' : '⬜') + '</td></tr>';
        }).join('');
        return rows;
    }).join('');
    const ready = SUBJECTS.every(s => sectionComplete(m, s));
    root.innerHTML = '<div class=\"mk-head\"><button class=\"btn btn-secondary btn-sm\" onclick=\"window.mockOpenBuilder(\'' + m.id + '\')\" type=\"button\">← Builder</button>' +
        '<h2 class=\"box-title\">Answer-key pass</h2></div>' +
        '<div class=\"mk-note\">Prefilled from your dumps where the Gem knew the answer. Fix anything wrong — the paper scores itself against these.</div>' +
        '<table class=\"mk-key-table\"><thead><tr><th>#</th><th>Subj</th><th>Type</th><th>Correct answer</th><th></th></tr></thead><tbody>' + secHtml + '</tbody></table>' +
        '<div style=\"text-align:center; margin:16px 0 30px;\"><button class=\"btn btn-primary\" ' + (ready ? '' : 'disabled style=\"opacity:.45; cursor:not-allowed;\" ') + 'onclick=\"window.mockDoFinalize()\" type=\"button\">🔒 Finalize paper (' + (ready ? 'all keys set' : 'missing keys') + ')</button></div>';
}

win.mockKeyChange = function (inp) {
    const m = getMock(inp.getAttribute('data-mock')); if (!m) return;
    const s = inp.getAttribute('data-subj'); const qid = inp.getAttribute('data-qid');
    const pattern = inp.getAttribute('data-pattern');
    m.sections[s].keys[qid] = normalizeAnswerInput(inp.value, pattern);
    persist();
    inp.closest('tr').children[4].textContent = m.sections[s].keys[qid] ? '✅' : '⬜';
};

win.mockDoFinalize = function () {
    const id = _studioMode.mockId;
    if (finalizeMock(id)) {
        _studioMode = { view: 'home' };
        renderMocksView();
    } else alert('Some questions are still missing key entries.');
};

// ── Boot + external bridge ──
function bootMockUI() {
    const obs = new MutationObserver(() => {
        const root = rootEl();
        if (root && !root.dataset.mkInit) { root.dataset.mkInit = '1'; renderMocksView(); }
    });
    const target = document.getElementById('view-mocks');
    if (target) obs.observe(target, { childList: false, attributes: true, attributeFilter: ['class'] });
    // Re-render whenever the view becomes active (switchTab toggles classes).
    if (target) {
        const mo = new MutationObserver(() => {
            if (target.classList.contains('active')) renderMocksView();
        });
        mo.observe(target, { attributes: true, attributeFilter: ['class'] });
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