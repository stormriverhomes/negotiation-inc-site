import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8191);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1240,height:1400},deviceScaleFactor:2});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
p.on('console',m=>{if(m.type()==='error')console.log('CON',m.text().slice(0,120))});
await p.goto('http://localhost:8191/plans.html'); await p.waitForTimeout(1200);
console.log(await p.evaluate(()=>({inbuild:/in build/i.test(document.body.innerText),
  plans:document.querySelectorAll('.plan').length, spots:document.querySelectorAll('.spot').length,
  rows:document.querySelectorAll('tbody tr').length, qs:document.querySelectorAll('.q').length,
  overflow: document.documentElement.scrollWidth>document.documentElement.clientWidth})));
await p.screenshot({path:'/tmp/plans1.png'});
await p.evaluate(()=>document.querySelector('.spots').scrollIntoView({block:'start'}));
await p.waitForTimeout(300); await p.screenshot({path:'/tmp/plans2.png'});
await b.close(); srv.close();
