/* ══ THE COMP WORKBENCH, AUDITED ═══════════════════════════════════════════
   The workbench builds the ARV, the ARV builds every ceiling, and every
   ceiling is what somebody offers on a house. It is the highest-consequence
   arithmetic in the product and it has never had an audit of its own — the
   existing harnesses check the wall and the demo, not the scoring.

   These are INVARIANTS, not worked examples. A worked example pins one answer;
   an invariant says what must be true of every answer, which is what catches
   the bug nobody thought to write a case for. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve('desk.html');
let n = 0, bad = 0;
const ok = (t, p, x) => { n++; if (!p){ bad++; console.log('✗ ' + t + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0,220) : '')); } else console.log('✓ ' + t); };

const b = await chromium.launch();
const pg = await b.newPage({ viewport:{ width:1400, height:1100 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0,160)));
await pg.goto(FILE);
await pg.waitForFunction(() => typeof compRows === 'function' && typeof compRange === 'function',
  null, { timeout:20000 });

/* drive the engine directly: subject, comps, adjustment rates in, rows out */
const run = (comps, subj = { sqft:'1500', beds:'3', baths:'2' }, adj = null) =>
  pg.evaluate(([c, s, a]) => {
    S.comps = c; S.subj = s; S.compAdj = a || {};
    const rows = compRows(), R = compRange();
    return { rows: rows.map(r => ({ addr:r.addr, ok:r.ok, noPrice:r.noPrice, score:r.score,
               adjusted:r.adjusted, adj:r.adj, why:r.why, grossPc:r.grossPc })),
             R: { n:R.n, mean:R.mean, sd:R.sd, lo:R.lo, hi:R.hi, min:R.min, max:R.max,
                  best: R.best ? { addr:R.best.addr, score:R.best.score } : null } };
  }, [comps, subj, adj]);

const C = (o = {}) => ({ id:'c'+Math.random().toString(36).slice(2,7), addr:o.addr||'x', price:o.price||'300000',
  sqft:o.sqft||'1500', beds:o.beds||'3', baths:o.baths||'2', sold:o.sold??'2', dist:o.dist??'0.2',
  cond:o.cond??0, use:o.use!==false });

/* ── 1 · MONOTONICITY. The three things that make a comp better must each
      make its score higher, holding everything else equal. ─────────────── */
{
  const r = await run([ C({addr:'fresh', sold:'1'}), C({addr:'stale', sold:'11'}) ]);
  const s = k => r.rows.find(x => x.addr === k).score;
  ok('score: a recent sale outranks a stale one', s('fresh') > s('stale'), { fresh:s('fresh'), stale:s('stale') });
}
{
  const r = await run([ C({addr:'near', dist:'0.1'}), C({addr:'far', dist:'1.8'}) ]);
  const s = k => r.rows.find(x => x.addr === k).score;
  ok('score: a nearby sale outranks a distant one', s('near') > s('far'), { near:s('near'), far:s('far') });
}
{
  const r = await run([ C({addr:'same', sqft:'1500'}), C({addr:'odd', sqft:'2600'}) ]);
  const s = k => r.rows.find(x => x.addr === k).score;
  ok('score: a similar-size sale outranks a very different one', s('same') > s('odd'), { same:s('same'), odd:s('odd') });
}

/* ── 2 · AN UNKNOWN IS NEVER THE BEST CASE ─────────────────────────────────
   This has been shipped wrong twice in this file — once in the weights and
   once in the distance gate — so it gets the loudest test in the audit. */
{
  const r = await run([
    C({ addr:'documented', sold:'2', dist:'0.2' }),
    C({ addr:'bare', sold:'', dist:'' }),
  ]);
  const s = k => r.rows.find(x => x.addr === k).score;
  ok('unknown: a documented comp outranks one with no age and no distance',
     s('documented') > s('bare'), { documented:s('documented'), bare:s('bare') });
  const w = r.rows.find(x => x.addr === 'bare').why.join(' · ');
  ok('unknown: and the why-line SAYS unknown rather than inventing facts',
     /age unknown/.test(w) && /distance unknown/.test(w), w);
  ok('unknown: it never claims "sold recently" or "same pocket"',
     !/sold recently|same pocket/.test(w), w);
}

/* ── 3 · A HOUSE THAT SOLD FOR NOTHING DID NOT SELL ───────────────────── */
{
  const r = await run([ C({addr:'real'}), C({addr:'zero', price:'0'}) ]);
  const z = r.rows.find(x => x.addr === 'zero');
  ok('zero: a sold-for-nothing row scores zero', z.score === 0, z.score);
  ok('zero: and is marked as a price problem, not a missing one', z.noPrice === true && z.ok === false, z);
  ok('zero: and never reaches the range', r.R.n === 1, r.R.n);
}

/* ── 4 · THE BAND MAY NOT CLAIM SUPPORT THE COMPS DO NOT GIVE ───────────
   A weighted standard deviation can reach past the highest sale when the
   weights concentrate. A range claiming support above every comp in the set
   is the quiet overreach this whole product exists to refuse. */
{
  for (const set of [
    [ C({price:'250000'}), C({price:'260000'}), C({price:'900000', dist:'1.9', sold:'23'}) ],
    [ C({price:'300000'}), C({price:'301000'}) ],
    [ C({price:'120000', sqft:'800'}), C({price:'480000', sqft:'2600'}), C({price:'300000'}) ],
  ]){
    const r = await run(set);
    ok('band: never below the lowest comp (' + set.length + ' comps)', r.R.lo >= r.R.min - 0.5, r.R);
    ok('band: never above the highest comp (' + set.length + ' comps)', r.R.hi <= r.R.max + 0.5, r.R);
    ok('band: the weighted middle sits inside the comps (' + set.length + ')',
       r.R.mean >= r.R.min - 0.5 && r.R.mean <= r.R.max + 0.5, r.R);
    ok('band: lo is not above hi (' + set.length + ')', r.R.lo <= r.R.hi, r.R);
  }
}

/* ── 5 · THE ADJUSTMENTS POINT THE RIGHT WAY ───────────────────────────
   Direction errors are silent and they move the most important number on the
   sheet. The market rate one has shipped wrong before — a stripped minus sign
   adjusted every stale comp UP in a falling market. */
{
  const rise = await run([ C({addr:'old', sold:'12'}) ], undefined, { market:6 });
  const fall = await run([ C({addr:'old', sold:'12'}) ], undefined, { market:-6 });
  ok('time: in a rising market a year-old sale adjusts UP',
     rise.rows[0].adj.time > 0, rise.rows[0].adj.time);
  ok('time: in a FALLING market it adjusts DOWN',
     fall.rows[0].adj.time < 0, fall.rows[0].adj.time);
  ok('time: a sale from today is not adjusted for time',
     (await run([ C({sold:'0'}) ])).rows[0].adj.time === 0);
}
{
  const big = await run([ C({addr:'small', sqft:'1200'}) ], { sqft:'1800', beds:'3', baths:'2' });
  const sml = await run([ C({addr:'big',   sqft:'2400'}) ], { sqft:'1800', beds:'3', baths:'2' });
  ok('size: a comp SMALLER than the subject adjusts up toward it', big.rows[0].adj.size > 0, big.rows[0].adj.size);
  ok('size: a comp BIGGER than the subject adjusts down toward it', sml.rows[0].adj.size < 0, sml.rows[0].adj.size);
  const nb = await run([ C({addr:'nobeds', beds:''}) ]);
  ok('beds: an unknown bed count adjusts by nothing rather than by the subject',
     nb.rows[0].adj.beds === 0, nb.rows[0].adj.beds);
}

/* ── 6 · UNTICKED COMPS ARE OUT OF EVERYTHING ─────────────────────────── */
{
  /* one used comp is deliberately NOT a range — "a data point, not a range" —
     so the untick test needs three, or it is testing the early return */
  const r = await run([ C({addr:'in1', price:'300000'}), C({addr:'in2', price:'310000'}),
                        C({addr:'out', price:'900000', use:false}) ]);
  ok('use: an unticked comp is not in the range', r.R.n === 2, r.R.n);
  const used = r.rows.filter(x => x.addr !== 'out').map(x => x.adjusted);
  ok('use: and does not drag the max', Math.abs(r.R.max - Math.max(...used)) < 1,
     { max:r.R.max, used });
  ok('use: nor the band', r.R.hi <= Math.max(...used) + 0.5, r.R);
  /* and it is still DRAWN, because an unticked comp you can see is one you can
     put back — a comp that vanishes when you untick it reads as deleted */
  /* run() drives the engine without painting; open the bench and draw before
     asking the DOM anything */
  const shown = await pg.evaluate(() => { S.compOpen = true; save(); render();
    return document.querySelectorAll('#cw .comp').length; });
  ok('use: an unticked comp is still on screen, not deleted', shown >= 3, shown);
}
/* a single used comp: the one case the range refuses, on purpose */
{
  const r = await run([ C({addr:'only'}), C({addr:'off', use:false}) ]);
  ok('use: one used comp is a data point, not a range', r.R.n === 1 && r.R.mean === undefined, r.R);
}

/* ── 7 · THE BEST COMP IS THE BEST COMP ───────────────────────────────── */
{
  const r = await run([ C({addr:'meh', sold:'14', dist:'1.7'}), C({addr:'good', sold:'1', dist:'0.1'}) ]);
  ok('best: the named best comp is the highest-scoring used comp',
     r.R.best && r.R.best.addr === 'good', r.R.best);
}

/* ══ THE VISUALIZER ════════════════════════════════════════════════════════
   He uses this to read the answer, so its geometry has to be honest: a dot
   whose position does not match its value is a chart that lies. */
{
  const geo = await pg.evaluate(() => {
    S.comps = [
      { id:'a', addr:'A', price:'250000', sqft:'1500', beds:'3', baths:'2', sold:'2', dist:'0.2', cond:0, use:true },
      { id:'b', addr:'B', price:'310000', sqft:'1600', beds:'3', baths:'2', sold:'4', dist:'0.6', cond:0, use:true },
      { id:'c', addr:'C', price:'285000', sqft:'1520', beds:'3', baths:'2', sold:'9', dist:'1.2', cond:0, use:true },
    ];
    S.subj = { sqft:'1500', beds:'3', baths:'2' };
    S.compAdj = {}; S.compOpen = true; S.raw.arv = '';
    save(); render();
    const box = document.getElementById('cw');
    const track = box.querySelector('.rtrack');
    const dots = [...box.querySelectorAll('.rtrack .dot')].map(d => parseFloat(d.style.left));
    const band = box.querySelector('.rtrack .band');
    const R = compRange();
    return { dots, hasTrack: !!track,
      bandLeft: band ? parseFloat(band.style.left) : null,
      bandWidth: band ? parseFloat(band.style.width) : null,
      R:{ lo:R.lo, hi:R.hi, min:R.min, max:R.max, n:R.n },
      foot: (box.querySelector('.rfoot')||{innerText:''}).innerText.replace(/\s+/g,' '),
      big: (box.querySelector('.range .big')||{innerText:''}).innerText };
  });
  const V = 'viz';
  ok(V+': the track is drawn', geo.hasTrack);
  ok(V+': one dot per comp', geo.dots.length === 3, geo.dots);
  ok(V+': every dot is on the track, not off the end',
     geo.dots.every(d => d >= 0 && d <= 100), geo.dots);
  ok(V+': the dots are distinct — three comps are not one dot',
     new Set(geo.dots.map(d => d.toFixed(1))).size === 3, geo.dots);
  ok(V+': the band starts on the track and does not run off it',
     geo.bandLeft >= 0 && geo.bandLeft + geo.bandWidth <= 100.5,
     { l:geo.bandLeft, w:geo.bandWidth });
  ok(V+': the band is drawn in the right place — it opens after the lowest dot',
     geo.bandLeft >= Math.min(...geo.dots) - 0.5, { band:geo.bandLeft, dots:geo.dots });
  ok(V+': the printed range matches the computed one',
     geo.big.replace(/[^0-9]/g,'').includes(String(Math.round(geo.R.lo))) ||
     geo.big.includes(Math.round(geo.R.lo).toLocaleString('en-US')), geo.big);
  ok(V+': the footer names the true min and max',
     geo.foot.includes(Math.round(geo.R.min).toLocaleString('en-US'))
     && geo.foot.includes(Math.round(geo.R.max).toLocaleString('en-US')), geo.foot);
}

/* the ARV marker: it must sit where the number is, and say so when the number
   is outside what the comps support */
{
  const at = async v => pg.evaluate(x => {
    S.raw.arv = x; save(); render();
    const box = document.getElementById('cw');
    const mid = box.querySelector('.rtrack .mid');
    return { left: mid ? parseFloat(mid.style.left) : null,
             say: (box.querySelector('.setarv .why')||{innerText:''}).innerText.replace(/\s+/g,' ') };
  }, v);
  const R = await pg.evaluate(() => { const r = compRange(); return { lo:r.lo, hi:r.hi, min:r.min, max:r.max }; });
  const inside = await at(String(Math.round((R.lo + R.hi) / 2)));
  ok('viz: an ARV inside the band is marked on the track', inside.left !== null && inside.left >= 0 && inside.left <= 100);
  ok('viz: and says it is supported', /Inside the band/i.test(inside.say), inside.say.slice(0,90));
  const over = await at(String(Math.round(R.max + 90000)));
  ok('viz: an ARV above every comp is still drawn, clamped to the track',
     over.left !== null && over.left <= 100, over.left);
  ok('viz: and says by how much it is unsupported',
     /Outside the band/i.test(over.say) && /above/.test(over.say), over.say.slice(0,110));
  const under = await at(String(Math.max(1000, Math.round(R.min - 90000))));
  ok('viz: below every comp it says below', /Outside the band/i.test(under.say) && /below/.test(under.say), under.say.slice(0,110));
}

ok('no page errors', errs.length === 0, errs);
await b.close();
console.log('\n' + (bad ? '✗ ' + bad + ' of ' + n + ' failed' : '✓ all ' + n + ' hold'));
process.exit(bad ? 1 : 0);
