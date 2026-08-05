import { chromium } from 'playwright';
const B='file:///home/claude/dist/';
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1180,height:1000},deviceScaleFactor:2});
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto(B+'plans.html'); await p.evaluate(()=>localStorage.clear());
await p.goto(B+'plans.html'); await p.waitForTimeout(700);
console.log(JSON.stringify(await p.evaluate(()=>({
  live: window.NI_LIVE,
  form: !!document.querySelector('#waitlist form'),
  ctas: [...document.querySelectorAll('.pf .btn')].map(a=>a.textContent.trim()),
  founding: (document.querySelector('.spot .btn, .founding .btn')||{}).textContent,
  trial: /Start 14 days free/.test(document.body.innerText),
})),null,1));
// submit against a stub
await p.evaluate(()=>{ window.__hit=null; window.fetch = async (u,o)=>{ window.__hit={u,body:o.body}; return {ok:true}; }; });
await p.fill('#waitlist input','elijah@example.com');
await p.click('#waitlist button');
await p.waitForTimeout(500);
console.log('after submit:', JSON.stringify(await p.evaluate(()=>({
  hit: window.__hit, done: !!document.querySelector('.wl.done'),
  stored: localStorage.getItem('ni-wait-v1') }))));
// reload → still says you're on it
await p.goto(B+'plans.html'); await p.waitForTimeout(600);
console.log('after reload:', await p.evaluate(()=>!!document.querySelector('.wl.done')));
// failure path is honest
await p.evaluate(()=>{ localStorage.clear(); });
await p.goto(B+'plans.html'); await p.waitForTimeout(600);
await p.evaluate(()=>{ window.fetch = async ()=>({ok:false,status:503}); });
await p.fill('#waitlist input','x@example.com'); await p.click('#waitlist button');
await p.waitForTimeout(500);
console.log('on failure:', await p.evaluate(()=>(document.querySelector('.wn')||{}).textContent));
await p.evaluate(()=>{const e=document.getElementById('waitlist'); if(e)e.scrollIntoView({block:'center'});});
await p.waitForTimeout(300);
await p.screenshot({path:'shot-waitlist.png'});
console.log('errs',errs);
await b.close();
