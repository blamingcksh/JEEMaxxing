/* ============================================================================
   spotify-auth.js — Zero-backend Spotify PKCE OAuth 2.0 (Browser / iPad PWA)
   ============================================================================ */

export const CLIENT_ID_KEY = 'jeemax_spotify_client_id_v1';
export const TOKENS_KEY = 'jeemax_spotify_tokens_v1';
export const PKCE_KEY = 'jeemax_spotify_pkce_v1';

export const SPOTIFY_SCOPES = [
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'user-read-recently-played',
    'user-top-read',
    'playlist-read-private',
    'playlist-read-collaborative',
    'playlist-modify-public',
    'playlist-modify-private',
    'user-library-read',
    'user-library-modify',
].join(' ');

const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const PKCE_TTL_MS = 15 * 60 * 1000;

let _refreshPromise = null;

function _lsGet(key) {
    try {
        return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    } catch (_) {
        return null;
    }
}

function _lsSet(key, val) {
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, val);
    } catch (_) {}
}

function _lsRemove(key) {
    try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    } catch (_) {}
}

function _readJson(key) {
    const raw = _lsGet(key);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

function _base64UrlEncode(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function _randomToken(byteLen = 48) {
    const arr = new Uint8Array(byteLen);
    crypto.getRandomValues(arr);
    return _base64UrlEncode(arr);
}

async function _sha256Base64Url(input) {
    if (!crypto || !crypto.subtle || typeof crypto.subtle.digest !== 'function') {
        const err = new Error('Spotify PKCE requires HTTPS or http://127.0.0.1.');
        err.code = 'INSECURE_CONTEXT';
        throw err;
    }
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return _base64UrlEncode(new Uint8Array(digest));
}

export function getClientId() {
    return (_lsGet(CLIENT_ID_KEY) || '').trim();
}

export function setClientId(id) {
    const clean = String(id || '').trim();
    if (!clean) {
        _lsRemove(CLIENT_ID_KEY);
        return '';
    }
    _lsSet(CLIENT_ID_KEY, clean);
    return clean;
}

export function isValidClientIdFormat(id) {
    const clean = String(id || '').trim();
    return /^[a-zA-Z0-9_-]{16,128}$/.test(clean);
}

export function getRedirectUri() {
    if (typeof window === 'undefined' || !window.location) return '';
    return window.location.origin + window.location.pathname;
}

export function isLocalhostUnsupported() {
    if (typeof window === 'undefined' || !window.location) return false;
    return window.location.protocol === 'http:' && window.location.hostname === 'localhost';
}

export function isConnected() {
    const tok = _readJson(TOKENS_KEY);
    return Boolean(tok && (tok.accessToken || tok.refreshToken));
}

export function getStoredTokens() {
    return _readJson(TOKENS_KEY);
}

export function disconnect() {
    _refreshPromise = null;
    _lsRemove(TOKENS_KEY);
    _lsRemove(PKCE_KEY);
}

export async function startAuth(clientIdOverride) {
    if (isLocalhostUnsupported()) {
        const err = new Error('Spotify rejects http://localhost in 2026. Open the app on http://127.0.0.1 or HTTPS instead.');
        err.code = 'LOCALHOST_UNSUPPORTED';
        throw err;
    }
    const clientId = clientIdOverride !== undefined ? setClientId(clientIdOverride) : getClientId();
    if (!isValidClientIdFormat(clientId)) {
        const err = new Error('Enter a valid Spotify Client ID first.');
        err.code = 'INVALID_CLIENT_ID';
        throw err;
    }

    const verifier = _randomToken(48);
    const state = _randomToken(18);
    const challenge = await _sha256Base64Url(verifier);
    const redirectUri = getRedirectUri();

    _lsSet(PKCE_KEY, JSON.stringify({
        verifier,
        state,
        redirectUri,
        clientId,
        ts: Date.now(),
    }));

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        scope: SPOTIFY_SCOPES,
        redirect_uri: redirectUri,
        state,
        code_challenge_method: 'S256',
        code_challenge: challenge,
    });

    const url = `${AUTH_ENDPOINT}?${params.toString()}`;
    window.location.assign(url);
    return url;
}

function _cleanOAuthUrl() {
    try {
        const u = new URL(window.location.href);
        u.searchParams.delete('code');
        u.searchParams.delete('state');
        u.searchParams.delete('error');
        const nextSearch = u.searchParams.toString();
        const clean = u.pathname + (nextSearch ? `?${nextSearch}` : '') + (u.hash || '');
        window.history.replaceState(null, '', clean);
    } catch (_) {}
}

export async function handleAuthCallback() {
    if (typeof window === 'undefined' || !window.location) {
        return { handled: false };
    }
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');
    const state = params.get('state');

    if (!code && !error) {
        const stale = _readJson(PKCE_KEY);
        if (stale && (!stale.ts || Date.now() - stale.ts > PKCE_TTL_MS)) {
            _lsRemove(PKCE_KEY);
        }
        return { handled: false };
    }

    _cleanOAuthUrl();

    if (error) {
        _lsRemove(PKCE_KEY);
        return { handled: true, ok: false, error: error === 'access_denied' ? 'Spotify authorization cancelled.' : String(error) };
    }

    const pkce = _readJson(PKCE_KEY);
    if (!pkce || !pkce.verifier || !pkce.state || pkce.state !== state || (Date.now() - (pkce.ts || 0)) > PKCE_TTL_MS) {
        _lsRemove(PKCE_KEY);
        return { handled: true, ok: false, error: 'OAuth session expired or state mismatched. Tap Connect again.' };
    }

    const clientId = pkce.clientId || getClientId();
    const redirectUri = pkce.redirectUri || getRedirectUri();
    if (!clientId) {
        _lsRemove(PKCE_KEY);
        return { handled: true, ok: false, error: 'Missing Spotify Client ID.' };
    }

    try {
        const body = new URLSearchParams({
            client_id: clientId,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            code_verifier: pkce.verifier,
        });
        const res = await fetch(TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        const txt = await res.text();
        let data = {};
        try { data = txt ? JSON.parse(txt) : {}; } catch (_) {}

        if (!res.ok || !data.access_token) {
            _lsRemove(PKCE_KEY);
            return {
                handled: true,
                ok: false,
                error: data.error_description || data.error || `Token exchange failed (${res.status})`,
            };
        }

        const tokenRecord = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || '',
            expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
            scope: data.scope || SPOTIFY_SCOPES,
        };
        _lsSet(TOKENS_KEY, JSON.stringify(tokenRecord));
        if (pkce.clientId) setClientId(pkce.clientId);
        _lsRemove(PKCE_KEY);
        return { handled: true, ok: true, connected: true };
    } catch (e) {
        _lsRemove(PKCE_KEY);
        return {
            handled: true,
            ok: false,
            error: (e && e.message) ? e.message : 'Network error during Spotify sign-in.',
        };
    }
}

async function _refreshTokens() {
    const tokens = _readJson(TOKENS_KEY);
    if (!tokens || !tokens.refreshToken) {
        disconnect();
        const err = new Error('Spotify session expired. Reconnect to continue.');
        err.code = 'AUTH_EXPIRED';
        throw err;
    }

    const clientId = getClientId();
    if (!clientId) {
        const err = new Error('Missing Spotify Client ID.');
        err.code = 'INVALID_CLIENT_ID';
        throw err;
    }

    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: clientId,
    });

    const res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    const txt = await res.text();
    let data = {};
    try { data = txt ? JSON.parse(txt) : {}; } catch (_) {}

    if (!res.ok || !data.access_token) {
        if (res.status === 400 || res.status === 401) {
            if (data.error === 'invalid_grant' || data.error === 'invalid_client') {
                disconnect();
                try {
                    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                        window.dispatchEvent(new CustomEvent('spotify:auth-expired'));
                    }
                } catch (_) {}
                const err = new Error(data.error_description || 'Spotify session revoked. Reconnect.');
                err.code = 'AUTH_EXPIRED';
                throw err;
            }
        }
        const err = new Error(data.error_description || data.error || `Token refresh failed (${res.status})`);
        err.status = res.status;
        throw err;
    }

    const updated = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || tokens.refreshToken,
        expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
        scope: data.scope || tokens.scope || SPOTIFY_SCOPES,
    };
    _lsSet(TOKENS_KEY, JSON.stringify(updated));
    return updated.accessToken;
}

export async function getValidAccessToken(forceRefresh = false) {
    const tokens = _readJson(TOKENS_KEY);
    if (!tokens || (!tokens.accessToken && !tokens.refreshToken)) {
        const err = new Error('Spotify is not connected.');
        err.code = 'NOT_CONNECTED';
        throw err;
    }

    if (!forceRefresh && tokens.accessToken && Date.now() < (Number(tokens.expiresAt) || 0) - 90_000) {
        return tokens.accessToken;
    }

    if (!tokens.refreshToken) {
        if (!forceRefresh && tokens.accessToken && Date.now() < (Number(tokens.expiresAt) || 0) - 5_000) {
            return tokens.accessToken;
        }
        disconnect();
        const err = new Error('Spotify session expired. Reconnect.');
        err.code = 'AUTH_EXPIRED';
        throw err;
    }

    if (!_refreshPromise) {
        _refreshPromise = _refreshTokens().finally(() => {
            _refreshPromise = null;
        });
    }
    return _refreshPromise;
}
