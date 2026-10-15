/* ============================================================================
   tuckin.js — Night Hook v2 ("Tuck-In")
   One 15-second closing ritual: peak-end receipt, brain-dump offload,
   sealed first move with glance gating, and overnight Dawn Capsule payoff.

   Data model:
     - jeemax_tuckin_v1   : current active tuck-in state & capsule
     - jeemax_tuckin_stats: night history and capsule logs

   Design & rules: docs / night_hook_v2_plan.md
   ============================================================================ */

import { idbGet, idbSet, todayLocalKey, SessionFocus } from './storage.js';
import { getBridgeDay } from './bridge.js';

const STATE_KEY = 'jeemax_tuckin_v1';
const STATS_KEY = 'jeemax_tuckin_stats';

let _deps = {
    getDirectiveState: () => null,
    getFocusLedger: () => ({ done: 0, chain: 0, deep: 0 }),
    getStreak: () => 0,
    getBank: () => [],
    stageBridge: null,
    pickBridgeQuestion: null,
    glanceBridge: null,
    setBridgeFirstMove: null,
    setBridgeStuckAt: null,
    getLiveBridge: null,
    toast: null,
    sound: null,
    haptic: null,
    isleEvent: null,
    focusSound: null,
};

let _state = null;
let _stats = null;
let _initPromise = null;
let _rainTimer = null;
let _pendingSeeds = 0;

async function _load() {
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
        try {
            const [s, st] = await Promise.all([idbGet(STATE_KEY), idbGet(STATS_KEY)]);
            _state = s && typeof s === 'object' ? s : {
                sealedAt: null,
                sealedBday: null,
                lastActivityAfterSealAt: null,
                mindNote: '',
                sound: false,
                capsule: { state: 'none', seeds: 0, hot: false, gapHours: null },
            };
            if (!_state.capsule) _state.capsule = { state: 'none', seeds: 0, hot: false, gapHours: null };

            _stats = st && typeof st === 'object' ? st : { days: {} };
            if (!_stats.days) _stats.days = {};

            _pendingSeeds = Number(_state.pendingSeeds) || 0;
        } catch (e) {
            console.error('tuckin.js load fault', e);
        }
    })();
    return _initPromise;
}

async function _save() {
    try {
        if (_state) _state.pendingSeeds = _pendingSeeds;
        await Promise.all([
            idbSet(STATE_KEY, _state),
            idbSet(STATS_KEY, _stats),
        ]);
    } catch (e) {
        console.error('tuckin.js save fault', e);
    }
}

/** Check if current local time is within the Tuck-In window (19:00 - 04:59) */
export function isTuckInHour(now = new Date()) {
    const h = now.getHours();
    return h >= 19 || h < 5;
}

/** Check if already sealed for the current bridge day */
export function isSealedToday() {
    if (!_state || !_state.sealedAt) return false;
    return _state.sealedBday === getBridgeDay() && _state.capsule && _state.capsule.state === 'sealed';
}

/**
 * Log activity after seal. If the user studies after tucking in,
 * Pip wakes up and the capsule is voided without penalty.
 */
async function onActivity() {
    await _load();
    if (isSealedToday() && !_state.lastActivityAfterSealAt) {
        _state.lastActivityAfterSealAt = Date.now();
        if (_state.capsule) _state.capsule.state = 'void';
        await _save();

        if (typeof _deps.isleEvent === 'function') {
            try { _deps.isleEvent('wake'); } catch (_) {}
        }
        if (typeof _deps.toast === 'function') {
            _deps.toast('Pip woke up 🥱 — capsule stays closed tonight.');
        }
        renderDoor();
    }
}

/**
 * Flush any seeds that failed to deliver earlier because Sprout Isle wasn't mounted
 */
function flushPendingSeeds() {
    if (_pendingSeeds > 0 && typeof _deps.isleEvent === 'function') {
        const ok = _deps.isleEvent('seedsEarned', { n: _pendingSeeds, reason: 'dawn capsule' });
        if (ok) {
            _pendingSeeds = 0;
            _save();
        }
    }
}

/**
 * Deliver Dawn Capsule payload to morning bridge card.
 * Gated by: sealed that night, no activity after seal, gap >= 6 hours.
 */
function getDawnLine() {
    if (!_state || !_state.sealedAt) return '';
    const currentBday = getBridgeDay();
    if (_state.sealedBday === currentBday) return ''; // still the same night

    // Already processed or void
    if (_state.capsule.state === 'opened') {
        return _state.capsule.summaryLine || '';
    }

    if (_state.capsule.state !== 'sealed' || _state.lastActivityAfterSealAt) {
        return '';
    }

    const gapMs = Date.now() - _state.sealedAt;
    const gapHours = gapMs / 3600e3;

    if (gapHours < 6) {
        _state.capsule.state = 'void';
        _save();
        return '🌙 Short night. No capsule, no penalty. Take it easy today.';
    }

    // Award capsule!
    let seeds = 2;
    if (gapHours >= 7) seeds += 1;

    const roll = Math.random();
    let hot = false;
    if (roll < 0.22) {
        hot = true; // 22% hot start
    } else if (roll > 0.92) {
        seeds *= 2; // 8% double seeds
    }

    _state.capsule.state = 'opened';
    _state.capsule.seeds = seeds;
    _state.capsule.hot = hot;
    _state.capsule.gapHours = Math.round(gapHours * 10) / 10;

    // Apply hot start to live bridge if applicable
    if (hot && window.Bridge && window.Bridge.getLiveBridge) {
        const lb = window.Bridge.getLiveBridge();
        if (lb) lb.bonusMul = 1.5;
    }

    // Deliver seeds to Sprout Isle
    let delivered = false;
    if (typeof _deps.isleEvent === 'function') {
        delivered = !!_deps.isleEvent('seedsEarned', { n: seeds, reason: 'dawn capsule' });
    }
    if (!delivered) {
        _pendingSeeds += seeds;
    }

    const h = Math.floor(gapHours);
    const m = Math.round((gapHours % 1) * 60);
    const mindNoteText = _state.mindNote ? `You parked: "${_state.mindNote}" → it kept.` : '';
    const summary = `☀️ Pip slept well · ${h}h ${m}m<br>+${seeds} 🌰 ${hot ? '· 🔥 Hot start (solve pays ×1.5 LU)' : ''}${mindNoteText ? `<br><small>${mindNoteText}</small>` : ''}`;
    
    _state.capsule.summaryLine = summary;
    _save();

    return summary;
}

/** Open the Tuck-In ritual modal */
async function open(opts = {}) {
    await _load();
    flushPendingSeeds();

    if (document.getElementById('tuckin-overlay')) return;

    // Resolve live bridge question
    let bridgeQ = null;
    let isAbandoned = false;
    let isUnseen = false;
    let liveBridge = window.Bridge && window.Bridge.getLiveBridge ? window.Bridge.getLiveBridge() : null;

    if (liveBridge && liveBridge.questionId) {
        const bank = _deps.getBank ? _deps.getBank() : [];
        bridgeQ = bank.find(q => q && String(q.id) === String(liveBridge.questionId));
        if (liveBridge.kind === 'abandoned') isAbandoned = true;
        if (liveBridge.kind === 'auto' && !liveBridge.previewedAt) isUnseen = true;
    }

    if (!bridgeQ) {
        bridgeQ = _deps.pickBridgeQuestion ? _deps.pickBridgeQuestion() : null;
        isUnseen = true;
    }

    // Prepare closing receipt data
    const dirState = _deps.getDirectiveState ? _deps.getDirectiveState() : null;
    const ledger = _deps.getFocusLedger ? _deps.getFocusLedger() : { done: 0, chain: 0, deep: 0 };
    const streak = _deps.getStreak ? _deps.getStreak() : 0;

    let totalSolved = 0;
    let accRate = null;
    let beats = 0;
    if (dirState) {
        totalSolved = Object.values(dirState.lu || {}).reduce((a, b) => a + b, 0);
        if (dirState.accuracy && dirState.accuracy.total > 0) {
            accRate = Math.round((dirState.accuracy.correct / dirState.accuracy.total) * 100);
        }
        beats = dirState.beats || 0;
    }

    const overlay = document.createElement('div');
    overlay.id = 'tuckin-overlay';
    overlay.className = 'modal-overlay tuckin-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Tuck in the day');

    const subject = bridgeQ ? (bridgeQ.subject || 'physics').toUpperCase() : 'PHYSICS';
    const chapter = bridgeQ ? (bridgeQ.chapter || 'Warm start') : 'Warm start';

    overlay.innerHTML = `
        <div class="tuckin-card" id="tuckin-card">
            <button class="tuckin-close-btn" id="tuckin-close" aria-label="Close">✕</button>
            <div class="tuckin-head">
                <span class="tuckin-moon">🌙</span>
                <h2 class="tuckin-title">Tuck in the day</h2>
            </div>

            <!-- Beat 1: Peak-end closing receipt -->
            <div class="tuckin-receipt">
                <div class="tuckin-receipt-row">
                    <span class="tuckin-receipt-label">Today's grind</span>
                    <span class="tuckin-receipt-val">${Math.round(totalSolved)} LU ${accRate != null ? `· ${accRate}% acc` : ''} · 🔥 ${streak}d</span>
                </div>
                <div class="tuckin-receipt-sub">
                    ${ledger.done > 0 ? `${ledger.done} deep block${ledger.done > 1 ? 's' : ''}` : 'Daily progress banked'}
                    ${beats > 0 ? ` · ${beats} beat target time` : ''}
                </div>
            </div>

            <!-- Beat 2: Still on your mind? (Offload note) -->
            <div class="tuckin-section">
                <label class="tuckin-label" for="tuckin-mind-note">Still on your mind? <span class="tuckin-muted">(offload it so it keeps)</span></label>
                <input type="text" id="tuckin-mind-note" class="tuckin-input" placeholder="e.g. did I revise optics formulas?" maxlength="120" value="${_state.mindNote || ''}">
            </div>

            <!-- Beat 2b: Tomorrow's first move -->
            <div class="tuckin-section">
                <div class="tuckin-bridge-header">
                    <span class="tuckin-label">Tomorrow's first move 🔒</span>
                    <button type="button" class="tuckin-swap-btn" id="tuckin-swap-btn">swap</button>
                </div>
                <div class="tuckin-bridge-box">
                    <div class="tuckin-bridge-topic"><b>${subject}</b> · ${chapter} · ~3 min</div>
                    <div id="tuckin-stem-preview" class="tuckin-stem-preview" ${isAbandoned ? '' : 'hidden'}></div>

                    ${isUnseen ? `
                        <div id="tuckin-glance-wrap" class="tuckin-glance-wrap">
                            <button type="button" class="btn btn-secondary btn-sm" id="tuckin-glance-btn">👁 Glance at it (20s)</button>
                        </div>
                    ` : ''}

                    <div id="tuckin-chips-wrap" class="tuckin-chips-wrap" ${isUnseen ? 'hidden' : ''}>
                        <div class="tuckin-chip-label">${isAbandoned ? 'Where did I stop?' : 'Choose your first move:'}</div>
                        <div class="tuckin-chips-list" id="tuckin-chips-list">
                            <!-- Injected chips -->
                        </div>
                    </div>
                </div>
            </div>

            <!-- Rain while sleeping toggle -->
            <div class="tuckin-rain-row">
                <label class="tuckin-checkbox-label">
                    <input type="checkbox" id="tuckin-rain-check" ${_state.sound ? 'checked' : ''}>
                    <span>Play soothing rain while I fall asleep (20m fade)</span>
                </label>
            </div>

            <!-- Beat 3: Hold to seal -->
            <div class="tuckin-seal-wrap">
                <div class="tuckin-seal-btn" id="tuckin-seal-btn" tabindex="0" role="button" aria-label="Hold to seal the day">
                    <svg class="tuckin-seal-svg" viewBox="0 0 100 100">
                        <circle class="tuckin-seal-bg" cx="50" cy="50" r="42"></circle>
                        <circle class="tuckin-seal-prog" id="tuckin-seal-prog" cx="50" cy="50" r="42"></circle>
                    </svg>
                    <div class="tuckin-seal-content">
                        <span class="tuckin-seal-icon">🔒</span>
                        <span class="tuckin-seal-text" id="tuckin-seal-text">Hold to seal</span>
                    </div>
                </div>
                <span class="tuckin-seal-hint">or press Enter to seal</span>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Populate chips based on mode
    const chipsList = overlay.querySelector('#tuckin-chips-list');
    let selectedFirstMove = liveBridge ? liveBridge.firstMove : '';
    let selectedStuckAt = liveBridge ? liveBridge.stuckAt : null;

    function renderChips() {
        chipsList.innerHTML = '';
        if (isAbandoned) {
            const stuckOpts = [
                { id: 'setup', label: 'at the setup' },
                { id: 'algebra', label: 'mid-algebra' },
                { id: 'last-step', label: 'one step from the end' },
                { id: 'idea', label: 'missing the core idea' },
            ];
            stuckOpts.forEach(opt => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'tuckin-chip ' + (selectedStuckAt === opt.id ? 'active' : '');
                b.textContent = opt.label;
                b.addEventListener('click', () => {
                    selectedStuckAt = opt.id;
                    renderChips();
                });
                chipsList.appendChild(b);
            });
        } else {
            // Process chips (neutral approach prompts)
            const chips = [
                'Read it & draw picture',
                'List knowns / unknowns',
                'Check units & limits',
            ];
            if (subject.toLowerCase() === 'physics') chips.push('Pick the conservation law');
            else if (subject.toLowerCase() === 'chemistry') chips.push('Name the reaction type');
            else chips.push('Simplify before expanding');

            chips.forEach(c => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'tuckin-chip ' + (selectedFirstMove === c ? 'active' : '');
                b.textContent = c;
                b.addEventListener('click', () => {
                    selectedFirstMove = c;
                    renderChips();
                });
                chipsList.appendChild(b);
            });
        }
    }

    renderChips();

    // Glance button
    const glanceBtn = overlay.querySelector('#tuckin-glance-btn');
    if (glanceBtn) {
        glanceBtn.addEventListener('click', async () => {
            glanceBtn.disabled = true;
            glanceBtn.textContent = '…';
            let res = null;
            if (window.Bridge && typeof window.Bridge.glance === 'function') {
                res = await window.Bridge.glance();
            }
            const stemEl = overlay.querySelector('#tuckin-stem-preview');
            stemEl.hidden = false;
            stemEl.textContent = res && res.text ? `"${res.text}"` : 'Question ready.';
            overlay.querySelector('#tuckin-glance-wrap').hidden = true;
            overlay.querySelector('#tuckin-chips-wrap').hidden = false;
            isUnseen = false;
            renderChips();
        });
    }

    // Swap button
    overlay.querySelector('#tuckin-swap-btn').addEventListener('click', async () => {
        if (window.Bridge && typeof window.Bridge.pickQuestion === 'function') {
            const nextQ = window.Bridge.pickQuestion();
            if (nextQ) {
                bridgeQ = nextQ;
                isAbandoned = false;
                isUnseen = true;
                overlay.querySelector('.tuckin-bridge-topic').innerHTML = `<b>${(nextQ.subject || 'physics').toUpperCase()}</b> · ${nextQ.chapter} · ~3 min`;
                overlay.querySelector('#tuckin-stem-preview').hidden = true;
                const gw = overlay.querySelector('#tuckin-glance-wrap');
                if (gw) gw.hidden = false;
                overlay.querySelector('#tuckin-chips-wrap').hidden = true;
            }
        }
    });

    // Close button
    overlay.querySelector('#tuckin-close').addEventListener('click', () => {
        overlay.remove();
    });

    // ── Hold to seal mechanics ──
    const sealBtn = overlay.querySelector('#tuckin-seal-btn');
    const progCircle = overlay.querySelector('#tuckin-seal-prog');
    const sealText = overlay.querySelector('#tuckin-seal-text');
    let holdTimer = null;
    let holdStart = 0;
    const HOLD_MS = 1200;

    const CIRCUMFERENCE = 2 * Math.PI * 42; // r=42 -> ~263.89
    progCircle.style.strokeDasharray = `${CIRCUMFERENCE} ${CIRCUMFERENCE}`;
    progCircle.style.strokeDashoffset = `${CIRCUMFERENCE}`;

    function startHold() {
        if (holdTimer) return;
        holdStart = Date.now();
        sealBtn.classList.add('holding');
        sealText.textContent = 'Hold…';
        holdTimer = setInterval(() => {
            const elapsed = Date.now() - holdStart;
            const pct = Math.min(1, elapsed / HOLD_MS);
            progCircle.style.strokeDashoffset = `${CIRCUMFERENCE * (1 - pct)}`;
            if (pct >= 1) {
                clearInterval(holdTimer);
                holdTimer = null;
                finishSeal();
            }
        }, 30);
    }

    function cancelHold() {
        if (!holdTimer) return;
        clearInterval(holdTimer);
        holdTimer = null;
        sealBtn.classList.remove('holding');
        sealText.textContent = 'Hold to seal';
        progCircle.style.strokeDashoffset = `${CIRCUMFERENCE}`;
    }

    sealBtn.addEventListener('mousedown', startHold);
    sealBtn.addEventListener('mouseup', cancelHold);
    sealBtn.addEventListener('mouseleave', cancelHold);
    sealBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startHold(); });
    sealBtn.addEventListener('touchend', cancelHold);

    // Keyboard support: Enter seals immediately
    function onKeyDown(e) {
        if (e.key === 'Enter') {
            document.removeEventListener('keydown', onKeyDown);
            finishSeal();
        } else if (e.key === 'Escape') {
            document.removeEventListener('keydown', onKeyDown);
            overlay.remove();
        }
    }
    document.addEventListener('keydown', onKeyDown);

    // Check prefers-reduced-motion: single click seals
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        sealBtn.addEventListener('click', () => finishSeal());
    }

    async function finishSeal() {
        document.removeEventListener('keydown', onKeyDown);
        sealBtn.classList.add('sealed');
        sealText.textContent = 'Sealed ✓';

        const mindNote = overlay.querySelector('#tuckin-mind-note').value.trim();
        const rainChecked = overlay.querySelector('#tuckin-rain-check').checked;

        // Stage bridge as explicit
        if (window.Bridge && typeof window.Bridge.stage === 'function' && bridgeQ) {
            await window.Bridge.stage({
                kind: isAbandoned ? 'abandoned' : 'parked',
                question: bridgeQ,
                explicit: true,
                mindNote,
                firstMove: selectedFirstMove,
                stuckAt: selectedStuckAt,
            });
        }

        // Save tuck-in state
        _state.sealedAt = Date.now();
        _state.sealedBday = getBridgeDay();
        _state.lastActivityAfterSealAt = null;
        _state.mindNote = mindNote;
        _state.sound = rainChecked;
        _state.capsule = { state: 'sealed', seeds: 0, hot: false, gapHours: null };
        await _save();

        // FX feedback
        if (_deps.sound) _deps.sound('confirm');
        if (_deps.haptic) _deps.haptic([15, 30, 40]);

        // Sprout Isle: Pip sleeps
        if (typeof _deps.isleEvent === 'function') {
            try { _deps.isleEvent('tuckIn'); } catch (_) {}
        }

        // Rain playback
        if (rainChecked && _deps.focusSound) {
            try {
                _deps.focusSound.select('rain');
                _deps.focusSound.start();
                if (_rainTimer) clearTimeout(_rainTimer);
                _rainTimer = setTimeout(() => {
                    try { _deps.focusSound.pause(); } catch (_) {}
                    _rainTimer = null;
                }, 20 * 60 * 1000);
            } catch (_) {}
        }

        // Show Goodnight scene
        _showGoodnightScreen(overlay);
        renderDoor();
    }
}

/** 2D Goodnight screen inside overlay */
function _showGoodnightScreen(overlay) {
    const card = overlay.querySelector('#tuckin-card');
    if (!card) return;

    card.className = 'tuckin-card tuckin-goodnight-card';
    card.innerHTML = `
        <div class="tuckin-goodnight-body">
            <div class="tuckin-sky-scene" id="tuckin-sky-scene">
                <div class="tuckin-star s1">✦</div>
                <div class="tuckin-star s2">✧</div>
                <div class="tuckin-star s3">✦</div>
                <div class="tuckin-moon-big">🌙</div>
                <div class="tuckin-pip-sleep">😴 🌿</div>
            </div>
            <h2 class="tuckin-gn-title">Sleep well.</h2>
            <p class="tuckin-gn-desc">Tomorrow's first move is locked in.<br>Your capsule will be ready at dawn.</p>
            <button class="btn btn-primary" id="tuckin-gn-done">Goodnight</button>
        </div>
    `;

    // Stop animations after 60s to conserve battery
    setTimeout(() => {
        const scene = card.querySelector('#tuckin-sky-scene');
        if (scene) scene.classList.add('paused');
    }, 60000);

    card.querySelector('#tuckin-gn-done').addEventListener('click', () => {
        overlay.remove();
    });
}

/** Render Door 1 banner in #tuckin-door-banner */
async function renderDoor() {
    await _load();
    const el = document.getElementById('tuckin-door-banner');
    if (!el) return;

    if (!isTuckInHour() || isSealedToday() || (SessionFocus && SessionFocus.isBusy())) {
        el.hidden = true;
        el.innerHTML = '';
        return;
    }

    const currentHour = new Date().getHours();
    // Door 1 activates at >= 21:30 or if late
    if (currentHour < 21 && currentHour >= 5) {
        el.hidden = true;
        return;
    }

    el.hidden = false;
    el.className = 'tuckin-door-banner';
    el.innerHTML = `
        <div class="tuckin-door-content">
            <span class="tuckin-door-icon">🌙</span>
            <span class="tuckin-door-text"><b>Tuck in the day</b> · Seal tomorrow's first move & dawn capsule</span>
        </div>
        <button class="btn btn-primary btn-sm tuckin-door-btn" onclick="window.TuckIn.open({source:'door1'})">Seal day →</button>
    `;
}

// ── Public Surface ──────────────────────────────────────────────────────────
export const TuckIn = {
    configure(deps) { _deps = Object.assign(_deps, deps); },
    load: _load,
    open,
    close: () => { const o = document.getElementById('tuckin-modal'); if (o) o.remove(); },
    onActivity,
    getDawnLine,
    renderDoor,
    isSealedToday,
    flushPendingSeeds,
    getState: () => _state,
    getStats: () => _stats,
};

window.TuckIn = TuckIn;
