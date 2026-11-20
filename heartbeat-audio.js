/**
 * heartbeat-audio.js — Procedural Dark Industrial & Subterranean Soundscape Engine
 *
 * Buckshot Roulette / Mike Klubnika-inspired procedural Web Audio engine:
 *   - Sample-accurate Web Audio lookahead scheduler (zero JS timer jitter)
 *   - Evolving 8-bar dark electro-industrial structure (tension drop-outs & slam-ins)
 *   - Detuned stereo Reese bass + muffled concrete-wall kick with sidechain room ducking
 *   - Haunting minor-second / tritone FM industrial chimes smeared into a 2.8s dark stereo reverb + dub delay
 *   - Subterranean concrete room drone, fluorescent transformer hum, and sparse distant bunker echoes
 *   - Health-reactive modulation synced to live Heartbeat.getVitals():
 *       * Void: full brooding subterranean presence + synchronized cardiac pulse
 *       * Practice / Vault / Active Pact: smooth "behind-the-glass" focus muffle & duck
 *       * Critical (<8h Amber / <3h Crimson): heavy pitch-sagged tension, loud cardiac thump, erratic fluorescent buzz
 *       * Flatline (0.0h): power-grid shutdown drop into a cold dead medical/CRT drone
 *   - Tactile mechanical steel-switch & shotgun-chamber latch SFX
 *   - 100% offline Web Audio synthesis — zero external files, iPad Safari/PWA speaker-tuned
 */

const PREFS_KEY = 'jeemax_hb_audio_v1';

// ── Composition (92 BPM dark Phrygian / Locrian industrial, 8-bar cycle = 128 16th steps) ──
const BPM = 92;
const STEP_SECS = 60 / BPM / 4; // ~0.16304s per 16th note
const SCHEDULE_AHEAD_SECS = 0.14;
const LOOKAHEAD_MS = 25;

// A1 = 55 Hz, Bb1 = 58.27, C2 = 65.41, Eb2 = 77.78, G1 = 49.00, F1 = 43.65, E1 = 41.20
const BAR_BASS_A = [55.0, 0, 0, 55.0,  0, 0, 58.27, 0,  55.0, 0, 0, 0,  49.0, 0, 55.0, 0];
const BAR_BASS_B = [55.0, 0, 0, 55.0,  0, 0, 65.41, 0,  58.27, 0, 0, 55.0,  43.65, 0, 49.0, 0];
const BAR_BASS_C = [43.65, 0, 0, 0,    0, 0, 49.0, 0,   55.0, 0, 0, 0,  58.27, 0, 41.20, 0];

// Muffled club-behind-concrete kick pattern (heavy four-on-floor with brooding ghost hits)
const KICK_FULL  = [1.0, 0, 0, 0,  0.86, 0, 0, 0.34,  0.96, 0, 0, 0,  0.88, 0, 0.42, 0];
const KICK_HEAVY = [1.0, 0, 0, 0,  0.92, 0, 0, 0,     1.0,  0, 0, 0,  0.90, 0, 0.55, 0.28];
const KICK_LIMP  = [1.0, 0, 0, 0,  0,    0, 0, 0,     0.85, 0, 0, 0,  0,    0, 0.40, 0]; // <3h crimson

// Sparse industrial snare/rim-scrape on beat 2 & 4 (deeply filtered)
const CLANG_PATTERN = [0, 0, 0, 0,  0.55, 0, 0, 0,  0, 0, 0, 0,  0.72, 0, 0, 0.18];

// Dark metallic off-beat shaker/tick (void-only)
const HAT_PATTERN   = [0, 0, 0.28, 0,  0, 0, 0.22, 0.16,  0, 0, 0.30, 0,  0, 0.15, 0.26, 0];

// Haunting dissonant FM bell/pad tones (Hz): A3, Bb3, Eb4, E4, C4
const GHOST_CHIMES = [220.0, 233.08, 311.13, 329.63, 261.63];

function _loadEnabled() {
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(PREFS_KEY);
            if (raw !== null) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed.enabled === 'boolean') return parsed.enabled;
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
let _ac = null;
let _running = false;
let _masterGain = null;
let _wallFilter = null;
let _duckBus = null;
let _reverbSend = null;
let _delaySend = null;
let _droneGain = null;
let _humGain = null;
let _flatlineGain = null;
let _schedulerTimer = null;
let _modTimer = null;
let _cardiacTimer = null;
let _nextStepTime = 0;
let _globalStep = 0; // 0..127 (8 bars)
let _noiseBuffer = null;
let _crispNoiseBuffer = null;
let _boundGestures = false;
let _lastVitals = null;

function _ensureNoiseBuffers(ac) {
    if (_noiseBuffer && _noiseBuffer.sampleRate === ac.sampleRate) return;
    const len = Math.floor(ac.sampleRate * 2.5);
    // Warm pink/brown noise for dark room air & concrete scrapes
    const darkBuf = ac.createBuffer(1, len, ac.sampleRate);
    const dCh = darkBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.05 * w) / 1.05;
        dCh[i] = last * 3.1;
    }
    // Crisp white noise for sharp mechanical steel switch clicks
    const crispBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate);
    const cCh = crispBuf.getChannelData(0);
    for (let i = 0; i < cCh.length; i++) {
        cCh[i] = Math.random() * 2 - 1;
    }
    _noiseBuffer = darkBuf;
    _crispNoiseBuffer = crispBuf;
}

function _createCavernReverb(ac) {
    const conv = ac.createConvolver();
    const secs = 2.75;
    const len = Math.floor(ac.sampleRate * secs);
    const ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
        const data = ir.getChannelData(c);
        let lp = 0;
        let hp = 0;
        for (let i = 0; i < len; i++) {
            const t = i / len;
            // Pre-delay early bunker reflections + long dark concrete decay
            const preDelay = i < ac.sampleRate * 0.022 ? 0.12 : 1.0;
            const env = Math.pow(1 - t, 2.35) * preDelay;
            const raw = (Math.random() * 2 - 1) * env;
            lp += (raw - lp) * (c === 0 ? 0.13 : 0.115); // slight stereo decorrelation
            hp += (lp - hp) * 0.008;
            data[i] = (lp - hp) * 1.4;
        }
    }
    conv.buffer = ir;
    return conv;
}

function _makeAnalogTapeCurve(drive = 16) {
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        // Asymmetric warm analog saturation (adds audible 2nd/3rd harmonics for iPad speakers)
        const shaped = Math.tanh((x + 0.06 * x * x) * (1 + drive * 0.11));
        curve[i] = shaped;
    }
    return curve;
}

function _readVitalsSafe() {
    try {
        if (typeof window !== 'undefined' && window.Heartbeat && typeof window.Heartbeat.getVitals === 'function') {
            return window.Heartbeat.getVitals();
        }
    } catch (_) {}
    return { reservoirHours: 30, reservoirRatio: 1, speed: 1, luminescence: 1, frozen: false, flatlined: false };
}

function _isVoidActive() {
    try {
        return typeof document !== 'undefined' && document.body && document.body.classList.contains('hb-void-active');
    } catch (_) { return true; }
}

function _buildGraph() {
    if (_ac) return _ac;
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    let ac;
    try { ac = new AudioCtx(); } catch (_) { return null; }
    _ac = ac;
    _ensureNoiseBuffers(ac);

    // Master chain:
    //   Instruments -> _wallFilter (concrete low-pass) -> Warm Tape Saturation ->
    //   iPad-friendly Mid-Bass EQ -> Dynamics Limiter -> _masterGain -> Destination
    const warmthEq = ac.createBiquadFilter();
    warmthEq.type = 'peaking';
    warmthEq.frequency.value = 112;
    warmthEq.Q.value = 1.1;
    warmthEq.gain.value = 3.2; // makes muffled bass felt on iPad speakers without mud

    const subGuard = ac.createBiquadFilter();
    subGuard.type = 'highpass';
    subGuard.frequency.value = 32; // stops inaudible DC rumble from eating limiter headroom

    const tapeDrive = ac.createWaveShaper();
    tapeDrive.curve = _makeAnalogTapeCurve(14);
    tapeDrive.oversample = '2x';

    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -13;
    comp.knee.value = 14;
    comp.ratio.value = 6;
    comp.attack.value = 0.005;
    comp.release.value = 0.16;

    _masterGain = ac.createGain();
    _masterGain.gain.value = 0.0001;

    // Concrete wall low-pass filter (modulated smoothly by Void vs Study vs Health)
    _wallFilter = ac.createBiquadFilter();
    _wallFilter.type = 'lowpass';
    _wallFilter.frequency.value = 360;
    _wallFilter.Q.value = 1.4;

    // Sidechain ducking bus for drones/pads/reverb (pumps gently when kick hits)
    _duckBus = ac.createGain();
    _duckBus.gain.value = 1.0;

    // Dark bunker stereo reverb
    const reverb = _createCavernReverb(ac);
    const reverbWet = ac.createGain();
    reverbWet.gain.value = 0.42;
    _reverbSend = ac.createGain();
    _reverbSend.gain.value = 0.6;

    // Haunting dub-tape delay (3 dotted 16ths = ~0.489s) fed back through dark low-pass
    const delayL = ac.createDelay(1.5);
    const delayR = ac.createDelay(1.5);
    delayL.delayTime.value = STEP_SECS * 3;
    delayR.delayTime.value = STEP_SECS * 4.5;
    const delayFb = ac.createGain();
    delayFb.gain.value = 0.42;
    const delayLp = ac.createBiquadFilter();
    delayLp.type = 'lowpass';
    delayLp.frequency.value = 950;
    const delayWet = ac.createGain();
    delayWet.gain.value = 0.28;
    _delaySend = ac.createGain();
    _delaySend.gain.value = 0.55;

    _delaySend.connect(delayL);
    delayL.connect(delayLp);
    delayLp.connect(delayR);
    delayR.connect(delayFb);
    delayFb.connect(delayL);
    delayL.connect(delayWet);
    delayR.connect(delayWet);
    delayWet.connect(_duckBus);

    _reverbSend.connect(reverb);
    reverb.connect(reverbWet);
    reverbWet.connect(_duckBus);

    _duckBus.connect(_wallFilter);
    _wallFilter.connect(subGuard);
    subGuard.connect(warmthEq);
    warmthEq.connect(tapeDrive);
    tapeDrive.connect(comp);
    comp.connect(_masterGain);
    _masterGain.connect(ac.destination);

    // ── Layer 1A: Subterranean Stereo Reese Drone (always breathing underneath) ──
    _droneGain = ac.createGain();
    _droneGain.gain.value = 0.14;

    const dOscA = ac.createOscillator();
    dOscA.type = 'sawtooth';
    dOscA.frequency.value = 55.0;
    dOscA.detune.value = -9;

    const dOscB = ac.createOscillator();
    dOscB.type = 'sawtooth';
    dOscB.frequency.value = 55.0;
    dOscB.detune.value = +9;

    const dOscFifth = ac.createOscillator();
    dOscFifth.type = 'triangle';
    dOscFifth.frequency.value = 82.41; // E2 dark fifth harmonic
    const fifthGain = ac.createGain();
    fifthGain.gain.value = 0.22;

    const droneLp = ac.createBiquadFilter();
    droneLp.type = 'lowpass';
    droneLp.frequency.value = 165;
    droneLp.Q.value = 2.8;

    // Slow asynchronous breathing LFO
    const lfo = ac.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.065;
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 58;
    lfo.connect(lfoGain).connect(droneLp.frequency);

    dOscA.connect(droneLp);
    dOscB.connect(droneLp);
    dOscFifth.connect(fifthGain).connect(droneLp);
    droneLp.connect(_droneGain);
    _droneGain.connect(_duckBus);
    _droneGain.connect(_reverbSend);

    dOscA.start();
    dOscB.start();
    dOscFifth.start();
    lfo.start();

    // ── Layer 1B: Fluorescent Tube Transformer Hum + Dark Concrete Air ──
    _humGain = ac.createGain();
    _humGain.gain.value = 0.022;

    const humOsc1 = ac.createOscillator();
    humOsc1.type = 'sawtooth';
    humOsc1.frequency.value = 60.0;
    const humOsc2 = ac.createOscillator();
    humOsc2.type = 'square';
    humOsc2.frequency.value = 120.0;
    const hum2G = ac.createGain();
    hum2G.gain.value = 0.25;
    const humBp = ac.createBiquadFilter();
    humBp.type = 'bandpass';
    humBp.frequency.value = 220;
    humBp.Q.value = 5.0;
    humOsc1.connect(humBp);
    humOsc2.connect(hum2G).connect(humBp);
    humBp.connect(_humGain);

    const airSrc = ac.createBufferSource();
    airSrc.buffer = _noiseBuffer;
    airSrc.loop = true;
    const airBp = ac.createBiquadFilter();
    airBp.type = 'bandpass';
    airBp.frequency.value = 380;
    airBp.Q.value = 0.7;
    const airG = ac.createGain();
    airG.gain.value = 0.22;
    airSrc.connect(airBp).connect(airG).connect(_humGain);

    _humGain.connect(comp);
    humOsc1.start();
    humOsc2.start();
    airSrc.start();

    // ── Layer 1C: Flatline Dead-Signal Medical / CRT Drone ──
    const flOsc = ac.createOscillator();
    flOsc.type = 'sine';
    flOsc.frequency.value = 880;
    const flSub = ac.createOscillator();
    flSub.type = 'triangle';
    flSub.frequency.value = 44;
    const flSubG = ac.createGain();
    flSubG.gain.value = 1.6;
    _flatlineGain = ac.createGain();
    _flatlineGain.gain.value = 0.0001;
    flOsc.connect(_flatlineGain);
    flSub.connect(flSubG).connect(_flatlineGain);
    _flatlineGain.connect(_masterGain);
    flOsc.start();
    flSub.start();

    return ac;
}

// ── Synthesized Instruments (sample-accurate scheduling) ────────────────────

function _schedKick(ac, time, vel, duckAmount) {
    // Sub body with punchy pitch drop + subtle mid-punch harmonic for iPad speakers
    const osc = ac.createOscillator();
    const punch = ac.createOscillator();
    const g = ac.createGain();
    const pg = ac.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.085);
    osc.frequency.exponentialRampToValueAtTime(34, time + 0.24);

    punch.type = 'triangle';
    punch.frequency.setValueAtTime(220, time);
    punch.frequency.exponentialRampToValueAtTime(76, time + 0.045);

    const peak = Math.max(0.001, 0.44 * vel);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.29);

    pg.gain.setValueAtTime(0.0001, time);
    pg.gain.linearRampToValueAtTime(peak * 0.28, time + 0.003);
    pg.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);

    osc.connect(g);
    punch.connect(pg);
    pg.connect(g);
    g.connect(_wallFilter);
    g.connect(_reverbSend);

    osc.start(time);
    punch.start(time);
    osc.stop(time + 0.31);
    punch.stop(time + 0.07);

    // Sidechain pump on _duckBus (gives that authentic dark club-through-concrete breathing)
    if (_duckBus && duckAmount > 0.05) {
        const floor = Math.max(0.42, 1.0 - duckAmount * vel);
        _duckBus.gain.cancelScheduledValues(time);
        _duckBus.gain.setValueAtTime(_duckBus.gain.value, time);
        _duckBus.gain.linearRampToValueAtTime(floor, time + 0.015);
        _duckBus.gain.exponentialRampToValueAtTime(1.0, time + 0.26);
    }
}

function _schedReeseBass(ac, time, freq, dur, level = 1.0) {
    // Dual-detuned sawtooth Reese bass + resonant filter envelope
    const o1 = ac.createOscillator();
    const o2 = ac.createOscillator();
    const sub = ac.createOscillator();
    const lp = ac.createBiquadFilter();
    const g = ac.createGain();
    const subG = ac.createGain();

    o1.type = 'sawtooth';
    o2.type = 'sawtooth';
    sub.type = 'sine';
    o1.frequency.setValueAtTime(freq, time);
    o2.frequency.setValueAtTime(freq, time);
    sub.frequency.setValueAtTime(freq, time);
    o1.detune.value = -8;
    o2.detune.value = +8;

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(480 * (0.65 + 0.35 * level), time);
    lp.frequency.exponentialRampToValueAtTime(115, time + dur);
    lp.Q.value = 3.6;

    const peak = Math.max(0.001, 0.145 * level);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    subG.gain.value = 0.55;
    o1.connect(lp);
    o2.connect(lp);
    sub.connect(subG).connect(lp);
    lp.connect(g);
    g.connect(_duckBus);

    o1.start(time);
    o2.start(time);
    sub.start(time);
    o1.stop(time + dur + 0.04);
    o2.stop(time + dur + 0.04);
    sub.stop(time + dur + 0.04);
}

function _schedIndustrialClang(ac, time, vel) {
    // Muffled metallic snare / iron pipe hit in concrete distance
    const src = ac.createBufferSource();
    src.buffer = _noiseBuffer;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(640, time);
    bp.frequency.exponentialRampToValueAtTime(320, time + 0.14);
    bp.Q.value = 2.6;

    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.16 * vel, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);

    src.connect(bp).connect(g);
    g.connect(_wallFilter);
    g.connect(_reverbSend);
    src.start(time, Math.random() * 1.4, 0.2);
}

function _schedDarkHat(ac, time, vel) {
    const src = ac.createBufferSource();
    src.buffer = _crispNoiseBuffer;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2900;
    bp.Q.value = 2.5;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.032 * vel, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.038);
    src.connect(bp).connect(g).connect(_wallFilter);
    src.start(time, Math.random() * 0.3, 0.05);
}

function _schedGhostChime(ac, time, freq, level = 1.0) {
    // Eerie metallic FM industrial chime smeared into stereo reverb & dub delay
    const carrier = ac.createOscillator();
    const mod = ac.createOscillator();
    const modGain = ac.createGain();
    const g = ac.createGain();

    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(freq, time);
    mod.type = 'sine';
    // Non-integer FM ratio (1.414) creates cold hollow metallic overtones
    mod.frequency.setValueAtTime(freq * 1.414, time);
    modGain.gain.setValueAtTime(freq * 0.75, time);
    modGain.gain.exponentialRampToValueAtTime(1.0, time + 0.9);

    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.055 * level, time + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 1.85);

    mod.connect(modGain).connect(carrier.frequency);
    carrier.connect(g);
    g.connect(_reverbSend);
    g.connect(_delaySend);

    carrier.start(time);
    mod.start(time);
    carrier.stop(time + 1.95);
    mod.stop(time + 1.95);
}

function _schedDistantBunkerEcho(ac, time) {
    // Very sparse distant subterranean steel pipe / relay resonance
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'triangle';
    const base = 110 + Math.random() * 65;
    osc.frequency.setValueAtTime(base, time);
    osc.frequency.exponentialRampToValueAtTime(base * 0.62, time + 0.35);

    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.045, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.38);

    osc.connect(g);
    g.connect(_reverbSend);
    g.connect(_delaySend);
    osc.start(time);
    osc.stop(time + 0.42);
}

function _triggerCardiacLubDub(ac, intensity) {
    if (!ac || ac.state !== 'running' || !_enabled) return;
    const now = ac.currentTime;
    const hit = (offset, fStart, fEnd, amp) => {
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(fStart, now + offset);
        osc.frequency.exponentialRampToValueAtTime(fEnd, now + offset + 0.115);
        g.gain.setValueAtTime(0.0001, now + offset);
        g.gain.linearRampToValueAtTime(amp, now + offset + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.19);
        osc.connect(g).connect(_masterGain);
        osc.start(now + offset);
        osc.stop(now + offset + 0.21);
    };
    const scale = 0.14 + intensity * 0.24;
    hit(0.0,  72, 34, scale);
    hit(0.20, 60, 30, scale * 0.72);
}

// ── 8-Bar Evolving Lookahead Sequencer ──────────────────────────────────────

function _scheduleStep(stepIndex, time) {
    const v = _lastVitals || _readVitalsSafe();
    if (v.flatlined) return;

    const bar = Math.floor(stepIndex / 16) % 8; // 0..7
    const step = stepIndex % 16;
    const inVoid = _isVoidActive();
    const isCritical = v.reservoirHours < 3.0;
    const isTense = v.reservoirHours < 8.0;

    // Bar 6 & Bar 7 (first half) = atmospheric drop-out where kick pulls back, then slams in on Bar 0!
    const isDropout = (bar === 6) || (bar === 7 && step < 12);
    const isSlamFill = (bar === 7 && step >= 12);

    // 1. Kick drum
    const kickGrid = isCritical ? KICK_LIMP : (bar === 3 || bar === 5 ? KICK_HEAVY : KICK_FULL);
    const kVel = isSlamFill ? (step === 12 ? 0.9 : step === 14 ? 0.7 : 0) : (isDropout ? 0 : kickGrid[step]);
    if (kVel > 0) {
        const vScale = inVoid ? 1.0 : (v.frozen ? 0.45 : 0.60);
        const duckAmt = inVoid ? 0.44 : 0.22;
        _schedKick(_ac, time, kVel * vScale, duckAmt);
    }

    // 2. Evolving Reese bassline
    const bassRow = (bar === 2 || bar === 3) ? BAR_BASS_B
        : (bar === 5 || bar === 6) ? BAR_BASS_C
        : BAR_BASS_A;
    const bFreq = bassRow[step];
    if (bFreq > 0) {
        const sag = isCritical ? 0.945 : 1.0; // ominous tape sag under 3h
        const level = (inVoid ? 1.0 : 0.52) * (isDropout ? 0.72 : 1.0);
        const dur = (step === 0 || step === 8) ? STEP_SECS * 2.2 : STEP_SECS * 1.45;
        _schedReeseBass(_ac, time, bFreq * sag, dur, level);
    }

    // 3. Muffled bunker clang / industrial snare (void or slam fill)
    if (!isDropout && !isCritical) {
        const cVel = CLANG_PATTERN[step];
        if (cVel > 0) {
            _schedIndustrialClang(_ac, time, cVel * (inVoid ? 0.85 : 0.35));
        }
    }

    // 4. Subtle metallic hats (void only, never during math practice)
    if (inVoid && !isDropout && !isCritical) {
        const hVel = HAT_PATTERN[step];
        if (hVel > 0) _schedDarkHat(_ac, time, hVel);
    }

    // 5. Haunting sparse FM industrial chimes (bar 0 beat 1, bar 4 beat 3, bar 6 dropout)
    if ((bar === 0 && step === 0) || (bar === 4 && step === 8) || (bar === 6 && step === 4)) {
        const noteIdx = (bar + (isTense ? 1 : 0)) % GHOST_CHIMES.length;
        const chimeLevel = inVoid ? 1.0 : 0.45;
        _schedGhostChime(_ac, time, GHOST_CHIMES[noteIdx], chimeLevel);
    }

    // 6. Occasional distant bunker steel resonance during dropout bars
    if (inVoid && bar === 6 && step === 12) {
        _schedDistantBunkerEcho(_ac, time);
    }
}

function _schedulerTick() {
    if (!_running || !_enabled || !_ac || _ac.state !== 'running') return;
    if (typeof document !== 'undefined' && document.hidden) {
        _nextStepTime = _ac.currentTime + 0.05;
        return;
    }
    // Catch up cleanly if tab was throttled
    if (_nextStepTime < _ac.currentTime - 0.25) {
        _nextStepTime = _ac.currentTime + 0.04;
    }
    while (_nextStepTime < _ac.currentTime + SCHEDULE_AHEAD_SECS) {
        // Subtle micro-swing on odd 16th notes for hypnotic industrial groove
        const swing = (_globalStep % 2 === 1) ? STEP_SECS * 0.06 : 0;
        _scheduleStep(_globalStep, _nextStepTime + swing);
        _nextStepTime += STEP_SECS;
        _globalStep = (_globalStep + 1) % 128;
    }
}

function _applyHealthModulation() {
    if (!_ac || !_masterGain || !_wallFilter) return;
    const v = _readVitalsSafe();
    _lastVitals = v;
    const now = _ac.currentTime;
    const hidden = typeof document !== 'undefined' && document.hidden;

    if (!_enabled || hidden) {
        _masterGain.gain.setTargetAtTime(0.0001, now, 0.12);
        return;
    }

    const inVoid = _isVoidActive();
    if (v.flatlined) {
        _masterGain.gain.setTargetAtTime(0.36, now, 0.2);
        _wallFilter.frequency.setTargetAtTime(110, now, 0.3);
        if (_droneGain) _droneGain.gain.setTargetAtTime(0.05, now, 0.25);
        if (_humGain) _humGain.gain.setTargetAtTime(0.05, now, 0.25);
        if (_flatlineGain) _flatlineGain.gain.setTargetAtTime(0.042, now, 0.35);
        return;
    }

    if (_flatlineGain) _flatlineGain.gain.setTargetAtTime(0.0001, now, 0.15);

    // Master volume: rich & immersive in Void, smoothly muffled & ducked while solving/Pact
    const targetVol = inVoid ? 0.54 : (v.frozen ? 0.25 : 0.30);
    _masterGain.gain.setTargetAtTime(targetVol, now, 0.28);

    // Concrete wall filter opens up in Void, clamps down "behind glass" in study chamber
    const healthFrac = Math.max(0, Math.min(1, v.reservoirHours / 30));
    const baseCutoff = inVoid ? (220 + healthFrac * 290) : (145 + healthFrac * 95);
    _wallFilter.frequency.setTargetAtTime(baseCutoff, now, 0.35);
    _wallFilter.Q.setTargetAtTime(v.reservoirHours < 8 ? 3.4 : 1.4, now, 0.35);

    if (_droneGain) _droneGain.gain.setTargetAtTime(inVoid ? 0.16 : 0.11, now, 0.3);
    if (_humGain) {
        const buzz = v.reservoirHours < 3 ? 0.06 : (v.reservoirHours < 8 ? 0.038 : 0.02);
        _humGain.gain.setTargetAtTime(buzz, now, 0.3);
    }
}

function _scheduleCardiacLoop() {
    if (_cardiacTimer) { clearTimeout(_cardiacTimer); _cardiacTimer = null; }
    if (!_running || !_enabled) return;
    const v = _lastVitals || _readVitalsSafe();
    const bpm = Math.max(38, Math.min(92, 42 + (v.speed || 0.5) * 42));
    const periodMs = Math.round((60 / bpm) * 1000);
    _cardiacTimer = setTimeout(() => {
        if (_running && _enabled && _ac && _ac.state === 'running' && !(typeof document !== 'undefined' && document.hidden)) {
            const cur = _lastVitals || _readVitalsSafe();
            if (!cur.flatlined) {
                const stress = Math.max(0, Math.min(1, 1 - cur.reservoirHours / 20));
                if (_isVoidActive() || stress > 0.2) {
                    _triggerCardiacLubDub(_ac, stress);
                }
            }
        }
        _scheduleCardiacLoop();
    }, periodMs);
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
    _scheduleCardiacLoop();
}

function _stopLoops() {
    _running = false;
    if (_schedulerTimer) { clearInterval(_schedulerTimer); _schedulerTimer = null; }
    if (_modTimer) { clearInterval(_modTimer); _modTimer = null; }
    if (_cardiacTimer) { clearTimeout(_cardiacTimer); _cardiacTimer = null; }
}

function _syncButtonUI() {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('hb-audio-btn');
    if (btn) {
        btn.classList.toggle('is-audio-on', _enabled);
        btn.classList.toggle('is-audio-off', !_enabled);
        btn.setAttribute('aria-pressed', _enabled ? 'true' : 'false');
        const lbl = btn.querySelector('.hb-audio-lbl');
        if (lbl) lbl.textContent = _enabled ? 'AUDIO' : 'MUTED';
    }
}

export async function unlockAudio() {
    if (!_enabled) return false;
    const ac = _buildGraph();
    if (!ac) return false;
    try {
        if (ac.state === 'suspended') await ac.resume();
    } catch (_) {}
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
    _saveEnabled(_enabled);
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

// ── Tactile Buckshot-Inspired Mechanical Game SFX ───────────────────────────

/** Heavy industrial steel breaker-switch click. */
export function playClick() {
    if (!_enabled) return;
    const ac = _buildGraph();
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;

    // Dampened steel housing knock
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(195, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.036);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.16, now + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.048);
    osc.connect(g).connect(ac.destination);
    if (_reverbSend) g.connect(_reverbSend);
    osc.start(now);
    osc.stop(now + 0.055);

    // Crisp metallic micro-snap
    const src = ac.createBufferSource();
    src.buffer = _crispNoiseBuffer;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3100;
    bp.Q.value = 2.6;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.linearRampToValueAtTime(0.12, now + 0.0015);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
    src.connect(bp).connect(ng).connect(ac.destination);
    src.start(now, Math.random() * 0.25, 0.03);
}

/** 3-stage Buckshot chamber-rack / heavy steel latch sound (Pact lock-in & Heartbeat feed). */
export function playChamberLoad() {
    if (!_enabled) return;
    const ac = _buildGraph();
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;

    const stage = (offset, fStart, fEnd, bpFreq, gainAmt, dur) => {
        const osc = ac.createOscillator();
        const lp = ac.createBiquadFilter();
        const g = ac.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(fStart, now + offset);
        osc.frequency.exponentialRampToValueAtTime(fEnd, now + offset + dur);
        lp.type = 'lowpass';
        lp.frequency.value = 720;
        g.gain.setValueAtTime(0.0001, now + offset);
        g.gain.linearRampToValueAtTime(gainAmt, now + offset + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, now + offset + dur + 0.02);
        osc.connect(lp).connect(g).connect(ac.destination);
        if (_reverbSend) g.connect(_reverbSend);
        osc.start(now + offset);
        osc.stop(now + offset + dur + 0.03);

        const src = ac.createBufferSource();
        src.buffer = _crispNoiseBuffer;
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = bpFreq;
        bp.Q.value = 3.8;
        const ng = ac.createGain();
        ng.gain.setValueAtTime(0.0001, now + offset);
        ng.gain.linearRampToValueAtTime(gainAmt * 0.95, now + offset + 0.003);
        ng.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.038);
        src.connect(bp).connect(ng).connect(ac.destination);
        src.start(now + offset, Math.random() * 0.25, 0.045);
    };

    // 1. Metallic slide back  2. Pin click  3. Heavy steel chamber slam
    stage(0.0,   360, 170, 3200, 0.10, 0.045);
    stage(0.055, 520, 280, 4200, 0.08, 0.025);
    stage(0.105, 165,  46, 1250, 0.20, 0.095);
}

/** Cinematic power-on sub-swell + fluorescent ballast double-flicker on unlock. */
export function playBootIgnition() {
    if (!_enabled) return;
    const ac = _buildGraph();
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;

    // Deep sub ignition bloom
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(36, now);
    osc.frequency.exponentialRampToValueAtTime(84, now + 0.32);
    osc.frequency.exponentialRampToValueAtTime(55, now + 1.15);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.26, now + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);
    osc.connect(g).connect(ac.destination);
    if (_reverbSend) g.connect(_reverbSend);
    osc.start(now);
    osc.stop(now + 1.35);

    // Subtle fluorescent tube ignition double-flicker
    [0.05, 0.19].forEach((offset, idx) => {
        const buzz = ac.createOscillator();
        const bg = ac.createGain();
        const bp = ac.createBiquadFilter();
        buzz.type = 'sawtooth';
        buzz.frequency.value = 120;
        bp.type = 'bandpass';
        bp.frequency.value = 1400;
        bp.Q.value = 3.0;
        bg.gain.setValueAtTime(0.0001, now + offset);
        bg.gain.linearRampToValueAtTime(idx === 0 ? 0.035 : 0.055, now + offset + 0.01);
        bg.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.09);
        buzz.connect(bp).connect(bg).connect(ac.destination);
        buzz.start(now + offset);
        buzz.stop(now + offset + 0.11);
    });
}

/** Heavy power-grid shutdown collapse on 0.0h Flatline. */
export function playFlatlineDrop() {
    if (!_enabled) return;
    const ac = _buildGraph();
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;

    const osc = ac.createOscillator();
    const lp = ac.createBiquadFilter();
    const g = ac.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(22, now + 1.1);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(420, now);
    lp.frequency.exponentialRampToValueAtTime(60, now + 1.1);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.28, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);
    osc.connect(lp).connect(g).connect(ac.destination);
    if (_reverbSend) g.connect(_reverbSend);
    osc.start(now);
    osc.stop(now + 1.3);
}

export function initHeartbeatAudio() {
    _syncButtonUI();
    if (typeof document === 'undefined') return;

    const audioBtn = document.getElementById('hb-audio-btn');
    if (audioBtn && !audioBtn.dataset.hbAudioBound) {
        audioBtn.dataset.hbAudioBound = '1';
        audioBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleAudio();
        });
    }

    if (!_boundGestures) {
        _boundGestures = true;
        const onFirstGesture = () => {
            if (_enabled) unlockAudio();
        };
        document.addEventListener('pointerdown', onFirstGesture, { passive: true });
        document.addEventListener('touchstart', onFirstGesture, { passive: true });
        document.addEventListener('keydown', onFirstGesture, { passive: true });
        document.addEventListener('visibilitychange', () => {
            _applyHealthModulation();
        });
    }
}

export const HeartbeatAudio = {
    init: initHeartbeatAudio,
    unlock: unlockAudio,
    toggle: toggleAudio,
    setEnabled: setAudioEnabled,
    isEnabled: isAudioEnabled,
    playClick,
    playChamberLoad,
    playBootIgnition,
    playFlatlineDrop,
};

try {
    if (typeof window !== 'undefined') window.HeartbeatAudio = HeartbeatAudio;
} catch (_) {}
