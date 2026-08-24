// ==================== MATRIX MODULE ====================
// Error Matrix UI — SR-powered card rendering, filtering, practice logging.
//
// Only imports from storage.js — no cross-module circular dependencies.

import {
    AppState,
    saveAllAsync,
    changeCount,
    fetchMediaFromDrive,
    formatTime,
    waitForDriveToken,
    escapeHtml,
    // ── Daily/subjective study-time tracker (shared with Pomodoro + app.js) ──
    studySecs,
    // ── SR engine imports ──
    computeSR,
    getDueStatus,
    SR_FRICTION_TYPES,
    SR_FRICTION_LABELS,
    SR_FRICTION_WEIGHTS,
    formatSRDate,
    recordCloudTombstone,
    // Canonical subject-key mapper (physics/chemistry/maths) for counter writes.
    normSubjKey,
    // Chapter weightage for exam-aware risk sorting in the Decay Grid.
    getChapterWeight,
    resolveChapterWeightInfo,
    setChapterWeightOverride,
    // ── Shared "user is mid-activity" registry (interruption gating) ──
    SessionFocus,
} from './storage.js';

// Memory Kernel v2 — canonical pure implementation (imported directly; the
// kernel has zero dependencies so this cannot form a cycle).
import {
    chapterMemoryStats,
    currentRetrievability,
    retrievabilityAt,
    hydrateMemory,
    refineDifficultyAfterTag,
} from './memory.js';

// ---------------------------------------------------------------------------
//  Daily Core Queue state
// ---------------------------------------------------------------------------
let _dailyQueueActive = false;

const DAILY_QUEUE_LIMITS = {
    physics: 5,
    maths: 5,
    chemistry: 10,
};

// Daily-queue snapshot — the 5 physics / 5 maths / 10 chemistry question IDs
// are locked ONCE per local day. Solving a question marks it done but does NOT
// pull in a replacement; the slot stays "completed" until the next day, when a
// fresh snapshot is generated.
let _dailyQueueSnapshot = { date: null, ids: [] };

// localStorage key for the persistent daily-queue snapshot. Acts as a secondary
// fallback cache layer that survives browser refreshes, preventing cold-boot
// cache drift mid-day (i.e. the queue scrambling/cycling/re-pulling new items
// after a page reload).
const DAILY_QUEUE_LS_KEY = 'jeemax_daily_queue_snapshot';

// ---------------------------------------------------------------------------
//  Local modal helpers
// ---------------------------------------------------------------------------
function _openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.style.display = 'flex';
    requestAnimationFrame(() => { m.classList.add('active'); });
}

function _closeModalStr(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('active');
    setTimeout(() => { if (!m.classList.contains('active')) m.style.display = 'none'; }, 300);
}

// ==================== ERROR MATRIX ====================

export function openErrorMatrix(subject, element) {
    // Deactivate daily queue when switching subjects
    if (_dailyQueueActive) {
        _dailyQueueActive = false;
        const btn = document.getElementById('daily-queue-btn');
        if (btn) btn.classList.remove('active');
        const badge = document.getElementById('daily-queue-badge');
        if (badge) badge.style.display = 'none';
        document.querySelectorAll('.subject-folder').forEach(f => f.style.opacity = '1');
        const allPill = document.querySelector('.emf-pill-group[data-emf-filter="status"] .matrix-pill[data-emf-value="all"]');
        if (allPill) allPill.classList.add('active');
        const statusCarrier = document.getElementById('filter-status');
        if (statusCarrier) statusCarrier.value = 'all';
    }

    document.querySelectorAll('.subject-folder').forEach(f => f.classList.remove('active'));
    // Callers pass the clicked element explicitly (onclick="…(…, this)");
    // never fall back to the legacy window.event global (strict-mode crash).
    if (element) {
        element.classList.add('active');
    }
    AppState.currentErrorSubject = subject.toLowerCase();
    document.getElementById('error-matrix-title').textContent =
        `${subject.charAt(0).toUpperCase() + subject.slice(1)} Matrix`;
    renderErrorMatrixFromBank();
    filterErrors();
}

// Normalize subject keys. Delegates to the CANONICAL storage.js mapper so
// filtering/grouping agrees with how questions were written: the previous
// local trim+lowercase skipped alias mapping, so a question stored as
// "Mathematics" was counted as maths but filtered as "mathematics" — an
// invisible row in the Vault.
function _normSubj(s) {
    return normSubjKey(s);
}

// ── Staggered macrotask chain ──────────────────────────────────────────────
// Runs an array of layout-heavy DOM rebuild functions SEQUENTIALLY, each in
// its own macrotask, with one requestAnimationFrame yield between them.
//
// Why: renderErrorMatrixFromBank (N-card innerHTML wipe), filterErrors (forced
// layout reads via getBoundingClientRect on every card),
// renderErrorResolutionDashboard (SVG sparkline rebuild), updateUI (full HUD
// recompute), renderGraph (candlestick SVG rebuild), and renderEloMatrix (MMR
// grid SVG rebuild) are each 10-60ms of synchronous main-thread work on mobile
// WebKit. Running them all inside ONE animation frame hijacks the main thread
// for 80-200ms, which drops the drawer-close transition frames, the red/green
// flash overlay, the streak-canvas flame, and the Elo-chip injection.
//
// By yielding one rAF between tasks, the compositor gets a clean paint window
// in every gap, so the visual animations stay on the GPU while the CPU
// rebuilds churn through the structural DOM work one chunk at a time.
//
// Safe for re-entrancy: each task is self-contained; the chain never shares
// mutable state between ticks.
function _staggeredChain(tasks) {
    let i = 0;
    const next = () => {
        if (i >= tasks.length) return;
        const task = tasks[i++];
        try { task(); } catch (e) { console.error('staggered task fault:', e); }
        if (i < tasks.length) {
            // rAF → setTimeout(0): the rAF fires before the next paint (letting
            // the compositor flush any pending animation frames), then the
            // setTimeout defers the next heavy task to the following macrotask
            // so the paint actually commits before the CPU is re-hijacked.
            requestAnimationFrame(() => setTimeout(next, 0));
        }
    };
    next();
}

// ── Don't-make-me-think keyboard glue ──────────────────────────────────────
// "/" focuses the vault search from anywhere in the Errors view (no hunting
// for the input), Esc clears it / blurs. Wired once per page load; silently
// skipped in non-DOM environments (Node smoke tests).
function _emKeyHandler(e) {
    try {
        const t = e.target;
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        const errorsView = document.getElementById('view-errors');
        const viewActive = !!(errorsView && errorsView.classList.contains('active'));
        if (e.key === '/' && !typing && viewActive) {
            const search = document.getElementById('matrix-search-input');
            if (search) { e.preventDefault(); search.focus(); search.select(); }
        } else if (e.key === 'Escape' && typing && t.id === 'matrix-search-input') {
            if (t.value) { window.clearMatrixSearch(); }
            else t.blur();
        }
    } catch (_) { /* never let a hotkey crash the page */ }
}
try {
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function'
        && typeof window !== 'undefined' && !window.__emKeysWired) {
        window.__emKeysWired = true;
        document.addEventListener('keydown', _emKeyHandler);
    }
} catch (_) {}

// ── Practice Log Drawer State ──────────────────────────────────────────────

let _drawerState = {
    qId: null,
    result: null,           // 'correct' | 'incorrect'
    autonomy: 'independent', // 'independent' | 'hint_used' | 'solution_read' — honest default [AUDIT P1-7]
    frictionTypes: [],      // ['PERFECT', 'CALC', ...]
    timeSpentMins: 0,
    targetTimeMins: 5,
    stopwatchSeconds: 0,
    stopwatchInterval: null,
    eloResult: null,        // 🧠 Elo migration result captured at the decision instant
    frozenTimeMins: 0,      // ⏱ Stopwatch time frozen at the moment of truth
    resultLocked: false,    // 🔒 True once the user committed correct/incorrect
};

function _resetDrawerState() {
    if (_drawerState.stopwatchInterval) clearInterval(_drawerState.stopwatchInterval);
    _drawerState = {
        qId: null,
        result: null,           // 'correct' | 'incorrect'
        resultSource: null,     // 'auto' (graded against loaded answer) | 'self' (user-reported)
        selectedOptions: [],    // MCQ letters the user picked, e.g. ['A'] or ['A','C']
        imageHidden: false,
        // [AUDIT P1-7] Honest default: a fresh solve IS independent work.
        // Preselecting removes one mandatory tap per card; hint/solution stay
        // opt-in corrections to that default.
        autonomy: 'independent',
        frictionTypes: [],      // ['PERFECT', 'CALC', ...]
        timeSpentMins: 0,
        targetTimeMins: 5,
        stopwatchSeconds: 0,
        stopwatchInterval: null,
        eloResult: null,        // 🧠 Elo migration result captured at the decision instant
        frozenTimeMins: 0,      // ⏱ Stopwatch time frozen at the moment of truth
        resultLocked: false,    // 🔒 True once the user committed correct/incorrect
    };
}

function _startStopwatch() {
    // 🔒 Once the result is committed the stopwatch is frozen at the decision
    // instant — never let it restart, otherwise the time noted + Elo temporal-
    // divergence calc would inflate up to the "Log Attempt" click.
    if (_drawerState.resultLocked) return;
    if (_drawerState.stopwatchInterval) return;
    _drawerState.stopwatchInterval = setInterval(() => {
        _drawerState.stopwatchSeconds++;
        const el = document.getElementById('sr-stopwatch-display');
        if (el) {
            const m = Math.floor(_drawerState.stopwatchSeconds / 60).toString().padStart(2, '0');
            const s = (_drawerState.stopwatchSeconds % 60).toString().padStart(2, '0');
            el.textContent = `${m}:${s}`;
        }
    }, 1000);
}

function _pauseStopwatch() {
    if (_drawerState.stopwatchInterval) { clearInterval(_drawerState.stopwatchInterval); _drawerState.stopwatchInterval = null; }
}

// ── Open Practice Drawer ───────────────────────────────────────────────────
// Full-screen blurred modal. Shows the WHOLE question (text + image, image
// hideable), lets the user pick MCQ options, auto-grades against the loaded
// correct answer (or asks for a self-report when no answer is on file), then
// reveals the autonomy / friction / time tagging stage.

export function openPracticeDrawer(qId) {
    // Handler args arrive percent-encoded (_jsId); older callers may pass the
    // raw id — _findQByHandlerId tries both.
    const q = _findQByHandlerId(qId);
    if (!q) return;
    qId = String(q.id);

    // Close any existing drawer
    closePracticeDrawer();

    _drawerState.qId = qId;
    _drawerState.targetTimeMins = q.targetTimeMins || 5;

    const dueInfo = getDueStatus(q);
    const hasImage = (q.imageDataUrl && q.imageDataUrl.length > 100) || !!q.driveImageId
        || (q.diagramImageUrl && q.diagramImageUrl.length > 100);

    const overlay = document.createElement('div');
    overlay.className = 'sr-practice-overlay';
    overlay.id = 'sr-practice-overlay';
    // Own the user's attention while a review is on stage (P0-1 gate).
    SessionFocus.acquire('vault-drawer');
    // Click on the backdrop (not the drawer itself) closes the drawer.
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closePracticeDrawer();
    });

    overlay.innerHTML = `
        <div class="sr-practice-drawer sr-practice-modal" id="sr-drawer-${_esc(qId)}" role="dialog" aria-modal="true">
            <!-- ── Flow Lifeline ribbon: thin banner along top when CNS_LOAD fires ── -->
            <div class="sr-lifeline-ribbon" id="sr-lifeline-ribbon" style="display:none">
                <span style="margin-right:8px">🌊 Lifeline active for 1× solve. Aim 80%+ first.</span>
                <button class="sr-lifeline-dismiss" style="font-size:11px;padding:2px 8px;background:none;border:1px solid rgba(147,197,253,0.4);color:#93c5fd;border-radius:3px;cursor:pointer"
                        onclick="if(window.__lifeline){window.__lifeline.dismissForCurrentSolve();document.getElementById('sr-lifeline-ribbon').style.display='none';}">
                    I'd rather keep grinding
                </button>
            </div>
            <div class="sr-drawer-header">
                <div>
                    <div class="sr-drawer-title">${_esc(q.chapter || 'Unknown')} · Practice</div>
                    <div class="sr-drawer-sub">${_esc(q.subject || '')}${dueInfo.label ? ' · ' + _esc(dueInfo.label) : ''}</div>
                </div>
                <div class="sr-drawer-header-actions">
                    <div class="streak-visualizer" id="sr-streak-visualizer"><canvas id="sr-streak-canvas" width="16" height="16"></canvas></div>
                    <div id="sr-elo-header-slot" class="elo-header-slot"></div>
                    ${hasImage ? `<button class="sr-hide-img-btn" id="sr-hide-img-btn" type="button" onclick="srToggleImage()">👁 Hide Image</button>` : ''}
                    <button class="sr-drawer-close" onclick="closePracticeDrawer()" aria-label="Close practice drawer">✕</button>
                </div>
            </div>
            <div class="sr-drawer-body">
                <!-- Question stage: full question text + image (hideable) -->
                <div class="sr-question-stage" id="sr-question-stage">
                    ${_renderQuestionMedia(q)}
                    ${q.extractedText
                        ? `<div class="latex sr-question-text" id="sr-question-text">${_esc(q.extractedText)}</div>`
                        : `<div class="sr-question-text sr-muted">No question text on file — refer to the image above.</div>`}
                    ${q.hint ? `<div class="sr-hint-block">
                        <button class="sr-hint-toggle" id="sr-hint-toggle" type="button" onclick="srToggleHint()">💡 Hint</button>
                        <div class="sr-hint-body" id="sr-hint-body" style="display:none;">${_esc(q.hint)}</div>
                    </div>` : ''}
                </div>

                <!-- Answer stage: MCQ options (selectable) or self-report -->
                <div class="sr-answer-stage" id="sr-answer-stage">
                    ${_renderAnswerStage(q)}
                </div>

                <!-- Result banner (filled once answered) -->
                <div class="sr-result-zone" id="sr-result-zone"></div>

                <!-- Tagging stage (revealed AFTER the result is known) -->
                <div class="sr-tag-stage" id="sr-tag-stage" style="display:none;">
                    ${_renderTagStage()}
                </div>
            </div>
            <div class="sr-drawer-footer">
                <div class="sr-footer-summary" id="sr-footer-summary"></div>
                <button class="sr-submit-btn" id="sr-submit-btn" onclick="submitPracticeLog()" disabled>Log Attempt</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // ── Flow Lifeline: show the ribbon if CNS_LOAD is above threshold ──
    requestAnimationFrame(() => {
        try {
            if (window.__lifeline) {
                const ls = window.__lifeline.getStatus();
                const ribbon = document.getElementById('sr-lifeline-ribbon');
                if (ribbon && ls.active) {
                    ribbon.style.display = 'flex';
                }
            }
        } catch (_) {}
    });
    _startStopwatch();
    _postRenderDrawer(q);
}

export function closePracticeDrawer() {
    SessionFocus.release('vault-drawer');
    _pauseStopwatch();
    _resetDrawerState();
    const overlay = document.getElementById('sr-practice-overlay');
    if (overlay) overlay.remove();
}

// ── Practice drawer: helpers ───────────────────────────────────────────────

function _esc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Encode an id for embedding in a single-quoted inline-JS handler argument.
 * Entity-escaping alone is NOT safe here: the browser HTML-decodes attribute
 * values BEFORE compiling the handler, so a raw ' in an id would terminate
 * the JS string and inject code. Percent-encoding keeps every quote literal;
 * receiving functions decode defensively (raw match first, then decoded).
 */
function _jsId(id) { return encodeURIComponent(String(id == null ? '' : id)); }

/** Resolve a possibly-percent-encoded handler arg back to a bank question. */
function _findQByHandlerId(rawId) {
    const s = String(rawId == null ? '' : rawId);
    let q = AppState.questionBank.find(item => item.id != null && String(item.id) === s);
    if (!q) {
        try {
            const dec = decodeURIComponent(s);
            if (dec !== s) q = AppState.questionBank.find(item => item.id != null && String(item.id) === dec);
        } catch (_) { /* malformed % sequence — keep raw */ }
    }
    return q || null;
}

function _currentDrawerQuestion() {
    if (!_drawerState.qId) return null;
    return AppState.questionBank.find(item => item.id.toString() === _drawerState.qId.toString()) || null;
}

// Pull the leading letter (A/B/C/D) out of an option string like "A) ...".
function _optionLetter(opt, idx) {
    if (!opt) return String.fromCharCode(65 + idx);
    const m = String(opt).trim().match(/^([A-Za-z])[.)\s]/);
    if (m) return m[1].toUpperCase();
    return String.fromCharCode(65 + idx);
}

// Auto-cropped figure bound to a single MCQ option (Gem Diagram Map output,
// stored under the option letter). Local mirror of app.js's _gemOptionImageUrl
// — matrix.js cannot import app.js (circular module dependency), same
// convention as the duplicated _safeImgSrc above.
function _optionImgUrl(q, opt, idx) {
    if (!q || !q.optionImageUrls || typeof opt !== 'string') return null;
    const letter = _optionLetter(opt, idx);
    return q.optionImageUrls[letter]
        || q.optionImageUrls[opt]
        || q.optionImageUrls[opt.toUpperCase()]
        || null;
}

// Resolve the correct option LETTERS for an MCQ question from its stored
// correctAnswer — WITHOUT scanning the whole string for A-D characters.
//
// Why: answers frequently arrive as FULL OPTION STRINGS ("B) \frac{I}{4}")
// and a naive `/A-D/g` regex flags every A-D character ANYWHERE in the
// string — LaTeX commands (\frac contains 'a' + 'c') and prose ("Towards"
// contains 'a' + 'd') get misread as extra correct options, so a single-
// answer MCQ lights up A, B AND C as correct at once. Only these are
// trusted, in priority order:
//   1. an explicit leading option-letter prefix ("B) …", "(C) …", "D. …")
//   2. a bare letter / letter list ("B", "B, C", "B C", "B and C", "AB")
//   3. an exact normalized match of the answer text against an option's
//      text (each option's own letter prefix stripped first)
// Resolved letters are validated against the question's option count so a
// stray letter (e.g. the "I" of \frac{I}{4} — option index 8) can never be
// reported as a correct option on a 4-option question.
export function resolveMcqCorrectLetters(q) {
    if (!q) return [];
    const raw = q.correctAnswer;
    if (raw == null) return [];
    const options = Array.isArray(q.options) ? q.options : [];

    const out = [];
    const push = (l) => {
        l = String(l).trim().toUpperCase();
        if (l && /^[A-Z]$/.test(l) && out.indexOf(l) === -1) out.push(l);
    };
    // Drop letters that don't map to a real option index — the "I" inside
    // "\frac{I}{4}" is NOT option "I" on a 4-option question. With NO options
    // there can be no correct option letters at all (free-text part labels
    // like "(a) …, (b) …" must never resolve to "A"). Every caller already
    // guarantees options exist for real MCQ questions.
    const valid = () => {
        if (options.length === 0) return [];
        return out.filter(l => {
            const idx = l.charCodeAt(0) - 65;
            return idx >= 0 && idx < options.length;
        });
    };

    // ── Array form: ["B", "C"] or ["B) …", "C) …"] ──
    if (Array.isArray(raw)) {
        for (const entry of raw) {
            const s = String(entry).trim();
            const lead = s.match(/^[\(]?([A-Za-z])[\)\.\s:]/);
            if (lead) push(lead[1]);
            else if (/^[A-Za-z]$/.test(s)) push(s);
        }
        const v = valid();
        if (v.length) return v.sort();
        // Multi-part free-text array ("(a) …, (b) …") — let text matching try.
        return _matchAnswerToOptions(options, raw.join(' '));
    }

    const s = String(raw).trim();
    if (!s) return [];

    // ── Bare letter list: "B", "B, C", "B C", "B and C" ──
    if (/^[A-Za-z](?:\s*(?:,|&|and|\s)\s*[A-Za-z])*$/i.test(s)) {
        for (const tok of s.split(/[^A-Za-z]+/)) if (tok) push(tok);
        const v = valid();
        if (v.length) return v.sort();
    }

    // ── Compact multi-letter without separators: "AB", "ACD" ──
    if (/^[A-Za-z]{2,4}$/.test(s)) {
        for (const ch of s) push(ch);
        const v = valid();
        if (v.length) return v.sort();
    }

    // ── Leading option-letter prefix: "B) \frac{I}{4}" → B ──
    const lead = s.match(/^[\(]?([A-Za-z])[\)\.\s:]/);
    if (lead) {
        push(lead[1]);
        const v = valid();
        if (v.length) return v.sort();
        return _matchAnswerToOptions(options, s);
    }

    // ── Fallback: the answer text equals an option's text verbatim ──
    return _matchAnswerToOptions(options, s);
}

// Exact-match the stored answer text against the option texts (each option's
// own "A) " prefix stripped). Never fuzzy — a clean answer ("I") only
// resolves when it matches an option verbatim ("D) I").
function _matchAnswerToOptions(options, answerText) {
    if (!Array.isArray(options) || options.length === 0) return [];
    const norm = (t) => String(t).replace(/^[\(]?[A-Za-z][\)\.\s:]\s*/, '').trim().toLowerCase();
    const target = norm(answerText);
    if (!target) return [];
    const out = [];
    options.forEach((opt, i) => {
        if (norm(opt) === target) out.push(String.fromCharCode(65 + i));
    });
    return out;
}

function _hasLoadedAnswer(q) {
    if (q.correctAnswer == null) return false;
    if (Array.isArray(q.correctAnswer)) return q.correctAnswer.length > 0;
    return String(q.correctAnswer).trim().length > 0;
}

// Validate image sources before injecting into HTML: only app-generated
// data:image, https, or blob: URLs are allowed — anything else (crafted
// `" onerror=…` payloads) is dropped.
function _safeImgSrc(url) {
    if (typeof url !== 'string' || !url) return '';
    if (/^(data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,|https:\/\/|blob:)/i.test(url)) {
        return url.replace(/"/g, '&quot;');
    }
    return '';
}

function _renderQuestionMedia(q) {
    // Encoded SVG placeholder — must be URI-encoded: raw `<`, `>`, `#` in a
    // src attribute is fragile (browser re-parse differences) and a broken
    // placeholder leaves a permanent broken-image icon.
    const placeholderSrc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='300' height='180'><rect width='100%' height='100%' fill='#12121a'/><text x='50%' y='50%' fill='#444a6a' font-family='sans-serif' font-size='12' text-anchor='middle' dominant-baseline='middle'>Loading image…</text></svg>`)}`;
    let imgHtml = '';
    if (q.imageDataUrl && q.imageDataUrl.length > 100) {
        imgHtml = `<img class="sr-question-img" id="sr-question-img" src="${_safeImgSrc(q.imageDataUrl)}" alt="Question image">`;
    } else if (q.driveImageId) {
        imgHtml = `<img class="sr-question-img lazy-practice-img" id="sr-question-img" data-drive-id="${_esc(q.driveImageId || '')}" data-qid="${_esc(q.id)}" src="${placeholderSrc}" alt="Question image">`;
    }
    // Gem auto-crop diagram renders beneath the question image — parity with
    // the practice modal ("📐 Diagram:" block).
    const diagramHtml = (q.diagramImageUrl && q.diagramImageUrl.length > 100)
        ? `<div class="sr-question-diagram"><div class="sr-diagram-label">📐 Diagram</div>` +
          `<img class="sr-question-diagram-img" id="sr-question-diagram-img" src="${_safeImgSrc(q.diagramImageUrl)}" alt="Diagram" onclick="event.stopPropagation();window.openLightbox&&openLightbox(this.src)"></div>`
        : '';
    if (!imgHtml && !diagramHtml) return ''; // no media to show → no hide button either
    // The hide-image button now lives in the drawer header (so it never
    // overlaps the image). This wrapper just holds the media itself.
    return `
        <div class="sr-question-media" id="sr-question-media">
            ${imgHtml ? `<div class="sr-question-img-wrap" id="sr-question-img-wrap">${imgHtml}</div>` : ''}
            ${diagramHtml}
        </div>`;
}

/**
 * Pre-reveal confidence capture (Calibration layer). Shown BEFORE the answer
 * is committed so this measures foresight, not hindsight — the metacognitive
 * skill that actually separates top-100 rankers. Selection lands on
 * _drawerState.confidence and is consumed by _applyResult → Elo engine
 * (Brier scoring + overconfidence stinginess).
 */
const CONFIDENCE_LEVELS = [
    { key: 'sure',   label: '😎 Sure',    anchor: 0.92 },
    { key: 'likely', label: '🤔 Likely',  anchor: 0.70 },
    { key: 'guess',  label: '🎲 Guess',   anchor: 0.45 },
];

function _renderConfidenceSeg() {
    const btns = CONFIDENCE_LEVELS.map(c =>
        '<button class="sr-conf-btn" data-conf="' + c.key + '" type="button" onclick="srSetConfidence(\'' + c.key + '\')">' + c.label + '</button>'
    ).join('');
    return '<div class="sr-conf-seg" id="sr-conf-seg">' +
        '<div class="sr-conf-label">How confident are you?</div>' +
        '<div class="sr-conf-btns">' + btns + '</div>' +
        '</div>';
}

window.srSetConfidence = function (level) {
    _drawerState.confidence = level;
    const seg = document.getElementById('sr-conf-seg');
    if (seg) {
        seg.querySelectorAll('.sr-conf-btn').forEach(b => {
            b.classList.toggle('selected', b.getAttribute('data-conf') === level);
        });
    }
};

function _renderAnswerStage(q) {
    if (q.type === 'mcq' && Array.isArray(q.options) && q.options.length) {
        const isMulti = Array.isArray(q.correctAnswer);
        const optsHtml = q.options.map((opt, i) => {
            const letter = _optionLetter(opt, i);
            const optImg = _optionImgUrl(q, opt, i)
                ? `<img class="sr-mcq-img" src="${_safeImgSrc(_optionImgUrl(q, opt, i))}" alt="Option figure">`
                : '';
            return `<div class="sr-mcq-option" data-letter="${_esc(letter)}" data-option="${_esc(opt)}" onclick="srSelectOption(this)" role="button" tabindex="0">
                <span class="sr-mcq-letter">${_esc(letter)}</span>
                <span class="sr-mcq-text">${_esc(opt)}</span>
                ${optImg}
            </div>`;
        }).join('');
        return `
            <div class="sr-mcq-block">
                <div class="sr-mcq-label">${isMulti ? 'Select all that apply' : 'Select your answer'}</div>
                <div class="sr-mcq-options">${optsHtml}</div>
                ${_renderConfidenceSeg()}
                <button class="sr-confirm-btn" id="sr-confirm-btn" type="button" onclick="srConfirmAnswer()" disabled>Confirm Answer</button>
            </div>`;
    }
    // Non-MCQ: the answer stays HIDDEN until the user taps "Reveal Answer"
    // (parity with the question-bank practice modal — the stored answer must
    // never be visible while the user is still attempting the question).
    // srRevealAnswer() swaps in the answer + self-report buttons on demand.
    if (_hasLoadedAnswer(q)) {
        return `
            <div class="sr-self-report sr-self-report-inline">
                <div class="sr-self-report-label">Free-response question — solved it? Tap to reveal the answer, then grade yourself.</div>
                ${_renderConfidenceSeg()}
                <button class="sr-confirm-btn" id="sr-reveal-answer-btn" type="button" onclick="srRevealAnswer()">🔍 Reveal Answer</button>
            </div>`;
    }
    return `
        <div class="sr-self-report sr-self-report-inline">
            <div class="sr-self-report-label">No answer on file — were you correct?</div>
            ${_renderConfidenceSeg()}
            <div class="sr-self-report-btns">
                <button class="sr-self-btn correct" type="button" onclick="srSelfReport('correct')">✔ Yes, correct</button>
                <button class="sr-self-btn incorrect" type="button" onclick="srSelfReport('incorrect')">✖ No, incorrect</button>
            </div>
        </div>`;
}

function _renderTagStage() {
    return `
        <div class="sr-tag-divider">Now log your attempt ↓</div>
        <!-- Autonomy -->
        <div class="sr-row">
            <div class="sr-row-label">Autonomy Level</div>
            <div class="sr-toggle-group sr-toggle-group-3">
                <button class="sr-toggle-btn${_drawerState.autonomy === 'independent' ? ' active' : ''}" data-group="autonomy" data-value="independent" onclick="srSetAutonomy('independent')">🧠 Independent</button>
                <button class="sr-toggle-btn${_drawerState.autonomy === 'hint_used' ? ' active' : ''}" data-group="autonomy" data-value="hint_used" onclick="srSetAutonomy('hint_used')">💡 Hint Used</button>
                <button class="sr-toggle-btn${_drawerState.autonomy === 'solution_read' ? ' active' : ''}" data-group="autonomy" data-value="solution_read" onclick="srSetAutonomy('solution_read')">📖 Soln Read</button>
            </div>
        </div>
        <!-- Friction Type -->
        <div class="sr-row">
            <div class="sr-row-label">Friction Type <span style="opacity:.55;font-weight:400;">(optional — tap any that apply)</span></div>
            <div class="sr-friction-pills">
                ${SR_FRICTION_TYPES.map(ft => `<button class="sr-friction-pill" data-friction="${ft}" onclick="srToggleFriction('${ft}')">${SR_FRICTION_LABELS[ft]}</button>`).join('')}
            </div>
        </div>
        <!-- Time -->
        <div class="sr-row">
            <div class="sr-row-label">Time Spent</div>
            <div class="sr-time-row">
                <button class="sr-stopwatch" id="sr-stopwatch-btn" onclick="srToggleStopwatch()" type="button">
                    <span id="sr-stopwatch-display">00:00</span>
                    <span class="sr-pulse-dot" id="sr-pulse-dot"></span>
                </button>
                <button class="sr-manual-toggle" id="sr-manual-toggle" onclick="srToggleManualTime()" type="button">Manual</button>
                <input type="number" class="sr-manual-input" id="sr-manual-input" style="display:none;" min="0" step="0.5" placeholder="0" oninput="srUpdateManualTime(this.value)">
                <span class="sr-manual-unit" id="sr-manual-unit" style="display:none;">min</span>
                <span class="sr-target-ref">Target: ${_drawerState.targetTimeMins}m</span>
            </div>
        </div>`;
}

// Commit the result (auto-graded or self-reported) and reveal the tag stage.
// Also freezes the stopwatch so the time recorded is when the user decided
// their answer, not when they eventually click "Log Attempt".
function _applyResult(result, source, q) {
    _drawerState.result = result;
    _drawerState.resultSource = source;

    // ⏱ Freeze the stopwatch NOW — time should reflect when the user
    // decided their answer, not when they finish tagging friction types.
    if (_drawerState.stopwatchInterval) {
        clearInterval(_drawerState.stopwatchInterval);
        _drawerState.stopwatchInterval = null;
    }
    // Also freeze the pulse dot animation
    const pulseDot = document.getElementById('sr-pulse-dot');
    if (pulseDot) pulseDot.style.display = 'none';

    // 🔒 Lock the result so the stopwatch can't be restarted and the time/
    // elo can't drift downstream. Capture the FROZEN time so the Elo
    // migration (fired below) and submitPracticeLog() both use the instant
    // the user committed their answer — NOT the "Log Attempt" click.
    _drawerState.resultLocked = true;
    _drawerState.frozenTimeMins = _drawerState.stopwatchSeconds / 60;

    const zone = document.getElementById('sr-result-zone');
    if (zone) {
        const correctAns = _hasLoadedAnswer(q)
            ? (Array.isArray(q.correctAnswer) ? q.correctAnswer.join(', ') : q.correctAnswer)
            : null;
        let suffix = '';
        if (source === 'auto' && correctAns) {
            const escAns = typeof window.answerMathHTML === 'function' ? window.answerMathHTML(correctAns) : _esc(correctAns);
            suffix = (result === 'correct' ? ` — answer: ${escAns}` : ` — correct answer: ${escAns}`);
        } else if (source === 'self') {
            suffix = ' (self-reported)';
        }
        // Auto-cropped solution figure (Gem Diagram Map) surfaces beneath the
        // result banner — parity with the practice modal's "Peep Solution".
        const solImg = (q.solutionImageUrl && q.solutionImageUrl.length > 100)
            ? `<img class="sr-solution-img" src="${_safeImgSrc(q.solutionImageUrl)}" alt="Solution diagram">`
            : '';
        if (result === 'correct') {
            zone.innerHTML = `<div class="sr-result-banner correct">✅ Correct${suffix}</div>${solImg}`;
        } else {
            zone.innerHTML = `<div class="sr-result-banner incorrect">❌ Incorrect${suffix}</div>${solImg}`;
        }
    }

    // Reveal the tagging stage
    const tagStage = document.getElementById('sr-tag-stage');
    if (tagStage) tagStage.style.display = 'flex';

    // Hide the confirm button
    const cb = document.getElementById('sr-confirm-btn');
    if (cb) cb.style.display = 'none';

    if (source === 'auto') {
        // Mark MCQ options: correct → green, selected-wrong → red
        const correctSet = new Set(resolveMcqCorrectLetters(q));
        document.querySelectorAll('.sr-mcq-option').forEach(opt => {
            opt.style.pointerEvents = 'none';
            const letter = opt.getAttribute('data-letter');
            const wasSelected = _drawerState.selectedOptions.includes(letter);
            opt.classList.remove('correct-mark', 'wrong-mark');
            if (correctSet.has(letter)) opt.classList.add('correct-mark');
            else if (wasSelected) opt.classList.add('wrong-mark');
        });
    } else {
        // Self-report: lock MCQ options if any, otherwise hide the answer stage
        const mcqOpts = document.querySelectorAll('.sr-mcq-option');
        if (mcqOpts.length) {
            mcqOpts.forEach(o => { o.style.pointerEvents = 'none'; });
        } else {
            const as = document.getElementById('sr-answer-stage');
            if (as) as.style.display = 'none';
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 🎮 GAMIFICATION + 🧠 ELO FEEDBACK — fired at the MOMENT OF TRUTH
    // (when the user clicks "Confirm Answer" / "Yes, correct" / "No,
    // incorrect"), NOT deferred to the "Log Attempt" button. This mirrors
    // the standard question-practice modal so the user instantly gets:
    //   • the red/green colour flash + correct/wrong sound effect
    //   • the streak update + glow/supercharged overlays
    //   • the +/- Elo chip popped into the header (the title bar that holds
    //     the streak visualizer & hide-image button), using the FROZEN time
    //     captured at the decision instant.
    // The frozen time + eloResult are stashed on _drawerState so the later
    // submitPracticeLog() reuses them instead of recomputing/double-counting.
    // ═══════════════════════════════════════════════════════════════════════
    if (_drawerState.result === 'incorrect') {
        if (typeof window.triggerRedFlash === 'function') window.triggerRedFlash();
        if (typeof window.playWrongSound === 'function') window.playWrongSound();
        if (Math.random() < 0.2) {
            if (typeof window.triggerStreakShield === 'function') window.triggerStreakShield();
        } else {
            AppState.practiceCorrectStreak = 0;
        }
    } else if (_drawerState.result === 'correct') {
        AppState.practiceCorrectStreak++;
        if (window._justWonBounty) {
            window._justWonBounty = false;
            if (typeof window.showNormalGlow === 'function') window.showNormalGlow();
        } else if (document.body.classList.contains('overheat-active')) {
            // changeCount indexes solved[physics|chemistry|maths] — a raw
            // "Physics"/custom subject used to compute undefined+2 = NaN and
            // poison the daily tally. Canonicalize before writing.
            changeCount(normSubjKey(q.subject), 2);
            if (typeof window.showSupercharged === 'function') window.showSupercharged();
            if (typeof window.deactivateOverheat === 'function') window.deactivateOverheat();
        } else if (AppState.bounty && AppState.bounty.payoffCount > 0) {
            AppState.bounty.payoffCount--;
            saveAllAsync().catch(console.error);
            if (typeof window.showSupercharged === 'function') window.showSupercharged();
        } else {
            if (typeof window.showNormalGlow === 'function') window.showNormalGlow();
            if (typeof window.playCorrectSound === 'function') window.playCorrectSound();
            if (Math.random() < 0.15) {
                if (typeof window.showSupercharged === 'function') window.showSupercharged();
            }
        }
    }
    if (typeof window.updateStreakVisualizer === 'function') window.updateStreakVisualizer();

    // ── Cognitive MMR / Elo migration (uses the FROZEN decision time) ──
    let _eloResult = null;
    if (typeof window.calculateEloMigration === 'function' && q.subject) {
        try {
            // Calibration capture: publish the pre-reveal confidence for the
            // engine to consume synchronously inside this solve, then clear it
            // so it can never leak into an unrelated solve.
            window._pendingSolveConfidence = _drawerState.confidence || null;
            const _actualSeconds = Math.max(0, Math.round(_drawerState.frozenTimeMins * 60));
            const _score = _drawerState.result === 'correct' ? 1 : 0;
            const _health = (typeof window._getChapterHealth === 'function')
                ? window._getChapterHealth(q.subject, q.chapter)
                : 50;  // benign mid-default if the bridge is unavailable
            _eloResult = window.calculateEloMigration(
                q.subject,
                _actualSeconds,
                _score,
                _health,
                q
            );
        } catch (_eloErr) {
            console.error('Elo migration fault in _applyResult:', _eloErr);
        } finally {
            window._pendingSolveConfidence = null;
        }
    }
    _drawerState.eloResult = _eloResult;

    // Persist the Elo mutation immediately — don't wait for "Log Attempt".
    saveAllAsync().catch(console.error);

    // ── Inject a PERSISTENT +/- Elo chip into the SR drawer header slot
    // (the title bar that holds the streak visualizer & hide-image button).
    // It stays visible while the user finishes tagging and is cleared
    // automatically when the drawer closes (the overlay is removed).
    if (_eloResult) {
        const _headerSlot = document.getElementById('sr-elo-header-slot');
        if (_headerSlot) {
            const _delta = _eloResult.deltaSubject || 0;
            const _sign = _delta >= 0 ? '+' : '';
            let _tierName = '';
            try {
                if (typeof window.getRankTierDetails === 'function') {
                    _tierName = '[' + window.getRankTierDetails(_eloResult.newSubjectElo).name + ']';
                }
            } catch (_) { /* ignore */ }
            _headerSlot.innerHTML =
                '<div class="elo-header-chip ' + (_delta >= 0 ? 'elo-up' : 'elo-down') + '">' +
                    '<span class="elo-shift-delta">' + _sign + Math.round(_delta) + '</span>' +
                    '<span class="elo-shift-tier">' + _tierName + '</span>' +
                '</div>';
        }

        // ── Tier transition celebration — cascading emoji burst + fanfare,
        // fired from the SR drawer's centre while it's still on screen. ──
        if (_eloResult.tierChanged) {
            try {
                let originX = window.innerWidth / 2;
                let originY = window.innerHeight / 2;
                const drawer = document.querySelector('#sr-practice-overlay .sr-practice-modal');
                if (drawer && drawer.offsetParent !== null) {
                    const rect = drawer.getBoundingClientRect();
                    originX = rect.left + rect.width / 2;
                    originY = rect.top + rect.height / 2;
                }
                if (typeof window.burstEmojis === 'function') {
                    window.burstEmojis(originX, originY, 40,
                        ['🎉', '😄', '🔥', '✨', '🥳', '🎊', '💯', '🌟', '😎', '🏆'], 1.6);
                }
                if (typeof window.playSuperSound === 'function') {
                    window.playSuperSound();
                }
            } catch (_) { /* ignore celebration errors */ }
        }
    }

    // ── Refresh the dashboard MMR matrix — DEFERRED to a macrotask. ──
    // At this point in _applyResult we've just fired the red/green flash
    // overlay, the streak-canvas flame update, the glow/supercharged overlay,
    // the +/- Elo chip injection, and the audio cues. All of those are
    // visual/animations that need compositor frames to render cleanly.
    // renderEloMatrix() is a layout-heavy synchronous SVG redraw of the entire
    // MMR grid — running it in the SAME frame as the flash/glow effects
    // hijacks the main thread and drops those feedback frames. Deferring it
    // via setTimeout(0) yields the current event loop so the compositor can
    // paint the feedback BEFORE the CPU-bound grid rebuild runs. (The drawer
    // is still open here, so the dashboard grid is off-screen anyway — the
    // user sees the result the moment the drawer closes in submitPracticeLog.)
    if (typeof window.renderEloMatrix === 'function') {
        setTimeout(() => {
            try { window.renderEloMatrix(); } catch (_) { /* never block */ }
        }, 0);
    }

    _updateDrawerUI();
}

// Shown when an MCQ question has NO loaded answer — ask the user to self-report.
function _showSelfReportPrompt(q) {
    const zone = document.getElementById('sr-result-zone');
    if (zone) {
        zone.innerHTML = `
            <div class="sr-self-report">
                <div class="sr-self-report-label">No answer on file — were you correct?</div>
                <div class="sr-self-report-btns">
                    <button class="sr-self-btn correct" type="button" onclick="srSelfReport('correct')">✔ Yes, correct</button>
                    <button class="sr-self-btn incorrect" type="button" onclick="srSelfReport('incorrect')">✖ No, incorrect</button>
                </div>
            </div>`;
    }
    const cb = document.getElementById('sr-confirm-btn');
    if (cb) cb.style.display = 'none';
    document.querySelectorAll('.sr-mcq-option').forEach(o => { o.style.pointerEvents = 'none'; });
}

function _renderKatexIn(el) {
    if (!el || !window.katex) return;
    const raw = el.textContent;
    // Auto-wrap delimiter-less \command fragments (shared with app.js's global
    // math engine) so Gem output without $...$ delimiters still hydrates.
    const wrapped = (typeof window._wrapBareLatex === 'function') ? window._wrapBareLatex(raw) : raw;
    el.innerHTML = wrapped.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^\$]+)\$|\\\(([\s\S]+?)\\\)/g, (m, block, brk, inline, paren) => {
        try { return window.katex.renderToString(block || brk || inline || paren, { throwOnError: false, displayMode: !!(block || brk) }); }
        catch (e) { return m; }
    });
}

function _postRenderDrawer(q) {
    // Render LaTeX inside the question text + MCQ option text
    if (window.katex) {
        const textEl = document.getElementById('sr-question-text');
        if (textEl) _renderKatexIn(textEl);
        const hintEl = document.getElementById('sr-hint-body');
        if (hintEl) _renderKatexIn(hintEl);
        document.querySelectorAll('.sr-mcq-text').forEach(el => _renderKatexIn(el));
    }
    // Lazy-load the drive image if the question only has a driveImageId
    if (!q.imageDataUrl && q.driveImageId) {
        const token = (typeof AppState.driveAccessToken !== 'undefined') ? AppState.driveAccessToken : null;
        const doFetch = (tok) => {
            if (!tok) return;
            fetchMediaFromDrive(q.driveImageId, tok).then(b64 => {
                if (!b64) return;
                q.imageDataUrl = b64;
                const img = document.getElementById('sr-question-img');
                if (img) img.src = b64;
            }).catch(() => {});
        };
        if (token) {
            doFetch(token);
        } else if (typeof waitForDriveToken === 'function') {
            // waitForDriveToken is CALLBACK-style (returns undefined) — the old
            // Promise.resolve(waitForDriveToken()).then(doFetch) never invoked
            // doFetch and the internal retry interval called undefined() every
            // 500ms. Pass the callback it expects.
            try { waitForDriveToken(() => doFetch((typeof AppState.driveAccessToken !== 'undefined') ? AppState.driveAccessToken : null)); } catch (e) {}
        }
    }
}

// ── Practice drawer: MCQ + image interaction handlers (exposed to window) ──

export function srSelectOption(el) {
    const q = _currentDrawerQuestion();
    if (!q) return;
    const isMulti = Array.isArray(q.correctAnswer);
    const letter = el.getAttribute('data-letter');
    if (isMulti) {
        const idx = _drawerState.selectedOptions.indexOf(letter);
        if (idx === -1) _drawerState.selectedOptions.push(letter);
        else _drawerState.selectedOptions.splice(idx, 1);
        el.classList.toggle('selected');
    } else {
        _drawerState.selectedOptions = [letter];
        document.querySelectorAll('.sr-mcq-option').forEach(o => o.classList.remove('selected'));
        el.classList.add('selected');
    }
    const cb = document.getElementById('sr-confirm-btn');
    if (cb) cb.disabled = _drawerState.selectedOptions.length === 0;
}

export function srConfirmAnswer() {
    const q = _currentDrawerQuestion();
    if (!q) return;
    if (_drawerState.selectedOptions.length === 0) return;
    if (_hasLoadedAnswer(q)) {
        const selected = [..._drawerState.selectedOptions].sort();
        const correct = resolveMcqCorrectLetters(q).sort();
        const isCorrect = selected.length === correct.length && selected.every((l, i) => l === correct[i]);
        _applyResult(isCorrect ? 'correct' : 'incorrect', 'auto', q);
    } else {
        _showSelfReportPrompt(q);
    }
}

export function srSelfReport(result) {
    const q = _currentDrawerQuestion();
    if (!q) return;
    _applyResult(result, 'self', q);
}

// Non-MCQ with an answer on file: reveal the stored answer + self-report
// buttons ONLY after the user explicitly taps "Reveal Answer" (parity with
// the question-bank practice modal — the answer must stay hidden while the
// user is still attempting the question).
export function srRevealAnswer() {
    const q = _currentDrawerQuestion();
    if (!q) return;
    const stage = document.getElementById('sr-answer-stage');
    if (!stage) return;
    const correctAns = typeof window.answerMathHTML === 'function'
        ? window.answerMathHTML(q.correctAnswer)
        : _esc(Array.isArray(q.correctAnswer) ? q.correctAnswer.join(', ') : q.correctAnswer);
    // Auto-cropped solution figure (Gem Diagram Map) renders above the reveal.
    const solImg = (q.solutionImageUrl && q.solutionImageUrl.length > 100)
        ? `<img class="sr-solution-img" src="${_safeImgSrc(q.solutionImageUrl)}" alt="Solution diagram">`
        : '';
    stage.innerHTML = `
        <div class="sr-self-report sr-self-report-inline">
            ${solImg}
            <div class="sr-self-report-label">Correct answer: <strong>${correctAns}</strong>. Did you get it right?</div>
            <div class="sr-self-report-btns">
                <button class="sr-self-btn correct" type="button" onclick="srSelfReport('correct')">✔ Yes, correct</button>
                <button class="sr-self-btn incorrect" type="button" onclick="srSelfReport('incorrect')">✖ No, incorrect</button>
            </div>
        </div>`;
    // Hydrate LaTeX inside the freshly revealed answer WITHOUT stripping the
    // <strong> emphasis wrapper (_renderKatexIn replaces innerHTML, so run it
    // on the strong element itself, not the whole label).
    if (window.katex) {
        const answerEl = stage.querySelector('.sr-self-report-label strong');
        if (answerEl) _renderKatexIn(answerEl);
    }
}

export function srToggleImage() {
    _drawerState.imageHidden = !_drawerState.imageHidden;
    // Toggle the whole media stage (question image + gem diagram) so hiding
    // the photo hides every visual — parity with the practice modal.
    const media = document.getElementById('sr-question-media');
    const btn = document.getElementById('sr-hide-img-btn');
    if (media) media.style.display = _drawerState.imageHidden ? 'none' : 'block';
    if (btn) btn.textContent = _drawerState.imageHidden ? '👁 Show Image' : '👁 Hide Image';
}

// Reveal/hide the Gem-provided hint WITHOUT revealing the answer — aligns with
// the "💡 Hint Used" autonomy tag in the tagging stage.
export function srToggleHint() {
    const body = document.getElementById('sr-hint-body');
    if (!body) return;
    const hidden = body.style.display === 'none';
    body.style.display = hidden ? 'block' : 'none';
    const btn = document.getElementById('sr-hint-toggle');
    if (btn) btn.classList.toggle('revealed', hidden);
}

// ── Drawer Interaction Handlers (exposed to window) ────────────────────────

export function srSetResult(value) {
    _drawerState.result = value;
    document.querySelectorAll('[data-group="result"]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-value') === value);
    });
    _updateDrawerUI();
}

export function srSetAutonomy(value) {
    _drawerState.autonomy = value;
    document.querySelectorAll('[data-group="autonomy"]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-value') === value);
    });
    _updateDrawerUI();
}

export function srToggleFriction(ft) {
    const idx = _drawerState.frictionTypes.indexOf(ft);
    if (idx === -1) _drawerState.frictionTypes.push(ft);
    else _drawerState.frictionTypes.splice(idx, 1);

    document.querySelectorAll('.sr-friction-pill').forEach(pill => {
        pill.classList.toggle('active', _drawerState.frictionTypes.includes(pill.getAttribute('data-friction')));
    });
    _updateDrawerUI();
}

export function srToggleStopwatch() {
    // 🔒 Frozen at the result-decision instant — ignore toggles afterwards.
    if (_drawerState.resultLocked) return;
    const dot = document.getElementById('sr-pulse-dot');
    if (_drawerState.stopwatchInterval) {
        _pauseStopwatch();
        if (dot) dot.classList.remove('running');
    } else {
        _startStopwatch();
        if (dot) dot.classList.add('running');
    }
}

export function srToggleManualTime() {
    const toggle = document.getElementById('sr-manual-toggle');
    const input = document.getElementById('sr-manual-input');
    const unit = document.getElementById('sr-manual-unit');
    const isManual = toggle.classList.toggle('active');
    input.style.display = isManual ? 'inline-block' : 'none';
    unit.style.display = isManual ? 'inline' : 'none';
    if (isManual) { _pauseStopwatch(); const dot = document.getElementById('sr-pulse-dot'); if (dot) dot.classList.remove('running'); }
}

export function srUpdateManualTime(val) {
    _drawerState.timeSpentMins = parseFloat(val) || 0;
    _updateDrawerUI();
}

function _updateDrawerUI() {
    // Update footer summary
    const summary = document.getElementById('sr-footer-summary');
    if (summary) {
        let parts = [];
        if (_drawerState.result) parts.push(_drawerState.result === 'correct' ? '<span style="color:#10B981;">✓ Correct</span>' : '<span style="color:#EF4444;">✗ Incorrect</span>');
        if (_drawerState.autonomy) parts.push(`<span style="color:#888;">· ${_drawerState.autonomy.replace('_', ' ')}</span>`);
        if (_drawerState.frictionTypes.length > 0) parts.push(`<span style="color:#888;">· ${_drawerState.frictionTypes.length} friction${_drawerState.frictionTypes.length > 1 ? 's' : ''}</span>`);
        const tSpent = _drawerState.timeSpentMins > 0 ? _drawerState.timeSpentMins : _drawerState.stopwatchSeconds / 60;
        if (tSpent > 0) parts.push(`<span style="color:#888;">· ${Math.round(tSpent * 10) / 10}m</span>`);
        summary.innerHTML = parts.join(' ');
    }

    // Enable/disable submit — a 0s answer must still be loggable: requiring
    // timeSpent > 0 left the button dead for instant answers.
    // Friction tags are OPTIONAL [AUDIT P1-7]: demanding ≥1 tag forced users
    // to invent a "friction type" even for flawless instant solves (~100+
    // taps per 15-card queue), the classic reason SR systems get abandoned.
    // Untagged logs flow into the report engine's untagged bucket, which
    // already exists; result + autonomy remain required (they drive SM-2).
    const canSubmit = _drawerState.result && _drawerState.autonomy;
    const btn = document.getElementById('sr-submit-btn');
    if (btn) btn.disabled = !canSubmit;
}

// ── Submit Practice Log ────────────────────────────────────────────────────

export function submitPracticeLog() {
    const qId = _drawerState.qId;
    if (!qId) return;

    const q = AppState.questionBank.find(item => item.id.toString() === qId.toString());
    if (!q) return;

    const timeSpent = _drawerState.timeSpentMins > 0 ? _drawerState.timeSpentMins : _drawerState.stopwatchSeconds / 60;

    // ── Lock the first-attempt result BEFORE pushing the new historyLog.
    // Accuracy only counts the FIRST attempt of each question, so re-solving
    // from the error matrix must NOT change it. We set firstAttemptResult only
    // when there are no prior historyLogs AND no existing firstAttemptResult
    // (i.e. this is truly the first time the question is being practiced).
    if (!q.firstAttemptResult && (!Array.isArray(q.historyLogs) || q.historyLogs.length === 0)) {
        q.firstAttemptResult = _drawerState.result;
    }

    const srResult = computeSR(q, {
        result: _drawerState.result,
        autonomy: _drawerState.autonomy,
        frictionTypes: [..._drawerState.frictionTypes],
        timeSpentMins: Math.round(timeSpent * 10) / 10,
    });

    // Memory Kernel v2 — the honest friction/autonomy tag arrived AFTER the
    // Elo moment, so refine ONLY the difficulty axis here (stability/reps/
    // lapses were already committed inside calculateEloMigration; refining a
    // single aspect per event keeps the kernel free of double-counting).
    try { refineDifficultyAfterTag(q, srResult.performanceQ); } catch (_) {}

    // Append history log entry
    if (!Array.isArray(q.historyLogs)) q.historyLogs = [];
    q.historyLogs.push({
        id: 'log-' + Date.now(),
        timestamp: new Date().toISOString(),
        result: _drawerState.result,
        autonomy: _drawerState.autonomy,
        frictionTypes: JSON.stringify(_drawerState.frictionTypes),
        timeSpentMins: Math.round(timeSpent * 10) / 10,
        performanceQ: srResult.performanceQ,
        newInterval: srResult.newInterval,
        newEaseFactor: srResult.newEaseFactor,
        // Calibration layer — pre-reveal confidence for this attempt.
        confidence: _drawerState.confidence || null,
    });

    // ── Bound text-bloat: keep only the 30 most recent logs per question.
    // The UI renders the last 5 attempt dots / reversed list, so nothing
    // visible is lost while storage stays capped. ──
    if (q.historyLogs.length > 30) q.historyLogs = q.historyLogs.slice(-30);

    // ── Incremental nav counter: a correct SR commit bumps the CK engine's
    // "fixed today" ring in O(1) instead of it rescaming every log on the
    // next 1s tick. No-op if the CK engine isn't present. ──
    try {
        if (_drawerState.result === 'correct' && typeof window.__ckBumpTodayFix === 'function') {
            window.__ckBumpTodayFix(q.subject);
        }
    } catch (_) {}

    // Update SR state on question
    q.currentInterval = srResult.newInterval;
    q.easeFactor = srResult.newEaseFactor;
    q.nextReviewAt = srResult.nextReviewAt;
    q.isMastered = srResult.isMastered;

    // ⚡ DYNAMIC COMBO CONVERGENCE: Update primary tracking tag to match the worst current error profile
    if (_drawerState.frictionTypes.length > 0) {
        // Map active strings to their baseline mathematical order weights
        const weights = { PERFECT: 5, CALC: 4, FORMULA: 3, CONCEPT: 2, APPROACH: 1 };
        
        // Sort selections to extract the single most severe breakdown layer
        // (unknown friction strings must not produce NaN comparisons)
        const dominantFriction = [..._drawerState.frictionTypes].sort((a, b) => (weights[a] || 0) - (weights[b] || 0))[0];
        
        // Map internal uppercase keys to match your system design styles (calculation, conceptual, misread)
        const typeMapping = {
            PERFECT: 'calculation', 
            CALC: 'calculation',
            FORMULA: 'conceptual',
            CONCEPT: 'conceptual',
            APPROACH: 'misread'
        };
        
        q.errorReason = typeMapping[dominantFriction] || q.errorReason;
    }

    // ✅ FIXED: Restored legacy status fields & balanced structural brackets
    if (_drawerState.result === 'correct' && q.status !== 'solved') {
        q.status = 'solved';
        changeCount(normSubjKey(q.subject), 1);   // canonical key — NaN guard
    } else if (_drawerState.result === 'incorrect') {
        q.status = 'error';
    }

    // 🎮 Gamification effects (red flash / sounds / streak) and 🧠 Elo
    // migration now fire at the moment of truth in _applyResult() — i.e. when
    // the user clicks "Confirm Answer" / "Yes, correct" / "No, incorrect" —
    // so the feedback (colour flash, sound, +/- Elo chip in the header) shows
    // immediately, exactly like the standard question-practice modal. The
    // frozen time + eloResult are stashed on _drawerState and reused here.

    const secondsToInject = Math.round(timeSpent * 60);
    if (secondsToInject > 0 && q.subject) {
        // ══════════════════════════════════════════════════════════════════════
        // 🔑 DEFENSIVE SUBJECT KEY NORMALIZATION
        // Trim, lowercase, and coerce common aliases ("math", "mathematics")
        // into the canonical dictionary index key "maths" so that the `in`
        // check never silently drops a time-injection due to a key mismatch.
        // ══════════════════════════════════════════════════════════════════════
        const SUBJ_KEY_ALIASES = {
            math: 'maths',
            mathematics: 'maths',
            'maths ': 'maths',   // trailing-space guard
        };
        const rawKey = String(q.subject).trim().toLowerCase();
        const subjKey = SUBJ_KEY_ALIASES[rawKey] || rawKey;

        if (subjKey in studySecs) {
            studySecs[subjKey] += secondsToInject;
            if (typeof window.updateStudyTimeHeader === 'function') {
                window.updateStudyTimeHeader();
            }
        }
    }

    // Autonomy honesty clawback — the Elo delta fired at the moment of truth,
    // BEFORE the user tagged their autonomy level. Reading the solution is not
    // retrieval practice, and a hint is not independence: reclaim the credit
    // gap now (helper lives in app.js next to the engine; no-op when the solve
    // earned nothing or autonomy was independent).
    try {
        if (typeof window._applyAutonomyClawback === 'function') {
            window._applyAutonomyClawback(q, _drawerState.eloResult, _drawerState.autonomy);
            _drawerState.confidence = null;   // consumed — never leaks to next log
        }
    } catch (_) { /* honesty adjustment must never block the log */ }

    saveAllAsync().catch(console.error);
    closePracticeDrawer();

    // ── Staggered deferred UI rebuild ──────────────────────────────────────
    // The drawer-close transition, the green/red flash overlay, the streak
    // canvas flame, and the Elo chip injection all need compositor frames to
    // animate smoothly. Running renderErrorMatrixFromBank (N-card innerHTML
    // wipe), filterErrors (forced layout reads), renderErrorResolutionDashboard
    // (SVG sparkline rebuild), updateUI (full HUD recompute), renderGraph
    // (candlestick SVG rebuild), and renderEloMatrix (MMR grid rebuild) ALL in
    // one synchronous frame hijacks the main thread for 80-200ms on mobile
    // WebKit, dropping the close-transition + flash frames.
    //
    // Instead: a double-rAF lets the drawer-close animation's first frames
    // commit on the compositor, then _staggeredChain runs each heavy rebuild
    // in its own macrotask with one rAF yield between them so the compositor
    // gets a clean paint window in every gap.
    //
    // ✅ Each stage is still unconditionally invoked so the dashboard reflects
    // the just-injected study time + migrated Elo the instant the drawer
    // finishes closing.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            _staggeredChain([
                () => renderErrorMatrixFromBank(),
                () => {
                    filterErrors();
                    renderErrorResolutionDashboard();
                    // The dashboard just re-drew its PLAIN sparkline into the
                    // momentum container — without this re-chain the card
                    // regressed from candles to sparkline until the next tab
                    // switch / focus / rollover (same fix as app.js's chains).
                    if (typeof window.renderMomentumCandles === 'function') window.renderMomentumCandles();
                },
                () => {
                    // updateUI() already calls renderEloMatrix() internally, but
                    // we re-run it explicitly so the subject monitors + deficit
                    // lockdown overlay reflect the just-migrated state even if
                    // updateUI short-circuited on a stale DOM cache.
                    if (typeof window.renderEloMatrix === 'function') {
                        try { window.renderEloMatrix(); } catch (_) { /* never block */ }
                    }
                },
            ]);
            // (Tier transition celebration + Elo chip injection now happen
            //  in _applyResult() at the moment of truth — nothing to do here.)
        });
    });
}

// ── Delete ──────────────────────────────────────────────────────────────────

export function removeErrorLog(id) {
    if (confirm("Confirm deletion of this friction point and all its attempt history?")) {
        // Accept percent-encoded (_jsId) or raw ids — see _findQByHandlerId.
        let target = _findQByHandlerId(id);
        if (!target) return;
        const targetId = String(target.id);
        AppState.questionBank = AppState.questionBank.filter(q => q.id == null || String(q.id) !== targetId);
        id = targetId;
        // Tombstone the id so a stale cloud snapshot can never resurrect it.
        recordCloudTombstone(id).catch(console.error);
        saveAllAsync().catch(console.error);
        closePracticeDrawer();
        // Defer heavy DOM rebuilds — staggered so the close animation + any
        // pending compositor frames get clean paint windows between each
        // layout-heavy rebuild (matrix cards, filter pass, dashboard SVG).
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                _staggeredChain([
                    () => renderErrorMatrixFromBank(),
                    () => {
                        filterErrors();
                        renderErrorResolutionDashboard();
                        if (typeof window.renderMomentumCandles === 'function') window.renderMomentumCandles();
                    },
                    () => { try { renderChapterDecayGrid(); } catch (_) {} },
                ]);
            });
        });
    }
}

// ── Filter ──────────────────────────────────────────────────────────────────

export function filterErrors() {
    if (_dailyQueueActive) {
        _renderDailyQueueCards();
        return;
    }

    const typeFilter = document.getElementById('filter-type') ? document.getElementById('filter-type').value : 'all';
    const statusFilter = document.getElementById('filter-status') ? document.getElementById('filter-status').value : 'all';
    const textFilter = document.getElementById('filter-tag') ? document.getElementById('filter-tag').value.toLowerCase().trim() : '';

    const blocks = document.querySelectorAll('#error-list-container .error-block');
    let visible = 0;
    blocks.forEach(block => {
        const bType = block.getAttribute('data-type');
        const bSrStatus = block.getAttribute('data-sr-status');
        const bSubj = block.getAttribute('data-subject');

        const bChapter = block.querySelector('.error-chapter') ? block.querySelector('.error-chapter').textContent.toLowerCase() : '';
        const bTag = block.querySelector('.error-tag') ? block.querySelector('.error-tag').textContent.toLowerCase() : '';

        let typeMatch = (typeFilter === 'all' || typeFilter === bType);
        let subjMatch = (_normSubj(bSubj) === _normSubj(AppState.currentErrorSubject));
        let textMatch = bChapter.includes(textFilter) || bTag.includes(textFilter);

        let statusMatch = true;
        if (statusFilter === 'ready')     statusMatch = bSrStatus === 'ready';
        else if (statusFilter === 'due_soon')   statusMatch = bSrStatus === 'due_soon';
        else if (statusFilter === 'scheduled')  statusMatch = bSrStatus === 'scheduled';
        else if (statusFilter === 'mastered')   statusMatch = bSrStatus === 'mastered';

        if (typeMatch && statusMatch && subjMatch && textMatch) {
            block.classList.remove('hidden');
            visible++;
        } else {
            block.classList.add('hidden');
        }
    });

    _updateMatrixMeta(visible, blocks.length, { typeFilter, statusFilter, textFilter });

    // Section headers mirror their members: a group with no visible cards
    // collapses (and its counter shows the filtered count, not the total).
    document.querySelectorAll('#error-list-container .em-group-head').forEach(head => {
        const st = head.getAttribute('data-group-status');
        let shown = 0;
        document.querySelectorAll('#error-list-container .error-block[data-sr-status="' + st + '"]').forEach(b => {
            if (!b.classList.contains('hidden')) shown++;
        });
        head.hidden = shown === 0;
        const cnt = head.querySelector('.emg-count');
        if (cnt) cnt.textContent = String(shown);
    });
}

// ── Live result feedback ("how many / what's due / how to reset") ──────────
// DMMT: a filter change must always answer three questions at a glance —
// how many cards matched, how many need action today, and how to undo.
function _updateMatrixMeta(visible, total, f) {
    const meta = document.getElementById('matrix-meta');
    if (!meta) return;

    if (total === 0) { meta.hidden = true; meta.innerHTML = ''; _toggleNoMatchNode(false); return; }

    const filtersActive = (f.statusFilter !== 'all') || (f.typeFilter !== 'all') || !!f.textFilter;
    meta.hidden = false;
    let dueNow = 0;
    document.querySelectorAll('#error-list-container .error-block:not(.hidden)').forEach(b => {
        if (b.getAttribute('data-sr-status') === 'ready') dueNow++;
    });

    meta.innerHTML =
        '<span class="matrix-meta-count"><b>' + visible + '</b>&nbsp;of ' + total + ' shown</span>' +
        (dueNow ? '<span class="matrix-meta-due">·&nbsp;<b>' + dueNow + '</b>&nbsp;due now</span>' : '') +
        (filtersActive ? '<button class="matrix-meta-clear" onclick="clearMatrixFilters()" type="button">✕ Clear filters</button>' : '');

    _toggleNoMatchNode(visible === 0);
}

// Zero matches → inject a "way back" card instead of silent blank space.
function _toggleNoMatchNode(show) {
    const c = document.getElementById('error-list-container');
    if (!c) return;
    let node = document.getElementById('em-nomatch');
    if (show) {
        if (!node) {
            node = document.createElement('div');
            node.id = 'em-nomatch';
            c.appendChild(node);
        }
        node.className = 'em-empty em-empty--filter';
        node.innerHTML =
            '<div class="em-empty-icon" aria-hidden="true">🔍</div>' +
            '<div class="em-empty-title">Nothing matches those filters</div>' +
            '<div class="em-empty-desc">Every card is hidden by the current status / type / search combo.</div>' +
            '<div class="em-empty-actions"><button class="em-empty-secondary" onclick="clearMatrixFilters()" type="button">✕ Clear all filters</button></div>';
    } else if (node) {
        node.remove();
    }
}

// ==================== DAILY CORE QUEUE ====================

function _showDailyQueue() {
    const btn = document.getElementById('daily-queue-btn');
    const title = document.getElementById('error-matrix-title');
    const badge = document.getElementById('daily-queue-badge');
    const folders = document.querySelectorAll('.subject-folder');
    if (btn) btn.classList.add('active');
    if (title) title.textContent = '⚡ Daily Core Queue';
    if (badge) badge.style.display = 'inline';
    folders.forEach(f => f.style.opacity = '0.35');
    document.querySelectorAll('.emf-pill-group[data-emf-filter="status"] .matrix-pill').forEach(p => p.classList.remove('active'));
    _renderDailyQueueCards();
}

function _hideDailyQueue() {
    const btn = document.getElementById('daily-queue-btn');
    const title = document.getElementById('error-matrix-title');
    const badge = document.getElementById('daily-queue-badge');
    const folders = document.querySelectorAll('.subject-folder');
    if (btn) btn.classList.remove('active');
    if (badge) badge.style.display = 'none';
    folders.forEach(f => f.style.opacity = '1');
    const allPill = document.querySelector('.emf-pill-group[data-emf-filter="status"] .matrix-pill[data-emf-value="all"]');
    if (allPill) allPill.classList.add('active');
    const statusCarrier = document.getElementById('filter-status');
    if (statusCarrier) statusCarrier.value = 'all';
    if (title) {
        const subj = AppState.currentErrorSubject;
        title.textContent = `${subj.charAt(0).toUpperCase() + subj.slice(1)} Matrix`;
    }
    renderErrorMatrixFromBank();
    filterErrors();
}

export function toggleDailyQueue() {
    _dailyQueueActive = !_dailyQueueActive;
    if (_dailyQueueActive) _showDailyQueue(); else _hideDailyQueue();
}

/** Force the queue ON (Daily Briefing landing) — never flips a stale toggle. */
export function activateDailyQueue() {
    if (_dailyQueueActive) return;
    _dailyQueueActive = true;
    _showDailyQueue();
}

function _getDailyQueueSnapshot() {
    const today = _todayKey();

    // ── Layer 0 — In-memory cache hit (already hydrated for today) ────────
    if (_dailyQueueSnapshot.date === today && Array.isArray(_dailyQueueSnapshot.ids)) {
        return _dailyQueueSnapshot.ids;
    }

    // ── Layer 1 — localStorage persistence hydration (cold-boot drift fix) ─
    // On a browser refresh the volatile in-memory snapshot is wiped, which
    // previously forced a fresh selection query and scrambled the queue mid-
    // day. Recover the locked-in ID list from localStorage so the queue stays
    // stable across page reloads within the same calendar day.
    if (typeof localStorage !== 'undefined') {
        try {
            const raw = localStorage.getItem(DAILY_QUEUE_LS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed &&
                    parsed.date === today &&
                    Array.isArray(parsed.ids) &&
                    parsed.ids.every(id => typeof id === 'string')) {
                    _dailyQueueSnapshot = { date: parsed.date, ids: parsed.ids };
                    return _dailyQueueSnapshot.ids;
                }
            }
        } catch (err) {
            // Corrupt / unparsable payload — fall through to a fresh build.
            console.warn('[matrix] daily-queue snapshot parse failed, regenerating:', err);
        }
    }

    // ── Layer 2 — Fresh selection pipeline ────────────────────────────────
    // Gather every historical error block, then PIPE the array through the
    // SR engine's strict due-status validator BEFORE sorting/chunking. Only
    // items whose `getDueStatus(q).status === 'ready'` (i.e. actively overdue
    // RIGHT NOW) are eligible — this forcefully isolates the queue from
    // 'scheduled' / 'due_soon' leakage.
    const allErrors = AppState.questionBank.filter(q =>
        q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong')
    );

    const readyErrors = allErrors.filter(q => {
        try {
            return getDueStatus(q).status === 'ready';
        } catch (err) {
            // Defensive: a malformed question must never crash the queue build.
            return false;
        }
    });

    const bySubject = { physics: [], maths: [], chemistry: [] };
    readyErrors.forEach(q => {
        // Canonical key (trim + alias map): a " Maths " question used to miss
        // the bucket here while matching everywhere else in the matrix.
        const subj = normSubjKey(q.subject);
        if (bySubject[subj]) bySubject[subj].push(q);
    });
    Object.keys(bySubject).forEach(subj => {
        // Weakest-memory-first with a Memory-Kernel tiebreak: among equally
        // fragile items (same ease factor), surface the one whose retrievability
        // has decayed FURTHEST — it is closest to being lost and cheapest to
        // save now (spacing effect works hardest near the verge of forgetting).
        bySubject[subj].sort((a, b) => {
            const efDiff = _numOr(a.easeFactor, 2.5) - _numOr(b.easeFactor, 2.5);
            if (efDiff !== 0) return efDiff;
            try { return currentRetrievability(a) - currentRetrievability(b); }
            catch (_) { return 0; }
        });
    });
    const ids = [
        ...bySubject.physics.slice(0, DAILY_QUEUE_LIMITS.physics),
        ...bySubject.maths.slice(0, DAILY_QUEUE_LIMITS.maths),
        ...bySubject.chemistry.slice(0, DAILY_QUEUE_LIMITS.chemistry),
    ].map(q => q.id.toString());

    // ── Commit to in-memory cache AND persistent localStorage layer ───────
    _dailyQueueSnapshot = { date: today, ids };

    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(
                DAILY_QUEUE_LS_KEY,
                JSON.stringify({ date: today, ids })
            );
        } catch (err) {
            // Quota exceeded / private mode — silently fall back to in-memory only.
            console.warn('[matrix] daily-queue snapshot persist failed:', err);
        }
    }

    return ids;
}

function _isCompletedToday(q) {
    if (!Array.isArray(q.historyLogs)) return false;
    const today = _todayKey();
    return q.historyLogs.some(log =>
        log && log.result === 'correct' && log.timestamp &&
        _todayKey(new Date(log.timestamp)) === today
    );
}

function _renderDailyQueueCards() {
    const c = document.getElementById('error-list-container');
    if (!c) return;

    const snapshotIds = _getDailyQueueSnapshot();
    const targets = snapshotIds
        .map(id => AppState.questionBank.find(q => q.id.toString() === id))
        .filter(Boolean);

    if (targets.length === 0) {
        c.innerHTML = `
            <div class="em-empty em-empty--queue">
                <div class="em-empty-icon" aria-hidden="true">⚡</div>
                <div class="em-empty-title">Queue's clear</div>
                <div class="em-empty-desc">Nothing is due right now across any subject. Fresh fix slots unlock tomorrow — or log a new mistake to queue it up.</div>
                <div class="em-empty-actions">
                    <button class="btn btn-primary" onclick="toggleDailyQueue()">Back to Matrix</button>
                </div>
            </div>`;
        return;
    }

    const bySubject = { physics: [], maths: [], chemistry: [] };
    targets.forEach(q => {
        const subj = _normSubj(q.subject);
        if (bySubject[subj]) bySubject[subj].push(q);
    });

    const subjectMeta = {
        physics:   { icon: '⚛️', label: 'Physics',   limit: DAILY_QUEUE_LIMITS.physics },
        maths:     { icon: '📐', label: 'Maths',     limit: DAILY_QUEUE_LIMITS.maths },
        chemistry: { icon: '🧪', label: 'Chemistry', limit: DAILY_QUEUE_LIMITS.chemistry },
    };

    // ── Batch: collect all HTML fragments into an array, then assign in a
    //    single innerHTML write. Avoids N sequential DOM mutations. ──
    const fragments = [];
    let currentSubject = null;
    targets.forEach(q => {
        const subjKey = _normSubj(q.subject);
        if (subjKey !== currentSubject) {
            currentSubject = subjKey;
            const meta = subjectMeta[currentSubject] || { icon: '📋', label: q.subject || currentSubject, limit: 0 };
            const subjItems = bySubject[currentSubject] || [];
            const doneCount = subjItems.filter(_isCompletedToday).length;
            const remaining = subjItems.length - doneCount;
            const allTracked = AppState.questionBank.filter(qq =>
                qq.errorReason && (qq.status === 'error' || qq.status === 'solved' || qq.status === 'wrong') &&
                _normSubj(qq.subject) === currentSubject
            ).length;
            const pct = subjItems.length > 0 ? Math.round((doneCount / subjItems.length) * 100) : 0;
            const progressTxt = remaining > 0
                ? `${doneCount}/${subjItems.length} done · ${remaining} to go`
                : (subjItems.length > 0 ? `${doneCount}/${subjItems.length} done · ✓ complete` : '0/0');
            fragments.push(`
                <div class="daily-queue-subject-divider" data-subject="${currentSubject}">
                    <span class="dqs-label">${meta.icon} ${meta.label}</span>
                    <span class="dqs-track" aria-hidden="true"><i style="width:${pct}%"></i></span>
                    <span class="dqs-count">${progressTxt}</span>
                    <span class="daily-queue-subject-count">${allTracked} tracked</span>
                </div>
            `);
        }
        let cardHtml = _buildErrorCardHTML(q);
        if (_isCompletedToday(q)) {
            // Inject the done class directly into the HTML string
            cardHtml = cardHtml.replace('class="error-block ', 'class="error-block daily-queue-done ');
        }
        fragments.push(cardHtml);
    });

    c.innerHTML = fragments.join('');

    if (typeof initErrorLazyLoaders === 'function') initErrorLazyLoaders();
}

// ==================== CARD HTML BUILDER ====================

function _buildErrorCardHTML(q) {
    const tagStyle = TAG_STYLES[q.errorReason] || TAG_STYLES.conceptual;
    const tagLabel = TAG_LABELS[q.errorReason] || q.errorReason;
    const dueInfo = getDueStatus(q);

    // ALWAYS render a lightweight placeholder — the real image (from the
    // in-memory bank or Drive) is swapped in by initErrorLazyLoaders() only
    // while the card is near the viewport, and swapped back out (freed) once
    // it scrolls past. Embedding hundreds of base64 blobs into card HTML at
    // once was the source of the DOM bloat / heavy lag.
    let imgHtml = '';
    if ((q.imageDataUrl && q.imageDataUrl.length > 100) || q.driveImageId) {
        imgHtml = `<img class="lazy-error-img" data-drive-id="${_esc(q.driveImageId || '')}" data-qid="${_esc(q.id)}" src="${LAZY_IMG_PLACEHOLDER}" onclick="event.stopPropagation();">`;
    } else if (q.diagramImageUrl && q.diagramImageUrl.length > 100) {
        // Gem auto-crop diagram (no whole-question screenshot on file) — the
        // lazy loader serves it from the bank's diagramImageUrl.
        imgHtml = `<img class="lazy-error-img" data-diagram="1" data-qid="${_esc(q.id)}" src="${LAZY_IMG_PLACEHOLDER}" title="Diagram" onclick="event.stopPropagation();">`;
    } else {
        imgHtml = '<div class="error-img-none">No image</div>';
    }

    const today = _todayKey();
    const isCurrentBounty = AppState.bounty.active && !AppState.bounty.done && AppState.bounty.date === today &&
        String(q.id) === String(AppState.bounty.questionId);
    let bountyClass = isCurrentBounty ? 'bounty-active-error' : '';

    // Inline-handler args use _jsId (percent-encoded): _esc alone survives the
    // attribute boundary but is HTML-decoded before the handler compiles, so a
    // quote in q.id could still break out into the JS string.
    return `
            <div class="error-block ${bountyClass}" id="err-block-${_jsId(q.id)}"
                 data-type="${_esc(q.errorReason || 'conceptual')}"
                 data-sr-status="${_esc(dueInfo.status)}"
                 data-subject="${_esc(q.subject)}"
                 onclick="openPracticeDrawer('${_jsId(q.id)}')" title="Open practice session">
                <div class="error-img-box">
                    ${imgHtml}
                    <span class="sr-due-badge sr-due--${_esc(dueInfo.status)}" title="Spaced-repetition schedule for this mistake">${_esc(_dueLabel(dueInfo))}</span>
                </div>
                <div class="error-details">
                    <div class="error-chapter">${_esc(q.chapter || 'Unknown')}</div>
                    <div class="error-tag-row">
                        <span class="error-tag error-tag--${_esc(q.errorReason || 'conceptual')}" style="color:${tagStyle.color};background:${tagStyle.bg};">${_esc(tagLabel)}</span>
                    </div>
                    <div class="sr-stats-row">
                        <span class="sr-stat" title="Spaced-repetition interval — how long this memory currently survives"><b>${_numOr(q.currentInterval, 0)}d</b><i>interval</i></span>
                        <span class="sr-stat" title="Ease factor — higher means recall is sticking"><b>${_numOr(q.easeFactor, 2.5).toFixed(2)}</b><i>ease</i></span>
                        <span class="sr-stat" title="Target time per attempt"><b>${_numOr(q.targetTimeMins, 5)}m</b><i>target</i></span>
                    </div>
                    <div class="sr-attempt-dots-row">
                        <span class="sr-dots-label">History</span>
                        ${_buildAttemptDots(q.historyLogs)}
                    </div>
                </div>
                <div class="sr-card-actions">
                    <button class="sr-practice-btn" onclick="openPracticeDrawer('${_jsId(q.id)}')">Practice Now<span class="sr-btn-arrow">→</span></button>
                    <div class="sr-card-actions-sub">
                        <button class="sr-history-toggle" onclick="event.stopPropagation();toggleCardHistory('${_jsId(q.id)}')" aria-label="Toggle attempt history">
                            History
                            <span class="sr-chevron" id="sr-chevron-${_jsId(q.id)}">▾</span>
                        </button>
                        <button class="delete-btn" onclick="event.stopPropagation();removeErrorLog('${_jsId(q.id)}')" title="Delete" aria-label="Delete this mistake">🗑</button>
                    </div>
                </div>
                <div class="sr-expanded-history" id="sr-history-${_jsId(q.id)}" style="display:none;" onclick="event.stopPropagation();">
                    <div class="sr-history-header">Attempt History</div>
                    ${_buildHistoryLogs(q.historyLogs)}
                </div>
            </div>`;
}

// ── Add Error (manual) ─────────────────────────────────────────────────────

export function addErrorBlock() {
    const chapter = document.getElementById('new-err-chapter').value || 'Uncategorized';
    const typeValue = document.getElementById('new-err-type').value;

    const newErrorQ = {
        id: 'err-manual-' + Date.now(),
        subject: AppState.currentErrorSubject,
        chapter: chapter,
        imageDataUrl: AppState.newErrorPicData || null,
        diagramImageUrl: null,
        extractedText: "Manual Logged Friction Point",
        options: [],
        correctAnswer: "",
        type: "text",
        status: 'error',
        errorReason: typeValue,
        timeTaken: 0,
        solution: "",
        currentInterval: 0,
        easeFactor: 2.5,
        nextReviewAt: new Date().toISOString(),
        targetTimeMins: 5,
        isMastered: false,
        historyLogs: [],
        // qElo schema — stamped at creation so a same-session drawer solve
        // routes through the engine identically to a post-reload one
        // (migrateQuestionBankSR would otherwise backfill these on next load).
        qElo: 1200,
        qEloSource: 'uncalibrated',
        qEloStampedBy: null,
        qEloStampedAt: null,
        solveCount: 0,
    };

    AppState.questionBank.push(newErrorQ);
    saveAllAsync().catch(console.error);

    document.getElementById('new-err-chapter').value = '';
    AppState.newErrorPicData = "";
    const successEl = document.getElementById('err-img-success');
    if (successEl) successEl.style.display = 'none';
    // Saved successfully — the draft mirror has served its purpose.
    try { localStorage.removeItem(ADD_ERR_DRAFT_KEY); } catch (_) {}

    _closeModalStr('add-error-modal');
    // Defer heavy DOM rebuilds so the modal close transition completes first
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            renderErrorMatrixFromBank();
            filterErrors();
            try { renderChapterDecayGrid(); } catch (_) {}
        });
    });
}

// ==================== CARD RENDERING ====================

const TAG_STYLES = {
    calculation: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
    conceptual:  { color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
    misread:     { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)' },
};

const TAG_LABELS = {
    calculation: 'Calculation Error',
    conceptual:  'Conceptual Gap',
    misread:     'Misread Constraint',
};

// Plain-language due badge. One glance → "do I need to act on this?"
// Vocabulary matches the filter pills exactly: Due now / Due soon / Later / Mastered.
function _dueLabel(dueInfo) {
    switch (dueInfo && dueInfo.status) {
        case 'ready':     return 'Due now';
        case 'due_soon':  return 'Due in ' + (dueInfo.daysUntil ?? '?') + 'd';
        case 'scheduled': return 'In ' + (dueInfo.daysUntil ?? '?') + 'd';
        case 'mastered':  return 'Mastered';
        default:          return (dueInfo && dueInfo.label) || '';
    }
}

function _buildAttemptDots(historyLogs) {
    if (!historyLogs || historyLogs.length === 0) return '<span class="sr-dots-empty">No attempts yet</span>';

    const last5 = historyLogs.slice(-5).reverse();
    return last5.map(log => {
        const isCorrect = log.result === 'correct';
        const frictionTypes = _parseFrictionTypes(log.frictionTypes);
        const primaryFriction = frictionTypes[0] || 'N/A';
        const frictionLabel = SR_FRICTION_LABELS[primaryFriction] || primaryFriction;
        const ts = new Date(log.timestamp);
        const dateStr = isNaN(ts.getTime()) ? 'unknown date' : formatSRDate(log.timestamp);
        const timeStr = log.timeSpentMins + 'm';
        const tooltip = `title="${_esc(dateStr + '\\nTime: ' + timeStr + '\\nFriction: ' + frictionLabel)}"`;

        return `<div class="sr-attempt-dot ${isCorrect ? 'is-correct' : 'is-wrong'}" ${tooltip}></div>`;
    }).join('');
}

function _buildHistoryLogs(historyLogs) {
    if (!historyLogs || historyLogs.length === 0) return '';

    return historyLogs.slice().reverse().map(log => {
        const isCorrect = log.result === 'correct';
        const frictionTypes = _parseFrictionTypes(log.frictionTypes);
        const ts = new Date(log.timestamp);
        const dateStr = isNaN(ts.getTime())
            ? 'unknown date'
            : ts.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

        const frictionPills = frictionTypes.map(f =>
            `<span class="sr-log-friction-tag">${_esc(SR_FRICTION_LABELS[f] || f)}</span>`
        ).join('');

        return `
            <div class="sr-history-row">
                <div class="sr-history-dot ${isCorrect ? 'is-correct' : 'is-wrong'}"></div>
                <div class="sr-history-info">
                    <div class="sr-history-top">
                        <span class="${isCorrect ? 'is-correct' : 'is-wrong'}">${isCorrect ? 'Correct' : 'Incorrect'}</span>
                        <span class="sr-sep">·</span>
                        <span style="color:#888;">${_esc((log.autonomy || '').replace('_', ' '))}</span>
                    </div>
                    <div class="sr-history-frictions">${frictionPills}</div>
                </div>
                <div class="sr-history-meta">
                    <div style="color:#666;">${dateStr}</div>
                    <div style="color:#555;">${log.timeSpentMins}m · EF ${_numOr(log.newEaseFactor, 2.5).toFixed(2)}</div>
                </div>
            </div>
        `;
    }).join('');
}

export function renderErrorMatrixFromBank() {
    let c = document.getElementById('error-list-container');
    if (!c) return;

    let errs = AppState.questionBank.filter(q =>
        q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong') && _normSubj(q.subject) === _normSubj(AppState.currentErrorSubject)
    );

    _updateFolderCounts();

    // ── Batch: build all card HTML up front, then apply in a single innerHTML
    //    assignment. This collapses N individual DOM parse+insert cycles into
    //    one, which is critical when the matrix has dozens of cards. ──
    if (errs.length === 0) {
        // DMMT: an empty subject never renders as blank confusion — it explains
        // itself and offers the two ways forward (manual log / AI dump).
        c.innerHTML = _buildEmptyStateHTML();
    } else {
        c.innerHTML = _buildGroupedBoardHTML(errs);
    }

    if (typeof initErrorLazyLoaders === 'function') initErrorLazyLoaders();
}

// ── Status-grouped board ───────────────────────────────────────────────────
// The matrix is a BOARD, not a flat dump: cards are sorted by urgency and
// grouped under scannable section headers. One glance answers "what do I
// work through, in what order, and how much of it is there?"
const EM_STATUS_ORDER = { ready: 0, due_soon: 1, scheduled: 2, mastered: 3 };
const EM_GROUP_META = {
    ready:     { icon: '🟢', label: 'Due Now',  blurb: 'act on these today' },
    due_soon:  { icon: '⏳', label: 'Due Soon', blurb: 'within 3 days' },
    scheduled: { icon: '🗓️', label: 'Later',   blurb: 'parked in memory' },
    mastered:  { icon: '💤', label: 'Mastered', blurb: 'resting — no action needed' },
};

function _buildGroupedBoardHTML(errs) {
    const withStatus = errs.map(q => ({ q, st: getDueStatus(q).status }));
    withStatus.sort((a, b) => {
        const sa = EM_STATUS_ORDER[a.st] ?? 9;
        const sb = EM_STATUS_ORDER[b.st] ?? 9;
        if (sa !== sb) return sa - sb;
        return _numOr(a.q.easeFactor, 2.5) - _numOr(b.q.easeFactor, 2.5);
    });

    const countByStatus = {};
    withStatus.forEach(x => { countByStatus[x.st] = (countByStatus[x.st] || 0) + 1; });

    const parts = [];
    let lastStatus = null;
    for (const { q, st } of withStatus) {
        if (st !== lastStatus) {
            lastStatus = st;
            const meta = EM_GROUP_META[st] || { icon: '•', label: st, blurb: '' };
            parts.push(
                '<div class="em-group-head em-group--' + st + '" data-group-status="' + st + '">' +
                    '<span class="emg-dot" aria-hidden="true"></span>' +
                    '<span class="emg-label">' + meta.icon + ' ' + meta.label + '</span>' +
                    '<span class="emg-count">' + (countByStatus[st] || 0) + '</span>' +
                    '<span class="emg-rule" aria-hidden="true"></span>' +
                    '<span class="emg-blurb">' + meta.blurb + '</span>' +
                '</div>'
            );
        }
        parts.push(_buildErrorCardHTML(q));
    }
    return parts.join('');
}

// ── Guided empty state (subject matrix) ────────────────────────────────────
function _buildEmptyStateHTML() {
    return `
            <div class="em-empty">
                <div class="em-empty-icon" aria-hidden="true">🗂️</div>
                <div class="em-empty-title">No mistakes tracked here yet</div>
                <div class="em-empty-desc">Every wrong answer is a lever. Log one and the spaced-repetition engine will resurface it until it's dead.</div>
                <div class="em-empty-actions">
                    <button class="btn btn-primary" onclick="openModal('add-error-modal')">+ Log First Mistake</button>
                    <button class="em-empty-secondary" onclick="window.populateAiDumpChapters();openModal('ai-dump-modal')">🧠 AI Dump</button>
                </div>
            </div>`;
}

// ── Per-subject tracked counts on the folder cards ─────────────────────────
// One glance answers "where does my error load live?" without opening each folder.
function _updateFolderCounts() {
    const counts = { physics: 0, chemistry: 0, maths: 0 };
    for (const q of AppState.questionBank) {
        if (!q.errorReason || !(q.status === 'error' || q.status === 'solved' || q.status === 'wrong')) continue;
        const k = _normSubj(q.subject);
        if (k in counts) counts[k]++;
    }
    const idBySubj = { physics: 'folder-count-physics', chemistry: 'folder-count-chemistry', maths: 'folder-count-maths' };
    for (const subj of Object.keys(idBySubj)) {
        const el = document.getElementById(idBySubj[subj]);
        if (!el) continue;
        el.textContent = String(counts[subj]);
        el.classList.toggle('is-zero', counts[subj] === 0);
    }
}

export function toggleCardHistory(qId) {
    const el = document.getElementById(`sr-history-${qId}`);
    const chevron = document.getElementById(`sr-chevron-${qId}`);
    if (!el) return;
    const isVisible = el.style.display !== 'none';
    el.style.display = isVisible ? 'none' : 'block';
    if (chevron) chevron.style.transform = isVisible ? '' : 'rotate(180deg)';
}

// ==================== LAZY LOADING ====================

waitForDriveToken(() => {
    if (typeof initErrorLazyLoaders === 'function') initErrorLazyLoaders();
});

// Tiny SVG used both as the initial placeholder AND as the "unloaded" state
// for cards that have scrolled out of the viewport (frees the decoded bitmap).
// Fully-encoded data URI (raw `<`, `>`, `#` inside a src attribute are fragile).
const LAZY_IMG_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='90'%3E%3Crect width='100%25' height='100%25' fill='%2312121a'/%3E%3Ctext x='50%25' y='50%25' fill='%23444a6a' font-family='sans-serif' font-size='11' text-anchor='middle' dominant-baseline='middle'%3ELoading%E2%80%A6%3C/text%3E%3C/svg%3E";

let _errorImgObserver = null;

export function initErrorLazyLoaders() {
    // Recreate a fresh observer per render (releases detached cards from the
    // previous list — no observer leak across innerHTML wipes).
    if (_errorImgObserver) _errorImgObserver.disconnect();
    _errorImgObserver = new IntersectionObserver((entries) => {
        entries.forEach(async entry => {
            const img = entry.target;
            const qId = img.getAttribute('data-qid');
            const driveId = img.getAttribute('data-drive-id');

            if (entry.isIntersecting) {
                // Already swapped in — nothing to do.
                if (img.dataset.loaded === '1') return;
                // Token guard: if the card is unloaded (or re-rendered) while
                // a slow Drive fetch is in flight, the token changes → bail,
                // so we never resurrect an off-screen image with a base64 blob.
                const token = (img._lazyToken = (img._lazyToken || 0) + 1);
                const isDiagram = img.getAttribute('data-diagram') === '1';
                // 1) Serve from the in-memory bank first (instant, offline-safe).
                let base64 = null;
                const q = AppState.questionBank.find(x => String(x.id) === String(qId));
                if (q && !isDiagram && q.imageDataUrl && q.imageDataUrl.length > 100) base64 = q.imageDataUrl;
                if (q && isDiagram && q.diagramImageUrl && q.diagramImageUrl.length > 100) base64 = q.diagramImageUrl;
                // 2) Fall back to Drive only when no local copy exists.
                if (!base64 && !isDiagram && driveId && AppState.driveAccessToken) {
                    try { base64 = await fetchMediaFromDrive(driveId, AppState.driveAccessToken); }
                    catch(e) { console.error("Lazy load failed", e); }
                }
                if (!base64 || img._lazyToken !== token || !img.isConnected) return;
                img.src = base64;
                img.onclick = () => openLightbox(base64);
                img.dataset.loaded = '1';
                if (q && !isDiagram && !q.imageDataUrl) q.imageDataUrl = base64;
            } else if (img.dataset.loaded === '1') {
                // Scrolled past → free the decoded bitmap. Reload is instant
                // from the in-memory bank when the card scrolls back.
                img._lazyToken = (img._lazyToken || 0) + 1;
                img.dataset.loaded = '';
                img.src = LAZY_IMG_PLACEHOLDER;
                img.onclick = (e) => e.stopPropagation();
            }
        });
    }, { rootMargin: '200px 0px 800px 0px' });   // on-screen + a few below (seamless scroll)
    document.querySelectorAll('.lazy-error-img').forEach(img => _errorImgObserver.observe(img));
}

export function openLightbox(src) {
    document.getElementById('lightbox-img').src = src;
    _openModal('lightbox-modal');
}

// ==================== SVG CHAPTER DECAY GRID ====================

/**
 * Continuous Non-Linear Biological Memory Construct — local chapter-health
 * mirror for the Chapter Decay Grid.
 *
 * Mirrors app.js's `_getChapterHealth` math EXACTLY (Bjork's New Theory of
 * Disuse: exponential Retrieval Strength decay + difficulty-weighted harmonic
 * accessibility mean). Kept local to matrix.js to avoid a circular module
 * dependency on app.js (app.js already imports matrix.js). The formula is
 * identical so the grid, the cat-banner scanner, and the Elo engine all
 * evaluate the same continuous percentage — no divergence between the
 * visual, monitoring, and scoring layers.
 *
 *   RS_i(t) = e ^ ( -ln(2) · (Δt / S_i) )
 *   A_ch(t) = ( Σ Q_Elo,i · RS_i(t) ) / ( Σ Q_Elo,i ) · 100
 *
 * JIT-hydrates `easeFactor` / `qElo` / `lastReviewedAt` per the legacy
 * backward-compatibility blueprint (read-only; never mutates the source).
 */
function _matrixChapterHealthContinuous(questions) {
    if (!questions || questions.length === 0) return 50;
    // DELEGATED to the Memory Kernel v2 (memory.js) — the SAME power-law
    // retrievability model app.js's _getChapterHealth now uses. One source of
    // truth: the grid, the cat-banner scanner, the Daily Briefing and the Elo
    // engine all evaluate the identical continuous percentage.
    try {
        const stats = chapterMemoryStats(questions, { nowMs: Date.now() });
        if (!stats) return 50;
        return Math.max(10, Math.min(100, stats.health));
    } catch (_) { return 50; }
}

// Exposed for the Daily Briefing flow — the SAME health model the Chapter
// Health Grid renders, so the boot flow's "weakest chapter first" ordering
// always matches what the user sees in-app (no divergent reimplementation).
window.getChapterHealth = (subject, chapter) => {
    try {
        const qs = AppState.questionBank.filter(q =>
            q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong') &&
            _normSubj(q.subject) === _normSubj(subject) && q.chapter === chapter
        );
        return _matrixChapterHealthContinuous(qs);
    } catch (_) { return 50; }
};

// Exposed for the Daily Briefing flow — the locked-in Daily Fix Queue in
// priority order (ready errors, weakest easeFactor first, 5P/5M/10C). The
// boot flow feeds this order straight into the practice queue.
window._getDailyQueueSnapshot = () => {
    try { return _getDailyQueueSnapshot(); } catch (_) { return []; }
};

const MS_PER_DAY = 86400000;

// Previous-render health per chapter key — powers the ↑/↓ trend arrows.
// Module-scoped (resets on boot by design: trends compare within a session).
const _decayTrendCache = new Map();

function _examDateMsSafe() {
    try {
        const raw = AppState.examDate;
        if (!raw) return null;
        const t = new Date(raw).getTime();
        return isNaN(t) ? null : t;
    } catch (_) { return null; }
}

export function renderChapterDecayGrid() {
    const container = document.getElementById('chapter-decay-grid');
    if (!container) return;
    const allErrors = AppState.questionBank.filter(q =>
        q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong')
    );
    const chapterMap = {};
    allErrors.forEach(q => {
        const subject = q.subject || '';
        const chapter = q.chapter || 'Uncategorized';
        const key = subject + '||' + chapter;
        if (!chapterMap[key]) chapterMap[key] = { name: chapter, subject, questions: [] };
        chapterMap[key].questions.push(q);
    });

    // Coverage denominators: EVERY registered bank question per chapter, so
    // untouched chapters are visible as 0% attempted instead of invisible.
    const covTotals = {};
    AppState.questionBank.forEach(q => {
        const key = (q.subject || '') + '||' + String(q.chapter || 'Uncategorized').trim().toLowerCase();
        covTotals[key] = (covTotals[key] || 0) + 1;
    });

    const examMs = _examDateMsSafe();

    const chapters = Object.values(chapterMap).map(({ name, subject, questions }) => {
        const avgEF = questions.reduce((sum, q) => sum + _numOr(q.easeFactor, 2.5), 0) / questions.length;
        const stats = chapterMemoryStats(questions, { examDateMs: examMs, nowMs: Date.now() });
        const health = stats ? stats.health : 50;
        const forecast = stats ? stats.forecastHealth : null;
        const covKey = subject + '||' + String(name).trim().toLowerCase();
        const total = covTotals[covKey] || questions.length;
        const coverage = total > 0 ? questions.length / total : 1;
        // Exam-aware risk: JEE weightage × how much retention will be MISSING
        // at exam time (falls back to current health without an exam date).
        const weight = getChapterWeight(name);
        const retentionRef = (forecast != null) ? forecast : health;
        const risk = weight * (100 - Math.max(0, Math.min(100, retentionRef)));
        // Fluency: mean solve time vs the question's own band target — JEE Adv
        // is speed-under-pressure, so retention without fluency is half-blind.
        const timed = questions.filter(q => (Number(q.timeTaken) || 0) > 0 && _numOr(q.targetTimeMins, 0) > 0);
        const fluency = timed.length > 0
            ? timed.reduce((s, q) => s + (q.timeTaken / (_numOr(q.targetTimeMins, 5) * 60)), 0) / timed.length
            : null;
        const prev = _decayTrendCache.get(subject + '||' + name);
        const trend = (prev == null || Math.abs(prev - health) < 0.5) ? 0 : (health > prev ? 1 : -1);
        return { name, subject, health, forecast, stats, coverage, weight, risk, fluency, trend, questionCount: questions.length, avgEF };
    });
    // Most exam-dangerous chapter first.
    chapters.sort((a, b) => b.risk - a.risk);
    if (chapters.length === 0) {
        container.innerHTML = '<div class="rh-empty">No retention data yet — log errors and they will surface here.</div>';
        return;
    }

    // ── Render: “the ledger” — one whisper-thin gauge per chapter ─────────
    // Minimal rebuild: hairline rail, 2px retention stroke ending in ONE
    // quiet status dot, an --accent tick marking the exam-day projection,
    // large light numerals, generous rhythm. All color/theming flows through
    // CSS custom properties consumed in styles-retention.css; container
    // queries handle every width (no JS measuring).
    const COLLAPSED_ROWS = 8;
    const expanded = container.dataset.expanded === '1';
    const shown = expanded ? chapters : chapters.slice(0, COLLAPSED_ROWS);
    const hiddenCount = Math.max(0, chapters.length - shown.length);

    const rowsHtml = shown.map((ch, i) => {
        const h = Math.max(0, Math.min(100, ch.health));
        const band = h >= 90 ? 'ready' : (h >= 80 ? 'fading' : 'critical');
        const covPct = Math.round(Math.max(0, Math.min(1, ch.coverage)) * 100);
        const fc = (examMs != null && ch.forecast != null)
            ? Math.max(0, Math.min(100, ch.forecast)) : null;
        // Horizon: days until weighted retention crosses the critical line.
        let horizonTxt = '—', horizonCls = '';
        if (ch.stats && isFinite(ch.stats.criticalDays)) {
            const d = ch.stats.criticalDays;
            if (d <= 0) { horizonTxt = 'now'; horizonCls = 'is-now'; }
            else if (d <= 45) { horizonTxt = Math.ceil(d) + 'd'; horizonCls = 'is-soon'; }
            else horizonTxt = Math.ceil(d) + 'd';
        }
        const trend = ch.trend > 0 ? '<i class="rh-trend rh-up">↑</i>'
            : (ch.trend < 0 ? '<i class="rh-trend rh-dn">↓</i>' : '');
        return `<div class="rh-row rh-${band}" style="--i:${i}" role="button" tabindex="0"
                 data-subject="${_esc(encodeURIComponent(ch.subject || ''))}"
                 data-chapter="${_esc(encodeURIComponent(ch.name || ''))}"
                 aria-label="${_esc(ch.name)}: ${Math.round(h)} percent retention"
                 title="${_esc(ch.name)} — retention ${Math.round(h)}% · coverage ${covPct}% · ${ch.questionCount} items · tap for item decay"
><span class="rh-name">${_esc(ch.name)}</span><span class="rh-gauge" aria-hidden="true"><i class="rh-cov" style="width:${covPct}%"></i><i class="rh-line" style="width:${h.toFixed(1)}%"></i>${fc != null ? `<i class="rh-fc" style="left:${fc.toFixed(1)}%"></i>` : ''}<i class="rh-dot" style="left:${h.toFixed(1)}%"></i></span><span class="rh-val">${Math.round(h)}<em>%</em>${trend}</span><span class="rh-hz ${horizonCls}">${_esc(horizonTxt)}</span></div>`;
    }).join('');

    // Commit this render's health values as the next trend baseline.
    chapters.forEach(ch => { _decayTrendCache.set(ch.subject + '||' + ch.name, ch.health); });

    container.innerHTML = `
        <div class="rh-ledger">
            <div class="rh-head" aria-hidden="true">
                <span>Chapter</span>
                <span class="rh-head-g">Retention<i>tick · exam day</i></span>
                <span class="rh-head-r">Health</span>
                <span class="rh-head-r rh-head-hz">Critical in</span>
            </div>
            ${rowsHtml}
        </div>
        ${hiddenCount > 0 ? `<button type="button" class="rh-more">${expanded ? 'Show fewer' : '+' + hiddenCount + ' more'}</button>` : ''}`;

    // One delegated listener per page life: rows open the item drilldown
    // (data attrs instead of inline onclick → any character in a chapter
    // name is safe), and the expander toggles full list vs top-risk slice.
    if (!container.__rhWired) {
        container.__rhWired = true;
        container.addEventListener('click', (e) => {
            const more = e.target.closest('.rh-more');
            if (more) {
                container.dataset.expanded = container.dataset.expanded === '1' ? '0' : '1';
                renderChapterDecayGrid();
                return;
            }
            const row = e.target.closest('.rh-row');
            if (row) window.openDecayDrilldown(row.dataset.subject, row.dataset.chapter);
        });
        container.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const row = e.target.closest('.rh-row');
            if (row) { e.preventDefault(); row.click(); }
        });
    }
}

// ── Item-level decay drilldown ────────────────────────────────────────────────
// Tapping a grid row opens a floating panel listing the chapter's vault items
// weakest-retrieval-first with a 60-day R(t) sparkline (30d past + projection).
let _decayDrillStylesInjected = false;

function _injectDecayDrilldownStyles() {
    if (_decayDrillStylesInjected) return;
    _decayDrillStylesInjected = true;
    const style = document.createElement('style');
    style.id = 'decay-drill-styles';
    style.textContent = `
.decay-drill-overlay {
  position: fixed; inset: 0; z-index: 99998;
  background: rgba(6,8,14,0.72); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  animation: ddFade .18s ease;
}
@keyframes ddFade { from { opacity: 0; } to { opacity: 1; } }
.decay-drill-panel {
  width: min(560px, calc(100vw - 32px)); max-height: min(78vh, 640px);
  background: linear-gradient(160deg,#18181b,#12121a);
  border: 1px solid rgba(61,220,255,0.28); border-radius: 18px;
  box-shadow: 0 24px 80px rgba(0,0,0,.65);
  display: flex; flex-direction: column; overflow: hidden;
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: #e8eefb;
}
.decay-drill-head { padding: 14px 18px 10px; border-bottom: 1px solid rgba(255,255,255,0.07); display: flex; align-items: baseline; gap: 10px; }
.decay-drill-title { font-family:'Space Grotesk',monospace; font-weight:700; font-size:15px; letter-spacing:.3px; }
.decay-drill-sub { font-size: 11px; color: #8aa0c8; margin-left: auto; text-align: right; }
.decay-drill-close { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); color:#e8eefb; border-radius: 8px; width:26px; height:26px; cursor:pointer; font-size:12px; flex: none; align-self: center; }
.decay-drill-list { overflow-y: auto; padding: 8px 12px 14px; }
.decay-item { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-bottom: 1px solid rgba(255,255,255,0.04); }
.decay-item:last-child { border-bottom: none; }
.dd-r { font-family:'Space Grotesk',monospace; font-weight:700; font-size:13px; width:44px; flex:none; text-align:right; }
.dd-spark { flex:none; }
.dd-meta { font-size: 10.5px; color:#8aa0c8; line-height: 1.45; }
.dd-meta b { color:#cdd9f2; font-weight:600; }
`;
    document.head.appendChild(style);
}

function _decaySparkline(q, examMs) {
    try {
        const mem = hydrateMemory(q);
        const W = 92, H = 22, SAMPLES = 22;
        const now = Date.now();
        const pastMs = now - 30 * MS_PER_DAY;
        const projDays = (examMs && examMs > now)
            ? Math.min(120, (examMs - now) / MS_PER_DAY)
            : 30;
        const endMs = now + projDays * MS_PER_DAY;
        const pts = [];
        for (let i = 0; i < SAMPLES; i++) {
            const t = pastMs + (i / (SAMPLES - 1)) * (endMs - pastMs);
            const deltaDays = isNaN(mem.lastMs) ? 0 : Math.max(0, (t - mem.lastMs) / MS_PER_DAY);
            const r = retrievabilityFrom(mem.stability, deltaDays);
            const x = ((t - pastMs) / (endMs - pastMs)) * W;
            const y = H - 2 - r * (H - 4);
            pts.push(x.toFixed(1) + ',' + y.toFixed(1));
        }
        const lastMsX = ((Math.min(now, mem.lastMs || pastMs) - pastMs) / (endMs - pastMs)) * W;
        return '<svg class="dd-spark" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
            '<line x1="0" y1="' + (H - 2 - 0.8 * (H - 4)) + '" x2="' + W + '" y2="' + (H - 2 - 0.8 * (H - 4)) + '" stroke="rgba(255,255,255,0.08)" stroke-dasharray="2 3"/>' +
            '<line x1="' + lastMsX.toFixed(1) + '" y1="0" x2="' + lastMsX.toFixed(1) + '" y2="' + H + '" stroke="rgba(61,220,255,0.35)" stroke-width="1"/>' +
            '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#38bdf8" stroke-width="1.6" stroke-linejoin="round"/>' +
            '</svg>';
    } catch (_) { return ''; }
}

export function openDecayDrilldown(subjectEnc, chapEnc) {
    let subject = '', chapterName = '';
    try { subject = decodeURIComponent(subjectEnc || ''); } catch (_) { subject = subjectEnc || ''; }
    try { chapterName = decodeURIComponent(chapEnc || ''); } catch (_) { chapterName = chapEnc || ''; }
    const norm = (v) => String(v || '').trim().toLowerCase();
    const items = AppState.questionBank.filter(q =>
        q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong') &&
        norm(q.subject) === norm(subject) && String(q.chapter || 'Uncategorized').trim().toLowerCase() === norm(chapterName)
    );
    if (!items.length) return;
    items.forEach(q => { try { q.__R = currentRetrievability(q); } catch (_) { q.__R = 0; } });
    items.sort((a, b) => a.__R - b.__R);

    _injectDecayDrilldownStyles();
    const examMs = _examDateMsSafe();
    // Chapter ability (θ_c) vs the chapter's item difficulty — "how you stack
    // up HERE", which subject Elo alone cannot answer.
    let thetaTxt = '';
    try {
        const th = window.getChapterTheta(subject, chapterName);
        const avgQ = items.reduce((s, q) => s + (Number(q.qElo) || 1200), 0) / items.length;
        const diff = Math.round(th.theta - avgQ);
        thetaTxt = ' · you ' + th.theta + ' (' + (diff >= 0 ? '+' : '') + diff + ' vs items)';
    } catch (_) {}
    // Weightage provenance — show WHY this chapter carries its risk weight.
    // Silent magic numbers are how trust dies; niche/renamed chapters show the
    // tier that resolved them (alias / typo-corrected / unit estimate / AI).
    let weightTxt = '';
    try {
        const wi = resolveChapterWeightInfo(chapterName);
        const srcLabel = { user: 'your override', exact: 'table', ai: 'AI-stamped', alias: 'matched', match: 'matched', typo: 'typo-corrected', unit: 'unit estimate', default: 'unknown — assumed' }[wi.source] || wi.source;
        weightTxt = ' · weight ' + wi.weight.toFixed(2) + ' (' + srcLabel + (wi.matched ? ': ' + wi.matched : '') + ')';
    } catch (_) {}

    const rows = items.slice(0, 60).map(q => {
        const rpct = Math.round((q.__R || 0) * 100);
        const col = rpct >= 90 ? '#22c55e' : (rpct >= 80 ? '#eab308' : '#ef4444');
        const rel = (() => {
            try {
                const t = new Date(q.lastReviewedAt || q.lastSolvedAt).getTime();
                if (isNaN(t)) return 'never';
                const d = Math.floor((Date.now() - t) / MS_PER_DAY);
                return d <= 0 ? 'today' : d + 'd ago';
            } catch (_) { return 'never'; }
        })();
        return '<div class="decay-item">' +
            '<div class="dd-r" style="color:' + col + '">' + rpct + '%</div>' +
            _decaySparkline(q, examMs) +
            '<div class="dd-meta"><b>S</b> ' + Number(q.stability || 0).toFixed(1) + 'd' +
            ' · <b>D</b> ' + Number(q.difficultyD || 0).toFixed(1) +
            ' · <b>' + (q.lapses || 0) + '</b>L/<b>' + (q.reps || 0) + '</b>R' +
            ' · EF ' + _numOr(q.easeFactor, 2.5).toFixed(2) +
            ' · ' + _esc(rel) + '</div>' +
            '</div>';
    }).join('');

    document.querySelectorAll('.decay-drill-overlay').forEach(o => o.remove());
    const overlay = document.createElement('div');
    overlay.className = 'decay-drill-overlay';
    overlay.innerHTML =
        '<div class="decay-drill-panel" role="dialog" aria-label="Item decay drilldown">' +
        '<div class="decay-drill-head">' +
        '<span class="decay-drill-title">🧠 ' + _esc(chapterName) + '</span>' +
        '<span class="decay-drill-sub">' + items.length + ' tracked items · weakest first' + (examMs ? ' · projected to exam' : '') + _esc(thetaTxt) + '</span>' +
        '<div style=\'width:100%; font-size:10px; color:#8aa0c8; margin-top:2px;\'><span id=\'dd-weight-line\'>' + _esc(weightTxt) + '</span>' +
        '<button id=\'dd-weight-edit\' type=\'button\' style=\'margin-left:8px; background:none; border:none; color:#38bdf8; cursor:pointer; font-size:10px; padding:0;\'>✎ edit</button></div>' +
        '<button class="decay-drill-close" type="button" aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="decay-drill-list">' + rows + '</div>' +
        '</div>';
    const close = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    // ✎ edit → user override tier. Blank input clears back to automatic
    // resolution. Grid re-renders so risk ordering reflects the correction.
    const editBtn = overlay.querySelector('#dd-weight-edit');
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            let cur = 0.5;
            try { cur = resolveChapterWeightInfo(chapterName).weight; } catch (_) {}
            const inp = prompt('Exam weight for "' + chapterName + '"\n(0 to 1.5 — e.g. 1.0 = highest yield; blank = auto)', cur.toFixed(2));
            if (inp === null) return;
            const trimmed = inp.trim();
            const num = Number(trimmed);
            setChapterWeightOverride(chapterName, trimmed === '' ? null : (isFinite(num) && num > 0 ? num : null));
            try { renderChapterDecayGrid(); } catch (_) {}
            close();
            try { window.openDecayDrilldown(encodeURIComponent(subject), encodeURIComponent(chapterName)); } catch (_) {}
        });
    }
    overlay.querySelector('.decay-drill-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
}
window.openDecayDrilldown = openDecayDrilldown;

// ── Dashboard card: per-chapter completion, weakest first ──────────────────
// Mirrors the practice view's completion definition (app.js stats-row):
// progress = questions with status 'solved' / all questions in the chapter.
// Every registered chapter appears — untouched ones (0%) rise to the top.
//
// Visual language: a quiet ledger (styles-chapters.css). Fresh 'cpx-*'
// namespace — the global .cp-* rules in styles.css belong to Checkpoint and
// are deliberately NOT reused here. One accent (--accent), reserved for the
// single weakest chapter; everything else stays near-monochrome ink.
const CPX_MAX_VISIBLE = 7;

export function renderChapterProgressList() {
    const container = document.getElementById('chapter-progress-list');
    if (!container) return;

    const SUBJ_META = { physics: 'P', chemistry: 'C', maths: 'M' };
    const match = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    const totals = {};
    const solvedCounts = {};

    // Keys are <canonicalSubject>::<encodeURIComponent(chapter)> — the old
    // subject+'||'+chapter join corrupted pairing whenever a chapter name
    // contained '||', and left raw subjects free to hit inline handlers.
    AppState.questionBank.forEach(q => {
        const key = normSubjKey(q.subject) + '::' + encodeURIComponent(q.chapter || '');
        totals[key] = (totals[key] || 0) + 1;
        if (q.status === 'solved') solvedCounts[key] = (solvedCounts[key] || 0) + 1;
    });

    const rows = [];
    ['physics', 'chemistry', 'maths'].forEach(subj => {
        (AppState.chapters[subj] || []).forEach(name => {
            const key = subj + '::' + encodeURIComponent(name);
            rows.push({ subj, name, total: totals[key] || 0, solved: solvedCounts[key] || 0 });
        });
    });

    // Self-heal: bank questions orphaned from the chapter list still get a row.
    Object.keys(totals).forEach(key => {
        const sep = key.indexOf('::');
        const subj = key.slice(0, sep);
        let name = '';
        try { name = decodeURIComponent(key.slice(sep + 2)); } catch (_) { name = key.slice(sep + 2); }
        if (!rows.some(r => r.subj === subj && match(r.name, name))) {
            rows.push({ subj, name, total: totals[key], solved: solvedCounts[key] || 0 });
        }
    });

    rows.forEach(r => { r.pct = r.total > 0 ? Math.round((r.solved / r.total) * 100) : 0; });
    rows.sort((a, b) => a.pct - b.pct || b.total - a.total || a.name.localeCompare(b.name));

    const firstPaint = !container.dataset.cpxReady;
    container.dataset.cpxReady = '1';

    if (rows.length === 0) {
        container.innerHTML =
            '<div class="cpx-empty">' +
                '<span class="cpx-empty-title">Nothing to conquer yet</span>' +
                '<span class="cpx-empty-sub">Add a chapter in Grind Station — it surfaces here, weakest first.</span>' +
            '</div>';
        container.classList.remove('cpx-animate');
        return;
    }

    // Render the FULL ledger; styles-chapters.css shows a capped window
    // (first CPX_MAX_VISIBLE rows) and "+N more" expands it in place.
    const overflow = Math.max(0, rows.length - CPX_MAX_VISIBLE);
    const safeAttr = s => escapeHtml(s).replace(/"/g, '&quot;');

    const rowHtml = (r, i) => {
        const cls = ['cpx-row'];
        if (r.total === 0) cls.push('is-void');      // registered but untouched
        if (i === 0 && rows.length > 0) cls.push('is-flag');   // THE weakest — only accent
        if (r.pct >= 100) cls.push('is-done');
        const name = safeAttr(r.name);
        return `<div class="${cls.join(' ')}" role="button" tabindex="0"` +
               ` data-subj="${r.subj}" data-enc="${encodeURIComponent(r.name)}" data-pct="${r.pct}"` +
               ` aria-label="${name} · ${r.pct}% complete">` +
               `<span class="cpx-subj" aria-hidden="true">${SUBJ_META[r.subj] || '·'}</span>` +
               `<span class="cpx-name">${escapeHtml(r.name)}</span>` +
               `<span class="cpx-track" aria-hidden="true"><i style="width:${r.pct}%"></i></span>` +
               `<span class="cpx-pct">${r.pct}<i>%</i></span>` +
           `</div>`;
    };

    container.innerHTML =
        '<div class="cpx-cols" aria-hidden="true">Chapter &middot; weakest first</div>' +
        '<div class="cpx-rows">' + rows.map(rowHtml).join('') + '</div>' +
        (overflow > 0
            ? `<button type="button" class="cpx-more" data-open="0"` +
              ` data-more-label="+ ${overflow} more" data-less-label="Show less">+ ${overflow} more</button>`
            : '');

    // Width-in animation only on the first paint after page load — later
    // re-renders (each solve triggers updateUI) must NOT replay the motion.
    container.classList.toggle('cpx-animate', firstPaint);

    // One delegated pair for the card's lifetime: row activation (click /
    // keyboard) routes through window.openChapterProgress exactly as before,
    // and the tail affordance expands the ledger in place.
    if (!container.dataset.cpxBound) {
        container.dataset.cpxBound = '1';
        container.addEventListener('click', e => {
            if (e.target.closest('.cpx-more')) { toggleCpxOverflow(container); return; }
            const row = e.target.closest('.cpx-row');
            if (row) window.openChapterProgress(row.dataset.subj, row.dataset.enc);
        });
        container.addEventListener('keydown', e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const row = e.target.closest('.cpx-row');
            if (!row) return;
            e.preventDefault();
            window.openChapterProgress(row.dataset.subj, row.dataset.enc);
        });
    }
}

// Expand / collapse the truncated tail. Rows never reorder — weakest stays on
// top whether capped or fully expanded.
function toggleCpxOverflow(container) {
    const btn = container.querySelector('.cpx-more');
    if (!btn) return;
    const expand = btn.dataset.open !== '1';
    btn.dataset.open = expand ? '1' : '0';
    btn.textContent = expand ? btn.dataset.lessLabel : btn.dataset.moreLabel;
    container.classList.toggle('is-expanded', expand);
}

// ── Dashboard card → jump into a chapter's question list in Grind Station ──
export function openChapterProgress(subj, encodedName) {
    try {
        const name = decodeURIComponent(encodedName);
        AppState.currentSubject = subj;
        if (typeof window.openChapterDetail === 'function') window.openChapterDetail(name);
        const nav = document.querySelector('[data-tab="practice"]');
        if (typeof window.switchTab === 'function') window.switchTab('practice', nav);
    } catch (e) { /* never block card clicks */ }
}

// ── Pillar 2 helper: lowest-health question for Checkpoint lockdown ──────────
// Returns the single highest-priority, lowest-health question from the Chapter
// Decay Grid — the one with the lowest easeFactor among due (overdue) error
// entries. This is what the Checkpoint serves during lockdown.
export function getLowestHealthQuestion() {
    const candidates = AppState.questionBank.filter(q =>
        (q.status === 'error' || q.status === 'wrong' || q.status === 'solved') &&
        getDueStatus(q).status === 'ready'
    );
    if (!candidates.length) {
        // Fallback: lowest easeFactor across the entire bank
        const sorted = [...AppState.questionBank].sort((a, b) => _numOr(a.easeFactor, 2.5) - _numOr(b.easeFactor, 2.5));
        return sorted[0] || null;
    }
    const sorted = [...candidates].sort((a, b) => _numOr(a.easeFactor, 2.5) - _numOr(b.easeFactor, 2.5));
    return sorted[0];
}

// ==================== ERROR RESOLUTION ENGINE ====================

let _todayKeyCache = null;
let _lastRenderedDate = null;
let _rolloverWatchStarted = false;

// Null-safe numeric coercion: corrupt/legacy STRING values (e.g. "2.7") or
// NaN must never crash .toFixed() or poison comparators.
function _numOr(v, fallback) {
    const n = Number(v);
    return isFinite(n) ? n : fallback;
}

// ICU-safe local YYYY-MM-DD key (manual formatting — toLocaleDateString
// variants can emit non-ISO shapes on some ICU builds, corrupting day keys).
function _todayKey(date) {
    const d = date || new Date();
    if (!(d instanceof Date) || isNaN(d.getTime())) return null; // corrupt timestamp
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// frictionTypes may be a JSON STRING or (legacy) a raw array.
function _parseFrictionTypes(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string') return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

export function refreshErrorDashboardIfStale() {
    const today = _todayKey();
    if (_lastRenderedDate !== today) {
        _lastRenderedDate = today;
        renderErrorResolutionDashboard();
        // The sparkline we just drew is only the intermediate data carrier —
        // app.js's candlestick renderer (renderMomentumCandles) reads the
        // points back and replaces the container. Re-chain it so the rollover
        // watcher / focus / visibility re-renders don't leave the sparkline
        // permanently clobbering the candles.
        try { if (typeof window.renderMomentumCandles === 'function') window.renderMomentumCandles(); } catch (_) {}
    }
}

// -- Filter dock ----------------------------------------------------------------
// While reading a long board, the sticky toolbar used to follow with ALL rows
// (search + status + mistake type), eating vertical screen space. A zero-height
// sentinel directly above the toolbar watches the scroll: once it leaves the
// viewport top, the toolbar docks to search-only (.emf-docked); scrolling back
// up undocks and restores the full filter stack.
let _filterDockReady = false;
function _initFilterDock() {
    if (_filterDockReady) return;   // one observer for the page's lifetime
    const filters = document.querySelector('.error-filters');
    const sentinel = document.getElementById('emf-scroll-sentinel');
    if (!filters || !sentinel || typeof IntersectionObserver === 'undefined') return;
    _filterDockReady = true;
    const io = new IntersectionObserver(([entry]) => {
        filters.classList.toggle('emf-docked', !entry.isIntersecting);
    }, { rootMargin: '-1px 0px 0px 0px', threshold: 0 });
    io.observe(sentinel);
}
// Static markup — safe to wire at module eval (module scripts run after parse).
_initFilterDock();

// ── Draft persistence for the manual Log-a-Mistake form [AUDIT P1-9] ──────
// A student typing a chapter/topic who swipes the PWA away (iPad app switcher
// is one gesture) used to lose everything typed. Text fields are mirrored to
// localStorage on every input and restored when the modal opens; cleared only
// after a successful save. The attached image is NOT persisted (multi-MB data
// URLs would blow the localStorage quota) — noted in the audit as accepted.
const ADD_ERR_DRAFT_KEY = 'jeemax_draft_add_error';
function _saveAddErrorDraft() {
    try {
        const ch = document.getElementById('new-err-chapter');
        const ty = document.getElementById('new-err-type');
        if (!ch || !ty) return;
        const v = { chapter: ch.value, type: ty.value };
        if (!v.chapter && !v.type) { localStorage.removeItem(ADD_ERR_DRAFT_KEY); return; }
        localStorage.setItem(ADD_ERR_DRAFT_KEY, JSON.stringify(v));
    } catch (_) {}
}
function _restoreAddErrorDraft() {
    try {
        const raw = localStorage.getItem(ADD_ERR_DRAFT_KEY);
        if (!raw) return;
        const d = JSON.parse(raw);
        const ch = document.getElementById('new-err-chapter');
        const ty = document.getElementById('new-err-type');
        // Never clobber what the user is currently looking at.
        if (ch && !ch.value && d.chapter) ch.value = d.chapter;
        if (ty && !ty.value && d.type) ty.value = d.type;
    } catch (_) {}
}
try {
    if (!window.__addErrorDraftWired) {
        window.__addErrorDraftWired = true;
        ['input', 'change'].forEach(evName => {
            document.addEventListener(evName, (e) => {
                const t = e.target;
                if (t && (t.id === 'new-err-chapter' || t.id === 'new-err-type')) _saveAddErrorDraft();
            });
        });
    }
} catch (_) {}
window.__restoreAddErrorDraft = _restoreAddErrorDraft;

function _startRolloverWatcher() {
    if (_rolloverWatchStarted) return;
    _rolloverWatchStarted = true;
    _lastRenderedDate = _todayKey();
    setInterval(refreshErrorDashboardIfStale, 60_000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshErrorDashboardIfStale();
    });
    window.addEventListener('focus', refreshErrorDashboardIfStale);
}

// The stage-top stat strip (per-subject bars + 15-day sparkline) was removed;
// this function now maintains ONLY the rail's squashed-today readout.
// app.js renderMomentumCandles() still no-ops safely without its container.
export function renderErrorResolutionDashboard() {
    _startRolloverWatcher();
    const todayStr = _todayKey();
    const subjects = ['physics', 'chemistry', 'maths'];

    const todayCounts = { physics: 0, chemistry: 0, maths: 0 };
    AppState.questionBank.forEach(q => {
        if (!q.historyLogs || !Array.isArray(q.historyLogs)) return;
        q.historyLogs.forEach(log => {
            if (log.result !== 'correct' || !log.timestamp) return;
            const logDate = _todayKey(new Date(log.timestamp));
            if (logDate === todayStr) {
                const subj = normSubjKey(q.subject);   // canonical — whitespace-safe
                if (todayCounts[subj] !== undefined) todayCounts[subj]++;
            }
        });
    });

    let totalToday = 0;
    subjects.forEach(subj => { totalToday += todayCounts[subj]; });

    // Squashed-today readouts live in the vault rail (#rail-today-*).
    const railTotalEl = document.getElementById('rail-today-total');
    if (railTotalEl) {
        railTotalEl.textContent = String(totalToday);
        railTotalEl.classList.toggle('is-zero', !totalToday);   // a zero day must not glow
    }
    const railSubIds = { physics: 'rail-today-physics', chemistry: 'rail-today-chemistry', maths: 'rail-today-maths' };
    subjects.forEach(subj => {
        const el = document.getElementById(railSubIds[subj]);
        if (!el) return;
        el.textContent = String(todayCounts[subj]);
        el.classList.toggle('is-zero', !todayCounts[subj]);
    });
}
