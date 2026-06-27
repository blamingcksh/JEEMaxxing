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
    baseErrorTargets,
    // ── Daily/subjective study-time tracker (shared with Pomodoro + app.js) ──
    studySecs,
    // ── SR engine imports ──
    computeSR,
    getDueStatus,
    SR_FRICTION_TYPES,
    SR_FRICTION_LABELS,
    SR_FRICTION_WEIGHTS,
    formatSRDate,
} from './storage.js';

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
    if (element) {
        element.classList.add('active');
    } else if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }
    AppState.currentErrorSubject = subject.toLowerCase();
    document.getElementById('error-matrix-title').textContent =
        `${subject.charAt(0).toUpperCase() + subject.slice(1)} Matrix`;
    renderErrorMatrixFromBank();
    filterErrors();
}

// ── Practice Log Drawer State ──────────────────────────────────────────────

let _drawerState = {
    qId: null,
    result: null,           // 'correct' | 'incorrect'
    autonomy: null,         // 'independent' | 'hint_used' | 'solution_read'
    frictionTypes: [],      // ['PERFECT', 'CALC', ...]
    timeSpentMins: 0,
    targetTimeMins: 5,
    stopwatchSeconds: 0,
    stopwatchInterval: null,
};

function _resetDrawerState() {
    if (_drawerState.stopwatchInterval) clearInterval(_drawerState.stopwatchInterval);
    _drawerState = {
        qId: null,
        result: null,           // 'correct' | 'incorrect'
        resultSource: null,     // 'auto' (graded against loaded answer) | 'self' (user-reported)
        selectedOptions: [],    // MCQ letters the user picked, e.g. ['A'] or ['A','C']
        imageHidden: false,
        autonomy: null,         // 'independent' | 'hint_used' | 'solution_read'
        frictionTypes: [],      // ['PERFECT', 'CALC', ...]
        timeSpentMins: 0,
        targetTimeMins: 5,
        stopwatchSeconds: 0,
        stopwatchInterval: null,
    };
}

function _startStopwatch() {
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
    const q = AppState.questionBank.find(item => item.id.toString() === qId.toString());
    if (!q) return;

    // Close any existing drawer
    closePracticeDrawer();

    _drawerState.qId = qId;
    _drawerState.targetTimeMins = q.targetTimeMins || 5;

    const dueInfo = getDueStatus(q);
    const hasImage = (q.imageDataUrl && q.imageDataUrl.length > 100) || !!q.driveImageId;

    const overlay = document.createElement('div');
    overlay.className = 'sr-practice-overlay';
    overlay.id = 'sr-practice-overlay';
    // Click on the backdrop (not the drawer itself) closes the drawer.
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closePracticeDrawer();
    });

    overlay.innerHTML = `
        <div class="sr-practice-drawer sr-practice-modal" id="sr-drawer-${qId}" role="dialog" aria-modal="true">
            <div class="sr-drawer-header">
                <div>
                    <div class="sr-drawer-title">${_esc(q.chapter || 'Unknown')} · Practice</div>
                    <div class="sr-drawer-sub">${_esc(q.subject || '')}${dueInfo.label ? ' · ' + _esc(dueInfo.label) : ''}</div>
                </div>
                <div class="sr-drawer-header-actions">
                    <div class="streak-visualizer" id="streak-visualizer"><canvas id="streak-canvas" width="16" height="16"></canvas></div>
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
    _startStopwatch();
    _postRenderDrawer(q);
}

export function closePracticeDrawer() {
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

// Normalise a correctAnswer value into a sorted array of uppercase letters.
function _normalizeAnswer(ans) {
    if (ans == null) return [];
    if (Array.isArray(ans)) {
        return ans.map(a => String(a).trim().toUpperCase().charAt(0)).filter(Boolean);
    }
    const matches = String(ans).trim().toUpperCase().match(/[A-D]/g);
    return matches ? matches : [];
}

function _hasLoadedAnswer(q) {
    if (q.correctAnswer == null) return false;
    if (Array.isArray(q.correctAnswer)) return q.correctAnswer.length > 0;
    return String(q.correctAnswer).trim().length > 0;
}

function _renderQuestionMedia(q) {
    let imgHtml = '';
    if (q.imageDataUrl && q.imageDataUrl.length > 100) {
        imgHtml = `<img class="sr-question-img" id="sr-question-img" src="${q.imageDataUrl}" alt="Question image">`;
    } else if (q.driveImageId) {
        imgHtml = `<img class="sr-question-img lazy-practice-img" id="sr-question-img" data-drive-id="${q.driveImageId}" data-qid="${q.id}" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='180'><rect width='100%' height='100%' fill='%2312121a'/><text x='50%' y='50%' fill='%23444a6a' font-family='sans-serif' font-size='12' text-anchor='middle' alignment-baseline='middle'>Loading image…</text></svg>" alt="Question image">`;
    } else {
        return ''; // no image to show → no hide button either
    }
    // The hide-image button now lives in the drawer header (so it never
    // overlaps the image). This wrapper just holds the image itself.
    return `
        <div class="sr-question-media" id="sr-question-media">
            <div class="sr-question-img-wrap" id="sr-question-img-wrap">${imgHtml}</div>
        </div>`;
}

function _renderAnswerStage(q) {
    if (q.type === 'mcq' && Array.isArray(q.options) && q.options.length) {
        const isMulti = Array.isArray(q.correctAnswer);
        const optsHtml = q.options.map((opt, i) => {
            const letter = _optionLetter(opt, i);
            return `<div class="sr-mcq-option" data-letter="${_esc(letter)}" data-option="${_esc(opt)}" onclick="srSelectOption(this)" role="button" tabindex="0">
                <span class="sr-mcq-letter">${_esc(letter)}</span>
                <span class="sr-mcq-text">${_esc(opt)}</span>
            </div>`;
        }).join('');
        return `
            <div class="sr-mcq-block">
                <div class="sr-mcq-label">${isMulti ? 'Select all that apply' : 'Select your answer'}</div>
                <div class="sr-mcq-options">${optsHtml}</div>
                <button class="sr-confirm-btn" id="sr-confirm-btn" type="button" onclick="srConfirmAnswer()" disabled>Confirm Answer</button>
            </div>`;
    }
    // Non-MCQ: go straight to a self-report prompt (reveal the answer if on file).
    const hasAnswer = _hasLoadedAnswer(q);
    const correctAns = hasAnswer ? (Array.isArray(q.correctAnswer) ? q.correctAnswer.join(', ') : q.correctAnswer) : '';
    if (hasAnswer) {
        return `
            <div class="sr-self-report sr-self-report-inline">
                <div class="sr-self-report-label">Correct answer on file: <strong>${_esc(correctAns)}</strong>. Did you get it right?</div>
                <div class="sr-self-report-btns">
                    <button class="sr-self-btn correct" type="button" onclick="srSelfReport('correct')">✔ Yes, correct</button>
                    <button class="sr-self-btn incorrect" type="button" onclick="srSelfReport('incorrect')">✖ No, incorrect</button>
                </div>
            </div>`;
    }
    return `
        <div class="sr-self-report sr-self-report-inline">
            <div class="sr-self-report-label">No answer on file — were you correct?</div>
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
                <button class="sr-toggle-btn" data-group="autonomy" data-value="independent" onclick="srSetAutonomy('independent')">🧠 Independent</button>
                <button class="sr-toggle-btn" data-group="autonomy" data-value="hint_used" onclick="srSetAutonomy('hint_used')">💡 Hint Used</button>
                <button class="sr-toggle-btn" data-group="autonomy" data-value="solution_read" onclick="srSetAutonomy('solution_read')">📖 Soln Read</button>
            </div>
        </div>
        <!-- Friction Type -->
        <div class="sr-row">
            <div class="sr-row-label">Friction Type</div>
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

    const zone = document.getElementById('sr-result-zone');
    if (zone) {
        const correctAns = _hasLoadedAnswer(q)
            ? (Array.isArray(q.correctAnswer) ? q.correctAnswer.join(', ') : q.correctAnswer)
            : null;
        let suffix = '';
        if (source === 'auto' && correctAns) {
            suffix = (result === 'correct' ? ` — answer: ${_esc(correctAns)}` : ` — correct answer: ${_esc(correctAns)}`);
        } else if (source === 'self') {
            suffix = ' (self-reported)';
        }
        if (result === 'correct') {
            zone.innerHTML = `<div class="sr-result-banner correct">✅ Correct${suffix}</div>`;
        } else {
            zone.innerHTML = `<div class="sr-result-banner incorrect">❌ Incorrect${suffix}</div>`;
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
        const correctSet = new Set(_normalizeAnswer(q.correctAnswer));
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
    el.innerHTML = raw.replace(/\$\$([\s\S]+?)\$\$|\$([^\$]+)\$/g, (m, block, inline) => {
        try { return window.katex.renderToString(block || inline, { throwOnError: false, displayMode: !!block }); }
        catch (e) { return m; }
    });
}

function _postRenderDrawer(q) {
    // Render LaTeX inside the question text + MCQ option text
    if (window.katex) {
        const textEl = document.getElementById('sr-question-text');
        if (textEl) _renderKatexIn(textEl);
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
            try { Promise.resolve(waitForDriveToken()).then(doFetch).catch(() => {}); } catch (e) {}
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
        const correct = _normalizeAnswer(q.correctAnswer).sort();
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

export function srToggleImage() {
    _drawerState.imageHidden = !_drawerState.imageHidden;
    const wrap = document.getElementById('sr-question-img-wrap');
    const btn = document.getElementById('sr-hide-img-btn');
    if (wrap) wrap.style.display = _drawerState.imageHidden ? 'none' : 'block';
    if (btn) btn.textContent = _drawerState.imageHidden ? '👁 Show Image' : '👁 Hide Image';
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

    // Enable/disable submit
    const timeSpent = _drawerState.timeSpentMins > 0 ? _drawerState.timeSpentMins : _drawerState.stopwatchSeconds / 60;
    const canSubmit = _drawerState.result && _drawerState.autonomy && _drawerState.frictionTypes.length > 0 && timeSpent > 0;
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
    });

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
        const dominantFriction = [..._drawerState.frictionTypes].sort((a, b) => weights[a] - weights[b])[0];
        
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
        changeCount(q.subject, 1);
    } else if (_drawerState.result === 'incorrect') {
        q.status = 'error';
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🎮 GAMIFICATION CONVERGENCE (SR drawer ↔ standard practice modal)
    // ════════════════════════════════════════════════════════════════════════
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
            changeCount(q.subject, 2);
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

    // ════════════════════════════════════════════════════════════════════════
    // 🧠 COGNITIVE MMR / ELO MATRIX CONVERGENCE
    // ════════════════════════════════════════════════════════════════════════
    // Intercept the active card data (_drawerState + resolved question object)
    // and invoke the Elo migration engine to scale BOTH the player's subject
    // MMR and the error item's underlying difficulty (qElo) concurrently.
    //
    // This runs BEFORE saveAllAsync() so the rating mutation lands in the same
    // persistence write cycle as the SR history log above. The engine is
    // bridged via window.calculateEloMigration (exposed by app.js) to preserve
    // the existing one-way module dependency graph (app.js → matrix.js); a
    // static import here would create a circular dependency.
    //
    // Active card data mapped to the engine signature:
    //   subject       ← q.subject
    //   actualTime    ← timeSpent (minutes) × 60  → seconds
    //   scoreOutcome  ← _drawerState.result === 'correct' ? 1 : 0
    //   chapterHealth ← window._getChapterHealth(q.subject, q.chapter)
    //   questionObj   ← q  (qElo retro-mutated in-place)
    // ════════════════════════════════════════════════════════════════════════
    let _eloResult = null;
    if (typeof window.calculateEloMigration === 'function' && q.subject) {
        try {
            const _actualSeconds = Math.max(0, Math.round(timeSpent * 60));
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
            console.error('Elo migration fault in submitPracticeLog:', _eloErr);
        }
    }

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

    saveAllAsync().catch(console.error);
    closePracticeDrawer();

    // ── Deferred UI rebuild: let the drawer close animation finish on the
    //    compositor thread before running heavy synchronous DOM work
    //    (renderErrorMatrixFromBank wipes & rebuilds N cards via innerHTML,
    //    filterErrors forces layout reads, renderErrorResolutionDashboard
    //    recalculates sparkline SVG). On mobile/WebKit this prevents the
    //    close-transition frames from being dropped.
    //
    //    ✅ FIX: Also unconditionally repaint the home-screen HUD, daily
    //    line charts, and overall progress metrics so the dashboard reflects
    //    the just-injected study time the instant the drawer closes. ──
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            renderErrorMatrixFromBank();
            filterErrors();
            renderErrorResolutionDashboard();

            // ── Global HUD / graph repaint (bridged via window surface) ──
            if (typeof window.updateUI === 'function')   window.updateUI();
            if (typeof window.renderGraph === 'function') window.renderGraph();

            // ── Cognitive MMR: refresh the dashboard Elo matrix so the new
            // subject + global ratings are visible immediately after the
            // drawer closes. updateUI() above already calls renderEloMatrix()
            // internally, but we re-run it explicitly so the subject monitors
            // + deficit lockdown overlay reflect the just-migrated state even
            // if updateUI short-circuited on a stale DOM cache. ──
            if (typeof window.renderEloMatrix === 'function') {
                try { window.renderEloMatrix(); } catch (_) { /* never block */ }
            }

            // ── Tier transition celebration ──
            // If this practice frame crossed a competitive rank bracket
            // boundary, fire the cascading emoji burst + synth fanfare from
            // the SR drawer's centre (it was still on screen a moment ago;
            // we centre on the viewport as a graceful fallback once closed).
            if (_eloResult) {
                // Inject the ELO shift chip into the practice header slot
                // so the user sees +/- elo feedback front-and-center.
                if (typeof window.injectEloShiftChip === 'function') {
                    try { window.injectEloShiftChip(_eloResult); } catch (_) { /* never block */ }
                }
            }
            if (_eloResult && _eloResult.tierChanged) {
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
        });
    });
}

// ── Delete ──────────────────────────────────────────────────────────────────

export function removeErrorLog(id) {
    if (confirm("Confirm deletion of this friction point and all its attempt history?")) {
        AppState.questionBank = AppState.questionBank.filter(q => q.id.toString() !== id.toString());
        saveAllAsync().catch(console.error);
        closePracticeDrawer();
        // Defer heavy DOM rebuilds to avoid blocking the close animation
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                renderErrorMatrixFromBank();
                filterErrors();
                renderErrorResolutionDashboard();
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

    document.querySelectorAll('#error-list-container .error-block').forEach(block => {
        const bType = block.getAttribute('data-type');
        const bSrStatus = block.getAttribute('data-sr-status');
        const bSubj = block.getAttribute('data-subject');

        const bChapter = block.querySelector('.error-chapter') ? block.querySelector('.error-chapter').textContent.toLowerCase() : '';
        const bTag = block.querySelector('.error-tag') ? block.querySelector('.error-tag').textContent.toLowerCase() : '';

        let typeMatch = (typeFilter === 'all' || typeFilter === bType);
        let subjMatch = (bSubj === AppState.currentErrorSubject);
        let textMatch = bChapter.includes(textFilter) || bTag.includes(textFilter);

        let statusMatch = true;
        if (statusFilter === 'ready')     statusMatch = bSrStatus === 'ready';
        else if (statusFilter === 'due_soon')   statusMatch = bSrStatus === 'due_soon';
        else if (statusFilter === 'scheduled')  statusMatch = bSrStatus === 'scheduled';
        else if (statusFilter === 'mastered')   statusMatch = bSrStatus === 'mastered';

        if (typeMatch && statusMatch && subjMatch && textMatch) {
            block.classList.remove('hidden');
        } else {
            block.classList.add('hidden');
        }
    });
}

// ==================== DAILY CORE QUEUE ====================

export function toggleDailyQueue() {
    _dailyQueueActive = !_dailyQueueActive;

    const btn = document.getElementById('daily-queue-btn');
    const title = document.getElementById('error-matrix-title');
    const badge = document.getElementById('daily-queue-badge');
    const folders = document.querySelectorAll('.subject-folder');

    if (_dailyQueueActive) {
        if (btn) btn.classList.add('active');
        if (title) title.textContent = '⚡ Daily Core Queue';
        if (badge) badge.style.display = 'inline';
        folders.forEach(f => f.style.opacity = '0.35');
        document.querySelectorAll('.emf-pill-group[data-emf-filter="status"] .matrix-pill').forEach(p => p.classList.remove('active'));
        _renderDailyQueueCards();
    } else {
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
        const subj = (q.subject || '').toLowerCase();
        if (bySubject[subj]) bySubject[subj].push(q);
    });
    Object.keys(bySubject).forEach(subj => {
        bySubject[subj].sort((a, b) => (a.easeFactor || 2.5) - (b.easeFactor || 2.5));
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
        c.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:40px 16px; font-size:13px;">No friction entries found across any subject.</div>';
        return;
    }

    const bySubject = { physics: [], maths: [], chemistry: [] };
    targets.forEach(q => {
        const subj = (q.subject || '').toLowerCase();
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
        if (q.subject !== currentSubject) {
            currentSubject = q.subject;
            const meta = subjectMeta[currentSubject] || { icon: '📋', label: currentSubject, limit: 0 };
            const subjItems = bySubject[currentSubject] || [];
            const doneCount = subjItems.filter(_isCompletedToday).length;
            const remaining = subjItems.length - doneCount;
            const allTracked = AppState.questionBank.filter(qq =>
                qq.errorReason && (qq.status === 'error' || qq.status === 'solved' || qq.status === 'wrong') &&
                (qq.subject || '').toLowerCase() === currentSubject
            ).length;
            const progressTxt = remaining > 0
                ? `${doneCount}/${subjItems.length} done · ${remaining} to go`
                : (subjItems.length > 0 ? `${doneCount}/${subjItems.length} done · ✓ complete` : '0/0');
            fragments.push(`
                <div class="daily-queue-subject-divider">
                    <span>${meta.icon} ${meta.label} · ${progressTxt}</span>
                    <span class="daily-queue-subject-count">${allTracked} total tracked</span>
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
    const dueBadgeStyle = DUE_BADGE_STYLES[dueInfo.status] || DUE_BADGE_STYLES.scheduled;

    let imgHtml = '';
    if (q.imageDataUrl && q.imageDataUrl.length > 100) {
        imgHtml = `<img src="${q.imageDataUrl}" onclick="openLightbox(this.src)">`;
    } else if (q.driveImageId) {
        imgHtml = `<img class="lazy-error-img" data-drive-id="${q.driveImageId}" data-qid="${q.id}" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='90'><rect width='100%' height='100%' fill='%2312121a'/><text x='50%' y='50%' fill='%23444a6a' font-family='sans-serif' font-size='11' text-anchor='middle' alignment-baseline='middle'>Syncing…</text></svg>" onclick="event.stopPropagation();">`;
    } else {
        imgHtml = '<div style="font-size:10px;color:var(--text-muted);">No Image</div>';
    }

    const today = new Date().toISOString().split('T')[0];
    const isCurrentBounty = AppState.bounty.active && !AppState.bounty.done && AppState.bounty.date === today && q.id === AppState.bounty.questionId;
    let bountyClass = isCurrentBounty ? 'bounty-active-error' : '';

    return `
            <div class="error-block ${bountyClass}" id="err-block-${q.id}"
                 data-type="${q.errorReason || 'conceptual'}"
                 data-sr-status="${dueInfo.status}"
                 data-subject="${q.subject}">
                <div class="error-img-box">${imgHtml}</div>
                <div class="error-details">
                    <div class="error-chapter">${q.chapter || 'Unknown'}</div>
                    <div class="error-tag-row">
                        <span class="error-tag" style="color:${tagStyle.color};background:${tagStyle.bg};">${tagLabel}</span>
                        <span class="sr-due-badge" style="${dueBadgeStyle}">${dueInfo.label}</span>
                    </div>
                    <div class="sr-stats-row">
                        <span class="sr-stat">⚡ ${q.currentInterval || 0}d</span>
                        <span class="sr-stat">🔥 ${(q.easeFactor || 2.5).toFixed(2)}</span>
                        <span class="sr-stat">📖 ${q.targetTimeMins || 5}m</span>
                    </div>
                    <div class="sr-attempt-dots-row">
                        <span class="sr-dots-label">History:</span>
                        ${_buildAttemptDots(q.historyLogs)}
                    </div>
                </div>
                <div class="sr-card-actions">
                    <button class="sr-practice-btn" onclick="openPracticeDrawer('${q.id}')">
                        Practice Now →
                    </button>
                    <button class="sr-history-toggle" onclick="toggleCardHistory('${q.id}')">
                        History
                        <span class="sr-chevron" id="sr-chevron-${q.id}">▾</span>
                    </button>
                    <button class="delete-btn" onclick="removeErrorLog('${q.id}')" title="Delete">🗑</button>
                </div>
                <div class="sr-expanded-history" id="sr-history-${q.id}" style="display:none;">
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
    };

    AppState.questionBank.push(newErrorQ);
    saveAllAsync().catch(console.error);

    document.getElementById('new-err-chapter').value = '';
    AppState.newErrorPicData = "";
    const successEl = document.getElementById('err-img-success');
    if (successEl) successEl.style.display = 'none';

    _closeModalStr('add-error-modal');
    // Defer heavy DOM rebuilds so the modal close transition completes first
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            renderErrorMatrixFromBank();
            filterErrors();
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

const DUE_BADGE_STYLES = {
    ready:     'background:rgba(16,185,129,0.15);color:#10B981;border:1px solid rgba(16,185,129,0.3);',
    due_soon:  'background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);',
    scheduled: 'background:rgba(96,165,250,0.1);color:rgba(96,165,250,0.7);border:1px solid rgba(96,165,250,0.2);',
    mastered:  'background:rgba(167,139,250,0.15);color:#a78bfa;border:1px solid rgba(167,139,250,0.3);',
};

function _buildAttemptDots(historyLogs) {
    if (!historyLogs || historyLogs.length === 0) return '<span style="font-size:10px;color:var(--text-muted);font-style:italic;">No attempts yet</span>';

    const last5 = historyLogs.slice(-5).reverse();
    return last5.map(log => {
        const isCorrect = log.result === 'correct';
        const bg = isCorrect ? '#10B981' : '#EF4444';
        const frictionTypes = JSON.parse(log.frictionTypes || '[]');
        const primaryFriction = frictionTypes[0] || 'N/A';
        const frictionLabel = SR_FRICTION_LABELS[primaryFriction] || primaryFriction;
        const dateStr = formatSRDate(log.timestamp);
        const timeStr = log.timeSpentMins + 'm';
        const tooltip = `title="${dateStr}\\nTime: ${timeStr}\\nFriction: ${frictionLabel}"`;

        return `<div class="sr-attempt-dot" style="background:${bg};" ${tooltip}></div>`;
    }).join('');
}

function _buildHistoryLogs(historyLogs) {
    if (!historyLogs || historyLogs.length === 0) return '';

    return historyLogs.slice().reverse().map(log => {
        const isCorrect = log.result === 'correct';
        const dotColor = isCorrect ? '#10B981' : '#EF4444';
        const frictionTypes = JSON.parse(log.frictionTypes || '[]');
        const dateStr = new Date(log.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

        const frictionPills = frictionTypes.map(f =>
            `<span class="sr-log-friction-tag">${SR_FRICTION_LABELS[f] || f}</span>`
        ).join('');

        return `
            <div class="sr-history-row">
                <div class="sr-history-dot" style="background:${dotColor};"></div>
                <div class="sr-history-info">
                    <div class="sr-history-top">
                        <span style="color:${isCorrect ? '#10B981' : '#EF4444'};">${isCorrect ? 'Correct' : 'Incorrect'}</span>
                        <span class="sr-sep">·</span>
                        <span style="color:#888;">${(log.autonomy || '').replace('_', ' ')}</span>
                    </div>
                    <div class="sr-history-frictions">${frictionPills}</div>
                </div>
                <div class="sr-history-meta">
                    <div style="color:#666;">${dateStr}</div>
                    <div style="color:#555;">${log.timeSpentMins}m · EF ${(log.newEaseFactor || 2.5).toFixed(2)}</div>
                </div>
            </div>
        `;
    }).join('');
}

export function renderErrorMatrixFromBank() {
    let c = document.getElementById('error-list-container');
    if (!c) return;

    let errs = AppState.questionBank.filter(q =>
        q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong') && q.subject === AppState.currentErrorSubject
    );

    // ── Batch: build all card HTML up front, then apply in a single innerHTML
    //    assignment. This collapses N individual DOM parse+insert cycles into
    //    one, which is critical when the matrix has dozens of cards. ──
    if (errs.length === 0) {
        c.innerHTML = '';
    } else {
        const html = errs.map(q => _buildErrorCardHTML(q)).join('');
        c.innerHTML = html;
    }

    if (typeof initErrorLazyLoaders === 'function') initErrorLazyLoaders();
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

export function initErrorLazyLoaders() {
    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(async entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const driveId = img.getAttribute('data-drive-id');
                const qId = img.getAttribute('data-qid');
                if (driveId && AppState.driveAccessToken) {
                    try {
                        const base64 = await fetchMediaFromDrive(driveId, AppState.driveAccessToken);
                        img.src = base64;
                        img.onclick = () => openLightbox(base64);
                        let q = AppState.questionBank.find(x => x.id === qId);
                        if (q) q.imageDataUrl = base64;
                    } catch(e) { console.error("Lazy load failed", e); }
                }
                obs.unobserve(img);
            }
        });
    }, { rootMargin: '100px' });
    document.querySelectorAll('.lazy-error-img').forEach(img => observer.observe(img));
}

export function openLightbox(src) {
    document.getElementById('lightbox-img').src = src;
    _openModal('lightbox-modal');
}

// ==================== SVG CHAPTER DECAY GRID ====================

export function renderChapterDecayGrid() {
    const container = document.getElementById('chapter-decay-grid');
    if (!container) return;

    const allErrors = AppState.questionBank.filter(q =>
        q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong')
    );

    const chapterMap = {};
    allErrors.forEach(q => {
        const chapter = q.chapter || 'Uncategorized';
        if (!chapterMap[chapter]) chapterMap[chapter] = [];
        chapterMap[chapter].push(q);
    });

    const chapters = Object.entries(chapterMap).map(([name, questions]) => {
        const avgEF = questions.reduce((sum, q) => sum + (q.easeFactor || 2.5), 0) / questions.length;
        const overdueCount = questions.filter(q => getDueStatus(q).status === 'ready').length;

        let health = ((avgEF - 1.3) / 1.7) * 100;
        health = Math.max(10, Math.min(100, health));
        health -= overdueCount * 15;
        health = Math.max(10, Math.min(100, health));

        return { name, health, questionCount: questions.length, avgEF, overdueCount };
    });

    chapters.sort((a, b) => a.health - b.health);

    if (chapters.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:32px 16px; font-size:13px;">No chapter data available yet. Log errors to see decay analysis.</div>';
        return;
    }

    const ROW_H = 38;
    const LABEL_W = 170;
    const TRACK_W = 280;
    const TRACK_H = 18;
    const TRACK_R = 5;
    const PCT_X = LABEL_W + TRACK_W + 14;
    const META_X = PCT_X + 52;
    const TOTAL_W = META_X + 120;
    const PAD = 4;

    const svgH = chapters.length * ROW_H + PAD * 2;

    let svgRows = chapters.map((ch, i) => {
        const y = i * ROW_H + PAD;
        const trackY = y + (ROW_H - TRACK_H) / 2;
        const fillW = Math.max(3, (ch.health / 100) * TRACK_W);

        let fillStyle, glowAttr = '', opacityAttr = '';
        if (ch.health > 75) {
            fillStyle = 'fill: var(--glow-green);';
            glowAttr = 'filter: url(#decay-glow-green);';
        } else if (ch.health >= 45) {
            fillStyle = 'fill: var(--glow-yellow);';
        } else {
            fillStyle = 'fill: var(--glow-red);';
            opacityAttr = 'opacity: 0.88;';
        }

        const displayName = ch.name.length > 24 ? ch.name.substring(0, 22) + '…' : ch.name;

        return `
            <g class="decay-row">
                <text x="10" y="${y + ROW_H / 2}"
                      style="fill: var(--text-secondary); font-size: 11.5px; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 600;"
                      dominant-baseline="middle" text-anchor="start">${displayName}</text>
                <rect x="${LABEL_W}" y="${trackY}"
                      width="${TRACK_W}" height="${TRACK_H}" rx="${TRACK_R}"
                      style="fill: rgba(255,255,255,0.035); stroke: rgba(255,255,255,0.06); stroke-width: 1;"/>
                <rect x="${LABEL_W}" y="${trackY}"
                      width="${fillW}" height="${TRACK_H}" rx="${TRACK_R}"
                      style="${fillStyle} ${glowAttr} ${opacityAttr} transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);"/>
                <text x="${PCT_X}" y="${y + ROW_H / 2}"
                      style="${fillStyle} font-size: 12px; font-family: 'Space Grotesk', monospace; font-weight: 700;"
                      dominant-baseline="middle" text-anchor="start">${ch.health.toFixed(0)}%</text>
                <text x="${META_X}" y="${y + ROW_H / 2}"
                      style="fill: var(--text-muted); font-size: 10px; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 500;"
                      dominant-baseline="middle" text-anchor="start">${ch.questionCount}q · EF ${ch.avgEF.toFixed(2)}</text>
            </g>`;
    }).join('');

    container.innerHTML = `
        <svg viewBox="0 0 ${TOTAL_W} ${svgH}"
             width="100%" height="${svgH}"
             style="overflow: visible; display: block; min-width: ${TOTAL_W}px;"
             preserveAspectRatio="xMidYMid meet">
            <defs>
                <filter id="decay-glow-green" x="-20%" y="-40%" width="140%" height="180%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur"/>
                    <feFlood flood-color="#22c55e" flood-opacity="0.45" result="color"/>
                    <feComposite in="color" in2="blur" operator="in" result="glow"/>
                    <feMerge>
                        <feMergeNode in="glow"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>
            ${svgRows}
        </svg>`;
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
        const sorted = [...AppState.questionBank].sort((a, b) => (a.easeFactor || 2.5) - (b.easeFactor || 2.5));
        return sorted[0] || null;
    }
    const sorted = [...candidates].sort((a, b) => (a.easeFactor || 2.5) - (b.easeFactor || 2.5));
    return sorted[0];
}

// ==================== ERROR RESOLUTION ENGINE ====================

let _todayKeyCache = null;
let _lastRenderedDate = null;
let _rolloverWatchStarted = false;

function _todayKey(date) {
    const d = date || new Date();
    return d.toLocaleDateString('en-CA');
}

export function refreshErrorDashboardIfStale() {
    const today = _todayKey();
    if (_lastRenderedDate !== today) {
        _lastRenderedDate = today;
        renderErrorResolutionDashboard();
    }
}

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

export function renderErrorResolutionDashboard() {
    _startRolloverWatcher();
    const todayStr = _todayKey();
    const subjects = ['physics', 'chemistry', 'maths'];
    const subjectGradients = {
        physics:   'linear-gradient(90deg, #3b82f6, #8b5cf6)',
        chemistry: 'linear-gradient(90deg, #14b8a6, #06b6d4)',
        maths:     'linear-gradient(90deg, #f97316, #fb7185)',
    };
    const subjectIds = {
        physics:   { val: 'erm-phys-val', bar: 'erm-phys-bar', pct: 'erm-phys-pct', tgt: 'erm-phys-tgt' },
        chemistry: { val: 'erm-chem-val', bar: 'erm-chem-bar', pct: 'erm-chem-pct', tgt: 'erm-chem-tgt' },
        maths:     { val: 'erm-math-val', bar: 'erm-math-bar', pct: 'erm-math-pct', tgt: 'erm-math-tgt' },
    };

    const todayCounts = { physics: 0, chemistry: 0, maths: 0 };

    AppState.questionBank.forEach(q => {
        if (!q.historyLogs || !Array.isArray(q.historyLogs)) return;
        q.historyLogs.forEach(log => {
            if (log.result !== 'correct' || !log.timestamp) return;
            const logDate = _todayKey(new Date(log.timestamp));
            if (logDate === todayStr) {
                const subj = (q.subject || '').toLowerCase();
                if (todayCounts[subj] !== undefined) todayCounts[subj]++;
            }
        });
    });

    let totalToday = 0;
    subjects.forEach(subj => {
        const count = todayCounts[subj];
        const target = baseErrorTargets[subj] || 5;
        const pct = target > 0 ? Math.min(100, (count / target) * 100) : 0;
        totalToday += count;

        const ids = subjectIds[subj];
        const valEl = document.getElementById(ids.val);
        const barEl = document.getElementById(ids.bar);
        const pctEl = document.getElementById(ids.pct);
        const tgtEl = document.getElementById(ids.tgt);

        if (valEl) valEl.textContent = count;
        if (tgtEl) tgtEl.textContent = `/ ${target}`;
        if (pctEl) pctEl.textContent = `${pct.toFixed(0)}%`;
        if (barEl) {
            barEl.style.width = `${pct}%`;
            barEl.style.background = subjectGradients[subj];
            barEl.style.boxShadow = pct >= 100
                ? '0 0 12px rgba(139, 92, 246, 0.5), 0 0 24px rgba(139, 92, 246, 0.2)'
                : 'none';
        }
    });

    const totalEl = document.getElementById('erm-today-total');
    if (totalEl) {
        totalEl.querySelector('div').textContent = totalToday;
    }

    // ── 15-Day Historical Momentum ──
    const momentumData = [];
    for (let d = 14; d >= 0; d--) {
        const date = new Date();
        date.setDate(date.getDate() - d);
        const dateStr = date.toLocaleDateString('en-CA');
        momentumData.push({ date: dateStr, dayLabel: date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), count: 0 });
    }

    AppState.questionBank.forEach(q => {
        if (!q.historyLogs || !Array.isArray(q.historyLogs)) return;
        q.historyLogs.forEach(log => {
            if (log.result !== 'correct' || !log.timestamp) return;
            const logDate = _todayKey(new Date(log.timestamp));
            const entry = momentumData.find(m => m.date === logDate);
            if (entry) entry.count++;
        });
    });

    // ── Protocol Zero overlay (Pillar 4) ──
    // Any date in the jeemax_protocol_zero record forces a HARD ZERO on that
    // day's count, overriding real activity. This is the "irreversible metric
    // scarring" — even if you solved 50 questions that day, the graph shows 0.
    try {
        const penaltyDates = JSON.parse(localStorage.getItem('checkpoint:protocolZero') || '[]');
        penaltyDates.forEach(pDate => {
            const entry = momentumData.find(m => m.date === pDate);
            if (entry) { entry.count = 0; entry.penalty = true; }
        });
    } catch (_) { /* ignore */ }

    const totalMomentum = momentumData.reduce((s, m) => s + m.count, 0);
    const avgMomentum = (totalMomentum / 15).toFixed(1);
    const avgLabel = document.getElementById('erm-avg-label');
    if (avgLabel) avgLabel.textContent = `avg ${avgMomentum}/day`;

    _renderMomentumSparkline(momentumData);
}

function _renderMomentumSparkline(data) {
    const container = document.getElementById('error-momentum-svg-container');
    if (!container) return;

    const W = 320;
    const H = 88;
    const PAD_X = 4;
    const PAD_Y = 8;
    const plotW = W - PAD_X * 2;
    const plotH = H - PAD_Y * 2;
    const maxVal = Math.max(1, ...data.map(d => d.count));

    const points = data.map((d, i) => {
        const x = PAD_X + (i / (data.length - 1)) * plotW;
        const y = PAD_Y + plotH - (d.count / maxVal) * plotH;
        return { x, y, count: d.count, dayLabel: d.dayLabel, penalty: d.penalty };
    });

    const pathD = _smoothPath(points);
    const areaD = pathD +
        ` L ${points[points.length - 1].x},${PAD_Y + plotH}` +
        ` L ${points[0].x},${PAD_Y + plotH} Z`;

    // Dots with penalty (P0) markers
    const dots = points.map((p, i) => {
        const isToday = i === points.length - 1;
        if (p.penalty) {
            // Protocol Zero red valley marker
            return `<line x1="${p.x}" y1="${p.y}" x2="${p.x}" y2="${PAD_Y + plotH}" stroke="#f87171" stroke-width="2.5" opacity="0.6" stroke-dasharray="3 2"/>` +
                   `<circle cx="${p.x}" cy="${p.y}" r="5" fill="#f87171" stroke="#fff" stroke-width="1.5" filter="url(#p0-glow)"/>` +
                   `<text x="${p.x}" y="${p.y - 12}" fill="#f87171" font-size="9" font-family="'Space Grotesk', monospace" text-anchor="middle" font-weight="700">P0</text>`;
        }
        const r = isToday ? 4 : 2.5;
        const fill = isToday ? '#ec4899' : '#8b5cf6';
        const stroke = isToday ? '#ec4899' : 'none';
        const sw = isToday ? 2 : 0;
        const glowFilter = isToday ? 'filter="url(#erm-dot-glow)"' : '';
        return `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${glowFilter}/>`;
    }).join('');

    const labelIndices = [0, Math.floor(data.length / 2), data.length - 1];
    const labels = labelIndices.map(i => {
        const p = points[i];
        return `<text x="${p.x}" y="${H - 1}" fill="var(--text-muted)" font-size="8" font-family="'Plus Jakarta Sans', sans-serif" text-anchor="${i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}" font-weight="500">${data[i].dayLabel}</text>`;
    }).join('');

    const peakIdx = points.reduce((mi, p, i, arr) => p.count > arr[mi].count ? i : mi, 0);
    const peak = points[peakIdx];
    const peakLabel = peak.count > 0
        ? `<text x="${peak.x}" y="${peak.y - 10}" fill="var(--text-secondary)" font-size="9" font-family="'Space Grotesk', monospace" text-anchor="middle" font-weight="700">${peak.count}</text>`
        : '';

    container.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMidYMid meet" style="overflow: visible; display: block;">
            <defs>
                <linearGradient id="error-momentum-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.35"/>
                    <stop offset="60%" stop-color="#8b5cf6" stop-opacity="0.08"/>
                    <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0"/>
                </linearGradient>
                <filter id="erm-dot-glow" x="-100%" y="-100%" width="300%" height="300%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
                    <feFlood flood-color="#ec4899" flood-opacity="0.6" result="color"/>
                    <feComposite in="color" in2="blur" operator="in" result="glow"/>
                    <feMerge>
                        <feMergeNode in="glow"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
                <!-- Protocol Zero glow filter -->
                <filter id="p0-glow" x="-100%" y="-100%" width="300%" height="300%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
                    <feFlood flood-color="#f87171" flood-opacity="0.7" result="color"/>
                    <feComposite in="color" in2="blur" operator="in" result="glow"/>
                    <feMerge>
                        <feMergeNode in="glow"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>
            <line x1="${PAD_X}" y1="${PAD_Y + plotH}" x2="${W - PAD_X}" y2="${PAD_Y + plotH}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
            <line x1="${PAD_X}" y1="${PAD_Y + plotH * 0.5}" x2="${W - PAD_X}" y2="${PAD_Y + plotH * 0.5}" stroke="rgba(255,255,255,0.025)" stroke-width="1" stroke-dasharray="4 4"/>
            <path d="${areaD}" fill="url(#error-momentum-gradient)"/>
            <path d="${pathD}" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            ${dots}
            ${peakLabel}
            ${labels}
        </svg>`;
}

function _smoothPath(points) {
    if (points.length < 2) return '';
    if (points.length === 2) {
        return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
    }

    let d = `M ${points[0].x},${points[0].y}`;

    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];

        const tension = 0.35;
        const cp1x = p1.x + (p2.x - p0.x) * tension;
        const cp1y = p1.y + (p2.y - p0.y) * tension;
        const cp2x = p2.x - (p3.x - p1.x) * tension;
        const cp2y = p2.y - (p3.y - p1.y) * tension;

        d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }

    return d;
}