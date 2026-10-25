// Generates PWA / Apple Home Screen icons from icons/icon.svg.
// Headless Chromium rasterizes the source at exact pixel sizes; the maskable
// variant is inset to the 80% safe zone so launcher masks never clip the disk.
// Run: node scripts/gen-icons.mjs
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'icons', 'icon.svg'), 'utf8');
const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(source).toString('base64');

const TARGETS = [
    { file: 'apple-touch-icon-180.png', size: 180, scale: 1 },
    { file: 'icon-192.png', size: 192, scale: 1 },
    { file: 'icon-512.png', size: 512, scale: 1 },
    { file: 'icon-512-maskable.png', size: 512, scale: 0.8 },
];

async function launch() {
    for (const channel of ['msedge', 'chrome']) {
        try { return await chromium.launch({ channel, headless: true }); } catch (_) {}
    }
    return chromium.launch({ headless: true });
}

const browser = await launch();
try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const target of TARGETS) {
        await page.setViewportSize({ width: target.size, height: target.size });
        const art = Math.round(target.size * target.scale);
        await page.setContent(`<!DOCTYPE html><html><head><style>
            html, body { margin: 0; width: 100%; height: 100%; background: #05030A; overflow: hidden; }
            body { display: flex; align-items: center; justify-content: center; }
            img { display: block; width: ${art}px; height: ${art}px; }
        </style></head><body><img alt="" src="${dataUrl}"></body></html>`, { waitUntil: 'load' });
        await page.waitForFunction(() => {
            const img = document.querySelector('img');
            return !!img && img.complete && img.naturalWidth > 0;
        });
        writeFileSync(join(root, 'icons', target.file), await page.screenshot({ type: 'png' }));
        const note = target.scale === 1 ? '' : ` (art ${Math.round(target.scale * 100)}%)`;
        console.log(`icons/${target.file}  ${target.size}x${target.size}${note}`);
    }
} finally {
    await browser.close();
}
