// End-to-end Playwright verification for Spotify Connect Deck & Heartbeat Audio Handoff
// Run: node scripts/verify-spotify.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8798;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = `http://127.0.0.1:${PORT}/index.html`;

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg',
};

const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
);

const server = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
        let p = decodeURIComponent((req.url || '/').split('?')[0]);
        if (p === '/') p = '/index.html';
        const full = path.normalize(path.join(ROOT, p));
        if (!full.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
        fs.readFile(full, (err, data) => {
            if (err) { res.writeHead(404); res.end('not found'); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
});

let browser;
try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
} catch {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
page.on('console', (m) => {
    if (m.type() === 'error') {
        const txt = m.text();
        if (!/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|fontsource|accounts\.google|gsi/i.test(txt)) {
            errors.push('console.error: ' + txt);
        }
    }
});

// ── Mock Spotify Backend State ──
const spState = {
    isPlaying: true,
    progressMs: 42000,
    repeatState: 'off',
    shuffleState: false,
    volumePercent: 72,
    activeDeviceId: 'ipad-dev-1',
    savedUris: new Set(),
    apiLog: [],
    tracks: {
        t1: {
            id: 't1',
            uri: 'spotify:track:t1',
            name: 'Aruarian Dance',
            duration_ms: 250000,
            artists: [{ id: 'a1', name: 'Nujabes' }],
            album: { id: 'al1', uri: 'spotify:album:al1', name: 'Samurai Champloo', images: [{ url: 'https://i.scdn.co/image/cover1', width: 300 }] },
        },
        t2: {
            id: 't2',
            uri: 'spotify:track:t2',
            name: 'Feather <script>alert(1)</script>',
            duration_ms: 175000,
            artists: [{ id: 'a1', name: 'Nujabes' }],
            album: { id: 'al2', uri: 'spotify:album:al2', name: 'Modal Soul', images: [{ url: 'https://i.scdn.co/image/cover2', width: 300 }] },
        },
    },
    playlists: [
        {
            id: 'pl1',
            uri: 'spotify:playlist:pl1',
            name: 'Deep Void <img src=x onerror=window.__xss=1>',
            owner: { id: 'me1', display_name: 'Chaksh' },
            collaborative: false,
            images: [{ url: 'https://i.scdn.co/image/pl1', width: 300 }],
            items: { total: 2 },
        },
        {
            id: 'pl2',
            uri: 'spotify:playlist:pl2',
            name: '3AM Calculus',
            owner: { id: 'me1', display_name: 'Chaksh' },
            collaborative: false,
            images: [{ url: 'https://i.scdn.co/image/pl2', width: 300 }],
            items: { total: 1 },
        },
    ],
    currentTrackId: 't1',
};

await page.route('https://i.scdn.co/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG });
});

await page.route('https://accounts.spotify.com/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/token')) {
        spState.apiLog.push(`POST ${url}`);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                access_token: 'mock_access_tok_1',
                refresh_token: 'mock_refresh_tok_1',
                expires_in: 3600,
                scope: 'user-read-playback-state user-modify-playback-state',
            }),
        });
        return;
    }
    await route.abort();
});

await page.route('https://api.spotify.com/v1/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname.replace(/^\/v1/, '');
    const m = req.method();
    spState.apiLog.push(`${m} ${p}${u.search}`);

    const json = (status, obj) => route.fulfill({
        status,
        contentType: 'application/json',
        body: obj === null ? '' : JSON.stringify(obj),
    });

    if (p === '/me' && m === 'GET') {
        return json(200, { id: 'me1', display_name: 'Chaksh', product: 'premium' });
    }
    if (p === '/me/player' && m === 'GET') {
        return json(200, {
            is_playing: spState.isPlaying,
            progress_ms: spState.progressMs,
            repeat_state: spState.repeatState,
            shuffle_state: spState.shuffleState,
            item: spState.tracks[spState.currentTrackId],
            context: { uri: 'spotify:playlist:pl1', type: 'playlist' },
            device: { id: spState.activeDeviceId, name: 'iPad Pro', type: 'Tablet', is_active: true, supports_volume: true, volume_percent: spState.volumePercent },
        });
    }
    if (p === '/me/player' && m === 'PUT') {
        return route.fulfill({ status: 204 });
    }
    if (p === '/me/player/devices' && m === 'GET') {
        return json(200, {
            devices: [
                { id: 'ipad-dev-1', name: 'iPad Pro', type: 'Tablet', is_active: true, supports_volume: true, volume_percent: spState.volumePercent },
                { id: 'pc-dev-2', name: 'Desk PC', type: 'Computer', is_active: false, supports_volume: true, volume_percent: 60 },
            ],
        });
    }
    if (p === '/me/player/play' && m === 'PUT') {
        spState.isPlaying = true;
        return route.fulfill({ status: 204 });
    }
    if (p === '/me/player/pause' && m === 'PUT') {
        spState.isPlaying = false;
        return route.fulfill({ status: 204 });
    }
    if (p === '/me/player/next' && m === 'POST') {
        spState.currentTrackId = 't2';
        return route.fulfill({ status: 204 });
    }
    if (p === '/me/player/previous' && m === 'POST') {
        spState.currentTrackId = 't1';
        return route.fulfill({ status: 204 });
    }
    if (p === '/me/player/repeat' && m === 'PUT') {
        spState.repeatState = u.searchParams.get('state') || 'off';
        return route.fulfill({ status: 204 });
    }
    if (p === '/me/player/shuffle' && m === 'PUT') {
        spState.shuffleState = u.searchParams.get('state') === 'true';
        return route.fulfill({ status: 204 });
    }
    if (p === '/me/player/volume' && m === 'PUT') {
        spState.volumePercent = Number(u.searchParams.get('volume_percent')) || 50;
        return route.fulfill({ status: 204 });
    }
    if (p === '/me/player/seek' && m === 'PUT') {
        spState.progressMs = Number(u.searchParams.get('position_ms')) || 0;
        return route.fulfill({ status: 204 });
    }
    if (p === '/me/playlists' && m === 'GET') {
        return json(200, { items: spState.playlists, total: spState.playlists.length });
    }
    if (p === '/playlists/pl1/items' && m === 'GET') {
        return json(200, {
            items: [
                { added_at: '2026-10-01T00:00:00Z', item: spState.tracks.t1 },
                { added_at: '2026-10-02T00:00:00Z', item: spState.tracks.t2 },
            ],
            total: 2,
        });
    }
    if (p === '/playlists/pl2/items' && m === 'POST') {
        return json(201, { snapshot_id: 'snap1' });
    }
    if (p === '/me/library/contains' && m === 'GET') {
        const uri = u.searchParams.get('uris') || '';
        return json(200, [spState.savedUris.has(uri)]);
    }
    if (p === '/me/library' && m === 'PUT') {
        const uri = u.searchParams.get('uris') || '';
        if (uri) spState.savedUris.add(uri);
        return route.fulfill({ status: 200 });
    }
    if (p === '/me/library' && m === 'DELETE') {
        const uri = u.searchParams.get('uris') || '';
        spState.savedUris.delete(uri);
        return route.fulfill({ status: 200 });
    }
    if (p === '/me/player/recently-played' && m === 'GET') {
        return json(200, { items: [{ track: spState.tracks.t1 }, { track: spState.tracks.t2 }] });
    }
    if (p === '/me/top/tracks' && m === 'GET') {
        return json(200, { items: [spState.tracks.t2, spState.tracks.t1] });
    }
    if (p === '/me/tracks' && m === 'GET') {
        return json(200, { items: [{ track: spState.tracks.t1 }], total: 1 });
    }
    if (p === '/me/player/queue' && m === 'GET') {
        return json(200, { currently_playing: spState.tracks.t1, queue: [spState.tracks.t2] });
    }
    if (p === '/me/player/queue' && m === 'POST') {
        return route.fulfill({ status: 204 });
    }
    if (p === '/search' && m === 'GET') {
        return json(200, {
            tracks: { items: [spState.tracks.t2] },
            playlists: { items: [spState.playlists[1]] },
            albums: { items: [spState.tracks.t1.album] },
        });
    }
    if (p === '/albums/al1' && m === 'GET') {
        return json(200, {
            ...spState.tracks.t1.album,
            artists: [{ name: 'Nujabes' }],
            total_tracks: 1,
            tracks: { items: [spState.tracks.t1], total: 1 },
        });
    }
    return json(404, { error: { status: 404, message: 'Mock unhandled ' + p } });
});

let pass = 0;
let fail = 0;
function check(cond, label) {
    if (cond) {
        pass++;
        console.log('  ✓', label);
    } else {
        fail++;
        console.error('  ✗ FAIL:', label);
    }
}

try {
    console.log('── [1] Unconnected Boot & Non-Intrusive Void Anchor ──');
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('heartbeat-void')?.classList.contains('hb-ready'), null, { timeout: 15000 });
    await page.waitForTimeout(400);

    const bootState = await page.evaluate(() => ({
        anchorText: document.querySelector('#sp-void-anchor')?.textContent.trim(),
        hbPillCount: document.querySelectorAll('.hb-pill-btn').length,
        yielding: window.HeartbeatAudio?.isSpotifyYielding(),
        audioLbl: document.querySelector('#hb-audio-btn .hb-audio-lbl')?.textContent.trim(),
        connected: window.SpotifyDeck?.isConnected(),
    }));
    check(bootState.anchorText === 'SPOTIFY', `Void anchor displays SPOTIFY (${bootState.anchorText})`);
    check(bootState.hbPillCount === 4, `Original 4 .hb-pill-btn buttons untouched (${bootState.hbPillCount})`);
    check(bootState.yielding === false && bootState.audioLbl === 'AUDIO', 'Heartbeat audio active when Spotify unconnected');
    check(bootState.connected === false && spState.apiLog.length === 0, 'Zero Spotify API calls made while unconnected');

    console.log('── [2] PKCE Setup, OAuth Callback & URL Scrubbing ──');
    await page.click('#sp-void-anchor .sp-void-pill');
    await page.waitForSelector('#sp-deck-drawer:not([hidden])');
    const redirectCode = await page.locator('#sp-redirect-uri-code').innerText();
    check(redirectCode === BASE, `Exact Redirect URI displayed (${redirectCode})`);

    // Stage PKCE payload via startAuth flow intercepting external redirect
    await page.fill('#sp-client-id-input', 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');
    await page.evaluate(async () => {
        // Intercept location.assign by saving verifier directly using spotify-auth
        localStorage.setItem('jeemax_spotify_pkce_v1', JSON.stringify({
            verifier: 'mock_verifier_1234567890123456789012345678901234567890',
            state: 'mock_state_abc',
            redirectUri: window.location.origin + window.location.pathname,
            clientId: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
            ts: Date.now(),
        }));
    });
    await page.goto(`${BASE}?code=mock_code_xyz&state=mock_state_abc`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.SpotifyDeck?.isConnected() === true, null, { timeout: 10000 });
    await page.waitForSelector('#sp-deck-connected-shell');

    const postAuth = await page.evaluate(() => ({
        search: window.location.search,
        connected: window.SpotifyDeck.isConnected(),
        yielding: window.HeartbeatAudio.isSpotifyYielding(),
        audioLbl: document.querySelector('#hb-audio-btn .hb-audio-lbl')?.textContent.trim(),
        xssFired: Boolean(window.__xss),
    }));
    check(postAuth.search === '', 'OAuth code/state params scrubbed from URL');
    check(postAuth.connected === true, 'SpotifyDeck connected cleanly via PKCE');
    check(postAuth.yielding === true && postAuth.audioLbl === 'VOID OFF', 'HeartbeatAudio yielded cleanly & #hb-audio-btn shows VOID OFF');
    check(!postAuth.xssFired, 'XSS payloads in track/playlist names neutralized');

    console.log('── [3] Heartbeat Audio Yield & Reclaim Handoff ──');
    // Pause Spotify -> Heartbeat yield MUST stay true (no auto-blast of Void synth)
    await page.click('#sp-deck-hero [data-sp-act="toggle-play"]');
    await page.waitForTimeout(450);
    const afterPause = await page.evaluate(() => ({
        yielding: window.HeartbeatAudio.isSpotifyYielding(),
        isPlaying: window.SpotifyDeck.isPlaying(),
    }));
    check(afterPause.isPlaying === false && afterPause.yielding === true, 'Pausing Spotify keeps Heartbeat audio yielded (quiet stays quiet)');

    // Resume Spotify, then close Deck and tap #hb-audio-btn -> must reclaim Void audio AND pause Spotify
    await page.click('#sp-deck-hero [data-sp-act="toggle-play"]');
    await page.waitForTimeout(450);
    await page.click('[data-sp-act="close-deck"]');
    await page.waitForFunction(() => document.getElementById('heartbeat-void')?.classList.contains('hb-ready'), null, { timeout: 10000 });
    await page.click('#hb-audio-btn');
    await page.waitForTimeout(250);
    const afterReclaim = await page.evaluate(() => ({
        yielding: window.HeartbeatAudio.isSpotifyYielding(),
        audioLbl: document.querySelector('#hb-audio-btn .hb-audio-lbl')?.textContent.trim(),
        spotifyPlaying: window.SpotifyDeck.isPlaying(),
    }));
    check(afterReclaim.yielding === false && afterReclaim.audioLbl === 'AUDIO', 'Clicking VOID OFF reclaims Heartbeat Void audio');
    check(spState.isPlaying === false && afterReclaim.spotifyPlaying === false, 'Reclaiming Void audio automatically paused Spotify via Connect');

    console.log('── [4] Playlists, Detail Drill-Down, Queue, Save, Loop, Search & Pins ──');
    await page.click('#sp-void-anchor [data-sp-act="open-deck"]');
    await page.waitForSelector('#sp-deck-connected-shell');

    // Drill into playlist pl1
    await page.click('[data-sp-act="open-playlist"][data-playlist-id="pl1"]');
    await page.waitForSelector('#sp-detail-rows .sp-row');
    check(spState.apiLog.some((l) => l.startsWith('GET /playlists/pl1/items')), '2026 GET /playlists/{id}/items used for playlist drill-down');

    // Queue a track from detail view
    await page.click('#sp-detail-rows [data-sp-act="queue-uri"][data-uri="spotify:track:t2"]');
    await page.waitForTimeout(200);
    check(spState.apiLog.some((l) => l.startsWith('POST /me/player/queue')), '+Q queued track via Connect API');

    // Play a track inside playlist context
    await page.click('#sp-detail-rows [data-sp-act="play-detail-track"][data-uri="spotify:track:t2"]');
    await page.waitForTimeout(450);
    const yieldingAfterPlay = await page.evaluate(() => window.HeartbeatAudio.isSpotifyYielding());
    check(spState.isPlaying === true && yieldingAfterPlay === true, 'Playing track from playlist yields Void audio');

    // 1-tap Loop
    const loopWait = page.waitForResponse((res) => res.url().includes('/me/player/repeat') && res.request().method() === 'PUT');
    await page.click('#sp-deck-hero [data-sp-act="toggle-loop"]');
    await loopWait;
    await page.waitForTimeout(100);
    check(spState.repeatState === 'track' && spState.apiLog.some((l) => l.includes('/me/player/repeat?state=track')),
        `1-tap LOOP locked track repeat (repeat=${spState.repeatState}, lastApi=${spState.apiLog.slice(-4).join(' | ')})`);

    // Save -> Unsave via 2026 /me/library
    const saveWait = page.waitForResponse((res) => res.url().includes('/me/library') && res.request().method() === 'PUT');
    await page.click('#sp-deck-hero [data-sp-act="toggle-save"]');
    await saveWait;
    const savedOnce = spState.savedUris.has('spotify:track:t1');
    const unsaveWait = page.waitForResponse((res) => res.url().includes('/me/library') && res.request().method() === 'DELETE');
    await page.click('#sp-deck-hero [data-sp-act="toggle-save"]');
    await unsaveWait;
    const unsavedAfter = !spState.savedUris.has('spotify:track:t1');
    check(savedOnce && unsavedAfter && spState.apiLog.some((l) => l.startsWith('PUT /me/library')) && spState.apiLog.some((l) => l.startsWith('DELETE /me/library')),
        'Save/Remove uses 2026 /me/library endpoints');

    // + PLAYLIST picker
    await page.click('#sp-deck-hero [data-sp-act="open-playlist-picker"]');
    await page.waitForSelector('#sp-playlist-picker');
    const addPlWait = page.waitForResponse((res) => res.url().includes('/playlists/pl2/items') && res.request().method() === 'POST');
    await page.click('#sp-playlist-picker [data-sp-act="add-to-playlist"][data-playlist-id="pl2"]');
    await addPlWait;
    check(spState.apiLog.some((l) => l.startsWith('POST /playlists/pl2/items')), '+ PLAYLIST adds track via 2026 POST /playlists/{id}/items');

    // Tabs: Rotation, Liked, Queue, Search + Album drill-down
    await page.click('[data-sp-tab="rotation"]');
    await page.waitForSelector('#sp-tab-body .sp-group-title');
    await page.click('[data-sp-tab="liked"]');
    await page.waitForSelector('#sp-tab-body .sp-row');
    await page.click('[data-sp-tab="queue"]');
    await page.waitForSelector('#sp-tab-body .sp-queue-head');
    await page.click('[data-sp-tab="search"]');
    await page.fill('#sp-search-input', 'Nujabes');
    await page.waitForFunction(() => document.querySelectorAll('#sp-search-results .sp-row').length > 0, null, { timeout: 5000 });
    check(spState.apiLog.some((l) => l.startsWith('GET /search?') && l.includes('limit=10')), 'Search enforces 2026 Dev Mode limit=10');

    await page.click('#sp-search-results [data-sp-act="open-album"][data-album-id="al1"]');
    await page.waitForSelector('.sp-detail .sp-detail-banner');
    check(spState.apiLog.some((l) => l.startsWith('GET /albums/al1')), 'Album drill-down opens cleanly');

    // Pin slot + Reload persistence + Wipe survival
    await page.click('#sp-deck-hero [data-sp-act="pin-current"]');
    const pinCountBeforeReload = await page.locator('.sp-pin-slot.is-filled').count();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.SpotifyDeck?.isConnected() === true && window.SpotifyDeck?.isPlaying() === true, null, { timeout: 10000 });
    const wipeSurvival = await page.evaluate(async () => {
        const mod = await import('./storage.js');
        await mod.wipeAllAppData();
        return {
            pinsRaw: localStorage.getItem('jeemax_spotify_pins_v1'),
            tokensRaw: localStorage.getItem('jeemax_spotify_tokens_v1'),
            clientRaw: localStorage.getItem('jeemax_spotify_client_id_v1'),
            wipeEpoch: localStorage.getItem('jeemax_wipe_epoch'),
        };
    });
    check(pinCountBeforeReload === 1 && Boolean(wipeSurvival.pinsRaw) && Boolean(wipeSurvival.tokensRaw) && Boolean(wipeSurvival.clientRaw) && Boolean(wipeSurvival.wipeEpoch),
        'Quick-Pins & Spotify tokens survive reload AND Heartbeat wipeAllAppData()');

    console.log('── [5] Void Drown Mode, Practice Micro-Pill & Escape Isolation ──');
    await page.waitForFunction(() => document.getElementById('heartbeat-void')?.classList.contains('hb-ready'), null, { timeout: 10000 });
    await page.evaluate(() => window.SpotifyDeck.enterDrown());
    await page.waitForSelector('#sp-drown-overlay:not([hidden])');
    const drownActive = await page.evaluate(() => document.body.classList.contains('sp-drown-active'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('sp-drown-overlay')?.hidden === true);
    check(drownActive, 'Void Drown Mode activates and exits cleanly on Escape');

    // Seed a question and open Practice Stage via real UI clicks to verify Micro-Pill, Haze, and Escape isolation
    await page.evaluate(async () => {
        const mod = await import('./storage.js');
        mod.AppState.chapters.physics = ['Electrostatics'];
        mod.AppState.questionBank.push({
            id: 'sp-q1',
            subject: 'physics',
            chapter: 'Electrostatics',
            extractedText: 'Find potential $V$.',
            imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
            type: 'mcq',
            options: ['1 V', '2 V', '3 V', '4 V'],
            correctAnswer: 'A',
            qElo: 1400,
            status: 'unsolved',
        });
        await mod.saveAllAsync();
    });
    await page.click('.hb-subj-btn[data-subject="physics"]');
    await page.waitForSelector('.chapter-item');
    await page.click('.chapter-item');
    await page.waitForSelector('.question-card');
    await page.click('.question-card');
    await page.waitForSelector('#practice-modal.active');

    const pqChecks = await page.evaluate(() => ({
        floatVisible: getComputedStyle(document.getElementById('sp-float-pill')).display !== 'none',
        hazeActive: document.getElementById('sp-pq-haze')?.classList.contains('is-active'),
    }));
    await page.click('#sp-float-pill [data-sp-act="open-deck"]');
    await page.waitForSelector('#sp-deck-drawer:not([hidden])');
    await page.evaluate(() => document.getElementById('practice-modal')?.classList.add('pq-chrome-hidden'));
    await page.click('#sp-deck-drawer [data-sp-act="close-deck"]');
    await page.waitForFunction(() => document.getElementById('sp-deck-drawer')?.hidden === true);
    await page.waitForTimeout(1000);
    const afterDeckClickClose = await page.evaluate(() => {
        const modal = document.getElementById('practice-modal');
        const ring = document.getElementById('pq-hold-ring-wrap');
        return {
            active: Boolean(modal?.classList.contains('active')),
            holding: Boolean(modal?.classList.contains('pq-holding')),
            ringActive: Boolean(ring?.classList.contains('active')),
            pqState: modal?.getAttribute('data-pq-state') || '',
            chromeHidden: Boolean(modal?.classList.contains('pq-chrome-hidden')),
        };
    });

    await page.click('#sp-float-pill [data-sp-act="open-deck"]');
    await page.waitForSelector('#sp-deck-drawer:not([hidden])');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('sp-deck-drawer')?.hidden === true);
    await page.waitForTimeout(1000);
    const pqStillOpen = await page.evaluate(() => {
        const modal = document.getElementById('practice-modal');
        return Boolean(modal?.classList.contains('active')) && modal?.getAttribute('data-pq-state') === 'solving';
    });

    const readHazeMetrics = () => page.evaluate(() => {
        const haze = document.getElementById('sp-pq-haze');
        const hazeCs = haze ? getComputedStyle(haze) : null;
        const media = document.querySelector('#practice-modal .pq-qa-media');
        const beforeCs = media ? getComputedStyle(media, '::before') : null;
        const img = document.getElementById('practice-modal-img');
        const imgCs = img ? getComputedStyle(img) : null;
        return {
            htmlHaze: document.documentElement.classList.contains('sp-haze-active'),
            pillBg: getComputedStyle(document.getElementById('sp-float-pill')).backgroundColor,
            hazeBlend: hazeCs ? hazeCs.mixBlendMode : '',
            beforeBg: beforeCs ? beforeCs.backgroundImage : '',
            beforeBlend: beforeCs ? beforeCs.mixBlendMode : '',
            beforeOp: beforeCs ? parseFloat(beforeCs.opacity) : 0,
            imgBlend: imgCs ? imgCs.mixBlendMode : '',
            imgZ: imgCs ? imgCs.zIndex : '',
        };
    });

    const parchmentMetrics = await readHazeMetrics();
    const parchmentBg = parchmentMetrics.pillBg;
    await page.evaluate(() => document.getElementById('practice-modal')?.dispatchEvent(new CustomEvent('pq:chrome-activity')));
    await page.click('#immersive-focus-btn');
    await page.waitForFunction((prev) => getComputedStyle(document.getElementById('sp-float-pill')).backgroundColor !== prev, parchmentBg, { timeout: 3000 });
    const mediaBuff = await readHazeMetrics();
    const roastBg = mediaBuff.pillBg;

    await page.evaluate(() => document.getElementById('practice-modal').classList.add('pq-chrome-hidden'));
    await page.waitForFunction(() => {
        const cs = getComputedStyle(document.getElementById('sp-float-pill'));
        return cs.pointerEvents === 'none' && parseFloat(cs.opacity) === 0;
    }, null, { timeout: 5000 });
    const fadedPill = await page.evaluate(() => {
        const cs = getComputedStyle(document.getElementById('sp-float-pill'));
        return { opacity: cs.opacity, pointerEvents: cs.pointerEvents };
    });

    await page.evaluate(() => document.getElementById('practice-modal').classList.remove('pq-chrome-hidden'));
    await page.waitForFunction(() => {
        const cs = getComputedStyle(document.getElementById('sp-float-pill'));
        return cs.pointerEvents !== 'none' && parseFloat(cs.opacity) === 1;
    }, null, { timeout: 3000 });
    const restoredPill = await page.evaluate(() => {
        const cs = getComputedStyle(document.getElementById('sp-float-pill'));
        return { opacity: cs.opacity, pointerEvents: cs.pointerEvents };
    });

    check(pqChecks.floatVisible && pqChecks.hazeActive, 'Practice Micro-Pill visible & Living Album Haze active in Practice');
    check(parchmentBg !== roastBg, `Practice Micro-Pill adapts between Parchment (${parchmentBg}) and Roast (${roastBg})`);
    check(
        parchmentMetrics.htmlHaze && parchmentMetrics.hazeBlend === 'color' && parchmentMetrics.beforeBlend === 'color' && parchmentMetrics.beforeOp > 0.4,
        `Parchment haze & diagram buff preserve luminance (hazeBlend=${parchmentMetrics.hazeBlend}, beforeBlend=${parchmentMetrics.beforeBlend}, op=${parchmentMetrics.beforeOp})`
    );
    check(
        mediaBuff.htmlHaze && mediaBuff.hazeBlend === 'normal' && mediaBuff.beforeBg.includes('url(') && mediaBuff.beforeBlend === 'color' && mediaBuff.beforeOp > 0.4 && mediaBuff.imgBlend === 'multiply' && mediaBuff.imgZ === '1',
        `Roast attached diagram receives luminance-safe album buff (hazeBlend=${mediaBuff.hazeBlend}, beforeBlend=${mediaBuff.beforeBlend}, op=${mediaBuff.beforeOp}, imgBlend=${mediaBuff.imgBlend}, z=${mediaBuff.imgZ})`
    );
    check(fadedPill.opacity === '0' && fadedPill.pointerEvents === 'none' && restoredPill.opacity === '1' && restoredPill.pointerEvents !== 'none',
        'Practice Micro-Pill completely vanishes to opacity:0 on idle chrome-hidden and restores on activity');
    check(
        afterDeckClickClose.active && !afterDeckClickClose.holding && !afterDeckClickClose.ringActive && afterDeckClickClose.pqState === 'solving' && !afterDeckClickClose.chromeHidden,
        `Closing Spotify Deck restores Practice chrome without triggering hold-to-reveal (state=${afterDeckClickClose.pqState}, holding=${afterDeckClickClose.holding}, ring=${afterDeckClickClose.ringActive}, chromeHidden=${afterDeckClickClose.chromeHidden})`
    );
    check(pqStillOpen === true, 'Escape closes Spotify Deck WITHOUT closing Practice stage underneath');

    check(errors.length === 0, `Zero uncaught runtime errors (${errors.length} seen${errors.length ? ': ' + errors.join(' | ') : ''})`);
} finally {
    await browser.close();
    server.close();
}

console.log(`\nSummary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
