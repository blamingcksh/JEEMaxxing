// ==================== GALLERY BREAK MODULE ====================
// "The Burn Reveal" — when a pomodoro break starts, the app dissolves away
// from the center of the screen, slowly developing a public-domain painting
// underneath like a print coming up in a developer bath. The reveal radius
// tracks break progress (pausing the timer freezes the bloom mid-spread).
// At 100% a quote fades in and an understated Continue button blooms back
// into the next session.
//
// Edge treatment v2 — SOFT BLOOM (replaces the char-band / ember-stroke look):
//   • no hard strokes anywhere. The art is masked through an offscreen alpha
//     canvas with a radial-gradient falloff band (feathered, organic).
//   • the boundary undulates on low-frequency liquid noise (Catmull-Rom
//     smoothed), never jagged per-vertex randomness.
//   • "bleed spots" — small soft reveals seep ahead of the main edge like
//     paint wicking through paper fiber, plus a faint ghost halo further out.
//   • the edge aura is color-sampled from the painting itself, so the glow
//     always matches the art's own palette.
//   • print grain over the revealed surface + slow dust motes in the light.
//
// Owned by pomodoro.js:
//   GalleryBreak.begin()            — at transitionToBreak()
//   GalleryBreak.setProgress(0..1)  — every tick while pomoState === 'BREAK'
//   GalleryBreak.finish(onContinue) — at handleTimerEnd() BREAK branch
//   GalleryBreak.abort()            — skip break / quit / reset (safe no-op)
//
// Self-contained: renders on its own canvas, no DOM assumed in index.html.
// Art is fetched once from Wikimedia Commons and cached in IndexedDB so
// later breaks work offline; if the image can't load a procedural
// "aurora" painting is generated so the ritual never breaks.

import { idbSet, idbGet } from './storage.js';

// ── Art + quote pool (public domain) ────────────────────────────────────────
const _wiki = (file) => file;

const PAINTINGS = [
  {
    id: 'starry-night', title: 'The Starry Night', artist: 'Vincent van Gogh', year: 1889,
    file: _wiki('Van Gogh - Starry Night - Google Art Project.jpg'),
    quote: '“For my part I know nothing with any certainty, but the sight of the stars makes me dream.”',
    by: 'Vincent van Gogh',
  },
  {
    id: 'great-wave', title: 'The Great Wave off Kanagawa', artist: 'Hokusai', year: 1831,
    file: _wiki('Tsunami by hokusai 19th century.jpg'),
    quote: '“At seventy-three I began to grasp the structures of birds and beasts, insects and fish.” Keep going.',
    by: 'Katsushika Hokusai',
  },
  {
    id: 'wanderer-fog', title: 'Wanderer above the Sea of Fog', artist: 'Caspar David Friedrich', year: 1818,
    file: _wiki('Caspar David Friedrich - Wanderer above the sea of fog.jpg'),
    quote: '“The climb is lonely. The view is not.”',
    by: null,
  },
  {
    id: 'impression-sunrise', title: 'Impression, Sunrise', artist: 'Claude Monet', year: 1872,
    file: _wiki('Monet - Impression, Sunrise.jpg'),
    quote: '“I would like to paint the way a bird sings.” Solve the way a bird sings.',
    by: 'Claude Monet',
  },
  {
    id: 'fighting-temeraire', title: 'The Fighting Temeraire', artist: 'J.M.W. Turner', year: 1839,
    file: _wiki('Turner, J. M. W. - The Fighting Téméraire tugged to her last Berth to be broken.jpg'),
    quote: '“My business is to paint what I see, not what I know is there.” Trust what the attempt shows you.',
    by: 'J.M.W. Turner',
  },
  {
    id: 'wheatfield-cypresses', title: 'A Wheatfield, with Cypresses', artist: 'Vincent van Gogh', year: 1889,
    file: _wiki('Vincent van Gogh - Wheat Field with Cypresses - Google Art Project.jpg'),
    quote: '“Great things are done by a series of small things brought together.”',
    by: 'Vincent van Gogh',
  },
  {
    id: 'pearl-earring', title: 'Girl with a Pearl Earring', artist: 'Johannes Vermeer', year: 1665,
    file: _wiki('1665 Girl with a Pearl Earring.jpg'),
    quote: 'Mastery is quiet. It shows up every day and says nothing.',
    by: null,
  },
  {
    id: 'ninth-wave', title: 'The Ninth Wave', artist: 'Ivan Aivazovsky', year: 1850,
    file: _wiki('Aivazovsky, Ivan - The Ninth Wave.jpg'),
    quote: 'The wave that looks like the end is the one that carries you to shore.',
    by: null,
  },
  {
    id: 'sierra-nevada', title: 'Among the Sierra Nevada', artist: 'Albert Bierstadt', year: 1868,
    file: _wiki('Albert Bierstadt - Among the Sierra Nevada, California - Google Art Project.jpg'),
    quote: 'Rest is not the opposite of progress. It is part of its machinery.',
    by: null,
  },
  {
    id: 'shin-ohashi', title: 'Sudden Shower over Shin-Ōhashi', artist: 'Hiroshige', year: 1857,
    file: _wiki('Hiroshige Atake sous une averse soudaine.jpg'),
    quote: 'Storms pass. The bridge you built by practicing stays.',
    by: null,
  },
];

const ROTATION_KEY = 'jeemax_gallery_rotation_v1';
const ART_CACHE_PREFIX = 'galleryArt:';

// ── Tuning ──────────────────────────────────────────────────────────────────
const TUNING = {
  // ── reveal pacing ──
  easePerFrame: 0.045,          // display chases timer progress (per rAF frame)
  blockThreshold: 0.30,         // overlay starts swallowing pointer events here
  reverseDurationMs: 1800,      // Continue → bloom back into the app
  abortFadeMs: 350,             // skip-break teardown fade
  quoteDelayMs: 600,            // full reveal → quote fade-in
  continueDelayMs: 2000,        // quote → Continue appears

  // ── soft-edge system ──
  pathSamples: 96,              // boundary samples (Catmull-Rom smoothed)
  featherFrac: 0.16,            // falloff band as a fraction of radius
  featherMinPx: 52,             // floor so the very first bloom is pillowy
  wobble: [                     // liquid undulation octaves — low-frequency
                                // body plus mid/high traveling ripples so the
                                // boundary is never a still, rigid ring.
    { lobes: 2, amp: 0.030, speed:  0.00021, phase: 0.0 },
    { lobes: 3, amp: 0.017, speed: -0.00013, phase: 2.1 },
    { lobes: 5, amp: 0.008, speed:  0.00034, phase: 4.4 },
    { lobes: 9, amp: 0.011, speed:  0.00055, phase: 0.8 },    // traveling ripple
    { lobes: 15, amp: 0.006, speed: -0.00080, phase: 3.3 },   // fine edge shimmer
  ],
  breatheAmp: 0.004,            // whole-boundary slow breathing
  glowBlobs: 22,                // edge-light sprites flickering around the rim
  glowBase: 0.10,               // blob alpha floor
  glowTravel: 0.22,             // traveling-wave alpha lift
  bleedSpots: 9,                // seep-through reveals ahead of the edge
  mottleCount: 12,              // fibrous texture dots inside the fade band
  ghostAlpha: 0.07,             // faint moisture-halo mask ahead of the edge
  grainAlpha: 0.055,            // print grain over revealed art
  grainSize: 160,               // noise tile px
  moteCount: 26,                // dust-in-light particles
  auraOuterAlpha: 0.10,         // wide art-tinted halo
  auraInnerAlpha: 0.16,         // thin wet-edge shimmer

  // ── v3 cinematic layer ──
  vignetteMax: 0.42,            // screen-edge spotlight dim at full reveal
  sheenAlpha: 0.10,             // wet-print luminosity while the edge spreads
  sheenDecay: 0.985,            // sheen settle speed per frame (dries out)
  raysCount: 4,                 // god-ray beams in the revealed light
  raysAlpha: 0.06,              // beam luminosity
  raysSpin: 0.000025,           // beam rotation rad/ms
  bokehCount: 16,               // full-reveal particle bloom
  crackleGain: 0.30,            // paper-crackle master volume (was missing!)
};

// ── Module state ────────────────────────────────────────────────────────────
let _overlay = null, _canvas = null, _ctx = null, _quoteBox = null;
let _maskCanvas = null, _maskCtx = null;   // offscreen alpha mask
let _active = false, _finishing = false, _reversing = false;
let _target = 0;          // timer-driven progress 0..1
let _display = 0;         // eased, what's actually painted
let _raf = null;
let _art = null;          // ImageBitmap | HTMLImageElement | canvas (fallback)
let _painting = null;     // metadata of current painting
let _artTint = { r: 255, g: 231, b: 201 };  // color sampled from the art (warm ivory fallback)
let _bleeds = [];         // seeded seep-through spots
let _mottle = [];         // seeded fibrous texture dots
let _motes = [];          // drifting dust particles
let _grainTile = null;    // lazy noise tile
let _onContinue = null;
let _reduceMotion = false;
let _audio = null;        // { ctx, gain, src }
let _sheen = 0;           // wet-print luminosity — 1 while spreading, settles down
let _rays = [];           // god-ray descriptors
let _bokeh = [];          // full-reveal bloom particles
let _bloomFired = false;  // bokeh burst fires once per break
let _glowSprite = null;   // cached soft radial light sprite (per art tint)
let _glowSpriteKey = null;

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

function begin() {
  if (_active) abort(true);   // stale overlay from a weird path — hard reset
  _active = true;
  _finishing = false;
  _reversing = false;
  _target = 0;
  _display = 0;
  _onContinue = null;
  _artTint = { r: 255, g: 231, b: 201 };

  _reduceMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Fresh organic texture each break so no two blooms look alike
  _seedTexture();

  _buildDom();
  _painting = _pickPainting();
  _loadArt(_painting).then(img => {
    _art = img;
    _computeArtTint();
  }).catch(() => {
    _art = _proceduralArt();
    _computeArtTint();
  });
  _startCrackle();
  _raf = requestAnimationFrame(_frame);
}

/** p: 0..1 break progress. Called from the pomodoro tick — pausing the timer
    stops the calls, freezing the bloom mid-spread (aura keeps breathing). */
function setProgress(p) {
  if (!_active || _finishing) return;
  _target = Math.max(0, Math.min(1, p));
}

/** Break timer hit zero: drive to full reveal, then quote → Continue. */
function finish(onContinue) {
  if (!_active) { if (typeof onContinue === 'function') onContinue(); return; }
  _finishing = true;
  _target = 1;
  _onContinue = (typeof onContinue === 'function') ? onContinue : null;
}

/** Skip break / quit / reset — dissolve out instantly. Safe no-op when idle. */
function abort(immediate = false) {
  if (!_active) return;
  _active = false;
  _finishing = false;
  _stopCrackle();
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  const el = _overlay;
  _overlay = null; _canvas = null; _ctx = null; _quoteBox = null;
  _maskCanvas = null; _maskCtx = null; _art = null;
  if (!el) return;
  if (immediate) { el.remove(); return; }
  el.style.transition = `opacity ${TUNING.abortFadeMs}ms ease`;
  el.style.opacity = '0';
  setTimeout(() => el.remove(), TUNING.abortFadeMs + 60);
}

function isActive() { return _active; }

export const GalleryBreak = { begin, setProgress, finish, abort, isActive };
window.GalleryBreak = GalleryBreak;

// ═══════════════════════════════════════════════════════════════════════════
//  TEXTURE SEEDING (fresh every break)
// ═══════════════════════════════════════════════════════════════════════════

function _seedTexture() {
  // Bleed spots ride just ahead of the edge — paint seeping through fibers.
  _bleeds = Array.from({ length: TUNING.bleedSpots }, (_, i) => ({
    angle: (i / TUNING.bleedSpots) * Math.PI * 2 + Math.random() * 0.55,
    drift: (Math.random() - 0.5) * 0.00006,      // slow angular wander
    distFrac: 0.15 + Math.random() * 0.85,       // feather-units past the edge
    size: 10 + Math.random() * 26,
    alpha: 0.18 + Math.random() * 0.22,
    pulseSpeed: 0.0006 + Math.random() * 0.0009,
    phase: Math.random() * Math.PI * 2,
  }));

  // Mottling breaks up the gradient band so the fade feels fibrous, not airbrushed.
  _mottle = Array.from({ length: TUNING.mottleCount }, () => ({
    angle: Math.random() * Math.PI * 2,
    drift: (Math.random() - 0.5) * 0.00004,
    distFrac: 0.84 + Math.random() * 0.22,       // inside the fade band
    size: 14 + Math.random() * 30,
    alpha: 0.10 + Math.random() * 0.14,
  }));

  // Dust motes drift inside the revealed light.
  _motes = Array.from({ length: TUNING.moteCount }, () => ({
    angle: Math.random() * Math.PI * 2,
    dist: 0.55 + Math.random() * 0.42,           // fraction of current radius
    orbit: (Math.random() - 0.5) * 0.00012,
    bob: 4 + Math.random() * 10,
    bobSpeed: 0.0004 + Math.random() * 0.0008,
    phase: Math.random() * Math.PI * 2,
    size: 0.8 + Math.random() * 1.8,
    alpha: 0.05 + Math.random() * 0.16,
    twinkle: 0.0008 + Math.random() * 0.0015,
  }));

  // God-ray beams: a few wide light shafts, each with its own base angle and
  // rotation direction so no two breaks show the same light.
  _rays = Array.from({ length: TUNING.raysCount }, (_, i) => ({
    angle: (i / TUNING.raysCount) * Math.PI * 2 + Math.random() * 0.5,
    dir: (Math.random() < 0.5 ? -1 : 1),
    alpha: 0.5 + Math.random() * 0.5,
  }));

  // Fresh state for the reveal settle + bloom.
  _sheen = 0;
  _bokeh = [];
  _bloomFired = false;
}

/** Sample the art's average color and lift it toward luminous — this becomes
    the aura / mote palette, so the edge glow always matches the painting. */
function _computeArtTint() {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 12;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(_art, 0, 0, 12, 12);
    const d = g.getImageData(0, 0, 12, 12).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    r = Math.round(r / n); gg = Math.round(gg / n); b = Math.round(b / n);
    const lift = (v, w) => Math.round(v + (255 - v) * w);   // mix toward warm white
    _artTint = { r: lift(r, 0.45), g: lift(gg, 0.50), b: lift(b, 0.42) };
  } catch (_) {
    _artTint = { r: 255, g: 231, b: 201 };   // tainted canvas / missing art → warm ivory
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  DOM
// ═══════════════════════════════════════════════════════════════════════════

function _buildDom() {
  _overlay = document.createElement('div');
  _overlay.id = 'gallery-break-overlay';
  _overlay.innerHTML = `
    <canvas id="gb-canvas"></canvas>
    <div class="gb-quote-box" id="gb-quote-box">
      <div class="gb-plaque" id="gb-plaque"></div>
      <div class="gb-quote" id="gb-quote"></div>
      <div class="gb-quote-by" id="gb-quote-by"></div>
      <button type="button" class="gb-continue" id="gb-continue">Continue</button>
    </div>`;
  document.body.appendChild(_overlay);

  _canvas = _overlay.querySelector('#gb-canvas');
  _ctx = _canvas.getContext('2d');
  _quoteBox = _overlay.querySelector('#gb-quote-box');
  _overlay.querySelector('#gb-continue').addEventListener('click', _onContinueClick);

  // Offscreen alpha mask — the soft edge is composed here, then stamped onto
  // the art with destination-in. Keeps the main canvas free of hard geometry.
  _maskCanvas = document.createElement('canvas');
  _maskCtx = _maskCanvas.getContext('2d');

  _resize();
  window.addEventListener('resize', _resize);
}

function _resize() {
  if (!_canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  _canvas.width = Math.round(window.innerWidth * dpr);
  _canvas.height = Math.round(window.innerHeight * dpr);
  _canvas.style.width = window.innerWidth + 'px';
  _canvas.style.height = window.innerHeight + 'px';
  _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (_maskCanvas) {
    _maskCanvas.width = _canvas.width;
    _maskCanvas.height = _canvas.height;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  RENDER LOOP
// ═══════════════════════════════════════════════════════════════════════════

function _frame(now) {
  if (!_active) return;

  // Timer progress is the only reveal governor. Keep the same easing while
  // finishing so the final frames cannot lurch across the screen.
  const target = _target;

  // Ease display toward target (both directions — "Add 5 min" re-covers)
  const step = TUNING.easePerFrame;
  _display += (target - _display) * step;
  if (Math.abs(target - _display) < 0.0004) _display = target;

  // Wet-print sheen: hot while the edge is actively spreading, dries out when
  // the bloom freezes or finishes — like developer liquid settling on paper.
  _sheen = (Math.abs(target - _display) > 0.0015) ? 1 : (_sheen * TUNING.sheenDecay);

  // Fully revealed after finish() → one-shot particle bloom over the print.
  // Gated on motion+FX prefs like every other v3 layer (no motion, no bloom).
  if (_finishing && !_reversing && _display >= 0.985 && !_bloomFired
      && !_reduceMotion && _wantEffects()) {
    _bloomFired = true;
    _burstBokeh();
  }

  _paint(now);

  // The bloom is the enforcement: past the threshold the overlay blocks input
  _overlay.style.pointerEvents =
    (_display > TUNING.blockThreshold) ? 'auto' : 'none';

  _setCrackleIntensity(Math.abs(target - _display));

  // Fully revealed after finish() → quote ritual
  if (_finishing && !_reversing && _display >= 0.995 && !_quoteBox.classList.contains('gb-show')) {
    setTimeout(_showQuote, TUNING.quoteDelayMs);
    _quoteBox.classList.add('gb-show'); // guard flag; visual class below
  }

  _raf = requestAnimationFrame(_frame);
}

function _paint(now) {
  const w = window.innerWidth, h = window.innerHeight;
  const cx = w / 2, cy = h / 2;
  // 1.15 overshoot so the feathered edge fully clears the corners at 100%
  const maxR = Math.hypot(w, h) / 2 * 1.15;
  const eased = _easeInOutSine(_display);
  const baseR = eased * maxR;

  _ctx.clearRect(0, 0, w, h);
  if (baseR < 2 || !_art) return;

  const fullyOpen = _display >= 0.999;

  // 1 ─ art layer (static — the slow reveal does the moving)
  _ctx.save();
  _drawArtCover(w, h);

  if (!fullyOpen) {
    // 2 ─ soft organic mask: feathered gradient + bleed spots + mottling,
    //     composed offscreen, then multiplied onto the art's alpha channel.
    _buildMask(cx, cy, baseR, now);
    _ctx.globalCompositeOperation = 'destination-in';
    _ctx.drawImage(_maskCanvas, 0, 0, w, h);
  }

  // 3 ─ print grain, only where art pixels exist
  _ctx.globalCompositeOperation = 'source-atop';
  _drawGrain(w, h, now);

  // 3.5 ─ wet sheen + god rays, confined to revealed art pixels
  if (!fullyOpen && !_reduceMotion && _wantEffects()) {
    _ctx.globalCompositeOperation = 'source-atop';
    _drawSheen(cx, cy, baseR, now);
    _drawRays(cx, cy, baseR, now);
  }
  _ctx.restore();

  // 6 ─ museum spotlight: dim the screen edges as the painting takes over.
  //     Drawn over the art like light falling in a gallery. Runs in BOTH the
  //     partial and fully-open states so the deepest dim lands at 100%.
  _drawVignette(cx, cy, maxR, now);

  if (fullyOpen) {
    _drawBokeh(cx, cy, now);   // settle particles drift over the finished print
    return;                    // fully open — no aura, no motes
  }

  // 4 ─ art-tinted halo + wet-edge shimmer (additive light, no hard lines)
  _drawAura(cx, cy, baseR, now);

  // 5 ─ dust drifting in the revealed light
  _drawMotes(cx, cy, baseR, now);

  // 7 ─ settle bloom drifts over the painting even before the very last frame
  _drawBokeh(cx, cy, now);
}

// ═══════════════════════════════════════════════════════════════════════════
//  SOFT EDGE — organic path + feathered mask
// ═══════════════════════════════════════════════════════════════════════════

/** Sample points of the smooth closed organic boundary: multi-octave undulation
    including mid/high-frequency traveling ripples, Catmull-Rom smoothed. */
function _organicPts(cx, cy, r, now) {
  const n = TUNING.pathSamples;
  const breathe = _reduceMotion ? 0 : TUNING.breatheAmp * Math.sin(now * 0.0006);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    let m = 1 + breathe;
    for (const w of TUNING.wobble) {
      m += (_reduceMotion ? 0 : w.amp) * Math.sin(w.lobes * th + now * w.speed + w.phase);
    }
    pts.push([cx + Math.cos(th) * r * m, cy + Math.sin(th) * r * m]);
  }
  return pts;
}

function _organicPathFromPts(pts) {
  const n = pts.length;
  const path = new Path2D();
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i];
    const p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    if (i === 0) path.moveTo(p1[0], p1[1]);
    path.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p2[0], p2[1]);
  }
  path.closePath();
  return path;
}

function _organicPath(cx, cy, r, now) {
  return _organicPathFromPts(_organicPts(cx, cy, r, now));
}

/** Compose the alpha mask offscreen: main feathered reveal + ghost halo +
    bleed spots + fibrous mottling. All soft radial gradients — zero strokes. */
function _buildMask(cx, cy, r, now) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const mg = _maskCtx;
  mg.setTransform(1, 0, 0, 1, 0, 0);
  mg.clearRect(0, 0, _maskCanvas.width, _maskCanvas.height);
  mg.setTransform(dpr, 0, 0, dpr, 0, 0);

  const feather = Math.max(TUNING.featherMinPx, r * TUNING.featherFrac);
  const edgeR = r + feather * 0.45;

  // ── main reveal: radial falloff band clipped by the organic boundary ──
  const grad = mg.createRadialGradient(cx, cy, Math.max(1, r - feather), cx, cy, edgeR);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  mg.fillStyle = grad;
  mg.fill(_organicPath(cx, cy, edgeR, now));

  // ── ghost halo: faint moisture spreading ahead of where the edge is going ──
  const ghostR = r + feather * 1.4;
  const gg = mg.createRadialGradient(cx, cy, Math.max(1, edgeR - feather * 0.4), cx, cy, ghostR);
  gg.addColorStop(0, `rgba(255,255,255,${TUNING.ghostAlpha})`);
  gg.addColorStop(1, 'rgba(255,255,255,0)');
  mg.fillStyle = gg;
  mg.fill(_organicPath(cx, cy, ghostR, now + 6000));   // time-offset → different undulation

  // ── bleed spots: little soft reveals seeping through ahead of the edge ──
  const spotScale = Math.min(1.6, Math.max(0.6, r / 520));
  for (const s of _bleeds) {
    const a = s.angle + now * s.drift;
    const d = r + feather * (s.distFrac - 0.25);
    if (d < 4) continue;
    const sx = cx + Math.cos(a) * d;
    const sy = cy + Math.sin(a) * d;
    const pulse = _reduceMotion ? 1 : (0.7 + 0.3 * Math.sin(now * s.pulseSpeed + s.phase));
    const sr = Math.max(3, s.size * pulse * spotScale);
    const bg = mg.createRadialGradient(sx, sy, 0, sx, sy, sr);
    bg.addColorStop(0, `rgba(255,255,255,${s.alpha})`);
    bg.addColorStop(1, 'rgba(255,255,255,0)');
    mg.fillStyle = bg;
    mg.beginPath(); mg.arc(sx, sy, sr, 0, Math.PI * 2); mg.fill();
  }

  // ── fibrous mottling inside the fade band ──
  const motScale = Math.min(1.5, Math.max(0.7, r / 480));
  for (const m of _mottle) {
    const a = m.angle + now * m.drift;
    const mx = cx + Math.cos(a) * r * m.distFrac;
    const my = cy + Math.sin(a) * r * m.distFrac;
    const mr = m.size * motScale;
    const mgrad = mg.createRadialGradient(mx, my, 0, mx, my, mr);
    mgrad.addColorStop(0, `rgba(255,255,255,${m.alpha})`);
    mgrad.addColorStop(1, 'rgba(255,255,255,0)');
    mg.fillStyle = mgrad;
    mg.beginPath(); mg.arc(mx, my, mr, 0, Math.PI * 2); mg.fill();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  AURA · MOTES · GRAIN
// ═══════════════════════════════════════════════════════════════════════════

/** Art-tinted light hugging the boundary — a blurred base bed plus living
    flickering light sprites riding the rim, so the glow reads as uneven,
    organic light instead of a rigid tube. A slow wave circles the edge. */
function _drawAura(cx, cy, r, now) {
  const t = _artTint;
  const breathe = _reduceMotion ? 0.8 : (0.7 + 0.3 * Math.sin(now / 1400));
  const pts = _organicPts(cx, cy, r, now);
  const path = _organicPathFromPts(pts);
  _ctx.save();
  _ctx.globalCompositeOperation = 'lighter';

  // 1 ─ wide soft halo bed (blurred, low alpha — no hard outline)
  _ctx.shadowColor = `rgba(${t.r},${t.g},${t.b},0.8)`;
  _ctx.shadowBlur = _reduceMotion ? 22 : 40;
  _ctx.strokeStyle = `rgba(${t.r},${t.g},${t.b},${(TUNING.auraOuterAlpha * breathe * 0.7).toFixed(3)})`;
  _ctx.lineWidth = 24;
  _ctx.stroke(path);

  // 2 ─ living edge light: sprites flicker individually + a wave travels the
  //     rim, so the border glows unevenly like light caught on wet paint.
  if (!_reduceMotion && _wantEffects()) {
    _ensureGlowSprite(t);
    const step = Math.max(1, Math.floor(pts.length / TUNING.glowBlobs));
    for (let i = 0; i < pts.length; i += step) {
      const p = pts[i];
      const th = (i / pts.length) * Math.PI * 2;
      const travel = 0.5 + 0.5 * Math.sin(th * 3 - now * 0.0012);   // wave circling
      const flicker = 0.5 + 0.5 * Math.sin(now * 0.002 + i * 1.7);  // per-blob twinkle
      const a = (TUNING.glowBase + TUNING.glowTravel * travel) * flicker * breathe;
      if (a < 0.012) continue;
      const sz = (56 + 44 * travel) * (0.85 + 0.3 * flicker);
      _ctx.globalAlpha = a;
      _ctx.drawImage(_glowSprite, p[0] - sz / 2, p[1] - sz / 2, sz, sz);
    }
    _ctx.globalAlpha = 1;
  }

  // 3 ─ thin wet-edge shimmer (kept subtle — the sprites carry the character)
  _ctx.shadowBlur = 10;
  _ctx.strokeStyle = `rgba(255,250,240,${(TUNING.auraInnerAlpha * breathe * 0.7).toFixed(3)})`;
  _ctx.lineWidth = 2.5;
  _ctx.stroke(path);
  _ctx.restore();
}

/** Cached soft radial light sprite, re-keyed when the art tint changes. */
function _ensureGlowSprite(t) {
  const key = `${t.r},${t.g},${t.b}`;
  if (_glowSprite && _glowSpriteKey === key) return;
  _glowSpriteKey = key;
  const s = 96;
  _glowSprite = document.createElement('canvas');
  _glowSprite.width = _glowSprite.height = s;
  const g = _glowSprite.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.45, `rgba(${t.r},${t.g},${t.b},0.5)`);
  grad.addColorStop(1, `rgba(${t.r},${t.g},${t.b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
}

/** Slow dust motes drifting inside the revealed light, tinted to the art. */
function _drawMotes(cx, cy, r, now) {
  if (_reduceMotion) return;
  const t = _artTint;
  _ctx.save();
  _ctx.globalCompositeOperation = 'lighter';
  for (const m of _motes) {
    const a = m.angle + now * m.orbit;
    const d = r * m.dist + Math.sin(now * m.bobSpeed + m.phase) * m.bob;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const tw = 0.5 + 0.5 * Math.sin(now * m.twinkle + m.phase);
    const alpha = m.alpha * tw;
    if (alpha < 0.01) continue;
    _ctx.fillStyle = `rgba(${t.r},${t.g},${t.b},${(alpha * 0.35).toFixed(3)})`;
    _ctx.beginPath(); _ctx.arc(x, y, m.size * 2.4, 0, Math.PI * 2); _ctx.fill();
    _ctx.fillStyle = `rgba(255,252,246,${alpha.toFixed(3)})`;
    _ctx.beginPath(); _ctx.arc(x, y, m.size, 0, Math.PI * 2); _ctx.fill();
  }
  _ctx.restore();
}

/** Respect the app's global FX toggle (Config → effects). Mirrors the
    forest-island convention: html.fx-effects-off disables the fancy layers. */
function _wantEffects() {
  try { return !document.documentElement.classList.contains('fx-effects-off'); } catch (_) { return true; }
}

/** Museum spotlight: a soft dark vignette toward the screen edges, deepening
    as the reveal spreads — the painting becomes the only lit thing in the room.
    Drawn last, over the art, so it reads as gallery light falling on a wall. */
function _drawVignette(cx, cy, maxR, now) {
  if (_reduceMotion || !_wantEffects()) return;
  const k = _display;
  if (k < 0.02) return;
  const breathe = _reduceMotion ? 1 : (0.85 + 0.15 * Math.sin(now / 2600));
  const a = TUNING.vignetteMax * k * breathe;
  const g = _ctx.createRadialGradient(cx, cy, maxR * 0.45, cx, cy, maxR * 1.02);
  g.addColorStop(0, 'rgba(4,5,9,0)');
  g.addColorStop(1, `rgba(4,5,9,${a.toFixed(3)})`);
  _ctx.fillStyle = g;
  _ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
}


/** Wet-print sheen: a soft luminous bloom on freshly-spread art. Hot while the
    edge is moving, dries out when the bloom freezes — developer liquid settling. */
function _drawSheen(cx, cy, baseR, now) {
  if (_sheen < 0.02) return;
  const t = _artTint;
  const r = baseR * 1.15;
  const g = _ctx.createRadialGradient(cx, cy, r * 0.25, cx, cy, r);
  g.addColorStop(0, `rgba(${t.r},${t.g},${t.b},${(_sheen * TUNING.sheenAlpha).toFixed(3)})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  _ctx.fillStyle = g;
  _ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

/** God rays: a few slow-rotating beams of light in the revealed area, tinted
    to the art's palette. source-atop at the caller keeps them on the print. */
function _drawRays(cx, cy, baseR, now) {
  if (_reduceMotion || !_wantEffects() || baseR < 40) return;
  const t = _artTint;
  const len = baseR * 1.5;
  const half = len * 0.14;
  for (const r of _rays) {
    const a = r.angle + now * TUNING.raysSpin * r.dir;
    const cos = Math.cos(a), sin = Math.sin(a);
    const px = cos * len, py = sin * len;
    const ox = -sin * half, oy = cos * half;
    const alpha = TUNING.raysAlpha * r.alpha;
    const g = _ctx.createLinearGradient(cx, cy, cx + px, cy + py);
    g.addColorStop(0, `rgba(${t.r},${t.g},${t.b},${(alpha * 0.7).toFixed(3)})`);
    g.addColorStop(1, `rgba(${t.r},${t.g},${t.b},0)`);
    _ctx.fillStyle = g;
    _ctx.beginPath();
    _ctx.moveTo(cx + ox, cy + oy);
    _ctx.lineTo(cx - ox, cy - oy);
    _ctx.lineTo(cx + px - ox, cy + py - oy);
    _ctx.lineTo(cx + px + ox, cy + py + oy);
    _ctx.closePath();
    _ctx.fill();
  }
}

/** One-shot bloom at full reveal: soft light particles drift up and settle,
    like dust kicked up when the print finally comes to rest. */
function _burstBokeh() {
  _bokeh = Array.from({ length: TUNING.bokehCount }, () => ({
    angle: Math.random() * Math.PI * 2,
    dist: 0.2 + Math.random() * 0.6,
    size: 2 + Math.random() * 5,
    born: performance.now(),
    life: 2600 + Math.random() * 2400,
    rise: 0.02 + Math.random() * 0.06,
    drift: (Math.random() - 0.5) * 0.00012,
    tw: 0.001 + Math.random() * 0.0015,
    phase: Math.random() * Math.PI * 2,
  }));
}

function _drawBokeh(cx, cy, now) {
  if (_reduceMotion || !_wantEffects() || !_bokeh.length) return;
  const t = _artTint;
  const w = window.innerWidth, h = window.innerHeight;
  const maxR = Math.hypot(w, h) / 2;
  const alive = [];
  _ctx.save();
  _ctx.globalCompositeOperation = 'lighter';
  for (const p of _bokeh) {
    const age = now - p.born;
    const k = 1 - age / p.life;
    if (k <= 0) continue;
    alive.push(p);
    const a = p.angle + age * p.drift;
    const d = Math.min(maxR, p.dist * maxR + age * p.rise * 8);
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d - age * 0.012;
    const tw = 0.5 + 0.5 * Math.sin(age * p.tw + p.phase);
    const alpha = p.size * 0.06 * k * tw;
    if (alpha < 0.01) continue;
    _ctx.fillStyle = `rgba(${t.r},${t.g},${t.b},${(alpha * 0.5).toFixed(3)})`;
    _ctx.beginPath(); _ctx.arc(x, y, p.size * 2.2, 0, Math.PI * 2); _ctx.fill();
    _ctx.fillStyle = `rgba(255,252,246,${(alpha).toFixed(3)})`;
    _ctx.beginPath(); _ctx.arc(x, y, p.size, 0, Math.PI * 2); _ctx.fill();
  }
  _bokeh = alive;
  _ctx.restore();
}

function _ensureGrainTile() {
  if (_grainTile) return;
  const s = TUNING.grainSize;
  _grainTile = document.createElement('canvas');
  _grainTile.width = _grainTile.height = s;
  const g = _grainTile.getContext('2d');
  const img = g.createImageData(s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 118 + Math.random() * 60;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

/** Faint print grain over the revealed surface only (source-atop at caller).
    Jumps a few px every ~200ms so it reads as living film grain, not static. */
function _drawGrain(w, h, now) {
  _ensureGrainTile();
  _ctx.save();
  _ctx.globalAlpha = TUNING.grainAlpha;
  if (!_reduceMotion) {
    const jx = Math.floor(now / 180) % 3, jy = Math.floor(now / 230) % 3;
    _ctx.translate(jx * 5, jy * 7);
  }
  _ctx.fillStyle = _ctx.createPattern(_grainTile, 'repeat');
  _ctx.fillRect(-20, -20, w + 40, h + 40);
  _ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════════
//  ART LAYER
// ═══════════════════════════════════════════════════════════════════════════

function _drawArtCover(w, h) {
  const iw = _art.width, ih = _art.height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale, dh = ih * scale;
  // Static: the painting sits perfectly still while the reveal slowly develops
  // it — motion belongs to the edge, not the art.
  _ctx.drawImage(_art, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function _easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }

// ═══════════════════════════════════════════════════════════════════════════
//  QUOTE + CONTINUE
// ═══════════════════════════════════════════════════════════════════════════

function _showQuote() {
  if (!_active || !_quoteBox) return;
  _overlay.style.pointerEvents = 'auto';
  _quoteBox.querySelector('#gb-plaque').textContent =
    `${_painting.title} · ${_painting.artist}, ${_painting.year}`;
  _quoteBox.querySelector('#gb-quote').textContent = _painting.quote;
  _quoteBox.querySelector('#gb-quote-by').textContent = _painting.by ? '— ' + _painting.by : '';
  _quoteBox.classList.add('gb-visible');
  _chime();
  setTimeout(() => {
    if (_active && _quoteBox) _quoteBox.classList.add('gb-ready');
  }, TUNING.continueDelayMs);
}

function _onContinueClick() {
  if (!_active || _reversing) return;
  _reversing = true;
  _quoteBox.classList.remove('gb-visible', 'gb-ready');
  _stopCrackle();

  // Reverse bloom: the painting recedes back to cover the app — symmetry.
  const from = _display;
  const t0 = performance.now();
  const cb = _onContinue;
  const tick = (now) => {
    if (!_active) return;
    const k = Math.min(1, (now - t0) / TUNING.reverseDurationMs);
    _display = from * (1 - _easeInOutSine(k));
    _target = _display;
    if (k >= 1) {
      abort(true);
      if (cb) cb();
      return;
    }
    _paint(now);
    requestAnimationFrame(tick);
  };
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  requestAnimationFrame(tick);
}

// ═══════════════════════════════════════════════════════════════════════════
//  ART PIPELINE (rotation + IndexedDB cache + procedural fallback)
// ═══════════════════════════════════════════════════════════════════════════

function _pickPainting() {
  let rot = null;
  try { rot = JSON.parse(localStorage.getItem(ROTATION_KEY)); } catch (_) { /* ignore */ }
  if (!rot || !Array.isArray(rot.order) || rot.order.length !== PAINTINGS.length
      || typeof rot.next !== 'number' || rot.next >= rot.order.length) {
    const order = PAINTINGS.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {           // shuffle
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    rot = { order, next: 0 };
  }
  const painting = PAINTINGS[rot.order[rot.next]];
  rot.next += 1;
  try { localStorage.setItem(ROTATION_KEY, JSON.stringify(rot)); } catch (_) { /* ignore */ }
  return painting;
}

const _apiUrl = (file) =>
  'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*'
  + '&prop=imageinfo&iiprop=url&iiurlwidth=1600&titles='
  + encodeURIComponent('File:' + file);

const _filePathUrl = (file) =>
  'https://commons.wikimedia.org/wiki/Special:FilePath/'
  + encodeURIComponent(file) + '?width=1600';

async function _loadArt(painting) {
  const cacheKey = ART_CACHE_PREFIX + painting.id;
  let blob = null;
  try { blob = await idbGet(cacheKey); } catch (_) { /* cache miss ok */ }

  if (!(blob instanceof Blob)) {
    blob = await _fetchArtBlob(painting.file).catch(() => null);
    if (blob) idbSet(cacheKey, blob).catch(() => { /* best-effort */ });
  }

  if (blob instanceof Blob) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob); } catch (_) { /* fall through */ }
    }
    try { return await _blobToImg(blob); } catch (_) { /* fall through */ }
  }
  return await _plainImg(_filePathUrl(painting.file));   // display-only tier
}

async function _fetchArtBlob(file) {
  const resp = await fetch(_apiUrl(file));
  if (!resp.ok) throw new Error('commons api ' + resp.status);
  const data = await resp.json();
  const pages = data && data.query && data.query.pages;
  const page = pages && pages[Object.keys(pages)[0]];
  const info = page && page.imageinfo && page.imageinfo[0];
  const url = info && (info.thumburl || info.url);
  if (!url) throw new Error('no imageinfo for ' + file);
  const img = await fetch(url);
  if (!img.ok) throw new Error('art fetch failed: ' + img.status);
  return await img.blob();
}

function _blobToImg(blob) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('blob img failed')); };
    img.src = url;
  });
}

function _plainImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('img failed'));
    img.src = src;
  });
}

/** Offline / fetch-failure fallback: a soft procedural aurora "painting". */
function _proceduralArt() {
  const c = document.createElement('canvas');
  c.width = 1600; c.height = 1000;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, '#0b1030');
  sky.addColorStop(0.55, '#1b2a5e');
  sky.addColorStop(1, '#3b2a56');
  g.fillStyle = sky;
  g.fillRect(0, 0, c.width, c.height);
  for (let b = 0; b < 4; b++) {                      // aurora bands
    g.beginPath();
    for (let x = 0; x <= c.width; x += 16) {
      const y = 220 + b * 130
        + Math.sin(x / 240 + b * 1.7) * 90
        + Math.sin(x / 90 + b) * 24;
      (x === 0) ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.strokeStyle = ['rgba(80,255,190,0.20)', 'rgba(120,180,255,0.16)',
                     'rgba(255,170,220,0.12)', 'rgba(140,255,140,0.10)'][b];
    g.lineWidth = 60 - b * 10;
    g.stroke();
  }
  for (let i = 0; i < 180; i++) {                    // stars
    g.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.6})`;
    g.fillRect(Math.random() * c.width, Math.random() * c.height * 0.7,
      1 + Math.random(), 1 + Math.random());
  }
  return c;
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUDIO (soft paper-crackle while spreading + one warm chime at the quote)
// ═══════════════════════════════════════════════════════════════════════════

function _wantSound() {
  try { return !(window.FX && !window.FX.wantSound()); } catch (_) { return true; }
}

function _startCrackle() {
  if (_reduceMotion || !_wantSound()) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      // sparse pops on a soft noise bed = dry paper
      d[i] = (Math.random() * 2 - 1) * 0.25
        + ((Math.random() < 0.0015) ? (Math.random() * 2 - 1) : 0);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(bp); bp.connect(gain); gain.connect(ctx.destination);
    src.start();
    _audio = { ctx, gain, src };
  } catch (_) { _audio = null; }
}

function _setCrackleIntensity(burnRate) {
  if (!_audio) return;
  // Louder while actively spreading, near-silent when frozen/finished
  const level = Math.min(1, burnRate * 30) * TUNING.crackleGain;
  try {
    _audio.gain.gain.setTargetAtTime(level, _audio.ctx.currentTime, 0.25);
  } catch (_) { /* ignore */ }
}

function _stopCrackle() {
  if (!_audio) return;
  const a = _audio;
  _audio = null;
  try {
    a.gain.gain.setTargetAtTime(0, a.ctx.currentTime, 0.15);
    setTimeout(() => { try { a.src.stop(); a.ctx.close(); } catch (_) {} }, 600);
  } catch (_) { /* ignore */ }
}

function _chime() {
  if (!_wantSound()) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((f, i) => {   // soft C-major arpeggio
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.06, now + i * 0.12 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 1.4);
      o.connect(g); g.connect(ctx.destination);
      o.start(now + i * 0.12);
      o.stop(now + i * 0.12 + 1.5);
    });
    setTimeout(() => { try { ctx.close(); } catch (_) {} }, 2600);
  } catch (_) { /* ignore */ }
}