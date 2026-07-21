/* ============================================================================
   theme.js — JEEMaxxing Theme Engine v2
   Accent themes (data-theme) × appearance mode (data-mode: midnight | dusk).
   Pill button docks next to the logo; dropdown re-skins the whole app live.
   Persists: localStorage 'jeemax_theme' + 'jeemax_mode'.
   ============================================================================ */
(function () {
  'use strict';
  if (window.__themeInit) return;
  window.__themeInit = true;

  var LS_THEME = 'jeemax_theme';
  var LS_MODE  = 'jeemax_mode';

  var THEMES = [
    { id: 'furnace',    name: 'Furnace',    desc: 'Amber heat · stock build', dots: ['#ffb224', '#ff7a1a', '#3ddcff'] },
    { id: 'synthwave',  name: 'Synthwave',  desc: 'Violet neon haze',         dots: ['#c084fc', '#e879f9', '#818cf8'] },
    { id: 'glacier',    name: 'Glacier',    desc: 'Ice-blue deep focus',      dots: ['#38bdf8', '#0ea5e9', '#22d3ee'] },
    { id: 'overgrowth', name: 'Overgrowth', desc: 'Bioluminescent green',     dots: ['#34d399', '#10b981', '#a3e635'] },
    { id: 'bloodmoon',  name: 'Blood Moon', desc: 'Crimson aggression',       dots: ['#ef4444', '#f97316', '#fbbf24'] },
    { id: 'sakura',     name: 'Sakura',     desc: 'Rose quartz calm',         dots: ['#f472b6', '#fb7185', '#c4b5fd'] },
    { id: 'stealth',    name: 'Stealth',    desc: 'Monochrome ops',           dots: ['#e5e7eb', '#9ca3af', '#4b5563'] }
  ];

  var MODES = [
    { id: 'midnight', name: 'Midnight', icon: '🌙', desc: 'Deep-night terminal' },
    { id: 'dusk',     name: 'Dusk',     icon: '🌆', desc: 'Evening glass · ~65% dark' }
  ];

  var btn = null, panel = null;

  function current() { try { return localStorage.getItem(LS_THEME) || 'furnace'; } catch (e) { return 'furnace'; } }
  function currentMode() { try { return localStorage.getItem(LS_MODE) || 'midnight'; } catch (e) { return 'midnight'; } }
  function byId(id) {
    for (var i = 0; i < THEMES.length; i++) { if (THEMES[i].id === id) return THEMES[i]; }
    return THEMES[0];
  }
  function dotBg(t) {
    return 'conic-gradient(from 210deg,' + t.dots[0] + ',' + t.dots[1] + ',' + t.dots[2] + ',' + t.dots[0] + ')';
  }

  function apply(id, persist) {
    var t = byId(id);
    document.documentElement.setAttribute('data-theme', t.id);
    if (persist !== false) { try { localStorage.setItem(LS_THEME, t.id); } catch (e) {} }
    if (btn) {
      var d = btn.querySelector('.theme-btn-dot');
      if (d) d.style.background = dotBg(t);
      btn.title = 'Theme: ' + t.name;
    }
    if (panel) {
      var opts = panel.querySelectorAll('.theme-opt');
      for (var i = 0; i < opts.length; i++) {
        var on = opts[i].getAttribute('data-theme-id') === t.id;
        opts[i].classList.toggle('active', on);
        opts[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
    }
    try { document.dispatchEvent(new CustomEvent('jeemax:themechange', { detail: { theme: t.id } })); } catch (e) {}
  }

  function applyMode(id, persist) {
    var valid = 'midnight';
    for (var i = 0; i < MODES.length; i++) { if (MODES[i].id === id) valid = id; }
    document.documentElement.setAttribute('data-mode', valid);
    if (persist !== false) { try { localStorage.setItem(LS_MODE, valid); } catch (e) {} }
    if (panel) {
      var mbs = panel.querySelectorAll('.theme-mode-btn');
      for (var j = 0; j < mbs.length; j++) {
        var on = mbs[j].getAttribute('data-mode-id') === valid;
        mbs[j].classList.toggle('active', on);
        mbs[j].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    try { document.dispatchEvent(new CustomEvent('jeemax:modechange', { detail: { mode: valid } })); } catch (e) {}
  }

  function isOpen() { return !!(panel && panel.classList.contains('open')); }
  function position() {
    if (!btn || !panel) return;
    var r = btn.getBoundingClientRect();
    var pw = panel.offsetWidth || 264, ph = panel.offsetHeight || 440;
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
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML =
      '<span class="theme-btn-dot"></span>' +
      '<span class="theme-btn-label">Theme</span>' +
      '<span class="theme-btn-chev">▾</span>';
    var logo = sb.querySelector('.logo-container');
    if (logo && logo.parentNode === sb) sb.insertBefore(btn, logo.nextSibling);
    else sb.insertBefore(btn, sb.firstChild);

    panel = document.createElement('div');
    panel.id = 'theme-panel';
    panel.className = 'theme-panel';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', 'App theme');

    var html = ['<div class="theme-panel-modes" role="group" aria-label="Appearance mode">'];
    for (var m = 0; m < MODES.length; m++) {
      var mo = MODES[m];
      html.push(
        '<button type="button" class="theme-mode-btn" data-mode-id="' + mo.id + '" aria-pressed="false" title="' + mo.desc + '">' +
          '<span class="theme-mode-ic">' + mo.icon + '</span>' + mo.name +
        '</button>'
      );
    }
    html.push('</div><div class="theme-panel-head">THEME ENGINE</div>');
    for (var i = 0; i < THEMES.length; i++) {
      var t = THEMES[i];
      html.push(
        '<button type="button" class="theme-opt" role="option" aria-selected="false" data-theme-id="' + t.id + '">' +
          '<span class="theme-opt-dot" style="background:' + dotBg(t) + '"></span>' +
          '<span class="theme-opt-txt">' +
            '<span class="theme-opt-name">' + t.name + '</span>' +
            '<span class="theme-opt-desc">' + t.desc + '</span>' +
          '</span>' +
          '<span class="theme-opt-check">✓</span>' +
        '</button>'
      );
    }
    panel.innerHTML = html.join('');
    document.body.appendChild(panel);

    btn.addEventListener('click', function (e) { e.stopPropagation(); if (isOpen()) close(); else open(); });

    var opts = panel.querySelectorAll('.theme-opt');
    for (var j = 0; j < opts.length; j++) {
      opts[j].addEventListener('click', function () { apply(this.getAttribute('data-theme-id')); });
    }
    var mbs = panel.querySelectorAll('.theme-mode-btn');
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

    apply(current(), false);
    applyMode(currentMode(), false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  window.JEEMaxTheme = {
    set: function (id) { apply(id, true); },
    get: current,
    setMode: function (id) { applyMode(id, true); },
    getMode: currentMode,
    themes: THEMES,
    modes: MODES
  };
})();
