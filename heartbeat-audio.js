/**
 * heartbeat-audio.js — Infinite Evolutionary Flow Soundscape & Tactile Audio Engine
 *
 * Designed for multi-hour zero-fatigue deep analytical flow (JEE Advanced):
 *   - 100% procedural offline Web Audio synthesis (zero external assets, iPad Safari/PWA tuned)
 *   - 4 minimal evolutionary vibes with non-repeating generative architecture:
 *       * Aperture (Default): Deep analytical flow · 108 BPM · Lydian stereo pink noise & warm sub-thumps
 *       * Aether: Weightless drift · 86 BPM · Lush stereo pink-noise ocean & long shimmer hall
 *       * Kinetic: Momentum · 118 BPM · Crisp sub-drive & Mixolydian forward velocity
 *       * Solstice: Luminous bloom · 98 BPM · Golden Maj9 tines, warm tape echo & bright air
 *   - Non-repeating for hours:
 *       * Fresh session PRNG seed on every boot (key, phase, micro-tempo offset)
 *       * Monotonic coprime step sequencer (7 / 11 / 13 / 19-step Euclidean motifs)
 *       * Markov overlapping 4-voice polyphonic warm pad + Circle-of-Fifths key drift during Exhale tides
 *       * Irrational-period macro Flow Tide oscillators (Horizon → Pulse → Crest → Exhale)
 *   - True stereo decorrelated Paul Kellet (-3 dB/oct) pink noise + Dual Convolver & Octave Shimmer Halo
 *   - Tactile Pact Sign Flow Slider audio: velocity/value-scaled sub-thumps, Lydian tines,
 *     zone-crossing gear-shift bass drops (31 / 63 / 98), live Pact mix preview & Pact Seal bloom
 */

const PREFS_KEY = 'jeemax_hb_audio_v1';
const SPOTIFY_YIELD_KEY = 'jeemax_spotify_yield_v1';
const SPOTIFY_TOKENS_KEY = 'jeemax_spotify_tokens_v1';

const SCHEDULE_AHEAD_SECS = 0.14;
const LOOKAHEAD_MS = 25;
const SILENT_WAV_URI = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

// Circle of Fifths bass fundamentals (Hz): G1, A1, B1, C2, D2, F1, Ab1, Bb1
const COF_ROOTS = [48.999, 55.0, 61.735, 65.406, 73.416, 43.654, 51.913, 58.270];

export const VIBE_ORDER = ['aperture', 'aether', 'kinetic', 'solstice'];

export const VIBES = Object.freeze({
    aperture: Object.freeze({
        id: 'aperture',
        name: 'Aperture',
        label: 'APERTURE',
        subtitle: 'Deep analytical flow · 108 BPM · Lydian stereo pink noise & warm sub-thumps',
        bpm: 108,
        scale: [0, 2, 4, 6, 7, 9, 11, 14, 16],
        pinkLevel: 0.21,
        pinkCutoff: 1550,
        subLevel: 0.42,
        bassLevel: 0.15,
        padLevel: 0.19,
        motifLevel: 0.068,
        sparkleLevel: 0.045,
        brushLevel: 0.022,
        reverbWet: 0.46,
        shimmerWet: 0.22,
        delayWet: 0.24,
        drive: 7,
        subStyle: 'steady',
        accent: '#7dd3fc',
    }),
    aether: Object.freeze({
        id: 'aether',
        name: 'Aether',
        label: 'AETHER',
        subtitle: 'Weightless drift · 86 BPM · Lush stereo pink-noise ocean & long shimmer hall',
        bpm: 86,
        scale: [0, 2, 4, 7, 9, 11, 14, 18],
        pinkLevel: 0.27,
        pinkCutoff: 1280,
        subLevel: 0.26,
        bassLevel: 0.10,
        padLevel: 0.24,
        motifLevel: 0.052,
        sparkleLevel: 0.062,
        brushLevel: 0.008,
        reverbWet: 0.62,
        shimmerWet: 0.36,
        delayWet: 0.30,
        drive: 4,
        subStyle: 'sparse',
        accent: '#c4b5fd',
    }),
    kinetic: Object.freeze({
        id: 'kinetic',
        name: 'Kinetic',
        label: 'KINETIC',
        subtitle: 'Forward velocity · 118 BPM · Crisp sub-drive & rhythmic Mixolydian momentum',
        bpm: 118,
        scale: [0, 2, 4, 7, 9, 10, 14, 16],
        pinkLevel: 0.17,
        pinkCutoff: 1950,
        subLevel: 0.48,
        bassLevel: 0.18,
        padLevel: 0.15,
        motifLevel: 0.075,
        sparkleLevel: 0.042,
        brushLevel: 0.036,
        reverbWet: 0.34,
        shimmerWet: 0.16,
        delayWet: 0.22,
        drive: 10,
        subStyle: 'drive',
        accent: '#6ee7b7',
    }),
    solstice: Object.freeze({
        id: 'solstice',
        name: 'Solstice',
        label: 'SOLSTICE',
        subtitle: 'Luminous warmth · 98 BPM · Golden Maj9 tines, warm tape echo & bright air',
        bpm: 98,
        scale: [0, 2, 4, 7, 9, 11, 14, 16],
        pinkLevel: 0.22,
        pinkCutoff: 1750,
        subLevel: 0.35,
        bassLevel: 0.14,
        padLevel: 0.22,
        motifLevel: 0.088,
        sparkleLevel: 0.068,
        brushLevel: 0.018,
        reverbWet: 0.50,
        shimmerWet: 0.30,
        delayWet: 0.32,
        drive: 6,
        subStyle: 'warm',
        accent: '#fcd34d',
    }),
});

// Markov harmonic chord voicings (semitones above current root, lush 9th / add9 / #11 colors)
const CHORD_STATES = [
    { name: 'Imaj9',     intervals: [0, 7, 12, 14, 16, 23], next: [[1, 0.34], [3, 0.28], [4, 0.24], [5, 0.14]] },
    { name: 'IIadd9',    intervals: [2, 9, 14, 16, 21, 26], next: [[2, 0.42], [4, 0.32], [0, 0.26]] },
    { name: 'Vadd9',     intervals: [7, 14, 19, 21, 23, 28], next: [[0, 0.52], [3, 0.28], [5, 0.20]] },
    { name: 'VImin9',    intervals: [9, 16, 19, 23, 24, 28], next: [[4, 0.42], [1, 0.32], [2, 0.26]] },
    { name: 'IVmaj7#11', intervals: [5, 12, 16, 19, 23, 29], next: [[0, 0.38], [2, 0.36], [5, 0.26]] },
    { name: 'Isus2',     intervals: [0, 7, 14, 19, 21, 26], next: [[0, 0.28], [4, 0.36], [1, 0.20], [3, 0.16]] },
];

// Anchor 16-step sub-thump grids per subStyle
const SUB_GRIDS = {
    steady: [1.0, 0, 0, 0,  0.84, 0, 0, 0.26,  0.94, 0, 0, 0,  0.86, 0, 0.30, 0],
    sparse: [0.95, 0, 0, 0, 0, 0, 0, 0,        0.72, 0, 0, 0,  0, 0, 0, 0],
    drive:  [1.0, 0, 0, 0.28, 0.90, 0, 0, 0.32, 0.96, 0, 0.26, 0, 0.90, 0, 0.40, 0.22],
    warm:   [1.0, 0, 0, 0,  0.76, 0, 0.25, 0,  0.90, 0, 0, 0,  0.78, 0, 0.34, 0],
};

// ── Helpers & Seeded PRNG ───────────────────────────────────────────────────
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const semiToFreq = (rootHz, semis) => rootHz * Math.pow(2, semis / 12);

function _mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function _normalizeVibeId(id) {
    return (typeof id === 'string' && Object.prototype.hasOwnProperty.call(VIBES, id)) ? id : 'aperture';
}

function _loadPrefs() {
    let enabled = true;
    let vibe = 'aperture';
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(PREFS_KEY);
            if (raw !== null) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    if (typeof parsed.enabled === 'boolean') enabled = parsed.enabled;
                    vibe = _normalizeVibeId(parsed.vibe);
                }
            }
        }
    } catch (_) {}
    return { enabled, vibe };
}

function _savePrefs(enabled, vibe) {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(PREFS_KEY, JSON.stringify({
                enabled: Boolean(enabled),
                vibe: _normalizeVibeId(vibe),
            }));
        }
    } catch (_) {}
}

function _loadInitialSpotifyYield() {
    try {
        if (typeof localStorage !== 'undefined') {
            const explicit = localStorage.getItem(SPOTIFY_YIELD_KEY);
            if (explicit === '1') return true;
            if (explicit === '0') return false;
            if (localStorage.getItem(SPOTIFY_TOKENS_KEY)) return true;
        }
    } catch (_) {}
    return false;
}

// ── Module State ────────────────────────────────────────────────────────────
const _initPrefs = _loadPrefs();
let _enabled = _initPrefs.enabled;
let _vibeId = _initPrefs.vibe;
let _spotifyYield = _loadInitialSpotifyYield();

let _ac = null;
let _graphBuilt = false;
let _iosUnlockAudio = null;
let _iosSessionActivated = false;
let _running = false;
let _boundGestures = false;
let _lastVitals = null;

// Audio nodes
let _masterGain = null;
let _toneFilter = null;
let _duckBus = null;
let _sfxBus = null;
let _warmthEq = null;
let _tapeDrive = null;
let _pinkGain = null;
let _pinkLp = null;
let _reverbSend = null;
let _reverbWet = null;
let _shimmerSend = null;
let _shimmerWet = null;
let _delaySend = null;
let _delayWet = null;
let _delayL = null;
let _delayR = null;
let _flatlineGain = null;

// Buffers
let _stereoPinkBuffer = null;
let _crispNoiseBuffer = null;

// Sequencer & Generative State
let _schedulerTimer = null;
let _modTimer = null;
let _nextStepTime = 0;
let _stepCounter = 0; // monotonic — never wraps at 8 bars
let _barCount = 0;
let _nextPadBar = 0;
let _nextModBar = 144;
let _chordState = 0;
let _sessionStartedAt = Date.now();
let _lastSliderBumpAt = 0;

// Session PRNG & evolutionary parameters
let _rng = _mulberry32((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
let _cofIndex = Math.floor(_rng() * COF_ROOTS.length);
let _tidePhases = [_rng() * Math.PI * 2, _rng() * Math.PI * 2, _rng() * Math.PI * 2];
let _tempoOffsetBpm = (_rng() - 0.5) * 2.4; // subtle ±1.2 BPM organic fingerprint per session

// Pact preview state
let _pactPreviewActive = false;
let _pactPreviewValue = 72;

// ── Helpers for Vibe & Macro Tide ───────────────────────────────────────────
function _vibe() {
    return VIBES[_vibeId] || VIBES.aperture;
}

function _stepSecs() {
    const bpm = clamp(_vibe().bpm + _tempoOffsetBpm, 72, 136);
    return 60 / bpm / 4;
}

function _macroTide(elapsedSecs) {
    const t = Math.max(0, elapsedSecs || ((Date.now() - _sessionStartedAt) / 1000));
    const w = 0.50
        + 0.28 * Math.sin(t / 61 + _tidePhases[0])
        + 0.14 * Math.sin(t / 103 + _tidePhases[1])
        + 0.08 * Math.sin(t / 179 + _tidePhases[2]);
    return clamp(w, 0.08, 1.0);
}

function _rootHz() {
    return COF_ROOTS[_cofIndex % COF_ROOTS.length];
}

function _scaleFreq(degreeIdx, octaveOffset = 0) {
    const scale = _vibe().scale;
    const idx = ((degreeIdx % scale.length) + scale.length) % scale.length;
    const semis = scale[idx] + octaveOffset * 12;
    return semiToFreq(_rootHz(), semis);
}

function _zoneForSlider(v) {
    const n = clamp(Math.round(Number(v) || 0), 0, 100);
    if (n <= 30) return 0; // Rest
    if (n <= 62) return 1; // Steady
    if (n <= 97) return 2; // Flow
    return 3;              // Hardcore
}

function _createStereoPanner(ac, panVal) {
    if (typeof ac.createStereoPanner === 'function') {
        const p = ac.createStereoPanner();
        p.pan.value = clamp(panVal, -1, 1);
        return p;
    }
    const g = ac.createGain();
    g.gain.value = 1.0;
    return g;
}

function _nyquistSafe(ac, hz) {
    const maxHz = Math.max(1200, (ac && ac.sampleRate ? ac.sampleRate : 44100) * 0.44);
    return clamp(hz, 24, maxHz);
}

// ── iOS / iPadOS Audio Session & Context Unlock ─────────────────────────────
function _setIosSessionType(type) {
    try {
        if (typeof navigator !== 'undefined' && navigator.audioSession && 'type' in navigator.audioSession) {
            if (navigator.audioSession.type !== type) {
                navigator.audioSession.type = type;
            }
        }
    } catch (_) {}
}

function _activateIosAudioSession() {
    if (_spotifyYield) {
        _setIosSessionType('ambient');
        return;
    }
    _setIosSessionType('playback');

    if (_iosSessionActivated || typeof document === 'undefined') return;
    try {
        if (!_iosUnlockAudio) {
            const el = document.createElement('audio');
            el.setAttribute('playsinline', '');
            el.setAttribute('webkit-playsinline', '');
            el.preload = 'auto';
            el.src = SILENT_WAV_URI;
            el.volume = 0.01;
            _iosUnlockAudio = el;
        }
        const p = _iosUnlockAudio.play();
        if (p && typeof p.then === 'function') {
            p.then(() => { _iosSessionActivated = true; }).catch(() => {});
        } else {
            _iosSessionActivated = true;
        }
    } catch (_) {}
}

function _playSilentPulse(ac) {
    try {
        const b = ac.createBuffer(1, 1, 22050);
        const s = ac.createBufferSource();
        s.buffer = b;
        s.connect(ac.destination);
        s.start(0);
    } catch (_) {}
}

function _ensureContext() {
    if (_ac) return _ac;
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    let ac;
    try { ac = new AudioCtx(); } catch (_) { return null; }
    _ac = ac;
    try {
        ac.addEventListener('statechange', () => {
            if (_ac !== ac) return;
            if (_spotifyYield) {
                _applyHealthModulation();
                _syncButtonUI();
                return;
            }
            if (ac.state === 'running' && _enabled && !(typeof document !== 'undefined' && document.hidden)) {
                _buildGraph();
                if (!_running) {
                    _startLoops();
                    playBootIgnition();
                } else {
                    _applyHealthModulation();
                }
                _syncButtonUI();
            }
        });
    } catch (_) {}
    return ac;
}

// ── Noise Buffers & Procedural Velvet Hall Convolver ────────────────────────
function _ensureNoiseBuffers(ac) {
    if (_stereoPinkBuffer && _stereoPinkBuffer.sampleRate === ac.sampleRate) return;

    // True stereo decorrelated 6.0s Paul Kellet (-3 dB/oct) pink noise with seamless loop crossfade
    const secs = 6.0;
    const len = Math.floor(ac.sampleRate * secs);
    const xfade = Math.floor(ac.sampleRate * 0.4);
    const pinkBuf = ac.createBuffer(2, len, ac.sampleRate);

    for (let ch = 0; ch < 2; ch++) {
        const data = pinkBuf.getChannelData(ch);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        const raw = new Float32Array(len + xfade);
        // Warm up filter state first
        for (let i = 0; i < 512; i++) {
            const w = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + w * 0.0555179;
            b1 = 0.99332 * b1 + w * 0.0750759;
            b2 = 0.96900 * b2 + w * 0.1538520;
            b3 = 0.86650 * b3 + w * 0.3104856;
            b4 = 0.55000 * b4 + w * 0.5329522;
            b5 = -0.7616 * b5 - w * 0.0168980;
            b6 = w * 0.115926;
        }
        for (let i = 0; i < raw.length; i++) {
            const w = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + w * 0.0555179;
            b1 = 0.99332 * b1 + w * 0.0750759;
            b2 = 0.96900 * b2 + w * 0.1538520;
            b3 = 0.86650 * b3 + w * 0.3104856;
            b4 = 0.55000 * b4 + w * 0.5329522;
            b5 = -0.7616 * b5 - w * 0.0168980;
            const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.095;
            b6 = w * 0.115926;
            raw[i] = clamp(pink, -0.98, 0.98);
        }
        // Equal-power crossfade tail into head for click-free infinite looping
        for (let i = 0; i < len; i++) {
            if (i < xfade) {
                const t = i / xfade;
                const a = Math.sin(t * Math.PI * 0.5);
                const b = Math.cos(t * Math.PI * 0.5);
                data[i] = raw[i] * a + raw[len + i] * b;
            } else {
                data[i] = raw[i];
            }
        }
    }

    // Short crisp white noise for subtle tactile/brush transients
    const crispBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.45), ac.sampleRate);
    const cCh = crispBuf.getChannelData(0);
    for (let i = 0; i < cCh.length; i++) cCh[i] = Math.random() * 2 - 1;

    _stereoPinkBuffer = pinkBuf;
    _crispNoiseBuffer = crispBuf;
}

function _createVelvetHallReverb(ac) {
    const conv = ac.createConvolver();
    const secs = 3.4;
    const len = Math.floor(ac.sampleRate * secs);
    const ir = ac.createBuffer(2, len, ac.sampleRate);
    const sr = ac.sampleRate;

    // Warm early reflection tap delays (ms) for spatial depth without slapback
    const erTaps = [0.014, 0.023, 0.031, 0.044, 0.056, 0.068];

    for (let c = 0; c < 2; c++) {
        const data = ir.getChannelData(c);
        let lp = 0;
        let hp = 0;
        for (let i = 0; i < len; i++) {
            const t = i / len;
            const sec = i / sr;
            const fadeIn = Math.min(1.0, sec / 0.018);
            const decay = Math.pow(1 - t, 2.25) * fadeIn;
            const raw = (Math.random() * 2 - 1) * decay;
            // Time-dependent air absorption: early tail stays luminous, late tail melts into velvet
            const dampCoeff = (c === 0 ? 0.34 : 0.31) * (1 - t * 0.65) + 0.05;
            lp += (raw - lp) * dampCoeff;
            hp += (lp - hp) * 0.014; // keep sub below ~110Hz out of reverb tail
            data[i] = (lp - hp) * 1.18;
        }
        // Add subtle decorrelated early-reflection sheen
        erTaps.forEach((tapSec, idx) => {
            const pos = Math.floor((tapSec + (c === 1 ? 0.003 : 0)) * sr);
            if (pos < len) {
                const amp = 0.24 * Math.pow(0.76, idx) * (idx % 2 === 0 ? 1 : -1);
                data[pos] += amp;
            }
        });
    }
    conv.buffer = ir;
    return conv;
}

function _makeTapeCurve(drive = 7) {
    const n = 2048;
    const curve = new Float32Array(n);
    const k = 1 + drive * 0.08;
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        curve[i] = Math.tanh((x + 0.03 * x * x) * k) / norm;
    }
    return curve;
}

// ── State Readers ───────────────────────────────────────────────────────────
function _readVitalsSafe() {
    try {
        if (typeof window !== 'undefined' && window.Heartbeat && typeof window.Heartbeat.getVitals === 'function') {
            return window.Heartbeat.getVitals();
        }
    } catch (_) {}
    return { reservoirHours: 18, reservoirRatio: 1, speed: 1, luminescence: 1, frozen: false, flatlined: false };
}

function _isVoidActive() {
    try {
        return typeof document !== 'undefined' && document.body && document.body.classList.contains('hb-void-active');
    } catch (_) { return true; }
}

// ── DSP Graph Construction ──────────────────────────────────────────────────
function _buildGraph() {
    const ac = _ensureContext();
    if (!ac) return null;
    if (_graphBuilt) return ac;
    _graphBuilt = true;
    _ensureNoiseBuffers(ac);

    const v = _vibe();
    const step = _stepSecs();

    // Master warmth & clarity polish chain
    _toneFilter = ac.createBiquadFilter();
    _toneFilter.type = 'lowpass';
    _toneFilter.frequency.value = _nyquistSafe(ac, 4600);
    _toneFilter.Q.value = 0.72;

    const subGuard = ac.createBiquadFilter();
    subGuard.type = 'highpass';
    subGuard.frequency.value = 30;

    _warmthEq = ac.createBiquadFilter();
    _warmthEq.type = 'peaking';
    _warmthEq.frequency.value = 118;
    _warmthEq.Q.value = 0.9;
    _warmthEq.gain.value = 3.2;

    const airShelf = ac.createBiquadFilter();
    airShelf.type = 'highshelf';
    airShelf.frequency.value = 5200;
    airShelf.gain.value = -1.5; // prevents ear fatigue across 3+ hour sessions

    _tapeDrive = ac.createWaveShaper();
    _tapeDrive.curve = _makeTapeCurve(v.drive);
    try { _tapeDrive.oversample = '2x'; } catch (_) {}

    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 16;
    comp.ratio.value = 4.5;
    comp.attack.value = 0.008;
    comp.release.value = 0.18;

    _masterGain = ac.createGain();
    _masterGain.gain.value = 0.0001;

    _duckBus = ac.createGain();
    _duckBus.gain.value = 1.0;

    // Dedicated SFX bus so slider bass bumps & seals pass through speaker warmth + limiter cleanly
    _sfxBus = ac.createGain();
    _sfxBus.gain.value = 0.92;
    _sfxBus.connect(_warmthEq);

    // 1. Velvet Hall Stereo Convolver
    const reverb = _createVelvetHallReverb(ac);
    _reverbWet = ac.createGain();
    _reverbWet.gain.value = v.reverbWet;
    _reverbSend = ac.createGain();
    _reverbSend.gain.value = 0.75;
    _reverbSend.connect(reverb);
    reverb.connect(_reverbWet);
    _reverbWet.connect(_duckBus);

    // 2. Octave / Air Shimmer Halo Bus (feeds into Velvet Hall)
    _shimmerSend = ac.createGain();
    _shimmerSend.gain.value = 0.65;
    _shimmerWet = ac.createGain();
    _shimmerWet.gain.value = v.shimmerWet;
    const shimBp = ac.createBiquadFilter();
    shimBp.type = 'bandpass';
    shimBp.frequency.value = 1650;
    shimBp.Q.value = 0.7;
    const shimDelL = ac.createDelay(1.0);
    const shimDelR = ac.createDelay(1.0);
    shimDelL.delayTime.value = 0.37;
    shimDelR.delayTime.value = 0.53;
    const shimFb = ac.createGain();
    shimFb.gain.value = 0.46;
    const shimLp = ac.createBiquadFilter();
    shimLp.type = 'lowpass';
    shimLp.frequency.value = _nyquistSafe(ac, 3600);

    // Subtle chorus flutter on shimmer delays
    const shimLfoA = ac.createOscillator();
    const shimLfoB = ac.createOscillator();
    const shimLfoGA = ac.createGain();
    const shimLfoGB = ac.createGain();
    shimLfoA.frequency.value = 0.17;
    shimLfoB.frequency.value = 0.23;
    shimLfoGA.gain.value = 0.0024;
    shimLfoGB.gain.value = 0.0026;
    shimLfoA.connect(shimLfoGA).connect(shimDelL.delayTime);
    shimLfoB.connect(shimLfoGB).connect(shimDelR.delayTime);
    shimLfoA.start();
    shimLfoB.start();

    _shimmerSend.connect(shimBp);
    shimBp.connect(shimDelL);
    shimDelL.connect(shimLp);
    shimLp.connect(shimDelR);
    shimDelR.connect(shimFb);
    shimFb.connect(shimDelL);
    shimDelL.connect(_shimmerWet);
    shimDelR.connect(_shimmerWet);
    _shimmerWet.connect(reverb);

    // 3. Stereo Dotted-Eighth Tape Delay
    _delaySend = ac.createGain();
    _delaySend.gain.value = 0.65;
    _delayWet = ac.createGain();
    _delayWet.gain.value = v.delayWet;
    _delayL = ac.createDelay(1.5);
    _delayR = ac.createDelay(1.5);
    _delayL.delayTime.value = clamp(step * 3, 0.05, 1.45);
    _delayR.delayTime.value = clamp(step * 4.5, 0.05, 1.45);
    const delayLp = ac.createBiquadFilter();
    delayLp.type = 'lowpass';
    delayLp.frequency.value = _nyquistSafe(ac, 2200);
    const delayFb = ac.createGain();
    delayFb.gain.value = 0.36;

    _delaySend.connect(_delayL);
    _delayL.connect(delayLp);
    delayLp.connect(_delayR);
    _delayR.connect(delayFb);
    delayFb.connect(_delayL);
    _delayL.connect(_delayWet);
    _delayR.connect(_delayWet);
    _delayWet.connect(_duckBus);

    // Connect main bus
    _duckBus.connect(_toneFilter);
    _toneFilter.connect(subGuard);
    subGuard.connect(_warmthEq);
    _warmthEq.connect(airShelf);
    airShelf.connect(_tapeDrive);
    _tapeDrive.connect(comp);
    comp.connect(_masterGain);
    _masterGain.connect(ac.destination);

    // 4. True Stereo Decorrelated Velvet Pink Noise Cocoon
    const pinkSrc = ac.createBufferSource();
    pinkSrc.buffer = _stereoPinkBuffer;
    pinkSrc.loop = true;

    const pinkHp = ac.createBiquadFilter();
    pinkHp.type = 'highpass';
    pinkHp.frequency.value = 78; // keep sub headroom crystal clean

    const pinkWarmth = ac.createBiquadFilter();
    pinkWarmth.type = 'peaking';
    pinkWarmth.frequency.value = 340;
    pinkWarmth.Q.value = 0.85;
    pinkWarmth.gain.value = 2.4;

    _pinkLp = ac.createBiquadFilter();
    _pinkLp.type = 'lowpass';
    _pinkLp.frequency.value = _nyquistSafe(ac, v.pinkCutoff);
    _pinkLp.Q.value = 0.65;

    // Slow irrational-period breathing LFO on pink-noise air
    const pinkLfo = ac.createOscillator();
    const pinkLfoG = ac.createGain();
    pinkLfo.type = 'sine';
    pinkLfo.frequency.value = 0.029; // ~34.5s gentle ocean tide
    pinkLfoG.gain.value = 260;
    pinkLfo.connect(pinkLfoG).connect(_pinkLp.frequency);
    pinkLfo.start();

    _pinkGain = ac.createGain();
    _pinkGain.gain.value = v.pinkLevel;

    pinkSrc.connect(pinkHp);
    pinkHp.connect(pinkWarmth);
    pinkWarmth.connect(_pinkLp);
    _pinkLp.connect(_pinkGain);
    _pinkGain.connect(_duckBus);
    pinkSrc.start();

    // 5. Flatline Safety Drone (only audible at 0.0h flatline)
    const flOsc = ac.createOscillator();
    flOsc.type = 'sine';
    flOsc.frequency.value = 110;
    _flatlineGain = ac.createGain();
    _flatlineGain.gain.value = 0.0001;
    flOsc.connect(_flatlineGain).connect(_masterGain);
    flOsc.start();

    return ac;
}

// ── Synthesized Generative Instruments ──────────────────────────────────────

function _schedSubThump(ac, time, vel, duckAmount, intensityScale = 1.0) {
    const osc = ac.createOscillator();
    const body = ac.createOscillator();
    const g = ac.createGain();
    const bg = ac.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(112, time);
    osc.frequency.exponentialRampToValueAtTime(46, time + 0.095);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.25);

    body.type = 'triangle';
    body.frequency.setValueAtTime(176, time);
    body.frequency.exponentialRampToValueAtTime(72, time + 0.06);

    const peak = clamp(0.42 * vel * intensityScale, 0.001, 0.56);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.30);

    bg.gain.setValueAtTime(0.0001, time);
    bg.gain.linearRampToValueAtTime(peak * 0.22, time + 0.004);
    bg.gain.exponentialRampToValueAtTime(0.0001, time + 0.065);

    osc.connect(g);
    body.connect(bg).connect(g);
    g.connect(_toneFilter);
    // Subtle room send on sub-thump for air without mud
    const revTap = ac.createGain();
    revTap.gain.value = 0.14;
    g.connect(revTap).connect(_reverbSend);

    osc.start(time);
    body.start(time);
    osc.stop(time + 0.33);
    body.stop(time + 0.08);

    // Smooth sidechain breathing on pink noise & reverb tail
    if (_duckBus && duckAmount > 0.03) {
        const floor = clamp(1.0 - duckAmount * vel, 0.58, 0.96);
        try {
            _duckBus.gain.cancelScheduledValues(time);
            _duckBus.gain.setValueAtTime(_duckBus.gain.value, time);
            _duckBus.gain.linearRampToValueAtTime(floor, time + 0.018);
            _duckBus.gain.exponentialRampToValueAtTime(1.0, time + 0.24);
        } catch (_) {}
    }
}

function _schedWarmBass(ac, time, freq, dur, level = 1.0) {
    const sub = ac.createOscillator();
    const warm = ac.createOscillator();
    const warm2 = ac.createOscillator();
    const lp = ac.createBiquadFilter();
    const g = ac.createGain();
    const subG = ac.createGain();

    sub.type = 'sine';
    warm.type = 'triangle';
    warm2.type = 'sawtooth';
    sub.frequency.setValueAtTime(freq, time);
    warm.frequency.setValueAtTime(freq, time);
    warm2.frequency.setValueAtTime(freq * 2, time);
    warm.detune.value = -4;
    warm2.detune.value = +5;

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(_nyquistSafe(ac, 320 * (0.7 + 0.3 * level)), time);
    lp.frequency.exponentialRampToValueAtTime(95, time + dur);
    lp.Q.value = 1.8;

    const peak = clamp(0.14 * level, 0.001, 0.24);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    const w2g = ac.createGain();
    w2g.gain.value = 0.22;
    subG.gain.value = 0.72;

    sub.connect(subG).connect(lp);
    warm.connect(lp);
    warm2.connect(w2g).connect(lp);
    lp.connect(g).connect(_duckBus);

    sub.start(time);
    warm.start(time);
    warm2.start(time);
    sub.stop(time + dur + 0.04);
    warm.stop(time + dur + 0.04);
    warm2.stop(time + dur + 0.04);
}

function _schedWarmPadChord(ac, time, chordIdx, durSecs, level = 1.0, isMinorShift = false) {
    const state = CHORD_STATES[chordIdx % CHORD_STATES.length];
    const root = _rootHz() * 2; // octave up into warm midrange (87..146 Hz)
    const pans = [-0.62, 0.58, -0.34, 0.42, -0.18, 0.25];
    const attack = Math.min(2.6, durSecs * 0.28);
    const release = Math.min(3.8, durSecs * 0.38);

    // Pick 4 lush voices from chord intervals
    const voices = state.intervals.slice(0, 4);
    voices.forEach((semiRaw, idx) => {
        // Subtle harmonic gravity if reservoir is low: soften major 3rd/7th slightly without gloom
        let semi = semiRaw;
        if (isMinorShift && (semi % 12 === 4 || semi % 12 === 11)) semi -= 1;
        const freq = semiToFreq(root, semi);

        const o1 = ac.createOscillator();
        const o2 = ac.createOscillator();
        const lp = ac.createBiquadFilter();
        const pan = _createStereoPanner(ac, pans[idx % pans.length]);
        const g = ac.createGain();

        o1.type = 'triangle';
        o2.type = 'sine';
        o1.frequency.setValueAtTime(freq, time);
        o2.frequency.setValueAtTime(freq, time);
        o1.detune.value = (idx % 2 === 0 ? -5.5 : 5.5);
        o2.detune.value = (idx % 2 === 0 ? 4.5 : -4.5);

        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(_nyquistSafe(ac, idx >= 2 ? 1200 : 720), time);
        lp.Q.value = 0.7;

        const voicePeak = clamp((0.052 / Math.sqrt(voices.length)) * level * (idx >= 2 ? 0.85 : 1.0), 0.0008, 0.09);
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(voicePeak, time + attack);
        g.gain.setValueAtTime(voicePeak, time + Math.max(attack + 0.2, durSecs - release));
        g.gain.exponentialRampToValueAtTime(0.0001, time + durSecs + 0.2);

        o1.connect(lp);
        o2.connect(lp);
        lp.connect(pan);
        pan.connect(g);
        g.connect(_duckBus);
        g.connect(_reverbSend);
        if (idx >= 2 && _shimmerSend) {
            const shimTap = ac.createGain();
            shimTap.gain.value = 0.55;
            g.connect(shimTap).connect(_shimmerSend);
        }

        o1.start(time);
        o2.start(time);
        o1.stop(time + durSecs + 0.3);
        o2.stop(time + durSecs + 0.3);
    });
}

function _schedWarmTine(ac, time, freq, level = 1.0, panPos = 0) {
    // Clean Rhodes / kalimba harmonic tine (integer 2:1 FM ratio -> warm bell, zero metallic harshness)
    const car = ac.createOscillator();
    const mod = ac.createOscillator();
    const modG = ac.createGain();
    const pan = _createStereoPanner(ac, panPos);
    const g = ac.createGain();

    car.type = 'sine';
    mod.type = 'sine';
    car.frequency.setValueAtTime(freq, time);
    mod.frequency.setValueAtTime(freq * 2.0, time);

    modG.gain.setValueAtTime(freq * 0.68, time);
    modG.gain.exponentialRampToValueAtTime(1.0, time + 0.24);

    const dur = 1.35;
    const peak = clamp(0.075 * level, 0.0005, 0.14);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    mod.connect(modG).connect(car.frequency);
    car.connect(pan).connect(g);
    g.connect(_duckBus);
    g.connect(_reverbSend);
    g.connect(_delaySend);

    car.start(time);
    mod.start(time);
    car.stop(time + dur + 0.05);
    mod.stop(time + dur + 0.05);
}

function _schedHarmonicBloom(ac, time, freq, level = 1.0, panPos = 0) {
    // Airy upper harmonic halo note fed straight into Reverb & Shimmer bus
    const osc = ac.createOscillator();
    const pan = _createStereoPanner(ac, panPos);
    const g = ac.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

    const dur = 2.4;
    const peak = clamp(0.048 * level, 0.0004, 0.09);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.connect(pan).connect(g);
    g.connect(_reverbSend);
    if (_shimmerSend) g.connect(_shimmerSend);

    osc.start(time);
    osc.stop(time + dur + 0.06);
}

function _schedVelvetBrush(ac, time, vel) {
    if (!_crispNoiseBuffer) return;
    const src = ac.createBufferSource();
    src.buffer = _crispNoiseBuffer;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3400 + _rng() * 900;
    bp.Q.value = 1.8;
    const g = ac.createGain();
    const peak = clamp(0.022 * vel, 0.0003, 0.045);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    src.connect(bp).connect(g);
    g.connect(_duckBus);
    if (_reverbSend) g.connect(_reverbSend);
    src.start(time, _rng() * 0.25, 0.055);
}

// ── Markov Chord Transition & Circle-of-Fifths Conductor ────────────────────
function _advanceChordMarkov() {
    const cur = CHORD_STATES[_chordState % CHORD_STATES.length];
    const r = _rng();
    let acc = 0;
    let nextIdx = cur.next[0][0];
    for (let i = 0; i < cur.next.length; i++) {
        acc += cur.next[i][1];
        if (r <= acc) {
            nextIdx = cur.next[i][0];
            break;
        }
    }
    _chordState = nextIdx;
    return _chordState;
}

// ── Non-Repeating Coprime Lookahead Sequencer ───────────────────────────────
function _scheduleStep(stepIndex, time) {
    const v = _lastVitals || _readVitalsSafe();
    if (v.flatlined) return;

    const vibe = _vibe();
    const step = stepIndex % 16;
    const bar = Math.floor(stepIndex / 16);
    const inVoid = _isVoidActive();
    const tide = _macroTide();
    const stepSecs = _stepSecs();

    // Pact preview scales live musical energy across the 4 zones (0..100)
    let pactEnergy = 1.0;
    let pactSubScale = 1.0;
    let pactMotifScale = 1.0;
    if (_pactPreviewActive) {
        const pv = clamp(_pactPreviewValue, 0, 100);
        if (pv <= 30) {
            pactEnergy = 0.55;
            pactSubScale = 0.16;
            pactMotifScale = 0.45;
        } else if (pv <= 62) {
            pactEnergy = 0.78;
            pactSubScale = 0.65;
            pactMotifScale = 0.75;
        } else if (pv <= 97) {
            pactEnergy = 1.05;
            pactSubScale = 1.02;
            pactMotifScale = 1.05;
        } else {
            pactEnergy = 1.24;
            pactSubScale = 1.28;
            pactMotifScale = 1.18;
        }
    }

    const focusScale = inVoid ? 1.0 : (v.frozen ? 0.68 : 0.76);
    const isLowReservoir = v.reservoirHours < 6.0;

    // Bar boundary: Markov pad conductor + long-horizon Circle of Fifths key drift
    if (step === 0) {
        _barCount = bar;

        // Every ~128–192 bars during an Exhale tide trough, modulate smoothly by a 5th
        if (bar >= _nextModBar && tide < 0.36) {
            const dir = _rng() < 0.72 ? 1 : -1;
            _cofIndex = (_cofIndex + dir + COF_ROOTS.length) % COF_ROOTS.length;
            _nextModBar = bar + 128 + Math.floor(_rng() * 64);
        }

        // Overlapping warm polyphonic pad every 6..9 bars
        if (bar >= _nextPadBar) {
            const holdBars = 6 + Math.floor(_rng() * 4); // 6, 7, 8, or 9 bars
            _nextPadBar = bar + holdBars;
            const chordIdx = _advanceChordMarkov();
            const padLevel = vibe.padLevel * (0.75 + 0.35 * tide) * (inVoid ? 1.0 : 0.85) * pactEnergy;
            _schedWarmPadChord(_ac, time, chordIdx, holdBars * 16 * stepSecs, padLevel * 5.2, isLowReservoir);
        }
    }

    // 1. Warm Sub-Thump + Sidechain Breathing
    const subGrid = SUB_GRIDS[vibe.subStyle] || SUB_GRIDS.steady;
    let subVel = subGrid[step];
    // Evolving ghost thumps & breath dropouts driven by tide and bar parity
    const isExhaleBreath = !_pactPreviewActive && tide < 0.22 && (bar % 8 === 7);
    if (!isExhaleBreath) {
        if (subVel === 0 && (step === 10 || step === 14) && tide > 0.56 && _rng() < 0.24) {
            subVel = 0.34;
        }
        if (subVel > 0) {
            const thumpScale = vibe.subLevel * (inVoid ? 1.0 : 0.76) * pactSubScale * (0.82 + 0.28 * tide);
            const duckAmt = (inVoid ? 0.28 : 0.16) * pactSubScale;
            _schedSubThump(_ac, time, subVel, duckAmt, thumpScale / 0.42);
        }
    }

    // 2. Warm Melodic Root/Fifth Bass (follows active Markov chord root)
    const chord = CHORD_STATES[_chordState % CHORD_STATES.length];
    const bassHit = (step === 0 && _rng() < 0.85)
        || (step === 6 && _rng() < 0.55)
        || (step === 10 && tide > 0.35 && _rng() < 0.62)
        || (step === 14 && tide > 0.52 && _rng() < 0.38);
    if (bassHit && !isExhaleBreath) {
        const bassSemi = (step === 10 || step === 14) && _rng() < 0.45 ? chord.intervals[1] : chord.intervals[0];
        let bFreq = semiToFreq(_rootHz(), bassSemi);
        if (bFreq > 98) bFreq *= 0.5;
        const bDur = (step === 0) ? stepSecs * 3.8 : stepSecs * 2.1;
        const bLevel = (vibe.bassLevel / 0.15) * focusScale * pactEnergy * (0.72 + 0.35 * tide);
        _schedWarmBass(_ac, time, bFreq, bDur, bLevel);
    }

    // 3. Coprime Motif Voice A (7-step & 11-step Euclidean cycles — never repeats on bar lines)
    const phaseShift = Math.floor(bar / 19);
    const euclid7 = ((stepIndex + phaseShift) % 7 === 0) || ((stepIndex + phaseShift * 2) % 11 === 0);
    if (euclid7 && _rng() < (0.48 + 0.32 * tide)) {
        const degree = (stepIndex * 3 + phaseShift * 2 + Math.floor(_rng() * 3)) % vibe.scale.length;
        const oct = (_rng() < 0.35) ? 3 : 2;
        const mFreq = _scaleFreq(degree, oct);
        const pan = ((stepIndex % 5) - 2) * 0.28;
        const mLevel = (vibe.motifLevel / 0.068) * (inVoid ? 1.0 : 0.48) * pactMotifScale * (0.55 + 0.55 * tide);
        _schedWarmTine(_ac, time, mFreq, mLevel, pan);
    }

    // 4. Coprime Motif Voice B (13-step & 19-step airy shimmer halo)
    if ((stepIndex % 13 === 0 || stepIndex % 19 === 0) && tide > 0.38 && _rng() < 0.64) {
        const degree = (stepIndex * 5 + bar) % vibe.scale.length;
        const hFreq = _scaleFreq(degree, 3);
        const pan = ((stepIndex % 7) - 3) * 0.24;
        const hLevel = (vibe.sparkleLevel / 0.045) * (inVoid ? 1.0 : 0.38) * pactMotifScale * tide;
        _schedHarmonicBloom(_ac, time, hFreq, hLevel, pan);
    }

    // 5. Soft Velvet Pink-Noise Brush (gentle forward texture on upbeat 16ths)
    if ((step % 4 === 2) && tide > 0.36 && _rng() < 0.72) {
        const brushAmt = (vibe.brushLevel / 0.022) * (inVoid ? 1.0 : 0.35) * pactEnergy * tide;
        if (brushAmt > 0.08) _schedVelvetBrush(_ac, time, brushAmt);
    }
}

function _schedulerTick() {
    if (!_running || !_enabled || _spotifyYield || !_ac || _ac.state !== 'running') return;
    if (typeof document !== 'undefined' && document.hidden) {
        _nextStepTime = _ac.currentTime + 0.05;
        return;
    }
    if (_nextStepTime < _ac.currentTime - 0.25) {
        _nextStepTime = _ac.currentTime + 0.04;
    }
    const stepSecs = _stepSecs();
    while (_nextStepTime < _ac.currentTime + SCHEDULE_AHEAD_SECS) {
        // Subtle 3% micro-swing on odd 16th notes for natural human groove
        const swing = (_stepCounter % 2 === 1) ? stepSecs * 0.03 : 0;
        _scheduleStep(_stepCounter, _nextStepTime + swing);
        _nextStepTime += stepSecs;
        _stepCounter += 1;
    }
}

// ── Context, Reservoir & Pact Preview Modulation ────────────────────────────
function _applyHealthModulation() {
    if (!_ac || !_masterGain || !_toneFilter) return;
    const v = _readVitalsSafe();
    _lastVitals = v;
    const now = _ac.currentTime;
    const hidden = typeof document !== 'undefined' && document.hidden;

    if (!_enabled || _spotifyYield || hidden) {
        _masterGain.gain.setTargetAtTime(0.0001, now, _spotifyYield ? 0.08 : 0.12);
        return;
    }

    if (v.flatlined) {
        _masterGain.gain.setTargetAtTime(0.28, now, 0.25);
        _toneFilter.frequency.setTargetAtTime(_nyquistSafe(_ac, 320), now, 0.3);
        if (_pinkGain) _pinkGain.gain.setTargetAtTime(0.04, now, 0.3);
        if (_flatlineGain) _flatlineGain.gain.setTargetAtTime(0.035, now, 0.35);
        return;
    }

    if (_flatlineGain) _flatlineGain.gain.setTargetAtTime(0.0001, now, 0.15);

    const vibe = _vibe();
    const inVoid = _isVoidActive();
    const tide = _macroTide();

    let targetVol = inVoid ? 0.62 : (v.frozen ? 0.44 : 0.46);
    let targetCutoff = inVoid ? (3600 + tide * 1800) : 2400;
    let pinkGainTarget = vibe.pinkLevel * (inVoid ? (0.85 + 0.25 * tide) : 0.95);

    if (_pactPreviewActive) {
        const pv = clamp(_pactPreviewValue, 0, 100);
        const norm = pv / 100;
        targetVol = 0.44 + norm * 0.24;
        targetCutoff = pv <= 30 ? 1500 : (pv <= 62 ? 2700 : (pv <= 97 ? 4700 : 6200));
        pinkGainTarget = vibe.pinkLevel * (0.72 + norm * 0.40);
    }

    _masterGain.gain.setTargetAtTime(targetVol, now, 0.26);
    _toneFilter.frequency.setTargetAtTime(_nyquistSafe(_ac, targetCutoff), now, 0.28);
    if (_pinkGain) _pinkGain.gain.setTargetAtTime(pinkGainTarget, now, 0.28);
    if (_pinkLp) _pinkLp.frequency.setTargetAtTime(_nyquistSafe(_ac, vibe.pinkCutoff * (0.85 + 0.25 * tide)), now, 0.35);
}

function _startLoops() {
    if (_running || !_ac) return;
    _running = true;
    _nextStepTime = _ac.currentTime + 0.06;
    if (_schedulerTimer) clearInterval(_schedulerTimer);
    _schedulerTimer = setInterval(_schedulerTick, LOOKAHEAD_MS);
    if (_modTimer) clearInterval(_modTimer);
    _modTimer = setInterval(_applyHealthModulation, 350);
    _applyHealthModulation();
}

function _stopLoops() {
    _running = false;
    if (_schedulerTimer) { clearInterval(_schedulerTimer); _schedulerTimer = null; }
    if (_modTimer) { clearInterval(_modTimer); _modTimer = null; }
}

// ── UI Sync (Void HUD & Settings Vibe Picker) ───────────────────────────────
function _syncButtonUI() {
    if (typeof document === 'undefined') return;
    const vibe = _vibe();

    const btn = document.getElementById('hb-audio-btn');
    if (btn) {
        btn.classList.toggle('is-spotify-yield', _spotifyYield);
        if (_spotifyYield) {
            btn.classList.remove('is-audio-on');
            btn.classList.add('is-audio-off');
            btn.setAttribute('aria-pressed', 'false');
            btn.title = 'Flow audio yielded to Spotify — tap to take over';
            const lbl = btn.querySelector('.hb-audio-lbl');
            if (lbl) lbl.textContent = 'VOID OFF';
        } else {
            btn.classList.toggle('is-audio-on', _enabled);
            btn.classList.toggle('is-audio-off', !_enabled);
            btn.setAttribute('aria-pressed', _enabled ? 'true' : 'false');
            btn.title = _enabled ? 'Flow audio on — tap to mute' : 'Flow audio muted — tap to enable';
            const lbl = btn.querySelector('.hb-audio-lbl');
            if (lbl) lbl.textContent = _enabled ? 'AUDIO' : 'MUTED';
        }
    }

    const vibeBtn = document.getElementById('hb-vibe-btn');
    if (vibeBtn) {
        vibeBtn.dataset.vibe = vibe.id;
        vibeBtn.style.setProperty('--hb-vibe-accent', vibe.accent);
        vibeBtn.classList.toggle('is-dimmed', !_enabled || _spotifyYield);
        vibeBtn.title = `${vibe.name} — ${vibe.subtitle} (tap to switch)`;
        const vLbl = vibeBtn.querySelector('.hb-vibe-lbl');
        if (vLbl) vLbl.textContent = vibe.label;
    }

    const picker = document.getElementById('hb-vibe-picker');
    if (picker && typeof picker.querySelectorAll === 'function') {
        picker.querySelectorAll('[data-hb-vibe]').forEach((chip) => {
            const active = chip.dataset && chip.dataset.hbVibe === vibe.id;
            chip.classList.toggle('active', active);
            chip.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    const desc = document.getElementById('hb-vibe-desc');
    if (desc) desc.textContent = vibe.subtitle;
}

// ── Public Lifecycle & Vibe Controls ────────────────────────────────────────
export async function unlockAudio() {
    if (!_enabled) return false;
    if (_spotifyYield) {
        _activateIosAudioSession();
        return false;
    }
    _activateIosAudioSession();
    const ac = _ensureContext();
    if (!ac) return false;

    let resumePromise = null;
    if (ac.state !== 'running') {
        try { resumePromise = ac.resume(); } catch (_) {}
        _playSilentPulse(ac);
    }

    _buildGraph();

    if (resumePromise) {
        try { await resumePromise; } catch (_) {}
    }
    if (_spotifyYield) return false;
    if (ac.state === 'running') {
        if (!_running) {
            _startLoops();
            playBootIgnition();
        } else {
            _applyHealthModulation();
        }
        _syncButtonUI();
        return true;
    }
    return false;
}

export function setAudioEnabled(on) {
    _enabled = Boolean(on);
    _savePrefs(_enabled, _vibeId);
    _syncButtonUI();
    if (_enabled && !_spotifyYield) {
        unlockAudio();
    } else if (_ac && _masterGain) {
        try {
            _masterGain.gain.setTargetAtTime(0.0001, _ac.currentTime, 0.08);
        } catch (_) {}
        _stopLoops();
    }
    return _enabled;
}

export function setSpotifyYield(active) {
    const next = Boolean(active);
    const changed = next !== _spotifyYield;
    _spotifyYield = next;
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(SPOTIFY_YIELD_KEY, next ? '1' : '0');
        }
    } catch (_) {}
    if (next) {
        _setIosSessionType('ambient');
        if (_ac && _masterGain) {
            try {
                _masterGain.gain.setTargetAtTime(0.0001, _ac.currentTime, 0.08);
            } catch (_) {}
        }
        _stopLoops();
        _syncButtonUI();
    } else {
        _syncButtonUI();
        if (_enabled && (changed || !_running)) {
            unlockAudio();
        }
    }
    return _spotifyYield;
}

export function isSpotifyYielding() {
    return _spotifyYield;
}

export function toggleAudio() {
    if (_spotifyYield) {
        setSpotifyYield(false);
        setAudioEnabled(true);
        try {
            if (typeof window !== 'undefined' && window.SpotifyDeck && typeof window.SpotifyDeck.onVoidAudioReclaimed === 'function') {
                window.SpotifyDeck.onVoidAudioReclaimed();
            }
        } catch (_) {}
        playClick();
        return true;
    }
    const next = setAudioEnabled(!_enabled);
    if (next) playClick();
    return next;
}

export function isAudioEnabled() {
    return _enabled;
}

export function getVibe() {
    return _vibeId;
}

export function getVibes() {
    return VIBE_ORDER.map((id) => VIBES[id]);
}

export function setVibe(id) {
    const nextId = _normalizeVibeId(id);
    _vibeId = nextId;
    _savePrefs(_enabled, _vibeId);
    _syncButtonUI();

    const vibe = _vibe();
    if (_enabled && !_spotifyYield) {
        if (!_ac || _ac.state !== 'running') {
            unlockAudio();
        } else if (_graphBuilt) {
            const now = _ac.currentTime;
            const step = _stepSecs();
            try {
                if (_pinkGain) _pinkGain.gain.setTargetAtTime(vibe.pinkLevel, now, 0.35);
                if (_pinkLp) _pinkLp.frequency.setTargetAtTime(_nyquistSafe(_ac, vibe.pinkCutoff), now, 0.35);
                if (_reverbWet) _reverbWet.gain.setTargetAtTime(vibe.reverbWet, now, 0.35);
                if (_shimmerWet) _shimmerWet.gain.setTargetAtTime(vibe.shimmerWet, now, 0.35);
                if (_delayWet) _delayWet.gain.setTargetAtTime(vibe.delayWet, now, 0.35);
                if (_delayL) _delayL.delayTime.setTargetAtTime(clamp(step * 3, 0.05, 1.45), now, 0.25);
                if (_delayR) _delayR.delayTime.setTargetAtTime(clamp(step * 4.5, 0.05, 1.45), now, 0.25);
                if (_tapeDrive) _tapeDrive.curve = _makeTapeCurve(vibe.drive);
            } catch (_) {}
            _applyHealthModulation();
            // Gentle harmonic signature cue in the newly selected vibe
            try {
                _schedWarmTine(_ac, now + 0.02, _scaleFreq(2, 2), 0.75, -0.2);
                _schedHarmonicBloom(_ac, now + 0.09, _scaleFreq(4, 3), 0.8, 0.24);
            } catch (_) {}
        }
    }
    return _vibeId;
}

export function cycleVibe() {
    const idx = VIBE_ORDER.indexOf(_vibeId);
    const next = VIBE_ORDER[(idx + 1) % VIBE_ORDER.length];
    return setVibe(next);
}

// ── Tactile Precision SFX, Pact Slider Bass Bumps & Pact Seal ───────────────

function _resolveSfxCtx() {
    if (_enabled && !_spotifyYield) {
        const ac = _buildGraph();
        if (ac && ac.state === 'running') {
            return { ac, out: _sfxBus || ac.destination, rev: _reverbSend, del: _delaySend, isFxFallback: false };
        }
    }
    try {
        if (typeof window !== 'undefined' && window.FX && typeof window.FX.wantSound === 'function' && window.FX.wantSound()) {
            const fxAc = typeof window.FX.ctx === 'function' ? window.FX.ctx() : null;
            if (fxAc && fxAc.state === 'running') {
                return { ac: fxAc, out: fxAc.destination, rev: null, del: null, isFxFallback: true };
            }
        }
    } catch (_) {}
    return null;
}

/** Tactile ceramic / damped precision switch click. */
export function playClick() {
    if (!_enabled || _spotifyYield) return;
    const ac = _buildGraph();
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;

    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(64, now + 0.036);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.14, now + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    osc.connect(g).connect(_sfxBus || ac.destination);
    if (_reverbSend) g.connect(_reverbSend);
    osc.start(now);
    osc.stop(now + 0.058);

    if (_crispNoiseBuffer) {
        const src = ac.createBufferSource();
        src.buffer = _crispNoiseBuffer;
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2800;
        bp.Q.value = 1.9;
        const ng = ac.createGain();
        ng.gain.setValueAtTime(0.0001, now);
        ng.gain.linearRampToValueAtTime(0.055, now + 0.002);
        ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
        src.connect(bp).connect(ng).connect(_sfxBus || ac.destination);
        src.start(now, Math.random() * 0.2, 0.03);
    }
}

/** Warm 3-stage harmonic lock sound (Pact / Heartbeat feed). */
export function playChamberLoad() {
    if (!_enabled || _spotifyYield) return;
    const ac = _buildGraph();
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;

    // Warm sub pulse + ascending fifth/ninth harmonic lock
    const sub = ac.createOscillator();
    const sg = ac.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(118, now + 0.08);
    sub.frequency.exponentialRampToValueAtTime(44, now + 0.26);
    sg.gain.setValueAtTime(0.0001, now + 0.08);
    sg.gain.linearRampToValueAtTime(0.24, now + 0.09);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.30);
    sub.connect(sg).connect(_sfxBus || ac.destination);
    sub.start(now + 0.08);
    sub.stop(now + 0.32);

    [0, 2, 4].forEach((deg, idx) => {
        const f = _scaleFreq(deg, 2);
        _schedWarmTine(ac, now + idx * 0.045, f, 0.68 + idx * 0.12, (idx - 1) * 0.25);
    });
}

/** Luminous warm sub-bloom + Maj9 shimmer on audio ignition. */
export function playBootIgnition() {
    if (!_enabled || _spotifyYield) return;
    const ac = _buildGraph();
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;

    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(42, now);
    osc.frequency.exponentialRampToValueAtTime(_rootHz(), now + 0.35);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.22, now + 0.14);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.35);
    osc.connect(g).connect(_sfxBus || ac.destination);
    if (_reverbSend) g.connect(_reverbSend);
    osc.start(now);
    osc.stop(now + 1.4);

    [0, 2, 4, 6].forEach((deg, idx) => {
        _schedHarmonicBloom(ac, now + 0.04 + idx * 0.07, _scaleFreq(deg, 2), 0.72, (idx - 1.5) * 0.28);
    });
}

/** Soft low power-down drop on 0.0h Flatline. */
export function playFlatlineDrop() {
    if (!_enabled || _spotifyYield) return;
    const ac = _buildGraph();
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;

    const osc = ac.createOscillator();
    const lp = ac.createBiquadFilter();
    const g = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 1.0);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(380, now);
    lp.frequency.exponentialRampToValueAtTime(65, now + 1.0);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.22, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    osc.connect(lp).connect(g).connect(_sfxBus || ac.destination);
    if (_reverbSend) g.connect(_reverbSend);
    osc.start(now);
    osc.stop(now + 1.15);
}

/**
 * Tactile bass bumps + Lydian harmonic feedback as the Pact / Live Flow slider moves.
 * Fires subtle pitched sub-bumps on step drags and heavy gear-shift drops across 31 / 63 / 98.
 */
export function playSliderBump(value, prevValue, opts = {}) {
    const next = clamp(Math.round(Number(value) || 0), 0, 100);
    const prev = prevValue === undefined || prevValue === null ? next : clamp(Math.round(Number(prevValue) || 0), 0, 100);
    const nextZone = _zoneForSlider(next);
    const prevZone = _zoneForSlider(prev);
    const zoneChanged = nextZone !== prevZone;
    const hitEdge = (next === 0 || next === 100) && next !== prev;

    const nowMs = Date.now();
    if (!zoneChanged && !hitEdge && nowMs - _lastSliderBumpAt < 42) return;
    _lastSliderBumpAt = nowMs;

    // Ensure context wakes if user's first interaction is dragging the Pact slider
    if (_enabled && !_spotifyYield && (!_ac || _ac.state !== 'running')) {
        try { unlockAudio(); } catch (_) {}
    }

    const ctxInfo = _resolveSfxCtx();
    if (!ctxInfo) return;
    const { ac, out, rev, del, isFxFallback } = ctxInfo;
    const now = ac.currentTime;
    const norm = next / 100;
    const isUp = next >= prev;
    const ctxScale = opts && opts.context === 'live' ? 0.52 : 1.0;
    const fxVol = isFxFallback && typeof window !== 'undefined' && window.FX && typeof window.FX.vol === 'function'
        ? window.FX.vol() : 1.0;
    const scale = ctxScale * fxVol;

    // 1. Tactile Sub-Bass Bump (heavier & deeper as intensity climbs 0 -> 100)
    const sub = ac.createOscillator();
    const subG = ac.createGain();
    sub.type = 'sine';
    const startHz = isUp ? (90 + norm * 60) : (82 + norm * 35);
    const endHz = Math.max(30, 44 - norm * 10);
    sub.frequency.setValueAtTime(startHz, now);
    sub.frequency.exponentialRampToValueAtTime(endHz, now + (isUp ? 0.085 : 0.065));

    const subAmp = clamp((isUp ? (0.11 + norm * 0.21) : (0.07 + norm * 0.11)) * scale, 0.001, 0.38);
    subG.gain.setValueAtTime(0.0001, now);
    subG.gain.linearRampToValueAtTime(subAmp, now + 0.004);
    subG.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);

    sub.connect(subG).connect(out);
    sub.start(now);
    sub.stop(now + 0.15);

    // 2. Pitched Lydian Harmonic Tine mapped across 0..100
    const stepDeg = Math.min(11, Math.floor(norm * 12));
    const scaleArr = _vibe().scale;
    const oct = Math.floor(stepDeg / scaleArr.length) + 2;
    const deg = stepDeg % scaleArr.length;
    const tineFreq = _scaleFreq(deg, oct);

    const tine = ac.createOscillator();
    const tineLp = ac.createBiquadFilter();
    const tineG = ac.createGain();
    tine.type = isUp ? 'triangle' : 'sine';
    tine.frequency.setValueAtTime(tineFreq, now);
    tineLp.type = 'lowpass';
    tineLp.frequency.setValueAtTime(_nyquistSafe(ac, isUp ? (1400 + norm * 2400) : 950), now);
    const tineAmp = clamp((isUp ? (0.042 + norm * 0.045) : 0.028) * scale, 0.0005, 0.12);
    tineG.gain.setValueAtTime(0.0001, now);
    tineG.gain.linearRampToValueAtTime(tineAmp, now + 0.005);
    tineG.gain.exponentialRampToValueAtTime(0.0001, now + (isUp ? 0.24 : 0.12));

    tine.connect(tineLp).connect(tineG).connect(out);
    if (rev) tineG.connect(rev);
    if (del && isUp) tineG.connect(del);
    tine.start(now);
    tine.stop(now + 0.27);

    // 3. Zone-Crossing Gear-Shift Bass Drops (31 Steady / 63 Flow / 98 Hardcore)
    if (zoneChanged) {
        if (isUp) {
            if (nextZone === 1) {
                // Crossing 31 -> Steady: warm kick pulse + fifth chime
                const k = ac.createOscillator();
                const kg = ac.createGain();
                k.type = 'sine';
                k.frequency.setValueAtTime(118, now);
                k.frequency.exponentialRampToValueAtTime(46, now + 0.12);
                kg.gain.setValueAtTime(0.0001, now);
                kg.gain.linearRampToValueAtTime(0.24 * scale, now + 0.005);
                kg.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
                k.connect(kg).connect(out);
                k.start(now); k.stop(now + 0.20);
                try { if (window.FX?.haptic) window.FX.haptic([6]); } catch (_) {}
            } else if (nextZone === 2) {
                // Crossing 63 -> Flow: deep resonant thump + Maj9 shimmer bloom
                const k = ac.createOscillator();
                const kg = ac.createGain();
                k.type = 'sine';
                k.frequency.setValueAtTime(132, now);
                k.frequency.exponentialRampToValueAtTime(42, now + 0.16);
                kg.gain.setValueAtTime(0.0001, now);
                kg.gain.linearRampToValueAtTime(0.30 * scale, now + 0.005);
                kg.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
                k.connect(kg).connect(out);
                if (rev) kg.connect(rev);
                k.start(now); k.stop(now + 0.28);

                [0, 2, 4, 6].forEach((d, i) => {
                    const f = _scaleFreq(d, 2);
                    if (rev && !isFxFallback) {
                        _schedWarmTine(ac, now + i * 0.032, f, 0.72 * scale, (i - 1.5) * 0.28);
                    }
                });
                try { if (window.FX?.haptic) window.FX.haptic([10, 20, 12]); } catch (_) {}
            } else if (nextZone === 3) {
                // Crossing 98 -> Hardcore: heavy sub-drop + warm mid-punch + harmonic lock
                duck(0.45, 0.5);
                const drop = ac.createOscillator();
                const punch = ac.createOscillator();
                const dg = ac.createGain();
                const pg = ac.createGain();

                drop.type = 'sine';
                drop.frequency.setValueAtTime(148, now);
                drop.frequency.exponentialRampToValueAtTime(34, now + 0.22);
                dg.gain.setValueAtTime(0.0001, now);
                dg.gain.linearRampToValueAtTime(0.38 * scale, now + 0.004);
                dg.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

                punch.type = 'triangle';
                punch.frequency.setValueAtTime(220, now);
                punch.frequency.exponentialRampToValueAtTime(66, now + 0.075);
                pg.gain.setValueAtTime(0.0001, now);
                pg.gain.linearRampToValueAtTime(0.18 * scale, now + 0.003);
                pg.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

                drop.connect(dg).connect(out);
                punch.connect(pg).connect(out);
                if (rev) dg.connect(rev);
                drop.start(now); punch.start(now);
                drop.stop(now + 0.36); punch.stop(now + 0.11);

                [4, 6, 7].forEach((d, i) => {
                    const f = _scaleFreq(d, 2);
                    if (rev && !isFxFallback) {
                        _schedWarmTine(ac, now + 0.015 + i * 0.025, f, 0.92 * scale, (i - 1) * 0.35);
                    }
                });
                try { if (window.FX?.haptic) window.FX.haptic([18, 25, 28]); } catch (_) {}
            }
        } else {
            // Downward zone release thud
            const rel = ac.createOscillator();
            const rg = ac.createGain();
            rel.type = 'sine';
            rel.frequency.setValueAtTime(92, now);
            rel.frequency.exponentialRampToValueAtTime(38, now + 0.11);
            rg.gain.setValueAtTime(0.0001, now);
            rg.gain.linearRampToValueAtTime(0.14 * scale, now + 0.006);
            rg.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
            rel.connect(rg).connect(out);
            rel.start(now); rel.stop(now + 0.17);
        }
    }
}

/** Live soundscape reactivity while the Pact Sign modal is open. */
export function setPactPreview(active, value) {
    _pactPreviewActive = Boolean(active);
    if (value !== undefined && value !== null) {
        _pactPreviewValue = clamp(Math.round(Number(value) || 0), 0, 100);
    }
    _applyHealthModulation();
}

/** Resolving Pact Seal bass-drop + warm Maj9 chord bloom when signing the Pact. */
export function playPactSeal(sliderValue) {
    const val = clamp(Math.round(Number(sliderValue) || 72), 0, 100);
    const isHardcore = val >= 98;
    if (!_enabled || _spotifyYield) return false;
    const ac = _buildGraph();
    if (!ac || ac.state !== 'running') return false;

    const now = ac.currentTime;
    duck(0.85, 0.35);

    const drop = ac.createOscillator();
    const dg = ac.createGain();
    drop.type = 'sine';
    drop.frequency.setValueAtTime(isHardcore ? 142 : 124, now);
    drop.frequency.exponentialRampToValueAtTime(36, now + 0.28);
    dg.gain.setValueAtTime(0.0001, now);
    dg.gain.linearRampToValueAtTime(isHardcore ? 0.38 : 0.30, now + 0.008);
    dg.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    drop.connect(dg).connect(_sfxBus || ac.destination);
    if (_reverbSend) dg.connect(_reverbSend);
    drop.start(now);
    drop.stop(now + 0.48);

    const degrees = isHardcore ? [0, 2, 4, 6, 8] : [0, 2, 4, 6];
    degrees.forEach((d, idx) => {
        const f = _scaleFreq(d, idx >= 3 ? 3 : 2);
        _schedWarmTine(ac, now + 0.02 + idx * 0.055, f, 0.85, (idx - 1.5) * 0.3);
        _schedHarmonicBloom(ac, now + 0.06 + idx * 0.06, f, isHardcore ? 0.95 : 0.72, (idx - 1.5) * 0.32);
    });
    return true;
}

/** Briefly duck the ambient bed so heavy UI SFX cut cleanly through. */
export function duck(secs = 0.75, floor = 0.32) {
    if (!_enabled || _spotifyYield || !_ac || !_duckBus || _ac.state !== 'running') return;
    try {
        const now = _ac.currentTime;
        const hold = clamp(Number(secs) || 0.75, 0.15, 3.0);
        const rawFloor = Number(floor);
        const targetFloor = Number.isFinite(rawFloor) ? clamp(rawFloor, 0.05, 0.92) : 0.32;
        _duckBus.gain.cancelScheduledValues(now);
        _duckBus.gain.setValueAtTime(_duckBus.gain.value, now);
        _duckBus.gain.linearRampToValueAtTime(targetFloor, now + 0.025);
        _duckBus.gain.exponentialRampToValueAtTime(1.0, now + hold);
    } catch (_) {}
}

// ── Gesture Unlock & Foreground Resume ──────────────────────────────────────
function _bindUnlockGestures() {
    if (_boundGestures || typeof document === 'undefined') return;
    _boundGestures = true;

    const onGesture = (e) => {
        if (!_enabled || _spotifyYield) return;
        const target = e && e.target;
        if (target && typeof target.closest === 'function' && target.closest('#hb-audio-btn, #hb-vibe-btn')) return;
        if (!_ac || _ac.state !== 'running' || !_running) {
            unlockAudio();
        }
    };

    document.addEventListener('touchend', onGesture, { capture: true, passive: true });
    document.addEventListener('click', onGesture, { capture: true, passive: true });
    document.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
    document.addEventListener('touchstart', onGesture, { capture: true, passive: true });
    document.addEventListener('keydown', onGesture, { capture: true, passive: true });

    const onForeground = () => {
        if (_spotifyYield) {
            _setIosSessionType('ambient');
            _applyHealthModulation();
            return;
        }
        if (_enabled && _ac && !(typeof document !== 'undefined' && document.hidden)) {
            if (_ac.state !== 'running') {
                try { _ac.resume().catch(() => {}); } catch (_) {}
            }
        }
        _applyHealthModulation();
    };
    document.addEventListener('visibilitychange', onForeground);
    if (typeof window !== 'undefined') {
        window.addEventListener('pageshow', onForeground);
        window.addEventListener('focus', onForeground);
    }
}

export function initHeartbeatAudio() {
    _syncButtonUI();
    _bindUnlockGestures();
    if (typeof document === 'undefined') return;

    const audioBtn = document.getElementById('hb-audio-btn');
    if (audioBtn && !audioBtn.dataset.hbAudioBound) {
        audioBtn.dataset.hbAudioBound = '1';
        audioBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleAudio();
        });
    }

    const vibeBtn = document.getElementById('hb-vibe-btn');
    if (vibeBtn && !vibeBtn.dataset.hbVibeBound) {
        vibeBtn.dataset.hbVibeBound = '1';
        vibeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            cycleVibe();
        });
    }

    const picker = document.getElementById('hb-vibe-picker');
    if (picker && !picker.dataset.hbPickerBound) {
        picker.dataset.hbPickerBound = '1';
        picker.addEventListener('click', (e) => {
            const chip = e.target && e.target.closest ? e.target.closest('[data-hb-vibe]') : null;
            if (!chip) return;
            setVibe(chip.dataset.hbVibe);
        });
    }
}

_bindUnlockGestures();

export const HeartbeatAudio = {
    init: initHeartbeatAudio,
    unlock: unlockAudio,
    toggle: toggleAudio,
    setEnabled: setAudioEnabled,
    isEnabled: isAudioEnabled,
    setSpotifyYield,
    isSpotifyYielding,
    VIBES,
    getVibe,
    getVibes,
    setVibe,
    cycleVibe,
    playClick,
    playChamberLoad,
    playBootIgnition,
    playFlatlineDrop,
    playSliderBump,
    setPactPreview,
    playPactSeal,
    duck,
};

try {
    if (typeof window !== 'undefined') window.HeartbeatAudio = HeartbeatAudio;
} catch (_) {}
