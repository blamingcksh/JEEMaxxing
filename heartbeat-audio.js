/**
 * heartbeat-audio.js — Studio-Grade Infinite Evolutionary Flow Soundscape Engine (v2)
 *
 * Built for multi-hour zero-fatigue deep analytical flow (JEE Advanced):
 *   - 100% procedural offline Web Audio synthesis (zero external files, iPad Safari/PWA tuned)
 *   - True stereo DSP chain:
 *       * Seamless dual-layer 22s stereo decorrelated Velvet Brown noise (-6 dB/oct, DC-blocked,
 *         2.5s equal-power crossfade, staggered coprime playback — zero harshness, zero loop bumps)
 *       * 3.6s diffused stereo Velvet Hall Convolver IR with Haas early reflections & progressive air damping
 *       * True L/R stereo Ping-Pong Tape Delay (ChannelMergerNode — zero mono collapse)
 *       * True Octave-Up (+12 / +19) Bowed Shimmer Halo through chorus-modulated stereo delays into Velvet Hall
 *       * Studio mastering bus: 32Hz sub-guard, 110Hz speaker warmth, 310Hz mud dip, 6.2kHz anti-fatigue shelf,
 *         asymmetric analog tape saturation, glue compressor, separate direct sub-kick bus + sidechain breathing
 *   - True musical non-repetition for hours:
 *       * Smooth 4-voice Markov voice-leading analog ensemble pads (3 detuned oscs + breathing resonant LPF)
 *       * Evolving melodic motif cells (mutates 1-2 notes every 4 bars — hypnotic hook, never loops)
 *       * Vibe-specific instruments (Prophet felt-pluck, celesta harmonics, resonant arp, vintage Rhodes/kalimba)
 *       * Rolling muted Moog-style melodic bassline + felt-mallet sub-thump + organic wood/velvet micro-percussion
 *       * 5-Chapter generative arrangement director (ignition → lock → ascent → peak → exhale) with
 *         2-bar pink-noise breath risers, clean drops, and Circle-of-Fifths modulation during Exhale tides
 *   - Neuroscience-grade Flow State Engine (v3):
 *       * Rapid Neural Amplitude Modulation (Woods et al. 2024): subtle phase-coherent 15–16.5 Hz Low-Beta/SMR
 *         (Aperture, Kinetic) and 10–10.8 Hz Alpha (Aether, Solstice) AM woven into the stereo pad/reverb/shimmer
 *         space (never on bass or noise, zero harsh binaural whine)
 *       * Solving-Mode Flow Plateau: suppresses mid-question beat drop-outs & risers while actively solving
 *       * Deep-Think Auto-Cocoon: >60s into a hard problem, progressively softens foreground plucks & deepens
 *         Beta/Alpha AM + velvet brown masking; subtle harmonic Solve Bloom on correct answers & streaks
 */

const PREFS_KEY = 'jeemax_hb_audio_v1';

const SCHEDULE_AHEAD_SECS = 0.14;
const LOOKAHEAD_MS = 25;
const SILENT_WAV_URI = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

// Circle-of-Fifths bass root pitches in MIDI (D2=38, A1=33, E2=40, B1=35, F#1=30->F#2=42, C#2=37, G#1->Ab1=32, Eb2=39, Bb1=34, F1->F2=41, C2=36, G1=31)
const COF_ROOT_MIDI = [38, 33, 40, 35, 42, 37, 32, 39, 34, 41, 36, 31];

export const VIBE_ORDER = ['aperture', 'aether', 'kinetic', 'solstice'];

export const VIBES = Object.freeze({
    aperture: Object.freeze({
        id: 'aperture',
        name: 'Aperture',
        label: 'APERTURE',
        subtitle: 'Deep analytical flow · 108 BPM · Light felt pulse, warm melodic bass & airy velvet bed',
        bpm: 108,
        scale: [0, 2, 4, 6, 7, 9, 11, 14, 16], // Lydian Add9
        motifLen: 12,
        leadTimbre: 'prophetPluck',
        bassStyle: 'rolling',
        subStyle: 'steady',
        neuralAmHz: 15.0,    // Subliminal Low-Beta / SMR sustained attention peak
        neuralAmDepth: 0.08,
        atmosLevel: 0.095,
        atmosCutoff: 450,
        subLevel: 0.30,
        bassLevel: 0.16,
        padLevel: 0.17,
        motifLevel: 0.095,
        shimmerLevel: 0.24,
        reverbWet: 0.42,
        delayWet: 0.28,
        percLevel: 0.020,
        drive: 3.5,
        accent: '#7dd3fc',
        chords: [
            { name: 'Imaj9',     pcs: [0, 4, 7, 11, 2],  next: [[1, 0.32], [3, 0.30], [4, 0.24], [5, 0.14]] },
            { name: 'IIadd9',    pcs: [2, 6, 9, 4, 11],  next: [[2, 0.40], [4, 0.34], [0, 0.26]] },
            { name: 'Vadd9',     pcs: [7, 11, 2, 9, 4],  next: [[0, 0.50], [3, 0.30], [5, 0.20]] },
            { name: 'VImin9',    pcs: [9, 0, 4, 7, 11],  next: [[4, 0.42], [1, 0.32], [2, 0.26]] },
            { name: 'IVmaj7#11', pcs: [5, 9, 0, 4, 11],  next: [[0, 0.38], [2, 0.38], [5, 0.24]] },
            { name: 'Isus2',     pcs: [0, 2, 7, 11, 4],  next: [[0, 0.28], [4, 0.36], [1, 0.20], [3, 0.16]] },
        ],
    }),
    aether: Object.freeze({
        id: 'aether',
        name: 'Aether',
        label: 'AETHER',
        subtitle: 'Weightless drift · 84 BPM · Breathable analog pads, whisper ocean & celestial shimmer',
        bpm: 84,
        scale: [0, 2, 4, 6, 7, 9, 11, 14, 18], // Wide Lydian Maj9#11
        motifLen: 13,
        leadTimbre: 'feltCelesta',
        bassStyle: 'dronePulse',
        subStyle: 'heartbeat',
        neuralAmHz: 10.0,    // Subliminal Alpha relaxed conceptual insight
        neuralAmDepth: 0.075,
        atmosLevel: 0.125,
        atmosCutoff: 390,
        subLevel: 0.22,
        bassLevel: 0.11,
        padLevel: 0.21,
        motifLevel: 0.075,
        shimmerLevel: 0.38,
        reverbWet: 0.56,
        delayWet: 0.30,
        percLevel: 0.008,
        drive: 2.5,
        accent: '#c4b5fd',
        chords: [
            { name: 'Imaj9#11',  pcs: [0, 4, 7, 11, 6],  next: [[1, 0.35], [2, 0.35], [3, 0.30]] },
            { name: 'IVmaj9',    pcs: [5, 9, 0, 4, 7],   next: [[0, 0.42], [3, 0.34], [4, 0.24]] },
            { name: 'IIImin9',   pcs: [4, 7, 11, 2, 6],  next: [[1, 0.45], [3, 0.35], [0, 0.20]] },
            { name: 'VImin11',   pcs: [9, 0, 4, 7, 2],   next: [[1, 0.40], [4, 0.35], [0, 0.25]] },
            { name: 'V6/9',      pcs: [7, 11, 2, 4, 9],  next: [[0, 0.58], [2, 0.22], [3, 0.20]] },
        ],
    }),
    kinetic: Object.freeze({
        id: 'kinetic',
        name: 'Kinetic',
        label: 'KINETIC',
        subtitle: 'Forward velocity · 122 BPM · Crisp light pulse, buoyant bass & Mixolydian arps',
        bpm: 122,
        scale: [0, 2, 4, 7, 9, 10, 14, 16], // Bright Mixolydian Add9
        motifLen: 8,
        leadTimbre: 'analogArp',
        bassStyle: 'syncopated',
        subStyle: 'drive',
        neuralAmHz: 16.5,    // Subliminal Mid-Beta alertness
        neuralAmDepth: 0.085,
        atmosLevel: 0.075,
        atmosCutoff: 510,
        subLevel: 0.35,
        bassLevel: 0.18,
        padLevel: 0.14,
        motifLevel: 0.105,
        shimmerLevel: 0.18,
        reverbWet: 0.32,
        delayWet: 0.26,
        percLevel: 0.030,
        drive: 5.0,
        accent: '#6ee7b7',
        chords: [
            { name: 'Iadd9',     pcs: [0, 4, 7, 2, 10],  next: [[1, 0.36], [2, 0.34], [3, 0.30]] },
            { name: 'bVIImaj9',  pcs: [10, 2, 5, 9, 0],  next: [[2, 0.42], [0, 0.38], [4, 0.20]] },
            { name: 'IVadd9',    pcs: [5, 9, 0, 7, 2],   next: [[0, 0.44], [3, 0.32], [4, 0.24]] },
            { name: 'Vmin9',     pcs: [7, 10, 2, 5, 9],  next: [[2, 0.40], [1, 0.35], [0, 0.25]] },
            { name: 'IImin9',    pcs: [2, 5, 9, 0, 4],   next: [[3, 0.45], [0, 0.35], [2, 0.20]] },
        ],
    }),
    solstice: Object.freeze({
        id: 'solstice',
        name: 'Solstice',
        label: 'SOLSTICE',
        subtitle: 'Golden analog warmth · 98 BPM · Vintage Rhodes tines, airy sub & sunlit Maj9 bloom',
        bpm: 98,
        scale: [0, 2, 4, 7, 9, 11, 14, 16], // Golden Major 9 / Pentatonic-Add9
        motifLen: 11,
        leadTimbre: 'vintageRhodes',
        bassStyle: 'warmGroove',
        subStyle: 'warm',
        neuralAmHz: 10.8,    // Subliminal Upper-Alpha creative flow
        neuralAmDepth: 0.075,
        atmosLevel: 0.10,
        atmosCutoff: 470,
        subLevel: 0.27,
        bassLevel: 0.15,
        padLevel: 0.19,
        motifLevel: 0.105,
        shimmerLevel: 0.30,
        reverbWet: 0.46,
        delayWet: 0.30,
        percLevel: 0.018,
        drive: 3.0,
        accent: '#fcd34d',
        chords: [
            { name: 'Imaj9',     pcs: [0, 4, 7, 11, 2],  next: [[1, 0.36], [2, 0.34], [3, 0.30]] },
            { name: 'IVmaj9',    pcs: [5, 9, 0, 4, 7],   next: [[0, 0.34], [4, 0.38], [2, 0.28]] },
            { name: 'VImin9',    pcs: [9, 0, 4, 7, 11],  next: [[1, 0.42], [3, 0.34], [4, 0.24]] },
            { name: 'IImin9',    pcs: [2, 5, 9, 0, 4],   next: [[4, 0.52], [1, 0.26], [0, 0.22]] },
            { name: 'V9sus4',    pcs: [7, 0, 2, 5, 9],   next: [[0, 0.62], [2, 0.22], [1, 0.16]] },
        ],
    }),
});

// Arrangement Chapters (non-repeating evolving journey; starts directly in 'lock' so first 3s feel lush & engaging)
const CHAPTER_SPEC = {
    ignition: { minBars: 8,  maxBars: 12, sub: 0.25, bass: 0.35, motif: 0.55, pad: 0.95, shimmer: 0.70, perc: 0.15, filter: 0.58, next: [['lock', 0.80], ['ascent', 0.20]] },
    lock:     { minBars: 16, maxBars: 24, sub: 0.95, bass: 0.92, motif: 0.72, pad: 0.88, shimmer: 0.55, perc: 0.65, filter: 0.76, next: [['ascent', 0.72], ['peak', 0.28]] },
    ascent:   { minBars: 16, maxBars: 24, sub: 1.00, bass: 1.00, motif: 0.96, pad: 0.96, shimmer: 0.82, perc: 0.88, filter: 0.90, next: [['peak', 0.78], ['exhale', 0.22]] },
    peak:     { minBars: 16, maxBars: 28, sub: 1.06, bass: 1.05, motif: 1.08, pad: 1.06, shimmer: 1.08, perc: 1.00, filter: 1.00, next: [['exhale', 0.74], ['lock', 0.26]] },
    exhale:   { minBars: 8,  maxBars: 12, sub: 0.08, bass: 0.22, motif: 0.42, pad: 1.10, shimmer: 1.15, perc: 0.08, filter: 0.52, next: [['lock', 0.82], ['ignition', 0.18]] },
};

// Sub-thump 16-step groove patterns per vibe subStyle
const SUB_GRIDS = {
    steady:    [1.0, 0, 0, 0,   0.86, 0, 0, 0.22,  0.96, 0, 0, 0,   0.88, 0, 0.28, 0],
    heartbeat: [0.95, 0, 0, 0,  0, 0, 0.34, 0,     0, 0, 0, 0,      0.62, 0, 0, 0],
    drive:     [1.0, 0, 0, 0.24, 0.94, 0, 0, 0.30, 0.98, 0, 0.24, 0, 0.92, 0, 0.38, 0.20],
    warm:      [1.0, 0, 0, 0,   0.78, 0, 0.26, 0,  0.92, 0, 0, 0,   0.80, 0, 0.32, 0],
};

// Breathable melodic bass velocity patterns (open air between notes — never heavy 16th-note club pressure)
const BASS_GRIDS = {
    rolling:    [0.86, 0,    0.42, 0,     0,    0,    0.64, 0,     0.80, 0,    0.48, 0,     0,    0,    0.66, 0],
    dronePulse: [0.82, 0,    0,    0,     0,    0,    0.48, 0,     0.72, 0,    0,    0,     0,    0,    0.42, 0],
    syncopated: [0.88, 0,    0,    0.58,  0,    0,    0.70, 0,     0.82, 0,    0.52, 0,     0,    0,    0.72, 0],
    warmGroove: [0.84, 0,    0,    0,     0.38, 0,    0.62, 0,     0.78, 0,    0.44, 0,     0,    0,    0.64, 0],
};

// Organic micro-percussion velocity grids (16 steps — sparse silky offbeats, zero constant hiss)
const SHAKER_GRID = [0,    0,    0.46, 0,     0,    0,    0.52, 0,     0,    0,    0.44, 0,     0,    0,    0.54, 0.18];
const RIM_GRID    = [0,    0,    0,    0.45,  0,    0,    0.62, 0,     0,    0.35, 0,    0,     0,    0,    0.58, 0.28];

// ── Math & PRNG Helpers ─────────────────────────────────────────────────────
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

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

// ── Module State ────────────────────────────────────────────────────────────
const _initPrefs = _loadPrefs();
let _enabled = _initPrefs.enabled;
let _vibeId = _initPrefs.vibe;

let _ac = null;
let _graphBuilt = false;
let _iosUnlockAudio = null;
let _iosSessionActivated = false;
let _running = false;
let _boundGestures = false;
let _lastVitals = null;

// DSP Bus Nodes
let _masterGain = null;
let _toneFilter = null;
let _duckBus = null;
let _bedDuckGain = null;
let _subDirectBus = null;
let _sfxBus = null;
let _warmthEq = null;
let _tapeDrive = null;
let _atmosGain = null;
let _atmosLpA = null;
let _atmosLpB = null;
let _reverbSend = null;
let _reverbWet = null;
let _shimmerSend = null;
let _shimmerWet = null;
let _neuralAmBus = null;
let _neuralAmOsc = null;
let _neuralAmDepthGain = null;
let _delaySend = null;
let _delayWet = null;
let _delayL = null;
let _delayR = null;
let _flatlineGain = null;
let _analyserL = null;
let _analyserR = null;

// Pre-built Buffers
let _velvetBrownBuffer = null;
let _crispNoiseBuffer = null;

// Sequencer & Generative Arrangement State
let _schedulerTimer = null;
let _modTimer = null;
let _watchdogTimer = null;
let _nextStepTime = 0;
let _stepCounter = 0;
let _barCount = 0;
let _nextPadBar = 0;
let _chordIdx = 0;
let _voicingMidi = [50, 57, 61, 64]; // D3, A3, C#4, E4 warm midrange seed
let _chapter = 'lock';
let _chapterStartBar = 0;
let _chapterEndBar = 18;
let _swellFiredForBar = -1;
let _sessionStartedAt = Date.now();
let _lastSliderBumpAt = 0;

// Long-session iOS/WebKit stability state (zero leaks, zero param-timeline bloat, stall self-heal)
let _paramLast = Object.create(null);
let _lastWatchTime = -1;
let _stallCount = 0;
let _rebuilds = 0;
let _voicesCleaned = 0;
let _iosKeepaliveUrl = null;
let _rebuilding = false;

// Session PRNG & evolutionary fingerprint
let _rng = _mulberry32((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
let _cofIndex = Math.floor(_rng() * COF_ROOT_MIDI.length);
let _tidePhases = [_rng() * Math.PI * 2, _rng() * Math.PI * 2, _rng() * Math.PI * 2];
let _tempoOffsetBpm = (_rng() - 0.5) * 2.0; // subtle ±1 BPM unique session fingerprint
let _motifCell = [];

// Pact preview, Mario recap blend & live neural-flow solve state
let _pactPreviewActive = false;
let _pactPreviewValue = 72;
let _recapDuckActive = false;
let _solveBloomUntil = 0;
let _solveBloomStrength = 0;
let _lastCocoonLevel = 0;
let _lastSolvingActive = false;
let _plateauNextModBar = 112;
const _fallbackSfxMap = typeof WeakMap === 'function' ? new WeakMap() : null;

// ── Vibe, Pitch, Voice-Leading & Motif Evolution Engines ────────────────────
function _vibe() {
    return VIBES[_vibeId] || VIBES.aperture;
}

function _rootMidi() {
    return COF_ROOT_MIDI[_cofIndex % COF_ROOT_MIDI.length];
}

function _rootHz() {
    return midiToFreq(_rootMidi());
}

function _stepSecs() {
    const bpm = clamp(_vibe().bpm + _tempoOffsetBpm, 72, 136);
    return 60 / bpm / 4;
}

function _macroTide(elapsedSecs) {
    const t = Math.max(0, elapsedSecs || ((Date.now() - _sessionStartedAt) / 1000));
    const w = 0.52
        + 0.26 * Math.sin(t / 67 + _tidePhases[0])
        + 0.14 * Math.sin(t / 113 + _tidePhases[1])
        + 0.08 * Math.sin(t / 191 + _tidePhases[2]);
    return clamp(w, 0.10, 1.0);
}

function _scaleMidi(degreeIdx, octaveOffset = 0) {
    const scale = _vibe().scale;
    const idx = ((degreeIdx % scale.length) + scale.length) % scale.length;
    return _rootMidi() + scale[idx] + octaveOffset * 12;
}

function _scaleFreq(degreeIdx, octaveOffset = 0) {
    return midiToFreq(_scaleMidi(degreeIdx, octaveOffset));
}

/**
 * Smooth 4-voice greedy minimum-distance voice-leading within warm midrange [50..74].
 * Keeps common tones anchored and glides inner voices by 1-2 semitones.
 */
function _voiceLeadChord(targetPcs, rootMidi, prevVoicing) {
    const lo = 50;
    const hi = 74;
    const desired = targetPcs.slice(0, 4).map((pc) => ((rootMidi + pc) % 12 + 12) % 12);
    const prev = Array.isArray(prevVoicing) && prevVoicing.length === 4 ? prevVoicing : [50, 57, 62, 66];
    const used = new Set();
    const out = [];

    for (let i = 0; i < 4; i++) {
        const ref = prev[i];
        let bestPitch = null;
        let bestScore = Infinity;
        let bestPcIdx = -1;

        for (let pIdx = 0; pIdx < desired.length; pIdx++) {
            if (used.has(pIdx)) continue;
            const pc = desired[pIdx];
            // Search candidate octaves in [lo..hi]
            for (let m = lo; m <= hi; m++) {
                if (((m % 12) + 12) % 12 !== pc) continue;
                const dist = Math.abs(m - ref);
                // Slight bias to keep voice order nicely spread
                const idealCenter = 54 + i * 5;
                const score = dist + Math.abs(m - idealCenter) * 0.18;
                if (score < bestScore) {
                    bestScore = score;
                    bestPitch = m;
                    bestPcIdx = pIdx;
                }
            }
        }
        if (bestPcIdx >= 0) used.add(bestPcIdx);
        out.push(bestPitch !== null ? bestPitch : clamp(ref, lo, hi));
    }

    out.sort((a, b) => a - b);
    // Avoid muddy close minor-2nd clusters in bottom register
    for (let i = 1; i < out.length; i++) {
        if (out[i] - out[i - 1] < 2) {
            if (out[i] + 12 <= hi + 4) out[i] += 12;
        }
    }
    return out.sort((a, b) => a - b);
}

/** Build a musical seeded motif cell with natural melodic contour & groove accents. */
function _seedMotifCell(vibeObj) {
    const v = vibeObj || _vibe();
    const len = v.motifLen || 12;
    const scaleLen = v.scale.length;
    const cell = [];
    // Pick a melodic contour archetype: rising wave, descending cascade, arch, or syncopated hook
    const archetype = Math.floor(_rng() * 4);
    let cursor = Math.floor(_rng() * 3);

    for (let i = 0; i < len; i++) {
        const isAnchor = (i === 0 || i === Math.floor(len / 2));
        const density = v.id === 'aether' ? 0.36 : (v.id === 'kinetic' ? 0.74 : 0.62);
        const active = isAnchor || _rng() < density;
        if (!active) {
            cell.push(null);
            continue;
        }
        if (archetype === 0) cursor = (cursor + (i % 3 === 0 ? 2 : 1)) % scaleLen;
        else if (archetype === 1) cursor = (cursor + scaleLen - (i % 2 === 0 ? 1 : 2)) % scaleLen;
        else if (archetype === 2) cursor = (i < len / 2) ? (cursor + 1) % scaleLen : (cursor + scaleLen - 1) % scaleLen;
        else cursor = isAnchor ? (i === 0 ? 0 : 4) % scaleLen : (cursor + 1 + Math.floor(_rng() * 2)) % scaleLen;

        cell.push({
            deg: cursor,
            oct: (i % 4 === 3 && _rng() < 0.4) ? 3 : 2,
            vel: isAnchor ? 0.95 : (0.52 + _rng() * 0.38),
            pan: ((i % 5) - 2) * 0.28,
        });
    }
    return cell;
}

/** Gently evolve 1-2 slots of the motif cell every 4 bars: hypnotic hook + infinite drift. */
function _mutateMotifCell() {
    const v = _vibe();
    if (!_motifCell || _motifCell.length !== v.motifLen) {
        _motifCell = _seedMotifCell(v);
        return;
    }
    const scaleLen = v.scale.length;
    const mutations = _rng() < 0.4 ? 2 : 1;
    for (let m = 0; m < mutations; m++) {
        const slot = Math.floor(_rng() * _motifCell.length);
        const cur = _motifCell[slot];
        if (!cur) {
            // Wake a rest into a graceful neighboring tone
            if (_rng() < 0.55) {
                _motifCell[slot] = {
                    deg: Math.floor(_rng() * scaleLen),
                    oct: _rng() < 0.35 ? 3 : 2,
                    vel: 0.48 + _rng() * 0.38,
                    pan: ((slot % 5) - 2) * 0.28,
                };
            }
        } else if (slot > 0 && _rng() < 0.24) {
            // Rest a non-anchor slot for breathing room
            _motifCell[slot] = null;
        } else {
            // Step degree by ±1 or ±2 (melodic continuity)
            const delta = _rng() < 0.5 ? 1 : -1;
            cur.deg = ((cur.deg + delta) % scaleLen + scaleLen) % scaleLen;
            if (_rng() < 0.2) cur.oct = cur.oct === 2 ? 3 : 2;
            cur.vel = clamp(cur.vel + (_rng() - 0.5) * 0.18, 0.42, 0.98);
        }
    }
}

function _advanceChordMarkov() {
    const chords = _vibe().chords;
    const cur = chords[_chordIdx % chords.length];
    const r = _rng();
    let acc = 0;
    let next = cur.next[0][0];
    for (let i = 0; i < cur.next.length; i++) {
        acc += cur.next[i][1];
        if (r <= acc) { next = cur.next[i][0]; break; }
    }
    _chordIdx = next % chords.length;
    const target = chords[_chordIdx];
    _voicingMidi = _voiceLeadChord(target.pcs, _rootMidi(), _voicingMidi);
    return target;
}

function _advanceChapter(bar) {
    const spec = CHAPTER_SPEC[_chapter] || CHAPTER_SPEC.lock;
    const r = _rng();
    let acc = 0;
    let nextChap = spec.next[0][0];
    for (let i = 0; i < spec.next.length; i++) {
        acc += spec.next[i][1];
        if (r <= acc) { nextChap = spec.next[i][0]; break; }
    }
    _chapter = nextChap;
    const nextSpec = CHAPTER_SPEC[_chapter] || CHAPTER_SPEC.lock;
    _chapterStartBar = bar;
    const span = nextSpec.minBars + Math.floor(_rng() * (nextSpec.maxBars - nextSpec.minBars + 1));
    _chapterEndBar = bar + span;

    // Entering Exhale: smoothly modulate one step along Circle of Fifths + refresh motif contour
    if (_chapter === 'exhale') {
        const dir = _rng() < 0.72 ? 1 : -1;
        _cofIndex = (_cofIndex + dir + COF_ROOT_MIDI.length) % COF_ROOT_MIDI.length;
        _mutateMotifCell();
    }
    return _chapter;
}

// Seed initial motif & voice-leading state cleanly
_motifCell = _seedMotifCell(_vibe());
_voicingMidi = _voiceLeadChord(_vibe().chords[0].pcs, _rootMidi(), _voicingMidi);

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

/** Explicitly disconnect ephemeral voice nodes on end so iOS WebKit never accumulates dead graph inputs. */
function _autoDisconnect(sourceNode, nodes) {
    if (!sourceNode) return;
    sourceNode.onended = () => {
        _voicesCleaned += 1;
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (!n) continue;
            try { n.disconnect(); } catch (_) {}
        }
        try { sourceNode.onended = null; } catch (_) {}
    };
}

/**
 * Bounded AudioParam ramp: skips redundant updates (< eps) and cancels prior tails
 * so WebKit's AudioParamTimeline never grows unbounded over multi-hour sessions.
 */
function _rampParam(key, param, target, now, tc, eps = 0.002) {
    if (!param || !Number.isFinite(target) || !Number.isFinite(now)) return;
    const prev = _paramLast[key];
    if (prev !== undefined && Math.abs(target - prev) < eps) return;
    _paramLast[key] = target;
    try {
        if (typeof param.cancelAndHoldAtTime === 'function') {
            param.cancelAndHoldAtTime(now);
        } else {
            param.cancelScheduledValues(now);
            const cur = Number.isFinite(param.value) ? param.value : target;
            param.setValueAtTime(cur, now);
        }
        param.setTargetAtTime(target, now, tc);
    } catch (_) {}
}

/** Generate a tiny 2-second 8 kHz silent WAV Blob URL so looping costs ~0% CPU on iOS. */
function _getSilentLoopUrl() {
    if (_iosKeepaliveUrl) return _iosKeepaliveUrl;
    try {
        if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            const sampleRate = 8000;
            const numSamples = sampleRate * 2; // 2s mono 8-bit unsigned silence (0x80)
            const buf = new ArrayBuffer(44 + numSamples);
            const view = new DataView(buf);
            const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
            writeStr(0, 'RIFF');
            view.setUint32(4, 36 + numSamples, true);
            writeStr(8, 'WAVE');
            writeStr(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true); // PCM
            view.setUint16(22, 1, true); // mono
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate, true);
            view.setUint16(32, 1, true);
            view.setUint16(34, 8, true); // 8-bit unsigned
            writeStr(36, 'data');
            view.setUint32(40, numSamples, true);
            new Uint8Array(buf, 44).fill(128);
            _iosKeepaliveUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
            return _iosKeepaliveUrl;
        }
    } catch (_) {}
    return SILENT_WAV_URI;
}

function _syncIosKeepalive(active) {
    if (!_iosUnlockAudio) return;
    try {
        if (active) {
            if (_iosUnlockAudio.paused) {
                const p = _iosUnlockAudio.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            }
        } else if (!_iosUnlockAudio.paused) {
            _iosUnlockAudio.pause();
        }
    } catch (_) {}
}

function _activateIosAudioSession() {
    _setIosSessionType('playback');
    if (typeof document === 'undefined') return;
    try {
        if (!_iosUnlockAudio) {
            const el = document.createElement('audio');
            el.setAttribute('playsinline', '');
            el.setAttribute('webkit-playsinline', '');
            el.loop = true;
            el.preload = 'auto';
            el.src = _getSilentLoopUrl();
            el.volume = 0.01;
            _iosUnlockAudio = el;
        }
        if (_enabled && !document.hidden) {
            const p = _iosUnlockAudio.play();
            if (p && typeof p.then === 'function') {
                p.then(() => { _iosSessionActivated = true; }).catch(() => {});
            } else {
                _iosSessionActivated = true;
            }
        }
    } catch (_) {}
}

function _playSilentPulse(ac) {
    try {
        const b = ac.createBuffer(1, 1, 22050);
        const s = ac.createBufferSource();
        s.buffer = b;
        s.connect(ac.destination);
        _autoDisconnect(s, [s]);
        s.start(0);
    } catch (_) {}
}

function _teardownGraph() {
    _stopLoops();
    const old = _ac;
    _ac = null;
    _graphBuilt = false;
    _masterGain = null;
    _toneFilter = null;
    _duckBus = null;
    _bedDuckGain = null;
    _subDirectBus = null;
    _sfxBus = null;
    _warmthEq = null;
    _tapeDrive = null;
    _atmosGain = null;
    _atmosLpA = null;
    _atmosLpB = null;
    _reverbSend = null;
    _reverbWet = null;
    _shimmerSend = null;
    _shimmerWet = null;
    _neuralAmBus = null;
    _neuralAmOsc = null;
    _neuralAmDepthGain = null;
    _delaySend = null;
    _delayWet = null;
    _delayL = null;
    _delayR = null;
    _flatlineGain = null;
    _analyserL = null;
    _analyserR = null;
    _velvetBrownBuffer = null;
    _crispNoiseBuffer = null;
    _paramLast = Object.create(null);
    _lastWatchTime = -1;
    _stallCount = 0;
    if (old) {
        try { old.close().catch(() => {}); } catch (_) {}
    }
}

async function _recoverAudioContext() {
    if (_rebuilding || !_enabled) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    _rebuilding = true;
    try {
        _rebuilds += 1;
        _teardownGraph();
        _activateIosAudioSession();
        const ac = _ensureContext();
        if (!ac) return false;
        if (ac.state !== 'running') {
            try { await ac.resume(); } catch (_) {}
            _playSilentPulse(ac);
        }
        _buildGraph();
        if (ac.state === 'running') {
            _nextPadBar = _barCount; // seamlessly re-bloom current voice-led chord
            _startLoops();
            _syncButtonUI();
            return true;
        }
    } catch (_) {
    } finally {
        _rebuilding = false;
    }
    return false;
}

function _watchdogTick() {
    if (!_enabled || !_ac || _rebuilding) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    const st = _ac.state;
    // 1. iOS Safari proprietary 'interrupted' or unexpected 'suspended' state -> auto-resume
    if (st === 'interrupted' || st === 'suspended') {
        _stallCount += 1;
        try { _ac.resume().catch(() => {}); } catch (_) {}
        _syncIosKeepalive(true);
        if (_stallCount >= 3) _recoverAudioContext();
        return;
    }
    if (st === 'closed') {
        _recoverAudioContext();
        return;
    }

    // 2. Detect WebKit CoreAudio silent clock freeze or NaN feedback poisoning
    if (st === 'running' && _running) {
        const curT = _ac.currentTime;
        let hasNaN = false;
        if (_analyserL) {
            try {
                const probe = new Float32Array(64);
                _analyserL.getFloatTimeDomainData(probe);
                for (let i = 0; i < probe.length; i++) {
                    if (!Number.isFinite(probe[i])) { hasNaN = true; break; }
                }
            } catch (_) {}
        }
        if (hasNaN) {
            _recoverAudioContext();
            return;
        }
        if (_lastWatchTime >= 0 && Math.abs(curT - _lastWatchTime) < 0.05) {
            _stallCount += 1;
            if (_stallCount >= 2) {
                _recoverAudioContext();
                return;
            }
        } else {
            _stallCount = 0;
        }
        _lastWatchTime = curT;
    }
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
            const hidden = typeof document !== 'undefined' && document.hidden;
            if (ac.state === 'running' && _enabled && !hidden) {
                _stallCount = 0;
                _buildGraph();
                if (!_running) {
                    _startLoops();
                    if (_rebuilds === 0) playBootIgnition();
                } else {
                    _applyHealthModulation();
                }
                _syncIosKeepalive(true);
                _syncButtonUI();
            } else if ((ac.state === 'interrupted' || ac.state === 'suspended') && _enabled && !hidden) {
                // Attempt immediate recovery after iOS notification / system interruption
                setTimeout(() => {
                    if (_ac === ac && _enabled && !(typeof document !== 'undefined' && document.hidden) && ac.state !== 'running') {
                        try { ac.resume().catch(() => {}); } catch (_) {}
                    }
                }, 450);
            }
        });
    } catch (_) {}
    return ac;
}

// ── Noise Buffers & Diffused Stereo Velvet Hall Convolver ───────────────────
function _ensureNoiseBuffers(ac) {
    if (_velvetBrownBuffer && _velvetBrownBuffer.sampleRate === ac.sampleRate) return;

    // 22.0s true stereo decorrelated Velvet Brown (-6 dB/oct) atmosphere buffer:
    //   1. Smooth leaky brown integrator (zero harsh 2-4kHz grit)
    //   2. Pre-seam 42 Hz DC-blocker/HPF so random-walk DC offset is strictly zero (eliminates loop bumps!)
    //   3. Pre-seam soft high-frequency silk smoothing (~680 Hz)
    //   4. RMS normalization + 2.5s equal-power crossfade tail-into-head for completely invisible looping
    const secs = 22.0;
    const sr = ac.sampleRate;
    const len = Math.floor(sr * secs);
    const xfade = Math.floor(sr * 2.5);
    const brownBuf = ac.createBuffer(2, len, sr);
    const hpAlpha = Math.exp(-2 * Math.PI * 42 / sr);
    const lpAlpha = 1 - Math.exp(-2 * Math.PI * 680 / sr);

    for (let ch = 0; ch < 2; ch++) {
        const data = brownBuf.getChannelData(ch);
        const total = len + xfade;
        const raw = new Float32Array(total);
        let brown = 0;
        let prevIn = 0;
        let hpOut = 0;
        let smooth = 0;

        // Warm up filters cleanly before recording samples
        for (let i = 0; i < 4096; i++) {
            const w = Math.random() * 2 - 1;
            brown = (brown + 0.032 * w) / 1.032;
            hpOut = hpAlpha * (hpOut + brown - prevIn);
            prevIn = brown;
            smooth += (hpOut - smooth) * lpAlpha;
        }

        let sumSq = 0;
        for (let i = 0; i < total; i++) {
            const w = Math.random() * 2 - 1;
            brown = (brown + 0.032 * w) / 1.032;
            hpOut = hpAlpha * (hpOut + brown - prevIn);
            prevIn = brown;
            smooth += (hpOut - smooth) * lpAlpha;
            raw[i] = smooth;
            sumSq += smooth * smooth;
        }

        const rms = Math.sqrt(sumSq / total) || 1;
        const gain = 0.22 / rms;

        for (let i = 0; i < len; i++) {
            if (i < xfade) {
                const t = i / xfade;
                const a = Math.sin(t * Math.PI * 0.5);
                const b = Math.cos(t * Math.PI * 0.5);
                data[i] = clamp((raw[i] * a + raw[len + i] * b) * gain, -0.95, 0.95);
            } else {
                data[i] = clamp(raw[i] * gain, -0.95, 0.95);
            }
        }
    }

    const crispBuf = ac.createBuffer(1, Math.floor(sr * 0.5), sr);
    const cCh = crispBuf.getChannelData(0);
    for (let i = 0; i < cCh.length; i++) cCh[i] = Math.random() * 2 - 1;

    _velvetBrownBuffer = brownBuf;
    _crispNoiseBuffer = crispBuf;
}

function _createVelvetHallReverb(ac) {
    const conv = ac.createConvolver();
    const secs = 3.6;
    const sr = ac.sampleRate;
    const len = Math.floor(sr * secs);
    const ir = ac.createBuffer(2, len, sr);

    // Wide Haas-decorrelated studio early reflections (ms)
    const erL = [0.011, 0.019, 0.029, 0.043, 0.059, 0.071];
    const erR = [0.014, 0.023, 0.034, 0.047, 0.062, 0.074];

    for (let c = 0; c < 2; c++) {
        const data = ir.getChannelData(c);
        let lp1 = 0, lp2 = 0, hp = 0;
        for (let i = 0; i < len; i++) {
            const t = i / len;
            const sec = i / sr;
            const bloom = Math.min(1.0, sec / 0.028);
            const env = Math.pow(1 - t, 2.15) * bloom;
            // Diffused velvet noise + smooth Gaussian-like sum of two uniforms
            const raw = ((Math.random() + Math.random() - 1.0)) * env;
            // Two-pole progressive air damping: luminous early sheen, silky warm late tail
            const damp = (c === 0 ? 0.36 : 0.33) * Math.pow(1 - t, 1.35) + 0.042;
            lp1 += (raw - lp1) * damp;
            lp2 += (lp1 - lp2) * (damp * 0.85 + 0.04);
            hp += (lp2 - hp) * 0.016; // clean 120 Hz low-cut so reverb never muddies sub-bass
            data[i] = (lp2 - hp) * 1.48;
        }
        const taps = c === 0 ? erL : erR;
        taps.forEach((tapSec, idx) => {
            const pos = Math.floor(tapSec * sr);
            if (pos < len) {
                const sign = ((idx + c) % 2 === 0) ? 1 : -1;
                data[pos] += sign * 0.22 * Math.pow(0.78, idx);
            }
        });
    }
    conv.buffer = ir;
    return conv;
}

function _makeTapeCurve(drive = 7.5) {
    const n = 2048;
    const curve = new Float32Array(n);
    const k = 1 + drive * 0.085;
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        // Subtle 2nd-harmonic asymmetric analog tape warmth
        curve[i] = Math.tanh((x + 0.035 * x * x) * k) / norm;
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

/**
 * Inspect live problem-solving state without creating hard circular imports:
 *   - solving: #practice-modal is open and current question is not yet submitted
 *   - cocoon: 0..1 deep-think depth ramping smoothly from 60s -> 150s on a hard question
 *   - bloom: 0..1 decaying harmonic lift after cracking a question
 */
function _readStudyContext() {
    let solving = false;
    let questionSecs = 0;
    let streak = 0;
    try {
        if (typeof document !== 'undefined') {
            const pm = document.getElementById('practice-modal');
            if (pm && pm.classList && pm.classList.contains('active')) {
                const st = (typeof window !== 'undefined' && window.AppState) ? window.AppState : null;
                const idx = st ? (st.currentPracticeIndex || 0) : 0;
                const submitted = Boolean(st && st.practiceSubmittedFlags && st.practiceSubmittedFlags[idx]);
                solving = !submitted;
                questionSecs = st ? Math.max(0, Number(st.practiceSeconds) || 0) : 0;
                streak = st ? Math.max(0, Number(st.practiceCorrectStreak) || 0) : 0;
            }
        }
    } catch (_) {}

    const cocoon = solving ? clamp((questionSecs - 60) / 90, 0, 1) : 0;
    const nowMs = Date.now();
    const bloom = (_solveBloomUntil > nowMs)
        ? clamp(((_solveBloomUntil - nowMs) / 4500) * _solveBloomStrength, 0, 1)
        : 0;
    _lastCocoonLevel = cocoon;
    _lastSolvingActive = solving;
    return { solving, questionSecs, streak, cocoon, bloom };
}

// ── Studio DSP Graph Construction ───────────────────────────────────────────
function _buildGraph() {
    const ac = _ensureContext();
    if (!ac) return null;
    if (_graphBuilt) return ac;
    _graphBuilt = true;
    _ensureNoiseBuffers(ac);

    const v = _vibe();
    const step = _stepSecs();

    // Master tone, clarity & iPad-speaker-tuned warmth chain
    _toneFilter = ac.createBiquadFilter();
    _toneFilter.type = 'lowpass';
    _toneFilter.frequency.value = _nyquistSafe(ac, 5400);
    _toneFilter.Q.value = 0.7;

    const subGuard = ac.createBiquadFilter();
    subGuard.type = 'highpass';
    subGuard.frequency.value = 42; // removes infrasonic cabin-pressure rumble that causes headphone fatigue

    _warmthEq = ac.createBiquadFilter();
    _warmthEq.type = 'peaking';
    _warmthEq.frequency.value = 115;
    _warmthEq.Q.value = 0.85;
    _warmthEq.gain.value = 1.2; // subtle presence on iPad speakers without heavy headphone bass bloat

    const clarityDip = ac.createBiquadFilter();
    clarityDip.type = 'peaking';
    clarityDip.frequency.value = 220;
    clarityDip.Q.value = 0.9;
    clarityDip.gain.value = -2.5; // relieves 180-280 Hz "heavy-on-head" ear-pressure band

    const airShelf = ac.createBiquadFilter();
    airShelf.type = 'highshelf';
    airShelf.frequency.value = 5800;
    airShelf.gain.value = -1.6; // silky fatigue-free top end for 4+ hour sessions

    _tapeDrive = ac.createWaveShaper();
    _tapeDrive.curve = _makeTapeCurve(v.drive);
    try { _tapeDrive.oversample = '2x'; } catch (_) {}

    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 22;
    comp.ratio.value = 2.5; // open breathable dynamics — never squashed club loudness
    comp.attack.value = 0.012;
    comp.release.value = 0.24;

    _masterGain = ac.createGain();
    _masterGain.gain.value = 0.0001;

    _duckBus = ac.createGain();
    _duckBus.gain.value = 1.0;

    // Dedicated music-bed ducking bus (separate from kick sidechain so UI SFX & Mario Recap
    // glide the ambient bed smoothly down without fighting rhythmic pumping or ducking SFX)
    _bedDuckGain = ac.createGain();
    _bedDuckGain.gain.value = _recapDuckActive ? 0.14 : 1.0;

    // Direct sub-kick bus bypasses _duckBus so kicks punch cleanly while pumping the room around them
    _subDirectBus = ac.createGain();
    _subDirectBus.gain.value = 1.0;
    _subDirectBus.connect(_toneFilter);

    // Dedicated SFX bus so slider bumps & Pact seals share speaker warmth & limiter
    _sfxBus = ac.createGain();
    _sfxBus.gain.value = 0.94;
    _sfxBus.connect(_warmthEq);

    // 1. Rapid Neural AM Focus Bus (phase-coherent 10-16.5 Hz AM woven ONLY into stereo hall/pad/shimmer)
    // Modulates gain smoothly around (1 - depth/2) ± (depth/2) -> zero harsh binaural whine, zero bass wobble.
    _neuralAmBus = ac.createGain();
    _neuralAmBus.gain.value = 1.0 - v.neuralAmDepth * 0.5;

    _neuralAmOsc = ac.createOscillator();
    _neuralAmOsc.type = 'sine';
    _neuralAmOsc.frequency.value = v.neuralAmHz;

    _neuralAmDepthGain = ac.createGain();
    _neuralAmDepthGain.gain.value = v.neuralAmDepth * 0.5;
    _neuralAmOsc.connect(_neuralAmDepthGain).connect(_neuralAmBus.gain);
    _neuralAmOsc.start();
    _neuralAmBus.connect(_duckBus);

    // 2. Diffused 3.6s Stereo Velvet Hall Convolver (routed through _neuralAmBus for subtle neural phase-locking)
    const reverb = _createVelvetHallReverb(ac);
    _reverbWet = ac.createGain();
    _reverbWet.gain.value = v.reverbWet;
    _reverbSend = ac.createGain();
    _reverbSend.gain.value = 0.82;
    _reverbSend.connect(reverb);
    reverb.connect(_reverbWet);
    _reverbWet.connect(_neuralAmBus);

    // 2. True Stereo Chorus-Modulated Octave Shimmer Halo (merged L/R into Velvet Hall)
    _shimmerSend = ac.createGain();
    _shimmerSend.gain.value = 0.85;
    _shimmerWet = ac.createGain();
    _shimmerWet.gain.value = v.shimmerLevel;

    const shimBp = ac.createBiquadFilter();
    shimBp.type = 'bandpass';
    shimBp.frequency.value = 1750;
    shimBp.Q.value = 0.65;

    const shimDelL = ac.createDelay(1.2);
    const shimDelR = ac.createDelay(1.2);
    shimDelL.delayTime.value = 0.37;
    shimDelR.delayTime.value = 0.53;
    const shimFb = ac.createGain();
    shimFb.gain.value = 0.48;
    const shimLp = ac.createBiquadFilter();
    shimLp.type = 'lowpass';
    shimLp.frequency.value = _nyquistSafe(ac, 4200);

    const shimLfoA = ac.createOscillator();
    const shimLfoB = ac.createOscillator();
    const shimLfoGA = ac.createGain();
    const shimLfoGB = ac.createGain();
    shimLfoA.frequency.value = 0.19;
    shimLfoB.frequency.value = 0.27;
    shimLfoGA.gain.value = 0.0028;
    shimLfoGB.gain.value = 0.0031;
    shimLfoA.connect(shimLfoGA).connect(shimDelL.delayTime);
    shimLfoB.connect(shimLfoGB).connect(shimDelR.delayTime);
    shimLfoA.start();
    shimLfoB.start();

    const shimMerger = ac.createChannelMerger(2);
    _shimmerSend.connect(shimBp);
    shimBp.connect(shimDelL);
    shimDelL.connect(shimLp);
    shimLp.connect(shimDelR);
    shimDelR.connect(shimFb);
    shimFb.connect(shimDelL);
    shimDelL.connect(shimMerger, 0, 0);
    shimDelR.connect(shimMerger, 0, 1);
    shimMerger.connect(_shimmerWet);
    _shimmerWet.connect(reverb);

    // 3. True Stereo L/R Ping-Pong Dotted-Eighth Tape Delay (ChannelMergerNode — true stereo!)
    _delaySend = ac.createGain();
    _delaySend.gain.value = 0.78;
    _delayWet = ac.createGain();
    _delayWet.gain.value = v.delayWet;

    _delayL = ac.createDelay(1.5);
    _delayR = ac.createDelay(1.5);
    _delayL.delayTime.value = clamp(step * 3, 0.06, 1.45);
    _delayR.delayTime.value = clamp(step * 3, 0.06, 1.45);

    const delayHp = ac.createBiquadFilter();
    delayHp.type = 'highpass';
    delayHp.frequency.value = 220;
    const delayLp = ac.createBiquadFilter();
    delayLp.type = 'lowpass';
    delayLp.frequency.value = _nyquistSafe(ac, 2600);
    const delayFb = ac.createGain();
    delayFb.gain.value = 0.42;
    const delayMerger = ac.createChannelMerger(2);

    _delaySend.connect(_delayL);
    _delayL.connect(delayHp);
    delayHp.connect(delayLp);
    delayLp.connect(_delayR);
    _delayR.connect(delayFb);
    delayFb.connect(_delayL);
    _delayL.connect(delayMerger, 0, 0);
    _delayR.connect(delayMerger, 0, 1);
    delayMerger.connect(_delayWet);
    _delayWet.connect(_duckBus);
    // Subtle reverb tail on stereo ping-pong echoes for cavernous studio depth
    const delRevTap = ac.createGain();
    delRevTap.gain.value = 0.28;
    _delayWet.connect(delRevTap).connect(_reverbSend);

    // Master Chain Wiring (Music Bed goes through _bedDuckGain; _sfxBus enters cleanly at _warmthEq)
    _duckBus.connect(_toneFilter);
    _toneFilter.connect(_bedDuckGain);
    _bedDuckGain.connect(subGuard);
    subGuard.connect(_warmthEq);
    _warmthEq.connect(clarityDip);
    clarityDip.connect(airShelf);
    airShelf.connect(_tapeDrive);
    _tapeDrive.connect(comp);
    comp.connect(_masterGain);
    _masterGain.connect(ac.destination);

    // Passive stereo Analyser tap for QA telemetry (zero audio side effects)
    try {
        const split = ac.createChannelSplitter(2);
        _analyserL = ac.createAnalyser();
        _analyserR = ac.createAnalyser();
        _analyserL.fftSize = 1024;
        _analyserR.fftSize = 1024;
        _masterGain.connect(split);
        split.connect(_analyserL, 0);
        split.connect(_analyserR, 1);
    } catch (_) {}

    // 4. Seamless Dual-Layer Velvet Brown Atmosphere (zero harshness, zero loop bumps, zero sidechain chop)
    // Two staggered stereo loops at coprime playback rates (1.0 & 0.8317, 11s offset) through
    // a smooth 2-pole Butterworth lowpass (Q=0.5, no resonant hiss) wired directly to _toneFilter.
    const atmosSrcA = ac.createBufferSource();
    atmosSrcA.buffer = _velvetBrownBuffer;
    atmosSrcA.loop = true;
    atmosSrcA.playbackRate.value = 1.0;

    const atmosSrcB = ac.createBufferSource();
    atmosSrcB.buffer = _velvetBrownBuffer;
    atmosSrcB.loop = true;
    atmosSrcB.playbackRate.value = 0.8317; // incommensurate rate -> infinite non-repeating bed

    const mixA = ac.createGain();
    mixA.gain.value = 0.62;
    const mixB = ac.createGain();
    mixB.gain.value = 0.52;

    const atmosHp = ac.createBiquadFilter();
    atmosHp.type = 'highpass';
    atmosHp.frequency.value = 90; // removes continuous low-frequency rumble completely
    atmosHp.Q.value = 0.55;

    // Two cascaded gentle lowpass filters (Q=0.5 -> zero resonant sibilance or harsh top-end)
    _atmosLpA = ac.createBiquadFilter();
    _atmosLpA.type = 'lowpass';
    _atmosLpA.frequency.value = _nyquistSafe(ac, v.atmosCutoff);
    _atmosLpA.Q.value = 0.5;

    _atmosLpB = ac.createBiquadFilter();
    _atmosLpB.type = 'lowpass';
    _atmosLpB.frequency.value = _nyquistSafe(ac, v.atmosCutoff * 1.18);
    _atmosLpB.Q.value = 0.5;

    // Ultra-gentle 52-second warm horizon breath (±70 Hz only — never sounds like pumping)
    const atmosLfo = ac.createOscillator();
    const atmosLfoG = ac.createGain();
    atmosLfo.type = 'sine';
    atmosLfo.frequency.value = 0.019;
    atmosLfoG.gain.value = 70;
    atmosLfo.connect(atmosLfoG).connect(_atmosLpA.frequency);
    atmosLfo.start();

    _atmosGain = ac.createGain();
    _atmosGain.gain.value = v.atmosLevel;

    atmosSrcA.connect(mixA).connect(atmosHp);
    atmosSrcB.connect(mixB).connect(atmosHp);
    atmosHp.connect(_atmosLpA);
    _atmosLpA.connect(_atmosLpB);
    _atmosLpB.connect(_atmosGain);
    // Bypass _duckBus so the velvet brown room bed stays glass-smooth with zero kick-bump artifacts
    _atmosGain.connect(_toneFilter);

    atmosSrcA.start(0, 0);
    atmosSrcB.start(0, 11.0);

    // 5. Flatline Quiet Safety Drone (only audible at 0.0h)
    const flOsc = ac.createOscillator();
    flOsc.type = 'sine';
    flOsc.frequency.value = 110;
    _flatlineGain = ac.createGain();
    _flatlineGain.gain.value = 0.0001;
    flOsc.connect(_flatlineGain).connect(_masterGain);
    flOsc.start();

    return ac;
}

// ── Studio-Grade Synthesized Instruments ────────────────────────────────────

/** Organic Felt-Mallet Sub-Thump with crisp beater knock & NaN-safe room sidechain pump. */
function _schedSubThump(ac, time, vel, duckAmount, levelScale = 1.0) {
    const t = Math.max(ac.currentTime + 0.004, time);
    const out = _subDirectBus || _toneFilter;

    // 1. Sub body (soft rounded heartbeat sweep — felt without ear-pressure slam)
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(94, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.088);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.21);

    const peak = clamp(0.32 * vel * levelScale, 0.001, 0.42);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.007);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(g).connect(out);

    // 2. Warm felt-mallet chest knock (audible on iPad & laptop speakers)
    const knock = ac.createOscillator();
    const kg = ac.createGain();
    knock.type = 'triangle';
    knock.frequency.setValueAtTime(240, t);
    knock.frequency.exponentialRampToValueAtTime(80, t + 0.048);
    kg.gain.setValueAtTime(0.0001, t);
    kg.gain.linearRampToValueAtTime(peak * 0.24, t + 0.003);
    kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.058);
    knock.connect(kg).connect(out);

    const cleanList = [osc, g, knock, kg];

    // 3. Soft 14ms low-passed felt beater transient (organic Nils Frahm / Kiasmos warmth)
    if (_crispNoiseBuffer) {
        const beater = ac.createBufferSource();
        beater.buffer = _crispNoiseBuffer;
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 520;
        bp.Q.value = 1.4;
        const bg = ac.createGain();
        bg.gain.setValueAtTime(0.0001, t);
        bg.gain.linearRampToValueAtTime(peak * 0.14, t + 0.002);
        bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
        beater.connect(bp).connect(bg).connect(out);
        beater.start(t, _rng() * 0.2, 0.025);
        cleanList.push(beater, bp, bg);
    }

    _autoDisconnect(osc, cleanList);
    osc.start(t);
    knock.start(t);
    osc.stop(t + 0.29);
    knock.stop(t + 0.068);

    // Smooth hypnotic sidechain breathing (linearRamp = 100% immune to WebKit zero-crossing NaN!)
    if (_duckBus && duckAmount > 0.03) {
        const floor = clamp(1.0 - duckAmount * vel, 0.56, 0.96);
        try {
            const cur = clamp(Number.isFinite(_duckBus.gain.value) ? _duckBus.gain.value : 1.0, 0.15, 1.0);
            _duckBus.gain.cancelScheduledValues(t);
            _duckBus.gain.setValueAtTime(cur, t);
            _duckBus.gain.linearRampToValueAtTime(floor, t + 0.016);
            _duckBus.gain.linearRampToValueAtTime(1.0, t + 0.22);
        } catch (_) {}
    }
}

/** Warm rounded melodic sub-bass (pure sine + soft triangle, zero harsh sawtooth pressure). */
function _schedRollingBass(ac, time, freq, dur, vel, filterOpen = 0.5) {
    const t = Math.max(ac.currentTime + 0.004, time);
    const sub = ac.createOscillator();
    const warm = ac.createOscillator();
    const lp = ac.createBiquadFilter();
    const g = ac.createGain();

    sub.type = 'sine';
    warm.type = 'triangle';
    sub.frequency.setValueAtTime(freq, t);
    warm.frequency.setValueAtTime(freq, t);
    warm.detune.value = -4;

    const fPeak = _nyquistSafe(ac, 220 + filterOpen * 340 * vel);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(fPeak, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(90, freq * 1.4), t + Math.min(dur, 0.24));
    lp.Q.value = 1.25;

    const peak = clamp(0.14 * vel, 0.001, 0.21);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    sub.connect(lp);
    warm.connect(lp);
    lp.connect(g).connect(_duckBus);

    _autoDisconnect(sub, [sub, warm, lp, g]);
    sub.start(t);
    warm.start(t);
    sub.stop(t + dur + 0.03);
    warm.stop(t + dur + 0.03);
}

/**
 * Airy Voice-Led Analog Ensemble Pad (transparent triangle+sine per voice + breathing LPF
 * + dedicated +12 Octave Shimmer bow voices, all explicitly disconnected on end).
 */
function _schedAnalogEnsemblePad(ac, time, midiNotes, durSecs, level = 1.0, filterLift = 0.7, fastFirstBar = false) {
    const t = Math.max(ac.currentTime + 0.004, time);
    const pans = [-0.68, 0.64, -0.32, 0.38];
    const attack = fastFirstBar ? Math.min(1.1, durSecs * 0.16) : Math.min(2.8, durSecs * 0.30);
    const release = Math.min(3.8, durSecs * 0.36);

    midiNotes.forEach((midi, idx) => {
        const freq = midiToFreq(midi);
        const oTri = ac.createOscillator();
        const oSin = ac.createOscillator();
        const lp = ac.createBiquadFilter();
        const pan = _createStereoPanner(ac, pans[idx % pans.length]);
        const g = ac.createGain();

        oTri.type = 'triangle';
        oSin.type = 'sine';
        oTri.frequency.setValueAtTime(freq, t);
        oSin.frequency.setValueAtTime(freq, t);
        oTri.detune.value = (idx % 2 === 0 ? -6 : 6);
        oSin.detune.value = (idx % 2 === 0 ? 5 : -5);

        const startCut = _nyquistSafe(ac, 260 + idx * 70);
        const peakCut = _nyquistSafe(ac, 620 + filterLift * 880 + idx * 120);
        const endCut = _nyquistSafe(ac, 300 + idx * 60);
        lp.type = 'lowpass';
        lp.Q.value = 0.85;
        lp.frequency.setValueAtTime(startCut, t);
        lp.frequency.exponentialRampToValueAtTime(peakCut, t + durSecs * 0.48);
        lp.frequency.exponentialRampToValueAtTime(endCut, t + durSecs);

        const voicePeak = clamp(0.034 * level * (idx >= 2 ? 0.85 : 1.0), 0.0008, 0.065);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(voicePeak, t + attack);
        g.gain.setValueAtTime(voicePeak, t + Math.max(attack + 0.25, durSecs - release));
        g.gain.exponentialRampToValueAtTime(0.0001, t + durSecs + 0.25);

        oTri.connect(lp);
        oSin.connect(lp);
        lp.connect(pan).connect(g);
        g.connect(_neuralAmBus || _duckBus);
        g.connect(_reverbSend);

        _autoDisconnect(oTri, [oTri, oSin, lp, pan, g]);
        oTri.start(t);
        oSin.start(t);
        oTri.stop(t + durSecs + 0.35);
        oSin.stop(t + durSecs + 0.35);
    });

    // True Octave-Up (+12) Bowed Shimmer Halo Voices
    if (_shimmerSend && midiNotes.length >= 3) {
        const shimPitches = [midiNotes[2] + 12, midiNotes[3] + 12];
        shimPitches.forEach((sm, idx) => {
            const osc = ac.createOscillator();
            const pan = _createStereoPanner(ac, idx === 0 ? -0.48 : 0.48);
            const sg = ac.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(midiToFreq(sm), t);
            osc.detune.value = idx === 0 ? -4 : 4;
            const sPeak = clamp(0.022 * level * (0.5 + 0.5 * filterLift), 0.0005, 0.055);
            sg.gain.setValueAtTime(0.0001, t);
            sg.gain.linearRampToValueAtTime(sPeak, t + Math.min(2.2, durSecs * 0.35));
            sg.gain.exponentialRampToValueAtTime(0.0001, t + durSecs + 0.2);
            osc.connect(pan).connect(sg).connect(_shimmerSend);
            _autoDisconnect(osc, [osc, pan, sg]);
            osc.start(t);
            osc.stop(t + durSecs + 0.3);
        });
    }
}

/** Vibe-specific lead motif voice (Prophet felt-pluck / Celesta / Analog Arp / Vintage Rhodes). */
function _schedMotifVoice(ac, time, freq, vel, panPos, timbre, filterOpen = 0.7) {
    const t = Math.max(ac.currentTime + 0.004, time);
    const pan = _createStereoPanner(ac, panPos);
    const g = ac.createGain();

    if (timbre === 'feltCelesta') {
        const car = ac.createOscillator();
        const over = ac.createOscillator();
        const ovG = ac.createGain();
        car.type = 'sine';
        over.type = 'triangle';
        car.frequency.setValueAtTime(freq, t);
        over.frequency.setValueAtTime(freq * 2, t);
        ovG.gain.setValueAtTime(0.18 * vel, t);
        ovG.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

        const dur = 2.4;
        const peak = clamp(0.068 * vel, 0.0006, 0.12);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.022);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

        car.connect(pan);
        over.connect(ovG).connect(pan);
        pan.connect(g);
        g.connect(_duckBus);
        g.connect(_reverbSend);
        g.connect(_delaySend);
        if (_shimmerSend) g.connect(_shimmerSend);

        _autoDisconnect(car, [car, over, ovG, pan, g]);
        car.start(t); over.start(t);
        car.stop(t + dur + 0.06); over.stop(t + dur + 0.06);
        return;
    }

    if (timbre === 'vintageRhodes') {
        const car = ac.createOscillator();
        const mod = ac.createOscillator();
        const modG = ac.createGain();
        car.type = 'sine';
        mod.type = 'sine';
        car.frequency.setValueAtTime(freq, t);
        mod.frequency.setValueAtTime(freq * 2.0, t);
        modG.gain.setValueAtTime(freq * 0.78 * vel, t);
        modG.gain.exponentialRampToValueAtTime(1.0, t + 0.22);

        const dur = 1.45;
        const peak = clamp(0.095 * vel, 0.0006, 0.16);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

        mod.connect(modG).connect(car.frequency);
        car.connect(pan).connect(g);
        g.connect(_duckBus);
        g.connect(_reverbSend);
        g.connect(_delaySend);

        _autoDisconnect(car, [car, mod, modG, pan, g]);
        car.start(t); mod.start(t);
        car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
        return;
    }

    const isArp = timbre === 'analogArp';
    const o1 = ac.createOscillator();
    const o2 = ac.createOscillator();
    const lp = ac.createBiquadFilter();
    o1.type = 'sawtooth';
    o2.type = 'triangle';
    o1.frequency.setValueAtTime(freq, t);
    o2.frequency.setValueAtTime(freq, t);
    o1.detune.value = isArp ? -6 : -4;
    o2.detune.value = isArp ? +6 : +4;

    const cutStart = _nyquistSafe(ac, (isArp ? 3200 : 2400) * (0.55 + 0.55 * filterOpen));
    const cutEnd = _nyquistSafe(ac, isArp ? 320 : 250);
    lp.type = 'lowpass';
    lp.Q.value = isArp ? 2.8 : 2.1;
    lp.frequency.setValueAtTime(cutStart, t);
    lp.frequency.exponentialRampToValueAtTime(cutEnd, t + (isArp ? 0.11 : 0.16));

    const dur = isArp ? 0.42 : 0.78;
    const peak = clamp((isArp ? 0.092 : 0.088) * vel, 0.0006, 0.16);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    o1.connect(lp);
    o2.connect(lp);
    lp.connect(pan).connect(g);
    g.connect(_duckBus);
    g.connect(_delaySend);
    g.connect(_reverbSend);

    const cleanList = [o1, o2, lp, pan, g];

    if (!isArp && _crispNoiseBuffer) {
        const tap = ac.createBufferSource();
        tap.buffer = _crispNoiseBuffer;
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1650;
        bp.Q.value = 1.6;
        const tg = ac.createGain();
        tg.gain.setValueAtTime(0.0001, t);
        tg.gain.linearRampToValueAtTime(peak * 0.22, t + 0.002);
        tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.014);
        tap.connect(bp).connect(tg).connect(pan);
        tap.start(t, _rng() * 0.2, 0.02);
        cleanList.push(tap, bp, tg);
    }

    _autoDisconnect(o1, cleanList);
    o1.start(t); o2.start(t);
    o1.stop(t + dur + 0.04); o2.stop(t + dur + 0.04);
}

/** Soft stereo organic wood-rim micro-click (panned into ping-pong delay). */
function _schedMicroRim(ac, time, vel, panPos) {
    const t = Math.max(ac.currentTime + 0.004, time);
    const osc = ac.createOscillator();
    const bp = ac.createBiquadFilter();
    const pan = _createStereoPanner(ac, panPos);
    const g = ac.createGain();

    const base = 920 + _rng() * 480;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 0.58, t + 0.028);
    bp.type = 'bandpass';
    bp.frequency.value = base * 1.1;
    bp.Q.value = 2.6;

    const peak = clamp(0.052 * vel, 0.0004, 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.036);

    osc.connect(bp).connect(pan).connect(g);
    g.connect(_duckBus);
    g.connect(_delaySend);
    g.connect(_reverbSend);
    _autoDisconnect(osc, [osc, bp, pan, g]);
    osc.start(t);
    osc.stop(t + 0.045);
}

/** Ultra-soft silky high-air shaker brush (sparse offbeats, zero harsh 3kHz hiss). */
function _schedVelvetShaker(ac, time, vel, panPos) {
    if (!_crispNoiseBuffer) return;
    const t = Math.max(ac.currentTime + 0.004, time);
    const src = ac.createBufferSource();
    src.buffer = _crispNoiseBuffer;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5400 + _rng() * 1100;
    bp.Q.value = 1.1;
    const pan = _createStereoPanner(ac, panPos);
    const g = ac.createGain();

    const peak = clamp(0.014 * vel, 0.0002, 0.026);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.042);

    src.connect(bp).connect(pan).connect(g);
    g.connect(_duckBus);
    _autoDisconnect(src, [src, bp, pan, g]);
    src.start(t, _rng() * 0.25, 0.05);
}

/** 2-Bar Warm Velvet Ocean Swell right into a clean chapter drop (zero harsh hiss). */
function _schedBreathSwell(ac, time, durSecs, level = 1.0) {
    if (!_velvetBrownBuffer) return;
    const t = Math.max(ac.currentTime + 0.004, time);
    const src = ac.createBufferSource();
    src.buffer = _velvetBrownBuffer;
    src.loop = true;

    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.85;
    lp.frequency.setValueAtTime(180, t);
    lp.frequency.exponentialRampToValueAtTime(_nyquistSafe(ac, 980), t + durSecs);

    const g = ac.createGain();
    const peak = clamp(0.085 * level, 0.001, 0.14);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + durSecs * 0.92);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durSecs + 0.12);

    src.connect(lp).connect(g);
    g.connect(_reverbSend);
    g.connect(_duckBus);
    _autoDisconnect(src, [src, lp, g]);
    src.start(t, _rng() * 14.0, durSecs + 0.16);
}

// ── Sample-Accurate Generative Arrangement Sequencer ────────────────────────
function _scheduleStep(stepIndex, time) {
    const v = _lastVitals || _readVitalsSafe();
    if (v.flatlined) return;

    const vibe = _vibe();
    const step = stepIndex % 16;
    const bar = Math.floor(stepIndex / 16);
    const inVoid = _isVoidActive();
    const studyCtx = _readStudyContext();
    const inFlowPlateau = studyCtx.solving && !_pactPreviewActive;
    const tide = _macroTide();
    const stepSecs = _stepSecs();

    // Bar boundary housekeeping: arrangement chapters, motif evolution, voice-led pad, risers
    if (step === 0) {
        _barCount = bar;
        if (inFlowPlateau) {
            // Solving-Mode Flow Plateau: no abrupt exhale drop-outs or 2-bar risers mid-question;
            // still modulates gently around the Circle of Fifths every ~112 bars for endless non-repetition.
            if (bar >= _plateauNextModBar) {
                const dir = _rng() < 0.72 ? 1 : -1;
                _cofIndex = (_cofIndex + dir + COF_ROOT_MIDI.length) % COF_ROOT_MIDI.length;
                _plateauNextModBar = bar + 96 + Math.floor(_rng() * 48);
                _mutateMotifCell();
            }
        } else {
            if (bar >= _chapterEndBar) {
                _advanceChapter(bar);
            }
            // Trigger 2-bar velvet breath riser before Exhale/Ignition drops into Lock/Ascent (Void/idle only)
            if ((_chapter === 'exhale' || _chapter === 'ignition') && bar === _chapterEndBar - 2 && _swellFiredForBar !== bar) {
                _swellFiredForBar = bar;
                _schedBreathSwell(_ac, time, 32 * stepSecs, inVoid ? 1.0 : 0.45);
            }
        }
        if (bar > 0 && bar % 4 === 0) {
            _mutateMotifCell();
        }
        // Trigger smooth voice-led overlapping analog ensemble pad every 6..8 bars
        if (bar >= _nextPadBar) {
            const isFirst = (bar === 0);
            const holdBars = isFirst ? 6 : (6 + Math.floor(_rng() * 3));
            _nextPadBar = bar + holdBars;
            _advanceChordMarkov();
            const chap = CHAPTER_SPEC[_chapter] || CHAPTER_SPEC.lock;
            const padLift = inFlowPlateau ? (0.70 - studyCtx.cocoon * 0.16 + studyCtx.bloom * 0.25) : chap.filter * (0.7 + 0.3 * tide);
            const padLv = vibe.padLevel * 5.2 * (inFlowPlateau ? 0.94 : chap.pad) * (0.84 + 0.20 * tide) * (inVoid ? 1.0 : 0.90);
            _schedAnalogEnsemblePad(_ac, time, _voicingMidi, holdBars * 16 * stepSecs, padLv, padLift, isFirst);
        }
    }

    const chap = CHAPTER_SPEC[_chapter] || CHAPTER_SPEC.lock;

    // Live Pact Preview or Solving-Mode Flow Plateau + Deep-Think Auto-Cocoon scaling
    let subScale = inFlowPlateau ? 0.88 : chap.sub;
    let bassScale = inFlowPlateau ? (0.84 - studyCtx.cocoon * 0.16) : chap.bass;
    let motifScale = inFlowPlateau ? (0.54 - studyCtx.cocoon * 0.36 + studyCtx.bloom * 0.35) : chap.motif;
    let percScale = inFlowPlateau ? (0.24 - studyCtx.cocoon * 0.20) : chap.perc;
    let filterOpen = inFlowPlateau
        ? clamp(0.66 - studyCtx.cocoon * 0.22 + studyCtx.bloom * 0.28, 0.32, 1.0)
        : chap.filter * (0.65 + 0.35 * tide);

    if (_pactPreviewActive) {
        const pv = clamp(_pactPreviewValue, 0, 100);
        if (pv <= 30) {
            subScale = 0.14; bassScale = 0.20; motifScale = 0.38; percScale = 0.05; filterOpen = 0.32;
        } else if (pv <= 62) {
            subScale = 0.72; bassScale = 0.72; motifScale = 0.68; percScale = 0.45; filterOpen = 0.64;
        } else if (pv <= 97) {
            subScale = 1.04; bassScale = 1.02; motifScale = 1.05; percScale = 0.90; filterOpen = 0.92;
        } else {
            subScale = 1.26; bassScale = 1.22; motifScale = 1.18; percScale = 1.22; filterOpen = 1.12;
        }
    }

    // In active solving (Flow Plateau), plateau values already trim motifs/perc cleanly
    const studyMotifTrim = (inVoid || inFlowPlateau) ? 1.0 : 0.56;
    const studyPercTrim = (inVoid || inFlowPlateau) ? 1.0 : 0.38;
    const studySubTrim = (inVoid || inFlowPlateau) ? 1.0 : 0.84;

    // 1. Felt-Mallet Sub-Thump + Sidechain Breathing
    const subGrid = SUB_GRIDS[vibe.subStyle] || SUB_GRIDS.steady;
    let subVel = subGrid[step];
    if (subVel === 0 && (step === 10 || step === 14) && chap.sub > 0.8 && _rng() < 0.20) {
        subVel = 0.32;
    }
    if (subVel > 0 && subScale > 0.06) {
        const thumpScale = (vibe.subLevel / 0.30) * subScale * studySubTrim;
        const duckAmt = (inVoid ? 0.20 : 0.13) * clamp(subScale, 0.2, 1.2);
        _schedSubThump(_ac, time, subVel, duckAmt, thumpScale);
    }

    // 2. Breathable Melodic Sub-Bass (anchored to active chord root/fifth)
    const bassGrid = BASS_GRIDS[vibe.bassStyle] || BASS_GRIDS.rolling;
    const bassVel = bassGrid[step];
    if (bassVel > 0 && bassScale > 0.12) {
        const chord = vibe.chords[_chordIdx % vibe.chords.length];
        const useFifth = (step === 6 || step === 14) && _rng() < 0.45;
        const bassPc = useFifth ? chord.pcs[2] : chord.pcs[0];
        let bMidi = _rootMidi() + bassPc;
        while (bMidi > 46) bMidi -= 12;
        while (bMidi < 31) bMidi += 12;
        const bDur = vibe.bassStyle === 'dronePulse' ? stepSecs * 4.5 : (step % 4 === 0 ? stepSecs * 2.1 : stepSecs * 1.4);
        const bLevel = (vibe.bassLevel / 0.16) * bassVel * bassScale * (inVoid ? 1.0 : 0.80);
        _schedRollingBass(_ac, time, midiToFreq(bMidi), bDur, bLevel, filterOpen);
    }

    // 3. Evolving Melodic Motif Cell (polyrhythmic length 8/11/12/13 -> phases cleanly against 16-step bars!)
    if (_motifCell && _motifCell.length > 0 && motifScale > 0.15) {
        const mIdx = stepIndex % _motifCell.length;
        const note = _motifCell[mIdx];
        if (note) {
            // Subtle organic probability breathing so motif feels performed by a human
            const playProb = _chapter === 'exhale' ? 0.52 : 0.88;
            if (_rng() < playProb) {
                const mFreq = _scaleFreq(note.deg, note.oct);
                const mVel = note.vel * (vibe.motifLevel / 0.115) * motifScale * studyMotifTrim;
                _schedMotifVoice(_ac, time, mFreq, mVel, note.pan, vibe.leadTimbre, filterOpen);
            }
        }
    }

    // 4. Organic Micro-Percussion Groove (Velvet Shaker + Wood Rim)
    if (percScale > 0.12 && vibe.percLevel > 0.005) {
        const shVel = SHAKER_GRID[step];
        if (shVel > 0 && _rng() < 0.86) {
            const sv = shVel * (vibe.percLevel / 0.030) * percScale * studyPercTrim;
            if (sv > 0.08) _schedVelvetShaker(_ac, time, sv, (step % 2 === 0) ? -0.26 : 0.26);
        }
        const rimVel = RIM_GRID[step];
        if (rimVel > 0 && _rng() < 0.68) {
            const rv = rimVel * (vibe.percLevel / 0.030) * percScale * studyPercTrim;
            if (rv > 0.12) _schedMicroRim(_ac, time, rv, (step === 6) ? -0.45 : 0.45);
        }
    }
}

function _schedulerTick() {
    if (!_running || !_enabled || !_ac || _ac.state !== 'running') return;
    if (typeof document !== 'undefined' && document.hidden) {
        _nextStepTime = _ac.currentTime + 0.05;
        return;
    }
    // Snap cleanly forward if JS timers were throttled by iOS inactivity (never schedule stacked past hits)
    if (_nextStepTime < _ac.currentTime - 0.04) {
        _nextStepTime = _ac.currentTime + 0.02;
    }
    const stepSecs = _stepSecs();
    let scheduled = 0;
    while (_nextStepTime < _ac.currentTime + SCHEDULE_AHEAD_SECS && scheduled < 2) {
        const swing = (_stepCounter % 2 === 1) ? stepSecs * 0.04 : 0;
        _scheduleStep(_stepCounter, Math.max(_ac.currentTime + 0.008, _nextStepTime + swing));
        _nextStepTime += stepSecs;
        _stepCounter += 1;
        scheduled += 1;
    }
}

// ── Context, Reservoir & Pact Preview Modulation ────────────────────────────
function _applyHealthModulation() {
    if (!_ac || !_masterGain || !_toneFilter) return;
    const v = _readVitalsSafe();
    _lastVitals = v;
    const now = _ac.currentTime;
    const hidden = typeof document !== 'undefined' && document.hidden;

    if (!_enabled || hidden) {
        _rampParam('master', _masterGain.gain, 0.0001, now, 0.12, 0.0001);
        _syncIosKeepalive(false);
        return;
    }

    if (v.flatlined) {
        _rampParam('master', _masterGain.gain, 0.26, now, 0.25, 0.005);
        _rampParam('tone', _toneFilter.frequency, _nyquistSafe(_ac, 320), now, 0.3, 12);
        if (_atmosGain) _rampParam('atmos', _atmosGain.gain, 0.02, now, 0.3, 0.003);
        if (_flatlineGain) _rampParam('flatline', _flatlineGain.gain, 0.032, now, 0.35, 0.002);
        return;
    }

    if (_flatlineGain) _rampParam('flatline', _flatlineGain.gain, 0.0001, now, 0.15, 0.0005);

    const vibe = _vibe();
    const inVoid = _isVoidActive();
    const studyCtx = _readStudyContext();
    const tide = _macroTide();
    const chap = CHAPTER_SPEC[_chapter] || CHAPTER_SPEC.lock;

    let targetVol = inVoid ? 0.46 : (v.frozen ? 0.34 : 0.36);
    let targetCutoff = inVoid
        ? (3600 + chap.filter * 2200)
        : (2550 - studyCtx.cocoon * 500 + studyCtx.bloom * 1000);
    let atmosTarget = vibe.atmosLevel * (inVoid ? (0.88 + 0.16 * tide) : (0.92 + studyCtx.cocoon * 0.18));
    let atmosCut = vibe.atmosCutoff * (inVoid ? (0.92 + 0.16 * tide) : (0.88 - studyCtx.cocoon * 0.08));

    // Subliminal Neural AM depth (7-12.5% -> gentle phase-locking, zero headphone flutter fatigue)
    const amDepth = clamp(
        vibe.neuralAmDepth + (studyCtx.solving ? 0.025 : 0) + studyCtx.cocoon * 0.02,
        0.05,
        0.13
    );

    if (_pactPreviewActive) {
        const pv = clamp(_pactPreviewValue, 0, 100);
        const norm = pv / 100;
        targetVol = 0.32 + norm * 0.24;
        targetCutoff = pv <= 30 ? 1500 : (pv <= 62 ? 3200 : (pv <= 97 ? 5200 : 6800));
        atmosTarget = vibe.atmosLevel * (0.78 + norm * 0.28);
        atmosCut = vibe.atmosCutoff * (0.85 + norm * 0.32);
    }

    // During Mario Recap, soften the Flow horizon like a warm velvet curtain so Mario's iconic
    // NES jingles sit crystal-clear on top with zero key clash (and never touch Mario's sound).
    if (_recapDuckActive) {
        targetCutoff = Math.min(targetCutoff, 980);
    }

    _rampParam('master', _masterGain.gain, targetVol, now, 0.24, 0.006);
    _rampParam('tone', _toneFilter.frequency, _nyquistSafe(_ac, targetCutoff), now, 0.26, 25);
    if (_atmosGain) _rampParam('atmos', _atmosGain.gain, atmosTarget, now, 0.32, 0.004);
    if (_atmosLpA) _rampParam('atmosLpA', _atmosLpA.frequency, _nyquistSafe(_ac, atmosCut), now, 0.35, 10);
    if (_atmosLpB) _rampParam('atmosLpB', _atmosLpB.frequency, _nyquistSafe(_ac, atmosCut * 1.18), now, 0.35, 10);
    if (_neuralAmBus) _rampParam('amBus', _neuralAmBus.gain, 1.0 - amDepth * 0.5, now, 0.35, 0.003);
    if (_neuralAmDepthGain) _rampParam('amDepth', _neuralAmDepthGain.gain, amDepth * 0.5, now, 0.35, 0.003);
    if (_neuralAmOsc) _rampParam('amHz', _neuralAmOsc.frequency, vibe.neuralAmHz, now, 0.4, 0.05);
}

function _startLoops() {
    if (_running || !_ac) return;
    _running = true;
    _nextStepTime = _ac.currentTime + 0.05;
    _lastWatchTime = _ac.currentTime;
    _stallCount = 0;
    if (_schedulerTimer) clearInterval(_schedulerTimer);
    _schedulerTimer = setInterval(_schedulerTick, LOOKAHEAD_MS);
    if (_modTimer) clearInterval(_modTimer);
    _modTimer = setInterval(_applyHealthModulation, 1000);
    if (_watchdogTimer) clearInterval(_watchdogTimer);
    _watchdogTimer = setInterval(_watchdogTick, 4000);
    _syncIosKeepalive(true);
    _applyHealthModulation();
}

function _stopLoops() {
    _running = false;
    if (_schedulerTimer) { clearInterval(_schedulerTimer); _schedulerTimer = null; }
    if (_modTimer) { clearInterval(_modTimer); _modTimer = null; }
    if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = null; }
    _syncIosKeepalive(false);
}

// ── UI Sync (Void HUD & Settings Vibe Picker) ───────────────────────────────
function _syncButtonUI() {
    if (typeof document === 'undefined') return;
    const vibe = _vibe();

    const btn = document.getElementById('hb-audio-btn');
    if (btn) {
        btn.classList.toggle('is-audio-on', _enabled);
        btn.classList.toggle('is-audio-off', !_enabled);
        btn.setAttribute('aria-pressed', _enabled ? 'true' : 'false');
        btn.title = _enabled ? 'Flow audio on — tap to mute' : 'Flow audio muted — tap to enable';
        const lbl = btn.querySelector('.hb-audio-lbl');
        if (lbl) lbl.textContent = _enabled ? 'AUDIO' : 'MUTED';
    }

    const vibeBtn = document.getElementById('hb-vibe-btn');
    if (vibeBtn) {
        vibeBtn.dataset.vibe = vibe.id;
        vibeBtn.style.setProperty('--hb-vibe-accent', vibe.accent);
        vibeBtn.classList.toggle('is-dimmed', !_enabled);
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
    if (_enabled) {
        unlockAudio();
    } else if (_ac && _masterGain) {
        _rampParam('master', _masterGain.gain, 0.0001, _ac.currentTime, 0.08, 0.0001);
        _stopLoops();
    }
    return _enabled;
}

export function toggleAudio() {
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

    // Seed fresh motif cell & smooth voice-leading for the newly chosen vibe
    const vibe = _vibe();
    _chordIdx = 0;
    _motifCell = _seedMotifCell(vibe);
    _voicingMidi = _voiceLeadChord(vibe.chords[0].pcs, _rootMidi(), _voicingMidi);
    _nextPadBar = _barCount; // invite the new vibe's pad cleanly on the very next bar
    _syncButtonUI();
    try {
        if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('hb:vibe-change', { detail: { vibe: _vibeId } }));
        }
    } catch (_) {}

    if (_enabled) {
        if (!_ac || _ac.state !== 'running') {
            unlockAudio();
        } else if (_graphBuilt) {
            const now = _ac.currentTime;
            const step = _stepSecs();
            try {
                if (_atmosGain) _rampParam('atmos', _atmosGain.gain, vibe.atmosLevel, now, 0.35, 0.001);
                if (_atmosLpA) _rampParam('atmosLpA', _atmosLpA.frequency, _nyquistSafe(_ac, vibe.atmosCutoff), now, 0.35, 1);
                if (_atmosLpB) _rampParam('atmosLpB', _atmosLpB.frequency, _nyquistSafe(_ac, vibe.atmosCutoff * 1.18), now, 0.35, 1);
                if (_neuralAmOsc) _rampParam('amHz', _neuralAmOsc.frequency, vibe.neuralAmHz, now, 0.4, 0.01);
                if (_neuralAmBus) _rampParam('amBus', _neuralAmBus.gain, 1.0 - vibe.neuralAmDepth * 0.5, now, 0.35, 0.001);
                if (_neuralAmDepthGain) _rampParam('amDepth', _neuralAmDepthGain.gain, vibe.neuralAmDepth * 0.5, now, 0.35, 0.001);
                if (_reverbWet) _rampParam('revWet', _reverbWet.gain, vibe.reverbWet, now, 0.35, 0.001);
                if (_shimmerWet) _rampParam('shimWet', _shimmerWet.gain, vibe.shimmerLevel, now, 0.35, 0.001);
                if (_delayWet) _rampParam('delWet', _delayWet.gain, vibe.delayWet, now, 0.35, 0.001);
                if (_delayL) _rampParam('delL', _delayL.delayTime, clamp(step * 3, 0.06, 1.45), now, 0.25, 0.001);
                if (_delayR) _rampParam('delR', _delayR.delayTime, clamp(step * 3, 0.06, 1.45), now, 0.25, 0.001);
                if (_tapeDrive) _tapeDrive.curve = _makeTapeCurve(vibe.drive);
            } catch (_) {}
            _applyHealthModulation();
            // Signature 2-note stereo preview in the new vibe's actual lead timbre
            try {
                _schedMotifVoice(_ac, now + 0.02, _scaleFreq(2, 2), 0.78, -0.35, vibe.leadTimbre, 0.85);
                _schedMotifVoice(_ac, now + 0.11, _scaleFreq(4, 3), 0.72, +0.35, vibe.leadTimbre, 0.92);
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

// ── Tactile Precision SFX, Unified Studio UI/Solve Engine & Pact Seal ───────

function _ensureFallbackSfxBus(fxAc) {
    if (!fxAc) return null;
    const cached = _fallbackSfxMap ? _fallbackSfxMap.get(fxAc) : fxAc.__jmaxFallbackSfx;
    if (cached) return cached;

    const out = fxAc.createGain();
    out.gain.value = 0.96;

    const hp = fxAc.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 50;

    const warmth = fxAc.createBiquadFilter();
    warmth.type = 'peaking';
    warmth.frequency.value = 118;
    warmth.Q.value = 0.85;
    warmth.gain.value = 1.0;

    const clarity = fxAc.createBiquadFilter();
    clarity.type = 'peaking';
    clarity.frequency.value = 220;
    clarity.Q.value = 0.9;
    clarity.gain.value = -2.2;

    const air = fxAc.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 5600;
    air.gain.value = -1.8;

    const comp = fxAc.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 20;
    comp.ratio.value = 2.5;
    comp.attack.value = 0.008;
    comp.release.value = 0.18;

    out.connect(hp);
    hp.connect(warmth);
    warmth.connect(clarity);
    clarity.connect(air);
    air.connect(comp);
    comp.connect(fxAc.destination);

    // Lightweight 1.15s stereo Mini Velvet Room so SFX stay lush even when Flow music is muted
    let rev = null;
    try {
        const sr = fxAc.sampleRate;
        const secs = 1.15;
        const len = Math.floor(sr * secs);
        const ir = fxAc.createBuffer(2, len, sr);
        for (let c = 0; c < 2; c++) {
            const data = ir.getChannelData(c);
            let lp = 0, hpS = 0;
            for (let i = 0; i < len; i++) {
                const t = i / len;
                const bloom = Math.min(1, (i / sr) / 0.018);
                const env = Math.pow(1 - t, 2.35) * bloom;
                const raw = (Math.random() + Math.random() - 1) * env;
                const damp = (c === 0 ? 0.34 : 0.31) * Math.pow(1 - t, 1.2) + 0.05;
                lp += (raw - lp) * damp;
                hpS += (lp - hpS) * 0.02;
                data[i] = (lp - hpS) * 1.35;
            }
        }
        const conv = fxAc.createConvolver();
        conv.buffer = ir;
        const revSend = fxAc.createGain();
        revSend.gain.value = 0.85;
        const revWet = fxAc.createGain();
        revWet.gain.value = 0.32;
        revSend.connect(conv);
        conv.connect(revWet);
        revWet.connect(clarity);
        rev = revSend;
    } catch (_) { rev = null; }

    const nLen = Math.max(64, Math.floor(fxAc.sampleRate * 0.35));
    const noise = fxAc.createBuffer(1, nLen, fxAc.sampleRate);
    const ch = noise.getChannelData(0);
    for (let i = 0; i < nLen; i++) ch[i] = Math.random() * 2 - 1;

    const bundle = { out, rev, noise };
    if (_fallbackSfxMap) _fallbackSfxMap.set(fxAc, bundle);
    else fxAc.__jmaxFallbackSfx = bundle;
    return bundle;
}

function _resolveSfxCtx(opts = {}) {
    const ignoreFxGate = Boolean(opts && opts.ignoreFxGate);
    let fxVol = 0.7;
    try {
        if (typeof window !== 'undefined' && window.FX) {
            if (!ignoreFxGate && typeof window.FX.wantSound === 'function' && !window.FX.wantSound()) {
                return null;
            }
            if (typeof window.FX.vol === 'function') fxVol = window.FX.vol();
        }
    } catch (_) {}
    if (opts && typeof opts.vol === 'number' && Number.isFinite(opts.vol)) {
        fxVol = clamp(opts.vol, 0, 1);
    }
    if (fxVol <= 0.001) return null;

    if (_enabled) {
        const ac = _buildGraph();
        if (ac && ac.state !== 'closed') {
            if (ac.state !== 'running') {
                try { ac.resume().catch(() => {}); } catch (_) {}
            }
            const mCur = (_masterGain && Number.isFinite(_masterGain.gain.value) && _masterGain.gain.value > 0.08)
                ? _masterGain.gain.value : 0.38;
            const gainScale = clamp((fxVol / 0.7) * (0.44 / clamp(mCur, 0.24, 0.55)), 0, 2.0);
            return {
                ac,
                out: _sfxBus || ac.destination,
                rev: _reverbSend,
                del: _delaySend,
                shim: _shimmerSend,
                noise: _crispNoiseBuffer,
                gainScale,
                isFxFallback: false,
            };
        }
    }
    try {
        if (typeof window !== 'undefined' && window.FX) {
            const fxAc = typeof window.FX.ctx === 'function' ? window.FX.ctx() : null;
            if (fxAc && fxAc.state !== 'closed') {
                if (fxAc.state !== 'running') {
                    try { fxAc.resume().catch(() => {}); } catch (_) {}
                }
                const fb = _ensureFallbackSfxBus(fxAc);
                const gainScale = clamp((fxVol / 0.7) * 0.56, 0, 1.25);
                return {
                    ac: fxAc,
                    out: fb ? fb.out : fxAc.destination,
                    rev: fb ? fb.rev : null,
                    del: null,
                    shim: null,
                    noise: fb ? fb.noise : null,
                    gainScale,
                    isFxFallback: true,
                };
            }
        }
    } catch (_) {}
    return null;
}

function _sfxConnectSends(ctxInfo, srcNode, cleanList, revAmt, delAmt, shimAmt) {
    const { ac, out, rev, del, shim } = ctxInfo;
    srcNode.connect(out);
    if (rev && revAmt > 0.01) {
        const rg = ac.createGain();
        rg.gain.value = clamp(revAmt, 0, 1.0);
        srcNode.connect(rg).connect(rev);
        cleanList.push(rg);
    }
    if (del && delAmt > 0.01) {
        const dg = ac.createGain();
        dg.gain.value = clamp(delAmt, 0, 0.85);
        srcNode.connect(dg).connect(del);
        cleanList.push(dg);
    }
    if (shim && shimAmt > 0.01) {
        const sg = ac.createGain();
        sg.gain.value = clamp(shimAmt, 0, 0.85);
        srcNode.connect(sg).connect(shim);
        cleanList.push(sg);
    }
}

/** Pure fatigue-free tonal voice (sine/triangle only, soft attack, explicit onended disconnect). */
function _sfxTone(ctxInfo, p) {
    const { ac, gainScale } = ctxInfo;
    const t = Math.max(ac.currentTime, p.start != null ? p.start : ac.currentTime);
    const dur = Math.max(0.016, p.dur || 0.12);
    const atk = clamp(p.atk != null ? p.atk : 0.005, 0.003, dur * 0.45);
    const peak = clamp((p.amp != null ? p.amp : 0.10) * gainScale, 0.0002, 0.42);

    const osc = ac.createOscillator();
    osc.type = p.type === 'triangle' ? 'triangle' : 'sine';
    const f1 = Math.max(36, p.freq || 440);
    osc.frequency.setValueAtTime(f1, t);
    if (p.freq2) osc.frequency.exponentialRampToValueAtTime(Math.max(36, p.freq2), t + dur);

    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const cleanList = [osc, g];
    let chain = osc;
    if (p.lpFreq && p.lpFreq > 0) {
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = clamp(p.lpQ || 0.72, 0.5, 1.4);
        lp.frequency.setValueAtTime(_nyquistSafe(ac, p.lpFreq), t);
        if (p.lpFreq2) lp.frequency.exponentialRampToValueAtTime(_nyquistSafe(ac, Math.max(80, p.lpFreq2)), t + dur);
        chain.connect(lp);
        chain = lp;
        cleanList.push(lp);
    }
    const pan = _createStereoPanner(ac, p.pan || 0);
    chain.connect(pan);
    pan.connect(g);
    cleanList.push(pan);

    _sfxConnectSends(ctxInfo, g, cleanList, p.revAmt || 0, p.delAmt || 0, p.shimAmt || 0);
    _autoDisconnect(osc, cleanList);
    osc.start(t);
    osc.stop(t + dur + 0.04);
}

/** Luminous warm Rhodes / Celesta harmonic note (pure 1x + soft 2x/3x overtones, zero metallic clang). */
function _sfxRhodes(ctxInfo, p) {
    const { ac, gainScale } = ctxInfo;
    const t = Math.max(ac.currentTime, p.start != null ? p.start : ac.currentTime);
    const dur = Math.max(0.04, p.dur || 0.30);
    const freq = Math.max(80, p.freq || 587.33);
    const peak = clamp((p.amp != null ? p.amp : 0.09) * gainScale, 0.0002, 0.34);

    const o1 = ac.createOscillator();
    const o2 = ac.createOscillator();
    const g1 = ac.createGain();
    const g2 = ac.createGain();
    const sum = ac.createGain();
    const pan = _createStereoPanner(ac, p.pan || 0);

    o1.type = 'sine';
    o2.type = 'sine';
    o1.frequency.setValueAtTime(freq, t);
    o2.frequency.setValueAtTime(freq * 2.0, t);

    const atk = clamp(p.atk != null ? p.atk : 0.006, 0.003, 0.03);
    g1.gain.setValueAtTime(0.0001, t);
    g1.gain.linearRampToValueAtTime(peak, t + atk);
    g1.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const ovAmp = clamp(peak * (p.overtone != null ? p.overtone : 0.24), 0.0001, 0.14);
    const ovDur = Math.max(0.035, dur * 0.44);
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.linearRampToValueAtTime(ovAmp, t + atk);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + ovDur);

    o1.connect(g1).connect(sum);
    o2.connect(g2).connect(sum);
    sum.connect(pan);

    const cleanList = [o1, o2, g1, g2, sum, pan];
    _sfxConnectSends(ctxInfo, pan, cleanList, p.revAmt != null ? p.revAmt : 0.38, p.delAmt || 0, p.shimAmt || 0);
    _autoDisconnect(o1, cleanList);
    o1.start(t); o2.start(t);
    o1.stop(t + dur + 0.05); o2.stop(t + ovDur + 0.05);
}

/** Silky paper/felt air breath (low-Q warm bandpass, zero piercing hiss). */
function _sfxAir(ctxInfo, p) {
    if (!ctxInfo.noise) return;
    const { ac, gainScale } = ctxInfo;
    const t = Math.max(ac.currentTime, p.start != null ? p.start : ac.currentTime);
    const dur = Math.max(0.012, p.dur || 0.04);
    const peak = clamp((p.amp != null ? p.amp : 0.025) * gainScale, 0.0001, 0.12);

    const src = ac.createBufferSource();
    src.buffer = ctxInfo.noise;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = clamp(p.bpQ || 0.85, 0.5, 1.6);
    bp.frequency.setValueAtTime(_nyquistSafe(ac, p.bpFreq || 1650), t);
    if (p.bpFreq2) bp.frequency.exponentialRampToValueAtTime(_nyquistSafe(ac, Math.max(180, p.bpFreq2)), t + dur);

    const pan = _createStereoPanner(ac, p.pan || 0);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(0.008, dur * 0.35));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(bp).connect(pan).connect(g);
    const cleanList = [src, bp, pan, g];
    _sfxConnectSends(ctxInfo, g, cleanList, p.revAmt != null ? p.revAmt : 0.22, 0, 0);
    _autoDisconnect(src, cleanList);
    src.start(t, Math.random() * 0.16, dur + 0.025);
}

/**
 * Unified Studio UI, Gameplay & Timer SFX Engine.
 * Every interaction across the entire app shares the live Circle-of-Fifths scale,
 * Velvet Hall acoustic space, warmth/clarity EQ, and zero-leak cleanup.
 */
export function playUiSfx(name, opts = {}) {
    const ctxInfo = _resolveSfxCtx(opts);
    if (!ctxInfo) return false;
    const now = ctxInfo.ac.currentTime;

    switch (name) {
        case 'click':
            _sfxTone(ctxInfo, { freq: 255, freq2: 108, dur: 0.040, amp: 0.125, atk: 0.003, revAmt: 0.16 });
            _sfxAir(ctxInfo, { dur: 0.014, amp: 0.030, bpFreq: 1850, bpQ: 1.0, revAmt: 0.12 });
            return true;

        case 'soft':
            _sfxTone(ctxInfo, { freq: 225, freq2: 126, dur: 0.048, amp: 0.088, atk: 0.005, revAmt: 0.20 });
            _sfxAir(ctxInfo, { dur: 0.015, amp: 0.018, bpFreq: 1450, bpQ: 0.9, revAmt: 0.14 });
            return true;

        case 'tick':
            _sfxTone(ctxInfo, { freq: 285, freq2: 162, dur: 0.022, amp: 0.068, atk: 0.003, revAmt: 0.12 });
            _sfxTone(ctxInfo, { freq: _scaleFreq(4, 3), dur: 0.032, amp: 0.068, atk: 0.003, revAmt: 0.18 });
            return true;

        case 'hover':
            _sfxTone(ctxInfo, { freq: _scaleFreq(4, 3) * 1.25, dur: 0.022, amp: 0.024, atk: 0.004, revAmt: 0.24 });
            return true;

        case 'blip':
            _sfxRhodes(ctxInfo, { freq: _scaleFreq(2, 3), dur: 0.068, amp: 0.078, overtone: 0.20, revAmt: 0.28 });
            return true;

        case 'select':
            _sfxTone(ctxInfo, { freq: 310, freq2: 175, dur: 0.036, amp: 0.072, atk: 0.003, revAmt: 0.16 });
            _sfxRhodes(ctxInfo, { freq: _scaleFreq(2, 3), start: now + 0.003, dur: 0.092, amp: 0.076, overtone: 0.22, revAmt: 0.28 });
            return true;

        case 'toggle':
            _sfxTone(ctxInfo, { freq: 240, freq2: 148, dur: 0.028, amp: 0.068, atk: 0.003, revAmt: 0.16 });
            _sfxRhodes(ctxInfo, { freq: _scaleFreq(4, 3), start: now + 0.022, dur: 0.068, amp: 0.074, overtone: 0.20, revAmt: 0.28 });
            return true;

        case 'tab':
            // Silky luminous harmonic fifth glide + whisper paper turn (replaces sawtooth bandpass fart!)
            _sfxRhodes(ctxInfo, { freq: _scaleFreq(0, 3), start: now, dur: 0.115, amp: 0.068, atk: 0.007, pan: -0.18, overtone: 0.20, revAmt: 0.40 });
            _sfxRhodes(ctxInfo, { freq: _scaleFreq(4, 3), start: now + 0.034, dur: 0.175, amp: 0.062, atk: 0.008, pan: 0.18, overtone: 0.22, revAmt: 0.44, delAmt: 0.10 });
            _sfxAir(ctxInfo, { start: now, dur: 0.058, amp: 0.020, bpFreq: 1350, bpFreq2: 2050, bpQ: 0.72, revAmt: 0.28 });
            return true;

        case 'modalClose':
            // Calm descending felt hush + soft low-passed air exhale
            _sfxTone(ctxInfo, { freq: _scaleFreq(4, 2), freq2: _scaleFreq(0, 2), dur: 0.125, amp: 0.082, atk: 0.007, revAmt: 0.34 });
            _sfxAir(ctxInfo, { start: now + 0.004, dur: 0.092, amp: 0.022, bpFreq: 920, bpFreq2: 390, bpQ: 0.68, revAmt: 0.26 });
            return true;

        case 'delete':
            // Clean damped warm wood/marimba descending two-note drop (zero buzzy sawtooth!)
            _sfxTone(ctxInfo, { freq: 152, freq2: 74, dur: 0.082, amp: 0.088, atk: 0.005, revAmt: 0.18 });
            _sfxTone(ctxInfo, { type: 'triangle', freq: _scaleFreq(2, 2), freq2: _scaleFreq(2, 2) * 0.94, start: now, dur: 0.11, amp: 0.086, atk: 0.006, lpFreq: 560, lpFreq2: 280, pan: 0.12, revAmt: 0.24 });
            _sfxTone(ctxInfo, { freq: _scaleFreq(0, 2) * 0.89, freq2: _scaleFreq(0, 2) * 0.84, start: now + 0.042, dur: 0.145, amp: 0.082, atk: 0.006, pan: -0.12, revAmt: 0.26 });
            return true;

        case 'confirm':
            _sfxTone(ctxInfo, { freq: 124, freq2: 58, dur: 0.095, amp: 0.135, atk: 0.005, revAmt: 0.20 });
            _sfxRhodes(ctxInfo, { freq: _scaleFreq(0, 3), start: now + 0.008, dur: 0.24, amp: 0.092, pan: -0.20, overtone: 0.24, revAmt: 0.42, delAmt: 0.14 });
            _sfxRhodes(ctxInfo, { freq: _scaleFreq(4, 3), start: now + 0.056, dur: 0.32, amp: 0.094, pan: 0.22, overtone: 0.26, revAmt: 0.46, delAmt: 0.18 });
            return true;

        case 'success':
            duck(0.55, 0.55);
            _sfxTone(ctxInfo, { freq: 120, freq2: 54, dur: 0.18, amp: 0.155, atk: 0.006, revAmt: 0.24 });
            [0, 2, 4].forEach((deg, idx) => {
                _sfxRhodes(ctxInfo, {
                    freq: _scaleFreq(deg, 3),
                    start: now + 0.012 + idx * 0.058,
                    dur: 0.36 + idx * 0.08,
                    amp: 0.096,
                    pan: (idx - 1) * 0.28,
                    overtone: 0.26,
                    revAmt: 0.50,
                    delAmt: 0.22,
                    shimAmt: idx === 2 ? 0.24 : 0,
                });
            });
            return true;

        case 'modeFlow':
            duck(0.45, 0.58);
            _sfxTone(ctxInfo, { freq: 98, freq2: 56, dur: 0.20, amp: 0.145, atk: 0.010, revAmt: 0.28 });
            [0, 2, 4].forEach((deg, idx) => {
                _sfxRhodes(ctxInfo, {
                    freq: _scaleFreq(deg, idx === 2 ? 3 : 2),
                    start: now + idx * 0.044,
                    dur: 0.42,
                    amp: 0.095,
                    pan: (idx - 1) * 0.26,
                    overtone: 0.22,
                    revAmt: 0.50,
                    delAmt: 0.18,
                    shimAmt: 0.22,
                });
            });
            return true;

        case 'modeHardcore':
            duck(0.65, 0.42);
            _sfxTone(ctxInfo, { freq: 136, freq2: 44, dur: 0.28, amp: 0.24, atk: 0.005, revAmt: 0.28 });
            _sfxTone(ctxInfo, { type: 'triangle', freq: _rootHz() * 2, dur: 0.30, amp: 0.115, atk: 0.006, lpFreq: 1100, lpFreq2: 260, pan: -0.18, revAmt: 0.34 });
            _sfxTone(ctxInfo, { type: 'triangle', freq: _rootHz() * 3, dur: 0.32, amp: 0.095, atk: 0.006, lpFreq: 1200, lpFreq2: 290, pan: 0.18, revAmt: 0.34 });
            _sfxRhodes(ctxInfo, { freq: _scaleFreq(4, 3), start: now + 0.032, dur: 0.34, amp: 0.096, pan: -0.24, overtone: 0.28, revAmt: 0.48, delAmt: 0.20 });
            _sfxRhodes(ctxInfo, { freq: _scaleFreq(6, 3), start: now + 0.072, dur: 0.40, amp: 0.092, pan: 0.24, overtone: 0.26, revAmt: 0.50, delAmt: 0.22 });
            return true;

        case 'holdTick': {
            const isCrit = Boolean(opts && opts.crit);
            _sfxTone(ctxInfo, { freq: 270, freq2: 155, dur: 0.018, amp: 0.052, atk: 0.003, revAmt: 0.12 });
            _sfxTone(ctxInfo, { freq: isCrit ? _scaleFreq(6, 3) : _scaleFreq(4, 3), dur: 0.028, amp: 0.060, atk: 0.003, revAmt: 0.20 });
            return true;
        }

        case 'correct': {
            const st = clamp(Number(opts && opts.streak) || 1, 1, 6);
            const baseDeg = st - 1;
            const octBase = st >= 5 ? 3 : 2;
            const octHi = 3;
            duck(0.48, 0.56);
            // Soft rounded felt chest confirm
            _sfxTone(ctxInfo, { freq: 114, freq2: 54, dur: 0.145, amp: 0.155, atk: 0.005, revAmt: 0.22 });
            // Luminous harmonic Rhodes interval climbing cleanly with streak in the active Flow key
            _sfxRhodes(ctxInfo, {
                freq: _scaleFreq(baseDeg, octBase + (st >= 5 ? 0 : 1)),
                start: now + 0.004,
                dur: 0.34,
                amp: 0.105,
                pan: -0.22,
                overtone: 0.25,
                revAmt: 0.48,
                delAmt: 0.20,
            });
            _sfxRhodes(ctxInfo, {
                freq: _scaleFreq(baseDeg + 2, octHi),
                start: now + 0.058,
                dur: 0.44,
                amp: 0.112,
                pan: 0.26,
                overtone: 0.28,
                revAmt: 0.52,
                delAmt: 0.24,
                shimAmt: st >= 3 ? 0.22 : 0,
            });
            if (st >= 3) {
                _sfxRhodes(ctxInfo, {
                    freq: _scaleFreq(baseDeg + 4, octHi),
                    start: now + 0.112,
                    dur: 0.50,
                    amp: 0.088,
                    pan: 0,
                    overtone: 0.24,
                    revAmt: 0.56,
                    delAmt: 0.26,
                    shimAmt: 0.30,
                });
            }
            return true;
        }

        case 'super': {
            // Critical Hit / Tier Up: crystalline felt-pin sparkle -> 26ms breath -> warm sub bloom + stereo Maj9 shimmer
            duck(0.85, 0.40);
            _sfxTone(ctxInfo, { freq: _scaleFreq(4, 4), dur: 0.032, amp: 0.068, atk: 0.003, revAmt: 0.30 });
            _sfxAir(ctxInfo, { dur: 0.018, amp: 0.034, bpFreq: 2200, bpQ: 1.0, revAmt: 0.20 });

            const t0 = now + 0.036;
            _sfxTone(ctxInfo, { freq: 126, freq2: 44, start: t0, dur: 0.36, amp: 0.24, atk: 0.007, revAmt: 0.30 });
            const chord = [
                { deg: 0, oct: 2, pan: -0.44, amp: 0.105 },
                { deg: 2, oct: 3, pan: -0.16, amp: 0.100 },
                { deg: 4, oct: 3, pan: 0.18, amp: 0.102 },
                { deg: 6, oct: 3, pan: 0.46, amp: 0.094 },
            ];
            chord.forEach((n, idx) => {
                _sfxRhodes(ctxInfo, {
                    freq: _scaleFreq(n.deg, n.oct),
                    start: t0 + idx * 0.022,
                    dur: 0.72,
                    amp: n.amp,
                    pan: n.pan,
                    overtone: 0.28,
                    revAmt: 0.58,
                    delAmt: 0.30,
                    shimAmt: 0.38,
                });
            });
            return true;
        }

        case 'wrong':
            // Calm, tilt-proof muted low marimba/felt double-knock (never a buzzer, fart, or 2% silence drop!)
            duck(0.42, 0.50);
            _sfxTone(ctxInfo, { freq: 108, freq2: 64, start: now, dur: 0.092, amp: 0.092, atk: 0.005, revAmt: 0.18 });
            _sfxTone(ctxInfo, {
                type: 'triangle',
                freq: _scaleFreq(2, 2),
                freq2: _scaleFreq(2, 2) * 0.96,
                start: now,
                dur: 0.115,
                amp: 0.118,
                atk: 0.006,
                lpFreq: 480,
                lpFreq2: 260,
                pan: -0.10,
                revAmt: 0.22,
            });
            _sfxTone(ctxInfo, {
                type: 'triangle',
                freq: _scaleFreq(0, 2),
                freq2: _scaleFreq(0, 2) * 0.94,
                start: now + 0.078,
                dur: 0.165,
                amp: 0.108,
                atk: 0.007,
                lpFreq: 440,
                lpFreq2: 210,
                pan: 0.10,
                revAmt: 0.26,
            });
            return true;

        case 'bell': {
            // Warm hand-hammered studio singing bowl / resonant glass bell (zero metallic 2.756/1.414 clang!)
            duck(1.5, 0.34);
            const fRoot = _scaleFreq(0, 2);
            const fFifth = _scaleFreq(4, 2);
            const fOct = _scaleFreq(0, 3);
            const fHiFifth = _scaleFreq(4, 3);
            _sfxTone(ctxInfo, { freq: fRoot, start: now, dur: 2.55, amp: 0.125, atk: 0.018, pan: -0.18, revAmt: 0.65, shimAmt: 0.36 });
            _sfxTone(ctxInfo, { freq: fRoot * 1.0045, start: now, dur: 2.35, amp: 0.068, atk: 0.022, pan: 0.18, revAmt: 0.65 });
            _sfxTone(ctxInfo, { freq: fFifth, start: now + 0.018, dur: 2.25, amp: 0.088, atk: 0.018, pan: 0.24, revAmt: 0.64, shimAmt: 0.42 });
            _sfxRhodes(ctxInfo, { freq: fOct, start: now + 0.17, dur: 1.85, amp: 0.072, atk: 0.016, pan: -0.26, overtone: 0.20, revAmt: 0.66, delAmt: 0.22, shimAmt: 0.45 });
            _sfxRhodes(ctxInfo, { freq: fHiFifth, start: now + 0.24, dur: 1.65, amp: 0.056, atk: 0.016, pan: 0.28, overtone: 0.18, revAmt: 0.66, delAmt: 0.22, shimAmt: 0.45 });
            return true;
        }

        case 'startChime':
            // Uplifting warm harmonic swell + resolving fifth for starting a focus block
            duck(0.85, 0.45);
            _sfxTone(ctxInfo, { freq: _rootHz() * 2, freq2: _rootHz() * 3, start: now, dur: 0.36, amp: 0.115, atk: 0.042, revAmt: 0.48 });
            [0, 2, 4].forEach((deg, idx) => {
                _sfxRhodes(ctxInfo, {
                    freq: _scaleFreq(deg, idx === 2 ? 3 : 2),
                    start: now + 0.03 + idx * 0.078,
                    dur: 0.68,
                    amp: 0.095,
                    pan: (idx - 1) * 0.30,
                    overtone: 0.22,
                    revAmt: 0.56,
                    delAmt: 0.24,
                    shimAmt: idx === 2 ? 0.32 : 0.16,
                });
            });
            return true;

        case 'galleryChime':
            [0, 2, 4].forEach((deg, idx) => {
                _sfxRhodes(ctxInfo, {
                    freq: _scaleFreq(deg, 3),
                    start: now + idx * 0.115,
                    dur: 1.25,
                    amp: 0.074,
                    atk: 0.018,
                    pan: (idx - 1) * 0.32,
                    overtone: 0.16,
                    revAmt: 0.62,
                    shimAmt: 0.34,
                });
            });
            return true;

        default:
            return false;
    }
}

/** Tactile damped ceramic switch click. */
export function playClick() {
    if (playUiSfx('click', { ignoreFxGate: true })) return;
}

/** Warm 3-stage harmonic lock sound (Pact / Heartbeat feed). */
export function playChamberLoad() {
    if (!_enabled) return;
    const ac = _buildGraph();
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;

    const sub = ac.createOscillator();
    const sg = ac.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(122, now + 0.07);
    sub.frequency.exponentialRampToValueAtTime(42, now + 0.26);
    sg.gain.setValueAtTime(0.0001, now + 0.07);
    sg.gain.linearRampToValueAtTime(0.28, now + 0.08);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.30);
    sub.connect(sg).connect(_sfxBus || ac.destination);
    _autoDisconnect(sub, [sub, sg]);
    sub.start(now + 0.07);
    sub.stop(now + 0.33);

    const timbre = _vibe().leadTimbre;
    [0, 2, 4].forEach((deg, idx) => {
        _schedMotifVoice(ac, now + idx * 0.048, _scaleFreq(deg, 2), 0.78 + idx * 0.12, (idx - 1) * 0.32, timbre, 0.88);
    });
}

/** Luminous warm sub-bloom + voice-led Maj9 shimmer on audio ignition. */
export function playBootIgnition() {
    if (!_enabled) return;
    const ac = _buildGraph();
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;

    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(40, now);
    osc.frequency.exponentialRampToValueAtTime(_rootHz(), now + 0.32);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.24, now + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);
    osc.connect(g).connect(_sfxBus || ac.destination);
    if (_reverbSend) g.connect(_reverbSend);
    _autoDisconnect(osc, [osc, g]);
    osc.start(now);
    osc.stop(now + 1.3);

    const timbre = _vibe().leadTimbre;
    [0, 2, 4, 6].forEach((deg, idx) => {
        _schedMotifVoice(ac, now + 0.04 + idx * 0.065, _scaleFreq(deg, 2), 0.65, (idx - 1.5) * 0.32, timbre, 0.82);
    });
}

/** Soft low power-down drop on 0.0h Flatline. */
export function playFlatlineDrop() {
    if (!_enabled) return;
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
    _autoDisconnect(osc, [osc, lp, g]);
    osc.start(now);
    osc.stop(now + 1.15);
}

/**
 * Tactile layered bass bumps + resonant analog plucks on the Pact / Live Flow slider (0..100).
 * Escalates physically across Rest (0-30), Steady (31-62), Flow (63-97), and Hardcore (98-100).
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

    if (_enabled && (!_ac || _ac.state !== 'running')) {
        try { unlockAudio(); } catch (_) {}
    }

    const ctxInfo = _resolveSfxCtx({ ignoreFxGate: _enabled });
    if (!ctxInfo) return;
    const { ac, out, rev, del, shim, isFxFallback } = ctxInfo;
    const now = ac.currentTime;
    const norm = next / 100;
    const isUp = next >= prev;
    const ctxScale = opts && opts.context === 'live' ? 0.50 : 1.0;
    const fxVol = isFxFallback && typeof window !== 'undefined' && window.FX && typeof window.FX.vol === 'function'
        ? window.FX.vol() : 1.0;
    const scale = ctxScale * fxVol;

    // 1. Chest Sub-Bass Bump (heavier, deeper & punchier as 0 -> 100 climbs)
    const sub = ac.createOscillator();
    const subG = ac.createGain();
    sub.type = 'sine';
    const startHz = isUp ? (92 + norm * 68) : (84 + norm * 32);
    const endHz = Math.max(30, 46 - norm * 12);
    sub.frequency.setValueAtTime(startHz, now);
    sub.frequency.exponentialRampToValueAtTime(endHz, now + (isUp ? 0.095 : 0.065));

    const subAmp = clamp((isUp ? (0.12 + norm * 0.26) : (0.07 + norm * 0.11)) * scale, 0.001, 0.42);
    subG.gain.setValueAtTime(0.0001, now);
    subG.gain.linearRampToValueAtTime(subAmp, now + 0.004);
    subG.gain.exponentialRampToValueAtTime(0.0001, now + (0.12 + norm * 0.08));
    sub.connect(subG).connect(out);
    _autoDisconnect(sub, [sub, subG]);
    sub.start(now);
    sub.stop(now + 0.22);

    // 2. Above 62 (Flow / Hardcore): add resonant Moog bass-pluck layer on upward ticks
    if (isUp && next >= 63) {
        const moog = ac.createOscillator();
        const mlp = ac.createBiquadFilter();
        const mg = ac.createGain();
        const bFreq = _rootHz() * (next >= 98 ? 1.5 : 2.0);
        moog.type = 'sawtooth';
        moog.frequency.setValueAtTime(bFreq, now);
        mlp.type = 'lowpass';
        mlp.Q.value = 3.2;
        mlp.frequency.setValueAtTime(_nyquistSafe(ac, 420 + norm * 900), now);
        mlp.frequency.exponentialRampToValueAtTime(110, now + 0.11);
        mg.gain.setValueAtTime(0.0001, now);
        mg.gain.linearRampToValueAtTime(0.11 * scale, now + 0.004);
        mg.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
        moog.connect(mlp).connect(mg).connect(out);
        _autoDisconnect(moog, [moog, mlp, mg]);
        moog.start(now);
        moog.stop(now + 0.14);
    }

    // 3. Ascending Lydian Resonant Pluck climbing across 0..100 into stereo ping-pong delay
    const stepDeg = Math.min(13, Math.floor(norm * 14));
    const scaleArr = _vibe().scale;
    const oct = Math.floor(stepDeg / scaleArr.length) + 2;
    const deg = stepDeg % scaleArr.length;
    const pluckFreq = _scaleFreq(deg, oct);

    const pOsc = ac.createOscillator();
    const pLp = ac.createBiquadFilter();
    const pG = ac.createGain();
    pOsc.type = isUp ? (next >= 63 ? 'sawtooth' : 'triangle') : 'sine';
    pOsc.frequency.setValueAtTime(pluckFreq, now);
    pLp.type = 'lowpass';
    pLp.Q.value = isUp ? 2.2 : 1.0;
    pLp.frequency.setValueAtTime(_nyquistSafe(ac, isUp ? (1300 + norm * 3000) : 900), now);
    pLp.frequency.exponentialRampToValueAtTime(320, now + (isUp ? 0.18 : 0.10));

    const pAmp = clamp((isUp ? (0.048 + norm * 0.058) : 0.028) * scale, 0.0005, 0.14);
    pG.gain.setValueAtTime(0.0001, now);
    pG.gain.linearRampToValueAtTime(pAmp, now + 0.004);
    pG.gain.exponentialRampToValueAtTime(0.0001, now + (isUp ? 0.28 : 0.12));

    pOsc.connect(pLp).connect(pG).connect(out);
    if (rev) pG.connect(rev);
    if (del && isUp) pG.connect(del);
    const pClean = [pOsc, pLp, pG];
    if (shim && isUp && next >= 63) {
        const st = ac.createGain();
        st.gain.value = 0.45;
        pG.connect(st).connect(shim);
        pClean.push(st);
    }
    _autoDisconnect(pOsc, pClean);
    pOsc.start(now);
    pOsc.stop(now + 0.30);

    // 4. Zone-Crossing Gear-Shift Bass Drops (31 Steady / 63 Flow / 98 Hardcore)
    if (zoneChanged) {
        if (isUp) {
            if (nextZone === 1) {
                // Crossing 31 -> Steady: warm chest thump + luminous fifth
                const k = ac.createOscillator();
                const kg = ac.createGain();
                k.type = 'sine';
                k.frequency.setValueAtTime(124, now);
                k.frequency.exponentialRampToValueAtTime(44, now + 0.13);
                kg.gain.setValueAtTime(0.0001, now);
                kg.gain.linearRampToValueAtTime(0.28 * scale, now + 0.004);
                kg.gain.exponentialRampToValueAtTime(0.0001, now + 0.21);
                k.connect(kg).connect(out);
                _autoDisconnect(k, [k, kg]);
                k.start(now); k.stop(now + 0.23);
                try { if (window.FX?.haptic) window.FX.haptic([7]); } catch (_) {}
            } else if (nextZone === 2) {
                // Crossing 63 -> Flow: deep resonant kick + lush Maj9 stereo shimmer chord bloom
                const k = ac.createOscillator();
                const kg = ac.createGain();
                k.type = 'sine';
                k.frequency.setValueAtTime(140, now);
                k.frequency.exponentialRampToValueAtTime(40, now + 0.17);
                kg.gain.setValueAtTime(0.0001, now);
                kg.gain.linearRampToValueAtTime(0.34 * scale, now + 0.004);
                kg.gain.exponentialRampToValueAtTime(0.0001, now + 0.29);
                k.connect(kg).connect(out);
                if (rev) kg.connect(rev);
                _autoDisconnect(k, [k, kg]);
                k.start(now); k.stop(now + 0.31);

                if (rev && !isFxFallback) {
                    const timbre = _vibe().leadTimbre;
                    [0, 2, 4, 6].forEach((d, i) => {
                        _schedMotifVoice(ac, now + i * 0.032, _scaleFreq(d, 2), 0.82 * scale, (i - 1.5) * 0.34, timbre, 0.95);
                    });
                }
                try { if (window.FX?.haptic) window.FX.haptic([10, 20, 14]); } catch (_) {}
            } else if (nextZone === 3) {
                // Crossing 98 -> Hardcore: massive 808 sub-drop + warm saw brass stab + air impact!
                duck(0.55, 0.42);
                const drop = ac.createOscillator();
                const dg = ac.createGain();
                drop.type = 'sine';
                drop.frequency.setValueAtTime(165, now);
                drop.frequency.exponentialRampToValueAtTime(34, now + 0.25);
                dg.gain.setValueAtTime(0.0001, now);
                dg.gain.linearRampToValueAtTime(0.44 * scale, now + 0.004);
                dg.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
                drop.connect(dg).connect(out);
                if (rev) dg.connect(rev);
                _autoDisconnect(drop, [drop, dg]);
                drop.start(now); drop.stop(now + 0.45);

                // Crunchy warm analog saw/brass stab (root + fifth)
                [_rootHz() * 2, _rootHz() * 3].forEach((sf, i) => {
                    const sOsc = ac.createOscillator();
                    const slp = ac.createBiquadFilter();
                    const sg = ac.createGain();
                    sOsc.type = 'sawtooth';
                    sOsc.frequency.setValueAtTime(sf, now);
                    sOsc.detune.value = i === 0 ? -7 : 7;
                    slp.type = 'lowpass';
                    slp.Q.value = 3.5;
                    slp.frequency.setValueAtTime(_nyquistSafe(ac, 2600), now);
                    slp.frequency.exponentialRampToValueAtTime(220, now + 0.28);
                    sg.gain.setValueAtTime(0.0001, now);
                    sg.gain.linearRampToValueAtTime(0.14 * scale, now + 0.006);
                    sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
                    sOsc.connect(slp).connect(sg).connect(out);
                    if (rev) sg.connect(rev);
                    _autoDisconnect(sOsc, [sOsc, slp, sg]);
                    sOsc.start(now); sOsc.stop(now + 0.35);
                });

                // Stereo air punch burst
                if (ctxInfo.noise) {
                    const nSrc = ac.createBufferSource();
                    nSrc.buffer = ctxInfo.noise;
                    const nBp = ac.createBiquadFilter();
                    nBp.type = 'bandpass';
                    nBp.frequency.value = 1800;
                    nBp.Q.value = 1.1;
                    const nG = ac.createGain();
                    nG.gain.setValueAtTime(0.0001, now);
                    nG.gain.linearRampToValueAtTime(0.14 * scale, now + 0.003);
                    nG.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
                    nSrc.connect(nBp).connect(nG).connect(out);
                    if (rev) nG.connect(rev);
                    _autoDisconnect(nSrc, [nSrc, nBp, nG]);
                    nSrc.start(now, 0, 0.11);
                }

                if (rev && !isFxFallback) {
                    [4, 6, 7].forEach((d, i) => {
                        _schedMotifVoice(ac, now + 0.015 + i * 0.024, _scaleFreq(d, 3), 0.96 * scale, (i - 1) * 0.42, 'analogArp', 1.0);
                    });
                }
                try { if (window.FX?.haptic) window.FX.haptic([18, 25, 32]); } catch (_) {}
            }
        } else {
            // Downward zone release thud
            const rel = ac.createOscillator();
            const rg = ac.createGain();
            rel.type = 'sine';
            rel.frequency.setValueAtTime(94, now);
            rel.frequency.exponentialRampToValueAtTime(36, now + 0.12);
            rg.gain.setValueAtTime(0.0001, now);
            rg.gain.linearRampToValueAtTime(0.16 * scale, now + 0.006);
            rg.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
            rel.connect(rg).connect(out);
            _autoDisconnect(rel, [rel, rg]);
            rel.start(now); rel.stop(now + 0.18);
        }
    }
}

/** Live sound-system reactivity while the Pact Sign modal is open. */
export function setPactPreview(active, value) {
    _pactPreviewActive = Boolean(active);
    if (value !== undefined && value !== null) {
        _pactPreviewValue = clamp(Math.round(Number(value) || 0), 0, 100);
    }
    _applyHealthModulation();
}

/** Resolving Pact Seal: deep sub-drop + wide stereo Maj9 shimmer bloom into active solving. */
export function playPactSeal(sliderValue) {
    const val = clamp(Math.round(Number(sliderValue) || 72), 0, 100);
    const isHardcore = val >= 98;
    if (!_enabled) return false;
    const ac = _buildGraph();
    if (!ac || ac.state !== 'running') return false;

    const now = ac.currentTime;
    duck(0.95, 0.30);

    const drop = ac.createOscillator();
    const dg = ac.createGain();
    drop.type = 'sine';
    drop.frequency.setValueAtTime(isHardcore ? 156 : 130, now);
    drop.frequency.exponentialRampToValueAtTime(34, now + 0.32);
    dg.gain.setValueAtTime(0.0001, now);
    dg.gain.linearRampToValueAtTime(isHardcore ? 0.42 : 0.32, now + 0.008);
    dg.gain.exponentialRampToValueAtTime(0.0001, now + 0.50);
    drop.connect(dg).connect(_sfxBus || ac.destination);
    if (_reverbSend) dg.connect(_reverbSend);
    _autoDisconnect(drop, [drop, dg]);
    drop.start(now);
    drop.stop(now + 0.54);

    // Wide voice-led resolving chord shimmer
    _schedAnalogEnsemblePad(ac, now + 0.02, _voicingMidi, 2.4, isHardcore ? 1.35 : 1.1, 1.0, true);
    const timbre = _vibe().leadTimbre;
    const degrees = isHardcore ? [0, 2, 4, 6, 8] : [0, 2, 4, 6];
    degrees.forEach((d, idx) => {
        _schedMotifVoice(ac, now + 0.02 + idx * 0.052, _scaleFreq(d, idx >= 3 ? 3 : 2), 0.90, (idx - 1.5) * 0.35, timbre, 0.98);
    });
    return true;
}

/**
 * Subtle musical Solve Bloom when cracking a problem (reinforces flow channel without breaking trance).
 * Wrong answers stay calm and tilt-proof (no gloomy drop).
 */
export function onSolveResult(isCorrect, streak = 1) {
    if (!isCorrect) {
        _solveBloomUntil = 0;
        _solveBloomStrength = 0;
        return false;
    }
    const st = clamp(Number(streak) || 1, 1, 8);
    _solveBloomStrength = clamp(0.65 + (st - 1) * 0.08, 0.65, 1.0);
    _solveBloomUntil = Date.now() + 4500;
    _applyHealthModulation();

    if (!_enabled || !_ac || _ac.state !== 'running' || !_graphBuilt) return false;
    try {
        const now = _ac.currentTime;
        const timbre = _vibe().leadTimbre;
        // Soft harmonically locked Maj9 shimmer halo behind the win SFX
        const notes = st >= 3 ? [2, 4, 6] : [2, 4];
        notes.forEach((deg, idx) => {
            _schedMotifVoice(_ac, now + 0.14 + idx * 0.065, _scaleFreq(deg, 3), 0.42 * _solveBloomStrength, (idx - 1) * 0.38, timbre, 0.92);
        });
    } catch (_) {}
    return true;
}

/**
 * Smooth sustained velvet duck while Mario Recap is on screen so Mario's iconic
 * untouched NES jingles & coins blend cleanly with zero harmonic clash, then
 * bloom gently back into full Flow when Mario closes.
 */
export function setRecapDuck(active) {
    _recapDuckActive = Boolean(active);
    if (_ac && _bedDuckGain && _ac.state === 'running') {
        try {
            const now = _ac.currentTime;
            const cur = clamp(Number.isFinite(_bedDuckGain.gain.value) ? _bedDuckGain.gain.value : 1.0, 0.08, 1.0);
            const target = _recapDuckActive ? 0.14 : 1.0;
            const dur = _recapDuckActive ? 0.42 : 1.15;
            _bedDuckGain.gain.cancelScheduledValues(now);
            _bedDuckGain.gain.setValueAtTime(cur, now);
            _bedDuckGain.gain.linearRampToValueAtTime(target, now + dur);
        } catch (_) {}
    }
    _applyHealthModulation();
    return _recapDuckActive;
}

/** Briefly duck the ambient bed so SFX & Mario coins sit cleanly in the pocket (NaN-safe linear ramp). */
export function duck(secs = 0.75, floor = 0.32) {
    const bus = _bedDuckGain || _duckBus;
    if (!_enabled || !_ac || !bus || _ac.state !== 'running') return;
    try {
        const now = _ac.currentTime;
        const hold = clamp(Number(secs) || 0.75, 0.15, 3.0);
        const rawFloor = Number(floor);
        const restTarget = _recapDuckActive ? 0.14 : 1.0;
        const targetFloor = Number.isFinite(rawFloor) ? Math.min(restTarget, clamp(rawFloor, 0.08, 0.92)) : Math.min(restTarget, 0.32);
        const cur = clamp(Number.isFinite(bus.gain.value) ? bus.gain.value : restTarget, 0.08, 1.0);
        bus.gain.cancelScheduledValues(now);
        bus.gain.setValueAtTime(cur, now);
        bus.gain.linearRampToValueAtTime(targetFloor, now + 0.025);
        bus.gain.linearRampToValueAtTime(restTarget, now + hold);
    } catch (_) {}
}

/** Read-only diagnostic & audio telemetry snapshot (for QA verification). */
export function getDiagnostics() {
    let rmsL = 0, rmsR = 0, stereoDiff = 0, peak = 0;
    let subEnergy = 0, midEnergy = 0, airEnergy = 0;
    try {
        if (_analyserL && _analyserR && _ac && _ac.state === 'running') {
            const n = _analyserL.fftSize;
            const tL = new Float32Array(n);
            const tR = new Float32Array(n);
            _analyserL.getFloatTimeDomainData(tL);
            _analyserR.getFloatTimeDomainData(tR);
            let sL = 0, sR = 0, sDiff = 0;
            for (let i = 0; i < n; i++) {
                const l = tL[i], r = tR[i];
                sL += l * l;
                sR += r * r;
                sDiff += (l - r) * (l - r);
                const p = Math.max(Math.abs(l), Math.abs(r));
                if (p > peak) peak = p;
            }
            rmsL = Math.sqrt(sL / n);
            rmsR = Math.sqrt(sR / n);
            stereoDiff = Math.sqrt(sDiff / n);

            const fL = new Float32Array(_analyserL.frequencyBinCount);
            _analyserL.getFloatFrequencyData(fL);
            const binHz = _ac.sampleRate / n;
            const bandAvg = (loHz, hiHz) => {
                const lo = Math.max(1, Math.floor(loHz / binHz));
                const hi = Math.min(fL.length - 1, Math.ceil(hiHz / binHz));
                let sum = 0, cnt = 0;
                for (let b = lo; b <= hi; b++) {
                    if (Number.isFinite(fL[b])) { sum += Math.pow(10, fL[b] / 20); cnt++; }
                }
                return cnt ? sum / cnt : 0;
            };
            subEnergy = bandAvg(35, 140);
            midEnergy = bandAvg(200, 1200);
            airEnergy = bandAvg(1500, 5000);
        }
    } catch (_) {}
    return {
        vibe: _vibeId,
        chapter: _chapter,
        barCount: _barCount,
        stepCounter: _stepCounter,
        rootMidi: _rootMidi(),
        rootHz: _rootHz(),
        voicingMidi: _voicingMidi.slice(),
        motifLen: _motifCell.length,
        tide: _macroTide(),
        neuralAmHz: _vibe().neuralAmHz,
        neuralAmDepth: _neuralAmDepthGain ? Number((_neuralAmDepthGain.gain.value * 2).toFixed(3)) : _vibe().neuralAmDepth,
        flowPlateau: _lastSolvingActive,
        cocoonLevel: Number(_lastCocoonLevel.toFixed(3)),
        voicesCleaned: _voicesCleaned,
        rebuilds: _rebuilds,
        ctxState: _ac ? _ac.state : 'uncreated',
        rmsL, rmsR, stereoDiff, peak,
        subEnergy, midEnergy, airEnergy,
    };
}

/** Pure generative progression test hook (advances N bars without AudioContext). */
export function _simulateBars(count = 64) {
    const chaptersSeen = new Set([_chapter]);
    const rootsSeen = new Set([_rootMidi()]);
    let totalVoiceMoves = 0;
    let chordTransitions = 0;
    let mutations = 0;
    let prevVoicing = _voicingMidi.slice();
    const startBar = _barCount;
    for (let b = startBar; b < startBar + count; b++) {
        _barCount = b;
        if (b >= _chapterEndBar) {
            _advanceChapter(b);
            chaptersSeen.add(_chapter);
            rootsSeen.add(_rootMidi());
        }
        if (b > 0 && b % 4 === 0) {
            _mutateMotifCell();
            mutations++;
        }
        if (b >= _nextPadBar) {
            _nextPadBar = b + 6 + Math.floor(_rng() * 3);
            _advanceChordMarkov();
            let move = 0;
            for (let i = 0; i < 4; i++) move += Math.abs(_voicingMidi[i] - prevVoicing[i]);
            totalVoiceMoves += move / 4;
            chordTransitions++;
            prevVoicing = _voicingMidi.slice();
        }
    }
    return {
        chapters: Array.from(chaptersSeen),
        uniqueRoots: rootsSeen.size,
        chordTransitions,
        avgSemitoneMovePerVoice: chordTransitions ? Number((totalVoiceMoves / chordTransitions).toFixed(2)) : 0,
        mutations,
    };
}

// ── Gesture Unlock & Foreground Resume ──────────────────────────────────────
function _bindUnlockGestures() {
    if (_boundGestures || typeof document === 'undefined') return;
    _boundGestures = true;

    const onGesture = (e) => {
        if (!_enabled) return;
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
        if (_enabled && !(typeof document !== 'undefined' && document.hidden)) {
            _activateIosAudioSession();
            if (_ac) {
                if (_ac.state === 'closed') {
                    _recoverAudioContext();
                    return;
                }
                if (_ac.state !== 'running') {
                    try { _ac.resume().catch(() => {}); } catch (_) {}
                }
                if (_ac.state === 'running' && !_running) {
                    _startLoops();
                }
            }
            _syncIosKeepalive(true);
        } else {
            _syncIosKeepalive(false);
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
    VIBES,
    getVibe,
    getVibes,
    setVibe,
    cycleVibe,
    playClick,
    playUiSfx,
    playChamberLoad,
    playBootIgnition,
    playFlatlineDrop,
    playSliderBump,
    setPactPreview,
    playPactSeal,
    onSolveResult,
    setRecapDuck,
    duck,
    getDiagnostics,
};

try {
    if (typeof window !== 'undefined') window.HeartbeatAudio = HeartbeatAudio;
} catch (_) {}
