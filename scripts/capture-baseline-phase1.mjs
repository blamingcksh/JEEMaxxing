import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8933;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = 'C:\\Users\\Chaksh\\.gemini\\antigravity\\brain\\fe5395ec-6ca2-4633-be74-0cdaaefbdf7d\\screenshots';

fs.mkdirSync(OUT_DIR, { recursive: true });

const MIME = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
    '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
    '.woff': 'font/woff', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
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
        } catch (e) {
            res.writeHead(500); res.end(String(e));
        }
    });
    return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function captureCDP(page, filename) {
    const fullPath = path.join(OUT_DIR, filename);
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await fs.promises.writeFile(fullPath, Buffer.from(data, 'base64'));
    await cdp.detach();
    console.log(`Saved: ${fullPath}`);
    return fullPath;
}

async function main() {
    console.log('Starting static server on port ' + PORT);
    const server = await createStaticServer(PORT);
    let browser;
    try {
        try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
        catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }

        console.log('Browser launched successfully.');

        // Helper to setup page with seeded date and seed realistic data
        async function setupPage(viewport) {
            const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
            await page.addInitScript(() => {
                try {
                    const today = new Date().toLocaleDateString('en-CA');
                    localStorage.setItem('jeemax_boot_seq_date', today);
                } catch (e) {}
            });
            await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2000);

            // Seed realistic rich data for baseline audit
            await page.evaluate(async () => {
                const { AppState, saveAllAsync } = await import('./storage.js');
                AppState.userName = 'Grindset';
                AppState.elo = { physics: 1620, chemistry: 1480, maths: 1550, global: 1550 };
                AppState.chapters = {
                    physics: ['Kinematics', 'Thermodynamics', 'Rotational Dynamics', 'Electrostatics'],
                    chemistry: ['Mole Concept', 'Chemical Bonding', 'Thermodynamics (Chem)'],
                    maths: ['Calculus', 'Coordinate Geometry', 'Vectors & 3D']
                };

                // Seed questions
                AppState.questionBank = [
                    {
                        id: 'q-kin-1',
                        subject: 'physics',
                        chapter: 'Kinematics',
                        extractedText: 'A particle moves along x-axis such that $v(x) = \\alpha \\sqrt{x}$. Find average velocity in first $s$ meters.',
                        options: ['\\alpha \\sqrt{s} / 2', '\\alpha \\sqrt{s}', '2\\alpha \\sqrt{s} / 3', '\\alpha \\sqrt{s} / 4'],
                        correctAnswer: 'A',
                        type: 'mcq',
                        status: 'solved',
                        firstAttemptResult: 'correct',
                        qElo: 1580,
                        targetTimeMins: 2.5
                    },
                    {
                        id: 'q-kin-2',
                        subject: 'physics',
                        chapter: 'Kinematics',
                        extractedText: 'A projectile is launched with velocity $u = 20\\text{ m/s}$ at an angle of $60^\\circ$ with horizontal. Radius of curvature at highest point is:',
                        options: ['10 m', '20 m', '30 m', '40 m'],
                        correctAnswer: 'A',
                        type: 'mcq',
                        status: 'unsolved',
                        qElo: 1620,
                        targetTimeMins: 2.0
                    },
                    {
                        id: 'q-thermo-1',
                        subject: 'physics',
                        chapter: 'Kinematics',
                        extractedText: 'One mole of an ideal monoatomic gas undergoes process $PV^2 = C$. Molar heat capacity $C_m$ is:',
                        options: ['R/2', 'R', '3R/2', '2R'],
                        correctAnswer: 'A',
                        type: 'mcq',
                        status: 'wrong',
                        firstAttemptResult: 'incorrect',
                        errorReason: 'Conceptual error on thermodynamic path $PV^2 = C$',
                        frictionType: 'conceptual',
                        reviewDue: Date.now() - 3600000,
                        reps: 1,
                        easeFactor: 2.2,
                        qElo: 1710,
                        targetTimeMins: 3.0
                    },
                    {
                        id: 'q-mole-1',
                        subject: 'chemistry',
                        chapter: 'Mole Concept',
                        extractedText: 'Calculate the molality of a 1 M solution of sodium nitrate with density $1.25\\text{ g/mL}$.',
                        options: ['0.85 m', '0.92 m', '1.05 m', '1.15 m'],
                        correctAnswer: 'A',
                        type: 'mcq',
                        status: 'solved',
                        qElo: 1420,
                        targetTimeMins: 2.0
                    },
                    {
                        id: 'q-calc-1',
                        subject: 'maths',
                        chapter: 'Calculus',
                        extractedText: 'Evaluate $\\lim_{x \\to 0} \\frac{\\tan x - \\sin x}{x^3}$.',
                        options: ['1/2', '1/3', '1/4', '1'],
                        correctAnswer: 'A',
                        type: 'mcq',
                        status: 'solved',
                        qElo: 1520,
                        targetTimeMins: 1.5
                    }
                ];

                // Solved counts today
                window.solved = { physics: 6, chemistry: 3, maths: 4 };
                AppState.activeTargets = { physics: 10, chemistry: 10, maths: 10 };

                // Mock test
                AppState.mocks = [
                    {
                        id: 'mock-sample-1',
                        name: 'Allen Major 1 - Part Test',
                        createdAt: Date.now() - 86400000,
                        status: 'draft',
                        sections: {
                            physics: { total: 25, keys: {} },
                            chemistry: { total: 25, keys: {} },
                            maths: { total: 25, keys: {} }
                        }
                    }
                ];

                const { flushSaves } = await import('./storage.js');
                await saveAllAsync();
                await flushSaves();

                if (window.updateUI) window.updateUI();
                if (window.renderDailyVarianceHeatmap) window.renderDailyVarianceHeatmap();
                if (window.renderChapterDecayGrid) window.renderChapterDecayGrid();
                if (window.renderChapterProgressList) window.renderChapterProgressList();
            });

            await page.waitForTimeout(1000);
            return page;
        }

        console.log('=== Capturing Desktop Screenshots (1440x900) ===');
        const dPage = await setupPage({ width: 1440, height: 900 });

        // 1. Dashboard top
        await dPage.evaluate(() => window.switchTab('dashboard', document.querySelector('[data-tab="dashboard"]')));
        await dPage.waitForTimeout(1200);
        await captureCDP(dPage, 'before_dashboard.png');

        // 2. Dashboard scrolled
        await dPage.evaluate(() => {
            const el = document.querySelector('.main-content');
            if (el) el.scrollTop = 500;
        });
        await dPage.waitForTimeout(600);
        await captureCDP(dPage, 'before_dashboard_scrolled.png');

        // 3. Focus Mode (Pomodoro)
        await dPage.evaluate(() => window.switchTab('pomodoro', document.querySelector('[data-tab="pomodoro"]')));
        await dPage.waitForTimeout(1000);
        await captureCDP(dPage, 'before_pomodoro.png');

        // 5. Focus Mode scrolled (Soundscape panel)
        await dPage.evaluate(() => {
            const el = document.querySelector('.main-content');
            if (el) el.scrollTop = 450;
        });
        await dPage.waitForTimeout(500);
        await captureCDP(dPage, 'before_pomodoro_soundscape.png');

        // 6. The Vault (Error Matrix)
        await dPage.evaluate(() => {
            const el = document.querySelector('.main-content');
            if (el) el.scrollTop = 0;
            window.switchTab('errors', document.querySelector('[data-tab="errors"]'));
        });
        await dPage.waitForTimeout(1200);
        await captureCDP(dPage, 'before_vault.png');
        await captureCDP(dPage, 'before_errors.png');

        // 7. Practice - Subject Arena
        await dPage.evaluate(() => {
            window.switchTab('practice', document.querySelector('[data-tab="practice"]'));
            window.showPracticeSubview('practice-subject-view');
        });
        await dPage.waitForTimeout(800);
        await captureCDP(dPage, 'before_practice.png');
        await captureCDP(dPage, 'before_practice_subjects.png');

        // 8. Practice - Chapter List
        await dPage.evaluate(() => window.selectSubject('physics'));
        await dPage.waitForTimeout(800);
        await captureCDP(dPage, 'before_practice_chapters.png');

        // 9. Practice - Question List
        await dPage.evaluate(() => window.openChapterDetail('Kinematics'));
        await dPage.waitForTimeout(800);
        await captureCDP(dPage, 'before_practice_questions.png');

        // 10. Practice - Solver modal
        await dPage.evaluate(() => {
            const btn = document.querySelector('#questions-grid-container .question-card');
            if (btn) btn.click();
        });
        await dPage.waitForTimeout(1000);
        await captureCDP(dPage, 'before_practice_solver.png');
        await dPage.evaluate(() => {
            if (window.closePracticeModal) window.closePracticeModal();
            else window.closeModalStr('practice-modal');
        });
        await dPage.waitForTimeout(500);

        // 11. Mocks - Home
        await dPage.evaluate(() => window.switchTab('mocks', document.querySelector('[data-tab="mocks"]')));
        await dPage.waitForTimeout(1000);
        await captureCDP(dPage, 'before_mocks.png');

        // 12. Mocks - Weak points & Analysis
        await dPage.evaluate(() => {
            if (window.mockWeakPoints) window.mockWeakPoints();
        });
        await dPage.waitForTimeout(800);
        await captureCDP(dPage, 'before_analysis.png');

        // 13. Settings (Config) - Top
        await dPage.evaluate(() => {
            const el = document.querySelector('.main-content');
            if (el) el.scrollTop = 0;
            window.switchTab('settings', document.querySelector('[data-tab="settings"]'));
        });
        await dPage.waitForTimeout(1000);
        await captureCDP(dPage, 'before_settings.png');

        // 14. Settings (Config) - Scrolled
        await dPage.evaluate(() => {
            const el = document.querySelector('.main-content');
            if (el) el.scrollTop = 600;
        });
        await dPage.waitForTimeout(600);
        await captureCDP(dPage, 'before_settings_scrolled.png');

        await dPage.close();

        console.log('=== Capturing Mobile Screenshots (390x844) ===');
        const mPage = await setupPage({ width: 390, height: 844 });

        // Mobile 1: Dashboard
        await mPage.evaluate(() => {
            const el = document.querySelector('.main-content');
            if (el) el.scrollTop = 0;
            window.switchTab('dashboard', document.querySelector('[data-tab="dashboard"]'));
        });
        await mPage.waitForTimeout(1200);
        await captureCDP(mPage, 'before_mobile_dashboard.png');

        // Mobile 2: Dashboard scrolled
        await mPage.evaluate(() => {
            const el = document.querySelector('.main-content');
            if (el) el.scrollTop = 600;
        });
        await mPage.waitForTimeout(600);
        await captureCDP(mPage, 'before_mobile_dashboard_scrolled.png');

        // Mobile 3: Pomodoro
        await mPage.evaluate(() => {
            const el = document.querySelector('.main-content');
            if (el) el.scrollTop = 0;
            window.switchTab('pomodoro', document.querySelector('[data-tab="pomodoro"]'));
        });
        await mPage.waitForTimeout(1000);
        await captureCDP(mPage, 'before_mobile_pomodoro.png');

        // Mobile 4: Vault
        await mPage.evaluate(() => {
            const el = document.querySelector('.main-content');
            if (el) el.scrollTop = 0;
            window.switchTab('errors', document.querySelector('[data-tab="errors"]'));
        });
        await mPage.waitForTimeout(1200);
        await captureCDP(mPage, 'before_mobile_vault.png');

        // Mobile 5: Practice Subject
        await mPage.evaluate(() => {
            window.switchTab('practice', document.querySelector('[data-tab="practice"]'));
            window.showPracticeSubview('practice-subject-view');
        });
        await mPage.waitForTimeout(800);
        await captureCDP(mPage, 'before_mobile_practice.png');

        // Mobile 6: Practice Chapters
        await mPage.evaluate(() => window.selectSubject('physics'));
        await mPage.waitForTimeout(800);
        await captureCDP(mPage, 'before_mobile_practice_chapters.png');

        // Mobile 7: Practice Questions / Solver
        await mPage.evaluate(() => window.openChapterDetail('Kinematics'));
        await mPage.waitForTimeout(800);
        await mPage.evaluate(() => {
            const btn = document.querySelector('#questions-grid-container .question-card');
            if (btn) btn.click();
        });
        await mPage.waitForTimeout(1000);
        await captureCDP(mPage, 'before_mobile_practice_solver.png');
        await mPage.evaluate(() => {
            if (window.closePracticeModal) window.closePracticeModal();
            else window.closeModalStr('practice-modal');
        });
        await mPage.waitForTimeout(500);

        // Mobile 8: Mocks
        await mPage.evaluate(() => window.switchTab('mocks', document.querySelector('[data-tab="mocks"]')));
        await mPage.waitForTimeout(1000);
        await captureCDP(mPage, 'before_mobile_mocks.png');

        // Mobile 9: Settings
        await mPage.evaluate(() => {
            const el = document.querySelector('.main-content');
            if (el) el.scrollTop = 0;
            window.switchTab('settings', document.querySelector('[data-tab="settings"]'));
        });
        await mPage.waitForTimeout(1000);
        await captureCDP(mPage, 'before_mobile_settings.png');

        await mPage.close();
        console.log('All screenshots captured successfully!');
    } finally {
        if (browser) await browser.close();
        await new Promise(r => server.close(r));
        console.log('Server and browser shut down cleanly.');
    }
}

main().catch(err => {
    console.error('Fatal error during capture:', err);
    process.exit(1);
});
