/* AN UNKNOWN IS NOT THE BEST CASE, AND A HOUSE THAT SOLD FOR NOTHING DID NOT SELL.

   Two ways the comp scorer turned an absence into a virtue:

   · A blank "months ago" and a blank "miles away" both coerced to 0 — the two
     BEST values either field can hold. A comp with nothing but a sold price
     scored freshness 100 and distance 100, outranked a fully documented one,
     took the largest weight in the working range, and had its why-line say
     "sold recently · same pocket" — facts the user never entered, printed as
     though read off a record. The tell was in the same line: it correctly said
     "size unknown", because size had a real null path and age and distance did
     not.

   · A typed 0 in "sold for" passed the validity check, and then the
     zero-denominator branch gave that row a gross-adjustment of 0 — the best
     possible value — suppressing the exact penalty that would have flagged it.
     It scored 98, was labelled "Best comp", and dragged the one-click ARV. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/desk.html');
let n=0,bad=0;
const ok=(t,p,x)=>{n++; if(!p){bad++;console.log('✗ '+t+(x!==undefined?'  ← '+JSON.stringify(x).slice(0,280):''));}else console.log('✓ '+t);};

const b=await chromium.launch();
const pg=await b.newPage({viewport:{width:1400,height:1100}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,180)));
await pg.goto(FILE); await pg.waitForTimeout(600);

const load = (comps) => pg.evaluate((cs)=>{
  P.props.length = 0; P.props.push(newProp('450 Chestnut St')); P.active = 0; loadInto(0);
  S.subj = { sqft:'1500', beds:'3', baths:'2' };
  S.comps = cs;
  const rows = compRows();
  const range = (typeof compRange === 'function') ? compRange() : null;
  return {
    rows: rows.map(r => ({ name:r.name, ok:r.ok, noPrice:!!r.noPrice, score:r.score,
                           months:r.months, dist:r.dist, why:(r.why||[]).join(' · ') })),
    range: range ? { n: range.n, lo: range.lo ? Math.round(range.lo) : null,
                     hi: range.hi ? Math.round(range.hi) : null,
                     mean: range.mean ? Math.round(range.mean) : null,
                     best: range.best ? range.best.name : null } : null,
  };
}, comps);

/* ── a documented comp must outrank an undocumented one ─────────────────── */
{
  const r = await load([
    { name:'A · fully documented', price:'300000', sqft:'1500', sold:'3',  dist:'0.3', beds:'3', baths:'2' },
    { name:'D · nothing but a price', price:'250000', sqft:'', sold:'',   dist:'',    beds:'',  baths:'' },
  ]);
  const A = r.rows[0], D = r.rows[1];
  console.log('   A ' + A.score + '  ·  D ' + D.score);
  console.log('   D why: ' + D.why);
  ok('the documented comp outranks the undocumented one', A.score > D.score, { A:A.score, D:D.score });
  ok('a blank "months ago" stays unknown, not zero', D.months === null, D);
  ok('a blank "miles away" stays unknown, not zero', D.dist === null, D);
  ok('and it says so rather than claiming freshness', /age unknown/.test(D.why), D.why);
  ok('and rather than claiming the same pocket', /distance unknown/.test(D.why), D.why);
  ok('it never claims "sold recently" about a date nobody gave it',
     !/sold recently/.test(D.why), D.why);
  ok('it never claims "same pocket" about a distance nobody gave it',
     !/same pocket/.test(D.why), D.why);
  ok('the documented one still reads as documented',
     /sold recently/.test(A.why) && /same pocket/.test(A.why), A.why);
}

/* ── a $0 comp is not a sale ─────────────────────────────────────────────── */
{
  const r = await load([
    { name:'A', price:'300000', sqft:'1500', sold:'3', dist:'0.3', beds:'3', baths:'2' },
    { name:'B', price:'296000', sqft:'1480', sold:'4', dist:'0.4', beds:'3', baths:'2' },
    { name:'C', price:'305000', sqft:'1520', sold:'2', dist:'0.2', beds:'3', baths:'2' },
    { name:'Z · price withheld', price:'0', sqft:'1500', sold:'2', dist:'0.2', beds:'3', baths:'2' },
  ]);
  const Z = r.rows[3];
  console.log('   Z: ' + JSON.stringify(Z));
  console.log('   range: ' + JSON.stringify(r.range));
  ok('a $0 comp is not a valid sale', Z.ok === false, Z);
  ok('and is named as a zero rather than as missing', Z.noPrice === true, Z);
  ok('it does not score at all', !Z.score, Z);
  ok('the working range is built from the three real comps', r.range && r.range.n === 3, r.range);
  ok('and lands near what the real comps say',
     r.range && r.range.mean > 280000 && r.range.mean < 330000, r.range);
  ok('the $0 comp is never crowned "Best comp"',
     r.range && !/withheld/.test(String(r.range.best)), r.range);
}

/* ── and the row says which mistake it is ────────────────────────────────── */
{
  const msg = await pg.evaluate(()=>{
    P.props.length = 0; P.props.push(newProp('x')); P.active = 0; loadInto(0);
    S.subj = { sqft:'1500', beds:'3', baths:'2' };
    S.comps = [{ name:'Z', price:'0', sqft:'1500', sold:'2', dist:'0.2' },
               { name:'Y', price:'',  sqft:'1500', sold:'2', dist:'0.2' }];
    /* renderComps writes into whichever container it owns; find it by asking
       the function itself rather than guessing an id */
    if (typeof renderComps === 'function') { try { renderComps(); } catch(e){ return 'ERR '+e.message; } }
    const body = document.body.textContent.replace(/\s+/g,' ');
    return body;
  });
  ok('a $0 row says a house that sold for nothing did not sell',
     !!msg && /sold for nothing did not sell/.test(msg), String(msg).slice(0,220));
  ok('and an empty row still just asks for the price',
     !!msg && /Needs a sold price/.test(msg), String(msg).slice(0,220));
}

ok('no page errors', errs.length===0, errs[0]);
/* ── THE GATE CLOSES FOR UNKNOWNS TOO ───────────────────────────────────────
   The weights learned "unknown is not the best case" and the location GATE
   quietly kept it: `dist <= 0.5` coerces null to 0, so a comp with no
   distance wore the same-pocket multiplier and could outrank a documented
   comp 1.6 miles out. Identical comps, one same-pocket and one undocumented:
   the documented one must win, strictly. */
{
  const r = await pg.evaluate(() => {
    P.props.length = 0; P.props.push(newProp('gate')); P.active = 0; loadInto(0);
    S.subj = { sqft:'1500', beds:'3', baths:'2' };
    const base = { price:'300,000', sqft:'1500', beds:'3', baths:'2', sold:'2', cond:0, use:true };
    S.comps = [ { ...base, id:'a', addr:'same pocket', dist:'0.3' },
                { ...base, id:'b', addr:'no distance', dist:'' },
                { ...base, id:'c', addr:'documented far', dist:'1.6' } ];
    const rows = compRows();
    const by = Object.fromEntries(rows.map(x => [x.addr, x.score]));
    return by;
  });
  ok('a documented same-pocket comp outscores an undocumented one, strictly',
     r['same pocket'] > r['no distance'], r);
  ok('and the undocumented one no longer wears the same-pocket gate',
     r['no distance'] < r['same pocket'] && r['no distance'] <= Math.round(r['same pocket'] * 0.95), r);
}

/* ── A MARKET CAN FALL, AND STAY FALLEN ────────────────────────────────────
   The adjuster parse stripped the minus sign (−4 committed as +4) and the
   loader confiscated a negative on every reload (floor of zero, silently
   back to +3). In a declining metro that adjusted every stale comp UP — the
   wrong direction, in the feature that builds the most important number on
   the sheet. */
{
  const r = await pg.evaluate(() => {
    P.props.length = 0; P.props.push(newProp('fall')); P.active = 0; loadInto(0);
    S.subj = { sqft:'1500', beds:'3', baths:'2' };
    S.compAdj = { market: -4 };
    S.comps = [ { id:'m', addr:'a year old', price:'300,000', sqft:'1500', beds:'3', baths:'2',
                  sold:'12', dist:'0.3', cond:0, use:true } ];
    const row = compRows()[0];
    /* and the loader: run the stored shape through the cleaner the way a
       reload would, and the negative must survive */
    const p2 = cleanProp(JSON.parse(JSON.stringify({ ...P.props[0], compAdj:{ market:-4, bed:-100 } })));
    return { time: row.adj.time, adjusted: row.adjusted,
             keptMarket: p2.compAdj.market, keptBed: p2.compAdj.bed };
  });
  ok('a falling market adjusts a stale comp DOWN', r.time < 0 && r.adjusted < 300000, r);
  ok('by the rate times the age: −4%/yr × 12mo = −$12,000', Math.abs(r.time - (-12000)) < 1, r.time);
  ok('the loader keeps a negative market on reload', r.keptMarket === -4, r);
  ok('but a negative price-per-bedroom is still refused as the typo it is',
     r.keptBed === undefined, r.keptBed);
}

console.log('\n'+(bad? '✗ '+bad+' of '+n+' failed' : '✓ all '+n+' hold'));
await b.close();
process.exit(bad?1:0);
