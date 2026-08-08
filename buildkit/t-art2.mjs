import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':f.endsWith('.js')?'text/javascript':f.endsWith('.woff2')?'font/woff2':'text/html'});
  fs.createReadStream(f).pipe(r);}).listen(8219);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1100,height:1400},deviceScaleFactor:2});
await p.goto('http://localhost:8219/demo.html'); await p.waitForTimeout(1400);
const cs = await p.$$('.deal canvas');
for (let i=0;i<cs.length;i++) await cs[i].screenshot({path:`/tmp/h${i}.png`});
await b.close(); srv.close();
