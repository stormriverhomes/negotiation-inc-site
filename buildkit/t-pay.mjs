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
  fs.createReadStream(f).pipe(r);}).listen(8181);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1180,height:1300},deviceScaleFactor:2});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
p.on('console',m=>{if(m.type()==='error')console.log('CON',m.text().slice(0,140))});
await p.goto('http://localhost:8181/desk.html#demo=flip'); await p.waitForTimeout(1500);
await p.evaluate(()=>window.__showResults()); await p.waitForTimeout(600);
console.log(await p.evaluate(()=>({pay:document.querySelector('.payday .pv')?.textContent,
  lab:document.querySelector('.payday .pl')?.textContent,
  say:document.querySelector('.payday .ps')?.innerText.slice(0,110),
  green:document.querySelectorAll('.keyfig.pay').length,
  refused:[...document.querySelectorAll('.flag.ref')].map(x=>x.textContent),
  refCol:getComputedStyle(document.querySelector('.flag.ref')).color})));
await p.evaluate(()=>{ document.querySelector('.payday').scrollIntoView({block:'center'}); });
await p.waitForTimeout(200);
await p.screenshot({path:'/tmp/payday.png'});
await b.close(); srv.close();
