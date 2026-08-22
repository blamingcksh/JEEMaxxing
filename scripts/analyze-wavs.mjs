// Numeric audit of assets/sounds/*.wav — finds the artifacts behind
// "weird / cutting / blowing up" complaints without needing ears:
//   • seam click   : max |sample[i]-sample[i-1]| inside a ±50ms window around
//                    the loop point vs the global max step (a clean loop's
//                    seam step should look like every other step).
//   • loudness dip : RMS just after vs just before the wrap (linear-crossfade
//                    of uncorrelated noise dips -3dB right on the seam).
//   • crest factor : peak/RMS per 500ms window — high = spiky "blow-ups".
//   • DC offset    : mean sample value (booms when the Depth shelf boosts).
// Usage: node scripts/analyze-wavs.mjs [dir]
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds'));
import { fileURLToPath } from 'node:url';

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF');
  // walk chunks to data (handles extra LIST chunks)
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    const sz = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(pos + 10), sr: b.readUInt32LE(pos + 12), bits: b.readUInt16LE(pos + 22) };
    else if (id === 'data') { data = b.subarray(pos + 8, pos + 8 + sz); break; }
    pos += 8 + sz + (sz % 2);
  }
  if (!fmt || !data) throw new Error('bad wav');
  const n = Math.floor(data.length / 2) / fmt.ch;
  const chans = [];
  for (let c = 0; c < fmt.ch; c++) {
    const d = new Float32Array(Math.floor(n));
    for (let i = 0; i < d.length; i++) d[i] = data.readInt16LE((i * fmt.ch + c) * 2) / 32768;
    chans.push(d);
  }
  return { ...fmt, chans, dur: n / fmt.sr };
}

function analyze(name) {
  const w = readWav(path.join(DIR, name));
  const sr = w.sr, L = w.chans[0].length;
  const res = { name, dur: +w.dur.toFixed(1), sr, ch: w.ch };
  // merge to mono for stats (files are mono today; stereo-safe anyway)
  const x = new Float32Array(L);
  for (let i = 0; i < L; i++) { let s = 0; for (const c of w.chans) s += c[i]; x[i] = s / w.ch; }

  // global max adjacent step + its location
  let maxStep = 0, stepAt = 0;
  for (let i = 1; i < L; i++) { const s = Math.abs(x[i] - x[i - 1]); if (s > maxStep) { maxStep = s; stepAt = i; } }
  // steps in a ±60ms window at the seam, and median-ish reference step
  const win = Math.floor(0.06 * sr);
  let seamMax = 0;
  for (let i = Math.max(1, L - win); i < L; i++) seamMax = Math.max(seamMax, Math.abs(x[i] - x[i - 1]));
  for (let i = 1; i < Math.min(win, L); i++) seamMax = Math.max(seamMax, Math.abs(x[i] - x[i - 1]));
  // robust reference: mean of |step| over whole file
  let acc = 0; for (let i = 1; i < L; i++) acc += Math.abs(x[i] - x[i - 1]);
  const meanStep = acc / (L - 1);
  res.seamClick = +(seamMax / Math.max(1e-9, meanStep)).toFixed(1);      // seam worst-step ÷ avg step
  res.globalClickAt = `${(stepAt / sr).toFixed(2)}s`;
  res.globalClickRatio = +(maxStep / Math.max(1e-9, meanStep)).toFixed(0);

  // loudness across the wrap: RMS of 250ms before vs after loop point
  const rw = Math.floor(0.25 * sr);
  const rmsOf = (from, to) => { let a = 0, k = 0; for (let i = from; i < to && i < L; i++) { a += x[i] * x[i]; k++; } return k ? Math.sqrt(a / k) : 0; };
  const pre = rmsOf(L - rw, L), post = rmsOf(0, rw), mid = rmsOf(Math.floor(L / 2), Math.floor(L / 2) + rw);
  res.wrapDip = pre > 1e-6 ? +(20 * Math.log10(Math.min(pre, post) / Math.max(pre, post))).toFixed(1) : 0;
  res.rmsDbfs = mid > 1e-6 ? +(20 * Math.log10(mid)).toFixed(1) : -99;

  // crest factor per 500ms window: worst (spikiest) window
  const cw = Math.floor(0.5 * sr); let worstCrest = 0, worstPk = 0, overallRms = 0;
  for (let s = 0; s + cw <= L; s += cw) {
    let pk = 0, e = 0;
    for (let i = s; i < s + cw; i++) { const v = Math.abs(x[i]); if (v > pk) pk = v; e += x[i] * x[i]; }
    const r = Math.sqrt(e / cw);
    overallRms += r;
    const crest = pk / Math.max(1e-9, r);
    if (crest > worstCrest) worstCrest = crest;
    if (pk > worstPk) worstPk = pk;
  }
  res.worstCrest = +worstCrest.toFixed(1);
  res.peak = +worstPk.toFixed(3);
  res.meanCrest = +(overallRms / Math.max(1, Math.floor(L / cw))).toFixed(2);

  // DC offset
  let dc = 0; for (let i = 0; i < L; i++) dc += x[i];
  res.dc = +(dc / L).toFixed(5);
  return res;
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.wav')).sort();
console.log('file          dur(s)  sr     ch  rmsdBFS  peak   worstCrest  seamClick×mean  wrapDip(dB)  dc');
for (const f of files) {
  try {
    const r = analyze(f);
    console.log(
      r.name.padEnd(13) + String(r.dur).padEnd(8) + String(r.sr).padEnd(7) + String(r.ch).padEnd(4) +
      String(r.rmsDbfs).padEnd(9) + String(r.peak).padEnd(7) + String(r.worstCrest).padEnd(12) +
      String(r.seamClick).padEnd(16) + String(r.wrapDip).padEnd(12) + r.dc
    );
    console.log(''.padEnd(13) + `globalMaxStep ${r.globalClickRatio}× mean @ ${r.globalClickAt}, meanCrest≈${r.meanCrest}`);
  } catch (e) { console.error(f, 'ERR', e.message); }
}
