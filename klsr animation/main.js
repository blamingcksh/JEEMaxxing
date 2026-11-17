/**
 * KLSR // Photonic Manifold Simulation & Camera Orchestrator
 * Drives hyper-fast multi-head point-to-point photon leaps across complex
 * mathematical manifolds, capacitive node flashes, micro-sparks, and 3D orbit.
 */
(function () {
    'use strict';

    const { PATTERNS, POINT_COUNT, buildPattern } = window.KLSRPatterns;
    const { KLSRRenderer } = window.KLSRRenderer;

    const MAX_SEGMENTS = 320;
    const MAX_RUNNERS = 5;
    const CHAIN_CAP = 18;

    // -------------------------------------------------------------------------
    // Minimal 3D Column-Major Matrix Utilities
    // -------------------------------------------------------------------------
    function mat4Perspective(fovRad, aspect, near, far) {
        const f = 1.0 / Math.tan(fovRad * 0.5);
        const nf = 1.0 / (near - far);
        const out = new Float32Array(16);
        out[0] = f / aspect;
        out[5] = f;
        out[10] = (far + near) * nf;
        out[11] = -1.0;
        out[14] = 2.0 * far * near * nf;
        return out;
    }

    function mat4LookAt(eye, target, up) {
        let zx = eye[0] - target[0];
        let zy = eye[1] - target[1];
        let zz = eye[2] - target[2];
        let len = Math.hypot(zx, zy, zz) || 1.0;
        zx /= len; zy /= len; zz /= len;

        let xx = up[1] * zz - up[2] * zy;
        let xy = up[2] * zx - up[0] * zz;
        let xz = up[0] * zy - up[1] * zx;
        len = Math.hypot(xx, xy, xz) || 1.0;
        xx /= len; xy /= len; xz /= len;

        const yx = zy * xz - zz * xy;
        const yy = zz * xx - zx * xz;
        const yz = zx * xy - zy * xx;

        const out = new Float32Array(16);
        out[0] = xx;  out[4] = xy;  out[8]  = xz;  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
        out[1] = yx;  out[5] = yy;  out[9]  = yz;  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
        out[2] = zx;  out[6] = zy;  out[10] = zz;  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
        out[3] = 0;   out[7] = 0;   out[11] = 0;   out[15] = 1;
        return out;
    }

    function mat4Mul(a, b) {
        const out = new Float32Array(16);
        for (let col = 0; col < 4; col++) {
            const b0 = b[col * 4];
            const b1 = b[col * 4 + 1];
            const b2 = b[col * 4 + 2];
            const b3 = b[col * 4 + 3];
            out[col * 4]     = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3;
            out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3;
            out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
            out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
        }
        return out;
    }

    // -------------------------------------------------------------------------
    // Application State
    // -------------------------------------------------------------------------
    const state = {
        patternId: PATTERNS[0].id,
        seed: 2049,
        speed: 1.75,
        luminescence: 1.65,
        spread: 0.55,
        persistence: 0.84,
        spectrum: 'xenon',
        hudHidden: false,
        camYaw: 0.45,
        camPitch: 0.22,
        camDist: 2.55,
        targetYaw: 0.45,
        targetPitch: 0.22,
        targetDist: 2.55,
        mouseX: 0,
        mouseY: 0,
        dragging: false,
        lastPointerX: 0,
        lastPointerY: 0
    };

    const canvas = document.getElementById('gl-canvas');
    const renderer = new KLSRRenderer(canvas, MAX_SEGMENTS, POINT_COUNT);

    let manifold = null;
    const activePositions = new Float32Array(POINT_COUNT * 3);
    const nodeFlashes = new Float32Array(POINT_COUNT);

    // Pre-allocated ring buffer for brief cross-manifold ricochet beams
    const MAX_RICOCHETS = 48;
    const ricochetSegments = Array.from({ length: MAX_RICOCHETS }, () => ({
        a: 0, b: 0,
        energy: 0,
        width: 1,
        tint: 0
    }));
    let ricochetWriteIdx = 0;

    // Multi-head staccato photon pulses (SNAP -> HOLD -> BLANK/RICOCHET)
    const runners = Array.from({ length: MAX_RUNNERS }, (_, i) => ({
        mode: 'SNAP',
        curr: 0,
        prev: 0,
        next: 1,
        hopAccum: Math.random() * 0.5,
        burstRemaining: 6 + (i % 5) * 2,
        holdTimer: 0,
        speedMult: 0.84 + (i / MAX_RUNNERS) * 0.36,
        tint: i / MAX_RUNNERS,
        chainHead: 0,
        chain: Array.from({ length: CHAIN_CAP }, () => ({
            a: 0, b: 0,
            energy: 0,
            width: 1,
            tint: 0
        }))
    }));

    function updateActivePositions() {
        if (!manifold) return;
        const base = manifold.basePositions;
        const scatter = manifold.scatterDirs;
        const scale = 1.0 + state.spread * 0.26;
        const disp = state.spread * 0.62;

        for (let i = 0; i < POINT_COUNT * 3; i++) {
            activePositions[i] = base[i] * scale + scatter[i] * disp;
        }
        renderer.uploadNodePositions(activePositions);
    }

    function pickNextNode(currIdx, prevIdx) {
        const tightOffset = currIdx * manifold.tightK;
        const arcOffset = currIdx * manifold.arcK;

        const arcProb = Math.min(0.65, 0.06 + state.spread * 0.24);
        if (Math.random() < arcProb) {
            for (let tries = 0; tries < 4; tries++) {
                const cand = manifold.arcNeighbors[arcOffset + Math.floor(Math.random() * manifold.arcK)];
                if (cand !== currIdx && cand !== prevIdx) return cand;
            }
            return manifold.arcNeighbors[arcOffset];
        }

        // Bias strongly toward flow-aligned tight neighbors for crisp discrete manifold traces
        const fx = manifold.flowDirs[currIdx * 3];
        const fy = manifold.flowDirs[currIdx * 3 + 1];
        const fz = manifold.flowDirs[currIdx * 3 + 2];
        const px = activePositions[currIdx * 3];
        const py = activePositions[currIdx * 3 + 1];
        const pz = activePositions[currIdx * 3 + 2];

        let best = manifold.tightNeighbors[tightOffset];
        let bestScore = -1e9;

        for (let probe = 0; probe < 4; probe++) {
            const cand = manifold.tightNeighbors[tightOffset + Math.floor(Math.random() * manifold.tightK)];
            if (cand === currIdx || cand === prevIdx) continue;
            const dx = activePositions[cand * 3] - px;
            const dy = activePositions[cand * 3 + 1] - py;
            const dz = activePositions[cand * 3 + 2] - pz;
            const d = Math.hypot(dx, dy, dz) + 1e-5;
            const align = (dx * fx + dy * fy + dz * fz) / d;
            const score = align * 0.85 + Math.random() * 0.75;
            if (score > bestScore) {
                bestScore = score;
                best = cand;
            }
        }
        return best;
    }

    function pushRunnerSegment(runner, a, b, energy, width, tint) {
        const s = runner.chain[runner.chainHead];
        s.a = a;
        s.b = b;
        s.energy = energy;
        s.width = width;
        s.tint = tint;
        runner.chainHead = (runner.chainHead + 1) % CHAIN_CAP;
    }

    function pushRicochet(a, b, energy, width, tint) {
        const s = ricochetSegments[ricochetWriteIdx];
        s.a = a;
        s.b = b;
        s.energy = energy;
        s.width = width;
        s.tint = tint;
        ricochetWriteIdx = (ricochetWriteIdx + 1) % MAX_RICOCHETS;
    }

    function resetRunners() {
        for (let i = 0; i < MAX_RUNNERS; i++) {
            const r = runners[i];
            const start = Math.floor((i / MAX_RUNNERS) * POINT_COUNT + Math.random() * 60) % POINT_COUNT;
            r.mode = 'SNAP';
            r.prev = start;
            r.curr = start;
            r.next = pickNextNode(start, start);
            r.hopAccum = 0;
            r.burstRemaining = 4 + Math.floor(Math.random() * 10);
            r.holdTimer = 0;
            r.chainHead = 0;
            for (let c = 0; c < CHAIN_CAP; c++) {
                r.chain[c].energy = 0;
            }
        }
        nodeFlashes.fill(0);
        for (let i = 0; i < MAX_RICOCHETS; i++) {
            ricochetSegments[i].energy = 0;
        }
    }

    function loadPattern(patternId, seed) {
        state.patternId = patternId;
        state.seed = seed;
        manifold = buildPattern(patternId, seed);
        updateActivePositions();
        renderer.uploadPhases(manifold.phases);
        resetRunners();
        renderer.clearTrails();

        // Update HUD pattern info & active button
        document.getElementById('equation-readout').textContent = manifold.meta.equation;
        document.querySelectorAll('.pat-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.id === patternId);
        });
    }

    // -------------------------------------------------------------------------
    // UI Wiring & Interactions
    // -------------------------------------------------------------------------
    function initUI() {
        const statNodesEl = document.getElementById('stat-nodes');
        if (statNodesEl) statNodesEl.textContent = `${POINT_COUNT} NODES`;
        const patGrid = document.getElementById('pattern-grid');
        PATTERNS.forEach((p, idx) => {
            const btn = document.createElement('button');
            btn.className = 'pat-btn' + (p.id === state.patternId ? ' active' : '');
            btn.dataset.id = p.id;
            btn.title = `${p.name} [${idx + 1}]`;
            btn.innerHTML = `<span class="pat-code">${p.code}</span><span>${p.name}</span>`;
            btn.addEventListener('click', () => loadPattern(p.id, state.seed));
            patGrid.appendChild(btn);
        });

        const bindSlider = (id, valId, key, formatFn, onUpdate) => {
            const el = document.getElementById(id);
            const out = document.getElementById(valId);
            const sync = () => {
                state[key] = parseFloat(el.value);
                out.textContent = formatFn(state[key]);
                if (onUpdate) onUpdate(state[key]);
            };
            el.addEventListener('input', sync);
            sync();
        };

        bindSlider('ctrl-speed', 'val-speed', 'speed', (v) => v.toFixed(2) + '×');
        bindSlider('ctrl-luminescence', 'val-luminescence', 'luminescence', (v) => v.toFixed(2));
        bindSlider('ctrl-spread', 'val-spread', 'spread', (v) => v.toFixed(2), () => updateActivePositions());
        bindSlider('ctrl-persistence', 'val-persistence', 'persistence', (v) => v.toFixed(2));

        document.querySelectorAll('.spec-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.spectrum = btn.dataset.spec;
                document.querySelectorAll('.spec-btn').forEach((b) =>
                    b.classList.toggle('active', b === btn)
                );
            });
        });

        document.getElementById('btn-mutate').addEventListener('click', mutateSeed);
        document.getElementById('btn-hide-hud').addEventListener('click', toggleHud);
        document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);

        // Canvas Camera Drag, Touch Orbit & Pinch Zoom
        const activePointers = new Map();
        let lastPinchDist = 0;

        const getPinchDist = () => {
            const pts = Array.from(activePointers.values());
            if (pts.length < 2) return 0;
            return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        };

        canvas.addEventListener('pointerdown', (e) => {
            activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            state.dragging = activePointers.size === 1;
            state.lastPointerX = e.clientX;
            state.lastPointerY = e.clientY;
            if (activePointers.size === 2) {
                lastPinchDist = getPinchDist();
            }
            canvas.setPointerCapture(e.pointerId);
        });

        canvas.addEventListener('pointermove', (e) => {
            if (e.pointerType === 'mouse') {
                state.mouseX = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
                state.mouseY = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
            }

            if (activePointers.has(e.pointerId)) {
                activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            }

            if (activePointers.size === 2) {
                const dist = getPinchDist();
                if (lastPinchDist > 0) {
                    const delta = lastPinchDist - dist;
                    state.targetDist = Math.max(1.35, Math.min(5.2, state.targetDist + delta * 0.0065));
                }
                lastPinchDist = dist;
            } else if (state.dragging && activePointers.size === 1) {
                const dx = e.clientX - state.lastPointerX;
                const dy = e.clientY - state.lastPointerY;
                state.lastPointerX = e.clientX;
                state.lastPointerY = e.clientY;
                state.targetYaw -= dx * 0.0055;
                state.targetPitch = Math.max(-1.35, Math.min(1.35, state.targetPitch + dy * 0.0055));
            }
        });

        const endDrag = (e) => {
            activePointers.delete(e.pointerId);
            if (activePointers.size < 2) lastPinchDist = 0;
            if (activePointers.size === 1) {
                const remaining = Array.from(activePointers.values())[0];
                state.lastPointerX = remaining.x;
                state.lastPointerY = remaining.y;
                state.dragging = true;
            } else {
                state.dragging = false;
            }
        };
        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', endDrag);

        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            state.targetDist = Math.max(1.35, Math.min(5.2, state.targetDist + e.deltaY * 0.0014));
        }, { passive: false });

        canvas.addEventListener('dblclick', toggleFullscreen);

        // Keyboard shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.target && (e.target.tagName === 'INPUT' && e.target.type !== 'range')) return;
            const key = e.key.toLowerCase();

            if (key === ' ') {
                e.preventDefault();
                mutateSeed();
            } else if (key === 'h') {
                toggleHud();
            } else if (key === 'f') {
                toggleFullscreen();
            } else if (key === 'r') {
                state.targetYaw = 0.45;
                state.targetPitch = 0.22;
                state.targetDist = 2.55;
            } else if (key >= '1' && key <= '6') {
                const idx = parseInt(key, 10) - 1;
                if (PATTERNS[idx]) loadPattern(PATTERNS[idx].id, state.seed);
            }
        });

        window.addEventListener('resize', () => renderer.resize());
        document.addEventListener('fullscreenchange', updateFullscreenButton);
    }

    function mutateSeed() {
        const nextSeed = ((state.seed * 1664525 + 1013904223) >>> 0) || 1337;
        loadPattern(state.patternId, nextSeed);
    }

    let hintTimer = null;
    function toggleHud() {
        state.hudHidden = !state.hudHidden;
        document.body.classList.toggle('hud-hidden', state.hudHidden);
        if (state.hudHidden) {
            document.body.classList.add('hud-hint-visible');
            clearTimeout(hintTimer);
            hintTimer = setTimeout(() => {
                document.body.classList.remove('hud-hint-visible');
            }, 2400);
        }
    }

    function toggleFullscreen() {
        const docEl = document.documentElement;
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            if (docEl.requestFullscreen) {
                docEl.requestFullscreen().catch(() => {});
            } else if (docEl.webkitRequestFullscreen) {
                docEl.webkitRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }
    }

    function updateFullscreenButton() {
        const btn = document.getElementById('btn-fullscreen');
        if (!btn) return;
        const active = Boolean(document.fullscreenElement);
        btn.innerHTML = active ? 'EXIT <kbd>F</kbd>' : 'FULLSCREEN <kbd>F</kbd>';
    }

    // -------------------------------------------------------------------------
    // Simulation & Render Loop
    // -------------------------------------------------------------------------
    let lastTime = performance.now();
    let fpsAccum = 0;
    let fpsFrames = 0;
    let hopAccum = 0;
    let lastStatsUpdate = lastTime;

    const statFpsEl = document.getElementById('stat-fps');
    const statJumpsEl = document.getElementById('stat-jumps');

    function tick(now) {
        requestAnimationFrame(tick);

        const rawDt = (now - lastTime) * 0.001;
        lastTime = now;
        const dt = Math.min(Math.max(rawDt, 0.0005), 0.05);
        const timeSec = now * 0.001;

        // Smooth camera auto-drift + parallax
        if (!state.dragging) {
            state.targetYaw += dt * (0.14 + state.speed * 0.025);
        }
        state.camYaw += (state.targetYaw + state.mouseX * 0.12 - state.camYaw) * Math.min(1, dt * 6.5);
        state.camPitch += (state.targetPitch - state.mouseY * 0.1 - state.camPitch) * Math.min(1, dt * 6.5);
        state.camDist += (state.targetDist - state.camDist) * Math.min(1, dt * 7.5);

        const cp = Math.cos(state.camPitch);
        const eye = [
            state.camDist * cp * Math.sin(state.camYaw),
            state.camDist * Math.sin(state.camPitch),
            state.camDist * cp * Math.cos(state.camYaw)
        ];

        const aspect = Math.max(0.1, window.innerWidth / Math.max(1, window.innerHeight));
        const proj = mat4Perspective((46 * Math.PI) / 180, aspect, 0.08, 40.0);
        const view = mat4LookAt(eye, [0, 0, 0], [0, 1, 0]);
        const viewProj = mat4Mul(proj, view);

        // Segment decay rates: sharp snap-and-catch whip contraction
        const segDecaySnap = Math.exp(-dt * (18.0 - state.persistence * 13.5));
        const segDecayHold = Math.exp(-dt * (28.0 - state.persistence * 16.0));

        for (let i = 0; i < MAX_RICOCHETS; i++) {
            const s = ricochetSegments[i];
            if (s.energy > 0.01) {
                s.energy *= segDecaySnap;
            } else {
                s.energy = 0;
            }
        }

        // Decay node impact flashes
        const flashDecay = Math.exp(-dt * 10.5);
        for (let i = 0; i < POINT_COUNT; i++) {
            if (nodeFlashes[i] > 0.002) {
                nodeFlashes[i] *= flashDecay;
            } else {
                nodeFlashes[i] = 0;
            }
        }

        const activeCount = Math.min(MAX_RUNNERS, Math.max(1, Math.round(1 + state.speed * 0.85)));
        const baseHopsPerSec = 18.0 + state.speed * 58.0;

        // Advance active staccato photon pulses (SNAP -> HOLD -> BLANK / RICOCHET)
        let frameHops = 0;
        const inst = renderer.instanceData;
        let writeCount = 0;

        const pushInstance = (a, b, energy, width, tint) => {
            if (writeCount >= MAX_SEGMENTS) return;
            const a3 = a * 3;
            const b3 = b * 3;
            const o = writeCount * renderer.instanceStrideFloats;
            inst[o]     = activePositions[a3];
            inst[o + 1] = activePositions[a3 + 1];
            inst[o + 2] = activePositions[a3 + 2];
            inst[o + 3] = activePositions[b3];
            inst[o + 4] = activePositions[b3 + 1];
            inst[o + 5] = activePositions[b3 + 2];
            inst[o + 6] = energy;
            inst[o + 7] = width;
            inst[o + 8] = tint;
            writeCount++;
        };

        for (let r = 0; r < activeCount; r++) {
            const runner = runners[r];
            const decay = runner.mode === 'HOLD' ? segDecayHold : segDecaySnap;
            for (let c = 0; c < CHAIN_CAP; c++) {
                const seg = runner.chain[c];
                if (seg.energy > 0.01) {
                    seg.energy *= decay;
                } else {
                    seg.energy = 0;
                }
            }

            if (runner.mode === 'HOLD') {
                runner.holdTimer -= dt;
                // Keep locked vertex shimmering gently during capacitive hold
                nodeFlashes[runner.curr] = Math.max(nodeFlashes[runner.curr], 0.72);
                if (runner.holdTimer <= 0) {
                    runner.mode = 'SNAP';
                    runner.hopAccum = 0.65;
                    runner.burstRemaining = 4 + Math.floor(Math.random() * (5 + state.speed * 3));

                    if (Math.random() < 0.65) {
                        // Scanner blanking: dark teleport to a fresh cluster or manifold point
                        let fresh;
                        if (Math.random() < 0.45 + state.spread * 0.18) {
                            fresh = Math.floor(Math.random() * POINT_COUNT);
                        } else {
                            const arcOff = runner.curr * manifold.arcK;
                            fresh = manifold.arcNeighbors[arcOff + Math.floor(Math.random() * manifold.arcK)];
                        }
                        runner.prev = fresh;
                        runner.curr = fresh;
                        runner.next = pickNextNode(fresh, fresh);
                        nodeFlashes[fresh] = Math.min(1.25, nodeFlashes[fresh] + 0.9);
                    } else {
                        // High-energy cross-manifold ricochet snap
                        const arcOff = runner.curr * manifold.arcK;
                        const target = manifold.arcNeighbors[arcOff + Math.floor(Math.random() * manifold.arcK)];
                        pushRicochet(runner.curr, target, 1.35, 1.15, (runner.tint + 0.15) % 1);
                        nodeFlashes[target] = Math.min(1.35, nodeFlashes[target] + 1.25);
                        runner.prev = runner.curr;
                        runner.curr = target;
                        runner.next = pickNextNode(target, runner.prev);
                    }
                }
            } else {
                // SNAP burst phase: discrete node-to-node jumps
                runner.hopAccum += baseHopsPerSec * runner.speedMult * dt;
                let subHops = 0;
                while (runner.hopAccum >= 1.0 && runner.burstRemaining > 0 && subHops < 6) {
                    runner.hopAccum -= 1.0;
                    runner.burstRemaining--;
                    frameHops++;
                    subHops++;

                    const fromIdx = runner.curr;
                    const toIdx = runner.next;
                    pushRunnerSegment(runner, fromIdx, toIdx, 1.15, 1.0, runner.tint);
                    nodeFlashes[toIdx] = Math.min(1.35, nodeFlashes[toIdx] + 1.25);

                    runner.prev = fromIdx;
                    runner.curr = toIdx;
                    runner.next = pickNextNode(toIdx, fromIdx);
                    runner.tint = (runner.tint + 0.018) % 1.0;

                    if (runner.burstRemaining <= 0) {
                        runner.mode = 'HOLD';
                        runner.holdTimer = (0.035 + Math.random() * 0.065) / (0.4 + state.speed * 0.55);
                        break;
                    }
                }
            }

            // Emit coherent whip-like chain segments from newest (head) to oldest (tail)
            for (let age = 0; age < CHAIN_CAP; age++) {
                const idx = (runner.chainHead - 1 - age + CHAIN_CAP) % CHAIN_CAP;
                const seg = runner.chain[idx];
                if (seg.energy <= 0.015) continue;
                const headBoost = age === 0 && runner.mode === 'SNAP' ? 1.45 : 1.0;
                const tailTaper = Math.pow(1.0 - age / CHAIN_CAP, 1.1);
                const w = age === 0 ? 1.18 : Math.max(0.45, 0.95 - age * 0.035);
                pushInstance(seg.a, seg.b, seg.energy * headBoost * tailTaper, w, seg.tint);
            }
        }

        // Emit active cross-manifold ricochet beams
        for (let i = 0; i < MAX_RICOCHETS && writeCount < MAX_SEGMENTS; i++) {
            const s = ricochetSegments[i];
            if (s.energy > 0.015) {
                pushInstance(s.a, s.b, s.energy, s.width, s.tint);
            }
        }

        // Render HDR WebGL2 frame with de-duplicated single-layer persistence
        const dormantAlpha = 0.018 + Math.min(0.025, state.spread * 0.01);
        const effectiveFboPersistence = 0.18 + Math.pow(state.persistence, 2.2) * 0.56;
        renderer.render({
            viewProj,
            nodeFlashes,
            segmentCount: writeCount,
            luminescence: state.luminescence,
            persistence: effectiveFboPersistence,
            dormantAlpha,
            spectrumId: state.spectrum,
            time: timeSec,
            dt
        });

        // Telemetry readout update every 250ms
        fpsAccum += rawDt;
        fpsFrames++;
        hopAccum += frameHops;
        if (now - lastStatsUpdate >= 250) {
            const avgFps = Math.round(fpsFrames / Math.max(0.001, fpsAccum));
            const hopsPerSec = Math.round(hopAccum / Math.max(0.001, fpsAccum));
            statFpsEl.textContent = `${avgFps} FPS`;
            statJumpsEl.textContent = hopsPerSec >= 1000
                ? `${(hopsPerSec / 1000).toFixed(1)}K HOPS/S`
                : `${hopsPerSec} HOPS/S`;
            fpsAccum = 0;
            fpsFrames = 0;
            hopAccum = 0;
            lastStatsUpdate = now;
        }
    }

    // Boot
    initUI();
    loadPattern(PATTERNS[0].id, state.seed);
    requestAnimationFrame(tick);
})();
