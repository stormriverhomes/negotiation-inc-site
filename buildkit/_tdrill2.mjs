/* The drill must not be a lookup table, and it must settle in dollars.
   1. The seller's situation must no longer predict the answer. Before this
      change, "behind on payments" meant subject-to 100% of the time.
   2. The verdict must name real money — a ceiling, a monthly spread, a cheque
      — and never a "fit" score, which is a unit that exists only in this game.
   3. The generator must still find a clean deal for every shape. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/exit-drill.html');
let n=0, bad=0;
const ok=(t,p,x)=>{n++; if(!p){bad++;console.log('✗ '+t+(x!==undefined?'  ← '+JSON.stringify(x):''));}else console.log('✓ '+t);};

const b = await chromium.launch();
const pg = await b.newPage({ viewport:{width:1280,height:900} });
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,200)));
await pg.addInitScript(()=>{ window.__seed = 20260728; window.__strict = true; });
await pg.goto(FILE); await pg.waitForTimeout(400);
ok('boots clean', errs.length===0, errs[0]);

/* ── 1. the telegraph ─────────────────────────────────────────────────── */
const tele = await pg.evaluate(()=>{
  const tally = {}; let exhausted = 0;
  const SH = ['flip','hold','subto','novation','walk','wholetail','wholesale','brrrr'];
  for (let i=0;i<1600;i++){
    const shape = SH[i % SH.length];
    let d; try { d = deal(shape); } catch(e){ exhausted++; continue; }
    const a = answerFor(d);
    (tally[d.sit] = tally[d.sit] || {})[a] = ((tally[d.sit]||{})[a]||0)+1;
  }
  return { tally, exhausted };
});
ok('the generator never exhausts', tele.exhausted===0, tele.exhausted);

const sits = Object.keys(tele.tally);
ok('every situation still appears', sits.length>=5, sits);
const worst = sits.map(s=>{
  const row = tele.tally[s], tot = Object.values(row).reduce((a,b)=>a+b,0);
  const top = Math.max(...Object.values(row));
  return { sit:s, share: top/tot, answers: Object.keys(row).length, tot };
}).sort((a,b)=>b.share-a.share);
console.log('   situation → answer spread:');
for (const w of worst) console.log('     '+w.sit.padEnd(10)+' '+w.answers+' different answers, most common '+Math.round(w.share*100)+'% of '+w.tot);

ok('no situation predicts one single answer', worst[0].share < 0.90, worst[0]);
ok('"behind on payments" is no longer a subject-to tell',
   (tele.tally.behind && Object.keys(tele.tally.behind).length) >= 3, tele.tally.behind);
ok('every situation carries at least two answers', worst.every(w=>w.answers>=2), worst.filter(w=>w.answers<2));

/* ── 2. the settlement ────────────────────────────────────────────────── */
const seen = { fit:0, money:0 };
for (let i=0;i<10;i++){
  await pg.evaluate(()=>{ const b=document.querySelector('.ans:not([disabled])'); if(b) b.click(); });
  await pg.waitForTimeout(90);
  const v = await pg.locator('#verdict').textContent();
  if (/\bfit \d+/.test(v)) seen.fit++;
  if (/\$[\d,]+/.test(v)) seen.money++;
  await pg.evaluate(()=>advance());
  await pg.waitForTimeout(90);
}
ok('the verdict never prints a "fit" score', seen.fit===0, seen);
ok('the verdict always prints real money', seen.money===10, seen);

const led = await pg.evaluate(()=>{
  const b=document.querySelector('.ans:not([disabled])'); if(b) b.click();
  return null;
});
await pg.waitForTimeout(120);
const rows = await pg.locator('.ldg .lr').count();
ok('the ledger shows more than one exit', rows>=2, rows);
ok('the ledger tags the desk’s answer', await pg.locator('.lt.best').count()===1);
ok('the ledger tags what you said', await pg.locator('.lt.you').count()<=1);
const ldgTxt = await pg.locator('.ldg').first().textContent();
ok('the ledger explains in words as well as figures',
   /you can pay up to|a month|at the closing|nothing here pays/.test(ldgTxt), ldgTxt.slice(0,200));
ok('the ledger never puts a purchase ceiling in the headline column',
   await pg.evaluate(()=>{
     const ask = G.cur ? G.cur.ask : 0;
     return [...document.querySelectorAll('.ldg .lv')].every(v=>{
       const n = +v.textContent.replace(/[^0-9]/g,'');
       return !n || n < ask * 0.9;                 // a ceiling is ~the ask; room is far smaller
     });
   }));

/* green is money that pays — never on a number that does not */
const greens = await pg.evaluate(()=>{
  const out=[];
  document.querySelectorAll('.ldg .lr').forEach(r=>{
    const v=r.querySelector('.lv'), w=r.querySelector('.lw');
    out.push({ green: v.classList.contains('good'), n: v.textContent, says: w.textContent });
  });
  return out;
});
ok('nothing negative is painted green', greens.every(g=>!(g.green && g.n.indexOf('−')===0)), greens);
ok('nothing painted green says "short of their ask"',
   greens.every(g=>!(g.green && /short of their ask|bleeds|nothing left/.test(g.says))), greens);
ok('no page errors', errs.length===0, errs[0]);

await b.close();
console.log('\n'+(bad? '✗ '+bad+' of '+n+' failed' : '✓ all '+n+' hold'));
process.exit(bad?1:0);
