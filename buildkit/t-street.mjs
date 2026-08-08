import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:900,height:1000}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto('file:///home/claude/comp-run.html'); await p.waitForTimeout(1200);
console.log('boot:', await p.evaluate(()=>({title:document.title,
  h1:(document.querySelector('h1')||{}).innerText, btns:[...document.querySelectorAll('button')].map(x=>x.textContent.trim()).slice(0,6)})));
console.log('errs:', errs.slice(0,3));
await p.screenshot({path:'/tmp/street.png'});
await b.close();
