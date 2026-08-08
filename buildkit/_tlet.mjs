import { chromium } from 'playwright';
const B='file:///home/claude/';
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1400,height:1000}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
p.on('console',m=>{if(m.type()==='error'&&!/fraunces|ERR_FAILED/.test(m.text()))errs.push(m.text())});
await p.goto(B+'desk.html');
await p.evaluate(()=>{localStorage.clear();
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'Elijah Payne',email:'e@x.com',plan:'underwriter',trial:null}));});
await p.goto(B+'desk.html'); await p.waitForTimeout(700);
// fill a sheet
await p.evaluate(()=>{ S.addr='1104 Elm Street'; S.raw.asking='168000'; S.raw.arv='249000';
  S.raw.repairs='46000'; S.raw.rent='1875'; S.sit='motivated'; save(); });
await p.goto(B+'desk.html'); await p.waitForTimeout(900);
console.log('errsA',errs);
await p.goto(B+'desk.html#letter'); await p.waitForTimeout(900);
const r = await p.evaluate(()=>({ open: !document.getElementById('letters').hidden,
  tabs: document.querySelectorAll('[data-lt]').length,
  body: (document.getElementById('lt-body')||{}).value || null }));
console.log(JSON.stringify({open:r.open,tabs:r.tabs},null,1));
console.log('---- EMAIL ----\n'+r.body);
await p.evaluate(()=>{ document.querySelector('[data-lt="text"]').click(); });
await p.waitForTimeout(400);
console.log('---- TEXT ----\n'+await p.evaluate(()=>document.getElementById('lt-body').value));
await p.evaluate(()=>{ document.querySelector('[data-lt="loi"]').click(); });
await p.waitForTimeout(400);
console.log('---- LOI ----\n'+await p.evaluate(()=>document.getElementById('lt-body').value));
console.log('errs',errs);
await b.close();
