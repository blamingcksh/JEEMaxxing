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
    saveAllAsync, flushSaves, loadDataAsync,
    idbGetMany,
    idbSet, idbGet,
    callGeminiWithFallback, cropImageFromBBox,
    showLoading, hideLoading, readFileAsBase64,
    escapeHtml, escapeAttribute, formatTime, formatStudyDuration,
    cleanAndParseJson,
    repairLatex, mathOk,
    uploadMediaToDrive, fetchMediaFromDrive, deleteMediaFromDrive,
    initDrive, handleDriveAuth, handleAuthExpiry,
    isDriveTokenValid, initializeCloudFolder, syncStateToCloud,
    loadStateFromCloud, setupSyncHeartbeat, getCloudSolvedTotal,
    waitForDriveToken, updateDailyHistory, getDailyHistory,
    executeUnifiedSync, cacheAllDriveImages,
    registerUiCallbacks, changeCount,
    settleDayCounters,
    recordCloudTombstone,
    // ── Full backup / restore (Config → Data Vault) ──
    buildFullBackup,
    applyFullBackup,
    // ── Shared "user is mid-activity" registry (interruption gating) ──
    SessionFocus,
    // ── SR due-status helper (used by the CK nav readiness count) ──
    getDueStatus,
    // ── Cognitive MMR band system (pre-ELO schema) ──
    ELO_BANDS,
    BAND_TARGET_TIME,
    ELO_GEM_STAMP_TUNING,
    CALIBRATED_SOLVE_THRESHOLD,
    getEloBand,
    // ── Practice modes (Flow State / Hardcore) — picker windows + reward tuning ──
    PRACTICE_MODES,
    MODE_TUNING,
    // ── Rating-uncertainty + calibration tuning (Elo v2) ──
    RD_TUNING,
    CONFIDENCE_ANCHORS,
    CALIBRATION_LOG_CAP,
    // ── Chapter weightage dynamic tiers ──
    setAiChapterWeight,
} from './storage.js';

// ── Daily Directive (target-system v2) ──
import { Directive } from './directive.js';

/** Stage full LU pricing context for the next solve unit logged through
 *  changeCount(). One-shot; silently ignored if the Directive isn't live. */
function _directiveMarkSolve(q, isCorrect, timeMins) {
    try {
        Directive.markPending({
            type: 'solve',
            subject: q.subject,
            chapter: q.chapter,
            qElo: (typeof _safeQElo === 'function' && _safeQElo(q)) || q.qElo || 0,
            timeMins: timeMins != null ? timeMins : (AppState._frozenTextQSeconds || AppState.practiceSeconds || 0) / 60,
            firstTry: q.firstAttemptResult === 'correct',
            isCorrect,
        });
    } catch (_) { /* Directive must never break the solve path */ }
}

// Memory Kernel v2 — canonical pure implementation (zero-dep module).
import {
    hydrateMemory,
    currentRetrievability,
    retrievabilityFrom,
    updateMemoryOnReview,
    chapterMemoryStats,
} from './memory.js';

// Cognitive Cortex v3 — brain-like scheduling layer (pure, zero-dep).
import {
    computeTagProfiles,
    leakOf,
    normalizeTag,
} from './cortex.js';

// Smart Mistake Report engine — tag × difficulty aggregation behind the AI Dump
// modal's live preview + compact download (pure, Node-testable module).
import {
    buildMistakeReport,
    renderReportText,
    renderReportHtml,
} from './report.js';

// Mock Mode — staged paper builder + exam runner (self-registers UI bridges).
import './mock.js';

import {
    resetPomoUI, startTimer, pauseTimer, resumeTimer, quitTimer,
    skipBreak, addBreakTime, finishAll,
    toggleVisualizer, toggleMiniWidget, toggleStopwatchMode,
    toggleDynamicSubject, changeStudySubject,
    updateStudyTimeHeader, initAudioContext, playBell,
    confirmTimerNotification,
    applyPomoConfig, readPomoConfig,
    // ── Ambient Sprint Widget + focus ledger (index.html inline onclicks) ──
    startSprintFromWidget, openPomoPop, closePomoPop,
    popSetSubject, popAdjustMinutes, popAdjustRounds, popStart,
    notifyKeepGoing, hydrateFocusStats, updateProjection,
    getFocusLedger, widgetPauseToggle,
} from './pomodoro.js';

// Replace the existing matrix.js import block with:
import {
    openErrorMatrix, filterErrors,
    addErrorBlock, renderErrorMatrixFromBank, initErrorLazyLoaders,
    removeErrorLog, openLightbox,
    // ── Daily Fix Queue (wired to the inline onclick in index.html) ──
    toggleDailyQueue, activateDailyQueue,
    // ── SR practice log imports (new) ──
    openPracticeDrawer, closePracticeDrawer, submitPracticeLog,
    srSetResult, srSetAutonomy, srToggleFriction,
    srToggleStopwatch, srToggleManualTime, srUpdateManualTime,
    toggleCardHistory,
    // ── Practice drawer MCQ flow (new) ──
    srSelectOption, srConfirmAnswer, srSelfReport, srToggleImage,
    srToggleHint, srRevealAnswer,
    // ── MCQ answer grading (shared with the SR drawer — full-option-string
    //    answers like "B) \frac{I}{4}" must resolve to the letter "B") ──
    resolveMcqCorrectLetters,
    // ── Error resolution dashboard (NEW) ──
    renderErrorResolutionDashboard,
    renderChapterDecayGrid,
    renderChapterProgressList,
    openChapterProgress,
} from './matrix.js';

// ── Candlestick engine (powers both home-section graphs) ──
import { drawCandlesticks, extractCountsFromSvg } from './candlestick-engine.js';


// ── Inline-onclick bridges: index.html buttons call these in global scope ──
window.toggleDailyQueue = toggleDailyQueue;           // Daily Fix Queue button
window.activateDailyQueue = activateDailyQueue;       // boot-flow force-arm
window.cacheAllDriveImages = cacheAllDriveImages;     // Cache All Images button

// ── Full Backup / Restore bridges (Config → Data Vault) [AUDIT P1-1] ──────
window.exportFullBackup = async function () {
    try {
        const payload = await buildFullBackup();
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `jeemaxxing-full-backup-${todayLocalKey()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        alert(`Backup downloaded (${payload.counts.idbKeys} data sections).\n\nKeep this file safe — it is your ENTIRE grind: bank, images, ELO, mocks, history and settings.`);
    } catch (e) {
        console.error('[backup] export failed:', e);
        alert('Backup failed: ' + (e && e.message ? e.message : e));
    }
};

window.restoreFullBackup = function (fileInput) {
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const payload = JSON.parse(reader.result);
            if (!payload || payload.__jmaxBackup !== true) {
                alert('That file is not a JEEMaxxing full backup.');
                return;
            }
            // Safety net: auto-download the CURRENT state before overwriting.
            try {
                const safety = await buildFullBackup();
                const sb = new Blob([JSON.stringify(safety)], { type: 'application/json;charset=utf-8' });
                const surl = URL.createObjectURL(sb);
                const sa = document.createElement('a');
                sa.href = surl;
                sa.download = `jeemaxxing-PRE-RESTORE-safety-${todayLocalKey()}.json`;
                document.body.appendChild(sa);
                sa.click();
                sa.remove();
                setTimeout(() => URL.revokeObjectURL(surl), 1500);
            } catch (_) { /* safety copy is best-effort */ }
            const ok = confirm(`Restore backup from ${payload.exportedAt || 'unknown date'}?\n\nThis OVERWRITES everything on this device — bank, images, ELO, history, mocks, settings.\nA safety copy of the current state has just been downloaded.`);
            if (!ok) return;
            const res = await applyFullBackup(payload);
            alert(`Restored ${res.keys} data sections.\n\nThe app will now reload.`);
            location.reload();
        } catch (e) {
            console.error('[backup] restore failed:', e);
            alert('Restore failed: ' + (e && e.message ? e.message : e));
        }
    };
    reader.readAsText(file);
};

import { CNSLoad } from './cns-load.js';
import { DeloadEngine } from './deload.js';
import { Lifeline } from './lifeline.js';
import { NightGuard } from './nightguard.js';

// ── CNS Load bridge: exposes studySecs for pomodoro-quit session subtraction ──
// cns-load.js reads window._studySecsForCns when onPomodoroQuit fires so
// tSeverity resets to zero after a legitimate pomodoro quit.
window._studySecsForCns = studySecs;

// ── Deload bridge: exposes getDailyHistory for 48h missed-day check ──
// deload.js reads window._deloadDailyHistoryFn to verify no recent missed days.
// We provide a sync wrapper that reads from the in-memory last-known state
// plus merges today's live counters.
function getDailyHistorySync() {
    try {
        const todayStr = todayLocalKey();
        const todayTotal = (solved.physics || 0) + (solved.chemistry || 0) + (solved.maths || 0);
        // Pull the last-known history from the IndexedDB cache on window
        const cached = window._dailyHistoryCache || [];
        const merged = [...cached];
        const todayIdx = merged.findIndex(e => e.date === todayStr);
        if (todayIdx >= 0) {
            merged[todayIdx] = { date: todayStr, count: todayTotal };
        } else {
            merged.push({ date: todayStr, count: todayTotal });
        }
        return merged; // full ledger — unbounded, do NOT truncate to 15
    } catch (e) {
        // Never zero the streak/deload inputs wholesale — degrade to the
        // last-known cache instead of an empty ledger.
        console.warn('[app] getDailyHistorySync failed — falling back to last-known cache:', e);
        const cached = window._dailyHistoryCache;
        return Array.isArray(cached) ? cached : [];
    }
}
window._deloadDailyHistoryFn = getDailyHistorySync;

// ── Deload: expose manual scheduling for inline onclick in HTML ──
window.scheduleDeloadFromUi = function() {
    const result = DeloadEngine.scheduleManualDeload();
    if (result.ok) {
        // Refresh streak display and UI
        updateStreakDisplay();
        updateUI();
        if (typeof window.__jmaxAppToast === 'function') window.__jmaxAppToast('🌿 Deload Day scheduled. Your streak is preserved. Today is an Earned Rest day.');
        else alert('🌿 Deload Day scheduled. Your streak is preserved. Today is an Earned Rest day.');
    } else {
        alert('Cannot schedule deload: ' + result.reason);
    }
};

// ── Daily history cache: updated on every getDailyHistory call so the
// sync bridge has the latest data without async IndexedDB round-trips. ──
const _originalGetDailyHistory = getDailyHistory;
window._dailyHistoryCache = [];
// We can't override the import, so we'll seed the cache from updateUI
// and updateStreakDisplay which both call getDailyHistory.

// ==================== LOCAL STATE ====================
// State that doesn't need to be shared with other modules

// ── Daily counter persistence for forest sync ─────────────────────────────
const LS_DAILY_FOREST = 'jeemax_forest_daily_v1';
// Dedicated day-settlement sentinel: the last day the daily counter reset
// (runNewDayCycle) actually completed. This — NOT jeemax_last_calibrated_date
// — gates the boot-time reset (see _readLastSettledDay / _markDaySettled).
const LS_LAST_SETTLED = 'jeemax_last_settled_date';

// ICU-safe local YYYY-MM-DD key — must match storage.js formatDateKey()/
// todayLocalKey() exactly, since these strings are used as ledger/comparison
// keys (streak history, deload windows, forest stores).
function todayLocalKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function loadDailyForestStore() {
  try {
    const o = JSON.parse(localStorage.getItem(LS_DAILY_FOREST) || '{}');
    return (o && typeof o === 'object') ? o : {};
  } catch (e) {
    return {};
  }
}

function saveDailyForestStore(o) {
  try {
    localStorage.setItem(LS_DAILY_FOREST, JSON.stringify(o));
  } catch (e) {}
  // Permanent IndexedDB mirror — survives localStorage clears / manual wipes.
  try { idbSet(LS_DAILY_FOREST, o).catch(() => {}); } catch (e) {}
}

function persistDailyCountsFromSolved() {
  try {
    const today = todayLocalKey();
    const st = loadDailyForestStore();

    const counts = {
      physics: Math.max(0, Math.floor(Number(solved.physics) || 0)),
      chemistry: Math.max(0, Math.floor(Number(solved.chemistry) || 0)),
      maths: Math.max(0, Math.floor(Number(solved.maths) || 0)),
      updatedAt: Date.now()
    };

    const old = st[today] || {};
    if (
      old.physics !== counts.physics ||
      old.chemistry !== counts.chemistry ||
      old.maths !== counts.maths
    ) {
      st[today] = counts;
      saveDailyForestStore(st);
    }
  } catch (e) {}
}

function restoreDailyCountsIntoSolved() {
  try {
    const today = todayLocalKey();
    const st = loadDailyForestStore();
    const c = st[today];
    if (!c) return;

    ['physics', 'chemistry', 'maths'].forEach(sub => {
      const v = Math.max(0, Math.floor(Number(c[sub]) || 0));
      if (v > (Number(solved[sub]) || 0)) {
        solved[sub] = v;
      }
    });
  } catch (e) {}
}

// Generic IndexedDB mirror (key,value) handle shared with the grove script.
try {
  window._idbMirror = {
    set: (k, v) => { try { return idbSet(k, v).catch(() => {}); } catch (e) { return Promise.resolve(); } },
    get: async (k) => { try { return await idbGet(k); } catch (e) { return null; } }
  };
} catch (_) {}

// Boot recovery: pull the permanent daily forest store out of IndexedDB and merge
// it back into localStorage (so the grove/island per-day counts survive a wipe).
async function restoreDailyForestFromIDB() {
  try {
    const idbStore = await idbGet(LS_DAILY_FOREST);
    if (!idbStore || typeof idbStore !== 'object') { restoreDailyCountsIntoSolved(); return; }
    const lsStore = loadDailyForestStore();
    const merged = {};
    for (const d in lsStore) merged[d] = lsStore[d];
    let changed = false;
    for (const d in idbStore) {
      const e = idbStore[d];
      if (!e || typeof e !== 'object') continue;
      const prev = merged[d] || {};
      const nb = {
        physics: Math.max(Number(prev.physics) || 0, Number(e.physics) || 0),
        chemistry: Math.max(Number(prev.chemistry) || 0, Number(e.chemistry) || 0),
        maths: Math.max(Number(prev.maths) || 0, Number(e.maths) || 0),
        updatedAt: Math.max(Number(prev.updatedAt) || 0, Number(e.updatedAt) || 0)
      };
      if (!merged[d] ||
          nb.physics !== (Number(prev.physics) || 0) ||
          nb.chemistry !== (Number(prev.chemistry) || 0) ||
          nb.maths !== (Number(prev.maths) || 0) ||
          nb.updatedAt !== (Number(prev.updatedAt) || 0)) changed = true;
      merged[d] = nb;
    }
    if (changed) saveDailyForestStore(merged);
  } catch (e) {}
  restoreDailyCountsIntoSolved();
}
// ── Forest growth brain: cumulative study + Elo→difficulty→grow-time ───────
const LS_CUM = 'jeemax_cum_study_v1';
const LS_CUM_DAYSTART = 'jeemax_cum_daystart_v1';
let cumStudy = { physics: 0, chemistry: 0, maths: 0 };
let cumDayStart = { physics: 0, chemistry: 0, maths: 0 };
let _lastSeenStudy = { physics: 0, chemistry: 0, maths: 0 };
let _cumBooted = false;
function _loadCum() {
  try { const o = JSON.parse(localStorage.getItem(LS_CUM) || 'null'); if (o && typeof o === 'object') cumStudy = { physics: (+o.physics || 0), chemistry: (+o.chemistry || 0), maths: (+o.maths || 0) }; } catch (e) {}
  try { const d = JSON.parse(localStorage.getItem(LS_CUM_DAYSTART) || 'null'); if (d && typeof d === 'object') cumDayStart = { physics: (+d.physics || 0), chemistry: (+d.chemistry || 0), maths: (+d.maths || 0) }; } catch (e) {}
}
function _saveCum() { try { localStorage.setItem(LS_CUM, JSON.stringify(cumStudy)); } catch (e) {} }
function _saveCumDayStart() { try { localStorage.setItem(LS_CUM_DAYSTART, JSON.stringify(cumDayStart)); } catch (e) {} }
function tickCumStudy() {
  for (const s of ['physics', 'chemistry', 'maths']) {
    const now = Math.max(0, Math.floor(Number(studySecs[s]) || 0));
    const delta = Math.max(0, now - (_lastSeenStudy[s] || 0));   // max(0,…) makes the midnight reset a clean 0-delta
    if (delta > 0) { cumStudy[s] += delta; _saveCum(); }
    _lastSeenStudy[s] = now;
  }
}
function bootCumStudy() {
  if (_cumBooted) return; _cumBooted = true;
  const hadStored = !!localStorage.getItem(LS_CUM);
  _loadCum();
  for (const s of ['physics', 'chemistry', 'maths']) {
    const now = Math.max(0, Math.floor(Number(studySecs[s]) || 0));
    if (!hadStored) cumStudy[s] = Math.max(cumStudy[s], now);     // first-run baseline (no double count)
    _lastSeenStudy[s] = now;
    if (!localStorage.getItem(LS_CUM_DAYSTART)) cumDayStart[s] = Math.max(0, cumStudy[s] - now);
  }
  _saveCum(); _saveCumDayStart();
  setInterval(tickCumStudy, 2000);
}
function snapshotCumDayStart() {   // call at the midnight reset, BEFORE studySecs is zeroed
  tickCumStudy();
  for (const s of ['physics', 'chemistry', 'maths']) cumDayStart[s] = cumStudy[s] || 0;
  _saveCumDayStart();
  for (const s of ['physics', 'chemistry', 'maths']) _lastSeenStudy[s] = 0;
}
function _clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ==================== GEM DIAGRAM AUTO-CROP MAP ====================
// The Gem dump may carry per-question crop coordinates. When a question's
// diagram lives inside one of the source screenshots the user uploaded to
// Gemini, the Gem can emit:
//
//   "imageRef": "a1",                              // which tagged source image
//   "cropBox": { "x":0.1, "y":0.2, "w":0.3, "h":0.25 }  // normalized 0..1 box
//
// Aliases, array form ([x,y,w,h]) and pixel-scale coordinates are all
// tolerated (see _parseGemImageRef / _resolveGemBbox). On ingest the app
// counts the distinct tags, asks the user to upload ONE image per tag, and
// auto-crops every referenced diagram via cropImageFromBBox — no manual
// bounding-box drawing.
// PRIMARY aliases are unambiguous (any non-empty value is trusted).
const _GEM_TAG_PRIMARY_ALIASES = ['imageRef', 'imageTag', 'diagramRef', 'imgTag', 'sourceImage'];
// EXTENDED aliases (image/img/figure/…) are only trusted when the value looks
// like a short tag token — a data URL / http URL / long blob is NOT a tag.
const _GEM_TAG_EXTENDED_ALIASES = ['image', 'img', 'figure', 'figRef', 'sourceImg', 'imageNumber', 'figureNumber', 'imageIndex'];
const _GEM_BBOX_ALIASES = ['cropBox', 'bbox', 'box', 'crop', 'region', 'coords', 'cropCoords'];

// A tag value is trusted only when it's a SHORT single-token string ("a1",
// "2", "s2") or a small number — never an embedded image payload.
function _looksLikeGemTag(v) {
    if (typeof v === 'number') return Number.isFinite(v) && v >= 0;
    if (typeof v !== 'string') return false;
    const s = v.trim();
    if (!s || s.length > 24) return false;
    if (/^(data:image\/|https?:\/\/|blob:|file:)/i.test(s)) return false;
    if (/[\s\n\r\t]/.test(s)) return false;
    return true;
}

// In-session store: normalized tag -> base64 data URL of the uploaded source
// screenshot. Deliberately in-memory only — survives modal reopens during the
// session, never touches storage quota.
let _gemImageSources = {};

function _firstDefined(obj, keys) {
    for (const k of keys) {
        const v = obj[k];
        if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
}

function _normGemTag(tag) {
    return String(tag == null ? '' : tag).trim().toLowerCase();
}

/**
 * Parse a cropBox value into {x,y,w,h} numbers. Accepts an object
 * ({x,y,w,h} / {left,top,width,height} / {x1,y1,x2,y2}) or a flat array
 * [x,y,w,h]. Returns null when the box is unparseable or has no area.
 */
function _parseGemBbox(raw) {
    if (!raw) return null;
    let x, y, w, h;
    if (Array.isArray(raw)) {
        if (raw.length < 4) return null;
        [x, y, w, h] = raw.slice(0, 4).map(Number);
    } else if (typeof raw === 'object') {
        const left = raw.x ?? raw.left ?? raw.x1 ?? raw.originX;
        const top = raw.y ?? raw.top ?? raw.y1 ?? raw.originY;
        const right = raw.x2 ?? raw.right;
        const bottom = raw.y2 ?? raw.bottom;
        x = Number(left);
        y = Number(top);
        w = Number(raw.w ?? raw.width ?? (right != null && left != null ? Number(right) - Number(left) : undefined));
        h = Number(raw.h ?? raw.height ?? (bottom != null && top != null ? Number(bottom) - Number(top) : undefined));
    }
    if (![x, y, w, h].every(v => Number.isFinite(v))) return null;
    if (w <= 0 || h <= 0) return null;
    return { x, y, w, h };
}

/**
 * Extract the gem auto-crop mapping from a dump question object.
 * Returns { tag, bbox } (bbox may be null when coordinates are missing) or
 * null when the question references no tagged source image.
 */
// Shared ref extraction: pulls the tag (primary aliases first, then guarded
// extended aliases) + optional cropBox out of a ref-bearing object.
function _pickGemRef(obj) {
    if (!obj || typeof obj !== 'object') return null;
    let tag = _firstDefined(obj, _GEM_TAG_PRIMARY_ALIASES);
    if (tag === undefined) {
        const ext = _firstDefined(obj, _GEM_TAG_EXTENDED_ALIASES);
        if (_looksLikeGemTag(ext)) tag = ext;
    }
    if (tag === undefined) return null;
    if (typeof tag === 'number') tag = String(tag);
    tag = String(tag).trim();
    if (!tag) return null;
    return { tag, bbox: _parseGemBbox(_firstDefined(obj, _GEM_BBOX_ALIASES)) };
}

function _parseGemImageRef(obj) {
    return _pickGemRef(obj);
}

/**
 * Resolve the cropped image bound to a single MCQ option. The auto-crop map
 * stores crops keyed by option letter ("A"), but dumps can also tag options by
 * their full string — try exact first, then a leading-letter match.
 */
function _gemOptionImageUrl(q, opt) {
    if (!q || !q.optionImageUrls || typeof opt !== 'string') return null;
    const direct = q.optionImageUrls[opt];
    if (direct) return direct;
    // Full-string keys from older/foreign dumps may differ only by case.
    const upper = q.optionImageUrls[opt.toUpperCase()];
    if (upper) return upper;
    const m = opt.match(/^\s*([A-Za-z])\s*[\)\.:]/);
    if (m) {
        return q.optionImageUrls[m[1].toUpperCase()] || q.optionImageUrls[m[1]] || null;
    }
    return null;
}

// ── Per-option image refs. The dump can carry images inside individual MCQ
// options, e.g.:
//   "optionImages": {"A": {"imageRef":"a1","cropBox":{...}}, "B": "a1"}
// or an array form:
//   "optionImages": [{"option":"A","imageRef":"a1","cropBox":{...}}]
// Returns { 'A': {tag,bbox}, ... } or null. ──
function _parseGemOptionImages(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const raw = _firstDefined(obj, ['optionImages', 'optionImageRefs', 'optionsImages', 'optionsImageRefs', 'optionsImg']);
    if (raw === undefined) return null;
    const out = {};
    const add = (key, ref) => {
        if (ref === null || !key) return;
        let k = String(key).trim().toUpperCase();
        // Normalize full option strings ("A) 10 m", "B. 5 cm", "C: …") down to
        // the bare letter so crop storage and _gemOptionImageUrl lookups share
        // one key — otherwise an upper-cased full string would never resolve.
        const m = k.match(/^([A-Z])\s*[\)\.:]/);
        if (m) k = m[1];
        if (!k || out[k]) return; // first wins
        out[k] = { tag: ref.tag, bbox: ref.bbox || null };
    };
    if (Array.isArray(raw)) {
        for (const entry of raw) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
            const key = _firstDefined(entry, ['option', 'opt', 'label', 'key', 'letter']);
            if (key === undefined) continue;
            add(key, _pickGemRef(entry));
        }
    } else if (typeof raw === 'object') {
        for (const k of Object.keys(raw)) {
            const v = raw[k];
            // Bare tag strings are accepted as shorthand ({"A": "a1"}); URLs
            // and data blobs are never mistaken for tags.
            let ref;
            if (typeof v === 'string' || typeof v === 'number') {
                ref = _looksLikeGemTag(v) ? { tag: (typeof v === 'number' ? String(v) : v.trim()), bbox: null } : null;
            } else {
                ref = _pickGemRef(v);
            }
            add(k, ref);
        }
    }
    return Object.keys(out).length ? out : null;
}

// ── Solution/answer image ref, e.g.
//   "solutionImage": {"imageRef":"a2","cropBox":{...}}
// or a bare tag string, with a standalone crop fallback on
// solutionCrop / solutionCropBox / solCropBox / answerCrop. ──
function _parseGemSolutionImage(obj) {
    if (!obj || typeof obj !== 'object') return null;
    let ref = null;
    const raw = _firstDefined(obj, ['solutionImage', 'solImage', 'solutionImageRef', 'solutionRef', 'answerImage']);
    if (raw !== undefined) {
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            ref = _pickGemRef(raw);
        } else if (_looksLikeGemTag(raw)) {
            ref = { tag: (typeof raw === 'number' ? String(raw) : String(raw).trim()), bbox: null };
        }
    }
    if (!ref) return null;
    if (!ref.bbox) {
        ref.bbox = _parseGemBbox(_firstDefined(obj, ['solutionCrop', 'solutionCropBox', 'solCropBox', 'answerCrop', 'solutionBox']));
    }
    return ref;
}

// All tagged-image references on an item (diagram + per-option + solution),
// each with its kind so the map modal and cropper can handle every crop.
function _gemTagEntries(item) {    const out = [];
    if (item && item.gemImage && item.gemImage.tag) out.push({ kind: 'diagram', tag: item.gemImage.tag, bbox: item.gemImage.bbox });
    if (item && item.gemOptionImages && typeof item.gemOptionImages === 'object') {
        for (const k of Object.keys(item.gemOptionImages)) {
            const ref = item.gemOptionImages[k];
            if (ref && ref.tag) out.push({ kind: 'option', opt: k, tag: ref.tag, bbox: ref.bbox });
        }
    }
    if (item && item.gemSolutionImage && item.gemSolutionImage.tag) {
        out.push({ kind: 'solution', tag: item.gemSolutionImage.tag, bbox: item.gemSolutionImage.bbox });
    }
    return out;
}

/**
 * Distinct tagged source images referenced by an ingestion batch, in order of
 * first appearance (the "how many are there" count the user asked for).
 */
function _collectGemImageTags(items) {
    const seen = new Set();
    const tags = [];
    for (const it of items || []) {
        for (const entry of _gemTagEntries(it)) {
            const t = typeof entry.tag === 'string' ? entry.tag.trim() : '';
            if (!t) continue;
            const key = _normGemTag(t);
            if (seen.has(key)) continue;
            seen.add(key);
            tags.push(t);
        }
    }
    return tags;
}

/**
 * Normalize a parsed bbox against the actual decoded image dimensions.
 * Coordinates above 1.0 are treated as raw PIXEL offsets (auto-detected) and
 * converted to fractions; everything is then clamped into the unit square so
 * cropImageFromBBox never draws outside the canvas. Returns null when the box
 * collapses to nothing.
 */
function _resolveGemBbox(bbox, imgW, imgH) {
    if (!bbox) return null;
    let { x, y, w, h } = bbox;
    // Pixel-scale auto-detection. Coordinates are NORMALIZED (0..1) unless the
    // box is unambiguous pixel geometry: offsets/sizes that could never be
    // fractions — e.g. {x:120, y:340, w:260, h:190}. A slightly sloppy
    // normalized box (x:-0.02 or w:1.05 from Gemini) must NOT be misread as
    // pixels, so we require x,y ≥ 0 AND w,h ≥ 1 before converting.
    const inRange = (v) => v >= -0.25 && v <= 1.25;
    const allNormalized = [x, y, w, h].every(inRange);
    const looksPixel = x >= 0 && y >= 0 && w >= 1 && h >= 1;
    if (!allNormalized && looksPixel && imgW > 0 && imgH > 0) {
        x /= imgW; w /= imgW; y /= imgH; h /= imgH;
    }
    // Clamp into the unit square and enforce a minimum crop size.
    x = Math.min(Math.max(x, 0), 0.9999);
    y = Math.min(Math.max(y, 0), 0.9999);
    w = Math.min(Math.max(w, 0), 1 - x);
    h = Math.min(Math.max(h, 0), 1 - y);
    if (w < 0.001 || h < 0.001) return null;
    return { x, y, w, h };
}

/**
 * Legacy-regex equivalent of _parseGemImageRef: pulls imageRef + cropBox out
 * of the raw metadata string that the freeform parser assembles per segment.
 */
function _compileLegacyGemImageRef(metadata) {
    if (!metadata) return null;
    let tag = null;
    for (const key of _GEM_TAG_PRIMARY_ALIASES) {
        const m = metadata.match(new RegExp('"' + key + '"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"', 'i'));
        if (m && m[1]) { tag = m[1]; break; }
    }
    if (tag === null) {
        // Extended aliases: accept a quoted string or a bare number, guarded
        // by the same short-tag heuristic so data URLs never match.
        for (const key of _GEM_TAG_EXTENDED_ALIASES) {
            const m = metadata.match(new RegExp('"' + key + '"\\s*:\\s*(?:"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"|(\\d+))', 'i'));
            if (m) {
                const raw = m[1] !== undefined ? m[1] : m[2];
                if (_looksLikeGemTag(raw)) { tag = String(raw); break; }
            }
        }
    }
    if (tag === null) return null;
    let rawBbox = null;
    for (const key of _GEM_BBOX_ALIASES) {
        const objM = metadata.match(new RegExp('"' + key + '"\\s*:\\s*\\{([\\s\\S]*?)\\}', 'i'));
        if (objM && objM[1]) {
            const num = (k) => {
                const m = objM[1].match(new RegExp('"' + k + '"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)', 'i'));
                return m ? parseFloat(m[1]) : NaN;
            };
            rawBbox = { x: num('x'), y: num('y'), w: num('w'), h: num('h') };
            break;
        }
        const arrM = metadata.match(new RegExp('"' + key + '"\\s*:\\s*\\[([\\d.,\\s-]+)\\]', 'i'));
        if (arrM && arrM[1]) {
            const nums = arrM[1].split(',').map(s => parseFloat(s.trim())).filter(n => Number.isFinite(n));
            if (nums.length >= 4) { rawBbox = { x: nums[0], y: nums[1], w: nums[2], h: nums[3] }; break; }
        }
    }
    return { tag, bbox: _parseGemBbox(rawBbox) };
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
// NaN-safe qElo read: `x || 1200` only guards falsy, not NaN from corrupt
// storage — NaN would flow into Math.max(...) and persist as NaN.
function _safeQElo(q) {
    return (q && typeof q.qElo === 'number' && isFinite(q.qElo) && q.qElo > 0) ? q.qElo : 1200;
}
function applyDifficulty(q, subj, eloResult) {
  if (!q) return;
  const ns = _normalizeSubjectKey(subj);
  const oldQ = eloResult ? _safeQElo({ qElo: eloResult.oldQElo }) : _safeQElo(q);
  const oldU = eloResult ? (eloResult.oldSubjectElo || 1200) : (AppState.elo[ns] || 1200);
  const d = _clamp01((oldQ - oldU + 400) / 800);
  q.difficulty = d;
  q.difficultyLabel = d < 0.34 ? 'easy' : d < 0.67 ? 'mid' : 'tough';
  q.growSeconds = (5 - 4 * d) * 3600;
}
function stampPlantCum(q, subj) {
  if (!q || q.plantCumStudy != null) return;     // stamp ONCE — the honest "first solved" moment
  q.plantCumStudy = Math.floor(cumStudy[_normalizeSubjectKey(subj)] || 0);
  if (q.oak == null) q.oak = Math.random() < 0.10;   // ~10% of solved questions become a dark oak
}
window.__forestGrowth = {
  cum: (s) => Math.floor(cumStudy[_normalizeSubjectKey(s)] || 0),
  dayStart: (s) => Math.floor(cumDayStart[_normalizeSubjectKey(s)] || 0),
  difficulty: (qElo, subj) => { const u = AppState.elo[_normalizeSubjectKey(subj)] || 1200; return _clamp01(((qElo || 1200) - u + 400) / 800); },
  growSecondsFor: (d) => (5 - 4 * _clamp01(d)) * 3600,
  label: (d) => { d = _clamp01(d); return d < 0.34 ? 'easy' : d < 0.67 ? 'mid' : 'tough'; },
  sizeFactor: (d) => 0.6 + 0.7 * _clamp01(d),
  heightScale: (m) => 0.30 + 0.70 * _clamp01(m),
  maturity: (plantCum, growSec, subj) => {
    growSec = growSec > 0 ? growSec : 10800;
    const ns = _normalizeSubjectKey(subj);
    const base = (plantCum != null) ? plantCum : (cumDayStart[ns] || 0);
    return _clamp01(((cumStudy[ns] || 0) - base) / growSec);
  }
};
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
let _cropResizeBound = false;

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
// ── Modal open/close race guard ──
// openModal defers `.active` to a requestAnimationFrame so the fade-in CSS
// transition can start from display:flex. If a modal is closed in that same
// frame (open → close in one synchronous flow, e.g. mode-exit right after a
// mode-start), the close removes `.active` FIRST, then the stale rAF re-adds
// it — so the deferred `display='none'` check sees `.active` and bails,
// leaving a zombie modal stuck on screen. A monotonic per-modal token makes
// every close invalidate any pending open rAF.
const _modalOpenTokens = {};

export function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    if (id === 'calendar-modal') renderCalendar();
    if (id === 'practice-modal') {
        try { _ensureStreakLoop(); } catch (_) {}
        // Own the user's attention while a solve is on stage (P0-1 gate).
        SessionFocus.acquire('practice');
    }
    // Manual Log-a-Mistake form: restore any unsaved draft [AUDIT P1-9].
    if (id === 'add-error-modal' && typeof window.__restoreAddErrorDraft === 'function') {
        try { window.__restoreAddErrorDraft(); } catch (_) {}
    }
    m.style.display = 'flex';
    // Hydrate LaTeX in the freshly-opened modal synchronously (the observer
    // is a backup). Idempotent: already-rendered wrappers are never touched.
    if (m.hasAttribute('data-math-rendered')) m.removeAttribute('data-math-rendered');
    processElementMath(m);
    const token = (_modalOpenTokens[id] || 0) + 1;
    _modalOpenTokens[id] = token;
    requestAnimationFrame(() => {
        if (_modalOpenTokens[id] === token) m.classList.add('active');
    });
}

// ── Unified Escape-to-close [AUDIT P2: modal grammar was split three ways] ──
// One delegated handler sweeps the TOPMOST active generic overlay. Enforcement
// surfaces (timer notification, night guard, checkpoint, crop) are excluded —
// they intentionally have no dismissal shortcut. The practice modal keeps its
// live-attempt confirmation. Typing targets never trigger a close.
try {
    const ESCAPE_EXEMPT = new Set(['timer-notify-modal', 'nightguard-modal', 'crop-modal']);
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        // Vault SR drawer first (it sits above everything as an overlay div).
        const drawer = document.getElementById('sr-practice-overlay');
        if (drawer) { try { closePracticeDrawer(); } catch (_) {} return; }
        const open = Array.from(document.querySelectorAll('.modal-overlay.active'))
            .filter(m => m.style.display !== 'none');
        if (!open.length) return;
        const top = open[open.length - 1];
        if (!top.id || top.hasAttribute('data-keep-escape')) return;
        if (ESCAPE_EXEMPT.has(top.id)) return;
        if (top.id === 'practice-modal' && AppState.practiceTimer) {
            if (!confirm('Leave this solve?\n\nYour focus sprint is still running — closing now ends this attempt and loses its progress.')) {
                e.preventDefault();
                return;
            }
        }
        closeModalStr(top.id);
    }, false);
} catch (_) {}

export function closeModal(e, id, force) {
    if (typeof e === 'string') { closeModalStr(e); return; }
    const m = document.getElementById(id);
    if (!m) return;
    if (force || (e && e.target === m)) {
        // ── Stray-tap guard [AUDIT P1-8] ──
        // A thumb landing just outside the card must not silently kill a
        // LIVE timed attempt: it cleared the sprint timer, the Flow/Hardcore
        // stacks and any armed lifeline with no confirm and no undo.
        // Programmatic closes (force) and explicit X buttons are unaffected.
        if (id === 'practice-modal' && !force && e && e.target === m && AppState.practiceTimer) {
            const keepGoing = typeof confirm === 'function'
                ? !confirm('Leave this solve?\n\nYour focus sprint is still running — closing now ends this attempt and loses its progress.')
                : false;
            if (keepGoing) return;
        }
        _modalOpenTokens[id] = (_modalOpenTokens[id] || 0) + 1; // invalidate pending open rAF
        m.classList.remove('active');
        setTimeout(() => { if (!m.classList.contains('active')) m.style.display = 'none'; }, 300);
        if (id === 'practice-modal') {
            SessionFocus.release('practice');
            if (AppState.practiceTimer) { clearInterval(AppState.practiceTimer); AppState.practiceTimer = null; }
            // Parity with closePracticeModal(): a backdrop dismiss used to
            // leak the run's Flow/Hardcore navigation stacks into the next
            // session and keep a lifeline pick armed for an unrelated solve.
            try { _clearModeHistory(); } catch (_) {}
            window.__lastQuestionPickedWithLifeline = false;
        }
    }
}

export function closeModalStr(id) {
    const m = document.getElementById(id);
    if (!m) return;
    if (id === 'practice-modal') SessionFocus.release('practice');
    _modalOpenTokens[id] = (_modalOpenTokens[id] || 0) + 1; // invalidate pending open rAF
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
    if (id === 'practice-modal') SessionFocus.release('practice');
    _modalOpenTokens[id] = (_modalOpenTokens[id] || 0) + 1; // invalidate pending open rAF
    m.classList.remove('active');
    m.style.display = 'none';
}

export function triggerStreakShield() {
    let visualizer = document.getElementById('streak-visualizer');
    if (!visualizer || visualizer.offsetParent === null) {
        const all = document.querySelectorAll('#streak-visualizer, #sr-streak-visualizer');
        for (const v of all) { if (v.offsetParent !== null) { visualizer = v; break; } }
    }
    if (!visualizer || visualizer.offsetParent === null) return;
    // Visual shield pop → gated by Visual FX
    if (!window.FX || window.FX.wantEffects()) {
        const shield = document.createElement('span');
        shield.className = 'streak-shield';
        shield.textContent = '🛡️';
        visualizer.appendChild(shield);
        shield.addEventListener('animationend', () => shield.remove());
    }
    // Audio burst → gated by Sound. One shared context: a fresh
    // AudioContext per pop used to accumulate toward the browser's
    // concurrency cap until ALL app audio silently died.
    if (!window.FX || window.FX.wantSound()) {
        try {
            if (!window.__jmaxSharedAudio) {
                window.__jmaxSharedAudio = new (window.AudioContext || window.webkitAudioContext)();
            }
            const ctx = window.__jmaxSharedAudio;
            if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
            const now = ctx.currentTime;
            const bufferSize = ctx.sampleRate * 0.15;
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
            const source = ctx.createBufferSource(); source.buffer = buffer;
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            source.connect(gain).connect(ctx.destination);
            source.start(now); source.stop(now + 0.15);
        } catch (e) {}
    }
}

// ==================== SIDEBAR & TABS ====================
export function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    sb.classList.toggle('collapsed');
    // v4 shell: the button carries an SVG chevron + a text span — write the
    // label into the span (and flip aria-label) instead of nuking innerHTML.
    const btn = document.querySelector('.collapse-btn');
    const collapsed = sb.classList.contains('collapsed');
    const txt = btn && btn.querySelector('.collapse-txt');
    if (txt) txt.textContent = 'Shrink'; else if (btn) btn.textContent = 'Shrink';
    if (btn) {
        btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
        btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    }
}

export async function switchTab(viewId, element) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    const targetView = document.getElementById('view-' + viewId);
    if (targetView) targetView.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');

    const header = document.getElementById('main-header');

    if (viewId === 'pomodoro' || viewId === 'errors' || viewId === 'practice') {
        header.classList.add('hidden');
    } else {
        header.classList.remove('hidden');
    }

    // Flush any pending coalesced save BEFORE re-reading the bank from IDB,
    // or a tab switch right after a solve could load stale persisted state.
    try { await flushSaves(); } catch (_) {}
    await loadDataAsync();
    bootCumStudy();
    restoreDailyCountsIntoSolved();
    if (viewId === 'practice') showPracticeSubview('practice-subject-view');
    if (viewId === 'pomodoro') {
        // Refresh today's burn ledger + commitment projection on entry.
        try { hydrateFocusStats(); } catch (_) {}
        try { updateProjection(); } catch (_) {}
    }
    if (viewId === 'errors') {
        assignDailyBountyIfNeeded();
        try { refreshBountyRail(); } catch (_) {}
        renderErrorMatrixFromBank();
        filterErrors();
        renderErrorResolutionDashboard(); // NEW: refresh error dashboard when viewing errors
        if (typeof renderMomentumCandles === 'function') renderMomentumCandles();
    }
    if (viewId === 'dashboard') {
        await renderGraph();
        try { void renderDailyVarianceHeatmap(); } catch (_) {}
        try { renderChapterDecayGrid(); } catch (_) {}
        try { renderChapterProgressList(); } catch (_) {}
        try { _renderCalibrationReport(); } catch (_) {}
    }
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

    // ── Sleep-debt mood penalty: apply the ceiling BEFORE deriving tonight's
    // active targets, or the targets silently ignore the penalty even though
    // the stored multiplier shows it (the old order computed targets first).
    try {
        if (typeof NightGuard !== 'undefined') {
            const _sdPenalty = NightGuard.getSleepDebtMoodPenalty();
            if (_sdPenalty < 1.0) AppState.moodMultiplier = Math.min(AppState.moodMultiplier, _sdPenalty);
        }
    } catch (_) {}

    // ── Deload Days: mood calibration to 1.0 overrides forced deload ──
    try {
        if (typeof DeloadEngine !== 'undefined' && AppState.moodMultiplier === 1.0) {
            DeloadEngine.overrideForcedDeload(1.0);
        }
    } catch (_) {}

    // ── Daily Directive: the mood/sleep capacity just changed — recompute the
    // contract against it (replaces the old baseTargets × mood arithmetic). ──
    try { await Directive.recalibrateCapacity(); } catch (_) {}

    await idbSet('jeemax_mood_multiplier', AppState.moodMultiplier);
    // NOTE: jeemax_last_calibrated_date is intentionally NO LONGER the daily
    // rollover gate (that's jeemax_last_settled_date — see _readLastSettledDay).
    // It is kept as a plain mood-prompt timestamp; do NOT key the counter reset
    // off it again, or same-day reopens after skipping the vibe check will wipe
    // today's solved/studySecs counters.
    await idbSet('jeemax_last_calibrated_date', todayLocalKey());
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

// ── Night-Guard Monitoring Loop ────────────────────────────────────────────
// The cat-banner telemetry rotation (progress text + vulnerability scanner) was
// removed — the banner is hidden in the dashboard-clean layout, and the scanner
// was an O(bank) loop on a 10s timer. The Night Guard hooks it also drove are
// real features and are preserved here on the same cadence.
(function _initNightGuardMonitor() {
    if (window.__ngMonitorInit) return;
    window.__ngMonitorInit = true;

    function _tick() {
        // ── Night Guard: Tier 3 modal auto-trigger (03:00+ uninterruptible) ──
        try { if (typeof NightGuard !== 'undefined') NightGuard.checkAndShowTier3Modal(); } catch (_) {}
        // ── Night Guard: Tier 2 auto-dismiss after 5s (spec: "5s auto-dismiss OK") ──
        try {
            if (typeof NightGuard !== 'undefined') {
                const _ngs = NightGuard.getStatus();
                if (_ngs.active && _ngs.tier === 'tier2' && !window.__tier2DismissScheduled) {
                    window.__tier2DismissScheduled = true;
                    setTimeout(() => {
                        try { NightGuard.dismissCurrentTier(); } catch (_) {}
                        window.__tier2DismissScheduled = false;
                    }, 5000);
                }
                if (!_ngs.active || _ngs.tier !== 'tier2') {
                    window.__tier2DismissScheduled = false;
                }
            }
        } catch (_) {}
    }

    function _start() {
        _tick();
        setInterval(_tick, 10000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _start);
    } else {
        _start();
    }
})();

/** Pace tick: "where you'd want to be by now" marker on a progress bar.
 *  Purely cosmetic — never blocks the counters. */
function _updatePaceTick(barId) {
    try {
        const bar = document.getElementById(barId);
        if (!bar) return;
        const meter = bar.parentElement;
        if (!meter) return;
        let tick = meter.querySelector('.tp-pace');
        if (Directive.hasContract && !Directive.isNightCalm()) {
            const frac = Math.round(Directive.getPaceFraction() * 1000) / 10;
            if (!tick) {
                tick = document.createElement('i');
                tick.className = 'tp-pace';
                meter.appendChild(tick);
            }
            tick.style.left = `${Math.min(100, frac)}%`;
            tick.style.display = 'block';
        } else if (tick) {
            tick.style.display = 'none';
        }
    } catch (_) { /* cosmetic only */ }
}

export async function updateUI() {
    // ── Daily Directive heat (v2): meters are denominated in Load Units once
    // the Directive has computed today's contract; the legacy count/target
    // rendering stays as the fallback so the UI never blanks pre-bootstrap. ──
    const _dirLive = Directive.hasContract;
    const _prog = {};
    ['physics', 'chemistry', 'maths'].forEach(sub => {
        _prog[sub] = _dirLive ? Directive.getSubjectProgress(sub) : null;
    });

    ['physics', 'chemistry', 'maths'].forEach(sub => {
        const prog = _prog[sub];
        // Native language (v2.1): counts + "to go", smart weighting invisible.
        // The BAR is still the heat fraction — a hard weighted solve consumes
        // more of it than an easy one, but the user only ever reads problems.
        document.getElementById(`${sub}-count`).textContent = solved[sub];
        let tgtLbl = document.getElementById(`tgt-${sub.substring(0, 4)}-lbl`);
        if (tgtLbl) tgtLbl.textContent = prog
            ? (prog.heat >= 1 ? '· done' : `· ${Directive.problemsRemaining(sub)} to go`)
            : `/ ${AppState.activeTargets[sub]}`;
        const pct = prog
            ? Math.min(100, prog.heat * 100)
            : (AppState.activeTargets[sub] > 0 ? Math.min(100, (solved[sub] / AppState.activeTargets[sub]) * 100) : 0);
        document.getElementById(`${sub}-bar`).style.width = `${pct}%`;
        _updatePaceTick(`${sub}-bar`);
    });
    _updatePaceTick('tp-total-bar');

    persistDailyCountsFromSolved();

    // ── Sleep-Debt mood penalty: 3+ consecutive sleep-debt days
    // force a CEILING of 0.85 (never raises an already-lower mood).
    try {
        if (typeof NightGuard !== 'undefined') {
            const _sdPenalty = NightGuard.getSleepDebtMoodPenalty();
            if (_sdPenalty < 1.0) AppState.moodMultiplier = Math.min(AppState.moodMultiplier, _sdPenalty);
        }
    } catch (_) {}

    let totalSolved = solved.physics + solved.chemistry + solved.maths;
    let totalTgt = AppState.activeTargets.physics + AppState.activeTargets.chemistry + AppState.activeTargets.maths;
    let variance = totalTgt === 0 ? 0 : ((totalSolved - totalTgt) / totalTgt) * 100;
    let varEl = document.getElementById('variance-val');
    if (varEl) {
        varEl.textContent = (variance > 0 ? "+" : "") + variance.toFixed(1) + "%";
        varEl.style.color = variance >= 0 ? 'var(--glow-green)' : 'var(--glow-red)';
    }

    // ── Today's Progress ledger: each subject renders through its own
    // hairline stroke ({sub}-bar, written above); the hub drives ONE
    // unified whisper-thin stroke — combined heat (LU ÷ contract) when the
    // Directive is live, combined solved ÷ derived target otherwise. ──
    const totalLU = _dirLive
        ? ['physics', 'chemistry', 'maths'].reduce((a, s) => a + _prog[s].lu, 0)
        : null;
    const totalContractLU = _dirLive
        ? ['physics', 'chemistry', 'maths'].reduce((a, s) => a + _prog[s].contract, 0)
        : null;
    const totalHeat = _dirLive && totalContractLU > 0 ? totalLU / totalContractLU : 0;
    const tpTotalEl = document.getElementById('tp-total');
    if (tpTotalEl) tpTotalEl.textContent = totalSolved;
    const tpTgtEl = document.getElementById('tp-total-tgt');
    if (tpTgtEl) tpTgtEl.textContent = _dirLive
        ? (totalHeat >= 1 ? '· day done' : `· ~${Directive.problemsRemaining()} to go`)
        : `/ ${totalTgt}`;
    const tpStrokeEl = document.getElementById('tp-total-bar');
    if (tpStrokeEl) tpStrokeEl.style.width = `${Math.min(100, (_dirLive ? totalHeat : (totalTgt > 0 ? totalSolved / totalTgt : 0)) * 100)}%`;

    // ── Output Meter completion states (visual only): .tp-sub-done on each
    // subject row at/over its contract heat, .tp-day-done on the card when
    // the combined contract is hit (subjects may trade — aggregate rule). ──
    try {
        const trackerCard = document.querySelector('.dash-card-tracker');
        if (trackerCard) {
            ['physics', 'chemistry', 'maths'].forEach(sub => {
                const row = trackerCard.querySelector(`.compact-subject-card[data-subject="${sub}"]`);
                if (row) row.classList.toggle('tp-sub-done', _dirLive ? _prog[sub].heat >= 1
                    : (AppState.activeTargets[sub] > 0 && solved[sub] >= AppState.activeTargets[sub]));
            });
            trackerCard.classList.toggle('tp-day-done', _dirLive ? totalHeat >= 1 : (totalTgt > 0 && totalSolved >= totalTgt));
        }
    } catch (_) { /* cosmetic only */ }

    // ── Directive card + Golden Flame cosmetic ──
    try {
        document.body.classList.toggle('directive-golden', Directive.isGolden());
    } catch (_) {}
    try {
        if (document.getElementById('view-dashboard') && document.getElementById('view-dashboard').classList.contains('active')) {
            Directive.renderDashboardCard();
        }
    } catch (_) { /* cosmetic only */ }

    // ── Contribution graph: use the same daily variance definition as the
    // live strip above, but keep the historical grid on the dashboard ledger.
    try {
        const dashboard = document.getElementById('view-dashboard');
        if (dashboard && dashboard.classList.contains('active')) {
            void renderDailyVarianceHeatmap();
        }
    } catch (_) { /* the graph must never block the live counters */ }

    // ── Cognitive MMR Matrix hydration (global profile row + subject
    // monitors + deficit lockdown protocol). Runs on every updateUI tick so
    // the dashboard always reflects the live rating state. These three are
    // heavy full-DOM rebuilds that grow with the bank — gate them to the
    // dashboard view so solving inside the practice modal (or any other tab)
    // doesn't re-render hidden dashboard DOM every time. switchTab()
    // re-renders them on entry, so nothing goes stale. ──
    try {
        const v = document.getElementById('view-dashboard');
        if (v && v.classList.contains('active')) {
            renderEloMatrix();
            renderChapterDecayGrid();
            renderChapterProgressList();
        }
        // The calibration readout is header chrome now (visible on every tab),
        // so refresh it on EVERY updateUI regardless of where the solve happened.
        try { _renderCalibrationReport(); } catch (_) {}
    } catch (_) { /* never block updateUI */ }

    // ── Debounced streak refresh ──
    // updateStreakDisplay() does an async getDailyHistory() IDB read on every
    // call. changeCount fires updateUI per solve — that read on every solve is
    // a hot-path cost that grows as the ledger grows. Collapse bursts to one
    // refresh 800ms after the last change (still instant-feeling).
    try {
        clearTimeout(window.__streakRefreshTimer);
        window.__streakRefreshTimer = setTimeout(() => { updateStreakDisplay(); }, 800);
    } catch (_) {
        updateStreakDisplay();
    }
}

// ==================== DAILY VARIANCE CONTRIBUTION GRAPH ====================
// GitHub-style 53-week grid over the permanent daily solve ledger. The level
// is deliberately target-relative so the green intensity means something:
//   0 = no solves, 1 = under 50% of target, 2 = under target,
//   3 = target to +25%, 4 = more than +25% over target.
let _varianceHeatmapRenderToken = 0;
// Last-render fingerprint (date key + ledger length + live totals). Lets the
// grid skip pointless rebuilds on updateUI ticks where nothing changed.
let _varianceHeatmapFingerprint = '';

function _varianceDateKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function _varianceEntryCount(entry) {
    if (!entry || typeof entry !== 'object') return 0;
    const keys = ['physics', 'chemistry', 'maths'];
    const hasBreakdown = keys.some(key => Object.prototype.hasOwnProperty.call(entry, key));
    if (hasBreakdown) return keys.reduce((sum, key) => sum + (Number(entry[key]) || 0), 0);
    return Number(entry.count) || 0;
}

function _varianceLevel(count, target) {
    if (count <= 0) return 0;
    const ratio = target > 0 ? count / target : 1;
    if (ratio < 0.5) return 1;
    if (ratio < 1) return 2;
    if (ratio < 1.25) return 3;
    return 4;
}

export async function renderDailyVarianceHeatmap() {
    const grid = document.getElementById('daily-variance-grid');
    if (!grid) return;

    let history = Array.isArray(window._dailyHistoryCache) ? window._dailyHistoryCache : null;
    if (!history || history.length === 0) {
        try { history = await getDailyHistory(); } catch (_) { history = []; }
    }

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const todayKey = _varianceDateKey(today);
    const liveTotal = solved.physics + solved.chemistry + solved.maths;

    // Cheap skip, deliberately BEFORE the render token is bumped so a no-op
    // tick never invalidates an in-flight render. The grid only changes when
    // the date, the ledger, or the live counters change.
    const fingerprint = todayKey + '|' + (history ? history.length : 0) + '|' + liveTotal;
    if (fingerprint === _varianceHeatmapFingerprint) return;
    _varianceHeatmapFingerprint = fingerprint;

    const token = ++_varianceHeatmapRenderToken;

    const historyByDate = new Map();
    (history || []).forEach(entry => {
        if (entry && entry.date) historyByDate.set(entry.date, entry);
    });

    // Always prefer live counters for today; the ledger can lag while a solve
    // is being coalesced into IndexedDB.
    historyByDate.set(todayKey, {
        date: todayKey,
        physics: solved.physics,
        chemistry: solved.chemistry,
        maths: solved.maths,
        count: liveTotal,
    });

    const liveTarget = AppState.activeTargets.physics + AppState.activeTargets.chemistry + AppState.activeTargets.maths;
    const historicalTarget = baseTargets.physics + baseTargets.chemistry + baseTargets.maths;
    const targetFor = dateKey => dateKey === todayKey ? liveTarget : historicalTarget;
    const varianceFor = (count, target) => target > 0 ? ((count - target) / target) * 100 : 0;
    const formatVariance = value => (value > 0 ? '+' : '') + value.toFixed(1) + '%';

    // Anchor the full current calendar year to Sunday–Saturday weeks, like
    // GitHub's contribution graph. Future dates stay visible as empty cells;
    // only the alignment padding before January 1 and after December 31 hides.
    const windowStart = new Date(today.getFullYear(), 0, 1, 12);
    const windowEnd = new Date(today.getFullYear(), 11, 31, 12);
    const gridStart = new Date(windowStart);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    const gridEnd = new Date(windowEnd);
    gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

    // Collect the week starts once so the month-label row lines up with the
    // exact same columns as the dots below it.
    const weekStarts = [];
    for (let weekStart = new Date(gridStart); weekStart <= gridEnd; weekStart.setDate(weekStart.getDate() + 7)) {
        weekStarts.push(new Date(weekStart));
    }

    // Month labels sit in the week column that contains the 1st of the month.
    const monthsEl = document.getElementById('daily-variance-months');
    let monthsHtml = '';
    if (monthsEl) {
        const monthSlots = new Array(weekStarts.length).fill('');
        const monthLetters = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
        for (let m = 0; m < 12; m++) {
            const first = new Date(today.getFullYear(), m, 1, 12);
            for (let i = 0; i < weekStarts.length; i++) {
                const weekEnd = new Date(weekStarts[i]);
                weekEnd.setDate(weekStarts[i].getDate() + 7);
                if (first >= weekStarts[i] && first < weekEnd) {
                    monthSlots[i] = monthLetters[m];
                    break;
                }
            }
        }
        monthsHtml = monthSlots.map(label =>
            `<span class="daily-variance-month">${label}</span>`).join('');
    }

    const weekHtml = [];
    for (let w = 0; w < weekStarts.length; w++) {
        const weekStart = weekStarts[w];
        const dots = [];

        for (let day = 0; day < 7; day++) {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + day);
            const dateKey = _varianceDateKey(date);
            const isOutsideWindow = date < windowStart || date > windowEnd;
            const isFuture = dateKey > todayKey;
            const entry = historyByDate.get(dateKey);
            const count = isOutsideWindow || isFuture ? 0 : _varianceEntryCount(entry);
            const target = targetFor(dateKey) || 1;
            const variance = varianceFor(count, target);
            const level = isOutsideWindow || isFuture ? 0 : _varianceLevel(count, target);
            const isToday = dateKey === todayKey;
            const label = isOutsideWindow
                ? `${dateKey}: outside calendar year`
                : isFuture
                    ? `${dateKey}: upcoming`
                    : `${dateKey}: ${count} solved · ${formatVariance(variance)} variance`;
            const outsideAttr = isOutsideWindow ? ' data-outside="true"' : '';
            const todayAttr = isToday ? ' data-today="true"' : '';
            dots.push(`<i class="daily-variance-dot" data-date="${dateKey}" data-level="${level}"${todayAttr}${outsideAttr} aria-hidden="true" title="${label}"></i>`);
        }
        weekHtml.push(`<span class="daily-variance-week">${dots.join('')}</span>`);
    }

    // A stale render (superseded by a newer call while awaiting the ledger)
    // must never overwrite the freshest DOM.
    if (token !== _varianceHeatmapRenderToken) return;
    if (monthsEl) monthsEl.innerHTML = monthsHtml;
    grid.innerHTML = weekHtml.join('');
}

// ==================== STREAK VECTOR TRACKER ====================
// Consumers (cns-load strain bonus, deload continuity fallback, forest-bg
// sunlight warmth) used to parse this value out of a `#top-streak` header
// element that no longer exists — silently zeroing all of them. The computed
// streak is now published on window.__jmaxStreak every render; DOM writes stay
// guarded for legacy markup.
export async function updateStreakDisplay() {
    let history = await getDailyHistory();
    if (!Array.isArray(history) || history.length === 0) {
        try { window.__jmaxStreak = { days: 0, label: '0 Days (start something)' }; } catch (_) {}
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

    // ── Deload Days streak continuity: deload days count as REST days
    // (sepia/rest cell on heat map) and preserve the streak. The user gets
    // credit for the previous-day chain on a deload day as long as they
    // solved ≥1 problem on each of the previous 6 days (spec: the streak
    // counter keeps rolling on a 6-day backing chain). ──
    try {
        if (typeof DeloadEngine !== 'undefined') {
            const allHistory = history || [];
            const deloadDates = (DeloadEngine.state && DeloadEngine.state.manualDeloads || [])
                .map(d => d.date)
                .concat((DeloadEngine.state && DeloadEngine.state.forcedDeloads || [])
                    .filter(d => !d.overridden)
                    .map(d => d.date));
            deloadDates.forEach(d => {
                // Verify the 6 preceding days all have solves
                let all6Solved = true;
                const deloadDate = new Date(d + 'T12:00:00');
                for (let i = 1; i <= 6; i++) {
                    const prev = new Date(deloadDate);
                    prev.setDate(prev.getDate() - i);
                    const prevStr = prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0') + '-' + String(prev.getDate()).padStart(2, '0');
                    const entry = allHistory.find(h => h.date === prevStr);
                    if (!entry || (entry.count || 0) === 0) {
                        all6Solved = false;
                        break;
                    }
                }
                if (all6Solved) activeDates.add(d);
            });
        }
    } catch (_) {}

    const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    let streak = 0;
    let checkDate = new Date();
    let todayStr = ymd(checkDate);

    if (!activeDates.has(todayStr)) {
        checkDate.setDate(checkDate.getDate() - 1);
    }

    // Walk back as far as the ledger actually reaches — the old hard cap of
    // 30 iterations froze any real streak at "30 Days" forever. The loop now
    // ends at the first gap, or at the oldest active date, whichever first.
    const oldestActive = activeDates.size
        ? [...activeDates].reduce((min, d) => d < min ? d : min)
        : null;
    for (let i = 0; i < 3650; i++) {   // 10-year hard ceiling — pure runaway guard
        let dStr = ymd(checkDate);
        if (activeDates.has(dStr)) {
            streak++;
            if (oldestActive && dStr <= oldestActive) break;   // nothing older exists
            checkDate.setDate(checkDate.getDate() - 1);
        } else {
            break;
        }
    }

    const streakEl = document.getElementById('top-streak');
    // "On pace" framing (v2.1): the chain is about the goal, not the game.
    // Same number, same ledger walk — just what it means to the user.
    const streakLabel = streak > 0
        ? `${streak} on pace`
        : 'start today';
    if (streakEl) {
        streakEl.textContent = streakLabel;
    }
    // Live bridge for headless consumers — see note above.
    try { window.__jmaxStreak = { days: streak, label: streakLabel }; } catch (_) {}
}

// ==================== FRICTION-INVERSE COGNITIVE YIELD (Y_day) ====================
//
// Replaces the raw scalar question counters fed to the candlestick momentum
// engine. Every solved problem is weighed by its running implied difficulty
// (qElo), temporal divergence (τ = actual / chapter-average time) and a vault
// re-attempt coefficient, then aggregated through the asymmetric Model B
// subject portfolio:
//
//   W_i   = (qElo_i / 1200) · (2 / (1 + τ_i)) · W_vault
//   Y_day = 0.50 · ΣW_Math + 0.30 · ΣW_Phys + 0.20 · ΣW_Chem
//
// Vault rules:
//   • Spaced-Repetition re-attempt (active errorReason + firstAttemptResult) → 0.25
//   • Fresh, cold problem → 1.0
//
// ── State & Sync Integrity ──
// This module is a PURE READ over AppState.questionBank. It NEVER mutates the
// bank, the `solved` counters, `studySecs`, or any Cloud/IndexedDB serialised
// shape — the yield is synthesised on the fly inside renderGraph() so the sync
// schema definitions remain uncorrupted.
const YIELD_SUBJECT_WEIGHTS = { maths: 0.50, physics: 0.30, chemistry: 0.20 };

/**
 * Vault re-attempt coefficient — mirrors the re-solve decay rule inside
 * calculateEloMigration(). A question that already carries an `errorReason`
 * AND a locked `firstAttemptResult` is a Spaced-Repetition vault re-attempt
 * (you have already seen the solution), so its cognitive footprint collapses
 * to 25%. Fresh, cold problems weigh in at full strength (1.0).
 */
function _vaultWeight(q) {
    return (q && q.errorReason && q.firstAttemptResult) ? 0.25 : 1.0;
}

/**
 * Individual cognitive footprint of a single solved problem.
 *
 *   W_i = (qElo_i / 1200) · (2 / (1 + τ_i)) · W_vault
 *
 * where τ_i = actual time / chapter average time. Untimed solves (timeTaken
 * ≤ 0) collapse τ to 1 (neutral), so they neither inflate nor deflate the
 * friction-inverse term instead of doubling it.
 */
function _cognitiveItemWeight(q) {
    const qElo = (typeof q.qElo === 'number' && isFinite(q.qElo) && q.qElo > 0)
        ? q.qElo : 1200;
    const difficulty = qElo / 1200;

    const T_act = Math.max(0, Number(q.timeTaken) || 0);
    const T_avg = Math.max(1, _getChapterAvgTime(q.subject, q.chapter));
    const tau = T_act > 0 ? (T_act / T_avg) : 1;        // temporal divergence
    const frictionInverse = 2 / (1 + Math.max(0, tau));  // 2/(1+τ)

    return difficulty * frictionInverse * _vaultWeight(q);
}

/**
 * One-pass cognitive-yield index over the whole bank.
 *
 * renderGraph() used to call _computeYieldForDate() once PER history day,
 * each call rescanning the entire bank — O(days × questions) ≈ millions of
 * iterations on mature accounts, paid at boot and on every dashboard-visible
 * solve. This builds the same data in ONE pass: Map<YYYY-MM-DD, bucket>.
 *
 * @returns {Map<string,{maths:number,physics:number,chemistry:number,matched:number}>}
 */
function _buildYieldIndex() {
    const byDate = new Map();
    for (const q of AppState.questionBank) {
        if (!q || q.status !== 'solved') continue;
        // Resolve the solve date from lastReviewedAt. The field is an ISO
        // string stamped at solve/review time (see calculateEloMigration /
        // practiceSubmit); slicing the first 10 chars yields YYYY-MM-DD.
        const stamp = q.lastReviewedAt;
        if (!stamp || typeof stamp !== 'string' || stamp.length < 10) continue;
        const subj = _normalizeSubjectKey(q.subject);
        if (!(subj === 'maths' || subj === 'physics' || subj === 'chemistry')) continue;
        const dateStr = stamp.slice(0, 10);
        let bucket = byDate.get(dateStr);
        if (!bucket) {
            bucket = { maths: 0, physics: 0, chemistry: 0, matched: 0 };
            byDate.set(dateStr, bucket);
        }
        bucket[subj] += _cognitiveItemWeight(q);
        bucket.matched++;
    }
    return byDate;
}

/**
 * Granular Friction-Inverse Cognitive Yield for one calendar date, read from
 * a prebuilt index (see _buildYieldIndex) instead of rescanning the bank.
 */
function _computeYieldForDate(dateStr, byDate) {
    if (!byDate) byDate = _buildYieldIndex();
    const bucket = byDate.get(dateStr) || { maths: 0, physics: 0, chemistry: 0, matched: 0 };

    const yieldVal =
        YIELD_SUBJECT_WEIGHTS.maths     * bucket.maths +
        YIELD_SUBJECT_WEIGHTS.physics   * bucket.physics +
        YIELD_SUBJECT_WEIGHTS.chemistry * bucket.chemistry;

    return { yield: yieldVal, hasGranular: bucket.matched > 0, bySubject: bucket, matched: bucket.matched };
}

/**
 * Historical Log Imputation Protocol — global macro conversion scalar.
 *
 * When a daily-history log entry lacks granular subject breakdowns (i.e. no
 * live bank question can be dated to it), we do NOT fall back to the raw
 * scalar count. Instead we synthesise a global conversion factor from the
 * live solved-bank state:
 *
 *   C_macro = 0.50·β_Math·(Q̄_Math/1200)
 *           + 0.30·β_Phys·(Q̄_Phys/1200)
 *           + 0.20·β_Chem·(Q̄_Chem/1200)
 *
 * where β_s is the solved-count distribution ratio and Q̄_s the average qElo of
 * solved questions in subject s. Every legacy flat count is then multiplied by
 * C_macro so it lands on the same value matrix as the live yield points.
 *
 * @returns {number} C_macro (≥0). Returns 1 when the bank has no solved items,
 *                   preserving the legacy count verbatim so rendering never
 *                   fails on a totally fresh install.
 */
function _computeMacroImputationScalar() {
    const counts = { maths: 0, physics: 0, chemistry: 0 };
    const eloSums = { maths: 0, physics: 0, chemistry: 0 };
    let total = 0;

    for (const q of AppState.questionBank) {
        if (!q || q.status !== 'solved') continue;
        const subj = _normalizeSubjectKey(q.subject);
        if (!(subj in counts)) continue;
        counts[subj]++;
        eloSums[subj] += (typeof q.qElo === 'number' && isFinite(q.qElo) && q.qElo > 0)
            ? q.qElo : 1200;
        total++;
    }

    if (total === 0) return 1; // empty bank → keep raw counts (safe baseline)

    const beta = {
        maths: counts.maths / total,
        physics: counts.physics / total,
        chemistry: counts.chemistry / total,
    };
    const qBar = {
        maths: counts.maths > 0 ? eloSums.maths / counts.maths : 1200,
        physics: counts.physics > 0 ? eloSums.physics / counts.physics : 1200,
        chemistry: counts.chemistry > 0 ? eloSums.chemistry / counts.chemistry : 1200,
    };

    return (
        YIELD_SUBJECT_WEIGHTS.maths     * beta.maths     * (qBar.maths     / 1200) +
        YIELD_SUBJECT_WEIGHTS.physics   * beta.physics   * (qBar.physics   / 1200) +
        YIELD_SUBJECT_WEIGHTS.chemistry * beta.chemistry * (qBar.chemistry / 1200)
    );
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
        const raw = JSON.parse(localStorage.getItem('checkpoint:protocolZero') || '[]');
        penaltyDates = Array.isArray(raw) ? raw : [];
    } catch (e) {
        console.warn('[protocolZero] Corrupt penalty log in localStorage — treating as empty:', e);
        try { localStorage.removeItem('checkpoint:protocolZero'); } catch (_) {}
    }
    const penaltySet = new Set(penaltyDates);
    const penaltyFlags = history.map(h => penaltySet.has(h.date));

    // ── Friction-Inverse Cognitive Yield series (Y_day) ──
    // Replaces the legacy raw scalar `h.count` counters. For every history
    // entry we attempt a granular yield computation from the live solved
    // question bank (questions whose lastReviewedAt falls on that date);
    // entries with NO bank backing (legacy / pre-yield logs) are normalised
    // through the macro-imputation scalar C_macro so they land on the same
    // value matrix as the live yield points instead of reverting to raw
    // integer tallies. P0 enforcement is still applied inside drawCandlesticks.
    const C_macro = _computeMacroImputationScalar();
    const yieldByDate = _buildYieldIndex(); // one O(n) pass — was O(days × n)
    const counts = history.map(h => {
        const granular = _computeYieldForDate(h.date, yieldByDate);
        if (granular.hasGranular) return granular.yield;          // live Y_day
        return (Number(h.count) || 0) * C_macro;                  // imputed Y_day
    });

    // ── Label formatter: "Mon 12" style ──
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const labelFn = (i) => {
        const h = history[i];
        if (!h || !h.date) return `Day ${i + 1}`;
        const d = new Date(h.date + 'T00:00:00');
        if (isNaN(d.getTime())) return h.date;
        return `${DOW[d.getDay()]} ${d.getDate()}`;
    };

    // ── Equivalent Target Lock Adjustment ──
    // The cyan LOCK line must match the value matrix of the new daily yield
    // points, so the legacy arithmetic target sum is replaced by the
    // equivalently scaled yield boundary:
    //   Target_Yield = 0.50·maths + 0.30·physics + 0.20·chemistry
    const targetYield =
        YIELD_SUBJECT_WEIGHTS.maths     * baseTargets.maths +
        YIELD_SUBJECT_WEIGHTS.physics   * baseTargets.physics +
        YIELD_SUBJECT_WEIGHTS.chemistry * baseTargets.chemistry;

    // ── Render as OHLC candlesticks ──
    // Internal coordinate space is wider/taller than the old 320x80 so candles
    // are legible. The SVG's viewBox is set by drawCandlesticks; CSS on
    // #dynamic-graph stretches it to fill the card.
    //
    // Target Compliance: the scaled yield target becomes the green/red
    // threshold for every candle, and the tooltip formats the OHLC values as
    // "Yield Points" (2-dp precision) rather than raw integer tallies.
    const metrics = drawCandlesticks(svg, counts, {
        width: 360,
        height: 170,
        penaltyFlags,
        showPrediction: true,
        predDays: 5,
        compact: false,
        invert: false,
        valueLabel: 'Yield Points',
        valuePrecision: 2,
        labelFn,
        targetValue: targetYield,
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
    // Build the whole month as ONE string — grid.innerHTML += inside the
    // loops reparsed the entire (growing) grid on every cell, an O(n²)
    // reparse on each calendar open.
    let html = '';
    for (let i = 0; i < d.getDay(); i++) html += `<div class="cal-day"></div>`;
    let days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    for (let i = 1; i <= days; i++) {
        let sClass = 'active-month';
        if (AppState.calMonthOffset === 0 && i === currentLiveDate.getDate()) sClass += ' today';
        html += `<div class="cal-day ${sClass}">${i}</div>`;
    }
    grid.innerHTML = html;
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

let _multiChapterMode = null;

export function openMultiChapterMode(mode) {
    if (!PRACTICE_MODES.includes(mode) || mode === 'standard') return;
    _multiChapterMode = mode;
    const subject = AppState.currentSubject;
    const chapters = AppState.chapters[subject] || [];
    const options = document.getElementById('multi-chapter-options');
    const title = document.getElementById('multi-chapter-mode-title');
    if (!options) return;
    if (title) title.textContent = `${mode === 'flow' ? '🎯 Flow State' : '⚡ Hardcore'} · Select chapters`;
    options.innerHTML = '';
    chapters.forEach((chapter, index) => {
        const label = document.createElement('label');
        label.className = 'multi-chapter-option';
        label.innerHTML = `<input type="checkbox" value="${escapeAttribute(chapter)}"${index === 0 ? ' checked' : ''}> <span>${escapeHtml(chapter)}</span>`;
        options.appendChild(label);
    });
    if (!chapters.length) {
        options.innerHTML = '<p class="box-desc">No chapters yet. Add a chapter first.</p>';
        const start = document.getElementById('multi-chapter-start');
        if (start) start.disabled = true;
    } else {
        const start = document.getElementById('multi-chapter-start');
        if (start) start.disabled = false;
    }
    openModal('multi-chapter-mode-modal');
}

export function startMultiChapterMode() {
    const options = document.querySelectorAll('#multi-chapter-options input[type="checkbox"]:checked');
    const chapters = Array.from(options).map(input => input.value);
    if (!_multiChapterMode || !chapters.length) return;
    AppState.currentChapter = chapters.join(' • ');
    AppState.currentChapterSelection = chapters;
    AppState.currentFilter = 'all';
    closeModalStr('multi-chapter-mode-modal');
    _setPracticeMode(_multiChapterMode);
}

export function openChapterDetail(ch) {
    AppState.currentChapterSelection = null;
    AppState.currentChapter = ch;
    AppState.currentFilter = 'all';
    // ── Go directly to question list — the chapter detail view is deprecated.
    // Mode buttons + feed button are injected inline into the question-list header.
    _renderModeButtonsIntoChapterDetail();
    showQuestionList();
}

export function renderChaptersList() {
    // ── Self-heal: surface orphaned chapters. Any chapter present in the bank
    // but missing from the chapter list (older gem-stamped imports) gets
    // registered here so its questions become reachable again. ──
    const _known = AppState.chapters[AppState.currentSubject] || (AppState.chapters[AppState.currentSubject] = []);
    let _healed = false;
    for (const q of AppState.questionBank) {
        if (q.subject === AppState.currentSubject && q.chapter && !_known.some(c => _chaptersMatch(c, q.chapter))) {
            _known.push(q.chapter);
            _healed = true;
        }
    }
    if (_healed) saveAllAsync().catch(console.error);
    let cont = document.getElementById('chapters-list-container');
    cont.innerHTML = '';
    (AppState.chapters[AppState.currentSubject] || []).forEach(ch => {
        let div = document.createElement('div');
        div.className = 'chapter-item';
        div.innerHTML =
            `<span>${escapeHtml(ch)}</span><span class="delete-chapter" onclick="event.stopPropagation(); deleteChapter('${escapeAttribute(ch)}')">🗑</span>`;
        div.onclick = () => openChapterDetail(ch);
        cont.appendChild(div);
    });
}

export function deleteChapter(ch) {
    if (confirm(`Nuke "${ch}"? This wipes everything inside.`)) {
        // Remove EVERY case-variant tile — the question wipe below matches via
        // _chaptersMatch (case-insensitive), so leaving a "modern physics"
        // twin behind produced an empty surviving tile.
        AppState.chapters[AppState.currentSubject] = AppState.chapters[AppState.currentSubject].filter(c => !_chaptersMatch(c, ch));
        // Use splice to avoid reassigning the exported let binding
        for (let i = AppState.questionBank.length - 1; i >= 0; i--) {
            if (AppState.questionBank[i].subject === AppState.currentSubject && _chaptersMatch(AppState.questionBank[i].chapter, ch)) {
                // Tombstone so a stale cloud snapshot can't resurrect the chapter's questions.
                recordCloudTombstone(AppState.questionBank[i].id).catch(console.error);
                AppState.questionBank.splice(i, 1);
            }
        }
        saveAllAsync().catch(console.error);
        renderChaptersList();
    }
}

export function addChapter() {
    let name = document.getElementById('new-chapter-input').value.trim();
    if (name && !AppState.chapters[AppState.currentSubject].some(c => _chaptersMatch(c, name))) {
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
    if (typeof window.__jmaxAppToast === 'function') window.__jmaxAppToast('✔ Profile data locked in. Your build has been updated.');
    else alert("Profile data locked in. Your build has been updated.");
}

// ── Legacy quota entry points (kept as safe no-ops for old call sites) ──────
// v2 targets are computed by the Daily Directive (directive.js); the manual
// quota inputs and the 24h lock were removed. window.saveTargets and the
// registerUiCallbacks('lockTargetsOnly') bridge stay for compatibility.

export async function saveTargets() {
    try {
        await Directive.ensureToday();
        Directive.renderSettingsPanel();
        if (typeof window.__jmaxAppToast === 'function') {
            window.__jmaxAppToast('⚡ Directive recalibrated from your ledger. Contracts are computed — not set.');
        }
    } catch (e) { console.error('Directive recalibrate fault:', e); }
}

window.saveErrTargets = async function saveErrTargets() {
    // Dead since v2: fix quotas are priced into the Directive contract
    // (Cortex fixes pay 1.4 LU) and the Debt Collector quest. Kept as a no-op
    // for any stale callers.
    try { Directive.renderSettingsPanel(); } catch (_) {}
};

/**
 * Lock target inputs — no-op since v2 (contracts are computed each morning,
 * nothing to lock). Retained because storage.js's cloud-restore path calls
 * it via registerUiCallbacks.
 */
export function lockTargetsOnly() { /* v2: nothing to lock */ }

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
            // ── Deterministic canvas sizing ────────────────────────────────
            // Old code read img.clientWidth/clientHeight — those are 0 while
            // the crop modal is display:none (or before first layout), which
            // happens on iPad Safari when the data URL resolves synchronously
            // through `img.complete` → the overlay canvas was created 0×0 and
            // the user could never draw. Size is now computed purely from the
            // natural dimensions + the CSS max-height cap (400px / 46vh), so
            // it is correct no matter when onload fires.
            const size = resolveCanvasDisplaySize(img);
            canvas.width = size.w;
            canvas.height = size.h;
            canvas.style.width = size.w + 'px';
            canvas.style.height = size.h + 'px';
            cropSession.ctxRefs[src.id] = canvas.getContext('2d');
            redrawAllRectangles(src.id);
        };
        if (img.complete) img.onload();
    });

    // Re-size the overlay canvases when the viewport changes (iPad URL-bar
    // collapse / rotate) — the 46vh mobile cap moves with it. Bound once per
    // module lifetime; the handler reads live refs so stale ones are skipped.
    if (!_cropResizeBound) {
        _cropResizeBound = true;
        window.addEventListener('resize', () => {
            Object.keys(cropSession.imgRefs).forEach(srcIdStr => {
                const img = cropSession.imgRefs[srcIdStr];
                const canvas = cropSession.canvasRefs[srcIdStr];
                if (!img || !canvas || !img.naturalWidth) return;
                const size = resolveCanvasDisplaySize(img);
                canvas.width = size.w;
                canvas.height = size.h;
                canvas.style.width = size.w + 'px';
                canvas.style.height = size.h + 'px';
                redrawAllRectangles(parseInt(srcIdStr));
            });
        });
    }

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

// Display size the browser will give <img> (CSS: width:auto + max-height cap,
// object-fit:contain), computed WITHOUT touching clientWidth — which is 0
// while the crop modal is hidden and would size the overlay canvas 0×0.
function resolveCanvasDisplaySize(img) {
    const naturalW = img.naturalWidth || 1;
    const naturalH = img.naturalHeight || 1;
    const maxH = resolveImageMaxHeightPx(img);
    const scale = Math.min(1, maxH / naturalH);
    return {
        w: Math.max(1, Math.round(naturalW * scale)),
        h: Math.max(1, Math.round(naturalH * scale)),
    };
}

function resolveImageMaxHeightPx(img) {
    let v = '';
    try { v = window.getComputedStyle(img).maxHeight || ''; } catch (_) { /* noop */ }
    const m = v.trim().match(/^([\d.]+)(px|vh)$/i);
    if (!m) return 400;
    const n = parseFloat(m[1]);
    return m[2].toLowerCase() === 'vh' ? (n * window.innerHeight) / 100 : n;
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
    const canvas = cropSession.canvasRefs[sourceId];
    // Scale factors between the overlay canvas (deterministic display size)
    // and the full-resolution source — avoids img.clientWidth, which is 0
    // when layout hasn't run yet and would produce a garbage crop region.
    if (!canvas || !canvas.width || !canvas.height || !img || !img.naturalWidth) {
        redrawAllRectangles(sourceId);
        return;
    }
    const scaleX = img.naturalWidth / canvas.width;
    const scaleY = img.naturalHeight / canvas.height;
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
            // Bounds guard: if the extractedItems buffer changed while the
            // file picker was open, never let a stale index write out of
            // bounds or hijack a different question.
            if (Array.isArray(AppState.extractedItems)
                && targetIdx >= 0 && targetIdx < AppState.extractedItems.length) {
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
        if (!croppedDataUrl) { alert('Crop failed to decode — try a smaller selection.'); redrawAllRectangles(sourceId); return; }
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
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(btnX, btnY, btnSize, btnSize, 6);
        } else {
            // Older iPad Safari / WebView lack roundRect — plain rect keeps
            // the draw loop alive instead of throwing mid-drag.
            ctx.rect(btnX, btnY, btnSize, btnSize);
        }
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
        // onerror resolves null so one corrupt segment can never leave the
        // stitch promise permanently pending (spinner hang). Loaded segments
        // are stitched; a total failure resolves null like an empty batch.
        const loaded = await Promise.all(segments.map(seg => new Promise(res => {
            const img = new Image();
            img.onload = () => res(img);
            img.onerror = () => res(null);
            img.src = seg.cropDataUrl;
        })));
        const imgs = loaded.filter(Boolean);
        if (imgs.length === 0) return resolve(null);
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
        let leftBad = false, rightBad = false;
        const tryCombine = () => {
            if ((leftImg && !leftLoaded) || (rightImg && !rightLoaded)) return;
            // Both failed to decode — settle instead of hanging forever.
            if (leftBad && rightBad) return resolve(null);
            const leftW = leftLoaded && !leftBad ? left.width : 0;
            const leftH = leftLoaded && !leftBad ? left.height : 0;
            const rightW = rightLoaded && !rightBad ? right.width : 0;
            const rightH = rightLoaded && !rightBad ? right.height : 0;
            const totalWidth = leftW + rightW;
            const maxHeight = Math.max(leftH, rightH);
            const canvas = document.createElement('canvas');
            canvas.width = totalWidth;
            canvas.height = maxHeight;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, totalWidth, maxHeight);
            if (leftLoaded && !leftBad) ctx.drawImage(left, 0, 0);
            if (rightLoaded && !rightBad) {
                const yOffset = (maxHeight - rightH) / 2;
                ctx.drawImage(right, leftW, yOffset);
            }
            resolve(canvas.toDataURL('image/png'));
        };
        if (leftImg) { left.onload = () => { leftLoaded = true; tryCombine(); }; left.onerror = () => { leftLoaded = true; leftBad = true; tryCombine(); }; left.src = leftImg; }
        else { leftLoaded = true; }
        if (rightImg) { right.onload = () => { rightLoaded = true; tryCombine(); }; right.onerror = () => { rightLoaded = true; rightBad = true; tryCombine(); }; right.src = rightImg; }
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
    let _skippedLocked = 0;
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
                hint: "",
                // ── Cognitive MMR: seed the dynamic Implied Difficulty Rating
                // (qElo). Defaults to the running chapter average Elo, or 1200
                // if the chapter is clean. Re-affirmed at saveAllQuestions(). ──
                qElo: _computeDefaultQEloForCurrentChapter(),
                isAnomaly: false,
            });
        } else {
            _skippedLocked++;   // stitch failed (null) — counted, not silently vanished
        }
    });
    if (_skippedLocked > 0) {
        alert(`${_skippedLocked} locked question${_skippedLocked > 1 ? 's' : ''} could not be stitched (image processing failed) and will not be imported.`);
    }
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
        // Show the crop modal FIRST so the source strip renders into a visible
        // layout before refreshCropUI builds the canvases (defense-in-depth
        // on top of the deterministic natural-size canvas math).
        const cropModal = document.getElementById('crop-modal');
        if (cropModal) {
            cropModal.style.display = 'flex';
            cropModal.classList.add('active');
        }
        initCropSession(base64Array);
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
- NEVER emit raw unicode math glyphs. Always: ≠ → \\\\neq, ≤ → \\\\le, ≥ → \\\\ge, ± → \\\\pm, × → \\\\times, ∞ → \\\\infty, ≡ → \\\\equiv, → → \\\\to. A glyph like ≢ must never appear as a literal character in any field.


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
            q.extractedText = repairLatex(typeof obj.extractedText === 'string' ? obj.extractedText : '');
            // Gemini sometimes returns option OBJECTS ({text: ...}) — the old
            // no-op ternary let them through and they rendered as
            // "[object Object]". Coerce to the text payload.
            q.options = options.map(o => repairLatex(typeof o === 'string' ? o : String((o && (o.text ?? o.label ?? o.value)) ?? '')));
            q.type = options.length > 0 ? 'mcq' : 'text';
            // Belt-and-suspenders: flag (never block) rows whose math still
            // fails to render after the deterministic repair.
            if (!mathOk(q.extractedText)) { q.latexRepairFailed = true; console.warn('[latex-repair] segment failed post-repair in extractTextForAll:', i); }
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
    // Stage-completion notice as toast [AUDIT P2]: a blocking alert here made
    // the ingestion wizard feel like a dialog gauntlet; the preview modal that
    // just opened IS the confirmation.
    if (typeof window.__jmaxAppToast === 'function') window.__jmaxAppToast('✅ Text extracted and stored — review the preview below.');
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

                AppState.extractedItems[idx].correctAnswer = Array.isArray(ans) ? ans.map(a => repairLatex(a)) : repairLatex(ans);
                AppState.extractedItems[idx].solution = repairLatex(typeof item.solution === 'string' ? item.solution : "");
                if (!mathOk(AppState.extractedItems[idx].solution)) {
                    AppState.extractedItems[idx].latexRepairFailed = true;
                    console.warn('[latex-repair] answer-key solution failed post-repair:', idx);
                }

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
        if (typeof window.__jmaxAppToast === 'function') window.__jmaxAppToast('✅ Answer mapping complete via image. All locked in.');
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

                AppState.extractedItems[idx].correctAnswer = Array.isArray(ans) ? ans.map(a => repairLatex(a)) : repairLatex(ans);
                AppState.extractedItems[idx].solution = repairLatex(typeof item.solution === 'string' ? item.solution : "");
                if (!mathOk(AppState.extractedItems[idx].solution)) {
                    AppState.extractedItems[idx].latexRepairFailed = true;
                    console.warn('[latex-repair] text answer-key solution failed post-repair:', idx);
                }

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
        if (typeof window.__jmaxAppToast === 'function') window.__jmaxAppToast('✅ Text mapping complete. All answers linked.');
        showPreviewModal();
    } catch (e) {
        hideLoading();
        alert("Mapping crashed: " + e.message);
    }
}

// Reentrancy lock for saveAllQuestions — the import buffer
// (AppState.extractedItems) is only cleared AFTER a successful commit, so a
// double-click / double-invocation on "Import All Questions" used to push the
// entire batch a second time → the classic "my uploads randomly duplicate".
let _saveAllQuestionsInFlight = false;

/**
 * Dedupe key for an extracted/banked question. Prefers normalized question
 * text; falls back to an image fingerprint for image-only items. Returns null
 * when there is not enough signal to safely dedupe (item is always imported).
 *
 * The text key is deliberately CHAPTER-INDEPENDENT: import places everything
 * into the session chapter, so re-pasting a dump while on a different chapter
 * used to create one copy per chapter (chapter-scoped keys couldn't see the
 * duplicate). Same text in the same subject = same question, anywhere. The
 * image fingerprint key follows the same rule so image-only / cropped
 * questions can't multiply across chapters either.
 */
function _questionDedupeKey(subject, chapter, q) {
    const text = (q.extractedText || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
    if (text.length >= 12) return subject + '|t:' + text;
    const img = q.imageDataUrl;
    if (typeof img === 'string' && img.length > 100) {
        return subject + '|i:' + img.length + ':' + img.slice(-64);
    }
    return null;
}

export function saveAllQuestions() {
    // ── Guards: no buffer → nothing to do; already saving → swallow the
    // re-entrant click (double-click protection). ──
    if (!Array.isArray(AppState.extractedItems) || AppState.extractedItems.length === 0) {
        forceHideModal('preview-modal');
        return;
    }
    if (_saveAllQuestionsInFlight) return;
    _saveAllQuestionsInFlight = true;

    try {
    const bankBeforeLength = AppState.questionBank.length;
    // Seed the dedupe set with the existing bank so re-pasting the same Gem
    // dump (or the same crop batch) can't double-import, and catch dupes
    // inside the batch itself.
    const seenKeys = new Set();
    const dupeOriginByKey = new Map();
    for (const existing of AppState.questionBank) {
        const k = _questionDedupeKey(existing.subject, existing.chapter, existing);
        if (k && !seenKeys.has(k)) {
            seenKeys.add(k);
            dupeOriginByKey.set(k, { subject: existing.subject, chapter: existing.chapter });
        }
    }
    let skippedDupes = 0;
    for (let i = 0; i < AppState.extractedItems.length; i++) {
        let q = AppState.extractedItems[i];
        const manualInput = document.getElementById(`manual-answer-${i}`);
        let rawAnswer = (manualInput && manualInput.value.trim()) ? manualInput.value.trim() : q.correctAnswer;

        let finalAnswer;
        // FIX: Only comma-split a string answer into a multi-select array when
        // every token is a bare option letter ("A, C") or a quoted "[...]" is
        // already an array. Multi-part free-text answers ("(a) ..., (b)(i) ...")
        // contain LaTeX + commas and were being chopped into garbage array
        // elements — which then misclassified the question as 'mcq'.
        if (typeof rawAnswer === 'string' && rawAnswer.includes(',') && /^[A-Da-d](?:\s*,\s*[A-Da-d])*$/.test(rawAnswer.trim())) {
            finalAnswer = rawAnswer.split(',').map(s => s.trim().toUpperCase()).filter(s => s);
        } else if (Array.isArray(rawAnswer)) {
            finalAnswer = rawAnswer;
        } else {
            finalAnswer = rawAnswer;
        }

        if (!q.type || q.type === 'text') {
            if (Array.isArray(finalAnswer) && q.options.length > 0) {
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
            // ── Placement: session context ALWAYS wins ──
            // Questions are filed exactly where the user was when they pasted
            // or uploaded them — external subject/chapter stamps (Gemini Gem
            // payloads) used to override this and silently spawn new chapters.
            // The Gem's stamps are still preserved as gemSubject / gemChapter
            // provenance on the bank object for future tooling; they never
            // drive placement and never create chapters.
            subject: _normalizeSubjectKey(AppState.currentSubject || 'physics'),
            chapter: (typeof AppState.currentChapter === 'string' && AppState.currentChapter.trim())
                ? AppState.currentChapter.trim()
                : null,
            gemSubject: (typeof q.gemSubject === 'string' && q.gemSubject) ? q.gemSubject : null,
            gemChapter: (typeof q.gemChapter === 'string' && q.gemChapter) ? q.gemChapter : null,
            imageDataUrl: q.imageDataUrl,
            diagramImageUrl: q.diagramImageUrl || null,
            // ── Gem auto-crop provenance: survives into the bank so a skipped
            // or failed map can be re-run later (the coords are tiny JSON). ──
            gemImage: q.gemImage || null,
            gemOptionImages: q.gemOptionImages || null,
            gemSolutionImage: q.gemSolutionImage || null,
            optionImageUrls: q.optionImageUrls || null,
            solutionImageUrl: q.solutionImageUrl || null,
            extractedText: q.extractedText || "",
            options: q.options || [],
            correctAnswer: finalAnswer,
            type: q.type,
            status: 'unsolved',
            errorReason: null,
            timeTaken: 0,
            solution: q.solution || "",
            hint: q.hint || "",
            // ── Cognitive MMR: carry over the seeded qElo from the crop
            // pipeline, or recompute the chapter-average default if it was
            // never set. isAnomaly starts false; the engine flags it if the
            // qElo ever shoots >600 pts past the chapter baseline. ──
            qElo: (typeof q.qElo === 'number' && isFinite(q.qElo)) ? q.qElo : _computeDefaultQEloForCurrentChapter(),
            isAnomaly: false,
            // ── NEW (pre-ELO schema): carry provenance from processGemTextDump
            // so calculateEloMigration knows whether to trust qElo immediately
            // (gem-stamped) or wait for the legacy warmup (uncalibrated). ──
            qEloSource: q.qEloSource || 'uncalibrated',
            qEloStampedBy: q.qEloStampedBy || null,
            qEloStampedAt: q.qEloStampedAt || null,
            solveCount: 0,
            // ── Cognitive Cortex v3: creation instant for age-at-solve
            // priors (hot-strike / cold-revival) and neglect boosting.
            // Purely additive; older rows are backfilled by
            // migrateQuestionBankSR → migrateCortexFields on boot. ──
            createdAt: new Date().toISOString(),
            lastSolvedAt: null,
            tags: Array.isArray(q.tags) ? q.tags.slice() : [],
            targetTimeMins: (typeof q.targetTimeMins === 'number' && q.targetTimeMins > 0)
                ? q.targetTimeMins
                : (typeof q.qElo === 'number' ? _eloBandTargetTime(q.qElo) : 5),
            stampBatchSuspiciousDistribution: !!q.stampBatchSuspiciousDistribution,
            stampBatchSuspiciousStdev: !!q.stampBatchSuspiciousStdev,
            difficulty: q.difficulty || null,
        };
        // ── Dedupe: skip exact duplicates already in the bank or earlier in
        // this batch (same subject+chapter+text / image fingerprint). ──
        const _dk = _questionDedupeKey(newQ.subject, newQ.chapter, newQ);
        if (_dk) {
            if (seenKeys.has(_dk)) {
                skippedDupes++;
                // Remember where the first copy lives so the import alert can
                // point the user at the origin chapter instead of silently
                // swallowing the batch (the old "my questions vanished" trap).
                if (!dupeOriginByKey.has(_dk)) {
                    dupeOriginByKey.set(_dk, { subject: newQ.subject, chapter: newQ.chapter });
                }
                continue;
            }
            seenKeys.add(_dk);
            dupeOriginByKey.set(_dk, { subject: newQ.subject, chapter: newQ.chapter });
        }
        AppState.questionBank.push(newQ);
        // ── Register the (possibly gem-stamped) chapter so it actually gets a
        // tile in the chapter grid. Without this, questions imported under a
        // chapter name not already in AppState.chapters are orphaned — stored
        // in the bank (so re-uploads flag "duplicate") but never rendered. ──
        const _chList = AppState.chapters[newQ.subject] || (AppState.chapters[newQ.subject] = []);
        if (newQ.chapter && !_chList.some(c => _chaptersMatch(c, newQ.chapter))) _chList.push(newQ.chapter);
        // ── Mock Mode: while a mock section panel is open for filling, every
        // committed question is stamped reserved and linked into that draft
        // section, so a paper survives app closes mid-build. ──
        if (AppState.mockDraftContext && window.MockEngine && typeof window.MockEngine.linkQuestion === 'function') {
            try { window.MockEngine.linkQuestion(AppState.mockDraftContext, newQ); } catch (_) {}
        }
    }
    const importedCount = AppState.questionBank.length - bankBeforeLength;
    // ── Clear the import buffer AFTER a successful commit so a second
    // invocation can never re-push the same batch. ──
    AppState.extractedItems = [];
    saveAllAsync().catch(console.error);
    // ── Auto-navigate: if the freshly imported batch landed on a different
    // (subject, chapter) than the user is currently viewing, jump there so
    // the chapter-detail list reflects the new arrivals instead of looking
    // "empty". Mirrors the "where did my questions go?" support ticket. ──
    const firstNew = AppState.questionBank[bankBeforeLength];
    if (firstNew && firstNew.subject && firstNew.chapter &&
        (firstNew.subject !== AppState.currentSubject ||
         firstNew.chapter !== AppState.currentChapter)) {
        AppState.currentSubject  = firstNew.subject;
        AppState.currentChapter  = firstNew.chapter;
        AppState.currentFilter  = 'all';
        const detail = document.getElementById('detail-chapter-name');
        if (detail) detail.innerHTML =
            `${escapeHtml(AppState.currentChapter)} <span style="font-size:14px; color:#8a8ad3;">(${escapeHtml(AppState.currentSubject)})</span>`;
        renderChaptersList();
        showPracticeSubview('practice-chapter-detail-view');
        _renderModeButtonsIntoChapterDetail();
        showQuestionList();
        console.log('[saveAllQuestions] Auto-navigated to fresh-imported chapter:',
            firstNew.subject, '/', firstNew.chapter);
    }
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
    let dupSummary = '';
    if (skippedDupes > 0) {
        const originSet = new Set();
        dupeOriginByKey.forEach(o => {
            const subj = _normalizeSubjectKey(o.subject || '');
            originSet.add(`${o.chapter || 'Uncategorized'}${subj ? ' (' + subj + ')' : ''}`);
        });
        const origins = Array.from(originSet).slice(0, 4);
        dupSummary = ` (${skippedDupes} duplicate${skippedDupes > 1 ? 's' : ''} skipped — already in ${origins.join(', ')}${originSet.size > 4 ? ` +${originSet.size - 4} more` : ''})`;
    }
    // Final import summary as non-blocking toast [AUDIT P2]: the bank view
    // already re-rendered beneath it — a blocking alert here interrupted the
    // exact moment the user should be scanning their fresh questions.
    if (typeof window.__jmaxAppToast === 'function') {
        window.__jmaxAppToast(`✅ Imported ${importedCount} fresh problems.${dupSummary}`);
    } else {
        alert(`Successfully imported ${importedCount} fresh problems into the local engine.${dupSummary} Let's see how you handle them.`);
    }
    } finally {
        _saveAllQuestionsInFlight = false;
    }
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

    // ─────────────────────────────────────────────────────────────────────
    // Schema-drift tolerance: rename common aliases → canonical fields so the
    // existing pre-cleaners and the processGemTextDump split can stay strict
    // on ONE key per field. The user can copy/paste JSON from any Gem variant
    // (custom AI Studio, native Gemini, manual export, third-party feeds) and
    // the pipeline still ingests without errors.
    // ─────────────────────────────────────────────────────────────────────
    // Three categories handled:
    //   1. Question text:  text|question|stem|body|problem → "extractedText"
    //   2. Answer key:     answer|correctOption|correct|sol → "correctAnswer"
    //   3. Solution/work:  explanation|reasoning|work|derivation → "solution"
    // Plus a single-letter parenthetical unwrap: "(B)" → "B" so embedded
    // option letters collapse to canonical "B" before MCQ matching.
    // ─────────────────────────────────────────────────────────────────────
    const _SCHEMA_TEXT_ALIASES     = ['text', 'question', 'stem', 'body', 'problem'];
    const _SCHEMA_ANSWER_ALIASES   = ['answer', 'correctOption', 'correct', 'sol'];
    const _SCHEMA_SOLUTION_ALIASES = ['explanation', 'reasoning', 'work', 'derivation'];
    const _SCHEMA_HINT_ALIASES     = ['clue', 'tip', 'nudge'];
    function _aliasRenameStep(input, canonical, aliasList) {
        const renamed = {};
        const re = new RegExp(
            '"(' + canonical + '|' + aliasList.join('|') + ')"\\s*:\\s*"',
            'gi'
        );
        input = input.replace(re, (match, key) => {
            if (key === canonical) return match;
            renamed[key] = (renamed[key] || 0) + 1;
            return '"' + canonical + '": "';
        });
        return { input, renamed };
    }
    let _s1 = _aliasRenameStep(rawInput, 'extractedText', _SCHEMA_TEXT_ALIASES);
    rawInput = _s1.input;
    let _s2 = _aliasRenameStep(rawInput, 'correctAnswer', _SCHEMA_ANSWER_ALIASES);
    rawInput = _s2.input;
    let _s3 = _aliasRenameStep(rawInput, 'solution', _SCHEMA_SOLUTION_ALIASES);
    rawInput = _s3.input;
    let _s4 = _aliasRenameStep(rawInput, 'hint', _SCHEMA_HINT_ALIASES);
    rawInput = _s4.input;
    // ── Single-letter parenthetical unwrap: "(B)" → "B" ──
    // Only matches exactly one uppercase letter or single digit wrapped in
    // parens. Leaves values like "(x+1)" or "(P+Q)" untouched. Applies AFTER
    // the answer rename so it catches both renamed `answer` keys AND canonical
    // `correctAnswer` keys from the source.
    rawInput = rawInput.replace(
        /"correctAnswer"\s*:\s*"\(((?:[A-Z]|[0-9]))\)"/gi,
        '"correctAnswer": "$1"'
    );
    const _allRenamed = Object.assign({}, _s1.renamed, _s2.renamed, _s3.renamed, _s4.renamed);
    const _driftKeys = Object.keys(_allRenamed);
    if (_driftKeys.length > 0) {
        const parts = _driftKeys.map(k => {
            const targets = [];
            if (_s1.renamed[k]) targets.push('"extractedText"\u00d7' + _s1.renamed[k]);
            if (_s2.renamed[k]) targets.push('"correctAnswer"\u00d7' + _s2.renamed[k]);
            if (_s3.renamed[k]) targets.push('"solution"\u00d7' + _s3.renamed[k]);
            if (_s4.renamed[k]) targets.push('"hint"\u00d7' + _s4.renamed[k]);
            return k + '\u2192' + targets.join(',');
        });
        console.warn(
            '[sanitizeGemTextDump] Schema drift detected: ' + _driftKeys.length + ' alias key(s). ' +
            '[' + parts.join(' | ') + ']. Auto-renamed to canonical keys. ' +
            'Update your Gem instructions to emit extractedText/correctAnswer/solution ' +
            'for clean parsing.'
        );
    }

    // Step 1: Repair unescaped inner quotes inside "extractedText" properties globally.
    // The lookahead MUST terminate at ANY following key (generic `"key":` shape),
    // not just options/correctAnswer/type/solution — Gem payloads order fields
    // arbitrarily (subject/chapter/qElo/targetTimeMins often follow extractedText),
    // and the old partial list let the lazy capture swallow those keys, escaping
    // their quotes (qElo stamps destroyed) and, when none of the whitelisted keys
    // existed in the item, eating the NEXT item's "extractedText" anchor (whole
    // question silently dropped from the ingest).
    rawInput = rawInput.replace(/"extractedText"\s*:\s*"([\s\S]*?)"\s*(?=,\s*"[^"\n]+?"\s*:|,\s*\}|\s*\}|\s*\])/g, (match, content) => {
        let cleaned = content.replace(/\\"/g, '\uEAEA').replace(/"/g, '\\"').replace(/\uEAEA/g, '\\"');
        return `"extractedText": "${cleaned}"`;
    });

    // Step 2: Repair unescaped inner quotes inside "solution" properties globally.
    // Same generic-key lookahead as Step 1 — solution is frequently followed by
    // subject/chapter/qElo/tags/model, which the old whitelist didn't know.
    rawInput = rawInput.replace(/"solution"\s*:\s*"([\s\S]*?)"\s*(?=,\s*"[^"\n]+?"\s*:|,\s*\}|\s*\}|\s*\])/g, (match, content) => {
        let cleaned = content.replace(/\\"/g, '\uEAEA').replace(/"/g, '\\"').replace(/\uEAEA/g, '\\"');
        return `"solution": "${cleaned}"`;
    });

    // Step 2b: Repair unescaped inner quotes inside "hint" properties globally.
    // Same generic-key lookahead — a hint with unescaped quotes would otherwise
    // truncate at the first stray quote and corrupt the fields that follow it.
    rawInput = rawInput.replace(/"hint"\s*:\s*"([\s\S]*?)"\s*(?=,\s*"[^"\n]+?"\s*:|,\s*\}|\s*\}|\s*\])/g, (match, content) => {
        let cleaned = content.replace(/\\"/g, '\uEAEA').replace(/"/g, '\\"').replace(/\uEAEA/g, '\\"');
        return `"hint": "${cleaned}"`;
    });

    // Step 3: Repair unescaped inner quotes inside individual option item entries safely (handles same-line options).
    // The next-option lookahead must be `,"[A-D])` WITHOUT a trailing quote — the
    // old `,"[A-D])"` only matched when the NEXT option had EMPTY text, so real
    // same-line options ("A) $9$","B) $6$") collapsed into ONE giant match and
    // every inner quote (including the legitimate option separators) got escaped,
    // mangling the whole options array into garbage tokens.
    rawInput = rawInput.replace(/"([A-D]\)[\s\S]*?)"\s*(?=,\s*"[A-D]\)|,\s*\]|\s*\])/g, (match, content) => {
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
 * Collapse JSON double-escaped backslash runs (\\ → \) for KaTeX, then convert
 * only TRUE JSON newline escapes (\n NOT followed by a letter) into real
 * newlines. LaTeX commands that start with 'n' — \nu, \neq, \nabla, \notin,
 * \ne, \neg — MUST survive: they are literally `\n` followed by a letter.
 * The old /\\+n/ blanket replacement destroyed them (e.g. \\nu_e → newline + "u_e"),
 * corrupting the math before KaTeX ever saw it.
 */
function _fixBackslashRuns(s) {
    return String(s)
        // Halve backslash PAIRS, never collapse runs to one. A raw `\\frac`
        // (JSON escape of `\frac`) must become `\frac`, but a raw `\\\\` (JSON
        // escape of the `\\` row separator inside aligned/matrix blocks) must
        // become `\\` — the old .replace(/\\+/g,'\\') collapsed BOTH to `\`,
        // which is why align blocks rendered as garbage here but fine in the
        // Gemini app (Gemini never JSON-unescapes the dump).
        .replace(/\\\\/g, '\\')
        .replace(/\\n(?!\w)/g, '\n');
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
// ── Real-JSON ingestion path ───────────────────────────────────────────────
// Most dumps from AI Studio / the Gem are (near-)valid JSON. The legacy regex
// pipeline below exists for genuinely broken dumps, but valid JSON deserves a
// real parse: JSON.parse is O(n) (no catastrophic-backtracking freezes on huge
// pastes) and — after cleanAndParseJson's bare-backslash pre-escape —
// preserves LaTeX exactly. JSON already resolved `\\frac` → `\frac`, so we
// must NOT re-collapse backslash runs: `\\` row separators in matrix/align
// environments are sacred.
function _repairLatexParsed(s) {
    // Parsed JSON needs only the cleanups that are SAFE on clean LaTeX:
    // collapse leftover double-backslash-before-macro artifacts from
    // over-escaped dumps (`\\frac` → `\frac`) while preserving `\\ ` row
    // breaks, then run the deterministic repair (unicode map, `\n` healing,
    // KaTeX-unsupported align/equation env normalization).
    if (typeof s !== 'string') return s;
    return repairLatex(s.replace(/\\\\(?=[a-zA-Z{])/g, '\\'));
}

function _compileDumpObject(obj) {
    const pick = (...keys) => {
        for (const k of keys) {
            const v = obj[k];
            if (v !== undefined && v !== null && v !== '') return v;
        }
        return undefined;
    };
    const rawText = pick('extractedText', 'text', 'question', 'stem', 'body', 'problem');
    if (typeof rawText !== 'string' || !rawText.trim()) return null;

    const rawOpts = pick('options');
    const options = Array.isArray(rawOpts)
        ? rawOpts.map(o => _repairLatexParsed(typeof o === 'string' ? o : (o && typeof o.text === 'string' ? o.text : ''))).filter(Boolean)
        : [];

    const rawAns = pick('correctAnswer', 'answer', 'correctOption', 'correct', 'sol');
    let correctAnswer = '';
    if (Array.isArray(rawAns)) {
        correctAnswer = rawAns.map(a => _repairLatexParsed(String(a).trim())).filter(Boolean);
    } else if (rawAns !== undefined && rawAns !== null) {
        correctAnswer = _repairLatexParsed(String(rawAns).trim());
    }

    let type = typeof obj.type === 'string' ? obj.type.trim().toLowerCase() : '';
    const rawSol = pick('solution', 'explanation', 'reasoning', 'work', 'derivation');
    const rawHint = pick('hint', 'clue', 'tip', 'nudge');
    if (!type) {
        if (options.length > 0) type = 'mcq';
        else if (correctAnswer && /^-?\d+(\.\d+)?$/.test(String(correctAnswer).trim())) type = 'numeric';
        else type = 'text';
    }

    const qEloNum = Number(pick('qElo'));
    const gemQElo = (Number.isFinite(qEloNum) && qEloNum >= 800 && qEloNum <= 2550) ? Math.round(qEloNum) : null;
    const tgtNum = Number(pick('targetTimeMins'));
    const gemTargetTime = (Number.isFinite(tgtNum) && tgtNum > 0 && tgtNum <= 60) ? Math.round(tgtNum) : null;
    const fallbackQElo = gemQElo !== null ? gemQElo : _computeDefaultQEloForCurrentChapter();
    const tags = Array.isArray(obj.tags)
        ? obj.tags.filter(t => typeof t === 'string').map(t => t.trim()).filter(Boolean).slice(0, 5)
        : [];

    // ── Gem diagram auto-crop mapping: imageRef tag + cropBox coordinates.
    // Baked into the dump by the Gem so the app can auto-crop the diagram
    // (and now per-option images + a solution image) from the tagged source
    // screenshots the user uploads post-ingest. ──
    const gemImage = _parseGemImageRef(obj);
    const gemOptionImages = _parseGemOptionImages(obj);
    const gemSolutionImage = _parseGemSolutionImage(obj);

    return {
        imageDataUrl: null,
        questionOnlyDataUrl: null,
        diagramImageUrl: null,
        optionImageUrls: null,
        solutionImageUrl: null,
        gemImage,
        gemOptionImages,
        gemSolutionImage,
        extractedText: _repairLatexParsed(rawText),
        options,
        correctAnswer,
        type,
        timeTaken: 0,
        solution: _repairLatexParsed(typeof rawSol === 'string' ? rawSol : ''),
        hint: _repairLatexParsed(typeof rawHint === 'string' ? rawHint : ''),
        qElo: fallbackQElo,
        targetTimeMins: gemTargetTime !== null ? gemTargetTime : _eloBandTargetTime(fallbackQElo),
        isAnomaly: false,
        qEloSource: gemQElo !== null ? 'gem-stamped' : 'uncalibrated',
        qEloStampedBy: (typeof obj.model === 'string' && obj.model.trim()) ? obj.model.trim().slice(0, 64) : null,
        qEloStampedAt: new Date().toISOString(),
        tags,
        difficulty: typeof obj.difficulty === 'string' ? obj.difficulty : null,
        subject: _normalizeSubjectKey(AppState.currentSubject || 'physics'),
        chapter: (typeof AppState.currentChapter === 'string' && AppState.currentChapter.trim())
            ? AppState.currentChapter.trim() : null,
        gemSubject: _normalizeSubjectKey(String(pick('subject', 'gemSubject') || '')),
        gemChapter: sanitizeChapterName(pick('chapter', 'gemChapter')),
    };
}

export async function processGemTextDump() {
    const terminalInput = document.getElementById('text-add-terminal')?.value.trim();
    if (!terminalInput) return alert("Terminal area is completely empty. Paste your Gem JSON payload.");

    showLoading("Running structural text compiler... Sanitizing LaTeX math symbols...");

    try {
        // ── Step 0: REAL-JSON fast path ──────────────────────────────────────
        // Most dumps from AI Studio / the Gem are (near-)valid JSON arrays.
        // cleanAndParseJson now pre-heals the silent single-backslash LaTeX
        // corruption (JSON.parse would mangle `\frac` into a form-feed +
        // "rac"), and _compileDumpObject maps field aliases without regex
        // surgery. This path is also O(n) — no catastrophic-backtracking
        // freezes on huge pastes. Only when this fails do we fall back to the
        // legacy regex pipeline for genuinely broken dumps.
        let parsedItems = null;
        try {
            const _parsed = cleanAndParseJson(terminalInput);
            const _arr = Array.isArray(_parsed) ? _parsed
                : (_parsed && Array.isArray(_parsed.questions)) ? _parsed.questions
                : (_parsed && Array.isArray(_parsed.items)) ? _parsed.items
                : (_parsed && Array.isArray(_parsed.data)) ? _parsed.data
                : null;
            if (_arr) {
                const _compiled = [];
                for (const _obj of _arr) {
                    if (!_obj || typeof _obj !== 'object') continue;
                    const _item = _compileDumpObject(_obj);
                    if (_item) _compiled.push(_item);
                }
                if (_compiled.length) parsedItems = _compiled;
            }
        } catch (_e) { /* not valid JSON — fall through to the legacy pipeline */ }

        if (!parsedItems) {
        // ── Legacy fallback — only for dumps the real JSON parse rejected ──
        // sanitizeGemTextDump rewrites alias keys to canonical ones, unwraps
        // "(B)"→"B", and repairs unescaped inner quotes before the splitter.
        const sanitizedInput = sanitizeGemTextDump(terminalInput);
        // Step 1: Isolate individual question segments using the unique "extractedText" key as a boundary anchor
        const segments = sanitizedInput.split(/"extractedText"\s*:\s*"/gi);
        if (segments.length <= 1) {
            throw new Error("Could not find any structural 'extractedText' keys in the pasted payload.");
        }

        parsedItems = [];

        // Loop through each isolated question block (skipping index 0)
        for (let i = 1; i < segments.length; i++) {
            const segment = segments[i];

            // 1. Extract the raw question text by finding where the next key metadata block begins.
            // Generic `"key":` lookahead (same root cause as sanitizeGemTextDump Step 1):
            // Gem payloads emit subject/chapter/qElo right after extractedText, and the
            // old partial whitelist made search() return -1 → the item was silently dropped.
            const textEndIndex = segment.search(/"\s*(?=,\s*"[^"\n]+?"\s*:|\s*\}|\s*\])/);
            if (textEndIndex === -1) continue;
            let extractedText = segment.substring(0, textEndIndex);

            // The remainder of the string segment holds metadata exclusive to this specific item
            // FIX: Gem payloads frequently order leading fields (id/type/subject/chapter/qElo/
            // targetTimeMins/difficulty/tags) BEFORE the extractedText anchor. The split above
            // discards everything before the anchor into the PREVIOUS segment, so those fields
            // were silently dropped — "type":"subjective" vanished (fallback misclassified the
            // question as text → mcq in saveAllQuestions) and the qElo stamp never reached rawQ.
            // Recover the previous segment's tail from its last '{' (this item's object opener)
            // and merge it with the trailing metadata so every field is extractable.
            const leadingMeta = segments[i - 1].substring(segments[i - 1].lastIndexOf('{'));
            const metadata = leadingMeta + segment.substring(textEndIndex);

            // 2. Extract options array contents
            let options = [];
            const optionsMatch = metadata.match(/"options"\s*:\s*\[([\s\S]*?)\]/i);
            if (optionsMatch && optionsMatch[1]) {
                // Collect individual string tokens within option boundaries
                const optMatches = optionsMatch[1].match(/"([\s\S]*?)"/g);
                if (optMatches) {
                    options = optMatches.map(o => {
                        // Strip outer quotes
                        let rawOpt = o.substring(1, o.length - 1);
                        // FIX: Convert literal \n or \\n traps into real newlines, then collapse backslashes
                        return repairLatex(_fixBackslashRuns(rawOpt));
                    });
                }
            }

            // 3. Extract correctAnswer string or multi-select array
            let correctAnswer = "";
            const ansMatch = metadata.match(/"correctAnswer"\s*:\s*(\[[\s\S]*?\]|"(?:[^"\\]|\\.)*")/i);
            if (ansMatch && ansMatch[1]) {
                let ansRaw = ansMatch[1].trim();
                if (ansRaw.startsWith('[')) {
                    const letterMatches = ansRaw.match(/"([^"]+)"/g);
                    if (letterMatches) {
                        correctAnswer = letterMatches.map(l => repairLatex(_fixBackslashRuns(l.replace(/"/g, '').trim())));
                    }
                } else {
                    // Same backslash normalization as options/solution/extractedText:
                    // JSON escapes turn "\frac" into "\\frac" — collapse back to one.
                    correctAnswer = repairLatex(_fixBackslashRuns(ansRaw.substring(1, ansRaw.length - 1).trim()));
                }
            }

            // 4. Extract question type tracking field
            // Case-insensitive key + value lowercase so "Type": "Subjective"
            // variants collapse to the canonical "subjective" instead of
            // drifting into the text-fallback classification.
            let type = "";
            const typeMatch = metadata.match(/"type"\s*:\s*"([^"]*)"/i);
            if (typeMatch && typeMatch[1]) {
                type = typeMatch[1].trim().toLowerCase();
            }

            // 5. Extract step-by-step solution string. The old lookahead only
            // matched when "solution" was the LAST field before `}` — solutions
            // followed by subject/chapter/qElo/etc. were silently dropped. Accept
            // any following key (or an object/array close) as the terminator.
            let solution = "";
            const solMatch = metadata.match(/"solution"\s*:\s*"([\s\S]*?)"\s*(?=,\s*"[^"\n]+?"\s*:|\s*\}|\s*\])/i);
            if (solMatch && solMatch[1]) {
                solution = solMatch[1];
            }

            // FIX: Normalize continuous runs of backslashes down to exactly ONE backslash for proper inline parsing
            // FIX: Convert literal macro/newline traps (\n or \\n) into actual newline characters first.
            // This prevents KaTeX from choking on an "Undefined control sequence: \n" error,
            // allowing math symbols like \mathrm to render successfully.
            extractedText = repairLatex(_fixBackslashRuns(extractedText));
            if (typeof solution === 'string') {
                solution = repairLatex(_fixBackslashRuns(solution));
            }

            // ── Build a synthetic rawQ from the segment metadata so the qElo-stamping
            // block below can reference rawQ.qElo / targetTimeMins / tags / model
            // without throwing ReferenceError. The original parser extracted only
            // extractedText / options / correctAnswer / type / solution and then
            // jumped straight to referencing rawQ fields that never existed. Build
            // them here so the existing stamping flow finally works on Gem-stamped
            // payloads (the schema drift fix above keeps these named canonical).
            function _extractStringField(meta, key) {
                const m = meta.match(new RegExp('"' + key + '"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"', 'i'));
                return m && m[1] ? m[1] : undefined;
            }
            function _extractNumberField(meta, key) {
                const m = meta.match(new RegExp('"' + key + '"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)', 'i'));
                const v = m ? parseFloat(m[1]) : NaN;
                return Number.isFinite(v) ? v : undefined;
            }
            function _extractStringArrayField(meta, key) {
                const m = meta.match(new RegExp('"' + key + '"\\s*:\\s*\\[([\\s\\S]*?)\\]', 'i'));
                if (!m) return undefined;
                const inner = m[1];
                const strMatches = inner.match(/"((?:[^"\\\\]|\\\\.)*)"/g);
                if (!strMatches) return [];
                return strMatches.map(s => s.replace(/^"|"$/g, '').replace(/\\\\"/g, '"').trim()).filter(Boolean);
            }
            const rawQ = {
                id:             _extractStringField(metadata, 'id'),
                subject:        _extractStringField(metadata, 'subject'),
                chapter:        _extractStringField(metadata, 'chapter'),
                qElo:           _extractNumberField(metadata, 'qElo'),
                targetTimeMins: _extractNumberField(metadata, 'targetTimeMins'),
                difficulty:     _extractStringField(metadata, 'difficulty'),
                tags:           _extractStringArrayField(metadata, 'tags'),
                model:          _extractStringField(metadata, 'model'),
                hint:           _extractStringField(metadata, 'hint'),
                chapterWeight:  _extractNumberField(metadata, 'chapterWeight'),
            };

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

            // ── NEW (pre-ELO schema): honour the Gemini Gem's qElo stamp and
            // provenance metadata. When the Gem emits qElo/targetTimeMins/tags
            // we trust them as the canonical implied-difficulty rating and
            // mark the question as gem-stamped so calculateEloMigration uses
            // the delta-based reward from solve #1 (no 600-iteration warmup).
            // When the Gem omits qElo we fall back to the chapter average and
            // leave qEloSource='uncalibrated' so the legacy warmup runs. ──
            const gemQElo = (typeof rawQ.qElo === 'number' && isFinite(rawQ.qElo) && rawQ.qElo >= 800 && rawQ.qElo <= 2550)
                ? Math.round(rawQ.qElo)
                : _computeDefaultQEloForCurrentChapter();
            const gemTargetTime = (typeof rawQ.targetTimeMins === 'number' && rawQ.targetTimeMins > 0 && rawQ.targetTimeMins <= 60)
                ? Math.round(rawQ.targetTimeMins)
                : _eloBandTargetTime(gemQElo);
            const gemSource = (typeof rawQ.qElo === 'number' && isFinite(rawQ.qElo) && rawQ.qElo >= 800 && rawQ.qElo <= 2550)
                ? 'gem-stamped'
                : 'uncalibrated';
            const gemStampedBy = (typeof rawQ.model === 'string' && rawQ.model.trim()) ? rawQ.model.trim().slice(0, 64) : null;
            const gemStampedAt = new Date().toISOString();
            const gemTags = Array.isArray(rawQ.tags)
                ? rawQ.tags.filter(t => typeof t === 'string').map(t => t.trim()).filter(Boolean).slice(0, 5)
                : [];
            // Optional AI weightage stamp (gemini gem prompt.txt): teaches the
            // resolver how important THIS user-named chapter is, even when the
            // saved name is a niche/short form no table could know.
            const gemChapterWeight = (typeof rawQ.chapterWeight === 'number' && isFinite(rawQ.chapterWeight))
                ? Math.max(0.05, Math.min(1.5, rawQ.chapterWeight))
                : null;

            // ── Gem diagram auto-crop mapping (legacy path): same imageRef +
            // cropBox extraction, done with regexes over the raw metadata. ──
            // (Per-option / solution images are parsed on the real-JSON fast
            // path only — regex surgery on nested arrays is too fragile.)
            const legacyGemImage = _compileLegacyGemImageRef(metadata);

            parsedItems.push({
                imageDataUrl: null,
                questionOnlyDataUrl: null,
                diagramImageUrl: null,
                optionImageUrls: null,
                solutionImageUrl: null,
                gemImage: legacyGemImage,
                gemOptionImages: null,
                gemSolutionImage: null,
                extractedText: extractedText,
                options: options,
                correctAnswer: correctAnswer,
                type: type,
                timeTaken: 0,
                solution: solution,
                hint: repairLatex(_fixBackslashRuns(typeof rawQ.hint === 'string' ? rawQ.hint : '')),
                qElo: gemQElo,
                targetTimeMins: gemTargetTime,
                isAnomaly: false,
                qEloSource: gemSource,
                qEloStampedBy: gemStampedBy,
                qEloStampedAt: gemStampedAt,
                tags: gemTags,
                _aiChapterWeight: gemChapterWeight,
                difficulty: typeof rawQ.difficulty === 'string' ? rawQ.difficulty : null,                // ── Placement fix: the question lives where the user pasted it ──
                // subject/chapter are locked to the active session context. The
                // Gem's own stamps are preserved ONLY as backend provenance
                // (gemSubject / gemChapter) for future tooling — they never
                // drive placement and never spawn new chapters.
                subject: _normalizeSubjectKey(AppState.currentSubject || 'physics'),
                chapter: (typeof AppState.currentChapter === 'string' && AppState.currentChapter.trim())
                    ? AppState.currentChapter.trim()
                    : null,
                gemSubject: _normalizeSubjectKey(rawQ.subject || '') || null,
                gemChapter: sanitizeChapterName(rawQ.chapter),
});
        }
        } // ← end legacy regex path (real-JSON path produced parsedItems above)

        // ── NEW: anti-cheat distribution check per-chapter ────────────────
        // If ≥80% of a chapter's ingest batch lands in T6-T7 (elite/olympiad)
        // AND the chapter's prior running avg was below T3, flag the batch
        // as suspicious — Gem-stamped qElo might be inflated to make the
        // chapter look elite. Also detect low-stdev
        // automation (stdDev < 15 over >20 questions = same-script timing).
        const chapterStats = _auditGemBatchByChapter(parsedItems);
        for (const it of parsedItems) {
            // Chapter-weightage learning: one AI opinion per pasted batch is
            // enough — keyed to the USER's chapter name (the placement name),
            // because that's the exact string the decay grid will resolve.
            if (it._aiChapterWeight != null && it.chapter) {
                try { setAiChapterWeight(it.chapter, it._aiChapterWeight); } catch (_) {}
            }
            // Keyed on the GEM's provenance stamps so a mixed-chapter paste is
            // audited exactly as the Gem structured it. Key order MUST match
            // _auditGemBatchByChapter's bucket generator, including its trim +
            // toString normalization so untrimmed future callers still match.
            const subjKey = _normalizeSubjectKey(it.gemSubject || it.subject || 'unknown');
            const key = subjKey + '|' + ((it.gemChapter || it.chapter) || '').toString().trim();
            const stat = chapterStats[key];
            if (stat && stat.suspiciousDistribution) it.stampBatchSuspiciousDistribution = true;
            if (stat && stat.suspiciousStdev) it.stampBatchSuspiciousStdev = true;

            // Chapter-ceiling guard now checks the DESTINATION chapter (where the
            // question actually lands), not the Gem's source chapter.
            const priorAvg = _getChapterAvgElo(it.subject, it.chapter);
            if (typeof it.qElo === 'number' && Math.abs(it.qElo - priorAvg) > 600) {
                it.qElo = Math.round(priorAvg + 600 * Math.sign(it.qElo - priorAvg));
                it.tags = (it.tags || []).concat(['over-chapter-ceiling']);
            }
        }

        // Belt-and-suspenders: flag (never block) rows whose math still fails
        // to render after the deterministic repair (KaTeX may not be loaded yet
        // at ingest, in which case mathOk safely no-ops).
        for (const it of parsedItems) {
            if (!mathOk(it.extractedText) || !mathOk(it.solution)) {
                it.latexRepairFailed = true;
                console.warn('[latex-repair] gem segment failed post-repair:', it.extractedText ? it.extractedText.slice(0, 60) : '(no text)');
            }
        }

        if (parsedItems.length === 0) {
            throw new Error("Failed to compile any valid items. Verify structural array fields.");
        }

        AppState.extractedItems = parsedItems;
        // Fresh dump → fresh diagram map (previous session uploads are stale).
        _gemImageSources = {};
        hideLoading();

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

        // ── Gem diagram auto-crop map ──
        // When the dump carries imageRef tags + cropBox coordinates, route to
        // the mapping modal first: the user uploads one image per tagged source
        // screenshot and the baked-in coordinates auto-crop every referenced
        // diagram (no manual bounding-box drawing). Plain dumps skip straight
        // to the preview grid as before.
        const gemTags = _collectGemImageTags(parsedItems);
        if (gemTags.length) {
            (window.__jmaxAppToast || alert)(`🗺 ${parsedItems.length} items compiled — upload the ${gemTags.length} tagged source image${gemTags.length !== 1 ? 's' : ''} to auto-crop diagrams.`);
            openGemImageMappingModal();
        } else {
            (window.__jmaxAppToast || alert)(`✅ ${parsedItems.length} items compiled successfully.`);
            // Pass control flow directly to your interactive validation view
            showPreviewModal();
        }

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
            visualAssetContainerHtml = `<img src="${_safeImgSrc(q.imageDataUrl)}" style="max-width:200px; border-radius:12px;">`;
        } else {
            if (q.diagramImageUrl) {
                const srcTag = (q.gemImage && q.gemImage.tag)
                    ? ` · 📍 from <b>${escapeHtml(q.gemImage.tag)}</b>${q._gemAutoMapped ? ' · auto-crop' : ''}`
                    : '';
                visualAssetContainerHtml = `
                    <div class="surgical-asset-box" style="border: 1px solid var(--glow-orange); padding:8px; border-radius:8px; background:rgba(249,115,22,0.05); flex-shrink:0;">
                        <small style="color: #f97316; font-weight:700;">📐 Diagram Mapped${srcTag}</small><br>
                        <img src="${_safeImgSrc(q.diagramImageUrl)}" style="max-width:140px; border-radius:6px; margin:6px 0;">
                        <button class="btn btn-danger btn-xs" style="display:block; width:100%; padding:2px;" onclick="event.stopPropagation(); window.yeetSurgicalDiagram(${idx})">✕ Wipe Asset</button>
                    </div>`;
            } else if (q.gemImage && q.gemImage.tag) {
                // Tagged source image still waiting for its upload → the 🗺
                // Diagram Map (top of the modal) auto-crops it; manual crop
                // stays available as a fallback.
                visualAssetContainerHtml = `
                    <div class="surgical-asset-trigger" style="text-align:center; padding:10px; border:1px dashed #b45309; border-radius:8px; flex-shrink:0; min-width:140px; background:rgba(249,115,22,0.04);">
                        <span class="gem-ref-chip" style="margin-left:0; display:inline-block; margin-bottom:6px;">📍${escapeHtml(q.gemImage.tag)}</span>
                        <button class="btn btn-secondary btn-sm" style="display:block; width:100%;" onclick="event.stopPropagation(); window.triggerSurgicalDiagramUpload(${idx})">➕ Add Diagram</button>
                        <p style="font-size:10px; color:#fbbf24; margin-top:4px; line-height:1.1;">Auto-crop pending — upload tag <b>${escapeHtml(q.gemImage.tag)}</b> in 🗺 Diagram Map.</p>
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

        // Clean option layout rows — auto-cropped per-option images render
        // under their matching option letter (bound via the 🗺 Diagram Map).
        let optionsPreview = '';
        if (q.options && q.options.length) {
            optionsPreview = `<div style="margin: 6px 0; padding-left: 8px; border-left: 2px solid #3b82f6;">
                ${q.options.map(o => {
                    const optImg = _gemOptionImageUrl(q, o)
                        ? `<div style="margin:2px 0 6px;"><img src="${_safeImgSrc(_gemOptionImageUrl(q, o))}" style="max-width:130px; border-radius:6px; border:1px solid rgba(59,130,246,0.5);"></div>`
                        : '';
                    return `<p style="font-size:13px; color:#93c5fd; margin:2px 0;">${escapeHtml(o)}</p>${optImg}`;
                }).join('')}
            </div>`;
        }
        
        let solutionPreview = q.solution ? `<p style="font-size:12px; color:#6ee7b7; margin-top:4px; font-weight:500;">📝 Solution Context Loaded</p>` : '';
        if (q.solutionImageUrl) {
            solutionPreview += `<div style="margin-top:4px;"><small style="color:#6ee7b7; font-weight:700;">💡 Solution Diagram</small><br><img src="${_safeImgSrc(q.solutionImageUrl)}" style="max-width:140px; border-radius:6px; border:1px solid rgba(110,231,183,0.4);"></div>`;
        }

        // ── Pending auto-crop chips: option/solution refs still waiting for
        // their tagged screenshot upload in the 🗺 Diagram Map. ──
        let pendingAssetHtml = '';
        if (q.gemOptionImages && typeof q.gemOptionImages === 'object') {
            for (const k of Object.keys(q.gemOptionImages)) {
                const ref = q.gemOptionImages[k];
                if (ref && ref.tag && !(q.optionImageUrls && q.optionImageUrls[k])) {
                    pendingAssetHtml += `<span class="gem-ref-chip" style="margin:2px 4px 0 0; display:inline-block;">📄 opt ${escapeHtml(k)} ← <b>${escapeHtml(ref.tag)}</b></span>`;
                }
            }
        }
        if (q.gemSolutionImage && q.gemSolutionImage.tag && !q.solutionImageUrl) {
            pendingAssetHtml += `<span class="gem-ref-chip" style="margin:2px 4px 0 0; display:inline-block;">💡 solution ← <b>${escapeHtml(q.gemSolutionImage.tag)}</b></span>`;
        }
        let hintPreview = q.hint ? `<p style="font-size:12px; color:#fbbf24; margin-top:2px; font-weight:500;">💡 Hint Loaded</p>` : '';
        let answerDisplay = Array.isArray(q.correctAnswer) ? q.correctAnswer.join(', ') : (q.correctAnswer || '');
        
        // ── Gem provenance chip: which tagged source image this question's
        // diagram comes from (auto-crop coordinates baked into the dump). ──
        const gemChip = (q.gemImage && q.gemImage.tag)
            ? `<span class="gem-ref-chip" title="Diagram source tag: ${escapeAttribute(q.gemImage.tag)}${q.gemImage.bbox ? ' · crop coords baked into the dump' : ''}">📍${escapeHtml(q.gemImage.tag)}</span>`
            : '';

        div.innerHTML = `
            <div style="margin-bottom: 6px; display:flex; justify-content:space-between; align-items:center;">
                <strong>Question ${idx + 1}</strong> ${gemChip} ${typeBadge}
            </div>
            <div style="display:flex; gap:16px; align-items:flex-start; justify-content:space-between;">
                <div style="flex:1; min-width:0;">
                    ${processedTextHtml}
                    ${optionsPreview}
                    ${solutionPreview}
                    ${hintPreview}
                    ${pendingAssetHtml ? `<div style="margin-top:6px;">${pendingAssetHtml}</div>` : ''}
                </div>
                ${visualAssetContainerHtml}
            </div>
            <div class="manual-answer-row" style="margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.04);">
                <span style="font-size:12px; color:#a1a1aa;">Verified Target Key:</span>
                <input id="manual-answer-${idx}" class="pomo-input" style="width:160px; margin-left:8px; padding:4px 8px;" placeholder="A/B/C/D or numeric list" value="${escapeHtml(answerDisplay)}">
            </div>`;
            
        container.appendChild(div);
    });

    // ── 🗺 Diagram Map reopen: visible whenever any question in this batch
    // references a tagged source image (lets the user upload/map later, or
    // re-map after wiping an auto-crop). ──
    const anyGemRef = (AppState.extractedItems || []).some(it => it.gemImage && it.gemImage.tag);
    const btnReopen = document.getElementById('btn-reopen-gem-map');
    if (btnReopen) btnReopen.style.display = anyGemRef ? 'inline-block' : 'none';

    // ── No-tag guidance banner ──
    // When the dump carried no imageRef tags at all, the per-tag upload prompt
    // never fires. Surface WHY and what to do (paste the gem instruction block
    // or bind diagrams manually) so it never looks like a dead end.
    const oldBanner = document.getElementById('gem-map-no-tags-banner');
    if (oldBanner) oldBanner.remove();
    if (!anyGemRef) {
        const banner = document.createElement('div');
        banner.id = 'gem-map-no-tags-banner';
        banner.className = 'gem-map-banner';
        banner.innerHTML = `
            <div style="flex:1;min-width:220px;">
                <b>🗺 No tagged images in this dump</b> — so there's no per-image upload prompt here.
                Questions whose diagrams live inside screenshots need <code>imageRef</code> + <code>cropBox</code>
                fields in the dump to be auto-cropped. Paste the instruction block into your Gemini Gem,
                re-generate, and this screen will ask you to upload each tagged image (a1, a2, …).
            </div>
            <button class="btn btn-secondary btn-sm" onclick="window.copyGemImageInstructions()">📋 Copy Gemini instructions</button>
            <span style="font-size:11px;color:var(--text-muted);">…or use <b>➕ Add Diagram</b> on each question below.</span>`;
        container.insertBefore(banner, container.firstChild);
    }

    openModal('preview-modal');
}

// Export module logic to global window context
window.processGemTextDump = processGemTextDump;
window.showPreviewModal = showPreviewModal;

// ── JSON dump file upload: reads the file into the text-track terminal so
// the user can "just upload" a dump instead of copy-pasting. Ingestion then
// runs the REAL-JSON fast path (processGemTextDump Step 0) — the same
// cleanAndParseJson that heals bare-backslash LaTeX corruption. ──
window.loadJsonDumpFile = function (input) {
    const f = input && input.files && input.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
        const ta = document.getElementById('text-add-terminal');
        if (ta) ta.value = r.result;
        // Zero extra steps: kick off ingestion right after the file loads.
        try { processGemTextDump(); } catch (e) { console.error('loadJsonDumpFile → processGemTextDump:', e); }
    };
    r.onerror = () => alert('Could not read that file. Make sure it is a plain .json / .txt file.');
    r.readAsText(f);
};

// ==================== GEM DIAGRAM AUTO-CROP MAP (UI) ====================
// The instruction block users paste into Gemini so future dumps carry
// imageRef + cropBox coordinates. Also shown (copyable) inside the map modal.
const GEM_MAP_INSTRUCTION_BLOCK = `CROP MAPPING — attach these to the question object you emit. When a question's figure(s) live inside one of the source screenshots I upload:

TWO-PHASE WORKFLOW (mandatory — map FIRST, then emit):
PHASE 1 — DIAGRAM MAP PASS: before writing ANY question JSON, scan EVERY uploaded
screenshot and list every figure with its tag, normalized box and location — scratch
work only, NEVER include it in the output. Every figure appears exactly once. Use the
accuracy rules below; if you cannot pin a figure's exact edges, crop its WHOLE question
block instead of guessing a tight box. Re-check each box against the screenshot.
PHASE 2 — EMIT: copy imageRef/cropBox/optionImages/solutionImage values VERBATIM from
the map. Never re-estimate coordinates while generating.

Then use EXACTLY ONE of these cases per question:
CASE 1 — NO figure anywhere: omit imageRef / cropBox / optionImages entirely.
CASE 2 — EXACTLY ONE figure: crop just that figure.
   - figure in the STEM      -> "imageRef": "a1", "cropBox": {...}
   - figure inside ONE option -> "optionImages": {"B": {"imageRef": "a1", "cropBox": {...}}}
   - figure in the SOLUTION  -> "solutionImage": {"imageRef": "a2", "cropBox": {...}}
   (A stem figure + a solution figure can both appear: imageRef/cropBox + solutionImage.)
CASE 3 — TWO OR MORE figures (in the stem, across options, or both): crop the WHOLE question.
   Emit ONE "imageRef" + "cropBox" whose box covers the ENTIRE question block — stem text,
   all options and every figure, exactly as printed. Do NOT emit optionImages here; the
   whole-question box IS the image. Also the default whenever you are unsure of a figure's
   exact bounds. If the screenshot stacks several questions, keep the box tight to THIS
   question — never spill into the neighbour.

Tagging:
- Label the uploaded screenshots a1, a2, a3, ... (or s1, s2, ...) in upload order and use EXACTLY those labels as imageRef — I will re-upload the same screenshots under the same tags in JEEMaxxing.
- One question gets at most ONE imageRef/cropBox pair; many questions may share a tag with different cropBox values.

Coordinates (the app crops EXACTLY this region — be precise):
- x/y = TOP-LEFT corner as FRACTIONS of the FULL ORIGINAL screenshot (0.0 to 1.0); w/h = width/height as fractions. Not the centre, not the preview's scale.
- ANCHOR FIRST: locate each figure relative to visible landmarks (stem text above/below, option lines, page edges, other figures), THEN convert that layout to fractions.
- Sanity-check with a mental 4x4 grid (cells 0.25 apart), then refine each edge to 2 decimals.
- Round every edge OUTWARD (x/y down, w/h up) by ~2-3% so the crop never clips a border, arrow tip or label.
- Keep x+w <= 1 and y+h <= 1. If unsure of any edge, ENLARGE the box — a generous crop is usable, an amputated figure is not.
- Case 3 whole-question box example: {"x":0.02,"y":0.02,"w":0.96,"h":0.55}; full-page figure: {"x":0,"y":0,"w":1,"h":1}.
- imageRef/cropBox are plain strings and numbers — no LaTeX escaping applies to them.`;

function _gemIdKey(key) {
    return String(key).replace(/[^a-z0-9_-]/gi, '_');
}

/**
 * Open the 🗺 Gem Diagram Map modal. Counts the distinct tagged source images
 * the batch references ("how many are there"), renders one upload tile per
 * tag, and previews the crop regions as overlays once an image is picked.
 */
function openGemImageMappingModal() {
    const items = AppState.extractedItems || [];
    const tags = _collectGemImageTags(items);
    const body = document.getElementById('gem-image-map-body');
    const intro = document.getElementById('gem-map-intro');
    if (!body) return;

    if (!tags.length) {
        showPreviewModal();
        return;
    }

    if (intro) {
        intro.innerHTML =
            `The dump references <b>${tags.length}</b> tagged source image${tags.length !== 1 ? 's' : ''}: ` +
            `<b>${escapeHtml(tags.join(', '))}</b>. Upload each tagged image below — the coordinates baked ` +
            `into the dump auto-crop every diagram, option image and solution image. No manual cropping.`;
    }

    // tag (normalized) -> { indices, kinds }
    const tagInfo = new Map();
    items.forEach((it, idx) => {
        for (const entry of _gemTagEntries(it)) {
            const key = _normGemTag(entry.tag);
            if (!tagInfo.has(key)) tagInfo.set(key, { indices: [], kinds: new Set() });
            const info = tagInfo.get(key);
            if (!info.indices.includes(idx)) info.indices.push(idx);
            info.kinds.add(entry.kind);
        }
    });

    body.innerHTML = '';
    tags.forEach(tag => {
        const key = _normGemTag(tag);
        const idKey = _gemIdKey(key);
        const info = tagInfo.get(key) || { indices: [], kinds: new Set() };
        const idxs = info.indices;
        const qLabels = idxs.map(i => '#' + (i + 1)).join(', ');
        const kindLabel = ['diagram', 'option', 'solution']
            .filter(k => info.kinds.has(k))
            .map(k => k === 'option' ? 'option images' : k + 's')
            .join(' + ');

        const row = document.createElement('div');
        row.className = 'gem-map-row';
        row.innerHTML = `
            <div class="gem-map-tagchip" title="Crops referencing this image: ${escapeAttribute(qLabels)}">${escapeHtml(tag)}</div>
            <div class="gem-map-upload">
                <label class="file-upload-label compact-upload" for="gem-img-${idKey}" style="margin:0;">
                    <span class="file-icon">🖼️</span>
                    <span class="file-text">Upload image tagged <b>${escapeHtml(tag)}</b></span>
                </label>
                <input type="file" id="gem-img-${idKey}" accept="image/*" style="display:none">
                <span class="file-selected-text" id="gem-img-name-${idKey}">No file yet — ${idxs.length} question${idxs.length !== 1 ? 's' : ''} reference${idxs.length !== 1 ? '' : 's'} this image (${escapeHtml(kindLabel)})</span>
            </div>
            <div class="gem-map-preview" id="gem-map-preview-${idKey}" style="display:none">
                <canvas id="gem-map-canvas-${idKey}" class="gem-map-preview-canvas"></canvas>
                <small class="gem-map-preview-caption">Boxes = every crop region · <b>Q#</b> diagram · <b>·A</b> option · <b>·SOL</b> solution.</small>
            </div>`;
        body.appendChild(row);

        const input = row.querySelector('input[type=file]');
        input.addEventListener('change', (e) => handleGemImageFileSelect(tag, e.target));

        // Reopened map: re-surface an upload that is still in the session store
        // (so the user sees what's already locked instead of a blank tile).
        if (_gemImageSources[key]) {
            const nameEl = row.querySelector('.file-selected-text');
            if (nameEl) {
                nameEl.textContent = '✔ Locked (kept in session)';
                nameEl.style.color = 'var(--glow-green)';
            }
            _drawGemBboxOverlay(tag);
        }
    });

    // ── Modal-stacking fix: #gem-image-map-modal sits EARLIER in the DOM than
    // #preview-modal, so with equal .modal-overlay z-index the preview would
    // paint OVER the freshly opened map (the reopen button lives inside the
    // preview). Dismiss the preview synchronously first — the map always hands
    // back to showPreviewModal() anyway (mirrors triggerSurgicalDiagramUpload).
    forceHideModal('preview-modal');

    const instEl = document.getElementById('gem-map-instruction-text');
    if (instEl) instEl.textContent = GEM_MAP_INSTRUCTION_BLOCK;

    const status = document.getElementById('gem-image-map-status');
    if (status) {
        status.textContent = '';
        status.className = 'gem-map-status';
    }

    openModal('gem-image-map-modal');
}

/**
 * File-picker change handler per tag: stores the base64 source image and
 * draws the crop-region overlay so the user can verify the coordinates.
 */
async function handleGemImageFileSelect(tag, input) {
    const file = input && input.files && input.files[0];
    if (!file) return;
    const key = _normGemTag(tag);
    const idKey = _gemIdKey(key);
    try {
        const b64 = await readFileAsBase64(file);
        _gemImageSources[key] = b64;
        const nameEl = document.getElementById('gem-img-name-' + idKey);
        if (nameEl) {
            nameEl.textContent = '✔ Locked: ' + file.name;
            nameEl.style.color = 'var(--glow-green)';
        }
        _drawGemBboxOverlay(tag);
    } catch (e) {
        console.error('[gem-map] failed to read image for tag ' + tag + ':', e);
    }
}

/**
 * Render the uploaded source image on a canvas and overlay every crop region
 * the dump references for this tag, labelled with the question numbers.
 */
function _drawGemBboxOverlay(tag) {
    const key = _normGemTag(tag);
    const idKey = _gemIdKey(key);
    const src = _gemImageSources[key];
    const canvas = document.getElementById('gem-map-canvas-' + idKey);
    const preview = document.getElementById('gem-map-preview-' + idKey);
    if (!canvas || !src) return;

    const img = new Image();
    img.onload = () => {
        const MAX_W = 340;
        const MAX_H = 480;   // cap the canvas height too — tall screenshots
        const scale = Math.min(1, MAX_W / img.width, MAX_H / img.height);
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const items = AppState.extractedItems || [];
        const KIND_COLORS = { diagram: '#22d3ee', option: '#facc15', solution: '#e879f9' };
        items.forEach((it, idx) => {
            for (const entry of _gemTagEntries(it)) {
                if (_normGemTag(entry.tag) !== key) continue;
                const nb = _resolveGemBbox(entry.bbox, img.width, img.height);
                if (!nb) continue;
                const color = KIND_COLORS[entry.kind] || '#22d3ee';
                const rx = nb.x * canvas.width, ry = nb.y * canvas.height;
                const rw = nb.w * canvas.width, rh = nb.h * canvas.height;
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.strokeRect(rx, ry, rw, rh);
                ctx.fillStyle = color;
                ctx.font = 'bold 11px sans-serif';
                const label = '#' + (idx + 1) + (entry.kind === 'option' ? '·' + entry.opt : entry.kind === 'solution' ? '·SOL' : '');
                ctx.fillText(label, rx + 3, ry + 14);
            }
        });
        if (preview) preview.style.display = 'block';
    };
    img.onerror = () => { /* corrupt source — leave the tile empty */ };
    img.src = src;
}

/**
 * The "enter" step: crop every referenced diagram from its uploaded tagged
 * image using the dump's coordinates, bind each crop to diagramImageUrl, then
 * hand off to the preview grid. Any tag without an upload (or any failed
 * crop) is reported inline and falls back to the manual ➕ Add Diagram flow.
 */
async function applyGemImageCrops() {
    const items = AppState.extractedItems || [];
    // Every (item, tagged-image-ref) pair is a crop job — diagrams, per-option
    // images and the solution image all flow through the same map.
    const jobs = [];
    items.forEach((it) => { for (const entry of _gemTagEntries(it)) jobs.push({ it, entry }); });
    const status = document.getElementById('gem-image-map-status');
    if (!jobs.length) {
        skipGemImageMapping();
        return;
    }

    showLoading('Auto-cropping diagrams, option images and solution images from tagged screenshots...');
    const dimsCache = {};
    const counts = { diagram: 0, option: 0, solution: 0 };
    const totals = { diagram: 0, option: 0, solution: 0 };
    let failed = 0;
    const missingTags = [];
    const assignCrop = (it, entry, crop) => {
        if (entry.kind === 'diagram') {
            it.diagramImageUrl = crop;
            it._gemAutoMapped = true;
        } else if (entry.kind === 'option') {
            it.optionImageUrls = it.optionImageUrls || {};
            it.optionImageUrls[entry.opt] = crop;
        } else {
            it.solutionImageUrl = crop;
        }
    };
    try {
        for (const { it, entry } of jobs) {
            totals[entry.kind]++;
            const key = _normGemTag(entry.tag);
            const src = _gemImageSources[key];
            if (!src) {
                if (!missingTags.includes(entry.tag)) missingTags.push(entry.tag);
                continue;
            }
            if (!dimsCache[key]) {
                dimsCache[key] = await new Promise(res => {
                    const img = new Image();
                    img.onload = () => res({ w: img.width, h: img.height });
                    img.onerror = () => res(null);
                    img.src = src;
                });
            }
            const dims = dimsCache[key];
            if (!dims) { failed++; continue; }
            const nb = _resolveGemBbox(entry.bbox, dims.w, dims.h);
            if (!nb) { failed++; continue; }
            const crop = await cropImageFromBBox(src, nb);
            if (crop) {
                assignCrop(it, entry, crop);
                counts[entry.kind]++;
            } else {
                failed++;
            }
        }
    } catch (e) {
        console.error('[gem-map] applyGemImageCrops failed:', e);
        failed = jobs.length - (counts.diagram + counts.option + counts.solution);
    } finally {
        hideLoading();
    }

    const parts = [
        `✓ Auto-mapped ${counts.diagram}/${totals.diagram} diagram${totals.diagram !== 1 ? 's' : ''}`,
        `${counts.option}/${totals.option} option image${totals.option !== 1 ? 's' : ''}`,
        `${counts.solution}/${totals.solution} solution image${totals.solution !== 1 ? 's' : ''}.`,
    ];
    if (missingTags.length) parts.push(`Missing upload${missingTags.length !== 1 ? 's' : ''}: ${missingTags.join(', ')}.`);
    if (failed) parts.push(`${failed} crop${failed !== 1 ? 's' : ''} failed — use ➕ Add Diagram / manual binds for those.`);
    if (status) {
        status.textContent = parts.join(' ');
        status.className = 'gem-map-status ' + (missingTags.length || failed ? 'gem-map-status-warn' : 'gem-map-status-ok');
    }
    setTimeout(() => {
        forceHideModal('gem-image-map-modal');
        showPreviewModal();
    }, 1100);
}

function skipGemImageMapping() {
    forceHideModal('gem-image-map-modal');
    showPreviewModal();
}

function copyGemImageInstructions() {
    const el = document.getElementById('gem-map-instruction-text');
    const text = el ? el.textContent : GEM_MAP_INSTRUCTION_BLOCK;
    const done = () => {
        const btn = document.getElementById('btn-copy-gem-instr');
        if (btn) {
            const old = btn.textContent;
            btn.textContent = '✔ Copied!';
            setTimeout(() => { btn.textContent = old; }, 1500);
        }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => {});
    } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (_) {}
        ta.remove();
        done();
    }
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

    const selectedChapters = Array.isArray(AppState.currentChapterSelection) && AppState.currentChapterSelection.length
        ? AppState.currentChapterSelection : [AppState.currentChapter];
    let chapterQuestions = AppState.questionBank.filter(q => q.subject === AppState.currentSubject && selectedChapters.some(ch => _chaptersMatch(q.chapter, ch)));
    if (!chapterQuestions.length) {
        // ── Empty chapter: MUST wipe the previous chapter's content ──
        // The old early-return left the last rendered chapter's cards + stats
        // in the DOM, so every empty chapter showed the previous chapter's
        // questions ("questions of that chapter in all chapters I open").
        AppState.currentChapterQuestions = [];
        const grid = document.getElementById('questions-grid-container');
        if (grid) grid.innerHTML = '';
        const statsRow = document.getElementById('stats-row');
        if (statsRow) statsRow.style.display = 'none';
        const titleEl = document.getElementById('question-list-title');
        if (titleEl) titleEl.textContent = `${AppState.currentChapter || 'Chapter'} · Empty`;
        const container = document.getElementById('questions-grid-container');
        if (container) {
            const empty = document.createElement('div');
            empty.className = 'questions-grid-empty';
            empty.innerHTML = `<div class="qge-icon">🗂</div><div class="qge-title">No questions in this chapter yet</div><div class="qge-sub">Tap <strong>📸 Feed</strong> to paste or upload questions into <strong>${escapeHtml(AppState.currentChapter || 'this chapter')}</strong>.</div>`;
            container.appendChild(empty);
        }
        showPracticeSubview('practice-question-list-view');
        return;
    }

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
        const chLabel = AppState.currentChapter ? `${AppState.currentChapter} · ` : '';
        if (AppState.currentFilter === 'all') titleEl.textContent = chLabel + 'All Questions';
        else if (AppState.currentFilter === 'unsolved') titleEl.textContent = chLabel + 'Untouched';
        else if (AppState.currentFilter === 'solved') titleEl.textContent = chLabel + 'Clutched';
        else if (AppState.currentFilter === 'wrong') titleEl.textContent = chLabel + 'Fumbled';
    }

    const filterEl = document.getElementById('question-filter');
    if (filterEl) {
        filterEl.value = AppState.currentFilter;
        // Locked while a pomodoro / stopwatch session is live.
        filterEl.disabled = !!(window.__pomodoro && window.__pomodoro.isRunning());
    }

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
// Always render a lightweight placeholder; initPracticeLazyLoaders() swaps
// in the real image (in-memory bank or Drive) only when the card nears the
// viewport — keeps the DOM free of hundreds of embedded base64 blobs.
if ((q.imageDataUrl && q.imageDataUrl.length > 100) || q.driveImageId) {
    imgHtml = `<img data-drive-id="${q.driveImageId || ''}" data-qid="${q.id}" class="lazy-practice-img" decoding="async" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='90'><rect width='100%' height='100%' fill='%2312121a'/><text x='50%' y='50%' fill='%23444a6a' font-family='sans-serif' font-size='11' text-anchor='middle' alignment-baseline='middle'>Loading…</text></svg>" style="max-width:100%; border-radius:8px;">`;
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

    // ── Filtered-empty state: chapter has questions but the active filter
    // (Untouched / Clutched / Fumbled) matches none — show a hint instead of
    // a silently blank grid. ──
    if (filteredQuestions.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'questions-grid-empty';
        empty.innerHTML = `<div class="qge-icon">🔍</div><div class="qge-title">No ${AppState.currentFilter} questions here</div><div class="qge-sub">Change the filter above or grind through the rest of the chapter.</div>`;
        container.appendChild(empty);
    }

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

// Tiny SVG used both as the initial placeholder AND as the "unloaded" state
// for cards that have scrolled out of the viewport (frees the decoded bitmap).
const LAZY_IMG_PLACEHOLDER = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='90'><rect width='100%' height='100%' fill='%2312121a'/><text x='50%' y='50%' fill='%23444a6a' font-family='sans-serif' font-size='11' text-anchor='middle' alignment-baseline='middle'>Loading…</text></svg>";

let _practiceImgObserver = null;
let _practicePrefetching = false;
let _practiceSweepPending = false;

export function initPracticeLazyLoaders() {
    // Recreate a fresh observer per render (releases detached cards from the
    // previous list — no observer leak across innerHTML wipes).
    if (_practiceImgObserver) _practiceImgObserver.disconnect();
    _practiceImgObserver = new IntersectionObserver((entries) => {
        entries.forEach(async entry => {
            const img = entry.target;
            const qId = img.getAttribute('data-qid');
            const driveId = img.getAttribute('data-drive-id');

            // Loading only — unloading happens in the far-away sweep below,
            // so scroll-back never re-decodes images that are still nearby.
            if (!entry.isIntersecting || img.dataset.loaded === '1') return;
            // Token guard: if the card is unloaded (or re-rendered) while
            // a slow Drive fetch is in flight, the token changes → bail,
            // so we never resurrect an off-screen image with a base64 blob.
            const token = (img._lazyToken = (img._lazyToken || 0) + 1);
            // 1) Serve from the in-memory bank first (instant, offline-safe).
            let base64 = null;
            const q = AppState.questionBank.find(x => String(x.id) === String(qId));
            if (q && q.imageDataUrl && q.imageDataUrl.length > 100) base64 = q.imageDataUrl;
            // 2) Fall back to Drive only when no local copy exists.
            if (!base64 && driveId && typeof AppState.driveAccessToken !== 'undefined') {
                try { base64 = await fetchMediaFromDrive(driveId, AppState.driveAccessToken); }
                catch (e) { console.error("Practice grid scroll load failed", e); }
            }
            if (!base64 || img._lazyToken !== token || !img.isConnected) return;
            img.src = base64;
            img.dataset.loaded = '1';
            if (q && !q.imageDataUrl) q.imageDataUrl = base64;
        });
    }, { rootMargin: '600px 0px 1200px 0px' });   // far above/below the fold → images are decoded before you scroll there

    document.querySelectorAll('.lazy-practice-img').forEach(img => _practiceImgObserver.observe(img));

    const grid = document.getElementById('questions-grid-container');
    if (grid && !grid._practiceSweepBound) {
        grid._practiceSweepBound = true;
        grid.addEventListener('scroll', schedulePracticeFreeSweep, { passive: true });
    }

    // Kick off a background prefetch of Drive-hosted images so scrolling is
    // served from the in-memory bank instead of a Drive round-trip per card.
    prefetchPracticeDriveImages();
}

// Free decoded bitmaps only once a card is thousands of pixels off-screen.
// Off-screen cards already cost nothing to paint (content-visibility), and
// the old "free at 600px" behaviour caused decode churn whenever the user
// scrolled back and forth — the main source of scroll lag.
function schedulePracticeFreeSweep() {
    if (_practiceSweepPending) return;
    _practiceSweepPending = true;
    requestAnimationFrame(() => {
        _practiceSweepPending = false;
        const vh = window.innerHeight;
        document.querySelectorAll('.lazy-practice-img[data-loaded="1"]').forEach(img => {
            const r = img.getBoundingClientRect();
            if (r.bottom < -2000 || r.top > vh + 2000) {
                img._lazyToken = (img._lazyToken || 0) + 1;
                img.dataset.loaded = '';
                img.src = LAZY_IMG_PLACEHOLDER;
            }
        });
    });
}

// Eagerly download every Drive-only image (bounded concurrency) and cache it
// onto the question in memory — the lazy loader then swaps it in instantly.
function prefetchPracticeDriveImages() {
    if (_practicePrefetching) return;
    const pending = AppState.questionBank.filter(q =>
        q.driveImageId && !(q.imageDataUrl && q.imageDataUrl.length > 100)
    );
    if (!pending.length) return;
    const token = (typeof AppState.driveAccessToken !== 'undefined') ? AppState.driveAccessToken : null;
    const doPrefetch = (tok) => {
        if (!tok) return;
        _practicePrefetching = true;
        const CONCURRENCY = 4;
        let i = 0;
        const next = () => {
            if (i >= pending.length) { _practicePrefetching = false; return; }
            const q = pending[i++];
            fetchMediaFromDrive(q.driveImageId, tok)
                .then(b64 => {
                    if (b64 && !(q.imageDataUrl && q.imageDataUrl.length > 100)) q.imageDataUrl = b64;
                })
                .catch(() => {})
                .finally(next);
        };
        for (let c = 0; c < CONCURRENCY; c++) next();
    };
    if (token) {
        doPrefetch(token);
    } else if (typeof waitForDriveToken === 'function') {
        // Callback-style API (returns undefined) — the promise chain here never
        // ran doPrefetch; hand it the callback it expects.
        try { waitForDriveToken(() => doPrefetch(AppState.driveAccessToken)); } catch (e) {}
    }
}

export function applyFilter() {
    const filterEl = document.getElementById('question-filter');
    // Refuse filter changes while a pomodoro / stopwatch session is live —
    // the dropdown itself is disabled, but this also blocks programmatic
    // changes racing the render.
    if (filterEl && window.__pomodoro && window.__pomodoro.isRunning()) {
        filterEl.value = AppState.currentFilter;
        return;
    }
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
    // ── Same anti-mangle guard as saveAllQuestions: only a bare letter list
    //    ("A, C") is a multi-select MCQ answer. Multi-part free-text answers
    //    like "(a) ..., (b)(i) ..." contain LaTeX + commas and must NEVER be
    //    split or uppercased, and an option-less question can never be mcq. ──
    const isLetterList = typeof ans === 'string' && /^[A-Da-d](?:\s*,\s*[A-Da-d])*$/.test(ans);
    if (isLetterList && q.options.length > 0) {
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
    // Standard list entry — a mode left armed (e.g. ✕-closed mid-run) must not
    // leak its footer/nav state into this session.
    AppState.practiceFlowMode = 'standard';
    _modeAdaptive.targetPwin = null;
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
    _renderModeFooter();
    openModal('practice-modal');
    AppState.photoHidden = false;
    document.getElementById('hide-photo-toggle').textContent = '📷 Hide Image';
}

// ==================== BOUNTY HUNT ====================
export function getHistoricalBountyTimeLimit(q) {
    return 180;
}

/**
 * Rail/boot visibility for the Daily Bounty entry point. The assignment ran at
 * boot but NOTHING ever opened the modal (dead wiring — audit CRITICAL), so
 * the daily bounty silently never started. The rail button is the reachable
 * trigger; it shows only while a bounty is live.
 */
export function refreshBountyRail() {
    const btn = document.getElementById('bounty-rail-btn');
    if (!btn) return;
    const pending = !AppState.bounty.done && AppState.bounty.active && !!AppState.bounty.questionId;
    btn.style.display = pending ? 'inline-block' : 'none';
}

/** User-facing opener — explains itself when nothing is live instead of dying quietly. */
export function openDailyBounty() {
    if (AppState.bounty.done || !AppState.bounty.active || !AppState.bounty.questionId) {
        alert('No live bounty right now.\n\nMiss a marked-wrong review and tomorrow\'s Bounty Boss picks itself.');
        return;
    }
    openBountyModal(AppState.bounty.questionId);
}

export function openBountyModal(questionId) {
    const q = AppState.questionBank.find(item => item.id != null && String(item.id) === String(questionId));
    if (!q) return;
    const today = todayLocalKey();
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
    const today = todayLocalKey();
    if (AppState.bounty.date === today && AppState.bounty.questionId && AppState.bounty.questionId.toString() === questionId.toString()) return;

    const candidates = AppState.questionBank.filter(q =>
        (q.status === 'error' || q.status === 'wrong') &&
        q.timeTaken > 0 &&
        (!q.bountyLockUntil || new Date(q.bountyLockUntil).getTime() <= Date.now())
    );
    const q = questionId
        ? candidates.find(item => item.id != null && String(item.id) === String(questionId))
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
    const today = todayLocalKey();

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
    if (AppState.practiceTimer) { clearInterval(AppState.practiceTimer); AppState.practiceTimer = null; }

    if (wasCorrect) {
        window._justWonBounty = true;
        // Lock first-attempt result — only the first attempt counts for accuracy.
        if (!q.firstAttemptResult) q.firstAttemptResult = 'correct';
        q.status = 'solved';
        _directiveMarkSolve(q, true);
        changeCount(q.subject, 1);
        AppState.bounty.payoffCount = 3;
        AppState.practiceCorrectStreak = Math.max(AppState.practiceCorrectStreak, 5);
        updateStreakVisualizer();
        (window.__jmaxAppToast || alert)('🔥 CLUTCHED! Bounty demolished — tripled payoff active.');
    } else {
        q.bountyLockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        q.criticalDeficit = true;

        // Directive-era bounty tax: the failing subject's contract +25% for
        // today (replaces the old baseTargets +=5 / re-lock behaviour).
        try { Directive.applyBountyTax(q.subject); } catch (_) {}
        updateUI();

        (window.__jmaxAppToast || alert)('❌ COOKED. Bounty timed out — problem locked out 24h, contract amplified as a tax on failure.');
    }

    AppState.bounty.done = true;
    AppState.bounty.active = false;
    saveAllAsync().catch(console.error);
    try { refreshBountyRail(); } catch (_) {}
    renderErrorMatrixFromBank();
    closePracticeModal();
}

export function startBountySessionFromModal() {
    const qId = window._pendingBountyId || AppState.bounty.questionId;
    if (!qId) return;

    const q = AppState.questionBank.find(item => item.id != null && String(item.id) === String(qId));
    if (!q) return;

    const today = todayLocalKey();
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
        '📷 Reveal' : '📷 Hide';
    renderPracticeQuestionModal();
}

// ── Answer display for reveal banners ──────────────────────────────────────
// Answers come out of extraction as plain text, $...$-delimited LaTeX, or raw
// delimiter-less LaTeX (e.g. "\frac{1}{2}"). This helper escapes for safe
// innerHTML and auto-wraps bare LaTeX so the global KaTeX watchdog hydrates it.
export function answerMathHTML(raw) {
    if (raw == null) raw = '';
    let s = String(Array.isArray(raw) ? raw.join(', ') : raw);
    // JSON extraction can leave doubled backslashes ("\\frac") in stored answers;
    // collapse runs to a single backslash so KaTeX sees valid LaTeX instead of
    // parsing "\\" as a line-break and rendering "frac" character-by-character.
    s = s.replace(/\\+n/g, '\n').replace(/\\\\(?=[a-zA-Z{])/g, '\\');
    const esc = escapeHtml(s);
    if (/\$|\\\(|\\\[/.test(s)) return esc;                       // delimited — watchdog hydrates as-is
    if (/\\[a-zA-Z]{2,}/.test(s) || /[\^_][{}0-9a-zA-Z]/.test(s)) return '$' + esc + '$'; // bare LaTeX — wrap
    return esc;                                                   // plain text
}

/**
 * Pre-reveal confidence capture for the standard practice modal (Calibration
 * layer). Selection is stored on window._pendingSolveConfidence and consumed
 * synchronously by calculateEloMigration at submit; cleared on close/advance
 * so it can never leak into an unrelated solve. Pre-reveal timing measures
 * FORESIGHT — the metacognitive signal that actually predicts top-100 ranks.
 */
function _renderPracticeConfidenceSeg() {
    const levels = [
        { key: 'sure', label: '😎 Sure' },
        { key: 'likely', label: '🤔 Likely' },
        { key: 'guess', label: '🎲 Guess' },
    ];
    const cur = window._pendingSolveConfidence || null;
    const btns = levels.map(l =>
        '<button type="button" class="pconf-btn' + (cur === l.key ? ' selected' : '') + '" data-conf="' + l.key + '"' +
        " onclick=\"window.setSolveConfidence('" + l.key + "')\">" + l.label + '</button>'
    ).join('');
    return '<div class="pconf-seg" id="practice-conf-seg">' +
        '<span class="pconf-label">Confidence?</span>' + btns + '</div>';
}

window.setSolveConfidence = function (level) {
    window._pendingSolveConfidence = level;
    const seg = document.getElementById('practice-conf-seg');
    if (seg) {
        seg.querySelectorAll('.pconf-btn').forEach(b => {
            b.classList.toggle('selected', b.getAttribute('data-conf') === level);
        });
    }
};

export function renderPracticeQuestionModal() {
    AppState.currentQ = AppState.practiceQuestions[AppState.currentPracticeIndex];
    // ── Empty-queue guard ──
    // Mode exit / refill-failure paths clear the queue before this runs;
    // without the guard, reading `.imageDataUrl` off undefined throws and the
    // rest of the teardown sequence dies with it.
    if (!AppState.currentQ) return;
    AppState.selectedMcq = null;
    const submitted = AppState.practiceSubmittedFlags[AppState.currentPracticeIndex];
    const container = document.getElementById('practice-modal-content');
    if (!container) return;
    container.scrollTop = 0;
    let questionImageHtml = '';
    if (!AppState.photoHidden) {
        if (AppState.currentQ.imageDataUrl) {
            questionImageHtml = `<img id="practice-modal-img" src="${_safeImgSrc(AppState.currentQ.imageDataUrl)}" onclick="openPracticeImageLightbox(this.src)" style="max-width:100%; max-height:360px; border-radius:16px; margin-bottom:16px; transition: opacity 0.3s; cursor: pointer;">`;
        } else if (AppState.currentQ.driveImageId && typeof AppState.driveAccessToken !== 'undefined' && AppState.driveAccessToken) {
            questionImageHtml = `<img id="practice-modal-img" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='90'><rect width='100%' height='100%' fill='%2312121a'/><text x='50%' y='50%' fill='%23444a6a' font-family='sans-serif' font-size='11' text-anchor='middle' alignment-baseline='middle'>Loading asset...</text></svg>" onclick="openPracticeImageLightbox(this.src)" style="max-width:100%; max-height:360px; border-radius:16px; margin-bottom:16px; cursor: pointer;">`;
            // Capture the question this fetch belongs to — the user can hit
            // Next/skip before it resolves, and the old code then attached the
            // image to the NEW current question (and persisted the mixup).
            const _imgQ = AppState.currentQ;
            fetchMediaFromDrive(_imgQ.driveImageId, AppState.driveAccessToken).then(b64 => {
                if (!b64) return;
                if (AppState.currentQ !== _imgQ) return;   // navigated away — drop the stale fetch
                if (!_imgQ.imageDataUrl) _imgQ.imageDataUrl = b64;
                let modalImg = document.getElementById('practice-modal-img');
                if (modalImg && AppState.currentQ === _imgQ) modalImg.src = b64;
            });
        }
    }
    let diagramHtml = AppState.currentQ.diagramImageUrl ?
        `<div><div class="diagram-hint">📐 Diagram:</div><img src="${_safeImgSrc(AppState.currentQ.diagramImageUrl)}" style="max-width:100%; max-height:300px; border-radius:12px;"></div>` :
        '';
    let html =
        `<div style="text-align:center;">${questionImageHtml}${diagramHtml}`;
    if (AppState.currentQ.extractedText) html +=
        `<div class="latex" id="latex-render">${escapeHtml(AppState.currentQ.extractedText)}</div>`;

    if (submitted) {
        const correctAns = answerMathHTML(AppState.currentQ.correctAnswer || 'N/A');
        html += `<div style="display:flex; justify-content:space-between; align-items:center;">`;
        if (AppState.currentQ.status === 'solved') html +=
            `<div class="result-banner correct" style="flex:1;">✅ Clutched! The answer was: ${correctAns}</div>`;
        else if (AppState.currentQ.status === 'wrong' || AppState.currentQ.status === 'error') html +=
            `<div class="result-banner wrong" style="flex:1;">❌ Fumbled. The answer was: ${correctAns}</div>`;
        else html +=
            `<div class="result-banner" style="flex:1; background: rgba(61,220,255,0.10); color: #a5ecff; border: 1px solid rgba(61,220,255,0.30);">🔍 Answer revealed. It was: ${correctAns} — were you right?</div>`;
        if (AppState.currentQ.solution && AppState.currentQ.solution.trim().length > 0) {
            html +=
                `<button class="btn show-solution-btn" style="margin-left:12px;" onclick="showSolutionPopup()">💡 Peep Solution</button>`;
        }
        html += `</div></div>`;
        container.innerHTML = html;
        // Hydrate LaTeX synchronously (the observer is a backup). Clear any
        // stale render stamp so a re-render is never skipped.
        container.removeAttribute('data-math-rendered');
        processElementMath(container);
        container.querySelectorAll('.mcq-option').forEach(div => {
            div.addEventListener('click', function (e) {
                // dataset.option is already entity-decoded by the parser —
                // use it verbatim (a DOMParser re-parse would swallow any
                // "<" in the option text as a phantom tag).
                toggleMcqOption(e.currentTarget, e.currentTarget.dataset.option);
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
            const optImg = _gemOptionImageUrl(AppState.currentQ, opt)
                ? `<img src="${_safeImgSrc(_gemOptionImageUrl(AppState.currentQ, opt))}" alt="Option figure" style="display:block; max-width:140px; max-height:140px; border-radius:8px; margin:8px auto 0; border:1px solid rgba(59,130,246,0.5);">`
                : '';
            html += `<div class="mcq-option ${isMulti ? 'multi-option' : ''}"
                          data-option="${escapeAttribute(opt)}">
                    ${escapeHtml(opt)}
                    ${optImg}
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
    html += _renderPracticeConfidenceSeg();
    html += `</div>`;
    container.innerHTML = html;
    container.removeAttribute('data-math-rendered');
    processElementMath(container);
    container.querySelectorAll('.mcq-option').forEach(el => {
        el.addEventListener('click', function (e) {
            const optionText = decodeOption(this.getAttribute('data-option'));
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

// Returns a data-option value verbatim. getAttribute()/dataset ALREADY
// entity-decode the value at parse time (escapeAttribute's single encode is
// inverted by the parser's single decode = the original option text). The
// previous DOMParser step decoded TWICE: it re-parsed the restored "<" / ">"
// characters as live markup, so any option containing "<" (e.g. "A) $a<b$")
// was truncated to "A) $a" and became unselectable ("That's not a valid
// pick"), and literal "&lt;"-style text was corrupted into "<".
function decodeOption(raw) {
    return raw;
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
        q.subject === safeSubject && _chaptersMatch(q.chapter, chapter) &&
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
        q.subject === safeSubject && _chaptersMatch(q.chapter, chapter) && !q.isAnomaly
    );
    if (qs.length === 0) return 1200;
    const sum = qs.reduce((acc, q) => acc + _safeQElo(q), 0);
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
        q.subject === safeSubject && _chaptersMatch(q.chapter, chapter) &&
        q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong')
    );
    if (qs.length === 0) return 50; // neutral default for UI consistency

    // DELEGATED to the Memory Kernel v2 — power-law retrievability with real
    // per-item stability (unbounded growth), replacing the legacy model that
    // treated easeFactor (clamped ≤3.0) as a half-life in days. matrix.js's
    // grid mirror delegates to the SAME kernel, so the visual, monitoring and
    // scoring layers can no longer drift apart.
    try {
        const stats = chapterMemoryStats(qs, { nowMs: Date.now() });
        if (!stats) return 50;
        return Math.max(10, Math.min(100, stats.health));
    } catch (_) { return 50; }
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

/**
 * Case-insensitive chapter comparison. Chapter names arrive in mixed case
 * (Gem dict "Modern Physics" vs user-typed "modern physics"), and every
 * chapter filter used to be a strict `===` — so the same questions could
 * render under two chapter tiles / lists. Matching is trim + lowercase.
 */
function _chaptersMatch(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
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

// ════════════════════════════════════════════════════════════════════════════
//  ELO v2 — rating uncertainty (Glicko-lite), calibration capture,
//  guess correction, retrievability gating, chapter-level ability (θ_c)
// ════════════════════════════════════════════════════════════════════════════

/** Lazily hydrate the additive Elo-v2 state on AppState (merge-safe: additive). */
function _ensureEloV2State() {
    if (!AppState.elo.rd || typeof AppState.elo.rd !== 'object') AppState.elo.rd = {};
    if (!AppState.chapterTheta || typeof AppState.chapterTheta !== 'object') AppState.chapterTheta = {};
    if (!Array.isArray(AppState.calibrationLog)) AppState.calibrationLog = [];
}

/**
 * Current rating deviation for a subject — WIDE means the estimate is young
 * or stale and should move fast; NARROW means well-calibrated and stable.
 * Widens with idle days since the last Elo write (staleness).
 */
function _rdForSubject(subject) {
    _ensureEloV2State();
    const rd = Number(AppState.elo.rd[subject]);
    let cur = (isFinite(rd) && rd > 0) ? rd : RD_TUNING.START;
    if (AppState.eloUpdatedAt > 0) {
        const idleDays = Math.max(0, (Date.now() - AppState.eloUpdatedAt) / 86400000);
        if (idleDays > 0) {
            const widen = idleDays * RD_TUNING.DRIFT_PER_DAY;
            cur = Math.min(RD_TUNING.CAP, Math.sqrt(cur * cur + widen * widen));
        }
    }
    return cur;
}

/**
 * Effective K-factor — replaces the fixed K=32. A fresh profile swings ~64
 * points per solve; a calibrated one settles to ~10. This is the Glicko
 * insight (uncertainty-weighted updates) without the full Glicko-2 math.
 */
function _kEff(subject, baseK) {
    const rd = _rdForSubject(subject);
    const scale = Math.max(0.25, Math.min(2, rd / RD_TUNING.K_REF_RD));
    return Math.max(8, Math.min(RD_TUNING.K_MAX, (baseK || 32) * scale));
}

/** Remove one solve's worth of rating variance (√(rd²−C²) model). */
function _shrinkRdAfterSolve(subject) {
    _ensureEloV2State();
    const cur = _rdForSubject(subject);
    const c = RD_TUNING.SHRINK_PER_SOLVE;
    const next = Math.sqrt(Math.max(RD_TUNING.FLOOR * RD_TUNING.FLOOR, cur * cur - c * c));
    AppState.elo.rd[subject] = Math.max(RD_TUNING.FLOOR, next);
}

/**
 * Continuous retrievability gate — replaces the flat 0.25× re-solve discount
 * with the psychology it was approximating: correctly solving an item you were
 * ABOUT to forget (low R) proves real strength and earns ~full credit;
 * re-solving one you saw yesterday (high R) proves almost nothing (~0.15×).
 * Never-seen items always earn 1.0×.
 */
function _retrievabilityGate(questionObj) {
    if (!questionObj) return { scale: 1, r: null };
    const hasHistory = !!questionObj.firstAttemptResult ||
        (Number(questionObj.solveCount) || 0) > 0 ||
        (Array.isArray(questionObj.historyLogs) && questionObj.historyLogs.length > 0);
    if (!hasHistory) return { scale: 1, r: null };
    let r = 1;
    try { r = currentRetrievability(questionObj); } catch (_) { r = 1; }
    const clamped = Math.max(0, Math.min(1, r));
    return { scale: 0.15 + 0.85 * (1 - clamped), r: clamped };
}

/**
 * Guess correction for single-answer 4-option MCQs (3PL-flavored floor):
 * blind luck succeeds 25% of the time, so observed score S is rescaled to
 * S_eff = (S − g)/(1 − g) before the rating update. A lucky coin-flip now
 * moves the needle ~0 instead of +K; a genuine wrong answer still stings.
 */
function _guessAdjustedScore(questionObj, S) {
    try {
        if (!questionObj || questionObj.type !== 'mcq') return { sEff: S, adjusted: false };
        if (Array.isArray(questionObj.correctAnswer)) return { sEff: S, adjusted: false }; // multi → partial-credit path
        if (!Array.isArray(questionObj.options) || questionObj.options.length !== 4) return { sEff: S, adjusted: false };
        const g = 0.25;
        return { sEff: Math.max(-1, Math.min(1, (S - g) / (1 - g))), adjusted: true };
    } catch (_) { return { sEff: S, adjusted: false }; }
}

/**
 * Consume the pending pre-reveal confidence (set by the practice modal / SR
 * drawer just before this solve resolved). Logs a Brier entry for the weekly
 * Calibration Report and returns the anchor probability (or null).
 */
function _consumeConfidence(S) {
    _ensureEloV2State();
    const lvl = window._pendingSolveConfidence || null;
    window._pendingSolveConfidence = null;
    if (!lvl || !Object.prototype.hasOwnProperty.call(CONFIDENCE_ANCHORS, lvl)) return null;
    const p = CONFIDENCE_ANCHORS[lvl];
    try {
        AppState.calibrationLog.push({ t: Date.now(), p, s: Math.max(0, Math.min(1, Number(S) || 0)) });
        if (AppState.calibrationLog.length > CALIBRATION_LOG_CAP) {
            AppState.calibrationLog = AppState.calibrationLog.slice(-CALIBRATION_LOG_CAP);
        }
        // Persist immediately (coalesced) — the log is durable IndexedDB state
        // now, not session scratchpad, so it must ride every commit path.
        saveAllAsync().catch(() => {});
    } catch (_) { /* telemetry never blocks scoring */ }
    return p;
}

/**
 * Chapter-level ability vector (θ_c) — a small-K companion rating per
 * (subject, chapter). Subject Elo answers "how good are you overall"; θ_c
 * answers "how good are you HERE", which is what mode windows, the Daily Fix
 * Queue and the sub-100 gap panel actually need. Never feeds the AIR model
 * (no double counting — subject Elo remains the sole rank input).
 */
function _updateChapterTheta(subject, chapter, sEff) {
    try {
        if (!chapter) return null;
        _ensureEloV2State();
        const key = subject + '::' + String(chapter).trim().toLowerCase();
        const avgQ = _getChapterAvgElo(subject, chapter);
        let node = AppState.chapterTheta[key];
        if (!node || !isFinite(node.e)) node = { e: 1200, n: 0 };
        const pWin = 1 / (1 + Math.pow(10, (avgQ - node.e) / 400));
        node.e = Math.max(0, Math.min(2999, node.e + Math.round(24 * (sEff - pWin))));
        node.n += 1;
        AppState.chapterTheta[key] = node;
        return node.e;
    } catch (_) { return null; }
}

/** Read accessor for pickers/UI: current chapter ability + sample size. */
window.getChapterTheta = function (subject, chapter) {
    try {
        const key = _normalizeSubjectKey(subject) + '::' + String(chapter).trim().toLowerCase();
        const node = AppState.chapterTheta && AppState.chapterTheta[key];
        return node ? { theta: Math.round(node.e), solves: node.n } : { theta: 1200, solves: 0 };
    } catch (_) { return { theta: 1200, solves: 0 }; }
};

/**
 * Autonomy honesty clawback (SR-drawer flow). The Elo delta fires at the
 * moment of truth — BEFORE the user tags their autonomy level. Reading the
 * full solution is not retrieval practice and a hint is not independence, so
 * once the honest tag lands we reclaim the credit gap. Only ever shrinks
 * POSITIVE deltas; losses stand (you still failed, whatever you read).
 */
window._applyAutonomyClawback = function (q, eloResult, autonomy) {
    try {
        if (!q || !eloResult || !autonomy || autonomy === 'independent') return false;
        if (!(eloResult.deltaSubject > 0)) return false;
        const cap = (autonomy === 'solution_read') ? 0.4 : (autonomy === 'hint_used') ? 0.75 : 1.0;
        if (cap >= 1) return false;
        const allowed = Math.round(eloResult.deltaSubject * cap);
        const clawback = eloResult.deltaSubject - allowed;
        if (clawback <= 0) return false;
        const subj = _normalizeSubjectKey(q.subject);
        const cur = AppState.elo[subj] || 1200;
        AppState.elo[subj] = Math.max(0, Math.round(cur - clawback));
        eloResult.deltaSubject = allowed;
        eloResult.newSubjectElo = AppState.elo[subj];
        eloResult.adjustedForAutonomy = autonomy;
        return true;
    } catch (_) { return false; }
};

/** performanceQ proxy when only outcome + timing exist (SR tag comes later). */
function _proxyPerformanceQ(sCorrect, tauRaw) {
    if (sCorrect >= 0.999) return (isFinite(tauRaw) && tauRaw > 0 && tauRaw <= 0.6) ? 4.5 : 3.4;
    if (sCorrect > 0) return 2.5;
    return 1.3;
}

/**
 * Suspect-fast guard: a correct answer at <35% of target time on a 4-option
 * MCQ smells like a lucky guess. First occurrence damps the yield ×0.5 and
 * stamps the question; a CONFIRMING second solve clears the flag at full
 * credit. Knowledge repeats; luck does not.
 */
function _applySuspectFastDamp(questionObj, sPositive, tauRatio) {
    if (!questionObj || !(sPositive > 0.001)) return 1.0;
    if (!(Number(tauRatio) > 0) || tauRatio >= 0.35) return 1.0;
    if (questionObj.type !== 'mcq' || !Array.isArray(questionObj.options) || Array.isArray(questionObj.correctAnswer) || (questionObj.options.length !== 4)) return 1.0;
    if (questionObj._fastSuspectAt) {
        delete questionObj._fastSuspectAt;   // confirmed — knowledge, not luck
        return 1.0;
    }
    questionObj._fastSuspectAt = Date.now();
    return 0.5;
}

/**
 * THE CORE ELO MIGRATION ENGINE — HARDCORE ASYMMETRIC OVERHAUL
 *
 * Synchronous (execution-blocking). Computes structural modifications in-place.
 */
// ════════════════════════════════════════════════════════════════════════════
//  PRE-ELO SCHEMA HELPERS  (Delta-Based Reward Branch)
// ════════════════════════════════════════════════════════════════════════════
//
//  When a question's qElo is already trusted — either because Gemini
//  stamped it during ingestion (qEloSource = 'gem-stamped') OR because the
//  engine has accumulated enough solves for the legacy R_perf warmup to
//  have settled into a stable value (qEloSource = 'learned' and
//  solveCount ≥ CALIBRATED_SOLVE_THRESHOLD) — we replace the long warmup
//  formula with a much simpler delta-based reward. The math is the
//  canonical ELO expected-score S-curve:
//
//     P_win = 1 / (1 + 10^((Q − E) / 400))
//     rawSubjectDelta = K_user · (S − P_win) · timeMult
//     qEloDrift      = K_q    · ((1 − S) − (1 − P_win))
//
//  where S = score (1 for correct, 0 for wrong, partial allowed). The
//  formula is naturally stingy when a favourite wins (high E, low Q →
//  P_win ≈ 0.9 → small gain) and rewarding when an underdog wins (low E,
//  high Q → P_win ≈ 0.15 → big gain). Mis-fires on easy questions get an
//  extra stinginess multiplier because missing easy stuff is deadlier.
//

/** Map an integer qElo to its band's recommended targetTimeMins. */
function _eloBandTargetTime(qElo) {
    const b = getEloBand(qElo);
    if (!b) return 5; // safe fallback (matches storage.js default)
    const map = { T1_FOUNDATION: BAND_TARGET_TIME.T1, T2_CORE_MAINS: BAND_TARGET_TIME.T2,
                  T3_STD_MAINS: BAND_TARGET_TIME.T3, T4_ADV_EASY: BAND_TARGET_TIME.T4,
                  T5_PAPER_ADV: BAND_TARGET_TIME.T5, T6_ELITE: BAND_TARGET_TIME.T6,
                  T7_OLYMP: BAND_TARGET_TIME.T7 };
    return map[b] || 5;
}

/** Trim and null-guard a chapter name coming from a raw Gem emit. */
function sanitizeChapterName(name) {
    if (typeof name !== 'string') return null;
    const trimmed = name.trim().slice(0, 64);
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Walk an ingested batch and group by chapter. For each chapter, compute
 * the elite-heavy ratio and the population standard deviation of stamped
 * qElo values. Flag any chapter that:
 *   1. has ≥80% T6-T7 entries AND prior chapter running avg ≤1549 (T3 ceiling),
 *   2. has ≥20 entries with stdDev(qElo) < 15 (automation fingerprint).
 * Returns a map keyed by `subject|chapter` so processGemTextDump can stamp
 * each item in-place.
 */
function _auditGemBatchByChapter(items) {
    const out = {};
    if (!Array.isArray(items) || !items.length) return out;
    // group
    const buckets = {};
    for (const it of items) {
        // Prefer the Gem's provenance stamps (source chapters); fall back to
        // placement fields for non-gem items.
        const subj = _normalizeSubjectKey(it.gemSubject || it.subject || 'unknown');
        const ch   = ((it.gemChapter || it.chapter) || '').toString().trim();
        if (!ch) continue;
        const key = subj + '|' + ch;
        if (!buckets[key]) buckets[key] = { subject: subj, chapter: ch, qElos: [] };
        if (typeof it.qElo === 'number') buckets[key].qElos.push(it.qElo);
    }
    for (const key of Object.keys(buckets)) {
        const b = buckets[key];
        if (!b.qElos.length) continue;
        const eliteCount = b.qElos.filter(q => q >= 2100).length;
        const eliteShare = eliteCount / b.qElos.length;
        const priorAvg = _getChapterAvgElo(b.subject, b.chapter);
        let suspiciousDistribution = false;
        if (eliteShare >= 0.80 && priorAvg <= 1549 && b.qElos.length >= 3) {
            suspiciousDistribution = true;
        }
        // stdDev across the batch
        let suspiciousStdev = false;
        if (b.qElos.length >= 20) {
            const mean = b.qElos.reduce((a, c) => a + c, 0) / b.qElos.length;
            const variance = b.qElos.reduce((a, c) => a + (c - mean) * (c - mean), 0) / b.qElos.length;
            const stddev = Math.sqrt(variance);
            if (stddev < 15) suspiciousStdev = true;
        }
        out[key] = { suspiciousDistribution, suspiciousStdev, priorAvg, eliteShare };
    }
    return out;
}

/**
 * True iff the question's qElo is sufficiently trusted to use the
 * delta-based reward branch. gem-stamped trusts from solve #1; legacy
 * uncalibrated questions need CALIBRATED_SOLVE_THRESHOLD real solves.
 */
function _isQuestionEloCalibrated(q) {
    if (!q) return false;
    if (q.qEloSource === 'gem-stamped') return true;
    if (q.qEloSource === 'learned' && (q.solveCount || 0) >= CALIBRATED_SOLVE_THRESHOLD) return true;
    return false;
}

/**
 * Resolve the practice mode that applies to THIS solve. Flow/Hardcore
 * multipliers must only fire for the question the mode picker actually
 * queued into the practice modal — solves arriving from other entry points
 * (Error-Matrix SR drawer, revision flows) always settle at standard rates.
 * Without this gate, entering Hardcore and then reviewing easy matrix
 * errors would milk 1.8× wins + 2× escrow and burn the daily cap on
 * questions the hardcore picker never chose.
 */
function _activeModeForQuestion(questionObj) {
    const mode = AppState.practiceFlowMode || 'standard';
    if (mode === 'standard') return 'standard';
    const queued = Array.isArray(AppState.practiceQuestions)
        ? AppState.practiceQuestions[AppState.currentPracticeIndex]
        : null;
    if (!queued || !questionObj) return 'standard';
    // Reference identity first (modal passes live bank objects), id fallback
    // in case a caller hands a re-fetched copy of the same question.
    if (queued === questionObj) return mode;
    if (queued.id !== undefined && questionObj.id !== undefined &&
        queued.id.toString() === questionObj.id.toString()) return mode;
    return 'standard';
}

/** Look up the matching band target time in seconds. */
function _eloTargetSeconds(q) {
    const mins = (typeof q.targetTimeMins === 'number' && q.targetTimeMins > 0) ? q.targetTimeMins : _eloBandTargetTime(_safeQElo(q));
    return mins * 60;
}

/**
 * Canonical ELO reward for a trusted-qElo solve. Returns the integer
 * subject-ELO delta and the integer qElo drift. Math is symmetric and
 * self-balancing: a 4.0x ELO gap favourite with low qElo wins get tiny
 * gains (preventing point-farming), while low-ELO players beating hard
 * qElos get hefty rewards (encouraging stretch). Time multiplier
 * preserves the chemistry slow-penalty and the physics calculation
 * buffer from the legacy code.
 */
function _deltaBasedUserAndQuestionReward(userElo, qElo, isCorrect, subject, actualSecs, targetSecs, mode, kUserOverride) {
    const S = typeof isCorrect === 'number' ? isCorrect : (isCorrect ? 1 : 0);
    const T = ELO_GEM_STAMP_TUNING;
    // Standard ELO win probability for the user
    const P_win = 1 / (1 + Math.pow(10, (qElo - userElo) / 400));
    const P_q_win = 1 - P_win;
    // Temporal divergence with subject-specific buffers (mirror legacy)
    let tau = Math.max(T.timeMin, (typeof actualSecs === 'number' && actualSecs > 0 ? actualSecs : targetSecs) / Math.max(1, targetSecs));
    if (subject === 'physics') tau *= T.physicsTauBuffer;
    // Time multiplier: faster-than-target amplifies wins; slower amplifies losses.
    // Practice mode (Flow / Hardcore) reshapes the sweet spot — see _modeTimeMultiplier.
    // The mode arrives pre-gated from the caller (matrix/SR-drawer solves
    // pass 'standard' even while a mode is armed in the practice modal).
    const timeMult = _modeTimeMultiplier(S >= 0.5 ? 1 : 0, tau, mode || 'standard');
    // User ELO delta — full rating swing. K may be overridden per-subject by
    // the Glicko-lite effective K (uncertainty-weighted learning rate).
    const _kUser = (typeof kUserOverride === 'number' && kUserOverride > 0) ? kUserOverride : T.K_user;
    let rawSubjectDelta = _kUser * (S - P_win) * timeMult;
    // Stinginess: missing an easier-than-me question should hurt more
    // (high P_win × wrong outcome = worse than missing a hard one)
    if (S <= 0.001) rawSubjectDelta *= (P_win >= 0.7 ? T.misfireExtraMult : 1.0);
    rawSubjectDelta = Math.round(rawSubjectDelta);
    // Question qElo drift — tiny K_q. Question "wins" when user loses (1-S),
    // and matches ~the magnitude the system expects for the user's win probability.
    const qEloDrift = Math.round(T.K_q * ((1 - S) - P_q_win));
    // timeMult + the actual seconds used are returned so calculateEloMigration
    // can paint the FAST/SLOW chip without recomputing (previously these were
    // read from an out-of-scope local → TypeError on every calibrated solve).
    const effSecs = (typeof actualSecs === 'number' && actualSecs > 0) ? actualSecs : targetSecs;
    return { rawSubjectDelta, qEloDrift, P_win, timeMult, tauSeconds: Math.round(effSecs) };
}

// ════════════════════════════════════════════════════════════════════════════
//  PRACTICE MODE HELPERS  (Flow State vs Hardcore / Overclock)
// ════════════════════════════════════════════════════════════════════════════
//
//  Mode-aware reward math + picker. The mode is stored on AppState.practiceFlowMode
//  and persists across reloads. The two big buttons in chapter-detail view hand
//  the user a one-tap, hands-off cadence (Flow) or a high-stakes boss-fight
//  (Hardcore). The picker rebuilds AppState.practiceQuestions via
//  _pickQuestionForMode() whenever the user enters a mode or finishes a solve.

/** Canonical P_win (same formula the delta branch uses). */
function _pWinForQ(userElo, qElo) {
    return 1 / (1 + Math.pow(10, (qElo - userElo) / 400));
}

/**
 * Mode-aware time-curve multiplier. For wins: smaller τ (faster) → bigger bonus,
 * but the sweet spot depends on the mode (Hardcore rewards τ=0.45 more than
 * Flow rewards τ=0.6). For losses: slow solves amplify penalty, with Hardcore
 * punishing slow-wrong harder than Flow.
 */
function _modeTimeMultiplier(S, tau, mode) {
    const cfg = MODE_TUNING[mode] || MODE_TUNING.standard;
    if (S === 1) {
        return 1 / (1 + Math.max(0, tau - cfg.winSweetSpot));
    }
    // Failure: slow penalty below grace threshold + slow amplification above
    if (tau <= cfg.lossFastGrace) return 1 + 0.15 * Math.max(0, cfg.lossFastGrace - tau);
    return 1 + 0.4 * Math.max(0, tau - cfg.lossFastGrace);
}

/**
 * A Flow / Hardcore question must be genuinely untouched. Status alone is
 * not enough because older records can retain an `unsolved` status after an
 * attempt, while fumbled records use both `wrong` and `error`.
 */
function _isUnexecutedModeQuestion(q) {
    if (!q) return false;

    const status = q.status;
    const untouchedStatus = status == null || status === 'unsolved' || status === 'unexecuted';
    const hasAttemptHistory = Array.isArray(q.historyLogs) && q.historyLogs.length > 0;
    const hasFirstAttempt = q.firstAttemptResult === 'correct' || q.firstAttemptResult === 'incorrect';
    const hasSolveTelemetry = Number(q.solveCount) > 0
        || !!q.lastReviewedAt
        || !!q.lastSolvedAt
        || (typeof q.timeTaken === 'number' && q.timeTaken > 0);

    return untouchedStatus
        && !hasAttemptHistory
        && !hasFirstAttempt
        && !hasSolveTelemetry
        && !q.errorReason;
}

/**
 * Pick a chapter-local question whose P_win falls inside the mode's window,
 * with side preferences for low solveCount and tag diversity.
 * Returns the question or null if the chapter simply has no unexecuted
 * candidates even after widening the window.
 *
 * @param {Set} [seenSet]  Optional set of question objects already served this
 *   run — those are never re-picked, so Next can never repeat a question.
 */
function _pickQuestionForMode(subject, chapter, mode, seenSet) {
    if (!PRACTICE_MODES.includes(mode) || mode === 'standard') return null;
    const cfg = MODE_TUNING[mode];
    // Defensive: normalize the subject key so a display-name caller
    // ('Mathematics') can't silently miss every bank entry ('maths') and make
    // the mode buttons look dead. Both current assignment sites already pass
    // normalized keys, so this is a no-op for valid input.
    subject = _normalizeSubjectKey(subject);
    let bank = AppState.questionBank.filter(q =>
        q.subject === subject && (Array.isArray(AppState.currentChapterSelection) && AppState.currentChapterSelection.length
            ? AppState.currentChapterSelection.some(ch => _chaptersMatch(q.chapter, ch))
            : _chaptersMatch(q.chapter, chapter)) &&
        _isUnexecutedModeQuestion(q) &&
        (!seenSet || !seenSet.has(q)) &&
        typeof q.qElo === 'number' && isFinite(q.qElo) &&
        !q.isAnomaly &&
        !q.modeRetired
    );
    // ── Hardcore floor enforcement ────────────────────────────────────────
    // The closest-elo bridge (scanBestEffort) used to ignore minQeloFloor, so
    // a low-rated user clicking Hardcore whose chapter band never reached the
    // strict/fallback P_win windows would be handed the SAME easy question
    // Flow serves (both fell through to best-effort bridging). Filter the pool
    // up front so EVERY scan — strict, fallback, and best-effort — respects
    // the hardcore floor, and Hardcore exits gracefully when the chapter has
    // no ≥minQeloFloor questions instead of silently downgrading to easy ones.
    if (mode === 'hardcore' && cfg.minQeloFloor) {
        bank = bank.filter(q => q.qElo >= cfg.minQeloFloor);
    }
    if (!bank.length) return null;
    const userElo = (AppState.elo && AppState.elo[subject]) || 1200;
    const hasMin = (q) => cfg.minQeloFloor ? q.qElo >= cfg.minQeloFloor : true;
    // Skip deprioritization rank — fewer skips first (retired already excluded).
    const _skipRank = (q) => Math.min(9999, Number(q.skips) || 0);

    // Two-pass scan: strict window → fallback window.
    function scan(lo, hi, requireFloor) {
        const candidates = bank.filter(q => {
            const P = _pWinForQ(userElo, q.qElo);
            return P >= lo && P <= hi && (!requireFloor || hasMin(q));
        });
        if (!candidates.length) return null;
        // Sort by fewest skips, then smallest solveCount, then most-stale.
        candidates.sort((a, b) => {
            const ra = _skipRank(a) - _skipRank(b);
            if (ra !== 0) return ra;
            const sa = (a.solveCount || 0) - (b.solveCount || 0);
            if (sa !== 0) return sa;
            const ta = a.lastSolvedAt ? new Date(a.lastSolvedAt).getTime() : 0;
            const tb = b.lastSolvedAt ? new Date(b.lastSolvedAt).getTime() : 0;
            return ta - tb;
        });
        return candidates[0];
    }

    // Live adaptive target P_win (drifts with performance/skips), falling back
    // to the mode's sweet-spot midpoint on a fresh run.
    const targetP   = Math.max(0.01, Math.min(0.99,
        (_modeAdaptive.targetPwin == null) ? (cfg.PwinMin + cfg.PwinMax) / 2 : _modeAdaptive.targetPwin));
    const idealQElo = Math.round(userElo - 400 * Math.log10(targetP / (1 - targetP)));
    function scanBestEffort() {
        if (!bank.length) return null;
        const sorted = bank.slice().sort((a, b) => {
            const ra = _skipRank(a) - _skipRank(b);
            if (ra !== 0) return ra;
            const ga = Math.abs(a.qElo - idealQElo);
            const gb = Math.abs(b.qElo - idealQElo);
            if (ga !== gb) return ga - gb;        // smallest gap to ideal wins
            const sa = (a.solveCount || 0) - (b.solveCount || 0);
            if (sa !== 0) return sa;
            const ta = a.lastSolvedAt ? new Date(a.lastSolvedAt).getTime() : 0;
            const tb = b.lastSolvedAt ? new Date(b.lastSolvedAt).getTime() : 0;
            return ta - tb;
        });
        return sorted[0];
    }
    const bestEffort = scanBestEffort();
    if (bestEffort && (mode === 'hardcore' || mode === 'flow')) {
        const strictSc  = scan(Math.max(0.01, targetP - 0.10), Math.min(0.99, targetP + 0.10), mode === 'hardcore');
        const fallbackSc = scan(cfg.PwinFallbackMin, cfg.PwinFallbackMax, mode === 'hardcore');
        if (!strictSc && !fallbackSc) {
            const qEloMin   = Math.min.apply(null, bank.map(x => x.qElo));
            const qEloMax   = Math.max.apply(null, bank.map(x => x.qElo));
            const chosenGap = Math.abs(bestEffort.qElo - idealQElo);
            console.warn(
                '[practice mode] No ' + mode + '-eligible chapter questions match the ' +
                'target P_win ' + targetP.toFixed(3) + ' window ' +
                '(userElo=' + userElo + ', chapter qElo range ' + qEloMin + '–' + qEloMax + '). ' +
                'Closest-elo bridge: picked qElo ' + bestEffort.qElo + ' (gap ' + chosenGap +
                ' pts from ideal ' + idealQElo + ') so the user gets a question instead ' +
                'of a silent dead-end. Solve more chapter questions to widen the band.'
            );
        }
    }
    // ── Flow Lifeline: shift P_win windows toward easier problems when
    // CNS_LOAD crosses the fire threshold. Rebalances challenge-skill into
    // the flow channel. The lifeline dismisses after ONE solve. ──
    // Base strict window is symmetric around the live adaptive target (±0.10);
    // fallback stays the mode's configured wide window.
    let _pwMin = Math.max(0.01, targetP - 0.10);
    let _pwMax = Math.min(0.99, targetP + 0.10);
    let _fbMin = cfg.PwinFallbackMin;
    let _fbMax = cfg.PwinFallbackMax;
    try {
        if (typeof Lifeline !== 'undefined') {
            const _lifeline = Lifeline.evaluateLifeline(subject, chapter, mode, userElo, bank);
            if (_lifeline.active) {
                _pwMin = _lifeline.pwinMin;
                _pwMax = _lifeline.pwinMax;
                // Fallback windows widen proportionally
                const _shift = _lifeline.pwinMin - cfg.PwinMin;
                _fbMin = Math.min(1, (cfg.PwinFallbackMin || cfg.PwinMin) + _shift);
                _fbMax = Math.min(1, (cfg.PwinFallbackMax || cfg.PwinMax) + _shift);
                // Activate lifeline state so ribbon UI and cat-banner can detect it
                Lifeline.activateLifeline();
                // Tag the pick as lifeline-assisted
                window.__lastQuestionPickedWithLifeline = true;
            } else {
                window.__lastQuestionPickedWithLifeline = false;
            }
        }
    } catch (_) {}

    return scan(_pwMin, _pwMax, mode === 'hardcore')
        || scan(_fbMin, _fbMax, mode === 'hardcore')
        || bestEffort;
}

// ── Mode state (Flow State / Hardcore) ─────────────────────────────────────
// The mode serves ONE question at a time (single-item pool at index 0). There
// is no Prev/Next — advancement is owned by the Continue button (_modeAdvance)
// and the Skip action. We only track the set of questions already served this
// run so the picker never re-serves them. Skipped questions are marked seen
// the same way but left pristine (no-regret) apart from a deprioritizing skip
// stamp.
let _modeSeenIds = new Set();

// Session-scoped adaptive difficulty throttle: the live target win-probability
// the picker aims at. Reset on mode entry; drifts with performance + skips.
// `hist` feeds the 85%-rule drift (Wilson et al. 2019, Nature Communications:
// gradient-based learners peak near 85% training accuracy).
const _modeAdaptive = { targetPwin: null, hist: [] };

function _clearModeHistory() {
    _modeSeenIds = new Set();
}

function _modeSeenSet() {
    return _modeSeenIds;
}

/** Mode's default sweet-spot target P_win (midpoint of the strict window). */
function _modeCenter(mode) {
    const cfg = MODE_TUNING[mode] || MODE_TUNING.standard;
    return (cfg.PwinMin + cfg.PwinMax) / 2;
}

/**
 * Adaptive difficulty throttle — nudges the session target P_win based on the
 * just-solved outcome, EMA-smoothed so it never swings wildly. Raising the
 * target means "serve easier next", lowering means "serve harder next".
 */
function _modeNextTargetPwin(mode, outcome) {
    const cfg = MODE_TUNING[mode] || MODE_TUNING.standard;
    const center = _modeCenter(mode);
    const lo = Math.max(0.05, (cfg.PwinMin || 0.5) - 0.10);
    const hi = Math.min(0.95, (cfg.PwinMax || 0.5) + 0.15);
    const cur = (_modeAdaptive.targetPwin == null) ? center : _modeAdaptive.targetPwin;
    let delta = 0;
    if (outcome && outcome.correct) {
        const sweet = (typeof cfg.winSweetSpot === 'number') ? cfg.winSweetSpot : 0.5;
        const tau = Number(outcome.tau);
        const hasTiming = isFinite(tau) && tau > 0;
        const fast = hasTiming ? _clamp01(1 - (tau - sweet)) : 0; // untimed → neutral
        delta = 0.06 * fast;                       // fast & correct → harder next
    } else {
        const d = _clamp01(((Number(outcome && outcome.qElo) || 1200) - (Number(outcome && outcome.userElo) || 1200) + 400) / 800);
        delta = -0.10 * (1.5 - d);                 // miss an easy q → ease up a lot
    }

    // ── 85%-rule session drift ──
    // Track rolling accuracy (last 12 outcomes); if the session is cruising
    // above ~85% success, lean harder; struggling below it, ease off. The
    // bias is gentle and clamped so single swings never whipsaw the picker.
    try {
        _modeAdaptive.hist.push(outcome && outcome.correct ? 1 : 0);
        if (_modeAdaptive.hist.length > 24) _modeAdaptive.hist = _modeAdaptive.hist.slice(-24);
        if (_modeAdaptive.hist.length >= 4) {
            const h = _modeAdaptive.hist.slice(-12);
            const acc = h.reduce((a, c) => a + c, 0) / h.length;
            delta += Math.max(-0.06, Math.min(0.10, (0.85 - acc) * 0.30));
        }
    } catch (_) { /* telemetry never steers blind */ }

    const target = Math.max(lo, Math.min(hi, center + delta));
    _modeAdaptive.targetPwin = cur * 0.5 + target * 0.5;
    return _modeAdaptive.targetPwin;
}

/** Skip reason → immediate (non-EMA) target-P_win nudge for the next pick. */
function _modeAdjustTargetForSkip(reason) {
    const mode = AppState.practiceFlowMode;
    const cfg = MODE_TUNING[mode];
    if (!cfg) return;
    if (reason === 'already know' || reason === 'not now') return; // no window change
    const cur = (_modeAdaptive.targetPwin == null) ? _modeCenter(mode) : _modeAdaptive.targetPwin;
    const delta = (reason === 'too hard') ? 0.08 : (reason === 'too easy') ? -0.08 : 0;
    const lo = Math.max(0.05, (cfg.PwinMin || 0.5) - 0.10);
    const hi = Math.min(0.95, (cfg.PwinMax || 0.5) + 0.15);
    _modeAdaptive.targetPwin = Math.max(lo, Math.min(hi, cur + delta));
}

// ── No-regret Skip + Undo + reason popover ─────────────────────────────────
let _skipUndoTimer = null;
let _skipPopoverDismissBound = false;

function _dismissSkipUndoToast() {
    if (_skipUndoTimer) { clearTimeout(_skipUndoTimer); _skipUndoTimer = null; }
    const t = document.getElementById('skip-undo-toast');
    if (t && t.parentNode) t.parentNode.removeChild(t);
}

// Generic non-blocking app toast [AUDIT P2: alert→toast migration]. Exposed on
// window so feature modules can adopt it instead of adding more bespoke
// implementations or reaching for blocking native dialogs.
function _appToast(msg) {
    try {
        document.querySelectorAll('.jmax-app-toast').forEach(t => t.remove());
        const t = document.createElement('div');
        t.className = 'jmax-app-toast';
        t.setAttribute('role', 'status');
        t.textContent = msg;
        t.style.cssText = 'position:fixed;z-index:100001;bottom:calc(22px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);max-width:86vw;padding:10px 16px;background:rgba(15,17,26,.96);border:1px solid rgba(61,220,255,.35);border-radius:999px;color:#dfe7f5;font-size:12.5px;box-shadow:0 8px 30px rgba(0,0,0,.45);pointer-events:none;';
        document.body.appendChild(t);
        setTimeout(() => { try { t.remove(); } catch (_) {} }, 3400);
    } catch (_) {}
}
window.__jmaxAppToast = _appToast;

function _showSkipUndoToast(onUndo) {
    try {
        _dismissSkipUndoToast();
        const toast = document.createElement('div');
        toast.id = 'skip-undo-toast';
        toast.className = 'skip-undo-toast';
        toast.innerHTML = '<span>Question skipped — nothing was lost.</span><button id="skip-undo-btn" type="button">Undo</button>';
        document.body.appendChild(toast);
        const undoBtn = document.getElementById('skip-undo-btn');
        if (undoBtn) undoBtn.onclick = () => { if (onUndo) onUndo(); _dismissSkipUndoToast(); };
        _skipUndoTimer = setTimeout(_dismissSkipUndoToast, 5000);
    } catch (_) { /* toast is cosmetic */ }
}

function _injectSkipStyles() {
    if (document.getElementById('mode-skip-style')) return;
    const style = document.createElement('style');
    style.id = 'mode-skip-style';
    style.textContent = `
.skip-popover {
  position:fixed; z-index:100000; min-width:180px;
  background:rgba(15,17,26,.97); border:1px solid rgba(61,220,255,.25);
  border-radius:12px; padding:10px; box-shadow:0 10px 40px rgba(0,0,0,.5);
  font-family:'Orbitron',sans-serif;
}
.skip-popover .skip-popover-title { font-size:10px; letter-spacing:.5px; color:#8aa0c8; margin-bottom:8px; text-transform:uppercase; }
.skip-popover button {
  display:block; width:100%; text-align:left; margin:4px 0; padding:8px 10px;
  background:rgba(255,255,255,.05); color:#e8eefb; border:1px solid rgba(255,255,255,.08);
  border-radius:8px; cursor:pointer; font-size:12.5px; transition:background .15s ease, border-color .15s ease;
}
.skip-popover button:hover { background:rgba(61,220,255,.14); border-color:rgba(61,220,255,.4); }
.skip-undo-toast {
  position:fixed; z-index:100001; bottom:calc(22px + env(safe-area-inset-bottom)); left:50%; transform:translateX(-50%);
  display:flex; align-items:center; gap:12px; padding:10px 14px;
  background:rgba(15,17,26,.96); border:1px solid rgba(61,220,255,.3);
  border-radius:999px; box-shadow:0 8px 30px rgba(0,0,0,.45);
  color:#dfe7f5; font-size:12.5px; animation:eloChipIn .3s ease;
}
.skip-undo-toast button {
  background:rgba(61,220,255,.16); color:#8be9ff; border:1px solid rgba(61,220,255,.4);
  border-radius:999px; padding:4px 12px; cursor:pointer; font-weight:700; font-size:12px;
}
.skip-undo-toast button:hover { background:rgba(61,220,255,.28); }
`;
    document.head.appendChild(style);
}

function _dismissSkipPopover() {
    const p = document.getElementById('skip-popover');
    if (p && p.parentNode) p.parentNode.removeChild(p);
    if (_skipPopoverDismissBound) {
        document.removeEventListener('click', _onDocClickDismissSkip);
        _skipPopoverDismissBound = false;
    }
}

function _onDocClickDismissSkip(e) {
    try {
        const p = document.getElementById('skip-popover');
        if (p && !p.contains(e.target)) _dismissSkipPopover();
    } catch (_) { /* ignore */ }
}

function openSkipPopover() {
    if (!AppState.practiceFlowMode || AppState.practiceFlowMode === 'standard') return;
    _injectSkipStyles();
    _dismissSkipPopover();
    const btn = document.getElementById('practice-skip-btn');
    const pop = document.createElement('div');
    pop.id = 'skip-popover';
    pop.className = 'skip-popover';
    pop.innerHTML =
        '<div class="skip-popover-title">Skip — why?</div>' +
        '<button data-reason="too hard" type="button">📈 Too hard</button>' +
        '<button data-reason="too easy" type="button">📉 Too easy</button>' +
        '<button data-reason="already know" type="button">✅ Already know it</button>' +
        '<button data-reason="not now" type="button">⏳ Not now</button>';
    document.body.appendChild(pop);
    pop.querySelectorAll('button[data-reason]').forEach(b => {
        b.onclick = () => { const reason = b.getAttribute('data-reason'); _dismissSkipPopover(); skipQuestion(reason); };
    });
    // Anchor above the Skip button (clamped into the viewport).
    const vw = (typeof window.innerWidth === 'number' && window.innerWidth) || 800;
    const r = btn ? btn.getBoundingClientRect() : null;
    const ph = pop.offsetHeight || 160;
    const left = r ? Math.max(8, Math.min(vw - 200, r.left)) : 16;
    const top = r ? (r.top - ph - 10 >= 8 ? r.top - ph - 10 : r.bottom + 10) : 16;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    // Dismiss on any outside click (deferred so this click doesn't close it).
    setTimeout(() => {
        if (!_skipPopoverDismissBound) {
            document.addEventListener('click', _onDocClickDismissSkip);
            _skipPopoverDismissBound = true;
        }
    }, 0);
}
window.openSkipPopover = openSkipPopover;

/**
 * No-regret skip: stamps a deprioritizing marker but leaves the question
 * untouched (no Elo/qElo/solveCount/status/time mutation). Optionally nudges
 * the next pick via the reason, then advances to a fresh question.
 */
function skipQuestion(reason) {
    const mode = AppState.practiceFlowMode;
    if (!mode || mode === 'standard') return;
    const q = AppState.practiceQuestions[AppState.currentPracticeIndex];
    if (!q) return;
    if (AppState.practiceSubmittedFlags[AppState.currentPracticeIndex]) return; // already answered
    const before = {
        skips: q.skips || 0,
        lastSkippedAt: q.lastSkippedAt,
        skipReasons: (q.skipReasons || []).slice(),
        modeRetired: q.modeRetired || false,
    };
    q.skips = (q.skips || 0) + 1;
    q.lastSkippedAt = new Date().toISOString();
    q.skipReasons = q.skipReasons || [];
    q.skipReasons.push(reason || 'not now');
    if (q.skipReasons.length > 3) q.skipReasons = q.skipReasons.slice(-3);
    if (reason === 'already know' || q.skips >= 3) q.modeRetired = true;

    _modeAdjustTargetForSkip(reason);
    _modeSeenIds.add(q);
    saveAllAsync().catch(console.error);

    _showSkipUndoToast(() => {
        q.skips = before.skips;
        q.lastSkippedAt = before.lastSkippedAt;
        q.skipReasons = before.skipReasons;
        q.modeRetired = before.modeRetired;
        saveAllAsync().catch(console.error);
    });

    _rebuildPracticeQuestionsForMode(_modeSeenIds);
    if (AppState.practiceQuestions.length > 0) {
        _serveModeEntry({ q: AppState.practiceQuestions[0], submitted: false });
        _hideModeContinueButton();
    } else {
        // Skipping exhausted the pool — _rebuildPracticeQuestionsForMode already
        // exited the mode. Tear down the modal like _modeAdvance does.
        if (AppState.practiceTimer) { clearInterval(AppState.practiceTimer); AppState.practiceTimer = null; }
        closePracticeModal();
        showQuestionList();
    }
}
window.skipQuestion = skipQuestion;

/** Advance to the next adaptive question (Continue button). */
function _modeAdvance() {
    const mode = AppState.practiceFlowMode;
    if (!mode || mode === 'standard') return;
    const curQ = AppState.practiceQuestions[AppState.currentPracticeIndex];
    if (curQ) _modeSeenIds.add(curQ);
    _rebuildPracticeQuestionsForMode(_modeSeenIds);
    if (AppState.practiceQuestions.length > 0) {
        _serveModeEntry({ q: AppState.practiceQuestions[0], submitted: false });
        _hideModeContinueButton();
        return;
    }
    // Pool exhausted — _rebuildPracticeQuestionsForMode already exited the mode.
    if (AppState.practiceTimer) { clearInterval(AppState.practiceTimer); AppState.practiceTimer = null; }
    closePracticeModal();
    showQuestionList();
}
window.continuePractice = _modeAdvance;

/** Show/hide the footer actions for the current mode state. */
function _renderModeFooter() {
    const inMode = !!(AppState.practiceFlowMode && AppState.practiceFlowMode !== 'standard');
    const prev = document.getElementById('practice-prev-btn');
    const next = document.getElementById('practice-next-btn');
    const skip = document.getElementById('practice-skip-btn');
    const cont = document.getElementById('practice-continue-btn');
    if (prev) prev.style.display = inMode ? 'none' : '';
    if (next) next.style.display = inMode ? 'none' : '';
    if (skip) skip.style.display = inMode ? '' : 'none';
    if (cont) cont.style.display = 'none';
}

function _showModeContinueButton() {
    const cont = document.getElementById('practice-continue-btn');
    if (cont) cont.style.display = '';
    const skip = document.getElementById('practice-skip-btn');
    if (skip) skip.style.display = 'none';
}

function _hideModeContinueButton() {
    const cont = document.getElementById('practice-continue-btn');
    if (cont) cont.style.display = 'none';
    if (AppState.practiceFlowMode && AppState.practiceFlowMode !== 'standard') {
        const skip = document.getElementById('practice-skip-btn');
        if (skip) skip.style.display = '';
    }
}

/** Present a mode question (history entry or fresh pick) as the current one. */
function _serveModeEntry(entry) {
    if (!entry || !entry.q) return;
    window._pendingSolveConfidence = null;   // fresh item → stale tap discarded
    AppState.practiceQuestions = [entry.q];
    AppState.practiceSubmittedFlags = [!!entry.submitted];
    AppState.currentPracticeIndex = 0;
    AppState.practiceSeconds = 0;
    updatePracticeTimerDisplay();
    if (AppState.practiceTimer) clearInterval(AppState.practiceTimer);
    if (!entry.submitted) {
        AppState.practiceTimer = setInterval(() => {
            AppState.practiceSeconds++;
            updatePracticeTimerDisplay();
        }, 1000);
    } else {
        AppState.practiceTimer = null;
    }
    renderPracticeQuestionModal();
}

/** Set the active practice mode and persist it. */
function _setPracticeMode(mode) {
    if (!PRACTICE_MODES.includes(mode)) return;
    AppState.practiceFlowMode = mode;
    // Fresh run — drop any navigation history left over from a previous mode
    // and reset the adaptive throttle to the mode's sweet spot.
    _clearModeHistory();
    _modeAdaptive.targetPwin = _modeCenter(mode);
    // Reset hardcore daily counter if the date rolled over (LOCAL day — UTC
    // would reset at 05:30 IST and grant a fresh quota pre-midnight).
    const today = todayLocalKey();
    if (mode === 'hardcore') {
        if (AppState.hardcoreDailyDate !== today) {
            AppState.hardcoreDailyDate = today;
            AppState.hardcoreDailyCount = 0;
        }
        if (AppState.hardcoreDailyCount >= (MODE_TUNING.hardcore.capPerDay || 8)) {
            alert('Daily Hardcore cap reached (' + (MODE_TUNING.hardcore.capPerDay || 8) + '). Override tomorrow with full send.');
            // Revert mode + repaint badge so the UI doesn't lie about state.
            AppState.practiceFlowMode = 'standard';
            _renderModeBadge();
            _renderModeFooter();
            saveAllAsync().catch(console.error);
            return;
        }
    }
    saveAllAsync().catch(console.error);
    _rebuildPracticeQuestionsForMode();
    _renderModeBadge();
    _renderModeFooter();
    // ── Open the practice modal with the freshly-picked mode question ──
    // Previously this block only RE-rendered the modal contents without
    // calling openModal('practice-modal'), so clicking FLOW / HARDCORE built
    // the queue and painted the badge but nothing ever appeared on screen —
    // the classic "the mode buttons don't work" report. Mirrors
    // startPracticeWithQuestion's open sequence exactly.
    if (AppState.practiceQuestions.length > 0 &&
        typeof renderPracticeQuestionModal === 'function') {
        AppState.practiceSeconds = 0;
        updatePracticeTimerDisplay();
        renderPracticeQuestionModal();
        openModal('practice-modal');
        AppState.photoHidden = false;
        const hideBtn = document.getElementById('hide-photo-toggle');
        if (hideBtn) hideBtn.textContent = '📷 Hide Image';
        // ── Start the practice-question timer ──
        // Lives INSIDE the non-empty-queue branch: a failed mode refill used
        // to leave this 1s interval running with no modal — and a non-null
        // practiceTimer made _getDeepWorkBlockMultiplier hand out a phantom
        // ×1.5 ELO bonus on unrelated solves until some other path nulled it.
        if (AppState.practiceTimer) clearInterval(AppState.practiceTimer);
        AppState.practiceTimer = setInterval(() => {
            AppState.practiceSeconds++;
            if (typeof updatePracticeTimerDisplay === 'function') {
                updatePracticeTimerDisplay();
            }
        }, 1000);
    } else if (AppState.practiceTimer) {
        // Refill produced nothing (mode exited + queue emptied): make sure no
        // stale timer from an earlier session survives the bail-out.
        clearInterval(AppState.practiceTimer);
        AppState.practiceTimer = null;
    }
}

/** Exit practice mode back to standard filter-by-status. */
function _exitPracticeMode() {
    AppState.practiceFlowMode = 'standard';
    _modeAdaptive.targetPwin = null;
    if (AppState.practiceTimer) { clearInterval(AppState.practiceTimer); AppState.practiceTimer = null; }
    AppState.practiceSeconds = 0;
    AppState.practiceQuestions = [];
    AppState.practiceSubmittedFlags = [];
    AppState.currentPracticeIndex = 0;
    _clearModeHistory();
    saveAllAsync().catch(console.error);
    _renderModeBadge();
    _renderModeFooter();
    // Queue is empty now — close any lingering practice modal instead of
    // re-rendering a blank question (renderPracticeQuestionModal guards
    // against empty queues, but the modal shell would linger otherwise).
    closeModalStr('practice-modal');
}

/**
 * Refill AppState.practiceQuestions with one mode-appropriate question,
 * reset practiceSubmittedFlags, currentPracticeIndex. This is the post-solve
 * auto-refill for Flow / Hardcore.
 *
 * @param {Set} [seenSet]  Passed through to _pickQuestionForMode so a refill
 *   never re-serves a question already shown this run (see practiceNext).
 */
function _rebuildPracticeQuestionsForMode(seenSet) {
    const mode = AppState.practiceFlowMode;
    if (mode === 'standard' || !PRACTICE_MODES.includes(mode)) return;
    const q = _pickQuestionForMode(AppState.currentSubject, AppState.currentChapter, mode, seenSet);
    if (!q) {
        // No more mode-eligible questions in this chapter — gracefully exit
        // the mode so the user is not stuck staring at a blank practice modal.
        const label = mode === 'flow' ? 'Flow' : 'Hardcore';
        (window.__jmaxAppToast || alert)('No more ' + label + '-eligible questions in this chapter. Exiting to standard mode.');
        AppState.practiceFlowMode = 'standard';
        _modeAdaptive.targetPwin = null;
        _renderModeBadge();
        _renderModeFooter();
        saveAllAsync().catch(console.error);
        AppState.practiceQuestions = [];
        AppState.practiceSubmittedFlags = [];
        AppState.currentPracticeIndex = 0;
        AppState.practiceSeconds = 0;
        _clearModeHistory();
        if (typeof renderPracticeQuestionModal === 'function') renderPracticeQuestionModal();
        return;
    }
    // We have a fresh mode-appropriate question; reset queue to a one-item pool.
    AppState.practiceQuestions = [q];
    AppState.practiceSubmittedFlags = AppState.practiceQuestions.map(() => false);
    AppState.currentPracticeIndex = 0;
    AppState.practiceSeconds = 0;
}

/**
 * Inject the two big glowing mode buttons into the chapter-detail view.
 * Idempotent — safe to call multiple times.
 */
function _renderModeButtonsIntoChapterDetail() {
    const row = document.getElementById('mode-buttons-row');
    if (!row) return;

    // ── Inject compact header-mode stylesheet once ────────────────────────
    if (!document.getElementById('mode-button-style')) {
        const style = document.createElement('style');
        style.id = 'mode-button-style';
        style.textContent = `
@keyframes mode-glow-flow { 0%,100%{box-shadow:0 0 0 0 rgba(0,200,255,.3);} 50%{box-shadow:0 0 8px 2px rgba(0,200,255,.3);} }
@keyframes mode-glow-hc   { 0%,100%{box-shadow:0 0 0 0 rgba(255,70,70,.35);} 50%{box-shadow:0 0 10px 2px rgba(255,60,60,.35);} }
@keyframes mode-glow-active-flow { 0%,100%{box-shadow:0 0 6px 1px rgba(0,220,255,.45);} 50%{box-shadow:0 0 14px 3px rgba(0,220,255,.55);} }
@keyframes mode-glow-active-hc   { 0%,100%{box-shadow:0 0 8px 2px rgba(255,50,50,.5);} 50%{box-shadow:0 0 16px 4px rgba(255,40,40,.6);} }
@keyframes mode-check-in { 0%{transform:scale(0);opacity:0;} 60%{transform:scale(1.2);opacity:1;} 100%{transform:scale(1);opacity:1;} }
@keyframes mode-ripple { 0%{transform:scale(0);opacity:.5;} 100%{transform:scale(4);opacity:0;} }

/* Compact header pill — shared base */
.mode-pill {
  position:relative; overflow:hidden;
  font-family:'Orbitron',sans-serif; font-size:10px; font-weight:700;
  letter-spacing:.4px; padding:5px 11px; border-radius:999px;
  cursor:pointer; color:#fff; border:1px solid transparent;
  background:rgba(255,255,255,.04);
  backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04), 0 2px 10px rgba(0,0,0,.35);
  transition:transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .25s ease, opacity .3s ease;
  white-space:nowrap; line-height:1;
}
.mode-pill:hover { transform:scale(1.06); }
.mode-pill:active { transform:scale(.94); transition:transform .08s ease; }

/* Feed pill */
.mode-pill-feed {
  border-color:rgba(255,255,255,.12);
  background:rgba(255,255,255,.06);
}
.mode-pill-feed:hover { border-color:rgba(255,255,255,.3); box-shadow:0 0 14px rgba(255,255,255,.08); }

/* Flow pill */
.mode-pill-flow {
  border-color:rgba(0,200,255,.2);
  animation:mode-glow-flow 2.8s ease-in-out infinite;
}
.mode-pill-flow:hover { border-color:rgba(0,200,255,.45); }

/* Hardcore pill */
.mode-pill-hc {
  border-color:rgba(255,70,70,.22);
  animation:mode-glow-hc 2s ease-in-out infinite;
}
.mode-pill-hc:hover { border-color:rgba(255,70,70,.5); }

/* Active states */
        `;
        document.head.appendChild(style);
    }

    // ── Already built — just refresh the badge state ──────────────────────
    if (document.getElementById('btn-mode-feed')) { _renderModeBadge(); return; }

    // ── Feed Question pill ─────────────────────────────────────────────────
    const feed = document.createElement('button');
    feed.id = 'btn-mode-feed';
    feed.className = 'mode-pill mode-pill-feed';
    feed.textContent = '📸 Feed';
    feed.title = 'Upload or paste questions';
    feed.onclick = () => openModal('upload-modal');
    row.appendChild(feed);

    // ── Flow State pill ────────────────────────────────────────────────────
    const flow = document.createElement('button');
    flow.id = 'btn-mode-flow';
    flow.className = 'mode-pill mode-pill-flow';
    flow.innerHTML = '🎯 Flow';
    flow.title = 'Flow State · P_win ∈ [0.75, 0.85]';
    flow.onclick = (e) => {
        _playModeClickRipple(e, flow); _setPracticeMode('flow'); _playModeSound('flow');
    };
    flow.addEventListener('mouseenter', (e) => _spawnModeHoverParticles(e, flow, 'flow'));
    row.appendChild(flow);

    // ── Hardcore pill ──────────────────────────────────────────────────────
    const hardcore = document.createElement('button');
    hardcore.id = 'btn-mode-hardcore';
    hardcore.className = 'mode-pill mode-pill-hc';
    hardcore.innerHTML = '⚡ Hardcore';
    hardcore.title = 'Hardcore / Overclock · P_win ∈ [0.35, 0.50]';
    hardcore.onclick = (e) => {
        _playModeClickRipple(e, hardcore); _setPracticeMode('hardcore'); _playModeSound('hardcore');
    };
    hardcore.addEventListener('mouseenter', (e) => _spawnModeHoverParticles(e, hardcore, 'hardcore'));
    row.appendChild(hardcore);

    _renderModeBadge();
}

// ── Click ripple effect ────────────────────────────────────────────────────
function _playModeClickRipple(e, btn) {
    const ripple = document.createElement('span');
    ripple.className = 'mode-ripple';
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top  = (e.clientY - rect.top  - size / 2) + 'px';
    btn.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
}

// ── Mode-engage sound cue (FX-gated) ───────────────────────────────────────
function _playModeSound(mode) {
    if (!window.FX || !window.FX.wantSound()) return;
    try {
        // Reuse a single AudioContext — browsers cap concurrent instances at ~6–12.
        if (!window.__modeAudioCtx) {
            window.__modeAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        const ctx = window.__modeAudioCtx;
        // Resume if suspended (autoplay policy)
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        if (mode === 'flow') {
            // Soft ascending chime
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        } else {
            // Deep percussive thud
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(180, now);
            osc.frequency.exponentialRampToValueAtTime(60, now + 0.12);
            gain.gain.setValueAtTime(0.18, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        }
        osc.connect(gain).connect(ctx.destination);
        osc.start(now); osc.stop(now + 0.3);
    } catch (_) { /* audio not available */ }
}

// ── Hover particle trail (FX-gated) ────────────────────────────────────────
function _spawnModeHoverParticles(e, btn, mode) {
    if (!window.FX || !window.FX.wantEffects()) return;
    const color = mode === 'flow' ? 'rgba(0,200,255,.7)' : 'rgba(255,90,90,.7)';
    for (let i = 0; i < 4; i++) {
        const dot = document.createElement('span');
        dot.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;width:4px;height:4px;border-radius:50%;' +
            'background:' + color + ';left:' + (e.clientX + (Math.random()-0.5)*30) + 'px;' +
            'top:' + (e.clientY + (Math.random()-0.5)*16) + 'px;' +
            'animation:mode-particle-float .8s ease-out forwards;';
        document.body.appendChild(dot);
        dot.addEventListener('animationend', () => dot.remove());
    }
    // Inject float keyframe if needed
    if (!document.getElementById('mode-particle-keyframes')) {
        const ks = document.createElement('style');
        ks.id = 'mode-particle-keyframes';
        ks.textContent = '@keyframes mode-particle-float { 0%{opacity:1;transform:translateY(0) scale(1);} 100%{opacity:0;transform:translateY(-32px) scale(.3);} }';
        document.head.appendChild(ks);
    }
}

/** Reflect the current mode in the badges/exit-pill and button active states. */
function _renderModeBadge() {
    // Visual toggle state intentionally removed — pills are plain action buttons.
}

// Expose the public entry points so the onclick handlers work from inline HTML
window.startFlowPractice     = () => _setPracticeMode('flow');
window.startHardcorePractice = () => _setPracticeMode('hardcore');
window.exitPracticeMode      = () => _exitPracticeMode();

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
        // isFinite guard — a bare typeof check lets corrupt-storage NaN
        // straight into Math.max(0, NaN + …) = NaN, which then persists.
        oldQElo: (questionObj && typeof questionObj.qElo === 'number' && isFinite(questionObj.qElo)) ? questionObj.qElo : 1200,
        newQElo: (questionObj && typeof questionObj.qElo === 'number' && isFinite(questionObj.qElo)) ? questionObj.qElo : 1200,
        tierChanged: false,
        oldTier: '',
        newTier: '',
        isAnomaly: false,
    };
    if (!base) return result;
    // Elo v2 uncertainty telemetry — captured BEFORE any mutation this solve.
    result.rdBefore = _rdForSubject(safeSubject);
    result.kEffUsed = _kEff(safeSubject, base ? base.K : undefined);

    // ── Step A: Temporal Divergence (τ) + Subject Behavioral Adjustments ──
    const T_act = Math.max(0, Number(actualTime) || 0);
    const T_avg = _getChapterAvgTime(safeSubject, questionObj ? questionObj.chapter : null);
    const tauRaw = T_act / Math.max(1, T_avg);

    let tau = tauRaw;
    // ── Elo v2: graded score support. scoreOutcome may now arrive fractional
    // [0,1] (partial marking). Binary semantics are preserved for branch
    // selection; the continuous vector drives R_perf and the delta blend.
    const S_in = Math.max(0, Math.min(1, Number(scoreOutcome) || 0));
    const S = (S_in >= 0.999) ? 1 : 0;
    result.partialCredit = (S_in > 0 && S_in < 1) ? S_in : null;
    let S_forPerf = S_in;

    if (safeSubject === 'physics') {
        tau = tauRaw * 0.85; // Calculation buffer window
    } else if (safeSubject === 'chemistry') {
        // Slow-but-correct answers downgrade the performance vector yield
        if (tauRaw > 1.25 && S === 1) {
            S_forPerf = Math.max(0.1, 1.0 - 0.4 * (tauRaw - 1.25));
        }
    }

    const E_s = AppState.elo[safeSubject] || 1200;
    const Q_Elo = (questionObj && typeof questionObj.qElo === 'number' && isFinite(questionObj.qElo)) ? questionObj.qElo : 1200;

    // === INSERTED: Delta-Based Reward Fast Path (pre-ELO schema) ===
    if (_isQuestionEloCalibrated(questionObj)) {
        // Sefc is declared BEFORE any use — the previous build referenced it
        // ~25 lines above this line (temporal dead zone → ReferenceError that
        // silently killed every gem-stamped/learned solve via the caller's
        // try/catch).
        const Sefc = (Number(scoreOutcome) === 1) ? 1 : 0;

        // Practice-mode reward multipliers + escrow bonus multiplier.
        // Hardcore wins get 1.8×, losses get 0.6× sympathy; escrow bonus 2×.
        // Flow mode passes through at 1.0× (standard cadence).
        // GATED per-solve: only the question the mode picker queued gets the
        // mode rates — matrix/SR-drawer reviews settle at standard even while
        // a mode is armed, so hardcore can't be farmed via easy error reviews.
        const mode = _activeModeForQuestion(questionObj);
        const modeCfg = MODE_TUNING[mode] || MODE_TUNING.standard;

        // ── Elo v2 pre-modifiers ──────────────────────────────────────────
        // Graded score: partial credit (multi-select marking) flows straight
        // into the canonical delta — no more all-or-nothing rating signal.
        let sScore = Math.max(0, Math.min(1, Number(scoreOutcome) || 0));
        result.partialCredit = (sScore > 0 && sScore < 1) ? sScore : null;
        // Guess correction for single-answer 4-option MCQs.
        const guessF = _guessAdjustedScore(questionObj, sScore);
        if (guessF.adjusted) {
            sScore = Math.max(0, Math.min(1, guessF.sEff));   // clamp ≥0; wrong stays wrong
            result.guessAdjusted = true;
        }
        // Suspect-fast damping (knowledge repeats; luck does not).
        const targetSecsF = _eloTargetSeconds(questionObj || { qElo: Q_Elo });
        const tauRatioF = ((Number(actualTime) || 0) > 0) ? (Number(actualTime) / Math.max(1, targetSecsF)) : 1;
        const fastDampF = _applySuspectFastDamp(questionObj, sScore, tauRatioF);
        if (fastDampF < 1) result.suspectFastDamped = true;

        const dr = _deltaBasedUserAndQuestionReward(
            E_s, Q_Elo, sScore, safeSubject,
            Number(actualTime) || 0,
            targetSecsF,
            mode,
            _kEff(safeSubject, ELO_GEM_STAMP_TUNING.K_user)   // uncertainty-weighted K
        );
        if (fastDampF < 1) dr.rawSubjectDelta = Math.round(dr.rawSubjectDelta * fastDampF);

        // Calibration capture — Brier-logged; overconfident-wrong stings extra,
        // underconfident-right yields slightly damped (metacognitive shaping).
        const confPF = _consumeConfidence(Sefc);
        if (confPF != null) {
            result.confidenceUsed = confPF;
            if (dr.rawSubjectDelta < 0 && confPF >= CONFIDENCE_ANCHORS.sure) {
                dr.rawSubjectDelta = Math.round(dr.rawSubjectDelta * 1.18);
            } else if (dr.rawSubjectDelta > 0 && confPF <= CONFIDENCE_ANCHORS.guess) {
                dr.rawSubjectDelta = Math.round(dr.rawSubjectDelta * 0.95);
            }
        }

        // Continuous retrievability gate — the fast path previously had NO
        // re-solve discount at all; it now shares the exact psychology the
        // legacy path approximated with a flat 0.25× step.
        const gateF = _retrievabilityGate(questionObj);
        if (gateF.scale < 1 && dr.rawSubjectDelta > 0) {
            dr.rawSubjectDelta = Math.round(dr.rawSubjectDelta * gateF.scale);
        }
        result.rAtSolve = gateF.r;

        // Applied BEFORE the AppState.elo mutation — previously the rating was
        // written with the UN-multiplied delta and the multiplier only mutated
        // the local dr object afterwards, so Hardcore 1.8× never landed.
        dr.rawSubjectDelta = Math.round(
            dr.rawSubjectDelta *
            (sScore >= 0.999 ? (modeCfg.winsMultiplier || 1) : (modeCfg.lossMultiplier || 1))
        );

        const oldE_s = E_s;
        let newE_s = Math.max(0, Math.min(ELO_GEM_STAMP_TUNING.ceiling, E_s + dr.rawSubjectDelta));

        // ── CNS Load: stepped yield multiplier on subject ELO gain only (NOT qElo drift) ──
        // Skip CNS computation when night guard Tier 3 is active — the night guard
        // ×0.20 penalty supersedes CNS and avoids multiplicative stacking to ~0.05×.
        const _nightForceCnsPre = NightGuard.shouldForceCns();
        if (!_nightForceCnsPre) {
            const _cns = CNSLoad.computeCnsLoad(safeSubject, studySecs);
            const _cnsMult = _cns.multiplier;
            if (_cnsMult < 1.0) {
                const _cnsDelta = Math.round(dr.rawSubjectDelta * _cnsMult);
                newE_s = Math.max(0, Math.min(ELO_GEM_STAMP_TUNING.ceiling, E_s + _cnsDelta));
            }
            result.cnsLoad = _cns.cnsLoad;
            result.cnsMultiplier = _cns.multiplier;
            result.cnsBadge = _cns.badge;
            result.cnsLabel = _cns.label;
            result.cnsTauCap = _cns.tauCap;
        }

        // ── Flow Lifeline: if this solve was lifeline-assisted, multiply
        // subject ELO gain by 0.65 and tag for telemetry. ──
        if (window.__lastQuestionPickedWithLifeline) {
            const _preLifelineElo = AppState.elo[safeSubject];
            const _lifelineDelta = Math.round((newE_s - E_s) * 0.65);
            AppState.elo[safeSubject] = Math.max(0, Math.min(ELO_GEM_STAMP_TUNING.ceiling, E_s + _lifelineDelta));
            newE_s = AppState.elo[safeSubject];
            result.lifelineActive = true;
            result.lifelineMultiplier = 0.65;
            if (questionObj) questionObj._lifelineAssisted = true;
            window.__lastQuestionPickedWithLifeline = false;
            // Reset lifeline dismissal after solve completes
            try { Lifeline.resetAfterSolve(); } catch (_) {}
        }

        // ── Post-23:00 Diminishing Returns Guard: late-night ELO yield degradation ──
        const _nightMult = NightGuard.getMultiplier();
        if (_nightMult < 1.0) {
            const _nightDelta = Math.round((newE_s - E_s) * _nightMult);
            newE_s = Math.max(0, Math.min(ELO_GEM_STAMP_TUNING.ceiling, E_s + _nightDelta));
            result.nightGuardActive = true;
            result.nightGuardMultiplier = _nightMult;
        }
        // Force-set CNS metadata when Tier 3 is active (CNS computation already skipped above)
        if (_nightForceCnsPre) {
            result.cnsLoad = 1.0;
            result.cnsMultiplier = 0.20;
            result.cnsBadge = '🛌';
            result.cnsLabel = 'CNS force-set: late-night Tier 3';
        }

        AppState.elo[safeSubject] = newE_s;
        AppState.eloUpdatedAt = Date.now(); // LWW clock for cloud merge

        if (dr.rawSubjectDelta > 0) {
            // Track hardcore daily use (only when winning on hardcore)
            if (mode === 'hardcore' && Sefc === 1) {
                const today = todayLocalKey();
                if (AppState.hardcoreDailyDate !== today) {
                    AppState.hardcoreDailyDate = today;
                    AppState.hardcoreDailyCount = 0;
                }
                AppState.hardcoreDailyCount = (AppState.hardcoreDailyCount || 0) + 1;
            }
        }

        // ── Elo v2 post-commit ──
        _shrinkRdAfterSolve(safeSubject);
        // Memory Kernel v2 write: stability/difficulty/reps/lapses move HERE
        // (single authoritative commit per solve). Also stamps lastReviewedAt,
        // which this path never set — a long-standing grid-staleness bug that
        // left gem-stamped items decaying from their FIRST review forever.
        try {
            updateMemoryOnReview(questionObj, {
                correct: sScore >= 0.999,
                performanceQ: _proxyPerformanceQ(sScore, tauRatioF),
            });
            questionObj.lastReviewedAt = new Date().toISOString();
        } catch (_) { /* memory telemetry never blocks scoring */ }
        result.thetaC = _updateChapterTheta(safeSubject, questionObj ? questionObj.chapter : null, sScore);

        const oldQ = Q_Elo;
        let newQ = Math.max(0, Q_Elo + dr.qEloDrift);

        const chapterAvg = _getChapterAvgElo(safeSubject, questionObj.chapter);
        let isAnomaly = false;
        if (Math.abs(newQ - chapterAvg) > 600) { isAnomaly = true; }

        questionObj.qEloSource = (questionObj.qEloSource === 'gem-stamped') ? 'gem-stamped' : 'learned';
        questionObj.solveCount = (questionObj.solveCount || 0) + 1;
        questionObj.lastSolvedAt = new Date().toISOString();
        questionObj.qElo = (typeof newQ === 'number' && isFinite(newQ)) ? Math.max(0, newQ) : 1200;   // never persist NaN
        if (isAnomaly) questionObj.isAnomaly = true;
        if (Sefc === 1) {
            questionObj.easeFactor = Math.min(3.0, (questionObj.easeFactor || 2.5) + 0.15);
        } else {
            questionObj.easeFactor = Math.max(1.3, (questionObj.easeFactor || 2.5) - 0.2);
        }

        const oldGlobal = AppState.elo.global || 1200;
        const newGlobal = _computeGlobalMetaMMR(
            AppState.elo.physics || 1200,
            AppState.elo.chemistry || 1200,
            AppState.elo.maths || 1200
        );
        AppState.elo.global = newGlobal;
        AppState.eloUpdatedAt = Date.now(); // LWW clock for cloud merge

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
        // Time-bonus metadata for injectEloShiftChip. timeMult/tauSeconds are
        // returned by _deltaBasedUserAndQuestionReward — the previous build
        // referenced a `timeMult` local that only existed inside that helper,
        // throwing a TypeError here on every calibrated solve.
        const _tm = (typeof dr.timeMult === 'number' && isFinite(dr.timeMult)) ? dr.timeMult : 1;
        result.timeBonusFactor = parseFloat(_tm.toFixed(3));
        result.tauSeconds = Math.round(Number(dr.tauSeconds) || 0);
        result.timeBonusLabel = (_tm >= 1.10)
            ? 'FAST ×' + _tm.toFixed(2)
            : (_tm <= 0.85)
                ? 'SLOW ×' + _tm.toFixed(2)
                : 'BALANCED';
        result.modeActive = (mode !== 'standard') ? mode : null;
        result.rdAfter = _rdForSubject(safeSubject);
        result.kEffUsed = _kEff(safeSubject, ELO_GEM_STAMP_TUNING.K_user);
        return result;
    }
    // === END INSERTED FAST PATH ===

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
    let K_system = K_base * mu_block * omega_decay * delta_error;
    // Uncertainty-weighted learning rate — young/stale estimates move faster,
    // calibrated ones barely drift (rd-scaled on top of the subject baseline).
    K_system *= (_kEff(safeSubject, base.K) / Math.max(1, base.K));

    // ── Elo v2 pre-modifiers: guess correction, suspect-fast, calibration ──
    let sBlend = S_in;
    const guessL = _guessAdjustedScore(questionObj, S_in);
    if (guessL.adjusted) {
        sBlend = Math.max(0, Math.min(1, guessL.sEff));   // clamp ≥0; wrong stays wrong
        result.guessAdjusted = true;
    }
    const targetSecsL = _eloTargetSeconds(questionObj || { qElo: Q_Elo });
    const tauRatioL = ((Number(actualTime) || 0) > 0) ? (Number(actualTime) / Math.max(1, targetSecsL)) : 1;
    const fastDampL = _applySuspectFastDamp(questionObj, sBlend, tauRatioL);
    if (fastDampL < 1) result.suspectFastDamped = true;
    const confPL = _consumeConfidence(S_in);
    let confMultL = 1;
    if (confPL != null) {
        result.confidenceUsed = confPL;
        if (sBlend <= 0.001 && confPL >= CONFIDENCE_ANCHORS.sure) confMultL = 1.18;       // overconfident-wrong
        else if (sBlend >= 0.999 && confPL <= CONFIDENCE_ANCHORS.guess) confMultL = 0.95; // underconfident-right
    }

    // ── Step E: Asymmetric Antagonistic Scaling Curves (graded blend) ──
    // Ω_win compresses point yields heavily at high ratings (making climbing tough).
    // Ω_loss minimizes deductions at low ratings but scales up heavily at high levels.
    // Partial credit linearly blends the win-yield and loss-yield vectors, so a
    // half-correct multi-select now lands BETWEEN the poles instead of counting
    // as a total loss — the rating signal finally matches JEE marking.
    const omegaWin = 2 / (1 + Math.pow(10, (E_s - 1200) / 800));
    const omegaLoss = 2 / (1 + Math.pow(10, (1200 - E_s) / 800));
    const winYield = omegaWin * (1 - E_score);
    const lossYield = omegaLoss * (0 - E_score);
    let rawDelta = K_system * (sBlend * winYield + (1 - sBlend) * lossYield);
    rawDelta *= fastDampL * confMultL;

    // ── Re-solve Decay → CONTINUOUS retrievability gate (Memory Kernel v2).
    // The flat 0.25× step is superseded by the psychology it approximated:
    // solving an item you were about to forget (low R at solve time) proves
    // real strength and earns near-full credit; re-solving one you reviewed
    // yesterday earns ~0.15×. Losses always stand at full weight.
    const _gateL = _retrievabilityGate(questionObj);
    if (_gateL.scale < 1 && rawDelta > 0) {
        rawDelta *= _gateL.scale;
    }
    result.rAtSolve = _gateL.r;

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
    // Practice-mode multiplier: Hardcore win = 1.8×, loss = 0.6× sympathy;
    // Flow = 1.0× passthrough. Apply BEFORE the newE_s mutation so the
    // user-visible delta matches the badge exactly.
    // GATED per-solve (see _activeModeForQuestion): matrix/SR-drawer reviews
    // of uncalibrated questions settle at standard rates even mid-mode.
    const _legacyMode = _activeModeForQuestion(questionObj);
    const _legacyModeCfg = MODE_TUNING[_legacyMode] || MODE_TUNING.standard;
    {
        const isWin = (S === 1);
        const m = isWin ? (_legacyModeCfg.winsMultiplier || 1) : (_legacyModeCfg.lossMultiplier || 1);
        rawDelta = Math.round(rawDelta * m);
    }

    if (rawDelta > 0) {
      // Track hardcore daily use so the cap in _setPracticeMode actually
      // bites on the legacy (uncalibrated) path too — previously only the
      // fast path incremented it, letting hardcore farm uncapped via
      // uncalibrated questions.
      if (_legacyMode === 'hardcore' && S === 1) {
          const today = todayLocalKey();
          if (AppState.hardcoreDailyDate !== today) {
              AppState.hardcoreDailyDate = today;
              AppState.hardcoreDailyCount = 0;
          }
          AppState.hardcoreDailyCount = (AppState.hardcoreDailyCount || 0) + 1;
      }
    }
    let newE_s = Math.max(0, E_s + rawDelta);

    // ── CNS Load: stepped yield multiplier on subject ELO gain only (legacy R_perf path) ──
    // Skip CNS when night guard Tier 3 is active to prevent multiplicative stacking.
    const _ngLegacyForcePre = NightGuard.shouldForceCns();
    if (!_ngLegacyForcePre) {
        const _cnsLegacy = CNSLoad.computeCnsLoad(safeSubject, studySecs);
        const _cnsLgMult = _cnsLegacy.multiplier;
        if (_cnsLgMult < 1.0) {
            const _cnsLgDelta = Math.round(rawDelta * _cnsLgMult);
            newE_s = Math.max(0, E_s + _cnsLgDelta);
        }
        result.cnsLoad = _cnsLegacy.cnsLoad;
        result.cnsMultiplier = _cnsLegacy.multiplier;
        result.cnsBadge = _cnsLegacy.badge;
        result.cnsLabel = _cnsLegacy.label;
        result.cnsTauCap = _cnsLegacy.tauCap;
    }

    // ── Post-23:00 Diminishing Returns Guard (legacy path) ──
    const _ngLegacyMult = NightGuard.getMultiplier();
    if (_ngLegacyMult < 1.0) {
        const _ngLegacyDelta = Math.round(rawDelta * _ngLegacyMult);
        newE_s = Math.max(0, E_s + _ngLegacyDelta);
        result.nightGuardActive = true;
        result.nightGuardMultiplier = _ngLegacyMult;
    }
    if (_ngLegacyForcePre) {
        result.cnsLoad = 1.0;
        result.cnsMultiplier = 0.20;
        result.cnsBadge = '🛌';
        result.cnsLabel = 'CNS force-set: late-night Tier 3';
    }

    if (newE_s > 2999.99) newE_s = 2999.99;
    AppState.elo[safeSubject] = newE_s;
    AppState.eloUpdatedAt = Date.now(); // LWW clock for cloud merge
    _shrinkRdAfterSolve(safeSubject);

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
        questionObj.qElo = (typeof newQ === 'number' && isFinite(newQ)) ? Math.max(0, newQ) : 1200;   // never persist NaN
        if (isAnomaly) questionObj.isAnomaly = true;

        // ── NEW (pre-ELO schema): solve-count + learned-source transition ──
        // Increment solveCount on every legacy-path solve. After
        // CALIBRATED_SOLVE_THRESHOLD solves, the fast-path delta branch
        // takes over and the legacy R_perf warmup is retired. Also flip
        // qEloSource to 'learned' once we've recorded the first solve.
        questionObj.solveCount = (questionObj.solveCount || 0) + 1;
        questionObj.lastSolvedAt = new Date().toISOString();
        if (questionObj.qEloSource !== 'gem-stamped') {
            questionObj.qEloSource = 'learned';
        }

        // ── Memory Kernel v2 commit (runs BEFORE the review stamp so the
        // update sees the true pre-review Δt and rewards low-R recalls). ──
        try {
            updateMemoryOnReview(questionObj, {
                correct: S >= 0.999,
                performanceQ: _proxyPerformanceQ(S_in, tauRaw),
            });
        } catch (_) { /* memory telemetry never blocks scoring */ }

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
    AppState.eloUpdatedAt = Date.now(); // LWW clock for cloud merge

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

    // ── CNS Load: log this solve into rolling accuracy/τ windows ──
    try {
        // scoreOutcome arrives as 1/0 from every caller — comparing it to the string
// 'correct' was ALWAYS false, so CNS telemetry logged every solve as incorrect
// (accuracy-collapse component dead, anti-cheat veto trivially satisfied).
CNSLoad.logSolve(safeSubject, S_in >= 0.999, actualTime || 0, T_avg);
    } catch (_) { /* never block ELO migration */ }

    // Chapter ability vector + closing uncertainty telemetry.
    result.thetaC = _updateChapterTheta(safeSubject, questionObj ? questionObj.chapter : null, S_in);
    result.rdAfter = _rdForSubject(safeSubject);
    result.kEffUsed = _kEff(safeSubject, base.K);

    return result;
}

// ── Calibration Report (slim header strip) ────────────────────────────────
// Rolling metacognitive honesty readout over the last 60 confidence-tagged
// solves: stated certainty vs actual accuracy, Brier score, and a verdict —
// rendered as ONE compact always-visible line in the header (the old full
// dashboard card was removed). Calibration — saying "sure" ONLY when you are
// actually right — is the highest-leverage exam-day skill this app can train.
function _renderCalibrationReport() {
    const el = document.getElementById('calibration-report');
    if (!el) return;
    try { _ensureEloV2State(); } catch (_) {}
    const log = Array.isArray(AppState.calibrationLog) ? AppState.calibrationLog : [];
    if (log.length < 5) {
        el.innerHTML =
            '<span class="calib-kicker">CALIBRATION</span>' +
            '<span class="calib-warmup">Tap your confidence before locking in an answer; the honesty readout unlocks after ~5 graded solves.</span>';
        return;
    }
    const recent = log.slice(-60);
    const n = recent.length;
    const acc = recent.reduce((a, c) => a + c.s, 0) / n;
    const avgP = recent.reduce((a, c) => a + c.p, 0) / n;
    const brier = recent.reduce((a, c) => a + Math.pow(c.p - c.s, 2), 0) / n;
    const gap = avgP - acc;   // >0 overconfident · <0 underconfident
    const verdict = (gap > 0.08)
        ? { txt: 'OVERCONFIDENT', color: '#fda4af', note: 'You say sure when you are not — discount first instincts.' }
        : (gap < -0.08)
            ? { txt: 'UNDERCONFIDENT', color: '#fde047', note: 'You know more than you admit — commit faster.' }
            : { txt: 'CALIBRATED', color: '#4ade80', note: 'Certainty matches reality — exam-ready trait.' };
    const brierColor = brier <= 0.15 ? '#4ade80' : (brier <= 0.25 ? '#fde047' : '#fda4af');
    const meterW = Math.min(50, Math.abs(gap) * 250);
    el.title = 'Calibration Report · rolling last ' + n + ' graded solves · ' + verdict.note;
    el.innerHTML =
        '<span class="calib-kicker">CALIBRATION</span>' +
        '<span class="calib-metric"><b style="color:' + brierColor + '">' + brier.toFixed(3) + '</b><i>BRIER·' + n + '</i></span>' +
        '<span class="calib-sep"></span>' +
        '<span class="calib-metric"><b>' + Math.round(acc * 100) + '%</b><i>ACTUAL</i></span>' +
        '<span class="calib-meter" aria-hidden="true">' +
        '<span class="calib-meter-fill" style="width:' + meterW + '%; background:' + verdict.color + '; ' + (gap >= 0 ? 'left:50%;' : 'right:50%;') + '"></span>' +
        '</span>' +
        '<span class="calib-metric"><b style="color:#c4b5fd">' + Math.round(avgP * 100) + '%</b><i>CLAIMED</i></span>' +
        '<span class="calib-verdict" style="color:' + verdict.color + '; border-color:' + verdict.color + '55;">' + verdict.txt + '</span>';
}
window.renderCalibrationReport = _renderCalibrationReport;

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
    // Exam countdown rides the same HUD cadence (never its own timer).
    try { _updateExamCountdownChip(); } catch (_) {}
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

/**
 * Average rating deviation across subjects → the honest uncertainty of the
 * rank projection. A young/stale profile gets a wide cone and a stabilization
 * note instead of a deceptively precise single number.
 */
function _effectiveGlobalRd() {
    try {
        _ensureEloV2State();
        const subjects = ['physics', 'chemistry', 'maths'];
        const vals = subjects.map(s => {
            const v = Number(AppState.elo.rd && AppState.elo.rd[s]);
            return (isFinite(v) && v > 0) ? v : RD_TUNING.START;
        });
        return Math.round(vals.reduce((a, c) => a + c, 0) / vals.length);
    } catch (_) { return RD_TUNING.START; }
}

function _rdStabilizationNote(effRd) {
    if (effRd >= 200) return 'Early estimate — solve to stabilize';
    if (effRd >= 90) return 'Firming up with every solve';
    return 'Calibrated estimate';
}

function _examCountdownText() {
    try {
        if (!AppState.examDate) return null;
        const t = new Date(AppState.examDate).getTime();
        if (isNaN(t)) return null;
        const days = Math.ceil((t - Date.now()) / 86400000);
        if (days > 0) return days + ' days to exam';
        if (days === 0) return 'EXAM DAY';
        return 'exam done — reset target?';
    } catch (_) { return null; }
}

/** Build (or refresh) the inner content of the AIR popup for a given elo. */
function _airPopupInnerHtml(globalElo) {
    const tier = getRankTierDetails(globalElo);
    const advAir = _computeJeeAdvAir(globalElo);
    const mainAir = _computeJeeMainAir(globalElo);
    const advPct = _formatPercentile(advAir, JEE_ADV_CANDIDATES);
    const mainPct = _formatPercentile(mainAir, JEE_MAIN_CANDIDATES);
    const isLow = advAir >= JEE_ADV_CANDIDATES; // wouldn't clear Advanced cutoff

    // ── Uncertainty cone: project ±effRd through the same log-linear model. ──
    const effRd = _effectiveGlobalRd();
    const eloHi = Math.min(3000, globalElo + effRd);   // optimistic rating
    const eloLo = Math.max(0, globalElo - effRd);      // pessimistic rating
    const airBest = _computeJeeAdvAir(eloHi);          // smaller number = better
    const airWorst = _computeJeeAdvAir(eloLo);
    const showCone = effRd >= 25 && !isLow;

    // Sub-100 gap decomposition anchor: Elo ≈2800 ⇔ AIR ≈100.
    const gapToTop100 = Math.max(0, Math.ceil(2800 - globalElo));
    const examTxt = _examCountdownText();
    const examVal = AppState.examDate || '';

    return `
        <div class="air-pop-head">
            <span class="air-pop-title">🎯 JEE Advanced</span>
            <button class="air-pop-close" type="button" aria-label="Close">✕</button>
        </div>
        <div class="air-pop-body">
            <div class="air-pop-air ${isLow ? 'air-low' : ''}">${_formatAir(advAir)}</div>
            <div class="air-pop-air-label">Predicted AIR</div>
            <div class="air-pop-pct">${isLow ? 'Below cutoff — keep grinding' : advPct}</div>
            ${showCone ? `<div style="margin-top:6px; font-size:10px; color:#8aa0c8;">range ~${_formatAir(Math.min(airBest, airWorst))} – ${_formatAir(Math.max(airBest, airWorst))} · ±${effRd} rd</div>` : ''}
            ${showCone ? `<div style="font-size:9.5px; color:#5d6f96;">${_rdStabilizationNote(effRd)}</div>` : ''}
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
            <div class="air-pop-sec-row">
                <span class="air-pop-sec-label">Top-100 gap</span>
                <span class="air-pop-sec-val" style="${gapToTop100 === 0 ? 'color:#22c55e;' : ''}">${gapToTop100 === 0 ? 'ZONE REACHED' : '-' + gapToTop100 + ' Elo'}</span>
            </div>
            <div class="air-pop-sec-row" style="align-items:center;">
                <span class="air-pop-sec-label">Exam date</span>
                <input type="date" value="${escapeHtml(examVal)}" onchange="window._setExamDate(this.value)"
                       style="background:rgba(255,255,255,0.06); border:1px solid rgba(168,85,247,0.3); border-radius:6px; color:#e4e4e7; font-size:10px; padding:2px 4px; font-family:inherit;">
            </div>
            ${examTxt ? `<div class="air-pop-sec-row"><span class="air-pop-sec-label">Countdown</span><span class="air-pop-sec-val">${escapeHtml(examTxt)}</span></div>` : ''}
        </div>
        <div class="air-pop-foot">
            <span class="air-pop-tier">${tier.icon} ${tier.name}</span>
            <span class="air-pop-elo">${Math.round(globalElo)} Global</span>
        </div>`;
}

/** Persist the exam date and refresh every exam-aware surface. */
window._setExamDate = function (value) {
    try {
        AppState.examDate = value || null;
        saveAllAsync().catch(() => {});
    } catch (_) {}
    _refreshAirPopupIfOpen(AppState.elo.global || 1200);
    try { _updateExamCountdownChip(); } catch (_) {}
};

// ── Exam countdown chip in the sidebar (next to the Global MMR badge) ──────
function _updateExamCountdownChip() {
    const profile = document.querySelector('.user-profile');
    if (!profile) return;
    let chip = document.getElementById('exam-countdown-chip');
    const txt = _examCountdownText();
    if (!txt) { if (chip && chip.parentNode) chip.remove(); return; }
    if (!chip) {
        chip = document.createElement('div');
        chip.id = 'exam-countdown-chip';
        profile.appendChild(chip);
    }
    const urgent = /^(d|[12]d|EXAM)/.test(txt) && txt !== 'exam done — reset target?' && parseInt(txt, 10) <= 30;
    chip.textContent = '⏳ ' + txt;
    chip.style.cssText =
        'margin-top:6px; text-align:center; font-size:10.5px; letter-spacing:.4px; padding:3px 8px;' +
        'border-radius:999px; font-family:\'Space Grotesk\',monospace; font-weight:700;' +
        (urgent
            ? 'color:#fda4af; background:rgba(244,63,94,0.12); border:1px solid rgba(244,63,94,0.35);'
            : 'color:#c4b5fd; background:rgba(168,85,247,0.10); border:1px solid rgba(168,85,247,0.3);');
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
    // Row layout: ride inline in the row header (name + rating on one line).
    // Legacy tile layout fallback: below the progress pill.
    const rowTop = cardEl.querySelector('.tp-row-top');
    const pill = cardEl.querySelector('.distribution-pill');
    if (!rowTop && !pill) return;
    let monitor = cardEl.querySelector('.elo-monitor');
    if (!monitor) {
        monitor = document.createElement('div');
        monitor.className = 'elo-monitor';
        if (rowTop) rowTop.insertBefore(monitor, rowTop.querySelector('.tp-count'));
        else pill.insertAdjacentElement('afterend', monitor);
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
 * Applies a deep crimson background gradient to #view-dashboard and pulses the
 * lowest-performing subject card. (The old warning banner was removed with the
 * cat banner.)
 */
function _applyDeficitLockdown(eP, eC, eM) {
    const minV = Math.min(eP, eC, eM);
    const maxV = Math.max(eP, eC, eM);
    const ratio = maxV > 0 ? minV / maxV : 1;
    const dash = document.getElementById('view-dashboard');
    if (!dash) return;

    const active = ratio < 0.65;

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
        .elo-shift-chip .elo-shift-time,
        .elo-header-chip .elo-shift-time {
            margin-left: 6px; padding: 2px 7px; border-radius: 6px;
            font-size: 11px; letter-spacing: 0.04em; font-weight: 600;
            vertical-align: middle; background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.10);
            display: inline-block; white-space: nowrap;
        }
        .elo-shift-chip .elo-shift-time.time-fast,
        .elo-header-chip .elo-shift-time.time-fast {
            color: #7CFFB2;
            background: rgba(124,255,178,0.14);
            border: 1px solid rgba(124,255,178,0.45);
            box-shadow: 0 0 6px rgba(124,255,178,0.35);
        }
        .elo-shift-chip .elo-shift-time.time-slow,
        .elo-header-chip .elo-shift-time.time-slow {
            color: #FF8585;
            background: rgba(255,133,133,0.14);
            border: 1px solid rgba(255,133,133,0.45);
            box-shadow: 0 0 6px rgba(255,133,133,0.35);
        }
        .elo-shift-chip .elo-shift-time.time-mode,
        .elo-header-chip .elo-shift-time.time-mode {
            color: #E0CFFF;
            background: rgba(160,120,255,0.16);
            border: 1px solid rgba(160,120,255,0.50);
            letter-spacing: 0.06em;
        }
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
    // ── Time-bonus pill (FAST / SLOW / BALANCED) from calculateEloMigration's
    // result.timeBonusFactor attachment. Only renders when meaningful so the
    // chip stays clean on neutral solves. ──
    const timeFactor = (typeof eloResult.timeBonusFactor === 'number') ? eloResult.timeBonusFactor : 1.0;
    const tauShown  = (typeof eloResult.tauSeconds === 'number' && eloResult.tauSeconds > 0) ? eloResult.tauSeconds : null;
    let timeChild = '';
    if (timeFactor >= 1.10)      timeChild = `<span class="elo-shift-time time-fast">FAST ×${timeFactor.toFixed(2)}${tauShown ? ' · ' + Math.round(tauShown) + 's' : ''}</span>`;
    else if (timeFactor <= 0.85) timeChild = `<span class="elo-shift-time time-slow">SLOW ×${timeFactor.toFixed(2)}${tauShown ? ' · ' + Math.round(tauShown) + 's' : ''}</span>`;
    const modeTag = eloResult.modeActive ? `<span class="elo-shift-time time-mode">[${eloResult.modeActive === 'flow' ? '🎯 FLOW' : '⚡ HC'}]</span>` : '';
    const chip = document.createElement('div');
    chip.className = 'elo-shift-chip ' + (delta >= 0 ? 'elo-up' : 'elo-down');
    // Plain-language tooltip [AUDIT P1-10]: unexplained moving numbers read as
    // judgment — say what moved and why, right where it moved.
    chip.title = `${subjLabel} rating ${sign}${Math.round(delta)}. Solved faster than expected → up; slower, harder questions, Flow/Hardcore mode and late-night fatigue all shape it. It is a skill estimate, not a grade.`;
    chip.innerHTML =
        `<span class="elo-shift-delta">${sign}${Math.round(delta)}</span>` +
        `<span class="elo-shift-label">${subjLabel} Elo</span>` +
        `<span class="elo-shift-tier">[${tier.name}]</span>` +
        timeChild + modeTag;
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
        // Clear any PENDING wipe first — two solves within 4.2s otherwise
        // race: the previous chip's timer erases the new chip early.
        if (headerSlot._chipWipeTimer) clearTimeout(headerSlot._chipWipeTimer);
        headerSlot.innerHTML = '';
        const headerChip = document.createElement('div');
        headerChip.className = 'elo-header-chip ' + (delta >= 0 ? 'elo-up' : 'elo-down');
        headerChip.title = `${subjLabel} rating ${sign}${Math.round(delta)} — a live skill estimate shaped by your solve speed, question difficulty and practice mode.`;
        headerChip.innerHTML =
            `<span class="elo-shift-delta">${sign}${Math.round(delta)}</span>` +
            `<span class="elo-shift-tier">[${tier.name}]</span>`;
        headerSlot.appendChild(headerChip);
        // Auto-remove after the animation completes.
        headerSlot._chipWipeTimer = setTimeout(() => { headerSlot.innerHTML = ''; headerSlot._chipWipeTimer = null; }, 4200);
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
            q.subject === subject && (Array.isArray(AppState.currentChapterSelection) && AppState.currentChapterSelection.length
            ? AppState.currentChapterSelection.some(ch => _chaptersMatch(q.chapter, ch))
            : _chaptersMatch(q.chapter, chapter)) && !q.isAnomaly
        );
        if (qs.length === 0) return 1200;
        const sum = qs.reduce((acc, q) => acc + _safeQElo(q), 0);
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

/**
 * Reveal + self-report flow shared by text/subjective questions and any
 * numeric question whose stored answer can't be parsed (ungradeable).
 */
function _enterSelfReportFlow() {
    // ── Freeze the timer NOW — the time spent deciding correct/wrong after
    //    seeing the answer should NOT inflate the ELO temporal divergence calc.
    AppState._frozenTextQSeconds = AppState.practiceSeconds;
    if (AppState.practiceTimer) { clearInterval(AppState.practiceTimer); AppState.practiceTimer = null; }
    AppState.practiceSubmittedFlags[AppState.currentPracticeIndex] = true;
    AppState.currentQ.timeTaken = AppState._frozenTextQSeconds;
    // A reveal alone never marks the question — only the self-report does.
    // Reset 'wrong'/'error' to 'unsolved' so the re-render shows the neutral
    // "Answer revealed — were you right?" banner instead of "❌ Fumbled".
    // Preserve 'solved' ("✅ Clutched" banner is harmless on re-reveal).
    if (AppState.currentQ.status === 'wrong' || AppState.currentQ.status === 'error') {
        AppState.currentQ.status = 'unsolved';
    }
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
}

export function practiceSubmit() {
    if (AppState.practiceSubmittedFlags[AppState.currentPracticeIndex]) return;

    let userAns = "";
    let isCorrect = false;
    // Graded score for the Elo engine — null ⇒ binary (isCorrect ? 1 : 0).
    // Only the multi-select branch computes a fractional JEE-style score.
    let gradedScore = null;

    // ── Guard parity with renderPracticeQuestionModal: an 'mcq' question with
    //    NO options (e.g. legacy rows misclassified during ingestion) is
    //    rendered as a free-response question — so it must ALSO flow through
    //    the self-report path here. Without the options.length check, the
    //    submit button said "Reveal Answer" while practiceSubmit demanded a
    //    selection and blocked the reveal entirely. ──
    if (AppState.currentQ.type === 'mcq' && (AppState.currentQ.options || []).length > 0) {
        const isMulti = Array.isArray(AppState.currentQ.correctAnswer);

        if (isMulti) {
            const selectedOptions = Array.from(
                document.querySelectorAll('.mcq-option.selected')
            ).map(el => decodeOption(el.dataset.option));

            if (selectedOptions.length === 0) {
                alert("Pick at least one option. You can't skip this.");
                return;
            }

            const selectedLetters = selectedOptions.map(opt => {
                const idx = AppState.currentQ.options.indexOf(opt);
                return idx >= 0 ? String.fromCharCode(65 + idx) : null;
            }).filter(Boolean);

            const correctSorted = resolveMcqCorrectLetters(AppState.currentQ).sort();
            const selectedSorted = selectedLetters.slice().sort();

            isCorrect = (
                selectedSorted.length === correctSorted.length &&
                selectedSorted.every((val, i) => val.toLowerCase() === correctSorted[i].toLowerCase())
            );

            // ── Partial-credit score (JEE Advanced multi-marking spirit):
            // each correctly chosen option earns an equal share of the item;
            // every wrong pick cancels one correct choice. Full match → 1.0,
            // half-right → 0.5-ish, any-wrong-heavy → 0. Status/counters stay
            // strictly full-match (a partial never marks the chapter solved).
            const _correctSet = new Set(correctSorted.map(v => String(v).toLowerCase()));
            const _hits = selectedLetters.filter(l => _correctSet.has(String(l).toLowerCase())).length;
            const _wrongs = selectedLetters.length - _hits;
            gradedScore = Math.max(0, (_hits - _wrongs) / Math.max(1, _correctSet.size));
            if (isCorrect) gradedScore = 1;

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
            // Full-option-string answers ("B) \frac{I}{4}") resolve to their
            // leading letter so a correct pick is graded correctly instead of
            // being compared to the whole stored string and always failing.
            isCorrect = resolveMcqCorrectLetters(AppState.currentQ).includes(userAns);
        }

    } else if (AppState.currentQ.type === 'numeric') {
        const numVal = document.getElementById('numeric-answer-input')?.value;
        if (numVal === undefined || numVal === "") {
            alert("Type a number. This ain't multiple choice.");
            return;
        }
        const userNum = parseFloat(numVal);
        const correctNum = parseFloat(AppState.currentQ.correctAnswer);
        // Garbage input ("12..", "abc") parsed to NaN and compared FALSE —
        // graded as a wrong answer with a full Elo/streak penalty. Non-numeric
        // input is a formatting mistake, not a wrong answer: refuse to grade.
        if (!isFinite(userNum)) {
            alert("That's not a number I can read — check the format and try again.");
            return;
        }
        // A non-numeric stored correctAnswer makes every honest answer wrong:
        // treat the question as ungradeable and route into the self-report flow
        // (the old code fell through to the graded path and marked it WRONG).
        if (!isFinite(correctNum)) {
            alert("This question's stored answer isn't numeric — grade yourself below.");
            _enterSelfReportFlow();
            return;
        }
        userAns = userNum.toString();
        isCorrect = Math.abs(userNum - correctNum) < 1e-6;

    } else {
        // ── Self-report flow: any non-MCQ, non-numeric question (text, subjective,
        //    or untyped) gets the reveal + self-report buttons instead of being
        //    auto-marked as incorrect.
        _enterSelfReportFlow();
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
            _directiveMarkSolve(AppState.currentQ, true);
            changeCount(AppState.currentQ.subject, 1);
        }
    } else {
        AppState.currentQ.status = 'wrong';
    }

    // ── Adaptive-mode perf snapshot (captured BEFORE qElo/Elo mutate) ──
    const _modePerf = (AppState.practiceFlowMode && AppState.practiceFlowMode !== 'standard' && !AppState.bountyMode)
        ? {
            qElo: _safeQElo(AppState.currentQ),
            userElo: AppState.elo[_normalizeSubjectKey(AppState.currentQ.subject)] || 1200,
            targetSecs: Math.max(1, _eloTargetSeconds(AppState.currentQ)),
        }
        : null;

    // ── Cognitive MMR: Elo Migration (MCQ / Numeric resolution) ──
    // Synchronous, execution-blocking. Mutates AppState.elo (subject + global)
    // and AppState.currentQ.qElo in-place BEFORE saveAllAsync so the updated
    // ratings persist in the same write cycle.
    let _eloResult = null;
    try {
        _eloResult = calculateEloMigration(
            AppState.currentQ.subject,
            AppState.practiceSeconds,
            (gradedScore != null && !isCorrect) ? gradedScore : (isCorrect ? 1 : 0),
            _getChapterHealth(AppState.currentQ.subject, AppState.currentQ.chapter),
            AppState.currentQ
        );
     } catch (_eloErr) {
     console.error('Elo migration fault:', _eloErr);
 }
 if (_eloResult) applyDifficulty(AppState.currentQ, AppState.currentQ.subject, _eloResult);
 if (AppState.currentQ && AppState.currentQ.status === 'solved') stampPlantCum(AppState.currentQ, AppState.currentQ.subject);
 saveAllAsync().catch(console.error);

    // ── Stop the practice-question timer ──
    // Without this clearInterval, the timer keeps ticking past answer submission,
    // pushing practiceSeconds higher than the actual solve time. The next modal
    // render inherits a stale τ, inflating the slow-penalty / Fast-Slow chip
    // math and contaminating downstream Elo deltas.
    if (AppState.practiceTimer) {
        clearInterval(AppState.practiceTimer);
        AppState.practiceTimer = null;
    }

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

    // ── Adaptive mode: update the difficulty throttle from this outcome and
    // surface the Continue action (the next question is picked on Continue). ──
    if (_modePerf) {
        const _tau = AppState.practiceSeconds / _modePerf.targetSecs;
        _modeNextTargetPwin(AppState.practiceFlowMode, {
            correct: isCorrect,
            tau: _tau,
            qElo: _modePerf.qElo,
            userElo: _modePerf.userElo,
        });
        _showModeContinueButton();
    }

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
        const _modePerfTxt = (AppState.practiceFlowMode && AppState.practiceFlowMode !== 'standard' && !AppState.bountyMode)
            ? { qElo: _safeQElo(AppState.currentQ), userElo: AppState.elo[_normalizeSubjectKey(AppState.currentQ.subject)] || 1200, targetSecs: Math.max(1, _eloTargetSeconds(AppState.currentQ)), secs: AppState._frozenTextQSeconds || AppState.practiceSeconds }
            : null;
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
             } catch (_e) { console.error('Elo migration fault:', _e); }      applyDifficulty(AppState.currentQ, AppState.currentQ.subject, _eloRes);
      stampPlantCum(AppState.currentQ, AppState.currentQ.subject);
     saveAllAsync().catch(console.error);
     if (AppState.bountyMode) {
         evaluateBountyOutcome(true);
            return;
        }
        if (!wasAlreadySolved) {
            _directiveMarkSolve(AppState.currentQ, true);
            changeCount(AppState.currentQ.subject, 1);
        }
        btnContainer.remove();
        const banner = document.createElement('div');
        banner.className = 'result-banner correct';
        banner.innerText = 'Clean lock. Marked correct.';
        container.appendChild(banner);
        if (_eloRes) { try { injectEloShiftChip(_eloRes); } catch (_) { /* ignore */ } }
        try { renderEloMatrix(); } catch (_) { /* ignore */ }
        if (_modePerfTxt) {
            _modeNextTargetPwin(AppState.practiceFlowMode, { correct: true, tau: _modePerfTxt.secs / _modePerfTxt.targetSecs, qElo: _modePerfTxt.qElo, userElo: _modePerfTxt.userElo });
            _showModeContinueButton();
        }
        document.getElementById('practice-submit-btn').style.display = 'none';
    };

    document.getElementById('text-wrong-btn').onclick = () => {
        const _modePerfTxt = (AppState.practiceFlowMode && AppState.practiceFlowMode !== 'standard' && !AppState.bountyMode)
            ? { qElo: _safeQElo(AppState.currentQ), userElo: AppState.elo[_normalizeSubjectKey(AppState.currentQ.subject)] || 1200, targetSecs: Math.max(1, _eloTargetSeconds(AppState.currentQ)), secs: AppState._frozenTextQSeconds || AppState.practiceSeconds }
            : null;
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
             } catch (_e) { console.error('Elo migration fault:', _e); }      applyDifficulty(AppState.currentQ, AppState.currentQ.subject, _eloRes);
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
        if (_modePerfTxt) {
            _modeNextTargetPwin(AppState.practiceFlowMode, { correct: false, tau: _modePerfTxt.secs / _modePerfTxt.targetSecs, qElo: _modePerfTxt.qElo, userElo: _modePerfTxt.userElo });
            _showModeContinueButton();
        }
        document.getElementById('practice-submit-btn').style.display = 'none';
    };

    document.getElementById('practice-submit-btn').style.display = 'none';
}

export function showSolutionPopup() {
    const solutionText = AppState.currentQ.solution;
    if (!solutionText) return;
    const contentEl = document.getElementById('solution-content');
    if (!contentEl) return;
    // Raw text injection — hydrate synchronously (the observer is a backup).
    // Clear any stale render stamp so re-opens with new solutions re-render.
    contentEl.textContent = solutionText;
    // Auto-cropped solution diagram (bound via the 🗺 Diagram Map) renders
    // above the worked solution, same slot the question diagram uses.
    const solutionImgEl = document.getElementById('solution-image');
    if (AppState.currentQ.solutionImageUrl && solutionImgEl) {
        solutionImgEl.src = _safeImgSrc(AppState.currentQ.solutionImageUrl);
        solutionImgEl.style.display = 'block';
    } else if (solutionImgEl) {
        solutionImgEl.style.display = 'none';
    }
    if (contentEl.hasAttribute('data-math-rendered')) contentEl.removeAttribute('data-math-rendered');
    processElementMath(contentEl);
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
    // ── Cognitive Cortex v3: guarantee createdAt exists on the vault entry.
    // This is the PRIMARY error-insertion path (practice fumble → Vault), so
    // age-at-solve priors need a creation anchor even when the question
    // predates cortex or arrived through a non-Gem route. Never overwrites a
    // valid existing stamp. ──
    if (!(typeof AppState.pendingWrongQ.createdAt === 'string' && AppState.pendingWrongQ.createdAt
            && !isNaN(Date.parse(AppState.pendingWrongQ.createdAt)))) {
        AppState.pendingWrongQ.createdAt = new Date().toISOString();
    }
    if (typeof AppState.pendingWrongQ.easeFactor !== 'number' || !isFinite(AppState.pendingWrongQ.easeFactor)) {
        AppState.pendingWrongQ.easeFactor = 2.5;
    }
    saveAllAsync().catch(console.error);
    // Non-blocking confirmation [AUDIT P2]: the old alert() fired mid-practice
    // at the user's emotional low point (just got it wrong) and froze the page
    // until dismissed.
    if (typeof window.__jmaxAppToast === 'function') window.__jmaxAppToast('🗂 Logged to the Vault — it will resurface when memory fades.');
    closeModalStr('error-reason-modal');
    renderErrorMatrixFromBank();
    try { renderChapterDecayGrid(); } catch (_) {}
    renderPracticeQuestionModal();
}

export function practiceNext() {
    // Flow / Hardcore mode: advancement is owned by the Continue button
    // (_modeAdvance) and the Skip action — there is no Next in mode. Guard
    // against stray calls (legacy hooks) so they can't double-advance.
    if (AppState.practiceFlowMode && AppState.practiceFlowMode !== 'standard') return;
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
    // Flow / Hardcore mode: no Prev — review happens on the result screen only.
    if (AppState.practiceFlowMode && AppState.practiceFlowMode !== 'standard') return;
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
    if (AppState.practiceTimer) { clearInterval(AppState.practiceTimer); AppState.practiceTimer = null; }
    // A lifeline pick that never reached a graded solve must not penalize the
    // next unrelated solve with its ×0.65 flag (leaked until the NEXT
    // lifeline/calibrated solve cleared it).
    window.__lastQuestionPickedWithLifeline = false;
    // Calibration hygiene: an un-consumed confidence tap belongs to a question
    // that was never submitted — never let it leak into the next solve.
    window._pendingSolveConfidence = null;
    // A closed modal must not leak its run's navigation history into the next
    // session — without this, a standard session started right after closing a
    // Flow/Hardcore run could inherit stale back/forward stacks.
    _clearModeHistory();
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
        // Tombstone the id so a stale cloud snapshot can never resurrect it.
        recordCloudTombstone(id).catch(console.error);

        await saveAllAsync().catch(console.error);

        if (AppState.questionBank.filter(q => q.subject === AppState.currentSubject && _chaptersMatch(q.chapter, AppState.currentChapter)).length > 0) {
            showQuestionList();
        } else {
            goToChapters();
        }
    }
}

export function triggerRedFlash() {
    if (window.FX && !window.FX.wantEffects()) return;
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
    if (window.FX && !window.FX.wantEffects()) return;
    const layer = document.createElement('div');
    layer.className = 'emoji-layer';
    document.body.appendChild(layer);

    const parts = [];
    for (let i = 0; i < count; i++) {
        const span = document.createElement('span');
        span.className = 'emoji-particle';
        span.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        span.style.fontSize = `${(24 + Math.random() * 16) * scale}px`;
        // ── GPU PARTICLE POSITIONING ──────────────────────────────────────
        // Lock the element's layout box at (0,0) ONCE. From here on, spatial
        // position is driven EXCLUSIVELY by the GPU transform matrix in the
        // rAF loop: translate3d(x,y,0) for translation + translate(-50%,-50%)
        // for self-centering + rotate() + scale() for the death shrink.
        // NEVER mutate style.left / style.top inside the animation tick — that
        // forces the CPU to re-run layout for 40 simultaneous particles every
        // frame, hijacking the main thread and dropping the canvas/streak
        // frames. With transform-only updates the compositor applies a single
        // matrix per particle on the GPU, leaving the main thread idle.
        span.style.left = '0px';
        span.style.top = '0px';
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
            gravity: 0.12 * scale,
            spin: (Math.random() - 0.5) * 0.35,   // per-frame rotation delta
            rot: Math.random() * Math.PI * 2,      // accumulated rotation
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
            p.rot += p.spin;

            // ── Pure GPU transform: translation + self-center + spin + death shrink.
            //    All four components compose on the GPU's transformation matrix;
            //    the CPU main thread never re-enters layout. opacity is a
            //    compositor-only property too, so the whole tick is GPU-bound.
            const s = 0.3 + p.life * 0.7;
            p.el.style.transform =
                'translate3d(' + p.x + 'px,' + p.y + 'px,0) ' +
                'translate(-50%,-50%) ' +
                'rotate(' + p.rot.toFixed(2) + 'rad) ' +
                'scale(' + s.toFixed(3) + ')';
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

/**
 * One shared AudioContext for all one-shot UI SFX. A fresh context per call
 * used to accumulate toward the browser's concurrency cap until ALL sounds
 * silently died mid-session.
 */
function _sharedSfxCtx() {
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (!window.__jmaxSharedAudio) window.__jmaxSharedAudio = new AC();
        if (window.__jmaxSharedAudio.state === 'suspended') {
            window.__jmaxSharedAudio.resume().catch(() => {});
        }
        return window.__jmaxSharedAudio;
    } catch (_) { return null; }
}

function playSuperSound() {
    if (window.FX && !window.FX.wantSound()) return;
    try {
        const ctx = _sharedSfxCtx();
        if (!ctx) return;
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
    if (window.FX && !window.FX.wantEffects()) return;
    const glow = document.createElement('div');
    glow.className = 'green-glow-overlay';
    document.body.appendChild(glow);
    glow.addEventListener('animationend', () => glow.remove());
}

function showSupercharged() {
    const _fxOn = !window.FX || window.FX.wantEffects();   // true when FX absent or effects ON
    if (_fxOn) {
        try {
            const glow = document.createElement('div');
            glow.className = 'supercharged-glow-overlay';
            document.body.appendChild(glow);
            glow.addEventListener('animationend', () => glow.remove());
        } catch (e) { console.error("Glow error:", e); }
    }
    let originX = window.innerWidth / 2;
    let originY = window.innerHeight / 2;
    const srDrawer = document.querySelector('#sr-practice-overlay .sr-practice-modal');
    if (srDrawer && srDrawer.offsetParent !== null) {
        const rect = srDrawer.getBoundingClientRect();
        originX = rect.left + rect.width / 2; originY = rect.top + rect.height / 2;
    } else {
        const modal = document.querySelector('#practice-modal .modal-card');
        if (modal && modal.offsetParent !== null) {
            const rect = modal.getBoundingClientRect();
            originX = rect.left + rect.width / 2; originY = rect.top + rect.height / 2;
        }
    }
    if (_fxOn) {
        try {
            if (typeof burstEmojis === 'function') {
                burstEmojis(originX, originY, 40, ['🎉','😄','🔥','✨','🥳','🎊','💯','🌟','😎','🏆'], 1.6);
            } else {
                const fallback = document.createElement('div');
                fallback.textContent = '✨ CRITICAL HIT ✨';
                fallback.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#c084fc;font-size:32px;font-weight:bold;text-shadow:0 0 20px #8b5cf6;z-index:10000;pointer-events:none;';
                document.body.appendChild(fallback);
                setTimeout(() => fallback.remove(), 800);
            }
        } catch (e) { console.error("burstEmojis error:", e); }
    }
    try { if (typeof playSuperSound === 'function') playSuperSound(); } catch (e) {}   // self-gated by Sound
    if (Math.random() < 0.15 && typeof activateOverheat === 'function') activateOverheat();  // gameplay — never gated
}

function playCorrectSound() {
    if (window.FX && !window.FX.wantSound()) return;
    try {
        const ctx = _sharedSfxCtx();
        if (!ctx) return;
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
    if (window.FX && !window.FX.wantSound()) return;
    try {
        const ctx = _sharedSfxCtx();
        if (!ctx) return;
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
// element (#sr-streak-canvas) while it is open and removes it again on close.
// We scan both and pick the first instance whose layout box is actually
// visible (offsetParent !== null). This lets a single renderLoop drive the
// pixel flame regardless of which practice surface is on screen, with zero
// stale references and no duplicate DOM ids.
function _resolveActiveStreakCanvas() {
    const all = document.querySelectorAll('#streak-canvas, #sr-streak-canvas');
    for (const c of all) {
        if (c.offsetParent !== null) return c;
    }
    // No visible canvas. Return the first match (if any) so callers can detect
    // "element exists but hidden" vs "element missing entirely" if they need to.
    return all[0] || null;
}

function renderLoop(timestamp) {
    // Dynamically resolve the streak canvas on EVERY frame. The SR practice
    // drawer constructs/destroys its DOM on invocation, so any cached reference
    // would go stale.
    const streakCanvas = _resolveActiveStreakCanvas();
    if (!streakCanvas || streakCanvas.offsetParent === null || document.hidden) {
        // No visible canvas on this tick (or the tab is backgrounded) — stop
        // the loop entirely instead of spinning at 60fps forever (battery).
        // _ensureStreakLoop() restarts it when a canvas actually appears.
        particles = [];
        currentFrame = 0;
        lastTime = 0;
        currentIntensity = 0.62;
        _streakRafScheduled = false;
        return;
    }
    // ── Accelerated 2D context ──
    // { alpha:true } keeps the canvas composited with transparency so the
    // pixel-flame can overlay the modal header. { desynchronized:true } lets
    // the GPU present the framebuffer out-of-band with the DOM event loop,
    // halving input→pixels latency on ProMotion displays. willReadFrequently
    // is explicitly FALSE so the browser keeps the canvas on the GPU texture
    // fast-path instead of forcing a readback-CPU bitmap (which would stall
    // the compositor every frame).
    const streakCtx = streakCanvas.getContext('2d', {
        alpha: true, desynchronized: true, willReadFrequently: false,
    });
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

// Kick off the render loop on demand only — it self-stops when no visible
// canvas exists (battery), so starting it before any drawer/modal opens costs
// exactly one cheap no-op frame.
function _ensureStreakLoop() {
    if (_streakRafScheduled) return;
    _streakRafScheduled = true;
    requestAnimationFrame(renderLoop);
}

// Restart the loop when a streak canvas enters the DOM (SR practice drawer
// injects #sr-streak-canvas dynamically) or when the practice modal opens.
try {
    new MutationObserver(() => {
        if (document.getElementById('streak-canvas') || document.getElementById('sr-streak-canvas')) {
            _ensureStreakLoop();
        }
    }).observe(document.documentElement, { childList: true, subtree: true });
} catch (_) {}
document.addEventListener('visibilitychange', () => { if (!document.hidden) _ensureStreakLoop(); });
window._ensureStreakLoop = _ensureStreakLoop;

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
            // NOTE: no changeCount() here — wrong answers must not inflate the
            // daily solved counter / error-matrix totals / streak data.
            triggerRedFlash();
            playWrongSound();
            AppState._ckComboBreak = true; // FIX: combo always breaks on a miss

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
                // Wrong follow-up answer — deliberately NOT counted as solved.
                triggerRedFlash();
                playWrongSound();
                AppState._ckComboBreak = true; // FIX: combo always breaks on a miss

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

// ==================== DAILY ROLLOVER ====================
// Counter reset shared by the boot path and the live midnight watcher,
// so a tab left open across midnight also resets the daily counts.
//
// ── Day-settlement sentinel (fixes same-day counter wipes) ────────────────
// The daily reset used to be gated on `jeemax_last_calibrated_date`, which is
// ONLY written when the user completes the vibe check. Skipping the daily
// briefing left it stale, so a SAME-DAY reopen fired runNewDayCycle() and
// zeroed today's solved + studySecs counters in IndexedDB. This dedicated key
// records the last day the cycle ACTUALLY completed and is the boot gate
// instead. For pre-fix installs it seeds from the daily-briefing guard
// (jeemax_boot_seq_date) — that key is only ever written by runNewDayCycle's
// maybeShow, i.e. it IS "the last day the cycle ran" — so the first post-fix
// boot can't wipe a same-day session either.
const LS_BRIEFING_GUARD = 'jeemax_boot_seq_date';

async function _markDaySettled(todayStr) {
    try { localStorage.setItem(LS_LAST_SETTLED, todayStr); } catch (_) {}
    try { await idbSet(LS_LAST_SETTLED, todayStr); } catch (_) {}
}

async function _readLastSettledDay() {
    // IDB is the source of truth; the LS mirror covers private-mode/eviction.
    try {
        const idb = await idbGet(LS_LAST_SETTLED);
        if (typeof idb === 'string' && idb) return idb;
    } catch (_) {}
    try {
        const ls = localStorage.getItem(LS_LAST_SETTLED);
        if (ls) return ls;
    } catch (_) {}
    // Pre-fix installs: the briefing guard is the last day the cycle ran.
    try {
        const legacy = localStorage.getItem(LS_BRIEFING_GUARD);
        if (legacy) return legacy;
    } catch (_) {}
    return null;
}

async function runNewDayCycle(todayStr) {
    // ── Deload Engine: auto-fire forced deload before the day turns ──
    // Runs at midnight so the forced deload takes effect for the day being
    // settled. The CNS_LOAD consecutive-day check uses yesterday's data.
    try {
        if (typeof DeloadEngine !== 'undefined') {
            const _forcedCheck = DeloadEngine.isForcedDeloadEligible();
            if (_forcedCheck.eligible) {
                DeloadEngine.triggerForcedDeload();
            }
        }
    } catch (_) {}

    // Flush tracking parameters for the new daily matrix cycle
    snapshotCumDayStart();
    // ── CNS Load: reset per-day session tracking at midnight ──
    try { CNSLoad.resetDaily(); } catch (_) {}
    // ── Night Guard: reset dismissal flag at midnight ──
    try { NightGuard.resetDaily(); } catch (_) {}
    // Fold yesterday's live counters into the permanent ledger BEFORE zeroing
    // them: a solve at 23:59:59 whose save lands after the reset would
    // otherwise be credited to neither day (or pollute the fresh day).
    const _prevDay = new Date();
    _prevDay.setDate(_prevDay.getDate() - 1);
    try { await settleDayCounters(_prevDay.getFullYear() + '-' + String(_prevDay.getMonth() + 1).padStart(2, '0') + '-' + String(_prevDay.getDate()).padStart(2, '0')); } catch (_) {}
    // ── Daily Directive: grade + archive yesterday's contract, retune DDA ──
    // Must run AFTER the ledger settles (final LU is already in) and BEFORE
    // the new day's state exists; ensureToday() recomputes the contract.
    try { await Directive.settle(); } catch (_) {}
    solved.physics = 0;
    solved.chemistry = 0;
    solved.maths = 0;
    studySecs.physics = 0;
    studySecs.chemistry = 0;
    studySecs.maths = 0;

    await saveAllAsync().catch(console.error);
    // Mark the day settled ONLY after the zeroing+save committed — a crash
    // mid-cycle must not skip the next boot's cycle (re-running is idempotent:
    // settleDayCounters takes a max, and the counters are already zero).
    try { await _markDaySettled(todayStr); } catch (_) {}
    // ── Daily Directive: compute the NEW day's contract (capacity uses the
    // persisted mood until the briefing recalibrates it). Must run after
    // settle() so the retired day is archived first. ──
    try { await Directive.ensureToday(); } catch (_) {}
    updateUI();

    // ── Daily Briefing boot sequence ──
    // The cyberpunk intro overlay (mood step folds in from P3) replaces the
    // bare Vibe Check popup after the daily reset. Falls back to the Vibe
    // Check modal if the module isn't ready, so calibration never drops.
    if (window.BootSequence && typeof window.BootSequence.maybeShow === 'function') {
        try { window.BootSequence.maybeShow(); } catch (_) { openModal('mood-modal'); }
    } else {
        openModal('mood-modal');
    }
}

// Live midnight rollover watcher: an app left open across midnight resets the
// daily counters without a reload (same new-day cycle as the boot path).
let _midnightWatcherStarted = false;
function startMidnightRolloverWatcher() {
    if (_midnightWatcherStarted) return;
    _midnightWatcherStarted = true;
    let lastSeen = todayLocalKey();
    const checkRollover = () => {
        const now = todayLocalKey();
        if (now !== lastSeen) {
            lastSeen = now;
            runNewDayCycle(now).catch(() => {});
        }
    };
    setInterval(checkRollover, 30000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) checkRollover();
    });
    window.addEventListener('focus', checkRollover);
}

// ==================== INITIALIZATION ====================
async function initApp() {
    // Register UI callbacks so storage.js can call back into app.js
    // ── View-gated hot-reloads ──
    // changeCount() fires renderGraph + renderErrorMatrixFromBank on EVERY
    // solve. When the user is inside the practice modal neither view is on
    // screen, yet each call rebuilds the whole SVG / error-card DOM — that
    // grows with the bank and is pure waste on a slow iPad. Gate each heavy
    // render to its own view-section; switchTab() re-renders on entry, so
    // nothing ever goes stale.
    const _viewActive = (viewId) => {
        const v = document.getElementById('view-' + viewId);
        return !!(v && v.classList.contains('active'));
    };
    registerUiCallbacks({
        lockTargetsOnly,
        updateUI,
        // Daily Directive chokepoint: every changeCount unit flows through here
        // so LU pricing can't miss a path (practice, SR fix, stepper, mock, bounty).
        onSolveLogged: (subject, delta) => {
            try { Directive.onSolveLogged(subject, delta); } catch (_) { /* never block counters */ }
        },
        updateStudyTimeHeader: () => {
            import('./pomodoro.js').then(m => m.updateStudyTimeHeader());
        },
        renderGraph: () => { if (_viewActive('dashboard')) renderGraph(); },
        renderErrorMatrixFromBank: () => {
            if (_viewActive('errors')) import('./matrix.js').then(m => m.renderErrorMatrixFromBank());
        },
    });

    await loadDataAsync();

    // Restore the permanent daily solved-count store from IndexedDB (merge into
    // localStorage + today's live counters), in case localStorage was cleared.
    try { await restoreDailyForestFromIDB(); } catch (_) {}

    // ── One-time cross-chapter duplicate cleanup ──
    // The bank is hydrated above; silently remove any copies the old
    // chapter-scoped dedupe spread across chapters. Idempotent + non-blocking.
    _autoPurgeDuplicateQuestions();

    // Verify day rollover — gated on the LAST ACTUALLY-SETTLED day, NOT the
    // mood-calibration date. The old gate (jeemax_last_calibrated_date) is
    // only written when the user completes the vibe check; a same-day reopen
    // after skipping the briefing left it stale and runNewDayCycle() wiped
    // today's solved/studySecs counters in IndexedDB.
    // NOTE: the Directive boot below must stay AFTER this check — on a day
    // turn, runNewDayCycle settles (archives) the directive state, and an
    // ensureToday() that ran first would create an empty "today" that then
    // got archived as a false miss.
    const todayStr = todayLocalKey();
    const lastSettled = await _readLastSettledDay();

    if (lastSettled !== todayStr) {
        await runNewDayCycle(todayStr);
    }

    // ── Daily Directive: compute (or restore) today's contract. This replaces
    // the old manual quota inputs + 24h lock — contracts are derived from the
    // trailing ledger, mood/sleep capacity and Cortex due-pressure, then
    // AppState.activeTargets is derived from the contract so every legacy
    // visual (heatmap, candles, streak) flows from v2 targets. Idempotent:
    // after a rollover, runNewDayCycle already created today's state. ──
    try {
        await Directive.ensureToday();
        Directive.renderSettingsPanel();
    } catch (e) { console.error('Directive boot fault:', e); }
    try {
        document.addEventListener('jmax:directive-updated', () => { updateUI().catch(() => {}); });
    } catch (_) {}

    restoreDailyCountsIntoSolved();
    // Boot-perf [AUDIT P2]: don't block the rest of init (graph, HUD, widgets)
    // on the save coalescer's 600ms trailing window. The commit still lands —
    // pagehide/visibilitychange flush guarantees it — the UI just stops
    // waiting for it.
    saveAllAsync().catch(console.error);
    startMidnightRolloverWatcher();

    document.getElementById('vis-beaker').style.display = 'none';
    document.getElementById('vis-bar').style.display = 'block';

    const d = new Date();
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    document.getElementById('top-date').textContent =
        `${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;

    await renderGraph();
    updateUI();

    // ── Daily Bounty: assign today's (if due) and surface the rail trigger.
    // Boot used to assign silently with zero reachable opener — dead feature.
    try { assignDailyBountyIfNeeded(); } catch (_) {}
    try { refreshBountyRail(); } catch (_) {}

    // Restore the last-used pomodoro setup (subject / study / break / rounds /
    // stopwatch / dynamic) onto the Focus Mode inputs BEFORE resetPomoUI paints
    // the idle timer display, so the shown duration matches the restored config.
    try { applyPomoConfig(); } catch (_) { /* never block initApp */ }
    resetPomoUI();
    updateStreakVisualizer();

    // ── Cognitive MMR Matrix: explicit initial hydration. updateUI() above
    // already calls renderEloMatrix(), but we re-run it here after the full
    // init pipeline so the profile row + subject monitors are guaranteed to
    // exist even if the dashboard DOM wasn't fully painted during updateUI. ──
    try { renderEloMatrix(); } catch (_) { /* never block initApp */ }

    // NEW: initialise the error resolution dashboard once data is ready.
    // Guarded — a corrupt historyLog.timestamp or a missing container must
    // never abort initApp (the global math watchdog attaches independently).
    try {
        renderErrorResolutionDashboard();
        if (typeof renderMomentumCandles === 'function') renderMomentumCandles();
    } catch (_) { /* never block initApp */ }

    // Listen for Protocol Zero penalty events from checkpoint.js → re-render
    // the main predictive graph so the red valley appears immediately.
    window.addEventListener('checkpoint:penalty', function () {
        if (typeof renderGraph === 'function') renderGraph();
        if (typeof renderErrorResolutionDashboard === 'function') renderErrorResolutionDashboard();
        if (typeof renderMomentumCandles === 'function') renderMomentumCandles();
    });

    // Initialize Google Drive
    try {
        await initDrive();
    } catch (err) {
        // Drive auth is optional (Google Identity Services CDN may be blocked
        // offline/on some networks). A failure here must NEVER kill boot or
        // the global math watchdog — everything after this point is
        // non-essential chrome.
        console.warn('[initApp] Drive init skipped:', err);
    }

    // ── Daily Briefing: self-gated launch on EVERY boot ──
    // maybeShow() checks jeemax_boot_seq_date internally, so this no-ops on
    // same-day reopens. It used to be reachable ONLY from runNewDayCycle —
    // meaning a briefing whose settle-marker landed before the overlay mounted
    // (or whose guard key was cleared) could never appear on a settled day.
    try {
        if (window.BootSequence && typeof window.BootSequence.maybeShow === 'function') {
            window.BootSequence.maybeShow();
        }
    } catch (_) { /* never block initApp */ }
}

document.addEventListener('DOMContentLoaded', initApp);


// ==================== AI MATRIX DUMP (Export raw data for Google Gemini) ====================

/**
 * Populate the AI Dump modal with subject→chapter checkboxes.
 * Called lazily when the modal opens.
 */
window.populateAiDumpChapters = function () {
    const listEl = document.getElementById('ai-dump-chapter-list');
    if (!listEl) return;

    // Collect ALL unique subject+chapter combos from the full question bank
    const map = {};
    AppState.questionBank.forEach(q => {
        const subj = q.subject || 'Uncategorized';
        const ch = q.chapter || 'Uncategorized';
        const key = subj + '||' + ch;
        if (!map[key]) map[key] = { subject: subj, chapter: ch, count: 0, errorCount: 0 };
        map[key].count++;
        if (q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong')) {
            map[key].errorCount++;
        }
    });

    const entries = Object.values(map);
    if (entries.length === 0) {
        listEl.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">No chapters found. Add some questions first.</p>';
        return;
    }

    // Group by subject
    const bySubject = {};
    entries.forEach(e => {
        if (!bySubject[e.subject]) bySubject[e.subject] = [];
        bySubject[e.subject].push(e);
    });

    const icons = { physics: '🌌', chemistry: '🧪', maths: '📐' };
    // Mock Studio linking context → pre-check only that subject's chapters so the
    // report (and any dump pasted next) scopes to the panel being filled.
    const ctxSubj = AppState.mockDraftContext ? String(AppState.mockDraftContext.subject || '').toLowerCase() : null;
    let html = ctxSubj
        ? '<div class="rp-banner">🔗 Mock-link active — scoping to <b>' + escapeHtml(ctxSubj.toUpperCase()) + '</b>; other subjects unchecked.</div>'
        : '';
    for (const [subj, chapters] of Object.entries(bySubject)) {
        html += `<div style="margin-bottom:12px;">`;
        html += `<div style="font-weight:700;font-size:14px;margin-bottom:4px;color:var(--accent-primary);">${icons[subj]||'📋'} ${escapeHtml(subj.toUpperCase())}</div>`;
        chapters.forEach(c => {
            const id = `dump-${subj}-${String(c.chapter).replace(/[^a-zA-Z0-9]/g,'_')}`;
            html += `<label style="display:flex;align-items:center;gap:8px;padding:4px 6px;font-size:13px;cursor:pointer;border-radius:4px;">
                <input type="checkbox" ${(!ctxSubj || subj.toLowerCase() === ctxSubj) ? 'checked' : ''} data-dump-subj="${escapeAttribute(subj)}" data-dump-chapter="${escapeAttribute(c.chapter)}" id="${escapeAttribute(id)}" style="accent-color:var(--accent-primary);">
                ${escapeHtml(c.chapter)} <span style="color:var(--text-muted);font-size:11px;margin-left:auto;">${c.count} Qs${c.errorCount > 0 ? ' · ' + c.errorCount + ' err' : ''}</span>
            </label>`;
        });
        html += `</div>`;
    }
    listEl.innerHTML = html;

    // Live smart-report preview: recompute whenever the scope checkboxes change.
    if (!listEl.dataset.rpWired) {
        listEl.dataset.rpWired = '1';
        listEl.addEventListener('change', () => window.renderAiDumpPreview());
    }
    window.renderAiDumpPreview();
};

/** Select or deselect all chapter checkboxes. */
window.selectAllDumpChapters = function (select) {
    const checks = document.querySelectorAll('#ai-dump-chapter-list input[type="checkbox"]');
    checks.forEach(cb => { cb.checked = select; });
    window.renderAiDumpPreview();
};

/**
 * Shared scope gatherer for the AI Dump modal: reads the checked chapter
 * checkboxes into a flat, enriched question list plus its human label.
 * Returns null when nothing is selected (alerts unless silent=true — the
 * live preview passes silent and shows an inline nudge instead).
 */
function _gatherDumpScopeQuestions(silent) {
    const checks = document.querySelectorAll('#ai-dump-chapter-list input[type="checkbox"]:checked');
    if (checks.length === 0) {
        if (!silent) alert('Select at least one chapter to export.');
        return null;
    }

    const selected = [];
    checks.forEach(cb => {
        selected.push({
            subject: cb.getAttribute('data-dump-subj'),
            chapter: cb.getAttribute('data-dump-chapter'),
        });
    });

    // Gather ALL questions in selected chapters (with or without errors — full context)
    const results = [];
    const raw = []; // untouched bank objects — what the report engine consumes
    selected.forEach(({ subject, chapter }) => {
        const qs = AppState.questionBank.filter(q =>
            (q.subject || '').toLowerCase() === subject.toLowerCase() &&
            (q.chapter || '').toLowerCase() === chapter.toLowerCase()
        );
        qs.forEach((q, idx) => {
            raw.push(q);
            const historySummary = (q.historyLogs || []).map(log => {
                let ft = log.frictionTypes || [];
                if (typeof ft === 'string') {
                    try { ft = JSON.parse(ft); } catch (_) { ft = [ft]; }
                }
                if (!Array.isArray(ft)) ft = [];
                return {
                    date: log.timestamp ? log.timestamp.slice(0, 10) : 'unknown',
                    result: log.result || 'unknown',
                    autonomy: log.autonomy || 'unknown',
                    timeMins: log.timeSpentMins || 0,
                    friction: ft.join(', ') || 'none',
                };
            });

            results.push({
                index: idx + 1,
                subject: q.subject || 'unknown',
                chapter: q.chapter || 'unknown',
                questionText: q.extractedText || '(no text)',
                options: q.options || [],
                correctAnswer: q.correctAnswer || '',
                type: q.type || 'text',
                solution: q.solution || '(no solution)',
                hint: q.hint || '(no hint)',
                errorReason: q.errorReason || 'none',
                status: q.status || 'unknown',
                tags: q.tags || [],
                qElo: _safeQElo(q),
                easeFactor: (typeof q.easeFactor === 'number' && isFinite(q.easeFactor)) ? q.easeFactor : 2.5,
                currentInterval: Number(q.currentInterval) || 0,
                isMastered: q.isMastered || false,
                attemptTimeline: historySummary,
                totalAttempts: historySummary.length,
            });
        });
    });

    if (!results.length) {
        alert('No questions found in selected chapters.');
        return null;
    }
    return { selected, results, raw };
}

// ═══ Smart Mistake Report — live inline preview + compact download (primary) ═══

/**
 * Render the aggregated tag × difficulty analysis directly under the chapter
 * list. Silent nudge when nothing is checked; recomputed by the change
 * listener wired in populateAiDumpChapters().
 */
window.renderAiDumpPreview = function () {
    const box = document.getElementById('ai-dump-report-preview');
    if (!box) return;
    const scope = _gatherDumpScopeQuestions(true);
    if (!scope) {
        box.innerHTML = '<div class="rp-empty">Tick some chapters above — the analysis builds itself here.</div>';
        return;
    }
    const scopeLabel = scope.selected.map(s => s.subject + ' › ' + s.chapter).join(', ');
    const report = buildMistakeReport(scope.raw, {
        scopeText: scopeLabel,
        elo: AppState.elo || {},
        // ── Cognitive Cortex v3: per-tag leak chips in the tag leaderboard.
        // Profiles are recomputed over the scoped slice (cheap, pure) so the
        // preview stays honest to exactly what the user ticked. ──
        tagLeakFn: (label) => {
            try {
                const { profiles } = computeTagProfiles(scope.raw, {});
                return leakOf(profiles, 'p:' + normalizeTag(label));
            } catch (_) { return null; }
        },
    });
    box.innerHTML = renderReportHtml(report, { maxTags: 12 });
};

/** Download the compact aggregated mistake report (.txt) — bounded size. */
window.exportSmartReport = function () {
    const scope = _gatherDumpScopeQuestions(false);
    if (!scope) return;
    const scopeLabel = scope.selected.map(s => s.subject + ' › ' + s.chapter).join(', ');
    const report = buildMistakeReport(scope.raw, {
        scopeText: scopeLabel,
        elo: AppState.elo || {},
    });
    // Local day key via the shared helper — en-CA can emit non-ISO shapes on
    // odd ICU builds (see deload.js note); every module must agree on the form.
    const dateStr = todayLocalKey();
    const blob = new Blob([renderReportText(report)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jeemaxxing-smart-report-${dateStr}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    closeModalStr('ai-dump-modal');
};

// ═══ Raw bank JSON — demoted to secondary; feeds Gem/LLM paste workflows ═══

/** Download the full per-question raw data as .json (legacy export, JSON-only). */
window.exportRawBankJson = function () {
    const scope = _gatherDumpScopeQuestions(false);
    if (!scope) return;
    const dateStr = todayLocalKey(); // shared local YYYY-MM-DD helper
    const payload = {
        generatedAt: new Date().toISOString(),
        scope: scope.selected.map(s => s.subject + ' › ' + s.chapter),
        totalQuestions: scope.results.length,
        questions: scope.results,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jeemaxxing-raw-bank-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    closeModalStr('ai-dump-modal');
};

/**
 * Shared duplicate-finder for the "questions copied across chapters" bug:
 * pasting the same dump while on different chapters used to create one bank
 * copy per chapter (the old dedupe key was chapter-scoped). Groups the bank by
 * the (now chapter-independent) key and returns every index AFTER the first
 * copy of each group, so the first copy — and its practice history — survives.
 */
function _findDuplicateQuestionIndexes() {
    const bank = AppState.questionBank;
    const seen = new Set();
    const dupIndexes = [];
    for (let i = 0; i < bank.length; i++) {
        const key = _questionDedupeKey(bank[i].subject, bank[i].chapter, bank[i]);
        if (!key) continue;
        if (seen.has(key)) dupIndexes.push(i);
        else seen.add(key);
    }
    return dupIndexes;
}

/**
 * One-time cleanup utility (manual button in the AI Dump modal). Confirms
 * before touching anything.
 */
window.purgeDuplicateQuestions = function () {
    const dupIndexes = _findDuplicateQuestionIndexes();
    if (dupIndexes.length === 0) {
        alert('No duplicates found — your bank is clean.');
        return;
    }
    if (!confirm(`Found ${dupIndexes.length} duplicate question${dupIndexes.length !== 1 ? 's' : ''} (same text, possibly in different chapters). Keep the first copy of each and remove the rest?`)) return;
    for (let i = dupIndexes.length - 1; i >= 0; i--) {
        AppState.questionBank.splice(dupIndexes[i], 1);
    }
    saveAllAsync().catch(console.error);
    try { renderChaptersList(); } catch (_) {}
    try { showQuestionList(); } catch (_) {}
        (window.__jmaxAppToast || alert)(`🧹 Purged ${dupIndexes.length} duplicate question${dupIndexes.length !== 1 ? 's' : ''}. Bank now holds ${AppState.questionBank.length} questions.`);
};

/**
 * Boot-time auto-cleanup: runs once after the bank hydrates in initApp().
 * Silently removes any cross-chapter copies left over from the pre-dedupe-fix
 * era (keeps the first copy of each group so practice history survives), then
 * re-saves. Idempotent — a clean bank is just an O(n) no-op scan.
 */
function _autoPurgeDuplicateQuestions() {
    try {
        const bank = AppState.questionBank;
        if (!Array.isArray(bank) || bank.length < 2) return;
        const dupIndexes = _findDuplicateQuestionIndexes();
        if (dupIndexes.length === 0) return;
        const byChapter = {};
        dupIndexes.forEach(i => {
            const ch = bank[i].chapter || 'Uncategorized';
            byChapter[ch] = (byChapter[ch] || 0) + 1;
        });
        for (let i = dupIndexes.length - 1; i >= 0; i--) bank.splice(dupIndexes[i], 1);
        saveAllAsync().catch(console.error);
        try { renderChaptersList(); } catch (_) {}
        console.warn('[auto-purge] Removed', dupIndexes.length,
            'cross-chapter duplicate question(s):', byChapter,
            '— bank now holds', bank.length, 'questions.');
    } catch (err) {
        // Never let cleanup break boot.
        console.warn('[auto-purge] skipped:', err);
    }
}

// ==================== WINDOW GLOBAL WIRING ====================
window.switchTab = switchTab;
window.toggleSidebar = toggleSidebar;
window.openModal = openModal;
window.closeModal = closeModal;
window.closeModalStr = closeModalStr;
window.openBountyModal = openBountyModal;
window.openDailyBounty = openDailyBounty;
window.refreshBountyRail = refreshBountyRail;
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

// ── Daily Directive UI surface (inline onclick handlers in index.html) ──────
window.DIRECTIVE_UI = {
    spin: () => { try { Directive.openSpin('The box opens…'); } catch (_) {} },
    recalibrate: async () => {
        try {
            await Directive.recalibrateCapacity();
            Directive.renderSettingsPanel();
            if (typeof window.__jmaxAppToast === 'function') window.__jmaxAppToast('⚡ Contracts recomputed from your trailing ledger + capacity.');
        } catch (_) {}
    },
    useRestToken: () => {
        try {
            if (!Directive.consumeRestToken()) return;
            if (typeof window.scheduleDeloadFromUi === 'function') window.scheduleDeloadFromUi();
            else if (typeof window.__jmaxAppToast === 'function') window.__jmaxAppToast('🌿 Rest Token spent — schedule your Earned Rest from the Config panel.');
            Directive.renderSettingsPanel();
        } catch (_) {}
    },
};
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
window.openMultiChapterMode = openMultiChapterMode;
window.startMultiChapterMode = startMultiChapterMode;
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
    // ── DOM attachment prevents garbage-collection of the orphaned <input>
    // before the native file-picker dialog returns. Without this, some
    // environments (ES module scope, strict CSP, mobile WebViews) reclaim the
    // element and the onchange callback never fires → "nothing happens".
    dynamicInput.style.display = 'none';
    document.body.appendChild(dynamicInput);
    dynamicInput.onchange = async (event) => {
        // ── Always clean up the temp element, success or failure ──
        try { dynamicInput.remove(); } catch (_) { /* already removed */ }
        try {
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
        } catch (err) {
            console.error('[triggerSurgicalDiagramUpload] Failed:', err);
            hideLoading();
            // Restore the preview modal so the user isn't stuck
            try { showPreviewModal(); } catch (_) {}
        }
    };
    dynamicInput.click();
};

window.yeetSurgicalDiagram = function(index) {
    AppState.extractedItems[index].diagramImageUrl = null;
    showPreviewModal();
};

// ── Gem Diagram Auto-Crop Map bridges (inline onclick hooks in index.html) ──
window.openGemImageMappingModal = openGemImageMappingModal;
window.skipGemImageMapping = skipGemImageMapping;
window.applyGemImageCrops = applyGemImageCrops;
window.copyGemImageInstructions = copyGemImageInstructions;
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
window.applyPomoConfig = applyPomoConfig;
window.readPomoConfig = readPomoConfig;
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
window.answerMathHTML = answerMathHTML;
window.processElementMath = processElementMath;
window.deleteQuestion = deleteQuestion;
window.handleDriveAuth = handleDriveAuth;
window.updateStreakDisplay = updateStreakDisplay;
window.executeUnifiedSync = executeUnifiedSync;
window.toggleStopwatchMode = toggleStopwatchMode;
window.toggleDynamicSubject = toggleDynamicSubject;
window.changeStudySubject = changeStudySubject;
// Unlock the pomodoro AudioContext inside a user gesture (the Daily Briefing
// flow needs it to arm the timer from a click, not a timer callback).
window.initAudioContext = initAudioContext;
window.toggleImmersive = toggleImmersive;
window.confirmTimerNotification = confirmTimerNotification;
window.toggleMiniWidget = toggleMiniWidget;
// ── Ambient Sprint Widget + focus ledger (inline onclicks in index.html) ──
window.startSprintFromWidget = startSprintFromWidget;
window.openPomoPop = openPomoPop;
window.closePomoPop = closePomoPop;
window.popSetSubject = popSetSubject;
window.popAdjustMinutes = popAdjustMinutes;
window.popAdjustRounds = popAdjustRounds;
window.popStart = popStart;
window.notifyKeepGoing = notifyKeepGoing;
window.widgetPauseToggle = widgetPauseToggle;

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
window.srRevealAnswer = srRevealAnswer;
window.srToggleImage = srToggleImage;
window.srToggleHint = srToggleHint;
window.toggleCardHistory = toggleCardHistory;
window.renderErrorResolutionDashboard = renderErrorResolutionDashboard;
window.renderChapterDecayGrid = renderChapterDecayGrid;
window.renderChapterProgressList = renderChapterProgressList;
window.openChapterProgress = openChapterProgress;
window.renderMomentumCandles = renderMomentumCandles;

// Expose state for debugging / cross-module access
window.bounty = AppState.bounty;

// ── Forest sync fix: expose live state safely ─────────────────────────────
window.AppState = AppState;
// Expose mode tuning (used by the Daily Briefing mode-gate, e.g. the hardcore
// per-day cap) so the flow can't drift from the engine's real constants.
window.MODE_TUNING = MODE_TUNING;
window.solved = solved;

try {
  Object.defineProperty(window, 'questionBank', {
    get: function () {
      return AppState.questionBank;
    },
    set: function (v) {
      try {
        AppState.questionBank = v;
      } catch (e) {}
    },
    configurable: true
  });
} catch (e) {
  window.questionBank = AppState.questionBank;
}
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
 * Consume a balanced bracket group starting at `start` (which must hold the
 * opening char). Returns the index just past the matching close, or the end
 * of the string if unbalanced.
 */
function _skipBalanced(text, start, open, close) {
    let depth = 0;
    let k = start;
    while (k < text.length) {
        if (text[k] === open) depth++;
        else if (text[k] === close) { depth--; if (depth === 0) return k + 1; }
        k++;
    }
    return k;
}

/**
 * Defensive pass: Gem dumps frequently emit raw LaTeX WITHOUT $...$ delimiters
 * (e.g. `\Delta m \implies \frac{5}{4}`). The delimiter regex below can never
 * match those, so they'd render as literal raw text. This scanner walks the
 * string and wraps each bare `\command` (+ optional args/sub/superscripts) in
 * $...$, while leaving already-delimited math ($$...$$, $...$, \[...\], \(...\))
 * completely untouched so nothing double-wraps.
 */
function _wrapBareLatex(text) {
    if (typeof text !== 'string' || !/\\[a-zA-Z]/.test(text)) return text;
    const n = text.length;
    let out = '';
    let i = 0;
    while (i < n) {
        const c = text[i];
        if (c === '$') {
            // Preserve existing $...$ / $$...$$ fragments untouched.
            if (text[i + 1] === '$') {
                const k = text.indexOf('$$', i + 2);
                if (k !== -1) { out += text.slice(i, k + 2); i = k + 2; continue; }
            } else {
                const k = text.indexOf('$', i + 1);
                if (k !== -1) { out += text.slice(i, k + 1); i = k + 1; continue; }
            }
            out += c; i++; continue;
        }
        if (c === '\\' && (text[i + 1] === '(' || text[i + 1] === '[')) {
            const close = text[i + 1] === '(' ? '\\)' : '\\]';
            const k = text.indexOf(close, i + 2);
            if (k !== -1) { out += text.slice(i, k + 2); i = k + 2; continue; }
        }
        if (c === '\\' && text.slice(i, i + 7) === '\\begin{') {
            // Nested-environment-aware: wrap the WHOLE \\begin{env}...\\end{env}
            // block as ONE math unit. A naive "stop at the first \\end{...}"
            // breaks on nested environments (e.g. a \\begin{cases} inside an
            // \\begin{align}) — it would cut the block short and leave the
            // outer \\end{align} orphaned as red raw source. So we track the
            // \\begin{ / \\end{ nesting depth and stop at the OUTERMOST
            // matching \\end{env}.
            const envOpen = /^\\begin\{([^}]*)\}/.exec(text.slice(i));
            if (envOpen) {
                let depth = 1;
                let idx = i + envOpen[0].length;
                const scan = /\\begin\{([^}]*)\}|\\end\{([^}]*)\}/g;
                scan.lastIndex = idx;
                let m, endIdx = -1;
                while ((m = scan.exec(text)) !== null) {
                    if (m[1] !== undefined) { depth++; }
                    else { depth--; if (depth === 0) { endIdx = m.index; break; } }
                }
                if (endIdx !== -1) {
                    const endOpen = /\\end\{([^}]*)\}/.exec(text.slice(endIdx));
                    const endLen = endOpen ? endOpen[0].length : 2;
                    const end = endIdx + endLen;
                    out += '$$' + text.slice(i, end) + '$$';
                    i = end;
                    continue;
                }
            }
        }
        if (c === '\\' && /[a-zA-Z]/.test(text[i + 1] || '')) {
            let j = i + 1;
            while (j < n && /[a-zA-Z]/.test(text[j])) j++;
            if (text[j] === '*') j++;
            if (text[j] === '[') j = _skipBalanced(text, j, '[', ']');
            while (text[j] === '{') j = _skipBalanced(text, j, '{', '}');
            while (text[j] === '_' || text[j] === '^') {
                j++;
                if (text[j] === '{') j = _skipBalanced(text, j, '{', '}');
                else if (text[j] && text[j] !== ' ') j++;
            }
            out += '$' + text.slice(i, j) + '$';
            i = j;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}
window._wrapBareLatex = _wrapBareLatex;

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
    // Also accepts \(...\) inline and \[...\] display — textbook/Gem dumps
    // often emit those instead of dollar delimiters.
    const MATH_REGEX = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^\$]+)\$|\\\(([\s\S]+?)\\\)/g;

    try {
        // ── Collect every text node that contains at least one math fragment ──
        // PERF [measured]: this walker ran during every background text
        // mutation storm and `closest('.katex')` executed PER TEXT NODE —
        // an ancestor-chain crawl that dominated profiles (~30% of all CPU
        // on large banks). Order now: free content fast-path FIRST (the vast
        // majority of text nodes hold no $ or \ at all), and the ancestor
        // stamp/katex check LAST, bounded, only for actual candidates.
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function (node) {
                    const val = node.nodeValue;
                    if (!val) return NodeFilter.FILTER_REJECT;
                    // Fast path: no math delimiters and no LaTeX commands ⇒ reject
                    // without touching the ancestor chain.
                    if (val.indexOf('$') === -1 && val.indexOf('\\') === -1) return NodeFilter.FILTER_REJECT;
                    MATH_REGEX.lastIndex = 0;
                    const hasDelimited = MATH_REGEX.test(val);
                    MATH_REGEX.lastIndex = 0;
                    // Accept nodes with delimited math OR bare \command LaTeX
                    // (the auto-wrap pass handles the delimiter-less ones).
                    if (!hasDelimited && !/\\[a-zA-Z]/.test(val)) return NodeFilter.FILTER_REJECT;
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    const tag = parent.tagName;
                    if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
                    // Candidate nodes only: verify they're not inside rendered
                    // KaTeX output. Bounded walk (≤6 levels) covers the sealed
                    // [data-math-rendered] wrapper KaTeX output always sits in,
                    // without an unbounded closest() per candidate.
                    //
                    // FIX: the walk MUST stop at the scan root (the element arg).
                    // The init sweep stamps document.body with data-math-rendered,
                    // and the practice modal's #latex-render text nodes sit
                    // exactly 5 ancestor levels under body — inside the old
                    // bound — so body's stale sweep stamp silently vetoed EVERY
                    // question stem in the practice modal (and the solution
                    // popup / vault drawer, which are just as shallow). Stamps
                    // ABOVE the subtree being processed never mean "this text
                    // is already rendered" — only sealed wrappers INSIDE it do.
                    let anc = parent;
                    for (let depth = 0; anc && anc !== element && depth < 6; depth++) {
                        if (anc.classList && anc.classList.contains('katex')) return NodeFilter.FILTER_REJECT;
                        if (anc.nodeType === Node.ELEMENT_NODE && anc.hasAttribute('data-math-rendered')) return NodeFilter.FILTER_REJECT;
                        anc = anc.parentNode;
                    }
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
            // Auto-wrap delimiter-less \command fragments ($\frac{1}{2}$ etc.)
            // so Gem output that skips the dollar signs still hydrates.
            const wrapped = _wrapBareLatex(raw);
            // Rebuild the hydrated string segment-by-segment: the plain-text
            // gaps BETWEEN math fragments are HTML-escaped, and only KaTeX's
            // own output is spliced in as markup. The old single .replace()
            // fed the untouched source text to innerHTML, so any bank content
            // combining HTML with $…$ materialized live markup (stored XSS).
            MATH_REGEX.lastIndex = 0;
            let hydrated = '';
            let lastIdx = 0;
            let mm;
            while ((mm = MATH_REGEX.exec(wrapped)) !== null) {
                hydrated += escapeHtml(wrapped.slice(lastIdx, mm.index));
                const dbl = mm[1], brk = mm[2], inl = mm[3], paren = mm[4];
                if (!dbl && !brk && !inl && !paren) {
                    hydrated += escapeHtml(mm[0]);
                } else {
                    const block = dbl || brk;
                    const inline = inl || paren;
                    try {
                        hydrated += window.katex.renderToString(block || inline, {
                            throwOnError: false,
                            displayMode: !!block
                        });
                    } catch (e) {
                        // Malformed LaTeX — preserve the original source (escaped)
                        // so the rest of the document renders normally.
                        hydrated += escapeHtml(mm[0]);
                    }
                }
                lastIdx = mm.index + mm[0].length;
            }
            hydrated += escapeHtml(wrapped.slice(lastIdx));

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
//
// PERF [measured]: this handler used to call processElementMath SYNCHRONOUSLY
// per added node — and the TEXT_NODE branch swept whole large subtrees every
// time any counter/clock ticked. On a big vault board that meant continuous
// full-subtree TreeWalkers several times per second (30%+ total CPU, seconds
// of main-thread blocking). Now: candidates are deduped into a Set and
// flushed ONCE per animation frame; oversized roots defer to idle time so a
// frame is never hijacked.
const _mathQueue = new Set();
let _mathFlushScheduled = false;
function _flushMathQueue() {
    _mathFlushScheduled = false;
    const big = [];
    for (const el of _mathQueue) {
        _mathQueue.delete(el);
        if (!el || !el.isConnected) continue;
        // Cheap size probe — huge roots (whole-view re-renders) go to idle
        // time instead of hijacking this frame.
        let count = 0;
        try { count = el.getElementsByTagName('*').length; } catch (_) { count = 0; }
        if (count > 2500) { big.push(el); continue; }
        processElementMath(el);
    }
    if (big.length) {
        setTimeout(function () {
            for (const el of big) { try { processElementMath(el); } catch (_) {} }
        }, 300);
    }
}
function _queueMath(el) {
    _mathQueue.add(el);
    if (!_mathFlushScheduled) {
        _mathFlushScheduled = true;
        requestAnimationFrame(_flushMathQueue);
    }
}

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
                _queueMath(node);
            } else if (node.nodeType === Node.TEXT_NODE) {
                // A raw text node was injected (e.g. element.textContent = ...).
                // Process its parent — but first clear any stale render stamp
                // so dynamic re-renders (like #solution-content) are picked up.
                const parent = node.parentElement;
                if (!parent) continue;
                if (parent.hasAttribute('data-math-rendered')) {
                    parent.removeAttribute('data-math-rendered');
                }
                _queueMath(parent);
            }
        }
    }
});

// ============================================================================
// KATEX ARRIVAL WATCHDOG — late-load self-heal
// ============================================================================
// KaTeX is vendored locally (vendor/katex) so it normally arrives before this
// module runs. But if the file is missing/corrupt, a stale PWA cache serves
// old HTML, or a CDN-style failure happens anyway, `window.katex` is undefined
// and BOTH render paths silently no-op (no stamp is written in that case).
// Previously the poll gave up after 30s, so even a slow load left every
// $...$ fragment raw forever. This watchdog now re-sweeps the whole body the
// moment katex lands — no matter how late — and keeps checking at a cheap
// cadence instead of giving up.
(function () {
    if (window.katex) return;
    if (window.console && console.warn) {
        console.warn('[math] KaTeX not loaded at boot — polling for arrival; math will hydrate the moment it lands.');
    }
    // One-time dismissible banner so a permanently-missing KaTeX is visible to
    // the user instead of silently leaving every $...$ fragment raw.
    let bannerShown = false;
    const showBanner = function () {
        if (bannerShown || document.getElementById('math-failure-banner')) return;
        bannerShown = true;
        try {
            const d = document.createElement('div');
            d.id = 'math-failure-banner';
            d.textContent = '⚠ Math engine failed to load — formulas show as raw text. Reopen the app with internet once.';
            Object.assign(d.style, {
                position: 'fixed', left: '50%', bottom: '14px', transform: 'translateX(-50%)',
                zIndex: '2147483000', background: 'rgba(20,16,8,.95)',
                border: '1px solid rgba(255,178,36,.5)', color: '#ffd9a0',
                padding: '10px 30px 10px 14px', borderRadius: '12px',
                font: '13px/1.5 system-ui, sans-serif', maxWidth: '92vw',
                boxShadow: '0 10px 30px rgba(0,0,0,.65)'
            });
            const close = document.createElement('button');
            close.textContent = '✕';
            close.setAttribute('aria-label', 'Dismiss');
            Object.assign(close.style, {
                position: 'absolute', top: '4px', right: '6px', background: 'none',
                border: 'none', color: '#ffd9a0', fontSize: '14px', cursor: 'pointer',
                padding: '2px 4px'
            });
            close.addEventListener('click', function () { d.remove(); });
            d.appendChild(close);
            document.body.appendChild(d);
            setTimeout(function () { if (d.parentNode) d.remove(); }, 30000);
        } catch (_) { /* banner is cosmetic — never break boot */ }
    };
    let waited = 0;
    const sweep = function () {
        try { processElementMath(document.body); } catch (_) {}
    };
    // CDN fallback: if the vendored KaTeX file failed to load (onerror flag)
    // or is missing from a stale PWA cache, inject a cache-busted jsdelivr
    // copy and re-sweep the instant it lands. Best-effort, never breaks boot.
    let fallbackInjected = false;
    const injectKatexFallback = function () {
        if (fallbackInjected || window.katex) return;
        fallbackInjected = true;
        try {
            const stamp = Date.now();
            const css = document.createElement('link');
            css.rel = 'stylesheet';
            css.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css?v=' + stamp;
            document.head.appendChild(css);
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js?v=' + stamp;
            s.onload = function () { if (window.katex) sweep(); };
            document.head.appendChild(s);
        } catch (_) { /* best-effort — never break boot */ }
    };
    if (window.__katexLoadFailed) injectKatexFallback();
    const poll = setInterval(function () {
        waited += 500;
        if (window.katex) {
            clearInterval(poll);
            sweep();
        } else if (waited === 8000) {
            injectKatexFallback();
            showBanner();
        } else if (waited > 30000) {
            // Slow-loading or blocked — re-check every 2s, but STOP the moment
            // KaTeX lands (the old slow-poll swept the whole body forever).
            clearInterval(poll);
            const slowPoll = setInterval(function () {
                if (window.katex) {
                    clearInterval(slowPoll);
                    sweep();
                }
            }, 2000);
        }
    }, 500);
})();

// ── Boot attach — fully independent of initApp() ─────────────────────────
// initApp() runs a long async chain (IndexedDB load, cloud sync, Drive auth,
// dashboard renders) that can throw or hang. The watchdog used to activate at
// the very END of that chain; if ANY earlier step failed, the observer never
// attached and every $...$ fragment stayed raw forever. Attaching here on
// DOMContentLoaded (module scope, zero awaits) guarantees the observer is
// live regardless of what happens to initApp().
document.addEventListener('DOMContentLoaded', function () {
    if (!document.body) return;
    globalMathObserver.observe(document.body, { childList: true, subtree: true });
    processElementMath(document.body);
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
    // ── Cached canvas bounding rect ────────────────────────────────────────
    // getBoundingClientRect() forces a synchronous layout flush. Calling it
    // on every pointermove (and every coalesced 240Hz sub-event) during a fast
    // Apple Pencil stroke injects forced reflow into the input critical path,
    // which is exactly the mid-stroke stutter on WebKit. We snapshot the rect
    // ONCE at pointerdown and reuse it for the whole stroke, invalidating it
    // only on resize / orientationchange. The canvas is position:fixed at the
    // viewport origin while active, so its rect is stable for the stroke
    // lifetime — provably correct, and removes N-1 layout flushes per stroke.
    let _canvasRectCache = null;
    function invalidateCanvasRect() { _canvasRectCache = null; }
    function getCanvasRect() {
        if (_canvasRectCache) return _canvasRectCache;
        _canvasRectCache = canvas.getBoundingClientRect();
        return _canvasRectCache;
    }
    function getCanvasPoint(e) {
        // Map pointer into canvas coordinate space via the cached bounding rect.
        // Robust to any offset/zoom/containing-block drift; the cache is
        // snapped at pointerdown so rapid coalesced pointermoves never force a
        // layout flush, keeping the drawing offset gap-free even under fast
        // horizontal Pencil dashes.
        const rect = getCanvasRect();
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
        // ── Snap the bounding rect for the entire stroke. Every subsequent
        //    pointermove (incl. all coalesced 240Hz sub-events) will reuse this
        //    cached rect instead of forcing a fresh getBoundingClientRect()
        //    layout flush on the input critical path.
        invalidateCanvasRect();
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
        // A resize wipes the canvas geometry → the cached bounding rect is stale.
        invalidateCanvasRect();
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
        // ── Accelerated 2D contexts for both scratchpad surfaces ──
        // { alpha:true }      → keep transparency so the dimmed workspace shows
        //                       through the ink layers.
        // { desynchronized:true } → bypass the DOM event-loop presentation
        //                       queue; the GPU presents each framebuffer out-of-
        //                       band, minimising pencil-tip→ink latency.
        // { willReadFrequently:false } → keep each canvas on the GPU texture
        //                       fast-path. The scratchpad never calls
        //                       getImageData() during drawing, so a readback-CPU
        //                       bitmap would only stall the compositor.
        ctx = canvas.getContext('2d', {
            alpha: true, desynchronized: true, willReadFrequently: false,
        });
        bgCtx = bgCanvas.getContext('2d', {
            alpha: true, desynchronized: true, willReadFrequently: false,
        });
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

// ============================================================================
//  LOOP-RAIL NAVIGATION  (append-only, self-wiring)
//  Sidebar progression navigation (loop rail, badges, beacons). The practice
//  modal cockpit was removed; the original header layout is left untouched.
// ============================================================================
(function CK_ENGINE() {
  if (window.__ckEngine) return; window.__ckEngine = true;

  const LS_SHIELDS = 'jeemax_ck_shields';
  const CK = {
    built: false, sessionOpen: false,
    combo: 0, sessionCorrect: 0, sessionTarget: 1, lastStreak: 0,
    crit: 0, critPrimed: false,
    shields: 0,
    tickerIdx: 0, tickerAt: 0,
    last: {},           // text de-dup cache
    navBuilt: false, slowAt: 0,
  };
  try { CK.shields = Math.max(0, parseInt(localStorage.getItem(LS_SHIELDS) || '0', 10) || 0); } catch (e) { CK.shields = 0; }
  const persistShields = () => { try { localStorage.setItem(LS_SHIELDS, String(CK.shields)); } catch (e) {} };

  // ── Error visibility ──
  // These ticks used to swallow every error silently — engine breakage was
  // fully invisible. Log the first failure, then throttle to one console
  // entry per 10s so a persistent fault can't spam the console.
  let _ckErrAt = 0;
  const ckErr = (e) => {
    const now = Date.now();
    if (now - _ckErrAt > 10000) {
      _ckErrAt = now;
      console.error('[CK engine tick]', e);
    }
  };

  const $ = (id) => document.getElementById(id);
  const setT = (id, t) => { if (CK.last[id] === t) return; CK.last[id] = t; const e = $(id); if (e) e.textContent = t; };
  const setRing = (id, p, c) => { const e = $(id); if (!e) return; e.style.setProperty('--p', Math.max(0, Math.min(100, p))); if (c) e.style.setProperty('--ring-c', c); };
  const totalSolved = () => (solved.physics || 0) + (solved.chemistry || 0) + (solved.maths || 0);

  // ---- Cockpit removed: the practice-modal header keeps its original layout ----
  function buildCockpit() {
    CK.built = true;
  }

  function critPayout() {
    try { if (typeof window.showSupercharged === 'function') window.showSupercharged(); } catch (e) {}
    try { if (typeof window.playSuperSound === 'function') window.playSuperSound(); } catch (e) {}
    CK.shields += 1; persistShields();
  }

  // ---- Fast tick: derives session / combo / crit state from live state ----
  function fastTick() {
    try {
      const modal = $('practice-modal');
      const modalActive = !!(modal && modal.classList.contains('active'));

      if (modalActive) {
        if (!CK.sessionOpen) {
          CK.sessionOpen = true; CK.combo = 0; CK.sessionCorrect = 0;
          CK.lastStreak = AppState.practiceCorrectStreak || 0;
          CK.sessionTarget = Math.max(1, (AppState.practiceQuestions && AppState.practiceQuestions.length) || 1);
          CK.crit = 0; CK.critPrimed = false;
        }
        // FIX: event-driven combo break — fires even when a rare streak-freeze
        // shield saves the flame, so a wrong answer ALWAYS drops the combo.
        if (AppState._ckComboBreak) {
          AppState._ckComboBreak = false;
          CK.combo = 0; CK.critPrimed = false;
        }
        const st = AppState.practiceCorrectStreak || 0;
        if (st > CK.lastStreak) {
          if (CK.critPrimed) { critPayout(); CK.critPrimed = false; CK.crit = 0; }
          const inc = st - CK.lastStreak;
          CK.combo += inc;
          CK.sessionCorrect = Math.min(CK.sessionTarget, CK.sessionCorrect + inc);
          CK.crit = Math.min(100, CK.crit + 34);
          if (CK.crit >= 100) CK.critPrimed = true;
          if (CK.combo > 0 && CK.combo % 5 === 0) { CK.shields += 1; persistShields(); }
        } else if (st < CK.lastStreak && CK.lastStreak > 0) {
          // FIX: a broken streak ALWAYS resets the combo. Persisted shields now
          // save the CRIT charge, never the combo — previously shields silently
          // swallowed every miss and the combo never reset.
          CK.combo = 0; CK.critPrimed = false;
          if (CK.shields > 0) {
            CK.shields -= 1; persistShields();
          } else {
            CK.crit = Math.max(0, CK.crit - 50);
          }
        }
        CK.lastStreak = st;
      } else {
        CK.sessionOpen = false;
      }
    } catch (e) { ckErr(e); }
  }

  // ---- Navigation helpers ----
  function ckNavItem(tab, label) {
    let el = document.querySelector('.nav-item[data-tab="' + tab + '"]');
    if (!el) [...document.querySelectorAll('.nav-item')].forEach(n => { if ((n.textContent || '').indexOf(label) >= 0) el = n; });
    return el;
  }
  function buildNav() {
    if (CK.navBuilt) return;
    const sb = $('sidebar'); if (!sb) return;
    const logo = sb.querySelector('.logo-container');

    const loop = document.createElement('div');
    loop.className = 'nav-ck-loop';
    loop.innerHTML =
      '<div class="nav-ck-loop-title">TODAY\'S LOOP <span class="nav-ck-risk" id="nav-ck-risk">close it to keep the streak</span></div>' +
      '<div class="nav-ck-arcs">' +
        arc('p', 'P', '#3ddcff') + arc('c', 'C', '#22c55e') + arc('m', 'M', '#ffb224') + arc('f', '✓', '#a78bfa') +
      '</div>';
    if (logo && logo.nextSibling) logo.parentNode.insertBefore(loop, logo.nextSibling); else sb.appendChild(loop);

    const profile = sb.querySelector('.user-profile');
    if (profile) {
      const ladder = document.createElement('div');
      ladder.className = 'nav-ck-ladder';
      ladder.id = 'nav-ck-ladder';
      profile.appendChild(ladder);
    }
    CK.navBuilt = true;
  }
  function arc(key, label, color) {
    return '<div class="nav-ck-arc"><div class="ck-ring nav-ck-ring" id="nav-ck-arc-' + key + '" style="--ring-c:' + color + '"><div class="ck-ring-hole"><span class="nav-ck-arc-lbl">' + label + '</span></div></div></div>';
  }

  // ── Incremental "fixed today" counter ──
  // ckFixToday() used to rescan EVERY history log of EVERY question on every
  // navHeavy recompute — O(bank × 30 logs) of Date.parse churn on the 1s tick.
  // Now it's a per-day cache: seeded once per day with a single full scan, then
  // bumped in O(1) by the same hook matrix.js calls when a correct SR log is
  // committed (__ckBumpTodayFix). The per-second tick becomes a pure cache hit.
  const _fixDayKey = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  let _fixCache = { day: '', counts: { physics: 0, chemistry: 0, maths: 0 } };
  function _scanFixToday() {
    const d = new Date();
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayEnd = dayStart + 86400000;
    const c = { physics: 0, chemistry: 0, maths: 0 };
    for (const q of AppState.questionBank) {
      if (!q.historyLogs) continue;
      for (const l of q.historyLogs) {
        if (l && l.result === 'correct' && l.timestamp) {
          const t = typeof l.timestamp === 'string' ? Date.parse(l.timestamp) : l.timestamp;
          if (t >= dayStart && t < dayEnd) {
            const s = (q.subject || '').toLowerCase(); if (s in c) c[s]++;
          }
        }
      }
    }
    return c;
  }
  function ckFixToday() {
    const day = _fixDayKey();
    if (_fixCache.day !== day) _fixCache = { day, counts: _scanFixToday() };
    return _fixCache.counts;
  }
  // Called by matrix.js submitPracticeLog on every correct SR log commit.
  window.__ckBumpTodayFix = (subject) => {
    try {
      const day = _fixDayKey();
      if (_fixCache.day !== day) _fixCache = { day, counts: _scanFixToday() };
      const s = String(subject || '').toLowerCase();
      if (s in _fixCache.counts) _fixCache.counts[s]++;
      // Nudge the memoized nav derivation so the ring reflects it promptly.
      try { window.__jmaxDataDirty = (window.__jmaxDataDirty || 0) + 1; } catch (_) {}
    } catch (e) {}
  };
  function ckReadyCount() {
    let n = 0;
    for (const q of AppState.questionBank) {
      if (q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong')) {
        try { if (getDueStatus(q).status === 'ready') n++; } catch (e) {}
      }
    }
    return n;
  }
  function ckLowHealth() {
    const map = {};
    for (const q of AppState.questionBank) {
      if (q.errorReason && (q.status === 'error' || q.status === 'solved' || q.status === 'wrong')) {
        const k = (q.subject || '') + '||' + (q.chapter || ''); (map[k] = map[k] || { s: q.subject, c: q.chapter });
      }
    }
    let worst = null;
    for (const k in map) { const h = _getChapterHealth(map[k].s, map[k].c); if (h < 45 && (worst === null || h < worst.h)) worst = { h: h, c: map[k].c }; }
    return worst;
  }

  // ── Memoized heavy derivations ──────────────────────────────────────────
  // ckFixToday / ckReadyCount / ckLowHealth each scan the ENTIRE question
  // bank (and every history log). refreshNav() runs every second and slowTick
  // every 4s — with a big bank that is constant O(n·logs) main-thread work
  // forever. Now they recompute only when (a) data changed via saveAllAsync
  // (window.__jmaxDataDirty) or (b) 30s TTL elapsed (keeps hour-of-day /
  // midnight drift correct). The per-second tick becomes a pure cache hit.
  const NAV_HEAVY_TTL = 30000;
  const NAV_HEAVY_MIN_INTERVAL = 2000; // even when dirty, rescan at most every 2s
  let _navHeavy = { at: 0, dirty: -1, fix: null, ready: 0, low: null };
  function navHeavy() {
    const dirty = (typeof window.__jmaxDataDirty === 'number') ? window.__jmaxDataDirty : 0;
    const now = Date.now();
    if (_navHeavy.fix !== null && now - _navHeavy.at <= NAV_HEAVY_TTL) {
      // ckFixToday is now O(1)-cached, but ckReadyCount/ckLowHealth still scan
      // the bank. A dirty bump (per save) must not trigger a full rescan on
      // the very next 1s tick — enforce a floor so a solve burst costs one
      // rescan instead of one per second.
      if (dirty === _navHeavy.dirty || now - _navHeavy.at < NAV_HEAVY_MIN_INTERVAL) {
        return _navHeavy;
      }
    }
    _navHeavy = { at: now, dirty, fix: ckFixToday(), ready: ckReadyCount(), low: ckLowHealth() };
    return _navHeavy;
  }
  function setBadge(tab, label, n, glow) {
    const item = ckNavItem(tab, label); if (!item) return;
    let b = item.querySelector('.nav-ck-badge');
    if (n > 0) {
      if (!b) { b = document.createElement('span'); b.className = 'nav-ck-badge'; item.appendChild(b); }
      b.textContent = n; b.classList.toggle('glow', !!glow);
    } else if (b) { b.remove(); }
  }
  function setBeacon(tab, label, on) {
    const item = ckNavItem(tab, label); if (!item) return;
    let d = item.querySelector('.nav-ck-beacon');
    if (on) { if (!d) { d = document.createElement('span'); d.className = 'nav-ck-beacon'; item.insertBefore(d, item.firstChild); } }
    else if (d) { d.remove(); }
  }

  function refreshNav() {
    try {
      buildNav();
      const sb = $('sidebar'); if (!sb) return;
      const tgt = AppState.activeTargets || baseTargets || {};
      const heavy = navHeavy();
      const fix = heavy.fix;
      const bt = baseErrorTargets || {};
      setRing('nav-ck-arc-p', tgt.physics ? Math.min(100, (solved.physics / tgt.physics) * 100) : 0);
      setRing('nav-ck-arc-c', tgt.chemistry ? Math.min(100, (solved.chemistry / tgt.chemistry) * 100) : 0);
      setRing('nav-ck-arc-m', tgt.maths ? Math.min(100, (solved.maths / tgt.maths) * 100) : 0);
      const fixTot = (fix.physics + fix.chemistry + fix.maths), fixTgt = (bt.physics + bt.chemistry + bt.maths) || 1;
      setRing('nav-ck-arc-f', Math.min(100, (fixTot / fixTgt) * 100));

      const loopDone = (solved.physics >= (tgt.physics || 1)) && (solved.chemistry >= (tgt.chemistry || 1)) && (solved.maths >= (tgt.maths || 1)) && fixTot >= fixTgt;
      const loop = sb.querySelector('.nav-ck-loop'); if (loop) loop.classList.toggle('ck-loop-done', loopDone);

      const atRisk = new Date().getHours() >= 18 && totalSolved() === 0;
      sb.classList.toggle('ck-streak-danger', atRisk);
      const riskText = atRisk ? '🚨 STREAK AT RISK — solve 1 now' : (loopDone ? '🌌 LOOP CLOSED' : 'close it to keep the streak');
      const risk = $('nav-ck-risk'); if (risk && risk.textContent !== riskText) risk.textContent = riskText;

      // tier ladder mini-map — only rewrite DOM when the rungs actually change
      // (this innerHTML churn every 1s also fired the global Math observer,
      // which tree-walked the sidebar on every tick).
      const ladder = $('nav-ck-ladder');
      if (ladder && typeof ELO_RANK_TIERS !== 'undefined') {
        const elo = (AppState.elo && AppState.elo.global) || 1200;
        const cur = getRankTierDetails(elo).name;
        const idx = ELO_RANK_TIERS.findIndex(t => elo >= t.min && elo <= t.max);
        const show = ELO_RANK_TIERS.slice(Math.max(0, idx - 1), idx + 2);
        const html = show.map(t => '<div class="nav-ck-rung' + (t.name === cur ? ' here' : '') + '"><span class="nav-ck-rung-ic">' + t.icon + '</span><span class="nav-ck-rung-nm">' + t.name + '</span></div>').join('');
        if (ladder.getAttribute('data-rungs') !== html) {
          ladder.setAttribute('data-rungs', html);
          ladder.innerHTML = html;
        }
      }

      // beacons
      const mini = $('pomo-mini-widget');
      setBeacon('pomodoro', 'Focus Mode', !!(mini && !mini.classList.contains('hidden')));
      setBeacon('practice', 'Grind Station', CK.sessionOpen && CK.sessionCorrect > 0);
    } catch (e) { ckErr(e); }
  }
  function slowTick() {
    try {
      const heavy = navHeavy();
      setBadge('errors', 'The Vault', heavy.ready, true);
      const low = heavy.low;
      const pItem = ckNavItem('practice', 'Grind Station');
      if (pItem) pItem.classList.toggle('nav-ck-pulse', !!low);
    } catch (e) { ckErr(e); }
  }

  function boot() {
    if (!document.body) { requestAnimationFrame(boot); return; }
    buildCockpit(); buildNav(); refreshNav(); slowTick();
    setInterval(fastTick, 250);
    setInterval(() => { refreshNav(); }, 1000);
    setInterval(slowTick, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();