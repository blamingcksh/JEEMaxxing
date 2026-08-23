/**
 * chapter-weights.js — JEE Advanced chapter weightage resolution.
 *
 * PURE module (zero deps, Node-testable). Answers: "how much does this
 * chapter matter for MY exam rank?" even when the user named the chapter
 * "rotation", "roation", "Modern Phy" or something the table has never
 * seen.
 *
 * Resolution tiers (first hit wins):
 *   1. USER      — explicit override set from the UI (highest authority)
 *   2. EXACT     — normalized name matches the calibrated table key
 *   3. AI        — Gemini-stamped during ingestion (gemini gem prompt.txt)
 *   4. ALIAS     — common short forms / synonyms ('rotation', 'shm', 'goc')
 *   5. FUZZY     — token+prefix overlap ('rotation problems', 'Modern Phy')
 *   6. TYPO      — bounded Levenshtein distance ('roation', 'modren physics')
 *   7. UNIT      — syllabus-unit keyword family (niche topics inherit their
 *                  unit's typical weight, e.g. anything optics-ish ≈ 0.82)
 *   8. DEFAULT   — honest ignorance: flat 0.5, flagged as such in the UI
 *
 * Every resolution returns PROVENANCE ({weight, source, matched}) so the UI
 * can show WHY a chapter got its weight — silent magic numbers are how trust
 * dies. getChapterWeight() stays the back-compat numeric shortcut.
 */

export const DEFAULT_CHAPTER_WEIGHT = 0.5;

/** Approximate JEE Adv share-of-paper per chapter, 0–1 scale. EDITABLE DATA. */
export const JEE_CHAPTER_WEIGHTS = {
    // ── Physics ──
    'rotational mechanics': 1.0, 'electrostatics': 1.0, 'current electricity': 1.0,
    'electromagnetic induction': 0.9, 'alternating current': 0.8, 'magnetic effects of current': 0.9,
    'magnetism': 0.85, 'geometrical optics': 0.85, 'wave optics': 0.8, 'modern physics': 0.95,
    'dual nature of matter and radiation': 0.75, 'atoms and nuclei': 0.7,
    'semiconductors': 0.6, 'thermodynamics': 0.85, 'kinetic theory of gases': 0.7,
    'kinematics': 0.6, 'laws of motion': 0.65, 'work power and energy': 0.8,
    'gravitation': 0.6, 'mechanical properties of solids': 0.5,
    'mechanical properties of fluids': 0.6, 'thermal properties of matter': 0.55,
    'oscillations': 0.7, 'shm': 0.7, 'waves': 0.65, 'sound': 0.5,
    'capacitance': 0.8, 'communication systems': 0.3, 'units and dimensions': 0.4,
    'vectors': 0.35, 'experimental physics': 0.4,
    // ── Chemistry ──
    'goc': 1.0, 'general organic chemistry': 1.0, 'coordination compounds': 0.95,
    'chemical bonding': 0.95, 'p-block': 0.8, 'd and f block': 0.75,
    'qualitative analysis': 0.7, 'thermochemistry': 0.7, 'chemical equilibrium': 0.8,
    'ionic equilibrium': 0.85, 'electrochemistry': 0.85, 'chemical kinetics': 0.8,
    'solutions': 0.7, 'solid state': 0.6, 'atomic structure': 0.65,
    'mole concept': 0.7, 'stoichiometry': 0.65, 'hydrocarbons': 0.75,
    'haloalkanes and haloarenes': 0.65, 'alcohols phenols and ethers': 0.7,
    'aldehydes and ketones': 0.8, 'carboxylic acids': 0.65, 'amines': 0.7,
    'biomolecules': 0.5, 'polymers': 0.4, 'chemistry in everyday life': 0.35,
    'metallurgy': 0.5, 'redox reactions': 0.6, 'hydrogen': 0.35, 's-block': 0.55,
    'periodic table': 0.6, 'classification of elements': 0.5, 'environmental chemistry': 0.3,
    'stereochemistry': 0.8, 'isomerism': 0.75, 'reaction mechanism': 0.9,
    // ── Maths ──
    'definite integration': 1.0, 'definite integrals': 1.0, 'integration': 0.95,
    'indefinite integration': 0.8, 'complex numbers': 0.9, 'vectors and 3d': 0.95,
    'three dimensional geometry': 0.9, 'matrices and determinants': 0.9,
    'probability': 0.85, 'permutations and combinations': 0.8,
    'quadratic equations': 0.75, 'sequences and series': 0.8,
    'straight lines': 0.7, 'circles': 0.75, 'conic sections': 0.85,
    'parabola': 0.7, 'ellipse': 0.65, 'hyperbola': 0.6,
    'limits continuity and differentiability': 0.85, 'limits': 0.7,
    'differentiation': 0.75, 'application of derivatives': 0.7,
    'functions': 0.75, 'inverse trigonometric functions': 0.6,
    'trigonometry': 0.65, 'trigonometric ratios and identities': 0.6,
    'trigonometric equations': 0.55, 'solution of triangles': 0.5,
    'binomial theorem': 0.7, 'mathematical reasoning': 0.35, 'statistics': 0.45,
    'sets relations and functions': 0.6, 'differential equations': 0.75,
    'area under curves': 0.7, 'heights and distances': 0.35,
};

// Common short forms / synonyms → canonical table keys. Keys here are ALSO
// typo-checked against, so 'roation' resolves through its neighbor 'rotation'.
export const CHAPTER_ALIASES = {
    // physics shorthand
    'rotation': 'rotational mechanics',
    'rotational motion': 'rotational mechanics',
    'rotor': 'rotational mechanics',
    'emf': 'electromagnetic induction',
    'emi': 'electromagnetic induction',
    'emi ac': 'electromagnetic induction',
    'electrodynamics': 'electrostatics',
    'electricity': 'current electricity',
    'magnetics': 'magnetic effects of current',
    'magnetic effects': 'magnetic effects of current',
    'magnetostatics': 'magnetic effects of current',
    'capacitors': 'capacitance',
    'geo optics': 'geometrical optics',
    'ray optics': 'geometrical optics',
    'optics': 'wave optics',
    'kTG': 'kinetic theory of gases',
    'ktg': 'kinetic theory of gases',
    'gases': 'kinetic theory of gases',
    'thermo': 'thermodynamics',
    'heat': 'thermal properties of matter',
    'calorimetry': 'thermal properties of matter',
    'elasticity': 'mechanical properties of solids',
    'fluids': 'mechanical properties of fluids',
    'fluid mechanics': 'mechanical properties of fluids',
    'shm oscillations': 'oscillations',
    'simple harmonic motion': 'oscillations',
    'sound waves': 'sound',
    'nuclear physics': 'atoms and nuclei',
    'atoms': 'atoms and nuclei',
    'nuclei': 'atoms and nuclei',
    'dual nature': 'dual nature of matter and radiation',
    'photoelectric effect': 'dual nature of matter and radiation',
    'semiconductor devices': 'semiconductors',
    'electronics': 'semiconductors',
    'errors': 'units and dimensions',
    'measurement': 'units and dimensions',
    'dimensions': 'units and dimensions',
    // chemistry shorthand
    'organic': 'general organic chemistry',
    'organic chemistry': 'general organic chemistry',
    'mechanisms': 'reaction mechanism',
    'coordination': 'coordination compounds',
    'coordination chemistry': 'coordination compounds',
    'bonding': 'chemical bonding',
    'p block': 'p-block',
    'd f block': 'd and f block',
    'df block': 'd and f block',
    'transition elements': 'd and f block',
    'salt analysis': 'qualitative analysis',
    'equilibrium': 'chemical equilibrium',
    'ionic eq': 'ionic equilibrium',
    'electrochem': 'electrochemistry',
    'kinetics': 'chemical kinetics',
    'solutions colligative': 'solutions',
    'colligative properties': 'solutions',
    'solid state chemistry': 'solid state',
    'mole': 'mole concept',
    'stoich': 'stoichiometry',
    'haloalkanes': 'haloalkanes and haloarenes',
    'alcohol phenol ether': 'alcohols phenols and ethers',
    'ape': 'alcohols phenols and ethers',
    'aldehydes': 'aldehydes and ketones',
    'ketones': 'aldehydes and ketones',
    'carboxylic acid': 'carboxylic acids',
    'amine': 'amines',
    'nitrogen containing compounds': 'amines',
    'metallurgical operations': 'metallurgy',
    'redox': 'redox reactions',
    'periodicity': 'periodic table',
    'periodic properties': 'periodic table',
    'stereo': 'stereochemistry',
    'isomers': 'isomerism',
    // maths shorthand
    'definite': 'definite integration',
    'definite integral': 'definite integration',
    'integrals': 'integration',
    'integral calculus': 'integration',
    'indefinite': 'indefinite integration',
    'complex': 'complex numbers',
    'imaginary numbers': 'complex numbers',
    '3d': 'three dimensional geometry',
    '3d geometry': 'three dimensional geometry',
    'vectors 3d': 'vectors and 3d',
    'vector algebra': 'vectors and 3d',
    'matrices': 'matrices and determinants',
    'determinants': 'matrices and determinants',
    'perms combs': 'permutations and combinations',
    'pnc': 'permutations and combinations',
    'quadratics': 'quadratic equations',
    'sequences': 'sequences and series',
    'progressions': 'sequences and series',
    'sp series': 'sequences and series',
    'straight line': 'straight lines',
    'coordinate geometry': 'straight lines',
    'conics': 'conic sections',
    'limits continuity differntiability': 'limits continuity and differentiability',
    'lcd': 'limits continuity and differentiability',
    'limits continuity': 'limits continuity and differentiability',
    'derivatives': 'differentiation',
    'aod': 'application of derivatives',
    'inverse trig': 'inverse trigonometric functions',
    'trig': 'trigonometry',
    'trig ratios': 'trigonometric ratios and identities',
    'trig identities': 'trigonometric ratios and identities',
    'trig equations': 'trigonometric equations',
    'triangles': 'solution of triangles',
    'binomial': 'binomial theorem',
    'reasoning': 'mathematical reasoning',
    'sets relations': 'sets relations and functions',
    'relation function': 'sets relations and functions',
    'de': 'differential equations',
    'differential eq': 'differential equations',
    'auc': 'area under curves',
    'area': 'area under curves',
};

// Syllabus-unit fallbacks for genuinely unknown/niche names: if the topic
// mentions a family keyword, inherit a conservative unit-typical weight.
export const UNIT_KEYWORD_RULES = [
    [/\brota|torque|moment of inertia|angular/, 0.95, 'mechanics (rotation family)'],
    [/\boptic|lens|mirror|refract|interference|diffract|polariz/, 0.82, 'optics family'],
    [/electro|magnet|circuit|capacit|induct|current|ohm|kirchhoff/, 0.85, 'electricity \u0026 magnetism family'],
    [/thermo|heat|calorimet|expansion|ktg|gas law/, 0.78, 'thermal family'],
    [/organic|iupac|named reaction|hydrocarbon|functional group|isomer|chirality/, 0.78, 'organic chemistry family'],
    [/periodic|block element|coordination|ligand|metallurg|hydrometallurg/, 0.72, 'inorganic chemistry family'],
    [/equilibrium|electrochem|kinetic|thermochem|solution|colligative|mole|stoichi/, 0.74, 'physical chemistry family'],
    [/integrat|derivative|differentiat|limit|continuity|differentiab/, 0.88, 'calculus family'],
    [/conic|parabol|ellips|hyperbol|circle|line|coordinate/, 0.75, 'coordinate geometry family'],
    [/vector|three dimension|3d|direction cosin/, 0.92, 'vectors \u0026 3D family'],
    [/probabilit|combinat|permutat|binomial|arrangement/, 0.82, 'counting \u0026 probability family'],
    [/matrix|determinant/, 0.9, 'matrices family'],
    [/complex|argand|de moivre|euler form/, 0.9, 'complex numbers family'],
    [/trigonometr|triangle|identity|sin |cos |tan /, 0.62, 'trigonometry family'],
    [/sequence|progression|ap |gp |arithmet|geometric series/, 0.8, 'sequences family'],
    [/modern|nuclear|radioactiv|photoelectric|dual|de broglie|semiconductor|diode/, 0.8, 'modern physics family'],
];

// ── normalization helpers ────────────────────────────────────────────────────
function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
const STOPWORDS = new Set(['and', 'of', 'the', 'for', 'in', 'on', 'with', 'to', 'a', 'an']);
function tokenize(s) {
    return norm(s).split(' ').filter(t => t.length >= 3 && !STOPWORDS.has(t));
}
// Prefix-aware token equality: 'rotation'↔'rotational', 'phy'↔'physics'.
function tokMatch(a, b) {
    if (a === b) return true;
    if (a.length >= 4 && b.startsWith(a)) return true;
    if (b.length >= 4 && a.startsWith(b)) return true;
    return false;
}
function lev(a, b) {
    // Bounded-length DP (names ≤ 40 chars); classic two-row implementation.
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return Math.max(m, n);
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        cur[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        const t = prev; prev = cur; cur = t;
    }
    return prev[n];
}
function clampW(w) {
    const n = Number(w);
    return (isFinite(n) && n > 0) ? Math.max(0.05, Math.min(1.5, n)) : null;
}

const _memo = new Map();   // normKey → {weight, source, matched} (static tiers only)

function _staticResolve(nk, tokensNk) {
    // 2. EXACT
    if (Object.prototype.hasOwnProperty.call(JEE_CHAPTER_WEIGHTS, nk)) {
        return { weight: clampW(JEE_CHAPTER_WEIGHTS[nk]), source: 'exact', matched: nk };
    }
    // 4. ALIAS
    if (Object.prototype.hasOwnProperty.call(CHAPTER_ALIASES, nk)) {
        const target = CHAPTER_ALIASES[nk];
        if (Object.prototype.hasOwnProperty.call(JEE_CHAPTER_WEIGHTS, target)) {
            return { weight: clampW(JEE_CHAPTER_WEIGHTS[target]), source: 'alias', matched: target };
        }
    }
    // 6. TYPO — bounded edit distance against keys + aliases. Runs BEFORE the
    // fuzzy tier because transpositions ('modren') survive token matching but
    // collapse instantly under Levenshtein.
    let typoBest = null;
    const tryTypo = (key, via) => {
        const d = lev(nk, key);
        const tol = nk.length <= 8 ? 1 : 2;
        if (d <= tol && d / nk.length <= 0.4 && (!typoBest || d < typoBest.d || (d === typoBest.d && key.length > typoBest.key.length))) typoBest = { d, key, via };
    };
    for (const key of Object.keys(JEE_CHAPTER_WEIGHTS)) tryTypo(key, 'typo');
    for (const key of Object.keys(CHAPTER_ALIASES)) tryTypo(key, 'typo');
    if (typoBest) {
        const target = Object.prototype.hasOwnProperty.call(JEE_CHAPTER_WEIGHTS, typoBest.key)
            ? typoBest.key
            : CHAPTER_ALIASES[typoBest.key];
        const w = clampW(target != null ? JEE_CHAPTER_WEIGHTS[target] : NaN);
        if (w != null) return { weight: w, source: 'typo', matched: target };
    }
    // 5. FUZZY — token+prefix overlap against every table key AND alias key.
    // Acceptance needs USER-SIDE COVERAGE: at least half the user's meaningful
    // words must land in the candidate, and a lone hit must be an EXACT token
    // match. This is what stops 'wave particle duality basics' from collapsing
    // into the sound chapter ('waves') or 'wave optics' off one generic word.
    // Ranking: more hits first, then the longer (more specific) canonical name.
    let best = null;
    const consider = (key) => {
        const kt = tokenize(key);
        if (!kt.length || !tokensNk.length) return;
        let hits = 0;
        let exactHit = false;
        for (const t of tokensNk) {
            for (const k of kt) {
                if (tokMatch(t, k)) { hits++; if (t === k) exactHit = true; break; }
            }
        }
        if (hits < 1) return;
        const coverage = hits / tokensNk.length;
        if (coverage < 0.5) return;
        if (hits === 1 && !exactHit) return;   // vague lone prefix — not enough
        const better = !best || hits > best.hits || (hits === best.hits && key.length > best.matched.length);
        if (better) best = { hits, matched: key };
    };
    for (const key of Object.keys(JEE_CHAPTER_WEIGHTS)) consider(key);
    for (const key of Object.keys(CHAPTER_ALIASES)) consider(key);
    if (best) {
        const resolved = Object.prototype.hasOwnProperty.call(JEE_CHAPTER_WEIGHTS, best.matched)
            ? best.matched
            : CHAPTER_ALIASES[best.matched];
        const w = clampW(resolved != null ? JEE_CHAPTER_WEIGHTS[resolved] : NaN);
        if (w != null) return { weight: w, source: 'match', matched: resolved };
    }
    // 7. UNIT — keyword-family inheritance for genuinely niche topics.
    for (const [re, w, label] of UNIT_KEYWORD_RULES) {
        if (re.test(nk)) return { weight: clampW(w), source: 'unit', matched: label };
    }
    // 8. DEFAULT — honest ignorance.
    return { weight: DEFAULT_CHAPTER_WEIGHT, source: 'default', matched: null };
}

/**
 * Full provenance resolution. Dynamic tiers (user/AI) are checked fresh each
 * call; the static chain is memoized per normalized name.
 * @param {string} rawName chapter name exactly as the user saved it
 * @param {{overrides?:Object, ai?:Object}} [maps] AppState.userChapterWeights / AppState.chapterWeights
 * @returns {{weight:number, source:string, matched:string|null}}
 */
export function resolveChapterWeight(rawName, maps) {
    const m = maps || {};
    const nk = norm(rawName);
    if (!nk) return { weight: DEFAULT_CHAPTER_WEIGHT, source: 'default', matched: null };
    // 1. USER override — always wins, checked live (never memoized).
    if (m.overrides && typeof m.overrides === 'object') {
        const u = clampW(m.overrides[nk]);
        if (u != null) return { weight: u, source: 'user', matched: null };
    }
    // 2. EXACT (checked before AI so calibrated data always beats model guesses)
    if (Object.prototype.hasOwnProperty.call(JEE_CHAPTER_WEIGHTS, nk)) {
        return { weight: clampW(JEE_CHAPTER_WEIGHTS[nk]), source: 'exact', matched: nk };
    }
    // 3. AI-stamped during ingestion — fills gaps for renamed/niche chapters.
    if (m.ai && typeof m.ai === 'object') {
        const a = clampW(m.ai[nk]);
        if (a != null) return { weight: a, source: 'ai', matched: null };
    }
    if (!_memo.has(nk)) _memo.set(nk, _staticResolve(nk, tokenize(nk)));
    return _memo.get(nk);
}

/** Back-compat numeric shortcut (used by grid/risk math hot paths). */
export function getChapterWeight(chapter, maps) {
    return resolveChapterWeight(chapter, maps).weight;
}