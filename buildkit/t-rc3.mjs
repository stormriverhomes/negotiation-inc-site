import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':f.endsWith('.js')?'text/javascript':'text/html'});
  fs.createReadStream(f).pipe(r);}).listen(8163);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1280,height:1200}});
await p.goto('http://localhost:8163/desk.html#new'); await p.waitForTimeout(800);
await p.evaluate(()=>{ localStorage.setItem('ni-rentcast-key','0000000000000000000000000000000f'); });
const r = await p.evaluate(async ()=>{
  try { const rows = await rcFetch('512 Joseph E Lowery Blvd SW, Atlanta GA 30310');
    return {ok:true, n:rows.length}; }
  catch(e){ return {ok:false, msg:String(e && e.message || e)}; }
});
console.log('direct rcFetch:', r);
console.log('handler present:', await p.evaluate(()=>{ S.compOpen=true; S.addr='x y z'; render();
  const g=document.getElementById('rc-go'); return {exists:!!g, hasHandler: !!(g&&g.onclick), disabled:g&&g.disabled}; }));
await b.close(); srv.close();
