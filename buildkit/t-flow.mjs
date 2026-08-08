import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8131);
const B='http://localhost:8131';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1280,height:1000}});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text())});

// 1 · condition panel writes live
await p.goto(B+'/desk.html'); await p.waitForTimeout(600);
await p.evaluate(()=>localStorage.clear()); await p.goto(B+'/desk.html#new'); await p.waitForTimeout(900);
await p.fill('[data-f="arv"]','250000'); await p.press('[data-f="arv"]','Tab'); await p.waitForTimeout(250);
await p.evaluate(()=>showStep('condition')); await p.waitForTimeout(250);
await p.click('[data-preset="medium"]'); await p.waitForTimeout(400);
console.log('preset →', await p.evaluate(()=>({repairs:S.raw.repairs, est:S.est.repairs, prov:(S.prov.repairs||'').slice(0,40), goHidden:$('cond-go').hidden})));
await p.reload(); await p.waitForTimeout(700);
console.log('survives reload →', await p.evaluate(()=>S.raw.repairs));
// typing a bid takes over
await p.evaluate(()=>showStep('condition')); await p.waitForTimeout(200);
await p.fill('[data-f="repairs"]','62000'); await p.press('[data-f="repairs"]','Tab'); await p.waitForTimeout(300);
console.log('typed bid →', await p.evaluate(()=>({own:S.repairsOwn, r:S.raw.repairs, go:$('cond-go').hidden, goTxt:$('cond-go').textContent})));
await p.click('[data-preset="heavy"]'); await p.waitForTimeout(300);
console.log('preset retakes →', await p.evaluate(()=>({own:S.repairsOwn, r:S.raw.repairs})));

// 2 · no skip button
console.log('skip button →', await p.evaluate(()=>!!document.getElementById('s-run2')));

// 3 · demo does not pre-visit
await p.goto(B+'/desk.html#demo=flip'); await p.waitForTimeout(1000);
console.log('demo rail →', await p.evaluate(()=>({seen:[...V.seen], enabled:[...document.querySelectorAll('[data-goto]')].filter(b=>!b.disabled).length, results:!$('results').hidden})));

// 4 · new sheet is blank after a demo
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(900);
console.log('after demo → #new:', await p.evaluate(()=>({comps:S.comps.length, sqft:S.subj.sqft, addr:S.addr, name:S.name, arv:S.raw.arv, sys:Object.values(S.sys).filter(Boolean).length, demo:DEMO, step:V.step})));

// 5 · tiers
console.log('anon →', await p.evaluate(()=>({prem:premium(), advLock:!!document.querySelector('#m-adv.lk')})));
await p.evaluate(()=>{ localStorage.setItem('ni-account-v1', JSON.stringify({name:'Test User',email:'t@t.co',since:'2026-07-01',trial:null,plan:null})); });
await p.reload(); await p.waitForTimeout(800);
console.log('member, no trial →', await p.evaluate(()=>({prem:premium(), left:trialLeft(), keepBtn:!!document.getElementById('k-trial')})));
await p.evaluate(()=>{ const a=JSON.parse(localStorage.getItem('ni-account-v1')); a.trial=new Date().toISOString().slice(0,10); localStorage.setItem('ni-account-v1',JSON.stringify(a)); });
await p.reload(); await p.waitForTimeout(800);
console.log('trialling →', await p.evaluate(()=>({prem:premium(), left:trialLeft()})));

// 6 · locked shelf
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(800);
console.log('lock shelf →', await p.evaluate(()=>{ S.compOpen=true; render();
  return {comps:document.querySelectorAll('.cw .lockbit').length, tags:[...document.querySelectorAll('.lockbit .tag')].map(t=>t.textContent)}; }));
await b.close(); srv.close();
