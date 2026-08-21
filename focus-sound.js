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
  var DEFAULTS = { v: 2, sound: 'rain', volume: 60, depth: 50, brightness: 50, density: 100, playing: false, autoSession: true };
  // Per-knob reset targets (double-click a slider to snap back).
  var KNOB_DEFAULTS = { volume: 60, depth: 50, brightness: 50, density: 100 };
  var KNOB_LABELS = { volume: 'Volume', depth: 'Depth', brightness: 'Brightness', density: 'Tone' };

  // Fade shaping — a bed should breathe in and out, never click on/off.
  var FADE_IN_SECS = 1.4;       // linear attack when a bed starts
  var FADE_OUT_SECS = 0.45;     // release when paused / toggled off
  var DUCK_HOLD_MS = 1900;      // bell-duck hold before the bed swells back

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
        depthFilter.frequency.value = 110;          // true low-end body
        brightFilter = actx.createBiquadFilter();
        brightFilter.type = 'highshelf';
        brightFilter.frequency.value = 3500;        // air & sparkle shelf, not honk
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
    depthFilter.gain.setTargetAtTime((prefs.depth / 100 - 0.5) * 30, actx.currentTime, 0.05);        // ±15 dB lowshelf
    brightFilter.gain.setTargetAtTime((prefs.brightness / 100 - 0.5) * 28, actx.currentTime, 0.05);  // ±14 dB highshelf
    setMaster(targetGain(), 0.05);
  }

  function targetGain() {
    return Math.max(0.0001, Math.pow(prefs.volume / 100, 1.5));
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

  // Seamless WAV loop: the seam is baked into the file, so plain looping is
  // perfectly clean.
  function startSeamlessLoop(buffer, out, stopFns) {
    var src = track(actx.createBufferSource());
    src.buffer = buffer;
    src.loop = true;
    var g = track(actx.createGain());
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

  // Real-recording looper v3: successive full-buffer playbacks whose tail
  // crossfades (equal-power) into the next playback's head.
  //
  // The v2 trick — one looping source dipping to 0.5 while a copy of the clip
  // head rose to 0.5 — summed two DIFFERENT parts of the recording at linear
  // halves: a loudness dip plus comb phasing on every wrap. Rain/Café audibly
  // "wobbled" each pass. Here every cycle plays the whole buffer once as its
  // own source; cycle k+1 starts `fade` before cycle k ends and the two
  // overlap tail→head through sin/cos curves. Constant power, aligned content,
  // no shared gain automation → seamless.
  var diagCycles = 0;        // test hook: total real-loop cycles scheduled
  var diagComposites = 0;    // test hook: short clips expanded to long loops

  // ── Short-clip expansion ────────────────────────────────────────────────
  // rain.mp3 is a 9-second recording — looping it raw means an audible pulse
  // every ~8s no matter how clean the seam. Build a ≥minSec composite once at
  // decode time: overlapping copies of the source at RANDOM offsets joined by
  // equal-power crossfades, then a baked wrap-seam. Successive passes become
  // decorrelated, so nothing repeats on a fixed period.
  var MIN_REAL_SEC = 45;
  var compositeCache = new Map();

  function makeCompositeLoop(srcBuf, minSec) {
    var key = srcBuf.__compositeKey || (srcBuf.__compositeKey = 'b' + Math.random());
    if (compositeCache.has(key)) return compositeCache.get(key);
    var sr = srcBuf.sampleRate, chs = srcBuf.numberOfChannels;
    var fadeS = Math.max(64, Math.floor(Math.min(1.2, srcBuf.duration * 0.22) * sr));
    var total = Math.floor(minSec * sr);
    var workLen = total + fadeS;
    var N = 128;
    var rise = new Float32Array(N), fall = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      var t = i / (N - 1);
      rise[i] = Math.sin(Math.PI / 2 * t);
      fall[i] = Math.cos(Math.PI / 2 * t);
    }
    var chans = [];
    for (var c = 0; c < chs; c++) chans.push(new Float32Array(workLen));
    var pos = 0, guard = 0;
    while (pos < total && guard++ < 600) {
      var maxOff = Math.max(1, srcBuf.length - fadeS * 2);
      var off = Math.floor(Math.random() * maxOff);
      var segLen = srcBuf.length - off;
      var fadeIn = pos === 0 ? 0 : fadeS;         // first segment starts clean
      for (var c2 = 0; c2 < chs; c2++) {
        var srcD = srcBuf.getChannelData(c2);
        var dst = chans[c2];
        var tailStart = segLen - fadeS;
        for (var j = 0; j < segLen && pos + j < workLen; j++) {
          var gain = 1;
          if (j < fadeIn) gain = rise[(j / fadeIn * (N - 1)) | 0];
          if (j >= tailStart) gain *= fall[((j - tailStart) / fadeS * (N - 1)) | 0];
          dst[pos + j] += srcD[off + j] * gain;
        }
      }
      pos += segLen - fadeS;
    }
    // Bake the wrap seam so plain loop=true is click-free. The two sides are
    // UNCORRELATED (different random segments), so this must be an
    // equal-power blend — linear halves would dip −3dB right on the seam.
    var out;
    try {
      out = actx.createBuffer(chs, total, sr);
      for (var c3 = 0; c3 < chs; c3++) {
        var dst2 = out.getChannelData(c3), w = chans[c3];
        for (var j2 = 0; j2 < fadeS; j2++) {
          var ang = Math.PI / 2 * (j2 / fadeS);
          dst2[j2] = w[total + j2] * Math.cos(ang) + w[j2] * Math.sin(ang);
        }
        for (var j3 = fadeS; j3 < total; j3++) dst2[j3] = w[j3];
      }
    } catch (e) { return srcBuf; }               // OOM etc. — better short than silent
    compositeCache.set(key, out);
    diagComposites++;
    return out;
  }

  function ensureRealLength(buffer) {
    if (!buffer || buffer.duration >= MIN_REAL_SEC) return buffer;
    try { return makeCompositeLoop(buffer, MIN_REAL_SEC); } catch (e) { return buffer; }
  }

  function startRealLoop(buffer, out, stopFns) {
    if (!EQ_IN) { EQ_IN = eqCurve(true); EQ_OUT = eqCurve(false); }
    var dur = buffer.duration;
    var fade = Math.max(0.8, Math.min(3.0, dur * 0.12));
    if (dur < 2 * fade + 0.5) fade = dur / 4;

    var busOut = track(actx.createGain());   // stable blend node for Rain's dual-layer
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
        // Exponential dark⇢airy that reaches FULLY OPEN by 85% travel — the
        // old linear 700Hz..12.7kHz left every mid setting muffled, which is
        // why the knob "never felt right". Top of range = transparent.
        var f = 1500 * Math.pow(19 / 1.5, Math.min(1, d / 0.85));
        tone.frequency.setTargetAtTime(Math.min(19000, f), actx.currentTime, 0.1);
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
        if (def.real) buffers = buffers.map(ensureRealLength); // expand short recordings
        stopNodes();
        var r = startCurrent(def, buffers);
        currentStop = r.stop;
        live = r.live;
        applyMix();
        setMaster(0.0001, 0);          // breathe in from silence…
        setMaster(targetGain(), FADE_IN_SECS);             // …to full over ~1.4s
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
    var c = ctx();
    if (!c) { setStatus('⚠️ Audio engine refused to start — reload and try again.'); return; }
    if (prefs.playing) return;
    prefs.playing = true; save();
    loadAndPlay();
  }

  function pause() {
    if (actx && masterGain) setMaster(0.0001, FADE_OUT_SECS);
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(function () { fadeTimer = null; stopNodes(); }, FADE_OUT_SECS * 1000 + 80);
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
    var floor = Math.max(0.0001, targetGain() * 0.22);
    setMaster(floor, 0.09);
    setTimeout(function () {
      if (token !== duckToken || !prefs.playing) return;   // superseded/paused
      setMaster(targetGain(), 0.7);
    }, DUCK_HOLD_MS);
  }

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
        // Double-click snaps the knob back to its default — quick "undo my
        // fiddling" without hunting for a neutral position.
        el.addEventListener('dblclick', function () {
          prefs[pair[1]] = KNOB_DEFAULTS[pair[1]];
          el.value = prefs[pair[1]];
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
    _buildTestLoop: function (src) {
      return getBuffer(src).then(function (b) { return ensureRealLength(b); });
    }
  };
})();
