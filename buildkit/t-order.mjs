import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8251);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1180,height:1500},deviceScaleFactor:2});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
p.on('console',m=>{if(m.type()==='error')console.log('CON',m.text().slice(0,140))});
await p.goto('http://localhost:8251/desk.html#new'); await p.waitForTimeout(900);
console.log('order:', await p.evaluate(()=>{
  const y=s=>{const e=document.querySelector(s);return e?Math.round(e.getBoundingClientRect().top):null;};
  return {ask:y('[data-f="asking"]'), comps:y('#cw'), arv:y('[data-f="arv"]'),
    askExists:!!document.querySelector('[data-f="asking"]'), arvExists:!!document.querySelector('[data-f="arv"]')};
}));
await p.evaluate(()=>{ S.compOpen=true; render(); }); await p.waitForTimeout(300);
await p.fill('[data-f="asking"]','214000'); await p.press('[data-f="asking"]','Tab'); await p.waitForTimeout(300);
console.log('typing still works:', await p.evaluate(()=>S.raw.asking));
await p.screenshot({path:'/tmp/order.png'});
await b.close(); srv.close();
