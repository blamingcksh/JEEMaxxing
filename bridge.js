/* ============================================================================
   bridge.js — Hemingway Bridge (zero-friction next-day re-entry)
   Stages tomorrow's first move at session close and surfaces a single-tap
   pickup right after the morning reset.

   Data model:
     - jeemax_bridge_v1   : current active bridge record
     - jeemax_bridge_stats: history, streaks, and ttfs (time-to-first-solve)

   Design & rules: docs / hemingway_bridge_plan.md & night_hook_v2_plan.md
   ============================================================================ */

import { idbGet, idbSet, todayLocalKey } from './storage.js';

const STATE_KEY = 'jeemax_bridge_v1';
const STATS_KEY = 'jeemax_bridge_stats';
const BDAY_CUTOFF_H = 5; // 05:00 AM cutoff for bridge day

/** Local bridge-day key (e.g. 02:00 on Oct 16 is credited to Oct 15) */
export function getBridgeDay(ts = Date.now()) {
    const d = new Date(ts - BDAY_CUTOFF_H * 3600e3);
    return todayLocalKey(d);
}

/** Cross-eligible only when the bridge-day has turned AND >= 4h have passed */
export function isCrossEligible(b, now = Date.now()) {
    if (!b || !b.stagedAt) return false;
    const currentBday = getBridgeDay(now);
    return b.stagedBday !== currentBday && (now - b.stagedAt >= 4 * 3600e3);
}

// ── Dependency injection registry ──────────────────────────────────────────
let _deps = {
    getBank: () => [],
    getElo: () => 1200,
    bountyQid: () => null,
    isBountyMode: () => false,
    isMockQuestion: () => false,
    isMockDay: () => false,
    isDeloadToday: () => false,
    maxCns: () => 0,
    headlineChapter: () => null,
    startPractice: null,
    toast: null,
};

let _liveBridge = null;
let _stats = null;
let _initPromise = null;

async function _load() {
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
        try {
            const [b, s] = await Promise.all([idbGet(STATE_KEY), idbGet(STATS_KEY)]);
            _liveBridge = b && typeof b === 'object' ? b : null;
            _stats = s && typeof s === 'object' ? s : {
                streak: 0,
                best: 0,
                staged: 0,
                crossed: 0,
                expired: 0,
                days: {}, // keyed by bday -> { t0, firstUnitAt, presented, crossed, kind, ttfsSecs }
            };
            if (!_stats.days) _stats.days = {};
        } catch (e) {
            console.error('bridge.js load fault', e);
        }
    })();
    return _initPromise;
}

async function _save() {
    try {
        await Promise.all([
            idbSet(STATE_KEY, _liveBridge),
            idbSet(STATS_KEY, _stats),
        ]);
    } catch (e) {
        console.error('bridge.js save fault', e);
    }
}

function _chaptersMatch(a, b) {
    if (!a || !b) return false;
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * Auto-select a warm, high-confidence question for tomorrow's first move.
 * Target: P(win) ~ 0.80 (Flow band, qElo ≈ userElo - 240).
 * If CNS >= 0.80 (Lifeline level): qElo ≈ userElo - 330.
 */
function pickQuestion(preferredSubjectOrOpts = null) {
    let preferredSubject = null;
    let excludeQids = [];
    if (typeof preferredSubjectOrOpts === 'string') {
        preferredSubject = preferredSubjectOrOpts;
    } else if (preferredSubjectOrOpts && typeof preferredSubjectOrOpts === 'object') {
        preferredSubject = preferredSubjectOrOpts.preferredSubject || null;
        if (Array.isArray(preferredSubjectOrOpts.excludeQids)) {
            excludeQids = preferredSubjectOrOpts.excludeQids.map(id => String(id));
        } else if (preferredSubjectOrOpts.excludeQid != null) {
            excludeQids = [String(preferredSubjectOrOpts.excludeQid)];
        }
    }
    const bank = _deps.getBank() || [];
    if (!bank.length) return null;

    const bQid = _deps.bountyQid ? _deps.bountyQid() : null;
    const isMock = _deps.isMockQuestion || (() => false);
    const hlChapter = _deps.headlineChapter && _deps.headlineChapter();
    const cns = _deps.maxCns ? _deps.maxCns() : 0;
    const deltaTarget = cns >= 0.80 ? 330 : 240;

    // Filter valid candidate pool
    const candidates = bank.filter(q => {
        if (!q || q.id == null) return false;
        if (excludeQids.includes(String(q.id))) return false;
        if (preferredSubject && q.subject && q.subject.toLowerCase() !== preferredSubject.toLowerCase()) return false;
        if (bQid && q.id === bQid) return false; // never cannibalise bounty boss
        if (q.isMock || isMock(q)) return false;     // never mock papers
        if (q.status === 'solved' || q.firstAttemptResult === 'correct') return false; // unsolved
        if (q.errorReason || q.status === 'error' || q.status === 'wrong') return false; // vault items excluded
        return true;
    });

    if (!candidates.length) return null;

    // Prefer headline chapter if present
    let pool = candidates;
    if (hlChapter) {
        const hlPool = candidates.filter(q => _chaptersMatch(q.chapter, hlChapter));
        if (hlPool.length) pool = hlPool;
    }

    // Score closest to target qElo per question subject
    let bestQ = null;
    let minDiff = Infinity;

    for (const q of pool) {
        const uElo = Number(_deps.getElo(q.subject)) || 1200;
        const targetQElo = Math.max(800, uElo - deltaTarget);
        const actualQElo = Number(q.qElo) || 1200;
        const diff = Math.abs(actualQElo - targetQElo);
        if (diff < minDiff) {
            minDiff = diff;
            bestQ = q;
        }
    }

    return bestQ || pool[0];
}

/**
 * Stage a question as the bridge.
 * Replace rules:
 *   - Explicit park/seal ALWAYS wins and overwrites.
 *   - Abandoned NEVER overwrites an explicit bridge or its note.
 *   - Abandoned overwrites abandoned, auto, expired, or consumed.
 *   - Auto only fills an empty, expired, or consumed slot.
 */
async function stage(opts = {}) {
    await _load();

    // Guardrails: no staging on Deload days or Mock days
    if (_deps.isDeloadToday && _deps.isDeloadToday()) return null;
    if (_deps.isMockDay && _deps.isMockDay()) return null;

    const kind = opts.kind || 'auto';
    const isExplicit = !!opts.explicit || kind === 'parked';

    // Abandoned floor check
    if (kind === 'abandoned' && (Number(opts.elapsedSecs) || 0) < 20) {
        return null;
    }

    // Resolve question
    let q = opts.question;
    if (!q || !q.id) {
        q = pickQuestion();
    }
    if (!q || !q.id) return null;

    // Check existing live bridge
    if (!opts.force && _liveBridge && !_liveBridge.crossedAt && Date.now() < (_liveBridge.expiresAt || Infinity)) {
        if (!isExplicit) {
            // New is passive (abandoned or auto)
            if (_liveBridge.explicit) {
                // Preserves user's intentional park and note!
                return _liveBridge;
            }
            if (kind === 'auto') {
                // Auto never overwrites an existing live uncrossed bridge
                return _liveBridge;
            }
        }
    }

    const currentBday = getBridgeDay();
    _liveBridge = {
        id: 'br_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        kind,
        explicit: isExplicit,
        morningWarmStart: !!opts.morningWarmStart,
        questionId: q.id,
        subject: q.subject || 'physics',
        chapter: q.chapter || 'General',
        qElo: Number(q.qElo) || 1200,
        elapsedSecs: Math.max(0, Number(opts.elapsedSecs) || 0),
        previewedAt: kind === 'abandoned' ? Date.now() : (opts.previewedAt || null),
        stuckAt: opts.stuckAt || null,
        firstMove: (opts.firstMove || opts.note || '').slice(0, 80),
        mindNote: (opts.mindNote || '').slice(0, 120),
        stagedAt: Date.now(),
        stagedBday: currentBday,
        expiresAt: Date.now() + 48 * 3600e3,
        presentedBday: null,
        openedAt: null,
        crossedAt: null,
        bonusBday: null,
        bonusMul: opts.bonusMul || 1.25,
    };

    _stats.staged = (_stats.staged || 0) + 1;
    await _save();
    renderBanner();

    if (opts.toast !== false && _deps.toast && kind === 'abandoned') {
        _deps.toast('🌉 Unfinished question parked as tomorrow’s bridge.');
    }

    return _liveBridge;
}

/**
 * Glance at an auto-picked question stem before sealing.
 * Marks previewedAt so process chips unlock (seen-before-you-set rule).
 * If qOverride is provided, stages/glances that specific question.
 */
async function glance(qOverride = null) {
    await _load();
    if (qOverride && qOverride.id) {
        if (!_liveBridge) {
            _liveBridge = {
                id: 'br_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                kind: 'auto',
                explicit: false,
                questionId: qOverride.id,
                subject: qOverride.subject || 'physics',
                chapter: qOverride.chapter || 'General',
                qElo: Number(qOverride.qElo) || 1200,
                elapsedSecs: 0,
                previewedAt: Date.now(),
                stuckAt: null,
                firstMove: '',
                mindNote: '',
                stagedAt: Date.now(),
                stagedBday: getBridgeDay(),
                expiresAt: Date.now() + 48 * 3600e3,
                presentedBday: null,
                openedAt: null,
                crossedAt: null,
                bonusBday: null,
                bonusMul: 1.25,
            };
        } else {
            _liveBridge.questionId = qOverride.id;
            _liveBridge.subject = qOverride.subject || _liveBridge.subject;
            _liveBridge.chapter = qOverride.chapter || _liveBridge.chapter;
            _liveBridge.qElo = Number(qOverride.qElo) || _liveBridge.qElo;
            _liveBridge.previewedAt = Date.now();
        }
        await _save();
        const rawText = String(qOverride.text || qOverride.questionText || '').trim();
        const snippet = rawText.length > 120 ? rawText.slice(0, 117) + '…' : rawText;
        return {
            text: snippet || 'Question diagram / content ready.',
            hasDiagram: !!(qOverride.diagramImage || qOverride.image),
        };
    }

    if (!_liveBridge) return null;
    _liveBridge.previewedAt = Date.now();
    await _save();

    const bank = _deps.getBank() || [];
    const q = bank.find(item => item && String(item.id) === String(_liveBridge.questionId));
    if (!q) return { text: 'Question ready.' };

    const rawText = String(q.text || q.questionText || '').trim();
    const snippet = rawText.length > 120 ? rawText.slice(0, 117) + '…' : rawText;
    return {
        text: snippet || 'Question diagram / content ready.',
        hasDiagram: !!(q.diagramImage || q.image),
    };
}

/**
 * Set the first move (note or chip). Rejects if question was never seen.
 */
async function setFirstMove(textOrChip) {
    await _load();
    if (!_liveBridge) return { ok: false, reason: 'no_bridge' };

    // Seen-before-you-set rule: unseen auto-pick cannot set strategy chips
    if (_liveBridge.kind === 'auto' && !_liveBridge.previewedAt) {
        return { ok: false, reason: 'unseen' };
    }

    _liveBridge.firstMove = String(textOrChip || '').slice(0, 80);
    await _save();
    return { ok: true };
}

/** Set stuck-at checkpoint for abandoned questions */
async function setStuckAt(stuckAtVal) {
    await _load();
    if (!_liveBridge) return;
    _liveBridge.stuckAt = stuckAtVal;
    await _save();
}

/** Expire stale bridges (>48h) and cool streak without penalty */
async function expireStale() {
    await _load();
    if (!_liveBridge) return;
    if (Date.now() > _liveBridge.expiresAt) {
        if (!_liveBridge.crossedAt) {
            _stats.streak = 0; // streak cools, zero Elo/contract damage
            _stats.expired = (_stats.expired || 0) + 1;
        }
        _liveBridge = null;
        await _save();
        renderBanner();
    }
}

/** Pick up the bridge and launch into practice */
async function pickUp() {
    await _load();
    if (!_liveBridge) return;

    const bank = _deps.getBank() || [];
    const q = bank.find(item => item && String(item.id) === String(_liveBridge.questionId));
    if (!q) {
        if (_deps.toast) _deps.toast('Question no longer in bank; re-picking bridge…');
        _liveBridge = null;
        await stage({ kind: 'auto' });
        renderBanner();
        return;
    }

    _liveBridge.openedAt = Date.now();
    await _save();

    // Dismiss pickup modal if active
    const modal = document.getElementById('bridge-pickup-modal');
    if (modal) modal.remove();

    // Display-only offset: modal timer shows elapsedSecs, Elo speed terms start fresh
    if (typeof _deps.startPractice === 'function') {
        _deps.startPractice([q], 0, { displayOffsetSecs: _liveBridge.elapsedSecs || 0 });
    }
}

/**
 * Hooked in _directiveMarkSolve. Detects if solve crosses an active bridge.
 * Returns { bonus: boolean, bridgeMul: number }
 */
function onSubmit(q) {
    if (!_liveBridge || !q || String(_liveBridge.questionId) !== String(q.id)) {
        return { bonus: false };
    }

    const currentBday = getBridgeDay();
    const eligible = isCrossEligible(_liveBridge);

    if (eligible && _liveBridge.bonusBday !== currentBday) {
        _liveBridge.crossedAt = Date.now();
        _liveBridge.bonusBday = currentBday;

        // Record streak
        _stats.streak = (_stats.streak || 0) + 1;
        _stats.best = Math.max(_stats.best || 0, _stats.streak);
        _stats.crossed = (_stats.crossed || 0) + 1;

        const dayEntry = _stats.days[currentBday] || {};
        dayEntry.crossed = true;
        dayEntry.kind = _liveBridge.kind;
        _stats.days[currentBday] = dayEntry;

        _save();
        renderBanner();

        if (_deps.toast) {
            const mul = _liveBridge.bonusMul || 1.25;
            _deps.toast(`🌉 Bridge crossed! +${Math.round((mul - 1) * 100)}% Load Units.`);
        }

        return { bonus: true, bridgeMul: _liveBridge.bonusMul || 1.25 };
    }

    // Same-day solve of an abandoned bridge: silently resolves the unfinished state
    if (!eligible && _liveBridge.kind === 'abandoned') {
        _liveBridge = null;
        _save();
        renderBanner();
    }

    return { bonus: false };
}

/** Called on any solve or fix unit to measure ttfs (time-to-first-solve) */
function onUnit() {
    if (!_stats) return;
    const currentBday = getBridgeDay();
    const dayEntry = _stats.days[currentBday] || {};
    if (!dayEntry.firstUnitAt && dayEntry.t0) {
        dayEntry.firstUnitAt = Date.now();
        const diffSecs = Math.max(1, Math.round((dayEntry.firstUnitAt - dayEntry.t0) / 1000));
        if (diffSecs <= 7200) { // cap at 2h to avoid idle day skew
            dayEntry.ttfsSecs = diffSecs;
        }
        _stats.days[currentBday] = dayEntry;
        _save();
    }
}

/**
 * Present the morning pickup card.
 * Gated by: crossEligible AND not yet presented today.
 */
async function present() {
    await _load();
    if (!_liveBridge) return;
    if (!isCrossEligible(_liveBridge)) return;

    const currentBday = getBridgeDay();
    if (_liveBridge.presentedBday === currentBday) return;

    _liveBridge.presentedBday = currentBday;
    if (!_stats.days[currentBday]) _stats.days[currentBday] = {};
    _stats.days[currentBday].presented = true;
    if (!_stats.days[currentBday].t0) _stats.days[currentBday].t0 = Date.now();
    await _save();

    _renderPickupCard();
}

/** Render modal / bottom-sheet pickup card */
function _renderPickupCard() {
    if (document.getElementById('bridge-pickup-modal')) return;

    const b = _liveBridge;
    if (!b) return;

    const modal = document.createElement('div');
    modal.id = 'bridge-pickup-modal';
    modal.className = 'modal-overlay bridge-pickup-overlay active';

    let firstMoveText = b.firstMove ? `First move: "${b.firstMove}"` : '';
    if (b.stuckAt) {
        firstMoveText = `Stopped ${b.stuckAt.replace(/-/g, ' ')} · ${firstMoveText}`;
    }

    // Check for Dawn Capsule line from TuckIn
    let dawnLine = '';
    if (window.TuckIn && typeof window.TuckIn.getDawnLine === 'function') {
        dawnLine = window.TuckIn.getDawnLine() || '';
    }

    const timeText = b.elapsedSecs > 0 ? `${Math.floor(b.elapsedSecs / 60)}:${String(b.elapsedSecs % 60).padStart(2, '0')} already in` : '~3 min';

    modal.innerHTML = `
        <div class="modal-box bridge-pickup-card">
            <span class="bridge-kicker">HEMINGWAY BRIDGE · READY</span>
            ${dawnLine ? `<div class="bridge-dawn-box">${dawnLine}</div>` : ''}
            <h2 class="bridge-title">${b.subject.toUpperCase()} · ${b.chapter}</h2>
            <div class="bridge-meta-row">
                <span class="bridge-pill">${timeText}</span>
                <span class="bridge-pill bridge-pill-bonus">×${b.bonusMul || 1.25} LU</span>
                ${_stats && _stats.streak > 0 ? `<span class="bridge-pill bridge-pill-streak">🔥 ${_stats.streak}d</span>` : ''}
            </div>
            ${firstMoveText ? `<p class="bridge-first-move">${firstMoveText}</p>` : ''}
            <div class="bridge-actions">
                <button class="btn btn-secondary" id="bridge-later-btn">Later</button>
                <button class="btn btn-primary" id="bridge-pickup-btn">Pick up →</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#bridge-pickup-btn').addEventListener('click', () => {
        pickUp();
    });
    modal.querySelector('#bridge-later-btn').addEventListener('click', () => {
        modal.remove();
    });
}

/** Render fixed dashboard banner above the bento grid */
async function renderBanner() {
    await _load();
    const el = document.getElementById('bridge-banner');
    if (!el) return;

    if (!_liveBridge || Date.now() > (_liveBridge.expiresAt || Infinity) || _liveBridge.crossedAt) {
        el.hidden = true;
        el.className = '';
        el.innerHTML = '';
        return;
    }

    const b = _liveBridge;
    const eligible = isCrossEligible(b);
    const currentHour = new Date().getHours();

    el.hidden = false;

    if (eligible || b.morningWarmStart) {
        // Cross-eligible morning banner or warm start
        el.className = 'bridge-banner bridge-banner-ready';
        const badge = eligible ? 'BRIDGE READY' : 'WARM START';
        const badgeIcon = (typeof window.__glyph === 'function') ? window.__glyph('bolt') : '';
        el.innerHTML = `
            <div class="bridge-banner-content">
                <span class="bridge-banner-badge">${badgeIcon}<span>${badge}</span></span>
                <span class="bridge-banner-text"><b>${b.subject.toUpperCase()}</b> · ${b.chapter} · ${b.firstMove ? `"${b.firstMove}"` : '~3 min'}</span>
            </div>
            <button class="btn btn-primary btn-sm bridge-banner-btn" onclick="window.Bridge.pickUp()">Pick up →</button>
        `;
    } else {
        // Same-day banner
        el.className = 'bridge-banner bridge-banner-sameday';
        if (b.kind === 'abandoned') {
            const m = Math.floor(b.elapsedSecs / 60);
            const s = b.elapsedSecs % 60;
            el.innerHTML = `
                <div class="bridge-banner-content">
                    <span class="bridge-banner-badge">⏳ UNFINISHED</span>
                    <span class="bridge-banner-text">${b.subject.toUpperCase()} · ${b.chapter} (${m}:${String(s).padStart(2, '0')} in)</span>
                </div>
                <button class="btn btn-secondary btn-sm bridge-banner-btn" onclick="window.Bridge.pickUp()">Resume</button>
            `;
        } else {
            const isLate = currentHour >= 23;
            el.innerHTML = `
                <div class="bridge-banner-content">
                    <span class="bridge-banner-badge">${isLate ? '🌙 PARKED. SLEEP.' : '🔒 PARKED FOR TOMORROW'}</span>
                    <span class="bridge-banner-text">${b.subject.toUpperCase()} · ${b.chapter} · ready at 05:00</span>
                </div>
                <div style="display:flex;gap:6px;align-items:center;">
                    <button class="btn btn-secondary btn-sm bridge-banner-btn" onclick="window.Bridge.pickUp()" title="Solve today without overnight bonus">Practice</button>
                    <button class="btn btn-secondary btn-sm bridge-banner-btn" onclick="window.TuckIn && window.TuckIn.open({ source: 'manual' })" title="Open Tuck-In">🌙 Tuck in</button>
                </div>
            `;
        }
    }
}

/** Ensure morning presentation and t0 tracking on boot */
async function ensureBootPresented() {
    await _load();
    if (!_stats) return;
    const currentBday = getBridgeDay();
    if (!_stats.days[currentBday]) _stats.days[currentBday] = {};
    if (!_stats.days[currentBday].t0) {
        _stats.days[currentBday].t0 = Date.now();
        await _save();
    }
    if (_liveBridge && isCrossEligible(_liveBridge) && _liveBridge.presentedBday !== currentBday) {
        await present();
    }
}

// ── Public Surface ──────────────────────────────────────────────────────────
export const Bridge = {
    async configure(deps) {
        if (!deps) return;
        const mapped = Object.assign({}, deps);
        if (deps.getQuestionBank && !deps.getBank) mapped.getBank = deps.getQuestionBank;
        if (deps.getCurrentElo && !deps.getElo) mapped.getElo = deps.getCurrentElo;
        if (deps.startPracticeWithQuestion && !deps.startPractice) mapped.startPractice = deps.startPracticeWithQuestion;
        _deps = Object.assign(_deps, mapped);
        await _load();
        renderBanner();
    },
    load: _load,
    stage,
    pickQuestion,
    glance,
    setFirstMove,
    setStuckAt,
    pickUp,
    pickup: pickUp,
    onSubmit,
    onUnit,
    present,
    ensureBootPresented,
    renderBanner,
    expireStale,
    isCrossEligible: (now) => isCrossEligible(_liveBridge, now),
    getLiveBridge: () => _liveBridge,
    getStats: () => _stats,
    getBridgeDay,
};

if (typeof window !== 'undefined') window.Bridge = Bridge;
