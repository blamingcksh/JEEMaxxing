import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
console.log('LOCAL TIME:', new Date().toString());
async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try { return await chromium.launch({ channel, headless: true, args: ['--allow-file-access-from-files'] }); } catch (err) {}
  }
  return await chromium.launch({ headless: true, args: ['--allow-file-access-from-files'] });
}
const browser = await launch();
const page = await browser.newPage();
await page.goto('file:///' + root.replace(/\\/g, '/') + '/index.html');
for (const f of process.argv.slice(2)) {
  const fp = path.join(root, f);
  const rows = await page.evaluate(async (url) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const out = [];
    const N = 10;
    for (let b = 0; b < N; b++) {
      const y0 = Math.floor(c.height * b / N);
      const hgt = Math.max(1, Math.floor(c.height / N));
      const im = g.getImageData(0, y0, c.width, hgt);
      const d = im.data;
      let r = 0, gg = 0, bl = 0, n = 0;
      for (let y = 0; y < hgt; y += 2) for (let x = 0; x < c.width; x += 3) {
        const i = (y * c.width + x) * 4;
        r += d[i]; gg += d[i + 1]; bl += d[i + 2]; n++;
      }
      out.push(Math.round(r / n) + ',' + Math.round(gg / n) + ',' + Math.round(bl / n));
    }
    return out;
  }, 'file:///' + fp.replace(/\\/g, '/'));
  console.log(path.basename(f));
  console.log('  ' + rows.join(' | '));
}
await browser.close();