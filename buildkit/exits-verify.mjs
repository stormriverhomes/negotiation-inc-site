import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{width:1100,height:1000} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto('file:///home/claude/the-eight-exits.html');
await p.waitForTimeout(600);

// ── independent math, written fresh here ───────────────────────────────────
const M = {
  wholesale: v => 130000 - v,                                     // fee
  flip:      v => 320000-55000-26000-12000-v,                     // profit
  wholetail: v => (205000 + 1.9*v*(1-v/80000))*0.92 - 165000 - v - (3000+v*0.25),
  hold:      v => (v*0.60)/1058,                                  // DSCR
  brrrr:     v => 150000 - v*0.75,                                // left in
  subto:     v => v*0.82 - 1205,                                  // spread
  novation:  v => v*0.92 - 195000 - 8000 - (25 + Math.pow(Math.max(0,(v-236000)/1000),1.6)*3)*95,
  land:      v => (v/100)*176000 - (1-v/100)*34000,               // EV
};
const POINTS = {
  wholesale:[95000,112000,133000], flip:[160000,200000,235000], wholetail:[500,12000,36000],
  hold:[1500,1850,2300], brrrr:[170000,192000,214000], subto:[1350,1700,2000],
  novation:[220000,240000,258000], land:[8,40,88],
};
const money = v => { const n=v<0; const a=Math.abs(v);
  const s = a>=1e6?(a/1e6).toFixed(2)+'M' : a>=1e3?(Math.round(a/100)/10>=100?Math.round(a/1000)+'k':(a/1000).toFixed(1)+'k') : String(Math.round(a));
  return (n?'−$':'$')+s; };
const mism=[];
for (const [id, pts] of Object.entries(POINTS)){
  await p.evaluate(h=>{location.hash=h}, '#'+id);
  await p.waitForTimeout(200);
  // go to "Your turn"
  await p.evaluate(()=>document.querySelectorAll(".panebar > span")[3].click());
  await p.waitForTimeout(150);
  for (const v of pts){
    const shown = await p.evaluate((val)=>{
      const sl=document.getElementById('sl'); sl.value=val; sl.dispatchEvent(new Event('input'));
      return {fig:document.getElementById('rofig').textContent,
              verdict:document.getElementById('rover').textContent.length,
              cls:document.getElementById('ro').className};
    }, v);
    const exp = M[id](v);
    const expStr = id==='hold' ? exp.toFixed(2)
      : id==='brrrr' ? (exp<=0 ? money(0)+' — none' : money(exp))
      : id==='subto' ? money(exp)+'/mo' : money(exp);
    if (shown.fig !== expStr) mism.push({id, v, shown:shown.fig, expected:expStr});
    if (shown.verdict < 30) mism.push({id, v, problem:'verdict too short'});
  }
}
// ── navigation: full course by keyboard, 8×4 panes + ninth ────────────────
await p.evaluate(()=>{location.hash='#wholesale'});
await p.waitForTimeout(200);
let steps=0;
while (steps < 40) {
  const done = await p.evaluate(()=>location.hash==='#desk');
  if (done) break;
  await p.keyboard.press('ArrowRight'); steps++;
  await p.waitForTimeout(60);
}
const kb = { steps, landed: await p.evaluate(()=>location.hash) };
// deep links
const dl = {};
for (const h of ['#brrrr','#land','#desk','#nonsense']){
  await p.goto('file:///home/claude/the-eight-exits.html'+h); await p.waitForTimeout(250);
  dl[h] = await p.evaluate(()=>document.querySelector('h2').textContent);
}
// mobile
const pm = await b.newPage({ viewport:{width:360,height:740}, isMobile:true, hasTouch:true });
const em=[]; pm.on('pageerror',e=>em.push(e.message));
await pm.goto('file:///home/claude/the-eight-exits.html#hold'); await pm.waitForTimeout(400);
await pm.evaluate(()=>document.querySelectorAll(".panebar > span")[3].click()); await pm.waitForTimeout(200);
const mob = await pm.evaluate(()=>({hscroll:document.documentElement.scrollWidth>window.innerWidth+1,
  over:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();
    return r.width>0&&(r.right>window.innerWidth+1||r.left<-1)}).length}));
await pm.screenshot({path:'exits-mobile.png'});
// screenshots
await p.goto('file:///home/claude/the-eight-exits.html#wholesale'); await p.waitForTimeout(300);
await p.evaluate(()=>document.querySelectorAll(".panebar > span")[3].click()); await p.waitForTimeout(250);
await p.screenshot({path:'exits-turn.png', fullPage:false});
await p.goto('file:///home/claude/the-eight-exits.html#land'); await p.waitForTimeout(300);
await p.screenshot({path:'exits-what.png', fullPage:false});
/* ── the course reads like a course ──────────────────────────────────────── */
{ const q = await b.newPage({viewport:{width:1200,height:1100}});
  const errs=[]; q.on('pageerror',e=>errs.push(e.message));
  await q.goto('file:///home/claude/the-eight-exits.html'); await q.waitForTimeout(500);
  const idea = await q.evaluate(()=>({
    lesson:(document.querySelector('.lessonbar .ln')||{}).textContent||'',
    lead:((document.querySelector('.lead')||{}).textContent||'').trim().length,
    steps:document.querySelectorAll('.steps li').length,
    why:!!document.querySelector('.tc.why'), cat:!!document.querySelector('.tc.catch'),
    longer:!!document.querySelector('details.longer'),
    words:(document.querySelector('.pane').innerText.match(/\S+/g)||[]).length }));
  if (!/Lesson 1 of 8/.test(idea.lesson)) throw new Error('course: the first screen does not say which lesson it is: '+idea.lesson);
  if (idea.steps !== 3) throw new Error('course: lesson one has no three-step explanation ('+idea.steps+')');
  if (!idea.why || !idea.cat) throw new Error('course: the why/catch pair is missing');
  if (!idea.longer) throw new Error('course: the longer version was dropped rather than folded away');
  if (idea.words > 150) throw new Error('course: the opening screen is a word block again ('+idea.words+' words)');
  /* every lesson's maths page carries a working control from the product */
  const live = [];
  for (let i=0;i<8;i++){
    await q.evaluate(n=>go(n,1), i); await q.waitForTimeout(250);
    live.push(await q.evaluate(()=>{
      const el=document.querySelector('.live'); if(!el) return null;
      const ins=[...document.querySelectorAll('.live input[type=range]')];
      return { n:ins.length, out:(document.getElementById('lo-v')||{}).textContent||'' }; }));
  }
  live.forEach((L,i)=>{ if(!L) throw new Error('course: lesson '+(i+1)+' has no live excerpt');
    if(L.n<2) throw new Error('course: lesson '+(i+1)+' excerpt has nothing to drag');
    if(!/[0-9]/.test(L.out)) throw new Error('course: lesson '+(i+1)+' excerpt prints no number: '+L.out); });
  /* dragging a real control moves the answer */
  await q.evaluate(()=>go(1,1)); await q.waitForTimeout(250);
  const before = await q.evaluate(()=>document.getElementById('lo-v').textContent);
  await q.evaluate(()=>{ const s=document.querySelector('.live input[type=range]');
    s.value = s.min; s.dispatchEvent(new Event('input',{bubbles:true})); });
  await q.waitForTimeout(200);
  const after = await q.evaluate(()=>document.getElementById('lo-v').textContent);
  if (before === after) throw new Error('course: the excerpt is a picture — dragging it changed nothing');
  /* the recap lands at the end of every lesson */
  await q.evaluate(()=>go(0,3)); await q.waitForTimeout(250);
  const rec = await q.evaluate(()=>document.querySelectorAll('.learned li').length);
  if (rec < 2) throw new Error('course: no recap at the end of the lesson');
  if (errs.length) throw new Error('course: page errors '+JSON.stringify(errs));
  console.log('course:', JSON.stringify({...idea, live:live.map(l=>l.n), before, after, rec}, null, 1));
  await q.close(); }

console.log(JSON.stringify({mismatches:mism, kb, deeplinks:dl, mob, errs, em},null,1));
await b.close();
