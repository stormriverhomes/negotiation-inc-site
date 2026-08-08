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
  fs.createReadStream(f).pipe(r);}).listen(8241);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1240,height:1100}});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
p.on('console',m=>{if(m.type()==='error')console.log('CON',m.text().slice(0,140))});
await p.goto('http://localhost:8241/desk.html'); await p.waitForTimeout(500);
await p.evaluate(()=>{ localStorage.clear(); const t=new Date().toISOString().slice(0,10);
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'E P',email:'e@x.co',since:t,market:'Atlanta, GA 30310',trial:null,plan:null})); });
await p.goto('http://localhost:8241/desk.html#new'); await p.waitForTimeout(800);
await p.fill('[data-f="asking"]','214000'); await p.press('[data-f="asking"]','Tab'); await p.waitForTimeout(400);
await p.goto('http://localhost:8241/office.html'); await p.waitForTimeout(900);
console.log('hub:', await p.evaluate(()=>({props:document.querySelectorAll('a.pcard').length,
  href:document.querySelector('a.pcard')?.getAttribute('href'),
  marketEdit:!!document.getElementById('m-zip'), zipVal:document.getElementById('m-zip')?.value})));
await p.fill('#m-zip','Macon, GA 31201'); await p.click('#m-save'); await p.waitForTimeout(600);
console.log('saved:', await p.evaluate(()=>JSON.parse(localStorage.getItem('ni-account-v1')).market));
await p.click('a.pcard'); await p.waitForTimeout(1200);
console.log('opened:', await p.evaluate(()=>({url:location.pathname, asking:S.raw.asking, results:!document.getElementById('results').hidden})));
await b.close(); srv.close();
