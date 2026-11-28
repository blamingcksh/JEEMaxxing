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
        subtitle: 'Deep analytical flow · 108 BPM · Felt sub-thumps, rolling Moog bass & velvet brown air',
        bpm: 108,
        scale: [0, 2, 4, 6, 7, 9, 11, 14, 16], // Lydian Add9
        motifLen: 12,
        leadTimbre: 'prophetPluck',
        bassStyle: 'rolling',
        subStyle: 'steady',
        neuralAmHz: 15.0,    // Low-Beta / SMR sustained attention peak
        neuralAmDepth: 0.13,
        atmosLevel: 0.14,
        atmosCutoff: 480,
        subLevel: 0.44,
        bassLevel: 0.22,
        padLevel: 0.21,
        motifLevel: 0.115,
        shimmerLevel: 0.26,
        reverbWet: 0.44,
        delayWet: 0.30,
        percLevel: 0.030,
        drive: 7.5,
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
        subtitle: 'Weightless drift · 84 BPM · Bowed analog pads, warm velvet ocean & celestial shimmer',
        bpm: 84,
        scale: [0, 2, 4, 6, 7, 9, 11, 14, 18], // Wide Lydian Maj9#11
        motifLen: 13,
        leadTimbre: 'feltCelesta',
        bassStyle: 'dronePulse',
        subStyle: 'heartbeat',
        neuralAmHz: 10.0,    // Alpha relaxed conceptual insight
        neuralAmDepth: 0.12,
        atmosLevel: 0.19,
        atmosCutoff: 410,
        subLevel: 0.30,
        bassLevel: 0.14,
        padLevel: 0.27,
        motifLevel: 0.088,
        shimmerLevel: 0.44,
        reverbWet: 0.62,
        delayWet: 0.34,
        percLevel: 0.010,
        drive: 4.5,
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
        subtitle: 'Forward velocity · 122 BPM · Driving sub-kick, syncopated bass & Mixolydian arps',
        bpm: 122,
        scale: [0, 2, 4, 7, 9, 10, 14, 16], // Bright Mixolydian Add9
        motifLen: 8,
        leadTimbre: 'analogArp',
        bassStyle: 'syncopated',
        subStyle: 'drive',
        neuralAmHz: 16.5,    // Mid-Beta alertness & speed-solving velocity
        neuralAmDepth: 0.14,
        atmosLevel: 0.10,
        atmosCutoff: 560,
        subLevel: 0.50,
        bassLevel: 0.25,
        padLevel: 0.17,
        motifLevel: 0.125,
        shimmerLevel: 0.20,
        reverbWet: 0.34,
        delayWet: 0.28,
        percLevel: 0.045,
        drive: 10.5,
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
        subtitle: 'Golden analog warmth · 98 BPM · Vintage Rhodes tines, warm sub & sunlit Maj9 bloom',
        bpm: 98,
        scale: [0, 2, 4, 7, 9, 11, 14, 16], // Golden Major 9 / Pentatonic-Add9
        motifLen: 11,
        leadTimbre: 'vintageRhodes',
        bassStyle: 'warmGroove',
        subStyle: 'warm',
        neuralAmHz: 10.8,    // Upper-Alpha luminous creative flow
        neuralAmDepth: 0.11,
        atmosLevel: 0.15,
        atmosCutoff: 510,
        subLevel: 0.38,
        bassLevel: 0.20,
        padLevel: 0.24,
        motifLevel: 0.130,
        shimmerLevel: 0.34,
        reverbWet: 0.48,
        delayWet: 0.34,
        percLevel: 0.024,
        drive: 6.5,
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

// Rolling muted Moog bass velocity patterns per bassStyle
const BASS_GRIDS = {
    rolling:    [0.95, 0.32, 0.58, 0.42,  0.22, 0.48, 0.74, 0.36,  0.90, 0.30, 0.64, 0.45,  0.26, 0.52, 0.78, 0.44],
    dronePulse: [0.90, 0,    0,    0,     0,    0,    0.55, 0,     0.78, 0,    0,    0,     0,    0,    0.48, 0],
    syncopated: [0.95, 0,    0.58, 0.76,  0,    0.44, 0.82, 0.34,  0.90, 0,    0.66, 0.72,  0,    0.50, 0.84, 0.42],
    warmGroove: [0.92, 0,    0.42, 0,     0.35, 0,    0.72, 0.38,  0.86, 0,    0.54, 0,     0.40, 0,    0.74, 0.32],
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

// Session PRNG & evolutionary fingerprint
let _rng = _mulberry32((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
let _cofIndex = Math.floor(_rng() * COF_ROOT_MIDI.length);
let _tidePhases = [_rng() * Math.PI * 2, _rng() * Math.PI * 2, _rng() * Math.PI * 2];
let _tempoOffsetBpm = (_rng() - 0.5) * 2.0; // subtle ±1 BPM unique session fingerprint
let _motifCell = [];

// Pact preview & live neural-flow solve state
let _pactPreviewActive = false;
let _pactPreviewValue = 72;
let _solveBloomUntil = 0;
let _solveBloomStrength = 0;
let _lastCocoonLevel = 0;
let _lastSolvingActive = false;
let _plateauNextModBar = 112;

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

function _activateIosAudioSession() {
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
    subGuard.frequency.value = 32;

    _warmthEq = ac.createBiquadFilter();
    _warmthEq.type = 'peaking';
    _warmthEq.frequency.value = 110;
    _warmthEq.Q.value = 0.85;
    _warmthEq.gain.value = 3.5;

    const clarityDip = ac.createBiquadFilter();
    clarityDip.type = 'peaking';
    clarityDip.frequency.value = 310;
    clarityDip.Q.value = 1.1;
    clarityDip.gain.value = -1.8; // clears low-mid mud so bass + pads sit like a mastered record

    const airShelf = ac.createBiquadFilter();
    airShelf.type = 'highshelf';
    airShelf.frequency.value = 6200;
    airShelf.gain.value = -1.2; // prevents fatigue across 4-hour sessions

    _tapeDrive = ac.createWaveShaper();
    _tapeDrive.curve = _makeTapeCurve(v.drive);
    try { _tapeDrive.oversample = '2x'; } catch (_) {}

    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -15;
    comp.knee.value = 18;
    comp.ratio.value = 4.0;
    comp.attack.value = 0.008;
    comp.release.value = 0.19;

    _masterGain = ac.createGain();
    _masterGain.gain.value = 0.0001;

    _duckBus = ac.createGain();
    _duckBus.gain.value = 1.0;

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

    // Master Chain Wiring
    _duckBus.connect(_toneFilter);
    _toneFilter.connect(subGuard);
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
    atmosHp.frequency.value = 54;
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

/** Organic Felt-Mallet Sub-Thump with crisp beater knock & silky room sidechain pump. */
function _schedSubThump(ac, time, vel, duckAmount, levelScale = 1.0) {
    // 1. Sub body (clean tight sine sweep)
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(108, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.082);
    osc.frequency.exponentialRampToValueAtTime(36, time + 0.22);

    const peak = clamp(0.45 * vel * levelScale, 0.001, 0.58);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.27);
    osc.connect(g).connect(_subDirectBus || _toneFilter);

    // 2. Warm felt-mallet chest knock (audible on iPad & laptop speakers)
    const knock = ac.createOscillator();
    const kg = ac.createGain();
    knock.type = 'triangle';
    knock.frequency.setValueAtTime(240, time);
    knock.frequency.exponentialRampToValueAtTime(80, time + 0.048);
    kg.gain.setValueAtTime(0.0001, time);
    kg.gain.linearRampToValueAtTime(peak * 0.24, time + 0.003);
    kg.gain.exponentialRampToValueAtTime(0.0001, time + 0.058);
    knock.connect(kg).connect(_subDirectBus || _toneFilter);

    // 3. Soft 14ms low-passed felt beater transient (organic Nils Frahm / Kiasmos warmth)
    if (_crispNoiseBuffer) {
        const beater = ac.createBufferSource();
        beater.buffer = _crispNoiseBuffer;
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 520;
        bp.Q.value = 1.4;
        const bg = ac.createGain();
        bg.gain.setValueAtTime(0.0001, time);
        bg.gain.linearRampToValueAtTime(peak * 0.14, time + 0.002);
        bg.gain.exponentialRampToValueAtTime(0.0001, time + 0.018);
        beater.connect(bp).connect(bg).connect(_subDirectBus || _toneFilter);
        beater.start(time, _rng() * 0.2, 0.025);
    }

    // Subtle hall tap on chest knock only
    const revTap = ac.createGain();
    revTap.gain.value = 0.15;
    kg.connect(revTap).connect(_reverbSend);

    osc.start(time);
    knock.start(time);
    osc.stop(time + 0.30);
    knock.stop(time + 0.07);

    // Smooth hypnotic sidechain breathing on pink noise, pads, and reverb tail
    if (_duckBus && duckAmount > 0.03) {
        const floor = clamp(1.0 - duckAmount * vel, 0.54, 0.96);
        try {
            _duckBus.gain.cancelScheduledValues(time);
            _duckBus.gain.setValueAtTime(_duckBus.gain.value, time);
            _duckBus.gain.linearRampToValueAtTime(floor, time + 0.016);
            _duckBus.gain.exponentialRampToValueAtTime(1.0, time + 0.23);
        } catch (_) {}
    }
}

/** Hypnotic Rolling Muted Moog-Style Analog Bass (tight resonant filter pluck + clean sub). */
function _schedRollingBass(ac, time, freq, dur, vel, filterOpen = 0.5) {
    const sub = ac.createOscillator();
    const saw = ac.createOscillator();
    const tri = ac.createOscillator();
    const lp = ac.createBiquadFilter();
    const g = ac.createGain();
    const subG = ac.createGain();

    sub.type = 'sine';
    saw.type = 'sawtooth';
    tri.type = 'triangle';
    sub.frequency.setValueAtTime(freq, time);
    saw.frequency.setValueAtTime(freq, time);
    tri.frequency.setValueAtTime(freq * 2, time);
    saw.detune.value = -5;
    tri.detune.value = +4;

    const fPeak = _nyquistSafe(ac, 260 + filterOpen * 540 * vel);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(fPeak, time);
    lp.frequency.exponentialRampToValueAtTime(Math.max(85, freq * 1.45), time + Math.min(dur, 0.22));
    lp.Q.value = 2.4;

    const peak = clamp(0.18 * vel, 0.001, 0.28);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    subG.gain.value = 0.68;
    const triG = ac.createGain();
    triG.gain.value = 0.24;

    sub.connect(subG).connect(lp);
    saw.connect(lp);
    tri.connect(triG).connect(lp);
    lp.connect(g).connect(_duckBus);

    sub.start(time);
    saw.start(time);
    tri.start(time);
    sub.stop(time + dur + 0.03);
    saw.stop(time + dur + 0.03);
    tri.stop(time + dur + 0.03);
}

/**
 * Lush Voice-Led Analog Ensemble Pad (3 detuned warm oscs + breathing resonant LPF envelope
 * + dedicated +12/+19 Octave Shimmer bow voice into Velvet Hall).
 */
function _schedAnalogEnsemblePad(ac, time, midiNotes, durSecs, level = 1.0, filterLift = 0.7, fastFirstBar = false) {
    const pans = [-0.68, 0.64, -0.32, 0.38];
    const attack = fastFirstBar ? Math.min(1.1, durSecs * 0.16) : Math.min(2.8, durSecs * 0.30);
    const release = Math.min(3.8, durSecs * 0.36);

    midiNotes.forEach((midi, idx) => {
        const freq = midiToFreq(midi);
        const oSaw = ac.createOscillator();
        const oTri = ac.createOscillator();
        const oSub = ac.createOscillator();
        const lp = ac.createBiquadFilter();
        const pan = _createStereoPanner(ac, pans[idx % pans.length]);
        const g = ac.createGain();

        oSaw.type = 'sawtooth';
        oTri.type = 'triangle';
        oSub.type = 'sine';
        oSaw.frequency.setValueAtTime(freq, time);
        oTri.frequency.setValueAtTime(freq, time);
        oSub.frequency.setValueAtTime(freq, time);
        oSaw.detune.value = (idx % 2 === 0 ? -9 : 9);
        oTri.detune.value = (idx % 2 === 0 ? 7 : -7);

        // Breathing resonant Juno/Prophet filter sweep over the chord's life
        const startCut = _nyquistSafe(ac, 260 + idx * 70);
        const peakCut = _nyquistSafe(ac, 680 + filterLift * 1050 + idx * 140);
        const endCut = _nyquistSafe(ac, 310 + idx * 60);
        lp.type = 'lowpass';
        lp.Q.value = 1.35;
        lp.frequency.setValueAtTime(startCut, time);
        lp.frequency.exponentialRampToValueAtTime(peakCut, time + durSecs * 0.48);
        lp.frequency.exponentialRampToValueAtTime(endCut, time + durSecs);

        const sawG = ac.createGain();
        sawG.gain.value = 0.42;
        const triG = ac.createGain();
        triG.gain.value = 0.55;
        const sinG = ac.createGain();
        sinG.gain.value = 0.48;

        const voicePeak = clamp(0.036 * level * (idx >= 2 ? 0.85 : 1.0), 0.0008, 0.075);
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(voicePeak, time + attack);
        g.gain.setValueAtTime(voicePeak, time + Math.max(attack + 0.25, durSecs - release));
        g.gain.exponentialRampToValueAtTime(0.0001, time + durSecs + 0.25);

        oSaw.connect(sawG).connect(lp);
        oTri.connect(triG).connect(lp);
        oSub.connect(sinG).connect(lp);
        lp.connect(pan).connect(g);
        g.connect(_neuralAmBus || _duckBus);
        g.connect(_reverbSend);

        oSaw.start(time);
        oTri.start(time);
        oSub.start(time);
        oSaw.stop(time + durSecs + 0.35);
        oTri.stop(time + durSecs + 0.35);
        oSub.stop(time + durSecs + 0.35);
    });

    // True Octave-Up (+12 & +19) Bowed Shimmer Halo Voice
    if (_shimmerSend && midiNotes.length >= 3) {
        const shimPitches = [midiNotes[2] + 12, midiNotes[3] + 12];
        shimPitches.forEach((sm, idx) => {
            const osc = ac.createOscillator();
            const pan = _createStereoPanner(ac, idx === 0 ? -0.48 : 0.48);
            const sg = ac.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(midiToFreq(sm), time);
            osc.detune.value = idx === 0 ? -4 : 4;
            const sPeak = clamp(0.022 * level * (0.5 + 0.5 * filterLift), 0.0005, 0.055);
            sg.gain.setValueAtTime(0.0001, time);
            sg.gain.linearRampToValueAtTime(sPeak, time + Math.min(2.2, durSecs * 0.35));
            sg.gain.exponentialRampToValueAtTime(0.0001, time + durSecs + 0.2);
            osc.connect(pan).connect(sg).connect(_shimmerSend);
            osc.start(time);
            osc.stop(time + durSecs + 0.3);
        });
    }
}

/** Vibe-specific lead motif voice (Prophet felt-pluck / Celesta / Analog Arp / Vintage Rhodes). */
function _schedMotifVoice(ac, time, freq, vel, panPos, timbre, filterOpen = 0.7) {
    const pan = _createStereoPanner(ac, panPos);
    const g = ac.createGain();

    if (timbre === 'feltCelesta') {
        // Delicate felt-piano / celesta harmonic bloom (Aether)
        const car = ac.createOscillator();
        const over = ac.createOscillator();
        const ovG = ac.createGain();
        car.type = 'sine';
        over.type = 'triangle';
        car.frequency.setValueAtTime(freq, time);
        over.frequency.setValueAtTime(freq * 2, time);
        ovG.gain.setValueAtTime(0.18 * vel, time);
        ovG.gain.exponentialRampToValueAtTime(0.001, time + 0.45);

        const dur = 2.4;
        const peak = clamp(0.068 * vel, 0.0006, 0.12);
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(peak, time + 0.022);
        g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

        car.connect(pan);
        over.connect(ovG).connect(pan);
        pan.connect(g);
        g.connect(_duckBus);
        g.connect(_reverbSend);
        g.connect(_delaySend);
        if (_shimmerSend) g.connect(_shimmerSend);

        car.start(time); over.start(time);
        car.stop(time + dur + 0.06); over.stop(time + dur + 0.06);
        return;
    }

    if (timbre === 'vintageRhodes') {
        // Warm vintage Rhodes / wood kalimba tine (Solstice)
        const car = ac.createOscillator();
        const mod = ac.createOscillator();
        const modG = ac.createGain();
        car.type = 'sine';
        mod.type = 'sine';
        car.frequency.setValueAtTime(freq, time);
        mod.frequency.setValueAtTime(freq * 2.0, time);
        modG.gain.setValueAtTime(freq * 0.78 * vel, time);
        modG.gain.exponentialRampToValueAtTime(1.0, time + 0.22);

        const dur = 1.45;
        const peak = clamp(0.095 * vel, 0.0006, 0.16);
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(peak, time + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

        mod.connect(modG).connect(car.frequency);
        car.connect(pan).connect(g);
        g.connect(_duckBus);
        g.connect(_reverbSend);
        g.connect(_delaySend);
        car.start(time); mod.start(time);
        car.stop(time + dur + 0.05); mod.stop(time + dur + 0.05);
        return;
    }

    // Prophet / Felt-Piano Pluck (Aperture) or Crisp Resonant Arp (Kinetic)
    const isArp = timbre === 'analogArp';
    const o1 = ac.createOscillator();
    const o2 = ac.createOscillator();
    const lp = ac.createBiquadFilter();
    o1.type = 'sawtooth';
    o2.type = 'triangle';
    o1.frequency.setValueAtTime(freq, time);
    o2.frequency.setValueAtTime(freq, time);
    o1.detune.value = isArp ? -6 : -4;
    o2.detune.value = isArp ? +6 : +4;

    const cutStart = _nyquistSafe(ac, (isArp ? 3200 : 2400) * (0.55 + 0.55 * filterOpen));
    const cutEnd = _nyquistSafe(ac, isArp ? 320 : 250);
    lp.type = 'lowpass';
    lp.Q.value = isArp ? 2.8 : 2.1;
    lp.frequency.setValueAtTime(cutStart, time);
    lp.frequency.exponentialRampToValueAtTime(cutEnd, time + (isArp ? 0.11 : 0.16));

    const dur = isArp ? 0.42 : 0.78;
    const peak = clamp((isArp ? 0.092 : 0.088) * vel, 0.0006, 0.16);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    o1.connect(lp);
    o2.connect(lp);
    lp.connect(pan).connect(g);
    g.connect(_duckBus);
    g.connect(_delaySend);
    g.connect(_reverbSend);

    // Subtle organic felt-hammer transient for Aperture
    if (!isArp && _crispNoiseBuffer) {
        const tap = ac.createBufferSource();
        tap.buffer = _crispNoiseBuffer;
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1650;
        bp.Q.value = 1.6;
        const tg = ac.createGain();
        tg.gain.setValueAtTime(0.0001, time);
        tg.gain.linearRampToValueAtTime(peak * 0.22, time + 0.002);
        tg.gain.exponentialRampToValueAtTime(0.0001, time + 0.014);
        tap.connect(bp).connect(tg).connect(pan);
        tap.start(time, _rng() * 0.2, 0.02);
    }

    o1.start(time); o2.start(time);
    o1.stop(time + dur + 0.04); o2.stop(time + dur + 0.04);
}

/** Soft stereo organic wood-rim micro-click (panned into ping-pong delay). */
function _schedMicroRim(ac, time, vel, panPos) {
    const osc = ac.createOscillator();
    const bp = ac.createBiquadFilter();
    const pan = _createStereoPanner(ac, panPos);
    const g = ac.createGain();

    const base = 920 + _rng() * 480;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(base, time);
    osc.frequency.exponentialRampToValueAtTime(base * 0.58, time + 0.028);
    bp.type = 'bandpass';
    bp.frequency.value = base * 1.1;
    bp.Q.value = 2.6;

    const peak = clamp(0.052 * vel, 0.0004, 0.09);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.036);

    osc.connect(bp).connect(pan).connect(g);
    g.connect(_duckBus);
    g.connect(_delaySend);
    g.connect(_reverbSend);
    osc.start(time);
    osc.stop(time + 0.045);
}

/** Ultra-soft silky high-air shaker brush (sparse offbeats, zero harsh 3kHz hiss). */
function _schedVelvetShaker(ac, time, vel, panPos) {
    if (!_crispNoiseBuffer) return;
    const src = ac.createBufferSource();
    src.buffer = _crispNoiseBuffer;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5400 + _rng() * 1100;
    bp.Q.value = 1.1;
    const pan = _createStereoPanner(ac, panPos);
    const g = ac.createGain();

    const peak = clamp(0.014 * vel, 0.0002, 0.026);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.042);

    src.connect(bp).connect(pan).connect(g);
    g.connect(_duckBus);
    src.start(time, _rng() * 0.25, 0.05);
}

/** 2-Bar Warm Velvet Ocean Swell right into a clean chapter drop (zero harsh hiss). */
function _schedBreathSwell(ac, time, durSecs, level = 1.0) {
    if (!_velvetBrownBuffer) return;
    const src = ac.createBufferSource();
    src.buffer = _velvetBrownBuffer;
    src.loop = true;

    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.85;
    lp.frequency.setValueAtTime(180, time);
    lp.frequency.exponentialRampToValueAtTime(_nyquistSafe(ac, 980), time + durSecs);

    const g = ac.createGain();
    const peak = clamp(0.085 * level, 0.001, 0.14);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + durSecs * 0.92);
    g.gain.exponentialRampToValueAtTime(0.0001, time + durSecs + 0.12);

    src.connect(lp).connect(g);
    g.connect(_reverbSend);
    g.connect(_duckBus);
    src.start(time, _rng() * 14.0, durSecs + 0.16);
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
        const thumpScale = (vibe.subLevel / 0.44) * subScale * studySubTrim;
        const duckAmt = (inVoid ? 0.30 : 0.18) * clamp(subScale, 0.2, 1.3);
        _schedSubThump(_ac, time, subVel, duckAmt, thumpScale);
    }

    // 2. Rolling Muted Moog-Style Bassline (anchored to active chord root/fifth)
    const bassGrid = BASS_GRIDS[vibe.bassStyle] || BASS_GRIDS.rolling;
    const bassVel = bassGrid[step];
    if (bassVel > 0 && bassScale > 0.12) {
        const chord = vibe.chords[_chordIdx % vibe.chords.length];
        const useFifth = (step === 6 || step === 14) && _rng() < 0.45;
        const bassPc = useFifth ? chord.pcs[2] : chord.pcs[0];
        let bMidi = _rootMidi() + bassPc;
        while (bMidi > 46) bMidi -= 12;
        while (bMidi < 31) bMidi += 12;
        const bDur = vibe.bassStyle === 'dronePulse' ? stepSecs * 4.5 : (step % 4 === 0 ? stepSecs * 1.9 : stepSecs * 1.15);
        const bLevel = (vibe.bassLevel / 0.22) * bassVel * bassScale * (inVoid ? 1.0 : 0.82);
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
    if (_nextStepTime < _ac.currentTime - 0.25) {
        _nextStepTime = _ac.currentTime + 0.04;
    }
    const stepSecs = _stepSecs();
    while (_nextStepTime < _ac.currentTime + SCHEDULE_AHEAD_SECS) {
        // Subtle 4% groove swing on odd 16th notes
        const swing = (_stepCounter % 2 === 1) ? stepSecs * 0.04 : 0;
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

    if (!_enabled || hidden) {
        _masterGain.gain.setTargetAtTime(0.0001, now, 0.12);
        return;
    }

    if (v.flatlined) {
        _masterGain.gain.setTargetAtTime(0.26, now, 0.25);
        _toneFilter.frequency.setTargetAtTime(_nyquistSafe(_ac, 320), now, 0.3);
        if (_atmosGain) _atmosGain.gain.setTargetAtTime(0.02, now, 0.3);
        if (_flatlineGain) _flatlineGain.gain.setTargetAtTime(0.032, now, 0.35);
        return;
    }

    if (_flatlineGain) _flatlineGain.gain.setTargetAtTime(0.0001, now, 0.15);

    const vibe = _vibe();
    const inVoid = _isVoidActive();
    const studyCtx = _readStudyContext();
    const tide = _macroTide();
    const chap = CHAPTER_SPEC[_chapter] || CHAPTER_SPEC.lock;

    let targetVol = inVoid ? 0.68 : (v.frozen ? 0.48 : 0.50);
    let targetCutoff = inVoid
        ? (3800 + chap.filter * 2400)
        : (2650 - studyCtx.cocoon * 600 + studyCtx.bloom * 1100);
    let atmosTarget = vibe.atmosLevel * (inVoid ? (0.88 + 0.16 * tide) : (0.92 + studyCtx.cocoon * 0.22));
    let atmosCut = vibe.atmosCutoff * (inVoid ? (0.92 + 0.16 * tide) : (0.88 - studyCtx.cocoon * 0.10));

    // Rapid Neural AM depth gently deepens during active solving & Deep-Think Cocoon (>60s)
    const amDepth = clamp(
        vibe.neuralAmDepth + (studyCtx.solving ? 0.05 : 0) + studyCtx.cocoon * 0.04,
        0.06,
        0.24
    );

    if (_pactPreviewActive) {
        const pv = clamp(_pactPreviewValue, 0, 100);
        const norm = pv / 100;
        targetVol = 0.44 + norm * 0.30;
        targetCutoff = pv <= 30 ? 1500 : (pv <= 62 ? 3200 : (pv <= 97 ? 5400 : 7200));
        atmosTarget = vibe.atmosLevel * (0.78 + norm * 0.30);
        atmosCut = vibe.atmosCutoff * (0.85 + norm * 0.35);
    }

    _masterGain.gain.setTargetAtTime(targetVol, now, 0.24);
    _toneFilter.frequency.setTargetAtTime(_nyquistSafe(_ac, targetCutoff), now, 0.26);
    if (_atmosGain) _atmosGain.gain.setTargetAtTime(atmosTarget, now, 0.32);
    if (_atmosLpA) _atmosLpA.frequency.setTargetAtTime(_nyquistSafe(_ac, atmosCut), now, 0.35);
    if (_atmosLpB) _atmosLpB.frequency.setTargetAtTime(_nyquistSafe(_ac, atmosCut * 1.18), now, 0.35);
    if (_neuralAmBus) _neuralAmBus.gain.setTargetAtTime(1.0 - amDepth * 0.5, now, 0.35);
    if (_neuralAmDepthGain) _neuralAmDepthGain.gain.setTargetAtTime(amDepth * 0.5, now, 0.35);
    if (_neuralAmOsc) _neuralAmOsc.frequency.setTargetAtTime(vibe.neuralAmHz, now, 0.4);
}

function _startLoops() {
    if (_running || !_ac) return;
    _running = true;
    _nextStepTime = _ac.currentTime + 0.05;
    if (_schedulerTimer) clearInterval(_schedulerTimer);
    _schedulerTimer = setInterval(_schedulerTick, LOOKAHEAD_MS);
    if (_modTimer) clearInterval(_modTimer);
    _modTimer = setInterval(_applyHealthModulation, 320);
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
        try {
            _masterGain.gain.setTargetAtTime(0.0001, _ac.currentTime, 0.08);
        } catch (_) {}
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
                if (_atmosGain) _atmosGain.gain.setTargetAtTime(vibe.atmosLevel, now, 0.35);
                if (_atmosLpA) _atmosLpA.frequency.setTargetAtTime(_nyquistSafe(_ac, vibe.atmosCutoff), now, 0.35);
                if (_atmosLpB) _atmosLpB.frequency.setTargetAtTime(_nyquistSafe(_ac, vibe.atmosCutoff * 1.18), now, 0.35);
                if (_neuralAmOsc) _neuralAmOsc.frequency.setTargetAtTime(vibe.neuralAmHz, now, 0.4);
                if (_neuralAmBus) _neuralAmBus.gain.setTargetAtTime(1.0 - vibe.neuralAmDepth * 0.5, now, 0.35);
                if (_neuralAmDepthGain) _neuralAmDepthGain.gain.setTargetAtTime(vibe.neuralAmDepth * 0.5, now, 0.35);
                if (_reverbWet) _reverbWet.gain.setTargetAtTime(vibe.reverbWet, now, 0.35);
                if (_shimmerWet) _shimmerWet.gain.setTargetAtTime(vibe.shimmerLevel, now, 0.35);
                if (_delayWet) _delayWet.gain.setTargetAtTime(vibe.delayWet, now, 0.35);
                if (_delayL) _delayL.delayTime.setTargetAtTime(clamp(step * 3, 0.06, 1.45), now, 0.25);
                if (_delayR) _delayR.delayTime.setTargetAtTime(clamp(step * 3, 0.06, 1.45), now, 0.25);
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

// ── Tactile Precision SFX, Layered Pact Slider Bass Bumps & Pact Seal ───────

function _resolveSfxCtx() {
    if (_enabled) {
        const ac = _buildGraph();
        if (ac && ac.state === 'running') {
            return { ac, out: _sfxBus || ac.destination, rev: _reverbSend, del: _delaySend, shim: _shimmerSend, isFxFallback: false };
        }
    }
    try {
        if (typeof window !== 'undefined' && window.FX && typeof window.FX.wantSound === 'function' && window.FX.wantSound()) {
            const fxAc = typeof window.FX.ctx === 'function' ? window.FX.ctx() : null;
            if (fxAc && fxAc.state === 'running') {
                return { ac: fxAc, out: fxAc.destination, rev: null, del: null, shim: null, isFxFallback: true };
            }
        }
    } catch (_) {}
    return null;
}

/** Tactile damped ceramic switch click. */
export function playClick() {
    if (!_enabled) return;
    const ac = _buildGraph();
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;

    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(165, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.036);
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
        bp.frequency.value = 2600;
        bp.Q.value = 1.8;
        const ng = ac.createGain();
        ng.gain.setValueAtTime(0.0001, now);
        ng.gain.linearRampToValueAtTime(0.05, now + 0.002);
        ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
        src.connect(bp).connect(ng).connect(_sfxBus || ac.destination);
        src.start(now, Math.random() * 0.2, 0.028);
    }
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

    const ctxInfo = _resolveSfxCtx();
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
    if (shim && isUp && next >= 63) {
        const st = ac.createGain();
        st.gain.value = 0.45;
        pG.connect(st).connect(shim);
    }
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
                    sOsc.start(now); sOsc.stop(now + 0.35);
                });

                // Stereo air punch burst
                if (_crispNoiseBuffer) {
                    const nSrc = ac.createBufferSource();
                    nSrc.buffer = _crispNoiseBuffer;
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

/** Briefly duck the ambient bed so heavy UI SFX cut cleanly through. */
export function duck(secs = 0.75, floor = 0.32) {
    if (!_enabled || !_ac || !_duckBus || _ac.state !== 'running') return;
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
    onSolveResult,
    duck,
    getDiagnostics,
};

try {
    if (typeof window !== 'undefined') window.HeartbeatAudio = HeartbeatAudio;
} catch (_) {}
