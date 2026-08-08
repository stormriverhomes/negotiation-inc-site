import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8351);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const B='http://localhost:8351';
const F=[], ck=(c,m)=>{ if(!c) F.push(m); };

// ── A · a full browser is announced, not swallowed ──────────────────────────
{
  const p=await b.newPage({viewport:{width:1200,height:900}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(B+'/desk.html'); await p.evaluate(()=>localStorage.clear());
  await p.goto(B+'/desk.html#new'); await p.waitForTimeout(500);
  await p.evaluate(()=>{ const real=localStorage.setItem.bind(localStorage);
    localStorage.setItem=(k,v)=>{ if(k==='ni-desk-v3'){ const e=new Error('full'); e.name='QuotaExceededError'; throw e; } return real(k,v); }; });
  await p.fill('[data-f="asking"]','214000'); await p.press('[data-f="asking"]','Tab'); await p.waitForTimeout(400);
  const q = await p.evaluate(()=>({ shown:!document.getElementById('trouble').hidden,
    kind:window.__trouble(), txt:document.getElementById('trouble').innerText.slice(0,80),
    dump:!!document.querySelector('#trouble [data-t="dump"]'),
    value:document.querySelector('[data-f="asking"]').value }));
  console.log('quota:', q);
  ck(q.shown && q.kind==='quota', 'A: a full browser is still being swallowed: '+JSON.stringify(q));
  ck(/no longer being saved/i.test(q.txt), 'A: the bar does not say saving has stopped');
  ck(q.dump, 'A: no way to get the work out');
  ck(q.value!=='', 'A: the sheet stopped working as well as stopped saving');
  ck(!errs.length, 'A: it threw: '+errs.join(';').slice(0,150));
  // and it clears itself once storage works again
  await p.evaluate(()=>{ delete localStorage.setItem; });
  await p.fill('[data-f="arv"]','300000'); await p.press('[data-f="arv"]','Tab'); await p.waitForTimeout(400);
  const back = await p.evaluate(()=>({ kind:window.__trouble(), hidden:document.getElementById('trouble').hidden }));
  console.log('recovered:', back);
  ck(back.kind===null && back.hidden, 'A: the bar stayed up after storage recovered: '+JSON.stringify(back));
  await p.close();
}

// ── B · a thrown render does not take the page with it ──────────────────────
{
  const p=await b.newPage({viewport:{width:1200,height:900}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(B+'/desk.html'); await p.evaluate(()=>localStorage.clear());
  await p.goto(B+'/desk.html#new'); await p.waitForTimeout(500);
  await p.evaluate(()=>{ window.renderPresets = () => { throw new Error('boom'); }; __render(); });
  await p.waitForTimeout(300);
  const r = await p.evaluate(()=>({ shown:!document.getElementById('trouble').hidden,
    kind:window.__trouble(), txt:document.getElementById('trouble').innerText.slice(0,70),
    reload:!!document.querySelector('#trouble [data-t="reload"]') }));
  console.log('render:', r);
  ck(r.shown && r.kind==='render', 'B: a thrown render left a silent half-page: '+JSON.stringify(r));
  ck(r.reload, 'B: no way out of a broken render');
  ck(!errs.length, 'B: the exception escaped the boundary: '+errs.join(';').slice(0,150));
  await p.close();
}
if (F.length){ console.log('FAIL:'); F.forEach(f=>console.log(' -',f)); await b.close(); srv.close(); process.exit(1); }
console.log('PASS — the desk says when it has stopped saving, and survives its own exceptions');
await b.close(); srv.close();
