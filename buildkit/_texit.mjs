/* WHOSE CEILING IS THAT?
   The bench slot and the deck card show the best-FITTING exit's name and the
   highest ceiling ANY exit allows. Those are the same exit right up until the
   best fit is a subject-to or a novation — neither of which buys the house
   outright — and then the card reads "The subject-to · $198,860 · pay no more
   than", where the $198,860 belongs to the fix and flip. The written
   comparison was handed the same pairing and called a live deal a walk-away. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE='file://'+path.resolve(process.argv[2] || 'dist/desk.html');
let n=0,bad=0;
const ok=(t,p,x)=>{n++; if(!p){bad++;console.log('✗ '+t+(x!==undefined?'  ← '+JSON.stringify(x).slice(0,260):''));}else console.log('✓ '+t);};

const b=await chromium.launch();
const pg=await b.newPage({viewport:{width:1400,height:1200}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,180)));
await pg.goto(FILE); await pg.waitForTimeout(600);

/* the subto demo is the real case: its best exit carries no purchase ceiling */
const shape = await pg.evaluate(()=>{
  /* the demo lives in S, not in P.props — and the bench reads P.props. So the
     demo is loaded, then copied onto a real sheet, which is exactly the path a
     customer takes when a demo convinces them to type their own numbers in. */
  loadDemo('subto');
  const p = newProp();
  p.name = 'The one behind on payments';
  for (const k of Object.keys(S.raw)) p.raw[k] = S.raw[k];
  for (const k of Object.keys(S.est)) p.est[k] = S.est[k];
  for (const k of Object.keys(S.prov)) p.prov[k] = S.prov[k];
  for (const k of Object.keys(S.unc)) p.unc[k] = S.unc[k];
  p.sys = { ...S.sys }; p.sit = S.sit; p.sitPc = S.sitPc;
  p.comps = (S.comps||[]).slice(); p.subj = { ...S.subj };
  p.repairsOwn = !!S.repairsOwn;
  DEMO = null;
  P.props.length = 0; P.props.push(p); P.props.push(newProp());
  P.props[1].name = 'A second sheet';
  P.active = 0; loadInto(0);
  const r = priceProp(0);
  const bx = bestExit(r), cx = topCeil(r);
  return { best: bx && { id:bx.id, nm:bx.nm }, ceil: cx && { id:cx.id, nm:cx.nm, v:Math.round(cx.ceil) },
           room: roomOf(r), asking: r.a.asking };
});
console.log('   '+JSON.stringify(shape));
ok('the subto demo\'s best exit is the subject-to', shape.best && shape.best.id==='subto', shape.best);
ok('its ceiling belongs to a DIFFERENT exit', shape.ceil && shape.ceil.id!=='subto', shape.ceil);
ok('and that room reads as a loss', typeof shape.room==='number' && shape.room < 0, shape.room);

const cards = await pg.evaluate(()=>{
  /* ── A REAL ACCOUNT, NOT THE PREVIEW FLAG ─────────────────────────────────
     `ni-preview-plan` is a PAINT-ONLY device: previewTier() returns null the
     moment NI_LIVE is true, so every harness leaning on it went red against a
     live build — the suite could only be run in the stage we were not
     shipping. It was also testing the wrong thing, because a preview is not a
     purchase and entitled() has never honoured one. A planted account is what
     a customer actually has. */
  try { localStorage.setItem('ni-account-v1', JSON.stringify(
    { name:'E', email:'e@x.com', plan:'the office' })); } catch(e){}
  CMP.picks = [0,1];
  if (typeof saveCmp==='function') saveCmp();
  const el=document.getElementById('compare'); if (el) el.hidden=false;
  if (typeof renderCompare==='function') renderCompare();
  const slot=[...document.querySelectorAll('.slot:not(.empty):not(.locked)')].map(s=>({
    n:(s.querySelector('.sl-n')||{}).textContent, b:(s.querySelector('.sl-b')||{}).textContent,
    p:(s.querySelector('.sl-p')||{}).textContent }));
  const deck=[...document.querySelectorAll('.dk')].map(s=>({
    x:(s.querySelector('.dk-x')||{}).textContent, m:(s.querySelector('.dk-room')||{}).textContent }));
  return { slot, deck, facts: (typeof CMPFACTS!=='undefined' && CMPFACTS) ? CMPFACTS.sheets : null };
});
await pg.waitForTimeout(200);

const sub = cards.slot.find(s=>/subject-to/i.test(s.b||''));
ok('a bench slot shows the subject-to', !!sub, cards.slot);
if (sub){
  ok('the slot does not present the ceiling as the subject-to\'s',
     /on the/i.test(sub.p), sub);
  ok('the slot names the exit the ceiling belongs to',
     new RegExp(String(shape.ceil.nm).replace(/^The /,''),'i').test(sub.p), sub);
}
const dsub = cards.deck.find(d=>/subject-to/i.test(d.x||''));
ok('a deck card shows the subject-to', !!dsub, cards.deck);
if (dsub) ok('the deck card attributes its room to the ceiling exit',
   /on the/i.test(dsub.m), dsub);

/* and the facts handed to the model */
const f = (cards.facts||[]).find(s=>/subject-to/i.test(s.bestExit||''));
ok('the written comparison gets the attribution', !!f && f.roomBelongsToBestExit===false, f);
ok('the facts name the ceiling\'s exit', !!f && !!f.ceilingExit && f.ceilingExit!==f.bestExit, f && {b:f.bestExit,c:f.ceilingExit});
ok('the facts forbid calling it a shortfall', !!f && typeof f.note==='string' && /not a shortfall|never/i.test(f.note), f && f.note);

/* THE INVARIANT, on every demo: the attribution appears if and only if the
   best exit is not the exit the ceiling belongs to. Noise where they agree is
   as wrong as silence where they do not. */
const sweep = await pg.evaluate(()=>{
  const out = [];
  for (const key of ['flip','hold','subto','novation','walk']){
    loadDemo(key);
    const p = newProp(); p.name = 'demo:' + key;
    for (const k of Object.keys(S.raw))  p.raw[k]  = S.raw[k];
    for (const k of Object.keys(S.est))  p.est[k]  = S.est[k];
    for (const k of Object.keys(S.prov)) p.prov[k] = S.prov[k];
    for (const k of Object.keys(S.unc))  p.unc[k]  = S.unc[k];
    p.sys = { ...S.sys }; p.sit = S.sit; p.sitPc = S.sitPc;
    p.comps = (S.comps||[]).slice(); p.subj = { ...S.subj }; p.repairsOwn = !!S.repairsOwn;
    DEMO = null;
    P.props.length = 0; P.props.push(p); P.props.push(newProp());
    P.active = 0; loadInto(0);
    CMP.picks = [0,1];
    const el=document.getElementById('compare'); if (el) el.hidden=false;
    renderCompare();
    const r = priceProp(0), bx = bestExit(r), cx = topCeil(r);
    const slot = document.querySelector('.slot:not(.empty):not(.locked) .sl-p');
    const card = document.querySelector('.dk .dk-room');
    out.push({ key, best: bx&&bx.id, ceil: cx&&cx.id,
      agree: !!(bx&&cx&&bx.id===cx.id),
      slotSays: !!(slot && /on the/i.test(slot.textContent)),
      cardSays: !!(card && /on the/i.test(card.textContent)) });
  }
  return out;
});
for (const s of sweep){
  ok(`${s.key}: the slot attributes iff the exits differ`,
     s.best===null||s.ceil===null ? true : (s.agree ? !s.slotSays : s.slotSays), s);
}
ok('at least one demo exercises each side of the rule',
   sweep.some(s=>s.agree) && sweep.some(s=>!s.agree && s.best && s.ceil),
   sweep.map(s=>({k:s.key,agree:s.agree})));
ok('no page errors', errs.length===0, errs[0]);
await b.close();
console.log('\n'+(bad? '✗ '+bad+' of '+n+' failed' : '✓ all '+n+' hold'));
process.exit(bad?1:0);
