/**
 * leaderboard.js — Serverless P2P Competitive Leaderboard for JEEMaxxing.
 * ----------------------------------------------------------------------------
 *
 *  CONNECTION & SIGNALING ARCHITECTURE
 *  ─────────────────────────────────────
 *   • Signaling transport (DEFAULT): a plain vanilla browser WebSocket opened
 *     directly against public WebTorrent announce trackers
 *       (wss://tracker.btorrent.xyz, wss://tracker.openwebtorrent.com,
 *        wss://tracker.webtorrent.dev).
 *     No dedicated signaling backend, no OAuth, no cloud tokens. The tracker
 *     only brokers the initial WebRTC handshake; it never sees telemetry.
 *
 *     The transport is a clean pluggable interface (see TrackerTransport /
 *     LocalBridgeTransport below). The DEFAULT is the spec-required public
 *     WebTorrent tracker transport; a LocalBridgeTransport is also exported
 *     for deterministic in-page verification (it reuses the exact same
 *     RTCPeerConnection / SDP / data-channel code over a local message bus).
 *
 *   • Room identification: a shared "Friend Connection Key" passphrase is
 *     normalised (trim → lowercase → collapse whitespace to "-") and hashed
 *     with SHA-1 to produce a deterministic 20-byte (40 hex char) infoHash.
 *     That infoHash is the blind discovery room id on the tracker swarm.
 *
 *   • Handshake exchange: SDP offers + answers (with full ICE candidates,
 *     non-trickle) are relayed as standard WebTorrent `announce` messages
 *     keyed by `offer_id`. The matching RTCDataChannel is established
 *     directly between the two browsers.
 *
 *   • Resource hygiene: the INSTANT a data channel reaches the `open`
 *     active state, the tracker WebSocket is closed automatically to free
 *     the socket. It is only re-opened if every channel later drops, so a
 *     peer can re-discover its friend without user intervention.
 *
 *  TELEMETRY PACKET (the ONLY thing that ever hits the wire)
 *  ────────────────────────────────────────────────────────
 *   {
 *     type:        "jeemax-arena",
 *     kind:        "telemetry",
 *     nickname:    <string>,
 *     globalElo:   <number>     // AppState.elo.global
 *     dailyVariation: <string>  // live #variance-val compliance rate text
 *     studyHours:  <number>     // (|⌊secs.physics⌋|+|⌊secs.chem⌋|+|⌊secs.maths⌋|)/3600
 *     timestamp:   <ISO string>
 *   }
 *
 *  SECURITY BOUNDARIES (HARD CONSTRAINTS — enforced by construction)
 *  ──────────────────────────────────────────────────────────────────
 *   • The telemetry packet is the sole wire payload. This module NEVER
 *     transmits, parses, or exposes AppState.questionBank, API key
 *     variables, or private backup/cloud configuration. There is no code
 *     path here that reads those fields.
 *   • Fully decoupled from local persistence: this module NEVER calls
 *     saveAllAsync() and never writes remote peer state into IndexedDB.
 *     Local sync files stay 100% isolated from peer state.
 *   • All signaling + data-channel listeners are asynchronous and
 *     non-blocking. Rendering is coalesced through a single
 *     requestAnimationFrame tick so it never contends with the
 *     high-frequency Apple-Pencil canvas strokes or candlestick-engine.js
 *     frames.
 *
 *  CONSUMPTION
 *  ───────────
 *   ES-module import (JEEMaxxing app.js):
 *       import { LeaderboardNet } from './leaderboard.js';
 *       LeaderboardNet.init(document.getElementById('view-leaderboard'), {
 *         getState: () => ({
 *           nickname: AppState.nickname || 'Anon',
 *           globalElo: AppState.elo?.global ?? 1200,
 *           dailyVariation: document.getElementById('variance-val')?.textContent ?? '0%',
 *           studyHours: (Math.abs(Math.floor(studySecs.physics||0)) +
 *                        Math.abs(Math.floor(studySecs.chemistry||0)) +
 *                        Math.abs(Math.floor(studySecs.maths||0))) / 3600,
 *         }),
 *       });
 *       // on question submit / study-duration update:
 *       LeaderboardNet.broadcastTelemetry();
 *
 *   Plain <script type="module" src="/leaderboard.js"> (preview harness):
 *       the module also publishes window.LeaderboardNet + window.createArena.
 *
 *  Both an ES `export` and a `window` global are emitted from this single
 *  source of truth — the file is byte-identical in both consumption paths.
 * ----------------------------------------------------------------------------
 */

// ── Public WebTorrent WebSocket trackers (signaling relays only) ────────
const TRACKERS = [
  'wss://tracker.btorrent.xyz',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
];

const PROTOCOL_TAG = 'jeemax-arena';
const RE_ANNOUNCE_MS = 5000;
const OFFER_TTL_MS = 12000;
// FIX #4: Extended from 2200ms → 5000ms. The original 2.2s budget was too
// short for non-trickle SDP execution on high-latency mobile networks
// (Jio/Airtel cellular, institutional Wi-Fi). STUN reflexive candidate
// gathering on a constrained path can easily take 3–4s before the server
// reflexive (srflx) address is returned; truncating at 2.2s produced
// truncated SDPs that silently failed ICE checks. 5s gives slow networks
// enough time to fully compile network pathways while still bounding the
// worst-case blocking window for the announce loop.
const ICE_GATHER_TIMEOUT_MS = 5000;
const TRACKER_RETRY_MS = 4000;
const MAX_PENDING_OFFERS = 2;
// FIX #2: Grace window before an inbound offer is accepted as a backup
// pathway. As the smaller peer (preferred initiator), we give our own
// outbound offer this long to receive an answer before falling back to
// processing the remote peer's inbound offer. This prevents the
// "both-responder" deadlock (where both peers end up with only responder
// PCs and no data-channel creator) in the common case where both peers are
// online and reachable, while still recovering from packet loss on the
// tracker swarm within a bounded window.
const BACKUP_OFFER_GRACE_MS = 3000;

// ── tiny crypto / hex helpers (Web Crypto, no deps) ─────────────────────
const toHex = (buf) => {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
};
const randHex = (nBytes) => {
  const a = new Uint8Array(nBytes);
  crypto.getRandomValues(a);
  return toHex(a.buffer);
};
const sha1hex = async (str) => {
  const data = new TextEncoder().encode(str);
  const d = await crypto.subtle.digest('SHA-1', data);
  return toHex(d);
};
async function roomInfoHash(passphrase) {
  const norm = String(passphrase || '').trim().toLowerCase().replace(/\s+/g, '-');
  return sha1hex(norm);
}
const escapeHTML = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// FIX #3: Expanded ICE infrastructure. The original three-server list
// (Google×2 + Twilio) fails completely when either peer is behind a strict
// Symmetric NAT (common on cellular data like Jio/Airtel or institutional
// Wi-Fi), because all three servers share similar network paths and any
// one of them being throttled/blackholed leaves zero reflexive candidates.
// The expanded pool includes Cloudflare, Nextcloud, Sipgate, and OpenRelay
// — geographically and topologically diverse — so at least one STUN
// handshake succeeds even under hostile NAT conditions. (TURN is
// intentionally omitted: this module is serverless and must not depend on
// credentials; symmetric NAT peers that cannot establish a direct path
// simply fail with a descriptive console diagnostic rather than silently
// hanging.)
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.nextcloud.com:443' },
  { urls: 'stun:stun.sipgate.net:3478' },
  { urls: 'stun:openrelay.metered.ca:80' },
];

// ── ICE gathering diagnostics (FIX #3) ──────────────────────────────────
// Emits a descriptive console warning when zero host or zero reflexive
// candidates were produced by the time ICE gathering finished. This is the
// canonical signature of a strict Symmetric NAT (every STUN binding is
// filtered/throttled) — the connection will fail ICE connectivity checks
// and the developer needs to see WHY rather than staring at a silent hang.
function _diagnoseIceCandidates(pc, hostCount, reflexiveCount) {
  const total = hostCount + reflexiveCount;
  if (total > 0 && hostCount > 0) return;  // healthy gathering; nothing to warn about.
  const parts = [];
  if (total === 0) parts.push('zero candidates produced');
  else if (hostCount === 0) parts.push('zero host candidates (mDNS obfuscation or no local interface)');
  if (reflexiveCount === 0 && total > 0) {
    parts.push('zero server-reflexive (srflx) candidates — all STUN servers unreachable');
  }
  if (parts.length === 0) return;
  console.warn(
    '[leaderboard] ICE gathering failure: ' + parts.join('; ') + '. ' +
    'This typically indicates a strict Symmetric NAT (e.g. Jio/Airtel cellular ' +
    'data or institutional Wi-Fi) or all STUN servers being blocked. ' +
    'host=' + hostCount + ' srflx/relay=' + reflexiveCount + ' ' +
    'state=' + (pc.iceGatheringState || 'unknown') + '. ' +
    'The handshake will likely fail; consider providing a TURN server in opts.iceServers ' +
    'for peers on hostile networks.'
  );
}

// ── RTC peer wrapper ────────────────────────────────────────────────────
class Peer {
  constructor(opts) {
    this.id = opts.id || null;
    this.offerId = opts.offerId || null;
    this.role = opts.role;
    this.iceServers = opts.iceServers || ICE_SERVERS;
    this.onOpen = opts.onOpen || null;
    this.onClose = opts.onClose || null;
    this.onMessage = opts.onMessage || null;
    this.onSignal = opts.onSignal || null;
    this.pc = null;
    this.dc = null;
    this._closed = false;
  }
  _newPC() {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    pc.onconnectionstatechange = () => {
      // Only 'failed' is terminal. 'disconnected' is frequently transient
      // (ICE re-checks) and must NOT tear down a live data channel — that
      // would kill an otherwise-healthy connection. Real failures surface via
      // dc.onclose / dc.onerror.
      if (pc.connectionState === 'failed' && (!this.dc || this.dc.readyState !== 'open')) {
        this._teardown();
      }
    };
    this.pc = pc;
    return pc;
  }
  async createOffer() {
    const pc = this._newPC();
    const dc = pc.createDataChannel('telemetry', { ordered: true });
    this._wireDC(dc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this._waitForIce(pc);
    if (this._closed) return;
    if (typeof this.onSignal === 'function') {
      this.onSignal({ kind: 'offer', offer: pc.localDescription, offerId: this.offerId });
    }
  }
  async receiveOffer(offerSdp, offerId) {
    this.offerId = offerId;
    const pc = this._newPC();
    pc.ondatachannel = (e) => this._wireDC(e.channel);
    await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this._waitForIce(pc);
    if (this._closed) return;
    if (typeof this.onSignal === 'function') {
      this.onSignal({ kind: 'answer', answer: pc.localDescription, offerId, to: this.id });
    }
  }
  async receiveAnswer(answerSdp) {
    if (!this.pc || this._closed) return;
    try { await this.pc.setRemoteDescription(new RTCSessionDescription(answerSdp)); }
    catch (_) { this._teardown(); }
  }
  _wireDC(dc) {
    this.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => { if (typeof this.onOpen === 'function') this.onOpen(this); };
    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data));
        if (typeof this.onMessage === 'function') this.onMessage(this, msg);
      } catch (_) { /* drop malformed */ }
    };
    dc.onclose = dc.onerror = () => this._teardown();
  }
  send(obj) {
    if (this.dc && this.dc.readyState === 'open') {
      try { this.dc.send(JSON.stringify(obj)); return true; } catch (_) { return false; }
    }
    return false;
  }
  _waitForIce(pc) {
    // FIX #4: State-aware ICE gathering wait. Resolves immediately when
    // `iceGatheringState` reaches 'complete' (fast path: all candidates
    // collected early — typically sub-second on healthy networks). Otherwise
    // waits up to ICE_GATHER_TIMEOUT_MS (5s, up from 2.2s) so that slow
    // mobile/cellular paths have time to compile the full candidate set
    // before the non-trickle SDP is sealed and announced.
    //
    // FIX #3 (diagnostics): tracks host vs. server-reflexive (srflx)
    // candidate counts. If zero of either type are produced by the time the
    // wait resolves, emits a descriptive console.warn so developers can see
    // that ICE will almost certainly fail (e.g. strict Symmetric NAT where
    // every STUN server is unreachable). The original code silently produced
    // a candidate-less SDP that peers would reject without explanation.
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        _diagnoseIceCandidates(pc, 0, 0);
        return resolve();
      }
      let hostCount = 0;
      let srflxCount = 0;
      let relayCount = 0;
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(t);
        try { pc.onicecandidate = null; } catch (_) {}
        _diagnoseIceCandidates(pc, hostCount, srflxCount + relayCount);
        resolve();
      };
      const t = setTimeout(finish, ICE_GATHER_TIMEOUT_MS);
      pc.onicecandidate = (e) => {
        if (e.candidate && typeof e.candidate.candidate === 'string') {
          const c = e.candidate.candidate;
          if (/\btyp host\b/.test(c)) hostCount++;
          else if (/\btyp srflx\b/.test(c)) srflxCount++;
          else if (/\btyp relay\b/.test(c)) relayCount++;
        } else if (e.candidate == null) {
          // null candidate signals end-of-gathering per the WebRTC spec.
          finish();
        }
      };
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') finish();
      };
    });
  }
  _teardown() {
    if (this._closed) return;
    this._closed = true;
    try { if (this.dc) this.dc.close(); } catch (_) {}
    try { if (this.pc) this.pc.close(); } catch (_) {}
    if (typeof this.onClose === 'function') this.onClose(this);
  }
  close() { this._teardown(); }
}

// ── Default transport: public WebTorrent WebSocket trackers ─────────────
// Brokers WebRTC SDP offer/answer exchange. The tracker only relays
// handshake bytes; it never sees telemetry (that flows over the direct
// RTCDataChannel once established).
//
// FIX #1: Simultaneous multi-announcing. The original implementation
// iterated through `TRACKERS` sequentially and stopped the moment any
// single WebSocket hit `onopen`. Because public WebTorrent trackers
// maintain isolated peer swarms, two peers that landed on different
// trackers would NEVER discover each other. The refactored transport now
// opens WebSocket connections to ALL trackers in `TRACKERS` in parallel,
// fans every announce/answer out to every open socket, and only retries
// the full set once ALL of them have closed (and no data channel is
// currently open). When a data channel reaches the 'open' state, the
// Arena calls `transport.close()` which gracefully tears down every active
// tracker socket to conserve resources (unchanged behaviour, now applied
// across the whole pool).
class TrackerTransport {
  constructor(arena) {
    this.a = arena;
    // Map<url, WebSocket> — every currently-open (or opening) tracker socket.
    // Replaces the old single-`ws` field so the transport can talk to the
    // entire swarm simultaneously.
    this.wsMap = new Map();
    this._openNotified = false;   // has _onTransportOpen fired for this session?
    this._retry = null;
    this._stopped = true;
  }
  open() {
    // Re-opening while already running is a no-op (the Arena calls open()
    // from _onPeerClose to recover after a disconnect — if we're already
    // mid-handshake there's nothing to do).
    if (!this._stopped) return;
    this._stopped = false;
    this._openNotified = false;
    for (const url of TRACKERS) this._connectOne(url);
  }
  // Open a single tracker socket. Called in parallel for every entry in
  // TRACKERS. Failures (constructor throw, onerror, onclose) are tolerated
  // silently — the surviving sockets still form the discovery swarm.
  _connectOne(url) {
    if (this._stopped || !this.a.roomKey) return;
    if (this.wsMap.has(url)) return;  // already trying
    let ws;
    try { ws = new WebSocket(url); } catch (_) { return; }
    ws.binaryType = 'arraybuffer';
    const owned = ws;
    this.wsMap.set(url, owned);
    ws.onopen = () => {
      if (this._stopped) { try { owned.close(); } catch (_) {} return; }
      // Fire _onTransportOpen exactly once per "session" — it kicks the
      // first announce out. Subsequent sockets that come online later
      // simply participate in the next fan-out announce (the re-announce
      // timer fires every RE_ANNOUNCE_MS and broadcasts to ALL open
      // sockets, so late joiners are covered within 5s).
      if (!this._openNotified) {
        this._openNotified = true;
        this.a._onTransportOpen();
      } else {
        // A new tracker just came online — give it an immediate announce
        // so its swarm learns about us without waiting for the 5s timer.
        // _sendAnnounceOffers is a no-op if we're at MAX_PENDING_OFFERS,
        // so this can't accidentally flood the swarm.
        this.a._sendAnnounceOffers();
      }
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        const txt = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
        msg = JSON.parse(txt);
      } catch (_) { return; }
      this.a._handleSignalMessage(msg);
    };
    ws.onerror = () => { try { owned.close(); } catch (_) {} };
    ws.onclose = () => {
      if (this.wsMap.get(url) === owned) this.wsMap.delete(url);
      // Only schedule a retry once EVERY tracker socket has dropped AND no
      // data channel is currently open. If a data channel is open we don't
      // need the trackers at all (resource conservation).
      if (!this._stopped && this.a.roomKey && !this.a._anyOpen() && this.wsMap.size === 0) {
        this.a._onTransportClose();
        if (this._retry) clearTimeout(this._retry);
        this._retry = setTimeout(() => {
          if (this._stopped || !this.a.roomKey || this.a._anyOpen() || this.wsMap.size > 0) return;
          this._openNotified = false;
          for (const u of TRACKERS) this._connectOne(u);
        }, TRACKER_RETRY_MS);
      }
    };
  }
  // Ready as long as AT LEAST ONE tracker socket is OPEN. The Arena gates
  // announce/answer sends on this so we don't fire into the void while all
  // sockets are still handshaking.
  isReady() {
    for (const ws of this.wsMap.values()) {
      if (ws.readyState === WebSocket.OPEN) return true;
    }
    return false;
  }
  // Fan-out: serialize once, send to EVERY open tracker socket. This is the
  // core of the multi-announce fix — the same offer/answer hits every
  // tracker's swarm simultaneously, so peers on different trackers discover
  // each other instead of being siloed.
  send(obj) {
    if (this.wsMap.size === 0) return;
    const txt = JSON.stringify(obj);
    for (const ws of this.wsMap.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(txt); } catch (_) {}
      }
    }
  }
  close() {
    this._stopped = true;
    if (this._retry) { clearTimeout(this._retry); this._retry = null; }
    for (const ws of this.wsMap.values()) {
      try { ws.close(); } catch (_) {}
    }
    this.wsMap.clear();
    this._openNotified = false;
  }
}

// ── Local bridge transport (deterministic in-page verification) ─────────
// Reuses the EXACT same Peer / RTCPeerConnection / SDP / data-channel code
// as the real path, but routes signaling through an in-page message bus.
// Used by the preview harness to verify end-to-end P2P without depending on
// public-tracker relay availability. NOT used by the app.js integration.
class LocalBridge {
  constructor() { this.subs = new Map(); }   // peerId → fn(msg)
  subscribe(peerId, fn) { this.subs.set(peerId, fn); }
  unsubscribe(peerId) { this.subs.delete(peerId); }
  publish(msg, fromId) {
    this.subs.forEach((fn, id) => { if (id !== fromId) fn(msg); });
  }
}
class LocalBridgeTransport {
  constructor(arena, bridge) {
    this.a = arena;
    this.bridge = bridge;
    this._fn = null;
    this._stopped = true;
  }
  open() {
    this._stopped = false;
    this._fn = (msg) => this.a._handleSignalMessage(msg);
    this.bridge.subscribe(this.a.peerId, this._fn);
    this.a._onTransportOpen();
  }
  isReady() { return !this._stopped; }
  send(obj) {
    if (this._stopped) return;
    // Mimic the WebTorrent tracker: an announce carrying an `offers` array is
    // unwrapped into individual singular offer messages ({offer, offer_id})
    // and each is delivered to the OTHER subscribers. The arena's
    // _handleSignalMessage expects the singular `msg.offer` form (the same
    // form the real tracker relays). Answers are already singular.
    if (obj && obj.action === 'announce' && Array.isArray(obj.offers)) {
      const fromId = this.a.peerId;
      for (const o of obj.offers) {
        this.bridge.publish({
          action: 'announce',
          info_hash: obj.info_hash,
          peer_id: obj.peer_id,
          offer: o.offer,
          offer_id: o.offer_id,
        }, fromId);
      }
      return;
    }
    this.bridge.publish(obj, this.a.peerId);
  }
  close() {
    this._stopped = true;
    if (this._fn) this.bridge.unsubscribe(this.a.peerId);
  }
}

// ── Arena engine ────────────────────────────────────────────────────────
class Arena {
  constructor() {
    this.container = null;
    this.getState = null;
    this.transport = null;
    this.roomKey = null;
    this.infoHash = null;
    this.peerId = null;
    this.nickname = 'Anon';
    this.status = 'offline';
    this._announceTimer = null;
    this.peers = new Map();
    this._pendingOffers = new Map();
    this.telemetry = new Map();
    this.prevElo = new Map();
    this.selfPrevElo = null;
    this._renderRAF = 0;
    this._shellBuilt = false;
    this._stats = { offerSent: 0, answerSent: 0, offerRecv: 0, answerRecv: 0, open: 0, close: 0, msgRecv: 0 };
  }

  init(container, opts = {}) {
    this.container = (typeof container === 'string')
      ? document.querySelector(container) : container;
    this.getState = opts.getState || (() => ({
      nickname: 'Anon', globalElo: 1200, dailyVariation: '0%', studyHours: 0,
    }));
    this.transport = opts.transport || new TrackerTransport(this);
    // Configurable ICE servers. The default (STUN) suits the real public-
    // tracker path (cross-network peers). A local/in-page bridge should pass
    // iceServers:[] so only host candidates are gathered — instant, no STUN.
    this.iceServers = opts.iceServers || ICE_SERVERS;
    this._buildShell();
    this._shellBuilt = true;
    this._render();
  }

  async connect(roomKey, nickname) {
    if (this.status !== 'offline') this.disconnect();
    this.roomKey = roomKey;
    this.nickname = nickname || ('Anon-' + Math.floor(Math.random() * 9000 + 1000));
    this.peerId = randHex(20);
    this.infoHash = await roomInfoHash(roomKey);
    this._setStatus('connecting');
    this.transport.open();
    this._announceTimer = setInterval(() => {
      if (this.roomKey && !this._anyOpen() && this._pendingOffers.size < MAX_PENDING_OFFERS) {
        this._sendAnnounceOffers();
      }
    }, RE_ANNOUNCE_MS);
    this._render();
  }

  disconnect() {
    if (this._announceTimer) { clearInterval(this._announceTimer); this._announceTimer = null; }
    this.peers.forEach((p) => p.close());
    this.peers.clear();
    this._pendingOffers.forEach((p) => p.close());
    this._pendingOffers.clear();
    this.telemetry.clear();
    this.prevElo.clear();
    if (this.transport) this.transport.close();
    this.roomKey = null; this.infoHash = null; this.peerId = null;
    this._setStatus('offline');
    this._render();
  }

  broadcastTelemetry() {
    const s = this.getState() || {};
    const pkt = {
      type: PROTOCOL_TAG,
      kind: 'telemetry',
      nickname: String(s.nickname ?? this.nickname),
      globalElo: Math.round(Number(s.globalElo) || 0),
      dailyVariation: String(s.dailyVariation ?? '0%'),
      studyHours: Number(s.studyHours) || 0,
      timestamp: new Date().toISOString(),
    };
    let delivered = false;
    this.peers.forEach((p) => { if (p.send(pkt)) delivered = true; });
    this._mergeSelf(pkt);
    return delivered;
  }

  refresh() { this._render(); }

  // ── transport callbacks ─────────────────────────────────────────────
  _onTransportOpen() {
    this._setStatus(this._anyOpen() ? 'online' : 'connecting');
    this._sendAnnounceOffers();
  }
  _onTransportClose() {
    if (this.roomKey && !this._anyOpen()) this._setStatus('connecting');
  }

  _sendAnnounceOffers() {
    if (!this.transport || !this.transport.isReady() || !this.infoHash) return;
    if (this._pendingOffers.size >= MAX_PENDING_OFFERS) return;
    const offerId = randHex(16);
    const p = new Peer({
      id: null, offerId, role: 'initiator', iceServers: this.iceServers,
      onOpen: (peer) => this._onPeerOpen(peer),
      onClose: (peer) => this._onPeerClose(peer),
      onMessage: (peer, msg) => this._onPeerMessage(peer, msg),
      onSignal: (m) => {
        if (m.kind === 'offer') {
          this._stats.offerSent++;
          this.transport.send({
            action: 'announce',
            info_hash: this.infoHash,
            peer_id: this.peerId,
            offers: [{ offer: m.offer, offer_id: m.offerId }],
            numwant: 4, uploaded: 0, downloaded: 0, left: 1, event: '',
          });
        }
      },
    });
    // FIX #2: stamp the creation time so the state-aware tie-breaker can
    // tell "our outbound offer is fresh, give it a chance to be answered"
    // apart from "our outbound offer has been outstanding long enough that
    // it probably never reached the remote peer (packet loss on the tracker
    // swarm) — accept an inbound offer as a backup pathway".
    p._createdAt = Date.now();
    this._pendingOffers.set(offerId, p);
    p.createOffer().catch(() => p.close());
    setTimeout(() => {
      if (this._pendingOffers.get(offerId) === p) {
        this._pendingOffers.delete(offerId);
        p.close();
      }
    }, OFFER_TTL_MS);
  }

  // FIX #2: Returns true if `peerId` already has an active connection OR a
  // verified pending channel (i.e. a Peer in `this.peers` whose
  // RTCPeerConnection is successfully negotiating or whose data channel is
  // already open / connecting). Used by the resilient tie-breaker to decide
  // whether to ghost an inbound offer or accept it as a backup pathway.
  _hasVerifiedConnection(peerId) {
    const existing = this.peers.get(peerId);
    if (!existing || existing._closed) return false;
    const dcState = existing.dc ? existing.dc.readyState : 'closed';
    if (dcState === 'open' || dcState === 'connecting') return true;
    const pcState = existing.pc ? existing.pc.connectionState : 'closed';
    if (['new', 'connecting', 'connected', 'checking', 'completed'].includes(pcState)) return true;
    return false;
  }

  // FIX #2: Returns true if our oldest pending outbound offer has been
  // outstanding longer than BACKUP_OFFER_GRACE_MS. Used by the tie-breaker
  // to fall back to the inbound offer when our own initiator has had enough
  // time to receive an answer but hasn't (suggesting the offer was lost on
  // the tracker swarm).
  _outboundOfferStale() {
    if (this._pendingOffers.size === 0) return false;
    const now = Date.now();
    let oldest = Infinity;
    this._pendingOffers.forEach((p) => {
      const t = p._createdAt || 0;
      if (t < oldest) oldest = t;
    });
    return (now - oldest) >= BACKUP_OFFER_GRACE_MS;
  }

  // Incoming signaling message (offer from a peer, or answer to our offer).
  _handleSignalMessage(msg) {
    if (!msg || msg.action !== 'announce') return;
    if (msg.info_hash && msg.info_hash !== this.infoHash) return;
    if (msg.peer_id && msg.peer_id === this.peerId) return;

    // inbound offer → respond
    if (msg.offer && msg.offer_id && msg.peer_id) {
      this._stats.offerRecv++;
      // FIX #2: Resilient, state-aware tie-breaker.
      //
      // Original behaviour: if `this.peerId < msg.peer_id`, unconditionally
      // ghost the inbound offer so our own outbound initiator wins. This
      // deadlocks completely when the outbound offer's packet is lost on
      // the tracker swarm — the remote peer never sees our offer, and we
      // refuse to process theirs, so no connection ever forms.
      //
      // New behaviour: ghost the inbound offer ONLY when one of these is
      // true:
      //   (a) we already have an active or verified-pending connection for
      //       this specific peer_id (dedup — prevents double-responder),
      //   (b) we are the smaller peer AND our outbound offer is still fresh
      //       (younger than BACKUP_OFFER_GRACE_MS) — give our initiator a
      //       fair chance to be answered before falling back.
      // Otherwise process the inbound offer as a backup pathway. The
      // existing _onPeerOpen dedup (only one open data channel per peer_id)
      // ensures we end up with exactly one live connection even if both
      // sides race.
      if (this._hasVerifiedConnection(msg.peer_id)) return;
      if (this.peerId < msg.peer_id && !this._outboundOfferStale()) {
        // We're the preferred initiator and our outbound offer is still
        // fresh — ghost this inbound offer and let our initiator win.
        return;
      }
      // Either we're the larger peer (always process), or we're the smaller
      // peer but our outbound offer has gone stale (likely lost on the
      // tracker swarm). Accept the inbound offer as a backup pathway.
      //
      // If a stale/closed responder entry lingers in `this.peers` for this
      // peer_id (e.g. its PC failed but _onPeerClose hasn't run yet),
      // overwrite it — the new responder is the live one.
      const responder = new Peer({
        id: msg.peer_id, offerId: msg.offer_id, role: 'responder', iceServers: this.iceServers,
        onOpen: (peer) => this._onPeerOpen(peer),
        onClose: (peer) => this._onPeerClose(peer),
        onMessage: (peer, m) => this._onPeerMessage(peer, m),
        onSignal: (m) => {
          if (m.kind === 'answer') {
            this._stats.answerSent++;
            this.transport.send({
              action: 'announce',
              info_hash: this.infoHash,
              peer_id: this.peerId,
              to_peer_id: msg.peer_id,
              answer: m.answer,
              offer_id: m.offerId,
            });
          }
        },
      });
      this.peers.set(msg.peer_id, responder);
      responder.receiveOffer(msg.offer, msg.offer_id).catch(() => responder._teardown());
      return;
    }

    // inbound answer → complete a pending initiator
    if (msg.answer && msg.offer_id && msg.peer_id) {
      this._stats.answerRecv++;
      const p = this._pendingOffers.get(msg.offer_id);
      if (!p) return;
      this._pendingOffers.delete(msg.offer_id);
      // FIX #2: If a (likely stale) responder entry exists for this peer_id
      // but is NOT verified (no open/connecting DC, PC not actively
      // negotiating), tear it down and let our fresh initiator take the
      // slot. This is the recovery path for the "both-responder" race: our
      // outbound initiator got answered, so it should win over a responder
      // we created speculatively as a backup. If the existing entry IS
      // verified (DC open or PC successfully negotiating), keep it and drop
      // the redundant initiator — the connection is already forming.
      if (this.peers.has(msg.peer_id)) {
        const existing = this.peers.get(msg.peer_id);
        if (existing && !existing._closed) {
          const dcState = existing.dc ? existing.dc.readyState : 'closed';
          const pcState = existing.pc ? existing.pc.connectionState : 'closed';
          const verified =
            dcState === 'open' || dcState === 'connecting' ||
            ['connecting', 'connected', 'checking', 'completed'].includes(pcState);
          if (verified) { p.close(); return; }
          // Stale but not yet reaped — tear it down to make room.
          existing._teardown();
        }
        this.peers.delete(msg.peer_id);
      }
      p.id = msg.peer_id;
      this.peers.set(msg.peer_id, p);
      p.receiveAnswer(msg.answer).catch(() => p._teardown());
      return;
    }
  }

  _onPeerOpen(peer) {
    this._stats.open++;
    let openCount = 0;
    this.peers.forEach((p, id) => {
      if (id === peer.id && p !== peer && p.dc && p.dc.readyState === 'open') openCount++;
    });
    if (openCount > 0) { peer.close(); return; }
    this._setStatus('online');
    // ── resource conservation: drop the signaling transport now ──
    if (this.transport) this.transport.close();
    if (this._announceTimer) { clearInterval(this._announceTimer); this._announceTimer = null; }
    this.broadcastTelemetry();
    this._render();
  }

  _onPeerClose(peer) {
    this._stats.close++;
    // FIX #2: Only reap the map entry if the closing Peer is still the one
    // registered for this id. The state-aware tie-breaker can overwrite a
    // stale/closed responder with a fresh backup responder for the same
    // peer_id; if we then naively did `this.peers.delete(peer.id)` when the
    // stale one finally fires its _teardown, we'd nuke the live replacement.
    // Guarding with an identity check makes that race safe.
    if (peer.id && this.peers.get(peer.id) === peer) {
      this.peers.delete(peer.id);
      this.telemetry.delete(peer.id);
      this.prevElo.delete(peer.id);
    }
    this._pendingOffers.forEach((p, k) => { if (p === peer) this._pendingOffers.delete(k); });
    if (!this._anyOpen()) {
      this._setStatus(this.roomKey ? 'connecting' : 'offline');
      if (this.roomKey) {
        if (this.transport) this.transport.open();
        if (!this._announceTimer) {
          this._announceTimer = setInterval(() => {
            if (this.roomKey && !this._anyOpen() && this._pendingOffers.size < MAX_PENDING_OFFERS) {
              this._sendAnnounceOffers();
            }
          }, RE_ANNOUNCE_MS);
        }
      }
    }
    this._render();
  }

  _onPeerMessage(peer, msg) {
    if (!msg || msg.type !== PROTOCOL_TAG) return;
    if (msg.kind !== 'telemetry' && msg.kind !== 'hello') return;
    this._stats.msgRecv++;
    const prev = this.telemetry.get(peer.id);
    if (typeof msg.globalElo === 'number') {
      this.prevElo.set(peer.id, prev ? prev.globalElo : msg.globalElo);
    }
    this.telemetry.set(peer.id, {
      nickname: msg.nickname || 'Friend',
      globalElo: msg.globalElo,
      dailyVariation: msg.dailyVariation,
      studyHours: msg.studyHours,
      timestamp: msg.timestamp,
      ts: Date.now(),
    });
    this._scheduleRender();
  }

  _mergeSelf(pkt) {
    if (typeof pkt.globalElo === 'number') {
      this.prevElo.set('__self__', this.selfPrevElo == null ? pkt.globalElo : this.selfPrevElo);
      this.selfPrevElo = pkt.globalElo;
    }
    this.telemetry.set('__self__', {
      nickname: pkt.nickname,
      globalElo: pkt.globalElo,
      dailyVariation: pkt.dailyVariation,
      studyHours: pkt.studyHours,
      timestamp: pkt.timestamp,
      ts: Date.now(),
      self: true,
    });
    this._scheduleRender();
  }

  _anyOpen() {
    for (const p of this.peers.values()) if (p.dc && p.dc.readyState === 'open') return true;
    return false;
  }
  _setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this._scheduleRender();
  }
  _scheduleRender() {
    if (this._renderRAF) return;
    this._renderRAF = requestAnimationFrame(() => {
      this._renderRAF = 0;
      this._render();
    });
  }

  // ── UI ──────────────────────────────────────────────────────────────
  _buildShell() {
    if (!this.container) return;
    this.container.innerHTML = LB_SHELL_HTML;
    const nick = this.container.querySelector('#lb-nick');
    const key = this.container.querySelector('#lb-key');
    const btn = this.container.querySelector('#lb-btn');
    const info = this.container.querySelector('#lb-room-info');
    if (nick) nick.value = this.nickname || '';
    if (btn) btn.addEventListener('click', async () => {
      if (this.status === 'offline') {
        const k = (key && key.value || '').trim();
        const n = (nick && nick.value || '').trim() || ('Anon-' + Math.floor(Math.random() * 9000 + 1000));
        if (!k) { if (key) key.focus(); return; }
        if (info) info.textContent = 'Deriving 20-byte SHA-1 infoHash from key…';
        await this.connect(k, n);
        if (info) {
          info.innerHTML =
            `Room infoHash: <code>${escapeHTML(this.infoHash)}</code> · ` +
            `peer_id: <code>${escapeHTML((this.peerId || '').slice(0, 16))}…</code>`;
        }
      } else {
        this.disconnect();
        if (info) info.textContent = '';
      }
    });
  }

  _render() {
    if (!this._shellBuilt || !this.container) return;
    const beacon = this.container.querySelector('#lb-beacon');
    const statusText = this.container.querySelector('#lb-status-text');
    const btn = this.container.querySelector('#lb-btn');
    const grid = this.container.querySelector('#lb-grid');
    const map = {
      online: { dot: 'lb-dot online', text: 'ONLINE', cls: 'glow' },
      connecting: { dot: 'lb-dot connecting', text: 'CONNECTING…', cls: 'dim' },
      offline: { dot: 'lb-dot offline', text: 'OFFLINE', cls: 'dim' },
    };
    const m = map[this.status] || map.offline;
    if (beacon) beacon.className = m.dot;
    if (statusText) { statusText.textContent = m.text; statusText.className = 'lb-status-text ' + m.cls; }
    if (btn) {
      btn.textContent = (this.status === 'offline') ? 'Connect' : 'Disconnect';
      btn.className = 'lb-btn' + (this.status === 'offline' ? '' : ' danger');
    }
    if (!grid) return;
    const rows = [];
    const selfT = this.telemetry.get('__self__');
    if (selfT) rows.push({ ...selfT, id: '__self__', self: true, connected: this.status === 'online' });
    this.peers.forEach((p, id) => {
      const t = this.telemetry.get(id) || { nickname: 'Friend', globalElo: null };
      const open = !!(p.dc && p.dc.readyState === 'open');
      rows.push({ ...t, id, self: false, connected: open });
    });
    rows.sort((a, b) => {
      if (a.self) return -1; if (b.self) return 1;
      return (b.globalElo || 0) - (a.globalElo || 0);
    });
    grid.innerHTML = rows.length
      ? rows.map((r) => this._cardHTML(r)).join('')
      : `<div class="lb-empty">No peers in this room yet. Share the same Friend Connection Key with a friend — they'll appear here the instant the WebRTC data channel opens.</div>`;
  }

  _cardHTML(r) {
    const prev = this.prevElo.get(r.id);
    let trend = '';
    if (typeof prev === 'number' && typeof r.globalElo === 'number' && prev !== r.globalElo) {
      trend = r.globalElo > prev
        ? '<span class="lb-trend up" title="ELO rising">▲</span>'
        : '<span class="lb-trend down" title="ELO falling">▼</span>';
    }
    const presence = r.connected
      ? '<span class="lb-presence online" title="data channel open"></span>'
      : '<span class="lb-presence offline" title="data channel closed"></span>';
    const elo = (typeof r.globalElo === 'number') ? Math.round(r.globalElo).toLocaleString() : '—';
    const studyH = (typeof r.studyHours === 'number') ? r.studyHours.toFixed(2) + 'h' : '—';
    const dv = (r.dailyVariation == null) ? '—' : escapeHTML(String(r.dailyVariation));
    const name = escapeHTML(r.nickname || (r.self ? this.nickname : 'Friend'));
    const ts = r.timestamp
      ? `<div class="lb-ts">↳ updated ${escapeHTML(new Date(r.timestamp).toLocaleTimeString())}</div>` : '';
    return (
      `<div class="lb-card${r.self ? ' self' : ''}">` +
        `<div class="lb-card-head">` +
          `<span class="lb-nick">${r.self ? '<span class="lb-self-tag">YOU</span> ' : ''}<span>${name}</span></span>` +
          presence +
        `</div>` +
        `<div class="lb-card-body">` +
          `<div class="lb-metric"><span class="lb-label">Global ELO</span>` +
            `<span class="lb-value">${elo} ${trend}</span></div>` +
          `<div class="lb-metric"><span class="lb-label">Daily Variance</span>` +
            `<span class="lb-value">${dv}</span></div>` +
          `<div class="lb-metric"><span class="lb-label">Study Hours</span>` +
            `<span class="lb-value">${studyH}</span></div>` +
        `</div>` +
        ts +
      `</div>`
    );
  }
}

// ── Shell markup + scoped styles (injected once per arena instance) ─────
const LB_SHELL_HTML = `
  <style>
    .lb-shell{--glow:#22e57a;--glow-dim:#3a4a55;--danger:#ff5d5d;--bg:#0b0e12;--card:#12161c;--card-2:#0e1217;
      --line:#1d2730;--text:#e6eef2;--muted:#7d8b94;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      color:var(--text);background:transparent;}
    .lb-shell *{box-sizing:border-box;}
    .lb-shell h2{margin:0;font-size:18px;font-weight:700;letter-spacing:.2px;}
    .lb-shell .lb-sub{margin:4px 0 0;font-size:12px;color:var(--muted);}
    .lb-shell .lb-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;
      flex-wrap:wrap;padding:4px 2px;}
    .lb-shell .lb-status{display:flex;align-items:center;gap:9px;padding:7px 12px;border:1px solid var(--line);
      border-radius:999px;background:var(--card);white-space:nowrap;}
    .lb-dot{width:9px;height:9px;border-radius:50%;background:var(--glow-dim);flex:none;transition:all .25s ease;}
    .lb-dot.online{background:var(--glow);box-shadow:0 0 0 0 rgba(34,229,122,.7);animation:lb-pulse 1.8s infinite;}
    .lb-dot.connecting{background:#f5a623;animation:lb-blink 1s infinite;}
    .lb-dot.offline{background:var(--glow-dim);}
    @keyframes lb-pulse{0%{box-shadow:0 0 0 0 rgba(34,229,122,.55)}70%{box-shadow:0 0 0 9px rgba(34,229,122,0)}100%{box-shadow:0 0 0 0 rgba(34,229,122,0)}}
    @keyframes lb-blink{0%,100%{opacity:1}50%{opacity:.35}}
    .lb-status-text{font-size:11px;font-weight:700;letter-spacing:1.2px;}
    .lb-status-text.glow{color:var(--glow);text-shadow:0 0 8px rgba(34,229,122,.6);}
    .lb-status-text.dim{color:var(--muted);}
    .lb-shell .lb-controls{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 6px;}
    .lb-input{flex:1 1 180px;min-width:0;background:var(--card);border:1px solid var(--line);color:var(--text);
      padding:11px 13px;border-radius:10px;font-size:13px;outline:none;transition:border-color .15s,box-shadow .15s;}
    .lb-input:focus{border-color:var(--glow);box-shadow:0 0 0 3px rgba(34,229,122,.15);}
    .lb-input::placeholder{color:#56636b;}
    .lb-btn{flex:0 0 auto;padding:11px 22px;border-radius:10px;border:1px solid var(--glow);background:rgba(34,229,122,.12);
      color:var(--glow);font-weight:700;font-size:13px;letter-spacing:.4px;cursor:pointer;transition:all .15s ease;}
    .lb-btn:hover{background:rgba(34,229,122,.22);}
    .lb-btn.danger{border-color:var(--danger);color:var(--danger);background:rgba(255,93,93,.1);}
    .lb-btn.danger:hover{background:rgba(255,93,93,.2);}
    .lb-room-info{font-size:11px;color:var(--muted);margin:2px 2px 14px;word-break:break-all;}
    .lb-room-info code{background:var(--card);padding:2px 6px;border-radius:5px;color:#9fe7b8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
    .lb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;}
    .lb-card{background:linear-gradient(160deg,var(--card),var(--card-2));border:1px solid var(--line);border-radius:14px;
      padding:15px 16px;transition:transform .15s ease,border-color .15s ease;position:relative;overflow:hidden;}
    .lb-card:hover{transform:translateY(-2px);border-color:#26343f;}
    .lb-card.self{border-color:rgba(34,229,122,.45);box-shadow:0 0 0 1px rgba(34,229,122,.12),0 8px 24px -12px rgba(34,229,122,.25);}
    .lb-card.self::before{content:"";position:absolute;inset:0;background:radial-gradient(120% 80% at 100% 0%,rgba(34,229,122,.08),transparent 60%);pointer-events:none;}
    .lb-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;}
    .lb-nick{font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px;min-width:0;}
    .lb-nick span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .lb-self-tag{font-size:9px;font-weight:800;letter-spacing:1px;background:var(--glow);color:#06210f;padding:2px 6px;border-radius:5px;flex:none;}
    .lb-presence{width:10px;height:10px;border-radius:50%;flex:none;transition:all .25s;}
    .lb-presence.online{background:var(--glow);box-shadow:0 0 8px rgba(34,229,122,.8);}
    .lb-presence.offline{background:var(--glow-dim);}
    .lb-card-body{display:flex;flex-direction:column;gap:9px;}
    .lb-metric{display:flex;align-items:baseline;justify-content:space-between;gap:8px;border-top:1px dashed #1b2530;padding-top:8px;}
    .lb-metric:first-child{border-top:none;padding-top:0;}
    .lb-label{font-size:10.5px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);}
    .lb-value{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;}
    .lb-trend{font-size:12px;margin-left:4px;vertical-align:middle;}
    .lb-trend.up{color:var(--glow);}
    .lb-trend.down{color:var(--danger);}
    .lb-ts{margin-top:11px;font-size:10.5px;color:#5a6770;}
    .lb-empty{grid-column:1/-1;text-align:center;color:var(--muted);font-size:13px;padding:34px 18px;
      border:1px dashed var(--line);border-radius:12px;background:var(--card-2);line-height:1.6;}
    @media (max-width:520px){.lb-grid{grid-template-columns:1fr;}.lb-shell .lb-header{flex-direction:column;}}
  </style>
  <div class="lb-shell">
    <div class="lb-header">
      <div>
        <h2>P2P Leaderboard Arena</h2>
        <p class="lb-sub">Serverless WebRTC · WebTorrent tracker signaling · zero-auth friend rooms</p>
      </div>
      <div class="lb-status">
        <span id="lb-beacon" class="lb-dot offline"></span>
        <span id="lb-status-text" class="lb-status-text dim">OFFLINE</span>
      </div>
    </div>
    <div class="lb-controls">
      <input id="lb-nick" class="lb-input" placeholder="Your nickname" maxlength="24" autocomplete="off" />
      <input id="lb-key" class="lb-input" placeholder="Friend Connection Key (shared passphrase)" maxlength="64" autocomplete="off" />
      <button id="lb-btn" class="lb-btn">Connect</button>
    </div>
    <div id="lb-room-info" class="lb-room-info"></div>
    <div id="lb-grid" class="lb-grid"></div>
  </div>`;

// ── Exports: singleton + factory (multi-instance preview) ───────────────
function createArena(opts) {
  const a = new Arena();
  if (typeof window !== 'undefined') (window.__arenas = window.__arenas || []).push(a);
  return a;
}
const LeaderboardNet = createArena();

if (typeof window !== 'undefined') {
  window.LeaderboardNet = LeaderboardNet;
  window.createArena = createArena;
  window.JEEMaxArena = {
    LeaderboardNet, createArena, Arena, TrackerTransport,
    LocalBridge, LocalBridgeTransport, PROTOCOL_TAG,
  };
}

export {
  LeaderboardNet, createArena, Arena, TrackerTransport,
  LocalBridge, LocalBridgeTransport, PROTOCOL_TAG, roomInfoHash,
};
export default LeaderboardNet;
