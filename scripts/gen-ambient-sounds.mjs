/* ============================================================================
 * scripts/gen-ambient-sounds.mjs  —  v2 (production-pass)
 * Pre-renders the Focus Soundscape WAV loops for JEEMaxxing into
 * assets/sounds/. v2 changes vs v1:
 *   • Much longer beds (24–52s) — a 10s noise loop repeats too obviously.
 *   • Every slow modulation (swells, gusts, breathing) is a SUM of sines at
 *     non-integer rate ratios against the loop length, so nothing audibly
 *     pulses on a fixed period. bakeSeam() still guarantees a click-free wrap.
 *   • Richer renderers: dual-layer ocean surf, clustered stream bubbles,
 *     intensity-modulated fire crackle roars, three-layer wind sweeps.
 *
 *   Output (16-bit mono PCM @ 22050 Hz):  white/pink/brown, drone, ocean,
 *   stream, fire, wind.  Rain + cafe use real CC0 recordings (see README in
 *   assets/sounds), so they're not generated here. Stereo width for mono
 *   beds is added at playback (Haas widener in focus-sound.js).
 *
 * Re-run with:  node scripts/gen-ambient-sounds.mjs
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 22050;                                   // 16-bit mono — plenty for ambience
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'sounds');
fs.mkdirSync(OUT, { recursive: true });

// ── WAV writer (16-bit mono PCM) ───────────────────────────────────────────
function writeWav(name, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);       // PCM
  buf.writeUInt16LE(1, 22);       // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);  // byte rate
  buf.writeUInt16LE(2, 32);       // block align
  buf.writeUInt16LE(16, 34);      // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`wrote ${name.padEnd(12)} ${(buf.length / 1024).toFixed(0).padStart(5)} KB  (${(n / SR).toFixed(1)}s loop)`);
}

// ── DSP helpers ─────────────────────────────────────────────────────────────
function makeLP() {                                  // one-pole lowpass (smooth)
  let y = 0;
  return (x, cutoff) => {
    y += (1 - Math.exp(-2 * Math.PI * cutoff / SR)) * (x - y);
    return y;
  };
}

function makeBP() {                                  // Chamberlin SVF bandpass (resonant, modulatable)
  let low = 0, band = 0, high = 0, f1 = 0, q1 = 0;
  return {
    set(freq, q) { f1 = 2 * Math.sin(Math.PI * Math.min(0.49, freq / SR)); q1 = 1 / q; },
    run(x) {
      low += f1 * band;
      high = x - low - q1 * band;
      band += f1 * high;
      return band;
    }
  };
}

function makeHP() {                                  // one-pole highpass (y tracks the DC side)
  let y = 0;
  return (x, cutoff) => {
    y += (1 - Math.exp(-2 * Math.PI * cutoff / SR)) * (x - y);
    return x - y;
  };
}

function noiseGen(kind) {                            // one sample per call
  let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return function () {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') return w;
    if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      const s = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
      return s;
    }
    last = (last + 0.02 * w) / 1.02;                 // brown
    return last * 3.5;
  };
}

function tri(x) { return (2 / Math.PI) * Math.asin(Math.sin(x)); }

// Layered LFO: sines at rates that are NON-integer fractions of the loop, so
// the combined contour never repeats within one loop revolution.
//   layers: [{ r: cycles-per-loop, g: weight, p: phase }]
function lfo(t, sec, layers) {
  let v = 0;
  for (const l of layers) v += l.g * Math.sin(2 * Math.PI * l.r * t / sec + (l.p || 0));
  return v;
}

// Bake a seamless loop: render `orig` with `f` extra samples beyond the loop
// point, then crossfade the continuation (orig[L..L+f)) into the head so the
// sample just before the loop equals the first sample of the loop.
function bakeSeam(orig, f) {
  const L = orig.length - f;
  const out = new Float32Array(L);
  for (let i = 0; i < f; i++) {
    const t = i / f;
    out[i] = orig[L + i] * (1 - t) + orig[i] * t;
  }
  for (let i = f; i < L; i++) out[i] = orig[i];
  return out;
}

function normalize(samples, peak) {
  let m = 0;
  for (let i = 0; i < samples.length; i++) m = Math.max(m, Math.abs(samples[i]));
  if (m > 0) { const g = peak / m; for (let i = 0; i < samples.length; i++) samples[i] *= g; }
  return samples;
}

// ── renderers ───────────────────────────────────────────────────────────────
function renderNoise(kind, sec, fade) {
  const L = Math.floor(sec * SR), f = Math.floor(fade * SR);
  const orig = new Float32Array(L + f);
  const gen = noiseGen(kind);
  for (let i = 0; i < L + f; i++) orig[i] = gen();
  return normalize(bakeSeam(orig, f), kind === 'white' ? 0.6 : kind === 'pink' ? 0.7 : 0.75);
}

function renderDrone(sec, fade) {
  const L = Math.floor(sec * SR), f = Math.floor(fade * SR);
  const orig = new Float32Array(L + f);
  const partials = [
    { f: 55,   g: 0.5,  t: 'sine' },
    { f: 82.5, g: 0.35, t: 'sine' },
    { f: 110,  g: 0.22, t: 'tri' },
    { f: 165,  g: 0.12, t: 'tri' },
    { f: 220,  g: 0.06, t: 'tri' }
  ];
  const pink = noiseGen('pink');
  const body = makeLP();
  for (let i = 0; i < L + f; i++) {
    const t = i / SR;
    // Two incommensurate breathing rates — never a fixed inhale/exhale period.
    const breath = 0.82 + 0.13 * Math.sin(2 * Math.PI * 5.3 * t / sec) + 0.05 * Math.sin(2 * Math.PI * 11.7 * t / sec + 1.1);
    let s = 0;
    for (const p of partials) {
      const det = 1 + 0.0015 * Math.sin(2 * Math.PI * 0.07 * t + p.f) + 0.0009 * Math.sin(2 * Math.PI * 0.113 * t + p.f * 2.1);
      const ph = 2 * Math.PI * p.f * det * t;
      s += p.g * (p.t === 'sine' ? Math.sin(ph) : tri(Math.sin(ph)));
    }
    orig[i] = s * breath + body(pink(), 380) * 0.02;   // faint air body under the drone
  }
  return normalize(bakeSeam(orig, f), 0.55);
}

function renderOcean(sec, fade) {
  const L = Math.floor(sec * SR), f = Math.floor(fade * SR);
  const orig = new Float32Array(L + f);
  const bed = makeLP();
  const surfA = makeBP(); surfA.set(700, 0.5);
  const surfB = makeBP(); surfB.set(1150, 0.7);
  const brown = noiseGen('brown');
  const white = noiseGen('white');
  const hiss = noiseGen('white');
  for (let i = 0; i < L + f; i++) {
    const t = i / SR;
    // Primary swell (5 per loop) + slower drag + secondary chop — irregular sea.
    const swell = 0.42 + 0.26 * Math.sin(2 * Math.PI * 5 * t / sec + 1.3)
                      + 0.10 * Math.sin(2 * Math.PI * 2.3 * t / sec)
                      + 0.08 * Math.sin(2 * Math.PI * 8.7 * t / sec + 2.6);
    const s = Math.max(0.05, swell);
    const shore = surfA.run(white()) * (0.05 + 0.15 * s * s)          // breakers ride the swell²
                + surfB.run(hiss()) * (0.03 + 0.09 * s);
    orig[i] = bed(brown(), 320) * s * 1.15 + shore;
  }
  return normalize(bakeSeam(orig, f), 0.65);
}

function renderStream(sec, fade) {
  const L = Math.floor(sec * SR), f = Math.floor(fade * SR);
  const orig = new Float32Array(L + f);
  const bpA = makeBP(), bpB = makeBP();
  const pink = noiseGen('pink'), pink2 = noiseGen('pink');
  for (let i = 0; i < L + f; i++) {
    const t = i / SR;
    // Two wandering channels (incommensurate wobbles) = lively brook, no pulse.
    bpA.set(950 + 230 * Math.sin(2 * Math.PI * 5 * t / sec), 1.7);
    bpB.set(1420 + 340 * Math.sin(2 * Math.PI * 8.3 * t / sec + Math.PI / 3), 2.1);
    orig[i] = bpA.run(pink()) * 0.62 + bpB.run(pink2()) * 0.38;
  }
  // Bubble blips, clustered like real riffles (5 clusters, not uniform spray)
  for (let c = 0; c < 5; c++) {
    const clusterAt = fade + Math.random() * (sec - 2 * fade);
    for (let k = 0; k < 6; k++) {
      const bt = clusterAt + (Math.random() - 0.5) * 1.6;
      if (bt < 0.2 || bt > sec - 0.2) continue;
      const bf = 1500 + Math.random() * 2400;
      const ba = 0.035 + Math.random() * 0.03;
      const start = Math.floor(bt * SR), n = Math.floor(0.05 * SR), att = Math.floor(0.012 * SR);
      for (let j = 0; j < n && start + j < orig.length; j++) {
        const env = j < att ? j / att : Math.exp(-(j - att) / (n - att) * 3);
        orig[start + j] += Math.sin(2 * Math.PI * bf * (j / SR)) * ba * env;
      }
    }
  }
  return normalize(bakeSeam(orig, f), 0.6);
}

function renderFire(sec, fade) {
  const L = Math.floor(sec * SR), f = Math.floor(fade * SR);
  const orig = new Float32Array(L + f);
  const bed = makeLP();
  const hp = makeHP();
  const brown = noiseGen('brown');
  for (let i = 0; i < L + f; i++) {
    const t = i / SR;
    // Glow flutter at two incommensurate rates.
    const flutter = 0.84 + 0.13 * Math.sin(2 * Math.PI * 3 * t / sec) + 0.06 * Math.sin(2 * Math.PI * 7.7 * t / sec + 2);
    orig[i] = bed(brown(), 300) * flutter;
  }
  // Crackles roar and settle: placement probability follows a slow contour,
  // so you get busy patches and quiet patches instead of machine-gun evenness.
  const crackleLfo = (t) => 0.5 + 0.34 * Math.sin(2 * Math.PI * 2.6 * t / sec + 0.7) + 0.16 * Math.sin(2 * Math.PI * 6.1 * t / sec + 2.2);
  const nTry = Math.floor(sec * 3.2);
  for (let k = 0; k < nTry; k++) {
    const ct = fade + Math.random() * (sec - 2 * fade);
    if (Math.random() > crackleLfo(ct)) continue;
    const cf = 1500 + Math.random() * 2600;
    const ca = (0.07 + Math.random() * 0.16) * (0.7 + crackleLfo(ct));
    const cq = 5 + Math.random() * 3;
    const start = Math.floor(ct * SR), n = Math.floor((0.03 + Math.random() * 0.02) * SR), att = Math.floor(0.005 * SR);
    const bp = makeBP(); bp.set(cf, cq);
    for (let j = 0; j < n && start + j < orig.length; j++) {
      const env = j < att ? j / att : Math.exp(-(j - att) / (n - att) * 4);
      orig[start + j] += bp.run(hp(Math.random() * 2 - 1, 400)) * ca * env;
    }
  }
  return normalize(bakeSeam(orig, f), 0.6);
}

function renderWind(sec, fade) {
  const L = Math.floor(sec * SR), f = Math.floor(fade * SR);
  const orig = new Float32Array(L + f);
  const layers = [
    { bp: makeBP(), nz: noiseGen('pink'), c: 480,  amp: 0.5, r: 3,   q: 1.3, p: 0 },
    { bp: makeBP(), nz: noiseGen('pink'), c: 760,  amp: 0.32, r: 5.3, q: 1.5, p: 1.4 },
    { bp: makeBP(), nz: noiseGen('pink'), c: 1080, amp: 0.2, r: 9.1, q: 1.7, p: 2.6 }
  ];
  for (let i = 0; i < L + f; i++) {
    const t = i / SR;
    // Gusts blow through at two incommensurate rates.
    const gust = 0.62 + 0.26 * Math.sin(2 * Math.PI * 2.4 * t / sec + 1) + 0.14 * Math.sin(2 * Math.PI * 6.3 * t / sec + 0.3);
    let s = 0;
    for (const l of layers) {
      const wob = l.c + 0.42 * l.c * Math.sin(2 * Math.PI * l.r * t / sec + l.p);   // howl sweeps around its centre
      l.bp.set(wob, l.q);
      s += l.bp.run(l.nz()) * l.amp;
    }
    orig[i] = s * gust;
  }
  return normalize(bakeSeam(orig, f), 0.55);
}

// ── build ───────────────────────────────────────────────────────────────────
console.log('Rendering ambient loops →', OUT);
writeWav('white.wav', renderNoise('white', 30, 1.5));
writeWav('pink.wav', renderNoise('pink', 30, 1.5));
writeWav('brown.wav', renderNoise('brown', 30, 1.5));
writeWav('drone.wav', renderDrone(36, 2.5));
writeWav('ocean.wav', renderOcean(52, 3.5));
writeWav('stream.wav', renderStream(40, 2.5));
writeWav('fire.wav', renderFire(44, 2.5));
writeWav('wind.wav', renderWind(44, 3));
console.log('Done.');
