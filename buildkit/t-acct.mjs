import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8381);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1420,height:1150},deviceScaleFactor:2});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
const B='http://localhost:8381';
await p.goto(B+'/desk.html'); await p.evaluate(()=>localStorage.clear());
await p.evaluate(()=>{ const t=new Date().toISOString().slice(0,10);
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'Elijah Payne',email:'elijah@stormriver.co',since:t,trial:null,plan:null})); });
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(600);
await p.click('#rn-who'); await p.waitForTimeout(300);
console.log('panel:', await p.evaluate(()=>({ open:!document.getElementById('rn-acct').hidden,
  now:(document.querySelector('.ac-now .v')||{}).textContent,
  next:(document.querySelector('.ac-up .k')||{}).textContent,
  gets:document.querySelectorAll('.ac-up li').length,
  sw:document.querySelectorAll('.ac-sw button').length, tier:window.__tier() })));
await p.screenshot({path:'/tmp/acct.png'});
/* ── THE SWITCHER IS A PRE-LAUNCH DEVICE, AND LIVE IT MUST BE GONE ────────
   The plan switcher paints any tier for a screenshot, which is exactly right
   before launch and unacceptable after it: on a live site it would let anybody
   paint themselves The Office. previewTier() already refuses when NI_LIVE is
   true — this asserts the CONTROL disappears with it, rather than sitting
   there doing nothing, which is its own kind of lie. */
const LIVE = await p.evaluate(() => window.NI_LIVE === true);
if (LIVE){
  const sw = await p.evaluate(() => ({
    buttons: document.querySelectorAll('.ac-sw button').length,
    preview: (() => { try { localStorage.setItem('ni-preview-plan','the office'); } catch(e){}
      return window.__tier(); })(),
  }));
  console.log('live stage:', JSON.stringify(sw));
  if (sw.buttons !== 0) { console.log('FAIL — the plan switcher is on a LIVE build'); process.exit(1); }
  if (sw.preview !== 0) { console.log('FAIL — a preview flag still paints a tier on a LIVE build'); process.exit(1); }
  console.log('PASS — the account panel reads right, and the pre-launch switcher is gone');
  await b.close(); process.exit(0);
}
// switch to Underwriter and confirm the ladder moves
await p.evaluate(()=>document.querySelector('[data-plan="Underwriter"]').click());
await p.waitForTimeout(400);
console.log('after switch:', await p.evaluate(()=>({ tier:window.__tier(), premium:premium(),
  chip:(document.querySelector('#rn-cmp .rn-pro')||{}).textContent||null })));
await p.click('#rn-who'); await p.waitForTimeout(300);
console.log('now on:', await p.evaluate(()=>({ now:(document.querySelector('.ac-now .v')||{}).textContent,
  next:(document.querySelector('.ac-up .k')||{}).textContent })));
await p.screenshot({path:'/tmp/acct2.png'});
console.log('errs', errs);
await b.close(); srv.close();
