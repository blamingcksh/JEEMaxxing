// Functional QA for the floating Metronome (metronome.js v1).
// Covers: FAB self-mount, panel open/close (click + M key), BPM steppers /
// slider / tap tempo, start-stop transport with live dot flashes + FAB badge,
// beats-per-bar stepper, voice chips, localStorage persistence across reload,
// and a clean console error tally.
//
// Run: node scripts/qa-metronome.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8797;
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
const server = await new Promise(resolve => {
    const s = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        fs.readFile(path.join(ROOT, p), (err, data) => {
            if (err) { res.writeHead(404); res.end('not found'); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
});
console.log('server up');

let browser;
try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
} catch {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
    try { localStorage.setItem('jeemax_nightguard_v1', JSON.stringify({ dismissed: true })); } catch {}
});
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

let pass = 0, fail = 0;
const assert = (cond, name) => {
    if (cond) { pass++; console.log('  ok', name); }
    else { fail++; console.error('  FAIL', name); }
};

try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200); // let deferred modules mount

    // ── 1 · FAB self-mounts ──
    const fab = page.locator('#metro-fab');
    assert(await fab.count() === 1, 'FAB mounts itself on boot');
    assert(await fab.isVisible(), 'FAB is visible');

    // API present
    assert(await page.evaluate(() => typeof window.Metro?.toggle === 'function'), 'window.Metro API exposed');

    // ── 2 · Panel opens on click, closes on ✕ ──
    await fab.click();
    assert(await page.locator('#metro-pop.open').count() === 1, 'panel opens from FAB');
    assert(await page.locator('#metro-bpm-num').textContent() === '100', 'default BPM readout is 100');
    assert(await page.locator('#metro-range').inputValue() === '100', 'default slider value is 100');
    assert((await page.locator('.metro-chip[data-voice="soft"]').getAttribute('class') || '').includes('active'),
        'fresh profile defaults to the Soft study voice');
    assert(await page.locator('#metro-vol').inputValue() === '55', 'fresh profile defaults to gentle 55% volume');
    // Minimal panel ships no close chrome — Escape is the explicit close.
    await page.keyboard.press('Escape');
    assert(await page.locator('#metro-pop.open').count() === 0, 'panel closes via Escape');

    // ── 3 · M-key toggles; outside click dismisses ──
    await page.keyboard.press('m');
    assert(await page.locator('#metro-pop.open').count() === 1, 'M key opens panel');
    await page.mouse.click(500, 450);
    assert(await page.locator('#metro-pop.open').count() === 0, 'outside click closes panel');

    // ── 4 · Steppers + slider drive the readout & storage ──
    await fab.click();
    await page.evaluate(() => window.Metro.setBpm(120));   // known baseline
    assert(await page.locator('#metro-bpm-num').textContent() === '120', 'setBpm API drives the readout');
    await page.locator('#metro-inc').click();
    assert(await page.locator('#metro-bpm-num').textContent() === '121', '+ stepper raises BPM by 1');
    await page.locator('#metro-dec').click();
    await page.locator('#metro-dec').click();
    assert(await page.locator('#metro-bpm-num').textContent() === '119', '− stepper lowers BPM by 1');
    await page.locator('#metro-range').evaluate(el => {
        el.value = '140';
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert(await page.locator('#metro-bpm-num').textContent() === '140', 'slider drag sets BPM to 140');
    const storedBpm = await page.evaluate(() => JSON.parse(localStorage.getItem('jeemax_metronome_prefs')).bpm);
    assert(storedBpm === 140, 'BPM persisted to jeemax_metronome_prefs');

    // ── 5 · Transport: start → dots flash + badge shows → stop ──
    await page.locator('#metro-play').click();
    assert(await page.evaluate(() => window.Metro.isRunning()), 'Metro.isRunning() true after play');
    assert((await fab.getAttribute('class') || '').includes('playing'), 'FAB gets .playing state');
    assert((await page.locator('#metro-fab-badge').textContent()) === '140', 'FAB badge shows live BPM');

    // At 140 BPM a beat lands every ~430ms — catch a lit dot within 1.5s.
    let sawFlash = false;
    for (let i = 0; i < 30 && !sawFlash; i++) {
        sawFlash = await page.locator('#metro-dots .metro-dot.on, #metro-dots .metro-dot.on-accent').count() > 0;
        if (!sawFlash) await page.waitForTimeout(50);
    }
    assert(sawFlash, 'beat dots light up while running');

    await page.locator('#metro-play').click();
    assert(!(await page.evaluate(() => window.Metro.isRunning())), 'second play-click stops the engine');
    assert(!(await fab.getAttribute('class') || '').includes('playing'), 'FAB clears .playing on stop');

    // ── 6 · Beats-per-bar stepper rebuilds the dots ──
    await page.locator('#metro-beat-inc').click();
    assert(await page.locator('#metro-beat-num').textContent() === '5', 'beats + stepper → 5 per bar');
    assert(await page.locator('#metro-dots .metro-dot').count() === 5, 'dot row rebuilt for 5 beats');

    // ── 7 · Voice chips switch + persist ──
    await page.locator('.metro-chip[data-voice="wood"]').click();
    assert((await page.locator('.metro-chip[data-voice="wood"]').getAttribute('class') || '').includes('active'), 'Wood chip becomes active');
    const storedVoice = await page.evaluate(() => JSON.parse(localStorage.getItem('jeemax_metronome_prefs')).voice);
    assert(storedVoice === 'wood', 'voice persisted');

    // ── 8 · Tap tempo lands near the tapped rate ──
    // (In-page clicks keep the 300ms cadence honest — Playwright's
    //  actionability checks between locator clicks add ~200ms jitter.)
    await page.evaluate(() => window.Metro.setBpm(100));
    await page.evaluate(async () => {
        const tap = document.getElementById('metro-tap');
        for (let i = 0; i < 5; i++) {
            tap.click();
            await new Promise(r => setTimeout(r, 300));
        }
    });
    const tapped = await page.evaluate(() => JSON.parse(localStorage.getItem('jeemax_metronome_prefs')).bpm);
    assert(Number.isFinite(tapped) && tapped >= 170 && tapped <= 235, `tap tempo ≈ 200 BPM (got ${tapped})`);

    // ── 9 · Persistence across reload ──
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('jeemax_metronome_prefs')));
    assert(after.bpm >= 130 && after.bpm <= 250, `reloaded session keeps tapped BPM (${after.bpm})`);
    assert(after.beats === 5, 'reloaded session keeps 5 beats/bar');
    assert(after.voice === 'wood', 'reloaded session keeps wood voice');
    assert(await page.locator('#metro-pop.open').count() === 0, 'panel stays closed after reload');
    assert(await page.locator('#metro-bpm-num').textContent() === String(after.bpm), 'readout hydrates from stored prefs');

    // ── 10 · v1 → v2 pref migration (separate context, seeded old prefs) ──
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await p2.addInitScript(() => {
        try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
        try { localStorage.setItem('jeemax_nightguard_v1', JSON.stringify({ dismissed: true })); } catch {}
        // A v1 install: old default volume (70), old voice name, custom BPM.
        try { localStorage.setItem('jeemax_metronome_prefs', JSON.stringify({ bpm: 120, volume: 70, voice: 'click', beats: 4 })); } catch {}
    });
    await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p2.waitForTimeout(900);
    assert(await p2.locator('#metro-vol').inputValue() === '55', 'migration snaps untouched v1 volume 70 → 55');
    assert((await p2.locator('.metro-chip[data-voice="soft"]').getAttribute('class') || '').includes('active'),
        'migration maps v1 click → soft voice');
    assert(await p2.locator('#metro-bpm-num').textContent() === '120', 'migration preserves a deliberately-set BPM');
    await ctx2.close();

    // ── 11 · Console cleanliness ──
    assert(errors.length === 0, `zero console/page errors (${errors.length})`);
    if (errors.length) console.error('errors:', errors.slice(0, 5));

} finally {
    await browser.close();
    server.close();
}
console.log(`\nmetronome QA: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
