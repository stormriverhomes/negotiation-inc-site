import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':f.endsWith('.js')?'text/javascript':'text/html'});
  fs.createReadStream(f).pipe(r);}).listen(8161);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1280,height:1200}});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
p.on('console',m=>console.log('CON',m.type(),m.text().slice(0,160)));
p.on('requestfailed',r=>console.log('REQFAIL',r.url().slice(0,60),r.failure()?.errorText));
await p.goto('http://localhost:8161/desk.html#new'); await p.waitForTimeout(800);
await p.evaluate(()=>{ localStorage.setItem('ni-rentcast-key','0000000000000000000000000000000f');
  S.addr='512 Joseph E Lowery Blvd SW, Atlanta GA 30310'; S.compOpen=true; save(); render(); });
await p.waitForTimeout(400);
console.log('btn:', await p.evaluate(()=>({t:$('rc-go')?.textContent,d:$('rc-go')?.disabled})));
await p.click('#rc-go'); await p.waitForTimeout(9000);
console.log('result:', await p.evaluate(()=>({err:document.querySelector('.rcerr')?.innerText,
  ok:document.querySelector('.rcok')?.innerText, comps:S.comps.length,
  spent:JSON.parse(localStorage.getItem('ni-rentcast-log')||'[]').length})));
await b.close(); srv.close();
