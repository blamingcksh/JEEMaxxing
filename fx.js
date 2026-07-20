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
  var DEFAULT = { sound: true, hover: false, effects: true, haptics: true, volume: 0.7 };

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
    if (ac.state === 'suspended') { try { ac.resume(); } catch (e) {} }
    return ac;
  }
  // Unlock / resume on first user gesture (autoplay policy).
  function unlock() { var c = ctx(); if (c && c.state === 'suspended') { try { c.resume(); } catch (e) {} } }
  document.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('keydown', unlock, { passive: true });

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
      g.gain.exponentialRampToValueAtTime(peak, now + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    } catch (e) { return; }
    osc.connect(g).connect(c.destination);
    osc.start(now);
    osc.stop(now + dur + 0.03);
  }
  function noise(dur, g) {
    var c = ctx(); if (!c) return;
    var now = c.currentTime;
    var n = Math.floor(c.sampleRate * dur);
    if (n <= 0) return;
    var buf = c.createBuffer(1, n, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1);
    var src = c.createBufferSource(); src.buffer = buf;
    var gn = c.createGain();
    var flt = c.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = 1400; flt.Q.value = 0.7;
    var peak = Math.max(0.0001, g * vol());
    try {
      gn.gain.setValueAtTime(0.0001, now);
      gn.gain.exponentialRampToValueAtTime(peak, now + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    } catch (e) { return; }
    src.connect(flt).connect(gn).connect(c.destination);
    src.start(now); src.stop(now + dur + 0.03);
  }

  var SFX = {
    click:   function () { tone({ type: 'square',   f: 200, f2: 120, dur: 0.05, g: 0.10 }); },
    soft:    function () { tone({ type: 'sine',     f: 330,        dur: 0.06, g: 0.07 }); },
    confirm: function () { tone({ type: 'sine',     f: 660, f2: 990, dur: 0.12, g: 0.14 }); },
    delete:  function () { tone({ type: 'sawtooth', f: 240, f2: 90,  dur: 0.14, g: 0.11 }); },
    select:  function () { tone({ type: 'triangle', f: 520,        dur: 0.05, g: 0.09 }); },
    tab:     function () { tone({ type: 'triangle', f: 440, f2: 560, dur: 0.09, g: 0.10 }); },
    modalClose: function () { tone({ type: 'sine',  f: 520, f2: 260, dur: 0.14, g: 0.08 }); noise(0.10, 0.03); },
    toggle:  function () { tone({ type: 'square',   f: 760, f2: 980, dur: 0.045, g: 0.07 }); },
    blip:    function () { tone({ type: 'sine',     f: 1200,       dur: 0.03, g: 0.05 }); },
    tick:    function () { tone({ type: 'triangle', f: 900,        dur: 0.03, g: 0.07 }); },
    hover:   function () { tone({ type: 'sine',     f: 1500,       dur: 0.02, g: 0.025 }); },
    success: function () { var f = [523, 659, 783]; for (var i = 0; i < f.length; i++) tone({ type: 'sine', f: f[i], dur: 0.12, g: 0.12, at: i * 0.07 }); }
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
    '.daily-queue-master-btn, .counter-btn, .sr-mcq-option, .mcq-option, .cp-option, ' +
    '.sr-toggle-btn, .sr-friction-pill, .ingestion-toggle-btn, .sr-self-btn, ' +
    '.cp-selfreport-correct, .cp-selfreport-wrong, .chapter-item, .question-card, ' +
    '.file-upload-label, .file-upload-btn, .btn-break-opt, .sr-practice-btn, ' +
    '.sr-submit-btn, .sr-confirm-btn, .btn-start, .pomo-settings-btn, .mini-collapse-btn, ' +
    '.collapse-btn, .cal-nav-btn, .sr-history-toggle, .cpcc-add-btn, .cpcc-test-btn, ' +
    '.cpcc-save-btn, .cpcc-time-x, .show-solution-btn, .hide-toggle, .cp-abandon, ' +
    '.cp-grace-ignite, .cpcc-ignite-btn, .manual-sync-btn';
  // Sound + haptic only (no ripple): absolute buttons, tooltip hosts, emoji, nav, badges.
  var SOUND_ONLY = '.nav-item, .badge, .mood-emoji, .close-btn, .sr-drawer-close, ' +
    '.cpcc-close, .delete-btn, .card-close-btn, .delete-chapter, .delete-segment-btn';
  var COMBINED = RIPPLE_HOSTS + ',' + SOUND_ONLY;

  function classify(host) {
    var c = host.classList;
    if (c.contains('counter-btn')) return { s: 'tick', h: [3], bump: true };
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
      var cnt = host.parentElement && host.parentElement.querySelector('.counter');
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
    if (t.matches('.pomo-input, .pomo-select, .matrix-search, .lb-input, .cp-integer-input')) {
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
      if (prefs.sound) sound(key === 'sound' ? 'confirm' : 'toggle');
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
    wantHoverSound: wantHoverSound,
    wantEffects: wantEffects,
    wantHaptic: wantHaptic,
    setPref: function (k, v) { prefs[k] = v; save(); applyBody(); }
  };
})();