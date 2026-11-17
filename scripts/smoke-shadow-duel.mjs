// Unit smoke test for Shadow Duel engine (shadow-duel.js)
// Run: node scripts/smoke-shadow-duel.mjs

import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
};

const {
    DUEL_PRESETS,
    DUEL_STAKES,
    createDuelState,
    preRollGhostAttempt,
    resolveDuelQuestion,
    repriceDuelQuestion,
    findTurningPointSplit,
    formatDuelSplitSummary,
    formatDuelSplitRich,
    formatDuelBadgeText,
    getDuelPreviewIntel,
    isDuelMatchPoint,
    finalizeDuel,
    loadDuelStats,
    getSavedGhostRuns,
    loadLastDuelPrefs,
    saveLastDuelPrefs,
} = await import('../shadow-duel.js');

let passed = 0;
function ok(cond, label) {
    assert.ok(cond, label);
    passed++;
    console.log(`  ✓ ${label}`);
}

console.log('── [1] Presets, Stakes, & AIR Inverse Targets ──');
{
    ok(DUEL_PRESETS.air5000.fixedElo === 2010, 'AIR 5000 matches inverse AIR ELO 2010');
    ok(DUEL_PRESETS.air1000.fixedElo === 2336, 'AIR 1000 matches inverse AIR ELO 2336');
    ok(DUEL_PRESETS.air500.fixedElo === 2477, 'AIR 500 matches inverse AIR ELO 2477');
    ok(DUEL_STAKES.elo10.winElo === 20 && DUEL_STAKES.elo10.lossElo === 10, '10 ELO stake escrow/payout ratio is +20 / -10');
    ok(DUEL_STAKES.shield.winShield === 1 && DUEL_STAKES.shield.lossShield === 1, 'Shield stake escrow risks 1 shield for +1 shield + 20 ELO');

    const def = loadLastDuelPrefs();
    ok(def.preset === 'off', 'Default duel preference starts opted-out (off)');
    saveLastDuelPrefs({ preset: 'air1000', stake: 'elo25', airTier: 'air1000' });
    const saved = loadLastDuelPrefs();
    ok(saved.preset === 'air1000' && saved.stake === 'elo25', 'Duel prefs round-trip cleanly');
}

console.log('── [2] Deterministic Pre-Roll & Multi-Subject +100 Rival ──');
{
    const d1 = createDuelState({ preset: 'rival100', stake: 'elo10', subject: 'physics', runId: 'det-run-1' });
    const qPhys = { id: 'q1', subject: 'physics', chapter: 'Electrostatics', qElo: 1450 };
    const r1 = preRollGhostAttempt(d1, qPhys, { userElo: 1400, targetSecs: 180, chapterAvgSecs: 170 });
    const r2 = preRollGhostAttempt(d1, qPhys, { userElo: 1400, targetSecs: 180, chapterAvgSecs: 170 });
    ok(r1 && r1.ghostElo === 1500, '+100 Rival tracks user subject ELO + 100 (1400 -> 1500)');
    ok(r1 === r2 && r1.verdict === r2.verdict && r1.secs === r2.secs, 'Pre-roll is idempotent when called repeatedly for the active Q');

    // Fresh duel with same runId produces exact same roll (seeded PRNG)
    const d2 = createDuelState({ preset: 'rival100', stake: 'elo10', subject: 'physics', runId: 'det-run-1' });
    const r3 = preRollGhostAttempt(d2, qPhys, { userElo: 1400, targetSecs: 180, chapterAvgSecs: 170 });
    ok(r3.verdict === r1.verdict && r3.secs === r1.secs, 'Deterministic PRNG yields reproducible ghost attempt for identical seed');

    // Switch subject mid-run -> adaptive +100 tracks new subject ELO
    resolveDuelQuestion(d1, qPhys, { userCorrect: true, userSecs: 100, ctx: { userElo: 1400, targetSecs: 180 } });
    const qChem = { id: 'q2', subject: 'chemistry', chapter: 'Ionic Equilibrium', qElo: 1650 };
    const rChem = preRollGhostAttempt(d1, qChem, { userElo: 1720, targetSecs: 150 });
    ok(rChem.ghostElo === 1820, '+100 Rival dynamically adapts when switching to Chemistry (1720 -> 1820)');
}

console.log('── [3] Scoring Matrix, Skip Triage & Re-Pricing Override ──');
{
    const d = createDuelState({ preset: 'air1000', stake: 'elo10', subject: 'physics', runId: 'score-matrix' });

    // Force known ghost verdicts by setting currentGhost directly (pre-rolled state)
    // Steal: user ✓, ghost ✗ -> +2 user
    d.currentGhost = { qId: 's1', qElo: 1600, targetSecs: 180, ghostElo: 2336, verdict: 'wrong', secs: 140, source: 'model' };
    const s1 = resolveDuelQuestion(d, { id: 's1', subject: 'physics', chapter: 'Optics' }, { userCorrect: true, userSecs: 110 });
    ok(s1.userPtsDelta === 2 && s1.ghostPtsDelta === 0 && s1.outcome === 'steal', 'Steal awards +2 user / 0 ghost');

    // Speed loss: both ✓, user slower -> +1 ghost
    d.currentGhost = { qId: 's2', qElo: 1600, targetSecs: 180, ghostElo: 2336, verdict: 'correct', secs: 95, source: 'model' };
    const s2 = resolveDuelQuestion(d, { id: 's2', subject: 'physics', chapter: 'Optics' }, { userCorrect: true, userSecs: 130 });
    ok(s2.userPtsDelta === 0 && s2.ghostPtsDelta === 1 && s2.outcome === 'speed_loss', 'Slower solve awards Ghost +1');
    ok(formatDuelSplitSummary(s2, 'AIR-1000').includes('35s SLOWER'), 'Split summary formats pace delta accurately');

    // Override answer key -> reprice s2 from user correct (slower) to user wrong -> Blunder (+2 ghost)
    const repriced = repriceDuelQuestion(d, { id: 's2' }, false);
    ok(repriced.outcome === 'blunder' && repriced.ghostPtsDelta === 2 && d.ghostPts === 2 && d.userPts === 2,
        'repriceDuelQuestion updates split from speed_loss (+1) to blunder (+2)');

    // Smart triage skip when ghost skips -> 0 / 0
    d.currentGhost = { qId: 's3', qElo: 2550, targetSecs: 240, ghostElo: 2336, verdict: 'skip', secs: 25, source: 'model' };
    const s3 = resolveDuelQuestion(d, { id: 's3', subject: 'physics', chapter: 'Optics' }, { isSkip: true, userSecs: 20 });
    ok(s3.outcome === 'smart_triage' && s3.userPtsDelta === 0 && s3.ghostPtsDelta === 0, 'Smart trap skip when ghost skips/misses costs 0');

    // Skip punish when ghost solves -> +1 ghost
    d.currentGhost = { qId: 's4', qElo: 1500, targetSecs: 180, ghostElo: 2336, verdict: 'correct', secs: 80, source: 'model' };
    const s4 = resolveDuelQuestion(d, { id: 's4', subject: 'physics', chapter: 'Optics' }, { isSkip: true, userSecs: 25 });
    ok(s4.outcome === 'skip_punished' && s4.ghostPtsDelta === 1 && d.ghostPts === 3, 'Skipping when ghost solves awards Ghost +1');
}

console.log('── [4] AIR Benchmark Trap-Skip Behavior ──');
{
    let skipSeen = false;
    for (let i = 0; i < 40; i++) {
        const d = createDuelState({ preset: 'air5000', stake: 'none', subject: 'maths', runId: `trap-${i}` });
        const qHard = { id: `h-${i}`, subject: 'maths', chapter: 'Complex Numbers', qElo: 2550 };
        const roll = preRollGhostAttempt(d, qHard, { userElo: 1400, targetSecs: 240 });
        if (roll.verdict === 'skip') { skipSeen = true; break; }
    }
    ok(skipSeen, 'AIR preset exhibits smart trap skips on ultra-low P_win questions');
}

console.log('── [5] Yesterday You Real Split Replay & Tau Pace Scaling ──');
{
    localStorage.clear();
    // Run 1: baseline fallback (no prior runs)
    const run1 = createDuelState({ preset: 'yesterday', stake: 'none', subject: 'physics', runId: 'y-1' });
    ok(run1.replaySplits === null, 'First Yesterday You run has no prior trace yet');
    const qA = { id: 'ya1', subject: 'physics', chapter: 'Rotation', qElo: 1500 };
    const preA = preRollGhostAttempt(run1, qA, { userElo: 1500, targetSecs: 180 });
    ok(preA.source === 'baseline', 'First Yesterday You run falls back cleanly to same-ELO baseline');

    // Complete 4 graded splits cleanly: user finishes Q1 in 90s / target 180s (tau = 0.5), Q2 wrong in 180s / 180s (tau = 1.0)
    run1.splits = [];
    run1.currentGhost = { qId: 'ya1', qElo: 1500, targetSecs: 180, ghostElo: 1500, verdict: 'wrong', secs: 160, source: 'baseline' };
    resolveDuelQuestion(run1, qA, { userCorrect: true, userSecs: 90, ctx: { targetSecs: 180 } });
    for (const [id, corr, secs] of [['ya2', false, 180], ['ya3', true, 120], ['ya4', true, 150]]) {
        run1.currentGhost = { qId: id, qElo: 1500, targetSecs: 180, ghostElo: 1500, verdict: 'wrong', secs: 170, source: 'baseline' };
        resolveDuelQuestion(run1, { id, subject: 'physics', chapter: 'Rotation' }, { userCorrect: corr, userSecs: secs, ctx: { targetSecs: 180 } });
    }
    const set1 = finalizeDuel(run1);
    ok(set1.outcome === 'win' && set1.eloDelta === 8, 'Run 1 qualified win settles cleanly (+8 ELO)');
    ok(getSavedGhostRuns().length === 1, 'Finished qualifying run saved to Replay archive');

    // Run 2: Yesterday You replays real outcomes and scales Q1 tau=0.5 against new targetSecs=120 -> 60s
    const run2 = createDuelState({ preset: 'yesterday', stake: 'elo10', subject: 'physics', runId: 'y-2' });
    ok(Array.isArray(run2.replaySplits) && run2.replaySplits.length === 4, 'Run 2 loads real 4-split replay trace from Yesterday You');
    const rep1 = preRollGhostAttempt(run2, { id: 'nq1', subject: 'physics' }, { userElo: 1550, targetSecs: 120 });
    ok(rep1.source === 'replay' && rep1.verdict === 'correct' && rep1.secs === 60, 'Replay Q1 preserves ✓ outcome & scales tau=0.5 against new target 120s -> 60s');
    run2.currentGhost = rep1;
    resolveDuelQuestion(run2, { id: 'nq1', subject: 'physics' }, { userCorrect: true, userSecs: 70 });
    const rep2Actual = preRollGhostAttempt(run2, { id: 'nq2', subject: 'physics' }, { userElo: 1550, targetSecs: 120 });
    ok(rep2Actual.source === 'replay' && rep2Actual.verdict === 'wrong' && rep2Actual.secs === 120, 'Replay Q2 preserves real historical miss (✗)');
}

console.log('── [6] Minimum 4-Q Qualification, Turning-Point Kill-Cam & 3-Win Streak Shield ──');
{
    localStorage.clear();
    // Sub-threshold (< 4 Qs) is unqualified with 0 penalty even if trailing
    const shortDuel = createDuelState({ preset: 'air500', stake: 'elo25', subject: 'chemistry', runId: 'short-1' });
    for (let i = 1; i <= 3; i++) {
        shortDuel.currentGhost = { qId: `q${i}`, qElo: 1700, targetSecs: 180, ghostElo: 2477, verdict: 'correct', secs: 80, source: 'model' };
        resolveDuelQuestion(shortDuel, { id: `q${i}`, subject: 'chemistry', chapter: 'Thermodynamics' }, { userCorrect: false, userSecs: 140 });
    }
    ok(isDuelMatchPoint(shortDuel, 200, true) === false, 'Score 0 vs 6 is not Match Point');
    const sShort = finalizeDuel(shortDuel);
    ok(sShort.outcome === 'unqualified' && sShort.eloDelta === 0, 'Finish with <4 graded Qs returns Unranked with 0 ELO stake lost');

    // Check Match Point badge when within 1 pt late in final block
    const mpDuel = createDuelState({ preset: 'rival100', stake: 'elo10', subject: 'maths', runId: 'mp-1' });
    for (let i = 1; i <= 3; i++) {
        mpDuel.currentGhost = { qId: `m${i}`, qElo: 1500, targetSecs: 180, ghostElo: 1600, verdict: 'correct', secs: 100, source: 'model' };
        resolveDuelQuestion(mpDuel, { id: `m${i}`, subject: 'maths', chapter: 'Matrices' }, { userCorrect: true, userSecs: i === 1 ? 80 : 120 });
    }
    // User has 1 pt, Ghost has 2 pts -> within 1 pt, >= 3 graded Qs!
    ok(isDuelMatchPoint(mpDuel, 240, true) === true, 'Match Point activates within 1 pt late in final round');
    ok(formatDuelBadgeText(mpDuel, { isFinalNearEnd: true }).startsWith('MATCH POINT'), 'Badge switches to MATCH POINT');

    // Finish mpDuel as a 4-Q loss -> Turning point kill-cam points to exact Q
    mpDuel.currentGhost = { qId: 'm4', qElo: 1600, targetSecs: 180, ghostElo: 1600, verdict: 'correct', secs: 75, source: 'model' };
    resolveDuelQuestion(mpDuel, { id: 'm4', subject: 'maths', chapter: 'Determinants' }, { userCorrect: false, userSecs: 160 });
    const lossSet = finalizeDuel(mpDuel);
    ok(lossSet.outcome === 'loss' && lossSet.eloDelta === -10, '4-Q loss settles escrow (-10 ELO)');
    ok(lossSet.turningPointText.includes('Q4') && lossSet.turningPointText.includes('Determinants'), 'Turning point identifies Q4 blunder with chapter name');

    // Forfeit mid-block when trailing on >= 2 Qs
    const fDuel = createDuelState({ preset: 'air1000', stake: 'shield', subject: 'physics', runId: 'forfeit-1' });
    for (let i = 1; i <= 2; i++) {
        fDuel.currentGhost = { qId: `f${i}`, qElo: 1600, targetSecs: 180, ghostElo: 2336, verdict: 'correct', secs: 90, source: 'model' };
        resolveDuelQuestion(fDuel, { id: `f${i}`, subject: 'physics', chapter: 'SHM' }, { userCorrect: false, userSecs: 150 });
    }
    const forfeitRes = finalizeDuel(fDuel, { forfeit: true });
    ok(forfeitRes.outcome === 'forfeit' && forfeitRes.shieldDelta === -1, 'Mid-block forfeit burns 1 wagered Shield');

    // 3-win streak earns +1 extra bonus Shield on the 3rd win!
    for (let w = 1; w <= 3; w++) {
        const wDuel = createDuelState({ preset: 'rival100', stake: 'elo10', subject: 'physics', runId: `win-${w}` });
        for (let i = 1; i <= 4; i++) {
            wDuel.currentGhost = { qId: `w${w}-${i}`, qElo: 1400, targetSecs: 180, ghostElo: 1500, verdict: 'wrong', secs: 150, source: 'model' };
            resolveDuelQuestion(wDuel, { id: `w${w}-${i}`, subject: 'physics', chapter: 'Kinematics' }, { userCorrect: true, userSecs: 90 });
        }
        const res = finalizeDuel(wDuel);
        if (w < 3) {
            ok(!res.streakShieldEarned && res.shieldDelta === 0, `Win #${w} increments streak without bonus shield yet`);
        } else {
            ok(res.winStreak === 3 && res.streakShieldEarned === true && res.shieldDelta === 1, 'Win #3 awards +1 Streak Bonus Shield!');
        }
    }
    ok(loadDuelStats().bestStreak === 3, 'Stats record best win streak of 3');
}

console.log('── [7] Psychological Setup Intel, Urgency Framing & Rich Split Autopsy ──');
{
    localStorage.clear();
    const firstIntel = getDuelPreviewIntel({ preset: 'yesterday', stake: 'elo25', userElo: 1500, subject: 'physics' });
    ok(firstIntel.intelTitle.includes('Calibration') && firstIntel.stakesLine.includes('1550') && firstIntel.stakesLine.includes('1475'),
        'Preview intel shows baseline calibration copy and concrete win/loss resulting ELO (1550 / 1475)');

    // Lose 2 matches -> slump debt badge appears + rich autopsy identifies blunder & splits tape
    for (let l = 1; l <= 2; l++) {
        const dLoss = createDuelState({ preset: 'air1000', stake: 'elo10', subject: 'physics', runId: `loss-${l}` });
        for (let q = 1; q <= 4; q++) {
            dLoss.currentGhost = { qId: `lq${l}-${q}`, qElo: 1650, targetSecs: 180, ghostElo: 2336, verdict: 'correct', secs: 70 + q * 5, source: 'model' };
            resolveDuelQuestion(dLoss, { id: `lq${l}-${q}`, subject: 'physics', chapter: 'Gravitation' }, {
                userCorrect: q === 1,
                userSecs: 130,
            });
        }
        const badge = formatDuelBadgeText(dLoss, { isFinalNearEnd: false });
        ok(badge.includes('DOWN') && badge.includes('ELO RISK') && badge.includes('🔥×'), 'Trailing badge surfaces point deficit, ELO at risk, and Ghost streak heat');
        const rich = formatDuelSplitRich(dLoss.splits[0], dLoss);
        ok(rich && rich.sub.includes('DOWN') && rich.sub.includes('−10 ELO'), 'Rich split surfaces deficit urgency and bleeding stake');
        const fin = finalizeDuel(dLoss);
        ok(fin.lossStreak === l && fin.splits.length === 4 && fin.splits.some(s => s.isTurningPoint),
            `Loss #${l} returns full 4-row tape with turning-point flag & lossStreak=${l}`);
        ok(fin.verdictHeadline.includes('AIR 1000') && fin.userStats.avgSecs === 130, 'Autopsy calculates exact verdict & per-Q pace');
    }

    const debtIntel = getDuelPreviewIntel({ preset: 'air1000', stake: 'elo25', userElo: 1500, subject: 'physics' });
    ok(debtIntel.recordTone === 'debt' && debtIntel.recordText.includes('SLUMP'), 'Preview surfaces debt slump alert after 2 consecutive losses');
}

console.log(`\nALL SHADOW DUEL ENGINE TESTS PASSED! (${passed} assertions)\n`);
process.exit(0);
