// build-atlas.mjs — Observatory plate pipeline (dev tool, not part of the app).
// Reads the engraved folio plates in SVGs/pl-*.svg and writes atmosphere
// variants to atlas/: the folio chrome (paper, frames, cartouche, annotation
// groups, every <text>) is stripped, keeping only the subject, its stars and
// nebula. viewBox is re-cropped to the surviving art so CSS placement is
// predictable. No dependencies — a tiny balanced-tag walker, not a DOM.
//
// Also (Phase 2) emits atlas/line-*.svg accent glyphs from the cream
// gemini-svg* line drawings; the mapping table is filled in once each
// drawing has been visually identified, so it is empty for now.
//
// Usage: node scripts/build-atlas.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'SVGs');
const OUT = join(ROOT, 'atlas');

// ── Plate table ──────────────────────────────────────────────────────────
// keep   : top-level <g id="…"> groups that survive (the subject + its sky)
// loose  : keep unnamed top-level elements that appear after the first <g>
//          (some plates carry the moon disc / crater field / dial face /
//          star-chart wrapper as unnamed groups — the folio chrome is always
//          BEFORE the first <g>, so unnamed content after it is safe).
const PLATES = [
  { src: 'pl-i-event-horizon.svg',   out: 'atmos-i-horizon.svg',
    keep: ['nebula-wisps', 'star-field-40', 'gargantua-system'], loose: false },
  { src: 'pl-ii-instrument.svg',     out: 'atmos-ii-instrument.svg',
    keep: ['mount-pillar-and-feet', 'clock-drive-and-weight', 'equatorial-head', 'refractor-ota'], loose: false },
  { src: 'pl-iii-lunar-log.svg',     out: 'atmos-iii-lunar.svg',
    keep: ['moonlight-glow'], loose: true },
  { src: 'pl-iv-microscope.svg',     out: 'atmos-iv-microscope.svg',
    keep: ['claw-feet-and-base', 'forked-gimbal-mirror', 'doubled-limb-and-makers-plate',
           'microscope-body-tube', 'three-objective-turret', 'mechanical-stage-and-iris'], loose: false },
  { src: 'pl-v-armillary.svg',       out: 'atmos-v-armillary.svg',
    keep: ['voyager-pulsar-radiance', 'collared-column-stand', 'armillary-sphere-core',
           'meridian-and-horizon-frame'], loose: false },
  { src: 'pl-vi-constellation.svg',  out: 'atmos-vi-constellation.svg',
    keep: [], loose: true },   // the whole star chart is one unnamed wrapper <g>
  { src: 'pl-vii-regulator.svg',     out: 'atmos-vii-regulator.svg',
    keep: ['chassis-and-four-slotted-screws', 'knurled-outer-bezel', 'circular-grain-and-double-guilloche',
           'chapter-ring-twelve-numerals', 'gilded-burnout-marker-zero',
           'twelve-oclock-regulator-subdial', 'regulator-central-hands'], loose: true },
];

// Cream line-drawing accents (Phase 2): file in SVGs/ → output in atlas/.
// Fill in after visually identifying each drawing; empty = generator off.
const LINES = [
  // { src: 'gemini-svg (3).svg', out: 'line-telescope.svg' },
];

// ── Gemini plate library (atmosphere variants per screen) ────────────────
// The gemini drawings come in two series: engraved ink-on-cream "FIG./OBS."
// plates (re-inked to bone/brass for the dark void) and the polychrome
// "PLATE I–V" series (own deep-cosmos background kept, frames stripped).
// Engraved = Night mood, colored = Dusk mood, mirroring the dashboard pair.
const GEMINI_PLATES = [
  // dashboard (built earlier, same pipeline)
  { src: 'gemini-svg (15).svg', out: 'atmos-i-horizon-dusk.svg',  style: 'colored' },
  { src: 'gemini-svg (7).svg',  out: 'atmos-i-horizon-night.svg', style: 'engraved' },
  // settings — the equatorial refractor (calibrating the telescope)
  { src: 'gemini-svg.svg',      out: 'atmos-ii-instrument.svg',   style: 'engraved' },
  // tuck-in / night guard / bridge — the moon, both moods
  { src: 'gemini-svg (6).svg',  out: 'atmos-iii-lunar-night.svg', style: 'engraved' },
  { src: 'gemini-svg (14).svg', out: 'atmos-iii-lunar-dusk.svg',  style: 'colored' },
  // vault — specimens under glass (microscope night, morpho specimen dusk)
  { src: 'gemini-svg (1).svg',  out: 'atmos-iv-microscope.svg',   style: 'engraved' },
  { src: 'gemini-svg (17).svg', out: 'atmos-iv-specimen-dusk.svg',style: 'colored' },
  // grind station — navigation & growth (sextant night, chloroplast dusk)
  { src: 'gemini-svg (4).svg',  out: 'atmos-vi-sextant.svg',      style: 'engraved' },
  { src: 'gemini-svg (16).svg', out: 'atmos-vi-growth-dusk.svg',  style: 'colored' },
  // mocks — cycles & the cosmic clock (synodic night, Vela pulsar dusk)
  { src: 'gemini-svg (3).svg',  out: 'atmos-vii-synodic.svg',     style: 'engraved' },
  { src: 'gemini-svg (18).svg', out: 'atmos-vii-pulsar-dusk.svg', style: 'colored' },
  // boot / AIR rank — the ptolemaic armillary
  { src: 'gemini-svg (2).svg',  out: 'atmos-v-armillary.svg',     style: 'engraved' }
];

/* Gemini plates share one layout: a 600×600 canvas, a full-size background
   (cream parchment for engraved, a deep gradient for colored), one or two
   hairline frame rects, and monospace telemetry <text>. Atmosphere variants:
   engraved → parchment + frames + texts go, ink strokes are re-inked to
   bone/brass for the dark void (the horizon shadow stays near-black);
   colored → its own cosmic background STAYS, frames + texts go. */
function buildGeminiPlate(cfg) {
  let svg = readFileSync(join(SRC, cfg.src), 'utf8');
  svg = svg.replace(/<text[\s\S]*?<\/text>/g, '');
  if (cfg.style === 'engraved') {
    svg = svg
      .replace(/<rect width="600" height="600" fill="#F4EFE6" \/>/, '')
      .replace(/<rect x="24" y="24" width="552" height="552"[^>]*\/>/, '')
      .replace(/<rect x="32" y="32" width="536" height="536"[^>]*\/>/, '');
    svg = svg.split('stroke="#1E1D1A"').join('stroke="#F2EDE3"');
    svg = svg.split('fill="#1E1D1A"').join('fill="#06070A"');
  } else {
    svg = svg
      .replace(/<rect x="20" y="20" width="560" height="560"[^>]*\/>/, '')
      .replace(/<rect x="28" y="28" width="544" height="544"[^>]*\/>/, '');
  }
  for (const re of (cfg.strip || [])) svg = svg.replace(re, '');
  svg = svg.replace(/\n\s+/g, '\n');
  writeFileSync(join(OUT, cfg.out), svg);
  return { bytes: svg.length };
}

// ── Tiny balanced-tag walker ─────────────────────────────────────────────
// Returns [{ tag, attrs, markup, start }] for the DIRECT children of `svg`.
function topLevelChildren(src) {
  const open = src.match(/<svg\b[^>]*>/);
  const body = src.slice(open[0].length, src.lastIndexOf('</svg>'));
  const out = [];
  let i = 0;
  while (i < body.length) {
    const lt = body.indexOf('<', i);
    if (lt < 0) break;
    const m = /^<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"])*)>?/.exec(body.slice(lt));
    if (!m) { i = lt + 1; continue; }
    const tag = m[1];
    const attrs = m[2] || '';
    if (attrs.endsWith('/')) {                       // self-closing leaf
      out.push({ tag, attrs, markup: body.slice(lt, lt + m[0].length) });
      i = lt + m[0].length;
      continue;
    }
    // find the matching close tag, counting nested same-name opens
    const close = `</${tag}>`;
    let depth = 1, j = lt + m[0].length;
    while (depth > 0) {
      const nextOpen = body.indexOf(`<${tag}`, j);
      const nextClose = body.indexOf(close, j);
      if (nextClose < 0) throw new Error(`unbalanced <${tag}>`);
      if (nextOpen >= 0 && nextOpen < nextClose) {
        // guard: "<g" would also match "<gblah" — require a boundary char
        const ch = body[nextOpen + 1 + tag.length];
        if (ch === '>' || ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '/') { depth++; j = nextOpen + tag.length + 1; continue; }
      }
      depth--; j = nextClose + close.length;
    }
    out.push({ tag, attrs, markup: body.slice(lt, j) });
    i = j;
  }
  return out;
}

function attrOf(markup, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(markup);
  return m ? m[1] : null;
}

function stripTexts(markup) {
  return markup.replace(/<text[\s\S]*?<\/text>/g, '');
}

// ── Approximate content bbox (viewBox crop) ──────────────────────────────
// Scans coordinate-bearing attributes + path data numbers. Control points
// and rotate() centres are included by design — an over-estimate beats
// clipping. Result is clamped inside the source viewBox and padded.
function approxBBox(markup, vb) {
  const pts = [];
  const push = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]); };
  const num = s => parseFloat(s);
  for (const el of markup.matchAll(/<(rect|circle|ellipse|line|path)\b[^>]*?(?:\/>|>)/g)) {
    const t = el[0];
    if (/^<rect/.test(t)) {
      const x = num(attrOf(t, 'x') ?? 0), y = num(attrOf(t, 'y') ?? 0);
      const w = num(attrOf(t, 'width') ?? 0), h = num(attrOf(t, 'height') ?? 0);
      push(x, y); push(x + w, y + h);
    } else if (/^<circle/.test(t)) {
      const cx = num(attrOf(t, 'cx') ?? 0), cy = num(attrOf(t, 'cy') ?? 0), r = num(attrOf(t, 'r') ?? 0);
      push(cx - r, cy - r); push(cx + r, cy + r);
    } else if (/^<ellipse/.test(t)) {
      const cx = num(attrOf(t, 'cx') ?? 0), cy = num(attrOf(t, 'cy') ?? 0);
      const rx = num(attrOf(t, 'rx') ?? 0), ry = num(attrOf(t, 'ry') ?? 0);
      push(cx - rx, cy - ry); push(cx + rx, cy + ry);
    } else if (/^<line/.test(t)) {
      push(num(attrOf(t, 'x1') ?? 0), num(attrOf(t, 'y1') ?? 0));
      push(num(attrOf(t, 'x2') ?? 0), num(attrOf(t, 'y2') ?? 0));
    } else if (/^<path/.test(t)) {
      const d = attrOf(t, 'd');
      if (d) {
        const nums = d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
        for (let k = 0; k + 1 < nums.length; k += 2) push(nums[k], nums[k + 1]);
      }
    }
    // rotate(a cx cy) and translate(x y) give one more anchor point each
    for (const tr of t.matchAll(/rotate\([^)]*\)/g)) {
      const a = tr[0].match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
      if (a.length >= 3) push(a[1], a[2]);
    }
    for (const tr of t.matchAll(/translate\([^)]*\)/g)) {
      const a = tr[0].match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
      if (a.length >= 2) push(a[0], a[1]);
    }
  }
  if (!pts.length) return vb;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pad = 28;
  const x0 = clamp(Math.min(...xs) - pad, vb[0], vb[0] + vb[2]);
  const y0 = clamp(Math.min(...ys) - pad, vb[1], vb[1] + vb[3]);
  const x1 = clamp(Math.max(...xs) + pad, vb[0], vb[0] + vb[2]);
  const y1 = clamp(Math.max(...ys) + pad, vb[1], vb[1] + vb[3]);
  return [x0, y0, x1 - x0, y1 - y0].map(v => Math.round(v * 10) / 10);
}

// ── Plate pipeline ───────────────────────────────────────────────────────
function buildPlate(cfg) {
  const raw = readFileSync(join(SRC, cfg.src), 'utf8');
  const vbMatch = /viewBox="([\d.\s-]+)"/.exec(raw);
  const vb = vbMatch[1].trim().split(/\s+/).map(Number);
  const children = topLevelChildren(raw);

  const defs = children.find(c => c.tag === 'defs');
  const content = children.filter(c => c.tag !== 'defs');

  // Folio chrome = every top-level element BEFORE the first <g>.
  const firstG = content.findIndex(c => c.tag === 'g');
  const candidates = firstG < 0 ? [] : content.slice(firstG);

  const keptEls = [], dropped = [];
  let seenNamed = false;
  for (const el of candidates) {
    const id = attrOf(el.attrs, 'id');
    if (el.tag === 'text') { dropped.push(`${el.tag}${id ? '#' + id : ''}`); continue; }
    if (id) {
      seenNamed = true;
      if (cfg.keep.includes(id)) keptEls.push(el); else dropped.push(`${el.tag}#${id}`);
    } else if (cfg.loose && seenNamed) {
      keptEls.push(el);
    } else if (cfg.loose && el.tag === 'g') {
      keptEls.push(el);
    } else {
      dropped.push(`${el.tag}(unnamed)`);
    }
  }

  let body = keptEls.map(el => stripTexts(el.markup)).join('\n');

  // Defs: drop the vignette gradient, prune now-unused CSS rules.
  let defsMarkup = defs ? defs.markup : '';
  defsMarkup = defsMarkup.replace(/<radialGradient id="plate-vignette"[\s\S]*?<\/radialGradient>/g, '');
  defsMarkup = defsMarkup
    .split('\n').filter(l => !/\.label-|\.font-serif|\.font-mono|\.plate-bg|\.plate-paper/.test(l)).join('\n');

  const newVb = approxBBox(body, vb);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${newVb.join(' ')}">` +
    defsMarkup + body + `</svg>`;
  const min = svg.replace(/\n\s+/g, '\n').replace(/>\s+</g, '><');
  writeFileSync(join(OUT, cfg.out), min);
  const kept = keptEls.map(el => `${el.tag}${attrOf(el.attrs, 'id') ? '#' + attrOf(el.attrs, 'id') : '(unnamed)'}`);
  return { kept, dropped, vb: newVb, bytes: min.length };
}

// ── Line-drawing accents (Phase 2) ───────────────────────────────────────
function buildLine(cfg) {
  let svg = readFileSync(join(SRC, cfg.src), 'utf8');
  svg = svg
    .replace(/<rect[^>]*(class="[^"]*(?:paper|bg|parchment)[^"]*"|fill="[^"]*(?:f|e)[0-9a-f]{5}")[^>]*\/?>/gi, '')
    .replace(/<text[\s\S]*?<\/text>/g, '')
    // recolour the engraved strokes to currentColor so CSS can tint them
    .replace(/(stroke)="#[0-9a-fA-F]{3,8}"/g, '$1="currentColor"')
    .replace(/\n\s+/g, '\n');
  writeFileSync(join(OUT, cfg.out), svg);
  return { bytes: svg.length };
}

mkdirSync(OUT, { recursive: true });
if (!readdirSync) { /* node >= 14.14 always has it — placate linters */ }
for (const cfg of PLATES) {
  const r = buildPlate(cfg);
  console.log(`✓ ${cfg.out}  viewBox="${r.vb.join(' ')}"  ${(r.bytes / 1024).toFixed(1)} KB`);
  console.log(`   kept    ${r.kept.join(', ') || '(nothing named — loose art only)'}`);
  console.log(`   dropped ${r.dropped.join(', ')}`);
}
for (const cfg of LINES) {
  const r = buildLine(cfg);
  console.log(`✓ ${cfg.out}  ${(r.bytes / 1024).toFixed(1)} KB`);
}
for (const cfg of GEMINI_PLATES) {
  const r = buildGeminiPlate(cfg);
  console.log(`✓ ${cfg.out}  ${(r.bytes / 1024).toFixed(1)} KB  (${cfg.style}, from ${cfg.src})`);
}
console.log(LINES.length || GEMINI_PLATES.length ? 'done' : 'done (line-* accents deferred to Phase 2)');
