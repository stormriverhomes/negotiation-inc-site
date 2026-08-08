import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8331);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1300,height:1100},deviceScaleFactor:4});
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('http://localhost:8331/demo.html'); await p.waitForTimeout(900);
const shots = await p.evaluate(()=>[...document.querySelectorAll('canvas')].map((c,i)=>i));
const cs = await p.$$('canvas');
for (let i=0;i<cs.length;i++){ await cs[i].screenshot({path:`/tmp/house-${i}.png`}); }
console.log('canvases', cs.length);
await b.close(); srv.close();
