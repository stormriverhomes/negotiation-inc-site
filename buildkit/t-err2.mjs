import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':'text/html'}); fs.createReadStream(f).pipe(r);}).listen(8373);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1400,height:1000}});
p.on('console',m=>{ if(m.type()==='error') console.log('CONSOLE', m.text().slice(0,400)); });
const B='http://localhost:8373';
await p.goto(B+'/desk.html'); await p.evaluate(()=>localStorage.clear());
await p.evaluate(()=>{ const t=new Date().toISOString().slice(0,10);
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'Elijah Payne',email:'e@x.co',since:t,trial:null,plan:null})); });
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(500);
await p.evaluate(()=>{ S.addr='118 Sylvan Rd SW'; Object.assign(S.raw,{asking:'214000',arv:'300000'}); save(); });
await p.goto(B+'/desk.html#demo=flip'); await p.waitForTimeout(900);
console.log('after demo:', await p.evaluate(()=>window.__trouble()));
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(700);
console.log('after #new:', await p.evaluate(()=>window.__trouble()),
  await p.evaluate(()=>document.getElementById('trouble').innerText.slice(0,90)));
await p.evaluate(()=>{ try{ renderCore(); }catch(e){ console.log('THREW: '+e.message+' @@ '+(e.stack||'').split('\n').slice(1,3).join(' | ')); } });
await p.waitForTimeout(200);
await b.close(); srv.close();
