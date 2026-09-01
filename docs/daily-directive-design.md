# DAILY DIRECTIVE — replacing the static 10/10/10 + 5/5/5 target system

> **v2.1 simplification pass (shipped):** the engine is unchanged, but the
> user-facing surface now speaks only native JEE language. No LU/heat/keys
> vocabulary. The day is THREE plain-sentence items + one bar with a pace tick;
> the box (3 legible prizes, hidden odds) replaces the spin; streak reads
> "N on pace"; mornings open with a one-sentence debrief; two consecutive
> misses trigger an immediate Recovery day; a scheduled/run mock REPLACES the
> contract; after 23:00 the UI stands down ("Done is done"); Oath and the
> Confidence quest were cut. Weekly debrief line: pace vs plan + days to Advanced.

> Design doc + implementation notes. Replaces: `baseTargets`/`baseErrorTargets` + 24h lock
> (`storage.js:609-611`, `app.js` saveTargets/lockTargetsOnly), and unifies the divergent fix
> quotas (`baseErrorTargets` 5/5/5 vs `matrix.js` DAILY_QUEUE_LIMITS 5P/5M/10C).

## 0. Diagnosis

The old system measures clicks, not cognition. Ten easy solves count the same as ten hard ones;
the 24h lock locks a number that was never intelligent; `baseErrorTargets` is dead code (the
Cortex queue enforces its own limits). Principle of the replacement: **the target is a contract
with your own capacity, denominated in verifiable effort, with rewards that vary.**

## 1. Load Units (LU)

```
LU(solve) = 1
  × difficultyMul  = clamp(qElo / userSubjectElo, 0.55, 1.9)
  × weightMul      = 0.8 + 1.2 × resolveChapterWeight(chapter)     // up to 2.0×
  × modeMul        = standard 1.0 · flow 1.1 · hardcore 1.3
  × firstTryBonus  = 1.15 if firstAttemptResult === 'correct'
  × decay(n)       = 1 / (1 + 0.06 × n)   for n-th solve of that subject today
```

Other sources: Cortex fix = **1.4 LU** (out-pays fresh solving); deep pomodoro = +2 LU
(capped 3/day/subject); mock section = 12 LU split; Brier confidence call = +0.2.

Anti-gaming: rushed solves (< 20% of `_eloBandTargetTime`) earn 0.3 LU; day accuracy < 40%
halves LU accrual until one Cortex fix lands.

## 2. The Contract

`contractLU(sub) = clamp(base × capacity × demand, 0.6×median, 1.4×median)`

- **base** = median LU of last 7 settled days (cold start 12 LU/subject).
- **capacity** ∈ [0.6, 1.25] from mood multiplier, Night Guard sleep debt, weekly rhythm.
  Bad days shrink the contract — a bad day becomes winnable, not auto-failed.
- **demand** = Cortex due-load + weakest-chapter pressure + mock proximity.
- **DDA:** weekly tune so 28-day hit rate converges to ~78% (hits +8%, misses −15%).
- **Oath:** voluntary +20% before 10:00, can't be undone; hit → spin odds ×2; miss → dimmed flame.

## 3. Quests

1 HEADLINE (argmax of weightage × (1−theta) × leak × neglect; pays 1.5× LU there) +
3 SIDE quests drawn ε-greedy (ε=0.2) from: Sharpshooter, Speedrun, Deep Dive, Debt Collector,
Confidence Game, Bounty Hunt. Each pays a key; FULL CLEAR (4 keys) unlocks the spin.

## 4. Voltage Spin

Common 62% (LU bank + confetti) / Uncommon 25% (Rest Token) / Rare 10% (Overcharge:
tomorrow −10% contract, LU ×1.25) / Legendary 3% (Golden Flame + bounty ×3 week).
Overdelivery shifts odds toward Rare; pity counter guarantees Rare within 8 spins.
Rewards never pay in contract reduction or Elo.

## 5. Streak 2.0 + Debrief

Streak at aggregate heat ≥100% (subjects may trade); ≥70% = flicker. Midnight settlement
grades S/A/B/C via heat × quests × accuracy; C shrinks tomorrow (no shaming). Debrief ends
with a fogged teaser of tomorrow's headline quest.

## 6. Storage

`jeemax_directive_v1` = { date, contract, oath, luToday, quests, keys, spinState, settled, grade }
`jeemax_directive_history` (append-only, feeds DDA). Deleted: basePhys/Chem/Math, baseErr*,
jeeTargetLockDate, DAILY_QUEUE_LIMITS.
