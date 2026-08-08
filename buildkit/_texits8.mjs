/* ══ THE EXITS, AUDITED ═════════════════════════════════════════════════════
   exitsFor() is the engine every figure on this sheet descends from, and what
   it produces is what somebody offers on a house. desk-verify already
   recomputes five exits from the outside and matches them to the dollar, which
   catches an arithmetic slip. It cannot catch the other kind: an answer that
   is internally consistent and still absurd.

   So this file asserts INVARIANTS across a grid of inputs rather than checking
   worked examples. An invariant is what must be true of EVERY answer, which is
   how you find the bug nobody thought to write a case for — and how the comp
   workbench was audited last week. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve('desk.html');
let n = 0, bad = 0;
const ok = (t, p, x) => { n++; if (!p){ bad++; console.log('✗ ' + t + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0,240) : '')); } else console.log('✓ ' + t); };

const b = await chromium.launch();
const pg = await b.newPage({ viewport:{ width:1400, height:1100 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0,150)));
await pg.goto(FILE);
await pg.waitForFunction(() => typeof exitsFor === 'function' && typeof vals === 'function',
  null, { timeout:20000 });

/* price a sheet and hand back only what an invariant can be stated about */
const price = (raw, est = {}, adv = null) => pg.evaluate(([r, e, v]) => {
  P.props.length = 0; P.props.push(newProp('audit')); P.active = 0; loadInto(0);
  S.raw = {}; S.est = {}; S.prov = {}; S.unc = {};
  for (const [k, val] of Object.entries(r)) S.raw[k] = String(val);
  for (const k of Object.keys(e)) { S.est[k] = true; S.unc[k] = 0.15; }
  if (v) Object.assign(S.adv, v);
  if (r.balance || r.piti || r.arrears) S.mode = 'advanced';
  const X = exitsFor();
  return X.map(x => ({ id:x.id, na:!!x.na, refused:!!x.refused, key:x.key, ceil:x.ceil,
    band:x.band, band0:x.band0, e:!!x.e, w:x.w, miss:x.missFields || null,
    verdict: typeof x.verdict === 'string' ? x.verdict.slice(0,420) : null }));
}, [raw, est, adv]);

const BASE = { arv:'300000', repairs:'40000', rent:'2200', asking:'180000' };
const by = (X, id) => X.find(x => x.id === id);
const NUMS = x => [x.key, x.ceil, ...(x.band || []), ...(x.band0 || [])].filter(v => v !== null && v !== undefined);

/* ── 1 · NOTHING IS EVER NaN, INFINITE, OR A STRING PRETENDING ────────────
   A NaN on this sheet is the worst outcome available: it propagates into a
   ceiling, prints as "$NaN" beside real money, and every downstream panel
   inherits it. Swept across a grid rather than spot-checked. */
{
  const grid = [];
  for (const arv of ['0','1','60000','300000','9000000'])
    for (const rep of ['0','1','40000','299999','5000000'])
      for (const ask of ['','0','1','180000','9000000'])
        grid.push({ arv, repairs:rep, rent:'2200', asking:ask });
  let dirty = [], seen = 0;
  for (const g of grid){
    const X = await price(g);
    for (const x of X){
      for (const v of NUMS(x)){
        seen++;
        if (typeof v !== 'number' || !Number.isFinite(v))
          dirty.push({ g, id:x.id, v: String(v) });
      }
    }
  }
  ok('numbers: every figure across ' + grid.length + ' sheets is a finite number ('
     + seen + ' figures)', dirty.length === 0, dirty.slice(0,4));
}

/* ── 2 · MORE REPAIRS NEVER RAISES WHAT YOU CAN PAY ───────────────────────
   The single most consequential direction in the product. A sign error here
   would make a wreck look cheaper to buy than a clean house, and it would look
   entirely plausible on screen. */
{
  const lo = await price({ ...BASE, repairs:'20000' });
  const hi = await price({ ...BASE, repairs:'90000' });
  const wrong = [];
  for (const x of lo){
    const y = by(hi, x.id); if (!y) continue;
    if (typeof x.ceil === 'number' && typeof y.ceil === 'number' && y.ceil > x.ceil + 0.5)
      wrong.push({ id:x.id, at20k:x.ceil, at90k:y.ceil });
  }
  ok('repairs: no exit lets you pay MORE for a house that needs more work', wrong.length === 0, wrong);
}

/* ── 3 · A HIGHER ARV NEVER LOWERS WHAT YOU CAN PAY ───────────────────── */
{
  const lo = await price({ ...BASE, arv:'250000' });
  const hi = await price({ ...BASE, arv:'400000' });
  const wrong = [];
  for (const x of lo){
    const y = by(hi, x.id); if (!y) continue;
    if (typeof x.ceil === 'number' && typeof y.ceil === 'number' && y.ceil < x.ceil - 0.5)
      wrong.push({ id:x.id, at250k:x.ceil, at400k:y.ceil });
  }
  ok('arv: no exit pays less for a house that is worth more', wrong.length === 0, wrong);
}

/* ── 4 · NOBODY MAY PAY MORE THAN THE HOUSE IS WORTH ──────────────────────
   Every buying exit's ceiling has to sit under the ARV. An exit that says pay
   $320,000 for a $300,000 house has stopped being an exit. */
{
  const over = [];
  for (const rep of ['0','5000','40000'])
    for (const arv of ['120000','300000','800000']){
      const X = await price({ ...BASE, arv, repairs:rep });
      for (const x of X){
        if (typeof x.ceil !== 'number' || x.ceil <= Number(arv)) continue;
        /* THE HOLD IS THE ONE LEGITIMATE EXCEPTION and it is not an exception
           to the promise, only to the arithmetic: its ceiling is what the RENT
           services, which on a high-yield house genuinely exceeds the value.
           What it may never do is present that as permission — so where it
           passes the ARV, the verdict has to say so in the same breath. */
        if (x.id === 'hold'){
          if (!/more than|all-in at/i.test(x.verdict || ''))
            over.push({ id:x.id, arv, ceil:x.ceil, note:'rent-ceiling above ARV with no warning' });
          continue;
        }
        over.push({ id:x.id, arv, repairs:rep, ceil:x.ceil });
      }
    }
  ok('ceiling: no exit pays more than the house is worth, and the rent-ceiling that can '
     + 'says so out loud', over.length === 0, over.slice(0,4));

  /* ── THE CEILING THAT HAS NOT PAID FOR THE WORK ────────────────────────
     Every other exit nets repairs out of "the most you can pay for it". The
     hold cannot — and it wore the same six words in silence, so a wreck and a
     pristine house returned the identical figure while the rail ranked them
     against exits that HAD paid for the roof. */
  {
    const clean = await price({ ...BASE, arv:'300000', repairs:'0' });
    const wreck = await price({ ...BASE, arv:'300000', repairs:'150000' });
    const hc = by(clean,'hold'), hw = by(wreck,'hold');
    ok('hold: repairs genuinely do not move the rent ceiling — that is the arithmetic',
       hc && hw && Math.abs(hc.ceil - hw.ceil) < 1);
    ok('hold: so when the work would put you over the ARV, it says the all-in figure',
       /all-in at/.test((hw && hw.verdict) || ''), hw && hw.verdict);
    ok('hold: and says it is not comparable to the others at face value',
       /not comparable/.test((hw && hw.verdict) || ''));
    ok('hold: a house needing nothing keeps the plain verdict',
       !/all-in at/.test((hc && hc.verdict) || ''));
  }
}

/* ── 5 · A REFUSAL NAMES WHAT IT NEEDS, AND THE NEED IS REAL ──────────────
   "The sheet does not invent what you did not give it" is the promise. A
   refusal that names a field the person HAS filled is the sheet lying about
   its own state. */
{
  const X = await price({ arv:'300000' });                     // repairs, rent, ask all missing
  const named = X.filter(x => x.na && x.miss);
  ok('refusal: the unpriceable exits say what they need', named.length >= 3, named.map(x=>x.id));
  const v = await pg.evaluate(() => vals());
  const lying = named.filter(x => x.miss.some(f => v[f] !== null));
  ok('refusal: and every field it names is genuinely missing', lying.length === 0, lying);
  const ranked = X.filter(x => x.na && x.key !== null && x.key !== undefined);
  ok('refusal: a refused exit carries no key figure to be ranked on', ranked.length === 0, ranked);
}

/* ── 6 · AN ESTIMATE WIDENS THE ANSWER, NEVER NARROWS IT ─────────────────
   The whole grammar rests on this: marking a figure an estimate must cost
   confidence. If it ever tightened a band, the sheet would be rewarding a
   guess. */
{
  /* every exit is estimated on the figures IT uses — the hold is priced off
     rent and does not read arv or repairs, so marking those would prove
     nothing about it */
  const firm = await price(BASE);
  const soft = await price(BASE, { arv:true, repairs:true, rent:true });
  const wrong = [];
  for (const x of firm){
    const y = by(soft, x.id); if (!y || !x.band || !y.band) continue;
    const wf = x.band[1] - x.band[0], ws = y.band[1] - y.band[0];
    if (ws < wf - 0.5) wrong.push({ id:x.id, firm:wf, estimated:ws });
    if (!y.e) wrong.push({ id:x.id, note:'estimate flag did not reach the exit' });
  }
  ok('estimates: marking a figure an estimate widens every band it touches', wrong.length === 0, wrong);
}

/* ── 7 · A ZERO ASK IS NO ASK, EVERYWHERE ─────────────────────────────────
   A house is not sold for nothing, so a 0 in the asking box is a stray
   keystroke. Read literally it produced a novation cheque sized as though the
   seller were giving the house away — and that fantasy ranked above every real
   exit on the sheet. */
{
  const zero = await price({ ...BASE, asking:'0' });
  const none = await price({ ...BASE, asking:'' });
  ok('zero ask: reads exactly the same as no ask at all',
     JSON.stringify(zero) === JSON.stringify(none), { zero: zero.length, none: none.length });
  const nov = by(zero, 'novation');
  ok('zero ask: the novation does not price a cheque against nothing',
     !nov || nov.na === true || nov.key === null, nov);
}

/* ── 8 · AN OFFER BAND THAT IS NOT AN OFFER MUST REFUSE ───────────────────
   A band whose top is at or below zero is not a cautious offer, it is no
   offer. Shipping it as a number let it be ranked. */
{
  const X = await price({ arv:'90000', repairs:'85000', rent:'600', asking:'80000' });
  const nonsense = X.filter(x => x.band && x.band[1] <= 0 && !x.refused && !x.na);
  ok('impossible: a band topping out at or below zero refuses rather than offering',
     nonsense.length === 0, nonsense);
  const negKey = X.filter(x => typeof x.key === 'number' && x.key > 0 && typeof x.ceil === 'number' && x.ceil <= 0);
  ok('impossible: and no exit reports a profit on a ceiling of nothing', negKey.length === 0, negKey);
}

/* ── 9 · THE SAME SHEET PRICES THE SAME WAY TWICE ─────────────────────────
   Determinism is not obvious in a file this size — one Math.random or one
   Date.now in a pricing path and two people comparing screens see two answers
   for the same house. */
{
  const a = await price(BASE), c = await price(BASE);
  ok('determinism: the same sheet gives the same eight answers twice',
     JSON.stringify(a) === JSON.stringify(c));
}

/* ── 10 · THE ASSUMPTIONS MOVE THE RIGHT WAY ──────────────────────────────
   Seven assumptions the person can drag. Each has a direction it must move
   the answer in, and a slider that moves it the wrong way is worse than no
   slider — it teaches the opposite of the truth. */
{
  const base = await price(BASE);
  const pricier = await price(BASE, {}, { sell: 14 });        // costs more to sell
  const flip0 = by(base,'flip'), flip1 = by(pricier,'flip');
  ok('assumptions: a higher cost of sale lowers what a flip can pay',
     !flip0 || !flip1 || flip1.ceil < flip0.ceil, { base:flip0 && flip0.ceil, pricier:flip1 && flip1.ceil });
  const longer = await price(BASE, {}, { hold: 12 });
  const f2 = by(longer,'flip');
  ok('assumptions: holding it longer lowers what a flip can pay',
     !flip0 || !f2 || f2.ceil < flip0.ceil, { base:flip0 && flip0.ceil, longer:f2 && f2.ceil });
}

/* ══ AND THE NUMBER THE PAGES SAY OUT LOUD ═════════════════════════════════
   The landing page said three different numbers for one fact inside a single
   screen: the headline said EIGHT ways out, the exits band listed EIGHT tiles,
   and the section between them was headed "SIX prices, not one" above a
   sentence naming SEVEN. The list was right; the word was a leftover from a
   version of this product with fewer exits, and nothing was comparing a number
   written in prose to the number the engine actually produces.

   That is the whole class of bug: a count in copy is a claim about the
   software, and copy does not throw. Two counts are the truth — how many the
   engine prices for a house (seven; the eighth is the Land Desk, because a
   parcel is not a house) and how many exist at all (eight). Every number word
   the marketing pages write about exits has to be one of those two. */
{
  const WORD = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };
  /* how many exits the engine CONSIDERS for a house — not how many priced on
     one sheet. On any given sheet several refuse for want of a number, which
     is the product working; the claim in the copy is about the catalogue. */
  const priced = (await price(BASE)).length;
  const pg2 = await b.newPage({ viewport:{ width:1400, height:1100 } });
  await pg2.goto('file://' + path.resolve('dist/index.html'));
  await pg2.waitForTimeout(400);
  const tiles = await pg2.evaluate(() => document.querySelectorAll('.ex8').length);
  ok('the landing page lists every exit there is', tiles === 8, tiles);
  ok('and the engine prices the ones a house can take', priced >= 5 && priced <= 7, priced);

  const PAGES = ['dist/index.html', 'dist/plans.html', 'dist/exits.html'];
  for (const f of PAGES){
    await pg2.goto('file://' + path.resolve(f)); await pg2.waitForTimeout(400);
    const t = await pg2.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    /* every "<number> prices | exits | ways out" the page says, in words or
       digits — the two shapes a person actually writes */
    const said = [...t.matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(prices|exits|ways out)\b/gi)]
      .map(m => ({ phrase: m[0], n: WORD[m[1].toLowerCase()] ?? Number(m[1]) }));
    for (const s of said)
      ok(`${f.split('/').pop()}: "${s.phrase}" is a number the software can back`,
         s.n === 8 || s.n === 7, { said: s.n, exist: 8, pricedForAHouse: 7 });
  }
  /* and the one that was actually wrong: a heading naming a count, directly
     above a list, must agree with the list under it */
  await pg2.goto('file://' + path.resolve('dist/index.html')); await pg2.waitForTimeout(300);
  const pair = await pg2.evaluate(() => {
    const h = [...document.querySelectorAll('h3')].find(x => /prices, not one/i.test(x.textContent));
    if (!h) return null;
    const p = h.nextElementSibling;
    const first = (p ? p.textContent : '').split(/\.\s/)[0];
    return { head: h.textContent.trim(), listed: first.split(',').length };
  });
  ok('the "N prices, not one" heading exists to be checked', !!pair, pair);
  if (pair) ok('and its number matches the list directly under it',
    (WORD[pair.head.trim().split(/\s+/)[0].toLowerCase()] || 0) === pair.listed, pair);
  await pg2.close();
}

ok('no page errors', errs.length === 0, [...new Set(errs)]);
await b.close();
console.log('\n' + (bad ? '✗ ' + bad + ' of ' + n + ' failed' : '✓ all ' + n + ' hold'));
process.exit(bad ? 1 : 0);
