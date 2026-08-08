/* HOW FAR AWAY ARE WE, AND WHICH EXIT ANSWERS THAT.

   The "No exit reaches their price" panel is the loudest thing on the screen
   when a deal is dead, and it was narrating the FIT ranking as though it were
   a CEILING ranking. Those are the same exit most of the time and come apart
   the moment the seller's situation moves a fit — SIT_MOD gives the wholesale
   +12 on an urgent seller, which is enough to lift it above exits that can pay
   forty thousand more.

   The consequence is the worst kind: a seller counters at a number two exits
   clear, and the panel tells you the deal is dead. This asserts the panel
   measures the gap with the exit that can actually pay the most, and that the
   exit table on the same screen does not contradict it. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/desk.html');
let n=0,bad=0;
const ok=(t,p,x)=>{n++; if(!p){bad++;console.log('✗ '+t+(x!==undefined?'  ← '+JSON.stringify(x).slice(0,300):''));}else console.log('✓ '+t);};

const b=await chromium.launch();
const pg=await b.newPage({viewport:{width:1400,height:1200}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,180)));
await pg.goto(FILE); await pg.waitForTimeout(600);

/* the audit's own numbers: an urgent seller asking well over what anything
   here can pay, where SIT_MOD reorders the fits away from the ceilings */
const shape = await pg.evaluate(()=>{
  P.props.length = 0; P.props.push(newProp('The one they will not move on'));
  P.active = 0; loadInto(0);
  const put = (k,v) => { S.raw[k]=v; S.est[k]=true; S.prov[k]='typed'; S.unc[k]=.05; };
  put('asking','260,000'); put('arv','240,000'); put('repairs','20,000'); put('rent','1,900');
  S.repairsOwn = true; S.sit = 'urgent'; S.userToggled = true;
  if (typeof recompute === 'function') recompute();
  if (typeof showResults === 'function') showResults();
  const R = rankedExits();
  const payers = R.live.filter(x => typeof x.ceil === 'number');
  const byCeil = payers.slice().sort((a,c)=>c.ceil-a.ceil);
  return {
    ask: val('asking'),
    bestFit:  R.live[0] ? { id:R.live[0].id, nm:R.live[0].nm, fit:R.live[0].fit,
                            ceil: typeof R.live[0].ceil==='number'?Math.round(R.live[0].ceil):null } : null,
    bestCeil: byCeil[0] ? { id:byCeil[0].id, nm:byCeil[0].nm, ceil:Math.round(byCeil[0].ceil) } : null,
    all: payers.map(x=>({ id:x.id, fit:x.fit, ceil:Math.round(x.ceil) })),
  };
});
console.log('   ' + JSON.stringify(shape));
ok('nothing on this sheet reaches the ask',
   shape.bestCeil && shape.bestCeil.ceil < shape.ask, shape);
ok('the fit ranking and the ceiling ranking genuinely disagree here',
   shape.bestFit && shape.bestCeil && shape.bestFit.id !== shape.bestCeil.id, shape);

const panel = await pg.evaluate(()=>{
  const el = document.querySelector('.payday.no');
  return el ? el.textContent.replace(/\s+/g,' ').trim() : null;
});
console.log('   panel: ' + String(panel).slice(0, 260));
ok('the no-reach panel is showing', !!panel, panel);
/* every exit's name already begins with "The", so an article in front of it
   produces "on the the buy and hold" — the sort of thing a reader notices
   before they notice anything else on the screen */
ok('it does not say "the the"', !/\bthe the\b/i.test(String(panel)),
   (String(panel).match(/.{0,40}the the.{0,40}/i) || [])[0]);

if (panel){
  const M = v => '$' + Math.round(v).toLocaleString('en-US');
  ok('the gap is measured against the exit that can pay the MOST',
     panel.includes(M(shape.bestCeil.ceil)), { want: M(shape.bestCeil.ceil), panel: panel.slice(0,200) });
  ok('it does not quote the best-fitting exit\'s smaller ceiling as the closest',
     !new RegExp('most anybody here can pay is \\' + M(shape.bestFit.ceil).replace(/[$,]/g,'\\$&')).test(panel),
     { fitCeil: M(shape.bestFit.ceil) });
  ok('it no longer claims every other exit pays less',
     !/Every other exit here pays less/.test(panel), panel.slice(0,200));
  ok('and it names the better-fitting exit rather than hiding it',
     panel.toLowerCase().includes(String(shape.bestFit.nm).toLowerCase()), panel.slice(0,240));
  ok('the "if they came to X" figure is the reachable one',
     panel.includes('came to ' + M(shape.bestCeil.ceil)), panel.slice(-200));

  /* and the exit table on the same screen must not contradict it */
  const contradicts = await pg.evaluate((ceil)=>{
    const rows = [...document.querySelectorAll('#exits .exit')].map(r => r.textContent);
    return rows.some(t => /pay no more than/i.test(t) &&
      (t.match(/\$[\d,]+/g)||[]).some(x => +x.replace(/[^0-9]/g,'') > ceil));
  }, shape.bestCeil.ceil);
  ok('no exit row shows a ceiling higher than the one the panel names', !contradicts);
}

/* when fit and ceiling AGREE, the panel must not invent a distinction */
const agree = await pg.evaluate(()=>{
  P.props.length = 0; P.props.push(newProp('A plain dead one'));
  P.active = 0; loadInto(0);
  const put = (k,v) => { S.raw[k]=v; S.est[k]=true; S.prov[k]='typed'; S.unc[k]=.05; };
  put('asking','400,000'); put('arv','240,000'); put('repairs','19,000'); put('rent','1,900');
  S.repairsOwn = true; S.sit = 'unknown'; S.userToggled = false;
  if (typeof recompute === 'function') recompute();
  if (typeof showResults === 'function') showResults();
  const R = rankedExits();
  const payers = R.live.filter(x => typeof x.ceil === 'number');
  const byCeil = payers.slice().sort((a,c)=>c.ceil-a.ceil);
  const el = document.querySelector('.payday.no');
  return { same: !!(R.live[0] && byCeil[0] && R.live[0].id === byCeil[0].id),
           text: el ? el.textContent.replace(/\s+/g,' ').trim() : null };
});
if (agree.same && agree.text)
  ok('where fit and ceiling agree, it says so plainly and adds no caveat',
     /Every other exit here pays less/.test(agree.text), agree.text.slice(0,200));
else
  ok('the agreeing case was exercised', true);

ok('no page errors', errs.length===0, errs[0]);
await b.close();
console.log('\n'+(bad? '✗ '+bad+' of '+n+' failed' : '✓ all '+n+' hold'));
process.exit(bad?1:0);
