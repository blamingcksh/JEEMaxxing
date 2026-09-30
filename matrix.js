// ==================== MATRIX MODULE ====================
// Error Matrix UI — SR-powered card rendering, filtering, practice logging.
//
// Only imports from storage.js — no cross-module circular dependencies.

import {
    AppState,
    saveAllAsync,
    changeCount,
    // Daily-solved counters (fallback leg of the keep-going nudge).
    solved,
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
    // Strict variant: returns null for a non-canonical subject. COUNTER writes
    // must use this and skip on null, never silently credit 'physics'.
    normSubjKeyStrict,
    // Canonical frictionTypes parser (JSON string | raw array | bare legacy token).
    parseFrictionTypes,
    // Mock-test labelling: dashboard ledgers skip mock questions/chapters.
    isMockChapterName,
    isMockQuestion,
    // Chapter weightage for exam-aware risk sorting in the Decay Grid.
    getChapterWeight,
    resolveChapterWeightInfo,
    setChapterWeightOverride,
    // ── Shared "user is mid-activity" registry (interruption gating) ──
    SessionFocus,
} from './storage.js';

// Daily Directive: SR fix completions price at 1.4 LU via the pending-detail
// handshake (directive.js must not import this module — no cycle).
import { Directive } from './directive.js';

// Memory Kernel v2 — canonical pure implementation (imported directly; the
// kernel has zero dependencies so this cannot form a cycle).
import {
    chapterMemoryStats,
    currentRetrievability,
    retrievabilityAt,
    hydrateMemory,
} from './memory.js';

// Cognitive Cortex v3 — brain-like scheduling layer (pure, zero DOM; same
// no-cycle contract as memory.js). Powers priority ordering, per-tag leak,
// contagion, age/overdue priors and the target-retention scheduler.
import {
    buildTagInventory,
    commitCortexReview,
    computeTagProfiles,
    collectLapseEvents,
    cortexPriority,
    cortexRetrievability,
    leakOf,
    normalizeTag,
    preReviewSnapshot,
    scheduleNextReview,
    suggestTags,
} from './cortex.js';

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
//  Cognitive Cortex v3 — memoized per-render context
// ---------------------------------------------------------------------------
// Tag inventory / leak profiles / lapse events are pure derivations over the
// whole bank. Rebuilding them is O(N·logs) — trivially cheap next to this
// module's existing innerHTML card wipes and forced-layout filter pass, but
// autocomplete keystrokes and multi-surface renders shouldn't recompute, so
// the bundle memoizes on a bank revision counter bumped by EVERY mutating
// path (solve commit / manual add / delete / tag edit).
let _bankRev = 0;
function _bumpBankRev() { _bankRev++; }

const _cortexCache = { rev: -1, len: -1, ctx: null };

/**
 * Build (or reuse) the cortex context: { inventory, profiles, lapseEvents }.
 * Every consumer wraps its use in try/catch — a cortex fault must degrade to
 * the legacy sort order, never blank the vault.
 */
function _cortexCtx(nowMs) {
    const bank = AppState.questionBank;
    const now = nowMs || Date.now();
    if (_cortexCache.ctx && _cortexCache.rev === _bankRev && _cortexCache.len === bank.length) {
        return _cortexCache.ctx;
    }
    let ctx;
    try {
        const inventory = buildTagInventory(bank);
        const { profiles } = computeTagProfiles(bank, { nowMs: now });
        const lapseEvents = collectLapseEvents(bank, { nowMs: now });
        ctx = {
            nowMs: now,
            examDateMs: _examDateMsSafe(),
            inventory,
            profiles,
            lapseEvents,
            chapterWeight: getChapterWeight,
        };
    } catch (e) {
        console.error('[cortex] context build failed — degrading to legacy ordering:', e);
        ctx = null;
    }
    _cortexCache.rev = _bankRev;
    _cortexCache.len = bank.length;
    _cortexCache.ctx = ctx;
    return ctx;
}

/** Priority with a legacy-shaped fallback (never NaN, never throws). */
function _safeCortexPriority(q, ctx) {
    try {
        const p = cortexPriority(q, ctx || undefined);
        return isFinite(p) ? p : 0;
    } catch (_) { return 0; }
}

/**
 * Memoized priority lookup for SORTS.
 *
 * A comparator that recomputes cortexPriority on every call costs
 * O(N log N) full evaluations per render (hydrateMemory parses dates,
 * effectiveStability walks historyLogs, synapseCharge scans lapse events).
 * Priorities are stable within one context generation (same bank revision,
 * same evaluation instant), so each question is computed AT MOST ONCE per
 * render pass and the sort itself becomes plain number comparisons.
 */
function _prioOf(q, ctx) {
    if (!ctx) return _safeCortexPriority(q, null);
    let memo = ctx._prio;
    if (!memo) { memo = new Map(); ctx._prio = memo; }
    const id = String(q && q.id);
    let p = memo.get(id);
    if (p === undefined) {
        p = _safeCortexPriority(q, ctx);
        memo.set(id, p);
    }
    return p;
}

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
        const shell = document.querySelector('.vault-shell');
        if (shell) shell.classList.remove('queue-active');
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
    // ── Pre-solve kernel state, captured when the DRAWER OPENS. ──
    // The Elo bridge advances q.reps (memory.js updateMemoryOnReview) the
    // instant the user commits an answer in _applyResult — long before
    // submitPracticeLog runs. Reading hydrateMemory(q).reps at submit time
    // therefore returns the POST-solve count on every single review, which
    // made the cortex-scheduler gate below treat every item as
    // kernel-owned on its very first vault attempt.
    preSolveReps: 0,
    preSolveStability: 0,
    // Pre-solve SM-2 ease factor. The Elo bridge nudges easeFactor before
    // submitPracticeLog runs; this holds the pre-nudge value so computeSR can
    // evaluate one SM-2 step instead of two stacked ones.
    preSolveEF: 2.5,
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
    clearInterval(_drawerState.stopwatchInterval);
    _drawerState = {
        qId: null,
        preSolveReps: 0,
        preSolveStability: 0,
        preSolveEF: 2.5,
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
        tagDraft: null,         // 🏷 Cortex v3 draft of q.tags while the drawer is open
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

    // ── Freeze the PRE-SOLVE kernel state NOW, before any answer is given ──
    // calculateEloMigration fires at the moment of truth and advances
    // q.reps / q.stability / q.difficultyD; submitPracticeLog then needs the
    // PRE-solve values to decide whether this item was already kernel-owned
    // (cortex scheduler eligibility) and to compute the interval without
    // double-counting the just-committed review.
    try {
        const _pre = hydrateMemory(q);
        _drawerState.preSolveReps = Number(_pre.reps) || 0;
        _drawerState.preSolveStability = Number(_pre.stability) || 0;
        // Capability: hydrateMemory does not carry easeFactor, so read it off
        // the raw question the same way computeSR does (with the same 2.5
        // default and NaN guard) — this is the value SM-2 must step FROM.
        const _rawEF = Number(q.easeFactor);
        _drawerState.preSolveEF = Number.isFinite(_rawEF) ? _rawEF : 2.5;
    } catch (_) {
        _drawerState.preSolveReps = 0;
        _drawerState.preSolveStability = 0;
        const _rawEF = Number(q.easeFactor);
        _drawerState.preSolveEF = Number.isFinite(_rawEF) ? _rawEF : 2.5;
    }

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

// ── Dashboard short chapter names (narrow bento thirds, e.g. iPad landscape)
// Cards are `@container card`; CSS swaps .ch-full ↔ .ch-short below ~440px
// card width. Chapter names are user-defined, so a curated map covers common
// JEE chapters (case-insensitive) and shortChapterName() falls back to a
// word-boundary cut for the rest. Full names always survive in title/aria.
const CHAPTER_SHORT = {
    'thermodynamics': 'Thermo',
    'chemical thermodynamics': 'Chem. Thermo',
    'kinetic theory of gases': 'KTG',
    'work energy and power': 'Work & Energy',
    'work, energy and power': 'Work & Energy',
    'electrostatics': 'Electrostat.',
    'current electricity': 'Current Elec.',
    'electromagnetic induction': 'EMI',
    'alternating current': 'AC',
    'wave optics': 'Wave Opt.',
    'modern physics': 'Modern Phys.',
    'semiconductors': 'Semicond.',
    'semiconductor': 'Semicond.',
    'units and dimensions': 'Units & Dim.',
    'rotational mechanics': 'Rotation',
    'thermal expansion': 'Thermal Exp.',
    'temperature and thermal expansion': 'Temp. & Exp.',
    'thermal properties of matter': 'Thermal Prop.',
    'mechanical properties of fluids': 'Fluids',
    'mechanical properties of solids': 'Elasticity',
    'magnetism and matter': 'Magnetism',
    'stoichiometry': 'Stoichio',
    'atomic structure': 'Atomic Struct.',
    'chemical bonding': 'Chem. Bonding',
    'coordination compounds': 'Coord. Comp.',
    'chemical equilibrium': 'Chem. Eqbm.',
    'ionic equilibrium': 'Ionic Eqbm.',
    'electrochemistry': 'Electrochem.',
    'chemical kinetics': 'Kinetics',
    'p-block elements': 'p-Block',
    's-block elements': 's-Block',
    'd and f block elements': 'd & f Block',
    'general organic chemistry': 'GOC',
    'aldehydes and ketones': 'Ald. & Ket.',
    'alcohols phenols and ethers': 'Alcohols…',
    'redox reactions': 'Redox',
    'continuity and differentiability': 'Cont. & Diff.',
    'limit continuity and differentiability': 'Cont. & Diff.',
    'application of derivatives': 'AOD',
    'applications of derivatives': 'AOD',
    'indefinite integration': 'Indef. Integ.',
    'definite integration': 'Def. Integ.',
    'differential equations': 'Diff. Eqns.',
    'complex numbers': 'Complex Nos.',
    'quadratic equations': 'Quad. Eqns.',
    'sequences and series': 'Seq. & Series',
    'three dimensional geometry': '3D Geometry',
    'inverse trigonometric functions': 'Inv. Trigo.',
    'trigonometric functions': 'Trigonometry',
    'sets and relations': 'Sets & Rel.',
    'mathematical reasoning': 'Math. Reason.',
    'linear programming': 'LPP',
    'vector algebra': 'Vectors',
    'permutations and combinations': 'P & C',
    'binomial theorem': 'Binomial'
};
function shortChapterName(name) {
    const s = String(name == null ? '' : name);
    if (!s) return s;
    // Mock-test chapters keep their prefix and shorten the paper part:
    // `Mock: Thermodynamics` → `Mock: Thermo`.
    const t = s.trim();
    if (t.length > 6 && t.slice(0, 5).toLowerCase() === 'mock:') {
        const rest = t.slice(5).trim();
        const hit = CHAPTER_SHORT[rest.toLowerCase()];
        if (hit) return 'Mock: ' + hit;
        if (rest.length <= 12) return 'Mock: ' + rest;
        const cut = rest.slice(0, 14);
        const ws = cut.lastIndexOf(' ');
        return 'Mock: ' + (ws >= 4 ? cut.slice(0, ws) : cut).trimEnd() + '…';
    }
    const hit = CHAPTER_SHORT[t.toLowerCase()];
    if (hit) return hit;
    if (s.length <= 14) return s;
    const cut = s.slice(0, 12);
    const ws = cut.lastIndexOf(' ');
    return (ws >= 5 ? cut.slice(0, ws) : cut).trimEnd() + '…';
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
    // id-null guard: a bank row with a missing id must not throw here — the
    // drawer is opened straight from a card click and every caller assumes
    // this returns null on a miss.
    return AppState.questionBank.find(item => item.id != null && String(item.id) === String(_drawerState.qId)) || null;
}

// The letter a drawer option tile is badged with AND graded against. It is
// the OPTION INDEX (A, B, C …): app.js's own practice modal renders
// `_letters[_oi]` and resolveMcqCorrectLetters() resolves the stored answer
// to index letters. Deriving it from the option TEXT instead ("m is the
// mass…" → "M") meant the grader demanded "B" while the genuinely correct
// tile was badged "V" — a guaranteed miss with nothing marked green.
// Past 26 options fall back to the 1-based number, matching app.js.
function _optionLetter(idx) {
    const i = Number(idx);
    if (!Number.isInteger(i) || i < 0) return '';
    return i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
}

// The letter an option's Gem auto-crop figure is STORED under — that map is
// keyed by whatever prefix the option text itself carries ("A) …" → "A"), so
// the figure lookup stays text-derived while the tile letter is index-based.
function _optTextLetter(opt, idx) {
    const m = opt && String(opt).trim().match(/^([A-Za-z])[.)\s]/);
    return m ? m[1].toUpperCase() : _optionLetter(idx);
}

// Auto-cropped figure bound to a single MCQ option (Gem Diagram Map output,
// stored under the option letter). Local mirror of app.js's _gemOptionImageUrl
// — matrix.js cannot import app.js (circular module dependency), same
// convention as the duplicated _safeImgSrc above.
function _optionImgUrl(q, opt, idx) {
    if (!q || !q.optionImageUrls || typeof opt !== 'string') return null;
    const letter = _optTextLetter(opt, idx);
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

// Single-vs-multi is decided by how many letters the RESOLVED answer yields,
// not by the stored value's JS type. A multi-answer stored as the string
// "A and C" is not an Array, so the old Array.isArray(correctAnswer) test
// rendered single-select and the user could never submit a passing set.
// Conversely an Array holding ONE answer is still a single answer.
function _drawerIsMultiAnswer(q) {
    try { return resolveMcqCorrectLetters(q).length > 1; } catch (_) { return false; }
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
        const isMulti = _drawerIsMultiAnswer(q);
        const optsHtml = q.options.map((opt, i) => {
            const letter = _optionLetter(i);
            const optImg = _optionImgUrl(q, opt, i)
                ? `<img class="sr-mcq-img" src="${_safeImgSrc(_optionImgUrl(q, opt, i))}" alt="Option figure">`
                : '';
            // Enter/Space mirror the click so the drawer is completable from
            // the keyboard alone (role="button" + tabindex="0" advertise
            // that) — same activation contract as .rh-row / .cpx-row.
            return `<div class="sr-mcq-option" data-letter="${_esc(letter)}" data-option="${_esc(opt)}" onclick="srSelectOption(this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();srSelectOption(this);}" role="button" tabindex="0">
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

// ── Cortex v3 tag editor (drawer-only, v1) ─────────────────────────────────
// The personal tag vocabulary is the cortex's highest-weight namespace, so it
// must be editable where the user is already reflecting on the mistake. Draft
// lives on _drawerState.tagDraft (never the question itself) — committed only
// on "Log Attempt", discarded if the drawer closes. Suggestion chips come
// from the memoized bank inventory: reusing an existing tag must be cheaper
// than inventing a synonym (the #1 anti-drift defense).

function _drawerTags() {
    if (!_drawerState.tagDraft) {
        const q = _currentDrawerQuestion();
        _drawerState.tagDraft = (q && Array.isArray(q.tags)) ? q.tags.slice(0, 6).map(String) : [];
    }
    return _drawerState.tagDraft;
}

function _renderTagEditorRow() {
    let tags = [];
    try { tags = _drawerTags(); } catch (_) { tags = []; }
    const chips = tags.map(t =>
        '<span class="sr-tagedit-chip">#' + _esc(t) +
        '<button type="button" class="sr-tagedit-x" aria-label="Remove tag ' + _esc(t) + '" onclick="event.stopPropagation();srRemoveTag(\'' + _jsId(t) + '\')">✕</button></span>'
    ).join('');
    let sugg = [];
    try {
        const q = _currentDrawerQuestion();
        sugg = suggestTags(AppState.questionBank, q && q.subject, q && q.chapter, tags, 4);
    } catch (_) { sugg = []; }
    const suggHtml = sugg.map(s =>
        '<button type="button" class="sr-tagedit-sugg" onclick="event.stopPropagation();srAddTag(\'' + _jsId(s.label) + '\')">' +
        '#' + _esc(s.label) + '</button>'
    ).join('');
    return `
        <div class="sr-row">
            <div class="sr-row-label">Personal Tags <span style="opacity:.55;font-weight:400;">(#vocabulary the engine learns from — optional)</span></div>
            <div class="sr-tagedit" id="sr-tagedit">
                <div class="sr-tagedit-chips" id="sr-tagedit-chips">${chips || '<span class="sr-tagedit-none">No tags yet</span>'}</div>
                <div class="sr-tagedit-inputrow">
                    <input type="text" class="sr-tagedit-input" id="sr-tagedit-input" maxlength="40"
                        placeholder="${tags.length >= 6 ? 'Tag limit reached (6)' : 'Add a tag…'}"
                        ${tags.length >= 6 ? 'disabled' : ''}
                        onkeydown="if(event.key==='Enter'){event.preventDefault();srAddTag(this.value);}"
                        onclick="event.stopPropagation()">
                    <span class="sr-tagedit-count">${tags.length}/6</span>
                </div>
                ${suggHtml ? '<div class="sr-tagedit-suggs" id="sr-tagedit-suggs"><span style="font-size:10px;color:#66708a;">Reuse:</span>' + suggHtml + '</div>' : ''}
            </div>
        </div>`;
}

window.srAddTag = function (raw) {
    const label = String(raw == null ? '' : raw).trim().slice(0, 40);
    if (!label) return;
    const tags = _drawerTags();
    const norm = normalizeTag(label);
    if (!norm || tags.length >= 6) { _refreshTagEditor(); return; }
    if (tags.some(t => normalizeTag(t) === norm)) { _refreshTagEditor(); return; }
    tags.push(label);
    _refreshTagEditor();
};

window.srRemoveTag = function (encoded) {
    let target = '';
    try { target = decodeURIComponent(String(encoded)); } catch (_) { target = String(encoded); }
    const tags = _drawerTags();
    const norm = normalizeTag(target);
    const idx = tags.findIndex(t => normalizeTag(t) === norm);
    if (idx >= 0) tags.splice(idx, 1);
    _refreshTagEditor();
};

/** Re-render just the editor row in place (keeps stopwatch/result state). */
function _refreshTagEditor() {
    const holder = document.getElementById('sr-tag-editor-holder');
    if (holder) holder.innerHTML = _renderTagEditorRow();
}

function _renderTagStage() {
    return `
        <div class="sr-tag-divider">Now log your attempt ↓</div>
        <div id="sr-tag-editor-holder">${_renderTagEditorRow()}</div>
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
// ── Keep-going nudge ─────────────────────────────────────────────────────
// Brief progress view on a correct solve: how many more questions till
// today's daily target for this subject + a nudge. Text-only, no systems.
// Mirrors the dashboard's own "N to go" language: Directive contract when
// live, solved ÷ activeTargets fallback otherwise. `pendingDelta` covers
// what the counters haven't absorbed yet — the drawer decides BEFORE
// submitPracticeLog counts (+1 a fresh correct, +2 immediate under
// overheat, +1 more at submit when fresh).
const _KEEP_GOING_LINES = ['keep going', 'stay locked in', 'one at a time', 'keep rolling'];
function _targetRemaining(subject, pendingDelta) {
    try {
        const sub = _normSubj(subject);
        let left;
        if (typeof Directive !== 'undefined' && Directive.hasContract) {
            left = Directive.problemsRemaining(sub);
        } else {
            const tgt = (AppState.activeTargets && AppState.activeTargets[sub]) || 0;
            const done = (solved && solved[sub]) || 0;
            left = tgt - done;
        }
        return Math.max(0, left - (pendingDelta || 0));
    } catch (_) { return null; }
}
function _keepGoingHTML(q, pendingDelta) {
    const n = _targetRemaining(q && q.subject, pendingDelta);
    if (n == null) return '<div class="sr-keep-going">💪 keep going</div>';
    if (n === 0) return '<div class="sr-keep-going">✨ Daily target smashed</div>';
    const line = _KEEP_GOING_LINES[n % _KEEP_GOING_LINES.length];
    return `<div class="sr-keep-going">🎯 ${n} more to today's target — ${line}</div>`;
}

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
    // An explicitly typed manual time is the user's own reading of the
    // solve — it wins over the stopwatch, which manual mode pauses and
    // therefore leaves frozen at a stale pre-manual reading. Without this
    // the Elo engine scored the pre-manual seconds while the log stored the
    // typed minutes, and the two disagreed by an arbitrary amount.
    _drawerState.frozenTimeMins = _drawerState.timeSpentMins > 0
        ? _drawerState.timeSpentMins
        : _drawerState.stopwatchSeconds / 60;
    // The Manual toggle + input live INSIDE the tag stage, which is hidden
    // until this function reveals it — so they are the user's ONLY way to
    // state how long the attempt really took, and they stay usable here by
    // design. The stopwatch stays frozen (above); the manual value is the
    // user's correction of the duration and submitPracticeLog() prefers it for
    // the historyLog + SR schedule. The Elo chip intentionally reports the
    // decision-instant stopwatch cost, which is what that engine prices.

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
            const oh = document.body.classList.contains('overheat-active');
            const pendingDelta = (q && q.status !== 'solved') ? (oh ? 3 : 1) : (oh ? 2 : 0);
            zone.innerHTML = `<div class="sr-result-banner correct">✅ Correct${suffix}</div>${_keepGoingHTML(q, pendingDelta)}${solImg}`;
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
            // The pick that unlocked Confirm was never graded (no answer /
            // unresolvable answer) — leaving it badged "selected" under the
            // result banner implies it counted for something. Clear it.
            mcqOpts.forEach(o => { o.style.pointerEvents = 'none'; o.classList.remove('selected'); });
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
            // changeCount indexes solved[physics|chemistry|maths]. Use the STRICT
            // normalizer and skip a non-canonical subject: normSubjKey's
            // 'physics' catch-all would silently credit another subject's tally.
            const _overheatKey = normSubjKeyStrict(q && q.subject);
            if (_overheatKey) changeCount(_overheatKey, 2);
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

// Shown when an MCQ cannot be auto-graded — either there is NO loaded answer,
// or the loaded answer exists but resolveMcqCorrectLetters() could not map it
// to option letters ("Option B", "A, C and D", prose). In both cases every
// pick would grade as wrong, so degrade to the self-report path rather than
// silently failing the user; the banner then reads "(self-reported)".
function _showSelfReportPrompt(q) {
    const zone = document.getElementById('sr-result-zone');
    if (zone) {
        zone.innerHTML = `
            <div class="sr-self-report">
                <div class="sr-self-report-label">${_hasLoadedAnswer(q) ? 'Stored answer could not be matched to any option — were you correct?' : 'No answer on file — were you correct?'}</div>
                <div class="sr-self-report-btns">
                    <button class="sr-self-btn correct" type="button" onclick="srSelfReport('correct')">✔ Yes, correct</button>
                    <button class="sr-self-btn incorrect" type="button" onclick="srSelfReport('incorrect')">✖ No, incorrect</button>
                </div>
            </div>`;
    }
    const cb = document.getElementById('sr-confirm-btn');
    if (cb) cb.style.display = 'none';
    // pointerEvents:none only blocks the mouse — drop the tiles out of the tab
    // order too, or a keyboard user could keep re-picking a pick that is
    // never graded.
    document.querySelectorAll('.sr-mcq-option').forEach(o => {
        o.style.pointerEvents = 'none';
        o.setAttribute('tabindex', '-1');
    });
}

function _renderKatexIn(el) {
    if (!el || !window.katex) return;
    // Delegate to app.js's global math engine: it escapes the prose BETWEEN
    // math fragments segment-by-segment before splicing KaTeX markup in.
    // The old single .replace() fed the raw source straight into innerHTML,
    // so any question text containing "<", ">" or "&" (e.g. "If a<b and
    // b<c, then ...") materialized phantom HTML tags that swallowed both
    // the prose and the KaTeX output — the "broken KaTeX" in the drawer.
    if (typeof window.processElementMath === 'function') {
        if (el.hasAttribute('data-math-rendered')) el.removeAttribute('data-math-rendered');
        window.processElementMath(el);
        return;
    }
    // Fallback (global engine unavailable): same algorithm, escaped per segment.
    const raw = el.textContent;
    // Auto-wrap delimiter-less \command fragments (shared with app.js's global
    // math engine) so Gem output without $...$ delimiters still hydrates.
    const wrapped = (typeof window._wrapBareLatex === 'function') ? window._wrapBareLatex(raw) : raw;
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^\$]+)\$|\\\(([\s\S]+?)\\\)/g;
    let out = '', last = 0, m;
    while ((m = re.exec(wrapped)) !== null) {
        out += esc(wrapped.slice(last, m.index));
        try { out += window.katex.renderToString(m[1] || m[2] || m[3] || m[4], { throwOnError: false, displayMode: !!(m[1] || m[2]) }); }
        catch (e) { out += esc(m[0]); }
        last = m.index + m[0].length;
    }
    out += esc(wrapped.slice(last));
    el.innerHTML = out;
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
    // 🔒 The result is committed — the tiles are inert. pointerEvents:none
    // stops the mouse but not Enter/Space on a focused tile.
    if (_drawerState.resultLocked) return;
    const q = _currentDrawerQuestion();
    if (!q) return;
    const isMulti = _drawerIsMultiAnswer(q);
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
    // An answer can be on file yet unresolvable to letters; with an empty
    // correct set EVERY pick compares as wrong, so route to the self-report
    // prompt instead of declaring the user wrong on a technicality.
    const correct = _hasLoadedAnswer(q) ? resolveMcqCorrectLetters(q).slice().sort() : [];
    if (correct.length) {
        const selected = [..._drawerState.selectedOptions].sort();
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

// Upper bound on a hand-entered solve time: 24h. Anything past that is a
// typo (a dropped exponent, a pasted ms figure), not a study session.
const MAX_MANUAL_TIME_MINS = 1440;

export function srToggleManualTime() {
    // NOT gated on resultLocked: this control is rendered inside the tag stage,
    // which _applyResult only reveals at the decision instant, so locking it
    // there made manual time permanently unusable. The stopwatch — not the
    // manual input — is what the result lock freezes.
    const toggle = document.getElementById('sr-manual-toggle');
    if (!toggle) return;
    const input = document.getElementById('sr-manual-input');
    const unit = document.getElementById('sr-manual-unit');
    const isManual = toggle.classList.toggle('active');
    if (input) input.style.display = isManual ? 'inline-block' : 'none';
    if (unit) unit.style.display = isManual ? 'inline' : 'none';
    const dot = document.getElementById('sr-pulse-dot');
    if (isManual) {
        // Manual becomes the active time source: pause the stopwatch.
        _pauseStopwatch();
        if (dot) dot.classList.remove('running');
    } else {
        // …and hand it back to the stopwatch. Without this the timer stayed
        // frozen after manual-off while the UI still read as stopwatch-fed,
        // silently logging only the seconds accrued before the toggle.
        _startStopwatch();
        if (dot) dot.classList.add('running');
    }
}

export function srUpdateManualTime(val) {
    // Deliberately NOT gated on resultLocked — see srToggleManualTime. The
    // value is bounds-checked below and is only consumed by submitPracticeLog.
    const n = parseFloat(val);
    // "1e999" is a legal value for <input type="number"> and parses to
    // Infinity, which is truthy — the old `|| 0` let it straight through and
    // poisoned the subject's studySecs permanently. Empty, junk, negative and
    // out-of-range all read as "no manual time" (0 → stopwatch fallback).
    _drawerState.timeSpentMins = (Number.isFinite(n) && n >= 0 && n <= MAX_MANUAL_TIME_MINS) ? n : 0;
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

    // Guard the id compare: `find` runs the predicate on EVERY row, so a
    // single bank entry with `id: null` threw here before any match could be
    // considered — killing the whole log commit (0 history logs, drawer stuck
    // open with the result already locked). Same shape as _findQByHandlerId.
    const q = AppState.questionBank.find(item => item.id != null && String(item.id) === String(qId));
    if (!q) return;

    const timeSpent = _drawerState.timeSpentMins > 0 ? _drawerState.timeSpentMins : _drawerState.stopwatchSeconds / 60;

    // ── Undo the Elo-bridge EF nudge so computeSR sees the PRE-solve EF.
    // The Elo engine (app.js calculateEloMigration) flatly nudges easeFactor
    // (+0.15 / −0.2) at the moment of truth; computeSR then read that nudged
    // value as `currentEF` and applied SM-2's own q-driven move on top. One
    // logical review produced TWO ease-factor changes. The pre-solve EF is
    // restored for the duration of this commit (computeSR's own output is
    // clamped to the same [1.3, 3.0] band the nudge uses), so the persisted
    // EF is exactly SM-2's answer for this solve. ──
    const _preSolveEF = Number.isFinite(_drawerState.preSolveEF) ? _drawerState.preSolveEF : Number(q.easeFactor);
    const _eliBridgedEF = Number(q.easeFactor);
    const _efWasNudged = Number.isFinite(_preSolveEF) && _preSolveEF !== _eliBridgedEF;
    if (_efWasNudged) q.easeFactor = _preSolveEF;

    // ── Cognitive Cortex v3: capture the PRE-commit memory state BEFORE any
    // writer touches q (computeSR overwrites nextReviewAt; the kernel moves
    // stability). daysOverdue / age-at-solve / rBefore all come from here.
    // Also record whether this is the item's FIRST vault-drawer review — the
    // hot-strike/cold-revival priors key on it (practice-fumbled items arrive
    // with kernel reps already advanced, so reps===1 alone never fires). ──
    let _cortexSnap = null;
    try { _cortexSnap = preReviewSnapshot(q); } catch (_) { _cortexSnap = null; }
    const _vaultFirstReview = !Array.isArray(q.historyLogs) || q.historyLogs.length === 0;

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
    // Elo moment. The kernel already walked difficultyD, stability, reps and
    // lapses EXACTLY ONCE inside calculateEloMigration (memory.js
    // updateMemoryOnReview), so this second walk was a double-count of the
    // same solve. Difficulty now has a single owner per event: the kernel.
    // Friction/autonomy still reach the model honestly — as the performanceQ
    // input to computeSR below, which moves easeFactor and the interval.

    // ── Schedule precedence (ONE rule, expressed in this order):
    //   1. SM-2 (computeSR) writes the baseline schedule ALWAYS.
    //   2. The Cognitive Cortex target-retention scheduler OVERRIDES the
    //      horizon, but only for kernel-owned items (reps >= 1 BEFORE this
    //      solve) AND only on a CORRECT solve. An INCORRECT solve is a lapse:
    //      SM-2's compression (interval × Wf) stands, and the cortex is not
    //      allowed to re-lengthen it — the cortex estimates recall
    //      probability of a NEWLY modified stability, which is only
    //      meaningful after a successful retrieval.
    // _preReps is captured by the caller (openPracticeDrawer), because the
    // Elo bridge advances q.reps at the moment of truth — long before this
    // runs — so reading q.reps here would make EVERY item look kernel-owned
    // on its very first review.
    const _preReps = Number(_drawerState.preSolveReps) || 0;

    // Baseline: pure SM-2 output. Written FIRST so the cortex block below
    // expresses a genuine override, and so the mastery re-derivation there
    // reads the POST-solve ease factor rather than the stale pre-solve one.
    q.currentInterval = srResult.newInterval;
    q.easeFactor = srResult.newEaseFactor;
    q.nextReviewAt = srResult.nextReviewAt;
    q.isMastered = srResult.isMastered;

    // ── Cognitive Cortex v3 commit: age-at-solve priors (hot strike / cold
    // revival) + overdue spacing credit, applied to q.stability AFTER the
    // SM-2 baseline is on the question. Single-aspect rule preserved —
    // nothing else is touched here. Every step guarded — a cortex fault
    // degrades to pure SM-2 behavior. ──
    let _cortexSummary = null;
    try {
        _cortexSummary = commitCortexReview(q, _cortexSnap, {
            correct: _drawerState.result === 'correct',
            vaultFirst: _vaultFirstReview,
        });
        const _sched = _preReps >= 1 && _drawerState.result === 'correct'
            ? scheduleNextReview(q, {
                examDateMs: _examDateMsSafe(),
                chapterWeight: getChapterWeight,
            })
            : null;
        if (typeof _sched === 'string') {
            // Keep the displayed interval EXACTLY consistent with the new
            // schedule. No rounding: the cortex scheduler legitimately returns
            // sub-day horizons (MIN_INTERVAL_DAYS ≈ 1h for a just-modified,
            // low-stability item), and `Math.max(1, Math.round(d))` used to
            // persist a FULL-DAY interval against a 1-hour nextReviewAt —
            // memory.js then derived stability from that 1-day figure, so the
            // item was shelved an order of magnitude further out than the
            // schedule said. No consumer requires an integer interval.
            const _days = Math.max(0, (new Date(_sched).getTime() - Date.now()) / 86400000);
            if (Number.isFinite(_days)) {
                q.currentInterval = _days;
                q.nextReviewAt = _sched;
                // Re-derive mastery against the cortex horizon. SM-2's rule
                // ALSO requires the attempt itself to be correct — omitting
                // that conjunct shelved just-FAILED items with EF > 2.5 as
                // "mastered", permanently removing them from lockdown.
                q.isMastered = _days > 30 && q.easeFactor > 2.5 && _drawerState.result === 'correct';
            }
        }
    } catch (_) { /* SM-2 output already on the question — safe fallback */ }

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
        // ── Cognitive Cortex v3 attempt telemetry ──
        ageAtSolveDays: _cortexSnap ? _r1(_cortexSnap.ageAtSolveDays) : null,
        dueAtMs: _cortexSnap ? _cortexSnap.dueMs : null,
        daysOverdue: _cortexSnap ? _r1(_cortexSnap.daysOverdue) : null,
        rBefore: _cortexSnap ? Math.round(_cortexSnap.rBefore * 1000) / 1000 : null,
        sBefore: _cortexSnap ? Math.round(_cortexSnap.sBefore * 100) / 100 : null,
        ageClass: _cortexSummary ? _cortexSummary.ageClass : null,
        spacingCredit: _cortexSummary ? Math.round(_cortexSummary.spacingCredit * 1000) / 1000 : 0,
    });

    // ── Bound text-bloat: keep only the 30 most recent logs per question.
    // The UI renders the last 5 attempt dots / reversed list, so nothing
    // visible is lost while storage stays capped. ──
    if (q.historyLogs.length > 30) q.historyLogs = q.historyLogs.slice(-30);

    // ── lastReviewedAt: the kernel's own clock. ──
    // cortex.js effectiveStability() falls back to lastReviewedAt → createdAt
    // → epoch when q.lastReviewedAt is missing; without this stamp every vault
    // solve looked "never reviewed", so the age-at-solve priors and every
    // recency ordering keyed off a 1970 timestamp.
    q.lastReviewedAt = new Date().toISOString();

    // ── srUpdatedAt: per-question SR revision clock (epoch ms). ──
    // Cloud pull + sibling-tab adoption merge on this stamp, so a question
    // solved on device A today can never be overwritten by device B's stale
    // snapshot, and an idle tab's stale bank can never clobber a sibling
    // tab's fresh solve. Stamp only after every SR write above landed.
    q.srUpdatedAt = Date.now();

    // ── Every COUNTER write in this function uses the STRICT subject key.
    // normSubjKey()'s 'physics' catch-all silently credited a custom/foreign
    // subject to physics; a counter must be skipped, not misattributed. ──
    const subjKey = normSubjKeyStrict(q.subject);

    // ── Incremental nav counter: a correct SR commit bumps the CK engine's
    // "fixed today" ring in O(1) instead of it rescaming every log on the
    // next 1s tick. No-op if the CK engine isn't present — and skipped
    // entirely for a non-canonical subject, which used to be handed over RAW
    // while every neighbouring counter got the normalized key. ──
    try {
        if (_drawerState.result === 'correct' && subjKey &&
            typeof window.__ckBumpTodayFix === 'function') {
            window.__ckBumpTodayFix(subjKey);
        }
    } catch (_) {}

    // NOTE: the SR state (currentInterval / easeFactor / nextReviewAt /
    // isMastered) is written from srResult ABOVE, before the cortex block —
    // deliberately not re-assigned here, because that later write silently
    // discarded the cortex scheduler's target-retention schedule.
    //
    // ❌ q.errorReason is NOT derived from friction pills, and must not be.
    // It has exactly two owners: the error-reason modal (app.js
    // confirmErrorLog — an explicit user classification) and the manual Log
    // form. The old dominant-friction remap here was a third writer and was
    // wrong four ways at once: PERFECT ("Perfect Execution" — a flawless
    // solve) mapped to 'calculation'; the weight sort ran ASCENDING so [0]
    // was the LEAST severe pill, not the most; it had no `result` guard so it
    // fired on CORRECT solves too; and it silently overwrote the
    // classification the user had just chosen. APPROACH ("Application /
    // Approach Blank" — not knowing how to start) mapped to 'misread', which
    // makes report.js advise underlining qualifiers for a student who never
    // misread anything. Friction pills are solve telemetry that already feed
    // computeSR, the cortex and the report engine; two sources of truth
    // fighting over one field IS the bug, so the block is removed rather than
    // re-sorted. Do not re-add it.

    // ✅ FIXED: Restored legacy status fields & balanced structural brackets
    if (_drawerState.result === 'correct' && q.status !== 'solved') {
        q.status = 'solved';
        if (subjKey) {
            // Cortex fix completion → price this unit at 1.4 LU (memory work).
            try {
                Directive.markPending({
                    type: 'fix',
                    subject: subjKey,
                    chapter: q.chapter,
                    qElo: q.qElo || 0,
                    timeMins: Number(_drawerState.timeSpentMins) || undefined,
                });
            } catch (_) { /* Directive must never block the fix path */ }
            changeCount(subjKey, 1);   // canonical key — NaN guard
            // Ledger of what THIS question put into the global counters, so
            // removeErrorLog can hand it back instead of leaving the user's
            // solved ring inflated forever.
            q._solvedCredit = (Number(q._solvedCredit) || 0) + 1;
        }
    } else if (_drawerState.result === 'incorrect') {
        q.status = 'error';
        // Reverse the ledger produced by an earlier CORRECT solve of this
        // same question: the user has just failed it, so it is no longer a
        // solved count. Without this the status flipped to 'error' while
        // solved[subject] stayed inflated, and removeErrorLog then subtracted
        // the credit a second time during the purge — over-reversing.
        if (subjKey) {
            const credit = Number(q._solvedCredit) || 0;
            if (credit > 0) {
                changeCount(subjKey, -credit);
                q._solvedCredit = 0;
            }
        }
    }

    // ── Cognitive Cortex v3: commit the tag draft edited in the drawer.
    // Commits ONLY when the user actually changed the draft, and never drops
    // tags the editor never showed: _drawerTags() seeds the draft with
    // q.tags.slice(0, 6), so the old blind `q.tags = clean` destroyed
    // everything past index 6 and everything over 40 chars on EVERY log —
    // with no user interaction at all (the Array.isArray guard is always
    // true, so the "only runs when the user touched the editor" claim was
    // false). ──
    try {
        const draft = _drawerState.tagDraft;
        if (Array.isArray(draft)) {
            const existing = Array.isArray(q.tags) ? q.tags.map(String) : [];
            const seed = existing.slice(0, 6);
            const touched = draft.length !== seed.length ||
                draft.some((t, i) => String(t) !== seed[i]);
            if (touched) {
                const seen = new Set();
                const clean = [];
                const add = (val, cap) => {
                    const norm = normalizeTag(val);
                    if (!norm || seen.has(norm)) return;
                    seen.add(norm);
                    const s = String(val).trim();
                    clean.push(cap ? s.slice(0, 40) : s);
                };
                for (const raw of draft) add(raw, true);
                // Tags beyond the 6-chip window were never displayed, so they
                // cannot have been removed — carry them over verbatim.
                for (const raw of existing.slice(6)) add(raw, false);
                q.tags = clean;
            }
        }
    } catch (_) { /* tag persistence must never block the log */ }
    _bumpBankRev();

    // 🎮 Gamification effects (red flash / sounds / streak) and 🧠 Elo
    // migration now fire at the moment of truth in _applyResult() — i.e. when
    // the user clicks "Confirm Answer" / "Yes, correct" / "No, incorrect" —
    // so the feedback (colour flash, sound, +/- Elo chip in the header) shows
    // immediately, exactly like the standard question-practice modal. The
    // frozen time + eloResult are stashed on _drawerState and reused here.

    const secondsToInject = Math.round(timeSpent * 60);
    // ⚡ Pomodoro / countdown overlap guard — the practice-modal path this
    // mirrors (app.js _injectPracticeTimeIntoStudySecs) explicitly guards
    // "to avoid double counting". Without the same guard a student running a
    // Pomodoro and then drilling the Vault in the same tab had every vault
    // minute counted twice: once live by pomodoro.js and once again here.
    const pomoActive = document.body.classList.contains('pomo-active') ||
        document.body.classList.contains('timer-running') ||
        (typeof window._pomoRunning === 'boolean' && window._pomoRunning);
    if (secondsToInject > 0 && subjKey && !pomoActive) {
        // studySecs is keyed by the canonical subject. normSubjKeyStrict()
        // covers trim/lowercase plus the math aliases AND returns null for a
        // non-canonical subject, so a foreign subject can never be filed
        // under a neighbouring bucket (the local alias table this replaced
        // had no such notion — it happily keyed studySecs['biology']).
        if (subjKey in studySecs) {
            studySecs[subjKey] += secondsToInject;
            q._studySecsCredit = (Number(q._studySecsCredit) || 0) + secondsToInject;
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

/**
 * Hand back everything a deleted question put into app-wide state.
 *
 * removeErrorLog used to drop the row and reverse NOTHING: `solved[subject]`
 * stayed inflated, `studySecs` kept the seconds this question deposited, and
 * `_dailyQueueSnapshot.ids` (plus its `jeemax_daily_queue_snapshot`
 * localStorage mirror) kept naming a question that can never be served again —
 * silently shrinking the queue's "N/M done" denominator mid-day.
 *
 * submitPracticeLog ledgers each global write it makes (`_solvedCredit`,
 * `_studySecsCredit`) precisely so this reversal can be exact rather than a
 * guess. Questions logged before the ledger existed contribute nothing to
 * reverse here, which is the honest answer: we cannot know what they banked.
 */
function _purgeDeletedQuestion(target, targetId) {
    const key = normSubjKeyStrict(target.subject);
    const solvedCredits = Math.max(0, Number(target._solvedCredit) || 0);
    const secsCredits = Math.max(0, Number(target._studySecsCredit) || 0);

    if (key && solvedCredits > 0) changeCount(key, -solvedCredits);
    if (key && secsCredits > 0 && (key in studySecs)) {
        studySecs[key] = Math.max(0, studySecs[key] - secsCredits);
        if (typeof window.updateStudyTimeHeader === 'function') {
            window.updateStudyTimeHeader();
        }
    }

    // Queue snapshot: in-memory first, then the localStorage mirror, so a
    // reload cannot resurrect the dead id.
    if (Array.isArray(_dailyQueueSnapshot.ids)) {
        _dailyQueueSnapshot.ids = _dailyQueueSnapshot.ids.filter(id => String(id) !== targetId);
    }
    if (typeof localStorage !== 'undefined') {
        try {
            const raw = localStorage.getItem(DAILY_QUEUE_LS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.ids)) {
                    parsed.ids = parsed.ids.filter(id => String(id) !== targetId);
                    localStorage.setItem(DAILY_QUEUE_LS_KEY, JSON.stringify(parsed));
                }
            }
        } catch (_) { /* corrupt mirror — the in-memory purge above still stands */ }
    }
}

export function removeErrorLog(id) {
    if (confirm("Confirm deletion of this friction point and all its attempt history?")) {
        // Accept percent-encoded (_jsId) or raw ids — see _findQByHandlerId.
        let target = _findQByHandlerId(id);
        if (!target) return;
        const targetId = String(target.id);
        _purgeDeletedQuestion(target, targetId);
        AppState.questionBank = AppState.questionBank.filter(q => q.id == null || String(q.id) !== targetId);
        id = targetId;
        // Tombstone the id so a stale cloud snapshot can never resurrect it.
        recordCloudTombstone(id).catch(console.error);
        _bumpBankRev();
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
        // The board is not on screen, so #matrix-meta must describe the QUEUE
        // — leaving the board's "N of M shown / ✕ Clear filters" line up meant
        // the header described cards the user could not see. The queue's own
        // empty state replaces the filter no-match node.
        _updateDailyQueueMeta();
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

// Queue mode has its own meta line: the board's "N of M shown / ✕ Clear
// filters" description is meaningless while the queue owns the container (and
// its Clear button would have done nothing — filterErrors() short-circuits).
function _updateDailyQueueMeta() {
    const meta = document.getElementById('matrix-meta');
    if (!meta) return;
    _toggleNoMatchNode(false);   // the queue renders its own empty state
    const targets = _getDailyQueueSnapshot().map(_bankQuestionById).filter(Boolean);
    if (targets.length === 0) { meta.hidden = true; meta.innerHTML = ''; return; }
    const done = targets.filter(_isCompletedToday).length;
    meta.hidden = false;
    meta.innerHTML =
        '<span class="matrix-meta-count"><b>' + done + '</b>&nbsp;of ' + targets.length + ' done</span>' +
        '<span class="matrix-meta-due">·&nbsp;<b>' + (targets.length - done) + '</b>&nbsp;left today</span>';
}

/** Bank lookup that tolerates rows with a null id (see submitPracticeLog). */
function _bankQuestionById(id) {
    if (id == null) return null;
    const s = String(id);
    return AppState.questionBank.find(q => q.id != null && String(q.id) === s) || null;
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

// Queue-mode counterpart to the board's filter dock. While the queue is up,
// filterErrors() returns before reading #filter-status / #filter-type /
// #filter-tag, so a stale carrier plus a fully enabled control was a dead
// control that still LOOKED live (and whose `.error-filters[data-active]`
// echo advertised a filter that was never applied). Reset the carriers to
// neutral and disable the controls rather than leave them silently inert; the
// queue's own progress line lives in #matrix-meta via _updateDailyQueueMeta.
function _setQueueFilterMode(on) {
    ['filter-status', 'filter-type'].forEach(id => {
        const carrier = document.getElementById(id);
        if (!carrier) return;
        if (on) carrier.value = 'all';
        carrier.disabled = !!on;
    });
    const tagCarrier = document.getElementById('filter-tag');
    if (tagCarrier) {
        if (on) tagCarrier.value = '';
        tagCarrier.disabled = !!on;
    }
    const search = document.getElementById('matrix-search-input');
    if (search) {
        if (on) search.value = '';
        search.disabled = !!on;
    }
    const clearBtn = document.getElementById('matrix-search-clear');
    if (clearBtn) clearBtn.hidden = true;
    // Both pill groups, not just status: the type pills kept their .active
    // echo across the queue switch.
    document.querySelectorAll('.error-filters .matrix-pill').forEach(p => {
        p.disabled = !!on;
        p.classList.toggle('active', p.getAttribute('data-emf-value') === 'all');
    });
    if (on && typeof window.syncDockedEcho === 'function') {
        try { window.syncDockedEcho(); } catch (_) {}
    }
}

function _showDailyQueue() {
    const btn = document.getElementById('daily-queue-btn');
    const title = document.getElementById('error-matrix-title');
    const badge = document.getElementById('daily-queue-badge');
    if (btn) btn.classList.add('active');
    if (title) title.textContent = '⚡ Daily Core Queue';
    if (badge) badge.style.display = 'inline';
    const shell = document.querySelector('.vault-shell');
    if (shell) shell.classList.add('queue-active');
    // Queue mode REPLACES the board, and filterErrors() short-circuits to the
    // queue while it is active — so the board's filter controls are
    // meaningless here. They used to be left visible, enabled and fully armed:
    // the carriers kept whatever the board had, and every pill click or
    // keystroke called filterErrors() straight into an early return.
    _setQueueFilterMode(true);
    _renderDailyQueueCards();
    _updateDailyQueueMeta();
}

function _hideDailyQueue() {
    const btn = document.getElementById('daily-queue-btn');
    const title = document.getElementById('error-matrix-title');
    const badge = document.getElementById('daily-queue-badge');
    if (btn) btn.classList.remove('active');
    if (badge) badge.style.display = 'none';
    const shell = document.querySelector('.vault-shell');
    if (shell) shell.classList.remove('queue-active');
    _setQueueFilterMode(false);
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
        // ── Cognitive Cortex v3 ordering ──
        // Composite priority field (urgency × overdue-stress × importance ×
        // tag-leak × neglect × contagion × fatigue-brake) replaces the flat
        // "weakest easeFactor first" rule. Falls back to the exact legacy
        // comparator if the cortex context fails to build — a brain hiccup
        // must never blank the queue.
        const ctx = _cortexCtx();
        if (ctx) {
            bySubject[subj].sort((a, b) => _prioOf(b, ctx) - _prioOf(a, ctx));
            return;
        }
        // Legacy fallback: weakest-memory-first with a Memory-Kernel tiebreak.
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
    ].filter(q => q && q.id != null).map(q => String(q.id));

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
    const targets = snapshotIds.map(_bankQuestionById).filter(Boolean);

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

function _buildErrorCardHTML(q, dueInfo) {
    const tagStyle = TAG_STYLES[q.errorReason] || TAG_STYLES.conceptual;
    const tagLabel = TAG_LABELS[q.errorReason] || q.errorReason;
    // dueInfo is resolved ONCE by _buildGroupedBoardHTML and handed down: a
    // nextReviewAt crossing a boundary between the grouping pass and this pass
    // filed the card under ONE group header while data-sr-status said another,
    // and filterErrors' per-header recount then under-counted that group. The
    // daily queue renders standalone cards, so resolve it here when absent.
    const due = dueInfo || getDueStatus(q);

    // ── Personal tags ──────────────────────────────────────────────────────
    // filterErrors() matches ONLY `.error-chapter` / `.error-tag` text. The
    // chips render into `.sr-card-usertag` — a class the filter never queried
    // — so "tap to hunt this tag" wrote #filter-tag with a string no card could
    // match (0 of 4 cards visible plus the "Nothing matches those filters" card).
    // The tags are therefore mirrored as a visually hidden tail INSIDE
    // .error-chapter. The mistake-type pill keeps its single label, colour and
    // casing, and the chapter's own ellipsis is untouched (the mirror is out of
    // flow and clipped to 1px).
    const tags = (Array.isArray(q.tags) ? q.tags : [])
        .map(t => String(t == null ? '' : t).trim())
        .filter(Boolean);
    const huntMirror = tags.length
        ? `<span class="sr-chapter-tags" aria-hidden="true" style="position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0;"> ${tags.map(t => '#' + _esc(t)).join(' ')} </span>`
        : '';

    // ── Cognitive Cortex v3 card telemetry (all reads are pure + guarded) ──
    // Live retrievability, days-sitting-overdue and age-since-logging turn the
    // card into an honest memory readout instead of a bare interval counter.
    let rPct = null, ageTxt = '';
    try { rPct = Math.round(cortexRetrievability(q) * 100); } catch (_) { rPct = null; }
    try {
        const cMs = new Date(q.createdAt || '').getTime();
        if (!isNaN(cMs)) {
            const d = Math.floor((Date.now() - cMs) / MS_PER_DAY);
            ageTxt = d <= 0 ? 'today' : (d >= 60 ? Math.floor(d / 30) + 'mo' : d + 'd');
        }
    } catch (_) { ageTxt = ''; }

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
                 data-sr-status="${_esc(due.status)}"
                 data-subject="${_esc(q.subject)}"
                 onclick="openPracticeDrawer('${_jsId(q.id)}')" title="Open practice session">
                <div class="error-img-box">
                    ${imgHtml}
                    <span class="sr-due-badge sr-due--${_esc(due.status)}" title="Spaced-repetition schedule for this mistake">${_esc(_dueLabel(due, q))}</span>
                </div>
                <div class="error-details">
                    <div class="error-chapter">${_esc(q.chapter || 'Unknown')}${huntMirror}</div>
                    <div class="error-tag-row">
                        <span class="error-tag error-tag--${_esc(q.errorReason || 'conceptual')}" style="color:${tagStyle.color};background:${tagStyle.bg};">${_esc(tagLabel)}</span>
                        ${tags.length
                            // The hunted token rides a data attribute (percent-encoded
                            // by _jsId and decoded on tap) instead of a JS string literal:
                            // _esc() does not encode backslashes or the HTML entity pass
                            // un-does '&quot;', so a tag ending in "\" or a quote broke the
                            // whole inline handler — stopPropagation never ran and the tap
                            // fell through to the card root and opened the practice drawer.
                            // Stripping "'" from the argument (but not the label) also made
                            // "boy's law" hunt for "boys law".
                            ? tags.slice(0, 3).map(t => `<span class="sr-card-usertag" title="Personal tag — tap to hunt this tag" data-hunt-tag="${_esc(_jsId(t))}" onclick="event.stopPropagation();window.__cortexHuntTag&&__cortexHuntTag(decodeURIComponent(this.getAttribute('data-hunt-tag')||''))">#${_esc(t)}</span>`).join('')
                            : ''}
                    </div>
                    <div class="sr-stats-row">
                        <span class="sr-stat${rPct != null ? (rPct >= 90 ? ' sr-stat--ok' : rPct >= 80 ? ' sr-stat--warn' : ' sr-stat--crit') : ''}" title="Live retrievability — the brain's current recall odds for this mistake"><b>${rPct != null ? rPct + '%' : '—'}</b><i>recall</i></span>
                        <span class="sr-stat" title="Spaced-repetition interval — how long this memory currently survives"><b>${_numOr(q.currentInterval, 0)}d</b><i>interval</i></span>
                        <span class="sr-stat" title="Ease factor — higher means recall is sticking"><b>${_numOr(q.easeFactor, 2.5).toFixed(2)}</b><i>ease</i></span>
                        ${ageTxt ? `<span class="sr-stat" title="Time since this mistake was logged (age at every solve feeds cortex priors)"><b>${_esc(ageTxt)}</b><i>logged</i></span>` : `<span class="sr-stat" title="Target time per attempt"><b>${_numOr(q.targetTimeMins, 5)}m</b><i>target</i></span>`}
                    </div>
                    <div class="sr-attempt-dots-row">
                        <span class="sr-dots-label">History</span>
                        ${_buildAttemptDots(q.historyLogs)}
                    </div>
                </div>
                <div class="sr-card-actions">
                    <button class="sr-practice-btn" onclick="event.stopPropagation();openPracticeDrawer('${_jsId(q.id)}')">Practice Now<span class="sr-btn-arrow">→</span></button>
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

// Manual-log re-entrancy latch. The modal's submit button (index.html) carries
// no disabled state, so a double-click ran the whole handler twice: the second
// run read the ALREADY-CLEARED chapter field and filed a phantom
// "Uncategorized" mistake that the daily queue then resurfaced forever.
let _addErrorBusy = false;

export function addErrorBlock() {
    if (_addErrorBusy) return;

    const chapterEl = document.getElementById('new-err-chapter');
    const typeEl = document.getElementById('new-err-type');
    if (!chapterEl || !typeEl) return;
    const typeValue = typeEl.value;

    // A whitespace-only chapter is TRUTHY: it was stored verbatim and filed
    // under a chapter that matches no tile. Collapse, cap, and fall back to the
    // placeholder only when there is genuinely nothing left.
    const chapter = String(chapterEl.value || '').replace(/\s+/g, ' ').trim().slice(0, 120).trim() || 'Uncategorized';

    // Every manual log carries the SAME extractedText constant, so the chapter
    // is the only field that tells two manual entries apart — a second log of
    // the same chapter is an indistinguishable copy that the SR engine then
    // resurfaces on its own schedule.
    const chapterKey = chapter.toLowerCase();
    const duplicate = AppState.questionBank.some(q => q && q.errorReason &&
        (q.status === 'error' || q.status === 'solved' || q.status === 'wrong') &&
        _normSubj(q.subject) === _normSubj(AppState.currentErrorSubject) &&
        String(q.chapter || '').replace(/\s+/g, ' ').trim().toLowerCase() === chapterKey);
    if (duplicate) {
        (window.__jmaxAppToast || alert)('⚠ "' + chapter + '" is already in this vault — open that card and log an attempt on it instead of filing a copy.');
        return;
    }

    const modal = chapterEl.closest ? chapterEl.closest('.modal-content') : null;
    const submitBtn = modal ? modal.querySelector('button.btn-primary') : null;
    _addErrorBusy = true;
    if (submitBtn) submitBtn.disabled = true;
    // The body below is synchronous, so the double-click window is exactly this
    // turn. Release on the next macrotask: that also un-latches (and re-enables
    // the button) even if something below faults mid-save.
    setTimeout(() => { _addErrorBusy = false; if (submitBtn) submitBtn.disabled = false; }, 0);

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
        // Cognitive Cortex v3 — creation anchor for age-at-solve priors.
        createdAt: new Date().toISOString(),
    };

    AppState.questionBank.push(newErrorQ);
    _bumpBankRev();
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
// When an item is READY but has sat overdue, quantify it — "how long was this
// left due" is a first-class cortex signal, not silent pressure (Cortex v3).
function _dueLabel(dueInfo, q) {
    switch (dueInfo && dueInfo.status) {
        case 'ready': {
            let late = 0;
            try {
                const t = new Date((q && q.nextReviewAt) || '').getTime();
                if (!isNaN(t)) late = Math.max(0, (Date.now() - t) / MS_PER_DAY);
            } catch (_) { late = 0; }
            return late >= 1 ? 'Due now · ' + Math.floor(late) + 'd late' : 'Due now';
        }
        case 'due_soon':  return 'Due in ' + (dueInfo.daysUntil ?? '?') + 'd';
        case 'scheduled': return 'In ' + (dueInfo.daysUntil ?? '?') + 'd';
        case 'mastered':  return 'Mastered';
        default:          return (dueInfo && dueInfo.label) || '';
    }
}

function _buildAttemptDots(historyLogs) {
    // A truthy NON-array ('[]' stored as a string, or {}) passed the old
    // length guard and then threw on .slice() — and because the throw escaped
    // before c.innerHTML was assigned, it blanked the ENTIRE board (and every
    // caller above it: filterErrors, the dashboard). submitPracticeLog and
    // migrateQuestionBankSR both normalise this field; the render paths are the
    // only consumers that didn't.
    if (!Array.isArray(historyLogs) || historyLogs.length === 0) return '<span class="sr-dots-empty">No attempts yet</span>';

    const last5 = historyLogs.slice(-5).reverse();
    return last5.map(raw => {
        const log = raw && typeof raw === 'object' ? raw : {};
        const isCorrect = log.result === 'correct';
        const frictionTypes = _parseFrictionTypes(log.frictionTypes);
        // List EVERY pill, exactly as the history row does. frictionTypes[0] is
        // the first pill TAPPED (push order), not the dominant one, so the dot
        // could contradict its own card's tag.
        const frictionLabel = frictionTypes.length
            ? frictionTypes.map(f => SR_FRICTION_LABELS[f] || f).join(', ')
            : 'N/A';
        const ts = new Date(log.timestamp);
        const dateStr = isNaN(ts.getTime()) ? 'unknown date' : formatSRDate(log.timestamp);
        const timeStr = String(log.timeSpentMins == null ? '' : log.timeSpentMins) + 'm';
        // '\n' is a real newline: '\\n' inside a template literal is a literal
        // backslash + n, so every hover showed the escape on one run-on line.
        const tooltip = `title="${_esc(dateStr + '\nTime: ' + timeStr + '\nFriction: ' + frictionLabel)}"`;

        return `<div class="sr-attempt-dot ${isCorrect ? 'is-correct' : 'is-wrong'}" ${tooltip}></div>`;
    }).join('');
}

function _buildHistoryLogs(historyLogs) {
    // Same non-array blast radius as the attempt dots (see above): these two
    // render paths were the only unguarded consumers of historyLogs.
    if (!Array.isArray(historyLogs) || historyLogs.length === 0) return '';

    return historyLogs.slice().reverse().map(raw => {
        const log = raw && typeof raw === 'object' ? raw : {};
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
                        <span style="color:#888;">${_esc(String(log.autonomy == null ? '' : log.autonomy).replace('_', ' '))}</span>
                    </div>
                    <div class="sr-history-frictions">${frictionPills}</div>
                </div>
                <div class="sr-history-meta">
                    <div style="color:#666;">${dateStr}</div>
                    <div style="color:#555;">${_esc(log.timeSpentMins)}m · EF ${_numOr(log.newEaseFactor, 2.5).toFixed(2)}</div>
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
    // getDueStatus() is resolved ONCE per card and carried down into the card
    // body. Calling it twice let a nextReviewAt that crossed a boundary between
    // the grouping pass and the card pass file the card under ONE group header
    // while its data-sr-status said another — filterErrors' per-header recount
    // then under-counted the group it was placed in.
    const withStatus = errs.map(q => { const due = getDueStatus(q); return { q, due, st: due.status }; });
    // ── Cognitive Cortex v3 within-group ordering: composite priority field,
    // highest first. The cortex context is computed ONCE for the whole board
    // (memoized on _bankRev) so N cards don't rebuild profiles N times.
    // Legacy easeFactor sort remains the fallback path. ──
    const ctx = _cortexCtx();
    withStatus.sort((a, b) => {
        const sa = EM_STATUS_ORDER[a.st] ?? 9;
        const sb = EM_STATUS_ORDER[b.st] ?? 9;
        if (sa !== sb) return sa - sb;
        if (ctx) return _prioOf(b.q, ctx) - _prioOf(a.q, ctx);
        return _numOr(a.q.easeFactor, 2.5) - _numOr(b.q.easeFactor, 2.5);
    });

    const countByStatus = {};
    withStatus.forEach(x => { countByStatus[x.st] = (countByStatus[x.st] || 0) + 1; });

    const parts = [];
    let lastStatus = null;
    for (const { q, st, due } of withStatus) {
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
        parts.push(_buildErrorCardHTML(q, due));
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
                // Card root opens the practice drawer on click, so the image
                // must keep the template's stopPropagation in BOTH states —
                // otherwise a loaded image fires the lightbox AND the drawer.
                img.onclick = (e) => { e.stopPropagation(); openLightbox(base64); };
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
    const img = document.getElementById('lightbox-img');
    if (!img) return;   // stripped DOM (lockdown/modal teardown) — never throw
    img.src = src;
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

// ── Chapter identity ────────────────────────────────────────────────────────
// ONE spelling for "which chapter is this?" across every chapter-keyed surface
// below (health lookup, decay-grid grouping + coverage, drilldown matching).

// Canonical chapter bucket key: <canonicalSubject>::<encodeURIComponent(name)>.
//   • normSubjKey folds Math/Mathematics into maths (same join the Chapter
//     Progress ledger uses — the old subject+'||'+chapter join corrupted
//     pairing whenever a chapter name contained '||').
//   • encodeURIComponent makes that join unambiguous.
//   • trim + lowercase on the chapter makes 'Mechanics', ' mechanics' and
//     'MECHANICS' ONE bucket instead of three row/coverage/drilldown splits.
function _chapterKey(subject, chapter) {
    const name = String(chapter == null ? '' : chapter).trim().toLowerCase() || 'Uncategorized';
    return normSubjKey(subject) + '::' + encodeURIComponent(name);
}

// Chapter-name equality for callers that already matched the subject half.
// Mirrors app.js's `_chaptersMatch` (trim + lowercase).
function _sameChapter(a, b) {
    return String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();
}

// Exposed for the Daily Briefing flow — the SAME health model the Chapter
// Health Grid renders, so the boot flow's "weakest chapter first" ordering
// always matches what the user sees in-app (no divergent reimplementation).
window.getChapterHealth = (subject, chapter) => {
    try {
        const qs = AppState.questionBank.filter(q =>
            q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong') &&
            _normSubj(q.subject) === _normSubj(subject) && _sameChapter(q.chapter, chapter)
        );
        return _matrixChapterHealthContinuous(qs);
    } catch (_) { return 50; }
};

// Exposed for the Daily Briefing flow — the locked-in Daily Fix Queue in
// priority order (ready errors, cortex-priority first, 5P/5M/10C). The
// boot flow feeds this order straight into the practice queue.
window._getDailyQueueSnapshot = () => {
    try { return _getDailyQueueSnapshot(); } catch (_) { return []; }
};

// ── Cognitive Cortex v3 shared surfaces ─────────────────────────────────────

// Card tag chip → hunt this tag across the vault (reuses the search filter).
window.__cortexHuntTag = function (tag) {
    try {
        const input = document.getElementById('matrix-search-input');
        if (!input) return;
        input.value = String(tag == null ? '' : tag);
        if (typeof window.setMatrixSearch === 'function') window.setMatrixSearch(input.value);
        const errorsNav = document.querySelector('.nav-item[data-tab="errors"]');
        if (errorsNav && typeof window.switchTab === 'function') window.switchTab('errors', errorsNav);
    } catch (_) { /* navigation nicety — never crash on a chip tap */ }
};

let _cortexStylesInjected = false;
function _injectCortexStyles() {
    if (_cortexStylesInjected) return;
    _cortexStylesInjected = true;
    const style = document.createElement('style');
    style.id = 'cortex-v3-styles';
    style.textContent = `
.sr-stat--ok b { color:#34d399; }
.sr-stat--warn b { color:#fbbf24; }
.sr-stat--crit b { color:#f87171; }
.sr-card-usertag {
  display:inline-block; margin:2px 4px 0 0; padding:1px 7px; border-radius:999px;
  font-size:9.5px; letter-spacing:.3px; cursor:pointer;
  color:#93c5fd; background:rgba(147,197,253,0.08); border:1px solid rgba(147,197,253,0.18);
}
.sr-card-usertag:hover { background:rgba(147,197,253,0.16); }
.sr-tagedit { width:100%; }
.sr-tagedit-chips { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:6px; min-height:18px; }
.sr-tagedit-none { font-size:10.5px; color:#66708a; }
.sr-tagedit-chip {
  display:inline-flex; align-items:center; gap:4px; padding:2px 4px 2px 8px;
  border-radius:999px; font-size:11px; color:#bfdbfe;
  background:rgba(96,165,250,0.12); border:1px solid rgba(96,165,250,0.25);
}
.sr-tagedit-x {
  background:none; border:none; color:#93c5fd; cursor:pointer; font-size:9px;
  padding:1px 4px; border-radius:50%; line-height:1;
}
.sr-tagedit-x:hover { background:rgba(239,68,68,0.25); color:#fecaca; }
.sr-tagedit-inputrow { display:flex; align-items:center; gap:8px; }
.sr-tagedit-input {
  flex:1; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12);
  border-radius:8px; padding:6px 10px; color:#e8eefb; font-size:12px; outline:none;
}
.sr-tagedit-input:focus { border-color:rgba(96,165,250,0.5); }
.sr-tagedit-count { font-size:10px; color:#66708a; white-space:nowrap; }
.sr-tagedit-suggs { display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; align-items:center; }
.sr-tagedit-sugg {
  background:none; border:1px dashed rgba(147,197,253,0.35); border-radius:999px;
  color:#93c5fd; font-size:10px; padding:2px 9px; cursor:pointer;
}
.sr-tagedit-sugg:hover { background:rgba(147,197,253,0.12); }
.dd-contagion {
  margin:8px 12px 0; padding:7px 10px; border-radius:9px; font-size:11px; line-height:1.5;
  background:rgba(251,113,133,0.09); border:1px solid rgba(251,113,133,0.28); color:#fda4af;
}
.dd-tagleaks { padding:6px 12px 2px; }
.dd-tagleak-row {
  display:flex; align-items:center; gap:8px; padding:4px 2px; font-size:11px;
  color:#cdd9f2; cursor:pointer; border-radius:6px;
}
.dd-tagleak-row:hover { background:rgba(255,255,255,0.05); }
.dd-tagleak-bar { flex:1; height:4px; border-radius:2px; background:rgba(255,255,255,0.07); overflow:hidden; }
.dd-tagleak-bar i { display:block; height:100%; border-radius:2px; }
`;
    document.head.appendChild(style);
}

/**
 * Cortex summary strip for the decay drilldown: contagion banner (recent
 * sibling lapses in this chapter) + top personal-tag leak bars. Pure reads,
 * fully guarded — renders nothing on any fault.
 */
function _renderCortexDrilldownExtras(subject, chapterName, items) {
    _injectCortexStyles();
    let html = '';
    try {
        const ctx = _cortexCtx();
        if (!ctx) return html;
        // Contagion banner — lapses among THIS chapter's items in the last 14d.
        try {
            const chapKey = String(chapterName || '').trim().toLowerCase();
            const ids = new Set(items.map(q => String(q.id)));
            const recent = (ctx.lapseEvents || []).filter(ev =>
                ev.chapter === chapKey && ids.has(ev.id));
            if (recent.length >= 2) {
                html += '<div class="dd-contagion">⚠ <b>' + recent.length +
                    ' sibling lapses here in the last 21d</b> — these memories are entangled; one more lapse resurfaces all of them.</div>';
            }
        } catch (_) {}
        // Per-tag leak rows for the chapter's personal vocabulary.
        try {
            const counts = new Map();
            for (const q of items) {
                for (const raw of (Array.isArray(q.tags) ? q.tags : [])) {
                    const norm = normalizeTag(raw);
                    if (!norm) continue;
                    if (!counts.has(norm)) counts.set(norm, { label: String(raw).trim(), n: 0 });
                    counts.get(norm).n++;
                }
            }
            const rows = [...counts.entries()]
                .map(([norm, e]) => ({ norm, label: e.label, leak: leakOfSafe(ctx.profiles, 'p:' + norm), df: e.n }))
                .filter(r => r.leak != null)
                .sort((a, b) => (b.leak - a.leak) || (b.df - a.df))
                .slice(0, 5);
            if (rows.length) {
                html += '<div class="dd-tagleaks"><div style="font-size:10px;color:#8aa0c8;margin-bottom:2px;">Personal-tag leakiness (red = your passes don\'t hold):</div>' +
                    rows.map(r => {
                        const pct = Math.round(r.leak * 100);
                        const col = pct >= 60 ? '#f87171' : pct >= 40 ? '#fbbf24' : '#34d399';
                        return '<div class="dd-tagleak-row" data-hunt="' + _esc(r.label) + '" title="Tap to hunt #' + _esc(r.label) + ' across the vault">' +
                            '<span style="min-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">#' + _esc(r.label) + '</span>' +
                            '<span class="dd-tagleak-bar"><i style="width:' + pct + '%;background:' + col + '"></i></span>' +
                            '<span style="color:' + col + ';min-width:30px;text-align:right;">' + pct + '%</span></div>';
                    }).join('') + '</div>';
            }
        } catch (_) {}
    } catch (_) {}
    return html;
}

function leakOfSafe(profiles, key) {
    try { return leakOf(profiles, key); } catch (_) { return null; }
}

const MS_PER_DAY = 86400000;

// Trend baseline per chapter key — powers the ↑/↓ arrows. Value is
// { health, ts, sig }: `sig` is the chapter's member-id signature, so an
// edit to the chapter (an error deleted, a new one filed) invalidates the
// baseline instead of reporting a composition change as "decay".
// Module-scoped (resets on boot by design: trends compare within a session).
const _decayTrendCache = new Map();
// app.js re-renders this grid on EVERY updateUI, so a baseline written seconds
// ago measures nothing but the clock. A "trend" needs a real gap: compare
// against the oldest sample at least this old, then roll it forward.
const DECAY_TREND_MIN_AGE_MS = 60 * 60 * 1000;

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
        q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong') && !isMockQuestion(q)
    );
    const chapterMap = {};
    allErrors.forEach(q => {
        if (isMockChapterName(q.chapter)) return; // belt-and-braces: unstamped Mock tiles never surface
        const subject = q.subject || '';
        const chapter = q.chapter || 'Uncategorized';
        // Canonical bucket key (see _chapterKey): the raw subject+'||'+chapter
        // join corrupted pairing whenever a chapter name contained '||', and
        // split 'Mechanics' / 'mechanics' into two rows over ONE coverage
        // bucket — each then reporting a fraction of the real denominator in
        // its own title while both opened the same mixed drilldown.
        const key = _chapterKey(subject, chapter);
        if (!chapterMap[key]) chapterMap[key] = { key, name: chapter, subject, questions: [] };
        chapterMap[key].questions.push(q);
    });

    // Coverage denominators: EVERY registered bank question per chapter, so
    // untouched chapters are visible as 0% attempted instead of invisible.
    // Mock-test questions are excluded — test bulk must not dilute coverage.
    const covTotals = {};
    AppState.questionBank.forEach(q => {
        if (isMockQuestion(q)) return;
        const key = _chapterKey(q.subject, q.chapter);   // SAME key the grid rows group on
        covTotals[key] = (covTotals[key] || 0) + 1;
    });

    const examMs = _examDateMsSafe();
    const nowMs = Date.now();

    const chapters = Object.values(chapterMap).map(({ key, name, subject, questions }) => {
        const avgEF = questions.reduce((sum, q) => sum + _numOr(q.easeFactor, 2.5), 0) / questions.length;
        const stats = chapterMemoryStats(questions, { examDateMs: examMs, nowMs: nowMs });
        const health = stats ? stats.health : 50;
        const forecast = stats ? stats.forecastHealth : null;
        const total = covTotals[key] || questions.length;
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
        const sig = questions.length + ':' + questions.map(q => String(q.id == null ? '' : q.id)).sort().join(',');
        const prev = _decayTrendCache.get(key);
        // A baseline only describes real decay if the chapter still holds the
        // same questions AND the sample is at least an hour old. Re-rendering
        // seconds later (every updateUI) or re-filing an error under the same
        // name must not draw an arrow against a stale reading.
        const baseline = (prev && prev.sig === sig && (nowMs - prev.ts) >= DECAY_TREND_MIN_AGE_MS) ? prev.health : null;
        const trend = (baseline == null || Math.abs(baseline - health) < 0.5) ? 0 : (health > baseline ? 1 : -1);
        return { key, name, subject, health, forecast, stats, coverage, weight, risk, fluency, trend, sig, questionCount: questions.length, avgEF };
    });
    // Prune baselines for chapters that no longer exist (errors deleted,
    // chapter renamed) so the map cannot grow unboundedly across a session.
    const liveKeys = new Set(chapters.map(ch => ch.key));
    _decayTrendCache.forEach((_v, k) => { if (!liveKeys.has(k)) _decayTrendCache.delete(k); });
    // Most exam-dangerous chapter first.
    chapters.sort((a, b) => b.risk - a.risk);
    if (chapters.length === 0) {
        container.innerHTML = '<div class="rh-empty">No retention data yet; log errors and they will surface here.</div>';
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
><span class="rh-name"><span class="ch-full">${_esc(ch.name)}</span><span class="ch-short" aria-hidden="true">${_esc(shortChapterName(ch.name))}</span></span><span class="rh-gauge" aria-hidden="true"><i class="rh-cov" style="width:${covPct}%"></i><i class="rh-line" style="width:${h.toFixed(1)}%"></i>${fc != null ? `<i class="rh-fc" style="left:${fc.toFixed(1)}%"></i>` : ''}<i class="rh-dot" style="left:${h.toFixed(1)}%"></i></span><span class="rh-val">${Math.round(h)}<em>%</em>${trend}</span><span class="rh-hz ${horizonCls}">${_esc(horizonTxt)}</span></div>`;
    }).join('');

    // Commit this render's health as the NEXT baseline — but only once the
    // stored sample has aged past the trend window, so the baseline is a real
    // point in time instead of "whatever the previous render said".
    chapters.forEach(ch => {
        const cur = _decayTrendCache.get(ch.key);
        if (!cur || !cur.sig || (nowMs - cur.ts) >= DECAY_TREND_MIN_AGE_MS) {
            _decayTrendCache.set(ch.key, { health: ch.health, ts: nowMs, sig: ch.sig });
        }
    });

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
    // SAME membership predicate the grid row counts with (errorReason + logged
    // status + non-mock), and the SAME canonical chapter key — otherwise the
    // panel header claims more "tracked items" than the row it was opened from
    // and lists items that row's numbers deliberately exclude.
    const key = _chapterKey(subject, chapterName);
    const items = AppState.questionBank.filter(q =>
        q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong') &&
        !isMockQuestion(q) && _chapterKey(q.subject, q.chapter) === key
    );
    if (!items.length) {
        // Malformed args (decodeURIComponent fell back to a still-encoded name)
        // used to return silently: the tap did nothing and the user was stuck
        // with no panel and no way back. Say so inside a dismissible panel.
        _injectDecayDrilldownStyles();
        document.querySelectorAll('.decay-drill-overlay').forEach(o => o.remove());
        const blank = document.createElement('div');
        blank.className = 'decay-drill-overlay';
        blank.innerHTML =
            '<div class="decay-drill-panel" role="dialog" aria-label="Item decay drilldown">' +
            '<div class="decay-drill-head">' +
            '<span class="decay-drill-title">🧠 ' + _esc(chapterName) + '</span>' +
            '<button class="decay-drill-close" type="button" aria-label="Close">✕</button>' +
            '</div>' +
            '<div class="decay-drill-list"><div class="decay-item">' +
            '<div class="dd-meta">No tracked items in this chapter — it may have been renamed, or its errors cleared.</div>' +
            '</div></div>' +
            '</div>';
        const closeBlank = () => { if (blank.parentNode) blank.parentNode.removeChild(blank); document.removeEventListener('keydown', onBlankKey, true); };
        const onBlankKey = (e) => { if (e.key === 'Escape') closeBlank(); };
        blank.querySelector('.decay-drill-close').addEventListener('click', closeBlank);
        blank.addEventListener('click', (e) => { if (e.target === blank) closeBlank(); });
        document.addEventListener('keydown', onBlankKey, true);
        document.body.appendChild(blank);
        return;
    }
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
    // Cognitive Cortex v3 — contagion banner + per-tag leak rows (guarded;
    // renders '' on any fault so the legacy panel is untouched).
    const cortexExtras = _renderCortexDrilldownExtras(subject, chapterName, items);
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
        cortexExtras +
        '<div class="decay-drill-list">' + rows + '</div>' +
        '</div>';
    // Cortex leak rows → hunt that tag in the vault.
    overlay.addEventListener('click', (e) => {
        const huntRow = e.target.closest && e.target.closest('.dd-tagleak-row');
        if (huntRow && typeof window.__cortexHuntTag === 'function') {
            close();
            window.__cortexHuntTag(huntRow.getAttribute('data-hunt'));
        }
    });
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
    // Chapter names arrive from two directions: bank rows carry their own
    // spelling, while a manual log (addErrorBlock) stores the raw free text
    // the user typed ("  Modern Physics "). Fold case + whitespace on BOTH
    // sides so a case/whitespace variant resolves to the chapter's REAL bank
    // totals instead of totals[key]||0 → pct 0 → is-void → sorted first.
    const normName = (n) => String(n == null ? '' : n).trim().toLowerCase();
    const totals = {};
    const solvedCounts = {};
    const displayName = {};   // first-seen raw spelling per key, kept for display

    // Keys are <canonicalSubject>::<encodeURIComponent(chapter)> — the old
    // subject+'||'+chapter join corrupted pairing whenever a chapter name
    // contained '||', and left raw subjects free to hit inline handlers.
    // Mock-test questions are dashboard-invisible: they file under
    // `Mock: *` chapters with their own tile + Test view, and must not move
    // chapter-progress percentages.
    AppState.questionBank.forEach(q => {
        if (isMockQuestion(q)) return;
        const key = normSubjKey(q.subject) + '::' + encodeURIComponent(normName(q.chapter));
        totals[key] = (totals[key] || 0) + 1;
        if (displayName[key] === undefined) displayName[key] = String(q.chapter == null ? '' : q.chapter).trim();
        if (q.status === 'solved') solvedCounts[key] = (solvedCounts[key] || 0) + 1;
    });

    const rows = [];
    ['physics', 'chemistry', 'maths'].forEach(subj => {
        (AppState.chapters[subj] || []).forEach(name => {
            if (isMockChapterName(name)) return;
            if (!String(name == null ? '' : name).trim()) return; // blank tiles can never render
            const key = subj + '::' + encodeURIComponent(normName(name));
            rows.push({ subj, norm: normName(name), name: String(name).trim(), total: totals[key] || 0, solved: solvedCounts[key] || 0 });
        });
    });

    // Self-heal: bank questions orphaned from the chapter list still get a row.
    Object.keys(totals).forEach(key => {
        const sep = key.indexOf('::');
        const subj = key.slice(0, sep);
        let name = '';
        try { name = decodeURIComponent(key.slice(sep + 2)); } catch (_) { name = key.slice(sep + 2); }
        if (isMockChapterName(name)) return;
        if (!String(name).trim()) return; // nameless ghosts stay invisible here; the vault purge row owns them
        if (!rows.some(r => r.subj === subj && r.norm === name)) {
            rows.push({ subj, norm: name, name: displayName[key] || name, total: totals[key], solved: solvedCounts[key] || 0 });
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
        container.classList.remove('is-expanded');   // no button left to collapse it
        return;
    }

    // Render the FULL ledger; styles-chapters.css shows a capped window
    // (first CPX_MAX_VISIBLE rows) and "+N more" expands it in place.
    const overflow = Math.max(0, rows.length - CPX_MAX_VISIBLE);
    const safeAttr = s => escapeHtml(s).replace(/"/g, '&quot;');

    const rowHtml = (r, i) => {
        const cls = ['cpx-row'];
        if (r.total === 0) cls.push('is-void');      // registered but untouched
        // THE weakest — only accent, and only for a chapter that actually has
        // bank questions. An untouched (`is-void`) row is a place-holder, not
        // the weakest chapter, and must never wear the single accent.
        if (i === 0 && r.total > 0) cls.push('is-flag');
        if (r.pct >= 100) cls.push('is-done');
        const name = safeAttr(r.name);
        return `<div class="${cls.join(' ')}" role="button" tabindex="0"` +
               ` data-subj="${r.subj}" data-enc="${encodeURIComponent(r.name)}" data-pct="${r.pct}"` +
               ` aria-label="${name} · ${r.pct}% complete" title="${name} · ${r.pct}% complete">` +
               `<span class="cpx-subj" aria-hidden="true">${SUBJ_META[r.subj] || '·'}</span>` +
               `<span class="cpx-name"><span class="ch-full">${escapeHtml(r.name)}</span><span class="ch-short" aria-hidden="true">${escapeHtml(shortChapterName(r.name))}</span></span>` +
               `<span class="cpx-track" aria-hidden="true"><i style="width:${r.pct}%"></i></span>` +
               `<span class="cpx-pct">${r.pct}<i>%</i></span>` +
           `</div>`;
    };

    // `is-expanded` lives on the CONTAINER and survives this innerHTML wipe,
    // so the rebuilt button must be re-derived from it — otherwise solving a
    // question (every updateUI re-renders here) leaves the rows expanded while
    // the button still reads "+N more" and the next tap COLLAPSES the list.
    const wasExpanded = container.classList.contains('is-expanded');
    container.innerHTML =
        '<div class="cpx-cols" aria-hidden="true">Chapter &middot; weakest first</div>' +
        '<div class="cpx-rows">' + rows.map(rowHtml).join('') + '</div>' +
        (overflow > 0
            ? `<button type="button" class="cpx-more" data-open="${wasExpanded ? '1' : '0'}"` +
              ` data-more-label="+ ${overflow} more" data-less-label="Show less">${wasExpanded ? 'Show less' : '+ ' + overflow + ' more'}</button>`
            : '');

    // Width-in animation only on the first paint after page load — later
    // re-renders (each solve triggers updateUI) must NOT replay the motion.
    container.classList.toggle('cpx-animate', firstPaint);
    container.classList.toggle('is-expanded', overflow > 0 && wasExpanded);

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
// Returns the single lowest-memory-health question from the vault Chapter
// Decay Grid — the tracked item that is hardest to retrieve right now. This
// is what the Checkpoint serves during lockdown, so the pool must be the SAME
// set the grid counts (logged errors/mistakes, non-mock) and the ranking must
// be the SAME kernel metric the grid, drilldown and cards use.
export function getLowestHealthQuestion() {
    // Identical to the grid's membership predicate: an errorReason actually
    // logged under error/wrong/solved, and not mock-test bulk. Without the
    // errorReason test this handed out ordinary solved practice questions that
    // were never mistakes.
    const inVault = (q) => !!q && !!q.errorReason &&
        (q.status === 'error' || q.status === 'wrong' || q.status === 'solved') &&
        !isMockQuestion(q);
    const vault = AppState.questionBank.filter(inVault);
    // Fallback is the SAME tracked pool, never the whole bank — a mastered,
    // never-attempted or `Mock:` chapter question must not be served here.
    const due = vault.filter(q => getDueStatus(q).status === 'ready');
    const pool = due.length ? due : vault;
    if (!pool.length) return null;
    // Rank by memory-kernel retrievability — the exact value the Decay Grid
    // gauges and the drilldown sorts on. easeFactor said nothing about what is
    // about to be forgotten, and corrupt values hijacked the pick.
    const r = (q) => { try { return currentRetrievability(q); } catch (_) { return 1; } };
    const sorted = [...pool].sort((a, b) => r(a) - r(b));   // copy — never mutates state
    return sorted[0] || null;
}

// ==================== ERROR RESOLUTION ENGINE ====================

let _todayKeyCache = null;
let _lastRenderedDate = null;
let _rolloverWatchStarted = false;

// Null-safe numeric coercion: corrupt/legacy STRING values (e.g. "2.7") or
// NaN must never crash .toFixed() or poison comparators.
//
// nullish/blank/false must take the FALLBACK, not coerce to 0. `Number(null)`
// and `Number('')` are both 0, so a question with `easeFactor: null` rendered a
// physically impossible "EF 0.00" on its card and sorted FIRST in
// getLowestHealthQuestion — i.e. corrupt data hijacked Checkpoint lockdown.
function _numOr(v, fallback) {
    if (v === null || v === undefined || v === '' || v === false) return fallback;
    const n = Number(v);
    return isFinite(n) ? n : fallback;
}

/** Round to 1 decimal; null/NaN/corrupt ⇒ null (cortex log fields). */
function _r1(v) {
    // Number(null) === 0, which turned a MISSING createdAt into a persisted
    // ageAtSolveDays of 0 — "solved the instant it was created", flattering the
    // hot-strike / cold-revival priors with fabricated evidence.
    if (v === null || v === undefined || v === '' || v === false) return null;
    const n = Number(v);
    return isFinite(n) ? Math.round(n * 10) / 10 : null;
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

// frictionTypes may be a JSON STRING, a (legacy) raw array, or a bare legacy
// token. Delegates to the CANONICAL parser in storage.js so this module, cortex.js,
// report.js and app.js all agree — they previously split into two behaviours
// (drop vs keep bare tokens) and the same log row could show no pill on the card
// while the report counted a real mistake from it.
function _parseFrictionTypes(raw) {
    return parseFrictionTypes(raw);
}

export function refreshErrorDashboardIfStale() {
    const today = _todayKey();
    if (_lastRenderedDate !== today) {
        _lastRenderedDate = today;
        renderErrorResolutionDashboard();
        // The daily queue is the only other surface whose "done today" state is
        // derived from historyLogs, and nothing else re-rendered it on a date
        // change — so an open queue kept showing yesterday's completions struck
        // through with a stale "N/M done" until the user touched a filter.
        if (_dailyQueueActive) {
            try { _renderDailyQueueCards(); _updateDailyQueueMeta(); } catch (_) {}
        }
        // The sparkline we just drew is only the intermediate data carrier —
        // app.js's candlestick renderer (renderMomentumCandles) reads the
        // points back and replaces the container. Re-chain it so the rollover
        // watcher / focus / visibility re-renders don't leave the sparkline
        // permanently clobbering the candles.
        try { if (typeof window.renderMomentumCandles === 'function') window.renderMomentumCandles(); } catch (_) {}
    }
}

// -- Filter dock ----------------------------------------------------------------
// V2: the toolbar is already a single slim row, so docking only tightens
// padding (.emf-docked) instead of collapsing to search-only. The sentinel
// + observer contract is unchanged (QA asserts the class toggles).
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
// Guarded: this module is also imported dynamically by Node QA harnesses, and an
// unguarded `document` deref aborted module evaluation before ANY export existed.
try { _initFilterDock(); } catch (_) {}

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
try { window.__restoreAddErrorDraft = _restoreAddErrorDraft; } catch (_) {}

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
