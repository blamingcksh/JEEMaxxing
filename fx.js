/* ============================================================================
   fx.js — Centralized Sound / Visual / Haptic FX controller for JEEMaxxing.
   Pure additive: defines window.FX + event delegation + settings wiring.
   NEVER overrides existing app functions. If this file fails to load, every
   gate elsewhere evaluates `window.FX === undefined` → original behaviour.
   Preferences persist in localStorage('jeemax_fx_prefs').
   ============================================================================ */
(function () {
  'use strict';
  if (window.__fxInit) return;
  window.__fxInit = true;

  var LS = 'jeemax_fx_prefs';
  var DEFAULT = { sound: true, marioSound: true, hover: false, effects: true, haptics: true, volume: 0.7 };

  // ── prefs ────────────────────────────────────────────────────────────────
  function load() {
    var d = Object.assign({}, DEFAULT);
    try {
      var r = localStorage.getItem(LS);
      if (r) d = Object.assign(d, JSON.parse(r));
    } catch (e) {}
    // Respect OS reduced-motion on first run (no stored prefs yet).
    if (!localStorage.getItem(LS)) {
      try {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) d.effects = false;
      } catch (e) {}
    }
    return d;
  }
  function save() { try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch (e) {} }
  var prefs = load();

  function wantSound()      { return !!prefs.sound; }
  function wantMarioSound() { return prefs.marioSound !== false; }
  function wantHoverSound() { return !!prefs.sound && !!prefs.hover; }
  function wantEffects()    { return !!prefs.effects; }
  function wantHaptic()     { return !!prefs.haptics; }
  function vol()            { var v = prefs.volume; return (typeof v === 'number' && v >= 0 && v <= 1) ? v : 0.7; }

  function applyBody() {
    document.documentElement.classList.toggle('fx-effects-off', !prefs.effects);
  }
  applyBody();

  // ── WebAudio synth (zero assets) ─────────────────────────────────────────
  var ac = null;
  function ctx() {
    if (!ac) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { ac = new C(); } catch (e) { return null; }
    }
    if (ac.state !== 'running') { try { ac.resume(); } catch (e) {} }
    return ac;
  }
  // Unlock / resume on first user gesture (autoplay policy). Sound-off users
  // never construct the context at all — a live AudioContext pins an audio
  // hardware session (measurable battery cost on mobile) while producing
  // nothing; enabling sound later lazily builds it on the first tone.
  function unlock() {
    if (!prefs.sound && !wantMarioSound()) return;
    try {
      if (navigator.audioSession && 'type' in navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
    } catch (e) {}
    var c = ctx();
    if (c && c.state !== 'running') { try { c.resume(); } catch (e) {} }
  }
  document.addEventListener('touchend', unlock, { capture: true, passive: true });
  document.addEventListener('click', unlock, { capture: true, passive: true });
  document.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  document.addEventListener('keydown', unlock, { capture: true, passive: true });

  function tone(o) {
    var c = ctx(); if (!c) return;
    var now = c.currentTime + (o.at || 0);
    var dur = o.dur || 0.1;
    var peak = Math.max(0.0001, (o.g != null ? o.g : 0.12) * vol());
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = o.type || 'sine';
    try {
      osc.frequency.setValueAtTime(o.f, now);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), now + dur);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(peak, now + (o.atk || 0.006));
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    } catch (e) { return; }
    osc.connect(g).connect(c.destination);
    osc.onended = function () {
      try { osc.disconnect(); } catch (e) {}
      try { g.disconnect(); } catch (e) {}
    };
    osc.start(now);
    osc.stop(now + dur + 0.03);
  }
  var _noiseBuf = null;
  var _noiseCtx = null;
  function crispNoiseBuf(c) {
    if (_noiseBuf && _noiseCtx === c) return _noiseBuf;
    var len = Math.max(1, Math.floor(c.sampleRate * 0.35));
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1);
    _noiseBuf = buf; _noiseCtx = c;
    return buf;
  }
  function airBrush(dur, g, bpFreq, bpQ, at) {
    var c = ctx(); if (!c) return;
    var now = c.currentTime + (at || 0);
    var d = Math.max(0.01, dur || 0.032);
    var src = c.createBufferSource(); src.buffer = crispNoiseBuf(c);
    var flt = c.createBiquadFilter(); flt.type = 'bandpass';
    flt.frequency.setValueAtTime(bpFreq || 1650, now);
    flt.Q.setValueAtTime(bpQ || 0.9, now);
    var gn = c.createGain();
    var peak = Math.max(0.0001, (g != null ? g : 0.028) * vol());
    try {
      gn.gain.setValueAtTime(0.0001, now);
      gn.gain.linearRampToValueAtTime(peak, now + Math.min(0.005, d * 0.3));
      gn.gain.exponentialRampToValueAtTime(0.0001, now + d);
    } catch (e) { return; }
    src.connect(flt).connect(gn).connect(c.destination);
    src.onended = function () {
      try { src.disconnect(); } catch (e) {}
      try { flt.disconnect(); } catch (e) {}
      try { gn.disconnect(); } catch (e) {}
    };
    src.start(now, Math.random() * 0.15, d + 0.02);
  }
  function warmPluck(freq, dur, g, at) {
    tone({ type: 'sine', f: freq, dur: dur, g: g, at: at || 0, atk: 0.006 });
    tone({ type: 'sine', f: freq * 2, dur: dur * 0.48, g: g * 0.22, at: at || 0, atk: 0.005 });
  }
  function studioPlay(name) {
    try {
      if (window.HeartbeatAudio && typeof window.HeartbeatAudio.playUiSfx === 'function') {
        if (window.HeartbeatAudio.playUiSfx(name, { vol: vol() })) return true;
      }
    } catch (e) {}
    return false;
  }

  // Unified luminous studio UI SFX — delegates to HeartbeatAudio's Velvet Hall & Circle-of-Fifths
  // engine whenever loaded, with matching warm sawtooth-free fallback synthesis.
  // Mario coin stays 100% authentic & untouched, only gently ducking the Flow bed to blend cleanly.
  var SFX = {
    click: function () {
      if (studioPlay('click')) return;
      tone({ type: 'sine', f: 250, f2: 112, dur: 0.04, g: 0.095, atk: 0.004 });
      airBrush(0.014, 0.024, 1850, 1.0, 0);
    },
    soft: function () {
      if (studioPlay('soft')) return;
      tone({ type: 'sine', f: 220, f2: 128, dur: 0.048, g: 0.068, atk: 0.005 });
      airBrush(0.014, 0.016, 1400, 0.9, 0);
    },
    confirm: function () {
      if (studioPlay('confirm')) return;
      tone({ type: 'sine', f: 122, f2: 58, dur: 0.09, g: 0.10, atk: 0.006 });
      warmPluck(587.33, 0.22, 0.072, 0.008);
      warmPluck(880.0, 0.30, 0.068, 0.055);
    },
    delete: function () {
      if (studioPlay('delete')) return;
      tone({ type: 'sine', f: 150, f2: 74, dur: 0.085, g: 0.075, atk: 0.005 });
      tone({ type: 'triangle', f: 329.63, f2: 293.66, dur: 0.11, g: 0.065, at: 0, atk: 0.006 });
      tone({ type: 'sine', f: 246.94, f2: 220.0, dur: 0.14, g: 0.06, at: 0.042, atk: 0.006 });
    },
    select: function () {
      if (studioPlay('select')) return;
      tone({ type: 'sine', f: 300, f2: 175, dur: 0.036, g: 0.055, atk: 0.004 });
      warmPluck(659.25, 0.085, 0.058, 0.004);
    },
    tab: function () {
      if (studioPlay('tab')) return;
      warmPluck(587.33, 0.11, 0.052, 0);
      warmPluck(880.0, 0.16, 0.046, 0.034);
      airBrush(0.055, 0.016, 1600, 0.75, 0);
    },
    modalClose: function () {
      if (studioPlay('modalClose')) return;
      tone({ type: 'sine', f: 440, f2: 293.66, dur: 0.12, g: 0.062, atk: 0.007 });
      airBrush(0.085, 0.018, 720, 0.7, 0.005);
    },
    toggle: function () {
      if (studioPlay('toggle')) return;
      tone({ type: 'sine', f: 235, f2: 145, dur: 0.028, g: 0.052, atk: 0.004 });
      warmPluck(739.99, 0.062, 0.055, 0.022);
    },
    blip: function () {
      if (studioPlay('blip')) return;
      warmPluck(659.25, 0.058, 0.055, 0);
    },
    tick: function () {
      if (studioPlay('tick')) return;
      tone({ type: 'sine', f: 280, f2: 160, dur: 0.022, g: 0.048, atk: 0.003 });
      tone({ type: 'sine', f: 783.99, dur: 0.030, g: 0.052, atk: 0.003 });
    },
    hover: function () {
      if (studioPlay('hover')) return;
      tone({ type: 'sine', f: 1046.5, dur: 0.022, g: 0.018, atk: 0.004 });
    },
    success: function () {
      if (studioPlay('success')) return;
      try { window.HeartbeatAudio && window.HeartbeatAudio.duck && window.HeartbeatAudio.duck(0.55, 0.55); } catch (e) {}
      tone({ type: 'sine', f: 118, f2: 54, dur: 0.17, g: 0.11, atk: 0.006 });
      warmPluck(587.33, 0.32, 0.075, 0.01);
      warmPluck(739.99, 0.36, 0.072, 0.068);
      warmPluck(880.0, 0.44, 0.078, 0.126);
    },
    marioCoin: function () {
      try { window.HeartbeatAudio && window.HeartbeatAudio.duck && window.HeartbeatAudio.duck(0.48, 0.45); } catch (e) {}
      tone({ type: 'square', f: 987.77, dur: 0.07, g: 0.085, at: 0 });
      tone({ type: 'square', f: 1318.51, dur: 0.28, g: 0.085, at: 0.07 });
    }
  };
  function sound(name) { if (!prefs.sound) return; var fn = SFX[name]; if (fn) { try { fn(); } catch (e) {} } }
  function haptic(p) { if (!prefs.haptics) return; if (navigator && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} } }

  // ── ripple (visual; skipped when effects off) ────────────────────────────
  function ripple(el, cx, cy) {
    if (!prefs.effects || !el || !el.getBoundingClientRect) return;
    var r; try { r = el.getBoundingClientRect(); } catch (e) { return; }
    if (!r.width && !r.height) return;
    var span = document.createElement('span');
    span.className = 'fx-ripple';
    var size = Math.max(r.width, r.height) * 1.15;
    span.style.width = size + 'px';
    span.style.height = size + 'px';
    var x, y;
    if (typeof cx === 'number' && typeof cy === 'number') { x = cx - r.left - size / 2; y = cy - r.top - size / 2; }
    else { x = (r.width - size) / 2; y = (r.height - size) / 2; }
    span.style.left = x + 'px';
    span.style.top = y + 'px';
    try { el.appendChild(span); } catch (e) { return; }
    var gone = false;
    function remove() { if (gone) return; gone = true; if (span.parentNode) span.parentNode.removeChild(span); }
    span.addEventListener('animationend', remove);
    setTimeout(remove, 700);
  }

  // ── element classification ───────────────────────────────────────────────
  // RIPPLE_HOSTS = elements safe to receive position:relative + overflow:hidden
  // (NO absolutely-positioned buttons, NO tooltip hosts, NO emoji tiles).
  var RIPPLE_HOSTS = '.btn, .matrix-pill, .subject-folder, .subject-card, .cal-day, ' +
    '.daily-queue-master-btn, .counter-btn, .tp-step-btn, .sr-mcq-option, .mcq-option, .cp-option, ' +
    '.sr-toggle-btn, .sr-friction-pill, .ingestion-toggle-btn, .sr-self-btn, ' +
    '.cp-selfreport-correct, .cp-selfreport-wrong, .chapter-item, .question-card, ' +
    '.file-upload-label, .file-upload-btn, .btn-break-opt, .sr-practice-btn, ' +
    '.sr-submit-btn, .sr-confirm-btn, .btn-start, .pomo-settings-btn, .mini-collapse-btn, ' +
    '.collapse-btn, .cal-nav-btn, .sr-history-toggle, .cpcc-add-btn, .cpcc-test-btn, ' +
    '.cpcc-save-btn, .cpcc-time-x, .show-solution-btn, .hide-toggle, .cp-abandon, ' +
    '.cp-grace-ignite, .cpcc-ignite-btn, .manual-sync-btn';
  // Sound + haptic only (no ripple): absolute buttons, tooltip hosts, emoji, nav, badges.
  var SOUND_ONLY = '.nav-item, .badge, .close-btn, .sr-drawer-close, ' +
    '.cpcc-close, .delete-btn, .card-close-btn, .delete-chapter, .delete-segment-btn';
  var COMBINED = RIPPLE_HOSTS + ',' + SOUND_ONLY;

  function classify(host) {
    var c = host.classList;
    if (c.contains('counter-btn') || c.contains('tp-step-btn')) return { s: 'tick', h: [3], bump: true };
    if (c.contains('btn-danger') || c.contains('cpcc-time-x')) return { s: 'delete', h: [20, 40, 20] };
    if (c.contains('close-btn') || c.contains('sr-drawer-close') || c.contains('cpcc-close') ||
        c.contains('delete-btn') || c.contains('card-close-btn') || c.contains('delete-chapter') ||
        c.contains('delete-segment-btn')) return { s: 'delete', h: [12, 30, 12] };
    if (c.contains('btn-success') || c.contains('cp-grace-ignite') || c.contains('cpcc-ignite-btn') ||
        c.contains('cpcc-save-btn') || c.contains('sr-submit-btn') || c.contains('sr-practice-btn') ||
        c.contains('sr-confirm-btn') || c.contains('btn-start') || c.contains('btn-primary')) return { s: 'confirm', h: [8, 30, 8] };
    if (c.contains('btn-secondary') || c.contains('btn-break-opt') || c.contains('cal-nav-btn') ||
        c.contains('sr-history-toggle') || c.contains('cp-abandon') || c.contains('cpcc-add-btn') ||
        c.contains('cpcc-test-btn') || c.contains('file-upload-btn') || c.contains('file-upload-label') ||
        c.contains('show-solution-btn') || c.contains('hide-toggle') || c.contains('manual-sync-btn') ||
        c.contains('pomo-settings-btn') || c.contains('mini-collapse-btn') || c.contains('collapse-btn')) return { s: 'soft', h: [6] };
    if (c.contains('nav-item')) return { s: 'tab', h: [6] };
    return { s: 'select', h: [5] };
  }

  // ── global click delegation (capture phase = instant feedback) ───────────
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#fx-test-sound, #fx-test-fx')) return;            // handled by their own listeners
    if (t.closest('.fx-switch, .cpcc-switch')) return;               // handled by change listener
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;

    var host = t.closest(COMBINED);
    if (!host) {
      // Backdrop click closes a modal → soft close cue.
      if (t.classList && t.classList.contains('modal-overlay')) { sound('modalClose'); haptic([6]); }
      return;
    }
    var p = classify(host);
    if (!p) return;
    sound(p.s);
    haptic(p.h);
    if (p.bump) {
      // v2 tracker ledger: steppers sit inside [data-subject] cards and the
      // counter span carries .tp-num. Legacy ring layout kept as fallback.
      var bumpCard = host.closest('[data-subject]');
      var cnt = bumpCard && bumpCard.querySelector('.tp-num');
      if (!cnt) {
        var row = host.closest('.tp-row') || host.parentElement;
        cnt = row && row.querySelector('.counter');
      }
      if (cnt) { cnt.classList.remove('fx-bump'); void cnt.offsetWidth; cnt.classList.add('fx-bump'); }
    }
    if (host.matches(RIPPLE_HOSTS)) ripple(host, e.clientX, e.clientY);
  }, true);

  // ── hover cues (off by default; chart ticks gated here too) ──────────────
  var lastHover = 0, lastHoverEl = null;
  document.addEventListener('mouseover', function (e) {
    if (!wantHoverSound()) return;
    var t = e.target; if (!t || !t.closest) return;
    var host = t.closest('.nav-item, .subject-card, .subject-folder, .compact-subject-card, .badge, .matrix-pill');
    if (!host || host === lastHoverEl) return;
    var now = performance.now(); if (now - lastHover < 55) return;
    lastHover = now; lastHoverEl = host;
    sound('hover');
  }, true);
  document.addEventListener('mouseout', function (e) { if (e.target === lastHoverEl) lastHoverEl = null; }, true);

  // ── keyboard-focus blip (mouse focus stays silent → no click+focus stack) ─
  document.addEventListener('focusin', function (e) {
    if (!wantSound()) return;
    var t = e.target; if (!t || !t.matches) return;
    if (t.matches('.pomo-input, .pomo-select, .matrix-search, .cp-integer-input')) {
      try { if (t.matches(':focus-visible')) sound('blip'); } catch (err) {}
    }
  }, true);

  // ── select / checkbox change cue (excludes the FX toggles themselves) ────
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t) return;
    if (t.id && t.id.indexOf('fx-') === 0) return;
    if (t.matches && t.matches('select, input[type=checkbox]')) { sound('select'); haptic([5]); }
  }, true);

  // ── settings wiring ──────────────────────────────────────────────────────
  function throttle(fn, ms) { var last = 0; return function () { var now = Date.now(); if (now - last >= ms) { last = now; fn(); } }; }

  function wireBool(id, key) {
    var el = document.getElementById(id); if (!el) return;
    el.checked = !!prefs[key];
    el.addEventListener('change', function () {
      prefs[key] = el.checked; save(); applyBody();
      haptic([6]);
      if (key === 'marioSound') { if (prefs.marioSound) { try { SFX.marioCoin(); } catch (e) {} } }
      else if (prefs.sound) sound(key === 'sound' ? 'confirm' : 'toggle');
    });
  }
  function wireRange(id, key) {
    var el = document.getElementById(id); if (!el) return;
    el.value = Math.round(vol() * 100);
    el.addEventListener('input', throttle(function () {
      prefs[key] = Math.max(0, Math.min(100, parseInt(el.value, 10) || 0)) / 100;
      save(); sound('blip');
    }, 90));
  }

  function wireSettings() {
    wireBool('fx-sound', 'sound');
    wireBool('fx-mario-sound', 'marioSound');
    wireBool('fx-effects', 'effects');
    wireBool('fx-haptics', 'haptics');
    wireBool('fx-hover', 'hover');
    wireRange('fx-volume', 'volume');

    var ts = document.getElementById('fx-test-sound');
    if (ts) ts.addEventListener('click', function () {
      var seq = ['select', 'confirm', 'success'];
      for (var i = 0; i < seq.length; i++) (function (n, d) { setTimeout(function () { sound(n); }, d); })(seq[i], i * 120);
      haptic([6, 40, 6, 40, 12]);
    });

    var tf = document.getElementById('fx-test-fx');
    if (tf) tf.addEventListener('click', function () {
      var r = tf.getBoundingClientRect();
      ripple(tf, r.left + r.width / 2, r.top + r.height / 2);
      if (wantEffects()) {
        var g = document.createElement('div'); g.className = 'green-glow-overlay';
        document.body.appendChild(g); g.addEventListener('animationend', function () { g.remove(); });
        if (typeof window.burstEmojis === 'function') {
          try { window.burstEmojis(r.left + r.width / 2, r.top + r.height / 2, 22, ['✨', '🎉', '', '💯', '🌟'], 1.2); } catch (err) {}
        }
      }
      if (wantSound()) sound('success');
      haptic([10, 30, 10]);
    });
  }

  // ── boot ─────────────────────────────────────────────────────────────────
  function boot() {
    if (!document.body) { requestAnimationFrame(boot); return; }
    applyBody();
    wireSettings();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ── public surface (read by the gates in app.js / pomodoro.js / candlestick) ─
  window.FX = {
    prefs: prefs,
    sound: sound,
    haptic: haptic,
    ripple: ripple,
    wantSound: wantSound,
    wantMarioSound: wantMarioSound,
    wantHoverSound: wantHoverSound,
    wantEffects: wantEffects,
    wantHaptic: wantHaptic,
    ctx: ctx,
    vol: vol,
    setPref: function (k, v) { prefs[k] = v; save(); applyBody(); var idMap = { sound: 'fx-sound', marioSound: 'fx-mario-sound', effects: 'fx-effects', haptics: 'fx-haptics', hover: 'fx-hover' }; if (idMap[k]) { var el = document.getElementById(idMap[k]); if (el) el.checked = !!prefs[k]; } }
  };
})();