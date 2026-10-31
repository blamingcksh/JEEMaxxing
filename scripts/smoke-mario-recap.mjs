import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classify, resolveSessionVerdict, SessionRecap } from '../mario-recap.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

const ok = (cond, name) => {
    if (cond) console.log('  ok  ' + name);
    else {
        console.error('  FAIL  ' + name);
        failures++;
    }
};

const eq = (actual, expected, name) => {
    ok(Object.is(actual, expected), name + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
};

console.log('-- Mario recap smoke test --');

eq(classify({ correct: false, secs: 1, targetSecs: 120 }), 'red', 'wrong answers are always red');
eq(classify({ correct: true, secs: 130, targetSecs: 120 }), 'green', 'correct slower than target is green');
eq(classify({ correct: true, secs: 120, targetSecs: 120 }), 'green', 'correct exactly at target is green');
eq(classify({ correct: true, secs: 60, targetSecs: 120 }), 'purple', 'correct under target is purple');
eq(classify({ correct: true, secs: 0, targetSecs: 120 }), 'green', 'zero solve time is green');
eq(classify({ correct: true, secs: 12 }), 'green', 'missing target time is green');
eq(classify({ correct: true, secs: -4, targetSecs: 90 }), 'green', 'negative solve time is green');
eq(classify({ correct: true, secs: 12, targetSecs: 0 }), 'green', 'zero target time is green');

SessionRecap.reset();
const q1 = { id: 'q1' };
const q2 = { id: 'q2' };
const q3 = { id: 'q3' };
const q4 = { id: 'q4' };
const q5 = { id: 'q5' };

ok(SessionRecap.record(q1, { correct: false, secs: 5, targetSecs: 60 }), 'records first attempt');
ok(!SessionRecap.record(q1, { correct: true, secs: 2, targetSecs: 60 }), 'ignores repeat attempt for same question');
ok(SessionRecap.record(q2, { correct: true, secs: 70, targetSecs: 60 }), 'records green outcome');
ok(SessionRecap.record(q3, { correct: true, secs: 10, targetSecs: 60 }), 'records purple outcome');
ok(SessionRecap.record(q4, { correct: true, secs: 20, targetSecs: 60 }), 'records second purple outcome');
ok(SessionRecap.record(q5, { correct: true, secs: 90, targetSecs: 60 }), 'records slow green outcome');
ok(!SessionRecap.record({ id: 'q6' }, null), 'ignores empty result');

eq(SessionRecap.hasResults(), true, 'hasResults after recording');
const summary = SessionRecap.summarize();
eq(summary.total, 5, 'summary total');
eq(summary.green, 2, 'summary green count');
eq(summary.purple, 2, 'summary purple count');
eq(summary.red, 1, 'summary red count');
eq(summary.correct, 4, 'summary correct count');
eq(summary.accuracyPct, 80, 'summary accuracy');

SessionRecap.reset();
eq(SessionRecap.hasResults(), false, 'reset clears results');
eq(SessionRecap.summarize().total, 0, 'reset summary total');
eq(SessionRecap.summarize().accuracyPct, 0, 'empty accuracy is zero');
eq(SessionRecap.play(), null, 'play returns null with no results');

SessionRecap.reset();
SessionRecap.record(null, { correct: true, secs: 1, targetSecs: 60 });
eq(SessionRecap.summarize().total, 0, 'questionless results are not recorded');

// Skip + Elo delta tests
SessionRecap.reset();
const sk1 = { id: 'sk1' };
const sk2 = { id: 'sk2' };
const eq1 = { id: 'eq1' };
ok(SessionRecap.recordSkip(sk1), 'records skipped question');
ok(!SessionRecap.recordSkip(sk1), 'does not duplicate skip for same question');
ok(SessionRecap.recordSkip(sk2), 'records second skipped question');
eq(SessionRecap.summarize().skipped, 2, 'summary skipped count is 2');
eq(SessionRecap.summarize().total, 0, 'skips do not inflate solved total');
ok(SessionRecap.record(sk1, { correct: true, secs: 15, targetSecs: 60 }), 'upgrades skipped question to answered in place');
ok(SessionRecap.noteElo(sk1, 14), 'attaches +14 Elo to upgraded question');
ok(SessionRecap.record(eq1, { correct: false, secs: 40, targetSecs: 60, eloDelta: -6 }), 'records wrong question with inline -6 Elo');
ok(!SessionRecap.recordSkip(eq1), 'cannot downgrade answered question to skip');
const skSummary = SessionRecap.summarize();
eq(skSummary.total, 2, 'upgraded skip + answered = 2 solved');
eq(skSummary.skipped, 1, 'remaining skip count is 1');
eq(skSummary.purple, 1, 'upgraded skip became purple');
eq(skSummary.red, 1, 'second answered is red');
eq(skSummary.hasElo, true, 'hasElo is true when Elo deltas recorded');
eq(skSummary.netElo, 8, 'netElo sums +14 and -6 to +8');

// Finale Big Block & Princess verdict tests
const posVerdict = resolveSessionVerdict({ total: 3, skipped: 1, hasElo: true, netElo: 18 });
eq(posVerdict.megaOutcome, 'green', 'positive net Elo merges into green Big Block');
eq(posVerdict.hasVictory, true, 'positive net Elo triggers Princess & Congratulations finale');
eq(posVerdict.popText, '+18', 'positive net Elo Big Block pops +18');

const zeroVerdict = resolveSessionVerdict({ total: 2, skipped: 0, hasElo: true, netElo: 0 });
eq(zeroVerdict.megaOutcome, 'green', 'zero net Elo with solved questions merges into green Big Block');
eq(zeroVerdict.hasVictory, false, 'zero net Elo keeps castle door closed');
eq(zeroVerdict.popText, '±0', 'zero net Elo Big Block pops ±0');

const negVerdict = resolveSessionVerdict({ total: 3, skipped: 0, hasElo: true, netElo: -12 });
eq(negVerdict.megaOutcome, 'red', 'negative net Elo merges into red Big Block');
eq(negVerdict.hasVictory, false, 'negative net Elo keeps castle door closed');
eq(negVerdict.popText, '−12', 'negative net Elo Big Block pops −12');

const skipVerdict = resolveSessionVerdict({ total: 0, skipped: 3, hasElo: false, netElo: 0 });
eq(skipVerdict.megaOutcome, 'grey', 'all-skipped session merges into grey Big Block');
eq(skipVerdict.hasVictory, false, 'all-skipped session keeps castle door closed');
eq(skipVerdict.popText, 'SKIP', 'all-skipped Big Block pops SKIP');

const source = readFileSync(join(root, 'mario-recap.js'), 'utf8');
const css = readFileSync(join(root, 'mario-recap.css'), 'utf8');
const app = readFileSync(join(root, 'app.js'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const sw = readFileSync(join(root, 'sw.js'), 'utf8');

ok(!/https?:\/\//.test(source), 'recap engine has no remote URLs');
ok(!/https?:\/\//.test(css), 'recap stylesheet has no remote URLs');
ok(!/@import/.test(css), 'recap stylesheet has no remote imports');
ok(source.includes('export function classify'), 'classifier is exported');
ok(source.includes('export const SessionRecap'), 'SessionRecap is exported');
ok(source.includes('prefers-reduced-motion'), 'reduced motion is handled');
ok(source.includes('mario-recap-pill'), 'single summary pill exists');
ok(!source.includes('mario-recap-continue'), 'legacy continue control is removed');
ok(!source.includes('mario-recap-sound'), 'no floating sound button on recap overlay');
ok(source.includes('wantMarioSound'), 'sound engine is gated by config preference');
ok(source.includes('playSkip'), 'sound engine includes skip dud sound');
ok(source.includes('spawnEloPop'), 'scene spawns Elo pops on block hit');
ok(source.includes('spawnMegaEloPop'), 'scene spawns net Elo pop on Big Block hit');
ok(source.includes('drawMergingBlocks'), 'scene smoothly merges blocks into Big Block');
ok(source.includes('drawCastle'), 'scene draws Mario Castle');
ok(source.includes('PRINCESS_SPRITES'), 'scene includes Princess Peach sprites');
ok(source.includes('playCongratulations'), 'sound engine includes Congratulations fanfare');
ok(source.includes('playSomberEnd'), 'sound engine includes somber jingle for negative Elo');
ok(html.includes('id="fx-mario-sound"'), 'config panel has Mario Recap Sounds toggle');
ok(!source.includes('aria-modal'), 'overlay does not claim modal semantics');
ok(css.includes('z-index: 2147483100'), 'overlay sits above existing layers');
ok(css.includes('backdrop-filter'), 'overlay blurs the app behind it');
ok(css.includes('.mr-count.is-grey'), 'stylesheet styles grey skipped counter');
ok(css.includes('.mr-elo.is-pos'), 'stylesheet styles net Elo badge');
ok(app.includes("from './mario-recap.js'"), 'app imports recap engine');
ok(app.includes('SessionRecap.reset()'), 'app resets per run');
ok(app.includes('_recordSessionRecap(AppState.currentQ'), 'app records graded answers');
ok(app.includes('_noteSessionElo(AppState.currentQ'), 'app records Elo deltas for recap blocks');
ok(app.includes('_noteSessionSkip('), 'app records skipped questions for recap blocks');
ok(app.includes('SessionRecap.play({ tone: recapTone })'), 'app plays recap on close');
ok(/closeModalStr\('practice-modal'\);[\s\S]{0,180}SessionRecap\.play\(\{ tone/.test(app), 'recap starts synchronously after the stage closes');
ok(!/setTimeout\([^)]*SessionRecap\.play/.test(app), 'recap start is not deferred');
ok(app.includes("recapTone = 'parchment'"), 'app carries the parchment stage into the recap');
ok(source.includes('is-parchment'), 'recap supports a parchment veil');
ok(app.includes('window.__jmaxAppToast || alert'), 'queue-cleared notice falls back to toast');
ok(app.includes('window.SessionRecap = SessionRecap'), 'recap is exposed for QA and bridge code');
ok(html.includes('href="mario-recap.css"'), 'index loads recap stylesheet');
ok(sw.includes("'jeemax-v83'"), 'service worker version bumped');
ok(sw.includes("'./mario-recap.js'"), 'recap engine is precached');
ok(sw.includes("'./mario-recap.css'"), 'recap stylesheet is precached');

if (failures) {
    console.error('\n' + failures + ' check(s) failed.');
    process.exit(1);
}
console.log('\nAll Mario recap checks passed.');
