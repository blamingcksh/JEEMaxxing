const BLOCK_SIZE = 16;
const MEGA_BLOCK_SIZE = 32;
const BLOCK_SPACING = 40;
const JUMP_HEIGHT_GAP = 42;
const JUMP_TRIGGER_GAP = 16;

const PALETTE = {
    'R': '#ff2a2a',
    'r': '#b91c1c',
    'S': '#ffd1a3',
    's': '#e59866',
    'E': '#0f172a',
    'B': '#2563eb',
    'b': '#1d4ed8',
    'Y': '#fde047',
    'H': '#6b3410',
    'h': '#3b1a0b',
    'W': '#ffffff',
    'g': '#94a3b8'
};

const MARIO_SPRITES = {
    run1: [
        ".....rRRRRR.....",
        "....rRRRRWWWR...",
        "....HHHSSESH....",
        "...HSHSSSESSSS..",
        "...HSHHSSSHsSS..",
        "...HHSSSSHHHH...",
        ".....sSSSSSS....",
        "....rRBRRR......",
        "...rRRBRRBRRR...",
        "..rRRRBBBBBRRR..",
        "..WWRBYBBBYBRWW.",
        "..WgBBBBBBBBgW..",
        "..ggBBBBBBBBgg..",
        "....BBB..bbb....",
        "...HHh....HHh...",
        "..hhhh....hhhh.."
    ],
    run2: [
        ".....rRRRRR.....",
        "....rRRRRWWWR...",
        "....HHHSSESH....",
        "...HSHSSSESSSS..",
        "...HSHHSSSHsSS..",
        "...HHSSSSHHHH...",
        ".....sSSSSSS....",
        "...rRRRBRRR.....",
        "..rRRRRBRRBRW...",
        "..WWRRBBBBBRWW..",
        "..Wg.BYBBBYB....",
        ".....BBBBBBBB...",
        "....bBBBBBBBBB..",
        "...bBBB....bbb..",
        "..HHHh......HHh.",
        "..hhhh......hhhh"
    ],
    run3: [
        ".....rRRRRR.....",
        "....rRRRRWWWR...",
        "....HHHSSESH....",
        "...HSHSSSESSSS..",
        "...HSHHSSSHsSS..",
        "...HHSSSSHHHH...",
        ".....sSSSSSS....",
        ".....rRBRRR.....",
        "....rRRBRRBR....",
        "....rRBBBBBRR...",
        "....WWYBBBYWW...",
        "....WgBBBBBWg...",
        ".....bBBBBBB....",
        ".....bBBBBBB....",
        "....HHHh.HHh....",
        "....hhhh.hhhh..."
    ],
    jump: [
        "...........WWW..",
        ".....rRRRRRWWg..",
        "....rRRRRWWWR...",
        "....HHHSSESH....",
        "...HSHSSSESSSS..",
        "...HSHHSSSHsSS..",
        "...HHSSSSHHHH...",
        ".....sSSSSSSR...",
        "...rRRRBRRRRR...",
        "..rRRRRBRRBRR...",
        ".WWgRRBBBBBR....",
        ".gg..BYBBBYB....",
        "....bBBBBBBBBB..",
        "...bBBB....bbbb.",
        "..HHHh......HHh.",
        ".hhhh........hhh"
    ],
    fall: [
        ".....rRRRRR.....",
        "....rRRRRWWWR...",
        "....HHHSSESH....",
        "...HSHSSSESSSS..",
        "...HSHHSSSHsSS..",
        "...HHSSSSHHHH...",
        "..WW.sSSSSSS.WW.",
        ".WWgrRRRBRRRrgWW",
        "..g.rRRBRRBRR.g.",
        "....rRBBBBBRR...",
        ".....BYBBBYB....",
        "....bBBBBBBBB...",
        "...bBBBB..BBBB..",
        "...HHHh....HHHh.",
        "..hhhh......hhhh",
        "................"
    ]
};

const PRINCESS_PALETTE = {
    'C': '#facc15',
    'G': '#38bdf8',
    'R': '#f43f5e',
    'Y': '#fde047',
    'y': '#eab308',
    'S': '#ffd1a3',
    's': '#e59866',
    'E': '#0f172a',
    'P': '#f472b6',
    'p': '#ec4899',
    'd': '#be185d',
    'W': '#ffffff'
};

const PRINCESS_SPRITES = {
    walk1: [
        "......CRGC......",
        ".....CCCCCC.....",
        "....YYYYYYYY....",
        "...YYySSSSYYy...",
        "...YYSSESSSYY...",
        "...YYSSSSsSYY...",
        "....yYSSSSYy....",
        "....yWWGGWWy....",
        "...yPPPPPPPPy...",
        "..WWPPPGGPPPWW..",
        "..SSpPPPPPPpSS..",
        "....PPPPPPPP....",
        "...PPPPddPPPP...",
        "..PPPPpddpPPPP..",
        "..PPPPPPPPPPPP..",
        ".pPPPPdWWdPPPPp.",
        ".pPPPddWWddPPPp.",
        ".ddddWWWWWWdddd.",
        "..WWWW....WWWW..",
        "................"
    ],
    walk2: [
        "......CRGC......",
        ".....CCCCCC.....",
        "....YYYYYYYY....",
        "...YYySSSSYYy...",
        "...YYSSESSSYY...",
        "...YYSSSSsSYY...",
        "....yYSSSSYy....",
        "....yWWGGWWy....",
        "...yPPPPPPPPy...",
        "..WWPPPGGPPPWW..",
        "..SSpPPPPPPpSS..",
        "....PPPPPPPP....",
        "...PPPPddPPPP...",
        "..PPPPpddpPPPP..",
        "..PPPPPPPPPPPP..",
        ".pPPPPdWWdPPPPp.",
        ".pPPPddWWddPPPp.",
        ".ddddWWWWWWdddd.",
        "...WWWW..WWWW...",
        "................"
    ],
    hop: [
        "......CRGC......",
        ".....CCCCCC.....",
        "....YYYYYYYY....",
        "...YYySSSSYYy...",
        "...YYSSESSSYY...",
        "...YYSSSSsSYY...",
        "..WWyYSSSSYyWW..",
        "..SSyWWGGWWySS..",
        "...yPPPPPPPPy...",
        "....PPPGGPPP....",
        "....pPPPPPPp....",
        "...PPPPPPPPPP...",
        "..PPPPpddpPPPP..",
        "..PPPPPPPPPPPP..",
        ".pPPPPdWWdPPPPp.",
        ".pPPPddWWddPPPp.",
        ".ddddWWWWWWdddd.",
        "..WWWW....WWWW..",
        "................",
        "................"
    ]
};

const HEART_MATRIX = [
    ".RR.RR.",
    "RRRRRRR",
    "RWRRRRR",
    "RRRRRRR",
    ".RRRRR.",
    "..RRR..",
    "...R..."
];

const HEART_PALETTE = {
    'R': '#fb7185',
    'W': '#ffe4e6'
};

const MUSHROOM_PALETTE = {
    'K': '#1e1b4b',
    'P': '#f43f5e',
    'p': '#be123c',
    'h': '#fda4af',
    'W': '#ffffff',
    'w': '#e2e8f0',
    'C': '#fef3c7',
    'c': '#f59e0b',
    'E': '#0f172a',
    'L': '#ffffff'
};

const MUSHROOM_MATRIX_OPEN = [
    ".....KKKKKK.....",
    "...KKhPPPPPKK...",
    "..KPhWWWWWWPPK..",
    ".KPPWWWWWWWWPPK.",
    ".KPWWWWWWWWWWPK.",
    "KPPWWWWPPWWWWPPK",
    "KPPWWwPPPPwWWPPK",
    "KPPPPPPWWPPPPPPK",
    "KppPPPWWWWPPPppK",
    ".KpppPWWWWPpppK.",
    ".KKKKPPPPPPKKKK.",
    "...KCCCCCCCCK...",
    "..KCCCLCCCLCCK..",
    "..KCCCECCCECCK..",
    "...KccccccccK...",
    "....KKKKKKKK...."
];

const MUSHROOM_MATRIX_BLINK = [
    ".....KKKKKK.....",
    "...KKhPPPPPKK...",
    "..KPhWWWWWWPPK..",
    ".KPPWWWWWWWWPPK.",
    ".KPWWWWWWWWWWPK.",
    "KPPWWWWPPWWWWPPK",
    "KPPWWwPPPPwWWPPK",
    "KPPPPPPWWPPPPPPK",
    "KppPPPWWWWPPPppK",
    ".KpppPWWWWPpppK.",
    ".KKKKPPPPPPKKKK.",
    "...KCCCCCCCCK...",
    "..KCCCCCCCCCCK..",
    "..KCCEECCEECCK..",
    "...KccccccccK...",
    "....KKKKKKKK...."
];

const COIN_FRAMES = [
    [
        "...YYYY...",
        "..YYYYYY..",
        ".YYWWWWYY.",
        ".YYWddWYY.",
        ".YYWddWYY.",
        ".YYWddWYY.",
        ".YYWddWYY.",
        ".YYWddWYY.",
        ".YYWddWYY.",
        ".YYWddWYY.",
        ".YYWddWYY.",
        ".YYddddYY.",
        "..YYYYYY..",
        "...dddd..."
    ],
    [
        "...YYYY...",
        "..YYYYYY..",
        "..YYWWYY..",
        "..YYWdYY..",
        "..YYWdYY..",
        "..YYWdYY..",
        "..YYWdYY..",
        "..YYWdYY..",
        "..YYWdYY..",
        "..YYWdYY..",
        "..YYWdYY..",
        "..YYddYY..",
        "..YYYYYY..",
        "...dddd..."
    ],
    [
        "....YY....",
        "....YY....",
        "....WW....",
        "....WY....",
        "....WY....",
        "....WY....",
        "....WY....",
        "....WY....",
        "....WY....",
        "....WY....",
        "....WY....",
        "....Yd....",
        "....YY....",
        "....dd...."
    ],
    [
        "...YYYY...",
        "..YYYYYY..",
        "..YYYYYY..",
        "..YYdWYY..",
        "..YYdWYY..",
        "..YYdWYY..",
        "..YYdWYY..",
        "..YYdWYY..",
        "..YYdWYY..",
        "..YYdWYY..",
        "..YYdWYY..",
        "..YYddYY..",
        "..YYYYYY..",
        "...dddd..."
    ]
];

const COIN_PALETTE = {
    'Y': '#facc15',
    'W': '#fef9c3',
    'd': '#ca8a04'
};

const QUESTION_MARK_PIXELS = [
    "................",
    "................",
    "................",
    ".....WWWWWW.....",
    "....WWddddWW....",
    "....WWd..WWd....",
    "........WWWd....",
    ".......WWWd.....",
    ".......WWd......",
    "........dd......",
    ".......WW.......",
    ".......WWd......",
    "........dd......",
    "................",
    "................",
    "................"
];

const BLOCK_THEMES = {
    MYSTERY: {
        base: '#f59e0b',
        pulseBase: ['#f59e0b', '#fbbf24', '#f59e0b', '#d97706'],
        light: '#fef08a',
        dark: '#b45309',
        border: '#1e1b4b',
        rivet: '#78350f',
        glow: 'rgba(251, 191, 36, 0.30)',
        lightHex: '#fbbf24',
        rgb: [251, 191, 36]
    },
    green: {
        base: '#10b981',
        light: '#a7f3d0',
        dark: '#047857',
        border: '#022c22',
        rivet: '#064e3b',
        innerSymbol: '#ecfdf5',
        glow: 'rgba(16, 185, 129, 0.65)',
        lightHex: '#10b981',
        rgb: [16, 185, 129]
    },
    purple: {
        base: '#9333ea',
        light: '#e9d5ff',
        dark: '#6b21a8',
        border: '#2e1065',
        rivet: '#4c1d95',
        innerSymbol: '#faf5ff',
        glow: 'rgba(168, 85, 247, 0.65)',
        lightHex: '#a855f7',
        rgb: [168, 85, 247]
    },
    red: {
        base: '#e11d48',
        light: '#fecdd3',
        dark: '#9f1239',
        border: '#4c0519',
        rivet: '#881337',
        innerSymbol: '#fff1f2',
        glow: 'rgba(244, 63, 94, 0.72)',
        lightHex: '#f43f5e',
        rgb: [244, 63, 94]
    },
    grey: {
        base: '#64748b',
        light: '#cbd5e1',
        dark: '#334155',
        border: '#0f172a',
        rivet: '#1e293b',
        innerSymbol: '#e2e8f0',
        glow: 'rgba(148, 163, 184, 0.35)',
        lightHex: '#94a3b8',
        rgb: [148, 163, 184]
    }
};

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function formatEloDelta(delta) {
    const d = Math.round(Number(delta));
    if (!Number.isFinite(d)) return null;
    if (d > 0) return '+' + d;
    if (d < 0) return '\u2212' + Math.abs(d);
    return '\u00b10';
}

function eloDeltaColor(delta) {
    const d = Math.round(Number(delta));
    if (d > 0) return '#34d399';
    if (d < 0) return '#fb7185';
    return '#cbd5e1';
}

function summarizeItems(items) {
    let green = 0;
    let purple = 0;
    let red = 0;
    let skipped = 0;
    let netElo = 0;
    let hasElo = false;
    for (const item of items) {
        if (item.outcome === 'green') green++;
        else if (item.outcome === 'purple') purple++;
        else if (item.outcome === 'red') red++;
        else if (item.outcome === 'grey') skipped++;
        if (item.outcome !== 'grey' && typeof item.eloDelta === 'number' && Number.isFinite(item.eloDelta)) {
            netElo += Math.round(item.eloDelta);
            hasElo = true;
        }
    }
    const total = green + purple + red;
    const correct = green + purple;
    return {
        total,
        green,
        purple,
        red,
        skipped,
        correct,
        accuracyPct: total ? Math.round((correct / total) * 100) : 0,
        netElo,
        hasElo
    };
}

export function resolveSessionVerdict(summary = {}) {
    const total = Number(summary.total) || 0;
    const skipped = Number(summary.skipped) || 0;
    if (total === 0 && skipped > 0) {
        return {
            megaOutcome: 'grey',
            hasVictory: false,
            popText: 'SKIP',
            popColor: '#94a3b8'
        };
    }
    if (summary.hasElo) {
        const net = Math.round(Number(summary.netElo) || 0);
        return {
            megaOutcome: net >= 0 ? 'green' : 'red',
            hasVictory: net > 0,
            popText: formatEloDelta(net),
            popColor: eloDeltaColor(net)
        };
    }
    const netScore = (Number(summary.correct) || 0) - (Number(summary.red) || 0);
    return {
        megaOutcome: netScore >= 0 ? 'green' : 'red',
        hasVictory: netScore > 0,
        popText: total > 0 ? formatEloDelta(netScore) : 'SKIP',
        popColor: eloDeltaColor(netScore)
    };
}

export function classify({ correct, secs, targetSecs } = {}) {
    if (!correct) return 'red';
    const s = Number(secs);
    const target = Number(targetSecs);
    const fast = Number.isFinite(s) && Number.isFinite(target) && s > 0 && target > 0 && s < target;
    return fast ? 'purple' : 'green';
}

function itemKey(q) {
    return q.id != null ? 'id:' + q.id : q;
}

export const SessionRecap = {
    _items: [],
    _byKey: new Map(),

    reset() {
        this._items = [];
        this._byKey = new Map();
    },

    record(q, result) {
        if (!q || !result) return false;
        const key = itemKey(q);
        const secs = Number(result.secs);
        const targetSecs = Number(result.targetSecs);
        const rawElo = result.eloDelta !== undefined && result.eloDelta !== null ? Number(result.eloDelta) : NaN;
        const eloDelta = Number.isFinite(rawElo) ? Math.round(rawElo) : null;
        const existing = this._byKey.get(key);
        if (existing) {
            if (existing.outcome !== 'grey') return false;
            existing.outcome = classify(result);
            existing.secs = Number.isFinite(secs) ? secs : 0;
            existing.targetSecs = Number.isFinite(targetSecs) ? targetSecs : 0;
            if (eloDelta !== null) existing.eloDelta = eloDelta;
            return true;
        }
        const entry = {
            outcome: classify(result),
            secs: Number.isFinite(secs) ? secs : 0,
            targetSecs: Number.isFinite(targetSecs) ? targetSecs : 0,
            eloDelta
        };
        this._byKey.set(key, entry);
        this._items.push(entry);
        return true;
    },

    recordSkip(q) {
        if (!q) return false;
        const key = itemKey(q);
        if (this._byKey.has(key)) return false;
        const entry = {
            outcome: 'grey',
            secs: 0,
            targetSecs: 0,
            eloDelta: null
        };
        this._byKey.set(key, entry);
        this._items.push(entry);
        return true;
    },

    noteElo(q, delta) {
        if (!q) return false;
        const num = Number(delta);
        if (!Number.isFinite(num)) return false;
        const key = itemKey(q);
        const existing = this._byKey.get(key);
        if (!existing || existing.outcome === 'grey') return false;
        existing.eloDelta = Math.round(num);
        return true;
    },

    summarize() {
        return summarizeItems(this._items);
    },

    hasResults() {
        return this._items.length > 0;
    },

    play(options = {}) {
        const items = this._items.slice();
        this.reset();
        if (!items.length) return null;
        if (typeof document === 'undefined' || !document.body) return null;
        if (activeScene) {
            activeScene.destroy();
            activeScene = null;
        }
        return new Promise((resolve) => {
            let scene = null;
            try {
                scene = new MarioRecapScene(items, resolve, options);
                activeScene = scene;
                scene.mount();
            } catch (err) {
                console.error('Mario recap failed:', err);
                if (scene) {
                    try { scene.destroy(); } catch (_) {}
                }
                activeScene = null;
                resolve();
            }
        });
    }
};

let activeScene = null;

function wantMarioSound() {
    if (typeof window === 'undefined') return false;
    if (window.FX && typeof window.FX.wantMarioSound === 'function') {
        return !!window.FX.wantMarioSound();
    }
    try {
        const raw = window.localStorage && window.localStorage.getItem('jeemax_fx_prefs');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (typeof parsed.marioSound === 'boolean') return parsed.marioSound;
        }
    } catch (_) {}
    return true;
}

class RetroSoundEngine {
    getCtx() {
        if (!wantMarioSound()) return null;
        try {
            if (window.FX && typeof window.FX.ctx === 'function') {
                return window.FX.ctx();
            }
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return null;
            if (!window.__jmaxSharedAudio) {
                window.__jmaxSharedAudio = new AudioCtx();
            }
            if (window.__jmaxSharedAudio.state === 'suspended') {
                window.__jmaxSharedAudio.resume().catch(() => {});
            }
            return window.__jmaxSharedAudio;
        } catch (_) {
            return null;
        }
    }

    vol() {
        if (typeof window !== 'undefined' && window.FX && typeof window.FX.vol === 'function') {
            return window.FX.vol();
        }
        return 0.7;
    }

    playJump() {
        const ctx = this.getCtx();
        if (!ctx) return;
        const v = this.vol();
        if (v <= 0) return;
        try {
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(155, now);
            osc.frequency.exponentialRampToValueAtTime(620, now + 0.15);
            gain.gain.setValueAtTime(0.07 * v, now);
            gain.gain.linearRampToValueAtTime(0.008 * v, now + 0.16);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.16);
        } catch (_) {}
    }

    playBump() {
        const ctx = this.getCtx();
        if (!ctx) return;
        const v = this.vol();
        if (v <= 0) return;
        try {
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(165, now);
            osc.frequency.exponentialRampToValueAtTime(48, now + 0.095);
            gain.gain.setValueAtTime(0.18 * v, now);
            gain.gain.linearRampToValueAtTime(0.01 * v, now + 0.095);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.095);
        } catch (_) {}
    }

    playCoin(pitchStep = 0) {
        const ctx = this.getCtx();
        if (!ctx) return;
        const v = this.vol();
        if (v <= 0) return;
        try {
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            const multiplier = Math.pow(1.12, pitchStep);
            osc.frequency.setValueAtTime(987.77 * multiplier, now);
            osc.frequency.setValueAtTime(1318.51 * multiplier, now + 0.07);
            gain.gain.setValueAtTime(0.085 * v, now);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.008 * v), now + 0.35);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.35);
        } catch (_) {}
    }

    playMushroom() {
        const ctx = this.getCtx();
        if (!ctx) return;
        const v = this.vol();
        if (v <= 0) return;
        try {
            const now = ctx.currentTime;
            const notes = [330, 392, 659, 523, 587, 784, 659, 880];
            notes.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'square';
                const start = now + idx * 0.042;
                osc.frequency.setValueAtTime(freq, start);
                gain.gain.setValueAtTime(0.065 * v, start);
                gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.008 * v), start + 0.04);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(start);
                osc.stop(start + 0.041);
            });
        } catch (_) {}
    }

    playRedNova() {
        const ctx = this.getCtx();
        if (!ctx) return;
        const v = this.vol();
        if (v <= 0) return;
        try {
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const sub = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            sub.type = 'triangle';
            osc.frequency.setValueAtTime(240, now);
            osc.frequency.exponentialRampToValueAtTime(55, now + 0.26);
            sub.frequency.setValueAtTime(120, now);
            sub.frequency.exponentialRampToValueAtTime(36, now + 0.26);
            gain.gain.setValueAtTime(0.12 * v, now);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.008 * v), now + 0.26);
            osc.connect(gain);
            sub.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            sub.start(now);
            osc.stop(now + 0.26);
            sub.stop(now + 0.26);
        } catch (_) {}
    }

    playSkip() {
        const ctx = this.getCtx();
        if (!ctx) return;
        const v = this.vol();
        if (v <= 0) return;
        try {
            const now = ctx.currentTime;
            const thud = ctx.createOscillator();
            const thudGain = ctx.createGain();
            thud.type = 'triangle';
            thud.frequency.setValueAtTime(145, now);
            thud.frequency.exponentialRampToValueAtTime(48, now + 0.085);
            thudGain.gain.setValueAtTime(0.08 * v, now);
            thudGain.gain.linearRampToValueAtTime(0.006 * v, now + 0.085);
            thud.connect(thudGain);
            thudGain.connect(ctx.destination);
            thud.start(now);
            thud.stop(now + 0.085);

            const notes = [330, 247];
            notes.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                const start = now + 0.03 + idx * 0.06;
                osc.frequency.setValueAtTime(freq, start);
                gain.gain.setValueAtTime(0.055 * v, start);
                gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.006 * v), start + 0.058);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(start);
                osc.stop(start + 0.06);
            });
        } catch (_) {}
    }

    playMerge() {
        const ctx = this.getCtx();
        if (!ctx) return;
        const v = this.vol();
        if (v <= 0) return;
        try {
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(220, now);
            osc.frequency.exponentialRampToValueAtTime(587.33, now + 0.30);
            gain.gain.setValueAtTime(0.075 * v, now);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.008 * v), now + 0.32);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.32);
        } catch (_) {}
    }

    playMegaHit(outcome) {
        this.playBump();
        if (outcome === 'green') {
            this.playCoin(0);
            this.playCoin(2);
        } else if (outcome === 'red') {
            this.playRedNova();
        } else {
            this.playSkip();
        }
    }

    playCongratulations() {
        const ctx = this.getCtx();
        if (!ctx) return;
        const v = this.vol();
        if (v <= 0) return;
        try {
            const now = ctx.currentTime;
            // Classic NES Stage Clear / Congratulations fanfare cadence
            const melody = [
                { f: 392.00, t: 0.00, d: 0.09 }, // G4
                { f: 523.25, t: 0.09, d: 0.09 }, // C5
                { f: 659.25, t: 0.18, d: 0.09 }, // E5
                { f: 783.99, t: 0.27, d: 0.18 }, // G5
                { f: 659.25, t: 0.46, d: 0.11 }, // E5
                { f: 1046.50, t: 0.58, d: 0.48 } // C6
            ];
            for (const n of melody) {
                const osc = ctx.createOscillator();
                const sub = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'square';
                sub.type = 'triangle';
                const start = now + n.t;
                osc.frequency.setValueAtTime(n.f, start);
                sub.frequency.setValueAtTime(n.f * 0.5, start);
                gain.gain.setValueAtTime(0.078 * v, start);
                gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.006 * v), start + n.d);
                osc.connect(gain);
                sub.connect(gain);
                gain.connect(ctx.destination);
                osc.start(start);
                sub.start(start);
                osc.stop(start + n.d + 0.01);
                sub.stop(start + n.d + 0.01);
            }
        } catch (_) {}
    }

    playSomberEnd(isNegative = true) {
        const ctx = this.getCtx();
        if (!ctx) return;
        const v = this.vol();
        if (v <= 0) return;
        try {
            const now = ctx.currentTime;
            const notes = isNegative
                ? [
                    { f: 329.63, t: 0.00, d: 0.13 }, // E4
                    { f: 311.13, t: 0.14, d: 0.13 }, // Eb4
                    { f: 293.66, t: 0.28, d: 0.13 }, // D4
                    { f: 261.63, t: 0.42, d: 0.30 }  // C4
                ]
                : [
                    { f: 329.63, t: 0.00, d: 0.12 },
                    { f: 392.00, t: 0.13, d: 0.22 }
                ];
            for (const n of notes) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                const start = now + n.t;
                osc.frequency.setValueAtTime(n.f, start);
                gain.gain.setValueAtTime(0.08 * v, start);
                gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.006 * v), start + n.d);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(start);
                osc.stop(start + n.d + 0.01);
            }
        } catch (_) {}
    }
}

class MarioRecapScene {
    constructor(items, resolve, options = {}) {
        this.items = items;
        this.resolve = resolve;
        this.parchment = options.tone === 'parchment';
        this.summary = summarizeItems(items);
        this.verdict = resolveSessionVerdict(this.summary);
        this.destroyed = false;
        this.overlay = null;
        this.canvas = null;
        this.ctx = null;
        this.width = 1;
        this.height = 1;
        this.dpr = 1;
        this.pixel = 3;
        this.floorY = 0;
        this.raf = 0;
        this.finishTimer = 0;
        this.pillWidthTimer = 0;
        this.autoFadeTimer = 0;
        this.autoFadeStartedAt = 0;
        this.autoFadeRemaining = 0;
        this.lastTime = 0;
        this.createdThrough = -1;
        this.reducedMotion = false;
        this.sfx = new RetroSoundEngine();

        const lastBlockX = Math.max(0, items.length - 1) * BLOCK_SPACING;
        const megaX = lastBlockX + 46;
        const castleX = megaX + 68;

        this.run = {
            speed: clamp(items.length / 8, 1, 3),
            globalTick: 0,
            cameraX: 0,
            hitStopFrames: 0,
            shakeX: 0,
            shakeY: 0,
            shakeIntensity: 0,
            counts: { total: 0, green: 0, purple: 0, red: 0, skipped: 0 },
            finished: false,
            summaryShown: false
        };

        this.mario = {
            x: 0,
            y: 0,
            vx: 1.48,
            vy: 0,
            facing: 1,
            state: 'RUNNING',
            animTimer: 0,
            animFrame: 0,
            targetBlockIndex: 0,
            hasHitCurrentBlock: false,
            scaleX: 1,
            scaleY: 1,
            trailTimer: 0
        };

        this.finale = {
            phase: 'NONE', // 'NONE' | 'MERGE' | 'MEGA_RUN' | 'MEGA_JUMP' | 'CASTLE_APPROACH' | 'CASTLE_MEET' | 'DONE'
            timer: 0,
            mergeDuration: 24,
            mergeFragments: [],
            marioMeetX: castleX - 13
        };

        this.megaBlock = {
            x: megaX,
            baseY: -JUMP_HEIGHT_GAP - MEGA_BLOCK_SIZE,
            size: MEGA_BLOCK_SIZE,
            bumpOffset: 0,
            bumpVelocity: 0,
            scaleX: 1,
            scaleY: 1,
            status: this.verdict.megaOutcome,
            hit: false,
            visible: false,
            glowIntensity: 0.45
        };

        this.castle = {
            x: castleX,
            width: 44,
            height: 44,
            doorGlow: 0,
            flagRaise: 0
        };

        this.princess = {
            x: castleX + 14,
            targetX: castleX + 2,
            y: 0,
            vy: 0,
            visible: false,
            alpha: 0,
            animTimer: 0,
            scaleX: 1,
            scaleY: 1
        };

        this.blocks = [];
        this.coins = [];
        this.mushrooms = [];
        this.particles = [];
        this.hearts = [];
        this.floatingTexts = [];
        this.eloPops = [];
        this.popHistory = [];
        this.shockwaves = [];
        this.impactFlashes = [];
        this.marioTrails = [];

        this.onFrame = this.onFrame.bind(this);
        this.onClick = this.onClick.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onResize = this.onResize.bind(this);
        this.onVisibility = this.onVisibility.bind(this);
    }

    mount() {
        this.buildDom();
        if (this.parchment) this.overlay.classList.add('is-parchment');
        document.body.appendChild(this.overlay);
        this.resize();
        this.overlay.addEventListener('click', this.onClick);
        window.addEventListener('keydown', this.onKeyDown, true);
        window.addEventListener('resize', this.onResize);
        document.addEventListener('visibilitychange', this.onVisibility);

        this.reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        if (this.reducedMotion) {
            this.fillCountsAndBlocks();
            this.updateHud();
            this.drawStatic();
            this.showSummary();
            return;
        }

        this.ensureBlocksExist();
        const firstBlock = this.findBlock(0);
        this.mario.x = (firstBlock ? firstBlock.x : 0) - 26;
        this.mario.y = 0;
        this.run.cameraX = this.mario.x;
        this.render();
        this.lastTime = performance.now();
        this.raf = requestAnimationFrame(this.onFrame);
    }

    buildDom() {
        const el = document.createElement('div');
        el.id = 'mario-recap';
        el.innerHTML = `
            <canvas id="mario-recap-canvas" aria-hidden="true"></canvas>
            <div class="mr-pill" id="mario-recap-pill" role="status" aria-live="polite" aria-atomic="true">
                <span class="mr-pill-run" id="mario-recap-run">
                    <span class="mr-count is-green"><i></i><b id="mario-recap-count-green">0</b></span>
                    <span class="mr-count is-purple"><i></i><b id="mario-recap-count-purple">0</b></span>
                    <span class="mr-count is-red"><i></i><b id="mario-recap-count-red">0</b></span>
                    <span class="mr-count is-grey" id="mario-recap-wrap-grey" hidden><i></i><b id="mario-recap-count-grey">0</b></span>
                </span>
                <span class="mr-pill-summary" id="mario-recap-summary" hidden></span>
            </div>
        `;
        this.overlay = el;
        this.canvas = el.querySelector('#mario-recap-canvas');
        this.ctx = this.canvas.getContext('2d');
        if (!this.ctx) throw new Error('Canvas 2D is unavailable');
        this.pillEl = el.querySelector('#mario-recap-pill');
        this.runEl = el.querySelector('#mario-recap-run');
        this.summaryEl = el.querySelector('#mario-recap-summary');
        this.hudGreen = el.querySelector('#mario-recap-count-green');
        this.hudPurple = el.querySelector('#mario-recap-count-purple');
        this.hudRed = el.querySelector('#mario-recap-count-red');
        this.hudGreyWrap = el.querySelector('#mario-recap-wrap-grey');
        this.hudGrey = el.querySelector('#mario-recap-count-grey');
        if (this.hudGreyWrap) this.hudGreyWrap.hidden = !(this.summary.skipped > 0);
    }

    resize() {
        if (!this.ctx) return;
        this.width = Math.max(1, Math.floor(window.innerWidth));
        this.height = Math.max(1, Math.floor(window.innerHeight));
        this.dpr = clamp(window.devicePixelRatio || 1, 1, 2);
        this.canvas.width = Math.floor(this.width * this.dpr);
        this.canvas.height = Math.floor(this.height * this.dpr);
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.pixel = clamp(Math.round(Math.min(this.width, this.height) / 260), 2, 3);
        this.floorY = Math.floor(this.height * 0.68);
        this.overlay.style.setProperty('--mr-floor-y', this.floorY + 'px');
        if (this.reducedMotion) this.drawStatic();
    }

    onResize() {
        this.resize();
    }

    onVisibility() {
        this.lastTime = performance.now();
        if (!this.run.summaryShown || this.destroyed) return;
        if (document.hidden) {
            if (this.autoFadeTimer) {
                this.autoFadeRemaining = Math.max(0, this.autoFadeRemaining - (performance.now() - this.autoFadeStartedAt));
                clearTimeout(this.autoFadeTimer);
                this.autoFadeTimer = 0;
            }
        } else if (!this.autoFadeTimer && this.autoFadeRemaining > 0) {
            this.scheduleAutoFade(this.autoFadeRemaining);
        }
    }

    onClick() {
        if (this.destroyed) return;
        if (this.run.summaryShown) this.dismiss();
        else this.skipToSummary();
    }

    onFrame(now) {
        if (this.destroyed) return;
        this.raf = requestAnimationFrame(this.onFrame);
        const elapsed = Math.min(50, Math.max(0, now - this.lastTime));
        this.lastTime = now;
        if (document.hidden) return;
        const dt = (elapsed / 16.6667) * this.run.speed;
        this.update(dt);
        this.render();
    }

    ensureBlocksExist() {
        if (!this.items.length || this.finale.phase !== 'NONE') return;
        const needed = Math.min(
            this.items.length - 1,
            Math.max(this.mario.targetBlockIndex + 8, Math.floor((this.run.cameraX + 300) / BLOCK_SPACING))
        );
        for (let idx = this.createdThrough + 1; idx <= needed; idx++) {
            this.blocks.push({
                index: idx,
                x: idx * BLOCK_SPACING,
                baseY: -JUMP_HEIGHT_GAP - BLOCK_SIZE,
                bumpOffset: 0,
                bumpVelocity: 0,
                scaleX: 1,
                scaleY: 1,
                status: 'MYSTERY',
                glowIntensity: 0
            });
        }
        this.createdThrough = Math.max(this.createdThrough, needed);
        if (this.blocks.length > 48) {
            const cutoffX = this.run.cameraX - 240;
            this.blocks = this.blocks.filter(b => b.x > cutoffX || b.index >= this.mario.targetBlockIndex);
            this.mushrooms = this.mushrooms.filter(m => m.x > cutoffX);
        }
    }

    findBlock(index) {
        return this.blocks.find(b => b.index === index);
    }

    startFinale() {
        if (this.finale.phase !== 'NONE') return;
        this.finale.phase = 'MERGE';
        this.finale.timer = 0;
        const leftClamp = this.run.cameraX - 110;
        this.finale.mergeFragments = this.items.map((it, idx) => ({
            startX: Math.max(leftClamp + (idx % 4) * 8, idx * BLOCK_SPACING),
            startY: -JUMP_HEIGHT_GAP - BLOCK_SIZE,
            outcome: it.outcome || 'green'
        }));
        this.blocks = [];
        this.mushrooms = [];
        this.sfx.playMerge();
    }

    update(dt) {
        if (this.run.hitStopFrames > 0) {
            this.run.hitStopFrames -= dt;
            this.decayShake(dt);
            return;
        }

        this.decayShake(dt);
        this.run.globalTick += dt;
        this.ensureBlocksExist();

        this.mario.scaleX += (1 - this.mario.scaleX) * Math.min(1, 0.25 * dt);
        this.mario.scaleY += (1 - this.mario.scaleY) * Math.min(1, 0.25 * dt);

        this.mario.trailTimer += dt;
        if (!this.run.finished && (this.mario.state === 'JUMPING' || this.run.speed > 1.25) && this.mario.trailTimer >= 2.2) {
            this.mario.trailTimer = 0;
            this.marioTrails.push({
                x: this.mario.x,
                y: this.mario.y,
                facing: this.mario.facing,
                scaleX: this.mario.scaleX,
                scaleY: this.mario.scaleY,
                sprite: this.mario.state === 'JUMPING'
                    ? (this.mario.vy < 0 ? MARIO_SPRITES.jump : MARIO_SPRITES.fall)
                    : MARIO_SPRITES.run2,
                alpha: 0.34
            });
        }

        if (!this.run.finished && this.finale.phase === 'NONE') {
            if (this.mario.state === 'RUNNING') {
                this.mario.x += this.mario.vx * dt;
                this.mario.y = 0;
                this.mario.animTimer += dt * 0.25;
                this.mario.animFrame = Math.floor(this.mario.animTimer) % 3;

                const targetBlock = this.findBlock(this.mario.targetBlockIndex);
                if (targetBlock) {
                    if (this.mario.x >= targetBlock.x - JUMP_TRIGGER_GAP) {
                        this.mario.state = 'JUMPING';
                        this.mario.vy = -3.48;
                        this.mario.hasHitCurrentBlock = false;
                        this.mario.scaleX = 0.78;
                        this.mario.scaleY = 1.26;
                        this.spawnFootDust(this.mario.x, 0, 4);
                        this.sfx.playJump();
                    }
                } else if (this.mario.targetBlockIndex >= this.items.length) {
                    this.startFinale();
                }
            } else if (this.mario.state === 'JUMPING') {
                this.mario.x += (this.mario.vx * 0.58) * dt;
                this.mario.y += this.mario.vy * dt;
                this.mario.vy += 0.225 * dt;

                const targetBlock = this.findBlock(this.mario.targetBlockIndex);
                const headTopY = this.mario.y - 16;
                if (targetBlock && !this.mario.hasHitCurrentBlock) {
                    const blockBottomY = targetBlock.baseY + BLOCK_SIZE;
                    if (headTopY <= blockBottomY && this.mario.vy < 0) {
                        this.mario.y = blockBottomY + 16;
                        this.mario.vy = 0.68;
                        this.mario.hasHitCurrentBlock = true;
                        this.mario.scaleX = 1.24;
                        this.mario.scaleY = 0.78;
                        this.triggerBlockHit(targetBlock);
                    }
                }

                if (this.mario.y >= 0 && this.mario.vy > 0) {
                    this.mario.y = 0;
                    this.mario.vy = 0;
                    this.mario.state = 'RUNNING';
                    this.mario.targetBlockIndex++;
                    this.mario.scaleX = 1.26;
                    this.mario.scaleY = 0.75;
                    this.spawnFootDust(this.mario.x, 0, 4);
                    if (this.mario.targetBlockIndex >= this.items.length) this.startFinale();
                }
            }
        } else if (this.finale.phase !== 'NONE') {
            const fdt = clamp(dt / this.run.speed, 0.2, 2.5);
            this.updateFinale(fdt);
        }

        let desiredCamX = this.mario.x;
        if (this.finale.phase === 'MERGE' || this.finale.phase === 'MEGA_RUN' || this.finale.phase === 'MEGA_JUMP') {
            desiredCamX = Math.max(this.mario.x, this.megaBlock.x + 8);
        } else if (this.finale.phase === 'CASTLE_APPROACH' || this.finale.phase === 'CASTLE_MEET' || this.finale.phase === 'DONE') {
            desiredCamX = this.megaBlock.x + 48;
        }
        this.run.cameraX += (desiredCamX - this.run.cameraX) * Math.min(1, 0.14 * dt);

        this.updateEffects(dt);
    }

    updateFinale(fdt) {
        this.finale.timer += fdt;

        if (this.finale.phase === 'MERGE') {
            this.mario.x += 0.22 * fdt;
            this.mario.animTimer += fdt * 0.18;
            this.mario.animFrame = Math.floor(this.mario.animTimer) % 3;
            if (this.finale.timer >= this.finale.mergeDuration) {
                this.finale.phase = 'MEGA_RUN';
                this.finale.timer = 0;
                this.megaBlock.visible = true;
                this.megaBlock.scaleX = 1.18;
                this.megaBlock.scaleY = 0.84;
                this.megaBlock.glowIntensity = 0.95;
                const theme = BLOCK_THEMES[this.megaBlock.status] || BLOCK_THEMES.green;
                this.spawnPixelParticles(
                    this.megaBlock.x + MEGA_BLOCK_SIZE / 2,
                    this.megaBlock.baseY + MEGA_BLOCK_SIZE / 2,
                    [theme.base, theme.light, '#ffffff'],
                    14,
                    1.6,
                    false
                );
            }
            return;
        }

        if (this.finale.phase === 'MEGA_RUN') {
            this.mario.state = 'RUNNING';
            this.mario.x += 1.55 * fdt;
            this.mario.y = 0;
            this.mario.animTimer += fdt * 0.26;
            this.mario.animFrame = Math.floor(this.mario.animTimer) % 3;
            const megaJumpTriggerX = (this.megaBlock.x + 8) - JUMP_TRIGGER_GAP;
            if (this.mario.x >= megaJumpTriggerX) {
                this.finale.phase = 'MEGA_JUMP';
                this.finale.timer = 0;
                this.mario.state = 'JUMPING';
                this.mario.vy = -3.55;
                this.mario.hasHitCurrentBlock = false;
                this.mario.scaleX = 0.78;
                this.mario.scaleY = 1.26;
                this.spawnFootDust(this.mario.x, 0, 5);
                this.sfx.playJump();
            }
            return;
        }

        if (this.finale.phase === 'MEGA_JUMP') {
            this.mario.x += (1.48 * 0.58) * fdt;
            this.mario.y += this.mario.vy * fdt;
            this.mario.vy += 0.225 * fdt;

            const headTopY = this.mario.y - 16;
            const megaBottomY = this.megaBlock.baseY + MEGA_BLOCK_SIZE;
            if (!this.mario.hasHitCurrentBlock && headTopY <= megaBottomY && this.mario.vy < 0) {
                this.mario.y = megaBottomY + 16;
                this.mario.vy = 0.72;
                this.mario.hasHitCurrentBlock = true;
                this.mario.scaleX = 1.26;
                this.mario.scaleY = 0.76;
                this.triggerMegaBlockHit();
            }

            if (this.mario.y >= 0 && this.mario.vy > 0) {
                this.mario.y = 0;
                this.mario.vy = 0;
                this.mario.state = 'RUNNING';
                this.mario.scaleX = 1.24;
                this.mario.scaleY = 0.76;
                this.spawnFootDust(this.mario.x, 0, 4);
                this.finale.phase = 'CASTLE_APPROACH';
                this.finale.timer = 0;
            }
            return;
        }

        if (this.finale.phase === 'CASTLE_APPROACH') {
            this.mario.state = 'RUNNING';
            this.mario.x += 1.65 * fdt;
            this.mario.y = 0;
            this.mario.animTimer += fdt * 0.26;
            this.mario.animFrame = Math.floor(this.mario.animTimer) % 3;

            if (this.verdict.hasVictory) {
                this.princess.visible = true;
                this.princess.alpha = Math.min(1, this.princess.alpha + 0.065 * fdt);
                this.princess.x += (this.princess.targetX - this.princess.x) * Math.min(1, 0.14 * fdt);
                this.princess.animTimer += fdt * 0.22;
                this.castle.doorGlow = Math.min(1, this.castle.doorGlow + 0.06 * fdt);
            }

            if (this.mario.x >= this.finale.marioMeetX) {
                this.mario.x = this.finale.marioMeetX;
                this.finale.phase = 'CASTLE_MEET';
                this.finale.timer = 0;

                if (this.verdict.hasVictory) {
                    this.princess.visible = true;
                    this.princess.alpha = 1;
                    this.princess.x = this.princess.targetX;
                    this.mario.state = 'JUMPING';
                    this.mario.vy = -3.05;
                    this.mario.scaleX = 0.82;
                    this.mario.scaleY = 1.22;
                    this.princess.vy = -1.85;
                    this.princess.scaleX = 0.88;
                    this.princess.scaleY = 1.15;
                    this.spawnCelebrationHearts();
                    this.sfx.playCongratulations();
                } else {
                    this.mario.state = 'FINISHED';
                    this.mario.scaleX = 1.12;
                    this.mario.scaleY = 0.88;
                    this.sfx.playSomberEnd(this.verdict.megaOutcome === 'red');
                }
            }
            return;
        }

        if (this.finale.phase === 'CASTLE_MEET') {
            if (this.mario.y < 0 || this.mario.vy !== 0) {
                this.mario.y += this.mario.vy * fdt;
                this.mario.vy += 0.22 * fdt;
                if (this.mario.y >= 0) {
                    this.mario.y = 0;
                    this.mario.vy = 0;
                    this.mario.state = 'FINISHED';
                    this.mario.scaleX = 1.18;
                    this.mario.scaleY = 0.84;
                }
            }
            if (this.verdict.hasVictory) {
                this.castle.flagRaise = Math.min(1, this.castle.flagRaise + 0.055 * fdt);
                if (this.princess.y < 0 || this.princess.vy !== 0) {
                    this.princess.y += this.princess.vy * fdt;
                    this.princess.vy += 0.19 * fdt;
                    if (this.princess.y >= 0) {
                        this.princess.y = 0;
                        this.princess.vy = 0;
                        this.princess.scaleX = 1.14;
                        this.princess.scaleY = 0.88;
                    }
                }
            }
            if (this.finale.timer >= 20 && !this.run.finished) {
                this.finale.phase = 'DONE';
                this.finishRun();
            }
        }
    }

    updateEffects(dt) {
        for (const b of this.blocks) {
            if (b.bumpOffset !== 0 || b.bumpVelocity !== 0) {
                b.bumpOffset += b.bumpVelocity * dt;
                b.bumpVelocity += 0.38 * dt;
                if (b.bumpOffset >= 0) {
                    b.bumpOffset = 0;
                    b.bumpVelocity = 0;
                }
            }
            b.scaleX += (1 - b.scaleX) * Math.min(1, 0.25 * dt);
            b.scaleY += (1 - b.scaleY) * Math.min(1, 0.25 * dt);
            if (b.glowIntensity > 0) b.glowIntensity = Math.max(0, b.glowIntensity - 0.022 * dt);
        }

        if (this.megaBlock.visible) {
            const mb = this.megaBlock;
            if (mb.bumpOffset !== 0 || mb.bumpVelocity !== 0) {
                mb.bumpOffset += mb.bumpVelocity * dt;
                mb.bumpVelocity += 0.38 * dt;
                if (mb.bumpOffset >= 0) {
                    mb.bumpOffset = 0;
                    mb.bumpVelocity = 0;
                }
            }
            mb.scaleX += (1 - mb.scaleX) * Math.min(1, 0.22 * dt);
            mb.scaleY += (1 - mb.scaleY) * Math.min(1, 0.22 * dt);
            if (mb.glowIntensity > 0.35) mb.glowIntensity = Math.max(0.35, mb.glowIntensity - 0.018 * dt);
        }

        if (this.princess.visible) {
            this.princess.scaleX += (1 - this.princess.scaleX) * Math.min(1, 0.22 * dt);
            this.princess.scaleY += (1 - this.princess.scaleY) * Math.min(1, 0.22 * dt);
        }

        for (let i = this.coins.length - 1; i >= 0; i--) {
            const c = this.coins[i];
            c.x += c.vx * dt;
            c.y += c.vy * dt;
            c.vy += c.gravity * dt;
            c.frameTimer += dt * 0.48;
            c.frameIndex = Math.floor(c.frameTimer) % COIN_FRAMES.length;
            if (c.vy >= 0.45) {
                this.spawnPixelParticles(c.x + 5, c.y + 7, ['#fde047', '#facc15', '#ffffff', '#10b981'], 14, 1.5, false);
                this.coins.splice(i, 1);
            }
        }

        for (const m of this.mushrooms) {
            if (m.riseProgress < 1) {
                m.riseProgress = Math.min(1, m.riseProgress + 0.055 * dt);
                if (m.riseProgress >= 1 && !m.hasHopped) {
                    m.hasHopped = true;
                    m.hopVy = -1.65;
                    m.scaleX = 0.85;
                    m.scaleY = 1.18;
                }
            } else if (m.hopOffset < 0 || m.hopVy !== 0) {
                m.hopOffset += m.hopVy * dt;
                m.hopVy += 0.18 * dt;
                if (m.hopOffset >= 0) {
                    m.hopOffset = 0;
                    m.hopVy = 0;
                    m.scaleX = 1.22;
                    m.scaleY = 0.80;
                }
            } else {
                m.bobAngle += 0.09 * dt;
            }
            m.scaleX += (1 - m.scaleX) * Math.min(1, 0.22 * dt);
            m.scaleY += (1 - m.scaleY) * Math.min(1, 0.22 * dt);
            m.blinkTimer = (m.blinkTimer + dt) % 110;
            if (Math.random() < 0.09 * dt) {
                this.particles.push({
                    x: m.x + 3 + Math.random() * 10,
                    y: m.baseY + 8,
                    vx: (Math.random() - 0.5) * 0.35,
                    vy: -0.45 - Math.random() * 0.4,
                    gravity: 0,
                    bounces: false,
                    size: 1,
                    color: Math.random() > 0.5 ? '#e9d5ff' : '#fda4af',
                    life: 0.9,
                    decay: 0.028
                });
            }
        }

        for (let i = this.shockwaves.length - 1; i >= 0; i--) {
            const sw = this.shockwaves[i];
            sw.size += sw.speed * dt;
            sw.alpha -= 0.054 * dt;
            if (sw.alpha <= 0) this.shockwaves.splice(i, 1);
        }

        for (let i = this.impactFlashes.length - 1; i >= 0; i--) {
            const fl = this.impactFlashes[i];
            fl.life -= 0.14 * dt;
            if (fl.life <= 0) this.impactFlashes.splice(i, 1);
        }

        for (let i = this.marioTrails.length - 1; i >= 0; i--) {
            const tr = this.marioTrails[i];
            tr.alpha -= 0.045 * dt;
            if (tr.alpha <= 0) this.marioTrails.splice(i, 1);
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.gravity) p.vy += p.gravity * dt;
            if (p.bounces && p.y >= -1 && p.vy > 0) {
                p.y = -1;
                p.vy = -p.vy * 0.58;
                p.vx *= 0.85;
            }
            p.life -= p.decay * dt;
            if (p.life <= 0) this.particles.splice(i, 1);
        }

        for (let i = this.hearts.length - 1; i >= 0; i--) {
            const h = this.hearts[i];
            h.x += Math.sin(h.age * 0.14 + h.phase) * 0.16 * dt;
            h.y += h.vy * dt;
            h.age += dt;
            h.life -= 0.018 * dt;
            if (h.life <= 0) this.hearts.splice(i, 1);
        }

        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const ft = this.floatingTexts[i];
            ft.y -= 0.45 * dt;
            ft.life -= 0.02 * dt;
            if (ft.life <= 0) this.floatingTexts.splice(i, 1);
        }

        for (let i = this.eloPops.length - 1; i >= 0; i--) {
            const ep = this.eloPops[i];
            ep.age += dt;
            const p = clamp(ep.age / ep.duration, 0, 1);
            ep.y = ep.startY - ep.riseDistance * (1 - Math.pow(1 - p, 2.2));
            if (ep.age >= ep.duration) this.eloPops.splice(i, 1);
        }
    }

    decayShake(dt) {
        if (this.run.shakeIntensity > 0.05) {
            this.run.shakeX = (Math.random() - 0.5) * this.run.shakeIntensity * this.pixel * 0.45;
            this.run.shakeY = (Math.random() - 0.5) * this.run.shakeIntensity * this.pixel * 0.45;
            this.run.shakeIntensity *= Math.pow(0.72, dt);
        } else {
            this.run.shakeX = 0;
            this.run.shakeY = 0;
            this.run.shakeIntensity = 0;
        }
    }

    spawnEloPop(blockCenterX, blockTopY, delta, isFast) {
        const text = formatEloDelta(delta);
        const color = eloDeltaColor(delta);
        const startOffset = isFast ? 14 : 6;
        this.eloPops.push({
            x: blockCenterX,
            startY: blockTopY - startOffset,
            y: blockTopY - startOffset,
            riseDistance: isFast ? 30 : 26,
            age: 0,
            duration: 72,
            text,
            color,
            subLabel: isFast ? 'FAST' : null,
            isMega: false
        });
        this.popHistory.push(text);
        if (this.overlay) {
            this.overlay.dataset.lastPop = text;
            this.overlay.dataset.popHistory = JSON.stringify(this.popHistory);
        }
    }

    spawnMegaEloPop() {
        const mb = this.megaBlock;
        const centerX = mb.x + MEGA_BLOCK_SIZE / 2;
        const topY = mb.baseY;
        const text = this.verdict.popText;
        const color = this.verdict.popColor;
        this.eloPops.push({
            x: centerX,
            startY: topY - 8,
            y: topY - 8,
            riseDistance: 34,
            age: 0,
            duration: 96,
            text,
            color,
            subLabel: this.summary.hasElo ? 'NET ELO' : null,
            isMega: true
        });
        if (this.overlay) {
            this.overlay.dataset.megaPop = text;
            this.overlay.dataset.megaOutcome = this.verdict.megaOutcome;
            this.overlay.dataset.finaleBranch = this.verdict.hasVictory ? 'princess' : 'closed';
        }
    }

    triggerMegaBlockHit() {
        const mb = this.megaBlock;
        const outcome = this.verdict.megaOutcome;
        const centerX = mb.x + MEGA_BLOCK_SIZE / 2;
        const topY = mb.baseY;
        const bottomY = mb.baseY + MEGA_BLOCK_SIZE;

        mb.hit = true;
        mb.status = outcome;
        mb.bumpVelocity = -3.0;
        mb.scaleX = 1.24;
        mb.scaleY = 0.78;
        mb.glowIntensity = 1.65;

        this.run.hitStopFrames = 2;
        this.run.shakeIntensity = 2.8;
        this.sfx.playMegaHit(outcome);

        const theme = BLOCK_THEMES[outcome] || BLOCK_THEMES.green;
        this.impactFlashes.push({
            x: centerX,
            y: bottomY,
            width: MEGA_BLOCK_SIZE * 1.35,
            life: 1.0,
            color: theme.light
        });

        this.shockwaves.push({
            x: centerX,
            y: topY + MEGA_BLOCK_SIZE / 2,
            size: MEGA_BLOCK_SIZE * 0.75,
            speed: 1.7,
            alpha: 1.0,
            color: theme.lightHex
        });

        if (outcome === 'green') {
            this.launchSingleCoin(centerX - 8, topY);
            this.launchSingleCoin(centerX + 8, topY);
            this.spawnPixelParticles(centerX, topY + 6, ['#10b981', '#6ee7b7', '#fde047', '#ffffff'], 22, 2.0, false);
        } else if (outcome === 'red') {
            this.spawnPixelParticles(centerX, topY + 12, ['#f43f5e', '#fb7185', '#fb923c', '#fde047'], 26, 2.4, true);
        } else {
            this.spawnPixelParticles(centerX, topY + 12, ['#94a3b8', '#cbd5e1', '#64748b'], 12, 1.3, false);
        }

        this.spawnMegaEloPop();
    }

    spawnCelebrationHearts() {
        const midX = (this.mario.x + this.princess.targetX) * 0.5 + 4;
        for (let i = 0; i < 3; i++) {
            this.hearts.push({
                x: midX + (i - 1) * 9,
                y: -20 - i * 4,
                vy: -0.42 - i * 0.06,
                age: 0,
                phase: i * 1.4,
                life: 1.0
            });
        }
        this.spawnPixelParticles(midX + 4, -18, ['#fde047', '#f472b6', '#38bdf8', '#ffffff'], 18, 1.7, false);
    }

    triggerBlockHit(block) {
        const item = this.items[block.index];
        const outcome = item ? item.outcome : 'red';
        const blockCenterX = block.x + BLOCK_SIZE / 2;
        const blockTopY = block.baseY;
        const blockBottomY = block.baseY + BLOCK_SIZE;

        if (outcome === 'grey') {
            block.bumpVelocity = -1.6;
            block.scaleX = 1.10;
            block.scaleY = 0.90;
            block.glowIntensity = 0.65;
            block.status = 'grey';
            this.run.counts.skipped++;
            this.sfx.playSkip();
            this.impactFlashes.push({
                x: blockCenterX,
                y: blockBottomY,
                width: BLOCK_SIZE * 1.1,
                life: 0.7,
                color: BLOCK_THEMES.grey.light
            });
            this.spawnPixelParticles(blockCenterX, blockTopY + BLOCK_SIZE / 2, ['#94a3b8', '#cbd5e1', '#64748b'], 8, 1.1, false);
            this.floatingTexts.push({
                x: blockCenterX,
                y: blockTopY - 6,
                text: 'SKIP',
                color: '#94a3b8',
                life: 0.95
            });
            this.updateHud();
            return;
        }

        block.bumpVelocity = -2.5;
        block.scaleX = 1.22;
        block.scaleY = 0.80;
        block.glowIntensity = 1.3;
        block.status = outcome;

        this.run.hitStopFrames = 1;
        this.run.shakeIntensity = outcome === 'red' ? 2.6 : 1.8;
        this.run.counts.total++;
        this.run.counts[outcome]++;
        this.sfx.playBump();

        this.impactFlashes.push({
            x: blockCenterX,
            y: blockBottomY,
            width: BLOCK_SIZE * 1.4,
            life: 1.0,
            color: BLOCK_THEMES[outcome].light
        });

        this.mushrooms = this.mushrooms.filter(m => m.blockIndex !== block.index);

        if (outcome === 'green') {
            this.launchSingleCoin(blockCenterX, blockTopY);
        } else if (outcome === 'purple') {
            this.sfx.playMushroom();
            this.mushrooms.push({
                blockIndex: block.index,
                x: block.x,
                baseY: blockTopY - BLOCK_SIZE - 1,
                riseProgress: 0,
                hopOffset: 0,
                hopVy: 0,
                hasHopped: false,
                scaleX: 1,
                scaleY: 1,
                bobAngle: 0,
                blinkTimer: Math.random() * 60
            });
            this.spawnPixelParticles(blockCenterX, blockTopY + 2, ['#a855f7', '#e9d5ff', '#f43f5e', '#fde047'], 16, 1.8, false);
        } else {
            this.sfx.playRedNova();
            this.shockwaves.push({
                x: blockCenterX,
                y: block.baseY + BLOCK_SIZE / 2,
                size: BLOCK_SIZE * 0.7,
                speed: 1.45,
                alpha: 1.0,
                color: '#fb7185'
            });
            this.shockwaves.push({
                x: blockCenterX,
                y: block.baseY + BLOCK_SIZE / 2,
                size: BLOCK_SIZE * 0.35,
                speed: 0.95,
                alpha: 0.85,
                color: '#fde047'
            });
            this.spawnPixelParticles(
                blockCenterX,
                block.baseY + BLOCK_SIZE / 2,
                ['#f43f5e', '#fb7185', '#fb923c', '#fde047', '#ffffff'],
                28,
                2.6,
                true
            );
        }

        if (item && typeof item.eloDelta === 'number' && Number.isFinite(item.eloDelta)) {
            this.spawnEloPop(blockCenterX, blockTopY, item.eloDelta, outcome === 'purple');
        } else if (outcome === 'purple') {
            this.floatingTexts.push({
                x: blockCenterX,
                y: blockTopY - 14,
                text: 'FAST!',
                color: '#e9d5ff',
                life: 1.15
            });
        }

        this.updateHud();
    }

    launchSingleCoin(blockCenterX, blockTopY) {
        this.sfx.playCoin(0);
        this.coins.push({
            x: blockCenterX - 5,
            y: blockTopY - 6,
            vx: (Math.random() - 0.5) * 0.2,
            vy: -2.85,
            gravity: 0.13,
            frameTimer: 0,
            frameIndex: 0
        });
        this.spawnPixelParticles(blockCenterX, blockTopY + 2, ['#10b981', '#6ee7b7', '#fde047', '#ffffff'], 10, 1.6, false);
    }

    spawnPixelParticles(vx, vy, colors, count, speedScale = 1.5, bouncesOnFloor = false) {
        count = Math.max(1, Math.round(count * 0.6));
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.45;
            const spd = (0.55 + Math.random() * 1.45) * speedScale;
            this.particles.push({
                x: vx + (Math.random() - 0.5) * 6,
                y: vy + (Math.random() - 0.5) * 6,
                vx: Math.cos(angle) * spd,
                vy: Math.sin(angle) * spd - (bouncesOnFloor ? 0.8 : 0.35),
                gravity: bouncesOnFloor ? 0.14 : 0.02,
                bounces: bouncesOnFloor,
                size: Math.random() > 0.35 ? 2 : 1,
                color: colors[Math.floor(Math.random() * colors.length)],
                life: 1.0,
                decay: bouncesOnFloor ? (0.012 + Math.random() * 0.012) : (0.022 + Math.random() * 0.02)
            });
        }
    }

    spawnFootDust(vx, vy, count = 6) {
        count = Math.max(2, Math.round(count * 0.6));
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: vx + 7 + (Math.random() - 0.5) * 6,
                y: vy - 1,
                vx: (Math.random() - 0.5) * 1.4,
                vy: -Math.random() * 0.9 - 0.2,
                gravity: 0.03,
                bounces: false,
                size: Math.random() > 0.5 ? 2 : 1,
                color: '#94a3b8',
                life: 0.85,
                decay: 0.04
            });
        }
    }

    worldToScreenX(vx) {
        return Math.floor((vx - this.run.cameraX) * this.pixel + this.width * 0.38 + this.run.shakeX);
    }

    worldToScreenY(vy) {
        return Math.floor(this.floorY + vy * this.pixel + this.run.shakeY);
    }

    isVisibleX(vx, paddingWorld = 32) {
        const sx = this.worldToScreenX(vx);
        const pad = paddingWorld * this.pixel;
        return sx >= -pad && sx <= this.width + pad;
    }

    drawSpriteMatrix(matrix, palette, vx, vy, scale = this.pixel, options = {}) {
        const flipX = !!options.flipX;
        const scaleX = options.scaleX == null ? 1 : options.scaleX;
        const scaleY = options.scaleY == null ? 1 : options.scaleY;
        const alpha = options.alpha == null ? 1 : options.alpha;
        const tintColor = options.tintColor || null;

        const rows = matrix.length;
        const cols = matrix[0].length;
        const spriteWidthPx = cols * scale;
        const spriteHeightPx = rows * scale;
        const baseScreenX = this.worldToScreenX(vx) + spriteWidthPx * 0.5;
        const baseScreenY = this.worldToScreenY(vy);

        const ctx = this.ctx;
        ctx.save();
        if (alpha < 1) ctx.globalAlpha = alpha;
        ctx.translate(baseScreenX, baseScreenY);
        ctx.scale((flipX ? -1 : 1) * scaleX, scaleY);
        ctx.translate(-spriteWidthPx * 0.5, -spriteHeightPx);

        for (let r = 0; r < rows; r++) {
            const row = matrix[r];
            for (let c = 0; c < cols; c++) {
                const ch = row[c];
                if (ch !== '.' && palette[ch]) {
                    ctx.fillStyle = tintColor || palette[ch];
                    ctx.fillRect(c * scale, r * scale, scale, scale);
                }
            }
        }
        ctx.restore();
    }

    drawDynamicBlockLight(block, sizeWorld = BLOCK_SIZE) {
        const theme = BLOCK_THEMES[block.status] || BLOCK_THEMES.MYSTERY;
        const ctx = this.ctx;
        const centerX = this.worldToScreenX(block.x + sizeWorld / 2);
        const centerY = this.worldToScreenY(block.baseY + (block.bumpOffset || 0) + sizeWorld / 2);
        const isHit = block.status !== 'MYSTERY';
        const baseRadius = (isHit ? 48 : 30) * (sizeWorld / BLOCK_SIZE) * this.pixel;
        const [r, g, b] = theme.rgb;
        const alphaBoost = isHit ? 0.11 + (block.glowIntensity || 0) * 0.075 : 0.05;

        const grad = ctx.createRadialGradient(centerX, centerY, this.pixel * 2, centerX, centerY, baseRadius);
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${Math.min(0.32, alphaBoost)})`);
        grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${Math.min(0.14, alphaBoost * 0.45)})`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

        ctx.save();
        ctx.fillStyle = grad;
        ctx.fillRect(centerX - baseRadius, centerY - baseRadius, baseRadius * 2, baseRadius * 2);
        ctx.restore();
    }

    drawBlock(block, unitScale = 1, alpha = 1) {
        const theme = BLOCK_THEMES[block.status] || BLOCK_THEMES.MYSTERY;
        const ctx = this.ctx;
        const P = this.pixel * unitScale;
        const blockPx = BLOCK_SIZE * P;
        const centerX = this.worldToScreenX(block.x) + blockPx * 0.5;
        const centerY = this.worldToScreenY(block.baseY + (block.bumpOffset || 0)) + blockPx * 0.5;

        ctx.save();
        if (alpha < 1) ctx.globalAlpha = alpha;
        ctx.translate(centerX, centerY);
        ctx.scale(block.scaleX || 1, block.scaleY || 1);
        ctx.translate(-blockPx * 0.5, -blockPx * 0.5);

        let mainFill = theme.base;
        if (block.status === 'MYSTERY') {
            const pulseIdx = Math.floor(this.run.globalTick / 12) % theme.pulseBase.length;
            mainFill = theme.pulseBase[pulseIdx];
        }

        ctx.fillStyle = theme.border;
        ctx.fillRect(P, 0, 14 * P, 16 * P);
        ctx.fillRect(0, P, 16 * P, 14 * P);

        ctx.fillStyle = mainFill;
        ctx.fillRect(P, P, 14 * P, 14 * P);

        if (block.status === 'MYSTERY' || block.isMegaPreHit) {
            const shimmerPhase = Math.floor(this.run.globalTick * 0.35 + (block.index || 0) * 5) % 40;
            if (shimmerPhase < 16) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
                for (let r = 2; r < 14; r++) {
                    for (let c = 2; c < 14; c++) {
                        if (r + c === shimmerPhase + 4 || r + c === shimmerPhase + 5) {
                            ctx.fillRect(c * P, r * P, P, P);
                        }
                    }
                }
            }
        }

        ctx.fillStyle = theme.light;
        ctx.fillRect(P, P, 13 * P, P);
        ctx.fillRect(P, 2 * P, P, 12 * P);

        ctx.fillStyle = theme.dark;
        ctx.fillRect(2 * P, 14 * P, 13 * P, P);
        ctx.fillRect(14 * P, 2 * P, P, 13 * P);

        ctx.fillStyle = theme.rivet;
        ctx.fillRect(2 * P, 2 * P, P, P);
        ctx.fillRect(13 * P, 2 * P, P, P);
        ctx.fillRect(2 * P, 13 * P, P, P);
        ctx.fillRect(13 * P, 13 * P, P, P);

        if (block.status === 'MYSTERY' || block.isMegaPreHit) {
            for (let r = 0; r < 16; r++) {
                const row = QUESTION_MARK_PIXELS[r];
                for (let c = 0; c < 16; c++) {
                    const ch = row[c];
                    if (ch === 'W') {
                        ctx.fillStyle = '#fffbeb';
                        ctx.fillRect(c * P, r * P, P, P);
                    } else if (ch === 'd') {
                        ctx.fillStyle = theme.dark;
                        ctx.fillRect(c * P, r * P, P, P);
                    }
                }
            }
        } else {
            ctx.fillStyle = theme.dark;
            ctx.fillRect(4 * P, 4 * P, 8 * P, 8 * P);
            ctx.fillStyle = theme.light;
            ctx.fillRect(5 * P, 5 * P, 6 * P, 6 * P);
            ctx.fillStyle = theme.innerSymbol;
            ctx.fillRect(6 * P, 6 * P, 4 * P, 4 * P);
        }

        ctx.restore();
    }

    drawMergingBlocks() {
        const p = clamp(this.finale.timer / this.finale.mergeDuration, 0, 1);
        const ease = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        const targetX = this.megaBlock.x;
        const targetY = this.megaBlock.baseY;

        for (let i = 0; i < this.finale.mergeFragments.length; i++) {
            const frag = this.finale.mergeFragments[i];
            const arc = -Math.sin(p * Math.PI) * (10 + (i % 3) * 4);
            const curX = frag.startX + (targetX - frag.startX) * ease;
            const curY = frag.startY + (targetY - frag.startY) * ease + arc;
            const unitScale = 1 + ease * 1.0;
            const status = p > 0.72 ? this.megaBlock.status : frag.outcome;
            const alpha = p > 0.75 ? clamp(1 - (p - 0.75) / 0.25, 0.2, 1) : 0.92;
            this.drawBlock(
                {
                    x: curX,
                    baseY: curY,
                    bumpOffset: 0,
                    scaleX: 1,
                    scaleY: 1,
                    status,
                    isMegaPreHit: p > 0.65
                },
                unitScale,
                alpha
            );
        }

        if (p > 0.55) {
            const revealAlpha = clamp((p - 0.55) / 0.45, 0, 1);
            this.drawBlock(
                {
                    x: targetX,
                    baseY: targetY,
                    bumpOffset: 0,
                    scaleX: 0.85 + 0.15 * revealAlpha,
                    scaleY: 0.85 + 0.15 * revealAlpha,
                    status: this.megaBlock.status,
                    isMegaPreHit: true
                },
                2,
                revealAlpha
            );
        }
    }

    drawCastle() {
        const c = this.castle;
        if (!this.isVisibleX(c.x + c.width / 2, 60)) return;
        const ctx = this.ctx;
        const P = this.pixel;
        const sx = this.worldToScreenX(c.x);
        const sy = this.worldToScreenY(0);

        const brickBase = '#c2593f';
        const brickLight = '#e07a5f';
        const brickDark = '#7c2d12';
        const border = '#1e1b4b';
        const archDark = '#090d16';

        ctx.save();

        // Flagpole & victory pennant on top of upper tower
        const poleX = sx + 22 * P;
        const poleTopY = sy - 54 * P;
        const poleBottomY = sy - 38 * P;
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(poleX, poleTopY, P, poleBottomY - poleTopY);
        ctx.fillStyle = '#facc15';
        ctx.fillRect(poleX - P, poleTopY - P, 3 * P, 2 * P);

        if (c.flagRaise > 0.02) {
            const flagY = poleBottomY - Math.round(c.flagRaise * 11 * P) - 5 * P;
            ctx.fillStyle = '#34d399';
            ctx.fillRect(poleX + P, flagY, 8 * P, 5 * P);
            ctx.fillStyle = '#a7f3d0';
            ctx.fillRect(poleX + 2 * P, flagY + P, 4 * P, 2 * P);
        }

        // Upper tower (26w x 16h, from x+9 to x+35, y-38 to y-22)
        const upX = sx + 9 * P;
        const upY = sy - 38 * P;
        const upW = 26 * P;
        const upH = 16 * P;
        ctx.fillStyle = border;
        ctx.fillRect(upX - P, upY - P, upW + 2 * P, upH + 2 * P);
        ctx.fillStyle = brickBase;
        ctx.fillRect(upX, upY, upW, upH);

        // Upper crenellations (4 battlements)
        for (let i = 0; i < 4; i++) {
            const bx = upX + i * 7 * P;
            ctx.fillStyle = border;
            ctx.fillRect(bx - P, upY - 4 * P, 5 * P + 2 * P, 4 * P);
            ctx.fillStyle = brickLight;
            ctx.fillRect(bx, upY - 3 * P, 5 * P, 3 * P);
        }

        // Upper windows
        ctx.fillStyle = archDark;
        ctx.fillRect(upX + 5 * P, upY + 4 * P, 4 * P, 7 * P);
        ctx.fillRect(upX + 17 * P, upY + 4 * P, 4 * P, 7 * P);

        // Lower body (44w x 22h, from x to x+44, y-22 to y)
        const loX = sx;
        const loY = sy - 22 * P;
        const loW = 44 * P;
        const loH = 22 * P;
        ctx.fillStyle = border;
        ctx.fillRect(loX - P, loY - P, loW + 2 * P, loH + 2 * P);
        ctx.fillStyle = brickBase;
        ctx.fillRect(loX, loY, loW, loH);

        // Lower crenellations (5 battlements)
        for (let i = 0; i < 5; i++) {
            const bx = loX + i * 9 * P;
            ctx.fillStyle = border;
            ctx.fillRect(bx - P, loY - 4 * P, 6 * P + 2 * P, 4 * P);
            ctx.fillStyle = brickLight;
            ctx.fillRect(bx, loY - 3 * P, 6 * P, 3 * P);
        }

        // Brick mortar lines
        ctx.fillStyle = brickDark;
        for (let row = 1; row <= 4; row++) {
            const ry = loY + row * 4 * P;
            ctx.fillRect(loX + P, ry, loW - 2 * P, P);
        }
        ctx.fillStyle = brickLight;
        ctx.fillRect(loX + P, loY + P, loW - 2 * P, P);

        // Arched doorway (12w x 15h centered at x+16..x+28)
        const doorX = sx + 16 * P;
        const doorY = sy - 15 * P;
        const doorW = 12 * P;
        const doorH = 15 * P;
        ctx.fillStyle = border;
        ctx.fillRect(doorX - P, doorY - P, doorW + 2 * P, doorH + P);
        ctx.fillStyle = archDark;
        ctx.fillRect(doorX + P, doorY, doorW - 2 * P, 2 * P);
        ctx.fillRect(doorX, doorY + 2 * P, doorW, doorH - 2 * P);

        if (c.doorGlow > 0.02) {
            ctx.save();
            ctx.globalAlpha = c.doorGlow * 0.55;
            ctx.fillStyle = '#fef08a';
            ctx.fillRect(doorX + P, doorY + 2 * P, doorW - 2 * P, doorH - 2 * P);
            ctx.restore();
        } else if (!this.verdict.hasVictory) {
            // Closed portcullis grate bars when net Elo <= 0
            ctx.fillStyle = '#475569';
            for (let bar = 2; bar <= 9; bar += 3) {
                ctx.fillRect(doorX + bar * P, doorY + 2 * P, P, doorH - 2 * P);
            }
            ctx.fillRect(doorX, doorY + 6 * P, doorW, P);
            ctx.fillRect(doorX, doorY + 11 * P, doorW, P);
        }

        ctx.restore();
    }

    render() {
        const ctx = this.ctx;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);

        const floorScreenY = this.worldToScreenY(0);
        const floorGrad = ctx.createLinearGradient(0, 0, this.width, 0);
        floorGrad.addColorStop(0, 'rgba(148, 163, 184, 0)');
        floorGrad.addColorStop(0.18, 'rgba(148, 163, 184, 0.22)');
        floorGrad.addColorStop(0.82, 'rgba(148, 163, 184, 0.22)');
        floorGrad.addColorStop(1, 'rgba(148, 163, 184, 0)');
        ctx.fillStyle = floorGrad;
        ctx.fillRect(0, floorScreenY, this.width, 1);

        for (const b of this.blocks) {
            if (this.isVisibleX(b.x, 68)) this.drawDynamicBlockLight(b);
        }
        if (this.megaBlock.visible && this.isVisibleX(this.megaBlock.x, 96)) {
            this.drawDynamicBlockLight(this.megaBlock, MEGA_BLOCK_SIZE);
        }

        this.drawCastle();

        for (const m of this.mushrooms) {
            if (!this.isVisibleX(m.x, 24)) continue;
            const parentBlock = this.findBlock(m.blockIndex);
            const blockBump = parentBlock ? parentBlock.bumpOffset : 0;
            const emergeOffset = (1 - m.riseProgress) * (BLOCK_SIZE - 2);
            const bobOffset = (m.riseProgress >= 1 && m.hopOffset === 0) ? Math.sin(m.bobAngle) * 1.6 : 0;
            const drawY = m.baseY + emergeOffset + m.hopOffset + bobOffset + blockBump;
            const isBlinking = m.blinkTimer > 98;
            const shroomMatrix = isBlinking ? MUSHROOM_MATRIX_BLINK : MUSHROOM_MATRIX_OPEN;

            ctx.save();
            if (m.riseProgress < 1 && parentBlock) {
                const clipBottomY = this.worldToScreenY(parentBlock.baseY + blockBump);
                ctx.beginPath();
                ctx.rect(0, 0, this.width, clipBottomY);
                ctx.clip();
            }
            this.drawSpriteMatrix(shroomMatrix, MUSHROOM_PALETTE, m.x, drawY, this.pixel, {
                scaleX: m.scaleX,
                scaleY: m.scaleY
            });
            ctx.restore();
        }

        for (const c of this.coins) {
            if (this.isVisibleX(c.x, 14)) {
                this.drawSpriteMatrix(COIN_FRAMES[c.frameIndex], COIN_PALETTE, c.x, c.y, this.pixel);
            }
        }

        for (const sw of this.shockwaves) {
            if (!this.isVisibleX(sw.x, sw.size + 12)) continue;
            const sx = this.worldToScreenX(sw.x - sw.size / 2);
            const sy = this.worldToScreenY(sw.y - sw.size / 2);
            const pxSize = Math.floor(sw.size * this.pixel);
            ctx.save();
            ctx.globalAlpha = Math.max(0, sw.alpha);
            ctx.strokeStyle = sw.color;
            ctx.lineWidth = this.pixel * 1.5;
            ctx.strokeRect(sx, sy, pxSize, pxSize);
            ctx.restore();
        }

        for (const b of this.blocks) {
            if (this.isVisibleX(b.x, 20)) this.drawBlock(b);
        }

        if (this.finale.phase === 'MERGE') {
            this.drawMergingBlocks();
        } else if (this.megaBlock.visible && this.isVisibleX(this.megaBlock.x, 40)) {
            this.drawBlock(
                {
                    x: this.megaBlock.x,
                    baseY: this.megaBlock.baseY,
                    bumpOffset: this.megaBlock.bumpOffset,
                    scaleX: this.megaBlock.scaleX,
                    scaleY: this.megaBlock.scaleY,
                    status: this.megaBlock.status,
                    isMegaPreHit: !this.megaBlock.hit
                },
                2,
                1
            );
        }

        for (const fl of this.impactFlashes) {
            if (!this.isVisibleX(fl.x, fl.width + 8)) continue;
            const sx = this.worldToScreenX(fl.x - (fl.width * fl.life) / 2);
            const sy = this.worldToScreenY(fl.y);
            const wPx = Math.floor(fl.width * fl.life * this.pixel);
            ctx.save();
            ctx.globalAlpha = Math.max(0, fl.life);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(sx, sy - this.pixel, wPx, this.pixel * 2);
            ctx.fillStyle = fl.color;
            ctx.fillRect(sx - this.pixel * 2, sy, wPx + this.pixel * 4, this.pixel);
            ctx.restore();
        }

        for (const tr of this.marioTrails) {
            if (!this.isVisibleX(tr.x, 18)) continue;
            this.drawSpriteMatrix(tr.sprite, PALETTE, tr.x, tr.y, this.pixel, {
                flipX: tr.facing === -1,
                scaleX: tr.scaleX,
                scaleY: tr.scaleY,
                alpha: tr.alpha * 0.55,
                tintColor: '#38bdf8'
            });
        }

        if (this.princess.visible) {
            const pSprite = this.princess.y < -1
                ? PRINCESS_SPRITES.hop
                : (Math.floor(this.princess.animTimer) % 2 === 0 ? PRINCESS_SPRITES.walk1 : PRINCESS_SPRITES.walk2);
            this.drawSpriteMatrix(pSprite, PRINCESS_PALETTE, this.princess.x, this.princess.y, this.pixel, {
                flipX: true,
                scaleX: this.princess.scaleX,
                scaleY: this.princess.scaleY,
                alpha: this.princess.alpha
            });
        }

        let marioMatrix = MARIO_SPRITES.run1;
        if (this.mario.state === 'JUMPING') {
            marioMatrix = this.mario.vy < 0.25 ? MARIO_SPRITES.jump : MARIO_SPRITES.fall;
        } else if (this.mario.state !== 'FINISHED') {
            if (this.mario.animFrame === 0) marioMatrix = MARIO_SPRITES.run1;
            else if (this.mario.animFrame === 1) marioMatrix = MARIO_SPRITES.run2;
            else marioMatrix = MARIO_SPRITES.run3;
        }

        this.drawSpriteMatrix(marioMatrix, PALETTE, this.mario.x, this.mario.y, this.pixel, {
            flipX: this.mario.facing === -1,
            scaleX: this.mario.scaleX,
            scaleY: this.mario.scaleY
        });

        for (const h of this.hearts) {
            if (!this.isVisibleX(h.x, 12)) continue;
            this.drawSpriteMatrix(HEART_MATRIX, HEART_PALETTE, h.x, h.y, this.pixel, {
                alpha: clamp(h.life, 0, 1)
            });
        }

        for (const p of this.particles) {
            const sx = this.worldToScreenX(p.x);
            if (sx < -this.pixel * 4 || sx > this.width + this.pixel * 4) continue;
            const sy = this.worldToScreenY(p.y);
            ctx.save();
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.fillStyle = p.color;
            ctx.fillRect(sx, sy, p.size * this.pixel, p.size * this.pixel);
            ctx.restore();
        }

        for (const ft of this.floatingTexts) {
            const sx = this.worldToScreenX(ft.x);
            if (sx < -this.pixel * 40 || sx > this.width + this.pixel * 40) continue;
            const sy = this.worldToScreenY(ft.y);
            ctx.save();
            ctx.globalAlpha = Math.max(0, Math.min(1, ft.life));
            ctx.font = `${Math.max(9, this.pixel * 3.2)}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillStyle = '#000000';
            ctx.fillText(ft.text, sx + this.pixel, sy + this.pixel);
            ctx.fillStyle = ft.color;
            ctx.fillText(ft.text, sx, sy);
            ctx.restore();
        }

        for (const ep of this.eloPops) {
            const sx = this.worldToScreenX(ep.x);
            if (sx < -this.pixel * 64 || sx > this.width + this.pixel * 64) continue;
            const sy = this.worldToScreenY(ep.y);
            const p = clamp(ep.age / ep.duration, 0, 1);
            let scale = 1;
            if (ep.age < 4.2) {
                scale = 0.35 + (ep.age / 4.2) * 0.87;
            } else if (ep.age < 9.0) {
                scale = 1.22 - ((ep.age - 4.2) / 4.8) * 0.22;
            }
            const alpha = p > 0.68 ? clamp(1 - (p - 0.68) / 0.32, 0, 1) : 1;
            const baseMult = ep.isMega ? 16.5 : 13.5;
            const fontSize = Math.max(ep.isMega ? 28 : 24, Math.round(this.pixel * baseMult));
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(sx, sy);
            ctx.scale(scale, scale);
            ctx.font = `900 ${fontSize}px 'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineJoin = 'round';
            ctx.miterLimit = 2;
            ctx.lineWidth = Math.max(4, Math.round(this.pixel * 2.2));
            ctx.strokeStyle = 'rgba(6, 8, 14, 0.92)';
            ctx.strokeText(ep.text, 0, 0);
            ctx.fillStyle = ep.color;
            ctx.fillText(ep.text, 0, 0);
            if (ep.subLabel) {
                const subFont = Math.max(10, Math.round(this.pixel * 5.2));
                const subY = Math.round(fontSize * 0.66);
                ctx.font = `800 ${subFont}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
                ctx.lineWidth = Math.max(2.5, Math.round(this.pixel * 1.4));
                ctx.strokeText(ep.subLabel, 0, subY);
                ctx.fillStyle = ep.isMega ? ep.color : '#e9d5ff';
                ctx.fillText(ep.subLabel, 0, subY);
            }
            ctx.restore();
        }
    }

    drawStatic() {
        const ctx = this.ctx;
        if (!ctx) return;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);

        const count = this.items.length;
        const available = Math.max(120, this.width - 64);
        const maxCols = Math.min(count, 24);
        let P = Math.floor((available / Math.max(1, maxCols)) / 20);
        P = clamp(P, 1, 2);
        const blockPx = P * 16;
        const gap = Math.max(4, P * 2);
        const cols = Math.max(1, Math.min(count, Math.floor((available + gap) / (blockPx + gap))));
        const rows = Math.ceil(count / cols);
        const totalW = cols * blockPx + (cols - 1) * gap;
        const startX = Math.floor((this.width - totalW) / 2);
        const startY = Math.max(
            72,
            Math.min(this.floorY - 96, this.height - 110 - rows * (blockPx + gap))
        );

        for (let i = 0; i < count; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = startX + col * (blockPx + gap);
            const y = startY + row * (blockPx + gap);
            const item = this.items[i];
            const outcome = item.outcome;
            this.drawStaticBlock(x, y, blockPx, outcome);
            if (outcome !== 'grey' && typeof item.eloDelta === 'number' && Number.isFinite(item.eloDelta)) {
                const label = formatEloDelta(item.eloDelta);
                ctx.save();
                ctx.font = `800 ${Math.max(13, Math.round(P * 11))}px 'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif`;
                ctx.textAlign = 'center';
                ctx.lineJoin = 'round';
                ctx.lineWidth = Math.max(3, P * 1.8);
                ctx.strokeStyle = 'rgba(6, 8, 14, 0.9)';
                ctx.strokeText(label, x + blockPx / 2, y - 5);
                ctx.fillStyle = eloDeltaColor(item.eloDelta);
                ctx.fillText(label, x + blockPx / 2, y - 5);
                ctx.restore();
            }
        }

        // Static merged Big Block + Net Elo badge centered below the mini-blocks
        const megaSize = blockPx * 1.5;
        const megaX = Math.floor((this.width - megaSize) / 2);
        const megaY = Math.min(this.floorY - megaSize - 10, startY + rows * (blockPx + gap) + 18);
        this.drawStaticBlock(megaX, megaY, megaSize, this.verdict.megaOutcome);
        if (this.verdict.popText) {
            ctx.save();
            ctx.font = `900 ${Math.max(16, Math.round(P * 13))}px 'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif`;
            ctx.textAlign = 'center';
            ctx.lineJoin = 'round';
            ctx.lineWidth = Math.max(3.5, P * 2);
            ctx.strokeStyle = 'rgba(6, 8, 14, 0.92)';
            ctx.strokeText(this.verdict.popText, megaX + megaSize / 2, megaY - 6);
            ctx.fillStyle = this.verdict.popColor;
            ctx.fillText(this.verdict.popText, megaX + megaSize / 2, megaY - 6);
            ctx.restore();
        }
    }

    drawStaticBlock(x, y, size, outcome) {
        const ctx = this.ctx;
        const theme = BLOCK_THEMES[outcome] || BLOCK_THEMES.MYSTERY;
        const P = size / 16;
        const [r, g, b] = theme.rgb;

        const glow = ctx.createRadialGradient(
            x + size / 2,
            y + size / 2,
            P,
            x + size / 2,
            y + size / 2,
            size * 1.1
        );
        glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.22)`);
        glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(x - size * 0.6, y - size * 0.6, size * 2.2, size * 2.2);

        ctx.fillStyle = theme.border;
        ctx.fillRect(x + P, y, 14 * P, 16 * P);
        ctx.fillRect(x, y + P, 16 * P, 14 * P);

        ctx.fillStyle = theme.base;
        ctx.fillRect(x + P, y + P, 14 * P, 14 * P);

        ctx.fillStyle = theme.light;
        ctx.fillRect(x + P, y + P, 13 * P, P);
        ctx.fillRect(x + P, y + 2 * P, P, 12 * P);

        ctx.fillStyle = theme.dark;
        ctx.fillRect(x + 2 * P, y + 14 * P, 13 * P, P);
        ctx.fillRect(x + 14 * P, y + 2 * P, P, 13 * P);

        ctx.fillStyle = theme.rivet;
        ctx.fillRect(x + 2 * P, y + 2 * P, P, P);
        ctx.fillRect(x + 13 * P, y + 2 * P, P, P);
        ctx.fillRect(x + 2 * P, y + 13 * P, P, P);
        ctx.fillRect(x + 13 * P, y + 13 * P, P, P);

        ctx.fillStyle = theme.dark;
        ctx.fillRect(x + 4 * P, y + 4 * P, 8 * P, 8 * P);
        ctx.fillStyle = theme.light;
        ctx.fillRect(x + 5 * P, y + 5 * P, 6 * P, 6 * P);
        ctx.fillStyle = theme.innerSymbol || theme.light;
        ctx.fillRect(x + 6 * P, y + 6 * P, 4 * P, 4 * P);
    }

    updateHud() {
        if (this.hudGreen) this.hudGreen.textContent = String(this.run.counts.green);
        if (this.hudPurple) this.hudPurple.textContent = String(this.run.counts.purple);
        if (this.hudRed) this.hudRed.textContent = String(this.run.counts.red);
        if (this.hudGrey) this.hudGrey.textContent = String(this.run.counts.skipped);
        if (this.hudGreyWrap) {
            this.hudGreyWrap.hidden = !(this.summary.skipped > 0 || this.run.counts.skipped > 0);
        }
    }

    fillCountsAndBlocks() {
        const summary = this.summary;
        this.run.counts = {
            total: summary.total,
            green: summary.green,
            purple: summary.purple,
            red: summary.red,
            skipped: summary.skipped
        };
        this.blocks = [];
        this.mushrooms = [];
        this.finale.phase = 'DONE';
        this.megaBlock.visible = true;
        this.megaBlock.hit = true;
        this.megaBlock.status = this.verdict.megaOutcome;
        this.mario.x = this.finale.marioMeetX;
        this.mario.y = 0;
        this.mario.vy = 0;
        this.mario.state = 'FINISHED';
        this.run.cameraX = this.megaBlock.x + 48;

        if (this.verdict.hasVictory) {
            this.princess.visible = true;
            this.princess.alpha = 1;
            this.princess.x = this.princess.targetX;
            this.princess.y = 0;
            this.castle.doorGlow = 1;
            this.castle.flagRaise = 1;
        }

        const pops = [];
        for (const it of this.items) {
            if (it && it.outcome !== 'grey' && typeof it.eloDelta === 'number' && Number.isFinite(it.eloDelta)) {
                pops.push(formatEloDelta(it.eloDelta));
            }
        }
        if (pops.length > 0 && this.popHistory.length === 0) {
            this.popHistory = pops;
            if (this.overlay) {
                this.overlay.dataset.lastPop = pops[pops.length - 1];
                this.overlay.dataset.popHistory = JSON.stringify(this.popHistory);
            }
        }
        if (this.overlay) {
            this.overlay.dataset.megaPop = this.verdict.popText;
            this.overlay.dataset.megaOutcome = this.verdict.megaOutcome;
            this.overlay.dataset.finaleBranch = this.verdict.hasVictory ? 'princess' : 'closed';
        }
    }

    finishRun() {
        if (this.run.finished) return;
        this.run.finished = true;
        this.mario.state = 'FINISHED';
        this.mario.scaleX = 1;
        this.mario.scaleY = 1;
        this.run.shakeIntensity = 0;
        this.run.shakeX = 0;
        this.run.shakeY = 0;
        this.finishTimer = window.setTimeout(() => {
            this.finishTimer = 0;
            if (!this.destroyed) this.showSummary();
        }, 120);
    }

    skipToSummary() {
        if (this.destroyed || this.run.summaryShown) return;
        this.run.finished = true;
        this.mario.state = 'FINISHED';
        if (this.finishTimer) {
            clearTimeout(this.finishTimer);
            this.finishTimer = 0;
        }
        this.fillCountsAndBlocks();
        this.updateHud();
        this.render();
        this.showSummary();
    }

    showSummary() {
        if (this.destroyed || this.run.summaryShown) return;
        this.run.summaryShown = true;
        const s = this.summary;
        const startWidth = this.pillEl.getBoundingClientRect().width;
        let summaryHtml = '';
        if (s.total === 0 && s.skipped > 0) {
            summaryHtml = `${s.skipped} skipped`;
        } else {
            summaryHtml = `${s.total} solved · ${s.correct} correct · ${s.purple} fast · ${s.red} wrong`;
            if (s.skipped > 0) summaryHtml += ` · ${s.skipped} skipped`;
        }
        if (s.hasElo) {
            const cls = s.netElo > 0 ? 'is-pos' : s.netElo < 0 ? 'is-neg' : 'is-zero';
            summaryHtml += ` · <span class="mr-elo ${cls}">${formatEloDelta(s.netElo)} Elo</span>`;
        }
        this.summaryEl.innerHTML = summaryHtml;
        this.runEl.hidden = true;
        this.summaryEl.hidden = false;
        this.pillEl.classList.add('is-summary');

        if (!this.reducedMotion) {
            const style = this.pillEl.style;
            style.transition = 'none';
            style.width = 'max-content';
            const targetWidth = this.pillEl.getBoundingClientRect().width;
            style.width = startWidth + 'px';
            void this.pillEl.offsetWidth;
            style.transition = '';
            requestAnimationFrame(() => {
                if (this.destroyed) return;
                style.width = targetWidth + 'px';
                this.pillWidthTimer = window.setTimeout(() => {
                    this.pillWidthTimer = 0;
                    if (!this.destroyed) style.width = '';
                }, 280);
            });
        }

        this.scheduleAutoFade(5000);
    }

    scheduleAutoFade(ms) {
        if (this.destroyed) return;
        if (this.autoFadeTimer) {
            clearTimeout(this.autoFadeTimer);
            this.autoFadeTimer = 0;
        }
        this.autoFadeRemaining = Math.max(0, ms);
        if (document.hidden || this.autoFadeRemaining === 0) return;
        this.autoFadeStartedAt = performance.now();
        this.autoFadeTimer = window.setTimeout(() => {
            this.autoFadeTimer = 0;
            this.autoFadeRemaining = 0;
            if (!this.destroyed) this.dismiss();
        }, this.autoFadeRemaining);
    }

    onKeyDown(e) {
        if (this.destroyed) return;
        if (this.run.summaryShown) {
            if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                e.stopPropagation();
                this.dismiss();
            }
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.skipToSummary();
        }
    }

    dismiss() {
        if (this.destroyed) return;
        this.destroyed = true;
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        if (this.finishTimer) {
            clearTimeout(this.finishTimer);
            this.finishTimer = 0;
        }
        if (this.pillWidthTimer) {
            clearTimeout(this.pillWidthTimer);
            this.pillWidthTimer = 0;
        }
        if (this.autoFadeTimer) {
            clearTimeout(this.autoFadeTimer);
            this.autoFadeTimer = 0;
        }
        window.removeEventListener('keydown', this.onKeyDown, true);
        window.removeEventListener('resize', this.onResize);
        document.removeEventListener('visibilitychange', this.onVisibility);
        this.overlay.classList.add('is-leaving');

        const overlay = this.overlay;
        const resolve = this.resolve;
        const finish = () => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (activeScene === this) activeScene = null;
            this.resolve = null;
            if (typeof resolve === 'function') resolve();
        };
        if (this.reducedMotion) finish();
        else window.setTimeout(finish, 180);
    }

    destroy() {
        this.dismiss();
    }
}
