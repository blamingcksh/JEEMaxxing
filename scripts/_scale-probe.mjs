// _scale-probe.mjs — TEMP: how does vault render scale with bank size?
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8983;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = await new Promise(r => {
    const s = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        fs.readFile(path.join(ROOT, p), (e, d) => {
            if (e) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
            res.end(d);
        });
    });
    s.listen(PORT, '127.0.0.1', () => r(s));
});
let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }

async function bench(total) {
    const page = await browser.newPage({ viewport: { width: 820, height: 1180 }, hasTouch: true });
    await page.addInitScript(() => {
        try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
    });
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (let i = 0; i < 8; i++) { if (!(await page.locator('.bootseq').count())) break; await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(250); }
    await page.waitForTimeout(800);
    const out = await page.evaluate(async (total) => {
        const storage = await import('./storage.js');
        const AppState = storage.AppState;
        const now = Date.now();
        const iso = d => new Date(now + d * 86400000).toISOString();
        let n = 0;
        for (let i = 0; i < total; i++) {
            n++;
            AppState.questionBank.push({
                id: 'sc-' + n, subject: ['physics', 'chemistry', 'maths'][i % 3],
                chapter: 'Chap' + (i % 20),
                extractedText: 'Scale probe ' + n, options: [], correctAnswer: '', type: 'text',
                status: i % 7 === 0 ? 'solved' : 'error', errorReason: ['conceptual', 'calculation', 'misread'][i % 3],
                currentInterval: i % 12, easeFactor: 2.5,
                nextReviewAt: iso(-(i % 9)), targetTimeMins: 5, isMastered: false,
                qElo: 1200, createdAt: iso(-(i % 80)),
                tags: [['torque', 'capacitors', 'integrals'][i % 3]],
                historyLogs: [{ timestamp: iso(-(i % 6)), result: 'incorrect', frictionTypes: '["CONCEPT"]' }],
                stability: 8, difficultyD: 5, reps: 2, lapses: 1,
            });
        }
        const el = document.querySelector('.subject-folder[data-subject="physics"]');
        window.openErrorMatrix('physics', el);
        await new Promise(r => setTimeout(r, 300));
        // median of 3 commits (warm caches — the steady-state you live in)
        const runs = [];
        for (let k = 0; k < 3; k++) {
            const s = performance.now();
            window.renderErrorMatrixFromBank();
            runs.push(Math.round(performance.now() - s));
            await new Promise(r => setTimeout(r, 50));
        }
        runs.sort((a, b) => a - b);
        return { bankTotal: total, perSubjectView: Math.round(total / 3), medianCommitMs: runs[1], domNodes: document.getElementsByTagName('*').length };
    }, total);
    console.log(JSON.stringify(out));
    await page.close();
}

await bench(600);
await bench(1500);
await bench(3000);
await bench(6000);
await browser.close(); server.close();
