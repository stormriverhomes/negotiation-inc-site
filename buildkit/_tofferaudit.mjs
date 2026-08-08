/* ══ THE OFFER, AUDITED ═════════════════════════════════════════════════════
   Every other number in this product is advice on a screen. This one leaves
   the building: it is what somebody says out loud to a seller, and what the
   letters print. A wrong figure here does not cost a bad afternoon, it costs
   the deal and the relationship.

   Invariants, across the levers a person actually drags. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve('desk.html');
let n = 0, bad = 0;
const ok = (t, p, x) => { n++; if (!p){ bad++; console.log('✗ ' + t + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0,240) : '')); } else console.log('✓ ' + t); };

const b = await chromium.launch();
const pg = await b.newPage({ viewport:{ width:1400, height:1100 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0,150)));
await pg.goto(FILE);
await pg.waitForFunction(() => typeof offerModel === 'function' && typeof rankedExits === 'function',
  null, { timeout:20000 });

const BASE = { arv:'300000', repairs:'40000', rent:'2200', asking:'240000' };
const offer = (raw = BASE, lev = {}, sit = 'unknown', pick = null) => pg.evaluate(([r, l, s, p]) => {
  P.props.length = 0; P.props.push(newProp('offer')); P.active = 0; loadInto(0);
  S.raw = {}; S.est = {}; S.unc = {}; S.prov = {};
  for (const [k, v] of Object.entries(r)) S.raw[k] = String(v);
  S.sit = s; S.offerExit = p;
  S.lev = Object.assign({ price:null, days:21, em:1, insp:7, credit:0, stay:0 }, l);
  const m = offerModel();
  if (!m) return null;
  return { price:m.price, lo:m.lo, hi:m.hi, room:m.room, yourCost:m.yourCost,
    credit:m.credit, stayCost:m.stayCost, anchor:m.anchor, ask:m.ask,
    exit:m.best && m.best.id, lost:m.lost,
    /* the model returns them under `parts`, and there is a fourth — ease —
       that a probe naming three would have quietly never checked */
    meters: m.parts, score:m.score, reads:m.reads };
}, [raw, lev, sit, pick]);

/* ── 1 · NOTHING THAT LEAVES THE BUILDING IS EVER NaN ─────────────────── */
{
  const dirty = [];
  for (const ask of ['', '0', '1', '240000', '9000000'])
    for (const rep of ['0', '40000', '400000'])
      for (const days of [0, 7, 60, 365]){
        const m = await offer({ ...BASE, asking:ask, repairs:rep }, { days });
        if (!m) continue;
        for (const [k, v] of Object.entries(m)){
          if (k === 'meters' || k === 'exit' || k === 'lost' || k === 'ask') continue;
          if (typeof v !== 'number' || !Number.isFinite(v)) dirty.push({ ask, rep, days, k, v:String(v) });
        }
      }
  ok('numbers: every offer figure across the grid is a finite number', dirty.length === 0, dirty.slice(0,4));
}

/* ── 2 · THE OFFER NEVER OPENS ABOVE WHAT THE EXIT CAN PAY ────────────────
   It used to open at the middle of the AXIS, which stretches to hold the
   asking price — so on a sheet where they are asking far more than the deal
   can carry, three of five demos opened with an offer already over the
   ceiling, under a full page of negotiating advice. */
{
  const bad2 = [];
  for (const ask of ['180000','240000','400000','900000']){
    const m = await offer({ ...BASE, asking:ask });
    if (!m) continue;
    if (m.price > m.hi + 1) bad2.push({ ask, price:m.price, hi:m.hi });
    if (m.price < m.lo - 1) bad2.push({ ask, price:m.price, lo:m.lo, note:'below the band' });
  }
  ok('default: the untouched offer opens inside the buy band, whatever they are asking',
     bad2.length === 0, bad2);
}

/* ── 3 · THE BAND IS A BAND ───────────────────────────────────────────── */
{
  const m = await offer();
  ok('band: the top is above the floor', m.hi > m.lo, m);
  ok('band: and the floor is not negative', m.lo >= 0, m.lo);
}

/* ── 4 · EVERY LEVER COSTS WHAT IT SAYS IT COSTS ──────────────────────────
   These are the sliders somebody drags in front of a seller. A lever that
   moves the room the wrong way is worse than no lever: it teaches the
   opposite of the truth about their own deal. */
{
  const base = await offer();
  const dearer = await offer(BASE, { price: 95 });
  ok('lever: offering more money leaves less room', dearer.room < base.room,
     { base:base.room, dearer:dearer.room });
  const credit = await offer(BASE, { credit: 50 });
  ok('lever: a repair credit costs real money', credit.credit > 0 && credit.room < base.room,
     { credit:credit.credit, room:credit.room, base:base.room });
  const stay = await offer(BASE, { stay: 30 });
  ok('lever: letting them stay costs carry', stay.stayCost > 0 && stay.room < base.room,
     { stayCost:stay.stayCost, room:stay.room });
  const free = await offer(BASE, { credit: 0, stay: 0 });
  ok('lever: and giving nothing away costs nothing',
     free.credit === 0 && free.stayCost === 0, free);
}

/* ── 5 · THE METERS POINT THE RIGHT WAY ───────────────────────────────────
   They are what the seller is told they are getting. A speed meter that does
   not move for a faster close is a lie told with a graphic. */
{
  const slow = await offer(BASE, { days: 60 }), fast = await offer(BASE, { days: 7 });
  ok('meter: a seven-day close reads faster than a sixty-day one',
     fast.meters.speed > slow.meters.speed, { fast:fast.meters.speed, slow:slow.meters.speed });
  /* the old divisor clamped everything under fifteen days to the same value —
     to a seller with an auction date, that is the whole game */
  const d7 = await offer(BASE, { days: 7 }), d14 = await offer(BASE, { days: 14 });
  ok('meter: and every day shaved actually moves it', d7.meters.speed > d14.meters.speed,
     { d7:d7.meters.speed, d14:d14.meters.speed });
  const soft = await offer(BASE, { em: 0, insp: 14 }), hard = await offer(BASE, { em: 3, insp: 0 });
  ok('meter: more earnest and no inspection reads as more certain',
     hard.meters.certainty > soft.meters.certainty,
     { hard:hard.meters.certainty, soft:soft.meters.certainty });
  const cramped = await offer(BASE, { stay: 0 }), roomy = await offer(BASE, { stay: 45 });
  ok('meter: and letting them stay on reads as easier for the seller',
     roomy.meters.ease > cramped.meters.ease, { roomy:roomy.meters.ease, cramped:cramped.meters.ease });
  ok('meter: all four are reported, not three', Object.keys(hard.meters).length === 4,
     Object.keys(hard.meters));
  const all = [d7, slow, soft, hard];
  ok('meter: every meter stays between nothing and everything',
     all.every(m => Object.values(m.meters).every(v => v >= 0 && v <= 1)),
     all.map(m => m.meters));
}

/* ── 6 · A ZERO ASK IS NO ASK, AND THE OFFER SAYS WHICH ───────────────── */
{
  const zero = await offer({ ...BASE, asking:'0' });
  const none = await offer({ ...BASE, asking:'' });
  ok('no ask: a zero reads as no ask at all', zero.ask === null && none.ask === null, { zero:zero.ask, none:none.ask });
  ok('no ask: and the offer anchors on your own ceiling instead',
     zero.anchor === zero.hi && none.anchor === none.hi, { anchor:zero.anchor, hi:zero.hi });
}

/* ── 7 · THE OFFER IS BUILT FOR THE EXIT YOU PICKED ───────────────────────
   The product ranks seven exits and then built the offer for exactly one of
   them, so somebody who decided to do the BRRRR was handed a maximum price
   computed from the flip's ceiling, with nothing on screen saying so. */
{
  const auto = await offer();
  const R = await pg.evaluate(() => rankedExits().priceable.map(x => x.id));
  const other = R.find(id => id !== auto.exit);
  if (other){
    const picked = await offer(BASE, {}, 'unknown', other);
    ok('exit: picking a different exit re-derives the offer from ITS arithmetic',
       picked.exit === other && (picked.hi !== auto.hi || picked.lo !== auto.lo),
       { auto:{ id:auto.exit, hi:auto.hi }, picked:{ id:picked.exit, hi:picked.hi } });
  } else ok('exit: there is more than one priceable exit to pick', false, R);
  /* a pick that stops pricing falls back and SAYS so, rather than silently
     pricing something else */
  const gone = await offer(BASE, {}, 'unknown', 'not-an-exit');
  ok('exit: a pick that no longer prices falls back and admits it', gone.lost === true, gone.lost);
}

/* ── 8 · THE ARITHMETIC ON THE PAGE ADDS UP ───────────────────────────────
   yourCost is what the letters print and what the room is measured from. If
   it ever drifts from price + credit + carry, the document contradicts the
   screen it came from. */
{
  for (const l of [{}, { credit:60, stay:30 }, { price:20 }, { price:99, credit:100, stay:60 }]){
    const m = await offer(BASE, l);
    const sum = m.price + m.credit + m.stayCost;
    ok('adds up: your cost is the price plus what you gave away (' + JSON.stringify(l) + ')',
       Math.abs(m.yourCost - sum) < 1, { yourCost:m.yourCost, sum });
    ok('adds up: and the room is the ceiling less your cost',
       Math.abs(m.room - (m.hi - m.yourCost)) < 1, { room:m.room, calc:m.hi - m.yourCost });
  }
}

/* ── 9 · IT PRICES THE SAME SHEET THE SAME WAY TWICE ──────────────────── */
{
  const a = await offer(), c = await offer();
  ok('determinism: the same sheet produces the same offer twice',
     JSON.stringify(a) === JSON.stringify(c));
}

ok('no page errors', errs.length === 0, [...new Set(errs)]);
await b.close();
console.log('\n' + (bad ? '✗ ' + bad + ' of ' + n + ' failed' : '✓ all ' + n + ' hold'));
process.exit(bad ? 1 : 0);
