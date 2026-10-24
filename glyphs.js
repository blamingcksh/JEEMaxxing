/* ============================================================================
   glyphs.js — Observatory glyph sprite (Phase 1 of the observatory reskin).
   One hidden inline <svg> sprite of hand-drawn 24px line glyphs, stroke 1.25,
   currentColor, round caps — the emoji layer becomes thin engraved marks.

   API (stable across phases):
     window.__glyph(name, cls?) → '<svg class="g …"><use href="#g-name"/></svg>'
     window.__glyphText         → { name: 'typographic fallback' } for contexts
                                   where SVG can't render (textContent, title,
                                   confirm(), notifications).
   Static markup swaps live in index.html; the JS string sweep (Phase 4) uses
   the same two exports. Sprout Isle's in-world emoji are untouched.
   ============================================================================ */
(function () {
  'use strict';
  if (window.__glyph) return;

  /* Each entry: inner markup of a <symbol viewBox="0 0 24 24">. Strokes only,
     currentColor, so a single CSS rule sizes and tints every glyph. */
  var GLYPHS = {
    /* ── reticle family (quick actions) ── */
    target:   '<circle cx="12" cy="12" r="7.25"/><circle class="dot" cx="12" cy="12" r="1.1"/>' +
              '<path d="M12 1.75v3.5M12 18.75v3.5M1.75 12h3.5M18.75 12h3.5"/>',
    shield:   '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.4 15.4 21 21"/><path d="M7.5 10.5a3 3 0 0 1 3-3"/>',
    flame:    '<path d="M12 2.5c.9 4.6 2.4 6.1 7 7-4.6.9-6.1 2.4-7 7-.9-4.6-2.4-6.1-7-7 4.6-.9 6.1-2.4 7-7Z"/>',
    spark:    '<path d="M12 3l1.5 7.5L21 12l-7.5 1.5L12 21l-1.5-7.5L3 12l7.5-1.5Z"/>',
    bolt:     '<path d="M13.4 2.6 5.2 13.2h5.4l-1 8.2 8.2-10.6h-5.4Z"/>',
    person:   '<circle cx="12" cy="7.4" r="3.1"/><path d="M6.2 20.2a5.8 5.8 0 0 1 11.6 0"/>',
    skull:    '<path d="M12 3.25a6.9 6.9 0 0 0-6.9 6.9c0 2.5 1.3 4.3 2.9 5.5v2.6a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5v-2.6c1.6-1.2 2.9-3 2.9-5.5A6.9 6.9 0 0 0 12 3.25Z"/>' +
              '<circle class="dot" cx="9.4" cy="10.6" r="1.2"/><circle class="dot" cx="14.6" cy="10.6" r="1.2"/><path d="M10.4 19.75v-2.2M13.6 19.75v-2.2"/>',

    /* ── modes ── */
    flow:     '<ellipse cx="12" cy="12" rx="9" ry="4.25" transform="rotate(-24 12 12)"/>' +
              '<circle class="dot" cx="12" cy="12" r="1.9"/><circle class="dot" cx="20" cy="8.2" r="1.2"/>',
    hardcore: '<circle cx="15.5" cy="8.5" r="4"/><path d="M12.6 11.4 4 20M15.2 14.2l-4.6 4.6M10.7 9.3 5.2 11.8"/>',
    lock:     '<rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
    gauge:    '<path d="M3.5 17.75a9.2 9.2 0 0 1 17 0"/><path d="M12 17.5 16.2 11"/><circle class="dot" cx="12" cy="17.5" r="1.1"/>',

    /* ── subjects ── */
    physics:  '<path d="M12 2.25v3"/><path d="M12 5.25 8.1 14.9"/><circle cx="7.7" cy="17.2" r="2.6"/>' +
              '<path d="M2.75 19a13.5 13.5 0 0 0 9.25 2.4"/>',
    chemistry:'<path d="M9.5 2.5h5M10.5 2.5v5.5L4.8 18a2.4 2.4 0 0 0 2.1 3.5h10.2a2.4 2.4 0 0 0 2.1-3.5L13.5 8V2.5"/>' +
              '<path d="M7.4 14.5h9.2"/>',
    maths:    '<circle class="dot" cx="12" cy="4" r="1.4"/><path d="M11 5.4 5.5 20.25M13 5.4 18.5 20.25M8.1 13.9h7.8"/>',

    /* ── celestial ── */
    moon:     '<path d="M19.5 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10 10.5Z"/>',
    sun:      '<circle cx="12" cy="12" r="4.4"/>' +
              '<path d="M12 2.4v2.6M12 19v2.6M2.4 12H5M19 12h2.6M5 5l1.85 1.85M17.15 17.15 19 19M19 5l-1.85 1.85M6.85 17.15 5 19"/>',
    sleep:    '<path d="M17.5 12.5A6.5 6.5 0 1 1 10 3.5a5.4 5.4 0 0 0 7.5 9Z"/>' +
              '<path d="M17.5 3.5l.65 1.85L20 6l-1.85.65L17.5 8.5l-.65-1.85L15 6l1.85-.65Z"/>',
    eclipse:  '<circle cx="9.75" cy="12" r="6.4"/><circle cx="14.25" cy="12" r="6.4"/>',
    eye:      '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.9"/>',

    /* ── instruments / data ── */
    bell:     '<path d="M12 3a6 6 0 0 0-6 6v4.5L4.5 16h15L18 13.5V9a6 6 0 0 0-6-6Z"/><path d="M9.75 19a2.4 2.4 0 0 0 4.5 0"/>',
    clock:    '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
    chart:    '<path d="M4 4v16h16"/><path d="M7.5 15.5l3.5-4 3 2.5 5-6.5"/>',
    trophy:   '<path d="M12 4.5l1.6 4.4 4.4 1.6-4.4 1.6L12 16.5l-1.6-4.4L6 10.5l4.4-1.6Z"/>' +
              '<path d="M4.25 15.5a9.5 9.5 0 0 0 2 4.25M19.75 15.5a9.5 9.5 0 0 1-2 4.25"/>',
    seed:     '<path d="M12 21.5V13"/><path d="M12 13c0-4 2.5-6.5 7-6.5 0 4-2.5 6.5-7 6.5Z"/>' +
              '<path d="M12 15.5c0-3.2-1.9-5.2-5.8-5.2 0 3.2 1.9 5.2 5.8 5.2Z"/>',

    /* ── system / files ── */
    cloud:    '<path d="M7 18.5a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18.3 11a3.75 3.75 0 0 1-.8 7.5Z"/>',
    archive:  '<rect x="3.5" y="4" width="17" height="5" rx="1"/><path d="M5.5 9v9.5A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M10 13.25h4"/>',
    gear:     '<circle cx="12" cy="12" r="3.2"/><path d="M12 6.6V4M12 20v-2.6M6.6 12H4M20 12h-2.6M8.2 8.2 6.4 6.4M17.6 17.6l-1.8-1.8M15.8 8.2l1.8-1.8M6.4 17.6l1.8-1.8"/>',
    key:      '<circle cx="7" cy="15" r="3.5"/><path d="M9.5 12.5 20 2M15.9 6.1l3 3M12.9 9.1l2.5 2.5"/>',
    image:    '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="10" r="1.75"/><path d="M4.5 17.5 10 12l4 4 2.5-2.5 3 3"/>',
    upload:   '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>',
    volume:   '<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5Z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
    sliders:  '<path d="M4 7h16M4 17h16M8 4.5v5M16 14.5v5"/>',
    trash:    '<path d="M4 6h16M10 3h4M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
    copy:     '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M5.5 15.5h-1a1.5 1.5 0 0 1-1.5-1.5v-9a1.5 1.5 0 0 1 1.5-1.5h9a1.5 1.5 0 0 1 1.5 1.5v1"/>',
    doc:      '<path d="M6 3.5h8.5l4.5 4.5V20a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M14.5 3.5V8H19M8.5 12.5h7M8.5 16.5h4.5"/>',
    map:      '<path d="M3.5 6.5 8.5 4l7 2.5 5-2.5v13.5l-5 2.5-7-2.5-5 2.5Z"/><path d="M8.5 4v13.5M15.5 6.5V20"/>',
    sword:    '<path d="M18.5 3.5 20.5 5.5l-9.5 9.5-2.5-2.5 9.5-9.5Z"/><path d="M6 18l2.5 2.5M7 16l-3.5 3.5L5 21l3.5-3.5M3 21l-1 1"/>',
    hourglass:'<path d="M6 3h12M6 21h12M7 3v4.5a5 5 0 0 0 2.5 4.33L12 13.5l2.5-1.67A5 5 0 0 0 17 7.5V3M7 21v-4.5a5 5 0 0 1 2.5-4.33L12 10.5l2.5 1.67A5 5 0 0 1 17 16.5V21"/>',
    wand:     '<path d="M15 4l5 5L7 22l-5-5ZM18.5 2.5l1 2 2 1-2 1-1 2-1-2-2-1 2-1ZM5 3l.5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5Z"/>',
    folder:   '<path d="M3.5 6a1.5 1.5 0 0 1 1.5-1.5h4.5l2.5 2.5H19a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z"/>',
    compass:  '<circle cx="12" cy="12" r="8.5"/><polygon points="12,6.5 14.5,12 12,17.5 9.5,12"/><circle class="dot" cx="12" cy="12" r="1.2"/>',
    arrow:    '<path d="M4 12h15M13 6l6 6-6 6"/>',
    check:    '<path d="M4.5 12.5 10 18 19.5 6.5"/>',
    cross:    '<path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/>'
  };

  /* Typographic fallbacks for string contexts (textContent / title / toast). */
  var TEXT = {
    target: '◎', shield: '◍', flame: '✦', spark: '✦', bolt: '↯', person: '◍', skull: '☠', flow: '◌', hardcore: '☄',
    lock: '⊘', gauge: '◷', physics: '⚗', chemistry: '⚗', maths: '∆',
    moon: '☾', sun: '☀', sleep: '☾', eclipse: '◐', eye: '◉',
    bell: '◔', clock: '◷', chart: '∿', trophy: '✦', seed: '❧',
    cloud: '∘', archive: '▤', gear: '✺', key: '⚥', image: '▣',
    upload: '↑', download: '↓', volume: '◍', arrow: '→', check: '✓', cross: '✕',
    sliders: '⌸', trash: '⌫', copy: '⎘', doc: '▤', map: '☲', sword: '⚔',
    hourglass: '⏳', wand: '✦', folder: '📁', compass: '⎈'
  };

  function sprite() {
    var defs = '';
    for (var name in GLYPHS) {
      defs += '<symbol id="g-' + name + '" viewBox="0 0 24 24">' +
        '<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">' +
        GLYPHS[name].replace(/class="dot"/g, 'fill="currentColor" stroke="none"') +
        '</g></symbol>';
    }
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    svg.innerHTML = '<defs>' + defs + '</defs>';
    (document.body || document.documentElement).insertBefore(svg, (document.body || document.documentElement).firstChild);
  }

  window.__glyph = function (name, cls) {
    return '<svg class="g' + (cls ? ' ' + cls : '') + '" aria-hidden="true" focusable="false"><use href="#g-' + name + '"></use></svg>';
  };
  window.__glyphText = TEXT;
  window.__glyphNames = Object.keys(GLYPHS);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sprite);
  else sprite();
})();
