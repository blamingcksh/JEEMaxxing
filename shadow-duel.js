// ==================== SHADOW DUEL MODULE ====================
// Competitive shadow-racing engine integrated with Sign the Pact (pomodoro.js)
// and Practice Stage (app.js). Zero DOM dependencies — 100% pure & Node-testable.
//
// Psychological pillars:
//   1. Real replayable history ("Yesterday You" stores actual past splits).
//   2. Opt-in real escrow stakes (ELO / Streak Shield wagered up front).
//   3. Match Point & Sudden Death tie-breaker on final-block deadlocks.
//   4. Turning-point "kill-cam" & 1-tap Run-It-Back rematch on losses.

const GHOST_RUNS_KEY = 'jeemax_ghost_runs_v1';
const DUEL_STATS_KEY = 'jeemax_duel_stats_v1';
const DUEL_PREFS_KEY = 'jeemax_duel_prefs_v1';
const MAX_SAVED_RUNS = 18;
const MIN_GRADED_FOR_WIN = 4;
const MIN_GRADED_FOR_FORFEIT = 2;

export const DUEL_PRESETS = {
    off: {
        id: 'off',
        label: 'Off',
        shortLabel: 'Off',
        desc: 'Solo focus — no shadow rival.',
    },
    yesterday: {
        id: 'yesterday',
        label: 'Yesterday You',
        shortLabel: 'YESTERDAY',
        desc: 'Race your own recorded splits from past Lock-In runs.',
    },
    rival100: {
        id: 'rival100',
        label: '+100 Rival',
        shortLabel: '+100 RIVAL',
        eloOffset: 100,
        desc: 'Adaptive shadow always 100 ELO above you in each subject.',
    },
    air5000: {
        id: 'air5000',
        label: 'AIR 5000',
        shortLabel: 'AIR-5000',
        fixedElo: 2010, // exact inverse of _computeJeeAdvAir(2010) ≈ 5000
        desc: 'Benchmark ~2010 ELO pace across JEE Main & Adv.',
    },
    air1000: {
        id: 'air1000',
        label: 'AIR 1000',
        shortLabel: 'AIR-1000',
        fixedElo: 2336, // exact inverse of _computeJeeAdvAir(2336) ≈ 1000
        desc: 'Sharp ~2336 ELO pace with smart trap skips.',
    },
    air500: {
        id: 'air500',
        label: 'AIR 500',
        shortLabel: 'AIR-500',
        fixedElo: 2477, // exact inverse of _computeJeeAdvAir(2477) ≈ 500
        desc: 'Relentless ~2477 ELO top-500 execution.',
    },
};

export const DUEL_STAKES = {
    none: {
        id: 'none',
        label: 'Unstaked',
        winElo: 0,
        lossElo: 0,
        winShield: 0,
        lossShield: 0,
        desc: 'Pure pace & accuracy duel · Zero ELO stakes',
    },
    elo10: {
        id: 'elo10',
        label: 'Unstaked',
        winElo: 0,
        lossElo: 0,
        winShield: 0,
        lossShield: 0,
        desc: 'Pure pace & accuracy duel · Zero ELO stakes',
    },
    elo25: {
        id: 'elo25',
        label: 'Unstaked',
        winElo: 0,
        lossElo: 0,
        winShield: 0,
        lossShield: 0,
        desc: 'Pure pace & accuracy duel · Zero ELO stakes',
    },
    shield: {
        id: 'shield',
        label: 'Unstaked',
        winElo: 0,
        lossElo: 0,
        winShield: 0,
        lossShield: 0,
        desc: 'Pure pace & accuracy duel · Zero ELO stakes',
    },
};

function _readJson(key, fallback) {
    try {
        if (typeof localStorage === 'undefined') return fallback;
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed == null ? fallback : parsed;
    } catch (_) {
        return fallback;
    }
}

function _writeJson(key, val) {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(key, JSON.stringify(val));
        }
    } catch (_) {}
}

function _hashSeed(str) {
    let h = 2166136261 >>> 0;
    const s = String(str || 'seed');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h || 1;
}

function _mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function formatSplitSecs(secs) {
    const s = Math.max(0, Math.round(Number(secs) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m${String(r).padStart(2, '0')}s` : `${r}s`;
}

export function loadDuelStats() {
    const raw = _readJson(DUEL_STATS_KEY, null);
    if (!raw || typeof raw !== 'object') {
        return { wins: 0, losses: 0, draws: 0, winStreak: 0, lossStreak: 0, bestStreak: 0, netDuelElo: 0 };
    }
    return {
        wins: raw.wins | 0,
        losses: raw.losses | 0,
        draws: raw.draws | 0,
        winStreak: raw.winStreak | 0,
        lossStreak: raw.lossStreak | 0,
        bestStreak: raw.bestStreak | 0,
        netDuelElo: Number(raw.netDuelElo) || 0,
    };
}

function _saveDuelStats(stats) {
    _writeJson(DUEL_STATS_KEY, stats);
}

export function loadLastDuelPrefs() {
    const raw = _readJson(DUEL_PREFS_KEY, null);
    if (!raw || typeof raw !== 'object') {
        return { preset: 'off', stake: 'none', airTier: 'air1000' };
    }
    return {
        preset: DUEL_PRESETS[raw.preset] ? raw.preset : 'off',
        stake: 'none',
        airTier: (raw.airTier && DUEL_PRESETS[raw.airTier]) ? raw.airTier : 'air1000',
    };
}

export function saveLastDuelPrefs(prefs) {
    if (!prefs || typeof prefs !== 'object') return;
    _writeJson(DUEL_PREFS_KEY, {
        preset: DUEL_PRESETS[prefs.preset] ? prefs.preset : 'off',
        stake: 'none',
        airTier: (prefs.airTier && DUEL_PRESETS[prefs.airTier]) ? prefs.airTier : 'air1000',
    });
}

export function getSavedGhostRuns() {
    const arr = _readJson(GHOST_RUNS_KEY, []);
    return Array.isArray(arr) ? arr : [];
}

/**
 * Rich pre-match psychological framing for the Sign the Pact modal.
 * Gives concrete opponent pace/rating context, real loss aversion numbers, and W/L debt.
 */
export function getDuelPreviewIntel(opts) {
    const o = opts || {};
    const presetId = DUEL_PRESETS[o.preset] ? o.preset : 'off';
    const stakeId = DUEL_STAKES[o.stake] ? o.stake : 'elo10';
    const userElo = Math.round(Number(o.userElo) || 1200);
    const subject = (o.subject || 'physics').toLowerCase();
    const stats = loadDuelStats();
    const preset = DUEL_PRESETS[presetId];
    const stake = DUEL_STAKES[stakeId];

    let recordText = '';
    let recordTone = 'neutral';
    const total = stats.wins + stats.losses + stats.draws;
    if (stats.winStreak >= 2) {
        const left = 3 - (stats.winStreak % 3);
        recordText = `${stats.wins}W–${stats.losses}L · ${stats.winStreak}🔥 (${left === 3 ? 'Bonus 🛡!' : `${left} win to +1 🛡`})`;
        recordTone = 'hot';
    } else if (stats.lossStreak >= 2) {
        recordText = `${stats.wins}W–${stats.losses}L · ${stats.lossStreak}L SLUMP`;
        recordTone = 'debt';
    } else if (total > 0) {
        const net = stats.netDuelElo;
        recordText = `${stats.wins}W–${stats.losses}L · ${net >= 0 ? '+' : ''}${net} ELO`;
        recordTone = net < 0 ? 'debt' : (stats.winStreak === 1 ? 'hot' : 'neutral');
    }

    if (presetId === 'off') {
        return { active: false, recordText, recordTone, intelTitle: '', intelDetail: '', stakesLine: '' };
    }

    let intelTitle = preset.label;
    let intelDetail = preset.desc;
    if (presetId === 'yesterday') {
        const replay = _pickReplayRun(subject);
        if (replay && Array.isArray(replay.splits) && replay.splits.length) {
            const c = replay.splits.filter(s => s.correct).length;
            const avg = Math.round(replay.splits.reduce((a, s) => a + (Number(s.secs) || 0), 0) / replay.splits.length);
            intelTitle = `Tape: ${(replay.subject || subject).toUpperCase()} (${c}/${replay.splits.length} ✓)`;
            intelDetail = `Real ghost pace · avg ${formatSplitSecs(avg)}/Q · replay + τ scale`;
        } else {
            intelTitle = 'First Tape (Calibration)';
            intelDetail = `Races a ${userElo} ELO mirror today — saves real splits for future rematches.`;
        }
    } else if (presetId === 'rival100') {
        const ghostElo = userElo + 100;
        intelTitle = `${ghostElo} ELO Shadow (+100 ahead of you)`;
        intelDetail = `Adapts dynamically in every subject · higher solve odds & sharper pace.`;
    } else if (typeof preset.fixedElo === 'number') {
        const gap = preset.fixedElo - userElo;
        const gapStr = gap > 0 ? `+${gap} ELO above you` : (gap < 0 ? `${Math.abs(gap)} ELO behind you` : 'Even ELO');
        intelTitle = `${preset.label} · ${preset.fixedElo} ELO (${gapStr})`;
        intelDetail = 'Skips ultra-hard trap sinkholes instead of bleeding time on them.';
    }

    let stakesLine = '';
    if (stakeId === 'none') {
        stakesLine = `FRIENDLY · Win → ${userElo + stake.winElo} (+${stake.winElo}) · Loss resets streak`;
    } else if (stakeId === 'shield') {
        stakesLine = `1 🛡 ESCROWED · Win → +${stake.winElo} ELO & +1 🛡 · Lose → −1 🛡 BURNED`;
    } else {
        stakesLine = `ESCROW · Win → ${userElo + stake.winElo} (+${stake.winElo}) · Lose → ${Math.max(400, userElo - stake.lossElo)} (−${stake.lossElo} ELO)`;
    }

    return {
        active: true,
        recordText,
        recordTone,
        intelTitle,
        intelDetail,
        stakesLine,
        winStreak: stats.winStreak,
        lossStreak: stats.lossStreak,
    };
}

function _pickReplayRun(subject) {
    const runs = getSavedGhostRuns().filter(r => r && Array.isArray(r.splits) && r.splits.length >= 2);
    if (!runs.length) return null;
    const subjMatch = runs.filter(r => r.subject === subject || (Array.isArray(r.subjects) && r.subjects.includes(subject)));
    const pool = subjMatch.length ? subjMatch : runs;
    // Prefer the most recent qualifying run so "Yesterday You" stays fresh & personal.
    return pool[0] || null;
}

function _saveGhostRun(duel) {
    if (!duel || !Array.isArray(duel.splits)) return;
    const graded = duel.splits.filter(s => s && !s.isSkip);
    if (graded.length < 2) return;
    const existing = getSavedGhostRuns();
    const record = {
        id: duel.runId,
        at: Date.now(),
        subject: duel.primarySubject || 'physics',
        subjects: Array.from(new Set(graded.map(s => s.subject).filter(Boolean))),
        userPts: duel.userPts | 0,
        ghostPts: duel.ghostPts | 0,
        splits: graded.slice(0, 40).map(s => ({
            subject: s.subject,
            correct: !!s.userCorrect,
            secs: Math.max(5, Math.round(s.userSecs || 0)),
            targetSecs: Math.max(30, Math.round(s.targetSecs || 180)),
        })),
    };
    const next = [record, ...existing].slice(0, MAX_SAVED_RUNS);
    _writeJson(GHOST_RUNS_KEY, next);
}

/**
 * Create a live Shadow Duel session state attached to lockinSession.
 */
export function createDuelState(opts) {
    const o = opts || {};
    const presetId = DUEL_PRESETS[o.preset] ? o.preset : 'off';
    const stakeId = DUEL_STAKES[o.stake] ? o.stake : 'elo10';
    const preset = DUEL_PRESETS[presetId];
    const stake = DUEL_STAKES[stakeId];
    const primarySubject = o.subject || 'physics';
    const replayRun = presetId === 'yesterday' ? _pickReplayRun(primarySubject) : null;

    return {
        active: presetId !== 'off',
        preset: presetId,
        stake: stakeId,
        label: preset.label,
        shortLabel: preset.shortLabel,
        stakeLabel: stake.label,
        primarySubject,
        runId: o.runId || `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        userPts: 0,
        ghostPts: 0,
        userCumSecs: 0,
        ghostCumSecs: 0,
        gradedCount: 0,
        skipCount: 0,
        ghostStreak: 0,
        splits: [],
        currentGhost: null,
        replaySplits: replayRun ? replayRun.splits.slice() : null,
        replayMeta: replayRun ? { at: replayRun.at, count: replayRun.splits.length } : null,
        replayCursor: 0,
        suddenDeathActive: false,
        suddenDeathPlayed: false,
        suddenDeathDeclined: false,
        settled: false,
        settlement: null,
    };
}

/**
 * Deterministically pre-roll how the Ghost performs on question `q` BEFORE the
 * user answers. Stored on `duel.currentGhost` so the Ghost cannot cheat.
 */
export function preRollGhostAttempt(duel, q, ctx) {
    if (!duel || !duel.active || !q) return null;
    const c = ctx || {};
    const subj = (q.subject || duel.primarySubject || 'physics').toLowerCase();
    const qId = q.id != null ? String(q.id) : String(duel.splits.length);
    const qElo = (typeof q.qElo === 'number' && isFinite(q.qElo))
        ? q.qElo
        : (Number(c.chapterAvgElo) || 1200);
    const targetSecs = Math.max(45, Number(c.targetSecs) || 180);
    const userElo = Number(c.userElo) || 1200;

    // If re-rolling same currently-staged question (e.g. re-render), reuse it.
    if (duel.currentGhost && duel.currentGhost.qId === qId) {
        return duel.currentGhost;
    }

    const rng = _mulberry32(_hashSeed(`${duel.runId}::${qId}::${duel.splits.length}`));
    const preset = DUEL_PRESETS[duel.preset] || DUEL_PRESETS.rival100;

    let ghostElo = userElo;
    let verdict = 'wrong';
    let secs = targetSecs;
    let source = 'model';

    if (duel.preset === 'yesterday' && Array.isArray(duel.replaySplits) && duel.replaySplits.length > 0 && !duel.suddenDeathActive) {
        const rep = duel.replaySplits[duel.replayCursor % duel.replaySplits.length];
        duel.replayCursor += 1;
        const repBase = Math.max(30, Number(rep.targetSecs) || targetSecs);
        const tau = Math.max(0.35, Math.min(2.2, (Number(rep.secs) || repBase) / repBase));
        verdict = rep.correct ? 'correct' : 'wrong';
        secs = Math.max(15, Math.min(600, Math.round(tau * targetSecs)));
        source = 'replay';
    } else {
        if (duel.preset === 'rival100') {
            ghostElo = userElo + 100;
        } else if (typeof preset.fixedElo === 'number') {
            ghostElo = preset.fixedElo;
        } else {
            // Yesterday baseline fallback when no saved runs exist yet
            ghostElo = userElo;
            source = 'baseline';
        }
        const pWin = 1 / (1 + Math.pow(10, (qElo - ghostElo) / 400));
        // Top AIR ghosts realistically skip ultra-low-P_win trap sinkholes
        if (duel.preset.startsWith('air') && !duel.suddenDeathActive && pWin < 0.28 && rng() < 0.42) {
            verdict = 'skip';
            secs = Math.round(20 + rng() * 20);
        } else {
            verdict = rng() < pWin ? 'correct' : 'wrong';
            const skillPace = Math.max(0.50, Math.min(1.32, 1 - (ghostElo - qElo) / 1400));
            const jitter = 0.84 + rng() * 0.32;
            const avgAnchor = (Number(c.chapterAvgSecs) > 0) ? (0.45 * c.chapterAvgSecs + 0.55 * targetSecs) : targetSecs;
            secs = Math.max(16, Math.min(600, Math.round(avgAnchor * skillPace * jitter)));
        }
    }

    const roll = {
        qId,
        subject: subj,
        chapter: q.chapter || '',
        qElo,
        targetSecs,
        ghostElo: Math.round(ghostElo),
        verdict,        // 'correct' | 'wrong' | 'skip'
        secs,
        source,
    };
    duel.currentGhost = roll;
    return roll;
}

function _scorePair(userCorrect, userSecs, isSkip, ghost) {
    const gVerdict = ghost ? ghost.verdict : 'wrong';
    const gSecs = ghost ? (Number(ghost.secs) || 120) : 120;
    const gCorrect = gVerdict === 'correct';

    if (isSkip) {
        if (gCorrect) {
            return { userPtsDelta: 0, ghostPtsDelta: 1, outcome: 'skip_punished', paceDeltaSecs: 0 };
        }
        return { userPtsDelta: 0, ghostPtsDelta: 0, outcome: 'smart_triage', paceDeltaSecs: 0 };
    }

    const paceDeltaSecs = Math.round(gSecs - userSecs); // positive = user faster
    if (userCorrect && !gCorrect) {
        return { userPtsDelta: 2, ghostPtsDelta: 0, outcome: 'steal', paceDeltaSecs };
    }
    if (!userCorrect && gCorrect) {
        return { userPtsDelta: 0, ghostPtsDelta: 2, outcome: 'blunder', paceDeltaSecs };
    }
    if (userCorrect && gCorrect) {
        if (userSecs <= gSecs) {
            return { userPtsDelta: 1, ghostPtsDelta: 0, outcome: 'speed_win', paceDeltaSecs };
        }
        return { userPtsDelta: 0, ghostPtsDelta: 1, outcome: 'speed_loss', paceDeltaSecs };
    }
    return { userPtsDelta: 0, ghostPtsDelta: 0, outcome: 'mutual_miss', paceDeltaSecs };
}

function _recomputeTotals(duel) {
    let uPts = 0, gPts = 0, uSecs = 0, gSecs = 0, graded = 0, skips = 0, gStreak = 0;
    for (const s of duel.splits) {
        if (!s) continue;
        uPts += s.userPtsDelta | 0;
        gPts += s.ghostPtsDelta | 0;
        if (s.isSkip) {
            skips++;
        } else {
            graded++;
            uSecs += Math.max(0, Number(s.userSecs) || 0);
            gSecs += Math.max(0, Number(s.ghostSecs) || 0);
        }
        if (s.ghostVerdict === 'correct') gStreak++;
        else if (s.ghostVerdict === 'wrong') gStreak = 0;
    }
    duel.userPts = uPts;
    duel.ghostPts = gPts;
    duel.userCumSecs = uSecs;
    duel.ghostCumSecs = gSecs;
    duel.gradedCount = graded;
    duel.skipCount = skips;
    duel.ghostStreak = gStreak;
}

/**
 * Resolve a completed question or skip against the pre-rolled Ghost attempt.
 * Idempotent by (q.id + split index) if called via answer-key override.
 */
export function resolveDuelQuestion(duel, q, opts) {
    if (!duel || !duel.active || !q) return null;
    const o = opts || {};
    const qId = q.id != null ? String(q.id) : String(duel.splits.length);
    const ghost = (duel.currentGhost && duel.currentGhost.qId === qId)
        ? duel.currentGhost
        : preRollGhostAttempt(duel, q, o.ctx);
    const isSkip = !!o.isSkip;
    const userCorrect = !isSkip && !!o.userCorrect;
    const userSecs = Math.max(0, Math.round(Number(o.userSecs) || 0));

    const scored = _scorePair(userCorrect, userSecs, isSkip, ghost);
    const entry = {
        index: duel.splits.length + 1,
        qId,
        subject: (q.subject || duel.primarySubject || 'physics').toLowerCase(),
        chapter: q.chapter || '',
        targetSecs: ghost ? ghost.targetSecs : 180,
        isSkip,
        userCorrect,
        userSecs,
        ghostVerdict: ghost ? ghost.verdict : 'wrong',
        ghostSecs: ghost ? ghost.secs : 120,
        ghostElo: ghost ? ghost.ghostElo : 1200,
        ghostSource: ghost ? ghost.source : 'model',
        userPtsDelta: scored.userPtsDelta,
        ghostPtsDelta: scored.ghostPtsDelta,
        outcome: scored.outcome,
        paceDeltaSecs: scored.paceDeltaSecs,
        isSuddenDeath: !!duel.suddenDeathActive,
    };

    const existingIdx = duel.splits.findIndex(s => s && s.qId === qId && !o.allowDuplicate);
    if (existingIdx >= 0) {
        entry.index = duel.splits[existingIdx].index;
        duel.splits[existingIdx] = entry;
    } else {
        duel.splits.push(entry);
    }
    if (duel.suddenDeathActive && !isSkip) {
        duel.suddenDeathPlayed = true;
    }
    if (ghost && ghost.ghostElo) duel.ghostElo = ghost.ghostElo;
    duel.currentGhost = null;
    _recomputeTotals(duel);
    return entry;
}

/** Re-price an already-resolved question when its answer key / verdict is overridden. */
export function repriceDuelQuestion(duel, q, userCorrect) {
    if (!duel || !duel.active || !q || q.id == null) return null;
    const qId = String(q.id);
    const idx = duel.splits.findIndex(s => s && s.qId === qId && !s.isSkip);
    if (idx < 0) return null;
    const prev = duel.splits[idx];
    const scored = _scorePair(!!userCorrect, prev.userSecs, false, {
        verdict: prev.ghostVerdict,
        secs: prev.ghostSecs,
    });
    duel.splits[idx] = {
        ...prev,
        userCorrect: !!userCorrect,
        userPtsDelta: scored.userPtsDelta,
        ghostPtsDelta: scored.ghostPtsDelta,
        outcome: scored.outcome,
        paceDeltaSecs: scored.paceDeltaSecs,
    };
    _recomputeTotals(duel);
    return duel.splits[idx];
}

export function findTurningPointSplit(duel) {
    if (!duel || !Array.isArray(duel.splits)) return null;
    let worst = null;
    let worstPenalty = -1;
    for (const s of duel.splits) {
        if (!s || s.isSkip) continue;
        const net = (s.ghostPtsDelta - s.userPtsDelta) * 1000 + Math.max(0, -s.paceDeltaSecs);
        if (s.ghostPtsDelta > s.userPtsDelta && net > worstPenalty) {
            worstPenalty = net;
            worst = s;
        }
    }
    if (worst) return worst;
    // Fallback if all splits were even on points: slowest loss on time
    for (const s of duel.splits) {
        if (!s || s.isSkip) continue;
        if (-s.paceDeltaSecs > worstPenalty) {
            worstPenalty = -s.paceDeltaSecs;
            worst = s;
        }
    }
    return worst;
}

export function formatDuelSplitSummary(split, rivalLabel) {
    if (!split) return '';
    const rName = rivalLabel || 'GHOST';
    if (split.isSkip) {
        return split.outcome === 'smart_triage'
            ? `TRAP SKIPPED · ${rName} ${split.ghostVerdict === 'skip' ? 'SKIPPED' : 'MISSED'} (0)`
            : `SKIPPED · ${rName} SOLVED IN ${formatSplitSecs(split.ghostSecs)} (−1)`;
    }
    const uMark = split.userCorrect ? '✓' : '✗';
    const gMark = split.ghostVerdict === 'correct' ? '✓' : (split.ghostVerdict === 'skip' ? 'SKIP' : '✗');
    const uStr = `${uMark} ${formatSplitSecs(split.userSecs)}`;
    const gStr = split.ghostVerdict === 'skip' ? 'SKIP' : `${gMark} ${formatSplitSecs(split.ghostSecs)}`;
    if (split.outcome === 'steal') {
        return `YOU ${uStr} vs ${rName} ${gStr} · STEAL (+2)`;
    }
    if (split.outcome === 'blunder') {
        return `YOU ${uStr} vs ${rName} ${gStr} · GHOST +2`;
    }
    if (split.outcome === 'speed_win') {
        return `YOU ${uStr} vs ${rName} ${gStr} · ${Math.abs(split.paceDeltaSecs)}s FASTER (+1)`;
    }
    if (split.outcome === 'speed_loss') {
        return `YOU ${uStr} vs ${rName} ${gStr} · ${Math.abs(split.paceDeltaSecs)}s SLOWER (GHOST +1)`;
    }
    return `YOU ${uStr} vs ${rName} ${gStr} · DRAW (0)`;
}

/**
 * Rich structured split feedback for post-solve #pq-diag card.
 */
export function formatDuelSplitRich(split, duel) {
    if (!split) return null;
    const rName = (duel && duel.shortLabel) || 'GHOST';
    const uPts = (duel && duel.userPts) || 0;
    const gPts = (duel && duel.ghostPts) || 0;
    const stake = DUEL_STAKES[(duel && duel.stake) || 'elo10'] || DUEL_STAKES.elo10;

    let head = '';
    if (split.isSkip) {
        head = split.outcome === 'smart_triage'
            ? `Trap dodged · ${rName} ${split.ghostVerdict === 'skip' ? 'also skipped' : 'missed'}`
            : `Skipped · ${rName} solved in ${formatSplitSecs(split.ghostSecs)}`;
    } else {
        const uStr = `${split.userCorrect ? '✓' : '✗'} ${formatSplitSecs(split.userSecs)}`;
        const gStr = split.ghostVerdict === 'skip' ? 'SKIP' : `${split.ghostVerdict === 'correct' ? '✓' : '✗'} ${formatSplitSecs(split.ghostSecs)}`;
        head = `YOU ${uStr}  vs  ${rName} ${gStr}`;
    }

    let badge = 'EVEN · 0';
    let tone = 'draw';
    if (split.outcome === 'steal') { badge = 'STEAL +2'; tone = 'win'; }
    else if (split.outcome === 'speed_win') { badge = `${Math.abs(split.paceDeltaSecs)}s FASTER · +1`; tone = 'win'; }
    else if (split.outcome === 'blunder') { badge = `RIVAL STEAL +2`; tone = 'loss'; }
    else if (split.outcome === 'speed_loss') { badge = `${Math.abs(split.paceDeltaSecs)}s SLOWER · RIVAL +1`; tone = 'loss'; }
    else if (split.outcome === 'skip_punished') { badge = 'SKIP COST · RIVAL +1'; tone = 'loss'; }
    else if (split.outcome === 'smart_triage') { badge = 'TRAP TRIAGE · 0'; tone = 'draw'; }

    let sub = `Match: YOU ${uPts} – ${gPts} ${rName}`;
    if (gPts > uPts) {
        const behind = gPts - uPts;
        const risk = stake.lossShield ? `−${stake.lossShield} 🛡` : (stake.lossElo ? `−${stake.lossElo} ELO` : 'streak');
        sub = `DOWN −${behind} (${uPts}–${gPts}) · ${risk} bleeding — ${behind <= 2 ? '1 steal ties it' : 'need a clean run'}`;
    } else if (uPts > gPts) {
        const lead = uPts - gPts;
        sub = `UP +${lead} (${uPts}–${gPts}) · +${stake.winElo} ELO in sight${duel && duel.gradedCount < MIN_GRADED_FOR_WIN ? ` (${MIN_GRADED_FOR_WIN - duel.gradedCount} Q left to rank)` : ''}`;
    } else if (duel && duel.gradedCount >= 3) {
        sub = `DEADLOCKED ${uPts}–${gPts} · Match Point pressure`;
    }

    return { head, badge, sub, tone };
}

export function formatDuelBadgeText(duel, opts) {
    if (!duel || !duel.active) return '';
    const o = opts || {};
    const u = duel.userPts | 0;
    const g = duel.ghostPts | 0;
    const diff = Math.abs(u - g);
    const stake = DUEL_STAKES[duel.stake] || DUEL_STAKES.elo10;
    if (duel.suddenDeathActive) {
        return `⚡ SUDDEN DEATH · ${u}–${g} ${duel.shortLabel} · ALL OR NOTHING`;
    }
    const closeLate = duel.gradedCount >= 3 && diff <= 1 &&
        (o.isFinalNearEnd || u === g);
    if (closeLate) {
        const edge = u < g ? ` · DOWN −${diff}` : (u > g ? ` · +${diff} LEAD` : ' · TIED');
        return `MATCH POINT${edge} (${u}–${g}) · ${duel.shortLabel}`;
    }
    if (u < g) {
        const heat = (duel.ghostStreak | 0) >= 2 ? `🔥×${duel.ghostStreak} · ` : '';
        const risk = stake.lossShield ? `−${stake.lossShield}🛡 RISK`
            : (stake.lossElo ? `−${stake.lossElo} ELO RISK` : 'LOSING');
        return `${heat}DOWN −${diff} (${u}:${g}) · ${risk}`;
    }
    if (u > g) {
        return `AHEAD +${diff} (${u}:${g}) · ${duel.shortLabel}`;
    }
    return `DUEL · ${u}:${g} EVEN · ${duel.shortLabel}`;
}

export function isDuelMatchPoint(duel, leftSecs, isFinalRound) {
    if (!duel || !duel.active || duel.suddenDeathActive) return false;
    if (duel.gradedCount < 3) return false;
    if (duel.userPts === duel.ghostPts) return true;
    return !!(isFinalRound && leftSecs <= 300 && Math.abs(duel.userPts - duel.ghostPts) <= 1);
}

/**
 * Settle the Duel at cycle end, pool exhaustion, sudden death completion, or forfeit.
 * Returns a deterministic settlement object (and saves stats + replay history).
 */
export function finalizeDuel(duel, opts) {
    if (!duel || !duel.active) return null;
    if (duel.settled && duel.settlement) return duel.settlement;
    const o = opts || {};
    const forfeit = !!o.forfeit;
    const stake = DUEL_STAKES[duel.stake] || DUEL_STAKES.elo10;
    const stats = loadDuelStats();

    // Always archive qualifying splits so "Yesterday You" keeps real future ghosts
    if (!forfeit) _saveGhostRun(duel);

    let outcome = 'unqualified';
    if (forfeit) {
        if (duel.gradedCount >= MIN_GRADED_FOR_FORFEIT || duel.userPts < duel.ghostPts) {
            outcome = 'forfeit';
        } else {
            outcome = 'unqualified';
        }
    } else if (duel.gradedCount < MIN_GRADED_FOR_WIN && !duel.suddenDeathPlayed) {
        outcome = 'unqualified';
    } else if (duel.userPts > duel.ghostPts) {
        outcome = 'win';
    } else if (duel.userPts < duel.ghostPts) {
        outcome = 'loss';
    } else {
        outcome = 'draw';
    }

    let eloDelta = 0;
    let shieldDelta = 0;
    let streakShieldEarned = false;

    if (outcome === 'win') {
        eloDelta = 0;
        shieldDelta = 0;
        stats.wins += 1;
        stats.winStreak += 1;
        stats.lossStreak = 0;
        stats.bestStreak = Math.max(stats.bestStreak, stats.winStreak);
    } else if (outcome === 'loss' || outcome === 'forfeit') {
        eloDelta = 0;
        shieldDelta = 0;
        stats.losses += 1;
        stats.winStreak = 0;
        stats.lossStreak = (stats.lossStreak || 0) + 1;
    } else if (outcome === 'draw') {
        stats.draws += 1;
        stats.lossStreak = 0;
    }
    stats.netDuelElo += eloDelta;
    if (outcome !== 'unqualified') _saveDuelStats(stats);

    const tp = findTurningPointSplit(duel);
    const gradedSplits = (duel.splits || []).filter(s => s && !s.isSkip);
    const allSplits = (duel.splits || []).filter(Boolean);
    const uCorrect = gradedSplits.filter(s => s.userCorrect).length;
    const gGradedSplits = gradedSplits.filter(s => s.ghostVerdict !== 'skip');
    const gCorrect = allSplits.filter(s => s.ghostVerdict === 'correct').length;
    const gSkips = allSplits.filter(s => s.ghostVerdict === 'skip').length;
    const uAvgSecs = gradedSplits.length ? Math.round(duel.userCumSecs / gradedSplits.length) : 0;
    const gAvgSecs = gradedSplits.length ? Math.round(duel.ghostCumSecs / gradedSplits.length) : 0;
    const avgGhostElo = duel.ghostElo || (DUEL_PRESETS[duel.preset] && DUEL_PRESETS[duel.preset].fixedElo) || null;

    let bestSplit = null;
    let bestGain = -1;
    for (const s of gradedSplits) {
        const gain = (s.userPtsDelta - s.ghostPtsDelta) * 1000 + Math.max(0, s.paceDeltaSecs);
        if (s.userPtsDelta > s.ghostPtsDelta && gain > bestGain) {
            bestGain = gain;
            bestSplit = s;
        }
    }

    const paceGap = Math.round(duel.ghostCumSecs - duel.userCumSecs); // + = user faster overall
    const paceAvgGapSecs = Math.round(gAvgSecs - uAvgSecs);
    let turningPointText = '';
    if (tp && (outcome === 'loss' || outcome === 'forfeit' || outcome === 'draw')) {
        const ch = tp.chapter ? ` (${tp.chapter})` : '';
        if (tp.userCorrect === false && tp.ghostVerdict === 'correct') {
            turningPointText = `Q${tp.index}${ch} · Ghost solved in ${formatSplitSecs(tp.ghostSecs)} while you missed`;
        } else if (tp.paceDeltaSecs < 0) {
            turningPointText = `Q${tp.index}${ch} · Ghost ${formatSplitSecs(tp.ghostSecs)} vs your ${formatSplitSecs(tp.userSecs)}`;
        }
    }

    let verdictHeadline = '';
    if (outcome === 'forfeit') {
        verdictHeadline = `Forfeited mid-fight while ${duel.userPts}–${duel.ghostPts} against ${duel.label}. Stake burned immediately.`;
    } else if (outcome === 'loss') {
        const blunders = allSplits.filter(s => s.outcome === 'blunder').length;
        const skipLoss = allSplits.filter(s => s.outcome === 'skip_punished').length;
        if (tp && tp.userCorrect === false && tp.ghostVerdict === 'correct') {
            verdictHeadline = `Decided on Q${tp.index}${tp.chapter ? ` (${tp.chapter})` : ''}: ${duel.label} solved in ${formatSplitSecs(tp.ghostSecs)} while you missed. Flip ${Math.max(1, blunders)} blunder to win.`;
        } else if (paceAvgGapSecs < -5) {
            verdictHeadline = `Matched accuracy (${uCorrect}/${gradedSplits.length}) but bled ${Math.abs(paceAvgGapSecs)}s/Q vs ${duel.label} (${formatSplitSecs(gAvgSecs)} avg vs your ${formatSplitSecs(uAvgSecs)}).`;
        } else if (skipLoss > 0) {
            verdictHeadline = `Skipped ${skipLoss} solvable problem${skipLoss > 1 ? 's' : ''} while ${duel.label} cashed in.`;
        } else {
            verdictHeadline = `${duel.label} took ${duel.ghostPts}–${duel.userPts} across ${gradedSplits.length} problems.`;
        }
    } else if (outcome === 'win') {
        const steals = allSplits.filter(s => s.outcome === 'steal').length;
        const paceNote = paceAvgGapSecs > 3 ? ` · ${paceAvgGapSecs}s/Q faster` : '';
        const stealNote = steals > 0 ? ` · ${steals} steal${steals > 1 ? 's' : ''}` : '';
        const streakNote = stats.winStreak > 0 && stats.winStreak % 3 !== 0
            ? ` · ${3 - (stats.winStreak % 3)} win${3 - (stats.winStreak % 3) === 1 ? '' : 's'} to Bonus 🛡`
            : '';
        verdictHeadline = `Outperformed ${duel.label} (${duel.userPts}–${duel.ghostPts})${stealNote}${paceNote}${streakNote}.`;
    } else if (outcome === 'draw') {
        verdictHeadline = `Finished even at ${duel.userPts}–${duel.ghostPts} (${uCorrect} vs ${gCorrect} solved). Escrow returned.`;
    } else {
        verdictHeadline = `Played ${duel.gradedCount}/4 graded Qs — need ${MIN_GRADED_FOR_WIN} Qs for ranked stake payout. Stakes refunded.`;
    }

    const highlightIdx = (outcome === 'loss' || outcome === 'forfeit' || outcome === 'draw')
        ? (tp ? tp.index : null)
        : (bestSplit ? bestSplit.index : null);

    const settlement = {
        outcome, // 'win' | 'loss' | 'forfeit' | 'draw' | 'unqualified'
        preset: duel.preset,
        label: duel.label,
        shortLabel: duel.shortLabel,
        stake: duel.stake,
        stakeLabel: duel.stakeLabel,
        userPts: duel.userPts,
        ghostPts: duel.ghostPts,
        gradedCount: duel.gradedCount,
        paceGapSecs: paceGap,
        paceAvgGapSecs,
        eloDelta,
        shieldDelta,
        streakShieldEarned,
        winStreak: stats.winStreak,
        lossStreak: stats.lossStreak,
        turningPointText,
        turningPointIndex: tp ? tp.index : null,
        bestStealIndex: bestSplit ? bestSplit.index : null,
        verdictHeadline,
        userStats: {
            pts: duel.userPts,
            graded: gradedSplits.length,
            correct: uCorrect,
            skips: duel.skipCount,
            accuracyPct: gradedSplits.length ? Math.round((uCorrect / gradedSplits.length) * 100) : 0,
            avgSecs: uAvgSecs,
            cumSecs: Math.round(duel.userCumSecs),
        },
        ghostStats: {
            pts: duel.ghostPts,
            elo: avgGhostElo,
            graded: gGradedSplits.length,
            correct: gCorrect,
            skips: gSkips,
            accuracyPct: allSplits.length ? Math.round((gCorrect / allSplits.length) * 100) : 0,
            avgSecs: gAvgSecs,
            cumSecs: Math.round(duel.ghostCumSecs),
        },
        splits: allSplits.map(s => ({
            ...s,
            isTurningPoint: highlightIdx === s.index && (outcome === 'loss' || outcome === 'forfeit' || outcome === 'draw'),
            isBestMoment: highlightIdx === s.index && outcome === 'win',
        })),
        suddenDeathPlayed: !!duel.suddenDeathPlayed,
        rematchPrefs: {
            preset: duel.preset,
            stake: duel.stake,
        },
    };
    duel.settled = true;
    duel.settlement = settlement;
    return settlement;
}
