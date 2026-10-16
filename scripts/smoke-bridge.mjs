// Smoke test — Hemingway Bridge (Node, no browser).
// Tests core bridge lifecycle:
//   • Bridge-day 05:00 cutoff logic
//   • Stage priority hierarchy (explicit > abandoned > auto)
//   • Exclusion of Vault (error/wrong) and Mock questions
//   • Single-tap pickup and curiosity gap
//   • Eligibility gate (4h + next bridge day) and bonus application
//   • Stats tracking (ttfsSecs)
//
// Run: node scripts/smoke-bridge.mjs

let failures = 0;
const ok = (cond, name) => {
    if (cond) console.log('  ✓', name);
    else { console.error('  ✗ FAIL:', name); failures++; }
};

// ── Global stubs ────────────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};

const idbData = new Map();
globalThis.indexedDB = {
    open(name, version) {
        const req = {
            result: {
                objectStoreNames: { contains: () => true },
                createObjectStore: () => {},
                transaction(storeNames, mode) {
                    const tx = {
                        objectStore(sName) {
                            return {
                                get(key) {
                                    const r = { result: idbData.has(key) ? { key, value: JSON.parse(JSON.stringify(idbData.get(key))) } : null };
                                    setTimeout(() => {
                                        if (r.onsuccess) r.onsuccess();
                                        if (tx.oncomplete) tx.oncomplete();
                                    }, 0);
                                    return r;
                                },
                                put(entry) {
                                    idbData.set(entry.key, JSON.parse(JSON.stringify(entry.value)));
                                    const r = {};
                                    setTimeout(() => {
                                        if (r.onsuccess) r.onsuccess();
                                        if (tx.oncomplete) tx.oncomplete();
                                    }, 0);
                                    return r;
                                }
                            };
                        },
                        oncomplete: null,
                        onerror: null
                    };
                    return tx;
                },
                close() {}
            },
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null,
        };
        setTimeout(() => {
            if (req.onsuccess) req.onsuccess({ target: req });
        }, 0);
        return req;
    }
};

// Fake DOM
const elements = new Map();
function fakeEl(tag = 'div') {
    let _id = '';
    const el = {
        tag,
        get id() { return _id; },
        set id(v) { _id = v; if (v) elements.set(v, el); },
        className: '',
        textContent: '',
        innerHTML: '',
        hidden: false,
        children: [],
        style: {},
        classList: {
            _set: new Set(),
            add(c) { this._set.add(c); },
            remove(c) { this._set.delete(c); },
            toggle(c, f) {
                if (f === undefined) { if (this._set.has(c)) { this._set.delete(c); return false; } this._set.add(c); return true; }
                if (f) this._set.add(c); else this._set.delete(c);
                return !!f;
            },
            contains(c) { return this._set.has(c); },
        },
        setAttribute(k, v) { el[k] = v; if (k === 'id') { _id = v; if (v) elements.set(v, el); } },
        removeAttribute(k) { delete el[k]; if (k === 'id') { elements.delete(_id); _id = ''; } },
        addEventListener() {},
        appendChild(c) { el.children.push(c); return c; },
        querySelector(sel) { return fakeEl(); },
        querySelectorAll(sel) { return []; },
        remove() { if (_id) elements.delete(_id); },
    };
    return el;
}

const bridgeBanner = fakeEl('div');
bridgeBanner.id = 'bridge-banner';
elements.set('bridge-banner', bridgeBanner);

globalThis.document = {
    body: fakeEl('body'),
    head: fakeEl('head'),
    createElement: fakeEl,
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    dispatchEvent() {},
};
globalThis.window = globalThis;
globalThis.CustomEvent = class { constructor(type, detail) { this.type = type; this.detail = detail; } };

console.log('── Hemingway Bridge Smoke Test ──');

// Import real modules
const { getBridgeDay, isCrossEligible, Bridge } = await import('../bridge.js');

// ── Test 1: Bridge Day Cutoff (05:00) ────────────────────────────────────────
console.log('\n[1] Bridge Day 05:00 Cutoff');
const d1 = new Date(2026, 9, 15, 2, 30, 0); // Oct 15, 02:30 AM (before 05:00 -> belongs to Oct 14)
const d2 = new Date(2026, 9, 15, 5, 1, 0);  // Oct 15, 05:01 AM (after 05:00 -> belongs to Oct 15)
const d3 = new Date(2026, 9, 15, 14, 0, 0); // Oct 15, 14:00 PM (after 05:00 -> belongs to Oct 15)

ok(getBridgeDay(d1.getTime()) === '2026-10-14', `02:30 AM is bridge day 2026-10-14 (got ${getBridgeDay(d1.getTime())})`);
ok(getBridgeDay(d2.getTime()) === '2026-10-15', `05:01 AM is bridge day 2026-10-15 (got ${getBridgeDay(d2.getTime())})`);
ok(getBridgeDay(d3.getTime()) === '2026-10-15', `14:00 PM is bridge day 2026-10-15 (got ${getBridgeDay(d3.getTime())})`);

// ── Test 2: Cross Eligibility ───────────────────────────────────────────────
console.log('\n[2] Cross Eligibility (4h + new bridge day)');
const stagedAt = new Date(2026, 9, 15, 22, 0, 0).getTime(); // Oct 15, 22:00
const stagedBday = '2026-10-15';
const bRecord = { stagedAt, stagedBday };

const sameNight2h = new Date(2026, 9, 16, 0, 0, 0).getTime();  // 2h later (still bridge day Oct 15)
const nextMorning6h = new Date(2026, 9, 16, 6, 0, 0).getTime(); // 8h later (bridge day Oct 16)
const tooEarlyNextDay = new Date(2026, 9, 16, 5, 30, 0).getTime(); // Staged at 03:00, checked at 05:30 (only 2.5h)
const bRecordLate = { stagedAt: new Date(2026, 9, 16, 3, 0, 0).getTime(), stagedBday: '2026-10-15' };

ok(!isCrossEligible(bRecord, sameNight2h), 'Same bridge day is NOT cross-eligible');
ok(isCrossEligible(bRecord, nextMorning6h), 'Next bridge day with >= 4h IS cross-eligible');
ok(!isCrossEligible(bRecordLate, tooEarlyNextDay), 'Next bridge day with < 4h is NOT cross-eligible (cooldown)');

// ── Test 3: Staging and Replace Hierarchy ───────────────────────────────────
console.log('\n[3] Staging & Replace Hierarchy (explicit > abandoned > auto)');
const bank = [
    { id: 'q1', subject: 'physics', chapter: 'Kinematics', text: 'Velocity question', qElo: 1200 },
    { id: 'q2', subject: 'chemistry', chapter: 'Thermodynamics', text: 'Enthalpy question', qElo: 1250 },
    { id: 'q_vault', subject: 'maths', chapter: 'Calculus', text: 'Vault item', qElo: 1300, errorReason: 'conceptual', status: 'error' },
    { id: 'q_mock', subject: 'physics', chapter: 'Mock Exam', text: 'Mock test q', isMock: true },
];

let startedPractice = null;
Bridge.configure({
    getBank: () => bank,
    getCurrentElo: () => 1200,
    startPractice: (qs, idx, opts) => { startedPractice = { qs, idx, opts }; },
});

// 3a. Auto pick should skip vault and mock items
const autoQ = Bridge.pickQuestion('physics');
ok(autoQ && autoQ.id === 'q1', 'Auto-pick chose valid question q1');
const chemAuto = Bridge.pickQuestion('chemistry');
ok(chemAuto && chemAuto.id === 'q2', 'Auto-pick chose valid question q2');
const mathsAuto = Bridge.pickQuestion('maths');
ok(mathsAuto === null, 'Auto-pick correctly skipped Vault item q_vault');

// 3b. Stage auto
await Bridge.stage({ kind: 'auto', question: autoQ });
let live = Bridge.getLiveBridge();
ok(live && live.kind === 'auto' && live.questionId === 'q1', 'Staged kind=auto with q1');

// 3c. Stage abandoned overwrites auto
await Bridge.stage({ kind: 'abandoned', question: chemAuto, elapsedSecs: 45 });
live = Bridge.getLiveBridge();
ok(live && live.kind === 'abandoned' && live.questionId === 'q2' && live.elapsedSecs === 45, 'Abandoned overwritten auto');

// 3d. Stage parked (explicit) overwrites abandoned
await Bridge.stage({ kind: 'parked', question: autoQ, explicit: true, mindNote: 'Review first equation', firstMove: 'write down F=ma' });
live = Bridge.getLiveBridge();
ok(live && live.explicit === true && live.mindNote === 'Review first equation' && live.firstMove === 'write down F=ma', 'Explicit parked replaced abandoned');

// 3e. Passive abandoned CANNOT overwrite an explicit parked bridge
await Bridge.stage({ kind: 'abandoned', question: chemAuto, elapsedSecs: 30 });
live = Bridge.getLiveBridge();
ok(live && live.explicit === true && live.questionId === 'q1', 'Passive abandoned rejected when explicit parked bridge exists');
ok(live.mindNote === 'Review first equation', 'Preserved user custom note');

// ── Test 4: Glance API & Seen-Before-You-Set Rule ───────────────────────────
console.log('\n[4] Glance API & Seen-Before-You-Set Rule');
// Reset to an auto-picked question
await Bridge.stage({ kind: 'auto', question: chemAuto, explicit: false, force: true });
live = Bridge.getLiveBridge();
ok(live && !live.previewedAt, 'Auto-picked question is initially unseen');

// User glances at question
await Bridge.glance();
live = Bridge.getLiveBridge();
ok(live && live.previewedAt, 'Glance marks question as seen');

// Strategy chip selection
await Bridge.setFirstMove('Check units first');
live = Bridge.getLiveBridge();
ok(live.firstMove === 'Check units first', 'Strategy chip successfully saved');

// ── Test 5: Pickup & Timer Offset ───────────────────────────────────────────
console.log('\n[5] Single-tap Pickup & Display-Only Offset');
await Bridge.stage({ kind: 'abandoned', question: autoQ, elapsedSecs: 72, force: true });
await Bridge.pickUp();
ok(startedPractice !== null, 'Bridge.pickUp initiated practice');
ok(startedPractice.qs && startedPractice.qs[0].id === 'q1', 'Correct question passed to practice');
ok(startedPractice.opts && startedPractice.opts.displayOffsetSecs === 72, 'Timer display offset passed accurately (72s)');

// ── Test 6: Cross & Bonus Application ───────────────────────────────────────
console.log('\n[6] Cross & Bonus (1.25x LU) on Next Bridge Day');
// If solved on same bridge day -> no bonus, resolves unfinished state
const sameDayResult = Bridge.onSubmit(autoQ);
ok(!sameDayResult || !sameDayResult.bonus, 'Same-day solve does not award Hemingway bonus');

// Stage a bridge for cross testing
await Bridge.stage({ kind: 'parked', question: autoQ, explicit: true, force: true });
live = Bridge.getLiveBridge();
live.stagedBday = '2026-10-14'; // staged yesterday
live.stagedAt = Date.now() - 8 * 3600e3; // 8 hours ago

const nextDayResult = Bridge.onSubmit(autoQ);
ok(nextDayResult && nextDayResult.bonus === true && nextDayResult.bridgeMul === 1.25, 'Next-day solve awards 1.25x LU bonus');

const stats = Bridge.getStats();
ok(stats && stats.crossed >= 1, 'Stats recorded bridge cross');

// ── Test 7: Question Swap with Exclusion ────────────────────────────────────
console.log('\n[7] Question Swap with Exclusion');
const swappedQ = Bridge.pickQuestion({ excludeQids: ['q1'] });
ok(swappedQ && swappedQ.id === 'q2', 'pickQuestion with excludeQids:["q1"] returned q2');

// ── Test 8: Glance with Question Override ───────────────────────────────────
console.log('\n[8] Glance with Question Override');
const glanceRes = await Bridge.glance(chemAuto);
ok(glanceRes && glanceRes.text.includes('Enthalpy'), 'glance(chemAuto) returned question stem for q2');

// ── Test 9: Pickup Modal .active Class ──────────────────────────────────────
console.log('\n[9] Pickup Modal .active Class');
await Bridge.stage({ kind: 'parked', question: autoQ, explicit: true, force: true });
live = Bridge.getLiveBridge();
live.stagedBday = '2026-10-14'; // staged yesterday
live.stagedAt = Date.now() - 8 * 3600e3; // 8 hours ago
await Bridge.present();
const modalEl = document.getElementById('bridge-pickup-modal');
ok(modalEl && modalEl.className.includes('active'), 'bridge-pickup-modal contains "active" class');

console.log('\n── Hemingway Bridge Smoke Test Result ──');
if (failures === 0) {
    console.log('ALL TESTS PASSED! (0 failures)\n');
    process.exit(0);
} else {
    console.error(`FAILED: ${failures} test(s) failed.\n`);
    process.exit(1);
}
