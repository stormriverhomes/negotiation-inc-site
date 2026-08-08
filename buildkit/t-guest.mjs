import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{
  /*__API_STUB__*/ /* a static directory is a deployment with no accounts configured, and saying
     so is the honest answer to /api/config — a 404 is a console error the page
     cannot suppress and the harness cannot tell from a real one */
  if (/^\/api\//.test(q.url)){ r.writeHead(200, {'content-type':'application/json'});
    return r.end(JSON.stringify({ ok:true, accounts:false })); }
 let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8391);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1420,height:1100},deviceScaleFactor:2});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
const B='http://localhost:8391'; const F=[], ck=(c,m)=>{ if(!c) F.push(m); };
await p.goto(B+'/desk.html'); await p.evaluate(()=>localStorage.clear());
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(600);
const blank = await p.evaluate(()=>({ rail:!document.getElementById('rail-nav').hidden,
  pad:getComputedStyle(document.body).paddingLeft }));
console.log('guest, blank sheet:', blank);
ck(!blank.rail && blank.pad==='0px', 'a stranger’s first screen is no longer the blank canvas');
await p.fill('[data-f="asking"]','214000'); await p.press('[data-f="asking"]','Tab'); await p.waitForTimeout(500);
const working = await p.evaluate(()=>({ rail:!document.getElementById('rail-nav').hidden,
  guest:document.body.classList.contains('asguest'),
  who:(document.querySelector('.rn-nm')||{}).textContent,
  sub:(document.querySelector('.rn-tier')||{}).textContent,
  card:!!document.querySelector('.rn-guest'),
  gets:document.querySelectorAll('.rn-guest li').length,
  cta:(document.querySelector('.rn-btn.p')||{}).getAttribute?.('href'),
  noPlanTalk:!/\$\d/.test((document.querySelector('.rn-guest')||{}).innerText||'') }));
console.log('guest, working:', working);
ck(working.rail && working.guest, 'the rail never arrived for a guest with work on the sheet');
ck(/guest/i.test(working.who||''), 'the guest rail does not say you are a guest: '+working.who);
ck(/not saved|nothing is saved/i.test(working.sub||''), 'it does not say the work is unsaved: '+working.sub);
ck(working.card && working.gets>=3, 'the free-account card is missing what it adds');
ck(/office\.html\?want=save/.test(working.cta||''), 'the guest CTA does not go to the free door: '+working.cta);
ck(working.noPlanTalk, 'the guest card is selling a plan when it should be asking for an email');
await p.screenshot({path:'/tmp/guest.png'});
// the second-sheet button asks for an account, not for money
const add = await p.evaluate(()=>{ const b=document.getElementById('p-add');
  return b ? { txt:b.textContent.trim(), cls:b.className } : null; });
console.log('second sheet:', add);
// the door answers the sentence that was clicked
await p.goto(B+'/office.html?want=save'); await p.waitForTimeout(500);
const door = await p.evaluate(()=>({ h:document.getElementById('gate-h').textContent,
  p:document.getElementById('gate-p').innerText.slice(0,60) }));
console.log('door:', door);
ck(/keep the sheet/i.test(door.h), 'the door ignored why they came: '+door.h);
ck(!errs.length, 'errors: '+errs.join(';').slice(0,150));
if (F.length){ console.log('FAIL:'); F.forEach(x=>console.log(' -',x)); await b.close(); srv.close(); process.exit(1); }
console.log('PASS — a guest can see what an account is, and it is free');
await b.close(); srv.close();
