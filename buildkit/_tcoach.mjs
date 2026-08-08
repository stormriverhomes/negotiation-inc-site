import { chromium } from 'playwright';
const B='file:///home/claude/dist/';
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1280,height:1000}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto(B+'desk.html'); await p.evaluate(()=>localStorage.clear());
await p.goto(B+'desk.html'); await p.waitForTimeout(700);
const read = ()=>p.evaluate(()=>({hidden:document.getElementById('coach').hidden,
  t:(document.querySelector('.coach .ct')||{}).textContent||null}));
console.log('property:', JSON.stringify(await read()));
await p.evaluate(()=>showStep('condition')); await p.waitForTimeout(400);
console.log('condition:', JSON.stringify(await read()));
await p.evaluate(()=>{ S.raw.arv='250000'; S.raw.asking='170000'; S.raw.repairs='30000'; save(); window.__showResults(); });
await p.waitForTimeout(500);
console.log('results:', JSON.stringify(await read()));
await p.evaluate(()=>document.getElementById('co-x').click()); await p.waitForTimeout(200);
console.log('after dismiss:', JSON.stringify(await read()));
await p.evaluate(()=>showStep('property')); await p.waitForTimeout(300);
console.log('property again (unseen):', JSON.stringify(await read()));
await p.evaluate(()=>document.getElementById('co-off').click()); await p.waitForTimeout(200);
await p.evaluate(()=>showStep('condition')); await p.waitForTimeout(300);
console.log('after "do not show":', JSON.stringify(await read()));
// a member never sees them
await p.evaluate(()=>{localStorage.clear();
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'E',email:'e@x.com',plan:null,trial:null}));});
await p.goto(B+'desk.html'); await p.waitForTimeout(700);
console.log('signed in:', JSON.stringify(await read()));
console.log('errs',errs);
await b.close();
