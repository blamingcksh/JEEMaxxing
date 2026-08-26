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

// ── Memory Kernel v2 + Cognitive Cortex v3 + Chapter-Weights resolver —
// canonical pure implementations (zero DOM deps, Node-testable).
import { backfillMemoryFields } from './memory.js';
import { migrateCortexFields } from './cortex.js';
import {
    resolveChapterWeight as _resolveCW,
    DEFAULT_CHAPTER_WEIGHT as _DEFAULT_CHAPTER_W,
} from './chapter-weights.js';

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

// ── Multi-tab write reconciliation ──────────────────────────────────────────
// Two tabs each hold their own AppState copy; last-commit-wins used to make
// one tab's solves silently vanish (audit item [11]). When a save commits we
// broadcast a lightweight ping on a BroadcastChannel; every OTHER open tab
// merges the monotonic daily counters upward and pulls in any question ids
// this tab created (tombstone-aware, mirroring the cloud merge). The tabId
// stamp filters our own echo (BroadcastChannel also delivers to the poster),
// so there is no ping-pong and no time-cooldown that could drop a real update.
const TAB_SYNC_CHANNEL = 'jmax-tab-sync';
let _tabChannel = null;
// Per-tab identity stamped on every broadcast so we can drop our own echo
// (BroadcastChannel delivers to the posting context too) without relying on
// a time-based cooldown that could also swallow a real update from a sibling.
const _tabId = (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : 'tab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

function _broadcastTabSaved() {
    try {
        if (typeof BroadcastChannel === 'undefined') return;
        if (!_tabChannel) _tabChannel = new BroadcastChannel(TAB_SYNC_CHANNEL);
        _tabChannel.postMessage({
            type: 'jmax-saved',
            tabId: _tabId,
            at: Date.now(),
            solved: { physics: solved.physics, chemistry: solved.chemistry, maths: solved.maths },
            studySecs: { physics: studySecs.physics, chemistry: studySecs.chemistry, maths: studySecs.maths },
        });
    } catch (_) { /* BroadcastChannel unavailable (private mode / old WebKit) — no reconciliation, as before */ }
}

function _listenTabSync() {
    try {
        if (typeof BroadcastChannel === 'undefined') return;
        const ch = new BroadcastChannel(TAB_SYNC_CHANNEL);
        ch.onmessage = async (e) => {
            const msg = e && e.data;
            if (!msg || msg.type !== 'jmax-saved') return;
            // Never process our own echo — the data is already in our state.
            if (msg.tabId === _tabId) return;
            // A sibling committed — its bank write may carry per-question
            // updates we don't have. _doSaveAll adopts them before its own
            // full-bank rewrite so an idle tab can never clobber a sibling.
            _foreignCommitPending = true;
            try {
                // Daily counters are monotonic within a day — merge upward.
                let changed = false;
                for (const k of ['physics', 'chemistry', 'maths']) {
                    const v = Number(msg.solved && msg.solved[k]) || 0;
                    if (v > (Number(solved[k]) || 0)) { solved[k] = v; changed = true; }
                    const s = Number(msg.studySecs && msg.studySecs[k]) || 0;
                    if (s > (Number(studySecs[k]) || 0)) { studySecs[k] = s; changed = true; }
                }
                // Pull in question ids the other tab created (image-less copies,
                // exactly like the cloud merge; lazy-loaders rehydrate images).
                const remote = await idbGet('jeemax_question_bank').catch(() => null);
                if (Array.isArray(remote) && remote.length) {
                    await _getTombstones();
                    const localIds = new Set(AppState.questionBank.map(q => String(q.id)));
                    for (const q of remote) {
                        if (!q || q.id === undefined || q.id === null) continue;
                        if (_isTombstoned(q.id)) continue;
                        if (!localIds.has(String(q.id))) {
                            AppState.questionBank.push(q);
                            localIds.add(String(q.id));
                            changed = true;
                        }
                    }
                }
                if (changed) {
                    _ui('updateUI');
                    _ui('updateStudyTimeHeader');
                    _ui('renderGraph');
                    _ui('renderErrorMatrixFromBank');
                }
            } catch (_) { /* a bad message must never crash the receiving tab */ }
        };
    } catch (_) { /* ignore */ }
}
_listenTabSync();

// ── Multi-tab question-bank guard (audit residual of item [11]) ─────────────
// A sibling tab's save used to be invisible to our full-bank rewrite: each tab
// holds its own AppState copy, so an idle tab running a pomodoro tick could
// commit a STALE bank over a sibling's fresh solve (per-question
// status/qElo/history are merged neither by the counter ping nor by the
// new-id pull). Before every commit we therefore re-read the committed bank
// and adopt remote copies of questions THIS tab has not touched since its own
// last load/commit.
let _foreignCommitPending = false;
const _bankSigs = new Map(); // String(q.id) -> signature of the copy we last loaded/committed

function _bankSig(q) {
    try {
        return JSON.stringify(q, (k, v) =>
            (k === 'imageDataUrl' || k === 'diagramImageUrl' || k === 'optionImageUrls' || k === 'solutionImageUrl') ? undefined : v);
    } catch (_) { return null; }
}

function _captureBankSigs() {
    _bankSigs.clear();
    for (const q of AppState.questionBank) {
        if (!q || q.id == null) continue;
        const sig = _bankSig(q);
        if (sig !== null) _bankSigs.set(String(q.id), sig);
    }
}

async function _adoptForeignBankUpdates() {
    try {
        const remote = await idbGet('jeemax_question_bank').catch(() => null);
        if (!Array.isArray(remote)) return;
        const localById = new Map(AppState.questionBank.map(q => [String(q && q.id), q]));
        let adopted = 0;
        for (const rq of remote) {
            if (!rq || rq.id == null) continue;
            const key = String(rq.id);
            const lq = localById.get(key);
            if (!lq) continue;                       // brand-new ids come via the ping path
            const rSig = _bankSig(rq);
            if (rSig === null) continue;
            const ourLastSig = _bankSigs.get(key);
            // Remote moved since we last saw it AND ours is untouched since our
            // last load/commit → take their fields (never clobbering local edits).
            if (rSig !== ourLastSig && _bankSig(lq) === ourLastSig) {
                for (const k of Object.keys(rq)) {
                    if (k === 'imageDataUrl' || k === 'diagramImageUrl' || k === 'optionImageUrls' || k === 'solutionImageUrl') continue;
                    lq[k] = rq[k];
                }
                _bankSigs.set(key, rSig);
                adopted++;
            }
        }
        if (adopted) console.info('[tab-sync] adopted ' + adopted + ' remotely-updated question(s) before commit');
    } catch (_) { /* never block the save path */ }
}

// ==================== INDEXEDDB STORAGE LAYER ====================
export const DB_NAME = 'jeemaxxing_db';
export const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => {
            dbPromise = null; // a failed open must NOT poison the session
            reject(request.error);
        };
        request.onsuccess = () => {
            const db = request.result;
            // Another tab upgrading/deleting the DB: close ours so it can
            // proceed, and drop the cached handle so the next call re-opens.
            db.onversionchange = () => {
                try { db.close(); } catch (_) {}
                dbPromise = null;
            };
            db.onblocked = () => { /* wait out the blocking tab */ };
            resolve(db);
        };
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
        tx.onerror = () => {
            _reportPersistFailure(key, tx.error);
            reject(tx.error);
        };
    });
}

// ── Persistence-failure surfacing ──
// Every IDB write failure (quota in Safari private mode, disk full, image
// vault bloat) used to be swallowed by .catch(console.error) at ~40 call
// sites — the app kept running with zero persistence and reload lost
// everything, silently. Now a failed write flags the session and raises a
// single non-blocking banner (once per session) instead of vanishing.
let _persistBannerShown = false;

function _reportPersistFailure(key, err) {
    console.error(`[persist] write failed for "${key}":`, err);
    try { window.__jmaxPersistFailed = true; } catch (_) {}
    if (_persistBannerShown) return;
    _persistBannerShown = true;
    const show = () => {
        if (!document.body || document.getElementById('jmax-persist-banner')) return;
        const banner = document.createElement('div');
        banner.id = 'jmax-persist-banner';
        banner.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#7f1d1d;color:#fff;padding:10px 14px;padding-bottom:calc(10px + env(safe-area-inset-bottom));font:14px/1.4 system-ui,sans-serif;text-align:center;box-shadow:0 -2px 12px rgba(0,0,0,.4)';
        banner.textContent = '⚠ Local storage is failing (private mode / disk full). Your progress cannot be saved on this device.';
        const close = document.createElement('span');
        close.textContent = '✕';
        close.style.cssText = 'position:absolute;right:8px;top:4px;cursor:pointer;padding:4px';
        close.onclick = () => banner.remove();
        banner.appendChild(close);
        document.body.appendChild(banner);
    };
    if (typeof document !== 'undefined' && document.body) show();
    else setTimeout(show, 500);
}

export async function idbSetMany(entries) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('storage', 'readwrite');
        const store = tx.objectStore('storage');
        for (const [key, value] of entries) store.put({ key, value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
            _reportPersistFailure('idbSetMany', tx.error);
            reject(tx.error);
        };
        tx.onabort = () => {
            _reportPersistFailure('idbSetMany', tx.error || new Error('idbSetMany aborted'));
            reject(tx.error || new Error('idbSetMany aborted'));
        };
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

/**
 * Read many keys in ONE readwrite-free transaction. iPad Safari pays a fixed
 * per-transaction cost, so collapsing the ~20 boot reads into a single
 * transaction cuts cold-start time substantially.
 */
export async function idbGetMany(keys) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('storage', 'readonly');
        const store = tx.objectStore('storage');
        const out = {};
        for (const key of keys) {
            const req = store.get(key);
            req.onsuccess = () => { out[key] = req.result ? req.result.value : null; };
        }
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
    });
}

// ── Full Backup / Restore [AUDIT P1-1] ─────────────────────────────────────
// Until now the only exports were a lossy analytics .txt and a Gem-feed .json
// projection — no ids, no images, no counters/ELO/mocks/history/vault, and no
// import at all. A lost iPad meant total loss. This dumps EVERYTHING this app
// persists (the whole IndexedDB key-value store incl. the image vault, plus a
// full localStorage snapshot) into one portable .json and puts it back.
const BACKUP_MARKER = '__jmaxBackup';
const BACKUP_VERSION = 2;

export async function idbGetAllEntries() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('storage', 'readonly');
        const store = tx.objectStore('storage');
        const keys = [], vals = [];
        const kreq = store.getAllKeys(), vreq = store.getAll();
        kreq.onsuccess = () => keys.push(...(kreq.result || []));
        vreq.onsuccess = () => vals.push(...(vreq.result || []));
        tx.oncomplete = () => resolve(keys.map((k, i) => [k, vals[i] ? vals[i].value : null]));
        tx.onerror = () => reject(tx.error);
    });
}

function _lsSnapshot() {
    const out = {};
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            out[k] = localStorage.getItem(k);
        }
    } catch (_) {}
    return out;
}

export async function buildFullBackup() {
    flushSaves().catch(() => {});          // fold any pending coalesced save in
    await new Promise(r => setTimeout(r, 650)); // > 600ms coalesce window
    const idbEntries = await idbGetAllEntries();
    return {
        [BACKUP_MARKER]: true,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        counts: { idbKeys: idbEntries.length },
        idb: idbEntries,
        ls: _lsSnapshot(),
    };
}

/**
 * Validate + apply a backup payload. Writes straight through to IndexedDB /
 * localStorage (NOT through _doSaveAll), then the caller reloads so every
 * module re-hydrates from the restored rows.
 */
export async function applyFullBackup(payload) {
    if (!payload || payload[BACKUP_MARKER] !== true) throw new Error('Not a JEEMaxxing backup file');
    if (!Array.isArray(payload.idb)) throw new Error('Backup is missing its data section');
    // Structural sanity before touching anything.
    for (const entry of payload.idb) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
            throw new Error('Backup data section is malformed');
        }
    }
    if (payload.ls && typeof payload.ls !== 'object') throw new Error('Backup prefs section is malformed');
    await idbSetMany(payload.idb);
    try {
        localStorage.clear();
        for (const k of Object.keys(payload.ls || {})) {
            try { localStorage.setItem(k, String(payload.ls[k])); } catch (_) {}
        }
    } catch (_) {}
    return { keys: payload.idb.length };
}

export async function idbRemove(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('storage', 'readwrite');
        const store = tx.objectStore('storage');
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('idbRemove aborted'));
    });
}

// ==================== IMAGE VAULT (persistent, unbounded) ====================
// Every uploaded image is kept FOREVER — nothing is evicted or stashed. The
// bank itself persists lightweight (imageDataUrl / diagramImageUrl stripped)
// so saveAllAsync() stays a small text-only write; images live in this vault
// keyed by question id and are re-attached to the bank on load. Lag from many
// images is handled at RENDER time instead: cards draw a tiny placeholder and
// swap in the real base64 only when the card nears the viewport (see
// initErrorLazyLoaders / initPracticeLazyLoaders), so the DOM never embeds
// hundreds of blobs at once.
export const IMAGE_CACHE_KEY = 'jeemax_image_cache';

let _imageCache = {};                                   // qid -> { imageDataUrl, diagramImageUrl, ts }
let _imageCachePersistedSig = '';
let _imageCacheLoaded = false;                          // cold-boot IDB read happens once/session

function _imgSample(data) {
    // Tiny fingerprint sample (cheap — never copies the whole base64 payload).
    if (typeof data !== 'string' || data.length === 0) return '';
    return data.length + ':' + data.slice(0, 24) + data.slice(-24);
}

function _imgMapSample(map) {
    if (!map || typeof map !== 'object') return '';
    const keys = Object.keys(map).sort();
    let sig = '{';
    for (const k of keys) sig += k + ':' + _imgSample(map[k]) + ';';
    return sig + '}';
}

function _imageCacheSignature(cache) {
    const ids = Object.keys(cache).sort();
    let sig = ids.length + '|';
    for (const id of ids) {
        sig += id + '=' + _imgSample(cache[id].imageDataUrl) + '/' + _imgSample(cache[id].diagramImageUrl)
            + '/' + _imgMapSample(cache[id].optionImageUrls) + '/' + _imgSample(cache[id].solutionImageUrl) + ';';
    }
    return sig;
}

function _collectImageCacheFromBank() {
    const cache = {};
    const now = Date.now();
    for (const q of AppState.questionBank) {
        if (!q || q.id == null) continue;
        const id = String(q.id);
        const img = (q.imageDataUrl && q.imageDataUrl.length > 100) ? q.imageDataUrl : null;
        const diag = (q.diagramImageUrl && q.diagramImageUrl.length > 100) ? q.diagramImageUrl : null;
        let opts = null;
        if (q.optionImageUrls && typeof q.optionImageUrls === 'object') {
            const filtered = {};
            for (const k of Object.keys(q.optionImageUrls)) {
                const v = q.optionImageUrls[k];
                if (typeof v === 'string' && v.length > 100) filtered[k] = v;
            }
            if (Object.keys(filtered).length) opts = filtered;
        }
        const sol = (q.solutionImageUrl && q.solutionImageUrl.length > 100) ? q.solutionImageUrl : null;
        if (!img && !diag && !opts && !sol) continue;
        const prev = _imageCache[id];
        // Keep the previous timestamp when content is unchanged (prevents
        // recency churn from the constant saves).
        const samePrev = prev
            && prev.imageDataUrl === img && prev.diagramImageUrl === diag
            && JSON.stringify(prev.optionImageUrls || null) === JSON.stringify(opts)
            && prev.solutionImageUrl === sol;
        const ts = samePrev ? prev.ts : now;
        cache[id] = { imageDataUrl: img, diagramImageUrl: diag, optionImageUrls: opts, solutionImageUrl: sol, ts };
    }
    return cache;
}

/**
 * Strip every heavy image payload off a bank question before it touches the
 * lightweight bank write — the image vault re-attaches them on load.
 */
function _stripBankImages(q) {
    const copy = { ...q };
    copy.imageDataUrl = null;
    copy.diagramImageUrl = null;
    copy.solutionImageUrl = null;
    copy.optionImageUrls = null;
    return copy;
}

/**
 * Persist the image vault. Cheap no-op on the hot save path when contents are
 * unchanged (signature compare — no base64 serialization).
 */
export async function persistImageCacheIfChanged() {
    const cache = _collectImageCacheFromBank();
    const sig = _imageCacheSignature(cache);
    if (sig === _imageCachePersistedSig) return;
    // Write FIRST, then advance the persisted-signature — if the write fails
    // (quota exceeded / private mode), the sig stays stale so the next save
    // retries instead of silently dropping the cache update.
    await idbSet(IMAGE_CACHE_KEY, cache);
    _imageCachePersistedSig = sig;
    _imageCache = cache;
}

/**
 * Load the image cache from IndexedDB and re-attach cached images onto the
 * live bank so rendering stays instant without a Drive round-trip.
 */
export async function hydrateImageCache() {
    // In-session the in-memory cache mirror is always current (saveAllAsync
    // updates it on every persist), so we skip the (up to ~60MB) IndexedDB
    // re-read on every tab switch — it only happens on cold boot.
    if (!_imageCacheLoaded) {
        try {
            const cached = await idbGet(IMAGE_CACHE_KEY);
            _imageCache = (cached && typeof cached === 'object') ? cached : {};
        } catch (_) {
            _imageCache = {};
        }
        _imageCacheLoaded = true;
        _imageCachePersistedSig = _imageCacheSignature(_imageCache);
    }
    for (const q of AppState.questionBank) {
        if (!q || q.id == null) continue;
        const e = _imageCache[String(q.id)];
        if (!e) continue;
        // Never clobber a fresh image fetched in-session with older cache data.
        if (!q.imageDataUrl && e.imageDataUrl) q.imageDataUrl = e.imageDataUrl;
        if (!q.diagramImageUrl && e.diagramImageUrl) q.diagramImageUrl = e.diagramImageUrl;
        if (!q.optionImageUrls && e.optionImageUrls) q.optionImageUrls = e.optionImageUrls;
        if (!q.solutionImageUrl && e.solutionImageUrl) q.solutionImageUrl = e.solutionImageUrl;
    }
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
    practiceFlowMode: 'standard',
    hardcoreDailyCount: 0,
    hardcoreDailyDate: null,
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
    // ── Cognitive MMR / Elo Matrix ──
    // Subject-segregated, uncapped matchmaking ratings with a consolidated
    // global meta-MMR. Foundational baseline = 1200 for every axis. These are
    // hydrated instantly in loadDataAsync() with protective fallback defaults
    // so a missing/corrupt profile never produces data gaps.
    elo: {
        physics: 1200,
        chemistry: 1200,
        maths: 1200,
        global: 1200,
    },
    // Epoch-ms stamp of the last local Elo write. Drives last-write-wins
    // cloud merge so a real (downward) rating change propagates instead of
    // being swallowed by the old high-water-mark Math.max merge.
    eloUpdatedAt: 0,
    // ── Chapter weightage dynamic tiers (chapter-weights.js resolver) ──
    // ai: Gemini-stamped during ingestion (gemini gem prompt.txt optional
    //     chapterWeight field) — fills gaps for renamed/niche chapters.
    // user: explicit overrides from the UI — highest authority.
    chapterWeights: {},
    userChapterWeights: {},
    // ── Mock Mode state (mock.js owns semantics; storage owns persistence) ──
    // mocks[]: draft/ready/in-progress/done papers. mockDraftContext: while set,
    // every Save-All commit links its new questions into that draft section.
    // mockFocus: chapter::pattern loss-mass from completed papers (×0.7 weekly).
    mocks: [],
    mockDraftContext: null,
    mockFocus: {},
};


export const baseTargets = { physics: 10, chemistry: 10, maths: 10 };
export const baseErrorTargets = { physics: 5, chemistry: 5, maths: 5 };
export const solved = { physics: 0, chemistry: 0, maths: 0 };

// ── SessionFocus: shared "the user is mid-activity" registry ────────────────
// Five independent systems can interrupt with modals/lockdowns (focus-block
// notifications, Night Guard, checkpoints, bounty, boot briefing). Historically
// none of them knew whether the user was mid-solve or mid-mock, and z-index
// ties buried them invisibly while they still mutated state. Anything that
// owns the user's attention acquires a reason here; interrupters consult
// isBusy() and defer instead of stacking.
//
// 'practice'     — question practice modal is open (app.js)
// 'vault-drawer' — Error Vault SR practice drawer is open (matrix.js)
// mock exams     — detected via body.mock-running (set by mock.js openRunner)
export const _sessionFocusReasons = new Set();
export const SessionFocus = {
    acquire(reason) { if (reason) _sessionFocusReasons.add(String(reason)); },
    release(reason) {
        if (!_sessionFocusReasons.delete(String(reason))) return;
        // Let queued interrupters know the stage may be free now.
        try {
            document.dispatchEvent(new CustomEvent('jmax:focus-released', { detail: { reason: String(reason) } }));
        } catch (_) {}
    },
    has(reason) { return _sessionFocusReasons.has(String(reason)); },
    isBusy() {
        if (_sessionFocusReasons.size > 0) return true;
        try { if (document.body && document.body.classList.contains('mock-running')) return true; } catch (_) {}
        return false;
    },
};
export const studySecs = { physics: 0, chemistry: 0, maths: 0 };
// Single source of truth for the "day" boundary: LOCAL calendar date
// (YYYY-MM-DD). All daily counters, cloud payloads and history keys must use
// this so counters reset at local midnight, not UTC midnight.
/**
 * ICU-safe YYYY-MM-DD local-date key.
 * toLocaleDateString('en-CA') returns YYYY-MM-DD on standard ICU builds, but
 * some platform ICU variants (older Android WebView, rare macOS locales) can
 * emit a different shape — and every consumer (ledger keys, deload windows,
 * checkpoint dates) compares these strings, so a silent format mismatch would
 * corrupt day bucketing. Manual formatting is deterministic everywhere.
 */
export function formatDateKey(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function todayLocalKey(date) {
    return formatDateKey(date || new Date());
}
const _SUBJ_KEYS = ['physics', 'chemistry', 'maths'];
export function normSubjKey(s) {
    s = String(s || '').toLowerCase().trim();
    if (s === 'math' || s === 'mathematics') return 'maths';
    return _SUBJ_KEYS.indexOf(s) >= 0 ? s : 'physics';
}
export const monthNamesCal = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

// Core data mutation: increment/decrement solved counter for a subject
// Core data mutation: increment/decrement solved counter for a subject
export function changeCount(subject, delta) {
    // Canonicalize: solved only ever has the three core keys. A raw "Physics"
    // or custom subject would read undefined here and turn +delta into a NaN
    // that then persists through every save.
    const key = normSubjKey(subject);
    solved[key] = Math.max(0, (Number(solved[key]) || 0) + (Number(delta) || 0));
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

// ─────────────────────────────────────────────────────────────────────────────
//  MEMORY KERNEL v2 bridge — canonical implementation lives in memory.js
//  (pure, DOM-free, Node-testable). Re-exported here so existing consumers of
//  storage.js see one coherent surface. See memory.js header for the math.
// ─────────────────────────────────────────────────────────────────────────────
export {
    MEMORY_MODEL_VERSION,
    FSRS_PARAMS,
    hydrateMemory,
    backfillMemoryFields,
    retrievabilityFrom,
    retrievabilityAt,
    currentRetrievability,
    updateMemoryOnReview,
    refineDifficultyAfterTag,
    weightedRetention,
    chapterMemoryStats,
    RETENTION_CRITICAL,
} from './memory.js';

/**
 * Rating-uncertainty tuning (Glicko-lite). Every subject carries a rating
 * deviation (rd): wide ⇒ the Elo estimate is young/stale and moves fast;
 * narrow ⇒ well-calibrated and stable. K_eff scales with rd instead of the
 * legacy fixed K=32.
 */
export const RD_TUNING = {
    START: 350,             // fresh profile — nothing is known yet
    FLOOR: 45,              // fully calibrated floor
    SHRINK_PER_SOLVE: 40,   // variance removed per solve (√(rd²−C²) model)
    DRIFT_PER_DAY: 12,      // staleness widening per idle day
    CAP: 350,
    K_REF_RD: 150,          // rd at which K_eff === legacy K_user
    K_MIN: 8,               // calibrated floor for the effective K
    K_MAX: 64,              // fresh-profile ceiling for the effective K
};

/** Pre-reveal confidence anchors for calibration capture (Brier scoring). */
export const CONFIDENCE_ANCHORS = { sure: 0.92, likely: 0.70, guess: 0.45 };
export const CALIBRATION_LOG_CAP = 240;

// ─────────────────────────────────────────────────────────────────────────────
// MOCK MODE — real marking schemes (JEE Advanced style). Editable data.
// ─────────────────────────────────────────────────────────────────────────────
export const MARKS_SCHEMES = {
    'adv-single':  { id: 'adv-single',  label: 'Single correct',   correct: 4, wrong: -1, skipped: 0 },
    'adv-numeric': { id: 'adv-numeric', label: 'Numeric',         correct: 4, wrong: 0,  skipped: 0 },
    'adv-multi':   { id: 'adv-multi',   label: 'Multi correct',   full: 4, partialPerCorrect: 1, anyWrongPenalty: -2, skipped: 0 },
};

/** Pattern resolver — multi is encoded as an array correctAnswer everywhere. */
export function getPatternForQuestion(q) {
    if (!q) return 'numeric';
    if (q.type === 'numeric') return 'numeric';
    if (q.type === 'mcq') return Array.isArray(q.correctAnswer) ? 'multi' : 'single';
    return 'numeric'; // text/free-response mocks treat like numeric-neutral
}

/** Scheme id for a question based on its pattern. */
export function getSchemeIdForQuestion(q) {
    const p = getPatternForQuestion(q);
    return p === 'multi' ? 'adv-multi' : p === 'single' ? 'adv-single' : 'adv-numeric';
}

// ---------------------------------------------------------------------------
// Chapter weightage - canonical resolver lives in chapter-weights.js (pure).
// storage.js supplies the DYNAMIC tiers (user overrides + AI-stamped weights
// learned during Gem ingestion) on top of the static calibrated table.
// Tiers: user > exact-table > ai > alias > fuzzy-match > typo > unit > default.
// ---------------------------------------------------------------------------
export {
    JEE_CHAPTER_WEIGHTS,
    CHAPTER_ALIASES,
    UNIT_KEYWORD_RULES,
    DEFAULT_CHAPTER_WEIGHT,
} from './chapter-weights.js';

/** Full provenance lookup: {weight, source, matched} - for UI trust display. */
export function resolveChapterWeightInfo(chapter) {
    return _resolveCW(chapter, {
        overrides: AppState.userChapterWeights,
        ai: AppState.chapterWeights,
    });
}

/** Numeric shortcut for hot paths (grid risk math). */
export function getChapterWeight(chapter) {
    try {
        return resolveChapterWeightInfo(chapter).weight;
    } catch (_) {
        return _DEFAULT_CHAPTER_W;
    }
}

/** Normalize a chapter name the same way the resolver does. */
function _cwKey(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** AI tier writer - Gem ingestion stamps what the model believes per chapter. */
export function setAiChapterWeight(name, w) {
    const n = Number(w);
    if (!isFinite(n) || n <= 0) return false;
    const key = _cwKey(name);
    if (!key) return false;
    if (!AppState.chapterWeights || typeof AppState.chapterWeights !== 'object') AppState.chapterWeights = {};
    AppState.chapterWeights[key] = Math.max(0.05, Math.min(1.5, n));
    saveAllAsync().catch(() => {});
    return true;
}

/** User override writer - highest authority; pass null/undefined to clear. */
export function setChapterWeightOverride(name, w) {
    const key = _cwKey(name);
    if (!key) return false;
    if (!AppState.userChapterWeights || typeof AppState.userChapterWeights !== 'object') AppState.userChapterWeights = {};
    if (w === null || w === undefined) { delete AppState.userChapterWeights[key]; saveAllAsync().catch(() => {}); return true; }
    const n = Number(w);
    if (!isFinite(n) || n <= 0) return false;
    AppState.userChapterWeights[key] = Math.max(0.05, Math.min(1.5, n));
    saveAllAsync().catch(() => {});
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cognitive MMR / qElo band system
// ─────────────────────────────────────────────────────────────────────────────
// 7-band implied-difficulty rating grid (universal across physics / chemistry / maths).
// The grid is calibrated against JEEMaxxing's existing anchor points:
//   • forest-juice.js:378 — easy=1000, medium=1600, hard=2500 (±70 noise)
//   • app.js — dark oak is a ~10% per-solved-question roll (q.oak stamped at solve)
//   • storage.js:~352 — global qElo fallback = 1200 (used as the chapter
//     baseline when no chapter history exists)
//   • app.js:3555 — auto-quarantine (isAnomaly) when |newQ − chapterAvg| > 600

export const ELO_BANDS = {
    T1_FOUNDATION:   [800, 1099],
    T2_CORE_MAINS:   [1100, 1299],
    T3_STD_MAINS:    [1300, 1549],
    T4_ADV_EASY:     [1550, 1799],
    T5_PAPER_ADV:    [1800, 2099],
    T6_ELITE:        [2100, 2299],
    T7_OLYMP:        [2300, 2550],
};

export const BAND_TARGET_TIME = { T1: 2, T2: 3, T3: 5, T4: 7, T5: 9, T6: 11, T7: 15 };

/**
 * Lookup the band key for an integer qElo. Returns 'T1_FOUNDATION' .. 'T7_OLYMP'
 * or null if the value falls outside the calibrated grid.
 */
export function getEloBand(qElo) {
    if (typeof qElo !== 'number' || !isFinite(qElo)) return null;
    if (qElo < ELO_BANDS.T1_FOUNDATION[0]) return null;
    if (qElo <= ELO_BANDS.T1_FOUNDATION[1]) return 'T1_FOUNDATION';
    if (qElo <= ELO_BANDS.T2_CORE_MAINS[1])   return 'T2_CORE_MAINS';
    if (qElo <= ELO_BANDS.T3_STD_MAINS[1])    return 'T3_STD_MAINS';
    if (qElo <= ELO_BANDS.T4_ADV_EASY[1])     return 'T4_ADV_EASY';
    if (qElo <= ELO_BANDS.T5_PAPER_ADV[1])   return 'T5_PAPER_ADV';
    if (qElo <= ELO_BANDS.T6_ELITE[1])        return 'T6_ELITE';
    if (qElo <= ELO_BANDS.T7_OLYMP[1])        return 'T7_OLYMP';
    return null; // above ceiling — out of calibration
}

/**
 * Tune constants for the delta-based ELO reward branch (app.js
 * calculateEloMigration). These fire when the question's qElo is already
 * trusted — either because Gemini stamped it during ingestion
 * (qEloSource === 'gem-stamped') or because the engine has accumulated enough
 * solves to consider it calibrated (qEloSource === 'learned' and
 * solveCount ≥ CALIBRATED_SOLVE_THRESHOLD).
 *
 *   K_user  = the standard chess-style K-factor for the subject ELO update.
 *   K_q     = tiny K-factor for the question qElo drift (we trust the stamp,
 *             so drift is intentionally tiny).
 *   STINGINESS_MULT = extra penalty on misfires (underdog upset only).
 *
 * The math is the canonical ELO update:
 *   rawSubjectDelta = K_user · (S − P_win) · timeMult   (S=1 for correct, 0 for wrong)
 *   qEloDrift      = K_q     · ((1 − S) − P_q_win)      (question also moves)
 * where P_win = 1 / (1 + 10^((Q − E) / 400)) is the user's expected win prob.
 * This naturally rewards upsets (low E beats high Q) and stingily rewards
 * favourites (high E beats low Q) without ad-hoc piecewise multipliers.
 */
export const ELO_GEM_STAMP_TUNING = {
    K_user: 32,                 // Subject ELO swing per solve
    K_q: 6,                     // qElo drift per solve (small — trust the stamp)
    misfireExtraMult: 1.4,      // Extra penalty on wrong solves on easier-than-you questions
    timeMin: 0.5,               // τ lower clamp
    physicsTauBuffer: 0.85,     // Mirror app.js legacy physics calculation buffer
    chemistrySlowThreshold: 1.25,
    chemistrySlowPenalty: 0.4,
    ceiling: 2999.99,           // Hard cap on subject ELO (matches existing cap)
};

/** Number of solves required before a legacy/uncalibrated qElo is trusted. */
export const CALIBRATED_SOLVE_THRESHOLD = 1;

// Per-chapter Practice Modes: Flow State vs Hardcore / Overclock
export const PRACTICE_MODES = ['standard', 'flow', 'hardcore'];

/**
 * Mode tuning constants. Drive BOTH:
 *   1. The picker's P_win window filter (which problems the mode surfaces)
 *   2. The reward deltas during calculateEloMigration (mode multipliers
 *      on the subject-ELO delta, on the escrow/legendary bonus, and on
 *      the time-curve inflection points).
 *
 * P_win math: P_win = 1 / (1 + 10^((Q − E) / 400))
 *   • Flow     Pwin 0.75 → 0.85  ≈ qElo in [userElo+50,  userElo+120]
 *   • Hardcore Pwin 0.35 → 0.50  ≈ qElo in [userElo+300, userElo+500]
 */
export const MODE_TUNING = {
    standard: {
        winsMultiplier: 1.0,
        lossMultiplier: 1.0,
        escrowBonusMultiplier: 1.0,
        winSweetSpot: 0.8,
        lossFastGrace: 0.5,
    },
    flow: {
        PwinMin: 0.75, PwinMax: 0.85,
        PwinFallbackMin: 0.65, PwinFallbackMax: 0.90,
        winsMultiplier: 1.0,
        lossMultiplier: 1.0,
        escrowBonusMultiplier: 1.0,
        winSweetSpot: 0.6,            // gentle fast bonus zone
        lossFastGrace: 0.5,
        label: '🎯 FLOW STATE',
    },
    hardcore: {
        PwinMin: 0.35, PwinMax: 0.50,
        PwinFallbackMin: 0.20, PwinFallbackMax: 0.65,
        minQeloFloor: 1800,
        winsMultiplier: 1.8,            // 1.8× subject-ELO payout on win
        lossMultiplier: 0.6,            // sympathy multiplier on underdog misfire
        escrowBonusMultiplier: 2.0,    // doubled legendary drop rate
        winSweetSpot: 0.45,
        lossFastGrace: 0.3,
        capPerDay: 8,                    // anti-grind circuit-breaker
        label: '⚡ HARDCORE / OVERCLOCK',
    },
};

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
 * Clamp: [1.3, 3.0]
 *
 * Correct answers (q >= 3.0) must NEVER lower EF — a correct-but-slow review
 * should not shorten the next interval.
 *
 * The 3.0 CEILING is deliberate and unifying: the practice-submit inline nudge
 * path (app.js) has always capped EF at 3.0, and memory.js's model documents
 * "[1.3, 3.0]" — only this canonical SM-2 path was uncapped, so vault items
 * could out-grow practice items on the same question and diverge scheduling.
 */
export function calculateNewEaseFactor(currentEF, performanceQ) {
    const qGap      = 5.0 - performanceQ;
    let adjustment  = 0.1 - qGap * (0.08 + qGap * 0.02);
    if (performanceQ >= 3.0) adjustment = Math.max(0, adjustment);
    const newEF     = currentEF + adjustment;
    return Math.min(3.0, Math.max(1.3, newEF));
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
 *
 * Interval growth uses a floor on the friction weight so even APPROACH-heavy
 * questions (Wf = 0.15) can eventually reach the mastered threshold (30d+);
 * the incorrect-answer compression path keeps the raw weight.
 */
const SR_MIN_GROWTH_WEIGHT = 0.35;

export function calculateNextInterval(currentInterval, result, newEaseFactor, frictionWeight) {
    currentInterval = Number(currentInterval);
    if (!isFinite(currentInterval) || currentInterval < 0) currentInterval = 0;
    if (result === 'correct') {
        if (currentInterval === 0) return 1;
        if (currentInterval === 1) return 3;
        const growthWf = Math.max(Number(frictionWeight) || 0.6, SR_MIN_GROWTH_WEIGHT);
        return Math.ceil(currentInterval * newEaseFactor * growthWf);
    } else {
        const shrinkWf = Number(frictionWeight) || 0.6;
        return Math.max(1, Math.floor(currentInterval * shrinkWf));
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
    // Coerce + guard: corrupt/legacy string or NaN inputs must never produce
    // an Invalid Date (which would crash submitPracticeLog at toISOString()).
    let currentInterval = Number(question.currentInterval ?? 0);
    if (!isFinite(currentInterval) || currentInterval < 0) currentInterval = 0;
    let currentEF = Number(question.easeFactor ?? 2.5);
    if (!isFinite(currentEF)) currentEF = 2.5;
    let targetTime = Number(question.targetTimeMins ?? 5);
    if (!isFinite(targetTime) || targetTime <= 0) targetTime = 5;

    const Wf = calculateFrictionWeight(attempt.frictionTypes);
    let q  = calculatePerformanceQ(attempt.autonomy, attempt.timeSpentMins, targetTime);
    if (!isFinite(q)) q = 0.5;
    const EF = calculateNewEaseFactor(currentEF, q);
    const In = calculateNextInterval(currentInterval, attempt.result, EF, Wf);
    const safeIn = isFinite(In) && In >= 0 ? In : 0;

    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + safeIn);

    const isMastered = safeIn > 30 && EF > 2.5 && attempt.result === 'correct';

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

    if (!isFinite(diffMs)) {
        // Corrupt/Invalid date — surface as due now rather than "Due in NaNd".
        return { status: 'ready', label: '🟢 Ready', daysUntil: 0 };
    }
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
        // ── Bound text-bloat: keep only the most recent attempt logs per
        // question (the UI renders the last 5 dots / reversed list anyway). ──
        if (q.historyLogs.length > 30) { q.historyLogs = q.historyLogs.slice(-30); dirty = true; }
        // ── Cognitive MMR: backfill the dynamic question difficulty rating
        // (qElo = Implied Difficulty Rating). Legacy questions default to
        // 1200; the engine retro-mutates this toward its true implied
        // difficulty on every subsequent attempt. isAnomaly flags questions
        // whose qElo shoots >600 pts past their chapter baseline so they are
        // dropped from normal Elo iteration filters. ──
        if (q.qElo === undefined || q.qElo === null) { q.qElo = 1200; dirty = true; }
        if (q.isAnomaly === undefined) { q.isAnomaly = false; dirty = true; }
        // ── NEW (pre-ELO schema, post-Cognitive MMR): provenance tracking.
        // qEloSource tells calculateEloMigration whether to use the legacy
        // R_perf warmup formula (uncalibrated) or the new delta-based reward
        // (gem-stamped | learned). solveCount flips an 'uncalibrated' question
        // to 'learned' once it crosses CALIBRATED_SOLVE_THRESHOLD solves —
        // the existing R_perf migration has produced enough signal at that
        // point that we can trust qElo and switch to the calibrated branch.
        if (q.qEloSource  === undefined) { q.qEloSource   = 'uncalibrated'; dirty = true; }
        if (q.qEloStampedBy === undefined) { q.qEloStampedBy = null; dirty = true; }
        if (q.qEloStampedAt === undefined) { q.qEloStampedAt = null; dirty = true; }
        if (typeof q.solveCount !== 'number') { q.solveCount = 0; dirty = true; }
        if (q.lastSolvedAt === undefined) { q.lastSolvedAt = null; dirty = true; }
        // ── No-regret skip ledger (Flow/Hardcore) ──
        // A skip is non-destructive: it only stamps these counters so the mode
        // picker can deprioritize the question. Elo/qElo/solveCount/status are
        // never touched by the skip action.
        if (typeof q.skips !== 'number') { q.skips = 0; dirty = true; }
        if (q.lastSkippedAt === undefined) { q.lastSkippedAt = null; dirty = true; }
        if (!Array.isArray(q.skipReasons)) { q.skipReasons = []; dirty = true; }
        if (q.modeRetired === undefined) { q.modeRetired = false; dirty = true; }
        // Anti-cheat flags populated by processGemTextDump on ingest.
        if (q.stampBatchSuspiciousDistribution === undefined) { q.stampBatchSuspiciousDistribution = false; dirty = true; }
        if (q.stampBatchSuspiciousStdev === undefined) { q.stampBatchSuspiciousStdev = false; dirty = true; }
        // Carry over the canonical tags field so qElo picker can filter later.
        if (!Array.isArray(q.tags)) { q.tags = []; dirty = true; }
        // ── Memory Kernel v2 backfill (additive-only): stability / difficultyD /
        // reps / lapses derived from legacy SR state. Legacy fields are never
        // touched — see memory.js backfillMemoryFields. ──
        try { if (backfillMemoryFields(q)) dirty = true; } catch (_) { /* never block boot */ }
        // ── Cognitive Cortex v3 backfill (additive-only): createdAt derived
        // from the earliest attempt → lastSolvedAt → lastReviewedAt chain so
        // age-at-solve priors work on pre-cortex data. Idempotent. ──
        try { if (migrateCortexFields(q)) dirty = true; } catch (_) { /* never block boot */ }
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
    // ── Bare-backslash LaTeX corruption repair ───────────────────────────────
    // Gemini dumps routinely emit single-backslash LaTeX inside JSON strings
    // (`"\frac{1}{2}"`). JSON.parse does NOT reject that — it silently maps
    // `\f` → form-feed, `\t` → tab, `\b` → backspace, `\r` → CR, so `\frac`
    // arrives as "\f" + "rac" and the math is mangled beyond repair. This is
    // exactly why the same dump renders fine in the Gemini app (which never
    // JSON-decodes it) but comes out broken here.
    //
    // Strategy: parse the raw text CLEAN first — valid dumps keep their real
    // `\n` newlines untouched. If any decoded value carries a control char
    // that clean question text never contains (form-feed / backspace / tab /
    // CR), the dump was silently corrupted → re-parse with bare backslashes
    // pre-doubled before b/f/n/r/t/u macro starts. Properly escaped `\\frac`
    // and real `\n` / `\u0041` escapes are never touched; the `\n`+Capital
    // literal artifact this can create is healed downstream by repairLatex's
    // `\n`→newline rule.
    //
    // NOTE: the corruption check + re-parse is whole-document by design — a
    // single stray control char anywhere re-runs preEscape over every string.
    // It only fires on already-corrupted dumps, so the cost is bounded. Do NOT
    // add `\n` to the corruption class: real newlines are legitimate in clean
    // dumps, and `\neq`-corruption (`\n`+eq) is indistinguishable from a real
    // newline at the raw-text level — it is the one macro that may still
    // degrade silently in single-backslash dumps.
    const hasCorruption = (val) => {
        if (typeof val === 'string') return /[\x08\x0c\t\r]/.test(val);
        if (Array.isArray(val)) return val.some(hasCorruption);
        if (val && typeof val === 'object') return Object.keys(val).some(k => hasCorruption(val[k]));
        return false;
    };
    const preEscape = (s) => s.replace(/(^|[^\\])\\([bfnrtu])(?=[a-zA-Z])/g, '$1\\\\$2');
    try {
        const parsed = JSON.parse(sanitized);
        if (!hasCorruption(parsed)) return parsed;
        return JSON.parse(preEscape(sanitized));
    } catch (initialError) {
        try {
            // Fallback for genuinely invalid JSON: pre-escape macro starts
            // (so `\underbrace` etc. survive), then double every bare
            // backslash that isn't part of a valid JSON escape.
            const multiEscaped = preEscape(sanitized).replace(/\\([^"\\\/bfnrtu])/g, '\\\\$1');
            return JSON.parse(multiEscaped);
        } catch (secondaryError) {
            throw new Error("Unable to parse JSON: " + secondaryError.message);
        }
    }
}

// ==================== DETERMINISTIC LATEX REPAIR ====================
// LLMs are statistically unable to count backslashes, so this is the code-side
// safety net that runs on EVERY string field at ingestion and on existing rows
// at load (see _repairQuestionBank). It is idempotent: already-correct input
// passes through unchanged, so it is safe to run repeatedly.
//
// Responsibilities (code eliminates what the prompt can only reduce):
//   1. Unicode math glyphs → LaTeX commands (LATEX_UNICODE_MAP).
//   2. Broken matrix/align row breaks — a LONE backslash before a space,
//      digit, or hyphen ("\ ", "\1", "\-3") which only ever comes from a
//      collapsed "\\" separator — re-stamped to "\\ ".
//   3. Literal "\nList"-style string escapes → real newlines.
// A backslash before a letter (\frac, \times) or a brace is never touched.
const LATEX_UNICODE_MAP = {
    '≠': '\\neq',
    '≢': '\\neq',
    '≤': '\\le',
    '≥': '\\ge',
    '±': '\\pm',
    '×': '\\times',
    '∞': '\\infty',
    '≡': '\\equiv',
    '→': '\\to',
    '°': '\\degree',
    'µ': '\\text{μ}',
};

export function repairLatex(s) {
    if (typeof s !== 'string') return s;
    return s
        // Unicode first so the backslashes it introduces (\times, \neq) sit
        // before a LETTER and are never re-doubled by the row-break rule below.
        .replace(/[≠≢≤≥±×∞≡→°µ]/g, (c) => LATEX_UNICODE_MAP[c] || c)
        // Lookbehind-free row-break repair. Regex lookbehind (?<!) throws a
        // SyntaxError on Safari < 16.4 (older iPads) — that crashed every
        // ingest AND every load-time bank repair on those devices. Semantics
        // are identical: a lone backslash before a space/digit/hyphen is a
        // collapsed `\\` separator artifact and gets re-stamped to `\\`;
        // already-doubled `\\` (real row breaks) is never touched.
        .replace(/(^|[^\\])\\(?=[\s\d-])/g, (m, pre) => pre + '\\\\')
        .replace(/\\n(?=[A-Z])/g, '\n')
        // KaTeX has no align/equation/eqnarray/gather environments — Gemini
        // dumps love them, and KaTeX renders the env name as red raw source.
        // Normalize to the supported `aligned` (idempotent: after one pass the
        // env names no longer match).
        .replace(/\\begin\{(align|equation|eqnarray|gather|flalign|multline)\*?\}/g, '\\begin{aligned}')
        .replace(/\\end\{(align|equation|eqnarray|gather|flalign|multline)\*?\}/g, '\\end{aligned}');
}

/**
 * Belt-and-suspenders math validator. Renders every `$...$` segment through
 * KaTeX with throwOnError; returns false if ANY segment fails AFTER repair.
 * Non-blocking by design — callers flag the row instead of aborting ingestion,
 * because KaTeX is loaded asynchronously by the watchdog and may not be present
 * at ingest time (guarded here by the window.katex check).
 */
export function mathOk(s) {
    if (typeof s !== 'string' || !s) return true;
    if (typeof window === 'undefined' || typeof window.katex !== 'object' || !window.katex.renderToString) return true;
    const render = (body) => {
        try { window.katex.renderToString(body, { throwOnError: true }); return true; }
        catch (_) { return false; }
    };
    // (1) every delimited segment must render
    const MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^\$]+)\$|\\\(([\s\S]+?)\\\)/g;
    let m;
    while ((m = MATH.exec(s)) !== null) {
        const body = m[1] || m[2] || m[3] || m[4];
        if (body !== undefined && body !== '' && !render(body)) return false;
    }
    // (2) every BARE \begin{env}...\end{env} (outside any delimiter) must
    //     render, mirroring the render-time _wrapBareLatex environment wrap.
    const inMath = new Array(s.length).fill(false);
    MATH.lastIndex = 0;
    while ((m = MATH.exec(s)) !== null) { for (let k = m.index; k < m.index + m[0].length; k++) inMath[k] = true; }
    const openRe = /\\begin\{([^}]*)\}/g;
    let om;
    while ((om = openRe.exec(s)) !== null) {
        if (inMath[om.index]) continue;
        let depth = 1;
        const scan = /\\begin\{([^}]*)\}|\\end\{([^}]*)\}/g;
        scan.lastIndex = om.index + om[0].length;
        let sm, endIdx = -1;
        while ((sm = scan.exec(s)) !== null) {
            if (sm[1] !== undefined) { depth++; }
            else { depth--; if (depth === 0) { endIdx = sm.index; break; } }
        }
        if (endIdx !== -1) {
            const closeRe = /\\end\{([^}]*)\}/.exec(s.slice(endIdx));
            const end = endIdx + (closeRe ? closeRe[0].length : 2);
            if (!render(s.slice(om.index, end))) return false;
        }
    }
    return true;
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
        // A failed decode (oversized/corrupt crop, memory pressure) must
        // settle the promise — a permanently-pending promise hung the spinner
        // forever with no recovery path.
        img.onerror = () => resolve(null);
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

// Quotes are escaped too: this helper also builds double-quoted HTML attribute
// values (e.g. value="${escapeHtml(answerDisplay)}"), where a raw " in
// ingested Gemini/user text would terminate the attribute and inject markup.
export function escapeHtml(str) { return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]); }

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
    totalSecs = Math.max(0, totalSecs || 0);
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

// ==================== DATA PERSISTENCE ====================
// ── Save coalescing ────────────────────────────────────────────────────────
// Every solve fires multiple full-bank commits back-to-back (changeCount →
// saveAllAsync, practiceSubmit → saveAllAsync, …), each serializing the
// ENTIRE bank (every question × up to 30 history logs) to IndexedDB. As the
// bank grows that per-solve cost grows with it. All saveAllAsync() calls
// landing within one trailing 600ms window now share a single commit;
// `await saveAllAsync()` still resolves only after the real commit lands, so
// durability semantics are unchanged. pagehide / visibility-hidden flush the
// tail so a burst is never lost when leaving the page.
let _saveTimer = null;
let _saveBatch = null;
let _saveBatchResolve = null;
let _saveBatchReject = null;
let _saveChain = Promise.resolve();

// ── Wipe-propagation latch (set by loadDataAsync on a failed boot read) ──
// While set, every full-bank persistence commit is refused: the in-memory
// state was never populated, so committing it would overwrite good rows on
// disk with an empty bank. The banner already tells the user data won't
// survive; this guarantees it also can't be silently DESTROYED.
let _degradedBootRead = false;
let _degradedBlockWarned = false;

export function saveAllAsync() {
    if (!_saveTimer) {
        _saveBatch = new Promise((resolve, reject) => {
            _saveBatchResolve = resolve;
            _saveBatchReject = reject;
        });
        _saveTimer = setTimeout(_commitCoalescedSave, 600);
    }
    return _saveBatch;
}

function _commitCoalescedSave() {
    _saveTimer = null;
    const resolve = _saveBatchResolve, reject = _saveBatchReject;
    _saveBatchResolve = null;
    _saveBatchReject = null;
    // Serialize commits; a failed commit must never wedge the chain and block
    // all future saves.
    _saveChain = _saveChain
        .catch(() => {})
        .then(() => _doSaveAll())
        .then(() => { if (resolve) resolve(); }, (e) => { if (reject) reject(e); });
}

/** Force any pending coalesced save to commit immediately. */
export function flushSaves() {
    if (_saveTimer) {
        clearTimeout(_saveTimer);
        _commitCoalescedSave();
    }
    return _saveBatch || Promise.resolve();
}

try {
    window.addEventListener('pagehide', () => { flushSaves().catch(() => {}); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushSaves().catch(() => {}); });
} catch (_) {}

async function _doSaveAll() {
    // ── Wipe-propagation guard: never commit a gutted in-memory state ──
    if (_degradedBootRead) {
        if (!_degradedBlockWarned) {
            _degradedBlockWarned = true;
            console.error('[storage] Save blocked: boot read failed earlier this session — refusing to overwrite stored data with an empty state. Reload once storage is available.');
        }
        return; // resolve "successfully" so callers/flushes never wedge
    }
    // Persist the bank WITHOUT inline images (kept in the bounded image cache)
    // so every save is a small text-only payload — this was the intent of
    // `lightweightBank`; the previous code saved the image-laden bank instead,
    // which serialized megabytes of base64 on every solve / pomodoro tick.
    // Multi-tab guard: pull in sibling-tab question updates for questions we
    // did NOT touch ourselves, so our full-bank write can't erase them.
    if (_foreignCommitPending) {
        _foreignCommitPending = false;
        await _adoptForeignBankUpdates();
    }

    const lightweightBank = AppState.questionBank.map(q => ({
        ...q,
        imageDataUrl: null,
        diagramImageUrl: null
    }));

    // ── Single-transaction commit: ~15 sequential IDB transactions used to
    //    fire per save; now one commit. The image vault is signature-gated
    //    separately below (only rewrites when an image actually changed). ──
    const entries = [];
    entries.push(['jeemax_question_bank', lightweightBank]);
    entries.push(['jeemax_chapters', AppState.chapters]);
    entries.push(['jeemax_solved', solved]);
    entries.push(['jeemax_study_secs', studySecs]);
    entries.push(['jeemax_bounty', AppState.bounty]);
    entries.push(['jeemax_mood_multiplier', AppState.moodMultiplier]);
    // ── Hydrate Cognitive MMR / Elo Matrix (subject + global meta-MMR) ──
    // rd: Glicko-lite rating deviation per subject (Elo v2) rides along so
    // uncertainty survives reloads instead of resetting to "young rating".
    entries.push(['jeemax_elo', {
        physics:   AppState.elo.physics   ?? 1200,
        chemistry: AppState.elo.chemistry ?? 1200,
        maths:     AppState.elo.maths     ?? 1200,
        global:    AppState.elo.global    ?? 1200,
        rd: (AppState.elo.rd && typeof AppState.elo.rd === 'object') ? AppState.elo.rd : {},
    }]);
    entries.push(['jeemax_elo_updated_at', Number(AppState.eloUpdatedAt) || 0]);
    // Practice mode + hardcore daily counter persistence
    entries.push(['jeemax_practice_mode', AppState.practiceFlowMode || 'standard']);
    entries.push(['jeemax_hardcore_daily', {
        date: AppState.hardcoreDailyDate,
        count: AppState.hardcoreDailyCount || 0,
    }]);
    // ── Long-lived stat state that used to be MEMORY-ONLY (every reload wiped
    //    it back to zero, so these stats only ever reflected the current
    //    session): Brier calibration history · chapter ability θ_c · chapter
    //    weights (AI-stamped + user overrides) · mock papers + focus mass. ──
    const _isObj = v => v && typeof v === 'object' && !Array.isArray(v);
    entries.push(['jeemax_calibration_log', Array.isArray(AppState.calibrationLog) ? AppState.calibrationLog : []]);
    entries.push(['jeemax_chapter_theta', _isObj(AppState.chapterTheta) ? AppState.chapterTheta : {}]);
    entries.push(['jeemax_chapter_weights_ai', _isObj(AppState.chapterWeights) ? AppState.chapterWeights : {}]);
    entries.push(['jeemax_chapter_weights_user', _isObj(AppState.userChapterWeights) ? AppState.userChapterWeights : {}]);
    entries.push(['jeemax_mocks', Array.isArray(AppState.mocks) ? AppState.mocks : []]);
    entries.push(['jeemax_mock_focus', _isObj(AppState.mockFocus) ? AppState.mockFocus : {}]);
    // Guarded DOM read: a missing element used to throw mid-commit and
    // reject the ENTIRE save transaction (every key, not just the username).
    entries.push(['jeemax_username', (document.getElementById('display-username') || {}).textContent || AppState.username || 'Grindset']);
    entries.push(['bounty_data', AppState.bounty]);

    // Persist error resolution targets under separate keys
    entries.push(['baseErrPhys', baseErrorTargets.physics]);
    entries.push(['baseErrChem', baseErrorTargets.chemistry]);
    entries.push(['baseErrMath', baseErrorTargets.maths]);

    if (AppState.profilePicData) {
        entries.push(['jeemax_profile_pic', AppState.profilePicData]);
    }

    await idbSetMany(entries);

    // Baseline for the next multi-tab adoption pass: this commit is now the
    // newest known state of every question this tab holds.
    _captureBankSigs();

    // Only touch the image vault when its signature actually changed. A vault
    // failure (quota) must NOT stall the ledger, cloud sync or the multi-tab
    // broadcast — the stale signature makes the next save retry the vault.
    try {
        await persistImageCacheIfChanged();
    } catch (e) {
        console.error('image vault persist failed:', e);
    }
    await updateDailyHistory();

    // ── Bump the app-wide "data changed" counter so memoized derivations
    //    (nav rings / badges) can invalidate instantly instead of polling. ──
    try { window.__jmaxDataDirty = (window.__jmaxDataDirty || 0) + 1; } catch (_) {}

    if (typeof AppState.driveAccessToken !== 'undefined' && AppState.driveAccessToken) {
        syncStateToCloud();
    }

    // Tell sibling tabs a commit landed so they can merge counters/ids
    // (multi-tab reconciliation — audit item [11]).
    _broadcastTabSaved();
}

/**
 * One-time defensive repair for banked questions that can never be valid
 * as stored (legacy ingestion bugs):
 *   1. type 'mcq' with NO options — an impossible state. The old parser
 *      comma-split free-text answers ("(a) ..., (b)(i) ...") into arrays and
 *      forced type='mcq', which rendered a "Reveal Answer" button while
 *      practiceSubmit demanded an option selection. Downgrade to 'text' so
 *      every flow (practice modal, matrix drawer, checkpoint) treats them as
 *      self-report instead of blocking on a selection that can't exist.
 *   2. Array answers with NO options — arrays only mean anything for
 *      multi-correct MCQs (which always carry options). Collapse back to a
 *      single joined string so checkpoint's getQuestionMode can't take the
 *      'multi' branch with zero options to render.
 * Type values are also lower-cased so exotic casing ("MCQ", "Text") can never
 * bypass the canonical 'mcq'/'numeric'/'text' checks.
 *
 * Idempotent and non-destructive: valid questions (mcq+options, arrays with
 * options, numeric, subjective, etc.) are never touched. Runs at every cold
 * load; the repaired shape persists on the next save.
 */
function _repairQuestionBank() {
    const bank = AppState.questionBank;
    if (!Array.isArray(bank)) return;
    for (const q of bank) {
        if (!q || typeof q !== 'object') continue;
        if (typeof q.type === 'string') q.type = q.type.trim().toLowerCase();
        const noOptions = !Array.isArray(q.options) || q.options.length === 0;
        if (q.type === 'mcq' && noOptions) q.type = 'text';
        if (Array.isArray(q.correctAnswer) && q.correctAnswer.length > 0 && noOptions) {
            q.correctAnswer = q.correctAnswer.join(', ');
        }
        // ── Deterministic LaTeX repair migration ──────────────────────────
        // Heals old batches (broken matrix row breaks, literal "\nList", and
        // raw unicode math glyphs) WITHOUT re-stamping. Idempotent — already
        // correct fields pass through untouched. Persists on the next save.
        for (const field of ['extractedText', 'correctAnswer', 'solution', 'hint']) {
            if (typeof q[field] === 'string') q[field] = repairLatex(q[field]);
        }
        if (Array.isArray(q.correctAnswer)) {
            for (let i = 0; i < q.correctAnswer.length; i++) {
                if (typeof q.correctAnswer[i] === 'string') q.correctAnswer[i] = repairLatex(q.correctAnswer[i]);
            }
        }
        if (Array.isArray(q.options)) {
            for (let i = 0; i < q.options.length; i++) {
                if (typeof q.options[i] === 'string') q.options[i] = repairLatex(q.options[i]);
            }
        }
    }
}

export async function loadDataAsync() {
    // ── Single-transaction cold boot: ~20 sequential IDB reads used to run
    //    one after another; now they resolve in one transaction. ──
    let g;
    try {
        g = await idbGetMany([
            'jeemax_question_bank', 'jeemax_chapters', 'bounty_data',
            'jeemax_solved', 'jeemax_study_secs', 'jeemax_mood_multiplier',
            'jeemax_elo', 'jeemax_elo_updated_at', 'jeemax_practice_mode', 'jeemax_hardcore_daily',
            'jeemax_calibration_log', 'jeemax_chapter_theta',
            'jeemax_chapter_weights_ai', 'jeemax_chapter_weights_user',
            'jeemax_mocks', 'jeemax_mock_focus',
            'jeemax_username', 'jeemax_profile_pic', 'gemini_api_key',
            'jeeTargetLockDate', 'basePhys', 'baseChem', 'baseMath',
            'baseErrPhys', 'baseErrChem', 'baseErrMath',
        ]);
        // Storage answered — this session may persist again.
        _degradedBootRead = false;
    } catch (e) {
        // A failed open/read must NOT hang or kill boot (private mode,
        // eviction). Fall back to a clean slate; the persistence banner
        // explains that nothing will survive a reload.
        _reportPersistFailure('loadDataAsync', e);
        g = {};
        // ── Wipe-propagation latch ──
        // The in-memory state is now EMPTY while the real rows may still be
        // intact on disk (the failure can be transient). Any full-bank commit
        // or auto cloud push made from this gutted state would permanently
        // destroy the local AND off-device copies, so every destructive write
        // path checks _degradedBootRead and refuses until a reload succeeds.
        _degradedBootRead = true;
        console.error('[storage] Boot read failed — persistence writes are BLOCKED this session to protect existing data.');
    }

    // Ask the browser to make our storage persistent (never evicted under
    // pressure). Months of question banks + solve history live here, so
    // best-effort storage is the wrong default. Silent no-op where denied.
    try {
        if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
            navigator.storage.persist().catch(() => {});
        }
    } catch (_) {}
    const bank = g['jeemax_question_bank'];
    const ch = g['jeemax_chapters'];
    const savedBounty = g['bounty_data'];
    const s = g['jeemax_solved'];
    const secs = g['jeemax_study_secs'];
    const mood = g['jeemax_mood_multiplier'];
    const savedElo = g['jeemax_elo'];
    const savedEloUpdatedAt = g['jeemax_elo_updated_at'];
    const savedMode = g['jeemax_practice_mode'];
    const hcDaily = g['jeemax_hardcore_daily'];
    const username = g['jeemax_username'];
    const pfp = g['jeemax_profile_pic'];
    const savedKey = g['gemini_api_key'];
    const lockDate = g['jeeTargetLockDate'];
    const basePhys = g['basePhys'];
    const baseChem = g['baseChem'];
    const baseMath = g['baseMath'];
    const errPhys = g['baseErrPhys'];
    const errChem = g['baseErrChem'];
    const errMath = g['baseErrMath'];

    if (bank) AppState.questionBank = bank;
    _repairQuestionBank();

    // Re-attach cached images (bounded LRU cache) onto the live bank.
    await hydrateImageCache();

    // Baseline for multi-tab adoption: what we just loaded is "ours".
    _captureBankSigs();

    if (ch) AppState.chapters = ch;

    if (savedBounty) {
        AppState.bounty.date = savedBounty.date;
        AppState.bounty.active = savedBounty.active;
        AppState.bounty.questionId = savedBounty.questionId;
        AppState.bounty.timeLimit = savedBounty.timeLimit;
        AppState.bounty.payoffCount = savedBounty.payoffCount;
        AppState.bounty.done = savedBounty.done;
    }

    if (s) {
        // Coerce to numbers — a stored STRING "5" would otherwise concatenate
        // in changeCount ("5"+1 = "51") and corrupt the daily counters.
        solved.physics = Number(s.physics) || 0;
        solved.chemistry = Number(s.chemistry) || 0;
        solved.maths = Number(s.maths) || 0;
    }

    if (secs) {
        studySecs.physics = Number(secs.physics) || 0;
        studySecs.chemistry = Number(secs.chemistry) || 0;
        studySecs.maths = Number(secs.maths) || 0;
    }

    if (mood !== null) {
        const moodNum = parseFloat(mood);
        AppState.moodMultiplier = isFinite(moodNum) ? moodNum : 1.0;
    }

    // ── Hydrate Cognitive MMR / Elo Matrix instantly with fallback defaults ──
    // Every axis is guarded so a missing/corrupt profile field can never
    // produce a NaN data gap — it always falls back to the 1200 baseline.
    if (savedElo && typeof savedElo === 'object') {
        AppState.elo.physics   = (typeof savedElo.physics   === 'number' && isFinite(savedElo.physics))   ? savedElo.physics   : 1200;
        AppState.elo.chemistry = (typeof savedElo.chemistry === 'number' && isFinite(savedElo.chemistry)) ? savedElo.chemistry : 1200;
        AppState.elo.maths     = (typeof savedElo.maths     === 'number' && isFinite(savedElo.maths))     ? savedElo.maths     : 1200;
        AppState.elo.global    = (typeof savedElo.global    === 'number' && isFinite(savedElo.global))    ? savedElo.global    : 1200;
    } else {
        AppState.elo.physics   = 1200;
        AppState.elo.chemistry = 1200;
        AppState.elo.maths     = 1200;
        AppState.elo.global    = 1200;
    }
    AppState.eloUpdatedAt = (typeof savedEloUpdatedAt === 'number' && isFinite(savedEloUpdatedAt)) ? savedEloUpdatedAt : 0;

    // ── Elo v2 + metacognition hydration (these were session-only before —
    //    every reload used to reset them, so stats never accumulated). Every
    //    field is defensively validated; corrupt/missing entries fall back to
    //    the same clean-slate defaults _ensureEloV2State() would create. ──
    const calLog = g['jeemax_calibration_log'];
    if (Array.isArray(calLog)) {
        AppState.calibrationLog = calLog
            .filter(e => e && typeof e === 'object')
            .map(e => ({
                t: Number(e.t) || 0,
                p: Math.min(1, Math.max(0, Number(e.p) || 0)),
                s: Math.min(1, Math.max(0, Number(e.s) || 0)),
            }))
            .filter(e => e.t > 0)
            .slice(-CALIBRATION_LOG_CAP);
    }
    if (savedElo && typeof savedElo === 'object' && savedElo.rd && typeof savedElo.rd === 'object') {
        const rd = {};
        for (const k of Object.keys(savedElo.rd)) {
            const n = Number(savedElo.rd[k]);
            if (isFinite(n) && n > 0) rd[k] = n;
        }
        AppState.elo.rd = rd;
    }
    const savedTheta = g['jeemax_chapter_theta'];
    if (savedTheta && typeof savedTheta === 'object' && !Array.isArray(savedTheta)) {
        const theta = {};
        for (const k of Object.keys(savedTheta)) {
            const node = savedTheta[k];
            if (node && typeof node === 'object' && isFinite(Number(node.e))) {
                theta[k] = { e: Number(node.e), n: Math.max(0, Math.round(Number(node.n) || 0)) };
            }
        }
        AppState.chapterTheta = theta;
    }
    const savedAiWeights = g['jeemax_chapter_weights_ai'];
    if (savedAiWeights && typeof savedAiWeights === 'object' && !Array.isArray(savedAiWeights)) {
        AppState.chapterWeights = savedAiWeights;
    }
    const savedUserWeights = g['jeemax_chapter_weights_user'];
    if (savedUserWeights && typeof savedUserWeights === 'object' && !Array.isArray(savedUserWeights)) {
        AppState.userChapterWeights = savedUserWeights;
    }
    const savedMocks = g['jeemax_mocks'];
    if (Array.isArray(savedMocks)) AppState.mocks = savedMocks;
    const savedMockFocus = g['jeemax_mock_focus'];
    if (savedMockFocus && typeof savedMockFocus === 'object' && !Array.isArray(savedMockFocus)) {
        AppState.mockFocus = savedMockFocus;
    }

    // Hydrate active practice mode + hardcore daily counter (resets daily)
    if (savedMode && PRACTICE_MODES.includes(savedMode)) AppState.practiceFlowMode = savedMode;
    if (hcDaily && typeof hcDaily === 'object') {
        // Local day key — every writer/gate (app.js todayLocalKey, boot-sequence)
        // buckets by local date; a UTC key here reset the cap at 05:30 IST and
        // granted a phantom extra quota before local midnight in UTC− zones.
        const today = todayLocalKey();
        AppState.hardcoreDailyDate   = hcDaily.date || null;
        AppState.hardcoreDailyCount  = (hcDaily.date === today) ? (hcDaily.count || 0) : 0;
    }

    if (username) {
        document.getElementById('display-username').textContent = username;
        document.getElementById('set-username').value = username;
    }

    if (pfp) {
        AppState.profilePicData = pfp;
        document.getElementById('display-pfp').src = pfp;
    }

    if (savedKey) {
        AppState.geminiApiKey = savedKey;
    }
    const geminiKeyInput = document.getElementById('gemini-key');
    if (geminiKeyInput) geminiKeyInput.value = AppState.geminiApiKey;

    if (lockDate) {
        const diff = (new Date() - new Date(lockDate)) / (1000 * 60 * 60 * 24);
        if (diff < 1) _ui('lockTargetsOnly');
    }

    if (basePhys !== null) baseTargets.physics = parseInt(basePhys);
    if (baseChem !== null) baseTargets.chemistry = parseInt(baseChem);
    if (baseMath !== null) baseTargets.maths = parseInt(baseMath);

    document.getElementById('set-tgt-phys').value = baseTargets.physics;
    document.getElementById('set-tgt-chem').value = baseTargets.chemistry;
    document.getElementById('set-tgt-math').value = baseTargets.maths;

    // ── Load error resolution targets from separate IndexedDB keys ──
    if (errPhys !== null) baseErrorTargets.physics = parseInt(errPhys);
    if (errChem !== null) baseErrorTargets.chemistry = parseInt(errChem);
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
    // A failed fetch (offline / expired token / transient 4xx-5xx) must not be
    // memoized for the whole session — drop the entry so the next lazy-load
    // retries once connectivity or the token recovers.
    fetchPromise.then(url => { if (!url) delete AppState.imageFetchCache[fileId]; },
                     () => { delete AppState.imageFetchCache[fileId]; });
    return fetchPromise;
}

export async function cacheAllDriveImages() {
  if (!AppState.driveAccessToken) { alert('Please connect Google Drive first.'); return; }
  showLoading('Caching all Drive images locally…');
  let fixed = 0;
  try {
    for (const q of AppState.questionBank) {
      if (q.driveImageId && !q.imageDataUrl) {
        try { const url = await fetchMediaFromDrive(q.driveImageId, AppState.driveAccessToken); if (url) { q.imageDataUrl = url; fixed++; } } catch (e) {}
      }
      if (q.driveDiagramId && !q.diagramImageUrl) {
        try { const url = await fetchMediaFromDrive(q.driveDiagramId, AppState.driveAccessToken); if (url) { q.diagramImageUrl = url; fixed++; } } catch (e) {}
      }
    }
    await saveAllAsync();
  } finally {
    hideLoading();
  }
  if (fixed > 0) { alert(`✅ Cached ${fixed} images locally — they're kept on this device for good.`); }
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
    // Guard: Google Identity Services is loaded from a CDN. If that script
    // failed to load (network block, offline boot), google.accounts is
    // undefined — a TypeError here would abort initApp() before the math
    // watchdog attached, leaving every $...$ fragment raw forever.
    //
    // PERF: the GSI <script> is now async (off the DCL critical path), so it
    // may legitimately still be downloading when initDrive runs. Wait a
    // bounded window for it before declaring it absent — full Drive
    // functionality preserved, zero main-thread blocking either way.
    const gsiDeadline = Date.now() + 8000;
    while ((typeof google === 'undefined' || !google.accounts || typeof google.accounts.oauth2 !== 'object')
        && Date.now() < gsiDeadline) {
        await new Promise(r => setTimeout(r, 250));
    }
    if (typeof google === 'undefined' || !google.accounts || typeof google.accounts.oauth2 !== 'object') {
        console.warn('[initDrive] Google Identity Services unavailable — Drive sync disabled.');
        return;
    }
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
        if (syncSubText) { syncSubText.textContent = "Drive disconnected – reconnect in Settings"; syncSubText.style.color = "var(--glow-red)"; }
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
    // Returns the summed cloud counters, 0 when no state file exists yet,
    // or null when the cloud could not be reached/parsed (state UNKNOWN).
    // Callers that guard against destructive overwrites must treat null as
    // "cannot verify → refuse", never as "empty".
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
        return 0; // no state file yet — verified empty
    } catch (e) {}
    return null;
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
                        // id → question Map: the merge used to .find() per cloud
                        // question (O(n·m) — ~9M comparisons at 3k×3k every poll).
                        const localById = new Map(AppState.questionBank.map(q => [q.id, q]));
                        // Union remote deletions BEFORE filtering, so a question
                        // deleted on another device is dropped here too.
                        await _mergeRemoteTombstones(cloudState.tombstones);
                        cloudState.questionBank.forEach(cloudQ => {
                            if (!cloudQ || cloudQ.id === undefined || cloudQ.id === null) return;
                            if (_isTombstoned(cloudQ.id)) return; // user deleted this — never resurrect
                            const localQ = localById.get(cloudQ.id);
                            if (!localQ) { AppState.questionBank.push(cloudQ); localById.set(cloudQ.id, cloudQ); }
                            else if (cloudQ.status === 'solved' && localQ.status !== 'solved') localQ.status = 'solved';
                        });
                    }
                    if (cloudState.chapters) {
                        for (let subj in cloudState.chapters) {
                            if (!AppState.chapters[subj]) AppState.chapters[subj] = [];
                            cloudState.chapters[subj].forEach(ch => { if (!AppState.chapters[subj].includes(ch)) AppState.chapters[subj].push(ch); });
                        }
                    }
                    const todayStr = todayLocalKey();
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
                    // ── Elo Matrix: last-write-wins via eloUpdatedAt stamp ──
                    _mergeEloFromCloud(cloudState.elo, cloudState.eloUpdatedAt);
                }
            }
        }
        if (subText) subText.textContent = "Updating interface fields...";
        await idbSet('jeemax_question_bank', AppState.questionBank.map(_stripBankImages));
        await persistImageCacheIfChanged();
        await idbSet('jeemax_chapters', AppState.chapters);
        await idbSet('jeemax_solved', solved);
        await idbSet('jeemax_study_secs', studySecs);
        await updateDailyHistory();
        _ui('updateUI'); _ui('updateStudyTimeHeader'); _ui('renderGraph'); _ui('renderErrorMatrixFromBank');

        if (subText) subText.textContent = "Uploading consolidated data...";
        const localTotal = (solved.physics || 0) + (solved.chemistry || 0) + (solved.maths || 0);
        if (localTotal === 0 && AppState.questionBank.length === 0) {
            const cloudTotal = await getCloudSolvedTotal();
            // cloudTotal > 0: cloud holds data — never overwrite it with an
            // empty local state. cloudTotal === null: cloud could not be
            // verified — refuse as well rather than risk a blind clobber.
            if (cloudTotal !== 0) {
                if (subText) { subText.textContent = "Sync skipped – preserving cloud data"; subText.style.color = "#fbbf24"; setTimeout(() => { subText.textContent = "System Idle"; subText.style.color = "#fff"; }, 3000); }
                return;
            }
        }
        // Strip inline images from the cloud payload (mirrors syncStateToCloud)
        // — driveImageId re-fetches them on demand; keeps Drive JSON lean.
        const payload = { date: todayLocalKey(), questionBank: AppState.questionBank.map(_stripBankImages), chapters: AppState.chapters, solved, studySecs, elo: { ...AppState.elo }, eloUpdatedAt: AppState.eloUpdatedAt || 0, dailyHistory: await getDailyHistory(), tombstones: [...(await _getTombstones())] };
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

// Coalesce auto cloud pushes: the full bank (minus images) is uploaded on
// every save when Drive is linked — that is megabytes of JSON + image uploads
// per solve on iPad. Throttle to one push per 30s (manual sync bypasses).
const CLOUD_PUSH_THROTTLE_MS = 30000;
let _lastCloudPushAt = 0;
let _cachedCloudFileId = null;   // system_state.json fileId, resolved once per session
let _cloudSyncInFlight = false;
let _cloudSyncQueued = false;

// ── Cloud tombstones ──
// Question ids the user explicitly deleted are recorded here (persisted in
// IDB) so a later heartbeat/manual merge from a stale cloud snapshot can
// never resurrect them. Lazy-loaded on first use.
const CLOUD_TOMBSTONE_KEY = 'jeemax_cloud_tombstones';
let _tombstones = null;

async function _getTombstones() {
    if (_tombstones) return _tombstones;
    let list = [];
    try { list = (await idbGet(CLOUD_TOMBSTONE_KEY)) || []; } catch (e) { list = []; }
    _tombstones = new Set(Array.isArray(list) ? list.map(String) : []);
    return _tombstones;
}

/** Record a question id the user deleted so cloud merges never revive it. */
export async function recordCloudTombstone(id) {
    if (id === undefined || id === null || id === '') return;
    try {
        const t = await _getTombstones();
        t.add(String(id));
        await idbSet(CLOUD_TOMBSTONE_KEY, [...t]);
    } catch (e) { /* tombstones are best-effort */ }
}

function _isTombstoned(id) {
    return !!_tombstones && _tombstones.has(String(id));
}

/**
 * Union remote tombstones into the local set and persist once [AUDIT P2].
 * Without this, a deletion on device A never reached device B: B kept the
 * deleted question, and its next push resurrected it in the cloud forever.
 */
async function _mergeRemoteTombstones(remoteList) {
    if (!Array.isArray(remoteList) || remoteList.length === 0) return;
    const t = await _getTombstones();
    let added = false;
    for (const id of remoteList) {
        const s = String(id);
        if (s && !t.has(s)) { t.add(s); added = true; }
    }
    if (!added) return;
    try { await idbSet(CLOUD_TOMBSTONE_KEY, [...t]); } catch (e) { /* best-effort */ }
}

// ── Elo last-write-wins ──
// Both payloads carry `eloUpdatedAt` (epoch ms, stamped on every local Elo
// write). The side with the NEWER stamp wins wholesale; if both sides are
// legacy (stamp 0), fall back to the old high-water-mark merge so no one
// loses progress during migration.
function _mergeEloFromCloud(cloudElo, cloudUpdatedAt) {
    if (!cloudElo || typeof cloudElo !== 'object') return;
    const cloudAt = Number(cloudUpdatedAt) || 0;
    const localAt = Number(AppState.eloUpdatedAt) || 0;
    if (cloudAt > localAt) {
        AppState.elo.physics   = (typeof cloudElo.physics   === 'number' && isFinite(cloudElo.physics))   ? cloudElo.physics   : AppState.elo.physics;
        AppState.elo.chemistry = (typeof cloudElo.chemistry === 'number' && isFinite(cloudElo.chemistry)) ? cloudElo.chemistry : AppState.elo.chemistry;
        AppState.elo.maths     = (typeof cloudElo.maths     === 'number' && isFinite(cloudElo.maths))     ? cloudElo.maths     : AppState.elo.maths;
        AppState.elo.global    = (typeof cloudElo.global    === 'number' && isFinite(cloudElo.global))    ? cloudElo.global    : AppState.elo.global;
        AppState.eloUpdatedAt = cloudAt;
        return;
    }
    if (cloudAt === 0 && localAt === 0) {
        if (typeof cloudElo.physics   === 'number' && isFinite(cloudElo.physics))   AppState.elo.physics   = Math.max(AppState.elo.physics,   cloudElo.physics);
        if (typeof cloudElo.chemistry === 'number' && isFinite(cloudElo.chemistry)) AppState.elo.chemistry = Math.max(AppState.elo.chemistry, cloudElo.chemistry);
        if (typeof cloudElo.maths     === 'number' && isFinite(cloudElo.maths))     AppState.elo.maths     = Math.max(AppState.elo.maths,     cloudElo.maths);
        if (typeof cloudElo.global    === 'number' && isFinite(cloudElo.global))    AppState.elo.global    = Math.max(AppState.elo.global,    cloudElo.global);
    }
    // cloudAt < localAt (or equal stamps): local state is newer — keep local.
}

export async function syncStateToCloud(force = false) {
    if (!AppState.driveAccessToken || !AppState.cloudFolderId) return;
    if (_cloudSyncInFlight) { _cloudSyncQueued = true; return; } // coalesce overlapping pushes
    if (!force) {
        const now = Date.now();
        if (now - _lastCloudPushAt < CLOUD_PUSH_THROTTLE_MS) return; // coalesced
        if (document.hidden) return;                                  // skip when backgrounded
        _lastCloudPushAt = now;
    }
    _cloudSyncInFlight = true;
    try {
        const subText = document.getElementById('sync-sub-text');
        if (subText) subText.textContent = "Processing media files...";

        // ── Wipe-propagation guards (mirror executeUnifiedSync's protection) ──
        // 1) A failed boot read leaves the in-memory state empty; pushing it
        //    would destroy the off-device copy. The manual sync path already
        //    refuses this — the automatic path must refuse it too.
        if (_degradedBootRead) {
            console.warn('[cloud] Auto-push skipped: boot read degraded this session — refusing to overwrite cloud state with an unverified local state.');
            return;
        }
        // 2) Genuinely-empty local state (fresh-looking): verify the cloud is
        //    also empty before overwriting. If the cloud holds data — or can't
        //    be checked — refuse rather than clobber.
        {
            const _localTotal = (solved.physics || 0) + (solved.chemistry || 0) + (solved.maths || 0);
            if (_localTotal === 0 && AppState.questionBank.length === 0) {
                let _cloudTotal = null;
                try { _cloudTotal = await getCloudSolvedTotal(); } catch (_) { _cloudTotal = null; }
                if (_cloudTotal !== 0) {
                    console.warn('[cloud] Auto-push refused: local bank/counters are empty' +
                        (_cloudTotal > 0 ? ' while the cloud mirror holds data.' : ' and the cloud state could not be verified.') +
                        ' Possible storage degradation — nothing was overwritten.');
                    return;
                }
            }
        }

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
            let cloudQ = _stripBankImages(q);
            cloudQuestionBank.push(cloudQ);
        }
        if (newlyUploaded) {
            await idbSet('jeemax_question_bank', AppState.questionBank.map(_stripBankImages));
            await persistImageCacheIfChanged();
        }
        if (subText) subText.textContent = "Syncing system state...";
        const payload = { date: todayLocalKey(), questionBank: cloudQuestionBank, chapters: AppState.chapters, solved, studySecs, elo: { ...AppState.elo }, eloUpdatedAt: AppState.eloUpdatedAt || 0, dailyHistory: await getDailyHistory(), tombstones: [...(await _getTombstones())] };
        // fileId cache [AUDIT P1-11 staging]: every push used to re-run the
        // Drive file-search round-trip. Cache per session; invalidate on 404
        // (folder/file deleted mid-session) so the next push recreates it.
        let fileId = _cachedCloudFileId;
        if (!fileId) {
            const query = `name='system_state.json' and '${AppState.cloudFolderId}' in parents and trashed=false`;
            let searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${AppState.driveAccessToken}` } });
            if (!searchRes.ok) { if (searchRes.status === 404) throw new Error("Target cloud storage folder directory not found."); throw new Error(`Drive connection interface dropped with code: ${searchRes.status}`); }
            let searchData = await searchRes.json();
            fileId = searchData.files && searchData.files.length > 0 ? searchData.files[0].id : null;
        }
        if (!fileId) {
            let createRes = await fetch('https://www.googleapis.com/drive/v3/files', { method: 'POST', headers: { Authorization: `Bearer ${AppState.driveAccessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'system_state.json', parents: [AppState.cloudFolderId] }) });
            if (!createRes.ok) throw new Error(`Failed to generate system JSON metadata container file shell.`);
            let createData = await createRes.json(); fileId = createData.id;
        }
        if (fileId) {
            let uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, { method: 'PATCH', headers: { Authorization: `Bearer ${AppState.driveAccessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!uploadRes.ok) {
                if (uploadRes.status === 404) _cachedCloudFileId = null; // file deleted mid-session — re-search next push
                throw new Error(`State content array matrix synchronization delivery fault.`);
            }
            _cachedCloudFileId = fileId;
            if (subText) { subText.textContent = "Sync Complete ✔"; subText.style.color = "var(--glow-green)"; setTimeout(() => { subText.textContent = "System Idle"; subText.style.color = "#fff"; }, 3000); }
        }
    } catch (e) {
        console.error("Sync Engine Exception:", e);
        const subText = document.getElementById('sync-sub-text');
        if (subText) { subText.textContent = "Sync Failed ✖"; subText.style.color = "var(--glow-red)"; }
    } finally {
        _cloudSyncInFlight = false;
        if (_cloudSyncQueued) {
            // A save landed while we were pushing — run once more so the
            // newest state still reaches the cloud. Bypass the throttle so
            // the queued push actually executes.
            _cloudSyncQueued = false;
            _lastCloudPushAt = 0;
            syncStateToCloud(true);
        }
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
                // id → question Map (was .find() per cloud question — O(n·m))
                const localById = new Map(AppState.questionBank.map(q => [q.id, q]));
                // Union remote deletions BEFORE filtering (cross-device delete).
                await _mergeRemoteTombstones(cloudState.tombstones);
                cloudState.questionBank.forEach(cloudQ => {
                    if (!cloudQ || cloudQ.id === undefined || cloudQ.id === null) return;
                    if (_isTombstoned(cloudQ.id)) return; // user deleted this — never resurrect
                    const localQ = localById.get(cloudQ.id);
                    if (!localQ) { AppState.questionBank.push(cloudQ); localById.set(cloudQ.id, cloudQ); }
                    else if (cloudQ.status === 'solved' && localQ.status !== 'solved') localQ.status = 'solved';
                });
                // Persist the merged bank so the merge survives a crash before
                // the next saveAllAsync, and so the heartbeat doesn't re-run
                // the same merge on every poll.
                try { await idbSet('jeemax_question_bank', AppState.questionBank.map(_stripBankImages)); } catch (e) {}
            }
            if (cloudState.chapters) {
                for (let subj in cloudState.chapters) { if (!AppState.chapters[subj]) AppState.chapters[subj] = []; cloudState.chapters[subj].forEach(ch => { if (!AppState.chapters[subj].includes(ch)) AppState.chapters[subj].push(ch); }); }
            }
            if (cloudState.dailyHistory) {
                let ledger = {}; try { ledger = await getSolvedByDate(); } catch (e) { ledger = {}; }
                cloudState.dailyHistory.forEach(entry => {
                    if (!entry || !entry.date) return;
                    const e = ledger[entry.date] || (ledger[entry.date] = { date: entry.date, physics: 0, chemistry: 0, maths: 0 });
                    const c = Number(entry.count) || 0;
                    const curTotal = (Number(e.physics) || 0) + (Number(e.chemistry) || 0) + (Number(e.maths) || 0);
                    if (entry.physics != null || entry.chemistry != null || entry.maths != null) {
                        e.physics = Math.max(Number(e.physics) || 0, Number(entry.physics) || 0);
                        e.chemistry = Math.max(Number(e.chemistry) || 0, Number(entry.chemistry) || 0);
                        e.maths = Math.max(Number(e.maths) || 0, Number(entry.maths) || 0);
                    } else if (c > curTotal) {
                        // Cloud carries only a total; attribute the extra to physics to preserve the figure.
                        e.physics = (Number(e.physics) || 0) + (c - curTotal);
                    }
                    e.count = (Number(e.physics) || 0) + (Number(e.chemistry) || 0) + (Number(e.maths) || 0);
                    e.date = e.date || entry.date;
                });
                try { await idbSet(DAILY_SOLVED_LEDGER, ledger); } catch (e) {}
                const mergedArr = Object.keys(ledger).map(d => ({ date: d, ...(ledger[d] || {}) })).sort((a, b) => a.date.localeCompare(b.date));
                try { await idbSet('jeemax_daily_history', mergedArr); } catch (e) {}
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
            const todayStr = todayLocalKey();
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
            // ── Elo Matrix: last-write-wins via eloUpdatedAt stamp. Ratings
            // are cumulative skill capital — unlike daily counters, they are
            // NOT date-scoped. LWW lets real (downward) changes propagate
            // instead of the old high-water-mark merge. ──
            _mergeEloFromCloud(cloudState.elo, cloudState.eloUpdatedAt);
            // else: stale cloud date — LOCAL WINS. Intentionally no-op.
            // The daily counters belong to the current local day; a
            // yesterday-cloud snapshot has no authority to zero them out.
            _ui('updateUI'); _ui('updateStudyTimeHeader'); _ui('renderGraph'); _ui('renderErrorMatrixFromBank');
        }
    } catch (e) { console.error("Failed to download state from cloud:", e); } finally { if (!isBackground) hideLoading(); }
}

// ==================== PERMANENT DAILY HISTORY TRACKER ====================
// Daily solved counts are stored in IndexedDB and NEVER deleted. Every date a
// question was solved is reconstructed from the question bank (which itself
// lives permanently in IndexedDB), merged with today's live counters, and
// written back. Old days are never shifted out.
const DAILY_SOLVED_LEDGER = 'jeemax_solved_by_date_v1';

export async function persistSolvedByDate() {
    // 1) Rebuild every date from the question bank's solve timestamps.
    const byDate = {};
    const qb = AppState.questionBank || [];
    for (const q of qb) {
        if (!q || q.status !== 'solved') continue;
        const t = q.lastReviewedAt || q.solvedAt || q.ts || q.date;
        if (!t) continue;
        const d = formatDateKey(new Date(t));
        if (!byDate[d]) byDate[d] = { physics: 0, chemistry: 0, maths: 0 };
        byDate[d][normSubjKey(q.subject)]++;
    }
    // 2) Always fold today's live counters in (they may not be in the bank yet).
    const today = todayLocalKey();
    const todayE = byDate[today] || (byDate[today] = { physics: 0, chemistry: 0, maths: 0 });
    todayE.physics = Math.max(todayE.physics, solved.physics || 0);
    todayE.chemistry = Math.max(todayE.chemistry, solved.chemistry || 0);
    todayE.maths = Math.max(todayE.maths, solved.maths || 0);
    // 3) Merge into the permanent ledger — max per subject, union of all dates.
    let ledger = {};
    try { ledger = (await idbGet(DAILY_SOLVED_LEDGER)) || {}; } catch (e) { ledger = {}; }
    for (const d in byDate) {
        const cur = ledger[d];
        const b = byDate[d];
        if (cur && typeof cur === 'object') {
            cur.physics   = Math.max(Number(cur.physics)   || 0, b.physics);
            cur.chemistry = Math.max(Number(cur.chemistry) || 0, b.chemistry);
            cur.maths     = Math.max(Number(cur.maths)     || 0, b.maths);
        } else {
            ledger[d] = { date: d, physics: b.physics, chemistry: b.chemistry, maths: b.maths };
        }
    }
    for (const d in ledger) {
        const e = ledger[d];
        if (e && typeof e === 'object') {
            e.date = e.date || d;
            e.count = (Number(e.physics) || 0) + (Number(e.chemistry) || 0) + (Number(e.maths) || 0);
        }
    }
    try { await idbSet(DAILY_SOLVED_LEDGER, ledger); } catch (e) {}
    return ledger;
}

export async function getSolvedByDate() {
    try { return (await idbGet(DAILY_SOLVED_LEDGER)) || {}; } catch (e) { return {}; }
}

/**
 * Fold the live daily counters into a SPECIFIC day's ledger entry.
 * Called by the midnight rollover with YESTERDAY's key BEFORE the live
 * counters are zeroed — otherwise a solve at 23:59:59 whose save lands
 * after the reset is credited to neither day (and pollutes the new day).
 */
export async function settleDayCounters(dateKey) {
    if (!dateKey || typeof dateKey !== 'string') return;
    try {
        const ledger = (await idbGet(DAILY_SOLVED_LEDGER)) || {};
        const e = ledger[dateKey] || (ledger[dateKey] = { date: dateKey, physics: 0, chemistry: 0, maths: 0 });
        e.physics   = Math.max(Number(e.physics)   || 0, Number(solved.physics)   || 0);
        e.chemistry = Math.max(Number(e.chemistry) || 0, Number(solved.chemistry) || 0);
        e.maths     = Math.max(Number(e.maths)     || 0, Number(solved.maths)     || 0);
        e.count     = e.physics + e.chemistry + e.maths;
        await idbSet(DAILY_SOLVED_LEDGER, ledger);
    } catch (e) { /* ledger is best-effort; the bank rebuild covers most cases */ }
}

export async function getDailyHistory() {
    const ledger = await persistSolvedByDate();
    const arr = Object.keys(ledger)
        .map(d => ({ date: d, ...(ledger[d] || {}) }))
        .sort((a, b) => a.date.localeCompare(b.date));
    try { await idbSet('jeemax_daily_history', arr); } catch (e) {}
    try { window._dailyHistoryCache = arr; } catch (_) {}
    return arr;
}

export async function updateDailyHistory() { await getDailyHistory(); }
