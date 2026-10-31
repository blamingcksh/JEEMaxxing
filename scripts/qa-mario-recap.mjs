import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8899;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(os.tmpdir(), 'jeemax-qa-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

const HARNESS = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Mario recap QA</title>
<link rel="stylesheet" href="/mario-recap.css">
<style>
html, body { margin: 0; min-height: 100%; background: #08090d; }
body { color: #eef1f6; font-family: ui-monospace, monospace; }
.qa-pad { padding: 32px; max-width: 720px; }
.qa-pad h1 { font-size: 28px; margin: 0 0 12px; }
.qa-pad p { color: #94a3b8; line-height: 1.6; }
.qa-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 24px; }
.qa-grid span { height: 96px; border: 1px solid #273044; border-radius: 14px; background: linear-gradient(145deg, #111827, #0b0e16); }
</style>
</head>
<body>
<div class="qa-pad">
<h1>Recap harness</h1>
<p>This surface intentionally stays visible behind the translucent recap so the blur, scene, and pill can be inspected.</p>
<div class="qa-grid"><span></span><span></span><span></span></div>
</div>
<script type="module">
import { SessionRecap, classify } from '/mario-recap.js';
window.SessionRecap = SessionRecap;
window.classify = classify;
window.__recapReady = true;
</script>
</body>
</html>`;

const server = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/' || url.pathname === '/qa-mario-recap.html') {
            res.writeHead(200, { 'Content-Type': MIME['.html'] });
            res.end(HARNESS);
            return;
        }
        const file = path.join(ROOT, decodeURIComponent(url.pathname));
        fs.readFile(file, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
});

let pass = 0;
let fail = 0;
const failures = [];
const ok = (cond, name, extra = '') => {
    if (cond) {
        pass++;
        console.log('  ok   ' + name);
    } else {
        fail++;
        failures.push(name);
        console.error('  FAIL ' + name + (extra ? ' :: ' + extra : ''));
    }
};

const consoleErrors = [];
const pageErrors = [];
const waitGone = (page) => page.waitForFunction(() => !document.getElementById('mario-recap'));

let browser;
try {
    try {
        browser = await chromium.launch({ channel: 'msedge', headless: true });
    } catch {
        browser = await chromium.launch({ channel: 'chrome', headless: true });
    }

    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'no-preference',
    });
    const page = await context.newPage();
    page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto('http://127.0.0.1:' + PORT + '/qa-mario-recap.html', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__recapReady === true);

    const seed = (items) => page.evaluate((rows) => {
        window.SessionRecap.reset();
        for (const row of rows) {
            window.SessionRecap.record({ id: row.id }, {
                correct: row.correct,
                secs: row.secs,
                targetSecs: row.targetSecs,
            });
        }
        return window.SessionRecap.summarize();
    }, items);

    const start = () => page.evaluate(() => {
        window.__recapDone = false;
        window.__recapPromise = window.SessionRecap.play().then(() => { window.__recapDone = true; });
    });

    console.log('-- Mario recap browser QA --');

    const summary = await seed([
        { id: 'q1', correct: false, secs: 10, targetSecs: 90 },
        { id: 'q2', correct: false, secs: 12, targetSecs: 90 },
        { id: 'q3', correct: true, secs: 120, targetSecs: 90 },
        { id: 'q4', correct: true, secs: 30, targetSecs: 90 },
        { id: 'q5', correct: true, secs: 20, targetSecs: 90 },
        { id: 'q6', correct: true, secs: 100, targetSecs: 90 },
        { id: 'q7', correct: true, secs: 110, targetSecs: 90 },
    ]);
    ok(summary.total === 7, 'seeded summary has 7 answered questions', JSON.stringify(summary));
    ok(summary.green === 3 && summary.purple === 2 && summary.red === 2, 'seed split is 3 green / 2 purple / 2 red', JSON.stringify(summary));

    const firstFrame = await page.evaluate(() => {
        const before = performance.now();
        window.__recapDone = false;
        window.__recapPromise = window.SessionRecap.play().then(() => { window.__recapDone = true; });
        const overlay = document.getElementById('mario-recap');
        const canvas = document.getElementById('mario-recap-canvas');
        const pill = document.getElementById('mario-recap-pill');
        const mountMs = performance.now() - before;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const pixels = ctx.getImageData(0, 0, width, height).data;
        let painted = 0;
        for (let i = 3; i < pixels.length; i += 124) {
            if (pixels[i] !== 0) painted++;
        }
        return {
            elapsed: mountMs,
            overlay: !!overlay,
            modal: overlay.getAttribute('aria-modal'),
            role: overlay.getAttribute('role'),
            pillRole: pill.getAttribute('role'),
            live: pill.getAttribute('aria-live'),
            bodyLocked: document.body.classList.contains('mario-recap-open'),
            summaryHidden: document.getElementById('mario-recap-summary').hidden,
            runHidden: document.getElementById('mario-recap-run').hidden,
            buttons: overlay.querySelectorAll('button').length,
            cssWidth: canvas.getBoundingClientRect().width,
            cssHeight: canvas.getBoundingClientRect().height,
            cornerAlpha: pixels[3],
            painted,
        };
    });

    ok(firstFrame.overlay, 'overlay mounts');
    ok(firstFrame.elapsed < 120, 'first frame renders synchronously', String(firstFrame.elapsed) + 'ms');
    ok(firstFrame.modal === null && firstFrame.role === null, 'overlay is not an aria modal dialog');
    ok(firstFrame.pillRole === 'status' && firstFrame.live === 'polite', 'pill is a polite live status');
    ok(!firstFrame.bodyLocked, 'overlay does not lock page scroll');
    ok(firstFrame.summaryHidden && !firstFrame.runHidden, 'run counts show before the summary');
    ok(firstFrame.buttons === 0, 'no legacy buttons remain');
    ok(firstFrame.cssWidth === 1440 && firstFrame.cssHeight === 900, 'canvas fills the viewport');
    ok(firstFrame.cornerAlpha === 0, 'canvas background stays transparent', String(firstFrame.cornerAlpha));
    ok(firstFrame.painted > 20, 'first frame paints a varied scene', String(firstFrame.painted));

    await page.waitForFunction(() => {
        const read = (id) => Number(document.getElementById(id)?.textContent || 0);
        return read('mario-recap-count-green') + read('mario-recap-count-purple') + read('mario-recap-count-red') > 0;
    }, { timeout: 5000 });
    await page.waitForTimeout(650);
    const midRun = await page.evaluate(() => {
        const read = (id) => Number(document.getElementById(id)?.textContent || 0);
        const pill = document.getElementById('mario-recap-pill').getBoundingClientRect();
        return {
            green: read('mario-recap-count-green'),
            purple: read('mario-recap-count-purple'),
            red: read('mario-recap-count-red'),
            summaryHidden: document.getElementById('mario-recap-summary').hidden,
            pillLeft: pill.left,
            pillRight: pill.right,
            pillTop: pill.top,
            pillBottom: pill.bottom,
            pillWidth: pill.width,
            vw: innerWidth,
            vh: innerHeight,
        };
    });
    ok(midRun.green + midRun.purple + midRun.red > 0, 'live counts register hits during the run', JSON.stringify(midRun));
    ok(midRun.summaryHidden, 'summary stays hidden during the run');
    ok(midRun.pillLeft >= 0 && midRun.pillRight <= midRun.vw && midRun.pillTop >= 0 && midRun.pillBottom <= midRun.vh, 'running pill stays inside the viewport', JSON.stringify(midRun));

    await page.screenshot({ path: path.join(SHOTS, 'mario-recap-run.png') });

    await page.mouse.click(70, 70);
    await page.waitForSelector('#mario-recap-pill.is-summary');

    const result = await page.evaluate(() => {
        const pill = document.getElementById('mario-recap-pill');
        const rect = pill.getBoundingClientRect();
        return {
            text: document.getElementById('mario-recap-summary').textContent,
            summaryHidden: document.getElementById('mario-recap-summary').hidden,
            runHidden: document.getElementById('mario-recap-run').hidden,
            transitionProperty: getComputedStyle(pill).transitionProperty,
            focused: document.activeElement?.id || document.activeElement?.tagName,
            inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        };
    });
    ok(result.text === '7 solved · 5 correct · 2 fast · 2 wrong', 'summary pill reports the run', result.text);
    ok(!result.summaryHidden && result.runHidden, 'summary replaces run counts in the same pill');
    ok(result.transitionProperty.includes('width'), 'summary pill expands with a width transition', result.transitionProperty);
    ok(result.focused !== 'mario-recap-pill' && result.focused !== 'mario-recap', 'overlay does not steal focus', String(result.focused));
    ok(result.inViewport, 'summary pill fits inside the viewport');

    await page.waitForTimeout(320);
    const settled = await page.evaluate(() => {
        const pill = document.getElementById('mario-recap-pill');
        return { width: pill.getBoundingClientRect().width, inlineWidth: pill.style.width };
    });
    ok(settled.width > midRun.pillWidth, 'summary pill is wider than the run pill', JSON.stringify({ run: midRun.pillWidth, summary: settled.width }));
    ok(settled.inlineWidth === '', 'pill returns to responsive sizing after expanding', settled.inlineWidth);
    await page.screenshot({ path: path.join(SHOTS, 'mario-recap-summary.png') });
    await page.mouse.click(70, 70);
    await waitGone(page);
    await page.waitForFunction(() => window.__recapDone === true);
    ok(true, 'tap dismisses the summary');

    await seed([{ id: 'escape-1', correct: true, secs: 100, targetSecs: 90 }]);
    await start();
    await page.waitForSelector('#mario-recap');
    await page.waitForTimeout(240);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#mario-recap-pill.is-summary');
    ok(true, 'Escape skips the run into the summary');
    await page.keyboard.press('Enter');
    await waitGone(page);
    await page.waitForFunction(() => window.__recapDone === true);
    ok(true, 'Enter dismisses the summary');

    await seed([{ id: 'fade-1', correct: true, secs: 30, targetSecs: 90 }]);
    await start();
    await page.waitForSelector('#mario-recap');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#mario-recap-pill.is-summary');
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(3700);
    ok(await page.evaluate(() => !!document.getElementById('mario-recap')), 'auto-fade pauses while the tab is hidden');
    await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(3000);
    ok(await page.evaluate(() => !!document.getElementById('mario-recap')), 'auto-fade resumes with time remaining');
    await waitGone(page);
    ok(await page.evaluate(() => window.__recapDone === true), 'auto-fade dismisses the summary');

    const longRun = Array.from({ length: 10 }, (_, i) => ({
        id: 'auto-' + i,
        correct: true,
        secs: 20,
        targetSecs: 90,
    }));
    await seed(longRun);
    const startedAt = Date.now();
    await start();
    await page.waitForSelector('#mario-recap');
    await page.waitForSelector('#mario-recap-pill.is-summary', { timeout: 15000 });
    const elapsedMs = Date.now() - startedAt;
    const autoRun = await page.evaluate(() => ({
        text: document.getElementById('mario-recap-summary').textContent,
        green: Number(document.getElementById('mario-recap-count-green').textContent),
        purple: Number(document.getElementById('mario-recap-count-purple').textContent),
        red: Number(document.getElementById('mario-recap-count-red').textContent),
    }));
    ok(autoRun.text === '10 solved · 10 correct · 10 fast · 0 wrong', '10-answer run auto-finishes without skipping', JSON.stringify(autoRun));
    ok(autoRun.green + autoRun.purple + autoRun.red === 10, 'all 10 blocks resolve', JSON.stringify(autoRun));
    ok(elapsedMs > 800 && elapsedMs < 12000, 'run plays through instead of shortcutting', String(elapsedMs) + 'ms');
    await page.mouse.click(70, 70);
    await waitGone(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await seed([
        { id: 'm1', correct: true, secs: 40, targetSecs: 90 },
        { id: 'm2', correct: true, secs: 50, targetSecs: 90 },
        { id: 'm3', correct: false, secs: 90, targetSecs: 90 },
    ]);
    await start();
    await page.waitForSelector('#mario-recap');
    await page.waitForTimeout(140);
    await page.mouse.click(20, 120);
    await page.waitForSelector('#mario-recap-pill.is-summary');
    await page.waitForTimeout(320);
    const mobile = await page.evaluate(() => {
        const pill = document.getElementById('mario-recap-pill').getBoundingClientRect();
        return {
            left: pill.left,
            right: pill.right,
            top: pill.top,
            bottom: pill.bottom,
            vw: innerWidth,
            vh: innerHeight,
            text: document.getElementById('mario-recap-summary').textContent,
            overflowX: document.documentElement.scrollWidth > innerWidth,
        };
    });
    ok(mobile.left >= 0 && mobile.right <= mobile.vw, 'mobile summary pill stays horizontally inside the viewport', JSON.stringify(mobile));
    ok(mobile.top >= 0 && mobile.bottom <= mobile.vh, 'mobile summary pill stays vertically inside the viewport', JSON.stringify(mobile));
    ok(!mobile.overflowX, 'mobile summary causes no page overflow');
    await page.screenshot({ path: path.join(SHOTS, 'mario-recap-mobile.png') });
    await page.mouse.click(20, 120);
    await waitGone(page);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seed([
        { id: 'r1', correct: true, secs: 10, targetSecs: 90 },
        { id: 'r2', correct: true, secs: 120, targetSecs: 90 },
        { id: 'r3', correct: false, secs: 30, targetSecs: 90 },
    ]);
    await start();
    await page.waitForSelector('#mario-recap');
    const reduced = await page.evaluate(() => {
        const canvas = document.getElementById('mario-recap-canvas');
        const ctx = canvas.getContext('2d');
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let painted = 0;
        for (let i = 3; i < data.length; i += 124) {
            if (data[i] !== 0) painted++;
        }
        return {
            summaryVisible: !document.getElementById('mario-recap-summary').hidden,
            text: document.getElementById('mario-recap-summary').textContent,
            runHidden: document.getElementById('mario-recap-run').hidden,
            cornerAlpha: data[3],
            painted,
        };
    });
    ok(reduced.summaryVisible, 'reduced motion opens on the summary immediately');
    ok(reduced.text === '3 solved · 2 correct · 1 fast · 1 wrong', 'reduced motion reports the same summary', reduced.text);
    ok(reduced.runHidden, 'reduced motion keeps the pill in summary form');
    ok(reduced.cornerAlpha === 0 && reduced.painted > 10, 'reduced motion paints static blocks on transparency', JSON.stringify(reduced));
    await page.screenshot({ path: path.join(SHOTS, 'mario-recap-reduced.png') });
    await page.mouse.click(20, 120);
    await waitGone(page);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
        document.documentElement.style.background = '#efe7d8';
        document.body.style.background = '#efe7d8';
        document.body.style.minHeight = '100vh';
        document.body.style.color = '#2a2620';
    });
    await seed([
        { id: 'light-1', correct: true, secs: 30, targetSecs: 90 },
        { id: 'light-2', correct: false, secs: 40, targetSecs: 90 },
    ]);
    await page.evaluate(() => {
        window.__recapDone = false;
        window.__recapPromise = window.SessionRecap.play({ tone: 'parchment' }).then(() => { window.__recapDone = true; });
    });
    await page.waitForSelector('#mario-recap.is-parchment');
    await page.waitForTimeout(160);
    await page.mouse.click(20, 120);
    await page.waitForSelector('#mario-recap-pill.is-summary');
    await page.waitForTimeout(320);
    const parchment = await page.evaluate(() => {
        const overlay = document.getElementById('mario-recap');
        const pill = document.getElementById('mario-recap-pill');
        return {
            veil: getComputedStyle(overlay).backgroundColor,
            pill: getComputedStyle(pill).color,
            text: document.getElementById('mario-recap-summary').textContent,
        };
    });
    ok(parchment.veil === 'rgba(238, 232, 218, 0.28)', 'parchment tone warms the veil', parchment.veil);
    ok(parchment.pill === 'rgb(59, 52, 41)', 'parchment tone uses dark ink in the pill', parchment.pill);
    ok(parchment.text === '2 solved · 1 correct · 1 fast · 1 wrong', 'parchment tone keeps the summary', parchment.text);
    await page.screenshot({ path: path.join(SHOTS, 'mario-recap-light.png') });
    await page.mouse.click(20, 120);
    await waitGone(page);
    await page.evaluate(() => {
        document.documentElement.style.background = '';
        document.body.style.background = '';
        document.body.style.minHeight = '';
        document.body.style.color = '';
    });

    // Elo pops + grey skipped blocks QA
    await page.evaluate(() => {
        window.SessionRecap.reset();
        window.SessionRecap.record({ id: 'elo-1' }, { correct: true, secs: 110, targetSecs: 90, eloDelta: 14 });
        window.SessionRecap.recordSkip({ id: 'skip-1' });
        window.SessionRecap.record({ id: 'elo-2' }, { correct: false, secs: 45, targetSecs: 90, eloDelta: -9 });
        window.SessionRecap.record({ id: 'elo-3' }, { correct: true, secs: 25, targetSecs: 90 });
        window.SessionRecap.noteElo({ id: 'elo-3' }, 22);
    });
    await start();
    await page.waitForSelector('#mario-recap');
    const greyWrapHiddenStart = await page.evaluate(() => document.getElementById('mario-recap-wrap-grey')?.hidden);
    ok(greyWrapHiddenStart === false, 'grey counter dot is visible when session has skipped questions');
    await page.waitForSelector('#mario-recap-pill.is-summary', { timeout: 10000 });
    const eloRun = await page.evaluate(() => {
        const overlay = document.getElementById('mario-recap');
        const summaryEl = document.getElementById('mario-recap-summary');
        const eloBadge = summaryEl.querySelector('.mr-elo');
        return {
            lastPop: overlay.dataset.lastPop,
            popHistory: JSON.parse(overlay.dataset.popHistory || '[]'),
            greyCount: Number(document.getElementById('mario-recap-count-grey')?.textContent || 0),
            summaryText: summaryEl.textContent,
            eloClass: eloBadge ? eloBadge.className : '',
            eloText: eloBadge ? eloBadge.textContent : '',
            megaOutcome: overlay.dataset.megaOutcome,
            megaPop: overlay.dataset.megaPop,
            finaleBranch: overlay.dataset.finaleBranch,
        };
    });
    ok(JSON.stringify(eloRun.popHistory) === JSON.stringify(['+14', '−9', '+22']), 'each answered block pops its formatted Elo delta in order', JSON.stringify(eloRun.popHistory));
    ok(eloRun.lastPop === '+22', 'lastPop dataset matches final answered block Elo pop', eloRun.lastPop);
    ok(eloRun.greyCount === 1, 'grey skipped block increments skipped counter to 1', String(eloRun.greyCount));
    ok(eloRun.summaryText === '3 solved · 2 correct · 1 fast · 1 wrong · 1 skipped · +27 Elo', 'summary pill includes skipped count and net Elo', eloRun.summaryText);
    ok(eloRun.eloClass.includes('is-pos') && eloRun.eloText === '+27 Elo', 'positive net Elo uses .mr-elo.is-pos styling', eloRun.eloClass + ' / ' + eloRun.eloText);
    ok(eloRun.megaOutcome === 'green' && eloRun.megaPop === '+27' && eloRun.finaleBranch === 'princess', 'positive net Elo merges into green Big Block (+27) and triggers Princess finale', JSON.stringify(eloRun));
    await page.screenshot({ path: path.join(SHOTS, 'mario-recap-princess.png') });
    await page.mouse.click(20, 120);
    await waitGone(page);

    await page.evaluate(() => {
        window.SessionRecap.reset();
        window.SessionRecap.record({ id: 'neg-1' }, { correct: false, secs: 40, targetSecs: 90, eloDelta: -9 });
        window.SessionRecap.record({ id: 'neg-2' }, { correct: false, secs: 50, targetSecs: 90, eloDelta: -6 });
    });
    await start();
    await page.waitForSelector('#mario-recap-pill.is-summary', { timeout: 10000 });
    const negRun = await page.evaluate(() => {
        const overlay = document.getElementById('mario-recap');
        return {
            megaOutcome: overlay.dataset.megaOutcome,
            megaPop: overlay.dataset.megaPop,
            finaleBranch: overlay.dataset.finaleBranch,
        };
    });
    ok(negRun.megaOutcome === 'red' && negRun.megaPop === '−15' && negRun.finaleBranch === 'closed', 'negative net Elo merges into red Big Block (−15) and keeps castle closed', JSON.stringify(negRun));
    await page.mouse.click(20, 120);
    await waitGone(page);

    const noResults = await page.evaluate(() => {
        window.SessionRecap.reset();
        return window.SessionRecap.play();
    });
    ok(noResults === null, 'play returns null when nothing was answered');

    ok(pageErrors.length === 0, 'no uncaught page errors', pageErrors.join(' | '));
    const relevantConsoleErrors = consoleErrors.filter((msg) => !/favicon|404/i.test(msg));
    ok(relevantConsoleErrors.length === 0, 'no console errors', relevantConsoleErrors.join(' | '));
    await context.close();

    const appContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const appPage = await appContext.newPage();
    const appErrors = [];
    appPage.on('pageerror', (err) => appErrors.push(String(err)));
    appPage.on('console', (msg) => {
        if (msg.type() === 'error') appErrors.push(msg.text());
    });
    await appPage.addInitScript(() => {
        try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
    });
    await appPage.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'networkidle' });
    for (let i = 0; i < 6; i++) {
        if (!(await appPage.locator('.bootseq').count())) break;
        await appPage.keyboard.press('Escape').catch(() => {});
        await appPage.waitForTimeout(200);
    }
    await appPage.waitForTimeout(500);
    await appPage.evaluate(() => {
        window.switchTab('practice', document.querySelector('[data-tab="practice"]'));
    });
    await appPage.waitForTimeout(250);
    const appSeeded = await appPage.evaluate(() => import('./storage.js').then(({ AppState }) => {
        AppState.questionBank = [
            {
                id: 'recap-integration-q1',
                subject: 'physics',
                chapter: 'RecapIntegration',
                extractedText: 'What is 2 + 2?',
                options: ['A) 3', 'B) 4', 'C) 5', 'D) 6'],
                correctAnswer: 'B) 4',
                type: 'mcq',
                status: 'unsolved',
                solution: 'Four.',
                createdAt: new Date().toISOString(),
                easeFactor: 2.5,
                currentInterval: 3,
                historyLogs: [],
                qElo: 1400,
                targetTimeMins: 5,
            },
            {
                id: 'recap-integration-q2',
                subject: 'physics',
                chapter: 'RecapIntegration',
                extractedText: 'Skip me in standard mode',
                options: ['A) 1', 'B) 2', 'C) 3', 'D) 4'],
                correctAnswer: 'A) 1',
                type: 'mcq',
                status: 'unsolved',
                solution: 'One.',
                createdAt: new Date().toISOString(),
                easeFactor: 2.5,
                currentInterval: 3,
                historyLogs: [],
                qElo: 1400,
                targetTimeMins: 5,
            },
            {
                id: 'recap-integration-q3',
                subject: 'physics',
                chapter: 'RecapIntegration',
                extractedText: 'Leave me open when closing',
                options: ['A) 1', 'B) 2', 'C) 3', 'D) 4'],
                correctAnswer: 'A) 1',
                type: 'mcq',
                status: 'unsolved',
                solution: 'One.',
                createdAt: new Date().toISOString(),
                easeFactor: 2.5,
                currentInterval: 3,
                historyLogs: [],
                qElo: 1400,
                targetTimeMins: 5,
            }
        ];
        AppState.currentSubject = 'physics';
        AppState.currentChapter = 'RecapIntegration';
        AppState.currentFilter = 'all';
        window.showQuestionList();
        return AppState.questionBank.length;
    }));
    ok(appSeeded === 3, 'app integration fixture seeds 3 questions');
    await appPage.waitForTimeout(450);
    await appPage.evaluate(() => {
        const btn = document.querySelector('#questions-grid-container .question-card');
        if (btn) btn.click();
    });
    await appPage.waitForSelector('#practice-modal.active');
    await appPage.evaluate(async () => {
        const { AppState } = await import('./storage.js');
        AppState.practiceSeconds = 20;
        const option = Array.from(document.querySelectorAll('#practice-modal-content .mcq-option'))
            .find((el) => el.textContent.includes('4'));
        if (option) option.click();
        document.getElementById('practice-submit-btn')?.click();
    });
    await appPage.waitForTimeout(650);
    // Advance past q1 -> q2, then click Next on q2 WITHOUT answering (records q2 as skipped), leaving q3 open
    await appPage.evaluate(() => {
        window.practiceNext(); // moves from solved q1 to unsolved q2
        window.practiceNext(); // moves from unsolved q2 to unsolved q3 (records q2 as skipped!)
    });
    await appPage.waitForTimeout(250);
    const appRecorded = await appPage.evaluate(() => window.SessionRecap.summarize());
    ok(appRecorded.total === 1 && appRecorded.correct === 1 && appRecorded.skipped === 1 && appRecorded.hasElo && appRecorded.netElo > 0, 'real practice session records solved Elo + Standard-mode skipped question while ignoring open question', JSON.stringify(appRecorded));

    const appSync = await appPage.evaluate(() => {
        window.closePracticeModal();
        return !!document.getElementById('mario-recap');
    });
    ok(appSync, 'real closePracticeModal launches the recap synchronously');
    await appPage.waitForSelector('#mario-recap', { timeout: 5000 });
    await appPage.waitForTimeout(300);
    await appPage.mouse.click(70, 70);
    await appPage.waitForSelector('#mario-recap-pill.is-summary');
    const appSummary = await appPage.evaluate(() => ({
        text: document.getElementById('mario-recap-summary').textContent,
        lastPop: document.getElementById('mario-recap').dataset.lastPop,
        zIndex: getComputedStyle(document.getElementById('mario-recap')).zIndex,
        bodyLocked: document.body.classList.contains('mario-recap-open'),
    }));
    const expectedAppSummary = `1 solved · 1 correct · 1 fast · 0 wrong · 1 skipped · +${appRecorded.netElo} Elo`;
    ok(appSummary.text === expectedAppSummary, 'app recap summarizes the real solve, skip, and net Elo', JSON.stringify(appSummary));
    ok(appSummary.lastPop === `+${appRecorded.netElo}`, 'app recap block pop matches the real subject Elo gain', appSummary.lastPop);
    ok(appSummary.zIndex === '2147483100', 'app recap sits above existing layers', appSummary.zIndex);
    ok(!appSummary.bodyLocked, 'app recap does not lock the underlying page');
    await appPage.waitForTimeout(320);
    await appPage.screenshot({ path: path.join(SHOTS, 'mario-recap-app-night.png') });
    await appPage.evaluate(() => { document.documentElement.dataset.mode = 'dusk'; });
    await appPage.waitForTimeout(220);
    const duskBg = await appPage.evaluate(() => getComputedStyle(document.getElementById('mario-recap')).backgroundColor);
    ok(duskBg === 'rgba(38, 42, 60, 0.24)', 'dusk mode retints the veil', duskBg);
    await appPage.screenshot({ path: path.join(SHOTS, 'mario-recap-app-dusk.png') });
    await appPage.mouse.click(70, 70);
    await waitGone(appPage);
    ok(true, 'app recap dismisses cleanly');

    const configSoundCheck = await appPage.evaluate(() => {
        const toggle = document.getElementById('fx-mario-sound');
        if (!toggle || !window.FX || typeof window.FX.wantMarioSound !== 'function') {
            return { found: false };
        }
        const initialChecked = toggle.checked;
        const initialWant = window.FX.wantMarioSound();
        toggle.click();
        const afterOffChecked = toggle.checked;
        const afterOffWant = window.FX.wantMarioSound();
        const storedOff = JSON.parse(localStorage.getItem('jeemax_fx_prefs') || '{}').marioSound;
        toggle.click();
        const afterOnChecked = toggle.checked;
        const afterOnWant = window.FX.wantMarioSound();
        const storedOn = JSON.parse(localStorage.getItem('jeemax_fx_prefs') || '{}').marioSound;
        return {
            found: true,
            initialChecked,
            initialWant,
            afterOffChecked,
            afterOffWant,
            storedOff,
            afterOnChecked,
            afterOnWant,
            storedOn,
        };
    });
    ok(configSoundCheck.found, 'Config panel includes #fx-mario-sound toggle');
    ok(configSoundCheck.initialChecked && configSoundCheck.initialWant, 'Mario sounds default to enabled in Config', JSON.stringify(configSoundCheck));
    ok(!configSoundCheck.afterOffChecked && !configSoundCheck.afterOffWant && configSoundCheck.storedOff === false, 'toggling off disables Mario sounds and persists in jeemax_fx_prefs', JSON.stringify(configSoundCheck));
    ok(configSoundCheck.afterOnChecked && configSoundCheck.afterOnWant && configSoundCheck.storedOn === true, 'toggling on re-enables Mario sounds and persists in jeemax_fx_prefs', JSON.stringify(configSoundCheck));
    const appRelevantErrors = appErrors.filter((msg) => !/favicon|404/i.test(msg));
    ok(appRelevantErrors.length === 0, 'app integration has no page or console errors', appRelevantErrors.join(' | '));
    await appContext.close();

    console.log('\nScreenshots: ' + SHOTS);
} catch (err) {
    console.error('QA crashed:', err);
    fail++;
    failures.push('QA crashed');
} finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed.');
if (failures.length) {
    console.error('Failures: ' + failures.join('; '));
    process.exit(1);
}
