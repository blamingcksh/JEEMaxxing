/* ============================================================================
   spotify-deck.js — Personal Spotify Connect Deck, Micro-Pill & Void Drown
   ============================================================================ */

import {
    getClientId,
    setClientId,
    isValidClientIdFormat,
    getRedirectUri,
    isLocalhostUnsupported,
    isConnected as authIsConnected,
    startAuth,
    handleAuthCallback,
    disconnect as authDisconnect,
} from './spotify-auth.js';

import {
    isRateLimited,
    clearSessionCaches,
    getTrackIdFromUri,
    getMe,
    getPlaybackState,
    getDevices,
    transferPlayback,
    play as apiPlay,
    pause as apiPause,
    next as apiNext,
    previous as apiPrevious,
    seek as apiSeek,
    setRepeat as apiSetRepeat,
    setShuffle as apiSetShuffle,
    setVolume as apiSetVolume,
    getMyPlaylists,
    getPlaylistMeta,
    getPlaylistItems,
    addToPlaylist,
    getAlbum,
    getAlbumTracks,
    getLikedTracks,
    checkSaved,
    saveTrack,
    removeTrack,
    getRecentlyPlayed,
    getTopTracks,
    getQueue,
    addToQueue,
    search as apiSearch,
} from './spotify-api.js';

import { HeartbeatAudio } from './heartbeat-audio.js';

const PINS_KEY = 'jeemax_spotify_pins_v1';
const PREFS_KEY = 'jeemax_spotify_prefs_v1';
const MAX_PINS = 4;

const SVG_LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.2"/><path d="M7.6 10.2c2.9-.8 6.1-.5 8.8.8"/><path d="M8.3 13.1c2.4-.6 5-.4 7.3.7"/><path d="M9.1 15.8c1.9-.4 3.9-.2 5.7.6"/></svg>';
const SVG_PREV = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="4.5" y="5.5" width="2.2" height="13" rx="0.8"/><path d="M18.5 6.2v11.6L8.8 12l9.7-5.8Z"/></svg>';
const SVG_NEXT = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="17.3" y="5.5" width="2.2" height="13" rx="0.8"/><path d="M5.5 6.2v11.6L15.2 12 5.5 6.2Z"/></svg>';
const SVG_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.5 5.4v13.2L18.8 12 7.5 5.4Z"/></svg>';
const SVG_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5.5" width="3.8" height="13" rx="1"/><rect x="13.7" y="5.5" width="3.8" height="13" rx="1"/></svg>';
const SVG_SHUFFLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4h4v4"/><path d="M4 20 20 4"/><path d="M16 20h4v-4"/><path d="M14.5 14.5 20 20"/><path d="M4 4l5.5 5.5"/></svg>';
const SVG_LOOP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="14.5" text-anchor="middle" font-size="7" font-family="monospace" fill="currentColor" stroke="none">1</text></svg>';
const SVG_HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.4s-7.2-4.6-9.1-8.7C1.5 8.6 3.5 5 7 5c2 0 3.7 1.1 5 2.7C13.3 6.1 15 5 17 5c3.5 0 5.5 3.6 4.1 6.7-1.9 4.1-9.1 8.7-9.1 8.7Z"/></svg>';
const SVG_HEART_FILL = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M12 20.4s-7.2-4.6-9.1-8.7C1.5 8.6 3.5 5 7 5c2 0 3.7 1.1 5 2.7C13.3 6.1 15 5 17 5c3.5 0 5.5 3.6 4.1 6.7-1.9 4.1-9.1 8.7-9.1 8.7Z"/></svg>';

function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeCssUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (!/^https:\/\/[a-zA-Z0-9.-]+\//i.test(raw)) return '';
    return raw.replace(/["'()\\\r\n]/g, '');
}

function fmtTime(ms) {
    const totalSecs = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hrs > 0) {
        return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

function pickImage(images, preferredWidth = 300) {
    if (!Array.isArray(images) || images.length === 0) return '';
    const valid = images.filter((im) => im && im.url);
    if (!valid.length) return '';
    const sorted = valid.slice().sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0));
    let best = sorted[0];
    let bestDiff = Math.abs((Number(best.width) || 640) - preferredWidth);
    for (const im of sorted) {
        const diff = Math.abs((Number(im.width) || 300) - preferredWidth);
        if (diff < bestDiff) {
            best = im;
            bestDiff = diff;
        }
    }
    return best.url || '';
}

function artistsText(track) {
    if (!track || !Array.isArray(track.artists)) return '';
    return track.artists.map((a) => a && a.name).filter(Boolean).join(', ');
}

function loadPins() {
    try {
        const raw = JSON.parse(localStorage.getItem(PINS_KEY) || 'null');
        if (!Array.isArray(raw)) return [];
        return raw.filter((p) => p && p.uri && p.name).slice(0, MAX_PINS);
    } catch (_) {
        return [];
    }
}

function savePins(pins) {
    try {
        localStorage.setItem(PINS_KEY, JSON.stringify((pins || []).slice(0, MAX_PINS)));
    } catch (_) {}
}

function loadPrefs() {
    try {
        const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
        return {
            practiceHaze: raw && typeof raw.practiceHaze === 'boolean' ? raw.practiceHaze : true,
            preferredDeviceId: (raw && typeof raw.preferredDeviceId === 'string') ? raw.preferredDeviceId : null,
        };
    } catch (_) {
        return { practiceHaze: true, preferredDeviceId: null };
    }
}

function savePrefs(prefs) {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (_) {}
}

const state = {
    initialized: false,
    connected: authIsConnected(),
    deckOpen: false,
    drownOpen: false,
    deviceMenuOpen: false,
    activeTab: 'playlists',
    pins: loadPins(),
    prefs: loadPrefs(),
    me: null,
    devices: [],
    playback: {
        item: null,
        isPlaying: false,
        progressMs: 0,
        durationMs: 0,
        repeatState: 'off',
        shuffleState: false,
        device: null,
        contextUri: null,
        contextType: null,
        updatedAt: Date.now(),
    },
    isSaved: null,
    savedCheckUri: '',
    statusBanner: null, // { text, kind, showOpenApp }
    toastMsg: '',
    detailView: null, // { kind: 'playlist'|'album', id, uri, name, sub, image, items, total, nextOffset, loading, filter }
    playlistFilter: '',
    playlists: { items: [], total: 0, nextOffset: 0, loaded: false, loading: false, error: '' },
    rotation: { recent: [], top: [], loaded: false, loading: false, error: '' },
    liked: { items: [], total: 0, nextOffset: 0, loaded: false, loading: false, error: '' },
    queue: { current: null, items: [], loaded: false, loading: false, error: '' },
    search: { query: '', tracks: [], playlists: [], albums: [], loading: false, ranQuery: '', error: '' },
    playlistPicker: { open: false, trackUri: '', trackName: '' },
    setupError: '',
    setupClientId: getClientId(),
    scrubDragging: false,
    volumeDragging: false,
};

const dom = {
    voidAnchor: null,
    floatPill: null,
    pqHaze: null,
    drownOverlay: null,
    deckBackdrop: null,
    deckDrawer: null,
};

let _pollTimer = null;
let _tickTimer = null;
let _searchDebounce = null;
let _toastTimer = null;
let _snapPolledForUri = '';
let _pollInFlight = false;
let _lastHeroSignature = '';
let _lastTabSignature = '';
let _lastDrownSignature = '';

function _isVoidActive() {
    return typeof document !== 'undefined' && document.body && document.body.classList.contains('hb-void-active');
}

function _isFlatlined() {
    const fl = document.getElementById('heartbeat-flatline-overlay');
    return Boolean(fl && fl.hidden === false);
}

function _getLiveProgressMs() {
    const pb = state.playback;
    if (!pb.item || !pb.durationMs) return 0;
    if (!pb.isPlaying) return Math.min(pb.durationMs, Math.max(0, pb.progressMs));
    const elapsed = Math.max(0, Date.now() - (pb.updatedAt || Date.now()));
    return Math.min(pb.durationMs, Math.max(0, pb.progressMs + elapsed));
}

function _setBanner(text, kind = 'info', opts = {}) {
    state.statusBanner = text ? { text, kind, showOpenApp: Boolean(opts.showOpenApp) } : null;
    if (state.deckOpen) _renderDeckHeroAndChrome();
}

function _showToast(msg) {
    state.toastMsg = msg || '';
    if (_toastTimer) clearTimeout(_toastTimer);
    if (state.deckOpen) {
        const el = dom.deckDrawer && dom.deckDrawer.querySelector('#sp-deck-toast');
        if (el) {
            el.textContent = state.toastMsg;
            el.hidden = !state.toastMsg;
        }
    }
    if (msg) {
        _toastTimer = setTimeout(() => {
            state.toastMsg = '';
            const el = dom.deckDrawer && dom.deckDrawer.querySelector('#sp-deck-toast');
            if (el) { el.textContent = ''; el.hidden = true; }
        }, 2600);
    }
}

function _applyCoverCssVar(coverUrl) {
    const clean = safeCssUrl(coverUrl);
    try {
        if (clean) {
            document.documentElement.style.setProperty('--sp-cover', `url("${clean}")`);
        } else {
            document.documentElement.style.removeProperty('--sp-cover');
        }
    } catch (_) {}

    if (dom.pqHaze) {
        const active = Boolean(state.connected && state.prefs.practiceHaze && clean);
        dom.pqHaze.classList.toggle('is-active', active);
    }
}

function _syncProgressElements() {
    const pb = state.playback;
    const dur = pb.durationMs || 0;
    const cur = _getLiveProgressMs();
    const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;

    if (dom.floatPill) {
        const fill = dom.floatPill.querySelector('.sp-float-prog-fill');
        if (fill) fill.style.width = `${pct.toFixed(2)}%`;
    }

    if (state.deckOpen && dom.deckDrawer) {
        const curEl = dom.deckDrawer.querySelector('#sp-cur-time');
        const durEl = dom.deckDrawer.querySelector('#sp-dur-time');
        const slider = dom.deckDrawer.querySelector('#sp-seek-range');
        if (curEl) curEl.textContent = fmtTime(cur);
        if (durEl) durEl.textContent = fmtTime(dur);
        if (slider && !state.scrubDragging) {
            slider.value = String(Math.round(pct * 10));
            slider.style.setProperty('--sp-prog', `${pct.toFixed(2)}%`);
        }
    }

    if (state.drownOpen && dom.drownOverlay) {
        const curEl = dom.drownOverlay.querySelector('#sp-drown-cur');
        const durEl = dom.drownOverlay.querySelector('#sp-drown-dur');
        const slider = dom.drownOverlay.querySelector('#sp-drown-seek');
        if (curEl) curEl.textContent = fmtTime(cur);
        if (durEl) durEl.textContent = fmtTime(dur);
        if (slider && !state.scrubDragging) {
            slider.value = String(Math.round(pct * 10));
            slider.style.setProperty('--sp-prog', `${pct.toFixed(2)}%`);
        }
    }
}

function _syncVoidAnchor() {
    if (!dom.voidAnchor) return;
    if (!state.connected) {
        dom.voidAnchor.innerHTML = `
            <button type="button" class="sp-void-pill" data-sp-act="open-deck" title="Connect Spotify (Alt+Shift+M)">
                <span class="sp-void-ico">${SVG_LOGO}</span>
                <span>SPOTIFY</span>
            </button>`;
        return;
    }

    const pb = state.playback;
    const item = pb.item;
    const cover = item && item.album ? pickImage(item.album.images, 120) : '';
    const title = item ? item.name : 'SPOTIFY READY';
    const sub = item
        ? (artistsText(item) || (pb.device ? pb.device.name : ''))
        : (pb.device ? pb.device.name : 'OPEN DECK');

    dom.voidAnchor.innerHTML = `
        <div class="sp-void-bar ${pb.isPlaying ? 'is-playing' : ''}">
            ${cover
                ? `<button type="button" class="sp-void-art-btn" data-sp-act="void-cover" title="${pb.isPlaying ? 'Enter Drown Mode' : 'Open Spotify Deck'}"><img src="${escHtml(cover)}" alt="" loading="lazy"></button>`
                : `<button type="button" class="sp-void-art-btn sp-void-art-empty" data-sp-act="open-deck" title="Open Spotify Deck">${SVG_LOGO}</button>`
            }
            <button type="button" class="sp-void-meta" data-sp-act="open-deck" title="Open Spotify Deck (Alt+Shift+M)">
                <span class="sp-void-title">${escHtml(title)}</span>
                <span class="sp-void-sub">${escHtml(sub)}</span>
            </button>
            <button type="button" class="sp-void-ctrl" data-sp-act="toggle-play" aria-label="${pb.isPlaying ? 'Pause' : 'Play'}">
                ${pb.isPlaying ? SVG_PAUSE : SVG_PLAY}
            </button>
        </div>`;
}

function _syncFloatPill() {
    if (!dom.floatPill) return;
    const hide = _isFlatlined();
    if (dom.floatPill.hidden !== hide) dom.floatPill.hidden = hide;

    if (!state.connected) {
        dom.floatPill.classList.remove('is-connected', 'is-playing');
        dom.floatPill.innerHTML = `
            <button type="button" class="sp-float-ghost" data-sp-act="open-deck" aria-label="Open Spotify Deck" title="Spotify (Alt+Shift+M)">
                <span class="sp-float-ico">${SVG_LOGO}</span>
            </button>`;
        return;
    }

    const pb = state.playback;
    const item = pb.item;
    const cover = item && item.album ? pickImage(item.album.images, 64) : '';
    const title = item ? item.name : 'Spotify Idle';
    const isTrackLoop = pb.repeatState === 'track';

    dom.floatPill.classList.add('is-connected');
    dom.floatPill.classList.toggle('is-playing', Boolean(pb.isPlaying));

    dom.floatPill.innerHTML = `
        <div class="sp-float-inner">
            <button type="button" class="sp-float-open" data-sp-act="open-deck" title="Open Spotify Deck (Alt+Shift+M)">
                ${cover
                    ? `<img class="sp-float-art" src="${escHtml(cover)}" alt="">`
                    : `<span class="sp-float-art sp-float-art-empty">${SVG_LOGO}</span>`
                }
                <span class="sp-float-title">${escHtml(title)}</span>
                ${isTrackLoop ? '<span class="sp-float-loop-tag" title="Track Loop Active">1</span>' : ''}
            </button>
            <div class="sp-float-ctrls">
                <button type="button" class="sp-float-btn" data-sp-act="prev" aria-label="Previous track">${SVG_PREV}</button>
                <button type="button" class="sp-float-btn sp-float-play" data-sp-act="toggle-play" aria-label="${pb.isPlaying ? 'Pause' : 'Play'}">${pb.isPlaying ? SVG_PAUSE : SVG_PLAY}</button>
                <button type="button" class="sp-float-btn" data-sp-act="next" aria-label="Next track">${SVG_NEXT}</button>
            </div>
        </div>
        <div class="sp-float-prog"><div class="sp-float-prog-fill"></div></div>`;

    _syncProgressElements();
}

function _syncDrownOverlay() {
    if (!dom.drownOverlay) return;
    const shouldShow = Boolean(state.drownOpen && state.connected);
    dom.drownOverlay.hidden = !shouldShow;
    try {
        document.body.classList.toggle('sp-drown-active', shouldShow);
    } catch (_) {}
    if (!shouldShow) return;

    const pb = state.playback;
    const item = pb.item;
    const cover = item && item.album ? pickImage(item.album.images, 640) : '';
    const sig = [
        item ? item.uri : 'none',
        pb.isPlaying ? 1 : 0,
        pb.repeatState,
        state.isSaved ? 1 : 0,
        pb.device ? pb.device.name : '',
    ].join('|');

    if (sig === _lastDrownSignature && dom.drownOverlay.innerHTML) {
        _syncProgressElements();
        return;
    }
    _lastDrownSignature = sig;

    const title = item ? item.name : 'Nothing playing';
    const sub = item ? `${artistsText(item)}${item.album && item.album.name ? ` — ${item.album.name}` : ''}` : 'Start playback from Deck or Spotify';
    const isTrackLoop = pb.repeatState === 'track';

    dom.drownOverlay.innerHTML = `
        <div class="sp-drown-haze" aria-hidden="true"></div>
        <div class="sp-drown-top">
            <span class="sp-drown-kicker">KLSR // FLOW DRIFT</span>
            <div class="sp-drown-top-actions">
                <button type="button" class="sp-drown-chip" data-sp-act="open-deck">DECK</button>
                <button type="button" class="sp-drown-chip" data-sp-act="exit-drown">EXIT</button>
            </div>
        </div>
        <div class="sp-drown-stage">
            <div class="sp-drown-art-wrap">
                ${cover
                    ? `<img class="sp-drown-art ${pb.isPlaying ? 'is-playing' : ''}" src="${escHtml(cover)}" alt="">`
                    : `<div class="sp-drown-art sp-drown-art-empty">${SVG_LOGO}</div>`
                }
            </div>
            <div class="sp-drown-meta">
                <div class="sp-drown-title">${escHtml(title)}</div>
                <div class="sp-drown-sub">${escHtml(sub)}</div>
            </div>
            <div class="sp-drown-seek-wrap">
                <span class="sp-time" id="sp-drown-cur">${fmtTime(_getLiveProgressMs())}</span>
                <input type="range" class="sp-range" id="sp-drown-seek" min="0" max="1000" value="0" aria-label="Seek track">
                <span class="sp-time" id="sp-drown-dur">${fmtTime(pb.durationMs)}</span>
            </div>
            <div class="sp-drown-transport">
                <button type="button" class="sp-drown-btn ${isTrackLoop ? 'is-active' : ''}" data-sp-act="toggle-loop" title="Loop current track" aria-pressed="${isTrackLoop}">${SVG_LOOP}</button>
                <button type="button" class="sp-drown-btn" data-sp-act="prev" aria-label="Previous">${SVG_PREV}</button>
                <button type="button" class="sp-drown-btn sp-drown-play" data-sp-act="toggle-play" aria-label="${pb.isPlaying ? 'Pause' : 'Play'}">${pb.isPlaying ? SVG_PAUSE : SVG_PLAY}</button>
                <button type="button" class="sp-drown-btn" data-sp-act="next" aria-label="Next">${SVG_NEXT}</button>
                <button type="button" class="sp-drown-btn ${state.isSaved ? 'is-active' : ''}" data-sp-act="toggle-save" title="${state.isSaved ? 'Remove from Liked' : 'Save to Liked'}" ${!item ? 'disabled' : ''}>${state.isSaved ? SVG_HEART_FILL : SVG_HEART}</button>
            </div>
            ${pb.device ? `<div class="sp-drown-device">${escHtml(pb.device.name)}</div>` : ''}
        </div>`;

    _syncProgressElements();
}

function _renderDisconnectedDeck() {
    if (!dom.deckDrawer) return;
    const redirectUri = getRedirectUri();
    const localhostBad = isLocalhostUnsupported();
    const savedId = state.setupClientId || getClientId();

    dom.deckDrawer.innerHTML = `
        <div class="sp-deck-haze" aria-hidden="true"></div>
        <div class="sp-deck-shell sp-deck-setup">
            <header class="sp-deck-head">
                <div class="sp-deck-brand">${SVG_LOGO}<span>SPOTIFY // CONNECT</span></div>
                <button type="button" class="sp-icon-btn" data-sp-act="close-deck" aria-label="Close Spotify Deck">✕</button>
            </header>
            <div class="sp-setup-body">
                <h2 class="sp-setup-title">Wire Your Real Spotify</h2>
                <p class="sp-setup-desc">Zero-backend PKCE OAuth. Controls your native Spotify app via Connect — AirPods &amp; lock screen stay rock-solid.</p>

                ${localhostBad ? `
                    <div class="sp-warn-box">
                        <strong>Localhost Blocked by Spotify (2026):</strong> Open this app via <code>http://127.0.0.1:${escHtml(window.location.port || '8123')}${escHtml(window.location.pathname)}</code> or your HTTPS GitHub Pages URL before signing in.
                    </div>
                ` : ''}

                ${state.setupError ? `<div class="sp-err-box">${escHtml(state.setupError)}</div>` : ''}

                <div class="sp-setup-card">
                    <div class="sp-step-kicker">1 // ADD THIS EXACT REDIRECT URI IN SPOTIFY DASHBOARD</div>
                    <div class="sp-uri-row">
                        <code class="sp-uri-code" id="sp-redirect-uri-code">${escHtml(redirectUri)}</code>
                        <button type="button" class="sp-mini-pill" data-sp-act="copy-redirect" id="sp-copy-redirect-btn">COPY</button>
                    </div>
                    <ol class="sp-steps">
                        <li>Open <strong>developer.spotify.com/dashboard</strong> → Create App (requires Spotify Premium).</li>
                        <li>Enable <strong>Web API</strong> and paste the exact Redirect URI above.</li>
                        <li>Copy your public <strong>Client ID</strong> below (no Client Secret needed).</li>
                    </ol>
                </div>

                <form class="sp-setup-form" id="sp-setup-form">
                    <label class="sp-field-label" for="sp-client-id-input">SPOTIFY CLIENT ID</label>
                    <input type="text" id="sp-client-id-input" class="sp-input" value="${escHtml(savedId)}" placeholder="32-character Client ID…" autocomplete="off" spellcheck="false">
                    <button type="submit" class="sp-primary-btn" id="sp-connect-btn" ${localhostBad ? 'disabled' : ''}>CONNECT SPOTIFY</button>
                </form>

                <div class="sp-setup-foot">
                    <span>Only your Spotify session &amp; 4 quick-pins are stored locally.</span>
                </div>
            </div>
        </div>`;
}

function _buildHeroAndChromeHtml() {
    const pb = state.playback;
    const item = pb.item;
    const cover = item && item.album ? pickImage(item.album.images, 300) : '';
    const activeDev = pb.device || state.devices.find((d) => d.is_active) || null;
    const devLabel = activeDev ? activeDev.name : (state.devices.length ? 'Select device' : 'No active device');
    const isTrackLoop = pb.repeatState === 'track';
    const isContextLoop = pb.repeatState === 'context';
    const showVolume = !activeDev || activeDev.supports_volume !== false;
    const volVal = activeDev && Number.isFinite(Number(activeDev.volume_percent)) ? Number(activeDev.volume_percent) : 80;
    const inVoid = _isVoidActive();
    const hbYielding = Boolean(HeartbeatAudio && HeartbeatAudio.isSpotifyYielding && HeartbeatAudio.isSpotifyYielding());
    const hbEnabled = Boolean(HeartbeatAudio && HeartbeatAudio.isEnabled && HeartbeatAudio.isEnabled());

    const pinsHtml = [0, 1, 2, 3].map((idx) => {
        const pin = state.pins[idx];
        if (!pin) {
            return `
                <button type="button" class="sp-pin-slot is-empty" data-sp-act="pin-slot" data-slot="${idx}" title="Pin current playlist or track">
                    <span class="sp-pin-plus">+</span>
                    <span class="sp-pin-lbl">PIN ${idx + 1}</span>
                </button>`;
        }
        const kindTag = pin.kind === 'playlist' ? 'PL' : (pin.kind === 'album' ? 'AL' : 'TR');
        return `
            <div class="sp-pin-slot is-filled" data-slot="${idx}">
                <button type="button" class="sp-pin-hit" data-sp-act="play-pin" data-slot="${idx}" title="Play ${escHtml(pin.name)}">
                    ${pin.image
                        ? `<img class="sp-pin-art" src="${escHtml(pin.image)}" alt="">`
                        : `<span class="sp-pin-art sp-pin-art-empty">${kindTag}</span>`
                    }
                    <span class="sp-pin-meta">
                        <span class="sp-pin-name">${escHtml(pin.name)}</span>
                        <span class="sp-pin-kind">${kindTag}</span>
                    </span>
                </button>
                <button type="button" class="sp-pin-del" data-sp-act="unpin-slot" data-slot="${idx}" aria-label="Remove pin ${escHtml(pin.name)}">×</button>
            </div>`;
    }).join('');

    const albumId = item && item.album && item.album.id ? item.album.id : '';
    const albumName = item && item.album && item.album.name ? item.album.name : '';

    return {
        headHtml: `
            <div class="sp-head-left">
                <div class="sp-dev-wrap">
                    <button type="button" class="sp-dev-btn ${activeDev ? 'is-online' : ''}" id="sp-device-btn" data-sp-act="toggle-devices" aria-expanded="${state.deviceMenuOpen}">
                        <span class="sp-dev-dot"></span>
                        <span class="sp-dev-name">${escHtml(devLabel)}</span>
                        <span class="sp-caret">▾</span>
                    </button>
                    <div class="sp-dev-menu" id="sp-device-menu" ${state.deviceMenuOpen ? '' : 'hidden'}>
                        ${state.devices.length
                            ? state.devices.map((d) => `
                                <button type="button" class="sp-dev-item ${d.is_active ? 'is-active' : ''}" data-sp-act="select-device" data-device-id="${escHtml(d.id)}">
                                    <span>${escHtml(d.name)}</span>
                                    <span class="sp-dev-type">${escHtml(d.type || '')}${d.is_active ? ' · LIVE' : ''}</span>
                                </button>`).join('')
                            : '<div class="sp-dev-empty">No Spotify devices online. Open Spotify once on your iPad, phone, or PC.</div>'
                        }
                        <div class="sp-dev-actions">
                            <button type="button" class="sp-mini-pill" data-sp-act="refresh-devices">↻ SCAN</button>
                            <a class="sp-mini-pill" href="spotify:" target="_blank" rel="noopener">OPEN SPOTIFY</a>
                        </div>
                    </div>
                </div>
            </div>
            <div class="sp-head-right">
                <button type="button" class="sp-mini-pill ${state.prefs.practiceHaze ? 'is-on' : ''}" data-sp-act="toggle-haze" aria-pressed="${state.prefs.practiceHaze}" title="Toggle subtle album haze in Practice">HAZE</button>
                ${inVoid ? '<button type="button" class="sp-mini-pill" data-sp-act="enter-drown" title="Fullscreen Void Drown Mode">DROWN</button>' : ''}
                <button type="button" class="sp-icon-btn" data-sp-act="close-deck" aria-label="Close Spotify Deck">✕</button>
            </div>`,
        bannerHtml: state.statusBanner ? `
            <div class="sp-banner is-${escHtml(state.statusBanner.kind || 'info')}">
                <span>${escHtml(state.statusBanner.text)}</span>
                <div class="sp-banner-acts">
                    ${state.statusBanner.showOpenApp ? '<a class="sp-mini-pill" href="spotify:" target="_blank" rel="noopener">OPEN SPOTIFY</a>' : ''}
                    <button type="button" class="sp-banner-x" data-sp-act="dismiss-banner" aria-label="Dismiss">✕</button>
                </div>
            </div>` : '',
        heroHtml: `
            <div class="sp-hero-main">
                <div class="sp-hero-art-box">
                    ${cover
                        ? `<img class="sp-hero-art ${pb.isPlaying ? 'is-playing' : ''}" src="${escHtml(cover)}" alt="" ${inVoid ? 'data-sp-act="enter-drown" title="Open Drown Mode"' : ''}>`
                        : `<div class="sp-hero-art sp-hero-art-empty">${SVG_LOGO}</div>`
                    }
                </div>
                <div class="sp-hero-info">
                    <div class="sp-hero-title">${escHtml(item ? item.name : 'Nothing Playing')}</div>
                    <div class="sp-hero-artist">${escHtml(item ? artistsText(item) : 'Pick a playlist, search, or hit play on Spotify')}</div>
                    ${albumName ? (albumId
                        ? `<button type="button" class="sp-hero-album" data-sp-act="open-album" data-album-id="${escHtml(albumId)}">${escHtml(albumName)} →</button>`
                        : `<div class="sp-hero-album-static">${escHtml(albumName)}</div>`) : ''}
                </div>
            </div>
            <div class="sp-seek-row">
                <span class="sp-time" id="sp-cur-time">${fmtTime(_getLiveProgressMs())}</span>
                <input type="range" class="sp-range" id="sp-seek-range" min="0" max="1000" value="0" aria-label="Seek track" ${!item ? 'disabled' : ''}>
                <span class="sp-time" id="sp-dur-time">${fmtTime(pb.durationMs)}</span>
            </div>
            <div class="sp-transport-row">
                <button type="button" class="sp-tbtn ${pb.shuffleState ? 'is-active' : ''}" data-sp-act="toggle-shuffle" title="Shuffle" aria-pressed="${pb.shuffleState}">${SVG_SHUFFLE}</button>
                <button type="button" class="sp-tbtn" data-sp-act="prev" aria-label="Previous">${SVG_PREV}</button>
                <button type="button" class="sp-tbtn sp-tbtn-play" data-sp-act="toggle-play" aria-label="${pb.isPlaying ? 'Pause' : 'Play'}">${pb.isPlaying ? SVG_PAUSE : SVG_PLAY}</button>
                <button type="button" class="sp-tbtn" data-sp-act="next" aria-label="Next">${SVG_NEXT}</button>
                <button type="button" class="sp-tbtn sp-tbtn-loop ${isTrackLoop ? 'is-loop-track' : (isContextLoop ? 'is-loop-ctx' : '')}" data-sp-act="toggle-loop" title="${isTrackLoop ? 'Track Loop Locked (Alt+Shift+L)' : 'Loop Current Track (Alt+Shift+L)'}" aria-pressed="${isTrackLoop}">
                    ${SVG_LOOP}
                    <span>${isTrackLoop ? 'LOOP' : (isContextLoop ? 'CTX' : 'LOOP')}</span>
                </button>
            </div>
            <div class="sp-hero-actions">
                <button type="button" class="sp-act-pill ${state.isSaved ? 'is-saved' : ''}" data-sp-act="toggle-save" ${!item ? 'disabled' : ''} title="${state.isSaved ? 'Remove from Liked Songs' : 'Save to Liked Songs'}">
                    ${state.isSaved ? SVG_HEART_FILL : SVG_HEART}
                    <span>${state.isSaved ? 'SAVED' : 'SAVE'}</span>
                </button>
                <button type="button" class="sp-act-pill" data-sp-act="open-playlist-picker" ${!item || !item.uri ? 'disabled' : ''} title="Add current track to a playlist">
                    <span>+ PLAYLIST</span>
                </button>
                <button type="button" class="sp-act-pill" data-sp-act="pin-current" ${!item && !pb.contextUri ? 'disabled' : ''} title="Pin to quick-launch slots">
                    <span>PIN</span>
                </button>
                ${showVolume ? `
                    <div class="sp-vol-wrap" title="Device volume">
                        <span class="sp-vol-lbl">VOL</span>
                        <input type="range" class="sp-range sp-vol-range" id="sp-vol-range" min="0" max="100" value="${volVal}" aria-label="Spotify volume">
                    </div>` : ''}
            </div>
            <div class="sp-pins-row" aria-label="Quick Pins">${pinsHtml}</div>`,
        footHtml: `
            <div class="sp-foot-audio">
                ${hbYielding
                    ? `<span class="sp-foot-status is-yield">VOID AUDIO: YIELDED</span>
                       <button type="button" class="sp-mini-pill" data-sp-act="reclaim-void-audio">RECLAIM VOID</button>`
                    : `<span class="sp-foot-status">VOID AUDIO: ${hbEnabled ? 'ACTIVE' : 'MUTED'}</span>`
                }
            </div>
            <button type="button" class="sp-mini-pill sp-danger-pill" data-sp-act="disconnect">DISCONNECT</button>`,
    };
}

function _renderTrackRow(track, opts = {}) {
    if (!track || !track.uri) return '';
    const cover = track.album ? pickImage(track.album.images, 64) : '';
    const artists = artistsText(track);
    const isNow = state.playback.item && state.playback.item.uri === track.uri;
    const playAct = opts.playAct || 'play-track-uri';
    const extraAttrs = opts.extraAttrs || '';

    return `
        <div class="sp-row ${isNow ? 'is-now' : ''}">
            <button type="button" class="sp-row-main" data-sp-act="${playAct}" data-uri="${escHtml(track.uri)}" ${extraAttrs}>
                ${cover
                    ? `<img class="sp-row-art" src="${escHtml(cover)}" alt="" loading="lazy">`
                    : `<span class="sp-row-art sp-row-art-empty">♪</span>`
                }
                <span class="sp-row-text">
                    <span class="sp-row-title">${escHtml(track.name)}</span>
                    <span class="sp-row-sub">${escHtml(artists)}${track.album && track.album.name ? ` · ${escHtml(track.album.name)}` : ''}</span>
                </span>
            </button>
            <span class="sp-row-dur">${fmtTime(track.duration_ms)}</span>
            <button type="button" class="sp-row-q" data-sp-act="queue-uri" data-uri="${escHtml(track.uri)}" data-name="${escHtml(track.name)}" title="Add to Queue">+Q</button>
        </div>`;
}

function _renderDetailViewHtml(dv) {
    const cover = dv.image || '';
    const filterVal = (dv.filter || '').trim().toLowerCase();
    const allItems = dv.items || [];
    const filtered = filterVal
        ? allItems.filter((it) => {
            const name = (it.name || '').toLowerCase();
            const art = artistsText(it).toLowerCase();
            return name.includes(filterVal) || art.includes(filterVal);
        })
        : allItems;

    const listHtml = dv.loading && !allItems.length
        ? '<div class="sp-empty">Loading tracks…</div>'
        : (filtered.length
            ? filtered.map((t) => _renderTrackRow(t, {
                playAct: 'play-detail-track',
                extraAttrs: `data-context-uri="${escHtml(dv.uri)}"`,
            })).join('')
            : `<div class="sp-empty">${filterVal ? 'No tracks match your filter.' : 'No playable tracks found.'}</div>`);

    const canLoadMore = !dv.loading && dv.nextOffset > 0 && dv.nextOffset < dv.total;

    return `
        <div class="sp-detail">
            <div class="sp-detail-head">
                <button type="button" class="sp-mini-pill" data-sp-act="detail-back">← BACK</button>
                <div class="sp-detail-acts">
                    <button type="button" class="sp-mini-pill is-on" data-sp-act="play-context" data-uri="${escHtml(dv.uri)}">▶ PLAY</button>
                    <button type="button" class="sp-mini-pill" data-sp-act="play-context-shuffle" data-uri="${escHtml(dv.uri)}">SHUFFLE</button>
                    <button type="button" class="sp-mini-pill" data-sp-act="pin-entity" data-uri="${escHtml(dv.uri)}" data-kind="${escHtml(dv.kind)}" data-name="${escHtml(dv.name)}" data-sub="${escHtml(dv.sub || '')}" data-image="${escHtml(cover)}">PIN</button>
                </div>
            </div>
            <div class="sp-detail-banner">
                ${cover
                    ? `<img class="sp-detail-art" src="${escHtml(cover)}" alt="">`
                    : `<div class="sp-detail-art sp-row-art-empty">${SVG_LOGO}</div>`
                }
                <div class="sp-detail-meta">
                    <div class="sp-detail-kicker">${dv.kind === 'album' ? 'ALBUM' : 'PLAYLIST'} · ${dv.total || allItems.length} TRACKS</div>
                    <div class="sp-detail-title">${escHtml(dv.name)}</div>
                    ${dv.sub ? `<div class="sp-detail-sub">${escHtml(dv.sub)}</div>` : ''}
                </div>
            </div>
            <div class="sp-inline-search">
                <input type="text" class="sp-input sp-input-sm" id="sp-detail-filter" value="${escHtml(dv.filter || '')}" placeholder="Filter tracks in ${escHtml(dv.name)}…" autocomplete="off">
            </div>
            <div class="sp-rows" id="sp-detail-rows">${listHtml}</div>
            ${canLoadMore ? `<button type="button" class="sp-load-more" data-sp-act="detail-more">${dv.loading ? 'LOADING…' : `LOAD MORE (${allItems.length}/${dv.total})`}</button>` : ''}
        </div>`;
}

function _buildTabBodyHtml() {
    if (state.detailView) {
        return _renderDetailViewHtml(state.detailView);
    }

    if (state.activeTab === 'playlists') {
        const st = state.playlists;
        if (st.error) return `<div class="sp-empty">${escHtml(st.error)} <button type="button" class="sp-mini-pill" data-sp-act="reload-tab">RETRY</button></div>`;
        if (st.loading && !st.items.length) return '<div class="sp-empty">Loading your playlists…</div>';

        const q = state.playlistFilter.trim().toLowerCase();
        const list = q ? st.items.filter((pl) => (pl.name || '').toLowerCase().includes(q)) : st.items;
        const canMore = !st.loading && st.nextOffset > 0 && st.nextOffset < st.total;

        return `
            <div class="sp-inline-search">
                <input type="text" class="sp-input sp-input-sm" id="sp-playlist-filter" value="${escHtml(state.playlistFilter)}" placeholder="Filter your playlists…" autocomplete="off">
            </div>
            <div class="sp-rows">
                ${list.length ? list.map((pl) => {
                    const img = pickImage(pl.images, 120);
                    const total = (pl.items && pl.items.total) ?? (pl.tracks && pl.tracks.total) ?? 0;
                    const owner = pl.owner && pl.owner.display_name ? pl.owner.display_name : '';
                    return `
                        <div class="sp-row">
                            <button type="button" class="sp-row-main" data-sp-act="open-playlist" data-playlist-id="${escHtml(pl.id)}">
                                ${img
                                    ? `<img class="sp-row-art" src="${escHtml(img)}" alt="" loading="lazy">`
                                    : `<span class="sp-row-art sp-row-art-empty">♪</span>`
                                }
                                <span class="sp-row-text">
                                    <span class="sp-row-title">${escHtml(pl.name)}</span>
                                    <span class="sp-row-sub">${total} tracks${owner ? ` · ${escHtml(owner)}` : ''}</span>
                                </span>
                            </button>
                            <button type="button" class="sp-row-q" data-sp-act="play-context" data-uri="${escHtml(pl.uri)}" title="Play playlist">▶</button>
                        </div>`;
                }).join('') : '<div class="sp-empty">No playlists match.</div>'}
            </div>
            ${canMore ? `<button type="button" class="sp-load-more" data-sp-act="playlists-more">LOAD MORE (${st.items.length}/${st.total})</button>` : ''}`;
    }

    if (state.activeTab === 'rotation') {
        const st = state.rotation;
        if (st.error) return `<div class="sp-empty">${escHtml(st.error)} <button type="button" class="sp-mini-pill" data-sp-act="reload-tab">RETRY</button></div>`;
        if (st.loading && !st.recent.length && !st.top.length) return '<div class="sp-empty">Loading your rotation…</div>';

        const recentHtml = st.recent.length
            ? st.recent.map((t, i) => _renderTrackRow(t, { playAct: 'play-list-track', extraAttrs: `data-list="recent" data-idx="${i}"` })).join('')
            : '<div class="sp-empty">No recent tracks yet.</div>';
        const topHtml = st.top.length
            ? st.top.map((t, i) => _renderTrackRow(t, { playAct: 'play-list-track', extraAttrs: `data-list="top" data-idx="${i}"` })).join('')
            : '<div class="sp-empty">No top tracks available yet.</div>';

        return `
            <div class="sp-group-title">RECENTLY PLAYED</div>
            <div class="sp-rows">${recentHtml}</div>
            <div class="sp-group-title">HEAVY ROTATION</div>
            <div class="sp-rows">${topHtml}</div>`;
    }

    if (state.activeTab === 'liked') {
        const st = state.liked;
        if (st.error) return `<div class="sp-empty">${escHtml(st.error)} <button type="button" class="sp-mini-pill" data-sp-act="reload-tab">RETRY</button></div>`;
        if (st.loading && !st.items.length) return '<div class="sp-empty">Loading Liked Songs…</div>';

        const rowsHtml = st.items.length
            ? st.items.map((t, i) => _renderTrackRow(t, { playAct: 'play-list-track', extraAttrs: `data-list="liked" data-idx="${i}"` })).join('')
            : '<div class="sp-empty">Your Liked Songs list is empty.</div>';
        const canMore = !st.loading && st.nextOffset > 0 && st.nextOffset < st.total;

        return `
            <div class="sp-rows">${rowsHtml}</div>
            ${canMore ? `<button type="button" class="sp-load-more" data-sp-act="liked-more">LOAD MORE (${st.items.length}/${st.total})</button>` : ''}`;
    }

    if (state.activeTab === 'queue') {
        const st = state.queue;
        if (st.error) return `<div class="sp-empty">${escHtml(st.error)} <button type="button" class="sp-mini-pill" data-sp-act="reload-tab">RETRY</button></div>`;
        if (st.loading && !st.loaded) return '<div class="sp-empty">Reading live queue…</div>';

        const upNext = st.items.filter((t) => t && t.uri);
        return `
            <div class="sp-queue-head">
                <span class="sp-group-title">LIVE QUEUE</span>
                <button type="button" class="sp-mini-pill" data-sp-act="reload-tab">↻ REFRESH</button>
            </div>
            ${st.current ? `
                <div class="sp-sub-kicker">NOW</div>
                <div class="sp-rows">${_renderTrackRow(st.current)}</div>` : ''}
            <div class="sp-sub-kicker">UP NEXT (${upNext.length})</div>
            <div class="sp-rows">
                ${upNext.length
                    ? upNext.map((t) => _renderTrackRow(t)).join('')
                    : '<div class="sp-empty">Queue is empty. Tap +Q on any track to line it up.</div>'}
            </div>`;
    }

    if (state.activeTab === 'search') {
        const st = state.search;
        let body = '';
        if (st.loading) {
            body = '<div class="sp-empty">Searching Spotify…</div>';
        } else if (st.error) {
            body = `<div class="sp-empty">${escHtml(st.error)}</div>`;
        } else if (!st.ranQuery) {
            body = '<div class="sp-empty">Search tracks, albums, or playlists without leaving the app.</div>';
        } else if (!st.tracks.length && !st.playlists.length && !st.albums.length) {
            body = `<div class="sp-empty">No results for "${escHtml(st.ranQuery)}".</div>`;
        } else {
            const tracksHtml = st.tracks.length
                ? `<div class="sp-group-title">TRACKS</div><div class="sp-rows">${st.tracks.map((t) => _renderTrackRow(t)).join('')}</div>`
                : '';
            const playlistsHtml = st.playlists.length
                ? `<div class="sp-group-title">PLAYLISTS</div><div class="sp-rows">${st.playlists.map((pl) => {
                    const img = pickImage(pl.images, 120);
                    return `
                        <div class="sp-row">
                            <button type="button" class="sp-row-main" data-sp-act="open-playlist" data-playlist-id="${escHtml(pl.id)}">
                                ${img ? `<img class="sp-row-art" src="${escHtml(img)}" alt="" loading="lazy">` : '<span class="sp-row-art sp-row-art-empty">♪</span>'}
                                <span class="sp-row-text">
                                    <span class="sp-row-title">${escHtml(pl.name)}</span>
                                    <span class="sp-row-sub">${escHtml(pl.owner && pl.owner.display_name ? pl.owner.display_name : 'Playlist')}</span>
                                </span>
                            </button>
                            <button type="button" class="sp-row-q" data-sp-act="play-context" data-uri="${escHtml(pl.uri)}" title="Play playlist">▶</button>
                        </div>`;
                }).join('')}</div>`
                : '';
            const albumsHtml = st.albums.length
                ? `<div class="sp-group-title">ALBUMS</div><div class="sp-rows">${st.albums.map((al) => {
                    const img = pickImage(al.images, 120);
                    return `
                        <div class="sp-row">
                            <button type="button" class="sp-row-main" data-sp-act="open-album" data-album-id="${escHtml(al.id)}">
                                ${img ? `<img class="sp-row-art" src="${escHtml(img)}" alt="" loading="lazy">` : '<span class="sp-row-art sp-row-art-empty">♪</span>'}
                                <span class="sp-row-text">
                                    <span class="sp-row-title">${escHtml(al.name)}</span>
                                    <span class="sp-row-sub">${escHtml(artistsText(al))}</span>
                                </span>
                            </button>
                            <button type="button" class="sp-row-q" data-sp-act="play-context" data-uri="${escHtml(al.uri)}" title="Play album">▶</button>
                        </div>`;
                }).join('')}</div>`
                : '';
            body = tracksHtml + playlistsHtml + albumsHtml;
        }

        return `
            <div class="sp-inline-search">
                <input type="text" class="sp-input sp-input-sm" id="sp-search-input" value="${escHtml(st.query)}" placeholder="Search songs, albums, playlists…" autocomplete="off">
            </div>
            <div id="sp-search-results">${body}</div>`;
    }

    return '';
}

function _buildPickerModalHtml() {
    if (!state.playlistPicker.open) return '';
    const meId = state.me && state.me.id ? state.me.id : '';
    const all = state.playlists.items || [];
    const editable = meId
        ? all.filter((pl) => pl && ((pl.owner && pl.owner.id === meId) || pl.collaborative))
        : all;

    return `
        <div class="sp-picker-overlay" id="sp-playlist-picker">
            <div class="sp-picker-card" role="dialog" aria-modal="true" aria-label="Add to playlist">
                <div class="sp-picker-head">
                    <div>
                        <div class="sp-picker-kicker">ADD TO PLAYLIST</div>
                        <div class="sp-picker-sub">${escHtml(state.playlistPicker.trackName)}</div>
                    </div>
                    <button type="button" class="sp-icon-btn" data-sp-act="close-playlist-picker" aria-label="Cancel">✕</button>
                </div>
                <div class="sp-picker-list">
                    ${state.playlists.loading && !all.length
                        ? '<div class="sp-empty">Loading playlists…</div>'
                        : (editable.length
                            ? editable.map((pl) => {
                                const img = pickImage(pl.images, 64);
                                return `
                                    <button type="button" class="sp-picker-row" data-sp-act="add-to-playlist" data-playlist-id="${escHtml(pl.id)}" data-playlist-name="${escHtml(pl.name)}">
                                        ${img ? `<img class="sp-row-art" src="${escHtml(img)}" alt="">` : '<span class="sp-row-art sp-row-art-empty">♪</span>'}
                                        <span class="sp-row-title">${escHtml(pl.name)}</span>
                                    </button>`;
                            }).join('')
                            : '<div class="sp-empty">No editable playlists found on your account.</div>')}
                </div>
            </div>
        </div>`;
}

function _renderDeckShell() {
    if (!dom.deckDrawer || !state.deckOpen) return;
    if (!state.connected) {
        _lastHeroSignature = '';
        _lastTabSignature = '';
        _renderDisconnectedDeck();
        return;
    }

    if (!dom.deckDrawer.querySelector('#sp-deck-connected-shell')) {
        dom.deckDrawer.innerHTML = `
            <div class="sp-deck-haze" aria-hidden="true"></div>
            <div class="sp-deck-shell" id="sp-deck-connected-shell">
                <header class="sp-deck-head" id="sp-deck-head"></header>
                <div id="sp-deck-banner"></div>
                <section class="sp-hero" id="sp-deck-hero"></section>
                <nav class="sp-tabs" id="sp-deck-tabs" aria-label="Spotify Library">
                    <button type="button" class="sp-tab" data-sp-tab="playlists">PLAYLISTS</button>
                    <button type="button" class="sp-tab" data-sp-tab="rotation">ROTATION</button>
                    <button type="button" class="sp-tab" data-sp-tab="liked">LIKED</button>
                    <button type="button" class="sp-tab" data-sp-tab="queue">QUEUE</button>
                    <button type="button" class="sp-tab" data-sp-tab="search">SEARCH</button>
                </nav>
                <div class="sp-tab-body" id="sp-tab-body"></div>
                <footer class="sp-deck-foot" id="sp-deck-foot"></footer>
                <div class="sp-deck-toast" id="sp-deck-toast" hidden></div>
                <div id="sp-picker-mount"></div>
            </div>`;
    }

    _renderDeckHeroAndChrome();
    _renderDeckTabBody();
    _renderPickerMount();
}

function _renderDeckHeroAndChrome() {
    if (!state.deckOpen || !state.connected || !dom.deckDrawer) return;
    const shell = dom.deckDrawer.querySelector('#sp-deck-connected-shell');
    if (!shell) return _renderDeckShell();

    const pb = state.playback;
    const item = pb.item;
    const hbYielding = Boolean(HeartbeatAudio && HeartbeatAudio.isSpotifyYielding && HeartbeatAudio.isSpotifyYielding());
    const hbEnabled = Boolean(HeartbeatAudio && HeartbeatAudio.isEnabled && HeartbeatAudio.isEnabled());

    const sig = JSON.stringify([
        item ? item.uri : null,
        pb.isPlaying,
        pb.repeatState,
        pb.shuffleState,
        pb.device ? `${pb.device.id}:${pb.device.volume_percent}:${pb.device.supports_volume}` : null,
        state.devices.map((d) => `${d.id}:${d.is_active}:${d.name}`).join(','),
        state.deviceMenuOpen,
        state.isSaved,
        state.pins.map((p) => p.uri).join(','),
        state.prefs.practiceHaze,
        _isVoidActive(),
        state.statusBanner ? state.statusBanner.text : null,
        hbYielding,
        hbEnabled,
    ]);

    if (sig !== _lastHeroSignature) {
        _lastHeroSignature = sig;
        const { headHtml, bannerHtml, heroHtml, footHtml } = _buildHeroAndChromeHtml();
        const headEl = shell.querySelector('#sp-deck-head');
        const bannerEl = shell.querySelector('#sp-deck-banner');
        const heroEl = shell.querySelector('#sp-deck-hero');
        const footEl = shell.querySelector('#sp-deck-foot');
        if (headEl) headEl.innerHTML = headHtml;
        if (bannerEl) bannerEl.innerHTML = bannerHtml;
        if (heroEl) heroEl.innerHTML = heroHtml;
        if (footEl) footEl.innerHTML = footHtml;
    }

    shell.querySelectorAll('.sp-tab').forEach((btn) => {
        btn.classList.toggle('is-active', btn.getAttribute('data-sp-tab') === state.activeTab && !state.detailView);
    });

    const toastEl = shell.querySelector('#sp-deck-toast');
    if (toastEl) {
        toastEl.textContent = state.toastMsg;
        toastEl.hidden = !state.toastMsg;
    }

    _syncProgressElements();
}

function _renderDeckTabBody(preserveInputFocus = false) {
    if (!state.deckOpen || !state.connected || !dom.deckDrawer) return;
    const bodyEl = dom.deckDrawer.querySelector('#sp-tab-body');
    if (!bodyEl) return;

    const focusId = preserveInputFocus && document.activeElement && bodyEl.contains(document.activeElement)
        ? document.activeElement.id
        : '';
    const selStart = focusId && typeof document.activeElement.selectionStart === 'number'
        ? document.activeElement.selectionStart
        : null;

    if (focusId === 'sp-search-input') {
        const resEl = bodyEl.querySelector('#sp-search-results');
        if (resEl) {
            const full = _buildTabBodyHtml();
            const tmp = document.createElement('div');
            tmp.innerHTML = full;
            const nextRes = tmp.querySelector('#sp-search-results');
            if (nextRes) {
                resEl.innerHTML = nextRes.innerHTML;
                return;
            }
        }
    }

    if (focusId === 'sp-playlist-filter' || focusId === 'sp-detail-filter') {
        const rowsTarget = focusId === 'sp-detail-filter' ? '#sp-detail-rows' : '.sp-rows';
        const curRows = bodyEl.querySelector(rowsTarget);
        if (curRows) {
            const tmp = document.createElement('div');
            tmp.innerHTML = _buildTabBodyHtml();
            const nextRows = tmp.querySelector(rowsTarget);
            if (nextRows) {
                curRows.innerHTML = nextRows.innerHTML;
                return;
            }
        }
    }

    bodyEl.innerHTML = _buildTabBodyHtml();

    if (focusId) {
        const inp = bodyEl.querySelector(`#${focusId}`);
        if (inp) {
            inp.focus();
            if (selStart !== null && typeof inp.setSelectionRange === 'function') {
                try { inp.setSelectionRange(selStart, selStart); } catch (_) {}
            }
        }
    }
}

function _renderPickerMount() {
    if (!state.deckOpen || !dom.deckDrawer) return;
    const mount = dom.deckDrawer.querySelector('#sp-picker-mount');
    if (mount) mount.innerHTML = _buildPickerModalHtml();
}

function _syncAllVisuals() {
    const cover = state.playback.item && state.playback.item.album
        ? pickImage(state.playback.item.album.images, 640)
        : '';
    _applyCoverCssVar(cover);
    _syncVoidAnchor();
    _syncFloatPill();
    if (state.drownOpen) _syncDrownOverlay();
    if (state.deckOpen) _renderDeckHeroAndChrome();
}

async function _syncSavedStatus(trackUri) {
    if (!trackUri || !state.connected) {
        state.isSaved = null;
        state.savedCheckUri = '';
        return;
    }
    if (state.savedCheckUri === trackUri && state.isSaved !== null) return;
    state.savedCheckUri = trackUri;
    try {
        const saved = await checkSaved(trackUri);
        if (state.savedCheckUri === trackUri) {
            state.isSaved = Boolean(saved);
            _syncAllVisuals();
        }
    } catch (_) {}
}

async function _pollPlayback({ includeDevices = false } = {}) {
    if (!state.connected || _pollInFlight || isRateLimited()) return;
    _pollInFlight = true;
    try {
        const pb = await getPlaybackState();
        const prevUri = state.playback.item ? state.playback.item.uri : '';

        if (!pb || typeof pb !== 'object') {
            state.playback = {
                ...state.playback,
                isPlaying: false,
                device: null,
                updatedAt: Date.now(),
            };
        } else {
            const nextItem = pb.item || null;
            state.playback = {
                item: nextItem,
                isPlaying: Boolean(pb.is_playing),
                progressMs: Number(pb.progress_ms) || 0,
                durationMs: Number(nextItem && nextItem.duration_ms) || 0,
                repeatState: pb.repeat_state || 'off',
                shuffleState: Boolean(pb.shuffle_state),
                device: pb.device || null,
                contextUri: (pb.context && pb.context.uri) || null,
                contextType: (pb.context && pb.context.type) || null,
                updatedAt: Date.now(),
            };
            if (pb.device && pb.device.id) {
                if (state.prefs.preferredDeviceId !== pb.device.id) {
                    state.prefs.preferredDeviceId = pb.device.id;
                    savePrefs(state.prefs);
                }
            }
            if (pb.is_playing && state.statusBanner && state.statusBanner.showOpenApp) {
                state.statusBanner = null;
            }
        }

        // Handoff rule: Spotify playing => yield Heartbeat background audio.
        // Pausing Spotify does NOT restart Heartbeat audio automatically.
        if (state.playback.isPlaying) {
            try { HeartbeatAudio.setSpotifyYield(true); } catch (_) {}
        }

        const nextUri = state.playback.item ? state.playback.item.uri : '';
        if (nextUri !== prevUri) {
            _snapPolledForUri = '';
            state.isSaved = null;
            state.savedCheckUri = '';
            if (nextUri) _syncSavedStatus(nextUri);
            if (state.deckOpen && state.activeTab === 'queue' && !state.detailView) {
                _loadQueue(true);
            }
        } else if (nextUri && state.isSaved === null) {
            _syncSavedStatus(nextUri);
        }

        if (includeDevices || state.deckOpen) {
            try {
                state.devices = await getDevices();
            } catch (_) {}
        }

        _syncAllVisuals();
    } catch (err) {
        if (err && err.code === 'AUTH_EXPIRED') {
            state.connected = false;
            state.setupError = err.message || 'Spotify session expired. Reconnect.';
            _stopTimers();
            _syncAllVisuals();
            if (state.deckOpen) _renderDeckShell();
        }
    } finally {
        _pollInFlight = false;
        _scheduleNextPoll();
    }
}

function _getPollIntervalMs() {
    if (!state.connected) return 0;
    if (typeof document !== 'undefined' && document.hidden) return 0;
    if (state.playback.isPlaying && (state.deckOpen || state.drownOpen)) return 3500;
    if (state.playback.isPlaying) return 6000;
    if (state.deckOpen || state.drownOpen) return 9000;
    return 18000;
}

function _scheduleNextPoll() {
    if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }
    const ms = _getPollIntervalMs();
    if (ms <= 0) return;
    _pollTimer = setTimeout(() => {
        _pollPlayback();
    }, ms);
}

function _startTickTimer() {
    if (_tickTimer) return;
    _tickTimer = setInterval(() => {
        if (!state.connected) return;
        _syncProgressElements();
        const pb = state.playback;
        if (pb.isPlaying && pb.item && pb.durationMs > 0) {
            const live = _getLiveProgressMs();
            const key = `${pb.item.uri}:${pb.updatedAt}`;
            if (live >= pb.durationMs - 100 && _snapPolledForUri !== key) {
                _snapPolledForUri = key;
                setTimeout(() => { _pollPlayback(); }, 450);
            }
        }
    }, 250);
}

function _stopTimers() {
    if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }
    if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
}

async function _loadPlaylists(append = false) {
    const st = state.playlists;
    if (st.loading) return;
    st.loading = true;
    st.error = '';
    if (!append) _renderDeckTabBody();
    try {
        if (!state.me) {
            try { state.me = await getMe(); } catch (_) {}
        }
        const offset = append ? st.nextOffset : 0;
        const res = await getMyPlaylists(50, offset);
        const rows = Array.isArray(res && res.items) ? res.items.filter(Boolean) : [];
        st.items = append ? st.items.concat(rows) : rows;
        st.total = Number(res && res.total) || st.items.length;
        st.nextOffset = offset + rows.length;
        st.loaded = true;
    } catch (err) {
        st.error = (err && err.message) || 'Could not load playlists.';
    } finally {
        st.loading = false;
        if (state.deckOpen && state.activeTab === 'playlists' && !state.detailView) {
            _renderDeckTabBody();
        }
        if (state.playlistPicker.open) _renderPickerMount();
    }
}

async function _loadRotation(force = false) {
    const st = state.rotation;
    if (st.loading || (st.loaded && !force)) return;
    st.loading = true;
    st.error = '';
    _renderDeckTabBody();
    try {
        const [recRes, topRes] = await Promise.all([
            getRecentlyPlayed(25).catch(() => null),
            getTopTracks('short_term', 20).catch(() => null),
        ]);
        const seen = new Set();
        const recent = [];
        const recItems = Array.isArray(recRes && recRes.items) ? recRes.items : [];
        for (const entry of recItems) {
            const tr = entry && entry.track;
            if (!tr || !tr.uri || seen.has(tr.uri)) continue;
            seen.add(tr.uri);
            recent.push(tr);
        }
        const top = Array.isArray(topRes && topRes.items) ? topRes.items.filter((t) => t && t.uri) : [];
        st.recent = recent;
        st.top = top;
        st.loaded = true;
        if (!recent.length && !top.length && !recRes && !topRes) {
            st.error = 'Could not load rotation history.';
        }
    } catch (err) {
        st.error = (err && err.message) || 'Could not load rotation.';
    } finally {
        st.loading = false;
        if (state.deckOpen && state.activeTab === 'rotation' && !state.detailView) {
            _renderDeckTabBody();
        }
    }
}

async function _loadLiked(append = false) {
    const st = state.liked;
    if (st.loading) return;
    st.loading = true;
    st.error = '';
    if (!append) _renderDeckTabBody();
    try {
        const offset = append ? st.nextOffset : 0;
        const res = await getLikedTracks(50, offset);
        const rows = (Array.isArray(res && res.items) ? res.items : [])
            .map((entry) => entry && entry.track)
            .filter((t) => t && t.uri);
        st.items = append ? st.items.concat(rows) : rows;
        st.total = Number(res && res.total) || st.items.length;
        st.nextOffset = offset + (Array.isArray(res && res.items) ? res.items.length : rows.length);
        st.loaded = true;
    } catch (err) {
        st.error = (err && err.message) || 'Could not load Liked Songs.';
    } finally {
        st.loading = false;
        if (state.deckOpen && state.activeTab === 'liked' && !state.detailView) {
            _renderDeckTabBody();
        }
    }
}

async function _loadQueue() {
    const st = state.queue;
    if (st.loading) return;
    st.loading = true;
    st.error = '';
    _renderDeckTabBody();
    try {
        const res = await getQueue();
        st.current = (res && res.currently_playing) || state.playback.item || null;
        st.items = Array.isArray(res && res.queue) ? res.queue : [];
        st.loaded = true;
    } catch (err) {
        st.error = (err && err.message) || 'Could not load live queue.';
    } finally {
        st.loading = false;
        if (state.deckOpen && state.activeTab === 'queue' && !state.detailView) {
            _renderDeckTabBody();
        }
    }
}

async function _runSearch(query) {
    const clean = String(query || '').trim();
    const st = state.search;
    st.query = query;
    if (!clean) {
        st.tracks = [];
        st.playlists = [];
        st.albums = [];
        st.ranQuery = '';
        st.loading = false;
        st.error = '';
        _renderDeckTabBody(true);
        return;
    }
    st.loading = true;
    st.error = '';
    _renderDeckTabBody(true);
    try {
        const res = await apiSearch(clean, 'track,playlist,album', 10);
        if (state.search.query.trim() !== clean) return;
        st.tracks = Array.isArray(res?.tracks?.items) ? res.tracks.items.filter(Boolean) : [];
        st.playlists = Array.isArray(res?.playlists?.items) ? res.playlists.items.filter(Boolean) : [];
        st.albums = Array.isArray(res?.albums?.items) ? res.albums.items.filter(Boolean) : [];
        st.ranQuery = clean;
    } catch (err) {
        if (state.search.query.trim() !== clean) return;
        st.error = (err && err.message) || 'Search failed.';
    } finally {
        if (state.search.query.trim() === clean) {
            st.loading = false;
            if (state.deckOpen && state.activeTab === 'search' && !state.detailView) {
                _renderDeckTabBody(true);
            }
        }
    }
}

async function _openPlaylistDetail(playlistId) {
    if (!playlistId) return;
    const cached = state.playlists.items.find((p) => p && p.id === playlistId)
        || state.search.playlists.find((p) => p && p.id === playlistId);

    state.detailView = {
        kind: 'playlist',
        id: playlistId,
        uri: cached ? cached.uri : `spotify:playlist:${playlistId}`,
        name: cached ? cached.name : 'Playlist',
        sub: cached && cached.owner && cached.owner.display_name ? cached.owner.display_name : '',
        image: cached ? pickImage(cached.images, 300) : '',
        items: [],
        total: cached ? ((cached.items && cached.items.total) ?? (cached.tracks && cached.tracks.total) ?? 0) : 0,
        nextOffset: 0,
        loading: true,
        filter: '',
    };
    _renderDeckHeroAndChrome();
    _renderDeckTabBody();

    try {
        const [meta, page] = await Promise.all([
            cached ? Promise.resolve(null) : getPlaylistMeta(playlistId).catch(() => null),
            getPlaylistItems(playlistId, 50, 0),
        ]);
        if (!state.detailView || state.detailView.id !== playlistId) return;
        if (meta) {
            state.detailView.name = meta.name || state.detailView.name;
            state.detailView.uri = meta.uri || state.detailView.uri;
            state.detailView.image = pickImage(meta.images, 300) || state.detailView.image;
            state.detailView.sub = (meta.owner && meta.owner.display_name) || state.detailView.sub;
        }
        state.detailView.items = page.items.map((r) => r.track);
        state.detailView.total = page.total || state.detailView.items.length;
        state.detailView.nextOffset = page.items.length;
    } catch (err) {
        _setBanner((err && err.message) || 'Failed to load playlist tracks.', 'err');
    } finally {
        if (state.detailView && state.detailView.id === playlistId) {
            state.detailView.loading = false;
            _renderDeckTabBody();
        }
    }
}

async function _loadMoreDetail() {
    const dv = state.detailView;
    if (!dv || dv.loading) return;
    dv.loading = true;
    _renderDeckTabBody();
    try {
        if (dv.kind === 'playlist') {
            const page = await getPlaylistItems(dv.id, 50, dv.nextOffset);
            const more = page.items.map((r) => r.track);
            dv.items = dv.items.concat(more);
            dv.total = page.total || dv.total;
            dv.nextOffset += more.length;
        } else {
            const res = await getAlbumTracks(dv.id, 50, dv.nextOffset);
            const albumMeta = { id: dv.id, name: dv.name, uri: dv.uri, images: dv.image ? [{ url: dv.image, width: 300 }] : [] };
            const more = (Array.isArray(res && res.items) ? res.items : [])
                .filter((t) => t && t.uri)
                .map((t) => ({ ...t, album: t.album || albumMeta }));
            dv.items = dv.items.concat(more);
            dv.total = Number(res && res.total) || dv.total;
            dv.nextOffset += more.length;
        }
    } catch (err) {
        _setBanner((err && err.message) || 'Could not load more tracks.', 'err');
    } finally {
        dv.loading = false;
        if (state.detailView === dv) _renderDeckTabBody();
    }
}

async function _openAlbumDetail(albumId) {
    if (!albumId) return;
    const cached = state.search.albums.find((a) => a && a.id === albumId)
        || (state.playback.item && state.playback.item.album && state.playback.item.album.id === albumId
            ? state.playback.item.album : null);

    state.detailView = {
        kind: 'album',
        id: albumId,
        uri: cached ? cached.uri : `spotify:album:${albumId}`,
        name: cached ? cached.name : 'Album',
        sub: cached ? artistsText(cached) : '',
        image: cached ? pickImage(cached.images, 300) : '',
        items: [],
        total: cached ? (Number(cached.total_tracks) || 0) : 0,
        nextOffset: 0,
        loading: true,
        filter: '',
    };
    _renderDeckHeroAndChrome();
    _renderDeckTabBody();

    try {
        const album = await getAlbum(albumId);
        if (!state.detailView || state.detailView.id !== albumId) return;
        const img = pickImage(album.images, 300) || state.detailView.image;
        state.detailView.name = album.name || state.detailView.name;
        state.detailView.uri = album.uri || state.detailView.uri;
        state.detailView.sub = artistsText(album) || state.detailView.sub;
        state.detailView.image = img;
        const tracksPage = album.tracks || await getAlbumTracks(albumId, 50, 0);
        const albumMeta = { id: album.id, name: album.name, uri: album.uri, images: album.images || [] };
        const raw = Array.isArray(tracksPage && tracksPage.items) ? tracksPage.items : [];
        state.detailView.items = raw.filter((t) => t && t.uri).map((t) => ({ ...t, album: t.album || albumMeta }));
        state.detailView.total = Number(tracksPage && tracksPage.total) || Number(album.total_tracks) || state.detailView.items.length;
        state.detailView.nextOffset = raw.length;
    } catch (err) {
        _setBanner((err && err.message) || 'Could not load album.', 'err');
    } finally {
        if (state.detailView && state.detailView.id === albumId) {
            state.detailView.loading = false;
            _renderDeckTabBody();
        }
    }
}

async function _runConnectAction(fn) {
    try {
        const res = await fn();
        return res;
    } catch (err) {
        if (err && err.code === 'NO_ACTIVE_DEVICE') {
            _setBanner('No active Spotify device. Open Spotify on your device once, then press Play.', 'err', { showOpenApp: true });
        } else if (err && err.code === 'PREMIUM_REQUIRED') {
            _setBanner('Spotify Premium is required for remote playback control.', 'err');
        } else if (err && err.code === 'AUTH_EXPIRED') {
            state.connected = false;
            state.setupError = err.message || 'Session expired. Reconnect Spotify.';
            _stopTimers();
            _syncAllVisuals();
            if (state.deckOpen) _renderDeckShell();
        } else if (err && err.message) {
            _setBanner(err.message, 'err');
        }
        return null;
    }
}

function _preferredDev() {
    return (state.playback.device && state.playback.device.id) || state.prefs.preferredDeviceId || undefined;
}

async function _handleTogglePlay() {
    if (!state.connected) return openDeck();
    const wasPlaying = state.playback.isPlaying;
    await _runConnectAction(async () => {
        if (wasPlaying) {
            await apiPause(_preferredDev());
            state.playback.isPlaying = false;
            state.playback.progressMs = _getLiveProgressMs();
            state.playback.updatedAt = Date.now();
        } else {
            try { HeartbeatAudio.setSpotifyYield(true); } catch (_) {}
            await apiPlay({ deviceId: _preferredDev() });
            state.playback.isPlaying = true;
            state.playback.updatedAt = Date.now();
        }
        _syncAllVisuals();
        setTimeout(() => { _pollPlayback(); }, 350);
    });
}

async function _handleNext() {
    if (!state.connected) return;
    await _runConnectAction(async () => {
        try { HeartbeatAudio.setSpotifyYield(true); } catch (_) {}
        await apiNext(_preferredDev());
        setTimeout(() => { _pollPlayback(); }, 350);
    });
}

async function _handlePrevious() {
    if (!state.connected) return;
    await _runConnectAction(async () => {
        try { HeartbeatAudio.setSpotifyYield(true); } catch (_) {}
        await apiPrevious(_preferredDev());
        setTimeout(() => { _pollPlayback(); }, 350);
    });
}

async function _handleToggleLoop() {
    if (!state.connected) return;
    const nextState = state.playback.repeatState === 'track' ? 'off' : 'track';
    await _runConnectAction(async () => {
        await apiSetRepeat(nextState, _preferredDev());
        state.playback.repeatState = nextState;
        _syncAllVisuals();
        _showToast(nextState === 'track' ? 'Track loop locked' : 'Loop off');
        setTimeout(() => { _pollPlayback(); }, 350);
    });
}

async function _handleToggleShuffle() {
    if (!state.connected) return;
    const nextState = !state.playback.shuffleState;
    await _runConnectAction(async () => {
        await apiSetShuffle(nextState, _preferredDev());
        state.playback.shuffleState = nextState;
        _syncAllVisuals();
        setTimeout(() => { _pollPlayback(); }, 350);
    });
}

async function _handleToggleSave() {
    const item = state.playback.item;
    if (!state.connected || !item || !item.uri) return;
    const targetSave = !state.isSaved;
    await _runConnectAction(async () => {
        if (targetSave) {
            await saveTrack(item.uri);
        } else {
            await removeTrack(item.uri);
        }
        state.isSaved = targetSave;
        state.savedCheckUri = item.uri;
        if (state.liked.loaded) state.liked.loaded = false;
        _syncAllVisuals();
        _showToast(targetSave ? 'Saved to Liked Songs' : 'Removed from Liked Songs');
    });
}

function _buildPinFromCurrent() {
    const pb = state.playback;
    if (pb.contextUri && (pb.contextType === 'playlist' || pb.contextType === 'album')) {
        const item = pb.item;
        const plMatch = pb.contextType === 'playlist'
            ? state.playlists.items.find((p) => p && p.uri === pb.contextUri)
            : null;
        const name = plMatch ? plMatch.name : (item && item.album && pb.contextType === 'album' ? item.album.name : 'Pinned Playlist');
        const sub = plMatch ? 'Playlist' : (item ? artistsText(item) : '');
        const image = plMatch ? pickImage(plMatch.images, 120) : (item && item.album ? pickImage(item.album.images, 120) : '');
        return { uri: pb.contextUri, kind: pb.contextType, name, sub, image };
    }
    if (pb.item && pb.item.uri) {
        return {
            uri: pb.item.uri,
            kind: 'track',
            name: pb.item.name,
            sub: artistsText(pb.item),
            image: pb.item.album ? pickImage(pb.item.album.images, 120) : '',
        };
    }
    return null;
}

function _pinItem(pinObj, slotIdx = -1) {
    if (!pinObj || !pinObj.uri) return;
    const pins = state.pins.slice();
    const existingIdx = pins.findIndex((p) => p && p.uri === pinObj.uri);
    if (existingIdx !== -1 && slotIdx === -1) {
        _showToast('Already pinned');
        return;
    }
    if (existingIdx !== -1) pins.splice(existingIdx, 1);

    if (slotIdx >= 0 && slotIdx < MAX_PINS) {
        pins[slotIdx] = pinObj;
    } else if (pins.length < MAX_PINS) {
        pins.push(pinObj);
    } else {
        pins.shift();
        pins.push(pinObj);
    }
    state.pins = pins.filter(Boolean).slice(0, MAX_PINS);
    savePins(state.pins);
    _renderDeckHeroAndChrome();
    _showToast(`Pinned: ${pinObj.name}`);
}

async function _playPin(slotIdx) {
    const pin = state.pins[slotIdx];
    if (!pin) return;
    await _runConnectAction(async () => {
        try { HeartbeatAudio.setSpotifyYield(true); } catch (_) {}
        if (pin.kind === 'track') {
            await apiPlay({ uris: [pin.uri], deviceId: _preferredDev() });
        } else {
            await apiPlay({ contextUri: pin.uri, deviceId: _preferredDev() });
        }
        state.playback.isPlaying = true;
        state.playback.updatedAt = Date.now();
        _syncAllVisuals();
        setTimeout(() => { _pollPlayback(); }, 350);
    });
}

function _ensureTabLoaded(tab) {
    if (!state.connected) return;
    if (tab === 'playlists' && !state.playlists.loaded && !state.playlists.loading) _loadPlaylists(false);
    if (tab === 'rotation' && !state.rotation.loaded && !state.rotation.loading) _loadRotation(false);
    if (tab === 'liked' && !state.liked.loaded && !state.liked.loading) _loadLiked(false);
    if (tab === 'queue' && !state.queue.loading) _loadQueue();
}

export function openDeck(tab) {
    if (tab) {
        state.activeTab = tab;
        state.detailView = null;
    }
    state.deckOpen = true;
    state.deviceMenuOpen = false;
    if (dom.deckBackdrop) dom.deckBackdrop.hidden = false;
    if (dom.deckDrawer) dom.deckDrawer.hidden = false;
    try { document.body.classList.add('sp-deck-open'); } catch (_) {}

    _renderDeckShell();
    if (state.connected) {
        _pollPlayback({ includeDevices: true });
        _ensureTabLoaded(state.activeTab);
    }
}

export function closeDeck() {
    state.deckOpen = false;
    state.deviceMenuOpen = false;
    state.playlistPicker.open = false;
    if (dom.deckBackdrop) dom.deckBackdrop.hidden = true;
    if (dom.deckDrawer) dom.deckDrawer.hidden = true;
    try { document.body.classList.remove('sp-deck-open'); } catch (_) {}
    _scheduleNextPoll();
}

export function toggleDeck() {
    if (state.deckOpen) closeDeck();
    else openDeck();
}

export function enterDrown() {
    if (!state.connected) return openDeck();
    closeDeck();
    state.drownOpen = true;
    _lastDrownSignature = '';
    _syncDrownOverlay();
    _pollPlayback();
}

export function exitDrown() {
    state.drownOpen = false;
    _syncDrownOverlay();
    _scheduleNextPoll();
}

export function onVoidAudioReclaimed() {
    if (!state.connected || !state.playback.isPlaying) return;
    apiPause(_preferredDev())
        .then(() => {
            state.playback.isPlaying = false;
            state.playback.progressMs = _getLiveProgressMs();
            state.playback.updatedAt = Date.now();
            _syncAllVisuals();
        })
        .catch(() => {});
}

async function _handleDeckClick(e) {
    const tabBtn = e.target.closest('[data-sp-tab]');
    if (tabBtn) {
        const nextTab = tabBtn.getAttribute('data-sp-tab');
        state.activeTab = nextTab;
        state.detailView = null;
        _renderDeckHeroAndChrome();
        _renderDeckTabBody();
        _ensureTabLoaded(nextTab);
        return;
    }

    const actEl = e.target.closest('[data-sp-act]');
    if (!actEl) {
        if (state.deviceMenuOpen && !e.target.closest('.sp-dev-wrap')) {
            state.deviceMenuOpen = false;
            _renderDeckHeroAndChrome();
        }
        return;
    }

    const act = actEl.getAttribute('data-sp-act');

    switch (act) {
        case 'close-deck':
            closeDeck();
            return;
        case 'open-deck':
            openDeck();
            return;
        case 'void-cover':
            if (state.playback.isPlaying) enterDrown();
            else openDeck();
            return;
        case 'enter-drown':
            enterDrown();
            return;
        case 'exit-drown':
            exitDrown();
            return;
        case 'copy-redirect': {
            const uri = getRedirectUri();
            try {
                await navigator.clipboard.writeText(uri);
                actEl.textContent = 'COPIED';
                setTimeout(() => { actEl.textContent = 'COPY'; }, 1800);
            } catch (_) {
                actEl.textContent = 'SELECT ↑';
            }
            return;
        }
        case 'toggle-devices':
            state.deviceMenuOpen = !state.deviceMenuOpen;
            if (state.deviceMenuOpen) {
                getDevices().then((devs) => {
                    state.devices = devs;
                    _renderDeckHeroAndChrome();
                }).catch(() => {});
            }
            _renderDeckHeroAndChrome();
            return;
        case 'refresh-devices':
            getDevices().then((devs) => {
                state.devices = devs;
                _renderDeckHeroAndChrome();
                _showToast(`Found ${devs.length} device${devs.length === 1 ? '' : 's'}`);
            }).catch((err) => _setBanner((err && err.message) || 'Device scan failed.', 'err'));
            return;
        case 'select-device': {
            const devId = actEl.getAttribute('data-device-id');
            state.deviceMenuOpen = false;
            if (!devId) return;
            state.prefs.preferredDeviceId = devId;
            savePrefs(state.prefs);
            await _runConnectAction(async () => {
                await transferPlayback(devId, state.playback.isPlaying);
                _showToast('Switched device');
                setTimeout(() => { _pollPlayback({ includeDevices: true }); }, 400);
            });
            return;
        }
        case 'toggle-haze':
            state.prefs.practiceHaze = !state.prefs.practiceHaze;
            savePrefs(state.prefs);
            _syncAllVisuals();
            return;
        case 'dismiss-banner':
            state.statusBanner = null;
            _renderDeckHeroAndChrome();
            return;
        case 'toggle-play':
            await _handleTogglePlay();
            return;
        case 'next':
            await _handleNext();
            return;
        case 'prev':
            await _handlePrevious();
            return;
        case 'toggle-loop':
            await _handleToggleLoop();
            return;
        case 'toggle-shuffle':
            await _handleToggleShuffle();
            return;
        case 'toggle-save':
            await _handleToggleSave();
            return;
        case 'open-playlist-picker': {
            const item = state.playback.item;
            if (!item || !item.uri) return;
            state.playlistPicker = { open: true, trackUri: item.uri, trackName: item.name || 'Track' };
            if (!state.playlists.loaded && !state.playlists.loading) _loadPlaylists(false);
            _renderPickerMount();
            return;
        }
        case 'close-playlist-picker':
            state.playlistPicker.open = false;
            _renderPickerMount();
            return;
        case 'add-to-playlist': {
            const plId = actEl.getAttribute('data-playlist-id');
            const plName = actEl.getAttribute('data-playlist-name') || 'playlist';
            const trackUri = state.playlistPicker.trackUri;
            state.playlistPicker.open = false;
            _renderPickerMount();
            if (!plId || !trackUri) return;
            await _runConnectAction(async () => {
                await addToPlaylist(plId, trackUri);
                _showToast(`Added to ${plName}`);
            });
            return;
        }
        case 'pin-current': {
            const pin = _buildPinFromCurrent();
            if (pin) _pinItem(pin, -1);
            return;
        }
        case 'pin-slot': {
            const idx = Number(actEl.getAttribute('data-slot'));
            const pin = _buildPinFromCurrent();
            if (!pin) {
                _showToast('Play a track or open a playlist to pin');
                return;
            }
            _pinItem(pin, idx);
            return;
        }
        case 'play-pin': {
            const idx = Number(actEl.getAttribute('data-slot'));
            await _playPin(idx);
            return;
        }
        case 'unpin-slot': {
            const idx = Number(actEl.getAttribute('data-slot'));
            const nextPins = state.pins.slice();
            nextPins.splice(idx, 1);
            state.pins = nextPins;
            savePins(state.pins);
            _renderDeckHeroAndChrome();
            return;
        }
        case 'pin-entity': {
            const uri = actEl.getAttribute('data-uri');
            const kind = actEl.getAttribute('data-kind') || 'playlist';
            const name = actEl.getAttribute('data-name') || 'Pinned';
            const sub = actEl.getAttribute('data-sub') || '';
            const image = actEl.getAttribute('data-image') || '';
            _pinItem({ uri, kind, name, sub, image }, -1);
            return;
        }
        case 'open-playlist':
            await _openPlaylistDetail(actEl.getAttribute('data-playlist-id'));
            return;
        case 'open-album':
            await _openAlbumDetail(actEl.getAttribute('data-album-id'));
            return;
        case 'detail-back':
            state.detailView = null;
            _renderDeckHeroAndChrome();
            _renderDeckTabBody();
            return;
        case 'detail-more':
            await _loadMoreDetail();
            return;
        case 'playlists-more':
            await _loadPlaylists(true);
            return;
        case 'liked-more':
            await _loadLiked(true);
            return;
        case 'reload-tab':
            if (state.activeTab === 'playlists') await _loadPlaylists(false);
            if (state.activeTab === 'rotation') await _loadRotation(true);
            if (state.activeTab === 'liked') await _loadLiked(false);
            if (state.activeTab === 'queue') await _loadQueue();
            return;
        case 'play-context': {
            const uri = actEl.getAttribute('data-uri');
            if (!uri) return;
            await _runConnectAction(async () => {
                try { HeartbeatAudio.setSpotifyYield(true); } catch (_) {}
                await apiPlay({ contextUri: uri, deviceId: _preferredDev() });
                state.playback.isPlaying = true;
                state.playback.updatedAt = Date.now();
                _syncAllVisuals();
                setTimeout(() => { _pollPlayback(); }, 350);
            });
            return;
        }
        case 'play-context-shuffle': {
            const uri = actEl.getAttribute('data-uri');
            if (!uri) return;
            await _runConnectAction(async () => {
                try { HeartbeatAudio.setSpotifyYield(true); } catch (_) {}
                await apiSetShuffle(true, _preferredDev());
                state.playback.shuffleState = true;
                await apiPlay({ contextUri: uri, deviceId: _preferredDev() });
                state.playback.isPlaying = true;
                state.playback.updatedAt = Date.now();
                _syncAllVisuals();
                setTimeout(() => { _pollPlayback(); }, 350);
            });
            return;
        }
        case 'play-detail-track': {
            const trackUri = actEl.getAttribute('data-uri');
            const ctxUri = actEl.getAttribute('data-context-uri');
            if (!trackUri || !ctxUri) return;
            await _runConnectAction(async () => {
                try { HeartbeatAudio.setSpotifyYield(true); } catch (_) {}
                await apiPlay({ contextUri: ctxUri, offset: { uri: trackUri }, deviceId: _preferredDev() });
                state.playback.isPlaying = true;
                state.playback.updatedAt = Date.now();
                _syncAllVisuals();
                setTimeout(() => { _pollPlayback(); }, 350);
            });
            return;
        }
        case 'play-list-track': {
            const listName = actEl.getAttribute('data-list');
            const idx = Math.max(0, Number(actEl.getAttribute('data-idx')) || 0);
            const trackUri = actEl.getAttribute('data-uri');
            let pool = [];
            if (listName === 'recent') pool = state.rotation.recent;
            else if (listName === 'top') pool = state.rotation.top;
            else if (listName === 'liked') pool = state.liked.items;
            const uris = pool.slice(idx, idx + 35).map((t) => t && t.uri).filter(Boolean);
            if (!uris.length && trackUri) uris.push(trackUri);
            if (!uris.length) return;
            await _runConnectAction(async () => {
                try { HeartbeatAudio.setSpotifyYield(true); } catch (_) {}
                await apiPlay({ uris, deviceId: _preferredDev() });
                state.playback.isPlaying = true;
                state.playback.updatedAt = Date.now();
                _syncAllVisuals();
                setTimeout(() => { _pollPlayback(); }, 350);
            });
            return;
        }
        case 'play-track-uri': {
            const uri = actEl.getAttribute('data-uri');
            if (!uri) return;
            await _runConnectAction(async () => {
                try { HeartbeatAudio.setSpotifyYield(true); } catch (_) {}
                await apiPlay({ uris: [uri], deviceId: _preferredDev() });
                state.playback.isPlaying = true;
                state.playback.updatedAt = Date.now();
                _syncAllVisuals();
                setTimeout(() => { _pollPlayback(); }, 350);
            });
            return;
        }
        case 'queue-uri': {
            const uri = actEl.getAttribute('data-uri');
            const name = actEl.getAttribute('data-name') || 'track';
            if (!uri) return;
            await _runConnectAction(async () => {
                await addToQueue(uri, _preferredDev());
                _showToast(`Queued: ${name}`);
                if (state.activeTab === 'queue') _loadQueue();
            });
            return;
        }
        case 'reclaim-void-audio':
            try {
                HeartbeatAudio.setSpotifyYield(false);
                HeartbeatAudio.setAudioEnabled(true);
            } catch (_) {}
            onVoidAudioReclaimed();
            _renderDeckHeroAndChrome();
            _showToast('Void audio active');
            return;
        case 'disconnect':
            authDisconnect();
            clearSessionCaches();
            state.connected = false;
            state.detailView = null;
            state.playlistPicker.open = false;
            state.drownOpen = false;
            state.playback = {
                item: null, isPlaying: false, progressMs: 0, durationMs: 0,
                repeatState: 'off', shuffleState: false, device: null,
                contextUri: null, contextType: null, updatedAt: Date.now(),
            };
            state.playlists = { items: [], total: 0, nextOffset: 0, loaded: false, loading: false, error: '' };
            state.rotation = { recent: [], top: [], loaded: false, loading: false, error: '' };
            state.liked = { items: [], total: 0, nextOffset: 0, loaded: false, loading: false, error: '' };
            state.queue = { current: null, items: [], loaded: false, loading: false, error: '' };
            state.search = { query: '', tracks: [], playlists: [], albums: [], loading: false, ranQuery: '', error: '' };
            _stopTimers();
            try { HeartbeatAudio.setSpotifyYield(false); } catch (_) {}
            _syncDrownOverlay();
            _syncAllVisuals();
            if (state.deckOpen) _renderDeckShell();
            return;
    }
}

function _bindDomEvents() {
    const onGlobalPointer = (e) => {
        if (!e.target.closest('[data-sp-act]') && !e.target.closest('[data-sp-tab]')) return;
        _handleDeckClick(e);
    };

    if (dom.voidAnchor) {
        dom.voidAnchor.addEventListener('click', (e) => {
            e.stopPropagation();
            onGlobalPointer(e);
        });
    }
    if (dom.floatPill) {
        dom.floatPill.addEventListener('click', (e) => {
            e.stopPropagation();
            onGlobalPointer(e);
        });
    }
    if (dom.drownOverlay) {
        dom.drownOverlay.addEventListener('click', (e) => {
            e.stopPropagation();
            onGlobalPointer(e);
        });
        dom.drownOverlay.addEventListener('input', (e) => {
            if (e.target && e.target.id === 'sp-drown-seek') {
                state.scrubDragging = true;
                const pct = Number(e.target.value) / 1000;
                const ms = Math.round((state.playback.durationMs || 0) * pct);
                const curEl = dom.drownOverlay.querySelector('#sp-drown-cur');
                if (curEl) curEl.textContent = fmtTime(ms);
                e.target.style.setProperty('--sp-prog', `${(pct * 100).toFixed(2)}%`);
            }
        });
        dom.drownOverlay.addEventListener('change', async (e) => {
            if (e.target && e.target.id === 'sp-drown-seek') {
                state.scrubDragging = false;
                const pct = Number(e.target.value) / 1000;
                const ms = Math.round((state.playback.durationMs || 0) * pct);
                await _runConnectAction(async () => {
                    await apiSeek(ms, _preferredDev());
                    state.playback.progressMs = ms;
                    state.playback.updatedAt = Date.now();
                    _syncProgressElements();
                });
            }
        });
    }
    if (dom.deckBackdrop) {
        dom.deckBackdrop.addEventListener('click', closeDeck);
    }
    if (dom.deckDrawer) {
        dom.deckDrawer.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'sp-playlist-picker') {
                state.playlistPicker.open = false;
                _renderPickerMount();
                return;
            }
            if (e.target.closest('[data-sp-act]') || e.target.closest('[data-sp-tab]') || state.deviceMenuOpen) {
                _handleDeckClick(e);
            }
        });

        dom.deckDrawer.addEventListener('submit', async (e) => {
            if (e.target && e.target.id === 'sp-setup-form') {
                e.preventDefault();
                const inp = dom.deckDrawer.querySelector('#sp-client-id-input');
                const val = inp ? inp.value.trim() : '';
                state.setupClientId = val;
                if (!isValidClientIdFormat(val)) {
                    state.setupError = 'Enter a valid Spotify Client ID (usually 32 alphanumeric characters).';
                    _renderDisconnectedDeck();
                    return;
                }
                state.setupError = '';
                try {
                    await startAuth(val);
                } catch (err) {
                    state.setupError = (err && err.message) || 'Could not start Spotify sign-in.';
                    _renderDisconnectedDeck();
                }
            }
        });

        dom.deckDrawer.addEventListener('input', (e) => {
            const t = e.target;
            if (!t) return;
            if (t.id === 'sp-client-id-input') {
                state.setupClientId = t.value;
                setClientId(t.value);
                return;
            }
            if (t.id === 'sp-playlist-filter') {
                state.playlistFilter = t.value;
                _renderDeckTabBody(true);
                return;
            }
            if (t.id === 'sp-detail-filter' && state.detailView) {
                state.detailView.filter = t.value;
                _renderDeckTabBody(true);
                return;
            }
            if (t.id === 'sp-search-input') {
                state.search.query = t.value;
                if (_searchDebounce) clearTimeout(_searchDebounce);
                const q = t.value;
                _searchDebounce = setTimeout(() => { _runSearch(q); }, 340);
                return;
            }
            if (t.id === 'sp-seek-range') {
                state.scrubDragging = true;
                const pct = Number(t.value) / 1000;
                const ms = Math.round((state.playback.durationMs || 0) * pct);
                const curEl = dom.deckDrawer.querySelector('#sp-cur-time');
                if (curEl) curEl.textContent = fmtTime(ms);
                t.style.setProperty('--sp-prog', `${(pct * 100).toFixed(2)}%`);
                return;
            }
            if (t.id === 'sp-vol-range') {
                state.volumeDragging = true;
            }
        });

        dom.deckDrawer.addEventListener('change', async (e) => {
            const t = e.target;
            if (!t) return;
            if (t.id === 'sp-seek-range') {
                state.scrubDragging = false;
                const pct = Number(t.value) / 1000;
                const ms = Math.round((state.playback.durationMs || 0) * pct);
                await _runConnectAction(async () => {
                    await apiSeek(ms, _preferredDev());
                    state.playback.progressMs = ms;
                    state.playback.updatedAt = Date.now();
                    _syncProgressElements();
                });
                return;
            }
            if (t.id === 'sp-vol-range') {
                state.volumeDragging = false;
                const vol = Math.max(0, Math.min(100, Math.round(Number(t.value) || 0)));
                await _runConnectAction(async () => {
                    await apiSetVolume(vol, _preferredDev());
                    if (state.playback.device) state.playback.device.volume_percent = vol;
                });
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (state.playlistPicker.open) {
                e.preventDefault();
                e.stopImmediatePropagation();
                state.playlistPicker.open = false;
                _renderPickerMount();
                return;
            }
            if (state.deckOpen) {
                e.preventDefault();
                e.stopImmediatePropagation();
                closeDeck();
                return;
            }
            if (state.drownOpen) {
                e.preventDefault();
                e.stopImmediatePropagation();
                exitDrown();
                return;
            }
        }

        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) {
            return;
        }
        if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
            const code = e.code || '';
            const key = (e.key || '').toLowerCase();
            if (key === 'm' || code === 'KeyM') {
                e.preventDefault();
                toggleDeck();
            } else if (code === 'Space' || e.key === ' ') {
                e.preventDefault();
                _handleTogglePlay();
            } else if (e.key === ']' || code === 'BracketRight') {
                e.preventDefault();
                _handleNext();
            } else if (e.key === '[' || code === 'BracketLeft') {
                e.preventDefault();
                _handlePrevious();
            } else if (key === 'l' || code === 'KeyL') {
                e.preventDefault();
                _handleToggleLoop();
            }
        }
    }, { capture: true });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }
        } else if (state.connected) {
            _pollPlayback({ includeDevices: state.deckOpen });
        }
    });

    window.addEventListener('spotify:auth-expired', () => {
        state.connected = false;
        state.setupError = 'Spotify session expired. Reconnect.';
        _stopTimers();
        _syncAllVisuals();
        if (state.deckOpen) _renderDeckShell();
    });
}

function _mountDom() {
    if (typeof document === 'undefined' || !document.body) return;

    const voidEl = document.getElementById('heartbeat-void');
    if (voidEl && !document.getElementById('sp-void-anchor')) {
        const anchor = document.createElement('div');
        anchor.id = 'sp-void-anchor';
        anchor.className = 'sp-void-anchor hb-controls';
        voidEl.appendChild(anchor);
        dom.voidAnchor = anchor;
    }

    if (!document.getElementById('sp-float-pill')) {
        const pill = document.createElement('div');
        pill.id = 'sp-float-pill';
        pill.className = 'sp-float-pill';
        document.body.appendChild(pill);
        dom.floatPill = pill;
    }

    const pqStage = document.getElementById('practice-modal');
    if (pqStage && !document.getElementById('sp-pq-haze')) {
        const haze = document.createElement('div');
        haze.id = 'sp-pq-haze';
        haze.className = 'sp-pq-haze';
        haze.setAttribute('aria-hidden', 'true');
        haze.innerHTML = '<div class="sp-pq-haze-a"></div><div class="sp-pq-haze-b"></div>';
        pqStage.insertBefore(haze, pqStage.firstChild);
        dom.pqHaze = haze;
    }

    if (!document.getElementById('sp-drown-overlay')) {
        const drown = document.createElement('div');
        drown.id = 'sp-drown-overlay';
        drown.className = 'sp-drown-overlay';
        drown.hidden = true;
        document.body.appendChild(drown);
        dom.drownOverlay = drown;
    }

    if (!document.getElementById('sp-deck-backdrop')) {
        const bd = document.createElement('div');
        bd.id = 'sp-deck-backdrop';
        bd.className = 'sp-deck-backdrop';
        bd.hidden = true;
        document.body.appendChild(bd);
        dom.deckBackdrop = bd;
    }

    if (!document.getElementById('sp-deck-drawer')) {
        const drawer = document.createElement('aside');
        drawer.id = 'sp-deck-drawer';
        drawer.className = 'sp-deck-drawer';
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-modal', 'true');
        drawer.setAttribute('aria-label', 'Spotify Deck');
        drawer.hidden = true;
        document.body.appendChild(drawer);
        dom.deckDrawer = drawer;
    }
}

export async function initSpotifyDeck() {
    if (state.initialized) return;
    state.initialized = true;

    _mountDom();
    _bindDomEvents();

    const cb = await handleAuthCallback();
    if (cb && cb.handled) {
        state.connected = authIsConnected();
        if (cb.ok) {
            try { HeartbeatAudio.setSpotifyYield(true); } catch (_) {}
            _syncAllVisuals();
            openDeck('playlists');
            _showToast('Spotify connected');
        } else {
            state.setupError = cb.error || 'Spotify authorization failed.';
            openDeck();
        }
    } else {
        state.connected = authIsConnected();
        _syncAllVisuals();
    }

    if (state.connected) {
        _startTickTimer();
        _pollPlayback({ includeDevices: true });
    }
}

export const SpotifyDeck = {
    init: initSpotifyDeck,
    open: openDeck,
    close: closeDeck,
    toggle: toggleDeck,
    isConnected: () => Boolean(state.connected),
    isPlaying: () => Boolean(state.connected && state.playback.isPlaying),
    isYielding: () => Boolean(HeartbeatAudio && HeartbeatAudio.isSpotifyYielding && HeartbeatAudio.isSpotifyYielding()),
    enterDrown,
    exitDrown,
    onVoidAudioReclaimed,
    refresh: () => _pollPlayback({ includeDevices: true }),
};

try {
    if (typeof window !== 'undefined') {
        window.SpotifyDeck = SpotifyDeck;
    }
} catch (_) {}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { initSpotifyDeck(); });
    } else {
        initSpotifyDeck();
    }
}
