/**
 * KLSR // Complex Mathematical Manifold & Stochastic Graph Engine
 * Generates 3D point clouds anchored to chaotic attractors, 4D fibrations,
 * divergence-free curl filaments, caustic folds, and cymatic eigenmodes.
 * Every node carries local tangent/flow vectors, dispersion normals, and
 * pre-indexed multi-scale neighbor buckets for O(1) ultra-fast photon hops.
 */
(function (global) {
    'use strict';

    const POINT_COUNT = 2400;
    const TIGHT_K = 16;
    const ARC_K = 12;

    /**
     * Fast deterministic Mulberry32 PRNG so mutations are reproducible per seed.
     */
    function createRng(seed) {
        let s = (seed >>> 0) || 1;
        return function () {
            s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function clamp(v, lo, hi) {
        return v < lo ? lo : v > hi ? hi : v;
    }

    function normalizeVec3(x, y, z, fallbackX = 0, fallbackY = 1, fallbackZ = 0) {
        const len = Math.hypot(x, y, z);
        if (len < 1e-7 || !Number.isFinite(len)) {
            return [fallbackX, fallbackY, fallbackZ];
        }
        return [x / len, y / len, z / len];
    }

    /**
     * Pattern 01: Lorenz-Rossler Coupled Strange Attractor
     * Combines multi-trajectory RK4 Lorenz wings with helical Rossler phase twist.
     */
    function genLorenzRossler(count, rng) {
        const positions = new Float32Array(count * 3);
        const flows = new Float32Array(count * 3);
        const phases = new Float32Array(count);

        const sigma = 10.0 + (rng() - 0.5) * 2.2;
        const rho = 28.0 + (rng() - 0.5) * 4.5;
        const beta = 8.0 / 3.0 + (rng() - 0.5) * 0.35;
        const twist = 0.08 + rng() * 0.14;
        const dt = 0.0055;

        const streams = 12;
        const perStream = Math.ceil(count / streams);
        let idx = 0;

        function deriv(x, y, z) {
            const dx = sigma * (y - x) - twist * z * 0.35;
            const dy = x * (rho - z) - y + twist * x * 0.25;
            const dz = x * y - beta * z;
            return [dx, dy, dz];
        }

        for (let s = 0; s < streams && idx < count; s++) {
            let x = (rng() - 0.5) * 18.0 + (s % 2 === 0 ? 4.0 : -4.0);
            let y = (rng() - 0.5) * 18.0;
            let z = 18.0 + rng() * 14.0;

            // Warmup onto the strange attractor manifold
            for (let w = 0; w < 500; w++) {
                const [k1x, k1y, k1z] = deriv(x, y, z);
                const [k2x, k2y, k2z] = deriv(x + 0.5 * dt * k1x, y + 0.5 * dt * k1y, z + 0.5 * dt * k1z);
                const [k3x, k3y, k3z] = deriv(x + 0.5 * dt * k2x, y + 0.5 * dt * k2y, z + 0.5 * dt * k2z);
                const [k4x, k4y, k4z] = deriv(x + dt * k3x, y + dt * k3y, z + dt * k3z);
                x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
                y += (dt / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
                z += (dt / 6) * (k1z + 2 * k2z + 2 * k3z + k4z);
            }

            for (let p = 0; p < perStream && idx < count; p++) {
                // Sub-step 3 times per recorded point so points span full wing curvature
                let vx = 0, vy = 0, vz = 0;
                for (let sub = 0; sub < 3; sub++) {
                    const [k1x, k1y, k1z] = deriv(x, y, z);
                    const [k2x, k2y, k2z] = deriv(x + 0.5 * dt * k1x, y + 0.5 * dt * k1y, z + 0.5 * dt * k1z);
                    const [k3x, k3y, k3z] = deriv(x + 0.5 * dt * k2x, y + 0.5 * dt * k2y, z + 0.5 * dt * k2z);
                    const [k4x, k4y, k4z] = deriv(x + dt * k3x, y + dt * k3y, z + dt * k3z);
                    x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
                    y += (dt / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
                    z += (dt / 6) * (k1z + 2 * k2z + 2 * k3z + k4z);
                    vx = k1x; vy = k1y; vz = k1z;
                }

                // Tilt Z slightly into Y for richer 3D presentation
                positions[idx * 3] = x;
                positions[idx * 3 + 1] = z - 24.0;
                positions[idx * 3 + 2] = y;

                const [fx, fy, fz] = normalizeVec3(vx, vz, vy);
                flows[idx * 3] = fx;
                flows[idx * 3 + 1] = fy;
                flows[idx * 3 + 2] = fz;
                phases[idx] = p / perStream;
                idx++;
            }
        }

        return { positions, flows, phases };
    }

    /**
     * Pattern 02: Aizawa Toroidal Flux Manifold
     * Spherical chaotic attractor with central polar vortex tube and folded outer petals.
     */
    function genAizawaFlux(count, rng) {
        const positions = new Float32Array(count * 3);
        const flows = new Float32Array(count * 3);
        const phases = new Float32Array(count);

        const a = 0.95 + (rng() - 0.5) * 0.04;
        const b = 0.70 + (rng() - 0.5) * 0.04;
        const c = 0.60 + (rng() - 0.5) * 0.03;
        const d = 3.50 + (rng() - 0.5) * 0.35;
        const e = 0.25 + (rng() - 0.5) * 0.04;
        const f = 0.10 + (rng() - 0.5) * 0.03;
        const dt = 0.009;

        function deriv(x, y, z) {
            const r2 = x * x + y * y;
            return [
                (z - b) * x - d * y,
                d * x + (z - b) * y,
                c + a * z - (z * z * z) / 3.0 - r2 * (1.0 + e * z) + f * z * x * x * x
            ];
        }

        const streams = 10;
        const perStream = Math.ceil(count / streams);
        let idx = 0;

        for (let s = 0; s < streams && idx < count; s++) {
            let x = 0.1 + (rng() - 0.5) * 0.3;
            let y = (rng() - 0.5) * 0.3;
            let z = (rng() - 0.5) * 0.3;

            for (let w = 0; w < 450; w++) {
                const [k1x, k1y, k1z] = deriv(x, y, z);
                const [k2x, k2y, k2z] = deriv(x + 0.5 * dt * k1x, y + 0.5 * dt * k1y, z + 0.5 * dt * k1z);
                const [k3x, k3y, k3z] = deriv(x + 0.5 * dt * k2x, y + 0.5 * dt * k2y, z + 0.5 * dt * k2z);
                const [k4x, k4y, k4z] = deriv(x + dt * k3x, y + dt * k3y, z + dt * k3z);
                x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
                y += (dt / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
                z += (dt / 6) * (k1z + 2 * k2z + 2 * k3z + k4z);
                if (!Number.isFinite(x) || Math.abs(x) > 10 || Math.abs(y) > 10 || Math.abs(z) > 10) {
                    x = 0.1; y = 0.0; z = 0.0;
                }
            }

            for (let p = 0; p < perStream && idx < count; p++) {
                let vx = 0, vy = 0, vz = 0;
                for (let sub = 0; sub < 4; sub++) {
                    const [k1x, k1y, k1z] = deriv(x, y, z);
                    const [k2x, k2y, k2z] = deriv(x + 0.5 * dt * k1x, y + 0.5 * dt * k1y, z + 0.5 * dt * k1z);
                    const [k3x, k3y, k3z] = deriv(x + 0.5 * dt * k2x, y + 0.5 * dt * k2y, z + 0.5 * dt * k2z);
                    const [k4x, k4y, k4z] = deriv(x + dt * k3x, y + dt * k3y, z + dt * k3z);
                    x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
                    y += (dt / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
                    z += (dt / 6) * (k1z + 2 * k2z + 2 * k3z + k4z);
                    if (!Number.isFinite(x) || Math.abs(x) > 6 || Math.abs(y) > 6 || Math.abs(z) > 6) {
                        x = 0.1; y = 0.05; z = 0.0;
                    }
                    vx = k1x; vy = k1y; vz = k1z;
                }

                positions[idx * 3] = x;
                positions[idx * 3 + 1] = z - 0.65;
                positions[idx * 3 + 2] = y;

                const [fx, fy, fz] = normalizeVec3(vx, vz, vy);
                flows[idx * 3] = fx;
                flows[idx * 3 + 1] = fy;
                flows[idx * 3 + 2] = fz;
                phases[idx] = (s / streams + p / perStream) % 1;
                idx++;
            }
        }

        return { positions, flows, phases };
    }

    /**
     * Pattern 03: Hopf 4D Stereographic Fibration
     * Projects linked S1 fibers of an S3 spherical knot curve into R3 via 4D rotation.
     */
    function genHopfFibration(count, rng) {
        const positions = new Float32Array(count * 3);
        const flows = new Float32Array(count * 3);
        const phases = new Float32Array(count);

        const fibers = 60;
        const ptsPerFiber = Math.ceil(count / fibers);

        // Harmonic frequencies on base S2 for intricate asymmetric nested tori
        const freqA = 2 + Math.floor(rng() * 4);
        const freqB = 3 + Math.floor(rng() * 5);
        const freqC = 1 + Math.floor(rng() * 3);

        // 4D plane rotation angles
        const rot14 = rng() * Math.PI * 2;
        const rot23 = rng() * Math.PI * 2;
        const c14 = Math.cos(rot14), s14 = Math.sin(rot14);
        const c23 = Math.cos(rot23), s23 = Math.sin(rot23);

        let idx = 0;
        for (let f = 0; f < fibers && idx < count; f++) {
            const u = (f / fibers) * Math.PI * 2;
            // Base curve on S2: braided spherical rose / loxodrome
            const theta = Math.PI * 0.5 + 0.78 * Math.sin(freqA * u) + 0.22 * Math.cos(freqB * u);
            const phi = u * freqC + 0.65 * Math.sin(freqB * u);

            const st = Math.sin(theta);
            const a = st * Math.cos(phi);
            const b = st * Math.sin(phi);
            const c = Math.cos(theta);

            // Inverse Hopf fiber amplitudes
            const r1 = Math.sqrt(Math.max(0.0001, (1 + c) * 0.5));
            const r2 = Math.sqrt(Math.max(0.0001, (1 - c) * 0.5));
            const basePhase = Math.atan2(b, a);
            const fiberJitter = rng() * Math.PI * 2;

            for (let k = 0; k < ptsPerFiber && idx < count; k++) {
                const psi = fiberJitter + (k / ptsPerFiber) * Math.PI * 2 + (rng() - 0.5) * 0.04;

                // Point on S3 in R4
                let w = r1 * Math.cos(psi);
                let x = r1 * Math.sin(psi);
                let y = r2 * Math.cos(psi + basePhase);
                let z = r2 * Math.sin(psi + basePhase);

                // Rotate in 4D (w-z and x-y / w-x and y-z) for tilted stereographic warp
                const w1 = w * c14 - z * s14;
                const z1 = w * s14 + z * c14;
                const x1 = x * c23 - y * s23;
                const y1 = x * s23 + y * c23;

                // Stereographic projection from (0,0,0, 1.32)
                const denom = 1.32 - w1;
                const px = x1 / denom;
                const py = y1 / denom;
                const pz = z1 / denom;

                // Analytical tangent along fiber (d/dpsi)
                const dw = -r1 * Math.sin(psi);
                const dx = r1 * Math.cos(psi);
                const dy = -r2 * Math.sin(psi + basePhase);
                const dz = r2 * Math.cos(psi + basePhase);
                const dw1 = dw * c14 - dz * s14;
                const dz1 = dw * s14 + dz * c14;
                const dx1 = dx * c23 - dy * s23;
                const dy1 = dx * s23 + dy * c23;

                const tx = (dx1 * denom + x1 * dw1) / (denom * denom);
                const ty = (dy1 * denom + y1 * dw1) / (denom * denom);
                const tz = (dz1 * denom + z1 * dw1) / (denom * denom);

                positions[idx * 3] = px;
                positions[idx * 3 + 1] = py;
                positions[idx * 3 + 2] = pz;

                const [fx, fy, fz] = normalizeVec3(tx, ty, tz);
                flows[idx * 3] = fx;
                flows[idx * 3 + 1] = fy;
                flows[idx * 3 + 2] = fz;
                phases[idx] = f / fibers;
                idx++;
            }
        }

        return { positions, flows, phases };
    }

    /**
     * Pattern 04: Curl-Noise Dendritic Filaments
     * Advects light-vein streamlines through an analytical divergence-free 3D trigonometric curl field.
     */
    function genCurlFilaments(count, rng) {
        const positions = new Float32Array(count * 3);
        const flows = new Float32Array(count * 3);
        const phases = new Float32Array(count);

        // Generate 4 octaves of non-axis-aligned Fourier wave components for potential Psi(x,y,z)
        const modes = [];
        for (let m = 0; m < 10; m++) {
            const octave = Math.pow(1.55, Math.floor(m / 2));
            const th = rng() * Math.PI * 2;
            const ph = Math.acos(2 * rng() - 1);
            modes.push({
                kx: Math.sin(ph) * Math.cos(th) * octave * 1.45,
                ky: Math.sin(ph) * Math.sin(th) * octave * 1.45,
                kz: Math.cos(ph) * octave * 1.45,
                px: rng() * Math.PI * 2,
                py: rng() * Math.PI * 2,
                pz: rng() * Math.PI * 2,
                amp: 1.0 / Math.pow(1.45, Math.floor(m / 2))
            });
        }

        function curlAt(x, y, z) {
            // Curl of Psi = (dPz/dy - dPy/dz, dPx/dz - dPz/dx, dPy/dx - dPx/dy)
            let cx = 0, cy = 0, cz = 0;
            for (let i = 0; i < modes.length; i++) {
                const m = modes[i];
                const arg = m.kx * x + m.ky * y + m.kz * z;
                const dPx_dy = m.amp * m.ky * Math.cos(arg + m.px);
                const dPx_dz = m.amp * m.kz * Math.cos(arg + m.px);
                const dPy_dx = m.amp * m.kx * Math.cos(arg + m.py);
                const dPy_dz = m.amp * m.kz * Math.cos(arg + m.py);
                const dPz_dx = m.amp * m.kx * Math.cos(arg + m.pz);
                const dPz_dy = m.amp * m.ky * Math.cos(arg + m.pz);

                cx += dPz_dy - dPy_dz;
                cy += dPx_dz - dPz_dx;
                cz += dPy_dx - dPx_dy;
            }
            return [cx, cy, cz];
        }

        const streams = 60;
        const steps = Math.ceil(count / streams);
        let idx = 0;

        for (let s = 0; s < streams && idx < count; s++) {
            // Fibonacci-perturbed starting shell around an asymmetric ring/core
            const u = s / streams;
            const th = u * Math.PI * 2 * 3.618 + rng() * 0.4;
            const ph = Math.acos(1 - 2 * ((s + 0.5) / streams)) + (rng() - 0.5) * 0.25;
            const r0 = 0.35 + rng() * 0.55;
            let x = r0 * Math.sin(ph) * Math.cos(th);
            let y = r0 * Math.cos(ph) * 0.85;
            let z = r0 * Math.sin(ph) * Math.sin(th);

            const dir = s % 2 === 0 ? 1 : -1;
            const stepLen = 0.048;

            for (let k = 0; k < steps && idx < count; k++) {
                const [cx, cy, cz] = curlAt(x, y, z);
                // Gentle spherical-shell restoring pull + vortex swirl keeps filaments entangled
                const r = Math.hypot(x, y, z) + 1e-5;
                const pull = (0.9 - r) * 0.45;
                const vx = cx * dir + (x / r) * pull - z * 0.22;
                const vy = cy * dir + (y / r) * pull;
                const vz = cz * dir + (z / r) * pull + x * 0.22;

                const [nx, ny, nz] = normalizeVec3(vx, vy, vz);
                x += nx * stepLen;
                y += ny * stepLen;
                z += nz * stepLen;

                positions[idx * 3] = x;
                positions[idx * 3 + 1] = y;
                positions[idx * 3 + 2] = z;

                flows[idx * 3] = nx;
                flows[idx * 3 + 1] = ny;
                flows[idx * 3 + 2] = nz;
                phases[idx] = k / steps;
                idx++;
            }
        }

        return { positions, flows, phases };
    }

    /**
     * Pattern 05: Clifford-De Jong / Pickover 3D Caustic Fold
     * Iterative trigonometric map producing sharp optical caustic ridges & folded veils.
     */
    function genCliffordCaustics(count, rng) {
        // Verified high-entropy chaotic Pickover 3D attractor parameter tuples
        const presets = [
            [1.64, -1.9, 1.32, 1.5],
            [-2.24, 0.43, -0.65, -2.43],
            [1.4, 1.56, 1.4, -6.56],
            [2.24, 0.43, -0.65, -2.43],
            [-1.78, 1.27, 2.09, -1.64],
            [2.01, -2.53, 1.61, -0.33]
        ];

        const base = presets[Math.floor(rng() * presets.length)];
        let a = base[0] + (rng() - 0.5) * 0.16;
        let b = base[1] + (rng() - 0.5) * 0.16;
        let c = base[2] + (rng() - 0.5) * 0.16;
        let d = base[3] + (rng() - 0.5) * 0.16;

        let startX = (rng() - 0.5) * 0.4;
        let startY = (rng() - 0.5) * 0.4;
        let startZ = (rng() - 0.5) * 0.4;

        function isChaotic(pa, pb, pc, pd, sx, sy, sz) {
            let x = sx, y = sy, z = sz;
            let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
            const bins = new Set();
            for (let i = 0; i < 800; i++) {
                const nx = Math.sin(pa * y) - z * Math.cos(pb * x);
                const ny = z * Math.sin(pc * x) - Math.cos(pd * y);
                const nz = Math.sin(x);
                x = nx; y = ny; z = nz;
                if (i > 250) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    bins.add((Math.round(x * 30) * 1009 + Math.round(y * 30)) * 1009 + Math.round(z * 30));
                }
            }
            const area = (maxX - minX) * (maxY - minY);
            return area > 1.4 && bins.size > 380;
        }

        if (!isChaotic(a, b, c, d, startX, startY, startZ)) {
            [a, b, c, d] = base;
            startX = 0.1; startY = 0.1; startZ = 0.1;
        }

        const positions = new Float32Array(count * 3);
        const flows = new Float32Array(count * 3);
        const phases = new Float32Array(count);

        let x = startX;
        let y = startY;
        let z = startZ;

        for (let w = 0; w < 250; w++) {
            const nx = Math.sin(a * y) - z * Math.cos(b * x);
            const ny = z * Math.sin(c * x) - Math.cos(d * y);
            const nz = Math.sin(x);
            x = nx; y = ny; z = nz;
        }

        for (let i = 0; i < count; i++) {
            const nx = Math.sin(a * y) - z * Math.cos(b * x);
            const ny = z * Math.sin(c * x) - Math.cos(d * y);
            const nz = Math.sin(x);

            const [fx, fy, fz] = normalizeVec3(nx - x, ny - y, nz - z);
            x = nx; y = ny; z = nz;

            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;
            flows[i * 3] = fx;
            flows[i * 3 + 1] = fy;
            flows[i * 3 + 2] = fz;
            phases[i] = (i % 128) / 128;
        }

        return { positions, flows, phases };
    }

    /**
     * Pattern 06: High-Order Chladni 3D Cymatic Eigenmode
     * Newton-projects stochastic points onto intersecting 3D acoustic nodal manifolds.
     */
    function genChladniEigenmode(count, rng) {
        const positions = new Float32Array(count * 3);
        const flows = new Float32Array(count * 3);
        const phases = new Float32Array(count);

        const modes = [
            [2, 3, 5, 4, 3, 2],
            [3, 5, 7, 2, 5, 3],
            [2, 5, 6, 3, 4, 5],
            [3, 4, 7, 5, 2, 6]
        ];
        const m = modes[Math.floor(rng() * modes.length)];
        const n = m[0], k = m[1], l = m[2];
        const p = m[3], q = m[4], r = m[5];
        const mix = 0.35 + rng() * 0.3;
        const PI = Math.PI;

        function evalField(x, y, z) {
            const cxn = Math.cos(n * PI * x), sxn = Math.sin(n * PI * x);
            const cyk = Math.cos(k * PI * y), syk = Math.sin(k * PI * y);
            const czl = Math.cos(l * PI * z), szl = Math.sin(l * PI * z);

            const cxk = Math.cos(k * PI * x), sxk = Math.sin(k * PI * x);
            const cyl = Math.cos(l * PI * y), syl = Math.sin(l * PI * y);
            const czn = Math.cos(n * PI * z), szn = Math.sin(n * PI * z);

            const spx = Math.sin(p * PI * x), cpx = Math.cos(p * PI * x);
            const cqy = Math.cos(q * PI * y), sqy = Math.sin(q * PI * y);
            const srz = Math.sin(r * PI * z), crz = Math.cos(r * PI * z);

            const f = cxn * cyk * czl - cxk * cyl * czn + mix * spx * cqy * srz;

            const gx = PI * (-n * sxn * cyk * czl + k * sxk * cyl * czn + mix * p * cpx * cqy * srz);
            const gy = PI * (-k * cxn * syk * czl + l * cxk * syl * czn - mix * q * spx * sqy * srz);
            const gz = PI * (-l * cxn * cyk * szl + n * cxk * cyl * szn + mix * r * spx * cqy * crz);

            return [f, gx, gy, gz];
        }

        let idx = 0;
        let attempts = 0;
        while (idx < count && attempts < count * 20) {
            attempts++;
            // Uniform point inside sphere of radius 1.0
            let x = (rng() * 2 - 1) * 0.95;
            let y = (rng() * 2 - 1) * 0.95;
            let z = (rng() * 2 - 1) * 0.95;
            if (x * x + y * y + z * z > 1.0) continue;

            // Project onto nodal surface F(x,y,z) = 0
            let lastGx = 0, lastGy = 1, lastGz = 0, lastF = 1;
            for (let it = 0; it < 9; it++) {
                const [f, gx, gy, gz] = evalField(x, y, z);
                lastF = f; lastGx = gx; lastGy = gy; lastGz = gz;
                const g2 = gx * gx + gy * gy + gz * gz + 1e-4;
                const step = clamp(f / g2, -0.15, 0.15);
                x -= step * gx;
                y -= step * gy;
                z -= step * gz;
            }

            const rad2 = x * x + y * y + z * z;
            if (Math.abs(lastF) < 0.045 && rad2 < 1.15 && rad2 > 0.01) {
                positions[idx * 3] = x;
                positions[idx * 3 + 1] = y;
                positions[idx * 3 + 2] = z;

                // Flow tangent lies on the nodal surface: cross(grad, radial)
                const tx = lastGy * z - lastGz * y;
                const ty = lastGz * x - lastGx * z;
                const tz = lastGx * y - lastGy * x;
                const [fx, fy, fz] = normalizeVec3(tx, ty, tz, -z, 0, x);
                flows[idx * 3] = fx;
                flows[idx * 3 + 1] = fy;
                flows[idx * 3 + 2] = fz;
                phases[idx] = Math.sqrt(rad2);
                idx++;
            }
        }

        // Safety fill if fewer than count converged
        while (idx < count) {
            const copy = Math.floor(rng() * Math.max(1, idx));
            positions[idx * 3] = positions[copy * 3] + (rng() - 0.5) * 0.02;
            positions[idx * 3 + 1] = positions[copy * 3 + 1] + (rng() - 0.5) * 0.02;
            positions[idx * 3 + 2] = positions[copy * 3 + 2] + (rng() - 0.5) * 0.02;
            flows[idx * 3] = flows[copy * 3];
            flows[idx * 3 + 1] = flows[copy * 3 + 1];
            flows[idx * 3 + 2] = flows[copy * 3 + 2];
            phases[idx] = phases[copy];
            idx++;
        }

        return { positions, flows, phases };
    }

    /**
     * Center cloud at centroid, scale robustly into ~[-1, 1], and compute radial/curl scatter directions.
     */
    function normalizeAndBuildScatter(positions, flows, count, rng) {
        let mx = 0, my = 0, mz = 0;
        for (let i = 0; i < count; i++) {
            mx += positions[i * 3];
            my += positions[i * 3 + 1];
            mz += positions[i * 3 + 2];
        }
        mx /= count; my /= count; mz /= count;

        const radii = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const x = positions[i * 3] - mx;
            const y = positions[i * 3 + 1] - my;
            const z = positions[i * 3 + 2] - mz;
            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;
            radii[i] = Math.hypot(x, y, z);
        }

        // Scale using 94th percentile radius so single far tails don't shrink the structure
        const sorted = Float32Array.from(radii).sort();
        const refRadius = sorted[Math.floor(count * 0.94)] || 1.0;
        const invScale = 1.02 / refRadius;

        const scatter = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            let x = positions[i * 3] * invScale;
            let y = positions[i * 3 + 1] * invScale;
            let z = positions[i * 3 + 2] * invScale;

            // Enforce subtle hollow core so points do not congregate at the dead origin (0,0,0)
            const r = Math.hypot(x, y, z);
            if (r < 0.28) {
                const push = (0.28 + r * 0.45) / Math.max(r, 1e-4);
                x *= push;
                y *= push;
                z *= push;
            }

            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;

            // Random 3D unit vector blended with cross(flow, radial) for organic filament dispersion
            const th = rng() * Math.PI * 2;
            const ph = Math.acos(2 * rng() - 1);
            const rx = Math.sin(ph) * Math.cos(th);
            const ry = Math.sin(ph) * Math.sin(th);
            const rz = Math.cos(ph);

            const fx = flows[i * 3], fy = flows[i * 3 + 1], fz = flows[i * 3 + 2];
            const bx = fy * z - fz * y;
            const by = fz * x - fx * z;
            const bz = fx * y - fy * x;
            const [sx, sy, sz] = normalizeVec3(rx * 0.72 + bx * 0.55, ry * 0.72 + by * 0.55, rz * 0.72 + bz * 0.55);

            // Magnitude weighting gives dense filament core + wispy outlier halo as Spread grows
            const mag = 0.25 + Math.pow(rng(), 1.6) * 1.15;
            scatter[i * 3] = sx * mag;
            scatter[i * 3 + 1] = sy * mag;
            scatter[i * 3 + 2] = sz * mag;
        }

        return scatter;
    }

    /**
     * Builds O(1) spatial hash grid to populate tightNeighbors (flow-aligned surface chords)
     * and arcNeighbors (medium-range non-origin-crossing chords) without GC allocations.
     */
    function buildNeighborGraph(positions, flows, count, rng) {
        const GRID = 12;
        const CELLS = GRID * GRID * GRID;
        const cellHead = new Int32Array(CELLS).fill(-1);
        const cellNext = new Int32Array(count);

        const cellOf = (v) => clamp(Math.floor(((v + 1.25) / 2.5) * GRID), 0, GRID - 1);

        for (let i = 0; i < count; i++) {
            const gx = cellOf(positions[i * 3]);
            const gy = cellOf(positions[i * 3 + 1]);
            const gz = cellOf(positions[i * 3 + 2]);
            const c = (gz * GRID + gy) * GRID + gx;
            cellNext[i] = cellHead[c];
            cellHead[c] = i;
        }

        const tightNeighbors = new Uint16Array(count * TIGHT_K);
        const arcNeighbors = new Uint16Array(count * ARC_K);

        // Pre-allocated flat scratch buffers to eliminate per-node GC allocations
        const MAX_CANDS = 32;
        const candIds = new Int32Array(MAX_CANDS);
        const candDots = new Float32Array(MAX_CANDS);
        const fallbackIds = new Int32Array(MAX_CANDS);

        for (let i = 0; i < count; i++) {
            const px = positions[i * 3];
            const py = positions[i * 3 + 1];
            const pz = positions[i * 3 + 2];
            const fx = flows[i * 3];
            const fy = flows[i * 3 + 1];
            const fz = flows[i * 3 + 2];
            const gx = cellOf(px);
            const gy = cellOf(py);
            const gz = cellOf(pz);

            let candCount = 0;
            let fallbackCount = 0;

            // Gather local candidates in 3x3x3 neighborhood via flat linked list
            for (let dz = -1; dz <= 1 && candCount < 28; dz++) {
                const cz = gz + dz;
                if (cz < 0 || cz >= GRID) continue;
                for (let dy = -1; dy <= 1 && candCount < 28; dy++) {
                    const cy = gy + dy;
                    if (cy < 0 || cy >= GRID) continue;
                    for (let dx = -1; dx <= 1 && candCount < 28; dx++) {
                        const cx = gx + dx;
                        if (cx < 0 || cx >= GRID) continue;
                        let j = cellHead[(cz * GRID + cy) * GRID + cx];
                        while (j !== -1 && candCount < 28) {
                            if (j !== i) {
                                const qx = positions[j * 3];
                                const qy = positions[j * 3 + 1];
                                const qz = positions[j * 3 + 2];
                                const ddx = qx - px;
                                const ddy = qy - py;
                                const ddz = qz - pz;
                                const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
                                if (d2 >= 0.0025 && d2 <= 0.085) {
                                    // Reject chords whose midpoint cuts through the center (0,0,0)
                                    const mx = (px + qx) * 0.5;
                                    const my = (py + qy) * 0.5;
                                    const mz = (pz + qz) * 0.5;
                                    const midR2 = mx * mx + my * my + mz * mz;
                                    if (midR2 > 0.05) {
                                        const invLen = 1.0 / Math.sqrt(d2);
                                        const dot = (ddx * fx + ddy * fy + ddz * fz) * invLen;
                                        if (dot > -0.15) {
                                            candIds[candCount] = j;
                                            candDots[candCount] = dot;
                                            candCount++;
                                        } else if (fallbackCount < MAX_CANDS) {
                                            fallbackIds[fallbackCount++] = j;
                                        }
                                    }
                                }
                            }
                            j = cellNext[j];
                        }
                    }
                }
            }

            // Sort flow-aligned candidates descending so rapid bursts trace crisp filaments
            for (let a = 1; a < candCount; a++) {
                const idA = candIds[a];
                const dotA = candDots[a];
                let b = a - 1;
                while (b >= 0 && candDots[b] < dotA) {
                    candIds[b + 1] = candIds[b];
                    candDots[b + 1] = candDots[b];
                    b--;
                }
                candIds[b + 1] = idA;
                candDots[b + 1] = dotA;
            }

            const tightOffset = i * TIGHT_K;
            let filled = 0;

            if (candCount >= TIGHT_K) {
                const pool = Math.min(candCount, TIGHT_K + 8);
                for (let k = 0; k < TIGHT_K; k++) {
                    const pick = k < 4 ? k : Math.floor(rng() * pool);
                    tightNeighbors[tightOffset + k] = candIds[pick];
                }
                filled = TIGHT_K;
            } else {
                for (let k = 0; k < candCount && filled < TIGHT_K; k++) {
                    tightNeighbors[tightOffset + filled++] = candIds[k];
                }
                for (let k = 0; k < fallbackCount && filled < TIGHT_K; k++) {
                    tightNeighbors[tightOffset + filled++] = fallbackIds[k];
                }
                while (filled < TIGHT_K) {
                    let bestJ = (i + 1 + filled) % count;
                    let bestD = 1e9;
                    for (let probe = 0; probe < 10; probe++) {
                        const j = Math.floor(rng() * count);
                        if (j === i) continue;
                        const qx = positions[j * 3];
                        const qy = positions[j * 3 + 1];
                        const qz = positions[j * 3 + 2];
                        const d2 = (qx - px) ** 2 + (qy - py) ** 2 + (qz - pz) ** 2;
                        const mx = (px + qx) * 0.5;
                        const my = (py + qy) * 0.5;
                        const mz = (pz + qz) * 0.5;
                        const midR2 = mx * mx + my * my + mz * mz;
                        if (d2 > 0.0025 && midR2 > 0.05 && d2 < bestD) {
                            bestD = d2;
                            bestJ = j;
                        }
                    }
                    tightNeighbors[tightOffset + filled++] = bestJ;
                }
            }

            // Populate medium-range surface chords (d2 in [0.09, 0.45], midR2 > 0.14)
            const arcOffset = i * ARC_K;
            for (let k = 0; k < ARC_K; k++) {
                let chosen = -1;
                let fallbackBest = (i + 13 + k * 7) % count;
                let fallbackScore = -1e9;
                for (let probe = 0; probe < 10; probe++) {
                    const j = Math.floor(rng() * count);
                    if (j === i) continue;
                    const qx = positions[j * 3];
                    const qy = positions[j * 3 + 1];
                    const qz = positions[j * 3 + 2];
                    const d2 = (qx - px) ** 2 + (qy - py) ** 2 + (qz - pz) ** 2;
                    const mx = (px + qx) * 0.5;
                    const my = (py + qy) * 0.5;
                    const mz = (pz + qz) * 0.5;
                    const midR2 = mx * mx + my * my + mz * mz;
                    if (d2 >= 0.09 && d2 <= 0.45 && midR2 > 0.14) {
                        chosen = j;
                        break;
                    }
                    const score = midR2 - Math.abs(d2 - 0.22);
                    if (score > fallbackScore) {
                        fallbackScore = score;
                        fallbackBest = j;
                    }
                }
                arcNeighbors[arcOffset + k] = chosen >= 0 ? chosen : fallbackBest;
            }
        }

        return { tightNeighbors, arcNeighbors };
    }

    const PATTERNS = [
        {
            id: 'lorenz',
            code: '01',
            name: 'LORENZ–RÖSSLER CHAOS',
            equation: 'ẋ = σ(y−x) − εz,  ẏ = x(ρ−z)−y,  ż = xy−βz',
            generate: genLorenzRossler
        },
        {
            id: 'aizawa',
            code: '02',
            name: 'AIZAWA FLUX MANIFOLD',
            equation: 'ż = c + az − z³/3 − (x²+y²)(1+ez) + fzx³',
            generate: genAizawaFlux
        },
        {
            id: 'hopf',
            code: '03',
            name: 'HOPF 4D FIBRATION',
            equation: 'S¹ ↪ S³(ℂ²) → S²,  π⁻¹(p) ⊂ ℝ⁴ ↦ ℝ³',
            generate: genHopfFibration
        },
        {
            id: 'curl',
            code: '04',
            name: 'CURL DENDRITE FILAMENTS',
            equation: 'v(x) = ∇ × Ψ(x),  ∇ · v ≡ 0  (4-OCTAVE)',
            generate: genCurlFilaments
        },
        {
            id: 'clifford',
            code: '05',
            name: 'PICKOVER CAUSTIC FOLD',
            equation: 'xₙ₊₁ = sin(ayₙ) − zₙcos(bxₙ),  zₙ₊₁ = sin(xₙ)',
            generate: genCliffordCaustics
        },
        {
            id: 'chladni',
            code: '06',
            name: 'CHLADNI CYMATIC EIGENMODE',
            equation: 'cos(nπx)cos(kπy)cos(lπz) − cos(kπx)cos(lπy)cos(nπz) = 0',
            generate: genChladniEigenmode
        }
    ];

    function buildPattern(patternId, seed) {
        const meta = PATTERNS.find((p) => p.id === patternId) || PATTERNS[0];
        const rng = createRng(seed);
        const { positions, flows, phases } = meta.generate(POINT_COUNT, rng);
        const scatter = normalizeAndBuildScatter(positions, flows, POINT_COUNT, rng);
        const { tightNeighbors, arcNeighbors } = buildNeighborGraph(positions, flows, POINT_COUNT, rng);

        return {
            meta,
            seed,
            count: POINT_COUNT,
            tightK: TIGHT_K,
            arcK: ARC_K,
            basePositions: positions,
            scatterDirs: scatter,
            flowDirs: flows,
            phases,
            tightNeighbors,
            arcNeighbors
        };
    }

    global.KLSRPatterns = {
        PATTERNS,
        POINT_COUNT,
        TIGHT_K,
        ARC_K,
        buildPattern
    };
})(window);
