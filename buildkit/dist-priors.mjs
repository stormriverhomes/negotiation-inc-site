// the shipped build, served the way a host would serve it
import { chromium } from 'playwright';
import { step, underwrite } from './harness-util.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME = {'.html':'text/html','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
const srv = http.createServer((q,r)=>{
  let f = path.join('dist', decodeURIComponent(q.url.split('?')[0]));
  if (f.endsWith('/')) f += 'index.html';
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nope'); }
  r.writeHead(200, {'content-type': MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);
}).listen(8099);

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{width:1280,height:900} });
const errs=[], fails=[], reqs=[];
p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
p.on('requestfailed',r=>fails.push(r.url()));
p.on('response',r=>{ if(/priors\.js/.test(r.url())) reqs.push(r.status()); });

await p.goto('http://localhost:8099/desk.html'); await p.waitForTimeout(700);
const onLoad = reqs.length;
await p.fill('#addr','512 Joseph E Lowery Blvd SW, Atlanta GA 30310'); await p.waitForTimeout(2000);
const chips = await p.evaluate(()=>[...document.querySelectorAll('[data-est]')].map(x=>x.innerText.replace(/\n/g,' ')).filter(t=>/ZIP/.test(t)));
await p.click('#fb-arv [data-est]'); await p.waitForTimeout(220);
await p.fill('[data-f="asking"]','214,000'); await p.press('[data-f="asking"]','Tab');
await step(p,'condition');
await p.fill('[data-f="repairs"]','38,500'); await p.press('[data-f="repairs"]','Tab');
await underwrite(p);
await p.evaluate(()=>document.querySelector('[data-row="wholesale"]')?.click()); await p.waitForTimeout(400);
const shot = await p.evaluate(()=>({
  arv:document.getElementById('fi-arv').value,
  prov:document.querySelector('#fb-arv .prov')?.innerText||'',
  band:document.querySelector('#x-wholesale .bandnote')?.innerText||'(none)',
  conf:document.querySelector('.conf')?.innerText||''
}));
await p.screenshot({ path:'desk-priors-live.png' });

// every other page still clean
const other = {};
for (const u of ['/arcade.html','/comp-run.html','/exits.html','/']) {
  const q = await b.newPage({ viewport:{width:1280,height:900} });
  const e2=[]; q.on('pageerror',x=>e2.push(x.message)); q.on('console',m=>{if(m.type()==='error')e2.push(m.text())});
  q.on('requestfailed',r=>e2.push('FAILED '+r.url()));
  await q.goto('http://localhost:8099'+u); await q.waitForTimeout(1200);
  other[u]=e2; await q.close();
}
console.log(JSON.stringify({priorsReqOnLoad:onLoad, priorsStatuses:reqs, chips, shot, errs, fails, other},null,1));
const ok = onLoad===0 && reqs.length===1 && reqs[0]===200 && chips.length===2
  && /295,800/.test(shot.arv) && /\+18%/.test(shot.band) && !errs.length && !fails.length
  && Object.values(other).every(a=>!a.length);
console.log(ok ? 'PASS — shipped build serves priors lazily and cleanly' : 'FAIL');
await b.close(); srv.close(); process.exit(ok?0:1);
