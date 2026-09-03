// audit-backup-roundtrip.mjs — proves the full backup/restore pipeline:
// seed counters → buildFullBackup → DESTROY all IndexedDB rows + localStorage
// → verify empty → applyFullBackup → reload → verify the app rehydrated the
// seeded state. READ-ONLY against source; writes only to its own browser ctx.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8983;
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = await new Promise(res => {
    const s = http.createServer((req, res) => {
        let p = decodeURIComponent(req.url.split('?')[0]);
        if (p === '/') p = '/index.html';
        fs.readFile(path.join(ROOT, p), (err, data) => {
            if (err) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    s.listen(PORT, '127.0.0.1', () => res(s));
});

let pass = 0, fail = 0;
const assert = (c, n) => { if (c) { pass++; console.log('  ok', n); } else { fail++; console.error('  FAIL', n); } };

let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }

const ctx = await browser.newContext({ viewport: { width: 1024, height: 800 }, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!document.querySelector('.nav-item'), null, { timeout: 20000 }).catch(() => {});
for (let i = 0; i < 6; i++) {
    if (!(await page.locator('.bootseq').count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
}

// ── 1. Seed: +3 physics solves ──
await page.evaluate(() => window.changeCount('physics', 3));
await page.evaluate(async () => {
    const m = await import('./storage.js');
    await m.flushSaves();
});
const seededCount = await page.locator('#physics-count').textContent();
assert(seededCount.trim() === '3', `seeded physics count = 3 (${seededCount.trim()})`);

// ── 2. Build backup payload ──
const payload = await page.evaluate(async () => {
    const m = await import('./storage.js');
    return m.buildFullBackup();
});
assert(payload && payload.__jmaxBackup === true, 'backup payload carries marker');
assert(Array.isArray(payload.idb) && payload.idb.length > 10, `backup captured ${payload.idb?.length} idb keys`);
const bankEntry = payload.idb.find(e => e[0] === 'jeemax_question_bank');
const solvedEntry = payload.idb.find(e => e[0] === 'jeemax_solved');
assert(solvedEntry && solvedEntry[1] && solvedEntry[1].physics === 3, 'backup holds solved.physics=3');
assert(bankEntry && Array.isArray(bankEntry[1]), 'backup holds the question bank');
const lsKeys = Object.keys(payload.ls || {});
assert(lsKeys.some(k => k.includes('jeemax')), `localStorage snapshot captured (${lsKeys.length} keys)`);

// ── 2b. v3 manifest: every corner fingerprinted ──
assert(payload.version === 3, `backup format is v3 (${payload.version})`);
const sections = (payload.manifest && payload.manifest.sections) || [];
assert(sections.length >= payload.idb.length + lsKeys.length, `manifest fingerprints ${sections.length} sections`);
assert(sections.every(s => s && typeof s.k === 'string' && typeof s.b === 'number' && ('h' in s)), 'every section has key + bytes + hash');
assert(payload.manifest.totalBytes > 0, `manifest totals ${payload.manifest.totalBytes} bytes`);
assert(Array.isArray(payload.cpdb), 'backup carries the checkpoint-db section');

// ── 2c. Seed a checkpoint-db probe row (separate DB must round-trip too) ──
await page.evaluate(() => new Promise((resolve) => {
    try {
        const req = indexedDB.open('checkpoint-db', 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        req.onsuccess = () => {
            try {
                const tx = req.result.transaction('kv', 'readwrite');
                tx.objectStore('kv').put({ probe: 'audit-v3', at: Date.now() }, 'audit:probe');
                tx.oncomplete = () => { try { req.result.close(); } catch {} resolve(); };
                tx.onerror = () => resolve();
            } catch { resolve(); }
        };
        req.onerror = () => resolve();
    } catch { resolve(); } }));
const payload2 = await page.evaluate(async () => {
    const m = await import('./storage.js');
    return m.buildFullBackup();
});
const probeEntry = payload2.cpdb.find(e => e[0] === 'audit:probe');
assert(probeEntry && probeEntry[1] && probeEntry[1].probe === 'audit-v3', 'backup holds the checkpoint-db probe row');

// ── 3. Destroy EVERYTHING (simulated lost device / corruption) ──
await page.evaluate(async () => {
    const m = await import('./storage.js');
    const entries = await m.idbGetAllEntries();
    for (const [k] of entries) await m.idbRemove(k);
    try {
        const cps = await m.cpdbGetAllEntries();
        if (cps.length) {
            await new Promise((resolve) => {
                try {
                    const req = indexedDB.open('checkpoint-db', 1);
                    req.onsuccess = () => {
                        try {
                            const tx = req.result.transaction('kv', 'readwrite');
                            tx.objectStore('kv').clear();
                            tx.oncomplete = () => { try { req.result.close(); } catch {} resolve(); };
                            tx.onerror = () => resolve();
                        } catch { resolve(); }
                    };
                    req.onerror = () => resolve();
                } catch { resolve(); }
            });
        }
    } catch (_) {}
    try { localStorage.clear(); } catch (_) {}
});
const afterWipe = await page.evaluate(async () => {
    const m = await import('./storage.js');
    return (await m.idbGetAllEntries()).length;
});
assert(afterWipe === 0, `store emptied (${afterWipe} keys left)`);

// ── 4. Restore from the payload (use payload2 — it includes the cpdb probe) ──
const restored = await page.evaluate(async (p) => {
    const m = await import('./storage.js');
    return m.applyFullBackup(p);
}, payload2);
assert(restored && typeof restored.keys === 'number' && restored.keys > 10, `restore wrote ${restored?.keys} sections`);
assert(restored.ok === true && restored.mismatchCount === 0, `restore verified ${restored?.checked} sections, 0 mismatches`);
const probeBack = await page.evaluate(async () => {
    const m = await import('./storage.js');
    const rows = await m.cpdbGetAllEntries();
    return (rows.find(e => e[0] === 'audit:probe') || [])[1] || null;
});
assert(probeBack && probeBack.probe === 'audit-v3', 'checkpoint-db probe row survived the round-trip');

// ── 4b. v2 payloads (pre-manifest) still restore ──
const v2ok = await page.evaluate(async (p) => {
    const m = await import('./storage.js');
    const v2 = { __jmaxBackup: true, version: 2, exportedAt: p.exportedAt, idb: p.idb, ls: p.ls };
    const r = await m.applyFullBackup(v2);
    return r && r.keys > 10;
}, payload2);
assert(v2ok, 'v2 (legacy, no manifest/cpdb) payloads still restore');

// ── 5. Reload → real boot must rehydrate the seeded state ──
await page.reload({ waitUntil: 'domcontentloaded' });
// Hydration is async after DCL (storage read → UI write); poll, don't guess.
let rehydrated = '';
try {
    await page.waitForFunction(() => {
        const el = document.getElementById('physics-count');
        return el && el.textContent.trim() === '3';
    }, null, { timeout: 20000 });
    rehydrated = (await page.locator('#physics-count').textContent()).trim();
} catch (_) {
    rehydrated = (await page.locator('#physics-count').textContent().catch(() => '') || '').trim();
}
assert(rehydrated === '3', `post-reload physics count rehydrated = 3 (${rehydrated})`);

// ── 6. Rejects junk files ──
const rejected = await page.evaluate(async () => {
    const m = await import('./storage.js');
    try { await m.applyFullBackup({ hello: 'world' }); return false; }
    catch (e) { return true; }
});
assert(rejected, 'applyFullBackup rejects non-backup payloads');

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('PAGE ERRORS:\n' + errors.slice(0, 5).join('\n'));
await browser.close();
server.close();
process.exit(fail || errors.length ? 1 : 0);
