/**
 * app.js — Main controller module for JEEMaxxing.
 * Ties together storage.js, pomodoro.js, and matrix.js.
 * All UI logic, effects, practice flow, crop system, and initialization live here.
 */

// ==================== IMPORTS ====================
import {
    AppState,
    baseTargets,
    baseErrorTargets,             // NEW: error resolution targets
    solved,
    studySecs,
    monthNamesCal,
    MODEL_FALLBACK, CLIENT_ID, SCOPES,
    saveAllAsync, loadDataAsync,
    idbSet, idbGet,
    callGeminiWithFallback, cropImageFromBBox,
    showLoading, hideLoading, readFileAsBase64,
    escapeHtml, escapeAttribute, formatTime, formatStudyDuration,
    cleanAndParseJson,
    uploadMediaToDrive, fetchMediaFromDrive, deleteMediaFromDrive,
    initDrive, handleDriveAuth, handleAuthExpiry,
    isDriveTokenValid, initializeCloudFolder, syncStateToCloud,
    loadStateFromCloud, setupSyncHeartbeat, getCloudSolvedTotal,
    waitForDriveToken, updateDailyHistory, getDailyHistory,
    executeUnifiedSync, cacheAllDriveImages,
    registerUiCallbacks, changeCount,
    // ── SR due-status helper (used by the cat-banner vulnerability scanner) ──
    getDueStatus,
} from './storage.js';

import {
    resetPomoUI, startTimer, pauseTimer, resumeTimer, quitTimer,
    skipBreak, addBreakTime, finishAll,
    toggleVisualizer, toggleMiniWidget, toggleStopwatchMode,
    updateStudyTimeHeader, initAudioContext, playBell,
    confirmTimerNotification,
} from './pomodoro.js';

// Replace the existing matrix.js import block with:
import {
    openErrorMatrix, filterErrors,
    addErrorBlock, renderErrorMatrixFromBank, initErrorLazyLoaders,
    removeErrorLog, openLightbox,
    // ── SR practice log imports (new) ──
    openPracticeDrawer, closePracticeDrawer, submitPracticeLog,
    srSetResult, srSetAutonomy, srToggleFriction,
    srToggleStopwatch, srToggleManualTime, srUpdateManualTime,
    toggleCardHistory,
    // ── Practice drawer MCQ flow (new) ──
    srSelectOption, srConfirmAnswer, srSelfReport, srToggleImage,
    // ── Error resolution dashboard (NEW) ──
    renderErrorResolutionDashboard,
    renderChapterDecayGrid,
} from './matrix.js';

// ── Candlestick engine (powers both home-section graphs) ──
import { drawCandlesticks, extractCountsFromSvg } from './candlestick-engine.js';

// ==================== LOCAL STATE ====================
// State that doesn't need to be shared with other modules
let cropSession = {
    sourceImages: [],
    currentQuestionIdx: 0,
    allQuestions: [],
    activeCrop: false,
    drawing: { startX: 0, startY: 0, endX: 0, endY: 0, sourceId: null },
    canvasRefs: {},
    ctxRefs: {},
    imgRefs: {},
    toggleButtonSize: 18,
    // ── Surgical single-crop mode ──
    // When non-null, the crop modal is operating in "surgical" mode for the
    // Gemini Gem Text Track: a single source image was uploaded via
    // window.triggerSurgicalDiagramUpload(idx) and the user is drawing ONE
    // bounding box to bind a diagram to AppState.extractedItems[idx].
    // When null, the traditional multi-crop pipeline runs untouched.
    surgicalTargetIdx: null,
};

let overheatActive = false;
let overheatUntil = null;
let overheatUsed = false;
let overheatTimeout = null;
let currentTier = 'yellow';
let currentFrame = 0;
let lastTime = 0;
let currentIntensity = 0.62;
let particles = [];

// ==================== FAVICON GENERATION ====================
// ==================== FAVICON GENERATION ====================
(function generateFavicon() {
    if (document.getElementById('apple-icon-png')) return;
    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 200 200">
      <defs>
        <linearGradient id="foxGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#ff2d95"/>
          <stop offset="100%" style="stop-color:#00f0ff"/>
        </linearGradient>
      </defs>
      <g stroke="url(#foxGrad)" stroke-width="2" fill="none" opacity="0.8">
        <path d="M100 160 Q80 120 60 100"/>
        <path d="M100 160 Q90 110 80 80"/>
        <path d="M100 160 Q100 100 100 60"/>
        <path d="M100 160 Q110 110 120 80"/>
        <path d="M100 160 Q120 120 140 100"/>
        <path d="M100 160 Q70 130 50 120"/>
        <path d="M100 160 Q130 130 150 120"/>
        <path d="M100 160 Q85 140 75 130"/>
        <path d="M100 160 Q115 140 125 130"/>
      </g>
      <ellipse cx="100" cy="140" rx="20" ry="25" fill="none" stroke="url(#foxGrad)" stroke-width="2"/>
      <circle cx="100" cy="110" r="16" fill="none" stroke="url(#foxGrad)" stroke-width="2"/>
      <polygon points="90,95 85,75 98,90" fill="url(#foxGrad)" opacity="0.8"/>
      <polygon points="110,95 115,75 102,90" fill="url(#foxGrad)" opacity="0.8"/>
      <circle cx="96" cy="108" r="3" fill="#ff2d95"/>
      <circle cx="104" cy="108" r="3" fill="#ff2d95"/>
      <circle cx="60" cy="100" r="1.5" fill="#00f0ff">
        <animate attributeName="cy" values="100;90;100" dur="2s" repeatCount="indefinite"/>
      </circle>
      <circle cx="140" cy="100" r="1.5" fill="#00f0ff">
        <animate attributeName="cy" values="100;90;100" dur="1.8s" repeatCount="indefinite"/>
      </circle>
    </svg>`;
    const canvas = document.createElement('canvas');
    canvas.width = 180;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    img.onload = function () {
        ctx.drawImage(img, 0, 0, 180, 180);
        const pngData = canvas.toDataURL('image/png');
        const existing = document.querySelector('link[rel="apple-touch-icon"]');
        if (existing) existing.remove();
        const link = document.createElement('link');
        link.id = 'apple-icon-png';
        link.rel = 'apple-touch-icon';
        link.href = pngData;
        document.head.appendChild(link);
        URL.revokeObjectURL(url);
    };
    img.src = url;
})();

// ==================== MODAL FUNCTIONS ====================
export function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    if (id === 'calendar-modal') renderCalendar();
    m.style.display = 'flex';
    requestAnimationFrame(() => { m.classList.add('active'); });
}

export function closeModal(e, id, force) {
    if (typeof e === 'string') { closeModalStr(e); return; }
    const m = document.getElementById(id);
    if (!m) return;
    if (force || (e && e.target === m)) {
        m.classList.remove('active');
        setTimeout(() => { if (!m.classList.contains('active')) m.style.display = 'none'; }, 300);
    }
}

export function closeModalStr(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('active');
    setTimeout(() => { if (!m.classList.contains('active')) m.style.display = 'none'; }, 300);
}

/**
 * Synchronous, transition-bypassing modal hide.
 *
 * `closeModalStr` removes `.active` immediately but defers the actual
 * `display='none'` for 300ms so the fade-out CSS transition can play. That
 * delay is a problem when we need to IMMEDIATELY swap one full-screen flex
 * overlay for another (e.g. preview-modal → crop-modal, or upload-modal →
 * preview-modal): for 300ms both overlays keep `display:flex` inline, and if
 * the dismissed one has the higher z-index it keeps capturing pointer
 * events and visually burying the new one.
 *
 * This helper tears the modal down in a single synchronous tick — remove
 * `.active`, force `display='none'` inline — so the next overlay is the only
 * one on stage the moment it opens. The fade-out animation is sacrificed,
 * but correctness > prettiness here.
 */
function forceHideModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('active');
    m.style.display = 'none';
}

export function triggerStreakShield() {
    // Resolve the VISIBLE streak visualizer. The standard practice modal
    // (#practice-modal) keeps a permanent #streak-visualizer in the DOM (hidden
    // via display:none when closed), while the SR practice drawer (matrix.js)
    // injects a second one while it is open. getElementById returns the first
    // match in document order, so we fall back to querySelectorAll and pick the
    // first visible instance — this lets the shield 🛡️ pop inside whichever
    // practice surface is currently on screen.
    let visualizer = document.getElementById('streak-visualizer');
    if (!visualizer || visualizer.offsetParent === null) {
        const all = document.querySelectorAll('#streak-visualizer');
        for (const v of all) {
            if (v.offsetParent !== null) { visualizer = v; break; }
        }
    }
    if (!visualizer || visualizer.offsetParent === null) return;
    const shield = document.createElement('span');
    shield.className = 'streak-shield';
    shield.textContent = '🛡️';
    visualizer.appendChild(shield);
    shield.addEventListener('animationend', () => shield.remove());
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        const bufferSize = ctx.sampleRate * 0.15;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        source.connect(gain).connect(ctx.destination);
        source.start(now);
        source.stop(now + 0.15);
    } catch (e) { /* ignore audio errors */ }
}

// ==================== SIDEBAR & TABS ====================
export function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    sb.classList.toggle('collapsed');
    document.querySelector('.collapse-btn').textContent = sb.classList.contains('collapsed') ? '→' : 'Shrink';
}

export async function switchTab(viewId, element) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    const targetView = document.getElementById('view-' + viewId);
    if (targetView) targetView.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');

    const header = document.getElementById('main-header');
    const catBanner = document.getElementById('cat-banner');

    if (viewId === 'pomodoro' || viewId === 'errors' || viewId === 'practice') {
        header.classList.add('hidden');
        catBanner.style.display = 'none';
    } else {
        header.classList.remove('hidden');
        catBanner.style.display = 'flex';
    }

    await loadDataAsync();
    if (viewId === 'practice') showPracticeSubview('practice-subject-view');
    if (viewId === 'errors') {
        assignDailyBountyIfNeeded();
        renderErrorMatrixFromBank();
        filterErrors();
        renderErrorResolutionDashboard(); // NEW: refresh error dashboard when viewing errors
        if (typeof renderMomentumCandles === 'function') renderMomentumCandles();
    }
    if (viewId === 'dashboard') await renderGraph();
}

export function showPracticeSubview(id) {
    document.querySelectorAll('#view-practice .practice-subview').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) target.classList.add('active');
}

// ==================== MOOD & DASHBOARD ====================
export async function calibrateMood(mood) {
    if (mood === 'sad') AppState.moodMultiplier = 0.70;
    else if (mood === 'happy') AppState.moodMultiplier = 1.20;
    else AppState.moodMultiplier = 1.0;

    AppState.activeTargets.physics = Math.round(baseTargets.physics * AppState.moodMultiplier);
    AppState.activeTargets.chemistry = Math.round(baseTargets.chemistry * AppState.moodMultiplier);
    AppState.activeTargets.maths = Math.round(baseTargets.maths * AppState.moodMultiplier);

    await idbSet('jeemax_mood_multiplier', AppState.moodMultiplier);
    await idbSet('jeemax_last_calibrated_date', new Date().toISOString().split('T')[0]);
    await saveAllAsync();
    await updateUI();
    closeModal(null, 'mood-modal', true);
    await renderGraph();
    resetPomoUI();
    const d = new Date();
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    document.getElementById('top-date').textContent =
        `${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
}

// ── Cat-Banner Progress View Helper ───────────────────────────────────────
// Renders the "Daily Targets: X% Complete" (or "All Daily Targets Complete!
// 🚀") view into #cat-text with the appropriate glow class. Factored out of
// updateUI() so the telemetry loop can re-render it on the A-tick without
// recomputing every metric.
function _renderCatProgressView(overallPct) {
    const catText = document.getElementById('cat-text');
    if (!catText) return;
    if (overallPct >= 100) {
        catText.textContent = `Absolute termination. Daily targets cleared. Your aura is unmatched today 🌌`;
        catText.className = "cat-text glow-green";
    } else {
        catText.textContent = `Current focus vector: ${overallPct}% cooked. Keep feeding the machine ⚙️`;
        catText.className = "cat-text glow-orange";
    }
}

// ── Cat-Banner Vulnerability Telemetry Scanner ────────────────────────────
// Scans live application memory state (AppState.questionBank, solved counters,
// mood calibration) to flag cognitive, output-based, and spaced-repetition
// vulnerabilities. Returns the highest-priority active vulnerability, or null
// if none are flagged. Priorities are 1 (highest) through 6 (lowest).
//
// This function is self-contained and reads only from already-imported state
// (AppState, solved, getDueStatus). It does NOT import matrix.js, avoiding
// any circular module dependency. The CRITICAL_DECAY check delegates directly
// to the canonical `_getChapterHealth` (Continuous Biological Memory Construct),
// whose math is mirrored inside renderChapterDecayGrid() in matrix.js so the
// scanner, the grid, and the Elo engine all evaluate an identical continuous
// accessibility percentage — no divergence between layers, and no corruption
// of target locks or storage.
function _scanCatBannerVulnerabilities() {
    const vulnerabilities = [];

    // ── PRIORITY 1: STREAK_AT_RISK ────────────────────────────────────────
    // Triggered if current local time is past 18:00 (6 PM) AND combined daily
    // solved count across physics+chemistry+maths is exactly 0.
    {
        const now = new Date();
        const totalSolvedToday = (solved.physics || 0) + (solved.chemistry || 0) + (solved.maths || 0);
        if (now.getHours() >= 18 && totalSolvedToday === 0) {
            vulnerabilities.push({
                priority: 1,
                className: 'glow-red',
                text: '🚨 STREAK CHURN WARNING: 0 questions touched. Wake up, you are throwing away your daily consistency vector.',
            });
        }
    }

    // ── PRIORITY 2: CRITICAL_DECAY ───────────────────────────────────────
    // Triggered if any chapter stability health drops below 45%. Health now
    // uses the Continuous Non-Linear Biological Memory Construct (Bjork's New
    // Theory of Disuse): a difficulty-weighted harmonic accessibility mean of
    // per-item exponential Retrieval Strength decay. This delegates to the
    // canonical `_getChapterHealth` so the scanner and the Elo engine evaluate
    // identical math (no divergence between the monitoring layer and the
    // scoring layer). The legacy discrete 15%-per-overdue tax is eliminated.
    {
        const allErrors = AppState.questionBank.filter(q =>
            q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong')
        );
        // Group by (subject, chapter) so each domain resolves its own
        // continuous accessibility score with the correct subject normalisation.
        const domainMap = {};
        allErrors.forEach(q => {
            const subject = q.subject || '';
            const chapter = q.chapter || 'Uncategorized';
            const key = subject + '||' + chapter;
            if (!domainMap[key]) domainMap[key] = { subject, chapter };
        });
        let worstChapter = null;
        let worstHealth = 100;
        for (const { subject, chapter } of Object.values(domainMap)) {
            const health = _getChapterHealth(subject, chapter);
            if (health < 45 && health < worstHealth) {
                worstHealth = health;
                worstChapter = chapter;
            }
        }
        if (worstChapter) {
            vulnerabilities.push({
                priority: 2,
                className: 'glow-red',
                text: `⚠️ SKILL GAP ACTIVE: ${worstChapter} health is literally decaying. Resolve this right now or it's over.`,
            });
        }
    }

    // ── PRIORITY 3: BOUNTY_LOCK ───────────────────────────────────────────
    // Triggered if any question in the bank has an active future
    // bountyLockUntil timestamp OR its criticalDeficit property is true.
    {
        const now = Date.now();
        const hasBountyLock = AppState.questionBank.some(q => {
            if (q.criticalDeficit === true) return true;
            if (q.bountyLockUntil) {
                const lockTime = new Date(q.bountyLockUntil).getTime();
                if (!isNaN(lockTime) && lockTime > now) return true;
            }
            return false;
        });
        if (hasBountyLock) {
            vulnerabilities.push({
                priority: 3,
                className: 'glow-orange',
                text: '⚔️ DEBT LIQUIDATION: Bounty failed. Targets scaled up. Cry about it or double down.',
            });
        }
    }

    // ── PRIORITY 4: SR_OVERFLOW ───────────────────────────────────────────
    // Triggered if the count of SR items across all subjects with a due status
    // of 'ready' exceeds 5.
    {
        let readyCount = 0;
        AppState.questionBank.forEach(q => {
            if (q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong')) {
                if (getDueStatus(q).status === 'ready') readyCount++;
            }
        });
        if (readyCount > 5) {
            vulnerabilities.push({
                priority: 4,
                className: 'glow-orange',
                text: `⚡ MEMORY ERASURE THREAT: ${readyCount} raw mistakes are actively rot-decaying in your bank. Clear them.`,
            });
        }
    }

    // ── PRIORITY 5: OUTPUT_LAG ────────────────────────────────────────────
    // Triggered if one subject's daily solved completion rate is under 20%
    // while another has advanced past 50%.
    {
        const subjects = ['physics', 'chemistry', 'maths'];
        const pcts = subjects.map(sub => {
            const tgt = AppState.activeTargets[sub];
            return tgt > 0 ? Math.min(100, (solved[sub] / tgt) * 100) : 0;
        });
        const hasLagger = pcts.some(p => p < 20);
        const hasLeader = pcts.some(p => p > 50);
        if (hasLagger && hasLeader) {
            // Find the lagging subject name (first one under 20%)
            const lagIdx = pcts.findIndex(p => p < 20);
            const lagSubject = subjects[lagIdx];
            const displayName = lagSubject.charAt(0).toUpperCase() + lagSubject.slice(1);
            vulnerabilities.push({
                priority: 5,
                className: 'glow-orange',
                text: `📉 FRAUD ALERT: Your ${displayName} volume is straight lagging. Stop dodging the hard topics.`,
            });
        }
    }

    // ── PRIORITY 6: CNS_FRICTION ──────────────────────────────────────────
    // Triggered if AppState.moodMultiplier === 0.70 (the 'Fried / 🥱' state).
    {
        if (AppState.moodMultiplier === 0.70) {
            vulnerabilities.push({
                priority: 6,
                className: 'glow-orange',
                text: '🧠 BRAIN-FRIED MODE: CNS capacity low. Focus on raw calculation quality over volume.',
            });
        }
    }

    // Sort by priority ascending (1 = highest) and return the top one.
    if (vulnerabilities.length === 0) return null;
    vulnerabilities.sort((a, b) => a.priority - b.priority);
    return vulnerabilities[0];
}

// ── Cat-Banner Telemetry Rotation Loop ────────────────────────────────────
// A 10-second ticker that alternates #cat-text between:
//   • Tick A: Overall Daily Targets Progress % (existing logic)
//   • Tick B: Highest-priority active vulnerability (evaluated dynamically)
// If no vulnerabilities are flagged on a B-tick, the A-state progress view
// is maintained seamlessly. Text changes are wrapped in a CSS fade transition
// (opacity 0 → update text → opacity 1) to prevent harsh snapping.
(function _initCatBannerTelemetry() {
    if (window.__catTelemetryInit) return;
    window.__catTelemetryInit = true;

    let showVulnerability = false; // alternates each tick
    let currentFadeTimer = null;

    function _computeOverallPct() {
        const pcts = ['physics', 'chemistry', 'maths'].map(sub => {
            const tgt = AppState.activeTargets[sub];
            return tgt > 0 ? Math.min(100, (solved[sub] / tgt) * 100) : 0;
        });
        return Math.floor((pcts[0] + pcts[1] + pcts[2]) / 3);
    }

    function _renderCatText(text, className) {
        const catText = document.getElementById('cat-text');
        if (!catText) return;
        // Fade out → update text + class → fade back in.
        catText.classList.add('cat-fading');
        // Clear any pending fade-in timer from a rapid re-trigger.
        if (currentFadeTimer) clearTimeout(currentFadeTimer);
        currentFadeTimer = setTimeout(() => {
            catText.textContent = text;
            catText.className = 'cat-text ' + className + ' cat-fading';
            // Force a reflow so the opacity transition restarts cleanly.
            void catText.offsetHeight;
            catText.classList.remove('cat-fading');
            currentFadeTimer = null;
        }, 250); // matches the CSS fade-out duration
    }

    function _tick() {
        const catText = document.getElementById('cat-text');
        if (!catText) return;

        // ── Cognitive MMR Deficit Lockdown takes absolute priority over the
        // normal telemetry rotation. While the profile symmetry ratio is
        // below 0.65, every tick renders the imbalance warning so it
        // persists instead of being overwritten by the progress view. ──
        if (window._eloDeficitActive === true) {
            _renderCatText(
                '🚨 OVER-SPECIALIZATION DETECTED: You are building a lopsided build. Balance your subject ratings immediately or face total doom.',
                'glow-red'
            );
            showVulnerability = !showVulnerability;
            return;
        }

        if (showVulnerability) {
            // Tick B: evaluate vulnerabilities dynamically on this tick.
            const vuln = _scanCatBannerVulnerabilities();
            if (vuln) {
                _renderCatText(vuln.text, vuln.className);
            } else {
                // No active vulnerability — maintain the progress view seamlessly.
                _renderCatProgressView(_computeOverallPct());
            }
        } else {
            // Tick A: Overall Daily Targets Progress %.
            _renderCatProgressView(_computeOverallPct());
        }
        // Alternate for the next tick.
        showVulnerability = !showVulnerability;
    }

    // Start the 10-second rotational cycle. The first tick fires immediately
    // so the banner picks up vulnerabilities on load without a 10s delay.
    function _start() {
        if (!document.getElementById('cat-text')) {
            // DOM not ready — retry shortly.
            setTimeout(_start, 500);
            return;
        }
        _tick();
        setInterval(_tick, 10000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _start);
    } else {
        _start();
    }

    // Expose a debug surface.
    window.__catTelemetry = {
        scan: _scanCatBannerVulnerabilities,
        tick: _tick,
        getShowingVulnerability: () => showVulnerability,
    };
})();

export async function updateUI() {
    let pctP = AppState.activeTargets.physics > 0 ? Math.min(100, (solved.physics / AppState.activeTargets.physics) * 100) : 0;
    let pctC = AppState.activeTargets.chemistry > 0 ? Math.min(100, (solved.chemistry / AppState.activeTargets.chemistry) * 100) : 0;
    let pctM = AppState.activeTargets.maths > 0 ? Math.min(100, (solved.maths / AppState.activeTargets.maths) * 100) : 0;

    ['physics', 'chemistry', 'maths'].forEach(sub => {
        document.getElementById(`${sub}-count`).textContent = solved[sub];
        let tgtLbl = document.getElementById(`tgt-${sub.substring(0, 4)}-lbl`);
        if (tgtLbl) tgtLbl.textContent = `/ ${AppState.activeTargets[sub]}`;
        let pct = sub === 'physics' ? pctP : (sub === 'chemistry' ? pctC : pctM);
        document.getElementById(`${sub}-bar`).style.width = `${pct}%`;
    });

    let overallPct = Math.floor((pctP + pctC + pctM) / 3);
    // Render the progress view into #cat-text. This is factored out so the
    // cat-banner telemetry loop can re-render the progress view on its A-tick
    // without recomputing every metric in updateUI().
    _renderCatProgressView(overallPct);

    let totalSolved = solved.physics + solved.chemistry + solved.maths;
    let totalTgt = AppState.activeTargets.physics + AppState.activeTargets.chemistry + AppState.activeTargets.maths;
    let variance = totalTgt === 0 ? 0 : ((totalSolved - totalTgt) / totalTgt) * 100;
    let varEl = document.getElementById('variance-val');
    if (varEl) {
        varEl.textContent = (variance > 0 ? "+" : "") + variance.toFixed(1) + "%";
        varEl.style.color = variance >= 0 ? 'var(--glow-green)' : 'var(--glow-red)';
    }

    // ── Cognitive MMR Matrix hydration (global profile row + subject
    // monitors + deficit lockdown protocol). Runs on every updateUI tick so
    // the dashboard always reflects the live rating state. ──
    try { renderEloMatrix(); } catch (_) { /* never block updateUI */ }

    updateStreakDisplay();
}

// ==================== STREAK VECTOR TRACKER ====================
export async function updateStreakDisplay() {
    let history = await getDailyHistory();
    if (!Array.isArray(history) || history.length === 0) {
        const streakEl = document.getElementById('top-streak');
        if (streakEl) streakEl.textContent = "0 Days (start something)";
        return;
    }

    let activeDates = new Set();
    history.forEach(h => {
        if (h && h.count > 0 && h.date) {
            activeDates.add(h.date);
        }
    });

    let streak = 0;
    let checkDate = new Date();
    let todayStr = checkDate.toISOString().split('T')[0];

    if (!activeDates.has(todayStr)) {
        checkDate.setDate(checkDate.getDate() - 1);
    }

    for (let i = 0; i < 30; i++) {
        let dStr = checkDate.toISOString().split('T')[0];
        if (activeDates.has(dStr)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else {
            break;
        }
    }

    const streakEl = document.getElementById('top-streak');
    if (streakEl) {
        streakEl.textContent = `${streak} Day${streak !== 1 ? 's' : ''}`;
    }
}

// ==================== PREDICTIVE MOMENTUM ENGINE (candlestick edition) ====================
export async function renderGraph() {
    const svg = document.getElementById('dynamic-graph');
    if (!svg) return;

    // ── Pull daily history (same data source as the original line graph) ──
    let history = await getDailyHistory();
    if (!history || !history.length) return;

    // ── Protocol Zero overlay (Pillar 4) ──
    // Force a HARD ZERO on any day in the penalty log, overriding real solves.
    let penaltyDates = [];
    try {
        penaltyDates = JSON.parse(localStorage.getItem('checkpoint:protocolZero') || '[]');
    } catch (_) { /* ignore */ }
    const penaltySet = new Set(penaltyDates);
    const penaltyFlags = history.map(h => penaltySet.has(h.date));

    // Raw scalar series (P0 enforcement is applied inside drawCandlesticks).
    const counts = history.map(h => h.count);

    // ── Label formatter: "Mon 12" style ──
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const labelFn = (i) => {
        const h = history[i];
        if (!h || !h.date) return `Day ${i + 1}`;
        const d = new Date(h.date + 'T00:00:00');
        if (isNaN(d.getTime())) return h.date;
        return `${DOW[d.getDay()]} ${d.getDate()}`;
    };

    // ── Render as OHLC candlesticks ──
    // Internal coordinate space is wider/taller than the old 320x80 so candles
    // are legible. The SVG's viewBox is set by drawCandlesticks; CSS on
    // #dynamic-graph stretches it to fill the card.
    //
    // Target Compliance: the combined absolute daily targets across all three
    // subjects becomes the green/red threshold for every candle.
    const metrics = drawCandlesticks(svg, counts, {
        width: 360,
        height: 170,
        penaltyFlags,
        showPrediction: true,
        predDays: 5,
        compact: false,
        invert: false,
        valueLabel: 'solves',
        labelFn,
        targetValue: (baseTargets.physics + baseTargets.chemistry + baseTargets.maths),
    });

    // ── Loss Aversion / Projection Slope Flasher ──
    // Reads the regression { slope, r2 } returned by the engine and toggles
    // dashboard-level trend classes that drive the gamified CSS feedback layer.
    const mainGraphContainer = document.getElementById('view-dashboard');
    if (mainGraphContainer && metrics && typeof metrics.slope === 'number') {
        if (metrics.slope < -0.1) {
            mainGraphContainer.classList.add('trend-under-liquidation');
            mainGraphContainer.classList.remove('trend-bull-market');
            svg.classList.remove('graph-bull-run');
        } else if (metrics.slope > 0.1 && metrics.r2 > 0.7) {
            mainGraphContainer.classList.add('trend-bull-market');
            mainGraphContainer.classList.remove('trend-under-liquidation');
            svg.classList.add('graph-bull-run');
        } else {
            // Neutral zone — clear any stale trend state from previous renders.
            mainGraphContainer.classList.remove('trend-bull-market');
            mainGraphContainer.classList.remove('trend-under-liquidation');
            svg.classList.remove('graph-bull-run');
        }
    }
}

// ==================== 15-DAY ERROR MOMENTUM (candlestick edition) ====================
/**
 * Re-renders #error-momentum-svg-container as a compact candlestick chart.
 *
 * Strategy: matrix.js's renderErrorResolutionDashboard() already draws a
 * sparkline (polyline / bars / dots) into the container. We run AFTER it (via
 * requestAnimationFrame), read the data points back out with
 * extractCountsFromSvg(), and replace the contents with candlesticks.
 *
 * This means zero changes to matrix.js and no need to know its internal data
 * structures — whatever it plotted becomes candles.
 */
export function renderMomentumCandles() {
    const container = document.getElementById('error-momentum-svg-container');
    if (!container) return;

    // Defer one frame so matrix.js's render completes first.
    requestAnimationFrame(() => {
        const counts = extractCountsFromSvg(container);
        if (!counts || counts.length < 2) return;

        const w = Math.max(container.clientWidth || 320, 240);
        const h = 70;

        // Reset container & build a fresh SVG.
        container.innerHTML = '';
        const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
        svgEl.setAttribute('preserveAspectRatio', 'none');
        svgEl.style.width = '100%';
        svgEl.style.height = h + 'px';
        svgEl.style.display = 'block';
        container.appendChild(svgEl);

        drawCandlesticks(svgEl, counts, {
            width: w,
            height: h,
            compact: true,
            invert: true,           // green = errors fell (good), red = rose (bad)
            valueLabel: 'errors',
            showPrediction: false,
            labelFn: (i) => `Day ${i + 1}`,
        });

        // Refresh the avg/day label above the chart, if present.
        const avgLbl = document.getElementById('erm-avg-label');
        if (avgLbl) {
            const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
            avgLbl.textContent = `avg ${avg.toFixed(1)}/day`;
        }
    });
}

// ==================== CALENDAR ====================
export function renderCalendar() {
    const grid = document.getElementById('cal-grid');
    grid.innerHTML = '';
    let currentLiveDate = new Date();
    let d = new Date(currentLiveDate.getFullYear(), currentLiveDate.getMonth() + AppState.calMonthOffset, 1);
    document.getElementById('cal-month-lbl').textContent =
        `${monthNamesCal[d.getMonth()]} ${d.getFullYear()}`;
    for (let i = 0; i < d.getDay(); i++) grid.innerHTML += `<div class="cal-day"></div>`;
    let days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    for (let i = 1; i <= days; i++) {
        let sClass = 'active-month';
        if (AppState.calMonthOffset === 0 && i === currentLiveDate.getDate()) sClass += ' today';
        grid.innerHTML += `<div class="cal-day ${sClass}">${i}</div>`;
    }
}

export function shiftMonth(dir) {
    AppState.calMonthOffset += dir;
    renderCalendar();
}

// ==================== PRACTICE: SUBJECTS & CHAPTERS ====================
export function selectSubject(s) {
    AppState.currentSubject = s;
    renderChaptersList();
    showPracticeSubview('practice-chapters-view');
    document.getElementById('chapters-subject-title').innerText =
        `${s.toUpperCase()} - Domain Zone`;
}

export function goToSubjects() {
    showPracticeSubview('practice-subject-view');
}

export function goToChapters() {
    renderChaptersList();
    showPracticeSubview('practice-chapters-view');
}

export function goToChapterDetail() {
    showPracticeSubview('practice-chapter-detail-view');
}

export function openChapterDetail(ch) {
    AppState.currentChapter = ch;
    // Sticky filter reset: whenever a fresh chapter workspace is mounted, the
    // active filter choice is reset back to baseline. This prevents a filter
    // selection carried over from a previous chapter (e.g. "wrong" on a
    // chapter that had flawed questions) from showing an empty list in a newly
    // selected chapter whose questions are all unsolved/solved.
    AppState.currentFilter = 'all';
    document.getElementById('detail-chapter-name').innerHTML =
        `${ch} <span style="font-size:14px; color:#8a8ad3;">(${AppState.currentSubject})</span>`;
    showPracticeSubview('practice-chapter-detail-view');
}

export function renderChaptersList() {
    let cont = document.getElementById('chapters-list-container');
    cont.innerHTML = '';
    (AppState.chapters[AppState.currentSubject] || []).forEach(ch => {
        let div = document.createElement('div');
        div.className = 'chapter-item';
        div.innerHTML =
            `<span>${ch}</span><span class="delete-chapter" onclick="event.stopPropagation(); deleteChapter('${ch}')">🗑</span>`;
        div.onclick = () => openChapterDetail(ch);
        cont.appendChild(div);
    });
}

export function deleteChapter(ch) {
    if (confirm(`Nuke "${ch}"? This wipes everything inside.`)) {
        AppState.chapters[AppState.currentSubject] = AppState.chapters[AppState.currentSubject].filter(c => c !== ch);
        // Use splice to avoid reassigning the exported let binding
        for (let i = AppState.questionBank.length - 1; i >= 0; i--) {
            if (AppState.questionBank[i].subject === AppState.currentSubject && AppState.questionBank[i].chapter === ch) {
                AppState.questionBank.splice(i, 1);
            }
        }
        saveAllAsync().catch(console.error);
        renderChaptersList();
    }
}

export function addChapter() {
    let name = document.getElementById('new-chapter-input').value.trim();
    if (name && !AppState.chapters[AppState.currentSubject].includes(name)) {
        AppState.chapters[AppState.currentSubject].push(name);
        saveAllAsync().catch(console.error);
        renderChaptersList();
    }
    closeModalStr('add-chapter-modal');
    document.getElementById('new-chapter-input').value = '';
}

// ==================== SETTINGS ====================
export function previewImage(event, target) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            if (target === 'pfp') {
                AppState.profilePicData = e.target.result;
                document.getElementById('file-name-lbl').textContent = file.name;
            } else if (target === 'error') {
                AppState.newErrorPicData = e.target.result;
                const successEl = document.getElementById('err-img-success');
                if (successEl) successEl.style.display = 'block';
            }
        };
        reader.readAsDataURL(file);
    }
}

export async function saveProfile() {
    const name = document.getElementById('set-username').value;
    document.getElementById('display-username').textContent = name;
    if (AppState.profilePicData) document.getElementById('display-pfp').src = AppState.profilePicData;
    await saveAllAsync();
    alert("Profile data locked in. Your build has been updated.");
}

export async function saveTargets() {
    baseTargets.physics = parseInt(document.getElementById('set-tgt-phys').value) || 10;
    baseTargets.chemistry = parseInt(document.getElementById('set-tgt-chem').value) || 10;
    baseTargets.maths = parseInt(document.getElementById('set-tgt-math').value) || 10;
    await idbSet('basePhys', baseTargets.physics);
    await idbSet('baseChem', baseTargets.chemistry);
    await idbSet('baseMath', baseTargets.maths);
    await idbSet('jeeTargetLockDate', new Date().toISOString());
    AppState.activeTargets.physics = Math.round(baseTargets.physics * AppState.moodMultiplier);
    AppState.activeTargets.chemistry = Math.round(baseTargets.chemistry * AppState.moodMultiplier);
    AppState.activeTargets.maths = Math.round(baseTargets.maths * AppState.moodMultiplier);
    updateUI();
    lockTargetsOnly();
    alert("Symmetry constraints locked for the next 24h. No escaping now. Get to work.");
}

/**
 * NEW: Save Daily Error Resolution Targets and lock for 24 hours.
 * Reads from #set-err-phys, #set-err-chem, #set-err-math.
 */
window.saveErrTargets = async function saveErrTargets() {
    const phys = parseInt(document.getElementById('set-err-phys').value) || 5;
    const chem = parseInt(document.getElementById('set-err-chem').value) || 5;
    const math = parseInt(document.getElementById('set-err-math').value) || 5;

    baseErrorTargets.physics = phys;
    baseErrorTargets.chemistry = chem;
    baseErrorTargets.maths = math;

    await idbSet('baseErrPhys', phys);
    await idbSet('baseErrChem', chem);
    await idbSet('baseErrMath', math);

    // Shared lock date (both target sets lock together)
    await idbSet('jeeTargetLockDate', new Date().toISOString());

    lockTargetsOnly();
    renderErrorResolutionDashboard();
    if (typeof renderMomentumCandles === 'function') renderMomentumCandles();
};

/**
 * Lock target inputs (daily output AND error resolution) when lock date is active.
 */
export function lockTargetsOnly() {
    // Daily output target inputs
    document.getElementById('set-tgt-phys').disabled = true;
    document.getElementById('set-tgt-chem').disabled = true;
    document.getElementById('set-tgt-math').disabled = true;
    document.getElementById('btn-save-settings').disabled = true;
    document.getElementById('target-lock-lbl').classList.add('visible');

    // Error resolution target inputs (NEW)
    const errPhysIn = document.getElementById('set-err-phys');
    const errChemIn = document.getElementById('set-err-chem');
    const errMathIn = document.getElementById('set-err-math');
    const btnErrSave = document.getElementById('btn-save-err-settings');
    const errLockLbl = document.getElementById('err-target-lock-lbl');

    if (errPhysIn) errPhysIn.disabled = true;
    if (errChemIn) errChemIn.disabled = true;
    if (errMathIn) errMathIn.disabled = true;
    if (btnErrSave) btnErrSave.disabled = true;
    if (errLockLbl) errLockLbl.classList.add('visible');
}

export async function testGeminiKey() {
    const key = document.getElementById('gemini-key').value;
    if (!key) return alert("No API key found. Add one in Config first.");
    AppState.geminiApiKey = key;
    await idbSet('gemini_api_key', key);
    try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        document.getElementById('key-test-result').innerHTML = r.ok ? '✅ Key verified. You\'re good.' : '❌ Key rejected. Try again.';
    } catch (e) {
        document.getElementById('key-test-result').innerHTML = '⚠️ Network ded. Try again.';
    }
}
// ==================== PRACTICE: UPLOAD & MULTI-CROP SYSTEM ====================
export function initCropSession(base64Images) {
    cropSession.sourceImages = base64Images.map((dataUrl, idx) => ({ id: idx, dataUrl }));
    cropSession.allQuestions = [];
    cropSession.currentQuestionIdx = 0;
    // Safety: entering the traditional multi-crop pipeline must always clear
    // any lingering surgical target so the two flows never contaminate each
    // other. endDraw() branches on this flag.
    cropSession.surgicalTargetIdx = null;
    startNewQuestion();
}

export function startNewQuestion() {
    cropSession.allQuestions.push({ segments: [], stitchedImage: null, questionOnly: null });
    refreshCropUI();
}

export function refreshCropUI() {
    const strip = document.getElementById('source-strip');
    const segBar = document.getElementById('segments-bar');
    const inst = document.getElementById('crop-instruction');
    const redrawBtn = document.getElementById('crop-redraw');
    const confirmBtn = document.getElementById('crop-confirm-question');
    const nextBtn = document.getElementById('crop-next-question');
    const finishBtn = document.getElementById('crop-finish');

    // ── Surgical single-crop mode detection ──────────────────────────────
    // surgicalTargetIdx is set by window.triggerSurgicalDiagramUpload(idx).
    // When active, we swap the instruction copy, hide the entire multi-crop
    // button row, and let endDraw() auto-confirm on pointer release. The
    // canvas wiring itself is reused verbatim — only the post-crop handler
    // and the chrome around the canvas differ.
    const surgicalMode = Number.isInteger(cropSession.surgicalTargetIdx);

    strip.innerHTML = '';
    cropSession.canvasRefs = {};
    cropSession.ctxRefs = {};
    cropSession.imgRefs = {};

    cropSession.sourceImages.forEach(src => {
        const container = document.createElement('div');
        container.className = 'source-image-item';

        const img = document.createElement('img');
        img.src = src.dataUrl;
        img.id = `src-img-${src.id}`;
        container.appendChild(img);

        const canvas = document.createElement('canvas');
        canvas.id = `src-canvas-${src.id}`;
        canvas.className = 'crop-canvas';
        container.appendChild(canvas);

        strip.appendChild(container);

        cropSession.canvasRefs[src.id] = canvas;
        cropSession.imgRefs[src.id] = img;

        img.onload = () => {
            canvas.width = img.clientWidth;
            canvas.height = img.clientHeight;
            canvas.style.width = img.clientWidth + 'px';
            canvas.style.height = img.clientHeight + 'px';
            cropSession.ctxRefs[src.id] = canvas.getContext('2d');
            redrawAllRectangles(src.id);
        };
        if (img.complete) img.onload();
    });

    const _cq = cropSession.allQuestions[cropSession.currentQuestionIdx];
    segBar.innerHTML = '';
    // In surgical mode the segment preview bar is intentionally left empty —
    // the moment the user finishes drawing, endDraw() short-circuits straight
    // into AppState.extractedItems[idx].diagramImageUrl and tears the modal
    // down, so there is never a persisted segment to preview.
    if (_cq) {
        _cq.segments.forEach((seg, idx) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'segment-preview';
            wrapper.style.borderColor = seg.isDiagram ? '#f97316' : '#3b82f6';
            const thumb = document.createElement('img');
            thumb.src = seg.cropDataUrl;
            wrapper.appendChild(thumb);
            const delBtn = document.createElement('button');
            delBtn.className = 'delete-segment-btn';
            delBtn.textContent = '✕';
            delBtn.onclick = () => { deleteSegment(idx); };
            wrapper.appendChild(delBtn);
            segBar.appendChild(wrapper);
        });
    }

    if (surgicalMode) {
        // Surgical copy: tell the user exactly which question index they are
        // binding a diagram to. Use 1-based indexing for human readability.
        inst.textContent = `Surgical Crop: Draw a single box around the diagram to bind it to Question ${cropSession.surgicalTargetIdx + 1}.`;
        // Hide the entire multi-crop control row — there is no "next question",
        // "lock question", or "finish" step in this flow. The crop modal is
        // closed automatically by endDraw() the moment a box is committed.
        if (redrawBtn) redrawBtn.style.display = 'none';
        if (confirmBtn) confirmBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
        if (finishBtn) finishBtn.style.display = 'none';
    } else {
        inst.textContent = `Q ${cropSession.currentQuestionIdx + 1}: Draw boxes around the question. Click □ inside a box to mark it as a diagram.`;
        redrawBtn.style.display = _cq && _cq.segments.length > 0 ? 'inline-block' : 'none';
        confirmBtn.style.display = 'inline-block';
        confirmBtn.textContent = '✓ Lock Question';
        nextBtn.style.display = 'none';
        finishBtn.style.display = 'none';
    }

    Object.keys(cropSession.canvasRefs).forEach(srcIdStr => {
        const srcId = parseInt(srcIdStr);
        const canvas = cropSession.canvasRefs[srcId];

        canvas.onmousedown = (e) => {
            const pos = getCanvasCoordsFromEvent(srcId, e);
            const _cq = cropSession.allQuestions[cropSession.currentQuestionIdx];
            const segsOnThisSource = _cq.segments.filter(s => s.sourceId === srcId);
            for (let seg of segsOnThisSource) {
                if (isInsideToggleButton(seg, pos.x, pos.y)) {
                    seg.isDiagram = !seg.isDiagram;
                    redrawAllRectangles(srcId);
                    refreshCropUI();
                    return;
                }
            }
            startDraw(srcId, e);
        };
        canvas.onmousemove = (e) => draw(e);
        canvas.onmouseup = (e) => endDraw(e);
        canvas.onmouseleave = (e) => endDraw(e);

        canvas.ontouchstart = (e) => {
            e.preventDefault();
            const t = e.touches[0];
            const pos = getCanvasCoordsFromEvent(srcId, { clientX: t.clientX, clientY: t.clientY });
            const _cq = cropSession.allQuestions[cropSession.currentQuestionIdx];
            const segsOnThisSource = _cq.segments.filter(s => s.sourceId === srcId);
            for (let seg of segsOnThisSource) {
                if (isInsideToggleButton(seg, pos.x, pos.y)) {
                    seg.isDiagram = !seg.isDiagram;
                    redrawAllRectangles(srcId);
                    refreshCropUI();
                    return;
                }
            }
            startDraw(srcId, { clientX: t.clientX, clientY: t.clientY });
        };
        canvas.ontouchmove = (e) => { e.preventDefault(); const t = e.touches[0]; draw({ clientX: t.clientX, clientY: t.clientY }); };
        canvas.ontouchend = (e) => { e.preventDefault(); endDraw(e); };
    });
}

function isInsideToggleButton(seg, x, y) {
    const btnSize = cropSession.toggleButtonSize;
    const rect = seg.rect;
    const btnX = rect.x, btnY = rect.y;
    return (x >= btnX && x <= btnX + btnSize && y >= btnY && y <= btnY + btnSize);
}

function getCanvasCoordsFromEvent(srcId, e) {
    const canvas = cropSession.canvasRefs[srcId];
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function startDraw(srcId, e) {
    const pos = getCanvasCoordsFromEvent(srcId, e);
    cropSession.activeCrop = true;
    cropSession.drawing = { startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y, sourceId: srcId };
    redrawAllRectangles(srcId);
}

function draw(e) {
    if (!cropSession.activeCrop) return;
    const srcId = cropSession.drawing.sourceId;
    const pos = getCanvasCoordsFromEvent(srcId, e);
    cropSession.drawing.endX = pos.x;
    cropSession.drawing.endY = pos.y;
    const ctx = cropSession.ctxRefs[srcId];
    if (ctx) {
        redrawAllRectangles(srcId);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.setLineDash([6]);
        const x = Math.min(cropSession.drawing.startX, cropSession.drawing.endX);
        const y = Math.min(cropSession.drawing.startY, cropSession.drawing.endY);
        const w = Math.abs(cropSession.drawing.endX - cropSession.drawing.startX);
        const h = Math.abs(cropSession.drawing.endY - cropSession.drawing.startY);
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = 'rgba(59,130,246,0.15)';
        ctx.fillRect(x, y, w, h);
    }
}

function endDraw(e) {
    if (!cropSession.activeCrop) return;
    cropSession.activeCrop = false;
    const { startX, startY, endX, endY, sourceId } = cropSession.drawing;
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.abs(endX - startX);
    const h = Math.abs(endY - startY);
    if (w < 5 || h < 5) {
        redrawAllRectangles(sourceId);
        return;
    }
    const img = cropSession.imgRefs[sourceId];
    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;
    const bbox = {
        x: (x * scaleX) / img.naturalWidth,
        y: (y * scaleY) / img.naturalHeight,
        w: (w * scaleX) / img.naturalWidth,
        h: (h * scaleY) / img.naturalHeight
    };
    cropImageFromBBox(cropSession.sourceImages[sourceId].dataUrl, bbox).then(croppedDataUrl => {
        // ── Surgical single-crop bypass ─────────────────────────────────
        // When surgicalTargetIdx is set, skip the sequential segments.push
        // loop entirely. The cropped data URL is assigned directly to the
        // targeted text-track item, the canvas references are torn down, the
        // surgical flag is cleared, the modal is closed, and the preview is
        // re-rendered so the new diagram thumbnail appears instantly.
        if (Number.isInteger(cropSession.surgicalTargetIdx)) {
            const targetIdx = cropSession.surgicalTargetIdx;
            if (AppState.extractedItems && AppState.extractedItems[targetIdx]) {
                AppState.extractedItems[targetIdx].diagramImageUrl = croppedDataUrl;
            }
            // Cleanup sequence: detach canvas listeners, clear refs, reset
            // surgical flag, close modal, refresh preview.
            Object.values(cropSession.canvasRefs || {}).forEach(c => {
                c.onmousedown = null;
                c.onmousemove = null;
                c.onmouseup = null;
                c.onmouseleave = null;
                c.ontouchstart = null;
                c.ontouchmove = null;
                c.ontouchend = null;
                c.ontouchcancel = null;
            });
            cropSession.canvasRefs = {};
            cropSession.ctxRefs = {};
            cropSession.imgRefs = {};
            cropSession.sourceImages = [];
            cropSession.allQuestions = [];
            cropSession.currentQuestionIdx = 0;
            cropSession.activeCrop = false;
            cropSession.drawing = { startX: 0, startY: 0, endX: 0, endY: 0, sourceId: null };
            cropSession.surgicalTargetIdx = null;
            // Force-hide the crop modal SYNCHRONOUSLY (not closeModalStr's
            // 300ms deferred fade-out) so it can't linger on top of the
            // preview modal we're about to reopen. Without this, both overlays
            // are display:flex for 300ms and the crop modal can capture
            // pointer events meant for the preview grid.
            forceHideModal('crop-modal');
            showPreviewModal();
            return;
        }
        // ── Traditional multi-crop pipeline (untouched) ──────────────────
        const _cq = cropSession.allQuestions[cropSession.currentQuestionIdx];
        _cq.segments.push({
            sourceId,
            rect: { x, y, w, h },
            cropDataUrl: croppedDataUrl,
            isDiagram: false
        });
        redrawAllRectangles(sourceId);
        refreshCropUI();
    });
}

function redrawAllRectangles(srcId) {
    const ctx = cropSession.ctxRefs[srcId];
    if (!ctx) return;
    const canvas = cropSession.canvasRefs[srcId];
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const _cq = cropSession.allQuestions[cropSession.currentQuestionIdx];
    _cq.segments.filter(seg => seg.sourceId === srcId).forEach(seg => {
        const color = seg.isDiagram ? '#f97316' : '#3b82f6';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(seg.rect.x, seg.rect.y, seg.rect.w, seg.rect.h);
        ctx.fillStyle = seg.isDiagram ? 'rgba(249,115,22,0.15)' : 'rgba(59,130,246,0.15)';
        ctx.fillRect(seg.rect.x, seg.rect.y, seg.rect.w, seg.rect.h);

        const btnSize = cropSession.toggleButtonSize;
        const btnX = seg.rect.x, btnY = seg.rect.y;
        ctx.fillStyle = 'rgba(15, 15, 25, 0.85)';
        ctx.beginPath();
        ctx.roundRect(btnX, btnY, btnSize, btnSize, 6);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(seg.isDiagram ? 'D' : 'Q', btnX + btnSize / 2, btnY + btnSize / 2);
    });
}

export function deleteSegment(index) {
    const _cq = cropSession.allQuestions[cropSession.currentQuestionIdx];
    _cq.segments.splice(index, 1);
    Object.keys(cropSession.canvasRefs).forEach(srcIdStr => {
        redrawAllRectangles(parseInt(srcIdStr));
    });
    refreshCropUI();
}

export function clearLastSegment() {
    const _cq = cropSession.allQuestions[cropSession.currentQuestionIdx];
    if (_cq.segments.length > 0) {
        _cq.segments.pop();
        Object.keys(cropSession.canvasRefs).forEach(srcIdStr => redrawAllRectangles(parseInt(srcIdStr)));
        refreshCropUI();
    }
}

export function stitchSegmentsVertically(segments) {
    return new Promise(async (resolve) => {
        if (segments.length === 0) return resolve(null);
        const imgs = await Promise.all(segments.map(seg => new Promise(res => {
            const img = new Image();
            img.onload = () => res(img);
            img.src = seg.cropDataUrl;
        })));
        const maxWidth = Math.max(...imgs.map(img => img.width));
        const totalHeight = imgs.reduce((sum, img) => sum + img.height, 0);
        const canvas = document.createElement('canvas');
        canvas.width = maxWidth;
        canvas.height = totalHeight;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, maxWidth, totalHeight);
        let yOffset = 0;
        imgs.forEach(img => {
            const xOffset = (maxWidth - img.width) / 2;
            ctx.drawImage(img, xOffset, yOffset);
            yOffset += img.height;
        });
        resolve(canvas.toDataURL('image/png'));
    });
}

export function combineImagesSideBySide(leftImg, rightImg) {
    return new Promise((resolve) => {
        if (!leftImg && !rightImg) return resolve(null);
        const left = new Image();
        const right = new Image();
        let leftLoaded = false, rightLoaded = false;
        const tryCombine = () => {
            if ((leftImg && !leftLoaded) || (rightImg && !rightLoaded)) return;
            const leftW = leftImg ? left.width : 0;
            const leftH = leftImg ? left.height : 0;
            const rightW = rightImg ? right.width : 0;
            const rightH = rightImg ? right.height : 0;
            const totalWidth = leftW + rightW;
            const maxHeight = Math.max(leftH, rightH);
            const canvas = document.createElement('canvas');
            canvas.width = totalWidth;
            canvas.height = maxHeight;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, totalWidth, maxHeight);
            if (leftImg) ctx.drawImage(left, 0, 0);
            if (rightImg) {
                const yOffset = (maxHeight - rightH) / 2;
                ctx.drawImage(right, leftW, yOffset);
            }
            resolve(canvas.toDataURL('image/png'));
        };
        if (leftImg) { left.onload = () => { leftLoaded = true; tryCombine(); }; left.src = leftImg; }
        else { leftLoaded = true; }
        if (rightImg) { right.onload = () => { rightLoaded = true; tryCombine(); }; right.src = rightImg; }
        else { rightLoaded = true; }
        if (leftLoaded && rightLoaded) tryCombine();
    });
}

export async function confirmMultiCropQuestion() {
    const _cq = cropSession.allQuestions[cropSession.currentQuestionIdx];
    if (_cq.segments.length === 0) { alert('Nothing selected. Draw at least one box around the question.'); return; }
    const questionSegs = _cq.segments.filter(s => !s.isDiagram);
    const diagramSegs = _cq.segments.filter(s => s.isDiagram);
    if (questionSegs.length === 0) { alert('At least one box needs to be a question part (Q). Mark it.'); return; }

    const questionStitched = await stitchSegmentsVertically(questionSegs);
    const diagramStitched = diagramSegs.length > 0 ? await stitchSegmentsVertically(diagramSegs) : null;

    const combinedImage = await combineImagesSideBySide(questionStitched, diagramStitched);
    _cq.stitchedImage = combinedImage;
    _cq.questionOnly = questionStitched;

    document.getElementById('crop-confirm-question').style.display = 'none';
    document.getElementById('crop-next-question').style.display = 'inline-block';
    document.getElementById('crop-finish').style.display = 'inline-block';
    document.getElementById('crop-redraw').style.display = 'none';
    document.getElementById('crop-instruction').textContent = 'Question locked. Add the next one or wrap up.';
}

export function nextQuestionInSession() {
    cropSession.currentQuestionIdx++;
    startNewQuestion();
}

export function finishAllQuestions() {
    const items = [];
    cropSession.allQuestions.forEach(q => {
        if (q.stitchedImage) {
            items.push({
                imageDataUrl: q.stitchedImage,
                questionOnlyDataUrl: q.questionOnly,
                diagramImageUrl: null,
                extractedText: "",
                options: [],
                correctAnswer: "",
                type: "text",
                timeTaken: 0,
                solution: "",
                // ── Cognitive MMR: seed the dynamic Implied Difficulty Rating
                // (qElo). Defaults to the running chapter average Elo, or 1200
                // if the chapter is clean. Re-affirmed at saveAllQuestions(). ──
                qElo: _computeDefaultQEloForCurrentChapter(),
                isAnomaly: false,
            });
        }
    });
    AppState.extractedItems = items;
    closeCropModal();
    showPreviewModal();
    cropSession = { sourceImages: [], currentQuestionIdx: 0, allQuestions: [], activeCrop: false, drawing: {}, canvasRefs: {}, ctxRefs: {}, imgRefs: {}, surgicalTargetIdx: null };
}

export function cancelCropSession() {
    if (confirm('Nuke all crops? No going back.')) {
        closeCropModal();
        cropSession = { sourceImages: [], currentQuestionIdx: 0, allQuestions: [], activeCrop: false, drawing: {}, canvasRefs: {}, ctxRefs: {}, imgRefs: {}, surgicalTargetIdx: null };
        AppState.extractedItems = [];
    }
}

export async function startManualCrop() {
    let files = document.getElementById('upload-images').files;
    if (!files.length) { alert("Select at least one image c'mon"); return; }
    let apiKey = document.getElementById('gemini-key').value;
    if (!apiKey) { alert("Drop your Gemini API key in Config first"); return; }
    AppState.geminiApiKey = apiKey;
    await idbSet('gemini_api_key', apiKey);
    document.getElementById('upload-progress').style.width = '0%';
    document.getElementById('upload-status-text').innerText = 'Loading the payload...';
    Promise.all(Array.from(files).map(readFileAsBase64)).then(base64Array => {
        initCropSession(base64Array);
        document.getElementById('crop-modal').style.display = 'flex';
        document.getElementById('crop-modal').classList.add('active');
        document.getElementById('upload-status-text').innerText = '';
        closeModalStr('upload-modal');
    });
}

export function closeCropModal() {
    const modal = document.getElementById('crop-modal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => { if (!modal.classList.contains('active')) modal.style.display = 'none'; }, 300);
    }
    Object.values(cropSession.canvasRefs || {}).forEach(canvas => {
        if (!canvas) return;
        canvas.onmousedown = null;
        canvas.onmousemove = null;
        canvas.onmouseup = null;
        canvas.onmouseleave = null;
        canvas.ontouchstart = null;
        canvas.ontouchmove = null;
        canvas.ontouchend = null;
        canvas.ontouchcancel = null;
    });
    // ── Bug 1 fix: restore the preview grid after a surgical crop session ──
    // When closeCropModal() is invoked while surgicalTargetIdx is active
    // (user committed a crop via endDraw, or cancelled via the modal backdrop),
    // we need to bring #preview-modal back to the foreground so the user can
    // continue binding diagrams to other questions. finishAllQuestions() and
    // cancelCropSession() handle the multi-crop teardown themselves, so we
    // snapshot the surgical flag BEFORE those callers clear cropSession and
    // only re-open the preview when surgical mode was the active context.
    //
    // Note: endDraw()'s surgical bypass already calls showPreviewModal()
    // directly, so by the time closeCropModal() runs from that path the
    // preview is already restored — calling openModal('preview-modal') again
    // here is a safe idempotent no-op (it just re-asserts display:flex +
    // active class). For the cancel / backdrop-click path this is the ONLY
    // restore point, which is why it must live here.
    if (Number.isInteger(cropSession.surgicalTargetIdx)) {
        // Clear the flag BEFORE opening the preview so any downstream
        // refreshCropUI() call re-enters multi-crop mode cleanly.
        cropSession.surgicalTargetIdx = null;
        // Restore the preview grid. showPreviewModal() both re-renders the
        // card content AND calls openModal('preview-modal'), which is what we
        // want — a stale preview would be worse than none. Guard with a
        // try/catch in case the preview modal was never mounted (e.g. during
        // initial bootstrap).
        try {
            if (typeof showPreviewModal === 'function') {
                showPreviewModal();
            } else if (typeof openModal === 'function') {
                openModal('preview-modal');
            }
        } catch (_e) { /* preview modal unmounted — ignore */ }
    }
}

// Wire upload-images change listener
document.getElementById('upload-images').addEventListener('change', function () {
    const count = this.files.length;
    document.getElementById('file-selected-text').innerText = count > 0 ?
        `${count} file${count > 1 ? 's' : ''} selected` : '';
});

// ==================== PRACTICE: OCR & ANSWER KEY ====================
/**
 * extractTextForAll() — Grid Sheet Matrix Edition
 *
 * Instead of issuing one API request per question (which throttles and
 * adds massive network overhead), this build:
 *   1. collects every un-processed question from AppState.extractedItems,
 *   2. groups them into vertical columns of up to 5 questions,
 *   3. stitches each column vertically (reusing stitchSegmentsVertically),
 *   4. merges all columns side-by-side into ONE master grid canvas,
 *   5. dispatches exactly ONE callGeminiWithFallback request,
 *   6. parses the flat JSON array and hydrates the pending items in order.
 *
 * The downstream preview modal pipeline (showPreviewModal) is left fully
 * intact and is invoked exactly once at the end, exactly as before.
 */
export async function extractTextForAll() {
    // ── 0. Guards ────────────────────────────────────────────────────────
    if (!AppState.extractedItems.length) return alert("No questions captured yet.");
    const apiKey = AppState.geminiApiKey;
    if (!apiKey) return alert("Set API key first. Config → API Key.");

    // ── 1. Extract & group the unprocessed items ────────────────────────
    const pendingItems = AppState.extractedItems.filter(q => !q.extractedText);
    if (!pendingItems.length) {
        return alert("Everything's already been extracted. Nothing left to cook.");
    }

    // Group into sub-arrays (columns) of max 5 questions each.
    const COLUMN_SIZE = 5;
    const columns = [];
    for (let i = 0; i < pendingItems.length; i += COLUMN_SIZE) {
        columns.push(pendingItems.slice(i, i + COLUMN_SIZE));
    }

    showLoading(`Stitching the grid matrix together (${pendingItems.length} questions, ${columns.length} column${columns.length > 1 ? 's' : ''})… Let him cook...`);

    try {
        // ── 2. Stitch each column vertically (concurrent via Promise.all) ───
        // Map each pending question into the { cropDataUrl } shape expected by
        // stitchSegmentsVertically, then run every column concurrently.
        const columnImageDataUrls = await Promise.all(
            columns.map(col => stitchSegmentsVertically(
                col.map(q => ({ cropDataUrl: q.questionOnlyDataUrl || q.imageDataUrl }))
            ))
        );

        // ── 3. Stitch the columns horizontally into a master grid sheet ─────
        // Inline canvas operation: load each column image, sum widths, take the
        // max height, fill white, draw each column at its X-offset.
        const masterGridImage = await (async () => {
            const loaded = await Promise.all(
                columnImageDataUrls
                    .filter(Boolean)              // stitchSegmentsVertically returns null on empty input
                    .map(dataUrl => new Promise((resolve, reject) => {
                        const img = new Image();
                        img.onload = () => resolve(img);
                        img.onerror = () => reject(new Error('Failed to load a stitched column image during master grid assembly.'));
                        img.src = dataUrl;
                    }))
            );
            if (!loaded.length) throw new Error('No column images were produced — cannot assemble master grid sheet.');

            const totalWidth = loaded.reduce((sum, img) => sum + img.width, 0);
            const maxHeight = Math.max(...loaded.map(img => img.height));

            const canvas = document.createElement('canvas');
            canvas.width = totalWidth;
            canvas.height = maxHeight;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, totalWidth, maxHeight);

            let xOffset = 0;
            loaded.forEach(img => {
                // Vertically anchor each column to the top so reading order
                // (top→bottom within column) is visually unambiguous.
                ctx.drawImage(img, xOffset, 0);
                xOffset += img.width;
            });

            return canvas.toDataURL('image/png');
        })();

        // ── 4. Dispatch the master batch prompt (exactly ONE request) ───────
        showLoading(`Beaming the macro grid to the mothership (${pendingItems.length} questions)… Parsing variables...`);
        const prompt = `You are a precision academic OCR transcriber specializing in Indian competitive engineering examinations (IIT JEE Advanced). You are looking at a single high-definition grid sheet containing exactly ${pendingItems.length} physics, chemistry, or mathematics questions separated by grid lines. Parse the grid cell-by-cell (column-by-column, top-to-bottom).

CRITICAL COMMAND FOR STRICT KATEX TOKENIZATION:
You are strictly forbidden from outputting mathematical symbols, variables, numbers, constants, operators, units, or chemical expressions as raw plain text. If a character can be rendered in KaTeX, it MUST be wrapped in delimiters.

Follow these exact strict formatting rules for your JSON strings:

1. SINGLE VARIABLES & COEFFICIENTS (Math Italic):
   - WRONG: "Find the value of x where y = 2"
   - CORRECT: "Find the value of $x$ where $y = 2$"

2. NUMBERS WITH ACADEMIC UNITS (Thin space before upright text units):
   - WRONG: "velocity is 3 x 10^8 m/s" or "mass is 5 kg"
   - CORRECT: "velocity is $3 \\\\times 10^8 ~ \\\\text{m/s}$" or "mass is $5 ~ \\\\text{kg}$"

3. CHEMICAL EQUATIONS & THERMODYNAMICS (Uniform upright Roman font via \\\\mathrm):
   - WRONG: "H2O at delta H = -ve" or "Fe2O3 + 2Al"
   - CORRECT: "$\\\\mathrm{H_2O}$ at $\\\\Delta H = -\\\\text{ve}$" or "$\\\\mathrm{Fe_2O_3} + 2\\\\mathrm{Al}$"

4. INLINE OPERATORS & GREEK SYMBOLS:
   - WRONG: "angle theta is greater than or equal to 0"
   - CORRECT: "angle $\\\\theta \\\\ge 0$"

5. FRACTIONS, POWERS, & ROOTS:
   - WRONG: "x^(1/2) or 3/4"
   - CORRECT: "$x^{1/2}$ or $\\\\frac{3}{4}$"

JSON ESCAPING RULES:
- Use single dollar signs ($...$) for all inline characters, expressions, numbers, and units.
- Use double dollar signs ($$...$$) ONLY for centered standalone equations.
- CRITICAL: Because you are returning a raw JSON string, EVERY backslash must be explicitly double-escaped in your output text (e.g., type \\\\times, \\\\text, \\\\mathrm, \\\\frac) so that JSON.parse() can resolve the string successfully without hitting unexpected escape sequence tokens.

OUTPUT FORMAT:
Return a flat single JSON array containing exactly ${pendingItems.length} objects matching this exact sequence: [ { "extractedText": "...", "options": ["A) ...", "B) ..."] }, ... ]. If there are no options inside a cell, leave that specific "options" array completely empty.`;

        const res = await callGeminiWithFallback(apiKey, prompt, masterGridImage, 'image/png', null, true);

        // ── 5. Parse & map the matrix payload ───────────────────────────────
        const parsed = cleanAndParseJson(res.text);
        if (!Array.isArray(parsed)) {
            throw new Error('Master OCR response was not a JSON array — aborting to avoid misaligned state.');
        }
        if (parsed.length !== pendingItems.length) {
            throw new Error(
                `Matrix payload size mismatch: expected ${pendingItems.length} items, received ${parsed.length}. ` +
                `No partial data has been written to state.`
            );
        }

        // Hydrate the flat pending-items list in perfect sequential order.
        // This runs only AFTER all validations pass, so no partial / misaligned
        // data can ever be written to state memory.
        parsed.forEach((obj, i) => {
            const q = pendingItems[i];
            const options = Array.isArray(obj.options) ? obj.options : [];
            q.extractedText = typeof obj.extractedText === 'string' ? obj.extractedText : '';
            q.options = options;
            q.type = options.length > 0 ? 'mcq' : 'text';
        });
    } catch (err) {
        // ── 6. Error handling boundary ──────────────────────────────────────
        // Covers column stitching, canvas grid assembly, network transaction,
        // and JSON parsing / size-mismatch. No partial data is ever written
        // because hydration only happens after every validation passes above.
        console.error('extractTextForAll() Grid Sheet Matrix failure:', err);
        hideLoading();
        alert(`OCR crashed and burned: ${err && err.message ? err.message : err}. No partial data was applied.`);
        return;
    }

    // ── Downstream preview pipeline (preserved exactly) ─────────────────
    hideLoading();
    showPreviewModal();
    alert('Text extracted and stored. Let\'s go.');
}

export async function processAnswerKey() {
    let file = document.getElementById('answer-key-image').files[0];
    if (!file) return alert("No answer key selected. Upload one.");
    const apiKey = AppState.geminiApiKey;
    if (!apiKey) return alert("Set API key first. Config → API Key.");
    if (AppState.extractedItems.length === 0) return alert("No questions in the buffer. Crop some first.");
    if (AppState.extractedItems.some(item => !item.extractedText)) {
        return alert("Error: Run 'Extract Text' first. The AI needs context before it can map answers.");
    }
    showLoading("Decoding visual answer assets... Verifying criteria inputs...");
    const base64 = await readFileAsBase64(file);
    const questionReferences = AppState.extractedItems.map((q, idx) =>
        `Target ID: ${idx}\nContent: ${q.extractedText}`).join('\n\n');
    const prompt = `You are an advanced academic matching algorithm. Below is an inventory of target items tracked in memory. Attached is an image containing an answer key sheet or structural solutions block. Your constraint is to read the mathematical context of each item and map its corresponding correct answer and step-by-step solution from the image to the correct Target ID.\n\nTarget Context Metrics:\n${questionReferences}\n\nCRITICAL JSON CONFORMITY ESCAPING RULE: Because step-by-step solutions contain heavy LaTeX mathematical notation, every single backslash character '\\' inside the solution text string MUST be double-escaped as '\\\\' in your raw JSON output payload (e.g., write '\\\\frac{x}{y}' or '\\\\sigma' instead of '\\frac{x}{y}' or '\\sigma'). If you do not double-escape backslashes, the JSON parser breaks.\n\nReturn ONLY a JSON array matching target IDs: [ { "id": 0, "answer": "...", "solution": "..." }, ... ]

IMPORTANT – MULTI‑ANSWER QUESTIONS:
- If a question has **more than one correct option** (e.g., "A and C"), output the answer as a **sorted array of letter strings**, like: "answer": ["A","C"].
- If only one answer is correct, output a simple string: "answer": "B".
- Do NOT output "A, C" or "A and C" as a string – always use the array format for multiple answers.`;
    try {
        const res = await callGeminiWithFallback(apiKey, prompt, base64, file.type, () => { }, true);
        const arr = cleanAndParseJson(res.text);
        arr.forEach(item => {
            let idx = parseInt(item.id);
            if (!isNaN(idx) && idx >= 0 && idx < AppState.extractedItems.length) {
                let rawAnswer = item.answer;
                let ans;
                if (Array.isArray(rawAnswer)) {
                    ans = [...new Set(rawAnswer.map(a => a.toUpperCase().trim()))].sort();
                } else {
                    ans = (rawAnswer || "").toString().trim();
                }

                AppState.extractedItems[idx].correctAnswer = ans;
                AppState.extractedItems[idx].solution = item.solution || "";

                if (Array.isArray(ans)) {
                    AppState.extractedItems[idx].type = 'mcq';
                } else if (/^[A-D]$/i.test(ans) && AppState.extractedItems[idx].options.length > 0) {
                    AppState.extractedItems[idx].type = 'mcq';
                } else if (/^-?\d+(\.\d+)?$/.test(ans)) {
                    AppState.extractedItems[idx].type = 'numeric';
                } else {
                    AppState.extractedItems[idx].type = 'text';
                }
            }
        });
        hideLoading();
        alert('Answer mapping complete via image. All locked in.');
        showPreviewModal();
    } catch (e) {
        hideLoading();
        alert("Mapping crashed: " + e.message);
    }
}

export async function processAnswerKeyFromText() {
    const text = document.getElementById('answer-key-text').value.trim();
    if (!text) return alert("Paste the answer key first. It's empty.");
    const apiKey = AppState.geminiApiKey;
    if (!apiKey) return alert("Drop your API key in Config.");
    if (AppState.extractedItems.length === 0) return alert("Nothing in the buffer. Crop some questions first.");
    if (AppState.extractedItems.some(item => !item.extractedText)) {
        return alert("Error: Run 'Extract Text' first. The AI needs context before it can map answers.");
    }
    showLoading("Decoding visual answer assets... Verifying criteria inputs...");
    const questionReferences = AppState.extractedItems.map((q, idx) =>
        `Target ID: ${idx}\nContent: ${q.extractedText}`).join('\n\n');
    const prompt = `You are a semantic analysis matrix. You are provided a list of target context queries, and a messy plain-text data feed containing structural answers and step-by-step documentation. Your operational profile is to align the mathematical criteria and link each answer/solution payload directly back to the target index using its "id".\n\nTarget Context Metrics:\n${questionReferences}\n\nRaw Solution Feed Block:\n${text}\n\nCRITICAL JSON CONFORMITY ESCAPING RULE: Because step-by-step solutions contain heavy LaTeX mathematical notation, every single backslash character '\\' inside the solution text string MUST be double-escaped as '\\\\' in your raw JSON output payload (e.g., write '\\\\frac{x}{y}' or '\\\\sigma' instead of '\\frac{x}{y}' or '\\sigma'). If you do not double-escape backslashes, the JSON parser breaks.\n\nReturn ONLY a JSON structured array tracking target parameters: [ { "id": 0, "answer": "...", "solution": "..." }, ... ]

IMPORTANT – MULTI‑ANSWER QUESTIONS:
- If a question has **more than one correct option**, output the answer as a **sorted array of letter strings**, like: "answer": ["A","C"].
- If only one answer is correct, output a simple string: "answer": "B".
- Do NOT output "A, C" or "A and C" as a string – always use the array format for multiple answers.`;
    try {
        const res = await callGeminiWithFallback(apiKey, prompt, null, null, null, true);
        const arr = cleanAndParseJson(res.text);
        arr.forEach(item => {
            let idx = parseInt(item.id);
            if (!isNaN(idx) && idx >= 0 && idx < AppState.extractedItems.length) {
                let rawAnswer = item.answer;
                let ans;
                if (Array.isArray(rawAnswer)) {
                    ans = [...new Set(rawAnswer.map(a => a.toUpperCase().trim()))].sort();
                } else {
                    ans = (rawAnswer || "").toString().trim();
                }

                AppState.extractedItems[idx].correctAnswer = ans;
                AppState.extractedItems[idx].solution = item.solution || "";

                if (Array.isArray(ans)) {
                    AppState.extractedItems[idx].type = 'mcq';
                } else if (/^[A-D]$/i.test(ans) && AppState.extractedItems[idx].options.length > 0) {
                    AppState.extractedItems[idx].type = 'mcq';
                } else if (/^-?\d+(\.\d+)?$/.test(ans)) {
                    AppState.extractedItems[idx].type = 'numeric';
                } else {
                    AppState.extractedItems[idx].type = 'text';
                }
            }
        });
        hideLoading();
        alert('Text mapping complete. All answers linked.');
        showPreviewModal();
    } catch (e) {
        hideLoading();
        alert("Mapping crashed: " + e.message);
    }
}

export function saveAllQuestions() {
    for (let i = 0; i < AppState.extractedItems.length; i++) {
        let q = AppState.extractedItems[i];
        const manualInput = document.getElementById(`manual-answer-${i}`);
        let rawAnswer = (manualInput && manualInput.value.trim()) ? manualInput.value.trim() : q.correctAnswer;

        let finalAnswer;
        if (typeof rawAnswer === 'string' && rawAnswer.includes(',')) {
            finalAnswer = rawAnswer.split(',').map(s => s.trim().toUpperCase()).filter(s => s);
        } else if (Array.isArray(rawAnswer)) {
            finalAnswer = rawAnswer;
        } else {
            finalAnswer = rawAnswer;
        }

        if (!q.type || q.type === 'text') {
            if (Array.isArray(finalAnswer)) {
                q.type = 'mcq';
            } else if (/^[A-D]$/i.test(finalAnswer) && q.options.length > 0) {
                q.type = 'mcq';
            } else if (/^-?\d+(\.\d+)?$/.test(finalAnswer)) {
                q.type = 'numeric';
            } else {
                q.type = 'text';
            }
        }

        let newQ = {
            id: crypto.randomUUID ? crypto.randomUUID() : (Date.now() + i).toString(),
            subject: AppState.currentSubject,
            chapter: AppState.currentChapter,
            imageDataUrl: q.imageDataUrl,
            diagramImageUrl: q.diagramImageUrl || null,
            extractedText: q.extractedText || "",
            options: q.options || [],
            correctAnswer: finalAnswer,
            type: q.type,
            status: 'unsolved',
            errorReason: null,
            timeTaken: 0,
            solution: q.solution || "",
            // ── Cognitive MMR: carry over the seeded qElo from the crop
            // pipeline, or recompute the chapter-average default if it was
            // never set. isAnomaly starts false; the engine flags it if the
            // qElo ever shoots >600 pts past the chapter baseline. ──
            qElo: (typeof q.qElo === 'number' && isFinite(q.qElo)) ? q.qElo : _computeDefaultQEloForCurrentChapter(),
            isAnomaly: false,
        };
        AppState.questionBank.push(newQ);
    }
    saveAllAsync().catch(console.error);
    // ── Bug 2 fix: tear down the preview modal + upload modal synchronously
    // and wipe the text-track terminal so the next batch starts clean. ──
    // closeModalStr() defers display='none' by 300ms for the fade-out
    // transition, which leaves the upload-modal lingering in a
    // display:flex-but-fading state — the moment preview-modal also closes,
    // the upload-modal becomes the topmost visible overlay and looks like it
    // "reopened". forceHideModal() drops display to 'none' inline in a single
    // tick so both layers are gone before the alert() yields to the user.
    forceHideModal('preview-modal');
    forceHideModal('upload-modal');
    // Zero out the raw JSON dump inside #text-add-terminal so the next
    // ingestion session starts with a clean slate. Optional chaining +
    // conditional guard prevents crashes if the terminal isn't mounted.
    const terminal = document.getElementById('text-add-terminal');
    if (terminal) terminal.value = '';
    alert(`Successfully imported ${AppState.extractedItems.length} fresh problems into the local engine. Let's see how you handle them.`);
}

// ============================================================================
// DUAL-ENGINE INGESTION: Gemini Gem Text Track (Textadd)
// ============================================================================
// A parallel entry engine that accepts pre-schematized, formatted JSON data
// directly from a custom external Gemini Gem. It maps the payload instantly
// into AppState.extractedItems and mounts an interactive validation view
// (showPreviewModal) where the user can surgically attach diagrams ONLY to
// specific questions that require them — eliminating cropping friction for
// standard text questions.
//
// Supported Gem payload formats (auto-classified when `type` is omitted):
//   • Single-Choice MCQ      → options has 4 items, correctAnswer is a single letter "C"
//   • Multiple-Correct MCQ   → options has 4 items, correctAnswer is ["A","D"]
//   • Integer / Numerical    → options empty, correctAnswer is "42" or "-0.5"
//   • Self-Evaluation (text) → options empty, correctAnswer is free text or ""
// ============================================================================

/**
 * Toggles the upload-modal between the Traditional Multicrop panel and the
 * Gemini Gem Text Track terminal. Pure DOM visibility swap — no state mutation.
 * @param {'multicrop'|'texttrack'} track
 */
export function switchIngestionTrack(track) {
    const multicropPanel = document.getElementById('ingestion-panel-multicrop');
    const texttrackPanel = document.getElementById('ingestion-panel-texttrack');
    const multicropBtn = document.getElementById('toggle-multicrop');
    const texttrackBtn = document.getElementById('toggle-texttrack');
    if (!multicropPanel || !texttrackPanel || !multicropBtn || !texttrackBtn) return;

    if (track === 'multicrop') {
        multicropPanel.classList.add('active');
        texttrackPanel.classList.remove('active');
        multicropBtn.classList.add('active');
        texttrackBtn.classList.remove('active');
    } else if (track === 'texttrack') {
        texttrackPanel.classList.add('active');
        multicropPanel.classList.remove('active');
        texttrackBtn.classList.add('active');
        multicropBtn.classList.remove('active');
    }
}

/**
 * Ingests and processes a schematized text array from the custom Gemini Gem.
 * Completely bypasses manual bounding-box cropping constraints for pure text velocity.
 */
/**
 * Advanced line-by-line JSON sanitizer for LaTeX and string arrays.
 * 1. Heals rogue unescaped inner double quotes ("labelled as "volume"")
 * 2. Normalizes single backslashes (\text, \times) into valid double backslashes
 */
/**
 * Context-Aware JSON Sanitizer for LaTeX Code Ingestion.
 * 1. Isolates specific properties to repair unescaped inner double quotes.
 * 2. Standardizes any arbitrary run of backslashes (\, \\, \\\) down to exactly 
 * two backslashes (\\) inside string values so JSON.parse() reads them cleanly.
 */
function sanitizeGemTextDump(rawInput) {
    if (!rawInput) return "";

    // Step 1: Repair unescaped inner quotes inside "extractedText" properties globally
    rawInput = rawInput.replace(/"extractedText"\s*:\s*"([\s\S]*?)"\s*(?=,\s*"options"|,\s*"correctAnswer"|,\s*"type"|,\s*"solution"|,\s*\}|\s*\})/g, (match, content) => {
        let cleaned = content.replace(/\\"/g, '\uEAEA').replace(/"/g, '\\"').replace(/\uEAEA/g, '\\"');
        return `"extractedText": "${cleaned}"`;
    });

    // Step 2: Repair unescaped inner quotes inside "solution" properties globally
    rawInput = rawInput.replace(/"solution"\s*:\s*"([\s\S]*?)"\s*(?=,\s*"extractedText"|,\s*"options"|,\s*"correctAnswer"|,\s*"type"|,\s*\}|\s*\})/g, (match, content) => {
        let cleaned = content.replace(/\\"/g, '\uEAEA').replace(/"/g, '\\"').replace(/\uEAEA/g, '\\"');
        return `"solution": "${cleaned}"`;
    });

    // Step 3: Repair unescaped inner quotes inside individual option item entries safely (handles same-line options)
    rawInput = rawInput.replace(/"([A-D]\)[\s\S]*?)"\s*(?=,\s*"[A-D]\)"|,\s*\]|\s*\])/g, (match, content) => {
        let cleaned = content.replace(/\\"/g, '\uEAEA').replace(/"/g, '\\"').replace(/\uEAEA/g, '\\"');
        return `"${cleaned}"`;
    });

    // Step 4: With all text boundaries stabilized, capture every string token and normalize backslash runs down to exactly \\
    let cleanJson = rawInput.replace(/"([\s\S]*?)"/g, (match, stringContent) => {
        if (stringContent === "extractedText" || stringContent === "options" || stringContent === "correctAnswer" || stringContent === "type" || stringContent === "solution" || stringContent === "mcq" || stringContent === "numeric" || stringContent === "text") {
            return match;
        }
        let fixedContent = stringContent.replace(/\\+/g, '\\\\').replace(/\\\\"/g, '\\"');
        return `"${fixedContent}"`;
    });

    return cleanJson;
}

/**
 * Ingests and processes a schematized text array from the custom Gemini Gem.
 * Upgraded with a structural key-based sanitizer to completely clear LaTeX formatting traps.
 */
/**
 * Direct Anchor-Based Structural Text Ingestion Compiler.
 * Completely bypasses JSON.parse() to insulate the workspace from unescaped quotes,
 * double/triple backslash collisions, and same-line array layouts.
 */
/**
 * Direct Anchor-Based Structural Text Ingestion Compiler.
 * Fixed to safely collapse multi-backslash formatting traps down to single backslashes
 * so KaTeX/MathJax processes math symbols (\times, \text) on a single line.
 */
export async function processGemTextDump() {
    const terminalInput = document.getElementById('text-add-terminal')?.value.trim();
    if (!terminalInput) return alert("Terminal area is completely empty. Paste your Gem JSON payload.");

    showLoading("Running structural text compiler... Sanitizing LaTeX math symbols...");

    try {
        // Step 1: Isolate individual question segments using the unique "extractedText" key as a boundary anchor
        const segments = terminalInput.split(/"extractedText"\s*:\s*"/g);
        if (segments.length <= 1) {
            throw new Error("Could not find any structural 'extractedText' keys in the pasted payload.");
        }

        const parsedItems = [];

        // Loop through each isolated question block (skipping index 0)
        for (let i = 1; i < segments.length; i++) {
            const segment = segments[i];

            // 1. Extract the raw question text by finding where the next key metadata block begins
            const textEndIndex = segment.search(/"\s*(?=,\s*"options"|,\s*"correctAnswer"|,\s*"type"|,\s*"solution")/g);
            if (textEndIndex === -1) continue;
            let extractedText = segment.substring(0, textEndIndex);

            // The remainder of the string segment holds metadata exclusive to this specific item
            const metadata = segment.substring(textEndIndex);

            // 2. Extract options array contents
            let options = [];
            const optionsMatch = metadata.match(/"options"\s*:\s*\[([\s\S]*?)\]/);
            if (optionsMatch && optionsMatch[1]) {
                // Collect individual string tokens within option boundaries
                const optMatches = optionsMatch[1].match(/"([\s\S]*?)"/g);
                if (optMatches) {
                    options = optMatches.map(o => {
                        // Strip outer quotes
                        let rawOpt = o.substring(1, o.length - 1);
                        // FIX: Convert literal \n or \\n traps into real newlines, then collapse backslashes
                        return rawOpt.replace(/\\+n/g, '\n').replace(/\\+/g, '\\');
                    });
                }
            }

            // 3. Extract correctAnswer string or multi-select array
            let correctAnswer = "";
            const ansMatch = metadata.match(/"correctAnswer"\s*:\s*(\[[\s\S]*?\]|"(?:[^"\\]|\\.)*")/);
            if (ansMatch && ansMatch[1]) {
                let ansRaw = ansMatch[1].trim();
                if (ansRaw.startsWith('[')) {
                    const letterMatches = ansRaw.match(/"([^"]+)"/g);
                    if (letterMatches) {
                        correctAnswer = letterMatches.map(l => l.replace(/"/g, '').trim());
                    }
                } else {
                    correctAnswer = ansRaw.substring(1, ansRaw.length - 1).trim();
                }
            }

            // 4. Extract question type tracking field
            let type = "";
            const typeMatch = metadata.match(/"type"\s*:\s*"([^"]*)"/);
            if (typeMatch && typeMatch[1]) {
                type = typeMatch[1].trim();
            }

            // 5. Extract step-by-step solution string
            let solution = "";
            const solMatch = metadata.match(/"solution"\s*:\s*"([\s\S]*?)"\s*(?=\}|\s*\})/);
            if (solMatch && solMatch[1]) {
                solution = solMatch[1];
            }

            // FIX: Normalize continuous runs of backslashes down to exactly ONE backslash for proper inline parsing
            // FIX: Convert literal macro/newline traps (\n or \\n) into actual newline characters first.
            // This prevents KaTeX from choking on an "Undefined control sequence: \n" error,
            // allowing math symbols like \mathrm to render successfully.
            extractedText = extractedText.replace(/\\+n/g, '\n').replace(/\\+/g, '\\');
            if (typeof solution === 'string') {
                solution = solution.replace(/\\+n/g, '\n').replace(/\\+/g, '\\');
            }

            // Auto-fallback type classification logic if not explicitly returned by the Gem
            if (!type) {
                if (options.length > 0) {
                    type = "mcq";
                } else if (correctAnswer && /^-?\d+(\.\d+)?$/.test(correctAnswer.toString().trim())) {
                    type = "numeric";
                } else {
                    type = "text";
                }
            }

            parsedItems.push({
                imageDataUrl: null, 
                questionOnlyDataUrl: null,
                diagramImageUrl: null, 
                extractedText: extractedText,
                options: options,
                correctAnswer: correctAnswer,
                type: type,
                timeTaken: 0,
                solution: solution,
                qElo: _computeDefaultQEloForCurrentChapter(), 
                isAnomaly: false
            });
        }

        if (parsedItems.length === 0) {
            throw new Error("Failed to compile any valid items. Verify structural array fields.");
        }

        AppState.extractedItems = parsedItems;
        hideLoading();
        alert(`Ingestion locked: ${AppState.extractedItems.length} items compiled successfully. Mounting preview grid.`);

        // ── Bug 2 fix: dismiss the parent upload-modal SYNCHRONOUSLY so it
        // can't resurface after Save All. ──
        // closeModalStr() defers display='none' by 300ms for the fade-out
        // transition. If we use it here, the upload-modal lingers in a
        // display:flex-but-fading state underneath preview-modal; the moment
        // preview-modal later closes (on Save All), the upload-modal becomes
        // the topmost overlay and looks like it "reopened". forceHideModal()
        // drops display to 'none' inline in a single tick so the upload layer
        // is fully gone before the preview grid mounts.
        forceHideModal('upload-modal');

        // Pass control flow directly to your interactive validation view
        showPreviewModal();

    } catch (err) {
        console.error("Text track execution crash:", err);
        hideLoading();
        alert(`Ingestion failed: ${err.message}. Ensure your copied text contains complete question definitions.`);
    }
}
export function showPreviewModal() {
    let container = document.getElementById('extracted-questions-list');
    if (!container) return;
    container.innerHTML = '';
    
    AppState.extractedItems.forEach((q, idx) => {
        let div = document.createElement('div');
        div.className = 'question-preview-item';

        // ── Visual asset container: legacy crop image vs surgical diagram slot ──
        let visualAssetContainerHtml = '';

        if (q.imageDataUrl) {
            visualAssetContainerHtml = `<img src="${q.imageDataUrl}" style="max-width:200px; border-radius:12px;">`;
        } else {
            if (q.diagramImageUrl) {
                visualAssetContainerHtml = `
                    <div class="surgical-asset-box" style="border: 1px solid var(--glow-orange); padding:8px; border-radius:8px; background:rgba(249,115,22,0.05); flex-shrink:0;">
                        <small style="color: #f97316; font-weight:700;">📐 Diagram Mapped</small><br>
                        <img src="${q.diagramImageUrl}" style="max-width:140px; border-radius:6px; margin:6px 0;">
                        <button class="btn btn-danger btn-xs" style="display:block; width:100%; padding:2px;" onclick="event.stopPropagation(); window.yeetSurgicalDiagram(${idx})">✕ Wipe Asset</button>
                    </div>`;
            } else {
                visualAssetContainerHtml = `
                    <div class="surgical-asset-trigger" style="text-align:center; padding:10px; border:1px dashed #4a4a6a; border-radius:8px; flex-shrink:0; min-width:140px;">
                        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); window.triggerSurgicalDiagramUpload(${idx})">➕ Add Diagram</button>
                        <p style="font-size:10px; color:#64748b; margin-top:4px; line-height:1.1;">Optional: Bind crop asset if needed.</p>
                    </div>`;
            }
        }

        // ── Text column: Maintained full text for pure text track dumps to avoid broken LaTeX syntax ──
        let typeBadge = q.type ? `<span class="q-type-badge q-type-${q.type}">${q.type.toUpperCase()}</span>` : '';
        let fullTextContent = q.extractedText || '';
        let processedTextHtml = '';
        
        if (fullTextContent) {
            let textToDisplay = q.imageDataUrl ? (fullTextContent.substring(0, 120) + (fullTextContent.length > 120 ? '…' : '')) : fullTextContent;
            processedTextHtml = `<p style="font-size:14px; color:#cbd5e1; line-height:1.4; margin-bottom:6px;">${escapeHtml(textToDisplay)}</p>`;
        } else {
            processedTextHtml = `<p style="font-size:12px; color:#64748b; font-style:italic;">No text extracted yet — run "Extract Text" for multicrop items.</p>`;
        }

        // Clean option layout rows
        let optionsPreview = '';
        if (q.options && q.options.length) {
            optionsPreview = `<div style="margin: 6px 0; padding-left: 8px; border-left: 2px solid #3b82f6;">
                ${q.options.map(o => `<p style="font-size:13px; color:#93c5fd; margin: 2px 0;">${escapeHtml(o)}</p>`).join('')}
            </div>`;
        }
        
        let solutionPreview = q.solution ? `<p style="font-size:12px; color:#6ee7b7; margin-top:4px; font-weight:500;">📝 Solution Context Loaded</p>` : '';
        let answerDisplay = Array.isArray(q.correctAnswer) ? q.correctAnswer.join(', ') : (q.correctAnswer || '');
        
        div.innerHTML = `
            <div style="margin-bottom: 6px; display:flex; justify-content:space-between; align-items:center;">
                <strong>Question ${idx + 1}</strong> ${typeBadge}
            </div>
            <div style="display:flex; gap:16px; align-items:flex-start; justify-content:space-between;">
                <div style="flex:1; min-width:0;">
                    ${processedTextHtml}
                    ${optionsPreview}
                    ${solutionPreview}
                </div>
                ${visualAssetContainerHtml}
            </div>
            <div class="manual-answer-row" style="margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.04);">
                <span style="font-size:12px; color:#a1a1aa;">Verified Target Key:</span>
                <input id="manual-answer-${idx}" class="pomo-input" style="width:160px; margin-left:8px; padding:4px 8px;" placeholder="A/B/C/D or numeric list" value="${escapeHtml(answerDisplay)}">
            </div>`;
            
        container.appendChild(div);
    });
    
    openModal('preview-modal');
}

// Export module logic to global window context
window.processGemTextDump = processGemTextDump;
window.showPreviewModal = showPreviewModal;

// ==================== PRACTICE: QUESTION LIST ====================

/**
 * Returns the FIRST-attempt result of a question: 'correct' | 'incorrect' | null.
 *
 * Accuracy is based on this value — re-solving a question (from the error
 * matrix or question practice) must NOT change the accuracy, so only the first
 * attempt counts. The result is resolved in priority order:
 *   1. q.firstAttemptResult  — locked on the very first practice (never overwritten)
 *   2. earliest historyLog    — for questions first practiced via the error matrix
 *   3. q.status fallback      — legacy questions practiced before this tracking
 *   4. null                   — unattempted (excluded from accuracy)
 */
function _firstAttemptResult(q) {
    if (q.firstAttemptResult === 'correct' || q.firstAttemptResult === 'incorrect') {
        return q.firstAttemptResult;
    }
    if (Array.isArray(q.historyLogs) && q.historyLogs.length > 0) {
        let earliest = q.historyLogs[0];
        for (const log of q.historyLogs) {
            if (log && log.timestamp && new Date(log.timestamp) < new Date(earliest.timestamp)) {
                earliest = log;
            }
        }
        if (earliest.result === 'correct' || earliest.result === 'incorrect') return earliest.result;
    }
    // Legacy fallback: questions practiced before firstAttemptResult tracking.
    if (q.status === 'solved') return 'correct';
    if (q.status === 'wrong' || q.status === 'error') return 'incorrect';
    return null;
}

export function showQuestionList() {
    // Establish a clean baseline filter configuration if the current filter
    // is falsy/unassigned. Without this, a stale or undefined currentFilter
    // (e.g. on very first entry, or after a state hydration edge case) would
    // fall through every branch below and render a confusing "no questions"
    // state even when questions exist.
    AppState.currentFilter = AppState.currentFilter || 'all';

    let chapterQuestions = AppState.questionBank.filter(q => q.subject === AppState.currentSubject && q.chapter === AppState.currentChapter);
    if (!chapterQuestions.length) { alert("This chapter is empty. Feed it some questions."); return; }

    AppState.currentChapterQuestions = chapterQuestions;

    let filteredQuestions = chapterQuestions;
    if (AppState.currentFilter === 'unsolved') {
        filteredQuestions = chapterQuestions.filter(q => q.status === 'unsolved');
    } else if (AppState.currentFilter === 'solved') {
        filteredQuestions = chapterQuestions.filter(q => q.status === 'solved');
    } else if (AppState.currentFilter === 'wrong') {
        filteredQuestions = chapterQuestions.filter(q => q.status === 'wrong' || q.status === 'error');
    }

    const titleEl = document.getElementById('question-list-title');
    if (titleEl) {
        if (AppState.currentFilter === 'all') titleEl.textContent = 'All Questions';
        else if (AppState.currentFilter === 'unsolved') titleEl.textContent = 'Filtered: Untouched';
        else if (AppState.currentFilter === 'solved') titleEl.textContent = 'Filtered: Clutched';
        else if (AppState.currentFilter === 'wrong') titleEl.textContent = 'Filtered: Fumbled';
    }

    const filterEl = document.getElementById('question-filter');
    if (filterEl) filterEl.value = AppState.currentFilter;

    const total = filteredQuestions.length;
    const solvedCount = filteredQuestions.filter(q => q.status === 'solved').length;
    // ── Accuracy is based on the FIRST attempt of each question ONLY.
    // Re-solving a question (from the error matrix or question practice) does
    // NOT change the accuracy — only the first attempt counts. The first-attempt
    // result is locked in `q.firstAttemptResult` on the very first practice; if
    // that field is missing we derive it from the earliest historyLog.
   // ── Accuracy is based on the FIRST attempt of each question ONLY.
    // FIX: Use chapterQuestions so filtering cards doesn't break global chapter metrics
    const firstAttempted = chapterQuestions.filter(q => {
        const r = _firstAttemptResult(q);
        return r === 'correct' || r === 'incorrect';
    });
    const firstCorrect = firstAttempted.filter(q => _firstAttemptResult(q) === 'correct').length;
    const accuracy = firstAttempted.length > 0 ? Math.round((firstCorrect / firstAttempted.length) * 100) : 0;
    
    // Average time is averaged only over questions that actually logged a time.
    // FIX: Use chapterQuestions here as well to preserve the macro chapter velocity average
    const timedQuestions = chapterQuestions.filter(q => q.timeTaken > 0);
    const avgTime = timedQuestions.length > 0 ? Math.round(timedQuestions.reduce((sum, q) => sum + (q.timeTaken || 0), 0) / timedQuestions.length) : 0;

    const statsRow = document.getElementById('stats-row');
    if (statsRow) {
        statsRow.style.display = 'flex';
        const completion = total > 0 ? Math.round((solvedCount / chapterQuestions.length) * 100) : 0;
        statsRow.innerHTML = `
            <div class="stat-box"><div class="stat-value">${accuracy}%</div><div class="stat-label">Hit Rate</div></div>
            <div class="chapter-progress-bar">
                <div class="chapter-progress-fill" style="width: ${completion}%;"></div>
            </div>
            <div class="stat-box"><div class="stat-value">${avgTime}s</div><div class="stat-label">Avg Speed</div></div>
        `;
    }

    let container = document.getElementById('questions-grid-container');
    if (!container) return;
    container.innerHTML = '';

    filteredQuestions.forEach((q, idx) => {
        let statusClass = q.status === 'solved' ? 'status-solved' : (q.status === 'error' ? 'status-unsolved' : (q.status === 'wrong' ? 'status-wrong' : 'status-unsolved'));
        let statusText = q.status === 'solved' ? 'Clutched' : (q.status === 'error' ? 'Fumbled' : (q.status === 'wrong' ? 'Wrong' : 'Untouched'));
        let timeDisplay = q.timeTaken ? `<div style="font-size:12px; color:#8a8ad3; margin-top:4px;">⏱ ${Math.floor(q.timeTaken / 60)}:${(q.timeTaken % 60).toString().padStart(2, '0')}</div>` : '';

        let imgHtml = '';
if (q.imageDataUrl && q.imageDataUrl.length > 100) {
    imgHtml = `<img src="${q.imageDataUrl}" style="max-width:100%; border-radius:8px;">`;
} else if (q.driveImageId) {
    imgHtml = `<img data-drive-id="${q.driveImageId}" data-qid="${q.id}" class="lazy-practice-img" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='90'><rect width='100%' height='100%' fill='%2312121a'/><text x='50%' y='50%' fill='%23444a6a' font-family='sans-serif' font-size='11' text-anchor='middle' alignment-baseline='middle'>Waiting for scroll...</text></svg>" style="max-width:100%; border-radius:8px; transition: opacity 0.3s;">`;
} else {
    // Elegant left-aligned text layout with a line clamp to keep card heights uniform on the grid sheet
    imgHtml = `
        <div style="
            padding: 12px; 
            font-size: 13px; 
            color: #cbd5e1; 
            text-align: left; 
            line-height: 1.5; 
            max-height: 110px; 
            overflow: hidden; 
            display: -webkit-box; 
            -webkit-line-clamp: 4; 
            -webkit-box-orient: vertical;
            white-space: normal;
        ">
            ${escapeHtml(q.extractedText || 'No text or visual asset saved.')}
        </div>`;
}

        let card = document.createElement('div');
        card.className = 'question-card';
        card.innerHTML = `
            <div class="card-close-btn" onclick="event.stopPropagation(); deleteQuestion('${q.id}')" title="Yeet Question" style="position: absolute; top: 12px; right: 36px; cursor: pointer; font-size: 22px; color: #4a4a6a; z-index: 5; line-height: 0.8;">×</div>
            <div class="three-dot" onclick="event.stopPropagation(); openEditQuestionModal('${q.id}')">⋮</div>
            <div style="display:flex; justify-content:space-between;"><strong>Q ${idx + 1}</strong><span class="status-badge ${statusClass}">${statusText}</span></div>
            <div class="question-preview-text">${imgHtml}</div>
            ${timeDisplay}
            <button class="btn btn-primary practice-single-btn" data-index="${idx}" style="width:100%; margin-top:12px;">Grind →</button>
        `;
        container.appendChild(card);
    });

    container.querySelectorAll('.practice-single-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const index = parseInt(this.getAttribute('data-index'));
            startPracticeWithQuestion(filteredQuestions, index);
        });
    });

    showPracticeSubview('practice-question-list-view');
    initPracticeLazyLoaders();
}

export function initPracticeLazyLoaders() {
    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(async entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const driveId = img.getAttribute('data-drive-id');
                const qId = img.getAttribute('data-qid');

                if (driveId && typeof AppState.driveAccessToken !== 'undefined') {
                    try {
                        const base64 = await fetchMediaFromDrive(driveId, AppState.driveAccessToken);
                        if (base64) {
                            img.style.opacity = 0;
                            img.src = base64;
                            setTimeout(() => img.style.opacity = 1, 50);
                            let q = AppState.questionBank.find(x => x.id === qId);
                            if (q) q.imageDataUrl = base64;
                        }
                    } catch (e) {
                        console.error("Practice grid scroll load failed", e);
                    }
                }
                obs.unobserve(img);
            }
        });
    }, { rootMargin: '200px' });

    document.querySelectorAll('.lazy-practice-img').forEach(img => observer.observe(img));
}

export function applyFilter() {
    const filterEl = document.getElementById('question-filter');
    if (filterEl) {
        AppState.currentFilter = filterEl.value;
    }
    showQuestionList();
}

// ==================== PRACTICE: QUESTION MODAL ====================
export function openEditQuestionModal(id) {
    const q = AppState.questionBank.find(q => q.id === id);
    if (!q) return;
    document.getElementById('edit-question-id').value = q.id;
    document.getElementById('edit-text').value = q.extractedText || '';
    document.getElementById('edit-options').value = (q.options || []).join(', ');
    document.getElementById('edit-answer').value = q.correctAnswer || '';
    openModal('edit-question-modal');
}

export function saveEditQuestion() {
    const id = document.getElementById('edit-question-id').value;
    const q = AppState.questionBank.find(q => q.id === id);
    if (!q) return;
    q.extractedText = document.getElementById('edit-text').value;
    q.options = document.getElementById('edit-options').value.split(',').map(s => s.trim()).filter(s => s);
    let ans = document.getElementById('edit-answer').value.trim();
    if (ans.includes(',')) {
        q.correctAnswer = ans.split(',').map(s => s.trim().toUpperCase()).filter(s => s);
        q.type = 'mcq';
    } else {
        q.correctAnswer = ans;
        if (/^[A-D]$/i.test(ans) && q.options.length > 0) q.type = 'mcq';
    }
    saveAllAsync().catch(console.error);
    closeModalStr('edit-question-modal');
    showQuestionList();
}

export function startPracticeWithQuestion(questions, index) {
    AppState.practiceQuestions = questions;
    AppState.currentPracticeIndex = index;
    AppState.practiceSubmittedFlags = new Array(questions.length).fill(false);
    if (AppState.practiceTimer) clearInterval(AppState.practiceTimer);
    AppState.practiceSeconds = 0;
    updatePracticeTimerDisplay();
    AppState.practiceTimer = setInterval(() => {
        AppState.practiceSeconds++;
        updatePracticeTimerDisplay();
    }, 1000);
    renderPracticeQuestionModal();
    openModal('practice-modal');
    AppState.photoHidden = false;
    document.getElementById('hide-photo-toggle').textContent = '📷 Hide Image';
}

// ==================== BOUNTY HUNT ====================
export function getHistoricalBountyTimeLimit(q) {
    return 180;
}

export function openBountyModal(questionId) {
    const q = AppState.questionBank.find(item => item.id.toString() === questionId.toString());
    if (!q) return;
    const today = new Date().toISOString().split('T')[0];
    AppState.bounty.date = today;
    AppState.bounty.active = true;
    AppState.bounty.questionId = q.id;
    AppState.bounty.timeLimit = getHistoricalBountyTimeLimit(q);
    window._pendingBountyId = q.id;
    const limitEl = document.getElementById('bounty-time-limit');
    if (limitEl) limitEl.textContent = formatTime(AppState.bounty.timeLimit);
    openModal('bounty-modal');
}

export function tryAssignDailyBounty(questionId) {
    const today = new Date().toISOString().split('T')[0];
    if (AppState.bounty.date === today && AppState.bounty.questionId && AppState.bounty.questionId.toString() === questionId.toString()) return;

    const candidates = AppState.questionBank.filter(q =>
        (q.status === 'error' || q.status === 'wrong') &&
        q.timeTaken > 0 &&
        (!q.bountyLockUntil || new Date(q.bountyLockUntil).getTime() <= Date.now())
    );
    const q = questionId
        ? candidates.find(item => item.id.toString() === questionId.toString())
        : candidates[0];
    if (!q) return;

    AppState.bounty.date = today;
    AppState.bounty.active = true;
    AppState.bounty.questionId = q.id;
    AppState.bounty.timeLimit = getHistoricalBountyTimeLimit(q);

    window._bountyQuestion = q;
    window._bountyTimeLimit = AppState.bounty.timeLimit;
    AppState.bountyMode = true;

    AppState.practiceQuestions = [q];
    AppState.currentPracticeIndex = 0;
    AppState.practiceSubmittedFlags = [false];
    if (AppState.practiceTimer) clearInterval(AppState.practiceTimer);
    AppState.practiceSeconds = 0;
    updatePracticeTimerDisplay();
    AppState.practiceTimer = setInterval(() => {
        AppState.practiceSeconds++;
        updatePracticeTimerDisplay();
        if (AppState.bountyMode && AppState.practiceSeconds >= AppState.bounty.timeLimit && !AppState.practiceSubmittedFlags[0]) {
            AppState.currentQ = q;
            AppState.currentQ.timeTaken = AppState.practiceSeconds;
            // Lock first-attempt result (bounty timeout = wrong first attempt).
            if (!AppState.currentQ.firstAttemptResult) AppState.currentQ.firstAttemptResult = 'incorrect';
            AppState.currentQ.status = 'wrong';
            saveAllAsync().catch(console.error);
            AppState.practiceSubmittedFlags[0] = true;
            // ⏱ Converge the timed-out bounty attempt's practice time into the
            // daily/subjective study counters (runs exactly once — flag is true).
            _injectPracticeTimeIntoStudySecs();
            clearInterval(AppState.practiceTimer);
            evaluateBountyOutcome(false);
        }
    }, 1000);

    renderPracticeQuestionModal();
    openModal('practice-modal');
    AppState.photoHidden = false;
    document.getElementById('hide-photo-toggle').textContent = '📷 Hide Image';
    closeModalStr('bounty-modal');
}

export function assignDailyBountyIfNeeded() {
    const today = new Date().toISOString().split('T')[0];

    if (AppState.bounty.date !== today) {
        AppState.bounty.date = today;
        AppState.bounty.active = false;
        AppState.bounty.questionId = null;
        AppState.bounty.timeLimit = 0;
        AppState.bounty.done = false;
    }

    if (AppState.bounty.done) return;
    if (AppState.bounty.active && AppState.bounty.questionId) return;

    const candidates = AppState.questionBank.filter(q =>
        (q.status === 'error' || q.status === 'wrong') &&
        (!q.bountyLockUntil || new Date(q.bountyLockUntil).getTime() <= Date.now())
    );
    if (candidates.length === 0) return;

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    AppState.bounty.date = today;
    AppState.bounty.active = true;
    AppState.bounty.questionId = chosen.id;
    AppState.bounty.timeLimit = getHistoricalBountyTimeLimit(chosen);
    window._pendingBountyId = chosen.id;
    window._bountyQuestion = chosen;
    saveAllAsync().catch(console.error);
}

export function evaluateBountyOutcome(wasCorrect) {
    const q = window._bountyQuestion;
    if (!q) return;
    window._bountyQuestion = null;
    AppState.bountyMode = false;
    if (AppState.practiceTimer) clearInterval(AppState.practiceTimer);

    if (wasCorrect) {
        window._justWonBounty = true;
        // Lock first-attempt result — only the first attempt counts for accuracy.
        if (!q.firstAttemptResult) q.firstAttemptResult = 'correct';
        q.status = 'solved';
        changeCount(q.subject, 1);
        AppState.bounty.payoffCount = 3;
        AppState.practiceCorrectStreak = Math.max(AppState.practiceCorrectStreak, 5);
        updateStreakVisualizer();
        alert('🔥 CLUTCHED! Bounty absolutely demolished. Multiplier active. You are literally glowing purple.');
    } else {
        q.bountyLockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        q.criticalDeficit = true;

        baseTargets[q.subject] = (baseTargets[q.subject] || 10) + 5;
        let inputId = q.subject === 'physics' ? 'set-tgt-phys' : (q.subject === 'chemistry' ? 'set-tgt-chem' : 'set-tgt-math');
        document.getElementById(inputId).value = baseTargets[q.subject];

        AppState.activeTargets[q.subject] = Math.round(baseTargets[q.subject] * AppState.moodMultiplier);
        saveTargets();
        updateUI();

        alert('❌ COOKED. Bounty timed out. Problem locked out and targets artificially amplified as a tax on failure.');
    }

    AppState.bounty.done = true;
    AppState.bounty.active = false;
    saveAllAsync().catch(console.error);
    renderErrorMatrixFromBank();
    closePracticeModal();
}

export function startBountySessionFromModal() {
    const qId = window._pendingBountyId || AppState.bounty.questionId;
    if (!qId) return;

    const q = AppState.questionBank.find(item => item.id.toString() === qId.toString());
    if (!q) return;

    const today = new Date().toISOString().split('T')[0];
    AppState.bounty.date = today;
    AppState.bounty.active = true;
    AppState.bounty.questionId = q.id;
    AppState.bounty.timeLimit = getHistoricalBountyTimeLimit(q);
    window._bountyQuestion = q;
    window._bountyTimeLimit = AppState.bounty.timeLimit;
    AppState.bountyMode = true;

    AppState.practiceQuestions = [q];
    AppState.currentPracticeIndex = 0;
    AppState.practiceSubmittedFlags = [false];
    if (AppState.practiceTimer) clearInterval(AppState.practiceTimer);
    AppState.practiceSeconds = 0;
    updatePracticeTimerDisplay();
    AppState.practiceTimer = setInterval(() => {
        AppState.practiceSeconds++;
        updatePracticeTimerDisplay();
        if (AppState.bountyMode && AppState.practiceSeconds >= AppState.bounty.timeLimit && !AppState.practiceSubmittedFlags[0]) {
            AppState.currentQ = q;
            AppState.currentQ.timeTaken = AppState.practiceSeconds;
            // Lock first-attempt result (bounty timeout = wrong first attempt).
            if (!AppState.currentQ.firstAttemptResult) AppState.currentQ.firstAttemptResult = 'incorrect';
            AppState.currentQ.status = 'wrong';
            saveAllAsync().catch(console.error);
            AppState.practiceSubmittedFlags[0] = true;
            // ⏱ Converge the timed-out bounty attempt's practice time into the
            // daily/subjective study counters (runs exactly once — flag is true).
            _injectPracticeTimeIntoStudySecs();
            clearInterval(AppState.practiceTimer);
            evaluateBountyOutcome(false);
        }
    }, 1000);

    renderPracticeQuestionModal();
    openModal('practice-modal');
    AppState.photoHidden = false;
    document.getElementById('hide-photo-toggle').textContent = '📷 Hide Image';
    closeModalStr('bounty-modal');
}

export function updatePracticeTimerDisplay() {
    let m = Math.floor(AppState.practiceSeconds / 60),
        s = AppState.practiceSeconds % 60;
    const el = document.getElementById('question-timer');
    if (el) el.innerText = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function toggleOriginalPhoto() {
    AppState.photoHidden = !AppState.photoHidden;
    document.getElementById('hide-photo-toggle').textContent = AppState.photoHidden ?
        '📷 Reveal Image' : '📷 Hide Image';
    renderPracticeQuestionModal();
}

export function renderPracticeQuestionModal() {
    AppState.currentQ = AppState.practiceQuestions[AppState.currentPracticeIndex];
    AppState.selectedMcq = null;
    const submitted = AppState.practiceSubmittedFlags[AppState.currentPracticeIndex];
    const container = document.getElementById('practice-modal-content');
    if (!container) return;
    let questionImageHtml = '';
    if (!AppState.photoHidden) {
        if (AppState.currentQ.imageDataUrl) {
            questionImageHtml = `<img id="practice-modal-img" src="${AppState.currentQ.imageDataUrl}" onclick="openPracticeImageLightbox(this.src)" style="max-width:100%; max-height:250px; border-radius:16px; margin-bottom:16px; transition: opacity 0.3s; cursor: pointer;">`;
        } else if (AppState.currentQ.driveImageId && typeof AppState.driveAccessToken !== 'undefined' && AppState.driveAccessToken) {
            questionImageHtml = `<img id="practice-modal-img" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='90'><rect width='100%' height='100%' fill='%2312121a'/><text x='50%' y='50%' fill='%23444a6a' font-family='sans-serif' font-size='11' text-anchor='middle' alignment-baseline='middle'>Loading asset...</text></svg>" onclick="openPracticeImageLightbox(this.src)" style="max-width:100%; max-height:250px; border-radius:16px; margin-bottom:16px; cursor: pointer;">`;
            fetchMediaFromDrive(AppState.currentQ.driveImageId, AppState.driveAccessToken).then(b64 => {
                if (b64) {
                    AppState.currentQ.imageDataUrl = b64;
                    let modalImg = document.getElementById('practice-modal-img');
                    if (modalImg) modalImg.src = b64;
                }
            });
        }
    }
    let diagramHtml = AppState.currentQ.diagramImageUrl ?
        `<div><div class="diagram-hint">📐 Diagram:</div><img src="${AppState.currentQ.diagramImageUrl}" style="max-width:100%; max-height:200px; border-radius:12px;"></div>` :
        '';
    let html =
        `<div style="text-align:center;">${questionImageHtml}${diagramHtml}`;
    if (AppState.currentQ.extractedText) html +=
        `<div class="latex" id="latex-render">${escapeHtml(AppState.currentQ.extractedText)}</div>`;

    if (submitted) {
        const correctAns = AppState.currentQ.correctAnswer || 'N/A';
        html += `<div style="display:flex; justify-content:space-between; align-items:center;">`;
        if (AppState.currentQ.status === 'solved') html +=
            `<div class="result-banner correct" style="flex:1;">✅ Clutched! The answer was: ${correctAns}</div>`;
        else if (AppState.currentQ.status === 'wrong' || AppState.currentQ.status === 'error') html +=
            `<div class="result-banner wrong" style="flex:1;">❌ Fumbled. The answer was: ${correctAns}</div>`;
        else html +=
            `<div class="result-banner wrong" style="flex:1;">Answer revealed. It was: ${correctAns}</div>`;
        if (AppState.currentQ.solution && AppState.currentQ.solution.trim().length > 0) {
            html +=
                `<button class="btn show-solution-btn" style="margin-left:12px;" onclick="showSolutionPopup()">💡 Peep Solution</button>`;
        }
        html += `</div></div>`;
        container.innerHTML = html;
        container.querySelectorAll('.mcq-option').forEach(div => {
            div.addEventListener('click', function (e) {
                const rawOption = e.currentTarget.dataset.option;
                const decoded = new DOMParser().parseFromString(rawOption, 'text/html').documentElement.textContent;
                toggleMcqOption(e.currentTarget, decoded);
                document.querySelectorAll('.mcq-option').forEach(el => el.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
            });
        });
        document.getElementById('practice-submit-btn').style.display = 'none';
        return;
    }

    if (AppState.currentQ.type === 'mcq' && AppState.currentQ.options.length) {
        const isMulti = Array.isArray(AppState.currentQ.correctAnswer);
        html += `<div style="margin-top:16px;"><strong>${isMulti ? 'Pick all that hit' : 'Lock in your answer'}:</strong><br>`;
        AppState.currentQ.options.forEach(opt => {
            html += `<div class="mcq-option ${isMulti ? 'multi-option' : ''}"
                          data-option="${escapeAttribute(opt)}">
                    ${escapeHtml(opt)}
                  </div>`;
        });
        html += `</div>`;
        document.getElementById('practice-submit-btn').style.display = 'inline-block';
        document.getElementById('practice-submit-btn').innerText = 'Lock In Answer';

    } else if (AppState.currentQ.type === 'numeric') {
        html +=
            `<div class="input-group" style="margin-top:16px;"><label>Numeric answer:</label><input type="number" step="any" id="numeric-answer-input" class="pomo-input" placeholder="0.00"></div>`;
        document.getElementById('practice-submit-btn').style.display = 'inline-block';
        document.getElementById('practice-submit-btn').innerText = 'Lock In Answer';
    } else {
        html +=
            `<p style="margin-top:16px; color:#cbd5e1;">This is a free-response question. No multiple choice here.</p>`;
        document.getElementById('practice-submit-btn').style.display = 'inline-block';
        document.getElementById('practice-submit-btn').innerText = 'Reveal Answer';
    }
    html += `</div>`;
    container.innerHTML = html;
    container.querySelectorAll('.mcq-option').forEach(el => {
        el.addEventListener('click', function (e) {
            const optionText = this.getAttribute('data-option');
            toggleMcqOption(this, optionText);
        });
    });
}

export function toggleMcqOption(element, optionText) {
    const isMulti = Array.isArray(AppState.currentQ.correctAnswer);

    if (!isMulti) {
        AppState.selectedMcq = optionText;
        document.querySelectorAll('.mcq-option').forEach(el => el.classList.remove('selected'));
        element.classList.add('selected');
    } else {
        element.classList.toggle('selected');
        const allSelected = document.querySelectorAll('.mcq-option.selected');
        AppState.selectedMcq = Array.from(allSelected).map(el => el.dataset.option);
    }
}

// ── Practice Time → Daily/Subjective Study Counter Convergence ────────────
// Injects the accumulated stopwatch seconds from the current question
// practice attempt directly into the global studySecs tracker (the same
// object the Pomodoro deep-focus blocks write into). This makes the time
// spent actively executing a question count toward the user's daily study
// total and per-subject HUD volume, with an immediate live repaint.
//
// GUARD: The caller MUST have just set
//   AppState.practiceSubmittedFlags[AppState.currentPracticeIndex] = true
// immediately before invoking this, so the early-return guard at the top of
// practiceSubmit() prevents multi-counting on re-entry. We re-check the flag
// here as a second line of defence to guarantee the injection runs exactly
// once per single question attempt session.
function _injectPracticeTimeIntoStudySecs() {
    try {
        if (!AppState.currentQ) return;
        // Second-line guard: only inject when this attempt session is truly
        // finalised (flag already flipped to true by the caller).
        if (!AppState.practiceSubmittedFlags[AppState.currentPracticeIndex]) return;

        // ⚡ FIX: Detect if Pomodoro or the main countdown timer is already incrementing studySecs live
        const pomoActive = document.body.classList.contains('pomo-active') ||
            document.body.classList.contains('timer-running') ||
            (typeof window._pomoRunning === 'boolean' && window._pomoRunning);

        if (pomoActive) {
            // The time spent on this question has already been tracked second-by-second by pomodoro.js.
            // Bypassing mutation to prevent double-counting. Just refresh layout and save.
            if (typeof updateStudyTimeHeader === 'function') updateStudyTimeHeader();
            saveAllAsync().catch(console.error);
            return;
        }

        const subject = AppState.currentQ.subject;

        // ── Defensive subject key normalization (same pattern as matrix.js) ──
        const SUBJ_KEY_ALIASES = {
            math: 'maths',
            mathematics: 'maths',
            'maths ': 'maths',
        };
        const rawKey = String(subject).trim().toLowerCase();
        const subjKey = SUBJ_KEY_ALIASES[rawKey] || rawKey;

        // studySecs keys are lowercase: physics / chemistry / maths
        if (!subjKey || !(subjKey in studySecs)) return;

        const seconds = Math.max(0, Math.floor(AppState.practiceSeconds || 0));
        if (seconds <= 0) return;

        // ⚡ CRITICAL FIX: Deposit time directly using the canonical normalized key
        studySecs[subjKey] += seconds;

        // Live HUD repaint — updateStudyTimeHeader reads studySecs and
        // repaints the dashboard counters. Lazy-import pomodoro.js to avoid
        // any static circular-dependency edge cases.
        import('./pomodoro.js').then(m => {
            if (typeof m.updateStudyTimeHeader === 'function') m.updateStudyTimeHeader();
        }).catch(() => { /* fall back to the already-imported binding */ });
        // Fallback: the function is already imported at module load, so call
        // it directly too (cheap — it just reads state and writes to the DOM).
        if (typeof updateStudyTimeHeader === 'function') updateStudyTimeHeader();

        // Persist the mutation to IndexedDB/Cloud sync pipelines.
        saveAllAsync().catch(console.error);
    } catch (e) {
        console.error('Failed to inject practice time into studySecs:', e);
    }
}

// ============================================================================
// COGNITIVE MMR & ELO MATRIX ENGINE — HARDCORE ASYMMETRIC GRIND EDITION
// ============================================================================
// Subject-segregated, uncapped Cognitive Matchmaking Rating system. Runs
// entirely without a pre-existing question-difficulty database by reverse-
// engineering an "Implied Difficulty Rating" (IDR, stored as qElo) for every
// question at runtime from user execution telemetry.
//
// Refactored with Asymmetric Antagonistic Scaling Curves to enforce a gritty,
// low-yield MMO grind style that cushions falls at low levels and heavily
// compresses gains while amplifying drop penalties at high rankings.
// ============================================================================

// Foundational K-factor baselines scaled down to enforce tight, micro-incremental progression
const ELO_SUBJECT_BASELINES = {
    physics:   { K: 12, defaultTime: 180 },
    chemistry: { K: 12, defaultTime: 90  },
    maths:     { K: 16, defaultTime: 240 },
};

// Strict competitive rank brackets
const ELO_RANK_TIERS = [
    { min: 0,    max: 1199,      name: 'NPC',                  icon: '🧍' },
    { min: 1200, max: 1599,      name: 'Skill Issue',          icon: '💀' },
    { min: 1600, max: 1999,      name: 'Cooking',              icon: '🍳' },
    { min: 2000, max: 2399,      name: 'Let Him Cook',         icon: '👨‍🍳' },
    { min: 2400, max: 2799,      name: 'Diffed the Exam',      icon: '💀' },
    { min: 2800, max: Infinity,  name: 'Unhinged Gigachad',    icon: '🗿' },
];

/**
 * Parse any integer rating into its competitive skill tier.
 */
function getRankTierDetails(rating) {
    const r = Math.max(0, Math.floor(Number(rating) || 0));
    for (const t of ELO_RANK_TIERS) {
        if (r >= t.min && r <= t.max) {
            return { name: t.name, icon: t.icon, badge: `${t.icon} ${t.name}`, rating: r };
        }
    }
    const top = ELO_RANK_TIERS[ELO_RANK_TIERS.length - 1];
    return { name: top.name, icon: top.icon, badge: `${top.icon} ${top.name}`, rating: r };
}

/** Returns the lower bound of the tier immediately above the current rating. */
function _getNextTierThreshold(rating) {
    const r = Math.max(0, Math.floor(Number(rating) || 0));
    for (let i = 0; i < ELO_RANK_TIERS.length; i++) {
        const t = ELO_RANK_TIERS[i];
        if (r >= t.min && r <= t.max) {
            return i + 1 < ELO_RANK_TIERS.length ? (t.max + 1) : null;
        }
    }
    return null;
}

/** Returns the human-readable name of the tier immediately above the rating. */
function _getNextTierName(rating) {
    const r = Math.max(0, Math.floor(Number(rating) || 0));
    for (let i = 0; i < ELO_RANK_TIERS.length; i++) {
        const t = ELO_RANK_TIERS[i];
        if (r >= t.min && r <= t.max) {
            return i + 1 < ELO_RANK_TIERS.length ? ELO_RANK_TIERS[i + 1].name : t.name;
        }
    }
    return '';
}

/**
 * Historical chapter average execution time (seconds).
 */
function _getChapterAvgTime(subject, chapter) {
    const safeSubject = _normalizeSubjectKey(subject);
    const baseline = ELO_SUBJECT_BASELINES[safeSubject];
    if (!baseline) return 180;
    const timed = AppState.questionBank.filter(q =>
        q.subject === safeSubject && q.chapter === chapter &&
        q.timeTaken > 0 && !q.isAnomaly
    );
    if (timed.length === 0) return baseline.defaultTime;
    const sum = timed.reduce((acc, q) => acc + (q.timeTaken || 0), 0);
    return sum / timed.length;
}

/**
 * Running average qElo across a chapter's non-anomalous questions.
 */
function _getChapterAvgElo(subject, chapter) {
    const safeSubject = _normalizeSubjectKey(subject);
    const qs = AppState.questionBank.filter(q =>
        q.subject === safeSubject && q.chapter === chapter && !q.isAnomaly
    );
    if (qs.length === 0) return 1200;
    const sum = qs.reduce((acc, q) => acc + (q.qElo || 1200), 0);
    return sum / qs.length;
}

/** Volume of unresolved friction items currently in the bank. */
function _getActiveErrorBankCount() {
    return AppState.questionBank.filter(q => q.status === 'error' || q.status === 'wrong').length;
}

/**
 * Continuous, Non-Linear Biological Memory Construct — Chapter Health.
 *
 * Replaces the legacy discrete model (flat 15% tax per `getDueStatus === 'ready'`
 * item) which produced severe telemetry distortion and crashed layout transitions
 * during active practice blocks. The new model is grounded in Bjork's *New Theory
 * of Disuse* and uses an exponential Retrieval Strength decay per item, then
 * aggregates all attempted items in the chapter into a single difficulty-weighted
 * harmonic accessibility score.
 *
 *   RS_i(t) = e ^ ( -ln(2) · (Δt / S_i) )
 *   A_ch(t) = ( Σ Q_Elo,i · RS_i(t) ) / ( Σ Q_Elo,i ) · 100
 *
 * where  Δt   = (Date.now() − lastReviewedAt) / 86_400_000   (days, float)
 *        S_i  = max(0.5, easeFactor)                          (stability, days)
 *
 * This is a PURE READ — it never mutates the question objects, so it is safe to
 * call at high frequency from layout/telemetry loops (idempotent). Permanent
 * field attachment is performed once, at write time, inside
 * `calculateEloMigration` / `practiceSubmit` / `confirmErrorLog`.
 *
 * @param {string} subject  Raw subject key (aliases auto-normalised).
 * @param {string} chapter  Chapter name.
 * @returns {number} Chapter health, clamped tightly to [10, 100]. Neutral 50
 *                   when no tracked items exist for the domain.
 */
function _getChapterHealth(subject, chapter) {
    const safeSubject = _normalizeSubjectKey(subject);
    const qs = AppState.questionBank.filter(q =>
        q.subject === safeSubject && q.chapter === chapter &&
        q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong')
    );
    if (qs.length === 0) return 50; // neutral default for UI consistency

    const nowMs = Date.now();
    const MS_PER_DAY = 86400000;
    const LN2 = Math.LN2; // natural log of 2

    let weightedSum = 0;   // Σ ( Q_Elo,i · RS_i(t) )
    let weightTotal = 0;   // Σ  Q_Elo,i

    for (const q of qs) {
        // ── JIT (Just-In-Time) legacy hydration: resolve the biological-memory
        //    fields on the fly WITHOUT mutating the source object, so cloud-sync
        //    shape is never disturbed by a read path. ──
        const mem = _hydrateMemoryFields(q);

        // Δt — continuous time variance in days (floating point).
        const lastMs = new Date(mem.lastReviewedAt).getTime();
        const deltaMs = nowMs - (isNaN(lastMs) ? nowMs : lastMs);
        const deltaDays = deltaMs / MS_PER_DAY;

        // S_i — structural memory stability tracking coefficient (days).
        const S_i = Math.max(0.5, mem.easeFactor);

        // RS_i(t) — exponential retrievability. e^(−ln2 · Δt/S_i) ∈ (0, 1].
        // A freshly logged fumble (Δt = 0) yields RS = 1, so it degrades the
        // chapter baseline smoothly proportional to its difficulty weight
        // rather than triggering an architectural crash.
        const RS = Math.exp(-LN2 * (deltaDays / S_i));

        // Difficulty weight: Q_Elo,i (Implied Difficulty Rating).
        weightedSum += mem.qElo * RS;
        weightTotal += mem.qElo;
    }

    if (weightTotal === 0) return 50; // guard against an all-zero-weight chapter

    // A_ch(t) — difficulty-weighted harmonic accessibility mean, scaled to 0–100.
    let health = (weightedSum / weightTotal) * 100;

    // Clamp tightly between 10 and 100 to prevent chart layout breakage.
    health = Math.max(10, Math.min(100, health));
    return health;
}

/**
 * JIT (Just-In-Time) legacy-data hydration for the biological-memory fields.
 *
 * Resolves `easeFactor`, `qElo`, and `lastReviewedAt` for a single question
 * using the backward-compatibility fallback rules, WITHOUT mutating the source
 * object. This keeps the read path (chapter-health loops) safe against legacy
 * shapes while the write path (`calculateEloMigration` etc.) permanently
 * attaches the canonical fields on save.
 *
 * @param {object} q  A question object from `AppState.questionBank`.
 * @returns {{easeFactor:number, qElo:number, lastReviewedAt:string}}
 */
function _hydrateMemoryFields(q) {
    // ── easeFactor: default baseline 2.5 when missing/undefined. ──
    const easeFactor = (typeof q.easeFactor === 'number' && isFinite(q.easeFactor))
        ? q.easeFactor
        : 2.5;

    // ── qElo: use existing value; fallback to 1200 if missing/volatile-absent.
    //    (Chapter-average fallback is applied by callers when relevant; here we
    //    only guarantee a non-null numeric weight so the harmonic mean never
    //    divides by zero.) ──
    const qElo = (typeof q.qElo === 'number' && isFinite(q.qElo) && q.qElo > 0)
        ? q.qElo
        : 1200;

    // ── lastReviewedAt: hydrate per the legacy blueprint. ──
    let lastReviewedAt = q.lastReviewedAt;
    if (!lastReviewedAt || isNaN(new Date(lastReviewedAt).getTime())) {
        // Rule 1: if historyLogs exists and has entries, parse the LATEST log.
        if (Array.isArray(q.historyLogs) && q.historyLogs.length > 0) {
            let latestMs = NaN;
            for (const log of q.historyLogs) {
                if (log && log.timestamp) {
                    const t = new Date(log.timestamp).getTime();
                    if (!isNaN(t) && (isNaN(latestMs) || t > latestMs)) latestMs = t;
                }
            }
            if (!isNaN(latestMs)) lastReviewedAt = new Date(latestMs).toISOString();
        }
        // Rule 2: status === 'solved' -> 1 day ago.
        if (!lastReviewedAt && q.status === 'solved') {
            lastReviewedAt = new Date(Date.now() - 86400000).toISOString();
        }
        // Rule 3: status === 'error' | 'wrong' -> now (0 hours elapsed).
        if (!lastReviewedAt && (q.status === 'error' || q.status === 'wrong')) {
            lastReviewedAt = new Date(Date.now()).toISOString();
        }
        // Final safety net: treat as just-seen for a neutral decay baseline.
        if (!lastReviewedAt) {
            lastReviewedAt = new Date(Date.now()).toISOString();
        }
    }

    return { easeFactor, qElo, lastReviewedAt };
}

/** Deep Work Block multiplier (μ_block). */
function _getDeepWorkBlockMultiplier() {
    if (window._eloDistractionFlag === true) return 0.75;
    if (AppState.practiceTimer !== null) return 1.5;
    const pomoActive = document.body.classList.contains('pomo-active') ||
        document.body.classList.contains('timer-running') ||
        (typeof window._pomoRunning === 'boolean' && window._pomoRunning);
    if (pomoActive) return 1.5;
    return 1.0;
}

/** Normalise subject aliases to canonical keys. */
function _normalizeSubjectKey(subject) {
    const raw = String(subject || '').trim().toLowerCase();
    if (raw === 'math' || raw === 'mathematics') return 'maths';
    return raw;
}

/** Consolidated Global Meta-MMR with non-linear p-norm harmonic mapping. */
function _computeGlobalMetaMMR(eP, eC, eM) {
    const clampPos = v => Math.max(1, Number(v) || 1);
    const P = clampPos(eP), C = clampPos(eC), M = clampPos(eM);
    const harm = Math.pow((P ** -2 + C ** -2 + M ** -2) / 3, -1 / 2);
    const mean = (P + C + M) / 3;
    const penalty = 0.15 * (Math.max(0, mean - P) + Math.max(0, mean - C) + Math.max(0, mean - M));
    return Math.max(0, Math.round(harm - penalty));
}

/**
 * THE CORE ELO MIGRATION ENGINE — HARDCORE ASYMMETRIC OVERHAUL
 *
 * Synchronous (execution-blocking). Computes structural modifications in-place.
 */
function calculateEloMigration(subject, actualTime, scoreOutcome, chapterHealth, questionObj) {
    const safeSubject = _normalizeSubjectKey(subject);
    const base = ELO_SUBJECT_BASELINES[safeSubject];

    const result = {
        subject: safeSubject,
        deltaSubject: 0,
        deltaGlobal: 0,
        oldSubjectElo: AppState.elo[safeSubject] || 1200,
        newSubjectElo: AppState.elo[safeSubject] || 1200,
        oldGlobalElo: AppState.elo.global || 1200,
        newGlobalElo: AppState.elo.global || 1200,
        oldQElo: (questionObj && typeof questionObj.qElo === 'number') ? questionObj.qElo : 1200,
        newQElo: (questionObj && typeof questionObj.qElo === 'number') ? questionObj.qElo : 1200,
        tierChanged: false,
        oldTier: '',
        newTier: '',
        isAnomaly: false,
    };
    if (!base) return result;

    // ── Step A: Temporal Divergence (τ) + Subject Behavioral Adjustments ──
    const T_act = Math.max(0, Number(actualTime) || 0);
    const T_avg = _getChapterAvgTime(safeSubject, questionObj ? questionObj.chapter : null);
    const tauRaw = T_act / Math.max(1, T_avg);

    let tau = tauRaw;
    const S = (Number(scoreOutcome) === 1) ? 1 : 0;
    let S_forPerf = S;

    if (safeSubject === 'physics') {
        tau = tauRaw * 0.85; // Calculation buffer window
    } else if (safeSubject === 'chemistry') {
        // Slow-but-correct answers downgrade the performance vector yield
        if (tauRaw > 1.25 && S === 1) {
            S_forPerf = Math.max(0.1, 1.0 - 0.4 * (tauRaw - 1.25));
        }
    }

    const E_s = AppState.elo[safeSubject] || 1200;
    const Q_Elo = (questionObj && typeof questionObj.qElo === 'number') ? questionObj.qElo : 1200;

    // ── Step B: Implied Performance Rating (R_perf) ──
    const tauSafe = Math.max(0.001, tau);
    const R_perf = E_s + 400 * (
        S_forPerf * Math.log(1 + tau) -
        (1 - S_forPerf) * (1 / tauSafe)
    );

    // ── Step C: Expected Score Prediction (E_score) ──
    const E_score = 1 / (1 + Math.pow(10, (Q_Elo - E_s) / 400));

    // ── Step D: Adaptive K-Factor Multipliers (K_system) ──
    let K_base = base.K;
    if (E_s > 2000) {
        const shield = (3000 - E_s) / 1000;
        K_base = K_base * Math.max(0, shield); // High-tier soft wall
    }
    const mu_block = _getDeepWorkBlockMultiplier();
    const H_ch = Math.max(0, Math.min(100, Number(chapterHealth) || 0));
    const omega_decay = 1.0 + Math.log(Math.max(0.0001, 2 - (H_ch / 100)));
    const N_active = _getActiveErrorBankCount();
    const delta_error = Math.exp(-0.4 * (N_active / 15));
    const K_system = K_base * mu_block * omega_decay * delta_error;

    // ── Step E: Asymmetric Antagonistic Scaling Curves ──
    // Ω_win compresses point yields heavily at high ratings (making climbing tough).
    // Ω_loss minimizes deductions at low ratings but scales up heavily at high levels.
    const omegaWin = 2 / (1 + Math.pow(10, (E_s - 1200) / 800));
    const omegaLoss = 2 / (1 + Math.pow(10, (1200 - E_s) / 800));

    let rawDelta = 0;
    if (S === 1) {
        rawDelta = K_system * omegaWin * (1 - E_score);
    } else {
        rawDelta = K_system * omegaLoss * (0 - E_score);
    }

    // ── Re-solve Decay: Questions from the Error Vault that have already been
    // seen (have an errorReason and a firstAttemptResult) generate significantly
    // less ELO on re-solve. The logic: you already know the solution, so
    // correctly re-solving it doesn't prove raw problem-solving ability — it
    // proves memory retention, which is valuable but NOT the same as solving
    // a cold question you've never seen. Wrong answers on re-solves still
    // hurt normally (you had the solution and STILL got it wrong = massive loss).
    let reSolveMultiplier = 1.0;
    if (questionObj && questionObj.errorReason && questionObj.firstAttemptResult) {
        // This question has been attempted before AND has a logged result.
        // Correct re-solves give only 25% of the normal delta.
        // Wrong re-solves still hurt at 100% (you saw the solution and blew it).
        reSolveMultiplier = (S === 1) ? 0.25 : 1.0;
    }
    rawDelta *= reSolveMultiplier;

    // ── Asymmetric Rating Disparity Filter ──
    // Prevents an advanced rating from point-farming elementary lower-tier content.
    const ratingSpread = E_s - Q_Elo;
    if (ratingSpread > 400) {
        if (S === 1) {
            rawDelta = Math.min(rawDelta, 0.2); // Hard point ceiling on mismatched wins
        } else {
            rawDelta = rawDelta * 2.0; // Double-penalty liquidation event for casual drops
        }
    }

    const oldE_s = E_s;
    let newE_s = Math.max(0, E_s + rawDelta);
    if (newE_s > 2999.99) newE_s = 2999.99;
    AppState.elo[safeSubject] = newE_s;

    // ── Fixed Question Retro-Mutation Loop ──
    // FIXED: Changed learning scale from 20 down to an elegant fractional 0.05 convergence 
    // coefficient to completely eliminate numerical hyper-inflation crashes.
    const oldQ = Q_Elo;
    let newQ = Math.max(0, Q_Elo + 0.05 * (R_perf - Q_Elo));

    // Anomaly evaluation boundaries
    const chapterAvg = _getChapterAvgElo(safeSubject, questionObj ? questionObj.chapter : null);
    let isAnomaly = false;
    if (Math.abs(newQ - chapterAvg) > 600) {
        isAnomaly = true;
    }
    if (questionObj) {
        questionObj.qElo = newQ;
        if (isAnomaly) questionObj.isAnomaly = true;

        // ── Biological Memory Construct: permanent field attachment ──
        // When an execution frame resolves, stamp the question with the exact
        // current timestamp so subsequent `_getChapterHealth` reads compute a
        // continuous Δt instead of falling back to JIT hydration. This is the
        // write-side counterpart to the JIT read-side hydration — it
        // transitions the object seamlessly into the updated schema without a
        // destructive global migration on boot.
        questionObj.lastReviewedAt = new Date().toISOString();

        // Adjust the structural stability coefficient (easeFactor) according to
        // the performance outflux. Success reinforces stability (slower future
        // decay); failure erodes it (accelerated subsequent decay cycles).
        // The clamp keeps the value within the [1.3, 3.0] SR-safe band.
        //
        // NOTE — flow composition with the SR drawer:
        //   • app.js `practiceSubmit` flow (standard practice modal): this
        //     adjustment is the authoritative easeFactor mutation and persists.
        //   • matrix.js `_applyResult` → `submitPracticeLog` flow: this runs
        //     at the moment of truth, then `computeSR()` later reads the
        //     adjusted value as its input and produces the SM-2 scheduled
        //     easeFactor. `lastReviewedAt` (untouched by computeSR) always
        //     persists in both flows.
        if (S === 1) {
            questionObj.easeFactor = Math.min(3.0, (questionObj.easeFactor || 2.5) + 0.15);
        } else {
            questionObj.easeFactor = Math.max(1.3, (questionObj.easeFactor || 2.5) - 0.2);
        }
    }

    // ── Step F: Master Global Meta-MMR Sync ──
    const oldGlobal = AppState.elo.global || 1200;
    const eP = AppState.elo.physics || 1200;
    const eC = AppState.elo.chemistry || 1200;
    const eM = AppState.elo.maths || 1200;
    const newGlobal = _computeGlobalMetaMMR(eP, eC, eM);
    AppState.elo.global = newGlobal;

    const oldTier = getRankTierDetails(oldE_s);
    const newTier = getRankTierDetails(newE_s);

    result.deltaSubject = newE_s - oldE_s;
    result.deltaGlobal = newGlobal - oldGlobal;
    result.newSubjectElo = newE_s;
    result.newGlobalElo = newGlobal;
    result.newQElo = newQ;
    result.oldQElo = oldQ;
    result.tierChanged = oldTier.name !== newTier.name;
    result.oldTier = oldTier.badge;
    result.newTier = newTier.badge;
    result.isAnomaly = isAnomaly;
    return result;
}

// ── Front-End Interface Hydration ──────────────────────────────────────────

/** Render the Global Meta-MMR tracking row under the user profile card. */
function _renderGlobalMmrRow(globalElo) {
    const profile = document.querySelector('.user-profile');
    if (!profile) return;
    let row = document.getElementById('global-mmr-row');
    if (!row) {
        row = document.createElement('div');
        row.id = 'global-mmr-row';
        row.className = 'global-mmr-row';
        profile.appendChild(row);
    }
    const tier = getRankTierDetails(globalElo);

    // Completely drops the long tier string text to display just the icon and numeric Elo value
    row.innerHTML = `<span class="mmr-tier-badge">${tier.icon} ${Math.round(globalElo)} ELO</span>`;

    // ── Make the ELO badge clickable → opens the JEE Advanced AIR projection
    // popup. The row persists across re-renders (getElementById reuse above),
    // so setting onclick each time is idempotent and never stacks listeners.
    row.style.cursor = 'pointer';
    row.title = 'Click to view predicted JEE Advanced AIR';
    row.onclick = () => _openAirPopup(globalElo, row);

    // If the popup is already open, refresh its content with the latest elo.
    _refreshAirPopupIfOpen(globalElo);
}

// ── JEE Advanced AIR projection popup ──────────────────────────────────────
// Small square popover that opens when the user clicks their Global ELO badge
// in the sidebar (near the profile + name). Equates the Cognitive MMR rating
// to a projected JEE Advanced All-India Rank using the log-linear model
// derived from the Elo engine (σ=400 logistic, baseline 1200, cap 3000):
//
//   AIR_adv  = 10 ^ (8.00 − 0.00214 × GlobalElo)
//   AIR_main = 10 ^ (8.61 − 0.00236 × GlobalElo)
//
// Anchored at Elo 1200 ≈ AIR 6,00,000 (median aspirant) and Elo 2800 ≈ AIR 100
// (top of the grind). Each +400 Elo = 10× lower expected error rate.

const JEE_ADV_CANDIDATES = 250000;
const JEE_MAIN_CANDIDATES = 1200000;

function _computeJeeAdvAir(globalElo) {
    const e = Math.max(0, Math.min(3000, Number(globalElo) || 0));
    return Math.pow(10, 8.00 - 0.00214 * e);
}

function _computeJeeMainAir(globalElo) {
    const e = Math.max(0, Math.min(3000, Number(globalElo) || 0));
    return Math.pow(10, 8.61 - 0.00236 * e);
}

function _formatAir(air) {
    if (!isFinite(air) || air <= 0) return '—';
    if (air < 100) return 'Top ' + Math.max(1, Math.round(air));
    return '~' + Math.round(air).toLocaleString('en-IN');
}

function _formatPercentile(air, candidates) {
    if (!isFinite(air) || air <= 0 || candidates <= 0) return '—';
    const topPct = (air / candidates) * 100;
    if (topPct >= 0.01) return 'Top ' + topPct.toFixed(2) + '%';
    const percentile = (1 - air / candidates) * 100;
    return percentile.toFixed(2) + ' %ile';
}

/** Build (or refresh) the inner content of the AIR popup for a given elo. */
function _airPopupInnerHtml(globalElo) {
    const tier = getRankTierDetails(globalElo);
    const advAir = _computeJeeAdvAir(globalElo);
    const mainAir = _computeJeeMainAir(globalElo);
    const advPct = _formatPercentile(advAir, JEE_ADV_CANDIDATES);
    const mainPct = _formatPercentile(mainAir, JEE_MAIN_CANDIDATES);
    const isLow = advAir >= JEE_ADV_CANDIDATES; // wouldn't clear Advanced cutoff
    return `
        <div class="air-pop-head">
            <span class="air-pop-title">🎯 JEE Advanced</span>
            <button class="air-pop-close" type="button" aria-label="Close">✕</button>
        </div>
        <div class="air-pop-body">
            <div class="air-pop-air ${isLow ? 'air-low' : ''}">${_formatAir(advAir)}</div>
            <div class="air-pop-air-label">Predicted AIR</div>
            <div class="air-pop-pct">${isLow ? 'Below cutoff — keep grinding' : advPct}</div>
        </div>
        <div class="air-pop-divider"></div>
        <div class="air-pop-secondary">
            <div class="air-pop-sec-row">
                <span class="air-pop-sec-label">JEE Main</span>
                <span class="air-pop-sec-val">${_formatAir(mainAir)}</span>
            </div>
            <div class="air-pop-sec-row">
                <span class="air-pop-sec-label">Main %ile</span>
                <span class="air-pop-sec-val">${_formatPercentile(mainAir, JEE_MAIN_CANDIDATES)}</span>
            </div>
        </div>
        <div class="air-pop-foot">
            <span class="air-pop-tier">${tier.icon} ${tier.name}</span>
            <span class="air-pop-elo">${Math.round(globalElo)} Global</span>
        </div>`;
}

/** Open the small square AIR popup, anchored near the clicked badge. */
function _openAirPopup(globalElo, anchorEl) {
    // If already open, just close it (toggle behaviour).
    const existing = document.getElementById('air-popup');
    if (existing) { _closeAirPopup(); return; }

    _injectAirPopupStyles();

    const pop = document.createElement('div');
    pop.id = 'air-popup';
    pop.className = 'air-popup';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Predicted JEE Advanced AIR');
    pop.innerHTML = _airPopupInnerHtml(globalElo);
    document.body.appendChild(pop);

    // ── Smart positioning: place the square just below the badge, aligned to
    // the badge's left edge. Flip above / clamp to viewport if it would clip.
    const rect = anchorEl.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const gap = 8;
    let left = rect.left;
    let top = rect.bottom + gap;

    // Horizontal clamp (keep fully on-screen, min 12px margin)
    const maxLeft = window.innerWidth - popRect.width - 12;
    left = Math.max(12, Math.min(left, maxLeft));

    // If it overflows the bottom, flip it above the badge
    if (top + popRect.height > window.innerHeight - 12) {
        top = rect.top - popRect.height - gap;
    }
    // Final vertical clamp
    top = Math.max(12, Math.min(top, window.innerHeight - popRect.height - 12));

    pop.style.left = left + 'px';
    pop.style.top = top + 'px';

    // Entrance animation
    requestAnimationFrame(() => { pop.classList.add('air-pop-visible'); });

    // ── Wire dismiss handlers (close button, outside click, Esc) ──
    pop.querySelector('.air-pop-close').addEventListener('click', _closeAirPopup);
    // Defer the outside-click listener so the opening click doesn't close it
    setTimeout(() => {
        document.addEventListener('click', _airPopupOutsideClick, true);
    }, 0);
    document.addEventListener('keydown', _airPopupEsc);
}

function _closeAirPopup() {
    const pop = document.getElementById('air-popup');
    if (!pop) return;
    pop.classList.remove('air-pop-visible');
    setTimeout(() => { if (pop && pop.parentNode) pop.parentNode.removeChild(pop); }, 180);
    document.removeEventListener('click', _airPopupOutsideClick, true);
    document.removeEventListener('keydown', _airPopupEsc);
}

function _airPopupOutsideClick(e) {
    const pop = document.getElementById('air-popup');
    if (pop && !pop.contains(e.target)) _closeAirPopup();
}

function _airPopupEsc(e) {
    if (e.key === 'Escape') _closeAirPopup();
}

/** If the popup is open, refresh its numbers with the latest elo. */
function _refreshAirPopupIfOpen(globalElo) {
    const pop = document.getElementById('air-popup');
    if (pop) pop.innerHTML = _airPopupInnerHtml(globalElo);
    // Re-wire the close button after innerHTML refresh
    if (pop) {
        const cb = pop.querySelector('.air-pop-close');
        if (cb) cb.addEventListener('click', _closeAirPopup);
    }
}

// ── One-time CSS injection for the AIR popup + badge hover ──
function _injectAirPopupStyles() {
    if (document.getElementById('air-popup-styles')) return;
    const style = document.createElement('style');
    style.id = 'air-popup-styles';
    style.textContent = `
        .global-mmr-row { transition: transform 0.15s ease; }
        .global-mmr-row:hover { transform: scale(1.04); }
        .global-mmr-row:hover .mmr-tier-badge {
            box-shadow: 0 0 14px rgba(168,85,247,0.35);
            border-color: rgba(168,85,247,0.5);
        }
        .air-popup {
            position: fixed; z-index: 99999;
            width: 224px; min-height: 224px;
            background: linear-gradient(160deg, #18181b 0%, #12121a 100%);
            border: 1px solid rgba(168,85,247,0.35);
            border-radius: 16px;
            box-shadow: 0 16px 48px rgba(0,0,0,0.6), 0 0 24px rgba(168,85,247,0.15);
            padding: 14px 16px;
            font-family: 'Space Grotesk', system-ui, sans-serif;
            color: #e4e4e7;
            opacity: 0; transform: scale(0.85) translateY(-6px);
            transition: opacity 0.18s ease, transform 0.18s cubic-bezier(0.34,1.56,0.64,1);
            pointer-events: none;
        }
        .air-popup.air-pop-visible {
            opacity: 1; transform: scale(1) translateY(0); pointer-events: auto;
        }
        .air-pop-head {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 8px;
        }
        .air-pop-title {
            font-size: 13px; font-weight: 700; color: #c4b5fd; letter-spacing: 0.3px;
        }
        .air-pop-close {
            background: none; border: none; color: #71717a;
            font-size: 14px; cursor: pointer; padding: 2px 6px; border-radius: 6px;
            line-height: 1;
        }
        .air-pop-close:hover { color: #f87171; background: rgba(248,113,113,0.1); }
        .air-pop-body { text-align: center; padding: 4px 0 8px; }
        .air-pop-air {
            font-size: 34px; font-weight: 800; color: #4ade80;
            line-height: 1.1; letter-spacing: -0.5px;
            text-shadow: 0 0 18px rgba(74,222,128,0.3);
        }
        .air-pop-air.air-low { color: #f87171; text-shadow: 0 0 18px rgba(248,113,113,0.3); }
        .air-pop-air-label {
            font-size: 11px; color: #a1a1aa; text-transform: uppercase;
            letter-spacing: 1.2px; margin-top: 2px;
        }
        .air-pop-pct {
            font-size: 12px; color: #a1a1aa; margin-top: 6px;
        }
        .air-pop-divider {
            height: 1px; background: rgba(255,255,255,0.08); margin: 8px 0;
        }
        .air-pop-secondary { display: flex; flex-direction: column; gap: 4px; }
        .air-pop-sec-row {
            display: flex; justify-content: space-between; align-items: center;
            font-size: 12px;
        }
        .air-pop-sec-label { color: #71717a; }
        .air-pop-sec-val { color: #d4d4d8; font-weight: 600; }
        .air-pop-foot {
            display: flex; justify-content: space-between; align-items: center;
            margin-top: 10px; padding-top: 8px;
            border-top: 1px solid rgba(255,255,255,0.06);
        }
        .air-pop-tier { font-size: 11px; color: #c4b5fd; font-weight: 600; }
        .air-pop-elo { font-size: 11px; color: #71717a; font-weight: 600; }
    `;
    document.head.appendChild(style);
}

window._openAirPopup = _openAirPopup;
window._closeAirPopup = _closeAirPopup;

/** Render a localized rating monitor into a dashboard subject card. */
function _renderSubjectEloMonitor(subject, elo) {
    const safeSubject = _normalizeSubjectKey(subject);
    const cards = document.querySelectorAll('#view-dashboard .compact-subject-card');
    let cardEl = null;
    cards.forEach(c => {
        const h4 = c.querySelector('h4');
        if (!h4) return;
        const txt = h4.textContent.toLowerCase();
        if (safeSubject === 'physics' && txt.includes('physics')) cardEl = c;
        else if (safeSubject === 'chemistry' && txt.includes('chemistry')) cardEl = c;
        else if (safeSubject === 'maths' && (txt.includes('maths') || txt.includes('math'))) cardEl = c;
    });
    if (!cardEl) return;
    const pill = cardEl.querySelector('.distribution-pill');
    if (!pill) return;
    let monitor = cardEl.querySelector('.elo-monitor');
    if (!monitor) {
        monitor = document.createElement('div');
        monitor.className = 'elo-monitor';
        pill.insertAdjacentElement('afterend', monitor);
    }
    const tier = getRankTierDetails(elo);
    const nextThreshold = _getNextTierThreshold(elo);
    monitor.innerHTML =
        `<span class="elo-monitor-rating">${tier.icon} ${Math.round(elo)}</span>` +
        `<span class="elo-monitor-tier">${tier.name}</span>`;
    // Hover breakdown: relative points away from the next higher tier badge.
    if (nextThreshold !== null) {
        const pointsAway = Math.max(0, nextThreshold - Math.floor(elo));
        const nextName = _getNextTierName(elo);
        monitor.setAttribute('data-tooltip',
            `${Math.round(elo)} ${tier.name} · ${pointsAway} pts to ${nextName}`);
    } else {
        monitor.setAttribute('data-tooltip',
            `${Math.round(elo)} ${tier.name} · Peak tier hit`);
    }
}

/**
 * Deficit Lockdown Protocol overlay.
 *   if (min(EP,EC,EM) / max(EP,EC,EM) < 0.65) → activate lockdown.
 * Applies a deep crimson background gradient to #view-dashboard, pulses the
 * lowest-performing subject card, and drops a high-priority warning banner
 * into #cat-text. Sets a global flag the cat-banner telemetry loop honours.
 */
function _applyDeficitLockdown(eP, eC, eM) {
    const minV = Math.min(eP, eC, eM);
    const maxV = Math.max(eP, eC, eM);
    const ratio = maxV > 0 ? minV / maxV : 1;
    const dash = document.getElementById('view-dashboard');
    if (!dash) return;

    const active = ratio < 0.65;
    window._eloDeficitActive = active;

    if (active) {
        dash.classList.add('deficit-lockdown-active');
        // Identify + pulse the lowest-performing subject card.
        const subjects = [['physics', eP], ['chemistry', eC], ['maths', eM]];
        subjects.sort((a, b) => a[1] - b[1]);
        const lowest = subjects[0][0];
        const cards = dash.querySelectorAll('.compact-subject-card');
        cards.forEach(c => {
            const h4 = c.querySelector('h4');
            if (!h4) return;
            const txt = h4.textContent.toLowerCase();
            const subj = txt.includes('physics') ? 'physics'
                : (txt.includes('chemistry') ? 'chemistry' : 'maths');
            if (subj === lowest) c.classList.add('lowest-subject-pulse');
            else c.classList.remove('lowest-subject-pulse');
        });
        // Force an immediate telemetry tick so the warning shows instantly
        // instead of waiting up to 10s for the next rotation.
        if (window.__catTelemetry && typeof window.__catTelemetry.tick === 'function') {
            try { window.__catTelemetry.tick(); } catch (_) { /* noop */ }
        } else {
            const catText = document.getElementById('cat-text');
            if (catText) {
                catText.textContent = '🚨 OVER-SPECIALIZATION DETECTED: You are building a lopsided build. Balance your subject ratings immediately or face total doom.';
                catText.className = 'cat-text glow-red';
            }
        }
    } else {
        dash.classList.remove('deficit-lockdown-active');
        dash.querySelectorAll('.compact-subject-card').forEach(c => c.classList.remove('lowest-subject-pulse'));
    }
}

/**
 * Master Elo Matrix UI hydration. Called from updateUI() and initApp().
 * Renders the global profile row, every subject monitor, and runs the
 * deficit lockdown protocol check.
 */
function renderEloMatrix() {
    const eP = AppState.elo.physics || 1200;
    const eC = AppState.elo.chemistry || 1200;
    const eM = AppState.elo.maths || 1200;
    const eG = AppState.elo.global || 1200;
    _renderGlobalMmrRow(eG);
    _renderSubjectEloMonitor('physics', eP);
    _renderSubjectEloMonitor('chemistry', eC);
    _renderSubjectEloMonitor('maths', eM);
    _applyDeficitLockdown(eP, eC, eM);
}

// ── One-time CSS injection for ELO shift chips (content + header) ──
(function _injectEloShiftChipStyles() {
    if (document.getElementById('elo-shift-chip-styles')) return;
    const style = document.createElement('style');
    style.id = 'elo-shift-chip-styles';
    style.textContent = `
        .elo-shift-chip {
            display: inline-flex; align-items: center; gap: 8px;
            padding: 8px 16px; border-radius: 10px; margin-top: 12px;
            font-family: 'Space Grotesk', monospace; font-size: 14px;
            font-weight: 700; animation: eloChipPop 0.4s cubic-bezier(0.34,1.56,0.64,1);
        }
        .elo-shift-chip.elo-up {
            background: rgba(34,197,94,0.15); color: #4ade80;
            border: 1px solid rgba(34,197,94,0.3);
        }
        .elo-shift-chip.elo-down {
            background: rgba(248,113,113,0.15); color: #f87171;
            border: 1px solid rgba(248,113,113,0.3);
        }
        .elo-shift-chip .elo-shift-delta { font-size: 18px; }
        .elo-shift-chip .elo-shift-label { opacity: 0.8; font-size: 12px; }
        .elo-shift-chip .elo-shift-tier { opacity: 0.7; font-size: 12px; }
        .elo-header-slot {
            display: flex; align-items: center; min-width: 0;
        }
        .elo-header-chip {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 4px 10px; border-radius: 8px;
            font-family: 'Space Grotesk', monospace; font-size: 13px;
            font-weight: 700; white-space: nowrap;
            animation: eloChipPop 0.4s cubic-bezier(0.34,1.56,0.64,1);
        }
        .elo-header-chip.elo-up {
            background: rgba(34,197,94,0.18); color: #4ade80;
            border: 1px solid rgba(34,197,94,0.35);
            box-shadow: 0 0 12px rgba(34,197,94,0.25);
        }
        .elo-header-chip.elo-down {
            background: rgba(248,113,113,0.18); color: #f87171;
            border: 1px solid rgba(248,113,113,0.35);
            box-shadow: 0 0 12px rgba(248,113,113,0.25);
        }
        .elo-header-chip .elo-shift-delta { font-size: 15px; }
        .elo-header-chip .elo-shift-tier { opacity: 0.75; font-size: 11px; }
        @keyframes eloChipPop {
            0% { transform: scale(0.5); opacity: 0; }
            60% { transform: scale(1.15); }
            100% { transform: scale(1); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
})();

/**
 * Inject an animated Elo shift chip into the practice results banner
 * AND the practice header bar (next to streak visualizer).
 * Fires burstEmojis() + playSuperSound() when a ranking tier transition
 * occurs during this practice frame.
 */
function injectEloShiftChip(eloResult) {
    if (!eloResult) return;
    const delta = eloResult.deltaSubject || 0;
    const sign = delta >= 0 ? '+' : '';
    const tier = getRankTierDetails(eloResult.newSubjectElo);
    const subjLabel = eloResult.subject.charAt(0).toUpperCase() + eloResult.subject.slice(1);

    // ── Chip in the practice modal content (original location) ──
    const container = document.getElementById('practice-modal-content');
    if (container) {
        const chip = document.createElement('div');
        chip.className = 'elo-shift-chip ' + (delta >= 0 ? 'elo-up' : 'elo-down');
        chip.innerHTML =
            `<span class="elo-shift-delta">${sign}${Math.round(delta)}</span>` +
            `<span class="elo-shift-label">${subjLabel} Elo</span>` +
            `<span class="elo-shift-tier">[${tier.name}]</span>`;
        container.appendChild(chip);
        // Auto-remove after the animation completes.
        setTimeout(() => { if (chip && chip.parentNode) chip.parentNode.removeChild(chip); }, 4200);
    }

    // ── Chip in the practice header bar (dedicated slot next to streak) ──
    // This is the prominent feedback the user sees front-and-center.
    // Supports both the main practice modal and the SR drawer.
    const headerSlot = document.getElementById('elo-header-slot')
                   || document.getElementById('sr-elo-header-slot');
    if (headerSlot) {
        headerSlot.innerHTML = '';
        const headerChip = document.createElement('div');
        headerChip.className = 'elo-header-chip ' + (delta >= 0 ? 'elo-up' : 'elo-down');
        headerChip.innerHTML =
            `<span class="elo-shift-delta">${sign}${Math.round(delta)}</span>` +
            `<span class="elo-shift-tier">[${tier.name}]</span>`;
        headerSlot.appendChild(headerChip);
        // Auto-remove after the animation completes.
        setTimeout(() => { headerSlot.innerHTML = ''; }, 4200);
    }

    // Tier transition celebration — cascading emoji burst + synth fanfare.
    if (eloResult.tierChanged && delta > 0) {
        try {
            let originX = window.innerWidth / 2;
            let originY = window.innerHeight / 2;
            const modal = document.querySelector('#practice-modal .modal-card') ||
                document.querySelector('#sr-practice-overlay .sr-practice-modal');
            if (modal && modal.offsetParent !== null) {
                const rect = modal.getBoundingClientRect();
                originX = rect.left + rect.width / 2;
                originY = rect.top + rect.height / 2;
            }
            burstEmojis(originX, originY, 40,
                ['🎉', '😄', '🔥', '✨', '🥳', '🎊', '💯', '🌟', '😎', '🏆'], 1.6);
            playSuperSound();
        } catch (_) { /* ignore celebration errors */ }
    }
}

/** Default qElo for a newly-created question = chapter running average, else 1200. */
function _computeDefaultQEloForCurrentChapter() {
    try {
        const subject = AppState.currentSubject;
        const chapter = AppState.currentChapter;
        const qs = AppState.questionBank.filter(q =>
            q.subject === subject && q.chapter === chapter && !q.isAnomaly
        );
        if (qs.length === 0) return 1200;
        const sum = qs.reduce((acc, q) => acc + (q.qElo || 1200), 0);
        return Math.round(sum / qs.length);
    } catch (_) {
        return 1200;
    }
}

// Expose the Elo engine surface for cross-module / debug access.
// _getChapterHealth is also exposed so matrix.js's submitPracticeLog() can
// resolve the active card's chapter stability health for the migration call
// without importing app.js (which would create a circular module dependency
// — app.js already imports matrix.js).
window.getRankTierDetails = getRankTierDetails;
window.calculateEloMigration = calculateEloMigration;
window.renderEloMatrix = renderEloMatrix;
window.injectEloShiftChip = injectEloShiftChip;
window._getChapterHealth = _getChapterHealth;

export function practiceSubmit() {
    if (AppState.practiceSubmittedFlags[AppState.currentPracticeIndex]) return;

    let userAns = "";
    let isCorrect = false;

    if (AppState.currentQ.type === 'mcq') {
        const isMulti = Array.isArray(AppState.currentQ.correctAnswer);

        if (isMulti) {
            const selectedOptions = Array.from(
                document.querySelectorAll('.mcq-option.selected')
            ).map(el => el.dataset.option);

            if (selectedOptions.length === 0) {
                alert("Pick at least one option. You can't skip this.");
                return;
            }

            const selectedLetters = selectedOptions.map(opt => {
                const idx = AppState.currentQ.options.indexOf(opt);
                return idx >= 0 ? String.fromCharCode(65 + idx) : null;
            }).filter(Boolean);

            const correctSorted = AppState.currentQ.correctAnswer.slice().sort();
            const selectedSorted = selectedLetters.slice().sort();

            isCorrect = (
                selectedSorted.length === correctSorted.length &&
                selectedSorted.every((val, i) => val.toLowerCase() === correctSorted[i].toLowerCase())
            );

            userAns = selectedLetters.join(',');

        } else {
            if (!AppState.selectedMcq) {
                alert("Select an answer. No cop-outs.");
                return;
            }

            const optIndex = AppState.currentQ.options.indexOf(AppState.selectedMcq);
            if (optIndex === -1) {
                alert("That's not a valid pick. Try again.");
                return;
            }

            userAns = String.fromCharCode(65 + optIndex);
            isCorrect = (userAns.toLowerCase() === AppState.currentQ.correctAnswer.toLowerCase());
        }

    } else if (AppState.currentQ.type === 'numeric') {
        const numVal = document.getElementById('numeric-answer-input')?.value;
        if (numVal === undefined || numVal === "") {
            alert("Type a number. This ain't multiple choice.");
            return;
        }
        userAns = parseFloat(numVal).toString();
        const userNum = parseFloat(userAns);
        const correctNum = parseFloat(AppState.currentQ.correctAnswer);
        isCorrect = Math.abs(userNum - correctNum) < 1e-6;

    } else if (AppState.currentQ.type === 'text') {
        alert(`The answer was: ${AppState.currentQ.correctAnswer || 'not provided'}`);
        // ⏱ Freeze the timer NOW — the time spent deciding correct/wrong after
        // seeing the answer should NOT inflate the ELO temporal divergence calc.
        // Store the frozen seconds so the self-report ELO migration uses this
        // value instead of the still-ticking practiceSeconds.
        AppState._frozenTextQSeconds = AppState.practiceSeconds;
        if (AppState.practiceTimer) clearInterval(AppState.practiceTimer);
        AppState.practiceSubmittedFlags[AppState.currentPracticeIndex] = true;
        AppState.currentQ.timeTaken = AppState._frozenTextQSeconds;
        AppState.currentQ.status = 'unsolved';
        // ── Biological Memory Construct: stamp the processing instant so the
        //    continuous Δt is well-defined even if the user closes the modal
        //    without self-reporting. The easeFactor is hydrated (not nudged)
        //    here because the success/failure outcome is not yet known — the
        //    nudge is applied later by calculateEloMigration once the user
        //    clicks "Clean Lock" / "Skill Issue" in addTextQuestionFollowUp().
        AppState.currentQ.lastReviewedAt = new Date().toISOString();
        if (typeof AppState.currentQ.easeFactor !== 'number' || !isFinite(AppState.currentQ.easeFactor)) {
            AppState.currentQ.easeFactor = 2.5;
        }
        // ⏱ Converge practice time into the daily/subjective study counters.
        // Runs exactly once — the flag above is already true, so the guard at
        // the top of practiceSubmit() blocks any re-entry from double-counting.
        _injectPracticeTimeIntoStudySecs();
        saveAllAsync().catch(console.error);
        renderPracticeQuestionModal();
        addTextQuestionFollowUp();
        return;
    }

    AppState.practiceSubmittedFlags[AppState.currentPracticeIndex] = true;
    AppState.currentQ.timeTaken = AppState.practiceSeconds;
    // ⏱ Converge practice time into the daily/subjective study counters.
    // Runs exactly once — the flag above is already true, so the guard at
    // the top of practiceSubmit() blocks any re-entry from double-counting.
    _injectPracticeTimeIntoStudySecs();

    // Lock the first-attempt result — accuracy only counts the FIRST attempt,
    // so re-solving the same question later must NOT change it.
    if (!AppState.currentQ.firstAttemptResult) {
        AppState.currentQ.firstAttemptResult = isCorrect ? 'correct' : 'incorrect';
    }

    if (isCorrect) {
        const wasAlreadySolved = (AppState.currentQ.status === 'solved');
        AppState.currentQ.status = 'solved';
        if (!wasAlreadySolved && !AppState.bountyMode) {
            changeCount(AppState.currentQ.subject, 1);
        }
    } else {
        AppState.currentQ.status = 'wrong';
    }

    // ── Cognitive MMR: Elo Migration (MCQ / Numeric resolution) ──
    // Synchronous, execution-blocking. Mutates AppState.elo (subject + global)
    // and AppState.currentQ.qElo in-place BEFORE saveAllAsync so the updated
    // ratings persist in the same write cycle.
    let _eloResult = null;
    try {
        _eloResult = calculateEloMigration(
            AppState.currentQ.subject,
            AppState.practiceSeconds,
            isCorrect ? 1 : 0,
            _getChapterHealth(AppState.currentQ.subject, AppState.currentQ.chapter),
            AppState.currentQ
        );
    } catch (_eloErr) {
        console.error('Elo migration fault:', _eloErr);
    }

    saveAllAsync().catch(console.error);

    if (AppState.bountyMode) {
        evaluateBountyOutcome(isCorrect);
        return;
    }

    renderPracticeQuestionModal();

    // ── Elo shift chip (injected AFTER the modal re-render so it survives) ──
    if (_eloResult) {
        try { injectEloShiftChip(_eloResult); } catch (_) { /* ignore */ }
    }
    // Refresh the dashboard MMR matrix so the new rating is visible immediately.
    try { renderEloMatrix(); } catch (_) { /* ignore */ }

    if (!isCorrect) {
        setTimeout(() => {
            const cont = document.getElementById('practice-modal-content');
            if (cont) {
                const btn = document.createElement('button');
                btn.className = 'btn btn-danger';
                btn.innerText = 'Send to the Vault (Log Error)';
                btn.style.marginTop = '12px';
                btn.onclick = () => {
                    AppState.pendingWrongQ = AppState.currentQ;
                    openModal('error-reason-modal');
                };
                cont.appendChild(btn);
            }
        }, 50);
    }
}

export function addTextQuestionFollowUp() {
    const container = document.getElementById('practice-modal-content');
    if (!container) return;
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = "display:flex; gap:12px; margin-top:12px; align-items:center; justify-content:center; flex-wrap:nowrap;";
    btnContainer.innerHTML =
        `<button class="btn btn-success" id="text-correct-btn" style="flex:1; max-width:170px;">Clean Lock ✅</button>
         <button class="btn btn-danger" id="text-wrong-btn" style="flex:1; max-width:160px;">Skill Issue ❌</button>`;
    container.appendChild(btnContainer);

    document.getElementById('text-correct-btn').onclick = () => {
        const wasAlreadySolved = (AppState.currentQ.status === 'solved');
        // Lock first-attempt result — only the first attempt counts for accuracy.
        if (!AppState.currentQ.firstAttemptResult) AppState.currentQ.firstAttemptResult = 'correct';
        AppState.currentQ.status = 'solved';
        // ── Cognitive MMR: Elo Migration (text self-report: correct) ──
        let _eloRes = null;
        try {
            _eloRes = calculateEloMigration(
                AppState.currentQ.subject,
                AppState._frozenTextQSeconds || AppState.practiceSeconds,
                1,
                _getChapterHealth(AppState.currentQ.subject, AppState.currentQ.chapter),
                AppState.currentQ
            );
        } catch (_e) { console.error('Elo migration fault:', _e); }
        saveAllAsync().catch(console.error);
        if (AppState.bountyMode) {
            evaluateBountyOutcome(true);
            return;
        }
        if (!wasAlreadySolved) {
            changeCount(AppState.currentQ.subject, 1);
        }
        btnContainer.remove();
        const banner = document.createElement('div');
        banner.className = 'result-banner correct';
        banner.innerText = 'Clean lock. Marked correct.';
        container.appendChild(banner);
        if (_eloRes) { try { injectEloShiftChip(_eloRes); } catch (_) { /* ignore */ } }
        try { renderEloMatrix(); } catch (_) { /* ignore */ }
        document.getElementById('practice-submit-btn').style.display = 'none';
    };

    document.getElementById('text-wrong-btn').onclick = () => {
        // Lock first-attempt result — only the first attempt counts for accuracy.
        if (!AppState.currentQ.firstAttemptResult) AppState.currentQ.firstAttemptResult = 'incorrect';
        AppState.currentQ.status = 'wrong';
        // ── Cognitive MMR: Elo Migration (text self-report: wrong) ──
        let _eloRes = null;
        try {
            _eloRes = calculateEloMigration(
                AppState.currentQ.subject,
                AppState._frozenTextQSeconds || AppState.practiceSeconds,
                0,
                _getChapterHealth(AppState.currentQ.subject, AppState.currentQ.chapter),
                AppState.currentQ
            );
        } catch (_e) { console.error('Elo migration fault:', _e); }
        saveAllAsync().catch(console.error);
        if (AppState.bountyMode) {
            evaluateBountyOutcome(false);
            return;
        }
        btnContainer.remove();
        const banner = document.createElement('div');
        banner.className = 'result-banner wrong';
        banner.innerText = 'Skill issue. Marked wrong.';
        container.appendChild(banner);
        if (_eloRes) { try { injectEloShiftChip(_eloRes); } catch (_) { /* ignore */ } }
        try { renderEloMatrix(); } catch (_) { /* ignore */ }
        const logBtn = document.createElement('button');
        logBtn.className = 'btn btn-danger';
        logBtn.innerText = 'Send to the Vault (Log Error)';
        logBtn.style.marginTop = '8px';
        logBtn.onclick = () => {
            AppState.pendingWrongQ = AppState.currentQ;
            openModal('error-reason-modal');
        };
        container.appendChild(logBtn);
        document.getElementById('practice-submit-btn').style.display = 'none';
    };

    document.getElementById('practice-submit-btn').style.display = 'none';
}

export function showSolutionPopup() {
    const solutionText = AppState.currentQ.solution;
    if (!solutionText) return;
    const contentEl = document.getElementById('solution-content');
    if (!contentEl) return;
    // Raw text injection — the global MutationObserver watchdog hydrates
    // any $...$ / $$...$$ LaTeX fragments automatically.
    contentEl.textContent = solutionText;
    openModal('solution-modal');
}

export function confirmErrorLog() {
    let reason = document.getElementById('error-reason-select').value;
    AppState.pendingWrongQ.status = 'error';
    AppState.pendingWrongQ.errorReason = reason;
    // ── Biological Memory Construct: permanent field attachment on save.
    //    Logging an error is a processing instant — stamp lastReviewedAt to
    //    now (0 hours elapsed, so RS≈1 and the fumble degrades the chapter
    //    baseline smoothly via its difficulty weight). Hydrate easeFactor to
    //    the 2.5 baseline if the object is a legacy entry lacking the field.
    //    No success/failure nudge is applied here — that is the exclusive
    //    responsibility of calculateEloMigration (the Elo engine). This path
    //    only guarantees the canonical schema fields are present.
    AppState.pendingWrongQ.lastReviewedAt = new Date().toISOString();
    if (typeof AppState.pendingWrongQ.easeFactor !== 'number' || !isFinite(AppState.pendingWrongQ.easeFactor)) {
        AppState.pendingWrongQ.easeFactor = 2.5;
    }
    saveAllAsync().catch(console.error);
    alert("Logged to the Vault. Error archived.");
    closeModalStr('error-reason-modal');
    renderErrorMatrixFromBank();
    renderPracticeQuestionModal();
}

export function practiceNext() {
    if (AppState.currentPracticeIndex + 1 < AppState.practiceQuestions.length) {
        AppState.currentPracticeIndex++;
        AppState.practiceSeconds = 0;
        updatePracticeTimerDisplay();
        
        // FIX: Re-initialize the background interval loop if it was killed by a text question reveal
        if (AppState.practiceTimer) clearInterval(AppState.practiceTimer);
        if (!AppState.practiceSubmittedFlags[AppState.currentPracticeIndex]) {
            AppState.practiceTimer = setInterval(() => {
                AppState.practiceSeconds++;
                updatePracticeTimerDisplay();
            }, 1000);
        } else {
            AppState.practiceTimer = null;
        }

        renderPracticeQuestionModal();
    } else {
        if (AppState.practiceTimer) clearInterval(AppState.practiceTimer);
        AppState.practiceTimer = null;
        closePracticeModal();
        alert("Queue completely cleared! Flawless run. Take a breath, then load up the next block.");
        showQuestionList();
    }
}

export function practicePrev() {
    if (AppState.currentPracticeIndex > 0) {
        AppState.currentPracticeIndex--;
        AppState.practiceSeconds = 0;
        updatePracticeTimerDisplay();

        // FIX: Re-initialize the background interval loop if it was killed by a text question reveal
        if (AppState.practiceTimer) clearInterval(AppState.practiceTimer);
        if (!AppState.practiceSubmittedFlags[AppState.currentPracticeIndex]) {
            AppState.practiceTimer = setInterval(() => {
                AppState.practiceSeconds++;
                updatePracticeTimerDisplay();
            }, 1000);
        } else {
            AppState.practiceTimer = null;
        }

        renderPracticeQuestionModal();
    }
}

export function closePracticeModal() {
    closeModalStr('practice-modal');
    if (AppState.practiceTimer) clearInterval(AppState.practiceTimer);
    if (document.getElementById('practice-question-list-view').classList.contains('active')) {
        showQuestionList();
    }
}

export async function deleteQuestion(id) {
    if (confirm("Permanently yeet this question from local AND cloud storage? Gone forever. No undo.")) {
        let targetQ = AppState.questionBank.find(q => q.id.toString() === id.toString());

        if (targetQ && typeof AppState.driveAccessToken !== 'undefined' && AppState.driveAccessToken) {
            if (targetQ.driveImageId) {
                deleteMediaFromDrive(targetQ.driveImageId, AppState.driveAccessToken);
            }
            if (targetQ.driveDiagramId) {
                deleteMediaFromDrive(targetQ.driveDiagramId, AppState.driveAccessToken);
            }
        }

        // Use splice instead of filter+reassign to preserve live binding
        for (let i = AppState.questionBank.length - 1; i >= 0; i--) {
            if (AppState.questionBank[i].id.toString() === id.toString()) {
                AppState.questionBank.splice(i, 1);
            }
        }

        await saveAllAsync().catch(console.error);

        if (AppState.questionBank.filter(q => q.subject === AppState.currentSubject && q.chapter === AppState.currentChapter).length > 0) {
            showQuestionList();
        } else {
            goToChapters();
        }
    }
}

export function triggerRedFlash() {
    const overlay = document.createElement('div');
    overlay.className = 'red-flash-overlay';
    document.body.appendChild(overlay);
    overlay.addEventListener('animationend', () => overlay.remove());
}

export function toggleImmersive() {
    document.body.classList.toggle('immersive-active');
    const btn = document.getElementById('immersive-focus-btn');
    if (btn) {
        btn.textContent = document.body.classList.contains('immersive-active') ? '🔲 Exit' : '🕶 Lock In';
    }
}

// ==================== EFFECTS & VISUALS ====================
export function burstEmojis(originX, originY, count, emojis, scale) {
    const layer = document.createElement('div');
    layer.className = 'emoji-layer';
    document.body.appendChild(layer);

    const parts = [];
    for (let i = 0; i < count; i++) {
        const span = document.createElement('span');
        span.className = 'emoji-particle';
        span.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        span.style.fontSize = `${(24 + Math.random() * 16) * scale}px`;
        span.style.left = `${originX}px`;
        span.style.top = `${originY}px`;
        span.style.transform = 'translate(-50%, -50%)';
        layer.appendChild(span);

        const angle = Math.random() * Math.PI * 2;
        const speed = (3 + Math.random() * 5) * scale;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed - 2 * scale;
        parts.push({
            el: span,
            x: originX, y: originY,
            vx, vy,
            life: 1.0,
            decay: 0.008 + Math.random() * 0.015,
            gravity: 0.12 * scale
        });
    }

    let animationId;
    const step = () => {
        let allDead = true;
        for (const p of parts) {
            if (p.life <= 0) continue;
            p.vy += p.gravity;
            p.x += p.vx;
            p.y += p.vy;
            p.life -= p.decay;
            if (p.life < 0) p.life = 0;
            p.el.style.left = `${p.x}px`;
            p.el.style.top = `${p.y}px`;
            p.el.style.opacity = p.life;
            if (p.life > 0) allDead = false;
        }
        if (allDead) {
            layer.remove();
            cancelAnimationFrame(animationId);
        } else {
            animationId = requestAnimationFrame(step);
        }
    };
    animationId = requestAnimationFrame(step);
}

function playSuperSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        const freqs = [523.25, 659.25, 783.99, 1046.5];
        freqs.forEach((f, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(f, now + i * 0.1);
            gain.gain.setValueAtTime(0.2, now + i * 0.1);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.15);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + i * 0.1);
            osc.stop(now + i * 0.1 + 0.2);

            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = 'square';
            osc2.frequency.setValueAtTime(f, now + i * 0.1 + 0.15);
            gain2.gain.setValueAtTime(0.1, now + i * 0.1 + 0.15);
            gain2.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.3);
            osc2.connect(gain2).connect(ctx.destination);
            osc2.start(now + i * 0.1 + 0.15);
            osc2.stop(now + i * 0.1 + 0.3);
        });
    } catch (e) { /* ignore */ }
}

function showNormalGlow() {
    const glow = document.createElement('div');
    glow.className = 'green-glow-overlay';
    document.body.appendChild(glow);
    glow.addEventListener('animationend', () => glow.remove());
}

function showSupercharged() {
    try {
        const glow = document.createElement('div');
        glow.className = 'supercharged-glow-overlay';
        document.body.appendChild(glow);
        glow.addEventListener('animationend', () => glow.remove());
    } catch (e) {
        console.error("Glow error:", e);
    }

    let originX = window.innerWidth / 2;
    let originY = window.innerHeight / 2;
    // Centre the critical-hit emoji burst on whichever practice surface is
    // currently on screen. The SR practice drawer (#sr-practice-overlay) takes
    // priority because it is a full-screen overlay that is only ever present
    // while actively practising; fall back to the standard practice modal
    // (#practice-modal) card, and finally to the viewport centre.
    const srDrawer = document.querySelector('#sr-practice-overlay .sr-practice-modal');
    if (srDrawer && srDrawer.offsetParent !== null) {
        const rect = srDrawer.getBoundingClientRect();
        originX = rect.left + rect.width / 2;
        originY = rect.top + rect.height / 2;
    } else {
        const modal = document.querySelector('#practice-modal .modal-card');
        if (modal && modal.offsetParent !== null) {
            const rect = modal.getBoundingClientRect();
            originX = rect.left + rect.width / 2;
            originY = rect.top + rect.height / 2;
        }
    }

    try {
        if (typeof burstEmojis === 'function') {
            burstEmojis(originX, originY, 40, ['🎉', '😄', '🔥', '✨', '🥳', '🎊', '💯', '🌟', '😎', '🏆'], 1.6);
        } else {
            const fallback = document.createElement('div');
            fallback.textContent = '✨ CRITICAL HIT ✨';
            fallback.style.position = 'fixed';
            fallback.style.top = '50%';
            fallback.style.left = '50%';
            fallback.style.transform = 'translate(-50%, -50%)';
            fallback.style.color = '#c084fc';
            fallback.style.fontSize = '32px';
            fallback.style.fontWeight = 'bold';
            fallback.style.textShadow = '0 0 20px #8b5cf6';
            fallback.style.zIndex = '10000';
            fallback.style.pointerEvents = 'none';
            document.body.appendChild(fallback);
            setTimeout(() => fallback.remove(), 800);
        }
    } catch (e) {
        console.error("burstEmojis error:", e);
    }

    try {
        if (typeof playSuperSound === 'function') {
            playSuperSound();
        }
    } catch (e) {
        console.error("playSuperSound error:", e);
    }

    if (Math.random() < 0.15 && typeof activateOverheat === 'function') {
        activateOverheat();
    }
}

function playCorrectSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        [523.25, 659.25, 783.99].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.08);
            gain.gain.setValueAtTime(0.2, now + i * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.15);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + i * 0.08);
            osc.stop(now + i * 0.08 + 0.18);
        });
    } catch (e) { /* ignore */ }
}

function playWrongSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        [600, 300].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(freq, now + i * 0.08);
            gain.gain.setValueAtTime(0.18, now + i * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.12);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + i * 0.08);
            osc.stop(now + i * 0.08 + 0.15);
        });
    } catch (e) { /* ignore audio errors */ }
}

// ==================== PIXEL FIRE VISUALIZER ====================
window.overheatChaos = false;
// NOTE: The streak canvas / context are NO LONGER cached globally.
// The SR practice drawer (#sr-practice-overlay in matrix.js) dynamically
// constructs and destroys its own #streak-canvas on every invocation, so a
// global reference grabbed at load time would go stale the moment the drawer
// opens or closes. renderLoop() now resolves the active canvas on every
// animation frame (see below) and gracefully no-ops when none is visible.
let _streakRafScheduled = false;

const YELLOW_FRAMES = [
    ['        DD      ','       DRRD     ','    DD DRDODD   ','   DRRDDRROORD  ','  DRRDDRROOORD  ','  DRD DRRYOODDD ','  DDDDDRRYYOODD ',' DRDDDDDROYYYOD ',' DROOOOYYYYYOOD ',' DROOYYYYWWYODD ',' DDDRYYYWWWWYDD ','  DRDYYYYWWWYD  ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['        DD      ','       DRRD     ','    DD DROODD   ','   DRRDDRROORD  ','  DRRDDRROOORD  ','  DRDDDRRYYOODD ','  DDDDDRRYYOODD ',' DRDDDDROYYYYOD ',' DROOOYYYYWYYOD ',' DROOYYYYWWWYOD ',' DDDRYYYWWWWYDD ','  DRDYYYYWWWYD  ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['       DD       ','      DDRRD     ','    DD DROODD   ','   DRRDDRROORD  ','  DRRDDRRYOORD  ','  DRD DDRYYOODD ','   DDDDRRYYOOD  ',' DRDDDDROOYYYOD ',' DROOOYYYYWWYOD ',' DROYYYYWWWWYOD ',' DDRRYYYWWWWYDD ','  DRDYYYYWWWYD  ','  DRDOOYYWWYOD  ','   DRDOOOOOODD  ','    DDDDDDDD    ','                '],
    ['       DD       ','    DD DRRD     ','   DRRDDROODD   ','  DRRDDRRYOORD  ','  DRD DDRYYOORD ','  DD  DRRYYODD  ','     DDRROYYOD  ',' DRDDDDROOYYYOD ',' DROOOYYYYWWYOD ',' DROYYYYWWWWYOD ',' DDRRYYWWWWYYDD ','  DRDYYYWWWYD   ','  DRDOOYYWWYOD  ','   DRDOOOOODD   ','    DDDDDDDD    ','                '],
    ['       DD       ','    DD DRRD     ','   DRRDDROODD   ','  DRRDDRRYOORD  ','  DRD DDRYYOORD ','  DD  DRRYYODD  ','     DDRROYYOD  ',' DRDDDDROOYYYOD ',' DROOOYYYYWWYOD ',' DROYYYYWWWWYOD ',' DDRRYYWWWWYYDD ','  DRDYYYWWWYD   ','  DRDOOYYWWYOD  ','   DRDOOOOODD   ','    DDDDDDDD    ','                '],
    ['       DDD      ','    DD DRRD     ','   DRRDDRRODD   ','  DRRDDRRROORD  ','  DRD DDRYYOORD ','   DDDRRYYYOODD ','   DDDDRRYYOOD  ',' DRDDDDROYYYYOD ',' DROOOOYYYYWYOD ',' DROYYYYWWWWYOD ',' DDDRYYYWWWWYDD ','  DRDYYYYWWWYD  ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['    DD  DD      ','   DRRDRRRD     ','   DRRDROOODD   ','  DD DDRYYOORD  ','     DDRYYYOORD ','    DDRRYYYODD  ','   DDRROOYYYOD  ',' DRDDDROOYYYYOD ',' DROOYYYYWWYYOD ',' DDRYYYYWWWWYDD ','  DRYYWWWWWYD   ','  DRDYYWWWYOD   ','  DRDOOYYYYOD   ','   DRDOOOOODD   ','    DDDDDDDD    ','                '],
    ['        DD      ','       DRRD     ','    DD DROODD   ','   DRRDDRROORD  ','  DRRDDRROOORD  ','  DRDDDRRYYOODD ','   DDDDRRYYOODD ','  RDDDDROYYYYOD ',' DROOOOYYYYYOOD ','  ROOYYYYWWYODD ',' DDDRYYYWWWWYDD ','  DRDYYYYWWWYD  ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['       DDD      ','    DD DRRD     ','   DRRDDRRODD   ','  DRRDDROOORDD  ','  DRDDRROOORRD  ','  DDDDDRRYYOODD ',' DRDDDDROYYYOOD ',' DROOOOYYYYYYOD ',' DROOYYYYWWYODD ','  ROYYYYWWWWYOD ',' DDDRYYYWWWWYDD ','  DRDYYYWWWYDD  ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['       DDD      ','    DD DRRD     ','   DRRDDRRODD   ','  DRRDDRRYOORD  ','  DRRDDRYYOORD  ','  DRD DDRYYODD  ','  DDDDDRROYYOD  ',' DRDDDDROYYYYOD ',' DROOOYYYYWWYOD ',' DROYYYYWWWWYOD ',' DDDRYYWWWWYDD  ','  DRDYYYWWWYD   ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['       DDD      ','    D DRRRD     ','   DRDDRROODD   ','  DRRDDRRYOORD  ','  DRRDDRYYOORD  ','  DRD DDRYYODD  ','  DDDDDRROYYOD  ',' DRDDDDROYYYYOD ',' DROOOYYYYWWYOD ',' DROYYYYWWWWYOD ',' DDDRYYWWWWYDD  ','  DRDYYYWWWYD   ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['        DD      ','       DRRD     ','    DD DRDODD   ','   DRRDDRROORD  ','  DRRDDRROOORD  ','  DRD DRRYOODDD ','  DDDDDRRYYOODD ',' DRDDDDDROYYYOD ',' DROOOOYYYYYOOD ',' DROOYYYYWWYODD ',' DDDRYYYWWWWYDD ','  DRDYYYYWWWYD  ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
];

const BLUE_FRAMES = [
    ['        DD      ','       DRRD     ','    DD DRDODD   ','   DRRDDRROORD  ','  DRRDDRROOORD  ','  DRD DRRYOODDD ','  DDDDDRRYYOODD ',' DRDDDDDROYYYOD ',' DROOOYYYYWYYOD ',' DROOYYYYWWWYOD ',' DDDRYYYWWWWYDD ','  DRDYYYYWWWYD  ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['        DD      ','       DRRD     ','    DD DROODD   ','   DRRDDRROORD  ','  DRRDDRROOORD  ','  DRDDDRRYYOODD ','  DDDDDRRYYOODD ',' DRDDDDROYYYYOD ',' DROOOYYYYWYYOD ',' DROOYYYYWWWYOD ',' DDDRYYYWWWWYDD ','  DRDYYYYWWWYD  ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['       DD       ','      DDRRD     ','    DD DROODD   ','   DRRDDRROORD  ','  DRRDDRRYOORD  ','  DRD DDRYYOODD ','   DDDDRRYYOOD  ',' DRDDDDROOYYYOD ',' DROOOYYYYWWYOD ',' DROYYYYWWWWYOD ',' DDRRYYYWWWWYDD ','  DRDYYYYWWWYD  ','  DRDOOYYWWYOD  ','   DRDOOOOOODD  ','    DDDDDDDD    ','                '],
    ['       DD       ','    DD DRRD     ','   DRRDDROODD   ','  DRRDDRRYOORD  ','  DRD DDRYYOORD ','  DD  DRRYYODD  ','     DDRROYYOD  ',' DRDDDDROOYYYOD ',' DROOOYYYYWWYOD ',' DROYYYYWWWWYOD ',' DDRRYYWWWWYYDD ','  DRDYYYWWWYD   ','  DRDOOYYWWYOD  ','   DRDOOOOODD   ','    DDDDDDDD    ','                '],
    ['       DDD      ','    DD DRRD     ','   DRRDDRRODD   ','  DRRDDRRROORD  ','  DRD DDRYYOORD ','   DDDRRYYYOODD ','   DDDDRRYYOOD  ',' DRDDDDROYYYYOD ',' DROOOOYYYYWYOD ',' DROYYYYWWWWYOD ',' DDDRYYYWWWWYDD ','  DRDYYYYWWWYD  ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['    DD  DD      ','   DRRDRRRD     ','   DRRDROOODD   ','  DD DDRYYOORD  ','     DDRYYYOORD ','    DDRRYYYODD  ','   DDRROOYYYOD  ',' DRDDDROOYYYYOD ',' DROOYYYYWWYYOD ',' DDRYYYYWWWWYDD ','  DRYYWWWWWYD   ','  DRDYYWWWYOD   ','  DRDOOYYYYOD   ','   DRDOOOOODD   ','    DDDDDDDD    ','                '],
    ['        DD      ','       DRRD     ','    DD DROODD   ','   DRRDDRROORD  ','  DRRDDRROOORD  ','  DRDDDRRYYOODD ','   DDDDRRYYOODD ','  RDDDDROYYYYOD ',' DROOOOYYYYYOOD ','  ROOYYYYWWYODD ',' DDDRYYYWWWWYDD ','  DRDYYYYWWWYD  ','   RDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['       DDD      ','    DD DRRD     ','   DRRDDRRODD   ','  DRRDDROOORDD  ','  DRDDRROOORRD  ','  DDDDDRRYYOODD ',' DRDDDDROYYYOOD ',' DROOOOYYYYYYOD ',' DROOYYYYWWYODD ','  ROYYYYWWWWYOD ',' DDDRYYYWWWWYDD ','  DRDYYYWWWYDD  ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['       DDD      ','    D DRRRD     ','   DRDDRROODD   ','  DRRDDRRYOORD  ','  DRRDDRYYOORD  ','  DRD DDRYYODD  ','  DDDDDRROYYOD  ',' DRDDDDROYYYYOD ',' DROOOYYYYWWYOD ',' DROYYYYWWWWYOD ',' DDDRYYWWWWYDD  ','  DRDYYYWWWYD   ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['        DD      ','       DRRD     ','    DD DRDODD   ','   DRRDDRROORD  ','  DRRDDRROOORD  ','  DRD DRRYOODDD ','  DDDDDRRYYOODD ',' DRDDDDDROYYYOD ',' DROOOYYYYWWYOD ',' DROYYYYWWWWYOD ',' DDDRYYWWWWYDD  ','  DRDYYYWWWYD   ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
];

const PURPLE_FRAMES = [
    ['        DD      ','       DRRD     ','    DD DRDODD   ','   DRRDDRROORD  ','  DRRDDRROOORD  ','  DRD DRRYOODDD ','  DDDDDRRYYOODD ',' DRDDDDDROYYYOD ',' DROOOOYYYYYOOD ',' DROOYYYYWWYODD ',' DDDRYYYWWWWYDD ','  DRDYYYYWWWYD  ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['        DD      ','       DRRD     ','    DD DROODD   ','   DRRDDRROORD  ','  DRRDDRROOORD  ','  DRDDDRRYYOODD ','  DDDDDRRYYOODD ',' DRDDDDROYYYYOD ',' DROOOYYYYWYYOD ',' DROOYYYYWWWYOD ',' DDDRYYYWWWWYDD ','  DRDYYYYWWWYD  ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['       DD       ','      DDRRD     ','    DD DROODD   ','   DRRDDRROORD  ','  DRRDDRRYOORD  ','  DRD DDRYYOODD ','   DDDDRRYYOOD  ',' DRDDDDROOYYYOD ',' DROOOYYYYWWYOD ',' DROYYYYWWWWYOD ',' DDRRYYYWWWWYDD ','  DRDYYYYWWWYD  ','  DRDOOYYWWYOD  ','   DRDOOOOOODD  ','    DDDDDDDD    ','                '],
    ['       DD       ','    DD DRRD     ','   DRRDDROODD   ','  DRRDDRRYOORD  ','  DRD DDRYYOORD ','  DD  DRRYYODD  ','     DDRROYYOD  ',' DRDDDDROOYYYOD ',' DROOOYYYYWWYOD ',' DROYYYYWWWWYOD ',' DDRRYYWWWWYYDD ','  DRDYYYWWWYD   ','  DRDOOYYWWYOD  ','   DRDOOOOODD   ','    DDDDDDDD    ','                '],
    ['       DDD      ','    DD DRRD     ','   DRRDDRRODD   ','  DRRDDRRROORD  ','  DRD DDRYYOORD ','   DDDRRYYYOODD ','   DDDDRRYYOOD  ',' DRDDDDROYYYYOD ',' DROOOOYYYYWYOD ',' DROYYYYWWWWYOD ',' DDDRYYYWWWWYDD ','  DRDYYYYWWWYD  ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['    DD  DD      ','   DRRDRRRD     ','   DRRDROOODD   ','  DD DDRYYOORD  ','     DDRYYYOORD ','    DDRRYYYODD  ','   DDRROOYYYOD  ',' DRDDDROOYYYYOD ',' DROOYYYYWWYYOD ',' DDRYYYYWWWWYDD ','  DRYYWWWWWYD   ','  DRDYYWWWYOD   ','  DRDOOYYYYOD   ','   DRDOOOOODD   ','    DDDDDDDD    ','                '],
    ['        DD      ','       DRRD     ','    DD DROODD   ','   DRRDDRROORD  ','  DRRDDRROOORD  ','  DRDDDRRYYOODD ','   DDDDRRYYOODD ','  RDDDDROYYYYOD ',' DROOOOYYYYYOOD ','  ROOYYYYWWYODD ',' DDDRYYYWWWWYDD ','  DRDYYYYWWWYD  ','   RDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['       DDD      ','    DD DRRD     ','   DRRDDRRODD   ','  DRRDDROOORDD  ','  DRDDRROOORRD  ','  DDDDDRRYYOODD ',' DRDDDDROYYYOOD ',' DROOOOYYYYYYOD ',' DROOYYYYWWYODD ','  ROYYYYWWWWYOD ',' DDDRYYYWWWWYDD ','  DRDYYYWWWYDD  ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['       DDD      ','    D DRRRD     ','   DRDDRROODD   ','  DRRDDRRYOORD  ','  DRRDDRYYOORD  ','  DRD DDRYYODD  ','  DDDDDRROYYOD  ',' DRDDDDROYYYYOD ',' DROOOYYYYWWYOD ',' DROYYYYWWWWYOD ',' DDDRYYWWWWYDD  ','  DRDYYYWWWYD   ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
    ['        DD      ','       DRRD     ','    DD DRDODD   ','   DRRDDRROORD  ','  DRRDDRROOORD  ','  DRD DRRYOODDD ','  DDDDDRRYYOODD ',' DRDDDDDROYYYOD ',' DROOOOYYYYYOOD ',' DROOYYYYWWYODD ',' DDDRYYYWWWWYDD ','  DRDYYYYWWWYD  ','  DRDOOYYWWYOD  ','   DRDOOOOOOD   ','    DDDDDDDD    ','                '],
];

const fireConfigs = {
    yellow: {
        palette: { 'D': '#780000', 'R': '#E63200', 'O': '#FF8A1F', 'Y': '#FFEC2B', 'W': '#FFFFFF' },
        frames: YELLOW_FRAMES,
        intensities: [0.62, 0.70, 0.66, 0.76, 0.82, 1.00, 0.84, 0.90, 0.68, 0.62],
        glow: (i) => {
            const s1 = Math.round(16 + 20 * i), o1 = (0.38 + 0.54 * i).toFixed(2);
            const s2 = Math.round(30 + 32 * i), o2 = (0.22 + 0.36 * i).toFixed(2);
            const s3 = Math.round(48 + 47 * i), o3 = (0.08 + 0.30 * i).toFixed(2);
            return `drop-shadow(0 0 ${s1}px rgba(230,50,0,${o1})) drop-shadow(0 0 ${s2}px rgba(255,138,31,${o2})) drop-shadow(0 0 ${s3}px rgba(255,175,35,${o3}))`;
        }
    },
    blue: {
        palette: { 'D': '#001a33', 'R': '#0055aa', 'O': '#00aaff', 'Y': '#99eeff', 'W': '#ffffff' },
        frames: BLUE_FRAMES,
        intensities: [0.62, 0.70, 0.66, 0.76, 0.82, 1.00, 0.84, 0.90, 0.68, 0.62],
        glow: (i) => {
            const s1 = Math.round(16 + 29 * i), o1 = (0.40 + 0.55 * i).toFixed(2);
            const s2 = Math.round(30 + 48 * i), o2 = (0.25 + 0.40 * i).toFixed(2);
            const s3 = Math.round(48 + 72 * i), o3 = (0.10 + 0.35 * i).toFixed(2);
            return `drop-shadow(0 0 ${s1}px rgba(0,85,170,${o1})) drop-shadow(0 0 ${s2}px rgba(0,170,255,${o2})) drop-shadow(0 0 ${s3}px rgba(100,200,255,${o3}))`;
        }
    },
    purple: {
        palette: { 'D': '#1a0033', 'R': '#5500aa', 'O': '#aa00ff', 'Y': '#dd99ff', 'W': '#ffffff' },
        frames: PURPLE_FRAMES,
        intensities: [0.62, 0.70, 0.66, 0.76, 0.82, 1.00, 0.84, 0.90, 0.68, 0.62],
        glow: (i) => {
            const s1 = Math.round(20 + 34 * i), o1 = (0.45 + 0.55 * i).toFixed(2);
            const s2 = Math.round(40 + 53 * i), o2 = (0.30 + 0.45 * i).toFixed(2);
            const s3 = Math.round(60 + 83 * i), o3 = (0.12 + 0.38 * i).toFixed(2);
            return `drop-shadow(0 0 ${s1}px rgba(85,0,170,${o1})) drop-shadow(0 0 ${s2}px rgba(170,0,255,${o2})) drop-shadow(0 0 ${s3}px rgba(200,100,255,${o3}))`;
        }
    }
};

function spawnParticles(config) {
    const baseCount = Math.floor(Math.random() * 4);
    const count = window.overheatChaos ? baseCount * 3 : baseCount;
    for (let i = 0; i < count; i++) {
        const spawnX = 4.5 + Math.random() * 7;
        const spawnY = 0.5 + Math.random() * 5.5;
        const roll = Math.random();
        let color;
        if (window.overheatChaos) {
            if (roll < 0.3) color = 'W';
            else if (roll < 0.7) color = 'Y';
            else color = 'O';
        } else {
            if (roll < 0.06) color = 'W';
            else if (roll < 0.40) color = 'Y';
            else if (roll < 0.75) color = 'O';
            else color = 'R';
        }
        const vx = (Math.random() - 0.48) * 0.45 * (window.overheatChaos ? 3 : 1);
        const vy = -(0.18 + Math.random() * 0.7) * (window.overheatChaos ? 3 : 1);
        particles.push({
            x: spawnX, y: spawnY,
            vx, vy,
            life: 10 + Math.floor(Math.random() * 22),
            maxLife: 10 + Math.floor(Math.random() * 22),
            color: color
        });
    }
}

function updateParticles(config) {
    for (let p of particles) {
        p.x += p.vx; p.y += p.vy; p.life--;
        const frac = p.life / p.maxLife;
        if (frac < 0.15 && p.color === 'R') p.color = 'D';
        else if (frac < 0.30 && p.color === 'O') p.color = 'R';
        else if (frac < 0.45 && p.color === 'Y') p.color = 'O';
        else if (frac < 0.55 && p.color === 'W') p.color = 'Y';
    }
    particles = particles.filter(p => p.life > 0 && p.y >= -2 && p.y < 18 && p.x >= -2 && p.x < 18 && config.palette[p.color]);
}

function drawParticles(config, ctx) {
    if (!ctx) return;
    for (let p of particles) {
        const gx = Math.round(p.x), gy = Math.round(p.y);
        if (gx >= 0 && gx < 16 && gy >= 0 && gy < 16 && config.palette[p.color]) {
            ctx.fillStyle = config.palette[p.color];
            ctx.fillRect(gx, gy, 1, 1);
        }
    }
}

function getConfigForStreak(streak) {
    if (streak >= 5) return fireConfigs.purple;
    if (streak >= 3) return fireConfigs.blue;
    if (streak >= 1) return fireConfigs.yellow;
    return null;
}

// Resolve the currently-visible streak canvas on demand.
//
// The standard Question Practice modal (#practice-modal in index.html) ships a
// permanent <canvas id="streak-canvas"> that is merely hidden via display:none
// when the modal is closed. The SR practice drawer (matrix.js) injects a SECOND
// element with the same id while it is open and removes it again on close.
// getElementById() always returns the first match in document order, so we fall
// back to querySelectorAll('#streak-canvas') and pick the first instance whose
// layout box is actually visible (offsetParent !== null). This lets a single
// renderLoop drive the pixel flame regardless of which practice surface is on
// screen, with zero stale references.
function _resolveActiveStreakCanvas() {
    let canvas = document.getElementById('streak-canvas');
    if (canvas && canvas.offsetParent !== null) return canvas;
    // Either no canvas at all, or the first match is hidden — scan all matches.
    const all = document.querySelectorAll('#streak-canvas');
    for (const c of all) {
        if (c.offsetParent !== null) return c;
    }
    // No visible canvas. Return the first match (if any) so callers can detect
    // "element exists but hidden" vs "element missing entirely" if they need to.
    return canvas || null;
}

function renderLoop(timestamp) {
    // Dynamically resolve the streak canvas on EVERY frame. The SR practice
    // drawer constructs/destroys its DOM on invocation, so any cached reference
    // would go stale.
    const streakCanvas = _resolveActiveStreakCanvas();
    if (!streakCanvas || streakCanvas.offsetParent === null) {
        // No visible canvas on this tick — clear old animation metrics
        // gracefully and await the next frame execution.
        particles = [];
        currentFrame = 0;
        lastTime = 0;
        currentIntensity = 0.62;
        _streakRafScheduled = true;
        requestAnimationFrame(renderLoop);
        return;
    }
    const streakCtx = streakCanvas.getContext('2d');
    if (!streakCtx) {
        _streakRafScheduled = true;
        requestAnimationFrame(renderLoop);
        return;
    }

    const config = getConfigForStreak(AppState.practiceCorrectStreak);
    if (!config) {
        streakCtx.clearRect(0, 0, 16, 16);
        streakCanvas.style.filter = 'none';
        particles = [];
        lastTime = timestamp;
        _streakRafScheduled = true;
        requestAnimationFrame(renderLoop);
        return;
    }
    if (!lastTime) lastTime = timestamp;
    const elapsed = timestamp - lastTime;
    const currentDelay = window.overheatChaos ? 50 : 160;
    if (elapsed >= currentDelay) {
        lastTime = timestamp;
        currentFrame = (currentFrame + 1) % config.frames.length;
        const targetIntensity = config.intensities[currentFrame];
        currentIntensity = currentIntensity * 0.3 + targetIntensity * 0.7;

        streakCanvas.style.filter = config.glow(currentIntensity);
        streakCtx.clearRect(0, 0, 16, 16);
        const frameData = config.frames[currentFrame];
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
            const ch = frameData[y][x];
            if (ch !== ' ') {
                streakCtx.fillStyle = config.palette[ch];
                streakCtx.fillRect(x, y, 1, 1);
            }
        }
        spawnParticles(config);
        updateParticles(config);
        drawParticles(config, streakCtx);
    }
    _streakRafScheduled = true;
    requestAnimationFrame(renderLoop);
}

// Kick off the render loop unconditionally — it self-gates when no visible
// canvas exists, so there is no cost to running it before any drawer/modal opens.
if (!_streakRafScheduled) {
    _streakRafScheduled = true;
    requestAnimationFrame(renderLoop);
}

export function updateStreakVisualizer() {
    const numberEl = document.getElementById('streak-number');
    if (numberEl) numberEl.textContent = AppState.practiceCorrectStreak;
}

export function activateOverheat() {
    if (overheatActive) return;
    overheatActive = true;
    overheatUsed = false;
    overheatUntil = Date.now() + 300000;
    document.body.classList.add('overheat-active');
    window.overheatChaos = true;
    if (overheatTimeout) clearTimeout(overheatTimeout);
    overheatTimeout = setTimeout(deactivateOverheat, 300000);
}

export function deactivateOverheat() {
    overheatActive = false;
    overheatUntil = null;
    overheatUsed = false;
    document.body.classList.remove('overheat-active');
    window.overheatChaos = false;
    if (overheatTimeout) {
        clearTimeout(overheatTimeout);
        overheatTimeout = null;
    }
}

// ==================== IIFE PATCHES ====================
// Patch practiceSubmit to add celebration effects and streak logic
(function () {
    const originalSubmit = practiceSubmit;
    practiceSubmit = function () {
        const wasUnsolved = AppState.currentQ && AppState.currentQ.status === 'unsolved';
        const wasSolved = AppState.currentQ && AppState.currentQ.status === 'solved';

        originalSubmit();

        const statusNow = AppState.currentQ && AppState.currentQ.status;

        const isWrong = (wasUnsolved && statusNow !== 'solved' && statusNow !== 'unsolved') ||
            ['wrong', 'incorrect', 'error', 'failed', 'missed'].includes(statusNow);

        if (isWrong) {
            changeCount(AppState.currentQ.subject, 1);
            triggerRedFlash();
            playWrongSound();

            if (Math.random() < 0.2) {
                triggerStreakShield();
            } else {
                AppState.practiceCorrectStreak = 0;
            }
        }
        else if (statusNow === 'solved' && !wasSolved) {
            AppState.practiceCorrectStreak++;

            if (window._justWonBounty) {
                window._justWonBounty = false;
                showNormalGlow();
            } else if (overheatActive && !overheatUsed) {
                changeCount(AppState.currentQ.subject, 2);
                showSupercharged();
                overheatUsed = true;
                deactivateOverheat();
            } else if (AppState.bounty && AppState.bounty.payoffCount > 0) {
                AppState.bounty.payoffCount--;
                saveAllAsync().catch(console.error);
                showSupercharged();
            } else {
                showNormalGlow();
                playCorrectSound();
                if (Math.random() < 0.15) {
                    showSupercharged();
                }
            }
        }

        updateStreakVisualizer();
    };
})();

// Patch addTextQuestionFollowUp to add effects
(function () {
    const originalFollowUp = addTextQuestionFollowUp;
    addTextQuestionFollowUp = function () {
        originalFollowUp();

        const correctBtn = document.getElementById('text-correct-btn');
        const wrongBtn = document.getElementById('text-wrong-btn');

        if (correctBtn) {
            const originalCorrectClick = correctBtn.onclick;
            correctBtn.onclick = () => {
                if (originalCorrectClick) originalCorrectClick();
                AppState.practiceCorrectStreak++;

                if (window._justWonBounty) {
                    window._justWonBounty = false;
                    showNormalGlow();
                } else if (AppState.bounty.payoffCount > 0) {
                    AppState.bounty.payoffCount--;
                    saveAllAsync().catch(console.error);
                    const rect = correctBtn.getBoundingClientRect();
                    burstEmojis(rect.left + rect.width / 2, rect.top + rect.height / 2, 40,
                        ['🎉', '😄', '🔥', '✨', '🥳', '🎊', '💯', '🌟', '😎', '🏆'], 1.6);
                    playSuperSound();
                    const glow = document.createElement('div');
                    glow.className = 'supercharged-glow-overlay';
                    document.body.appendChild(glow);
                    glow.addEventListener('animationend', () => glow.remove());
                } else {
                    showNormalGlow();
                    playCorrectSound();
                    if (overheatActive && !overheatUsed) {
                        // keep existing overheat logic
                    } else {
                        if (Math.random() < 0.15) {
                            // keep existing 15% logic
                        }
                    }
                }
                updateStreakVisualizer();
            };
        }

        if (wrongBtn) {
            const originalWrongClick = wrongBtn.onclick;
            wrongBtn.onclick = () => {
                if (AppState.currentQ && AppState.currentQ.status === 'unsolved') {
                    changeCount(AppState.currentQ.subject, 1);
                }
                triggerRedFlash();
                playWrongSound();

                if (Math.random() < 0.2) {
                    triggerStreakShield();
                } else {
                    AppState.practiceCorrectStreak = 0;
                }
                updateStreakVisualizer();

                if (originalWrongClick) originalWrongClick();
            };
        }
    };
})();

updateStreakVisualizer();

// ==================== INITIALIZATION ====================
async function initApp() {
    // Register UI callbacks so storage.js can call back into app.js
    registerUiCallbacks({
        lockTargetsOnly,
        updateUI,
        updateStudyTimeHeader: () => {
            import('./pomodoro.js').then(m => m.updateStudyTimeHeader());
        },
        renderGraph,
        renderErrorMatrixFromBank: () => {
            import('./matrix.js').then(m => m.renderErrorMatrixFromBank());
        },
    });

    await loadDataAsync();

    // Check active target locks
    const lockDate = await idbGet('jeeTargetLockDate');
    if (lockDate) {
        const diff = (new Date() - new Date(lockDate)) / (1000 * 60 * 60 * 24);
        if (diff < 1) lockTargetsOnly();
    }

    // Set daily output target inputs
    document.getElementById('set-tgt-phys').value = baseTargets.physics;
    document.getElementById('set-tgt-chem').value = baseTargets.chemistry;
    document.getElementById('set-tgt-math').value = baseTargets.maths;

    // NEW: load and set error resolution target inputs
    const errPhys = await idbGet('baseErrPhys') ?? 5;
    const errChem = await idbGet('baseErrChem') ?? 5;
    const errMath = await idbGet('baseErrMath') ?? 5;
    baseErrorTargets.physics = errPhys;
    baseErrorTargets.chemistry = errChem;
    baseErrorTargets.maths = errMath;
    const errPhysIn = document.getElementById('set-err-phys');
    const errChemIn = document.getElementById('set-err-chem');
    const errMathIn = document.getElementById('set-err-math');
    if (errPhysIn) errPhysIn.value = errPhys;
    if (errChemIn) errChemIn.value = errChem;
    if (errMathIn) errMathIn.value = errMath;

    // Verify calibration timeline
    // Verify calibration timeline
    const todayStr = new Date().toISOString().split('T')[0];
    const lastCalDate = await idbGet('jeemax_last_calibrated_date');
    
    if (lastCalDate === todayStr) {
        AppState.activeTargets.physics = Math.round(baseTargets.physics * AppState.moodMultiplier);
        AppState.activeTargets.chemistry = Math.round(baseTargets.chemistry * AppState.moodMultiplier);
        AppState.activeTargets.maths = Math.round(baseTargets.maths * AppState.moodMultiplier);
    } else {
        // ── CRITICAL: PREVENT LIQUIDATION REFLEX EXPLOIT ON REFRESH ──
        // Using a distinct calendar check ensures the 20 ELO penalty executes exactly once 
        // per daily transition, even if you reload the interface before closing the mood modal.
        const lastTaxDate = await idbGet('jeemax_last_tax_date');
        
        if (lastTaxDate !== todayStr) {
            // Extract baseline question deficits relative to previous targets
            const defP = Math.max(0, (AppState.activeTargets.physics || 0) - (solved.physics || 0));
            const defC = Math.max(0, (AppState.activeTargets.chemistry || 0) - (solved.chemistry || 0));
            const defM = Math.max(0, (AppState.activeTargets.maths || 0) - (solved.maths || 0));
            const totalDeficit = defP + defC + defM;

            if (totalDeficit > 0) {
                // Calculate proportional distribution allocations
                const taxP = (defP / totalDeficit) * 20;
                const taxC = (defC / totalDeficit) * 20;
                const taxM = (defM / totalDeficit) * 20;

                // Mutate the localized subject ELO ratings in-place (Clamped at absolute zero)
                AppState.elo.physics = Math.max(0, (AppState.elo.physics || 1200) - taxP);
                AppState.elo.chemistry = Math.max(0, (AppState.elo.chemistry || 1200) - taxC);
                AppState.elo.maths = Math.max(0, (AppState.elo.maths || 1200) - taxM);

                // Recompute the master global meta-MMR rating using the updated parameters
                AppState.elo.global = _computeGlobalMetaMMR(
                    AppState.elo.physics,
                    AppState.elo.chemistry,
                    AppState.elo.maths
                );

                // Mount hard UI notification alert immediately into the telemetry header
                const catText = document.getElementById('cat-text');
                if (catText) {
                    catText.textContent = `🚨 TARGET LIQUIDATION: You missed yesterday's focus vectors by ${totalDeficit} questions. 20 total ELO has been extracted from your build.`;
                    catText.className = "cat-text glow-red";
                }
            }
            // Commit structural tax state signature timestamp to storage
            await idbSet('jeemax_last_tax_date', todayStr);
        }

        // Flush tracking parameters for the new daily matrix cycle
        solved.physics = 0;
        solved.chemistry = 0;
        solved.maths = 0;
        studySecs.physics = 0;
        studySecs.chemistry = 0;
        studySecs.maths = 0;
        
        await saveAllAsync().catch(console.error);
        openModal('mood-modal');
    }

    document.getElementById('vis-beaker').style.display = 'none';
    document.getElementById('vis-bar').style.display = 'block';

    const d = new Date();
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    document.getElementById('top-date').textContent =
        `${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;

    await renderGraph();
    updateUI();
    resetPomoUI();
    updateStreakVisualizer();

    // ── Cognitive MMR Matrix: explicit initial hydration. updateUI() above
    // already calls renderEloMatrix(), but we re-run it here after the full
    // init pipeline so the profile row + subject monitors are guaranteed to
    // exist even if the dashboard DOM wasn't fully painted during updateUI. ──
    try { renderEloMatrix(); } catch (_) { /* never block initApp */ }

    // NEW: initialise the error resolution dashboard once data is ready
    renderErrorResolutionDashboard();
    if (typeof renderMomentumCandles === 'function') renderMomentumCandles();

    // Listen for Protocol Zero penalty events from checkpoint.js → re-render
    // the main predictive graph so the red valley appears immediately.
    window.addEventListener('checkpoint:penalty', function () {
        if (typeof renderGraph === 'function') renderGraph();
        if (typeof renderErrorResolutionDashboard === 'function') renderErrorResolutionDashboard();
        if (typeof renderMomentumCandles === 'function') renderMomentumCandles();
    });

    // Initialize Google Drive
    await initDrive();

    // ── Global KaTeX Rendering Engine ───────────────────────────────────
    // Activate the live DOM watchdog. Every subsequent DOM mutation
    // (practice modals, solution popups, dashboards, banners, etc.) is
    // scanned for $...$ / $$...$$ math fragments and hydrated automatically.
    // The one-shot body sweep below catches content rendered earlier in
    // initApp() before the observer was attached.
    globalMathObserver.observe(document.body, { childList: true, subtree: true });
    processElementMath(document.body);
}

document.addEventListener('DOMContentLoaded', initApp);


// ==================== WINDOW GLOBAL WIRING ====================
window.switchTab = switchTab;
window.toggleSidebar = toggleSidebar;
window.openModal = openModal;
window.closeModal = closeModal;
window.closeModalStr = closeModalStr;
window.openBountyModal = openBountyModal;
window.tryAssignDailyBounty = tryAssignDailyBounty;
window.evaluateBountyOutcome = evaluateBountyOutcome;
window.startBountySessionFromModal = startBountySessionFromModal;
window.calibrateMood = calibrateMood;
window.changeCount = changeCount;
window.updateUI = updateUI;
window.renderGraph = renderGraph;
window.openErrorMatrix = openErrorMatrix;
window.deleteError = removeErrorLog;
window.filterErrors = filterErrors;
window.addErrorBlock = addErrorBlock;
window.openLightbox = openLightbox;

// ── Practice-Image Pinch-to-Zoom Lightbox ───────────────────────────────
// Hardware-accelerated, full-screen overlay for inspecting practice question
// images. Supports two-finger pinch-zoom (scale 0.75–8×) and single-pointer
// drag-pan via the Pointer Events API. Mounted on demand and torn down on
// close; no persistent DOM footprint.
window.openPracticeImageLightbox = function(src) {
    if (!src) return;
    const old = document.getElementById('practice-image-lightbox');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'practice-image-lightbox';
    Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '1000000',
        background: 'rgba(9, 9, 11, 0.96)', backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none'
    });

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    Object.assign(closeBtn.style, {
        position: 'absolute', top: '24px', right: '24px', zIndex: '1000002',
        width: '44px', height: '44px', borderRadius: '50%', border: 'none',
        background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: '20px',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
    });
    closeBtn.onclick = () => overlay.remove();

    const img = document.createElement('img');
    img.src = src;
    Object.assign(img.style, {
        maxWidth: '95vw', maxHeight: '95vh', objectFit: 'contain',
        transformOrigin: 'center center', transition: 'transform 0.05s linear',
        willChange: 'transform'
    });

    overlay.appendChild(closeBtn);
    overlay.appendChild(img);
    document.documentElement.appendChild(overlay);

    let evHistory = [];
    let prevDist = -1;
    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let startX = 0, startY = 0;

    overlay.onpointerdown = (e) => {
        evHistory.push(e);
        if (evHistory.length === 1) {
            isDragging = true;
            startX = e.clientX - translateX;
            startY = e.clientY - translateY;
        }
    };

    overlay.onpointermove = (e) => {
        for (let i = 0; i < evHistory.length; i++) {
            if (evHistory[i].pointerId === e.pointerId) {
                evHistory[i] = e;
                break;
            }
        }

        if (evHistory.length === 2) {
            isDragging = false;
            const dx = evHistory[0].clientX - evHistory[1].clientX;
            const dy = evHistory[0].clientY - evHistory[1].clientY;
            const curDist = Math.hypot(dx, dy);

            if (prevDist > 0) {
                const delta = curDist / prevDist;
                scale = Math.max(0.75, Math.min(8, scale * delta));
                img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
            }
            prevDist = curDist;
        } 
        else if (evHistory.length === 1 && isDragging) {
            translateX = e.clientX - startX;
            translateY = e.clientY - startY;
            img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        }
    };

    const removePointer = (e) => {
        evHistory = evHistory.filter(ev => ev.pointerId !== e.pointerId);
        if (evHistory.length < 2) prevDist = -1;
        if (evHistory.length === 0) isDragging = false;
    };

    overlay.onpointerup = removePointer;
    overlay.onpointercancel = removePointer;
    overlay.onpointerleave = removePointer;
};
window.previewImage = previewImage;
window.saveProfile = saveProfile;
window.saveTargets = saveTargets;
window.testGeminiKey = testGeminiKey;
window.toggleVisualizer = toggleVisualizer;
window.startTimer = startTimer;
window.pauseTimer = pauseTimer;
window.resumeTimer = resumeTimer;
window.quitTimer = quitTimer;
window.skipBreak = skipBreak;
window.addBreakTime = addBreakTime;
window.shiftMonth = shiftMonth;
window.toggleMcqOption = toggleMcqOption;
window.escapeAttribute = escapeAttribute;
window.renderCalendar = renderCalendar;
window.selectSubject = selectSubject;
window.goToSubjects = goToSubjects;
window.goToChapters = goToChapters;
window.goToChapterDetail = goToChapterDetail;
window.openChapterDetail = openChapterDetail;
window.deleteChapter = deleteChapter;
window.addChapter = addChapter;
window.startManualCrop = startManualCrop;
window.confirmMultiCropQuestion = confirmMultiCropQuestion;
window.nextQuestionInSession = nextQuestionInSession;
window.finishAllQuestions = finishAllQuestions;
window.cancelCropSession = cancelCropSession;
window.clearLastSegment = clearLastSegment;
window.closeCropModal = closeCropModal;
window.extractTextForAll = extractTextForAll;
window.processAnswerKey = processAnswerKey;
window.processAnswerKeyFromText = processAnswerKeyFromText;
window.saveAllQuestions = saveAllQuestions;
window.showPreviewModal = showPreviewModal;
window.showQuestionList = showQuestionList;

// ── Surgical File Upload Bindings for Text-Track Diagram Synchronization ──
window.processGemTextDump = processGemTextDump;
window.switchIngestionTrack = switchIngestionTrack;

window.triggerSurgicalDiagramUpload = function(index) {
    const dynamicInput = document.createElement('input');
    dynamicInput.type = 'file';
    dynamicInput.accept = 'image/*';
    dynamicInput.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        // Read the source textbook sheet as a Base64 data URL. Instead of
        // pasting the whole uncropped image directly into diagramImageUrl, we
        // load it into the existing #crop-modal bounding-box crop flow so the
        // user can surgically extract just the diagram region.
        showLoading('Loading source sheet into crop studio...');
        const base64String = await readFileAsBase64(file);
        hideLoading();

        // ── Seed cropSession for surgical single-crop mode ────────────────
        // Map the single uploaded image into the sourceImages array shape
        // expected by refreshCropUI() / endDraw(). Seed allQuestions with a
        // clean slate (one empty placeholder question) so the existing canvas
        // drawing / redraw machinery has a `_cq.segments` array to read from.
        // This is critical: leaving allQuestions empty would crash
        // redrawAllRectangles(), which dereferences _cq.segments.
        cropSession.surgicalTargetIdx = index;
        cropSession.sourceImages = [{ id: 0, dataUrl: base64String }];
        cropSession.allQuestions = [{ segments: [], stitchedImage: null, questionOnly: null }];
        cropSession.currentQuestionIdx = 0;
        cropSession.activeCrop = false;
        cropSession.drawing = { startX: 0, startY: 0, endX: 0, endY: 0, sourceId: null };
        cropSession.canvasRefs = {};
        cropSession.ctxRefs = {};
        cropSession.imgRefs = {};

        // ── Bug 1 fix: modal handoff (synchronous) ────────────────────
        // The crop modal and the preview modal are both full-screen flex
        // overlays. If both are visible at once, z-index layering buries
        // #crop-modal underneath #preview-modal, locking the user out of the
        // canvas. We MUST dismiss the preview modal synchronously —
        // closeModalStr() defers display='none' by 300ms for the fade-out
        // transition, which leaves both overlays capturing pointer events
        // simultaneously. forceHideModal() sets display='none' inline in a
        // single tick so the crop modal is the only overlay on stage the
        // instant it opens. showPreviewModal() is re-invoked from endDraw()
        // once the surgical crop is committed.
        forceHideModal('preview-modal');

        // Open the crop modal and let refreshCropUI() detect surgical mode
        // (via the surgicalTargetIdx flag we just set) to swap the instruction
        // copy and hide the multi-crop control row.
        const cropModal = document.getElementById('crop-modal');
        if (cropModal) {
            cropModal.style.display = 'flex';
            cropModal.classList.add('active');
        }
        refreshCropUI();
    };
    dynamicInput.click();
};

window.yeetSurgicalDiagram = function(index) {
    AppState.extractedItems[index].diagramImageUrl = null;
    showPreviewModal();
};
// Expose applyFilter globally so the inline `onchange="applyFilter()"`
// attribute on #question-filter (inside #practice-question-list-view) can
// resolve it. Without this, the function stays module-scoped and the filter
// dropdown silently no-ops.
window.applyFilter = applyFilter;
window.openEditQuestionModal = openEditQuestionModal;
window.saveEditQuestion = saveEditQuestion;
window.startPracticeWithQuestion = startPracticeWithQuestion;
window.toggleOriginalPhoto = toggleOriginalPhoto;
window.renderPracticeQuestionModal = renderPracticeQuestionModal;
window.practiceSubmit = practiceSubmit;
window.practiceNext = practiceNext;
window.practicePrev = practicePrev;
window.closePracticeModal = closePracticeModal;
window.showSolutionPopup = showSolutionPopup;
window.confirmErrorLog = confirmErrorLog;
window.removeErrorLog = removeErrorLog;
window.showPracticeSubview = showPracticeSubview;
window.renderErrorMatrixFromBank = renderErrorMatrixFromBank;
window.updateStudyTimeHeader = updateStudyTimeHeader;
window.resetPomoUI = resetPomoUI;
window.finishAll = finishAll;

window.formatTime = formatTime;
window.formatStudyDuration = formatStudyDuration;
window.assignDailyBountyIfNeeded = assignDailyBountyIfNeeded;
window.addTextQuestionFollowUp = addTextQuestionFollowUp;
window.cleanAndParseJson = cleanAndParseJson;
window.callGeminiWithFallback = callGeminiWithFallback;
window.cropImageFromBBox = cropImageFromBBox;
window.showLoading = showLoading;
window.hideLoading = hideLoading;
window.readFileAsBase64 = readFileAsBase64;
window.escapeHtml = escapeHtml;
window.saveAll = saveAllAsync;
window.loadData = loadDataAsync;
window.lockTargetsOnly = lockTargetsOnly;
window.renderChaptersList = renderChaptersList;
window.updatePracticeTimerDisplay = updatePracticeTimerDisplay;
// Backward-compatible shim — legacy callers (and any inline onclick handlers
// still wired to window.renderLatexInElement) are transparently routed
// through the new global engine instead of the deleted standalone impl.
window.renderLatexInElement = function () {
    const el = document.getElementById('latex-render');
    if (el) processElementMath(el);
};
window.deleteQuestion = deleteQuestion;
window.handleDriveAuth = handleDriveAuth;
window.updateStreakDisplay = updateStreakDisplay;
window.executeUnifiedSync = executeUnifiedSync;
window.toggleStopwatchMode = toggleStopwatchMode;
window.toggleImmersive = toggleImmersive;
window.confirmTimerNotification = confirmTimerNotification;
window.toggleMiniWidget = toggleMiniWidget;

// ── Gamification Suite · window-exposed helpers ───────────────────────────
// These ten acoustic / visual / state-mutating helpers drive the dopamine
// loops inside the standard Question Practice modal (#practice-modal). They
// are explicitly mirrored onto `window` so the Spaced Repetition practice
// drawer (matrix.js → submitPracticeLog) can invoke them through clean,
// decoupled `window.<fn>()` calls without importing app.js (which would
// create a circular module dependency: app.js imports matrix.js already).
window.triggerRedFlash = triggerRedFlash;
window.triggerStreakShield = triggerStreakShield;
window.showNormalGlow = showNormalGlow;
window.showSupercharged = showSupercharged;
window.playCorrectSound = playCorrectSound;
window.playWrongSound = playWrongSound;
window.playSuperSound = playSuperSound;
// burstEmojis is exposed so matrix.js's SR-drawer tier-transition celebration
// can fire a cascading emoji burst at a custom origin (the drawer centre)
// without routing through showSupercharged() (which adds a full-screen glow
// overlay and centres on the viewport). Sibling to playSuperSound — they are
// the canonical celebration pair.
window.burstEmojis = burstEmojis;
window.activateOverheat = activateOverheat;
window.deactivateOverheat = deactivateOverheat;
window.updateStreakVisualizer = updateStreakVisualizer;

// ── SR Practice Log Drawer globals (new) ──
window.openPracticeDrawer = openPracticeDrawer;
window.closePracticeDrawer = closePracticeDrawer;
window.submitPracticeLog = submitPracticeLog;
window.srSetResult = srSetResult;
window.srSetAutonomy = srSetAutonomy;
window.srToggleFriction = srToggleFriction;
window.srToggleStopwatch = srToggleStopwatch;
window.srToggleManualTime = srToggleManualTime;
window.srUpdateManualTime = srUpdateManualTime;
window.srSelectOption = srSelectOption;
window.srConfirmAnswer = srConfirmAnswer;
window.srSelfReport = srSelfReport;
window.srToggleImage = srToggleImage;
window.toggleCardHistory = toggleCardHistory;
window.renderErrorResolutionDashboard = renderErrorResolutionDashboard;
window.renderChapterDecayGrid = renderChapterDecayGrid;
window.renderMomentumCandles = renderMomentumCandles;

// Expose state for debugging / cross-module access
window.bounty = AppState.bounty;
window.questionBank = AppState.questionBank;
window.currentSubject = AppState.currentSubject;
window.currentChapter = AppState.currentChapter;
window.imageFetchCache = AppState.imageFetchCache;
window._pomoPendingAction = null;
window._justWonBounty = false;
window._pendingBountyId = null;
window._bountyQuestion = null;
window._bountyTimeLimit = null;
window.overheatChaos = false;

// ============================================================================
// GLOBAL KATEX RENDERING ENGINE — Automatic Math Hydration
// ============================================================================
// A single unified math parser that replaces all legacy inline KaTeX
// processing calls (renderLatexInElement, manual .mcq-option regex loops,
// showSolutionPopup string substitution, etc.). Paired with a live
// MutationObserver watchdog, any $...$ or $$...$$ fragment injected into
// the DOM — whether by practice modals, solution popups, dashboards, or
// third-party pipelines — is automatically discovered and rendered without
// any manual trigger.
//
// SAFE GUARD BOUNDARY: each processed element is stamped with
// `data-math-rendered="true"` to prevent infinite recursive observation
// loops (the observer would otherwise re-process the DOM mutations
// produced by KaTeX's own innerHTML writes).
// ============================================================================

/**
 * Recursively scan `element`'s subtree for unrendered LaTeX math fragments
 * ($$...$$ display blocks and $...$ inline spans) and hydrate them via
 * window.katex.renderToString(). Idempotent — re-invoking on an already-
 * processed element is an O(1) no-op thanks to the data-math-rendered flag.
 *
 * @param {Element} element — the DOM subtree root to scan.
 */
function processElementMath(element) {
    // ── Guards ──
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
    // Fail gracefully if KaTeX is temporarily unavailable (CDN hiccup, etc.).
    if (typeof window.katex === 'undefined' || !window.katex) return;
    // SAFE GUARD BOUNDARY: never re-process an already-rendered element.
    if (element.hasAttribute('data-math-rendered')) return;
    // Never touch KaTeX's own rendered output internals.
    if (element.closest && element.closest('.katex')) return;

    // Canonical delimiter regex (display $$...$$ first, then inline $...$).
    const MATH_REGEX = /\$\$([\s\S]+?)\$\$|\$([^\$]+)\$/g;

    try {
        // ── Collect every text node that contains at least one math fragment ──
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function (node) {
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    const tag = parent.tagName;
                    if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
                    // Skip text already inside rendered KaTeX output.
                    if (parent.closest('.katex')) return NodeFilter.FILTER_REJECT;
                    const val = node.nodeValue;
                    if (!val) return NodeFilter.FILTER_REJECT;
                    MATH_REGEX.lastIndex = 0;
                    if (!MATH_REGEX.test(val)) return NodeFilter.FILTER_REJECT;
                    MATH_REGEX.lastIndex = 0;
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        const targets = [];
        let n;
        while ((n = walker.nextNode())) targets.push(n);

        for (const textNode of targets) {
            const parent = textNode.parentElement;
            if (!parent) continue;
            const raw = textNode.nodeValue;
            MATH_REGEX.lastIndex = 0;
            const hydrated = raw.replace(MATH_REGEX, function (match, block, inline) {
                if (!block && !inline) return match;
                try {
                    return window.katex.renderToString(block || inline, {
                        throwOnError: false,
                        displayMode: !!block
                    });
                } catch (e) {
                    // Malformed LaTeX — preserve the original source so the
                    // rest of the document renders normally.
                    return match;
                }
            });

            if (hydrated !== raw) {
                // Wrap the rendered HTML in a sealed span so the observer
                // recognises it as already-processed and never re-enters.
                const wrapper = document.createElement('span');
                wrapper.innerHTML = hydrated;
                wrapper.setAttribute('data-math-rendered', 'true');
                parent.replaceChild(wrapper, textNode);
            }
        }

        // Stamp the container so subsequent observer ticks short-circuit.
        element.setAttribute('data-math-rendered', 'true');
    } catch (err) {
        // Hard error boundary: never let a malformed fragment or a missing
        // KaTeX build break the app's state, sync systems, or canvas engines.
        try { element.setAttribute('data-math-rendered', 'true'); } catch (_) { /* noop */ }
        if (window.console && console.warn) console.warn('[processElementMath] skipped:', err);
    }
}

// ── Live DOM Watchdog ────────────────────────────────────────────────────
// Watches the entire workspace subtree for added nodes (new modals, freshly
// rendered practice questions, dynamic banners, etc.) and pipes them through
// processElementMath() so LaTeX is hydrated the instant it enters the DOM.
const globalMathObserver = new MutationObserver(function (mutations) {
    // If KaTeX isn't loaded yet, defer — the initial body sweep in initApp()
    // will catch any pre-existing fragments once it arrives.
    if (typeof window.katex === 'undefined' || !window.katex) return;

    for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        if (!mutation.addedNodes || !mutation.addedNodes.length) continue;

        for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                // Skip KaTeX's own rendered internals and raw script/style.
                if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') continue;
                if (node.classList && node.classList.contains('katex')) continue;
                if (node.hasAttribute && node.hasAttribute('data-math-rendered')) continue;
                processElementMath(node);
            } else if (node.nodeType === Node.TEXT_NODE) {
                // A raw text node was injected (e.g. element.textContent = ...).
                // Process its parent — but first clear any stale render stamp
                // so dynamic re-renders (like #solution-content) are picked up.
                const parent = node.parentElement;
                if (!parent) continue;
                if (parent.hasAttribute('data-math-rendered')) {
                    parent.removeAttribute('data-math-rendered');
                }
                processElementMath(parent);
            }
        }
    }
});

// ============================================================================
// FULL-VIEWPORT SCRATCHPAD HUD — Perfect-Freehand + Apple Pencil optimized
// ============================================================================
// Drawing engine: perfect-freehand (the library Excalidraw / tldraw use) for
// smooth, tapered, pressure-sensitive stroke outlines. Loaded dynamically from
// CDN with a graceful fallback to simple line drawing if unreachable, so the
// app NEVER crashes if the CDN is down.
//
// FIXES for the three reported iPad/Apple-Pencil issues:
//
//  1. "Gap gets bigger the more I write" — ROOT CAUSE: the canvas was sized
//     with CSS `100vw/100vh`, which on iPadOS Safari does NOT equal
//     `window.innerWidth/innerHeight` (Safari's dynamic browser chrome makes
//     100vh taller than the visible area). That mismatch meant the canvas
//     rendered taller than its internal drawable buffer, so the coordinate
//     error grew LINEARLY with distance from the top-left corner — exactly the
//     "grows as I write" symptom.
//     FIX: size the canvas with JS using `window.innerWidth/innerHeight` for
//     BOTH the CSS size and the DPR-scaled internal resolution → 1:1 match.
//
//  2. "Sometimes selects text" — FIX: `user-select:none` +
//     `-webkit-touch-callout:none` on body while active, plus document-level
//     `selectstart`/`dragstart` blockers.
//
//  3. "Sometimes zooms the page" — iPadOS Safari IGNORES `user-scalable=no`
//     since iOS 10. FIX: block `gesturestart`/`gesturechange`/`gestureend`
//     (Safari pinch-zoom) + `dblclick` (double-tap zoom) at the document level
//     while active.
//
// Plus: coalesced events for full 240 Hz Pencil sampling, palm rejection,
// getBoundingClientRect() coordinate mapping (robust to any offset), and
// perfect-freehand for gorgeous pressure-variable strokes.
//
// Color UX: toolbar color swatch → dropdown of up to 8 quick colors + "+" →
// square palette to pick any color and manage the quick list (add/remove ×).
// Persisted in localStorage.
// ============================================================================
(function _initScratchpad() {
    if (window.__scratchpadInit) return;
    window.__scratchpadInit = true;

    // ── Configuration ──────────────────────────────────────────────────────
    const STORAGE_QUICK = 'scratchpad:quickColors';
    const STORAGE_SELECTED = 'scratchpad:selectedColor';

    const DEFAULT_QUICK_COLORS = ['#ffffff', '#ef4444', '#facc15', '#22c55e', '#06b6d4'];
    const PRESET_COLORS = [
        '#ffffff', '#d4d4d8', '#71717a', '#27272a', '#000000',
        '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
        '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
        '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
        '#ec4899', '#f43f5e', '#dc2626', '#7c3aed',
    ];
    const MAX_QUICK = 8;
    const DRAG_THRESHOLD = 6;

    // perfect-freehand options, tuned for Apple Pencil (1st gen included).
    const STROKE_PEN = {
        size: 6, thinning: 0.6, smoothing: 0.5, streamline: 0.2,
        simulatePressure: false,
        start: { taper: 0, cap: true }, end: { taper: 0, cap: true }, last: true,
    };
    const STROKE_MOUSE = {
        size: 4, thinning: 0.5, smoothing: 0.5, streamline: 0.5,
        simulatePressure: true,
        start: { taper: 0, cap: true }, end: { taper: 0, cap: true }, last: true,
    };

    // ── Dynamic import of perfect-freehand (with fallback) ──────────────────
    let getStrokeFn = null;
    import('https://esm.sh/perfect-freehand@1.2.3').then(function (mod) {
        getStrokeFn = mod.default || mod.getStroke;
    }).catch(function () {
        // CDN unreachable — fall back to simple line drawing. The app still
        // works; strokes just won't have perfect-freehand's tapered smoothing.
        getStrokeFn = null;
    });

    // ── State ──────────────────────────────────────────────────────────────
    let root, toolbar, pencilBtn, colorBtn, clearBtn, dropdown;
    let paletteOverlay, paletteBox, bigSwatch, hexInput, nativeInput;
    let presetGrid, quickManageRow, addBtn;
    let canvas, ctx, bgCanvas, bgCtx;  // fg (live) + bg (bitmap accumulator)

    let isActive = false;
    let isDrawing = false;
    let currentPointerType = '';
    let currentPoints = [];           // [[x, y, pressure], ...] for the in-progress stroke
    // Compact committed-stroke cache. Stores ONLY the lightweight raw points
    // array, a shallow-cloned opts object, and the color string. The heavy
    // perfect-freehand outline polygon is NEVER cached here — it is computed
    // transiently at commit time (to flatten onto bgCanvas) and again lazily
    // only when a window resize/orientation change forces a full re-render.
    // This keeps the heap footprint flat during high-frequency tap cadences
    // and avoids GC pauses that paralyze the input thread mid-stroke.
    let committedOutlines = [];       // [{points:[[x,y,p]...], opts, color, fallback?}, ...]
    let currentStrokeOpts = STROKE_PEN;
    // Fallback stroke state (when perfect-freehand isn't loaded)
    let fallbackLastX = 0, fallbackLastY = 0;

    let quickColors = [];
    let selectedColor = '#ffffff';

    let dropdownOpen = false;
    let paletteOpen = false;

    let dragPointerId = null;
    let dragMoved = false;
    let dragOffsetX = 0, dragOffsetY = 0;
    let dragStartX = 0, dragStartY = 0;
    let pressedBtn = null;

    // rAF render-throttle state — decouples 240Hz Apple Pencil input
    // from the 60Hz/120Hz ProMotion display refresh cycle.
    let renderRequested = false;
    let rafId = 0;

    let blockGesture, blockSelect, blockDblClick, blockTouchStart;

    // ── Storage ────────────────────────────────────────────────────────────
    function loadColors() {
        try {
            const qRaw = localStorage.getItem(STORAGE_QUICK);
            const q = qRaw ? JSON.parse(qRaw) : null;
            if (Array.isArray(q) && q.length) {
                quickColors = q.filter(function (c) {
                    return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
                });
            }
            if (!quickColors || !quickColors.length) quickColors = DEFAULT_QUICK_COLORS.slice();
            const s = localStorage.getItem(STORAGE_SELECTED);
            selectedColor = (s && /^#[0-9a-fA-F]{6}$/.test(s)) ? s : quickColors[0];
            if (!quickColors.includes(selectedColor)) selectedColor = quickColors[0];
        } catch (_) {
            quickColors = DEFAULT_QUICK_COLORS.slice();
            selectedColor = quickColors[0];
        }
    }
    function saveColors() {
        try {
            localStorage.setItem(STORAGE_QUICK, JSON.stringify(quickColors));
            localStorage.setItem(STORAGE_SELECTED, selectedColor);
        } catch (_) { /* ignore */ }
    }

    // ── DOM helper ─────────────────────────────────────────────────────────
    function el(tag, attrs, children) {
        attrs = attrs || {}; children = children || [];
        const node = document.createElement(tag);
        for (const k in attrs) {
            const v = attrs[k];
            if (k === 'style' && typeof v === 'object' && v) Object.assign(node.style, v);
            else if (k === 'class') node.className = v;
            else if (k === 'html') node.innerHTML = v;
            else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
            else if (v !== undefined && v !== null) node.setAttribute(k, String(v));
        }
        for (const c of children) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        return node;
    }
    function svg(paths, size, sw) {
        size = size || 20; sw = sw || 2;
        return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" ' +
            'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + sw + '" ' +
            'stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
    }
    const ICON_PENCIL = svg('M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z', 20, 2);
    const ICON_PLUS = svg('M12 5v14 M5 12h14', 18, 2.2);
    const ICON_CLOSE = svg('M18 6 6 18 M6 6l12 12', 16, 2);
    const ICON_TRASH = svg('M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6', 18, 1.8);
    const GLASS = {
        background: 'rgba(16,16,24,0.92)',
        backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 10px 34px rgba(0,0,0,0.55)',
    };

    // ── Drawing ────────────────────────────────────────────────────────────
    function pressureFor(e) {
        if (e.pointerType === 'pen') return e.pressure > 0 ? e.pressure : 0.5;
        return 0.5;
    }
    function getCanvasPoint(e) {
        // Map pointer into canvas coordinate space via the canvas's real rect.
        // Robust to any offset/zoom/containing-block drift.
        const rect = canvas.getBoundingClientRect();
        return [e.clientX - rect.left, e.clientY - rect.top, pressureFor(e)];
    }

    // Fill a perfect-freehand outline polygon onto an arbitrary context.
    // `targetCtx` defaults to the foreground ctx when omitted.
    function fillOutline(outline, color, targetCtx) {
        if (!outline || !outline.length) return;
        var c = targetCtx || ctx;
        c.save();
        c.fillStyle = color;
        c.beginPath();
        if (outline.length === 1) {
            c.arc(outline[0][0], outline[0][1], 1.5, 0, Math.PI * 2);
        } else {
            c.moveTo(outline[0][0], outline[0][1]);
            for (var i = 1; i < outline.length; i++) c.lineTo(outline[i][0], outline[i][1]);
            c.closePath();
        }
        c.fill();
        c.restore();
    }
    

    // O(1) live repaint — only the single in-progress stroke is drawn on the
    // foreground canvas. Historical strokes live permanently on the background
    // bitmap accumulator and are never revisited during pointermove.
    function render() {
        if (!canvas || !ctx) return;
        var dpr = window.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // Draw ONLY the single active stroke on the live foreground layer
        if (currentPoints.length) {
            if (getStrokeFn) {
                var outline = getStrokeFn(currentPoints, currentStrokeOpts);
                fillOutline(outline, selectedColor, ctx);
            } else {
                drawFallbackStroke(currentPoints, selectedColor, ctx);
            }
        }
    }

    // Fallback line renderer (when perfect-freehand CDN is unavailable).
    // `targetCtx` defaults to the foreground ctx when omitted.
    function drawFallbackStroke(points, color, targetCtx) {
        if (points.length < 1) return;
        var c = targetCtx || ctx;
        c.save();
        c.strokeStyle = color;
        c.fillStyle = color;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.lineWidth = currentPointerType === 'pen' ? 2.5 : 2.4;
        if (points.length === 1) {
            c.beginPath();
            c.arc(points[0][0], points[0][1], 1.5, 0, Math.PI * 2);
            c.fill();
        } else {
            c.beginPath();
            c.moveTo(points[0][0], points[0][1]);
            for (var i = 1; i < points.length; i++) c.lineTo(points[i][0], points[i][1]);
            c.stroke();
        }
        c.restore();
    }

    // ── Asynchronous non-blocking stroke commit queue ─────────────────────
    // Rapid tap-and-lift sequences (dotting i's, crossing t's) fire pointerup
    // in quick succession. Running the mathematically intensive perfect-freehand
    // getStroke() synchronously inside onCanvasPointerUp jams the event loop
    // and makes Safari drop the next incoming pointerdown. Instead, finished
    // strokes are snapshotted here and their outline computation + background
    // flattening are deferred to a decoupled idle task that never blocks the
    // pointer-event critical path. This also relieves GC pressure: the huge
    // [[x,y]...] outline arrays are allocated during idle frames, not while a
    // tap is imminent, so GC pauses no longer paralyze the input thread.
    let strokeCommitQueue = [];        // [{points, opts, color}, ...]
    let isProcessingQueue = false;
    let queueScheduledId = null;

    // Hybrid scheduler: prefer requestIdleCallback for low-priority idle
    // frames; fall back gracefully to a decoupled setTimeout(..., 0) macrotask
    // on Safari builds that ship without requestIdleCallback. Either way the
    // heavy perfect-freehand work runs OFF the input thread.
    const hasIdleCallback = (typeof window.requestIdleCallback === 'function');
    function scheduleIdleTask(fn) {
        if (hasIdleCallback) return window.requestIdleCallback(fn, { timeout: 200 });
        return window.setTimeout(fn, 0);
    }
    function cancelIdleTask(id) {
        if (id === null || id === undefined) return;
        if (hasIdleCallback) window.cancelIdleCallback(id);
        else window.clearTimeout(id);
    }

    // Isolated O(1) background-layer flattening. Flatten ONE completed stroke
    // onto the permanent background bitmap. It writes only to bgCanvas and
    // appends a COMPACT entry to committedOutlines (raw points + opts + color).
    // The heavy perfect-freehand outline polygon is computed TRANSIENTLY here
    // for the immediate paint, then discarded — it is never cached, so the
    // committedOutlines array stays lightweight and the heap doesn't churn
    // during high-frequency tap cadences. The outline is recomputed lazily
    // only inside resizeCanvas() when a layout change forces a full re-render.
    // The foreground canvas is untouched — it continues to show only the
    // single active in-progress stroke via render().
    function processCommitJob(job) {
        if (!bgCanvas || !bgCtx) return;
        if (!job.points || !job.points.length) return;
        var dpr = window.devicePixelRatio || 1;
        bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        bgCtx.lineCap = 'round';
        bgCtx.lineJoin = 'round';
        if (getStrokeFn) {
            // Transient outline — painted onto bgCtx, then dropped. Not cached.
            var outline = getStrokeFn(job.points, job.opts);
            fillOutline(outline, job.color, bgCtx);
            committedOutlines.push({
                points: job.points,           // already a slice owned by the job
                opts: job.opts,               // already a shallow clone
                color: job.color,
            });
        } else {
            // Fallback path (perfect-freehand CDN unreachable).
            drawFallbackStroke(job.points, job.color, bgCtx);
            committedOutlines.push({
                points: job.points,
                opts: job.opts,
                color: job.color,
                fallback: true,
            });
        }
    }

    // Recurring drain: yields to the event loop between commits so incoming
    // pointerdown events are always serviced promptly. On the requestIdleCallback
    // path it keeps draining while the idle deadline has budget remaining; on
    // the setTimeout path it commits exactly one stroke per macrotask, then
    // re-schedules — guaranteeing the input thread is never held for long.
    function drainCommitQueue(deadline) {
        queueScheduledId = null;
        isProcessingQueue = true;
        try {
            const hasDeadline = deadline && typeof deadline.timeRemaining === 'function';
            while (strokeCommitQueue.length) {
                processCommitJob(strokeCommitQueue.shift());
                if (hasDeadline) {
                    if (deadline.timeRemaining() <= 0) break;
                } else {
                    break; // setTimeout path: one commit per tick, then yield
                }
            }
        } finally {
            isProcessingQueue = false;
        }
        if (strokeCommitQueue.length) scheduleQueueDrain();
    }

    function scheduleQueueDrain() {
        if (isProcessingQueue || queueScheduledId !== null) return;
        queueScheduledId = scheduleIdleTask(drainCommitQueue);
    }

    function onCanvasPointerDown(e) {
        if (!isActive) return;
        if (dropdownOpen || paletteOpen) return;
        // ── Apple Pencil drawing lock ──
        // Rejects mouse / finger / eraser — only 'pen' may draw on the canvas.
        // HUD toolbar buttons remain fully touch-friendly (no guard there).
        if (e.pointerType !== 'pen') return;
        if (isDrawing) return;
        if (e.cancelable) e.preventDefault();
        isDrawing = true;
        currentPointerType = 'pen';
        currentStrokeOpts = STROKE_PEN;
        // NOTE: setPointerCapture is deliberately omitted. On iPadOS Safari the
        // acquire/release pair on every tap-and-lift forces a synchronous
        // capture-state transition that clashes with high-frequency Pencil
        // input and causes the browser to drop subsequent pointerdown events.
        // The canvas is full-viewport with touch-action:none, so pointer
        // capture is redundant for pen tracking anyway.
        currentPoints = [getCanvasPoint(e)];
        render();
    }
    function onCanvasPointerMove(e) {
        if (!isActive || !isDrawing) return;
        // ── Apple Pencil drawing lock ──
        if (e.pointerType !== 'pen') return;
        if (e.cancelable) e.preventDefault();

        // Ingest all coalesced Apple Pencil sub-frame events at hardware rate (240Hz)
        // without triggering any canvas path computation on the event thread.
        const coalesced = (typeof e.getCoalescedEvents === 'function')
            ? e.getCoalescedEvents()
            : null;
        const queue = (coalesced && coalesced.length) ? coalesced : [e];

        for (let i = 0; i < queue.length; i++) {
            currentPoints.push(getCanvasPoint(queue[i]));
        }

        // Telemetry: sample only the latest coordinate once per event batch,
        // moved outside the inner coalesced loop to minimize overhead.
        if (window.__checkpoint && typeof window.__checkpoint.reportDrawingActivity === 'function') {
            var latest = currentPoints[currentPoints.length - 1];
            if (latest) window.__checkpoint.reportDrawingActivity(latest[0], latest[1]);
        }

        // Decoupled rAF render: schedule at most ONE render per display frame.
        // This lets the render() call (perfect-freehand O(N^2) path computation)
        // scale naturally to the ProMotion refresh rate instead of firing at
        // every 240Hz hardware event.
        if (!renderRequested) {
            renderRequested = true;
            rafId = requestAnimationFrame(function () {
                renderRequested = false;
                rafId = 0;
                render();
            });
        }
    }
    // On pointer release, snapshot the raw stroke and defer the expensive
    // perfect-freehand outline computation + background flattening to the
    // asynchronous commit queue. This keeps the pointerup handler O(n) in
    // point count only (a shallow clone) and never blocks the event loop, so
    // the next pointerdown is never dropped.
    //
    // The live foreground canvas is intentionally NOT cleared here: the
    // just-finished stroke's pixels remain visible as a preview until the
    // queue flattens them onto the background bitmap. The next render() (on
    // the following pointerdown) then wipes the foreground. This yields a
    // flicker-free handoff with zero synchronous heavy work on the input
    // thread. The committedOutlines array is maintained solely for resize
    // recovery and is never accessed during active pointer-tracking frames.
    function onCanvasPointerUp(e) {
        if (!isActive) return;
        // ── Apple Pencil drawing lock ──
        if (e.pointerType !== 'pen') return;
        if (!isDrawing) return;

        // Cancel any pending rAF render — the stroke is finished; its pixels
        // will be re-rendered onto the background layer by the commit queue.
        if (renderRequested) {
            cancelAnimationFrame(rafId);
            renderRequested = false;
            rafId = 0;
        }

        isDrawing = false;
        currentPointerType = '';

        // Snapshot clone of the raw points + a shallow copy of the stroke
        // options + the active color. The queue owns this copy; the live
        // currentPoints array is reset below for the next stroke. The points
        // are immutable [x,y,p] tuples, so a shallow slice is a faithful
        // snapshot without the GC cost of a deep clone.
        if (currentPoints.length) {
            strokeCommitQueue.push({
                points: currentPoints.slice(),
                opts: Object.assign({}, currentStrokeOpts),
                color: selectedColor,
            });
            scheduleQueueDrain();
        }
        currentPoints = [];

        // NOTE: releasePointerCapture is intentionally omitted — see the
        // matching note in onCanvasPointerDown. Safari's capture state machine
        // is a known source of dropped pointerdown events during rapid
        // tap-and-lift loops, so neither acquire nor release is used here.
    }

    // ── Canvas sizing (THE fix for "gap grows as I write") ─────────────────
    // Use window.innerWidth/Height for BOTH the CSS size AND the DPR-scaled
    // internal resolution. CSS 100vw/100vh ≠ innerWidth/Height on iPadOS
    // (Safari's dynamic browser chrome), and that mismatch made the coordinate
    // error grow linearly with distance from the top-left corner.
    // Resize BOTH canvases to match the viewport at the current DPR.
    // After resize (which clears both bitmap buffers), redraw all committed
    // strokes onto the background layer so nothing is lost.
    function resizeCanvas() {
        if (!canvas || !ctx || !bgCanvas || !bgCtx) return;
        var dpr = window.devicePixelRatio || 1;
        var cssW = window.innerWidth;
        var cssH = window.innerHeight;
        // Set CSS dimensions on both canvases
        canvas.style.width = cssW + 'px';
        canvas.style.height = cssH + 'px';
        bgCanvas.style.width = cssW + 'px';
        bgCanvas.style.height = cssH + 'px';
        var newW = Math.round(cssW * dpr);
        var newH = Math.round(cssH * dpr);
        var sizeUnchanged = (canvas.width === newW && canvas.height === newH);
        // Resize both canvas buffers (clears their bitmaps)
        canvas.width = newW;
        canvas.height = newH;
        bgCanvas.width = newW;
        bgCanvas.height = newH;
        // Restore transforms and drawing defaults on both contexts
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        bgCtx.lineCap = 'round';
        bgCtx.lineJoin = 'round';
        // LAZY outline recomputation — this is the ONLY place the heavy
        // perfect-freehand polygon metrics are recomputed from the compact
        // committedOutlines cache. Because each entry stores only the raw
        // points + opts + color (no cached polygon), this loop runs getStroke()
        // per stroke solely when a resize/orientation change wipes the bgCanvas
        // bitmap. The transient outline is painted straight onto bgCtx and
        // discarded, keeping peak heap bounded to one outline at a time.
        for (var i = 0; i < committedOutlines.length; i++) {
            var s = committedOutlines[i];
            if (s.fallback) {
                drawFallbackStroke(s.points, s.color, bgCtx);
            } else if (getStrokeFn) {
                var outline = getStrokeFn(s.points, s.opts);
                fillOutline(outline, s.color, bgCtx);
            } else {
                // perfect-freehand dropped mid-session — degrade gracefully.
                drawFallbackStroke(s.points, s.color, bgCtx);
            }
        }
        // If an active stroke exists, repaint it on the foreground
        if (!sizeUnchanged) render();
    }

    // Clear BOTH canvas surfaces and empty all auxiliary memory arrays.
    function clearCanvas() {
        // Drop any pending async commits so they cannot re-paint strokes onto
        // the freshly wiped background after this call returns.
        strokeCommitQueue.length = 0;
        if (queueScheduledId !== null) {
            cancelIdleTask(queueScheduledId);
            queueScheduledId = null;
        }
        isProcessingQueue = false;
        committedOutlines = [];
        currentPoints = [];
        // Wipe the live foreground canvas
        if (canvas && ctx) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
        }
        // Wipe the permanent background bitmap accumulator
        if (bgCanvas && bgCtx) {
            bgCtx.save();
            bgCtx.setTransform(1, 0, 0, 1, 0, 0);
            bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
            bgCtx.restore();
        }
    }

    // ── Gesture / selection blockers (added while active) ──────────────────
    function installBlockers() {
        blockGesture = function (e) { e.preventDefault(); }; // pinch-zoom (gesturestart/change/end)
        blockSelect = function (e) { e.preventDefault(); };  // selectstart / dragstart
        blockDblClick = function (e) { e.preventDefault(); }; // double-tap zoom
        blockTouchStart = function (e) {
            // Block multi-touch (pinch) so only the single drawing pointer works.
            if (e.touches && e.touches.length > 1) e.preventDefault();
        };
        document.addEventListener('gesturestart', blockGesture, { passive: false });
        document.addEventListener('gesturechange', blockGesture, { passive: false });
        document.addEventListener('gestureend', blockGesture, { passive: false });
        document.addEventListener('selectstart', blockSelect);
        document.addEventListener('dragstart', blockSelect);
        document.addEventListener('dblclick', blockDblClick);
        document.addEventListener('touchstart', blockTouchStart, { passive: false });
        // Window-level non-passive touchmove blocker. Reuses blockGesture so the
        // same handler kills both gesture-events and stray touchmove scrolls /
        // edge-swipes that iOS Safari would otherwise route to its scroll /
        // back-forward navigation engine during fast horizontal Pencil dashes.
        window.addEventListener('touchmove', blockGesture, { passive: false });
    }
    function removeBlockers() {
        if (blockGesture) {
            document.removeEventListener('gesturestart', blockGesture);
            document.removeEventListener('gesturechange', blockGesture);
            document.removeEventListener('gestureend', blockGesture);
            window.removeEventListener('touchmove', blockGesture);
        }
        if (blockSelect) {
            document.removeEventListener('selectstart', blockSelect);
            document.removeEventListener('dragstart', blockSelect);
        }
        if (blockDblClick) document.removeEventListener('dblclick', blockDblClick);
        if (blockTouchStart) document.removeEventListener('touchstart', blockTouchStart);
    }

    // ── Active toggle ──────────────────────────────────────────────────────
    function toggleActive() {
        isActive = !isActive;
        if (isActive) {
            canvas.style.pointerEvents = 'auto';
            document.body.classList.add('scratchpad-active');
            // Terminate the browser's horizontal history-navigation swipe
            // gesture engine while the drawing surface is live. Without this,
            // fast horizontal Pencil dashes (e.g. '=' or math dashes) can be
            // intercepted by iOS Safari's back/forward swipe recognizer and
            // swallowed before reaching the canvas pointer pipeline.
            document.body.style.overscrollBehaviorX = 'none';
            installBlockers();
            pencilBtn.style.background = 'rgba(34,197,94,0.22)';
            pencilBtn.style.boxShadow = '0 0 0 1px rgba(34,197,94,0.7), 0 0 14px rgba(34,197,94,0.45)';
            closeDropdown();
        } else {
            clearCanvas();
            canvas.style.pointerEvents = 'none';
            document.body.classList.remove('scratchpad-active');
            // Restore the default horizontal overscroll behavior so normal
            // page navigation gestures work again outside the scratchpad.
            document.body.style.overscrollBehaviorX = 'auto';
            removeBlockers();
            pencilBtn.style.background = 'rgba(255,255,255,0.04)';
            pencilBtn.style.boxShadow = 'none';
            closeDropdown();
        }
    }

    // ── Color state ────────────────────────────────────────────────────────
    function updateColorBtn() { if (colorBtn) colorBtn.style.background = selectedColor; }
    function applyColor(c) {
        selectedColor = c.toLowerCase();
        saveColors();
        updateColorBtn();
        if (nativeInput) nativeInput.value = selectedColor;
        if (hexInput) hexInput.value = selectedColor;
        if (bigSwatch) bigSwatch.style.background = selectedColor;
        renderPresets();
        renderPaletteQuick();
        renderDropdown();
    }
    function selectColorFromDropdown(c) { applyColor(c); closeDropdown(); }
    function addQuick() {
        const lc = selectedColor.toLowerCase();
        if (quickColors.some(function (s) { return s.toLowerCase() === lc; })) return;
        if (quickColors.length >= MAX_QUICK) return;
        quickColors.push(selectedColor);
        saveColors();
        renderPaletteQuick();
        renderDropdown();
    }
    function removeQuick(c) {
        if (quickColors.length <= 1) return;
        quickColors = quickColors.filter(function (x) { return x !== c; });
        if (selectedColor === c) {
            selectedColor = quickColors[0];
            updateColorBtn();
            if (nativeInput) nativeInput.value = selectedColor;
            if (hexInput) hexInput.value = selectedColor;
            if (bigSwatch) bigSwatch.style.background = selectedColor;
        }
        saveColors();
        renderPaletteQuick();
        renderDropdown();
    }

    // ── Dropdown (main color menu) ─────────────────────────────────────────
    function toggleDropdown() { if (dropdownOpen) closeDropdown(); else openDropdown(); }
    function openDropdown() {
        if (paletteOpen) closePalette();
        dropdownOpen = true;
        renderDropdown();
        dropdown.style.display = 'flex';
    }
    function closeDropdown() { dropdownOpen = false; if (dropdown) dropdown.style.display = 'none'; }
    function renderDropdown() {
        if (!dropdown) return;
        dropdown.innerHTML = '';
        quickColors.forEach(function (c) {
            const sel = c.toLowerCase() === selectedColor.toLowerCase();
            const sw = el('div', {
                class: 'sp-sw', role: 'button', tabindex: '0', title: c,
                style: {
                    width: '34px', height: '34px', borderRadius: '50%', background: c,
                    outline: sel ? '2px solid #fff' : '1px solid rgba(255,255,255,0.16)',
                    outlineOffset: sel ? '1px' : '0',
                    cursor: 'pointer', transition: 'transform 0.12s ease',
                },
                onclick: function () { selectColorFromDropdown(c); },
            });
            sw.addEventListener('pointerenter', function () { sw.style.transform = 'scale(1.12)'; });
            sw.addEventListener('pointerleave', function () { sw.style.transform = 'scale(1)'; });
            dropdown.appendChild(sw);
        });
        const plus = el('div', {
            class: 'sp-sw sp-plus', role: 'button', tabindex: '0', title: 'More vibes',
            style: {
                width: '34px', height: '34px', borderRadius: '50%',
                background: 'rgba(255,255,255,0.06)',
                border: '1px dashed rgba(255,255,255,0.25)',
                color: '#cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: 'transform 0.12s ease, background 0.12s ease',
            },
            html: ICON_PLUS,
            onclick: function () { closeDropdown(); openPalette(); },
        });
        plus.addEventListener('pointerenter', function () { plus.style.transform = 'scale(1.12)'; plus.style.background = 'rgba(255,255,255,0.12)'; });
        plus.addEventListener('pointerleave', function () { plus.style.transform = 'scale(1)'; plus.style.background = 'rgba(255,255,255,0.06)'; });
        dropdown.appendChild(plus);
    }

    // ── Palette square (full picker + manage quick list) ───────────────────
    function openPalette() {
        if (dropdownOpen) closeDropdown();
        paletteOpen = true;
        if (nativeInput) nativeInput.value = selectedColor;
        if (hexInput) hexInput.value = selectedColor;
        if (bigSwatch) bigSwatch.style.background = selectedColor;
        renderPresets();
        renderPaletteQuick();
        paletteOverlay.style.display = 'flex';
    }
    function closePalette() { paletteOpen = false; if (paletteOverlay) paletteOverlay.style.display = 'none'; }
    function renderPresets() {
        if (!presetGrid) return;
        presetGrid.innerHTML = '';
        PRESET_COLORS.forEach(function (c) {
            const sel = c.toLowerCase() === selectedColor.toLowerCase();
            const cell = el('div', {
                class: 'sp-preset', role: 'button', tabindex: '0', title: c,
                style: {
                    aspectRatio: '1', borderRadius: '7px', background: c,
                    outline: sel ? '2px solid #fff' : '1px solid rgba(255,255,255,0.12)',
                    outlineOffset: sel ? '1px' : '0',
                    cursor: 'pointer', transition: 'transform 0.1s ease',
                },
                onclick: function () { applyColor(c); },
            });
            cell.addEventListener('pointerenter', function () { cell.style.transform = 'scale(1.12)'; });
            cell.addEventListener('pointerleave', function () { cell.style.transform = 'scale(1)'; });
            presetGrid.appendChild(cell);
        });
    }
    function renderPaletteQuick() {
        if (!quickManageRow) return;
        quickManageRow.innerHTML = '';
        quickColors.forEach(function (c) {
            const sel = c.toLowerCase() === selectedColor.toLowerCase();
            const wrap = el('div', { class: 'sp-qwrap', style: { position: 'relative', width: '36px', height: '36px' } });
            const sw = el('div', {
                class: 'sp-qsw', role: 'button', tabindex: '0', title: c,
                style: {
                    width: '36px', height: '36px', borderRadius: '50%', background: c,
                    outline: sel ? '2px solid #fff' : '1px solid rgba(255,255,255,0.15)',
                    outlineOffset: sel ? '1px' : '0', cursor: 'pointer',
                },
                onclick: function () { applyColor(c); },
            });
            const x = el('div', {
                class: 'sp-qx', role: 'button', tabindex: '0', title: 'Yeet from quick colors',
                style: {
                    position: 'absolute', top: '-5px', right: '-5px',
                    width: '16px', height: '16px', borderRadius: '50%',
                    background: '#1f2937', color: '#f87171',
                    border: '1px solid rgba(248,113,113,0.6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', fontSize: '0', lineHeight: '0',
                },
                html: svg('M18 6 6 18 M6 6l12 12', 11, 2.4),
                onclick: function (e) { e.stopPropagation(); removeQuick(c); },
            });
            wrap.appendChild(sw);
            wrap.appendChild(x);
            quickManageRow.appendChild(wrap);
        });
        if (addBtn) {
            const lc = selectedColor.toLowerCase();
            const dup = quickColors.some(function (s) { return s.toLowerCase() === lc; });
            const canAdd = quickColors.length < MAX_QUICK && !dup;
            addBtn.style.opacity = canAdd ? '1' : '0.4';
            addBtn.style.pointerEvents = canAdd ? 'auto' : 'none';
        }
    }

    // ── HUD drag + button dispatch ─────────────────────────────────────────
    function onHudPointerDown(e) {
        if (dragPointerId !== null) return;
        dragPointerId = e.pointerId;
        try { toolbar.setPointerCapture(e.pointerId); } catch (_) { /* pointer gone */ }
        dragMoved = false;
        const rootRect = root.getBoundingClientRect();
        dragOffsetX = e.clientX - rootRect.left;
        dragOffsetY = e.clientY - rootRect.top;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        const target = e.target;
        if (pencilBtn.contains(target)) pressedBtn = 'pencil';
        else if (colorBtn.contains(target)) pressedBtn = 'color';
        else if (clearBtn.contains(target)) pressedBtn = 'clear';
        else pressedBtn = null;
    }
    function onHudPointerMove(e) {
        if (e.pointerId !== dragPointerId) return;
        if (!dragMoved) {
            if (Math.abs(e.clientX - dragStartX) > DRAG_THRESHOLD ||
                Math.abs(e.clientY - dragStartY) > DRAG_THRESHOLD) {
                dragMoved = true;
                if (dropdownOpen) closeDropdown();
            }
        }
        if (dragMoved) {
            const newX = e.clientX - dragOffsetX;
            const newY = e.clientY - dragOffsetY;
            const w = root.offsetWidth, h = root.offsetHeight;
            const cx = Math.max(0, Math.min(window.innerWidth - w, newX));
            const cy = Math.max(0, Math.min(window.innerHeight - h, newY));
            root.style.left = cx + 'px';
            root.style.top = cy + 'px';
            root.style.right = 'auto';
        }
    }
    function onHudPointerUp(e) {
        if (e.pointerId !== dragPointerId) return;
        try { toolbar.releasePointerCapture(e.pointerId); } catch (_) { /* released */ }
        dragPointerId = null;
        if (dragMoved) { dragMoved = false; pressedBtn = null; return; }
        const btn = pressedBtn;
        pressedBtn = null;
        if (btn === 'pencil') toggleActive();
        else if (btn === 'color') toggleDropdown();
        else if (btn === 'clear') clearCanvas();
    }

    // ── DOM injection ──────────────────────────────────────────────────────
    function injectDOM() {
        // ── Double-canvas layering system ──────────────────────────────────
        // Bottom layer: permanent bitmap accumulator for committed strokes.
        // pointer-events: none always — this canvas is never interacted with.
        bgCanvas = el('canvas', {
            id: 'scratchpad-bg-canvas',
            style: {
                position: 'fixed', top: '0', left: '0',
                zIndex: '999994', pointerEvents: 'none', display: 'block',
                touchAction: 'none', overscrollBehavior: 'none',
                WebkitUserSelect: 'none', userSelect: 'none',
                WebkitTouchCallout: 'none',
            },
        });
        document.body.appendChild(bgCanvas);

        // Top layer: live foreground for the single in-progress stroke.
        // pointer-events: none unless scratchpad is active (toggled by toggleActive).
        // CRITICAL: width/height are set by resizeCanvas() to window.innerWidth/
        // innerHeight in PX (NOT 100vw/100vh — those mismatch on iPadOS and
        // cause the gap to grow as you draw further from the top-left).
        canvas = el('canvas', {
            id: 'scratchpad-canvas',
            style: {
                position: 'fixed', top: '0', left: '0',
                zIndex: '999995', pointerEvents: 'none', display: 'block',
                touchAction: 'none', overscrollBehavior: 'none',
                WebkitUserSelect: 'none', userSelect: 'none',
                WebkitTouchCallout: 'none',
            },
        });
        document.body.appendChild(canvas);

        root = el('div', {
            id: 'scratchpad-root',
            style: {
                position: 'fixed', top: '20px', right: '20px', zIndex: '999999',
                userSelect: 'none', WebkitUserSelect: 'none',
            },
        });

        toolbar = el('div', {
            id: 'scratchpad-toolbar',
            style: Object.assign({
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: '6px', padding: '6px', borderRadius: '16px',
                touchAction: 'none', cursor: 'grab',
            }, GLASS),
        });

        pencilBtn = el('div', {
            class: 'sp-btn', role: 'button', tabindex: '0', title: 'Toggle doodle pad',
            style: {
                width: '42px', height: '42px', borderRadius: '12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: '#e5e7eb', background: 'rgba(255,255,255,0.04)',
                transition: 'background 0.15s ease, box-shadow 0.15s ease',
            },
            html: ICON_PENCIL,
        });
        pencilBtn.addEventListener('pointerenter', function () {
            if (!dragMoved) pencilBtn.style.background = isActive ? 'rgba(34,197,94,0.32)' : 'rgba(255,255,255,0.1)';
        });
        pencilBtn.addEventListener('pointerleave', function () {
            if (!dragMoved) pencilBtn.style.background = isActive ? 'rgba(34,197,94,0.22)' : 'rgba(255,255,255,0.04)';
        });

        colorBtn = el('div', {
            class: 'sp-btn', role: 'button', tabindex: '0', title: 'Grab color',
            style: {
                width: '42px', height: '42px', borderRadius: '50%', cursor: 'pointer',
                border: '2px solid rgba(255,255,255,0.22)',
                boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.45)',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            },
        });
        colorBtn.addEventListener('pointerenter', function () {
            if (!dragMoved) {
                colorBtn.style.transform = 'scale(1.08)';
                colorBtn.style.boxShadow = 'inset 0 0 0 2px rgba(0,0,0,0.45), 0 0 0 3px rgba(255,255,255,0.12)';
            }
        });
        colorBtn.addEventListener('pointerleave', function () {
            if (!dragMoved) {
                colorBtn.style.transform = 'scale(1)';
                colorBtn.style.boxShadow = 'inset 0 0 0 2px rgba(0,0,0,0.45)';
            }
        });

        clearBtn = el('div', {
            class: 'sp-btn', role: 'button', tabindex: '0', title: 'Nuke canvas',
            style: {
                width: '42px', height: '42px', borderRadius: '12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: '#94a3b8', background: 'rgba(255,255,255,0.04)',
                transition: 'background 0.15s ease, color 0.15s ease',
            },
            html: ICON_TRASH,
        });
        clearBtn.addEventListener('pointerenter', function () {
            if (!dragMoved) { clearBtn.style.background = 'rgba(248,113,113,0.18)'; clearBtn.style.color = '#fca5a5'; }
        });
        clearBtn.addEventListener('pointerleave', function () {
            if (!dragMoved) { clearBtn.style.background = 'rgba(255,255,255,0.04)'; clearBtn.style.color = '#94a3b8'; }
        });

        toolbar.appendChild(pencilBtn);
        toolbar.appendChild(colorBtn);
        toolbar.appendChild(clearBtn);
        root.appendChild(toolbar);

        dropdown = el('div', {
            id: 'scratchpad-dropdown',
            style: Object.assign({
                position: 'absolute', top: 'calc(100% + 10px)', right: '0',
                display: 'none', flexDirection: 'row', flexWrap: 'wrap',
                gap: '8px', padding: '10px', borderRadius: '14px', maxWidth: '270px',
            }, GLASS),
        });
        root.appendChild(dropdown);

        document.body.appendChild(root);
        updateColorBtn();

        // ── Palette overlay (the square) ──
        paletteOverlay = el('div', {
            id: 'scratchpad-palette-overlay',
            style: {
                position: 'fixed', inset: '0', display: 'none',
                alignItems: 'center', justifyContent: 'center', zIndex: '999998',
                background: 'rgba(0,0,0,0.55)',
                backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
            },
        });
        paletteOverlay.addEventListener('pointerdown', function (e) {
            if (e.target === paletteOverlay) closePalette();
        });

        paletteBox = el('div', {
            id: 'scratchpad-palette',
            style: Object.assign({
                width: '308px', borderRadius: '18px', padding: '16px',
                display: 'flex', flexDirection: 'column', gap: '14px',
            }, GLASS),
        });

        const header = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } });
        header.appendChild(el('div', { style: { fontWeight: '600', fontSize: '14px', color: '#f1f5f9' } }, ['Pick your vibe']));
        const closeBtn = el('div', {
            role: 'button', tabindex: '0', title: 'Close',
            style: {
                width: '28px', height: '28px', borderRadius: '8px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: '#94a3b8', background: 'rgba(255,255,255,0.04)',
            },
            html: ICON_CLOSE, onclick: closePalette,
        });
        header.appendChild(closeBtn);
        paletteBox.appendChild(header);

        const mainRow = el('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', position: 'relative' } });
        bigSwatch = el('div', {
            class: 'sp-big', role: 'button', tabindex: '0', title: 'Full color picker',
            style: {
                width: '56px', height: '56px', borderRadius: '12px', cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.15)',
                boxShadow: '0 2px 10px rgba(0,0,0,0.4)', flexShrink: '0',
            },
            onclick: function () { nativeInput.click(); },
        });
        nativeInput = el('input', {
            type: 'color', tabindex: '-1', 'aria-hidden': 'true',
            style: { position: 'absolute', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none', top: '0', left: '0' },
        });
        nativeInput.addEventListener('input', function () { applyColor(nativeInput.value); });

        const hexBox = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', flex: '1' } });
        hexInput = el('input', {
            type: 'text', maxlength: '7', spellcheck: 'false', title: 'Hex code',
            style: {
                width: '100%', background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
                padding: '7px 10px', color: '#e5e7eb', fontSize: '13px',
                fontFamily: 'ui-monospace, monospace', outline: 'none',
            },
        });
        hexInput.addEventListener('change', function () {
            let v = hexInput.value.trim();
            if (!v.startsWith('#')) v = '#' + v;
            if (/^#[0-9a-fA-F]{6}$/.test(v)) applyColor(v.toLowerCase());
            else hexInput.value = selectedColor;
        });
        hexInput.addEventListener('focus', function () { hexInput.style.borderColor = 'rgba(255,255,255,0.3)'; });
        hexInput.addEventListener('blur', function () { hexInput.style.borderColor = 'rgba(255,255,255,0.12)'; });
        hexBox.appendChild(hexInput);
        hexBox.appendChild(el('div', { style: { fontSize: '11px', color: '#64748b' } }, ['Tap the swatch for the full picker']));

        mainRow.appendChild(bigSwatch);
        mainRow.appendChild(nativeInput);
        mainRow.appendChild(hexBox);
        paletteBox.appendChild(mainRow);

        presetGrid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '5px' } });
        paletteBox.appendChild(presetGrid);

        paletteBox.appendChild(el('div', { style: { height: '1px', background: 'rgba(255,255,255,0.08)' } }));

        const qmHeader = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } });
        qmHeader.appendChild(el('div', { style: { fontSize: '12px', color: '#94a3b8', fontWeight: '500' } }, ['Stash Colors']));
        addBtn = el('div', {
            role: 'button', tabindex: '0', title: 'Stash this color',
            style: {
                display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px',
                color: '#e5e7eb', background: 'rgba(255,255,255,0.08)',
                padding: '5px 10px', borderRadius: '8px', cursor: 'pointer',
                transition: 'background 0.12s ease',
            },
            html: '<span style="display:flex;align-items:center">' + ICON_PLUS + '</span> Stash it',
            onclick: addQuick,
        });
        addBtn.addEventListener('pointerenter', function () { addBtn.style.background = 'rgba(255,255,255,0.16)'; });
        addBtn.addEventListener('pointerleave', function () { addBtn.style.background = 'rgba(255,255,255,0.08)'; });
        qmHeader.appendChild(addBtn);
        paletteBox.appendChild(qmHeader);

        quickManageRow = el('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', minHeight: '36px' } });
        paletteBox.appendChild(quickManageRow);

        paletteBox.appendChild(el('div', { style: { fontSize: '11px', color: '#475569' } }, ['Up to 8 stashed colors · tap × to yeet · auto-saved']));

        paletteOverlay.appendChild(paletteBox);
        document.body.appendChild(paletteOverlay);
    }

    // ── Initialization ─────────────────────────────────────────────────────
    function init() {
        if (!document.body) { requestAnimationFrame(init); return; }
        loadColors();
        injectDOM();
        ctx = canvas.getContext('2d');
        bgCtx = bgCanvas.getContext('2d');
        if (!ctx || !bgCtx) return;
        resizeCanvas();

        toolbar.addEventListener('pointerdown', onHudPointerDown);
        toolbar.addEventListener('pointermove', onHudPointerMove);
        toolbar.addEventListener('pointerup', onHudPointerUp);
        toolbar.addEventListener('pointercancel', onHudPointerUp);

        canvas.addEventListener('pointerdown', onCanvasPointerDown);
        canvas.addEventListener('pointermove', onCanvasPointerMove);
        canvas.addEventListener('pointerup', onCanvasPointerUp);
        canvas.addEventListener('pointerleave', onCanvasPointerUp);
        canvas.addEventListener('pointercancel', onCanvasPointerUp);

        // GESTURE BYPASS — explicit non-passive touchstart on the foreground
        // canvas. iOS Safari layers system-level hold/tap-delay/zoom-intercept
        // buffers over elements with default touch handling; during fast
        // horizontal Pencil dashes these buffers can swallow the touch that
        // would have become a pointerdown, causing the dropped-input bug.
        // An unconditional cancelable preventDefault on touchstart forces the
        // web view to stand down its gesture recognizers over the drawing
        // surface so the Pointer Events pipeline receives every contact.
        canvas.addEventListener('touchstart', function (e) {
            if (e.cancelable) e.preventDefault();
        }, { passive: false });

        window.addEventListener('resize', resizeCanvas);
        window.addEventListener('orientationchange', function () { setTimeout(resizeCanvas, 250); });

        document.addEventListener('pointerdown', function (e) {
            if (!dropdownOpen) return;
            if (e.target && !root.contains(e.target)) closeDropdown();
        }, true);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { closePalette(); closeDropdown(); }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.__scratchpad = {
        getActive: function () { return isActive; },
        getColor: function () { return selectedColor; },
        getQuick: function () { return quickColors.slice(); },
        toggle: toggleActive,
        clear: clearCanvas,
    };
})();
