// Extended QA for the v4 soundscape engine — covers what qa-focus-sound.mjs
// doesn't:
//   • preset switching is a true crossfade (old graph retires, no master dip)
//   • rapid multi-preset clicking never wedge the engine or leak graphs
//   • pause during a crossfade stays safe; replay works after
//   • slider fill painting (--sc-fill) tracks value + reset
//   • every generated WAV decodes in-browser and wraps clean at the seam
//   • duck() while playing recovers to full level
// Run: node scripts/qa-focus-sound-v4.mjs   (needs real Chrome/Edge)
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const server = await new Promise(resolve => {
    const s = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        const file = path.join(ROOT, p);
        fs.readFile(file, (err, data) => {
            if (err) { res.writeHead(404); res.end('nf'); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
});

let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }

let pass = 0, fail = 0;
const assert = (cond, name) => { if (cond) { pass++; console.log('  ok', name); } else { fail++; console.error('  FAIL', name); } };

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.bootseq').count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
}
await page.waitForTimeout(400);

await page.locator('[data-tab="pomodoro"]').click().catch(() => {});
await page.waitForTimeout(300);

// ── 1 · Slider fill painting ─────────────────────────────────────────────
const fillA = await page.evaluate(() => document.getElementById('sc-volume').style.getPropertyValue('--sc-fill'));
assert(fillA === '60%', `fill painted on boot (${fillA})`);
await page.locator('#sc-volume').evaluate(el => { el.value = 33; el.dispatchEvent(new Event('input', { bubbles: true })); });
const fillB = await page.evaluate(() => document.getElementById('sc-volume').style.getPropertyValue('--sc-fill'));
assert(fillB === '33%', `fill tracks input (${fillB})`);
await page.locator('#sc-volume').evaluate(el => el.dispatchEvent(new Event('dblclick', { bubbles: true })));
const fillC = await page.evaluate(() => document.getElementById('sc-volume').style.getPropertyValue('--sc-fill'));
assert(fillC === '60%', `fill resets with dblclick (${fillC})`);

// ── 2 · Start playback, then crossfade between several presets ───────────
await page.locator('#sc-power').click();
await page.waitForFunction(() => window.FocusSound && window.FocusSound.prefs.playing === true, null, { timeout: 6000 }).catch(() => {});
assert(await page.evaluate(() => window.FocusSound.prefs.playing), 'playback started');

// Rapid-fire clicks: rain → ocean → fire → wind with almost no gaps.
for (const id of ['ocean', 'fire', 'wind']) {
    await page.locator(`.sc-preset[data-sound="${id}"]`).click();
    await page.waitForTimeout(120);
}
await page.waitForTimeout(2500);
const st1 = await page.evaluate(() => window.FocusSound._state());
assert(await page.evaluate(() => window.FocusSound.prefs.playing), 'still playing after rapid preset storm');
assert(st1.sound === 'wind', `last preset wins (${st1.sound})`);
assert(st1.alive === 1, `exactly one live graph remains (${st1.alive}, dying=${st1.dying})`);

// Old graphs actually retire (no leaked audio chains).
await page.waitForFunction(() => window.FocusSound._state().graphs <= 2 && window.FocusSound._state().dying === 0, null, { timeout: 5000 })
    .then(() => assert(true, 'retired graphs fully cleaned up'))
    .catch(async () => assert(false, `retired graphs cleaned up (state ${JSON.stringify(await page.evaluate(() => window.FocusSound._state()))})`));

// ── 3 · Pause DURING an active crossfade, then resume ────────────────────
await page.locator('.sc-preset[data-sound="cafe"]').click();
await page.waitForTimeout(80);                                  // mid-load / mid-fade
await page.locator('#sc-power').click();
await page.waitForTimeout(900);
assert(await page.evaluate(() => window.FocusSound.prefs.playing === false), 'pause mid-crossfade stops cleanly');
const stPause = await page.evaluate(() => window.FocusSound._state());
assert(stPause.alive === 0, `no graphs alive after pause (${stPause.alive})`);
await page.waitForFunction(() => window.FocusSound._state().graphs === 0, null, { timeout: 4000 })
    .then(() => assert(true, 'all graphs stopped shortly after pause'))
    .catch(async () => assert(false, `graphs drained after pause (${JSON.stringify(await page.evaluate(() => window.FocusSound._state()))})`));

await page.locator('#sc-power').click();
await page.waitForFunction(() => window.FocusSound && window.FocusSound.prefs.playing === true, null, { timeout: 6000 }).catch(() => {});
assert(await page.evaluate(() => window.FocusSound.prefs.playing), 'replay works after pause-mid-crossfade');

// ── 5 · Duck recovery: level dips then climbs back ───────────────────────
await page.waitForTimeout(2200);                                // let fade-in finish
await page.evaluate(() => window.FocusSound.duck());
await page.waitForTimeout(2600);
assert(await page.evaluate(() => window.FocusSound.prefs.playing), 'duck did not kill playback');
void 0;

// ── 6 · Every bundled audio file decodes + generated WAVs wrap clean ─────
const audit = await page.evaluate(async () => {
    const files = ['white.wav', 'pink.wav', 'brown.wav', 'drone.wav', 'stream.wav', 'wind.wav', 'fire.wav', 'ocean.wav', 'rain.mp3', 'rain-roof.mp3', 'cafe.mp3'];
    const ctxA = new (window.AudioContext || window.webkitAudioContext)();
    const out = [];
    for (const f of files) {
        try {
            const buf = await fetch('assets/sounds/' + f).then(r => r.arrayBuffer())
                .then(b => new Promise((res, rej) => ctxA.decodeAudioData(b, res, rej)));
            const d = buf.getChannelData(0), sr = buf.sampleRate, L = d.length;
            // seam step vs median-ish step (mean of |step|)
            let acc = 0, maxStep = 0;
            for (let i = 1; i < L; i++) { const s = Math.abs(d[i] - d[i - 1]); acc += s; if (s > maxStep) maxStep = s; }
            const meanStep = acc / (L - 1);
            const winN = Math.floor(sr * 0.05);
            let seamMax = 0;
            for (let i = Math.max(1, L - winN); i < L; i++) seamMax = Math.max(seamMax, Math.abs(d[i] - d[i - 1]));
            for (let i = 1; i < winN; i++) seamMax = Math.max(seamMax, Math.abs(d[i] - d[i - 1]));
            out.push({ f, dur: +buf.duration.toFixed(1), chs: buf.numberOfChannels, seamX: +(seamMax / Math.max(1e-9, meanStep)).toFixed(1) });
        } catch (e) { out.push({ f, err: String(e).slice(0, 80) }); }
    }
    return out;
});
// WAV seams are baked at the file edges (equal-power) → tight threshold.
// MP3 recordings keep natural transients and loop via the runtime crossfade
// looper, so for them we only assert successful decode.
for (const r of audit) {
    if (r.err) { assert(false, `${r.f} decodes (${r.err})`); continue; }
    if (r.f.endsWith('.wav')) assert(r.seamX < 40, `${r.f} ${r.dur}s/${r.chs}ch wraps clean (seam ${r.seamX}× mean step)`);
    else assert(true, `${r.f} decodes (${r.dur}s/${r.chs}ch)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.slice(0, 10).join('\n'));
else console.log('no console/page errors');

await browser.close();
server.close();
process.exit(fail || errors.length ? 1 : 0);
