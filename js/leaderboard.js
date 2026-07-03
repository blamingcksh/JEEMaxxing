/**
 * leaderboard.js — Centralized Serverless Realtime Database Arena for JEEMaxxing.
 * Backed by Supabase Postgres Realtime Engine. Zero configuration mesh.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ⚠️ PASTE YOUR SECURE CREDENTIALS HERE
const SUPABASE_URL = 'https://qioveiiivlxhpehscgvk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_R9GPQiNeCBX1ZH_69kSyrw_0Hrxts79';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const PROTOCOL_TAG = 'jeemax-arena';

const escapeHTML = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

class Arena {
  constructor() {
    this.container = null;
    this.getState = null;
    this.roomKey = null;
    this.peerId = null;
    this.nickname = 'Anon';
    this.status = 'offline';
    this.telemetry = new Map();
    this.prevElo = new Map();
    this.selfPrevElo = null;
    this._renderRAF = 0;
    this._shellBuilt = false;
    this.supabaseChannel = null;
    this._heartbeatInterval = null;
  }

  init(container, opts = {}) {
    this.container = (typeof container === 'string') ? document.querySelector(container) : container;
    this.getState = opts.getState || (() => ({
      nickname: 'Anon', globalElo: 1200, dailyVariation: '0%', studyHours: 0,
    }));
    this._buildShell();
    this._shellBuilt = true;
    this._render();
  }

  async connect(roomKey, nickname) {
    if (this.status !== 'offline') this.disconnect();
    
    this.roomKey = roomKey.trim().toLowerCase().replace(/\s+/g, '-');
    this.nickname = nickname.trim() || ('Anon-' + Math.floor(Math.random() * 9000 + 1000));
    this.peerId = localStorage.getItem('jeemax_arena_peer_id') || crypto.randomUUID();
    localStorage.setItem('jeemax_arena_peer_id', this.peerId);

    this._setStatus('connecting');

    try {
      // 1. Fetch existing players inside this passphrase group room
      const { data, error } = await supabase
        .from('arena_leaderboard')
        .select('*')
        .eq('room_key', this.roomKey);

      if (error) throw error;

      // Hydrate local cache map data
      if (data) {
        data.forEach(row => {
          if (row.peer_id === this.peerId) return;
          this.telemetry.set(row.peer_id, {
            nickname: row.nickname,
            globalElo: row.global_elo,
            dailyVariation: row.daily_variation,
            studyHours: row.study_hours,
            timestamp: row.updated_at,
          });
        });
      }

      // 2. Broadcast our own initial state footprint row
      await this.broadcastTelemetry();
      this._setStatus('online');

      // 3. Mount Realtime WebSocket channel pipeline for this specific room
      this.supabaseChannel = supabase
        .channel(`room:${this.roomKey}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'arena_leaderboard', filter: `room_key=eq.${this.roomKey}` }, (payload) => {
          const row = payload.new || payload.old;
          if (!row || row.peer_id === this.peerId) return;

          // If a peer record drops or hasn't updated in 5 minutes, delete it
          if (payload.eventType === 'DELETE') {
            this.telemetry.delete(row.peer_id);
            this.prevElo.delete(row.peer_id);
          } else {
            const prev = this.telemetry.get(row.peer_id);
            if (prev) this.prevElo.set(row.peer_id, prev.globalElo);
            
            this.telemetry.set(row.peer_id, {
              nickname: row.nickname,
              globalElo: row.global_elo,
              dailyVariation: row.daily_variation,
              studyHours: row.study_hours,
              timestamp: row.updated_at,
            });
          }
          this._scheduleRender();
        })
        .subscribe();

      // 4. Start active presence heartbeat tracking loop (Every 30 seconds)
      this._heartbeatInterval = setInterval(() => this.broadcastTelemetry(), 30000);

    } catch (err) {
      console.error('Arena connection error:', err);
      this.disconnect();
    }
  }

  disconnect() {
    if (this._heartbeatInterval) { clearInterval(this._heartbeatInterval); this._heartbeatInterval = null; }
    if (this.supabaseChannel) { supabase.removeChannel(this.supabaseChannel); this.supabaseChannel = null; }
    
    // Cleanly delete our own database row when clicking disconnect so the boards clear for friends
    if (this.peerId && this.status === 'online') {
      supabase.from('arena_leaderboard').delete().eq('peer_id', this.peerId).then(() => {});
    }

    this.telemetry.clear();
    this.prevElo.clear();
    this.roomKey = null; this.peerId = null;
    this._setStatus('offline');
  }

  async broadcastTelemetry() {
    if (!this.roomKey || !this.peerId) return false;
    const s = this.getState() || {};
    
    const payload = {
      peer_id: this.peerId,
      room_key: this.roomKey,
      nickname: String(s.nickname ?? this.nickname),
      global_elo: Math.round(Number(s.globalElo) || 0),
      daily_variation: String(s.dailyVariation ?? '0%'),
      study_hours: Number(s.studyHours) || 0,
      updated_at: new Date().toISOString()
    };

    this._mergeSelf({
      nickname: payload.nickname,
      globalElo: payload.global_elo,
      dailyVariation: payload.daily_variation,
      studyHours: payload.study_hours,
      timestamp: payload.updated_at
    });

    const { error } = await supabase.from('arena_leaderboard').upsert(payload);
    return !error;
  }

  refresh() {
    this._render();
  }

  _mergeSelf(pkt) {
    this.prevElo.set('__self__', this.selfPrevElo == null ? pkt.globalElo : this.selfPrevElo);
    this.selfPrevElo = pkt.globalElo;
    this.telemetry.set('__self__', {
      nickname: pkt.nickname,
      globalElo: pkt.globalElo,
      dailyVariation: pkt.dailyVariation,
      studyHours: pkt.studyHours,
      timestamp: pkt.timestamp,
      self: true,
      connected: true
    });
    this._scheduleRender();
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

  _buildShell() {
    if (!this.container) return;
    this.container.innerHTML = LB_SHELL_HTML;
    const nick = this.container.querySelector('#lb-nick');
    const key = this.container.querySelector('#lb-key');
    const btn = this.container.querySelector('#lb-btn');
    const info = this.container.querySelector('#lb-room-info');
    if (nick) nick.value = this.nickname || '';
    if (btn) {
      btn.addEventListener('click', async () => {
        if (this.status === 'offline') {
          const k = (key && key.value || '').trim();
          const n = (nick && nick.value || '').trim();
          if (!k) { if (key) key.focus(); return; }
          await this.connect(k, n);
          if (info) info.innerHTML = `Room: <code>${escapeHTML(this.roomKey)}</code>`;
        } else {
          this.disconnect();
          if (info) info.textContent = '';
        }
      });
    }
  }

  _render() {
    if (!this._shellBuilt || !this.container) return;
    const beacon = this.container.querySelector('#lb-beacon');
    const statusText = this.container.querySelector('#lb-status-text');
    const btn = this.container.querySelector('#lb-btn');
    const grid = this.container.querySelector('#lb-grid');
    
    const map = {
      online: { dot: 'lb-dot online', text: 'ONLINE / LIVE MATCHING', cls: 'glow' },
      connecting: { dot: 'lb-dot connecting', text: 'SYNCING ATOMICS…', cls: 'dim' },
      offline: { dot: 'lb-dot offline', text: 'DISCONNECTED', cls: 'dim' },
    };
    
    const m = map[this.status] || map.offline;
    if (beacon) beacon.className = m.dot;
    if (statusText) { statusText.textContent = m.text; statusText.className = 'lb-status-text ' + m.cls; }
    if (btn) {
      btn.textContent = (this.status === 'offline') ? 'Connect Arena' : 'Leave Arena';
      btn.className = 'lb-btn' + (this.status === 'offline' ? '' : ' danger');
    }
    
    if (!grid) return;
    
    const rows = [];
    
    // Prune entries older than 3 minutes (handles users forcefully closing tabs)
    const cutoffTime = Date.now() - 3 * 60 * 1000;
    
    this.telemetry.forEach((t, id) => {
      if (!t.self && new Date(t.timestamp).getTime() < cutoffTime) return;
      rows.push({ ...t, id });
    });

    rows.sort((a, b) => (b.globalElo || 0) - (a.globalElo || 0));

    grid.innerHTML = rows.length
      ? rows.map((r) => this._cardHTML(r)).join('')
      : `<div class="lb-empty">Connected to channel swarm. Tell your rival to enter passphrase "${escapeHTML(this.roomKey)}" to start tracking metric convergence live.</div>`;
  }

  _cardHTML(r) {
    const prev = this.prevElo.get(r.id);
    let trend = '';
    if (typeof prev === 'number' && typeof r.globalElo === 'number' && prev !== r.globalElo) {
      trend = r.globalElo > prev
        ? '<span class="lb-trend up" title="ELO rising">▲</span>'
        : '<span class="lb-trend down" title="ELO fumbled">▼</span>';
    }
    const elo = (typeof r.globalElo === 'number') ? Math.round(r.globalElo).toLocaleString() : '—';
    const studyH = (typeof r.studyHours === 'number') ? r.studyHours.toFixed(2) + 'h' : '—';
    const dv = (r.dailyVariation == null) ? '—' : escapeHTML(String(r.dailyVariation));
    const name = escapeHTML(r.nickname);
    const timeString = r.timestamp ? new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Now';
    
    return (
      `<div class="lb-card${r.self ? ' self' : ''}">` +
        `<div class="lb-card-head">` +
          `<span class="lb-nick">${r.self ? '<span class="lb-self-tag">YOU</span> ' : ''}<span>${name}</span></span>` +
          `<span class="lb-presence online"></span>` +
        `</div>` +
        `<div class="lb-card-body">` +
          `<div class="lb-metric"><span class="lb-label">Global ELO</span><span class="lb-value">${elo} ${trend}</span></div>` +
          `<div class="lb-metric"><span class="lb-label">Target Progress</span><span class="lb-value">${dv}</span></div>` +
          `<div class="lb-metric"><span class="lb-label">Study Duration</span><span class="lb-value">${studyH}</span></div>` +
        `</div>` +
        `<div class="lb-ts">Sync check: ${escapeHTML(timeString)}</div>` +
      `</div>`
    );
  }
}

const LB_SHELL_HTML = `
  <style>
    .lb-shell{--glow:#00ffcc;--glow-dim:#22333b;--danger:#ff4444;--bg:#09090e;--card:#111116;--card-2:#09090d;
      --line:#1a1a24;--text:#cbd5e1;--muted:#64748b;font-family:'Space Grotesk', system-ui, sans-serif;color:var(--text);}
    .lb-shell *{box-sizing:border-box;}
    .lb-shell h2{margin:0;font-size:20px;font-weight:700;letter-spacing:.5px;color:#fff;}
    .lb-shell .lb-sub{margin:4px 0 0;font-size:12px;color:var(--muted);}
    .lb-shell .lb-header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:14px;}
    .lb-shell .lb-status{display:flex;align-items:center;gap:9px;padding:6px 14px;border:1px solid var(--line);border-radius:999px;background:var(--card-2);}
    .lb-dot{width:8px;height:8px;border-radius:50%;background:var(--glow-dim);}
    .lb-dot.online{background:var(--glow);box-shadow:0 0 10px var(--glow);animation:lb-pulse 2s infinite;}
    .lb-dot.connecting{background:#f5a623;animation:lb-blink 1s infinite;}
    @keyframes lb-pulse{0%{transform:scale(0.9);opacity:0.6;}50%{transform:scale(1.1);opacity:1;}100%{transform:scale(0.9);opacity:0.6;}}
    @keyframes lb-blink{0%,100%{opacity:1}50%{opacity:.3}}
    .lb-status-text{font-size:11px;font-weight:700;letter-spacing:1px;}
    .lb-status-text.glow{color:var(--glow);}
    .lb-status-text.dim{color:var(--muted);}
    .lb-shell .lb-controls{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0 10px;}
    .lb-input{flex:1 1 200px;min-width:0;background:var(--card);border:1px solid var(--line);color:#fff;padding:12px 14px;border-radius:10px;font-size:13px;outline:none;font-family:inherit;}
    .lb-input:focus{border-color:#3b82f6;}
    .lb-btn{flex:0 0 auto;padding:12px 24px;border-radius:10px;border:1px solid #3b82f6;background:rgba(59,130,246,0.1);color:#3b82f6;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;transition:all 0.15s;}
    .lb-btn:hover{background:rgba(59,130,246,0.2);transform:translateY(-1px);}
    .lb-btn.danger{border-color:var(--danger);color:var(--danger);background:rgba(255,68,68,0.1);}
    .lb-btn.danger:hover{background:rgba(255,68,68,0.2);}
    .lb-room-info{font-size:12px;color:var(--muted);margin-bottom:16px;}
    .lb-room-info code{background:var(--card);padding:2px 6px;border-radius:4px;color:#60a5fa;}
    .lb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;}
    .lb-card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;position:relative;overflow:hidden;}
    .lb-card.self{border-color:rgba(59,130,246,0.4);background:linear-gradient(145deg, var(--card), #12121f);}
    .lb-card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
    .lb-nick{font-weight:700;font-size:16px;color:#fff;}
    .lb-self-tag{font-size:9px;font-weight:800;background:#3b82f6;color:#fff;padding:2px 6px;border-radius:4px;margin-right:4px;}
    .lb-presence{width:8px;height:8px;border-radius:50%;}
    .lb-presence.online{background:var(--glow);box-shadow:0 0 6px var(--glow);}
    .lb-card-body{display:flex;flex-direction:column;gap:10px;}
    .lb-metric{display:flex;justify-content:space-between;align-items:center;}
    .lb-label{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);}
    .lb-value{font-size:14px;font-weight:700;}
    .lb-trend.up{color:#4ade80;margin-left:4px;}
    .lb-trend.down{color:#f87171;margin-left:4px;}
    .lb-ts{margin-top:12px;font-size:11px;color:var(--muted);text-align:right;}
    .lb-empty{grid-column:1/-1;text-align:center;color:var(--muted);font-size:13px;padding:40px 20px;border:1px dashed var(--line);border-radius:12px;background:var(--card-2);}
  </style>
  <div class="lb-shell">
    <div class="lb-header">
      <div>
        <h2>Leaderboard Arena Matrix</h2>
        <p class="lb-sub">Continuous Realtime Cloud Channel synchronization</p>
      </div>
      <div class="lb-status">
        <span id="lb-beacon" class="lb-dot offline"></span>
        <span id="lb-status-text" class="lb-status-text dim">DISCONNECTED</span>
      </div>
    </div>
    <div class="lb-controls">
      <input id="lb-nick" class="lb-input" placeholder="Character Identifier" maxlength="20" autocomplete="off" />
      <input id="lb-key" class="lb-input" placeholder="Target Connection Passphrase" maxlength="32" autocomplete="off" />
      <button id="lb-btn" class="lb-btn">Connect Arena</button>
    </div>
    <div id="lb-room-info" class="lb-room-info"></div>
    <div id="lb-grid" class="lb-grid"></div>
  </div>`;

const LeaderboardNet = new Arena();
if (typeof window !== 'undefined') {
  window.LeaderboardNet = LeaderboardNet;
}

export { LeaderboardNet };
export default LeaderboardNet;