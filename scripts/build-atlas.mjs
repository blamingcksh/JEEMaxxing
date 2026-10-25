// build-atlas.mjs — Observatory plate pipeline.
// Reads the engraved folio plates in SVGs/pl-*.svg and gemini-svg*.svg
// and writes all 26 museum-grade SVGs to atlas/.
//
// Usage: node scripts/build-atlas.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'SVGs');
const OUT = join(ROOT, 'atlas');

// ── Master pl-*.svg Folio Plates ──────────────────────────────────────────
const PLATES = [
  { src: 'pl-i-event-horizon.svg',   out: 'folio-i-horizon.svg',
    keep: ['nebula-wisps', 'star-field-40', 'gargantua-system'], loose: false },
  { src: 'pl-ii-instrument.svg',     out: 'atmos-ii-instrument-dusk.svg',
    keep: ['mount-pillar-and-feet', 'clock-drive-and-weight', 'equatorial-head', 'refractor-ota'], loose: false },
  { src: 'pl-iii-lunar-log.svg',     out: 'folio-iii-lunar.svg',
    keep: ['moonlight-glow'], loose: true },
  { src: 'pl-iv-microscope.svg',     out: 'folio-iv-microscope.svg',
    keep: ['claw-feet-and-base', 'forked-gimbal-mirror', 'doubled-limb-and-makers-plate',
           'microscope-body-tube', 'three-objective-turret', 'mechanical-stage-and-iris'], loose: false },
  { src: 'pl-v-armillary.svg',       out: 'folio-v-armillary.svg',
    keep: ['voyager-pulsar-radiance', 'collared-column-stand', 'armillary-sphere-core',
           'meridian-and-horizon-frame'], loose: false },
  { src: 'pl-vi-constellation.svg',  out: 'folio-vi-constellation.svg',
    keep: [], loose: true },
  { src: 'pl-vii-regulator.svg',     out: 'folio-vii-regulator.svg',
    keep: ['chassis-and-four-slotted-screws', 'knurled-outer-bezel', 'circular-grain-and-double-guilloche',
           'chapter-ring-twelve-numerals', 'gilded-burnout-marker-zero',
           'twelve-oclock-regulator-subdial', 'regulator-central-hands'], loose: true },
];

// ── Gemini Plates (Atmosphere & Foreground Specimen Engravings) ───────────
const GEMINI_TARGETS = [
  // Atmosphere plates
  { src: 'dashboard-moon-astrolabe.svg', out: 'atmos-i-horizon-night.svg', style: 'moon-night' },
  { src: 'dashboard-moon-astrolabe.svg', out: 'atmos-i-horizon-dusk.svg',  style: 'moon-dusk' },
  { src: 'gemini-svg.svg',      out: 'atmos-ii-instrument-night.svg',    style: 'engraved' },
  { src: 'gemini-svg (6).svg',  out: 'atmos-iii-lunar-night.svg',       style: 'engraved' },
  { src: 'gemini-svg (14).svg', out: 'atmos-iii-lunar-dusk.svg',        style: 'colored' },
  { src: 'gemini-svg (1).svg',  out: 'atmos-iv-microscope-night.svg',   style: 'engraved' },
  { src: 'gemini-svg (17).svg', out: 'atmos-iv-microscope-dusk.svg',    style: 'colored' },
  { src: 'gemini-svg (4).svg',  out: 'atmos-v-sextant-night.svg',       style: 'engraved' },
  { src: 'gemini-svg (16).svg', out: 'atmos-v-sextant-dusk.svg',        style: 'colored' },
  { src: 'gemini-svg (3).svg',  out: 'atmos-vi-selenograph-night.svg',  style: 'engraved' },
  { src: 'gemini-svg (18).svg', out: 'atmos-vi-selenograph-dusk.svg',   style: 'colored' },
  { src: 'gemini-svg (2).svg',  out: 'atmos-v-armillary.svg',           style: 'engraved' },

  // Foreground Specimen engravings
  { src: 'gemini-svg (12).svg', out: 'specimen-phys-chladni.svg',       style: 'engraved' },
  { src: 'gemini-svg (9).svg',  out: 'specimen-phys-corona.svg',        style: 'engraved' },
  { src: 'gemini-svg (11).svg', out: 'specimen-chem-dendrite.svg',      style: 'engraved' },
  { src: 'gemini-svg (10).svg', out: 'specimen-math-nautilus.svg',      style: 'engraved' },
  { src: 'gemini-svg (5).svg',  out: 'specimen-heliometer.svg',         style: 'engraved' },
  { src: 'gemini-svg (8).svg',  out: 'specimen-botanical.svg',          style: 'engraved' },
  { src: 'gemini-svg (13).svg', out: 'specimen-iris.svg',               style: 'engraved' },
];

// Backwards-compatible aliases for legacy runtime/test paths
const ALIASES = [
  { from: 'atmos-i-horizon-night.svg',      to: 'atmos-i-horizon.svg' },
  { from: 'atmos-ii-instrument-night.svg',  to: 'atmos-ii-instrument.svg' },
  { from: 'folio-iii-lunar.svg',            to: 'atmos-iii-lunar.svg' },
  { from: 'atmos-iv-microscope-night.svg',  to: 'atmos-iv-microscope.svg' },
  { from: 'atmos-iv-microscope-dusk.svg',   to: 'atmos-iv-specimen-dusk.svg' },
  { from: 'folio-vi-constellation.svg',     to: 'atmos-vi-constellation.svg' },
  { from: 'atmos-v-sextant-night.svg',      to: 'atmos-vi-sextant.svg' },
  { from: 'atmos-v-sextant-dusk.svg',       to: 'atmos-vi-growth-dusk.svg' },
  { from: 'atmos-vi-selenograph-night.svg', to: 'atmos-vii-synodic.svg' },
  { from: 'atmos-vi-selenograph-dusk.svg',  to: 'atmos-vii-pulsar-dusk.svg' },
  { from: 'folio-vii-regulator.svg',        to: 'atmos-vii-regulator.svg' },
];

function stripBalancedGroup(svg, openRegex) {
  let result = svg;
  while (true) {
    const match = openRegex.exec(result);
    if (!match) break;
    const startIdx = match.index;
    const openTagEnd = result.indexOf('>', startIdx);
    if (openTagEnd === -1) break;
    if (result.slice(startIdx, openTagEnd).endsWith('/')) {
      result = result.slice(0, startIdx) + result.slice(openTagEnd + 1);
      continue;
    }
    let depth = 1;
    let pos = openTagEnd + 1;
    while (depth > 0 && pos < result.length) {
      const nextOpen = result.indexOf('<g', pos);
      const nextClose = result.indexOf('</g>', pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        const charAfter = result[nextOpen + 2];
        if (charAfter === ' ' || charAfter === '>' || charAfter === '\n' || charAfter === '\t' || charAfter === '\r') {
          const tagEnd = result.indexOf('>', nextOpen);
          if (tagEnd !== -1 && result[tagEnd - 1] === '/') {
            pos = tagEnd + 1;
            continue;
          }
          depth++;
          pos = (tagEnd !== -1 ? tagEnd : nextOpen + 2) + 1;
          continue;
        } else {
          pos = nextOpen + 2;
          continue;
        }
      }
      depth--;
      pos = nextClose + 4;
    }
    if (depth === 0) {
      result = result.slice(0, startIdx) + result.slice(pos);
    } else {
      break;
    }
  }
  return result;
}

function buildGeminiEngraved(raw, cfg = {}) {
  let svg = raw;

  // 1. Strip <text> tags
  svg = svg.replace(/<text[\s\S]*?<\/text>/gi, '');

  // 2. Strip outer canvas & frame rects (width >= 520 && height >= 520)
  svg = svg.replace(/<rect\b[^>]*\/?>/gi, (match) => {
    const wm = match.match(/width="(\d+(?:\.\d+)?)"/);
    const hm = match.match(/height="(\d+(?:\.\d+)?)"/);
    if (wm && hm) {
      const w = parseFloat(wm[1]);
      const h = parseFloat(hm[1]);
      if (w >= 520 && h >= 520) return '';
    }
    return match;
  });

  // Strip stray corner calibration marks (e.g. gemini-svg.svg L-brackets)
  svg = svg.replace(/<!--\s*Corner Calibration Marks\s*-->\s*<g[\s\S]*?<\/g>/gi, '');

  // 3. Plate-specific callout / legend stripping
  if (cfg.out === 'atmos-i-horizon-night.svg') {
    svg = stripBalancedGroup(svg, /<g[^>]*>\s*<line\s+x1="230"\s+y1="120"/);
  }

  // 4. Re-ink <pattern> blocks first
  svg = svg.replace(/<pattern[\s\S]*?<\/pattern>/gi, (patternBlock) => {
    return patternBlock
      .replace(/#1E1D1A/gi, 'rgba(229,192,123,0.34)')
      .replace(/#F4EFE6/gi, 'none');
  });

  // 5. Invert tonal hierarchy outside patterns
  svg = svg
    .replace(/stroke=["']#F4EFE6["']/gi, 'stroke="#F2EDE3"')
    .replace(/fill=["']#F4EFE6["']/gi, 'fill="#090C14"')
    .replace(/stroke=["']#E6DEC8["']/gi, 'stroke="rgba(229,192,123,0.38)"')
    .replace(/fill=["']#E6DEC8["']/gi, 'fill="#121724"')
    .replace(/#C59B5F/gi, '#E5C07B')
    .replace(/#D96B43/gi, '#E07A52')
    .replace(/stroke=["']#1E1D1A["']/gi, 'stroke="#F2EDE3"')
    .replace(/stop-color=["']#1E1D1A["']/gi, 'stop-color="#05070C"')
    .replace(/stop-color=["']#F4EFE6["']/gi, 'stop-color="#090C14"')
    .replace(/stop-color=["']#E6DEC8["']/gi, 'stop-color="#121724"');

  // Groups with fill="#1E1D1A" -> #0B0E17 (dark obsidian)
  svg = svg.replace(/<g\b([^>]*?)fill=["']#1E1D1A["']([^>]*?)>/gi, '<g$1fill="#0B0E17"$2>');

  // Circles with fill="#1E1D1A": r <= 9 -> #F2EDE3, else #05070C
  svg = svg.replace(/<circle\b([^>]*?)fill=["']#1E1D1A["']([^>]*?)>/gi, (m, p1, p2) => {
    const rm = (p1 + p2).match(/\br="(\d+(?:\.\d+)?)"/);
    const r = rm ? parseFloat(rm[1]) : 0;
    const col = r <= 9 ? '#F2EDE3' : '#05070C';
    return `<circle${p1}fill="${col}"${p2}>`;
  });

  // Rects with fill="#1E1D1A": tiny ticks (w <= 16 && h <= 16) -> #F2EDE3;
  // larger rects (stages, bars) -> #090C14 with subtle stroke if none present
  svg = svg.replace(/<rect\b([^>]*?)fill=["']#1E1D1A["']([^>]*?)>/gi, (m, p1, p2) => {
    const wm = (p1 + p2).match(/\bwidth="(\d+(?:\.\d+)?)"/);
    const hm = (p1 + p2).match(/\bheight="(\d+(?:\.\d+)?)"/);
    const w = wm ? parseFloat(wm[1]) : 999;
    const h = hm ? parseFloat(hm[1]) : 999;
    if (w <= 16 && h <= 16) {
      return `<rect${p1}fill="#F2EDE3"${p2}>`;
    }
    const hasStroke = /\bstroke=/.test(p1 + p2);
    const strokeAttr = hasStroke ? '' : ' stroke="rgba(242,237,227,0.45)" stroke-width="0.9"';
    return `<rect${p1}fill="#090C14"${strokeAttr}${p2}>`;
  });

  // Polygons with fill="#1E1D1A": tiny arrowheads/star tips (dx <= 22 && dy <= 22) -> #F2EDE3;
  // larger structural elements (tripod legs, sextant struts) -> #0B0E17 with stroke if none present
  svg = svg.replace(/<polygon\b([^>]*?)fill=["']#1E1D1A["']([^>]*?)>/gi, (m, p1, p2) => {
    const combined = p1 + p2;
    const pm = combined.match(/\bpoints="([^"]*)"/);
    if (pm) {
      const nums = pm[1].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [];
      if (nums.length >= 2) {
        const xs = [];
        const ys = [];
        for (let i = 0; i + 1 < nums.length; i += 2) {
          xs.push(nums[i]);
          ys.push(nums[i + 1]);
        }
        const dx = Math.max(...xs) - Math.min(...xs);
        const dy = Math.max(...ys) - Math.min(...ys);
        if (dx <= 22 && dy <= 22) {
          return `<polygon${p1}fill="#F2EDE3"${p2}>`;
        }
      }
    }
    const hasStroke = /\bstroke=/.test(combined);
    const strokeAttr = hasStroke ? '' : ' stroke="#F2EDE3" stroke-width="1"';
    return `<polygon${p1}fill="#0B0E17"${strokeAttr}${p2}>`;
  });

  // Any remaining fill="#1E1D1A" (large ellipses, paths, umbra/cores) -> #05070C
  svg = svg.replace(/fill=["']#1E1D1A["']/gi, 'fill="#05070C"');

  // Trim outer stripped margin so subject fills frame generously
  svg = svg.replace(/viewBox=["'][^"']*["']/, 'viewBox="36 36 528 528"');

  // Clean empty groups
  svg = svg.replace(/<g\b[^>]*>\s*<\/g>/gi, '');
  svg = svg.replace(/\n\s*\n+/g, '\n');

  return svg;
}

function buildGeminiColored(raw, cfg = {}) {
  let svg = raw;

  // 1. Strip text
  svg = svg.replace(/<text[\s\S]*?<\/text>/gi, '');

  // 2. Strip outer canvas & border rects (width >= 520 && height >= 520)
  svg = svg.replace(/<rect\b[^>]*\/?>/gi, (match) => {
    const wm = match.match(/width="(\d+(?:\.\d+)?)"/);
    const hm = match.match(/height="(\d+(?:\.\d+)?)"/);
    if (wm && hm) {
      const w = parseFloat(wm[1]);
      const h = parseFloat(hm[1]);
      if (w >= 520 && h >= 520) return '';
    }
    return match;
  });

  // 3. Plate-specific legend/sub-box stripping for dusk atmosphere plates
  if (cfg.out === 'atmos-i-horizon-dusk.svg') {
    svg = stripBalancedGroup(svg, /<g\s+transform="translate\(415,\s*42\)"/);
  }
  if (cfg.out === 'atmos-iv-microscope-dusk.svg') {
    svg = stripBalancedGroup(svg, /<g\s+transform="translate\(52,\s*438\)"/);
  }
  if (cfg.out === 'atmos-v-sextant-dusk.svg') {
    svg = stripBalancedGroup(svg, /<g\s+transform="translate\(325,\s*412\)"/);
  }
  if (cfg.out === 'atmos-vi-selenograph-dusk.svg') {
    svg = stripBalancedGroup(svg, /<g\s+transform="translate\(52,\s*482\)"/);
  }

  // Trim viewBox
  svg = svg.replace(/viewBox=["'][^"']*["']/, 'viewBox="36 36 528 528"');

  // Clean empty groups
  svg = svg.replace(/<g\b[^>]*>\s*<\/g>/gi, '');
  svg = svg.replace(/\n\s*\n+/g, '\n');

  return svg;
}

function buildMoonAstrolabe(raw, mode = 'night') {
  let svg = raw;

  // 1. Strip the opaque rectangular space-bg canvas so the Moon & astrolabe float
  //    seamlessly over the true Observatory void (--obs-void) and starfield.
  svg = svg.replace(/<radialGradient id="space-bg"[\s\S]*?<\/radialGradient>\s*/i, '');
  svg = svg.replace(/<rect\b[^>]*fill=["']url\(#space-bg\)["'][^>]*\/?>\s*/i, '');

  const voidCol = mode === 'dusk' ? '#12141C' : '#06070A';
  const voidDeep = mode === 'dusk' ? '#0E1017' : '#040508';
  const mareCol1 = mode === 'dusk' ? '#1A1D28' : '#0D1018';
  const mareCol2 = mode === 'dusk' ? '#252938' : '#151924';

  // 2. Re-ink all gradients from modern cyan/slate into Observatory Copperplate
  //    (Warm Bone #F2EDE3, Antique Brass #E5C07B, Aged Ivory #D8CEBE, Obsidian Void)
  svg = svg.replace(
    /<radialGradient id="corona-outer"[\s\S]*?<\/radialGradient>/i,
    `<radialGradient id="corona-outer" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#E5C07B" stop-opacity="${mode === 'dusk' ? '0.26' : '0.18'}" />
      <stop offset="38%" stop-color="#F2EDE3" stop-opacity="${mode === 'dusk' ? '0.11' : '0.07'}" />
      <stop offset="70%" stop-color="#E5C07B" stop-opacity="0.02" />
      <stop offset="100%" stop-color="#E5C07B" stop-opacity="0" />
    </radialGradient>`
  );

  svg = svg.replace(
    /<radialGradient id="corona-inner"[\s\S]*?<\/radialGradient>/i,
    `<radialGradient id="corona-inner" cx="46%" cy="44%" r="36%">
      <stop offset="0%" stop-color="#F2EDE3" stop-opacity="0.42" />
      <stop offset="55%" stop-color="#E5C07B" stop-opacity="0.18" />
      <stop offset="80%" stop-color="#C8A96E" stop-opacity="0.05" />
      <stop offset="100%" stop-color="${voidCol}" stop-opacity="0" />
    </radialGradient>`
  );

  svg = svg.replace(
    /<radialGradient id="lunar-surface"[\s\S]*?<\/radialGradient>/i,
    `<radialGradient id="lunar-surface" cx="34%" cy="32%" r="68%" fx="28%" fy="26%">
      <stop offset="0%" stop-color="#F2EDE3" />
      <stop offset="22%" stop-color="#E6DEC8" />
      <stop offset="48%" stop-color="#C9BEA7" />
      <stop offset="74%" stop-color="#7E7566" />
      <stop offset="90%" stop-color="#3A3631" />
      <stop offset="100%" stop-color="#171615" />
    </radialGradient>`
  );

  svg = svg.replace(
    /<linearGradient id="warm-albedo"[\s\S]*?<\/linearGradient>/i,
    `<linearGradient id="warm-albedo" x1="15%" y1="15%" x2="85%" y2="85%">
      <stop offset="0%" stop-color="#E5C07B" stop-opacity="0.32" />
      <stop offset="48%" stop-color="#F2EDE3" stop-opacity="0.12" />
      <stop offset="100%" stop-color="#8A6D3B" stop-opacity="0.24" />
    </linearGradient>`
  );

  svg = svg.replace(
    /<radialGradient id="mare-dark"[\s\S]*?<\/radialGradient>/i,
    `<radialGradient id="mare-dark" cx="45%" cy="45%" r="55%">
      <stop offset="0%" stop-color="${mareCol1}" stop-opacity="0.62" />
      <stop offset="65%" stop-color="${mareCol2}" stop-opacity="0.40" />
      <stop offset="100%" stop-color="#4A453D" stop-opacity="0" />
    </radialGradient>`
  );

  svg = svg.replace(
    /<radialGradient id="mare-deep"[\s\S]*?<\/radialGradient>/i,
    `<radialGradient id="mare-deep" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${mareCol1}" stop-opacity="0.68" />
      <stop offset="70%" stop-color="${mareCol2}" stop-opacity="0.36" />
      <stop offset="100%" stop-color="#3A3631" stop-opacity="0" />
    </radialGradient>`
  );

  svg = svg.replace(
    /<radialGradient id="terminator-shadow"[\s\S]*?<\/radialGradient>/i,
    `<radialGradient id="terminator-shadow" cx="28%" cy="30%" r="72%" fx="22%" fy="24%">
      <stop offset="0%" stop-color="${voidCol}" stop-opacity="0" />
      <stop offset="50%" stop-color="${voidCol}" stop-opacity="0" />
      <stop offset="66%" stop-color="${voidCol}" stop-opacity="0.52" />
      <stop offset="78%" stop-color="${voidCol}" stop-opacity="0.86" />
      <stop offset="92%" stop-color="${voidDeep}" stop-opacity="0.95" />
      <stop offset="100%" stop-color="#1A1610" stop-opacity="0.88" />
    </radialGradient>`
  );

  svg = svg.replace(
    /<linearGradient id="sunlit-limb"[\s\S]*?<\/linearGradient>/i,
    `<linearGradient id="sunlit-limb" x1="0%" y1="0%" x2="75%" y2="75%">
      <stop offset="0%" stop-color="#F2EDE3" stop-opacity="0.95" />
      <stop offset="35%" stop-color="#E5C07B" stop-opacity="0.65" />
      <stop offset="65%" stop-color="#E5C07B" stop-opacity="0" />
    </linearGradient>`
  );

  svg = svg.replace(
    /<linearGradient id="earthshine-limb"[\s\S]*?<\/linearGradient>/i,
    `<linearGradient id="earthshine-limb" x1="100%" y1="100%" x2="25%" y2="25%">
      <stop offset="0%" stop-color="#E5C07B" stop-opacity="0.55" />
      <stop offset="28%" stop-color="#C8A96E" stop-opacity="0.22" />
      <stop offset="55%" stop-color="#C8A96E" stop-opacity="0" />
    </linearGradient>`
  );

  svg = svg.replace(
    /<linearGradient id="crater-pit"[\s\S]*?<\/linearGradient>/i,
    `<linearGradient id="crater-pit" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#141311" stop-opacity="0.78" />
      <stop offset="45%" stop-color="#575046" stop-opacity="0.25" />
      <stop offset="100%" stop-color="#F2EDE3" stop-opacity="0.75" />
    </linearGradient>`
  );

  svg = svg.replace(
    /<linearGradient id="crater-rim-light"[\s\S]*?<\/linearGradient>/i,
    `<linearGradient id="crater-rim-light" x1="100%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#F2EDE3" stop-opacity="0.9" />
      <stop offset="50%" stop-color="#E5C07B" stop-opacity="0.35" />
      <stop offset="100%" stop-color="#1E1D1A" stop-opacity="0.7" />
    </linearGradient>`
  );

  svg = svg.replace(
    /<linearGradient id="ring-cyan"[\s\S]*?<\/linearGradient>/i,
    `<linearGradient id="ring-cyan" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#F2EDE3" stop-opacity="0.78" />
      <stop offset="50%" stop-color="#E5C07B" stop-opacity="0.32" />
      <stop offset="100%" stop-color="#F2EDE3" stop-opacity="0.62" />
    </linearGradient>`
  );

  svg = svg.replace(
    /<linearGradient id="ring-gold"[\s\S]*?<\/linearGradient>/i,
    `<linearGradient id="ring-gold" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#E5C07B" stop-opacity="0.85" />
      <stop offset="50%" stop-color="#F2EDE3" stop-opacity="0.28" />
      <stop offset="100%" stop-color="#E5C07B" stop-opacity="0.62" />
    </linearGradient>`
  );

  // Inject copperplate hatching pattern into <defs>
  svg = svg.replace(
    /<\/defs>/i,
    `  <!-- Copperplate Engraving Hatching Pattern -->
    <pattern id="obs-copper-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <line x1="0" y1="0" x2="0" y2="8" stroke="#1E1D1A" stroke-width="0.9" stroke-opacity="0.42" />
      <line x1="4" y1="0" x2="4" y2="8" stroke="#F2EDE3" stroke-width="0.45" stroke-opacity="0.16" />
    </pattern>
    <pattern id="obs-terminator-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-42)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="#E5C07B" stroke-width="0.55" stroke-opacity="0.22" />
    </pattern>
  </defs>`
  );

  // 3. Replace remaining modern cyan/slate hex codes with Observatory Bone & Brass
  svg = svg
    .replace(/#38bdf8/gi, '#E5C07B')
    .replace(/#bae6fd/gi, '#F2EDE3')
    .replace(/#e0f2fe/gi, '#F2EDE3')
    .replace(/#0284c7/gi, '#C8A96E')
    .replace(/#fcd34d/gi, '#E5C07B')
    .replace(/#fef3c7/gi, '#F2EDE3')
    .replace(/#f8fafc/gi, '#F2EDE3')
    .replace(/#e2e8f0/gi, '#E6DEC8')
    .replace(/#94a3b8/gi, '#C8A96E')
    .replace(/#334155/gi, '#1B1A17')
    .replace(/#ffffff/gi, '#F2EDE3');

  // 4. Enhance astrolabe geometry stroke widths & add engraved degree scale feel
  svg = svg.replace(/<g id="celestial-geometry">[\s\S]*?<\/g>\s*(?=<!-- 4\. LUNAR CORONA)/i, (geo) => {
    return geo
      .replace(/stroke-width="0\.5"/g, 'stroke-width="0.9"')
      .replace(/stroke-width="0\.6"/g, 'stroke-width="1.0"')
      .replace(/stroke-width="0\.75"/g, 'stroke-width="1.15"')
      .replace(/stroke-width="0\.8"/g, 'stroke-width="1.2"')
      .replace(/opacity="0\.28"/g, 'opacity="0.48"')
      .replace(/opacity="0\.35"/g, 'opacity="0.55"')
      .replace(/opacity="0\.4"/g, 'opacity="0.58"')
      .replace(/opacity="0\.45"/g, 'opacity="0.64"');
  });

  // 5. Add engraved selenographic meridian/parallel graticule & copperplate contour lines inside #moon-sphere
  const selenographicGraticule = `
    <!-- ENGRAVED SELENOGRAPHIC GRATICULE & COPPERPLATE HATCHING -->
    <g id="engraved-selenograph" opacity="0.62">
      <!-- Copperplate diagonal line texture across the lunar globe -->
      <circle cx="500" cy="500" r="260" fill="url(#obs-copper-hatch)" />
      <!-- Selenographic Parallels (Latitude Arcs) -->
      <g fill="none" stroke="#1E1D1A" stroke-width="0.75" stroke-dasharray="3 3" opacity="0.48">
        <ellipse cx="500" cy="500" rx="260" ry="52" transform="rotate(-18 500 500)" />
        <ellipse cx="500" cy="415" rx="242" ry="44" transform="rotate(-18 500 415)" />
        <ellipse cx="500" cy="585" rx="242" ry="44" transform="rotate(-18 500 585)" />
        <ellipse cx="500" cy="335" rx="195" ry="32" transform="rotate(-18 500 335)" />
        <ellipse cx="500" cy="665" rx="195" ry="32" transform="rotate(-18 500 665)" />
      </g>
      <!-- Selenographic Meridians (Longitude Arcs) -->
      <g fill="none" stroke="#1E1D1A" stroke-width="0.75" stroke-dasharray="4 3" opacity="0.45" transform="rotate(-18 500 500)">
        <ellipse cx="500" cy="500" rx="55" ry="260" />
        <ellipse cx="500" cy="500" rx="135" ry="260" />
        <ellipse cx="500" cy="500" rx="208" ry="260" />
        <line x1="500" y1="240" x2="500" y2="760" stroke-dasharray="none" stroke-width="0.65" />
        <line x1="240" y1="500" x2="760" y2="500" stroke-dasharray="none" stroke-width="0.65" />
      </g>
      <!-- Gilded Selenographic Reference Ticks on Sunlit Hemisphere -->
      <g fill="none" stroke="#E5C07B" stroke-width="0.7" stroke-dasharray="2 6" opacity="0.55" transform="rotate(-18 500 500)">
        <ellipse cx="500" cy="500" rx="135" ry="260" />
        <ellipse cx="500" cy="500" rx="260" ry="52" />
      </g>
    </g>`;

  svg = svg.replace(
    /<!-- IMPACT CRATERS \(3D Rims, Pits & Central Peaks\) -->/i,
    `${selenographicGraticule}\n    <!-- IMPACT CRATERS (3D Rims, Pits & Central Peaks) -->`
  );

  // Add etched contour rims to Lunar Maria paths
  svg = svg.replace(/<g id="lunar-maria"[^>]*>[\s\S]*?<\/g>/i, (maria) => {
    return maria
      .replace(/fill="url\(#mare-deep\)"/g, 'fill="url(#mare-deep)" stroke="#1E1D1A" stroke-width="1.2" stroke-dasharray="4 2"')
      .replace(/fill="url\(#mare-dark\)"/g, 'fill="url(#mare-dark)" stroke="#1E1D1A" stroke-width="1.0" stroke-dasharray="3 3"');
  });

  // 6. Frame viewBox tightly around the 940px corona & astrolabe system
  svg = svg.replace(/viewBox=["'][^"']*["']/, 'viewBox="30 30 940 940"');

  return svg;
}

// ── Folio Plate Parser & Stripper ─────────────────────────────────────────
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
    if (attrs.endsWith('/')) {
      out.push({ tag, attrs, markup: body.slice(lt, lt + m[0].length) });
      i = lt + m[0].length;
      continue;
    }
    const close = `</${tag}>`;
    let depth = 1, j = lt + m[0].length;
    while (depth > 0) {
      const nextOpen = body.indexOf(`<${tag}`, j);
      const nextClose = body.indexOf(close, j);
      if (nextClose < 0) throw new Error(`unbalanced <${tag}>`);
      if (nextOpen >= 0 && nextOpen < nextClose) {
        const ch = body[nextOpen + 1 + tag.length];
        if (ch === '>' || ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '/') {
          depth++;
          j = nextOpen + tag.length + 1;
          continue;
        }
      }
      depth--;
      j = nextClose + close.length;
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

function buildPlate(cfg) {
  const raw = readFileSync(join(SRC, cfg.src), 'utf8');
  const vbMatch = /viewBox="([\d.\s-]+)"/.exec(raw);
  const vb = vbMatch[1].trim().split(/\s+/).map(Number);
  const children = topLevelChildren(raw);

  const defs = children.find(c => c.tag === 'defs');
  const content = children.filter(c => c.tag !== 'defs');

  const firstG = content.findIndex(c => c.tag === 'g');
  const candidates = firstG < 0 ? [] : content.slice(firstG);

  const keptEls = [];
  let seenNamed = false;
  for (const el of candidates) {
    const id = attrOf(el.attrs, 'id');
    if (el.tag === 'text') continue;
    if (id) {
      seenNamed = true;
      if (cfg.keep.includes(id)) keptEls.push(el);
    } else if (cfg.loose && (seenNamed || el.tag === 'g')) {
      keptEls.push(el);
    }
  }

  let body = keptEls.map(el => el.markup.replace(/<text[\s\S]*?<\/text>/g, '')).join('\n');
  let defsMarkup = defs ? defs.markup : '';
  defsMarkup = defsMarkup.replace(/<radialGradient id="plate-vignette"[\s\S]*?<\/radialGradient>/g, '');
  defsMarkup = defsMarkup
    .split('\n').filter(l => !/\.label-|\.font-serif|\.font-mono|\.plate-bg|\.plate-paper/.test(l)).join('\n');

  const newVb = approxBBox(body, vb);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${newVb.join(' ')}">${defsMarkup}${body}</svg>`;
  const min = svg.replace(/\n\s+/g, '\n').replace(/>\s+</g, '><');
  writeFileSync(join(OUT, cfg.out), min);
  return { bytes: min.length, vb: newVb };
}

// ── Build Execution ───────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });

console.log('── Folio Plates ──');
for (const cfg of PLATES) {
  const r = buildPlate(cfg);
  console.log(`✓ ${cfg.out.padEnd(28)} ${(r.bytes / 1024).toFixed(1)} KB (from ${cfg.src})`);
}

console.log('\n── Gemini & Celestial Plates ──');
for (const cfg of GEMINI_TARGETS) {
  const raw = readFileSync(join(SRC, cfg.src), 'utf8');
  let outSvg;
  if (cfg.style === 'moon-night') {
    outSvg = buildMoonAstrolabe(raw, 'night');
  } else if (cfg.style === 'moon-dusk') {
    outSvg = buildMoonAstrolabe(raw, 'dusk');
  } else if (cfg.style === 'engraved') {
    outSvg = buildGeminiEngraved(raw, cfg);
  } else {
    outSvg = buildGeminiColored(raw, cfg);
  }
  writeFileSync(join(OUT, cfg.out), outSvg);
  console.log(`✓ ${cfg.out.padEnd(28)} ${(outSvg.length / 1024).toFixed(1)} KB (${cfg.style}, from ${cfg.src})`);
}

console.log('\n── Backwards-Compatible Aliases ──');
for (const alias of ALIASES) {
  const content = readFileSync(join(OUT, alias.from), 'utf8');
  writeFileSync(join(OUT, alias.to), content);
  console.log(`✓ ${alias.to.padEnd(28)} -> ${alias.from}`);
}


console.log('\n── Validating XML Integrity of All Atlas SVGs ──');
const allSvgs = readdirSync(OUT).filter(f => f.endsWith('.svg'));
for (const file of allSvgs) {
  const content = readFileSync(join(OUT, file), 'utf8');
  let opens = 0;
  const openRe = /<g(?:\s[^>]*?[^\/]|)>/gi;
  let m;
  while ((m = openRe.exec(content)) !== null) opens++;
  const closes = (content.match(/<\/g>/gi) || []).length;
  if (opens !== closes) {
    throw new Error(`XML Error in ${file}: unbalanced <g> tags (opens=${opens}, closes=${closes})`);
  }
}
console.log(`✓ All ${allSvgs.length} atlas SVGs have balanced <g> tags and valid XML.`);

console.log('\nDone: All atlas SVGs generated cleanly.');
