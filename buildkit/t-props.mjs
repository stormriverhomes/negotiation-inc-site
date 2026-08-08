import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':f.endsWith('.js')?'text/javascript':'text/html'});
  fs.createReadStream(f).pipe(r);}).listen(8175);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1280,height:1000}});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
await p.goto('http://localhost:8175/desk.html'); await p.waitForTimeout(500);
await p.evaluate(()=>{ localStorage.clear(); const t=new Date().toISOString().slice(0,10);
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'E P',email:'e@x.co',since:t,trial:t,plan:null})); });
await p.goto('http://localhost:8175/desk.html#new'); await p.waitForTimeout(800);
await p.fill('[data-f="asking"]','214000'); await p.press('[data-f="asking"]','Tab'); await p.waitForTimeout(300);
console.log('state:', await p.evaluate(()=>({prem:premium(), bar:!!document.getElementById('p-add'),
  tabs:document.querySelectorAll('.ptab').length, props:P.props.length})));
const add = await p.$('#p-add');
if (add){ await add.click(); await p.waitForTimeout(600);
  console.log('after add:', await p.evaluate(()=>({tabs:document.querySelectorAll('.ptab').length, props:P.props.length, active:P.active}))); }
await b.close(); srv.close();
