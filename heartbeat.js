/**
 * heartbeat.js — KLSR Aizawa Toroidal Flux Engine & 30h Leaky Reservoir
 *
 * Psychological survival engine for JEEMaxxing:
 *   - Exclusively renders the Aizawa Toroidal Flux Manifold (WebGL2 HDR + 2D fallback)
 *   - 30.0h leaky reservoir draining -1.0h per real-world hour (-24.0h/day)
 *   - Decay freezes ONLY while locked into an active Pact / study session
 *   - Speed, Luminescence, Persistence, and Spread (0.50 max, reverse collapse)
 *     each measure a distinct clinical pillar
 *   - Continuous 5-stage RGB light spectrum (Xenon -> Ion -> UV -> Amber -> Crimson)
 *   - Boot sequence ignites at 100% Peak State then drains to true real-time vitals over 2.5s
 *   - Flatline at 0.0h triggers an unskippable Death Sequence and scorched-earth data wipe
 */

import {
    AppState,
    idbGet,
    idbSet,
    todayLocalKey,
    normSubjKeyStrict,
    getEloBand,
    getDueStatus,
    isDegradedBoot,
    wipeAllAppData,
} from './storage.js';
import { HeartbeatAudio } from './heartbeat-audio.js';

// ── Constants ───────────────────────────────────────────────────────────────
export const MAX_RESERVOIR_HOURS = 30.0;
export const DAILY_UNIT_TARGET = 20.0;      // starting bedrock per subject (60.0u/day total)
export const DAILY_UNIT_CAP = 26.0;         // starting overflow ceiling (+6.5h/subject)
export const HOURS_PER_UNIT = 0.25;         // 20u = +5.0h; 26u = +6.5h
export const SUBJECT_TARGET_HOURS = 5.0;    // break-even hours paid at 100% of each subject's floor
export const OVERFLOW_CAP_RATIO = 1.3;      // 1.3x subject floor = +6.5h max per subject
export const LEASH_EPOCH_DAYS = 7;          // 7-day rolling calibration window
export const LEASH_MIN_FLOOR = DAILY_UNIT_TARGET; // 20.0u bedrock per subject (strictly one-way upward)
export const LEASH_MAX_FLOOR = 40.0;        // hard per-subject ceiling (120.0u/day total)
export const LEASH_TIGHTEN_THRESHOLD = 1.05;// tighten if 7d trimmed avg >= 1.05x current floor
export const LEASH_STEP_BLEND = 0.50;       // move 50% of surplus above current floor
export const LEASH_MAX_STEP_RATIO = 1.08;   // cap per-epoch jump at +8%
export const DAILY_PACT_TARGET_MINS = 240;  // 4h/day deep Pact standard
export const DAILY_PACT_CAP_MINS = 280;     // overflow ceiling (+10.5h raw)
export const HOURS_PER_PACT_MIN = 9.0 / 240.0; // 0.0375h per Pact minute
export const FREEZE_IDLE_LIMIT_MS = 35 * 60 * 1000;     // 35m max without solve/interaction
export const STOPWATCH_MAX_FREEZE_MS = 3 * 3600 * 1000; // 3h continuous freeze cap

const STORAGE_KEY = 'jeemax_heartbeat_v1';
const HB_SYNC_CHANNEL = 'jmax-hb-sync';
const MIN_VALID_EPOCH_MS = 1704067200000; // 2024-01-01T00:00:00Z
const MAX_SINGLE_JUMP_MS = 365 * 24 * 3600 * 1000; // 1 year sanity ceiling
const SUBJECTS = ['physics', 'chemistry', 'maths'];
const BOOT_HOLD_MS = 900;
const BOOT_DRAIN_MS = 1600;
const BOOT_TOTAL_MS = BOOT_HOLD_MS + BOOT_DRAIN_MS;

const SPECTRUM_STOPS = [
    { h: 0.0,  name: 'ARTERIAL CRIMSON', core: [1.0, 0.38, 0.38],  edge: [0.88, 0.03, 0.06], accent: [1.0, 0.12, 0.16], css: '#ff2b3d' },
    { h: 3.0,  name: 'AMBER ARC',        core: [1.0, 0.96, 0.88],  edge: [1.0, 0.54, 0.16],  accent: [1.0, 0.78, 0.36], css: '#ff9436' },
    { h: 8.0,  name: 'UV LASER',         core: [0.99, 0.95, 1.0],  edge: [0.64, 0.32, 1.0],  accent: [0.34, 0.86, 1.0], css: '#a864ff' },
    { h: 16.0, name: 'ION SILVER',       core: [0.97, 0.98, 1.0],  edge: [0.46, 0.56, 0.98], accent: [0.72, 0.62, 1.0], css: '#86a2ff' },
    { h: 24.0, name: 'XENON WHITE',      core: [1.0, 0.995, 0.985], edge: [0.58, 0.82, 1.0], accent: [0.85, 0.92, 1.0], css: '#bce4ff' },
    { h: 30.0, name: 'XENON WHITE',      core: [1.0, 0.995, 0.985], edge: [0.58, 0.82, 1.0], accent: [0.85, 0.92, 1.0], css: '#e6f4ff' },
];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;
const lerp = (a, b, t) => a + (b - a) * t;
const lerpVec3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function _safeTodayKey(nowMs) {
    const d = Number.isFinite(nowMs) ? new Date(nowMs) : new Date();
    try { return todayLocalKey(d); } catch (_) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
}

function _parseDateKey(key) {
    if (typeof key !== 'string') return null;
    const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

function _formatDateKey(dt) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function _addCalendarDays(dateKey, deltaDays) {
    const dt = _parseDateKey(dateKey);
    if (!dt) return dateKey;
    dt.setDate(dt.getDate() + deltaDays);
    return _formatDateKey(dt);
}

function _daysBetweenKeys(fromKey, toKey) {
    const a = _parseDateKey(fromKey);
    const b = _parseDateKey(toKey);
    if (!a || !b) return 0;
    return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function _normalizeFloorVal(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return LEASH_MIN_FLOOR;
    const snapped = Math.round(n * 2) / 2;
    return clamp(snapped, LEASH_MIN_FLOOR, LEASH_MAX_FLOOR);
}

function _freshLeashState() {
    return {
        epoch: 1,
        floors: { physics: LEASH_MIN_FLOOR, chemistry: LEASH_MIN_FLOOR, maths: LEASH_MIN_FLOOR },
        pendingDays: [],
        history: [],
        lastCalibration: null,
    };
}

function _normalizeDayRecord(rec) {
    if (!rec || typeof rec !== 'object' || typeof rec.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) {
        return null;
    }
    const u = rec.units && typeof rec.units === 'object' ? rec.units : {};
    const f = rec.floors && typeof rec.floors === 'object' ? rec.floors : {};
    return {
        date: rec.date,
        units: {
            physics: round2(Math.max(0, Number(u.physics) || 0)),
            chemistry: round2(Math.max(0, Number(u.chemistry) || 0)),
            maths: round2(Math.max(0, Number(u.maths) || 0)),
        },
        pactMins: round2(Math.max(0, Number(rec.pactMins) || 0)),
        floors: {
            physics: _normalizeFloorVal(f.physics),
            chemistry: _normalizeFloorVal(f.chemistry),
            maths: _normalizeFloorVal(f.maths),
        },
    };
}

function _mergeDayArrays(arrA, arrB, limit) {
    const byDate = new Map();
    for (const src of [arrA, arrB]) {
        if (!Array.isArray(src)) continue;
        for (const raw of src) {
            const norm = _normalizeDayRecord(raw);
            if (!norm) continue;
            const prev = byDate.get(norm.date);
            if (!prev) {
                byDate.set(norm.date, norm);
            } else {
                byDate.set(norm.date, {
                    date: norm.date,
                    units: {
                        physics: Math.max(prev.units.physics, norm.units.physics),
                        chemistry: Math.max(prev.units.chemistry, norm.units.chemistry),
                        maths: Math.max(prev.units.maths, norm.units.maths),
                    },
                    pactMins: Math.max(prev.pactMins, norm.pactMins),
                    floors: {
                        physics: Math.max(prev.floors.physics, norm.floors.physics),
                        chemistry: Math.max(prev.floors.chemistry, norm.floors.chemistry),
                        maths: Math.max(prev.floors.maths, norm.floors.maths),
                    },
                });
            }
        }
    }
    const sorted = Array.from(byDate.values()).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    return limit > 0 ? sorted.slice(-limit) : sorted;
}

function _normalizeCalibration(cal) {
    if (!cal || typeof cal !== 'object' || typeof cal.date !== 'string') return null;
    const prevFloors = {};
    const nextFloors = {};
    const trimmedAvgs = {};
    for (const s of SUBJECTS) {
        prevFloors[s] = _normalizeFloorVal(cal.prevFloors && cal.prevFloors[s]);
        nextFloors[s] = Math.max(prevFloors[s], _normalizeFloorVal(cal.nextFloors && cal.nextFloors[s]));
        trimmedAvgs[s] = round2(Math.max(0, Number(cal.trimmedAvgs && cal.trimmedAvgs[s]) || 0));
    }
    const tightened = SUBJECTS.filter(s => nextFloors[s] > prevFloors[s]);
    return {
        epoch: Math.max(2, Math.floor(Number(cal.epoch) || 2)),
        date: cal.date,
        prevFloors,
        nextFloors,
        trimmedAvgs,
        tightened,
    };
}

function _freshDaily(dateKey) {
    return {
        date: dateKey || _safeTodayKey(),
        units: { physics: 0, chemistry: 0, maths: 0 },
        pactMins: 0,
        creditedIds: [],
        creditedPactHours: 0,
        creditedSubjHours: { physics: 0, chemistry: 0, maths: 0 },
    };
}

function _freshHeartbeatState(now = Date.now()) {
    return {
        version: 1,
        reservoirHours: MAX_RESERVOIR_HOURS,
        lastTickAt: now,
        highWaterMark: now,
        seededAt: now,
        lastParity: 1.0,
        flatlined: false,
        daily: _freshDaily(_safeTodayKey(now)),
        leash: _freshLeashState(),
    };
}

// ── Module State ────────────────────────────────────────────────────────────
let _hb = _freshHeartbeatState();
let _initialized = false;
let _clockTimer = null;
let _bootTimer = null;
let _bootStartedAt = 0;
let _pulseBoost = 0;
let _flatlineActive = false;
let _flatlineWipeDone = false;
let _flatlineStartedAt = 0;
let _voidEngine = null;
let _renderingPaused = false;
let _vitalsOpen = false;
let _navMenuOpen = false;
let _lastActivityAt = Date.now();
let _freezeStartedAt = null;
let _hbStorageDegraded = false;
let _flatlinePromise = null;
let _hbChannel = null;
let _lastLivePerfMs = null;
let _lastLiveWallMs = null;
const _hbTabId = (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : 'hb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

// ── Persistence & Multi-Tab Reconciliation ──────────────────────────────────
function _saveState(opts = {}) {
    if (_hbStorageDegraded || isDegradedBoot()) return;
    if (typeof window !== 'undefined' && window.__jmaxBackupRestoring) return;
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_hb));
        }
    } catch (_) {}
    try {
        if (typeof indexedDB !== 'undefined') {
            idbSet(STORAGE_KEY, _hb).catch(() => {});
        }
    } catch (_) {}
    if (!opts.silentBroadcast) {
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                if (!_hbChannel) _hbChannel = new BroadcastChannel(HB_SYNC_CHANNEL);
                _hbChannel.postMessage({ type: 'hb-update', tabId: _hbTabId, state: _hb });
            }
        } catch (_) {}
    }
}

function _isValidEpoch(v) {
    const n = Number(v);
    return Number.isFinite(n) && n >= MIN_VALID_EPOCH_MS;
}

function _normalizeLoadedState(raw, now = Date.now()) {
    const base = _freshHeartbeatState(now);
    if (!raw || typeof raw !== 'object') return base;
    const d = raw.daily && typeof raw.daily === 'object' ? raw.daily : {};
    const normUnits = {
        physics: Math.max(0, Number(d.units && d.units.physics) || 0),
        chemistry: Math.max(0, Number(d.units && d.units.chemistry) || 0),
        maths: Math.max(0, Number(d.units && d.units.maths) || 0),
    };
    const normSubjHrs = {
        physics: Math.max(0, Number(d.creditedSubjHours && d.creditedSubjHours.physics) || 0),
        chemistry: Math.max(0, Number(d.creditedSubjHours && d.creditedSubjHours.chemistry) || 0),
        maths: Math.max(0, Number(d.creditedSubjHours && d.creditedSubjHours.maths) || 0),
    };
    // Guard against corrupt NaN / "" / non-finite reservoirHours turning into 0 and falsely wiping.
    const rawHrs = raw.reservoirHours;
    const parsedHrs = (rawHrs === null || rawHrs === undefined || rawHrs === '') ? NaN : Number(rawHrs);
    const safeHrs = Number.isFinite(parsedHrs) ? clamp(parsedHrs, 0, MAX_RESERVOIR_HOURS) : MAX_RESERVOIR_HOURS;
    const rawParity = raw.lastParity;
    const parsedParity = (rawParity === null || rawParity === undefined || rawParity === '') ? NaN : Number(rawParity);
    const safeParity = Number.isFinite(parsedParity) ? clamp(parsedParity, 0, 1) : 1.0;

    const lRaw = raw.leash && typeof raw.leash === 'object' ? raw.leash : {};
    const leash = {
        epoch: Math.max(1, Math.floor(Number(lRaw.epoch) || 1)),
        floors: {
            physics: _normalizeFloorVal(lRaw.floors && lRaw.floors.physics),
            chemistry: _normalizeFloorVal(lRaw.floors && lRaw.floors.chemistry),
            maths: _normalizeFloorVal(lRaw.floors && lRaw.floors.maths),
        },
        pendingDays: _mergeDayArrays(lRaw.pendingDays, [], 0),
        history: _mergeDayArrays(lRaw.history, [], 28),
        lastCalibration: _normalizeCalibration(lRaw.lastCalibration),
    };

    return {
        version: 1,
        reservoirHours: safeHrs,
        lastTickAt: _isValidEpoch(raw.lastTickAt) ? Number(raw.lastTickAt) : now,
        highWaterMark: _isValidEpoch(raw.highWaterMark) ? Number(raw.highWaterMark) : now,
        seededAt: _isValidEpoch(raw.seededAt) ? Number(raw.seededAt) : now,
        lastParity: safeParity,
        flatlined: Boolean(raw.flatlined) && safeHrs <= 0,
        daily: {
            date: typeof d.date === 'string' && d.date ? d.date : _safeTodayKey(now),
            units: normUnits,
            pactMins: Math.max(0, Number(d.pactMins) || 0),
            creditedIds: Array.isArray(d.creditedIds) ? d.creditedIds.slice(-1500).map(String) : [],
            creditedPactHours: Math.max(0, Number(d.creditedPactHours) || 0),
            creditedSubjHours: normSubjHrs,
        },
        leash,
    };
}

function _dailyProgressScore(d) {
    if (!d || typeof d !== 'object') return 0;
    const u = d.units || {};
    return (Number(u.physics) || 0) + (Number(u.chemistry) || 0) + (Number(u.maths) || 0) + (Number(d.pactMins) || 0) * 0.1;
}

function _mergeHeartbeatRecords(localRaw, remoteRaw, now = Date.now()) {
    const a = _normalizeLoadedState(localRaw, now);
    const b = _normalizeLoadedState(remoteRaw, now);

    // Newer life (e.g. sibling tab clicked BEGIN FROM ZERO after flatline) always wins cleanly.
    if (b.seededAt > a.seededAt + 500) return b;
    if (a.seededAt > b.seededAt + 500) return a;

    // Within the same life, if one side is genuinely flatlined at a newer-or-equal clock, flatline wins.
    if (a.flatlined || b.flatlined) {
        if (a.flatlined && !b.flatlined && b.highWaterMark > a.highWaterMark + 2000 && b.reservoirHours > 0) return b;
        if (b.flatlined && !a.flatlined && a.highWaterMark > b.highWaterMark + 2000 && a.reservoirHours > 0) return a;
        return a.flatlined ? a : b;
    }

    // Merge daily buckets upward so sibling solves/Pact blocks are never lost.
    let daily;
    if (b.daily.date > a.daily.date) {
        daily = b.daily;
    } else if (a.daily.date > b.daily.date) {
        daily = a.daily;
    } else {
        const ids = Array.from(new Set([...a.daily.creditedIds, ...b.daily.creditedIds])).slice(-1500);
        daily = {
            date: a.daily.date,
            units: {
                physics: Math.max(a.daily.units.physics, b.daily.units.physics),
                chemistry: Math.max(a.daily.units.chemistry, b.daily.units.chemistry),
                maths: Math.max(a.daily.units.maths, b.daily.units.maths),
            },
            pactMins: Math.max(a.daily.pactMins, b.daily.pactMins),
            creditedIds: ids,
            creditedPactHours: Math.max(a.daily.creditedPactHours, b.daily.creditedPactHours),
            creditedSubjHours: {
                physics: Math.max(a.daily.creditedSubjHours.physics, b.daily.creditedSubjHours.physics),
                chemistry: Math.max(a.daily.creditedSubjHours.chemistry, b.daily.creditedSubjHours.chemistry),
                maths: Math.max(a.daily.creditedSubjHours.maths, b.daily.creditedSubjHours.maths),
            },
        };
    }

    // Strictly monotonic ratchet merge within the same life: floors & epoch only move upward.
    const la = a.leash;
    const lb = b.leash;
    const maxEpoch = Math.max(la.epoch, lb.epoch);
    const mergedPending = la.epoch !== lb.epoch
        ? (lb.epoch > la.epoch ? lb.pendingDays : la.pendingDays)
        : _mergeDayArrays(la.pendingDays, lb.pendingDays, 0);
    const mergedCal = lb.epoch > la.epoch
        ? lb.lastCalibration
        : (la.epoch > lb.epoch ? la.lastCalibration : (lb.lastCalibration || la.lastCalibration));
    const leash = {
        epoch: maxEpoch,
        floors: {
            physics: Math.max(la.floors.physics, lb.floors.physics),
            chemistry: Math.max(la.floors.chemistry, lb.floors.chemistry),
            maths: Math.max(la.floors.maths, lb.floors.maths),
        },
        pendingDays: mergedPending,
        history: _mergeDayArrays(la.history, lb.history, 28),
        lastCalibration: mergedCal,
    };

    // Align both records to the newer wall-clock instant before taking the max so
    // a stale background tab can neither pull reservoir down nor inject phantom hours.
    const maxTick = Math.max(a.lastTickAt, b.lastTickAt);
    const maxHwm = Math.max(a.highWaterMark, b.highWaterMark);
    const effA = Math.max(0, a.reservoirHours - Math.max(0, (maxTick - a.lastTickAt) / 3600000));
    const effB = Math.max(0, b.reservoirHours - Math.max(0, (maxTick - b.lastTickAt) / 3600000));
    const reservoirHours = Math.max(effA, effB);

    return {
        version: 1,
        reservoirHours: clamp(reservoirHours, 0, MAX_RESERVOIR_HOURS),
        lastTickAt: maxTick,
        highWaterMark: maxHwm,
        seededAt: Math.max(a.seededAt, b.seededAt),
        lastParity: Math.max(a.lastParity, b.lastParity),
        flatlined: false,
        daily,
        leash,
    };
}

async function _readPersistedHeartbeat() {
    let lsRaw = null;
    try {
        if (typeof localStorage !== 'undefined') {
            const s = localStorage.getItem(STORAGE_KEY);
            if (s) lsRaw = JSON.parse(s);
        }
    } catch (_) {}
    let idbRaw = null;
    let idbFailed = false;
    try {
        if (typeof indexedDB !== 'undefined') {
            idbRaw = await idbGet(STORAGE_KEY);
        }
    } catch (_) {
        idbFailed = true;
    }
    return { lsRaw, idbRaw, idbFailed };
}

async function _loadState() {
    const now = Date.now();
    const { lsRaw, idbRaw, idbFailed } = await _readPersistedHeartbeat();
    _hbStorageDegraded = Boolean(idbFailed || isDegradedBoot());

    let chosen = null;
    if (lsRaw && idbRaw) {
        chosen = _mergeHeartbeatRecords(lsRaw, idbRaw, now);
    } else {
        chosen = idbRaw || lsRaw;
    }
    _hb = _normalizeLoadedState(chosen, now);
    _calibrateLeashIfReady(_safeTodayKey(now));
    _saveState({ silentBroadcast: true });
}

function _adoptRemoteState(remoteRaw) {
    if (!remoteRaw || typeof remoteRaw !== 'object') return;
    const now = Date.now();
    const merged = _mergeHeartbeatRecords(_hb, remoteRaw, now);
    _hb = merged;
    _calibrateLeashIfReady(_safeTodayKey(now));
    if (!_hb.flatlined && _hb.reservoirHours > 0 && _flatlineActive && !_flatlineWipeDone) {
        _flatlineActive = false;
        const fl = typeof document !== 'undefined' ? document.getElementById('heartbeat-flatline-overlay') : null;
        if (fl) fl.hidden = true;
    }
    _refreshHudAndVitals();
}

// ── 7-Day Per-Subject Leash Ratchet ─────────────────────────────────────────
function _getSubjectFloor(subj) {
    const f = _hb.leash && _hb.leash.floors && _hb.leash.floors[subj];
    return _normalizeFloorVal(f);
}

function _getSubjectCap(subj) {
    return round2(_getSubjectFloor(subj) * OVERFLOW_CAP_RATIO);
}

function _getSubjectHoursPerUnit(subj) {
    return SUBJECT_TARGET_HOURS / _getSubjectFloor(subj);
}

function _trimmedMean(values) {
    const nums = (values || []).map(v => Math.max(0, Number(v) || 0));
    if (nums.length === 0) return 0;
    const sorted = nums.slice().sort((a, b) => a - b);
    const core = sorted.length >= 3 ? sorted.slice(1, -1) : sorted;
    const sum = core.reduce((acc, x) => acc + x, 0);
    return round2(sum / core.length);
}

function _computeNextSubjectFloor(currentFloor, trimmedAvg) {
    const cur = _normalizeFloorVal(currentFloor);
    if (!Number.isFinite(trimmedAvg) || trimmedAvg < cur * LEASH_TIGHTEN_THRESHOLD) {
        return cur;
    }
    if (cur >= LEASH_MAX_FLOOR) return LEASH_MAX_FLOOR;
    const rawNext = Math.min(cur + LEASH_STEP_BLEND * (trimmedAvg - cur), cur * LEASH_MAX_STEP_RATIO);
    const snapped = Math.round(rawNext * 2) / 2;
    const next = Math.min(LEASH_MAX_FLOOR, Math.max(cur + 0.5, snapped));
    return Math.max(cur, next);
}

function _recordCompletedDay(dayEntry) {
    const norm = _normalizeDayRecord(dayEntry);
    if (!norm) return;
    if (!_hb.leash || typeof _hb.leash !== 'object') _hb.leash = _freshLeashState();
    _hb.leash.history = _mergeDayArrays(_hb.leash.history, [norm], 28);
    _hb.leash.pendingDays = _mergeDayArrays(_hb.leash.pendingDays, [norm], 0);
}

function _calibrateLeashIfReady(calDate) {
    if (!_hb.leash || !Array.isArray(_hb.leash.pendingDays)) return;
    while (_hb.leash.pendingDays.length >= LEASH_EPOCH_DAYS) {
        const window7 = _hb.leash.pendingDays.splice(0, LEASH_EPOCH_DAYS);
        const prevFloors = {
            physics: _getSubjectFloor('physics'),
            chemistry: _getSubjectFloor('chemistry'),
            maths: _getSubjectFloor('maths'),
        };
        const nextFloors = {};
        const trimmedAvgs = {};
        const tightened = [];
        for (const s of SUBJECTS) {
            const avg = _trimmedMean(window7.map(d => (d.units && d.units[s]) || 0));
            trimmedAvgs[s] = avg;
            nextFloors[s] = _computeNextSubjectFloor(prevFloors[s], avg);
            if (nextFloors[s] > prevFloors[s]) tightened.push(s);
        }
        _hb.leash.epoch = Math.max(1, Number(_hb.leash.epoch) || 1) + 1;
        _hb.leash.floors = nextFloors;
        _hb.leash.lastCalibration = {
            epoch: _hb.leash.epoch,
            date: calDate || _safeTodayKey(),
            prevFloors,
            nextFloors,
            trimmedAvgs,
            tightened,
        };
    }
}

// ── Freeze & Real-Time Wall-Clock Drain ─────────────────────────────────────
export function touchActivity(nowMs = Date.now()) {
    if (Number.isFinite(nowMs) && nowMs > 0) _lastActivityAt = nowMs;
}

export function isDecayFrozen(nowMs = Date.now()) {
    let rawActive = false;
    try {
        if (typeof window !== 'undefined' && window._pomoRunning) rawActive = true;
        else if (typeof document !== 'undefined' && document.body && document.body.classList && document.body.classList.contains('pomo-active')) {
            rawActive = true;
        }
    } catch (_) {}
    if (!rawActive) {
        _freezeStartedAt = null;
        return false;
    }
    if (_freezeStartedAt === null) {
        _freezeStartedAt = nowMs;
    }
    // Expire freeze after 35 minutes without interaction or 3 hours continuous run.
    if (nowMs - _lastActivityAt > FREEZE_IDLE_LIMIT_MS) return false;
    if (nowMs - _freezeStartedAt > STOPWATCH_MAX_FREEZE_MS) return false;
    return true;
}

function _ensureTodayBucket(nowMs) {
    if (!_hb.leash || typeof _hb.leash !== 'object') _hb.leash = _freshLeashState();
    const targetKey = _safeTodayKey(nowMs);
    if (_hb.daily && _hb.daily.date === targetKey) return;
    if (_hb.daily && _hb.daily.date && targetKey < _hb.daily.date) return;
    if (_hb.daily) {
        const fP = _getSubjectFloor('physics');
        const fC = _getSubjectFloor('chemistry');
        const fM = _getSubjectFloor('maths');
        const pP = clamp((_hb.daily.units.physics || 0) / fP, 0, 1);
        const pC = clamp((_hb.daily.units.chemistry || 0) / fC, 0, 1);
        const pM = clamp((_hb.daily.units.maths || 0) / fM, 0, 1);
        const avgP = (pP + pC + pM) / 3;
        const minP = Math.min(pP, pC, pM);
        _hb.lastParity = avgP > 0 ? clamp(0.35 * avgP + 0.65 * minP, 0, 1) : 0;

        if (_hb.daily.date) {
            _recordCompletedDay({
                date: _hb.daily.date,
                units: { ..._hb.daily.units },
                pactMins: _hb.daily.pactMins || 0,
                floors: { physics: fP, chemistry: fC, maths: fM },
            });
            const gapDays = _daysBetweenKeys(_hb.daily.date, targetKey);
            if (gapDays > 1) {
                const backfill = Math.min(gapDays - 1, LEASH_EPOCH_DAYS - 1);
                for (let k = 1; k <= backfill; k++) {
                    _recordCompletedDay({
                        date: _addCalendarDays(_hb.daily.date, k),
                        units: { physics: 0, chemistry: 0, maths: 0 },
                        pactMins: 0,
                        floors: { physics: fP, chemistry: fC, maths: fM },
                    });
                }
            }
            _calibrateLeashIfReady(targetKey);
        }
    }
    _hb.daily = _freshDaily(targetKey);
    if (_initialized) _saveState({ silentBroadcast: true });
}

export function tickClock(nowMs = Date.now(), opts = {}) {
    if (!Number.isFinite(nowMs) || nowMs < MIN_VALID_EPOCH_MS) return;
    if (!Number.isFinite(_hb.reservoirHours)) _hb.reservoirHours = MAX_RESERVOIR_HOURS;

    if (_hb.flatlined) {
        if (!_flatlineActive && !_hbStorageDegraded && !isDegradedBoot()) {
            _flatlinePromise = _enterFlatlineSequence();
        }
        return;
    }

    // Live OS/NTP clock-jump guard: if wall clock leaps >2h while the tab is visibly open
    // and monotonic performance.now() only advanced <60s, ignore the spike instead of wiping.
    if (opts && opts.fromLiveTimer && typeof document !== 'undefined' && !document.hidden && typeof performance !== 'undefined') {
        const perfNow = performance.now();
        if (_lastLiveWallMs !== null && _lastLivePerfMs !== null) {
            const wallDelta = nowMs - _lastLiveWallMs;
            const perfDelta = perfNow - _lastLivePerfMs;
            if (wallDelta > 2 * 3600000 && perfDelta >= 0 && perfDelta < 60000) {
                console.warn('[heartbeat] Ignored anomalous live OS clock jump:', Math.round(wallDelta / 60000), 'mins');
                _lastLiveWallMs = nowMs;
                _lastLivePerfMs = perfNow;
                return;
            }
        }
        _lastLiveWallMs = nowMs;
        _lastLivePerfMs = perfNow;
    }

    const lastTick = _isValidEpoch(_hb.lastTickAt) ? _hb.lastTickAt : nowMs;
    const hwm = Math.max(_isValidEpoch(_hb.highWaterMark) ? _hb.highWaterMark : nowMs, lastTick);
    // Anti-rollback guard: system clock moving backward yields 0 elapsed hours, never negative drain.
    const effNow = Math.max(nowMs, hwm);
    const deltaMs = Math.max(0, effNow - lastTick);
    // Absurd forward jump guard (>1 year, e.g. CMOS reset to 2099): refuse to wipe on bogus clock.
    if (deltaMs > MAX_SINGLE_JUMP_MS) {
        console.warn('[heartbeat] Ignored absurd >1yr clock jump; refusing false flatline.');
        return;
    }

    const elapsedHours = deltaMs / 3600000;
    const nextHours = (!isDecayFrozen(effNow) && elapsedHours > 0)
        ? Math.max(0, _hb.reservoirHours - elapsedHours)
        : _hb.reservoirHours;

    if (nextHours <= 0) {
        if (_hbStorageDegraded || isDegradedBoot()) {
            console.warn('[heartbeat] Storage degraded — refusing destructive flatline wipe.');
            return;
        }
        // Defer persisting flatlined:true until _enterFlatlineSequence verifies
        // against persisted storage (prevents a stale background tab from falsely wiping).
        _flatlinePromise = _enterFlatlineSequence(effNow);
        return;
    }

    _ensureTodayBucket(effNow);
    _hb.reservoirHours = nextHours;
    _hb.lastTickAt = effNow;
    _hb.highWaterMark = effNow;

    if (elapsedHours > 0.0002) {
        _saveState();
    }
}

// ── Problem Weighting & Reservoir Recharge ──────────────────────────────────
export function getQuestionUnitWeight(q) {
    const qElo = Number(q && q.qElo);
    if (!Number.isFinite(qElo) || qElo <= 0) return 1.00;
    if (qElo === 1200 && (!q.qEloSource || q.qEloSource === 'uncalibrated')) return 1.00;
    const band = getEloBand(qElo);
    if (band === 'T1_FOUNDATION' || band === 'T2_CORE_MAINS') return 0.75;
    if (band === 'T3_STD_MAINS' || band === 'T4_ADV_EASY') return 1.00;
    if (band === 'T5_PAPER_ADV') return 1.35;
    if (band === 'T6_ELITE' || band === 'T7_OLYMP') return 1.75;
    return qElo < 800 ? 0.75 : (qElo > 2550 ? 1.75 : 1.00);
}

function _applyDailyRechargeDelta() {
    let added = 0;
    const d = _hb.daily;
    for (const s of SUBJECTS) {
        const cappedUnits = Math.min(_getSubjectCap(s), d.units[s] || 0);
        const earnedSubjHours = cappedUnits * _getSubjectHoursPerUnit(s);
        const prevCredited = d.creditedSubjHours[s] || 0;
        if (earnedSubjHours > prevCredited) {
            added += earnedSubjHours - prevCredited;
            d.creditedSubjHours[s] = earnedSubjHours;
        }
    }

    const pP = clamp((d.units.physics || 0) / _getSubjectFloor('physics'), 0, 1);
    const pC = clamp((d.units.chemistry || 0) / _getSubjectFloor('chemistry'), 0, 1);
    const pM = clamp((d.units.maths || 0) / _getSubjectFloor('maths'), 0, 1);
    const minP = Math.min(pP, pC, pM);

    const cappedPactMins = Math.min(DAILY_PACT_CAP_MINS, d.pactMins || 0);
    const rawPactHours = cappedPactMins * HOURS_PER_PACT_MIN;
    const effectivePactHours = rawPactHours * (0.25 + 0.75 * minP);
    if (effectivePactHours > (d.creditedPactHours || 0)) {
        added += effectivePactHours - (d.creditedPactHours || 0);
        d.creditedPactHours = effectivePactHours;
    }

    if (added > 0) {
        _hb.reservoirHours = clamp(_hb.reservoirHours + added, 0, MAX_RESERVOIR_HOURS);
    }
    return added;
}

/**
 * Credit a verified solve OR an Error-Matrix dissection toward the Heartbeat.
 * - First-time solves pay 100%; due SR repeats pay 50%; non-due repeats pay 0%.
 * - Dissections require both a reason tag AND a >=30 char note to pay 70% now,
 *   locking 30% until the item is cleanly solved when due in the Vault.
 */
export function recordProblemUnit(q, kind = 'solve', opts = {}) {
    touchActivity();
    tickClock();
    if (_hb.flatlined || _hb.reservoirHours <= 0) return { credited: false, reason: 'flatlined' };
    const subj = normSubjKeyStrict((q && q.subject) || (AppState && AppState.currentSubject));
    if (!subj) return { credited: false, reason: 'invalid-subject' };

    const qid = (q && q.id != null && q.id !== '') ? String(q.id) : null;
    const baseWeight = getQuestionUnitWeight(q);
    let weight = baseWeight;

    if (kind === 'dissection') {
        const reason = String((opts && opts.reason) ?? (q && q.errorReason) ?? '').trim();
        const note = String((opts && opts.note) ?? (q && q.dissectionNote) ?? '').trim();
        if (!reason || note.length < 30) {
            return { credited: false, reason: 'dissection-incomplete', subject: subj, weight: 0, hoursAdded: 0 };
        }
        const dissectKey = qid ? `dissect:${qid}` : null;
        if (qid && (_hb.daily.creditedIds.includes(qid) || _hb.daily.creditedIds.includes(dissectKey))) {
            return { credited: false, reason: 'duplicate', subject: subj };
        }
        if (dissectKey) _hb.daily.creditedIds.push(dissectKey);
        if (q && typeof q === 'object') {
            q._hbVaultLocked30 = true;
            q.dissectionNote = note;
        }
        weight = round2(baseWeight * 0.70);
    } else {
        if (qid && _hb.daily.creditedIds.includes(qid)) {
            return { credited: false, reason: 'duplicate', subject: subj };
        }
        if (q && q._hbVaultLocked30) {
            const isDue = Boolean(
                opts && opts.isDue !== undefined
                    ? opts.isDue
                    : (q.nextReviewAt ? getDueStatus(q).status === 'ready' : true)
            );
            if (!isDue) {
                return { credited: false, reason: 'not-due', subject: subj, weight: 0, hoursAdded: 0 };
            }
            weight = round2(baseWeight * 0.30);
            q._hbVaultLocked30 = false;
            q._hbEverSolved = true;
            if (qid) _hb.daily.creditedIds.push(qid);
        } else {
            const wasAlreadySolved = (opts && opts.wasAlreadySolved !== undefined)
                ? Boolean(opts.wasAlreadySolved)
                : Boolean(q && (q._hbEverSolved || (q.solveCount || 0) > 0));
            const isDue = Boolean(
                opts && opts.isDue !== undefined
                    ? opts.isDue
                    : (q && q.nextReviewAt ? getDueStatus(q).status === 'ready' : false)
            );
            if (wasAlreadySolved && !isDue) {
                return { credited: false, reason: 'repeat-not-due', subject: subj, weight: 0, hoursAdded: 0 };
            }
            if (wasAlreadySolved && isDue) {
                weight = round2(baseWeight * 0.50);
            } else {
                weight = round2(baseWeight * 1.00);
                if (q && typeof q === 'object') q._hbEverSolved = true;
            }
            if (qid) _hb.daily.creditedIds.push(qid);
        }
    }

    _hb.daily.units[subj] = round2((_hb.daily.units[subj] || 0) + weight);
    const hoursAdded = _applyDailyRechargeDelta();
    _pulseBoost = 1.0;
    try { HeartbeatAudio.playChamberLoad(); } catch (_) {}
    _saveState();
    _refreshHudAndVitals();

    return { credited: true, kind, subject: subj, weight, hoursAdded };
}

/**
 * Credit completed Deep Pact block minutes toward Persistence & Reservoir.
 * Scaled dynamically by weakest-subject unit progress (minP) so all 3 subjects
 * must advance toward daily target before full Pact escrow releases.
 */
export function recordPactBlock(mins, subj) {
    tickClock();
    if (_hb.flatlined || _hb.reservoirHours <= 0) return { credited: false, reason: 'flatlined' };
    const cleanMins = Math.max(0, Number(mins) || 0);
    if (cleanMins <= 0) return { credited: false, reason: 'zero-mins' };

    _hb.daily.pactMins = round2((_hb.daily.pactMins || 0) + cleanMins);
    const hoursAdded = _applyDailyRechargeDelta();
    _pulseBoost = 1.0;
    try { HeartbeatAudio.playChamberLoad(); } catch (_) {}
    _saveState();
    _refreshHudAndVitals();

    return { credited: true, mins: cleanMins, subject: subj || null, hoursAdded };
}

// ── Vitals & Continuous 5-Stage Spectrum ────────────────────────────────────
export function interpolateSpectrum(reservoirHours) {
    const h = clamp(Number(reservoirHours) || 0, 0, MAX_RESERVOIR_HOURS);
    let lo = SPECTRUM_STOPS[0];
    let hi = SPECTRUM_STOPS[SPECTRUM_STOPS.length - 1];
    for (let i = 0; i < SPECTRUM_STOPS.length - 1; i++) {
        if (h >= SPECTRUM_STOPS[i].h && h <= SPECTRUM_STOPS[i + 1].h) {
            lo = SPECTRUM_STOPS[i];
            hi = SPECTRUM_STOPS[i + 1];
            break;
        }
    }
    const span = Math.max(0.0001, hi.h - lo.h);
    const t = clamp((h - lo.h) / span, 0, 1);

    let stageName = 'ARTERIAL CRIMSON';
    if (h >= 24.0) stageName = 'XENON WHITE';
    else if (h >= 16.0) stageName = 'ION SILVER';
    else if (h >= 8.0) stageName = 'UV LASER';
    else if (h >= 3.0) stageName = 'AMBER ARC';

    const edge = lerpVec3(lo.edge, hi.edge, t);
    const accent = lerpVec3(lo.accent, hi.accent, t);
    const css = h >= 24 ? '#bce4ff' : h >= 16 ? '#86a2ff' : h >= 8 ? '#a864ff' : h >= 3 ? '#ff9436' : '#ff2b3d';

    return {
        name: stageName,
        core: lerpVec3(lo.core, hi.core, t),
        edge,
        accent,
        css,
    };
}

export function getVitals(nowMs = Date.now()) {
    _ensureTodayBucket();
    const reservoirHours = clamp(_hb.reservoirHours, 0, MAX_RESERVOIR_HOURS);
    const reservoirRatio = reservoirHours / MAX_RESERVOIR_HOURS;

    const uP = _hb.daily.units.physics || 0;
    const uC = _hb.daily.units.chemistry || 0;
    const uM = _hb.daily.units.maths || 0;
    const totalUnits = uP + uC + uM;
    const pactMins = _hb.daily.pactMins || 0;

    const fP = _getSubjectFloor('physics');
    const fC = _getSubjectFloor('chemistry');
    const fM = _getSubjectFloor('maths');
    const totalTarget = round2(fP + fC + fM);

    const pP = clamp(uP / fP, 0, 1);
    const pC = clamp(uC / fC, 0, 1);
    const pM = clamp(uM / fM, 0, 1);
    const avgP = (pP + pC + pM) / 3;
    const minP = Math.min(pP, pC, pM);
    const parity = avgP > 0 ? clamp(minP / avgP, 0, 1) : 0;

    // 1. Speed (0.05..1.00): Reservoir Life Remaining
    const speed = clamp(0.05 + 0.95 * reservoirRatio, 0.05, 1.0);

    // 2. Luminescence (0.00..1.00): 3-Subject Balance & Parity
    // Smooth cold-start blend across the weakest floor so first morning solve never cliffs.
    const rawTodayLum = clamp(0.35 * avgP + 0.65 * minP, 0, 1);
    const dNow = new Date(nowMs);
    const rawHour = dNow.getHours() + dNow.getMinutes() / 60;
    const hoursIntoDay = (rawHour - 4 + 24) % 24;
    const morningFade = clamp(1 - hoursIntoDay / 12, 0, 1);
    const morningCarry = (_hb.lastParity || 0) * morningFade * 0.72;
    const carryWeight = clamp(1 - totalUnits / Math.min(fP, fC, fM), 0, 1);
    const luminescenceScore = clamp(
        Math.max(rawTodayLum, morningCarry * carryWeight + rawTodayLum * (1 - carryWeight)),
        0,
        1
    );

    // 3. Persistence (0.00..1.00 normalized -> 0.35..0.88 crisp KLSR trail): Deep Pact + Weighted Output
    const rawTodayPers = clamp(
        0.55 * Math.min(1, pactMins / DAILY_PACT_TARGET_MINS) +
        0.45 * Math.min(1, totalUnits / totalTarget),
        0,
        1
    );
    let persistenceScore = rawTodayPers;
    if (totalUnits === 0 && pactMins === 0) {
        const ageHours = Math.max(0, (nowMs - (_hb.seededAt || nowMs)) / 3600000);
        if (ageHours < 6) {
            const seedFade = clamp(1 - ageHours / 6, 0, 1);
            persistenceScore = clamp(Math.max(rawTodayPers, reservoirRatio * seedFade * 0.7), 0, 1);
        }
    }
    const klsrPersistence = 0.35 + persistenceScore * 0.53;

    // 4. Spread (0.00..0.50 max, reverse collapse): 0.50 at 30h, 0.00 at 0h
    const spread = round2(0.50 * reservoirRatio);

    const spectrum = interpolateSpectrum(reservoirHours);

    const cappedPactMins = Math.min(DAILY_PACT_CAP_MINS, pactMins);
    const rawPactHours = cappedPactMins * HOURS_PER_PACT_MIN;
    const creditedPactHours = _hb.daily.creditedPactHours || 0;
    const lockedPactHours = round2(Math.max(0, rawPactHours - creditedPactHours));
    const subjEntries = [
        { key: 'physics', label: 'Physics', u: uP, r: pP },
        { key: 'chemistry', label: 'Chemistry', u: uC, r: pC },
        { key: 'maths', label: 'Maths', u: uM, r: pM },
    ].sort((a, b) => (a.r - b.r) || (a.u - b.u));
    const weakestSubject = subjEntries[0].label;

    const pending = (_hb.leash && Array.isArray(_hb.leash.pendingDays)) ? _hb.leash.pendingDays : [];
    const pendingCount = pending.length;
    const floors = { physics: fP, chemistry: fC, maths: fM };
    const caps = { physics: _getSubjectCap('physics'), chemistry: _getSubjectCap('chemistry'), maths: _getSubjectCap('maths') };
    const hoursPerUnit = {
        physics: round3(_getSubjectHoursPerUnit('physics')),
        chemistry: round3(_getSubjectHoursPerUnit('chemistry')),
        maths: round3(_getSubjectHoursPerUnit('maths')),
    };
    const trailingAvgs = pendingCount > 0
        ? {
            physics: _trimmedMean(pending.map(d => (d.units && d.units.physics) || 0)),
            chemistry: _trimmedMean(pending.map(d => (d.units && d.units.chemistry) || 0)),
            maths: _trimmedMean(pending.map(d => (d.units && d.units.maths) || 0)),
        }
        : null;
    const projectedFloors = {
        physics: trailingAvgs ? _computeNextSubjectFloor(fP, trailingAvgs.physics) : fP,
        chemistry: trailingAvgs ? _computeNextSubjectFloor(fC, trailingAvgs.chemistry) : fC,
        maths: trailingAvgs ? _computeNextSubjectFloor(fM, trailingAvgs.maths) : fM,
    };
    const leash = {
        epoch: (_hb.leash && Number(_hb.leash.epoch)) || 1,
        dayInEpoch: clamp(pendingCount + 1, 1, LEASH_EPOCH_DAYS),
        epochDays: LEASH_EPOCH_DAYS,
        pendingCount,
        floors,
        caps,
        hoursPerUnit,
        totalTarget,
        trailingAvgs,
        projectedFloors,
        lastCalibration: (_hb.leash && _hb.leash.lastCalibration) || null,
    };

    return {
        reservoirHours,
        reservoirRatio,
        frozen: isDecayFrozen(nowMs),
        flatlined: Boolean(_hb.flatlined || reservoirHours <= 0),
        speed: round2(speed),
        luminescence: round2(luminescenceScore),
        persistence: round2(persistenceScore),
        klsrPersistence,
        klsrLuminescence: 0.42 + luminescenceScore * 1.48,
        spread,
        spectrum,
        parity: round2(parity),
        minP: round2(minP),
        pactMultiplier: round2(0.25 + 0.75 * minP),
        lockedPactHours,
        weakestSubject,
        units: { physics: round2(uP), chemistry: round2(uC), maths: round2(uM) },
        totalUnits: round2(totalUnits),
        pactMins: round2(pactMins),
        creditedHoursToday: round2(
            (_hb.daily.creditedSubjHours.physics || 0) +
            (_hb.daily.creditedSubjHours.chemistry || 0) +
            (_hb.daily.creditedSubjHours.maths || 0) +
            (_hb.daily.creditedPactHours || 0)
        ),
        leash,
    };
}

export function getLeashStatus() {
    return getVitals().leash;
}

export function getDiagnosticPrescription(v = getVitals()) {
    const floors = (v.leash && v.leash.floors) || {
        physics: DAILY_UNIT_TARGET,
        chemistry: DAILY_UNIT_TARGET,
        maths: DAILY_UNIT_TARGET,
    };
    const gaps = {
        physics: Math.max(0, round2(floors.physics - v.units.physics)),
        chemistry: Math.max(0, round2(floors.chemistry - v.units.chemistry)),
        maths: Math.max(0, round2(floors.maths - v.units.maths)),
        pactMins: Math.max(0, Math.round(DAILY_PACT_TARGET_MINS - v.pactMins)),
    };

    const ratios = [
        { name: 'Physics', r: v.units.physics / floors.physics, gap: gaps.physics },
        { name: 'Chemistry', r: v.units.chemistry / floors.chemistry, gap: gaps.chemistry },
        { name: 'Maths', r: v.units.maths / floors.maths, gap: gaps.maths },
    ];
    ratios.sort((a, b) => a.r - b.r);
    const maxR = Math.max(ratios[0].r, ratios[1].r, ratios[2].r);
    const minR = ratios[0].r;
    const lagging = ratios.filter(x => x.gap > 0 && (maxR - x.r > 0.2 || x.r < 0.5)).map(x => x.name);

    const multPct = Math.round((v.pactMultiplier ?? (0.25 + 0.75 * (v.minP || 0))) * 100);
    const lockNote = v.lockedPactHours > 0.05
        ? ` (+${v.lockedPactHours.toFixed(2)}h LOCKED — feed ${v.weakestSubject} to release)`
        : '';

    let verdict = '';
    let critical = false;
    if (v.reservoirHours < 6.0) {
        critical = true;
        verdict = `CRITICAL RESERVOIR (${v.reservoirHours.toFixed(1)}h left). Complete ${gaps.pactMins > 0 ? gaps.pactMins + 'm Pact + ' : ''}balanced P/C/M solves or Error-Matrix dissections immediately to avert total data wipe.${lockNote}`;
    } else if (maxR - minR > 0.22 && lagging.length > 0) {
        verdict = `3-SUBJECT IMBALANCE: ${lagging.join(' & ')} lagging. Luminescence & Pact recharge multiplier (${multPct}%) are throttled until all 3 subjects advance.${lockNote}`;
    } else if (gaps.pactMins > 0 && v.persistence < 0.7) {
        verdict = `ENDURANCE DEFICIT: ${gaps.pactMins}m of completed Lock-In Pact blocks remaining today to maximize Persistence and seal the +9.0h focus injection.${lockNote}`;
    } else if (gaps.physics > 0 || gaps.chemistry > 0 || gaps.maths > 0) {
        const parts = [];
        if (gaps.physics > 0) parts.push(`${gaps.physics}u Phys`);
        if (gaps.chemistry > 0) parts.push(`${gaps.chemistry}u Chem`);
        if (gaps.maths > 0) parts.push(`${gaps.maths}u Math`);
        verdict = `DAILY STANDARD INCOMPLETE: Need ${parts.join(', ')}${gaps.pactMins > 0 ? ` + ${gaps.pactMins}m Pact` : ''} to hit +24.0h break-even.${lockNote}`;
    } else {
        verdict = `DAILY STANDARD CLEARED (+24h break-even locked). Overflow units & Pact blocks recover lost reservoir life up to +30.0h/day.`;
    }

    return { gaps, verdict, critical };
}

export function getState() {
    return JSON.parse(JSON.stringify(_hb));
}

// ── KLSR Aizawa Flux Mathematical Manifold (from klsr animation/patterns.js) ──
const POINT_COUNT = 2400;
const TIGHT_K = 16;
const ARC_K = 12;

function createRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function normalizeVec3(x, y, z, fx = 0, fy = 1, fz = 0) {
    const len = Math.hypot(x, y, z);
    if (len < 1e-7 || !Number.isFinite(len)) return [fx, fy, fz];
    return [x / len, y / len, z / len];
}

function genAizawaFlux(count, rng) {
    const positions = new Float32Array(count * 3);
    const flows = new Float32Array(count * 3);
    const phases = new Float32Array(count);

    const a = 0.95 + (rng() - 0.5) * 0.04;
    const b = 0.70 + (rng() - 0.5) * 0.04;
    const c = 0.60 + (rng() - 0.5) * 0.03;
    const d = 3.50 + (rng() - 0.5) * 0.35;
    const e = 0.25 + (rng() - 0.5) * 0.04;
    const f = 0.10 + (rng() - 0.5) * 0.03;
    const dt = 0.009;

    function deriv(x, y, z) {
        const r2 = x * x + y * y;
        return [
            (z - b) * x - d * y,
            d * x + (z - b) * y,
            c + a * z - (z * z * z) / 3.0 - r2 * (1.0 + e * z) + f * z * x * x * x,
        ];
    }

    const streams = 10;
    const perStream = Math.ceil(count / streams);
    let idx = 0;

    for (let s = 0; s < streams && idx < count; s++) {
        let x = 0.1 + (rng() - 0.5) * 0.3;
        let y = (rng() - 0.5) * 0.3;
        let z = (rng() - 0.5) * 0.3;

        for (let w = 0; w < 450; w++) {
            const [k1x, k1y, k1z] = deriv(x, y, z);
            const [k2x, k2y, k2z] = deriv(x + 0.5 * dt * k1x, y + 0.5 * dt * k1y, z + 0.5 * dt * k1z);
            const [k3x, k3y, k3z] = deriv(x + 0.5 * dt * k2x, y + 0.5 * dt * k2y, z + 0.5 * dt * k2z);
            const [k4x, k4y, k4z] = deriv(x + dt * k3x, y + dt * k3y, z + dt * k3z);
            x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
            y += (dt / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
            z += (dt / 6) * (k1z + 2 * k2z + 2 * k3z + k4z);
            if (!Number.isFinite(x) || Math.abs(x) > 10 || Math.abs(y) > 10 || Math.abs(z) > 10) {
                x = 0.1; y = 0.0; z = 0.0;
            }
        }

        for (let p = 0; p < perStream && idx < count; p++) {
            let vx = 0, vy = 0, vz = 0;
            for (let sub = 0; sub < 4; sub++) {
                const [k1x, k1y, k1z] = deriv(x, y, z);
                const [k2x, k2y, k2z] = deriv(x + 0.5 * dt * k1x, y + 0.5 * dt * k1y, z + 0.5 * dt * k1z);
                const [k3x, k3y, k3z] = deriv(x + 0.5 * dt * k2x, y + 0.5 * dt * k2y, z + 0.5 * dt * k2z);
                const [k4x, k4y, k4z] = deriv(x + dt * k3x, y + dt * k3y, z + dt * k3z);
                x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
                y += (dt / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
                z += (dt / 6) * (k1z + 2 * k2z + 2 * k3z + k4z);
                if (!Number.isFinite(x) || Math.abs(x) > 6 || Math.abs(y) > 6 || Math.abs(z) > 6) {
                    x = 0.1; y = 0.05; z = 0.0;
                }
                vx = k1x; vy = k1y; vz = k1z;
            }
            positions[idx * 3] = x;
            positions[idx * 3 + 1] = z - 0.65;
            positions[idx * 3 + 2] = y;
            const [fx, fy, fz] = normalizeVec3(vx, vz, vy);
            flows[idx * 3] = fx;
            flows[idx * 3 + 1] = fy;
            flows[idx * 3 + 2] = fz;
            phases[idx] = (s / streams + p / perStream) % 1;
            idx++;
        }
    }
    return { positions, flows, phases };
}

function normalizeAndBuildScatter(positions, flows, count, rng) {
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < count; i++) {
        mx += positions[i * 3]; my += positions[i * 3 + 1]; mz += positions[i * 3 + 2];
    }
    mx /= count; my /= count; mz /= count;

    const radii = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const x = positions[i * 3] - mx;
        const y = positions[i * 3 + 1] - my;
        const z = positions[i * 3 + 2] - mz;
        positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
        radii[i] = Math.hypot(x, y, z);
    }

    const sorted = Float32Array.from(radii).sort();
    const refRadius = sorted[Math.floor(count * 0.94)] || 1.0;
    const invScale = 1.02 / refRadius;

    const scatter = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        let x = positions[i * 3] * invScale;
        let y = positions[i * 3 + 1] * invScale;
        let z = positions[i * 3 + 2] * invScale;
        const r = Math.hypot(x, y, z);
        if (r < 0.28) {
            const push = (0.28 + r * 0.45) / Math.max(r, 1e-4);
            x *= push; y *= push; z *= push;
        }
        positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;

        const th = rng() * Math.PI * 2;
        const ph = Math.acos(2 * rng() - 1);
        const rx = Math.sin(ph) * Math.cos(th);
        const ry = Math.sin(ph) * Math.sin(th);
        const rz = Math.cos(ph);

        const fx = flows[i * 3], fy = flows[i * 3 + 1], fz = flows[i * 3 + 2];
        const bx = fy * z - fz * y;
        const by = fz * x - fx * z;
        const bz = fx * y - fy * x;
        const [sx, sy, sz] = normalizeVec3(rx * 0.72 + bx * 0.55, ry * 0.72 + by * 0.55, rz * 0.72 + bz * 0.55);
        const mag = 0.25 + Math.pow(rng(), 1.6) * 1.15;
        scatter[i * 3] = sx * mag;
        scatter[i * 3 + 1] = sy * mag;
        scatter[i * 3 + 2] = sz * mag;
    }
    return scatter;
}

function buildNeighborGraph(positions, flows, count, rng) {
    const GRID = 12;
    const CELLS = GRID * GRID * GRID;
    const cellHead = new Int32Array(CELLS).fill(-1);
    const cellNext = new Int32Array(count);
    const cellOf = (v) => clamp(Math.floor(((v + 1.25) / 2.5) * GRID), 0, GRID - 1);

    for (let i = 0; i < count; i++) {
        const c = (cellOf(positions[i * 3 + 2]) * GRID + cellOf(positions[i * 3 + 1])) * GRID + cellOf(positions[i * 3]);
        cellNext[i] = cellHead[c];
        cellHead[c] = i;
    }

    const tightNeighbors = new Uint16Array(count * TIGHT_K);
    const arcNeighbors = new Uint16Array(count * ARC_K);
    const MAX_CANDS = 32;
    const candIds = new Int32Array(MAX_CANDS);
    const candDots = new Float32Array(MAX_CANDS);
    const fallbackIds = new Int32Array(MAX_CANDS);

    for (let i = 0; i < count; i++) {
        const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
        const fx = flows[i * 3], fy = flows[i * 3 + 1], fz = flows[i * 3 + 2];
        const gx = cellOf(px), gy = cellOf(py), gz = cellOf(pz);
        let candCount = 0, fallbackCount = 0;

        for (let dz = -1; dz <= 1 && candCount < 28; dz++) {
            const cz = gz + dz; if (cz < 0 || cz >= GRID) continue;
            for (let dy = -1; dy <= 1 && candCount < 28; dy++) {
                const cy = gy + dy; if (cy < 0 || cy >= GRID) continue;
                for (let dx = -1; dx <= 1 && candCount < 28; dx++) {
                    const cx = gx + dx; if (cx < 0 || cx >= GRID) continue;
                    let j = cellHead[(cz * GRID + cy) * GRID + cx];
                    while (j !== -1 && candCount < 28) {
                        if (j !== i) {
                            const qx = positions[j * 3], qy = positions[j * 3 + 1], qz = positions[j * 3 + 2];
                            const ddx = qx - px, ddy = qy - py, ddz = qz - pz;
                            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
                            if (d2 >= 0.0025 && d2 <= 0.085) {
                                const mx = (px + qx) * 0.5, my = (py + qy) * 0.5, mz = (pz + qz) * 0.5;
                                if (mx * mx + my * my + mz * mz > 0.05) {
                                    const dot = (ddx * fx + ddy * fy + ddz * fz) / Math.sqrt(d2);
                                    if (dot > -0.15) {
                                        candIds[candCount] = j; candDots[candCount] = dot; candCount++;
                                    } else if (fallbackCount < MAX_CANDS) {
                                        fallbackIds[fallbackCount++] = j;
                                    }
                                }
                            }
                        }
                        j = cellNext[j];
                    }
                }
            }
        }

        for (let a = 1; a < candCount; a++) {
            const idA = candIds[a], dotA = candDots[a];
            let b = a - 1;
            while (b >= 0 && candDots[b] < dotA) {
                candIds[b + 1] = candIds[b]; candDots[b + 1] = candDots[b]; b--;
            }
            candIds[b + 1] = idA; candDots[b + 1] = dotA;
        }

        const tightOffset = i * TIGHT_K;
        let filled = 0;
        if (candCount >= TIGHT_K) {
            const pool = Math.min(candCount, TIGHT_K + 8);
            for (let k = 0; k < TIGHT_K; k++) {
                const pick = k < 4 ? k : Math.floor(rng() * pool);
                tightNeighbors[tightOffset + k] = candIds[pick];
            }
        } else {
            for (let k = 0; k < candCount && filled < TIGHT_K; k++) tightNeighbors[tightOffset + filled++] = candIds[k];
            for (let k = 0; k < fallbackCount && filled < TIGHT_K; k++) tightNeighbors[tightOffset + filled++] = fallbackIds[k];
            while (filled < TIGHT_K) {
                let bestJ = (i + 1 + filled) % count, bestD = 1e9;
                for (let probe = 0; probe < 10; probe++) {
                    const j = Math.floor(rng() * count); if (j === i) continue;
                    const qx = positions[j * 3], qy = positions[j * 3 + 1], qz = positions[j * 3 + 2];
                    const d2 = (qx - px) ** 2 + (qy - py) ** 2 + (qz - pz) ** 2;
                    const mx = (px + qx) * 0.5, my = (py + qy) * 0.5, mz = (pz + qz) * 0.5;
                    if (d2 > 0.0025 && (mx * mx + my * my + mz * mz) > 0.05 && d2 < bestD) { bestD = d2; bestJ = j; }
                }
                tightNeighbors[tightOffset + filled++] = bestJ;
            }
        }

        const arcOffset = i * ARC_K;
        for (let k = 0; k < ARC_K; k++) {
            let chosen = -1, fallbackBest = (i + 13 + k * 7) % count, fallbackScore = -1e9;
            for (let probe = 0; probe < 10; probe++) {
                const j = Math.floor(rng() * count); if (j === i) continue;
                const qx = positions[j * 3], qy = positions[j * 3 + 1], qz = positions[j * 3 + 2];
                const d2 = (qx - px) ** 2 + (qy - py) ** 2 + (qz - pz) ** 2;
                const mx = (px + qx) * 0.5, my = (py + qy) * 0.5, mz = (pz + qz) * 0.5;
                const midR2 = mx * mx + my * my + mz * mz;
                if (d2 >= 0.09 && d2 <= 0.45 && midR2 > 0.14) { chosen = j; break; }
                const score = midR2 - Math.abs(d2 - 0.22);
                if (score > fallbackScore) { fallbackScore = score; fallbackBest = j; }
            }
            arcNeighbors[arcOffset + k] = chosen >= 0 ? chosen : fallbackBest;
        }
    }
    return { tightNeighbors, arcNeighbors };
}

function buildAizawaManifold(seed = 2049) {
    const rng = createRng(seed);
    const { positions, flows, phases } = genAizawaFlux(POINT_COUNT, rng);
    const scatterDirs = normalizeAndBuildScatter(positions, flows, POINT_COUNT, rng);
    const { tightNeighbors, arcNeighbors } = buildNeighborGraph(positions, flows, POINT_COUNT, rng);
    return {
        count: POINT_COUNT,
        tightK: TIGHT_K,
        arcK: ARC_K,
        basePositions: positions,
        scatterDirs,
        flowDirs: flows,
        phases,
        tightNeighbors,
        arcNeighbors,
    };
}

// ── WebGL2 HDR Optical Laser & Bloom Renderer (with 2D fallback) ────────────
const FULLSCREEN_VERT = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
    vec2 p = POS[gl_VertexID];
    vUv = p * 0.5 + 0.5;
    gl_Position = vec4(p, 0.0, 1.0);
}`;

const BEAM_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aQuad;
layout(location = 1) in vec3 aP0;
layout(location = 2) in vec3 aP1;
layout(location = 3) in float aEnergy;
layout(location = 4) in float aWidth;
layout(location = 5) in float aTint;
uniform mat4 uViewProj;
uniform vec2 uResolution;
uniform float uDpr;
uniform float uLuminescence;
out vec2 vLocal;
out float vSegLen;
out float vHalfPx;
out float vEnergy;
out float vWidth;
out float vTint;
out float vDepth;
out float vAlong;
void main() {
    vec4 c0 = uViewProj * vec4(aP0, 1.0);
    vec4 c1 = uViewProj * vec4(aP1, 1.0);
    if (c0.w <= 0.08 || c1.w <= 0.08) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vEnergy = 0.0;
        return;
    }
    vec2 ndc0 = c0.xy / c0.w;
    vec2 ndc1 = c1.xy / c1.w;
    vec2 halfRes = uResolution * 0.5;
    vec2 px0 = ndc0 * halfRes;
    vec2 px1 = ndc1 * halfRes;
    vec2 delta = px1 - px0;
    float segLen = length(delta);
    vec2 dir = segLen > 0.001 ? delta / segLen : vec2(1.0, 0.0);
    vec2 norm = vec2(-dir.y, dir.x);
    float lumScale = 0.72 + 0.38 * uLuminescence;
    float halfPx = (1.35 + aWidth * (1.1 + aEnergy * 1.8) * lumScale) * uDpr;
    float ext = (aQuad.x * 2.0 - 1.0) * halfPx;
    vec2 posPx = mix(px0, px1, aQuad.x) + dir * ext + norm * (aQuad.y * halfPx);
    gl_Position = vec4(posPx / halfRes, 0.0, 1.0);
    vLocal = vec2(aQuad.x * segLen + ext, aQuad.y * halfPx);
    vSegLen = segLen;
    vHalfPx = halfPx;
    vEnergy = aEnergy;
    vWidth = aWidth;
    vTint = aTint;
    vDepth = mix(c0.w, c1.w, aQuad.x);
    vAlong = aQuad.x;
}`;

const BEAM_FRAG = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vSegLen;
in float vHalfPx;
in float vEnergy;
in float vWidth;
in float vTint;
in float vDepth;
in float vAlong;
uniform float uDpr;
uniform float uLuminescence;
uniform vec3 uColorCore;
uniform vec3 uColorEdge;
uniform vec3 uColorAccent;
out vec4 fragColor;
void main() {
    if (vEnergy <= 0.002) discard;
    float cx = clamp(vLocal.x, 0.0, vSegLen);
    float distPx = length(vec2(vLocal.x - cx, vLocal.y)) / max(uDpr, 1.0);
    float coreSigma = 0.28 + vWidth * (0.24 + vEnergy * 0.22);
    float haloSigma = 0.85 + vWidth * (0.95 + uLuminescence * 0.55);
    float core = exp(-(distPx * distPx) / (coreSigma * coreSigma));
    float halo = exp(-distPx / haloSigma);
    float tipBoost = mix(0.55, 1.45, smoothstep(0.0, 1.0, vAlong));
    float energyPow = pow(vEnergy, 1.28) * tipBoost;
    float depthAtten = clamp(3.3 / max(vDepth, 0.9), 0.38, 1.35);
    vec3 tintCol = mix(uColorEdge, uColorAccent, clamp(vTint, 0.0, 1.0));
    vec3 col = (uColorCore * core * 2.8 + tintCol * halo * 0.24) * energyPow * uLuminescence * depthAtten;
    fragColor = vec4(col, 1.0);
}`;

const NODE_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in float aFlash;
layout(location = 2) in float aPhase;
uniform mat4 uViewProj;
uniform float uDpr;
uniform float uLuminescence;
uniform float uDormantAlpha;
out float vFlash;
out float vPhase;
out float vDepth;
void main() {
    vec4 clip = uViewProj * vec4(aPos, 1.0);
    if (clip.w <= 0.08) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        vFlash = 0.0;
        return;
    }
    gl_Position = clip;
    float distScale = clamp(2.8 / clip.w, 0.45, 2.1);
    float baseSize = 1.8 + uDormantAlpha * 10.0;
    float flashSize = aFlash * (9.5 + uLuminescence * 4.5);
    gl_PointSize = (baseSize + flashSize) * distScale * uDpr;
    vFlash = aFlash;
    vPhase = aPhase;
    vDepth = clip.w;
}`;

const NODE_FRAG = `#version 300 es
precision highp float;
in float vFlash;
in float vPhase;
in float vDepth;
uniform float uLuminescence;
uniform float uDormantAlpha;
uniform vec3 uColorCore;
uniform vec3 uColorEdge;
uniform vec3 uColorAccent;
out vec4 fragColor;
void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    if (r2 > 1.0) discard;
    float r = sqrt(r2);
    float depthAtten = clamp(3.2 / max(vDepth, 0.9), 0.35, 1.3);
    vec3 baseCol = mix(uColorEdge, uColorAccent, fract(vPhase * 1.73));
    float dormant = exp(-r2 * 8.5) * uDormantAlpha * 0.45;
    float spikeCore = exp(-r2 * 22.0);
    float spikeHalo = exp(-r * 5.2);
    float crossGlint = (exp(-abs(uv.x) * 28.0) + exp(-abs(uv.y) * 28.0)) * exp(-r * 4.4) * 0.42;
    float flashStrength = pow(vFlash, 1.35) * (1.8 + uLuminescence * 2.1);
    vec3 col = baseCol * dormant +
        (uColorCore * (spikeCore * 2.4 + crossGlint) + baseCol * spikeHalo * 0.85) * flashStrength;
    fragColor = vec4(col * depthAtten, 1.0);
}`;

const PERSIST_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSceneTex;
uniform sampler2D uPrevTrailTex;
uniform float uDecay;
out vec4 fragColor;
void main() {
    vec3 scene = texture(uSceneTex, vUv).rgb;
    vec3 prev = texture(uPrevTrailTex, vUv).rgb * uDecay;
    vec3 trailCompressed = prev / (1.0 + max(prev.r, max(prev.g, prev.b)) * 0.22);
    vec3 combined = trailCompressed + scene;
    fragColor = vec4(min(combined, vec3(12.0)), 1.0);
}`;

const THRESHOLD_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexelSize;
uniform float uThreshold;
uniform float uKnee;
out vec4 fragColor;
vec3 sampleSoft(vec2 uv) {
    vec3 c = texture(uTex, uv).rgb;
    float br = max(c.r, max(c.g, c.b));
    float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = (soft * soft) / (4.0 * uKnee + 1e-5);
    float contrib = max(soft, br - uThreshold) / max(br, 1e-5);
    return c * max(contrib, 0.0);
}
void main() {
    vec2 d = uTexelSize;
    vec3 s = sampleSoft(vUv) * 0.4;
    s += sampleSoft(vUv + vec2(-d.x, -d.y)) * 0.15;
    s += sampleSoft(vUv + vec2( d.x, -d.y)) * 0.15;
    s += sampleSoft(vUv + vec2(-d.x,  d.y)) * 0.15;
    s += sampleSoft(vUv + vec2( d.x,  d.y)) * 0.15;
    fragColor = vec4(s, 1.0);
}`;

const DOWNSAMPLE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexelSize;
out vec4 fragColor;
void main() {
    vec2 d = uTexelSize;
    vec3 sum = texture(uTex, vUv).rgb * 0.5;
    sum += texture(uTex, vUv + vec2(-d.x, -d.y)).rgb * 0.125;
    sum += texture(uTex, vUv + vec2( d.x, -d.y)).rgb * 0.125;
    sum += texture(uTex, vUv + vec2(-d.x,  d.y)).rgb * 0.125;
    sum += texture(uTex, vUv + vec2( d.x,  d.y)).rgb * 0.125;
    fragColor = vec4(sum, 1.0);
}`;

const UPSAMPLE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexelSize;
uniform float uRadius;
out vec4 fragColor;
void main() {
    vec2 d = uTexelSize * uRadius;
    vec3 sum = texture(uTex, vUv + vec2(-d.x, -d.y)).rgb;
    sum += texture(uTex, vUv + vec2( d.x, -d.y)).rgb;
    sum += texture(uTex, vUv + vec2(-d.x,  d.y)).rgb;
    sum += texture(uTex, vUv + vec2( d.x,  d.y)).rgb;
    fragColor = vec4(sum * 0.25, 1.0);
}`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTrailTex;
uniform sampler2D uBloomTex;
uniform float uBloomStrength;
uniform float uLuminescence;
uniform float uTime;
out vec4 fragColor;
vec3 acesToneMap(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
void main() {
    vec2 centered = vUv - 0.5;
    float r2 = dot(centered, centered);
    vec2 disp = centered * (0.0014 * uLuminescence * (0.4 + r2));
    float r = texture(uTrailTex, vUv + disp).r;
    float g = texture(uTrailTex, vUv).g;
    float b = texture(uTrailTex, vUv - disp).b;
    vec3 hdr = vec3(r, g, b) + texture(uBloomTex, vUv).rgb * uBloomStrength;
    float vig = 1.0 - smoothstep(0.32, 1.15, r2 * 1.45);
    hdr *= mix(0.65, 1.0, vig);
    hdr += vec3(0.0022, 0.0026, 0.0042) * vig;
    vec3 srgb = pow(acesToneMap(hdr), vec3(1.0 / 2.2));
    float grain = (hash12(gl_FragCoord.xy + fract(uTime * 17.3) * 193.0) - 0.5) * 0.011;
    fragColor = vec4(clamp(srgb + grain, 0.0, 1.0), 1.0);
}`;

function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error('Shader compile error: ' + log);
    }
    return shader;
}

function createProgram(gl, vsSrc, fsSrc) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('Program link error: ' + gl.getProgramInfoLog(prog));
    }
    return prog;
}

function getUniforms(gl, prog, names) {
    const map = {};
    for (const n of names) map[n] = gl.getUniformLocation(prog, n);
    return map;
}

function createRenderTarget(gl, width, height, useFloat) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (useFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, width, height };
}

function destroyRenderTarget(gl, rt) {
    if (!rt) return;
    gl.deleteFramebuffer(rt.fbo);
    gl.deleteTexture(rt.tex);
}

class KLSRWebGL2Renderer {
    constructor(canvas, maxSegments, nodeCount) {
        this.canvas = canvas;
        this.maxSegments = maxSegments;
        this.nodeCount = nodeCount;
        const gl = canvas.getContext('webgl2', {
            alpha: false, antialias: false, depth: false, stencil: false,
            powerPreference: 'high-performance', preserveDrawingBuffer: false,
        });
        if (!gl) throw new Error('WebGL2 unavailable');
        this.gl = gl;
        const extFloat = gl.getExtension('EXT_color_buffer_float');
        const extHalf = gl.getExtension('EXT_color_buffer_half_float');
        this.useFloat = Boolean(extFloat || extHalf);
        this.width = 1;
        this.height = 1;
        this.dpr = 1;
        this.trailIdx = 0;
        this.instanceStrideFloats = 9;
        this.instanceData = new Float32Array(this.maxSegments * this.instanceStrideFloats);
        this._initShaders();
        this._initBuffers();
        this.resize();
    }

    _initShaders() {
        const gl = this.gl;
        this.beamProg = createProgram(gl, BEAM_VERT, BEAM_FRAG);
        this.beamU = getUniforms(gl, this.beamProg, ['uViewProj', 'uResolution', 'uDpr', 'uLuminescence', 'uColorCore', 'uColorEdge', 'uColorAccent']);
        this.nodeProg = createProgram(gl, NODE_VERT, NODE_FRAG);
        this.nodeU = getUniforms(gl, this.nodeProg, ['uViewProj', 'uDpr', 'uLuminescence', 'uDormantAlpha', 'uColorCore', 'uColorEdge', 'uColorAccent']);
        this.persistProg = createProgram(gl, FULLSCREEN_VERT, PERSIST_FRAG);
        this.persistU = getUniforms(gl, this.persistProg, ['uSceneTex', 'uPrevTrailTex', 'uDecay']);
        this.threshProg = createProgram(gl, FULLSCREEN_VERT, THRESHOLD_FRAG);
        this.threshU = getUniforms(gl, this.threshProg, ['uTex', 'uTexelSize', 'uThreshold', 'uKnee']);
        this.downProg = createProgram(gl, FULLSCREEN_VERT, DOWNSAMPLE_FRAG);
        this.downU = getUniforms(gl, this.downProg, ['uTex', 'uTexelSize']);
        this.upProg = createProgram(gl, FULLSCREEN_VERT, UPSAMPLE_FRAG);
        this.upU = getUniforms(gl, this.upProg, ['uTex', 'uTexelSize', 'uRadius']);
        this.compProg = createProgram(gl, FULLSCREEN_VERT, COMPOSITE_FRAG);
        this.compU = getUniforms(gl, this.compProg, ['uTrailTex', 'uBloomTex', 'uBloomStrength', 'uLuminescence', 'uTime']);
    }

    _initBuffers() {
        const gl = this.gl;
        this.emptyVao = gl.createVertexArray();
        this.beamVao = gl.createVertexArray();
        gl.bindVertexArray(this.beamVao);

        this.quadVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        this.instanceVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
        const stride = this.instanceStrideFloats * 4;
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 0); gl.vertexAttribDivisor(1, 1);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 12); gl.vertexAttribDivisor(2, 1);
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 24); gl.vertexAttribDivisor(3, 1);
        gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 28); gl.vertexAttribDivisor(4, 1);
        gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 1, gl.FLOAT, false, stride, 32); gl.vertexAttribDivisor(5, 1);

        this.nodeVao = gl.createVertexArray();
        gl.bindVertexArray(this.nodeVao);
        this.nodePosVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.nodePosVbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.nodeCount * 3 * 4, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

        this.nodeFlashVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeFlashVbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.nodeCount * 4, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);

        this.nodePhaseVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.nodePhaseVbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.nodeCount * 4, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
    }

    resize() {
        const gl = this.gl;
        this.dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1.5);
        const w = Math.max(2, Math.floor(((typeof window !== 'undefined' && window.innerWidth) || 800) * this.dpr));
        const h = Math.max(2, Math.floor(((typeof window !== 'undefined' && window.innerHeight) || 600) * this.dpr));
        if (w === this.width && h === this.height && this.sceneFBO) return;
        this.width = w; this.height = h;
        this.canvas.width = w; this.canvas.height = h;

        destroyRenderTarget(gl, this.sceneFBO);
        destroyRenderTarget(gl, this.trailFBOs && this.trailFBOs[0]);
        destroyRenderTarget(gl, this.trailFBOs && this.trailFBOs[1]);
        if (this.bloomMips) this.bloomMips.forEach((m) => destroyRenderTarget(gl, m));

        this.sceneFBO = createRenderTarget(gl, w, h, this.useFloat);
        this.trailFBOs = [createRenderTarget(gl, w, h, this.useFloat), createRenderTarget(gl, w, h, this.useFloat)];
        this.clearTrails();

        this.bloomMips = [];
        let bw = w, bh = h;
        for (let level = 0; level < 4; level++) {
            bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1);
            this.bloomMips.push(createRenderTarget(gl, bw, bh, this.useFloat));
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    clearTrails() {
        const gl = this.gl;
        if (!this.trailFBOs) return;
        for (let i = 0; i < 2; i++) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFBOs[i].fbo);
            gl.viewport(0, 0, this.width, this.height);
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    uploadPhases(phases) {
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.nodePhaseVbo);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, phases);
    }

    uploadNodePositions(nodePositions) {
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.nodePosVbo);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, nodePositions);
    }

    render({ viewProj, nodeFlashes, segmentCount, luminescence, persistence, dormantAlpha, spec, time, dt }) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO.fbo);
        gl.viewport(0, 0, this.width, this.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeFlashVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, nodeFlashes);
        gl.useProgram(this.nodeProg);
        gl.uniformMatrix4fv(this.nodeU.uViewProj, false, viewProj);
        gl.uniform1f(this.nodeU.uDpr, this.dpr);
        gl.uniform1f(this.nodeU.uLuminescence, luminescence);
        gl.uniform1f(this.nodeU.uDormantAlpha, dormantAlpha);
        gl.uniform3fv(this.nodeU.uColorCore, spec.core);
        gl.uniform3fv(this.nodeU.uColorEdge, spec.edge);
        gl.uniform3fv(this.nodeU.uColorAccent, spec.accent);
        gl.bindVertexArray(this.nodeVao);
        gl.drawArrays(gl.POINTS, 0, this.nodeCount);

        if (segmentCount > 0) {
            const count = Math.min(segmentCount, this.maxSegments);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, count * this.instanceStrideFloats));
            gl.useProgram(this.beamProg);
            gl.uniformMatrix4fv(this.beamU.uViewProj, false, viewProj);
            gl.uniform2f(this.beamU.uResolution, this.width, this.height);
            gl.uniform1f(this.beamU.uDpr, this.dpr);
            gl.uniform1f(this.beamU.uLuminescence, luminescence);
            gl.uniform3fv(this.beamU.uColorCore, spec.core);
            gl.uniform3fv(this.beamU.uColorEdge, spec.edge);
            gl.uniform3fv(this.beamU.uColorAccent, spec.accent);
            gl.bindVertexArray(this.beamVao);
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
        }

        gl.disable(gl.BLEND);
        gl.bindVertexArray(this.emptyVao);

        const srcTrail = this.trailFBOs[this.trailIdx];
        const dstTrail = this.trailFBOs[1 - this.trailIdx];
        const frameNormDecay = Math.pow(persistence, Math.max(dt, 0.001) * 60.0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, dstTrail.fbo);
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(this.persistProg);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.sceneFBO.tex); gl.uniform1i(this.persistU.uSceneTex, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, srcTrail.tex); gl.uniform1i(this.persistU.uPrevTrailTex, 1);
        gl.uniform1f(this.persistU.uDecay, frameNormDecay);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.trailIdx = 1 - this.trailIdx;

        const mip0 = this.bloomMips[0];
        gl.bindFramebuffer(gl.FRAMEBUFFER, mip0.fbo);
        gl.viewport(0, 0, mip0.width, mip0.height);
        gl.useProgram(this.threshProg);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dstTrail.tex); gl.uniform1i(this.threshU.uTex, 0);
        gl.uniform2f(this.threshU.uTexelSize, 1.0 / this.width, 1.0 / this.height);
        gl.uniform1f(this.threshU.uThreshold, Math.max(0.18, 0.72 - luminescence * 0.16));
        gl.uniform1f(this.threshU.uKnee, 0.45);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.useProgram(this.downProg);
        for (let i = 0; i < this.bloomMips.length - 1; i++) {
            const from = this.bloomMips[i], to = this.bloomMips[i + 1];
            gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
            gl.viewport(0, 0, to.width, to.height);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, from.tex); gl.uniform1i(this.downU.uTex, 0);
            gl.uniform2f(this.downU.uTexelSize, 1.0 / from.width, 1.0 / from.height);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(this.upProg);
        for (let i = this.bloomMips.length - 1; i > 0; i--) {
            const from = this.bloomMips[i], to = this.bloomMips[i - 1];
            gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
            gl.viewport(0, 0, to.width, to.height);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, from.tex); gl.uniform1i(this.upU.uTex, 0);
            gl.uniform2f(this.upU.uTexelSize, 1.0 / from.width, 1.0 / from.height);
            gl.uniform1f(this.upU.uRadius, 1.05 + luminescence * 0.12);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        gl.disable(gl.BLEND);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(this.compProg);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dstTrail.tex); gl.uniform1i(this.compU.uTrailTex, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mip0.tex); gl.uniform1i(this.compU.uBloomTex, 1);
        gl.uniform1f(this.compU.uBloomStrength, 0.24 + luminescence * 0.28);
        gl.uniform1f(this.compU.uLuminescence, luminescence);
        gl.uniform1f(this.compU.uTime, time);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
    }
}

class KLSR2DFallbackRenderer {
    constructor(canvas, maxSegments, nodeCount) {
        this.canvas = canvas;
        this.maxSegments = maxSegments;
        this.nodeCount = nodeCount;
        this.instanceStrideFloats = 9;
        this.instanceData = new Float32Array(maxSegments * this.instanceStrideFloats);
        this.ctx = canvas.getContext ? canvas.getContext('2d') : null;
        this.nodePositions = new Float32Array(nodeCount * 3);
        this.resize();
    }
    resize() {
        const w = Math.max(2, (typeof window !== 'undefined' && window.innerWidth) || 800);
        const h = Math.max(2, (typeof window !== 'undefined' && window.innerHeight) || 600);
        this.canvas.width = w; this.canvas.height = h;
        this.width = w; this.height = h;
    }
    clearTrails() {
        if (!this.ctx) return;
        this.ctx.fillStyle = '#010103';
        this.ctx.fillRect(0, 0, this.width, this.height);
    }
    uploadPhases() {}
    uploadNodePositions(pos) { this.nodePositions.set(pos); }
    render({ viewProj, segmentCount, luminescence, persistence, spec }) {
        const ctx = this.ctx;
        if (!ctx) return;
        const w = this.width, h = this.height;
        ctx.fillStyle = `rgba(1, 1, 3, ${clamp(1 - persistence * 0.9, 0.08, 0.65)})`;
        ctx.fillRect(0, 0, w, h);

        const project = (x, y, z) => {
            const cx = viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12];
            const cy = viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13];
            const cw = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
            if (cw <= 0.1) return null;
            return [(cx / cw * 0.5 + 0.5) * w, (-cy / cw * 0.5 + 0.5) * h];
        };

        const ec = spec.edge.map(c => Math.round(clamp(c, 0, 1) * 255));
        ctx.fillStyle = `rgba(${ec[0]}, ${ec[1]}, ${ec[2]}, ${clamp(0.12 * luminescence, 0.04, 0.35)})`;
        for (let i = 0; i < this.nodeCount; i += 4) {
            const p = project(this.nodePositions[i * 3], this.nodePositions[i * 3 + 1], this.nodePositions[i * 3 + 2]);
            if (p) ctx.fillRect(p[0], p[1], 1.3, 1.3);
        }

        const cc = spec.core.map(c => Math.round(clamp(c, 0, 1) * 255));
        ctx.lineWidth = 1.4;
        for (let i = 0; i < segmentCount; i++) {
            const o = i * this.instanceStrideFloats;
            const p0 = project(this.instanceData[o], this.instanceData[o + 1], this.instanceData[o + 2]);
            const p1 = project(this.instanceData[o + 3], this.instanceData[o + 4], this.instanceData[o + 5]);
            if (!p0 || !p1) continue;
            const alpha = clamp(this.instanceData[o + 6] * 0.55 * luminescence, 0.05, 1.0);
            ctx.strokeStyle = `rgba(${cc[0]}, ${cc[1]}, ${cc[2]}, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(p0[0], p0[1]);
            ctx.lineTo(p1[0], p1[1]);
            ctx.stroke();
        }
    }
}

function mat4Perspective(fovRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovRad * 0.5);
    const nf = 1.0 / (near - far);
    const out = new Float32Array(16);
    out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1.0; out[14] = 2.0 * far * near * nf;
    return out;
}

function mat4LookAt(eye, target, up) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let len = Math.hypot(zx, zy, zz) || 1.0; zx /= len; zy /= len; zz /= len;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz) || 1.0; xx /= len; xy /= len; xz /= len;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    const out = new Float32Array(16);
    out[0] = xx; out[4] = xy; out[8] = xz; out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[1] = yx; out[5] = yy; out[9] = yz; out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[2] = zx; out[6] = zy; out[10] = zz; out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
    return out;
}

function mat4Mul(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
        const b0 = b[col * 4], b1 = b[col * 4 + 1], b2 = b[col * 4 + 2], b3 = b[col * 4 + 3];
        out[col * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
        out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
        out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
        out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
}

function _createVoidEngine(canvas) {
    const MAX_SEGMENTS = 320;
    const MAX_RUNNERS = 5;
    const CHAIN_CAP = 18;
    const MAX_RICOCHETS = 48;

    let renderer;
    try {
        renderer = new KLSRWebGL2Renderer(canvas, MAX_SEGMENTS, POINT_COUNT);
    } catch (_) {
        renderer = new KLSR2DFallbackRenderer(canvas, MAX_SEGMENTS, POINT_COUNT);
    }

    const manifold = buildAizawaManifold(2049);
    const activePositions = new Float32Array(POINT_COUNT * 3);
    const nodeFlashes = new Float32Array(POINT_COUNT);
    const ricochetSegments = Array.from({ length: MAX_RICOCHETS }, () => ({ a: 0, b: 0, energy: 0, width: 1, tint: 0 }));
    let ricochetWriteIdx = 0;
    let lastSpread = -1;

    const cam = {
        yaw: 0.45, pitch: 0.22, dist: 2.55,
        targetYaw: 0.45, targetPitch: 0.22, targetDist: 2.55,
        mouseX: 0, mouseY: 0, dragging: false, lastX: 0, lastY: 0,
    };

    const runners = Array.from({ length: MAX_RUNNERS }, (_, i) => ({
        mode: 'SNAP', curr: 0, prev: 0, next: 1,
        hopAccum: Math.random() * 0.5, burstRemaining: 6 + (i % 5) * 2, holdTimer: 0,
        speedMult: 0.84 + (i / MAX_RUNNERS) * 0.36, tint: i / MAX_RUNNERS, chainHead: 0,
        chain: Array.from({ length: CHAIN_CAP }, () => ({ a: 0, b: 0, energy: 0, width: 1, tint: 0 })),
    }));

    function updatePositions(spread) {
        if (Math.abs(spread - lastSpread) < 0.0008) return;
        lastSpread = spread;
        const base = manifold.basePositions, scatter = manifold.scatterDirs;
        const scale = 0.86 + spread * 0.42;
        const disp = spread * 0.62;
        for (let i = 0; i < POINT_COUNT * 3; i++) {
            activePositions[i] = base[i] * scale + scatter[i] * disp;
        }
        renderer.uploadNodePositions(activePositions);
    }

    function pickNextNode(currIdx, prevIdx, spread) {
        const tightOffset = currIdx * manifold.tightK;
        const arcOffset = currIdx * manifold.arcK;
        if (Math.random() < Math.min(0.65, 0.06 + spread * 0.24)) {
            for (let t = 0; t < 4; t++) {
                const c = manifold.arcNeighbors[arcOffset + Math.floor(Math.random() * manifold.arcK)];
                if (c !== currIdx && c !== prevIdx) return c;
            }
            return manifold.arcNeighbors[arcOffset];
        }
        const fx = manifold.flowDirs[currIdx * 3], fy = manifold.flowDirs[currIdx * 3 + 1], fz = manifold.flowDirs[currIdx * 3 + 2];
        const px = activePositions[currIdx * 3], py = activePositions[currIdx * 3 + 1], pz = activePositions[currIdx * 3 + 2];
        let best = manifold.tightNeighbors[tightOffset], bestScore = -1e9;
        for (let probe = 0; probe < 4; probe++) {
            const cand = manifold.tightNeighbors[tightOffset + Math.floor(Math.random() * manifold.tightK)];
            if (cand === currIdx || cand === prevIdx) continue;
            const dx = activePositions[cand * 3] - px, dy = activePositions[cand * 3 + 1] - py, dz = activePositions[cand * 3 + 2] - pz;
            const d = Math.hypot(dx, dy, dz) + 1e-5;
            const score = ((dx * fx + dy * fy + dz * fz) / d) * 0.85 + Math.random() * 0.75;
            if (score > bestScore) { bestScore = score; best = cand; }
        }
        return best;
    }

    for (let i = 0; i < MAX_RUNNERS; i++) {
        const r = runners[i];
        const start = Math.floor((i / MAX_RUNNERS) * POINT_COUNT + Math.random() * 60) % POINT_COUNT;
        r.prev = start; r.curr = start; r.next = manifold.tightNeighbors[start * manifold.tightK];
    }
    updatePositions(0.50);
    renderer.uploadPhases(manifold.phases);

    // Orbit & zoom pointer controls
    if (typeof canvas.addEventListener === 'function') {
        const activePointers = new Map();
        let lastPinch = 0;
        const pinchDist = () => {
            const pts = Array.from(activePointers.values());
            return pts.length < 2 ? 0 : Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        };
        canvas.addEventListener('pointerdown', (e) => {
            activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            cam.dragging = activePointers.size === 1;
            cam.lastX = e.clientX; cam.lastY = e.clientY;
            if (activePointers.size === 2) lastPinch = pinchDist();
            try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        });
        canvas.addEventListener('pointermove', (e) => {
            if (e.pointerType === 'mouse') {
                cam.mouseX = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
                cam.mouseY = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
            }
            if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (activePointers.size === 2) {
                const dist = pinchDist();
                if (lastPinch > 0) cam.targetDist = clamp(cam.targetDist + (lastPinch - dist) * 0.0065, 1.35, 5.2);
                lastPinch = dist;
            } else if (cam.dragging && activePointers.size === 1) {
                const dx = e.clientX - cam.lastX, dy = e.clientY - cam.lastY;
                cam.lastX = e.clientX; cam.lastY = e.clientY;
                cam.targetYaw -= dx * 0.0055;
                cam.targetPitch = clamp(cam.targetPitch + dy * 0.0055, -1.35, 1.35);
            }
        });
        const endDrag = (e) => {
            activePointers.delete(e.pointerId);
            if (activePointers.size < 2) lastPinch = 0;
            if (activePointers.size === 1) {
                const rem = Array.from(activePointers.values())[0];
                cam.lastX = rem.x; cam.lastY = rem.y; cam.dragging = true;
            } else cam.dragging = false;
        };
        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            cam.targetDist = clamp(cam.targetDist + e.deltaY * 0.0014, 1.35, 5.2);
        }, { passive: false });
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('resize', () => renderer.resize());
    }

    let lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let rafId = null;

    function computeVisualParams(nowPerf) {
        const vitals = getVitals(Date.now());
        if (_flatlineActive) {
            const elapsed = Math.max(0, (Date.now() - _flatlineStartedAt) / 1400);
            const collapse = clamp(1 - elapsed, 0, 1);
            return {
                speed: 0.03 + 0.08 * collapse,
                klsrLuminescence: 0.35 + 0.55 * collapse,
                klsrPersistence: 0.35 + 0.35 * collapse,
                spread: 0.01 * collapse,
                spec: SPECTRUM_STOPS[0],
            };
        }
        const bootElapsed = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - _bootStartedAt);
        let bootBlend = 0; // 1 = max ignition, 0 = real-time live state
        if (bootElapsed < BOOT_HOLD_MS) {
            bootBlend = 1.0;
        } else if (bootElapsed < BOOT_TOTAL_MS) {
            const p = (bootElapsed - BOOT_HOLD_MS) / BOOT_DRAIN_MS;
            const eased = 1 - Math.pow(1 - p, 3);
            bootBlend = 1.0 - eased;
        }

        const peakSpec = SPECTRUM_STOPS[SPECTRUM_STOPS.length - 1];
        const boost = _pulseBoost * 0.35;
        return {
            speed: lerp(vitals.speed, 1.0, bootBlend) + boost * 0.25,
            klsrLuminescence: lerp(vitals.klsrLuminescence, 1.90, bootBlend) + boost,
            klsrPersistence: lerp(vitals.klsrPersistence, 0.88, bootBlend),
            spread: lerp(vitals.spread, 0.50, bootBlend),
            spec: {
                core: lerpVec3(vitals.spectrum.core, peakSpec.core, bootBlend),
                edge: lerpVec3(vitals.spectrum.edge, peakSpec.edge, bootBlend),
                accent: lerpVec3(vitals.spectrum.accent, peakSpec.accent, bootBlend),
            },
        };
    }

    function step(now) {
        rafId = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(step) : null;
        if (_renderingPaused) { lastTime = now; return; }

        const rawDt = (now - lastTime) * 0.001;
        lastTime = now;
        const dt = clamp(rawDt, 0.0005, 0.05);
        const timeSec = now * 0.001;

        if (_pulseBoost > 0.001) _pulseBoost *= Math.exp(-dt * 2.8);
        else _pulseBoost = 0;

        const vp = computeVisualParams(now);
        updatePositions(vp.spread);

        if (!cam.dragging) cam.targetYaw += dt * (0.14 + vp.speed * 0.045);
        cam.yaw += (cam.targetYaw + cam.mouseX * 0.12 - cam.yaw) * Math.min(1, dt * 6.5);
        cam.pitch += (cam.targetPitch - cam.mouseY * 0.1 - cam.pitch) * Math.min(1, dt * 6.5);
        cam.dist += (cam.targetDist - cam.dist) * Math.min(1, dt * 7.5);

        const cp = Math.cos(cam.pitch);
        const eye = [cam.dist * cp * Math.sin(cam.yaw), cam.dist * Math.sin(cam.pitch), cam.dist * cp * Math.cos(cam.yaw)];
        const aspect = Math.max(0.1, ((typeof window !== 'undefined' && window.innerWidth) || 800) / Math.max(1, (typeof window !== 'undefined' && window.innerHeight) || 600));
        const viewProj = mat4Mul(mat4Perspective((46 * Math.PI) / 180, aspect, 0.08, 40.0), mat4LookAt(eye, [0, 0, 0], [0, 1, 0]));

        const segDecaySnap = Math.exp(-dt * (18.0 - vp.klsrPersistence * 13.5));
        const segDecayHold = Math.exp(-dt * (28.0 - vp.klsrPersistence * 16.0));
        for (let i = 0; i < MAX_RICOCHETS; i++) {
            const s = ricochetSegments[i];
            s.energy = s.energy > 0.01 ? s.energy * segDecaySnap : 0;
        }
        const flashDecay = Math.exp(-dt * 10.5);
        for (let i = 0; i < POINT_COUNT; i++) {
            nodeFlashes[i] = nodeFlashes[i] > 0.002 ? nodeFlashes[i] * flashDecay : 0;
        }

        // Lub-dub biological cardiac micro-cadence layered over base speed
        const bpm = 42 + vp.speed * 68;
        const beatPhase = ((timeSec * (bpm / 60)) % 1.0);
        const lub = Math.exp(-Math.pow((beatPhase - 0.12) / 0.07, 2));
        const dub = Math.exp(-Math.pow((beatPhase - 0.30) / 0.08, 2)) * 0.72;
        const cardiacPulse = 0.68 + 0.55 * (lub + dub);

        const activeCount = clamp(Math.round(1 + vp.speed * 3.8), 1, MAX_RUNNERS);
        const baseHopsPerSec = (14.0 + vp.speed * 86.0) * cardiacPulse;

        const inst = renderer.instanceData;
        let writeCount = 0;
        const pushInstance = (a, b, energy, width, tint) => {
            if (writeCount >= MAX_SEGMENTS) return;
            const a3 = a * 3, b3 = b * 3, o = writeCount * renderer.instanceStrideFloats;
            inst[o] = activePositions[a3]; inst[o + 1] = activePositions[a3 + 1]; inst[o + 2] = activePositions[a3 + 2];
            inst[o + 3] = activePositions[b3]; inst[o + 4] = activePositions[b3 + 1]; inst[o + 5] = activePositions[b3 + 2];
            inst[o + 6] = energy; inst[o + 7] = width; inst[o + 8] = tint;
            writeCount++;
        };

        for (let r = 0; r < activeCount; r++) {
            const runner = runners[r];
            const decay = runner.mode === 'HOLD' ? segDecayHold : segDecaySnap;
            for (let c = 0; c < CHAIN_CAP; c++) {
                const seg = runner.chain[c];
                seg.energy = seg.energy > 0.01 ? seg.energy * decay : 0;
            }
            if (runner.mode === 'HOLD') {
                runner.holdTimer -= dt;
                nodeFlashes[runner.curr] = Math.max(nodeFlashes[runner.curr], 0.72);
                if (runner.holdTimer <= 0) {
                    runner.mode = 'SNAP';
                    runner.hopAccum = 0.65;
                    runner.burstRemaining = 4 + Math.floor(Math.random() * (5 + vp.speed * 5));
                    if (Math.random() < 0.65) {
                        const fresh = Math.random() < 0.45 + vp.spread * 0.18
                            ? Math.floor(Math.random() * POINT_COUNT)
                            : manifold.arcNeighbors[runner.curr * manifold.arcK + Math.floor(Math.random() * manifold.arcK)];
                        runner.prev = fresh; runner.curr = fresh; runner.next = pickNextNode(fresh, fresh, vp.spread);
                        nodeFlashes[fresh] = Math.min(1.25, nodeFlashes[fresh] + 0.9);
                    } else {
                        const target = manifold.arcNeighbors[runner.curr * manifold.arcK + Math.floor(Math.random() * manifold.arcK)];
                        const rs = ricochetSegments[ricochetWriteIdx];
                        rs.a = runner.curr; rs.b = target; rs.energy = 1.35; rs.width = 1.15; rs.tint = (runner.tint + 0.15) % 1;
                        ricochetWriteIdx = (ricochetWriteIdx + 1) % MAX_RICOCHETS;
                        nodeFlashes[target] = Math.min(1.35, nodeFlashes[target] + 1.25);
                        runner.prev = runner.curr; runner.curr = target; runner.next = pickNextNode(target, runner.prev, vp.spread);
                    }
                }
            } else {
                runner.hopAccum += baseHopsPerSec * runner.speedMult * dt;
                let subHops = 0;
                while (runner.hopAccum >= 1.0 && runner.burstRemaining > 0 && subHops < 6) {
                    runner.hopAccum -= 1.0; runner.burstRemaining--; subHops++;
                    const fromIdx = runner.curr, toIdx = runner.next;
                    const cs = runner.chain[runner.chainHead];
                    cs.a = fromIdx; cs.b = toIdx; cs.energy = 1.15; cs.width = 1.0; cs.tint = runner.tint;
                    runner.chainHead = (runner.chainHead + 1) % CHAIN_CAP;
                    nodeFlashes[toIdx] = Math.min(1.35, nodeFlashes[toIdx] + 1.25);
                    runner.prev = fromIdx; runner.curr = toIdx; runner.next = pickNextNode(toIdx, fromIdx, vp.spread);
                    runner.tint = (runner.tint + 0.018) % 1.0;
                    if (runner.burstRemaining <= 0) {
                        runner.mode = 'HOLD';
                        runner.holdTimer = (0.035 + Math.random() * 0.065) / (0.4 + vp.speed * 0.75);
                        break;
                    }
                }
            }

            for (let age = 0; age < CHAIN_CAP; age++) {
                const seg = runner.chain[(runner.chainHead - 1 - age + CHAIN_CAP) % CHAIN_CAP];
                if (seg.energy <= 0.015) continue;
                const headBoost = age === 0 && runner.mode === 'SNAP' ? 1.45 : 1.0;
                const tailTaper = Math.pow(1.0 - age / CHAIN_CAP, 1.1);
                const w = age === 0 ? 1.18 : Math.max(0.45, 0.95 - age * 0.035);
                pushInstance(seg.a, seg.b, seg.energy * headBoost * tailTaper, w, seg.tint);
            }
        }

        for (let i = 0; i < MAX_RICOCHETS && writeCount < MAX_SEGMENTS; i++) {
            const s = ricochetSegments[i];
            if (s.energy > 0.015) pushInstance(s.a, s.b, s.energy, s.width, s.tint);
        }

        const dormantAlpha = 0.018 + Math.min(0.025, vp.spread * 0.02);
        const effectiveFboPersistence = 0.18 + Math.pow(vp.klsrPersistence, 2.2) * 0.56;
        renderer.render({
            viewProj,
            nodeFlashes,
            segmentCount: writeCount,
            luminescence: vp.klsrLuminescence,
            persistence: effectiveFboPersistence,
            dormantAlpha,
            spec: vp.spec,
            time: timeSec,
            dt,
        });
    }

    if (typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(step);
    }

    return {
        resize: () => renderer.resize(),
        destroy: () => { if (rafId != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId); },
    };
}

// ── UI, Modals, Boot Intro & Flatline Death Sequence ────────────────────────
function _formatCountdown(hours) {
    const totalSecs = Math.max(0, Math.floor(hours * 3600));
    const hh = Math.floor(totalSecs / 3600);
    const mm = Math.floor((totalSecs % 3600) / 60);
    const ss = totalSecs % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function _ensureDomContainers() {
    if (typeof document === 'undefined' || !document.body) return;
    if (!document.getElementById('heartbeat-vitals-overlay')) {
        const vitals = document.createElement('div');
        vitals.id = 'heartbeat-vitals-overlay';
        vitals.className = 'hb-vitals-overlay';
        vitals.hidden = true;
        vitals.innerHTML = `<div class="hb-vitals-card" role="dialog" aria-modal="true" aria-labelledby="hb-vitals-clock">
            <div class="hb-vitals-head">
                <div>
                    <div class="hb-vitals-kicker">KLSR // AIZAWA FLUX TELEMETRY</div>
                    <div class="hb-vitals-clock" id="hb-vitals-clock">30:00:00</div>
                    <div class="hb-vitals-sub" id="hb-vitals-sub">30.0h / 30.0h RESERVOIR</div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                    <span class="hb-vitals-stage" id="hb-vitals-stage">XENON WHITE</span>
                    <button type="button" class="hb-vitals-close" id="hb-vitals-close" aria-label="Close vitals">✕</button>
                </div>
            </div>
            <div class="hb-vitals-grid" id="hb-vitals-grid"></div>
            <div class="hb-prescription" id="hb-prescription"></div>
        </div>`;
        vitals.addEventListener('click', (e) => { if (e.target === vitals) closeVitals(); });
        document.body.appendChild(vitals);
        const closeBtn = document.getElementById('hb-vitals-close');
        if (closeBtn) closeBtn.addEventListener('click', closeVitals);
    }

    if (!document.getElementById('heartbeat-nav-menu')) {
        const menu = document.createElement('div');
        menu.id = 'heartbeat-nav-menu';
        menu.className = 'hb-nav-menu';
        menu.hidden = true;
        menu.innerHTML = `
            <button type="button" class="hb-nav-item" data-hb-nav="errors"><span>THE VAULT</span><span class="hb-nav-item-sub">ERRORS</span></button>
            <button type="button" class="hb-nav-item" data-hb-nav="mocks"><span>MOCKS</span><span class="hb-nav-item-sub">EXAMS</span></button>
            <button type="button" class="hb-nav-item" data-hb-nav="settings"><span>CONFIG</span><span class="hb-nav-item-sub">SYSTEM</span></button>
        `;
        menu.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-hb-nav]');
            if (!btn) return;
            const tab = btn.getAttribute('data-hb-nav');
            closeNavMenu();
            if (typeof window.switchTab === 'function') window.switchTab(tab, null);
        });
        document.body.appendChild(menu);
    }

    if (!document.getElementById('heartbeat-flatline-overlay')) {
        const fl = document.createElement('div');
        fl.id = 'heartbeat-flatline-overlay';
        fl.className = 'hb-flatline-overlay';
        fl.hidden = true;
        fl.innerHTML = `
            <div class="hb-flatline-line"></div>
            <div class="hb-flatline-title">FLATLINE // RESERVOIR EXHAUSTED</div>
            <div class="hb-flatline-msg" id="hb-flatline-msg">Terminating all local stores...</div>
            <button type="button" class="hb-flatline-reset" id="hb-flatline-reset-btn" disabled>PURGING DATA...</button>
        `;
        document.body.appendChild(fl);
        const resetBtn = document.getElementById('hb-flatline-reset-btn');
        if (resetBtn) resetBtn.addEventListener('click', resetFromFlatline);
    }
}

function _renderVitals() {
    if (typeof document === 'undefined') return;
    const v = getVitals();
    const { gaps, verdict, critical } = getDiagnosticPrescription(v);
    try {
        document.documentElement.style.setProperty('--hb-spectrum-color', v.spectrum.css);
    } catch (_) {}

    const vitalsBtn = document.getElementById('hb-vitals-btn');
    if (vitalsBtn && vitalsBtn.classList) vitalsBtn.classList.toggle('is-frozen', v.frozen);

    if (!_vitalsOpen) return;
    const clockEl = document.getElementById('hb-vitals-clock');
    const subEl = document.getElementById('hb-vitals-sub');
    const stageEl = document.getElementById('hb-vitals-stage');
    const gridEl = document.getElementById('hb-vitals-grid');
    const prescEl = document.getElementById('hb-prescription');

    const lockedSub = v.lockedPactHours > 0.05
        ? ` · +${v.lockedPactHours.toFixed(2)}h LOCKED (feed ${v.weakestSubject})`
        : '';
    if (clockEl) clockEl.textContent = _formatCountdown(v.reservoirHours);
    if (subEl) subEl.textContent = `${v.reservoirHours.toFixed(2)}h / 30.0h · ${v.frozen ? 'FROZEN IN PACT' : '−1.0h / REAL HR'} · +${v.creditedHoursToday.toFixed(2)}h TODAY${lockedSub}`;
    if (stageEl) {
        stageEl.textContent = v.spectrum.name;
        stageEl.style.color = v.spectrum.css;
        stageEl.style.borderColor = v.spectrum.css;
    }

    if (gridEl) {
        const multPct = Math.round((v.pactMultiplier ?? (0.25 + 0.75 * (v.minP || 0))) * 100);
        gridEl.innerHTML = `
            <div class="hb-vital-box">
                <div class="hb-vital-top"><span>SPEED</span><span class="hb-vital-val">${v.speed.toFixed(2)} / 1.00</span></div>
                <div class="hb-vital-bar"><div class="hb-vital-bar-fill" style="width:${Math.round(v.speed * 100)}%"></div></div>
                <div class="hb-vital-desc">30h reservoir life remaining (${Math.round(v.reservoirRatio * 100)}%). Decays toward 0.05 stutter.</div>
            </div>
            <div class="hb-vital-box">
                <div class="hb-vital-top"><span>LUMINESCENCE</span><span class="hb-vital-val">${v.luminescence.toFixed(2)} / 1.00</span></div>
                <div class="hb-vital-bar"><div class="hb-vital-bar-fill" style="width:${Math.round(v.luminescence * 100)}%"></div></div>
                <div class="hb-vital-desc">3-subject balance (${Math.round(v.parity * 100)}% parity · ${multPct}% Pact pay). Full release at weakest subject floor.</div>
            </div>
            <div class="hb-vital-box">
                <div class="hb-vital-top"><span>PERSISTENCE</span><span class="hb-vital-val">${v.persistence.toFixed(2)} / 1.00</span></div>
                <div class="hb-vital-bar"><div class="hb-vital-bar-fill" style="width:${Math.round(v.persistence * 100)}%"></div></div>
                <div class="hb-vital-desc">Deep Pact endurance + difficulty-weighted solves &amp; Vault dissections.</div>
            </div>
            <div class="hb-vital-box">
                <div class="hb-vital-top"><span>SPREAD</span><span class="hb-vital-val">${v.spread.toFixed(2)} / 0.50</span></div>
                <div class="hb-vital-bar"><div class="hb-vital-bar-fill" style="width:${Math.round((v.spread / 0.50) * 100)}%"></div></div>
                <div class="hb-vital-desc">Aizawa volume (${v.spread.toFixed(2)} max 0.50). Collapses inward toward 0.00 as health dies.</div>
            </div>
        `;
    }

    if (prescEl) {
        const SUBJ_META = {
            physics: { name: 'PHYSICS', short: 'PHYS' },
            chemistry: { name: 'CHEMISTRY', short: 'CHEM' },
            maths: { name: 'MATHS', short: 'MATH' },
        };
        const L = v.leash || {
            epoch: 1,
            dayInEpoch: 1,
            epochDays: LEASH_EPOCH_DAYS,
            pendingCount: 0,
            floors: { physics: DAILY_UNIT_TARGET, chemistry: DAILY_UNIT_TARGET, maths: DAILY_UNIT_TARGET },
            hoursPerUnit: { physics: HOURS_PER_UNIT, chemistry: HOURS_PER_UNIT, maths: HOURS_PER_UNIT },
            trailingAvgs: null,
            projectedFloors: { physics: DAILY_UNIT_TARGET, chemistry: DAILY_UNIT_TARGET, maths: DAILY_UNIT_TARGET },
            lastCalibration: null,
        };
        const pct = (val, tgt) => clamp(Math.round((val / tgt) * 100), 0, 100);
        const cls = (val, tgt) => val >= tgt ? 'is-complete' : (val < tgt * 0.4 ? 'is-lagging' : '');
        const lockedRow = v.lockedPactHours > 0.05
            ? `<div class="hb-presc-locked">+${v.lockedPactHours.toFixed(2)}h LOCKED — feed ${v.weakestSubject} to release</div>`
            : '';
        const subjRowsHtml = SUBJECTS.map(s => {
            const val = v.units[s];
            const tgt = L.floors[s];
            const gap = gaps[s];
            return `
                <div class="hb-presc-row">
                    <span class="hb-presc-lbl">${SUBJ_META[s].name}</span>
                    <div class="hb-presc-track"><div class="hb-presc-fill ${cls(val, tgt)}" style="width:${pct(val, tgt)}%"></div></div>
                    <span class="hb-presc-num">${val.toFixed(1)} / ${tgt.toFixed(1)}u${gap > 0 ? ` (−${gap.toFixed(1)})` : ' ✓'}</span>
                </div>`;
        }).join('');
        const leashCellsHtml = SUBJECTS.map(s => {
            const fl = L.floors[s];
            const hpu = L.hoursPerUnit[s];
            const avg = L.trailingAvgs ? L.trailingAvgs[s] : null;
            const proj = L.projectedFloors ? L.projectedFloors[s] : fl;
            const tightenedCls = fl > LEASH_MIN_FLOOR ? ' is-tightened' : '';
            let trendHtml = `<div class="hb-leash-trend">CALIBRATING (${L.dayInEpoch}/${L.epochDays})</div>`;
            if (avg !== null && avg !== undefined) {
                trendHtml = proj > fl
                    ? `<div class="hb-leash-trend is-rising">AVG ${avg.toFixed(1)}u → ↑ ${proj.toFixed(1)}u</div>`
                    : `<div class="hb-leash-trend">AVG ${avg.toFixed(1)}u → HOLD</div>`;
            }
            return `
                <div class="hb-leash-cell${tightenedCls}">
                    <div class="hb-leash-top">
                        <span class="hb-leash-subj">${SUBJ_META[s].short}</span>
                        <span class="hb-leash-floor">${fl.toFixed(1)}u</span>
                    </div>
                    <div class="hb-leash-yield">${hpu.toFixed(2)}h / u · +5.0h floor</div>
                    ${trendHtml}
                </div>`;
        }).join('');
        const cal = L.lastCalibration;
        const calLogHtml = (cal && Array.isArray(cal.tightened) && cal.tightened.length > 0)
            ? `<div class="hb-leash-log">EPOCH ${String(cal.epoch).padStart(2, '0')} TIGHTENED: ${cal.tightened.map(s => `${SUBJ_META[s].short} +${(cal.nextFloors[s] - cal.prevFloors[s]).toFixed(1)}u`).join(' · ')}</div>`
            : '';

        prescEl.innerHTML = `
            <div class="hb-presc-title">DAILY RECHARGE STANDARD (+24.0H BREAK-EVEN · +30.0H OVERFLOW CAP)</div>
            <div class="hb-presc-rows">
                ${subjRowsHtml}
                <div class="hb-presc-row">
                    <span class="hb-presc-lbl">DEEP PACT</span>
                    <div class="hb-presc-track"><div class="hb-presc-fill ${cls(v.pactMins, DAILY_PACT_TARGET_MINS)}" style="width:${pct(v.pactMins, DAILY_PACT_TARGET_MINS)}%"></div></div>
                    <span class="hb-presc-num">${Math.round(v.pactMins)} / 240m${gaps.pactMins > 0 ? ` (−${gaps.pactMins}m)` : ' ✓'}</span>
                </div>
                ${lockedRow}
            </div>
            <div class="hb-presc-verdict ${critical ? 'is-critical' : ''}">${verdict}</div>
            <div class="hb-leash-panel">
                <div class="hb-leash-head">
                    <span class="hb-presc-title">7-DAY LEASH // EPOCH ${String(L.epoch).padStart(2, '0')} · DAY ${L.dayInEpoch}/${L.epochDays}</span>
                    <span class="hb-leash-badge">ONE-WAY RATCHET</span>
                </div>
                <div class="hb-leash-grid">${leashCellsHtml}</div>
                ${calLogHtml}
            </div>
        `;
    }
}

function _refreshHudAndVitals() {
    _renderVitals();
}

export function openVitals() {
    closeNavMenu();
    _ensureDomContainers();
    _vitalsOpen = true;
    const overlay = document.getElementById('heartbeat-vitals-overlay');
    if (overlay) overlay.hidden = false;
    _renderVitals();
}

export function closeVitals() {
    _vitalsOpen = false;
    const overlay = document.getElementById('heartbeat-vitals-overlay');
    if (overlay) overlay.hidden = true;
}

export function toggleNavMenu() {
    _ensureDomContainers();
    _navMenuOpen = !_navMenuOpen;
    const menu = document.getElementById('heartbeat-nav-menu');
    if (menu) menu.hidden = !_navMenuOpen;
}

export function closeNavMenu() {
    _navMenuOpen = false;
    const menu = document.getElementById('heartbeat-nav-menu');
    if (menu) menu.hidden = true;
}

function _startBootIntro() {
    if (typeof document === 'undefined') return;
    const voidEl = document.getElementById('heartbeat-void');
    if (!voidEl) return;
    _bootStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    voidEl.classList.remove('hb-ready');
    voidEl.classList.add('hb-booting');
    if (_bootTimer) clearTimeout(_bootTimer);
    _bootTimer = setTimeout(() => {
        voidEl.classList.remove('hb-booting');
        voidEl.classList.add('hb-ready');
    }, BOOT_TOTAL_MS);
}

async function _enterFlatlineSequence(checkNowMs = Date.now()) {
    if (_flatlineActive) return _flatlinePromise;
    if (_hbStorageDegraded || isDegradedBoot()) {
        console.warn('[heartbeat] Storage degraded — flatline wipe aborted.');
        return false;
    }
    _flatlineActive = true;
    _flatlineWipeDone = false;

    // Pre-wipe verification: re-read localStorage & IDB BEFORE wiping so a stale
    // background tab can never trigger a false wipe when another tab is alive.
    try {
        const { lsRaw, idbRaw, idbFailed } = await _readPersistedHeartbeat();
        if (idbFailed || isDegradedBoot()) {
            _hbStorageDegraded = true;
            _flatlineActive = false;
            console.warn('[heartbeat] Pre-wipe IDB read failed — aborting wipe to protect data.');
            return false;
        }
        const persistedRaw = (lsRaw && idbRaw)
            ? _mergeHeartbeatRecords(lsRaw, idbRaw, checkNowMs)
            : (idbRaw || lsRaw);
        if (persistedRaw) {
            const p = _normalizeLoadedState(persistedRaw, checkNowMs);
            if (!p.flatlined && p.reservoirHours > 0) {
                const eff = Math.max(checkNowMs, p.highWaterMark, p.lastTickAt);
                const elapsed = Math.max(0, (eff - p.lastTickAt) / 3600000);
                const remaining = p.reservoirHours - elapsed;
                if (remaining > 0.001) {
                    _hb = { ...p, reservoirHours: clamp(remaining, 0, MAX_RESERVOIR_HOURS), lastTickAt: eff, highWaterMark: eff, flatlined: false };
                    _flatlineActive = false;
                    _saveState({ silentBroadcast: true });
                    _refreshHudAndVitals();
                    return false;
                }
            }
        }
    } catch (err) {
        console.warn('[heartbeat] Pre-wipe check fault — aborting wipe to protect data:', err);
        _flatlineActive = false;
        return false;
    }

    _flatlineStartedAt = Date.now();
    _hb.flatlined = true;
    _hb.reservoirHours = 0;
    try { HeartbeatAudio.playFlatlineDrop(); } catch (_) {}
    _saveState();

    if (typeof document !== 'undefined') {
        _ensureDomContainers();
        closeVitals();
        closeNavMenu();
        const fl = document.getElementById('heartbeat-flatline-overlay');
        const msg = document.getElementById('hb-flatline-msg');
        const btn = document.getElementById('hb-flatline-reset-btn');
        if (fl) fl.hidden = false;
        if (msg) msg.textContent = '30.0h reservoir exhausted. Scorched-earth termination in progress — all local databases, question bank, Vault, Mocks, history & checkpoints are being wiped.';
        if (btn) { btn.disabled = true; btn.textContent = 'TERMINATING DATA...'; }
    }

    try {
        await wipeAllAppData();
        // Re-persist ONLY the flatline flag so refreshing mid-death screen cannot dodge the wipe.
        _hb = {
            ..._freshHeartbeatState(Date.now()),
            reservoirHours: 0,
            flatlined: true,
        };
        _saveState();
        try { if (typeof indexedDB !== 'undefined') await idbSet(STORAGE_KEY, _hb); } catch (_) {}
    } catch (err) {
        console.error('[heartbeat] wipe fault:', err);
    }

    _flatlineWipeDone = true;
    if (typeof document !== 'undefined') {
        const msg = document.getElementById('hb-flatline-msg');
        const btn = document.getElementById('hb-flatline-reset-btn');
        if (msg) msg.textContent = 'ALL DATA TERMINATED. Pre-wipe backups and cloud snapshots are permanently locked out.';
        if (btn) { btn.disabled = false; btn.textContent = 'BEGIN FROM ZERO'; }
    }
    return true;
}

export async function resetFromFlatline() {
    if (!_flatlineWipeDone && _flatlineActive) return;
    const now = Date.now();
    const prevSeeded = Number(_hb && _hb.seededAt) || 0;
    _flatlineActive = false;
    _flatlineWipeDone = false;
    _flatlinePromise = null;
    _hb = _freshHeartbeatState(now);
    // Guarantee strictly newer life epoch (>500ms) so an immediate reload can never merge back into the dead flatline record.
    _hb.seededAt = Math.max(now, prevSeeded + 1000);
    _saveState();
    try { if (typeof indexedDB !== 'undefined') await idbSet(STORAGE_KEY, _hb); } catch (_) {}

    if (typeof document !== 'undefined') {
        const fl = document.getElementById('heartbeat-flatline-overlay');
        if (fl) fl.hidden = true;
    }
    try {
        if (typeof window.updateUI === 'function') await window.updateUI();
        if (typeof window.renderErrorMatrixFromBank === 'function') window.renderErrorMatrixFromBank();
    } catch (_) {}
    _startBootIntro();
    _refreshHudAndVitals();
}

export function syncVoidState() {
    if (typeof document === 'undefined' || !document.body) return;
    const practiceView = document.getElementById('view-practice');
    const subjectView = document.getElementById('practice-subject-view');
    const isVoidActive = !!(
        practiceView && practiceView.classList && practiceView.classList.contains('active') &&
        subjectView && subjectView.classList && subjectView.classList.contains('active')
    );
    document.body.classList.toggle('hb-void-active', isVoidActive);
    _renderingPaused = !isVoidActive;
    if (isVoidActive) {
        closeNavMenu();
        if (_voidEngine) _voidEngine.resize();
    }
}

export function returnToVoid() {
    closeVitals();
    closeNavMenu();
    if (typeof window.switchTab === 'function') window.switchTab('practice', null);
    if (typeof window.goToSubjects === 'function') window.goToSubjects();
    syncVoidState();
}

export function openPactFromVoid() {
    closeNavMenu();
    let subj = (AppState && AppState.currentSubject) || 'physics';
    let availChapters = [];
    try {
        if (typeof window.__getLockinScopeCatalog === 'function') {
            const cat = window.__getLockinScopeCatalog('flow');
            if (cat) {
                if (!(cat[subj] && cat[subj].totalEligible > 0)) {
                    const alt = SUBJECTS.find(s => cat[s] && cat[s].totalEligible > 0);
                    if (alt) subj = alt;
                }
                const list = (cat[subj] && cat[subj].chapters) || [];
                availChapters = list.filter(c => c.count > 0).map(c => c.name);
            }
        }
    } catch (_) {}

    const ctx = {
        subject: subj,
        chapter: availChapters.length === 1 ? availChapters[0] : availChapters.join(' • '),
        chapterSelection: availChapters.length > 1 ? availChapters : null,
    };

    if (typeof window.openLockinSetupModal === 'function') {
        window.openLockinSetupModal('flow', ctx, () => {
            if (availChapters.length > 0 && typeof window.__launchLockinScope === 'function') {
                window.__launchLockinScope(ctx);
            } else if (typeof window.__jmaxAppToast === 'function') {
                window.__jmaxAppToast('Pact timer armed — open any subject to solve problems.');
            }
        });
    }
}

export async function initHeartbeat() {
    if (_initialized) {
        tickClock();
        syncVoidState();
        _refreshHudAndVitals();
        return;
    }
    _initialized = true;
    await _loadState();
    _ensureDomContainers();
    tickClock();

    if (typeof document !== 'undefined') {
        const canvas = document.getElementById('heartbeat-canvas');
        if (canvas && !_voidEngine) {
            _voidEngine = _createVoidEngine(canvas);
        }
        const vitalsBtn = document.getElementById('hb-vitals-btn');
        if (vitalsBtn && !vitalsBtn.dataset.hbBound) {
            vitalsBtn.dataset.hbBound = '1';
            vitalsBtn.addEventListener('click', (e) => { e.stopPropagation(); try { HeartbeatAudio.playClick(); } catch (_) {} openVitals(); });
        }
        const pactBtn = document.getElementById('hb-pact-btn');
        if (pactBtn && !pactBtn.dataset.hbBound) {
            pactBtn.dataset.hbBound = '1';
            pactBtn.addEventListener('click', (e) => { e.stopPropagation(); try { HeartbeatAudio.playClick(); } catch (_) {} openPactFromVoid(); });
        }
        const navBtn = document.getElementById('hb-nav-btn');
        if (navBtn && !navBtn.dataset.hbBound) {
            navBtn.dataset.hbBound = '1';
            navBtn.addEventListener('click', (e) => { e.stopPropagation(); try { HeartbeatAudio.playClick(); } catch (_) {} toggleNavMenu(); });
        }
        document.querySelectorAll('.hb-subj-btn').forEach(btn => {
            if (!btn.dataset.hbSfxBound) {
                btn.dataset.hbSfxBound = '1';
                btn.addEventListener('click', () => { try { HeartbeatAudio.playClick(); } catch (_) {} });
            }
        });
        try { HeartbeatAudio.init(); } catch (_) {}
        document.addEventListener('click', (e) => {
            if (!_navMenuOpen) return;
            const menu = document.getElementById('heartbeat-nav-menu');
            const btn = document.getElementById('hb-nav-btn');
            if (menu && !menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
                closeNavMenu();
            }
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                _saveState({ silentBroadcast: true });
                _lastLivePerfMs = null;
                _lastLiveWallMs = null;
            } else {
                _lastLivePerfMs = typeof performance !== 'undefined' ? performance.now() : null;
                _lastLiveWallMs = Date.now();
                tickClock();
                _refreshHudAndVitals();
            }
        });
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('focus', () => { tickClock(); _refreshHudAndVitals(); });
            window.addEventListener('pagehide', () => { _saveState({ silentBroadcast: true }); });
            window.addEventListener('storage', (e) => {
                if (!e || e.key !== STORAGE_KEY || !e.newValue) return;
                try { _adoptRemoteState(JSON.parse(e.newValue)); } catch (_) {}
            });
        }
        try {
            if (typeof BroadcastChannel !== 'undefined') {
                if (!_hbChannel) _hbChannel = new BroadcastChannel(HB_SYNC_CHANNEL);
                _hbChannel.onmessage = (e) => {
                    const msg = e && e.data;
                    if (!msg || msg.type !== 'hb-update' || msg.tabId === _hbTabId) return;
                    _adoptRemoteState(msg.state);
                };
            }
        } catch (_) {}
        let _lastDomTouch = 0;
        const _onUserTouch = () => {
            const t = Date.now();
            if (t - _lastDomTouch > 5000) {
                _lastDomTouch = t;
                touchActivity(t);
            }
        };
        document.addEventListener('pointerdown', _onUserTouch, { passive: true });
        document.addEventListener('keydown', _onUserTouch, { passive: true });
        document.addEventListener('wheel', _onUserTouch, { passive: true });
        document.addEventListener('touchstart', _onUserTouch, { passive: true });
    }

    if (_flatlinePromise) {
        try { await _flatlinePromise; } catch (_) {}
    }

    if (!_hb.flatlined && _hb.reservoirHours > 0) {
        _startBootIntro();
    }
    syncVoidState();
    _refreshHudAndVitals();

    if (_clockTimer) clearInterval(_clockTimer);
    if (typeof setInterval === 'function') {
        _lastLivePerfMs = typeof performance !== 'undefined' ? performance.now() : null;
        _lastLiveWallMs = Date.now();
        _clockTimer = setInterval(() => {
            tickClock(Date.now(), { fromLiveTimer: true });
            _refreshHudAndVitals();
        }, 1000);
    }
}

export const Heartbeat = {
    init: initHeartbeat,
    tickClock,
    getState,
    getVitals,
    getLeashStatus,
    getDiagnosticPrescription,
    getQuestionUnitWeight,
    recordProblemUnit,
    recordPactBlock,
    touchActivity,
    isDecayFrozen,
    isFlatlined: () => Boolean(_hb.flatlined || _flatlineActive),
    openVitals,
    closeVitals,
    toggleNavMenu,
    closeNavMenu,
    syncVoidState,
    returnToVoid,
    openPactFromVoid,
    resetFromFlatline,
    interpolateSpectrum,
};

try {
    if (typeof window !== 'undefined') window.Heartbeat = Heartbeat;
} catch (_) {}
