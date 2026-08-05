import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{width:1000,height:1200} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
import { step, underwrite, openExit } from './harness-util.mjs';
await p.goto('file:///home/claude/desk.html');
await p.evaluate(()=>localStorage.clear()); await p.reload(); await p.waitForTimeout(400);
await underwrite(p);   // the empty state, and its demo button, live in the results

// empty state shows three states with ESTIMATE not GUESS
const empty = await p.evaluate(()=>({txt:document.getElementById('empty').innerText,
  noGuess:!document.body.innerText.toLowerCase().includes('guess'),
  printAbsent:!document.getElementById('print'),
  docketHidden:getComputedStyle(document.getElementById('docket')).display==='none',
  sitTag:document.getElementById('sittag').textContent}));
// load the demo
await p.click('#demo'); await p.waitForTimeout(400); await underwrite(p);
// ── math unchanged from v1 (independent recompute) ──
// Recomputed against the DEFAULTS block in desk.html — rate 7.1, ltv 75,
// dscr 1.25, sell 8%, hold 6mo, profit 8%, opex 40%. If an advanced default
// moves, this fails loudly instead of drifting quietly, which is the point.
const ARV=291000,REP=41300,ASK=249500,RENT=1850,RATE=0.071;
const SELL=8, HOLD=6, PROFIT=8, DSCR=1.25, LTV=75, OPEX=40;
const m=RATE/12,k=Math.pow(1+m,360),MPD=m*k/(k-1);
const expect={ wholesaleCeil:0.70*ARV-REP,
  flipMaxBuy:ARV-REP-(SELL/100)*ARV-Math.max(2000*HOLD,0.006*HOLD*ARV)-Math.max(15000,(PROFIT/100)*ARV),
  holdMaxPrice:(RENT*(1-OPEX/100)/DSCR)/MPD/(LTV/100), brrrrMaxBuy:(LTV/100)*ARV-REP-7000 };
// the demo's repairs are 14.2% of ARV — past the novation's 10% gate, so the
// honest expectation for that row is the refusal, not a check
const NOV_REFUSED = true;
const shown = await p.evaluate(()=>{
  const openAndRead = id => { const el=document.querySelector(`[data-row="${id}"]`); el && el.click();
    const x=document.getElementById('x-'+id); return x?x.innerText:''; };
  return { wholesale:openAndRead('wholesale'), flip:openAndRead('flip'), hold:openAndRead('hold'),
    brrrr:openAndRead('brrrr'), nov:openAndRead('novation') };
});
const has=(s,n)=>s.includes(Math.round(n).toLocaleString('en-US'));
const checks={ wholesaleCeil:has(shown.wholesale,expect.wholesaleCeil), flipMaxBuy:has(shown.flip,expect.flipMaxBuy),
  holdMaxPrice:has(shown.hold,expect.holdMaxPrice), brrrrMaxBuy:has(shown.brrrr,expect.brrrrMaxBuy),
  novRefused: NOV_REFUSED && /not retail yet/.test(shown.nov) };
// ── language: ESTIMATE everywhere, no GUESS anywhere ──
// The worked example marks REPAIRS an estimate by design ("the bid is not
// back"), so with rows open the honest expectations are POSITIVE: the row
// flag, the widening note, and a confidence line that counts one estimate.
await p.waitForTimeout(250);   // the exit rows render on a coalesced frame
const lang = await p.evaluate(()=>{
  const t=document.body.innerText;
  return { hasEstimateChip:t.includes('ESTIMATE'), runsOnShown:/runs on estimates/i.test(t),
    noGuess:!/guess/i.test(t), widenShown:t.includes('Verify it and the band tightens'),
    conf:document.getElementById('conf').innerText.replace(/\n/g,' ') };
});
// ── fit ranking responds to situation ──
const fitEstate = await p.evaluate(()=>[...document.querySelectorAll('.exit .nm')].slice(0,3).map(e=>e.textContent));
await underwrite(p);
const fitLine = await p.evaluate(()=>{
  /* The opened exit stopped being one run-on paragraph and became a list — a
     line per step of the arithmetic, with the fit basis as its own row. Read
     the last row rather than the last line of a blob. */
  if (!document.querySelector('#x-wholesale .xb-work')) document.querySelector('[data-row="wholesale"]')?.click();
  const li=[...document.querySelectorAll('#x-wholesale .xb-work li')];
  return li.length ? li[li.length-1].innerText : ''; });
// the situation is a dial now: drag it to "behind on payments"
await p.evaluate(()=>{ const r=document.getElementById('sit-range');
  r.value = SIT_ORDER.indexOf('behind'); r.dispatchEvent(new Event('input')); });
await p.waitForTimeout(250);
// behind needs loan open + piti to matter for subto ranking; check fit numbers shift on wholesale
const fitBehind = await p.evaluate(()=>{
  const x=document.getElementById('x-wholesale'); return x?x.querySelector('.fit').textContent:''; });
await p.evaluate(()=>{ const r=document.getElementById('sit-range');
  r.value = SIT_ORDER.indexOf('estate'); r.dispatchEvent(new Event('input')); });
await p.waitForTimeout(200);
// ── estimate chips write values marked ESTIMATE ──
await p.evaluate(()=>{ S.raw.rent=''; save(); });
await step(p,'money');
const chipBefore = await p.evaluate(()=>({needed:document.getElementById('fb-rent').className.includes('needed'),
  hasChip:!!document.querySelector('[data-est="rent:0"]')}));
await p.click('[data-est="rent:0"]'); await p.waitForTimeout(250);
const chipAfter = await p.evaluate(()=>({cls:document.getElementById('fb-rent').className,
  val:document.getElementById('fi-rent').value,
  expected:String(Math.round(291000*0.0065/25)*25)}));
// ── widening drawn when estimate present ──
// the estimate just accepted was RENT, which prices the hold — not the
// wholesale, which runs on ARV and repairs. Check the exit that actually
// inherited the uncertainty, and open it only if it is closed.
await underwrite(p);
const widen = await p.evaluate(()=>{
  // the container always exists and always holds the row header; the working
  // block is what appears on expand, so that is the honest "is it open" test
  if (!document.querySelector('#x-hold .working')) document.querySelector('[data-row="hold"]')?.click();
  return { ext:!!document.querySelector('#x-hold .est-ext'), note:!!document.querySelector('#x-hold .bandnote') }; });
// ── missing row focuses its field; subto opens loan ──
await p.evaluate(()=>{ S.raw.piti=''; S.mode='advanced'; save(); });
await underwrite(p);
await p.click('[data-row="subto"]'); await p.waitForTimeout(350);
const subtoFocus = await p.evaluate(()=>({loanOpen:document.getElementById('loan').open,
  focused:document.activeElement.id}));
// ── print doc exists with signature line + estimate marks ──
const print = await p.evaluate(()=>{const t=document.getElementById('printdoc').innerText;
  return { sig:t.includes('Prepared by'), est:t.includes('ESTIMATE'), addr:t.includes('1128 MARROW LANE')||t.includes('1128 Marrow Lane') };});
// ── persistence ──
await p.reload(); await p.waitForTimeout(500);
const persist = await p.evaluate(()=>({addr:document.getElementById('addr').value, sit:S.sit,
  estRepairs:S.est.repairs}));
await p.evaluate(()=>window.scrollTo(0,0));
await p.screenshot({path:'desk-v2.png', clip:{x:0,y:0,width:1000,height:1150}});
// consent chips show the number before accepting; provenance appears after
await p.evaluate(()=>{ S.raw.rent=''; S.prov.rent=null; save(); });
await step(p,'money');
const chipLabel = await p.evaluate(()=>document.querySelector('[data-est="rent:0"]').innerText.replace(/\n/g,' '));
await p.click('[data-est="rent:0"]'); await p.waitForTimeout(200);
const provLine = await p.evaluate(()=>({prov:document.querySelector('#fb-rent .prov')?.innerText||'(none)',
  st:document.querySelector('#fb-rent .stchip').textContent}));
await p.fill('[data-f="rent"]','2000'); await p.press('[data-f="rent"]','Tab'); await p.waitForTimeout(250);
const provCleared = await p.evaluate(()=>!document.querySelector('#fb-rent .prov'));
// #example deep link fills the demo on a clean sheet
await p.evaluate(()=>localStorage.clear());
await p.goto('file:///home/claude/desk.html#example'); await p.waitForTimeout(900);
const deepLink = await p.evaluate(()=>({addr:document.getElementById('addr').value, rows:document.querySelectorAll('.exit').length}));
const out = {empty:empty.noGuess,emptyState:empty,chipLabel,provLine,provCleared,deepLink,checks,lang,fitEstate,fitLine,fitBehind,chipBefore,chipAfter:{ok:chipAfter.val.replace(/,/g,'')===chipAfter.expected,...chipAfter},widen,subtoFocus,print,persist,errs};
console.log(JSON.stringify(out,null,1));

// ── assertions: a harness that cannot fail is not a harness ─────────────────
const F=[], ck=(c,m)=>{ if(!c) F.push(m); };
for (const [k,v] of Object.entries(checks)) ck(v, `arithmetic drifted: ${k} is not on the page`);
ck(empty.noGuess && empty.printAbsent && empty.docketHidden, 'empty state leaks print/docket or says "guess"');
ck(empty.sitTag==='UNREAD', 'an unread seller does not read as UNREAD');
ck(/≈ \$1,900/.test(chipLabel), 'the rent chip stopped previewing its figure');
ck(provLine.st==='ESTIMATE' && /0\.65%/.test(provLine.prov), 'accepting a chip lost its state or provenance');
ck(provCleared, 'typing over an estimate did not clear the provenance');
ck(deepLink.addr==='1128 Marrow Lane' && deepLink.rows>=6, '#example deep link no longer fills the sheet');
ck(lang.noGuess, 'the word "guess" reappeared');
ck(lang.runsOnShown, 'the estimated demo sheet does not flag "Runs on estimates"');
ck(lang.widenShown, 'the estimated demo sheet does not show the widening note');
ck(/CONFIDENCE/.test(lang.conf) && /1 estimate/.test(lang.conf), 'the confidence line does not count the demo estimate');
ck(fitEstate.length===3, 'the exit list stopped ranking');
ck(/vs their|ceiling|benchmark/.test(fitLine), 'the fit basis line is empty — ranking is unexplained');
ck(/fit \d+/.test(fitBehind), 'moving the seller dial stopped producing a fit');
ck(chipBefore.needed && chipBefore.hasChip, 'a NEEDED field offers no estimate');
ck(out.chipAfter.ok, 'accepting a chip wrote the wrong number');
ck(widen.ext && widen.note, 'an estimate no longer widens the band');
ck(print.sig && print.est && print.addr, 'the print document lost its signature, marks or address');
ck(persist.addr==='1128 Marrow Lane' && persist.estRepairs, 'the sheet did not survive a reload');
ck(!errs.length, 'page errors: '+errs.join('; ').slice(0,200));

console.log(F.length ? 'FAIL:\n- '+F.join('\n- ') : 'PASS — the desk arithmetic, honesty grammar, ranking and persistence all hold');
await b.close(); process.exit(F.length?1:0);
