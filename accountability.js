/**
accountability.js — Debt Pool + Escrow Collateral Engine v2
Self-contained module. Imports only from storage.js.
Exposes AccountabilityEngine on window for cross-module access.

Design rules:
  • Debt NEVER raises daily targets
  • Repayment only after daily target is met (overtime)
  • Collateral bonus is escrow-only (no mid-day ELO mutation)
  • Stake is hard-escrowed on contract open
  • Stretch Target: higher bonus % demands overperformance
  • One contract per day, subject-specific only
  • Target freeze while collateral active / debt exists
*/

import {
  AppState,
  baseTargets,
  solved,
  idbSet,
  idbGet,
} from './storage.js';

// ═══════════════════════════════════════════════════════════════════════
//  CONSTANTS & TUNING
// ═══════════════════════════════════════════════════════════════════════

const SUBJECTS = ['physics', 'chemistry', 'maths'];

const DEBT_TIERS = [
  { name: 'CLEAN',    min: 0,  max: 0,     color: '#22c55e', stakeCapMult: 1.0,  decayPct: 0,    decayCap: 0  },
  { name: 'WARNING',  min: 1,  max: 7,     color: '#f97316', stakeCapMult: 0.75, decayPct: 0,    decayCap: 0  },
  { name: 'STRAIN',   min: 8,  max: 20,    color: '#f59e0b', stakeCapMult: 0.50, decayPct: 0,    decayCap: 0  },
  { name: 'DEFAULT',  min: 21, max: 40,    color: '#ef4444', stakeCapMult: 0.15, decayPct: 0.01, decayCap: 10 },
  { name: 'CRITICAL', min: 41, max: 99999, color: '#dc2626', stakeCapMult: 0.0,  decayPct: 0.02, decayCap: 20 },
];

const TUNING = {
  // Debt
  interestPct: 0.05,
  maxInterestPerDay: 2,
  interestCapPctOfPrincipal: 0.50,
  cleanDaysForDecay: 3,
  decayPerCleanDay: 1,
  maxDecayForgiveness: 5,
  maxAbsenceDebt: 3,

  // Collateral — rebalanced v2.1: the old linear 25→90% curve paid ~79%
  // for a 30-ELO stake with a trivial stretch, making contracts free money.
  // Now: convex curve (must near-max the stake to approach bonusMax), max
  // accrual halved, escrow cap below the stake (max profit 0.8× what you
  // risk losing), and high-bonus contracts demand real overperformance.
  minStake: 5,
  maxStakeAbs: 40,
  maxStakePctOfElo: 0.03,
  eloFloor: 1000,
  bonusMin: 0.10,
  bonusMax: 0.50,
  bonusCurveExp: 2.0,          // bonus = min + (stake/max)^exp × (max−min)
  maxEscrowBonusMult: 0.80,
  stretchExponent: 0.60,       // stretchTarget = target × (1 + (bonus−bonusMin) × this)

  // Shields
  cleanDaysPerShield: 5,
  maxShields: 2,
  shieldForgiveMax: 3,

  // Circuit breaker
  liquidationCooldownHours: 24,
  globalEloDropCircuitBreaker: 60,

  // Restructure
  restructureMaxReductionPct: 0.20,
  restructureCollateralDisableDays: 2,
};

const LS_KEY = 'jeemax_accountability_v2';
const SNAPSHOT_KEY = 'jeemax_accountability_snapshot_v2';

// ═══════════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════════

let _state = null;   // hydrated from IndexedDB
let _snapshot = null;
let _initialized = false;

function _defaultState() {
  return {
    version: 2,
    debt: {
      principal: { physics: 0, chemistry: 0, maths: 0 },
      interest:  { physics: 0, chemistry: 0, maths: 0 },
      startOfDay: { physics: 0, chemistry: 0, maths: 0 },
      notes: [],
      cleanDays: 0,
      shields: 0,
      lastSettlementLocalDate: null,
      totalDecayForgiven: { physics: 0, chemistry: 0, maths: 0 },
    },
    collateral: {
      active: null,       // { subject, stake, bonusPct, maxEscrowBonus, escrowBonus, requiredTarget, stretchTarget, openedAt, status }
      history: [],        // settled contracts
    },
    freeze: {
      targetFreezeReason: null,
      targetFreezeUntilLocalDate: null,
      collateralCooldownUntilLocalDate: null,
      collateralDisabledUntilLocalDate: null,   // from restructure
    },
    settings: {
      hardEscrow: true,
      strictLiquidation: true,
      interestEnabled: true,
      debtShieldEnabled: true,
      eloFloor: TUNING.eloFloor,
    },
  };
}

function _defaultSnapshot() {
  return {
    date: _todayKey(),
    targets: { physics: 0, chemistry: 0, maths: 0 },
    solved:  { physics: 0, chemistry: 0, maths: 0 },
    collateral: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════

function _todayKey(d) {
  return (d || new Date()).toLocaleDateString('en-CA');   // YYYY-MM-DD local
}

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function _totalDebt() {
  if (!_state) return 0;
  const p = _state.debt.principal;
  const i = _state.debt.interest;
  return SUBJECTS.reduce((s, k) => s + (p[k] || 0) + (i[k] || 0), 0);
}

function _subjectDebt(subj) {
  if (!_state) return 0;
  return (_state.debt.principal[subj] || 0) + (_state.debt.interest[subj] || 0);
}

function _getTier(total) {
  for (let i = DEBT_TIERS.length - 1; i >= 0; i--) {
    if (total >= DEBT_TIERS[i].min) return DEBT_TIERS[i];
  }
  return DEBT_TIERS[0];
}

function _effectiveTarget(subj) {
  return Math.round((baseTargets[subj] || 10) * (AppState.moodMultiplier || 1.0));
}

function _subjectElo(subj) {
  return (AppState.elo && AppState.elo[subj]) || 1200;
}

function _addNote(text) {
  if (!_state) return;
  _state.debt.notes.unshift({ text, ts: new Date().toISOString() });
  if (_state.debt.notes.length > 50) _state.debt.notes.length = 50;
}

// ═══════════════════════════════════════════════════════════════════════
//  PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════

async function _save() {
  try { await idbSet(LS_KEY, _state); } catch (e) { console.error('[acct] save fail', e); }
}

async function _saveSnapshot() {
  try { await idbSet(SNAPSHOT_KEY, _snapshot); } catch (e) {}
}

async function _load() {
  try {
    const raw = await idbGet(LS_KEY);
    if (raw && raw.version === 2) {
      _state = raw;
      // backfill any missing fields
      const def = _defaultState();
      for (const k of Object.keys(def)) {
        if (_state[k] === undefined) _state[k] = def[k];
      }
      if (!_state.debt.shields) _state.debt.shields = 0;
      if (!_state.debt.totalDecayForgiven) _state.debt.totalDecayForgiven = { physics: 0, chemistry: 0, maths: 0 };
    } else {
      _state = _defaultState();
    }
  } catch (e) {
    _state = _defaultState();
  }
  try {
    const snap = await idbGet(SNAPSHOT_KEY);
    _snapshot = (snap && snap.date) ? snap : _defaultSnapshot();
  } catch (e) {
    _snapshot = _defaultSnapshot();
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  SETTLEMENT ENGINE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Called from initApp() BEFORE the daily solved/studySecs reset.
 * Settles yesterday: creates debt, repays overtime, accrues interest,
 * settles collateral, applies decay, awards shields.
 * Returns a receipt object for the UI modal.
 */
function settlePreviousDayIfNeeded() {
  if (!_state) return null;

  const today = _todayKey();
  const lastSettle = _state.debt.lastSettlementLocalDate;

  // Already settled today → skip
  if (lastSettle === today) return null;

  // Determine which day we're settling
  // If lastSettle is null → first run, no settlement
  if (!lastSettle) {
    _state.debt.lastSettlementLocalDate = today;
    _snapshot = _defaultSnapshot();
    _captureStartOfDay();
    _save();
    return null;
  }

  // Absence detection: if more than 1 day gap, cap debt
  const lastDate = new Date(lastSettle + 'T12:00:00');
  const todayDate = new Date(today + 'T12:00:00');
  const gapDays = Math.round((todayDate - lastDate) / 86400000);

  const receipt = {
    date: lastSettle,
    subjects: {},
    debtAdded: { physics: 0, chemistry: 0, maths: 0 },
    debtRepaid: { physics: 0, chemistry: 0, maths: 0 },
    interestAdded: { physics: 0, chemistry: 0, maths: 0 },
    collateralResult: null,
    shieldsUsed: { physics: 0, chemistry: 0, maths: 0 },
    decayApplied: { physics: 0, chemistry: 0, maths: 0 },
    totalDebtAfter: 0,
    tierAfter: 'CLEAN',
    cleanDayEarned: false,
    shieldEarned: false,
    absence: gapDays > 1,
  };

  // ── Per-subject settlement ──
  let anyMissed = false;
  let anyRepaid = false;

  // ── Deload Day: hoist check outside the per-subject loop. If the
  // settled day was a deload day, ALL subjects skip debt accrual. ──
  let _isDeloadDay = false;
  try {
      if (window.__deload && typeof window.__deload.isDeloadDate === 'function') {
          _isDeloadDay = window.__deload.isDeloadDate(lastSettle);
      }
  } catch (_) {}
  if (_isDeloadDay) {
      receipt._deloadDay = true;
      receipt._deloadDate = lastSettle;
      _addNote('🌿 Deload Day: missed-debt cancelled for all subjects. Rest day preserved.');
  }

  for (const subj of SUBJECTS) {
    const target = _snapshot.targets[subj] || _effectiveTarget(subj);
    const solvedCount = _snapshot.solved[subj] || 0;
    const missed = Math.max(0, target - solvedCount);
    const overtime = Math.max(0, solvedCount - target);

    receipt.subjects[subj] = { target, solved: solvedCount, missed, overtime };

    // ── Debt Shield: auto-forgive up to 3 missed ──
    let shieldUsed = 0;
    if (_state.settings.debtShieldEnabled && missed > 0 && _state.debt.shields > 0) {
      shieldUsed = Math.min(missed, TUNING.shieldForgiveMax);
      _state.debt.shields--;
      receipt.shieldsUsed[subj] = shieldUsed;
      _addNote(`🛡 Debt Shield absorbed ${shieldUsed} ${subj} debt`);
    }

    const effectiveMissed = Math.max(0, missed - shieldUsed);

    // ── Deload Day: skip debt accrual (check hoisted before the loop).
    // Overtime still repays existing debt (negative carry-forward). ──
    if (_isDeloadDay) {
        if (overtime > 0 && _subjectDebt(subj) > 0) {
            const repay = Math.min(_subjectDebt(subj), overtime);
            const intRepay = Math.min(_state.debt.interest[subj], repay);
            _state.debt.interest[subj] -= intRepay;
            const prinRepay = repay - intRepay;
            _state.debt.principal[subj] = Math.max(0, _state.debt.principal[subj] - prinRepay);
            receipt.debtRepaid[subj] = repay;
        }
        continue; // skip normal debt accrual for this subject
    }

    // ── Absence cap ──
    const debtToAdd = receipt.absence
      ? Math.min(effectiveMissed, TUNING.maxAbsenceDebt)
      : effectiveMissed;

    if (debtToAdd > 0) {
      _state.debt.principal[subj] += debtToAdd;
      receipt.debtAdded[subj] = debtToAdd;
      anyMissed = true;
      _addNote(`+${debtToAdd} ${subj} debt (missed ${effectiveMissed} of ${target})`);
    }

    // ── Overtime repayment ──
    if (overtime > 0 && _subjectDebt(subj) > 0) {
      const repay = Math.min(_subjectDebt(subj), overtime);
      // repay interest first, then principal
      const intRepay = Math.min(_state.debt.interest[subj], repay);
      _state.debt.interest[subj] -= intRepay;
      const prinRepay = repay - intRepay;
      _state.debt.principal[subj] = Math.max(0, _state.debt.principal[subj] - prinRepay);
      receipt.debtRepaid[subj] = repay;
      anyRepaid = true;
      _addNote(`⚡ Repaid ${repay} ${subj} debt via overtime`);
    }
  }

  // ── Interest (only if no repayment happened and debt exists) ──
  if (_state.settings.interestEnabled && !anyRepaid) {
    for (const subj of SUBJECTS) {
      const principal = _state.debt.principal[subj];
      if (principal <= 0) continue;
      const rawInterest = Math.ceil(principal * TUNING.interestPct);
      const capped = Math.min(rawInterest, TUNING.maxInterestPerDay);
      const maxTotalInterest = Math.ceil(principal * TUNING.interestCapPctOfPrincipal);
      const room = Math.max(0, maxTotalInterest - _state.debt.interest[subj]);
      const added = Math.min(capped, room);
      if (added > 0) {
        _state.debt.interest[subj] += added;
        receipt.interestAdded[subj] = added;
        _addNote(`📈 +${added} ${subj} interest (unpaid debt)`);
      }
    }
  }

  // ── Collateral settlement ──
  if (_state.collateral.active) {
    const c = _state.collateral.active;
    const subjSolved = _snapshot.solved[c.subject] || 0;
    const metBase = subjSolved >= c.requiredTarget;
    const metStretch = subjSolved >= c.stretchTarget;

    if (metBase) {
      // Return stake
      AppState.elo[c.subject] = (AppState.elo[c.subject] || 1200) + c.stake;

      // Deposit escrow bonus (partial unlock via stretch)
      let unlockFraction = 1;
      if (c.stretchTarget > c.requiredTarget) {
        unlockFraction = _clamp(
          (subjSolved - c.requiredTarget) / (c.stretchTarget - c.requiredTarget),
          0, 1
        );
      }
      const deposited = Math.round(c.escrowBonus * unlockFraction);
      AppState.elo[c.subject] += deposited;

      c.status = 'won';
      c.depositedBonus = deposited;
      c.unlockFraction = unlockFraction;
      receipt.collateralResult = { ...c, depositedBonus: deposited, unlockFraction };
      _addNote(`🏆 Collateral WON: +${c.stake} stake + ${deposited} bonus (${Math.round(unlockFraction * 100)}% unlock)`);
    } else {
      // Liquidated: stake destroyed, bonus vanishes
      c.status = 'liquidated';
      receipt.collateralResult = { ...c };
      _addNote(`💀 Collateral LIQUIDATED: ${c.stake} ${c.subject} ELO destroyed`);

      // Circuit breaker: disable collateral for 24h
      const cooldownDate = new Date();
      cooldownDate.setHours(cooldownDate.getHours() + TUNING.liquidationCooldownHours);
      _state.freeze.collateralCooldownUntilLocalDate = _todayKey(cooldownDate);
    }

    // Recompute global ELO
    _recomputeGlobalElo();

    // Archive
    _state.collateral.history.unshift({ ...c, settledAt: new Date().toISOString() });
    if (_state.collateral.history.length > 30) _state.collateral.history.length = 30;
    _state.collateral.active = null;
  }

  // ── ELO decay at DEFAULT / CRITICAL ──
  const total = _totalDebt();
  const tier = _getTier(total);
  if (tier.decayPct > 0) {
    for (const subj of SUBJECTS) {
      if (_subjectDebt(subj) <= 0) continue;
      const elo = _subjectElo(subj);
      const decay = Math.min(tier.decayCap, Math.ceil(elo * tier.decayPct));
      if (decay > 0 && elo - decay > TUNING.eloFloor) {
        AppState.elo[subj] -= decay;
        receipt.decayApplied[subj] = decay;
        _addNote(`📉 ${subj} ELO decay: −${decay} (${tier.name} tier)`);
      }
    }
    _recomputeGlobalElo();
  }

  // ── Clean day tracking + shields + debt decay ──
  if (!anyMissed) {
    _state.debt.cleanDays++;
    receipt.cleanDayEarned = true;

    // Shield award
    if (_state.debt.cleanDays % TUNING.cleanDaysPerShield === 0 && _state.debt.shields < TUNING.maxShields) {
      _state.debt.shields++;
      receipt.shieldEarned = true;
      _addNote(`🛡 Earned Debt Shield (${_state.debt.shields}/${TUNING.maxShields})`);
    }

    // Debt decay after consecutive clean days
    if (_state.debt.cleanDays >= TUNING.cleanDaysForDecay) {
      for (const subj of SUBJECTS) {
        if (_state.debt.principal[subj] > 0 && _state.debt.totalDecayForgiven[subj] < TUNING.maxDecayForgiveness) {
          const forgive = Math.min(TUNING.decayPerCleanDay, _state.debt.principal[subj]);
          _state.debt.principal[subj] -= forgive;
          _state.debt.totalDecayForgiven[subj] += forgive;
          _addNote(`✨ ${subj} debt decay: −${forgive} (clean streak)`);
        }
      }
    }
  } else {
    _state.debt.cleanDays = 0;
  }

  // ── Finalize ──
  receipt.totalDebtAfter = _totalDebt();
  receipt.tierAfter = _getTier(receipt.totalDebtAfter).name;
  _state.debt.lastSettlementLocalDate = today;

  // Reset snapshot for new day
  _snapshot = _defaultSnapshot();
  _captureStartOfDay();

  _save();
  _saveSnapshot();

  return receipt;
}

function _recomputeGlobalElo() {
  // Mirror app.js _computeGlobalMetaMMR
  const clampPos = v => Math.max(1, Number(v) || 1);
  const P = clampPos(AppState.elo.physics);
  const C = clampPos(AppState.elo.chemistry);
  const M = clampPos(AppState.elo.maths);
  const harm = Math.pow((P ** -2 + C ** -2 + M ** -2) / 3, -1 / 2);
  const mean = (P + C + M) / 3;
  const penalty = 0.15 * (Math.max(0, mean - P) + Math.max(0, mean - C) + Math.max(0, mean - M));
  AppState.elo.global = Math.max(0, Math.round(harm - penalty));
}

function _captureStartOfDay() {
  for (const subj of SUBJECTS) {
    _state.debt.startOfDay[subj] = _subjectDebt(subj);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  SNAPSHOT (anti-reload-exploit)
// ═══════════════════════════════════════════════════════════════════════

function captureSnapshot() {
  if (!_state) return;
  const today = _todayKey();
  if (_snapshot.date !== today) {
    _snapshot = _defaultSnapshot();
  }
  for (const subj of SUBJECTS) {
    _snapshot.targets[subj] = _effectiveTarget(subj);
    _snapshot.solved[subj] = solved[subj] || 0;
  }
  if (_state.collateral.active) {
    _snapshot.collateral = { ..._state.collateral.active };
  }
  _saveSnapshot();
}

let _throttledSnapshotTimer = null;
function captureSnapshotThrottled() {
  if (_throttledSnapshotTimer) return;
  _throttledSnapshotTimer = setTimeout(() => {
    _throttledSnapshotTimer = null;
    captureSnapshot();
  }, 5000);
}

// ═══════════════════════════════════════════════════════════════════════
//  COLLATERAL ENGINE
// ═══════════════════════════════════════════════════════════════════════

function _maxStakeForSubject(subj) {
  const elo = _subjectElo(subj);
  const tier = _getTier(_totalDebt());
  const absMax = Math.min(TUNING.maxStakeAbs, Math.floor(elo * TUNING.maxStakePctOfElo));
  const available = Math.max(0, elo - TUNING.eloFloor);
  const tierAdjusted = Math.floor(absMax * tier.stakeCapMult);
  return Math.max(0, Math.min(tierAdjusted, available));
}

function _bonusPctForStake(stake, maxStake) {
  if (maxStake <= 0) return TUNING.bonusMin;
  const ratio = _clamp(stake / maxStake, 0, 1);
  // Convex ramp: a half-max stake earns well under half the bonus range,
  // so approaching bonusMax requires genuinely maxing out the stake.
  const curved = Math.pow(ratio, TUNING.bonusCurveExp || 1);
  return _clamp(TUNING.bonusMin + curved * (TUNING.bonusMax - TUNING.bonusMin), TUNING.bonusMin, TUNING.bonusMax);
}

function _stretchTargetForBonus(requiredTarget, bonusPct) {
  const mult = 1 + (bonusPct - TUNING.bonusMin) * TUNING.stretchExponent;
  return Math.ceil(requiredTarget * mult);
}

function canOpenCollateral(subj) {
  if (!_state) return { ok: false, reason: 'Engine not initialized' };

  // One contract per day
  if (_state.collateral.active) return { ok: false, reason: 'Contract already active today' };

  // Cooldown after liquidation
  if (_state.freeze.collateralCooldownUntilLocalDate) {
    if (_todayKey() < _state.freeze.collateralCooldownUntilLocalDate) {
      return { ok: false, reason: 'Collateral on cooldown after liquidation' };
    }
  }

  // Restructure disable
  if (_state.freeze.collateralDisabledUntilLocalDate) {
    if (_todayKey() < _state.freeze.collateralDisabledUntilLocalDate) {
      return { ok: false, reason: 'Collateral disabled (restructuring)' };
    }
  }

  // Mood fried
  if (AppState.moodMultiplier === 0.70) {
    return { ok: false, reason: 'CNS fried — no risk contracts allowed' };
  }

  // Debt CRITICAL
  if (_getTier(_totalDebt()).name === 'CRITICAL') {
    return { ok: false, reason: 'Debt CRITICAL — collateral disabled' };
  }

  // Target already met
  if ((solved[subj] || 0) >= _effectiveTarget(subj)) {
    return { ok: false, reason: 'Target already complete — no free bonus farming' };
  }

  // Max stake check
  if (_maxStakeForSubject(subj) < TUNING.minStake) {
    return { ok: false, reason: 'Insufficient ELO above floor for stake' };
  }

  return { ok: true, reason: '' };
}

function openCollateral(subj, stakeAmount) {
  const check = canOpenCollateral(subj);
  if (!check.ok) return { ok: false, reason: check.reason };

  const maxStake = _maxStakeForSubject(subj);
  const stake = _clamp(Math.floor(stakeAmount), TUNING.minStake, maxStake);
  const bonusPct = _bonusPctForStake(stake, maxStake);
  const maxEscrowBonus = Math.round(stake * TUNING.maxEscrowBonusMult);
  const requiredTarget = _effectiveTarget(subj);
  const stretchTarget = _stretchTargetForBonus(requiredTarget, bonusPct);

  // HARD ESCROW: remove stake from live ELO immediately
  AppState.elo[subj] -= stake;
  _recomputeGlobalElo();

  _state.collateral.active = {
    subject: subj,
    stake,
    bonusPct,
    maxEscrowBonus,
    escrowBonus: 0,
    requiredTarget,
    stretchTarget,
    openedAt: new Date().toISOString(),
    status: 'active',
  };

  // Freeze targets
  _state.freeze.targetFreezeReason = 'collateral';
  _state.freeze.targetFreezeUntilLocalDate = null;   // until settlement

  _addNote(`🔒 Collateral opened: ${stake} ${subj} ELO staked, ${Math.round(bonusPct * 100)}% bonus, stretch ${stretchTarget}`);
  _save();
  captureSnapshot();

  return { ok: true, contract: _state.collateral.active };
}

/**
 * Called from calculateEloMigration() hook.
 * Accrues escrow bonus on positive ELO deltas. Does NOT modify rawDelta.
 * Returns the accrued amount (for UI toast).
 */
function accrueEscrowBonus(subj, rawDelta, modeMult = 1) {
  if (!_state || !_state.collateral.active) return 0;
  const c = _state.collateral.active;
  if (c.subject !== subj || c.status !== 'active') return 0;
  if (rawDelta <= 0) return 0;

  // modeMult: practice-mode escrow multiplier (hardcore 2× legendary drop
  // rate). Applied INSIDE the engine so the stored escrow matches what the
  // toast reports — previously app.js multiplied only the display value.
  const bonus = rawDelta * c.bonusPct * (modeMult || 1);
  const room = Math.max(0, c.maxEscrowBonus - c.escrowBonus);
  const accrued = Math.min(bonus, room);

  if (accrued > 0) {
    c.escrowBonus += accrued;
    _save();
  }
  return accrued;
}

// ═══════════════════════════════════════════════════════════════════════
//  TARGET FREEZE / ANTI-CHEAT
// ═══════════════════════════════════════════════════════════════════════

function isTargetEditBlocked() {
  if (!_state) return { blocked: false, reason: '' };

  // Collateral active → hard lock
  if (_state.collateral.active) {
    return { blocked: true, reason: 'Collateral contract active — targets frozen until settlement' };
  }

  // Explicit freeze
  if (_state.freeze.targetFreezeReason && _state.freeze.targetFreezeUntilLocalDate) {
    if (_todayKey() < _state.freeze.targetFreezeUntilLocalDate) {
      return { blocked: true, reason: `Targets frozen: ${_state.freeze.targetFreezeReason}` };
    }
  }

  return { blocked: false, reason: '' };
}

function isTargetDecreaseBlocked(subj, newTarget) {
  if (!_state) return { blocked: false, reason: '' };

  const currentTarget = baseTargets[subj] || 10;
  if (newTarget >= currentTarget) return { blocked: false, reason: '' };  // increases always OK

  // Debt exists → no decreases
  if (_subjectDebt(subj) > 0) {
    return { blocked: true, reason: `${subj} has active debt — cannot lower target. Use Debt Restructure.` };
  }

  return { blocked: false, reason: '' };
}

/**
 * Emergency restructuring: lower target by up to 20%, pay debt penalty,
 * disable collateral for 2 days.
 */
function restructureDebt(subj, newTarget) {
  if (!_state) return { ok: false, reason: 'Not initialized' };
  if (_state.collateral.active) return { ok: false, reason: 'Cannot restructure while collateral active' };

  const currentTarget = baseTargets[subj] || 10;
  if (newTarget >= currentTarget) return { ok: false, reason: 'New target must be lower' };

  const maxReduction = Math.ceil(currentTarget * TUNING.restructureMaxReductionPct);
  const reduction = currentTarget - newTarget;
  if (reduction > maxReduction) {
    return { ok: false, reason: `Max reduction is ${maxReduction} (20% of ${currentTarget})` };
  }

  // Penalty: add reduction to debt
  _state.debt.principal[subj] += reduction;
  _addNote(`⚠️ Restructured ${subj}: target ${currentTarget}→${newTarget}, +${reduction} debt penalty`);

  // Disable collateral for 2 days
  const disableDate = new Date();
  disableDate.setDate(disableDate.getDate() + TUNING.restructureCollateralDisableDays);
  _state.freeze.collateralDisabledUntilLocalDate = _todayKey(disableDate);

  _save();
  return { ok: true, penalty: reduction };
}

// ═══════════════════════════════════════════════════════════════════════
//  OVERTIME / LIVE DEBT COMPUTATION
// ═══════════════════════════════════════════════════════════════════════

function getLiveDebtView() {
  if (!_state) return { total: 0, tier: DEBT_TIERS[0], subjects: {}, overtime: {} };

  const subjects = {};
  const overtime = {};
  let total = 0;

  for (const subj of SUBJECTS) {
    const principal = _state.debt.principal[subj] || 0;
    const interest = _state.debt.interest[subj] || 0;
    const raw = principal + interest;
    const target = _effectiveTarget(subj);
    const solvedToday = solved[subj] || 0;
    const ot = Math.max(0, solvedToday - target);
    const pendingRepay = Math.min(raw, ot);
    const visible = raw - pendingRepay;

    subjects[subj] = { principal, interest, raw, visible, pendingRepay };
    overtime[subj] = { ot, pendingRepay };
    total += visible;
  }

  return { total, tier: _getTier(total), subjects, overtime };
}

// ═══════════════════════════════════════════════════════════════════════
//  RISK SCORE (for UI color / banner priority)
// ═══════════════════════════════════════════════════════════════════════

function getRiskScore() {
  if (!_state) return 0;
  const total = _totalDebt();
  const debtWeight = Math.min(50, total * 1.2);
  const collateralWeight = _state.collateral.active ? 20 : 0;
  const hour = new Date().getHours();
  const timePressure = hour >= 18 ? 15 : (hour >= 14 ? 8 : 0);
  return Math.round(debtWeight + collateralWeight + timePressure);
}

// ═══════════════════════════════════════════════════════════════════════
//  CAT-BANNER VULNERABILITIES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Returns an array of {priority, className, text} for the cat-banner scanner.
 * Called from _scanCatBannerVulnerabilities() in app.js.
 */
function getCatBannerVulnerabilities() {
  if (!_state) return [];
  const vulns = [];
  const hour = new Date().getHours();

  // P1: Liquidation imminent
  if (_state.collateral.active) {
    const c = _state.collateral.active;
    const subjSolved = solved[c.subject] || 0;
    const pct = c.requiredTarget > 0 ? (subjSolved / c.requiredTarget) * 100 : 0;
    if (hour >= 18 && pct < 80) {
      vulns.push({
        priority: 1,
        className: 'glow-red',
        text: `⚠️ MARGIN CALL: Your ${c.subject} collateral is exposed. ${subjSolved}/${c.requiredTarget} done. Finish or get liquidated.`,
      });
    }
  }

  // P2: Debt CRITICAL
  const tier = _getTier(_totalDebt());
  if (tier.name === 'CRITICAL') {
    vulns.push({
      priority: 2,
      className: 'glow-red',
      text: `🚨 CREDIT DEFAULT: Debt ${_totalDebt()} — CRITICAL. Collateral disabled, ELO decay active. Grind out.`,
    });
  }

  // P3: Debt DEFAULT
  if (tier.name === 'DEFAULT') {
    vulns.push({
      priority: 3,
      className: 'glow-red',
      text: `💸 DEBT DEFAULT: ${_totalDebt()} unpaid. Overtime solves are now repayment solves.`,
    });
  }

  // P4: Overtime available
  if (tier.name !== 'CLEAN') {
    const anyOvertime = SUBJECTS.some(s => (solved[s] || 0) > _effectiveTarget(s) && _subjectDebt(s) > 0);
    if (anyOvertime) {
      vulns.push({
        priority: 4,
        className: 'glow-orange',
        text: `⚡ OVERTIME ACTIVE: Daily target cleared. Extra solves now reduce your debt pool.`,
      });
    }
  }

  return vulns;
}

// ═══════════════════════════════════════════════════════════════════════
//  UI: RISK & ACCOUNTABILITY DESK
// ═══════════════════════════════════════════════════════════════════════

function renderDesk() {
  const container = document.getElementById('accountability-desk');
  if (!container) return;
  if (!_state) {
    // Engine not yet initialized — show a loading placeholder
    container.innerHTML = `<div class="acct-desk-inner"><div style="padding:16px;color:var(--text-muted);text-align:center">Accountability Engine loading…</div></div>`;
    return;
  }

  const view = getLiveDebtView();
  const tier = view.tier;
  const c = _state.collateral.active;
  const risk = getRiskScore();
  const riskLabel = risk <= 20 ? 'STABLE' : risk <= 50 ? 'PRESSURED' : 'DANGEROUS';
  const riskColor = risk <= 20 ? '#22c55e' : risk <= 50 ? '#f97316' : '#ef4444';

  // ── Top row: Debt ──
  const debtChips = SUBJECTS.map(s => {
    const d = view.subjects[s];
    const label = s.charAt(0).toUpperCase();
    const val = d.visible;
    const color = val === 0 ? '#22c55e' : val <= 7 ? '#f97316' : '#ef4444';
    return `<span class="acct-chip" style="--chip-c:${color}">${label}:${val}</span>`;
  }).join('');

  const overtimeInfo = SUBJECTS.map(s => {
    const ot = view.overtime[s];
    return ot.pendingRepay > 0 ? `⚡${ot.pendingRepay}` : '';
  }).filter(Boolean).join(' ');

  const interestRisk = _state.settings.interestEnabled && _totalDebt() > 0
    ? `<span class="acct-interest-warn">Interest tonight if no repayment</span>` : '';

  // ── Bottom row: Collateral ──
  let collateralHtml = '';
  if (c) {
    const subjSolved = solved[c.subject] || 0;
    const pct = c.requiredTarget > 0 ? Math.min(100, (subjSolved / c.requiredTarget) * 100) : 0;
    const stretchPct = c.stretchTarget > c.requiredTarget
      ? Math.min(100, ((subjSolved - c.requiredTarget) / (c.stretchTarget - c.requiredTarget)) * 100)
      : 100;
    const hour = new Date().getHours();
    const hoursLeft = Math.max(0, 24 - hour);
    const paceLabel = subjSolved >= c.requiredTarget
      ? (subjSolved >= c.stretchTarget ? '🟢 Stretch met' : `🟡 Target met — push for stretch (${subjSolved}/${c.stretchTarget})`)
      : `🔴 Behind: ${subjSolved}/${c.requiredTarget} · ${hoursLeft}h left`;

    collateralHtml = `
      <div class="acct-collateral active">
        <div class="acct-collateral-head">
          <span class="acct-lock-icon">🔒</span>
          <span class="acct-collateral-subj">${c.subject.toUpperCase()}</span>
          <span class="acct-collateral-stake">${c.stake} ELO staked</span>
        </div>
        <div class="acct-collateral-body">
          <div class="acct-escrow-row">
            <span>Escrow bonus:</span>
            <span class="acct-escrow-val">+${Math.round(c.escrowBonus)} / ${c.maxEscrowBonus} locked</span>
          </div>
          <div class="acct-escrow-bar">
            <div class="acct-escrow-fill" style="width:${c.maxEscrowBonus > 0 ? (c.escrowBonus / c.maxEscrowBonus) * 100 : 0}%"></div>
          </div>
          <div class="acct-stretch-row">
            <span>Stretch unlock:</span>
            <span>${Math.round(Math.max(0, stretchPct))}%</span>
          </div>
          <div class="acct-pace">${paceLabel}</div>
        </div>
        <div class="acct-collateral-condition">
          Liquidation if &lt; ${c.requiredTarget} solved · Stretch ${c.stretchTarget} for full bonus
        </div>
      </div>`;
  } else {
    // Collateral opener
    const openableSubjs = SUBJECTS.filter(s => canOpenCollateral(s).ok);
    if (openableSubjs.length > 0) {
      const subjOptions = openableSubjs.map(s => {
        const max = _maxStakeForSubject(s);
        return `<option value="${s}" data-max="${max}">${s.charAt(0).toUpperCase() + s.slice(1)} (max ${max})</option>`;
      }).join('');

      collateralHtml = `
        <div class="acct-collateral idle">
          <div class="acct-collateral-head"><span>Collateral Desk</span></div>
          <div class="acct-open-form">
            <select id="acct-collateral-subj" class="acct-select">${subjOptions}</select>
            <div class="acct-stake-row">
              <input type="range" id="acct-stake-slider" min="${TUNING.minStake}" max="40" value="${TUNING.minStake}" class="acct-slider">
              <span id="acct-stake-val" class="acct-stake-val">${TUNING.minStake}</span>
            </div>
            <div class="acct-bonus-preview" id="acct-bonus-preview">Bonus: 25% · Stretch: ×1.00</div>
            <button class="btn btn-primary acct-open-btn" id="acct-open-btn" onclick="window.__accountability.openFromUI()">
              Open Contract
            </button>
          </div>
        </div>`;
    } else {
      const reason = canOpenCollateral(SUBJECTS[0]).reason;
      collateralHtml = `
        <div class="acct-collateral disabled">
          <div class="acct-collateral-head"><span>Collateral Desk</span></div>
          <div class="acct-collateral-locked">🔒 ${reason}</div>
        </div>`;
    }
  }

  // ── Shields ──
  const shieldHtml = _state.settings.debtShieldEnabled
    ? `<span class="acct-shields" title="Debt Shields (auto-forgive up to 3 missed)">🛡 ×${_state.debt.shields}</span>` : '';

  // ── Ledger toggle ──
  const recentNotes = _state.debt.notes.slice(0, 5).map(n =>
    `<div class="acct-note">${n.text}</div>`
  ).join('');

  container.innerHTML = `
    <div class="acct-desk-inner">
      <div class="acct-top-row">
        <!-- ── Deload Day: schedule button when eligible ── -->
        <div class="acct-deload-row" style="margin-bottom:0.5rem">
          <span style="font-size:12px;color:var(--text-muted)">Deload:</span>
          <button class="btn btn-sm" style="font-size:11px;padding:2px 10px;margin-left:6px;background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.3);color:#c4b5fd;border-radius:4px;cursor:pointer"
                  onclick="window.scheduleDeloadFromUi()">🌿 Schedule Earned Rest</button>
        </div>
        <div class="acct-debt-status" style="--tier-color:${tier.color}">
          <span class="acct-tier-badge">${tier.name}</span>
          <span class="acct-debt-total">${view.total}</span>
          ${shieldHtml}
        </div>
        <div class="acct-debt-chips">${debtChips}</div>
        <div class="acct-overtime">${overtimeInfo}</div>
        ${interestRisk}
        <span class="acct-risk-score" style="color:${riskColor}">${riskLabel} ${risk}</span>
      </div>
      <div class="acct-bottom-row">
        ${collateralHtml}
      </div>
      <div class="acct-ledger-toggle" onclick="window.__accountability.toggleLedger()">
        ▾ Ledger
      </div>
      <div class="acct-ledger" id="acct-ledger" style="display:none">
        ${recentNotes || '<div class="acct-note">No entries yet.</div>'}
        <div class="acct-history-summary">
          Collateral: ${_state.collateral.history.filter(h => h.status === 'won').length}W /
          ${_state.collateral.history.filter(h => h.status === 'liquidated').length}L
          · Clean days: ${_state.debt.cleanDays}
        </div>
      </div>
    </div>`;

  // Wire slider
  const slider = document.getElementById('acct-stake-slider');
  const valEl = document.getElementById('acct-stake-val');
  const previewEl = document.getElementById('acct-bonus-preview');
  if (slider && valEl && previewEl) {
    const subjSel = document.getElementById('acct-collateral-subj');
    const updatePreview = () => {
      const subj = subjSel ? subjSel.value : 'physics';
      const max = _maxStakeForSubject(subj);
      slider.max = Math.max(TUNING.minStake, max);
      const stake = parseInt(slider.value);
      const bonus = _bonusPctForStake(stake, max);
      const stretch = _stretchTargetForBonus(_effectiveTarget(subj), bonus);
      valEl.textContent = stake;
      previewEl.textContent = `Bonus: ${Math.round(bonus * 100)}% · Stretch: ${stretch} (need ${stretch - _effectiveTarget(subj)} extra)`;
    };
    slider.addEventListener('input', updatePreview);
    if (subjSel) subjSel.addEventListener('change', updatePreview);
    updatePreview();
  }
}

function openFromUI() {
  const subjSel = document.getElementById('acct-collateral-subj');
  const slider = document.getElementById('acct-stake-slider');
  if (!subjSel || !slider) return;
  const subj = subjSel.value;
  const stake = parseInt(slider.value);
  const result = openCollateral(subj, stake);
  if (!result.ok) {
    alert(`Cannot open contract: ${result.reason}`);
    return;
  }
  renderDesk();
  captureSnapshot();
}

function toggleLedger() {
  const el = document.getElementById('acct-ledger');
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// ═══════════════════════════════════════════════════════════════════════
//  SETTLEMENT RECEIPT MODAL
// ═══════════════════════════════════════════════════════════════════════

function showSettlementReceipt(receipt) {
  if (!receipt) return;
  const overlay = document.getElementById('settlement-receipt-modal');
  if (!overlay) return;

  const subjRows = SUBJECTS.map(s => {
    const info = receipt.subjects[s];
    if (!info) return '';
    const debtStr = receipt.debtAdded[s] > 0 ? `→ +${receipt.debtAdded[s]} debt` : '';
    const repayStr = receipt.debtRepaid[s] > 0 ? `→ repaid ${receipt.debtRepaid[s]}` : '';
    const shieldStr = receipt.shieldsUsed[s] > 0 ? `🛡 shield −${receipt.shieldsUsed[s]}` : '';
    const intStr = receipt.interestAdded[s] > 0 ? `📈 +${receipt.interestAdded[s]} interest` : '';
    const decayStr = receipt.decayApplied[s] > 0 ? `📉 −${receipt.decayApplied[s]} ELO decay` : '';
    return `<div class="receipt-row">
      <span class="receipt-subj">${s.charAt(0).toUpperCase() + s.slice(1)}</span>
      <span class="receipt-nums">${info.solved} / ${info.target}</span>
      <span class="receipt-detail">${[debtStr, repayStr, shieldStr, intStr, decayStr].filter(Boolean).join(' · ')}</span>
    </div>`;
  }).join('');

  let collateralStr = '';
  if (receipt.collateralResult) {
    const cr = receipt.collateralResult;
    if (cr.status === 'won') {
      collateralStr = `<div class="receipt-collateral won">🏆 Collateral WON: +${cr.stake} stake returned, +${cr.depositedBonus} bonus (${Math.round((cr.unlockFraction || 1) * 100)}% stretch unlock)</div>`;
    } else {
      collateralStr = `<div class="receipt-collateral lost">💀 Collateral LIQUIDATED: ${cr.stake} ${cr.subject} ELO destroyed. Escrow bonus lost.</div>`;
    }
  }

  const extraLines = [];
  if (receipt.cleanDayEarned) extraLines.push('✅ Clean day earned');
  if (receipt.shieldEarned) extraLines.push('🛡 Debt Shield earned!');
  if (receipt.absence) extraLines.push('⚠️ Absence detected — debt capped');

  const content = document.getElementById('settlement-receipt-content');
  if (content) {
    content.innerHTML = `
      <h2>YESTERDAY SETTLEMENT</h2>
      <div class="receipt-date">${receipt.date}</div>
      ${subjRows}
      <div class="receipt-total">Total debt: ${receipt.totalDebtAfter} → ${receipt.tierAfter}</div>
      ${collateralStr}
      ${extraLines.map(l => `<div class="receipt-extra">${l}</div>`).join('')}
      <button class="btn btn-primary receipt-ack" onclick="document.getElementById('settlement-receipt-modal').classList.remove('active'); setTimeout(()=>document.getElementById('settlement-receipt-modal').style.display='none',300);">
        Acknowledged. Time to grind.
      </button>`;
  }

  overlay.style.display = 'flex';
  requestAnimationFrame(() => overlay.classList.add('active'));
}

// ═══════════════════════════════════════════════════════════════════════
//  COCKPIT CHIP
// ═══════════════════════════════════════════════════════════════════════

function getCockpitChip() {
  if (!_state) return null;

  // Collateral active → show locked bonus
  if (_state.collateral.active) {
    const c = _state.collateral.active;
    if (c.escrowBonus > 0) {
      return { text: `🔒 +${Math.round(c.escrowBonus)}`, color: '#a78bfa' };
    }
  }

  // Debt critical → show total
  const total = _totalDebt();
  if (total > 40) {
    return { text: `💸 ${total}`, color: '#ef4444' };
  }

  // Overtime available
  const anyOvertime = SUBJECTS.some(s => (solved[s] || 0) > _effectiveTarget(s) && _subjectDebt(s) > 0);
  if (anyOvertime) {
    return { text: '⚡ Overtime', color: '#f97316' };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════
//  ESCROW TOAST (after ELO gain)
// ═══════════════════════════════════════════════════════════════════════

function renderEscrowToast(eloResult) {
  if (!_state || !_state.collateral.active || !eloResult) return;
  const c = _state.collateral.active;
  if (c.subject !== eloResult.subject) return;
  if (c.escrowBonus <= 0) return;

  const container = document.getElementById('practice-modal-content');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'acct-escrow-toast';
  toast.innerHTML = `🔒 +${Math.round(c.escrowBonus)} pending collateral bonus`;
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
}

// ═══════════════════════════════════════════════════════════════════════
//  DEBUG / RESET SURFACE
// ═══════════════════════════════════════════════════════════════════════

function reset() {
  _state = _defaultState();
  _snapshot = _defaultSnapshot();
  _save();
  _saveSnapshot();
  renderDesk();
  console.log('[acct] Reset complete');
}

function simulateSettlement() {
  const receipt = settlePreviousDayIfNeeded();
  if (receipt) showSettlementReceipt(receipt);
  else console.log('[acct] Nothing to settle');
}

function forceLiquidation() {
  if (!_state || !_state.collateral.active) { console.log('[acct] No active contract'); return; }
  const c = _state.collateral.active;
  c.status = 'liquidated';
  _state.collateral.history.unshift({ ...c, settledAt: new Date().toISOString() });
  _state.collateral.active = null;
  _addNote(`💀 FORCE LIQUIDATION: ${c.stake} ${c.subject} ELO destroyed`);
  _save();
  renderDesk();
}

// ═══════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════

async function init() {
  await _load();
  _captureStartOfDay();
  _initialized = true;
  renderDesk();
}

// ═══════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════

export const AccountabilityEngine = {
  init,
  settlePreviousDayIfNeeded,
  captureSnapshot,
  captureSnapshotThrottled,
  accrueEscrowBonus,
  canOpenCollateral,
  openCollateral,
  isTargetEditBlocked,
  isTargetDecreaseBlocked,
  restructureDebt,
  getLiveDebtView,
  getRiskScore,
  getCatBannerVulnerabilities,
  getCockpitChip,
  renderDesk,
  renderEscrowToast,
  showSettlementReceipt,
  openFromUI,
  toggleLedger,
  reset,
  simulateSettlement,
  forceLiquidation,
  get state() { return _state; },
  get snapshot() { return _snapshot; },
};

// Window global for cross-module / inline-onclick access
window.__accountability = AccountabilityEngine;
