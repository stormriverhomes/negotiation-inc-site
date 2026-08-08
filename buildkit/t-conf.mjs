import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8217);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1240,height:1200},deviceScaleFactor:2});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
p.on('console',m=>{if(m.type()==='error')console.log('CON',m.text().slice(0,140))});
for (const k of ['flip','hold','subto','novation','walk']){
  await p.goto('http://localhost:8217/desk.html#demo='+k); await p.waitForTimeout(1200);
  await p.evaluate(()=>window.__showResults()); await p.waitForTimeout(450);
  console.log(k, await p.evaluate(()=>({conf:document.getElementById('conf')?.innerText.replace(/\n/g,' '),
    est:Object.keys(S.est).filter(x=>S.est[x]), filled:[...FIELDS,...LOANFIELDS].filter(f=>val(f.id)!==null).map(f=>f.id)})));
}
// the advanced-mode glitch, anonymous
await p.goto('http://localhost:8217/desk.html#new'); await p.waitForTimeout(900);
await p.click('#m-adv'); await p.waitForTimeout(600);
console.log('adv anon:', await p.evaluate(()=>{
  const st=document.querySelector('.step:not([hidden])');
  return { step:V.step, lockwrap:!!document.querySelector('.lockwrap'),
    advlock:(document.getElementById('advlock')||{}).innerHTML?.length||0,
    stepText:(st?st.innerText:'').replace(/\n/g,' ').slice(0,120), rails:document.querySelectorAll('#rail [data-goto]').length };
}));
await p.screenshot({path:'/tmp/adv.png'});
await b.close(); srv.close();
