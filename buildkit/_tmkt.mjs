import { chromium } from 'playwright';
const B='file:///home/claude/dist/';
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1400,height:1000}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
const seed = plan => p.evaluate(pl=>{localStorage.clear();
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'Elijah',email:'e@x.com',plan:pl,trial:null,market:'Atlanta, GA 30310'}));},plan);
for (const plan of ['solo','']) {
  await p.goto(B+'desk.html'); await seed(plan);
  await p.goto(B+'desk.html'); await p.waitForTimeout(700);
  await p.evaluate(()=>{ S.addr='A house with no ZIP on it'; render(); });
  await p.waitForTimeout(1400);
  console.log(plan||'free', JSON.stringify(await p.evaluate(()=>({
    mz: marketZip(),
    chips: [...document.querySelectorAll('.est button, .est .chip, [data-est]')].map(x=>x.textContent.trim().slice(0,52)),
  }))));
}
// and with a real ZIP on the address the chip says the ZIP, not "your market"
await p.evaluate(()=>{ localStorage.setItem('ni-account-v1',JSON.stringify({name:'E',email:'e@x.com',plan:'solo',trial:null,market:'Atlanta, GA 30310'}));});
await p.goto(B+'desk.html'); await p.waitForTimeout(600);
await p.evaluate(()=>{ S.addr='88 Ostend Street, Atlanta, GA 30314'; render(); });
await p.waitForTimeout(1400);
console.log('own zip:', JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('[data-est]')].map(x=>x.textContent.trim().slice(0,48)))));
console.log('errs',errs);
await b.close();
