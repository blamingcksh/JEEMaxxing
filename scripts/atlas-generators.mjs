// atlas-generators.mjs — High-craft procedural Observatory SVG plates.
// Generates museum-grade copperplate, horological, optical, and scientific
// vector plates on transparent canvases for dark-ground UI integration.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const PHI = (1 + Math.sqrt(5)) / 2;

const f = (n, d = 2) => Number(n.toFixed(d));
const polar = (cx, cy, r, deg) => [
  cx + r * Math.cos(deg * DEG),
  cy + r * Math.sin(deg * DEG),
];

// Deterministic PRNG (Mulberry32) so plates build identically every run.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Shared Observatory Metallic / Void / Celestial Defs
function baseDefs(uid, extras = '') {
  return `<defs>
    <linearGradient id="${uid}-brass" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FAF0DC"/>
      <stop offset="28%" stop-color="#E5C07B"/>
      <stop offset="68%" stop-color="#9E7636"/>
      <stop offset="100%" stop-color="#4A3514"/>
    </linearGradient>
    <linearGradient id="${uid}-brass-v" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#F7E8C8"/>
      <stop offset="45%" stop-color="#DFB870"/>
      <stop offset="100%" stop-color="#6F5122"/>
    </linearGradient>
    <linearGradient id="${uid}-brass-h" x1="0%" y1="50%" x2="100%" y2="50%">
      <stop offset="0%" stop-color="#6A4D20"/>
      <stop offset="22%" stop-color="#DFB870"/>
      <stop offset="50%" stop-color="#FAF0DC"/>
      <stop offset="78%" stop-color="#C89E54"/>
      <stop offset="100%" stop-color="#533B16"/>
    </linearGradient>
    <linearGradient id="${uid}-dark-metal" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1A2030"/>
      <stop offset="50%" stop-color="#0D111A"/>
      <stop offset="100%" stop-color="#06080D"/>
    </linearGradient>
    <linearGradient id="${uid}-silver" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#F2EDE3"/>
      <stop offset="55%" stop-color="#B8B2A6"/>
      <stop offset="100%" stop-color="#56524A"/>
    </linearGradient>
    <radialGradient id="${uid}-glow-brass" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#E5C07B" stop-opacity="0.28"/>
      <stop offset="48%" stop-color="#E5C07B" stop-opacity="0.09"/>
      <stop offset="100%" stop-color="#E5C07B" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${uid}-glow-cyan" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#8FBFE0" stop-opacity="0.30"/>
      <stop offset="50%" stop-color="#5B8EB3" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#8FBFE0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${uid}-glow-sage" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#A9C9A4" stop-opacity="0.28"/>
      <stop offset="50%" stop-color="#6F9A69" stop-opacity="0.09"/>
      <stop offset="100%" stop-color="#A9C9A4" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${uid}-glow-ember" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#E07A52" stop-opacity="0.32"/>
      <stop offset="50%" stop-color="#A84A28" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#E07A52" stop-opacity="0"/>
    </radialGradient>
    <pattern id="${uid}-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <line x1="0" y1="0" x2="0" y2="7" stroke="#E5C07B" stroke-width="0.55" stroke-opacity="0.22"/>
    </pattern>
    <pattern id="${uid}-hatch-fine" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)">
      <line x1="0" y1="0" x2="0" y2="5" stroke="#F2EDE3" stroke-width="0.45" stroke-opacity="0.16"/>
    </pattern>
    <filter id="${uid}-softglow" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur stdDeviation="3.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    ${extras}
  </defs>`;
}

// Reusable Vernier Degree Dial Ring
function degreeRing(cx, cy, rOuter, rInner, stepDeg = 5, majorEvery = 15, ultraEvery = 45, stroke = '#E5C07B', op = 0.72) {
  const ticks = [];
  for (let d = 0; d < 360; d += stepDeg) {
    const isUltra = ultraEvery > 0 && d % ultraEvery === 0;
    const isMajor = d % majorEvery === 0;
    const r0 = isUltra ? rInner - 5 : isMajor ? rInner : rInner + (rOuter - rInner) * 0.42;
    const [x1, y1] = polar(cx, cy, r0, d);
    const [x2, y2] = polar(cx, cy, rOuter, d);
    const sw = isUltra ? 1.55 : isMajor ? 1.15 : 0.65;
    const to = isUltra ? op : isMajor ? op * 0.85 : op * 0.45;
    ticks.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${stroke}" stroke-width="${sw}" stroke-opacity="${f(to)}"/>`);
  }
  return ticks.join('');
}

// 4-point Observatory Diffraction Star
function starSpark(cx, cy, rLong, rShort = rLong * 0.19, fill = '#F2EDE3', op = 0.9) {
  const pts = [
    [cx, cy - rLong], [cx + rShort, cy - rShort],
    [cx + rLong, cy], [cx + rShort, cy + rShort],
    [cx, cy + rLong], [cx - rShort, cy + rShort],
    [cx - rLong, cy], [cx - rShort, cy - rShort],
  ];
  return `<polygon points="${pts.map(p => `${f(p[0])},${f(p[1])}`).join(' ')}" fill="${fill}" fill-opacity="${op}"/>`;
}

// Involute-style Precision Spur Gear Path
function spurGearPath(cx, cy, teeth, rOuter, rRoot, holeR = 0, rotDeg = 0) {
  const step = TAU / teeth;
  const rot = rotDeg * DEG;
  const parts = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = rot + i * step;
    const a1 = a0 + step * 0.18;
    const a2 = a0 + step * 0.34;
    const a3 = a0 + step * 0.56;
    const a4 = a0 + step * 0.72;
    const pts = [
      [cx + rRoot * Math.cos(a0), cy + rRoot * Math.sin(a0)],
      [cx + rRoot * Math.cos(a1), cy + rRoot * Math.sin(a1)],
      [cx + rOuter * Math.cos(a2), cy + rOuter * Math.sin(a2)],
      [cx + rOuter * Math.cos(a3), cy + rOuter * Math.sin(a3)],
      [cx + rRoot * Math.cos(a4), cy + rRoot * Math.sin(a4)],
    ];
    pts.forEach((p, idx) => {
      parts.push((i === 0 && idx === 0 ? 'M' : 'L') + `${f(p[0])} ${f(p[1])}`);
    });
  }
  parts.push('Z');
  if (holeR > 0) {
    parts.push(` M${f(cx + holeR)} ${f(cy)} A${f(holeR)} ${f(holeR)} 0 1 0 ${f(cx - holeR)} ${f(cy)} A${f(holeR)} ${f(holeR)} 0 1 0 ${f(cx + holeR)} ${f(cy)} Z`);
  }
  return parts.join('');
}

// Deterministic Scatter Starfield inside circular bounds
function starField(cx, cy, rMin, rMax, count, seed, colors = ['#F2EDE3', '#E5C07B', '#8FBFE0']) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const ang = rnd() * TAU;
    const rad = rMin + Math.sqrt(rnd()) * (rMax - rMin);
    const x = cx + rad * Math.cos(ang);
    const y = cy + rad * Math.sin(ang);
    const sz = 0.6 + rnd() * 1.4;
    const col = colors[Math.floor(rnd() * colors.length)];
    const op = 0.25 + rnd() * 0.6;
    if (sz > 1.75 && rnd() > 0.55) {
      out.push(starSpark(x, y, sz * 2.8, sz * 0.5, col, op));
    } else {
      out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(sz)}" fill="${col}" fill-opacity="${f(op)}"/>`);
    }
  }
  return out.join('');
}

// Cardinal Precision Bracket Crosshairs
function cardinalCrosshairs(cx, cy, rInner, rOuter, stroke = '#E5C07B', op = 0.45) {
  return [0, 90, 180, 270].map(d => {
    const [x1, y1] = polar(cx, cy, rInner, d);
    const [x2, y2] = polar(cx, cy, rOuter, d);
    const [dx, dy] = polar(cx, cy, (rInner + rOuter) * 0.5, d);
    return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${stroke}" stroke-width="1" stroke-opacity="${op}"/>` +
      `<circle cx="${f(dx)}" cy="${f(dy)}" r="2" fill="#090C14" stroke="${stroke}" stroke-width="0.9" stroke-opacity="${f(op * 1.3)}"/>`;
  }).join('');
}

// ============================================================================
// 1. HERO SPECIMEN PLATES (600x600 circularly harmonized inside .subject-ring)
// ============================================================================

function genSpecimenPhysChladni() {
  const uid = 'chladni';
  const cx = 300, cy = 300, R = 192;

  // Marching squares over Chladni circular-square standing-wave resonance field
  // Phi(x, y) = cos(n*pi*x)*cos(m*pi*y) + cos(m*pi*x)*cos(n*pi*y) blended with radial Bessel
  const N = 84;
  const val = (nx, ny) => {
    const r = Math.hypot(nx, ny);
    const ang = Math.atan2(ny, nx);
    const waveA = Math.cos(3 * Math.PI * nx) * Math.cos(5 * Math.PI * ny) - 0.85 * Math.cos(5 * Math.PI * nx) * Math.cos(3 * Math.PI * ny);
    const waveB = Math.cos(4 * ang) * Math.sin(3.4 * Math.PI * r);
    return 0.62 * waveA + 0.38 * waveB;
  };

  const grid = Array.from({ length: N + 1 }, (_, iy) => {
    const ny = -1 + (2 * iy) / N;
    return Array.from({ length: N + 1 }, (_, ix) => {
      const nx = -1 + (2 * ix) / N;
      return val(nx, ny);
    });
  });

  const segsPrimary = [];
  const segsSecondary = [];
  const interp = (a, b, va, vb) => {
    const d = vb - va;
    if (Math.abs(d) < 1e-6) return 0.5;
    return -va / d;
  };

  const extractSegments = (threshold, dest) => {
    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        const x0 = -1 + (2 * ix) / N, x1 = -1 + (2 * (ix + 1)) / N;
        const y0 = -1 + (2 * iy) / N, y1 = -1 + (2 * (iy + 1)) / N;
        if (Math.hypot((x0 + x1) * 0.5, (y0 + y1) * 0.5) > 0.94) continue;
        const v00 = grid[iy][ix] - threshold;
        const v10 = grid[iy][ix + 1] - threshold;
        const v11 = grid[iy + 1][ix + 1] - threshold;
        const v01 = grid[iy + 1][ix] - threshold;
        const pts = [];
        if ((v00 > 0) !== (v10 > 0)) pts.push([x0 + (x1 - x0) * interp(0, 1, v00, v10), y0]);
        if ((v10 > 0) !== (v11 > 0)) pts.push([x1, y0 + (y1 - y0) * interp(0, 1, v10, v11)]);
        if ((v11 > 0) !== (v01 > 0)) pts.push([x0 + (x1 - x0) * interp(0, 1, v01, v11), y1]);
        if ((v01 > 0) !== (v00 > 0)) pts.push([x0, y0 + (y1 - y0) * interp(0, 1, v00, v01)]);
        if (pts.length >= 2) {
          dest.push([
            cx + pts[0][0] * R, cy + pts[0][1] * R,
            cx + pts[1][0] * R, cy + pts[1][1] * R,
          ]);
        }
        if (pts.length === 4) {
          dest.push([
            cx + pts[2][0] * R, cy + pts[2][1] * R,
            cx + pts[3][0] * R, cy + pts[3][1] * R,
          ]);
        }
      }
    }
  };
  extractSegments(0, segsPrimary);
  extractSegments(0.32, segsSecondary);

  // Chain segments into continuous polylines for crisp joins and compact SVG size
  const segsToPath = (segs) => {
    const key = (x, y) => `${Math.round(x * 2)}:${Math.round(y * 2)}`;
    const used = new Uint8Array(segs.length);
    const byPt = new Map();
    const addMap = (k, idx) => {
      let arr = byPt.get(k);
      if (!arr) { arr = []; byPt.set(k, arr); }
      arr.push(idx);
    };
    segs.forEach(([x1, y1, x2, y2], idx) => {
      addMap(key(x1, y1), idx);
      addMap(key(x2, y2), idx);
    });
    const paths = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const chain = [[segs[i][0], segs[i][1]], [segs[i][2], segs[i][3]]];
      const extend = (front) => {
        while (true) {
          const tip = front ? chain[0] : chain[chain.length - 1];
          const cands = byPt.get(key(tip[0], tip[1])) || [];
          let nextIdx = -1;
          for (const ci of cands) {
            if (!used[ci]) { nextIdx = ci; break; }
          }
          if (nextIdx < 0) break;
          used[nextIdx] = 1;
          const [ax, ay, bx, by] = segs[nextIdx];
          const dA = Math.hypot(ax - tip[0], ay - tip[1]);
          const nxt = dA < 1.2 ? [bx, by] : [ax, ay];
          if (front) chain.unshift(nxt); else chain.push(nxt);
        }
      };
      extend(false);
      extend(true);
      if (chain.length < 3) continue; // skip single-pixel grid artifacts
      paths.push('M' + chain.map(([px, py]) => `${f(px, 1)} ${f(py, 1)}`).join('L'));
    }
    return paths.join('');
  };

  // Acoustic sand grains clustered along nodal curves
  const rnd = mulberry32(707);
  const sand = [];
  for (let i = 0; i < segsPrimary.length; i += 2) {
    const [x1, y1, x2, y2] = segsPrimary[i];
    const mx = (x1 + x2) * 0.5 + (rnd() - 0.5) * 4.5;
    const my = (y1 + y2) * 0.5 + (rnd() - 0.5) * 4.5;
    const rad = Math.hypot(mx - cx, my - cy);
    if (rad < R - 10) {
      sand.push(`<circle cx="${f(mx, 1)}" cy="${f(my, 1)}" r="${f(0.8 + rnd() * 1.1, 1)}" fill="${rnd() > 0.35 ? '#F2EDE3' : '#E5C07B'}" fill-opacity="${f(0.45 + rnd() * 0.45)}"/>`);
    }
  }

  // Acoustic transducer clamps at 4 diagonal vertices (45, 135, 225, 315)
  const clamps = [45, 135, 225, 315].map(d => {
    const [bx, by] = polar(cx, cy, 226, d);
    const [ax, ay] = polar(cx, cy, 190, d);
    return `<g>
      <line x1="${f(bx)}" y1="${f(by)}" x2="${f(ax)}" y2="${f(ay)}" stroke="url(#${uid}-brass)" stroke-width="5" stroke-linecap="round"/>
      <circle cx="${f(bx)}" cy="${f(by)}" r="10.5" fill="#0B0F19" stroke="url(#${uid}-brass)" stroke-width="2.2"/>
      <circle cx="${f(bx)}" cy="${f(by)}" r="4" fill="#E5C07B"/>
      <circle cx="${f(ax)}" cy="${f(ay)}" r="4.5" fill="#F2EDE3" stroke="#090C14" stroke-width="1.2"/>
    </g>`;
  }).join('');

  // Standing-wave transverse harmonic envelope along inner equator
  const wavePtsA = [], wavePtsB = [];
  for (let i = -60; i <= 60; i++) {
    const t = i / 60;
    const wx = cx + t * 135;
    const env = Math.cos(t * Math.PI * 0.5);
    const wyA = cy + Math.sin(t * Math.PI * 4) * 20 * env;
    const wyB = cy - Math.sin(t * Math.PI * 4) * 20 * env;
    wavePtsA.push(`${i === -60 ? 'M' : 'L'}${f(wx, 1)} ${f(wyA, 1)}`);
    wavePtsB.push(`${i === -60 ? 'M' : 'L'}${f(wx, 1)} ${f(wyB, 1)}`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  ${baseDefs(uid, `
    <radialGradient id="${uid}-plate-bg" cx="46%" cy="42%" r="60%">
      <stop offset="0%" stop-color="#152033" stop-opacity="0.95"/>
      <stop offset="55%" stop-color="#0C111C" stop-opacity="0.96"/>
      <stop offset="100%" stop-color="#06080E" stop-opacity="0.98"/>
    </radialGradient>
    <radialGradient id="${uid}-antinode" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#8FBFE0" stop-opacity="0.24"/>
      <stop offset="50%" stop-color="#E5C07B" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#06080E" stop-opacity="0"/>
    </radialGradient>
  `)}
  <!-- Outer Atmosphere Aura & Astrometric Guides -->
  <circle cx="300" cy="300" r="275" fill="url(#${uid}-glow-cyan)"/>
  <circle cx="300" cy="300" r="215" fill="url(#${uid}-glow-brass)"/>
  <circle cx="300" cy="300" r="258" fill="none" stroke="#8FBFE0" stroke-width="0.75" stroke-opacity="0.28" stroke-dasharray="3 6"/>
  <circle cx="300" cy="300" r="246" fill="none" stroke="#E5C07B" stroke-width="0.9" stroke-opacity="0.48"/>
  <circle cx="300" cy="300" r="226" fill="none" stroke="url(#${uid}-brass)" stroke-width="2.4"/>
  <circle cx="300" cy="300" r="214" fill="none" stroke="#E5C07B" stroke-width="0.7" stroke-opacity="0.38"/>
  ${degreeRing(300, 300, 246, 232, 3, 15, 45, '#E5C07B', 0.72)}
  ${cardinalCrosshairs(300, 300, 206, 266, '#8FBFE0', 0.55)}
  ${starField(300, 300, 232, 278, 22, 107, ['#8FBFE0', '#F2EDE3', '#E5C07B'])}

  <!-- Main Chladni Acoustic Disc -->
  <circle cx="300" cy="300" r="196" fill="url(#${uid}-plate-bg)" stroke="url(#${uid}-brass)" stroke-width="4"/>
  <circle cx="300" cy="300" r="188" fill="url(#${uid}-antinode)" stroke="#8FBFE0" stroke-width="0.75" stroke-opacity="0.35"/>
  <circle cx="300" cy="300" r="154" fill="none" stroke="#E5C07B" stroke-width="0.55" stroke-opacity="0.22" stroke-dasharray="2 5"/>
  <circle cx="300" cy="300" r="96" fill="none" stroke="#8FBFE0" stroke-width="0.65" stroke-opacity="0.28"/>

  <!-- Solved Chladni Standing-Wave Nodal Loci -->
  <path d="${segsToPath(segsSecondary)}" fill="none" stroke="#8FBFE0" stroke-width="0.85" stroke-opacity="0.34" stroke-linecap="round"/>
  <path d="${segsToPath(segsPrimary)}" fill="none" stroke="url(#${uid}-brass)" stroke-width="2.1" stroke-opacity="0.92" stroke-linecap="round" filter="url(#${uid}-softglow)"/>
  <path d="${segsToPath(segsPrimary)}" fill="none" stroke="#F2EDE3" stroke-width="0.85" stroke-opacity="0.88" stroke-linecap="round"/>

  <!-- Resonant Standing-Wave Cross Trace -->
  <line x1="158" y1="300" x2="442" y2="300" stroke="#8FBFE0" stroke-width="0.7" stroke-opacity="0.35" stroke-dasharray="4 3"/>
  <path d="${wavePtsA.join('')}" fill="none" stroke="#8FBFE0" stroke-width="1.2" stroke-opacity="0.68"/>
  <path d="${wavePtsB.join('')}" fill="none" stroke="#E5C07B" stroke-width="1.2" stroke-opacity="0.62" stroke-dasharray="4 2"/>

  <!-- Nodal Acoustic Sand Accumulation -->
  <g>${sand.join('')}</g>

  <!-- Central Brass Exciter Hub -->
  <circle cx="300" cy="300" r="24" fill="#0B0F1A" stroke="url(#${uid}-brass)" stroke-width="2.2"/>
  <circle cx="300" cy="300" r="15" fill="none" stroke="#8FBFE0" stroke-width="1" stroke-opacity="0.65"/>
  <circle cx="300" cy="300" r="6" fill="url(#${uid}-brass)" stroke="#F2EDE3" stroke-width="0.8"/>
  ${starSpark(300, 300, 12, 2.5, '#F2EDE3', 0.9)}
  ${clamps}
</svg>`;
}

function genSpecimenChemDendrite() {
  const uid = 'dendrite';
  const cx = 300, cy = 300;

  // 6-fold crystal dendrite + aromatic facets + electron orbitals
  const arms = [];
  for (let k = 0; k < 6; k++) {
    const deg = k * 60 - 90;
    const [ex, ey] = polar(cx, cy, 178, deg);
    const [mx, my] = polar(cx, cy, 42, deg);
    // Main crystal spine
    arms.push(`<line x1="${f(mx)}" y1="${f(my)}" x2="${f(ex)}" y2="${f(ey)}" stroke="url(#${uid}-brass)" stroke-width="2.6" stroke-linecap="round"/>`);
    arms.push(`<line x1="${f(mx)}" y1="${f(my)}" x2="${f(ex)}" y2="${f(ey)}" stroke="#F2EDE3" stroke-width="0.8" stroke-opacity="0.85"/>`);

    // 3 tiers of dendritic crystalline chevrons
    const tiers = [
      { r: 78, len: 40, spread: 42 },
      { r: 115, len: 52, spread: 44 },
      { r: 148, len: 30, spread: 42 },
    ];
    for (const t of tiers) {
      const [bx, by] = polar(cx, cy, t.r, deg);
      for (const sgn of [-1, 1]) {
        const [tx, ty] = polar(bx, by, t.len, deg + sgn * t.spread);
        arms.push(`<line x1="${f(bx)}" y1="${f(by)}" x2="${f(tx)}" y2="${f(ty)}" stroke="#A9C9A4" stroke-width="1.5" stroke-opacity="0.86" stroke-linecap="round"/>`);
        // secondary sub-branch on middle tier
        if (t.r === 115) {
          const [sx, sy] = polar(bx, by, t.len * 0.56, deg + sgn * t.spread);
          const [stx, sty] = polar(sx, sy, 16, deg);
          arms.push(`<line x1="${f(sx)}" y1="${f(sy)}" x2="${f(stx)}" y2="${f(sty)}" stroke="#E5C07B" stroke-width="1.1" stroke-opacity="0.72"/>`);
        }
        arms.push(`<circle cx="${f(tx)}" cy="${f(ty)}" r="2.6" fill="#0B1112" stroke="#F2EDE3" stroke-width="0.9"/>`);
      }
      arms.push(`<circle cx="${f(bx)}" cy="${f(by)}" r="3.4" fill="#E5C07B" stroke="#090C14" stroke-width="1"/>`);
    }

    // Faceted crystal prism bud at arm tip
    const [p0x, p0y] = polar(cx, cy, 189, deg);
    const [p1x, p1y] = polar(cx, cy, 174, deg - 5.5);
    const [p2x, p2y] = polar(cx, cy, 162, deg);
    const [p3x, p3y] = polar(cx, cy, 174, deg + 5.5);
    arms.push(`<polygon points="${f(p0x)},${f(p0y)} ${f(p1x)},${f(p1y)} ${f(p2x)},${f(p2y)} ${f(p3x)},${f(p3y)}" fill="#162824" stroke="#A9C9A4" stroke-width="1.2"/>`);
    arms.push(`<polygon points="${f(p0x)},${f(p0y)} ${f(p1x)},${f(p1y)} ${f(p2x)},${f(p2y)}" fill="#A9C9A4" fill-opacity="0.35"/>`);
  }

  // Concentric hexagonal Bravais unit lattices
  const hexRing = (rad, stroke, sw, fill = 'none', op = 1, rotOffset = 0) => {
    const pts = Array.from({ length: 6 }, (_, i) => polar(cx, cy, rad, i * 60 - 90 + rotOffset));
    return `<polygon points="${pts.map(p => `${f(p[0])},${f(p[1])}`).join(' ')}" fill="${fill}" fill-opacity="${op}" stroke="${stroke}" stroke-width="${sw}"/>`;
  };

  // 3D Faceted Central Aromatic Quartz Core
  const centerFacets = Array.from({ length: 6 }, (_, i) => {
    const [x1, y1] = polar(cx, cy, 42, i * 60 - 90);
    const [x2, y2] = polar(cx, cy, 42, (i + 1) * 60 - 90);
    const shade = i % 2 === 0 ? '#A9C9A4' : '#E5C07B';
    const op = i === 0 || i === 5 ? 0.36 : i === 1 || i === 4 ? 0.2 : 0.12;
    return `<polygon points="${cx},${cy} ${f(x1)},${f(y1)} ${f(x2)},${f(y2)}" fill="${shade}" fill-opacity="${op}" stroke="#F2EDE3" stroke-width="0.65" stroke-opacity="0.45"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  ${baseDefs(uid, `
    <radialGradient id="${uid}-orbital" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#A9C9A4" stop-opacity="0.38"/>
      <stop offset="65%" stop-color="#6F9A69" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#090C14" stop-opacity="0"/>
    </radialGradient>
  `)}
  <!-- Outer Atmosphere Aura & Stereographic Ring -->
  <circle cx="300" cy="300" r="274" fill="url(#${uid}-glow-sage)"/>
  <circle cx="300" cy="300" r="210" fill="url(#${uid}-glow-brass)"/>
  <circle cx="300" cy="300" r="256" fill="none" stroke="#A9C9A4" stroke-width="0.75" stroke-opacity="0.30" stroke-dasharray="3 6"/>
  <circle cx="300" cy="300" r="244" fill="none" stroke="#E5C07B" stroke-width="0.9" stroke-opacity="0.48"/>
  <circle cx="300" cy="300" r="224" fill="none" stroke="url(#${uid}-brass)" stroke-width="2.4"/>
  <circle cx="300" cy="300" r="204" fill="#080D0F" fill-opacity="0.88" stroke="#A9C9A4" stroke-width="0.8" stroke-opacity="0.42"/>
  ${degreeRing(300, 300, 244, 230, 5, 15, 60, '#E5C07B', 0.72)}
  ${cardinalCrosshairs(300, 300, 210, 266, '#A9C9A4', 0.52)}
  ${starField(300, 300, 228, 276, 20, 606, ['#A9C9A4', '#F2EDE3', '#E5C07B'])}

  <!-- Quantum Electronic Orbital Lobes (d-orbital 4-leaf symmetry + sigma ring) -->
  <g transform="rotate(30 300 300)">
    <ellipse cx="300" cy="300" rx="164" ry="44" fill="url(#${uid}-orbital)" stroke="#A9C9A4" stroke-width="0.85" stroke-opacity="0.45"/>
    <ellipse cx="300" cy="300" rx="44" ry="164" fill="url(#${uid}-orbital)" stroke="#A9C9A4" stroke-width="0.85" stroke-opacity="0.45"/>
  </g>
  <ellipse cx="300" cy="300" rx="156" ry="38" transform="rotate(-30 300 300)" fill="none" stroke="#E5C07B" stroke-width="0.7" stroke-opacity="0.35" stroke-dasharray="3 4"/>

  <!-- Concentric Bravais Hexagonal Lattice & Resonance Webs -->
  ${hexRing(166, '#A9C9A4', 0.9, 'none', 0.4)}
  ${hexRing(126, '#E5C07B', 1.15, '#0A1012', 0.5)}
  ${hexRing(84, '#A9C9A4', 1.25, '#0F1B18', 0.65, 30)}
  ${hexRing(42, 'url(#dendrite-brass)', 2.0, '#0C1414', 0.92)}
  <circle cx="300" cy="300" r="144" fill="none" stroke="#E5C07B" stroke-width="0.6" stroke-opacity="0.28" stroke-dasharray="2 5"/>

  <!-- Hexagonal Dendritic Crystal Arms -->
  <g>${arms.join('')}</g>

  <!-- Central Quasicrystal Gem Core -->
  ${centerFacets}
  <circle cx="300" cy="300" r="16" fill="#0B1113" stroke="url(#${uid}-brass)" stroke-width="1.8"/>
  <circle cx="300" cy="300" r="7" fill="#A9C9A4" stroke="#F2EDE3" stroke-width="0.9"/>
  ${starSpark(300, 300, 14, 2.8, '#F2EDE3', 0.95)}
</svg>`;
}

function genSpecimenMathNautilus() {
  const uid = 'nautilus';
  const bx = 300, by = 300;
  // Golden spiral origin positioned so the swept shell fills ~82% of the r=204 disc symmetrically
  const ox = 326, oy = 308;
  const B = (2 / Math.PI) * Math.log(PHI); // ~0.3063489
  const a0 = 6.2;

  const sp = (th) => {
    const r = a0 * Math.exp(B * th);
    return [ox + r * Math.cos(th), oy + r * Math.sin(th), r];
  };

  // Build 32 sculpted chambers from inner whorl to wide aperture
  const thStart = -0.35 * Math.PI;
  const thEnd = 3.68 * Math.PI;
  const totalSteps = 32;
  const dTh = (thEnd - thStart) / totalSteps;
  const chambers = [];

  for (let i = 0; i < totalSteps; i++) {
    const t0 = thStart + i * dTh;
    const t1 = t0 + dTh;
    const t0In = t0 - TAU;
    const t1In = t1 - TAU;

    const p0Out = sp(t0), p1Out = sp(t1);
    const p0In = sp(t0In), p1In = sp(t1In);
    const midOut = sp((t0 + t1) * 0.5);
    const s0MidAngle = t0 + dTh * 0.38;
    const s0MidR = (p0Out[2] + p0In[2]) * 0.48;
    const s0Ctrl = [ox + s0MidR * Math.cos(s0MidAngle), oy + s0MidR * Math.sin(s0MidAngle)];

    const s1MidAngle = t1 + dTh * 0.38;
    const s1MidR = (p1Out[2] + p1In[2]) * 0.48;
    const s1Ctrl = [ox + s1MidR * Math.cos(s1MidAngle), oy + s1MidR * Math.sin(s1MidAngle)];

    const shadeId = i % 3 === 0 ? `${uid}-pearl-a` : i % 3 === 1 ? `${uid}-pearl-b` : `${uid}-pearl-c`;
    const chamberPath =
      `M${f(p0Out[0])} ${f(p0Out[1])} ` +
      `Q${f(midOut[0])} ${f(midOut[1])} ${f(p1Out[0])} ${f(p1Out[1])} ` +
      `Q${f(s1Ctrl[0])} ${f(s1Ctrl[1])} ${f(p1In[0])} ${f(p1In[1])} ` +
      `L${f(p0In[0])} ${f(p0In[1])} ` +
      `Q${f(s0Ctrl[0])} ${f(s0Ctrl[1])} ${f(p0Out[0])} ${f(p0Out[1])} Z`;

    chambers.push(`<path d="${chamberPath}" fill="url(#${shadeId})" stroke="#E5C07B" stroke-width="1.05" stroke-opacity="0.78"/>`);
    chambers.push(`<path d="M${f(p1Out[0])} ${f(p1Out[1])} Q${f(s1Ctrl[0])} ${f(s1Ctrl[1])} ${f(p1In[0])} ${f(p1In[1])}" fill="none" stroke="#FAF0DC" stroke-width="1.3" stroke-opacity="0.82"/>`);

    // Chambered siphuncle pearl nodes
    if (i > 5 && i < totalSteps - 1) {
      const siphR = p1In[2] + (p1Out[2] - p1In[2]) * 0.46;
      const sx = ox + siphR * Math.cos(t1 + dTh * 0.16);
      const sy = oy + siphR * Math.sin(t1 + dTh * 0.16);
      chambers.push(`<circle cx="${f(sx)}" cy="${f(sy)}" r="${f(1.3 + i * 0.09)}" fill="#090C14" stroke="#E5C07B" stroke-width="0.9" stroke-opacity="0.75"/>`);
    }
  }

  // Smooth high-res outer continuous spiral boundary curve
  const spiralPts = [];
  for (let s = 0; s <= 220; s++) {
    const th = thStart - 0.8 + (s / 220) * (thEnd - thStart + 0.8);
    const [px, py] = sp(th);
    spiralPts.push(`${s === 0 ? 'M' : 'L'}${f(px, 1)} ${f(py, 1)}`);
  }

  // Pole-aligned Golden Rectangle (W : H = φ : 1) whose clockwise Fibonacci pole lands on (ox, oy)
  const W = 248;
  const H = W / PHI; // ~153.27
  const x0 = ox - 0.7236068 * W; // ~146.55
  const y0 = oy - 0.7236068 * H; // ~197.09
  const s1 = H;          // ~153.27 (left square)
  const s2 = W - s1;     // ~94.73  (top-right square)
  const s3 = s1 - s2;    // ~58.55  (bottom-right square)
  const s4 = s2 - s3;    // ~36.18  (bottom-mid square)
  const s5 = s3 - s4;    // ~22.36  (top-mid square)
  const xS1 = x0 + s1;
  const yS2 = y0 + s2;
  const xS3 = x0 + W - s3;
  const yS4 = y0 + H - s4;
  const xS5 = xS1 + s5;

  // Quarter-turn circular Fibonacci construction arcs inside S1..S4
  const fibArcs = [
    `M${f(x0)} ${f(y0 + H)} A${f(s1)} ${f(s1)} 0 0 1 ${f(xS1)} ${f(y0)}`,
    `M${f(xS1)} ${f(y0)} A${f(s2)} ${f(s2)} 0 0 1 ${f(x0 + W)} ${f(yS2)}`,
    `M${f(x0 + W)} ${f(yS2)} A${f(s3)} ${f(s3)} 0 0 1 ${f(xS3)} ${f(y0 + H)}`,
    `M${f(xS3)} ${f(y0 + H)} A${f(s4)} ${f(s4)} 0 0 1 ${f(xS1)} ${f(yS4)}`,
  ].join(' ');

  // 12 equiangular polar rays from (ox, oy)
  const polarRays = [];
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    polarRays.push(`<line x1="${f(ox + 11 * Math.cos(a))}" y1="${f(oy + 11 * Math.sin(a))}" x2="${f(ox + 260 * Math.cos(a))}" y2="${f(oy + 260 * Math.sin(a))}"/>`);
  }

  // Iso-radial blueprint rings (r = 55, 89, 144) + orthogonal axis ticks around (ox, oy)
  const isoRadii = [55, 89, 144];
  const isoTicks = [];
  for (const r of isoRadii) {
    for (let d = 0; d < 4; d++) {
      const a = (d * Math.PI) / 2;
      const tx = ox + r * Math.cos(a), ty = oy + r * Math.sin(a);
      const nx = -Math.sin(a) * 3.8, ny = Math.cos(a) * 3.8;
      isoTicks.push(`M${f(tx - nx)} ${f(ty - ny)}L${f(tx + nx)} ${f(ty + ny)}`);
    }
  }

  // Quarter-turn spiral intersection vertex nodes & equiangular tangent indicator
  const vertexNodes = [];
  for (let m = 2; m <= 7; m++) {
    const th = m * (Math.PI / 2);
    const [vx, vy, vr] = sp(th);
    if (vr > 14 && Math.hypot(vx - bx, vy - by) < 194) {
      vertexNodes.push(`<circle cx="${f(vx)}" cy="${f(vy)}" r="2.1" fill="#080B12" fill-opacity="0.7" stroke="#8FBFE0" stroke-width="0.75" stroke-opacity="0.48"/>`);
    }
  }
  const [tx0, ty0] = sp(2.25 * Math.PI);
  const tAngle = 2.25 * Math.PI + Math.atan2(1, B);
  const tangLine = `M${f(tx0 - 18 * Math.cos(tAngle))} ${f(ty0 - 18 * Math.sin(tAngle))}L${f(tx0 + 22 * Math.cos(tAngle))} ${f(ty0 + 22 * Math.sin(tAngle))}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  ${baseDefs(uid, `
    <clipPath id="${uid}-clip">
      <circle cx="${bx}" cy="${by}" r="202"/>
    </clipPath>
    <linearGradient id="${uid}-pearl-a" x1="15%" y1="10%" x2="85%" y2="90%">
      <stop offset="0%" stop-color="#3B3021" stop-opacity="0.94"/>
      <stop offset="50%" stop-color="#1A1614" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="#0B0D14" stop-opacity="0.96"/>
    </linearGradient>
    <linearGradient id="${uid}-pearl-b" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#5B4425" stop-opacity="0.90"/>
      <stop offset="55%" stop-color="#241D17" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="#0C0F18" stop-opacity="0.96"/>
    </linearGradient>
    <linearGradient id="${uid}-pearl-c" x1="10%" y1="90%" x2="90%" y2="10%">
      <stop offset="0%" stop-color="#111521" stop-opacity="0.95"/>
      <stop offset="65%" stop-color="#33291E" stop-opacity="0.90"/>
      <stop offset="100%" stop-color="#6E522C" stop-opacity="0.88"/>
    </linearGradient>
  `)}
  <!-- Outer Atmosphere Glow & Astrometric Brass Ring -->
  <circle cx="${bx}" cy="${by}" r="274" fill="url(#${uid}-glow-brass)"/>
  <circle cx="${bx}" cy="${by}" r="256" fill="none" stroke="#E5C07B" stroke-width="0.75" stroke-opacity="0.28" stroke-dasharray="3 6"/>
  <circle cx="${bx}" cy="${by}" r="244" fill="none" stroke="#E5C07B" stroke-width="0.9" stroke-opacity="0.52"/>
  <circle cx="${bx}" cy="${by}" r="224" fill="none" stroke="url(#${uid}-brass)" stroke-width="2.5"/>
  <circle cx="${bx}" cy="${by}" r="204" fill="#080B12" fill-opacity="0.92" stroke="#E5C07B" stroke-width="0.85" stroke-opacity="0.45"/>
  ${degreeRing(bx, by, 244, 230, 5, 15, 45, '#E5C07B', 0.78)}
  ${cardinalCrosshairs(bx, by, 208, 266, '#E5C07B', 0.55)}
  ${starField(bx, by, 228, 276, 20, 505, ['#E5C07B', '#F2EDE3'])}

  <!-- Base Mathematical Blueprint Layer (under shell, clipped to r=202) -->
  <g clip-path="url(#${uid}-clip)" fill="none">
    <circle cx="${bx}" cy="${by}" r="186" stroke="#E5C07B" stroke-width="0.65" stroke-opacity="0.22" stroke-dasharray="3 4"/>
    <g stroke="#E5C07B" stroke-width="0.65" stroke-opacity="0.16" stroke-dasharray="2 4">
      ${polarRays.join('')}
    </g>
    <g stroke="#E5C07B" stroke-opacity="0.26">
      <rect x="${f(x0)}" y="${f(y0)}" width="${f(W)}" height="${f(H)}" stroke-width="0.8" stroke-dasharray="4 3"/>
      <line x1="${f(xS1)}" y1="${f(y0)}" x2="${f(xS1)}" y2="${f(y0 + H)}" stroke-width="0.75"/>
      <line x1="${f(xS1)}" y1="${f(yS2)}" x2="${f(x0 + W)}" y2="${f(yS2)}" stroke-width="0.75"/>
      <line x1="${f(xS3)}" y1="${f(yS2)}" x2="${f(xS3)}" y2="${f(y0 + H)}" stroke-width="0.7"/>
      <line x1="${f(xS1)}" y1="${f(yS4)}" x2="${f(xS3)}" y2="${f(yS4)}" stroke-width="0.65"/>
      <line x1="${f(xS5)}" y1="${f(yS2)}" x2="${f(xS5)}" y2="${f(yS4)}" stroke-width="0.6"/>
      <line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x0 + W)}" y2="${f(y0 + H)}" stroke-width="0.65" stroke-dasharray="2.5 3.5" stroke-opacity="0.22"/>
      <line x1="${f(xS1)}" y1="${f(y0 + H)}" x2="${f(x0 + W)}" y2="${f(y0)}" stroke-width="0.65" stroke-dasharray="2.5 3.5" stroke-opacity="0.22"/>
    </g>
    <path d="${fibArcs}" stroke="#8FBFE0" stroke-width="0.75" stroke-opacity="0.22" stroke-dasharray="2.5 3.5"/>
    <!-- Bottom Inside-Rim φ Proportion Scale Chord -->
    <g stroke="#E5C07B" stroke-opacity="0.28" stroke-width="0.75">
      <line x1="186" y1="442" x2="414" y2="442"/>
      <path d="M186 437v10M326.9 436v12M414 437v10M239.8 439v6M273.1 439v6M360.2 439v6"/>
      <circle cx="326.9" cy="442" r="1.6" fill="#080B12" stroke="#8FBFE0" stroke-width="0.7" stroke-opacity="0.5"/>
    </g>
  </g>

  <!-- Sculpted Golden Nautilus Shell -->
  <g>
    ${chambers.join('')}
  </g>

  <!-- Ghost Blueprint Overlay (ultra-faint across dark chambers, below glowing outer spiral rim) -->
  <g clip-path="url(#${uid}-clip)" fill="none">
    <!-- Polar iso-radius circles & cross-ticks centered on (ox, oy) -->
    <g stroke="#F2EDE3" stroke-width="0.6" stroke-opacity="0.16" stroke-dasharray="3 5">
      <circle cx="${ox}" cy="${oy}" r="55"/>
      <circle cx="${ox}" cy="${oy}" r="89"/>
      <circle cx="${ox}" cy="${oy}" r="144"/>
    </g>
    <path d="${isoTicks.join('')}" stroke="#F2EDE3" stroke-width="0.65" stroke-opacity="0.24"/>
    <!-- Orthogonal polar axes through (ox, oy) -->
    <line x1="${ox}" y1="98" x2="${ox}" y2="502" stroke="#E5C07B" stroke-width="0.65" stroke-opacity="0.20" stroke-dasharray="4 4"/>
    <line x1="98" y1="${oy}" x2="502" y2="${oy}" stroke="#E5C07B" stroke-width="0.65" stroke-opacity="0.20" stroke-dasharray="4 4"/>
    <!-- Faint subdivision & diagonal pass-through over dark chamber bodies -->
    <g stroke="#8FBFE0" stroke-width="0.6" stroke-opacity="0.16" stroke-dasharray="2 3.5">
      <rect x="${f(x0)}" y="${f(y0)}" width="${f(W)}" height="${f(H)}"/>
      <line x1="${f(xS1)}" y1="${f(y0)}" x2="${f(xS1)}" y2="${f(y0 + H)}"/>
      <line x1="${f(xS1)}" y1="${f(yS2)}" x2="${f(x0 + W)}" y2="${f(yS2)}"/>
      <line x1="${f(xS3)}" y1="${f(yS2)}" x2="${f(xS3)}" y2="${f(y0 + H)}"/>
      <line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x0 + W)}" y2="${f(y0 + H)}"/>
      <line x1="${f(xS1)}" y1="${f(y0 + H)}" x2="${f(x0 + W)}" y2="${f(y0)}"/>
      <path d="${fibArcs}"/>
    </g>
    <!-- Equiangular pitch-angle tangent line & 90deg spiral vertex rings -->
    <path d="${tangLine}" stroke="#8FBFE0" stroke-width="0.7" stroke-opacity="0.32" stroke-dasharray="2 2"/>
    ${vertexNodes.join('')}
  </g>

  <!-- Glowing Outer Spiral Spline -->
  <g>
    <path d="${spiralPts.join('')}" fill="none" stroke="url(#${uid}-brass)" stroke-width="2.8" stroke-linecap="round" filter="url(#${uid}-softglow)"/>
    <path d="${spiralPts.join('')}" fill="none" stroke="#FAF0DC" stroke-width="1.05" stroke-opacity="0.90" stroke-linecap="round"/>
  </g>

  <!-- Logarithmic Pole & Apex Jewel -->
  <circle cx="${ox}" cy="${oy}" r="9.5" fill="#090C14" stroke="url(#${uid}-brass)" stroke-width="1.8"/>
  ${starSpark(ox, oy, 12, 2.4, '#FAF0DC', 0.96)}
</svg>`;
}

function genSpecimenPhysCorona() {
  const uid = 'corona';
  const cx = 300, cy = 300;
  // Total Solar Eclipse + Prominence Flares + Dipole Coronal Magnetic Streamers
  const rays = [];
  for (let i = 0; i < 48; i++) {
    const deg = i * 7.5;
    const isEquatorial = Math.abs(Math.sin(deg * DEG)) < 0.55;
    const len = 105 + (isEquatorial ? 85 : 35) + (i % 3 === 0 ? 32 : 0);
    const [x1, y1] = polar(cx, cy, 88, deg);
    const [x2, y2] = polar(cx, cy, len, deg);
    rays.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${i % 2 === 0 ? '#E5C07B' : '#F2EDE3'}" stroke-width="${i % 4 === 0 ? 1.1 : 0.6}" stroke-opacity="${i % 4 === 0 ? 0.55 : 0.25}"/>`);
  }
  const flux = [
    'M 300 212 C 350 110, 480 120, 485 300 C 480 480, 350 490, 300 388',
    'M 300 212 C 335 145, 435 160, 438 300 C 435 440, 335 455, 300 388',
    'M 300 212 C 250 110, 120 120, 115 300 C 120 480, 250 490, 300 388',
    'M 300 212 C 265 145, 165 160, 162 300 C 165 440, 265 455, 300 388',
  ].map((d, idx) => `<path d="${d}" fill="none" stroke="${idx % 2 === 0 ? '#8FBFE0' : '#E5C07B'}" stroke-width="${idx % 2 === 0 ? 1.3 : 1}" stroke-opacity="0.58"/>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  ${baseDefs(uid, `
    <radialGradient id="${uid}-diamond" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="25%" stop-color="#FAF0DC"/>
      <stop offset="60%" stop-color="#E5C07B" stop-opacity="0.65"/>
      <stop offset="100%" stop-color="#E07A52" stop-opacity="0"/>
    </radialGradient>
  `)}
  <circle cx="300" cy="300" r="270" fill="url(#${uid}-glow-cyan)"/>
  <circle cx="300" cy="300" r="205" fill="url(#${uid}-glow-brass)"/>
  <circle cx="300" cy="300" r="248" fill="none" stroke="#E5C07B" stroke-width="0.9" stroke-opacity="0.45"/>
  <circle cx="300" cy="300" r="228" fill="none" stroke="url(#${uid}-brass)" stroke-width="2.2"/>
  ${degreeRing(300, 300, 248, 234, 5, 15, 45, '#E5C07B', 0.72)}
  ${cardinalCrosshairs(300, 300, 212, 264, '#8FBFE0', 0.48)}
  <g>${rays.join('')}</g>
  ${flux}
  <!-- Inner Chromosphere Rim -->
  <circle cx="300" cy="300" r="93" fill="none" stroke="#E07A52" stroke-width="3.5" stroke-opacity="0.65" filter="url(#${uid}-softglow)"/>
  <circle cx="300" cy="300" r="90" fill="none" stroke="#FAF0DC" stroke-width="1.6"/>
  <!-- Solar Prominence Loops -->
  <path d="M 225 250 Q 204 235 215 268" fill="none" stroke="#E07A52" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M 380 342 Q 402 355 390 326" fill="none" stroke="#E07A52" stroke-width="2" stroke-linecap="round"/>
  <!-- Lunar Occultation Umbra Sphere -->
  <circle cx="300" cy="300" r="88" fill="url(#${uid}-dark-metal)" stroke="#E5C07B" stroke-width="1.4"/>
  <circle cx="300" cy="300" r="84" fill="url(#${uid}-hatch-fine)"/>
  <!-- Diamond Ring Corona Flare at ~11 o'clock -->
  <circle cx="238" cy="238" r="26" fill="url(#${uid}-diamond)"/>
  ${starSpark(238, 238, 22, 4.2, '#FFFFFF', 0.98)}
</svg>`;
}

function genSpecimenIris() {
  const uid = 'iris';
  const cx = 300, cy = 300;
  // Designed so every line reads boldly even at 56x56 inside Mistake Report modal!
  const bladeCount = 10;
  const blades = [];
  for (let i = 0; i < bladeCount; i++) {
    const a1 = i * (360 / bladeCount);
    const a2 = a1 + 52;
    const [p1x, p1y] = polar(cx, cy, 168, a1);
    const [p2x, p2y] = polar(cx, cy, 168, a2);
    const [p3x, p3y] = polar(cx, cy, 74, a2 - 14);
    const [p4x, p4y] = polar(cx, cy, 74, a1 + 18);
    const fill = i % 2 === 0 ? `url(#${uid}-blade-a)` : `url(#${uid}-blade-b)`;
    blades.push(`<path d="M${f(p1x)} ${f(p1y)} A168 168 0 0 1 ${f(p2x)} ${f(p2y)} L${f(p3x)} ${f(p3y)} Q${f(cx + 85 * Math.cos((a1 + 32) * DEG))} ${f(cy + 85 * Math.sin((a1 + 32) * DEG))} ${f(p4x)} ${f(p4y)} Z" fill="${fill}" stroke="#E5C07B" stroke-width="1.8" stroke-opacity="0.72"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  ${baseDefs(uid, `
    <linearGradient id="${uid}-blade-a" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#283145"/>
      <stop offset="100%" stop-color="#0B0E17"/>
    </linearGradient>
    <linearGradient id="${uid}-blade-b" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1E2536"/>
      <stop offset="100%" stop-color="#080A10"/>
    </linearGradient>
    <radialGradient id="${uid}-lens" cx="38%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#8FBFE0" stop-opacity="0.82"/>
      <stop offset="36%" stop-color="#26435E" stop-opacity="0.78"/>
      <stop offset="72%" stop-color="#0C111C" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#E5C07B" stop-opacity="0.55"/>
    </radialGradient>
  `)}
  <circle cx="300" cy="300" r="275" fill="url(#${uid}-glow-brass)"/>
  <!-- Heavy Knurled Brass Lens Barrel -->
  <circle cx="300" cy="300" r="244" fill="#0B0E17" stroke="url(#${uid}-brass)" stroke-width="6"/>
  <circle cx="300" cy="300" r="220" fill="none" stroke="#E5C07B" stroke-width="2" stroke-dasharray="4 6" stroke-opacity="0.78"/>
  <circle cx="300" cy="300" r="198" fill="#07090F" stroke="url(#${uid}-brass)" stroke-width="3.2"/>
  ${degreeRing(300, 300, 240, 224, 10, 30, 90, '#FAF0DC', 0.85)}

  <!-- Optical Overlapping Diaphragm Blades -->
  <g>${blades.join('')}</g>

  <!-- Central Coaxial Apochromatic Optic Pupil & Ray Caustic Reflections -->
  <circle cx="300" cy="300" r="76" fill="url(#${uid}-lens)" stroke="url(#${uid}-brass)" stroke-width="3.4"/>
  <circle cx="300" cy="300" r="56" fill="none" stroke="#8FBFE0" stroke-width="1.4" stroke-opacity="0.65"/>
  <ellipse cx="275" cy="272" rx="18" ry="10" transform="rotate(-35 275 272)" fill="#FAF0DC" fill-opacity="0.65"/>
  <circle cx="328" cy="326" r="7" fill="#E07A52" fill-opacity="0.7"/>
  <!-- Crosshair Dioptric Axes -->
  <line x1="214" y1="300" x2="250" y2="300" stroke="#FAF0DC" stroke-width="1.6" stroke-opacity="0.7"/>
  <line x1="350" y1="300" x2="386" y2="300" stroke="#FAF0DC" stroke-width="1.6" stroke-opacity="0.7"/>
  <line x1="300" y1="214" x2="300" y2="250" stroke="#FAF0DC" stroke-width="1.6" stroke-opacity="0.7"/>
  <line x1="300" y1="350" x2="300" y2="386" stroke="#FAF0DC" stroke-width="1.6" stroke-opacity="0.7"/>
</svg>`;
}

function genSpecimenHeliometer() {
  const uid = 'heliometer';
  const cx = 300, cy = 300;
  // Astronomical Split-Lens Heliometer (sharp at both 48px and 104px)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  ${baseDefs(uid, `
    <radialGradient id="${uid}-glass-a" cx="35%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#8FBFE0" stop-opacity="0.58"/>
      <stop offset="70%" stop-color="#1A2C42" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#090D16" stop-opacity="0.8"/>
    </radialGradient>
    <radialGradient id="${uid}-glass-b" cx="65%" cy="65%" r="65%">
      <stop offset="0%" stop-color="#E5C07B" stop-opacity="0.55"/>
      <stop offset="70%" stop-color="#4A3516" stop-opacity="0.52"/>
      <stop offset="100%" stop-color="#0D0B10" stop-opacity="0.8"/>
    </radialGradient>
  `)}
  <circle cx="300" cy="300" r="274" fill="url(#${uid}-glow-brass)"/>
  <!-- Outer Astronomical Setting Ring -->
  <circle cx="300" cy="300" r="240" fill="none" stroke="url(#${uid}-brass)" stroke-width="3.5"/>
  <circle cx="300" cy="300" r="218" fill="#090C14" fill-opacity="0.85" stroke="#E5C07B" stroke-width="1.2" stroke-opacity="0.6"/>
  ${degreeRing(300, 300, 238, 222, 6, 30, 90, '#FAF0DC', 0.8)}

  <!-- Twin Displaced Split Semi-Lenses along 45deg micrometer axis -->
  <g transform="rotate(-40 300 300)">
    <path d="M 150 284 A 150 150 0 0 1 450 284 Z" fill="url(#${uid}-glass-a)" stroke="#8FBFE0" stroke-width="2.4"/>
    <path d="M 150 316 A 150 150 0 0 0 450 316 Z" fill="url(#${uid}-glass-b)" stroke="#E5C07B" stroke-width="2.4"/>
    <!-- Micrometer Split Axis Rod & Knurled Thumbwheels -->
    <rect x="74" y="294" width="452" height="12" rx="4" fill="url(#${uid}-brass-v)" stroke="#090C14" stroke-width="1.5"/>
    <rect x="44" y="274" width="38" height="52" rx="6" fill="url(#${uid}-brass)" stroke="#FAF0DC" stroke-width="1.4"/>
    <rect x="518" y="274" width="38" height="52" rx="6" fill="url(#${uid}-brass)" stroke="#FAF0DC" stroke-width="1.4"/>
    <!-- Vernier Index Carriages -->
    <rect x="278" y="280" width="44" height="40" rx="4" fill="#0C111B" stroke="url(#${uid}-brass)" stroke-width="2.2"/>
  </g>
  <!-- Binary Star Coincidence Pair -->
  ${starSpark(272, 272, 19, 3.6, '#8FBFE0', 0.96)}
  ${starSpark(328, 328, 19, 3.6, '#FAF0DC', 0.96)}
  <circle cx="300" cy="300" r="10" fill="none" stroke="#E07A52" stroke-width="1.8"/>
</svg>`;
}

function genSpecimenBotanical() {
  const uid = 'botanical';
  // Intricate Phyllotaxis + Engraved Leaf & Stoma Lens Specimen (framed with bright brass/ivory strokes for watermark legibility)
  const seeds = [];
  for (let i = 1; i <= 144; i++) {
    const rad = Math.sqrt(i) * 11.2;
    const ang = i * 137.507764 * DEG;
    const sx = 395 + rad * Math.cos(ang);
    const sy = 240 + rad * Math.sin(ang);
    const col = i % 3 === 0 ? '#FAF0DC' : i % 2 === 0 ? '#E5C07B' : '#A9C9A4';
    seeds.push(`<circle cx="${f(sx, 1)}" cy="${f(sy, 1)}" r="${f(1.7 + (i / 144) * 2.4, 1)}" fill="${col}" fill-opacity="${f(0.45 + (1 - i / 180) * 0.5)}"/>`);
  }
  const veins = [-1, 1].flatMap(sgn => [0.22, 0.36, 0.50, 0.64, 0.78].map(t => {
    const y0 = 490 - t * 340;
    const w = Math.sin(t * Math.PI) * 92 * sgn;
    return `<path d="M 210 ${f(y0)} Q ${f(210 + w * 0.55)} ${f(y0 - 26)} ${f(210 + w)} ${f(y0 - 65)}" fill="none" stroke="#FAF0DC" stroke-width="1.55" stroke-opacity="0.82"/>`;
  })).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  ${baseDefs(uid, `
    <linearGradient id="${uid}-leaf" x1="15%" y1="10%" x2="85%" y2="90%">
      <stop offset="0%" stop-color="#3E6144" stop-opacity="0.90"/>
      <stop offset="60%" stop-color="#192B20" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="#0B1112" stop-opacity="0.95"/>
    </linearGradient>
  `)}
  <circle cx="300" cy="300" r="268" fill="url(#${uid}-glow-sage)"/>
  <circle cx="300" cy="300" r="248" fill="none" stroke="#E5C07B" stroke-width="1.2" stroke-opacity="0.48"/>
  <circle cx="395" cy="240" r="144" fill="none" stroke="#A9C9A4" stroke-width="1.2" stroke-opacity="0.45" stroke-dasharray="3 4"/>
  <circle cx="395" cy="240" r="160" fill="none" stroke="url(#${uid}-brass)" stroke-width="2.2" stroke-opacity="0.78"/>
  <!-- Fibonacci Phyllotaxis Sunflower Core -->
  <g>${seeds.join('')}</g>

  <!-- Sculpted Botanical Leaf Specimen -->
  <path d="M 210 520 L 210 492 C 95 435, 92 245, 210 102 C 328 245, 325 435, 210 492" fill="url(#${uid}-leaf)" stroke="url(#${uid}-brass)" stroke-width="3.2"/>
  <path d="M 210 492 L 210 108" fill="none" stroke="#FAF0DC" stroke-width="2.1"/>
  ${veins}

  <!-- Precision Stoma Optical Loupe Overlay -->
  <circle cx="378" cy="382" r="96" fill="#0B1214" fill-opacity="0.92" stroke="url(#${uid}-brass)" stroke-width="3.6"/>
  <circle cx="378" cy="382" r="82" fill="none" stroke="#FAF0DC" stroke-width="1.15" stroke-opacity="0.65" stroke-dasharray="3 4"/>
  <path d="M 322 382 Q 378 328 434 382 Q 378 436 322 382 Z" fill="#1F3B2F" stroke="#A9C9A4" stroke-width="2.4"/>
  <ellipse cx="378" cy="382" rx="16" ry="30" transform="rotate(90 378 382)" fill="#070A0E" stroke="#E5C07B" stroke-width="1.8"/>
</svg>`;
}

// ============================================================================
// 2. FOLIO MEDALLIONS (fixing cropped pl-vi, boxy pl-vii, upgrading lunar)
// ============================================================================

function genFolioConstellation() {
  const uid = 'planisphere';
  const cx = 300, cy = 300;
  // Circular Celestial Planisphere — no clipped left rectangle!
  const stars = starField(cx, cy, 20, 224, 140, 202611, ['#F2EDE3', '#E5C07B', '#8FBFE0', '#9CD3F0']);

  // Orion + Cassiopeia astrometric lines
  const orionPts = [
    [255, 220], [342, 228], [326, 294], [302, 304], [278, 314],
    [256, 378], [348, 372],
  ];
  const orionLinks = [[0, 1], [0, 4], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [5, 6]];
  const lines = orionLinks.map(([i, j]) =>
    `<line x1="${orionPts[i][0]}" y1="${orionPts[i][1]}" x2="${orionPts[j][0]}" y2="${orionPts[j][1]}" stroke="#8FBFE0" stroke-width="1.25" stroke-opacity="0.72" stroke-dasharray="3 2"/>`
  ).join('');

  const brightStars = [
    { x: 255, y: 220, c: '#E07A52', r: 10 }, // Betelgeuse
    { x: 342, y: 228, c: '#8FBFE0', r: 9 },  // Bellatrix
    { x: 326, y: 294, c: '#F2EDE3', r: 6.5 },
    { x: 302, y: 304, c: '#F2EDE3', r: 7 },
    { x: 278, y: 314, c: '#F2EDE3', r: 6.5 },
    { x: 256, y: 378, c: '#9CD3F0', r: 11 }, // Rigel
    { x: 348, y: 372, c: '#E5C07B', r: 8 },
    // Surrounding stars
    { x: 184, y: 270, c: '#F2EDE3', r: 6.5 },
    { x: 405, y: 262, c: '#E5C07B', r: 7 },
    { x: 220, y: 425, c: '#8FBFE0', r: 7 },
    { x: 386, y: 175, c: '#F2EDE3', r: 6 },
  ].map(s => starSpark(s.x, s.y, s.r * 1.45, s.r * 0.24, s.c, 0.96)).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  ${baseDefs(uid, `
    <radialGradient id="${uid}-sky" cx="48%" cy="46%" r="55%">
      <stop offset="0%" stop-color="#17243A"/>
      <stop offset="55%" stop-color="#0B111E"/>
      <stop offset="100%" stop-color="#05070C"/>
    </radialGradient>
    <radialGradient id="${uid}-mw" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#8FBFE0" stop-opacity="0.34"/>
      <stop offset="48%" stop-color="#E5C07B" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#05070C" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="${uid}-clip"><circle cx="300" cy="300" r="226"/></clipPath>
  `)}
  <circle cx="300" cy="300" r="275" fill="url(#${uid}-glow-cyan)"/>
  <circle cx="300" cy="300" r="248" fill="none" stroke="url(#${uid}-brass)" stroke-width="3"/>
  <circle cx="300" cy="300" r="226" fill="url(#${uid}-sky)" stroke="#E5C07B" stroke-width="1.4"/>
  ${degreeRing(300, 300, 246, 228, 3, 15, 45, '#E5C07B', 0.8)}

  <!-- Clipped Celestial Vault & Soft Elliptical Milky Way Stream -->
  <g clip-path="url(#${uid}-clip)">
    <ellipse cx="315" cy="300" rx="280" ry="74" transform="rotate(-38 315 300)" fill="url(#${uid}-mw)"/>
    <circle cx="300" cy="300" r="175" fill="none" stroke="#E5C07B" stroke-width="0.7" stroke-opacity="0.3" stroke-dasharray="4 4"/>
    <circle cx="300" cy="300" r="115" fill="none" stroke="#8FBFE0" stroke-width="0.65" stroke-opacity="0.28"/>
    <ellipse cx="300" cy="300" rx="224" ry="86" transform="rotate(22 300 300)" fill="none" stroke="#E5C07B" stroke-width="0.95" stroke-opacity="0.48"/>
    <ellipse cx="300" cy="300" rx="224" ry="62" transform="rotate(-68 300 300)" fill="none" stroke="#8FBFE0" stroke-width="0.7" stroke-opacity="0.32"/>
    ${stars}
    ${lines}
    ${brightStars}
  </g>

  <!-- Planisphere Horizon Brass Reticle Pointer -->
  <circle cx="300" cy="300" r="230" fill="none" stroke="url(#${uid}-brass)" stroke-width="2.2"/>
  ${cardinalCrosshairs(300, 300, 226, 266, '#E5C07B', 0.65)}
</svg>`;
}

function genFolioRegulator() {
  const uid = 'regulator';
  const cx = 300, cy = 300;
  // Open-Work Skeleton Astronomical Chronometer Movement (circular silhouette for Mocks empty state)
  const hourTicks = [];
  for (let i = 0; i < 60; i++) {
    const d = i * 6 - 90;
    const isHour = i % 5 === 0;
    const [x1, y1] = polar(cx, cy, isHour ? 192 : 204, d);
    const [x2, y2] = polar(cx, cy, 214, d);
    hourTicks.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${isHour ? '#FAF0DC' : '#E5C07B'}" stroke-width="${isHour ? 2.4 : 0.9}" stroke-opacity="${isHour ? 0.95 : 0.5}"/>`);
  }
  const gearMain = spurGearPath(246, 336, 24, 62, 53, 18, 12);
  const gearEsc = spurGearPath(358, 250, 18, 46, 38, 12, 8);
  const gearSec = spurGearPath(345, 355, 16, 36, 30, 9, 0);

  // True Archimedean hairspring coil at Balance Wheel (300, 196)
  const hairPts = [];
  for (let s = 0; s <= 72; s++) {
    const th = (s / 72) * 3.5 * TAU;
    const rr = 5 + (s / 72) * 23;
    hairPts.push(`${s === 0 ? 'M' : 'L'}${f(300 + rr * Math.cos(th), 1)} ${f(196 + rr * Math.sin(th), 1)}`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  ${baseDefs(uid)}
  <circle cx="300" cy="300" r="275" fill="url(#${uid}-glow-brass)"/>
  <!-- Winding Crown at 12 o'clock -->
  <rect x="282" y="22" width="36" height="32" rx="6" fill="url(#${uid}-brass-h)" stroke="#090C14" stroke-width="1.5"/>
  <circle cx="300" cy="18" r="22" fill="none" stroke="url(#${uid}-brass)" stroke-width="4.5"/>

  <!-- Outer Brass Case & Guilloche Chapter Ring -->
  <circle cx="300" cy="300" r="244" fill="#0A0D15" stroke="url(#${uid}-brass)" stroke-width="5.5"/>
  <circle cx="300" cy="300" r="222" fill="#07090F" stroke="#E5C07B" stroke-width="1.5" stroke-opacity="0.78"/>
  <circle cx="300" cy="300" r="186" fill="none" stroke="#E5C07B" stroke-width="1.2" stroke-opacity="0.52"/>
  <circle cx="300" cy="300" r="154" fill="none" stroke="#E5C07B" stroke-width="0.6" stroke-opacity="0.25" stroke-dasharray="3 4"/>
  ${hourTicks.join('')}

  <!-- Exposed Skeleton Gear Train -->
  <path d="${gearMain}" fill="url(#${uid}-brass)" fill-opacity="0.88" fill-rule="evenodd" stroke="#FAF0DC" stroke-width="1.05"/>
  <path d="${gearEsc}" fill="url(#${uid}-silver)" fill-opacity="0.84" fill-rule="evenodd" stroke="#F2EDE3" stroke-width="0.95"/>
  <path d="${gearSec}" fill="url(#${uid}-brass-v)" fill-opacity="0.88" fill-rule="evenodd" stroke="#FAF0DC" stroke-width="0.95"/>

  <!-- Balance Wheel + Archimedean Blued-Steel Hairspring -->
  <circle cx="300" cy="196" r="54" fill="#090C14" fill-opacity="0.92" stroke="#E5C07B" stroke-width="1.4" stroke-opacity="0.72"/>
  <circle cx="300" cy="196" r="40" fill="none" stroke="url(#${uid}-brass)" stroke-width="3.6"/>
  <path d="${hairPts.join('')}" fill="none" stroke="#8FBFE0" stroke-width="1.2" stroke-opacity="0.85"/>
  <line x1="260" y1="196" x2="340" y2="196" stroke="#E5C07B" stroke-width="2.4"/>
  <circle cx="300" cy="196" r="6" fill="#E07A52" stroke="#FAF0DC" stroke-width="1.2"/>

  <!-- Ruby Jewel Bearings -->
  <circle cx="246" cy="336" r="7.5" fill="#E07A52" stroke="#FAF0DC" stroke-width="1.3"/>
  <circle cx="358" cy="250" r="6.5" fill="#E07A52" stroke="#FAF0DC" stroke-width="1.3"/>
  <circle cx="345" cy="355" r="5.5" fill="#E07A52" stroke="#FAF0DC" stroke-width="1.1"/>

  <!-- Central Skeleton Dial Bridges -->
  <path d="M 122 300 L 185 300 M 415 300 L 478 300 M 300 415 L 300 478" stroke="url(#${uid}-brass)" stroke-width="4.5" stroke-linecap="round"/>

  <!-- Breguet Precision Hands -->
  <g stroke-linecap="round">
    <line x1="300" y1="300" x2="215" y2="250" stroke="#FAF0DC" stroke-width="4.8"/>
    <circle cx="236" cy="262" r="8" fill="#090C14" stroke="#FAF0DC" stroke-width="2.4"/>
    <line x1="300" y1="300" x2="396" y2="225" stroke="url(#${uid}-brass)" stroke-width="3.6"/>
    <circle cx="372" cy="244" r="6.5" fill="#090C14" stroke="#E5C07B" stroke-width="2.2"/>
    <line x1="278" y1="342" x2="368" y2="178" stroke="#E07A52" stroke-width="1.8"/>
  </g>
  <circle cx="300" cy="300" r="10.5" fill="url(#${uid}-brass)" stroke="#FAF0DC" stroke-width="1.6"/>
</svg>`;
}

// ============================================================================
// 3. ATMOSPHERIC PLATES (Night engraved/luminous + Dusk Observatory Polychrome)
// ============================================================================

function genAtmosSextant(mode = 'night') {
  const uid = `sextant-${mode}`;
  const isDusk = mode === 'dusk';
  const accent = isDusk ? '#8FBFE0' : '#E5C07B';
  const warm = isDusk ? '#E07A52' : '#E5C07B';

  // Build 120deg precision brass limb arc ticks centered around pivot (275, 130)
  const px = 275, py = 128, RLimb = 330;
  const startDeg = 32, endDeg = 122;
  const ticks = [];
  for (let d = startDeg; d <= endDeg; d += 1.5) {
    const isMajor = Math.abs((d - startDeg) % 15) < 0.01;
    const isMed = Math.abs((d - startDeg) % 7.5) < 0.01;
    const r0 = isMajor ? RLimb - 22 : isMed ? RLimb - 15 : RLimb - 9;
    const [x1, y1] = polar(px, py, r0, d);
    const [x2, y2] = polar(px, py, RLimb - 2, d);
    ticks.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="#FAF0DC" stroke-width="${isMajor ? 1.5 : 0.7}" stroke-opacity="${isMajor ? 0.9 : 0.48}"/>`);
  }
  const [l1x, l1y] = polar(px, py, RLimb, startDeg);
  const [l2x, l2y] = polar(px, py, RLimb, endDeg);
  const [i1x, i1y] = polar(px, py, RLimb - 32, startDeg);
  const [i2x, i2y] = polar(px, py, RLimb - 32, endDeg);
  const limbArc =
    `M${f(l1x)} ${f(l1y)} A${RLimb} ${RLimb} 0 0 1 ${f(l2x)} ${f(l2y)} ` +
    `L${f(i2x)} ${f(i2y)} A${RLimb - 32} ${RLimb - 32} 0 0 0 ${f(i1x)} ${f(i1y)} Z`;

  // Index Arm rotated at 72deg
  const [ax, ay] = polar(px, py, RLimb + 14, 72);
  const [tx1, ty1] = polar(px, py, 200, 122);
  const [tx2, ty2] = polar(px, py, 200, 32);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  ${baseDefs(uid)}
  <circle cx="300" cy="300" r="280" fill="url(#${uid}-glow-${isDusk ? 'ember' : 'brass'})"/>
  <circle cx="290" cy="300" r="255" fill="none" stroke="${accent}" stroke-width="0.7" stroke-opacity="0.28" stroke-dasharray="4 6"/>
  <circle cx="290" cy="300" r="228" fill="none" stroke="#E5C07B" stroke-width="0.8" stroke-opacity="0.36"/>
  ${starField(300, 300, 40, 275, 42, 404, ['#F2EDE3', '#E5C07B', '#8FBFE0'])}

  <!-- Optical Ray-Trace Star Sightlines -->
  <line x1="65" y1="78" x2="275" y2="128" stroke="${accent}" stroke-width="1.2" stroke-dasharray="5 4" stroke-opacity="0.68"/>
  <line x1="275" y1="128" x2="178" y2="262" stroke="${warm}" stroke-width="1.35" stroke-opacity="0.78"/>
  <line x1="178" y1="262" x2="432" y2="214" stroke="#FAF0DC" stroke-width="1.2" stroke-opacity="0.72"/>
  ${starSpark(88, 72, 22, 4.2, accent, 0.96)}

  <!-- Structural Truss Frame of the Sextant -->
  <g fill="none" stroke="url(#${uid}-brass)" stroke-width="11" stroke-linejoin="round">
    <line x1="${px}" y1="${py}" x2="${f(l1x - 10)}" y2="${f(l1y - 10)}"/>
    <line x1="${px}" y1="${py}" x2="${f(l2x + 8)}" y2="${f(l2y - 12)}"/>
    <path d="M ${f(tx1)} ${f(ty1)} Q 290 290 ${f(tx2)} ${f(ty2)}" stroke-width="7.5"/>
    <line x1="286" y1="260" x2="220" y2="430" stroke-width="6"/>
    <line x1="286" y1="260" x2="405" y2="410" stroke-width="6"/>
  </g>
  <!-- Pierced Relief Bracing Circles -->
  <circle cx="290" cy="240" r="24" fill="#090D16" stroke="url(#${uid}-brass)" stroke-width="3.5"/>
  <circle cx="238" cy="340" r="30" fill="#090D16" stroke="url(#${uid}-brass)" stroke-width="3.5"/>
  <circle cx="352" cy="332" r="27" fill="#090D16" stroke="url(#${uid}-brass)" stroke-width="3.5"/>

  <!-- Graduated 120deg Limb Arc -->
  <path d="${limbArc}" fill="url(#${uid}-dark-metal)" stroke="url(#${uid}-brass)" stroke-width="3.4"/>
  <g>${ticks.join('')}</g>

  <!-- Sighting Telescope Tube (upper right) -->
  <g transform="rotate(-11 330 228)">
    <rect x="210" y="210" width="225" height="30" rx="5" fill="url(#${uid}-brass-v)" stroke="#090C14" stroke-width="1.6"/>
    <rect x="395" y="206" width="38" height="38" rx="4" fill="#121B2B" stroke="url(#${uid}-brass)" stroke-width="2.4"/>
    <rect x="172" y="216" width="40" height="18" rx="3" fill="url(#${uid}-silver)" stroke="#090C14" stroke-width="1.4"/>
    <ellipse cx="433" cy="225" rx="6" ry="18" fill="${accent}" fill-opacity="0.45" stroke="#FAF0DC" stroke-width="1"/>
  </g>

  <!-- Horizon Glass & Sun Shade Discs -->
  <rect x="158" y="242" width="36" height="44" rx="4" transform="rotate(18 176 264)" fill="#182A3E" fill-opacity="0.88" stroke="url(#${uid}-brass)" stroke-width="2.5"/>
  <circle cx="152" cy="202" r="18" fill="${isDusk ? '#E07A52' : '#4A2B1D'}" fill-opacity="0.72" stroke="url(#${uid}-brass)" stroke-width="2"/>
  <circle cx="204" cy="182" r="15" fill="${isDusk ? '#8FBFE0' : '#1E3448'}" fill-opacity="0.72" stroke="url(#${uid}-brass)" stroke-width="2"/>

  <!-- Revolving Index Arm + Vernier Tangential Micrometer -->
  <line x1="${px}" y1="${py}" x2="${f(ax)}" y2="${f(ay)}" stroke="url(#${uid}-brass)" stroke-width="12" stroke-linecap="round"/>
  <line x1="${px}" y1="${py}" x2="${f(ax)}" y2="${f(ay)}" stroke="#FAF0DC" stroke-width="1.2" stroke-opacity="0.75"/>
  <circle cx="${px}" cy="${py}" r="26" fill="url(#${uid}-brass)" stroke="#090C14" stroke-width="2.4"/>
  <circle cx="${px}" cy="${py}" r="14" fill="#142336" stroke="#FAF0DC" stroke-width="1.4"/>
  <!-- Vernier Clamp Window on Limb -->
  <g transform="rotate(-18 ${f(ax)} ${f(ay)})">
    <rect x="${f(ax - 24)}" y="${f(ay - 16)}" width="48" height="32" rx="4" fill="#0B0F1A" stroke="url(#${uid}-brass)" stroke-width="2.5"/>
    <circle cx="${f(ax + 12)}" cy="${f(ay)}" r="5" fill="#E07A52" stroke="#FAF0DC" stroke-width="1"/>
  </g>
</svg>`;
}

function genAtmosMicroscope(mode = 'night') {
  const uid = `micro-${mode}`;
  const isDusk = mode === 'dusk';
  const glow = isDusk ? 'cyan' : 'brass';
  const lensHue = isDusk ? '#8FBFE0' : '#FAF0DC';
  const rayHue = isDusk ? '#7CC8F2' : '#E5C07B';
  const anomalyHue = isDusk ? '#E07A52' : '#FAF0DC';
  const bandHue = isDusk ? '#8FBFE0' : '#FAF0DC';

  const extras = `
    <linearGradient id="${uid}-brass-cyl" x1="0%" y1="50%" x2="100%" y2="50%">
      <stop offset="0%" stop-color="#3E2B0E"/>
      <stop offset="16%" stop-color="#B08135"/>
      <stop offset="38%" stop-color="#FFF5DA"/>
      <stop offset="58%" stop-color="#E5C07B"/>
      <stop offset="84%" stop-color="#6B4C1B"/>
      <stop offset="100%" stop-color="#B68F48"/>
    </linearGradient>
    <linearGradient id="${uid}-anodize" x1="0%" y1="50%" x2="100%" y2="50%">
      <stop offset="0%" stop-color="#05070C"/>
      <stop offset="22%" stop-color="#1A2233"/>
      <stop offset="44%" stop-color="#2D3952"/>
      <stop offset="76%" stop-color="#0F141F"/>
      <stop offset="100%" stop-color="#192131"/>
    </linearGradient>
    <linearGradient id="${uid}-chrome-cyl" x1="0%" y1="50%" x2="100%" y2="50%">
      <stop offset="0%" stop-color="#5B564E"/>
      <stop offset="20%" stop-color="#CFC8B9"/>
      <stop offset="40%" stop-color="#FFFDF7"/>
      <stop offset="68%" stop-color="#9E9789"/>
      <stop offset="100%" stop-color="#514C44"/>
    </linearGradient>
    <radialGradient id="${uid}-lens-glass" cx="38%" cy="34%" r="65%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.88"/>
      <stop offset="36%" stop-color="${lensHue}" stop-opacity="${isDusk ? 0.56 : 0.42}"/>
      <stop offset="80%" stop-color="${isDusk ? '#2C5C7F' : '#8C6B32'}" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="#090D16" stop-opacity="0.62"/>
    </radialGradient>
    <linearGradient id="${uid}-beam-cone" x1="50%" y1="100%" x2="50%" y2="0%">
      <stop offset="0%" stop-color="${rayHue}" stop-opacity="${isDusk ? 0.42 : 0.28}"/>
      <stop offset="48%" stop-color="${rayHue}" stop-opacity="${isDusk ? 0.55 : 0.36}"/>
      <stop offset="100%" stop-color="${lensHue}" stop-opacity="${isDusk ? 0.14 : 0.09}"/>
    </linearGradient>
    <linearGradient id="${uid}-loupe-cone" x1="100%" y1="100%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="${rayHue}" stop-opacity="${isDusk ? 0.30 : 0.20}"/>
      <stop offset="100%" stop-color="${rayHue}" stop-opacity="0.02"/>
    </linearGradient>
    <pattern id="${uid}-hatch-micro" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
      <line x1="0" y1="0" x2="0" y2="4" stroke="#E5C07B" stroke-width="0.45" stroke-opacity="0.28"/>
    </pattern>
    <clipPath id="${uid}-loupe-clip">
      <circle cx="128" cy="216" r="59"/>
    </clipPath>
    <clipPath id="${uid}-barrel-clip">
      <rect x="316" y="140" width="52" height="116" rx="2"/>
    </clipPath>`;

  // Precision linear graduation helper
  const tickSeries = (x1, y1, x2, y2, dx, dy, count, majorEvery = 5, stroke = '#E5C07B', op = 0.72) => {
    const out = [];
    const nx = x2 - x1;
    const ny = y2 - y1;
    const len = Math.hypot(nx, ny) || 1;
    const ux = nx / len, uy = ny / len;
    for (let i = 0; i <= count; i++) {
      const p = i / count;
      const px = x1 + nx * p;
      const py = y1 + ny * p;
      const isMajor = i % majorEvery === 0;
      const scale = isMajor ? 1.0 : 0.56;
      const tx = px + dx * scale;
      const ty = py + dy * scale;
      // Keep parallel knurling/tick helper general by supporting perpendicular normal when dx/dy provided directly
      out.push(`<line x1="${f(px)}" y1="${f(py)}" x2="${f(tx)}" y2="${f(ty)}" stroke="${stroke}" stroke-width="${isMajor ? 0.95 : 0.55}" stroke-opacity="${f(isMajor ? op : op * 0.65)}"/>`);
      void ux; void uy;
    }
    return out.join('');
  };

  // Knurling flutes inside a horizontal rectangle band
  const knurlBand = (x, y, w, h, step = 3.2, stroke = '#FAF0DC', op = 0.42) => {
    const out = [];
    for (let px = x + 2; px <= x + w - 2; px += step) {
      out.push(`<line x1="${f(px)}" y1="${f(y + 1)}" x2="${f(px)}" y2="${f(y + h - 1)}" stroke="${stroke}" stroke-width="0.65" stroke-opacity="${op}"/>`);
      out.push(`<line x1="${f(px + step * 0.45)}" y1="${f(y + 1)}" x2="${f(px + step * 0.45)}" y2="${f(y + h - 1)}" stroke="#06080E" stroke-width="0.6" stroke-opacity="0.55"/>`);
    }
    return out.join('');
  };

  // Rack-and-pinion machined gear teeth along vertical edge
  const rackTeeth = (x, yTop, count, pitch = 3.6, depth = 3.5) => {
    const parts = [];
    for (let i = 0; i < count; i++) {
      const y0 = yTop + i * pitch;
      const y1 = y0 + pitch * 0.48;
      parts.push(`<rect x="${f(x)}" y="${f(y0)}" width="${f(depth)}" height="${f(y1 - y0)}" fill="url(#${uid}-brass-v)" stroke="#090C14" stroke-width="0.45"/>`);
    }
    return parts.join('');
  };

  // Astrolabe bezel cardinal diamonds (echoing horizon moon astrolabe)
  const cardinalDiamonds = [0, 90, 180, 270].map(deg => {
    const [dx, dy] = polar(300, 300, 263, deg);
    const [ox, oy] = polar(300, 300, 274, deg);
    const [ix, iy] = polar(300, 300, 252, deg);
    const [lx, ly] = polar(300, 300, 263, deg - 1.35);
    const [rx, ry] = polar(300, 300, 263, deg + 1.35);
    return `<polygon points="${f(ox)},${f(oy)} ${f(lx)},${f(ly)} ${f(ix)},${f(iy)} ${f(rx)},${f(ry)}" fill="#080B12" stroke="#E5C07B" stroke-width="1" stroke-opacity="0.78"/>` +
      `<circle cx="${f(dx)}" cy="${f(dy)}" r="1.4" fill="#FAF0DC" fill-opacity="0.88"/>`;
  }).join('');

  // Left Specimen Loupe: bezel screws, cell membrane, stipples, anomalies
  const loupeScrews = [];
  for (let i = 0; i < 12; i++) {
    const deg = i * 30 + 15;
    const [sx, sy] = polar(128, 216, 68.5, deg);
    const [a1x, a1y] = polar(sx, sy, 2, deg + 35);
    const [a2x, a2y] = polar(sx, sy, 2, deg + 215);
    loupeScrews.push(
      `<circle cx="${f(sx)}" cy="${f(sy)}" r="2.2" fill="url(#${uid}-brass)" stroke="#090C14" stroke-width="0.7"/>` +
      `<line x1="${f(a1x)}" y1="${f(a1y)}" x2="${f(a2x)}" y2="${f(a2y)}" stroke="#090C14" stroke-width="0.55"/>`
    );
  }

  // Biomorphic striated cellular specimen inside (128, 216)
  const cellPts = [];
  const N_CELL = 48;
  for (let i = 0; i < N_CELL; i++) {
    const th = (i / N_CELL) * TAU;
    const rad = 34 + 5.2 * Math.sin(3 * th + 0.6) + 2.8 * Math.cos(5 * th - 0.9) + 1.4 * Math.sin(7 * th);
    cellPts.push([128 + rad * Math.cos(th), 217 + rad * 0.88 * Math.sin(th)]);
  }
  const cellPath = cellPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(p[0])} ${f(p[1])}`).join(' ') + ' Z';
  const cellInnerPath = cellPts.map((p, i) => {
    const ix = 128 + (p[0] - 128) * 0.86;
    const iy = 217 + (p[1] - 217) * 0.86;
    return `${i === 0 ? 'M' : 'L'}${f(ix)} ${f(iy)}`;
  }).join(' ') + ' Z';

  // Reticulated crystalline filaments & deterministic cytoplasmic stippling
  const rnd = mulberry32(isDusk ? 914 : 907);
  const stipples = [];
  for (let i = 0; i < 64; i++) {
    const th = rnd() * TAU;
    const r = 13 + rnd() * 19;
    const sx = 128 + r * Math.cos(th);
    const sy = 217 + r * 0.85 * Math.sin(th);
    const sr = 0.55 + rnd() * 0.95;
    const sc = rnd() > 0.72 ? rayHue : '#FAF0DC';
    stipples.push(`<circle cx="${f(sx)}" cy="${f(sy)}" r="${f(sr)}" fill="${sc}" fill-opacity="${f(0.26 + rnd() * 0.45)}"/>`);
  }
  const filaments = [];
  for (let i = 0; i < 7; i++) {
    const th = (i / 7) * TAU + 0.25;
    const [nx, ny] = [125 + 9 * Math.cos(th), 217 + 8 * Math.sin(th)];
    const [mx, my] = [128 + 20 * Math.cos(th + 0.22), 217 + 17 * Math.sin(th + 0.22)];
    const [ex, ey] = [128 + 31 * Math.cos(th - 0.12), 217 + 27 * Math.sin(th - 0.12)];
    filaments.push(`<path d="M ${f(nx)} ${f(ny)} Q ${f(mx)} ${f(my)} ${f(ex)} ${f(ey)}" fill="none" stroke="#E5C07B" stroke-width="0.6" stroke-opacity="0.48"/>`);
  }

  // 3 Highlighted diagnostic error-anomaly reticles inside specimen
  const anomalies = [
    [110, 198, 6.5],
    [146, 206, 5.5],
    [122, 237, 6.0],
  ].map(([ax, ay, ar]) => `
    <circle cx="${ax}" cy="${ay}" r="${ar}" fill="${anomalyHue}" fill-opacity="0.14" stroke="${anomalyHue}" stroke-width="0.85" stroke-opacity="0.85"/>
    <circle cx="${ax}" cy="${ay}" r="${f(ar * 0.35)}" fill="${anomalyHue}" fill-opacity="0.92"/>
    <line x1="${ax - ar - 3}" y1="${ay}" x2="${ax - 2.5}" y2="${ay}" stroke="${anomalyHue}" stroke-width="0.7" stroke-opacity="0.78"/>
    <line x1="${ax + 2.5}" y1="${ay}" x2="${ax + ar + 3}" y2="${ay}" stroke="${anomalyHue}" stroke-width="0.7" stroke-opacity="0.78"/>
    <line x1="${ax}" y1="${ay - ar - 3}" x2="${ax}" y2="${ay - 2.5}" stroke="${anomalyHue}" stroke-width="0.7" stroke-opacity="0.78"/>
    <line x1="${ax}" y1="${ay + 2.5}" x2="${ax}" y2="${ay + ar + 3}" stroke="${anomalyHue}" stroke-width="0.7" stroke-opacity="0.78"/>
  `).join('');

  // Dual Coaxial Focus Micrometer Spur Gears (Coarse @ 418,214 & Fine @ 408,268)
  const coarseGearOuter = spurGearPath(418, 214, 40, 30.5, 28, 21.5, 4);
  const fineGearOuter = spurGearPath(408, 268, 28, 19.5, 17.6, 12.5, 9);
  const trunnionRosette = spurGearPath(368, 412, 16, 12, 10.2, 4, 0);

  // Exact tangent coordinates from slide focus (342, 336) to loupe rim (128, 216, r=73)
  const lDx = 342 - 128;
  const lDy = 336 - 216;
  const lDist = Math.hypot(lDx, lDy);
  const lPhi = Math.atan2(lDy, lDx);
  const lAlpha = Math.acos(73 / lDist);
  const t1x = 128 + 73 * Math.cos(lPhi - lAlpha);
  const t1y = 216 + 73 * Math.sin(lPhi - lAlpha);
  const t2x = 128 + 73 * Math.cos(lPhi + lAlpha);
  const t2y = 216 + 73 * Math.sin(lPhi + lAlpha);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  ${baseDefs(uid, extras)}

  <!-- 1. CELESTIAL ASTROLABE FIELD & ATMOSPHERIC AURA -->
  <circle cx="300" cy="300" r="286" fill="url(#${uid}-glow-${glow})" opacity="0.86"/>
  <circle cx="342" cy="338" r="118" fill="url(#${uid}-glow-${isDusk ? 'cyan' : 'brass'})" opacity="0.72"/>
  <circle cx="128" cy="216" r="96" fill="url(#${uid}-glow-${glow})" opacity="0.58"/>

  <!-- Outer Dotted Horizon & Astrometric Bezel Tracks -->
  <circle cx="300" cy="300" r="272" fill="none" stroke="#E5C07B" stroke-width="0.55" stroke-opacity="0.28" stroke-dasharray="1.5 4.5"/>
  <circle cx="300" cy="300" r="254" fill="none" stroke="url(#${uid}-brass)" stroke-width="1.35" stroke-opacity="0.62"/>
  <circle cx="300" cy="300" r="238" fill="none" stroke="#E5C07B" stroke-width="0.7" stroke-opacity="0.38"/>
  <circle cx="300" cy="300" r="228" fill="none" stroke="${rayHue}" stroke-width="0.65" stroke-opacity="0.32" stroke-dasharray="2 5"/>
  <circle cx="300" cy="300" r="190" fill="none" stroke="#E5C07B" stroke-width="0.5" stroke-opacity="0.18"/>
  <circle cx="300" cy="300" r="154" fill="none" stroke="${rayHue}" stroke-width="0.45" stroke-opacity="0.14" stroke-dasharray="3 6"/>
  ${degreeRing(300, 300, 254, 240, 2, 10, 30, '#E5C07B', 0.64)}
  ${cardinalCrosshairs(300, 300, 224, 276, '#E5C07B', 0.44)}
  ${cardinalDiamonds}

  <!-- Inclined Elliptical Nodal Orbits & Optical Telemetry Nodes -->
  <g opacity="0.88">
    <ellipse cx="300" cy="300" rx="246" ry="74" transform="rotate(-21 300 300)" fill="none" stroke="#E5C07B" stroke-width="0.95" stroke-opacity="0.44"/>
    <ellipse cx="300" cy="300" rx="246" ry="74" transform="rotate(-21 300 300)" fill="none" stroke="${lensHue}" stroke-width="1.6" stroke-opacity="0.55" stroke-dasharray="110 900"/>
    <ellipse cx="300" cy="300" rx="212" ry="62" transform="rotate(24 300 300)" fill="none" stroke="${rayHue}" stroke-width="0.7" stroke-opacity="0.32" stroke-dasharray="4 4"/>
    <circle cx="114" cy="356" r="2.6" fill="${lensHue}" fill-opacity="0.9"/>
    <circle cx="486" cy="244" r="2.2" fill="#E5C07B" fill-opacity="0.85"/>
    <circle cx="458" cy="378" r="2" fill="${rayHue}" fill-opacity="0.75"/>
  </g>
  ${starField(300, 300, 88, 278, 52, isDusk ? 419 : 411, ['#F2EDE3', '#E5C07B', rayHue])}
  ${starSpark(496, 126, 10, 2.0, lensHue, 0.88)}
  ${starSpark(98, 430, 8, 1.6, '#FAF0DC', 0.78)}
  ${starSpark(478, 476, 7.5, 1.5, rayHue, 0.72)}

  <!-- Optical Bench Datum Baseline & Precision Scale -->
  <g opacity="0.82">
    <line x1="176" y1="532" x2="502" y2="532" stroke="#E5C07B" stroke-width="0.9" stroke-opacity="0.52"/>
    <line x1="205" y1="535" x2="475" y2="535" stroke="#E5C07B" stroke-width="0.45" stroke-opacity="0.3"/>
    ${tickSeries(210, 532, 470, 532, 0, 4, 26, 5, '#E5C07B', 0.52)}
  </g>

  <!-- 2. PROJECTION BEAM & LEFT SPECIMEN INSPECTION LOUPE -->
  <g>
    <polygon points="342,336 ${f(t1x)},${f(t1y)} ${f(t2x)},${f(t2y)}" fill="url(#${uid}-loupe-cone)"/>
    <line x1="342" y1="336" x2="${f(t1x)}" y2="${f(t1y)}" stroke="${rayHue}" stroke-width="0.85" stroke-opacity="0.58" stroke-dasharray="4 3.5"/>
    <line x1="342" y1="336" x2="${f(t2x)}" y2="${f(t2y)}" stroke="${rayHue}" stroke-width="0.85" stroke-opacity="0.58" stroke-dasharray="4 3.5"/>
    <path d="M 272 288 A 82 82 0 0 1 256 308" fill="none" stroke="${rayHue}" stroke-width="0.7" stroke-opacity="0.45"/>
    <path d="M 244 268 A 118 118 0 0 1 220 298" fill="none" stroke="${rayHue}" stroke-width="0.65" stroke-opacity="0.34" stroke-dasharray="2 3"/>

    <!-- Outer Multi-Bevel Loupe Medallion -->
    <circle cx="128" cy="216" r="73" fill="#070A10" stroke="url(#${uid}-brass)" stroke-width="2.4"/>
    <circle cx="128" cy="216" r="66" fill="none" stroke="#E5C07B" stroke-width="0.65" stroke-opacity="0.48"/>
    <circle cx="128" cy="216" r="60" fill="#06080E" stroke="url(#${uid}-brass-v)" stroke-width="1.4"/>
    ${degreeRing(128, 216, 66, 60.5, 5, 15, 45, '#E5C07B', 0.7)}
    <g>${loupeScrews.join('')}</g>

    <!-- Magnified Specimen Cytology & Reticle inside Aperture -->
    <g clip-path="url(#${uid}-loupe-clip)">
      <circle cx="128" cy="216" r="59" fill="url(#${uid}-glow-${isDusk ? 'cyan' : 'brass'})" opacity="0.46"/>
      <!-- Polar & Micrometer Grid -->
      <circle cx="128" cy="216" r="46" fill="none" stroke="${rayHue}" stroke-width="0.6" stroke-opacity="0.32" stroke-dasharray="2 3"/>
      <circle cx="128" cy="216" r="30" fill="none" stroke="#E5C07B" stroke-width="0.55" stroke-opacity="0.28"/>
      <circle cx="128" cy="216" r="14" fill="none" stroke="${rayHue}" stroke-width="0.6" stroke-opacity="0.45"/>
      <line x1="69" y1="216" x2="118" y2="216" stroke="#E5C07B" stroke-width="0.55" stroke-opacity="0.42"/>
      <line x1="138" y1="216" x2="187" y2="216" stroke="#E5C07B" stroke-width="0.55" stroke-opacity="0.42"/>
      <line x1="128" y1="157" x2="128" y2="206" stroke="#E5C07B" stroke-width="0.55" stroke-opacity="0.42"/>
      <line x1="128" y1="226" x2="128" y2="275" stroke="#E5C07B" stroke-width="0.55" stroke-opacity="0.42"/>
      <line x1="86" y1="174" x2="170" y2="258" stroke="#E5C07B" stroke-width="0.4" stroke-opacity="0.2" stroke-dasharray="2 4"/>
      <line x1="170" y1="174" x2="86" y2="258" stroke="#E5C07B" stroke-width="0.4" stroke-opacity="0.2" stroke-dasharray="2 4"/>
      ${tickSeries(84, 216, 172, 216, 0, -3.5, 22, 5, '#FAF0DC', 0.45)}

      <!-- Cellular Striated Specimen & Organelles -->
      <path d="${cellPath}" fill="${isDusk ? '#1E3C54' : '#352A18'}" fill-opacity="0.42" stroke="${lensHue}" stroke-width="1.25" stroke-opacity="0.86"/>
      <path d="${cellInnerPath}" fill="url(#${uid}-hatch-micro)" stroke="#E5C07B" stroke-width="0.65" stroke-opacity="0.55"/>
      <g>${filaments.join('')}</g>
      <g>${stipples.join('')}</g>

      <!-- Nucleus & Diagnostic Error Loci -->
      <ellipse cx="126" cy="217" rx="11.5" ry="9" transform="rotate(-18 126 217)" fill="#090D16" stroke="#E5C07B" stroke-width="1.15"/>
      <ellipse cx="126" cy="217" rx="11.5" ry="9" transform="rotate(-18 126 217)" fill="url(#${uid}-hatch-micro)"/>
      <circle cx="124" cy="216" r="2.8" fill="${lensHue}" fill-opacity="0.82"/>
      <g>${anomalies}</g>

      <!-- Concave Glass Specular Catchlight -->
      <path d="M 78 202 A 54 54 0 0 1 164 176 Q 124 190 88 214 Z" fill="${lensHue}" fill-opacity="0.14"/>
      <path d="M 82 192 A 50 50 0 0 1 142 169" fill="none" stroke="#FFFFFF" stroke-width="1.2" stroke-opacity="0.38" stroke-linecap="round"/>
    </g>
  </g>

  <!-- 3. TRIPOD CLAW PEDESTAL, FLUTED PILLAR & TRUNNION JOINT (X_OPT = 342) -->
  <!-- Rear Tripod Foot -->
  <g>
    <rect x="331" y="476" width="22" height="44" rx="2" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="1.4"/>
    <path d="M 326 520 L 358 520 L 362 531 L 322 531 Z" fill="url(#${uid}-anodize)" stroke="#E5C07B" stroke-width="1"/>
  </g>

  <!-- Sculpted Left & Right Horseshoe Claw Legs -->
  <g>
    <!-- Left Arch Foot -->
    <path d="M 328 474 C 294 476, 260 492, 240 520 L 258 524 C 276 502, 302 490, 329 489 Z" fill="url(#${uid}-brass-v)" stroke="#090C14" stroke-width="1.6"/>
    <path d="M 250 518 C 274 494, 298 484, 327 481" fill="none" stroke="#FAF0DC" stroke-width="0.9" stroke-opacity="0.62"/>
    <rect x="234" y="518" width="28" height="4.5" rx="1.5" fill="url(#${uid}-brass-h)" stroke="#090C14" stroke-width="0.9"/>
    ${knurlBand(235, 518, 26, 4.5, 2.8, '#FAF0DC', 0.45)}
    <path d="M 232 522.5 L 264 522.5 L 267 531.5 L 229 531.5 Z" fill="url(#${uid}-anodize)" stroke="#E5C07B" stroke-width="1"/>
    <line x1="238" y1="523" x2="236" y2="531" stroke="#E5C07B" stroke-width="0.7" stroke-opacity="0.65"/>
    <line x1="248" y1="523" x2="248" y2="531" stroke="#E5C07B" stroke-width="0.7" stroke-opacity="0.65"/>
    <line x1="258" y1="523" x2="260" y2="531" stroke="#E5C07B" stroke-width="0.7" stroke-opacity="0.65"/>

    <!-- Right Arch Foot -->
    <path d="M 356 474 C 390 476, 424 492, 444 520 L 426 524 C 408 502, 382 490, 355 489 Z" fill="url(#${uid}-brass-v)" stroke="#090C14" stroke-width="1.6"/>
    <path d="M 434 518 C 410 494, 386 484, 357 481" fill="none" stroke="#FAF0DC" stroke-width="0.9" stroke-opacity="0.62"/>
    <rect x="422" y="518" width="28" height="4.5" rx="1.5" fill="url(#${uid}-brass-h)" stroke="#090C14" stroke-width="0.9"/>
    ${knurlBand(423, 518, 26, 4.5, 2.8, '#FAF0DC', 0.45)}
    <path d="M 420 522.5 L 452 522.5 L 455 531.5 L 417 531.5 Z" fill="url(#${uid}-anodize)" stroke="#E5C07B" stroke-width="1"/>
    <line x1="426" y1="523" x2="424" y2="531" stroke="#E5C07B" stroke-width="0.7" stroke-opacity="0.65"/>
    <line x1="436" y1="523" x2="436" y2="531" stroke="#E5C07B" stroke-width="0.7" stroke-opacity="0.65"/>
    <line x1="446" y1="523" x2="448" y2="531" stroke="#E5C07B" stroke-width="0.7" stroke-opacity="0.65"/>
  </g>

  <!-- Central Graduated Pillar Column & Mirror Yoke Anchor -->
  <g>
    <rect x="328" y="406" width="28" height="74" rx="2" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="1.6"/>
    <rect x="324" y="472" width="36" height="8" rx="2" fill="url(#${uid}-brass-h)" stroke="#090C14" stroke-width="1.2"/>
    <rect x="324" y="402" width="36" height="8" rx="2" fill="url(#${uid}-brass-h)" stroke="#090C14" stroke-width="1.2"/>
    ${tickSeries(331, 414, 331, 468, 6, 0, 12, 4, '#090C14', 0.55)}
    <line x1="337" y1="410" x2="337" y2="472" stroke="#FFF6DE" stroke-width="1.1" stroke-opacity="0.5"/>
  </g>

  <!-- 4. GIMBALED PARABOLIC MIRROR, LUMINOUS CONE & ABBE CONDENSER -->
  <g>
    <!-- Dioptric Condenser Light Cone (Bottom Mirror -> Condenser Neck -> Slide) -->
    <polygon points="315,447 369,447 352,378 332,378" fill="url(#${uid}-beam-cone)"/>
    <polygon points="330,378 354,378 368,341 316,341" fill="url(#${uid}-beam-cone)"/>
    <line x1="322" y1="446" x2="337" y2="378" stroke="${rayHue}" stroke-width="0.75" stroke-opacity="0.65" stroke-dasharray="3 2.5"/>
    <line x1="362" y1="446" x2="347" y2="378" stroke="${rayHue}" stroke-width="0.75" stroke-opacity="0.65" stroke-dasharray="3 2.5"/>
    <line x1="337" y1="378" x2="321" y2="340" stroke="${rayHue}" stroke-width="0.75" stroke-opacity="0.6"/>
    <line x1="347" y1="378" x2="363" y2="340" stroke="${rayHue}" stroke-width="0.75" stroke-opacity="0.6"/>
    <!-- Optical Center Axis -->
    <line x1="342" y1="54" x2="342" y2="452" stroke="${lensHue}" stroke-width="0.6" stroke-opacity="0.22" stroke-dasharray="6 4"/>

    <!-- Mirror Gimbal Forked Yoke -->
    <path d="M 304 452 C 304 484, 380 484, 380 452" fill="none" stroke="url(#${uid}-chrome-cyl)" stroke-width="3.8" stroke-linecap="round"/>
    <path d="M 304 452 C 304 484, 380 484, 380 452" fill="none" stroke="#090C14" stroke-width="0.8" stroke-opacity="0.6"/>
    <!-- Tilted 3D Double-Sided Parabolic Mirror -->
    <g transform="rotate(-21 342 452)">
      <ellipse cx="342" cy="455" rx="34" ry="11" fill="url(#${uid}-brass-h)" stroke="#090C14" stroke-width="1.4"/>
      <ellipse cx="342" cy="451" rx="34" ry="10.5" fill="url(#${uid}-anodize)" stroke="url(#${uid}-brass)" stroke-width="1.8"/>
      <ellipse cx="342" cy="450.5" rx="28.5" ry="7.2" fill="url(#${uid}-lens-glass)"/>
      <line x1="322" y1="446" x2="338" y2="455" stroke="#FAF0DC" stroke-width="0.7" stroke-opacity="0.5"/>
      <line x1="332" y1="444.5" x2="352" y2="455.5" stroke="#FAF0DC" stroke-width="0.9" stroke-opacity="0.6"/>
      <line x1="346" y1="445" x2="361" y2="453" stroke="${rayHue}" stroke-width="0.7" stroke-opacity="0.5"/>
    </g>
    <!-- Jewelled Gimbal Pivot Trunnions -->
    <circle cx="304" cy="452" r="3.6" fill="url(#${uid}-brass)" stroke="#090C14" stroke-width="0.9"/>
    <circle cx="380" cy="452" r="3.6" fill="url(#${uid}-brass)" stroke="#090C14" stroke-width="0.9"/>

    <!-- Abbe Substage Condenser + Bladed Iris Diaphragm -->
    <path d="M 322 380 Q 342 396 362 380 Z" fill="url(#${uid}-lens-glass)" stroke="#E5C07B" stroke-width="1"/>
    <path d="M 330 383 Q 342 390 352 382" fill="none" stroke="#FFFFFF" stroke-width="0.85" stroke-opacity="0.55" stroke-linecap="round"/>
    <rect x="315" y="366" width="54" height="14" rx="2" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="1.3"/>
    ${knurlBand(316, 367, 52, 12, 3.0, '#FAF0DC', 0.35)}
    <rect x="319" y="352" width="46" height="14" rx="1.5" fill="url(#${uid}-anodize)" stroke="#E5C07B" stroke-width="1.1"/>
    <!-- Iris Aperture Slider Lever & Scale Arc -->
    <path d="M 294 374 Q 305 381 315 376" fill="none" stroke="#E5C07B" stroke-width="0.65" stroke-opacity="0.55" stroke-dasharray="1.5 2"/>
    <line x1="319" y1="369" x2="291" y2="376" stroke="url(#${uid}-brass-v)" stroke-width="3" stroke-linecap="round"/>
    <circle cx="290" cy="376" r="3.4" fill="#FAF0DC" stroke="#090C14" stroke-width="0.9"/>
  </g>

  <!-- 5. SCULPTURAL DOUBLED OBSERVATORY C-ARM LIMB & TRUNNION CLAMP -->
  <g>
    <!-- Lower Stage Support Strut & C-Arm Outer Brass Frame -->
    <path d="M 358 344 L 408 344 L 404 358 L 358 354 Z" fill="url(#${uid}-brass-v)" stroke="#090C14" stroke-width="1.2"/>
    <!-- Outer Limb Body -->
    <path d="M 360 420 C 464 388, 482 228, 368 170 L 352 198 C 434 242, 424 366, 348 398 Z" fill="url(#${uid}-brass)" stroke="#090C14" stroke-width="1.9"/>
    <!-- Deep Hatched Recessed Inner C-Channel -->
    <path d="M 366 406 C 446 376, 460 238, 368 184 L 359 195 C 436 244, 426 362, 355 393 Z" fill="#070A10" stroke="#E5C07B" stroke-width="0.9" stroke-opacity="0.75"/>
    <path d="M 366 406 C 446 376, 460 238, 368 184 L 359 195 C 436 244, 426 362, 355 393 Z" fill="url(#${uid}-hatch-micro)"/>
    <!-- Central Machined Spine Rib inside C-Channel -->
    <path d="M 363 400 C 441 370, 448 242, 364 190" fill="none" stroke="url(#${uid}-brass-v)" stroke-width="4.2" stroke-linecap="round"/>
    <path d="M 363 398.5 C 439 369, 446 242, 364 189" fill="none" stroke="#FAF0DC" stroke-width="0.85" stroke-opacity="0.65"/>
    <!-- Outer Rim Specular Highlight -->
    <path d="M 364 416 C 461 384, 478 231, 369 173" fill="none" stroke="#FFF6DE" stroke-width="1.15" stroke-opacity="0.68"/>

    <!-- Engraved Maker's Cartouche Plate on Vertical Spine -->
    <g transform="rotate(-10 436 318)">
      <rect x="429" y="294" width="14" height="48" rx="3" fill="#070A10" stroke="url(#${uid}-brass)" stroke-width="1.3"/>
      <rect x="431.5" y="297" width="9" height="42" rx="1.5" fill="none" stroke="#E5C07B" stroke-width="0.5" stroke-opacity="0.6"/>
      <circle cx="436" cy="300" r="1.1" fill="#FAF0DC"/>
      <circle cx="436" cy="336" r="1.1" fill="#FAF0DC"/>
      <line x1="433.5" y1="312" x2="438.5" y2="312" stroke="#E5C07B" stroke-width="0.7"/>
      <line x1="433.5" y1="318" x2="438.5" y2="318" stroke="#FAF0DC" stroke-width="0.8"/>
      <line x1="433.5" y1="324" x2="438.5" y2="324" stroke="#E5C07B" stroke-width="0.7"/>
    </g>

    <!-- Trunnion Hinge Clevis & Clamping Rosette Toggle -->
    <circle cx="368" cy="412" r="16" fill="url(#${uid}-anodize)" stroke="url(#${uid}-brass)" stroke-width="2"/>
    <path d="${trunnionRosette}" fill="url(#${uid}-brass)" fill-rule="evenodd" stroke="#090C14" stroke-width="0.8"/>
    <line x1="368" y1="412" x2="396" y2="429" stroke="url(#${uid}-brass-v)" stroke-width="3.6" stroke-linecap="round"/>
    <circle cx="397" cy="430" r="3.4" fill="#FAF0DC" stroke="#090C14" stroke-width="0.9"/>
    <circle cx="368" cy="412" r="4.5" fill="#FAF0DC" stroke="#090C14" stroke-width="1"/>
  </g>

  <!-- 6. RACK-AND-PINION COLUMN & COAXIAL MICROMETER FOCUS DRUMS -->
  <g>
    <!-- Vertical Dovetail Guideway Rail & 32 Machined Rack Teeth -->
    <rect x="355" y="144" width="12" height="126" rx="1.5" fill="url(#${uid}-anodize)" stroke="#E5C07B" stroke-width="1.1"/>
    ${rackTeeth(365, 148, 33, 3.6, 3.6)}
    <!-- Upper Arm Bracket Housing Bridging Body Tube to Coarse Pinion -->
    <rect x="342" y="168" width="38" height="22" rx="2.5" fill="url(#${uid}-brass-v)" stroke="#090C14" stroke-width="1.4"/>
    <circle cx="352" cy="179" r="2.2" fill="#090C14" stroke="#FAF0DC" stroke-width="0.7"/>
    <circle cx="372" cy="179" r="2.2" fill="#090C14" stroke="#FAF0DC" stroke-width="0.7"/>
    <!-- Pinion Axle Sleeves -->
    <rect x="366" y="207" width="34" height="14" rx="2" fill="url(#${uid}-chrome-cyl)" stroke="#090C14" stroke-width="1.1"/>
    <rect x="366" y="262" width="32" height="12" rx="2" fill="url(#${uid}-brass-v)" stroke="#090C14" stroke-width="1"/>

    <!-- Coarse Focus Knurled Micrometer Wheel (cx=418, cy=214) -->
    <circle cx="418" cy="214" r="31" fill="#070A10" stroke="#090C14" stroke-width="1.5"/>
    <path d="${coarseGearOuter}" fill="url(#${uid}-brass)" fill-rule="evenodd" stroke="#090C14" stroke-width="0.8"/>
    <circle cx="418" cy="214" r="23.5" fill="url(#${uid}-anodize)" stroke="#E5C07B" stroke-width="1.2"/>
    ${degreeRing(418, 214, 23, 19, 15, 45, 90, '#FAF0DC', 0.58)}
    <circle cx="418" cy="214" r="16.5" fill="url(#${uid}-brass)" stroke="#090C14" stroke-width="1.2"/>
    <!-- Recessed Radial Spokes / Guilloche Detail -->
    <line x1="406" y1="214" x2="430" y2="214" stroke="#090C14" stroke-width="1.2" stroke-opacity="0.55"/>
    <line x1="418" y1="202" x2="418" y2="226" stroke="#090C14" stroke-width="1.2" stroke-opacity="0.55"/>
    <circle cx="418" cy="214" r="8.2" fill="url(#${uid}-chrome-cyl)" stroke="#090C14" stroke-width="1.1"/>
    <line x1="413.5" y1="211" x2="422.5" y2="217" stroke="#090C14" stroke-width="1.2"/>

    <!-- Fine Micrometer Graduated Wheel (cx=408, cy=268) -->
    <circle cx="408" cy="268" r="20" fill="#070A10" stroke="#090C14" stroke-width="1.2"/>
    <path d="${fineGearOuter}" fill="url(#${uid}-brass)" fill-rule="evenodd" stroke="#090C14" stroke-width="0.7"/>
    <circle cx="408" cy="268" r="14.5" fill="url(#${uid}-anodize)" stroke="#FAF0DC" stroke-width="0.9"/>
    ${degreeRing(408, 268, 14.2, 10.8, 15, 45, 90, '#E5C07B', 0.72)}
    <circle cx="408" cy="268" r="8.5" fill="url(#${uid}-brass-v)" stroke="#090C14" stroke-width="1"/>
    <circle cx="408" cy="268" r="3.4" fill="#FAF0DC"/>
    <!-- Vernier Index Pointer Arrow -->
    <polygon points="384,268 391,265.5 391,270.5" fill="${lensHue}"/>
  </g>

  <!-- 7. VERNIER MECHANICAL STAGE, X-Y MICROMETER DRUMS & PREPARED SLIDE -->
  <g>
    <!-- Main Black Anodized Stage Deck -->
    <rect x="236" y="341" width="180" height="12" rx="2" fill="url(#${uid}-anodize)" stroke="url(#${uid}-brass)" stroke-width="1.8"/>
    <line x1="238" y1="342" x2="414" y2="342" stroke="#FAF0DC" stroke-width="0.75" stroke-opacity="0.58"/>
    <!-- Stage Vernier Millimeter Graduation Bar -->
    <rect x="256" y="343.5" width="140" height="4.5" fill="#0A0E18" fill-opacity="0.9"/>
    ${tickSeries(260, 343.5, 392, 343.5, 0, 3.8, 30, 5, '#E5C07B', 0.65)}

    <!-- Left Coaxial X-Y Stage Micrometer Drums -->
    <rect x="226" y="344.5" width="11" height="5" fill="url(#${uid}-chrome-cyl)" stroke="#090C14" stroke-width="0.8"/>
    <rect x="213" y="339" width="14" height="16" rx="1.8" fill="url(#${uid}-brass-v)" stroke="#090C14" stroke-width="1.1"/>
    ${tickSeries(214, 340.5, 226, 340.5, 0, 13, 5, 2, '#090C14', 0.55)}
    <rect x="202" y="342" width="11" height="10" rx="1.5" fill="url(#${uid}-anodize)" stroke="#E5C07B" stroke-width="0.9"/>
    <circle cx="199" cy="347" r="3" fill="url(#${uid}-brass)" stroke="#090C14" stroke-width="0.8"/>
    <!-- Right Stage Tension Knob -->
    <rect x="415" y="342" width="9" height="10" rx="1.5" fill="url(#${uid}-brass-v)" stroke="#090C14" stroke-width="1"/>

    <!-- Twin Curved Spring-Steel Slide Clips -->
    <path d="M 272 341 C 276 332, 290 333, 302 337" fill="none" stroke="url(#${uid}-chrome-cyl)" stroke-width="2" stroke-linecap="round"/>
    <circle cx="272" cy="341" r="2.2" fill="#E5C07B" stroke="#090C14" stroke-width="0.7"/>
    <path d="M 404 341 C 400 332, 386 333, 376 337" fill="none" stroke="url(#${uid}-chrome-cyl)" stroke-width="2" stroke-linecap="round"/>
    <circle cx="404" cy="341" r="2.2" fill="#E5C07B" stroke="#090C14" stroke-width="0.7"/>

    <!-- Glass Specimen Slide & Coverslip + Glowing Focal Hotspot -->
    <rect x="292" y="335.5" width="96" height="5.5" rx="0.8" fill="${lensHue}" fill-opacity="${isDusk ? 0.42 : 0.28}" stroke="#FAF0DC" stroke-width="0.95"/>
    <rect x="293" y="336" width="18" height="4.5" fill="#FAF0DC" fill-opacity="0.34"/>
    <rect x="328" y="333" width="28" height="2.5" rx="0.5" fill="#FFFFFF" fill-opacity="0.58" stroke="${rayHue}" stroke-width="0.5"/>
    <circle cx="342" cy="336" r="4.5" fill="${rayHue}" fill-opacity="0.38" filter="url(#${uid}-softglow)"/>
    ${starSpark(342, 336, 6.5, 1.3, '#FFFFFF', 0.94)}
  </g>

  <!-- 8. CUTAWAY OPTICAL BODY TUBE, DRAW-TUBE, OCULAR & REVOLVING NOSEPIECE -->
  <g>
    <!-- Ocular Eyepiece Assembly (top) -->
    <path d="M 322 92 L 362 92 L 357 104 L 327 104 Z" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="1.3"/>
    <rect x="319" y="75" width="46" height="17" rx="2" fill="url(#${uid}-anodize)" stroke="url(#${uid}-brass)" stroke-width="1.4"/>
    <rect x="319" y="81" width="46" height="6" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="0.8"/>
    ${knurlBand(320, 81, 44, 6, 2.8, '#FAF0DC', 0.4)}
    <!-- Flared Ocular Cup & Recessed Eye-Lens -->
    <path d="M 314 66 L 370 66 L 365 75 L 319 75 Z" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="1.4"/>
    <line x1="315" y1="67" x2="369" y2="67" stroke="#FFF6DE" stroke-width="0.9" stroke-opacity="0.72"/>
    <ellipse cx="342" cy="66" rx="18" ry="3.2" fill="#06080E" stroke="#E5C07B" stroke-width="0.8"/>
    <ellipse cx="342" cy="65.8" rx="14" ry="2.2" fill="url(#${uid}-lens-glass)"/>

    <!-- Graduated Brushed Silver Draw-Tube -->
    <rect x="327" y="104" width="30" height="36" fill="url(#${uid}-chrome-cyl)" stroke="#090C14" stroke-width="1.3"/>
    <line x1="336" y1="104" x2="336" y2="139" stroke="#FFFFFF" stroke-width="1" stroke-opacity="0.55"/>
    ${tickSeries(356, 108, 356, 134, -5.5, 0, 10, 5, '#090C14', 0.65)}
    <rect x="322" y="135" width="40" height="5.5" rx="1.5" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="1.1"/>

    <!-- Main Brass Optical Body Barrel with Technical Cutaway Window -->
    <rect x="316" y="140" width="52" height="116" rx="2.5" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="1.7"/>
    <!-- Stepped Upper & Lower Knurled Barrel Collars -->
    <rect x="313" y="140" width="58" height="10" rx="2" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="1.3"/>
    ${knurlBand(314, 140.5, 56, 9, 3.0, '#FAF0DC', 0.42)}
    <rect x="313" y="246" width="58" height="10" rx="2" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="1.3"/>
    ${knurlBand(314, 246.5, 56, 9, 3.0, '#FAF0DC', 0.42)}
    <line x1="316" y1="155" x2="368" y2="155" stroke="#090C14" stroke-width="0.9" stroke-opacity="0.6"/>
    <line x1="316" y1="241" x2="368" y2="241" stroke="#090C14" stroke-width="0.9" stroke-opacity="0.6"/>

    <!-- Master Watchmaker Optical Cutaway Aperture -->
    <g>
      <rect x="323" y="159" width="38" height="78" rx="4" fill="#05070C" stroke="url(#${uid}-brass)" stroke-width="1.5"/>
      <rect x="323" y="159" width="38" height="78" rx="4" fill="url(#${uid}-hatch-micro)" opacity="0.55"/>
      <!-- Anti-Reflection Internal Baffle Ridges -->
      <path d="M 323 166 L 327 167.5 L 323 169 M 323 185 L 327 186.5 L 323 188 M 323 206 L 327 207.5 L 323 209 M 323 227 L 327 228.5 L 323 230" fill="none" stroke="#E5C07B" stroke-width="0.7" stroke-opacity="0.55"/>
      <path d="M 361 166 L 357 167.5 L 361 169 M 361 185 L 357 186.5 L 361 188 M 361 206 L 357 207.5 L 361 209 M 361 227 L 357 228.5 L 361 230" fill="none" stroke="#E5C07B" stroke-width="0.7" stroke-opacity="0.55"/>

      <!-- Internal Ray-Trace Paths Crossing at Intermediate Image Plane -->
      <polygon points="335,236 349,236 342,197" fill="${rayHue}" fill-opacity="${isDusk ? 0.24 : 0.16}"/>
      <polygon points="342,197 332,160 352,160" fill="${rayHue}" fill-opacity="${isDusk ? 0.20 : 0.13}"/>
      <line x1="333" y1="236" x2="351" y2="160" stroke="${lensHue}" stroke-width="0.75" stroke-opacity="0.78"/>
      <line x1="351" y1="236" x2="333" y2="160" stroke="${lensHue}" stroke-width="0.75" stroke-opacity="0.78"/>

      <!-- Internal Doublet Achromat Lens (lower, y=219) -->
      <path d="M 327 219 Q 342 213 357 219 Q 342 225 327 219 Z" fill="url(#${uid}-lens-glass)" stroke="${lensHue}" stroke-width="0.85"/>
      <rect x="325" y="217" width="3.5" height="4" fill="url(#${uid}-brass)"/>
      <rect x="355.5" y="217" width="3.5" height="4" fill="url(#${uid}-brass)"/>

      <!-- Internal Field Lens (upper, y=175) -->
      <path d="M 328 175 Q 342 169.5 356 175 Q 342 180.5 328 175 Z" fill="url(#${uid}-lens-glass)" stroke="${lensHue}" stroke-width="0.85"/>
      <rect x="325" y="173" width="3.5" height="4" fill="url(#${uid}-brass)"/>
      <rect x="355.5" y="173" width="3.5" height="4" fill="url(#${uid}-brass)"/>

      <!-- Intermediate Optical Focus Flare -->
      ${starSpark(342, 197, 5, 1.0, '#FFFFFF', 0.88)}
    </g>

    <!-- Revolving Nosepiece Dome, Knurled Collar & 3 Parfocal Objectives -->
    <path d="M 314 256 L 370 256 L 376 268 L 308 268 Z" fill="url(#${uid}-anodize)" stroke="url(#${uid}-brass)" stroke-width="1.3"/>
    <rect x="306" y="268" width="72" height="10" rx="2.5" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="1.3"/>
    ${knurlBand(307, 268.5, 70, 9, 2.8, '#FAF0DC', 0.44)}
    <path d="M 308 278 Q 342 290 376 278 L 368 286 Q 342 294 316 286 Z" fill="url(#${uid}-anodize)" stroke="#E5C07B" stroke-width="1"/>
    <circle cx="342" cy="283" r="2.4" fill="#FAF0DC" stroke="#090C14" stroke-width="0.8"/>

    <!-- Left Objective (Angled +27 deg, Low-Power Wide Brass) -->
    <g transform="rotate(27 342 276)">
      <rect x="333" y="286" width="18" height="6" rx="1" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="1"/>
      ${knurlBand(334, 286.5, 16, 5, 2.6, '#FAF0DC', 0.42)}
      <rect x="334" y="292" width="16" height="17" fill="url(#${uid}-anodize)" stroke="#E5C07B" stroke-width="0.9"/>
      <rect x="334" y="303" width="16" height="2.6" fill="#E5C07B" fill-opacity="0.9"/>
      <path d="M 335 309 L 349 309 L 346.5 317 L 337.5 317 Z" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="1"/>
      <ellipse cx="342" cy="317.5" rx="3.8" ry="1.4" fill="url(#${uid}-lens-glass)"/>
    </g>

    <!-- Right Objective (Angled -27 deg, High-NA Slender Oil-Immersion) -->
    <g transform="rotate(-27 342 276)">
      <rect x="334" y="286" width="16" height="6" rx="1" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="1"/>
      ${knurlBand(335, 286.5, 14, 5, 2.5, '#FAF0DC', 0.42)}
      <rect x="335.5" y="292" width="13" height="20" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="1"/>
      <rect x="335.5" y="306" width="13" height="2.4" fill="${isDusk ? '#A9C9A4' : '#FAF0DC'}" fill-opacity="0.9"/>
      <path d="M 336 312 L 348 312 L 345 324 L 339 324 Z" fill="url(#${uid}-chrome-cyl)" stroke="#090C14" stroke-width="0.9"/>
      <ellipse cx="342" cy="324.5" rx="2.6" ry="1.1" fill="url(#${uid}-lens-glass)"/>
    </g>

    <!-- Center Active Objective (Engaged over Slide at X=342) -->
    <g>
      <rect x="331" y="285" width="22" height="6.5" rx="1" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="1.1"/>
      ${knurlBand(332, 285.5, 20, 5.5, 2.5, '#FAF0DC', 0.45)}
      <rect x="332.5" y="291.5" width="19" height="19" fill="url(#${uid}-brass-cyl)" stroke="#090C14" stroke-width="1.2"/>
      <rect x="332.5" y="304.5" width="19" height="3.2" fill="${bandHue}" fill-opacity="0.92"/>
      <path d="M 333.5 310.5 L 350.5 310.5 L 347.5 326 L 336.5 326 Z" fill="url(#${uid}-chrome-cyl)" stroke="#090C14" stroke-width="1.1"/>
      <ellipse cx="342" cy="326.5" rx="4.2" ry="1.6" fill="url(#${uid}-lens-glass)" stroke="#FAF0DC" stroke-width="0.5"/>
      <!-- Converging Light Coupling from Coverslip into Front Lens -->
      <polygon points="338,327 346,327 343.5,335 340.5,335" fill="${rayHue}" fill-opacity="${isDusk ? 0.55 : 0.36}"/>
    </g>
  </g>
</svg>`;
}

function genAtmosSelenograph(mode = 'night') {
  const uid = `seleno-${mode}`;
  const isDusk = mode === 'dusk';
  // Synodic Clockwork Planetary Orrery (Night: copperplate mechanics; Dusk: warm gilded + pulsar jet accents)
  const phases = [];
  for (let i = 0; i < 8; i++) {
    const deg = i * 45 - 90;
    const [mx, my] = polar(300, 300, 178, deg);
    const r = 17;
    phases.push(`<circle cx="${f(mx)}" cy="${f(my)}" r="${r}" fill="#080B12" stroke="url(#${uid}-brass)" stroke-width="1.6"/>`);
    // Lit lunar hemisphere progression
    if (i === 0) {
      phases.push(`<circle cx="${f(mx)}" cy="${f(my)}" r="${r - 2}" fill="#FAF0DC" fill-opacity="0.9"/>`);
    } else if (i !== 4) {
      const sgn = i < 4 ? 1 : -1;
      phases.push(`<path d="M ${f(mx)} ${f(my - r + 2)} A ${r - 2} ${r - 2} 0 0 ${sgn > 0 ? 1 : 0} ${f(mx)} ${f(my + r - 2)} A ${(r - 2) * 0.4} ${r - 2} 0 0 ${i === 2 || i === 6 ? (sgn > 0 ? 1 : 0) : (sgn > 0 ? 0 : 1)} ${f(mx)} ${f(my - r + 2)} Z" fill="#E5C07B" fill-opacity="0.82"/>`);
    }
  }
  const gearCenter = spurGearPath(300, 300, 32, 92, 81, 46, 0);
  const gearEpicycle = spurGearPath(412, 235, 16, 38, 31, 10, 12);

  const jetExtra = isDusk ? `
    <g transform="rotate(-34 300 300)" opacity="0.72">
      <polygon points="282,40 300,260 318,40" fill="url(#${uid}-glow-cyan)"/>
      <polygon points="282,560 300,340 318,560" fill="url(#${uid}-glow-cyan)"/>
      <line x1="300" y1="36" x2="300" y2="564" stroke="#8FBFE0" stroke-width="1.8" stroke-dasharray="8 4"/>
    </g>
  ` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  ${baseDefs(uid)}
  <circle cx="300" cy="300" r="275" fill="url(#${uid}-glow-${isDusk ? 'ember' : 'brass'})"/>
  ${jetExtra}
  <!-- Outer Epicyclic Dial Rings -->
  <circle cx="300" cy="300" r="248" fill="none" stroke="url(#${uid}-brass)" stroke-width="2.6"/>
  <circle cx="300" cy="300" r="228" fill="none" stroke="#E5C07B" stroke-width="1" stroke-opacity="0.5"/>
  <circle cx="300" cy="300" r="178" fill="none" stroke="#8FBFE0" stroke-width="1.15" stroke-opacity="0.48" stroke-dasharray="4 4"/>
  <circle cx="300" cy="300" r="126" fill="none" stroke="#E5C07B" stroke-width="1" stroke-opacity="0.55"/>
  ${degreeRing(300, 300, 246, 230, 3, 15, 45, '#E5C07B', 0.72)}
  ${cardinalCrosshairs(300, 300, 212, 266, '#E5C07B', 0.58)}
  ${starField(300, 300, 195, 270, 28, 318, ['#F2EDE3', '#E5C07B', '#8FBFE0'])}

  <!-- Inclined Elliptical Nodal Plane -->
  <ellipse cx="300" cy="300" rx="218" ry="82" transform="rotate(-24 300 300)" fill="none" stroke="#E5C07B" stroke-width="1.3" stroke-opacity="0.62"/>
  <ellipse cx="300" cy="300" rx="218" ry="82" transform="rotate(66 300 300)" fill="none" stroke="#8FBFE0" stroke-width="0.9" stroke-opacity="0.4" stroke-dasharray="3 4"/>

  <!-- Clockwork Sun-Earth Epicycle Gears -->
  <path d="${gearCenter}" fill="url(#${uid}-brass)" fill-opacity="0.45" fill-rule="evenodd" stroke="#E5C07B" stroke-width="1.2"/>
  <path d="${gearEpicycle}" fill="url(#${uid}-silver)" fill-opacity="0.55" fill-rule="evenodd" stroke="#FAF0DC" stroke-width="1"/>
  <line x1="300" y1="300" x2="412" y2="235" stroke="url(#${uid}-brass)" stroke-width="4" stroke-linecap="round"/>

  <!-- Synodic Moon Phase Nodes -->
  <g>${phases.join('')}</g>

  <!-- Central Gilded Heliocentric Core -->
  <circle cx="300" cy="300" r="36" fill="url(#${uid}-glow-ember)" stroke="url(#${uid}-brass)" stroke-width="2.4"/>
  <circle cx="300" cy="300" r="18" fill="url(#${uid}-brass)"/>
  ${starSpark(300, 300, 28, 4.5, '#FAF0DC', 0.92)}
</svg>`;
}

function genAtmosInstrument(mode = 'night') {
  const uid = `inst-${mode}`;
  const isDusk = mode === 'dusk';
  const lensTint = isDusk ? '#8FBFE0' : '#E5C07B';
  // Intricate Engraved Brass Equatorial Refractor Telescope + Declination Setting Circles
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  ${baseDefs(uid)}
  <circle cx="300" cy="300" r="275" fill="url(#${uid}-glow-${isDusk ? 'cyan' : 'brass'})"/>
  ${isDusk ? '<path d="M 105 490 A 225 225 0 0 1 495 490" fill="none" stroke="#8FBFE0" stroke-width="1.15" stroke-opacity="0.34" stroke-dasharray="6 4"/>' : ''}
  <circle cx="300" cy="300" r="248" fill="none" stroke="#E5C07B" stroke-width="0.85" stroke-opacity="0.45"/>
  <circle cx="300" cy="300" r="228" fill="none" stroke="${lensTint}" stroke-width="0.7" stroke-opacity="0.30" stroke-dasharray="4 5"/>
  ${degreeRing(300, 300, 248, 235, 5, 15, 45, '#E5C07B', 0.56)}
  ${starField(300, 300, 60, 272, 34, isDusk ? 892 : 882, ['#F2EDE3', '#E5C07B', '#8FBFE0'])}

  <!-- Cast-Iron Observatory Tripod Pillar & Foot Claws -->
  <line x1="278" y1="315" x2="188" y2="544" stroke="url(#${uid}-brass)" stroke-width="9" stroke-linecap="round"/>
  <line x1="296" y1="315" x2="296" y2="552" stroke="url(#${uid}-brass-v)" stroke-width="8" stroke-linecap="round"/>
  <line x1="314" y1="315" x2="408" y2="544" stroke="url(#${uid}-brass)" stroke-width="9" stroke-linecap="round"/>
  <path d="M 225 445 L 368 445 M 296 315 L 296 445" stroke="#E5C07B" stroke-width="3" stroke-opacity="0.75"/>
  <circle cx="296" cy="445" r="14" fill="#0B0F1A" stroke="url(#${uid}-brass)" stroke-width="2.6"/>

  <!-- Equatorial German Mount Head, Clock Drive & Declination Circles -->
  <rect x="268" y="246" width="56" height="72" rx="8" fill="url(#${uid}-dark-metal)" stroke="url(#${uid}-brass)" stroke-width="2.8"/>
  <circle cx="296" cy="242" r="46" fill="none" stroke="url(#${uid}-brass)" stroke-width="3.2"/>
  ${degreeRing(296, 242, 46, 37, 15, 45, 90, '#FAF0DC', 0.85)}
  <!-- Counterweight Shaft & Brass Weight -->
  <line x1="296" y1="242" x2="365" y2="338" stroke="url(#${uid}-silver)" stroke-width="4.5" stroke-linecap="round"/>
  <rect x="336" y="302" width="38" height="28" rx="5" transform="rotate(54 355 316)" fill="url(#${uid}-brass-h)" stroke="#090C14" stroke-width="1.6"/>

  <!-- Optical Sightline Ray & Target Star -->
  <line x1="485" y1="115" x2="112" y2="270" stroke="#8FBFE0" stroke-width="1.2" stroke-dasharray="6 4" stroke-opacity="0.62"/>
  ${starSpark(502, 108, 22, 4.2, isDusk ? '#8FBFE0' : '#FAF0DC', 0.95)}

  <!-- Primary Brass Refractor OTA & Finder Scope (-22deg elevation) -->
  <g transform="rotate(-22 296 205)">
    <rect x="138" y="182" width="318" height="44" rx="4" fill="url(#${uid}-brass-v)" stroke="#090C14" stroke-width="2"/>
    <rect x="436" y="176" width="66" height="56" rx="3" fill="url(#${uid}-dark-metal)" stroke="url(#${uid}-brass)" stroke-width="3"/>
    <ellipse cx="502" cy="204" rx="7" ry="26" fill="${lensTint}" fill-opacity="0.52" stroke="#FAF0DC" stroke-width="1.2"/>
    <rect x="262" y="178" width="16" height="52" rx="2" fill="url(#${uid}-dark-metal)" stroke="url(#${uid}-brass)" stroke-width="2"/>
    <rect x="322" y="178" width="16" height="52" rx="2" fill="url(#${uid}-dark-metal)" stroke="url(#${uid}-brass)" stroke-width="2"/>
    <rect x="86" y="191" width="52" height="26" rx="2" fill="url(#${uid}-silver)" stroke="#090C14" stroke-width="1.4"/>
    <rect x="64" y="196" width="24" height="16" rx="2" fill="url(#${uid}-brass-h)"/>
    <line x1="205" y1="182" x2="205" y2="162" stroke="#E5C07B" stroke-width="3"/>
    <line x1="275" y1="182" x2="275" y2="162" stroke="#E5C07B" stroke-width="3"/>
    <rect x="165" y="150" width="138" height="14" rx="2" fill="url(#${uid}-dark-metal)" stroke="url(#${uid}-brass)" stroke-width="1.6"/>
  </g>
</svg>`;
}

function genAtmosLunar(mode = 'night') {
  const uid = `lunar-${mode}`;
  const isDusk = mode === 'dusk';
  const rnd = mulberry32(isDusk ? 914 : 906);
  const cx = 300, cy = 300, R = 186;

  // Textured procedural impact craters + central peaks
  const craters = [
    { x: 252, y: 245, r: 28, pk: true }, { x: 356, y: 272, r: 22, pk: true },
    { x: 294, y: 396, r: 32, pk: true }, // Tycho
    { x: 232, y: 336, r: 19, pk: false }, { x: 374, y: 356, r: 24, pk: false },
    { x: 328, y: 200, r: 16, pk: false }, { x: 210, y: 280, r: 14, pk: false },
    { x: 404, y: 295, r: 15, pk: false }, { x: 278, y: 315, r: 13, pk: false },
    { x: 344, y: 416, r: 17, pk: false }, { x: 205, y: 205, r: 11, pk: false },
    { x: 416, y: 232, r: 12, pk: false },
  ];
  for (let i = 0; i < 24; i++) {
    const ang = rnd() * TAU;
    const rad = Math.sqrt(rnd()) * (R - 22);
    craters.push({ x: cx + rad * Math.cos(ang), y: cy + rad * Math.sin(ang), r: 3.5 + rnd() * 6, pk: false });
  }
  const craterMarkup = craters.map(c =>
    `<circle cx="${f(c.x, 1)}" cy="${f(c.y, 1)}" r="${f(c.r, 1)}" fill="#070910" fill-opacity="0.45" stroke="#FAF0DC" stroke-width="${c.r > 18 ? 1.55 : 0.9}" stroke-opacity="${isDusk ? 0.65 : 0.72}"/>` +
    (c.pk ? `<circle cx="${f(c.x, 1)}" cy="${f(c.y, 1)}" r="${f(c.r * 0.2, 1)}" fill="#E5C07B" fill-opacity="0.88"/>` : '')
  ).join('');

  const tychoRays = Array.from({ length: 14 }, (_, i) => {
    const a = -2.4 + i * 0.36;
    const tx2 = 294 + Math.cos(a) * 190;
    const ty2 = 396 + Math.sin(a) * 190;
    return `<line x1="294" y1="396" x2="${f(tx2)}" y2="${f(ty2)}" stroke="#FAF0DC" stroke-width="0.85" stroke-opacity="0.34" stroke-dasharray="8 6"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  ${baseDefs(uid, `
    <radialGradient id="${uid}-moon" cx="35%" cy="32%" r="68%">
      <stop offset="0%" stop-color="${isDusk ? '#F2EDE3' : '#C9BEA7'}"/>
      <stop offset="48%" stop-color="${isDusk ? '#BFA980' : '#6A655D'}"/>
      <stop offset="86%" stop-color="${isDusk ? '#4A433C' : '#24252E'}"/>
      <stop offset="100%" stop-color="#080A12"/>
    </radialGradient>
    <radialGradient id="${uid}-term" cx="26%" cy="28%" r="74%">
      <stop offset="0%" stop-color="#06070A" stop-opacity="0"/>
      <stop offset="52%" stop-color="#06070A" stop-opacity="0.16"/>
      <stop offset="80%" stop-color="#06070A" stop-opacity="0.78"/>
      <stop offset="100%" stop-color="#06070A" stop-opacity="0.92"/>
    </radialGradient>
    <clipPath id="${uid}-clip"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>
  `)}
  <circle cx="300" cy="300" r="275" fill="url(#${uid}-glow-${isDusk ? 'brass' : 'cyan'})"/>
  <!-- Outer Lunar Orbital & Azimuth Astrolabe -->
  <circle cx="300" cy="300" r="250" fill="none" stroke="url(#${uid}-brass)" stroke-width="2.4"/>
  <circle cx="300" cy="300" r="224" fill="none" stroke="#E5C07B" stroke-width="0.95" stroke-opacity="0.56"/>
  <ellipse cx="300" cy="300" rx="258" ry="88" transform="rotate(-24 300 300)" fill="none" stroke="#E5C07B" stroke-width="1.25" stroke-opacity="0.62"/>
  <ellipse cx="300" cy="300" rx="242" ry="70" transform="rotate(32 300 300)" fill="none" stroke="#8FBFE0" stroke-width="1" stroke-opacity="0.48" stroke-dasharray="4 4"/>
  ${degreeRing(300, 300, 250, 236, 5, 15, 45, '#E5C07B', 0.78)}
  ${starField(300, 300, 200, 282, 26, 910, ['#F2EDE3', '#E5C07B', '#8FBFE0'])}

  <!-- Lunar Selenograph Globe -->
  <circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#${uid}-moon)" stroke="url(#${uid}-brass)" stroke-width="2.6"/>
  <g clip-path="url(#${uid}-clip)">
    <path d="M 190 190 Q 260 155 320 205 Q 355 245 305 295 Q 245 315 195 265 Z" fill="#0B0E17" fill-opacity="0.45"/>
    <path d="M 330 220 Q 425 215 445 300 Q 415 365 345 340 Q 305 280 330 220 Z" fill="#0B0E17" fill-opacity="0.42"/>
    <ellipse cx="300" cy="300" rx="186" ry="52" transform="rotate(-18 300 300)" fill="none" stroke="#E5C07B" stroke-width="0.75" stroke-opacity="0.38" stroke-dasharray="3 3"/>
    <ellipse cx="300" cy="300" rx="72" ry="186" transform="rotate(-18 300 300)" fill="none" stroke="#E5C07B" stroke-width="0.75" stroke-opacity="0.38" stroke-dasharray="3 3"/>
    ${tychoRays}
    ${craterMarkup}
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#${uid}-term)"/>
  </g>
</svg>`;
}

function genAtmosArmillary() {
  const uid = 'armillary';
  const cx = 300, cy = 300;
  // Detailed Engraved Ptolemaic / Brahe Celestial Armillary Sphere (Boot / Auxiliary)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  ${baseDefs(uid)}
  <circle cx="300" cy="300" r="270" fill="url(#${uid}-glow-brass)"/>
  <!-- Pedestal Column & Finial -->
  <path d="M 278 465 L 322 465 L 336 530 L 385 552 L 215 552 L 264 530 Z" fill="url(#${uid}-brass-h)" stroke="#090C14" stroke-width="2"/>
  <path d="M 294 62 L 306 62 L 300 38 Z" fill="url(#${uid}-brass)"/>
  <!-- Prime Meridian & Outer Horizon Ring -->
  <circle cx="${cx}" cy="${cy - 18}" r="184" fill="#080B13" fill-opacity="0.75" stroke="url(#${uid}-brass)" stroke-width="8"/>
  <circle cx="${cx}" cy="${cy - 18}" r="168" fill="none" stroke="#E5C07B" stroke-width="1" stroke-opacity="0.6"/>
  ${degreeRing(cx, cy - 18, 184, 172, 6, 30, 90, '#FAF0DC', 0.8)}
  <!-- Polar Axis Inclined 23.5deg -->
  <line x1="224" y1="452" x2="376" y2="112" stroke="url(#${uid}-brass)" stroke-width="4.5" stroke-linecap="round"/>
  <!-- Horizon Table & Interlocking Celestial Rings -->
  <ellipse cx="${cx}" cy="${cy - 18}" rx="196" ry="38" fill="none" stroke="url(#${uid}-brass)" stroke-width="6"/>
  <ellipse cx="${cx}" cy="${cy - 18}" rx="176" ry="44" transform="rotate(-24 300 282)" fill="none" stroke="#FAF0DC" stroke-width="4.2" stroke-opacity="0.82"/>
  <ellipse cx="${cx}" cy="${cy - 18}" rx="152" ry="52" transform="rotate(42 300 282)" fill="none" stroke="url(#${uid}-brass)" stroke-width="3.6"/>
  <ellipse cx="${cx}" cy="${cy - 18}" rx="56" ry="164" transform="rotate(24 300 282)" fill="none" stroke="#8FBFE0" stroke-width="1.6" stroke-opacity="0.62"/>
  <ellipse cx="${cx}" cy="${cy - 18}" rx="122" ry="122" fill="none" stroke="#E5C07B" stroke-width="1.3" stroke-opacity="0.52" stroke-dasharray="4 3"/>
  <!-- Zodiac Ecliptic Band -->
  <ellipse cx="${cx}" cy="${cy - 18}" rx="166" ry="30" transform="rotate(-23.5 300 282)" fill="none" stroke="url(#${uid}-brass)" stroke-width="12" stroke-opacity="0.72"/>
  <!-- Heliocentric Center Orb -->
  <circle cx="${cx}" cy="${cy - 18}" r="24" fill="url(#${uid}-brass)" stroke="#FAF0DC" stroke-width="1.8"/>
  ${starSpark(cx, cy - 18, 32, 5, '#FAF0DC', 0.9)}
</svg>`;
}

export const PROCEDURAL_PLATES = {
  'specimen-phys-chladni.svg': genSpecimenPhysChladni,
  'specimen-chem-dendrite.svg': genSpecimenChemDendrite,
  'specimen-math-nautilus.svg': genSpecimenMathNautilus,
  'specimen-phys-corona.svg': genSpecimenPhysCorona,
  'specimen-iris.svg': genSpecimenIris,
  'specimen-heliometer.svg': genSpecimenHeliometer,
  'specimen-botanical.svg': genSpecimenBotanical,

  'folio-vi-constellation.svg': genFolioConstellation,
  'folio-vii-regulator.svg': genFolioRegulator,

  'atmos-ii-instrument-night.svg': () => genAtmosInstrument('night'),
  'atmos-ii-instrument-dusk.svg': () => genAtmosInstrument('dusk'),
  'atmos-iii-lunar-night.svg': () => genAtmosLunar('night'),
  'atmos-iii-lunar-dusk.svg': () => genAtmosLunar('dusk'),
  'atmos-iv-microscope-night.svg': () => genAtmosMicroscope('night'),
  'atmos-iv-microscope-dusk.svg': () => genAtmosMicroscope('dusk'),
  'atmos-v-sextant-night.svg': () => genAtmosSextant('night'),
  'atmos-v-sextant-dusk.svg': () => genAtmosSextant('dusk'),
  'atmos-vi-selenograph-night.svg': () => genAtmosSelenograph('night'),
  'atmos-vi-selenograph-dusk.svg': () => genAtmosSelenograph('dusk'),
  'atmos-v-armillary.svg': genAtmosArmillary,
};
