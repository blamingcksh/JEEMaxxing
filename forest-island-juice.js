/* ============================================================================
forest-island-juice.js
App-safe "living world" layer for forest-island.js.

This is NOT forest-juice.js.
This is a separate, isolated enhancement layer for the MAIN APP island.

Adds:
• tighter atmosphere
• flowers / ground sparks
• fireflies at night
• stars
• subject-colored burst on new tree
• shockwave ring on solve
• recent-tree halos
• streak-warmed lighting
• small bonfire once the island starts filling
============================================================================ */
(function () {
'use strict';

if (window.__forestIslandJuiceInit) return;
window.__forestIslandJuiceInit = true;

function boot() {
  var api = window.__forestIslandAPI;
  if (!api || !api.THREE || !api.scene || !api.env) {
    setTimeout(boot, 200);
    return;
  }
  try {
    build(api);
    console.log('[forest-island-juice] ready');
  } catch (e) {
    console.warn('[forest-island-juice] skipped:', e && e.message ? e.message : e);
  }
}

function glowTex(THREE) {
  var c = document.createElement('canvas');
  c.width = c.height = 64;
  var g = c.getContext('2d');
  var r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,.75)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  var t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function build(api) {
  var THREE = api.THREE;
  var scene = api.scene;

  var sprite = glowTex(THREE);
  var _d = new THREE.Object3D();

  var warm = new THREE.Color(0xffb066);
  var deepWater = new THREE.Color(0x244a60);

  var recent = [];
  var waves = [];

  var camp = null;
  var campAttempts = 0;
  var lastCampTry = -10;
  var lastStreakCheck = -10;
  var streak = 0;

  /* ── small global polish ── */
  try {
    if (api.renderer) {
      api.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      api.renderer.toneMappingExposure = 1.06;
      api.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
  } catch (e) {}

  try {
    if (!scene.fog) scene.fog = new THREE.FogExp2(0x0b1020, 0.006);
  } catch (e) {}

  try {
    var rim = new THREE.DirectionalLight(0x66ccff, 0.22);
    rim.position.set(-18, 16, -20);
    scene.add(rim);

    var fill = new THREE.DirectionalLight(0xffe6c4, 0.14);
    fill.position.set(14, 8, -12);
    scene.add(fill);
  } catch (e) {}

  /* ── helpers ── */
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function nightFactor() {
    var d = new Date();
    var t = (d.getHours() + d.getMinutes() / 60) / 24;
    return clamp(Math.abs(t - 0.5) * 2, 0, 1);
  }

  function subjectColor(k) {
    return (api.SUBJECTS && api.SUBJECTS[k]) ? api.SUBJECTS[k].color : new THREE.Color(0xffffff);
  }

  function allTrees() {
    var out = [];
    for (var k in api.trees) {
      if (Object.prototype.hasOwnProperty.call(api.trees, k)) out = out.concat(api.trees[k]);
    }
    return out;
  }

  function treeAlive(t) {
    if (!t || !t.subject || !api.trees[t.subject]) return false;
    var arr = api.trees[t.subject];
    return t.iid < arr.length && arr[t.iid] === t;
  }

  function streakDays() {
    var el = document.getElementById('top-streak');
    if (!el) return 0;
    var m = (el.textContent || '').match(/(\d+)/);
    return m ? (parseInt(m[1], 10) || 0) : 0;
  }

  function effectsOK() {
    return !api.motionOK || api.motionOK();
  }

  function totalTrees() {
    return api.total ? api.total() : 0;
  }

  /* ── stars ── */
  var starMat = null;
  try {
    var SN = 160;
    var sp = new Float32Array(SN * 3);
    var sc = new Float32Array(SN * 3);

    for (var si = 0; si < SN; si++) {
      var a = Math.random() * Math.PI * 2;
      var rr = rand(90, 150);
      var yy = rand(25, 95);
      sp[si * 3] = Math.cos(a) * rr;
      sp[si * 3 + 1] = yy;
      sp[si * 3 + 2] = Math.sin(a) * rr;

      var b = rand(0.45, 1.0);
      sc[si * 3] = b;
      sc[si * 3 + 1] = b;
      sc[si * 3 + 2] = b;
    }

    var starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3));

    starMat = new THREE.PointsMaterial({
      size: 1.4,
      map: sprite,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true
    });

    var stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    scene.add(stars);
  } catch (e) {}

  /* ── flowers / ground sparks ── */
  var flowerMat = null;
  try {
    var spots = api.drySpots || [];
    if (spots.length) {
      var FN = Math.min(220, spots.length);
      var fp = new Float32Array(FN * 3);
      var fc = new Float32Array(FN * 3);

      var palette = [
        new THREE.Color(0x4cc9ff),
        new THREE.Color(0x39d98a),
        new THREE.Color(0xffb224),
        new THREE.Color(0xff7ab8),
        new THREE.Color(0xfff3b0)
      ];

      var placed = 0;
      var att = 0;

      while (placed < FN && att < FN * 6) {
        att++;
        var s = spots[(Math.random() * spots.length) | 0];
        if (!s || s.y < 0.32) continue;

        var c = palette[(Math.random() * palette.length) | 0];

        fp[placed * 3] = s.x + rand(-0.38, 0.38);
        fp[placed * 3 + 1] = s.y + 0.05;
        fp[placed * 3 + 2] = s.z + rand(-0.38, 0.38);

        fc[placed * 3] = c.r;
        fc[placed * 3 + 1] = c.g;
        fc[placed * 3 + 2] = c.b;

        placed++;
      }

      var flowerGeo = new THREE.BufferGeometry();
      flowerGeo.setAttribute('position', new THREE.BufferAttribute(fp, 3));
      flowerGeo.setAttribute('color', new THREE.BufferAttribute(fc, 3));
      flowerGeo.setDrawRange(0, placed);

      flowerMat = new THREE.PointsMaterial({
        size: 0.16,
        map: sprite,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        sizeAttenuation: true
      });

      var flowerPts = new THREE.Points(flowerGeo, flowerMat);
      flowerPts.frustumCulled = false;
      scene.add(flowerPts);
    }
  } catch (e) {}

  /* ── fireflies ── */
  var fireGeo = null;
  var fireBase = [];
  try {
    var FFN = 48;
    var ffp = new Float32Array(FFN * 3);
    var ffc = new Float32Array(FFN * 3);

    for (var fi = 0; fi < FFN; fi++) {
      var x = rand(-7.5, 7.5);
      var z = rand(-7.5, 7.5);
      var y = Math.max(api.heightAt ? api.heightAt(x, z) : 0, 0.1) + rand(0.45, 2.1);

      fireBase.push({
        x: x,
        y: y,
        z: z,
        ph: rand(0, 6.283),
        sp: rand(0.35, 0.95)
      });

      ffp[fi * 3] = x;
      ffp[fi * 3 + 1] = y;
      ffp[fi * 3 + 2] = z;
    }

    fireGeo = new THREE.BufferGeometry();
    fireGeo.setAttribute('position', new THREE.BufferAttribute(ffp, 3));
    fireGeo.setAttribute('color', new THREE.BufferAttribute(ffc, 3));

    var fireMat = new THREE.PointsMaterial({
      size: 0.45,
      map: sprite,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true
    });

    var firePts = new THREE.Points(fireGeo, fireMat);
    firePts.frustumCulled = false;
    scene.add(firePts);
  } catch (e) {}

  function updateFireflies(el, night) {
    if (!fireGeo || !fireBase.length) return;

    var arr = fireGeo.attributes.position.array;
    var col = fireGeo.attributes.color.array;

    for (var i = 0; i < fireBase.length; i++) {
      var b = fireBase[i];
      var tw = 0.5 + 0.5 * Math.sin(el * b.sp * 3 + b.ph);
      var f = night * tw;

      arr[i * 3] = b.x + Math.sin(el * b.sp + b.ph) * 0.55;
      arr[i * 3 + 1] = b.y + Math.sin(el * b.sp * 1.4 + b.ph) * 0.35;
      arr[i * 3 + 2] = b.z + Math.cos(el * b.sp * 0.9 + b.ph) * 0.55;

      col[i * 3] = 1.0 * f;
      col[i * 3 + 1] = 0.84 * f;
      col[i * 3 + 2] = 0.45 * f;
    }

    fireGeo.attributes.position.needsUpdate = true;
    fireGeo.attributes.color.needsUpdate = true;
  }

  /* ── sparkles ── */
  var sparkGeo = null;
  var queue = [];
  var POOL = 420;

  var sPos = new Float32Array(POOL * 3);
  var sCol = new Float32Array(POOL * 3);
  var sLife = new Float32Array(POOL);
  var sMax = new Float32Array(POOL);
  var sVx = new Float32Array(POOL);
  var sVy = new Float32Array(POOL);
  var sVz = new Float32Array(POOL);
  var sBr = new Float32Array(POOL);
  var sBg = new Float32Array(POOL);
  var sBb = new Float32Array(POOL);
  var sFree = 0;

  try {
    for (var pi = 0; pi < POOL; pi++) sPos[pi * 3 + 1] = -9999;

    sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    sparkGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));

    var sparkMat = new THREE.PointsMaterial({
      size: 0.5,
      map: sprite,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true
    });

    var sparkPts = new THREE.Points(sparkGeo, sparkMat);
    sparkPts.frustumCulled = false;
    scene.add(sparkPts);
  } catch (e) {
    sparkGeo = null;
  }

  function freeSlot() {
    for (var k = 0; k < POOL; k++) {
      var i = (sFree + k) % POOL;
      if (sLife[i] <= 0) {
        sFree = (i + 1) % POOL;
        return i;
      }
    }
    return -1;
  }

  function burst(x, y, z, r, g, b, n) {
    if (!sparkGeo) return;
    for (var k = 0; k < n; k++) queue.push([x, y, z, r, g, b]);
    if (queue.length > 2000) queue.splice(0, queue.length - 2000);
  }

  function drainQueue() {
    var take = Math.min(queue.length, 28);
    for (var k = 0; k < take; k++) {
      var p = queue.shift();
      var i = freeSlot();
      if (i < 0) break;

      sPos[i * 3] = p[0] + rand(-0.12, 0.12);
      sPos[i * 3 + 1] = p[1] + rand(0, 0.35);
      sPos[i * 3 + 2] = p[2] + rand(-0.12, 0.12);

      var a = Math.random() * 6.283;
      var spd = rand(1.1, 2.2);

      sVx[i] = Math.cos(a) * spd;
      sVz[i] = Math.sin(a) * spd;
      sVy[i] = rand(1.4, 3.0);

      sLife[i] = rand(0.65, 1.1);
      sMax[i] = sLife[i];

      sBr[i] = p[3];
      sBg[i] = p[4];
      sBb[i] = p[5];
    }
  }

  function updateSparkles(dt) {
    if (!sparkGeo) return;

    drainQueue();

    var any = false;

    for (var i = 0; i < POOL; i++) {
      if (sLife[i] <= 0) continue;

      any = true;
      sLife[i] -= dt;

      if (sLife[i] <= 0) {
        sPos[i * 3 + 1] = -9999;
        sCol[i * 3] = sCol[i * 3 + 1] = sCol[i * 3 + 2] = 0;
        continue;
      }

      sVy[i] -= 1.7 * dt;

      sPos[i * 3] += sVx[i] * dt;
      sPos[i * 3 + 1] += sVy[i] * dt;
      sPos[i * 3 + 2] += sVz[i] * dt;

      var f = sLife[i] / sMax[i];

      sCol[i * 3] = sBr[i] * f;
      sCol[i * 3 + 1] = sBg[i] * f;
      sCol[i * 3 + 2] = sBb[i] * f;
    }

    if (any || queue.length) {
      sparkGeo.attributes.position.needsUpdate = true;
      sparkGeo.attributes.color.needsUpdate = true;
    }
  }

  /* ── halos for recently grown trees ── */
  var haloMesh = null;
  var haloMat = null;

  try {
    var hg = new THREE.CircleGeometry(1, 24);
    hg.rotateX(-Math.PI / 2);

    haloMat = new THREE.MeshBasicMaterial({
      color: 0xffd98a,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    haloMesh = new THREE.InstancedMesh(hg, haloMat, 18);
    haloMesh.frustumCulled = false;
    haloMesh.count = 0;
    scene.add(haloMesh);
  } catch (e) {
    haloMesh = null;
  }

  function updateHalos(el) {
    if (!haloMesh) return;

    var now = Date.now();
    var n = 0;

    for (var i = 0; i < recent.length && n < 18; i++) {
      var t = recent[i];
      if (!treeAlive(t)) continue;

      var age = now - (t.plantedAt || 0);
      if (age > 14000) continue;
      if ((t.cur || 0) < 0.2) continue;

      var pulse = 1 + 0.12 * Math.sin(el * 3 + i);
      var r = (t.oak ? 1.9 : 1.15) * Math.max(0.25, t.cur || 0) * pulse;

      _d.position.set(t.x, (t.y || 0) + 0.09, t.z);
      _d.rotation.set(0, 0, 0);
      _d.scale.set(r, 1, r);
      _d.updateMatrix();

      haloMesh.setMatrixAt(n++, _d.matrix);
    }

    haloMesh.count = n;
    haloMesh.instanceMatrix.needsUpdate = true;
    haloMat.opacity = 0.16 + 0.10 * Math.sin(el * 2.4);
  }

  /* ── shockwave ── */
  function shockwave(x, y, z, color) {
    try {
      var g = new THREE.RingGeometry(0.18, 0.42, 28);
      g.rotateX(-Math.PI / 2);

      var m = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });

      var mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y + 0.12, z);
      scene.add(mesh);

      waves.push({
        mesh: mesh,
        geo: g,
        mat: m,
        t0: performance.now()
      });
    } catch (e) {}
  }

  function updateWaves() {
    var now = performance.now();

    for (var i = waves.length - 1; i >= 0; i--) {
      var w = waves[i];
      var p = (now - w.t0) / 650;

      if (p >= 1) {
        scene.remove(w.mesh);
        w.geo.dispose();
        w.mat.dispose();
        waves.splice(i, 1);
      } else {
        var s = 1 + p * 5.5;
        w.mesh.scale.set(s, 1, s);
        w.mat.opacity = 0.75 * (1 - p);
      }
    }
  }

  /* ── bonfire camp ── */
  function findClearing() {
    var spots = api.drySpots || [];
    var trees = allTrees();

    for (var i = 0; i < spots.length; i++) {
      var s = spots[i];
      var d = Math.hypot(s.x, s.z);

      if (d < 1.4 || d > 5.8) continue;

      var ok = true;
      for (var j = 0; j < trees.length; j++) {
        var dx = trees[j].x - s.x;
        var dz = trees[j].z - s.z;
        if (dx * dx + dz * dz < 2.4 * 2.4) {
          ok = false;
          break;
        }
      }

      if (ok) return s;
    }

    return null;
  }

  function tryBuildCamp() {
    if (camp || campAttempts > 30) return;
    if (totalTrees() < 3) return;

    var s = findClearing();
    if (!s) {
      campAttempts++;
      return;
    }

    try {
      var group = new THREE.Group();
      group.position.set(s.x, s.y, s.z);
      scene.add(group);

      // stones
      var stoneGeo = new THREE.IcosahedronGeometry(0.16, 0);
      var stoneMat = new THREE.MeshStandardMaterial({
        color: 0x71767f,
        roughness: 1,
        flatShading: true
      });

      for (var i = 0; i < 7; i++) {
        var a = (i / 7) * Math.PI * 2;
        var stone = new THREE.Mesh(stoneGeo, stoneMat);
        stone.position.set(Math.cos(a) * 0.55, 0.06, Math.sin(a) * 0.55);
        stone.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
        stone.scale.setScalar(rand(0.7, 1.2));
        group.add(stone);
      }

      // logs
      var logGeo = new THREE.CylinderGeometry(0.045, 0.055, 0.7, 6);
      logGeo.rotateZ(Math.PI / 2);

      var logMat = new THREE.MeshStandardMaterial({
        color: 0x5a3a22,
        roughness: 1,
        flatShading: true
      });

      var l1 = new THREE.Mesh(logGeo, logMat);
      l1.rotation.y = 0.5;
      l1.position.y = 0.07;
      group.add(l1);

      var l2 = new THREE.Mesh(logGeo, logMat);
      l2.rotation.y = -0.6;
      l2.position.y = 0.07;
      group.add(l2);

      // flame
      var flameGeo = new THREE.ConeGeometry(0.16, 0.55, 7);
      var flameMat = new THREE.MeshBasicMaterial({
        color: 0xffb347,
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });

      var flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.y = 0.32;
      group.add(flame);

      // light
      var light = new THREE.PointLight(0xff8a3c, 0.0, 16, 2);
      light.position.y = 0.7;
      group.add(light);

      // embers
      var EN = 22;
      var ep = new Float32Array(EN * 3);
      var ec = new Float32Array(EN * 3);
      var estate = [];

      for (var e = 0; e < EN; e++) {
        var st = {
          life: rand(0.2, 1.8),
          max: rand(1.1, 2.4),
          px: rand(-0.16, 0.16),
          py: rand(0.12, 0.5),
          pz: rand(-0.16, 0.16),
          vx: rand(-0.12, 0.12),
          vy: rand(0.22, 0.5),
          vz: rand(-0.12, 0.12)
        };

        estate.push(st);

        ep[e * 3] = st.px;
        ep[e * 3 + 1] = st.py;
        ep[e * 3 + 2] = st.pz;
      }

      var emberGeo = new THREE.BufferGeometry();
      emberGeo.setAttribute('position', new THREE.BufferAttribute(ep, 3));
      emberGeo.setAttribute('color', new THREE.BufferAttribute(ec, 3));

      var emberMat = new THREE.PointsMaterial({
        size: 0.16,
        map: sprite,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        sizeAttenuation: true
      });

      var emberPts = new THREE.Points(emberGeo, emberMat);
      emberPts.frustumCulled = false;
      group.add(emberPts);

      camp = {
        group: group,
        flame: flame,
        light: light,
        emberGeo: emberGeo,
        emberState: estate,
        x: s.x,
        y: s.y,
        z: s.z
      };
    } catch (e) {
      camp = null;
    }
  }

  function updateCamp(el, dt, night) {
    if (!camp) return;

    camp.flame.scale.set(
      0.85 + 0.20 * Math.sin(el * 11),
      0.90 + 0.35 * Math.abs(Math.sin(el * 8)),
      0.85 + 0.20 * Math.cos(el * 10)
    );
    camp.flame.rotation.y = el * 0.7;

    camp.light.intensity = (0.55 + night * 1.35) * (0.70 + 0.45 * Math.abs(Math.sin(el * 12)));

    var arr = camp.emberGeo.attributes.position.array;
    var col = camp.emberGeo.attributes.color.array;

    for (var i = 0; i < camp.emberState.length; i++) {
      var e = camp.emberState[i];

      e.life -= dt;

      if (e.life <= 0) {
        e.life = e.max;
        e.px = rand(-0.16, 0.16);
        e.py = 0.15;
        e.pz = rand(-0.16, 0.16);
        e.vx = rand(-0.12, 0.12);
        e.vy = rand(0.22, 0.5);
        e.vz = rand(-0.12, 0.12);
      }

      e.px += e.vx * dt;
      e.py += e.vy * dt;
      e.pz += e.vz * dt;

      var f = Math.max(0, e.life / e.max);

      arr[i * 3] = e.px;
      arr[i * 3 + 1] = e.py;
      arr[i * 3 + 2] = e.pz;

      col[i * 3] = 1.0 * f;
      col[i * 3 + 1] = 0.5 * f;
      col[i * 3 + 2] = 0.15 * f;
    }

    camp.emberGeo.attributes.position.needsUpdate = true;
    camp.emberGeo.attributes.color.needsUpdate = true;
  }

  /* ── planted hook ── */
  api.onPlanted.push(function (t, interactive) {
    if (!interactive) return;
    if (!effectsOK()) return;

    recent.push(t);
    if (recent.length > 18) recent.shift();

    var c = subjectColor(t.subject || 'physics');

    burst(
      t.x,
      api.topY(t),
      t.z,
      c.r,
      c.g,
      c.b,
      t.oak ? 26 : 16
    );

    shockwave(t.x, t.y, t.z, c);
    tryBuildCamp();
  });

  /* ── frame loop ── */
  api.onFrame.push(function (el, dt) {
    try {
      var night = nightFactor();
      var fx = effectsOK();

      if (starMat) starMat.opacity = night * 0.85;
      if (flowerMat) flowerMat.opacity = 0.38 + 0.18 * Math.sin(el * 1.7) + night * 0.12;

      if (fx) {
        updateFireflies(el, night);
        updateSparkles(dt);
        updateWaves();
        updateHalos(el);
        updateCamp(el, dt, night);

        if (!camp && el - lastCampTry > 2.5 && campAttempts < 30 && totalTrees() >= 3) {
          lastCampTry = el;
          tryBuildCamp();
        }
      }

      if (el - lastStreakCheck > 2) {
        lastStreakCheck = el;
        streak = streakDays();
      }

      var k = Math.min(1, streak / 7) * 0.35;
      if (k > 0 && api.env.sun) {
        api.env.sun.color.lerp(warm, Math.min(1, dt * 1.5) * k);
        if (api.env.hemi) api.env.hemi.color.lerp(warm, Math.min(1, dt) * k * 0.6);
      }

      if (fx && api.env.water) {
        api.env.water.material.opacity = 0.80 + 0.05 * Math.sin(el * 0.9);
        if (api.env.skyBot) {
          api.env.water.material.color.copy(api.env.skyBot).lerp(deepWater, 0.55);
        }
      }
    } catch (e) {
      // never break the island
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})();
