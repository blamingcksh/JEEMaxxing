// QA pass — boot-sequence.js in a real headless Chromium.
// Serves nothing itself: run with the app served on 127.0.0.1:8787 (see the
// run instructions in the file header of the parent task). Uses the Playwright
// Chromium headless shell already cached under ~/.cache/ms-playwright.
//
// Scenarios:
//   A  Question Bank branch: typing → subject (mouse) → mood (KEYBOARD) →
//      path → pomo → chapter (empty bank → FEED QUESTIONS → upload modal).
//   B  ESC abort → same-day guard blocks re-show → reload → Matrix branch →
//      vault landing (empty queue → no modal).
//   C  prefers-reduced-motion: instant typing, scanlines + panel animation off.
//
// Every step also asserts layout sanity (no overflow, panel inside viewport,
// 6 HUD dots) and captures console errors + page errors. Screenshots land in
// /tmp/qa-shots/.

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:8787/index.html';

// Self-contained static server (module scripts need HTTP, not file://).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
function startServer(port = 8787) {
    const server = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        fs.readFile(path.join(ROOT, p), (err, data) => {
            if (err) { res.writeHead(404); res.end('not found'); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}
const SHOTS = '/tmp/qa-shots';
const EXEC = '/home/codespace/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';

let pass = 0, fail = 0;
const notes = [];
function assert(cond, name) {
    if (cond) { pass++; console.log('  ✔', name); }
    else { fail++; console.error('  ✘', name); }
}
function note(msg) { notes.push(msg); }

const server = await startServer();
console.log('QA server up on 127.0.0.1:8787');

// Prereq: `npm install` (playwright-core is a devDependency). The browser is
// the cached Chromium headless shell on this box; on other machines fall back
// to Playwright's own registry lookup (run `npx playwright-core install
// chromium` or `npx playwright install chromium` to fetch it).
let browser;
try {
    browser = await chromium.launch({
        executablePath: EXEC,
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
} catch (e) {
    browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
}

async function newPage(reducedMotion) {
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        reducedMotion: reducedMotion || 'no-preference',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
    return { context, page, errors };
}

const shot = async (page, name) => {
    try { await page.screenshot({ path: `${SHOTS}/${name}.png` }); } catch (_) {}
};

async function waitBoot(page, ms = 40000) {
    await page.waitForSelector('.bootseq', { timeout: ms });
}

// The Night Guard Tier-3 recovery modal can own the screen at boot (sleep
// guard). The boot sequence deliberately defers behind it and retries every
// 5s — so dismiss the blocker the legit way and let the retry chain mount.
async function dismissBlockers(page) {
    const modalOpen = await page.evaluate(() => {
        const m = document.getElementById('nightguard-modal');
        return !!(m && m.classList.contains('active'));
    });
    if (!modalOpen) return false;
    await page.evaluate(() => {
        try {
            if (window.__nightGuard && typeof window.__nightGuard.recordOverride === 'function') {
                window.__nightGuard.recordOverride();
            }
        } catch (_) {}
        const m = document.getElementById('nightguard-modal');
        if (m) m.classList.remove('active');
        document.body.classList.remove('nightguard-tint');
    });
    await page.waitForTimeout(400);
    return true;
}
async function waitTitle(page, text, ms = 10000) {
    await page.waitForFunction(
        t => Array.from(document.querySelectorAll('.bootseq-screen-title'))
            .some(el => (el.textContent || '').includes(t)),
        text, { timeout: ms });
}
async function waitGone(page, sel, ms = 8000) {
    await page.waitForFunction(s => !document.querySelector(s), sel, { timeout: ms });
}
async function clickOpt(page, text) {
    await page.locator('.bootseq-opt', { hasText: text }).first().click();
}
async function layoutCheck(page, name) {
    try {
        const r = await page.evaluate(() => {
            const mw = () => ({
                overX: document.documentElement.scrollWidth - window.innerWidth,
                overY: document.documentElement.scrollHeight - window.innerHeight,
            });
            const p = document.querySelector('.bootseq-panel').getBoundingClientRect();
            const before = mw();
            // Isolate the overlay's own contribution: the app behind it may
            // legitimately scroll, so only flag overflow the overlay ADDS.
            const ov = document.querySelector('.bootseq');
            ov.style.display = 'none';
            const after = mw();
            ov.style.display = '';
            return {
                addX: Math.max(0, before.overX) - Math.max(0, after.overX),
                addY: Math.max(0, before.overY) - Math.max(0, after.overY),
                left: p.left, top: p.top, right: p.right, bottom: p.bottom,
                iw: window.innerWidth, ih: window.innerHeight,
                dots: document.querySelectorAll('.bootseq-progress .bootseq-dot').length,
            };
        });
        assert(r.addX <= 0 && r.addY <= 0, name + ': overlay adds no scroll overflow');
        assert(r.left >= 0 && r.right <= r.iw && r.top >= 0 && r.bottom <= r.ih,
            name + ': panel fully inside the viewport');
        assert(r.dots === 6, name + ': 6 HUD progress dots');
    } catch (e) {
        assert(false, name + ': layout check threw — ' + e.message);
    }
}

async function walkToPath(page, { subject = 'Physics', mood = 'Steady' } = {}) {
    await waitTitle(page, 'PICK YOUR ARENA');
    await clickOpt(page, subject);
    await waitTitle(page, 'BRAIN BATTERY');
    await clickOpt(page, mood);
    await waitTitle(page, 'WHAT ARE WE COOKING');
}

// ─────────────────────────────── Scenario A ───────────────────────────────
// Real fresh-profile state: the app ships DEFAULT chapter lists, so the chapter
// step renders options (health 50, 0 Q) — walk through to the mode step and
// land in practice. (Empty-bank FEED route is exercised in A2.)
try {
    const { context, page, errors } = await newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000); // let boot + any sleep-guard modal settle
    const blockedA = await dismissBlockers(page);
    if (blockedA) note('A: nightguard recovery modal was up — dismissed, defer chain recovered');
    await waitBoot(page);
    assert(await page.locator('.bootseq-term').count() === 1, 'A: boot typing terminal mounted');
    await shot(page, '01-boot-typing');

    await waitTitle(page, 'PICK YOUR ARENA');
    assert(await page.locator('.bootseq-opt').count() === 3, 'A: subject picker shows 3 options');
    await layoutCheck(page, 'A subject screen');
    await shot(page, '02-subject');

    await clickOpt(page, 'Physics');
    await waitTitle(page, 'BRAIN BATTERY');
    assert(await page.locator('.bootseq-opt').count() === 3, 'A: mood step shows 3 options');
    // Keyboard navigation (real keydown dispatch → _onKey).
    await page.keyboard.press('2'); // Steady
    await waitTitle(page, 'WHAT ARE WE COOKING');
    assert(await page.locator('.bootseq-opt').count() === 2, 'A: path step shows 2 options');
    await shot(page, '03-path');

    await clickOpt(page, 'Question Bank');
    await waitTitle(page, 'LOCK IN WITH A TIMER');
    await shot(page, '04-pomo');
    await clickOpt(page, 'Raw Dog');
    await waitTitle(page, 'CHOOSE A CHAPTER');
    const chapterOpts = page.locator('.bootseq-opt');
    assert(await chapterOpts.count() >= 1, 'A: default chapters render in the picker (fresh profile)');
    await layoutCheck(page, 'A chapter screen');
    await shot(page, '05-chapters-default');

    await chapterOpts.first().click();
    await waitTitle(page, 'SELECT YOUR CHALLENGE LEVEL');
    assert(await page.locator('.bootseq-opt').count() === 3, 'A: mode step shows 3 options');
    await shot(page, '05b-mode');
    // Only Standard is enabled on a fresh profile (Flow/Hardcore need
    // untouched questions) — click the single non-disabled option. Label text
    // is unreliable: Flow State's hint literally says "pick Standard".
    await page.locator('.bootseq-opt:not(.is-disabled)').click();
    await waitGone(page, '.bootseq');
    await page.waitForTimeout(1400); // switchTab async render
    const practiceActive = await page.evaluate(() => {
        const v = document.getElementById('view-practice');
        return !!(v && v.classList.contains('active'));
    });
    assert(practiceActive, 'A: practice tab is the active view after QB launch');
    await shot(page, '05c-practice-landing');

    const bad = errors.filter(e => !e.startsWith('CONSOLE:'));
    assert(bad.length === 0, 'A: zero uncaught page errors');
    if (errors.length) note('A console/page log: ' + JSON.stringify(errors, null, 2));
    await context.close();
} catch (e) {
    assert(false, 'A: scenario threw — ' + e.message);
}

// ─────────────────────────────── Scenario A2 ───────────────────────────────
// Empty-bank route: zero chapters → FEED QUESTIONS → upload modal.
try {
    const { context, page, errors } = await newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await dismissBlockers(page);
    await waitBoot(page);
    await walkToPath(page);
    await clickOpt(page, 'Question Bank');
    await waitTitle(page, 'LOCK IN WITH A TIMER');
    // Empty the physics chapter list right before the chapter screen renders.
    await page.evaluate(() => { if (window.AppState && window.AppState.chapters) window.AppState.chapters.physics = []; });
    await clickOpt(page, 'Raw Dog');
    await waitTitle(page, 'CHOOSE A CHAPTER');
    const feedBtn = page.locator('.bootseq-skip', { hasText: 'FEED' });
    assert(await feedBtn.count() === 1, 'A2: empty chapters route to FEED QUESTIONS button');
    await shot(page, '06-feed-empty');
    await feedBtn.click();
    await waitGone(page, '.bootseq');
    await page.waitForTimeout(900);
    const uploadOpen = await page.evaluate(() => {
        const m = document.getElementById('upload-modal');
        if (!m) return false;
        return m.classList.contains('active') || getComputedStyle(m).display !== 'none';
    });
    assert(uploadOpen, 'A2: upload modal opens after FEED QUESTIONS');
    await shot(page, '06b-upload-modal');

    const bad = errors.filter(e => !e.startsWith('CONSOLE:'));
    assert(bad.length === 0, 'A2: zero uncaught page errors');
    if (errors.length) note('A2 console/page log: ' + JSON.stringify(errors, null, 2));
    await context.close();
} catch (e) {
    assert(false, 'A2: scenario threw — ' + e.message);
}

// ─────────────────────────────── Scenario B ───────────────────────────────
try {
    const { context, page, errors } = await newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const blockedB = await dismissBlockers(page);
    if (blockedB) note('B: nightguard recovery modal was up — dismissed, defer chain recovered');
    await waitBoot(page);
    await waitTitle(page, 'PICK YOUR ARENA');
    if (blockedB) {
        assert(true, 'B: boot sequence waited for the blocker to clear, then mounted (defer works)');
    }

    // ESC abort → guard written → same-day reload must NOT re-show.
    await page.keyboard.press('Escape');
    await waitGone(page, '.bootseq');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    assert(await page.locator('.bootseq').count() === 0, 'B: same-day re-show blocked after ESC abort');

    // Clear the guard → fresh show → Matrix branch.
    await page.evaluate(() => localStorage.removeItem('jeemax_boot_seq_date'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const blockedB2 = await dismissBlockers(page);
    if (blockedB2) note('B: nightguard re-appeared on reload — dismissed again');
    await waitBoot(page);
    await walkToPath(page, { subject: 'Chemistry', mood: 'Fried' });
    await shot(page, '06-path-b');
    await clickOpt(page, 'Error Matrix');

    await waitGone(page, '.bootseq');
    await page.waitForTimeout(1400); // switchTab async render + queue arm
    const vaultActive = await page.evaluate(() => {
        const v = document.getElementById('view-errors');
        return !!(v && v.classList.contains('active'));
    });
    assert(vaultActive, 'B: vault (#view-errors) is the active view');
    const practiceOpen = await page.evaluate(() => {
        const m = document.getElementById('practice-modal');
        if (!m) return false;
        return m.classList.contains('active') || getComputedStyle(m).display !== 'none';
    });
    assert(!practiceOpen, 'B: empty queue → no practice modal auto-opened');
    await shot(page, '07-matrix-landing');

    const bad = errors.filter(e => !e.startsWith('CONSOLE:'));
    assert(bad.length === 0, 'B: zero uncaught page errors');
    if (errors.length) note('B console/page log: ' + JSON.stringify(errors, null, 2));
    await context.close();
} catch (e) {
    assert(false, 'B: scenario threw — ' + e.message);
}

// ─────────────────────────────── Scenario C ───────────────────────────────
try {
    const { context, page, errors } = await newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await dismissBlockers(page);
    await waitBoot(page);
    const rmMatch = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    assert(rmMatch, 'C: reduced-motion media feature is active');
    await page.waitForFunction(() => document.querySelectorAll('.bootseq-line').length >= 5,
        { timeout: 4000 });
    const lines = await page.locator('.bootseq-line').count();
    assert(lines >= 5, 'C: reduced-motion typing renders all lines instantly (got ' + lines + ')');
    const rm = await page.evaluate(() => {
        const el = document.querySelector('.bootseq');
        const panel = document.querySelector('.bootseq-panel');
        if (!el || !panel) return null;
        return {
            scanlines: getComputedStyle(el, '::after').display,
            panelAnim: getComputedStyle(panel).animationName,
        };
    });
    assert(rm && rm.scanlines === 'none', 'C: scanline layer hidden under reduced-motion');
    assert(rm && rm.panelAnim === 'none', 'C: panel animations disabled under reduced-motion');
    await shot(page, '08-reduced-motion');
    const bad = errors.filter(e => !e.startsWith('CONSOLE:'));
    assert(bad.length === 0, 'C: zero uncaught page errors');
    if (errors.length) note('C console/page log: ' + JSON.stringify(errors, null, 2));
    await context.close();
} catch (e) {
    assert(false, 'C: scenario threw — ' + e.message);
}

await browser.close();
server.close();

console.log(`\n${pass} passed, ${fail} failed`);
if (notes.length) console.log('\n--- captured console/page log ---\n' + notes.join('\n'));
console.log('\nScreenshots: ' + SHOTS + '/*.png');
process.exit(fail ? 1 : 0);
