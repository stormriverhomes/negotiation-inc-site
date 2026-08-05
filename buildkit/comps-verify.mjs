// ── the comp workbench, held to what it claims ──────────────────────────────
// The pitch is specific and therefore testable: this is NOT an AVM. It scores
// each comp for comparability, adjusts it to the subject, lays the set out as a
// working range, and the number the user picks lands on the sheet as ENTERED —
// which is the whole confidence unlock. Each of those is asserted here, plus
// the arithmetic properties the adjustments have to obey.
import { chromium } from 'playwright';
import { step } from './harness-util.mjs';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const F=[], ck=(c,m)=>{ if(!c) F.push(m); };
const R={};
const p = await b.newPage({ viewport:{width:1120,height:1200} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
await p.goto('file:///home/claude/desk.html');
await p.evaluate(()=>localStorage.clear()); await p.reload(); await p.waitForTimeout(400);

// a subject and four comps that differ one axis at a time
const seed = async () => p.evaluate(()=>{
  S.subj = { sqft:'1500', beds:'3', baths:'2' };
  S.comps = [
    // identical twin, sold yesterday next door — should score near the top
    { id:'a', addr:'Twin',   price:'300000', sqft:'1500', beds:'3', baths:'2', sold:'0',  dist:'0.1', cond:0, use:true },
    // same house, sold a year ago — time adjustment only
    { id:'b', addr:'Old',    price:'300000', sqft:'1500', beds:'3', baths:'2', sold:'12', dist:'0.1', cond:0, use:true },
    // 300 sqft smaller — size adjustment up
    { id:'c', addr:'Small',  price:'300000', sqft:'1200', beds:'3', baths:'2', sold:'0',  dist:'0.1', cond:0, use:true },
    // two miles out, one bed short, sold rough — the weak one
    { id:'d', addr:'Far',    price:'300000', sqft:'1500', beds:'2', baths:'2', sold:'0',  dist:'2.0', cond:-2, use:true },
  ];
  S.compOpen = true; save(); window.__render();
});
await seed(); await p.waitForTimeout(400);

// ── A · scoring behaves like comparability, not like a lottery ──────────────
R.A = await p.evaluate(()=>Object.fromEntries(compRows().map(r=>[r.addr,
  { score:r.score, adjusted:Math.round(r.adjusted), gross:Math.round(r.gross), why:r.why }])));
ck(R.A.Twin.score > R.A.Old.score,   'A: a year-old sale scored as well as one from this month');
ck(R.A.Twin.score > R.A.Far.score,   'A: a two-mile, one-bed-short, rough comp scored as well as the twin');
ck(R.A.Twin.score > R.A.Small.score, 'A: a 20%-smaller comp scored as well as the same-size one');
ck(R.A.Twin.score >= 80, 'A: an identical next-door sale from this month only scored '+R.A.Twin.score);
ck(R.A.Far.score <= 45,  'A: the deliberately poor comp still scored '+R.A.Far.score);

// ── B · adjustments move in the right direction, by the right magnitude ─────
ck(R.A.Old.adjusted > R.A.Twin.adjusted,
   `B: a sale from 12 months ago was not adjusted up for time (${R.A.Old.adjusted} vs ${R.A.Twin.adjusted})`);
ck(Math.abs((R.A.Old.adjusted - 300000) - 9000) < 600,
   `B: a year of 3% market movement should be ~$9,000, got ${R.A.Old.adjusted-300000}`);
ck(R.A.Small.adjusted > R.A.Twin.adjusted,
   'B: a comp 300 sq ft smaller than the subject was not adjusted up');
// the size rate is derived: 50% of the set's median $/sqft
R.B = await p.evaluate(()=>({ ppsf: medianPPSF(S.comps), rows: compRows().map(r=>({a:r.addr, size:Math.round(r.adj.size)})) }));
{ const expect = 300 * (R.B.ppsf*0.5);
  const got = R.B.rows.find(x=>x.a==='Small').size;
  ck(Math.abs(got-expect) < 600, `B: the size adjustment (${got}) is not 300 sq ft × 50% of the median $/sqft (${Math.round(expect)})`); }
ck(R.A.Far.adjusted > R.A.Twin.adjusted, 'B: a comp that sold in much worse condition was not adjusted up toward ARV');

// ── C · the range is a weighted band, not a mean wearing a costume ──────────
R.C = await p.evaluate(()=>{ const r = compRange();
  return { n:r.n, lo:Math.round(r.lo), hi:Math.round(r.hi), mean:Math.round(r.mean),
           min:Math.round(r.min), max:Math.round(r.max), best:r.best.addr }; });
ck(R.C.n===4, 'C: the range did not use all four comps');
ck(R.C.lo < R.C.mean && R.C.mean < R.C.hi, 'C: the band does not contain its own middle');
ck(R.C.min <= R.C.lo && R.C.hi <= R.C.max + 1, 'C: the band escaped the spread it came from');
ck(R.C.best==='Twin', 'C: the best comp is not the most comparable one, it is '+R.C.best);
// the weighting must actually bite: the weak comp should pull the mean less
R.Cw = await p.evaluate(()=>{ const w = compRange().mean;
  const keep = JSON.parse(JSON.stringify(S.comps));
  S.comps = S.comps.filter(c=>c.addr!=='Far'); const without = compRange().mean;
  S.comps = keep; return { w:Math.round(w), without:Math.round(without) }; });
ck(Math.abs(R.Cw.w - R.Cw.without) < Math.abs(R.A.Far.adjusted - R.Cw.without)/2,
   `C: the low-scoring comp moved the mean as much as a good one would (${R.Cw.w} vs ${R.Cw.without})`);

// ── D · a single comp refuses to draw a range ───────────────────────────────
R.D = await p.evaluate(()=>{ const keep = JSON.parse(JSON.stringify(S.comps));
  S.comps = [keep[0]]; save(); window.__render();
  const txt = document.getElementById('cw').innerText;
  const band = !!document.querySelector('.rtrack');
  S.comps = keep; save(); window.__render();
  return { band, saysWhy: /One comp is a data point/.test(txt) }; });
ck(!R.D.band && R.D.saysWhy, 'D: one comp drew a range instead of saying why it cannot');

// ── E · the number the user sets lands as ENTERED, and says where from ──────
await p.waitForTimeout(300);
await p.click('#arv-take'); await p.waitForTimeout(400);
R.E = await p.evaluate(()=>({ arv:S.raw.arv, est:!!S.est.arv, unc:S.unc.arv,
  prov:S.prov.arv||'', chip:document.querySelector('#fb-arv .stchip')?.textContent||'' }));
ck(R.E.arv !== '' && R.E.arv != null, 'E: taking the range middle did not write an ARV');
ck(R.E.est === false, 'E: an ARV the user derived from their own comps was marked an ESTIMATE');
ck(!R.E.unc, 'E: a derived ARV still carries an uncertainty widening');
ck(/comparable sales you scored yourself/.test(R.E.prov), 'E: the derived ARV does not say where it came from');
ck(R.E.chip === 'ENTERED', 'E: the ARV field does not read ENTERED, it reads '+R.E.chip);

// ── F · and that is the point: confidence rises ─────────────────────────────
R.F = await p.evaluate(()=>{
  Object.assign(S.raw, { asking:'249500', repairs:'40000' });
  S.est.arv = false; save(); window.__showResults();
  const derived = document.getElementById('conf').innerText.replace(/\n/g,' ');
  S.est.arv = true; S.unc.arv = 0.20; window.__render(); window.__showResults();
  const guessed = document.getElementById('conf').innerText.replace(/\n/g,' ');
  S.est.arv = false; S.unc.arv = null; save();
  return { derived, guessed }; });
ck(/high/i.test(R.F.derived), 'F: an all-entered sheet does not read high confidence: '+R.F.derived);
ck(/medium|low/i.test(R.F.guessed), 'F: an estimated ARV does not lower confidence: '+R.F.guessed);

// ── G · it does not pretend to be an AVM ────────────────────────────────────
R.G = await p.evaluate(()=>{ const t = document.getElementById('cw').innerText;
  return { disclaims:/Not an AVM/i.test(t), noCaps:/no\s*net or gross adjustment caps/i.test(t),
           derivedRate:/median .*sq ft|% of this/i.test(t) }; });
ck(R.G.disclaims, 'G: the workbench does not say it is not an AVM');
ck(R.G.noCaps, 'G: the adjustment note dropped the Fannie Mae caps correction');

ck(!errs.length, 'page errors: '+errs.join('; ').slice(0,200));
console.log(JSON.stringify(R,null,1));
console.log(F.length ? 'FAIL:\n- '+F.join('\n- ') : 'PASS — comps score, adjust, range honestly, and the ARV they produce is the user\'s own');
await b.close(); process.exit(F.length?1:0);
