import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8261);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1400,height:1200},deviceScaleFactor:2});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
p.on('console',m=>{if(m.type()==='error')console.log('CON',m.text().slice(0,140))});
await p.goto('http://localhost:8261/desk.html'); await p.waitForTimeout(500);
await p.evaluate(()=>localStorage.clear());
await p.goto('http://localhost:8261/desk.html#new'); await p.waitForTimeout(700);
console.log('anon:', await p.evaluate(()=>({rail:!document.getElementById('rail-nav').hidden,
  pad:getComputedStyle(document.body).paddingLeft})));
await p.evaluate(()=>{ const t=new Date().toISOString().slice(0,10);
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'Elijah Payne',email:'e@x.co',since:t,trial:null,plan:null})); });
await p.goto('http://localhost:8261/desk.html#new'); await p.waitForTimeout(800);
await p.fill('[data-f="asking"]','214000'); await p.press('[data-f="asking"]','Tab'); await p.waitForTimeout(300);
await p.fill('[data-f="arv"]','300000'); await p.press('[data-f="arv"]','Tab'); await p.waitForTimeout(300);
await p.evaluate(()=>showStep('condition')); await p.waitForTimeout(200);
await p.click('[data-preset="medium"]'); await p.waitForTimeout(400);
console.log('signed in:', await p.evaluate(()=>({rail:!document.getElementById('rail-nav').hidden,
  pad:getComputedStyle(document.body).paddingLeft,
  props:document.querySelectorAll('.rn-p').length,
  spread:document.querySelector('.rn-p .s')?.innerText,
  tier:document.querySelector('.rn-tier')?.textContent,
  upsell:!!document.querySelector('.rn-up')})));
await p.click('#rn-toggle'); await p.waitForTimeout(300);
console.log('collapsed:', await p.evaluate(()=>({pad:getComputedStyle(document.body).paddingLeft,
  w:Math.round(document.getElementById('rail-nav').getBoundingClientRect().width)})));
await p.click('#rn-toggle'); await p.waitForTimeout(300);
await p.evaluate(()=>{ window.scrollTo(0,0); });
await p.screenshot({path:'/tmp/rail.png'});

/* the office carries the same rail, from the same record */
await p.goto('http://localhost:8261/office.html'); await p.waitForTimeout(700);
console.log('office signed in:', await p.evaluate(()=>({
  rail:!document.getElementById('rail-nav').hidden,
  pad:getComputedStyle(document.body).paddingLeft,
  props:document.querySelectorAll('.rn-p').length,
  spread:document.querySelector('.rn-p .s')?.innerText,
  tier:document.querySelector('.rn-tier')?.textContent,
  upsell:!!document.querySelector('.rn-up'),
  mastHidden:getComputedStyle(document.querySelector('header')).display,
  current:document.querySelector('.rn-btn[aria-current]')?.innerText})));
await p.evaluate(()=>localStorage.removeItem('ni-account-v1'));
await p.goto('http://localhost:8261/office.html'); await p.waitForTimeout(600);
console.log('office anon:', await p.evaluate(()=>({
  rail:!document.getElementById('rail-nav').hidden,
  pad:getComputedStyle(document.body).paddingLeft,
  mast:getComputedStyle(document.querySelector('header')).display})));
await p.screenshot({path:'/tmp/rail-office.png'});
await b.close(); srv.close();
