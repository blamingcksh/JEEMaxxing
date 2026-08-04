/* forest-island-full.js — embedded full-screen explorer: synced + Elo-size + study-growth */
(function () {
'use strict';
if (window.__forestIslandFullInit) return; window.__forestIslandFullInit = true;
var LS = 'jeemax_forest_daily_v1';
var THREE=null,threePromise=null,overlay=null,canvas=null,renderer=null,scene=null,camera=null,controls=null,world=null,skyEnv=null,treeMat=null,treeGeos=null,currentWater=null;
var built=false,isOpen=false,raf=null,elT=0,lastT=0,LAND_R=14,CAP=3500;
var state={period:'all',endDate:todayISO()};var ui={};var rebuildTimer=null,lastFullSig='',fullPoll=null;
var TOD=[{t:0,top:0x0a0e1c,bot:0x141a2a,sun:0x3a4a6a,sunI:0.15,hemi:0x2a3040,fog:0x0e1220},{t:22,top:0x2a3a5e,bot:0xe8956a,sun:0xffb27a,sunI:0.70,hemi:0x5a5a6a,fog:0x3a3040},{t:50,top:0x4a7ec0,bot:0xc4dcec,sun:0xfff2e0,sunI:1.15,hemi:0x8aa0b8,fog:0x9ab4c8},{t:78,top:0x3a2a52,bot:0xe07a44,sun:0xff8a4a,sunI:0.75,hemi:0x6a5060,fog:0x4a3444},{t:100,top:0x0a0e1c,bot:0x141a2a,sun:0x3a4a6a,sunI:0.15,hemi:0x2a3040,fog:0x0e1220}];
function el(tag,a){var n=document.createElement(tag);if(a)for(var k in a){if(k==='html')n.innerHTML=a[k];else if(k==='class')n.className=a[k];else n.setAttribute(k,a[k]);}return n;}
function todayISO(){var d=new Date();var m=('0'+(d.getMonth()+1)).slice(-2);var day=('0'+d.getDate()).slice(-2);return d.getFullYear()+'-'+m+'-'+day;}
function pad2(n){return (n<10?'0':'')+n;}
function dateKeyMs(ms){var d=new Date(ms);return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());}
function dayStart(iso){return new Date(iso+'T00:00:00').getTime();}
function dayEnd(iso){return new Date(iso+'T23:59:59.999').getTime();}
function isoMinus(iso,n){var d=new Date(iso+'T00:00:00');d.setDate(d.getDate()-n);return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());}
function hash(x,z){var n=Math.sin(x*127.1+z*311.7)*43758.5453;return n-Math.floor(n);}
function vnoise(x,z){var xi=Math.floor(x),zi=Math.floor(z),xf=x-xi,zf=z-zi,u=xf*xf*(3-2*xf),v=zf*zf*(3-2*zf),a=hash(xi,zi),b=hash(xi+1,zi),c=hash(xi,zi+1),d=hash(xi+1,zi+1);return a*(1-u)*(1-v)+b*u*(1-v)+c*(1-u)*v+d*u*v;}
function coastR(th){return LAND_R*(1+0.22*Math.sin(th*3+1.3)+0.14*Math.sin(th*5+0.4)+0.12*(vnoise(Math.cos(th)*2+5,Math.sin(th)*2+5)-0.5));}
function heightAt(x,z){var r=Math.hypot(x,z),th=Math.atan2(z,x),cr=coastR(th);if(r>cr)return -1.2;var t=r/cr;var dome=(1-t*t)*1.7;var beach=t>0.80?-0.7*((t-0.80)/0.20):0;var hills=(vnoise(x*0.5+10,z*0.5+10)-0.5)*0.9*(1-t);return Math.max(-0.5,dome+hills+beach);}
function realTOD(){var d=new Date();return ((d.getHours()+d.getMinutes()/60)/24)*100;}
function normSub(s){s=(s||'').toString().toLowerCase().trim();if(s==='math'||s==='mathematics')return 'maths';return (s==='physics'||s==='chemistry'||s==='maths')?s:'physics';}
function qEloOf(q){return (typeof q.qElo==='number'&&q.qElo>0)?q.qElo:1200;}
function getTimeMs(q){var s=q.lastReviewedAt||q.solvedAt||q.createdAt||q.date||q.ts;if(!s)return null;var t=new Date(s).getTime();return isNaN(t)?null:t;}
function getBank(){try{if(window.AppState&&Array.isArray(window.AppState.questionBank)&&window.AppState.questionBank.length)return window.AppState.questionBank;if(Array.isArray(window.questionBank)&&window.questionBank.length)return window.questionBank;}catch(e){}return [];}
/* growth readers */
function _FG(){return window.__forestGrowth||null;}
function _diffOf(q){var fg=_FG();if(q&&q.difficulty!=null)return q.difficulty;if(fg)return fg.difficulty(q&&q.qElo,q&&q.subject);return 0.5;}
function _sizeF(d){d=d<0?0:d>1?1:d;return 0.6+0.7*d;}
function _strHash(s){var h=2166136261;s=String(s||'');for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0)/4294967296;}
function _oakOf(q,seed){if(q&&q.oak!=null)return !!q.oak;return _strHash(q&&q.id!=null?q.id:('x'+(q&&q.qElo||1200)+'|'+seed))<0.10;}
function loadStore(){try{var o=JSON.parse(localStorage.getItem(LS)||'{}');return (o&&typeof o==='object')?o:{};}catch(e){return {};}}
function storedOf(dk){var s=loadStore();var c=s[dk]||{};return {physics:(+c.physics||0),chemistry:(+c.chemistry||0),maths:(+c.maths||0)};}
function readLive(){function g(id){var e=document.getElementById(id);return e?(parseInt(e.textContent,10)||0):0;}var l={physics:g('physics-count'),chemistry:g('chemistry-count'),maths:g('maths-count')};try{if(window.solved){l.physics=Math.max(l.physics,+window.solved.physics||0);l.chemistry=Math.max(l.chemistry,+window.solved.chemistry||0);l.maths=Math.max(l.maths,+window.solved.maths||0);}}catch(e){}return l;}
function dailyCounts(dk){var sv=storedOf(dk);if(dk===todayISO()){var l=readLive();return {physics:Math.max(l.physics,sv.physics),chemistry:Math.max(l.chemistry,sv.chemistry),maths:Math.max(l.maths,sv.maths)};}return sv;}
function solvedBankCount(){var b=getBank(),n=0;for(var i=0;i<b.length;i++)if(b[i]&&b[i].status==='solved')n++;return n;}
function qcumSig(){var fg=_FG();if(!fg)return '0_0_0';return Math.floor(fg.cum('physics')/300)+'_'+Math.floor(fg.cum('chemistry')/300)+'_'+Math.floor(fg.cum('maths')/300);}
function fullSig(){var c=readLive();var st='';try{st=localStorage.getItem(LS)||'';}catch(e){}return st+'|'+c.physics+','+c.chemistry+','+c.maths+'|'+getBank().length+'|'+solvedBankCount()+'|'+qcumSig();}
function tryMount() {
var host = document.getElementById('forest-island-host');
if (!host) return false;
if (document.getElementById('fi-full-open-btn')) return true;
var cvs = document.getElementById('forest-island-canvas');
var wrap = cvs ? cvs.parentElement : null;          // the canvas box (position:relative)
var right = host.querySelector('.fi-right');
var btn = el('button', {
id: 'fi-full-open-btn',
class: 'fi-full-open-btn',
type: 'button',
title: 'Open full Growth Island',
html: '⛶'
});
// Anchor the button to the canvas box so it sits as a clean corner control
// on the 3D view instead of floating in the title row.
if (wrap) wrap.appendChild(btn);
else if (right) right.insertBefore(btn, right.firstChild);
else host.appendChild(btn);
btn.addEventListener('click', function (e) {
e.preventDefault();
e.stopPropagation();
openFull();
});
// A single click on the island opens the embedded explorer. Capture phase
// wins over the legacy handler that opened the iframe lab.
if (cvs && !cvs.__fiFullClick) {
cvs.__fiFullClick = true;
cvs.addEventListener('click', function (e) {
e.stopImmediatePropagation();
e.preventDefault();
openFull();
}, true);
cvs.addEventListener('dblclick', function (e) { e.preventDefault(); openFull(); });
}
return true;
}
function watchMount(){if(tryMount())return;var started=Date.now();var mo=new MutationObserver(function(){if(tryMount()){mo.disconnect();return;}if(Date.now()-started>30000)mo.disconnect();});mo.observe(document.documentElement,{childList:true,subtree:true});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watchMount);else watchMount();
function ensureOverlay(){
  if(overlay)return;
  overlay=el('div',{id:'fi-full-overlay',class:'fi-full-overlay',html:'<div class="fi-full-shell"><canvas id="fi-full-canvas"></canvas><div class="fi-full-top"><div class="fi-full-brand"><span class="fi-full-kicker">// GROWTH ISLAND</span><span class="fi-full-title">Full Biome</span></div><div class="fi-full-controls"><label class="fi-full-date"><span>Date</span><input id="fi-full-date" type="date"></label><div class="fi-full-periods" id="fi-full-periods"><button data-period="today">Today</button><button data-period="yesterday">Yesterday</button><button data-period="week">Week</button><button data-period="month">Month</button><button data-period="year">Year</button><button data-period="all" class="active">All</button></div></div><div class="fi-full-top-actions"><button id="fi-full-reset" class="fi-full-icon-btn" type="button" title="Reset view">⟳</button><button id="fi-full-close" class="fi-full-icon-btn" type="button" title="Close">✕</button></div></div><button id="fi-full-side-toggle" class="fi-full-side-toggle" type="button" title="Toggle stats">📊</button><aside class="fi-full-side" id="fi-full-side"><div class="fi-full-side-inner"><div class="fi-full-stat-hero"><div class="fi-full-stat-value" id="fi-stat-total">0</div><div class="fi-full-stat-label">Trees Standing</div></div><div class="fi-full-stat-grid"><div><b id="fi-stat-delta">+0</b><span>vs Prev</span></div><div><b id="fi-stat-oaks">0</b><span>Ancient Oaks</span></div><div><b id="fi-stat-tall">—</b><span>Tallest qElo</span></div><div><b id="fi-stat-avg">—</b><span>Avg qElo</span></div></div><div class="fi-full-subject" data-subject="physics"><span>Physics</span><div class="fi-full-bar"><i id="fi-bar-physics"></i></div><b id="fi-count-physics">0</b></div><div class="fi-full-subject" data-subject="chemistry"><span>Chemistry</span><div class="fi-full-bar"><i id="fi-bar-chemistry"></i></div><b id="fi-count-chemistry">0</b></div><div class="fi-full-subject" data-subject="maths"><span>Maths</span><div class="fi-full-bar"><i id="fi-bar-maths"></i></div><b id="fi-count-maths">0</b></div><div class="fi-full-hint">Drag: orbit · Wheel / pinch: zoom · Right-drag / two-finger: pan · trees grow with study time</div></div></aside><div class="fi-full-loading" id="fi-full-loading">Growing forest…</div></div>'});
  document.body.appendChild(overlay);
  canvas=document.getElementById('fi-full-canvas');ui.loading=document.getElementById('fi-full-loading');ui.date=document.getElementById('fi-full-date');ui.periods=document.getElementById('fi-full-periods');ui.side=document.getElementById('fi-full-side');ui.total=document.getElementById('fi-stat-total');ui.delta=document.getElementById('fi-stat-delta');ui.oaks=document.getElementById('fi-stat-oaks');ui.tall=document.getElementById('fi-stat-tall');ui.avg=document.getElementById('fi-stat-avg');ui.countPhysics=document.getElementById('fi-count-physics');ui.countChemistry=document.getElementById('fi-count-chemistry');ui.countMaths=document.getElementById('fi-count-maths');ui.barPhysics=document.getElementById('fi-bar-physics');ui.barChemistry=document.getElementById('fi-bar-chemistry');ui.barMaths=document.getElementById('fi-bar-maths');
  ui.date.value=state.endDate;ui.date.max=todayISO();
  ui.date.addEventListener('change',function(){state.endDate=this.value||todayISO();scheduleRebuild();});
  ui.periods.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;state.period=b.getAttribute('data-period')||'all';syncPeriodUI();scheduleRebuild();});
  document.getElementById('fi-full-close').addEventListener('click',closeFull);
  document.getElementById('fi-full-reset').addEventListener('click',function(){if(controls)controls.reset(viewRadius());});
  document.getElementById('fi-full-side-toggle').addEventListener('click',function(){ui.side.classList.toggle('open');});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&isOpen)closeFull();});
}
function syncPeriodUI(){if(!ui.periods)return;var bs=ui.periods.querySelectorAll('button');for(var i=0;i<bs.length;i++)bs[i].classList.toggle('active',bs[i].getAttribute('data-period')===state.period);}
function showLoading(on,msg){if(!ui.loading)return;ui.loading.textContent=msg||'Growing forest…';ui.loading.classList.toggle('visible',!!on);}
function openFull(){ensureOverlay();overlay.classList.add('open');document.body.classList.add('fi-full-open');isOpen=true;ui.date.value=state.endDate;ui.date.max=todayISO();syncPeriodUI();showLoading(true);lastFullSig=fullSig();if(!fullPoll)fullPoll=setInterval(function(){if(!isOpen)return;var s=fullSig();if(s!==lastFullSig){lastFullSig=s;scheduleRebuild();}},1500);ensureThree().then(function(){if(!built)initScene();resize();startLoop();rebuildWorld();}).catch(function(){showLoadFail();});}
function showLoadFail(){if(!ui.loading)return;ui.loading.innerHTML='Could not load 3D engine.<br><button id="fi-full-retry" type="button" style="margin-top:10px;font-size:12px;padding:5px 14px;border:1px solid #444a6a;border-radius:8px;background:#12121a;color:#cbd5e1;cursor:pointer;">↻ Retry</button>';ui.loading.classList.add('visible');var b=document.getElementById('fi-full-retry');if(b)b.addEventListener('click',function(){threePromise=null;showLoading(true,'Growing forest…');ensureThree().then(function(){if(!built)initScene();resize();startLoop();rebuildWorld();}).catch(function(){showLoadFail();});});}
function closeFull(){if(!overlay)return;isOpen=false;overlay.classList.remove('open');document.body.classList.remove('fi-full-open');if(ui.side)ui.side.classList.remove('open');if(fullPoll){clearInterval(fullPoll);fullPoll=null;}stopLoop();}
function scheduleRebuild(){if(rebuildTimer)clearTimeout(rebuildTimer);rebuildTimer=setTimeout(rebuildWorld,120);}
function ensureThree(){if(THREE)return Promise.resolve(THREE);if(threePromise)return threePromise;threePromise=new Promise(function(resolve,reject){function useExisting(){try{if(window.__forestIslandAPI&&window.__forestIslandAPI.THREE){THREE=window.__forestIslandAPI.THREE;buildTreeAssets();resolve(THREE);return true;}}catch(e){}return false;}if(useExisting())return;var waited=0;var iv=setInterval(function(){waited+=120;if(useExisting()){clearInterval(iv);return;}if(waited>=1500){clearInterval(iv);loadCDN().then(resolve,reject);}},120);});return threePromise;}
function loadCDN(){var urls=['https://esm.sh/three@0.160.0','https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js','https://unpkg.com/three@0.160.0/build/three.module.js'];function tryOne(i){return new Promise(function(res,rej){if(i>=urls.length)return rej(new Error('CDN fail'));import(urls[i]).then(function(m){THREE=m;buildTreeAssets();res(m);}).catch(function(){tryOne(i+1).then(res,rej);});});}return tryOne(0);}
function prep(g){return g.index?g.toNonIndexed():g;}
function mergeGeos(list){list=list.map(function(g){return g.index?g.toNonIndexed():g;});var n=0;list.forEach(function(g){n+=g.attributes.position.count;});var pos=new Float32Array(n*3),nor=new Float32Array(n*3),col=new Float32Array(n*3),o=0;list.forEach(function(g){var c=g.attributes.position.count;pos.set(g.attributes.position.array,o*3);if(g.attributes.normal)nor.set(g.attributes.normal.array,o*3);if(g.attributes.color)col.set(g.attributes.color.array,o*3);o+=c;});var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('normal',new THREE.BufferAttribute(nor,3));g.setAttribute('color',new THREE.BufferAttribute(col,3));return g;}
/* ── Minecraft-style blocky voxel trees ── */
function snapH(h){return Math.round(h*2)/2;}
function paintBox(g,t,s,b){g=prep(g);g.deleteAttribute('uv');var n=g.attributes.position.count,c=new Float32Array(n*3),grp=g.groups||[];for(var i=0;i<n;i++){c[i*3]=s[0];c[i*3+1]=s[1];c[i*3+2]=s[2];}for(var gi=0;gi<grp.length;gi++){var gr=grp[gi],col=gr.materialIndex===2?t:(gr.materialIndex===3?b:s);for(var v=gr.start;v<gr.start+gr.count;v++){c[v*3]=col[0];c[v*3+1]=col[1];c[v*3+2]=col[2];}}g.setAttribute('color',new THREE.BufferAttribute(c,3));return g;}
function box(w,h,d,x,y,z,t,s,b){var j=(hash(x*7.3+1,y*13.7+2)-0.5)*0.07;return paintBox(new THREE.BoxGeometry(w,h,d),[t[0]+j,t[1]+j,t[2]+j],[s[0]+j,s[1]+j,s[2]+j],[b[0]+j*0.5,b[1]+j*0.5,b[2]+j*0.5]).translate(x,y,z);}
function spruceGeo(){var pt=[0.55,0.40,0.24],ps=[0.36,0.26,0.15],pb=[0.24,0.17,0.10],lt=[0.15,0.60,0.70],ls=[0.08,0.44,0.54],lb=[0.05,0.32,0.42],parts=[box(0.42,1.2,0.42,0,0.6,0,pt,ps,pb)];function lyr(w,o,y){parts.push(box(w,w,w,-o,y,-o,lt,ls,lb));parts.push(box(w,w,w,o,y,-o,lt,ls,lb));parts.push(box(w,w,w,-o,y,o,lt,ls,lb));parts.push(box(w,w,w,o,y,o,lt,ls,lb));}lyr(0.62,0.32,1.35);lyr(0.62,0.32,1.95);lyr(0.5,0.25,2.55);parts.push(box(0.42,0.42,0.42,0,3.05,0,lt,ls,lb));parts.push(box(0.3,0.3,0.3,0,3.4,0,lt,ls,lb));return mergeGeos(parts);}
function roundGeo(){var pt=[0.5,0.36,0.2],ps=[0.32,0.22,0.12],pb=[0.22,0.15,0.08],lt=[0.24,0.72,0.24],ls=[0.14,0.52,0.15],lb=[0.09,0.36,0.11],parts=[box(0.45,0.8,0.45,0,0.4,0,pt,ps,pb)],o=0.52;for(var x=-1;x<=1;x++)for(var z=-1;z<=1;z++)parts.push(box(0.55,0.55,0.55,x*o,1.0,z*o,lt,ls,lb));parts.push(box(0.55,0.55,0.55,-o,1.5,0,lt,ls,lb));parts.push(box(0.55,0.55,0.55,o,1.5,0,lt,ls,lb));parts.push(box(0.55,0.55,0.55,0,1.5,-o,lt,ls,lb));parts.push(box(0.55,0.55,0.55,0,1.5,o,lt,ls,lb));parts.push(box(0.45,0.45,0.45,0,1.95,0,lt,ls,lb));return mergeGeos(parts);}
function goldenGeo(){var pt=[0.55,0.4,0.22],ps=[0.36,0.26,0.14],pb=[0.24,0.17,0.09],gt=[0.98,0.76,0.16],gs=[0.84,0.56,0.07],gb=[0.62,0.40,0.05],parts=[box(0.45,0.8,0.45,0,0.4,0,pt,ps,pb)],o=0.5;for(var x=-1;x<=1;x++)for(var z=-1;z<=1;z++)parts.push(box(0.52,0.52,0.52,x*o,1.0,z*o,gt,gs,gb));parts.push(box(0.52,0.52,0.52,-o,1.5,0,gt,gs,gb));parts.push(box(0.52,0.52,0.52,o,1.5,0,gt,gs,gb));parts.push(box(0.52,0.52,0.52,0,1.5,-o,gt,gs,gb));parts.push(box(0.52,0.52,0.52,0,1.5,o,gt,gs,gb));parts.push(box(0.45,0.45,0.45,0,1.95,0,gt,gs,gb));return mergeGeos(parts);}
function oakGeo(){var pt=[0.5,0.36,0.2],ps=[0.32,0.22,0.12],pb=[0.2,0.14,0.08],lt=[0.17,0.40,0.11],ls=[0.11,0.28,0.08],lb=[0.07,0.19,0.06],parts=[box(0.85,2.2,0.85,0,1.1,0,pt,ps,pb)],o=1.0;for(var x=-1;x<=1;x++)for(var z=-1;z<=1;z++)parts.push(box(1.0,1.0,1.0,x*o,2.8,z*o,lt,ls,lb));parts.push(box(1.0,1.0,1.0,-o,3.7,0,lt,ls,lb));parts.push(box(1.0,1.0,1.0,o,3.7,0,lt,ls,lb));parts.push(box(1.0,1.0,1.0,0,3.7,-o,lt,ls,lb));parts.push(box(1.0,1.0,1.0,0,3.7,o,lt,ls,lb));parts.push(box(0.8,0.8,0.8,0,4.6,0,lt,ls,lb));return mergeGeos(parts);}
function saturateMat(mat,amt){mat.onBeforeCompile=function(sh){sh.uniforms.uSat={value:amt};sh.fragmentShader='uniform float uSat;\n'+sh.fragmentShader.replace('#include <color_fragment>',"#include <color_fragment>\n float lum=dot(diffuseColor.rgb, vec3(0.299,0.587,0.114));\n diffuseColor.rgb = mix(vec3(lum), diffuseColor.rgb, uSat);");};}
function buildTreeAssets(){if(treeGeos)return;treeGeos={physics:spruceGeo(),chemistry:roundGeo(),maths:goldenGeo(),oak:oakGeo()};treeMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.82,metalness:0,flatShading:true});treeMat.onBeforeCompile=function(sh){sh.uniforms.uTime={value:0};sh.uniforms.uSat={value:1.55};sh.vertexShader='uniform float uTime;\n'+sh.vertexShader.replace('#include <begin_vertex>',"#include <begin_vertex>\nfloat sw = max(transformed.y - 0.7, 0.0);\nfloat ph = instanceMatrix[3][0] * 0.6 + instanceMatrix[3][2] * 0.6;\ntransformed.x += sin(uTime * 1.3 + ph) * sw * 0.03;\ntransformed.z += cos(uTime * 1.0 + ph) * sw * 0.024;");sh.fragmentShader='uniform float uSat;\n'+sh.fragmentShader.replace('#include <color_fragment>',"#include <color_fragment>\n float lum=dot(diffuseColor.rgb, vec3(0.299,0.587,0.114));\n diffuseColor.rgb = mix(vec3(lum), diffuseColor.rgb, uSat);");treeMat.userData.shader=sh;};}
function makeSky(){var skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color()},bottom:{value:new THREE.Color()},off:{value:18},exp:{value:0.62}},vertexShader:'varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform vec3 top;uniform vec3 bottom;uniform float off;uniform float exp;varying vec3 vW;void main(){float h=normalize(vW+vec3(0.0,off,0.0)).y;float t=pow(max(h,0.0),exp);gl_FragColor=vec4(mix(bottom,top,t),1.0);}'});return {mesh:new THREE.Mesh(new THREE.SphereGeometry(600,32,16),skyMat),top:skyMat.uniforms.top.value,bottom:skyMat.uniforms.bottom.value};}
function applyTOD(v){if(!skyEnv||!scene||!scene.fog)return;var a=TOD[0],b=TOD[TOD.length-1];for(var i=0;i<TOD.length-1;i++)if(v>=TOD[i].t&&v<=TOD[i+1].t){a=TOD[i];b=TOD[i+1];break;}var f=(v-a.t)/Math.max(0.0001,b.t-a.t);function L(x,y){return new THREE.Color(x).lerp(new THREE.Color(y),f);}skyEnv.top.copy(L(a.top,b.top));skyEnv.bottom.copy(L(a.bot,b.bot));scene.fog.color.copy(L(a.fog,b.fog));}
function initScene(){renderer=new THREE.WebGLRenderer({canvas:canvas,antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.14;scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x0e1220,0.0045);camera=new THREE.PerspectiveCamera(50,1,0.1,1400);var hemi=new THREE.HemisphereLight(0x8aa0b8,0x3a3020,0.88);scene.add(hemi);var sun=new THREE.DirectionalLight(0xfff2e0,1.2);sun.position.set(30,80,40);scene.add(sun);scene.add(new THREE.AmbientLight(0xffffff,0.16));skyEnv=makeSky();scene.add(skyEnv.mesh);applyTOD(realTOD());controls=makeControls(canvas);window.addEventListener('resize',resize);try{new ResizeObserver(resize).observe(canvas);}catch(e){}built=true;}
function resize(){if(!renderer||!camera||!canvas)return;var w=canvas.clientWidth||window.innerWidth,h=canvas.clientHeight||window.innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
function startLoop(){if(raf==null){lastT=performance.now();raf=requestAnimationFrame(frame);}}
function stopLoop(){if(raf!=null){cancelAnimationFrame(raf);raf=null;}}
function frame(t){if(!isOpen||!built){raf=null;return;}raf=requestAnimationFrame(frame);var dt=Math.min(0.05,(t-lastT)/1000||0);lastT=t;elT+=dt;if(controls)controls.update();if(treeMat&&treeMat.userData.shader)treeMat.userData.shader.uniforms.uTime.value=elT;if(currentWater)currentWater.position.y=-0.2+Math.sin(elT*0.8)*0.02;renderer.render(scene,camera);}
function viewRadius(){return Math.max(16,LAND_R*1.55);}
function makeControls(cv){var target=new THREE.Vector3(0,0,0),theta=0.7,phi=1.05,radius=viewRadius(),minR=5;var pointers=new Map(),mode=null,lastPinchDist=0,lastMid={x:0,y:0};function clampR(){radius=Math.max(minR,Math.min(Math.max(140,LAND_R*5),radius));}function update(){var sp=Math.sin(phi),cp=Math.cos(phi);camera.position.set(target.x+radius*sp*Math.sin(theta),target.y+radius*cp,target.z+radius*sp*Math.cos(theta));camera.lookAt(target);}function pan(dx,dy){var sc=radius*0.0011;var r=new THREE.Vector3().setFromMatrixColumn(camera.matrix,0),u=new THREE.Vector3().setFromMatrixColumn(camera.matrix,1);target.addScaledVector(r,-dx*sc);target.addScaledVector(u,dy*sc);if(target.length()>LAND_R*1.4)target.setLength(LAND_R*1.4);}function two(){var a=[];pointers.forEach(function(p){a.push(p);});return a;}function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}function mid(a,b){return {x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
  cv.addEventListener('pointerdown',function(e){try{cv.setPointerCapture(e.pointerId);}catch(err){}pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,button:e.button,shift:e.shiftKey});if(pointers.size===1)mode=((e.button===2)||(e.button===1)||e.shiftKey||e.ctrlKey)?'pan':'rotate';else if(pointers.size===2){mode='pinch';var p=two();lastPinchDist=dist(p[0],p[1]);lastMid=mid(p[0],p[1]);}});
  cv.addEventListener('pointermove',function(e){if(!pointers.has(e.pointerId))return;var p=pointers.get(e.pointerId),dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;if(pointers.size===1){if(mode==='rotate'){theta-=dx*0.005;phi=Math.max(0.18,Math.min(1.45,phi-dy*0.005));}else if(mode==='pan')pan(dx,dy);}else if(pointers.size===2){var arr=two(),d=dist(arr[0],arr[1]),m=mid(arr[0],arr[1]);if(lastPinchDist>0){radius*=lastPinchDist/d;clampR();}pan(m.x-lastMid.x,m.y-lastMid.y);lastPinchDist=d;lastMid=m;}});
  function endP(e){if(pointers.has(e.pointerId))pointers.delete(e.pointerId);if(pointers.size<2)lastPinchDist=0;if(pointers.size===1){var rem=pointers.values().next().value;mode=(rem.button===2||rem.shift)?'pan':'rotate';}if(pointers.size===0)mode=null;}
  cv.addEventListener('pointerup',endP);cv.addEventListener('pointercancel',endP);
  cv.addEventListener('wheel',function(e){e.preventDefault();radius*=1+Math.sign(e.deltaY)*0.08;clampR();},{passive:false});
  cv.addEventListener('contextmenu',function(e){e.preventDefault();});
  return {update:update,reset:function(r){target.set(0,0,0);theta=0.7;phi=1.05;radius=r||viewRadius();clampR();}};}
function getRange(period,anchor){var end=dayEnd(anchor),start,prevStart=null,prevEnd=null;if(period==='today'){start=dayStart(anchor);}else if(period==='yesterday'){var y=isoMinus(anchor,1);start=dayStart(y);end=dayEnd(y);}else if(period==='all'){start=0;}else{var days=period==='week'?7:period==='month'?30:365;start=dayStart(isoMinus(anchor,days-1));}if(start>0){var span=Math.round((end-start)/86400000)+1;prevEnd=new Date(start-1);prevEnd.setHours(23,59,59,999);prevStart=new Date(prevEnd.getTime()-(span-1)*86400000);prevStart.setHours(0,0,0,0);}return {start:start,end:end,prevStart:prevStart,prevEnd:prevEnd};}
function computeData(){
  var bank=getBank(),range=getRange(state.period,state.endDate),today=todayISO();
  var list=[],prevCount=0,bySubject={physics:0,chemistry:0,maths:0},oaks=0,eloSum=0,maxElo=0,solvedByDate={};
  function addStats(subj,elo,q,idx){if(bySubject[subj]!=null)bySubject[subj]++;eloSum+=elo;if(elo>maxElo)maxElo=elo;if(_oakOf(q,idx))oaks++;}
  for(var i=0;i<bank.length;i++){var q=bank[i];if(!q||q.status!=='solved')continue;var t=getTimeMs(q),subj=normSub(q.subject),elo=qEloOf(q);if(t!=null){var dk=dateKeyMs(t);if(!solvedByDate[dk])solvedByDate[dk]={physics:0,chemistry:0,maths:0};solvedByDate[dk][subj]++;}var inCur=(state.period==='all')?(t==null?true:t<=range.end):(t!=null&&t>=range.start&&t<=range.end);if(inCur){list.push(q);addStats(subj,elo,q,i);}else if(range.prevStart&&t!=null&&t>=range.prevStart&&t<=range.prevEnd)prevCount++;}
  var store=loadStore();var dates={};for(var k in store)dates[k]=1;dates[today]=1;
  for(var dk in dates){var ms=dayStart(dk);if(ms<range.start||ms>range.end)continue;var counts=dailyCounts(dk),solved=solvedByDate[dk]||{physics:0,chemistry:0,maths:0};['physics','chemistry','maths'].forEach(function(subj){var extra=Math.max(0,(counts[subj]||0)-(solved[subj]||0));for(var n=0;n<extra;n++){var e2=1000+Math.floor(hash(dk.length+n*7+3,subj.length*3+n*11+1)*800);list.push({subject:subj,qElo:e2,lastReviewedAt:dk+'T12:00:00',status:'solved',synthetic:true,difficulty:0.5,growSeconds:10800,plantCumStudy:(dk<today?-1e15:null),_date:dk});addStats(subj,e2);}});}
  if(range.prevStart){for(var pk in solvedByDate){var pms=dayStart(pk);if(pms>=range.prevStart&&pms<=range.prevEnd){var ps=solvedByDate[pk];prevCount+=(ps.physics||0)+(ps.chemistry||0)+(ps.maths||0);}}}
  list.sort(function(a,b){return (getTimeMs(a)||0)-(getTimeMs(b)||0);});
  var delta=range.prevStart?(list.length-prevCount):0;
  return {list:list,stats:{count:list.length,delta:delta,bySubject:bySubject,oaks:oaks,maxElo:maxElo,avgElo:list.length?Math.round(eloSum/list.length):0}};
}
function renderStats(s){if(!ui.total)return;ui.total.textContent=s.count;ui.delta.textContent=(s.delta>=0?'+':'')+s.delta;ui.oaks.textContent=s.oaks;ui.tall.textContent=s.maxElo?Math.round(s.maxElo):'—';ui.avg.textContent=s.avgElo?s.avgElo:'—';ui.countPhysics.textContent=s.bySubject.physics;ui.countChemistry.textContent=s.bySubject.chemistry;ui.countMaths.textContent=s.bySubject.maths;var mx=Math.max(1,s.bySubject.physics,s.bySubject.chemistry,s.bySubject.maths);ui.barPhysics.style.width=Math.round(s.bySubject.physics/mx*100)+'%';ui.barChemistry.style.width=Math.round(s.bySubject.chemistry/mx*100)+'%';ui.barMaths.style.width=Math.round(s.bySubject.maths/mx*100)+'%';}
function radiusFor(c){return Math.max(10,Math.min(42,10+Math.sqrt(Math.max(0,c))*0.62));}
function sampleList(list){if(list.length<=CAP)return list;var out=[],step=list.length/CAP;for(var i=0;i<CAP;i++)out.push(list[Math.floor(i*step)]);return out;}
function clearWorld(){if(world){scene.remove(world);if(world.userData.disposables)world.userData.disposables.forEach(function(x){if(x&&x.dispose)x.dispose();});/* Rebuilt tree meshes share treeGeos — dispose of their per-mesh instanceMatrix slot (uploaded into the shared geometry by the renderer) without touching the shared vertex attributes. */if(world.userData.treeMeshes)for(var i=0;i<world.userData.treeMeshes.length;i++){var g=world.userData.treeMeshes[i].geometry;try{g.deleteAttribute('instanceMatrix');}catch(e){}}world.userData.treeMeshes=[];}world=new THREE.Group();world.userData.disposables=[];world.userData.treeMeshes=[];currentWater=null;scene.add(world);}
function buildTerrain(){var S=LAND_R*1.5,BLOCK=1.0,BOT=-0.4;
  var grassGeo=paintBox(new THREE.BoxGeometry(1,1,1),[0.36,0.74,0.22],[0.47,0.34,0.18],[0.26,0.18,0.10]);
  var sandGeo=paintBox(new THREE.BoxGeometry(1,1,1),[0.94,0.86,0.58],[0.83,0.75,0.50],[0.70,0.62,0.42]);
  var rockGeo=paintBox(new THREE.BoxGeometry(1,1,1),[0.60,0.62,0.60],[0.47,0.49,0.48],[0.35,0.37,0.36]);
  var groups={grass:[],sand:[],rock:[]};
  for(var gx=-S;gx<=S;gx+=BLOCK)for(var gz=-S;gz<=S;gz+=BLOCK){
    var h=snapH(heightAt(gx,gz));if(h<=BOT)continue;
    var r=Math.hypot(gx,gz),th=Math.atan2(gz,gx),t=Math.min(1,r/coastR(th));
    groups[t>0.78?'sand':(h>1.25?'rock':'grass')].push({x:gx,z:gz,h:h});
  }
  var defs={grass:grassGeo,sand:sandGeo,rock:rockGeo},dummy=new THREE.Object3D();
  for(var key in groups){
    var arr=groups[key];if(!arr.length)continue;
    var mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:true});saturateMat(mat,1.35);
    var im=new THREE.InstancedMesh(defs[key],mat,arr.length);im.frustumCulled=false;
    for(var i=0;i<arr.length;i++){var c=arr[i],hgt=c.h-BOT;dummy.position.set(c.x,BOT+hgt/2,c.z);dummy.rotation.set(0,0,0);dummy.scale.set(1.002,hgt,1.002);dummy.updateMatrix();im.setMatrixAt(i,dummy.matrix);}
    im.instanceMatrix.needsUpdate=true;world.add(im);world.userData.disposables.push(defs[key],mat);
  }
  var wg=new THREE.CircleGeometry(Math.max(60,LAND_R*3),64).rotateX(-Math.PI/2);var wmat=new THREE.MeshStandardMaterial({color:0x244a60,transparent:true,opacity:0.82,roughness:0.12,metalness:0.4});saturateMat(wmat,1.25);var water=new THREE.Mesh(wg,wmat);water.position.y=-0.2;world.add(water);currentWater=water;world.userData.disposables.push(wg,wmat);
  var dry=[],step=1.0;for(var gx2=-S;gx2<=S;gx2+=step)for(var gz2=-S;gz2<=S;gz2+=step){var hh=snapH(heightAt(gx2,gz2));if(hh>0.28)dry.push({x:gx2,y:hh,z:gz2});}dry.sort(function(a,b){return Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z);});return dry;}
function buildTrees(samples,dry){if(!samples.length||!dry.length)return;var minDist=samples.length>1800?1.05:samples.length>900?1.25:samples.length>300?1.50:1.80;var cell=Math.max(1.0,minDist),grid={};function key(x,z){return Math.floor(x/cell)+','+Math.floor(z/cell);}function tooClose(x,z){var cx=Math.floor(x/cell),cz=Math.floor(z/cell),md2=minDist*minDist;for(var dx=-1;dx<=1;dx++)for(var dz=-1;dz<=1;dz++){var arr=grid[(cx+dx)+','+(cz+dz)];if(!arr)continue;for(var i=0;i<arr.length;i++){var a=arr[i].x-x,b=arr[i].z-z;if(a*a+b*b<md2)return true;}}return false;}function addG(x,z){var k=key(x,z);if(!grid[k])grid[k]=[];grid[k].push({x:x,z:z});}var placed=[],cursor=0;for(var i=0;i<samples.length;i++){var q=samples[i],qElo=qEloOf(q),oak=_oakOf(q,i),kind=oak?'oak':normSub(q.subject),spot=null;for(var tries=0;tries<700;tries++){var idx=(cursor+tries)%dry.length,s=dry[idx],x=s.x+(hash(i+tries,5)-0.5)*0.7,z=s.z+(hash(i+tries,6)-0.5)*0.7,y=snapH(heightAt(x,z));if(y<0.28)continue;if(tooClose(x,z))continue;spot={x:x,y:y,z:z};cursor=(idx+1)%dry.length;break;}if(!spot){var fs=dry[cursor%dry.length];spot={x:fs.x,y:fs.y,z:fs.z};cursor=(cursor+1)%dry.length;}addG(spot.x,spot.z);var d=_diffOf(q);var bs=(0.75+Math.min(1,Math.max(0,(qElo-800)/2200))*0.85)*(oak?0.9:1)*(0.85+hash(i,7)*0.3)*_sizeF(d);placed.push({kind:kind,oak:oak,qElo:qElo,x:spot.x,y:spot.y,z:spot.z,baseScale:bs,sy:0.85+hash(i,11)*0.45,sxz:0.90+hash(i,13)*0.25,leanX:(hash(i,17)-0.5)*0.08,leanZ:(hash(i,19)-0.5)*0.08,rot:hash(i,3)*6.283});}var byKind={physics:[],chemistry:[],maths:[],oak:[]};placed.forEach(function(t){byKind[t.kind].push(t);});var dummy=new THREE.Object3D();for(var kk in byKind){var arr=byKind[kk];if(!arr.length)continue;var mesh=new THREE.InstancedMesh(treeGeos[kk],treeMat,arr.length);mesh.frustumCulled=false;for(var j=0;j<arr.length;j++){var t=arr[j],sc=Math.max(0.0001,t.baseScale);dummy.position.set(t.x,t.y-0.06,t.z);dummy.rotation.set(t.leanX,t.rot,t.leanZ);dummy.scale.set(t.sxz*sc,t.sy*sc,t.sxz*sc);dummy.updateMatrix();mesh.setMatrixAt(j,dummy.matrix);}mesh.instanceMatrix.needsUpdate=true;world.add(mesh);world.userData.treeMeshes.push(mesh);}}
function buildSceneFromList(list){clearWorld();LAND_R=radiusFor(list.length);var dry=buildTerrain();buildTrees(sampleList(list),dry);if(controls)controls.reset(viewRadius());}
function rebuildWorld(){if(!isOpen||!THREE||!built)return;showLoading(true);setTimeout(function(){try{var data=computeData();renderStats(data.stats);buildSceneFromList(data.list);showLoading(false);}catch(e){console.warn('[forest-island-full]',e);showLoading(true,'Forest build failed.');}},30);}
window.__forestIslandFull={open:openFull,close:closeFull,rebuild:rebuildWorld};
})();
