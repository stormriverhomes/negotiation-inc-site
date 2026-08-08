import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8302);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1400,height:1200}});
p.on('pageerror',e=>console.log('ERR',e.message));
const B='http://localhost:8302';
await p.goto(B+'/desk.html'); await p.evaluate(()=>localStorage.clear());
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(500);
await p.evaluate(()=>{ S.addr='118 Sylvan Rd SW'; Object.assign(S.raw,{asking:'214000',arv:'300000',repairs:'40500',rent:'1850'}); save(); });
await p.evaluate(()=>{ P.props.push(cleanProp({id:'x2',name:'',addr:'44 Peach Tree Ct',f:{}})); save(); loadInto(1);
  S.addr='44 Peach Tree Ct'; Object.assign(S.raw,{asking:'138000',arv:'196000',repairs:'18000',rent:'1500'}); save(); });
console.log(await p.evaluate(()=>{
  const A=priceProp(0), Bp=priceProp(1);
  return { props:P.props.map(x=>({addr:x.addr, raw:x.raw})),
    A:{a:A.a, best:(bestExit(A)||{}).nm, ceil:(bestExit(A)||{}).ceil, score:scoreOf(A)},
    B:{a:Bp.a, best:(bestExit(Bp)||{}).nm, ceil:(bestExit(Bp)||{}).ceil, score:scoreOf(Bp)} }; }));
await b.close(); srv.close();
