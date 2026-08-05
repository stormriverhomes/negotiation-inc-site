/* t-laws — the laws the arithmetic must obey for EVERY house, not just the one
   the fixture happened to pick.

   `desk-verify` recomputes five exits from the published formulae on ONE
   property, to the dollar. That is the most important test in the suite and it
   has a blind spot the size of the input space: a sign error that only shows up
   when repairs exceed ARV, a divide-by-zero on a house with no rent, a band
   that inverts at the edge — none of those are visible from one well-behaved
   sheet, and all of them print a confident number somebody would act on.

   So this asserts PROPERTIES over a grid of hundreds of houses, including
   deliberately absurd ones. A property test does not care what the right answer
   is; it cares that the answer cannot be self-contradictory. The laws:

     L1 · MORE WORK NEVER RAISES WHAT YOU CAN PAY. Repairs up, ceilings
          non-increasing. A violation here is a sign error, and it is the most
          expensive kind: it tells somebody to pay MORE for a worse house.
     L2 · A HOUSE WORTH MORE IS NEVER WORTH LESS. ARV up, ceilings
          non-decreasing.
     L3 · MORE RENT NEVER LOWERS A HOLD. And it never moves a flip or a
          wholesale at all — those do not know what rent is.
     L4 · A BAND HAS ITS ENDS IN ORDER. band[0] <= band[1], always. An inverted
          band prints as "offer between $180,000 and $170,000".
     L5 · A REFUSED EXIT CARRIES NO NUMBER. The refusal is the answer; a price
          beside it is the product arguing with itself.
     L6 · NOTHING IS NaN, Infinity, OR NEGATIVE-ZERO. Every number that can
          reach a screen is finite.
     L7 · "THE MOST ANYBODY COULD PAY FOR THIS HOUSE" NEVER EXCEEDS ARV.
          Written carefully, because the first version of this law was wrong.
          A single exit MAY honestly report a ceiling above ARV: the hold's
          comes from the rent, and at a 1.5%+ rent-to-price ratio — ordinary in
          Atlanta — the DSCR arithmetic really does allow more than the house
          is worth. That is a true statement about the rent.

          What must never happen is that number becoming the answer to "the
          most anybody could pay", because THAT is what `room` is built from
          and what the bulk table ranks on — so an unbounded rent ceiling sends
          somebody driving to the house with the most imaginary headroom.
     L8 · AND WHERE AN EXIT DOES EXCEED ARV, ITS ROW SAYS SO. An honest number
          nobody is warned about is not honesty, it is a licence to overpay.

   The grid is deliberately hostile: zero rent, zero ARV, repairs larger than
   ARV, asking above ARV, a house worth $40,000 and a house worth $4,000,000.
*/
import { chromium } from 'playwright';

const b = await chromium.launch();
const p = await b.newPage({ viewport:{ width:1000, height:1100 } });
const bad = [], errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error' && !/fraunces|ERR_FAILED/.test(m.text())) errs.push(m.text()); });

await p.goto('file:///home/claude/dist/desk.html');
await p.evaluate(() => localStorage.clear());
await p.reload(); await p.waitForTimeout(500);

/* price one house and hand back only what the laws are about */
const priceOne = h => p.evaluate(house => {
  for (const k of ['asking','arv','repairs','rent','balance','piti','arrears']) delete S.raw[k];
  for (const k in house) if (house[k] !== null && house[k] !== undefined) S.raw[k] = String(house[k]);
  const ex = rankExits(), a = vals();
  const t = topCeil({ ex, a });
  return { a, top: t ? { id:t.id, ceil:t.ceil } : null,
    rows: ex.map(x => ({ id:x.id, na:!!x.na, refused:!!x.refused,
      ceil: (typeof x.ceil === 'number') ? x.ceil : null,
      band: Array.isArray(x.band) ? x.band.slice(0,2) : null,
      key:  (typeof x.key === 'number') ? x.key : null,
      fit:  (typeof x.fit === 'number') ? x.fit : null,
      says: String(x.verdict || x.reason || '') })) };
}, h);

const byId = r => Object.fromEntries(r.rows.map(x => [x.id, x]));
const finite = v => v === null || (typeof v === 'number' && Number.isFinite(v));

/* ── the grid ─────────────────────────────────────────────────────────────
   Sane houses, then the edges nobody types on purpose and somebody eventually
   does: a wreck worth less than its own repair bill, a house with no rent, a
   seller asking more than the finished value. */
const ARVS    = [40000, 120000, 291000, 750000, 4000000];
const REPFRAC = [0, 0.02, 0.08, 0.14, 0.35, 0.9, 1.4];
const RENTS   = [0, 600, 1850, 6000];
const ASKFRAC = [0.4, 0.86, 1.2];

let n = 0;
const say = (law, h, msg) => bad.push(`${law}: ${msg}  [arv ${h.arv} · repairs ${h.repairs} · rent ${h.rent} · asking ${h.asking}]`);

/* ══ L4 · L5 · L6 · L7 — true of every single sheet on its own ═══════════ */
const sample = [];
for (const arv of ARVS)
 for (const rf of REPFRAC)
  for (const rent of RENTS)
   for (const af of ASKFRAC){
     const h = { arv, repairs: Math.round(arv*rf), rent, asking: Math.round(arv*af) };
     const r = await priceOne(h); n++;
     if (sample.length < 1) sample.push({ h, top: r.top });
     /* L7 · the headline "most anybody could pay" is bounded by the value */
     if (r.top && arv > 0 && r.top.ceil > arv * 1.0001)
       say('L7', h, `"the most anybody could pay" is ${Math.round(r.top.ceil)} on a house worth ${arv} (from ${r.top.id})`);
     for (const x of r.rows){
       /* L6 · nothing that reaches a screen is NaN or Infinity */
       if (!finite(x.ceil) || !finite(x.key) || !finite(x.fit))
         say('L6', h, `${x.id} produced a number that is not a number`);
       if (x.band && (!finite(x.band[0]) || !finite(x.band[1])))
         say('L6', h, `${x.id} band is not a pair of numbers`);
       /* L4 · a band has its ends in order */
       if (x.band && x.band[0] > x.band[1])
         say('L4', h, `${x.id} band is inverted: ${Math.round(x.band[0])} → ${Math.round(x.band[1])}`);
       /* L5 · a refusal is the answer; a price beside it is self-contradiction */
       if (x.refused && (x.ceil !== null || x.key !== null || x.band))
         say('L5', h, `${x.id} refused and priced anyway`);
       /* L8 · a row allowed to exceed ARV must say so in its own words */
       if (!x.na && x.ceil !== null && arv > 0 && x.ceil > arv * 1.0001
           && !/more than|above|worth finished|underwater/i.test(x.says))
         say('L8', h, `${x.id} allows ${Math.round(x.ceil)} on a house worth ${arv} and never mentions it`);
     }
   }

/* ══ L1 · more work never raises what you can pay ════════════════════════ */
const CEIL_EXITS = ['wholesale','flip','hold','brrrr','wholetail'];
for (const arv of ARVS)
 for (const rent of [0, 1850]){
   let prev = null;
   for (const rf of REPFRAC){
     const h = { arv, repairs: Math.round(arv*rf), rent, asking: Math.round(arv*0.86) };
     const cur = byId(await priceOne(h)); n++;
     if (prev){
       for (const id of CEIL_EXITS){
         const a = prev[id], c = cur[id];
         if (!a || !c || a.ceil === null || c.ceil === null) continue;
         /* a dollar of slack for float noise; anything real is far larger */
         if (c.ceil > a.ceil + 1)
           say('L1', h, `${id} pays MORE as repairs rise: ${Math.round(a.ceil)} → ${Math.round(c.ceil)}`);
       }
     }
     prev = cur;
   }
 }

/* ══ L2 · a house worth more is never worth less ═════════════════════════ */
for (const rf of [0, 0.08, 0.35])
 for (const rent of [0, 1850]){
   let prev = null;
   for (const arv of ARVS){
     const h = { arv, repairs: Math.round(arv*rf), rent, asking: Math.round(arv*0.86) };
     const cur = byId(await priceOne(h)); n++;
     if (prev){
       for (const id of CEIL_EXITS){
         const a = prev[id], c = cur[id];
         if (!a || !c || a.ceil === null || c.ceil === null) continue;
         if (c.ceil < a.ceil - 1)
           say('L2', h, `${id} pays LESS for a more valuable house: ${Math.round(a.ceil)} → ${Math.round(c.ceil)}`);
       }
     }
     prev = cur;
   }
 }

/* ══ L3 · more rent never lowers a hold, and never moves a flip ══════════ */
{
  const RENT_BLIND = ['wholesale','flip','wholetail'];
  for (const arv of ARVS)
   for (const rf of [0.02, 0.14]){
     let prev = null;
     for (const rent of RENTS){
       const h = { arv, repairs: Math.round(arv*rf), rent, asking: Math.round(arv*0.86) };
       const cur = byId(await priceOne(h)); n++;
       if (prev){
         for (const id of ['hold','brrrr']){
           const a = prev[id], c = cur[id];
           if (!a || !c || a.ceil === null || c.ceil === null) continue;
           if (c.ceil < a.ceil - 1)
             say('L3', h, `${id} pays LESS as rent rises: ${Math.round(a.ceil)} → ${Math.round(c.ceil)}`);
         }
         for (const id of RENT_BLIND){
           const a = prev[id], c = cur[id];
           if (!a || !c || a.ceil === null || c.ceil === null) continue;
           if (Math.abs(c.ceil - a.ceil) > 1)
             say('L3', h, `${id} moved when only the rent changed: ${Math.round(a.ceil)} → ${Math.round(c.ceil)}`);
         }
       }
       prev = cur;
     }
   }
}

if (errs.length) bad.push('the page threw while pricing: ' + errs[0]);

await b.close();
console.log(JSON.stringify({ housesPriced: n, sample: sample[0], errs }, null, 1));
if (bad.length){
  console.log('FAIL');
  /* the same law broken on three hundred houses is one bug, so report it once */
  const seen = new Set();
  for (const x of bad){ const k = x.slice(0, x.indexOf('[')); if (seen.has(k)) continue; seen.add(k); console.log(' - ' + x); }
  console.log(` (${bad.length} violations across ${n} houses, ${seen.size} distinct)`);
  process.exit(1);
}
console.log(`PASS — ${n} houses, including wrecks worth less than their repair bill and houses with no rent: more work never raises what you can pay, a better house is never worth less, rent never moves a flip, no band inverts, no refusal carries a price, "the most anybody could pay" never exceeds the finished value, and any single exit that does say so in its own words`);
