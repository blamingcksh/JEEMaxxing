// qa-mock-v2.mjs — end-to-end guard for Mock Mode v2.
//
// Paper A (auto-build): seeded bank of exactly 6 questions (4 physics + 2
// maths) so the sampler takes all of them. Guards key prefill (clean dumps
// prefill, prose "answers" and keyless questions do NOT), bulk key paste,
// finalize.
//
// Paper B (create + bank picker): 3 questions with hand-picked answers, keys
// prefilled. Runner: answer by reading each stem (order is shuffled), exit,
// resume, submit. Guards paper-key scoring (sections.keys wins over the
// bank's correctAnswer), palette legend, exit/resume, results replacing the
// runner (no stacked overlays), per-question review with correct-option
// highlight, one-tap Vault logging through the real error-reason modal, and
// key-edit-on-done-paper scorecard staleness.
//
// Run: node scripts/qa-mock-v2.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8846;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json' };
const server = await new Promise(r => { const s = http.createServer((q, res) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html'; fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); }); s.listen(PORT, '127.0.0.1', () => r(s)); });
let browser; try { browser = await chromium.launch({ channel: 'msedge', headless: true }); } catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() => { try { localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA')); } catch {} });
// Neutralize the NightGuard overlay (time-of-day tiered, needs a 3s hold to
// override) so QA runs are deterministic at any wall-clock hour.
page.addInitScript(() => {
    const arm = () => {
        const m = document.getElementById('nightguard-modal');
        if (m && !m.dataset.qaArm) {
            m.dataset.qaArm = '1';
            new MutationObserver(() => {
                if (m.classList.contains('active')) {
                    m.classList.remove('active');
                    document.body.classList.remove('nightguard-tint');
                }
            }).observe(m, { attributes: true, attributeFilter: ['class'] });
        }
    };
    const t = setInterval(arm, 100);
    setTimeout(() => clearInterval(t), 30000);
});
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

let pass = 0, fail = 0;
const assert = (cond, name) => {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { console.error('  FAIL ' + name); fail++; }
};

const SEED = [
    { subject: 'physics', chapter: 'Kinematics', type: 'mcq', options: ['10 m/s', '20 m/s', '30 m/s', '40 m/s'], correctAnswer: 'B', extractedText: 'A ball is thrown at 20 m/s. Find speed.', status: 'unsolved', qElo: 1200, targetTimeMins: 3 },
    { subject: 'physics', chapter: 'Kinematics', type: 'mcq', options: ['v/2', 'v', '2v', '4v'], correctAnswer: 'BANK-TEXT-JUNK-PROSE', extractedText: 'Prose answer trap question about velocity doubling.', status: 'unsolved', qElo: 1300, targetTimeMins: 4 },
    { subject: 'physics', chapter: 'Optics', type: 'mcq', options: ['a', 'b', 'c', 'd'], correctAnswer: null, extractedText: 'Keyless question — answer unknown until key pass.', status: 'unsolved', qElo: 1200, targetTimeMins: 3 },
    { subject: 'physics', chapter: 'Optics', type: 'mcq', options: ['red', 'violet', 'green', 'yellow'], correctAnswer: 'B', extractedText: 'Which light bends most through a prism?', status: 'unsolved', qElo: 1250, targetTimeMins: 3 },
    { subject: 'maths', chapter: 'Calculus', type: 'numeric', options: [], correctAnswer: '42', extractedText: 'Evaluate the limit; answer is an integer.', status: 'unsolved', qElo: 1400, targetTimeMins: 5 },
    { subject: 'maths', chapter: 'Calculus', type: 'numeric', options: [], correctAnswer: '7.5', extractedText: 'Compute the definite integral value.', status: 'unsolved', qElo: 1350, targetTimeMins: 4 },
].map((q, i) => ({
    id: 'qa-mock-q' + i, subject: q.subject, chapter: q.chapter, type: q.type,
    options: q.options, correctAnswer: q.correctAnswer, extractedText: q.extractedText,
    status: q.status, qElo: q.qElo, targetTimeMins: q.targetTimeMins,
    solveCount: 0, createdAt: new Date().toISOString(), tags: [], historyLogs: [],
}));

async function dismissBoot() {
    for (let i = 0; i < 6; i++) { if (!(await page.locator('.bootseq').count())) break; await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(250); }
    await page.waitForTimeout(500);
}

await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'networkidle' });
await dismissBoot();

// Seed the bank through the app's own persistence layer, then reload so
// loadDataAsync rehydrates it.
await page.evaluate(async (bank) => {
    const { idbSet } = await import('./storage.js');
    await idbSet('jeemax_question_bank', bank);
}, SEED);
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'networkidle' });
await dismissBoot();
await page.evaluate(() => { window.switchTab('mocks', document.querySelector('[data-tab="mocks"]')); });
await page.waitForTimeout(400);

// ── Pure-core spot checks (paper key wins over bank answer) ──
const pure = await page.evaluate(() => {
    const E = window.MockEngine;
    if (!E) return null;
    const qJunk = { type: 'mcq', options: ['a','b','c','d'], correctAnswer: 'BANK-TEXT-JUNK-PROSE' };
    return {
        overrideWins: E.gradeAnswer(qJunk, 'A', ['A']).marks === 4,
        noKeyProseNotMagic: !E.gradeAnswer(qJunk, 'C').correct,
    };
});
assert(pure && pure.overrideWins, 'gradeAnswer: paper keyOverride beats bank answer (+4)');
assert(pure && pure.noKeyProseNotMagic, 'gradeAnswer: prose bank answer does not bless unrelated choices');

// ── Paper A: auto-build takes the whole bank ──
assert(await page.locator('#mock-studio-root .mk-head').count() === 1, 'studio home renders in Mocks tab');
await page.click('button:has-text("Auto-build from bank")');
await page.waitForTimeout(200);
await page.fill('#mk-auto-physics', '4');
await page.fill('#mk-auto-maths', '2');
assert(await page.locator('.mk-auto-mix .pomo-select').count() === 1, 'difficulty mix selector present in auto-build');
await page.click('button:has-text("Draft paper")');
await page.waitForTimeout(400);
assert(await page.locator('.mk-key-table').count() === 1, 'auto-build lands on the answer-key pass');
assert(await page.locator('.mk-key-table tbody tr').count() === 6, 'auto-build drafted all 6 questions');
// Difficulty mix (default JEE Main 35/45/20): seed has 3 easy + 3 medium, no
// hard. The hard quota must degrade into its neighbours and still fill to 6.
const mixSpread = await page.evaluate(async () => {
    const { AppState } = await import('./storage.js');
    const m = AppState.mocks.find(x => x.name && x.name.startsWith('Auto paper'));
    if (!m) return null;
    const bank = new Map(AppState.questionBank.map(q => [q.id, q]));
    const tierOf = e => (e >= 1700 ? 'hard' : (e >= 1300 ? 'medium' : 'easy'));
    const spread = { easy: 0, medium: 0, hard: 0 };
    for (const s of ['physics', 'chemistry', 'maths']) {
        for (const id of m.sections[s].questionIds) {
            const q = bank.get(id);
            if (q) spread[tierOf(q.qElo)]++;
        }
    }
    return spread;
});
assert(mixSpread && mixSpread.easy === 3 && mixSpread.medium === 3 && mixSpread.hard === 0,
    'mix allotment degrades gracefully (3 easy / 3 medium / 0 hard, pool had no hard questions)');
const marks = await page.locator('.mk-key-table tbody td:nth-child(5)').allInnerTexts();
assert(marks.filter(t => t.includes('✅')).length === 4, 'exactly 4 keys prefilled from clean dumps');
assert(marks.filter(t => t.includes('⬜')).length === 2, 'prose + keyless questions NOT prefilled');

// ── Bulk key paste: row numbering across subjects ──
await page.fill('#mk-bulk', '1 B\n2 B\n3 D\n4 C\n5 42\n6 7.5');
await page.click('button:has-text("Apply keys")');
await page.waitForTimeout(300);
const marks2 = await page.locator('.mk-key-table tbody td:nth-child(5)').allInnerTexts();
assert(marks2.every(t => t.includes('✅')), 'bulk paste sets every key (incl. keyless + prose rows)');
await page.click('button:has-text("Finalize paper")');
await page.waitForTimeout(300);
assert(await page.locator('.mk-card', { hasText: 'Auto paper' }).count() === 1, 'finalized paper shows on home as Ready');

// ── Context-leak guard: dump-link context must clear when leaving Mocks ──
const ctxLeak = await page.evaluate(async () => {
    const { AppState } = await import('./storage.js');
    AppState.mockDraftContext = { mockId: AppState.mocks[AppState.mocks.length - 1].id, subject: 'physics' };
    window.switchTab('dashboard', document.querySelector('[data-tab="dashboard"]'));
    await new Promise(r => setTimeout(r, 300));
    return AppState.mockDraftContext === null;
});
assert(ctxLeak, 'mockDraftContext cleared automatically when Mocks view deactivates');

// ── Paper C: "Link AI dumps" flow — the REAL dump terminal + prompt + ingest ──
await page.evaluate(() => { window.switchTab('mocks', document.querySelector('[data-tab="mocks"]')); });
await page.waitForTimeout(300);
await page.fill('#mk-name', 'QA Paper C');
await page.click('button:has-text("+ New Mock")');
await page.waitForTimeout(300);
await page.click('.mk-subj-panel:has-text("Physics") button:has-text("Link AI dumps")');
await page.waitForTimeout(500);
assert(await page.locator('#upload-modal.active').count() === 1, 'Link AI dumps opens the Feed Questions modal (not the report modal)');
assert(await page.locator('#ingestion-panel-texttrack.active').count() === 1, 'Feed Questions opens on the Gem Text Track');
assert(await page.locator('#mk-link-banner:visible').count() === 1, 'mock-link banner visible in the upload modal');
const bannerTxt = await page.locator('#mk-link-banner').innerText();
assert(bannerTxt.includes('QA Paper C') && bannerTxt.includes('PHYSICS'), 'banner names the paper and panel ("' + bannerTxt.replace(/\n/g, ' ').slice(0, 60) + '…")');
assert((await page.locator('#gem-dump-prompt-text').textContent()).includes('CRITICAL JSON ESCAPING'), 'Gem dump prompt renders in the text-track panel');
assert(await page.evaluate(() => typeof window.copyGemDumpPrompt === 'function'), 'copyGemDumpPrompt exists');

// Real dump through the terminal: 2 physics (one with "B)"-prefixed options,
// one numeric) + 1 dump-declared chemistry question. Only physics may link.
await page.fill('#text-add-terminal', JSON.stringify([
    { extractedText: 'QA dump mcq stem', options: ['B) 20 m/s', 'A) 10 m/s', 'C) 30 m/s', 'D) 40 m/s'], correctAnswer: 'B', type: 'mcq', solution: '$\\\\frac{1}{2}mv^2$ reasoning' },
    { extractedText: 'QA dump numeric stem', correctAnswer: '42', type: 'numeric' },
    { extractedText: 'QA dump chem stem', options: ['x', 'y', 'z', 'w'], correctAnswer: 'A', type: 'mcq', subject: 'chemistry' },
]));
await page.click('#ingestion-panel-texttrack button:has-text("Execute Ingestion Track")');
await page.waitForTimeout(800);
assert(await page.locator('#preview-modal.active').count() === 1, 'dump parses into the preview modal');
await page.click('#preview-modal button:has-text("Import All Questions")');
await page.waitForTimeout(800);
// saveAllQuestions auto-navigates to the practice view — go back to Mocks.
await page.evaluate(() => { window.switchTab('mocks', document.querySelector('[data-tab="mocks"]')); });
await page.waitForTimeout(500);
assert(await page.locator('.mk-subj-panel:has-text("Physics") .mk-qrow').count() === 2, 'only the 2 physics dump questions linked into the panel');
const routed = await page.evaluate(async () => {
    const { AppState } = await import('./storage.js');
    const chem = AppState.questionBank.find(q => q.extractedText === 'QA dump chem stem');
    const mcq = AppState.questionBank.find(q => q.extractedText === 'QA dump mcq stem');
    const num = AppState.questionBank.find(q => q.extractedText === 'QA dump numeric stem');
    return {
        chemGemSubject: chem && chem.gemSubject,
        chemLinked: !!(chem && chem.reservedForMock),
        opt0: mcq && mcq.options && mcq.options[0],
        numInMock: num && num.reservedForMock,
        ctx: !!AppState.mockDraftContext,
    };
});
assert(routed.chemGemSubject === 'chemistry', 'chem dump question keeps gemSubject=chemistry provenance (got ' + routed.chemGemSubject + ')');
assert(!routed.chemLinked, 'chem dump question NOT linked into the physics panel');
assert(routed.opt0 === '20 m/s', 'option "B) 20 m/s" letter prefix stripped at ingest (got "' + routed.opt0 + '")');
assert(routed.numInMock, 'numeric dump question linked (reserved) with prefilled key');
// Stop linking from the banner (panel is active, so reopen the upload modal).
assert(await page.locator('.mk-subj-panel:has-text("Physics") button:has-text("Stop linking")').count() === 1, 'active panel shows Stop-linking state');
const builderAlive = await page.locator('.mk-subj-panel:has-text("Physics")').count();
if (!builderAlive) console.error('  DEBUG builder missing, page errors: ' + errs.join(' | '));
assert(builderAlive === 1, 'builder renders after returning to Mocks');
await page.click('.mk-subj-panel:has-text("Physics") button:has-text("Stop linking")');
await page.waitForTimeout(300);
await page.click('.mk-subj-panel:has-text("Physics") button:has-text("Link AI dumps")');
await page.waitForTimeout(400);
assert(await page.locator('#mk-link-banner:visible').count() === 1, 'banner returns when linking re-opens');
await page.click('#mk-link-banner button:has-text("Stop")');
await page.waitForTimeout(300);
const ctxCleared = await page.evaluate(async () => {
    const { AppState } = await import('./storage.js');
    return AppState.mockDraftContext === null;
});
assert(ctxCleared, 'banner Stop clears the dump-link context');
assert(await page.locator('#mk-link-banner').count() === 0, 'banner removed from the upload modal after Stop');
await page.click('#upload-modal .close-btn');
await page.waitForTimeout(300);
await page.evaluate(() => { window.switchTab('mocks', document.querySelector('[data-tab="mocks"]')); });
await page.waitForTimeout(300);
await page.click('button:has-text("← Papers")');
await page.waitForTimeout(300);

// ── Weak points & analysis: chapter scope picker + mistake engine + targeted build ──
await page.evaluate(async () => {
    const { AppState, saveAllAsync } = await import('./storage.js');
    const q = AppState.questionBank.find(x => x.extractedText && x.extractedText.includes('Keyless question'));
    if (q) { q.status = 'error'; q.errorReason = 'conceptual'; }
    AppState.mockFocus = { 'optics::single': 3, 'kinematics::numeric': 1 };
    await saveAllAsync();
});
await page.waitForTimeout(400);
await page.click('button:has-text("Weak points & analysis")');
await page.waitForTimeout(600);
const lossTxt = await page.locator('.mk-losslist').innerText();
assert(/optics/i.test(lossTxt) && /kinematics/i.test(lossTxt), 'mock loss map renders chapter × pattern losses');
assert(await page.locator('#mk-wp-mount .wp-chapters input:checked').count() >= 1, 'weak chapter (Optics, 1 err) pre-ticked in the scope picker');
assert((await page.locator('#mk-wp-mount .wp-preview').innerHTML()).length > 100, 'mistake analysis renders for the scoped chapters');
await page.click('button:has-text("Build targeted paper")');
await page.waitForTimeout(500);
assert(await page.locator('.mk-key-table').count() === 1, 'targeted build lands on the key pass');
const drill = await page.evaluate(async () => {
    const { AppState } = await import('./storage.js');
    const m = AppState.mocks.find(x => x.name && x.name.includes('Weak-points drill'));
    if (!m) return null;
    const bank = new Map(AppState.questionBank.map(q => [q.id, q]));
    const chapters = new Set(m.physics ? [] : []);
    const subjChapters = {};
    for (const s of ['physics', 'chemistry', 'maths']) {
        subjChapters[s] = m.sections[s].questionIds.map(id => bank.get(id) && String(bank.get(id).chapter));
    }
    return subjChapters;
});
assert(drill && drill.physics.length === 2, 'targeted drill drafted the 2 Optics questions (got ' + (drill && drill.physics.length) + ')');
assert(drill && drill.physics.every(c => String(c).toLowerCase() === 'optics'), 'drill physics questions all come from the selected chapter');
assert(drill && drill.maths.length === 0 && drill.chemistry.length === 0, 'drill ignores unselected subjects');
// Clean the drill paper up (confirm() → auto-accept via dialog handler).
page.once('dialog', d => d.accept());
await page.evaluate(async () => {
    const mod = await import('./storage.js');
    const m = mod.AppState.mocks.find(x => x.name && x.name.includes('Weak-points drill'));
    if (m) { window.mockDelete(m.id); }
});
await page.waitForTimeout(300);

// ── Paper B: create + bank picker (deterministic questions & keys) ──
await page.evaluate(() => { window.switchTab('mocks', document.querySelector('[data-tab="mocks"]')); });
await page.waitForTimeout(300);
await page.fill('#mk-name', 'QA Paper B');
await page.click('button:has-text("+ New Mock")');
await page.waitForTimeout(300);
// physics panel: add ball (key B prefilled) + red light (key B prefilled)
await page.click('.mk-subj-panel:has-text("Physics") button:has-text("From bank")');
await page.waitForTimeout(300);
// Tier chips render with counts; filtering by a tier with no stock empties the list.
const hardChip = page.locator('#mk-pk-tiers .mk-pk-chip:has-text("🔴")');
assert(/· 0/.test(await hardChip.innerText()), 'Hard tier chip shows 0 available in seed bank');
await hardChip.click();
await page.waitForTimeout(200);
assert(await page.locator('#mk-pk-list .mk-pk-row').count() === 0, 'Hard tier filter empties the picker (no hard questions seeded)');
await page.click('#mk-pk-tiers .mk-pk-chip:has-text("All difficulties")');
await page.waitForTimeout(200);
assert(await page.locator('#mk-pk-list .mk-pk-row').count() > 0, 'All-difficulties restores the picker list');
await page.click('.mk-pk-row:has-text("A ball is thrown")');
await page.click('.mk-pk-row:has-text("bends most")');
assert(await page.locator('.mk-pk-count').innerText() === '2 selected', 'picker tracks selected rows');
await page.click('button:has-text("Add selected")');
await page.waitForTimeout(300);
// maths panel: add the limit numeric (key 42 prefilled)
await page.click('.mk-subj-panel:has-text("Maths") button:has-text("From bank")');
await page.waitForTimeout(300);
await page.click('.mk-pk-row:has-text("Evaluate the limit")');
await page.click('button:has-text("Add selected")');
await page.waitForTimeout(300);
assert(await page.locator('.mk-subj-panel:has-text("Physics") .mk-qrow').count() === 2, 'physics panel holds 2 picked questions');
assert(await page.locator('.mk-subj-panel:has-text("Maths") .mk-qrow').count() === 1, 'maths panel holds 1 picked question');
await page.click('button:has-text("Answer-key pass")');
await page.waitForTimeout(300);
await page.click('button:has-text("Finalize paper")');
await page.waitForTimeout(300);

// ── Run paper B ──
await page.click('.mk-card:has-text("QA Paper B") button:has-text("Start paper")');
await page.waitForTimeout(400);
assert(await page.locator('.mock-runner').count() === 1, 'runner opens full-screen');
const clockTxt = (await page.locator('#mr-clock').innerText()).trim();
assert(/^\d{1,2}:\d{2}(:\d{2})?$/.test(clockTxt), 'clock renders in MM:SS / H:MM:SS form ("' + clockTxt + '")');

// Answer by stem (runner order is shuffled): ball→B correct, bends→C wrong,
// limit→skipped. Keys are prefilled B / B / 42 ⇒ expected total 3/12.
for (let i = 0; i < 3; i++) {
    const stem = await page.locator('#mr-qarea .mr-text').first().innerText();
    if (stem.includes('ball is thrown')) await page.click('.mr-opt[data-letter="B"]');
    else if (stem.includes('bends most')) await page.click('.mr-opt[data-letter="C"]');
    else if (stem.includes('Evaluate the limit')) { /* skipped on purpose */ }
    await page.waitForTimeout(120);
    if (i < 2) await page.click('.mr-footer button:has-text("Next")');
    await page.waitForTimeout(120);
}
const legendTxt = (await page.locator('.mr-pal-legend').innerText()).replace(/\n/g, ' ');
assert(legendTxt.includes('2 answered'), 'palette legend counts answered questions (' + legendTxt + ')');

// Exit without submitting — clock keeps running.
await page.click('.mr-iconbtn[title*="Exit"]');
await page.waitForTimeout(300);
assert(!(await page.locator('.mock-runner').first().isVisible()), 'exit hides the runner (element stays parked, display:none)');
assert(await page.locator('.mk-card button:has-text("Resume")').count() === 1, 'studio shows Resume after exit');
await page.click('.mk-card button:has-text("Resume")');
await page.waitForTimeout(300);
await page.click('.mr-footer button:has-text("Submit paper")');
await page.waitForTimeout(200);
await page.click('.mr-confirm button:has-text("Confirm submit")');
await page.waitForTimeout(500);

// ── Scorecard + review ──
const totalTxt = (await page.locator('.mr-total').innerText()).replace(/\s+/g, ' ').trim();
assert(totalTxt.startsWith('3'), 'scorecard total is 3/12 under paper keys (got "' + totalTxt + '")');
assert(await page.locator('.mock-runner').count() === 1, 'results replace the runner (no stacked overlays)');
assert(await page.locator('.mr-rev-item').count() === 3, 'review lists all 3 paper questions');
assert(await page.locator('.mr-rev-item .mr-st.ok').count() === 1, 'review marks 1 correct');
assert(await page.locator('.mr-rev-item .mr-st.bad').count() === 1, 'review marks 1 wrong');
assert(await page.locator('.mr-rev-item .mr-st.skip').count() === 1, 'review marks 1 skipped');

// Expand the wrong row: correct option highlighted + Vault offer.
await page.locator('.mr-rev-item:has-text("bends most") .mr-rev-row').click();
await page.waitForTimeout(300);
const correctOpt = await page.locator('.mr-rev-item:has-text("bends most") .mr-rev-opt.correct').innerText();
assert(/^B/.test(correctOpt.trim()), 'expanded review highlights the correct option (B)');
assert(await page.locator('.mr-rev-item:has-text("bends most") .mr-vaultbtn').count() === 1, 'wrong answer offers Log to Vault');

// ── Vault logging through the real error-reason modal ──
await page.click('.mr-rev-item:has-text("bends most") .mr-vaultbtn');
await page.waitForTimeout(400);
assert(await page.locator('#error-reason-modal.active').count() === 1, 'Vault reason modal opens from review');
await page.selectOption('#error-reason-select', 'calculation');
await page.click('#error-reason-modal button:has-text("Send to the Vault")');
await page.waitForTimeout(600);
assert(await page.locator('.mr-invault').count() >= 1, 'review flips to "Already in the Vault" after logging');
const vaultQ = await page.evaluate(async () => {
    const { AppState } = await import('./storage.js');
    const q = AppState.questionBank.find(x => x.extractedText && x.extractedText.includes('bends most'));
    return q ? { status: q.status, reason: q.errorReason } : null;
});
assert(vaultQ && vaultQ.status === 'error' && vaultQ.reason === 'calculation',
    'logged question landed in the Vault with status=error + chosen reason (got ' + JSON.stringify(vaultQ) + ')');

// ── Edit keys on a done paper → scorecard goes stale and recomputes ──
await page.click('button:has-text("Back to Studio")');
await page.waitForTimeout(300);
await page.click('.mk-card:has-text("QA Paper B") button:has-text("Keys")');
await page.waitForTimeout(300);
await page.fill('.mk-key-table tbody tr:nth-child(1) .mk-key-in', 'C');
await page.click('.mk-key-table thead');
await page.waitForTimeout(200);
await page.click('button:has-text("← Builder")');
await page.waitForTimeout(200);
await page.click('button:has-text("← Papers")');
await page.waitForTimeout(200);
await page.click('.mk-card:has-text("QA Paper B") button:has-text("Scorecard")');
await page.waitForTimeout(500);
const total2 = (await page.locator('.mr-total').innerText()).replace(/\s+/g, ' ').trim();
assert(total2.startsWith('-2'), 'key edit on done paper recomputes scorecard (3→-2, got "' + total2 + '")');

if (errs.length) console.error('  page errors: ' + errs.slice(0, 5).join(' | '));
assert(errs.length === 0, 'no page errors during the whole flow');

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
