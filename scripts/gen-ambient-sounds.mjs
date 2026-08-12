/* ============================================================================
 * scripts/gen-ambient-sounds.mjs
 * Pre-renders the Focus Soundscape WAV loops for JEEMaxxing into
 * assets/sounds/. These replace the v2 real-time WebAudio synthesis, which
 * sounded rough (per-event scheduling clicks / jitter). Offline rendering
 * with smooth envelopes + baked seamless seams produces clean, loopable,
 * recording-like ambience with zero runtime CPU.
 *
 *   Output (16-bit mono PCM @ 22050 Hz):  white/pink/brown, drone, ocean,
 *   stream, fire, wind.  Rain + cafe use real CC0 recordings (see README in
 *   assets/sounds), so they're not generated here.
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
  for (let i = 0; i < L + f; i++) {
    const t = i / SR;
    const breath = 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.08 * t);   // slow breathing
    let s = 0;
    for (const p of partials) {
      const det = 1 + 0.0015 * Math.sin(2 * Math.PI * 0.07 * t + p.f); // slow beating
      const ph = 2 * Math.PI * p.f * det * t;
      s += p.g * (p.t === 'sine' ? Math.sin(ph) : tri(Math.sin(ph)));
    }
    orig[i] = s * breath;
  }
  return normalize(bakeSeam(orig, f), 0.55);
}

function renderOcean(sec, fade) {
  const L = Math.floor(sec * SR), f = Math.floor(fade * SR);
  const orig = new Float32Array(L + f);
  const bed = makeLP();
  const surf = makeBP(); surf.set(700, 0.5);
  const swellFreq = 2 / sec;                          // exactly 2 swells per loop
  const brown = noiseGen('brown');
  const white = noiseGen('white');
  for (let i = 0; i < L + f; i++) {
    const t = i / SR;
    const swell = 0.35 + 0.3 * Math.sin(2 * Math.PI * swellFreq * t);
    orig[i] = bed(brown(), 320) * swell + surf.run(white()) * (0.08 + 0.12 * swell);
  }
  return normalize(bakeSeam(orig, f), 0.65);
}

function renderStream(sec, fade) {
  const L = Math.floor(sec * SR), f = Math.floor(fade * SR);
  const orig = new Float32Array(L + f);
  const bp = makeBP();
  const gurgleFreq = 3 / sec;                         // 3 gurgle cycles per loop
  const pink = noiseGen('pink');
  for (let i = 0; i < L + f; i++) {
    const t = i / SR;
    bp.set(900 + 250 * Math.sin(2 * Math.PI * gurgleFreq * t), 2);
    orig[i] = bp.run(pink());
  }
  // bright bubble blips
  for (let k = 0; k < 8; k++) {
    const bt = Math.random() * sec * 0.8;
    const bf = 1500 + Math.random() * 2000;
    const ba = 0.04 + Math.random() * 0.03;
    const start = Math.floor(bt * SR), n = Math.floor(0.05 * SR), att = Math.floor(0.012 * SR);
    for (let j = 0; j < n && start + j < orig.length; j++) {
      const env = j < att ? j / att : Math.exp(-(j - att) / (n - att) * 3);
      orig[start + j] += Math.sin(2 * Math.PI * bf * (j / SR)) * ba * env;
    }
  }
  return normalize(bakeSeam(orig, f), 0.6);
}

function renderFire(sec, fade) {
  const L = Math.floor(sec * SR), f = Math.floor(fade * SR);
  const orig = new Float32Array(L + f);
  const bed = makeLP();
  const brown = noiseGen('brown');
  for (let i = 0; i < L + f; i++) {
    const t = i / SR;
    const flutter = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.5 * t);   // fire glow
    orig[i] = bed(brown(), 300) * flutter;
  }
  // crackles — short, soft-attack pops so they don't click
  const nCrack = Math.floor(sec * 1.4);
  for (let k = 0; k < nCrack; k++) {
    const ct = Math.random() * sec * 0.85;
    const cf = 1500 + Math.random() * 2500;
    const ca = 0.1 + Math.random() * 0.18;
    const cq = 5 + Math.random() * 3;
    const start = Math.floor(ct * SR), n = Math.floor((0.03 + Math.random() * 0.02) * SR), att = Math.floor(0.005 * SR);
    const bp = makeBP(); bp.set(cf, cq);
    for (let j = 0; j < n && start + j < orig.length; j++) {
      const env = j < att ? j / att : Math.exp(-(j - att) / (n - att) * 4);
      orig[start + j] += bp.run(Math.random() * 2 - 1) * ca * env;
    }
  }
  return normalize(bakeSeam(orig, f), 0.6);
}

function renderWind(sec, fade) {
  const L = Math.floor(sec * SR), f = Math.floor(fade * SR);
  const orig = new Float32Array(L + f);
  const bp = makeBP();
  const sweepFreq = 2 / sec, gustFreq = 4 / sec;
  const pink = noiseGen('pink');
  for (let i = 0; i < L + f; i++) {
    const t = i / SR;
    bp.set(700 + 350 * Math.sin(2 * Math.PI * sweepFreq * t), 1.4);  // howling sweep
    const gust = 0.6 + 0.35 * Math.sin(2 * Math.PI * gustFreq * t + 1.2);
    orig[i] = bp.run(pink()) * gust;
  }
  return normalize(bakeSeam(orig, f), 0.55);
}

// ── build ───────────────────────────────────────────────────────────────────
console.log('Rendering ambient loops →', OUT);
writeWav('white.wav', renderNoise('white', 10, 1.0));
writeWav('pink.wav', renderNoise('pink', 10, 1.0));
writeWav('brown.wav', renderNoise('brown', 10, 1.0));
writeWav('drone.wav', renderDrone(14, 1.5));
writeWav('ocean.wav', renderOcean(26, 3));
writeWav('stream.wav', renderStream(22, 2));
writeWav('fire.wav', renderFire(20, 2));
writeWav('wind.wav', renderWind(20, 2.5));
console.log('Done.');
