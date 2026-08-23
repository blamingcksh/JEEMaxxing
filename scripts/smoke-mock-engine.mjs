// smoke-mock-engine.mjs — pure scoring tests for mock.js (no DOM).
// Run: node scripts/smoke-mock-engine.mjs
import {
    normalizeAnswerInput,
    gradeAnswer,
    computeMockScorecard,
    parseBulkKey,
    pWin,
} from '../mock.js';

let failures = 0;
const ok = (cond, name) => {
    if (cond) console.log('  ✓', name);
    else { console.error('  ✗ FAIL:', name); failures++; }
};

console.log('Mock engine — scoring core tests');

const single = { type: 'mcq', correctAnswer: 'B', qElo: 1500 };
const multi  = { type: 'mcq', correctAnswer: ['A', 'C'], qElo: 1800 };
const numeric= { type: 'numeric', correctAnswer: '42', qElo: 1400 };

console.log('[normalize]');
ok(JSON.stringify(normalizeAnswerInput('c,a', 'multi')) === JSON.stringify(['A', 'C']), 'multi input sorted/uppercased');
ok(JSON.stringify(normalizeAnswerInput('', 'single')) === '[]', 'empty single → []');
ok(normalizeAnswerInput(' 7.50 ', 'numeric') === '7.50', 'numeric trimmed');

console.log('[grade: single +4/−1]');
ok(gradeAnswer(single, 'B').marks === 4 && gradeAnswer(single, 'B').correct, 'correct → +4');
ok(gradeAnswer(single, 'C').marks === -1 && !gradeAnswer(single, 'C').correct, 'wrong → −1');
ok(gradeAnswer(single, '').marks === 0 && !gradeAnswer(single, '').attempted, 'skipped → 0');

console.log('[grade: multi JEE scheme]');
ok(gradeAnswer(multi, 'A,C').marks === 4, 'exact set → +4 full');
ok(gradeAnswer(multi, 'a,c').marks === 4, 'case-insensitive exact');
ok(gradeAnswer(multi, 'A').marks === 1, 'partial no-wrong → +1 per hit');
ok(gradeAnswer(multi, 'A,B,C').marks === -2, 'any wrong selection → −2');
ok(gradeAnswer(multi, '').marks === 0 && !gradeAnswer(multi, '').attempted, 'skipped multi → 0');

console.log('[grade: numeric +4/0]');
ok(gradeAnswer(numeric, '42').marks === 4, 'exact numeric → +4');
ok(gradeAnswer(numeric, '41.9').marks === 0 && gradeAnswer(numeric, '41.9').attempted, 'wrong numeric → 0 (attempted)');
ok(gradeAnswer(numeric, 'abc').marks === 0, 'garbage numeric → 0 not crash');

console.log('[scorecard]');
const mock = {
    sections: {
        physics:   { questionIds: ['s1', 'n1'], keys: {} },
        chemistry: { questionIds: [], keys: {} },
        maths:     { questionIds: [], keys: {} },
    },
    run: { answers: { s1: { value: 'B', confidence: 'sure' }, n1: { value: '', confidence: null } } },
};
const qById = { s1: single, n1: numeric };
const sc = computeMockScorecard(mock, qById);
ok(sc.total === 4 && sc.max === 8, 'total marks computed (4/8)');
ok(sc.sections.length === 3 && sc.sections[0].marks === 4, 'per-section rows present');
ok(sc.brier != null && Math.abs(sc.brier - Math.pow(0.92 - 1, 2)) < 1e-9, 'Brier uses sure anchor vs outcome');
ok(sc.predicted > 0 && isFinite(sc.predicted), 'predicted score finite from Elo model');

console.log('[bulk key parser]');
const k = parseBulkKey('1 A\n2) AC\n3: 42\njunk line');
ok(k['1'] === 'A' && k['2'] === 'AC' && k['3'] === '42' && k['4'] === undefined, 'key lines parsed, junk ignored');

console.log('[pWin sanity]');
ok(Math.abs(pWin(1500, 1500) - 0.5) < 1e-9, 'equal ratings → 0.5');
ok(pWin(2000, 1200) > 0.85, 'big edge → high win prob');

console.log('');
if (failures > 0) { console.error(failures + ' mock-engine test(s) FAILED'); process.exit(1); }
console.log('All mock-engine scoring tests passed.');