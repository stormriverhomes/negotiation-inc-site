import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':f.endsWith('.js')?'text/javascript':'text/html'});
  fs.createReadStream(f).pipe(r);}).listen(8177);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1280,height:1000}});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
await p.goto('http://localhost:8177/desk.html'); await p.waitForTimeout(400);
await p.evaluate(()=>{ localStorage.clear(); const t=new Date().toISOString().slice(0,10);
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'E P',email:'e@x.co',since:t,trial:t,plan:null})); });
await p.goto('http://localhost:8177/desk.html#new'); await p.waitForTimeout(700);
await p.fill('#addr','512 Lowery Blvd'); await p.waitForTimeout(800);
await p.fill('[data-f="asking"]','214000');
// blur BY CLICKING the button — the human sequence
const el = await p.$('#p-add');
await el.scrollIntoViewIfNeeded();
const box = await el.boundingBox();
console.log('box:', box);
await p.mouse.click(box.x+box.width/2, box.y+box.height/2);
await p.waitForTimeout(700);
console.log('after real click:', await p.evaluate(()=>({props:P.props.length, url:location.pathname,
  tabs:document.querySelectorAll('.ptab').length})));
await b.close(); srv.close();
