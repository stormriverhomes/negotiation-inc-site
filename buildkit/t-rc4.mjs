import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':f.endsWith('.js')?'text/javascript':'text/html'});
  fs.createReadStream(f).pipe(r);}).listen(8165);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1280,height:1200}});
p.on('console',m=>console.log('CON',m.text().slice(0,120)));
await p.goto('http://localhost:8165/desk.html#new'); await p.waitForTimeout(800);
await p.evaluate(()=>{ localStorage.setItem('ni-rentcast-key','0000000000000000000000000000000f'); });
await p.evaluate(()=>showStep('property')); await p.waitForTimeout(200);
await p.fill('#addr','512 Joseph E Lowery Blvd SW, Atlanta GA 30310'); await p.waitForTimeout(1500);
await p.evaluate(()=>{ S.compOpen=true; render(); }); await p.waitForTimeout(400);
console.log('addr in state:', await p.evaluate(()=>JSON.stringify({addr:S.addr, btn:$('rc-go')?.textContent, dis:$('rc-go')?.disabled})));
await p.evaluate(()=>{ document.getElementById('rc-go').click(); });
await p.waitForTimeout(18000);
console.log('after click:', await p.evaluate(()=>JSON.stringify({busy:RC.busy, err:RC.err, msg:RC.msg,
  shownErr:document.querySelector('.rcerr')?.innerText.slice(0,60), spent:JSON.parse(localStorage.getItem('ni-rentcast-log')||'[]').length})));
await b.close(); srv.close();
