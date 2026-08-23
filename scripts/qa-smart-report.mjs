// qa-smart-report.mjs — real-browser QA for the Smart Mistake Report feature.
// Boots the app over HTTP, asserts clean module graph, exercises the AI Dump
// modal (empty state), renders the report engine inline, screenshots it.
// Run: node scripts/qa-smart-report.mjs

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8791;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

function startServer(port) {
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

let pass = 0, fail = 0;
const assert = (cond, name) => { if (cond) { pass++; console.log('  ✔', name); } else { fail++; console.error('  ✘', name); } };

const consoleErrors = [];
const pageErrors = [];

const server = await startServer(PORT);
console.log('QA server on http://127.0.0.1:' + PORT);

let browser;
for (const opts of [{}, { channel: 'msedge' }, { channel: 'chrome' }]) {
    try { browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...opts }); break; } catch (_) { /* next */ }
}
if (!browser) { console.error('No Chromium available'); process.exit(1); }

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => pageErrors.push(String(e)));

await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(3500); // let the module graph settle

assert(pageErrors.length === 0, 'no page errors on boot' + (pageErrors.length ? ' :: ' + pageErrors[0] : ''));
const fatalConsole = consoleErrors.filter(t => !/net::|favicon|googleapis|Failed to load resource/.test(t));
assert(fatalConsole.length === 0, 'no fatal console errors on boot' + (fatalConsole.length ? ' :: ' + fatalConsole[0] : ''));

// Function surface wired by app.js/mock.js
for (const fn of ['populateAiDumpChapters', 'renderAiDumpPreview', 'exportSmartReport', 'exportRawBankJson', 'selectAllDumpChapters']) {
    assert(await page.evaluate((f) => typeof window[f] === 'function', fn), 'window.' + fn + ' exposed');
}

// Open the AI Dump modal on the empty bank → friendly empty state, no crash.
await page.evaluate(() => { window.populateAiDumpChapters(); window.openModal('ai-dump-modal'); });
await page.waitForTimeout(300);
const listTxt = await page.evaluate(() => document.getElementById('ai-dump-chapter-list').textContent);
assert(/No chapters found/i.test(listTxt), 'empty-bank chapter list shows hint');
const previewBox = await page.evaluate(() => !!document.getElementById('ai-dump-report-preview'));
assert(previewBox, 'report preview container present in modal');

// Drive the pure engine in-page against synthetic data and render its HTML
// into the live preview container — verifies the browser-side pipeline.
await page.evaluate(async () => {
    const R = await import('./report.js');
    const NOW = Date.now();
    const mk = (i) => ({
        id: 'q' + i, subject: ['physics', 'chemistry', 'maths'][i % 3],
        chapter: 'Rotation',
        tags: [['Rotation', 'Torque'], ['Rotation'], [], ['Optics']][i % 4],
        qElo: [1650, 980, 1250, 2100][i % 4],
        errorReason: i % 2 ? '' : 'conceptual',
        historyLogs: i % 2 ? [] : [
            { timestamp: new Date(NOW - 5 * 864e5).toISOString(), result: 'incorrect', frictionTypes: JSON.stringify(['CONCEPT']), timeSpentMins: 6, confidence: 'sure' },
        ],
        extractedText: 'Q' + i, options: [], correctAnswer: 'A', type: 'mcq', solution: '', hint: '',
    });
    const qs = Array.from({ length: 12 }, (_, i) => mk(i));
    const report = R.buildMistakeReport(qs, { scopeText: 'physics › Rotation (qa)', elo: { physics: 1500, chemistry: 1300, maths: 1400 }, now: NOW });
    document.getElementById('ai-dump-report-preview').innerHTML = R.renderReportHtml(report, { maxTags: 12 });
    window.__qaReportText = R.renderReportText(report);
});
await page.waitForTimeout(200);
const kpiCount = await page.evaluate(() => document.querySelectorAll('#ai-dump-report-preview .rp-kpi').length);
assert(kpiCount === 4, 'preview rendered KPI strip (4 tiles, got ' + kpiCount + ')');
const tagRows = await page.evaluate(() => document.querySelectorAll('#ai-dump-report-preview .rp-table tbody tr').length);
assert(tagRows >= 3, 'preview rendered tag leaderboard rows (' + tagRows + ')');
const barRows = await page.evaluate(() => document.querySelectorAll('#ai-dump-report-preview .rp-bar-row').length);
assert(barRows >= 3, 'preview rendered difficulty bars (' + barRows + ')');

// Empty-gatherer alert path still works (legacy behavior preserved).
await page.evaluate(() => { document.querySelectorAll('#ai-dump-chapter-list input[type=checkbox]').forEach(c => { c.checked = false; }); window.renderAiDumpPreview(); });
const nudge = await page.evaluate(() => document.getElementById('ai-dump-report-preview').textContent);
assert(/Tick some chapters/i.test(nudge), 'silent nudge when nothing selected');

fs.mkdirSync('.qa-shots', { recursive: true });
await page.screenshot({ path: '.qa-shots/smart-report-modal.png' });
console.log('  📸 .qa-shots/smart-report-modal.png');

await browser.close();
server.close();
console.log(fail === 0 ? 'ALL QA CHECKS PASSED (' + pass + ')' : fail + ' QA FAILURES');
process.exit(fail === 0 ? 0 : 1);