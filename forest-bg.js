/* ============================================================================
forest-bg.js · "Living World" wallpaper + baked-in world-scaled juice (APP file)
Self-contained: toggle, opacity, persistence, counter-watch, time-of-day sky,
tree placement, AND a full juice layer (flowers / pollen motes / stars /
fireflies / campfire / growth bursts + shockwaves / streak-warm light / rim+fill).
The juice is sized for the high orbiting camera so it actually reads.
ISOLATED + SAFE: if the juice build throws, juice=null and the plain wallpaper
still runs. The render loop is guarded so it never spams TypeErrors.
DO NOT load forest-juice.js (lab-only) or point forest-island-juice.js here.
============================================================================ */
(function () {
'use strict';
if (window.__forestBgInit) return; window.__forestBgInit = true;

var LS_ON = 'jeemax_forest_bg', LS_OP = 'jeemax_forest_bg_op';
var CAP = 6000, WL = -1.1, FRAME = 1000 / 30;
var SUBJ = ['physics', 'chemistry', 'maths'];
var SUBRGB = { physics:[0.30,0.79,1.0], chemistry:[0.22,0.85,0.54], maths:[1.0,0.70,0.14], oak:[0.85,0.63,0.40] };
function srgb(k){ return SUBRGB[k] || SUBRGB.physics; }

function toast(m){ console.warn('[forest-bg]', m); try { var d=document.createElement('div'); d.textContent='⚠ '+m; Object.assign(d.style,{position:'fixed',left:'50%',bottom:'14px',transform:'translateX(-50%)',zIndex:'60',background:'rgba(20,16,8,.92)',border:'1px solid rgba(255,178,36,.4)',color:'#ffd9a0',padding:'8px 14px',borderRadius:'10px',font:'12px/1.4 monospace',maxWidth:'88vw',boxShadow:'0 8px 24px rgba(0,0,0,.6)',pointerEvents:'none'}); document.body.appendChild(d); setTimeout(function(){d.style.transition='opacity .5s';d.style.opacity='0';setTimeout(function(){if(d.parentNode)d.parentNode.removeChild(d);},600);},6000);} catch(_){} }
function el(tag,a){var n=document.createElement(tag);if(a)for(var k in a){if(k==='html')n.innerHTML=a[k];else if(k==='class')n.className=a[k];else n.setAttribute(k,a[k]);}return n;}
function rand(a,b){return a+Math.random()*(b-a);}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function hash(x,z){var n=Math.sin(x*127.1+z*311.7)*43758.5453;return n-Math.floor(n);}
function vnoise(x,z){var xi=Math.floor(x),zi=Math.floor(z),xf=x-xi,zf=z-zi,u=xf*xf*(3-2*xf),v=zf*zf*(3-2*zf),a=hash(xi,zi),b=hash(xi+1,zi),c=hash(xi,zi+1),d=hash(xi+1,zi+1);return a*(1-u)*(1-v)+b*u*(1-v)+c*(1-u)*v+d*u*v;}
function heightAt(x,z){var h=(vnoise(x*0.035,z*0.035)-0.5)*8+(vnoise(x*0.09,z*0.09)-0.5)*2.5+(vnoise(x*0.2,z*0.2)-0.5)*0.8;var dd=Math.hypot(x+9,z-7);h-=Math.max(0,3.4-dd*0.5);return h;}
function realTOD(){var d=new Date();return ((d.getHours()+d.getMinutes()/60)/24)*100;}
function nightFactor(t){var u=t/100;return Math.max(0,Math.min(1,Math.abs(u-0.5)*2));}
function normSub(s){s=(s||'').toString().toLowerCase().trim();return (s==='math'||s==='mathematics')?'maths':(SUBJ.indexOf(s)>=0?s:'physics');}
function qEloOf(q){return (typeof q.qElo==='number'&&q.qElo>0)?q.qElo:1200;}
function todayStr(){return new Date().toISOString().slice(0,10);}
function rc(id){var e=document.getElementById(id);return e?(parseInt(e.textContent,10)||0):0;}
function liveTotal(){return rc('physics-count')+rc('chemistry-count')+rc('maths-count');}
function solvedBank(){var qb=window.questionBank||[],o=[];for(var i=0;i<qb.length;i++){var q=qb[i];if(q&&q.status==='solved')o.push(q);}return o;}
function historical(){var tk=todayStr(),qb=solvedBank(),o=[];for(var i=0;i<qb.length;i++){var q=qb[i];if((q.lastReviewedAt||'').slice(0,10)!==tk)o.push({subject:normSub(q.subject),qElo:qEloOf(q)});}return o;}
function todayReal(){var tk=todayStr(),qb=solvedBank(),o=[];for(var i=0;i<qb.length;i++){var q=qb[i];if((q.lastReviewedAt||'').slice(0,10)===tk)o.push({subject:normSub(q.subject),qElo:qEloOf(q)});}return o;}
function computeBgTrees(){
  var trees=historical().concat(todayReal());
  var extra=Math.max(0,liveTotal()-todayReal().length);
  for(var i=0;i<extra;i++)trees.push({subject:SUBJ[(Math.random()*3)|0],qElo:1100+Math.random()*700});
  if(trees.length>CAP){var step=trees.length/CAP,o=[];for(var j=0;j<CAP;j++)o.push(trees[Math.floor(j*step)]);trees=o;}
  return trees;
}
function bgSig(){return (window.questionBank?window.questionBank.length:0)+'|'+solvedBank().length+'|'+liveTotal();}

var THREE=null,renderer,scene,camera,env=null,treeMat;
var canvas,btn,pop,sw,opInput;
var enabled=false,building=false,built=false,opacity=0.5,lastSig='';
var raf=null,last=0,elT=0,orbit=0,curTOD=50,lastTOD=0;
var juice=null,lastTreeCount=0;
var TOD=[
  {t:0,  top:0x0a0e1c,bot:0x141a2a,sun:0x3a4a6a,sunI:0.15,hemi:0x2a3040,fog:0x0e1220},
  {t:22, top:0x2a3a5e,bot:0xe8956a,sun:0xffb27a,sunI:0.70,hemi:0x5a5a6a,fog:0x3a3040},
  {t:50, top:0x4a7ec0,bot:0xc4dcec,sun:0xfff2e0,sunI:1.15,hemi:0x8aa0b8,fog:0x9ab4c8},
  {t:78, top:0x3a2a52,bot:0xe07a44,sun:0xff8a4a,sunI:0.75,hemi:0x6a5060,fog:0x4a3444},
  {t:100,top:0x0a0e1c,bot:0x141a2a,sun:0x3a4a6a,sunI:0.15,hemi:0x2a3040,fog:0x0e1220}
];
function applyTOD(v){
  if(!env)return;curTOD=v;var a=TOD[0],b=TOD[TOD.length-1];
  for(var i=0;i<TOD.length-1;i++)if(v>=TOD[i].t&&v<=TOD[i+1].t){a=TOD[i];b=TOD[i+1];break;}
  var f=(v-a.t)/Math.max(0.0001,b.t-a.t);
  function L(x,y){return new THREE.Color(x).lerp(new THREE.Color(y),f);}
  env.skyTop.copy(L(a.top,b.top));env.skyBot.copy(L(a.bot,b.bot));
  env.sun.color.copy(L(a.sun,b.sun));env.sun.intensity=a.sunI+(b.sunI-a.sunI)*f;
  env.sun.position.set((v/100-0.5)*160,70,30);
  env.hemi.color.copy(L(a.hemi,b.hemi));env.hemi.groundColor.copy(env.skyBot).multiplyScalar(0.5);
  env.fog.color.copy(L(a.fog,b.fog));
}
function loadThree(){
  var urls=['https://esm.sh/three@0.160.0','https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js','https://unpkg.com/three@0.160.0/build/three.module.js'];
  function tryOne(i){return new Promise(function(res,rej){if(i>=urls.length)return rej(new Error('all CDNs failed'));import(urls[i]).then(function(m){res(m);}).catch(function(){tryOne(i+1).then(res,rej);});});}
  return tryOne(0);
}
function glowTex(){var c=document.createElement('canvas');c.width=c.height=64;var g=c.getContext('2d');var r=g.createRadialGradient(32,32,0,32,32,32);r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(0.3,'rgba(255,240,180,.8)');r.addColorStop(1,'rgba(255,240,180,0)');g.fillStyle=r;g.fillRect(0,0,64,64);var t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;}
function prep(g){return g.index?g.toNonIndexed():g;}
function paint(g,r,gr,b){g=prep(g);g.deleteAttribute('uv');var n=g.attributes.position.count,c=new Float32Array(n*3);for(var i=0;i<n;i++){c[i*3]=r;c[i*3+1]=gr;c[i*3+2]=b;}g.setAttribute('color',new THREE.BufferAttribute(c,3));return g;}
function paintGrad(g,base,top){g=prep(g);g.deleteAttribute('uv');var p=g.attributes.position,n=p.count,c=new Float32Array(n*3),ymin=1e9,ymax=-1e9;for(var i=0;i<n;i++){var y=p.getY(i);if(y<ymin)ymin=y;if(y>ymax)ymax=y;}for(var j=0;j<n;j++){var t=(p.getY(j)-ymin)/Math.max(0.001,ymax-ymin);c[j*3]=base[0]+(top[0]-base[0])*t;c[j*3+1]=base[1]+(top[1]-base[1])*t;c[j*3+2]=base[2]+(top[2]-base[2])*t;}g.setAttribute('color',new THREE.BufferAttribute(c,3));return g;}
function mergeGeos(list){list=list.map(function(g){return g.index?g.toNonIndexed():g;});var n=0;list.forEach(function(g){n+=g.attributes.position.count;});var pos=new Float32Array(n*3),nor=new Float32Array(n*3),col=new Float32Array(n*3),o=0;list.forEach(function(g){var c=g.attributes.position.count;pos.set(g.attributes.position.array,o*3);if(g.attributes.normal)nor.set(g.attributes.normal.array,o*3);if(g.attributes.color)col.set(g.attributes.color.array,o*3);o+=c;});var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('normal',new THREE.BufferAttribute(nor,3));g.setAttribute('color',new THREE.BufferAttribute(col,3));return g;}
function spruceGeo(){var t=paint(new THREE.CylinderGeometry(0.09,0.16,0.9,6).translate(0,0.45,0),0.30,0.20,0.12);var c1=paintGrad(new THREE.ConeGeometry(0.78,1.15,7).translate(0,1.35,0),[0.02,0.46,0.58],[0.10,0.66,0.82]);var c2=paintGrad(new THREE.ConeGeometry(0.60,0.98,7).translate(0,1.98,0),[0.05,0.56,0.72],[0.15,0.76,0.92]);var c3=paintGrad(new THREE.ConeGeometry(0.42,0.82,7).translate(0,2.55,0),[0.10,0.68,0.84],[0.22,0.80,0.92]);return mergeGeos([t,c1,c2,c3]);}
function roundGeo(){var t=paint(new THREE.CylinderGeometry(0.11,0.18,1.0,6).translate(0,0.5,0),0.32,0.21,0.12);var b1=paintGrad(new THREE.IcosahedronGeometry(0.82,1).translate(0,1.55,0),[0.05,0.55,0.10],[0.16,0.80,0.18]);var b2=paintGrad(new THREE.IcosahedronGeometry(0.55,1).translate(0.35,2.05,0.1),[0.10,0.68,0.16],[0.24,0.92,0.26]);return mergeGeos([t,b1,b2]);}
function goldenGeo(){var t=paint(new THREE.CylinderGeometry(0.10,0.17,0.95,6).translate(0,0.47,0),0.32,0.20,0.11);var d1=paintGrad(new THREE.DodecahedronGeometry(0.78,0).translate(0,1.5,0),[0.85,0.46,0.02],[1.0,0.72,0.06]);var d2=paintGrad(new THREE.DodecahedronGeometry(0.50,0).translate(-0.2,2.1,-0.1),[0.95,0.60,0.04],[1.0,0.84,0.12]);return mergeGeos([t,d1,d2]);}
function oakGeo(){var t=paint(new THREE.CylinderGeometry(0.22,0.42,2.4,7).translate(0,1.2,0),0.16,0.11,0.07);var c1=paintGrad(new THREE.IcosahedronGeometry(1.7,1).scale(1.25,0.95,1.25).translate(0,3.1,0),[0.06,0.16,0.05],[0.13,0.30,0.09]);var c2=paintGrad(new THREE.IcosahedronGeometry(1.35,1).scale(1.2,0.9,1.2).translate(0.7,3.9,0.4),[0.08,0.20,0.06],[0.16,0.36,0.12]);var c3=paintGrad(new THREE.IcosahedronGeometry(1.2,1).scale(1.15,0.9,1.15).translate(-0.6,3.8,-0.3),[0.07,0.18,0.06],[0.15,0.34,0.11]);var c4=paintGrad(new THREE.IcosahedronGeometry(1.0,1).scale(1.1,0.85,1.1).translate(0.1,4.5,0.1),[0.10,0.24,0.07],[0.19,0.42,0.14]);return mergeGeos([t,c1,c2,c3,c4]);}
function buildSpots(half){
  var sp=2.4,spots=[];
  for(var x=-half;x<=half;x+=sp)for(var z=-half;z<=half;z+=sp){
    var h=heightAt(x,z);if(h<WL+0.25)continue;
    var hx=heightAt(x+0.6,z)-heightAt(x-0.6,z),hz=heightAt(x,z+0.6)-heightAt(x,z-0.6);
    if(Math.hypot(hx,hz)/1.2>0.6)continue;
    spots.push({x:x,y:h,z:z});
  }
  // centre-first so the camera's view fills before the far edges
  spots.sort(function(a,b){return Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z);});
  return spots;
}

/* ═══════════════════ world-scaled JUICE layer ═══════════════════ */
function findCamp(){
  var best=null;
  for(var r=14;r<=36&&!best;r+=4){
    for(var a=0;a<6.283;a+=0.5){
      var x=Math.cos(a)*r,z=Math.sin(a)*r,h=heightAt(x,z);
      if(h<0.6||h>2.6)continue;
      var hx=heightAt(x+0.8,z)-heightAt(x-0.8,z),hz=heightAt(x,z+0.8)-heightAt(x,z-0.8);
      if(Math.hypot(hx,hz)/1.6>0.5)continue;
      best={x:x,y:h,z:z};break;
    }
  }
  if(!best){var x=22,z=-14;best={x:x,y:Math.max(heightAt(x,z),0.6),z:z};}
  return best;
}
function buildJuice(T,sc,sprite){
  var J={warm:new T.Color(0xffb066)};
  // ── flower meadow (screen-space speckle so it reads from altitude) ──
  try{
    var fspots=(env.spots||[]).filter(function(s){return s.y>0.5&&s.y<3.2;});
    var FN=Math.min(2600,fspots.length),fp=new Float32Array(FN*3),fc=new Float32Array(FN*3);
    var pal=[new T.Color(0x4cc9ff),new T.Color(0x39d98a),new T.Color(0xffb224),new T.Color(0xff7ab8),new T.Color(0xfff3b0)];
    for(var i=0;i<FN;i++){var s=fspots[(Math.random()*fspots.length)|0];var c=pal[(Math.random()*pal.length)|0];fp[i*3]=s.x+rand(-0.6,0.6);fp[i*3+1]=s.y+0.1;fp[i*3+2]=s.z+rand(-0.6,0.6);fc[i*3]=c.r;fc[i*3+1]=c.g;fc[i*3+2]=c.b;}
    var fg=new T.BufferGeometry();fg.setAttribute('position',new T.BufferAttribute(fp,3));fg.setAttribute('color',new T.BufferAttribute(fc,3));
    J.flowerMat=new T.PointsMaterial({size:1.7,map:sprite,transparent:true,opacity:0.5,depthWrite:false,blending:T.AdditiveBlending,vertexColors:true,sizeAttenuation:false});
    var fpts=new T.Points(fg,J.flowerMat);fpts.frustumCulled=false;sc.add(fpts);
  }catch(e){J.flowerMat=null;}
  // ── daytime pollen motes (drifting, near the camera's focus) ──
  try{
    var MN=90,mp=new Float32Array(MN*3);J.moteBase=[];
    for(var m=0;m<MN;m++){var bx=rand(-45,45),by=rand(5,34),bz=rand(-45,45);J.moteBase.push({x:bx,y:by,z:bz,ph:rand(0,6.283),sp:rand(0.2,0.6)});mp[m*3]=bx;mp[m*3+1]=by;mp[m*3+2]=bz;}
    J.moteGeo=new T.BufferGeometry();J.moteGeo.setAttribute('position',new T.BufferAttribute(mp,3));
    J.moteMat=new T.PointsMaterial({size:1.2,map:sprite,transparent:true,opacity:0.2,depthWrite:false,blending:T.AdditiveBlending,color:0xfff0c8,sizeAttenuation:true});
    var mpts=new T.Points(J.moteGeo,J.moteMat);mpts.frustumCulled=false;sc.add(mpts);
  }catch(e){J.moteMat=null;}
  // ── starfield (night dome) ──
  try{
    var SN=240,sp2=new Float32Array(SN*3),sc2=new Float32Array(SN*3);
    for(var si=0;si<SN;si++){var aa=rand(0,6.283),rr=rand(330,380),yy=rand(40,360);sp2[si*3]=Math.cos(aa)*rr;sp2[si*3+1]=yy;sp2[si*3+2]=Math.sin(aa)*rr;var bb=rand(0.5,1);sc2[si*3]=bb;sc2[si*3+1]=bb;sc2[si*3+2]=bb;}
    var sg=new T.BufferGeometry();sg.setAttribute('position',new T.BufferAttribute(sp2,3));sg.setAttribute('color',new T.BufferAttribute(sc2,3));
    J.starMat=new T.PointsMaterial({size:1.6,map:sprite,transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending,vertexColors:true,sizeAttenuation:false});
    var stpts=new T.Points(sg,J.starMat);stpts.frustumCulled=false;sc.add(stpts);
  }catch(e){J.starMat=null;}
  // ── campfire: warm light pool + flame core + rising embers ──
  try{
    var cp=findCamp();J.camp=cp;
    J.campLight=new T.PointLight(0xff8a3c,0.0,60,2);J.campLight.position.set(cp.x,cp.y+2,cp.z);sc.add(J.campLight);
    J.campGlow=new T.Sprite(new T.SpriteMaterial({map:sprite,color:0xffb066,transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending}));J.campGlow.scale.set(16,16,1);J.campGlow.position.set(cp.x,cp.y+1.2,cp.z);sc.add(J.campGlow);
    J.campCore=new T.Sprite(new T.SpriteMaterial({map:sprite,color:0xffd089,transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending}));J.campCore.scale.set(5,5,1);J.campCore.position.set(cp.x,cp.y+0.8,cp.z);sc.add(J.campCore);
    var EN=50,ep=new Float32Array(EN*3),ec=new Float32Array(EN*3);J.emberState=[];
    for(var e=0;e<EN;e++){J.emberState.push({life:rand(0.2,1.8),max:rand(1.1,2.4),px:rand(-0.6,0.6),py:rand(0.2,1.2),pz:rand(-0.6,0.6),vx:rand(-0.2,0.2),vy:rand(0.6,1.3),vz:rand(-0.2,0.2)});ep[e*3]=cp.x+J.emberState[e].px;ep[e*3+1]=cp.y+J.emberState[e].py;ep[e*3+2]=cp.z+J.emberState[e].pz;}
    J.emberGeo=new T.BufferGeometry();J.emberGeo.setAttribute('position',new T.BufferAttribute(ep,3));J.emberGeo.setAttribute('color',new T.BufferAttribute(ec,3));
    J.emberMat=new T.PointsMaterial({size:1.4,map:sprite,transparent:true,depthWrite:false,blending:T.AdditiveBlending,vertexColors:true,sizeAttenuation:true});
    var epts=new T.Points(J.emberGeo,J.emberMat);epts.frustumCulled=false;sc.add(epts);
  }catch(e){J.camp=null;}
  // ── growth spark pool + shockwave rings ──
  try{
    var POOL=600;J.sPos=new Float32Array(POOL*3);J.sCol=new Float32Array(POOL*3);J.sLife=new Float32Array(POOL);J.sMax=new Float32Array(POOL);J.sVx=new Float32Array(POOL);J.sVy=new Float32Array(POOL);J.sVz=new Float32Array(POOL);J.sBr=new Float32Array(POOL);J.sBg=new Float32Array(POOL);J.sBb=new Float32Array(POOL);J.sFree=0;J.queue=[];
    for(var pi=0;pi<POOL;pi++)J.sPos[pi*3+1]=-9999;
    J.sparkGeo=new T.BufferGeometry();J.sparkGeo.setAttribute('position',new T.BufferAttribute(J.sPos,3));J.sparkGeo.setAttribute('color',new T.BufferAttribute(J.sCol,3));
    J.sparkMat=new T.PointsMaterial({size:1.6,map:sprite,transparent:true,depthWrite:false,blending:T.AdditiveBlending,vertexColors:true,sizeAttenuation:true});
    var spts=new T.Points(J.sparkGeo,J.sparkMat);spts.frustumCulled=false;sc.add(spts);
  }catch(e){J.sparkGeo=null;}
  J.rings=[];
  // ── extra atmosphere: cool rim + warm fill ──
  try{var rim=new T.DirectionalLight(0x66ccff,0.22);rim.position.set(-120,90,-120);sc.add(rim);var fill=new T.DirectionalLight(0xffe6c4,0.14);fill.position.set(120,50,-90);sc.add(fill);}catch(e){}
  J.streakCache=0;J.streakAt=-10;
  return J;
}
function juiceUpdate(J,el,dt,night){
  if(J.flowerMat)J.flowerMat.opacity=0.42+0.16*Math.sin(el*1.3)+night*0.10;
  if(J.starMat)J.starMat.opacity=night*0.9;
  if(J.moteMat){J.moteMat.opacity=(0.16+0.10*Math.sin(el*0.7))*(1-night*0.8);var ma=J.moteGeo.attributes.position.array;for(var i=0;i<J.moteBase.length;i++){var b=J.moteBase[i];ma[i*3]=b.x+Math.sin(el*b.sp+b.ph)*3;ma[i*3+1]=b.y+Math.sin(el*b.sp*0.7+b.ph)*2;ma[i*3+2]=b.z+Math.cos(el*b.sp*0.8+b.ph)*3;}J.moteGeo.attributes.position.needsUpdate=true;}
  if(J.camp){var fl=0.7+0.3*Math.abs(Math.sin(el*9));J.campLight.intensity=(0.5+night*2.4)*fl;J.campGlow.material.opacity=(0.30+night*0.55)*fl;J.campCore.material.opacity=(0.45+night*0.4)*fl;var ea=J.emberGeo.attributes.position.array,ecol=J.emberGeo.attributes.color.array;for(var e=0;e<J.emberState.length;e++){var s=J.emberState[e];s.life-=dt;if(s.life<=0){s.life=s.max;s.px=rand(-0.6,0.6);s.py=0.2;s.pz=rand(-0.6,0.6);s.vx=rand(-0.2,0.2);s.vy=rand(0.6,1.3);s.vz=rand(-0.2,0.2);}s.px+=s.vx*dt;s.py+=s.vy*dt;s.pz+=s.vz*dt;var f=Math.max(0,s.life/s.max);ea[e*3]=J.camp.x+s.px;ea[e*3+1]=J.camp.y+s.py;ea[e*3+2]=J.camp.z+s.pz;ecol[e*3]=1.0*f;ecol[e*3+1]=0.5*f;ecol[e*3+2]=0.15*f;}J.emberGeo.attributes.position.needsUpdate=true;J.emberGeo.attributes.color.needsUpdate=true;}
  // growth sparks
  if(J.sparkGeo){var take=Math.min(J.queue.length,40);for(var k=0;k<take;k++){var p=J.queue.shift();var idx=-1;for(var q=0;q<J.sPos.length/3;q++){var ii=(J.sFree+q)%(J.sPos.length/3);if(J.sLife[ii]<=0){J.sFree=(ii+1)%(J.sPos.length/3);idx=ii;break;}}if(idx<0)break;J.sPos[idx*3]=p[0]+rand(-0.3,0.3);J.sPos[idx*3+1]=p[1]+rand(0,0.6);J.sPos[idx*3+2]=p[2]+rand(-0.3,0.3);var an=rand(0,6.283),spd=rand(1.5,3.5);J.sVx[idx]=Math.cos(an)*spd;J.sVz[idx]=Math.sin(an)*spd;J.sVy[idx]=rand(2,4.5);J.sLife[idx]=rand(0.7,1.3);J.sMax[idx]=J.sLife[idx];J.sBr[idx]=p[3];J.sBg[idx]=p[4];J.sBb[idx]=p[5];}var any=false;for(var s=0;s<J.sLife.length;s++){if(J.sLife[s]<=0)continue;any=true;J.sLife[s]-=dt;if(J.sLife[s]<=0){J.sPos[s*3+1]=-9999;J.sCol[s*3]=J.sCol[s*3+1]=J.sCol[s*3+2]=0;continue;}J.sVy[s]-=2.2*dt;J.sPos[s*3]+=J.sVx[s]*dt;J.sPos[s*3+1]+=J.sVy[s]*dt;J.sPos[s*3+2]+=J.sVz[s]*dt;var ff=J.sLife[s]/J.sMax[s];J.sCol[s*3]=J.sBr[s]*ff;J.sCol[s*3+1]=J.sBg[s]*ff;J.sCol[s*3+2]=J.sBb[s]*ff;}if(any||J.queue.length){J.sparkGeo.attributes.position.needsUpdate=true;J.sparkGeo.attributes.color.needsUpdate=true;}}
  // shockwave rings
  var now=performance.now();for(var r=J.rings.length-1;r>=0;r--){var w=J.rings[r];var pp=(now-w.t0)/700;if(pp>=1){scene.remove(w.mesh);w.geo.dispose();w.mat.dispose();J.rings.splice(r,1);}else{var ss=1+pp*6;w.mesh.scale.set(ss,1,ss);w.mat.opacity=0.7*(1-pp);}}
  // streak-warmed sunlight
  if(el-J.streakAt>2){J.streakAt=el;var eln=document.getElementById('top-streak');var mm=eln?(eln.textContent||'').match(/(\d+)/):null;J.streakCache=mm?(parseInt(mm[1],10)||0):0;}
  var kk=Math.min(1,J.streakCache/7)*0.3;if(kk>0&&env&&env.sun){env.sun.color.lerp(J.warm,Math.min(1,dt*1.2)*kk);if(env.hemi)env.hemi.color.lerp(J.warm,Math.min(1,dt)*kk*0.6);}
}

function buildScene(){
  renderer=new THREE.WebGLRenderer({canvas:canvas,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  renderer.setSize(innerWidth,innerHeight);
  renderer.setClearColor(0x070809,1);
  scene=new THREE.Scene();
  env={fog:new THREE.FogExp2(0x9ab4c8,0.006)};scene.fog=env.fog;
  camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,0.1,900);
  camera.position.set(0,95,140);camera.lookAt(0,4,0);
  var skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color()},bottom:{value:new THREE.Color()},off:{value:18},exp:{value:0.62}},vertexShader:'varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform vec3 top,bottom; uniform float off,exp; varying vec3 vW; void main(){ float h=normalize(vW+vec3(0.,off,0.)).y; float t=pow(max(h,0.),exp); gl_FragColor=vec4(mix(bottom,top,t),1.);}' });
  env.skyTop=skyMat.uniforms.top.value;env.skyBot=skyMat.uniforms.bottom.value;
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(420,32,16),skyMat));
  env.hemi=new THREE.HemisphereLight(0x8aa0b8,0x3a3020,0.72);scene.add(env.hemi);
  env.sun=new THREE.DirectionalLight(0xfff2e0,1.15);env.sun.position.set(20,70,30);scene.add(env.sun);
  scene.add(new THREE.AmbientLight(0xffffff,0.12));
  var half=180,seg=140,tGeo=new THREE.PlaneGeometry(half*2,half*2,seg,seg);tGeo.rotateX(-Math.PI/2);
  var p=tGeo.attributes.position,col=new Float32Array(p.count*3);
  var gr=[0.10,0.46,0.08],li=[0.26,0.66,0.10],mu=[0.26,0.24,0.16],ro=[0.42,0.44,0.40];
  function mx(a,b,t){return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];}
  for(var i=0;i<p.count;i++){var x=p.getX(i),z=p.getZ(i),h=heightAt(x,z);p.setY(i,h);var c,j=(hash(x,z)-0.5)*0.06;if(h<WL+0.35)c=mu;else if(h<1.6)c=mx(gr,li,Math.max(0,(h+0.5)/2.1));else if(h<3.4)c=li;else c=mx(li,ro,Math.min(1,(h-3.4)/2));col[i*3]=c[0]+j;col[i*3+1]=c[1]+j;col[i*3+2]=c[2]+j;}
  tGeo.setAttribute('color',new THREE.BufferAttribute(col,3));tGeo.computeVertexNormals();
  scene.add(new THREE.Mesh(tGeo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0,flatShading:true})));
  var water=new THREE.Mesh(new THREE.PlaneGeometry(half*2,half*2),new THREE.MeshStandardMaterial({color:0x244a60,transparent:true,opacity:0.8,roughness:0.12,metalness:0.4}));
  water.rotation.x=-Math.PI/2;water.position.y=WL;scene.add(water);env.water=water;
  treeMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.82,metalness:0,flatShading:true});
  treeMat.onBeforeCompile=function(sh){sh.uniforms.uTime={value:0};sh.vertexShader='uniform float uTime;\n'+sh.vertexShader.replace('#include <begin_vertex>',"#include <begin_vertex>\n float sw=max(transformed.y-0.7,0.0);\n float ph=instanceMatrix[3][0]*0.6+instanceMatrix[3][2]*0.6;\n transformed.x+=sin(uTime*1.3+ph)*sw*0.030;\n transformed.z+=cos(uTime*1.0+ph)*sw*0.024;");treeMat.userData.shader=sh;};
  env.geos={physics:spruceGeo(),chemistry:roundGeo(),maths:goldenGeo(),oak:oakGeo()};
  env.spots=buildSpots(172);
  // existing night fireflies
  try{
    var FN=160,fp=new Float32Array(FN*3),fc=new Float32Array(FN*3);env.ffBase=[];
    for(var k=0;k<FN;k++){var fx=(Math.random()-0.5)*half*1.4,fz=(Math.random()-0.5)*half*1.4,fy=Math.max(heightAt(fx,fz),WL)+0.6+Math.random()*3;env.ffBase.push({x:fx,y:fy,z:fz,ph:Math.random()*6.28,sp:0.3+Math.random()*0.6});fp[k*3]=fx;fp[k*3+1]=fy;fp[k*3+2]=fz;}
    env.ffGeo=new THREE.BufferGeometry();env.ffGeo.setAttribute('position',new THREE.BufferAttribute(fp,3));env.ffGeo.setAttribute('color',new THREE.BufferAttribute(fc,3));
    env.ffMat=new THREE.PointsMaterial({size:0.9,map:glowTex(),transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,vertexColors:true,sizeAttenuation:true});
    env.ff=new THREE.Points(env.ffGeo,env.ffMat);env.ff.frustumCulled=false;scene.add(env.ff);
  }catch(e){}
  // juice (guarded — plain wallpaper survives if this throws)
  try{juice=buildJuice(THREE,scene,glowTex());}catch(e){juice=null;console.warn('[forest-bg] juice skipped:',e&&e.message||e);}
}
function placeTrees(data){
  if(!env||!env.geos)return;
  (env.treeMeshes||[]).forEach(function(m){scene.remove(m);if(m.geometry)m.geometry.dispose();});
  env.treeMeshes=[];
  var spots=env.spots;if(!spots||!spots.length)return;
  var groups={physics:[],chemistry:[],maths:[],oak:[]};
  data.forEach(function(d,i){var oak=(d.qElo||1200)>=2300;(groups[oak?'oak':(d.subject||'physics')]).push({i:i,base:(0.55+Math.min(1,Math.max(0,((d.qElo||1200)-800)/2200))*1.1+(hash(i,7)-0.5)*0.16)*(oak?0.85:1),sy:(0.82+hash(i,11)*0.5)*(oak?0.95:1),sxz:0.85+hash(i,13)*0.32,lx:(hash(i,17)-0.5)*0.1*(oak?0.4:1),lz:(hash(i,19)-0.5)*0.1*(oak?0.4:1),rot:hash(i,3)*6.283});});
  var dummy=new THREE.Object3D();
  Object.keys(groups).forEach(function(k){var list=groups[k];if(!list.length)return;var m=new THREE.InstancedMesh(env.geos[k],treeMat,list.length);m.frustumCulled=false;list.forEach(function(t,j){var s=spots[t.i%spots.length];var sc=t.base;dummy.position.set(s.x+(hash(t.i,5)-0.5)*0.6,s.y-0.06,s.z+(hash(t.i,6)-0.5)*0.6);dummy.rotation.set(t.lx,t.rot,t.lz);dummy.scale.set(t.sxz*sc,t.sy*sc,t.sxz*sc);dummy.updateMatrix();m.setMatrixAt(j,dummy.matrix);});m.instanceMatrix.needsUpdate=true;scene.add(m);env.treeMeshes.push(m);});
  // growth celebration: burst + ring at the newly added trees
  if(juice){var grown=data.length-lastTreeCount;if(grown>0){var n=Math.min(grown,8);for(var gi=0;gi<n;gi++){var ii=lastTreeCount+gi;var sp=spots[ii%spots.length];if(!sp)continue;var d=data[ii]||data[0];var c=srgb(d?d.subject:'physics');if(juice.queue)for(var b=0;b<14;b++)juice.queue.push([sp.x,Math.max(sp.y,0)+1.5,sp.z,c[0],c[1],c[2]]);try{var rg=new THREE.RingGeometry(2,3.4,24);rg.rotateX(-Math.PI/2);var rm=new THREE.MeshBasicMaterial({color:new THREE.Color(c[0],c[1],c[2]),transparent:true,opacity:0.7,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending});var rmesh=new THREE.Mesh(rg,rm);rmesh.position.set(sp.x,Math.max(sp.y,0)+0.3,sp.z);scene.add(rmesh);juice.rings.push({mesh:rmesh,geo:rg,mat:rm,t0:performance.now()});}catch(e){}}}lastTreeCount=data.length;}
}
function rebuildIfNeeded(force){var sig=bgSig();if(force||sig!==lastSig){lastSig=sig;if(built)placeTrees(computeBgTrees());}}
function ensureBuilt(){
  if(built||building)return;building=true;
  loadThree().then(function(m){THREE=m;try{buildScene();built=true;applyTOD(realTOD());rebuildIfNeeded(true);}catch(e){toast('Living world build failed: '+(e&&e.message||e));enabled=false;document.body.classList.remove('forest-bg-on');if(btn)btn.classList.remove('active');if(canvas)canvas.style.opacity='0';}building=false;}).catch(function(){toast('Could not load the 3D engine (network/CDN). Grid background kept.');enabled=false;document.body.classList.remove('forest-bg-on');if(btn)btn.classList.remove('active');if(canvas)canvas.style.opacity='0';building=false;});
}
function frame(t){
  if(!enabled||document.hidden){raf=null;return;}
  raf=requestAnimationFrame(frame);                 // keep alive even pre-build
  if(!built||!renderer||!scene||!camera)return;     // guard: no TypeError spam
  if(t-last<FRAME)return;var dt=Math.min(0.05,(t-last)/1000||0);last=t;elT+=dt;
  orbit+=dt*0.06;
  var R=140,H=95;camera.position.set(Math.sin(orbit)*R,H,Math.cos(orbit)*R);camera.lookAt(0,4,0);
  if(t-lastTOD>30000){lastTOD=t;applyTOD(realTOD());}
  var night=nightFactor(curTOD);
  if(env.water)env.water.position.y=WL+Math.sin(elT*0.6)*0.04;
  if(treeMat&&treeMat.userData.shader)treeMat.userData.shader.uniforms.uTime.value=elT;
  if(env&&env.ffMat){env.ffMat.opacity=night*0.9;if(env.ffGeo&&night>0.02){var arr=env.ffGeo.attributes.position.array,ca=env.ffGeo.attributes.color.array;for(var i=0;i<env.ffBase.length;i++){var b=env.ffBase[i],tw=0.5+0.5*Math.sin(elT*b.sp*3+b.ph),f=night*tw;arr[i*3]=b.x+Math.sin(elT*b.sp+b.ph)*0.8;arr[i*3+1]=b.y+Math.sin(elT*b.sp*1.3+b.ph)*0.5;arr[i*3+2]=b.z+Math.cos(elT*b.sp*0.8+b.ph)*0.8;ca[i*3]=1.0*f;ca[i*3+1]=0.85*f;ca[i*3+2]=0.4*f;}env.ffGeo.attributes.position.needsUpdate=true;env.ffGeo.attributes.color.needsUpdate=true;}}
  if(juice){try{juiceUpdate(juice,elT,dt,night);}catch(e){}}
  renderer.render(scene,camera);
}
function startLoop(){if(raf==null){last=0;raf=requestAnimationFrame(frame);}}
function stopLoop(){if(raf!=null){cancelAnimationFrame(raf);raf=null;}}
function applyOpacity(){document.documentElement.style.setProperty('--forest-bg-op',opacity);if(canvas&&enabled)canvas.style.opacity=String(opacity);}
function setOpacity(v){opacity=Math.max(0.1,Math.min(1,v));applyOpacity();try{localStorage.setItem(LS_OP,String(opacity));}catch(e){}}
function setGridFade(on){var grid=document.querySelector('.bg-grid-overlay');var glows=document.querySelectorAll('.ambient-glow');if(grid)grid.style.opacity=on?'0':'';for(var i=0;i<glows.length;i++)glows[i].style.opacity=on?'0':'';}
function setEnabled(on){
  enabled=!!on;try{localStorage.setItem(LS_ON,on?'1':'0');}catch(e){}
  document.body.classList.toggle('forest-bg-on',on);
  if(btn)btn.classList.toggle('active',on);
  if(sw)sw.checked=on;
  setGridFade(on);
  if(on){applyOpacity();ensureBuilt();if(built){rebuildIfNeeded(true);applyTOD(realTOD());}startLoop();}
  else{if(canvas)canvas.style.opacity='0';stopLoop();}
}
function positionPop(){if(!btn||!pop)return;var r=btn.getBoundingClientRect(),w=pop.offsetWidth||230,h=pop.offsetHeight||150,left=Math.max(12,Math.min(r.left,innerWidth-w-12)),top=r.bottom+10;if(top+h>innerHeight-12)top=Math.max(12,r.top-h-10);pop.style.left=left+'px';pop.style.top=top+'px';}
function openPop(){if(sw)sw.checked=enabled;if(opInput)opInput.value=Math.round(opacity*100);pop.classList.add('open');btn.setAttribute('aria-expanded','true');positionPop();}
function closePop(){pop.classList.remove('open');btn.setAttribute('aria-expanded','false');}
function injectToggle(){
  if(document.getElementById('forest-bg-btn'))return;
  var sb=document.getElementById('sidebar')||document.querySelector('.sidebar');
  if(!sb){setTimeout(injectToggle,300);return;}
  btn=el('button',{id:'forest-bg-btn',class:'forest-bg-btn',type:'button',title:'Living world background','aria-haspopup':'true','aria-expanded':'false',html:'<span class="fb-dot">🌲</span><span class="fb-lbl">World</span><span class="fb-chev">▾</span>'});
  var themeBtn=document.getElementById('theme-btn'),logo=sb.querySelector('.logo-container');
  if(themeBtn&&themeBtn.parentNode===sb)sb.insertBefore(btn,themeBtn.nextSibling);
  else if(logo&&logo.parentNode===sb)sb.insertBefore(btn,logo.nextSibling);
  else sb.insertBefore(btn,sb.firstChild);
  pop=el('div',{id:'forest-bg-pop',class:'forest-bg-pop',html:'<div class="fb-pop-row"><span class="fb-pop-title">LIVING WORLD</span><label class="fb-switch"><input id="fb-sw" type="checkbox"><span class="fb-slider"></span></label></div><label class="fb-pop-l">Wallpaper opacity</label><input id="fb-op" type="range" min="10" max="100" value="50"><div class="fb-pop-note">🕒 Sky syncs to your clock · camera orbits · flowers, fireflies, a campfire & stars dress the world · the forest blooms with every solve / + tap · pauses when hidden.</div>'});
  document.body.appendChild(pop);
  sw=document.getElementById('fb-sw');opInput=document.getElementById('fb-op');
  btn.addEventListener('click',function(e){e.stopPropagation();if(pop.classList.contains('open'))closePop();else openPop();});
  sw.addEventListener('change',function(){setEnabled(sw.checked);});
  opInput.addEventListener('input',function(){setOpacity((parseInt(opInput.value,10)||50)/100);});
  document.addEventListener('pointerdown',function(e){if(!pop.classList.contains('open'))return;if(pop.contains(e.target)||btn.contains(e.target))return;closePop();},true);
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closePop();});
  addEventListener('resize',function(){if(pop.classList.contains('open'))positionPop();if(renderer&&enabled){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}});
}
function watchCounters(){
  var ids=['physics-count','chemistry-count','maths-count'];
  var els=ids.map(function(id){return document.getElementById(id);});
  if(els.some(function(e){return !e;})){setTimeout(watchCounters,500);return;}
  try{var mo=new MutationObserver(function(){if(enabled&&built)rebuildIfNeeded(true);});els.forEach(function(e){mo.observe(e,{childList:true,subtree:true,characterData:true});});}catch(e){}
}
function boot(){
  if(!document.body){requestAnimationFrame(boot);return;}
  try{opacity=Math.max(0.1,Math.min(1,parseFloat(localStorage.getItem(LS_OP))||0.5));}catch(e){}
  var on=false;try{on=localStorage.getItem(LS_ON)==='1';}catch(e){}
  canvas=el('canvas',{id:'forest-bg-canvas'});
  Object.assign(canvas.style,{position:'fixed',top:'0',left:'0',width:'100%',height:'100%',zIndex:'0',pointerEvents:'none',display:'block',opacity:'0',transition:'opacity .7s ease'});
  document.body.appendChild(canvas);
  injectToggle();watchCounters();
  setInterval(function(){if(enabled&&built)rebuildIfNeeded(false);},4000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&enabled&&built)startLoop();});
  if(on)setEnabled(true);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
window.__forestBG={show:function(){setEnabled(true);},hide:function(){setEnabled(false);},setOpacity:setOpacity,refresh:function(){if(built)rebuildIfNeeded(true);}};
})();