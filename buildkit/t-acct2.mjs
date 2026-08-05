import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':'text/html'}); fs.createReadStream(f).pipe(r);}).listen(8382);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1420,height:1000}});
p.on('console',m=>console.log('C',m.text().slice(0,200)));
const B='http://localhost:8382';
await p.goto(B+'/desk.html'); await p.evaluate(()=>localStorage.clear());
await p.evaluate(()=>{ const t=new Date().toISOString().slice(0,10);
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'Elijah Payne',email:'e@x.co',since:t,trial:null,plan:null})); });
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(700);
console.log(await p.evaluate(()=>({
  who:!!document.getElementById('rn-who'),
  acct:!!document.getElementById('rn-acct'),
  hasHandler:!!(document.getElementById('rn-who')||{}).onclick,
  panelFn:typeof acctPanel,
  panelOut:(typeof acctPanel==='function'? acctPanel().slice(0,60):'—') })));
await p.evaluate(()=>{ try{ document.getElementById('rn-who').click(); }catch(e){ console.log('CLICK THREW '+e.message); } });
await p.waitForTimeout(300);
console.log(await p.evaluate(()=>({ hidden:document.getElementById('rn-acct').hidden,
  inner:document.getElementById('rn-acct').innerHTML.length })));
await b.close(); srv.close();
