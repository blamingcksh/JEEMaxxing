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

  /* Each entry: inner markup of a <symbol viewBox="0 0 24 24">. Strokes use
     currentColor, with semantic utility classes expanded in sprite() for
     subtle tonal hierarchy (.dot, .dim, .thin, .tint). */
  var GLYPHS = {
    /* ── reticle & prestige family ── */
    target:   '<circle cx="12" cy="12" r="7.5" class="dim"/><circle cx="12" cy="12" r="3.6"/><circle class="dot" cx="12" cy="12" r="1.2"/>' +
              '<path d="M12 1.8v4M12 18.2v4M1.8 12h4M18.2 12h4"/>',
    shield:   '<path class="tint" d="M12 2.8 19 5.5v5.6c0 4.6-2.9 8.1-7 10.1-4.1-2-7-5.5-7-10.1V5.5Z"/>' +
              '<path d="M12 2.8 19 5.5v5.6c0 4.6-2.9 8.1-7 10.1-4.1-2-7-5.5-7-10.1V5.5Z"/>' +
              '<path class="dim" d="M12 6.2v11.6M8.5 9.8h7"/>',
    flame:    '<path class="tint" d="M12.6 2.6c1.1 3.6 4.4 5.6 4.4 9.6a5 5 0 0 1-10 0c0-2.1.9-3.9 2.3-5.3.2 1.6 1 2.5 2.1 2.8-.6-2.5-.3-4.9 1.2-7.1Z"/>' +
              '<path d="M12.6 2.6c1.1 3.6 4.4 5.6 4.4 9.6a5 5 0 0 1-10 0c0-2.1.9-3.9 2.3-5.3.2 1.6 1 2.5 2.1 2.8-.6-2.5-.3-4.9 1.2-7.1Z"/>' +
              '<path class="dim" d="M12 17.2a2.2 2.2 0 0 0 2-2.3c0-1.3-.9-2.2-1.8-3.2-.6 1.2-2 1.9-2 3.2a2 2 0 0 0 1.8 2.3Z"/>',
    spark:    '<path class="tint" d="M12 2.6l1.9 7.5L21.4 12l-7.5 1.9L12 21.4l-1.9-7.5L2.6 12l7.5-1.9Z"/>' +
              '<path d="M12 2.6l1.9 7.5L21.4 12l-7.5 1.9L12 21.4l-1.9-7.5L2.6 12l7.5-1.9Z"/>' +
              '<path class="dim" d="M18.6 4.2v2.4M17.4 5.4h2.4M5.4 17.4v2.4M4.2 18.6h2.4"/>',
    bolt:     '<path class="tint" d="M13.6 2.4 5.2 13.1h5.6l-1.1 8.5 8.8-10.9h-5.6Z"/>' +
              '<path d="M13.6 2.4 5.2 13.1h5.6l-1.1 8.5 8.8-10.9h-5.6Z"/>',
    person:   '<circle cx="12" cy="12" r="9.5" class="dim"/><circle cx="12" cy="9" r="2.9"/><path d="M6.6 18.8a5.8 5.8 0 0 1 10.8 0"/>',
    skull:    '<path class="tint" d="M12 3.2a6.8 6.8 0 0 0-6.8 6.8c0 2.4 1.2 4.2 2.8 5.4v2.7a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5v-2.7c1.6-1.2 2.8-3 2.8-5.4A6.8 6.8 0 0 0 12 3.2Z"/>' +
              '<path d="M12 3.2a6.8 6.8 0 0 0-6.8 6.8c0 2.4 1.2 4.2 2.8 5.4v2.7a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5v-2.7c1.6-1.2 2.8-3 2.8-5.4A6.8 6.8 0 0 0 12 3.2Z"/>' +
              '<circle class="dot" cx="9.4" cy="10.4" r="1.25"/><circle class="dot" cx="14.6" cy="10.4" r="1.25"/>' +
              '<path class="thin" d="M11.3 13.6l.7-1.1.7 1.1M10.2 19.6v-2.3M12 19.6v-2.3M13.8 19.6v-2.3"/>',

    /* ── modes ── */
    flow:     '<ellipse cx="12" cy="12" rx="9.2" ry="4" transform="rotate(-24 12 12)"/>' +
              '<ellipse class="dim" cx="12" cy="12" rx="9.2" ry="4" transform="rotate(24 12 12)"/>' +
              '<circle class="dot" cx="12" cy="12" r="1.8"/><circle class="dot" cx="20.1" cy="8.4" r="1.25"/>',
    hardcore: '<circle cx="15.4" cy="8.6" r="4.2" class="tint"/><circle cx="15.4" cy="8.6" r="4.2"/>' +
              '<path d="M12.4 11.6 3.5 20.5M9.5 14.5l-4.2.3M10.4 16.6l-.3 3.9"/>' +
              '<path class="dim" d="M14.2 6.8l1.2-1.8 1.2 1.8"/>',
    lock:     '<rect class="tint" x="5.2" y="10.5" width="13.6" height="9.5" rx="2"/><rect x="5.2" y="10.5" width="13.6" height="9.5" rx="2"/>' +
              '<path d="M8.5 10.5V7.4a3.5 3.5 0 0 1 7 0v3.1"/><circle class="dot" cx="12" cy="14.6" r="1.15"/><path d="M12 15.5v2"/>',
    gauge:    '<path d="M3.4 17.5a9.2 9.2 0 0 1 17.2 0"/><path class="dim" d="M6.4 11.2l1.4 1.2M12 8.2v1.8M17.6 11.2l-1.4 1.2"/>' +
              '<path d="M12 17.4 16.4 10.8"/><circle class="dot" cx="12" cy="17.4" r="1.35"/>',

    /* ── subjects ── */
    physics:  '<ellipse cx="12" cy="12" rx="9.6" ry="3.8" transform="rotate(-32 12 12)"/>' +
              '<ellipse cx="12" cy="12" rx="9.6" ry="3.8" transform="rotate(32 12 12)"/>' +
              '<ellipse class="dim" cx="12" cy="12" rx="3.8" ry="9.6"/>' +
              '<circle class="dot" cx="12" cy="12" r="1.85"/>',
    chemistry:'<path d="M9.2 2.8h5.6M10.4 2.8v5.4L4.7 17.9a2.3 2.3 0 0 0 2 3.4h10.6a2.3 2.3 0 0 0 2-3.4L13.6 8.2V2.8"/>' +
              '<path class="tint" d="M7.6 13.8h8.8l2.5 4.3a1.9 1.9 0 0 1-1.6 2.8H6.7a1.9 1.9 0 0 1-1.6-2.8Z"/>' +
              '<path class="dim" d="M7.6 13.8h8.8"/><circle class="dot" cx="10.6" cy="17" r="1"/><circle class="dot" cx="13.8" cy="15.8" r=".85"/>',
    maths:    '<circle cx="12" cy="4.4" r="1.5"/><path d="M11.1 5.7 5.2 20.5M12.9 5.7 18.8 20.5"/>' +
              '<path class="dim" d="M6.5 14.2a8.2 8.2 0 0 0 11 0"/><path class="thin" d="M12 2v.9M9.5 17.5l.6-1.4M14.5 17.5l-.6-1.4"/>',

    /* ── celestial ── */
    moon:     '<path class="tint" d="M19.5 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10 10.5Z"/>' +
              '<path d="M19.5 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10 10.5Z"/>' +
              '<circle class="dot" cx="16.8" cy="5.8" r="1"/>',
    sun:      '<circle class="tint" cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="4.4"/>' +
              '<path d="M12 2.2v2.4M12 19.4v2.4M2.2 12h2.4M19.4 12h2.4"/>' +
              '<path class="dim" d="M5.1 5.1l1.7 1.7M17.2 17.2l1.7 1.7M18.9 5.1l-1.7 1.7M6.8 17.2l-1.7 1.7"/>',
    sleep:    '<path d="M17.2 12.8A6.6 6.6 0 1 1 9.8 3.6a5.5 5.5 0 0 0 7.4 9.2Z"/>' +
              '<path d="M15.2 3.8h3.4l-3.4 3.4h3.4"/><path class="dim" d="M18.2 8.8h2.4l-2.4 2.4h2.4"/>',
    eclipse:  '<circle class="tint" cx="12" cy="12" r="6.2"/><circle cx="12" cy="12" r="6.2"/><circle class="dim" cx="12" cy="12" r="8.6"/>' +
              '<path d="M7.6 5.2v2.6M6.3 6.5h2.6"/>',
    eye:      '<path d="M2.4 12S6 5.5 12 5.5 21.6 12 21.6 12 18 18.5 12 18.5 2.4 12 2.4 12Z"/>' +
              '<circle cx="12" cy="12" r="3.2"/><circle class="dot" cx="12" cy="12" r="1.2"/>',

    /* ── instruments / data ── */
    bell:     '<path class="tint" d="M12 3.2a5.8 5.8 0 0 0-5.8 5.8v4.5L4.5 16.2h15l-1.7-2.7V9A5.8 5.8 0 0 0 12 3.2Z"/>' +
              '<path d="M12 3.2a5.8 5.8 0 0 0-5.8 5.8v4.5L4.5 16.2h15l-1.7-2.7V9A5.8 5.8 0 0 0 12 3.2Z"/><path d="M9.8 19.2a2.3 2.3 0 0 0 4.4 0"/>',
    clock:    '<path class="dim" d="M10.5 2h3M12 2v1.6"/><circle cx="12" cy="12.5" r="8.4"/>' +
              '<path class="dim" d="M12 6.4v.9M17.8 12.5h-.9M12 18.6v-.9M6.2 12.5h.9"/><path d="M12 8.2v4.3l3.2 1.8"/>',
    chart:    '<path class="dim" d="M3.8 3.8v16.4h16.4"/>' +
              '<path d="M6.8 15.8l3.6-4.2 3.2 2.4 4.8-6.4"/><circle class="dot" cx="10.4" cy="11.6" r="1.2"/><circle class="dot" cx="13.6" cy="14" r="1.2"/><circle class="dot" cx="18.4" cy="7.6" r="1.25"/>',
    trophy:   '<path class="tint" d="M7.2 4h9.6v5.2a4.8 4.8 0 0 1-9.6 0Z"/>' +
              '<path d="M7.2 4h9.6v5.2a4.8 4.8 0 0 1-9.6 0Z"/><path d="M7.2 5.4H4.4a1.6 1.6 0 0 0-1.4 2C3.5 9.4 5 10.6 7.2 10.8M16.8 5.4h2.8a1.6 1.6 0 0 1 1.4 2c-.5 2-2 3.2-4.2 3.4M12 14v5M8.2 20.5h7.6"/>',
    seed:     '<path d="M12 21v-8.8"/><path class="tint" d="M12 12.5c0-4 2.5-6.8 7.2-6.8 0 4-2.5 6.8-7.2 6.8Z"/>' +
              '<path d="M12 12.5c0-4 2.5-6.8 7.2-6.8 0 4-2.5 6.8-7.2 6.8Z"/><path d="M12 15.2c0-3.1-1.9-5.2-5.8-5.2 0 3.1 1.9 5.2 5.8 5.2Z"/><path class="dim" d="M7 21h10"/>',

    /* ── system / files ── */
    cloud:    '<path class="tint" d="M7 18.2a4.4 4.4 0 0 1-.4-8.8 5.9 5.9 0 0 1 11.6 1.5 3.6 3.6 0 0 1-.8 7.3Z"/>' +
              '<path d="M7 18.2a4.4 4.4 0 0 1-.4-8.8 5.9 5.9 0 0 1 11.6 1.5 3.6 3.6 0 0 1-.8 7.3Z"/>',
    archive:  '<rect class="tint" x="3.5" y="4" width="17" height="4.8" rx="1"/><rect x="3.5" y="4" width="17" height="4.8" rx="1"/>' +
              '<path d="M5.4 8.8v9.8A1.5 1.5 0 0 0 6.9 20h10.2a1.5 1.5 0 0 0 1.5-1.4V8.8"/><path d="M9.8 13.2h4.4"/>',
    gear:     '<path d="M10.4 3h3.2l.5 2.1 1.8.8 1.9-1.1 2.2 2.2-1.1 1.9.8 1.8 2.1.5v3.2l-2.1.5-.8 1.8 1.1 1.9-2.2 2.2-1.9-1.1-1.8.8-.5 2.1h-3.2l-.5-2.1-1.8-.8-1.9 1.1-2.2-2.2 1.1-1.9-.8-1.8L2.2 13.6v-3.2l2.1-.5.8-1.8-1.1-1.9L6.2 4l1.9 1.1 1.8-.8Z"/>' +
              '<circle cx="12" cy="12" r="3"/>',
    key:      '<circle cx="7.4" cy="15.4" r="3.6"/><circle class="dim" cx="7.4" cy="15.4" r="1.3"/>' +
              '<path d="M10.1 12.9 20.2 2.8M15.8 7.2l2.8 2.8M13.2 9.8l2.2 2.2"/>',
    image:    '<rect x="3.5" y="4.5" width="17" height="15" rx="1.8"/><circle cx="8.8" cy="9.6" r="1.6"/>' +
              '<path d="M4.5 17.5 9.8 12.2l3.8 3.6 2.6-2.4 3.4 3.4"/>',
    upload:   '<path d="M12 15.2V4M7.4 8.4 12 3.8l4.6 4.6"/><path d="M4.5 15.2v3.4a1.8 1.8 0 0 0 1.8 1.8h11.4a1.8 1.8 0 0 0 1.8-1.8v-3.4"/>',
    download: '<path d="M12 3.8v11.4M7.4 10.6 12 15.2l4.6-4.6"/><path d="M4.5 15.2v3.4a1.8 1.8 0 0 0 1.8 1.8h11.4a1.8 1.8 0 0 0 1.8-1.8v-3.4"/>',
    volume:   '<path class="tint" d="M4 9.5v5h3.5L12 19V5L7.5 9.5Z"/><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5Z"/>' +
              '<path d="M15.6 9.1a4.2 4.2 0 0 1 0 5.8"/><path class="dim" d="M18.2 6.6a7.8 7.8 0 0 1 0 10.8"/>',
    sliders:  '<path class="dim" d="M4 7h3m5 0h8M4 12h11m5 0h0M4 17h4m5 0h7"/>' +
              '<circle cx="9.5" cy="7" r="2.2"/><circle cx="17.5" cy="12" r="2.2"/><circle cx="10.5" cy="17" r="2.2"/>',
    trash:    '<path d="M4.2 6h15.6M9.5 3.4h5M18.4 6l-.9 13.6a1.8 1.8 0 0 1-1.8 1.7H8.3a1.8 1.8 0 0 1-1.8-1.7L5.6 6"/>' +
              '<path class="dim" d="M10 10.5v6.2M14 10.5v6.2"/>',
    copy:     '<rect x="8.6" y="8.6" width="11.2" height="11.2" rx="1.6"/>' +
              '<path class="dim" d="M5.6 15.6h-1a1.5 1.5 0 0 1-1.5-1.5v-9a1.5 1.5 0 0 1 1.5-1.5h9a1.5 1.5 0 0 1 1.5 1.5v1"/>',
    doc:      '<path d="M6 3.5h8.2l4.8 4.8V20a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z"/>' +
              '<path class="dim" d="M14.2 3.5v4.8H19M8.5 12.4h7M8.5 16.4h4.5"/>',
    map:      '<path d="M3.5 6.2 8.8 3.8l6.4 2.4 5.3-2.4v14l-5.3 2.4-6.4-2.4-5.3 2.4Z"/>' +
              '<path class="dim" d="M8.8 3.8v14M15.2 6.2v14"/><circle class="dot" cx="12" cy="10.5" r="1.3"/>',
    sword:    '<path d="M19.5 3.5l1 1-10.5 10.5-2-2Z"/><path d="M6.4 13.6l4 4M4.2 18.8l3-3M2.8 21.2l1.4-2.4 1.6 1.6-2.4 1.4Z"/>',
    hourglass:'<path d="M6 3.2h12M6 20.8h12M7.2 3.2v4.3a4.8 4.8 0 0 0 2.5 4.2L12 13.1l2.3-1.4a4.8 4.8 0 0 0 2.5-4.2V3.2M7.2 20.8v-4.3a4.8 4.8 0 0 1 2.5-4.2L12 10.9l2.3 1.4a4.8 4.8 0 0 1 2.5 4.2v4.3"/>' +
              '<path class="tint" d="M9 19.6h6l-3-3.4Z"/>',
    wand:     '<path d="M3.8 20.2 14.2 9.8"/><path d="M16.2 3.2l1 2.8 2.8 1-2.8 1-1 2.8-1-2.8-2.8-1 2.8-1Z"/>' +
              '<circle class="dot" cx="9" cy="6.2" r="1"/><circle class="dot" cx="19" cy="14.5" r=".9"/>',
    folder:   '<path d="M3.5 6a1.5 1.5 0 0 1 1.5-1.5h4.2l2.3 2.2H19a1.5 1.5 0 0 1 1.5 1.5v9.8a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z"/>' +
              '<path class="dim" d="M3.5 10.2h17"/>',
    compass:  '<circle cx="12" cy="12" r="8.8" class="dim"/><polygon class="tint" points="12,5.8 14.4,12 12,18.2 9.6,12"/>' +
              '<polygon points="12,5.8 14.4,12 12,18.2 9.6,12"/><circle class="dot" cx="12" cy="12" r="1.25"/>',
    arrow:    '<path d="M4.2 12h15M13.5 6.4 19.2 12l-5.7 5.6"/>',
    check:    '<path d="M4.8 12.6 10 17.8 19.4 6.6"/>',
    cross:    '<path d="M5.6 5.6l12.8 12.8M18.4 5.6l-12.8 12.8"/>'
  };

  /* Typographic fallbacks for string contexts (textContent / title / toast). */
  var TEXT = {
    target: '◎', shield: '⛨', flame: '✶', spark: '✦', bolt: '↯', person: '◍', skull: '☠', flow: '◌', hardcore: '☄',
    lock: '⊘', gauge: '◷', physics: '⚛', chemistry: '⚗', maths: '∆',
    moon: '☾', sun: '☀', sleep: '☾', eclipse: '◐', eye: '◉',
    bell: '◔', clock: '◷', chart: '∿', trophy: '♕', seed: '❧',
    cloud: '∘', archive: '▤', gear: '⚙', key: '⚥', image: '▣',
    upload: '↑', download: '↓', volume: '◍', arrow: '→', check: '✓', cross: '✕',
    sliders: '⌸', trash: '⌫', copy: '⎘', doc: '▤', map: '☲', sword: '⚔',
    hourglass: '⏳', wand: '✦', folder: '▤', compass: '⎈'
  };

  function sprite() {
    var defs = '';
    for (var name in GLYPHS) {
      var body = GLYPHS[name]
        .replace(/class="dot"/g, 'fill="currentColor" stroke="none"')
        .replace(/class="tint"/g, 'fill="currentColor" fill-opacity="0.16" stroke="none"')
        .replace(/class="dim"/g, 'stroke-opacity="0.46"')
        .replace(/class="thin"/g, 'stroke-width="0.9"');
      defs += '<symbol id="g-' + name + '" viewBox="0 0 24 24">' +
        '<g fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">' +
        body +
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
