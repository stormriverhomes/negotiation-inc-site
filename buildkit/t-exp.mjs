import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8253);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1180,height:1300},deviceScaleFactor:2});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
p.on('console',m=>{if(m.type()==='error')console.log('CON',m.text().slice(0,140))});
await p.goto('http://localhost:8253/desk.html#demo=flip'); await p.waitForTimeout(1400);
await p.evaluate(()=>window.__showResults()); await p.waitForTimeout(500);
await p.evaluate(()=>document.querySelector('[data-row="hold"]').click()); await p.waitForTimeout(400);
console.log(await p.evaluate(()=>({open:!!document.querySelector('.exit-b'),
  head:!!document.querySelector('.xb-v'), ring:!!document.querySelector('.xb-ring'),
  lines:document.querySelectorAll('.xb-work li').length,
  band:!!document.querySelector('.bandtrack'),
  radius:getComputedStyle(document.querySelector('.bandtrack')||document.body).borderRadius})));
await p.evaluate(()=>document.querySelector('#x-hold').scrollIntoView({block:'center'}));
await p.waitForTimeout(250); await p.screenshot({path:'/tmp/exp.png'});
await b.close(); srv.close();
