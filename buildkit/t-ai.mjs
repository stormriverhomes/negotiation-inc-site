import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8171);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1180,height:1400},deviceScaleFactor:2});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
p.on('console',m=>{if(m.type()==='error')console.log('CON',m.text().slice(0,120))});
await p.goto('http://localhost:8171/desk.html#new'); await p.waitForTimeout(900);
await p.fill('[data-f="arv"]','300000'); await p.press('[data-f="arv"]','Tab'); await p.waitForTimeout(250);
await p.evaluate(()=>showStep('condition')); await p.waitForTimeout(400);
await p.click('[data-preset="medium"]'); await p.waitForTimeout(400);
console.log(await p.evaluate(()=>({ai:!!document.getElementById('ai-zone'),
  first: document.querySelector('[data-step="condition"] > div')?.id,
  drop:!!document.getElementById('ai-drop'), chip:document.querySelector('.aihead .tag')?.textContent,
  honest:/does nothing|nothing\./i.test(document.querySelector('.aisay .fine')?.innerText||'')})));
await p.screenshot({path:'/tmp/cond.png'});
await b.close(); srv.close();
