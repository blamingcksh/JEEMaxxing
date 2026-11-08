import {
    decode,
    JINGLE_IDS,
    JINGLE_LEVEL,
    nameOf,
    playSmbJingle,
    SMB_ROM,
} from '../smb-jingles.js';

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

console.log('-- SMB1 NES jingle synthesizer smoke test --');

eq(JSON.stringify(JINGLE_IDS), JSON.stringify(['win', 'death', 'castle', 'gameover']), 'exports the four required jingle ids');
eq(SMB_ROM.songs.victory, undefined, 'Rescue jingle is excluded from bundle');
ok(JINGLE_LEVEL > 0 && JINGLE_LEVEL <= 1, 'JINGLE_LEVEL is a valid gain scalar');

const EXPECTED = {
    win:      { endFrame: 324, dur: 5.52, label: 'WinLevelMusData',    firstSq1: 'G3',  firstSq2: 'E3', sq1Segs: 78, sq2Segs: 69, triSpans: 18 },
    death:    { endFrame: 180, dur: 3.00, label: 'DeathMusData',       firstSq1: 'Bb4', firstSq2: 'B4', sq1Segs: 11, sq2Segs: 7,  triSpans: 8  },
    castle:   { endFrame: 364, dur: 6.19, label: 'EndOfCastleMusData', firstSq1: 'E4',  firstSq2: 'C5', sq1Segs: 23, sq2Segs: 27, triSpans: 25 },
    gameover: { endFrame: 216, dur: 3.72, label: 'GameOverMusData',    firstSq1: 'E4',  firstSq2: 'C5', sq1Segs: 27, sq2Segs: 38, triSpans: 6  },
};

for (const id of JINGLE_IDS) {
    const d = decode(id);
    const exp = EXPECTED[id];
    eq(d.id, id, id + ': decoded id matches');
    eq(d.label, exp.label, id + ': ROM label matches ' + exp.label);
    eq(d.endFrame, exp.endFrame, id + ': endFrame is ' + exp.endFrame);
    ok(Math.abs(d.endT - exp.dur) < 0.02, id + ': duration ~' + exp.dur + 's (got ' + d.endT.toFixed(2) + 's)');
    eq(d.channels.sq1.segs.length, exp.sq1Segs, id + ': sq1 segment count is ' + exp.sq1Segs);
    eq(d.channels.sq2.segs.length, exp.sq2Segs, id + ': sq2 segment count is ' + exp.sq2Segs);
    eq(d.channels.tri.spans.length, exp.triSpans, id + ': triangle span count is ' + exp.triSpans);

    const firstPitchedSq1 = d.channels.sq1.notes.find((n) => n.on);
    const firstPitchedSq2 = d.channels.sq2.notes.find((n) => n.on);
    eq(firstPitchedSq1 && firstPitchedSq1.name, exp.firstSq1, id + ': sq1 opens on ' + exp.firstSq1);
    eq(firstPitchedSq2 && firstPitchedSq2.name, exp.firstSq2, id + ': sq2 opens on ' + exp.firstSq2);

    const allSegsValid = [...d.channels.sq1.segs, ...d.channels.sq2.segs].every(
        (s) => Number.isFinite(s.hz) && s.hz > 20 && Number.isFinite(s.t0) && Number.isFinite(s.t1) && s.t1 > s.t0 && s.duty >= 0 && s.duty <= 3
    );
    ok(allSegsValid, id + ': all pulse segments have finite frequencies, duties, and timestamps');

    const allTriValid = d.channels.tri.spans.every(
        (sp) => Number.isFinite(sp.hz) && sp.hz > 20 && Number.isFinite(sp.t0) && Number.isFinite(sp.t1) && sp.t1 > sp.t0
    );
    ok(allTriValid, id + ': all triangle spans have finite frequencies and timestamps');

    ok(decode(id) === d, id + ': decode() caches decoded song');
}

eq(nameOf(440), 'A4', 'nameOf(440) is A4');
eq(nameOf(0), null, 'nameOf(0) is null');
eq(playSmbJingle(null, 'win', 0.7), null, 'playSmbJingle returns null without AudioContext');

// Stub AudioContext check to verify node scheduling and stop() teardown
let startedOscs = 0;
let stoppedOscs = 0;
const stubCtx = {
    currentTime: 10,
    destination: {},
    createPeriodicWave: () => ({}),
    createDynamicsCompressor: () => ({
        threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 },
        connect() {}, disconnect() {},
    }),
    createGain: () => ({
        gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} },
        connect() {}, disconnect() {},
    }),
    createOscillator: () => ({
        type: 'square',
        frequency: { value: 0 },
        setPeriodicWave() {},
        connect() {},
        disconnect() {},
        start() { startedOscs++; },
        stop() { stoppedOscs++; },
    }),
};

const handle = playSmbJingle(stubCtx, 'castle', 0.8);
ok(handle && Math.abs(handle.duration - EXPECTED.castle.dur) < 0.02, 'playSmbJingle returns duration handle for castle');
const expectedOscs = EXPECTED.castle.sq1Segs + EXPECTED.castle.sq2Segs + EXPECTED.castle.triSpans;
eq(startedOscs, expectedOscs, 'playSmbJingle starts all pulse + triangle oscillators (' + expectedOscs + ')');
handle.stop();
eq(stoppedOscs, expectedOscs * 2, 'handle.stop() stops all scheduled oscillators immediately');

if (failures) {
    console.error('\n' + failures + ' check(s) failed.');
    process.exit(1);
}
console.log('\nAll SMB1 jingle checks passed.');
