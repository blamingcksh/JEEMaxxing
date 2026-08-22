// One-off probe: are the seam-window max-steps real discontinuities or just
// ordinary content? Prints absolute step values + positions for the seam
// zones vs the file's typical transient scale.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8801;
const MIME = { '.wav': 'audio/wav', '.html': 'text/html' };
const server = await new Promise(res => {
  const s = http.createServer((req, res2) => {
    if (req.url.startsWith('/probe.html')) {
      res2.writeHead(200, { 'Content-Type': 'text/html' });
      res2.end('<html><body>probe</body></html>');
      return;
    }
    const file = path.join(ROOT, req.url);
    fs.readFile(file, (err, data) => {
      if (err) { res2.writeHead(404); res2.end(); return; }
      res2.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res2.end(data);
    });
  });
  s.listen(PORT, '127.0.0.1', () => res(s));
});

let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${PORT}/probe.html`, { waitUntil: 'load' });

const result = await page.evaluate(async () => {
  const out = [];
  for (const f of ['fire.wav', 'drone.wav', 'stream.wav']) {
    const buf = await fetch(`assets/sounds/${f}`).then(r => r.arrayBuffer())
      .then(b => new Promise((res2, rej) => new AudioContext().decodeAudioData(b, res2, rej)));
    // also decode OFFLINE at native file rate for comparison
    const raw = buf.getChannelData(0), sr = buf.sampleRate, L = raw.length;
    const report = { f, sr, dur: +(L / sr).toFixed(1) };
    const scan = (from, to) => {
      let mx = 0, at = 0;
      for (let i = Math.max(1, from); i < Math.min(L, to); i++) {
        const s = Math.abs(raw[i] - raw[i - 1]);
        if (s > mx) { mx = s; at = i / sr; }
      }
      return { mx: +mx.toFixed(4), at: +at.toFixed(2) };
    };
    report.head = scan(0, 0.25 * sr);
    report.tail = scan(L - 0.25 * sr, L);
    report.midSample = scan(0.45 * L, 0.55 * L);
    // distribution reference: 99.9th percentile step over whole file
    const steps = [];
    for (let i = 1; i < L; i += 3) steps.push(Math.abs(raw[i] - raw[i - 1]));
    steps.sort((a, b) => a - b);
    report.p999 = +steps[Math.floor(steps.length * 0.999)].toFixed(4);
    report.p99 = +steps[Math.floor(steps.length * 0.99)].toFixed(4);
    out.push(report);
  }
  return out;
});

for (const r of result) {
  console.log(`${r.f} @${r.sr}Hz ${r.dur}s`);
  console.log(`  head ±250ms : max step ${r.head.mx} @ ${r.head.at}s`);
  console.log(`  tail ±250ms : max step ${r.tail.mx} @ ${r.tail.at}s`);
  console.log(`  mid 10% ref : max step ${r.midSample.mx}`);
  console.log(`  step p99=${r.p99}  p99.9=${r.p999}`);
}
await browser.close();
server.close();
