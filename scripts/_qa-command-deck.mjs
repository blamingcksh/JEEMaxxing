// One-off visual QA for the Command Deck pass (deck compaction, mono hero,
// streak chip, tier glyphs, plate dimming, countdown chip). Not part of `npm test`.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8977;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'scripts', '_obs');
fs.mkdirSync(OUT_DIR, { recursive: true });

const MIME = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
    '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
    '.mp3': 'audio/mpeg', '.webp': 'image/webp', '.txt': 'text/plain',
};

function createStaticServer(port) {
    const server = http.createServer((req, res) => {
        try {
            let p = decodeURIComponent(req.url.split('?')[0]);
            if (p === '/') p = '/index.html';
            const file = path.join(ROOT, p);
            if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
            fs.readFile(file, (err, data) => {
                if (err) { res.writeHead(404); return res.end('not found'); }
                res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
                res.end(data);
            });
        } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function daysAgoKey(n) {
    const d = new Date(); d.setDate(d.getDate() - n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function daysAgoIso(n, hour = 15) {
    const d = new Date(); d.setDate(d.getDate() - n); d.setHours(hour, 0, 0, 0);
    return d.toISOString();
}

async function main() {
    const server = await createStaticServer(PORT);
    let browser;
    try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
    catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.addInitScript(() => {
        try {
            const today = new Date().toLocaleDateString('en-CA');
            localStorage.setItem('jeemax_boot_seq_date', today);
        } catch (e) {}
    });
    page.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0, 200)));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    for (let i = 0; i < 6; i++) {
        const count = await page.locator('.bootseq').count();
        if (!count) break;
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
    }

    // Seed: 4-day streak via lastReviewedAt, a Stoichimetry chapter (typo fix),
    // tier Elo values that put physics in Skill Issue + chemistry in NPC,
    // and an exam date ~134 days out for the countdown chip.
    await page.evaluate(async ({ iso }) => {
        const { AppState, saveAllAsync } = await import('./storage.js');
        AppState.userName = 'Grindset';
        AppState.elo = { physics: 1330, chemistry: 1136, maths: 1620, global: 1290 };
        AppState.examDate = new Date(Date.now() + 134 * 86400000).toISOString().slice(0, 10);
        AppState.chapters = {
            physics: ['Kinematics', 'Heat Transfer'],
            chemistry: ['Stoichimetry', 'Mole Concept'],
            maths: ['Calculus'],
        };
        const mk = (id, subject, chapter, dayOffset, status = 'solved') => ({
            id, subject, chapter,
            extractedText: `Seed question ${id} for visual QA.`,
            options: ['A', 'B', 'C', 'D'], correctAnswer: 'A', type: 'mcq',
            status, firstAttemptResult: status === 'solved' ? 'correct' : 'wrong',
            qElo: 1300, timeTaken: 90,
            lastReviewedAt: iso[dayOffset],
        });
        AppState.questionBank = [
            mk('q1', 'physics', 'Heat Transfer', 0),
            mk('q2', 'physics', 'Heat Transfer', 0),
            mk('q3', 'physics', 'Kinematics', 1),
            mk('q4', 'physics', 'Kinematics', 1),
            mk('q5', 'chemistry', 'Stoichimetry', 2),
            mk('q6', 'chemistry', 'Stoichimetry', 2),
            mk('q7', 'maths', 'Calculus', 3),
            mk('q8', 'maths', 'Calculus', 3),
            mk('q9', 'chemistry', 'Mole Concept', 0, 'wrong'),
        ];
        await saveAllAsync();
    }, { iso: [daysAgoIso(0), daysAgoIso(1), daysAgoIso(2), daysAgoIso(3)] });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    for (let i = 0; i < 6; i++) {
        const count = await page.locator('.bootseq').count();
        if (!count) break;
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
    }
    await page.waitForTimeout(1500);

    // Force the warm-start banner visible for the shot (it only renders with a live bridge)
    await page.evaluate(() => {
        const el = document.getElementById('bridge-banner');
        if (el) {
            el.hidden = false;
            el.className = 'bridge-banner bridge-banner-ready';
            const icon = window.__glyph ? window.__glyph('bolt') : '';
            el.innerHTML = `<div class="bridge-banner-content">
                <span class="bridge-banner-badge">${icon}<span>WARM START</span></span>
                <span class="bridge-banner-text"><b>PHYSICS</b> · Heat Transfer · "re-derive the conduction equation"</span>
            </div>
            <button class="btn btn-primary btn-sm bridge-banner-btn">Pick up →</button>`;
        }
    });
    await page.waitForTimeout(800);

    await page.screenshot({ path: path.join(OUT_DIR, 'deck-top.png') });
    await page.evaluate(() => document.querySelector('.dash-card-tracker')?.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT_DIR, 'deck-cards.png') });

    // Console-free probe: key computed styles as numbers
    const probe = await page.evaluate(() => {
        const cs = (el, prop) => el ? getComputedStyle(el)[prop] : null;
        const num = el => el ? Math.round(el.getBoundingClientRect().height) : null;
        const banner = document.querySelector('.bridge-banner');
        const quick = document.querySelector('.dash-quick-bar');
        const attack = document.getElementById('dq-attack-btn');
        const hero = document.querySelector('.tp-num-big');
        const streak = document.getElementById('dv-streak');
        const chip = document.getElementById('exam-countdown-chip');
        const mono = hero ? cs(hero, 'fontFamily') : null;
        const gaps = {};
        if (banner && quick) gaps.bannerToQuick = Math.round(quick.getBoundingClientRect().top - banner.getBoundingClientRect().bottom);
        if (quick) { const grid = document.querySelector('.dash-grid'); if (grid) gaps.quickToGrid = Math.round(grid.getBoundingClientRect().top - quick.getBoundingClientRect().bottom); }
        return {
            bannerH: num(banner),
            bannerBg: banner ? cs(banner, 'backgroundColor') : null,
            bannerBorder: banner ? cs(banner, 'borderTopWidth') : null,
            quickBtnBorder: attack ? cs(attack, 'borderTopWidth') : null,
            quickBtnRadius: attack ? cs(attack, 'borderRadius') : null,
            heroFont: mono,
            streakText: streak ? streak.textContent : null,
            streakVisible: streak ? !streak.hidden : null,
            countdownText: chip ? chip.textContent : null,
            gaps,
        };
    });
    console.log('PROBE:', JSON.stringify(probe, null, 2));

    await browser.close();
    server.close();
    console.log('DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
