// ── the sliders, under a real pointer ───────────────────────────────────────
// The jitter was never visible to a test that sets .value and fires an event —
// it needs an actual drag, because the bug was the input node being replaced
// underneath the pointer. So this drags with the mouse and asserts the node
// survives, the value tracks, and the number moves.
import { chromium } from 'playwright';
import { step } from './harness-util.mjs';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const F=[], ck=(c,m)=>{ if(!c) F.push(m); };
const R={};
const p = await b.newPage({ viewport:{width:1100,height:1000} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
await p.goto('file:///home/claude/desk.html');
// the per-system sliders are a paid feature now, so the drag test signs in —
// a fresh workspace has everything on for fourteen days
await p.evaluate(()=>{ localStorage.clear();
  const today = new Date().toISOString().slice(0,10);
  /* an account alone is memory, not the product — the per-system sliders need
     the trial actually started, which is the point of the new tier model */
  localStorage.setItem('ni-account-v1', JSON.stringify({ name:'Elijah Payne',
    email:'e@x.co', since:today, trial:today, plan:null })); });
await p.reload(); await p.waitForTimeout(400);

const drag = async (sel, frac) => {
  // mouse coordinates are viewport-relative; boundingBox is page-relative once
  // the page has scrolled. Scroll it into view first or you drag empty space.
  const el = await p.$(sel);
  await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(120);
  const box = await el.boundingBox();
  const y = box.y + box.height/2;
  await p.mouse.move(box.x + box.width*0.05, y);
  await p.mouse.down();
  for (let i=1;i<=8;i++){ await p.mouse.move(box.x + box.width*(0.05 + (frac-0.05)*i/8), y); await p.waitForTimeout(16); }
  const midNode = await p.evaluate(s=>{ const e=document.querySelector(s); return e ? e.__mark===1 : null; }, sel);
  await p.mouse.up(); await p.waitForTimeout(250);
  return midNode;
};
const mark = async s => { const e = await p.$(s); await e.scrollIntoViewIfNeeded();
  await p.evaluate(x=>{ const n=document.querySelector(x); if(n) n.__mark=1; }, s); };

// ── condition system slider ─────────────────────────────────────────────────
await p.fill('[data-f="arv"]','291000'); await p.press('[data-f="arv"]','Tab'); await p.waitForTimeout(300);
await p.click('#s-next'); await p.waitForTimeout(400);
await mark('[data-sysr="shell"]');
R.condSurvived = await drag('[data-sysr="shell"]', 0.7);
R.condValue = await p.evaluate(()=>+document.querySelector('[data-sysr="shell"]').value);
ck(R.condSurvived === true, 'the condition slider was replaced mid-drag — the jitter is back');
ck(R.condValue > 45, `the condition drag did not take: ${R.condValue}`);

// ── the seller dial ─────────────────────────────────────────────────────────
// the seller and the money share one step now
await p.click('#s-next'); await p.waitForTimeout(400);
await mark('#sit-range');
R.sitSurvived = await drag('#sit-range', 0.8);
R.sitValue = await p.evaluate(()=>({ v:+document.getElementById('sit-range').value, read:document.getElementById('sit-read').textContent }));
ck(R.sitSurvived === true, 'the seller dial was replaced mid-drag');
ck(R.sitValue.v > 50, `the seller drag did not take: ${JSON.stringify(R.sitValue)}`);

// ── the offer levers ────────────────────────────────────────────────────────
await p.fill('[data-f="rent"]','1850'); await p.press('[data-f="rent"]','Tab'); await p.waitForTimeout(250);
await p.click('#s-run'); await p.waitForTimeout(1500);
await mark('[data-lev="days"]');
R.levSurvived = await drag('[data-lev="days"]', 0.15);
R.levValue = await p.evaluate(()=>({ v:+document.querySelector('[data-lev="days"]').value,
  lbl:document.querySelector('[data-lev="days"]').closest('.lv').querySelector('.sldhead .v').textContent }));
ck(R.levSurvived === true, 'the offer lever was replaced mid-drag');
ck(R.levValue.v < 26 && /day/.test(R.levValue.lbl), `the lever drag did not take: ${JSON.stringify(R.levValue)}`);
ck(R.levValue.lbl.includes(String(R.levValue.v)), `the lever label disagrees with its value: ${JSON.stringify(R.levValue)}`);

ck(!errs.length, 'errors: '+errs.join('; ').slice(0,200));
console.log(JSON.stringify(R,null,1));
console.log(F.length ? 'FAIL:\n- '+F.join('\n- ') : 'PASS — every slider survives its own drag');
await b.close(); process.exit(F.length?1:0);
