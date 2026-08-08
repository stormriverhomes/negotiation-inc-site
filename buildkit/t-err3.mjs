import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':'text/html'}); fs.createReadStream(f).pipe(r);}).listen(8383);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1420,height:1000}});
p.on('console',m=>{ if(m.type()==='error') console.log('C', m.text().slice(0,300)); });
const B='http://localhost:8383';
await p.goto(B+'/desk.html'); await p.evaluate(()=>localStorage.clear());
await p.evaluate(()=>{ const t=new Date().toISOString().slice(0,10);
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'Elijah Payne',email:'e@x.co',since:t,trial:null,plan:null})); });
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(700);
console.log('trouble:', await p.evaluate(()=>window.__trouble()),
  'visible:', await p.evaluate(()=>!document.getElementById('trouble').hidden),
  'txt:', await p.evaluate(()=>document.getElementById('trouble').innerText.slice(0,60)));
// find what renderCore does on an unminified copy
await p.goto('file:///home/claude/desk.html'); await p.waitForTimeout(200);
await p.evaluate(()=>localStorage.clear());
await p.evaluate(()=>{ const t=new Date().toISOString().slice(0,10);
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'Elijah Payne',email:'e@x.co',since:t,trial:null,plan:null})); });
await p.goto('file:///home/claude/desk.html#new'); await p.waitForTimeout(700);
console.log('SRC trouble:', await p.evaluate(()=>window.__trouble()));
await p.evaluate(()=>{ try{ renderCore(); console.log('renderCore fine'); }
  catch(e){ console.log('THREW '+e.message+' @@ '+(e.stack||'').split('\n').slice(1,4).join(' | ')); } });
await p.waitForTimeout(300);
await b.close(); srv.close();
