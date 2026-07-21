/* ============================================================================
   forest-juice.js v2 — isolated "juice" + growth-model + world-dressing layer.
   OPTIONAL & SAFE: augments the running scene via window.__forestAPI. If this
   file fails to load/parse/run, the base forest is UNAFFECTED. Every subsystem
   (flowers, camps, bonfires, paths, lake fireflies, sparkles, halos, swarm,
   shockwaves, growth model, sim panel) is wrapped in its own try/catch and the
   per-frame work is guarded by the main loop, so a runtime bug here can never
   freeze or blank the forest.
   Growth model:  solving  -> plants a sapling (open-ground, never stuffed)
                  studying -> grows it        (maturity -> scale + bloom pop)
                  streak   -> warms the sky
   ============================================================================ */
(function () {
  'use strict';
  if (window.__juiceInit) return; window.__juiceInit = true;

  function toast(msg) {
    console.warn('[juice]', msg);
    try {
      const d = document.createElement('div'); d.textContent = '⚠ ' + msg;
      Object.assign(d.style, { position:'fixed', left:'50%', bottom:'14px', transform:'translateX(-50%)',
        zIndex:'60', background:'rgba(20,16,8,.92)', border:'1px solid rgba(255,178,36,.4)',
        color:'#ffd9a0', padding:'8px 14px', borderRadius:'10px', font:'12px/1.4 monospace',
        maxWidth:'88vw', boxShadow:'0 8px 24px rgba(0,0,0,.6)', pointerEvents:'none' });
      document.body.appendChild(d);
      setTimeout(function(){ d.style.transition='opacity .5s'; d.style.opacity='0';
        setTimeout(function(){ if (d.parentNode) d.parentNode.removeChild(d); }, 600); }, 6000);
    } catch (_) {}
  }

  function boot() {
    const api = window.__forestAPI;
    if (!api || !api.THREE) { setTimeout(boot, 200); return; }
    try { build(api); console.log('[juice] v2 ready'); window.__forestJuiceReady = true; }
    catch (e) { toast('Forest juice skipped: ' + (e && e.message || e)); }
  }

  /* concat non/indexed geos WITHOUT the three addon (juice has no merge util) */
  function concatGeos(THREE, list) {
    list = list.map(function (g) { return g.index ? g.toNonIndexed() : g; });
    let n = 0; list.forEach(function (g) { n += g.attributes.position.count; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
    list.forEach(function (g) {
      pos.set(g.attributes.position.array, o * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
      o += g.attributes.position.count;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return g;
  }

  function build(api) {
    const THREE = api.THREE, scene = api.scene;
    const POND = api.pond || { x: -9, z: 7 };          // terrain pond basin centre

    /* ── growth-model state ── */
    const FLOOR = 0.30, STUDY_TO_FULL = 120;
    let studyMinutes = 80, streakDays = 0, bloom = 0, bloomedFull = false;
    const recentGrown = [];
    function maturity() { return Math.min(1, Math.sqrt(Math.max(0, studyMinutes) / STUDY_TO_FULL)); }

    /* ── shared glow sprite ── */
    function glowTex() {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.75)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    }
    const sprite = glowTex();
    const _d = new THREE.Object3D(), _dh = new THREE.Object3D();
    const meshesById = {};
    for (let i = 0; i < api.trees.length; i++) { const m = api.trees[i].mesh; if (m) meshesById[m.id] = m; }

    function writeTree(t, g, cur) {
      const gf = FLOOR + (1 - FLOOR) * g, bm = 1 + 0.16 * bloom;
      const sc = Math.max(0.0001, t.baseScale * cur * gf * bm);
      _d.position.set(t.x, t.y - 0.06, t.z); _d.rotation.set(t.leanX || 0, t.rot || 0, t.leanZ || 0);
      _d.scale.set((t.sxz || 1) * sc, (t.sy || 1) * sc, (t.sxz || 1) * sc); _d.updateMatrix();
      t.mesh.setMatrixAt(t.iid, _d.matrix);
    }

    /* night factor from the time-of-day slider (0=day .. 1=night) */
    function nightFactor() {
      try { const el = document.getElementById('tod'); if (!el) return 0; const t = (+el.value) / 100;
        if (isNaN(t)) return 0; return Math.max(0, Math.min(1, Math.abs(t - 0.5) * 2)); } catch (_) { return 0; }
    }

    /* ═══════════════ 1. GROW-CELEBRATION SPARKLES ═══════════════ */
    let sparkGeo = null; const queue = []; const POOL = 2500;
    const sPos = new Float32Array(POOL * 3), sCol = new Float32Array(POOL * 3);
    const sLife = new Float32Array(POOL), sMax = new Float32Array(POOL);
    const sVx = new Float32Array(POOL), sVy = new Float32Array(POOL), sVz = new Float32Array(POOL);
    const sBr = new Float32Array(POOL), sBg = new Float32Array(POOL), sBb = new Float32Array(POOL);
    let sFree = 0;
    try {
      for (let i = 0; i < POOL; i++) sPos[i * 3 + 1] = -9999;
      sparkGeo = new THREE.BufferGeometry();
      sparkGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
      sparkGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
      const sm = new THREE.PointsMaterial({ size: 0.5, map: sprite, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, sizeAttenuation: true });
      const sp = new THREE.Points(sparkGeo, sm); sp.frustumCulled = false; scene.add(sp);
    } catch (e) { toast('Sparkles skipped: ' + (e && e.message || e)); sparkGeo = null; }
    function freeSlot() { for (let k = 0; k < POOL; k++) { const i = (sFree + k) % POOL; if (sLife[i] <= 0) { sFree = (i + 1) % POOL; return i; } } return -1; }
    function enqueueBurst(x, y, z, r, g, b, n) { if (!sparkGeo) return; for (let k = 0; k < n; k++) queue.push([x, y, z, r, g, b]); if (queue.length > 4000) queue.splice(0, queue.length - 4000); }
    function drain() { const take = Math.min(queue.length, 40); for (let k = 0; k < take; k++) { const b = queue.shift(); const i = freeSlot(); if (i < 0) break; sPos[i*3]=b[0]; sPos[i*3+1]=b[1]; sPos[i*3+2]=b[2]; const a=Math.random()*6.283, s=1.5+Math.random()*2.5; sVx[i]=Math.cos(a)*s; sVz[i]=Math.sin(a)*s; sVy[i]=2.5+Math.random()*2.5; sLife[i]=0.7+Math.random()*0.5; sMax[i]=sLife[i]; sBr[i]=b[3]; sBg[i]=b[4]; sBb[i]=b[5]; } }
    function updateSparkles(dt) { if (!sparkGeo) return; drain(); let any = false; for (let i = 0; i < POOL; i++) { if (sLife[i] <= 0) continue; any = true; sLife[i] -= dt; if (sLife[i] <= 0) { sPos[i*3+1] = -9999; sCol[i*3]=sCol[i*3+1]=sCol[i*3+2]=0; continue; } sVy[i]-=2.0*dt; sPos[i*3]+=sVx[i]*dt; sPos[i*3+1]+=sVy[i]*dt; sPos[i*3+2]+=sVz[i]*dt; const f=sLife[i]/sMax[i]; sCol[i*3]=sBr[i]*f; sCol[i*3+1]=sBg[i]*f; sCol[i*3+2]=sBb[i]*f; } if (any || queue.length) { sparkGeo.attributes.position.needsUpdate = true; sparkGeo.attributes.color.needsUpdate = true; } }

    /* ═══════════════ 2. RECENT-TREE GROUND HALOS ═══════════════ */
    let haloMesh = null, haloMat = null;
    function rebuildHalos() { if (!haloMesh) return; const now = Date.now(), list = []; for (let i = 0; i < api.trees.length; i++) { const t = api.trees[i]; if (!t.mesh || (t.cur||0) < 0.3) continue; if (t.sessionPlanted || (now - t.ts < 86400000)) { list.push(t); if (list.length >= 400) break; } } for (let i = 0; i < list.length; i++) { const t = list[i]; const r = (t.oak?3.0:1.7)*(t.sxz||1)*Math.max(0.3,t.cur||0); _dh.position.set(t.x,t.y+0.12,t.z); _dh.rotation.set(0,0,0); _dh.scale.set(r,1,r); _dh.updateMatrix(); haloMesh.setMatrixAt(i,_dh.matrix); } haloMesh.count = list.length; haloMesh.instanceMatrix.needsUpdate = true; }
    try {
      const hg = new THREE.CircleGeometry(1, 20); hg.rotateX(-Math.PI / 2);
      haloMat = new THREE.MeshBasicMaterial({ map: sprite, color: 0xffcf6a, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending });
      haloMesh = new THREE.InstancedMesh(hg, haloMat, 400); haloMesh.frustumCulled = false; haloMesh.count = 0; scene.add(haloMesh);
      rebuildHalos(); setInterval(function () { try { rebuildHalos(); } catch (_) {} }, 4000);
    } catch (e) { toast('Halos skipped: ' + (e && e.message || e)); haloMesh = null; }

    /* ═══════════════ 3. ORBITING MOTES ═══════════════ */
    const SN = 64; let swarmGeo = null; const sPos2 = new Float32Array(SN*3), sCol2 = new Float32Array(SN*3); const swarmState = [];
    try {
      for (let i = 0; i < SN; i++) { sPos2[i*3+1] = -9999; swarmState.push({ active:false, tree:null, rad:0, hgt:0, sp:0, ph:0, life:0 }); }
      swarmGeo = new THREE.BufferGeometry();
      swarmGeo.setAttribute('position', new THREE.BufferAttribute(sPos2, 3));
      swarmGeo.setAttribute('color', new THREE.BufferAttribute(sCol2, 3));
      const wm = new THREE.PointsMaterial({ size: 0.7, map: sprite, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, sizeAttenuation: true });
      const wp = new THREE.Points(swarmGeo, wm); wp.frustumCulled = false; scene.add(wp);
    } catch (e) { toast('Motes skipped: ' + (e && e.message || e)); swarmGeo = null; }
    function refreshSwarm() { if (!swarmGeo) return; const tg = recentGrown.slice(); if (!tg.length) { for (let i = 0; i < SN; i++) swarmState[i].active = false; return; } for (let i = 0; i < SN; i++) { const s = swarmState[i], t = tg[i % tg.length]; s.active = true; s.tree = t; s.rad = 1.2+Math.random()*1.8; s.hgt = 0.4+Math.random()*1.2; s.sp = 0.6+Math.random()*0.9; s.ph = Math.random()*6.283; s.life = 50+Math.random()*20; } }
    function updateSwarm(el) { if (!swarmGeo) return; for (let i = 0; i < SN; i++) { const s = swarmState[i]; if (!s.active) continue; s.life -= 0.016; const t = s.tree; if (!t || (t.cur||0) < 0.15) { s.active = false; sCol2[i*3]=sCol2[i*3+1]=sCol2[i*3+2]=0; sPos2[i*3+1]=-9999; continue; } const top = api.topY(t), a = el*s.sp + s.ph; const fade = s.life < 8 ? Math.max(0, s.life/8) : 1; const drift = s.life < 8 ? (8-s.life)*0.7 : 0; sPos2[i*3]=t.x+Math.cos(a)*s.rad; sPos2[i*3+2]=t.z+Math.sin(a)*s.rad; sPos2[i*3+1]=top+Math.sin(a*1.3+s.ph)*0.5+s.hgt+drift; sCol2[i*3]=1.0*fade; sCol2[i*3+1]=0.8*fade; sCol2[i*3+2]=0.45*fade; if (s.life <= 0) { s.active = false; sCol2[i*3]=sCol2[i*3+1]=sCol2[i*3+2]=0; sPos2[i*3+1]=-9999; } } swarmGeo.attributes.position.needsUpdate = true; swarmGeo.attributes.color.needsUpdate = true; }

    /* ═══════════════ 4. CHIME ═══════════════ */
    let actx = null, audioOn = false;
    function ensureCtx() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (actx && actx.state === 'suspended') { try { actx.resume(); } catch (e) {} } return actx; }
    function chime() { if (!audioOn) return; const c = ensureCtx(); if (!c) return; try { const now = c.currentTime; [880,1320,1760].forEach(function (f, i) { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(f, now+i*0.06); g.gain.setValueAtTime(0.0001, now+i*0.06); g.gain.exponentialRampToValueAtTime(0.05, now+i*0.06+0.01); g.gain.exponentialRampToValueAtTime(0.0001, now+i*0.06+0.5); o.connect(g).connect(c.destination); o.start(now+i*0.06); o.stop(now+i*0.06+0.55); }); } catch (e) {} }

    /* ═══════════════ 5. STREAK → WARMER SKY ═══════════════ */
    function applyMood() { try { api.rebaseTOD(); const k = Math.min(1, streakDays/7)*0.5; if (k <= 0) return; const warm = new THREE.Color(0xffb066); api.sun.color.lerp(warm, k*0.6); api.hemi.color.lerp(warm, k*0.35); api.skyBottom.lerp(warm, k*0.5); api.sun.intensity = Math.min(1.6, api.sun.intensity + k*0.25); } catch (e) {} }

    /* ═══════════════ 6. FLOWERS (3 instanced layers, lit + wind sway) ═══════════════ */
    let flowerHeadsMat = null, flowerStemsMat = null;
    try {
      const N = 900;
      const headG = new THREE.CircleGeometry(0.13, 6); headG.rotateX(-Math.PI/2); headG.translate(0, 0.34, 0);
      const headGI = headG.index ? headG.toNonIndexed() : headG;
      const ctrG = new THREE.SphereGeometry(0.05, 5, 4); ctrG.translate(0, 0.36, 0);
      const ctrGI = ctrG.index ? ctrG.toNonIndexed() : ctrG;
      const stemG = new THREE.BufferGeometry();
      const sw = 0.02, sh = 0.34;
      stemG.setAttribute('position', new THREE.BufferAttribute(new Float32Array([ -sw,0,0, sw,0,0, 0,sh,0, 0,0,-sw, 0,0,sw, 0,sh,0 ]), 3));
      stemG.computeVertexNormals();
      flowerHeadsMat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
      flowerStemsMat = new THREE.MeshStandardMaterial({ color: 0x4f7a2a, roughness: 0.9, side: THREE.DoubleSide });
      const ctrMat = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0x553a00, roughness: 0.6 });
      const wind = function (mat) { mat.onBeforeCompile = function (sh) { sh.uniforms.uTime = { value: 0 }; sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', "#include <begin_vertex>\n float gw=max(transformed.y,0.0);\n float ph=instanceMatrix[3][0]*0.7+instanceMatrix[3][2]*0.7;\n transformed.x+=sin(uTime*1.6+ph)*gw*0.22;\n transformed.z+=cos(uTime*1.3+ph)*gw*0.14;"); mat.userData.shader = sh; }; };
      wind(flowerHeadsMat); wind(flowerStemsMat);
      const heads = new THREE.InstancedMesh(headGI, flowerHeadsMat, N);
      const stems = new THREE.InstancedMesh(stemG, flowerStemsMat, N);
      const ctrs = new THREE.InstancedMesh(ctrGI, ctrMat, N);
      heads.frustumCulled = stems.frustumCulled = ctrs.frustumCulled = false;
      const col = new THREE.Color();
      const palette = [[0.95,0.7,0.6],[0.12,0.85,0.6],[0.0,0.0,0.92],[0.78,0.6,0.7],[0.55,0.5,0.85],[0.08,0.9,0.7]];
      let placed = 0, att = 0;
      while (placed < N && att < N * 4) { att++; const p = api.groundPoint(); const s = 0.7 + Math.random()*0.9; _d.position.set(p.x, p.y, p.z); _d.rotation.set(0, Math.random()*6.283, 0); _d.scale.set(s, s*(0.8+Math.random()*0.7), s); _d.updateMatrix(); heads.setMatrixAt(placed, _d.matrix); stems.setMatrixAt(placed, _d.matrix); ctrs.setMatrixAt(placed, _d.matrix); const c = palette[(Math.random()*palette.length)|0]; col.setHSL(c[0], c[1], c[2]); heads.setColorAt(placed, col); placed++; }
      heads.count = stems.count = ctrs.count = placed;
      heads.instanceMatrix.needsUpdate = stems.instanceMatrix.needsUpdate = ctrs.instanceMatrix.needsUpdate = true;
      if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
      scene.add(heads); scene.add(stems); scene.add(ctrs);
      log_count('flowers', placed);
    } catch (e) { toast('Flowers skipped: ' + (e && e.message || e)); }

    /* ═══════════════ 7. CAMPSITES: clearing search + stones + logs + tent + BONFIRE (flame + light + embers) + PATH ═══════════════ */
    const camps = [];
    let flameIM = null, flameDummy = new THREE.Object3D(), emberGeo = null, emberState = [], lakeLight = null;
    try {
      // find clearings = ground points far from every tree
      const want = 3, minClear = 6.0, T = api.trees;
      const found = []; let ca = 0;
      while (found.length < want && ca < 600) { ca++; const p = api.groundPoint(); let ok = true; for (let i = T.length - 1; i >= 0; i--) { const dx = T[i].x - p.x, dz = T[i].z - p.z; if (dx*dx + dz*dz < minClear*minClear) { ok = false; break; } } for (let j = 0; j < found.length; j++) { const dx = found[j].x - p.x, dz = found[j].z - p.z; if (dx*dx + dz*dz < 14*14) { ok = false; break; } } if (ok) found.push(p); }

      if (found.length) {
        // stones ring
        try {
          const sg = new THREE.IcosahedronGeometry(0.32, 0); const sgI = sg.index ? sg.toNonIndexed() : sg;
          const sm = new THREE.MeshStandardMaterial({ color: 0x6b6f78, roughness: 1, flatShading: true });
          const stones = new THREE.InstancedMesh(sgI, sm, found.length * 8); stones.frustumCulled = false; let si = 0;
          found.forEach(function (c) { for (let k = 0; k < 8; k++) { const a = k/8*6.283; _d.position.set(c.x + Math.cos(a)*0.85, c.y + 0.12, c.z + Math.sin(a)*0.85); _d.rotation.set(Math.random(), Math.random(), Math.random()); _d.scale.setScalar(0.7 + Math.random()*0.6); _d.updateMatrix(); stones.setMatrixAt(si++, _d.matrix); } });
          stones.count = si; stones.instanceMatrix.needsUpdate = true; scene.add(stones);
        } catch (e) {}
        // crossed logs
        try {
          const lg = new THREE.CylinderGeometry(0.09, 0.11, 1.3, 6); lg.rotateZ(Math.PI/2); const lgI = lg.index ? lg.toNonIndexed() : lg;
          const lm = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1, flatShading: true });
          const logs = new THREE.InstancedMesh(lgI, lm, found.length * 2); logs.frustumCulled = false; let li = 0;
          found.forEach(function (c) { _d.position.set(c.x, c.y + 0.12, c.z); _d.rotation.set(0, 0.5, 0); _d.scale.setScalar(1); _d.updateMatrix(); logs.setMatrixAt(li++, _d.matrix); _d.rotation.set(0, -0.5, 0); _d.updateMatrix(); logs.setMatrixAt(li++, _d.matrix); });
          logs.count = li; logs.instanceMatrix.needsUpdate = true; scene.add(logs);
        } catch (e) {}
        // tents
        try {
          const tg = new THREE.ConeGeometry(0.85, 0.95, 4); const tgI = tg.index ? tg.toNonIndexed() : tg;
          const tm = new THREE.MeshStandardMaterial({ color: 0xc9743a, roughness: 0.9, flatShading: true });
          const tents = new THREE.InstancedMesh(tgI, tm, found.length); tents.frustumCulled = false;
          found.forEach(function (c, i) { _d.position.set(c.x + 2.4, c.y + 0.45, c.z + 1.6); _d.rotation.set(0, Math.random()*6.283, 0); _d.scale.setScalar(1); _d.updateMatrix(); tents.setMatrixAt(i, _d.matrix); });
          tents.instanceMatrix.needsUpdate = true; scene.add(tents);
        } catch (e) {}
        // flame cones (flicker in onFrame)
        try {
          const fg = new THREE.ConeGeometry(0.34, 1.1, 7); const fgI = fg.index ? fg.toNonIndexed() : fg;
          const fm = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false });
          flameIM = new THREE.InstancedMesh(fgI, fm, found.length); flameIM.frustumCulled = false;
          found.forEach(function (c, i) { flameDummy.position.set(c.x, c.y + 0.55, c.z); flameDummy.rotation.set(0, 0, 0); flameDummy.scale.setScalar(1); flameDummy.updateMatrix(); flameIM.setMatrixAt(i, flameDummy.matrix); camps.push({ x: c.x, y: c.y, z: c.z, iid: i }); });
          flameIM.instanceMatrix.needsUpdate = true; scene.add(flameIM);
        } catch (e) {}
        // real light per fire
        try {
          found.forEach(function (c) {
            const L = new THREE.PointLight(0xff8a3c, 1.4, 26, 2);
            L.position.set(c.x, c.y + 1.1, c.z);
            scene.add(L);
            const camp = camps.find(function (x) { return x.x === c.x && x.z === c.z; });
            if (camp) camp.light = L;
          });
          // (attach light refs properly)
          camps.forEach(function (c) {
            if (!c.light) {
              c.light = new THREE.PointLight(0xff8a3c, 1.4, 26, 2);
              c.light.position.set(c.x, c.y + 1.1, c.z);
              scene.add(c.light);
            } else if (!c.light.parent) {
              scene.add(c.light);
            }
          });
        } catch (e) {}
        // embers pool
        try {
          const EN = found.length * 14; const ep = new Float32Array(EN*3), ec = new Float32Array(EN*3);
          emberState = [];
          for (let i = 0; i < EN; i++) { const c = found[i % found.length]; emberState.push({ cx: c.x, cy: c.y, cz: c.z, life: Math.random()*2, max: 1.5 + Math.random()*1.5, vx: (Math.random()-0.5)*0.4, vz: (Math.random()-0.5)*0.4, vy: 0.6 + Math.random()*0.8 }); ep[i*3+1] = -9999; }
          emberGeo = new THREE.BufferGeometry(); emberGeo.setAttribute('position', new THREE.BufferAttribute(ep, 3)); emberGeo.setAttribute('color', new THREE.BufferAttribute(ec, 3));
          const em = new THREE.PointsMaterial({ size: 0.32, map: sprite, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, sizeAttenuation: true });
          const emp = new THREE.Points(emberGeo, em); emp.frustumCulled = false; scene.add(emp);
        } catch (e) {}
        // winding dirt path through the camps
        try {
          const anchors = found.map(function (c) { const y = api.heightAt ? api.heightAt(c.x, c.z) : c.y; return new THREE.Vector3(c.x, y, c.z); });
          if (anchors.length === 1) { const c = anchors[0]; anchors.push(new THREE.Vector3(c.x+5, c.y, c.z+3), new THREE.Vector3(c.x-4, c.y, c.z+4)); }
          anchors.push(anchors[0].clone()); // loop
          const curve = new THREE.CatmullRomCurve3(anchors, false, 'catmullrom', 0.5);
          const samples = curve.getPoints(Math.max(24, found.length * 18));
          const pts = samples.map(function (v) { return { x: v.x, z: v.z, y: api.heightAt ? api.heightAt(v.x, v.z) : v.y }; });
          const geos = [];
          for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i+1]; const dx = b.x-a.x, dz = b.z-a.z; const len = Math.hypot(dx, dz) || 1; const nx = -dz/len*0.6, nz = dx/len*0.6; const y0 = a.y+0.06, y1 = b.y+0.06; const v = new Float32Array([ a.x-nx,y0,a.z-nz, a.x+nx,y0,a.z+nz, b.x+nx,y1,b.z+nz, a.x-nx,y0,a.z-nz, b.x+nx,y1,b.z+nz, b.x-nx,y1,b.z-nz ]); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(v, 3)); g.computeVertexNormals(); geos.push(g); }
          const ribbon = concatGeos(THREE, geos);
          const pm = new THREE.MeshStandardMaterial({ color: 0x6e5436, roughness: 1, metalness: 0 });
          const pathMesh = new THREE.Mesh(ribbon, pm); scene.add(pathMesh);
        } catch (e) { toast('Path skipped: ' + (e && e.message || e)); }
        log_count('camps', found.length);
      } else { toast('No clearings found for camps (forest too dense) — skipped.'); }
    } catch (e) { toast('Camps skipped: ' + (e && e.message || e)); }

    /* ═══════════════ 8. LAKE FIREFLIES + soft lake light + global night fireflies ═══════════════ */
    let lakeFireGeo = null, lakeFireBase = [], globFireGeo = null, globFireBase = [];
    try {
      const LN = 150; const lp = new Float32Array(LN*3), lc = new Float32Array(LN*3);
      for (let i = 0; i < LN; i++) { const a = Math.random()*6.283, r = 2 + Math.random()*9; const x = POND.x + Math.cos(a)*r, z = POND.z + Math.sin(a)*r; const y = (api.heightAt ? Math.max(api.heightAt(x, z), -0.6) : -0.4) + 0.4 + Math.random()*2.2; lakeFireBase.push({ x:x, y:y, z:z, ph: Math.random()*6.28, sp: 0.4+Math.random()*0.7 }); lp[i*3]=x; lp[i*3+1]=y; lp[i*3+2]=z; }
      lakeFireGeo = new THREE.BufferGeometry(); lakeFireGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lakeFireGeo.setAttribute('color', new THREE.BufferAttribute(lc, 3));
      const lm = new THREE.PointsMaterial({ size: 0.6, map: sprite, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, sizeAttenuation: true });
      const lfp = new THREE.Points(lakeFireGeo, lm); lfp.frustumCulled = false; scene.add(lfp);
      lakeLight = new THREE.PointLight(0x8fe6c8, 0.0, 30, 2); lakeLight.position.set(POND.x, 1.4, POND.z); scene.add(lakeLight);
    } catch (e) { toast('Lake fireflies skipped: ' + (e && e.message || e)); lakeFireGeo = null; }
    try {
      const GN = 80; const gp = new Float32Array(GN*3), gc = new Float32Array(GN*3);
      for (let i = 0; i < GN; i++) { const p = api.groundPoint(); const y = p.y + 0.6 + Math.random()*2.4; globFireBase.push({ x:p.x, y:y, z:p.z, ph: Math.random()*6.28, sp: 0.3+Math.random()*0.6 }); gp[i*3]=p.x; gp[i*3+1]=y; gp[i*3+2]=p.z; }
      globFireGeo = new THREE.BufferGeometry(); globFireGeo.setAttribute('position', new THREE.BufferAttribute(gp, 3)); globFireGeo.setAttribute('color', new THREE.BufferAttribute(gc, 3));
      const gm = new THREE.PointsMaterial({ size: 0.5, map: sprite, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, sizeAttenuation: true });
      const gfp = new THREE.Points(globFireGeo, gm); gfp.frustumCulled = false; scene.add(gfp);
    } catch (e) { globFireGeo = null; }

    function updateFireflies(geo, base, el, night, hueR, hueG, hueB) {
      if (!geo) return; const arr = geo.attributes.position.array, col = geo.attributes.color.array;
      for (let i = 0; i < base.length; i++) { const b = base[i]; const tw = 0.5 + 0.5*Math.sin(el*b.sp*3 + b.ph); const f = night * tw; arr[i*3] = b.x + Math.sin(el*b.sp + b.ph)*0.8; arr[i*3+1] = b.y + Math.sin(el*b.sp*1.3 + b.ph)*0.5; arr[i*3+2] = b.z + Math.cos(el*b.sp*0.8 + b.ph)*0.8; col[i*3] = hueR*f; col[i*3+1] = hueG*f; col[i*3+2] = hueB*f; }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    }

    /* ═══════════════ 9. GROW-COMPLETE SHOCKWAVE (transient, self-cleaning) ═══════════════ */
    function shockwave(x, y, z) {
      try {
        const rg = new THREE.RingGeometry(0.2, 0.5, 24); rg.rotateX(-Math.PI/2);
        const m = new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
        const ring = new THREE.Mesh(rg, m); ring.position.set(x, y + 0.15, z); scene.add(ring);
        const t0 = performance.now();
        (function step() { const p = (performance.now() - t0) / 600; if (p >= 1) { scene.remove(ring); rg.dispose(); m.dispose(); return; } const s = 1 + p * 7; ring.scale.set(s, s, s); m.opacity = 0.8 * (1 - p); requestAnimationFrame(step); })();
      } catch (e) {}
    }

    function log_count() {} // noop placeholder

    /* ═══════════════ HOOKS ═══════════════ */
    const seenPopped = new WeakSet();
    for (let i = 0; i < api.trees.length; i++) if ((api.trees[i].cur || 0) > 0.9) seenPopped.add(api.trees[i]);
    const meshDirty = {};

    api.onFrame.push(function (el, dt) {
      try {
        const mt = maturity();
        if (bloom > 0) { bloom *= Math.exp(-dt * 5); if (bloom < 0.001) bloom = 0; }
        window.__bloom = bloom;
        if (mt >= 1 && !bloomedFull) { bloomedFull = true; bloom = 1; window.__bloom = 1; celebrateWave(); chime(); }
        if (haloMat) haloMat.opacity = 0.16 + 0.16 * (0.5 + 0.5 * Math.sin(el * 2.2));

        const trees = api.trees;
        for (let i = 0; i < trees.length; i++) {
          const t = trees[i]; if (!t.mesh) continue;
          const prevG = (t.growCur != null) ? t.growCur : 1; const g = prevG + (mt - prevG) * Math.min(1, dt * 3); t.growCur = g;
          const cur = t.cur || 0;
          const changed = Math.abs(cur - (t._jc != null ? t._jc : -9)) > 0.0008 || Math.abs(g - (t._jg != null ? t._jg : -9)) > 0.0008 || bloom > 0.0005 || (t._jb && bloom <= 0.0005);
          if (changed) { writeTree(t, g, cur); t._jc = cur; t._jg = g; t._jb = bloom > 0.0005; meshDirty[t.mesh.id] = true; }
          if (cur > 0.9) { if (!seenPopped.has(t)) { seenPopped.add(t); if (Math.random() < 0.10) { const c = api.SUBJECTS[t.subject] ? api.SUBJECTS[t.subject].color : null; if (c) enqueueBurst(t.x, api.topY(t), t.z, c.r, c.g, c.b, 6); } } }
          else if (cur < 0.05) { if (seenPopped.has(t)) seenPopped.delete(t); }
        }
        for (const k in meshDirty) { if (meshDirty[k]) { if (meshesById[k]) meshesById[k].instanceMatrix.needsUpdate = true; meshDirty[k] = false; } }

        updateSparkles(dt);
        updateSwarm(el);

        // flower wind
        if (flowerHeadsMat && flowerHeadsMat.userData.shader) flowerHeadsMat.userData.shader.uniforms.uTime.value = el;
        if (flowerStemsMat && flowerStemsMat.userData.shader) flowerStemsMat.userData.shader.uniforms.uTime.value = el;

        const night = nightFactor();

        // bonfire flame flicker + light + embers
        if (flameIM && camps.length) {
          for (let i = 0; i < camps.length; i++) { const c = camps[i]; const fl = 0.85 + 0.35 * Math.sin(el * 9 + i) * Math.sin(el * 5.3 + i * 2); flameDummy.position.set(c.x, c.y + 0.5 + 0.06 * Math.sin(el * 7 + i), c.z); flameDummy.rotation.set(0, el * 0.5, 0); flameDummy.scale.set(0.8 + 0.25 * Math.sin(el * 11 + i), 0.9 + 0.4 * Math.abs(Math.sin(el * 8 + i)), 0.8 + 0.25 * Math.cos(el * 10 + i)); flameDummy.updateMatrix(); flameIM.setMatrixAt(c.iid, flameDummy.matrix); if (c.light) c.light.intensity = (1.2 + night * 2.2) * (0.7 + 0.5 * Math.abs(Math.sin(el * 12 + i))); }
          flameIM.instanceMatrix.needsUpdate = true;
        }
        if (emberGeo && emberState.length) {
          const ea = emberGeo.attributes.position.array, ec = emberGeo.attributes.color.array;
          for (let i = 0; i < emberState.length; i++) { const e = emberState[i]; e.life -= dt; if (e.life <= 0) { e.life = e.max; e.px = e.cx + (Math.random()-0.5)*0.4; e.py = e.cy + 0.4; e.pz = e.cz + (Math.random()-0.5)*0.4; e.vx = (Math.random()-0.5)*0.4; e.vz = (Math.random()-0.5)*0.4; e.vy = 0.6 + Math.random()*0.8; } if (e.px == null) { e.px = e.cx; e.py = e.cy + 0.4; e.pz = e.cz; } e.px += e.vx * dt; e.py += e.vy * dt; e.pz += e.vz * dt; const f = Math.max(0, e.life / e.max); ea[i*3] = e.px; ea[i*3+1] = e.py; ea[i*3+2] = e.pz; ec[i*3] = 1.0 * f; ec[i*3+1] = 0.5 * f; ec[i*3+2] = 0.15 * f; }
          emberGeo.attributes.position.needsUpdate = true; emberGeo.attributes.color.needsUpdate = true;
        }

        // fireflies (lake brighter/greener, global warmer) + lake light
        updateFireflies(lakeFireGeo, lakeFireBase, el, night, 0.6, 1.0, 0.7);
        updateFireflies(globFireGeo, globFireBase, el, night, 1.0, 0.85, 0.4);
        if (lakeLight) lakeLight.intensity = night * 1.6;
      } catch (e) { /* swallowed; main loop also guards */ }
    });

    api.onPlanted.push(function (t, interactive) {
      try {
        if (!interactive) return;
        const c = api.SUBJECTS[t.subject] ? api.SUBJECTS[t.subject].color : null;
        const r = c ? c.r : 1, g = c ? c.g : 0.8, b = c ? c.b : 0.4;
        enqueueBurst(t.x, api.topY(t), t.z, r, g, b, 18);
        shockwave(t.x, t.y, t.z);
        recentGrown.push(t); if (recentGrown.length > 6) recentGrown.shift();
        refreshSwarm(); rebuildHalos(); chime();
      } catch (e) {}
    });

    /* ═══════════════ open-ground placement (never stuff new trees) ═══════════════ */
    function openGround(minD, tries) {
      minD = minD || 2.2; tries = tries || 40; const T = api.trees; const md2 = minD * minD;
      for (let a = 0; a < tries; a++) { const p = api.groundPoint(); let ok = true; for (let i = T.length - 1; i >= 0; i--) { const dx = T[i].x - p.x, dz = T[i].z - p.z; if (dx*dx + dz*dz < md2) { ok = false; break; } } if (ok) return p; }
      if (api.growWorld) { api.growWorld(48); for (let a = 0; a < 14; a++) { const p = api.groundPoint(); let ok = true; for (let i = T.length - 1; i >= 0; i--) { const dx = T[i].x - p.x, dz = T[i].z - p.z; if (dx*dx + dz*dz < md2) { ok = false; break; } } if (ok) return p; } }
      return api.groundPoint();
    }

    function celebrateWave() { const vis = []; for (let i = 0; i < api.trees.length; i++) if ((api.trees[i].cur || 0) > 0.5) vis.push(api.trees[i]); for (let k = 0; k < 34; k++) { const t = vis[(Math.random()*vis.length)|0]; if (!t) continue; const c = api.SUBJECTS[t.subject] ? api.SUBJECTS[t.subject].color : null; enqueueBurst(t.x, api.topY(t), t.z, c ? c.r*0.5+0.5 : 1, c ? c.g*0.5+0.4 : 0.8, c ? c.b*0.3+0.5 : 0.5, 8); } }

    /* ═══════════════ SIM PANEL + GROWTH MODEL ═══════════════ */
    function plantSim(diff) {
      try {
        const subs = Object.keys(api.SUBJECTS); const subject = subs[(Math.random()*3)|0];
        let qElo = diff === 'hard' ? 2500 : diff === 'medium' ? 1600 : 1000; qElo += (Math.random()-0.5)*140;
        const oak = qElo >= 2300; const p = openGround(oak ? 4.5 : 2.2, 50);   // oaks need a wider clearing
        const t = { id: 100000 + api.trees.length, ts: Date.now(), subject: subject, qElo: qElo, chapter: 'Sim', oak: oak, x: p.x, y: p.y, z: p.z,
          baseScale: 0.55 + Math.min(1, Math.max(0, (qElo-800)/2200))*1.1 + (Math.random()-0.5)*0.16,
          sy: 0.82 + Math.random()*0.5, sxz: 0.85 + Math.random()*0.32, leanX: (Math.random()-0.5)*0.1, leanZ: (Math.random()-0.5)*0.1,
          rot: Math.random()*Math.PI*2, cur: 0, target: 1, growing: true, animT0: performance.now(), growCur: maturity(), sessionPlanted: true };
        if (t.oak) { t.baseScale *= 0.85; t.sy *= 0.9; t.sxz *= 1.0; t.leanX *= 0.4; t.leanZ *= 0.4; }   // smaller oaks (matches core)
        if (!api.addTree(t, true)) { toast('Forest headroom full.'); return; }
        updateReadout();
      } catch (e) { console.warn('[juice] plantSim', e); }
    }
    function addStudy(m) { studyMinutes += m; updateReadout(); }
    function addStreak(d) { streakDays = Math.max(0, streakDays + d); applyMood(); updateReadout(); }
    function updateReadout() { const s = document.getElementById('gr-study'); if (s) s.textContent = Math.round(studyMinutes) + 'm'; const g = document.getElementById('gr-grow'); if (g) g.textContent = Math.round(maturity()*100) + '%'; const k = document.getElementById('gr-streak'); if (k) k.textContent = streakDays + 'd'; }
    function buildPanel() {
      if (document.getElementById('panel-grow')) { updateReadout(); return; }
      const st = document.createElement('style');
      st.textContent = '#panel-grow{top:20px;right:20px;width:246px}#panel-grow .gr-read{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--dim,#9aa3b5);padding:3px 0}#panel-grow .gr-read b{font-family:var(--num,"Space Grotesk",monospace);color:#fff;font-size:14px}#panel-grow .gr-lbl{font-size:8.5px;letter-spacing:1.4px;color:var(--dim,#9aa3b5);font-weight:700;margin:11px 0 5px;text-transform:uppercase}#panel-grow .seg button{font-size:10.5px;padding:6px 3px}#panel-grow #gr-sound{width:100%;margin-top:12px;justify-content:center}@media(max-width:760px){#panel-grow{top:auto;bottom:86px;right:12px;left:12px;width:auto}#panel-bottom{bottom:14px}}';
      document.head.appendChild(st);
      const p = document.createElement('div'); p.id = 'panel-grow'; p.className = 'hud-panel';
      p.innerHTML = '<div class="kicker">// GROWTH SIM</div>' +
        '<div class="gr-read"><span>📚 STUDY</span><b id="gr-study">—</b></div>' +
        '<div class="gr-read"><span>🌱 GROWTH</span><b id="gr-grow">—</b></div>' +
        '<div class="gr-read"><span>🔥 STREAK</span><b id="gr-streak">0d</b></div>' +
        '<div class="gr-lbl">Study · grows the forest</div>' +
        '<div class="seg" id="gr-study-seg"><button data-m="15">+15m</button><button data-m="60">+1h</button><button data-m="180">+3h</button></div>' +
        '<div class="gr-lbl">Solve · plants a sapling</div>' +
        '<div class="seg" id="gr-solve-seg"><button data-d="easy">Easy</button><button data-d="medium">Medium</button><button data-d="hard">Hard 🌳</button></div>' +
        '<div class="gr-lbl">Streak · warms the sky</div>' +
        '<div class="seg" id="gr-streak-seg"><button data-s="1">+1 day</button><button data-s="reset">reset</button></div>' +
        '<button id="gr-sound" class="toggle">🔔 SOUND OFF</button>';
      document.body.appendChild(p);
      p.querySelector('#gr-study-seg').addEventListener('click', function (e) { const b = e.target.closest('button'); if (!b) return; addStudy(parseInt(b.getAttribute('data-m'), 10) || 0); });
      p.querySelector('#gr-solve-seg').addEventListener('click', function (e) { const b = e.target.closest('button'); if (!b) return; plantSim(b.getAttribute('data-d')); });
      p.querySelector('#gr-streak-seg').addEventListener('click', function (e) { const b = e.target.closest('button'); if (!b) return; const v = b.getAttribute('data-s'); if (v === 'reset') { streakDays = 0; applyMood(); updateReadout(); } else addStreak(1); });
      const sb = p.querySelector('#gr-sound');
      sb.addEventListener('click', function () { audioOn = !audioOn; if (audioOn) ensureCtx(); sb.textContent = audioOn ? '🔔 SOUND ON' : '🔔 SOUND OFF'; sb.classList.toggle('on', audioOn); if (audioOn) chime(); });
      updateReadout();
    }
    buildPanel();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();