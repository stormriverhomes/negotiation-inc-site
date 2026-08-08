import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1280,height:1200}});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text())});
await p.goto('file:///home/claude/desk.html'); await p.waitForTimeout(500);
await p.evaluate(()=>{ localStorage.clear();
  const t=new Date().toISOString().slice(0,10);
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'E',email:'e@x.co',since:t,trial:t,plan:null})); });
await p.reload(); await p.waitForTimeout(700);
await p.fill('[data-f="arv"]','300000'); await p.press('[data-f="arv"]','Tab'); await p.waitForTimeout(250);
await p.evaluate(()=>showStep('condition')); await p.waitForTimeout(300);
await p.click('[data-preset="medium"]'); await p.waitForTimeout(400);
console.log('baseline (blank beds/baths):', await p.evaluate(()=>({repairs:S.raw.repairs, say:$('cs-say').innerText})));
// colours run green→red
console.log('colours:', await p.evaluate(()=>[...document.querySelectorAll('.sys')].map(r=>({
  lab:r.querySelector('.l').textContent, pc:+r.querySelector('input').value, c:r.style.getPropertyValue('--c')}))));
// one bath
await p.fill('#cs-baths','1'); await p.waitForTimeout(150); await p.evaluate(()=>{$('cs-baths').blur()}); await p.waitForTimeout(400);
console.log('1 bath:', await p.evaluate(()=>({repairs:S.raw.repairs, say:$('cs-say').innerText})));
await p.fill('#cs-baths','4'); await p.fill('#cs-beds','5'); await p.evaluate(()=>{$('cs-beds').blur()}); await p.waitForTimeout(400);
console.log('4 bath/5 bed:', await p.evaluate(()=>({repairs:S.raw.repairs, say:$('cs-say').innerText})));
// advanced: line labels carry the count, missing rooms greyed
await p.evaluate(()=>{S.mode='advanced'; save(); render();}); await p.waitForTimeout(400);
await p.fill('#cs-baths','1'); await p.evaluate(()=>{$('cs-baths').blur()}); await p.waitForTimeout(400);
console.log('bath2 line:', await p.evaluate(()=>{const r=document.querySelector('[data-line="bath2"]');
  return r ? {txt:r.querySelector('.l').innerText, none:r.classList.contains('none')} : null;}));
// assumptions
await p.evaluate(()=>showStep('assumptions')); await p.waitForTimeout(400);
console.log('assumptions:', await p.evaluate(()=>({groups:document.querySelectorAll('.agrp').length,
  cards:document.querySelectorAll('.assume').length, zone:document.querySelector('.az .z')?.textContent,
  typed:document.querySelectorAll('[data-advn]').length, notch:document.querySelectorAll('.notch').length})));
await p.fill('[data-advn="rate"]','9.4'); await p.evaluate(()=>document.querySelector('[data-advn="rate"]').blur()); await p.waitForTimeout(400);
console.log('typed rate:', await p.evaluate(()=>({v:S.adv.rate, zone:document.querySelector('[data-assume="rate"] .z').textContent,
  moved:document.querySelector('[data-assume="rate"]').classList.contains('moved'),
  rst:!!document.querySelector('[data-advrst="rate"]')})));
await p.click('[data-advrst="rate"]'); await p.waitForTimeout(300);
console.log('reset rate:', await p.evaluate(()=>S.adv.rate));
await p.screenshot({path:'/tmp/assume.png', fullPage:false});
await b.close();
