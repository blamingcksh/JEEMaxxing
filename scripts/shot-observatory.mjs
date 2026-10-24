// shot-observatory.mjs — Phase-1 gate screenshots for the observatory reskin.
// Dev tool, not part of the app.
//
// The app's headless main thread stalls ~3 s after domcontentloaded (a
// pre-existing app.js condition, documented in the redesign plan — NOT an
// observatory regression). This harness therefore does everything early:
// interactions at ~600 ms, the structural report at ~2.1 s, and the CDP
// screenshot at ~2.4 s — all inside the responsive window. Every evaluate
// is raced against a timeout so one bad page can never wedge the run.
// Usage: SHOT_URL=… node scripts/shot-observatory.mjs   (out: scripts/_obs)
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'fs';

const URL = process.env.SHOT_URL || 'http://localhost:8124/index.html';
const OUT = process.env.SHOT_OUT || 'scripts/_obs';
mkdirSync(OUT, { recursive: true });

const browser = await (async () => {
  for (const opts of [{ channel: 'msedge', headless: true }, { channel: 'chrome', headless: true }, { headless: true }]) {
    try { return await chromium.launch(opts); } catch (e) { /* try next channel */ }
  }
  throw new Error('no chromium channel available');
})();
const errors = [];

async function tryEval(page, fn, arg, ms = 2500, fallback = null) {
  try {
    return await Promise.race([
      page.evaluate(fn, arg),
      new Promise(res => setTimeout(() => res(fallback), ms))
    ]);
  } catch (e) { return fallback; }
}

async function shoot({ name, w = 1440, h = 900, ink = 'brass', mode = 'night', scroll = 0, themePop = false, modal = false } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(`[${name}] pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${name}] console: ${m.text().slice(0, 200)}`); });
  await page.addInitScript(({ ink, mode }) => {
    try {
      const d = new Date();
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      localStorage.setItem('jeemax_boot_seq_date', key);
      localStorage.setItem('jeemax_theme', ink);
      localStorage.setItem('jeemax_mode', mode);
      localStorage.removeItem('jeemax_mode_dusk_mig');
    } catch (e) {}
  }, { ink, mode });

  try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
  catch (e) { errors.push(`[${name}] goto: ${String(e).slice(0, 120)}`); }

  /* ── act early — the thread stalls somewhere in 1.5–3 s after DCL ── */
  await page.waitForTimeout(350);
  await tryEval(page, `(() => { const b = document.querySelector('.bootseq-skip'); if (b) b.click(); })()`, undefined, 1500);
  if (scroll)   await tryEval(page, s => { const el = document.querySelector('.main-content'); if (el) el.scrollTop = s; }, scroll, 1500);
  if (themePop) await tryEval(page, `(() => { const b = document.getElementById('theme-btn'); if (b) b.click(); })()`, undefined, 1500);
  if (modal)    await tryEval(page, `(() => {
      if (window.openModal) window.openModal('add-error-modal');
      else { const m = document.getElementById('add-error-modal'); if (m) m.classList.add('active'); }
    })()`, undefined, 1500);

  /* ── report while the thread still answers ── */
  await page.waitForTimeout(900);
  const report = await tryEval(page, `(() => {
    const vis = [...document.querySelectorAll('.obs-plate')].filter(p => parseFloat(getComputedStyle(p).opacity) > 0.02);
    return {
      theme: document.documentElement.dataset.theme,
      ink: document.documentElement.dataset.ink,
      mode: document.documentElement.dataset.mode,
      screen: document.documentElement.dataset.obsScreen,
      focus: document.documentElement.dataset.obsFocus || '',
      platesVisible: vis.length,
      plateOp: vis.map(p => parseFloat(getComputedStyle(p).opacity).toFixed(3)).join(','),
      hero: (document.getElementById('tp-total') || {}).textContent,
      decayRows: document.querySelectorAll('#chapter-decay-grid .rh-row, #chapter-decay-grid .rh-empty').length,
      progRows: document.querySelectorAll('#chapter-progress-list .cpx-row, #chapter-progress-list .cpx-empty').length,
      titleFont: getComputedStyle(document.getElementById('view-title')).fontFamily.slice(0, 34),
      navH: document.getElementById('sidebar') ? Math.round(document.getElementById('sidebar').getBoundingClientRect().height) : -1,
      modalOpen: !!document.querySelector('#add-error-modal.active, #theme-panel.open'),
      glyphs: document.querySelectorAll('body svg.g use').length
    };
  })()`, undefined, 2500, { evalStalled: true });

  /* ── CDP screenshot — works even if the thread just stalled ── */
  await page.waitForTimeout(250);
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
  console.log(name, JSON.stringify(report));
  await page.close();
  return report;
}

/* one retry when the stall lands before the report — fresh boots vary */
async function shootRetry(cfg, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await shoot(cfg);
    if (!r || !r.evalStalled) return r;
    console.log(`  retry ${cfg.name} (stall landed early)`);
  }
  return null;
}

await shootRetry({ name: 'dash-night-brass' });
await shootRetry({ name: 'dash-night-brass-scroll', scroll: 620 });
await shootRetry({ name: 'dash-dusk-brass', mode: 'dusk' });
await shootRetry({ name: 'dash-night-starlight', ink: 'starlight' });
await shootRetry({ name: 'dash-night-ember', ink: 'ember' });
await shootRetry({ name: 'dash-theme-popover', themePop: true });
await shootRetry({ name: 'dash-modal-focus', modal: true });
await shootRetry({ name: 'dash-mobile', w: 390, h: 844 });

await browser.close();
if (errors.length) { console.log('\nCONSOLE/PAGE ERRORS:'); errors.forEach(e => console.log('  ' + e)); }
else console.log('\nno console/page errors');
console.log('done');
