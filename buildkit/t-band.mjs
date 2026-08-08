import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':'text/html'}); fs.createReadStream(f).pipe(r);}).listen(8384);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1420,height:1150}});
const B='http://localhost:8384';
await p.goto(B+'/desk.html'); await p.evaluate(()=>localStorage.clear());
await p.evaluate(()=>{ const t=new Date().toISOString().slice(0,10);
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'Elijah Payne',email:'e@x.co',since:t,trial:null,plan:null})); });
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(600);
await p.click('#rn-who'); await p.waitForTimeout(300);
console.log(await p.evaluate(()=>{
  const el = document.elementFromPoint(900, 1145);
  const chain=[]; let e=el; while(e && chain.length<5){ chain.push(e.tagName+'#'+(e.id||'')+'.'+(e.className||'').toString().slice(0,30)); e=e.parentElement; }
  const t=document.getElementById('trouble');
  return { chain, troubleHidden:t.hidden, troubleRect:t.getBoundingClientRect().toJSON(),
    bg: el?getComputedStyle(el).backgroundColor:null }; }));
await b.close(); srv.close();
