/* ============================================================================
   focus-sound.js — Focus Soundscape engine for JEEMaxxing (v4 — clean pass).
   Plays pre-rendered audio: seamless WAV loops (scripts/gen-ambient-sounds.mjs
   v3 — equal-power seams, AGC-tamed dynamics, matched loudness) + CC0
   recordings for Rain & Café (assets/sounds/). Nothing is synthesised at
   runtime.

   v4 fixes the "weird / cutting / blowing up" family of complaints:

     • NO MORE MUTE-DIP SWITCHING — presets now crossfade graph-vs-graph
       (~0.8s overlap): the old bed fades down while the new one rises, so
       switching never cuts to silence or jumps in level.
     • GRAIN-LOOP expansion for short recordings — rain.mp3 (9s) used to be
       spliced at random offsets with short crossfades, which slammed between
       different parts of the recording mid-stream. Now it's a circular
       grain overlap-add canvas (0.65–1.5s grains, equal-power windows,
       wrap-seamless by construction): statistically even, no discrete seams.
     • HEADROOM — per-preset trim gains keep summed layers off the clip
       ceiling; the master compressor is a gentle safety, not a distortion
       source.
     • SANE KNOBS — Depth/Brightness shelves were ±15dB (a Depth drag could
       boom brown noise into clipping = random blow-ups). Now ±8/±7dB with a
       soft power taper that stays musical near centre.
     • SLIDERS THAT FEED BACK — every slider paints its track fill live
       (--sc-fill), double-click still snaps to default.
     • AUTO-RESUME — if the tab/device sleeps and suspends the AudioContext
       while playing, we resume it on visibility/page return instead of
       leaving dead silence.

   Knobs (all live while playing):
     • Volume    → master gain (v^1.6 curve)
     • Depth     → lowshelf @110Hz  ±8 dB  (soft taper)
     • Brightness→ highshelf @3.5kHz ±7 dB (soft taper)
     • Tone      → lowpass cutoff (dark ⇢ airy); on Rain it crossfades the
                   calm roof-rain recording ⇢ the heavier rain recording.
   ============================================================================ */
(function () {
  'use strict';
  if (window.__focusSoundInit) return;
  window.__focusSoundInit = true;

  var LS = 'jeemax_focus_sound_prefs';
  var DEFAULTS = { v: 2, sound: 'rain', volume: 60, depth: 50, brightness: 50, density: 100, playing: false, autoSession: true };
  // Per-knob reset targets (double-click a slider to snap back).
  var KNOB_DEFAULTS = { volume: 60, depth: 50, brightness: 50, density: 100 };
  var KNOB_LABELS = { volume: 'Volume', depth: 'Depth', brightness: 'Brightness', density: 'Tone' };

  // Fade shaping — a bed should breathe in and out, never click on/off.
  var FADE_IN_SECS = 1.4;       // linear attack when a bed starts
  var FADE_OUT_SECS = 0.5;      // release when paused / toggled off
  var XFADE_UP_SECS = 0.9;      // preset-switch: new bed rise
  var XFADE_DOWN_SECS = 0.55;   // preset-switch: old bed fall (then stop)
  var DUCK_HOLD_MS = 1500;      // bell-duck hold before the bed swells back

  // ── prefs ────────────────────────────────────────────────────────────────
  var prefs = load();
  function load() {
    var d = Object.assign({}, DEFAULTS);
    try {
      var r = localStorage.getItem(LS);
      if (r) {
        var stored = JSON.parse(r);
        // One-time migration: pre-v2 installs saved the old linear Tone knob's
        // 50% default, which under the new mapping sits mid-muffle. Snap any
        // untouched Tone to fully open; deliberately-set values survive.
        if (stored && !stored.v && stored.density === 50) stored.density = 100;
        if (stored) d = Object.assign(d, stored);
      }
    } catch (e) {}
    return d;
  }
  function save() { try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch (e) {} }
  function saveSoon() {           // debounce slider drags — write once per pause
    if (saveTimer) return;
    saveTimer = setTimeout(function () { saveTimer = null; save(); }, 120);
  }

  // `real: true` = an actual recording (crossfade-looped); otherwise a WAV
  // loop rendered seam-clean by the v3 generator (plain `loop = true`).
  // `trim` = per-preset headroom/loudness trim applied where the graph meets
  // the master bus (keeps summed layers away from the clip ceiling).
  var SOUNDS = {
    rain:   { label: 'Rain',        icon: '🌧️', files: ['rain.mp3', 'rain-roof.mp3'], real: true, trim: 0.82, hint: 'Real · heavy downpour ⇢ calm roof rain' },
    ocean:  { label: 'Ocean',       icon: '🌊', file: 'ocean.wav', trim: 1.0, hint: 'Slow swells + distant breakers' },
    stream: { label: 'Stream',      icon: '🌲', file: 'stream.wav', trim: 0.95, hint: 'Gurgling brook + soft plops' },
    fire:   { label: 'Fireplace',   icon: '🔥', file: 'fire.wav', trim: 1.05, hint: 'Warm ember bed + gentle crackle' },
    cafe:   { label: 'Café',        icon: '☕', file: 'cafe.mp3', real: true, trim: 1.0, hint: 'Real · café murmur' },
    wind:   { label: 'Wind',        icon: '🍃', file: 'wind.wav', trim: 0.9, hint: 'Soft gusts + leaf rustle' },
    drone:  { label: 'Deep Drone',  icon: '🧘', file: 'drone.wav', trim: 1.15, hint: 'Detuned hum, slow breathing' },
    brown:  { label: 'Brown Noise', icon: '🟤', file: 'brown.wav', trim: 1.0, hint: 'Deep rumble' },
    pink:   { label: 'Pink Noise',  icon: '🌸', file: 'pink.wav', trim: 0.95, hint: 'Balanced, soft' },
    white:  { label: 'White Noise', icon: '⬜', file: 'white.wav', trim: 0.85, hint: 'Bright, even hiss' }
  };

  // ── WebAudio graph ───────────────────────────────────────────────────────
  var actx = null, masterIn = null, depthFilter = null, brightFilter = null, masterGain = null;
  var graphs = [];            // live sound graphs [{ out, stop, dying }]
  var live = null;            // optional { density: fn } hook for the newest graph
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
        depthFilter.frequency.value = 110;          // true low-end body
        brightFilter = actx.createBiquadFilter();
        brightFilter.type = 'highshelf';
        brightFilter.frequency.value = 3500;        // air & sparkle shelf
        masterGain = actx.createGain();
        // Gentle safety compressor — catches summed peaks without flattening
        // the swells (threshold high, ratio low).
        var comp = actx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 22;
        comp.ratio.value = 2.5;
        comp.attack.value = 0.004;
        comp.release.value = 0.28;
        masterIn.connect(depthFilter);
        depthFilter.connect(brightFilter);
        brightFilter.connect(masterGain);
        masterGain.connect(comp);
        comp.connect(actx.destination);
        applyMix();
      } catch (e) { return null; }

      // Mobile/desktop sleep suspend: silently revive when we come back so a
      // "playing" bed never returns as dead air.
      var resumeIfPlaying = function () {
        if (!prefs.playing || !actx) return;
        if (actx.state === 'suspended') { try { actx.resume(); } catch (e) {} }
      };
      document.addEventListener('visibilitychange', resumeIfPlaying);
      window.addEventListener('pageshow', resumeIfPlaying);
      window.addEventListener('pointerdown', function () {
        if (actx && actx.state === 'suspended') { try { actx.resume(); } catch (e) {} }
      });
    }
    if (actx.state === 'suspended') { try { actx.resume(); } catch (e) {} }
    return actx;
  }

  function density01() { return Math.max(0, Math.min(1, prefs.density / 100)); }

  // Soft power taper for the tone shelves: ±maxDb at full travel but gentle
  // near centre (v2's linear ±15dB made every small Depth drag a boom).
  function shelfDb(v100, maxDb) {
    var x = (v100 / 100 - 0.5) * 2;                       // −1 … +1
    var shaped = (x < 0 ? -1 : 1) * Math.pow(Math.abs(x), 1.4);
    return shaped * maxDb;
  }

  function applyMix() {
    if (!actx || !masterGain) return;
    depthFilter.gain.setTargetAtTime(shelfDb(prefs.depth, 8), actx.currentTime, 0.06);
    brightFilter.gain.setTargetAtTime(shelfDb(prefs.brightness, 7), actx.currentTime, 0.06);
    setMaster(targetGain(), 0.06);
  }

  function targetGain() {
    return Math.max(0.0001, Math.pow(prefs.volume / 100, 1.6));
  }

  /** Move the master gain to `v` over `secs` (linear), cancelling ramps. */
  function setMaster(v, secs) {
    var t = actx.currentTime;
    try {
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), t);
      if (secs <= 0.06) masterGain.gain.setTargetAtTime(v, t, 0.05);
      else masterGain.gain.linearRampToValueAtTime(v, t + secs);
    } catch (e) { try { masterGain.gain.value = v; } catch (e2) {} }
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
  // Mono beds get a subtle Haas widener (right ear delayed ~16ms) — decorrelated
  // width is the difference between "lo-fi mono file" and "ambience". Stereo
  // sources pass through untouched.
  function widenTo(g, dest) {
    var merge;
    try { merge = actx.createChannelMerger(2); } catch (e) { g.connect(dest); return; }
    var delay = actx.createDelay(0.05);
    delay.delayTime.value = 0.016;
    var wet = actx.createGain();
    wet.gain.value = 0.85;
    merge.connect(dest);
    g.connect(merge, 0, 0);
    g.connect(delay); delay.connect(wet); wet.connect(merge, 0, 1);
  }

  // Seamless WAV loop: the seam is baked into the file (equal-power in the v3
  // generator), so plain looping is perfectly clean.
  function startSeamlessLoop(buffer, out, stopFns) {
    var src = actx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    var g = actx.createGain();
    g.gain.value = 1;
    src.connect(g);
    if (buffer.numberOfChannels === 1) widenTo(g, out); else g.connect(out);
    src.start();
    stopFns.push(function () { try { src.stop(); } catch (e) {} });
    return g;
  }

  // Equal-power fade curves — sin/cos pairs keep perceived loudness flat
  // through a crossfade of UNCORRELATED content (linear halves do not).
  function eqCurve(up) {
    var N = 96, c = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      var t = i / (N - 1);
      c[i] = Math.max(0.0001, up ? Math.sin(Math.PI / 2 * t) : Math.cos(Math.PI / 2 * t));
    }
    return c;
  }
  var EQ_IN = null, EQ_OUT = null;

  // Real-recording looper: successive full-buffer playbacks whose tail
  // crossfades (equal-power) into the next playback's head — constant power,
  // aligned content, no shared gain automation → seamless.
  var diagCycles = 0;        // test hook: total real-loop cycles scheduled
  var diagComposites = 0;    // test hook: short clips expanded to long loops

  // ── Short-clip expansion (grain overlap-add) ────────────────────────────
  // rain.mp3 is a 9-second recording. v3 spliced RANDOM OFFSET SEGMENTS with
  // short crossfades — every splice was an audible texture jump ("cutting",
  // "irregular"). v4 builds a ≥minSec canvas from SHORT overlapping grains:
  // each grain fades in/out over its own equal-power window and positions
  // wrap CIRCULARLY, so the loop seam is seamless by construction and there
  // are no discrete splice points anywhere — just a statistically even wash.
  var MIN_REAL_SEC = 45;
  var compositeCache = new Map();

  function makeGrainLoop(srcBuf, minSec) {
    var key = srcBuf.__grainKey || (srcBuf.__grainKey = 'g' + Math.random());
    if (compositeCache.has(key)) return compositeCache.get(key);
    var sr = srcBuf.sampleRate, chs = srcBuf.numberOfChannels, srcLen = srcBuf.length;
    var grainSec = Math.min(1.5, Math.max(0.65, srcBuf.duration * 0.18));
    var grain = Math.floor(grainSec * sr);
    if (srcLen <= grain + 64) return srcBuf;               // too short to slice safely
    var hop = Math.floor(grain * 0.62);
    var fadeN = grain - hop;                               // overlap window
    var total = Math.floor(minSec * sr);
    var N = 128, rise = new Float32Array(N), fall = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      var tt = i / (N - 1);
      rise[i] = Math.sin(Math.PI / 2 * tt);
      fall[i] = Math.cos(Math.PI / 2 * tt);
    }
    var chans = [];
    for (var c = 0; c < chs; c++) chans.push(new Float32Array(total));
    var pos = 0, guard = 0;
    while (pos < total && guard++ < 4000) {
      var off = Math.floor(Math.random() * (srcLen - grain));
      for (var c2 = 0; c2 < chs; c2++) {
        var srcD = srcBuf.getChannelData(c2), dst = chans[c2];
        for (var j = 0; j < grain; j++) {
          var idx = (pos + j) % total;                     // circular → wrap-safe
          var w = 1;
          if (j < fadeN) w = rise[(j / fadeN * (N - 1)) | 0];
          else if (j >= hop) w = fall[((j - hop) / fadeN * (N - 1)) | 0];
          dst[idx] += srcD[off + j] * w;
        }
      }
      pos += hop;
    }
    var out;
    try {
      out = actx.createBuffer(chs, total, sr);
      for (var c3 = 0; c3 < chs; c3++) out.getChannelData(c3).set(chans[c3]);
    } catch (e) { return srcBuf; }                         // OOM etc. — better short than silent
    compositeCache.set(key, out);
    diagComposites++;
    return out;
  }

  function ensureRealLength(buffer) {
    if (!buffer || buffer.duration >= MIN_REAL_SEC) return buffer;
    try { return makeGrainLoop(buffer, MIN_REAL_SEC); } catch (e) { return buffer; }
  }

  function startRealLoop(buffer, out, stopFns) {
    if (!EQ_IN) { EQ_IN = eqCurve(true); EQ_OUT = eqCurve(false); }
    var dur = buffer.duration;
    var fade = Math.max(0.8, Math.min(3.0, dur * 0.12));
    if (dur < 2 * fade + 0.5) fade = dur / 4;

    var busOut = actx.createGain();          // stable blend node for Rain's dual-layer
    busOut.gain.value = 1;
    if (buffer.numberOfChannels === 1) widenTo(busOut, out); else busOut.connect(out);

    var stopped = false;
    var liveSources = new Set();
    var nextStart = actx.currentTime + 0.05;

    function scheduleCycle() {
      if (stopped) return;
      var horizon = actx.currentTime + 2.5;
      while (!stopped && nextStart < horizon) {
        (function (startAt) {
          var src = actx.createBufferSource();
          src.buffer = buffer;
          var g = actx.createGain();
          src.connect(g); g.connect(busOut);
          try {
            g.gain.setValueAtTime(0.0001, startAt);
            g.gain.setValueCurveAtTime(EQ_IN, startAt, fade);              // head rises
            g.gain.setValueAtTime(1, startAt + fade);
            g.gain.setValueCurveAtTime(EQ_OUT, startAt + dur - fade, fade); // tail falls under next head
          } catch (e) { /* automation clash — play flat rather than skip */ }
          src.start(startAt);
          src.stop(startAt + dur + 0.03);
          liveSources.add(src);
          src.onended = function () { liveSources.delete(src); try { g.disconnect(); } catch (e) {} };
        })(nextStart);
        diagCycles++;
        nextStart += dur - fade;   // overlap window == fade
      }
    }
    scheduleCycle();
    var timer = setInterval(scheduleCycle, 500);
    stopFns.push(function () {
      stopped = true;
      clearInterval(timer);
      liveSources.forEach(function (s) { try { s.stop(); } catch (e) {} });
      liveSources.clear();
    });
    return busOut;
  }

  // Build one sound graph: layers → tone filter → buildOut(trim) → masterIn.
  // Returns { out, stop, live }. The caller owns fading via `out`.
  function buildGraph(def, buffers) {
    var stopFns = [];
    var buildOut = actx.createGain();
    buildOut.gain.value = def.trim != null ? def.trim : 1;

    var tone = actx.createBiquadFilter();   // Tone knob (density) lives here
    tone.type = 'lowpass';
    tone.Q.value = 0.5;
    tone.frequency.value = 19000;           // transparent until densityFn says otherwise
    tone.connect(buildOut);
    buildOut.connect(masterIn);

    var densityFn;
    if (def.files) {
      // Rain: two recordings, equal-power crossfaded by Tone.
      var gHeavy = startRealLoop(buffers[0], tone, stopFns);   // rain.mp3
      var gCalm = startRealLoop(buffers[1], tone, stopFns);    // rain-roof.mp3
      densityFn = function (d) {
        var a = d * Math.PI / 2;
        gHeavy.gain.setTargetAtTime(Math.sin(a), actx.currentTime, 0.1);
        gCalm.gain.setTargetAtTime(Math.cos(a), actx.currentTime, 0.1);
      };
    } else {
      var g = startRealLoop(buffers[0], tone, stopFns);
      densityFn = function (d) {
        // Exponential dark⇢airy that reaches FULLY OPEN by 85% travel — top of
        // range = transparent, mids never sit in permanent mud.
        var f = 1500 * Math.pow(19 / 1.5, Math.min(1, d / 0.85));
        tone.frequency.setTargetAtTime(Math.min(19000, f), actx.currentTime, 0.1);
      };
    }

    densityFn(density01());
    return {
      out: buildOut,
      stop: function () { stopFns.forEach(function (fn) { try { fn(); } catch (e) {} }); try { buildOut.disconnect(); } catch (e) {} try { tone.disconnect(); } catch (e) {} },
      live: { density: densityFn }
    };
  }

  /** Fade a graph out and retire it — no clicks, no stale audio left running. */
  function retireGraph(g) {
    if (g.dying) return;
    g.dying = true;
    try {
      var t = actx.currentTime;
      g.out.gain.cancelScheduledValues(t);
      g.out.gain.setValueAtTime(Math.max(0.0001, g.out.gain.value), t);
      g.out.gain.exponentialRampToValueAtTime(0.0001, t + XFADE_DOWN_SECS);
    } catch (e) {}
    setTimeout(function () {
      try { g.stop(); } catch (e) {}
      var ix = graphs.indexOf(g);
      if (ix >= 0) graphs.splice(ix, 1);
    }, XFADE_DOWN_SECS * 1000 + 120);
  }

  /** Hard-stop everything immediately (pause path). */
  function shutdownAll() {
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
    graphs.forEach(function (g) { try { g.stop(); } catch (e) {} });
    graphs.length = 0;
    live = null;
  }

  /**
   * Load buffers and build the current sound.
   * mode 'start'  : fresh playback from silence — master breathes in.
   * mode 'switch' : crossfade — old graph(s) fade down, new one rises, master
   *                 gain untouched → no dip, no jump, no cut.
   */
  function loadAndPlay(mode) {
    var token = ++loadToken;
    var def = SOUNDS[prefs.sound] || SOUNDS.rain;
    var srcs = def.files || [def.file];
    setStatus((mode === 'switch' ? 'Switching to ' : 'Loading ') + def.label + '…');
    Promise.all(srcs.map(getBuffer))
      .then(function (buffers) {
        if (token !== loadToken || !prefs.playing) return;   // user moved on / paused
        if (def.real) buffers = buffers.map(ensureRealLength); // expand short recordings
        var g = buildGraph(def, buffers);
        graphs.push(g);
        live = g.live;
        if (mode === 'switch') {
          graphs.forEach(function (old) { if (old !== g) retireGraph(old); });
          try {
            var t = actx.currentTime, tv = def.trim != null ? def.trim : 1;
            g.out.gain.setValueAtTime(0.0001, t);
            g.out.gain.setTargetAtTime(tv, t, XFADE_UP_SECS / 3);
          } catch (e) {}
          setStatus('▶ ' + def.label + ' · ' + def.hint);
        } else {
          applyMix();
          setMaster(0.0001, 0);                    // breathe in from silence…
          setMaster(targetGain(), FADE_IN_SECS);   // …to full over ~1.4s
        }
        reflect();
      })
      .catch(function (err) {
        if (token !== loadToken) return;
        if (mode === 'switch') {
          // Keep whatever is already playing alive; just report the miss.
          setStatus('⚠️ Couldn\'t load ' + def.label + ' (' + (err && err.message ? err.message : 'network') + ') — kept current sound.');
          reflect();
          return;
        }
        prefs.playing = false; save();
        setStatus('⚠️ Couldn\'t load audio (' + (err && err.message ? err.message : 'network') + ') — try again online once.');
        reflect();
      });
  }

  function start() {
    if (!supported()) { setStatus('⚠️ WebAudio unsupported in this browser.'); return; }
    var c = ctx();
    if (!c) { setStatus('⚠️ Audio engine refused to start — reload and try again.'); return; }
    if (prefs.playing) return;
    prefs.playing = true; save();
    loadAndPlay('start');
  }

  function pause() {
    if (actx && masterGain) setMaster(0.0001, FADE_OUT_SECS);
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(function () { fadeTimer = null; shutdownAll(); }, FADE_OUT_SECS * 1000 + 80);
    prefs.playing = false; save();
    reflect();
  }

  function toggle() { prefs.playing ? pause() : start(); }

  // ── session bridge (called by pomodoro.js) ───────────────────────────────
  /** Start the bed automatically when a focus block begins — if enabled. */
  function autoStart() {
    if (!prefs.autoSession || prefs.playing) return;
    start();
  }

  function setAuto(v) {
    prefs.autoSession = !!v;
    save();
  }

  var duckToken = 0;
  /** Dip the bed so the pomodoro bell cuts through, then swell back. */
  function duck() {
    if (!actx || !masterGain || !prefs.playing) return;
    var token = ++duckToken;
    var floor = Math.max(0.0001, targetGain() * 0.25);
    setMaster(floor, 0.09);
    setTimeout(function () {
      if (token !== duckToken || !prefs.playing) return;   // superseded/paused
      var t = actx.currentTime;
      try {
        masterGain.gain.cancelScheduledValues(t);
        masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), t);
        masterGain.gain.setTargetAtTime(targetGain(), t, 0.4);   // soft swell-back
      } catch (e) { setMaster(targetGain(), 0.8); }
    }, DUCK_HOLD_MS);
  }

  // Switch preset with a true crossfade — the old bed keeps sounding (and
  // fades down) while the new one loads and rises. No mute gap, no level jump.
  function selectSound(id, autoplay) {
    if (!SOUNDS[id]) return;
    var changed = id !== prefs.sound;
    prefs.sound = id; save();
    markActive(id);
    if (!prefs.playing) {
      if (autoplay) start();
      return;
    }
    var c = ctx(); if (!c) return;
    if (!changed && graphs.length) return;   // same bed re-clicked — nothing to do
    loadAndPlay('switch');
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

  // Paint the value fill behind a range input (the CSS draws --sc-fill).
  function paintFill(el) {
    var min = parseFloat(el.min) || 0, max = parseFloat(el.max) || 100;
    var pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
    el.style.setProperty('--sc-fill', pct + '%');
    el.setAttribute('aria-valuetext', Math.round(parseFloat(el.value)) + '%');
  }

  function wireSliders() {
    var SLIDER_INFO = {
      'sc-volume': 'Master loudness of the sound bed',
      'sc-depth': 'Low-end body — how deep and grounded it feels (double-click to reset)',
      'sc-brightness': 'High-frequency air and sparkle (double-click to reset)',
      'sc-density': 'Tone — dark & muffled ⇢ fully open by 85%. On Rain: calm roof rain ⇢ heavy rain (double-click to reset)'
    };
    [['sc-volume', 'volume'], ['sc-depth', 'depth'], ['sc-brightness', 'brightness'], ['sc-density', 'density']]
      .forEach(function (pair) {
        var el = document.getElementById(pair[0]);
        if (!el) return;
        var valEl = document.getElementById(pair[0] + '-val');
        el.value = prefs[pair[1]];
        el.title = SLIDER_INFO[pair[0]] || '';
        paintFill(el);
        if (valEl) valEl.textContent = prefs[pair[1]] + '%';
        el.addEventListener('input', function () {
          prefs[pair[1]] = parseInt(el.value, 10) || 0;
          paintFill(el);
          if (valEl) valEl.textContent = prefs[pair[1]] + '%';
          saveSoon();
          applyMix();
          if (pair[1] === 'density' && live && live.density) {
            try { live.density(density01()); } catch (e) {}
          }
        });
        // Double-click snaps the knob back to its default — quick "undo my
        // fiddling" without hunting for a neutral position.
        el.addEventListener('dblclick', function () {
          prefs[pair[1]] = KNOB_DEFAULTS[pair[1]];
          el.value = prefs[pair[1]];
          paintFill(el);
          if (valEl) valEl.textContent = prefs[pair[1]] + '%';
          save();
          applyMix();
          if (pair[1] === 'density' && live && live.density) {
            try { live.density(density01()); } catch (e) {}
          }
          setStatus(KNOB_LABELS[pair[1]] + ' reset to default');
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
    var scAuto = document.getElementById('sc-auto');
    if (scAuto) scAuto.checked = !!prefs.autoSession;
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
    supported: supported,
    autoStart: autoStart,
    setAuto: setAuto,
    duck: duck,
    // Test hooks (QA scripts): diag counters + run a real asset through the
    // exact expansion path used at playback time.
    _diag: function () { return { cycles: diagCycles, composites: diagComposites }; },
    _state: function () {
      return {
        graphs: graphs.length,
        dying: graphs.filter(function (g) { return g.dying; }).length,
        alive: graphs.filter(function (g) { return !g.dying; }).length,
        sound: prefs.sound
      };
    },
    _buildTestLoop: function (src) {
      return getBuffer(src).then(function (b) { return ensureRealLength(b); });
    }
  };
})();
