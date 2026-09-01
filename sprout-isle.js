/* ============================================================================
   sprout-isle.js — "Sprout Isle" · a living study island (APP BUILD)
   Replaces grove-islands.js as the dashboard forest.

   Engine: extracted 1:1 from the standalone sprout-isle prototype. The §5
   contract stays frozen — window.Isle = {setState, event, buy, debug, mount,
   setPanelVisible} — with two ADDITIVE embed hooks (start/stop) so the app
   can pause the render loop while the dashboard card is off-screen.

   App bridge (read-only feeds, polled — no app module writes isle state):
     - jeemax_forest_daily_v1 (localStorage)     → solvedToday
     - window._studySecsForCns (live object)     → focusSecondsToday
     - window._dailyHistoryCache (ledger)        → streakDays / missedDays
     - jeemax_directive_v1 + _meta (IDB mirror)  → directive quests / golden
     - window.AppState.examDate                  → daysToExam sign
     - jmax:pomo-block-done / jmax:pomo-forfeit  → rain / forfeit moments
   The isle keeps its own world save (sproutIsle.v2): trees, seeds, cosmetics.
   ========================================================================= */
(function () {
'use strict';
if (window.__sproutIsleInit) return; window.__sproutIsleInit = true;

var MOMENTUM_SELECTOR = '#view-dashboard .dash-card-momentum';

const $id = x => document.getElementById(x);   /* engine helper, was module-level in the prototype */

function isleFatal(msg) {
  var el = document.getElementById('isleFallback');
  if (!el) return;
  el.dataset.mode = 'fatal'; el.style.display = 'flex'; el.innerHTML = msg;
}

/* ---- host injection: the isle takes over the Momentum card (same spot the
   Grove used). Must run BEFORE the engine boots — it grabs #isle-root at
   init — so this is synchronous at script eval, not after three.js loads. */
function mountHost() {
  try {
    var card = document.querySelector(MOMENTUM_SELECTOR);
    if (!card) return false;
    var kids = Array.prototype.slice.call(card.children);
    kids.forEach(function (c) {
      if (c.id === 'isle-root') return;
      c.classList.add('isle-orig');
    });
    var host = document.createElement('div');
    host.id = 'isle-root';
    host.className = 'isle-host';
    host.innerHTML =
      '<div class="isle-vignette" aria-hidden="true"></div>' +
      '<div class="isle-fallback" id="isleFallback">growing your isle 🌱</div>';
    card.appendChild(host);
    card.classList.add('isle-active');
    return true;
  } catch (e) { return false; }
}

if (!mountHost()) {
  console.warn('[sprout-isle] Momentum card not found — isle skipped.');
  return;
}

/* ---- three.js loader: vendored build FIRST (offline-first, SW-precached),
   CDNs only as fallbacks — same policy grove-islands used. ---- */
(async function loadThree() {
  var THREE = null;
  try { THREE = await import('./vendor/three/three.module.min.js'); }
  catch (e1) {
    try { THREE = await import('https://unpkg.com/three@0.160.0/build/three.module.js'); }
    catch (e2) {
      try { THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'); }
      catch (e3) {
        isleFatal("couldn't load three.js 🌱<br>open the app while online once,<br><small>so the vendored engine copy can be cached.</small>");
        return;
      }
    }
  }
  try { boot(THREE); startBridge(); }
  catch (err) {
    console.error('[sprout-isle]', err);
    isleFatal('sprout isle hit a snag: <small>' + (err && err.message ? err.message : err) + '</small>');
  }
})();

function boot(THREE){
'use strict';

/* ---------- canvas roundRect polyfill (older Safari) ---------- */
if(window.CanvasRenderingContext2D && !CanvasRenderingContext2D.prototype.roundRect){
  CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,r){
    r=Math.min(typeof r==='number'?r:8,w/2,h/2);
    this.moveTo(x+r,y); this.arcTo(x+w,y,x+w,y+h,r); this.arcTo(x+w,y+h,x,y+h,r);
    this.arcTo(x,y+h,x,y,r); this.arcTo(x,y,x+w,y,r); this.closePath(); return this;
  };
}

/* ---------- tiny utils ---------- */
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const clamp01=v=>clamp(v,0,1);
const lerp=(a,b,t)=>a+(b-a)*t;
const damp=(a,b,l,dt)=>lerp(a,b,1-Math.exp(-l*dt));
const smooth=(a,b,x)=>{const t=clamp01((x-a)/(b-a));return t*t*(3-2*t);};
const rand=(a,b)=>a+Math.random()*(b-a);
const pick=arr=>arr[(Math.random()*arr.length)|0];
const easeOutCubic=t=>1-Math.pow(1-clamp01(t),3);
const easeOutBack=t=>{t=clamp01(t);const c=2.0;return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2);};
function dayKeyOf(ts){const d=new Date(ts);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function hash2(x,z){const s=Math.sin(x*127.1+z*311.7)*43758.5453;return s-Math.floor(s);}

/* ---------- palette & config ---------- */
const COL={cream:0xFFF6E9,mint:0xBFE3C6,peach:0xFFD9B3,sky:0xBDE3FF,coral:0xFFB4A2,gold:0xFFC94D,night:0x2E3350};
const R_ISLE=16, BLOCK=1500, WEEK_GOAL=36000, FRUIT_SECONDS=45, KEY='sproutIsle.v2', OLD_KEY='sprout-isle-v1';
const MOBILE=/iPad|iPhone|iPod|Android/.test(navigator.userAgent)||(navigator.maxTouchPoints>1&&Math.min(screen.width,screen.height)<820);
const SUBJECTS=['physics','chemistry','maths'];
const SPECIES={
  physics:{name:'sunpuff',shape:'puff',c1:0xFFB4A2,c2:0xFFD9B3},
  chemistry:{name:'fizzpine',shape:'cone',c1:0xBFE3C6,c2:0x96D3AC},
  maths:{name:'starbloom',shape:'star',c1:0xFFE3A3,c2:0xFFC94D},
  golden:{name:'golden tree',shape:'puff',c1:0xFFD98A,c2:0xFFC94D,golden:true}
};
const ITEMS={
  strawHat:{price:8,kind:'hat',label:'straw hat'},
  wizardCap:{price:12,kind:'hat',label:'wizard cap'},
  beanie:{price:8,kind:'hat',label:'beanie'},
  bunting:{price:10,kind:'decor',label:'flag bunting'},
  festoon:{price:12,kind:'decor',label:'lantern string'},
  duckie:{price:6,kind:'decor',label:'rubber duckie'},
  instantBloom:{price:6,kind:'consumable',label:'instant bloom'}
};
const POS={home:[-4.4,-1.4],desk:[-8.6,-0.6],study:[-7.5,-0.1],wilt:[7.3,-4.8],pond:[6.2,4.2],
  house:[-6.5,-3.5],bed:[-2.8,-6.2],stall:[2.2,-9.6],sign:[10.8,-7.6],gold:[-0.5,7.5]};
const PATH=[[-4.2,-2.6],[-1.6,-2.2],[1.0,-1.4],[3.4,-0.2],[5.6,-1.6],[7.8,-3.4],[9.6,-5.6]];
const LANTERN_SPOTS=[[-1.4,-1.1],[3.6,0.9],[8.0,-2.3]];
const EXCLUDE=[[POS.pond,4.6],[POS.house,3.2],[POS.bed,2.6],[POS.stall,2.8],[POS.sign,2.4],[POS.desk,2.4],[POS.wilt,2.4],[POS.gold,2.6],[POS.home,1.8]];
function tooClose(x,z,extraPad){
  for(const e of EXCLUDE){ if(Math.hypot(x-e[0][0],z-e[0][1])<e[1]+(extraPad||0)) return true; }
  return false;
}

/* ---------- audio: tiny music box ---------- */
const AudioKit={
  ctx:null,master:null,bus:null,on:false,
  ensure(){ if(this.ctx) return true;
    try{ const C=window.AudioContext||window.webkitAudioContext; if(!C) return false;
      this.ctx=new C(); this.master=this.ctx.createGain(); this.master.gain.value=this.on?0.55:0;
      this.master.connect(this.ctx.destination);
      this.bus=this.ctx.createGain(); this.bus.gain.value=1; this.bus.connect(this.master);
      const d=this.ctx.createDelay(0.8); d.delayTime.value=0.24;
      const fb=this.ctx.createGain(); fb.gain.value=0.22; const wet=this.ctx.createGain(); wet.gain.value=0.3;
      this.bus.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(this.master);
    }catch(e){ return false; }
    return true;
  },
  unlock(){ if(this.ensure()&&this.ctx.state==='suspended') this.ctx.resume().catch(()=>{}); },
  setOn(v){ this.on=!!v; if(this.ensure()){ this.unlock(); this.master.gain.value=v?0.55:0; } },
  note(f,when,dur,vol,type){ if(!this.on||!this.ctx) return; dur=dur||0.55; vol=vol||0.35; when=when||0;
    const t=this.ctx.currentTime+when;
    const o=this.ctx.createOscillator(); o.type=type||'sine'; o.frequency.value=f;
    const o2=this.ctx.createOscillator(); o2.type='sine'; o2.frequency.value=f*2;
    const g2=this.ctx.createGain(); g2.gain.value=0.22;
    const g=this.ctx.createGain();
    g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(vol,t+0.02);
    g.gain.exponentialRampToValueAtTime(0.0008,t+dur);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(this.bus);
    o.start(t); o.stop(t+dur+0.15); o2.start(t); o2.stop(t+dur+0.15);
  }
};
const PENT=[523.25,587.33,659.25,783.99,880,1046.5,1174.66];
const sfx={
  solve(n){ const i=Math.min(5,n%6); AudioKit.note(PENT[i],0,0.5,0.3); AudioKit.note(PENT[i+1],0.09,0.6,0.3); },
  seed(){ AudioKit.note(392,0,0.4,0.22); },
  mature(){ AudioKit.note(PENT[2],0,0.6,0.32); AudioKit.note(PENT[4],0.1,0.6,0.32); AudioKit.note(PENT[6],0.2,0.8,0.3); },
  block(){ AudioKit.note(PENT[0],0,0.7,0.3); AudioKit.note(PENT[2],0.12,0.8,0.3); },
  forfeit(){ AudioKit.note(PENT[0]*0.5,0,0.8,0.2); },
  fullClear(){ [0,2,4,5,4,2,4,6].forEach((ix,i)=>AudioKit.note(PENT[Math.min(6,ix)],i*0.13,0.55,0.3)); },
  milestone(){ [0,2,4,5].forEach((ix,i)=>AudioKit.note(PENT[ix],i*0.11,0.6,0.32)); },
  buy(){ AudioKit.note(PENT[4],0,0.3,0.3); AudioKit.note(PENT[5],0.09,0.5,0.3); },
  harvest(){ AudioKit.note(PENT[4],0,0.35,0.22); },
  pet(){ AudioKit.note(PENT[3],0,0.3,0.18); },
  chirp(){ AudioKit.note(PENT[5]*2,0,0.15,0.12); },
  dayAmbient(){ AudioKit.note(PENT[0],0,1.3,0.05); AudioKit.note(PENT[2],0.4,1.5,0.045); }
};

/* ---------- world state ---------- */
const W={
  ready:false, dayKey:dayKeyOf(Date.now()),
  focusHighWater:0, history:{}, seeds:0, lastAppSeeds:null,
  trees:[], nextId:1, plantedToday:0, fallbackCycle:0,
  owned:[], hat:null, milestones:[], goldTreeDays:[],
  appState:null, appClock:null, golden:false,
  focusPulseMs:-1e12, rainUntil:0, cloudRainTarget:null, pondBoost:0,
  birds:[], birdTarget:0, lastBirdChange:0,
  drought:0, missedActive:false, dayF:1, nightF:0, goldF:0,
  harvestQueue:[], lastHarvestScan:0,
  petting:false, lastFullClearEvt:-1e12, lastHeadlineEvt:-1e12,
  wind:1, timelapse:false, ambT:9, rippleT:3.5, movedIn:false
};
let SAVE=null;
try{ const raw=localStorage.getItem(KEY); if(raw) SAVE=JSON.parse(raw); }catch(e){ SAVE=null; }
/* migrate a v1 world (the older prototype) so nothing the user grew is lost */
if(!SAVE){
  try{
    const old=JSON.parse(localStorage.getItem(OLD_KEY)||'null');
    if(old&&old.trees&&old.trees.length){
      SAVE={v:1, day:old.lastDate||null, focusHW:0, hist:{},
        trees:old.trees.map((t,i)=>({id:i+1,subject:t.subject,diff:typeof t.difficulty==='number'?t.difficulty:0.3,
          gold:false,x:t.position&&t.position.x?t.position.x:rand(-8,8),z:t.position&&t.position.z?t.position.z:rand(-8,8),
          progress:typeof t.growth==='number'?t.growth:0,budget:t.growthBudget||3000,mp:!!t.matured,fp:0,hd:''})),
        nextId:old.trees.length+1, plantedToday:0, seeds:old.seeds||0, lastAppSeeds:null,
        owned:[], hat:(old.cosmetics&&old.cosmetics.pipHat)||null,
        milestones:Object.keys(old.milestones||{}).filter(k=>old.milestones[k]).map(Number),
        goldDays:[], demo:null, sound:!!old.soundEnabled};
      W.movedIn=true;
    }
  }catch(e){}
}
let saveTimer=0;
function queueSave(){ clearTimeout(saveTimer); saveTimer=setTimeout(save,700); }
function save(){
  try{
    localStorage.setItem(KEY,JSON.stringify({
      v:1, day:W.dayKey, focusHW:W.focusHighWater, hist:W.history,
      trees:W.trees.map(t=>({id:t.id,subject:t.subject,diff:t.diff,gold:t.gold,x:t.x,z:t.z,
        progress:t.progress,budget:t.budget,mp:t.maturePopped,fp:t.fruitP,hd:t.harvestedDay})),
      nextId:W.nextId, plantedToday:W.plantedToday, seeds:W.seeds, lastAppSeeds:W.lastAppSeeds,
      owned:W.owned, hat:W.hat, milestones:W.milestones, goldDays:W.goldTreeDays,
      demo:(typeof getDemoSnapshot==='function')?getDemoSnapshot():null,
      sound:AudioKit.on
    }));
  }catch(e){}
}

/* ---------- renderer / scene ---------- */
const rootEl=$id('isle-root')||document.body;
let renderer;
try{
  renderer=new THREE.WebGLRenderer({antialias:true});
}catch(e){ isleFatal('your browser couldn\'t start WebGL 🌱<br>'+e.message); throw e; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, MOBILE?1.5:1.75));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.06;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate=false;   /* throttled in the loop: shadows refresh every 2nd frame */
renderer.shadowMap.needsUpdate=true;
rootEl.appendChild(renderer.domElement);
renderer.domElement.style.touchAction='none';

const scene=new THREE.Scene();
scene.fog=new THREE.Fog(0xF7E8D8,70,175);
const camera=new THREE.PerspectiveCamera(46,1,0.1,400);

const hemi=new THREE.HemisphereLight(0xDFF3FF,0xFFE6CC,0.95); scene.add(hemi);
const amb=new THREE.AmbientLight(0xFFF3E0,0.3); scene.add(amb);
const keyLight=new THREE.DirectionalLight(0xFFE2B8,1.35);
keyLight.position.set(26,40,16); keyLight.castShadow=true;
keyLight.shadow.mapSize.set(MOBILE?1024:2048,MOBILE?1024:2048);
keyLight.shadow.camera.left=-26; keyLight.shadow.camera.right=26;
keyLight.shadow.camera.top=26; keyLight.shadow.camera.bottom=-26;
keyLight.shadow.camera.near=5; keyLight.shadow.camera.far=140;
keyLight.shadow.bias=-0.0006;
scene.add(keyLight);

/* ---------- sky dome / stars / sun / moon ---------- */
const skyCanvas=document.createElement('canvas'); skyCanvas.width=64; skyCanvas.height=256;
const skyCtx=skyCanvas.getContext('2d');
const skyTex=new THREE.CanvasTexture(skyCanvas); skyTex.colorSpace=THREE.SRGBColorSpace;
const skyDome=new THREE.Mesh(new THREE.SphereGeometry(160,24,16),
  new THREE.MeshBasicMaterial({map:skyTex,side:THREE.BackSide,fog:false}));
scene.add(skyDome);
let lastSkyF=-1, lastGoldF=-1;
function paintSky(f,gold){
  gold=gold||0;
  const top=new THREE.Color(COL.sky).lerp(new THREE.Color(0x262B47),1-f);
  const hor=new THREE.Color(0xFFF1DA).lerp(new THREE.Color(0x5A5480),1-f);
  if(gold>0) hor.lerp(new THREE.Color(0xFFC79E),gold*0.7);
  const g=skyCtx.createLinearGradient(0,0,0,256);
  g.addColorStop(0,'#'+top.getHexString());
  g.addColorStop(0.55,'#'+hor.getHexString());
  g.addColorStop(1,'#'+hor.clone().lerp(new THREE.Color(0x3E3A5C),1-f).getHexString());
  skyCtx.fillStyle=g; skyCtx.fillRect(0,0,64,256); skyTex.needsUpdate=true;
}
function radialTex(inner,outer){
  const c=document.createElement('canvas'); c.width=c.height=128;
  const x=c.getContext('2d'); const g=x.createRadialGradient(64,64,4,64,64,62);
  g.addColorStop(0,inner); g.addColorStop(0.5,outer); g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g; x.fillRect(0,0,128,128);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t;
}
const sunSprite=new THREE.Sprite(new THREE.SpriteMaterial({map:radialTex('rgba(255,250,220,1)','rgba(255,214,140,0.55)'),transparent:true,depthWrite:false,fog:false}));
sunSprite.scale.setScalar(30); scene.add(sunSprite);
const moonSprite=new THREE.Sprite(new THREE.SpriteMaterial({map:radialTex('rgba(250,250,255,0.95)','rgba(190,200,255,0.4)'),transparent:true,depthWrite:false,fog:false}));
moonSprite.scale.setScalar(20); scene.add(moonSprite);
const starGeo=new THREE.BufferGeometry();
{ const n=220, arr=new Float32Array(n*3);
  for(let i=0;i<n;i++){ const a=Math.random()*Math.PI*2, e=Math.random()*Math.PI*0.45+0.12, r=140;
    arr[i*3]=Math.cos(a)*Math.cos(e)*r; arr[i*3+1]=Math.sin(e)*r; arr[i*3+2]=Math.sin(a)*Math.cos(e)*r; }
  starGeo.setAttribute('position',new THREE.BufferAttribute(arr,3)); }
const starMat=new THREE.PointsMaterial({color:0xFFF7E0,size:1.6,sizeAttenuation:false,transparent:true,opacity:0,fog:false,depthWrite:false});
scene.add(new THREE.Points(starGeo,starMat));

/* ---------- island terrain ---------- */
function islandH(r){ const t=clamp01(r/R_ISLE); return 3.4*Math.pow(Math.max(0,1-t*t),0.85); }
function groundY(x,z){ return islandH(Math.hypot(x,z)); }
const wiltMats=[];
function regWilt(mat,hex){ mat.userData.base=new THREE.Color(hex); wiltMats.push(mat); return mat; }
{
  const N=26, pts=[];
  for(let i=0;i<=N;i++){ const r=(i/N)*R_ISLE; pts.push(new THREE.Vector2(Math.max(r,0.001),islandH(r))); }
  const geo=new THREE.LatheGeometry(pts,56);
  const pos=geo.attributes.position, cols=new Float32Array(pos.count*3);
  const cA=new THREE.Color(0xB9E2C1), cB=new THREE.Color(0xA2D6AC), cRim=new THREE.Color(0xF0DFC0), tmp=new THREE.Color();
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i), y=pos.getY(i), z=pos.getZ(i), r=Math.hypot(x,z);
    const n=hash2(Math.round(x*4)/4,Math.round(z*4)/4);
    if(r>0.5){ const d=(n-0.5)*0.5; pos.setX(i,x+(x/r)*d); pos.setZ(i,z+(z/r)*d); }
    tmp.copy(cA).lerp(cB,n); if(r>R_ISLE*0.9) tmp.lerp(cRim,(r-R_ISLE*0.9)/(R_ISLE*0.1));
    cols[i*3]=tmp.r; cols[i*3+1]=tmp.g; cols[i*3+2]=tmp.b;
  }
  geo.setAttribute('color',new THREE.BufferAttribute(cols,3));
  geo.computeVertexNormals();
  const mound=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));
  mound.receiveShadow=true; scene.add(mound);
  W.moundMat=mound.material;

  const pts2=[];
  for(let i=0;i<=20;i++){ const t=i/20;
    const r=0.6+(R_ISLE-0.7)*Math.pow(1-t,0.8);
    pts2.push(new THREE.Vector2(r,-9.8*Math.pow(t,1.1)-0.02)); }
  const geo2=new THREE.LatheGeometry(pts2,48);
  const pos2=geo2.attributes.position, cols2=new Float32Array(pos2.count*3);
  const rA=new THREE.Color(0xD9B79B), rB=new THREE.Color(0x8E7A8C);
  for(let i=0;i<pos2.count;i++){
    const x=pos2.getX(i), y=pos2.getY(i), z=pos2.getZ(i), r=Math.hypot(x,z);
    const n=hash2(Math.round(x*3)/3,Math.round(z*3)/3);
    if(r>0.8){ const d=(n-0.5)*1.1; pos2.setX(i,x+(x/r)*d); pos2.setZ(i,z+(z/r)*d); }
    tmp.copy(rA).lerp(rB,clamp01(-y/9.8));
    cols2[i*3]=tmp.r; cols2[i*3+1]=tmp.g; cols2[i*3+2]=tmp.b;
  }
  geo2.setAttribute('color',new THREE.BufferAttribute(cols2,3));
  geo2.computeVertexNormals();
  const rock=new THREE.Mesh(geo2,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));
  scene.add(rock);
}

/* ---------- pond (+ lily pad) ---------- */
const pondGroup=new THREE.Group();
const pondY=groundY(POS.pond[0],POS.pond[1])+0.06;
pondGroup.position.set(POS.pond[0],pondY,POS.pond[1]); scene.add(pondGroup);
const pondMat=new THREE.MeshPhongMaterial({color:0x8FD4E8,transparent:true,opacity:0.92,shininess:90,specular:0xFFFFFF});
const pondMesh=new THREE.Mesh(new THREE.CircleGeometry(3.1,40),pondMat);
pondMesh.rotation.x=-Math.PI/2; pondMesh.receiveShadow=true; pondGroup.add(pondMesh);
const shoreMat=new THREE.MeshLambertMaterial({color:COL.mint,side:THREE.DoubleSide});
regWilt(shoreMat,COL.mint);
const shoreMesh=new THREE.Mesh(new THREE.RingGeometry(3.15,4.5,40),shoreMat);
shoreMesh.rotation.x=-Math.PI/2; shoreMesh.position.y=-0.03; pondGroup.add(shoreMesh);
const pondGlint=new THREE.Sprite(new THREE.SpriteMaterial({map:radialTex('rgba(255,255,255,0.5)','rgba(255,255,255,0.12)'),transparent:true,depthWrite:false}));
pondGlint.scale.set(2.4,1.2,1); pondGlint.position.y=0.08; pondGroup.add(pondGlint);
let pondLevel=0.5, pondLevelTarget=0.5;
const lilyPad=new THREE.Group();
{
  const pad=new THREE.Mesh(new THREE.CircleGeometry(0.62,20,0.5,5.6),
    new THREE.MeshLambertMaterial({color:0x6FAF7E,side:THREE.DoubleSide}));
  pad.rotation.x=-Math.PI/2; pad.position.y=0.04; lilyPad.add(pad);
  const bloom=new THREE.Mesh(new THREE.SphereGeometry(0.13,8,6),
    new THREE.MeshLambertMaterial({color:0xFFC7CE}));
  bloom.position.set(0.12,0.1,-0.1); lilyPad.add(bloom);
  lilyPad.position.set(POS.pond[0]+1.4,pondY,POS.pond[1]-1.1);
  scene.add(lilyPad);
}

/* ---------- props: house / desk / bed / sign / stall / path / wilt / mushrooms ---------- */
const nightGlows=[];
function glowMat(hex,intensity){ const m=new THREE.MeshLambertMaterial({color:hex,emissive:hex,emissiveIntensity:0.1}); nightGlows.push({m,i:intensity||0.9}); return m; }

const houseG=new THREE.Group(); houseG.position.set(POS.house[0],groundY(...POS.house),POS.house[1]);
houseG.rotation.y=0.7; scene.add(houseG);
{
  const base=new THREE.Mesh(new THREE.CylinderGeometry(1.7,1.85,1.9,20),new THREE.MeshLambertMaterial({color:0xFFF0DC}));
  base.position.y=0.95; base.castShadow=true; houseG.add(base);
  const cap=new THREE.Mesh(new THREE.SphereGeometry(2.35,20,14,0,Math.PI*2,0,Math.PI/2),regWilt(new THREE.MeshLambertMaterial({color:COL.coral}),COL.coral));
  cap.scale.y=0.85; cap.position.y=1.9; cap.castShadow=true; houseG.add(cap);
  const door=new THREE.Mesh(new THREE.BoxGeometry(0.8,1.1,0.1),new THREE.MeshLambertMaterial({color:0x8A6A52}));
  door.position.set(0,0.6,1.78); houseG.add(door);
  const win=new THREE.Mesh(new THREE.CircleGeometry(0.34,16),glowMat(0xFFD9A0,1.1));
  win.position.set(0.85,1.25,1.62); win.rotation.y=0.5; houseG.add(win);
  const winLight=new THREE.PointLight(0xFFC97A,0,9,2); winLight.position.set(0.9,1.4,1.9); houseG.add(winLight);
  nightGlows.push({light:winLight,i:1.1});
}
const deskG=new THREE.Group(); deskG.position.set(POS.desk[0],groundY(...POS.desk),POS.desk[1]);
deskG.rotation.y=-0.6; scene.add(deskG);
let bookPage;
{
  const wood=new THREE.MeshLambertMaterial({color:0xE3C093});
  const top=new THREE.Mesh(new THREE.BoxGeometry(1.5,0.1,0.95),wood); top.position.y=0.92; top.castShadow=true; deskG.add(top);
  const l1=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.9,0.8),wood); l1.position.set(-0.62,0.45,0); deskG.add(l1);
  const l2=l1.clone(); l2.position.x=0.62; deskG.add(l2);
  const book=new THREE.Mesh(new THREE.BoxGeometry(0.62,0.06,0.44),new THREE.MeshLambertMaterial({color:0xFFF6E9}));
  book.position.y=1.0; deskG.add(book);
  bookPage=new THREE.Mesh(new THREE.PlaneGeometry(0.28,0.4),new THREE.MeshLambertMaterial({color:0xFFFDF6,side:THREE.DoubleSide}));
  bookPage.position.set(0,1.05,0); deskG.add(bookPage);
}
const bedG=new THREE.Group(); bedG.position.set(POS.bed[0],groundY(...POS.bed),POS.bed[1]);
bedG.rotation.y=0.35; scene.add(bedG);
{
  const soil=new THREE.Mesh(new THREE.BoxGeometry(4.4,0.5,3.0),new THREE.MeshLambertMaterial({color:0x9A7354}));
  soil.position.y=0.25; soil.receiveShadow=true; bedG.add(soil);
  const frame=new THREE.MeshLambertMaterial({color:0xE3C093});
  [[0,1.55],[0,-1.55]].forEach(p=>{ const e=new THREE.Mesh(new THREE.BoxGeometry(4.6,0.34,0.18),frame); e.position.set(p[0],0.42,p[1]); bedG.add(e); });
  [[2.25,0],[-2.25,0]].forEach(p=>{ const e=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.34,3.2),frame); e.position.set(p[0],0.42,p[1]); bedG.add(e); });
}
const signG=new THREE.Group(); signG.position.set(POS.sign[0],groundY(...POS.sign),POS.sign[1]);
signG.rotation.y=-2.2; scene.add(signG);
const signCanvas=document.createElement('canvas'); signCanvas.width=512; signCanvas.height=256;
const signTex=new THREE.CanvasTexture(signCanvas); signTex.colorSpace=THREE.SRGBColorSpace;
let lastExam=null;
function paintSign(days){
  const x=signCanvas.getContext('2d'); x.clearRect(0,0,512,256);
  x.fillStyle='#EAC79A'; x.strokeStyle='#C79B6B'; x.lineWidth=12;
  x.beginPath(); x.roundRect(14,14,484,228,34); x.fill(); x.stroke();
  x.fillStyle='#6B4A2F'; x.textAlign='center'; x.font='800 84px system-ui, sans-serif';
  x.fillText(days+' days ✨',256,128);
  x.fillStyle='#8A6A4F'; x.font='700 44px system-ui, sans-serif';
  x.fillText('until your exam',256,200);
  signTex.needsUpdate=true;
}
{
  const post=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.14,2.3,8),new THREE.MeshLambertMaterial({color:0xB98A5F}));
  post.position.y=1.1; post.castShadow=true; signG.add(post);
  const plank=new THREE.Mesh(new THREE.BoxGeometry(2.7,1.25,0.14),new THREE.MeshLambertMaterial({color:0xEAC79A}));
  plank.position.y=2.1; plank.castShadow=true; signG.add(plank);
  const face=new THREE.Mesh(new THREE.PlaneGeometry(2.6,1.15),new THREE.MeshLambertMaterial({map:signTex,transparent:true}));
  face.position.set(0,2.1,0.09); signG.add(face);
  signG.userData.i={type:'sign'};
}
const stallG=new THREE.Group(); stallG.position.set(POS.stall[0],groundY(...POS.stall),POS.stall[1]);
stallG.rotation.y=0.25; scene.add(stallG);
{
  const wood=new THREE.MeshLambertMaterial({color:0xE8C69B});
  const counter=new THREE.Mesh(new THREE.BoxGeometry(2.7,0.95,1.1),wood); counter.position.y=0.5; counter.castShadow=true; stallG.add(counter);
  const p1=new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,2.3,8),wood); p1.position.set(-1.25,1.15,-0.45); stallG.add(p1);
  const p2=p1.clone(); p2.position.x=1.25; stallG.add(p2);
  const aw=new THREE.Mesh(new THREE.PlaneGeometry(3.1,1.5),new THREE.MeshLambertMaterial({color:0xFFFFFF,side:THREE.DoubleSide}));
  { const c=document.createElement('canvas'); c.width=128; c.height=64; const x=c.getContext('2d');
    for(let i=0;i<8;i++){ x.fillStyle=i%2?'#FFF6E9':'#FFB4A2'; x.fillRect(i*16,0,16,64); }
    const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace;
    aw.material=new THREE.MeshLambertMaterial({map:t,side:THREE.DoubleSide}); }
  aw.position.set(0,2.25,0.1); aw.rotation.x=-0.5; stallG.add(aw);
  const sc=document.createElement('canvas'); sc.width=256; sc.height=96; const sx=sc.getContext('2d');
  sx.fillStyle='#FFF6E9'; sx.beginPath(); sx.roundRect(4,4,248,88,26); sx.fill();
  sx.fillStyle='#7A6350'; sx.font='800 44px system-ui, sans-serif'; sx.textAlign='center'; sx.fillText('🌰 seed stall',128,62);
  const st=new THREE.CanvasTexture(sc); st.colorSpace=THREE.SRGBColorSpace;
  const board=new THREE.Mesh(new THREE.PlaneGeometry(1.7,0.62),new THREE.MeshLambertMaterial({map:st,transparent:true}));
  board.position.set(0,1.35,0.58); stallG.add(board);
  stallG.userData.i={type:'stall'};
}
PATH.forEach((p,i)=>{
  const st=new THREE.Mesh(new THREE.CylinderGeometry(0.72-(i%2)*0.1,0.8,0.14,10),new THREE.MeshLambertMaterial({color:0xEFE0C8}));
  st.position.set(p[0],groundY(p[0],p[1])+0.05,p[1]); st.receiveShadow=true; scene.add(st);
});
const wiltG=new THREE.Group(); wiltG.position.set(POS.wilt[0],groundY(...POS.wilt),POS.wilt[1]); scene.add(wiltG);
{
  const patch=new THREE.Mesh(new THREE.CircleGeometry(1.4,20),new THREE.MeshLambertMaterial({color:0xC9A48A}));
  patch.rotation.x=-Math.PI/2; patch.position.y=0.02; wiltG.add(patch);
  for(let i=0;i<3;i++){
    const s=new THREE.Mesh(new THREE.ConeGeometry(0.07,0.5,6),new THREE.MeshLambertMaterial({color:0xB09A6E}));
    s.position.set(Math.cos(i*2.1)*0.6,0.2,Math.sin(i*2.1)*0.6); s.rotation.z=0.9; wiltG.add(s);
  }
}
{ /* tiny mushrooms by pip's house */
  const spots=[[-4.9,-1.9],[-5.4,-1.2],[-4.4,-0.9]];
  spots.forEach(s=>{
    const g=new THREE.Group(); g.position.set(s[0],groundY(s[0],s[1]),s[1]); scene.add(g);
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.08,0.16,8),new THREE.MeshLambertMaterial({color:0xFFF0DC}));
    stem.position.y=0.08; g.add(stem);
    const cap=new THREE.Mesh(new THREE.SphereGeometry(0.13,10,8,0,Math.PI*2,0,Math.PI/2),new THREE.MeshLambertMaterial({color:0xFF8A7A}));
    cap.position.y=0.16; g.add(cap);
    const dot=new THREE.Mesh(new THREE.SphereGeometry(0.028,6,4),new THREE.MeshLambertMaterial({color:0xFFF6E9}));
    dot.position.set(0.06,0.26,0.05); g.add(dot);
    const dot2=dot.clone(); dot2.position.set(-0.06,0.24,-0.04); g.add(dot2);
  });
}

/* ---------- scattered island life (instanced: grass, wildflowers, pebbles) ---------- */
function scatter(){
  const dummy=new THREE.Object3D();
  function freeSpot(minR,maxR){
    for(let k=0;k<24;k++){
      const a=Math.random()*Math.PI*2, r=rand(minR,maxR);
      const x=Math.cos(a)*r, z=Math.sin(a)*r;
      if(!tooClose(x,z,0.4)) return [x,z];
    }
    return null;
  }
  /* grass tufts */
  const gGeo=new THREE.ConeGeometry(0.09,0.36,5);
  const gMat=new THREE.MeshLambertMaterial({color:0x8CC79A});
  const grass=new THREE.InstancedMesh(gGeo,gMat,150);
  let gi=0;
  while(gi<150){
    const s=freeSpot(1.5,14.2); if(!s) break;
    dummy.position.set(s[0],groundY(s[0],s[1])+0.14,s[1]);
    dummy.rotation.set(rand(-0.18,0.18),Math.random()*6.28,rand(-0.18,0.18));
    const sc=rand(0.7,1.5); dummy.scale.set(sc,sc,sc);
    dummy.updateMatrix(); grass.setMatrixAt(gi,dummy.matrix); gi++;
  }
  grass.count=gi; grass.instanceMatrix.needsUpdate=true; scene.add(grass);
  /* wildflowers with per-instance pastel colors */
  const fGeo=new THREE.SphereGeometry(0.085,7,6);
  const fMat=new THREE.MeshLambertMaterial({color:0xFFFFFF});
  const flowers=new THREE.InstancedMesh(fGeo,fMat,54);
  const fCols=[0xFFB4A2,0xFFC7CE,0xFFE3A3,0xBFE3C6,0xE3B8EA];
  let fi=0;
  while(fi<54){
    const s=freeSpot(1.5,13.8); if(!s) break;
    dummy.position.set(s[0],groundY(s[0],s[1])+0.09,s[1]);
    dummy.rotation.set(0,0,0);
    const sc=rand(0.7,1.2); dummy.scale.set(sc,sc,sc);
    dummy.updateMatrix(); flowers.setMatrixAt(fi,dummy.matrix);
    flowers.setColorAt(fi,new THREE.Color(pick(fCols))); fi++;
  }
  flowers.count=fi;
  if(flowers.instanceColor) flowers.instanceColor.needsUpdate=true;
  flowers.instanceMatrix.needsUpdate=true; scene.add(flowers);
  /* pebbles */
  const pGeo=new THREE.IcosahedronGeometry(0.13,0);
  const pMat=new THREE.MeshLambertMaterial({color:0xD8CDBB});
  const pebbles=new THREE.InstancedMesh(pGeo,pMat,26);
  let pi=0;
  while(pi<26){
    const s=freeSpot(1.2,14.5); if(!s) break;
    dummy.position.set(s[0],groundY(s[0],s[1])+0.05,s[1]);
    dummy.rotation.set(Math.random(),Math.random()*6.28,Math.random());
    dummy.scale.set(rand(0.6,1.5),rand(0.4,0.8),rand(0.6,1.5));
    dummy.updateMatrix(); pebbles.setMatrixAt(pi,dummy.matrix); pi++;
  }
  pebbles.count=pi; pebbles.instanceMatrix.needsUpdate=true; scene.add(pebbles);
}

/* ==== chunk b continues below ==== */

/* ---------- rain cloud ---------- */
const cloudG=new THREE.Group(); cloudG.position.set(0,17.5,0); scene.add(cloudG);
const cloudMats=[];
{
  const spots=[[0,0,0,2.2],[1.9,-0.2,0.6,1.6],[-1.9,-0.1,0.4,1.5],[0.8,0.7,-0.8,1.4],[-0.9,0.6,0.7,1.3],[0.2,-0.4,1.6,1.4]];
  spots.forEach(s=>{
    const m=new THREE.MeshLambertMaterial({color:0xFFFDF6});
    cloudMats.push(m);
    const b=new THREE.Mesh(new THREE.SphereGeometry(s[3],14,10),m);
    b.position.set(s[0],s[1],s[2]); b.userData.base=s.slice(); cloudG.add(b);
  });
  cloudG.userData.i={type:'cloud'};
}
let cloudFill=0;

/* ---------- rain / ripples / puddles ---------- */
const drops=[];
{ const g=new THREE.BoxGeometry(0.06,0.4,0.06);
  for(let i=0;i<80;i++){ const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0x9FD8E8,transparent:true,opacity:0.8}));
    m.visible=false; scene.add(m); drops.push({m,vy:0}); } }
const ripples=[];
{ const g=new THREE.RingGeometry(0.24,0.32,20);
  for(let i=0;i<14;i++){ const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0xCFEBF5,transparent:true,opacity:0}));
    m.rotation.x=-Math.PI/2; m.visible=false; scene.add(m); ripples.push({m,t:1}); } }
const puddles=[];
function spawnPuddles(){
  for(let i=0;i<4;i++){
    const a=Math.random()*6.28, r=rand(3,11), x=Math.cos(a)*r, z=Math.sin(a)*r;
    const m=new THREE.Mesh(new THREE.CircleGeometry(rand(0.5,0.95),16),new THREE.MeshBasicMaterial({color:0xA8DCEA,transparent:true,opacity:0}));
    m.rotation.x=-Math.PI/2; m.position.set(x,groundY(x,z)+0.05,z); scene.add(m);
    puddles.push({m,life:24});
  }
}
function spawnDrop(x,z,spread){
  const d=drops.find(d=>!d.m.visible); if(!d) return;
  d.m.visible=true; d.m.position.set(x+rand(-spread,spread),16+rand(-0.5,0.5),z+rand(-spread,spread));
  d.vy=rand(13,18);
}
function ripple(x,z,y){
  const r=ripples.find(r=>r.t>=1); if(!r) return;
  r.t=0; r.m.visible=true; r.m.position.set(x,(y!=null?y:groundY(x,z)+0.07),z);
}

/* ---------- petals / leaves ceremony particles ---------- */
const Petals={
  list:[], geo:new THREE.PlaneGeometry(0.34,0.34),
  mats:[0xFFC7CE,0xFFB4A2,0xBFE3C6,0xFFC94D,0xFFE3A3].map(c=>new THREE.MeshBasicMaterial({color:c,side:THREE.DoubleSide,transparent:true,opacity:1})),
  spawn(n,origin,spread,colors){
    for(let i=0;i<n;i++){
      const free=this.list.find(p=>p.life<=0);
      const p=free||{m:new THREE.Mesh(this.geo,this.mats[0])};
      if(!free){ scene.add(p.m); this.list.push(p); }
      if(this.list.length>90) return;
      p.m.material=colors?this.mats[pick(colors)]:pick(this.mats);
      p.m.visible=true;
      p.m.position.set(origin[0]+rand(-spread,spread),origin[1]+rand(0,3),origin[2]+rand(-spread,spread));
      p.vel=[rand(-1,1),rand(-2.4,-1.2),rand(-1,1)];
      p.rot=rand(1,4)*(Math.random()<0.5?-1:1);
      p.life=p.max=rand(2.2,3.4);
    }
  },
  update(dt){
    for(const p of this.list){ if(p.life<=0){ p.m.visible=false; continue; }
      p.life-=dt;
      p.m.position.x+=(p.vel[0]+Math.sin(p.life*4)*0.6)*dt;
      p.m.position.y+=p.vel[1]*dt; p.m.position.z+=p.vel[2]*dt;
      p.m.rotation.x+=p.rot*dt; p.m.rotation.z+=p.rot*0.7*dt;
      p.m.material.opacity=clamp01(p.life/0.6);
      if(p.m.position.y<groundY(p.m.position.x,p.m.position.z)+0.05) p.life=Math.min(p.life,0.4);
    }
  }
};

/* ---------- floating text sprites ---------- */
const floaters=[]; const texCache=new Map();
function textTexture(text,heart){
  const key=text+(heart?'♥':''); if(texCache.has(key)) return texCache.get(key);
  const c=document.createElement('canvas'); const x=c.getContext('2d');
  x.font='700 42px system-ui, sans-serif';
  const tw=heart?60:x.measureText(text).width;
  c.width=Math.ceil(tw+84); c.height=96;
  const g=x; /* same context — resizing the canvas resets state, not the object */
  g.fillStyle='rgba(255,251,242,0.95)'; g.strokeStyle='rgba(255,201,77,0.65)'; g.lineWidth=5;
  g.beginPath(); g.roundRect(6,6,c.width-12,c.height-12,40); g.fill(); g.stroke();
  g.font='700 42px system-ui, sans-serif'; g.textAlign='center'; g.textBaseline='middle';
  g.fillStyle=heart?'#F28BA8':'#7A6350';
  if(heart){ g.beginPath(); const cx=c.width/2, cy=52, s=15;
    g.moveTo(cx,cy+s); g.bezierCurveTo(cx-2*s,cy-s*0.6,cx-s*0.7,cy-s*1.6,cx,cy-s*0.4);
    g.bezierCurveTo(cx+s*0.7,cy-s*1.6,cx+2*s,cy-s*0.6,cx,cy+s); g.fill(); }
  else g.fillText(text,c.width/2,52);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; texCache.set(key,t);
  return t;
}
function floater(text,pos,scale){
  if(floaters.length>14){ const old=floaters.shift(); scene.remove(old.s); }
  const t=textTexture(text,false);
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false}));
  const sc=scale||1; s.scale.set((t.image.width/96)*sc*1.1,1.1*sc,1);
  s.position.copy(pos); scene.add(s); floaters.push({s,t:0});
}
function heartFloat(pos){
  const t=textTexture('h',true);
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false}));
  s.scale.set(0.7,0.7,1); s.position.copy(pos).add(new THREE.Vector3(rand(-0.4,0.4),1.9,rand(-0.2,0.2)));
  scene.add(s); floaters.push({s,t:0,heart:true});
}
function updateFloaters(dt){
  for(let i=floaters.length-1;i>=0;i--){ const f=floaters[i]; f.t+=dt;
    f.s.position.y+=dt*(f.heart?1.4:1.05);
    if(f.heart) f.s.position.x+=Math.sin(f.t*6)*dt*0.3;
    const o=f.t<0.15?f.t/0.15:1-smooth(1.5,2.2,f.t);
    f.s.material.opacity=clamp01(o);
    if(f.t>2.2){ scene.remove(f.s); floaters.splice(i,1); } }
}

/* ---------- rainbow & aurora ---------- */
const rainbowG=new THREE.Group(); rainbowG.position.y=1.2; rainbowG.rotation.y=-0.6; scene.add(rainbowG);
const rainbowMats=[];
[0xFF9AA2,0xFFB774,0xFFE38A,0xB8E6B8,0xA8D8EA,0xB8B8E6,0xE3B8EA].forEach((c,i)=>{
  const m=new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:0,side:THREE.DoubleSide});
  rainbowMats.push(m);
  const t=new THREE.Mesh(new THREE.TorusGeometry(11.5+i*0.55,0.3,6,48,Math.PI),m);
  t.scale.y=0.8; rainbowG.add(t);
});
let rainbowOp=0;
const auroraG=new THREE.Group(); scene.add(auroraG); const auroraRibbons=[];
for(let r=0;r<2;r++){
  const g=new THREE.PlaneGeometry(120,15,64,1);
  const cols=new Float32Array(g.attributes.position.count*3);
  const cA=new THREE.Color(0xFFC94D), cB=new THREE.Color(0xFFB4A2);
  for(let i=0;i<cols.length/3;i++){ const x=g.attributes.position.getX(i);
    const t=smooth(-60,60,x); const c=cA.clone().lerp(cB,t);
    cols[i*3]=c.r; cols[i*3+1]=c.g; cols[i*3+2]=c.b; }
  g.setAttribute('color',new THREE.BufferAttribute(cols,3));
  const m=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:0,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false});
  const mesh=new THREE.Mesh(g,m);
  mesh.position.set(0,34+r*7,-60+r*14); mesh.rotation.x=-0.15;
  mesh.userData.base=g.attributes.position.array.slice();
  auroraG.add(mesh); auroraRibbons.push(mesh);
}

/* ---------- shooting star (night only) ---------- */
const shootingStar={active:false,t0:0,next:rand(10,20)};
{
  const c=document.createElement('canvas'); c.width=128; c.height=32;
  const x=c.getContext('2d'); const g=x.createLinearGradient(0,0,128,0);
  g.addColorStop(0,'rgba(255,255,255,0)'); g.addColorStop(0.7,'rgba(255,250,230,0.85)'); g.addColorStop(1,'rgba(255,255,255,1)');
  x.fillStyle=g; x.fillRect(0,11,128,10);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace;
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,opacity:0,depthWrite:false,fog:false,blending:THREE.AdditiveBlending}));
  s.scale.set(14,1.0,1); s.visible=false; scene.add(s);
  shootingStar.s=s;
}
function updateShootingStar(dt,now,tSec){
  const s=shootingStar;
  if(!s.active&&W.nightF>0.6&&tSec>s.next){
    s.active=true; s.t0=tSec;
    s.s.visible=true;
    s.s.position.set(rand(-55,55),rand(52,72),-85);
    s.vx=-rand(55,75); s.vy=-rand(22,32);
    s.s.material.rotation=Math.atan2(s.vy,s.vx);
  }
  if(s.active){
    s.s.position.x+=s.vx*dt; s.s.position.y+=s.vy*dt;
    const k=(tSec-s.t0)/1.1;
    s.s.material.opacity=Math.sin(clamp01(k)*Math.PI)*0.9;
    if(k>=1){ s.active=false; s.s.visible=false; s.next=tSec+rand(18,42); }
  }
}

/* ---------- fireflies (only on studied evenings — data-driven ambience) ---------- */
const fireflies={};
{
  const n=14, arr=new Float32Array(n*3), base=[];
  for(let i=0;i<n;i++){ const a=Math.random()*6.28, r=rand(2,10);
    base.push([Math.cos(a)*r,rand(1.6,4.2),Math.sin(a)*r]); }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(arr,3));
  const m=new THREE.PointsMaterial({map:radialTex('rgba(255,244,180,1)','rgba(255,220,120,0.4)'),color:0xFFE9A0,size:0.6,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false});
  const pts=new THREE.Points(g,m); pts.visible=false; scene.add(pts);
  fireflies.pts=pts; fireflies.mat=m; fireflies.geo=g; fireflies.base=base;
}
function updateFireflies(dt,tSec){
  const st=W.appState||{};
  const want=(W.nightF>0.5&&(st.focusSecondsToday||0)>0)?0.85:0;
  fireflies.mat.opacity=damp(fireflies.mat.opacity,want,1.2,dt);
  fireflies.pts.visible=fireflies.mat.opacity>0.02;
  if(!fireflies.pts.visible) return;
  const pos=fireflies.geo.attributes.position;
  for(let i=0;i<fireflies.base.length;i++){
    const b=fireflies.base[i];
    pos.setXYZ(i,
      b[0]+Math.sin(tSec*0.5+i*1.3)*1.3,
      b[1]+Math.sin(tSec*0.8+i*2.1)*0.8,
      b[2]+Math.cos(tSec*0.4+i*1.7)*1.3);
  }
  pos.needsUpdate=true;
}

/* ---------- drifting mini-clouds ---------- */
const miniClouds=[];
{
  const mat=new THREE.MeshLambertMaterial({color:0xFFFFFF,transparent:true,opacity:0.9});
  for(let i=0;i<4;i++){
    const g=new THREE.Group();
    const spots=[[0,0,0,rand(1.4,2.1)],[rand(1.2,1.9),rand(-0.3,0.2),0,rand(0.9,1.5)],[rand(-1.9,-1.2),rand(-0.3,0.2),0,rand(0.9,1.4)],[rand(-0.5,0.5),rand(0.3,0.8),rand(-0.5,0.5),rand(0.8,1.2)]];
    spots.forEach(s=>{ const b=new THREE.Mesh(new THREE.SphereGeometry(s[3],10,8),mat); b.position.set(s[0],s[1],s[2]); g.add(b); });
    scene.add(g);
    miniClouds.push({g,a:Math.random()*6.28,r:rand(52,86),h:rand(20,34),sp:rand(0.01,0.028)*(Math.random()<0.5?-1:1)});
  }
  miniClouds.mat=mat;
}
function updateMiniClouds(dt,tSec){
  miniClouds.mat.opacity=0.35+0.55*W.dayF;
  for(const c of miniClouds){
    c.a+=c.sp*dt;
    c.g.position.set(Math.cos(c.a)*c.r,c.h+Math.sin(tSec*0.3+c.r)*0.6,Math.sin(c.a)*c.r);
  }
}

/* ---------- stone lanterns (streak milestones) ---------- */
const lanterns=[];
function buildLantern(idx,ceremony){
  const p=LANTERN_SPOTS[idx]; if(!p) return;
  const g=new THREE.Group(); g.position.set(p[0],groundY(p[0],p[1]),p[1]); scene.add(g);
  const stone=new THREE.MeshLambertMaterial({color:0xB9AFC4});
  const base=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.6,0.35,10),stone); base.position.y=0.17; g.add(base);
  const col=new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.2,0.8,8),stone); col.position.y=0.7; g.add(col);
  const box=new THREE.Mesh(new THREE.BoxGeometry(0.55,0.5,0.55),glowMat(0xFFC94D,1.2)); box.position.y=1.3; g.add(box);
  const roof=new THREE.Mesh(new THREE.ConeGeometry(0.55,0.35,4),stone); roof.position.y=1.72; roof.rotation.y=Math.PI/4; g.add(roof);
  const light=new THREE.PointLight(0xFFC97A,0,10,2); light.position.y=1.4; g.add(light);
  nightGlows.push({light,i:1.0});
  g.castShadow=true;
  lanterns.push(g);
  if(ceremony){ g.scale.setScalar(0.01); g.userData.pop=performance.now();
    Petals.spawn(16,[p[0],3,p[1]],1.5,[3,4]); sfx.milestone(); }
}

/* ---------- cosmetics ---------- */
const cosmetics={bunting:null,festoon:null,duckie:null};
function buildDuckie(){
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.SphereGeometry(0.4,14,10),new THREE.MeshLambertMaterial({color:0xFFD94D}));
  body.scale.set(1,0.85,1.2); g.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.26,12,9),new THREE.MeshLambertMaterial({color:0xFFD94D}));
  head.position.set(0,0.42,0.28); g.add(head);
  const beak=new THREE.Mesh(new THREE.ConeGeometry(0.09,0.18,8),new THREE.MeshLambertMaterial({color:0xFF9A3D}));
  beak.rotation.x=Math.PI/2; beak.position.set(0,0.4,0.55); g.add(beak);
  const eye=new THREE.Mesh(new THREE.SphereGeometry(0.045,6,6),new THREE.MeshLambertMaterial({color:0x3A3230}));
  eye.position.set(0.11,0.5,0.45); g.add(eye);
  const e2=eye.clone(); e2.position.x=-0.11; g.add(e2);
  g.position.set(POS.pond[0]+0.8,pondY+0.12,POS.pond[1]-0.5);
  scene.add(g); return g;
}
function buildBunting(){
  const g=new THREE.Group(); scene.add(g);
  const a=new THREE.Vector3(POS.house[0]+1.6,groundY(...POS.house)+3.1,POS.house[1]+1.2);
  const b=new THREE.Vector3(POS.bed[0]-1.4,groundY(...POS.bed)+2.4,POS.bed[1]-1.0);
  const poleM=new THREE.MeshLambertMaterial({color:0xB98A5F});
  [a,b].forEach(p=>{ const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,2.6,6),poleM);
    pole.position.set(p.x,p.y-1.1,p.z); g.add(pole); });
  const cols=[0xFFB4A2,0xFFC94D,0xBFE3C6,0xBDE3FF,0xFFD9B3];
  for(let i=0;i<=8;i++){ const t=i/8;
    const p=a.clone().lerp(b,t); p.y-=Math.sin(t*Math.PI)*0.7;
    const f=new THREE.Mesh(new THREE.ConeGeometry(0.22,0.5,3),new THREE.MeshLambertMaterial({color:cols[i%5],side:THREE.DoubleSide}));
    f.position.copy(p); f.rotation.x=Math.PI; f.userData.t=t; g.add(f); }
  return g;
}
function buildFestoon(){
  const g=new THREE.Group(); scene.add(g);
  const a=new THREE.Vector3(POS.stall[0]-2.2,groundY(...POS.stall)+2.6,POS.stall[1]+0.8);
  const b=new THREE.Vector3(POS.stall[0]+2.4,groundY(...POS.stall)+2.6,POS.stall[1]-0.6);
  for(let i=0;i<=4;i++){ const t=i/4||0.001;
    const p=a.clone().lerp(b,i/4); p.y-=Math.sin((i/4)*Math.PI)*0.6;
    const l=new THREE.Mesh(new THREE.SphereGeometry(0.24,10,8),glowMat(0xFFC97A,1.0));
    l.position.copy(p); g.add(l); }
  return g;
}
function applyCosmetic(id){
  if(id==='duckie'&&!cosmetics.duckie) cosmetics.duckie=buildDuckie();
  if(id==='bunting'&&!cosmetics.bunting) cosmetics.bunting=buildBunting();
  if(id==='festoon'&&!cosmetics.festoon) cosmetics.festoon=buildFestoon();
}

/* ---------- trees ---------- */
const blossomMat=new THREE.MeshLambertMaterial({color:0xFFC7CE});
function buildTreeMesh(rec){
  const sp=rec.gold?SPECIES.golden:SPECIES[rec.subject];
  const g=new THREE.Group(); g.position.set(rec.x,groundY(rec.x,rec.z)-0.05,rec.z);
  g.rotation.y=Math.random()*6.28;
  const trunkMat=new THREE.MeshLambertMaterial({color:0xB08968});
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.32,1.3,7),trunkMat);
  trunk.position.y=0.65; trunk.castShadow=true; g.add(trunk);
  const tint=rec.gold?0.25:rec.diff*0.35;
  const m1=regWilt(new THREE.MeshLambertMaterial({color:sp.c1}),sp.c1);
  const m2=regWilt(new THREE.MeshLambertMaterial({color:sp.c2}),sp.c2);
  m1.color.offsetHSL(rand(-0.02,0.02),rand(-0.05,0.05),rand(-0.04,0.04));
  m2.color.offsetHSL(rand(-0.02,0.02),rand(-0.05,0.05),rand(-0.04,0.04));
  m1.color.lerp(new THREE.Color(COL.gold),tint);
  m2.color.lerp(new THREE.Color(COL.gold),tint);
  if(rec.gold){ m1.emissive=new THREE.Color(0x8A6A1A); m1.emissiveIntensity=0.25; m2.emissive=m1.emissive; m2.emissiveIntensity=0.25; }
  const canopy=new THREE.Group(); g.add(canopy);
  const blobs=[];
  if(sp.shape==='puff'){
    [[1.0,2.0,0],[0.72,2.75,0.3],[0.5,3.3,-0.2]].forEach((s,i)=>{
      const b=new THREE.Mesh(new THREE.SphereGeometry(s[0],12,10),i%2?m2:m1);
      b.position.set(s[2],s[1],s[2]*0.5); b.castShadow=true;
      b.userData.by=b.position.y; b.userData.ph=Math.random()*6.28; canopy.add(b); blobs.push(b); });
  }else if(sp.shape==='cone'){
    [[1.1,1.4,1.9],[0.85,1.15,2.75],[0.6,0.95,3.45]].forEach((s,i)=>{
      const b=new THREE.Mesh(new THREE.ConeGeometry(s[0],s[1],9),i%2?m2:m1);
      b.position.y=s[2]; b.castShadow=true;
      b.userData.by=b.position.y; b.userData.ph=Math.random()*6.28; canopy.add(b); blobs.push(b); });
  }else{
    const b=new THREE.Mesh(new THREE.IcosahedronGeometry(0.95,0),m1); b.position.y=2.3; b.castShadow=true;
    b.userData.by=2.3; b.userData.ph=Math.random()*6.28; canopy.add(b); blobs.push(b);
    [[0.5,0.8,0.5],[-0.6,0.4,-0.3],[0.2,-0.5,0.7]].forEach(o=>{
      const s=new THREE.Mesh(new THREE.IcosahedronGeometry(0.45,0),m2);
      s.position.set(o[0],2.3+o[1],o[2]);
      s.userData.by=s.position.y; s.userData.ph=Math.random()*6.28; canopy.add(s); blobs.push(s); });
  }
  const blossoms=[];
  if(!rec.gold&&sp.shape==='puff'){
    const spots=[[0.35,3.25,0.25],[-0.3,3.15,0.4],[0.1,3.55,-0.25],[-0.2,3.5,-0.05]];
    spots.forEach(p=>{ const bl=new THREE.Mesh(new THREE.SphereGeometry(0.09,7,6),blossomMat);
      bl.position.set(p[0],p[1],p[2]); bl.visible=false; canopy.add(bl); blossoms.push(bl); });
  }
  const sprout=new THREE.Group();
  const stemM=new THREE.MeshLambertMaterial({color:0x8FCB9B});
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.06,0.5,6),stemM); stem.position.y=0.25; sprout.add(stem);
  const leafG=new THREE.SphereGeometry(0.18,8,6);
  const l1=new THREE.Mesh(leafG,regWilt(new THREE.MeshLambertMaterial({color:COL.mint}),COL.mint));
  l1.scale.set(1,0.35,0.6); l1.position.set(0.2,0.5,0); l1.rotation.z=-0.5; sprout.add(l1);
  const l2=l1.clone(); l2.position.x=-0.2; l2.rotation.z=0.5; sprout.add(l2);
  g.add(sprout);
  const fruits=[];
  const fm=new THREE.MeshLambertMaterial({color:COL.gold,emissive:COL.gold,emissiveIntensity:0.6});
  for(let i=0;i<3;i++){
    const f=new THREE.Mesh(new THREE.SphereGeometry(0.13,8,6),fm);
    const a=i*2.1; f.position.set(Math.cos(a)*0.9,2.2+i*0.45,Math.sin(a)*0.9);
    f.visible=false; canopy.add(f); fruits.push(f);
  }
  rec.g=g; rec.canopy=canopy; rec.sprout=sprout; rec.fruits=fruits; rec.fruitMat=fm;
  rec.blobs=blobs; rec.blossoms=blossoms;
  g.userData.i={type:'tree',rec};
  if(!rec.landed){
    rec.seed=new THREE.Mesh(new THREE.SphereGeometry(0.16,8,6),new THREE.MeshLambertMaterial({color:0x9A7354}));
    rec.seed.position.set(rec.x,rec.fallY,rec.z); scene.add(rec.seed);
    g.visible=false;
  }
  scene.add(g);
}
function findTreePos(){
  for(let i=0;i<40;i++){
    const a=Math.random()*Math.PI*2, r=rand(3.5,13.5);
    const x=Math.cos(a)*r, z=Math.sin(a)*r;
    if(tooClose(x,z,0)) continue;
    let ok=true;
    for(const t of W.trees){ if(Math.hypot(x-t.x,z-t.z)<1.8){ ok=false; break; } }
    if(ok) return [x,z];
  }
  return [rand(-10,10),rand(-10,10)];
}
function plantTree(o){
  if(W.trees.length>=70){
    const idx=W.trees.findIndex(t=>!t.gold);
    if(idx>=0){ const t=W.trees[idx]; scene.remove(t.g); if(t.seed)scene.remove(t.seed); W.trees.splice(idx,1); }
  }
  const pos=findTreePos();
  const diff=clamp01(o.difficulty!=null?o.difficulty:0.3);
  const rec={ id:W.nextId++, subject:o.subject||'maths', diff, gold:!!o.gold,
    x:pos[0], z:pos[1], budget:o.gold?1:600+1500*diff,
    progress:o.progress||0, disp:o.progress||0, phase:Math.random()*6.28,
    born:0, landed:!!(o.progress>0), fallY:15+Math.random()*3,
    maturePopped:!!(o.progress>=1), fruitP:0, harvestedDay:'', droop:0, recent:false, fast:false, popT:0 };
  buildTreeMesh(rec);
  W.trees.push(rec);
  if(!rec.gold&&!o.noCount) W.plantedToday++;
  if(rec.landed){ rec.born=performance.now()-900; }
  else { floater('a sky-seed landed 🌱',new THREE.Vector3(rec.x,groundY(rec.x,rec.z)+2.2,rec.z),0.8); sfx.seed(); }
  queueSave();
  return rec;
}
function onMature(rec){
  if(rec.maturePopped) return;
  rec.maturePopped=true; rec.popT=performance.now();
  Petals.spawn(10,[rec.x,groundY(rec.x,rec.z)+3,rec.z],1.2,[2,4]);
  floater('it grew up! 🌿',new THREE.Vector3(rec.x,groundY(rec.x,rec.z)+4,rec.z),0.85);
  sfx.mature(); queueSave();
}
function applyGrowth(delta){
  delta=Math.min(delta,6*3600);
  const young=W.trees.filter(t=>t.progress<1&&!t.gold);
  if(!young.length||delta<=0) return;
  const share=delta/young.length;
  for(const t of young){
    const before=t.progress;
    t.progress=clamp01(t.progress+share/t.budget);
    if(before<1&&t.progress>=1) onMature(t);
  }
  queueSave();
}

/* ---------- pip ---------- */
const pip={};
{
  const g=new THREE.Group(); g.position.set(POS.home[0],groundY(...POS.home),POS.home[1]); scene.add(g);
  const bodyMat=new THREE.MeshLambertMaterial({color:COL.cream});
  const body=new THREE.Mesh(new THREE.SphereGeometry(0.85,24,18),bodyMat);
  body.position.y=0.82; body.scale.set(1,0.95,0.98); body.castShadow=true; g.add(body);
  const belly=new THREE.Mesh(new THREE.SphereGeometry(0.55,16,12),new THREE.MeshLambertMaterial({color:0xFFE3C4}));
  belly.position.set(0,0.62,0.5); belly.scale.set(1,0.8,0.5); g.add(belly);
  const feetM=new THREE.MeshLambertMaterial({color:0xF7E3C8});
  const footL=new THREE.Mesh(new THREE.SphereGeometry(0.27,10,8),feetM); footL.position.set(-0.34,0.16,0.3); footL.scale.y=0.7; g.add(footL);
  const footR=footL.clone(); footR.position.x=0.34; g.add(footR);
  const armL=new THREE.Mesh(new THREE.CapsuleGeometry(0.14,0.34,4,8),bodyMat); armL.position.set(-0.82,0.9,0.12); armL.rotation.z=0.9; g.add(armL);
  const armR=armL.clone(); armR.position.x=0.82; armR.rotation.z=-0.9; g.add(armR);
  const eyeM=new THREE.MeshLambertMaterial({color:0x4A3B33});
  const eyeL=new THREE.Mesh(new THREE.SphereGeometry(0.16,10,8),eyeM); eyeL.position.set(-0.3,1.12,0.66); g.add(eyeL);
  const eyeR=eyeL.clone(); eyeR.position.x=0.3; g.add(eyeR);
  const glintM=new THREE.MeshBasicMaterial({color:0xFFFFFF});
  const glL=new THREE.Mesh(new THREE.SphereGeometry(0.05,6,6),glintM); glL.position.set(-0.26,1.17,0.78); g.add(glL);
  const glR=glL.clone(); glR.position.x=0.34; g.add(glR);
  const blushM=new THREE.MeshLambertMaterial({color:COL.coral});
  const blL=new THREE.Mesh(new THREE.SphereGeometry(0.12,8,6),blushM); blL.position.set(-0.52,0.95,0.6); blL.scale.set(1,0.6,0.4); g.add(blL);
  const blR=blL.clone(); blR.position.x=0.52; g.add(blR);
  const leafG=new THREE.Group(); leafG.position.set(0,1.62,0); g.add(leafG);
  const lstem=new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.045,0.24,6),new THREE.MeshLambertMaterial({color:0x7FBF8E}));
  lstem.position.y=0.1; leafG.add(lstem);
  const leafM=regWilt(new THREE.MeshLambertMaterial({color:COL.mint}),COL.mint);
  const leaf1=new THREE.Mesh(new THREE.SphereGeometry(0.2,10,8),leafM); leaf1.scale.set(1,0.3,0.55); leaf1.position.set(0.18,0.24,0); leaf1.rotation.z=-0.6; leafG.add(leaf1);
  const leaf2=leaf1.clone(); leaf2.position.x=-0.18; leaf2.rotation.z=0.6; leafG.add(leaf2);
  const hatG=new THREE.Group(); hatG.position.set(0,1.55,0); g.add(hatG);
  const crownG=new THREE.Group(); crownG.position.set(0,1.66,0); g.add(crownG);
  { const ring=new THREE.Mesh(new THREE.TorusGeometry(0.3,0.05,6,14),new THREE.MeshLambertMaterial({color:COL.gold,emissive:COL.gold,emissiveIntensity:0.35}));
    ring.rotation.x=Math.PI/2; crownG.add(ring);
    for(let i=0;i<5;i++){ const a=i/5*Math.PI*2;
      const lf=new THREE.Mesh(new THREE.ConeGeometry(0.08,0.26,4),new THREE.MeshLambertMaterial({color:COL.gold,emissive:COL.gold,emissiveIntensity:0.3}));
      lf.position.set(Math.cos(a)*0.3,0.14,Math.sin(a)*0.3); crownG.add(lf); } }
  const canG=new THREE.Group(); canG.visible=false; armR.add(canG); canG.position.set(0,-0.35,0.1);
  const canM=new THREE.MeshLambertMaterial({color:0x9FD8E8});
  const canB=new THREE.Mesh(new THREE.CylinderGeometry(0.17,0.2,0.3,10),canM); canG.add(canB);
  const spout=new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.06,0.32,8),canM); spout.rotation.z=1.1; spout.position.set(0.2,0.08,0); canG.add(spout);
  const hit=new THREE.Mesh(new THREE.SphereGeometry(1.35,8,6),new THREE.MeshBasicMaterial({visible:false}));
  hit.position.y=0.9; hit.userData.i={type:'pip'}; g.add(hit);
  const glow=new THREE.PointLight(0xFFD9A0,0,7,2); glow.position.y=1.4; g.add(glow);
  nightGlows.push({light:glow,i:0.7});
  Object.assign(pip,{g,body,eyeL,eyeR,glL,glR,armL,armR,footL,footR,leafG,hatG,crownG,canG,hit,
    mode:'',t:0,action:null,blink:0,zzz:0,hearts:0,bounceUntil:0,
    home:new THREE.Vector3(POS.home[0],groundY(...POS.home),POS.home[1]),
    studySpot:new THREE.Vector3(POS.study[0],groundY(...POS.study),POS.study[1]),
    wiltSpot:new THREE.Vector3(POS.wilt[0],groundY(...POS.wilt),POS.wilt[1]),
    waterSpot:null,yaw:0.7});
}
function setHat(id){
  while(pip.hatG.children.length) pip.hatG.remove(pip.hatG.children[0]);
  W.hat=id||null;
  if(!id) return;
  if(id==='strawHat'){
    const m=new THREE.MeshLambertMaterial({color:0xEED9A4});
    const brim=new THREE.Mesh(new THREE.CylinderGeometry(0.66,0.7,0.07,14),m); brim.position.y=0.12; pip.hatG.add(brim);
    const dome=new THREE.Mesh(new THREE.SphereGeometry(0.44,12,8,0,Math.PI*2,0,Math.PI/2),m); dome.position.y=0.14; pip.hatG.add(dome);
    const band=new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.45,0.1,12),new THREE.MeshLambertMaterial({color:COL.coral})); band.position.y=0.2; pip.hatG.add(band);
  }else if(id==='wizardCap'){
    const m=new THREE.MeshLambertMaterial({color:0x8B8FD9});
    const cone=new THREE.Mesh(new THREE.ConeGeometry(0.46,0.95,10),m); cone.position.y=0.55; cone.rotation.z=0.12; pip.hatG.add(cone);
    const brim=new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.58,0.08,12),m); brim.position.y=0.1; pip.hatG.add(brim);
    const star=new THREE.Mesh(new THREE.SphereGeometry(0.09,8,6),new THREE.MeshLambertMaterial({color:COL.gold,emissive:COL.gold,emissiveIntensity:0.5})); star.position.y=1.05; pip.hatG.add(star);
  }else if(id==='beanie'){
    const m=new THREE.MeshLambertMaterial({color:COL.coral});
    const cap=new THREE.Mesh(new THREE.SphereGeometry(0.52,12,8,0,Math.PI*2,0,Math.PI/2),m); cap.position.y=0.12; pip.hatG.add(cap);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(0.5,0.09,6,14),m); rim.rotation.x=Math.PI/2; rim.position.y=0.14; pip.hatG.add(rim);
    const pom=new THREE.Mesh(new THREE.SphereGeometry(0.14,8,6),new THREE.MeshLambertMaterial({color:COL.cream})); pom.position.y=0.68; pip.hatG.add(pom);
  }
  queueSave();
}
/* priority: a full-clear flip never gets stomped by a solve hop */
const PIP_PRI={flip:4,water:3,wave:2,stretch:1,tilt:1,hop:0.5};
function pipAction(mode,dur,extra){
  const pri=PIP_PRI[mode]||0;
  const now=performance.now();
  if(pip.action&&now<pip.action.until&&(PIP_PRI[pip.action.mode]||0)>pri) return;
  pip.action={mode,until:now+dur,target:extra||null};
  if(extra) pip.waterSpot=extra;
}
function updatePip(dt,now){
  const st=W.appState||{};
  const totalSolved=solvedTotal(st.solvedToday);
  const focusActive=(now-W.focusPulseMs)<60000&&(st.focusSecondsToday||0)>0;
  let want='idle';
  if(pip.action&&now>pip.action.until){
    if(pip.action.mode==='water'){ W.cloudRainTarget=null; pipAction('stretch',1500); }
    pip.action=null;
  }
  if(pip.action) want=pip.action.mode;
  else if(W.petting) want='pet';
  else if(W.missedActive) want='wilt';
  else if(focusActive) want='study';
  else if(totalSolved===0&&(st.focusSecondsToday||0)===0) want='sleep';
  if(want!==pip.mode){
    pip.mode=want; pip.t=0;
    pip.canG.visible=(want==='water');
    if(want==='water'&&!pip.waterSpot){
      const young=W.trees.filter(t=>t.progress<1).pop();
      pip.waterSpot=young?new THREE.Vector3(young.x,groundY(young.x,young.z),young.z):new THREE.Vector3(POS.pond[0],pondY,POS.pond[1]);
      W.cloudRainTarget={x:pip.waterSpot.x,z:pip.waterSpot.z};
    }
    if(want!=='water'&&(!pip.action||pip.action.mode!=='water')) W.cloudRainTarget=null;
  }
  pip.t+=dt;
  const P=pip.g.position;
  let target=pip.home;
  if(pip.mode==='study') target=pip.studySpot;
  if(pip.mode==='wilt') target=pip.wiltSpot;
  if(pip.mode==='water'&&pip.waterSpot) target=pip.waterSpot;
  const dx=target.x-P.x, dz=target.z-P.z, dist=Math.hypot(dx,dz);
  let moving=false;
  if(dist>0.2&&pip.mode!=='flip'){
    moving=true; const sp=2.4*dt;
    P.x+=dx/dist*Math.min(sp,dist); P.z+=dz/dist*Math.min(sp,dist);
    P.y=groundY(P.x,P.z)+Math.abs(Math.sin(pip.t*10))*0.12;
    const stp=Math.sin(pip.t*10);
    pip.footL.position.z=0.3+stp*0.1; pip.footR.position.z=0.3-stp*0.1;
    pip.footL.position.y=0.16+Math.max(0,stp)*0.08; pip.footR.position.y=0.16+Math.max(0,-stp)*0.08;
  } else {
    P.y=damp(P.y,groundY(P.x,P.z),10,dt);
    pip.footL.position.z=damp(pip.footL.position.z,0.3,8,dt); pip.footR.position.z=damp(pip.footR.position.z,0.3,8,dt);
    pip.footL.position.y=damp(pip.footL.position.y,0.16,8,dt); pip.footR.position.y=damp(pip.footR.position.y,0.16,8,dt);
  }
  let wantYaw;
  if(moving) wantYaw=Math.atan2(dx,dz);
  else if(pip.mode==='study') wantYaw=Math.atan2(POS.desk[0]-P.x,POS.desk[1]-P.z);
  else wantYaw=Math.atan2(camera.position.x-P.x,camera.position.z-P.z);
  pip.yaw=damp(pip.yaw,wantYaw,4,dt);
  pip.g.rotation.y=pip.yaw;

  const b=pip.body;
  const breath=1+0.015*Math.sin(now/450+1);
  let sy=0.95*breath, eyeS=1, armLZ=0.9, armRZ=-0.9, leafDroop=0, rootRotX=0, yOff=0;
  pip.blink-=dt; if(pip.blink<-3) pip.blink=0.12;
  const blinkS=pip.blink<0.12&&pip.blink>0?0.15:1;
  switch(pip.mode){
    case 'sleep': sy=0.9; eyeS=0.12; leafDroop=0.6;
      pip.zzz-=dt; if(pip.zzz<=0){ pip.zzz=1.7;
        floater('z',P.clone().add(new THREE.Vector3(0.6,2.1,0)),0.55); }
      break;
    case 'study': sy=0.92; armLZ=0.2; armRZ=-0.2;
      bookPage.rotation.y=((now/1600)%1)*Math.PI;
      eyeS=blinkS*0.8;
      if(now<pip.bounceUntil){ yOff=Math.abs(Math.sin((pip.bounceUntil-now)/110))*0.14; }
      break;
    case 'hop': { const k=clamp01(pip.t/1.4);
      yOff=Math.abs(Math.sin(k*Math.PI*2))*0.9;
      sy=0.95+0.15*Math.sin(k*Math.PI*4+Math.PI);
      armLZ=2.2; armRZ=-2.2; eyeS=0.25; break; }
    case 'water': armRZ=-2.4; eyeS=blinkS; break;
    case 'stretch': { const k=Math.sin(clamp01(pip.t/1.4)*Math.PI);
      sy=0.95+0.13*k; armLZ=0.9+1.9*k; armRZ=-0.9-1.9*k; eyeS=0.2+0.8*(1-k); break; }
    case 'wave': armLZ=0.5; armRZ=-2.8+Math.sin(pip.t*9)*0.35; eyeS=0.3; sy=0.98; break;
    case 'tilt': pip.g.rotation.z=0.28*Math.sin(clamp01(pip.t/0.5)*Math.PI/2); eyeS=1.25;
      if(pip.t>2.4) pip.g.rotation.z*=(1-clamp01((pip.t-2.4)/0.6));
      break;
    case 'flip': { const k=clamp01(pip.t/0.95);
      yOff=Math.sin(k*Math.PI)*2.3; rootRotX=-k*Math.PI*2; eyeS=0.25; break; }
    case 'wilt': sy=0.92; leafDroop=1; eyeS=0.5; break;
    case 'pet': eyeS=0.15; sy=0.95+0.05*Math.sin(pip.t*7);
      pip.hearts-=dt; if(pip.hearts<=0){ pip.hearts=0.35; heartFloat(P.clone()); }
      break;
    default: eyeS=blinkS; armLZ=0.9+Math.sin(now/500)*0.08; armRZ=-0.9-Math.sin(now/500)*0.08;
  }
  if(pip.mode!=='tilt'&&pip.mode!=='flip') pip.g.rotation.z=0;
  if(pip.mode!=='flip') pip.g.rotation.x=0; else pip.g.rotation.x=rootRotX;
  pip.g.position.y=P.y+yOff;
  b.scale.y=sy; b.scale.x=1+(0.95-sy)*0.5;
  pip.eyeL.scale.y=eyeS; pip.eyeR.scale.y=eyeS;
  pip.glL.visible=eyeS>0.5; pip.glR.visible=eyeS>0.5;
  pip.armL.rotation.z=armLZ; pip.armR.rotation.z=armRZ;
  pip.leafG.rotation.z=leafDroop*0.7+Math.sin(now/700)*0.06+(pip.mode==='hop'?Math.sin(now/180)*0.2:0);
  pip.leafG.children.forEach((c,i)=>{ if(i>0) c.rotation.z=(i===1?-0.6:0.6)*(1+leafDroop*0.8); });
  pip.crownG.visible=!!(st.directive&&st.directive.golden);
}

/* ---------- birds ---------- */
function makeBird(){
  const g=new THREE.Group();
  const c=pick([0xFFD9B3,0xFFB4A2,0xFFF0DC]);
  const body=new THREE.Mesh(new THREE.SphereGeometry(0.32,12,10),new THREE.MeshLambertMaterial({color:c}));
  body.position.y=0.35; g.add(body);
  const belly=new THREE.Mesh(new THREE.SphereGeometry(0.2,10,8),new THREE.MeshLambertMaterial({color:0xFFF6E9}));
  belly.position.set(0,0.3,0.18); belly.scale.set(1,0.9,0.6); g.add(belly);
  const beak=new THREE.Mesh(new THREE.ConeGeometry(0.07,0.16,6),new THREE.MeshLambertMaterial({color:COL.gold}));
  beak.rotation.x=Math.PI/2; beak.position.set(0,0.4,0.34); g.add(beak);
  const eyeM=new THREE.MeshLambertMaterial({color:0x3A3230});
  const e1=new THREE.Mesh(new THREE.SphereGeometry(0.045,6,6),eyeM); e1.position.set(0.14,0.48,0.24); g.add(e1);
  const e2=e1.clone(); e2.position.x=-0.14; g.add(e2);
  const wingM=new THREE.MeshLambertMaterial({color:c});
  const w1=new THREE.Mesh(new THREE.SphereGeometry(0.14,8,6),wingM); w1.scale.set(0.4,1,0.7); w1.position.set(0.3,0.38,0); g.add(w1);
  const w2=w1.clone(); w2.position.x=-0.3; g.add(w2);
  const a=Math.random()*6.28, r=rand(4,11);
  const x=Math.cos(a)*r, z=Math.sin(a)*r;
  g.position.set(x,groundY(x,z),z);
  scene.add(g);
  return {g,w1,w2,state:'pause',timer:rand(0.3,1.5),from:null,to:null,k:0};
}
function updateBirds(dt,now){
  if(W.birds.length<W.birdTarget&&now-W.lastBirdChange>700){
    W.lastBirdChange=now; W.birds.push(makeBird());
    const b=W.birds[W.birds.length-1]; b.g.scale.setScalar(0.01); b.pop=now;
    sfx.chirp();
  }
  if(W.birds.length>W.birdTarget&&now-W.lastBirdChange>400){
    W.lastBirdChange=now;
    const b=W.birds.find(b=>b.state!=='leave'); if(b) b.state='leave';
  }
  for(let i=W.birds.length-1;i>=0;i--){
    const b=W.birds[i];
    if(b.pop){ const k=clamp01((now-b.pop)/500); b.g.scale.setScalar(easeOutBack(k)); if(k>=1) b.pop=0; }
    if(b.state==='leave'){
      b.g.position.y+=dt*7; const l=b.g.position.length();
      b.g.position.x+=(b.g.position.x/(l||1))*dt*8; b.g.position.z+=(b.g.position.z/(l||1))*dt*8;
      b.g.scale.multiplyScalar(1-dt*0.5);
      if(b.g.position.y>30){ scene.remove(b.g); W.birds.splice(i,1); }
      continue;
    }
    if(b.state==='pause'){ b.timer-=dt;
      if(b.timer<=0){ b.state='hop'; b.k=0; b.from=b.g.position.clone();
        const a=Math.random()*6.28, r=rand(3,12);
        b.to=new THREE.Vector3(Math.cos(a)*r,0,Math.sin(a)*r); b.to.y=groundY(b.to.x,b.to.z);
        if(Math.random()<0.25) sfx.chirp(); } }
    else if(b.state==='hop'){
      b.k+=dt/0.65; const k=clamp01(b.k);
      b.g.position.lerpVectors(b.from,b.to,k);
      b.g.position.y=lerp(b.from.y,b.to.y,k)+Math.sin(k*Math.PI)*0.9;
      b.g.rotation.y=Math.atan2(b.to.x-b.from.x,b.to.z-b.from.z);
      b.w1.rotation.z=Math.sin(now/40)*0.7; b.w2.rotation.z=-Math.sin(now/40)*0.7;
      if(b.k>=1){ b.state='pause'; b.timer=rand(0.6,2.2); b.w1.rotation.z=0; b.w2.rotation.z=0; } }
  }
}

/* ---------- flower bed ---------- */
const bedSlots=[];
function makeFlower(big,colorHex){
  const g=new THREE.Group();
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.08,big?0.9:0.55,6),new THREE.MeshLambertMaterial({color:0x7FBF8E}));
  stem.position.y=(big?0.9:0.55)/2; g.add(stem);
  const head=new THREE.Group(); head.position.y=big?0.95:0.6; g.add(head);
  const center=new THREE.Mesh(new THREE.SphereGeometry(big?0.22:0.14,10,8),new THREE.MeshLambertMaterial({color:COL.gold}));
  head.add(center);
  const n=big?8:6, pr=big?0.32:0.2, ps=big?0.17:0.11;
  for(let i=0;i<n;i++){ const a=i/n*Math.PI*2;
    const p=new THREE.Mesh(new THREE.SphereGeometry(ps,8,6),regWilt(new THREE.MeshLambertMaterial({color:colorHex}),colorHex));
    p.position.set(Math.cos(a)*pr,0,Math.sin(a)*pr); head.add(p); }
  const bud=new THREE.Mesh(new THREE.SphereGeometry(big?0.2:0.14,8,6),new THREE.MeshLambertMaterial({color:0x9BCB9B}));
  bud.position.y=big?0.85:0.5; g.add(bud);
  return {g,head,bud,bloomed:false,bloomT:-1};
}
{
  const cols=[COL.coral,COL.gold,COL.peach,0xFFC7CE];
  const spots=[[-1.3,0.55],[0,0.7],[1.3,0.55]];
  spots.forEach((p,i)=>{ const f=makeFlower(false,cols[i]); f.g.position.set(p[0],0.45,p[1]); bedG.add(f.g); bedSlots.push(f); });
  const big=makeFlower(true,COL.gold); big.g.position.set(0,0.45,-0.7); bedG.add(big.g); bedSlots.push(big);
}
function syncFlowers(done,total,headline){
  for(let i=0;i<3;i++){
    const s=bedSlots[i];
    const should=i<Math.min(done,3);
    const visible=i<Math.max(total,done);
    s.g.visible=visible||s.bloomed;
    if(should&&!s.bloomed){ s.bloomed=true; s.bloomT=performance.now();
      Petals.spawn(5,s.g.getWorldPosition(new THREE.Vector3()),0.6,[0,3]); sfx.harvest(); }
    if(!should&&s.bloomed){ s.bloomed=false; s.bloomT=-1; }
  }
  const h=bedSlots[3];
  if(headline&&!h.bloomed){ h.bloomed=true; h.bloomT=performance.now();
    Petals.spawn(10,h.g.getWorldPosition(new THREE.Vector3()),0.8,[3,4]); sfx.milestone(); }
  if(!headline&&h.bloomed){ h.bloomed=false; h.bloomT=-1; }
}
function updateFlowers(now){
  for(const s of bedSlots){
    const target=s.bloomed?1:0;
    if(s.bloomed&&s.bloomT>0){ const k=clamp01((now-s.bloomT)/700);
      s.head.scale.setScalar(Math.max(0.01,easeOutBack(k))); s.head.visible=true; s.bud.visible=k<0.5; }
    else if(!s.bloomed){ s.head.scale.setScalar(0.01); s.head.visible=false; s.bud.visible=s.g.visible; }
    s.g.rotation.z=Math.sin(now/800+s.g.position.x)*0.05;
  }
}

/* ---------- §5 API ---------- */
function solvedTotal(o){ o=o||{}; return (o.physics||0)+(o.chemistry||0)+(o.maths||0); }
function normalizeState(s){
  const st=s.solvedToday||{};
  const d=s.directive||{};
  return {
    solvedToday:{physics:Math.max(0,Math.round(+st.physics||0)),chemistry:Math.max(0,Math.round(+st.chemistry||0)),maths:Math.max(0,Math.round(+st.maths||0))},
    streakDays:Math.max(0,Math.round(+s.streakDays||0)),
    streakAlive:!!s.streakAlive,
    focusSecondsToday:Math.max(0,+s.focusSecondsToday||0),
    directive:{questsDone:Math.max(0,Math.round(+d.questsDone||0)),questsTotal:Math.max(0,Math.round(+d.questsTotal||0)),
      headlineDone:!!d.headlineDone,fullCleared:!!d.fullCleared,golden:!!d.golden},
    missedDays:Math.max(0,Math.round(+s.missedDays||0)),
    seeds:s.seeds!=null?Math.max(0,Math.round(+s.seeds)):null,
    daysToExam:s.daysToExam!=null?Math.max(0,Math.round(+s.daysToExam)):null,
    clock:typeof s.clock==='number'?s.clock:null
  };
}
function checkRollover(){
  const dk=dayKeyOf(Date.now());
  if(dk===W.dayKey) return;
  W.dayKey=dk; W.focusHighWater=0; W.plantedToday=0;
  for(const t of W.trees){ if(t.maturePopped&&t.harvestedDay!==dk) t.fruitP=0; }
  queueSave();
}
function pruneHistory(){
  const keys=Object.keys(W.history).sort();
  while(keys.length>8){ delete W.history[keys.shift()]; }
}
function setState(input){
  if(!W.ready||!input||typeof input!=='object') return;
  checkRollover();
  const s=normalizeState(input);
  const prev=W.appState;
  W.appState=s; W.appClock=s.clock;
  /* focus → growth + cloud pulse */
  const f=s.focusSecondsToday;
  if(f>(W.history[W.dayKey]||0)) W.history[W.dayKey]=f;
  pruneHistory();
  const delta=Math.max(0,f-W.focusHighWater);
  if(delta>0){ W.focusHighWater=f; W.focusPulseMs=performance.now(); applyGrowth(delta); }
  /* seeds sync (app-authoritative when value changes) */
  if(s.seeds!=null&&s.seeds!==W.lastAppSeeds){ W.seeds=s.seeds; W.lastAppSeeds=s.seeds; }
  /* fallback planting when state arrives without events */
  const total=solvedTotal(s.solvedToday);
  let guard=0;
  while(W.plantedToday<total&&guard<14){
    const subj=SUBJECTS[W.fallbackCycle++%3];
    setTimeout(()=>plantTree({subject:subj,difficulty:0.3+Math.random()*0.4,gold:W.golden}),guard*180);
    W.plantedToday++; guard++;
  }
  /* quests → flowers */
  syncFlowers(s.directive.questsDone,s.directive.questsTotal,s.directive.headlineDone);
  /* golden week edge */
  if(s.directive.golden&&!W.golden){ W.golden=true; Petals.spawn(24,[0,8,0],8,[3,4]); floater('golden hours ✨',new THREE.Vector3(0,13,0),1); }
  if(!s.directive.golden&&W.golden) W.golden=false;
  /* full clear edge (event de-dupes) */
  if(s.directive.fullCleared&&!(prev&&prev.directive.fullCleared)){
    if(performance.now()-W.lastFullClearEvt>1500) doFullClear(true);
  }
  /* missed days edge */
  W.missedActive=s.missedDays>0;
  if(prev&&prev.missedDays===0&&s.missedDays>0) markDroopers();
  if(s.missedDays===0) for(const t of W.trees) t.recent=false;
  /* streak → birds */
  W.birdTarget=s.streakAlive?(s.streakDays>=30?4:(s.streakDays>=7?3:2)):0;
  /* milestones */
  for(const m of [7,30,100]){
    if(s.streakDays>=m&&s.streakAlive&&!W.milestones.includes(m)) awardMilestone(m);
  }
  /* exam sign */
  if(s.daysToExam!=null&&s.daysToExam!==lastExam){ lastExam=s.daysToExam; paintSign(s.daysToExam); }
  queueSave();
}
function markDroopers(){
  const recent=W.trees.filter(t=>!t.gold).slice(-3);
  for(const t of recent) t.recent=true;
}
function awardMilestone(days){
  if(W.milestones.includes(days)) return;
  W.milestones.push(days);
  buildLantern([7,30,100].indexOf(days),true);
  floater(days+'-day lantern lit! 🏮',new THREE.Vector3(0,9,0),1);
  queueSave();
}
function doFullClear(soft){
  W.lastFullClearEvt=performance.now();
  if(!W.goldTreeDays.includes(W.dayKey)){
    W.goldTreeDays.push(W.dayKey);
    const rec=plantTree({subject:'golden',gold:true,progress:1,noCount:true});
    rec.g.position.set(POS.gold[0],groundY(...POS.gold),POS.gold[1]);
    rec.popT=performance.now();
    floater('a golden tree! ✨',new THREE.Vector3(POS.gold[0],7,POS.gold[1]),1);
  }
  pipAction('flip',1000);
  Petals.spawn(40,[0,10,0],10,[0,3,4]);
  floater('full clear! 🌈',new THREE.Vector3(0,12,0),1.15);
  sfx.fullClear();
  queueSave();
}
function isleEvent(name,data){
  if(!W.ready) return; data=data||{};
  const now=performance.now();
  switch(name){
    case 'solve': {
      const subj=SUBJECTS.includes(data.subject)?data.subject:pick(SUBJECTS);
      const diff=clamp01(+data.difficulty||0.3);
      plantTree({subject:subj,difficulty:diff,gold:W.golden});
      if(pip.mode==='study'){ pip.bounceUntil=now+700; }
      else pipAction('hop',1400);
      sfx.solve(solvedTotal(W.appState?W.appState.solvedToday:{}));
      break; }
    case 'focusBlockDone': {
      W.rainUntil=now+6500; spawnPuddles(); W.pondBoost=Math.min(0.12,W.pondBoost+0.06);
      const young=W.trees.filter(t=>t.progress<1).pop();
      pipAction('water',5200,young?new THREE.Vector3(young.x,groundY(young.x,young.z),young.z):null);
      floater('rain time! 💧',new THREE.Vector3(0,15,0),0.9);
      sfx.block(); break; }
    case 'focusForfeit': {
      pipAction('tilt',3000);
      Petals.spawn(6,[0,16,0],2,[2]);
      floater("it's okay 🌿",new THREE.Vector3(pip.g.position.x,4,pip.g.position.z),0.8);
      sfx.forfeit(); break; }
    case 'fullClear': doFullClear(false); break;
    case 'headlineDone': {
      W.lastHeadlineEvt=now;
      syncFlowers(W.appState?W.appState.directive.questsDone:0,W.appState?W.appState.directive.questsTotal:0,true);
      floater('headline done! 🌟',new THREE.Vector3(POS.bed[0],5,POS.bed[1]),1);
      break; }
    case 'streakMilestone': awardMilestone(Math.round(+data.days||0)); break;
    case 'missedDay': {
      W.missedActive=true; markDroopers();
      floater('we missed you 🥀',new THREE.Vector3(pip.g.position.x,4,pip.g.position.z),0.85);
      sfx.forfeit(); break; }
    case 'seedsEarned': {
      const n=Math.max(0,Math.round(+data.n||0));
      W.seeds+=n;
      floater('+'+n+' 🌰 '+(data.reason||''),new THREE.Vector3(POS.stall[0],4.5,POS.stall[1]),0.9);
      sfx.buy(); queueSave(); break; }
  }
}
function buy(itemId){
  if(!W.ready) return false;
  const item=ITEMS[itemId]; if(!item) return false;
  if(itemId==='instantBloom'){
    const cand=W.trees.filter(t=>!t.gold&&t.progress<1).sort((a,b)=>b.progress-a.progress)[0];
    if(!cand){ floater('nothing to bloom yet 🌱',new THREE.Vector3(0,6,0),0.8); return false; }
    if(W.seeds<item.price){ floater('need '+item.price+' 🌰',new THREE.Vector3(0,6,0),0.8); return false; }
    W.seeds-=item.price; cand.progress=1; cand.fast=true; onMature(cand);
    floater('instant bloom! 🌸',new THREE.Vector3(cand.x,6,cand.z),0.9);
    queueSave(); return true;
  }
  if(W.owned.includes(itemId)){ floater('already yours 💛',new THREE.Vector3(0,6,0),0.8); return false; }
  if(W.seeds<item.price){ floater('need '+item.price+' 🌰',new THREE.Vector3(0,6,0),0.8); return false; }
  W.seeds-=item.price; W.owned.push(itemId);
  applyCosmetic(itemId);
  if(item.kind==='hat') setHat(itemId);
  floater(item.label+' ✓',new THREE.Vector3(POS.stall[0],4.5,POS.stall[1]),0.9);
  sfx.buy(); queueSave(); return true;
}
function debug(){
  const st=W.appState||{};
  return {
    state:st, dayKey:W.dayKey, seeds:W.seeds,
    pond:{level:Math.round(pondLevel*100), weekSeconds:weekFocus()},
    cloudFill:Math.round(cloudFill*100),
    trees:{count:W.trees.length,mature:W.trees.filter(t=>t.progress>=1).length,growing:W.trees.filter(t=>t.progress<1).length},
    pip:{mode:pip.mode,hat:W.hat,crown:!!(st.directive&&st.directive.golden)},
    birds:W.birds.length, birdTarget:W.birdTarget,
    milestones:W.milestones.slice(), owned:W.owned.slice(),
    drought:Math.round(W.drought*100), missedActive:W.missedActive,
    focusActive:(performance.now()-W.focusPulseMs)<60000,
    fullCleared:!!(st.directive&&st.directive.fullCleared), golden:W.golden,
    goldF:Math.round(W.goldF*100), wind:Math.round(W.wind*100), timelapse:W.timelapse,
    fps:Math.round(fpsAvg)
  };
}
function weekFocus(){
  let sum=0; const now=Date.now();
  for(let i=0;i<7;i++){ const k=dayKeyOf(now-i*86400000); sum+=W.history[k]||0; }
  return sum;
}
/* embed hooks — the §5 contract stays frozen, these are additive */
function mount(el){
  if(!el||!renderer) return false;
  if(renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  rootEl=el;
  el.appendChild(renderer.domElement);
  fit(); watchRO();
  return true;
}
function setPanelVisible(v){
  if(panel) panel.style.display=v?'':'none';
}

/* ---------- restore persisted world ---------- */
if(SAVE&&SAVE.v===1){
  if(SAVE.day===dayKeyOf(Date.now())){ W.focusHighWater=SAVE.focusHW||0; W.plantedToday=SAVE.plantedToday||0; }
  W.history=SAVE.hist||{}; W.nextId=SAVE.nextId||1;
  W.seeds=SAVE.seeds||0; W.lastAppSeeds=SAVE.lastAppSeeds;
  W.owned=SAVE.owned||[]; W.milestones=SAVE.milestones||[]; W.goldTreeDays=SAVE.goldDays||[];
  (SAVE.trees||[]).forEach(t=>{
    const rec={id:t.id,subject:t.subject,diff:t.diff,gold:!!t.gold,x:t.x,z:t.z,
      budget:t.budget,progress:t.progress,disp:t.progress,phase:Math.random()*6.28,
      born:performance.now()-2000,landed:true,maturePopped:!!t.mp,fruitP:t.fp||0,harvestedDay:t.hd||'',droop:0,recent:false,fast:false,popT:0};
    buildTreeMesh(rec); W.trees.push(rec);
  });
  W.milestones.forEach((m,i)=>buildLantern([7,30,100].indexOf(m),false));
  W.owned.forEach(applyCosmetic);
  if(SAVE.hat) setHat(SAVE.hat);
  if(SAVE.sound) AudioKit.on=true;
}

/* ---------- demo panel ---------- */
const DEMO_DEFAULT={solvedToday:{physics:4,chemistry:2,maths:7},streakDays:12,streakAlive:true,
  focusSecondsToday:5400,directive:{questsDone:1,questsTotal:3,headlineDone:false,fullCleared:false,golden:false},
  missedDays:0,seeds:38,daysToExam:297};
let demo=(SAVE&&SAVE.demo)?SAVE.demo:JSON.parse(JSON.stringify(DEMO_DEFAULT));
let nightOn=false, subjIdx=0, msIdx=0, hatIdx=0, decorIdx=0;
/* APP BUILD: no fake first-visit week — the pond fills from real focus time
   fed by the app bridge (W.history only ever holds true study seconds). */
function getDemoSnapshot(){ return demo; }
const panel=document.createElement('div');
panel.className='isle-panel';
panel.innerHTML=
 '<div class="isle-card">'+
 '<div class="isle-head" id="isleHead"><span class="isle-title">🌱 sprout isle</span><span class="isle-caret">▼</span></div>'+
 '<div class="isle-body">'+
 '<div class="isle-group">day flow</div>'+
 '<button class="isle-btn" data-a="solve">+1 solve</button>'+
 '<button class="isle-btn" data-a="solve5">+5 solves</button>'+
 '<button class="isle-btn" data-a="focus">+15m focus</button>'+
 '<button class="isle-btn" data-a="block">complete block</button>'+
 '<button class="isle-btn" data-a="forfeit">forfeit block</button>'+
 '<button class="isle-btn isle-gold" data-a="clear">full clear</button>'+
 '<button class="isle-btn" data-a="miss">miss a day</button>'+
 '<div class="isle-group">world</div>'+
 '<button class="isle-btn" data-a="milestone">streak milestone</button>'+
 '<button class="isle-btn" data-a="golden">golden week</button>'+
 '<button class="isle-btn" data-a="night">toggle night</button>'+
 '<button class="isle-btn" data-a="lapse">⏩ time-lapse</button>'+
 '<div class="isle-group">rewards</div>'+
 '<button class="isle-btn" data-a="hat">buy hat</button>'+
 '<button class="isle-btn" data-a="decor">buy decor</button>'+
 '<button class="isle-btn" data-a="sound">🔇 sound</button>'+
 '<button class="isle-btn" data-a="reset">reset world</button>'+
 '<div class="isle-status" id="isleStatus">waking up…</div>'+
 '</div></div>';
document.body.appendChild(panel);
$id('isleHead').addEventListener('click',()=>panel.classList.toggle('isle-closed'));
function doDemoSolve(){
  if(demo.missedDays>0){ demo.missedDays=0; demo.streakAlive=true; demo.streakDays=Math.max(1,demo.streakDays); }
  const subj=SUBJECTS[subjIdx++%3]; const diff=Math.round(Math.random()*100)/100;
  demo.solvedToday[subj]=(demo.solvedToday[subj]||0)+1;
  window.Isle.setState(demo); window.Isle.event('solve',{subject:subj,difficulty:diff});
}
panel.addEventListener('click',e=>{
  const a=e.target&&e.target.dataset?e.target.dataset.a:null; if(!a) return;
  AudioKit.unlock();
  if(a==='solve'){ doDemoSolve(); }
  if(a==='solve5'){ for(let i=0;i<5;i++) setTimeout(doDemoSolve,i*150); }
  if(a==='focus'){ demo.focusSecondsToday+=900; window.Isle.setState(demo); }
  if(a==='block'){ demo.focusSecondsToday+=1500; window.Isle.setState(demo); window.Isle.event('focusBlockDone',{}); }
  if(a==='forfeit'){ window.Isle.event('focusForfeit',{}); }
  if(a==='clear'){
    demo.directive.fullCleared=true; demo.directive.headlineDone=true;
    demo.directive.questsDone=demo.directive.questsTotal;
    window.Isle.setState(demo); window.Isle.event('fullClear',{});
    window.Isle.event('seedsEarned',{n:5,reason:'full clear'});
  }
  if(a==='miss'){ demo.missedDays+=1; demo.streakAlive=false; window.Isle.setState(demo); window.Isle.event('missedDay',{}); }
  if(a==='milestone'){ const m=[7,30,100][msIdx++%3]; demo.streakDays=Math.max(demo.streakDays,m); demo.streakAlive=true;
    window.Isle.setState(demo); window.Isle.event('streakMilestone',{days:m}); }
  if(a==='golden'){ demo.directive.golden=!demo.directive.golden; window.Isle.setState(demo); }
  if(a==='night'){ nightOn=!nightOn;
    if(nightOn){ const d=new Date(); d.setHours(22,15,0,0); demo.clock=d.getTime(); } else { delete demo.clock; }
    window.Isle.setState(demo); }
  if(a==='lapse'){ W.timelapse=!W.timelapse;
    const b=panel.querySelector('[data-a="lapse"]'); if(b) b.classList.toggle('isle-on',W.timelapse); }
  if(a==='hat'){ const hats=['strawHat','wizardCap','beanie']; window.Isle.buy(hats[hatIdx++%3]); }
  if(a==='decor'){ const decs=['duckie','bunting','festoon'];
    let bought=false;
    for(let i=0;i<decs.length;i++){ const d=decs[(decorIdx+i)%decs.length];
      if(!W.owned.includes(d)){ if(window.Isle.buy(d)) bought=true; break; } }
    decorIdx=(decorIdx+1)%decs.length;
    if(!bought&&decs.every(d=>W.owned.includes(d))) floater('all decorated 💛',new THREE.Vector3(0,6,0),0.8); }
  if(a==='sound'){ AudioKit.setOn(!AudioKit.on);
    e.target.textContent=AudioKit.on?'🔊 sound':'🔇 sound'; queueSave(); }
  if(a==='reset'){ try{localStorage.removeItem(KEY);}catch(err){} location.reload(); }
});
const MOODS={sleep:'napping',idle:'daydreaming',study:'studying',water:'watering',hop:'happy',tilt:'checking on you',flip:'celebrating',wilt:'a bit wilted',pet:'being petted 💛',stretch:'stretching',wave:'saying hi'};
setInterval(()=>{
  const el=$id('isleStatus'); if(!el) return;
  const d=window.Isle.debug(); const st=d.state||{};
  const solved=solvedTotal(st.solvedToday);
  const streak=(st.streakAlive&&st.streakDays>0)?('🔥'+st.streakDays+'d'):'no streak';
  el.textContent='pip is '+(MOODS[d.pip.mode]||'daydreaming')+' · '+solved+' solved today · pond '+d.pond.level+'% · cloud '+d.cloudFill+'% · '+d.seeds+'🌰 · '+streak;
},600);

/* ---------- controls: orbit / pinch / tap / pet ---------- */
const ctrl={theta:0.65,phi:1.02,radius:64,tTheta:0.65,tPhi:1.02,tRadius:44,target:new THREE.Vector3(0,3,0)};
const pointers=new Map();
let pinchD=0, downX=0, downY=0, downT=0, moved=0, orbiting=false, pipGrab=false, petTimer=0;
const raycaster=new THREE.Raycaster(); const ndc=new THREE.Vector2();
const dom=renderer.domElement;
function setNDC(x,y){ const r=dom.getBoundingClientRect();
  ndc.x=((x-r.left)/r.width)*2-1; ndc.y=-((y-r.top)/r.height)*2+1; }
function raycastType(types){
  raycaster.setFromCamera(ndc,camera);
  const hits=raycaster.intersectObjects(scene.children,true);
  for(const h of hits){ let o=h.object;
    while(o){ if(o.userData&&o.userData.i&&types.includes(o.userData.i.type)) return o.userData.i; o=o.parent; } }
  return null;
}
dom.addEventListener('pointerdown',e=>{
  AudioKit.unlock();
  dom.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===1){
    downX=e.clientX; downY=e.clientY; downT=performance.now(); moved=0; orbiting=false;
    setNDC(e.clientX,e.clientY);
    pipGrab=!!raycastType(['pip']);
    if(pipGrab){ clearTimeout(petTimer);
      petTimer=setTimeout(()=>{ if(!orbiting&&pointers.size===1){ W.petting=true; sfx.pet(); } },220); }
  }else if(pointers.size===2){
    W.petting=false; clearTimeout(petTimer); pipGrab=false;
    const p=[...pointers.values()]; pinchD=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
  }
});
dom.addEventListener('pointermove',e=>{
  const p=pointers.get(e.pointerId); if(!p) return;
  const dx=e.clientX-p.x, dy=e.clientY-p.y; p.x=e.clientX; p.y=e.clientY;
  if(pointers.size===1){
    moved+=Math.abs(dx)+Math.abs(dy);
    if(pipGrab&&moved>10){ pipGrab=false; W.petting=false; clearTimeout(petTimer); }
    if(!pipGrab&&moved>6) orbiting=true;
    if(orbiting){ ctrl.tTheta-=dx*0.005; ctrl.tPhi=clamp(ctrl.tPhi-dy*0.004,0.35,1.35); }
  }else if(pointers.size===2){
    const q=[...pointers.values()]; const d=Math.hypot(q[0].x-q[1].x,q[0].y-q[1].y);
    if(pinchD>0) ctrl.tRadius=clamp(ctrl.tRadius*(pinchD/d),26,80);
    pinchD=d;
  }
});
function endPointer(e){
  pointers.delete(e.pointerId);
  clearTimeout(petTimer);
  if(pointers.size===0){
    const wasPip=pipGrab; W.petting=false; pipGrab=false;
    const dt=performance.now()-downT;
    if(moved<8&&dt<400){
      setNDC(e.clientX,e.clientY);
      if(wasPip){ heartFloat(pip.g.position.clone()); sfx.pet(); pipAction('hop',900); }
      else{
        const hit=raycastType(['tree','sign','stall','cloud']);
        if(hit){
          if(hit.type==='tree'){ const r=hit.rec;
            const name=(r.gold?SPECIES.golden:SPECIES[r.subject]).name;
            floater(name+' · '+Math.round(r.progress*100)+'% grown',new THREE.Vector3(r.x,groundY(r.x,r.z)+3.5,r.z),0.75); }
          if(hit.type==='sign') floater((lastExam!=null?lastExam:'—')+' days to go ✨',new THREE.Vector3(POS.sign[0],5,POS.sign[1]),0.8);
          if(hit.type==='stall') floater('seeds buy cute things only 🌰',new THREE.Vector3(POS.stall[0],4.5,POS.stall[1]),0.8);
          if(hit.type==='cloud') floater('cloud '+Math.round(cloudFill*100)+'% full 💧',new THREE.Vector3(0,19,0),0.8);
        }
      }
    }
    orbiting=false;
  }
}
dom.addEventListener('pointerup',endPointer);
dom.addEventListener('pointercancel',endPointer);
dom.addEventListener('wheel',e=>{ e.preventDefault();
  ctrl.tRadius=clamp(ctrl.tRadius*(1+e.deltaY*0.0012),26,80); },{passive:false});

/* ---------- resize ---------- */
let ro=null;
function fit(){
  const w=rootEl.clientWidth||window.innerWidth, h=rootEl.clientHeight||window.innerHeight;
  renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix();
}
function watchRO(){
  if(ro){ ro.disconnect(); ro=null; }
  if(window.ResizeObserver&&rootEl&&rootEl!==document.body){ ro=new ResizeObserver(fit); ro.observe(rootEl); }
}
window.addEventListener('resize',fit);
watchRO();
fit();

/* ---------- day / night ---------- */
function hourNow(){ const c=W.appClock||Date.now(); const d=new Date(c); return d.getHours()+d.getMinutes()/60; }
function dayFactor(h){ return Math.min(smooth(5.5,7.5,h),1-smooth(17.5,20,h)); }

/* ---------- main loop ---------- */
let tSec=0, last=performance.now(), raf=0, running=false, fpsAvg=60, rolloverTimer=0, frame=0;
function update(dt,now){
  tSec+=dt; frame++;
  rolloverTimer+=dt; if(rolloverTimer>5){ rolloverTimer=0; checkRollover(); }
  /* wind */
  W.wind=0.7+0.3*Math.sin(tSec*0.23)+0.15*Math.sin(tSec*0.071);
  /* day-night blend + golden hour */
  const h=hourNow();
  const f=dayFactor(h);
  W.dayF=damp(W.dayF,f,2,dt); W.nightF=1-W.dayF;
  const gold=smooth(5,6.8,h)*(1-smooth(7.5,9.5,h))+smooth(15.5,17.5,h)*(1-smooth(19,20.5,h));
  W.goldF=damp(W.goldF,gold,1.2,dt);
  if(Math.abs(W.dayF-lastSkyF)>0.015||Math.abs(W.goldF-lastGoldF)>0.03){ lastSkyF=W.dayF; lastGoldF=W.goldF; paintSky(W.dayF,W.goldF); }
  scene.fog.color.set(new THREE.Color(0xF7E8D8).lerp(new THREE.Color(0x4E4A6E),W.nightF).lerp(new THREE.Color(0xFFD9B3),W.goldF*0.45));
  hemi.intensity=0.3+0.7*W.dayF;
  amb.intensity=0.12+0.2*W.dayF;
  keyLight.intensity=0.25+1.15*W.dayF;
  keyLight.color.set(new THREE.Color(0xFFE2B8).lerp(new THREE.Color(0xAAB6E8),W.nightF).lerp(new THREE.Color(0xFFAF72),W.goldF*0.8));
  keyLight.position.set(26,40-14*W.goldF,16);
  starMat.opacity=W.nightF*0.9;
  const ha=((h-6)/12)*Math.PI;
  sunSprite.position.set(Math.cos(ha)*120,Math.sin(ha)*110,-30);
  sunSprite.material.opacity=W.dayF;
  moonSprite.position.set(-Math.cos(ha)*120,Math.max(20,-Math.sin(ha)*110),-40);
  moonSprite.material.opacity=W.nightF;
  for(const g of nightGlows){
    if(g.light) g.light.intensity=g.i*W.nightF*(0.9+0.1*Math.sin(tSec*7+g.i*9));
    if(g.m) g.m.emissiveIntensity=0.1+g.i*W.nightF;
  }
  /* drought tint */
  const st=W.appState||{};
  const dTarget=st.streakAlive?0:(W.missedActive?1:0.7);
  const dPrev=W.drought; W.drought=damp(W.drought,dTarget,0.6,dt);
  if(Math.abs(W.drought-dPrev)>0.001){
    W.moundMat.color.set(new THREE.Color(0xFFFFFF).lerp(new THREE.Color(0xC9BC9C),W.drought*0.5));
    for(const m of wiltMats) m.color.copy(m.userData.base).lerp(new THREE.Color(0xB5AC96),W.drought*0.45);
  }
  /* pond */
  pondLevelTarget=clamp01(weekFocus()/WEEK_GOAL)*0.85+0.15+W.pondBoost;
  W.pondBoost=Math.max(0,W.pondBoost-dt*0.002);
  pondLevel=damp(pondLevel,clamp01(pondLevelTarget),0.8,dt);
  pondMesh.scale.setScalar(0.55+0.45*pondLevel);
  shoreMat.color.set(new THREE.Color(COL.mint).lerp(new THREE.Color(0xC9A48A),1-pondLevel));
  pondGlint.material.rotation+=dt*0.15;
  W.rippleT-=dt;
  if(W.rippleT<=0){ W.rippleT=rand(2.2,4.2); ripple(POS.pond[0]+rand(-1.6,1.6),POS.pond[1]+rand(-1.6,1.6),pondY+0.09); }
  /* cloud */
  cloudFill=((st.focusSecondsToday||0)%BLOCK)/BLOCK;
  const raining=now<W.rainUntil||!!W.cloudRainTarget;
  cloudMats.forEach((m,i)=>{ m.color.set(new THREE.Color(0xFFFDF6)
    .lerp(new THREE.Color(0xC9D8E8),cloudFill*0.7)
    .lerp(new THREE.Color(0x9FB4C8),raining?0.5:0)); });
  cloudG.position.y=17.5+Math.sin(tSec*0.5)*0.4-(raining?0.8:0)-cloudFill*0.6;
  cloudG.rotation.y+=dt*0.03;
  cloudG.scale.setScalar(1+cloudFill*0.15);
  if(now<W.rainUntil) for(let i=0;i<4;i++){ const a=Math.random()*6.28,r=Math.random()*10; spawnDrop(Math.cos(a)*r,Math.sin(a)*r,0.6); }
  if(W.cloudRainTarget) for(let i=0;i<3;i++) spawnDrop(W.cloudRainTarget.x,W.cloudRainTarget.z,1.2);
  /* drops / ripples / puddles */
  for(const d of drops){ if(!d.m.visible) continue;
    d.m.position.y-=d.vy*dt;
    if(d.m.position.y<groundY(d.m.position.x,d.m.position.z)+0.1){
      d.m.visible=false; if(Math.random()<0.3) ripple(d.m.position.x,d.m.position.z); } }
  for(const r of ripples){ if(r.t>=1) continue; r.t+=dt/0.7;
    r.m.scale.setScalar(0.4+r.t*1.6); r.m.material.opacity=0.7*(1-r.t);
    if(r.t>=1) r.m.visible=false; }
  for(let i=puddles.length-1;i>=0;i--){ const p=puddles[i]; p.life-=dt;
    p.m.material.opacity=Math.min(1,(24-p.life)*2)*clamp01(p.life/3)*0.5;
    if(p.life<=0){ scene.remove(p.m); puddles.splice(i,1); } }
  /* demo time-lapse: fast-forward growth without touching app state */
  if(W.timelapse){ applyGrowth(dt*900); W.rainUntil=Math.max(W.rainUntil,now+400); }
  /* trees */
  for(const t of W.trees){
    if(!t.landed){
      t.fallY-=dt*11; t.seed.position.y=t.fallY;
      if(t.fallY<=groundY(t.x,t.z)+0.1){
        scene.remove(t.seed); t.seed=null; t.landed=true; t.born=now;
        Petals.spawn(4,[t.x,groundY(t.x,t.z)+0.5,t.z],0.7,[2]);
      }
      continue;
    }
    t.disp=damp(t.disp,t.progress,t.fast?5:1.6,dt);
    const age=(now-t.born)/1000;
    let s=0.14+0.86*easeOutCubic(t.disp);
    if(age<0.8) s*=Math.max(0.05,easeOutBack(age/0.8));
    if(t.popT){ const k=(now-t.popT)/600;
      if(k<1) s*=1+0.22*Math.sin(k*Math.PI); else t.popT=0; }
    const droopT=(W.missedActive&&t.recent)?1:0;
    t.droop=damp(t.droop,droopT,2.5,dt);
    const breath=1+0.015*Math.sin(tSec*1.7+t.phase);
    t.g.scale.setScalar(s*breath*(1+t.diff*0.18));
    t.canopy.visible=t.disp>0.16;
    t.sprout.visible=t.disp<0.34;
    t.canopy.scale.y=1-0.25*t.droop;
    t.canopy.rotation.x=0.35*t.droop;
    t.g.rotation.z=Math.sin(tSec*0.9+t.phase)*0.02;
    t.canopy.rotation.z=Math.sin(tSec*1.3+t.phase)*0.03;
    for(const bl of t.blobs){
      bl.position.y=bl.userData.by+Math.sin(tSec*1.2+bl.userData.ph)*0.05*W.wind;
      bl.rotation.z=Math.sin(tSec*1.4+bl.userData.ph)*0.05*W.wind;
    }
    for(const bl of t.blossoms) bl.visible=t.disp>0.8;
    if(t.progress>=1&&t.harvestedDay!==W.dayKey){
      t.fruitP=Math.min(1,t.fruitP+dt/FRUIT_SECONDS);
    }
    const fv=t.fruitP>0.05?t.fruitP:0;
    t.fruits.forEach((fr,i)=>{ fr.visible=fv>0;
      fr.scale.setScalar(Math.max(0.01,fv*(0.8+0.2*Math.sin(tSec*3+i)))); });
    t.fruitMat.emissiveIntensity=0.4+0.3*Math.sin(tSec*4);
  }
  /* harvest scan */
  if(tSec-W.lastHarvestScan>1.5){
    W.lastHarvestScan=tSec;
    const ripe=W.trees.filter(t=>t.fruitP>=1&&t.harvestedDay!==W.dayKey);
    ripe.forEach((t,i)=>{
      setTimeout(()=>{ t.harvestedDay=W.dayKey; t.fruitP=0;
        W.seeds+=1;
        floater('+1 🌰',new THREE.Vector3(t.x,groundY(t.x,t.z)+3.5,t.z),0.7);
        Petals.spawn(4,[t.x,groundY(t.x,t.z)+2.5,t.z],0.6,[4]);
        sfx.harvest(); queueSave();
      },i*260);
    });
  }
  /* lantern pops */
  for(const l of lanterns){ if(l.userData.pop){ const k=clamp01((now-l.userData.pop)/700);
    l.scale.setScalar(Math.max(0.01,easeOutBack(k))); if(k>=1) l.userData.pop=0; } }
  /* rainbow & aurora */
  const rbT=(st.directive&&st.directive.fullCleared)?0.85:0;
  rainbowOp=damp(rainbowOp,rbT,1.2,dt);
  rainbowMats.forEach(m=>m.opacity=rainbowOp*(0.8+0.2*Math.sin(tSec*2)));
  const auroraT=(W.golden&&W.nightF>0.35)?0.5:0;
  for(const r of auroraRibbons){
    r.material.opacity=damp(r.material.opacity,auroraT,1,dt);
    if(auroraT>0){ const pos=r.geometry.attributes.position, base=r.userData.base;
      for(let i=0;i<pos.count;i++){ const x=base[i*3], y=base[i*3+1];
        pos.setY(i,y+Math.sin(x*0.08+tSec*0.7)*1.6); }
      pos.needsUpdate=true; } }
  /* entities */
  updatePip(dt,now);
  updateBirds(dt,now);
  updateFlowers(now);
  Petals.update(dt);
  updateFloaters(dt);
  updateFireflies(dt,tSec);
  updateShootingStar(dt,now,tSec);
  updateMiniClouds(dt,tSec);
  if(cosmetics.duckie){ cosmetics.duckie.position.y=pondY+0.12+Math.sin(tSec*2)*0.05; cosmetics.duckie.rotation.y+=dt*0.3; }
  if(cosmetics.bunting) cosmetics.bunting.children.forEach((c,i)=>{ if(c.userData.t!=null) c.rotation.z=Math.sin(tSec*2+i)*0.15; });
  lilyPad.position.y=pondY+Math.sin(tSec*1.3)*0.02;
  lilyPad.rotation.y+=dt*0.05;
  /* quiet day ambience */
  W.ambT-=dt;
  if(W.ambT<=0){ W.ambT=rand(9,15); if(AudioKit.on&&W.dayF>0.5) sfx.dayAmbient(); }
  /* camera */
  ctrl.theta=damp(ctrl.theta,ctrl.tTheta,6,dt);
  ctrl.phi=damp(ctrl.phi,ctrl.tPhi,6,dt);
  ctrl.radius=damp(ctrl.radius,ctrl.tRadius,3,dt);
  const sp=Math.sin(ctrl.phi), cp=Math.cos(ctrl.phi);
  camera.position.set(ctrl.target.x+ctrl.radius*sp*Math.sin(ctrl.theta),
    ctrl.target.y+ctrl.radius*cp, ctrl.target.z+ctrl.radius*sp*Math.cos(ctrl.theta));
  camera.lookAt(ctrl.target);
  /* shadows refresh every other frame */
  if(frame%2===0) renderer.shadowMap.needsUpdate=true;
}
function loop(now){
  raf=requestAnimationFrame(loop);
  const dt=Math.min(0.05,(now-last)/1000); last=now;
  fpsAvg=lerp(fpsAvg,1/Math.max(dt,0.001),0.05);
  window.__loopTicks=(window.__loopTicks||0)+1;
  update(dt,now);
  renderer.render(scene,camera);
}
function start(){ if(running) return; running=true; last=performance.now(); raf=requestAnimationFrame(loop); }
function stop(){ running=false; cancelAnimationFrame(raf); }
document.addEventListener('visibilitychange',()=>{ if(document.hidden){ stop(); save(); } else start(); });
window.addEventListener('beforeunload',save);

/* ---------- boot ---------- */
paintSky(1,0); lastSkyF=1; lastGoldF=0;
scatter();
{ const fb=$id('isleFallback'); if(fb) fb.style.display='none'; }
W.ready=true;
/* start/stop are ADDITIVE embed hooks — the app pauses the loop while the
   dashboard card is off-screen (IntersectionObserver in the bridge). */
window.Isle=Object.freeze({setState,event:isleEvent,buy,debug,mount,setPanelVisible,start,stop});
/* APP BUILD: no demo state at boot — the bridge pushes the real app state. */
if(AudioKit.on){ const sb=panel.querySelector('[data-a="sound"]'); if(sb) sb.textContent='🔊 sound'; }
const freshDay=!SAVE||!SAVE.day||SAVE.day!==W.dayKey;
if(W.movedIn) setTimeout(()=>floater('your grove moved in 🌳',new THREE.Vector3(0,13,0),1.1),1500);
if(!freshDay){
  setTimeout(()=>{ pipAction('wave',1800); floater('welcome back! 🌿',new THREE.Vector3(POS.home[0],8,POS.home[1]),1); },1200);
}else{
  setTimeout(()=>floater('welcome to sprout isle 🌱',new THREE.Vector3(0,10,0),1.1),600);
}
console.log('🌱 sprout isle booted');
start();
/* resilience: if the render loop never got scheduled (e.g. the pane was
   mid-init at boot), kick it once the page is visibly alive */
setTimeout(()=>{ if(!document.hidden&&!(window.__loopTicks>0)){ running=false; start(); } },3000);
}


/* ============================================================
   APP BRIDGE — mirrors live JEEmaxxing state into the isle.
   Read-only: it never writes the app's own storage keys.
   ============================================================ */
function startBridge() {
  var Isle = window.Isle;
  if (!Isle) return;
  Isle.setPanelVisible(false);   /* the demo panel stays available for devs: Isle.setPanelVisible(true) */

  var SUBJECTS = ['physics', 'chemistry', 'maths'];
  var LS_DAILY = 'jeemax_forest_daily_v1';

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayKey() { return ymd(new Date()); }
  function readJSON(k) {
    try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : null; }
    catch (e) { return null; }
  }
  function readDailyToday() {
    var st = readJSON(LS_DAILY) || {};
    var t = st[todayKey()] || {};
    var out = {};
    for (var i = 0; i < SUBJECTS.length; i++) {
      out[SUBJECTS[i]] = Math.max(0, Math.floor(Number(t[SUBJECTS[i]]) || 0));
    }
    return out;
  }
  function solvedTotal(o) { return (o.physics || 0) + (o.chemistry || 0) + (o.maths || 0); }

  /* focus seconds studied today — the app's live per-subject counter */
  function readFocusSecs() {
    var s = window._studySecsForCns;
    if (!s || typeof s !== 'object') return 0;
    var t = 0;
    for (var i = 0; i < SUBJECTS.length; i++) t += Math.max(0, Number(s[SUBJECTS[i]]) || 0);
    return Math.floor(t);
  }

  /* streak from the app's daily ledger cache (mirrors updateStreakDisplay's
     walk-back rule: a day counts when count > 0; the chain may live on
     yesterday until midnight). missedDays = full quiet days since the chain
     last broke — never set for users with no history at all. */
  function computeStreak(solvedToday) {
    var active = {};
    var hist = window._dailyHistoryCache;
    if (Array.isArray(hist)) {
      for (var i = 0; i < hist.length; i++) {
        var h = hist[i];
        if (h && h.date && (Number(h.count) || 0) > 0) active[h.date] = true;
      }
    }
    if (solvedTotal(solvedToday) > 0) active[todayKey()] = true;
    var hasAny = false; for (var k in active) { hasAny = true; break; }

    var streakDays = 0;
    var cur = new Date();
    if (!active[ymd(cur)]) cur.setDate(cur.getDate() - 1);
    for (var g = 0; g < 3660; g++) {
      if (active[ymd(cur)]) { streakDays++; cur.setDate(cur.getDate() - 1); }
      else break;
    }
    var missedDays = 0;
    if (streakDays === 0 && hasAny) {
      var probe = new Date(), quiet = 0;
      for (var j = 0; j < 60; j++) { if (active[ymd(probe)]) break; quiet++; probe.setDate(probe.getDate() - 1); }
      missedDays = Math.max(0, quiet - 1);
    }
    return { streakDays: streakDays, streakAlive: streakDays > 0, missedDays: missedDays };
  }

  /* directive (Daily Directive v2) — lives in IndexedDB, read through the
     shared mirror; refreshed on the app's own update event. */
  var directive = { questsDone: 0, questsTotal: 0, headlineDone: false, fullCleared: false, golden: false };
  function refreshDirective() {
    var m = window._idbMirror;
    if (!m || !m.get) return Promise.resolve();
    return m.get('jeemax_directive_v1').then(function (s) {
      if (!s || s.date !== todayKey()) {
        directive.questsDone = 0; directive.questsTotal = 0;
        directive.headlineDone = false; directive.fullCleared = false; directive.golden = false;
        return null;
      }
      var quests = Array.isArray(s.quests) ? s.quests : [];
      var qDone = 0;
      for (var i = 0; i < quests.length; i++) if (quests[i] && quests[i].done) qDone++;
      var hDone = !!(s.headline && s.headline.done);
      directive.questsTotal = quests.length + (s.headline ? 1 : 0);
      directive.questsDone = qDone + (hDone ? 1 : 0);
      directive.headlineDone = hDone;
      directive.fullCleared = directive.questsTotal > 0 && directive.questsDone >= directive.questsTotal;
      return m.get('jeemax_directive_meta').then(function (meta) {
        directive.golden = !!(meta && Number(meta.goldenUntil) > Date.now());
        return null;
      });
    }).catch(function () { return null; });
  }

  var lastFingerprint = null;
  function computeState() {
    var solvedToday = readDailyToday();
    var streak = computeStreak(solvedToday);
    var examRaw = window.AppState && window.AppState.examDate ? new Date(window.AppState.examDate).getTime() : NaN;
    var daysToExam = isFinite(examRaw) ? Math.max(0, Math.ceil((examRaw - Date.now()) / 86400000)) : null;
    return {
      solvedToday: solvedToday,
      streakDays: streak.streakDays,
      streakAlive: streak.streakAlive,
      focusSecondsToday: readFocusSecs(),
      directive: {
        questsDone: directive.questsDone,
        questsTotal: directive.questsTotal,
        headlineDone: directive.headlineDone,
        fullCleared: directive.fullCleared,
        golden: directive.golden
      },
      missedDays: streak.missedDays,
      seeds: null,          /* isle-managed economy */
      daysToExam: daysToExam,
      clock: null           /* isle follows the real wall clock */
    };
  }
  function pushState(force) {
    if (!window.Isle) return;
    var st = computeState();
    var fp = JSON.stringify(st);
    if (!force && fp === lastFingerprint) return;
    lastFingerprint = fp;
    try { window.Isle.setState(st); } catch (e) { console.error('[sprout-isle] setState failed', e); }
  }

  /* ── solve events: watch the dashboard counters (same trick the Grove used),
        diff against the persisted per-subject store, emit one event per new
        solve so trees plant with the right species. ── */
  var lastSeen = null;
  function flushSolves() {
    var now = readDailyToday();
    if (!lastSeen) { lastSeen = now; return; }
    var fired = 0;
    for (var i = 0; i < SUBJECTS.length; i++) {
      var s = SUBJECTS[i];
      var d = now[s] - lastSeen[s];
      while (d > 0 && fired < 8) {
        try { window.Isle.event('solve', { subject: s, difficulty: 0.3 + Math.random() * 0.4 }); } catch (e) { break; }
        d--; fired++;
      }
    }
    lastSeen = now;
  }
  try {
    var mo = new MutationObserver(function () { requestAnimationFrame(function () { flushSolves(); pushState(); }); });
    ['physics-count', 'chemistry-count', 'maths-count'].forEach(function (id) {
      var e = document.getElementById(id);
      if (e) mo.observe(e, { childList: true, subtree: true, characterData: true });
    });
  } catch (e) { /* counters missing — the 3s poll still catches solves */ }

  /* ── focus block moments (dispatched by pomodoro.js) ── */
  window.addEventListener('jmax:pomo-block-done', function () {
    try { window.Isle.event('focusBlockDone', {}); } catch (e) {}
  });
  window.addEventListener('jmax:pomo-forfeit', function () {
    try { window.Isle.event('focusForfeit', {}); } catch (e) {}
  });

  /* ── pause the loop while the card is off-screen (additive start/stop hooks).
     Reconciled on every poll tick so a missed IO edge can never strand the
     loop in the wrong state; the IntersectionObserver gives instant response. ── */
  function isleOnScreen() {
    var h = document.getElementById('isle-root');
    if (!h) return false;
    var r = h.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < (window.innerHeight || 1) &&
           r.right > 0 && r.left < (window.innerWidth || 1);
  }
  function reconcileLoop() {
    try {
      if (!window.Isle || typeof window.Isle.start !== 'function') return;
      if (document.hidden) return;                     /* engine handles tab-hide itself */
      if (isleOnScreen()) window.Isle.start();         /* no-op when already running */
      else window.Isle.stop();
    } catch (e) {}
  }
  try {
    var host = document.getElementById('isle-root');
    if (host && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function () { reconcileLoop(); }, { threshold: 0.05 });
      io.observe(host);
    }
  } catch (e) {}

  /* ── boot + cadence ── */
  pushState(true);
  if (computeState().missedDays > 0 && !sessionStorage.getItem('sproutIsle.missedNoted')) {
    try { window.Isle.event('missedDay', {}); sessionStorage.setItem('sproutIsle.missedNoted', '1'); } catch (e) {}
  }
  refreshDirective().then(function () { pushState(true); });
  window.addEventListener('jmax:directive-updated', function () {
    setTimeout(function () { refreshDirective().then(function () { pushState(); }); }, 600);
  });
  setInterval(function () { flushSolves(); refreshDirective().then(function () { pushState(); }); }, 15000);
  setInterval(function () { flushSolves(); pushState(); reconcileLoop(); }, 3000);

  window.__sproutIsleBridge = { push: pushState, refreshDirective: refreshDirective, flushSolves: flushSolves };
}
})();
