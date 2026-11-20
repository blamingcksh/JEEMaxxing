/* ============================================================================
   spotify-api.js — 2026-Compliant Spotify Web API & Connect Client
   ============================================================================ */

import { getValidAccessToken } from './spotify-auth.js';

const API_BASE = 'https://api.spotify.com/v1';

let _rateLimitUntil = 0;
let _meCache = null;
let _mePromise = null;

export function isRateLimited() {
    return Date.now() < _rateLimitUntil;
}

export function getRateLimitRemainingMs() {
    return Math.max(0, _rateLimitUntil - Date.now());
}

export function clearSessionCaches() {
    _meCache = null;
    _mePromise = null;
}

export function getTrackIdFromUri(uri) {
    const s = String(uri || '').trim();
    if (!s) return '';
    const parts = s.split(':');
    return parts.length >= 3 ? parts[parts.length - 1] : s;
}

function _qs(params) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
        if (v !== undefined && v !== null && v !== '') {
            sp.set(k, String(v));
        }
    }
    const str = sp.toString();
    return str ? `?${str}` : '';
}

export async function apiFetch(path, { method = 'GET', body = undefined, retry401 = true } = {}) {
    if (isRateLimited()) {
        const waitMs = getRateLimitRemainingMs();
        const err = new Error(`Spotify rate limited. Retry in ${Math.ceil(waitMs / 1000)}s.`);
        err.status = 429;
        err.code = 'RATE_LIMITED';
        err.retryAfterMs = waitMs;
        throw err;
    }

    const token = await getValidAccessToken(false);
    const headers = {
        Authorization: `Bearer ${token}`,
    };
    let payload;
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: payload,
    });

    if (res.status === 401 && retry401) {
        await getValidAccessToken(true);
        return apiFetch(path, { method, body, retry401: false });
    }

    if (res.status === 429) {
        const rawRetry = Number(res.headers.get('Retry-After'));
        const retrySecs = Number.isFinite(rawRetry) && rawRetry > 0 ? Math.min(60, rawRetry) : 5;
        const retryAfterMs = retrySecs * 1000;
        _rateLimitUntil = Date.now() + retryAfterMs;
        const err = new Error(`Spotify rate limit reached. Pausing requests for ${retrySecs}s.`);
        err.status = 429;
        err.code = 'RATE_LIMITED';
        err.retryAfterMs = retryAfterMs;
        throw err;
    }

    if (res.status === 204) {
        return null;
    }

    const text = await res.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (_) {
            data = null;
        }
    }

    if (!res.ok) {
        const apiErr = (data && data.error) ? data.error : {};
        const reason = apiErr.reason || '';
        const msg = apiErr.message || `Spotify API error (${res.status})`;
        const err = new Error(msg);
        err.status = res.status;
        err.reason = reason;
        if (reason === 'NO_ACTIVE_DEVICE' || (res.status === 404 && /no active device/i.test(msg))) {
            err.code = 'NO_ACTIVE_DEVICE';
        } else if (reason === 'PREMIUM_REQUIRED' || (res.status === 403 && /premium/i.test(msg))) {
            err.code = 'PREMIUM_REQUIRED';
        } else if (res.status === 401) {
            err.code = 'AUTH_EXPIRED';
        } else {
            err.code = reason || `HTTP_${res.status}`;
        }
        throw err;
    }

    return data;
}

export async function getMe(force = false) {
    if (_meCache && !force) return _meCache;
    if (!_mePromise || force) {
        _mePromise = apiFetch('/me')
            .then((me) => {
                _meCache = me;
                return me;
            })
            .finally(() => {
                _mePromise = null;
            });
    }
    return _mePromise;
}

export async function getPlaybackState() {
    return apiFetch('/me/player?additional_types=track');
}

export async function getDevices() {
    const res = await apiFetch('/me/player/devices');
    return Array.isArray(res && res.devices) ? res.devices : [];
}

export async function transferPlayback(deviceId, playFlag = true) {
    return apiFetch('/me/player', {
        method: 'PUT',
        body: { device_ids: [deviceId], play: Boolean(playFlag) },
    });
}

async function _ensureDeviceAndRun(fn, preferredDeviceId) {
    try {
        return await fn(preferredDeviceId || undefined);
    } catch (err) {
        if (!err || (err.status !== 404 && err.code !== 'NO_ACTIVE_DEVICE')) {
            throw err;
        }
        const devices = await getDevices();
        const picked = devices.find((d) => d.is_active && !d.is_restricted)
            || (preferredDeviceId ? devices.find((d) => d.id === preferredDeviceId && !d.is_restricted) : null)
            || devices.find((d) => !d.is_restricted)
            || devices[0]
            || null;

        if (!picked || !picked.id || (preferredDeviceId && picked.id === preferredDeviceId)) {
            const noDev = new Error('No active Spotify device found. Open Spotify on your device once, then tap Play.');
            noDev.status = 404;
            noDev.code = 'NO_ACTIVE_DEVICE';
            throw noDev;
        }
        return fn(picked.id);
    }
}

export async function play({ contextUri, uris, offset, positionMs, deviceId } = {}) {
    const body = {};
    if (contextUri) body.context_uri = contextUri;
    if (Array.isArray(uris) && uris.length > 0) body.uris = uris;
    if (offset !== undefined && offset !== null) body.offset = offset;
    if (Number.isFinite(Number(positionMs))) body.position_ms = Math.max(0, Math.round(Number(positionMs)));
    const payload = Object.keys(body).length > 0 ? body : undefined;

    return _ensureDeviceAndRun(
        (devId) => apiFetch(`/me/player/play${_qs({ device_id: devId })}`, {
            method: 'PUT',
            body: payload,
        }),
        deviceId
    );
}

export async function pause(deviceId) {
    return _ensureDeviceAndRun(
        (devId) => apiFetch(`/me/player/pause${_qs({ device_id: devId })}`, { method: 'PUT' }),
        deviceId
    );
}

export async function next(deviceId) {
    return _ensureDeviceAndRun(
        (devId) => apiFetch(`/me/player/next${_qs({ device_id: devId })}`, { method: 'POST' }),
        deviceId
    );
}

export async function previous(deviceId) {
    return _ensureDeviceAndRun(
        (devId) => apiFetch(`/me/player/previous${_qs({ device_id: devId })}`, { method: 'POST' }),
        deviceId
    );
}

export async function seek(positionMs, deviceId) {
    const ms = Math.max(0, Math.round(Number(positionMs) || 0));
    return _ensureDeviceAndRun(
        (devId) => apiFetch(`/me/player/seek${_qs({ position_ms: ms, device_id: devId })}`, { method: 'PUT' }),
        deviceId
    );
}

export async function setRepeat(state, deviceId) {
    const safeState = state === 'track' || state === 'context' ? state : 'off';
    return _ensureDeviceAndRun(
        (devId) => apiFetch(`/me/player/repeat${_qs({ state: safeState, device_id: devId })}`, { method: 'PUT' }),
        deviceId
    );
}

export async function setShuffle(state, deviceId) {
    return _ensureDeviceAndRun(
        (devId) => apiFetch(`/me/player/shuffle${_qs({ state: Boolean(state), device_id: devId })}`, { method: 'PUT' }),
        deviceId
    );
}

export async function setVolume(percent, deviceId) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    return _ensureDeviceAndRun(
        (devId) => apiFetch(`/me/player/volume${_qs({ volume_percent: pct, device_id: devId })}`, { method: 'PUT' }),
        deviceId
    );
}

export async function getMyPlaylists(limit = 50, offset = 0) {
    return apiFetch(`/me/playlists${_qs({ limit, offset })}`);
}

export async function getPlaylistMeta(playlistId) {
    const id = encodeURIComponent(playlistId);
    return apiFetch(`/playlists/${id}`);
}

export async function getPlaylistItems(playlistId, limit = 50, offset = 0) {
    const id = encodeURIComponent(playlistId);
    const q = _qs({ limit, offset });
    let res;
    try {
        res = await apiFetch(`/playlists/${id}/items${q}`);
    } catch (err) {
        if (err && err.status === 404) {
            res = await apiFetch(`/playlists/${id}/tracks${q}`);
        } else {
            throw err;
        }
    }
    const rawItems = Array.isArray(res && res.items) ? res.items : [];
    const items = [];
    for (const entry of rawItems) {
        if (!entry) continue;
        const track = entry.item || entry.track || (entry.type === 'track' ? entry : null);
        if (!track || !track.name) continue;
        items.push({
            track,
            addedAt: entry.added_at || null,
        });
    }
    return {
        items,
        total: Number(res && res.total) || items.length,
        next: (res && res.next) || null,
        offset: Number(res && res.offset) || 0,
        limit: Number(res && res.limit) || limit,
    };
}

export async function addToPlaylist(playlistId, trackUri) {
    const id = encodeURIComponent(playlistId);
    const body = { uris: [trackUri] };
    try {
        return await apiFetch(`/playlists/${id}/items`, { method: 'POST', body });
    } catch (err) {
        if (err && err.status === 404) {
            return apiFetch(`/playlists/${id}/tracks`, { method: 'POST', body });
        }
        throw err;
    }
}

export async function getAlbum(albumId) {
    return apiFetch(`/albums/${encodeURIComponent(albumId)}`);
}

export async function getAlbumTracks(albumId, limit = 50, offset = 0) {
    return apiFetch(`/albums/${encodeURIComponent(albumId)}/tracks${_qs({ limit, offset })}`);
}

export async function getLikedTracks(limit = 50, offset = 0) {
    return apiFetch(`/me/tracks${_qs({ limit, offset })}`);
}

export async function checkSaved(trackUri) {
    if (!trackUri) return false;
    try {
        const res = await apiFetch(`/me/library/contains${_qs({ uris: trackUri })}`);
        return Boolean(Array.isArray(res) ? res[0] : res);
    } catch (err) {
        if (err && err.status === 404) {
            const id = getTrackIdFromUri(trackUri);
            if (!id) return false;
            const res = await apiFetch(`/me/tracks/contains${_qs({ ids: id })}`);
            return Boolean(Array.isArray(res) ? res[0] : res);
        }
        throw err;
    }
}

export async function saveTrack(trackUri) {
    if (!trackUri) return null;
    try {
        return await apiFetch(`/me/library${_qs({ uris: trackUri })}`, { method: 'PUT' });
    } catch (err) {
        if (err && err.status === 404) {
            const id = getTrackIdFromUri(trackUri);
            return apiFetch(`/me/tracks${_qs({ ids: id })}`, { method: 'PUT' });
        }
        throw err;
    }
}

export async function removeTrack(trackUri) {
    if (!trackUri) return null;
    try {
        return await apiFetch(`/me/library${_qs({ uris: trackUri })}`, { method: 'DELETE' });
    } catch (err) {
        if (err && err.status === 404) {
            const id = getTrackIdFromUri(trackUri);
            return apiFetch(`/me/tracks${_qs({ ids: id })}`, { method: 'DELETE' });
        }
        throw err;
    }
}

export async function getRecentlyPlayed(limit = 25) {
    return apiFetch(`/me/player/recently-played${_qs({ limit })}`);
}

export async function getTopTracks(timeRange = 'short_term', limit = 20) {
    return apiFetch(`/me/top/tracks${_qs({ time_range: timeRange, limit })}`);
}

export async function getQueue() {
    return apiFetch('/me/player/queue');
}

export async function addToQueue(uri, deviceId) {
    return _ensureDeviceAndRun(
        (devId) => apiFetch(`/me/player/queue${_qs({ uri, device_id: devId })}`, { method: 'POST' }),
        deviceId
    );
}

export async function search(query, types = 'track,playlist,album', limit = 10) {
    const safeLimit = Math.min(10, Math.max(1, Number(limit) || 10));
    return apiFetch(`/search${_qs({ q: query, type: types, limit: safeLimit })}`);
}
