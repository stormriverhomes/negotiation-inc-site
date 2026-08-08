import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':f.endsWith('.js')?'text/javascript':f.endsWith('.woff2')?'font/woff2':'text/html'});
  fs.createReadStream(f).pipe(r);}).listen(8137);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1280,height:1400},deviceScaleFactor:2});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
await p.goto('http://localhost:8137/demo.html'); await p.waitForTimeout(1400);
// how different are the five drawings from one another?
const sig = await p.evaluate(()=>[...document.querySelectorAll('.deal canvas')].map(c=>{
  const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
  let h=0, ink=0; for(let i=0;i<d.length;i+=4){ h=(h*31 + d[i]+d[i+1]*3+d[i+2]*7)>>>0; if(d[i]+d[i+1]+d[i+2]>120) ink++; }
  return {h, ink};
}));
console.log('distinct hashes:', new Set(sig.map(s=>s.h)).size, 'of', sig.length);
console.log('ink coverage:', sig.map(s=>s.ink));
await p.screenshot({path:'/tmp/houses.png', clip:{x:0,y:230,width:1280,height:900}});
await b.close(); srv.close();
