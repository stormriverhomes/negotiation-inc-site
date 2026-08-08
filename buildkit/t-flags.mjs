import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const srv=http.createServer((q,r)=>{
  /*__API_STUB__*/ /* a static directory is a deployment with no accounts configured, and saying
     so is the honest answer to /api/config — a 404 is a console error the page
     cannot suppress and the harness cannot tell from a real one */
  if (/^\/api\//.test(q.url)){ r.writeHead(200, {'content-type':'application/json'});
    return r.end(JSON.stringify({ ok:true, accounts:false })); }
 let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':f.endsWith('.js')?'text/javascript':f.endsWith('.woff2')?'font/woff2':'text/html'});
  fs.createReadStream(f).pipe(r);}).listen(8211);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1180,height:1200},deviceScaleFactor:2});
await p.goto('http://localhost:8211/desk.html#demo=flip'); await p.waitForTimeout(1400);
await p.evaluate(()=>window.__showResults()); await p.waitForTimeout(600);
console.log(await p.evaluate(()=>{
  const tags=[...document.querySelectorAll('.exit-h .tags')].filter(t=>t.querySelectorAll('.flag').length>1)[0];
  if(!tags) return 'no row with two flags';
  return [...tags.children].map(c=>{const r=c.getBoundingClientRect();
    return {cls:c.className, top:+r.top.toFixed(1), h:+r.height.toFixed(1), mid:+(r.top+r.height/2).toFixed(1)};});
}));
const el=await p.$('.exit.best .exit-h');
await el.screenshot({path:'/tmp/row.png'});
await b.close(); srv.close();
