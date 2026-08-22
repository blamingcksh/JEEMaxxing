/* ============================================================================
 * scripts/gen-ambient-sounds.mjs  —  v3 (clean-pass)
 * Pre-renders the Focus Soundscape WAV loops for JEEMaxxing into
 * assets/sounds/.
 *
 * Why v3 exists (measured flaws of v2, see scripts/analyze-wavs.mjs):
 *   • bakeSeam used a LINEAR crossfade on uncorrelated noise tails → a −3dB
 *     loudness dip + tick on EVERY loop revolution (drone seam measured 3.6×
 *     the mean sample step). v3 uses equal-power sin/cos blending, and the
 *     drone is rendered EXACTLY periodic so it needs no seam at all.
 *   • fire crackles rang like gunshots (Q 5–8, amp up to 0.39) → worst sample
 *     step 187× the file mean. v3: 3× denser but far quieter/softer crackles,
 *     then a broadband AGC + soft-knee peak limiter caps every burst.
 *   • Preset levels were wildly inconsistent (white −9dBFS RMS vs ocean
 *     −28dBFS). v3 normalises every bed to its own loudness target.
 *   • brown/pink carried DC offset (±0.005) → boom under the Depth shelf.
 *     v3 DC-blocks every renderer output.
 *   • Wind howled like a siren (resonant sweeps ±42%). v3 wanders gently
 *     (±12%, low Q) behind a multi-rate gust envelope.
 *
 * Output: 16-bit mono PCM @ 32000 Hz. Rain + café remain real CC0 recordings.
 * Stereo width is added at playback (Haas widener in focus-sound.js).
 *
 * Re-run with:  node scripts/gen-ambient-sounds.mjs
 * Audit with :  node scripts/analyze-wavs.mjs
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 32000;                                   // 16-bit mono
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
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`wrote ${name.padEnd(12)} ${(buf.length / 1024 / 1024).toFixed(2).padStart(6)} MB  (${(n / SR).toFixed(0)}s loop)`);
}

// ── DSP helpers ─────────────────────────────────────────────────────────────
function makeLP() {                                  // one-pole lowpass
  let y = 0;
  return (x, cutoff) => {
    y += (1 - Math.exp(-2 * Math.PI * cutoff / SR)) * (x - y);
    return y;
  };
}
function makeHP() {                                  // one-pole highpass
  let y = 0;
  return (x, cutoff) => {
    y += (1 - Math.exp(-2 * Math.PI * cutoff / SR)) * (x - y);
    return x - y;
  };
}
function makeBP() {                                  // Chamberlin SVF bandpass
  let low = 0, band = 0, high = 0, f1 = 0, q1 = 0;
  return {
    set(freq, q) { f1 = 2 * Math.sin(Math.PI * Math.min(0.45, freq / SR)); q1 = 1 / Math.max(0.4, q); },
    run(x) {
      low += f1 * band;
      high = x - low - q1 * band;
      band += f1 * high;
      return band;
    }
  };
}
// DC blocker — two-pass zero-phase-ish (forward then backward) so loops don't
// carry a mean offset that booms under the Depth low-shelf.
function dcBlock(x) {
  const hp = (arr) => {
    let y = 0, xp = 0;
    const R = Math.exp(-2 * Math.PI * 8 / SR);       // ~8Hz corner
    const out = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      const yN = arr[i] - xp + R * y;
      xp = arr[i]; y = yN; out[i] = yN;
    }
    return out;
  };
  return hp(hp(x).reverse()).reverse();
}

function noiseGen(kind) {
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

// Layered LFO at NON-integer cycles-per-loop → the combined contour never
// repeats on a fixed period within the loop.
function lfo(t, sec, layers) {
  let v = 0;
  for (const l of layers) v += l.g * Math.sin(2 * Math.PI * l.r * t / sec + (l.p || 0));
  return v;
}

// Equal-power seam bake — the head/tail of a stochastic process are
// UNCORRELATED, so sin/cos halves keep power flat through the join (a linear
// crossfade dips −3dB right on the seam; that was v2's wrap "wobble").
function bakeSeam(orig, f) {
  if (f <= 0) return orig;
  const L = orig.length - f;
  const out = new Float32Array(L);
  for (let i = 0; i < f; i++) {
    const ang = Math.PI / 2 * (i / f);
    out[i] = orig[L + i] * Math.cos(ang) + orig[i] * Math.sin(ang);
  }
  for (let i = f; i < L; i++) out[i] = orig[i];
  return out;
}

function rmsOf(x, from = 0, to = x.length) {
  let a = 0;
  for (let i = from; i < to; i++) a += x[i] * x[i];
  return Math.sqrt(a / Math.max(1, to - from));
}
function normalizeRms(x, targetDb) {
  const cur = rmsOf(x);
  if (cur > 1e-9) {
    const g = Math.pow(10, targetDb / 20) / cur;
    for (let i = 0; i < x.length; i++) x[i] *= g;
  }
  return x;
}
// Soft-knee peak control — anything past the knee bends in smoothly, hard
// ceiling at ±0.97. Kills residual spikes without squashing the bed.
function peakSafe(x, knee = 0.78) {
  for (let i = 0; i < x.length; i++) {
    const v = x[i], a = Math.abs(v);
    if (a > knee) {
      const e = knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
      x[i] = Math.sign(v) * e * 0.97;
    }
  }
  return x;
}
// Broadband AGC — rides a smoothed windowed-RMS gain (fast cuts, slow lifts)
// so random bursts (fire pops, wave slams) can't blow out of the mix.
function agc(x, opts = {}) {
  const win = Math.floor((opts.win || 0.30) * SR);
  const target = Math.pow(10, (opts.targetDb ?? -20) / 20);
  const maxUp = Math.pow(10, (opts.maxUpDb ?? 2.5) / 20);
  const maxDown = Math.pow(10, -(opts.maxDownDb ?? 11) / 20);
  const n = x.length;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i] * x[i];
  const atk = Math.exp(-1 / (0.04 * SR));            // 40ms pull-down
  const rel = Math.exp(-1 / (1.1 * SR));             // 1.1s ease back up
  let cur = 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - (win >> 1)), b = Math.min(n, i + (win >> 1));
    const r = Math.sqrt((pre[b] - pre[a]) / Math.max(1, b - a));
    const want = r > 1e-6 ? Math.min(maxUp, Math.max(maxDown, target / r)) : 1;
    const k = want < cur ? atk : rel;
    cur = want + (cur - want) * k;
    out[i] = x[i] * cur;
  }
  return out;
}

// Full finishing chain: AGC → loudness target → soft peak limit → DC block.
// `skipAgc` for pure noise colours (already statistically flat).
function finish(x, targetDb, opts = {}) {
  let y = opts.skipAgc ? x : agc(x, { targetDb: targetDb + 1 });
  normalizeRms(y, targetDb);
  peakSafe(y);
  return dcBlock(y);
}

// ── renderers ───────────────────────────────────────────────────────────────
// Pure noise colours. Noise is statistically self-similar: repetition is a
// non-issue, but the WRAP must not tick — equal-power seam + no AGC needed.
function renderNoise(kind, sec, fade) {
  const L = Math.floor(sec * SR), f = Math.floor(fade * SR);
  const orig = new Float32Array(L + f);
  const gen = noiseGen(kind);
  for (let i = 0; i < L + f; i++) orig[i] = gen();
  return finish(bakeSeam(orig, f),
    kind === 'white' ? -23 : kind === 'pink' ? -21 : -19.5,
    { skipAgc: true });
}

// Deep Drone — EXACTLY periodic: every partial frequency is quantised to a
// whole number of cycles per loop and every breathing rate divides the loop,
// so the wrap is mathematically seamless (no crossfade, no dip, no tick).
// A separate DC-free pink "air" bed (seam-baked independently) sits beneath.
function renderDrone(sec, fade) {
  const L = Math.floor(sec * SR), f = Math.floor(fade * SR);
  const orig = new Float32Array(L + f);
  // Quantise target frequencies to integer cycles-per-loop (loop = `sec`s).
  const q = (hz) => Math.round(hz * sec) / sec;
  const partials = [
    { f: q(55),    g: 0.46 },
    { f: q(55.07), g: 0.20 },                       // beats 1/(sec)·2 Hz — slow bloom
    { f: q(82.5),  g: 0.30 },
    { f: q(82.62), g: 0.13 },
    { f: q(110),   g: 0.20 },
    { f: q(165),   g: 0.11, t: 'tri' },
    { f: q(220),   g: 0.055, t: 'tri' },
    { f: q(330),   g: 0.028, t: 'tri' }
  ];
  for (let i = 0; i < L + f; i++) {
    const t = i / SR;
    // Breathing: integer cycles-per-loop → periodic, never a fixed inhale cue.
    const breath = 0.86 + 0.10 * Math.sin(2 * Math.PI * 3 * t / sec) + 0.04 * Math.sin(2 * Math.PI * 7 * t / sec + 1.3);
    let s = 0;
    for (const p of partials) {
      const ph = 2 * Math.PI * p.f * t;
      s += p.g * (p.t === 'tri' ? 0.6 * tri(Math.sin(ph)) : Math.sin(ph));
    }
    orig[i] = s * breath;
  }
  const body = dcBlock(bakeSeam(orig, 0)).subarray(0, L);
  // Faint air bed — a random-phase CLUSTER OF SINES whose frequencies are all
  // integer cycles-per-loop, so the air texture is exactly periodic too and
  // the whole file wraps with zero discontinuity (stochastic pink noise here
  // was the last source of a sub-audible tail step).
  const airs = new Float32Array(L);
  const NPART = 160;
  for (let k = 0; k < NPART; k++) {
    const cyc = 4000 + Math.floor(Math.random() * 32000);   // ~100–900 Hz @ 40s loop
    const fHz = cyc / sec;
    const w = 2 * Math.PI * fHz / SR;
    const cw = Math.cos(w), sw = Math.sin(w);
    const ph0 = Math.random() * Math.PI * 2;
    let re = Math.cos(ph0), im = Math.sin(ph0);
    const ampW = 1 / Math.pow(fHz, 0.65);                   // pink-ish tilt
    for (let i = 0; i < L; i++) {
      airs[i] += re * ampW;
      if ((i & 0xffff) === 0) { const m = Math.hypot(re, im); re /= m; im /= m; }
      const nr = re * cw - im * sw;
      im = re * sw + im * cw;
      re = nr;
    }
  }
  let eB = 0, eA = 0;
  for (let i = 0; i < L; i++) { eB += body[i] * body[i]; eA += airs[i] * airs[i]; }
  const rel = 0.05 * Math.sqrt(eB / Math.max(1e-12, eA));   // air ≈ −26dB under body
  const out = new Float32Array(L);
  for (let i = 0; i < L; i++) out[i] = body[i] + airs[i] * rel;
  return finish(out, -21, { skipAgc: true });
}

// Ocean — deep surge bed under a many-layer swell contour (incommensurate
// rates → no fixed "every 10 seconds a big wave" period), plus discrete
// breaking-wave events placed stochastically with smooth envelopes.
function renderOcean(sec, fade) {
  const L = Math.floor(sec * SR), f = Math.floor(fade * SR);
  const orig = new Float32Array(L + f);
  const bed = makeLP();
  const surfA = makeBP(); surfA.set(750, 0.6);
  const surfB = makeBP(); surfB.set(1250, 0.8);
  const brown = noiseGen('brown');
  const white = noiseGen('white');
  const hiss = noiseGen('white');
  const swellLayers = [
    { r: 3,    g: 0.20, p: 1.3 }, { r: 4.7,  g: 0.13, p: 4.1 },
    { r: 7.3,  g: 0.09, p: 2.2 }, { r: 11.1, g: 0.06, p: 5.0 },
    { r: 17.9, g: 0.045, p: 0.7 }, { r: 27.3, g: 0.03, p: 3.3 }
  ];
  for (let i = 0; i < L + f; i++) {
    const t = i / SR;
    const swell = Math.max(0.12, 0.52 + lfo(t, sec, swellLayers));
    const shore = surfA.run(white()) * (0.05 + 0.13 * swell * swell)
                + surfB.run(hiss()) * (0.03 + 0.08 * swell);
    orig[i] = bed(brown(), 340) * swell * 1.05 + shore;
  }
  // Breaking-wave events: 2–4s swells of brightened surf, smooth in/out.
  const nBreak = Math.round(sec / 5.2);
  for (let k = 0; k < nBreak; k++) {
    const at = fade + 1 + Math.random() * Math.max(1, sec - 2 * fade - 2);
    const dur = 2.0 + Math.random() * 1.8;
    const amp = 0.10 + Math.random() * 0.12;
    const start = Math.floor(at * SR), n = Math.floor(dur * SR);
    const bp = makeBP(); bp.set(900 + Math.random() * 700, 0.7);
    for (let j = 0; j < n && start + j < orig.length; j++) {
      const u = j / n;
      const env = Math.pow(Math.sin(Math.PI * u), 1.6);          // smooth hump
      orig[start + j] += bp.run(noiseGen('white')()) * amp * env;
    }
  }
  return finish(bakeSeam(orig, f), -21);
}

// Stream — two wandering brook channels + faint sparkle; bubbles are quiet,
// rounded plops (soft attack, low resonance) in organic clusters.
function renderStream(sec, fade) {
  const L = Math.floor(sec * SR), f = Math.floor(fade * SR);
  const orig = new Float32Array(L + f);
  const bpA = makeBP(), bpB = makeBP(), hpS = makeHP();
  const pink = noiseGen('pink'), pink2 = noiseGen('pink'), pink3 = noiseGen('pink');
  for (let i = 0; i < L + f; i++) {
    const t = i / SR;
    bpA.set(920 + 170 * Math.sin(2 * Math.PI * 4.1 * t / sec), 1.3);
    bpB.set(1380 + 260 * Math.sin(2 * Math.PI * 6.7 * t / sec + Math.PI / 3), 1.5);
    const spark = 0.06 + 0.05 * Math.sin(2 * Math.PI * 3.3 * t / sec + 2);
    orig[i] = bpA.run(pink()) * 0.58 + bpB.run(pink2()) * 0.36 + hpS(pink3(), 2600) * spark;
  }
  // Bubbles: soft little plops in 8 loose clusters.
  for (let c = 0; c < 8; c++) {
    const clusterAt = fade + 0.5 + Math.random() * Math.max(1, sec - 2 * fade - 1);
    for (let k = 0; k < 4; k++) {
      const bt = clusterAt + (Math.random() - 0.5) * 1.8;
      if (bt < fade || bt > sec - fade) continue;
      const bf = 1300 + Math.random() * 2300;
      const ba = 0.018 + Math.random() * 0.026;
      const start = Math.floor(bt * SR), n = Math.floor(0.055 * SR), att = Math.floor(0.008 * SR);
      for (let j = 0; j < n && start + j < orig.length; j++) {
        const env = j < att ? j / att : Math.exp(-(j - att) / (n - att) * 3.2);
        orig[start + j] += Math.sin(2 * Math.PI * bf * (j / SR) * (1 + 0.12 * j / n)) * ba * env;
      }
    }
  }
  return finish(bakeSeam(orig, f), -19.5);
}

// Fireplace — warm ember bed + slow roar + MANY small soft crackles
// (dense-but-quiet reads as "fire", sparse-loud reads as "gunshots").
function renderFire(sec, fade) {
  const L = Math.floor(sec * SR), f = Math.floor(fade * SR);
  const orig = new Float32Array(L + f);
  const bed = makeLP();
  const roarBP = makeBP();
  const brown = noiseGen('brown'), pink = noiseGen('pink');
  for (let i = 0; i < L + f; i++) {
    const t = i / SR;
    const flutter = 0.88 + 0.09 * Math.sin(2 * Math.PI * 3.1 * t / sec) + 0.045 * Math.sin(2 * Math.PI * 7.7 * t / sec + 2);
    orig[i] = bed(brown(), 300) * flutter * 0.9
            + roarBP.run(pink()) * (0.10 + 0.05 * Math.sin(2 * Math.PI * 2.3 * t / sec + 1));
  }
  // Crackle field — dense, small, softly attacked; busy/quiet patches follow
  // a slow contour so it breathes naturally.
  const crackleLfo = (t) => 0.55 + 0.28 * Math.sin(2 * Math.PI * 2.6 * t / sec + 0.7) + 0.17 * Math.sin(2 * Math.PI * 6.1 * t / sec + 2.2);
  const nTry = Math.floor(sec * 11);
  for (let k = 0; k < nTry; k++) {
    const ct = fade + Math.random() * (sec - 2 * fade);
    if (Math.random() > crackleLfo(ct)) continue;
    const cf = 1200 + Math.random() * 3800;
    const ca = 0.016 + Math.random() * 0.05;                       // was 0.07–0.23!
    const cq = 1.8 + Math.random() * 2.2;                          // was Q 5–8 ring
    const start = Math.floor(ct * SR), n = Math.floor((0.022 + Math.random() * 0.045) * SR), att = Math.floor(0.0025 * SR);
    const bp = makeBP(); bp.set(cf, cq);
    for (let j = 0; j < n && start + j < orig.length; j++) {
      const env = j < att ? j / att : Math.exp(-(j - att) / (n - att) * 3.4);
      orig[start + j] += bp.run(Math.random() * 2 - 1) * ca * env;
    }
  }
  return finish(bakeSeam(orig, f), -20);
}

// Wind — three gently-wandering air layers (no siren howl), a multi-rate gust
// envelope, and a leaf-rustle shimmer riding the gusts.
function renderWind(sec, fade) {
  const L = Math.floor(sec * SR), f = Math.floor(fade * SR);
  const orig = new Float32Array(L + f);
  const layers = [
    { bp: makeBP(), nz: noiseGen('pink'), c: 420,  amp: 0.44, r: 2.3, q: 1.1, p: 0 },
    { bp: makeBP(), nz: noiseGen('pink'), c: 680,  amp: 0.30, r: 3.7, q: 1.2, p: 1.4 },
    { bp: makeBP(), nz: noiseGen('pink'), c: 990,  amp: 0.20, r: 5.1, q: 1.3, p: 2.6 }
  ];
  const hpLeaf = makeHP();
  const leaf = noiseGen('pink');
  const gustLayers = [
    { r: 1.7, g: 0.16, p: 1.0 }, { r: 3.4, g: 0.10, p: 3.9 }, { r: 6.1, g: 0.06, p: 0.4 }
  ];
  for (let i = 0; i < L + f; i++) {
    const t = i / SR;
    const gust = 0.66 + lfo(t, sec, gustLayers);
    let s = 0;
    for (const l of layers) {
      const wob = l.c * (1 + 0.12 * Math.sin(2 * Math.PI * l.r * t / sec + l.p));   // ±12% drift
      l.bp.set(wob, l.q);
      s += l.bp.run(l.nz()) * l.amp;
    }
    const rustle = hpLeaf(leaf(), 1600) * (0.02 + 0.085 * gust * gust) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 13.7 * t / sec));
    orig[i] = s * gust + rustle;
  }
  return finish(bakeSeam(orig, f), -20);
}

// ── build ───────────────────────────────────────────────────────────────────
console.log('Rendering ambient loops (v3) →', OUT);
writeWav('white.wav', renderNoise('white', 36, 2.0));
writeWav('pink.wav', renderNoise('pink', 36, 2.0));
writeWav('brown.wav', renderNoise('brown', 36, 2.0));
writeWav('drone.wav', renderDrone(40, 2.5));
writeWav('stream.wav', renderStream(56, 3.0));
writeWav('wind.wav', renderWind(60, 3.5));
writeWav('fire.wav', renderFire(60, 3.0));
writeWav('ocean.wav', renderOcean(68, 4.0));
console.log('Done.');
