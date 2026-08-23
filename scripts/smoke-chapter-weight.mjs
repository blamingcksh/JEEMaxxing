// smoke-chapter-weight.mjs — resolution-tier tests for chapter-weights.js.
// Pure Node. Run: node scripts/smoke-chapter-weight.mjs
import {
    resolveChapterWeight,
    getChapterWeight,
    JEE_CHAPTER_WEIGHTS,
    DEFAULT_CHAPTER_WEIGHT,
} from '../chapter-weights.js';

let failures = 0;
const ok = (cond, name) => {
    if (cond) console.log('  ✓', name);
    else { console.error('  ✗ FAIL:', name); failures++; }
};

console.log('Chapter weightage resolver — tier tests');

// ── Tier 2: EXACT ──
console.log('[exact]');
ok(resolveChapterWeight('GOC').weight === 1.0 && resolveChapterWeight('GOC').source === 'exact', 'GOC exact (case-insensitive)');
ok(resolveChapterWeight('  Rotational Mechanics ').weight === 1.0, 'whitespace-tolerant exact');

// ── Tier 4: ALIAS — the user-saved-short-name case ──
console.log('[alias]');
const rot = resolveChapterWeight('rotation');
ok(rot.weight === 1.0 && rot.source === 'alias' && rot.matched === 'rotational mechanics', '\'rotation\' → Rotational Mechanics via alias');
ok(resolveChapterWeight('ray optics').matched === 'geometrical optics', '\'ray optics\' alias');
ok(resolveChapterWeight('pnc').weight === 0.8, '\'pnc\' alias (perms & combs)');
ok(resolveChapterWeight('3d').weight === 0.9, '\'3d\' alias');

// ── Tier 5: FUZZY token/prefix ──
console.log('[fuzzy]');
const mp = resolveChapterWeight('Modern Phy');
ok(mp.source === 'match' && mp.matched === 'modern physics' && mp.weight === 0.95, '\'Modern Phy\' prefix-match');
const ce = resolveChapterWeight('current electricity numericals');
ok(ce.source === 'match' && ce.matched === 'current electricity', 'extra words tolerated when core matches');
const rotp = resolveChapterWeight('Irodov rotation special problems');
ok(rotp.weight >= 0.9, '\'Irodov rotation special problems\' stays high-yield (' + rotp.source + ' → ' + rotp.weight + ')');

// ── Tier 6: TYPO ──
console.log('[typo]');
const typo1 = resolveChapterWeight('roation');
ok(typo1.source === 'typo' || typo1.source === 'alias', '\'roation\' corrected (via=' + typo1.source + ')');
ok(typo1.weight >= 0.95, '\'roation\' inherits rotation-class weight: ' + typo1.weight);
const typo2 = resolveChapterWeight('modren physics');
ok(typo2.weight === 0.95 && (typo2.source === 'typo'), '\'modren physics\' corrected to modern physics');

// ── Tier 7: UNIT — genuinely niche topics ──
console.log('[unit]');
const niche1 = resolveChapterWeight('wave particle duality basics');
ok(niche1.source === 'unit' && niche1.weight >= 0.6, 'niche modern-physics topic inherits unit weight (' + niche1.weight + ')');
const niche2 = resolveChapterWeight('torque practice set 3');
ok(niche2.weight >= 0.9, 'torque-family niche topic stays critical (' + niche2.weight + ')');
const niche3 = resolveChapterWeight('random misc readings');
ok(niche3.source === 'default' && niche3.weight === DEFAULT_CHAPTER_WEIGHT, 'truly unknowable → honest default');

// ── Dynamic tiers: USER > exact > AI ──
console.log('[dynamic]');
const u = resolveChapterWeight('GOC', { overrides: { goc: 0.3 } });
ok(u.source === 'user' && u.weight === 0.3, 'user override beats calibrated table');
const a1 = resolveChapterWeight('my custom electrostatics drill', { ai: { 'my custom electrostatics drill': 1.0 } });
ok(a1.source === 'ai' && a1.weight === 1.0, 'AI stamp fills the gap for unknown names');
const a2 = resolveChapterWeight('goc', { ai: { goc: 0.2 } });
ok(a2.source === 'exact' && a2.weight === 1.0, 'AI never overrides calibrated table entries');
const u2 = resolveChapterWeight('goc', { overrides: {}, ai: { goc: 0.9 }, });
ok(u2.source === 'exact', 'empty override map falls through cleanly');

// ── Robustness ──
console.log('[robust]');
ok(getChapterWeight('') === DEFAULT_CHAPTER_WEIGHT, 'empty name → default');
ok(getChapterWeight(null) === DEFAULT_CHAPTER_WEIGHT, 'null name → default');
ok(typeof getChapterWeight('anything at all') === 'number' && isFinite(getChapterWeight('anything')), 'always finite number');
ok(Object.keys(JEE_CHAPTER_WEIGHTS).length > 80, 'table coverage sane (' + Object.keys(JEE_CHAPTER_WEIGHTS).length + ' keys)');

console.log('');
if (failures > 0) { console.error(failures + ' tier test(s) FAILED'); process.exit(1); }
console.log('All chapter-weightage tier tests passed.');