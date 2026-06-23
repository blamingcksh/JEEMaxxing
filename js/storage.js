/**
 * storage.js — Data persistence, IndexedDB, cloud sync, and shared mutable state.
 *
 * Cross-module imports (resolved when other modules are extracted):
 *   - lockTargetsOnly  → from settings.js (or ui.js)
 *   - updateUI         → from ui.js
 *   - updateStudyTimeHeader → from ui.js
 *   - renderGraph      → from ui.js
 *   - renderErrorMatrixFromBank → from ui.js
 *
 * These are imported lazily via getUiCallbacks() so the module can be
 * unit-tested without the full DOM graph present.
 */

// ---------------------------------------------------------------------------
//  Lazy UI-callback bridge — set from app.js during bootstrap
// ---------------------------------------------------------------------------
let _uiCallbacks = {};

/** Called once by app.js to inject UI functions that storage depends on. */
export function registerUiCallbacks(callbacks) {
    _uiCallbacks = callbacks;
}

function _ui(fnName, ...args) {
    if (typeof _uiCallbacks[fnName] === 'function') return _uiCallbacks[fnName](...args);
}

// ==================== INDEXEDDB STORAGE LAYER ====================
export const DB_NAME = 'jeemaxxing_db';
export const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('storage')) {
                db.createObjectStore('storage', { keyPath: 'key' });
            }
        };
    });
    return dbPromise;
}

export async function idbSet(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('storage', 'readwrite');
        const store = tx.objectStore('storage');
        store.put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function idbGet(key) {
    const db = await openDB();
    const tx = db.transaction('storage', 'readonly');
    const store = tx.objectStore('storage');
    const request = store.get(key);
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result ? request.result.value : null);
        request.onerror = () => reject(request.error);
    });
}

export async function idbRemove(key) {
    const db = await openDB();
    const tx = db.transaction('storage', 'readwrite');
    const store = tx.objectStore('storage');
    store.delete(key);
    await tx.complete;
}

export async function idbClear() {
    const db = await openDB();
    const tx = db.transaction('storage', 'readwrite');
    const store = tx.objectStore('storage');
    store.clear();
    await tx.complete;
}

// ==================== GLOBAL STATE ====================
export const AppState = {
    // User-specified reactive states
    currentSubject: 'physics',
    currentChapter: '',
    currentChapterQuestions: [],
    practiceQuestions: [],
    currentPracticeIndex: 0,
    practiceSeconds: 0,
    selectedMcq: null,
    currentQ: null,
    pendingWrongQ: null,
    photoHidden: false,
    practiceSubmittedFlags: [],
    currentFilter: 'all',
    bountyMode: false,
    profilePicData: null,
    newErrorPicData: null,
    moodMultiplier: 1.0,
    currentErrorSubject: 'physics',
    calMonthOffset: 0,
    geminiApiKey: '',
    practiceCorrectStreak: 0,
    extractedItems: [],
    // Additional cross-module mutable state
    questionBank: [],
    practiceTimer: null,
    chapters: { physics: ["Kinematics", "Thermodynamics"], chemistry: ["Mole Concept"], maths: ["Calculus"] },
    bounty: {
        date: null,
        questionId: null,
        timeLimit: 0,
        active: false,
        payoffCount: 0,
        done: false
    },
    activeTargets: { physics: 10, chemistry: 10, maths: 10 },
    driveAccessToken: null,
    cloudFolderId: null,
    tokenClient: undefined,
    imageFetchCache: {},
    cropState: {
        currentBase64: null,
        questions: [],
        resolve: null,
        canvas: null,
        ctx: null,
        imageElement: null,
        startX: 0,
        startY: 0,
        drawing: false,
        rect: null,
        isDiagramCrop: false
    },
    visualMode: 'bar',
    // ── Error Matrix: active practice log drawer state ──
    activePracticeDrawerId: null,
};


export const baseTargets = { physics: 10, chemistry: 10, maths: 10 };
export const baseErrorTargets = { physics: 5, chemistry: 5, maths: 5 };
export const solved = { physics: 0, chemistry: 0, maths: 0 };
export const studySecs = { physics: 0, chemistry: 0, maths: 0 };
export const monthNamesCal = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

// Core data mutation: increment/decrement solved counter for a subject
// Core data mutation: increment/decrement solved counter for a subject
export function changeCount(subject, delta) {
    solved[subject] = Math.max(0, solved[subject] + delta);
    saveAllAsync().catch(console.error);
    
    // ⚡ INSTANT DASHBOARD HOT-RELOAD: Push data updates live to the UI without forcing a page refresh
    _ui('updateUI');
    _ui('updateStudyTimeHeader');
    _ui('renderGraph');
    _ui('renderErrorMatrixFromBank');
}

// ==================== SPACED REPETITION ENGINE ====================
// Multi-variable SM-2 variant for JEEMaxxing Error Matrix.

export const SR_FRICTION_WEIGHTS = {
    PERFECT:  1.20,
    CALC:     0.85,
    FORMULA:  0.60,
    CONCEPT:  0.35,
    APPROACH: 0.15,
};

export const SR_FRICTION_LABELS = {
    PERFECT:  'Perfect Execution',
    CALC:     'Calculation Error',
    FORMULA:  'Formula / Property Lapse',
    CONCEPT:  'Conceptual Gap',
    APPROACH: 'Application / Approach Blank',
};

export const SR_AUTONOMY_SCORES = {
    independent:   1.0,
    hint_used:     0.5,
    solution_read: 0.0,
};

export const SR_FRICTION_TYPES = ['PERFECT', 'CALC', 'FORMULA', 'CONCEPT', 'APPROACH'];

/**
 * Step 1 — Friction Severity Weight (Wf)
 * Uses the worst (lowest) friction weight among selections.
 */
export function calculateFrictionWeight(frictionTypes) {
    if (!frictionTypes || frictionTypes.length === 0) return 0.60;
    const weights = frictionTypes.map(f => SR_FRICTION_WEIGHTS[f] ?? 0.60);
    return Math.min(...weights);
}

/**
 * Step 2 — Performance Quality (q), clamped [0.0, 5.0]
 *
 * q = (A × 3.0) + max(0.0, 2.0 − Rt)
 *   A  = autonomy score
 *   Rt = timeSpentMins / targetTimeMins
 */
export function calculatePerformanceQ(autonomy, timeSpentMins, targetTimeMins) {
    const A  = SR_AUTONOMY_SCORES[autonomy] ?? 0.5;
    const Rt = targetTimeMins > 0 ? timeSpentMins / targetTimeMins : 1.0;
    const q  = (A * 3.0) + Math.max(0.0, 2.0 - Rt);
    return Math.min(5.0, Math.max(0.0, q));
}

/**
 * Step 3 — Update Ease Factor (EF)
 *
 * EF_new = EF_current + (0.1 − (5.0 − q) × (0.08 + (5.0 − q) × 0.02))
 * Floor: max(1.3, EF_new)
 */
export function calculateNewEaseFactor(currentEF, performanceQ) {
    const qGap      = 5.0 - performanceQ;
    const adjustment = 0.1 - qGap * (0.08 + qGap * 0.02);
    const newEF     = currentEF + adjustment;
    return Math.max(1.3, newEF);
}

/**
 * Step 4 — Compute Next Interval (I_next)
 *
 * Correct:
 *   I_current == 0 → 1 day
 *   I_current == 1 → 3 days
 *   else           → ceil(I_current × EF_new × Wf)
 *
 * Incorrect:
 *   max(1, floor(I_current × Wf))
 */
export function calculateNextInterval(currentInterval, result, newEaseFactor, frictionWeight) {
    if (result === 'correct') {
        if (currentInterval === 0) return 1;
        if (currentInterval === 1) return 3;
        return Math.ceil(currentInterval * newEaseFactor * frictionWeight);
    } else {
        return Math.max(1, Math.floor(currentInterval * frictionWeight));
    }
}

/**
 * Master pipeline — runs all 4 SR steps and returns computed values.
 *
 * @param {Object} question  — question object from AppState.questionBank
 * @param {Object} attempt   — { result, autonomy, frictionTypes[], timeSpentMins }
 * @returns {{ newInterval, newEaseFactor, performanceQ, frictionWeight, nextReviewAt, isMastered }}
 */
export function computeSR(question, attempt) {
    const currentInterval = question.currentInterval ?? 0;
    const currentEF       = question.easeFactor ?? 2.5;
    const targetTime      = question.targetTimeMins ?? 5;

    const Wf = calculateFrictionWeight(attempt.frictionTypes);
    const q  = calculatePerformanceQ(attempt.autonomy, attempt.timeSpentMins, targetTime);
    const EF = calculateNewEaseFactor(currentEF, q);
    const In = calculateNextInterval(currentInterval, attempt.result, EF, Wf);

    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + In);

    const isMastered = In > 30 && EF > 2.5 && attempt.result === 'correct';

    return {
        newInterval:     In,
        newEaseFactor:   Math.round(EF * 1000) / 1000,
        performanceQ:    Math.round(q * 100) / 100,
        frictionWeight:  Wf,
        nextReviewAt:    nextReviewAt.toISOString(),
        isMastered,
    };
}

/**
 * Derive a human-readable due status from a question's SR state.
 *
 * Returns: { status: 'ready'|'due_soon'|'scheduled'|'mastered', label: string, daysUntil: number }
 */
export function getDueStatus(question) {
    if (question.isMastered) {
        return { status: 'mastered', label: '💤 Mastered', daysUntil: Infinity };
    }

    const next = new Date(question.nextReviewAt || question.createdAt || Date.now());
    const now  = new Date();
    const diffMs = next.getTime() - now.getTime();
    const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (daysUntil <= 0) {
        return { status: 'ready', label: '🟢 Ready', daysUntil: 0 };
    }
    if (daysUntil <= 3) {
        return { status: 'due_soon', label: `⏳ Due in ${daysUntil}d`, daysUntil };
    }
    return { status: 'scheduled', label: `📅 Due in ${daysUntil}d`, daysUntil };
}

/**
 * Format a Date for tooltip display.
 */
export function formatSRDate(isoString) {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

/**
 * One-time migration: backfill SR fields onto every question in the bank
 * that doesn't have them yet.  Call once from initApp().
 */
export function migrateQuestionBankSR() {
    let dirty = false;
    for (const q of AppState.questionBank) {
        if (q.currentInterval === undefined) { q.currentInterval = 0; dirty = true; }
        if (q.easeFactor      === undefined) { q.easeFactor      = 2.5; dirty = true; }
        if (q.targetTimeMins  === undefined) { q.targetTimeMins  = 5;   dirty = true; }
        if (q.isMastered      === undefined) { q.isMastered      = false; dirty = true; }
        if (!q.nextReviewAt)  { q.nextReviewAt = new Date().toISOString(); dirty = true; }
        if (!Array.isArray(q.historyLogs)) { q.historyLogs = []; dirty = true; }
    }
    if (dirty) saveAllAsync().catch(console.error);
}

// ==================== CLOUD INFRASTRUCTURE (G-DRIVE) ====================
export const MODEL_FALLBACK = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"];
export const CLIENT_ID = '463564668669-2vplpgdd8li1kn47f65f1d0t1q3bb57p.apps.googleusercontent.com';
export const SCOPES = 'https://www.googleapis.com/auth/drive.file';

let syncIntervalId = null;

export function waitForDriveToken(callback) {
    if (AppState.driveAccessToken) {
        callback();
    } else {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if (AppState.driveAccessToken) {
                clearInterval(interval);
                callback();
            } else if (attempts > 20) {
                clearInterval(interval);
                console.warn('Drive token never arrived – lazy loading aborted');
            }
        }, 500);
    }
}

export function handleDriveAuth() {
    AppState.tokenClient.requestAccessToken({ prompt: 'consent' });
}

export async function handleAuthExpiry() {
    await idbRemove('jeemax_drive_token');
    AppState.driveAccessToken = null;
    AppState.cloudFolderId = null;

    document.getElementById('btn-drive-auth').style.display = 'inline-block';
    document.getElementById('drive-status').style.display = 'none';

    const subText = document.getElementById('sync-sub-text');
    if (subText) {
        subText.textContent = "Session Expired. Reconnect Drive.";
        subText.style.color = "var(--glow-red)";
    }
    hideLoading();
}

// ==================== UTILITY FUNCTIONS ====================
export function cleanAndParseJson(rawText) {
    let sanitized = rawText.replace(/```json|```/g, '').trim();
    try { return JSON.parse(sanitized); } catch (initialError) {
        try {
            let multiEscaped = sanitized.replace(/\\([^"\\\/bfnrtu])/g, '\\\\$1');
            return JSON.parse(multiEscaped);
        } catch (secondaryError) {
            throw new Error("Unable to parse JSON: " + secondaryError.message);
        }
    }
}

export async function callGeminiWithFallback(apiKey, prompt, imageBase64Data, mimeType, statusCallback, isJson) {
    let lastError = null;
    for (let model of MODEL_FALLBACK) {
        try {
            if (statusCallback) statusCallback(`Trying model: ${model}...`);
            const parts = [{ text: prompt }];
            if (imageBase64Data && mimeType) parts.push({ inline_data: { mime_type: mimeType,
                    data: imageBase64Data.split(',')[1] } });
            const payload = { contents: [{ parts }] };
            if (isJson) payload.generationConfig = { responseMimeType: "application/json",
                temperature: 0.0 };
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(`${model} failed (${response.status})`);
            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error(`${model} returned empty response`);
            if (statusCallback) statusCallback(`✅ Used model: ${model}`);
            return { text, model };
        } catch (err) { lastError = err; if (statusCallback) statusCallback(
                `⚠️ ${model} failed, trying next...`); }
    }
    throw new Error(`All models failed. Last error: ${lastError?.message}`);
}

export async function cropImageFromBBox(originalDataUrl, bbox) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const width = img.width, height = img.height;
            const x = bbox.x * width, y = bbox.y * height,
                  w = bbox.w * width, h = bbox.h * height;
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
            resolve(canvas.toDataURL('image/png'));
        };
        img.src = originalDataUrl;
    });
}

let loadingTimeout = null;

export function showLoading(msg) {
    document.getElementById('loading-text').innerText = msg;
    document.getElementById('loading-overlay').classList.add('active');
    clearTimeout(loadingTimeout);
    loadingTimeout = setTimeout(() => {
        console.warn('⚠️ Loading overlay auto-hidden after 10s (possible hang)');
        hideLoading();
    }, 10000);
}

export function hideLoading() {
    clearTimeout(loadingTimeout);
    document.getElementById('loading-overlay').classList.remove('active');
}

export function readFileAsBase64(file) {
    return new Promise((resolve, reject) => { let r = new FileReader();
        r.onload = e => resolve(e.target.result);
        r.onerror = reject;
        r.readAsDataURL(file); });
}

export function escapeHtml(str) { return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]); }

export function escapeAttribute(str) {
  return str.replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
}

export function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

export function formatStudyDuration(totalSecs) {
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

// ==================== DATA PERSISTENCE ====================
export async function saveAllAsync() {
    const lightweightBank = AppState.questionBank.map(q => ({
        ...q,
        imageDataUrl: null,
        diagramImageUrl: null
    }));

    await idbSet('jeemax_question_bank', AppState.questionBank);
    await idbSet('jeemax_chapters', AppState.chapters);
    await idbSet('jeemax_solved', solved);
    await idbSet('jeemax_study_secs', studySecs);
    await idbSet('jeemax_bounty', AppState.bounty);
    await idbSet('jeemax_mood_multiplier', AppState.moodMultiplier);
    await idbSet('jeemax_username', document.getElementById('display-username').textContent);
    await idbSet('bounty_data', AppState.bounty);

    // Persist error resolution targets under separate keys
    await idbSet('baseErrPhys', baseErrorTargets.physics);
    await idbSet('baseErrChem', baseErrorTargets.chemistry);
    await idbSet('baseErrMath', baseErrorTargets.maths);

    if (AppState.profilePicData) {
        await idbSet('jeemax_profile_pic', AppState.profilePicData);
    }
    await updateDailyHistory();

    if (typeof AppState.driveAccessToken !== 'undefined' && AppState.driveAccessToken) {
        syncStateToCloud();
    }
}

export async function loadDataAsync() {
    const bank = await idbGet('jeemax_question_bank');
    if (bank) AppState.questionBank = bank;

    const ch = await idbGet('jeemax_chapters');
    if (ch) AppState.chapters = ch;

    const savedBounty = await idbGet('bounty_data');
    if (savedBounty) {
        AppState.bounty.date = savedBounty.date;
        AppState.bounty.active = savedBounty.active;
        AppState.bounty.questionId = savedBounty.questionId;
        AppState.bounty.timeLimit = savedBounty.timeLimit;
        AppState.bounty.payoffCount = savedBounty.payoffCount;
        AppState.bounty.done = savedBounty.done;
    }

    const s = await idbGet('jeemax_solved');
    if (s) {
        solved.physics = s.physics || 0;
        solved.chemistry = s.chemistry || 0;
        solved.maths = s.maths || 0;
    }

    const secs = await idbGet('jeemax_study_secs');
    if (secs) {
        studySecs.physics = secs.physics || 0;
        studySecs.chemistry = secs.chemistry || 0;
        studySecs.maths = secs.maths || 0;
    }

    const mood = await idbGet('jeemax_mood_multiplier');
    if (mood !== null) AppState.moodMultiplier = parseFloat(mood);

    const username = await idbGet('jeemax_username');
    if (username) {
        document.getElementById('display-username').textContent = username;
        document.getElementById('set-username').value = username;
    }

    const pfp = await idbGet('jeemax_profile_pic');
    if (pfp) {
        AppState.profilePicData = pfp;
        document.getElementById('display-pfp').src = pfp;
    }

    const savedKey = await idbGet('gemini_api_key');
    if (savedKey) {
        AppState.geminiApiKey = savedKey;
    }
    const geminiKeyInput = document.getElementById('gemini-key');
    if (geminiKeyInput) geminiKeyInput.value = AppState.geminiApiKey;

    const lockDate = await idbGet('jeeTargetLockDate');
    if (lockDate) {
        const diff = (new Date() - new Date(lockDate)) / (1000 * 60 * 60 * 24);
        if (diff < 1) _ui('lockTargetsOnly');
    }

    const basePhys = await idbGet('basePhys');
    if (basePhys !== null) baseTargets.physics = parseInt(basePhys);
    const baseChem = await idbGet('baseChem');
    if (baseChem !== null) baseTargets.chemistry = parseInt(baseChem);
    const baseMath = await idbGet('baseMath');
    if (baseMath !== null) baseTargets.maths = parseInt(baseMath);

    document.getElementById('set-tgt-phys').value = baseTargets.physics;
    document.getElementById('set-tgt-chem').value = baseTargets.chemistry;
    document.getElementById('set-tgt-math').value = baseTargets.maths;

    // ── Load error resolution targets from separate IndexedDB keys ──
    const errPhys = await idbGet('baseErrPhys');
    if (errPhys !== null) baseErrorTargets.physics = parseInt(errPhys);
    const errChem = await idbGet('baseErrChem');
    if (errChem !== null) baseErrorTargets.chemistry = parseInt(errChem);
    const errMath = await idbGet('baseErrMath');
    if (errMath !== null) baseErrorTargets.maths = parseInt(errMath);

    const errPhysEl = document.getElementById('set-err-phys');
    const errChemEl = document.getElementById('set-err-chem');
    const errMathEl = document.getElementById('set-err-math');
    if (errPhysEl) errPhysEl.value = baseErrorTargets.physics;
    if (errChemEl) errChemEl.value = baseErrorTargets.chemistry;
    if (errMathEl) errMathEl.value = baseErrorTargets.maths;

    // ── Backfill SR fields on legacy question data ──
    migrateQuestionBankSR();
}

// ==================== DRIVE MEDIA HANDLERS ====================

export async function uploadMediaToDrive(base64, filename, folderId, token) {
    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    const contentType = base64.split(';')[0].split(':')[1];
    const base64Data = base64.split(',')[1];

    const metadata = { name: filename, mimeType: contentType, parents: [folderId] };

    const multipartRequestBody =
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: ' + contentType + '\r\n' +
        'Content-Transfer-Encoding: base64\r\n\r\n' +
        base64Data +
        close_delim;

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'multipart/related; boundary=' + boundary
        },
        body: multipartRequestBody
    });
    const data = await res.json();
    return data.id;
}

export async function fetchMediaFromDrive(fileId, token) {
    if (AppState.imageFetchCache[fileId]) {
        return AppState.imageFetchCache[fileId];
    }

    const fetchPromise = (async () => {
        try {
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) return null;
            const blob = await res.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (err) {
            console.error(`Fault fetching file ${fileId}:`, err);
            return null;
        }
    })();

    AppState.imageFetchCache[fileId] = fetchPromise;
    return fetchPromise;
}

export async function cacheAllDriveImages() {
  if (!AppState.driveAccessToken) { alert('Please connect Google Drive first.'); return; }
  showLoading('Caching all Drive images locally…');
  let fixed = 0;
  for (const q of AppState.questionBank) {
    if (q.driveImageId && !q.imageDataUrl) {
      try { q.imageDataUrl = await fetchMediaFromDrive(q.driveImageId, AppState.driveAccessToken); fixed++; } catch (e) {}
    }
    if (q.driveDiagramId && !q.diagramImageUrl) {
      try { q.diagramImageUrl = await fetchMediaFromDrive(q.driveDiagramId, AppState.driveAccessToken); fixed++; } catch (e) {}
    }
  }
  await saveAllAsync();
  hideLoading();
  if (fixed > 0) { alert(`✅ Cached ${fixed} images. Refresh the page to see them instantly.`); }
  else { alert('All images are already cached locally.'); }
}

// ==================== DRIVE MEDIA DELETION ENGINE ====================
export async function deleteMediaFromDrive(fileId, token) {
    if (!fileId || !token) return;
    try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
            method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.ok) console.log(`🗑️ Successfully deleted orphaned cloud asset: ${fileId}`);
        else if (res.status === 404) console.warn(`Cloud asset ${fileId} already absent or deleted from Drive.`);
        else console.warn(`Drive API delete request for file ${fileId} returned status: ${res.status}`);
    } catch (err) { console.error(`Network fault while trying to delete file ${fileId} from Drive:`, err); }
}

// ==================== DRIVE INIT & HEARTBEAT ====================

export async function initDrive() {
    AppState.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                AppState.driveAccessToken = tokenResponse.access_token;
                idbSet('jeemax_drive_token', AppState.driveAccessToken);
                document.getElementById('btn-drive-auth').style.display = 'none';
                document.getElementById('drive-status').style.display = 'block';
                initializeCloudFolder();
                setupSyncHeartbeat();
            }
        },
    });

    let savedToken = await idbGet('jeemax_drive_token');
    if (savedToken) {
        AppState.driveAccessToken = savedToken;
        isDriveTokenValid().then(isValid => {
            if (isValid) {
                document.getElementById('btn-drive-auth').style.display = 'none';
                document.getElementById('drive-status').style.display = 'block';
                initializeCloudFolder().catch(console.error);
                setupSyncHeartbeat();
            } else { AppState.driveAccessToken = null; }
        }).catch(err => console.error("Background token validation failed", err));
    } else {
        document.getElementById('btn-drive-auth').style.display = 'inline-block';
        document.getElementById('drive-status').style.display = 'none';
    }
}

export function setupSyncHeartbeat() {
    if (syncIntervalId) clearInterval(syncIntervalId);
    syncIntervalId = setInterval(() => {
        if (AppState.driveAccessToken && AppState.cloudFolderId) loadStateFromCloud(true);
    }, 120000);
}

export async function isDriveTokenValid() {
    if (!AppState.driveAccessToken) return false;
    try {
        const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
            headers: { Authorization: `Bearer ${AppState.driveAccessToken}` }
        });
        if (response.ok) return true;
        await idbRemove('jeemax_drive_token');
        AppState.driveAccessToken = null;
        AppState.cloudFolderId = null;
        document.getElementById('btn-drive-auth').style.display = 'inline-block';
        document.getElementById('drive-status').style.display = 'none';
        const syncSubText = document.getElementById('sync-sub-text');
        if (syncSubText) { syncSubText.textContent = "Drive disconnected – reconnect in Settings"; syncSubText.color = "var(--glow-red)"; }
        return false;
    } catch (err) { console.error("Token validation error:", err); return false; }
}

export async function initializeCloudFolder() {
    const query = "mimeType='application/vnd.google-apps.folder' and name='JEEMaxxing_Cloud' and trashed=false";
    try {
        let response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
            headers: { Authorization: `Bearer ${AppState.driveAccessToken}` }
        });
        let data = await response.json();
        if (data.files && data.files.length > 0) {
            AppState.cloudFolderId = data.files[0].id;
            await loadStateFromCloud();
        } else {
            let createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
                method: 'POST',
                headers: { Authorization: `Bearer ${AppState.driveAccessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'JEEMaxxing_Cloud', mimeType: 'application/vnd.google-apps.folder' })
            });
            let createData = await createRes.json();
            AppState.cloudFolderId = createData.id;
            syncStateToCloud();
        }
    } catch (e) { console.error("Cloud Folder Init Failed:", e); }
}

// ==================== CLOUD SYNC OPERATIONS ====================

export async function getCloudSolvedTotal() {
    try {
        const query = `name='system_state.json' and '${AppState.cloudFolderId}' in parents and trashed=false`;
        let searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
            headers: { Authorization: `Bearer ${AppState.driveAccessToken}` }
        });
        let searchData = await searchRes.json();
        if (searchData.files && searchData.files.length > 0) {
            let fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${searchData.files[0].id}?alt=media`, {
                headers: { Authorization: `Bearer ${AppState.driveAccessToken}` }
            });
            let cloudState = await fileRes.json();
            return (cloudState.solved?.physics || 0) + (cloudState.solved?.chemistry || 0) + (cloudState.solved?.maths || 0);
        }
    } catch (e) {}
    return 0;
}

export async function executeUnifiedSync() {
    const valid = await isDriveTokenValid();
    if (!valid || !AppState.driveAccessToken || !AppState.cloudFolderId) {
        alert("Google Drive connection lost. Please reconnect in Settings."); return;
    }
    const btn = document.getElementById('manual-sync-btn');
    const subText = document.getElementById('sync-sub-text');
    if (btn) btn.classList.add('spinning');
    if (subText) subText.textContent = "Downloading cloud dataset...";

    try {
        const query = `name='system_state.json' and '${AppState.cloudFolderId}' in parents and trashed=false`;
        let searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
            headers: { Authorization: `Bearer ${AppState.driveAccessToken}` }
        });
        let fileId = null;
        if (searchRes.ok) {
            let searchData = await searchRes.json();
            if (searchData.files && searchData.files.length > 0) {
                fileId = searchData.files[0].id;
                let fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                    headers: { Authorization: `Bearer ${AppState.driveAccessToken}` }
                });
                if (fileRes.ok) {
                    let cloudState = await fileRes.json();
                    if (subText) subText.textContent = "Merging runtime variables...";
                    if (cloudState.questionBank) {
                        const localIds = new Set(AppState.questionBank.map(q => q.id));
                        cloudState.questionBank.forEach(cloudQ => {
                            if (!localIds.has(cloudQ.id)) { AppState.questionBank.push(cloudQ); }
                            else {
                                let localQ = AppState.questionBank.find(q => q.id === cloudQ.id);
                                if (cloudQ.status === 'solved' && localQ.status !== 'solved') localQ.status = 'solved';
                            }
                        });
                    }
                    if (cloudState.chapters) {
                        for (let subj in cloudState.chapters) {
                            if (!AppState.chapters[subj]) AppState.chapters[subj] = [];
                            cloudState.chapters[subj].forEach(ch => { if (!AppState.chapters[subj].includes(ch)) AppState.chapters[subj].push(ch); });
                        }
                    }
                    const todayStr = new Date().toISOString().split('T')[0];
                    if (cloudState.date === todayStr) {
                        if (cloudState.solved) {
                            solved.physics   = Math.max(solved.physics,   cloudState.solved.physics || 0);
                            solved.chemistry = Math.max(solved.chemistry, cloudState.solved.chemistry || 0);
                            solved.maths    = Math.max(solved.maths,    cloudState.solved.maths || 0);
                        }
                        if (cloudState.studySecs) {
                            studySecs.physics   = Math.max(studySecs.physics,   cloudState.studySecs.physics || 0);
                            studySecs.chemistry = Math.max(studySecs.chemistry, cloudState.studySecs.chemistry || 0);
                            studySecs.maths    = Math.max(studySecs.maths,    cloudState.studySecs.maths || 0);
                        }
                    }
                }
            }
        }
        if (subText) subText.textContent = "Updating interface fields...";
        await idbSet('jeemax_question_bank', AppState.questionBank);
        await idbSet('jeemax_chapters', AppState.chapters);
        await idbSet('jeemax_solved', solved);
        await idbSet('jeemax_study_secs', studySecs);
        await updateDailyHistory();
        _ui('updateUI'); _ui('updateStudyTimeHeader'); _ui('renderGraph'); _ui('renderErrorMatrixFromBank');

        if (subText) subText.textContent = "Uploading consolidated data...";
        const localTotal = (solved.physics || 0) + (solved.chemistry || 0) + (solved.maths || 0);
        if (localTotal === 0) {
            const cloudTotal = await getCloudSolvedTotal();
            if (cloudTotal > 0) {
                if (subText) { subText.textContent = "Sync skipped – preserving cloud data"; subText.style.color = "#fbbf24"; setTimeout(() => { subText.textContent = "System Idle"; subText.style.color = "#fff"; }, 3000); }
                return;
            }
        }
        const payload = { date: new Date().toISOString().split('T')[0], questionBank: AppState.questionBank, chapters: AppState.chapters, solved, studySecs, dailyHistory: await getDailyHistory() };
        if (!fileId) {
            let createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
                method: 'POST', headers: { Authorization: `Bearer ${AppState.driveAccessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'system_state.json', parents: [AppState.cloudFolderId] })
            });
            let createData = await createRes.json(); fileId = createData.id;
        }
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
            method: 'PATCH', headers: { Authorization: `Bearer ${AppState.driveAccessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (subText) { subText.textContent = "Synced & Secured ✔"; subText.style.color = "var(--glow-green)"; setTimeout(() => { subText.textContent = "System Idle"; subText.style.color = "#fff"; }, 3000); }
    } catch (e) {
        console.error("Unified Manual Synchronization pipeline error:", e);
        if (subText) { subText.textContent = "Execution Error ✖"; subText.style.color = "var(--glow-red)"; }
    } finally { if (btn) btn.classList.remove('spinning'); }
}

export async function syncStateToCloud() {
    if (!AppState.driveAccessToken || !AppState.cloudFolderId) return;
    try {
        const subText = document.getElementById('sync-sub-text');
        if (subText) subText.textContent = "Processing media files...";
        let cloudQuestionBank = [];
        let newlyUploaded = false;
        for (let i = 0; i < AppState.questionBank.length; i++) {
            let q = AppState.questionBank[i];
            if (q.imageDataUrl && q.imageDataUrl.length > 100 && !q.driveImageId) {
                try { q.driveImageId = await uploadMediaToDrive(q.imageDataUrl, `Q_${q.id}.png`, AppState.cloudFolderId, AppState.driveAccessToken); newlyUploaded = true; } catch (err) { console.error(`Failed to upload asset frame for Q_${q.id}:`, err); }
            }
            if (q.diagramImageUrl && q.diagramImageUrl.length > 100 && !q.driveDiagramId) {
                try { q.driveDiagramId = await uploadMediaToDrive(q.diagramImageUrl, `Diag_${q.id}.png`, AppState.cloudFolderId, AppState.driveAccessToken); newlyUploaded = true; } catch (err) { console.error(`Failed to upload diagram frame for Q_${q.id}:`, err); }
            }
            let cloudQ = { ...q }; cloudQ.imageDataUrl = null; cloudQ.diagramImageUrl = null;
            cloudQuestionBank.push(cloudQ);
        }
        if (newlyUploaded) await idbSet('jeemax_question_bank', AppState.questionBank);
        if (subText) subText.textContent = "Syncing system state...";
        const payload = { date: new Date().toISOString().split('T')[0], questionBank: cloudQuestionBank, chapters: AppState.chapters, solved, studySecs, dailyHistory: await getDailyHistory() };
        const query = `name='system_state.json' and '${AppState.cloudFolderId}' in parents and trashed=false`;
        let searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${AppState.driveAccessToken}` } });
        if (!searchRes.ok) { if (searchRes.status === 404) throw new Error("Target cloud storage folder directory not found."); throw new Error(`Drive connection interface dropped with code: ${searchRes.status}`); }
        let searchData = await searchRes.json();
        let fileId = searchData.files && searchData.files.length > 0 ? searchData.files[0].id : null;
        if (!fileId) {
            let createRes = await fetch('https://www.googleapis.com/drive/v3/files', { method: 'POST', headers: { Authorization: `Bearer ${AppState.driveAccessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'system_state.json', parents: [AppState.cloudFolderId] }) });
            if (!createRes.ok) throw new Error(`Failed to generate system JSON metadata container file shell.`);
            let createData = await createRes.json(); fileId = createData.id;
        }
        if (fileId) {
            let uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, { method: 'PATCH', headers: { Authorization: `Bearer ${AppState.driveAccessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!uploadRes.ok) throw new Error(`State content array matrix synchronization delivery fault.`);
            if (subText) { subText.textContent = "Sync Complete ✔"; subText.style.color = "var(--glow-green)"; setTimeout(() => { subText.textContent = "System Idle"; subText.style.color = "#fff"; }, 3000); }
        }
    } catch (e) {
        console.error("Sync Engine Exception:", e);
        const subText = document.getElementById('sync-sub-text');
        if (subText) { subText.textContent = "Sync Failed ✖"; subText.style.color = "var(--glow-red)"; }
    }
}

export async function loadStateFromCloud(isBackground = false) {
    if (!AppState.driveAccessToken || !AppState.cloudFolderId) return;
    if (!isBackground) showLoading("Syncing with cloud architecture...");
    const query = `name='system_state.json' and '${AppState.cloudFolderId}' in parents and trashed=false`;
    try {
        let searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${AppState.driveAccessToken}` } });
        let searchData = await searchRes.json();
        if (searchData.files && searchData.files.length > 0) {
            const fileId = searchData.files[0].id;
            let fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${AppState.driveAccessToken}` } });
            let cloudState = await fileRes.json();
            if (cloudState.questionBank) {
                const localIds = new Set(AppState.questionBank.map(q => q.id));
                cloudState.questionBank.forEach(cloudQ => {
                    if (!localIds.has(cloudQ.id)) { AppState.questionBank.push(cloudQ); }
                    else { const localQ = AppState.questionBank.find(q => q.id === cloudQ.id); if (cloudQ.status === 'solved' && localQ.status !== 'solved') localQ.status = 'solved'; }
                });
            }
            if (cloudState.chapters) {
                for (let subj in cloudState.chapters) { if (!AppState.chapters[subj]) AppState.chapters[subj] = []; cloudState.chapters[subj].forEach(ch => { if (!AppState.chapters[subj].includes(ch)) AppState.chapters[subj].push(ch); }); }
            }
            if (cloudState.dailyHistory) {
                let localHistory = []; try { localHistory = await idbGet('jeemax_daily_history') || []; } catch (e) { localHistory = []; }
                const mergedMap = new Map();
                localHistory.forEach(entry => mergedMap.set(entry.date, entry.count));
                cloudState.dailyHistory.forEach(entry => { const existing = mergedMap.get(entry.date); if (existing === undefined || entry.count > existing) mergedMap.set(entry.date, entry.count); });
                const merged = Array.from(mergedMap.entries()).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)).slice(-15);
                await idbSet('jeemax_daily_history', merged);
            }
            // ══════════════════════════════════════════════════════════════════════
            // ✅ FIX: SAFE ROLLOVER — preserve local progress on date mismatch
            //
            // Previous code had a destructive `else` branch that zeroed out
            // `solved` and `studySecs` whenever cloudState.date !== todayStr.
            // This wiped today's local progress whenever a date-rollover or
            // a stale cloud sync occurred.
            //
            // New strategy:
            //   • Same-date  → merge via Math.max (no data loss, unchanged).
            //   • Stale-date → leave local counters INTACT. The cloud data
            //     belongs to a previous day and must NOT overwrite today's
            //     tracking. A stale cloud snapshot is simply ignored for
            //     daily counters; it was already folded into dailyHistory
            //     above. Local state is always authoritative for the
            //     *current* tracking window.
            // ══════════════════════════════════════════════════════════════════════
            const todayStr = new Date().toISOString().split('T')[0];
            if (cloudState.date === todayStr) {
                // Cloud is current — high-water-mark merge preserves the
                // larger of local vs. cloud for each subject.
                if (cloudState.solved) {
                    solved.physics   = Math.max(solved.physics,   cloudState.solved.physics   || 0);
                    solved.chemistry = Math.max(solved.chemistry, cloudState.solved.chemistry || 0);
                    solved.maths     = Math.max(solved.maths,     cloudState.solved.maths     || 0);
                }
                if (cloudState.studySecs) {
                    studySecs.physics   = Math.max(studySecs.physics,   cloudState.studySecs.physics   || 0);
                    studySecs.chemistry = Math.max(studySecs.chemistry, cloudState.studySecs.chemistry || 0);
                    studySecs.maths     = Math.max(studySecs.maths,     cloudState.studySecs.maths     || 0);
                }
            }
            // else: stale cloud date — LOCAL WINS. Intentionally no-op.
            // The daily counters belong to the current local day; a
            // yesterday-cloud snapshot has no authority to zero them out.
            _ui('updateUI'); _ui('updateStudyTimeHeader'); _ui('renderGraph'); _ui('renderErrorMatrixFromBank');
        }
    } catch (e) { console.error("Failed to download state from cloud:", e); } finally { if (!isBackground) hideLoading(); }
}

// ==================== 15-DAY DAILY HISTORY TRACKER ====================
export async function getDailyHistory() {
    let history = await idbGet('jeemax_daily_history');
    if (!history) history = [];
    const todayStr = new Date().toISOString().split('T')[0];
    const todayTotal = (solved.physics || 0) + (solved.chemistry || 0) + (solved.maths || 0);
    const todayEntry = history.find(entry => entry.date === todayStr);
    if (todayEntry) { todayEntry.count = todayTotal; } else { history.push({ date: todayStr, count: todayTotal }); if (history.length > 15) history.shift(); }
    await idbSet('jeemax_daily_history', history);
    return history;
}

export async function updateDailyHistory() { await getDailyHistory(); }