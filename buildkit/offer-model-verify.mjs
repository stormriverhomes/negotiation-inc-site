// ── the offer model as a mathematical object ────────────────────────────────
// The claims a SaaS product makes with this model, held as properties:
//   · maxed terms are worth exactly TERMS_WORTH × mult of price — per seller
//   · the seller ordering is the calibrated one (urgent > … > nohurry)
//   · every day shaved off the close moves the number (no clamp flat-tops)
//   · score, termsFrac bounded; reads = price + termsValue; NaN never escapes
//   · an ask of zero refuses to model rather than dividing by it
//   · the UI tells the same story the arithmetic does
//   · a browser with storage disabled (Safari private mode) still prices
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const F=[], ck=(c,m)=>{ if(!c) F.push(m); };
const R = {};

const p = await b.newPage({ viewport:{width:1100,height:1300} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
await p.goto('file:///home/claude/desk.html');
await p.evaluate(()=>localStorage.clear()); await p.reload(); await p.waitForTimeout(400);
await p.evaluate(()=>{ Object.assign(S.raw,{ asking:'249500', arv:'291000', repairs:'41300', rent:'1850' });
  window.__showResults(); });
await p.waitForTimeout(300);

// ── A · static shape of SELLER_W ────────────────────────────────────────────
R.A = await p.evaluate(()=>Object.fromEntries(Object.entries(SELLER_W).map(([k,w])=>
  [k,{ sum:+(w.price+w.speed+w.certainty+w.ease).toFixed(4), mult:w.mult }])));
for (const [k,v] of Object.entries(R.A)) ck(Math.abs(v.sum-1)<0.001, `A: ${k} weights sum to ${v.sum}, not 1`);
{ const m=R.A; ck(m.urgent.mult>m.behind.mult && m.behind.mult>m.motivated.mult &&
    m.motivated.mult>m.estate.mult && m.estate.mult>m.unknown.mult && m.unknown.mult>m.nohurry.mult,
    'A: the urgency multipliers are not in calibrated order'); }

// ── B · maxed terms are worth exactly the per-seller cap ────────────────────
R.B = await p.evaluate(()=>{
  const out={};
  for (const sit of Object.keys(SELLER_W)){
    S.sit=sit; Object.assign(S.lev,{days:7,em:5,insp:0,credit:0,stay:60});
    const m=offerModel();
    out[sit]={ frac:+m.termsFrac.toFixed(4), worth:m.termsValue,
               capPct:+(m.termsCap*100).toFixed(2), expect:m.price*0.09*SELLER_W[sit].mult };
  }
  return out; });
for (const [k,v] of Object.entries(R.B)){
  ck(Math.abs(v.frac-1)<0.002, `B: ${k}: maxed levers only reach termsFrac ${v.frac}`);
  ck(Math.abs(v.worth-v.expect)<2, `B: ${k}: maxed terms worth ${v.worth}, calibration says ${v.expect}`);
}
ck(R.B.urgent.worth > R.B.nohurry.worth*2.5, 'B: urgency barely moves the money');

// ── C · speed is monotone — the old flat top is gone ────────────────────────
R.C = await p.evaluate(()=>{
  S.sit='behind'; Object.assign(S.lev,{em:2,insp:7,credit:0,stay:0});
  return [7,15,25,35,50,60].map(d=>{ S.lev.days=d; return +offerModel().termsValue.toFixed(2); }); });
for (let i=1;i<R.C.length;i++) ck(R.C[i] < R.C[i-1], `C: days ${[7,15,25,35,50,60][i]} did not read below ${[7,15,25,35,50,60][i-1]} (${R.C[i]} vs ${R.C[i-1]})`);

// ── D · fuzz: bounds hold, NaN never escapes, reads is exact ────────────────
R.D = await p.evaluate(()=>{
  let s=0x9e3779b9; const rnd=()=>{ s=Math.imul(s^s>>>16,0x45d9f3b); s=Math.imul(s^s>>>16,0x45d9f3b); s^=s>>>16; return (s>>>0)/4294967296; };
  const sits=Object.keys(SELLER_W); const bad=[];
  for (let i=0;i<240;i++){
    S.sit=sits[Math.floor(rnd()*sits.length)];
    Object.assign(S.lev,{ price:Math.floor(rnd()*101), days:7+Math.floor(rnd()*54),
      em:Math.round(rnd()*10)/2, insp:Math.floor(rnd()*22), credit:Math.floor(rnd()*101), stay:Math.floor(rnd()*61) });
    const m=offerModel();
    const nums=[m.price,m.score,m.termsFrac,m.termsValue,m.reads,m.yourCost,m.room];
    if (nums.some(x=>!Number.isFinite(x))) bad.push(['nan',i,S.sit]);
    if (m.score<0||m.score>100) bad.push(['score',i,m.score]);
    if (m.termsFrac<0||m.termsFrac>1) bad.push(['frac',i,m.termsFrac]);
    if (Math.abs(m.reads-(m.price+m.termsValue))>0.01) bad.push(['reads',i]);
  }
  return { bad, n:240 }; });
ck(R.D.bad.length===0, 'D: fuzz violations: '+JSON.stringify(R.D.bad.slice(0,4)));

// ── E · no asking price is a supported deal, not a refusal ──────────────────
// This used to assert that a zero/empty ask returned null. That was the right
// contract when an asking price was mandatory; it is the wrong one now, because
// a wholesaler working off-market frequently has no asking price and that is
// the whole opportunity. The new contract: the model still runs, anchors on
// your own ceiling, reports ask === null so the copy can say which it is, and
// never divides by the number it does not have.
R.E = await p.evaluate(()=>{ const keep=S.raw.asking;
  const grab = m => m===null ? null : { ask:m.ask, anchor:Math.round(m.anchor), hi:Math.round(m.hi),
    price:Math.round(m.price), score:m.score, terms:Math.round(m.termsValue),
    finite:[m.price,m.score,m.termsValue,m.reads,m.yourCost].every(Number.isFinite) };
  S.raw.asking='0'; const zero=grab(offerModel());
  S.raw.asking='';  const empty=grab(offerModel());
  S.noAsk=true; S.raw.asking=keep; const flagged=grab(offerModel());
  const ranked = rankExits().filter(x=>!x.na && x.fit!==null).map(x=>({id:x.id,fit:x.fit,basis:x.basis}));
  S.noAsk=false; S.raw.asking=keep;
  return { zero, empty, flagged, ranked }; });
for (const k of ['zero','empty','flagged']){
  const m = R.E[k];
  ck(m !== null, `E: ${k} ask produced no model at all`);
  if (!m) continue;
  ck(m.ask === null, `E: ${k} ask did not report ask === null`);
  ck(m.anchor === m.hi, `E: ${k} ask anchored on ${m.anchor}, not the ceiling ${m.hi}`);
  ck(m.finite, `E: ${k} ask produced a non-finite figure`);
  ck(m.score >= 0 && m.score <= 100, `E: ${k} ask scored ${m.score}`);
  ck(m.terms > 0, `E: ${k} ask valued the terms at ${m.terms}`);
}
ck(R.E.ranked.length >= 3, 'E: nothing ranked without an asking price');
ck(R.E.ranked.some(x=>/pays the most/.test(x.basis||'')),
   'E: the no-ask ranking never names the exit that pays the most: '+JSON.stringify(R.E.ranked.slice(0,3)));
ck(R.E.ranked.every(x=>x.fit>=2 && x.fit<=98), 'E: a no-ask fit escaped its bounds');

// ── F · the UI tells the same story ─────────────────────────────────────────
await p.evaluate(()=>{ S.sit='behind'; S.sitPc=80; Object.assign(S.lev,{days:14,em:2,insp:5,credit:0,stay:14}); window.__showResults(); });
await p.waitForTimeout(400);
R.F = await p.evaluate(()=>{
  const m=offerModel();
  /* The mix row used to draw two different quantities on top of each other —
     the track was the seller's attention, the fill was your delivery, and the
     number described only the fill. One bar, one number now: the fill and the
     percentage are the same thing, the attention is said in words, and the
     rows are sorted by attention so the top one is where to spend first. */
  const rows=[...document.querySelectorAll('.mixrow')].map(r=>({
    lab:r.querySelector('.ml').firstChild.textContent.trim(),
    want:r.querySelector('.ml em').textContent,
    v:r.querySelector('.mv').textContent,
    give:r.querySelector('.mt i').style.width }));
  /* The worth block moved out of the right-hand column and into the full-width
     closing band, where the same four facts are rows rather than a paragraph.
     What the harness cares about is that all four are still SAID — the cap for
     this seller, how much of it this offer delivers, who the seller is, and
     what it costs — not which shape they are said in. */
  const wc=document.querySelector('.closeband .worth')?.innerText||'';
  return { rows, wc, capShown:/12\.6% of price/.test(wc), fracShown:wc.includes(Math.round(m.termsFrac*100)+'% of that'),
    sellerNamed:/a seller behind on payments/i.test(wc), twiceGone:!/measured, twice/.test(document.body.innerText),
    costShown:/costs you/i.test(wc), readsShown:/reads to them like/i.test(wc),
    parts:{speed:Math.round(m.parts.speed*100)} };
});
ck(R.F.rows.length===4, 'F: the mix bars did not render');
// the word "undefined" in rendered copy is always a bug that escaped
R.F.noUndefined = await p.evaluate(()=>!/\bundefined\b/.test(document.body.innerText));
ck(R.F.noUndefined, 'F: the word "undefined" is rendering somewhere on the page');
{ const speedRow = R.F.rows.find(r=>/speed/i.test(r.lab));
  ck(!!speedRow, 'F: the mix lost its speed row');
  ck(speedRow && speedRow.give === R.F.parts.speed+'%',
     `F: the speed fill (${speedRow && speedRow.give}) disagrees with the model (${R.F.parts.speed}%)`);
  /* the number beside the bar must BE the bar — that ambiguity is what made
     the panel read as buggy */
  ck(speedRow && speedRow.v.trim() === R.F.parts.speed+'%',
     `F: the number beside the speed bar (${speedRow && speedRow.v}) is not the bar`);
  /* and the rows are ordered by what the seller cares about most */
  const wants = R.F.rows.map(r=>parseInt(r.want,10));
  ck(wants.every((w,i)=>i===0||wants[i-1]>=w),
     'F: the mix rows are not sorted by what this seller wants: '+JSON.stringify(R.F.rows.map(r=>r.want))); }
ck(R.F.capShown && R.F.fracShown && R.F.sellerNamed && R.F.costShown && R.F.readsShown,
   'F: the worth block dropped one of cap / delivery / seller / cost / reads-as: '+R.F.wc.replace(/\n/g,' · ').slice(0,180));
ck(R.F.twiceGone, 'F: "measured, twice" is still on the page');

// ── G · storage denied (private mode): still boots, still prices ────────────
{
  const p2 = await b.newPage();
  const errs2=[]; p2.on('pageerror',e=>errs2.push(e.message));
  await p2.addInitScript(()=>{ const deny={ getItem(){throw new DOMException('denied')},
    setItem(){throw new DOMException('denied')}, removeItem(){throw new DOMException('denied')}, clear(){throw new DOMException('denied')} };
    Object.defineProperty(window,'localStorage',{ get(){ return deny; } }); });
  await p2.goto('file:///home/claude/desk.html'); await p2.waitForTimeout(500);
  // the fields are spread across steps now, so state is set directly and the
  // results are asked for — which is also what a returning visit does
  await p2.evaluate(()=>{ Object.assign(S.raw,{asking:'200000',arv:'280000',repairs:'30000'});
    window.__showResults(); });
  await p2.waitForTimeout(600);
  R.G = { priced: await p2.evaluate(()=>[...document.querySelectorAll('.exit')].filter(x=>x.innerText.length>40).length),
          errs: errs2 };
  ck(R.G.priced>=4, 'G: with storage denied the desk stopped pricing');
  ck(!errs2.length, 'G: storage denial threw: '+errs2.join('; ').slice(0,200));
  await p2.close();
}

// ── H · the offer is built FOR an exit, and follows the one you choose ──────
/* The whole product ranks seven exits and then built the offer for exactly one
   of them — the best-fitting — without saying so. Somebody who read the page
   and decided on the BRRRR was handed a maximum price computed from the flip's
   ceiling. The ceiling, the band, the room and both meters have to re-derive
   from whichever exit is actually named. */
{
  const p3 = await b.newPage({ viewport:{width:1400,height:1100} });
  const e3 = []; p3.on('pageerror', e => e3.push(e.message));
  await p3.goto('file:///home/claude/desk.html');
  await p3.evaluate(()=>localStorage.clear());
  await p3.reload(); await p3.waitForTimeout(400);
  await p3.evaluate(()=>{ Object.assign(S.raw,
    {asking:'168000', arv:'249000', repairs:'24000', rent:'1950'});
    S.addr='1104 Elm Street'; window.__showResults(); });
  await p3.waitForTimeout(600);

  const base = await p3.evaluate(()=>{ const m = offerModel();
    return { exit:m.best.id, win:m.win.id, picked:m.picked, hi:m.hi, price:m.price,
             chips:[...document.querySelectorAll('[data-oexit)'.replace(')',']'))].map(b=>b.dataset.oexit),
             named:/this offer is built for/i.test(document.querySelector('.oxp').innerText) }; });
  R.H = { base };
  ck(base.chips.length >= 3, 'H: the offer does not offer a choice of exit: '+base.chips.length);
  ck(base.exit === base.win && !base.picked, 'H: it does not default to the recommendation');
  ck(base.named, 'H: the offer never says which exit it is built for');

  const other = base.chips.find(c => c !== base.exit);
  await p3.click(`[data-oexit="${other}"]`); await p3.waitForTimeout(600);
  const moved = await p3.evaluate(()=>{ const m = offerModel();
    return { exit:m.best.id, picked:m.picked, hi:m.hi, price:m.price,
             stored:(JSON.parse(localStorage.getItem('ni-desk-v3')).props[0]||{}).offerExit,
             band:(document.querySelector('.closeband')||{}).innerText.slice(0,60) }; });
  R.H.moved = moved;
  ck(moved.exit === other, 'H: choosing an exit did not change the one in force');
  ck(moved.picked, 'H: a chosen exit does not register as chosen');
  ck(Math.abs(moved.hi - base.hi) > 1, 'H: the ceiling did not move with the exit');
  ck(Math.abs(moved.price - base.price) > 1, 'H: the offer price did not move with the exit');
  ck(moved.stored === other, 'H: the choice was not written down: '+moved.stored);

  // pressing the one in force goes back to the recommendation
  await p3.click(`[data-oexit="${other}"]`); await p3.waitForTimeout(600);
  const back = await p3.evaluate(()=>({ exit:offerModel().best.id, picked:offerModel().picked,
    stored:(JSON.parse(localStorage.getItem('ni-desk-v3')).props[0]||{}).offerExit }));
  R.H.back = back;
  ck(back.exit === base.win && !back.picked && !back.stored,
     'H: there is no way back to the recommendation');

  // a choice that stops pricing must fall back rather than break
  await p3.evaluate(()=>{ S.offerExit = 'hold'; S.raw.rent = ''; save(); render(); });
  await p3.waitForTimeout(500);
  const lost = await p3.evaluate(()=>{ const m = offerModel();
    return { exit:m.best.id, lost:m.lost, says:/no longer prices/i.test(document.querySelector('.oxp').innerText) }; });
  R.H.lost = lost;
  ck(lost.exit !== 'hold', 'H: an exit that stopped pricing is still driving the offer');
  ck(lost.lost && lost.says, 'H: falling back to the recommendation happens silently');
  ck(!e3.length, 'H: the exit picker threw: '+e3.join('; ').slice(0,160));
  await p3.close();
}

ck(!errs.length, 'page errors: '+errs.join('; ').slice(0,200));
console.log(JSON.stringify(R,null,1));
console.log(F.length ? 'FAIL:\n- '+F.join('\n- ') : 'PASS — the offer model holds as calibrated, bounded, monotone, honest in the UI, and storage-proof');
await b.close(); process.exit(F.length?1:0);
