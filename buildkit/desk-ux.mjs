// ── friction details: blur formatting, focus ring, resume, two-step clear ───
import { chromium } from 'playwright';
import { step, underwrite } from './harness-util.mjs';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const F=[],ck=(c,m)=>{if(!c)F.push(m)};
const q=await b.newPage();const e2=[];q.on('pageerror',e=>e2.push(e.message));
await q.goto('file:///home/claude/desk.html');await q.evaluate(()=>localStorage.clear());
await q.reload();await q.waitForTimeout(300);
await q.fill('[data-f="asking"]','249500');
await q.press('[data-f="asking"]','Tab');await q.waitForTimeout(200);
ck((await q.inputValue('[data-f="asking"]'))==='249,500','blur did not format');
await q.fill('[data-f="arv"]','291000.5');await q.press('[data-f="arv"]','Tab');await q.waitForTimeout(200);
ck((await q.inputValue('[data-f="arv"]'))==='291,000.5','decimal mangled');
await step(q,'condition');
await q.fill('[data-f="repairs"]','41300');
await step(q,'money');
await q.click('#fb-rent [data-est]');await q.waitForTimeout(250);
ck((await q.inputValue('[data-f="rent"]'))!=='','chip click eaten by blur');
await step(q,'condition');
ck((await q.inputValue('[data-f="repairs"]'))==='41,300','no format on blur-to-chip');
await step(q,'property');
await q.focus('[data-f="asking"]');
ck(await q.evaluate(()=>document.getElementById('fb-asking').classList.contains('focus')),'focus ring lost');
ck(!e2.length,'desk errors: '+e2.join());
await q.close();
// course: reload keeps place, fresh visit resumes, deep link outranks
const p=await b.newPage();const e3=[];p.on('pageerror',e=>e3.push(e.message));
await p.goto('file:///home/claude/the-eight-exits.html');
await p.evaluate(()=>localStorage.clear());await p.reload();await p.waitForTimeout(300);
await p.evaluate(()=>{seen.add(0);seen.add(1);go(2,2)});await p.waitForTimeout(200);
await p.reload();await p.waitForTimeout(400);
const r1=await p.evaluate(()=>({ex,pane,ticks:[...seen].length}));
ck(r1.ex===2&&r1.pane===2&&r1.ticks===2,'reload lost the place: '+JSON.stringify(r1));
/* A fresh visit with no hash now opens at LESSON ONE and OFFERS the resume,
   rather than dropping the reader into the middle of section III with no clue
   whether that is the start. Silently resuming is right for a document and
   wrong for a course. */
await p.goto('file:///home/claude/the-eight-exits.html');await p.waitForTimeout(500);
const r1b=await p.evaluate(()=>({ex,pane,
  resume:(document.getElementById('resume')||{}).innerText||'',
  hasBtn:!!document.getElementById('res-go')}));
ck(r1b.ex===0&&r1b.pane===0,'a fresh visit did not open at lesson one: '+JSON.stringify(r1b));
ck(r1b.hasBtn && /2 of 8/.test(r1b.resume),
   'the course did not offer to pick up where the reader stopped: '+r1b.resume.slice(0,90));
await p.click('#res-go');await p.waitForTimeout(300);
ck(await p.evaluate(()=>ex===2&&pane===2),'picking up where you left off went somewhere else');
await p.goto('file:///home/claude/the-eight-exits.html#brrrr');await p.reload();await p.waitForTimeout(400);
ck(await p.evaluate(()=>ex===4&&pane===0),'deep link did not outrank memory');
ck(!e3.length,'course errors: '+e3.join());
console.log(F.length?'FAIL:\n- '+F.join('\n- '):'PASS — friction details hold');
await b.close();process.exit(F.length?1:0);
