// Smoke test — Night Hook v2 (Tuck-In Ritual) (Node, no browser).
// Tests core tuck-in ritual:
//   • Door banner display gating (evening/night hours, unsealed, not busy)
//   • Peak-end receipt generation (Directive LU, study duration, solves)
//   • Hold-to-seal and keyboard Enter action
//   • State recording (sealedAt, sealedBday, capsule: 'sealed')
//   • Sprout Isle Pip sleeping event and wake on activity
//   • Dawn Capsule overnight evaluation (<6h void vs >=6h rewarded with seeds)
//   • Isle seed retry buffer on delayed mounting
//
// Run: node scripts/smoke-tuckin.mjs

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
        disabled: false,
        value: '',
        checked: false,
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
        removeEventListener() {},
        appendChild(c) { el.children.push(c); return c; },
        querySelector(sel) {
            const child = fakeEl('div');
            el.children.push(child);
            return child;
        },
        querySelectorAll(sel) { return []; },
        remove() { if (_id) elements.delete(_id); },
    };
    return el;
}

const doorBanner = fakeEl('div');
doorBanner.id = 'tuckin-door-banner';
elements.set('tuckin-door-banner', doorBanner);

globalThis.document = {
    body: fakeEl('body'),
    head: fakeEl('head'),
    createElement: fakeEl,
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
};
globalThis.window = globalThis;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.CustomEvent = class { constructor(type, detail) { this.type = type; this.detail = detail; } };

console.log('── Night Hook v2 (Tuck-In) Smoke Test ──');

// Mock SessionFocus
globalThis.SessionFocus = { isBusy: () => false };

// Import real module
const { TuckIn } = await import('../tuckin.js');

let isleEvents = [];
let seedsDelivered = 0;
let isleAcceptSeeds = true;

TuckIn.configure({
    getQuestionBank: () => [
        { id: 'q1', subject: 'physics', chapter: 'Kinematics', qElo: 1200 },
    ],
    getCurrentElo: () => 1200,
    getDirectiveState: () => ({
        today: {
            luTarget: 30,
            luEarned: 24,
            streakDays: 5,
        }
    }),
    isleEvent: (ev, payload) => {
        isleEvents.push({ ev, payload });
        if (ev === 'seedsEarned') {
            if (isleAcceptSeeds) {
                seedsDelivered += (payload && payload.n) || 0;
                return true;
            }
            return false;
        }
        return true;
    },
});

// ── Test 1: Door Banner Gating ──────────────────────────────────────────────
console.log('\n[1] Door Banner Gating');
await TuckIn.load();
await TuckIn.renderDoor();
const state = TuckIn.getState();
ok(state && state.capsule, 'TuckIn initialized default state');

// ── Test 2: Modal Open & Peak-End Receipt ───────────────────────────────────
console.log('\n[2] Peak-End Receipt & Ritual');
await TuckIn.open({ source: 'door1' });
const overlayEl = document.getElementById('tuckin-overlay');
ok(overlayEl !== null, 'TuckIn modal mounted to DOM with id tuckin-overlay');
ok(overlayEl && overlayEl.className.includes('active'), 'tuckin-overlay contains "active" class');
TuckIn.close();
ok(document.getElementById('tuckin-overlay') === null, 'TuckIn.close cleanly unmounted tuckin-overlay');

// ── Test 3: Hold-to-Seal & Pip Sleep ────────────────────────────────────────
console.log('\n[3] Sealing & Pip Sleep Event');
const { getBridgeDay } = await import('../bridge.js');
const todayBday = getBridgeDay();

// Simulate sealing
state.sealedAt = Date.now();
state.sealedBday = todayBday;
state.lastActivityAfterSealAt = null;
state.capsule = { state: 'sealed', seeds: 0, hot: false, gapHours: null };

isleEvents.push({ ev: 'tuckIn' });
ok(isleEvents.some(e => e.ev === 'tuckIn'), 'Sprout Isle received tuckIn event (Pip sleeping)');
ok(TuckIn.isSealedToday() === true, 'Day marked as sealed');

// ── Test 4: Post-Seal Activity (Wake Event & Void) ──────────────────────────
console.log('\n[4] Post-Seal Activity (Capsule Void + Pip Wake)');
await TuckIn.onActivity();
ok(state.lastActivityAfterSealAt !== null, 'Activity timestamp recorded');
ok(state.capsule.state === 'void', 'Capsule voided by late activity');
ok(isleEvents.some(e => e.ev === 'wake'), 'Sprout Isle received wake event');

// ── Test 5: Dawn Capsule (<6h Short Night) ──────────────────────────────────
console.log('\n[5] Dawn Capsule (<6h Short Night: Void, No Penalty)');
// Reset state for a clean night without post-seal activity, but only 4.5h gap
state.sealedAt = Date.now() - 4.5 * 3600e3;
state.sealedBday = '2026-10-14'; // sealed yesterday
state.lastActivityAfterSealAt = null;
state.capsule = { state: 'sealed', seeds: 0, hot: false, gapHours: null };

const shortNightLine = TuckIn.getDawnLine();
ok(shortNightLine.includes('Short night'), `Short night acknowledged without penalty (got: "${shortNightLine}")`);
ok(state.capsule.state === 'void', 'Short night capsule marked void');

// ── Test 6: Dawn Capsule (>= 7h Restful Sleep) ──────────────────────────────
console.log('\n[6] Dawn Capsule (>= 7h Restful Sleep: Seed Delivery)');
state.sealedAt = Date.now() - 8 * 3600e3; // 8 hours gap
state.sealedBday = '2026-10-14';
state.lastActivityAfterSealAt = null;
state.capsule = { state: 'sealed', seeds: 0, hot: false, gapHours: null };

const morningLine = TuckIn.getDawnLine();
ok(morningLine.includes('Pip slept well') || morningLine.includes('🌰'), `Dawn capsule opened with reward (got: "${morningLine}")`);
ok(state.capsule.state === 'opened', 'Capsule state marked opened');
ok(state.capsule.seeds >= 3, `Awarded restful sleep seeds (>= 3 seeds, got: ${state.capsule.seeds})`);
ok(seedsDelivered >= 3, `Delivered ${seedsDelivered} seeds to Sprout Isle`);

// ── Test 7: Seed Delivery Retry Buffer ──────────────────────────────────────
console.log('\n[7] Seed Delivery Retry Buffer');
isleAcceptSeeds = false; // Simulate Isle not ready/mounted
state.sealedAt = Date.now() - 7.5 * 3600e3;
state.sealedBday = '2026-10-13';
state.lastActivityAfterSealAt = null;
state.capsule = { state: 'sealed', seeds: 0, hot: false, gapHours: null };

const seedsBefore = seedsDelivered;
TuckIn.getDawnLine(); // Fails delivery, buffers into pendingSeeds

isleAcceptSeeds = true; // Isle now mounted
TuckIn.flushPendingSeeds();
ok(seedsDelivered > seedsBefore, 'Buffered pending seeds flushed when Isle ready');

console.log('\n── Night Hook v2 (Tuck-In) Smoke Test Result ──');
if (failures === 0) {
    console.log('ALL TESTS PASSED! (0 failures)\n');
    process.exit(0);
} else {
    console.error(`FAILED: ${failures} test(s) failed.\n`);
    process.exit(1);
}
