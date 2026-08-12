/* ============================================================================
   focus-sound.js — Focus Soundscape engine for JEEMaxxing (v3 — audio files).
   Plays REAL audio instead of live synthesis: generated seamless WAV loops
   (scripts/gen-ambient-sounds.mjs) + CC0 recordings for Rain & Café (see
   assets/sounds/). Nothing is synthesised at runtime → nothing sounds rough.

   Files are fetched lazily, decoded once and cached in memory; the service
   worker caches them on first use so they keep working offline.

   Playback:
     • Seamless WAV loops  → plain looping BufferSource (seam is baked in).
     • Real MP3 recordings → dual-layer crossfade looper: the looping source
       dips to half gain at each loop boundary while an overlapping copy of
       the clip head fades up, keeping loudness constant and hiding the seam.

   Knobs (all live while playing):
     • Volume    → master gain (v^1.5 curve)
     • Depth     → lowshelf @180Hz  ±12dB
     • Brightness→ highshelf @1kHz  ±12dB
     • Tone      → lowpass cutoff (dark ⇢ airy); on Rain it crossfades the
                   calm roof-rain recording ⇢ the heavier rain recording.
   ============================================================================ */
(function () {
  'use strict';
  if (window.__focusSoundInit) return;
  window.__focusSoundInit = true;

  var LS = 'jeemax_focus_sound_prefs';
  var DEFAULTS = { sound: 'rain', volume: 60, depth: 50, brightness: 50, density: 50, playing: false };

  // ── prefs ────────────────────────────────────────────────────────────────
  var prefs = load();
  function load() {
    var d = Object.assign({}, DEFAULTS);
    try { var r = localStorage.getItem(LS); if (r) d = Object.assign(d, JSON.parse(r)); } catch (e) {}
    return d;
  }
  function save() { try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch (e) {} }
  function saveSoon() {           // debounce slider drags — write once per pause
    if (saveTimer) return;
    saveTimer = setTimeout(function () { saveTimer = null; save(); }, 120);
  }

  // `real: true` = an actual recording (crossfade-looped); otherwise a WAV
  // loop that was rendered seam-seamless and can use plain `loop = true`.
  var SOUNDS = {
    rain:   { label: 'Rain',        icon: '🌧️', files: ['rain.mp3', 'rain-roof.mp3'], real: true,  hint: 'Real · heavy downpour ⇢ calm roof rain' },
    ocean:  { label: 'Ocean',       icon: '🌊', file: 'ocean.wav', hint: 'Slow swells + surf hiss' },
    stream: { label: 'Stream',      icon: '🌲', file: 'stream.wav', hint: 'Gurgling brook + bubbles' },
    fire:   { label: 'Fireplace',   icon: '🔥', file: 'fire.wav', hint: 'Warm rumble + soft crackles' },
    cafe:   { label: 'Café',        icon: '☕', file: 'cafe.mp3', real: true, hint: 'Real · café murmur' },
    wind:   { label: 'Wind',        icon: '🍃', file: 'wind.wav', hint: 'Howling sweeps + gusts' },
    drone:  { label: 'Deep Drone',  icon: '🧘', file: 'drone.wav', hint: 'Detuned hum, slow breathing' },
    brown:  { label: 'Brown Noise', icon: '🟤', file: 'brown.wav', hint: 'Deep rumble' },
    pink:   { label: 'Pink Noise',  icon: '🌸', file: 'pink.wav', hint: 'Balanced, soft' },
    white:  { label: 'White Noise', icon: '⬜', file: 'white.wav', hint: 'Bright, even hiss' }
  };

  // ── WebAudio graph ───────────────────────────────────────────────────────
  var actx = null, masterIn = null, depthFilter = null, brightFilter = null, masterGain = null;
  var activeNodes = [];       // long-lived nodes for the current sound
  var currentStop = null;     // teardown fn for the current sound
  var live = null;            // optional { density: fn } hook for live-update
  var switchTimer = null;     // pending preset-switch crossfade timeout
  var fadeTimer = null;       // pending fade-out-before-stop timeout (pause)
  var saveTimer = null;       // localStorage write throttle
  var loadToken = 0;          // guards stale async loads (rapid preset clicks)
  var bufferCache = {};       // decoded AudioBuffer per file

  function supported() { return !!(window.AudioContext || window.webkitAudioContext); }

  function ctx() {
    if (!supported()) return null;
    if (!actx) {
      var C = window.AudioContext || window.webkitAudioContext;
      try {
        actx = new C();
        masterIn = actx.createGain();
        depthFilter = actx.createBiquadFilter();
        depthFilter.type = 'lowshelf';
        depthFilter.frequency.value = 180;
        brightFilter = actx.createBiquadFilter();
        brightFilter.type = 'highshelf';
        brightFilter.frequency.value = 1000;
        masterGain = actx.createGain();
        // Gentle safety compressor — catches summed peaks without flattening
        // the swells (threshold high, ratio low).
        var comp = actx.createDynamicsCompressor();
        comp.threshold.value = -20;
        comp.knee.value = 24;
        comp.ratio.value = 2;
        comp.attack.value = 0.004;
        comp.release.value = 0.3;
        masterIn.connect(depthFilter);
        depthFilter.connect(brightFilter);
        brightFilter.connect(masterGain);
        masterGain.connect(comp);
        comp.connect(actx.destination);
        applyMix();
      } catch (e) { return null; }
    }
    if (actx.state === 'suspended') { try { actx.resume(); } catch (e) {} }
    return actx;
  }

  function track(n) { activeNodes.push(n); return n; }
  function density01() { return Math.max(0, Math.min(1, prefs.density / 100)); }

  function applyMix() {
    if (!actx || !masterGain) return;
    var t = actx.currentTime;
    var v = prefs.volume / 100;
    masterGain.gain.setTargetAtTime(Math.max(0.0001, Math.pow(v, 1.5)), t, 0.05);
    depthFilter.gain.setTargetAtTime((prefs.depth / 100 - 0.5) * 24, t, 0.05);        // ±12 dB lowshelf
    brightFilter.gain.setTargetAtTime((prefs.brightness / 100 - 0.5) * 24, t, 0.05);  // ±12 dB highshelf
  }

  // ── buffer loading (lazy, memoized, cached by the SW) ─────────────────────
  function decode(buf) {
    if (actx.decodeAudioData.length >= 2) {
      return new Promise(function (res, rej) { actx.decodeAudioData(buf, res, rej); });
    }
    return Promise.resolve(actx.decodeAudioData(buf));
  }

  function getBuffer(src) {
    if (bufferCache[src]) return Promise.resolve(bufferCache[src]);
    return fetch('assets/sounds/' + src)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(decode)
      .then(function (dec) { bufferCache[src] = dec; return dec; });
  }

  // ── playback builders ─────────────────────────────────────────────────────
  // Seamless WAV loop: the seam is baked into the file, so plain looping is
  // perfectly clean.
  function startSeamlessLoop(buffer, out, stopFns) {
    var src = track(actx.createBufferSource());
    src.buffer = buffer;
    src.loop = true;
    var g = track(actx.createGain());
    g.gain.value = 1;
    src.connect(g); g.connect(out);
    src.start();
    stopFns.push(function () { try { src.stop(); } catch (e) {} });
    return g;
  }

  // Real-recording looper: constant-loudness crossfade at each loop boundary.
  // The looping source dips 1→0.5→1 over the seam while a one-shot copy of
  // the clip head rises 0→0.5→0 on top — amplitude stays 1.0, seam hidden.
  function startRealLoop(buffer, out, stopFns) {
    var dur = buffer.duration;
    var fade = Math.min(1.2, dur * 0.22);
    var srcA = track(actx.createBufferSource());
    srcA.buffer = buffer;
    srcA.loop = true;
    var gA = track(actx.createGain());
    gA.gain.value = 1;
    srcA.connect(gA); gA.connect(out);
    var t0 = actx.currentTime + 0.1;
    srcA.start(t0);

    var timer = setInterval(schedule, 400);
    var lastScheduled = 0;
    function schedule() {
      var horizon = actx.currentTime + 1.5;
      for (var k = lastScheduled; t0 + k * dur < horizon; k++) {
        lastScheduled = k + 1;
        var tk = t0 + k * dur;
        if (tk < actx.currentTime) continue;
        gA.gain.setValueAtTime(1, tk - fade / 2);
        gA.gain.linearRampToValueAtTime(0.5, tk);
        gA.gain.linearRampToValueAtTime(1, tk + fade / 2);
        var srcB = actx.createBufferSource();   // `let` below keeps each onended
        srcB.buffer = buffer;                    // closure bound to ITS OWN nodes
        let gB = actx.createGain();
        srcB.connect(gB); gB.connect(out);
        gB.gain.setValueAtTime(0.0001, tk - fade / 2);
        gB.gain.linearRampToValueAtTime(0.5, tk);
        gB.gain.linearRampToValueAtTime(0.0001, tk + fade / 2);
        srcB.start(tk - fade / 2, 0, fade);
        srcB.onended = function () { try { gB.disconnect(); } catch (e) {} };
      }
    }
    schedule();
    stopFns.push(function () { clearInterval(timer); try { srcA.stop(); } catch (e) {} });
    return gA;
  }

  // Build the graph for the current sound. `buffers` matches def.files/def.file.
  function startCurrent(def, buffers) {
    var tone = track(actx.createBiquadFilter());   // Tone knob (density) lives here
    tone.type = 'lowpass';
    tone.Q.value = 0.5;
    tone.connect(masterIn);
    var stopFns = [];
    var densityFn = null;

    if (def.files) {
      // Rain: two recordings, crossfaded by Tone.
      var gHeavy = (def.real ? startRealLoop : startSeamlessLoop)(buffers[0], tone, stopFns); // rain.mp3
      var gCalm = (def.real ? startRealLoop : startSeamlessLoop)(buffers[1], tone, stopFns); // rain-roof.mp3
      tone.frequency.value = 12000;                 // pass everything; Tone = blend
      densityFn = function (d) {
        var a = d * Math.PI / 2;
        gHeavy.gain.setTargetAtTime(Math.sin(a), actx.currentTime, 0.1);
        gCalm.gain.setTargetAtTime(Math.cos(a), actx.currentTime, 0.1);
      };
    } else {
      var g = (def.real ? startRealLoop : startSeamlessLoop)(buffers[0], tone, stopFns);
      densityFn = function (d) {
        tone.frequency.setTargetAtTime(700 + d * 12000, actx.currentTime, 0.1);   // dark ⇢ airy
      };
    }

    densityFn(density01());
    return {
      stop: function () { stopFns.forEach(function (fn) { try { fn(); } catch (e) {} }); },
      live: { density: densityFn }
    };
  }

  // ── start / stop / switch ────────────────────────────────────────────────
  function stopNodes() {
    if (switchTimer) { clearTimeout(switchTimer); switchTimer = null; }
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
    if (currentStop) { try { currentStop(); } catch (e) {} currentStop = null; }
    activeNodes.forEach(function (n) { try { if (n.stop) n.stop(); n.disconnect(); } catch (e) {} });
    activeNodes.length = 0;
    live = null;
  }

  function loadAndPlay() {
    var token = ++loadToken;
    var def = SOUNDS[prefs.sound] || SOUNDS.rain;
    var srcs = def.files || [def.file];
    setStatus('Loading ' + def.label + '…');
    Promise.all(srcs.map(getBuffer))
      .then(function (buffers) {
        if (token !== loadToken || !prefs.playing) return;   // user moved on / paused
        stopNodes();
        var r = startCurrent(def, buffers);
        currentStop = r.stop;
        live = r.live;
        applyMix();
        reflect();
      })
      .catch(function (err) {
        if (token !== loadToken) return;
        prefs.playing = false; save();
        setStatus('⚠️ Couldn\'t load audio (' + (err && err.message ? err.message : 'network') + ') — try again online once.');
        reflect();
      });
  }

  function start() {
    if (!supported()) { setStatus('⚠️ WebAudio unsupported in this browser.'); return; }
    var c = ctx(); if (!c) return;
    if (prefs.playing) return;
    prefs.playing = true; save();
    loadAndPlay();
  }

  function pause() {
    if (actx && masterGain) masterGain.gain.setTargetAtTime(0.0001, actx.currentTime, 0.04);
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(function () { fadeTimer = null; stopNodes(); }, 70);
    prefs.playing = false; save();
    reflect();
  }

  function toggle() { prefs.playing ? pause() : start(); }

  // Switch preset with a quick 120ms dip so the swap doesn't click.
  function selectSound(id, autoplay) {
    if (!SOUNDS[id]) return;
    prefs.sound = id; save();
    markActive(id);
    if (!prefs.playing) {
      if (autoplay) start();
      return;
    }
    var c = ctx(); if (!c) return;
    if (switchTimer) { clearTimeout(switchTimer); switchTimer = null; }
    var target = Math.max(0.0001, Math.pow(prefs.volume / 100, 1.5));
    masterGain.gain.setTargetAtTime(0.0001, c.currentTime, 0.03);
    stopNodes();                          // stop the old sound NOW — no stale
    switchTimer = setTimeout(function () {  // fade-back while the new one loads
      switchTimer = null;
      if (!prefs.playing) return;      // paused/stopped mid-dip — don't revive
      loadAndPlay();
      masterGain.gain.setTargetAtTime(target, c.currentTime, 0.05);
    }, 120);
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  function renderPresets() {
    var wrap = document.getElementById('sc-presets');
    if (!wrap) return;
    wrap.innerHTML = '';
    Object.keys(SOUNDS).forEach(function (id) {
      var p = SOUNDS[id];
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'sc-preset' + (id === prefs.sound ? ' active' : '');
      chip.setAttribute('data-sound', id);
      chip.title = p.hint;
      chip.innerHTML = '<span class="sc-preset-icon">' + p.icon + '</span><span class="sc-preset-label">' + p.label + '</span>' +
        (p.real ? '<span class="sc-preset-real">REAL</span>' : '');
      chip.addEventListener('click', function () { selectSound(id, true); });
      wrap.appendChild(chip);
    });
  }

  function markActive(id) {
    var chips = document.querySelectorAll('#sc-presets .sc-preset');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('active', chips[i].getAttribute('data-sound') === id);
    }
  }

  function reflect() {
    var btn = document.getElementById('sc-power');
    if (btn) {
      btn.classList.toggle('on', prefs.playing);
      btn.textContent = prefs.playing ? '❚❚' : '▶';
      btn.setAttribute('aria-label', prefs.playing ? 'Stop soundscape' : 'Play soundscape');
    }
    var p = SOUNDS[prefs.sound];
    if (prefs.playing && p) setStatus('▶ ' + p.label + ' · ' + p.hint);
    else setStatus('Idle — pick a bed and hit play.');
  }

  function setStatus(msg) {
    var s = document.getElementById('sc-status');
    if (s) s.textContent = msg;
  }

  function wireSliders() {
    var SLIDER_INFO = {
      'sc-volume': 'Master loudness of the sound bed',
      'sc-depth': 'Low-end body — how deep and grounded it feels',
      'sc-brightness': 'High-frequency air and sparkle',
      'sc-density': 'Tone — dark & muffled ⇢ bright & airy. On Rain: calm roof rain ⇢ heavy rain'
    };
    [['sc-volume', 'volume'], ['sc-depth', 'depth'], ['sc-brightness', 'brightness'], ['sc-density', 'density']]
      .forEach(function (pair) {
        var el = document.getElementById(pair[0]);
        if (!el) return;
        var valEl = document.getElementById(pair[0] + '-val');
        el.value = prefs[pair[1]];
        el.title = SLIDER_INFO[pair[0]] || '';
        if (valEl) valEl.textContent = prefs[pair[1]] + '%';
        el.addEventListener('input', function () {
          prefs[pair[1]] = parseInt(el.value, 10) || 0;
          if (valEl) valEl.textContent = prefs[pair[1]] + '%';
          saveSoon();
          applyMix();
          if (pair[1] === 'density' && live && live.density) {
            try { live.density(density01()); } catch (e) {}
          }
        });
      });
  }

  function boot() {
    if (!document.body) { requestAnimationFrame(boot); return; }
    // A saved `playing: true` can't survive a reload (autoplay policy) — reset
    // so the power button and status line never claim a silent "playing" state.
    prefs.playing = false;
    renderPresets();
    wireSliders();
    reflect();
    // power button is wired inline via onclick="FocusSound.toggle()"
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ── public surface ───────────────────────────────────────────────────────
  window.FocusSound = {
    prefs: prefs,
    toggle: toggle,
    start: start,
    pause: pause,
    select: selectSound,
    supported: supported
  };
})();
