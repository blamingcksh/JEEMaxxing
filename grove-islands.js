/* grove-islands.js — Grove Islands: ELO-unlocked study archipelago (replaces forest-island.js + forest-island-full.js) */
(function () {
'use strict';
if (window.__groveIslandsInit) return; window.__groveIslandsInit = true;

var LS_GROVE = 'jeemax_grove_v1';
var LS_DAILY = 'jeemax_forest_daily_v1';
var MIN_SLOTS = 6;
var MAX_SLOTS = 240;
var MIN_TREE_SPACING = 2.6;   // min centre-to-centre gap so trees read as individuals
var SLOT_BASE = 2.2;          // inner radius of the planting spiral (kept clear of the centre)
var STAGES = ['Sapling', 'Young tree', 'Mature tree'];
var STAGE_SCALE = [0.45, 0.72, 1.0];
var STAGES_PER_TREE = 3;
var PERIOD_LABELS = { today: 'Today', yesterday: 'Yesterday', week: 'Last 7 days', month: 'Last 30 days', year: 'Last 365 days', all: 'All time' };

function toast(msg, actionLabel, onAction) {
  try {
    var wrap = document.getElementById('gi-toasts');
    if (!wrap) return;
    var t = document.createElement('div');
    t.className = 'gi-toast';
    t.innerHTML = '<span>' + msg + '</span>';
    if (actionLabel) {
      var b = document.createElement('button');
      b.textContent = actionLabel;
      b.onclick = function () { try { onAction && onAction(); } catch (e) {} t.remove(); };
      t.appendChild(b);
    }
    wrap.appendChild(t);
    setTimeout(function () {
      t.classList.add('gi-toast-out');
      setTimeout(function () { t.remove(); }, 520);
    }, 5200);
  } catch (e) {}
}
function warn(m) { console.warn('[grove-islands]', m); try { toast('⚠ ' + m); } catch (e) {} }
function el(tag, a) {
  var n = document.createElement(tag);
  if (a) for (var k in a) {
    if (k === 'html') n.innerHTML = a[k];
    else if (k === 'class') n.className = a[k];
    else if (k === 'style') n.style.cssText = a[k];
    else n.setAttribute(k, a[k]);
  }
  return n;
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { var h = 2166136261; s = String(s || ''); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function _giYmd(d) { var n = d.getMonth() + 1, day = d.getDate(); return d.getFullYear() + '-' + (n < 10 ? '0' + n : n) + '-' + (day < 10 ? '0' + day : day); }
function todayKey() { return _giYmd(new Date()); }
function motionOK() {
  try {
    return !document.documentElement.classList.contains('fx-effects-off') && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { return true; }
}
function easeOutBack(x) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
function normSub(s) { s = (s || '').toString().toLowerCase().trim(); return (s === 'math' || s === 'mathematics') ? 'maths' : s; }

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
    particles: { mode: 'rise', tex: 'glow', colors: [0xffe9a0, 0xfff6d8], count: 120, size: 0.16, speed: 0.3, sway: 0.5 },
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
    particles: { mode: 'fall', tex: 'petal', colors: [0xff9eb5, 0xffc7d6, 0xffb3c6], count: 140, size: 0.22, speed: 0.55, sway: 0.9 },
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
    particles: { mode: 'fall', tex: 'leaf', colors: [0xe2572b, 0xf2a33c, 0xc6452a, 0xe8c547], count: 170, size: 0.26, speed: 0.85, sway: 1.3 },
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
    particles: { mode: 'fall', tex: 'soft', colors: [0xffffff, 0xeaf6ff], count: 280, size: 0.15, speed: 0.95, sway: 0.5 },
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
    particles: { mode: 'drift', tex: 'soft', colors: [0xe8c98a, 0xd9b36c], count: 120, size: 0.15, speed: 0.7, sway: 0.4 },
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
var grove;
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
  try { localStorage.setItem(LS_GROVE, JSON.stringify(grove)); } catch (e) {}
  // Permanent IndexedDB mirror so the grove's per-day tree counts survive wipes.
  try { if (window._idbMirror) window._idbMirror.set(LS_GROVE, grove); } catch (e) {}
}
grove = loadGrove();

/* Which tree a solved question of a given subject plants. Falls back to the
   first unlocked species if the user's chosen one is still locked. */
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
function dayOffsetKey(n) { var d = new Date(); d.setDate(d.getDate() - n); return _giYmd(d); }

var AC = null;
function audio() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } return AC; }
function tone(freq, dur, type, gain, delay) {
  var ac = audio(); if (!ac) return;
  try {
    var t0 = ac.currentTime + (delay || 0);
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain || 0.07, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.06);
  } catch (e) {}
}
var sndPlant = function () { tone(392, 0.1, 'sine', 0.05); };
var sndUnlock = function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.2, 'sine', 0.07, i * 0.11); }); };
var sndTravel = function () { tone(330, 0.14, 'sine', 0.05); tone(494, 0.18, 'sine', 0.05, 0.1); };
window.addEventListener('pointerdown', function () { var ac = audio(); if (ac && ac.state === 'suspended') ac.resume(); }, { once: false });

var THREE = null, threePromise = null;
function importWithTimeout(url, ms) {
  return new Promise(function (res, rej) {
    var done = false;
    var to = setTimeout(function () { if (!done) { done = true; rej(new Error('cdn timeout: ' + url)); } }, ms || 8000);
    import(url).then(function (m) { if (!done) { done = true; clearTimeout(to); res(m); } }).catch(function (e) { if (!done) { done = true; clearTimeout(to); rej(e); } });
  });
}
function ensureThree() {
  if (THREE) return Promise.resolve(THREE);
  if (threePromise) return threePromise;
  var urls = ['https://esm.sh/three@0.160.0', 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', 'https://unpkg.com/three@0.160.0/build/three.module.js'];
  function t(i) {
    return new Promise(function (res, rej) {
      if (i >= urls.length) return rej(new Error('three cdn fail'));
      importWithTimeout(urls[i]).then(function (m) { THREE = m; res(m); }).catch(function () { t(i + 1).then(res, rej); });
    });
  }
  threePromise = t(0);
  return threePromise;
}

var scene = null, miniRenderer = null, fullRenderer = null, miniCam = null, fullCam = null;
var skyMat = null, waterMat = null, sun = null, hemi = null;
var world = null, built = false;
var clock = null, raf = null;
var miniVisible = false, fullOpen = false, miniAz = 0;
var fullOrbit = null;
var viewPeriod = 'today', fullPeriod = 'all';

function initScene() {
  var card = document.getElementById('gi-card');
  if (!card) return;
  miniRenderer = new THREE.WebGLRenderer({ canvas: card, antialias: true });
  miniRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  miniRenderer.shadowMap.enabled = true;
  miniRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  miniRenderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xe6f4ea, 55, 190);

  miniCam = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  miniCam.position.set(14, 9.5, 15.5);

  hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5d8f68, 1.05);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xfff4d6, 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -18; sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  scene.add(sun); scene.add(sun.target);

  skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(0x74b9e4) }, uHorizon: { value: new THREE.Color(0xe6f4ea) } },
    vertexShader: 'varying vec3 vP; void main(){ vP=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 uTop,uHorizon; varying vec3 vP;\n    void main(){ float h=normalize(vP).y; float t=smoothstep(-.08,.5,h);\n    gl_FragColor=vec4(mix(uHorizon,uTop,t),1.); }'
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(260, 24, 16), skyMat));

  waterMat = new THREE.ShaderMaterial({
    transparent: false, fog: false,
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x2c7da6) },
      uShallow: { value: new THREE.Color(0x7fd4c4) },
      uSky: { value: new THREE.Color(0xe6f4ea) }
    },
    vertexShader: 'uniform float uTime; varying vec2 vXZ;\n    void main(){\n      vec4 wp = modelMatrix*vec4(position,1.);\n      float w = sin(wp.x*.35+uTime*1.2)*.16 + cos(wp.z*.3+uTime*.9)*.16 + sin((wp.x+wp.z)*.14+uTime*.5)*.1;\n      wp.y += w; vXZ = wp.xz;\n      gl_Position = projectionMatrix*viewMatrix*wp;\n    }',
    fragmentShader: 'uniform float uTime; uniform vec3 uDeep,uShallow,uSky; varying vec2 vXZ;\n    void main(){\n      float d = length(vXZ);\n      float m = smoothstep(8.,55.,d);\n      vec3 col = mix(uShallow,uDeep,m);\n      float rip = sin(d*.9 - uTime*2.)*.5+.5;\n      col += rip*.045*(1.-m);\n      float sp = pow(sin(vXZ.x*2.1+uTime*3.)*sin(vXZ.y*1.7-uTime*2.3)*.5+.5, 9.)*.22;\n      col += sp;\n      col = mix(col, uSky, smoothstep(58.,88.,d));\n      gl_FragColor = vec4(col,1.);\n    }'
  });
  var water = new THREE.Mesh(new THREE.CircleGeometry(90, 72), waterMat);
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  fullCam = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  fullOrbit = makeOrbit(fullCam, { x: 0, y: 2.2, z: 0 }, 20);

  clock = new THREE.Clock();
  try {
    new ResizeObserver(sizeCanvases).observe(card);
  } catch (e) {}
  built = true;
}

function makeOrbit(cam, target, dist) {
  var o = {
    cam: cam, tx: target.x, ty: target.y, tz: target.z, dist: dist,
    az: Math.atan2(14, 15.5), pol: Math.acos(clamp((9.5 - target.y) / dist, 0.1, 1.4)),
    auto: true, idle: null, ptrs: new Map(), pinch0: null
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
  o.tick = function (dt) { if (o.auto && motionOK()) { o.az += dt * 0.07; o.apply(); } };
  o.apply();
  return o;
}
function bindOrbit(canvas, o) {
  canvas.addEventListener('pointerdown', function (e) { try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); } catch (err) {} o.ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (o.ptrs.size === 2) { var ps = Array.from(o.ptrs.values()); o.pinch0 = Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1]); } o.wake(); });
  canvas.addEventListener('pointermove', function (e) {
    if (!o.ptrs.has(e.pointerId)) return;
    var p = o.ptrs.get(e.pointerId);
    var dx = e.clientX - p[0], dy = e.clientY - p[1];
    o.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (o.ptrs.size === 1) {
      o.az -= dx * 0.006;
      o.pol = clamp(o.pol - dy * 0.005, 0.35, 1.42);
    } else if (o.ptrs.size === 2) {
      var ps2 = Array.from(o.ptrs.values());
      var d = Math.hypot(ps2[0][0] - ps2[1][0], ps2[0][1] - ps2[1][1]);
      if (o.pinch0 > 0) o.dist = clamp(o.dist * (o.pinch0 / Math.max(1, d)), 9, 30);
      o.pinch0 = d;
    }
    o.apply(); o.wake();
  });
  function up(e) { o.ptrs.delete(e.pointerId); if (o.ptrs.size < 2) o.pinch0 = null; o.wake(); }
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); o.dist = clamp(o.dist * (e.deltaY > 0 ? 1.08 : 0.93), 9, 30); o.apply(); o.wake(); }, { passive: false });
}

var GEO = {}, MAT = {}, TEX = {};
function cGeo(key, make) { if (!GEO[key]) GEO[key] = make(); return GEO[key]; }
function cMat(hex, extra) {
  var k = hex + '|' + (extra ? JSON.stringify(extra) : '');
  if (!MAT[k]) MAT[k] = new THREE.MeshLambertMaterial(Object.assign({ color: hex, flatShading: true }, extra || {}));
  return MAT[k];
}
function mesh(geo, mat, shadows) {
  var m = new THREE.Mesh(geo, mat);
  if (shadows !== false) { m.castShadow = true; m.receiveShadow = true; }
  return m;
}
function texCanvas(draw) {
  var c = document.createElement('canvas'); c.width = c.height = 64;
  draw(c.getContext('2d'));
  var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function getTex(name) {
  if (TEX[name]) return TEX[name];
  if (name === 'soft' || name === 'glow') {
    var soft = name === 'soft';
    TEX[name] = texCanvas(function (g) {
      var r = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(soft ? 0.9 : 0.55, 'rgba(255,255,255,' + (soft ? 0.85 : 0.9) + ')');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    });
  } else if (name === 'leaf') {
    TEX[name] = texCanvas(function (g) {
      g.translate(32, 32); g.rotate(0.6);
      g.fillStyle = '#fff';
      g.beginPath(); g.ellipse(0, 0, 24, 13, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(-22, 0); g.lineTo(22, 0); g.stroke();
    });
  } else if (name === 'petal') {
    TEX[name] = texCanvas(function (g) {
      g.translate(32, 32); g.rotate(-0.4);
      g.fillStyle = '#fff';
      g.beginPath(); g.ellipse(0, 0, 22, 14, 0, 0, Math.PI * 2); g.fill();
    });
  }
  return TEX[name];
}

var SPECIES = {
  pine: function (ctx) {
    var g = new THREE.Group();
    var trunk = mesh(cGeo('trunkA', function () { return new THREE.CylinderGeometry(0.12, 0.19, 0.9, 6); }), cMat(ctx.trunk));
    trunk.position.y = 0.45; g.add(trunk);
    var tiers = [[0.95, 1.25, 1.42, 0], [0.72, 1.05, 2.14, 1], [0.5, 0.9, 2.8, 0]];
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      var c = mesh(cGeo('cone' + t[0] + t[1], function () { return new THREE.ConeGeometry(t[0], t[1], 7); }), cMat(ctx.foliage[t[3] % ctx.foliage.length]));
      c.position.y = t[2]; g.add(c);
    }
    return g;
  },
  snowpine: function (ctx) {
    var g = SPECIES.pine({ foliage: [0x3b6b5a, 0x2f5a4b], trunk: ctx.trunk });
    var tiers = [[0.95, 1.42], [0.72, 2.14], [0.5, 2.8]];
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      var s = mesh(cGeo('snowcap' + t[0], function () { return new THREE.ConeGeometry(t[0] * 0.88, 0.5, 7); }), cMat(0xf6fbff));
      s.position.y = t[1] + 0.34; g.add(s);
    }
    return g;
  },
  oak: function (ctx) {
    var g = new THREE.Group();
    var trunk = mesh(cGeo('trunkB', function () { return new THREE.CylinderGeometry(0.16, 0.25, 1.35, 6); }), cMat(ctx.trunk));
    trunk.position.y = 0.66; g.add(trunk);
    var blobs = [[0, 2.05, 0, 0.98, 0], [0.58, 1.7, 0.22, 0.66, 1], [-0.52, 1.82, -0.26, 0.6, 2]];
    for (var i = 0; i < blobs.length; i++) {
      var b2 = blobs[i];
      var b = mesh(cGeo('blob' + b2[3], function () { return new THREE.IcosahedronGeometry(b2[3], 0); }), cMat(ctx.foliage[b2[4] % ctx.foliage.length]));
      b.position.set(b2[0], b2[1], b2[2]); g.add(b);
    }
    return g;
  },
  broadleaf: function (ctx) {
    var g = new THREE.Group();
    var trunk = mesh(cGeo('trunkC', function () { return new THREE.CylinderGeometry(0.15, 0.23, 1.15, 6); }), cMat(ctx.trunk));
    trunk.position.y = 0.57; g.add(trunk);
    var big = mesh(cGeo('blobBig', function () { var geo = new THREE.IcosahedronGeometry(1.18, 0); geo.scale(1, 0.82, 1); return geo; }), cMat(ctx.foliage[0]));
    big.position.y = 2.12; g.add(big);
    var side = mesh(cGeo('blobSide', function () { return new THREE.IcosahedronGeometry(0.72, 0); }), cMat(ctx.foliage[1 % ctx.foliage.length]));
    side.position.set(0.62, 1.72, -0.3); g.add(side);
    for (var i = 0; i < 3; i++) {
      var f = mesh(cGeo('flowerDot', function () { return new THREE.IcosahedronGeometry(0.1, 0); }), cMat(0xff8fab), false);
      f.position.set(Math.cos(i * 2.1) * 0.8, 2.35 + (i % 2) * 0.25, Math.sin(i * 2.1) * 0.8);
      g.add(f);
    }
    return g;
  },
  palm: function (ctx) {
    var g = new THREE.Group();
    var x = 0;
    for (var i = 0; i < 5; i++) {
      var seg = mesh(cGeo('palmSeg', function () { return new THREE.CylinderGeometry(0.085, 0.12, 0.58, 6); }), cMat(ctx.trunk));
      seg.position.set(x, 0.3 + i * 0.52, 0); seg.rotation.z = -i * 0.05; g.add(seg);
      x -= 0.05 + i * 0.02;
    }
    var top = new THREE.Group(); top.position.set(x - 0.06, 2.85, 0); g.add(top);
    var frondGeo = cGeo('frond', function () { var geo = new THREE.ConeGeometry(0.17, 1.75, 4); geo.scale(1, 1, 0.4); geo.translate(0, 0.87, 0); return geo; });
    var frondMat = cMat(ctx.foliage[0]);
    for (var k = 0; k < 7; k++) {
      var piv = new THREE.Group(); piv.rotation.y = k / 7 * Math.PI * 2 + 0.3;
      var fr = new THREE.Mesh(frondGeo, frondMat); fr.castShadow = true;
      fr.rotation.z = 1.92; piv.add(fr); top.add(piv);
    }
    for (var k2 = 0; k2 < 3; k2++) {
      var nut = mesh(cGeo('coconut', function () { return new THREE.SphereGeometry(0.09, 6, 5); }), cMat(0x6e4a30));
      nut.position.set(Math.cos(k2 * 2.1) * 0.16, -0.14, Math.sin(k2 * 2.1) * 0.16); top.add(nut);
    }
    return g;
  },
  maple: function (ctx) {
    var g = new THREE.Group();
    var trunk = mesh(cGeo('trunkD', function () { return new THREE.CylinderGeometry(0.13, 0.21, 1.25, 6); }), cMat(ctx.trunk));
    trunk.position.y = 0.62; g.add(trunk);
    var blobs = [[0, 1.98, 0, 1.05, 0], [-0.52, 1.62, 0.36, 0.68, 1], [0.56, 2.32, -0.2, 0.55, 2]];
    for (var i = 0; i < blobs.length; i++) {
      var b2 = blobs[i];
      var b = mesh(cGeo('blob' + b2[3], function () { return new THREE.IcosahedronGeometry(b2[3], 0); }), cMat(ctx.foliage[b2[4] % ctx.foliage.length]));
      b.position.set(b2[0], b2[1], b2[2]); g.add(b);
    }
    return g;
  },
  birch: function (ctx, icy) {
    var g = new THREE.Group();
    var trunk = mesh(cGeo('birchTrunk', function () { return new THREE.CylinderGeometry(0.07, 0.11, 1.7, 6); }), cMat(0xe9e5d8));
    trunk.position.y = 0.85; g.add(trunk);
    var ringGeo = cGeo('birchRing', function () { return new THREE.CylinderGeometry(0.082, 0.082, 0.05, 6); });
    var ringMat = cMat(0x4a4038);
    [0.5, 1.0, 1.45].forEach(function (y) { var r = new THREE.Mesh(ringGeo, ringMat); r.position.y = y; g.add(r); });
    var c1 = mesh(cGeo('blobBirch', function () { return new THREE.IcosahedronGeometry(0.6, 0); }), cMat(icy ? 0xcde9ec : 0xe8c547));
    c1.position.y = 2.02; g.add(c1);
    var c2 = mesh(cGeo('blobBirchS', function () { return new THREE.IcosahedronGeometry(0.42, 0); }), cMat(icy ? 0xbcdde2 : 0xd9a93c));
    c2.position.set(0.36, 1.72, 0.2); g.add(c2);
    return g;
  },
  icebirch: function (ctx) { return SPECIES.birch(ctx, true); },
  baobab: function (ctx) {
    var g = new THREE.Group();
    var flare = mesh(cGeo('baobabFlare', function () { return new THREE.CylinderGeometry(0.95, 1.2, 0.4, 8); }), cMat(ctx.trunk));
    flare.position.y = 0.2; g.add(flare);
    var trunk = mesh(cGeo('baobabTrunk', function () { return new THREE.CylinderGeometry(0.5, 0.92, 1.75, 8); }), cMat(ctx.trunk));
    trunk.position.y = 1.2; g.add(trunk);
    for (var i = 0; i < 5; i++) {
      var piv = new THREE.Group(); piv.position.y = 2.05; piv.rotation.y = i / 5 * Math.PI * 2 + 0.4;
      var br = mesh(cGeo('baobabBranch', function () { return new THREE.CylinderGeometry(0.08, 0.13, 0.85, 5); }), cMat(ctx.trunk));
      br.position.set(0.3, 0.32, 0); br.rotation.z = -0.85; piv.add(br);
      var tip = mesh(cGeo('baobabTip', function () { return new THREE.IcosahedronGeometry(0.32, 0); }), cMat(ctx.foliage[i % ctx.foliage.length]));
      tip.position.set(0.68, 0.62, 0); piv.add(tip);
      g.add(piv);
    }
    return g;
  },
  acacia: function (ctx) {
    var g = new THREE.Group();
    var trunk = mesh(cGeo('acaciaTrunk', function () { return new THREE.CylinderGeometry(0.1, 0.16, 1.5, 6); }), cMat(ctx.trunk));
    trunk.position.y = 0.75; trunk.rotation.z = 0.07; g.add(trunk);
    for (var i = 0; i < 3; i++) {
      var piv = new THREE.Group(); piv.position.y = 1.45; piv.rotation.y = i / 3 * Math.PI * 2;
      var br = mesh(cGeo('acaciaBranch', function () { return new THREE.CylinderGeometry(0.045, 0.07, 0.8, 5); }), cMat(ctx.trunk));
      br.position.set(0.22, 0.3, 0); br.rotation.z = -0.75; piv.add(br); g.add(piv);
    }
    var canopy = mesh(cGeo('acaciaCanopy', function () { return new THREE.CylinderGeometry(1.62, 1.12, 0.42, 9); }), cMat(ctx.foliage[0]));
    canopy.position.y = 2.32; g.add(canopy);
    var canopy2 = mesh(cGeo('acaciaCanopy2', function () { return new THREE.CylinderGeometry(1.05, 0.8, 0.3, 9); }), cMat(ctx.foliage[1 % ctx.foliage.length]));
    canopy2.position.set(0.3, 2.62, -0.15); g.add(canopy2);
    return g;
  }
};

var ANIMALS = {
  rabbit: function () {
    var g = new THREE.Group(), fur = cMat(0xe8e3da);
    var body = mesh(cGeo('rabBody', function () { var geo = new THREE.SphereGeometry(0.22, 7, 6); geo.scale(1, 1.05, 1.2); return geo; }), fur); body.position.y = 0.26; g.add(body);
    var head = mesh(cGeo('rabHead', function () { return new THREE.SphereGeometry(0.14, 7, 6); }), fur); head.position.set(0, 0.5, 0.2); g.add(head);
    [-1, 1].forEach(function (s) {
      var ear = mesh(cGeo('rabEar', function () { return new THREE.ConeGeometry(0.045, 0.2, 5); }), fur);
      ear.position.set(s * 0.06, 0.68, 0.14); ear.rotation.x = -0.2; g.add(ear);
    });
    var tail = mesh(cGeo('rabTail', function () { return new THREE.SphereGeometry(0.07, 6, 5); }), cMat(0xffffff)); tail.position.set(0, 0.24, -0.26); g.add(tail);
    return g;
  },
  parrot: function () {
    var g = new THREE.Group();
    var body = mesh(cGeo('parBody', function () { var geo = new THREE.SphereGeometry(0.18, 7, 6); geo.scale(1, 1.25, 1); return geo; }), cMat(0xe2572b)); body.position.y = 0.34; g.add(body);
    var head = mesh(cGeo('parHead', function () { return new THREE.SphereGeometry(0.12, 7, 6); }), cMat(0x3a86c8)); head.position.set(0, 0.58, 0.08); g.add(head);
    var beak = mesh(cGeo('parBeak', function () { return new THREE.ConeGeometry(0.05, 0.12, 5); }), cMat(0xf2a33c)); beak.position.set(0, 0.56, 0.2); beak.rotation.x = Math.PI / 2; g.add(beak);
    var tail = mesh(cGeo('parTail', function () { return new THREE.ConeGeometry(0.07, 0.42, 4); }), cMat(0x2f9e8f)); tail.position.set(0, 0.2, -0.22); tail.rotation.x = 2.4; g.add(tail);
    return g;
  },
  hedgehog: function () {
    var g = new THREE.Group();
    var body = mesh(cGeo('hogBody', function () { var geo = new THREE.SphereGeometry(0.22, 7, 6); geo.scale(1.25, 0.8, 1); return geo; }), cMat(0x8a6248)); body.position.y = 0.2; g.add(body);
    var spikeGeo = cGeo('hogSpike', function () { return new THREE.ConeGeometry(0.045, 0.16, 4); }), spikeMat = cMat(0x4a3a2e);
    for (var i = 0; i < 9; i++) {
      var s = new THREE.Mesh(spikeGeo, spikeMat); s.castShadow = true;
      var a = i / 9 * Math.PI * 1.6 - Math.PI * 0.8;
      s.position.set(Math.cos(a) * 0.14, 0.32 + Math.sin(i * 3) * 0.02, Math.sin(a) * 0.18);
      s.rotation.x = Math.sin(a) * 0.7; s.rotation.z = -Math.cos(a) * 0.7;
      g.add(s);
    }
    var nose = mesh(cGeo('hogNose', function () { return new THREE.ConeGeometry(0.05, 0.1, 5); }), cMat(0x5a4030)); nose.position.set(0, 0.16, 0.28); nose.rotation.x = Math.PI / 2; g.add(nose);
    return g;
  },
  penguin: function () {
    var g = new THREE.Group();
    var body = mesh(cGeo('penBody', function () { var geo = new THREE.SphereGeometry(0.2, 7, 6); geo.scale(1, 1.35, 1); return geo; }), cMat(0x2e3440)); body.position.y = 0.3; g.add(body);
    var belly = mesh(cGeo('penBelly', function () { var geo = new THREE.SphereGeometry(0.15, 7, 6); geo.scale(1, 1.2, 0.6); return geo; }), cMat(0xf4f7f9)); belly.position.set(0, 0.28, 0.09); g.add(belly);
    var beak = mesh(cGeo('penBeak', function () { return new THREE.ConeGeometry(0.04, 0.1, 5); }), cMat(0xf2a33c)); beak.position.set(0, 0.5, 0.18); beak.rotation.x = Math.PI / 2; g.add(beak);
    return g;
  },
  meerkat: function () {
    var g = new THREE.Group(), fur = cMat(0xc8a165);
    var body = mesh(cGeo('meerBody', function () { return new THREE.CylinderGeometry(0.09, 0.13, 0.36, 6); }), fur); body.position.y = 0.22; g.add(body);
    var head = mesh(cGeo('meerHead', function () { return new THREE.SphereGeometry(0.1, 7, 6); }), fur); head.position.y = 0.47; g.add(head);
    var tail = mesh(cGeo('meerTail', function () { return new THREE.ConeGeometry(0.05, 0.3, 5); }), fur); tail.position.set(0, 0.12, -0.16); tail.rotation.x = -1.9; g.add(tail);
    return g;
  }
};

function ParticleField(cfg, seed, rMax) {
  var rng = mulberry32(seed);
  this.mode = cfg.mode; this.count = cfg.count; this.speed = cfg.speed; this.sway = cfg.sway;
  this.rMin = 2; this.rMax = rMax || 11.5; this.yMin = 0.6; this.yMax = 8.5;
  var n = this.count;
  this.pos = new Float32Array(n * 3);
  this.spd = new Float32Array(n); this.ph = new Float32Array(n); this.dir = new Float32Array(n * 2);
  var colors = new Float32Array(n * 3), col = new THREE.Color();
  var self = this;
  for (var i = 0; i < n; i++) {
    this.respawn(i, rng, true);
    col.setHex(cfg.colors[i % cfg.colors.length]);
    var v = 0.85 + rng() * 0.3;
    colors[i * 3] = col.r * v; colors[i * 3 + 1] = col.g * v; colors[i * 3 + 2] = col.b * v;
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  this.geo = geo;
  this.mat = new THREE.PointsMaterial({
    size: cfg.size, map: getTex(cfg.tex), vertexColors: true,
    transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true
  });
  this.points = new THREE.Points(geo, this.mat);
  this.points.frustumCulled = false;
}
ParticleField.prototype.respawn = function (i, rng, anywhere) {
  var a = rng() * Math.PI * 2, r = this.rMin + rng() * (this.rMax - this.rMin);
  this.pos[i * 3] = Math.cos(a) * r; this.pos[i * 3 + 2] = Math.sin(a) * r;
  this.pos[i * 3 + 1] = anywhere ? this.yMin + rng() * (this.yMax - this.yMin)
    : this.mode === 'rise' ? this.yMin : this.yMax + rng();
  this.spd[i] = 0.6 + rng() * 0.8; this.ph[i] = rng() * Math.PI * 2;
  this.dir[i * 2] = rng() * 2 - 1; this.dir[i * 2 + 1] = rng() * 2 - 1;
};
ParticleField.prototype.update = function (dt, t) {
  var p = this.pos;
  for (var i = 0; i < this.count; i++) {
    var ix = i * 3;
    if (this.mode === 'fall') {
      p[ix + 1] -= this.speed * this.spd[i] * dt;
      p[ix] += Math.sin(t * 1.4 + this.ph[i]) * this.sway * dt;
      p[ix + 2] += Math.cos(t * 1.1 + this.ph[i]) * this.sway * 0.6 * dt;
      if (p[ix + 1] < this.yMin) this.respawn(i, Math.random, false);
    } else if (this.mode === 'rise') {
      p[ix + 1] += this.speed * this.spd[i] * dt;
      p[ix] += Math.sin(t * 0.8 + this.ph[i]) * this.sway * dt;
      p[ix + 2] += Math.cos(t * 0.7 + this.ph[i]) * this.sway * dt;
      if (p[ix + 1] > this.yMax) { this.respawn(i, Math.random, false); p[ix + 1] = this.yMin; }
    } else {
      p[ix] += this.dir[i * 2] * this.speed * dt * 2;
      p[ix + 2] += this.dir[i * 2 + 1] * this.speed * dt * 2;
      p[ix + 1] += Math.sin(t + this.ph[i]) * dt * 0.2;
      var d = Math.hypot(p[ix], p[ix + 2]);
      if (d > this.rMax) this.respawn(i, Math.random, true);
    }
  }
  this.geo.attributes.position.needsUpdate = true;
};
ParticleField.prototype.dispose = function () { this.geo.dispose(); this.mat.dispose(); };

var ISLAND_R = 9;
function vnoise2(x, z) {
  var xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  var u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  function h(ix, iz) { var n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453; return n - Math.floor(n); }
  var a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
/* Deterministic river: a wandering polyline from near the coast to the centre. */
function riverPath(R, seed) {
  var rng = mulberry32((seed ^ 0x1f2a3b) >>> 0);
  var pts = [], n = 9, entryA = rng() * Math.PI * 2, a = entryA;
  for (var i = 0; i <= n; i++) {
    var t = i / n;
    a += (rng() - 0.5) * 1.1;
    var rad = R * (0.14 + 0.8 * (1 - t));
    pts.push({ x: Math.cos(a) * rad, z: Math.sin(a) * rad });
  }
  return pts;
}
function riverDist(x, z, pts) {
  var best = 1e9;
  for (var i = 0; i < pts.length - 1; i++) {
    var ax = pts[i].x, az = pts[i].z, bx = pts[i + 1].x, bz = pts[i + 1].z;
    var dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    var t = len2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1) : 0;
    var px = ax + dx * t, pz = az + dz * t;
    var dd = Math.hypot(x - px, z - pz);
    if (dd < best) best = dd;
  }
  return best;
}
function makeGroundHeight(seed, R) {
  var p1 = (seed % 1000) / 100, p2 = (seed % 700) / 100;
  var river = riverPath(R, seed);
  return function (x, z) {
    var d = Math.hypot(x, z);
    var fade = clamp(1 - (d / (R * 0.98)), 0, 1);
    var dome = (1 - d / R) * 2.5;                                          // central relief
    var hills = (vnoise2(x * 0.42 + p1, z * 0.42 + p2) - 0.5) * 1.7 * fade  // big rolling hills
             + (vnoise2(x * 1.5 + p1 * 3, z * 1.5 + p2 * 3) - 0.5) * 0.75 * fade; // detail
    var h = dome + hills;
    var rd = riverDist(x, z, river);
    if (rd < 2.3) h -= (2.3 - rd) * 1.35 * fade;                           // carved river channel
    return Math.max(-0.5, h - (1 - fade) * 1.1);                           // drop off into the sea
  };
}
function coastWob(theta, seed, amp) {
  return 1 + (Math.sin(theta * 3 + seed) * 0.5 + Math.sin(theta * 7 + seed * 1.9) * 0.32 + Math.sin(theta * 12 + seed * 0.7) * 0.18) * amp;
}
/* Cliff skirt: just the side wall of the island (open top). The land disc is the
   real top surface, so trees/rocks sitting on gh() never float. */
function buildIslandMesh(biome, seed, R) {
  var gh = makeGroundHeight(seed, R);
  var geo = new THREE.CylinderGeometry(R, R * 0.35, 6, 56, 6, true);
  var pos = geo.attributes.position;
  for (var i = 0; i < pos.count; i++) {
    var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    var d = Math.hypot(x, z);
    if (d > 0.001) {
      var a = Math.atan2(z, x);
      var wob = coastWob(a, seed, 0.30 * (y > 0 ? 0.8 : 0.4));
      x *= wob; z *= wob;
    }
    if (y > 2.9) y += gh(x, z);
    pos.setXYZ(i, x, y, z);
  }
  var nGeo = geo.toNonIndexed(); geo.dispose();
  nGeo.computeVertexNormals();
  var p = nGeo.attributes.position, colors = new Float32Array(p.count * 3);
  var cGround = new THREE.Color(biome.ground), cVar = new THREE.Color(biome.groundVar),
    cSand = new THREE.Color(biome.sand), cRock = new THREE.Color(biome.rock), tmp = new THREE.Color();
  var rng = mulberry32(seed ^ 0xbeef);
  for (var i2 = 0; i2 < p.count; i2++) {
    var y2 = p.getY(i2);
    if (y2 > 1.0) tmp.copy(cGround).lerp(cVar, clamp(0.55 - (y2 - 1) * 0.10, 0, 1)).offsetHSL(0, 0, (rng() - 0.5) * 0.05);
    else if (y2 > -0.15) tmp.copy(cSand).offsetHSL(0, 0, (rng() - 0.5) * 0.04);
    else tmp.copy(cRock).lerp(cSand, 0.12).offsetHSL(0, 0, (rng() - 0.5) * 0.04);
    colors[i2 * 3] = tmp.r; colors[i2 * 3 + 1] = tmp.g; colors[i2 * 3 + 2] = tmp.b;
  }
  nGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  var mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  var m = new THREE.Mesh(nGeo, mat);
  m.position.y = -0.6;
  m.receiveShadow = true; m.castShadow = false;
  return { mesh: m, groundHeight: gh, river: riverPath(R, seed) };
}
/* High-resolution land surface: a polar grid that samples gh() densely so the
   physical ground matches where trees and rocks are placed. Also sculpts the
   river channel with sandy banks + water tint. */
function buildLandDisc(biome, seed, R, gh, topY) {
  var river = riverPath(R, seed);
  var nRings = 16, nAng = 64;
  var cGround = new THREE.Color(biome.ground), cVar = new THREE.Color(biome.groundVar),
    cSand = new THREE.Color(biome.sand), cRiver = new THREE.Color(biome.water ? biome.water.shallow : 0x7fd4c4), tmp = new THREE.Color();
  var rng = mulberry32((seed ^ 0x1234abcd) >>> 0);
  function shade(y, x, z) {
    if (y > 1.0) {
      tmp.copy(cGround).lerp(cVar, clamp(0.55 - (y - 1) * 0.10, 0, 1)).offsetHSL(0, 0, (rng() - 0.5) * 0.05);
      var rd = riverDist(x, z, river);
      if (rd < 2.6) tmp.lerp(cSand, clamp(1 - rd / 2.6, 0, 1) * 0.8);   // sandy banks
      if (rd < 1.2) tmp.lerp(cRiver, clamp(1 - rd / 1.2, 0, 1) * 0.9);  // the water itself
    } else {
      tmp.copy(cSand).offsetHSL(0, 0, (rng() - 0.5) * 0.04);
    }
    return tmp.clone();
  }
  var verts = [], cols = [], idx = [], ringStart = [];
  verts.push(0, topY + gh(0, 0), 0); cols.push(shade(topY + gh(0, 0), 0, 0));
  for (var k = 1; k <= nRings; k++) {
    ringStart.push(1 + (k - 1) * nAng);
    var rk = (k / nRings) * R;
    for (var j = 0; j < nAng; j++) {
      var theta = (j / nAng) * Math.PI * 2;
      var wob = coastWob(theta, seed, 0.24);
      var x = Math.cos(theta) * rk * wob, z = Math.sin(theta) * rk * wob;
      var y = topY + gh(x, z);
      verts.push(x, y, z); cols.push(shade(y, x, z));
    }
  }
  for (var j = 0; j < nAng; j++) { var a = 1 + j, b = 1 + ((j + 1) % nAng); idx.push(0, a, b); }
  for (var k = 0; k < nRings - 1; k++) {
    var r0 = ringStart[k], r1 = ringStart[k + 1];
    for (var j = 0; j < nAng; j++) {
      var jn = (j + 1) % nAng;
      var a = r0 + j, b = r0 + jn, c = r1 + jn, d = r1 + j;
      idx.push(a, c, b, a, d, c);
    }
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  var colArr = new Float32Array(cols.length * 3);
  for (var i = 0; i < cols.length; i++) { colArr[i * 3] = cols[i].r; colArr[i * 3 + 1] = cols[i].g; colArr[i * 3 + 2] = cols[i].b; }
  g.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  var mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  var m = new THREE.Mesh(g, mat);
  m.position.y = 0;
  m.receiveShadow = true; m.castShadow = false;
  return m;
}
/* A thin translucent ribbon laid over the carved channel so it reads as a river. */
function buildRiverWater(river, gh, topY, width, color) {
  var n = river.length, verts = [];
  for (var i = 0; i < n; i++) {
    var px0 = river[i].x, pz0 = river[i].z, dx, dz;
    if (i === 0) { dx = river[1].x - px0; dz = river[1].z - pz0; }
    else if (i === n - 1) { dx = px0 - river[n - 2].x; dz = pz0 - river[n - 2].z; }
    else { dx = river[i + 1].x - river[i - 1].x; dz = river[i + 1].z - river[i - 1].z; }
    var len = Math.hypot(dx, dz) || 1, px = -dz / len, pz = dx / len;
    var y2 = topY + gh(px0, pz0) + 0.34;
    verts.push(px0 + px * width, y2, pz0 + pz * width);
    verts.push(px0 - px * width, y2, pz0 - pz * width);
  }
  var idx = [];
  for (var k = 0; k < n - 1; k++) {
    var a = k * 2, b = k * 2 + 1, c = k * 2 + 2, d = k * 2 + 3;
    idx.push(a, b, c, b, d, c);
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  var waterMat = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: 0.72, side: THREE.DoubleSide });
  return new THREE.Mesh(g, waterMat);
}

function blendHex(a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex(); }
function paletteFor(biome, speciesId) {
  var sp = speciesById(speciesId);
  if (biome.species.indexOf(speciesId) >= 0) return { foliage: biome.foliage, trunk: biome.trunk };
  var f = sp.palette.foliage.map(function (c, i) { return blendHex(c, biome.foliage[i % biome.foliage.length], 0.45); });
  return { foliage: f, trunk: blendHex(sp.palette.trunk, biome.trunk, 0.45) };
}

function disposeWorld() {
  if (!world) return;
  scene.remove(world.group);
  for (var i = 0; i < world.instanced.length; i++) world.instanced[i].dispose();
  for (var g = 0; g < world.uniqueGeos.length; g++) world.uniqueGeos[g].dispose();
  world.particles.dispose();
  world = null;
}

function buildWorld(biome, view) {
  disposeWorld();
  var seed = hashStr(biome.id);
  var rng = mulberry32(seed);
  var R = view.radius;
  var rout = view.rout || (R * 0.72);
  var group = new THREE.Group();
  var w = { biomeId: biome.id, group: group, radius: R, trees: new Map(), uniqueGeos: [], instanced: [], springs: [], animals: [], particles: null, slots: [] };

  var isl = buildIslandMesh(biome, seed, R);
  w.uniqueGeos.push(isl.mesh.geometry, isl.mesh.material);
  group.add(isl.mesh);
  var topY = 2.4;
  var disc = buildLandDisc(biome, seed, R, isl.groundHeight, topY);
  w.uniqueGeos.push(disc.geometry, disc.material);
  group.add(disc);
  if (isl.river && isl.river.length) {
    var riverW = buildRiverWater(isl.river, isl.groundHeight, topY, Math.max(0.7, R * 0.06), biome.water ? biome.water.shallow : 0x7fd4c4);
    group.add(riverW);
    w.uniqueGeos.push(riverW.geometry, riverW.material);
  }

  var slots = [];
  for (var i = 0; i < view.slots; i++) {
    var rr = SLOT_BASE + Math.sqrt((i + 0.5) / view.slots) * rout;
    var a = i * 2.39996 + (rng() - 0.5) * 0.3;
    var x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    slots.push({ x: x, z: z, y: topY + isl.groundHeight(x, z), rot: rng() * Math.PI * 2, var: 0.9 + rng() * 0.22 });
  }
  w.slots = slots;

  addProps(w, biome, rng, isl.groundHeight, topY, R);

  var animal = ANIMALS[biome.animal.type]();
  var as = slots[Math.floor(rng() * Math.min(8, slots.length))];
  animal.position.set(as.x * 0.55, as.y, as.z * 0.55);
  animal.rotation.y = rng() * Math.PI * 2; animal.scale.setScalar(0.85);
  group.add(animal);
  w.animals.push({ obj: animal, baseY: animal.position.y, phase: rng() * 6 });

  w.particles = new ParticleField(biome.particles, seed ^ 0x51f, R * 0.8);
  group.add(w.particles.points);

  var sc = R + 8;
  sun.shadow.camera.left = -sc; sun.shadow.camera.right = sc;
  sun.shadow.camera.top = sc; sun.shadow.camera.bottom = -sc;
  sun.shadow.camera.updateProjectionMatrix();

  scene.add(group);
  world = w;
}

function spawnTree(slotIdx, stage, speciesId) {
  if (!world) return null;
  var slot = world.slots[slotIdx];
  if (!slot) return null;
  var biome = biomeById(world.biomeId);
  var pal = paletteFor(biome, speciesId);
  var ctx = { foliage: pal.foliage, trunk: pal.trunk, rng: Math.random };
  var g = SPECIES[speciesId](ctx);
  g.position.set(slot.x, slot.y - 0.12, slot.z);
  g.rotation.y = slot.rot;
  var target = STAGE_SCALE[stage] * slot.var;
  g.scale.setScalar(0.01);
  world.group.add(g);
  var entry = { obj: g, scale: 0.01, vel: 0, target: target, phase: slot.rot * 3.1, amp: speciesId === 'palm' ? 0.045 : 0.03, species: speciesId };
  world.trees.set(slotIdx, entry);
  world.springs.push(entry);
  return entry;
}

function addProps(w, biome, rng, gh, topY, R) {
  var dummy = new THREE.Object3D();
  var col = new THREE.Color();
  var propGeo = {
    rock: function () { return cGeo('propRock', function () { return new THREE.DodecahedronGeometry(1, 0); }); },
    bush: function () { return cGeo('propBush', function () { var g = new THREE.IcosahedronGeometry(1, 0); g.scale(1, 0.72, 1); return g; }); },
    grass: function () { return cGeo('propGrass', function () { return new THREE.ConeGeometry(0.5, 1, 4); }); },
    snowmound: function () { return cGeo('propMound', function () { var g = new THREE.SphereGeometry(1, 7, 5); g.scale(1, 0.45, 1); return g; }); },
    flower: function () { return cGeo('propFlower', function () { return new THREE.IcosahedronGeometry(1, 0); }); },
    mushroomCap: function () { return cGeo('propShroomCap', function () { return new THREE.SphereGeometry(1, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2); }); },
    mushroomStem: function () { return cGeo('propShroomStem', function () { return new THREE.CylinderGeometry(0.45, 0.6, 1, 5); }); }
  };
  function place(inst, i, sx, sy, sz, x, y, z, ry) {
    dummy.position.set(x, y, z); dummy.rotation.set(0, ry, 0); dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
  }
  for (var pi = 0; pi < biome.props.length; pi++) {
    var cfg = biome.props[pi];
    var geo = cfg.type === 'mushroom' ? propGeo.mushroomCap() : propGeo[cfg.type]();
    var mat = new THREE.MeshLambertMaterial({ flatShading: true });
    var inst = new THREE.InstancedMesh(geo, mat, cfg.count);
    inst.castShadow = cfg.type !== 'grass' && cfg.type !== 'flower';
    inst.receiveShadow = true;
    var stemInst = null;
    if (cfg.type === 'mushroom') {
      stemInst = new THREE.InstancedMesh(propGeo.mushroomStem(), cMat(0xe8dcc8, { flatShading: true }), cfg.count);
      stemInst.castShadow = true;
    }
    for (var i = 0; i < cfg.count; i++) {
      var a = rng() * Math.PI * 2, r = 1.2 + rng() * Math.max(0.5, Math.min(R - 2.2, R * 0.7 - 1.2));
      var x = Math.cos(a) * r, z = Math.sin(a) * r, y = topY + gh(x, z);
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

function applyEnvironment(biome) {
  skyMat.uniforms.uTop.value.setHex(biome.sky.top);
  skyMat.uniforms.uHorizon.value.setHex(biome.sky.horizon);
  scene.fog.color.setHex(biome.fog);
  waterMat.uniforms.uDeep.value.setHex(biome.water.deep);
  waterMat.uniforms.uShallow.value.setHex(biome.water.shallow);
  waterMat.uniforms.uSky.value.setHex(biome.sky.horizon);
  var L = biome.light;
  sun.position.set(L.sunPos[0], L.sunPos[1], L.sunPos[2]);
  sun.color.setHex(L.sunColor); sun.intensity = L.sunInt;
  hemi.color.setHex(L.hemiSky); hemi.groundColor.setHex(L.hemiGround); hemi.intensity = L.hemiInt;
}

var traveling = false;
function travel(biomeId, instant) {
  var biome = biomeById(biomeId);
  if (!biome || !biomeUnlocked(biomeId)) return;
  var doSwap = function () {
    grove.activeBiome = biomeId; saveGrove();
    applyEnvironment(biome);
    buildWorld(biome, viewFor(biomeId, viewPeriod));
    syncTrees(true);
    updateHUD();
    renderStoreIfOpen();
    renderMapIfOpen();
  };
  if (instant || !built) { doSwap(); return; }
  if (traveling) return; traveling = true;
  var fade = document.getElementById('gi-fade');
  fade.style.background = '#' + biome.sky.horizon.toString(16).padStart(6, '0');
  fade.style.opacity = '1';
  setTimeout(function () {
    sndTravel();
    doSwap();
    setTimeout(function () { fade.style.opacity = '0'; traveling = false; }, 60);
  }, 400);
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
    floaty('🌱 New sapling!');
  }
}
function attributeDelta(delta) {
  if (delta <= 0) return;
  attributeBySubject({ physics: delta, chemistry: 0, maths: 0 });
}

function periodCount(biomeId, period) {
  var today = todayKey();
  var keys = Object.keys(grove.daily).sort();
  var lo = '', hi = today;
  if (period === 'today') { lo = today; hi = today; }
  else if (period === 'yesterday') { lo = dayOffsetKey(1); hi = lo; }
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
    var t = totalToday();
    count += t;
    for (var i2 = 0; i2 < t; i2++) species.push(grove.activeSpecies);
  }
  return { count: count, species: species };
}

function viewFor(biomeId, period) {
  var agg = periodCount(biomeId, period);
  var slots = clamp(Math.max(MIN_SLOTS, Math.ceil(agg.count / STAGES_PER_TREE)), MIN_SLOTS, MAX_SLOTS);
  var R = islandRadiusForSlots(slots);
  var rout = Math.max(R * 0.72, MIN_TREE_SPACING * Math.sqrt(slots) / 1.24);
  var safe = Math.max(0.5, R * 0.70 - SLOT_BASE);   // keep all trees inside the wobbled coastline
  return { slots: slots, radius: R, rout: Math.min(rout, safe) };
}

function orbitDistFor(R) { return clamp(R * 1.9, 20, 75); }

/* Island eye-radius grows with tree count (request: expands as trees increase) and
   is never smaller than what MIN_TREE_SPACING needs so trees stay separable. */
function islandRadiusForSlots(slots) {
  var R = Math.max(ISLAND_R, ISLAND_R * Math.sqrt(slots / MIN_SLOTS));
  return Math.max(R, MIN_TREE_SPACING * Math.sqrt(slots) / (1.24 * 0.72));
}

function desiredTrees(biomeId) {
  var agg = periodCount(biomeId, viewPeriod);
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
  var keep = new Set();
  for (var i = 0; i < want.length; i++) keep.add(want[i].slot);
  var toRemove = [];
  world.trees.forEach(function (e, slot) { if (!keep.has(slot)) toRemove.push(slot); });
  for (var r = 0; r < toRemove.length; r++) {
    var e = world.trees.get(toRemove[r]);
    world.group.remove(e.obj);
    world.trees.delete(toRemove[r]);
  }
  for (var w2 = 0; w2 < want.length; w2++) {
    var d = want[w2];
    var entry = world.trees.get(d.slot);
    if (entry) {
      if (entry.species !== d.species) {
        world.group.remove(entry.obj);
        world.trees.delete(d.slot);
        spawnTree(d.slot, d.stage, d.species);
        if (!first) floaty('🌱');
      } else {
        entry.target = STAGE_SCALE[d.stage] * world.slots[d.slot].var;
      }
    } else {
      spawnTree(d.slot, d.stage, d.species);
      if (!first) floaty('🌱');
    }
  }
  var empty = document.getElementById('gi-empty');
  if (empty) empty.style.display = world.trees.size > 0 ? 'none' : 'flex';
  updateTreeStat();
}

function updateTreeStat() {
  var n = world ? world.trees.size : 0;
  var f = document.getElementById('gi-full-trees');
  if (f) f.textContent = n;
  var agg = world ? periodCount(world.biomeId, viewPeriod) : null;
  var m = document.getElementById('gi-full-meta');
  if (m) m.textContent = agg ? agg.count + ' solves · ' + (PERIOD_LABELS[viewPeriod] || '') : '';
}

function readLive() {
  function g(id) { var e = document.getElementById(id); return e ? (parseInt(e.textContent, 10) || 0) : 0; }
  var l = { physics: g('physics-count'), chemistry: g('chemistry-count'), maths: g('maths-count') };
  try { if (window.solved) { l.physics = Math.max(l.physics, +window.solved.physics || 0); l.chemistry = Math.max(l.chemistry, +window.solved.chemistry || 0); l.maths = Math.max(l.maths, +window.solved.maths || 0); } } catch (e) {}
  return l;
}
function forestStoreToday() {
  try {
    var o = JSON.parse(localStorage.getItem(LS_DAILY) || '{}');
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
  ['physics', 'chemistry', 'maths'].forEach(function (s) {
    if ((st[s] || 0) > (live[s] || 0)) { setSubj(s, st[s] || 0); changed = true; }
  });
  return changed;
}
function seedStore() {
  var st = forestStoreToday(), live = readLive(), write = false;
  ['physics', 'chemistry', 'maths'].forEach(function (s) {
    if ((live[s] || 0) > (st[s] || 0)) { st[s] = live[s] || 0; write = true; }
  });
  if (write) {
    try {
      var o = JSON.parse(localStorage.getItem(LS_DAILY) || '{}');
      o[todayKey()] = st;
      localStorage.setItem(LS_DAILY, JSON.stringify(o));
      // Permanent IndexedDB mirror — today's solved counts never deleted.
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
      // 1) Daily per-subject solved counts — merge max per subject/date so the
      //    grove's historical day counts survive a localStorage wipe.
      if (idbDaily && typeof idbDaily === 'object') {
        var ls = {}; try { ls = JSON.parse(localStorage.getItem(LS_DAILY) || '{}'); } catch (e) { ls = {}; }
        var merged = Object.assign({}, ls);
        for (var d in idbDaily) {
          var e = idbDaily[d]; if (!e || typeof e !== 'object') continue;
          var prev = merged[d] || {};
          merged[d] = {
            physics: Math.max(Number(prev.physics) || 0, Number(e.physics) || 0),
            chemistry: Math.max(Number(prev.chemistry) || 0, Number(e.chemistry) || 0),
            maths: Math.max(Number(prev.maths) || 0, Number(e.maths) || 0),
            updatedAt: Math.max(Number(prev.updatedAt) || 0, Number(e.updatedAt) || 0)
          };
        }
        try { localStorage.setItem(LS_DAILY, JSON.stringify(merged)); } catch (e) {}
      }
      // 2) Grove state (per-day tree decor). Use the IDB backup only when
      //    localStorage was cleared, so the live copy always wins otherwise.
      if (idbGrove && typeof idbGrove === 'object') {
        var hasLS = false; try { hasLS = !!localStorage.getItem(LS_GROVE); } catch (e) {}
        if (!hasLS) { grove = idbGrove; saveGrove(); }
      }
    } catch (e) {}
  });
}

var lastTotal = -1, lastSubj = null, lastElo = -1, seenDay = '';
function attributeSinceSnapshot() {
  var cur = visual();
  if (!lastSubj) { lastSubj = cur; return 0; }
  var d = { physics: 0, chemistry: 0, maths: 0 }, total = 0;
  for (var s = 0; s < SUBJECTS.length; s++) { d[SUBJECTS[s]] = Math.max(0, (cur[SUBJECTS[s]] || 0) - (lastSubj[SUBJECTS[s]] || 0)); total += d[SUBJECTS[s]]; }
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
      newB.forEach(function (b) { toast(b.icon + ' <b>' + b.name + '</b> unlocked!', 'Travel ⛵', function () { travel(b.id); closeMap(); }); });
      newS.forEach(function (sp) { toast(sp.icon + ' <b>' + sp.name + '</b> unlocked in the nursery!', 'Plant 🌱', function () { grove.activeSpecies = sp.id; saveGrove(); updateHUD(); renderStoreIfOpen(); }); });
    }
  }
}

function tick(first) {
  if (document.hidden && !first) { return; }
  var day = todayKey();
  if (day !== seenDay) { seenDay = day; if (lastTotal >= 0) lastTotal = 0; lastSubj = null; }
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
  checkElo();
  maybeExpand();
  syncTrees(first);
  updateHUD();
  renderStoreIfOpen();
  renderMapIfOpen();
  var fade = document.getElementById('gi-fade');
  if (fade && fade.style.opacity === '1' && !traveling) fade.style.opacity = '0';
}

function updateHUD() {
  var b = biomeById(grove.activeBiome);
  var elo = globalElo();
  var sp = speciesById(grove.activeSpecies);
  var eloEl = document.getElementById('gi-elo');
  var eloFull = document.getElementById('gi-full-elo');
  if (eloEl) eloEl.textContent = elo;
  if (eloFull) eloFull.textContent = elo;
  var chip = document.getElementById('gi-chip');
  var nameEl = document.getElementById('gi-name');
  var subEl = document.getElementById('gi-sub');
  var fchip = document.getElementById('gi-full-chip');
  var fname = document.getElementById('gi-full-name');
  var fsub = document.getElementById('gi-full-sub');
  if (chip) { chip.textContent = b.icon; chip.style.background = '#' + b.ground.toString(16).padStart(6, '0'); }
  if (nameEl) nameEl.textContent = b.name;
  if (subEl) subEl.textContent = elo + ' ELO · ' + totalToday() + ' solved today';
  if (fchip) { fchip.textContent = b.icon; fchip.style.background = '#' + b.ground.toString(16).padStart(6, '0'); }
  if (fname) fname.textContent = b.name;
  if (fsub) fsub.textContent = b.blurb;
  var spEl = document.getElementById('gi-species');
  if (spEl) spEl.innerHTML = sp.icon + ' ' + sp.name;
  var next = null;
  for (var i = 0; i < BIOMES.length; i++) if (!biomeUnlocked(BIOMES[i].id, elo)) { next = BIOMES[i]; break; }
  var bar = document.getElementById('gi-bar');
  var lbl = document.getElementById('gi-next');
  if (next) {
    var prevThr = 0;
    for (var j = 0; j < BIOMES.length; j++) if (BIOMES[j].unlockElo <= elo && BIOMES[j].unlockElo >= prevThr) prevThr = BIOMES[j].unlockElo;
    var pct = clamp((elo - prevThr) / (next.unlockElo - prevThr) * 100, 0, 100);
    if (bar) bar.style.width = pct + '%';
    if (lbl) lbl.textContent = 'Next: ' + next.icon + ' ' + next.name + ' at ' + next.unlockElo + ' ELO';
  } else {
    if (bar) bar.style.width = '100%';
    if (lbl) lbl.textContent = 'All islands unlocked 🎉';
  }
  var badge = document.getElementById('gi-unlock-badge');
  if (badge) {
    var n = 0;
    for (var k = 0; k < BIOMES.length; k++) if (biomeUnlocked(BIOMES[k].id, elo)) n++;
    badge.textContent = n + '/' + BIOMES.length;
  }
}

function floaty(text) {
  var card = document.getElementById('gi-host');
  if (!card) return;
  var r = card.getBoundingClientRect();
  var s = document.createElement('span');
  s.className = 'gi-floaty';
  s.textContent = text;
  s.style.left = (r.left + r.width / 2 + (Math.random() * 120 - 60)) + 'px';
  s.style.top = (r.top + r.height * 0.4) + 'px';
  document.getElementById('gi-float').appendChild(s);
  setTimeout(function () { s.remove(); }, 1050);
}

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

function ensureFull() {
  if (fullRenderer) return;
  var cvs = document.getElementById('gi-full-canvas');
  if (!cvs) return;
  fullRenderer = new THREE.WebGLRenderer({ canvas: cvs, antialias: true });
  fullRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  fullRenderer.shadowMap.enabled = true;
  fullRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  fullRenderer.outputColorSpace = THREE.SRGBColorSpace;
  bindOrbit(cvs, fullOrbit);
  try { new ResizeObserver(sizeCanvases).observe(cvs); } catch (e) {}
}

function syncPeriodUI() {
  var c = document.getElementById('gi-full-periods');
  if (!c) return;
  var bs = c.querySelectorAll('button');
  for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('active', bs[i].getAttribute('data-period') === viewPeriod);
}

function setViewPeriod(p) {
  viewPeriod = p;
  syncPeriodUI();
  if (!world || !built) return;
  maybeExpand();
  updateTreeStat();
  updateHUD();
  renderStoreIfOpen();
  renderMapIfOpen();
}

/* Rebuild the island when more trees need more room, so it visibly expands as
   solves grow — without a full rebuild every frame. */
function maybeExpand() {
  if (!world || !built) return false;
  var bio = biomeById(world.biomeId);
  var view = viewFor(bio.id, viewPeriod);
  var needsBuild = view.slots !== world.slots.length || Math.abs(view.radius - world.radius) > 0.01;
  if (!needsBuild) { syncTrees(false); return false; }
  var fade = document.getElementById('gi-fade');
  if (fade) { fade.style.background = '#' + bio.sky.horizon.toString(16).padStart(6, '0'); fade.style.opacity = '1'; }
  applyEnvironment(bio);
  buildWorld(bio, view);
  syncTrees(true);
  if (fade) setTimeout(function () { fade.style.opacity = '0'; }, 60);
  updateTreeStat();
  updateHUD();
  if (fullOrbit) { fullOrbit.dist = orbitDistFor(view.radius); fullOrbit.apply(); }
  return true;
}

function openFull() {
  ensureFull();
  var ov = document.getElementById('gi-full-overlay');
  if (!ov || !built) return;
  ov.classList.add('open');
  document.body.classList.add('gi-full-open');
  fullOpen = true;
  sizeCanvases();
  setViewPeriod(fullPeriod);
  updateHUD();
}
function closeFull() {
  var ov = document.getElementById('gi-full-overlay');
  if (!ov) return;
  ov.classList.remove('open');
  document.body.classList.remove('gi-full-open');
  fullOpen = false;
  setViewPeriod('today');
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
  if (strip) strip.textContent = '⭐ ' + elo + ' ELO';
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
        '<span>' + (un ? 'Unlocked ✓' : 'Requires ' + b.unlockElo + ' ELO') + '</span></div>' +
        '<button class="gi-store-btn" ' + (un ? '' : 'disabled') + '>' + (un ? (grove.activeBiome === b.id ? '● Here' : 'Travel ⛵') : '🔒 Locked') + '</button>' });
      card.addEventListener('click', function () {
        if (un) { travel(b.id); closeStore(); }
      });
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
        '<span>' + (un ? 'Unlocked ✓' : 'Requires ' + sp.unlockElo + ' ELO') + '</span></div>' +
        '<button class="gi-store-btn" ' + (un ? '' : 'disabled') + '>' + (active ? '✓ Planting' : un ? 'Plant this 🌱' : '🔒 Locked') + '</button>' });
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

/* Which tree each subject plants — the subject → species selector. */
function renderSubjectsTab() {
  var tab = document.getElementById('gi-tab-subjects');
  if (!tab) return;
  var elo = globalElo();
  var meta = { physics: { name: 'Physics', icon: '⚛️' }, chemistry: { name: 'Chemistry', icon: '🧪' }, maths: { name: 'Maths', icon: '📐' } };
  var html = '<div class="gi-subj-head">Which tree each subject plants — solving that subject\u2019s questions grows that tree</div>';
  for (var s = 0; s < SUBJECTS.length; s++) {
    var subj = SUBJECTS[s];
    var cur = subjectSpecies(subj);
    var opts = '';
    for (var i = 0; i < SPECIES_DEFS.length; i++) {
      var sp = SPECIES_DEFS[i];
      var un = speciesUnlocked(sp.id, elo);
      opts += '<option value="' + sp.id + '"' + (sp.id === cur ? ' selected' : '') + (un ? '' : ' disabled') + '>' + sp.icon + ' ' + sp.name + (un ? '' : ' 🔒') + '</option>';
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
  var f = '#' + c.toString(16).padStart(6, '0');
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
  for (var b = 0; b < BIOMES.length; b++) {
    var bio = BIOMES[b];
    var unlocked = biomeUnlocked(bio.id, elo);
    var active = grove.activeBiome === bio.id;
    var p = bio.mapPos;
    var ground = unlocked ? '#' + bio.ground.toString(16).padStart(6, '0') : '#9aa7b0';
    var sand = unlocked ? '#' + bio.sand.toString(16).padStart(6, '0') : '#b9c2c9';
    svg += '<g class="gi-node' + (unlocked ? '' : ' gi-node-locked') + '" data-id="' + bio.id + '">';
    if (active) svg += '<circle class="gi-ring" cx="' + p.x + '" cy="' + p.y + '" r="' + (p.r + 9) + '" fill="none" stroke="#ffffff" stroke-width="3.5"/>';
    svg += '<ellipse cx="' + p.x + '" cy="' + (p.y + 4) + '" rx="' + (p.r + 10) + '" ry="' + (p.r * 0.72 + 8) + '" fill="' + sand + '" opacity=".9"/>' +
      '<ellipse cx="' + p.x + '" cy="' + p.y + '" rx="' + p.r + '" ry="' + (p.r * 0.72) + '" fill="' + ground + '"/>';
    if (unlocked) {
      svg += mapGlyph(bio.species[0], p.x - p.r * 0.38, p.y + p.r * 0.08, bio.foliage[0], p.r * 0.3);
      if (bio.species[1]) svg += mapGlyph(bio.species[1], p.x + p.r * 0.34, p.y + p.r * 0.14, bio.foliage[1] || bio.foliage[0], p.r * 0.24);
      svg += '<text x="' + p.x + '" y="' + (p.y + p.r * 0.72 + 18) + '" text-anchor="middle" font-family="sans-serif" font-weight="600" font-size="14" fill="#ffffff" style="text-shadow:0 1px 3px rgba(0,0,0,.4)">' + bio.icon + ' ' + bio.name + '</text>';
      if (active) svg += '<text x="' + p.x + '" y="' + (p.y - p.r * 0.72 - 10) + '" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="11" fill="#ffffff">● CURRENT</text>';
    } else {
      svg += '<text x="' + p.x + '" y="' + (p.y + 6) + '" text-anchor="middle" font-size="18">🔒</text>' +
        '<text x="' + p.x + '" y="' + (p.y + p.r * 0.72 + 18) + '" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="12" fill="rgba(255,255,255,.85)">' + bio.name + ' · ' + bio.unlockElo + ' ELO</text>';
    }
    svg += '</g>';
  }
  svg += '</svg>';
  wrap.innerHTML = svg;
  var eloFoot = document.getElementById('gi-map-elo');
  if (eloFoot) eloFoot.textContent = elo + ' ELO — tap an unlocked island to travel';
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
    '<div class="gi-canvas-wrap"><canvas id="gi-card"></canvas><div class="gi-empty" id="gi-empty">Answer questions to grow a tree 🌱</div></div>' +
    '<div class="gi-card-hud">' +
    '<div class="gi-chip" id="gi-chip">🌲</div>' +
    '<div class="gi-card-meta">' +
    '<div class="gi-name" id="gi-name">Temperate Forest</div>' +
    '<div class="gi-sub" id="gi-sub">1200 ELO</div>' +
    '</div>' +
    '<div class="gi-species" id="gi-species">🌲 Pine</div>' +
    '<div class="gi-next-wrap"><div class="gi-bar"><i id="gi-bar"></i></div><span class="gi-next" id="gi-next"></span></div>' +
    '<div class="gi-card-btns">' +
    '<button class="gi-ibtn gi-btn-badge" id="gi-btn-map" title="Archipelago">🗺️<span class="gi-badge" id="gi-unlock-badge">1/5</span></button>' +
    '<button class="gi-ibtn" id="gi-btn-store" title="Store">🛒</button>' +
    '<button class="gi-ibtn" id="gi-btn-full" title="Full explorer">⤢</button>' +
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

  var counterObs = null;
  try {
    counterObs = new MutationObserver(function () {
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

function buildChrome() {
  var frag = document.createDocumentFragment();
  frag.appendChild(el('div', { id: 'gi-toasts', html: '' }));
  frag.appendChild(el('div', { id: 'gi-float', html: '' }));
  frag.appendChild(el('div', { id: 'gi-fade', html: '' }));
  frag.appendChild(el('div', { id: 'gi-full-overlay', class: 'gi-full-overlay', html:
    '<div class="gi-full-shell">' +
    '<canvas id="gi-full-canvas"></canvas>' +
    '<div class="gi-full-top">' +
    '<div class="gi-full-brand">🏝️ Grove Islands</div>' +
    '<div class="gi-full-ctrls">' +
    '<span class="gi-elo-pill" id="gi-full-elo">1200</span>' +
    '<button class="gi-fbtn" id="gi-full-store" title="Store">🛒</button>' +
    '<button class="gi-fbtn" id="gi-full-map" title="Archipelago">🗺️</button>' +
    '<button class="gi-fbtn" id="gi-full-close" title="Close">✕</button>' +
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
    '<div class="gi-chip" id="gi-full-chip">🌲</div>' +
    '<div class="gi-card-meta">' +
    '<div class="gi-name" id="gi-full-name">Temperate Forest</div>' +
    '<div class="gi-sub" id="gi-full-sub">Home island · pines & oaks</div>' +
    '</div>' +
    '<div class="gi-full-stat">🌳 <b id="gi-full-trees">0</b> trees · <span id="gi-full-meta">All time</span></div>' +
    '</div>' +
    '</div>' }));
  frag.appendChild(el('div', { id: 'gi-store-overlay', class: 'gi-modal-overlay', html:
    '<div class="gi-modal gi-store-panel">' +
    '<button class="gi-mclose" id="gi-store-close">✕</button>' +
    '<h2 class="gi-mtitle">The Grove Market</h2>' +
    '<div class="gi-elo-strip">⭐ <b id="gi-store-elo">1200</b> ELO — reach the requirement to unlock</div>' +
    '<div class="gi-tabs">' +
    '<button class="gi-tab-btn gi-tab-on" data-tab="islands">🏝️ Islands</button>' +
    '<button class="gi-tab-btn" data-tab="trees">🌳 Trees</button>' +
    '<button class="gi-tab-btn" data-tab="subjects">📐 Subjects</button>' +
    '</div>' +
    '<div class="gi-tab-body" id="gi-tab-islands"></div>' +
    '<div class="gi-tab-body" id="gi-tab-trees" style="display:none"></div>' +
    '<div class="gi-tab-body" id="gi-tab-subjects" style="display:none"></div>' +
    '</div>' }));
  frag.appendChild(el('div', { id: 'gi-map-overlay', class: 'gi-modal-overlay', html:
    '<div class="gi-modal gi-map-panel">' +
    '<button class="gi-mclose" id="gi-map-close">✕</button>' +
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
    fullPeriod = b.getAttribute('data-period') || 'all';
    setViewPeriod(fullPeriod);
  });
  document.getElementById('gi-reset').addEventListener('click', function () {
    try { localStorage.removeItem(LS_GROVE); } catch (e) {}
    location.reload();
  });
  var tabs = document.querySelectorAll('.gi-tab-btn');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function () {
      var t = this.getAttribute('data-tab');
      document.querySelectorAll('.gi-tab-btn').forEach(function (b) { b.classList.toggle('gi-tab-on', b === this); }.bind(this));
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
    if (document.getElementById('gi-store-overlay').classList.contains('open')) closeStore();
    if (document.getElementById('gi-map-overlay').classList.contains('open')) closeMap();
    if (fullOpen) closeFull();
  });
}

function loop() {
  raf = requestAnimationFrame(loop);
  var dt = Math.min(clock.getDelta(), 0.05);
  var t = clock.elapsedTime;
  waterMat.uniforms.uTime.value = t;
  if (world) {
    for (var i = 0; i < world.springs.length; i++) {
      var e = world.springs[i];
      e.vel += (e.target - e.scale) * 40 * dt;
      e.vel *= Math.exp(-6.5 * dt);
      e.scale = Math.max(0.01, e.scale + e.vel * dt);
      e.obj.scale.setScalar(e.scale);
      e.obj.rotation.z = Math.sin(t * 1.15 + e.phase) * e.amp;
      e.obj.rotation.x = Math.cos(t * 0.9 + e.phase) * e.amp * 0.6;
    }
    for (var a = 0; a < world.animals.length; a++) {
      var an = world.animals[a];
      an.obj.position.y = an.baseY + Math.abs(Math.sin(t * 2.2 + an.phase)) * 0.05;
      an.obj.rotation.y += dt * 0.12;
    }
    if (motionOK()) world.particles.update(dt, t);
  }
  if (fullOpen && fullRenderer && fullCam && fullOrbit) {
    fullOrbit.tick(dt);
    fullRenderer.render(scene, fullCam);
  } else if (miniRenderer && miniCam && miniVisible) {
    if (motionOK()) miniAz += dt * 0.12;
    var cd = clamp((world ? world.radius : ISLAND_R) * 1.25, 13.5, 60);
    miniCam.position.set(Math.sin(miniAz) * cd, 7.5, Math.cos(miniAz) * cd);
    miniCam.lookAt(0, 2.1, 0);
    miniRenderer.render(scene, miniCam);
  }
}

function startLoop() {
  if (raf != null) return;
  raf = requestAnimationFrame(loop);
}

function boot() {
  buildChrome();
  mountCard();
  seenDay = todayKey();
  var firstRun = !localStorage.getItem(LS_GROVE);
  ensureThree().then(async function () {
    await restoreFromIDB();
    initScene();
    var bio = biomeById(grove.activeBiome);
    applyEnvironment(bio);
    buildWorld(bio, viewFor(bio.id, 'today'));
    syncTrees(true);
    startLoop();
    sizeCanvases();
    var dash0 = document.getElementById('view-dashboard');
    var card0 = document.getElementById('gi-host');
    miniVisible = !!(card0 && card0.offsetParent !== null && dash0 && dash0.classList.contains('active'));
    tick(true);
    setInterval(function () { tick(false); }, 1500);
    setInterval(function () {
      var dash = document.getElementById('view-dashboard');
      var card = document.getElementById('gi-host');
      miniVisible = !!(card && card.offsetParent !== null && dash && dash.classList.contains('active')) && !fullOpen;
    }, 800);
    updateHUD();
    renderMapIfOpen();
    if (firstRun) setTimeout(function () { toast('🌱 Welcome to the Grove Islands! Answer questions to grow trees. Unlock islands & species in the 🛒 store by raising your ELO.'); }, 900);
  }).catch(function (e) {
    warn('Could not load the 3D engine: ' + (e && e.message ? e.message : e));
  });
  window.addEventListener('resize', sizeCanvases);
  window.addEventListener('visibilitychange', function () { if (!document.hidden) tick(false); });
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
  trees: function () { return world ? world.trees.size : 0; },
  view: function () { return { period: viewPeriod, slots: world ? world.slots.length : 0, agg: world ? periodCount(world.biomeId, viewPeriod) : null }; }
};
})();
