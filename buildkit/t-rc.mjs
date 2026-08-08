import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1280,height:1200}});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
await p.goto('file:///home/claude/desk.html'); await p.waitForTimeout(500);
await p.evaluate(()=>localStorage.clear()); await p.reload(); await p.waitForTimeout(700);
await p.evaluate(()=>{ S.compOpen=true; render(); }); await p.waitForTimeout(300);
console.log('no key:', await p.evaluate(()=>({panel:!!document.querySelector('.rc'),
  save:!!document.getElementById('rc-save'), txt:document.querySelector('.rc p').innerText.slice(0,60)})));
// a bad key is rejected before it is stored
await p.fill('#rc-key','short'); await p.click('#rc-save'); await p.waitForTimeout(300);
console.log('bad key:', await p.evaluate(()=>({err:document.querySelector('.rcerr')?.innerText.slice(0,50),
  stored:localStorage.getItem('ni-rentcast-key')})));
// a well-formed but wrong key is stored, and the fetch reports honestly
await p.fill('#rc-key','0000000000000000000000000000000f'); await p.click('#rc-save'); await p.waitForTimeout(400);
console.log('saved:', await p.evaluate(()=>({on:!!document.querySelector('.rc.on'),
  go:document.getElementById('rc-go')?.textContent, disabled:document.getElementById('rc-go')?.disabled,
  used:document.querySelector('.rc .use')?.textContent})));
await p.evaluate(()=>{ S.addr='512 Joseph E Lowery Blvd SW, Atlanta GA 30310'; save(); render(); });
await p.waitForTimeout(300);
await p.click('#rc-go'); await p.waitForTimeout(6000);
console.log('fetch result:', await p.evaluate(()=>({err:document.querySelector('.rcerr')?.innerText,
  ok:document.querySelector('.rcok')?.innerText, comps:S.comps.length, spent:JSON.parse(localStorage.getItem('ni-rentcast-log')||'[]').length})));
await b.close();
