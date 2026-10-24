/* ============================================================================
   atmosphere.js — Observatory atmosphere runtime (Phase 1).
   Mounts the night sky behind the app and keeps it in step with the UI:

     · .obs-atmos  fixed wrapper (parallax lives here, never on plates)
       ├─ .obs-sky   two box-shadow starfields (deep + near)
       ├─ .obs-plate one <img> per mapped plate (atlas/atmos-*.svg)
       └─ .obs-grain 4% SVG-noise film

   Pure observation: it never touches switchTab or any app logic — a
   MutationObserver watches .view-section.active and overlay .active classes
   and writes two attributes on <html>:
     · data-obs-screen  dashboard|vault|practice|mocks|settings|lunar|boot
                        (CSS cross-fades the matching plate in, 1.2 s)
     · data-obs-focus   set while solving (any modal / practice stage open,
                        except the lunar overlays) — CSS dims the plate to 4%
   plus data-obs-scrolled for the nav hairline.
   Parallax is 0.03× scroll, rAF-throttled, passive — and skipped entirely
   under prefers-reduced-motion or on low-power devices.
   ============================================================================ */
(function () {
  'use strict';
  if (window.__obsAtmos) return;
  window.__obsAtmos = true;

  /* screen → anchor + plate list — the gemini library. Engraved plates run
     in Night mood, the polychrome PLATE-series in Dusk, mirroring the
     dashboard's black-hole pair. Single-plate screens (settings, boot) run
     their engraving in both moods. */
  var SCREENS = {
    dashboard: { anchor: 'right',  plates: [{ stem: 'i-horizon-night', variant: 'night' },
                                            { stem: 'i-horizon-dusk',  variant: 'dusk'  }] },
    vault:     { anchor: 'right',  plates: [{ stem: 'iv-microscope',    variant: 'night' },
                                            { stem: 'iv-specimen-dusk', variant: 'dusk'  }] },
    practice:  { anchor: 'left',   plates: [{ stem: 'vi-sextant',       variant: 'night' },
                                            { stem: 'vi-growth-dusk',   variant: 'dusk'  }] },
    mocks:     { anchor: 'right',  plates: [{ stem: 'vii-synodic',      variant: 'night' },
                                            { stem: 'vii-pulsar-dusk',  variant: 'dusk'  }] },
    settings:  { anchor: 'left',   plates: [{ stem: 'ii-instrument' }] },
    lunar:     { anchor: 'centre', plates: [{ stem: 'iii-lunar-night',  variant: 'night' },
                                            { stem: 'iii-lunar-dusk',   variant: 'dusk'  }] },
    boot:      { anchor: 'centre', plates: [{ stem: 'v-armillary' }] }
  };
  var SECTION_TO_SCREEN = {
    'view-dashboard': 'dashboard',
    'view-errors': 'vault',
    'view-practice': 'practice',
    'view-mocks': 'mocks',
    'view-settings': 'settings'
  };
  /* Overlays that get their own quiet plate instead of the focus dim. */
  var LUNAR_SELECTORS = '#tuckin-overlay.active, #nightguard-modal.active, .bridge-pickup-overlay.active';

  var root = document.documentElement;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var lowPower = (navigator.hardwareConcurrency || 8) <= 4 ||
                 (navigator.connection && navigator.connection.saveData);

  /* ── Starfield: two deterministic dot layers via box-shadow ─────────── */
  function starShadows(count, w, h, seed) {
    var t = seed;
    var rnd = function () { t = (t * 1664525 + 1013904223) >>> 0; return t / 4294967296; };
    var parts = [];
    for (var i = 0; i < count; i++) {
      var x = Math.round(rnd() * w * 10) / 10;
      var y = Math.round(rnd() * h * 10) / 10;
      parts.push(x + 'px ' + y + 'px 0 ' + (rnd() < 0.18 ? '0.5px' : '0'));
    }
    return parts.join(',');
  }
  function buildSky(wrapper) {
    var W = 3840, H = 2160;   // cover large viewports; cost is one paint
    var deep = document.createElement('div');
    deep.className = 'obs-stars obs-stars-deep';
    deep.style.boxShadow = starShadows(86, W, H, 20261024);
    var near = document.createElement('div');
    near.className = 'obs-stars obs-stars-near';
    near.style.boxShadow = starShadows(34, W, H, 991217);
    var sky = document.createElement('div');
    sky.className = 'obs-sky';
    sky.setAttribute('aria-hidden', 'true');
    sky.appendChild(deep); sky.appendChild(near);
    wrapper.appendChild(sky);
  }

  /* ── Plates ─────────────────────────────────────────────────────────── */
  function buildPlates(wrapper) {
    Object.keys(SCREENS).forEach(function (screen) {
      var cfg = SCREENS[screen];
      cfg.plates.forEach(function (p) {
        var img = document.createElement('img');
        img.className = 'obs-plate';
        img.dataset.screen = screen;
        img.dataset.anchor = cfg.anchor;
        if (p.variant) img.dataset.variant = p.variant;
        img.src = 'atlas/atmos-' + p.stem + '.svg';
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        img.setAttribute('decoding', 'async');
        img.draggable = false;
        wrapper.appendChild(img);
      });
    });
  }

  /* ── State derivation (pure reads) ──────────────────────────────────── */
  function currentScreen() {
    if (document.querySelector(LUNAR_SELECTORS)) return 'lunar';
    if (document.querySelector('.bootseq')) return 'boot';
    var active = document.querySelector('.view-section.active');
    return (active && SECTION_TO_SCREEN[active.id]) || 'dashboard';
  }
  function focusOn() {
    if (document.querySelector(LUNAR_SELECTORS)) return false;
    return !!document.querySelector('.modal-overlay.active');
  }
  function sync() {
    var s = currentScreen();
    if (root.dataset.obsScreen !== s) root.dataset.obsScreen = s;
    var f = focusOn();
    if (f !== !!root.dataset.obsFocus) { if (f) root.dataset.obsFocus = ''; else delete root.dataset.obsFocus; }
  }

  /* ── Scroll: nav hairline flag + gentle parallax ────────────────────── */
  function wireScroll(wrapper) {
    var raf = 0;
    function apply() {
      raf = 0;
      var y = window.scrollY || window.pageYOffset || 0;
      var sc = document.scrollingElement || root;
      var yv = sc ? (sc.scrollTop || 0) : y;
      if (yv > 8) root.dataset.obsScrolled = '';
      else delete root.dataset.obsScrolled;
      if (!reduced && !lowPower) root.style.setProperty('--obs-par', (yv * -0.03).toFixed(2) + 'px');
    }
    window.addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(apply); }, { passive: true });
    apply();
  }

  /* ── Boot ───────────────────────────────────────────────────────────── */
  function mount() {
    if (document.getElementById('obs-atmos')) return;
    var wrapper = document.createElement('div');
    wrapper.id = 'obs-atmos';
    wrapper.className = 'obs-atmos';
    wrapper.setAttribute('aria-hidden', 'true');
    buildSky(wrapper);
    buildPlates(wrapper);
    var grain = document.createElement('div');
    grain.className = 'obs-grain';
    wrapper.appendChild(grain);
    document.body.insertBefore(wrapper, document.body.firstChild);

    if ('MutationObserver' in window) {
      new MutationObserver(sync).observe(document.body, {
        attributes: true, attributeFilter: ['class'],
        childList: true, subtree: true
      });
    }
    sync();
    wireScroll(wrapper);
    window.addEventListener('load', sync);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  /* Debug handle for the QA harness — forces a screen/focus state. */
  window.__obs = { sync: sync, screens: Object.keys(SCREENS) };
})();
