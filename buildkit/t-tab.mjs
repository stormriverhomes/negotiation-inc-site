import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8231);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1240,height:1100},deviceScaleFactor:2});
await p.goto('http://localhost:8231/desk.html#new'); await p.waitForTimeout(800);
await p.click('#m-adv'); await p.waitForTimeout(500);
console.log(await p.evaluate(()=>{ const x=document.getElementById('m-adv'), s=getComputedStyle(x);
  const rgb=c=>c.match(/\d+/g).map(Number);
  const fg=rgb(s.color), bg=rgb(s.backgroundColor);
  const diff=Math.abs(fg[0]-bg[0])+Math.abs(fg[1]-bg[1])+Math.abs(fg[2]-bg[2]);
  return {txt:x.textContent, color:s.color, bg:s.backgroundColor, contrast:diff,
    panelTop:Math.round(document.querySelector('.advlock').getBoundingClientRect().top)}; }));
await p.screenshot({path:'/tmp/tab.png'});
await b.close(); srv.close();
