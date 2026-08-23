/* ============================================================================
   grove-islands.js - v2 "Skyborne Groves". Full from-scratch rebuild.
   Drop-in replacement preserving every v1 contract:
     - Storage: jeemax_grove_v1 {activeBiome, activeSpecies, subjectSpecies,
       daily}, jeemax_forest_daily_v1 {'YYYY-MM-DD':{physics,chemistry,maths}},
       IndexedDB mirror via window._idbMirror (survives localStorage wipes).
     - Growth: 3 solves = 1 tree (Sapling/Young/Mature), golden-angle slot
       spiral, island radius grows with sqrt(slots), MIN 6 -> MAX 240 slots.
     - 5 biomes gated by global ELO (0/1300/1600/1900/2200), 10 species,
       per-subject planting with locked fallback.
     - Store / Archipelago map / Full explorer overlays, travel fade, unlock
       toasts, WebAudio cues, HUD progress toward next unlock.
     - window.__groveIslands {travel,openStore,openMap,openFull,closeFull,
       state,elo,trees,view} and window.__groveCard {card,host}.
   Where v2 is far better:
     - Offline-first engine: vendored vendor/three/three.module.min.js loads
       locally; CDNs are only a fallback (v1 was CDN-or-nothing).
     - Instanced tree field: every tree of a species draws in ONE call
       (v1 spawned ~6 meshes per tree; 240 trees meant ~1.5k draw calls).
       GPU wind sway, zero per-tree CPU animation cost.
     - Living sky: sun disc + halo, procedural starfield, wall-clock day/night
       cycle, drifting clouds, fireflies, circling birds. Preallocated.
     - Animated water: gentle swell + shimmer + living foam ring (auto-frozen
       under reduced motion / low performance tier).
     - Planting ceremony: drop-in bounce, dirt puff, expanding shockring.
     - Adaptive resolution governor; render loop truly CANCELS rAF when idle
       (v1 woke every frame to do nothing).
     - Fixes vs v1: springs pruned on removal; Reset Grove clears the IndexedDB
       mirror too; midnight rollover cannot seed yesterday into today; opening
       the explorer never spawns the camera inside the island; firstRun is
       detected after the IDB restore; ledger aggregation memoized; HUD
       writes only on change.
     - Honors html.fx-effects-off and prefers-reduced-motion everywhere;
       graceful static fallback poster when WebGL/engine unavailable.
   ========================================================================= */
(function () {
'use strict';
if (window.__groveIslandsInit) return; window.__groveIslandsInit = true;

var LS_GROVE = 'jeemax_grove_v1';
var LS_DAILY = 'jeemax_forest_daily_v1';

var MIN_SLOTS = 6;
var MAX_SLOTS = 240;
var MIN_TREE_SPACING = 2.6;
var SLOT_BASE = 2.2;
var STAGE_SCALE = [0.45, 0.72, 1.0];
var STAGES_PER_TREE = 3;
var ISLAND_R = 9;
var TOP_Y = 2.4;
var SEA_Y = 0;
var PERIOD_LABELS = { today: 'Today', yesterday: 'Yesterday', week: 'Last 7 days', month: 'Last 30 days', year: 'Last 365 days', all: 'All time' };

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function mulberry32(seed) {
  var t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    var r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { var h = 2166136261; s = String(s || ''); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function _giYmd(d) { var n = d.getMonth() + 1, day = d.getDate(); return d.getFullYear() + '-' + (n < 10 ? '0' + n : n) + '-' + (day < 10 ? '0' + day : day); }
function todayKey() { return _giYmd(new Date()); }
function dayOffsetKey(n) { var d = new Date(); d.setDate(d.getDate() - n); return _giYmd(d); }
function normSub(s) { s = (s || '').toString().toLowerCase().trim(); return (s === 'math' || s === 'mathematics') ? 'maths' : s; }
function easeOutBack(x) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
function hex(n) { return '#' + n.toString(16).padStart(6, '0'); }
function motionOK() {
  try {
    return !document.documentElement.classList.contains('fx-effects-off') &&
      !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { return true; }
}
function el(tag, a) {
  var n = document.createElement(tag);
  if (a) for (var k in a) {
    if (k === 'html') n.innerHTML = a[k];
    else if (k === 'class') n.className = a[k];
    else n.setAttribute(k, a[k]);
  }
  return n;
}

/* ---- toasts ------------------------------------------------------------ */
var toastWrap = null;
function toast(msg, actionLabel, onAction) {
  try {
    if (!toastWrap) toastWrap = document.getElementById('gi-toasts');
    if (!toastWrap) return;
    while (toastWrap.children.length >= 3) toastWrap.removeChild(toastWrap.firstChild);
    var t = el('div', { class: 'gi-toast' });
    t.appendChild(el('span', { class: 'gi-toast-msg', html: msg }));
    var kill = function () { if (!t.parentNode) return; t.classList.add('gi-toast-out'); setTimeout(function () { t.remove(); }, 520); };
    if (actionLabel) {
      var btn = el('button', { class: 'gi-toast-btn' });
      btn.textContent = actionLabel;
      btn.addEventListener('click', function () { try { onAction(); } catch (e) {} kill(); });
      t.appendChild(btn);
    }
    toastWrap.appendChild(t);
    setTimeout(kill, 6200);
  } catch (e) {}
}
function warn(m) { console.warn('[grove-islands]', m); try { toast('&#9888; ' + m); } catch (e) {} }

/* ---- biomes: identical ids / thresholds / names / mapPos as v1 ---------- */
var BIOMES = [
  { id: 'temperate', name: 'Temperate Forest', icon: '🌲', unlockElo: 0,
    mapPos: { x: 150, y: 252, r: 42 },
    sky: { top: 0x74b9e4, horizon: 0xe6f4ea }, fog: 0xdcefe6,
    water: { deep: 0x2c7da6, shallow: 0x7fd4c4 },
    ground: 0x6fbf73, groundVar: 0x5aa862, sand: 0xe8dfb8, rock: 0x6d5a4a,
    foliage: [0x3e8e5a, 0x57a86b, 0x2f6b4f], trunk: 0x7a5230,
    species: ['pine', 'oak'],
    props: [
      { type: 'rock', count: 8, colors: [0x8a8f94, 0x777d82] },
      { type: 'bush', count: 12, colors: [0x3e8e5a, 0x4f9e66] },
      { type: 'grass', count: 26, colors: [0x5aa862, 0x6fbf73] },
      { type: 'flower', count: 12, colors: [0xffd166, 0xef767a] },
      { type: 'mushroom', count: 7, colors: [0xe25b4a] }
    ],
    animal: { type: 'rabbit' },
    particles: { mode: 'rise', tex: 'glow', colors: [0xffe9a0, 0xfff6d8], count: 110, size: 0.16, speed: 0.3, sway: 0.5 },
    light: { sunPos: [18, 26, 12], sunColor: 0xfff4d6, sunInt: 1.9, hemiSky: 0xcfe8ff, hemiGround: 0x5d8f68, hemiInt: 1.05 },
    blurb: 'Home island · pines & oaks' },
  { id: 'tropical', name: 'Tropical Island', icon: '🌴', unlockElo: 1300,
    mapPos: { x: 315, y: 352, r: 40 },
    sky: { top: 0x57c7e3, horizon: 0xfff3c9 }, fog: 0xeaf7ee,
    water: { deep: 0x0f9fb4, shallow: 0x7fe7dd },
    ground: 0x8cd97c, groundVar: 0x72c465, sand: 0xf7e9c0, rock: 0x7c6a55,
    foliage: [0x2e9e5b, 0x37b877, 0x1f7a4d], trunk: 0x9c7a4a,
    species: ['palm', 'broadleaf'],
    props: [
      { type: 'rock', count: 7, colors: [0x9b8b74, 0x8a7a64] },
      { type: 'bush', count: 10, colors: [0x2e9e5b, 0x37b877] },
      { type: 'flower', count: 16, colors: [0xff8fab, 0xffd166, 0xff6f61] },
      { type: 'grass', count: 18, colors: [0x37b877, 0x54c98a] }
    ],
    animal: { type: 'parrot' },
    particles: { mode: 'fall', tex: 'petal', colors: [0xff9eb5, 0xffc7d6, 0xffb3c6], count: 130, size: 0.22, speed: 0.55, sway: 0.9 },
    light: { sunPos: [16, 28, 10], sunColor: 0xfff8e0, sunInt: 2.0, hemiSky: 0xbdeffb, hemiGround: 0x4f9e66, hemiInt: 1.1 },
    blurb: 'Palms & turquoise lagoons' },
  { id: 'autumn', name: 'Autumn Forest', icon: '🍁', unlockElo: 1600,
    mapPos: { x: 352, y: 128, r: 40 },
    sky: { top: 0xf0a94f, horizon: 0xfde8c8 }, fog: 0xf7e2c2,
    water: { deep: 0x3e6e8e, shallow: 0x8fb8c6 },
    ground: 0xc98a4b, groundVar: 0xb5763c, sand: 0xe6d2a8, rock: 0x6e5a48,
    foliage: [0xe2572b, 0xf2a33c, 0xc6452a], trunk: 0x6e4a30,
    species: ['maple', 'birch'],
    props: [
      { type: 'rock', count: 8, colors: [0x8a7a68, 0x75655a] },
      { type: 'bush', count: 11, colors: [0xc6452a, 0xe2872b] },
      { type: 'mushroom', count: 9, colors: [0xc6452a, 0xb03a26] },
      { type: 'grass', count: 20, colors: [0xd9a24a, 0xc98a4b] }
    ],
    animal: { type: 'hedgehog' },
    particles: { mode: 'fall', tex: 'leaf', colors: [0xe2572b, 0xf2a33c, 0xc6452a, 0xe8c547], count: 160, size: 0.26, speed: 0.85, sway: 1.3 },
    light: { sunPos: [22, 18, -14], sunColor: 0xffd9a0, sunInt: 1.9, hemiSky: 0xffe3b8, hemiGround: 0x8f5a34, hemiInt: 1.0 },
    blurb: 'Maples in golden fire' },
  { id: 'snow', name: 'Snowy Tundra', icon: '❄️', unlockElo: 1900,
    mapPos: { x: 520, y: 268, r: 40 },
    sky: { top: 0x9fd0e8, horizon: 0xf6fbff }, fog: 0xeaf4fa,
    water: { deep: 0x3f6f8e, shallow: 0xb8e4ea },
    ground: 0xf2f8fb, groundVar: 0xe2eef5, sand: 0xddeef4, rock: 0x7f8fa0,
    foliage: [0x3b6b5a, 0x2f5a4b], trunk: 0x6b4a36,
    species: ['snowpine', 'icebirch'],
    props: [
      { type: 'rock', count: 8, colors: [0xa8c4d4, 0x93b2c4] },
      { type: 'snowmound', count: 12, colors: [0xffffff, 0xeef7fb] },
      { type: 'bush', count: 6, colors: [0xd7e9ef, 0xc4dde6] }
    ],
    animal: { type: 'penguin' },
    particles: { mode: 'fall', tex: 'soft', colors: [0xffffff, 0xeaf6ff], count: 260, size: 0.15, speed: 0.95, sway: 0.5 },
    light: { sunPos: [-14, 24, 10], sunColor: 0xf4f9ff, sunInt: 1.8, hemiSky: 0xdff1fb, hemiGround: 0x9db8c8, hemiInt: 1.15 },
    blurb: 'Hushed pines under snowfall' },
  { id: 'savanna', name: 'Golden Savanna', icon: '🦒', unlockElo: 2200,
    mapPos: { x: 128, y: 92, r: 42 },
    sky: { top: 0xff9e5e, horizon: 0xffe6b8 }, fog: 0xf9dcae,
    water: { deep: 0x2f7e8c, shallow: 0xa5d6c0 },
    ground: 0xd9b36c, groundVar: 0xc7a058, sand: 0xead9a6, rock: 0x8a6a4a,
    foliage: [0x6e8f4e, 0x7fa05a], trunk: 0x8a5a3b,
    species: ['baobab', 'acacia'],
    props: [
      { type: 'rock', count: 8, colors: [0x9c7a54, 0x876544] },
      { type: 'grass', count: 60, colors: [0xd9b36c, 0xc7a058, 0xe0c17e] },
      { type: 'bush', count: 7, colors: [0x9a8f4a, 0x8a7f42] }
    ],
    animal: { type: 'meerkat' },
    particles: { mode: 'drift', tex: 'soft', colors: [0xe8c98a, 0xd9b36c], count: 110, size: 0.15, speed: 0.7, sway: 0.4 },
    light: { sunPos: [28, 8, 10], sunColor: 0xffb066, sunInt: 2.3, hemiSky: 0xffd9a8, hemiGround: 0x8f6a3a, hemiInt: 0.85 },
    blurb: 'Baobabs & endless gold' }
];

var SPECIES_DEFS = [
  { id: 'pine', icon: '🌲', name: 'Pine', unlockElo: 0, palette: { foliage: [0x3e8e5a, 0x57a86b, 0x2f6b4f], trunk: 0x7a5230 } },
  { id: 'oak', icon: '🌳', name: 'Oak', unlockElo: 0, palette: { foliage: [0x3e8e5a, 0x57a86b, 0x2f6b4f], trunk: 0x7a5230 } },
  { id: 'palm', icon: '🌴', name: 'Palm', unlockElo: 1300, palette: { foliage: [0x2e9e5b, 0x37b877, 0x1f7a4d], trunk: 0x9c7a4a } },
  { id: 'broadleaf', icon: '🌿', name: 'Broadleaf', unlockElo: 1300, palette: { foliage: [0x2e9e5b, 0x37b877, 0x1f7a4d], trunk: 0x9c7a4a } },
  { id: 'maple', icon: '🍁', name: 'Maple', unlockElo: 1600, palette: { foliage: [0xe2572b, 0xf2a33c, 0xc6452a], trunk: 0x6e4a30 } },
  { id: 'birch', icon: '🪵', name: 'Birch', unlockElo: 1600, palette: { foliage: [0xe8c547, 0xd9a93c], trunk: 0x4a4038 } },
  { id: 'snowpine', icon: '🎄', name: 'Snow Pine', unlockElo: 1900, palette: { foliage: [0x3b6b5a, 0x2f5a4b], trunk: 0x6b4a36 } },
  { id: 'icebirch', icon: '❄️', name: 'Ice Birch', unlockElo: 1900, palette: { foliage: [0xcde9ec, 0xbcdde2], trunk: 0x4a4038 } },
  { id: 'baobab', icon: '🪴', name: 'Baobab', unlockElo: 2200, palette: { foliage: [0x6e8f4e, 0x7fa05a], trunk: 0x8a5a3b } },
  { id: 'acacia', icon: '⛱️', name: 'Acacia', unlockElo: 2200, palette: { foliage: [0x6e8f4e, 0x7fa05a], trunk: 0x8a5a3b } }
];

function biomeById(id) { for (var i = 0; i < BIOMES.length; i++) if (BIOMES[i].id === id) return BIOMES[i]; return BIOMES[0]; }
function speciesById(id) { for (var i = 0; i < SPECIES_DEFS.length; i++) if (SPECIES_DEFS[i].id === id) return SPECIES_DEFS[i]; return SPECIES_DEFS[0]; }

var SUBJECTS = ['physics', 'chemistry', 'maths'];
var SUBJECT_SPECIES_DEFAULT = { physics: 'pine', chemistry: 'oak', maths: 'pine' };

/* ---- grove state + permanent IndexedDB mirror --------------------------- */
var grove;
var groveRev = 0;
var periodMemo = {};
function defaultGrove() { return { activeBiome: 'temperate', activeSpecies: 'pine', subjectSpecies: Object.assign({}, SUBJECT_SPECIES_DEFAULT), daily: {} }; }
function loadGrove() {
  try {
    var o = JSON.parse(localStorage.getItem(LS_GROVE) || 'null');
    if (o && typeof o === 'object') {
      o.activeBiome = biomeById(o.activeBiome).id;
      o.activeSpecies = speciesById(o.activeSpecies).id;
      var ss = Object.assign({}, SUBJECT_SPECIES_DEFAULT, (o.subjectSpecies && typeof o.subjectSpecies === 'object') ? o.subjectSpecies : {});
      for (var s = 0; s < SUBJECTS.length; s++) ss[SUBJECTS[s]] = speciesById(ss[SUBJECTS[s]]).id;
      o.subjectSpecies = ss;
      o.daily = (o.daily && typeof o.daily === 'object') ? o.daily : {};
      return o;
    }
  } catch (e) {}
  return defaultGrove();
}
function saveGrove() {
  groveRev++;
  periodMemo = {};
  try { localStorage.setItem(LS_GROVE, JSON.stringify(grove)); } catch (e) {}
  try { if (window._idbMirror) window._idbMirror.set(LS_GROVE, grove); } catch (e) {}
}
grove = loadGrove();

function subjectSpecies(subj) {
  subj = normSub(subj);
  if (SUBJECTS.indexOf(subj) < 0) subj = 'physics';
  var id = (grove.subjectSpecies && grove.subjectSpecies[subj]) || SUBJECT_SPECIES_DEFAULT[subj];
  var sp = speciesById(id);
  if (!speciesUnlocked(sp.id)) {
    for (var i = 0; i < SPECIES_DEFS.length; i++) {
      if (speciesUnlocked(SPECIES_DEFS[i].id)) { sp = SPECIES_DEFS[i]; break; }
    }
  }
  return sp.id;
}
function globalElo() {
  try {
    var a = window.AppState;
    if (a && a.elo && typeof a.elo.global === 'number' && isFinite(a.elo.global)) return Math.max(0, Math.floor(a.elo.global));
  } catch (e) {}
  return 1200;
}
function biomeUnlocked(id, elo) { return (elo == null ? globalElo() : elo) >= biomeById(id).unlockElo; }
function speciesUnlocked(id, elo) { return (elo == null ? globalElo() : elo) >= speciesById(id).unlockElo; }

/* ---- audio --------------------------------------------------------------- */
var AC = null;
function audio() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } return AC; }
function tone(freq, dur, type, gain, delay) {
  try {
    var ac = audio(); if (!ac) return;
    var t0 = ac.currentTime + (delay || 0);
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.05, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } catch (e) {}
}
var sndPlant = function () { tone(392, 0.09, 'sine', 0.045); tone(587.33, 0.14, 'sine', 0.04, 0.07); };
var sndUnlock = function () { [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { tone(f, 0.22, 'sine', 0.06, i * 0.09); }); };
var sndTravel = function () { tone(330, 0.16, 'sine', 0.04); tone(494, 0.2, 'sine', 0.04, 0.1); tone(659, 0.24, 'triangle', 0.03, 0.2); };
window.addEventListener('pointerdown', function () { var ac = audio(); if (ac && ac.state === 'suspended') ac.resume(); }, { passive: true });

/* ---- engine loader: local vendored build FIRST, CDN chain as fallback ---- */
var THREE = null, threePromise = null;
function importWithTimeout(url, ms) {
  return new Promise(function (res, rej) {
    var done = false;
    var to = setTimeout(function () { if (!done) { done = true; rej(new Error('engine timeout: ' + url)); } }, ms || 9000);
    import(url).then(function (m) { if (!done) { done = true; clearTimeout(to); res(m); } })
      .catch(function (e) { if (!done) { done = true; clearTimeout(to); rej(e); } });
  });
}
function ensureThree() {
  if (THREE) return Promise.resolve(THREE);
  if (threePromise && threePromise.__failed) threePromise = null;
  if (threePromise) return threePromise;
  /* './' resolves against this script's URL (repo root): the vendored build
     ships with the app, so offline/PWA boots never touch the network. */
  var urls = ['./vendor/three/three.module.min.js',
    'https://esm.sh/three@0.160.0',
    'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js',
    'https://unpkg.com/three@0.160.0/build/three.module.min.js'];
  threePromise = (function tryOne(i) {
    if (i >= urls.length) {
      var er = Promise.reject(new Error('all engines failed (vendored + CDNs)'));
      er.__failed = true; return er;
    }
    return importWithTimeout(urls[i], i === 0 ? 4000 : 9000)
      .then(function (m) { THREE = m; return m; })
      .catch(function () { return tryOne(i + 1); });
  })(0);
  return threePromise;
}

/* ---- scene singletons ---------------------------------------------------- */
var scene = null, miniRenderer = null, fullRenderer = null, miniCam = null, fullCam = null;
var waterMesh = null;
var skyMat = null, waterMat = null, sun = null, hemi = null, ambientL = null, moonFill = null;
var world = null, built = false, engineFailed = false, failToastShown = false;
var clock = null, raf = null;
var miniVisible = false, fullOpen = false;
var fullOrbit = null;
var worldPeriod = 'today';
var fullPeriod = 'all';
var lastTODPoll = -1e12;

/* ---- wall-clock day/night (same driver concept as the wallpaper) --------- */
function nightFactor01() {
  if (!motionOK()) return 0;
  var d = new Date();
  var u = (d.getHours() + d.getMinutes() / 60) / 24;
  return clamp(Math.abs(u - 0.5) * 2, 0, 1);
}
var curNight = 0;
var DSKY = { top: 0x0b1026, horizon: 0x1a2340, fog: 0x10162a };

function applyEnvironment(biome) {
  if (!skyMat || !waterMat) return;
  var night = nightFactor01();
  curNight = night;
  function mix(a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), t); }
  var k = night * 0.78;
  skyMat.uniforms.uTop.value.copy(mix(biome.sky.top, DSKY.top, k));
  skyMat.uniforms.uHorizon.value.copy(mix(biome.sky.horizon, DSKY.horizon, k));
  skyMat.uniforms.uNight.value = night;
  var hrs = new Date().getHours() + new Date().getMinutes() / 60;
  var az = (hrs / 24) * Math.PI * 2 - Math.PI * 0.5;
  skyMat.uniforms.uSunDir.value.set(Math.cos(az), 0.42, Math.sin(az)).normalize();
  scene.fog.color.copy(mix(biome.fog, DSKY.fog, k));
  waterMat.color.copy(mix(new THREE.Color(biome.water.deep).lerp(new THREE.Color(biome.water.shallow), 0.35), new THREE.Color(DSKY.fog), k * 0.85));
  var L = biome.light;
  sun.position.set(L.sunPos[0], L.sunPos[1], L.sunPos[2]);
  sun.color.copy(mix(L.sunColor, 0x8ea2ff, night));
  sun.intensity = L.sunInt * (0.12 + 0.88 * (1 - night));
  hemi.color.copy(mix(L.hemiSky, 0x24304d, night));
  hemi.groundColor.setHex(L.hemiGround);
  hemi.intensity = L.hemiInt * (1 - night * 0.45);
  ambientL.intensity = 0.13 + night * 0.09;
  moonFill.intensity = night * 0.5;
  if (world && world.cloudMats) for (var i = 0; i < world.cloudMats.length; i++) world.cloudMats[i].opacity = 0.85 - night * 0.5;
  if (world && world.ffMat) world.ffMat.opacity = night * 0.95;
}

/* ==========================================================================
   GEOMETRY KIT - merged, vertex-colored, low-poly. One draw call per species.
   -------------------------------------------------------------------------- */
var GEO = {}, MAT = {};
function cGeo(key, make) { if (!GEO[key]) GEO[key] = make(); return GEO[key]; }
function prep(g) { return g.index ? g.toNonIndexed() : g; }
function mergeGeos(list) {
  list = list.map(prep);
  var n = 0, i;
  for (i = 0; i < list.length; i++) n += list[i].attributes.position.count;
  var pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), o = 0;
  for (i = 0; i < list.length; i++) {
    var g = list[i], c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += c;
    g.dispose();
  }
  var out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
var _tmpC = null;
function paint(g, hexv, jitter) {
  g = prep(g);
  g.deleteAttribute('uv');
  if (!_tmpC) _tmpC = new THREE.Color();
  _tmpC.setHex(hexv);
  var n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (var i = 0; i < n; i++) {
    var j = (jitter || 0) * (Math.sin(i * 12.9898) * 43758.5453 % 1);
    arr[i * 3] = clamp(_tmpC.r + j, 0, 1);
    arr[i * 3 + 1] = clamp(_tmpC.g + j, 0, 1);
    arr[i * 3 + 2] = clamp(_tmpC.b + j, 0, 1);
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
function part(list, geo, hexv, x, y, z, rx, ry, rz, sx, sy, sz, jitter) {
  geo = paint(geo, hexv, jitter);
  geo.rotateX(rx || 0); geo.rotateY(ry || 0); geo.rotateZ(rz || 0);
  geo.scale(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
  geo.translate(x || 0, y || 0, z || 0);
  list.push(geo);
  return list;
}
function jitterF(seed) { var r = mulberry32(seed); return function () { return (r() - 0.5); }; }

/* ---- the ten species (origin at trunk base, ~3 units tall at scale 1) ---- */
var SPECIES_BUILDERS = {
  pine: function (fol, trk, jf) {
    var L = [];
    part(L, new THREE.CylinderGeometry(0.16, 0.26, 1.1, 5), trk, 0, 0.55, 0, 0, 0, 0, 1, 1, 1, 0.03);
    part(L, new THREE.ConeGeometry(0.95, 1.25, 7), fol[0], 0, 1.45, 0, 0, jf() * 3, 0, 1, 1, 1, 0.035);
    part(L, new THREE.ConeGeometry(0.72, 1.1, 7), fol[1], 0, 2.15, 0, 0, jf() * 3, 0, 1, 1, 1, 0.035);
    part(L, new THREE.ConeGeometry(0.45, 0.95, 6), fol[0], 0, 2.85, 0, 0, jf() * 3, 0, 1, 1, 1, 0.035);
    return mergeGeos(L);
  },
  snowpine: function (fol, trk, jf) {
    var L = [], snow = 0xf4fafc;
    part(L, new THREE.CylinderGeometry(0.16, 0.26, 1.1, 5), trk, 0, 0.55, 0, 0, 0, 0, 1, 1, 1, 0.03);
    part(L, new THREE.ConeGeometry(0.95, 1.2, 7), fol[0], 0, 1.42, 0, 0, jf() * 3, 0, 1, 1, 1, 0.03);
    part(L, new THREE.ConeGeometry(0.55, 0.5, 7), snow, 0, 1.85, 0, 0, jf() * 3, 0, 1, 1, 1, 0.02);
    part(L, new THREE.ConeGeometry(0.72, 1.05, 7), fol[1], 0, 2.12, 0, 0, jf() * 3, 0, 1, 1, 1, 0.03);
    part(L, new THREE.ConeGeometry(0.4, 0.42, 7), snow, 0, 2.52, 0, 0, jf() * 3, 0, 1, 1, 1, 0.02);
    part(L, new THREE.ConeGeometry(0.45, 0.9, 6), fol[0], 0, 2.8, 0, 0, jf() * 3, 0, 1, 1, 1, 0.03);
    part(L, new THREE.ConeGeometry(0.26, 0.34, 6), snow, 0, 3.12, 0, 0, 0, 0, 1, 1, 1, 0.02);
    return mergeGeos(L);
  },
  oak: function (fol, trk, jf) {
    var L = [];
    part(L, new THREE.CylinderGeometry(0.18, 0.3, 1.15, 5), trk, 0, 0.57, 0, 0, 0, 0, 1, 1, 1, 0.03);
    part(L, new THREE.IcosahedronGeometry(0.85, 0), fol[0], 0, 1.85, 0, jf(), jf() * 3, 0, 1, 0.92, 1, 0.035);
    part(L, new THREE.IcosahedronGeometry(0.62, 0), fol[1], 0.55, 1.55, 0.2, jf(), jf() * 3, 0, 1, 0.9, 1, 0.035);
    part(L, new THREE.IcosahedronGeometry(0.58, 0), fol[1], -0.5, 1.6, -0.15, jf(), jf() * 3, 0, 1, 0.9, 1, 0.035);
    part(L, new THREE.IcosahedronGeometry(0.5, 0), fol[2], 0.05, 2.45, -0.1, jf(), jf() * 3, 0, 1, 0.85, 1, 0.035);
    return mergeGeos(L);
  },
  broadleaf: function (fol, trk, jf) {
    var L = [];
    part(L, new THREE.CylinderGeometry(0.15, 0.24, 0.95, 5), trk, 0, 0.47, 0, 0, 0, 0, 1, 1, 1, 0.03);
    part(L, new THREE.IcosahedronGeometry(1.0, 0), fol[0], 0, 1.6, 0, jf(), jf() * 3, 0, 1.15, 0.72, 1.15, 0.035);
    part(L, new THREE.IcosahedronGeometry(0.55, 0), fol[1], 0.1, 2.1, 0.05, jf(), jf() * 3, 0, 1, 0.8, 1, 0.035);
    return mergeGeos(L);
  },
  palm: function (fol, trk, jf) {
    var L = [], i, bend = 0.16 + jf() * 0.1;
    for (i = 0; i < 4; i++) {
      var yy = 0.35 + i * 0.62;
      part(L, new THREE.CylinderGeometry(0.13 - i * 0.015, 0.17 - i * 0.015, 0.72, 5), trk, bend * (i + 1) * 0.55, yy, 0, 0, 0, -bend * 0.5, 1, 1, 1, 0.025);
    }
    var topX = bend * 2.6, topY = 2.62;
    for (i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2 + jf() * 0.4;
      part(L, new THREE.ConeGeometry(0.16, 1.55, 4), fol[i % 2], topX + Math.cos(a) * 0.62, topY - 0.12, Math.sin(a) * 0.62, 0, -a, 1.25, 1, 1, 0.5, 0.04);
    }
    part(L, new THREE.IcosahedronGeometry(0.2, 0), trk, topX, topY + 0.08, 0, 0, 0, 0, 1, 0.8, 1, 0.02);
    return mergeGeos(L);
  },
  maple: function (fol, trk, jf) {
    var L = [];
    part(L, new THREE.CylinderGeometry(0.16, 0.27, 1.05, 5), trk, 0, 0.52, 0, 0, 0, 0, 1, 1, 1, 0.03);
    part(L, new THREE.IcosahedronGeometry(0.8, 0), fol[0], 0, 1.75, 0, jf(), jf() * 3, 0, 1, 0.95, 1, 0.04);
    part(L, new THREE.IcosahedronGeometry(0.55, 0), fol[1], 0.5, 1.45, 0.25, jf(), jf() * 3, 0, 1, 0.9, 1, 0.04);
    part(L, new THREE.IcosahedronGeometry(0.5, 0), fol[2], -0.45, 1.5, -0.2, jf(), jf() * 3, 0, 1, 0.9, 1, 0.04);
    return mergeGeos(L);
  },
  birch: function (fol, trk, jf) {
    var L = [], bark = 0xe8e4d8;
    part(L, new THREE.CylinderGeometry(0.1, 0.15, 1.7, 5), bark, 0, 0.85, 0, 0, 0, 0, 1, 1, 1, 0.02);
    part(L, new THREE.CylinderGeometry(0.11, 0.11, 0.1, 5), trk, 0, 0.5, 0, 0, 0, 0, 1.05, 1, 1.05, 0.01);
    part(L, new THREE.CylinderGeometry(0.1, 0.1, 0.08, 5), trk, 0, 0.95, 0, 0, 0, 0, 1.05, 1, 1.05, 0.01);
    part(L, new THREE.IcosahedronGeometry(0.6, 0), fol[0], 0, 2.05, 0, jf(), jf() * 3, 0, 1, 1.1, 1, 0.04);
    part(L, new THREE.IcosahedronGeometry(0.42, 0), fol[1], 0.3, 1.7, 0.1, jf(), jf() * 3, 0, 1, 0.9, 1, 0.04);
    part(L, new THREE.IcosahedronGeometry(0.36, 0), fol[0], -0.28, 1.78, -0.08, jf(), jf() * 3, 0, 1, 0.9, 1, 0.04);
    return mergeGeos(L);
  },
  icebirch: function (fol, trk, jf) {
    var L = [], bark = 0xdfe8ea;
    part(L, new THREE.CylinderGeometry(0.1, 0.15, 1.7, 5), bark, 0, 0.85, 0, 0, 0, 0, 1, 1, 1, 0.02);
    part(L, new THREE.IcosahedronGeometry(0.62, 0), fol[0], 0, 2.05, 0, jf(), jf() * 3, 0, 1, 1.15, 1, 0.03);
    part(L, new THREE.IcosahedronGeometry(0.4, 0), fol[1], 0.28, 1.68, 0.12, jf(), jf() * 3, 0, 1, 0.9, 1, 0.03);
    part(L, new THREE.IcosahedronGeometry(0.36, 0), fol[0], -0.26, 1.76, -0.1, jf(), jf() * 3, 0, 1, 0.9, 1, 0.03);
    return mergeGeos(L);
  },
  baobab: function (fol, trk, jf) {
    var L = [];
    part(L, new THREE.CylinderGeometry(0.34, 0.52, 1.5, 7), trk, 0, 0.75, 0, 0, 0, 0, 1, 1, 1, 0.03);
    part(L, new THREE.CylinderGeometry(0.1, 0.2, 0.6, 5), trk, 0.4, 1.6, 0, 0, 0, -0.7, 1, 1, 1, 0.03);
    part(L, new THREE.CylinderGeometry(0.1, 0.2, 0.6, 5), trk, -0.38, 1.62, 0.1, 0, 0, 0.7, 1, 1, 1, 0.03);
    part(L, new THREE.IcosahedronGeometry(0.72, 0), fol[0], 0, 2.05, 0, jf(), jf() * 3, 0, 1.2, 0.6, 1.2, 0.035);
    part(L, new THREE.IcosahedronGeometry(0.4, 0), fol[1], 0.5, 1.85, 0.1, jf(), jf() * 3, 0, 1, 0.6, 1, 0.035);
    part(L, new THREE.IcosahedronGeometry(0.36, 0), fol[1], -0.48, 1.88, -0.05, jf(), jf() * 3, 0, 1, 0.6, 1, 0.035);
    return mergeGeos(L);
  },
  acacia: function (fol, trk, jf) {
    var L = [];
    part(L, new THREE.CylinderGeometry(0.12, 0.22, 1.35, 5), trk, 0, 0.67, 0, 0, 0, 0.12, 1, 1, 1, 0.03);
    part(L, new THREE.CylinderGeometry(0.07, 0.11, 0.7, 5), trk, 0.28, 1.5, 0, 0, 0, -0.55, 1, 1, 1, 0.03);
    part(L, new THREE.IcosahedronGeometry(1.05, 0), fol[0], 0.18, 1.95, 0, jf(), jf() * 3, 0, 1.3, 0.32, 1.3, 0.04);
    part(L, new THREE.IcosahedronGeometry(0.5, 0), fol[1], -0.35, 1.7, 0.15, jf(), jf() * 3, 0, 1.2, 0.3, 1.2, 0.04);
    return mergeGeos(L);
  }
};
function speciesGeometry(speciesId) {
  var key = 'tree_' + speciesId;
  if (GEO[key]) return GEO[key];
  var def = speciesById(speciesId);
  var jf = jitterF(hashStr(speciesId));
  GEO[key] = SPECIES_BUILDERS[speciesId](def.palette.foliage, def.palette.trunk, jf);
  return GEO[key];
}

/* ---- shared tree material with GPU wind sway ----------------------------- */
var treeMatSwayReady = false;
function treeMaterial() {
  if (!MAT.tree) MAT.tree = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  var m = MAT.tree;
  if (!treeMatSwayReady) {
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uTime = { value: 0 };
      sh.vertexShader = 'uniform float uTime;' + String.fromCharCode(10) + sh.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>' + String.fromCharCode(10) +
        'float sw = max(transformed.y - 0.6, 0.0);' + String.fromCharCode(10) +
        'float ph = instanceMatrix[3][0] * 0.7 + instanceMatrix[3][2] * 0.9;' + String.fromCharCode(10) +
        'transformed.x += sin(uTime * 1.35 + ph) * sw * 0.045;' + String.fromCharCode(10) +
        'transformed.z += cos(uTime * 1.02 + ph * 1.3) * sw * 0.035;'
      );
      m.userData.shader = sh;
    };
    treeMatSwayReady = true;
  }
  return m;
}

/* ---- planting FX: dirt puff + shockring (preallocated pools) ------------- */
function createPlantFX(group) {
  var fx = { bursts: [], rings: [] };
  try {
    var N = 36;
    var pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    fx.state = [];
    for (var i = 0; i < N; i++) { fx.state.push({ life: 0, max: 1, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, r: 0, g: 0, b: 0 }); pos[i * 3 + 1] = -999; }
    fx.geo = new THREE.BufferGeometry();
    fx.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    fx.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    fx.mat = new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    fx.pts = new THREE.Points(fx.geo, fx.mat);
    fx.pts.frustumCulled = false;
    group.add(fx.pts);
    fx.cursor = 0; fx.N = N;
  } catch (e) { fx.geo = null; }
  try {
    for (var r = 0; r < 3; r++) {
      var rg = new THREE.RingGeometry(0.9, 1.0, 40);
      rg.rotateX(-Math.PI / 2);
      var rm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
      var mesh = new THREE.Mesh(rg, rm);
      mesh.visible = false;
      group.add(mesh);
      fx.rings.push({ mesh: mesh, mat: rm, t: 1 });
    }
  } catch (e) {}
  fx.dirt = function (x, y, z, hexv) {
    if (!fx.geo) return;
    var c = new THREE.Color(hexv || 0x8a6a48);
    var a = fx.geo.attributes.position.array, cl = fx.geo.attributes.color.array;
    for (var k = 0; k < 12; k++) {
      var idx = fx.cursor; fx.cursor = (fx.cursor + 1) % fx.N;
      var s = fx.state[idx];
      s.life = s.max = 0.5 + Math.random() * 0.35;
      var ang = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.1;
      s.x = x; s.y = y + 0.1; s.z = z;
      s.vx = Math.cos(ang) * sp * 0.6; s.vz = Math.sin(ang) * sp * 0.6; s.vy = 1.4 + Math.random() * 1.4;
      s.r = c.r; s.g = c.g * 0.9; s.b = c.b * 0.8;
    }
  };
  fx.ring = function (x, y, z, hexv) {
    for (var i = 0; i < fx.rings.length; i++) {
      var R = fx.rings[i];
      if (R.t >= 1) {
        R.t = 0; R.mesh.visible = true;
        R.mesh.position.set(x, y + 0.06, z);
        R.mat.color.setHex(hexv || 0xffffff);
        return;
      }
    }
  };
  fx.update = function (dt) {
    if (fx.geo) {
      var a = fx.geo.attributes.position.array, cl = fx.geo.attributes.color.array, any = false;
      for (var i = 0; i < fx.N; i++) {
        var s = fx.state[i];
        if (s.life <= 0) continue;
        any = true;
        s.life -= dt;
        if (s.life <= 0) { a[i * 3 + 1] = -999; cl[i * 3] = cl[i * 3 + 1] = cl[i * 3 + 2] = 0; continue; }
        s.vy -= 4.4 * dt;
        s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
        var f = s.life / s.max;
        a[i * 3] = s.x; a[i * 3 + 1] = s.y; a[i * 3 + 2] = s.z;
        cl[i * 3] = s.r * f; cl[i * 3 + 1] = s.g * f; cl[i * 3 + 2] = s.b * f;
      }
      if (any) { fx.geo.attributes.position.needsUpdate = true; fx.geo.attributes.color.needsUpdate = true; }
    }
    for (var r2 = 0; r2 < fx.rings.length; r2++) {
      var R2 = fx.rings[r2];
      if (R2.t >= 1) continue;
      R2.t = Math.min(1, R2.t + dt / 0.7);
      var e = easeOutCubic(R2.t);
      var sc = 0.6 + e * 4.2;
      R2.mesh.scale.set(sc, 1, sc);
      R2.mat.opacity = 0.65 * (1 - R2.t);
      if (R2.t >= 1) R2.mesh.visible = false;
    }
  };
  return fx;
}

/* ---- instanced tree field ------------------------------------------------ */
function createTreeField(group) {
  var field = {
    group: group, meshes: {}, entries: new Map(), springs: [],
    dummy: null, fx: createPlantFX(group)
  };
  field.dummy = new THREE.Object3D();
  function ensureMesh(speciesId, capacity) {
    var m = field.meshes[speciesId];
    if (m && m.instanceMatrix.count >= capacity) return m;
    if (m) { group.remove(m); m.dispose(); }
    m = new THREE.InstancedMesh(speciesGeometry(speciesId), treeMaterial(), Math.max(8, capacity));
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true; m.receiveShadow = false;
    m.frustumCulled = false;
    group.add(m);
    field.meshes[speciesId] = m;
    return m;
  }
  function writeMatrix(e) {
    var m = field.meshes[e.species];
    if (!m || e.idx >= m.instanceMatrix.count) return;
    var d = field.dummy;
    var dropY = e.drop > 0 ? e.drop * 2.6 : 0;
    var squash = e.drop > 0 ? 1 + e.drop * 0.15 : (e.springVel > 1.5 ? 1 - Math.min(0.12, e.springVel * 0.02) : 1);
    d.position.set(e.x, e.y - 0.1 + dropY, e.z);
    d.rotation.set(0, e.rot, 0);
    d.scale.set(e.scale / squash, e.scale * squash, e.scale / squash);
    d.updateMatrix();
    m.setMatrixAt(e.idx, d.matrix);
    m.instanceMatrix.needsUpdate = true;
  }
  /* want: [{slot,x,y,z,rot,var,species,stage}] - full reconciliation */
  field.sync = function (want, opts) {
    opts = opts || {};
    var keep = new Set(), i, e;
    for (i = 0; i < want.length; i++) keep.add(want[i].slot);
    var dead = [];
    field.entries.forEach(function (ent, slot) { if (!keep.has(slot)) dead.push(slot); });
    for (i = 0; i < dead.length; i++) {
      e = field.entries.get(dead[i]);
      var si = field.springs.indexOf(e);
      if (si >= 0) field.springs.splice(si, 1);      /* v1 leak fix: prune springs */
      field.entries.delete(dead[i]);
    }
    /* re-index per species */
    var counts = {}, order = [];
    for (i = 0; i < want.length; i++) {
      var w = want[i];
      if (!counts[w.species]) { counts[w.species] = 0; order.push(w.species); }
      counts[w.species]++;
    }
    for (var s = 0; s < order.length; s++) ensureMesh(order[s], counts[order[s]]);
    var cursor = {};
    for (i = 0; i < want.length; i++) {
      var wd = want[i];
      var ex = field.entries.get(wd.slot);
      var target = STAGE_SCALE[wd.stage] * wd['var'];
      if (ex && ex.species !== wd.species) {
        var sj = field.springs.indexOf(ex);
        if (sj >= 0) field.springs.splice(sj, 1);
        field.entries.delete(wd.slot);
        ex = null;
      }
      if (!ex) {
        var sp = wd.species;
        var mesh = field.meshes[sp];
        var idx = cursor[sp] || 0;
        /* find a free index (entries just deleted may leave holes) */
        while (idx < mesh.instanceMatrix.count && field.idxOwner(sp, idx)) idx++;
        cursor[sp] = idx + 1;
        e = {
          slot: wd.slot, species: sp, idx: idx,
          x: wd.x, y: wd.y, z: wd.z, rot: wd.rot,
          scale: 0.01, springVel: 0, target: target,
          drop: opts.ceremony && motionOK() ? 1 : 0,
          phase: wd.rot * 3.1, settled: false
        };
        field.entries.set(wd.slot, e);
        field.springs.push(e);
        field.idxMark(sp, idx, e);
        if (opts.ceremony) {
          field.fx.dirt(e.x, e.y, e.z, biomeById(world && world.biomeId).ground);
          field.fx.ring(e.x, e.y, e.z, 0xffffff);
        }
        writeMatrix(e);
      } else {
        if (Math.abs(ex.target - target) > 0.001) { ex.target = target; ex.settled = false; }
        writeMatrix(ex);
      }
    }
    /* hide unused instances of shrunken meshes by zero-scaling */
    Object.keys(field.meshes).forEach(function (sp2) {
      var mm = field.meshes[sp2];
      var used = {};
      field.entries.forEach(function (en) { if (en.species === sp2) used[en.idx] = true; });
      var changed = false;
      var d = field.dummy;
      for (var ii = 0; ii < mm.count; ii++) {
        if (!used[ii]) {
          d.position.set(0, -999, 0); d.rotation.set(0, 0, 0); d.scale.setScalar(0.0001);
          d.updateMatrix(); mm.setMatrixAt(ii, d.matrix); changed = true;
        }
      }
      if (changed) mm.instanceMatrix.needsUpdate = true;
    });
  };
  field.idxOwner = function (sp, idx) {
    var hit = null;
    field.entries.forEach(function (en) { if (en.species === sp && en.idx === idx) hit = en; });
    return hit;
  };
  field.idxMark = function () {};
  field.update = function (dt, t) {
    var d = field.dummy;
    for (var i = 0; i < field.springs.length; i++) {
      var e = field.springs[i];
      var active = false;
      if (!e.settled) {
        e.springVel += (e.target - e.scale) * 40 * dt;
        e.springVel *= Math.exp(-6.5 * dt);
        e.scale = Math.max(0.01, e.scale + e.springVel * dt);
        if (Math.abs(e.target - e.scale) < 0.004 && Math.abs(e.springVel) < 0.02) { e.scale = e.target; e.settled = true; }
        active = true;
      }
      if (e.drop > 0) {
        e.drop = Math.max(0, e.drop - dt / 0.5);
        active = true;
      }
      if (active) writeMatrix(e);
    }
    field.fx.update(dt);
  };
  field.dispose = function () {
    Object.keys(field.meshes).forEach(function (k) { group.remove(field.meshes[k]); field.meshes[k].dispose(); });
    field.meshes = {}; field.entries.clear(); field.springs.length = 0;
  };
  return field;
}

/* ==========================================================================
   TERRAIN - value-noise hills on a wobbled radial disc + carved stream +
   rocky underside so the island reads as a floating chunk of earth.
   -------------------------------------------------------------------------- */
function h2(ix, iz) { var n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453; return n - Math.floor(n); }
function vnoise2(x, z) {
  var xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  var u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  var a = h2(xi, zi), b = h2(xi + 1, zi), c = h2(xi, zi + 1), d = h2(xi + 1, zi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x, z) {
  return (vnoise2(x, z) - 0.5) * 0.9 + (vnoise2(x * 2.3 + 7.7, z * 2.3 - 3.1) - 0.5) * 0.38 + (vnoise2(x * 5.1 - 4.2, z * 5.1 + 9.4) - 0.5) * 0.16;
}
function makeGroundFn(biome, R, seed) {
  var rng = mulberry32(seed ^ 0x9e37);
  var th0 = rng() * Math.PI * 2;
  var wobA = 0.05 + rng() * 0.04, wobB = 0.03 + rng() * 0.03;
  var f1 = 3 + Math.floor(rng() * 2), f2 = 6 + Math.floor(rng() * 3);
  /* stream polyline from mid-island to the coast */
  var spts = [], i, ang = th0;
  var sx = Math.cos(th0) * R * 0.15, sz = Math.sin(th0) * R * 0.15;
  for (i = 0; i <= 10; i++) {
    var rr = R * (0.18 + (i / 10) * 0.92);
    ang += (rng() - 0.5) * 0.55;
    spts.push({ x: Math.cos(ang) * rr, z: Math.sin(ang) * rr });
  }
  function streamDist(x, z) {
    var best = 1e9;
    for (var k = 0; k < spts.length - 1; k++) {
      var ax = spts[k].x, az = spts[k].z, bx = spts[k + 1].x, bz = spts[k + 1].z;
      var abx = bx - ax, abz = bz - az;
      var t = clamp(((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz || 1), 0, 1);
      var dx = x - (ax + abx * t), dz = z - (az + abz * t);
      var dd = dx * dx + dz * dz;
      if (dd < best) best = dd;
    }
    return Math.sqrt(best);
  }
  return {
    pts: spts,
    height: function (x, z) {
      var r = Math.sqrt(x * x + z * z);
      var theta = Math.atan2(z, x);
      var Rw = R * (1 + wobA * Math.sin(theta * f1 + seed % 7) + wobB * Math.sin(theta * f2 + seed % 13));
      var edge = clamp(1 - r / Rw, 0, 1);
      if (edge <= 0.02) return -0.8;
      var dome = Math.pow(edge, 0.72);
      var base = dome * 2.05;
      var detail = fbm(x * 0.14 + seed % 5, z * 0.14) * clamp(dome * 1.6, 0, 1);
      var h = TOP_Y + base + detail - 1.0;
      var sd = streamDist(x, z);
      var carveW = Math.max(0.65, R * 0.075);
      h -= 0.62 * Math.exp(-(sd * sd) / (carveW * carveW)) * clamp((1 - r / Rw) * 3, 0, 1);
      return h;
    },
    coastR: function (theta) {
      return R * (1 + wobA * Math.sin(theta * f1 + seed % 7) + wobB * Math.sin(theta * f2 + seed % 13));
    }
  };
}
function buildIslandMesh(biome, R, seed, gf) {
  var NR = 22, NS = 72;
  var pos = [], col = [], idx = [];
  var cA = null, cB = null, cSand = null, cRock = null;
  cA = new THREE.Color(biome.ground); cB = new THREE.Color(biome.groundVar);
  cSand = new THREE.Color(biome.sand); cRock = new THREE.Color(biome.rock);
  var ringY = [], ringX = [], ringZ = [];
  for (var i = 0; i <= NR; i++) {
    var rr = (i / NR);
    for (var j = 0; j <= NS; j++) {
      var theta = (j / NS) * Math.PI * 2;
      var r = rr * gf.coastR(theta);
      var x = Math.cos(theta) * r, z = Math.sin(theta) * r;
      var y = i === NR ? SEA_Y - 1.35 : gf.height(x, z);
      if (i === NR - 1 && y < SEA_Y + 0.12) y = SEA_Y + 0.12;
      pos.push(x, y, z);
      ringY.push(y); ringX.push(x); ringZ.push(z);
      var slope = 0;
      if (i > 0 && j > 0) {
        var yl = pos[((i) * (NS + 1) + j - 1) * 3 + 1];
        var yb = pos[((i - 1) * (NS + 1) + j) * 3 + 1];
        slope = Math.abs(y - yl) + Math.abs(y - yb);
      }
      var cc = new THREE.Color();
      var n = vnoise2(x * 0.31 + seed % 11, z * 0.31);
      cc.copy(cA).lerp(cB, n);
      if (y < SEA_Y + 0.55) cc.lerp(cSand, clamp((SEA_Y + 0.55 - y) / 0.55, 0, 1));
      else if (slope > 0.34) cc.lerp(cRock, clamp((slope - 0.34) / 0.4, 0, 1));
      var jj = (h2(Math.round(x * 10), Math.round(z * 10)) - 0.5) * 0.06;
      col.push(clamp(cc.r + jj, 0, 1), clamp(cc.g + jj, 0, 1), clamp(cc.b + jj, 0, 1));
    }
  }
  for (i = 0; i < NR; i++) {
    for (j = 0; j < NS; j++) {
      var a = i * (NS + 1) + j, b = a + NS + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  /* winding self-heal: if normals face down, flip triangles and recompute */
  var nySum = 0, na = geo.attributes.normal.array;
  for (var n2 = 1; n2 < na.length; n2 += 3) nySum += na[n2];
  if (nySum < 0) {
    for (var i3 = 0; i3 < idx.length; i3 += 3) { var tt = idx[i3 + 1]; idx[i3 + 1] = idx[i3 + 2]; idx[i3 + 2] = tt; }
    geo.setIndex(idx);
    geo.computeVertexNormals();
  }
  var mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  var mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
function buildUnderside(biome, R, seed, gf) {
  var NS = 48, pos = [], col = [], idx = [];
  var cRock = new THREE.Color(biome.rock);
  var cDirt = new THREE.Color(0x5d4a36);
  var depth = R * 0.62 + 2.2;
  for (var j = 0; j <= NS; j++) {
    var theta = (j / NS) * Math.PI * 2;
    var r = gf.coastR(theta);
    var x = Math.cos(theta) * r, z = Math.sin(theta) * r;
    pos.push(x, SEA_Y - 1.3, z);
    col.push(cDirt.r, cDirt.g, cDirt.b);
    pos.push(x * 0.55, -depth * 0.45, z * 0.55);
    var cc = cRock.clone().lerp(cDirt, 0.5);
    col.push(cc.r, cc.g, cc.b);
  }
  var centerIdx = pos.length / 3;
  pos.push(0, -depth, 0);
  col.push(cRock.r * 0.8, cRock.g * 0.8, cRock.b * 0.8);
  for (j = 0; j < NS; j++) {
    var a = j * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    idx.push(a + 1, centerIdx, a + 3);
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  var mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}
function buildStream(gf, biome) {
  var pts = gf.pts;
  if (!pts || pts.length < 3) return null;
  var pos = [], idx = [];
  var w = 0.42;
  for (var k = 0; k < pts.length; k++) {
    var p = pts[k], q = pts[Math.min(k + 1, pts.length - 1)], p0 = pts[Math.max(k - 1, 0)];
    var dx = q.x - p0.x, dz = q.z - p0.z;
    var len = Math.hypot(dx, dz) || 1;
    var nx = -dz / len, nz = dx / len;
    var y = SEA_Y + 0.1;
    pos.push(p.x + nx * w, y, p.z + nz * w);
    pos.push(p.x - nx * w, y, p.z - nz * w);
  }
  for (k = 0; k < pts.length - 1; k++) {
    var a = k * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  var mat = new THREE.MeshLambertMaterial({ color: biome.water.shallow, transparent: true, opacity: 0.85 });
  return new THREE.Mesh(geo, mat);
}

/* ---- props (instanced, biome-configured; same prop vocabulary as v1) ----- */
function addProps(w, biome, rng, gh, R) {
  var dummy = new THREE.Object3D(), col = new THREE.Color();
  var propGeo = {
    rock: function () { return cGeo('pRock', function () { return new THREE.DodecahedronGeometry(1, 0); }); },
    bush: function () { return cGeo('pBush', function () { var g = new THREE.IcosahedronGeometry(1, 0); g.scale(1, 0.72, 1); return g; }); },
    grass: function () { return cGeo('pGrass', function () { return new THREE.ConeGeometry(0.5, 1, 4); }); },
    snowmound: function () { return cGeo('pMound', function () { var g = new THREE.SphereGeometry(1, 7, 5); g.scale(1, 0.45, 1); return g; }); },
    flower: function () { return cGeo('pFlower', function () { return new THREE.IcosahedronGeometry(1, 0); }); },
    mushroomCap: function () { return cGeo('pShroomCap', function () { return new THREE.SphereGeometry(1, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2); }); },
    mushroomStem: function () { return cGeo('pShroomStem', function () { return new THREE.CylinderGeometry(0.45, 0.6, 1, 5); }); }
  };
  function place(inst, i, sx, sy, sz, x, y, z, ry) {
    dummy.position.set(x, y, z); dummy.rotation.set(0, ry, 0); dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
  }
  for (var pi = 0; pi < biome.props.length; pi++) {
    var cfg = biome.props[pi];
    var geo = cfg.type === 'mushroom' ? propGeo.mushroomCap() : propGeo[cfg.type]();
    var mat = new THREE.MeshLambertMaterial({ flatShading: true });
    w.uniqueGeos.push(mat);
    var inst = new THREE.InstancedMesh(geo, mat, cfg.count);
    inst.castShadow = cfg.type !== 'grass' && cfg.type !== 'flower';
    inst.receiveShadow = true;
    var stemInst = null;
    if (cfg.type === 'mushroom') {
      stemInst = new THREE.InstancedMesh(propGeo.mushroomStem(), new THREE.MeshLambertMaterial({ color: 0xe8dcc8, flatShading: true }), cfg.count);
      stemInst.castShadow = true;
      w.uniqueGeos.push(stemInst.material);
    }
    for (var i = 0; i < cfg.count; i++) {
      var ok = false, x = 0, z = 0, y = 0, tries = 0;
      while (!ok && tries++ < 8) {
        var a = rng() * Math.PI * 2, r = 1.2 + rng() * Math.max(0.5, R * 0.86 - 1.2);
        x = Math.cos(a) * r; z = Math.sin(a) * r;
        y = gh(x, z);
        ok = y > SEA_Y + 0.25;
      }
      if (!ok) continue;
      var sx, sy, sz;
      if (cfg.type === 'rock') { sx = 0.22 + rng() * 0.33; sy = sx * (0.6 + rng() * 0.3); sz = sx * (0.7 + rng() * 0.4); }
      else if (cfg.type === 'bush') { sx = 0.3 + rng() * 0.25; sy = sx * (0.7 + rng() * 0.25); sz = sx; }
      else if (cfg.type === 'grass') { sx = 0.09 + rng() * 0.07; sy = 0.35 + rng() * 0.35; sz = sx; }
      else if (cfg.type === 'snowmound') { sx = 0.5 + rng() * 0.6; sy = sx * (0.4 + rng() * 0.2); sz = sx; }
      else if (cfg.type === 'flower') { sx = sy = sz = 0.07 + rng() * 0.04; }
      else { sx = sy = sz = 0.1 + rng() * 0.07; }
      place(inst, i, sx, sy, sz, x, cfg.type === 'mushroom' ? y + 0.16 : cfg.type === 'grass' ? y + sy * 0.5 : cfg.type === 'flower' ? y + 0.12 : y + sy * 0.4, z, rng() * Math.PI * 2);
      col.setHex(cfg.colors[i % cfg.colors.length]).offsetHSL(0, 0, (rng() - 0.5) * 0.08);
      inst.setColorAt(i, col);
      if (stemInst) place(stemInst, i, sx * 1.4, 0.16, sz * 1.4, x, y + 0.08, z, 0);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    w.group.add(inst); w.instanced.push(inst);
    if (stemInst) { stemInst.instanceMatrix.needsUpdate = true; w.group.add(stemInst); w.instanced.push(stemInst); }
  }
}

/* ---- animals: one resident critter per biome ------------------------------ */
function makeAnimal(type, rng) {
  var g = new THREE.Group();
  function M(hexv, geo) { return new THREE.Mesh(geo || new THREE.IcosahedronGeometry(0.22, 0), new THREE.MeshLambertMaterial({ color: hexv, flatShading: true })); }
  var st = { mode: 0, t: rng() * 6, tx: 0, tz: 0, speed: 0.6 };
  var body, head;
  if (type === 'rabbit' || type === 'hedgehog') {
    body = M(type === 'rabbit' ? 0xb5a08c : 0x8a6a52);
    body.scale.set(1.15, 0.85, 1.5);
    head = M(type === 'rabbit' ? 0xc4b09a : 0x9a785c, new THREE.IcosahedronGeometry(0.17, 0));
    head.position.set(0, 0.14, 0.32);
    g.add(body); g.add(head);
    if (type === 'rabbit') {
      for (var e = 0; e < 2; e++) {
        var ear = M(0xb5a08c, new THREE.ConeGeometry(0.06, 0.34, 4));
        ear.position.set(e ? 0.09 : -0.09, 0.4, 0.28);
        ear.rotation.z = e ? -0.15 : 0.15;
        g.add(ear);
      }
      var tail = M(0xffffff, new THREE.IcosahedronGeometry(0.1, 0));
      tail.position.set(0, 0.1, -0.38);
      g.add(tail);
    }
    st.mode = 'wander';
  } else if (type === 'parrot') {
    body = M(0x22c55e);
    body.scale.set(0.8, 0.8, 1.25);
    head = M(0xff4444, new THREE.IcosahedronGeometry(0.16, 0));
    head.position.set(0, 0.16, 0.24);
    g.add(body); g.add(head);
    st.mode = 'fly';
    st.speed = 1.4;
  } else if (type === 'penguin') {
    body = M(0x22282e, new THREE.ConeGeometry(0.26, 0.62, 6));
    body.position.y = 0.3;
    head = M(0xf4f7f9, new THREE.SphereGeometry(0.15, 6, 5));
    head.position.set(0, 0.66, 0.06);
    g.add(body); g.add(head);
    st.mode = 'waddle';
  } else {
    body = M(0xd9a55a, new THREE.CylinderGeometry(0.12, 0.16, 0.5, 5));
    body.position.y = 0.25;
    head = M(0xe4b46a, new THREE.SphereGeometry(0.13, 6, 5));
    head.position.set(0, 0.56, 0);
    g.add(body); g.add(head);
    st.mode = 'pop';
  }
  g.userData.tick = function (t, dt, slots, motionOKflag) {
    if (!motionOKflag) return;
    st.t -= dt;
    if (st.mode === 'wander') {
      if (st.t <= 0) {
        st.t = 1.4 + rng() * 2.6;
        if (slots.length) {
          var s = slots[Math.floor(rng() * slots.length)];
          st.tx = s.x * 0.5; st.tz = s.z * 0.5;
        }
      }
      var dx = st.tx - g.position.x, dz = st.tz - g.position.z;
      var dd = Math.hypot(dx, dz);
      if (dd > 0.05) {
        var hop = Math.abs(Math.sin(t * 7)) * 0.09;
        g.position.x += (dx / dd) * st.speed * dt;
        g.position.z += (dz / dd) * st.speed * dt;
        g.rotation.y = Math.atan2(dx, dz);
        g.userData.baseY !== undefined && (g.position.y = g.userData.baseY + hop);
      }
    } else if (st.mode === 'fly') {
      if (st.t <= 0 && slots.length) {
        st.t = 2.2 + rng() * 2;
        var s2 = slots[Math.floor(rng() * slots.length)];
        st.tx = s2.x; st.tz = s2.z;
      }
      var dx2 = st.tx - g.position.x, dz2 = st.tz - g.position.z;
      var dd2 = Math.hypot(dx2, dz2);
      if (dd2 > 0.05) {
        var bobF = Math.sin(t * 5.2) * 0.28 + 0.9;
        g.position.x += (dx2 / dd2) * st.speed * dt;
        g.position.z += (dz2 / dd2) * st.speed * dt;
        g.position.y = g.userData.baseY + bobF;
        g.rotation.y = Math.atan2(dx2, dz2);
        g.rotation.z = Math.sin(t * 5.2) * 0.25;
      }
    } else if (st.mode === 'waddle') {
      g.rotation.z = Math.sin(t * 6) * 0.12;
      if (st.t <= 0) { st.t = 3 + rng() * 4; st.tx = (rng() - 0.5) * 2.4; st.tz = (rng() - 0.5) * 2.4; }
      g.position.x += st.tx * dt * 0.3; g.position.z += st.tz * dt * 0.3;
      g.rotation.y = Math.atan2(st.tx, st.tz);
    } else if (st.mode === 'pop') {
      var pop = clamp(Math.sin(t * 0.9 + st.phasePop || 0) * 1.6 + 0.5, 0.05, 1);
      g.scale.y = 0.25 + pop * 0.75;
      g.rotation.y = Math.sin(t * 0.5) * 0.6;
    }
  };
  return g;
}

/* ---- canvas sprite textures ------------------------------------------------ */
function texCanvas(draw) {
  var c = document.createElement('canvas');
  c.width = c.height = 64;
  draw(c.getContext('2d'));
  var t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function getTex(name) {
  if (TEX[name]) return TEX[name];
  var t;
  if (name === 'glow') {
    t = texCanvas(function (g) {
      var r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.4, 'rgba(255,246,214,.7)');
      r.addColorStop(1, 'rgba(255,246,214,0)');
      g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    });
  } else if (name === 'leaf') {
    t = texCanvas(function (g) {
      g.fillStyle = 'rgba(255,255,255,.95)';
      g.beginPath(); g.ellipse(32, 32, 20, 11, 0.7, 0, Math.PI * 2); g.fill();
    });
  } else if (name === 'petal') {
    t = texCanvas(function (g) {
      g.fillStyle = 'rgba(255,255,255,.95)';
      g.beginPath(); g.ellipse(32, 30, 12, 17, 0.5, 0, Math.PI * 2); g.fill();
    });
  } else {
    t = texCanvas(function (g) {
      var r = g.createRadialGradient(32, 32, 0, 32, 32, 30);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.7, 'rgba(255,255,255,.55)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    });
  }
  TEX[name] = t;
  return t;
}
var TEX = {};

/* ---- biome weather particles (rise / fall / drift), fully preallocated ---- */
function ParticleField(cfg, seed, rMax) {
  var N = cfg.count;
  var pos = new Float32Array(N * 3);
  var st = new Array(N);
  var rng = mulberry32(seed);
  var col = new Float32Array(N * 3);
  var c = new THREE.Color();
  for (var i = 0; i < N; i++) {
    var a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * rMax;
    st[i] = {
      x: Math.cos(a) * rr, z: Math.sin(a) * rr,
      y: cfg.mode === 'fall' ? 1 + rng() * 7 : cfg.mode === 'drift' ? 0.6 + rng() * 4 : 0.4 + rng() * 5,
      ph: rng() * Math.PI * 2,
      sp: 0.6 + rng() * 0.8
    };
    pos[i * 3] = st[i].x; pos[i * 3 + 1] = st[i].y; pos[i * 3 + 2] = st[i].z;
    c.setHex(cfg.colors[i % cfg.colors.length]);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  var mat = new THREE.PointsMaterial({
    size: cfg.size, map: getTex(cfg.tex), vertexColors: true,
    transparent: true, opacity: 0.85, depthWrite: false
  });
  var points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  function update(dt, t) {
    var arr = geo.attributes.position.array;
    for (var i2 = 0; i2 < N; i2++) {
      var s = st[i2];
      if (cfg.mode === 'fall') {
        s.y -= dt * (0.55 * cfg.speed) * s.sp;
        s.x += Math.sin(t * 0.9 * cfg.sway + s.ph) * dt * 0.55 * cfg.sway;
        if (s.y < 0.15) { s.y = 6.5 + rng01(s.ph) * 1.5; }
      } else if (cfg.mode === 'rise') {
        s.y += dt * (0.35 * cfg.speed) * s.sp;
        s.x += Math.sin(t * 0.7 + s.ph) * dt * 0.3;
        if (s.y > 7) { s.y = 0.2; }
      } else {
        s.x += Math.cos(t * 0.22 * cfg.sway + s.ph) * dt * 0.45 * cfg.speed;
        s.z += Math.sin(t * 0.19 * cfg.sway + s.ph) * dt * 0.45 * cfg.speed;
        s.y += Math.sin(t * 0.5 + s.ph) * dt * 0.08;
        if (s.x > rMax * 1.25) s.x = -rMax * 1.25;
        if (s.z > rMax * 1.25) s.z = -rMax * 1.25;
        if (s.x < -rMax * 1.25) s.x = rMax * 1.25;
        if (s.z < -rMax * 1.25) s.z = rMax * 1.25;
      }
      arr[i2 * 3] = s.x; arr[i2 * 3 + 1] = s.y; arr[i2 * 3 + 2] = s.z;
    }
    geo.attributes.position.needsUpdate = true;
  }
  function rng01(seedv) { var x = Math.sin(seedv * 999.7) * 10000; return x - Math.floor(x); }
  return { points: points, update: update, dispose: function () { geo.dispose(); mat.dispose(); } };
}

/* ---- clouds: soft billboard banks drifting overhead ------------------------ */
function addClouds(w, R, rng) {
  w.clouds = []; w.cloudMats = [];
  var n = 6 + Math.floor(rng() * 3);
  for (var i = 0; i < n; i++) {
    var mat = new THREE.SpriteMaterial({ map: getTex('soft'), color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    var cluster = new THREE.Group();
    var puffs = 3 + Math.floor(rng() * 3);
    for (var p = 0; p < puffs; p++) {
      var sp = new THREE.Sprite(mat);
      var sc = 1.6 + rng() * 2.4;
      sp.scale.set(sc * 1.6, sc * 0.75, 1);
      sp.position.set((rng() - 0.5) * sc * 2.2, (rng() - 0.5) * sc * 0.4, (rng() - 0.5) * sc * 1.2);
      cluster.add(sp);
    }
    var az = rng() * Math.PI * 2, rad = R * (1.25 + rng() * 0.65);
    cluster.userData = { az: az, rad: rad, h: 9 + rng() * 5, speed: 0.008 + rng() * 0.012 };
    w.group.add(cluster);
    w.clouds.push(cluster);
    w.cloudMats.push(mat);
  }
}
function updateClouds(w, dt) {
  for (var i = 0; i < w.clouds.length; i++) {
    var cl = w.clouds[i], u = cl.userData;
    u.az += u.speed * dt;
    cl.position.set(Math.cos(u.az) * u.rad, u.h, Math.sin(u.az) * u.rad);
  }
}

/* ---- birds: three flapping circlers ---------------------------------------- */
function addBirds(w, R, rng) {
  if (!motionOK()) return;
  w.birds = [];
  var n = 3;
  for (var i = 0; i < n; i++) {
    var bird = new THREE.Group();
    var bmat = new THREE.MeshBasicMaterial({ color: 0x2c3540 });
    var bodyGeo = cGeo('birdBody', function () {
      var g = new THREE.ConeGeometry(0.06, 0.34, 4); g.rotateX(Math.PI / 2); return g;
    });
    bird.add(new THREE.Mesh(bodyGeo, bmat));
    var wingGeoL = cGeo('birdWing', function () {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.42, 0, -0.1, 0.42, 0, 0.14], 3));
      g.computeVertexNormals();
      return g;
    });
    var wl = new THREE.Mesh(wingGeoL, bmat);
    var wr = new THREE.Mesh(wingGeoL, bmat);
    wr.scale.x = -1;
    bird.add(wl); bird.add(wr);
    bird.userData = {
      az: rng() * Math.PI * 2, rad: R * (1.15 + rng() * 0.5),
      h: TOP_Y + 4.5 + rng() * 3.5, speed: 0.14 + rng() * 0.1,
      wl: wl, wr: wr, ph: rng() * 6.28
    };
    w.group.add(bird);
    w.birds.push(bird);
  }
}
function updateBirds(w, t, dt) {
  if (!w.birds) return;
  for (var i = 0; i < w.birds.length; i++) {
    var b = w.birds[i], u = b.userData;
    u.az += u.speed * dt;
    b.position.set(Math.cos(u.az) * u.rad, u.h + Math.sin(t * 1.3 + u.ph) * 0.4, Math.sin(u.az) * u.rad);
    b.rotation.y = -u.az;
    var flap = Math.sin(t * 9 + u.ph) * 0.55;
    u.wl.rotation.x = flap; u.wr.rotation.x = -flap;
  }
}

/* ---- fireflies: night-only ground shimmer ---------------------------------- */
function addFireflies(w, R, rng) {
  var FN = 70;
  var fp = new Float32Array(FN * 3), fc = new Float32Array(FN * 3);
  w.ffBase = [];
  for (var k = 0; k < FN; k++) {
    var a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * R * 0.85;
    var fx = Math.cos(a) * rr, fz = Math.sin(a) * rr;
    var fy = TOP_Y + 0.5 + rng() * 2.4;
    w.ffBase.push({ x: fx, y: fy, z: fz, ph: rng() * 6.28, sp: 0.3 + rng() * 0.6 });
    fp[k * 3] = fx; fp[k * 3 + 1] = fy; fp[k * 3 + 2] = fz;
  }
  w.ffGeo = new THREE.BufferGeometry();
  w.ffGeo.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  w.ffGeo.setAttribute('color', new THREE.BufferAttribute(fc, 3));
  w.ffMat = new THREE.PointsMaterial({ size: 0.16, map: getTex('glow'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true });
  var ff = new THREE.Points(w.ffGeo, w.ffMat);
  ff.frustumCulled = false;
  w.group.add(ff);
}
function updateFireflies(w, t) {
  if (!w.ffBase || curNight < 0.03) return;
  var arr = w.ffGeo.attributes.position.array, ca = w.ffGeo.attributes.color.array;
  for (var i = 0; i < w.ffBase.length; i++) {
    var b = w.ffBase[i];
    var tw = 0.5 + 0.5 * Math.sin(t * b.sp * 3 + b.ph);
    var f = curNight * tw;
    arr[i * 3] = b.x + Math.sin(t * b.sp + b.ph) * 0.7;
    arr[i * 3 + 1] = b.y + Math.sin(t * b.sp * 1.3 + b.ph) * 0.4;
    arr[i * 3 + 2] = b.z + Math.cos(t * b.sp * 0.8 + b.ph) * 0.7;
    ca[i * 3] = 1.0 * f; ca[i * 3 + 1] = 0.92 * f; ca[i * 3 + 2] = 0.45 * f;
  }
  w.ffGeo.attributes.position.needsUpdate = true;
  w.ffGeo.attributes.color.needsUpdate = true;
}

/* ==========================================================================
   WORLD ASSEMBLY
   -------------------------------------------------------------------------- */
function disposeWorld() {
  if (!world) return;
  scene.remove(world.group);
  world.treeField.dispose();
  for (var i = 0; i < world.instanced.length; i++) world.instanced[i].dispose();
  for (var g = 0; g < world.uniqueGeos.length; g++) world.uniqueGeos[g].dispose();
  if (world.particles) world.particles.dispose();
  world = null;
}
function buildWorld(biome, view) {
  disposeWorld();
  var seed = hashStr(biome.id + '|v2');
  var rng = mulberry32(seed);
  var R = view.radius;
  var rout = view.rout || (R * 0.72);
  var group = new THREE.Group();
  var w = {
    biomeId: biome.id, group: group, radius: R,
    trees: null, treeField: null, springs: [],
    uniqueGeos: [], instanced: [], animals: [],
    particles: null, clouds: [], cloudMats: [], birds: [],
    slots: [], groundFn: null
  };
  var gf = makeGroundFn(biome, R, seed);
  w.groundFn = gf;
  var island = buildIslandMesh(biome, R, seed, gf);
  w.uniqueGeos.push(island.geometry, island.material);
  group.add(island);
  var under = buildUnderside(biome, R, seed, gf);
  w.uniqueGeos.push(under.geometry, under.material);
  group.add(under);
  try {
    var ringG = new THREE.RingGeometry(R * 1.01, R * 1.12, 72);
    ringG.rotateX(-Math.PI / 2);
    var ringM = new THREE.MeshBasicMaterial({ color: biome.sky.horizon, transparent: true, opacity: 0.5, depthWrite: false });
    var foam = new THREE.Mesh(ringG, ringM);
    foam.position.y = SEA_Y + 0.06;
    group.add(foam);
    w.uniqueGeos.push(ringG, ringM);
  } catch (eFoam) {}
  if (waterMesh) waterMesh.scale.setScalar(Math.max(34, R * 3.2));
  var stream = buildStream(gf, biome);
  if (stream) {
    w.uniqueGeos.push(stream.geometry, stream.material);
    group.add(stream);
  }
  /* golden-angle slot spiral - identical math to v1 */
  var slots = [];
  for (var i = 0; i < view.slots; i++) {
    var rr = SLOT_BASE + Math.sqrt((i + 0.5) / view.slots) * rout;
    var a = i * 2.39996 + (rng() - 0.5) * 0.3;
    var x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    slots.push({ x: x, z: z, y: gf.height(x, z), rot: rng() * Math.PI * 2, 'var': 0.9 + rng() * 0.22 });
  }
  w.slots = slots;
  addProps(w, biome, rng, gf.height, R);
  var field = createTreeField(group);
  w.treeField = field;
  w.trees = field.entries;
  w.springs = field.springs;
  try {
    var animal = makeAnimal(biome.animal.type, mulberry32(seed ^ 77));
    var as = slots[Math.floor(rng() * Math.min(8, slots.length))];
    animal.position.set(as ? as.x * 0.5 : 0, animal.children.length && biome.animal.type === 'parrot' ? TOP_Y + 1.6 : (as ? as.y : TOP_Y), as ? as.z * 0.5 : 0);
    animal.userData.baseY = animal.position.y;
    animal.rotation.y = rng() * Math.PI * 2;
    animal.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    group.add(animal);
    w.animals.push(animal);
  } catch (e) {}
  w.particles = ParticleField(biome.particles, seed ^ 0x51f, R * 0.8);
  group.add(w.particles.points);
  try { addClouds(w, R, rng); } catch (e) {}
  try { addBirds(w, R, rng); } catch (e) {}
  try { addFireflies(w, R, rng); } catch (e) {}
  var sc = R + 8;
  sun.shadow.camera.left = -sc; sun.shadow.camera.right = sc;
  sun.shadow.camera.top = sc; sun.shadow.camera.bottom = -sc;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(group);
  world = w;
  return w;
}

/* ==========================================================================
   SCENE INIT - shared scene, two renderers (mini card + full explorer)
   -------------------------------------------------------------------------- */
function initScene() {
  var card = document.getElementById('gi-card');
  if (!card) return;
  try {
    miniRenderer = new THREE.WebGLRenderer({ canvas: card, antialias: true });
  } catch (e) { engineFailed = true; showFallbackPoster(); return; }
  miniRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  miniRenderer.shadowMap.enabled = true;
  miniRenderer.shadowMap.type = THREE.PCFShadowMap;
  miniRenderer.outputColorSpace = THREE.SRGBColorSpace;
  miniRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  miniRenderer.toneMappingExposure = 1.1;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xe6f4ea, 55, 190);

  miniCam = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  miniCam.position.set(14, 9.5, 15.5);

  hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5d8f68, 1.05);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xfff4d6, 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -18; sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  scene.add(sun); scene.add(sun.target);
  ambientL = new THREE.AmbientLight(0xffffff, 0.14);
  scene.add(ambientL);
  moonFill = new THREE.DirectionalLight(0x8ea2ff, 0);
  moonFill.position.set(-30, 40, -20);
  scene.add(moonFill);

  skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x74b9e4) },
      uHorizon: { value: new THREE.Color(0xe6f4ea) },
      uNight: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.5, 0.42, 0.35).normalize() },
      uTime: { value: 0 }
    },
    vertexShader: 'varying vec3 vP; void main(){ vP=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: [
      'uniform vec3 uTop,uHorizon,uSunDir; uniform float uNight,uTime; varying vec3 vP;',
      'void main(){',
      '  vec3 dir=normalize(vP);',
      '  vec3 col=mix(uHorizon,uTop,smoothstep(-0.06,0.5,dir.y));',
      '  float sd=max(dot(dir,uSunDir),0.0);',
      '  float day=1.0-uNight;',
      '  col+=vec3(1.0,0.92,0.75)*pow(sd,160.0)*0.5*day;',
      '  col+=vec3(1.0,0.88,0.66)*smoothstep(0.9994,0.99985,sd)*day;',
      '  vec3 sp=floor(dir*160.0);',
      '  float st=fract(sin(dot(sp,vec3(12.9898,78.233,37.719)))*43758.5453);',
      '  float star=step(0.9974,st)*uNight*smoothstep(0.02,0.25,dir.y);',
      '  col+=vec3(star)*(0.45+0.55*sin(uTime*2.0+st*40.0));',
      '  gl_FragColor=vec4(col,1.0);',
      '}'
    ].join('\n')
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(260, 24, 14), skyMat));

  var wgeo = new THREE.CircleGeometry(1, 72);
  wgeo.rotateX(-Math.PI / 2);
  /* v2 sea: plain lit Lambert - same reliable pipeline as terrain. A separate
     foam ring mesh hugs each island's coastline (added per buildWorld). */
  waterMat = new THREE.MeshLambertMaterial({ color: 0x2c7da6 });
  var water = new THREE.Mesh(wgeo, waterMat);
  water.position.y = SEA_Y;
  water.scale.setScalar(46);
  water.receiveShadow = false;
  scene.add(water);
  waterMesh = water;

  fullCam = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  fullOrbit = makeOrbit(fullCam, { x: 0, y: 2.2, z: 0 }, 20);

  clock = new THREE.Clock();
  try { new ResizeObserver(sizeCanvases).observe(card); } catch (e) {}
  built = true;
}

/* ==========================================================================
   GROWTH BRAIN - exact v1 semantics (with the audited bugs fixed)
   -------------------------------------------------------------------------- */
var _dailyCacheRaw = null, _dailyCacheObj = null;
function dailyLedger() {
  var raw = null;
  try { raw = localStorage.getItem(LS_DAILY); } catch (e) {}
  if (raw === _dailyCacheRaw && _dailyCacheObj) return _dailyCacheObj;
  var o = {};
  try { o = JSON.parse(raw || '{}') || {}; } catch (e) { o = {}; }
  _dailyCacheRaw = raw; _dailyCacheObj = o;
  return o;
}
function readLive() {
  function g(id) { var e = document.getElementById(id); return e ? (parseInt(e.textContent, 10) || 0) : 0; }
  var l = { physics: g('physics-count'), chemistry: g('chemistry-count'), maths: g('maths-count') };
  try {
    if (window.solved) {
      l.physics = Math.max(l.physics, +window.solved.physics || 0);
      l.chemistry = Math.max(l.chemistry, +window.solved.chemistry || 0);
      l.maths = Math.max(l.maths, +window.solved.maths || 0);
    }
  } catch (e) {}
  return l;
}
function forestStoreToday() {
  try {
    var o = dailyLedger();
    var c = o[todayKey()] || {};
    return { physics: (+c.physics || 0), chemistry: (+c.chemistry || 0), maths: (+c.maths || 0) };
  } catch (e) { return { physics: 0, chemistry: 0, maths: 0 }; }
}
function visual() {
  var l = readLive(), s = forestStoreToday();
  return { physics: Math.max(l.physics, s.physics), chemistry: Math.max(l.chemistry, s.chemistry), maths: Math.max(l.maths, s.maths) };
}
function totalToday() { var v = visual(); return v.physics + v.chemistry + v.maths; }
function setSubj(s, v) {
  var n = document.getElementById(s + '-count');
  if (n && (parseInt(n.textContent, 10) || 0) !== v) n.textContent = String(v);
  try { if (window.solved) window.solved[s] = v; } catch (e) {}
}
function restoreAssert() {
  var st = forestStoreToday(), live = readLive(), changed = false;
  SUBJECTS.forEach(function (s) {
    if ((st[s] || 0) > (live[s] || 0)) { setSubj(s, st[s] || 0); changed = true; }
  });
  return changed;
}
function seedStore() {
  var st = forestStoreToday(), live = readLive(), write = false;
  SUBJECTS.forEach(function (s) {
    if ((live[s] || 0) > (st[s] || 0)) { st[s] = live[s] || 0; write = true; }
  });
  if (write) {
    try {
      var o = dailyLedger();
      o[todayKey()] = st;
      var raw = JSON.stringify(o);
      localStorage.setItem(LS_DAILY, raw);
      _dailyCacheRaw = raw; _dailyCacheObj = o;
      try { if (window._idbMirror) window._idbMirror.set(LS_DAILY, o); } catch (e) {}
    } catch (e) {}
  }
}
function restoreFromIDB() {
  var m = window._idbMirror;
  if (!m) return Promise.resolve();
  return Promise.all([m.get(LS_DAILY), m.get(LS_GROVE)]).then(function (res) {
    try {
      var idbDaily = res[0], idbGrove = res[1];
      if (idbDaily && typeof idbDaily === 'object') {
        var ls = {};
        try { ls = JSON.parse(localStorage.getItem(LS_DAILY) || '{}'); } catch (e) { ls = {}; }
        var merged = Object.assign({}, ls);
        for (var d in idbDaily) {
          var e = idbDaily[d];
          if (!e || typeof e !== 'object') continue;
          var prev = merged[d] || {};
          merged[d] = {
            physics: Math.max(Number(prev.physics) || 0, Number(e.physics) || 0),
            chemistry: Math.max(Number(prev.chemistry) || 0, Number(e.chemistry) || 0),
            maths: Math.max(Number(prev.maths) || 0, Number(e.maths) || 0),
            updatedAt: Math.max(Number(prev.updatedAt) || 0, Number(e.updatedAt) || 0)
          };
        }
        var raw = JSON.stringify(merged);
        try { localStorage.setItem(LS_DAILY, raw); } catch (e2) {}
        _dailyCacheRaw = raw; _dailyCacheObj = merged;
      }
      if (idbGrove && typeof idbGrove === 'object') {
        var hasLS = false;
        try { hasLS = !!localStorage.getItem(LS_GROVE); } catch (e3) {}
        if (!hasLS) { grove = idbGrove; saveGrove(); }
      }
    } catch (e4) {}
  });
}

function ensureDayBiome(day) {
  var d = grove.daily[day] || (grove.daily[day] = {});
  return d[grove.activeBiome] || (d[grove.activeBiome] = { count: 0, species: [], bySubject: {} });
}
function flushSubjectSpecies(by) {
  var out = [];
  if (!by || typeof by !== 'object') return out;
  for (var s = 0; s < SUBJECTS.length; s++) {
    var arr = by[SUBJECTS[s]];
    if (Array.isArray(arr)) for (var i = 0; i < arr.length; i++) out.push(arr[i]);
  }
  return out;
}
function attributeBySubject(deltas) {
  var total = 0;
  for (var s = 0; s < SUBJECTS.length; s++) total += Math.max(0, deltas[SUBJECTS[s]] || 0);
  if (total <= 0) return;
  var day = todayKey();
  var b = ensureDayBiome(day);
  b.bySubject = b.bySubject || {};
  var before = b.count;
  b.count += total;
  var base = b.species.length;
  var bi = 0;
  for (var s2 = 0; s2 < SUBJECTS.length; s2++) {
    var subj = SUBJECTS[s2];
    var dlt = Math.max(0, deltas[subj] || 0);
    if (dlt <= 0) continue;
    var arr = b.bySubject[subj] || (b.bySubject[subj] = []);
    var sp = subjectSpecies(subj);
    for (var i = 0; i < dlt; i++) { arr.push(sp); b.species[base + bi] = sp; bi++; }
  }
  saveGrove();
  if (before % STAGES_PER_TREE === 0 && b.count % STAGES_PER_TREE === 1) {
    sndPlant();
    floaty('\ud83c\udf31 New sapling!');
  }
}
var periodMemoKey = '';
function periodCount(biomeId, period) {
  var today = todayKey();
  var liveTotal = (biomeId === grove.activeBiome && (period !== 'yesterday')) ? totalToday() : 0;
  var key = groveRev + '|' + biomeId + '|' + period + '|' + today + '|' + liveTotal;
  if (periodMemo[key]) return periodMemo[key];
  var keys = Object.keys(grove.daily).sort();
  var lo = '', hi = today;
  if (period === 'today') { lo = today; hi = today; }
  else if (period === 'yesterday') { lo = dayOffsetKey(1); hi = lo; liveTotal = 0; }
  else if (period === 'week') lo = dayOffsetKey(6);
  else if (period === 'month') lo = dayOffsetKey(29);
  else if (period === 'year') lo = dayOffsetKey(364);
  var count = 0, species = [];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k < lo || k > hi) continue;
    var d = grove.daily[k];
    if (!d || !d[biomeId]) continue;
    var b = d[biomeId];
    count += (b.count || 0);
    var spArr = (b.bySubject && typeof b.bySubject === 'object') ? flushSubjectSpecies(b.bySubject) : b.species;
    if (Array.isArray(spArr)) for (var s2 = 0; s2 < spArr.length; s2++) species.push(spArr[s2]);
  }
  if (hi === today && !grove.daily[today] && biomeId === grove.activeBiome) {
    count += liveTotal;
    for (var i2 = 0; i2 < liveTotal; i2++) species.push(grove.activeSpecies);
  }
  var out = { count: count, species: species };
  if (Object.keys(periodMemo).length > 64) periodMemo = {};
  periodMemo[key] = out;
  return out;
}
function viewFor(biomeId, period) {
  var agg = periodCount(biomeId, period);
  var slots = clamp(Math.max(MIN_SLOTS, Math.ceil(agg.count / STAGES_PER_TREE)), MIN_SLOTS, MAX_SLOTS);
  var R = islandRadiusForSlots(slots);
  var rout = Math.max(R * 0.72, MIN_TREE_SPACING * Math.sqrt(slots) / 1.24);
  var safe = Math.max(0.5, R * 0.70 - SLOT_BASE);
  return { slots: slots, radius: R, rout: Math.min(rout, safe), agg: agg };
}
function orbitDistFor(R) { return clamp(R * 1.9, 20, 75); }
function islandRadiusForSlots(slots) {
  var R = Math.max(ISLAND_R, ISLAND_R * Math.sqrt(slots / MIN_SLOTS));
  return Math.max(R, MIN_TREE_SPACING * Math.sqrt(slots) / (1.24 * 0.72));
}
function desiredTrees(biomeId) {
  var agg = periodCount(biomeId, worldPeriod);
  var slots = world ? world.slots.length : MIN_SLOTS;
  var full = Math.min(Math.floor(agg.count / STAGES_PER_TREE), slots);
  var out = [];
  for (var i = 0; i < full; i++) out.push({ slot: i, stage: 2, species: agg.species[i] || grove.activeSpecies });
  var r = agg.count % STAGES_PER_TREE;
  if (r > 0 && full < slots) out.push({ slot: full, stage: r - 1, species: agg.species[full] || grove.activeSpecies });
  return out;
}
function syncTrees(first) {
  if (!world || !built) return;
  var want = desiredTrees(world.biomeId);
  var before = world.treeField.entries.size;
  var full = [];
  for (var i = 0; i < want.length; i++) {
    var wd = want[i];
    var slot = world.slots[wd.slot];
    if (!slot) continue;
    full.push({ slot: wd.slot, x: slot.x, y: slot.y, z: slot.z, rot: slot.rot, 'var': slot['var'], species: wd.species, stage: wd.stage });
  }
  world.treeField.sync(full, { ceremony: !first && motionOK() && !travelingFlag });
  var added = world.treeField.entries.size - before;
  if (added > 0 && !first) for (var f = 0; f < Math.min(added, 3); f++) floaty('\ud83c\udf31');
  var empty = document.getElementById('gi-empty');
  if (empty) empty.style.display = world.treeField.entries.size > 0 ? 'none' : 'flex';
  updateTreeStat();
}
function updateTreeStat() {
  var n = world ? world.treeField.entries.size : 0;
  var f = document.getElementById('gi-full-trees');
  if (f) f.textContent = n;
  var agg = world ? periodCount(world.biomeId, worldPeriod) : null;
  var m = document.getElementById('gi-full-meta');
  if (m) m.textContent = agg ? agg.count + ' solves \u00b7 ' + (PERIOD_LABELS[worldPeriod] || '') : '';
}

/* ---- snapshot attribution + elo unlocks + tick ---------------------------- */
var lastTotal = -1, lastSubj = null, lastElo = -1, seenDay = '';
var travelingFlag = false;
function attributeSinceSnapshot() {
  var cur = visual();
  if (!lastSubj) { lastSubj = cur; return 0; }
  var d = { physics: 0, chemistry: 0, maths: 0 }, total = 0;
  for (var s = 0; s < SUBJECTS.length; s++) {
    d[SUBJECTS[s]] = Math.max(0, (cur[SUBJECTS[s]] || 0) - (lastSubj[SUBJECTS[s]] || 0));
    total += d[SUBJECTS[s]];
  }
  lastSubj = cur;
  if (total > 0) attributeBySubject(d);
  return total;
}
function checkElo() {
  var e = globalElo();
  if (e === lastElo) return;
  var prev = lastElo;
  lastElo = e;
  if (prev >= 0 && e > prev) {
    var newB = [], newS = [];
    for (var i = 0; i < BIOMES.length; i++) if (prev < BIOMES[i].unlockElo && e >= BIOMES[i].unlockElo) newB.push(BIOMES[i]);
    for (var s = 0; s < SPECIES_DEFS.length; s++) if (prev < SPECIES_DEFS[s].unlockElo && e >= SPECIES_DEFS[s].unlockElo) newS.push(SPECIES_DEFS[s]);
    if (newB.length || newS.length) {
      sndUnlock();
      newB.forEach(function (b) {
        toast(b.icon + ' <b>' + b.name + '</b> unlocked!', 'Travel \u26f5', function () { travel(b.id); closeMap(); });
      });
      newS.forEach(function (sp) {
        toast(sp.icon + ' <b>' + sp.name + '</b> unlocked in the nursery!', 'Plant \ud83c\udf31', function () {
          grove.activeSpecies = sp.id; saveGrove(); updateHUD(); renderStoreIfOpen();
        });
      });
    }
  }
}
function tick(first) {
  if (document.hidden && !first) return;
  var day = todayKey();
  var rolled = false;
  if (day !== seenDay) {
    seenDay = day;
    if (lastTotal >= 0) { lastTotal = 0; rolled = true; }
    lastSubj = null;
    periodMemo = {};
  }
  /* v1 midnight-race fix: on the very tick the day flips, the app may not have
     reset its live counters yet - snapshot only, never seed or attribute. */
  if (!rolled) {
    restoreAssert();
    seedStore();
    var v = visual();
    var t = v.physics + v.chemistry + v.maths;
    if (lastTotal < 0) {
      if (!grove.daily[day]) {
        if (t > 0) { ensureDayBiome(day); attributeBySubject(v); saveGrove(); }
      }
      lastTotal = t;
      lastSubj = visual();
    } else {
      attributeSinceSnapshot();
      lastTotal = t;
    }
  }
  checkElo();
  maybeExpand();
  syncTrees(first);
  updateHUD();
  renderStoreIfOpen();
  renderMapIfOpen();
  var fade = document.getElementById('gi-fade');
  if (fade && fade.style.opacity === '1' && !travelingFlag) fade.style.opacity = '0';
}

/* ==========================================================================
   HUD / floaties / travel / expansion
   -------------------------------------------------------------------------- */
var hudCache = {};
function setTxt(id, v) {
  if (hudCache[id] === v) return;
  hudCache[id] = v;
  var e = document.getElementById(id);
  if (e) e.textContent = v;
}
function setHtml(id, v) {
  if (hudCache['h:' + id] === v) return;
  hudCache['h:' + id] = v;
  var e = document.getElementById(id);
  if (e) e.innerHTML = v;
}
function updateHUD() {
  var b = biomeById(grove.activeBiome);
  var elo = globalElo();
  var sp = speciesById(grove.activeSpecies);
  setTxt('gi-full-elo', String(elo));
  var chip = document.getElementById('gi-chip');
  if (chip) chip.style.background = hex(b.ground);
  var fchip = document.getElementById('gi-full-chip');
  if (fchip) fchip.style.background = hex(b.ground);
  setTxt('gi-chip', b.icon);
  setTxt('gi-name', b.name);
  setTxt('gi-sub', elo + ' ELO \u00b7 ' + totalToday() + ' solved today');
  setTxt('gi-full-chip', b.icon);
  setTxt('gi-full-name', b.name);
  setTxt('gi-full-sub', b.blurb);
  setHtml('gi-species', sp.icon + ' ' + sp.name);
  var next = null;
  for (var i = 0; i < BIOMES.length; i++) if (!biomeUnlocked(BIOMES[i].id, elo)) { next = BIOMES[i]; break; }
  var bar = document.getElementById('gi-bar');
  if (next) {
    var prevThr = 0;
    for (var j = 0; j < BIOMES.length; j++) if (BIOMES[j].unlockElo <= elo && BIOMES[j].unlockElo >= prevThr) prevThr = BIOMES[j].unlockElo;
    var pct = clamp((elo - prevThr) / (next.unlockElo - prevThr) * 100, 0, 100);
    if (bar) bar.style.width = pct + '%';
    setTxt('gi-next', 'Next: ' + next.icon + ' ' + next.name + ' at ' + next.unlockElo + ' ELO');
  } else {
    if (bar) bar.style.width = '100%';
    setTxt('gi-next', 'All islands unlocked \uD83C\uDF89');
  }
  var n = 0;
  for (var k = 0; k < BIOMES.length; k++) if (biomeUnlocked(BIOMES[k].id, elo)) n++;
  setTxt('gi-unlock-badge', n + '/' + BIOMES.length);
}
function floaty(text) {
  try {
    var card = document.getElementById('gi-host');
    var fl = document.getElementById('gi-float');
    if (!card || !fl) return;
    var r = card.getBoundingClientRect();
    var s = el('span', { class: 'gi-floaty' });
    s.textContent = text;
    s.style.left = (r.left + r.width / 2 + (Math.random() * 120 - 60)) + 'px';
    s.style.top = (r.top + r.height * 0.4) + 'px';
    fl.appendChild(s);
    setTimeout(function () { s.remove(); }, 1050);
  } catch (e) {}
}

var travelingFlagRef = function () { return travelingFlag; };
function travel(biomeId, instant) {
  var biome = biomeById(biomeId);
  if (!biome || !biomeUnlocked(biomeId)) return;
  var doSwap = function () {
    grove.activeBiome = biomeId; saveGrove();
    applyEnvironment(biome);
    buildWorld(biome, viewFor(biomeId, worldPeriod));
    syncTrees(true);
    updateHUD();
    renderStoreIfOpen();
    renderMapIfOpen();
  };
  if (instant || !built || !motionOK()) { doSwap(); return; }
  if (travelingFlag) return;
  travelingFlag = true;
  var fade = document.getElementById('gi-fade');
  if (fade) {
    fade.style.background = hex(biome.sky.horizon);
    fade.style.opacity = '1';
  }
  setTimeout(function () {
    sndTravel();
    doSwap();
    setTimeout(function () { if (fade) fade.style.opacity = '0'; travelingFlag = false; }, 60);
  }, 400);
}
function maybeExpand() {
  if (!world || !built) return false;
  var bio = biomeById(world.biomeId);
  var view = viewFor(bio.id, worldPeriod);
  var needsBuild = view.slots !== world.slots.length || Math.abs(view.radius - world.radius) > 0.01;
  if (!needsBuild) { syncTrees(false); return false; }
  var fade = document.getElementById('gi-fade');
  if (fade && motionOK()) {
    fade.style.background = hex(bio.sky.horizon);
    fade.style.opacity = '1';
  }
  applyEnvironment(bio);
  buildWorld(bio, view);
  syncTrees(true);
  if (fade) setTimeout(function () { fade.style.opacity = '0'; }, 60);
  updateTreeStat();
  updateHUD();
  if (fullOrbit) { fullOrbit.dist = orbitDistFor(view.radius); fullOrbit.apply(); }
  return true;
}

/* ==========================================================================
   ORBIT CONTROLS - damped, pinch/wheel, idle auto-rotate (wake on down only)
   -------------------------------------------------------------------------- */
function makeOrbit(cam, target, dist) {
  var o = {
    cam: cam, tx: target.x, ty: target.y, tz: target.z, dist: dist,
    az: Math.atan2(14, 15.5), pol: Math.acos(clamp((9.5 - target.y) / dist, 0.12, 0.99)),
    auto: true, idle: null, ptrs: new Map(), pinch0: null, azVel: 0
  };
  o.apply = function () {
    var sx = Math.sin(o.az) * Math.sin(o.pol), sy = Math.cos(o.pol);
    cam.position.set(o.tx + sx * o.dist, o.ty + sy * o.dist, o.tz + Math.cos(o.az) * Math.sin(o.pol) * o.dist);
    cam.lookAt(o.tx, o.ty, o.tz);
  };
  o.wake = function () {
    o.auto = false;
    clearTimeout(o.idle);
    o.idle = setTimeout(function () { o.auto = true; }, 4000);
  };
  o.tick = function (dt) {
    if (o.auto && motionOK()) { o.az += dt * 0.07; o.apply(); }
    else if (Math.abs(o.azVel) > 0.0001) {
      o.az += o.azVel; o.azVel *= Math.exp(-4 * dt); o.apply();
    }
  };
  o.apply();
  return o;
}
function bindOrbit(canvas, o) {
  if (canvas.__orbitBound) return;
  canvas.__orbitBound = true;
  canvas.addEventListener('pointerdown', function (e) {
    try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); } catch (err) {}
    o.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (o.ptrs.size === 2) {
      var ps = Array.from(o.ptrs.values());
      o.pinch0 = Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1]);
    }
    o.azVel = 0;
    o.wake();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!o.ptrs.has(e.pointerId)) return;
    var prev = o.ptrs.get(e.pointerId);
    o.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (o.ptrs.size === 1) {
      var dx = e.clientX - prev[0];
      o.az -= dx * 0.0055;
      o.azVel = -dx * 0.0011;
      o.apply();
    } else if (o.ptrs.size === 2 && o.pinch0) {
      var ps = Array.from(o.ptrs.values());
      var d = Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1]);
      o.dist = clamp(o.dist * (o.pinch0 / Math.max(1, d)), orbitDistFor(world ? world.radius : ISLAND_R) * 0.45, 90);
      o.pinch0 = d;
      o.apply();
    }
  });
  function up(e) { o.ptrs.delete(e.pointerId); if (o.ptrs.size < 2) o.pinch0 = null; o.wake(); }
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    o.dist = clamp(o.dist * (e.deltaY > 0 ? 1.07 : 0.93), orbitDistFor(world ? world.radius : ISLAND_R) * 0.45, 90);
    o.apply(); o.wake();
  }, { passive: false });
}

/* ==========================================================================
   FULL EXPLORER / STORE / MAP
   -------------------------------------------------------------------------- */
function sizeCanvases() {
  if (!built) return;
  var card = document.getElementById('gi-card');
  if (card && miniRenderer) {
    var r = card.getBoundingClientRect();
    var w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
    miniRenderer.setSize(w, h, false);
    miniCam.aspect = w / h;
    miniCam.updateProjectionMatrix();
  }
  var fc = document.getElementById('gi-full-canvas');
  if (fc && fullRenderer && fullOpen) {
    var r2 = fc.parentElement ? fc.parentElement.getBoundingClientRect() : fc.getBoundingClientRect();
    var w2 = Math.max(1, Math.floor(r2.width)), h2 = Math.max(1, Math.floor(r2.height));
    fullRenderer.setSize(w2, h2, false);
    fullCam.aspect = w2 / h2;
    fullCam.updateProjectionMatrix();
  }
}
var dprTier = 0, DPR_TIERS = [1.75, 1.4, 1.1, 0.85];
function ensureFull() {
  if (fullRenderer || !built) return;
  var cvs = document.getElementById('gi-full-canvas');
  if (!cvs) return;
  try {
    fullRenderer = new THREE.WebGLRenderer({ canvas: cvs, antialias: true });
  } catch (e) { engineFailed = true; return; }
  fullRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_TIERS[dprTier]));
  fullRenderer.shadowMap.enabled = true;
  fullRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  fullRenderer.outputColorSpace = THREE.SRGBColorSpace;
  fullRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  fullRenderer.toneMappingExposure = 1.1;
  bindOrbit(cvs, fullOrbit);
  try { new ResizeObserver(sizeCanvases).observe(cvs); } catch (e) {}
}
function syncPeriodUI() {
  var c = document.getElementById('gi-full-periods');
  if (!c) return;
  var bs = c.querySelectorAll('button');
  for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('active', bs[i].getAttribute('data-period') === worldPeriod);
}
function setViewPeriod(p) {
  worldPeriod = p;
  fullPeriod = p;
  syncPeriodUI();
  if (!world || !built) return;
  maybeExpand();
  updateTreeStat();
  updateHUD();
  renderStoreIfOpen();
  renderMapIfOpen();
}
function openFull() {
  ensureFull();
  var ov = document.getElementById('gi-full-overlay');
  if (!ov) return;
  if (!built) {
    if (!failToastShown) { failToastShown = true; toast(engineFailed ? '\ud83d\udea8 The 3D engine could not start - the islands need WebGL or a one-time online load.' : '\ud83c\udf0a Waking the islands - one moment\u2026'); }
    return;
  }
  /* v1 bug fix: never spawn the camera inside a large island */
  if (fullOrbit && world) { fullOrbit.dist = orbitDistFor(world.radius); fullOrbit.apply(); }
  ov.classList.add('open');
  document.body.classList.add('gi-full-open');
  fullOpen = true;
  sizeCanvases();
  setViewPeriod(fullPeriod);
  updateHUD();
  ensureLoop();
}
function closeFull() {
  var ov = document.getElementById('gi-full-overlay');
  if (!ov) return;
  ov.classList.remove('open');
  document.body.classList.remove('gi-full-open');
  fullOpen = false;
}
function openStore() {
  var ov = document.getElementById('gi-store-overlay');
  if (!ov) return;
  ov.classList.add('open');
  renderStore();
}
function closeStore() { var ov = document.getElementById('gi-store-overlay'); if (ov) ov.classList.remove('open'); }
function storeSig() { return globalElo() + '|' + grove.activeSpecies + '|' + grove.activeBiome + '|' + JSON.stringify(grove.subjectSpecies || {}); }
var lastStoreSig = '';
function renderStoreIfOpen() {
  var ov = document.getElementById('gi-store-overlay');
  if (!ov || !ov.classList.contains('open')) return;
  var s = storeSig();
  if (s !== lastStoreSig) { lastStoreSig = s; renderStore(); }
}
function renderStore() {
  var elo = globalElo();
  var strip = document.getElementById('gi-store-elo');
  if (strip) strip.textContent = '\u2b50 ' + elo + ' ELO';
  renderSubjectsTab();
  var biomesTab = document.getElementById('gi-tab-islands');
  var treesTab = document.getElementById('gi-tab-trees');
  if (biomesTab) {
    biomesTab.innerHTML = '';
    BIOMES.forEach(function (b) {
      var un = biomeUnlocked(b.id, elo);
      var card = el('div', { class: 'gi-store-card' + (un ? '' : ' gi-locked'), html:
        '<div class="gi-store-icon">' + b.icon + '</div>' +
        '<div class="gi-store-name">' + b.name + '</div>' +
        '<div class="gi-store-desc">' + b.blurb + '</div>' +
        '<div class="gi-req"><div class="gi-req-bar"><i style="width:' + (un ? 100 : clamp(elo / b.unlockElo * 100, 0, 100)) + '%"></i></div>' +
        '<span>' + (un ? 'Unlocked \u2713' : 'Requires ' + b.unlockElo + ' ELO') + '</span></div>' +
        '<button class="gi-store-btn" ' + (un ? '' : 'disabled') + '>' + (un ? (grove.activeBiome === b.id ? '\u25cf Here' : 'Travel \u26f5') : '\ud83d\udd12 Locked') + '</button>' });
      card.addEventListener('click', function () { if (un) { travel(b.id); closeStore(); } });
      biomesTab.appendChild(card);
    });
  }
  if (treesTab) {
    treesTab.innerHTML = '';
    SPECIES_DEFS.forEach(function (sp) {
      var un = speciesUnlocked(sp.id, elo);
      var active = grove.activeSpecies === sp.id;
      var card = el('div', { class: 'gi-store-card' + (un ? '' : ' gi-locked') + (active ? ' gi-active' : ''), html:
        '<div class="gi-store-icon">' + sp.icon + '</div>' +
        '<div class="gi-store-name">' + sp.name + '</div>' +
        '<div class="gi-store-desc">' + (active ? 'Planting now' : un ? 'Available to plant' : 'Reach ' + sp.unlockElo + ' ELO to unlock') + '</div>' +
        '<div class="gi-req"><div class="gi-req-bar"><i style="width:' + (un ? 100 : clamp(elo / sp.unlockElo * 100, 0, 100)) + '%"></i></div>' +
        '<span>' + (un ? 'Unlocked \u2713' : 'Requires ' + sp.unlockElo + ' ELO') + '</span></div>' +
        '<button class="gi-store-btn" ' + (un ? '' : 'disabled') + '>' + (active ? '\u2713 Planting' : un ? 'Plant this \ud83c\udf31' : '\ud83d\udd12 Locked') + '</button>' });
      card.addEventListener('click', function () {
        if (!un) return;
        grove.activeSpecies = sp.id;
        saveGrove();
        renderStore();
        updateHUD();
      });
      treesTab.appendChild(card);
    });
  }
}
function renderSubjectsTab() {
  var tab = document.getElementById('gi-tab-subjects');
  if (!tab) return;
  var elo = globalElo();
  var meta = { physics: { name: 'Physics', icon: '\u2699\ufe0f' }, chemistry: { name: 'Chemistry', icon: '\ud83e\uddea' }, maths: { name: 'Maths', icon: '\ud83d\udcd0' } };
  var html = '<div class="gi-subj-head">Which tree each subject plants - solving that subject\u2019s questions grows that tree</div>';
  for (var s = 0; s < SUBJECTS.length; s++) {
    var subj = SUBJECTS[s];
    var cur = subjectSpecies(subj);
    var opts = '';
    for (var i = 0; i < SPECIES_DEFS.length; i++) {
      var sp = SPECIES_DEFS[i];
      var un = speciesUnlocked(sp.id, elo);
      opts += '<option value="' + sp.id + '"' + (sp.id === cur ? ' selected' : '') + (un ? '' : ' disabled') + '>' + sp.icon + ' ' + sp.name + (un ? '' : ' \ud83d\udd12') + '</option>';
    }
    html += '<div class="gi-subj-row">' +
      '<div class="gi-subj-name"><span>' + meta[subj].icon + '</span> ' + meta[subj].name + '</div>' +
      '<select class="gi-subj-select" data-subj="' + subj + '">' + opts + '</select>' +
      '</div>';
  }
  tab.innerHTML = html;
  var sels = tab.querySelectorAll('.gi-subj-select');
  for (var q = 0; q < sels.length; q++) {
    sels[q].addEventListener('change', function () {
      var subj = this.getAttribute('data-subj');
      grove.subjectSpecies = grove.subjectSpecies || {};
      grove.subjectSpecies[subj] = this.value;
      saveGrove();
      renderStore();
      updateHUD();
    });
  }
}
function mapGlyph(species, x, y, c, s) {
  var f = hex(c);
  switch (species) {
    case 'pine': case 'snowpine':
      return '<polygon points="' + x + ',' + (y - s * 1.5) + ' ' + (x - s * 0.9) + ',' + (y + s * 0.6) + ' ' + (x + s * 0.9) + ',' + (y + s * 0.6) + '" fill="' + f + '"/>';
    case 'palm':
      return '<path d="M' + x + ' ' + (y + s * 0.8) + ' q' + (s * 0.2) + ' ' + (-s) + ' 0 ' + (-s * 1.4) + '" stroke="#9c7a4a" stroke-width="' + (s * 0.3) + '" fill="none"/>' +
        '<path d="M' + x + ' ' + (y - s * 0.6) + ' l' + (-s) + ' ' + (-s * 0.5) + ' M' + x + ' ' + (y - s * 0.6) + ' l' + s + ' ' + (-s * 0.5) + ' M' + x + ' ' + (y - s * 0.6) + ' l0 ' + (-s * 0.9) + '" stroke="' + f + '" stroke-width="' + (s * 0.28) + '" fill="none"/>';
    case 'acacia':
      return '<rect x="' + (x - s * 0.15) + '" y="' + (y - s * 0.4) + '" width="' + (s * 0.3) + '" height="' + (s * 1.1) + '" fill="#8a5a3b"/>' +
        '<ellipse cx="' + x + '" cy="' + (y - s * 0.55) + '" rx="' + (s * 1.15) + '" ry="' + (s * 0.35) + '" fill="' + f + '"/>';
    case 'baobab':
      return '<path d="M' + (x - s * 0.5) + ' ' + (y + s * 0.7) + ' L' + (x - s * 0.28) + ' ' + (y - s * 0.5) + ' L' + (x + s * 0.28) + ' ' + (y - s * 0.5) + ' L' + (x + s * 0.5) + ' ' + (y + s * 0.7) + ' Z" fill="#8a5a3b"/>' +
        '<circle cx="' + x + '" cy="' + (y - s * 0.75) + '" r="' + (s * 0.5) + '" fill="' + f + '"/>';
    default:
      return '<rect x="' + (x - s * 0.12) + '" y="' + y + '" width="' + (s * 0.24) + '" height="' + (s * 0.7) + '" fill="#7a5230"/>' +
        '<circle cx="' + x + '" cy="' + (y - s * 0.35) + '" r="' + (s * 0.75) + '" fill="' + f + '"/>';
  }
}
function renderMap() {
  var wrap = document.getElementById('gi-map-svg');
  if (!wrap) return;
  var elo = globalElo();
  var W = 640, H = 440;
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' +
    '<defs><radialGradient id="giSea" cx="50%" cy="45%" r="75%">' +
    '<stop offset="0%" stop-color="#8fd8d2"/><stop offset="100%" stop-color="#3f8fae"/></radialGradient></defs>' +
    '<rect width="' + W + '" height="' + H + '" fill="url(#giSea)"/>';
  var wr = mulberry32(7);
  for (var i = 0; i < 26; i++) {
    var wx = wr() * W, wy = wr() * H;
    svg += '<path d="M' + wx + ' ' + wy + ' q6 -4 12 0" stroke="rgba(255,255,255,.35)" stroke-width="2" fill="none"/>';
  }
  /* dashed trade routes between neighboring islands */
  for (var r2 = 0; r2 < BIOMES.length - 1; r2++) {
    var pa = BIOMES[r2].mapPos, pb = BIOMES[r2 + 1].mapPos;
    var mx = (pa.x + pb.x) / 2 + (r2 % 2 ? 26 : -26);
    var my = (pa.y + pb.y) / 2 + (r2 % 2 ? -18 : 18);
    svg += '<path d="M' + pa.x + ' ' + pa.y + ' Q' + mx + ' ' + my + ' ' + pb.x + ' ' + pb.y + '" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="2.2" stroke-dasharray="2 9" stroke-linecap="round"/>';
  }
  for (var b = 0; b < BIOMES.length; b++) {
    var bio = BIOMES[b];
    var unlocked = biomeUnlocked(bio.id, elo);
    var active = grove.activeBiome === bio.id;
    var p = bio.mapPos;
    var ground = unlocked ? hex(bio.ground) : '#9aa7b0';
    var sand = unlocked ? hex(bio.sand) : '#b9c2c9';
    svg += '<g class="gi-node' + (unlocked ? '' : ' gi-node-locked') + '" data-id="' + bio.id + '">';
    if (active) svg += '<circle class="gi-ring" cx="' + p.x + '" cy="' + p.y + '" r="' + (p.r + 9) + '" fill="none" stroke="#ffffff" stroke-width="3.5"/>';
    svg += '<ellipse cx="' + p.x + '" cy="' + (p.y + 4) + '" rx="' + (p.r + 10) + '" ry="' + (p.r * 0.72 + 8) + '" fill="' + sand + '" opacity=".9"/>' +
      '<ellipse cx="' + p.x + '" cy="' + p.y + '" rx="' + p.r + '" ry="' + (p.r * 0.72) + '" fill="' + ground + '"/>';
    if (unlocked) {
      svg += mapGlyph(bio.species[0], p.x - p.r * 0.38, p.y + p.r * 0.08, bio.foliage[0], p.r * 0.3);
      if (bio.species[1]) svg += mapGlyph(bio.species[1], p.x + p.r * 0.34, p.y + p.r * 0.14, bio.foliage[1] || bio.foliage[0], p.r * 0.24);
      svg += '<text x="' + p.x + '" y="' + (p.y + p.r * 0.72 + 18) + '" text-anchor="middle" font-family="sans-serif" font-weight="600" font-size="14" fill="#ffffff" style="text-shadow:0 1px 3px rgba(0,0,0,.4)">' + bio.icon + ' ' + bio.name + '</text>';
      if (active) svg += '<text x="' + (p.x + p.r + 14) + '" y="' + (p.y - p.r * 0.5) + '" text-anchor="start" font-size="20">\u26f5</text>';
    } else {
      svg += '<text x="' + p.x + '" y="' + (p.y + 6) + '" text-anchor="middle" font-size="18">\ud83d\udd12</text>' +
        '<text x="' + p.x + '" y="' + (p.y + p.r * 0.72 + 18) + '" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="12" fill="rgba(255,255,255,.85)">' + bio.name + ' \u00b7 ' + bio.unlockElo + ' ELO</text>';
    }
    svg += '</g>';
  }
  svg += '</svg>';
  wrap.innerHTML = svg;
  var eloFoot = document.getElementById('gi-map-elo');
  if (eloFoot) eloFoot.textContent = elo + ' ELO - tap an unlocked island to travel';
  var nodes = wrap.querySelectorAll('.gi-node:not(.gi-node-locked)');
  for (var n = 0; n < nodes.length; n++) {
    nodes[n].addEventListener('click', function () { travel(this.getAttribute('data-id')); closeMap(); });
  }
}
var lastMapSig = '';
function renderMapIfOpen() {
  var ov = document.getElementById('gi-map-overlay');
  if (!ov || !ov.classList.contains('open')) return;
  var s = globalElo() + '|' + grove.activeBiome;
  if (s !== lastMapSig) { lastMapSig = s; renderMap(); }
}
function openMap() {
  var ov = document.getElementById('gi-map-overlay');
  if (!ov) return;
  renderMap();
  ov.classList.add('open');
}
function closeMap() {
  var ov = document.getElementById('gi-map-overlay');
  if (ov) ov.classList.remove('open');
}

/* ==========================================================================
   MOUNTING - dashboard card + body chrome (identical DOM contract to v1)
   -------------------------------------------------------------------------- */
function mountCard() {
  var card = document.querySelector('#view-dashboard .dash-card-momentum');
  if (!card) {
    var all = document.querySelectorAll('#view-dashboard .dash-card');
    for (var i = 0; i < all.length; i++) {
      var tt = all[i].querySelector('.box-title');
      if (tt && /momentum/i.test(tt.textContent)) { card = all[i]; break; }
    }
  }
  if (!card) { warn('Momentum card not found; Grove not mounted.'); return; }
  var kids = Array.prototype.slice.call(card.children);
  kids.forEach(function (c) {
    if (c.id === 'gi-host') return;
    var cl = c.className || '';
    if (/bento-handle|bento-handle-v|bento-card-ctrls|bento-scroll/.test(cl)) return;
    c.classList.add('gi-orig');
  });
  card.classList.add('gi-island-active');
  var host = el('div', { id: 'gi-host', html:
    '<div class="gi-canvas-wrap"><canvas id="gi-card"></canvas><div class="gi-empty" id="gi-empty">Answer questions to grow a tree \ud83c\udf31</div></div>' +
    '<div class="gi-card-hud">' +
    '<div class="gi-chip" id="gi-chip">\ud83c\udf32</div>' +
    '<div class="gi-card-meta">' +
    '<div class="gi-name" id="gi-name">Temperate Forest</div>' +
    '<div class="gi-sub" id="gi-sub">1200 ELO</div>' +
    '</div>' +
    '<div class="gi-species" id="gi-species">\ud83c\udf32 Pine</div>' +
    '<div class="gi-next-wrap"><div class="gi-bar"><i id="gi-bar"></i></div><span class="gi-next" id="gi-next"></span></div>' +
    '<div class="gi-card-btns">' +
    '<button class="gi-ibtn gi-btn-badge" id="gi-btn-map" title="Archipelago">\ud83d\uddfa<span class="gi-badge" id="gi-unlock-badge">1/5</span></button>' +
    '<button class="gi-ibtn" id="gi-btn-store" title="Store">\ud83d\uded2</button>' +
    '<button class="gi-ibtn" id="gi-btn-full" title="Full explorer">\u2922</button>' +
    '</div>' +
    '</div>' });
  card.appendChild(host);
  var cvs = document.getElementById('gi-card');
  cvs.title = 'Open the Grove Islands';
  cvs.setAttribute('tabindex', '0');
  cvs.setAttribute('role', 'button');
  cvs.setAttribute('aria-label', 'Open full Grove Islands explorer');
  cvs.addEventListener('click', function (e) { e.stopPropagation(); openFull(); });
  cvs.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFull(); } });
  document.getElementById('gi-btn-map').addEventListener('click', function (e) { e.stopPropagation(); openMap(); });
  document.getElementById('gi-btn-store').addEventListener('click', function (e) { e.stopPropagation(); openStore(); });
  document.getElementById('gi-btn-full').addEventListener('click', function (e) { e.stopPropagation(); openFull(); });

  try {
    var counterObs = new MutationObserver(function () {
      requestAnimationFrame(function () {
        attributeSinceSnapshot();
        var t = totalToday();
        if (lastTotal < 0) lastTotal = t;
        else if (t > lastTotal) lastTotal = t;
        maybeExpand();
        updateHUD();
      });
    });
    ['physics-count', 'chemistry-count', 'maths-count'].forEach(function (id) {
      var e = document.getElementById(id);
      if (e) counterObs.observe(e, { childList: true, subtree: true, characterData: true });
    });
  } catch (e) {}
  window.__groveCard = { card: card, host: host };
}

function showFallbackPoster() {
  try {
    var wrap = document.querySelector('#gi-host .gi-canvas-wrap');
    if (!wrap || wrap.querySelector('.gi-fallback')) return;
    var b = biomeById(grove.activeBiome);
    var d = el('div', { class: 'gi-fallback' });
    d.innerHTML = '<div class="gi-fallback-art">' + b.icon + '</div>' +
      '<div class="gi-fallback-txt"><b>Skyborne Groves</b><span>WebGL unavailable \u2014 your trees keep growing.</span></div>';
    d.style.background = 'linear-gradient(180deg,' + hex(b.sky.top) + ',' + hex(b.sky.horizon) + ')';
    wrap.appendChild(d);
  } catch (e) {}
}

function buildChrome() {
  var frag = document.createDocumentFragment();
  frag.appendChild(el('div', { id: 'gi-toasts', html: '' }));
  frag.appendChild(el('div', { id: 'gi-float', html: '' }));
  frag.appendChild(el('div', { id: 'gi-fade', html: '' }));
  frag.appendChild(el('div', { id: 'gi-full-overlay', class: 'gi-full-overlay', html:
    '<div class="gi-full-shell">' +
    '<canvas id="gi-full-canvas"></canvas>' +
    '<div class="gi-full-top">' +
    '<div class="gi-full-brand">\ud83c\udfdd Grove Islands</div>' +
    '<div class="gi-full-ctrls">' +
    '<span class="gi-elo-pill" id="gi-full-elo">1200</span>' +
    '<button class="gi-fbtn" id="gi-full-store" title="Store">\ud83d\uded2</button>' +
    '<button class="gi-fbtn" id="gi-full-map" title="Archipelago">\ud83d\uddfa</button>' +
    '<button class="gi-fbtn" id="gi-full-close" title="Close">\u2715</button>' +
    '</div></div>' +
    '<div class="gi-full-periods" id="gi-full-periods">' +
    '<button data-period="today">Today</button>' +
    '<button data-period="yesterday">Yesterday</button>' +
    '<button data-period="week">Week</button>' +
    '<button data-period="month">Month</button>' +
    '<button data-period="year">Year</button>' +
    '<button data-period="all" class="active">All</button>' +
    '</div>' +
    '<div class="gi-full-hud">' +
    '<div class="gi-chip" id="gi-full-chip">\ud83c\udf32</div>' +
    '<div class="gi-card-meta">' +
    '<div class="gi-name" id="gi-full-name">Temperate Forest</div>' +
    '<div class="gi-sub" id="gi-full-sub">Home island \u00b7 pines & oaks</div>' +
    '</div>' +
    '<div class="gi-full-stat">\ud83c\udf33 <b id="gi-full-trees">0</b> trees \u00b7 <span id="gi-full-meta">All time</span></div>' +
    '</div>' +
    '</div>' }));
  frag.appendChild(el('div', { id: 'gi-store-overlay', class: 'gi-modal-overlay', html:
    '<div class="gi-modal gi-store-panel">' +
    '<button class="gi-mclose" id="gi-store-close">\u2715</button>' +
    '<h2 class="gi-mtitle">The Grove Market</h2>' +
    '<div class="gi-elo-strip">\u2b50 <b id="gi-store-elo">1200</b> ELO \u2014 reach the requirement to unlock</div>' +
    '<div class="gi-tabs">' +
    '<button class="gi-tab-btn gi-tab-on" data-tab="islands">\ud83c\udfdd\ufe0f Islands</button>' +
    '<button class="gi-tab-btn" data-tab="trees">\ud83c\udf33 Trees</button>' +
    '<button class="gi-tab-btn" data-tab="subjects">\ud83d\udcd0 Subjects</button>' +
    '</div>' +
    '<div class="gi-tab-body" id="gi-tab-islands"></div>' +
    '<div class="gi-tab-body" id="gi-tab-trees" style="display:none"></div>' +
    '<div class="gi-tab-body" id="gi-tab-subjects" style="display:none"></div>' +
    '</div>' }));
  frag.appendChild(el('div', { id: 'gi-map-overlay', class: 'gi-modal-overlay', html:
    '<div class="gi-modal gi-map-panel">' +
    '<button class="gi-mclose" id="gi-map-close">\u2715</button>' +
    '<h2 class="gi-mtitle">The Study Archipelago</h2>' +
    '<div class="gi-msub">Islands unlock as your global ELO climbs. Click an unlocked island to travel.</div>' +
    '<div class="gi-map-wrap" id="gi-map-svg"></div>' +
    '<div class="gi-map-foot"><span id="gi-map-elo"></span><button class="gi-reset" id="gi-reset">Reset grove</button></div>' +
    '</div>' }));
  document.body.appendChild(frag);
  document.getElementById('gi-store-close').addEventListener('click', closeStore);
  document.getElementById('gi-map-close').addEventListener('click', closeMap);
  document.getElementById('gi-full-close').addEventListener('click', closeFull);
  document.getElementById('gi-full-store').addEventListener('click', openStore);
  document.getElementById('gi-full-map').addEventListener('click', openMap);
  document.getElementById('gi-full-periods').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    setViewPeriod(b.getAttribute('data-period') || 'all');
  });
  /* v1 bug fix: also clear the IndexedDB mirror, or restoreFromIDB()
     resurrects the grove right after the wipe */
  document.getElementById('gi-reset').addEventListener('click', function () {
    try { localStorage.removeItem(LS_GROVE); } catch (e) {}
    try { if (window._idbMirror) window._idbMirror.set(LS_GROVE, null); } catch (e2) {}
    grove = defaultGrove();
    location.reload();
  });
  var tabs = document.querySelectorAll('.gi-tab-btn');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function () {
      var t = this.getAttribute('data-tab');
      document.querySelectorAll('.gi-tab-btn').forEach(function (bb) { bb.classList.toggle('gi-tab-on', bb === this); }.bind(this));
      document.getElementById('gi-tab-islands').style.display = t === 'islands' ? '' : 'none';
      document.getElementById('gi-tab-trees').style.display = t === 'trees' ? '' : 'none';
      document.getElementById('gi-tab-subjects').style.display = t === 'subjects' ? '' : 'none';
    });
  }
  ['gi-store-overlay', 'gi-map-overlay'].forEach(function (id) {
    document.getElementById(id).addEventListener('click', function (e) {
      if (e.target.id === id) { if (id === 'gi-store-overlay') closeStore(); else closeMap(); }
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var so = document.getElementById('gi-store-overlay');
    var mo = document.getElementById('gi-map-overlay');
    if (so && so.classList.contains('open')) closeStore();
    if (mo && mo.classList.contains('open')) closeMap();
    if (fullOpen) closeFull();
  });
}

/* ==========================================================================
   RENDER LOOP - frame budgeted, adaptive resolution, truly idle-cancelled
   -------------------------------------------------------------------------- */
var miniAz = 0;
var lastProc = 0, emaMs = 16, frameCount = 0;
function adaptDPR(dtSec) {
  emaMs = emaMs * 0.95 + (dtSec * 1000) * 0.05;
  frameCount++;
  if (frameCount % 120 !== 0) return;
  if (emaMs > 26 && dprTier < DPR_TIERS.length - 1) { dprTier++; applyTier(); }
  else if (emaMs < 13 && dprTier > 0) { dprTier--; applyTier(); }
}
function applyTier() {
  if (!fullRenderer) return;
  fullRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_TIERS[dprTier]));
  sizeCanvases();
}
function loop(now) {
  /* TRUE idle: cancel rAF entirely instead of v1's wake-every-frame no-op */
  if (document.hidden || engineFailed || !built || (!fullOpen && !miniVisible)) { raf = null; return; }
  var interval = fullOpen ? 16 : 34;
  if (now - lastProc < interval) { raf = requestAnimationFrame(loop); return; }
  lastProc = now;
  var dt = Math.min(clock.getDelta(), 0.05);
  var t = clock.elapsedTime;
  if (world) {
    world.treeField.update(dt, t);
    for (var a = 0; a < world.animals.length; a++) {
      var an = world.animals[a];
      if (an.userData.tick) an.userData.tick(t, dt, world.slots, motionOK());
    }
    if (motionOK()) world.particles.update(dt, t);
    updateClouds(world, dt);
    updateBirds(world, t, dt);
    updateFireflies(world, t);
  }
  if (MAT.tree && MAT.tree.userData.shader) MAT.tree.userData.shader.uniforms.uTime.value = t;
  if (skyMat) skyMat.uniforms.uTime.value = t;
  if (waterMesh && motionOK()) waterMesh.position.y = SEA_Y + Math.sin(t * 0.9) * 0.05;
  var nowMs = performance.now();
  if (nowMs - lastTODPoll > 30000) applyEnvironment(biomeById(grove.activeBiome));
  if (fullOpen && fullRenderer && fullCam && fullOrbit) {
    fullOrbit.tick(dt);
    fullRenderer.render(scene, fullCam);
    adaptDPR(dt);
  } else if (miniRenderer && miniCam && miniVisible) {
    if (motionOK()) miniAz += dt * 0.12;
    var cd = clamp((world ? world.radius : ISLAND_R) * 1.25, 13.5, 60);
    miniCam.position.set(Math.sin(miniAz) * cd, 7.5, Math.cos(miniAz) * cd);
    miniCam.lookAt(0, 2.1, 0);
    miniRenderer.render(scene, miniCam);
  }
  raf = requestAnimationFrame(loop);
}
function ensureLoop() {
  if (raf != null || !built || engineFailed) return;
  lastProc = 0;
  if (clock) clock.getDelta();
  raf = requestAnimationFrame(loop);
}
function detectMini() {
  var dash = document.getElementById('view-dashboard');
  var card = document.getElementById('gi-host');
  var wasVisible = miniVisible;
  miniVisible = !!(card && card.offsetParent !== null && dash && dash.classList.contains('active')) && !fullOpen;
  if (miniVisible) ensureLoop();
  else if (wasVisible && !fullOpen) { /* leaving the dashboard: loop self-cancels */ }
}

/* ==========================================================================
   BOOT
   -------------------------------------------------------------------------- */
function setupThemeListeners() {
  document.addEventListener('jeemax:modechange', function () {
    if (built && scene) applyEnvironment(biomeById(grove.activeBiome));
  });
}
function boot() {
  buildChrome();
  mountCard();
  seenDay = todayKey();
  ensureThree().then(async function () {
    await restoreFromIDB();
    var firstRun = !localStorage.getItem(LS_GROVE);   /* AFTER the IDB restore (v1 fix) */
    initScene();
    if (engineFailed || !scene) {
      warn('Grove runs in static fallback mode this session.');
      return;
    }
    var bio = biomeById(grove.activeBiome);
    applyEnvironment(bio);
    buildWorld(bio, viewFor(bio.id, worldPeriod));
    syncTrees(true);
    ensureLoop();
    sizeCanvases();
    detectMini();
    tick(true);
    setInterval(function () { tick(false); ensureLoop(); }, 1500);
    setInterval(detectMini, 800);
    updateHUD();
    renderMapIfOpen();
    setupThemeListeners();
    try {
      var io = new IntersectionObserver(function () { detectMini(); }, { threshold: 0.02 });
      io.observe(document.getElementById('gi-host'));
    } catch (e) {}
    if (firstRun) setTimeout(function () {
      toast('\ud83c\udf31 Welcome to the Grove Islands! Answer questions to grow trees. Unlock islands & species in the \ud83d\uded2 store by raising your ELO.');
    }, 900);
  }).catch(function (e) {
    if (!document.getElementById('gi-host')) {
      warn('Grove host element (#gi-host/#gi-card) not present - mini island skipped.');
      return;
    }
    engineFailed = true;
    showFallbackPoster();
    warn('Could not load the 3D engine: ' + (e && e.message ? e.message : e));
  });
  window.addEventListener('resize', sizeCanvases);
  window.addEventListener('visibilitychange', function () {
    if (!document.hidden) { tick(false); ensureLoop(); }
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

window.__groveIslands = {
  travel: travel,
  openStore: openStore,
  openMap: openMap,
  openFull: openFull,
  closeFull: closeFull,
  state: function () { return grove; },
  elo: globalElo,
  trees: function () { return world ? world.treeField.entries.size : 0; },
  view: function () { return { period: worldPeriod, slots: world ? world.slots.length : 0, agg: world ? periodCount(world.biomeId, worldPeriod) : null }; },
  __debug: function () {
    var types = {};
    if (scene) scene.children.forEach(function (o) { var k = o.type + (o.isInstancedMesh ? ':instanced' : ''); types[k] = (types[k] || 0) + 1; });
    var wgKids = [];
    if (world) world.group.children.forEach(function (o) {
      wgKids.push(o.type + (o.isInstancedMesh ? '(' + o.count + ')' : '') + (o.userData && o.userData.tick ? '[animal]' : ''));
    });
    var renderer = (fullOpen && fullRenderer) ? fullRenderer : miniRenderer;
    return {
      built: built, engineFailed: engineFailed, night: curNight,
      sceneChildren: scene ? scene.children.length : 0,
      sceneTypes: types,
      worldRadius: world ? world.radius : null,
      worldGroupChildren: wgKids,
      miniPos: miniCam ? { x: +miniCam.position.x.toFixed(1), y: +miniCam.position.y.toFixed(1), z: +miniCam.position.z.toFixed(1) } : null,
      tri: renderer ? renderer.info.render.triangles : -1,
      calls: renderer ? renderer.info.render.calls : -1
    };
  }
};
window.__giRefs = function () { return { scene: scene, world: world, miniCam: miniCam, fullCam: fullCam, waterMesh: waterMesh, miniRenderer: miniRenderer, fullRenderer: fullRenderer }; };
})();
