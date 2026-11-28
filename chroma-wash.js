/* ============================================================================
   chroma-wash.js — Generative Painterly Light-Plate Wash (Practice & Vault)
   ----------------------------------------------------------------------------
   Replaces Spotify album haze with 100% offline procedural painterly light-plates
   painted onto a tiny 144×144 offscreen canvas in perceptual OKLCH harmonies:
     • Four non-flat light-geometry archetypes:
         1. prism       — Diagonal refracted sunbeams / window caustics
         2. watercolor  — Organic asymmetric multi-lobe pigment clouds
         3. eclipse     — Luminous horizon crescent + diagonal counterweight
         4. aurora      — Sweeping multi-stop curved ribbon curtains
     • Dual A/B slot crossfade (6.5s melt) so colour shifts are imperceptible
       in peripheral vision and never break deep JEE Adv concentration.
     • Only mounts inside Practice (#practice-modal.pq-stage) and Vault Review
       (#sr-practice-overlay.pq-stage) + luminance-safe diagram paper buff.
     • Smoothly evolves on stage entry, every 3 questions (at natural question
       transitions), on a gentle 3.5–5.5 min timer, or on Flow Vibe switch.
   ============================================================================ */

const PREFS_KEY = 'jeemax_chroma_wash_v1';
const PLATE_SIZE = 144;
const ARCHETYPES = ['prism', 'watercolor', 'eclipse', 'aurora'];

const HARMONIES = [
    // [offsets from base hue in degrees, chroma multipliers, lightness targets]
    { name: 'split-twilight', offsets: [0, 26, 152, 206, 48],   Ls: [0.34, 0.56, 0.62, 0.44, 0.78], Cs: [0.15, 0.18, 0.17, 0.15, 0.10] },
    { name: 'temp-clash',     offsets: [0, 174, -34, 144, 24],  Ls: [0.36, 0.64, 0.54, 0.46, 0.80], Cs: [0.16, 0.18, 0.14, 0.16, 0.09] },
    { name: 'mineral-prism',  offsets: [-40, 0, 38, 84, -14],   Ls: [0.32, 0.54, 0.64, 0.58, 0.78], Cs: [0.15, 0.17, 0.16, 0.14, 0.10] },
    { name: 'stained-triad',  offsets: [0, 116, 236, 32, 168],  Ls: [0.35, 0.58, 0.52, 0.68, 0.76], Cs: [0.16, 0.16, 0.16, 0.14, 0.10] },
    { name: 'nocturne-ember', offsets: [0, 18, 162, 192, 138],  Ls: [0.28, 0.42, 0.68, 0.58, 0.78], Cs: [0.14, 0.15, 0.20, 0.17, 0.11] },
    { name: 'coastal-bloom',  offsets: [0, 44, 196, -28, 86],   Ls: [0.38, 0.62, 0.66, 0.48, 0.82], Cs: [0.14, 0.16, 0.17, 0.14, 0.09] },
];

// Gentle optional hue windows per Flow vibe (still blends 40% completely free-roaming randomness)
const VIBE_HUE_BIAS = {
    aperture: [195, 255, 32, 165],
    aether:   [230, 295, 190, 325],
    kinetic:  [150, 205, 18, 48],
    solstice: [18, 52, 338, 175],
};

// ── Perceptual OKLCH -> sRGB conversion (gamut-safe, zero muddy brown / neon bleed) ──
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const toGamma = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function oklchToLinearRgb(L, C, hDeg) {
    const rad = (hDeg * Math.PI) / 180;
    const a = C * Math.cos(rad);
    const b = C * Math.sin(rad);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    return [
        +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
}

function oklchCss(L, C, hDeg, alpha = 1) {
    let chroma = C;
    let rgb = [0, 0, 0];
    for (let i = 0; i < 16; i++) {
        rgb = oklchToLinearRgb(L, chroma, hDeg);
        if (rgb[0] >= -0.002 && rgb[0] <= 1.002 &&
            rgb[1] >= -0.002 && rgb[1] <= 1.002 &&
            rgb[2] >= -0.002 && rgb[2] <= 1.002) {
            break;
        }
        chroma *= 0.88;
    }
    const r = Math.round(toGamma(clamp(rgb[0], 0, 1)) * 255);
    const g = Math.round(toGamma(clamp(rgb[1], 0, 1)) * 255);
    const b = Math.round(toGamma(clamp(rgb[2], 0, 1)) * 255);
    return alpha >= 0.999 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

function angleDiff(a, b) {
    const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
    return d;
}

// ── State ───────────────────────────────────────────────────────────────────
function _loadEnabled() {
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(PREFS_KEY);
            if (raw !== null) {
                const p = JSON.parse(raw);
                if (p && typeof p.enabled === 'boolean') return p.enabled;
            }
        }
    } catch (_) {}
    return true;
}

function _saveEnabled(on) {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(PREFS_KEY, JSON.stringify({ enabled: Boolean(on) }));
        }
    } catch (_) {}
}

let _enabled = _loadEnabled();
let _activeSlot = 'a'; // toggles 'a' <-> 'b' for seamless 6.5s crossfade
let _lastBaseHue = -999;
let _lastArchetype = '';
let _lastHarmony = '';
let _rollCount = 0;
let _questionCounter = 0;
let _driftTimer = null;
let _canvas = null;
let _ctx = null;
let _stageActive = false;
let _lastQuestionSig = '';
let _inited = false;

function _ensureCanvas() {
    if (_canvas && _ctx) return _ctx;
    if (typeof document === 'undefined') return null;
    try {
        const c = document.createElement('canvas');
        c.width = PLATE_SIZE;
        c.height = PLATE_SIZE;
        const ctx = c.getContext('2d');
        if (!ctx) return null;
        _canvas = c;
        _ctx = ctx;
        return ctx;
    } catch (_) {
        return null;
    }
}

function _pickBaseHue(vibeId) {
    const anchors = VIBE_HUE_BIAS[vibeId];
    let hue = Math.random() * 360;
    for (let tries = 0; tries < 10; tries++) {
        if (anchors && Math.random() < 0.58) {
            const anchor = anchors[Math.floor(Math.random() * anchors.length)];
            hue = (anchor + (Math.random() - 0.5) * 64 + 360) % 360;
        } else {
            hue = Math.random() * 360;
        }
        if (_lastBaseHue < 0 || angleDiff(hue, _lastBaseHue) >= 52) break;
    }
    _lastBaseHue = hue;
    return hue;
}

function _pickArchetype() {
    const pool = ARCHETYPES.filter((a) => a !== _lastArchetype);
    const chosen = pool[Math.floor(Math.random() * pool.length)] || 'prism';
    _lastArchetype = chosen;
    return chosen;
}

function _pickPalette(vibeId) {
    const baseHue = _pickBaseHue(vibeId);
    const hPool = HARMONIES.filter((h) => h.name !== _lastHarmony);
    const harmony = hPool[Math.floor(Math.random() * hPool.length)] || HARMONIES[0];
    _lastHarmony = harmony.name;

    const jitter = (n) => (Math.random() - 0.5) * n;
    const colors = harmony.offsets.map((off, idx) => ({
        L: clamp(harmony.Ls[idx] + jitter(0.06), 0.24, 0.85),
        C: clamp(harmony.Cs[idx] + jitter(0.03), 0.08, 0.22),
        H: (baseHue + off + jitter(14) + 360) % 360,
    }));
    return { baseHue, harmony: harmony.name, colors };
}

// ── Procedural Painterly Light-Plate Renderer (<1ms offscreen canvas) ───────
function _paintLightPlate(vibeId) {
    const ctx = _ensureCanvas();
    const pal = _pickPalette(vibeId);
    const archetype = _pickArchetype();
    if (!ctx) return { url: '', archetype, harmony: pal.harmony, baseHue: pal.baseHue };

    const W = PLATE_SIZE;
    const H = PLATE_SIZE;
    const [cBase, cMain, cAccent, cCounter, cGlow] = pal.colors;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);

    // 1. Rich asymmetric base wash (diagonal atmospheric ground)
    const ang = Math.random() * Math.PI * 2;
    const gx0 = W * (0.5 - 0.65 * Math.cos(ang));
    const gy0 = H * (0.5 - 0.65 * Math.sin(ang));
    const gx1 = W * (0.5 + 0.65 * Math.cos(ang));
    const gy1 = H * (0.5 + 0.65 * Math.sin(ang));
    const bg = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    bg.addColorStop(0, oklchCss(cBase.L, cBase.C, cBase.H, 1));
    bg.addColorStop(0.55, oklchCss(cMain.L * 0.88, cMain.C, cMain.H, 1));
    bg.addColorStop(1, oklchCss(cCounter.L, cCounter.C, cCounter.H, 1));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const drawBlob = (x, y, rx, ry, rot, col, alpha, mode = 'source-over') => {
        ctx.save();
        ctx.globalCompositeOperation = mode;
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.scale(1, ry / Math.max(1, rx));
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        g.addColorStop(0, oklchCss(col.L, col.C, col.H, alpha));
        g.addColorStop(0.55, oklchCss(col.L, col.C, col.H, alpha * 0.45));
        g.addColorStop(1, oklchCss(col.L, col.C, col.H, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    };

    // 2. Archetype-specific non-flat light structure
    if (archetype === 'prism') {
        // Slanted refracted sunbeams / window caustics with chromatic edge separation
        const beamAngle = (Math.random() < 0.5 ? 1 : -1) * (0.32 + Math.random() * 0.45);
        const cols = [cMain, cAccent, cGlow, cCounter];
        for (let i = 0; i < 4; i++) {
            const cx = W * (0.14 + i * 0.24 + (Math.random() - 0.5) * 0.14);
            const cy = H * (0.18 + Math.random() * 0.64);
            drawBlob(cx, cy, W * (0.48 + Math.random() * 0.22), H * (0.11 + Math.random() * 0.08),
                beamAngle + (Math.random() - 0.5) * 0.15, cols[i % cols.length], 0.88, i === 2 ? 'screen' : 'source-over');
        }
        // Subtle shadow wedge for sculptural depth
        drawBlob(W * (Math.random() < 0.5 ? 0.1 : 0.9), H * (0.75 + Math.random() * 0.2), W * 0.52, H * 0.34,
            beamAngle, cBase, 0.72, 'multiply');
    } else if (archetype === 'watercolor') {
        // Asymmetric overlapping organic pigment bleeds with dark rim pockets + luminous pools
        const picks = [cMain, cAccent, cCounter, cGlow, cMain, cAccent];
        for (let i = 0; i < 7; i++) {
            const col = picks[i % picks.length];
            const mode = i === 0 ? 'multiply' : (i >= 5 ? 'screen' : 'source-over');
            drawBlob(
                W * (0.08 + Math.random() * 0.84),
                H * (0.08 + Math.random() * 0.84),
                W * (0.28 + Math.random() * 0.36),
                H * (0.20 + Math.random() * 0.32),
                Math.random() * Math.PI,
                col,
                0.76 + Math.random() * 0.2,
                mode
            );
        }
    } else if (archetype === 'eclipse') {
        // Luminous horizon arc hugging one quadrant + contrasting warm/cool counterweight
        const flipX = Math.random() < 0.5;
        const flipY = Math.random() < 0.5;
        const ax = flipX ? W * 0.82 : W * 0.18;
        const ay = flipY ? H * 0.80 : H * 0.20;
        drawBlob(ax, ay, W * 0.62, H * 0.54, Math.random() * Math.PI, cAccent, 0.92, 'screen');
        drawBlob(ax + (flipX ? 14 : -14), ay + (flipY ? 12 : -12), W * 0.38, H * 0.36, 0, cBase, 0.85, 'multiply');
        drawBlob(W - ax, H - ay, W * 0.52, H * 0.38, Math.random() * Math.PI, cCounter, 0.85, 'source-over');
        drawBlob(W * 0.5, H * 0.5, W * 0.34, H * 0.24, Math.random() * Math.PI, cGlow, 0.62, 'screen');
    } else {
        // Aurora: sweeping multi-stop curved Bezier light curtains
        const curtains = [cMain, cAccent, cGlow];
        curtains.forEach((col, idx) => {
            ctx.save();
            ctx.globalCompositeOperation = idx === 2 ? 'screen' : 'source-over';
            const yStart = H * (0.12 + idx * 0.28 + (Math.random() - 0.5) * 0.16);
            const yEnd = H * (0.20 + (2 - idx) * 0.26 + (Math.random() - 0.5) * 0.18);
            const cpx = W * (0.3 + Math.random() * 0.4);
            const cpy = H * (0.1 + Math.random() * 0.8);
            const lg = ctx.createLinearGradient(0, yStart, W, yEnd);
            lg.addColorStop(0, oklchCss(col.L, col.C, col.H, 0.15));
            lg.addColorStop(0.5, oklchCss(col.L, col.C, col.H, 0.92));
            lg.addColorStop(1, oklchCss(cCounter.L, cCounter.C, cCounter.H, 0.25));
            ctx.strokeStyle = lg;
            ctx.lineWidth = 28 + idx * 10;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(-14, yStart);
            ctx.quadraticCurveTo(cpx, cpy, W + 14, yEnd);
            ctx.stroke();
            ctx.restore();
        });
        drawBlob(W * (0.15 + Math.random() * 0.7), H * (0.15 + Math.random() * 0.7), W * 0.40, H * 0.32, 0.4, cBase, 0.55, 'multiply');
    }

    ctx.restore();
    let url = '';
    try { url = `url("${_canvas.toDataURL('image/png')}")`; } catch (_) {}
    return { url, archetype, harmony: pal.harmony, baseHue: pal.baseHue };
}

// ── DOM Mounting (Practice & Vault Review stages ONLY) ──────────────────────
function _ensureStageWash(container) {
    if (!container || typeof document === 'undefined') return null;
    let el = container.querySelector(':scope > .cw-stage-wash');
    if (!el) {
        el = document.createElement('div');
        el.className = 'cw-stage-wash';
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML =
            '<div class="cw-slot cw-slot-a"><div class="cw-layer cw-layer-1"></div><div class="cw-layer cw-layer-2"></div></div>' +
            '<div class="cw-slot cw-slot-b"><div class="cw-layer cw-layer-1"></div><div class="cw-layer cw-layer-2"></div></div>';
        container.insertBefore(el, container.firstChild);
    }
    el.classList.toggle('is-active', _enabled);
    const slotA = el.querySelector('.cw-slot-a');
    const slotB = el.querySelector('.cw-slot-b');
    if (slotA) slotA.classList.toggle('is-shown', _activeSlot === 'a');
    if (slotB) slotB.classList.toggle('is-shown', _activeSlot === 'b');
    return el;
}

function _getActiveStages() {
    if (typeof document === 'undefined') return [];
    const list = [];
    const pm = document.getElementById('practice-modal');
    if (pm && pm.classList && pm.classList.contains('active')) list.push(pm);
    const sr = document.getElementById('sr-practice-overlay');
    if (sr && sr.isConnected) list.push(sr);
    return list;
}

function _syncAllWashes() {
    if (typeof document === 'undefined') return;
    const stages = _getActiveStages();
    const isActive = _enabled && stages.length > 0;
    document.documentElement.classList.toggle('cw-wash-active', isActive);

    // Mount into #practice-modal eagerly if present, and into #sr-practice-overlay whenever open
    const pm = document.getElementById('practice-modal');
    if (pm) _ensureStageWash(pm);
    const sr = document.getElementById('sr-practice-overlay');
    if (sr) _ensureStageWash(sr);

    // Sync Settings controls
    const toggle = document.getElementById('cw-enabled');
    if (toggle) toggle.checked = _enabled;
}

function _currentVibeId() {
    try {
        if (typeof window !== 'undefined' && window.HeartbeatAudio && typeof window.HeartbeatAudio.getVibe === 'function') {
            return window.HeartbeatAudio.getVibe();
        }
    } catch (_) {}
    return 'aperture';
}

/** Paint a fresh unique Light-Plate and smoothly crossfade (6.5s) into it. */
export function rollWash(opts = {}) {
    if (typeof document === 'undefined') return null;
    const vibe = opts.vibe || _currentVibeId();
    const plate = _paintLightPlate(vibe);
    if (!plate.url) return plate;

    const nextSlot = _rollCount === 0 ? 'a' : (_activeSlot === 'a' ? 'b' : 'a');
    const root = document.documentElement;
    root.style.setProperty(nextSlot === 'a' ? '--cw-plate-a' : '--cw-plate-b', plate.url);
    root.style.setProperty('--cw-plate-active', plate.url);
    if (_rollCount === 0) {
        root.style.setProperty('--cw-plate-b', plate.url);
    }

    _activeSlot = nextSlot;
    _rollCount += 1;
    _syncAllWashes();
    return plate;
}

function _scheduleNextDrift() {
    if (_driftTimer) { clearTimeout(_driftTimer); _driftTimer = null; }
    if (!_enabled || !_stageActive) return;
    // Randomized 3.5 to 5.5 minute gentle evolution so colour melts imperceptibly during long grinds
    const delayMs = Math.round((210 + Math.random() * 120) * 1000);
    _driftTimer = setTimeout(() => {
        _driftTimer = null;
        if (_enabled && _stageActive && !(typeof document !== 'undefined' && document.hidden)) {
            rollWash();
        }
        _scheduleNextDrift();
    }, delayMs);
}

/** Called naturally when a fresh question appears in Practice or Vault. */
export function notifyQuestionStep(sig) {
    if (!_enabled) return;
    const key = sig ? String(sig) : '';
    if (key && key === _lastQuestionSig) return;
    if (key) _lastQuestionSig = key;
    _questionCounter += 1;
    // Roll smoothly every 3 questions (right on the question transition, never mid-solving)
    if (_questionCounter >= 3) {
        _questionCounter = 0;
        rollWash();
        _scheduleNextDrift();
    }
}

export function setEnabled(on) {
    _enabled = Boolean(on);
    _saveEnabled(_enabled);
    if (_enabled && _rollCount === 0) {
        rollWash();
    }
    _syncAllWashes();
    if (_enabled && _stageActive) _scheduleNextDrift();
    else if (_driftTimer) { clearTimeout(_driftTimer); _driftTimer = null; }
    return _enabled;
}

export function isEnabled() {
    return _enabled;
}

export function getState() {
    return {
        enabled: _enabled,
        activeSlot: _activeSlot,
        archetype: _lastArchetype,
        harmony: _lastHarmony,
        baseHue: Math.round(_lastBaseHue),
        rollCount: _rollCount,
        stageActive: _stageActive,
    };
}

// ── Lightweight Lifecycle Observers ─────────────────────────────────────────
function _onStagePresenceChange() {
    const stages = _getActiveStages();
    const nowActive = stages.length > 0;
    const entered = nowActive && !_stageActive;
    _stageActive = nowActive;

    if (entered && _enabled) {
        _questionCounter = 0;
        rollWash();
        _scheduleNextDrift();
    } else if (!nowActive && _driftTimer) {
        clearTimeout(_driftTimer);
        _driftTimer = null;
    }
    _syncAllWashes();
}

function _wireSettings() {
    const toggle = document.getElementById('cw-enabled');
    if (toggle && !toggle.dataset.cwBound) {
        toggle.dataset.cwBound = '1';
        toggle.checked = _enabled;
        toggle.addEventListener('change', () => {
            setEnabled(toggle.checked);
            try { if (window.FX && window.FX.wantSound()) window.FX.sound('toggle'); } catch (_) {}
        });
    }
    const shuffle = document.getElementById('cw-shuffle');
    if (shuffle && !shuffle.dataset.cwBound) {
        shuffle.dataset.cwBound = '1';
        shuffle.addEventListener('click', () => {
            if (!_enabled) setEnabled(true);
            else rollWash();
            try { if (window.FX && window.FX.wantSound()) window.FX.sound('select'); } catch (_) {}
        });
    }
}

export function initChromaWash() {
    if (_inited || typeof document === 'undefined') return;
    _inited = true;

    _wireSettings();
    if (_enabled && _rollCount === 0) {
        rollWash();
    }

    // Watch #practice-modal class flips (active open/close & question-state resets)
    const pm = document.getElementById('practice-modal');
    if (pm && typeof MutationObserver !== 'undefined') {
        let prevPqState = pm.dataset ? pm.dataset.pqState : '';
        new MutationObserver(() => {
            const curState = pm.dataset ? pm.dataset.pqState : '';
            if (pm.classList.contains('active') && curState === 'solving' && prevPqState === 'answered') {
                notifyQuestionStep(`pq-${Date.now()}`);
            }
            prevPqState = curState;
            _onStagePresenceChange();
        }).observe(pm, { attributes: true, attributeFilter: ['class', 'data-pq-state'] });
    }

    // Watch document.body direct child list ONLY for dynamic #sr-practice-overlay mount/unmount
    if (document.body && typeof MutationObserver !== 'undefined') {
        new MutationObserver(() => {
            _onStagePresenceChange();
        }).observe(document.body, { childList: true });
    }

    // Gently evolve palette when user switches Flow Vibe
    if (typeof window !== 'undefined') {
        window.addEventListener('hb:vibe-change', (e) => {
            if (_enabled) rollWash({ vibe: e && e.detail && e.detail.vibe });
        });
    }

    _onStagePresenceChange();
}

export const ChromaWash = {
    init: initChromaWash,
    roll: rollWash,
    setEnabled,
    isEnabled,
    notifyQuestionStep,
    getState,
};

try {
    if (typeof window !== 'undefined') window.ChromaWash = ChromaWash;
} catch (_) {}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initChromaWash);
    else initChromaWash();
}
