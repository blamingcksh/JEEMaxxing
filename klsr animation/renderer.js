/**
 * KLSR // WebGL2 HDR Optical Laser & Bloom Renderer
 * Pipeline:
 *   1. Scene Pass (RGBA16F): Additive instanced AA laser segments + excited node stars + photon flares
 *   2. Phosphor Trail Pass (RGBA16F ping-pong): Frame-rate independent exponential persistence
 *   3. 5-Level HDR Bloom Pyramid: Soft-knee threshold + Kawase/Tent downsample & additive upsample
 *   4. Filmic Composite Pass: Chromatic micro-dispersion + ACES Filmic Tone Mapping + sensor grain
 */
(function (global) {
    'use strict';

    const FULLSCREEN_VERT = `#version 300 es
    precision highp float;
    const vec2 POS[3] = vec2[3](
        vec2(-1.0, -1.0),
        vec2( 3.0, -1.0),
        vec2(-1.0,  3.0)
    );
    out vec2 vUv;
    void main() {
        vec2 p = POS[gl_VertexID];
        vUv = p * 0.5 + 0.5;
        gl_Position = vec4(p, 0.0, 1.0);
    }`;

    const BEAM_VERT = `#version 300 es
    precision highp float;

    layout(location = 0) in vec2 aQuad;       // x in [0,1], y in [-1,1]
    layout(location = 1) in vec3 aP0;
    layout(location = 2) in vec3 aP1;
    layout(location = 3) in float aEnergy;
    layout(location = 4) in float aWidth;
    layout(location = 5) in float aTint;

    uniform mat4 uViewProj;
    uniform vec2 uResolution;
    uniform float uDpr;
    uniform float uLuminescence;

    out vec2 vLocal;
    out float vSegLen;
    out float vHalfPx;
    out float vEnergy;
    out float vWidth;
    out float vTint;
    out float vDepth;
    out float vAlong;

    void main() {
        vec4 c0 = uViewProj * vec4(aP0, 1.0);
        vec4 c1 = uViewProj * vec4(aP1, 1.0);

        // Cull segments behind camera near plane
        if (c0.w <= 0.08 || c1.w <= 0.08) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            vEnergy = 0.0;
            return;
        }

        vec2 ndc0 = c0.xy / c0.w;
        vec2 ndc1 = c1.xy / c1.w;
        vec2 halfRes = uResolution * 0.5;
        vec2 px0 = ndc0 * halfRes;
        vec2 px1 = ndc1 * halfRes;

        vec2 delta = px1 - px0;
        float segLen = length(delta);
        vec2 dir = segLen > 0.001 ? delta / segLen : vec2(1.0, 0.0);
        vec2 norm = vec2(-dir.y, dir.x);

        float lumScale = 0.72 + 0.38 * uLuminescence;
        float halfPx = (1.35 + aWidth * (1.1 + aEnergy * 1.8) * lumScale) * uDpr;
        float ext = (aQuad.x * 2.0 - 1.0) * halfPx;

        vec2 posPx = mix(px0, px1, aQuad.x) + dir * ext + norm * (aQuad.y * halfPx);
        vec2 outNdc = posPx / halfRes;

        gl_Position = vec4(outNdc, 0.0, 1.0);

        vLocal = vec2(aQuad.x * segLen + ext, aQuad.y * halfPx);
        vSegLen = segLen;
        vHalfPx = halfPx;
        vEnergy = aEnergy;
        vWidth = aWidth;
        vTint = aTint;
        vDepth = mix(c0.w, c1.w, aQuad.x);
        vAlong = aQuad.x;
    }`;

    const BEAM_FRAG = `#version 300 es
    precision highp float;

    in vec2 vLocal;
    in float vSegLen;
    in float vHalfPx;
    in float vEnergy;
    in float vWidth;
    in float vTint;
    in float vDepth;
    in float vAlong;

    uniform float uDpr;
    uniform float uLuminescence;
    uniform vec3 uColorCore;
    uniform vec3 uColorEdge;
    uniform vec3 uColorAccent;

    out vec4 fragColor;

    void main() {
        if (vEnergy <= 0.002) discard;

        float cx = clamp(vLocal.x, 0.0, vSegLen);
        float distPx = length(vec2(vLocal.x - cx, vLocal.y)) / max(uDpr, 1.0);

        float coreSigma = 0.28 + vWidth * (0.24 + vEnergy * 0.22);
        float haloSigma = 0.85 + vWidth * (0.95 + uLuminescence * 0.55);

        float core = exp(-(distPx * distPx) / (coreSigma * coreSigma));
        float halo = exp(-distPx / haloSigma);

        // Head-to-tail energy taper along each segment
        float tipBoost = mix(0.55, 1.45, smoothstep(0.0, 1.0, vAlong));
        float energyPow = pow(vEnergy, 1.28) * tipBoost;

        // Perspective depth attenuation
        float depthAtten = clamp(3.3 / max(vDepth, 0.9), 0.38, 1.35);

        vec3 tintCol = mix(uColorEdge, uColorAccent, clamp(vTint, 0.0, 1.0));
        vec3 col = (uColorCore * core * 2.8 + tintCol * halo * 0.24) * energyPow * uLuminescence * depthAtten;

        fragColor = vec4(col, 1.0);
    }`;

    const NODE_VERT = `#version 300 es
    precision highp float;

    layout(location = 0) in vec3 aPos;
    layout(location = 1) in float aFlash;
    layout(location = 2) in float aPhase;

    uniform mat4 uViewProj;
    uniform float uDpr;
    uniform float uLuminescence;
    uniform float uDormantAlpha;

    out float vFlash;
    out float vPhase;
    out float vDepth;

    void main() {
        vec4 clip = uViewProj * vec4(aPos, 1.0);
        if (clip.w <= 0.08) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 0.0;
            vFlash = 0.0;
            return;
        }
        gl_Position = clip;
        float distScale = clamp(2.8 / clip.w, 0.45, 2.1);
        float baseSize = 1.8 + uDormantAlpha * 10.0;
        float flashSize = aFlash * (9.5 + uLuminescence * 4.5);
        gl_PointSize = (baseSize + flashSize) * distScale * uDpr;
        vFlash = aFlash;
        vPhase = aPhase;
        vDepth = clip.w;
    }`;

    const NODE_FRAG = `#version 300 es
    precision highp float;

    in float vFlash;
    in float vPhase;
    in float vDepth;

    uniform float uLuminescence;
    uniform float uDormantAlpha;
    uniform vec3 uColorCore;
    uniform vec3 uColorEdge;
    uniform vec3 uColorAccent;

    out vec4 fragColor;

    void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(uv, uv);
        if (r2 > 1.0) discard;
        float r = sqrt(r2);

        float depthAtten = clamp(3.2 / max(vDepth, 0.9), 0.35, 1.3);
        vec3 baseCol = mix(uColorEdge, uColorAccent, fract(vPhase * 1.73));

        // Dormant manifold speck (whisper-minimal pinpoint)
        float dormant = exp(-r2 * 8.5) * uDormantAlpha * 0.45;

        // Excited capacitor flash + razor-sharp optical diffraction cross
        float spikeCore = exp(-r2 * 22.0);
        float spikeHalo = exp(-r * 5.2);
        float crossGlint = (exp(-abs(uv.x) * 28.0) + exp(-abs(uv.y) * 28.0)) * exp(-r * 4.4) * 0.42;

        float flashStrength = pow(vFlash, 1.35) * (1.8 + uLuminescence * 2.1);
        vec3 col = baseCol * dormant +
            (uColorCore * (spikeCore * 2.4 + crossGlint) + baseCol * spikeHalo * 0.85) * flashStrength;

        fragColor = vec4(col * depthAtten, 1.0);
    }`;

    const PERSIST_FRAG = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uSceneTex;
    uniform sampler2D uPrevTrailTex;
    uniform float uDecay;
    out vec4 fragColor;

    void main() {
        vec3 scene = texture(uSceneTex, vUv).rgb;
        vec3 prev = texture(uPrevTrailTex, vUv).rgb * uDecay;
        // Soft highlight compression on accumulated trail prevents center whiteout
        vec3 trailCompressed = prev / (1.0 + max(prev.r, max(prev.g, prev.b)) * 0.22);
        vec3 combined = trailCompressed + scene;
        fragColor = vec4(min(combined, vec3(12.0)), 1.0);
    }`;

    const THRESHOLD_FRAG = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uTex;
    uniform vec2 uTexelSize;
    uniform float uThreshold;
    uniform float uKnee;
    out vec4 fragColor;

    vec3 sampleSoft(vec2 uv) {
        vec3 c = texture(uTex, uv).rgb;
        float br = max(c.r, max(c.g, c.b));
        float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
        soft = (soft * soft) / (4.0 * uKnee + 1e-5);
        float contrib = max(soft, br - uThreshold) / max(br, 1e-5);
        return c * max(contrib, 0.0);
    }

    void main() {
        vec2 d = uTexelSize;
        vec3 s = sampleSoft(vUv) * 0.4;
        s += sampleSoft(vUv + vec2(-d.x, -d.y)) * 0.15;
        s += sampleSoft(vUv + vec2( d.x, -d.y)) * 0.15;
        s += sampleSoft(vUv + vec2(-d.x,  d.y)) * 0.15;
        s += sampleSoft(vUv + vec2( d.x,  d.y)) * 0.15;
        fragColor = vec4(s, 1.0);
    }`;

    const DOWNSAMPLE_FRAG = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uTex;
    uniform vec2 uTexelSize;
    out vec4 fragColor;

    void main() {
        vec2 d = uTexelSize;
        // Fast 5-tap Dual-Kawase downsample filter
        vec3 sum = texture(uTex, vUv).rgb * 0.5;
        sum += texture(uTex, vUv + vec2(-d.x, -d.y)).rgb * 0.125;
        sum += texture(uTex, vUv + vec2( d.x, -d.y)).rgb * 0.125;
        sum += texture(uTex, vUv + vec2(-d.x,  d.y)).rgb * 0.125;
        sum += texture(uTex, vUv + vec2( d.x,  d.y)).rgb * 0.125;
        fragColor = vec4(sum, 1.0);
    }`;

    const UPSAMPLE_FRAG = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform sampler2D uTex;
    uniform vec2 uTexelSize;
    uniform float uRadius;
    out vec4 fragColor;

    void main() {
        vec2 d = uTexelSize * uRadius;
        // Fast 4-tap bilinear tent/Kawase upsample
        vec3 sum = texture(uTex, vUv + vec2(-d.x, -d.y)).rgb;
        sum += texture(uTex, vUv + vec2( d.x, -d.y)).rgb;
        sum += texture(uTex, vUv + vec2(-d.x,  d.y)).rgb;
        sum += texture(uTex, vUv + vec2( d.x,  d.y)).rgb;
        fragColor = vec4(sum * 0.25, 1.0);
    }`;

    const COMPOSITE_FRAG = `#version 300 es
    precision highp float;
    in vec2 vUv;

    uniform sampler2D uTrailTex;
    uniform sampler2D uBloomTex;
    uniform float uBloomStrength;
    uniform float uLuminescence;
    uniform float uTime;
    uniform vec2 uResolution;

    out vec4 fragColor;

    vec3 acesToneMap(vec3 x) {
        const float a = 2.51;
        const float b = 0.03;
        const float c = 2.43;
        const float d = 0.59;
        const float e = 0.14;
        return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
        vec2 centered = vUv - 0.5;
        float r2 = dot(centered, centered);

        // Whisper-subtle optical edge chromatic dispersion on intense bursts
        vec2 disp = centered * (0.0014 * uLuminescence * (0.4 + r2));
        float r = texture(uTrailTex, vUv + disp).r;
        float g = texture(uTrailTex, vUv).g;
        float b = texture(uTrailTex, vUv - disp).b;
        vec3 sharp = vec3(r, g, b);

        vec3 bloom = texture(uBloomTex, vUv).rgb;

        // Combine HDR layers
        vec3 hdr = sharp + bloom * uBloomStrength;

        // Subtle deep obsidian background void gradient + vignette
        float vig = 1.0 - smoothstep(0.32, 1.15, r2 * 1.45);
        hdr *= mix(0.65, 1.0, vig);
        hdr += vec3(0.0022, 0.0026, 0.0042) * vig;

        vec3 mapped = acesToneMap(hdr);
        // Gamma encode to sRGB
        vec3 srgb = pow(mapped, vec3(1.0 / 2.2));

        // Ultra-fine optical sensor grain prevents 8-bit shadow banding
        float grain = (hash12(gl_FragCoord.xy + fract(uTime * 17.3) * 193.0) - 0.5) * 0.011;
        srgb = clamp(srgb + grain, 0.0, 1.0);

        fragColor = vec4(srgb, 1.0);
    }`;

    function compileShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('Shader compile error: ' + log);
        }
        return shader;
    }

    function createProgram(gl, vsSrc, fsSrc) {
        const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error('Program link error: ' + gl.getProgramInfoLog(prog));
        }
        return prog;
    }

    function getUniforms(gl, prog, names) {
        const map = {};
        for (const n of names) {
            map[n] = gl.getUniformLocation(prog, n);
        }
        return map;
    }

    function createRenderTarget(gl, width, height, useFloat) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        if (useFloat) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return { fbo, tex, width, height };
    }

    function destroyRenderTarget(gl, rt) {
        if (!rt) return;
        gl.deleteFramebuffer(rt.fbo);
        gl.deleteTexture(rt.tex);
    }

    const SPECTRUMS = {
        xenon: {
            name: 'XENON WHITE',
            core: [1.0, 0.995, 0.985],
            edge: [0.58, 0.82, 1.0],
            accent: [0.85, 0.92, 1.0]
        },
        silver: {
            name: 'ION SILVER',
            core: [0.97, 0.98, 1.0],
            edge: [0.46, 0.56, 0.98],
            accent: [0.72, 0.62, 1.0]
        },
        amber: {
            name: 'AMBER ARC',
            core: [1.0, 0.96, 0.88],
            edge: [1.0, 0.54, 0.16],
            accent: [1.0, 0.78, 0.36]
        },
        uv: {
            name: 'UV LASER',
            core: [0.99, 0.95, 1.0],
            edge: [0.64, 0.32, 1.0],
            accent: [0.34, 0.86, 1.0]
        }
    };

    class KLSRRenderer {
        constructor(canvas, maxSegments, nodeCount) {
            this.canvas = canvas;
            this.maxSegments = maxSegments;
            this.nodeCount = nodeCount;

            const gl = canvas.getContext('webgl2', {
                alpha: false,
                antialias: false,
                depth: false,
                stencil: false,
                powerPreference: 'high-performance',
                preserveDrawingBuffer: false
            });
            if (!gl) {
                throw new Error('WebGL2 is required for KLSR HDR Light Renderer.');
            }
            this.gl = gl;

            // Enable RGBA16F render targets for authentic HDR intensity
            const extFloat = gl.getExtension('EXT_color_buffer_float');
            const extHalf = gl.getExtension('EXT_color_buffer_half_float');
            this.useFloat = Boolean(extFloat || extHalf);
            this.hdrEnabled = this.useFloat;

            this.width = 1;
            this.height = 1;
            this.dpr = 1;
            this.trailIdx = 0;

            this._initShaders();
            this._initBuffers();
            this.resize();
        }

        _initShaders() {
            const gl = this.gl;

            this.beamProg = createProgram(gl, BEAM_VERT, BEAM_FRAG);
            this.beamU = getUniforms(gl, this.beamProg, [
                'uViewProj', 'uResolution', 'uDpr', 'uLuminescence',
                'uColorCore', 'uColorEdge', 'uColorAccent'
            ]);

            this.nodeProg = createProgram(gl, NODE_VERT, NODE_FRAG);
            this.nodeU = getUniforms(gl, this.nodeProg, [
                'uViewProj', 'uDpr', 'uLuminescence', 'uDormantAlpha',
                'uColorCore', 'uColorEdge', 'uColorAccent'
            ]);

            this.persistProg = createProgram(gl, FULLSCREEN_VERT, PERSIST_FRAG);
            this.persistU = getUniforms(gl, this.persistProg, ['uSceneTex', 'uPrevTrailTex', 'uDecay']);

            this.threshProg = createProgram(gl, FULLSCREEN_VERT, THRESHOLD_FRAG);
            this.threshU = getUniforms(gl, this.threshProg, ['uTex', 'uTexelSize', 'uThreshold', 'uKnee']);

            this.downProg = createProgram(gl, FULLSCREEN_VERT, DOWNSAMPLE_FRAG);
            this.downU = getUniforms(gl, this.downProg, ['uTex', 'uTexelSize']);

            this.upProg = createProgram(gl, FULLSCREEN_VERT, UPSAMPLE_FRAG);
            this.upU = getUniforms(gl, this.upProg, ['uTex', 'uTexelSize', 'uRadius']);

            this.compProg = createProgram(gl, FULLSCREEN_VERT, COMPOSITE_FRAG);
            this.compU = getUniforms(gl, this.compProg, [
                'uTrailTex', 'uBloomTex', 'uBloomStrength', 'uLuminescence', 'uTime', 'uResolution'
            ]);
        }

        _initBuffers() {
            const gl = this.gl;

            this.emptyVao = gl.createVertexArray();

            // Instanced laser segments VAO
            this.beamVao = gl.createVertexArray();
            gl.bindVertexArray(this.beamVao);

            // Base quad (x in [0,1], y in [-1,1]) as 2 triangles (4 verts strip)
            const quadVerts = new Float32Array([
                0, -1,
                1, -1,
                0,  1,
                1,  1
            ]);
            this.quadVbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
            gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

            // Interleaved per-instance float buffer: [p0x, p0y, p0z, p1x, p1y, p1z, energy, width, tint] = 9 floats
            this.instanceStrideFloats = 9;
            this.instanceData = new Float32Array(this.maxSegments * this.instanceStrideFloats);
            this.instanceVbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
            gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);

            const strideBytes = this.instanceStrideFloats * 4;
            gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(1, 3, gl.FLOAT, false, strideBytes, 0);
            gl.vertexAttribDivisor(1, 1);

            gl.enableVertexAttribArray(2);
            gl.vertexAttribPointer(2, 3, gl.FLOAT, false, strideBytes, 12);
            gl.vertexAttribDivisor(2, 1);

            gl.enableVertexAttribArray(3);
            gl.vertexAttribPointer(3, 1, gl.FLOAT, false, strideBytes, 24);
            gl.vertexAttribDivisor(3, 1);

            gl.enableVertexAttribArray(4);
            gl.vertexAttribPointer(4, 1, gl.FLOAT, false, strideBytes, 28);
            gl.vertexAttribDivisor(4, 1);

            gl.enableVertexAttribArray(5);
            gl.vertexAttribPointer(5, 1, gl.FLOAT, false, strideBytes, 32);
            gl.vertexAttribDivisor(5, 1);

            // Node points VAO (pos + flash + phase)
            this.nodeVao = gl.createVertexArray();
            gl.bindVertexArray(this.nodeVao);

            this.nodePosVbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.nodePosVbo);
            gl.bufferData(gl.ARRAY_BUFFER, this.nodeCount * 3 * 4, gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

            this.nodeFlashVbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeFlashVbo);
            gl.bufferData(gl.ARRAY_BUFFER, this.nodeCount * 4, gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(1);
            gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);

            this.nodePhaseVbo = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.nodePhaseVbo);
            gl.bufferData(gl.ARRAY_BUFFER, this.nodeCount * 4, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(2);
            gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

            gl.bindVertexArray(null);
        }

        resize() {
            const gl = this.gl;
            this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
            const w = Math.max(2, Math.floor(window.innerWidth * this.dpr));
            const h = Math.max(2, Math.floor(window.innerHeight * this.dpr));
            if (w === this.width && h === this.height && this.sceneFBO) return;

            this.width = w;
            this.height = h;
            this.canvas.width = w;
            this.canvas.height = h;

            destroyRenderTarget(gl, this.sceneFBO);
            destroyRenderTarget(gl, this.trailFBOs?.[0]);
            destroyRenderTarget(gl, this.trailFBOs?.[1]);
            if (this.bloomMips) {
                this.bloomMips.forEach((m) => destroyRenderTarget(gl, m));
            }

            this.sceneFBO = createRenderTarget(gl, w, h, this.useFloat);
            this.trailFBOs = [
                createRenderTarget(gl, w, h, this.useFloat),
                createRenderTarget(gl, w, h, this.useFloat)
            ];

            // Clear trail buffers cleanly on resize
            for (let i = 0; i < 2; i++) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFBOs[i].fbo);
                gl.viewport(0, 0, w, h);
                gl.clearColor(0, 0, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }

            // 4-level HDR bloom mip pyramid
            this.bloomMips = [];
            let bw = w;
            let bh = h;
            for (let level = 0; level < 4; level++) {
                bw = Math.max(2, bw >> 1);
                bh = Math.max(2, bh >> 1);
                this.bloomMips.push(createRenderTarget(gl, bw, bh, this.useFloat));
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }

        clearTrails() {
            const gl = this.gl;
            for (let i = 0; i < 2; i++) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFBOs[i].fbo);
                gl.viewport(0, 0, this.width, this.height);
                gl.clearColor(0, 0, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }

        uploadPhases(phases) {
            const gl = this.gl;
            gl.bindBuffer(gl.ARRAY_BUFFER, this.nodePhaseVbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, phases);
        }

        uploadNodePositions(nodePositions) {
            const gl = this.gl;
            gl.bindBuffer(gl.ARRAY_BUFFER, this.nodePosVbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, nodePositions);
        }

        render(params) {
            const {
                viewProj,
                nodeFlashes,
                segmentCount,
                luminescence,
                persistence,
                dormantAlpha,
                spectrumId,
                time,
                dt
            } = params;

            const gl = this.gl;
            const spec = SPECTRUMS[spectrumId] || SPECTRUMS.xenon;

            // 1. Scene HDR Pass (additive lines + point cloud stars)
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO.fbo);
            gl.viewport(0, 0, this.width, this.height);
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE);

            // Upload only dynamic node flash intensities each frame (positions uploaded on change)
            gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeFlashVbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, nodeFlashes);

            gl.useProgram(this.nodeProg);
            gl.uniformMatrix4fv(this.nodeU.uViewProj, false, viewProj);
            gl.uniform1f(this.nodeU.uDpr, this.dpr);
            gl.uniform1f(this.nodeU.uLuminescence, luminescence);
            gl.uniform1f(this.nodeU.uDormantAlpha, dormantAlpha);
            gl.uniform3fv(this.nodeU.uColorCore, spec.core);
            gl.uniform3fv(this.nodeU.uColorEdge, spec.edge);
            gl.uniform3fv(this.nodeU.uColorAccent, spec.accent);

            gl.bindVertexArray(this.nodeVao);
            gl.drawArrays(gl.POINTS, 0, this.nodeCount);

            // Draw instanced AA laser segments
            if (segmentCount > 0) {
                const count = Math.min(segmentCount, this.maxSegments);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
                gl.bufferSubData(
                    gl.ARRAY_BUFFER,
                    0,
                    this.instanceData.subarray(0, count * this.instanceStrideFloats)
                );

                gl.useProgram(this.beamProg);
                gl.uniformMatrix4fv(this.beamU.uViewProj, false, viewProj);
                gl.uniform2f(this.beamU.uResolution, this.width, this.height);
                gl.uniform1f(this.beamU.uDpr, this.dpr);
                gl.uniform1f(this.beamU.uLuminescence, luminescence);
                gl.uniform3fv(this.beamU.uColorCore, spec.core);
                gl.uniform3fv(this.beamU.uColorEdge, spec.edge);
                gl.uniform3fv(this.beamU.uColorAccent, spec.accent);

                gl.bindVertexArray(this.beamVao);
                gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
            }

            gl.disable(gl.BLEND);
            gl.bindVertexArray(this.emptyVao);

            // 2. Phosphor Persistence Ping-Pong Pass
            const srcTrail = this.trailFBOs[this.trailIdx];
            const dstTrail = this.trailFBOs[1 - this.trailIdx];
            // Frame-rate normalized persistence decay
            const frameNormDecay = Math.pow(persistence, Math.max(dt, 0.001) * 60.0);

            gl.bindFramebuffer(gl.FRAMEBUFFER, dstTrail.fbo);
            gl.viewport(0, 0, this.width, this.height);
            gl.useProgram(this.persistProg);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.sceneFBO.tex);
            gl.uniform1i(this.persistU.uSceneTex, 0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, srcTrail.tex);
            gl.uniform1i(this.persistU.uPrevTrailTex, 1);
            gl.uniform1f(this.persistU.uDecay, frameNormDecay);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            this.trailIdx = 1 - this.trailIdx;

            // 3. Multi-Scale HDR Bloom Pyramid
            const mip0 = this.bloomMips[0];
            gl.bindFramebuffer(gl.FRAMEBUFFER, mip0.fbo);
            gl.viewport(0, 0, mip0.width, mip0.height);
            gl.useProgram(this.threshProg);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, dstTrail.tex);
            gl.uniform1i(this.threshU.uTex, 0);
            gl.uniform2f(this.threshU.uTexelSize, 1.0 / this.width, 1.0 / this.height);
            // Lower threshold as luminescence grows so broad atmospheric glow blooms vividly
            gl.uniform1f(this.threshU.uThreshold, Math.max(0.18, 0.72 - luminescence * 0.16));
            gl.uniform1f(this.threshU.uKnee, 0.45);
            gl.drawArrays(gl.TRIANGLES, 0, 3);

            // Downsample 0 -> 4
            gl.useProgram(this.downProg);
            for (let i = 0; i < this.bloomMips.length - 1; i++) {
                const from = this.bloomMips[i];
                const to = this.bloomMips[i + 1];
                gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
                gl.viewport(0, 0, to.width, to.height);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, from.tex);
                gl.uniform1i(this.downU.uTex, 0);
                gl.uniform2f(this.downU.uTexelSize, 1.0 / from.width, 1.0 / from.height);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            }

            // Additive Tent Upsample 4 -> 0
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE);
            gl.useProgram(this.upProg);
            for (let i = this.bloomMips.length - 1; i > 0; i--) {
                const from = this.bloomMips[i];
                const to = this.bloomMips[i - 1];
                gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
                gl.viewport(0, 0, to.width, to.height);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, from.tex);
                gl.uniform1i(this.upU.uTex, 0);
                gl.uniform2f(this.upU.uTexelSize, 1.0 / from.width, 1.0 / from.height);
                gl.uniform1f(this.upU.uRadius, 1.05 + luminescence * 0.12);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            }
            gl.disable(gl.BLEND);

            // 4. Final ACES Filmic Composite to Screen
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, this.width, this.height);
            gl.useProgram(this.compProg);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, dstTrail.tex);
            gl.uniform1i(this.compU.uTrailTex, 0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, mip0.tex);
            gl.uniform1i(this.compU.uBloomTex, 1);
            gl.uniform1f(this.compU.uBloomStrength, 0.24 + luminescence * 0.28);
            gl.uniform1f(this.compU.uLuminescence, luminescence);
            gl.uniform1f(this.compU.uTime, time);
            gl.uniform2f(this.compU.uResolution, this.width, this.height);
            gl.drawArrays(gl.TRIANGLES, 0, 3);

            gl.bindVertexArray(null);
        }
    }

    global.KLSRRenderer = {
        KLSRRenderer,
        SPECTRUMS
    };
})(window);
