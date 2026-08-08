import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8221);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1180,height:1500},deviceScaleFactor:2});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
p.on('console',m=>{if(m.type()==='error')console.log('CON',m.text().slice(0,120))});
await p.goto('http://localhost:8221/desk.html#demo=flip'); await p.waitForTimeout(1400);
await p.evaluate(()=>window.__showResults()); await p.waitForTimeout(700);
console.log(await p.evaluate(()=>({band:!!document.querySelector('.closeband'),
  notes:document.querySelectorAll('.closeband .notes li').length,
  worth:document.querySelector('.worth .wv')?.textContent,
  recTop:document.querySelector('.flag.rec')?.getBoundingClientRect().top,
  estTop:document.querySelector('.flag.est')?.getBoundingClientRect().top})));
await p.evaluate(()=>document.querySelector('.offer').scrollIntoView({block:'start'}));
await p.waitForTimeout(300); await p.screenshot({path:'/tmp/offer.png'});
await b.close(); srv.close();
