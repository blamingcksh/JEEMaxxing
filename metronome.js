/* ============================================================================
   metronome.js — Metronome engine for JEEMaxxing (v2 — study-soft sounds).

   A floating, always-available practice metronome:
     • ⏱ FAB (bottom-right corner, next to nothing — cp-hub owns bottom-left)
       opens a compact popover: BPM readout, slider, hold-to-repeat ± steppers,
       tap tempo, beat-count, sound voice chips, volume.
     • Sample-accurate timing via the classic lookahead scheduler ("A Tale of
       Two Clocks"): setInterval only *schedules*, the WebAudio clock fires the
       beats. Background-tab timer throttling can't drift the tempo because the
       schedule-ahead window widens while document.hidden.
     • v2 SOUND DESIGN — built to sit under study focus, not fight it:
         - every hit fades in over 2–10ms (hard onsets read as "harsh");
         - pitch energy lives low-mid (≤~800Hz) instead of piercing highs;
         - whisper-trim peaks ≈¼ of v1, accents lead by TIMBRE not volume;
         - voices: 🌙 Soft (felt-piano tick · default), 🪵 Wood (mellow
           woodblock), 🎐 Chime (warm two-sine hum).
       One-time v1→v2 pref migration snaps untouched defaults to the new
       gentler volume/voice; deliberately-set values survive.

   Prefs persist device-local in localStorage('jeemax_metronome_prefs').
   Cloud / storage.js intentionally untouched.

   Global API (console / other modules):
     Metro.togglePanel()  Metro.start()  Metro.stop()  Metro.toggle()
     Metro.setBpm(n)      Metro.isRunning()
   Keyboard: M toggles the panel (ignored while typing in inputs).
   ============================================================================ */
(function () {
  'use strict';
  if (window.__metroInit) return;
  window.__metroInit = true;

  // ── prefs ────────────────────────────────────────────────────────────────
  var LS = 'jeemax_metronome_prefs';
  // v2 — study-soft sound design: gentler default volume (55) + whisper-trim
  // voices. `v` marks migrated prefs so a deliberately-set old default (70)
  // is only snapped once.
  var DEFAULTS = { v: 2, bpm: 100, beats: 4, volume: 55, voice: 'soft' };
  var BPM_MIN = 30, BPM_MAX = 250;

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  // ── voices (v2 — study-soft redesign) ────────────────────────────────────
  // Design rules for a metronome you can study beside:
  //   • NO hard onsets — every hit fades in over a few ms (instant peaks are
  //     what ears read as "harsh/clicky", not the pitch or the loudness).
  //   • LOW-mid pitches — energy lives under ~800Hz where it guides without
  //     stabbing; the old square-wave 1.7kHz accent was a fire alarm.
  //   • WHISPER TRIM — peaks are tuned at ~¼ of v1's, so even at 100% slider
  //     the ceiling stays polite; accents lead by timbre, not by volume.
  var VOICES = {
    soft: {
      label: 'Soft', icon: '🌙',
      hint: 'Felt-piano tick — default study voice',
      hit: function (t, accent, out) {
        // Rounded sine tick + a whisper of brushed noise for definition
        // (definition comes from the noise transient, not raw loudness).
        blip(t, accent ? 784 : 523, 'sine', accent ? 0.20 : 0.13, 0.075, out, 0.005);
        thock(t, accent ? 1700 : 1350, accent ? 0.050 : 0.032, 0.016, out, 0.002);
      }
    },
    wood: {
      label: 'Wood', icon: '🪵',
      hint: 'Mellow woodblock — rounder and quieter',
      hit: function (t, accent, out) {
        knock(t, accent ? 1450 : 1050, accent ? 5.5 : 4.5, accent ? 0.32 : 0.22, 0.055, out, 0.002);
        blip(t, accent ? 494 : 392, 'triangle', accent ? 0.085 : 0.058, 0.030, out, 0.003);
      }
    },
    chime: {
      label: 'Chime', icon: '🎐',
      hint: 'Warm two-sine hum — softest, bell-ish',
      hit: function (t, accent, out) {
        // Two slightly detuned partials = a small mindfulness bell: the
        // accent is a chord change (G5→E5), not a volume jump.
        var f = accent ? 784 : 659;
        tone(t, f, 'sine', accent ? 0.16 : 0.11, 0.17, out, 0.010);
        tone(t, f * 2.005, 'sine', accent ? 0.045 : 0.030, 0.10, out, 0.010);
      }
    }
  };
  // v1 → v2 voice name mapping (old chips disappear, prefs must follow).
  var VOICE_MIGRATE = { click: 'soft', beep: 'chime' };

  // ── prefs (defined after VOICES — load() validates the stored voice) ─────
  var prefs = load();
  function load() {
    var d = Object.assign({}, DEFAULTS);
    try {
      var r = localStorage.getItem(LS);
      // Migration gate reads the STORED object, not the merged one — DEFAULTS
      // already carry v:2, so testing `d.v` after the merge would never fire.
      if (r) {
        var s = JSON.parse(r);
        if (s) {
          var hadV = !!s.v;
          d = Object.assign(d, s);
          if (!hadV) {
            // One-time v1→v2 pass: snap an untouched default volume to the new
            // gentler default (deliberately-set values survive) and map old
            // voice names onto their v2 successors.
            if (d.volume === 70) d.volume = DEFAULTS.volume;
            d.voice = VOICE_MIGRATE[d.voice] || d.voice;
            d.v = 2;
          }
        }
      }
    } catch (e) {}
    d.bpm = clamp(Math.round(Number(d.bpm) || DEFAULTS.bpm), BPM_MIN, BPM_MAX);
    d.beats = clamp(Math.round(Number(d.beats) || DEFAULTS.beats), 1, 7);
    d.volume = clamp(Math.round(Number(d.volume)), 0, 100);
    if (!VOICES[d.voice]) d.voice = DEFAULTS.voice;
    return d;
  }
  function save() { try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch (e) {} }

  // ── WebAudio graph ───────────────────────────────────────────────────────
  var actx = null, master = null, noiseBuf = null;

  function ctx() {
    if (!actx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      actx = new C();
      master = actx.createGain();
      master.gain.value = volCurve(prefs.volume);
      master.connect(actx.destination);
    }
    return actx;
  }
  function volCurve(v) { return Math.pow(clamp(v, 0, 100) / 100, 1.6); }

  function noise() {
    if (!noiseBuf) {
      noiseBuf = actx.createBuffer(1, Math.ceil(actx.sampleRate * 0.2), actx.sampleRate);
      var ch = noiseBuf.getChannelData(0);
      for (var i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  // Short pitched blip (oscillator + soft attack + exp decay).
  function blip(t, freq, type, peak, decay, out, attack) {
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + (attack || 0.003));
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + decay + 0.02);
  }
  // Plain sine tone with a soft rounded edge (chime voice).
  function tone(t, freq, type, peak, decay, out, attack) {
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + (attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + decay + 0.02);
  }
  // Bandpass-filtered noise burst (woodblock-ish knock) — softened onset.
  function knock(t, freq, q, peak, decay, out, attack) {
    var src = actx.createBufferSource(); src.buffer = noise();
    var f = actx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    var g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + (attack || 0.002));
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.05); src.stop(t + decay + 0.02);
  }
  // Tiny highpassed brushed-noise transient layered on the soft voice.
  function thock(t, hpFreq, peak, decay, out, attack) {
    var src = actx.createBufferSource(); src.buffer = noise();
    var f = actx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = hpFreq;
    var g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + (attack || 0.002));
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.05); src.stop(t + decay + 0.02);
  }

  // ── lookahead scheduler ──────────────────────────────────────────────────
  // setInterval NEVER plays audio — it only queues beats slightly ahead on
  // the AudioContext clock. While the tab is hidden, browsers throttle timers
  // to ~1Hz, so the hidden window stretches far enough that even a 1Hz
  // scheduler tick keeps the queue full. Timing itself stays sample-accurate.
  var TICK_MS = 25;
  var AHEAD_VISIBLE = 0.12;   // seconds queued while visible
  var AHEAD_HIDDEN = 3.2;     // seconds queued while tab is hidden
  var TICK_HIDDEN_MS = 400;

  var running = false, schedTimer = null, rafId = 0;
  var nextBeatTime = 0;       // AudioContext time of the next scheduled beat
  var beatIndex = 0;          // absolute beat counter since start
  var drawQueue = [];         // [{ time, accent }] awaiting their visual flash

  function aheadSecs() { return document.hidden ? AHEAD_HIDDEN : AHEAD_VISIBLE; }

  function scheduleBeat(time, accent) {
    var c = ctx(); if (!c) return;
    var g = c.createGain();                 // per-beat bus → clean voice mix
    g.gain.value = 1; g.connect(master);
    VOICES[prefs.voice].hit(time, accent, g);
  }

  function schedulerTick() {
    var c = ctx(); if (!c || !running) return;
    var horizon = c.currentTime + aheadSecs();
    var guard = 64;                         // hard cap per tick (sanity)
    while (nextBeatTime < horizon && guard-- > 0) {
      var accent = (beatIndex % prefs.beats) === 0;
      scheduleBeat(nextBeatTime, accent);
      drawQueue.push({ time: nextBeatTime, accent: accent });
      beatIndex++;
      nextBeatTime += 60 / prefs.bpm;
    }
  }

  // Visual loop: light the dot exactly when its beat sounds.
  function drawLoop() {
    if (!running) return;
    var now = actx ? actx.currentTime : 0;
    while (drawQueue.length && drawQueue[0].time <= now + 0.005) {
      var ev = drawQueue.shift();
      flashDot(ev.accent);
    }
    rafId = requestAnimationFrame(drawLoop);
  }

  // ── transport ────────────────────────────────────────────────────────────
  function start() {
    if (running) return;
    var c = ctx(); if (!c) return;
    if (c.state === 'suspended') c.resume();
    running = true;
    beatIndex = 0;
    drawQueue.length = 0;
    nextBeatTime = c.currentTime + 0.08;    // tiny breath before beat one
    schedulerTick();
    schedTimer = setInterval(schedulerTick, document.hidden ? TICK_HIDDEN_MS : TICK_MS);
    rafId = requestAnimationFrame(drawLoop);
    paintRunning(true);
  }
  function stop() {
    if (!running) return;
    running = false;
    clearInterval(schedTimer); schedTimer = null;
    cancelAnimationFrame(rafId); rafId = 0;
    drawQueue.length = 0;
    paintRunning(false);
  }
  function toggle() { running ? stop() : start(); }
  function isRunning() { return running; }

  function setBpm(n) {
    n = clamp(Math.round(Number(n) || prefs.bpm), BPM_MIN, BPM_MAX);
    if (n === prefs.bpm) return n;
    prefs.bpm = n; save();
    paintBpm();
    return n;
  }

  // iOS/Safari: a hidden tab can suspend the context mid-run — wake it back up.
  document.addEventListener('visibilitychange', function () {
    if (!running || !actx) return;
    clearInterval(schedTimer);
    schedTimer = setInterval(schedulerTick, document.hidden ? TICK_HIDDEN_MS : TICK_MS);
    if (document.hidden && actx.state === 'running') {
      // Pre-queue through the throttle wall before we lose the 25ms cadence.
      schedulerTick();
    } else if (actx.state === 'suspended') {
      actx.resume().then(schedulerTick)['catch'](function () {});
    } else {
      schedulerTick();
    }
  });

  // ── UI ───────────────────────────────────────────────────────────────────
  var fab = null, pop = null, openState = false;
  var ui = {};                              // element cache

  var SVG_METRO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path class="metro-body" d="M9.2 3h5.6l4.1 15.6a1.6 1.6 0 0 1-1.55 2H6.65a1.6 1.6 0 0 1-1.55-2Z"/>'
    + '<g class="metro-arm"><path d="M12 17V5.4"/><circle cx="12" cy="6.6" r="1.35" fill="currentColor" stroke="none"/></g>'
    + '</svg>';

  function buildUi() {
    if (fab) return;

    fab = document.createElement('button');
    fab.id = 'metro-fab';
    fab.type = 'button';
    fab.className = 'metro-fab';
    fab.setAttribute('aria-label', 'Open metronome');
    fab.title = 'Metronome (M)';
    fab.innerHTML = SVG_METRO + '<span class="metro-fab-badge" id="metro-fab-badge">' + prefs.bpm + '</span>';
    fab.addEventListener('click', function (e) { e.stopPropagation(); togglePanel(); });
    document.body.appendChild(fab);

    pop = document.createElement('div');
    pop.id = 'metro-pop';
    pop.className = 'metro-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Metronome');
    pop.innerHTML =
          '<span class="metro-tag">Metronome</span>'
        + '<div class="metro-dots" id="metro-dots" aria-hidden="true"></div>'
        + '<div class="metro-hero">'
        + '  <button type="button" class="metro-step" id="metro-dec" aria-label="Slower">−</button>'
        + '  <div class="metro-read"><span class="metro-bpm-num" id="metro-bpm-num">' + prefs.bpm + '</span><span class="metro-bpm-lbl">BPM</span></div>'
        + '  <button type="button" class="metro-step" id="metro-inc" aria-label="Faster">+</button>'
        + '</div>'
        + '<input type="range" class="metro-range" id="metro-range" min="' + BPM_MIN + '" max="' + BPM_MAX + '" step="1" value="' + prefs.bpm + '" aria-label="Tempo in beats per minute">'
        + '<div class="metro-transport">'
        + '  <button type="button" class="metro-play" id="metro-play" aria-label="Start metronome">▶</button>'
        + '  <button type="button" class="metro-tap" id="metro-tap" title="Tap in rhythm to set the tempo">TAP</button>'
        + '  <div class="metro-chips" id="metro-voices" role="group" aria-label="Voice"></div>'
        + '</div>'
        + '<div class="metro-foot">'
        + '  <div class="metro-mini">'
        + '    <span class="metro-mini-lbl">Beats</span>'
        + '    <button type="button" class="metro-step metro-step-xs" id="metro-beat-dec" aria-label="Fewer beats per bar">−</button>'
        + '    <span class="metro-beat-num" id="metro-beat-num">' + prefs.beats + '</span>'
        + '    <button type="button" class="metro-step metro-step-xs" id="metro-beat-inc" aria-label="More beats per bar">+</button>'
        + '  </div>'
        + '  <div class="metro-mini">'
        + '    <span class="metro-mini-lbl">Vol</span>'
        + '    <input type="range" class="metro-range metro-range-sm" id="metro-vol" min="0" max="100" step="1" value="' + prefs.volume + '" aria-label="Metronome volume">'
        + '  </div>'
        + '</div>';
    document.body.appendChild(pop);

    // element cache
    ui.badge   = pop.parentNode.querySelector('#metro-fab-badge') || fab.querySelector('#metro-fab-badge');
    ui.dots    = pop.querySelector('#metro-dots');
    ui.num     = pop.querySelector('#metro-bpm-num');
    ui.dec     = pop.querySelector('#metro-dec');
    ui.inc     = pop.querySelector('#metro-inc');
    ui.range   = pop.querySelector('#metro-range');
    ui.play    = pop.querySelector('#metro-play');
    ui.tap     = pop.querySelector('#metro-tap');
    ui.voices  = pop.querySelector('#metro-voices');
    ui.vol     = pop.querySelector('#metro-vol');
    ui.beatNum = pop.querySelector('#metro-beat-num');
    ui.beatDec = pop.querySelector('#metro-beat-dec');
    ui.beatInc = pop.querySelector('#metro-beat-inc');

    // voices chips — icon-only, colour is the state (minimal picker)
    Object.keys(VOICES).forEach(function (key) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'metro-chip' + (prefs.voice === key ? ' active' : '');
      b.setAttribute('data-voice', key);
      b.setAttribute('aria-pressed', prefs.voice === key ? 'true' : 'false');
      b.setAttribute('aria-label', VOICES[key].label + ' voice');
      b.title = VOICES[key].hint || VOICES[key].label;
      b.textContent = VOICES[key].icon;
      b.addEventListener('click', function () { setVoice(key); });
      ui.voices.appendChild(b);
    });

    // wiring
    ui.dec.addEventListener('pointerdown', attachHold(function () { nudge(-1); }));
    ui.inc.addEventListener('pointerdown', attachHold(function () { nudge(1); }));
    ui.range.addEventListener('input', function () { setBpm(this.value); });
    ui.range.addEventListener('dblclick', function () { setBpm(DEFAULTS.bpm); });
    ui.vol.addEventListener('input', function () {
      prefs.volume = clamp(Math.round(+this.value), 0, 100); save();
      if (master) master.gain.setTargetAtTime(volCurve(prefs.volume), actx.currentTime, 0.02);
      paintFill(ui.vol);
    });
    ui.vol.addEventListener('dblclick', function () {
      prefs.volume = DEFAULTS.volume; this.value = prefs.volume;
      if (master) master.gain.setTargetAtTime(volCurve(prefs.volume), actx.currentTime, 0.02);
      paintFill(ui.vol); save();
    });
    ui.play.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    ui.tap.addEventListener('click', function (e) { e.stopPropagation(); tapTempo(); });
    ui.beatDec.addEventListener('pointerdown', attachHold(function () { setBeats(prefs.beats - 1); }));
    ui.beatInc.addEventListener('pointerdown', attachHold(function () { setBeats(prefs.beats + 1); }));
    document.addEventListener('pointerdown', outsideClose);

    buildDots();
    paintBpm();
    paintFill(ui.range);
    paintFill(ui.vol);
  }

  // Hold-to-repeat for the −/+ steppers: 380ms dwell, then 12/s repeats.
  function attachHold(fn) {
    var t = 0, iv = 0;
    function clear() { clearTimeout(t); clearInterval(iv); t = 0; iv = 0; }
    return function (e) {
      e.preventDefault();
      fn();
      t = setTimeout(function () { iv = setInterval(fn, 80); }, 380);
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
        e.currentTarget.addEventListener(ev, clear, { once: true });
      });
      window.addEventListener('blur', clear, { once: true });
    };
  }

  function nudge(d) { setBpm(prefs.bpm + d); }

  // Tap tempo — mean of the last ≤6 intervals, reset after a 2s gap.
  var taps = [];
  function tapTempo() {
    var now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 7) taps.shift();
    if (taps.length >= 3) {
      var sum = 0;
      for (var i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1];
      var bpm = Math.round(60000 / (sum / (taps.length - 1)));
      setBpm(bpm);
      ui.tap.classList.add('flash');
      setTimeout(function () { ui.tap.classList.remove('flash'); }, 140);
    }
  }

  function setVoice(key) {
    if (!VOICES[key]) return;
    prefs.voice = key; save();
    [...ui.voices.children].forEach(function (b) {
      var on = b.getAttribute('data-voice') === key;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    // New voice applies from the NEXT scheduled beat — never pull
    // nextBeatTime backwards, or beats double up inside the queued window.
  }

  function setBeats(n) {
    n = clamp(Math.round(Number(n)) || prefs.beats, 1, 7);
    if (n === prefs.beats) return;
    prefs.beats = n; save();
    beatIndex = 0;                          // accents restart from the downbeat
    buildDots();
    paintBeats();
  }

  function paintBeats() {
    if (ui.beatNum) ui.beatNum.textContent = prefs.beats;
  }

  function buildDots() {
    if (!ui.dots) return;
    ui.dots.innerHTML = '';
    for (var i = 0; i < prefs.beats; i++) {
      var d = document.createElement('i');
      d.className = 'metro-dot' + (i === 0 ? ' accent' : '');
      ui.dots.appendChild(d);
    }
  }

  var flashT = 0;
  function flashDot(accent) {
    if (!ui.dots) return;
    var dots = ui.dots.children;
    if (!dots.length) return;
    var idx = (beatIndex - drawQueue.length - 1 + prefs.beats * 4096) % prefs.beats;
    for (var i = 0; i < dots.length; i++) dots[i].classList.remove('on', 'on-accent');
    if (dots[idx]) {
      dots[idx].classList.add(accent ? 'on-accent' : 'on');
      clearTimeout(flashT);
      flashT = setTimeout(function () {
        for (var j = 0; j < dots.length; j++) dots[j].classList.remove('on', 'on-accent');
      }, 110);
    }
  }

  // ── painters ─────────────────────────────────────────────────────────────
  function paintBpm() {
    if (ui.num) ui.num.textContent = prefs.bpm;
    if (ui.range && +ui.range.value !== prefs.bpm) ui.range.value = prefs.bpm;
    if (fab) {
      fab.style.setProperty('--metro-swing', (60 / prefs.bpm).toFixed(3) + 's');
      var badge = fab.querySelector('.metro-fab-badge');
      if (badge) badge.textContent = prefs.bpm;
    }
    paintFill(ui.range);
  }
  function paintFill(input) {
    if (!input) return;
    var min = +input.min || 0, max = +input.max || 100;
    var pct = ((+input.value - min) / (max - min)) * 100;
    input.style.background =
      'linear-gradient(90deg, rgba(255,178,36,.9) ' + pct + '%, rgba(255,255,255,.14) ' + pct + '%)';
  }
  function paintRunning(on) {
    if (fab) fab.classList.toggle('playing', on);
    if (ui.play) {
      ui.play.textContent = on ? '▮▮' : '▶';
      ui.play.setAttribute('aria-label', on ? 'Stop metronome' : 'Start metronome');
      ui.play.classList.toggle('stop-face', on);
    }
    if (!on && ui.dots) {
      [...ui.dots.children].forEach(function (d) { d.classList.remove('on', 'on-accent'); });
    }
  }

  // ── panel open/close ─────────────────────────────────────────────────────
  function openPanel() { buildUi(); openState = true; pop.classList.add('open'); fab.classList.add('open'); }
  function closePanel() { openState = false; if (pop) pop.classList.remove('open'); if (fab) fab.classList.remove('open'); }
  function togglePanel() { openState ? closePanel() : openPanel(); }

  function outsideClose(e) {
    if (!openState) return;
    if (pop.contains(e.target) || fab.contains(e.target)) return;
    closePanel();
  }

  // Keyboard: M toggles the panel; Space starts/stops while it's open; Escape
  // closes (the panel has no visible close chrome — minimal by design).
  // All three ignore typing targets and modifier combos so they never eat input.
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.matches && t.matches('input, textarea, select')) ) return;
    var k = (e.key || '').toLowerCase();
    if (k === 'm') { e.preventDefault(); togglePanel(); }
    else if (k === ' ' && openState) { e.preventDefault(); toggle(); }
    else if (k === 'escape' && openState) { e.preventDefault(); closePanel(); }
  });

  // ── boot + public API ────────────────────────────────────────────────────
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  ready(buildUi);

  window.Metro = {
    togglePanel: togglePanel,
    open: openPanel,
    close: closePanel,
    start: start,
    stop: stop,
    toggle: toggle,
    setBpm: setBpm,
    setBeats: setBeats,
    setVoice: function (k) { buildUi(); setVoice(k); },
    isRunning: isRunning
  };
})();
