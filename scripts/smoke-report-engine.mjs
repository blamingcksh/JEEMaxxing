// smoke-report-engine.mjs — pure aggregation tests for report.js (no DOM).
// Run: node scripts/smoke-report-engine.mjs
import {
    buildQuestionFacts,
    aggregateTags,
    aggregateBands,
    buildMistakeReport,
    renderReportText,
    renderReportHtml,
    buildMockAutopsy,
    parseFrictionTypes,
    expectedWinProb,
    UNRATED,
} from '../report.js';

let failures = 0;
const ok = (cond, name) => {
    if (cond) console.log('  ✓', name);
    else { console.error('  ✗ FAIL:', name); failures++; }
};

console.log('Smart report engine — pure tests');

// ── parseFrictionTypes: JSON string / array / bare token / garbage ──
console.log('[parseFrictionTypes]');
ok(JSON.stringify(parseFrictionTypes('["CALC","CONCEPT"]')) === JSON.stringify(['CALC', 'CONCEPT']), 'JSON string parsed');
ok(JSON.stringify(parseFrictionTypes(['PERFECT'])) === JSON.stringify(['PERFECT']), 'array passthrough');
ok(JSON.stringify(parseFrictionTypes('CONCEPT')) === JSON.stringify(['CONCEPT']), 'bare token → [token]');
ok(parseFrictionTypes('').length === 0 && parseFrictionTypes(null).length === 0, 'empty/null → []');

// ── expectedWinProb mirrors mock.js pWin convention ──
console.log('[expectedWinProb]');
ok(Math.abs(expectedWinProb(1200, 1200) - 0.5) < 1e-9, 'equal Elo → 0.5');
ok(expectedWinProb(1500, 1000) > 0.5, 'favourite gets >0.5');

// ── Fixtures ──
const NOW = Date.parse('2025-06-15T10:00:00Z');           // trend reference point
const D = (iso) => iso;

const qRotation = {   // mistake ×2 events, concept friction, overconfident, slow
    id: 'rot1', subject: 'physics', chapter: 'Rotation',
    tags: ['Rotation', 'Torque'], qElo: 1650, errorReason: '',
    historyLogs: [
        { timestamp: D('2025-05-01T10:00:00Z'), result: 'incorrect', frictionTypes: '["CONCEPT"]', timeSpentMins: 6, confidence: 'sure' },
        { timestamp: D('2025-05-20T10:00:00Z'), result: 'correct', frictionTypes: '[]', timeSpentMins: 3, confidence: 'likely' },
        { timestamp: D('2025-06-10T10:00:00Z'), result: 'incorrect', frictionTypes: '["CONCEPT","CALC"]', timeSpentMins: 9, confidence: 'sure' },
    ],
};
const qCalc = {       // recent wrong only, fast fail; shares 'Rotation' tag so the
                        // Rotation row folds two questions (one rated, one unrated)
    id: 'calc1', subject: 'maths', chapter: 'Definite Integral',
    tags: ['Integration', 'Rotation'], qElo: 700,   // below grid → Unrated
    historyLogs: [
        { timestamp: D('2025-06-14T09:00:00Z'), result: 'incorrect', frictionTypes: '["CALC"]', timeSpentMins: 1, confidence: 'guess' },
    ],
};
const qClean = {      // no tags → untagged; no logs; vault mistake via errorReason
    id: 'clean1', subject: 'chemistry', chapter: 'Mole Concept',
    tags: [], qElo: 1250, errorReason: 'misread', historyLogs: [],
};
const qMastered = {   // clean + mastered
    id: 'mst1', subject: 'physics', chapter: 'Optics',
    tags: ['Optics'], qElo: 1900, isMastered: true,
    historyLogs: [
        { timestamp: D('2025-03-02T10:00:00Z'), result: 'correct', frictionTypes: '["PERFECT"]', timeSpentMins: 4 },
    ],
};

const bank = [qRotation, qCalc, qClean, qMastered];

// ── buildQuestionFacts ──
console.log('[buildQuestionFacts]');
const fRot = buildQuestionFacts(qRotation, NOW);
ok(fRot.isMistake === true, 'wrong logs ⇒ mistake');
ok(fRot.band === 'T4_ADV_EASY', '1650 → T4_ADV_EASY');
ok(fRot.wrongEvents === 2 && fRot.attempts === 3, 'log event counts');
ok(fRot.repeatOffender === true, '2 wrong events ⇒ repeat offender');
ok(fRot.overconfidentWrongs === 2, 'sure-but-wrong counted');
ok(fRot.frictionCounts.CONCEPT === 2 && fRot.frictionCounts.CALC === 1, 'friction counts from JSON-string logs');
ok(fRot.recentWrongs === 1 && fRot.priorWrongs === 1, '30d/60d window split');
ok(fRot.timeSignal === 'slow', 'slow-wrong detected (9m vs 3m right)');
const fCalc = buildQuestionFacts(qCalc, NOW);
ok(fCalc.band === UNRATED, '700 below grid → honest Unrated bucket');
ok(fCalc.timeSignal === 'fast', 'fast-fail detected (1m)');
const fClean = buildQuestionFacts(qClean, NOW);
ok(fClean.isMistake === true && fClean.tags[0] === 'untagged', 'vault-only mistake + untagged fallback');
ok(fClean.frictionSource === 'vault' && fClean.frictionCounts.MISREAD === 1, 'errorReason mapped to MISREAD when no logs');
const fMst = buildQuestionFacts(qMastered, NOW);
ok(!fMst.isMistake && fMst.band === 'T5_PAPER_ADV', 'clean mastered question stays clean');

// ── aggregateTags ──
console.log('[aggregateTags]');
const facts = bank.map(q => buildQuestionFacts(q, NOW));
const tagRows = aggregateTags(facts, { elo: { physics: 1500 } });
const rot = tagRows.find(r => r.tag === 'Rotation');
ok(!!rot, 'Rotation row exists');
ok(rot.mistakes === 2 && rot.questions === 2, 'Rotation folds both tagged questions');
ok(rot.dominantFriction === 'CONCEPT', 'dominant friction = CONCEPT (2-2 tie broken by severity)');
ok(rot.avgQelo === 1650, 'avg qElo counts rated questions only (700 is out-of-grid)');
// loss mass = Σ win-prob of lost questions: rated T4 miss @elo1500 + unrated miss @default1200
ok(Math.abs(rot.lossMass - Math.round((expectedWinProb(1500, 1650) + expectedWinProb(1200, 700)) * 100) / 100) < 1e-9,
    'loss mass = exact sum of per-mistake win probabilities');
const untaggedRow = tagRows.find(r => r.tag === 'untagged');
ok(!!untaggedRow && untaggedRow.mistakes === 1, 'untagged bucket carries its mistake');
ok(tagRows[0].mistakes >= tagRows[tagRows.length - 1].mistakes, 'sorted by mistakes desc');

// ── aggregateBands ──
console.log('[aggregateBands]');
const bandRows = aggregateBands(facts);
const unratedBand = bandRows.find(b => b.band === UNRATED);
ok(unratedBand.questions === 1 && unratedBand.mistakes === 1, 'Unrated bucket populated');
const t4 = bandRows.find(b => b.band === 'T4_ADV_EASY');
ok(t4.questions === 1 && t4.mistakes === 1, 'T4 bucket populated');

// ── buildMistakeReport ──
console.log('[buildMistakeReport]');
const rep = buildMistakeReport(bank, { scopeText: 'unit test', now: NOW, elo: { physics: 1500 } });
ok(rep.kpis.questions === 4 && rep.kpis.mistakes === 3, 'KPI totals');
ok(rep.kpis.attempts === 5 && rep.kpis.mastered === 1, 'attempt + mastery totals');
ok(rep.leak.unrated === 1, 'unrated leak counted separately');
ok(Array.isArray(rep.signals), 'signals array present');
ok(rep.actions.length >= 1 && rep.actions[0].tag === 'Rotation', 'weakest-tag action first');
ok(typeof rep.actions[0].action === 'string' && rep.actions[0].action.length > 10, 'prescription text present');

// empty inputs never crash
const emptyRep = buildMistakeReport([], { now: NOW });
ok(emptyRep.kpis.questions === 0 && emptyRep.tagRows.length === 0 && Array.isArray(emptyRep.bandRows), 'empty bank → zeroed report, no crash');

// ── renderReportText ──
console.log('[renderReportText]');
const txt = renderReportText(rep);
ok(txt.includes('SMART MISTAKE REPORT'), 'header present');
ok(txt.includes('WHERE IT HURTS'), 'tag leaderboard section present');
ok(txt.includes('DIFFICULTY PROFILE'), 'difficulty section present');
ok(txt.includes('NEXT ACTIONS') || rep.actions.length === 0, 'actions section present');
ok(renderReportText(emptyRep).split('\n').length < 40, 'empty report stays compact');

// bounded even with many tags
const manyTags = [];
for (let i = 0; i < 40; i++) {
    manyTags.push({
        id: 'x' + i, subject: 'physics', chapter: 'C', tags: ['Tag' + i],
        qElo: 900 + i * 20, errorReason: 'conceptual',
        historyLogs: [{ timestamp: '2025-05-05T10:00:00Z', result: 'incorrect', frictionTypes: '["CONCEPT"]', timeSpentMins: 2 }],
    });
}
const bigRep = buildMistakeReport(manyTags, { now: NOW });
const bigTxt = renderReportText(bigRep, { maxTags: 14 });
ok(bigRep.tagRows.length === 40 && bigTxt.split('\n').length < 90, 'text output bounded with 40 tags (+N-more line)');

// ── renderReportHtml ──
console.log('[renderReportHtml]');
const html = renderReportHtml(rep);
ok(html.includes('rp-kpis') && html.includes('rp-table'), 'preview structure classes present');
const evil = [{ id: 'e1', subject: 'physics', chapter: 'X', tags: ['<img src=x onerror=alert(1)>'], qElo: 1200, errorReason: 'conceptual', historyLogs: [] }];
const evilHtml = renderReportHtml(buildMistakeReport(evil, { now: NOW }));
ok(!evilHtml.includes('<img src=x'), 'malicious tag name escaped in HTML');
ok(evilHtml.includes('&lt;img'), 'escape artifact visible');

// ── buildMockAutopsy ──
console.log('[buildMockAutopsy]');
const qById = { rot1: qRotation, calc1: qCalc, clean1: qClean };
const aut = buildMockAutopsy(['rot1', 'calc1', 'clean1'], qById, NOW);
ok(aut.total === 3, 'autopsy total');
ok(aut.byTag[0].count === 2 && aut.byTag[0].tag === 'Rotation', 'multi-tag question counted under each tag, ranked');
ok(aut.byBand.some(b => b.band === UNRATED && b.count === 1), 'autopsy difficulty rows include Unrated');
ok(aut.text.includes('By topic:') && aut.text.includes('By difficulty:'), 'clipboard text lines built');
ok(buildMockAutopsy([], qById, NOW) === null, 'empty wrongIds → null');
ok(buildMockAutopsy(['ghost'], qById, NOW) === null, 'unknown ids → null');

console.log(failures === 0 ? '\nAll report-engine tests passed.' : '\n' + failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
