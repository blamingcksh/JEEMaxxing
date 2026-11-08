// ---------------------------------------------------------------------------
// Super Mario Bros. (NES, 1985) APU Jingle Synthesizer
//
// Ported from the community disassembly of the SMB1 6502 music engine
// (music-data.asm). Drives the original ROM note, length, frequency, and
// envelope byte tables through a frame-accurate Web Audio simulation:
//   * Two pulse channels (12.5 / 25 / 50 / 75% duty cycles as band-limited
//     PeriodicWave tables) + 15-step hardware envelope clocked at 240 Hz
//     (including the authentic 1-frame out-of-bounds read on note frame 1).
//   * Triangle bass channel with hardware linear counter at 240 Hz.
//   * NTSC field timing (60.0988 fps).
//
// Supported jingles:
//   - 'win'      : Level Clear (WinLevelMusData)     — Standard / Flow win
//   - 'death'    : Mario Dies (DeathMusData)         — Standard / Flow lose
//   - 'castle'   : Castle Clear (EndOfCastleMusData) — Hardcore win
//   - 'gameover' : Game Over (GameOverMusData)       — Hardcore lose
// ---------------------------------------------------------------------------

export const JINGLE_IDS = ['win', 'death', 'castle', 'gameover'];

export const SMB_ROM = {
    // 11-bit pulse timer table (2 bytes per entry, high byte first).
    // Square f = 1789772.7/(16*(t+1)) Hz, triangle f = 1789772.7/(32*(t+1)) Hz.
    freqReg: [0x00,0x88,0x00,0x2f,0x00,0x00,0x02,0xa6,0x02,0x80,0x02,0x5c,0x02,0x3a,0x02,0x1a,0x01,0xdf,0x01,0xc4,0x01,0xab,0x01,0x93,0x01,0x7c,0x01,0x67,0x01,0x53,0x01,0x40,0x01,0x2e,0x01,0x1d,0x01,0x0d,0x00,0xfe,0x00,0xef,0x00,0xe2,0x00,0xd5,0x00,0xc9,0x00,0xbe,0x00,0xb3,0x00,0xa9,0x00,0xa0,0x00,0x97,0x00,0x8e,0x00,0x86,0x00,0x77,0x00,0x7e,0x00,0x71,0x00,0x54,0x00,0x64,0x00,0x5f,0x00,0x59,0x00,0x50,0x00,0x47,0x00,0x43,0x00,0x3b,0x00,0x35,0x00,0x2a,0x00,0x23,0x04,0x75,0x03,0x57,0x02,0xf9,0x02,0xcf,0x01,0xfc,0x00,0x6a],
    // note lengths in frames (60.0988 fps), indexed by (length nibble + header offset)
    lenTbl: [0x05,0x0a,0x14,0x28,0x50,0x1e,0x3c,0x02,0x04,0x08,0x10,0x20,0x40,0x18,0x30,0x0c,0x03,0x06,0x0c,0x18,0x30,0x12,0x24,0x08,0x36,0x03,0x09,0x06,0x12,0x1b,0x24,0x0c,0x24,0x02,0x06,0x04,0x0c,0x12,0x18,0x08,0x12,0x01,0x03,0x02,0x06,0x09,0x0c,0x04],
    // per-frame $4000/$4004 control bytes (duty<<6 | envelope decay rate)
    envEvent: [0x90,0x91,0x92,0x92,0x93,0x93,0x93,0x94,0x94,0x94,0x94,0x94,0x94,0x95,0x95,0x95,0x95,0x95,0x95,0x96,0x96,0x96,0x96,0x96,0x96,0x96,0x96,0x96,0x96,0x96,0x96,0x96,0x96,0x96,0x96,0x96,0x95,0x95,0x94,0x93],
    envCastle: [0x98,0x99,0x9a,0x9b],
    songs: {
        win: {
            title: 'LEVEL CLEAR',
            sub: 'Flagpole fanfare - when you finish a stage',
            lenOfs: 0x20,
            env: 'event',
            label: 'WinLevelMusData',
            sq2: [0x87,0x04,0x06,0x0c,0x14,0x1c,0x22,0x86,0x2c,0x22,0x87,0x04,0x60,0x0e,0x14,0x1a,0x24,0x86,0x2c,0x24,0x87,0x04,0x08,0x10,0x18,0x1e,0x28,0x86,0x30,0x30,0x80,0x64,0x00],
            sq1: [0xcd,0xd5,0xdd,0xe3,0xed,0xf5,0xbb,0xb5,0xcf,0xd5,0xdb,0xe5,0xed,0xf3,0xbd,0xb3,0xd1,0xd9,0xdf,0xe9,0xf1,0xf7,0xbf,0xff,0xff,0xff,0x34,0x00,0x86,0x04,0x87,0x14,0x1c,0x22,0x86,0x34,0x84,0x2c,0x04,0x04,0x04,0x87,0x14,0x1a,0x24,0x86,0x32,0x84,0x2c,0x04,0x86,0x04,0x87,0x18,0x1e,0x28,0x86,0x36,0x87,0x30,0x30,0x30,0x80,0x2c],
            tri: [0x86,0x04,0x87,0x14,0x1c,0x22,0x86,0x34,0x84,0x2c,0x04,0x04,0x04,0x87,0x14,0x1a,0x24,0x86,0x32,0x84,0x2c,0x04,0x86,0x04,0x87,0x18,0x1e,0x28,0x86,0x36,0x87,0x30,0x30,0x30,0x80,0x2c]
        },
        death: {
            title: 'MARIO DIES',
            sub: 'Player-down jingle - when you lose a life',
            lenOfs: 0x18,
            env: 'death',
            label: 'DeathMusData',
            sq2: [0x86,0x04,0x82,0x2a,0x36,0x04,0x36,0x87,0x36,0x34,0x30,0x86,0x2c,0x04,0x00],
            sq1: [0x00,0x68,0x6a,0x6c,0x45,0xa2,0x31,0xb0,0xf1,0xed,0xeb,0xa2,0x1d,0x9c,0x95,0x86,0x04,0x85,0x22,0x82,0x22,0x87,0x22,0x26,0x2a,0x84,0x2c,0x22,0x86,0x14,0x51,0x90,0x31,0x11,0x00],
            tri: [0x86,0x04,0x85,0x22,0x82,0x22,0x87,0x22,0x26,0x2a,0x84,0x2c,0x22,0x86,0x14,0x51,0x90,0x31,0x11,0x00]
        },
        gameover: {
            title: 'GAME OVER',
            sub: 'Game-over jingle - when it is all over',
            lenOfs: 0x18,
            env: 'event',
            label: 'GameOverMusData',
            sq2: [0x82,0x2c,0x04,0x04,0x22,0x04,0x04,0x84,0x1c,0x87,0x26,0x2a,0x26,0x84,0x24,0x28,0x24,0x80,0x22,0x00],
            sq1: [0x9c,0x05,0x94,0x05,0x0d,0x9f,0x1e,0x9c,0x98,0x9d,0x82,0x22,0x04,0x04,0x1c,0x04,0x04,0x84,0x14,0x86,0x1e,0x80,0x16,0x80,0x14],
            tri: [0x82,0x22,0x04,0x04,0x1c,0x04,0x04,0x84,0x14,0x86,0x1e,0x80,0x16,0x80,0x14]
        },
        castle: {
            title: 'CASTLE CLEAR',
            sub: 'End-of-castle fanfare (Bowser defeated)',
            lenOfs: 0x08,
            env: 'castle',
            label: 'EndOfCastleMusData',
            sq2: [0x81,0x2c,0x22,0x1c,0x2c,0x22,0x1c,0x85,0x2c,0x04,0x81,0x2e,0x24,0x1e,0x2e,0x24,0x1e,0x85,0x2e,0x04,0x81,0x32,0x28,0x22,0x32,0x28,0x22,0x85,0x32,0x87,0x36,0x36,0x36,0x84,0x3a,0x00],
            sq1: [0x5c,0x54,0x4c,0x5c,0x54,0x4c,0x5c,0x1c,0x1c,0x5c,0x5c,0x5c,0x5c,0x5e,0x56,0x4e,0x5e,0x56,0x4e,0x5e,0x1e,0x1e,0x5e,0x5e,0x5e,0x5e,0x62,0x5a,0x50,0x62,0x5a,0x50,0x62,0x22,0x22,0x62,0xe7,0xe7,0xe7,0x2b,0x86,0x14,0x81,0x14,0x80,0x14,0x14,0x81,0x14,0x14,0x14,0x14,0x86,0x16,0x81,0x16,0x80,0x16,0x16,0x81,0x16,0x16,0x16,0x16,0x81,0x28,0x22,0x1a,0x28,0x22,0x1a,0x28,0x80,0x28,0x28,0x81,0x28,0x87,0x2c,0x2c,0x2c,0x84,0x30],
            tri: [0x86,0x14,0x81,0x14,0x80,0x14,0x14,0x81,0x14,0x14,0x14,0x14,0x86,0x16,0x81,0x16,0x80,0x16,0x16,0x81,0x16,0x16,0x16,0x16,0x81,0x28,0x22,0x1a,0x28,0x22,0x1a,0x28,0x80,0x28,0x28,0x81,0x28,0x87,0x2c,0x2c,0x2c,0x84,0x30]
        }
    }
};

const CPU = 1789772.7;          // NTSC 2A03 clock, Hz
const FPS = 60.0988;            // NTSC field rate
const FRAME = 1 / FPS;          // one engine frame, seconds

function tone(off) {
    return {
        on: SMB_ROM.freqReg[off + 1] !== 0,
        t: (SMB_ROM.freqReg[off] << 8) | SMB_ROM.freqReg[off + 1]
    };
}
function sqHz(t) { return CPU / 16 / (t + 1); }
function triHz(t) { return CPU / 32 / (t + 1); }

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export function nameOf(hz) {
    if (!hz) return null;
    const m = Math.round(69 + 12 * Math.log(hz / 440) / Math.LN2);
    const pc = ((m % 12) + 12) % 12;
    return NAMES[pc] + (Math.floor(m / 12) - 1);
}

function decorate(events, hzOf) {
    events.forEach((e) => {
        const tn = tone(e.off);
        e.on = tn.on;
        e.hz = tn.on ? hzOf(tn.t) : 0;
        e.name = tn.on ? nameOf(e.hz) : null;
        e.t0 = e.frame * FRAME;
        e.t1 = (e.frame + e.len) * FRAME;
    });
    return events;
}

function decodeSq2(bytes, lenOfs) {
    const ev = [];
    let pos = 0, frame = 0, lenBuf = 1, endFrame = null;
    while (true) {
        const b = bytes[pos++];
        if (b === undefined) break;
        if (b === 0) { endFrame = frame; break; }
        if (b & 0x80) { lenBuf = SMB_ROM.lenTbl[((b & 7) + lenOfs) & 0x3f]; continue; }
        ev.push({ frame, len: lenBuf, off: b & 0x7f });
        frame += lenBuf;
    }
    return { events: ev, endFrame: endFrame === null ? frame : endFrame };
}

function decodeSq1(bytes, lenOfs, limit) {
    const ev = [];
    let pos = 0, frame = 0;
    while (frame < limit) {
        const b = bytes[pos++];
        if (b === undefined) break;
        if (b === 0) continue;
        const li = ((b & 1) << 2) | (((b >> 7) & 1) << 1) | ((b >> 6) & 1);
        const L = SMB_ROM.lenTbl[(li + lenOfs) & 0x3f];
        ev.push({ frame, len: L, off: b & 0x3e });
        frame += L;
    }
    return { events: ev };
}

function decodeTri(bytes, lenOfs, limit) {
    const ev = [];
    let pos = 0, frame = 0, lenBuf = 1, afterLen = false;
    while (frame < limit) {
        const b = bytes[pos++];
        if (b === undefined) break;
        if (b === 0) break;
        if (b & 0x80) { lenBuf = SMB_ROM.lenTbl[((b & 7) + lenOfs) & 0x3f]; afterLen = true; continue; }
        ev.push({ frame, len: lenBuf, off: b & 0x7f, afterLen });
        afterLen = false;
        frame += lenBuf;
    }
    return { events: ev };
}

function ctrlByte(envKind, kInto, isRest) {
    if (envKind === 'death') return isRest ? 0x04 : 0x82;
    let tbl, init, oob;
    if (envKind === 'castle') { tbl = SMB_ROM.envCastle; init = 4; oob = 0x90; }
    else { tbl = SMB_ROM.envEvent; init = 40; oob = 0x15; }
    if (isRest) return kInto === 0 ? 0x04 : tbl[0];
    if (kInto === 0) return 0x82;
    if (kInto === 1) return oob;
    const y = init - (kInto - 1);
    return tbl[y < 0 ? 0 : y];
}

function renderSquare(events, envKind, endFrame) {
    let level = 0, div = 0, rate = 15, duty = 2, pend = false;
    let eIdx = 0, cur = null, freq = null, lastLevel = -1;
    const env = [{ t: 0, l: 0 }];
    const freqs = [];
    const duties = [{ t: 0, d: 2 }];
    const LIMIT = endFrame + 130;

    for (let f = 0; f < LIMIT; f++) {
        while (eIdx < events.length && events[eIdx].frame === f) {
            cur = events[eIdx++];
            if (cur.on) {
                if (cur.hz !== freq) { freqs.push({ t: f * FRAME, f: cur.hz }); freq = cur.hz; }
                pend = true;
            }
        }

        let ctrl;
        if (f >= endFrame || !cur) ctrl = 0x90;
        else ctrl = ctrlByte(envKind, f - cur.frame, !cur.on);

        const d = (ctrl >> 6) & 3, r = ctrl & 15;
        if (d !== duty) { duties.push({ t: f * FRAME, d }); duty = d; }
        rate = r;

        for (let q = 0; q < 4; q++) {
            const t = (f + q * 0.25) * FRAME;
            if (pend) { level = 15; div = rate; pend = false; }
            else {
                if (div === 0) { if (level > 0) level--; div = rate; }
                else div--;
            }
            if (level !== lastLevel) { env.push({ t, l: level }); lastLevel = level; }
        }
        if (f >= endFrame && level === 0 && freqs.length) break;
    }

    const endT = env[env.length - 1].t;
    const segs = [];
    for (let i = 0; i < freqs.length; i++) {
        const t0 = freqs[i].t, t1 = (i + 1 < freqs.length) ? freqs[i + 1].t : endT;
        if (t1 <= t0) continue;
        for (let j = 0; j < duties.length; j++) {
            const d0 = Math.max(t0, duties[j].t);
            let d1 = (j + 1 < duties.length) ? duties[j + 1].t : Infinity;
            d1 = Math.min(t1, d1);
            if (d1 - d0 < 0.0006) continue;
            const ev2 = [];
            let k0 = -1;
            for (let k = 0; k < env.length; k++) {
                if (env[k].t <= d0) k0 = k;
                else if (env[k].t < d1) ev2.push(env[k]);
            }
            if (k0 >= 0) ev2.unshift({ t: d0, l: env[k0].l });
            segs.push({ ch: 'sq', t0: d0, t1: d1, hz: freqs[i].f, duty: duties[j].d, env: ev2 });
        }
    }
    return segs;
}

function renderTriangle(events, envKind, endFrame) {
    let reload = 31, halt = 0, L = 0, freq = null;
    let eIdx = 0, cur = null;
    const spans = [];
    let openT = null, openHz = null;
    const LIMIT = endFrame + 150;

    function close(t) {
        if (openT !== null && t - openT > 0.0006) spans.push({ t0: openT, t1: t, hz: openHz });
        openT = null;
    }

    let f = 0;
    for (; f < LIMIT; f++) {
        while (eIdx < events.length && events[eIdx].frame === f) {
            cur = events[eIdx++];
            if (cur.on) {
                L = cur.afterLen ? 31 : reload;
                if (envKind !== 'death') {
                    if (cur.len >= 18) { reload = 127; halt = 1; }
                    else { reload = (envKind === 'castle') ? 15 : 31; halt = 0; }
                }
                freq = cur.hz;
            }
        }
        if (f === endFrame) { halt = 0; reload = 0; }

        for (let q = 0; q < 4; q++) {
            const t = (f + q * 0.25) * FRAME;
            if (freq !== null && L > 0) {
                if (openT === null) { openT = t; openHz = freq; }
                else if (freq !== openHz) { close(t); openT = t; openHz = freq; }
            } else close(t);
            if (!halt && L > 0) L--;
        }
        if (f > endFrame && openT === null && L === 0) break;
    }
    close(f * FRAME);
    return spans;
}

const _decodeCache = new Map();

export function decode(id) {
    if (_decodeCache.has(id)) return _decodeCache.get(id);
    const S = SMB_ROM.songs[id];
    if (!S) throw new Error('Unknown SMB jingle id: ' + id);
    const sq2 = decodeSq2(S.sq2, S.lenOfs);
    const endFrame = sq2.endFrame;
    const sq1 = decodeSq1(S.sq1, S.lenOfs, endFrame);
    const tri = decodeTri(S.tri, S.lenOfs, endFrame);

    decorate(sq2.events, sqHz);
    decorate(sq1.events, sqHz);
    decorate(tri.events, triHz);

    const s1 = renderSquare(sq1.events, S.env, endFrame);
    const s2 = renderSquare(sq2.events, S.env, endFrame);
    const t3 = renderTriangle(tri.events, S.env, endFrame);
    const endT = Math.max(
        endFrame * FRAME,
        s1.length ? s1[s1.length - 1].t1 : 0,
        s2.length ? s2[s2.length - 1].t1 : 0,
        t3.length ? t3[t3.length - 1].t1 : 0
    );

    const decoded = {
        id,
        title: S.title,
        sub: S.sub,
        label: S.label,
        endFrame,
        endT,
        channels: {
            sq1: { label: 'PULSE 1', notes: sq1.events, segs: s1 },
            sq2: { label: 'PULSE 2', notes: sq2.events, segs: s2 },
            tri: { label: 'TRIANGLE', notes: tri.events, spans: t3 }
        }
    };
    _decodeCache.set(id, decoded);
    return decoded;
}

export const SMBEngine = { FPS, FRAME, CPU, nameOf, decode };

// ---------------------------------------------------------------------------
// Web Audio playback
// ---------------------------------------------------------------------------

const CHVOL = { sq1: 0.20, sq2: 0.21, tri: 0.30 };
// Scales the combined 3-channel mix to match the app's existing coin/bump SFX
// level while multiplied by the user's FX.vol() (0..1) slider.
export const JINGLE_LEVEL = 0.55;

const _wavesByCtx = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

function getDutyWaves(ctx) {
    if (_wavesByCtx && _wavesByCtx.has(ctx)) return _wavesByCtx.get(ctx);
    const waves = [0.125, 0.25, 0.5, 0.75].map((duty) => {
        const N = 64, re = new Float32Array(N + 1), im = new Float32Array(N + 1);
        for (let n = 1; n <= N; n++) im[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
        return ctx.createPeriodicWave(re, im);
    });
    if (_wavesByCtx) _wavesByCtx.set(ctx, waves);
    return waves;
}

/**
 * Schedule an SMB1 jingle on `ctx`.
 * @param {BaseAudioContext} ctx
 * @param {'win'|'death'|'castle'|'gameover'} id
 * @param {number} [volume=0.7] App sound volume slider (0..1).
 * @returns {{ duration: number, stop: () => void } | null}
 */
export function playSmbJingle(ctx, id, volume = 0.7) {
    if (!ctx || !(volume > 0)) return null;
    const s = decode(id);
    const waves = getDutyWaves(ctx);
    const t0 = ctx.currentTime + 0.04;
    const nodes = [];
    let stopped = false;

    const master = ctx.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume)) * JINGLE_LEVEL;

    let outNode = master;
    if (typeof ctx.createDynamicsCompressor === 'function') {
        try {
            const comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -14;
            comp.knee.value = 10;
            comp.ratio.value = 5;
            comp.attack.value = 0.003;
            comp.release.value = 0.2;
            master.connect(comp);
            outNode = comp;
        } catch (_) {}
    }
    outNode.connect(ctx.destination);

    const buses = {};
    for (const ch of ['sq1', 'sq2', 'tri']) {
        const g = ctx.createGain();
        g.gain.value = CHVOL[ch];
        g.connect(master);
        buses[ch] = g;
    }

    for (const ch of ['sq1', 'sq2']) {
        const vol = CHVOL[ch];
        for (const seg of s.channels[ch].segs) {
            const o = ctx.createOscillator();
            o.setPeriodicWave(waves[seg.duty]);
            o.frequency.value = seg.hz;
            const g = ctx.createGain();
            o.connect(g);
            g.connect(buses[ch]);
            let lastLevel = 0;
            g.gain.setValueAtTime(0, t0 + seg.t0);
            g.gain.linearRampToValueAtTime(
                ((seg.env.length ? seg.env[0].l : 0) / 15) * vol,
                t0 + seg.t0 + 0.0008
            );
            for (const p of seg.env) {
                if (p.t > seg.t0 + 0.001) {
                    g.gain.setValueAtTime((p.l / 15) * vol, t0 + p.t);
                    lastLevel = p.l;
                }
            }
            if (lastLevel > 0) {
                g.gain.setValueAtTime((lastLevel / 15) * vol, t0 + seg.t1 - 0.0007);
                g.gain.linearRampToValueAtTime(0, t0 + seg.t1);
            }
            o.start(t0 + seg.t0);
            o.stop(t0 + seg.t1 + 0.003);
            nodes.push(o);
        }
    }

    const triVol = CHVOL.tri;
    for (const sp of s.channels.tri.spans) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = sp.hz;
        const g = ctx.createGain();
        o.connect(g);
        g.connect(buses.tri);
        const a = t0 + sp.t0, b = t0 + sp.t1;
        g.gain.setValueAtTime(0, a);
        g.gain.linearRampToValueAtTime(triVol, a + 0.0012);
        if (b - a > 0.003) g.gain.setValueAtTime(triVol, b - 0.0012);
        g.gain.linearRampToValueAtTime(0, b);
        o.start(a);
        o.stop(b + 0.002);
        nodes.push(o);
    }

    function stop() {
        if (stopped) return;
        stopped = true;
        for (const n of nodes) {
            try { n.stop(0); } catch (_) {}
            try { n.disconnect(); } catch (_) {}
        }
        nodes.length = 0;
        try { master.disconnect(); } catch (_) {}
        if (outNode !== master) {
            try { outNode.disconnect(); } catch (_) {}
        }
    }

    return { duration: s.endT, stop };
}
