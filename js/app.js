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
    const visualizer = document.getElementById('streak-visualizer');
    if (!visualizer) return;
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
    const catText = document.getElementById('cat-text');
    if (overallPct >= 100) {
        catText.textContent = `All Daily Targets Complete! 🚀`;
        catText.className = "cat-text glow-green";
    } else {
        catText.textContent = `Daily Targets: ${overallPct}% Complete`;
        catText.className = "cat-text glow-orange";
    }

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

// ==================== PREDICTIVE MOMENTUM ENGINE ====================
export async function renderGraph() {
    const svg = document.getElementById('dynamic-graph');
    if (!svg) return;
    svg.innerHTML = '';

    let history = await getDailyHistory();
    let counts = history.map(h => h.count);

    if (counts.length === 1) {
        counts.unshift(counts[0]);
    }

    let n = counts.length;

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += counts[i];
        sumXY += i * counts[i];
        sumXX += i * i;
    }
    let slope = (n * sumXY - sumX * sumY) / ((n * sumXX - sumX * sumX) || 1);
    let intercept = (sumY - slope * sumX) / n;

    let predictions = [];
    for (let i = n; i < n + 5; i++) {
        let predictedVal = slope * i + intercept;
        predictions.push(Math.max(0, parseFloat(predictedVal.toFixed(1))));
    }

    let themeColor = '#8b5cf6';
    if (slope > 0.2) themeColor = '#22c55e';
    if (slope < -0.2) themeColor = '#f87171';

    const width = 320;
    const height = 80;
    const paddingLeft = 15;
    const paddingRight = 15;
    const paddingTop = 10;
    const paddingBottom = 10;

    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    let maxVal = Math.max(...counts, ...predictions, 10);

    const getX = (index, isPrediction) => {
        if (!isPrediction) {
            return paddingLeft + (index / (n - 1)) * (plotWidth * 0.7);
        } else {
            return paddingLeft + (plotWidth * 0.7) + ((index + 1) / predictions.length) * (plotWidth * 0.3);
        }
    };

    const getY = (val) => {
        let ratio = val / maxVal;
        return paddingTop + plotHeight - (ratio * plotHeight);
    };

    const ns = "http://www.w3.org/2000/svg";

    for (let level = 0.25; level <= 1.0; level += 0.25) {
        let lineY = getY(maxVal * level);
        let grid = document.createElementNS(ns, 'line');
        grid.setAttribute('x1', paddingLeft.toString());
        grid.setAttribute('y1', lineY.toString());
        grid.setAttribute('x2', (width - paddingRight).toString());
        grid.setAttribute('y2', lineY.toString());
        grid.setAttribute('stroke', 'rgba(255, 255, 255, 0.03)');
        grid.setAttribute('stroke-width', '1');
        svg.appendChild(grid);
    }

    let divX = getX(n - 1, false);
    let divider = document.createElementNS(ns, 'line');
    divider.setAttribute('x1', divX.toString());
    divider.setAttribute('y1', paddingTop.toString());
    divider.setAttribute('x2', divX.toString());
    divider.setAttribute('y2', (height - paddingBottom).toString());
    divider.setAttribute('stroke', 'rgba(255, 255, 255, 0.08)');
    divider.setAttribute('stroke-dasharray', '2 2');
    svg.appendChild(divider);

    let pastPoints = [];
    for (let i = 0; i < n; i++) {
        pastPoints.push(`${getX(i, false)},${getY(counts[i])}`);
    }
    let pastPathStr = "M " + pastPoints.join(" L ");

    let pastPath = document.createElementNS(ns, 'path');
    pastPath.setAttribute('d', pastPathStr);
    pastPath.setAttribute('fill', 'none');
    pastPath.setAttribute('stroke', themeColor);
    pastPath.setAttribute('stroke-width', '2.5');
    pastPath.setAttribute('stroke-linecap', 'round');
    pastPath.setAttribute('filter', `drop-shadow(0px 0px 5px ${themeColor}a0)`);
    svg.appendChild(pastPath);

    let defs = svg.querySelector('defs') || document.createElementNS(ns, 'defs');
    if (!svg.querySelector('defs')) svg.appendChild(defs);

    let oldGrad = document.getElementById('dynamic-glow-gradient');
    if (oldGrad) oldGrad.remove();

    let grad = document.createElementNS(ns, 'linearGradient');
    grad.setAttribute('id', 'dynamic-glow-gradient');
    grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
    grad.setAttribute('x2', '0%'); grad.setAttribute('y2', '100%');
    grad.innerHTML = `
        <stop offset="0%" stop-color="${themeColor}" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="${themeColor}" stop-opacity="0.0"/>
    `;
    defs.appendChild(grad);

    let pastAreaStr = pastPathStr + ` L ${getX(n - 1, false)},${getY(0)} L ${getX(0, false)},${getY(0)} Z`;
    let pastArea = document.createElementNS(ns, 'path');
    pastArea.setAttribute('d', pastAreaStr);
    pastArea.setAttribute('fill', `url(#dynamic-glow-gradient)`);
    svg.appendChild(pastArea);

    let predPoints = [`${getX(n - 1, false)},${getY(counts[n - 1])}`];
    for (let i = 0; i < predictions.length; i++) {
        predPoints.push(`${getX(i, true)},${getY(predictions[i])}`);
    }
    let predPathStr = "M " + predPoints.join(" L ");

    let predPath = document.createElementNS(ns, 'path');
    predPath.setAttribute('d', predPathStr);
    predPath.setAttribute('fill', 'none');
    predPath.setAttribute('stroke', themeColor);
    predPath.setAttribute('stroke-width', '2');
    predPath.setAttribute('stroke-dasharray', '4 3');
    predPath.setAttribute('stroke-linecap', 'round');
    svg.appendChild(predPath);

    let todayCircle = document.createElementNS(ns, 'circle');
    todayCircle.setAttribute('cx', getX(n - 1, false).toString());
    todayCircle.setAttribute('cy', getY(counts[n - 1]).toString());
    todayCircle.setAttribute('r', '3.5');
    todayCircle.setAttribute('fill', '#ffffff');
    todayCircle.setAttribute('stroke', themeColor);
    todayCircle.setAttribute('stroke-width', '1.5');
    svg.appendChild(todayCircle);
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
        saveAllAsync().catch(console.error);
        renderPracticeQuestionModal();
        addTextQuestionFollowUp();
        return;
    }

    AppState.practiceSubmittedFlags[AppState.currentPracticeIndex] = true;
    AppState.currentQ.timeTaken = AppState.practiceSeconds;

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
    const modal = document.querySelector('#practice-modal .modal-card');
    if (modal) {
        const rect = modal.getBoundingClientRect();
        originX = rect.left + rect.width / 2;
        originY = rect.top + rect.height / 2;
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
const streakCanvas = document.getElementById('streak-canvas');
const streakCtx = streakCanvas ? streakCanvas.getContext('2d') : null;

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

function drawParticles(config) {
    for (let p of particles) {
        const gx = Math.round(p.x), gy = Math.round(p.y);
        if (gx >= 0 && gx < 16 && gy >= 0 && gy < 16 && config.palette[p.color]) {
            streakCtx.fillStyle = config.palette[p.color];
            streakCtx.fillRect(gx, gy, 1, 1);
        }
    }
}

function getConfigForStreak(streak) {
    if (streak >= 5) return fireConfigs.purple;
    if (streak >= 3) return fireConfigs.blue;
    if (streak >= 1) return fireConfigs.yellow;
    return null;
}

function renderLoop(timestamp) {
    if (!streakCtx) return;

    const config = getConfigForStreak(AppState.practiceCorrectStreak);
    if (!config) {
        if (streakCtx) streakCtx.clearRect(0, 0, 16, 16);
        if (streakCanvas) streakCanvas.style.filter = 'none';
        particles = [];
        lastTime = timestamp;
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
        drawParticles(config);
    }
    requestAnimationFrame(renderLoop);
}

if (streakCanvas) requestAnimationFrame(renderLoop);

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
window.activateOverheat = activateOverheat;
window.toggleImmersive = toggleImmersive;
window.confirmTimerNotification = confirmTimerNotification;
window.toggleMiniWidget = toggleMiniWidget;

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

