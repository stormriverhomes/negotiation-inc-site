/* ZERO IS A NUMBER SOMEBODY CAN TYPE.
   need() only catches null, so an ARV of 0 reaches every percentage on the
   sheet and each one divides by it. The desk printed "Repairs are Infinity%
   of ARV" inside a refusal — a sentence whose whole job is to explain, saying
   nothing. This walks the zero, the empty string and the absurdly large
   through the surfaces that do arithmetic, and refuses any page that shows a
   reader Infinity, NaN, undefined or -0. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE='file://'+path.resolve(process.argv[2] || 'dist/desk.html');
let n=0,bad=0;
const ok=(t,p,x)=>{n++; if(!p){bad++;console.log('✗ '+t+(x!==undefined?'  ← '+JSON.stringify(x).slice(0,300):''));}else console.log('✓ '+t);};

const b=await chromium.launch();
const pg=await b.newPage({viewport:{width:1400,height:1400}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,180)));
await pg.goto(FILE); await pg.waitForTimeout(600);

const CASES = [
  { lab:'ARV zero',            arv:'0',        repairs:'40000', asking:'120000', rent:'1400' },
  { lab:'everything zero',     arv:'0',        repairs:'0',     asking:'0',      rent:'0' },
  { lab:'rent zero',           arv:'300000',   repairs:'40000', asking:'214000', rent:'0' },
  { lab:'repairs above ARV',   arv:'80000',    repairs:'260000',asking:'40000',  rent:'900' },
  { lab:'asking zero',         arv:'300000',   repairs:'40000', asking:'0',      rent:'1900' },
  { lab:'absurdly large',      arv:'999999999',repairs:'999999999', asking:'999999999', rent:'999999' },
];
const NASTY = /Infinity|NaN|undefined|null%|\$-0\b|−\$0\.00/;

for (const c of CASES){
  const res = await pg.evaluate((c)=>{
    P.props.length = 0; P.props.push(newProp()); P.active = 0; loadInto(0);
    for (const k of ['arv','repairs','asking','rent']){
      S.raw[k] = c[k]; S.est[k] = true; S.prov[k] = 'typed'; S.unc[k] = .05;
    }
    if (typeof recompute === 'function') recompute();
    if (typeof showResults === 'function') showResults();
    return true;
  }, c);
  await pg.waitForTimeout(320);
  const seen = await pg.evaluate(()=>{
    /* expand every exit so refusal sentences and workings are on the page */
    document.querySelectorAll('.exit-h').forEach(h=>{ try{ h.click(); }catch(e){} });
    return document.body.innerText;
  });
  await pg.waitForTimeout(200);
  const full = await pg.evaluate(()=>document.body.innerText);
  const hit = (full.match(NASTY)||[])[0] || null;
  const line = hit ? (full.split('\n').find(l=>NASTY.test(l))||'').slice(0,140) : null;
  ok(`${c.lab}: the page never shows a reader a broken number`, !hit, { hit, line });
}

/* the condition panel's own percentage, on a sheet with no finished value */
const cond = await pg.evaluate(()=>{
  P.props.length = 0; P.props.push(newProp()); P.active = 0; loadInto(0);
  S.raw.arv = '0'; S.est.arv = true; S.prov.arv='typed'; S.unc.arv=.05;
  LINES.slice(0,3).forEach(l => S.sys[l.id] = 70);
  S.repairsOwn = false;
  if (typeof syncRepairs === 'function') syncRepairs();
  if (typeof render === 'function') render();
  const cap = document.getElementById('cond-cap');
  return { cap: cap ? cap.textContent : null, prov: S.prov.repairs || null };
});
ok('the condition cap does not divide by a zero finished value',
   !NASTY.test(String(cond.cap||'')), cond);
ok('and neither does its provenance line',
   !NASTY.test(String(cond.prov||'')), cond);

ok('no page errors through any of it', errs.length===0, errs[0]);
await b.close();
console.log('\n'+(bad? '✗ '+bad+' of '+n+' failed' : '✓ all '+n+' hold'));
process.exit(bad?1:0);
