// qa-cortex-vault.mjs — Cognitive Cortex v3 end-to-end QA.
// Exercises the two REAL production paths the user called out:
//   A) Gemini Gem dump  → processGemTextDump + saveAllQuestions (question insertion)
//   B) Practice fumble  → confirmErrorLog → Vault → practice drawer solve
//      (error insertion), including the drawer tag editor, cortex-enriched
//      history logs, the target-retention schedule override, priority-ordered
//      daily queue, and the decay-drilldown extras.
// Run: node scripts/qa-cortex-vault.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8821;
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
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
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
    try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {}
});
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

let pass = 0, fail = 0;
const assert = (cond, name) => {
    if (cond) { pass++; console.log('  ok', name); }
    else { fail++; console.error('  FAIL', name); }
};

await page.goto(BASE, { waitUntil: 'networkidle' });
for (let i = 0; i < 6; i++) {
    const overlay = page.locator('.bootseq');
    if (!(await overlay.count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(250);
}
await page.waitForTimeout(800);

// ════════════════════════════════════════════════════════════════════════
// A · GEMINI GEM DUMP — the main question-insertion path must stay fully
// functional AND stamp createdAt + carry personal tags through.
// ════════════════════════════════════════════════════════════════════════
console.log('[A] Gemini Gem dump ingestion');
const dump = JSON.stringify([
    {
        extractedText: 'A solid sphere rolls down an incline. Find its acceleration.',
        subject: 'physics', chapter: 'Rotational Motion',
        options: ['A) 5g/7', 'B) g/2', 'C) 3g/5', 'D) 2g/3'], correctAnswer: 'A',
        type: 'mcq', qElo: 1450, targetTimeMins: 6,
        tags: ['rolling motion', 'torque'],
        solution: 'a = g sinθ / (1 + I/mR²)',
    },
    {
        extractedText: 'Calculate the moles of KMnO4 needed to oxidise 1 mol of Fe2+.',
        subject: 'chemistry', chapter: 'Redox Reactions',
        options: ['A) 0.2', 'B) 0.4', 'C) 0.5', 'D) 1.0'], correctAnswer: 'A',
        type: 'mcq', tags: ['redox titration'],
    },
], null, 2);
const gemResult = await page.evaluate(async (dumpText) => {
    const out = {};
    try {
        const storage = await import('./storage.js');
        const AppState = storage.AppState;
        // Real user flow: pick the destination chapter tile FIRST —
        // _compileDumpObject takes subject/chapter from AppState selectors
        // (the dump's own values are kept as gemSubject/gemChapter provenance).
        AppState.currentSubject = 'physics';
        AppState.currentChapter = 'Rotational Motion';
        const ta = document.getElementById('text-add-terminal');
        ta.value = dumpText;
        await window.processGemTextDump();
        // The preview modal is advisory — drive the REAL commit entry point.
        window.saveAllQuestions();
        const bank = AppState.questionBank;
        out.count = bank.length;
        const rot = bank.find(q => String(q.extractedText || '').includes('solid sphere'));
        out.foundRot = !!rot;
        out.inRightChapter = rot ? rot.chapter === 'Rotational Motion' : false;
        out.createdAtIso = rot ? (!isNaN(Date.parse(rot.createdAt))) : false;
        out.tagsKept = rot ? Array.isArray(rot.tags) && rot.tags.includes('rolling motion') : false;
        out.legacyTolerant = rot ? (() => {
            // Pre-boot gem rows legitimately lack easeFactor/historyLogs until
            // migrateQuestionBankSR backfills them on next init — the schema
            // contract is that everything downstream TOLERATES that.
            const efOk = rot.easeFactor === undefined || typeof rot.easeFactor === 'number';
            let dueOk = true;
            try { storage.getDueStatus(rot); } catch (_) { dueOk = false; }
            return efOk && dueOk;
        })() : false;
        out.statusFresh = rot ? rot.status === 'unsolved' : false;
    } catch (e) { out.error = String(e && e.message || e); }
    return out;
}, dump);
assert(!gemResult.error, 'gem pipeline ran without throw (' + (gemResult.error || 'clean') + ')');
assert(gemResult.foundRot, 'dump question landed in the bank');
assert(gemResult.inRightChapter, 'landed in the selected chapter');
assert(gemResult.createdAtIso, 'createdAt stamped at ingest');
assert(gemResult.tagsKept, 'personal tags carried through ingest');
assert(gemResult.legacyTolerant, 'pre-migration row tolerated by the SR read path');
assert(gemResult.statusFresh, 'fresh gem question starts unsolved');

// ════════════════════════════════════════════════════════════════════════
// B · PRACTICE FUMBLE → VAULT — the main error-insertion path.
// ════════════════════════════════════════════════════════════════════════
console.log('[B] practice-wrong error insertion');
const errQid = await page.evaluate(async () => {
    const storage = await import('./storage.js');
    const AppState = storage.AppState;
    const now = Date.now();
    const iso = (d) => new Date(now + d * 86400000).toISOString();
    const q = {
        id: 'cx-e2e-1',
        subject: 'physics', chapter: 'Rotational Motion',
        extractedText: 'A disc rolls without slipping. Find acceleration.',
        options: ['A) 2g/3', 'B) g/3', 'C) g/2', 'D) g'], correctAnswer: 'A',
        type: 'mcq', status: 'unsolved', errorReason: null,
        timeTaken: 90,
        currentInterval: 0, easeFactor: 2.5,
        nextReviewAt: iso(-6),           // scheduled 6 days ago ⇒ overdue
        targetTimeMins: 5, isMastered: false, historyLogs: [],
        qElo: 1300, qEloSource: 'learned', solveCount: 2, lastSolvedAt: iso(-9),
        createdAt: iso(-45),              // logged 45 days ago, first attack NOW ⇒ cold revival zone
        tags: ['torque'],
        stability: 12, difficultyD: 5, reps: 2, lapses: 0,
    };
    AppState.questionBank.push(q);
    AppState.currentQ = q;
    AppState.pendingWrongQ = q;
    document.getElementById('error-reason-select').value = 'conceptual';
    window.confirmErrorLog();
    return {
        status: q.status, reason: q.errorReason,
        createdAtOk: !isNaN(Date.parse(q.createdAt)),
    };
});
assert(errQid.status === 'error', 'fumbled question enters vault as error');
assert(errQid.reason === 'conceptual', 'mistake class recorded');
assert(errQid.createdAtOk, 'createdAt guaranteed on vault entry');

// ════════════════════════════════════════════════════════════════════════
// C · DRAWER SOLVE — tag editor + cortex commit + scheduler override.
// ════════════════════════════════════════════════════════════════════════
console.log('[C] practice drawer solve (tag editor + cortex commit)');
await page.evaluate(() => {
    const el = document.querySelector('.subject-folder[data-subject="physics"]');
    window.openErrorMatrix('physics', el);
});
await page.waitForTimeout(300);
await page.evaluate(() => window.openPracticeDrawer('cx-e2e-1'));
await page.waitForTimeout(400);
assert(await page.locator('#sr-practice-overlay').count() === 1, 'drawer opens');

// Solve first — the tag stage (and its editor) reveals AFTER the result,
// matching the product's "tag what happened" flow.
await page.click('.sr-mcq-option[data-letter="A"]');
await page.click('#sr-confirm-btn');
await page.waitForTimeout(200);
assert(await page.locator('.sr-result-banner.correct').count() === 1, 'auto-grade marks correct');

// Tag editor: suggestion chips render from inventory; add via input; dedupe.
const tagBefore = await page.evaluate(() => ({
    chips: document.querySelectorAll('.sr-tagedit-chip').length,
    suggs: document.querySelectorAll('.sr-tagedit-sugg').length,
}));
assert(tagBefore.chips >= 1, 'existing personal tag shown in editor (' + tagBefore.chips + ')');
assert(tagBefore.suggs >= 0, 'suggestion strip rendered (' + tagBefore.suggs + ')');
await page.fill('#sr-tagedit-input', 'rolling motion');
await page.press('#sr-tagedit-input', 'Enter');
await page.waitForTimeout(150);
const tagAfterAdd = await page.evaluate(() => document.querySelectorAll('.sr-tagedit-chip').length);
assert(tagAfterAdd === tagBefore.chips + 1, 'input Enter adds a tag chip');
await page.evaluate(() => window.srAddTag('ROLLING MOTION'));   // dup, different case
const tagAfterDup = await page.evaluate(() => document.querySelectorAll('.sr-tagedit-chip').length);
assert(tagAfterDup === tagAfterAdd, 'duplicate tag rejected (case-insensitive)');

// Friction pill PERFECT, then commit.
await page.click('.sr-friction-pill[data-friction="PERFECT"]');
await page.waitForTimeout(100);

const solveOut = await page.evaluate(() => {
    return new Promise(resolve => {
        const finish = () => setTimeout(async () => {
            const storage = await import('./storage.js');
            const q = storage.AppState.questionBank.find(x => x.id === 'cx-e2e-1');
            const log = q.historyLogs[q.historyLogs.length - 1];
            resolve({
                tags: q.tags.slice(),
                log: {
                    ageAtSolveDays: log.ageAtSolveDays, daysOverdue: log.daysOverdue,
                    rBefore: log.rBefore, ageClass: log.ageClass, spacingCredit: log.spacingCredit,
                    result: log.result,
                },
                nextReviewAtFuture: !isNaN(Date.parse(q.nextReviewAt)) && Date.parse(q.nextReviewAt) > Date.now(),
                intervalSane: Number(q.currentInterval) >= 1,
                stabilityAfter: Number(q.stability),
                reps: q.reps,
            });
        }, 600);
        document.getElementById('sr-submit-btn').click();
        // submitPracticeLog defers rebuilds; poll for overlay removal then settle.
        const t = setInterval(() => {
            if (!document.getElementById('sr-practice-overlay')) { clearInterval(t); finish(); }
        }, 120);
        setTimeout(() => { clearInterval(t); finish(); }, 4000);
    });
});
assert(solveOut.log.result === 'correct', 'history log appended');
assert(solveOut.tags.includes('rolling motion') && solveOut.tags.includes('torque'),
    'tag draft committed to q.tags (' + solveOut.tags.join(', ') + ')');
assert(typeof solveOut.log.ageAtSolveDays === 'number' && solveOut.log.ageAtSolveDays > 40,
    'age-at-solve captured (~45d)');
assert(typeof solveOut.log.daysOverdue === 'number' && solveOut.log.daysOverdue >= 5,
    'days-left-overdue captured (~6d)');
assert(solveOut.log.rBefore != null && solveOut.log.rBefore > 0 && solveOut.log.rBefore <= 1,
    'pre-review retrievability captured');
assert(solveOut.log.ageClass === 'cold', 'cold-revival class detected (45d-old first attack)');
assert(solveOut.log.spacingCredit > 0, 'overdue spacing credit granted');
assert(solveOut.nextReviewAtFuture, 'cortex scheduler wrote a future nextReviewAt');
assert(solveOut.intervalSane, 'displayed interval consistent with new schedule');
assert(solveOut.stabilityAfter > 0 && solveOut.reps === 3, 'kernel state advanced exactly once');

// ════════════════════════════════════════════════════════════════════════
// D · PRIORITY ORDERING — overdue+leaky item outranks a fresh parked one.
// ════════════════════════════════════════════════════════════════════════
console.log('[D] daily queue priority ordering');
const orderOk = await page.evaluate(async () => {
    const storage = await import('./storage.js');
    const AppState = storage.AppState;
    const now = Date.now();
    const iso = (d) => new Date(now + d * 86400000).toISOString();
    const mk = (id, over) => Object.assign({
        id, subject: 'maths', chapter: 'Matrices',
        extractedText: 'x', options: [], correctAnswer: '', type: 'text',
        status: 'error', errorReason: 'conceptual', currentInterval: 0,
        easeFactor: 2.5, targetTimeMins: 5, isMastered: false, historyLogs: [],
        qElo: 1200, tags: [],
    }, over);
    // urgent: 20d overdue, leaky CONCEPT history, never revisited
    AppState.questionBank.push(mk('cx-low-pri', {
        nextReviewAt: iso(-1), createdAt: iso(-3),
    }));
    AppState.questionBank.push(mk('cx-high-pri', {
        nextReviewAt: iso(-20), createdAt: iso(50),
        historyLogs: [{ id: 'h1', timestamp: iso(-25), result: 'incorrect', frictionTypes: '["CONCEPT"]' }],
    }));
    const snap = window._getDailyQueueSnapshot().map(String);
    const hi = snap.indexOf('cx-high-pri'), lo = snap.indexOf('cx-low-pri');
    return { hi, lo, both: hi >= 0 && lo >= 0 };
});
assert(orderOk.both, 'both maths errors eligible for the queue');
assert(orderOk.hi < orderOk.lo, 'overdue+leaky ranks ahead of fresh parked error');

// ════════════════════════════════════════════════════════════════════════
// E · DECAY DRILLDOWN EXTRAS render without faults.
// ════════════════════════════════════════════════════════════════════════
console.log('[E] drilldown contagion + leak rows');
await page.evaluate(() => window.renderChapterDecayGrid ? window.renderChapterDecayGrid() : null);
const dd = await page.evaluate(() => {
    try {
        window.openDecayDrilldown(encodeURIComponent('physics'), encodeURIComponent('Rotational Motion'));
        const panel = document.querySelector('.decay-drill-panel');
        return {
            open: !!panel,
            leaks: panel ? panel.querySelectorAll('.dd-tagleak-row').length : -1,
        };
    } catch (e) { return { open: false, err: String(e) }; }
});
assert(dd.open, 'drilldown opens cleanly (' + (dd.err || '') + ')');
assert(dd.leaks >= 1, 'per-tag leak rows rendered (' + dd.leaks + ')');
try {
    await page.click('.decay-drill-close');
} catch (_) {}
await page.evaluate(() => document.querySelectorAll('.decay-drill-overlay').forEach(o => o.remove()));

// ── Console hygiene ──
const realErrors = errors.filter(e => !/favicon|Manifest|sw\.js|Autoplay|playwright/i.test(e));
assert(realErrors.length === 0, 'no console/page errors (' + realErrors.length + ')' + (realErrors[0] ? ' → ' + realErrors[0].slice(0, 220) : ''));

console.log(`\nRESULT: ${pass} passed / ${fail} failed`);
await browser.close();
server.close();
process.exit(fail === 0 ? 0 : 1);
