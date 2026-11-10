/* ============================================================================
   flow-slider.js — the single source of truth for Flow intensity.
   ----------------------------------------------------------------------------
   The slider is a 0–100 dial, not a mode switch. 0–30 is rest/reading, 31–62
   is a steady tap, 63–97 is the Flow channel, and 98–100 is Hardcore (the old
   standalone mode, now only the top of this dial).

   Everything here is pure so the picker, reward gate, Lock-In chamber, live
   dock and Node smoke tests all agree on the same numbers.
   ============================================================================ */

export const FLOW_SLIDER_MIN = 0;
export const FLOW_SLIDER_MAX = 100;
/** The shipped default matches the component's original 72. */
export const FLOW_SLIDER_DEFAULT = 72;
/** 98–100 is Hardcore. The reward gate is binary; the dial is continuous. */
export const HARDCORE_THRESHOLD = 98;

/** The first value in each visual zone. Kept in sync with the pixel room:
 *  READ_TO=30, TAP_TO=62, MAX_FROM=98 in slider-resident.js. */
export const FLOW_ZONES = Object.freeze([
    Object.freeze({ id: 'read',  name: 'Rest',     min: 0,  max: 30,  hardcore: false }),
    Object.freeze({ id: 'tap',   name: 'Steady',   min: 31, max: 62,  hardcore: false }),
    Object.freeze({ id: 'dance', name: 'Flow',     min: 63, max: 97,  hardcore: false }),
    Object.freeze({ id: 'wild',  name: 'Hardcore', min: 98, max: 100, hardcore: true  }),
]);

export const mix = (a, b, t) => a + (b - a) * t;
export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const clampFlowValue = (v) => {
    const n = Number(v);
    if (!isFinite(n)) return FLOW_SLIDER_DEFAULT;
    return Math.min(FLOW_SLIDER_MAX, Math.max(FLOW_SLIDER_MIN, Math.round(n)));
};

export function zoneForValue(value) {
    const v = clampFlowValue(value);
    for (let i = 0; i < FLOW_ZONES.length; i++) {
        const z = FLOW_ZONES[i];
        if (v >= z.min && v <= z.max) return z;
    }
    return FLOW_ZONES[FLOW_ZONES.length - 1];
}

export function isHardcoreValue(value) {
    return clampFlowValue(value) >= HARDCORE_THRESHOLD;
}

/** The only reward decision: below 98 = Flow (1.0×), 98–100 = Hardcore. */
export function modeForValue(value) {
    return isHardcoreValue(value) ? 'hardcore' : 'flow';
}

/**
 * Target P(win) the picker aims at. A low dial asks for easy wins; the top of
 * the dial asks for genuine underdog fights. Values are piecewise-linear
 * keyframes rather than one formula so the four zones keep their character.
 *
 *   0 → 0.94   (rest)
 *   30 → 0.87  (steady)
 *   62 → 0.80  (edge of Flow)
 *   97 → 0.56  (deep Flow)
 *   98 → 0.50  (Hardcore entrance)
 *   100 → 0.34 (maximum overload)
 */
const PWIN_KEYS = Object.freeze([
    [0, 0.94], [30, 0.87], [62, 0.80], [97, 0.56], [98, 0.50], [100, 0.34],
]);

export function pWinForValue(value) {
    const v = clampFlowValue(value);
    for (let i = 1; i < PWIN_KEYS.length; i++) {
        const [x1, y1] = PWIN_KEYS[i - 1];
        const [x2, y2] = PWIN_KEYS[i];
        if (v <= x2) {
            const t = x2 === x1 ? 0 : (v - x1) / (x2 - x1);
            return mix(y1, y2, t);
        }
    }
    return PWIN_KEYS[PWIN_KEYS.length - 1][1];
}

/** Convert a target P(win) into the qElo that represents it for a user. */
export function eloForPWin(userElo, pWin) {
    const p = Math.min(0.99, Math.max(0.01, Number(pWin) || 0.5));
    return (Number(userElo) || 1200) - 400 * Math.log10(p / (1 - p));
}

/**
 * The qElo the Gaussian picker centres on.
 *
 * Below 63 this is purely relative to the user. Above 62 an upward "overload
 * anchor" joins the blend (70% relative / 30% anchor), which keeps high dial
 * values hard even when the user's own Elo has outrun the chapter: the anchor
 * at v=100 is 2300, and it never sits below the chapter's average qElo.
 *
 * The anchor weight ramps in over the Flow zone, so crossing 62 does not jump
 * the centre — the top end is where the extra pressure lives.
 */
export function centerElo(userElo, value, chapterAvgElo) {
    const v = clampFlowValue(value);
    const user = Number(userElo) || 1200;
    const relative = eloForPWin(user, pWinForValue(v));
    if (v <= 62) return relative;
    const ramp = clamp01((v - 62) / (HARDCORE_THRESHOLD - 62)) * 0.3;
    const anchorFloor = 1200 + Math.pow(v / 100, 1.35) * 1100;
    const chapterAvg = Number(chapterAvgElo);
    const anchor = Math.max(isFinite(chapterAvg) ? chapterAvg : user, anchorFloor);
    return mix(relative, anchor, ramp);
}

/** Rewards stay binary across the dial: Flow 1.0× / 1.0×; Hardcore 1.8× / 0.6×. */
export function profileForValue(value) {
    const v = clampFlowValue(value);
    const hardcore = v >= HARDCORE_THRESHOLD;
    const zone = zoneForValue(v);
    if (hardcore) {
        const t = clamp01((v - HARDCORE_THRESHOLD) / (FLOW_SLIDER_MAX - HARDCORE_THRESHOLD));
        return {
            mode: 'hardcore',
            zone,
            winsMultiplier: 1.8,
            lossMultiplier: 0.6,
            escrowBonusMultiplier: 2.0,
            winSweetSpot: mix(0.50, 0.40, t),
            lossFastGrace: 0.30,
        };
    }
    const t = clamp01(v / (HARDCORE_THRESHOLD - 1));
    return {
        mode: 'flow',
        zone,
        winsMultiplier: 1.0,
        lossMultiplier: 1.0,
        escrowBonusMultiplier: 1.0,
        winSweetSpot: mix(0.80, 0.55, t),
        lossFastGrace: mix(0.55, 0.42, t),
    };
}

/** Short readout for docks/headers: "72 · FLOW". */
export function labelForValue(value) {
    const v = clampFlowValue(value);
    const z = zoneForValue(v);
    return v + ' · ' + z.name.toUpperCase();
}

/** Verbose aria description, aligned with the pixel room's animation. */
export function describeValue(value) {
    const v = clampFlowValue(value);
    if (v === 0) return '0 · resident asleep — room at rest';
    if (v <= 30) return v + ' · reading, headphones on';
    if (v <= 62) return v + ' · tapping the beat';
    if (v < HARDCORE_THRESHOLD) return v + ' · dancing — flow channel open';
    return v + ' · walls shaking — hardcore';
}

/** Convenience aliases used by older call sites / tests. */
export const flowZoneForValue = zoneForValue;
export const flowModeForValue = modeForValue;
export const flowPwinForValue = pWinForValue;
export const flowCenterElo = centerElo;
export const flowProfileForValue = profileForValue;
export const describeFlowValue = describeValue;
