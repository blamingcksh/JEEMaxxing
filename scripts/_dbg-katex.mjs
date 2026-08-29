import { chromium } from 'playwright-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const PORT = 8834;
const BASE = 'http://127.0.0.1:'+PORT+'/index.html';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json' };
const server = await new Promise(r=>{const s=http.createServer((q,res)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p==='/')p='/index.html'; fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){res.writeHead(404);res.end('nf');return;} res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'}); res.end(d);});}); s.listen(PORT,'127.0.0.1',()=>r(s));});
let browser; try { browser = await chromium.launch({channel:'msedge',headless:true}); } catch { browser = await chromium.launch({channel:'chrome',headless:true}); }
const page = await browser.newPage({viewport:{width:1440,height:1000}});
await page.addInitScript(()=>{ try{localStorage.setItem('jeemax_boot_seq_date', new Date().toLocaleDateString('en-CA'));}catch{} });
page.on('pageerror', e=>console.log('PAGEERROR', String(e).slice(0,300)));
page.on('console', m=>{ if(m.type()==='error') console.log('CONSOLEERR', m.text().slice(0,240)); });
await page.goto(BASE,{waitUntil:'networkidle'});
for(let i=0;i<6;i++){ if(!(await page.locator('.bootseq').count())) break; await page.keyboard.press('Escape').catch(()=>{}); await page.waitForTimeout(250);}
await page.waitForTimeout(900);

const out1 = await page.evaluate(async () => {
  const { AppState } = await import('./storage.js');
  const mx = await import('./matrix.js');
  AppState.questionBank = [{ id:'kx1', subject:'physics', chapter:'Probe', extractedText:'If a<b and b<c, then \\frac{b-a}{c-b} is:', options:['A) $a<b$','B) 2','C) 3','D) 4'], correctAnswer:'A', type:'mcq', status:'error', errorReason:'conceptual', createdAt:new Date().toISOString(), easeFactor:2.5, currentInterval:3, historyLogs:[], qElo:1400, targetTimeMins:5 }];
  let threw=null;
  try { mx.openPracticeDrawer('kx1'); } catch(e){ threw=String(e&&e.stack||e); }
  return { threw, overlay: !!document.getElementById('sr-practice-overlay'),
           qtext: !!document.getElementById('sr-question-text'),
           ids: AppState.questionBank.map(q=>q.id) };
});
console.log('DIRECT-CALL', JSON.stringify(out1,null,1));
await page.waitForTimeout(400);
const out2 = await page.evaluate(async () => {
  const { AppState } = await import('./storage.js');
  const el = document.getElementById('sr-question-text');
  return { overlay: !!document.getElementById('sr-practice-overlay'),
           qtext: !!el,
           katex: el ? el.querySelectorAll('.katex').length : -1,
           text: el ? el.textContent : null,
           stray: el ? el.querySelectorAll('b,i,em,strong,u,s').length : -1,
           ids: AppState.questionBank.map(q=>q.id),
           sameBinding: (await import('./matrix.js')) && true };
});
console.log('AFTER-WAIT', JSON.stringify(out2,null,1));
await page.screenshot({ path: path.join(ROOT, '.qa-shots', 'dbg-drawer.png') });
await browser.close(); server.close();
