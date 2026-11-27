/**
 * chapter-galaxy.js — Astrolabe Galaxy Chapter Navigator for #practice-chapters-view.
 *
 * Hybrid Option C architecture:
 *   - Default lens: Constellations (by Syllabus Unit) for durable spatial memory
 *   - Secondary lens: Urgency Orrery (concentric rings by priority/health)
 *   - Critically damped spring morph between lenses; star positions stay stable
 *     while ambient orbital rings & satellite moons revolve smoothly
 *   - 2.5D High-DPI HTML5 Canvas + zero-thrash DOM label/HUD overlay
 *   - Interruptible radial warp transition into/out of #practice-question-list-view
 *
 * Node-safe: pure exports work in Node smoke/unit tests with zero DOM globals.
 */

import { resolveChapterWeight } from './chapter-weights.js';

// ── Storage Keys & Constants ────────────────────────────────────────────────
const VIEW_STORAGE_KEY = 'jeemax_chapters_view';
const LENS_STORAGE_KEY = 'jeemax_chapters_lens';
const WORLD_RADIUS = 400;

const ABBREV_MAP = {
    'rotational mechanics': 'Rotational M.',
    'rotational motion': 'Rotational M.',
    'electrostatics': 'Electrostatics',
    'current electricity': 'Current Elec.',
    'electromagnetic induction': 'EMI',
    'alternating current': 'Alt. Current',
    'magnetic effects of current': 'Magnetic Eff.',
    'geometrical optics': 'Ray Optics',
    'wave optics': 'Wave Optics',
    'modern physics': 'Modern Phy.',
    'dual nature of matter and radiation': 'Dual Nature',
    'atoms and nuclei': 'Atoms & Nuclei',
    'kinetic theory of gases': 'KTG',
    'work power and energy': 'Work & Energy',
    'laws of motion': 'Laws of Motion',
    'mechanical properties of solids': 'Solids',
    'mechanical properties of fluids': 'Fluids',
    'thermal properties of matter': 'Thermal Prop.',
    'units and dimensions': 'Units & Dim.',
    'experimental physics': 'Exp. Physics',
    'communication systems': 'Comm. Sys.',
    'general organic chemistry': 'GOC',
    'coordination compounds': 'Coordination',
    'chemical bonding': 'Chem. Bonding',
    'd and f block': 'd & f Block',
    'qualitative analysis': 'Salt Analysis',
    'chemical equilibrium': 'Chem. Equil.',
    'ionic equilibrium': 'Ionic Equil.',
    'electrochemistry': 'Electrochem.',
    'chemical kinetics': 'Chem. Kinetics',
    'haloalkanes and haloarenes': 'Haloalkanes',
    'alcohols phenols and ethers': 'Alcohols/Eth.',
    'aldehydes and ketones': 'Aldehydes',
    'carboxylic acids': 'Carboxylic',
    'chemistry in everyday life': 'Everyday Chem.',
    'classification of elements': 'Periodicity',
    'environmental chemistry': 'Env. Chem.',
    'reaction mechanism': 'Rxn Mech.',
    'definite integration': 'Definite Int.',
    'definite integrals': 'Definite Int.',
    'indefinite integration': 'Indef. Int.',
    'vectors and 3d': 'Vectors & 3D',
    'three dimensional geometry': '3D Geometry',
    'matrices and determinants': 'Matrices/Det.',
    'permutations and combinations': 'P & C',
    'quadratic equations': 'Quadratics',
    'sequences and series': 'Seq. & Series',
    'conic sections': 'Conics',
    'limits continuity and differentiability': 'Limits & Cont.',
    'application of derivatives': 'AOD',
    'inverse trigonometric functions': 'Inverse Trig',
    'trigonometric ratios and identities': 'Trig Ratios',
    'trigonometric equations': 'Trig Eq.',
    'solution of triangles': 'Sol. Triangles',
    'mathematical reasoning': 'Math Reason.',
    'sets relations and functions': 'Sets & Rel.',
    'differential equations': 'Diff. Eq.',
    'area under curves': 'Area Curves',
    'heights and distances': 'Heights/Dist.',
};

const UNIT_DEFS = {
    physics: [
        { id: 'mechanics', label: 'Mechanics', order: 0, re: /\b(kinematics|laws of motion|nlm|friction|work|power|energy|rotat|torque|inertia|angular|gravitation|solid|elastic|fluid|hydro|bernoulli|surface tension|viscosity|unit|dimension|error|measurement|vector|experimental|center of mass|centre of mass|collision|momentum|circular)/ },
        { id: 'electrodynamics', label: 'Electrodynamics', order: 1, re: /\b(electrostat|gauss|capacit|current|circuit|kirchhoff|ohm|magnet|magnetostat|biot|ampere|emi|electromagnetic induction|faraday|lenz|alternating current|\bac\b|lcr|transformer)/ },
        { id: 'optics', label: 'Optics', order: 2, re: /\b(optic|ray|lens|mirror|refract|reflect|prism|wave optics|interference|ydse|diffract|polariz)/ },
        { id: 'thermal', label: 'Thermal', order: 3, re: /\b(thermo|heat|calorimet|ktg|kinetic theory|gas|thermal|expansion|conduction|radiation|carnot|entropy)/ },
        { id: 'waves', label: 'Waves & SHM', order: 4, re: /\b(oscillat|shm|simple harmonic|pendulum|wave|sound|doppler|standing wave|organ pipe)/ },
        { id: 'modern', label: 'Modern', order: 5, re: /\b(modern|dual nature|photoelectric|de broglie|atom|bohr|nucle|radioactiv|semiconductor|diode|transistor|logic gate|communication|x ray)/ },
    ],
    chemistry: [
        { id: 'physical', label: 'Physical', order: 0, re: /\b(mole|stoich|atomic structure|quantum|thermo|thermochem|equilib|ionic|ph\b|buffer|electrochem|nernst|kinetics|arrhenius|solution|colligative|solid state|redox|gaseous|ideal gas|real gas|surface|adsorption|nuclear chem)/ },
        { id: 'organic', label: 'Organic', order: 1, re: /\b(goc|general organic|organic|isomer|stereo|chiral|reaction mech|hydrocarbon|alkane|alkene|alkyne|aromatic|benzene|haloalkane|haloarene|alcohol|phenol|ether|aldehyde|ketone|carboxylic|amine|diazonium|biomolec|polymer|everyday|iupac)/ },
        { id: 'inorganic', label: 'Inorganic', order: 2, re: /\b(periodic|classification|bonding|vsepr|mot\b|hydrogen|s block|p block|d and f|d f block|f block|transition|coordinat|ligand|cft|metallurg|qualitative|salt analysis|environment)/ },
    ],
    maths: [
        { id: 'calculus', label: 'Calculus', order: 0, re: /\b(function|limit|continuit|differentiab|differentiat|derivativ|aod|monoton|maxima|minima|tangent|integrat|definite|indefinite|area under|auc|differential eq)/ },
        { id: 'algebra', label: 'Algebra', order: 1, re: /\b(quadratic|theory of eq|complex|argand|sequence|series|progression|ap\b|gp\b|permutat|combinat|pnc|binomial|probabilit|bayes|matri|determinant|sets|relation|statistic|variance|reasoning|logarithm|inequalit)/ },
        { id: 'coordinate', label: 'Coordinate', order: 2, re: /\b(straight line|pair of lines|circle|conic|parabol|ellips|hyperbol|coordinate|locus)/ },
        { id: 'vectors3d', label: 'Vectors & 3D', order: 3, re: /\b(vector|3d|three dimension|direction cosin|plane|skew line)/ },
        { id: 'trigonometry', label: 'Trigonometry', order: 4, re: /\b(trig|triangle|heights and dist|sine rule|cosine rule)/ },
    ],
};

// ── Pure Helpers (exported for Node tests) ──────────────────────────────────

function _escHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function _normText(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function _normSubj(s) {
    const k = String(s || '').toLowerCase().trim();
    if (k === 'math' || k === 'mathematics') return 'maths';
    if (k === 'chem') return 'chemistry';
    if (k === 'phys') return 'physics';
    return k || 'physics';
}

function _hashStr(s) {
    let h = 2166136261 >>> 0;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/**
 * Deterministic unit classification for a chapter within a subject.
 */
export function classifyChapterUnit(subject, chapterName, isMock = false, weightMaps = null) {
    if (isMock) return { id: 'mocks', label: 'Transits', order: 99 };
    const subj = _normSubj(subject);
    const defs = UNIT_DEFS[subj] || [];
    const rawNorm = _normText(chapterName);
    let resolvedMatched = '';
    try {
        const res = resolveChapterWeight(chapterName, weightMaps || undefined);
        if (res && res.matched) resolvedMatched = _normText(res.matched);
    } catch (_) {}
    const probe = `${rawNorm} ${resolvedMatched}`.trim();
    for (const d of defs) {
        if (d.re.test(probe)) {
            return { id: d.id, label: d.label, order: d.order };
        }
    }
    return { id: 'uncharted', label: 'Uncharted', order: 50 };
}

/**
 * JEE-friendly concise chapter name abbreviator for dense viewports.
 */
export function abbreviateChapterName(name, maxLen = 14) {
    const raw = String(name || '').trim();
    if (!raw) return '';
    if (raw.length <= maxLen) return raw;
    const nk = _normText(raw);
    if (ABBREV_MAP[nk]) return ABBREV_MAP[nk];

    // Strip common filler words first before truncating
    const compact = raw
        .replace(/\b(and|of|the|in|for|with|to)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (compact.length <= maxLen) return compact;
    return compact.slice(0, Math.max(4, maxLen - 1)).trimEnd() + '…';
}

/**
 * Apple WWDC momentum projection: where a flick will come to rest.
 */
export function projectMomentum(velocityPxPerSec, decelerationRate = 0.992) {
    const d = Math.max(0.9, Math.min(0.999, Number(decelerationRate) || 0.992));
    return (Number(velocityPxPerSec || 0) / 1000) * d / (1 - d);
}

/**
 * Apple-style rubber-band damping past soft bounds.
 */
export function rubberband(overshoot, dimension, constant = 0.55) {
    const dim = Math.max(1, Math.abs(dimension || 1));
    return (overshoot * dim * constant) / (dim + constant * Math.abs(overshoot));
}

function _buildSectorMST(nodes) {
    const n = nodes.length;
    if (n <= 1) return [];
    const edges = [];
    const inTree = new Array(n).fill(false);
    const edgeSet = new Set();
    inTree[0] = true;

    for (let step = 0; step < n - 1; step++) {
        let bestU = -1, bestV = -1, bestD = Infinity;
        for (let i = 0; i < n; i++) {
            if (!inTree[i]) continue;
            for (let j = 0; j < n; j++) {
                if (inTree[j]) continue;
                const dx = nodes[i].x - nodes[j].x;
                const dy = nodes[i].y - nodes[j].y;
                const d = dx * dx + dy * dy;
                if (d < bestD) {
                    bestD = d;
                    bestU = i;
                    bestV = j;
                }
            }
        }
        if (bestU >= 0 && bestV >= 0) {
            inTree[bestV] = true;
            const a = Math.min(bestU, bestV);
            const b = Math.max(bestU, bestV);
            edgeSet.add(`${a}:${b}`);
            edges.push({ from: nodes[bestU].key, to: nodes[bestV].key, unitId: nodes[bestU].unitId });
        }
    }

    // Add 1 subtle astronomical closed loop chord for 4+ star constellations
    if (n >= 4) {
        let bestU = -1, bestV = -1, bestD = Infinity;
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                if (edgeSet.has(`${i}:${j}`)) continue;
                const dx = nodes[i].x - nodes[j].x;
                const dy = nodes[i].y - nodes[j].y;
                const d = Math.hypot(dx, dy);
                if (d < bestD && d < 240) {
                    bestD = d;
                    bestU = i;
                    bestV = j;
                }
            }
        }
        if (bestU >= 0) {
            edges.push({ from: nodes[bestU].key, to: nodes[bestV].key, unitId: nodes[bestU].unitId, chord: true });
        }
    }
    return edges;
}

/**
 * Pure deterministic layout for Option C's default Constellations lens.
 */
export function computeConstellationLayout(chapters, subject, opts = {}) {
    const aspect = Number.isFinite(opts.aspect) ? Math.max(0.75, Math.min(1.45, opts.aspect)) : 1.18;
    const R = opts.radius || WORLD_RADIUS;
    const list = Array.isArray(chapters) ? chapters : [];
    const positions = new Map();
    const edges = [];
    const sectors = [];

    if (!list.length) return { positions, edges, sectors, bounds: { rx: R * aspect, ry: R } };

    const groups = new Map();
    const mocks = [];

    for (const ch of list) {
        const key = String(ch.key || ch.name || '').trim().toLowerCase();
        const unit = ch.unit || classifyChapterUnit(subject, ch.name, !!ch.isMock, ch.weightMaps);
        if (unit.id === 'mocks') {
            mocks.push({ ch, key, unit });
        } else {
            if (!groups.has(unit.id)) {
                groups.set(unit.id, { id: unit.id, label: unit.label, order: unit.order, items: [] });
            }
            groups.get(unit.id).items.push({ ch, key, unit });
        }
    }

    const activeGroups = Array.from(groups.values()).sort((a, b) => a.order - b.order);
    const totalWeightSpan = activeGroups.reduce((acc, g) => acc + Math.max(1.45, Math.sqrt(g.items.length)), 0) || 1;

    // Start at -135 deg so Mechanics/Physical/Calculus sits cleanly upper-left
    let angleCursor = -Math.PI * 0.78;
    const allNodes = [];
    const sectorMeta = new Map();

    for (const g of activeGroups) {
        const span = (Math.max(1.45, Math.sqrt(g.items.length)) / totalWeightSpan) * Math.PI * 2;
        const pad = Math.min(0.14, span * 0.12);
        const aStart = angleCursor + pad;
        const aEnd = angleCursor + span - pad;
        const aMid = (angleCursor + angleCursor + span) * 0.5;
        angleCursor += span;

        // Deterministic sort inside sector: highest weightage first, then alphabetical
        g.items.sort((a, b) => {
            const dw = (b.ch.weight || 0.5) - (a.ch.weight || 0.5);
            if (Math.abs(dw) > 0.01) return dw;
            return String(a.ch.name).localeCompare(String(b.ch.name));
        });

        const n = g.items.length;
        const placed = [];
        for (let i = 0; i < n; i++) {
            const item = g.items[i];
            const t = n === 1 ? 0.5 : i / (n - 1);
            // Golden-ratio spiral sweep inside the wedge so stars form natural asterisms
            const radialNorm = n === 1 ? 0.54 : (0.30 + 0.56 * Math.sqrt((i + 0.45) / (n + 0.2)));
            const angleJitter = n === 1 ? 0 : (((i * 0.61803398875) % 1) - 0.5) * 0.85 + (t - 0.5) * 0.25;
            const ang = aMid + Math.max(-0.46, Math.min(0.46, angleJitter)) * Math.max(0.28, aEnd - aStart);
            const r = radialNorm * R * 0.90;
            const node = {
                key: item.key,
                x: Math.cos(ang) * r * aspect,
                y: Math.sin(ang) * r,
                unitId: g.id,
                unitLabel: g.label,
                angMin: aStart,
                angMax: aEnd,
                aMid,
            };
            placed.push(node);
            allNodes.push(node);
        }
        sectorMeta.set(g.id, { id: g.id, label: g.label, nodes: placed, aMid, span });
    }

    // Deterministic pairwise repulsion so 25–30 chapters never bunch up
    const minDist = list.length >= 24 ? 94 : 102;
    const minDistSq = minDist * minDist;
    const maxRx = R * 0.93 * aspect;
    const maxRy = R * 0.93;
    const minR = R * 0.17;

    for (let iter = 0; iter < 24; iter++) {
        for (let i = 0; i < allNodes.length; i++) {
            for (let j = i + 1; j < allNodes.length; j++) {
                const a = allNodes[i];
                const b = allNodes[j];
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let d2 = dx * dx + dy * dy;
                if (d2 < 0.01) {
                    const h = (_hashStr(a.key + b.key) % 360) * (Math.PI / 180);
                    dx = Math.cos(h);
                    dy = Math.sin(h);
                    d2 = 1;
                }
                const targetSq = a.unitId === b.unitId ? minDistSq : minDistSq * 1.18;
                if (d2 < targetSq) {
                    const d = Math.sqrt(d2);
                    const target = Math.sqrt(targetSq);
                    const push = ((target - d) / d) * 0.42;
                    a.x -= dx * push;
                    a.y -= dy * push;
                    b.x += dx * push;
                    b.y += dy * push;
                }
            }
        }
        // Softly contain each node inside the outer ellipse and away from dead center
        for (const node of allNodes) {
            const nx = node.x / maxRx;
            const ny = node.y / maxRy;
            const ell = Math.hypot(nx, ny);
            if (ell > 1) {
                node.x /= ell;
                node.y /= ell;
            }
            const centerD = Math.hypot(node.x, node.y);
            if (centerD < minR && centerD > 0.001) {
                node.x = (node.x / centerD) * minR;
                node.y = (node.y / centerD) * minR;
            }
        }
    }

    for (const g of activeGroups) {
        const meta = sectorMeta.get(g.id);
        const nodes = meta.nodes;
        const sectorEdges = _buildSectorMST(nodes);
        edges.push(...sectorEdges);

        let sx = 0, sy = 0;
        for (const nd of nodes) {
            sx += nd.x;
            sy += nd.y;
            positions.set(nd.key, {
                x: nd.x,
                y: nd.y,
                unitId: nd.unitId,
                unitLabel: nd.unitLabel,
                orbitRadius: Math.hypot(nd.x / aspect, nd.y),
            });
        }
        const cx = sx / Math.max(1, nodes.length);
        const cy = sy / Math.max(1, nodes.length);
        let maxRad = 70;
        for (const nd of nodes) {
            maxRad = Math.max(maxRad, Math.hypot(nd.x - cx, nd.y - cy) + 46);
        }
        sectors.push({
            id: g.id,
            label: g.label,
            cx,
            cy,
            radius: maxRad,
            count: nodes.length,
            angle: meta.aMid,
        });
    }

    // Place mock-test chapters cleanly along an outer comet transit arc (bottom-right)
    if (mocks.length) {
        mocks.sort((a, b) => String(a.ch.name).localeCompare(String(b.ch.name)));
        const mCount = mocks.length;
        const arcCenter = Math.PI * 0.25;
        const arcSpan = Math.min(Math.PI * 0.46, Math.max(0.28, (mCount - 1) * 0.16));
        const rMock = R * 1.01;
        let mxSum = 0, mySum = 0;
        const mockNodes = [];
        for (let i = 0; i < mCount; i++) {
            const ang = mCount === 1 ? arcCenter : arcCenter - arcSpan * 0.5 + (i / (mCount - 1)) * arcSpan;
            const x = Math.cos(ang) * rMock * aspect;
            const y = Math.sin(ang) * rMock;
            const item = mocks[i];
            positions.set(item.key, {
                x, y,
                unitId: 'mocks',
                unitLabel: 'Transits',
                orbitRadius: rMock,
            });
            mockNodes.push({ key: item.key, x, y, unitId: 'mocks' });
            mxSum += x;
            mySum += y;
        }
        if (mockNodes.length > 1) {
            for (let i = 0; i < mockNodes.length - 1; i++) {
                edges.push({ from: mockNodes[i].key, to: mockNodes[i + 1].key, unitId: 'mocks', transit: true });
            }
        }
        sectors.push({
            id: 'mocks',
            label: 'Transits',
            cx: mxSum / mCount,
            cy: mySum / mCount,
            radius: Math.max(80, arcSpan * rMock * 0.55 + 45),
            count: mCount,
            angle: arcCenter,
        });
    }

    return { positions, edges, sectors, bounds: { rx: R * 1.06 * aspect, ry: R * 1.06 } };
}

/**
 * Pure deterministic layout for the Urgency Orrery lens.
 * Inner ring = highest urgency (critical health / low coverage / high weight).
 */
export function computeOrreryLayout(chapters, subject, opts = {}) {
    const aspect = Number.isFinite(opts.aspect) ? Math.max(0.75, Math.min(1.45, opts.aspect)) : 1.12;
    const list = Array.isArray(chapters) ? chapters : [];
    const positions = new Map();
    const mocks = [];
    const regular = [];

    for (const ch of list) {
        const key = String(ch.key || ch.name || '').trim().toLowerCase();
        const unit = ch.unit || classifyChapterUnit(subject, ch.name, !!ch.isMock, ch.weightMaps);
        if (unit.id === 'mocks') {
            mocks.push({ ch, key, unit });
        } else {
            const health = Number.isFinite(ch.health) ? ch.health : 50;
            const doneFrac = Number.isFinite(ch.doneFrac) ? ch.doneFrac : 0;
            const weight = Number.isFinite(ch.weight) ? ch.weight : 0.5;
            const qCount = ch.qCount || 0;
            const dueBoost = Math.min(0.18, (ch.dueErrors || 0) * 0.045);
            const urgency = (1 - health / 100) * 0.52 + (1 - doneFrac) * 0.24 + Math.min(1, weight) * 0.24 + dueBoost + (qCount > 0 ? 0.05 : -0.15);
            regular.push({ ch, key, unit, urgency, health });
        }
    }

    regular.sort((a, b) => {
        if (Math.abs(b.urgency - a.urgency) > 0.001) return b.urgency - a.urgency;
        return String(a.ch.name).localeCompare(String(b.ch.name));
    });

    const ring1 = [];
    const ring2 = [];
    const ring3 = [];
    const total = regular.length;
    const r1Target = Math.min(9, Math.max(2, Math.round(total * 0.28)));
    const r2Target = Math.min(11, Math.max(3, Math.round(total * 0.38)));

    for (let i = 0; i < total; i++) {
        const item = regular[i];
        if (ring1.length < r1Target && (item.health < 55 || i < Math.ceil(total * 0.24))) {
            ring1.push(item);
        } else if (ring2.length < r2Target && item.health < 80) {
            ring2.push(item);
        } else {
            ring3.push(item);
        }
    }

    // Rebalance if Ring 3 absorbed too many while Ring 2 is sparse
    while (ring3.length > 12 && ring2.length < 11) {
        ring2.push(ring3.shift());
    }

    const ringDefs = [
        { id: 'priority', label: 'I · PRIORITY', radius: 152, items: ring1, phase: -Math.PI * 0.5, dashed: false },
        { id: 'active',   label: 'II · ACTIVE',  radius: 262, items: ring2, phase: -Math.PI * 0.35, dashed: false },
        { id: 'stable',   label: 'III · STABLE', radius: 372, items: ring3, phase: -Math.PI * 0.20, dashed: false },
    ];
    if (mocks.length) {
        ringDefs.push({ id: 'transits', label: 'TRANSITS', radius: 432, items: mocks, phase: Math.PI * 0.12, dashed: true });
    }

    const rings = [];
    for (const def of ringDefs) {
        rings.push({ id: def.id, label: def.label, radius: def.radius, dashed: def.dashed, aspect });
        const count = def.items.length;
        if (!count) continue;
        const twin = count > 10;
        for (let i = 0; i < count; i++) {
            const item = def.items[i];
            const ang = def.phase + (i / count) * Math.PI * 2;
            const r = twin ? def.radius + (i % 2 === 0 ? -18 : 18) : def.radius;
            positions.set(item.key, {
                x: Math.cos(ang) * r * aspect,
                y: Math.sin(ang) * r,
                unitId: item.unit.id,
                unitLabel: item.unit.label,
                ringId: def.id,
                orbitRadius: r,
            });
        }
    }

    const maxR = mocks.length ? 448 : 395;
    return { positions, edges: [], sectors: [], rings, bounds: { rx: maxR * aspect, ry: maxR } };
}

/**
 * Greedy 8-slot AABB label collision resolver.
 * Guarantees zero overlap between visible labels and avoids star cores.
 */
export function resolveLabelCollisions(items, viewportRect, safeInsets = {}) {
    const W = Math.max(1, viewportRect && viewportRect.width ? viewportRect.width : 800);
    const H = Math.max(1, viewportRect && viewportRect.height ? viewportRect.height : 600);
    const padL = safeInsets.left ?? 14;
    const padR = safeInsets.right ?? 14;
    const padT = safeInsets.top ?? 58;
    const padB = safeInsets.bottom ?? 64;

    const sorted = (Array.isArray(items) ? items : []).slice().sort((a, b) => {
        const fa = a.forceVisible ? 1 : 0;
        const fb = b.forceVisible ? 1 : 0;
        if (fa !== fb) return fb - fa;
        return (b.priority || 0) - (a.priority || 0);
    });

    const placedRects = [];
    const results = new Map();
    const marginX = 8;
    const marginY = 6;

    const starBoxes = sorted.map(it => ({
        key: it.key,
        sx: it.sx,
        sy: it.sy,
        r: (it.starR || 12) + 4,
    }));

    function rectHitsStar(rx, ry, rw, rh, ownKey) {
        for (let i = 0; i < starBoxes.length; i++) {
            const s = starBoxes[i];
            if (s.key === ownKey) continue;
            const cx = Math.max(rx, Math.min(s.sx, rx + rw));
            const cy = Math.max(ry, Math.min(s.sy, ry + rh));
            const dx = s.sx - cx;
            const dy = s.sy - cy;
            if (dx * dx + dy * dy < s.r * s.r) return true;
        }
        return false;
    }

    function rectOverlapArea(rx, ry, rw, rh) {
        let area = 0;
        for (let i = 0; i < placedRects.length; i++) {
            const p = placedRects[i];
            const ox = Math.max(0, Math.min(rx + rw + marginX, p.x + p.w + marginX) - Math.max(rx, p.x));
            const oy = Math.max(0, Math.min(ry + rh + marginY, p.y + p.h + marginY) - Math.max(ry, p.y));
            if (ox > 0 && oy > 0) area += ox * oy;
        }
        return area;
    }

    function inSafeBounds(rx, ry, rw, rh) {
        return rx >= padL && ry >= padT && (rx + rw) <= (W - padR) && (ry + rh) <= (H - padB);
    }

    function candidatesFor(it, w, h) {
        const off = (it.starR || 12) + 8;
        const diag = off * 0.78;
        const { sx, sy } = it;
        return [
            { anchor: 'bottom', x: sx - w * 0.5, y: sy + off },
            { anchor: 'top',    x: sx - w * 0.5, y: sy - off - h },
            { anchor: 'right',  x: sx + off + 2, y: sy - h * 0.5 },
            { anchor: 'left',   x: sx - off - 2 - w, y: sy - h * 0.5 },
            { anchor: 'br',     x: sx + diag,    y: sy + diag },
            { anchor: 'bl',     x: sx - diag - w, y: sy + diag },
            { anchor: 'tr',     x: sx + diag,    y: sy - diag - h },
            { anchor: 'tl',     x: sx - diag - w, y: sy - diag - h },
        ];
    }

    for (const it of sorted) {
        const h = it.labelH || 22;
        const fullW = Math.max(28, it.fullW || 96);
        const shortW = Math.max(24, Math.min(fullW, it.shortW || fullW));
        let chosen = null;

        const tiers = shortW < fullW - 4
            ? [{ mode: 'full', w: fullW }, { mode: 'short', w: shortW }]
            : [{ mode: 'full', w: fullW }];

        for (const tier of tiers) {
            const slots = candidatesFor(it, tier.w, h);
            for (const slot of slots) {
                if (!inSafeBounds(slot.x, slot.y, tier.w, h)) continue;
                if (rectHitsStar(slot.x, slot.y, tier.w, h, it.key)) continue;
                if (rectOverlapArea(slot.x, slot.y, tier.w, h) === 0) {
                    chosen = { visible: true, mode: tier.mode, x: slot.x, y: slot.y, w: tier.w, h, anchor: slot.anchor };
                    break;
                }
            }
            if (chosen) break;
        }

        if (!chosen && it.forceVisible) {
            // Forced visible (hovered/locked/searched): pick least-overlapping clamped slot
            const w = shortW;
            const slots = candidatesFor(it, w, h);
            let bestSlot = null;
            let bestPenalty = Infinity;
            for (const slot of slots) {
                const cx = Math.max(padL, Math.min(W - padR - w, slot.x));
                const cy = Math.max(padT, Math.min(H - padB - h, slot.y));
                const pen = rectOverlapArea(cx, cy, w, h) + (rectHitsStar(cx, cy, w, h, it.key) ? 400 : 0);
                if (pen < bestPenalty) {
                    bestPenalty = pen;
                    bestSlot = { visible: true, mode: w < fullW ? 'short' : 'full', x: cx, y: cy, w, h, anchor: slot.anchor };
                }
            }
            chosen = bestSlot;
        }

        if (chosen) {
            placedRects.push(chosen);
            results.set(it.key, chosen);
        } else {
            results.set(it.key, {
                visible: false,
                mode: 'hidden',
                x: it.sx - shortW * 0.5,
                y: it.sy + (it.starR || 12) + 8,
                w: shortW,
                h,
                anchor: 'bottom',
            });
        }
    }

    return results;
}

// ── Runtime Controller (Browser Only) ───────────────────────────────────────

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

function _readPref(key, fallback, allowed) {
    try {
        if (typeof localStorage === 'undefined') return fallback;
        const v = localStorage.getItem(key);
        return allowed.includes(v) ? v : fallback;
    } catch (_) {
        return fallback;
    }
}

function _writePref(key, val) {
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, String(val));
    } catch (_) {}
}

function _hexToRgb(color, fallback = [229, 192, 123]) {
    if (!color || typeof color !== 'string') return fallback;
    const c = color.trim();
    if (c.startsWith('#')) {
        let hex = c.slice(1);
        if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
        if (hex.length === 6) {
            const n = parseInt(hex, 16);
            if (!isNaN(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        }
    }
    const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return fallback;
}

function _rgba(rgb, a) {
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

function _lerp(a, b, t) {
    return a + (b - a) * t;
}

function _clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function _springStep(val, vel, target, stiffness, damping, dt) {
    const force = -stiffness * (val - target) - damping * vel;
    const nextVel = vel + force * dt;
    const nextVal = val + nextVel * dt;
    return [nextVal, nextVel];
}

// Deterministic background starfield points
const BG_STARS = (() => {
    const out = [];
    let s = 20261127;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 140; i++) {
        out.push({
            x: (rnd() - 0.5) * 1800,
            y: (rnd() - 0.5) * 1400,
            r: rnd() < 0.16 ? 1.4 : (rnd() < 0.45 ? 0.95 : 0.65),
            alpha: 0.12 + rnd() * 0.36,
            depth: i < 88 ? 0.07 : 0.16,
            twinklePhase: rnd() * Math.PI * 2,
        });
    }
    return out;
})();

class AstrolabeGalaxyController {
    constructor() {
        this._viewMode = _readPref(VIEW_STORAGE_KEY, 'galaxy', ['galaxy', 'ledger']);
        this._lens = _readPref(LENS_STORAGE_KEY, 'constellations', ['constellations', 'orrery']);
        this._mounted = false;
        this._active = false;
        this._rafId = 0;
        this._lastFrameMs = 0;
        this._frameCount = 0;
        this._modalPaused = false;

        this._payload = {
            subject: 'physics',
            chapters: [],
            ghostCount: 0,
            totalFlowCount: 0,
            justAddedChapter: null,
            callbacks: {},
        };

        this._nodes = [];
        this._nodeByKey = new Map();
        this._constLayout = null;
        this._orreryLayout = null;
        this._activeSectorId = 'all';
        this._searchQuery = '';
        this._searchMatches = new Set();
        this._topSearchKey = null;

        this._hoveredKey = null;
        this._lockedKey = null;
        this._lastPointerType = 'mouse';

        this._flowMode = false;
        this._flowPath = []; // ordered chapter keys

        // Morph between constellations (0) and orrery (1)
        this._morphPos = this._lens === 'orrery' ? 1 : 0;
        this._morphVel = 0;
        this._morphTarget = this._morphPos;

        // Camera state (world center (x, y), scale s)
        this._cam = { x: 0, y: 0, zoom: 1, vx: 0, vy: 0, vZoom: 0 };
        this._camTarget = { x: 0, y: 0, zoom: 1 };
        this._camSpringing = false;
        this._fitScale = 1;
        this._stageW = 0;
        this._stageH = 0;
        this._dpr = 1;
        this._pointerPar = { x: 0, y: 0, tx: 0, ty: 0 };

        // Drag / pinch gesture tracking
        this._pointers = new Map();
        this._drag = null;
        this._pinch = null;
        this._inertia = { vx: 0, vy: 0, active: false };

        // Warp state
        this._warpSeq = 0;
        this._warpPhase = 'idle';
        this._warpTimers = [];
        this._arrivalKey = null;
        this._arrivalEndMs = 0;
        this._birthKey = null;
        this._birthEndMs = 0;

        // DOM refs
        this._root = null;
        this._stage = null;
        this._canvas = null;
        this._ctx = null;
        this._labelsLayer = null;
        this._labelEls = new Map();
        this._searchInput = null;
        this._searchClearBtn = null;
        this._searchCountEl = null;
        this._sectorBar = null;
        this._inspectorEl = null;
        this._flowDockEl = null;
        this._ghostPillEl = null;
        this._emptyEl = null;
        this._zoomControlsEl = null;
        this._warpVeil = null;

        this._palette = this._readPalette();
        this._observersWired = false;
    }

    isGalaxyMode() {
        return this._viewMode === 'galaxy';
    }

    getViewMode() {
        return this._viewMode;
    }

    getLens() {
        return this._lens;
    }

    isReducedMotion() {
        if (!isBrowser || !document.documentElement || !document.documentElement.classList) return true;
        if (document.documentElement.classList.contains('fx-effects-off')) return true;
        try {
            return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (_) {
            return false;
        }
    }

    _readPalette() {
        if (!isBrowser || typeof getComputedStyle !== 'function' || !document.documentElement) {
            return {
                ink: [229, 192, 123], bone: [242, 237, 227], ok: [169, 201, 164],
                warn: [217, 179, 106], crit: [217, 120, 95], flow: [156, 211, 240],
                phys: [143, 191, 224], chem: [169, 201, 164], math: [229, 192, 123],
            };
        }
        const cs = getComputedStyle(document.documentElement);
        return {
            ink:  _hexToRgb(cs.getPropertyValue('--obs-ink'), [229, 192, 123]),
            bone: _hexToRgb(cs.getPropertyValue('--obs-bone'), [242, 237, 227]),
            ok:   _hexToRgb(cs.getPropertyValue('--obs-ok'), [169, 201, 164]),
            warn: _hexToRgb(cs.getPropertyValue('--obs-warn'), [217, 179, 106]),
            crit: _hexToRgb(cs.getPropertyValue('--obs-crit'), [217, 120, 95]),
            flow: _hexToRgb(cs.getPropertyValue('--mode-flow'), [156, 211, 240]),
            phys: _hexToRgb(cs.getPropertyValue('--obs-subj-phys'), [143, 191, 224]),
            chem: _hexToRgb(cs.getPropertyValue('--obs-subj-chem'), [169, 201, 164]),
            math: _hexToRgb(cs.getPropertyValue('--obs-subj-math'), [229, 192, 123]),
        };
    }

    _subjectRgb() {
        const s = _normSubj(this._payload.subject);
        if (s === 'chemistry') return this._palette.chem;
        if (s === 'maths') return this._palette.math;
        return this._palette.phys;
    }

    _ensureDom() {
        if (!isBrowser || this._mounted) return true;
        this._root = document.getElementById('practice-chapters-view');
        this._stage = document.getElementById('chapter-galaxy-stage');
        this._warpVeil = document.getElementById('cg-warp-veil');
        if (!this._root || !this._stage) return false;

        this._stage.innerHTML = `
            <canvas class="cg-canvas" aria-hidden="true"></canvas>
            <div class="cg-labels-layer" aria-label="Chapter constellations"></div>
            <div class="cg-hud-top">
                <div class="cg-search-wrap">
                    <span class="cg-search-icon" aria-hidden="true">⌕</span>
                    <input type="search" class="cg-search-input" placeholder="Locate chapter…  (/)" autocomplete="off" spellcheck="false" aria-label="Filter chapters in galaxy">
                    <span class="cg-search-count" hidden></span>
                    <button type="button" class="cg-search-clear" aria-label="Clear search" hidden>&times;</button>
                </div>
                <div class="cg-top-right">
                    <button type="button" class="cg-ghost-pill" hidden title="Purge uncategorized ghost questions"></button>
                    <div class="cg-zoom-controls" role="group" aria-label="Map zoom controls">
                        <button type="button" class="cg-zoom-btn" data-cg-zoom="in" aria-label="Zoom in" title="Zoom in">+</button>
                        <button type="button" class="cg-zoom-btn" data-cg-zoom="out" aria-label="Zoom out" title="Zoom out">−</button>
                        <button type="button" class="cg-zoom-btn" data-cg-zoom="reset" aria-label="Reset camera" title="Fit all chapters">⌖</button>
                    </div>
                </div>
            </div>
            <div class="cg-empty" hidden>
                <span class="cg-empty-kicker">UNCHARTED DOMAIN</span>
                <h3 class="cg-empty-title">No stars charted yet</h3>
                <p class="cg-empty-sub">Create a chapter to ignite its constellation and map your syllabus weightage.</p>
                <button type="button" class="btn btn-primary cg-empty-add">+ New Chapter</button>
            </div>
            <div class="cg-hud-bottom">
                <div class="cg-sector-bar" role="tablist" aria-label="Syllabus unit sectors"></div>
                <div class="cg-inspector" hidden aria-live="polite"></div>
                <div class="cg-flow-dock" hidden></div>
            </div>
        `;

        this._canvas = this._stage.querySelector('.cg-canvas');
        this._ctx = this._canvas && typeof this._canvas.getContext === 'function' ? this._canvas.getContext('2d') : null;
        this._labelsLayer = this._stage.querySelector('.cg-labels-layer');
        this._searchInput = this._stage.querySelector('.cg-search-input');
        this._searchClearBtn = this._stage.querySelector('.cg-search-clear');
        this._searchCountEl = this._stage.querySelector('.cg-search-count');
        this._sectorBar = this._stage.querySelector('.cg-sector-bar');
        this._inspectorEl = this._stage.querySelector('.cg-inspector');
        this._flowDockEl = this._stage.querySelector('.cg-flow-dock');
        this._ghostPillEl = this._stage.querySelector('.cg-ghost-pill');
        this._emptyEl = this._stage.querySelector('.cg-empty');
        this._zoomControlsEl = this._stage.querySelector('.cg-zoom-controls');

        if (!this._canvas || !this._ctx || !this._zoomControlsEl) return false;

        this._bindEvents();
        this._applyModeClasses();
        this._mounted = true;
        return true;
    }

    _bindEvents() {
        // Header toggles
        const viewToggle = document.getElementById('cg-view-toggle');
        if (viewToggle && !viewToggle.dataset.cgBound) {
            viewToggle.dataset.cgBound = '1';
            viewToggle.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-cg-view]');
                if (btn) this.setViewMode(btn.dataset.cgView);
            });
        }
        const lensSeg = document.getElementById('cg-lens-seg');
        if (lensSeg && !lensSeg.dataset.cgBound) {
            lensSeg.dataset.cgBound = '1';
            lensSeg.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-cg-lens]');
                if (btn) this.setLens(btn.dataset.cgLens);
            });
        }

        // Zoom controls
        this._zoomControlsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-cg-zoom]');
            if (!btn) return;
            const act = btn.dataset.cgZoom;
            if (act === 'in') this._zoomAroundCenter(1.28);
            else if (act === 'out') this._zoomAroundCenter(1 / 1.28);
            else if (act === 'reset') this._focusSector('all');
        });

        // Empty state button
        const emptyAdd = this._emptyEl.querySelector('.cg-empty-add');
        if (emptyAdd) {
            emptyAdd.addEventListener('click', () => {
                if (typeof window.openModal === 'function') window.openModal('add-chapter-modal');
            });
        }

        // Ghost purge pill
        this._ghostPillEl.addEventListener('click', () => {
            if (typeof window.purgeGhostChapterQuestions === 'function') window.purgeGhostChapterQuestions();
        });

        // Search input
        this._searchInput.addEventListener('input', () => {
            this._setSearchQuery(this._searchInput.value);
        });
        this._searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (this._topSearchKey) {
                    const nd = this._nodeByKey.get(this._topSearchKey);
                    if (nd) this._openStar(nd);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this._setSearchQuery('');
                this._searchInput.blur();
            }
        });
        this._searchClearBtn.addEventListener('click', () => {
            this._setSearchQuery('');
            this._searchInput.focus();
        });

        // Sector pills
        this._sectorBar.addEventListener('click', (e) => {
            const pill = e.target.closest('[data-cg-sector]');
            if (!pill) return;
            const sid = pill.dataset.cgSector;
            if (sid === this._activeSectorId && sid !== 'all') {
                this._focusSector('all');
            } else {
                this._focusSector(sid);
            }
        });

        // Canvas pointer interactions (1:1 pan, pinch zoom, hover, tap lock/open)
        const canvas = this._canvas;
        canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
        canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
        canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
        canvas.addEventListener('pointercancel', (e) => this._onPointerUp(e));
        canvas.addEventListener('pointerleave', (e) => {
            if (e.pointerType !== 'touch') {
                this._pointerPar.tx = 0;
                this._pointerPar.ty = 0;
                if (this._hoveredKey) {
                    this._hoveredKey = null;
                    this._renderInspector();
                    this._requestStaticRedraw();
                }
            }
        });
        canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

        // Label clicks & hover
        this._labelsLayer.addEventListener('click', (e) => {
            const btn = e.target.closest('.cg-label');
            if (!btn) return;
            const nd = this._nodeByKey.get(btn.dataset.cgKey);
            if (!nd) return;
            this._handleStarActivate(nd, e.shiftKey, this._lastPointerType === 'touch');
        });
        this._labelsLayer.addEventListener('pointerenter', (e) => {
            const btn = e.target.closest('.cg-label');
            if (!btn || e.pointerType === 'touch') return;
            this._setHoveredKey(btn.dataset.cgKey);
        }, true);
        this._labelsLayer.addEventListener('pointerleave', (e) => {
            const btn = e.target.closest('.cg-label');
            if (!btn || e.pointerType === 'touch') return;
            if (this._hoveredKey === btn.dataset.cgKey) this._setHoveredKey(null);
        }, true);

        // Inspector actions
        this._inspectorEl.addEventListener('click', (e) => {
            const actBtn = e.target.closest('[data-cg-act]');
            if (!actBtn) return;
            const key = this._lockedKey || this._hoveredKey;
            const nd = key ? this._nodeByKey.get(key) : null;
            if (!nd) return;
            const act = actBtn.dataset.cgAct;
            if (act === 'open') {
                this._openStar(nd);
            } else if (act === 'flow') {
                if (!this._flowMode) this.toggleFlowMode(true);
                this._toggleFlowChapter(nd.key);
            } else if (act === 'purge') {
                if (typeof this._payload.callbacks?.onDeleteChapter === 'function') {
                    this._payload.callbacks.onDeleteChapter(nd.name);
                }
            } else if (act === 'close') {
                this._lockedKey = null;
                this._renderInspector();
                this._requestStaticRedraw();
            }
        });

        // Flow dock actions
        this._flowDockEl.addEventListener('click', (e) => {
            const rm = e.target.closest('[data-cg-flow-remove]');
            if (rm) {
                this._toggleFlowChapter(rm.dataset.cgFlowRemove);
                return;
            }
            const act = e.target.closest('[data-cg-flow-act]');
            if (!act) return;
            const cmd = act.dataset.cgFlowAct;
            if (cmd === 'launch') {
                const names = this._flowPath
                    .map(k => this._nodeByKey.get(k)?.name)
                    .filter(Boolean);
                if (names.length && typeof this._payload.callbacks?.onLaunchFlow === 'function') {
                    this._payload.callbacks.onLaunchFlow(names);
                }
            } else if (cmd === 'all') {
                this._flowPath = this._nodes.filter(n => n.flowCount > 0).map(n => n.key);
                this._renderFlowDock();
                this._requestStaticRedraw();
            } else if (cmd === 'clear') {
                this._flowPath = [];
                this._renderFlowDock();
                this._requestStaticRedraw();
            } else if (cmd === 'list') {
                if (typeof this._payload.callbacks?.onOpenMultiModal === 'function') {
                    this._payload.callbacks.onOpenMultiModal();
                }
            } else if (cmd === 'done') {
                this.toggleFlowMode(false);
            }
        });

        // Global keyboard shortcuts scoped to active Galaxy view
        if (!this._observersWired) {
            this._observersWired = true;
            window.addEventListener('keydown', (e) => this._onKeyDown(e));
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) this._stopLoop();
                else if (this._active && this.isGalaxyMode() && !this._modalPaused) this._startLoop();
            });

            if (typeof ResizeObserver !== 'undefined') {
                this._ro = new ResizeObserver(() => {
                    if (this._active && this.isGalaxyMode()) {
                        this._resizeCanvas();
                        this._requestStaticRedraw();
                    }
                });
                this._ro.observe(this._stage);
            }

            if (typeof MutationObserver !== 'undefined') {
                this._htmlObs = new MutationObserver(() => {
                    this._palette = this._readPalette();
                    if (this._active && this.isGalaxyMode()) {
                        if (this.isReducedMotion()) this._stopLoop();
                        else this._startLoop();
                        this._requestStaticRedraw();
                    }
                });
                this._htmlObs.observe(document.documentElement, {
                    attributes: true,
                    attributeFilter: ['data-ink', 'data-mode', 'class'],
                });

                this._modalObs = new MutationObserver(() => {
                    const hasModal = !!document.querySelector('.modal-overlay.active');
                    this._modalPaused = hasModal;
                    if (hasModal) this._stopLoop();
                    else if (this._active && this.isGalaxyMode()) this._startLoop();
                });
                this._modalObs.observe(document.body, {
                    attributes: true,
                    subtree: true,
                    attributeFilter: ['class'],
                });
            }
        }
    }

    _onKeyDown(e) {
        if (!this._active || !this.isGalaxyMode()) return;
        if (document.querySelector('.modal-overlay.active')) return;
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);

        if (e.key === '/' && !isTyping) {
            e.preventDefault();
            if (this._searchInput) this._searchInput.focus();
            return;
        }
        if (e.key === 'Escape' && !isTyping) {
            if (this._warpTimers.length) {
                this.cancelWarp();
                return;
            }
            if (this._searchQuery) {
                this._setSearchQuery('');
                return;
            }
            if (this._flowMode) {
                this.toggleFlowMode(false);
                return;
            }
            if (this._lockedKey) {
                this._lockedKey = null;
                this._renderInspector();
                this._requestStaticRedraw();
            }
        }
    }

    setViewMode(mode) {
        if (mode !== 'galaxy' && mode !== 'ledger') return;
        if (this._viewMode === mode) return;
        this._viewMode = mode;
        _writePref(VIEW_STORAGE_KEY, mode);
        if (mode === 'ledger' && this._flowMode) {
            this.toggleFlowMode(false);
        }
        this._applyModeClasses();
        if (mode === 'galaxy' && this._active) {
            this._resizeCanvas();
            this._recomputeLayouts();
            this._startLoop();
            this._requestStaticRedraw();
        } else {
            this._stopLoop();
        }
    }

    setLens(lens) {
        if (lens !== 'constellations' && lens !== 'orrery') return;
        if (this._lens === lens) return;
        this._lens = lens;
        _writePref(LENS_STORAGE_KEY, lens);
        this._morphTarget = lens === 'orrery' ? 1 : 0;
        if (this.isReducedMotion()) {
            this._morphPos = this._morphTarget;
            this._morphVel = 0;
        }
        this._activeSectorId = 'all';
        this._focusSector('all');
        this._applyModeClasses();
        this._renderSectorBar();
        this._requestStaticRedraw();
    }

    toggleFlowMode(forceState) {
        const next = typeof forceState === 'boolean' ? forceState : !this._flowMode;
        if (this._flowMode === next) return;
        this._flowMode = next;
        if (next) {
            this._lockedKey = null;
            this._renderInspector();
        }
        this._applyModeClasses();
        this._renderSectorBar();
        this._renderFlowDock();
        this._requestStaticRedraw();
    }

    _applyModeClasses() {
        if (!this._root || !this._stage) return;
        const isGalaxy = this.isGalaxyMode();
        this._root.classList.toggle('cg-mode-galaxy', isGalaxy);
        this._root.classList.toggle('cg-mode-ledger', !isGalaxy);
        this._stage.hidden = !isGalaxy;

        const viewToggle = document.getElementById('cg-view-toggle');
        if (viewToggle) {
            viewToggle.querySelectorAll('[data-cg-view]').forEach(b => {
                const on = b.dataset.cgView === this._viewMode;
                b.classList.toggle('is-active', on);
                b.setAttribute('aria-pressed', String(on));
            });
        }
        const lensSeg = document.getElementById('cg-lens-seg');
        if (lensSeg) {
            lensSeg.hidden = !isGalaxy;
            lensSeg.querySelectorAll('[data-cg-lens]').forEach(b => {
                const on = b.dataset.cgLens === this._lens;
                b.classList.toggle('is-active', on);
                b.setAttribute('aria-pressed', String(on));
            });
        }
        const flowBtn = document.getElementById('chapters-mode-flow');
        if (flowBtn) {
            flowBtn.classList.toggle('is-cg-flow-active', isGalaxy && this._flowMode);
            flowBtn.setAttribute('aria-pressed', String(isGalaxy && this._flowMode));
        }
        this._stage.classList.toggle('is-flow-mode', this._flowMode);
    }

    sync(payload) {
        if (!payload || !isBrowser) return;
        this._payload = payload;
        if (!this._ensureDom()) return;

        if (payload.justAddedChapter) {
            this._birthKey = String(payload.justAddedChapter).trim().toLowerCase();
            this._birthEndMs = performance.now() + 650;
        }

        // Preserve selection & flow path only across same-subject updates
        const prevSubj = this._lastSubject;
        if (prevSubj && prevSubj !== payload.subject) {
            this._lockedKey = null;
            this._hoveredKey = null;
            this._activeSectorId = 'all';
            this._flowPath = [];
            this._setSearchQuery('');
            this._cam = { x: 0, y: 0, zoom: 1, vx: 0, vy: 0, vZoom: 0 };
            this._camTarget = { x: 0, y: 0, zoom: 1 };
        }
        this._lastSubject = payload.subject;

        this._buildNodes();
        this._recomputeLayouts();
        this._syncLabelPool();
        this._renderSectorBar();
        this._renderGhostPill();
        this._renderEmptyState();
        this._renderInspector();
        this._renderFlowDock();
        this._applyModeClasses();

        if (this._active && this.isGalaxyMode()) {
            this._resizeCanvas();
            this._requestStaticRedraw();
        }
    }

    _buildNodes() {
        const subj = this._payload.subject;
        const list = Array.isArray(this._payload.chapters) ? this._payload.chapters : [];
        const nodes = [];
        const byKey = new Map();

        for (const raw of list) {
            const key = String(raw.name || '').trim().toLowerCase();
            if (!key || byKey.has(key)) continue;
            let weight = 0.5;
            try {
                weight = resolveChapterWeight(raw.name, raw.weightMaps || undefined).weight;
            } catch (_) {}
            const unit = classifyChapterUnit(subj, raw.name, !!raw.isMock, raw.weightMaps);
            const qCount = raw.qCount || 0;
            const starR = 7.5 + _clamp(weight, 0.2, 1.2) * 8.2 + Math.min(4.2, Math.log2(qCount + 1) * 0.72);
            const h = _hashStr(`${subj}::${key}`);

            const node = {
                key,
                name: raw.name,
                shortName: abbreviateChapterName(raw.name, 14),
                qCount,
                solved: raw.solved || 0,
                attempted: raw.attempted || 0,
                correct: raw.correct || 0,
                hitPct: raw.hitPct || 0,
                doneFrac: _clamp(raw.doneFrac || 0, 0, 1),
                health: Number.isFinite(raw.health) ? raw.health : 50,
                dueErrors: raw.dueErrors || 0,
                flowCount: raw.flowCount || 0,
                isMock: !!raw.isMock,
                weight,
                weightMaps: raw.weightMaps || null,
                unit,
                starR,
                phase: (h % 6283) / 1000,
                ringTilt: ((h >> 8) % 60 - 30) * (Math.PI / 180),
                cx: 0, cy: 0,
                ox: 0, oy: 0,
                x: 0, y: 0,
                sx: 0, sy: 0,
                hoverSpring: 0,
            };
            nodes.push(node);
            byKey.set(key, node);
        }

        this._nodes = nodes;
        this._nodeByKey = byKey;
        // Prune flowPath if a chapter was deleted
        this._flowPath = this._flowPath.filter(k => byKey.has(k));
        if (this._lockedKey && !byKey.has(this._lockedKey)) this._lockedKey = null;
        if (this._hoveredKey && !byKey.has(this._hoveredKey)) this._hoveredKey = null;
        if (this._searchQuery) this._recomputeSearchMatches();
    }

    _recomputeLayouts() {
        const aspect = (this._stageW > 0 && this._stageH > 0)
            ? _clamp((this._stageW / this._stageH) * 0.88, 0.82, 1.32)
            : 1.15;

        this._constLayout = computeConstellationLayout(this._nodes, this._payload.subject, { aspect, radius: WORLD_RADIUS });
        this._orreryLayout = computeOrreryLayout(this._nodes, this._payload.subject, { aspect });

        for (const nd of this._nodes) {
            const cp = this._constLayout.positions.get(nd.key);
            const op = this._orreryLayout.positions.get(nd.key);
            nd.cx = cp ? cp.x : 0;
            nd.cy = cp ? cp.y : 0;
            nd.ox = op ? op.x : nd.cx;
            nd.oy = op ? op.y : nd.cy;
            nd.x = _lerp(nd.cx, nd.ox, this._morphPos);
            nd.y = _lerp(nd.cy, nd.oy, this._morphPos);
        }
        this._updateFitScale();
    }

    _updateFitScale() {
        if (!this._stageW || !this._stageH) return;
        const layout = this._morphTarget >= 0.5 ? this._orreryLayout : this._constLayout;
        const rx = (layout && layout.bounds ? layout.bounds.rx : WORLD_RADIUS * 1.15);
        const ry = (layout && layout.bounds ? layout.bounds.ry : WORLD_RADIUS);
        const usableW = Math.max(220, this._stageW - 96);
        const usableH = Math.max(220, this._stageH - 138);
        this._fitScale = _clamp(Math.min(usableW / (rx * 2), usableH / (ry * 2)), 0.42, 1.45);
    }

    _resizeCanvas() {
        if (!this._stage || !this._canvas || !this._ctx) return;
        const rect = this._stage.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const changed = w !== this._stageW || h !== this._stageH || dpr !== this._dpr;
        this._stageW = w;
        this._stageH = h;
        this._dpr = dpr;
        if (changed) {
            this._canvas.width = Math.round(w * dpr);
            this._canvas.height = Math.round(h * dpr);
            this._recomputeLayouts();
        }
    }

    _syncLabelPool() {
        if (!this._labelsLayer) return;
        const existing = this._labelEls;
        const nextKeys = new Set(this._nodes.map(n => n.key));

        for (const [k, el] of existing.entries()) {
            if (!nextKeys.has(k)) {
                el.remove();
                existing.delete(k);
            }
        }

        for (const nd of this._nodes) {
            let el = existing.get(nd.key);
            if (!el) {
                el = document.createElement('button');
                el.type = 'button';
                el.className = 'cg-label';
                el.dataset.cgKey = nd.key;
                el.innerHTML = `<span class="cg-lbl-name"></span><span class="cg-lbl-meta"></span>`;
                this._labelsLayer.appendChild(el);
                existing.set(nd.key, el);
            }
            el._fullText = nd.name;
            el._shortText = nd.shortName;
            const nameEl = el.querySelector('.cg-lbl-name');
            const metaEl = el.querySelector('.cg-lbl-meta');
            if (nameEl && nameEl.textContent !== nd.name) nameEl.textContent = nd.name;
            if (metaEl) {
                if (nd.dueErrors > 0) metaEl.textContent = `${nd.dueErrors} due`;
                else if (nd.qCount > 0) metaEl.textContent = `${nd.hitPct}%`;
                else metaEl.textContent = '';
            }
            el.setAttribute('aria-label', `${nd.name}, ${nd.qCount} questions, ${nd.hitPct}% hit rate, health ${Math.round(nd.health)}%`);
            el.classList.toggle('is-mock', nd.isMock);
            el.classList.toggle('is-crit', nd.qCount > 0 && (nd.dueErrors > 0 || (nd.health < 45 && nd.hitPct < 60)));
            el.classList.toggle('is-untouched', nd.qCount === 0);
            // Measure exact rendered pixel dimensions once per sync (zero per-frame thrash)
            if (nameEl) nameEl.textContent = nd.shortName;
            const shortMeasured = el.offsetWidth;
            if (nameEl) nameEl.textContent = nd.name;
            const fullMeasured = el.offsetWidth;
            const hMeasured = el.offsetHeight;
            el._shortW = Math.max(36, shortMeasured || Math.min(148, (nd.shortName.length * 7.2) + 32));
            el._fullW = Math.max(el._shortW, fullMeasured || Math.min(220, (nd.name.length * 7.2) + 36));
            el._labelH = Math.max(20, hMeasured || 22);
        }
    }

    _renderSectorBar() {
        if (!this._sectorBar) return;
        const show = this.isGalaxyMode() && this._lens === 'constellations' && !this._flowMode && this._nodes.length > 0;
        this._sectorBar.hidden = !show;
        if (!show) return;

        const sectors = (this._constLayout && this._constLayout.sectors) || [];
        let html = `<button type="button" class="cg-sector-pill${this._activeSectorId === 'all' ? ' is-active' : ''}" data-cg-sector="all">All <span class="cg-sector-cnt">${this._nodes.length}</span></button>`;
        for (const s of sectors) {
            const on = this._activeSectorId === s.id;
            html += `<button type="button" class="cg-sector-pill${on ? ' is-active' : ''}" data-cg-sector="${_escHtml(s.id)}">${_escHtml(s.label)} <span class="cg-sector-cnt">${s.count}</span></button>`;
        }
        this._sectorBar.innerHTML = html;
    }

    _renderGhostPill() {
        if (!this._ghostPillEl) return;
        const g = this._payload.ghostCount || 0;
        this._ghostPillEl.hidden = g <= 0;
        if (g > 0) {
            this._ghostPillEl.textContent = `👻 ${g} ghost · Purge`;
        }
    }

    _renderEmptyState() {
        if (!this._emptyEl) return;
        this._emptyEl.hidden = this._nodes.length > 0;
    }

    _renderInspector() {
        if (!this._inspectorEl) return;
        if (this._flowMode || !this._nodes.length) {
            this._inspectorEl.hidden = true;
            return;
        }
        const key = this._lockedKey || this._hoveredKey;
        const nd = key ? this._nodeByKey.get(key) : null;
        if (!nd) {
            this._inspectorEl.hidden = true;
            return;
        }
        const isLocked = key === this._lockedKey;
        this._inspectorEl.hidden = false;
        this._inspectorEl.classList.toggle('is-locked', isLocked);
        const healthRounded = Math.round(nd.health);
        const healthTier = nd.qCount === 0 ? 'Uncharted' : (healthRounded < 45 ? 'Critical' : (healthRounded >= 78 ? 'Exam-Ready' : 'Active'));
        const dueHtml = nd.dueErrors > 0 ? `<span class="cg-ins-stat is-crit"><b>${nd.dueErrors}</b> due</span>` : '';
        const wtHtml = `<span class="cg-ins-wt">WT ${nd.weight.toFixed(1)}</span>`;
        const actionsHtml = isLocked ? `
            <div class="cg-ins-actions">
                <button type="button" class="cg-ins-btn is-primary" data-cg-act="open">Enter Chapter →</button>
                <button type="button" class="cg-ins-btn" data-cg-act="flow">+ Flow</button>
                <button type="button" class="cg-ins-btn is-danger" data-cg-act="purge" aria-label="Purge ${_escHtml(nd.name)}">Purge</button>
                <button type="button" class="cg-ins-close" data-cg-act="close" aria-label="Deselect">&times;</button>
            </div>` : '';

        this._inspectorEl.innerHTML = `
            <div class="cg-ins-top">
                <span class="cg-ins-unit">${_escHtml(nd.unit.label.toUpperCase())}</span>
                ${wtHtml}
            </div>
            <div class="cg-ins-name">${_escHtml(nd.name)}</div>
            <div class="cg-ins-stats">
                <span class="cg-ins-stat"><b>${nd.qCount}</b> Q</span>
                <span class="cg-ins-stat"><b>${nd.hitPct}%</b> hit</span>
                <span class="cg-ins-stat"><b>${nd.solved}/${nd.qCount}</b> resolved</span>
                <span class="cg-ins-stat"><b>${healthRounded}%</b> ${healthTier}</span>
                ${dueHtml}
            </div>
            ${actionsHtml}
        `;
    }

    _renderFlowDock() {
        if (!this._flowDockEl) return;
        if (!this._flowMode || !this.isGalaxyMode()) {
            this._flowDockEl.hidden = true;
            return;
        }
        this._flowDockEl.hidden = false;

        let totalQ = 0;
        const chipsHtml = this._flowPath.map((k, idx) => {
            const nd = this._nodeByKey.get(k);
            if (!nd) return '';
            totalQ += nd.flowCount;
            const num = String(idx + 1).padStart(2, '0');
            return `<button type="button" class="cg-flow-chip" data-cg-flow-remove="${_escHtml(k)}" title="Remove ${_escHtml(nd.name)}">
                <span class="cg-flow-idx">${num}</span>
                <span>${_escHtml(nd.shortName)}</span>
                <span class="cg-flow-q">${nd.flowCount}</span>
                <span aria-hidden="true">&times;</span>
            </button>`;
        }).join('');

        const emptyMsg = `<span class="cg-flow-hint">Tap stars on the map to plot your Flow trajectory</span>`;
        this._flowDockEl.innerHTML = `
            <div class="cg-flow-head">
                <span class="cg-flow-kicker">FLOW TRAJECTORY · ${this._flowPath.length} SELECTED · ${totalQ} ELIGIBLE Q</span>
                <div class="cg-flow-tools">
                    <button type="button" class="cg-flow-tool" data-cg-flow-act="all">All Eligible</button>
                    <button type="button" class="cg-flow-tool" data-cg-flow-act="clear">Clear</button>
                    <button type="button" class="cg-flow-tool" data-cg-flow-act="list">List</button>
                    <button type="button" class="cg-flow-tool" data-cg-flow-act="done">Done</button>
                </div>
            </div>
            <div class="cg-flow-row">
                <div class="cg-flow-chips">${chipsHtml || emptyMsg}</div>
                <button type="button" class="cg-flow-launch" data-cg-flow-act="launch"${totalQ === 0 ? ' disabled' : ''}>Launch Flow →</button>
            </div>
        `;
    }

    _setSearchQuery(q) {
        this._searchQuery = String(q || '');
        if (this._searchInput && this._searchInput.value !== this._searchQuery) {
            this._searchInput.value = this._searchQuery;
        }
        if (this._searchClearBtn) this._searchClearBtn.hidden = !this._searchQuery.trim();
        this._recomputeSearchMatches();
        this._requestStaticRedraw();
    }

    _recomputeSearchMatches() {
        this._searchMatches.clear();
        this._topSearchKey = null;
        const q = _normText(this._searchQuery);
        if (!q) {
            if (this._searchCountEl) this._searchCountEl.hidden = true;
            return;
        }
        let bestScore = -1;
        for (const nd of this._nodes) {
            const hay = _normText(`${nd.name} ${nd.shortName} ${nd.unit.label}`);
            let score = 0;
            if (hay.startsWith(q)) score = 3;
            else if (hay.includes(' ' + q)) score = 2;
            else if (hay.includes(q)) score = 1;
            if (score > 0) {
                this._searchMatches.add(nd.key);
                if (score > bestScore || (score === bestScore && nd.weight > (this._nodeByKey.get(this._topSearchKey)?.weight || 0))) {
                    bestScore = score;
                    this._topSearchKey = nd.key;
                }
            }
        }
        if (this._searchCountEl) {
            this._searchCountEl.hidden = false;
            this._searchCountEl.textContent = `${this._searchMatches.size}/${this._nodes.length}`;
        }
    }

    _focusSector(sectorId) {
        this._activeSectorId = sectorId || 'all';
        this._renderSectorBar();
        if (!sectorId || sectorId === 'all' || this._lens !== 'constellations') {
            this._camTarget = { x: 0, y: 0, zoom: 1 };
        } else {
            const sec = (this._constLayout?.sectors || []).find(s => s.id === sectorId);
            if (sec) {
                const targetZoom = _clamp(Math.min(this._stageW, this._stageH) / (Math.max(140, sec.radius * 2.25) * this._fitScale), 1.05, 2.35);
                this._camTarget = { x: sec.cx, y: sec.cy, zoom: targetZoom };
            }
        }
        if (this.isReducedMotion()) {
            this._cam.x = this._camTarget.x;
            this._cam.y = this._camTarget.y;
            this._cam.zoom = this._camTarget.zoom;
            this._cam.vx = this._cam.vy = this._cam.vZoom = 0;
            this._camSpringing = false;
        } else {
            this._camSpringing = true;
        }
        this._inertia.active = false;
        this._requestStaticRedraw();
    }

    _zoomAroundCenter(factor) {
        const nextZoom = _clamp(this._camTarget.zoom * factor, 0.72, 2.8);
        this._camTarget = { x: this._camTarget.x, y: this._camTarget.y, zoom: nextZoom };
        if (this.isReducedMotion()) {
            this._cam.zoom = nextZoom;
        } else {
            this._camSpringing = true;
        }
        this._requestStaticRedraw();
    }

    _screenToWorld(sx, sy) {
        const s = this._fitScale * this._cam.zoom;
        return {
            x: (sx - this._stageW * 0.5) / s + this._cam.x,
            y: (sy - this._stageH * 0.5) / s + this._cam.y,
        };
    }

    _worldToScreen(wx, wy) {
        const s = this._fitScale * this._cam.zoom;
        return {
            x: (wx - this._cam.x) * s + this._stageW * 0.5,
            y: (wy - this._cam.y) * s + this._stageH * 0.5,
        };
    }

    _hitTest(sx, sy, isTouch) {
        const s = this._fitScale * this._cam.zoom;
        const hitPad = isTouch ? 18 : 12;
        let best = null;
        let bestD = Infinity;
        for (const nd of this._nodes) {
            const p = this._worldToScreen(nd.x, nd.y);
            const r = nd.starR * Math.min(1.25, Math.max(0.85, s)) + hitPad;
            const d = Math.hypot(sx - p.x, sy - p.y);
            if (d <= r && d < bestD) {
                bestD = d;
                best = nd;
            }
        }
        return best;
    }

    _setHoveredKey(key) {
        if (this._hoveredKey === key) return;
        this._hoveredKey = key;
        if (key && window.FX?.wantHoverSound?.()) {
            try { window.FX.sound('hover'); } catch (_) {}
        }
        this._renderInspector();
        this._requestStaticRedraw();
    }

    _toggleFlowChapter(key) {
        const idx = this._flowPath.indexOf(key);
        if (idx >= 0) {
            this._flowPath.splice(idx, 1);
        } else {
            this._flowPath.push(key);
        }
        if (window.FX?.wantHaptic?.()) {
            try { window.FX.haptic('tap'); } catch (_) {}
        }
        this._renderFlowDock();
        this._requestStaticRedraw();
    }

    _handleStarActivate(nd, shiftKey, isTouch) {
        if (!nd) return;
        if (shiftKey && !this._flowMode) {
            this.toggleFlowMode(true);
        }
        if (this._flowMode) {
            this._toggleFlowChapter(nd.key);
            return;
        }
        if (isTouch) {
            if (this._lockedKey === nd.key) {
                this._openStar(nd);
            } else {
                this._lockedKey = nd.key;
                if (window.FX?.wantHaptic?.()) {
                    try { window.FX.haptic('tap'); } catch (_) {}
                }
                this._renderInspector();
                this._requestStaticRedraw();
            }
            return;
        }
        this._openStar(nd);
    }

    _openStar(nd) {
        if (!nd) return;
        const onOpen = this._payload.callbacks?.onOpenChapter;
        if (typeof onOpen !== 'function') return;
        this.warpToChapter(nd.name, () => onOpen(nd.name));
    }

    // ── Pointer & Wheel Handlers ────────────────────────────────────────────
    _onPointerDown(e) {
        this._lastPointerType = e.pointerType || 'mouse';
        if (e.button && e.button !== 0) return;
        try { this._canvas.setPointerCapture(e.pointerId); } catch (_) {}
        const rect = this._stage.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        this._pointers.set(e.pointerId, { sx, sy, t: performance.now() });
        this._inertia.active = false;
        this._camSpringing = false;

        if (this._pointers.size === 1) {
            this._drag = {
                id: e.pointerId,
                startSx: sx,
                startSy: sy,
                startCamX: this._cam.x,
                startCamY: this._cam.y,
                moved: false,
                samples: [{ sx, sy, t: performance.now() }],
            };
            this._pinch = null;
        } else if (this._pointers.size === 2) {
            const pts = Array.from(this._pointers.values());
            const dist = Math.max(10, Math.hypot(pts[1].sx - pts[0].sx, pts[1].sy - pts[0].sy));
            const midSx = (pts[0].sx + pts[1].sx) * 0.5;
            const midSy = (pts[0].sy + pts[1].sy) * 0.5;
            this._pinch = {
                startDist: dist,
                startZoom: this._cam.zoom,
                anchorWorld: this._screenToWorld(midSx, midSy),
            };
            this._drag = null;
        }
    }

    _onPointerMove(e) {
        this._lastPointerType = e.pointerType || 'mouse';
        const rect = this._stage.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        if (e.pointerType !== 'touch' && this._pointers.size === 0) {
            this._pointerPar.tx = ((sx / Math.max(1, this._stageW)) - 0.5) * 18;
            this._pointerPar.ty = ((sy / Math.max(1, this._stageH)) - 0.5) * 14;
            const hit = this._hitTest(sx, sy, false);
            this._canvas.style.cursor = hit ? 'pointer' : 'grab';
            this._setHoveredKey(hit ? hit.key : null);
            return;
        }

        if (!this._pointers.has(e.pointerId)) return;
        this._pointers.set(e.pointerId, { sx, sy, t: performance.now() });

        if (this._pinch && this._pointers.size >= 2) {
            const pts = Array.from(this._pointers.values());
            const dist = Math.max(10, Math.hypot(pts[1].sx - pts[0].sx, pts[1].sy - pts[0].sy));
            const midSx = (pts[0].sx + pts[1].sx) * 0.5;
            const midSy = (pts[0].sy + pts[1].sy) * 0.5;
            const nextZoom = _clamp(this._pinch.startZoom * (dist / this._pinch.startDist), 0.72, 2.8);
            this._cam.zoom = nextZoom;
            this._camTarget.zoom = nextZoom;
            const s = this._fitScale * nextZoom;
            this._cam.x = this._pinch.anchorWorld.x - (midSx - this._stageW * 0.5) / s;
            this._cam.y = this._pinch.anchorWorld.y - (midSy - this._stageH * 0.5) / s;
            this._camTarget.x = this._cam.x;
            this._camTarget.y = this._cam.y;
            this._requestStaticRedraw();
            return;
        }

        if (this._drag && this._drag.id === e.pointerId) {
            const dx = sx - this._drag.startSx;
            const dy = sy - this._drag.startSy;
            if (!this._drag.moved && Math.hypot(dx, dy) > 8) {
                this._drag.moved = true;
                this._canvas.style.cursor = 'grabbing';
            }
            if (this._drag.moved) {
                const s = this._fitScale * this._cam.zoom;
                let nx = this._drag.startCamX - dx / s;
                let ny = this._drag.startCamY - dy / s;
                const maxPan = 420;
                if (Math.abs(nx) > maxPan) {
                    const over = nx > 0 ? nx - maxPan : nx + maxPan;
                    nx = (nx > 0 ? maxPan : -maxPan) + rubberband(over, 240);
                }
                if (Math.abs(ny) > maxPan) {
                    const over = ny > 0 ? ny - maxPan : ny + maxPan;
                    ny = (ny > 0 ? maxPan : -maxPan) + rubberband(over, 240);
                }
                this._cam.x = nx;
                this._cam.y = ny;
                this._camTarget.x = nx;
                this._camTarget.y = ny;
                const now = performance.now();
                this._drag.samples.push({ sx, sy, t: now });
                if (this._drag.samples.length > 5) this._drag.samples.shift();
                this._requestStaticRedraw();
            }
        }
    }

    _onPointerUp(e) {
        const rect = this._stage.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        this._pointers.delete(e.pointerId);
        try { this._canvas.releasePointerCapture(e.pointerId); } catch (_) {}

        if (this._pinch) {
            if (this._pointers.size < 2) this._pinch = null;
            return;
        }

        if (this._drag && this._drag.id === e.pointerId) {
            const drag = this._drag;
            this._drag = null;
            this._canvas.style.cursor = 'grab';

            if (!drag.moved) {
                const isTouch = e.pointerType === 'touch';
                const hit = this._hitTest(sx, sy, isTouch);
                if (hit) {
                    this._handleStarActivate(hit, e.shiftKey, isTouch);
                } else if (this._lockedKey) {
                    this._lockedKey = null;
                    this._renderInspector();
                    this._requestStaticRedraw();
                }
            } else {
                // Velocity handoff & soft bounds spring-back
                const samples = drag.samples;
                if (samples.length >= 2 && !this.isReducedMotion()) {
                    const first = samples[0];
                    const last = samples[samples.length - 1];
                    const dt = Math.max(0.016, (last.t - first.t) / 1000);
                    const s = this._fitScale * this._cam.zoom;
                    const vx = -((last.sx - first.sx) / dt) / s;
                    const vy = -((last.sy - first.sy) / dt) / s;
                    this._camTarget.x = _clamp(this._cam.x + projectMomentum(vx, 0.990), -340, 340);
                    this._camTarget.y = _clamp(this._cam.y + projectMomentum(vy, 0.990), -340, 340);
                    this._cam.vx = vx;
                    this._cam.vy = vy;
                    this._camSpringing = true;
                } else {
                    this._camTarget.x = _clamp(this._cam.x, -340, 340);
                    this._camTarget.y = _clamp(this._cam.y, -340, 340);
                    this._cam.x = this._camTarget.x;
                    this._cam.y = this._camTarget.y;
                }
                this._requestStaticRedraw();
            }
        }
    }

    _onWheel(e) {
        if (!this._active || !this.isGalaxyMode()) return;
        e.preventDefault();
        const rect = this._stage.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const before = this._screenToWorld(sx, sy);
        const factor = Math.exp(-e.deltaY * 0.0014);
        const nextZoom = _clamp(this._cam.zoom * factor, 0.72, 2.8);
        this._cam.zoom = nextZoom;
        this._camTarget.zoom = nextZoom;
        const s = this._fitScale * nextZoom;
        this._cam.x = _clamp(before.x - (sx - this._stageW * 0.5) / s, -360, 360);
        this._cam.y = _clamp(before.y - (sy - this._stageH * 0.5) / s, -360, 360);
        this._camTarget.x = this._cam.x;
        this._camTarget.y = this._cam.y;
        this._camSpringing = false;
        this._requestStaticRedraw();
    }

    // ── View Lifecycle & Interruptible Warp ─────────────────────────────────
    onEnterView(opts = {}) {
        if (!this._ensureDom()) return;
        this._active = true;
        this.cancelWarp();
        this._palette = this._readPalette();
        this._applyModeClasses();

        if (!this.isGalaxyMode()) {
            this._stopLoop();
            return;
        }

        this._resizeCanvas();
        const retName = opts && opts.returnFromChapter;
        const retKey = retName ? String(retName).trim().toLowerCase() : null;
        const retNode = retKey ? this._nodeByKey.get(retKey) : null;

        if (retNode && !this.isReducedMotion()) {
            this._arrivalKey = retKey;
            this._arrivalEndMs = performance.now() + 580;
            this._cam.x = retNode.x * 0.45;
            this._cam.y = retNode.y * 0.45;
            this._cam.zoom = 1.24;
            this._camTarget = { x: 0, y: 0, zoom: 1 };
            this._activeSectorId = 'all';
            this._camSpringing = true;
        } else {
            this._cam.x = 0;
            this._cam.y = 0;
            this._cam.zoom = 1;
            this._camTarget = { x: 0, y: 0, zoom: 1 };
            this._camSpringing = false;
        }

        this._renderSectorBar();
        this._startLoop();
        this._requestStaticRedraw();
    }

    onLeaveView() {
        this._active = false;
        if (this._warpPhase !== 'exiting') {
            this.cancelWarp();
        }
        this._stopLoop();
    }

    cancelWarp() {
        this._warpSeq++;
        this._warpPhase = 'idle';
        while (this._warpTimers.length) {
            clearTimeout(this._warpTimers.pop());
        }
        if (this._warpVeil) {
            this._warpVeil.classList.remove('is-diving', 'is-exiting');
            this._warpVeil.hidden = true;
        }
    }

    warpToChapter(chapterName, onComplete) {
        const key = String(chapterName || '').trim().toLowerCase();
        const nd = this._nodeByKey.get(key);
        const seq = ++this._warpSeq;
        while (this._warpTimers.length) clearTimeout(this._warpTimers.pop());

        if (!this.isGalaxyMode() || !this._active || this.isReducedMotion() || !this._warpVeil || !nd) {
            this._warpPhase = 'idle';
            if (typeof onComplete === 'function') onComplete();
            return;
        }

        const scr = this._worldToScreen(nd.x, nd.y);
        const rect = this._stage ? this._stage.getBoundingClientRect() : { left: 0, top: 0 };
        const vx = ((rect.left + scr.x) / Math.max(1, window.innerWidth)) * 100;
        const vy = ((rect.top + scr.y) / Math.max(1, window.innerHeight)) * 100;
        const rgb = this._subjectRgb();

        this._warpPhase = 'diving';
        this._warpVeil.style.setProperty('--warp-x', `${vx.toFixed(1)}%`);
        this._warpVeil.style.setProperty('--warp-y', `${vy.toFixed(1)}%`);
        this._warpVeil.style.setProperty('--warp-color', `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.28)`);
        this._warpVeil.hidden = false;
        this._warpVeil.classList.remove('is-exiting');
        // Force style flush so transition triggers reliably
        void this._warpVeil.offsetWidth;
        this._warpVeil.classList.add('is-diving');

        // Gentle camera pull toward target star during dive
        this._camTarget = { x: nd.x * 0.55, y: nd.y * 0.55, zoom: Math.max(1.26, this._cam.zoom * 1.18) };
        this._camSpringing = true;

        const t1 = setTimeout(() => {
            if (this._warpSeq !== seq) return;
            this._warpPhase = 'exiting';
            if (typeof onComplete === 'function') onComplete();
            if (!this._warpVeil) {
                this._warpPhase = 'idle';
                return;
            }
            this._warpVeil.classList.remove('is-diving');
            this._warpVeil.classList.add('is-exiting');
            const t2 = setTimeout(() => {
                if (this._warpSeq !== seq) return;
                this._warpPhase = 'idle';
                if (!this._warpVeil) return;
                this._warpVeil.classList.remove('is-exiting');
                this._warpVeil.hidden = true;
            }, 170);
            this._warpTimers.push(t2);
        }, 200);
        this._warpTimers.push(t1);
    }

    // ── Animation Loop & Rendering ──────────────────────────────────────────
    _startLoop() {
        if (!isBrowser || this._rafId || this.isReducedMotion() || !this._active || !this.isGalaxyMode() || this._modalPaused) {
            return;
        }
        this._lastFrameMs = performance.now();
        const tick = (now) => {
            this._rafId = 0;
            if (!this._active || !this.isGalaxyMode() || this._modalPaused || this.isReducedMotion()) return;
            const dt = Math.min(0.05, Math.max(0.001, (now - this._lastFrameMs) / 1000));
            this._lastFrameMs = now;
            this._step(dt, now);
            this._draw(now);
            this._rafId = requestAnimationFrame(tick);
        };
        this._rafId = requestAnimationFrame(tick);
    }

    _stopLoop() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = 0;
        }
    }

    _requestStaticRedraw() {
        if (!isBrowser || !this._active || !this.isGalaxyMode()) return;
        if (!this._rafId) {
            const now = performance.now();
            this._step(0.016, now);
            this._draw(now);
        }
    }

    _step(dt, now) {
        // 1. Critically damped spring morph between Constellations (0) and Orrery (1)
        if (Math.abs(this._morphPos - this._morphTarget) > 0.0005 || Math.abs(this._morphVel) > 0.0005) {
            const [np, nv] = _springStep(this._morphPos, this._morphVel, this._morphTarget, 170, 26, dt);
            this._morphPos = _clamp(np, -0.05, 1.05);
            this._morphVel = nv;
            for (const nd of this._nodes) {
                nd.x = _lerp(nd.cx, nd.ox, this._morphPos);
                nd.y = _lerp(nd.cy, nd.oy, this._morphPos);
            }
        } else {
            this._morphPos = this._morphTarget;
            this._morphVel = 0;
        }

        // 2. Camera spring (sector focus / warp / momentum settle)
        if (this._camSpringing) {
            const [nx, vx] = _springStep(this._cam.x, this._cam.vx, this._camTarget.x, 190, 27.6, dt);
            const [ny, vy] = _springStep(this._cam.y, this._cam.vy, this._camTarget.y, 190, 27.6, dt);
            const [nz, vz] = _springStep(this._cam.zoom, this._cam.vZoom, this._camTarget.zoom, 190, 27.6, dt);
            this._cam.x = nx; this._cam.vx = vx;
            this._cam.y = ny; this._cam.vy = vy;
            this._cam.zoom = nz; this._cam.vZoom = vz;
            if (
                Math.abs(nx - this._camTarget.x) < 0.25 && Math.abs(vx) < 0.5 &&
                Math.abs(ny - this._camTarget.y) < 0.25 && Math.abs(vy) < 0.5 &&
                Math.abs(nz - this._camTarget.zoom) < 0.001 && Math.abs(vz) < 0.01
            ) {
                this._cam.x = this._camTarget.x;
                this._cam.y = this._camTarget.y;
                this._cam.zoom = this._camTarget.zoom;
                this._cam.vx = this._cam.vy = this._cam.vZoom = 0;
                this._camSpringing = false;
            }
        }

        // 3. Subtle pointer parallax + hover scale easing
        this._pointerPar.x = _lerp(this._pointerPar.x, this._pointerPar.tx, Math.min(1, dt * 8));
        this._pointerPar.y = _lerp(this._pointerPar.y, this._pointerPar.ty, Math.min(1, dt * 8));

        for (const nd of this._nodes) {
            const focused = nd.key === this._hoveredKey || nd.key === this._lockedKey;
            nd.hoverSpring = _lerp(nd.hoverSpring, focused ? 1 : 0, Math.min(1, dt * 14));
        }

        // Clear transient halo timers
        if (this._arrivalKey && now > this._arrivalEndMs) this._arrivalKey = null;
        if (this._birthKey && now > this._birthEndMs) this._birthKey = null;
    }

    _draw(now) {
        const ctx = this._ctx;
        const w = this._stageW;
        const h = this._stageH;
        if (!ctx || !w || !h) return;

        this._frameCount++;
        const t = this.isReducedMotion() ? 0 : now / 1000;
        const dpr = this._dpr;
        const pal = this._palette;
        const subjRgb = this._subjectRgb();
        const searchActive = this._searchMatches.size > 0 || _normText(this._searchQuery).length > 0;
        const activeKey = this._lockedKey || this._hoveredKey;

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // Subtle subject nebula glow in center
        const cx = w * 0.5;
        const cy = h * 0.5;
        const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(w, h) * 0.58);
        grad.addColorStop(0, _rgba(subjRgb, 0.055));
        grad.addColorStop(0.5, _rgba(pal.ink, 0.02));
        grad.addColorStop(1, 'rgba(4,5,9,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // 1. Parallax deep star dust
        for (let i = 0; i < BG_STARS.length; i++) {
            const st = BG_STARS[i];
            const px = ((st.x - this._cam.x * st.depth - this._pointerPar.x * st.depth * 3 + cx) % w + w) % w;
            const py = ((st.y - this._cam.y * st.depth - this._pointerPar.y * st.depth * 3 + cy) % h + h) % h;
            const tw = this.isReducedMotion() ? 1 : (0.78 + 0.22 * Math.sin(t * 0.9 + st.twinklePhase));
            ctx.fillStyle = _rgba(pal.bone, st.alpha * tw);
            ctx.beginPath();
            ctx.arc(px, py, st.r, 0, Math.PI * 2);
            ctx.fill();
        }

        // 2. Engraved astrolabe compass ring
        const astR = Math.min(w, h) * 0.44;
        ctx.save();
        ctx.translate(cx - this._cam.x * 0.12, cy - this._cam.y * 0.12);
        ctx.rotate(t * 0.008);
        ctx.strokeStyle = _rgba(pal.ink, 0.075);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, astR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, astR * 0.72, 0, Math.PI * 2);
        ctx.strokeStyle = _rgba(pal.bone, 0.04);
        ctx.stroke();
        for (let deg = 0; deg < 72; deg++) {
            const ang = (deg / 72) * Math.PI * 2;
            const major = deg % 6 === 0;
            const r1 = astR - (major ? 7 : 3);
            const r2 = astR + (major ? 3 : 0);
            ctx.beginPath();
            ctx.moveTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
            ctx.lineTo(Math.cos(ang) * r2, Math.sin(ang) * r2);
            ctx.strokeStyle = _rgba(pal.ink, major ? 0.14 : 0.06);
            ctx.stroke();
        }
        ctx.restore();

        const constAlpha = Math.max(0, 1 - this._morphPos * 1.15);
        const orreryAlpha = Math.max(0, (this._morphPos - 0.1) / 0.9);
        const scale = this._fitScale * this._cam.zoom;

        // 3. Constellations filaments + watermark sector titles
        if (constAlpha > 0.01 && this._constLayout) {
            ctx.save();
            const hoveredUnit = activeKey ? this._nodeByKey.get(activeKey)?.unit.id : null;
            for (const ed of this._constLayout.edges) {
                const a = this._nodeByKey.get(ed.from);
                const b = this._nodeByKey.get(ed.to);
                if (!a || !b) continue;
                const pa = this._worldToScreen(a.x, a.y);
                const pb = this._worldToScreen(b.x, b.y);
                const highlight = (this._activeSectorId === ed.unitId) || (hoveredUnit === ed.unitId);
                let alpha = (highlight ? 0.42 : (ed.chord ? 0.08 : 0.15)) * constAlpha;
                if (searchActive && !this._searchMatches.has(a.key) && !this._searchMatches.has(b.key)) alpha *= 0.25;

                ctx.beginPath();
                ctx.moveTo(pa.x, pa.y);
                ctx.lineTo(pb.x, pb.y);
                if (ed.transit) ctx.setLineDash([4, 5]);
                else ctx.setLineDash([]);
                ctx.strokeStyle = _rgba(highlight ? pal.ink : subjRgb, alpha);
                ctx.lineWidth = highlight ? 1.25 : 0.9;
                ctx.stroke();

                // Faint light bead gliding along active unit filaments
                if (!this.isReducedMotion() && !ed.chord && (highlight || this._activeSectorId === 'all')) {
                    const phase = ((t * 0.22 + (a.phase * 0.3)) % 1);
                    const bx = _lerp(pa.x, pb.x, phase);
                    const by = _lerp(pa.y, pb.y, phase);
                    ctx.fillStyle = _rgba(pal.bone, (highlight ? 0.55 : 0.22) * constAlpha);
                    ctx.beginPath();
                    ctx.arc(bx, by, highlight ? 1.5 : 1.0, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.setLineDash([]);

            // Sector italic watermarks
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = 'italic 500 18px "Cormorant Garamond", Georgia, serif';
            for (const sec of this._constLayout.sectors) {
                const ps = this._worldToScreen(sec.cx, sec.cy);
                const hl = this._activeSectorId === sec.id || hoveredUnit === sec.id;
                ctx.fillStyle = _rgba(hl ? pal.ink : pal.bone, (hl ? 0.32 : 0.12) * constAlpha);
                ctx.fillText(sec.label, ps.x, ps.y - 8);
            }
            ctx.restore();
        }

        // 4. Orrery concentric tracks + Subject Core Star
        if (orreryAlpha > 0.01 && this._orreryLayout) {
            ctx.save();
            const origin = this._worldToScreen(0, 0);
            for (const ring of this._orreryLayout.rings) {
                const rx = ring.radius * ring.aspect * scale;
                const ry = ring.radius * scale;
                ctx.beginPath();
                ctx.ellipse(origin.x, origin.y, rx, ry, 0, 0, Math.PI * 2);
                ctx.setLineDash(ring.dashed ? [4, 5] : []);
                ctx.strokeStyle = _rgba(ring.id === 'priority' ? pal.crit : pal.ink, (ring.id === 'priority' ? 0.22 : 0.13) * orreryAlpha);
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.setLineDash([]);
                ctx.font = '500 9px "IBM Plex Mono", ui-monospace, monospace';
                ctx.textAlign = 'center';
                ctx.fillStyle = _rgba(pal.bone, 0.32 * orreryAlpha);
                ctx.fillText(ring.label, origin.x, origin.y - ry - 6);
            }

            // Central Subject Core Star
            const coreR = 16 * Math.min(1.2, Math.max(0.85, scale));
            const coreGrad = ctx.createRadialGradient(origin.x, origin.y, 1, origin.x, origin.y, coreR * 2.4);
            coreGrad.addColorStop(0, _rgba(pal.bone, 0.9 * orreryAlpha));
            coreGrad.addColorStop(0.35, _rgba(subjRgb, 0.55 * orreryAlpha));
            coreGrad.addColorStop(1, _rgba(subjRgb, 0));
            ctx.fillStyle = coreGrad;
            ctx.beginPath();
            ctx.arc(origin.x, origin.y, coreR * 2.4, 0, Math.PI * 2);
            ctx.fill();

            ctx.font = '500 9.5px "IBM Plex Mono", ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = _rgba(pal.bone, 0.68 * orreryAlpha);
            ctx.fillText(String(this._payload.subject || '').toUpperCase(), origin.x, origin.y + coreR + 14);
            ctx.restore();
        }

        // 5. Flow Flight-Path Spline
        if (this._flowMode && this._flowPath.length > 0) {
            ctx.save();
            const pts = this._flowPath
                .map(k => this._nodeByKey.get(k))
                .filter(Boolean)
                .map(nd => this._worldToScreen(nd.x, nd.y));
            if (pts.length >= 2) {
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) {
                    const prev = pts[i - 1];
                    const cur = pts[i];
                    const mx = (prev.x + cur.x) * 0.5;
                    const my = (prev.y + cur.y) * 0.5;
                    const dx = cur.x - prev.x;
                    const dy = cur.y - prev.y;
                    ctx.quadraticCurveTo(mx - dy * 0.14, my + dx * 0.14, cur.x, cur.y);
                }
                ctx.strokeStyle = _rgba(pal.flow, 0.72);
                ctx.lineWidth = 1.8;
                ctx.setLineDash([6, 6]);
                ctx.lineDashOffset = this.isReducedMotion() ? 0 : -t * 24;
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.restore();
        }

        // 6. Search Sighting Beam
        if (searchActive && this._topSearchKey) {
            const topNd = this._nodeByKey.get(this._topSearchKey);
            if (topNd) {
                const p = this._worldToScreen(topNd.x, topNd.y);
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(w * 0.5, 24);
                ctx.lineTo(p.x, p.y);
                ctx.setLineDash([3, 5]);
                ctx.strokeStyle = _rgba(pal.ink, 0.34);
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }
        }

        // 7. Draw Chapter Planetary Star-Nodes + gather DOM label inputs
        const labelItems = [];
        const nodeScale = Math.min(1.25, Math.max(0.8, scale));

        for (let i = 0; i < this._nodes.length; i++) {
            const nd = this._nodes[i];
            const p = this._worldToScreen(nd.x, nd.y);
            nd.sx = p.x;
            nd.sy = p.y;

            const isMatched = !searchActive || this._searchMatches.has(nd.key);
            const isHovered = nd.key === this._hoveredKey;
            const isLocked = nd.key === this._lockedKey;
            const flowIdx = this._flowMode ? this._flowPath.indexOf(nd.key) : -1;
            const isFlowSelected = flowIdx >= 0;

            const dimFactor = isMatched ? 1 : 0.16;
            const starR = nd.starR * nodeScale * (1 + nd.hoverSpring * 0.16);
            const untouched = nd.qCount === 0 || (nd.attempted === 0 && nd.solved === 0);
            const critical = !untouched && (nd.dueErrors > 0 || (nd.health < 45 && nd.hitPct < 60));
            const mastered = !untouched && !critical && nd.health >= 75 && (nd.doneFrac >= 0.7 || nd.hitPct >= 80);

            let coreRgb = subjRgb;
            if (critical) coreRgb = pal.crit;
            else if (mastered) coreRgb = pal.bone;
            if (isFlowSelected) coreRgb = pal.flow;

            ctx.save();
            ctx.globalAlpha = dimFactor;

            // Corona / Aura
            if (!untouched) {
                const pulse = (critical && !this.isReducedMotion()) ? (0.85 + 0.25 * Math.sin(t * 2.2 + nd.phase)) : 1;
                const auraR = starR * (critical ? 2.5 : 2.15) * pulse;
                const g = ctx.createRadialGradient(p.x, p.y, starR * 0.2, p.x, p.y, auraR);
                g.addColorStop(0, _rgba(coreRgb, (critical ? 0.45 : 0.34) * pulse));
                g.addColorStop(1, _rgba(coreRgb, 0));
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(p.x, p.y, auraR, 0, Math.PI * 2);
                ctx.fill();
            }

            // Inclined planetary hairline ring (gently precessing)
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(nd.ringTilt + (this.isReducedMotion() ? 0 : Math.sin(t * 0.3 + nd.phase) * 0.08));
            ctx.beginPath();
            ctx.ellipse(0, 0, starR * 1.78, starR * 0.56, 0, 0, Math.PI * 2);
            ctx.strokeStyle = _rgba(isFlowSelected ? pal.flow : pal.bone, untouched ? 0.14 : 0.22);
            ctx.lineWidth = 0.85;
            ctx.stroke();
            ctx.restore();

            // Coverage resolution arc
            if (nd.doneFrac > 0.01) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, starR + 3.8, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * nd.doneFrac);
                ctx.strokeStyle = _rgba(isFlowSelected ? pal.flow : pal.ink, 0.78);
                ctx.lineWidth = 1.4;
                ctx.stroke();
            }

            // Core body (diamond comet for mocks, circle planet/star for syllabus)
            if (nd.isMock) {
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(Math.PI * 0.25);
                const dr = starR * 0.86;
                ctx.fillStyle = untouched ? 'rgba(10,12,18,0.85)' : _rgba(coreRgb, 0.92);
                ctx.strokeStyle = _rgba(pal.ink, 0.85);
                ctx.lineWidth = 1.1;
                ctx.fillRect(-dr, -dr, dr * 2, dr * 2);
                ctx.strokeRect(-dr, -dr, dr * 2, dr * 2);
                ctx.restore();
            } else {
                ctx.beginPath();
                ctx.arc(p.x, p.y, starR, 0, Math.PI * 2);
                if (untouched) {
                    ctx.fillStyle = 'rgba(8, 10, 16, 0.88)';
                    ctx.fill();
                    ctx.strokeStyle = _rgba(subjRgb, 0.45);
                    ctx.lineWidth = 1.1;
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
                    ctx.fillStyle = _rgba(subjRgb, 0.55);
                    ctx.fill();
                } else {
                    const bodyGrad = ctx.createRadialGradient(p.x - starR * 0.3, p.y - starR * 0.3, 1, p.x, p.y, starR);
                    bodyGrad.addColorStop(0, _rgba(pal.bone, mastered ? 1 : 0.88));
                    bodyGrad.addColorStop(0.55, _rgba(coreRgb, 0.92));
                    bodyGrad.addColorStop(1, _rgba(coreRgb, 0.42));
                    ctx.fillStyle = bodyGrad;
                    ctx.fill();
                    ctx.strokeStyle = _rgba(pal.bone, 0.35);
                    ctx.lineWidth = 0.8;
                    ctx.stroke();
                }

                // 4-point diffraction glint on mastered stars
                if (mastered) {
                    const sp = starR * 1.65;
                    ctx.strokeStyle = _rgba(pal.bone, 0.65);
                    ctx.lineWidth = 0.9;
                    ctx.beginPath();
                    ctx.moveTo(p.x - sp, p.y); ctx.lineTo(p.x + sp, p.y);
                    ctx.moveTo(p.x, p.y - sp); ctx.lineTo(p.x, p.y + sp);
                    ctx.stroke();
                }
            }

            // Orbiting satellite moons (due Vault errors in crimson, Flow-ready spark in ice)
            const dueMoons = Math.min(4, nd.dueErrors);
            for (let m = 0; m < dueMoons; m++) {
                const mOrbit = starR + 7.5;
                const mAng = nd.phase + m * ((Math.PI * 2) / Math.max(1, dueMoons)) + t * 0.85;
                const mx = p.x + Math.cos(mAng) * mOrbit;
                const my = p.y + Math.sin(mAng) * mOrbit;
                ctx.fillStyle = _rgba(pal.crit, 0.92);
                ctx.beginPath();
                ctx.arc(mx, my, 2.0, 0, Math.PI * 2);
                ctx.fill();
            }
            if (nd.flowCount > 0 && !isFlowSelected) {
                const fOrbit = starR + 10.5;
                const fAng = -nd.phase - t * 0.48;
                const fx = p.x + Math.cos(fAng) * fOrbit;
                const fy = p.y + Math.sin(fAng) * fOrbit;
                ctx.fillStyle = _rgba(pal.flow, 0.78);
                ctx.beginPath();
                ctx.arc(fx, fy, 1.5, 0, Math.PI * 2);
                ctx.fill();
            }

            // Flow waypoint ring + index badge
            if (isFlowSelected) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, starR + 7.5, 0, Math.PI * 2);
                ctx.strokeStyle = _rgba(pal.flow, 0.95);
                ctx.lineWidth = 1.6;
                ctx.stroke();
            }

            // Targeting 4-bracket reticle on hover / lock / search top match
            if (isHovered || isLocked || (searchActive && nd.key === this._topSearchKey)) {
                const rr = starR + 9.5;
                const b = 4.5;
                ctx.strokeStyle = _rgba(isFlowSelected ? pal.flow : pal.ink, isLocked ? 0.95 : 0.72);
                ctx.lineWidth = 1.25;
                ctx.beginPath();
                ctx.moveTo(p.x - rr, p.y - rr + b); ctx.lineTo(p.x - rr, p.y - rr); ctx.lineTo(p.x - rr + b, p.y - rr);
                ctx.moveTo(p.x + rr - b, p.y - rr); ctx.lineTo(p.x + rr, p.y - rr); ctx.lineTo(p.x + rr, p.y - rr + b);
                ctx.moveTo(p.x - rr, p.y + rr - b); ctx.lineTo(p.x - rr, p.y + rr); ctx.lineTo(p.x - rr + b, p.y + rr);
                ctx.moveTo(p.x + rr - b, p.y + rr); ctx.lineTo(p.x + rr, p.y + rr); ctx.lineTo(p.x + rr, p.y + rr - b);
                ctx.stroke();
            }

            // Arrival / birth radial ripple
            if ((this._arrivalKey === nd.key || this._birthKey === nd.key) && !this.isReducedMotion()) {
                const endMs = this._arrivalKey === nd.key ? this._arrivalEndMs : this._birthEndMs;
                const prog = _clamp(1 - (endMs - now) / 600, 0, 1);
                const ripR = starR + 6 + prog * 28;
                ctx.beginPath();
                ctx.arc(p.x, p.y, ripR, 0, Math.PI * 2);
                ctx.strokeStyle = _rgba(pal.ink, (1 - prog) * 0.75);
                ctx.lineWidth = 1.4;
                ctx.stroke();
            }

            ctx.restore();

            const el = this._labelEls.get(nd.key);
            labelItems.push({
                key: nd.key,
                sx: p.x,
                sy: p.y,
                starR,
                fullW: el ? el._fullW : 100,
                shortW: el ? el._shortW : 76,
                labelH: el ? el._labelH : 22,
                priority: nd.weight * 2 + (nd.dueErrors > 0 ? 0.4 : 0) + (nd.qCount > 0 ? 0.2 : 0),
                forceVisible: isHovered || isLocked || isFlowSelected || (searchActive && isMatched),
            });
        }

        // 8. Collision-free DOM label layout
        const safeInsets = {
            left: 12,
            right: 12,
            top: 56,
            bottom: this._flowMode ? 112 : (this._lockedKey ? 132 : 58),
        };
        const placements = resolveLabelCollisions(labelItems, { width: w, height: h }, safeInsets);
        for (const nd of this._nodes) {
            const el = this._labelEls.get(nd.key);
            const pl = placements.get(nd.key);
            if (!el || !pl) continue;
            const isMatched = !searchActive || this._searchMatches.has(nd.key);
            const flowIdx = this._flowMode ? this._flowPath.indexOf(nd.key) : -1;
            const nameEl = el.querySelector('.cg-lbl-name');
            const targetText = pl.mode === 'short' ? el._shortText : el._fullText;
            if (nameEl && nameEl.textContent !== targetText) nameEl.textContent = targetText;

            el.style.transform = `translate3d(${pl.x.toFixed(1)}px, ${pl.y.toFixed(1)}px, 0)`;
            el.dataset.tier = pl.visible ? pl.mode : 'hidden';
            el.tabIndex = pl.visible ? 0 : -1;
            el.setAttribute('aria-hidden', pl.visible ? 'false' : 'true');
            el.classList.toggle('is-dimmed', !isMatched);
            el.classList.toggle('is-hovered', nd.key === this._hoveredKey);
            el.classList.toggle('is-locked', nd.key === this._lockedKey);
            el.classList.toggle('is-flow-picked', flowIdx >= 0);
            if (flowIdx >= 0) el.dataset.flowOrder = String(flowIdx + 1).padStart(2, '0');
            else delete el.dataset.flowOrder;
        }

        ctx.restore();
    }

    getDebugState() {
        return {
            viewMode: this._viewMode,
            lens: this._lens,
            active: this._active,
            flowMode: this._flowMode,
            flowPath: this._flowPath.slice(),
            nodeCount: this._nodes.length,
            frameCount: this._frameCount,
            rafRunning: !!this._rafId,
            morphPos: this._morphPos,
            cam: { ...this._cam },
            activeSectorId: this._activeSectorId,
            lockedKey: this._lockedKey,
            hoveredKey: this._hoveredKey,
            searchMatches: Array.from(this._searchMatches),
        };
    }
}

export const ChapterGalaxy = new AstrolabeGalaxyController();
if (isBrowser) {
    window.ChapterGalaxy = ChapterGalaxy;
}
