// Visual + functional QA for the redesigned Focus Engine (pomodoro).
// Covers: ambient sprint widget (idle/popover/study/break), the real ×1.5
// deep-work wiring (body.pomo-active), quit friction (chain-break confirm +
// Keep Going), the per-day focus ledger, and the session receipt.
// Uses Playwright's fake clock to fast-forward through real 1-minute blocks.
//
// Run: node scripts/qa-focus-mode.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8795;
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = 'C:/Users/Chaksh/AppData/Local/Temp/dsh-shots/focus-mode';
fs.mkdirSync(SHOTS, { recursive: true });

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
});
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

let pass = 0, fail = 0;
const assert = (cond, name) => {
    if (cond) { pass++; console.log('  ok', name); }
    else { fail++; console.error('  FAIL', name); }
};

await page.clock.install();
await page.goto(BASE, { waitUntil: 'networkidle' });
for (let i = 0; i < 6; i++) {
    const overlay = page.locator('.bootseq');
    if (!(await overlay.count())) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
}
assert(!(await page.locator('.bootseq').count()), 'boot briefing dismissed');
await page.waitForTimeout(600);

// ── 1 · Idle widget ──────────────────────────────────────────────────────
const widget = page.locator('#pomo-mini-widget');
assert(await widget.isVisible(), 'idle widget visible on dashboard');
assert(await widget.evaluate(el => el.getAttribute('data-state')) === 'idle', 'widget data-state=idle');
const wbox = await widget.boundingBox();
assert(wbox && wbox.y > 500, `widget docked bottom-right (y=${Math.round(wbox?.y || 0)})`);
// v4: floating capsule = full pill (design-system radius token)
assert(['999px', '9999px', '32767px'].includes(await widget.evaluate(el => getComputedStyle(el).borderRadius)), 'new widget skin applied');
assert(!(await widget.evaluate(el => el.classList.contains('hidden'))), 'idle pill NOT hidden (entry point always live)');
await page.screenshot({ path: path.join(SHOTS, '01-idle-dashboard.png') });

// ── 2 · Popover config ───────────────────────────────────────────────────
await widget.locator('.mini-content').click();
assert(await page.locator('#pomo-pop.open').isVisible(), 'popover opens from pill tap');
for (let i = 0; i < 4; i++) await page.locator('.pop-step').nth(0).click();   // minutes −5 ×4 (seeded from form: 50 → 30)
await page.locator('.pop-step').nth(3).click();                                // rounds +1 (1 → 2)
await page.locator('.pop-sub[data-subject="chemistry"]').click();
await page.waitForTimeout(150);
assert((await page.locator('#pop-minutes').textContent()).trim() === '30', 'minutes stepped 50 → 30');
assert((await page.locator('#pop-rounds').textContent()).trim() === '2', 'rounds stepped to 2');
assert(await page.locator('.pop-sub[data-subject="chemistry"]').evaluate(el => el.classList.contains('active')), 'subject seg synced');
assert(((await page.locator('#pomo-study').inputValue()) === '30'), 'minutes write-through to form');
await page.screenshot({ path: path.join(SHOTS, '02-popover.png') });

// ── 3 · Start sprint → study state + REAL ×1.5 wiring ────────────────────
await page.locator('.pop-start').click();
await page.waitForTimeout(400);
assert(await widget.getAttribute('data-state') === 'study', 'widget flips to study state');
assert(await page.evaluate(() => document.body.classList.contains('pomo-active')), 'body.pomo-active SET (×1.5 deep-work bonus live)');
assert(await page.evaluate(() => window._pomoRunning === true), 'window._pomoRunning=true');
assert(await page.locator('#mini-x2').isVisible(), '×1.5 badge shown while studying');
const projText = await page.locator('#pomo-projection').textContent();
assert(projText.includes('committed') && projText.includes('×1.5'), `projection states the contract (${projText.slice(0, 40)}…)`);
const arcBase = await page.locator('#mini-ring-arc').evaluate(el => parseFloat(el.style.strokeDashoffset));
await page.clock.runFor(2500);   // fake clock: drive the 1s tick interval
const arcOffset = await page.locator('#mini-ring-arc').evaluate(el => parseFloat(el.style.strokeDashoffset));
// 30-min block: 2.5s of progress is small but strictly non-zero
assert(arcOffset < arcBase - 0.05, `ring arc tracks progress (${arcBase.toFixed(2)} → ${arcOffset.toFixed(2)})`);
await page.screenshot({ path: path.join(SHOTS, '03-study-running.png') });

// ── 4 · Pause closes the bonus window, resume reopens it ────────────────
await page.locator('#mini-pause').click();
await page.waitForTimeout(200);
assert(!(await page.evaluate(() => document.body.classList.contains('pomo-active'))), 'pause clears pomo-active (no lying badge)');
await page.locator('#mini-pause').click();
await page.waitForTimeout(200);
assert(await page.evaluate(() => document.body.classList.contains('pomo-active')), 'resume restores pomo-active');

// ── 5 · Quit friction: chain-break confirm + Keep Going ──────────────────
await page.locator('#mini-stop').click();
await page.waitForTimeout(300);
assert(await page.locator('#timer-notify-modal.active').isVisible(), 'quit opens confirm modal');
assert((await page.locator('#notify-title').textContent()) === 'Break the chain?', 'confirm names the price');
assert(await page.locator('#notify-receipt').isVisible(), 'receipt shows kept/lost rows');
await page.screenshot({ path: path.join(SHOTS, '04-quit-confirm.png') });
await page.locator('#notify-secondary').click();
await page.waitForTimeout(300);
assert(!(await page.locator('#timer-notify-modal.active').isVisible()), 'Keep Going dismisses modal');
assert(await page.evaluate(() => document.body.classList.contains('pomo-active')), 'Keep Going resumes the block');

// ── 6 · Real quit → forfeit logged, chain reset, widget back to idle ─────
await page.locator('#mini-stop').click();
await page.waitForTimeout(200);
await page.locator('#timer-notify-modal.active .btn-primary').click();   // confirm forfeit
await page.waitForTimeout(1400);                                          // deferred resetPomoUI
let ledger = await page.evaluate(() => JSON.parse(localStorage.getItem('jeemax_focus_ledger') || 'null'));
assert(ledger && ledger.forfeit === 1 && ledger.chain === 0, `forfeit logged, chain reset (${JSON.stringify(ledger)})`);
assert(ledger.deep >= 1, `abandoned seconds still credited (deep=${ledger.deep})`);
assert(await widget.getAttribute('data-state') === 'idle', 'widget returns to idle pill');
assert(!(await page.evaluate(() => document.body.classList.contains('pomo-active'))), 'pomo-active cleared after forfeit');

// ── 7 · Completion path: 1-min block runs to planned end ────────────────
await page.locator('[data-tab="pomodoro"]').click();
await page.waitForTimeout(500);
assert(await page.locator('#focus-ledger').isVisible(), 'focus ledger strip visible in Focus view');
assert((await page.locator('#fs-forfeit').textContent()).trim() === '1', 'ledger strip shows the forfeit');
await page.locator('#pomo-study').fill('1');
await page.locator('#pomo-break').fill('1');
await page.locator('#pomo-sessions').fill('1');
await page.locator('#btn-start').click();
await page.waitForTimeout(400);
assert(await widget.getAttribute('data-state') === 'study', 'form start also drives widget');
await page.clock.runFor(62000);
await page.waitForTimeout(500);
assert(await page.locator('#timer-notify-modal.active').isVisible(), 'block completion opens receipt modal');
const receiptText = await page.locator('#notify-receipt').textContent();
assert(receiptText.includes('Chain') && receiptText.includes('Deep today'), 'receipt carries payout rows');
await page.screenshot({ path: path.join(SHOTS, '05-completion-receipt.png') });
await page.locator('#timer-notify-modal.active .btn-primary').click();
await page.waitForTimeout(600);
ledger = await page.evaluate(() => JSON.parse(localStorage.getItem('jeemax_focus_ledger')));
assert(ledger.done === 1 && ledger.chain === 1 && ledger.best === 1, `completion logged: done=1 chain=1 (${JSON.stringify(ledger)})`);
assert(ledger.deep >= 61, `deep total counts both blocks (${ledger.deep}s)`);

// Break auto-starts after confirming (sessions=1 → finishAll actually resets)
assert(await widget.getAttribute('data-state') === 'idle', 'cycle finished → idle pill restored');
const pips = await page.locator('#chain-pips .chain-pip.lit').count();
assert(pips >= 1, `chain pip lit in Focus view (${pips})`);

// ── 8 · Idle pill one-tap start uses suggested length ────────────────────
await page.locator('#mini-go').click();
await page.waitForTimeout(300);
assert(await widget.getAttribute('data-state') === 'study', 'one-tap ▶ starts sprint directly');
const display = await page.locator('#timer-display').textContent();
assert(/^\d{2}:\d{2}$/.test(display.trim()), `big timer live (${display})`);
await page.locator('#mini-stop').click();
await page.waitForTimeout(200);
await page.locator('#timer-notify-modal.active .btn-primary').click();
await page.waitForTimeout(1300);

console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.slice(0, 10).join('\n'));
else console.log('no console/page errors');

await browser.close();
server.close();
process.exit(fail || errors.length ? 1 : 0);
