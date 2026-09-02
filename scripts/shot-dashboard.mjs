// Screenshot harness for the dashboard overhaul — dev tool, not part of the app.
// SHOT_OUT=scripts/_shot · captures: top, scrolled, pace view, mobile.
// The app occasionally reloads itself early after boot (app.js migration
// path), so every page step is retried defensively.
import { chromium } from 'playwright-core';

const URL = process.env.SHOT_URL || 'http://localhost:8123/index.html';
const OUT = process.env.SHOT_OUT || 'scripts/_shot';
const W = parseInt(process.env.SHOT_W || '1440', 10);
const H = parseInt(process.env.SHOT_H || '900', 10);

const browser = await chromium.launch();

async function settle(page) {
  // The app may reload itself once shortly after boot (app.js migration),
  // which resurrects the briefing overlay. Require two consecutive calm
  // checks (no overlay) spaced ~1.6s, then give the fresh page time to render.
  let calm = 0;
  for (let i = 0; i < 30 && calm < 2; i++) {
    let up = false;
    try {
      up = await page.evaluate(() => {
        const b = document.querySelector('.bootseq-skip');
        if (b) b.click();
        return !!b;
      });
    } catch (e) { calm = 0; await page.waitForTimeout(1200); continue; }
    if (up) { calm = 0; await page.waitForTimeout(1000); }
    else { calm++; await page.waitForTimeout(1600); }
  }
  await page.waitForTimeout(2200);
}

async function shoot({ w = W, h = H, pace = false, scroll = 0, suffix = '' } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  // Pre-seed the daily-briefing marker so the boot overlay never mounts.
  await page.addInitScript(() => {
    try {
      const d = new Date();
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      localStorage.setItem('jeemax_boot_seq_date', key);
    } catch (e) {}
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4500);
  await settle(page);
  await page.waitForTimeout(500);
  if (pace) {
    for (let i = 0; i < 3; i++) {
      try { await page.evaluate(() => window.setMomentumView('pace')); break; }
      catch (e) { await page.waitForTimeout(1200); }
    }
    await page.waitForTimeout(900);
  }
  if (scroll) {
    for (let i = 0; i < 3; i++) {
      try {
        await page.evaluate(s => {
          const el = document.querySelector('.main-content');
          if (el) el.scrollTop = s;
        }, scroll);
        break;
      } catch (e) { await page.waitForTimeout(1200); }
    }
    await page.waitForTimeout(500);
  }
  // The dashboard runs continuous rAF charts — bypass Playwright's stability wait.
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await import('fs').then(fs => fs.promises.writeFile(`${OUT}${suffix}.png`, Buffer.from(data, 'base64')));
  await page.close();
  console.log('saved', `${OUT}${suffix}`);
}

await shoot({ suffix: '' });                        // desktop, top, isle view
await shoot({ scroll: 640, suffix: '-scroll' });    // desktop, scrolled
await shoot({ pace: true, suffix: '-pace' });       // desktop, pace chart view
await shoot({ w: 390, h: 844, suffix: '-mobile' }); // mobile
await browser.close();
console.log('done');
