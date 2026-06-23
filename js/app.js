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
    document.querySelector('.collapse-btn').textContent = sb.classList.contains('collapsed') ? '→' : 'Collapse';
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
        catText.textContent = `All Daily Targets Complete! 🚀`;
        catText.className = "cat-text glow-green";
    } else {
        catText.textContent = `Daily Targets: ${overallPct}% Complete`;
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
// any circular module dependency. The chapter-decay health calculation mirrors
// the algorithm inside renderChapterDecayGrid() in matrix.js so the math
// parameters evaluate identically without corrupting target locks or storage.
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
                text: '🚨 STREAK VOLATILITY: 0 questions logged. Current training streak vector is highly vulnerable to breaking.',
            });
        }
    }

    // ── PRIORITY 2: CRITICAL_DECAY ───────────────────────────────────────
    // Triggered if any chapter stability health drops below 45%. Health is
    // calculated using the same algorithm as renderChapterDecayGrid() in
    // matrix.js: health = clamped((avgEF - 1.3) / 1.7 * 100, [10,100]) minus
    // 15% per overdue (ready) question, clamped again.
    {
        const allErrors = AppState.questionBank.filter(q =>
            q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong')
        );
        const chapterMap = {};
        allErrors.forEach(q => {
            const chapter = q.chapter || 'Uncategorized';
            if (!chapterMap[chapter]) chapterMap[chapter] = [];
            chapterMap[chapter].push(q);
        });
        let worstChapter = null;
        let worstHealth = 100;
        for (const [name, questions] of Object.entries(chapterMap)) {
            const avgEF = questions.reduce((sum, q) => sum + (q.easeFactor || 2.5), 0) / questions.length;
            const overdueCount = questions.filter(q => getDueStatus(q).status === 'ready').length;
            let health = ((avgEF - 1.3) / 1.7) * 100;
            health = Math.max(10, Math.min(100, health));
            health -= overdueCount * 15;
            health = Math.max(10, Math.min(100, health));
            if (health < 45 && health < worstHealth) {
                worstHealth = health;
                worstChapter = name;
            }
        }
        if (worstChapter) {
            vulnerabilities.push({
                priority: 2,
                className: 'glow-red',
                text: `⚠️ VULNERABILITY DETECTED: ${worstChapter} health dropped below 45%. Re-solve immediate.`,
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
                text: '⚔️ BOUNTY DEFICIT: Structural target penalty active. Chapter asset locked due to failure.',
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
                text: `⚡ CORE QUEUE CRITICAL: ${readyCount} friction points are highly vulnerable to memory erasure.`,
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
                text: `📉 SYSTEM IMBALANCE: ${displayName} execution volume is severely lagging behind target matrix.`,
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
                text: '🧠 COGNITIVE FRICTION: CNS exhaustion active. Intervals scaled to 25/5; prioritize accuracy.',
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

    updateStreakDisplay();
}

// ==================== STREAK VECTOR TRACKER ====================
export async function updateStreakDisplay() {
    let history = await getDailyHistory();
    if (!Array.isArray(history) || history.length === 0) {
        const streakEl = document.getElementById('top-streak');
        if (streakEl) streakEl.textContent = "0 Days";
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
    drawCandlesticks(svg, counts, {
        width: 360,
        height: 170,
        penaltyFlags,
        showPrediction: true,
        predDays: 5,
        compact: false,
        invert: false,
        valueLabel: 'solves',
        labelFn,
    });
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
        `${s.toUpperCase()} - Domain Constraints`;
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
    if (confirm(`Delete "${ch}"?`)) {
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
    alert("Profile Updated.");
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
    alert("Targets synchronized and locked for 24 Hours.");
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
    if (!key) return alert("No key.");
    AppState.geminiApiKey = key;
    await idbSet('gemini_api_key', key);
    try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        document.getElementById('key-test-result').innerHTML = r.ok ? '✅ Verified.' : '❌ Rejected.';
    } catch (e) {
        document.getElementById('key-test-result').innerHTML = '⚠️ Network error.';
    }
}
// ==================== PRACTICE: UPLOAD & MULTI-CROP SYSTEM ====================
export function initCropSession(base64Images) {
    cropSession.sourceImages = base64Images.map((dataUrl, idx) => ({ id: idx, dataUrl }));
    cropSession.allQuestions = [];
    cropSession.currentQuestionIdx = 0;
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

    inst.textContent = `Question ${cropSession.currentQuestionIdx + 1}: Draw rectangles. Click □ inside a rectangle to toggle diagram.`;

    redrawBtn.style.display = _cq.segments.length > 0 ? 'inline-block' : 'none';
    confirmBtn.style.display = 'inline-block';
    confirmBtn.textContent = '✓ Confirm Question';
    nextBtn.style.display = 'none';
    finishBtn.style.display = 'none';

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
    if (_cq.segments.length === 0) { alert('No segments selected. Draw at least one rectangle.'); return; }
    const questionSegs = _cq.segments.filter(s => !s.isDiagram);
    const diagramSegs = _cq.segments.filter(s => s.isDiagram);
    if (questionSegs.length === 0) { alert('At least one segment must be a question part (Q).'); return; }

    const questionStitched = await stitchSegmentsVertically(questionSegs);
    const diagramStitched = diagramSegs.length > 0 ? await stitchSegmentsVertically(diagramSegs) : null;

    const combinedImage = await combineImagesSideBySide(questionStitched, diagramStitched);
    _cq.stitchedImage = combinedImage;
    _cq.questionOnly = questionStitched;

    document.getElementById('crop-confirm-question').style.display = 'none';
    document.getElementById('crop-next-question').style.display = 'inline-block';
    document.getElementById('crop-finish').style.display = 'inline-block';
    document.getElementById('crop-redraw').style.display = 'none';
    document.getElementById('crop-instruction').textContent = 'Question combined. Add next question or finish.';
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
                solution: ""
            });
        }
    });
    AppState.extractedItems = items;
    closeCropModal();
    showPreviewModal();
    cropSession = { sourceImages: [], currentQuestionIdx: 0, allQuestions: [], activeCrop: false, drawing: {}, canvasRefs: {}, ctxRefs: {}, imgRefs: {} };
}

export function cancelCropSession() {
    if (confirm('Cancel all cropping?')) {
        closeCropModal();
        cropSession = { sourceImages: [], currentQuestionIdx: 0, allQuestions: [], activeCrop: false, drawing: {}, canvasRefs: {}, ctxRefs: {}, imgRefs: {} };
        AppState.extractedItems = [];
    }
}

export async function startManualCrop() {
    let files = document.getElementById('upload-images').files;
    if (!files.length) { alert("Select at least one image"); return; }
    let apiKey = document.getElementById('gemini-key').value;
    if (!apiKey) { alert("Set Gemini API key in Settings"); return; }
    AppState.geminiApiKey = apiKey;
    await idbSet('gemini_api_key', apiKey);
    document.getElementById('upload-progress').style.width = '0%';
    document.getElementById('upload-status-text').innerText = 'Loading images...';
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
    modal.classList.remove('active');
    setTimeout(() => { if (!modal.classList.contains('active')) modal.style.display = 'none'; }, 300);
    Object.values(cropSession.canvasRefs || {}).forEach(canvas => {
        canvas.onmousedown = null;
        canvas.onmousemove = null;
        canvas.onmouseup = null;
        canvas.onmouseleave = null;
        canvas.ontouchstart = null;
        canvas.ontouchmove = null;
        canvas.ontouchend = null;
        canvas.ontouchcancel = null;
    });
}

// Wire upload-images change listener
document.getElementById('upload-images').addEventListener('change', function () {
    const count = this.files.length;
    document.getElementById('file-selected-text').innerText = count > 0 ?
        `${count} file${count > 1 ? 's' : ''} selected` : '';
});

// ==================== PRACTICE: OCR & ANSWER KEY ====================
export async function extractTextForAll() {
    if (!AppState.extractedItems.length) return alert("No questions cropped.");
    const apiKey = AppState.geminiApiKey;
    if (!apiKey) return alert("Set API key first.");
    showLoading("Extracting text & options...");
    for (let i = 0; i < AppState.extractedItems.length; i++) {
        const q = AppState.extractedItems[i];
        if (q.extractedText) continue;
        const imageToOcr = q.questionOnlyDataUrl || q.imageDataUrl;
        const prompt = `Extract the full question text in LaTeX and all answer options from this image. Return ONLY a JSON object: { "extractedText": "...", "options": ["A) ...", "B) ..."] }. CRITICAL: If there are no explicitly labeled choices (e.g., integer or fill-in numerical style constraints), leave the "options" array completely EMPTY. Do not invent choices.`;
        try {
            const res = await callGeminiWithFallback(apiKey, prompt, imageToOcr, 'image/png', null, true);
            const json = cleanAndParseJson(res.text);
            q.extractedText = json.extractedText || "";
            q.options = json.options || [];
            q.type = q.options.length > 0 ? 'mcq' : 'text';
        } catch (e) { console.error('OCR fail at index: ', i, e); }
    }
    hideLoading();
    showPreviewModal();
    alert('Text metrics parsed and stored.');
}

export async function processAnswerKey() {
    let file = document.getElementById('answer-key-image').files[0];
    if (!file) return alert("No answer key selected.");
    const apiKey = AppState.geminiApiKey;
    if (!apiKey) return alert("Set API key first.");
    if (AppState.extractedItems.length === 0) return alert("No questions exist in buffer.");
    if (AppState.extractedItems.some(item => !item.extractedText)) {
        return alert("Error: Run 'Extract Text & Options' first to provide the context required for semantic processing.");
    }
    showLoading("Cross-referencing parsed questions against visual answer sheet...");
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
        alert(`Semantic mapping operations concluded successfully via image.`);
        showPreviewModal();
    } catch (e) {
        hideLoading();
        alert("Semantic algorithm execution fault: " + e.message);
    }
}

export async function processAnswerKeyFromText() {
    const text = document.getElementById('answer-key-text').value.trim();
    if (!text) return alert("Paste structural key details first.");
    const apiKey = AppState.geminiApiKey;
    if (!apiKey) return alert("Set Gemini API key in Settings.");
    if (AppState.extractedItems.length === 0) return alert("No items recorded in context.");
    if (AppState.extractedItems.some(item => !item.extractedText)) {
        return alert("Error: Run 'Extract Text & Options' first to provide the context required for semantic processing.");
    }
    showLoading("Cross-referencing parsed questions against raw structural key metrics...");
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
        alert(`Semantic text matching complete.`);
        showPreviewModal();
    } catch (e) {
        hideLoading();
        alert("Semantic algorithm execution fault: " + e.message);
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
            solution: q.solution || ""
        };
        AppState.questionBank.push(newQ);
    }
    saveAllAsync().catch(console.error);
    closeModalStr('preview-modal');
    alert(`Saved ${AppState.extractedItems.length} questions.`);
}

export function showPreviewModal() {
    let container = document.getElementById('extracted-questions-list');
    container.innerHTML = '';
    AppState.extractedItems.forEach((q, idx) => {
        let div = document.createElement('div');
        div.className = 'question-preview-item';
        let diagramHtml = q.diagramImageUrl ?
            `<div><small>📐 Diagram:</small><br><img src="${q.diagramImageUrl}" style="max-width:120px; border-radius:8px; margin-top:4px;"></div>` :
            '';
        let textPreview = q.extractedText ?
            `<p style="font-size:13px; color:#cbd5e1;">${escapeHtml(q.extractedText.substring(0, 100))}…</p>` :
            '';
        let optionsPreview = q.options.length ?
            `<p style="font-size:13px; color:#93c5fd;">Options: ${q.options.map(o => escapeHtml(o)).join(', ')}</p>` :
            '';
        let solutionPreview = q.solution ?
            `<p style="font-size:12px; color:#6ee7b7; margin-top:4px;">📝 Solution Bound</p>` : '';
        let answerDisplay = Array.isArray(q.correctAnswer) ? q.correctAnswer.join(',') : (q.correctAnswer || '');
        div.innerHTML = `<strong>Question ${idx + 1}</strong>
            <div style="display:flex; gap:12px; align-items:flex-start;">
                <img src="${q.imageDataUrl}" style="max-width:200px; border-radius:12px;">
                ${diagramHtml}
                <div>${textPreview}${optionsPreview}${solutionPreview}</div>
            </div>
            <div class="manual-answer-row">
                <span>Answer:</span>
                <input id="manual-answer-${idx}" class="pomo-input" style="width:150px;" placeholder="A/B/C/D or comma-separated list" value="${escapeHtml(answerDisplay)}">
            </div>`;
        container.appendChild(div);
    });
    openModal('preview-modal');
}

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
    if (!chapterQuestions.length) { alert("No questions in this chapter."); return; }

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
        else if (AppState.currentFilter === 'unsolved') titleEl.textContent = 'Filtered: Unexecuted';
        else if (AppState.currentFilter === 'solved') titleEl.textContent = 'Filtered: Correct';
        else if (AppState.currentFilter === 'wrong') titleEl.textContent = 'Filtered: Flawed / Wrong';
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
    const firstAttempted = filteredQuestions.filter(q => {
        const r = _firstAttemptResult(q);
        return r === 'correct' || r === 'incorrect';
    });
    const firstCorrect = firstAttempted.filter(q => _firstAttemptResult(q) === 'correct').length;
    const accuracy = firstAttempted.length > 0 ? Math.round((firstCorrect / firstAttempted.length) * 100) : 0;
    // Average time is averaged only over questions that actually logged a time.
    const timedQuestions = filteredQuestions.filter(q => q.timeTaken > 0);
    const avgTime = timedQuestions.length > 0 ? Math.round(timedQuestions.reduce((sum, q) => sum + (q.timeTaken || 0), 0) / timedQuestions.length) : 0;

    const statsRow = document.getElementById('stats-row');
    if (statsRow) {
        statsRow.style.display = 'flex';
        const completion = total > 0 ? Math.round((solvedCount / chapterQuestions.length) * 100) : 0;
        statsRow.innerHTML = `
            <div class="stat-box"><div class="stat-value">${accuracy}%</div><div class="stat-label">Accuracy</div></div>
            <div class="chapter-progress-bar">
                <div class="chapter-progress-fill" style="width: ${completion}%;"></div>
            </div>
            <div class="stat-box"><div class="stat-value">${avgTime}s</div><div class="stat-label">Avg Time</div></div>
        `;
    }

    let container = document.getElementById('questions-grid-container');
    if (!container) return;
    container.innerHTML = '';

    filteredQuestions.forEach((q, idx) => {
        let statusClass = q.status === 'solved' ? 'status-solved' : (q.status === 'error' ? 'status-unsolved' : (q.status === 'wrong' ? 'status-wrong' : 'status-unsolved'));
        let statusText = q.status === 'solved' ? 'Resolved' : (q.status === 'error' ? 'Flawed' : (q.status === 'wrong' ? 'Wrong' : 'Unexecuted'));
        let timeDisplay = q.timeTaken ? `<div style="font-size:12px; color:#8a8ad3; margin-top:4px;">⏱ ${Math.floor(q.timeTaken / 60)}:${(q.timeTaken % 60).toString().padStart(2, '0')}</div>` : '';

        let imgHtml = '';
        if (q.imageDataUrl && q.imageDataUrl.length > 100) {
            imgHtml = `<img src="${q.imageDataUrl}" style="max-width:100%; border-radius:8px;">`;
        } else if (q.driveImageId) {
            imgHtml = `<img data-drive-id="${q.driveImageId}" data-qid="${q.id}" class="lazy-practice-img" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='90'><rect width='100%' height='100%' fill='%2312121a'/><text x='50%' y='50%' fill='%23444a6a' font-family='sans-serif' font-size='11' text-anchor='middle' alignment-baseline='middle'>Waiting for scroll...</text></svg>" style="max-width:100%; border-radius:8px; transition: opacity 0.3s;">`;
        } else {
            imgHtml = `<div style="padding:20px; font-size:12px; color:var(--text-muted); text-align:center;">No visual asset mapped</div>`;
        }

        let card = document.createElement('div');
        card.className = 'question-card';
        card.innerHTML = `
            <div class="card-close-btn" onclick="event.stopPropagation(); deleteQuestion('${q.id}')" title="Delete Question" style="position: absolute; top: 12px; right: 36px; cursor: pointer; font-size: 22px; color: #4a4a6a; z-index: 5; line-height: 0.8;">×</div>
            <div class="three-dot" onclick="event.stopPropagation(); openEditQuestionModal('${q.id}')">⋮</div>
            <div style="display:flex; justify-content:space-between;"><strong>Q ${idx + 1}</strong><span class="status-badge ${statusClass}">${statusText}</span></div>
            <div class="question-preview-text">${imgHtml}</div>
            ${timeDisplay}
            <button class="btn btn-primary practice-single-btn" data-index="${idx}" style="width:100%; margin-top:12px;">Practice →</button>
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
    document.getElementById('hide-photo-toggle').textContent = '📷 Occult Bounded Visual';
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
    document.getElementById('hide-photo-toggle').textContent = '📷 Occult Bounded Visual';
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
        alert('🔥 Bounty won! Next 3 questions are guaranteed critical hits.\nYour fire is now purple!');
    } else {
        q.bountyLockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        q.criticalDeficit = true;

        baseTargets[q.subject] = (baseTargets[q.subject] || 10) + 5;
        let inputId = q.subject === 'physics' ? 'set-tgt-phys' : (q.subject === 'chemistry' ? 'set-tgt-chem' : 'set-tgt-math');
        document.getElementById(inputId).value = baseTargets[q.subject];

        AppState.activeTargets[q.subject] = Math.round(baseTargets[q.subject] * AppState.moodMultiplier);
        saveTargets();
        updateUI();

        alert('❌ Bounty failed. Problem locked for 24h and daily target increased by 5.');
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
    document.getElementById('hide-photo-toggle').textContent = '📷 Occult Bounded Visual';
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
        '📷 Reveal Bounded Visual' : '📷 Occult Bounded Visual';
    renderPracticeQuestionModal();
}

export function renderLatexInElement() {
    let el = document.getElementById('latex-render');
    if (el && window.katex) {
        let text = el.innerText;
        el.innerHTML = text.replace(/\$\$([\s\S]+?)\$\$|\$([^\$]+)\$/g, (match, block, inline) => {
            try { return window.katex.renderToString(block || inline, { throwOnError: false }); } catch (e) { return match; }
        });
    }
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
            questionImageHtml = `<img id="practice-modal-img" src="${AppState.currentQ.imageDataUrl}" style="max-width:100%; max-height:250px; border-radius:16px; margin-bottom:16px; transition: opacity 0.3s;">`;
        } else if (AppState.currentQ.driveImageId && typeof AppState.driveAccessToken !== 'undefined' && AppState.driveAccessToken) {
            questionImageHtml = `<img id="practice-modal-img" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='90'><rect width='100%' height='100%' fill='%2312121a'/><text x='50%' y='50%' fill='%23444a6a' font-family='sans-serif' font-size='11' text-anchor='middle' alignment-baseline='middle'>Downloading Asset...</text></svg>" style="max-width:100%; max-height:250px; border-radius:16px; margin-bottom:16px;">`;
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
        `<div><div class="diagram-hint">📐 Structural Appendix:</div><img src="${AppState.currentQ.diagramImageUrl}" style="max-width:100%; max-height:200px; border-radius:12px;"></div>` :
        '';
    let html =
        `<div style="text-align:center;">${questionImageHtml}${diagramHtml}`;
    if (AppState.currentQ.extractedText) html +=
        `<div class="latex" id="latex-render">${escapeHtml(AppState.currentQ.extractedText)}</div>`;

    if (submitted) {
        const correctAns = AppState.currentQ.correctAnswer || 'N/A';
        html += `<div style="display:flex; justify-content:space-between; align-items:center;">`;
        if (AppState.currentQ.status === 'solved') html +=
            `<div class="result-banner correct" style="flex:1;">✅ Correct! Answer: ${correctAns}</div>`;
        else if (AppState.currentQ.status === 'wrong' || AppState.currentQ.status === 'error') html +=
            `<div class="result-banner wrong" style="flex:1;">❌ Wrong! Correct answer: ${correctAns}</div>`;
        else html +=
            `<div class="result-banner wrong" style="flex:1;">Answer shown. Correct answer: ${correctAns}</div>`;
        if (AppState.currentQ.solution && AppState.currentQ.solution.trim().length > 0) {
            html +=
                `<button class="btn show-solution-btn" style="margin-left:12px;" onclick="showSolutionPopup()">💡 View Solution</button>`;
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

        if (AppState.currentQ.extractedText) renderLatexInElement();
        return;
    }

    if (AppState.currentQ.type === 'mcq' && AppState.currentQ.options.length) {
        const isMulti = Array.isArray(AppState.currentQ.correctAnswer);
        html += `<div style="margin-top:16px;"><strong>${isMulti ? 'Select all that apply' : 'Select your answer'}:</strong><br>`;
        AppState.currentQ.options.forEach(opt => {
            html += `<div class="mcq-option ${isMulti ? 'multi-option' : ''}"
                          data-option="${escapeAttribute(opt)}">
                    ${escapeHtml(opt)}
                  </div>`;
        });
        html += `</div>`;
        document.getElementById('practice-submit-btn').style.display = 'inline-block';
        document.getElementById('practice-submit-btn').innerText = 'Submit Answer';

    } else if (AppState.currentQ.type === 'numeric') {
        html +=
            `<div class="input-group" style="margin-top:16px;"><label>Numeric answer:</label><input type="number" step="any" id="numeric-answer-input" class="pomo-input" placeholder="0.00"></div>`;
        document.getElementById('practice-submit-btn').style.display = 'inline-block';
        document.getElementById('practice-submit-btn').innerText = 'Submit Answer';
    } else {
        html +=
            `<p style="margin-top:16px; color:#cbd5e1;">This is a text‑based question.</p>`;
        document.getElementById('practice-submit-btn').style.display = 'inline-block';
        document.getElementById('practice-submit-btn').innerText = 'Show Answer';
    }
    html += `</div>`;
    container.innerHTML = html;
    container.querySelectorAll('.mcq-option').forEach(el => {
        el.addEventListener('click', function (e) {
            const optionText = this.getAttribute('data-option');
            toggleMcqOption(this, optionText);
        });
    });
    container.querySelectorAll('.mcq-option').forEach(opt => {
        const raw = opt.getAttribute('data-option');
        if (!raw || !window.katex) return;
        opt.textContent = raw;
        opt.innerHTML = raw.replace(
            /\$\$([\s\S]+?)\$\$|\$([^\$]+)\$/g,
            (match, displayMath, inlineMath) => {
                try {
                    return katex.renderToString(displayMath || inlineMath, {
                        throwOnError: false,
                        displayMode: !!displayMath
                    });
                } catch (e) {
                    return match;
                }
            }
        );
    });
    if (AppState.currentQ.extractedText) renderLatexInElement();
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
                alert("Please select at least one option.");
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
                alert("Please select an option.");
                return;
            }

            const optIndex = AppState.currentQ.options.indexOf(AppState.selectedMcq);
            if (optIndex === -1) {
                alert("Invalid selection.");
                return;
            }

            userAns = String.fromCharCode(65 + optIndex);
            isCorrect = (userAns.toLowerCase() === AppState.currentQ.correctAnswer.toLowerCase());
        }

    } else if (AppState.currentQ.type === 'numeric') {
        const numVal = document.getElementById('numeric-answer-input')?.value;
        if (numVal === undefined || numVal === "") {
            alert("Enter a numeric answer.");
            return;
        }
        userAns = parseFloat(numVal).toString();
        const userNum = parseFloat(userAns);
        const correctNum = parseFloat(AppState.currentQ.correctAnswer);
        isCorrect = Math.abs(userNum - correctNum) < 1e-6;

    } else if (AppState.currentQ.type === 'text') {
        alert(`Correct answer: ${AppState.currentQ.correctAnswer || 'No answer provided'}`);
        AppState.practiceSubmittedFlags[AppState.currentPracticeIndex] = true;
        AppState.currentQ.timeTaken = AppState.practiceSeconds;
        AppState.currentQ.status = 'unsolved';
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

    saveAllAsync().catch(console.error);

    if (AppState.bountyMode) {
        evaluateBountyOutcome(isCorrect);
        return;
    }

    renderPracticeQuestionModal();

    if (!isCorrect) {
        setTimeout(() => {
            const cont = document.getElementById('practice-modal-content');
            if (cont) {
                const btn = document.createElement('button');
                btn.className = 'btn btn-danger';
                btn.innerText = 'Log to Error Matrix';
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
        `<button class="btn btn-success" id="text-correct-btn" style="flex:1; max-width:160px;">I was correct</button>
         <button class="btn btn-danger" id="text-wrong-btn" style="flex:1; max-width:160px;">I was wrong</button>`;
    container.appendChild(btnContainer);

    document.getElementById('text-correct-btn').onclick = () => {
        const wasAlreadySolved = (AppState.currentQ.status === 'solved');
        // Lock first-attempt result — only the first attempt counts for accuracy.
        if (!AppState.currentQ.firstAttemptResult) AppState.currentQ.firstAttemptResult = 'correct';
        AppState.currentQ.status = 'solved';
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
        banner.innerText = 'Marked as correct.';
        container.appendChild(banner);
        document.getElementById('practice-submit-btn').style.display = 'none';
    };

    document.getElementById('text-wrong-btn').onclick = () => {
        // Lock first-attempt result — only the first attempt counts for accuracy.
        if (!AppState.currentQ.firstAttemptResult) AppState.currentQ.firstAttemptResult = 'incorrect';
        AppState.currentQ.status = 'wrong';
        saveAllAsync().catch(console.error);
        if (AppState.bountyMode) {
            evaluateBountyOutcome(false);
            return;
        }
        btnContainer.remove();
        const banner = document.createElement('div');
        banner.className = 'result-banner wrong';
        banner.innerText = 'Marked as wrong.';
        container.appendChild(banner);
        const logBtn = document.createElement('button');
        logBtn.className = 'btn btn-danger';
        logBtn.innerText = 'Log to Error Matrix';
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
    contentEl.innerHTML = escapeHtml(solutionText);
    if (window.katex) {
        contentEl.innerHTML = solutionText.replace(/\$\$([\s\S]+?)\$\$|\$([^\$]+)\$/g, (match, block, inline) => {
            try {
                return window.katex.renderToString(block || inline, { throwOnError: false, displayMode: !!block });
            } catch (e) { return match; }
        });
    }
    openModal('solution-modal');
}

export function confirmErrorLog() {
    let reason = document.getElementById('error-reason-select').value;
    AppState.pendingWrongQ.status = 'error';
    AppState.pendingWrongQ.errorReason = reason;
    saveAllAsync().catch(console.error);
    alert("Logged to Error Matrix.");
    closeModalStr('error-reason-modal');
    renderErrorMatrixFromBank();
    renderPracticeQuestionModal();
}

export function practiceNext() {
    if (AppState.currentPracticeIndex + 1 < AppState.practiceQuestions.length) {
        AppState.currentPracticeIndex++;
        AppState.practiceSeconds = 0;
        updatePracticeTimerDisplay();
        renderPracticeQuestionModal();
    } else {
        clearInterval(AppState.practiceTimer);
        closePracticeModal();
        alert("All questions completed!");
        showQuestionList();
    }
}

export function practicePrev() {
    if (AppState.currentPracticeIndex > 0) {
        AppState.currentPracticeIndex--;
        AppState.practiceSeconds = 0;
        updatePracticeTimerDisplay();
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
    if (confirm("Permanently delete this question from your local database and Google Drive cloud storage?")) {
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
        btn.textContent = document.body.classList.contains('immersive-active') ? '🔲 Exit' : '🕶 Immersive';
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
    const todayStr = new Date().toISOString().split('T')[0];
    const lastCalDate = await idbGet('jeemax_last_calibrated_date');
    if (lastCalDate === todayStr) {
        AppState.activeTargets.physics = Math.round(baseTargets.physics * AppState.moodMultiplier);
        AppState.activeTargets.chemistry = Math.round(baseTargets.chemistry * AppState.moodMultiplier);
        AppState.activeTargets.maths = Math.round(baseTargets.maths * AppState.moodMultiplier);
    } else {
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
window.renderLatexInElement = renderLatexInElement;
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
    let committedOutlines = [];       // [{outline:[[x,y]...], color:"#hex"}, ...] cached
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
        try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* pointer gone */ }
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
    // On pointer release, flatten the completed stroke permanently onto the
    // background bitmap layer. This is the only moment we write to bgCanvas.
    // The committedOutlines array is kept solely for resize recovery — it is
    // never iterated in the hot render() path.
    function onCanvasPointerUp(e) {
        if (!isActive) return;
        // ── Apple Pencil drawing lock ──
        if (e.pointerType !== 'pen') return;
        if (!isDrawing) return;

        // Cancel any pending rAF render — stroke is about to be committed
        // to the background bitmap, so a stale foreground paint is wasteful.
        if (renderRequested) {
            cancelAnimationFrame(rafId);
            renderRequested = false;
            rafId = 0;
        }

        isDrawing = false;
        currentPointerType = '';
        if (currentPoints.length && bgCanvas && bgCtx) {
            var dpr = window.devicePixelRatio || 1;
            bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            bgCtx.lineCap = 'round';
            bgCtx.lineJoin = 'round';
            if (getStrokeFn) {
                var outline = getStrokeFn(currentPoints, currentStrokeOpts);
                fillOutline(outline, selectedColor, bgCtx);
                committedOutlines.push({ outline: outline, color: selectedColor });
            } else {
                drawFallbackStroke(currentPoints, selectedColor, bgCtx);
                committedOutlines.push({ outline: currentPoints.slice(), color: selectedColor, fallback: true });
            }
        }
        currentPoints = [];
        // Clear the live foreground canvas — ready for the next stroke
        if (canvas && ctx) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
        }
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* released */ }
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
        // Redraw all committed strokes onto the background bitmap accumulator
        for (var i = 0; i < committedOutlines.length; i++) {
            var s = committedOutlines[i];
            if (s.fallback) drawFallbackStroke(s.outline, s.color, bgCtx);
            else fillOutline(s.outline, s.color, bgCtx);
        }
        // If an active stroke exists, repaint it on the foreground
        if (!sizeUnchanged) render();
    }

    // Clear BOTH canvas surfaces and empty all auxiliary memory arrays.
    function clearCanvas() {
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
    }
    function removeBlockers() {
        if (blockGesture) {
            document.removeEventListener('gesturestart', blockGesture);
            document.removeEventListener('gesturechange', blockGesture);
            document.removeEventListener('gestureend', blockGesture);
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
            installBlockers();
            pencilBtn.style.background = 'rgba(34,197,94,0.22)';
            pencilBtn.style.boxShadow = '0 0 0 1px rgba(34,197,94,0.7), 0 0 14px rgba(34,197,94,0.45)';
            closeDropdown();
        } else {
            clearCanvas();
            canvas.style.pointerEvents = 'none';
            document.body.classList.remove('scratchpad-active');
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
            class: 'sp-sw sp-plus', role: 'button', tabindex: '0', title: 'More colors',
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
                class: 'sp-qx', role: 'button', tabindex: '0', title: 'Remove from quick colors',
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
                touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none',
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
                touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none',
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
            class: 'sp-btn', role: 'button', tabindex: '0', title: 'Toggle scratchpad',
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
            class: 'sp-btn', role: 'button', tabindex: '0', title: 'Pick color',
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
            class: 'sp-btn', role: 'button', tabindex: '0', title: 'Clear canvas',
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
        header.appendChild(el('div', { style: { fontWeight: '600', fontSize: '14px', color: '#f1f5f9' } }, ['Pick a color']));
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
            class: 'sp-big', role: 'button', tabindex: '0', title: 'Open system color picker',
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
            type: 'text', maxlength: '7', spellcheck: 'false', title: 'Hex color',
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
        qmHeader.appendChild(el('div', { style: { fontSize: '12px', color: '#94a3b8', fontWeight: '500' } }, ['Quick colors']));
        addBtn = el('div', {
            role: 'button', tabindex: '0', title: 'Add current color to quick colors',
            style: {
                display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px',
                color: '#e5e7eb', background: 'rgba(255,255,255,0.08)',
                padding: '5px 10px', borderRadius: '8px', cursor: 'pointer',
                transition: 'background 0.12s ease',
            },
            html: '<span style="display:flex;align-items:center">' + ICON_PLUS + '</span> Add current',
            onclick: addQuick,
        });
        addBtn.addEventListener('pointerenter', function () { addBtn.style.background = 'rgba(255,255,255,0.16)'; });
        addBtn.addEventListener('pointerleave', function () { addBtn.style.background = 'rgba(255,255,255,0.08)'; });
        qmHeader.appendChild(addBtn);
        paletteBox.appendChild(qmHeader);

        quickManageRow = el('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', minHeight: '36px' } });
        paletteBox.appendChild(quickManageRow);

        paletteBox.appendChild(el('div', { style: { fontSize: '11px', color: '#475569' } }, ['Up to 8 quick colors · tap × to remove · changes are saved automatically']));

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
