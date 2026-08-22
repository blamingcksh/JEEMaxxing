// qa-png-probe.mjs - pixel-band analysis of screenshot files
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try { return await chromium.launch({ channel, headless: true, args: ['--allow-file-access-from-files'] }); } catch (err) {}
  }
  return await chromium.launch({ headless: true, args: ['--allow-file-access-from-files'] });
}
const browser = await launch();
const page = await browser.newPage();
await page.goto('file:///' + root.replace(/\\/g, '/') + '/index.html');
const files = process.argv.slice(2);
for (const f of files) {
  const fp = path.join(root, f);
  const stats = await page.evaluate(async (url) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    function band(y0, y1) {
      const yA = Math.floor(c.height * y0), hgt = Math.max(1, Math.floor(c.height * (y1 - y0)));
      const im = g.getImageData(0, yA, c.width, hgt);
      const d = im.data;
      let r = 0, gg = 0, b = 0, n = 0;
      const colors = new Set();
      for (let y = 0; y < hgt; y += 2) for (let x = 0; x < c.width; x += 3) {
        const i = (y * c.width + x) * 4;
        r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
        colors.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
      }
      return { rgb: [Math.round(r / n), Math.round(gg / n), Math.round(b / n)], distinct: colors.size };
    }
    return { size: [img.width, img.height], sky: band(0.03, 0.2), mid: band(0.4, 0.6), low: band(0.78, 0.95) };
  }, 'file:///' + fp.replace(/\\/g, '/'));
  console.log(f, JSON.stringify(stats));
}
await browser.close();