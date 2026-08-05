// ── Exit Drill held to its own advertising ──────────────────────────────────
// The cabinet says "the desk's own arithmetic decides who was right." That is
// a testable sentence: identical deals go to the drill's ranker and to the
// real desk, and any disagreement fails the build. Then the game itself —
// scoring, penalty, timer, best, handoff — is played end to end, plus the
// usual constitution: no network, no storage tantrums, no "undefined".
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const F=[], ck=(c,m)=>{ if(!c) F.push(m); };
const R = {};

const ctx = await b.newContext({ viewport:{width:1120,height:1000} });
const external=[];
await ctx.route('**/*', r => /^file:/.test(r.request().url()) ? r.continue()
  : (external.push(r.request().url()), r.abort()));

// ── A · the generator: every deal's labeled shape is the ranked answer ──────
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
await p.addInitScript(()=>{ window.__seed=1337; window.__strict=true; });
await p.goto('file:///home/claude/exit-drill.html');
await p.evaluate(()=>{ try{ localStorage.clear(); }catch(e){} });   // once, not on every navigation
await p.reload(); await p.waitForTimeout(400);
R.A = await p.evaluate(()=>{
  const out={ n:0, mislabeled:[], thin:[], implausible:[] };
  for (const shape of ['flip','hold','subto','novation','walk','wholetail','wholesale','brrrr']){
    for (let i=0;i<30;i++){
      const d = deal(shape); out.n++;
      const ans = answerFor(d);
      if (ans!==shape) out.mislabeled.push([shape,ans,d.ask,d.arv]);
      const allow = allowsOf(d);
      const Rk = rank(d).filter(x => !allow || allow.indexOf(x.id) >= 0);
      if (shape!=='walk' && (Rk[0].fit-(Rk[1]?.fit??0))<12) out.thin.push([shape,Rk[0].fit,Rk[1]?.fit]);
      if (shape==='walk' && Rk[0].fit>19) out.thin.push(['walk',Rk[0].fit]);
      if (!(d.ask>30000 && d.arv>=d.ask*0.4 && d.rep>0 && d.rep<d.arv*0.45 && d.rent>200 && d.rent<6000))
        out.implausible.push([shape,d.ask,d.arv,d.rep,d.rent]);
    }
  }
  return out;
});
ck(R.A.mislabeled.length===0, 'A: deals whose labeled shape is not the ranked answer: '+JSON.stringify(R.A.mislabeled.slice(0,3)));
ck(R.A.thin.length===0, 'A: ambiguous deals shipped: '+JSON.stringify(R.A.thin.slice(0,3)));
ck(R.A.implausible.length===0, 'A: implausible numbers: '+JSON.stringify(R.A.implausible.slice(0,3)));

// ── B · the cross-check: the drill's answers ARE the desk's answers ─────────
const sample = await p.evaluate(()=>{
  /* The desk has no notion of your position, so parity is checked on the
     shapes the drill deals without one. The constrained shapes are covered in
     section F, against the drill's own unconstrained ranking. */
  const out=[]; for (const shape of ['flip','hold','subto','novation','walk','wholetail'])
    for (let i=0;i<8;i++){ const d=deal(shape);
      out.push({ ask:d.ask, arv:d.arv, rep:d.rep, rent:d.rent, piti:d.piti, balance:d.balance||null,
                 sit:d.sit, drillSays:answerFor(d) }); }
  return out; });
const desk = await ctx.newPage();
const errsD=[]; desk.on('pageerror',e=>errsD.push(e.message));
await desk.goto('file:///home/claude/desk.html');
await desk.evaluate(()=>localStorage.clear()); await desk.reload(); await desk.waitForTimeout(400);
R.B = await desk.evaluate((sample)=>{
  const disagree=[];
  for (const c of sample){
    S.sit=c.sit; S.est={}; S.unc={};
    S.raw={ asking:String(c.ask), arv:String(c.arv), repairs:String(c.rep), rent:String(c.rent) };
    if (c.piti!=null){ S.raw.piti=String(c.piti); S.raw.balance=String(c.balance); }
    /* The drill now prices the same seven exits the desk does, so the cut
       is no longer a cut — it is the whole list, which is the point. */
    const CUT=['wholesale','flip','wholetail','hold','brrrr','subto','novation'];
    const EX = exitsFor().map(x=>Object.assign(x,fitFor(x)))
      .filter(x=>CUT.includes(x.id) && !x.na && x.fit!==null)
      .sort((a,b)=>b.fit-a.fit);
    const deskSays = (!EX.length || EX[0].fit<25) ? 'walk' : EX[0].id;
    if (deskSays!==c.drillSays) disagree.push({...c, deskSays, top:EX[0]&&[EX[0].id,EX[0].fit]});
  }
  return { n:sample.length, disagree };
}, sample);
ck(R.B.disagree.length===0, `B: the drill and the desk disagree on ${R.B.disagree.length}/${R.B.n}: `+JSON.stringify(R.B.disagree.slice(0,2)));
await desk.close();

// ── C · play it: right answer scores, wrong answer costs five seconds ───────
R.C = {};
{
  await p.click('#go'); await p.waitForTimeout(250);
  const correct = await p.evaluate(()=>answerFor(G.cur));
  await p.click(`.ans[data-a="${correct}"]`); await p.waitForTimeout(150);
  R.C.afterRight = await p.evaluate(()=>({ score:G.score, streak:G.streak,
    verdict:document.getElementById('verdict').className, txt:document.getElementById('verdict').innerText.slice(0,60) }));
  ck(R.C.afterRight.score>=100 && R.C.afterRight.streak===1 && /right/.test(R.C.afterRight.verdict),
     'C: a correct answer did not score: '+JSON.stringify(R.C.afterRight));
  await p.keyboard.press('Space'); await p.waitForTimeout(150);
  R.C.wrong = await p.evaluate(()=>{ const t0=G.t;
    const right=answerFor(G.cur);
    const pick=[...document.querySelectorAll('.ans:not([disabled])')].map(b=>b.dataset.a).find(x=>x!==right);
    document.querySelector(`.ans[data-a="${pick}"]`).click();
    return { t0, t1:G.t, streak:G.streak, says:document.getElementById('verdict').innerText.slice(0,80) }; });
  ck(R.C.wrong.t0-R.C.wrong.t1>=4.9 && R.C.wrong.streak===0 && /desk says/i.test(R.C.wrong.says),
     'C: a wrong answer did not cost five seconds and the correction: '+JSON.stringify(R.C.wrong));
  // keyboard answers work
  await p.keyboard.press('Space'); await p.waitForTimeout(150);
  R.C.key = await p.evaluate(()=>({ open:G.open, reads:G.reads }));
  await p.keyboard.press('2'); await p.waitForTimeout(120);
  R.C.key2 = await p.evaluate(()=>({ open:G.open, reads:G.reads }));
  ck(R.C.key.open===true && R.C.key2.open===false && R.C.key2.reads===R.C.key.reads+1, 'C: the number keys do not answer');
}

// ── D · the clock ends it: card, grade, best persisted, handoff correct ─────
{
  await p.evaluate(()=>{ G.t=0.05; });
  await p.keyboard.press('Space'); await p.waitForTimeout(300);   // open next deal so the clock runs
  await p.waitForTimeout(600);
  R.D = await p.evaluate(()=>({ over:G.over, card:!document.getElementById('card').classList.contains('hidden'),
    score:G.score, best:document.getElementById('best').textContent,
    handoff:document.querySelector('#card a[href^="desk.html#"]')?.getAttribute('href')||null,
    cardTxt:document.getElementById('card').innerText.slice(0,120) }));
  ck(R.D.over && R.D.card, 'D: time ran out and nothing ended');
  ck(+R.D.best>=R.D.score && +R.D.best>0, 'D: the best score did not persist');
  ck(R.D.handoff && /from=arcade/.test(R.D.handoff) && /est=/.test(R.D.handoff) && /sit=/.test(R.D.handoff),
     'D: the handoff link is not the arcade grammar: '+R.D.handoff);
  // the handoff actually lands: click it, the desk fills, provenance says arcade
  await p.click('#card a[href^="desk.html#"]'); await p.waitForTimeout(900);
  R.D.landed = await p.evaluate(()=>({ url:location.pathname.split('/').pop(),
    consent: !!document.getElementById('c-load'),
    asking: document.querySelector('[data-f="asking"]')?.value||'' }));
  if (R.D.landed.consent){ await p.click('#c-load'); await p.waitForTimeout(700);
    R.D.landed.asking = await p.evaluate(()=>document.querySelector('[data-f="asking"]').value); }
  // provenance lives on the field, and fields live on their step — so look
  // where a person would look, on the step that owns the estimated figure
  await p.evaluate(()=>window.showStep('property')); await p.waitForTimeout(300);
  R.D.prov = await p.evaluate(()=>{
    const onStep = [...document.querySelectorAll('.step .prov')].map(e=>e.innerText).join(' ');
    return /the arcade knew this one for a fact/.test(onStep); });
  ck(/desk\.html/.test(R.D.landed.url) && R.D.landed.asking!=='', 'D: the handoff did not fill the desk');
  ck(R.D.prov, 'D: the desk does not name the arcade as the source');
  // best survives a fresh visit
  await p.goto('file:///home/claude/exit-drill.html'); await p.waitForTimeout(400);
  R.D.bestBack = await p.evaluate(()=>document.getElementById('best').textContent);
  R.D.opensOnStart = await p.evaluate(()=>!document.getElementById('start').classList.contains('hidden')
    && document.getElementById('deck').classList.contains('hidden'));
  ck(R.D.opensOnStart, 'D: the cabinet still drops a stranger straight into a live run');
  ck(+R.D.bestBack>0, 'D: best did not survive a reload');
}

// ── F · the door, the ladder, the ramp, and the position ───────────────────
{
  const q = await ctx.newPage();
  const errsF=[]; q.on('pageerror',e=>errsF.push(e.message));
  await q.addInitScript(()=>{ window.__seed=99; });
  await q.goto('file:///home/claude/exit-drill.html'); await q.waitForTimeout(400);
  R.F = await q.evaluate(()=>({
    start: !document.getElementById('start').classList.contains('hidden'),
    rules: document.querySelectorAll('.rule').length,
    ranks: document.querySelectorAll('.rk').length,
    lore:  [...document.querySelectorAll('.rk .lo')].every(e=>e.textContent.trim().length>25),
    now:   document.querySelectorAll('.rk.now').length,
    teach: !!document.getElementById('teach'),
    clockStill: G.started === false }));
  ck(R.F.start, 'F: the drill does not open on a start screen');
  ck(R.F.rules>=3, 'F: the rules are not stated before the clock runs');
  ck(R.F.ranks===6 && R.F.lore, 'F: the ladder is not six ranks with lore: '+JSON.stringify(R.F));
  ck(R.F.now===1, 'F: the ladder does not mark where you are');
  ck(R.F.clockStill, 'F: the clock is running before anybody pressed start');

  // the tutorial deals one house and never a second
  await q.click('#teach'); await q.waitForTimeout(300);
  R.F.tut = await q.evaluate(()=>({ house:G.house, teaching:G.teaching, t:G.t,
    answers:document.querySelectorAll('.ans').length }));
  await q.evaluate(()=>{ const c=answerFor(G.cur);
    document.querySelector(`.ans[data-a="${c}"]`).click(); });
  await q.waitForTimeout(200);
  await q.keyboard.press('Space'); await q.waitForTimeout(200);
  R.F.tutAfter = await q.evaluate(()=>({ house:G.house, score:G.score, t:G.t,
    offers:!!document.getElementById('tgo') }));
  ck(R.F.tut.teaching && R.F.tut.answers===6, 'F: the tutorial is not the six-door house: '+JSON.stringify(R.F.tut));
  ck(R.F.tutAfter.house===R.F.tut.house, 'F: the tutorial dealt a second house');
  ck(R.F.tutAfter.t===60 && R.F.tutAfter.score===0, 'F: the tutorial spent the clock or the score');
  ck(R.F.tutAfter.offers, 'F: the tutorial does not offer the real run');

  // the ramp: five doors, then six, then eight — and a position that shuts some
  await q.click('#tgo'); await q.waitForTimeout(250);
  const ramp=[];
  for (let i=0;i<10;i++){
    ramp.push(await q.evaluate(()=>({ house:G.house,
      n:document.querySelectorAll('.ans').length,
      shut:document.querySelectorAll('.ans.shut').length,
      pos:G.cur.pos, has:!!document.querySelector('.posline') })));
    await q.evaluate(()=>{ const c=answerFor(G.cur);
      const b=document.querySelector(`.ans[data-a="${c}"]`); if(b) b.click(); });
    await q.waitForTimeout(90);
    await q.evaluate(()=>{ G.t=60; advance(); }); await q.waitForTimeout(90);
  }
  R.F.ramp = ramp.map(r=>[r.house,r.n,r.shut]);
  ck(ramp[0].n===5, 'F: house one is not five doors: '+ramp[0].n);
  ck(ramp.find(r=>r.house===4).n===6, 'F: house four is not six doors');
  ck(ramp.find(r=>r.house===7).n===8, 'F: house seven is not all eight doors');
  const constrained = ramp.filter(r=>r.pos!=='funded');
  ck(constrained.every(r=>r.has && r.shut>0),
     'F: a position was dealt without saying so, or without shutting a door: '+JSON.stringify(constrained));
  ck(errsF.length===0, 'F: the door threw: '+errsF.join('; ').slice(0,200));
  await q.close();
}

// ── E · constitution: storage denied, no net, no undefined, a way home ──────
{
  const p2 = await ctx.newPage();
  const errs2=[]; p2.on('pageerror',e=>errs2.push(e.message));
  await p2.addInitScript(()=>{ window.__seed=7;
    const deny={ getItem(){throw new DOMException('denied')}, setItem(){throw new DOMException('denied')},
      removeItem(){throw new DOMException('denied')}, clear(){throw new DOMException('denied')} };
    Object.defineProperty(window,'localStorage',{ get(){ return deny; } }); });
  await p2.goto('file:///home/claude/exit-drill.html'); await p2.waitForTimeout(400);
  await p2.click('#go'); await p2.waitForTimeout(250);
  const correct = await p2.evaluate(()=>answerFor(G.cur));
  await p2.click(`.ans[data-a="${correct}"]`); await p2.waitForTimeout(150);
  R.E = { score: await p2.evaluate(()=>G.score), errs: errs2 };
  ck(R.E.score>=100, 'E: with storage denied the drill stopped playing');
  ck(!errs2.length, 'E: storage denial threw: '+errs2.join('; ').slice(0,200));
  await p2.close();
}
R.home = await p.evaluate(()=>!!document.querySelector('a.mark[href="index.html"]'));
R.noUndef = await p.evaluate(()=>!/\bundefined\b/.test(document.body.innerText));
ck(R.home, 'no way home from the drill');
ck(R.noUndef, 'the word "undefined" is rendering somewhere');
ck(external.length===0, 'the drill reached for the network: '+external.slice(0,3).join(', '));
ck(!errs.length && !errsD.length, 'page errors: '+[...errs,...errsD].join('; ').slice(0,300));

console.log(JSON.stringify(R,null,1));
console.log(F.length ? 'FAIL:\n- '+F.join('\n- ') : 'PASS — the drill ranks like the desk, plays fair, ends honestly, and hands off clean');
await b.close(); process.exit(F.length?1:0);
