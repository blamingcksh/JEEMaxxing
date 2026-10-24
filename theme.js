/* ============================================================================
   theme.js — JEEMaxxing Theme Engine v3 · OBSERVATORY
   One theme, two moods, three inks:
     data-theme="observatory"  (always — the old 8-accent system is retired)
     data-ink="brass|starlight|ember"
     data-mode="night|dusk"
   Pill button docks next to the logo; the popover is a small quiet panel:
   three ink dots + a Night/Dusk segmented control.
   Persists: localStorage 'jeemax_theme' (ink id) + 'jeemax_mode'.
   One-time migration from the v2 accent ids:
     glacier/synthwave/stealth → starlight · bloodmoon/sakura → ember
     everything else → brass · 'midnight' → night.
   ============================================================================ */
(function () {
  'use strict';
  if (window.__themeInit) return;
  window.__themeInit = true;

  var LS_THEME = 'jeemax_theme';
  var LS_MODE  = 'jeemax_mode';

  var INKS = [
    { id: 'brass',     name: 'Brass',     dot: '#E5C07B', desc: 'engraved gold · stock build' },
    { id: 'starlight', name: 'Starlight', dot: '#9CD3F0', desc: 'cold blue·white stars' },
    { id: 'ember',     name: 'Ember',     dot: '#E07A52', desc: 'dying-star warmth' }
  ];
  var MODES = [
    { id: 'night', name: 'Night', desc: 'deep void · plates at 12%' },
    { id: 'dusk',  name: 'Dusk',  desc: 'lighter sky · plates at 18%' }
  ];

  /* v2 accent id → v3 ink id (one-time migration map) */
  var LEGACY_INK = {
    glacier: 'starlight', synthwave: 'starlight', stealth: 'starlight',
    bloodmoon: 'ember', sakura: 'ember'
  };

  var btn = null, panel = null;

  function migrateInk(raw) {
    if (!raw) return 'brass';
    if (LEGACY_INK[raw]) return LEGACY_INK[raw];
    for (var i = 0; i < INKS.length; i++) if (INKS[i].id === raw) return raw;
    return 'brass';
  }
  function current() {
    try { return migrateInk(localStorage.getItem(LS_THEME)); } catch (e) { return 'brass'; }
  }
  function currentMode() {
    try {
      var m = localStorage.getItem(LS_MODE);
      if (m === 'midnight') m = 'night';   // v2 'midnight' maps onto v3 'night'
      return m === 'dusk' ? 'dusk' : 'night';
    } catch (e) { return 'night'; }
  }
  function byId(id) {
    for (var i = 0; i < INKS.length; i++) { if (INKS[i].id === id) return INKS[i]; }
    return INKS[0];
  }

  function applyInk(id, persist) {
    var t = byId(id);
    var root = document.documentElement;
    root.setAttribute('data-theme', 'observatory');
    root.setAttribute('data-ink', t.id);
    if (persist !== false) { try { localStorage.setItem(LS_THEME, t.id); } catch (e) {} }
    if (btn) btn.title = 'Ink: ' + t.name;
    if (panel) {
      var dots = panel.querySelectorAll('.theme-ink');
      for (var i = 0; i < dots.length; i++) {
        dots[i].setAttribute('aria-pressed', dots[i].getAttribute('data-ink') === t.id ? 'true' : 'false');
      }
    }
    try { document.dispatchEvent(new CustomEvent('jeemax:themechange', { detail: { theme: 'observatory', ink: t.id } })); } catch (e) {}
  }

  function applyMode(id, persist) {
    var valid = id === 'dusk' ? 'dusk' : 'night';
    document.documentElement.setAttribute('data-mode', valid);
    if (persist !== false) { try { localStorage.setItem(LS_MODE, valid); } catch (e) {} }
    if (panel) {
      var mbs = panel.querySelectorAll('.theme-mode-seg button');
      for (var j = 0; j < mbs.length; j++) {
        mbs[j].setAttribute('aria-pressed', mbs[j].getAttribute('data-mode-id') === valid ? 'true' : 'false');
      }
    }
    try { document.dispatchEvent(new CustomEvent('jeemax:modechange', { detail: { mode: valid } })); } catch (e) {}
  }

  function isOpen() { return !!(panel && panel.classList.contains('open')); }
  function position() {
    if (!btn || !panel) return;
    var r = btn.getBoundingClientRect();
    var pw = panel.offsetWidth || 232, ph = panel.offsetHeight || 150;
    var left = Math.max(12, Math.min(r.left, window.innerWidth - pw - 12));
    var top = r.bottom + 10;
    if (top + ph > window.innerHeight - 12) top = Math.max(12, r.top - ph - 10);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }
  function open()  { panel.classList.add('open');    btn.setAttribute('aria-expanded', 'true');  position(); }
  function close() { panel.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }

  function mount() {
    if (btn) return;
    var sb = document.getElementById('sidebar') || document.querySelector('.sidebar');
    if (!sb) { requestAnimationFrame(mount); return; }

    btn = document.createElement('button');
    btn.id = 'theme-btn';
    btn.className = 'theme-btn';
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML =
      '<span class="theme-btn-dot"></span>' +
      '<span class="theme-btn-label">Ink</span>' +
      '<span class="theme-btn-chev">▾</span>';
    var logo = sb.querySelector('.logo-container');
    if (logo && logo.parentNode === sb) sb.insertBefore(btn, logo.nextSibling);
    else sb.insertBefore(btn, sb.firstChild);

    panel = document.createElement('div');
    panel.id = 'theme-panel';
    panel.className = 'theme-pop';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Observatory inks and mood');

    var html = ['<p class="theme-pop-title">INK</p><div class="theme-ink-row" role="group" aria-label="Ink">'];
    for (var i = 0; i < INKS.length; i++) {
      var ink = INKS[i];
      html.push(
        '<button type="button" class="theme-ink" data-ink="' + ink.id + '" aria-pressed="false" title="' +
          ink.name + ' — ' + ink.desc + '" style="--ink-dot:' + ink.dot + '"></button>'
      );
    }
    html.push('</div><p class="theme-pop-title">MOOD</p><div class="theme-mode-seg" role="group" aria-label="Mood">');
    for (var m = 0; m < MODES.length; m++) {
      var mo = MODES[m];
      html.push('<button type="button" data-mode-id="' + mo.id + '" aria-pressed="false" title="' + mo.desc + '">' + mo.name + '</button>');
    }
    html.push('</div>');
    panel.innerHTML = html.join('');
    document.body.appendChild(panel);

    btn.addEventListener('click', function (e) { e.stopPropagation(); if (isOpen()) close(); else open(); });

    var dots = panel.querySelectorAll('.theme-ink');
    for (var d = 0; d < dots.length; d++) {
      dots[d].addEventListener('click', function () { applyInk(this.getAttribute('data-ink')); });
    }
    var mbs = panel.querySelectorAll('.theme-mode-seg button');
    for (var n = 0; n < mbs.length; n++) {
      mbs[n].addEventListener('click', function () { applyMode(this.getAttribute('data-mode-id')); });
    }

    document.addEventListener('pointerdown', function (e) {
      if (!isOpen()) return;
      if (btn.contains(e.target) || panel.contains(e.target)) return;
      close();
    }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) close(); });
    window.addEventListener('resize', function () { if (isOpen()) position(); });
    window.addEventListener('scroll', function () { if (isOpen()) position(); }, true);

    applyInk(current(), false);
    applyMode(currentMode(), false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  window.JEEMaxTheme = {
    set: function (id) { applyInk(id, true); },
    get: current,
    setMode: function (id) { applyMode(id, true); },
    getMode: currentMode,
    inks: INKS,
    modes: MODES
  };
})();
