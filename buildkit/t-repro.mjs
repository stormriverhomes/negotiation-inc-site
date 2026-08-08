import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8371);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1400,height:1000},deviceScaleFactor:2});
p.on('pageerror',e=>console.log('ERR',e.message));
const B='http://localhost:8371';

// 1 · does a demo leak into a real account?
await p.goto(B+'/desk.html'); await p.evaluate(()=>localStorage.clear());
await p.evaluate(()=>{ const t=new Date().toISOString().slice(0,10);
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'Elijah Payne',email:'e@x.co',since:t,trial:null,plan:null})); });
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(500);
await p.evaluate(()=>{ S.addr='118 Sylvan Rd SW'; Object.assign(S.raw,{asking:'214000',arv:'300000'}); save(); });
await p.goto(B+'/desk.html#demo=flip'); await p.waitForTimeout(900);
console.log('after demo — stored props:', await p.evaluate(()=>{
  const d=JSON.parse(localStorage.getItem('ni-desk-v3'));
  return d.props.map(x=>({addr:x.addr,name:x.name,ask:x.f.asking.v})); }));

// 2 · the rail collapse
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(600);
const rail0 = await p.evaluate(()=>({pad:getComputedStyle(document.body).paddingLeft,
  w:Math.round(document.getElementById('rail-nav').getBoundingClientRect().width),
  tight:document.body.classList.contains('railtight')}));
await p.click('#rn-toggle'); await p.waitForTimeout(400);
const rail1 = await p.evaluate(()=>({pad:getComputedStyle(document.body).paddingLeft,
  w:Math.round(document.getElementById('rail-nav').getBoundingClientRect().width),
  tight:document.body.classList.contains('railtight'),
  vis:[...document.querySelectorAll('.rn-btn,.rn-lnk,.rn-p')].filter(e=>e.getBoundingClientRect().width>0).length,
  overflow:document.getElementById('rail-nav').scrollWidth}));
await p.screenshot({path:'/tmp/rail-tight.png'});
// does it survive a navigation?
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(600);
const rail2 = await p.evaluate(()=>({pad:getComputedStyle(document.body).paddingLeft,
  tight:document.body.classList.contains('railtight'),
  toggleTxt:(document.getElementById('rn-toggle')||{}).textContent}));
console.log('rail open:',rail0,'\nrail tight:',rail1,'\nafter reload:',rail2);

// 3 · advanced mode with no account
await p.evaluate(()=>localStorage.removeItem('ni-account-v1'));
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(600);
await p.evaluate(()=>{ const b=[...document.querySelectorAll('.modes button')].find(x=>/advanced/i.test(x.textContent)); if(b) b.click(); });
await p.waitForTimeout(500);
console.log('advanced, no account:', await p.evaluate(()=>({
  lockPanel:!!document.querySelector('#advlock .advlock, #advlock *'),
  advlockTxt:(document.getElementById('advlock')||{}).innerText?.slice(0,120)||'',
  mode:S.mode, inView:(()=>{const e=document.querySelector('#advlock *');
    if(!e) return null; const r=e.getBoundingClientRect(); return r.top>=0&&r.top<window.innerHeight;})() })));
await p.screenshot({path:'/tmp/adv-noacct.png'});
await b.close(); srv.close();
