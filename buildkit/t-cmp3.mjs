import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':'text/html'}); fs.createReadStream(f).pipe(r);}).listen(8303);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1400,height:1200}});
p.on('pageerror',e=>console.log('ERR',e.message));
const B='http://localhost:8303';
await p.goto(B+'/desk.html'); await p.evaluate(()=>localStorage.clear());
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(500);
// A: a flip play — big ARV, big repairs, no rent worth having
// B: a rental play — modest ARV, strong rent. A rate move should hurt B, not A.
await p.evaluate(()=>{ S.addr='A · the flip'; Object.assign(S.raw,{asking:'150000',arv:'300000',repairs:'55000'}); save();
  P.props.push(cleanProp({id:'x2',addr:'B · the rental',f:{}})); save(); loadInto(1);
  S.addr='B · the rental'; Object.assign(S.raw,{asking:'150000',arv:'190000',repairs:'8000',rent:'2400'}); save(); });
const t0=Date.now();
const r = await p.evaluate(()=>{ const f=flipPoints(0,1);
  return f.map(x=>({k:x.k, cross:x.cross?{at:+x.cross.at.toFixed(2), from:x.cross.from, to:x.cross.to}:null})); });
console.log('flips in', Date.now()-t0, 'ms'); console.log(JSON.stringify(r,null,1));
console.log('adv intact:', await p.evaluate(()=>JSON.stringify(P.adv)));
await b.close(); srv.close();
