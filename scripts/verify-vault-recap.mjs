// verify-vault-recap.mjs — the Error Matrix SR drawer must end with the same
// Mario recap the Arena stage plays: one logged card + one skipped card, then
// close the drawer and assert the parchment recap mounts with matching counts.
//
// Run: node scripts/verify-vault-recap.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8834;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';
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
console.log('Test server up on port ' + PORT);

let browser;
try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
} catch {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
}

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('UNCAUGHT EXCEPTION:', e));

await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
    try { localStorage.setItem('jeemax_nightguard_v1', JSON.stringify({ dismissed: true })); } catch {}
});

await page.goto(BASE, { waitUntil: 'networkidle' });
for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.bootseq').count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(250);
}
await page.waitForTimeout(600);

await page.click('.nav-item[data-tab="errors"]');
await page.waitForTimeout(400);

console.log('Seeding two due vault cards...');
await page.evaluate(async () => {
    const storage = await import('./storage.js');
    const now = Date.now();
    const iso = (d) => new Date(now + d * 86400000).toISOString();
    const mk = (id, text) => ({
        id,
        subject: 'physics',
        chapter: 'Kinematics',
        type: 'text',
        extractedText: text,
        correctAnswer: 'x',
        status: 'error',
        errorReason: 'conceptual',
        currentInterval: 0,
        easeFactor: 2.5,
        nextReviewAt: iso(0),
        targetTimeMins: 5,
        isMastered: false,
        historyLogs: [],
        qElo: 1200,
    });
    storage.AppState.questionBank.length = 0;
    storage.AppState.questionBank.push(
        mk('recap-q1', 'First recap card: state the work-energy theorem.'),
        mk('recap-q2', 'Second recap card: define impulse.')
    );
    storage.AppState.currentSubject = 'physics';
    storage.AppState.currentErrorSubject = 'physics';
    window.openErrorMatrix('physics', document.querySelector('.subject-folder[data-subject="physics"]'));
});
await page.waitForTimeout(600);

console.log('Driving the drawer: card 1 logged correct, card 2 skipped via ›...');
const drive = await page.evaluate(async () => {
    const out = {};
    const queueNow = () => [...document.querySelectorAll('#error-list-container .error-block:not(.hidden)')]
        .map(el => el.id || el.getAttribute('data-qid'));
    window.openPracticeDrawer('recap-q1');
    await new Promise(r => setTimeout(r, 350));
    out.queueOnOpen = queueNow();
    window.srSelfReport('correct');
    await new Promise(r => setTimeout(r, 250));
    window.submitPracticeLog({ keepOpenForNext: true });
    await new Promise(r => setTimeout(r, 350));
    out.queueAfterLog = queueNow();
    out.ledgerAfterLog = window.SessionRecap._items.map(i => i.outcome);
    // In-session navigation must preserve the ledger (a fresh open would reset it).
    window.openPracticeDrawer('recap-q2');
    await new Promise(r => setTimeout(r, 350));
    out.overlayOnSecondCard = !!document.getElementById('sr-practice-overlay');
    out.ledgerOnSecondCard = window.SessionRecap._items.map(i => i.outcome);
    // › on an unlogged card records the grey skip, then navigates or closes.
    window.srPracticeNext();
    await new Promise(r => setTimeout(r, 350));
    out.overlayAfterNext = !!document.getElementById('sr-practice-overlay');
    out.ledgerAfterNext = window.SessionRecap._items.map(i => i.outcome);
    // No-op when › already closed the drawer; otherwise it plays the recap.
    window.closePracticeDrawer();
    await new Promise(r => setTimeout(r, 350));
    out.recapMounted = !!document.getElementById('mario-recap');
    return out;
});
console.log('✓ In-session ledger after skip:', JSON.stringify(drive.ledgerAfterNext), '| recap mounted:', drive.recapMounted);

await page.waitForSelector('#mario-recap', { timeout: 5000 });
console.log('✓ Recap mounted after the drawer closed');

const tone = await page.evaluate(() => {
    const overlay = document.getElementById('mario-recap');
    return {
        isParchment: overlay.classList.contains('is-parchment'),
        immersive: document.body.classList.contains('immersive-active'),
    };
});
if (!tone.isParchment || tone.immersive) {
    throw new Error('Expected the parchment recap, got ' + JSON.stringify(tone));
}
console.log('✓ Recap uses the parchment tone');

await page.click('#mario-recap');
await page.waitForTimeout(400);

const counts = await page.evaluate(() => {
    const overlay = document.getElementById('mario-recap');
    return {
        green: document.getElementById('mario-recap-count-green')?.textContent,
        purple: document.getElementById('mario-recap-count-purple')?.textContent,
        red: document.getElementById('mario-recap-count-red')?.textContent,
        grey: document.getElementById('mario-recap-count-grey')?.textContent,
        greyShown: !document.getElementById('mario-recap-wrap-grey')?.hidden,
        summary: document.getElementById('mario-recap-summary')?.textContent || '',
        stillMounted: !!overlay,
    };
});
console.log('Recap counts:', JSON.stringify(counts, null, 2));

if (!counts.stillMounted) throw new Error('Recap unmounted before the counts were read');
if (counts.green !== '1') throw new Error('Expected 1 green (logged correct) block, got ' + counts.green);
if (counts.grey !== '1' || !counts.greyShown) throw new Error('Expected 1 visible grey (skipped) block, got ' + counts.grey);
if (counts.red !== '0' || counts.purple !== '0') throw new Error('Unexpected red/purple counts: ' + JSON.stringify(counts));
if (!/1 solved/.test(counts.summary) || !/1 skipped/.test(counts.summary)) {
    throw new Error('Summary pill does not report 1 solved + 1 skipped: ' + counts.summary);
}
console.log('✓ Recap counts and summary match the Vault session');

await browser.close();
server.close();
console.log('\nAll Error Matrix recap checks passed.');
