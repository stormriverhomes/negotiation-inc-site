/* ══ THE LAND ENGINE ════════════════════════════════════════════════════════
   The eighth exit's arithmetic. The desk prices seven ways to buy a house and
   refuses the land play with "it needs dirt" — this is the room that refusal
   sends you to, and this file is the room's arithmetic. No DOM, no fetch, no
   model: pure functions, so the same figures can be tested here, inlined into
   land.html by publish.mjs, and handed to the street brief and the other side
   of the table as precomputed facts. The play it prices, v1:

       BUY THE PARCEL · FINISH THE LOT · SELL THE LOT

   (Build-and-sell and hold-for-path are later verses. They reuse this spine.)

   ── THE SPINE ─────────────────────────────────────────────────────────────
       clears  = finished − ask − siteCarry − saleCost
       ceiling = finished − siteCarry − saleCost − target
   Same grammar as the flip: one honest subtraction, printed with the working,
   and a ceiling that answers the only question a buyer actually has — "what
   is the most I can pay and still have this be worth doing?"

   ── PROVENANCE, SAME THREE WORDS ──────────────────────────────────────────
   Every input arrives as {v, prov} where prov is 'entered' or 'estimate'.
   A missing figure is not zero, it is MISSING, and what it does depends on
   which figure it is: no finished-lot value refuses the whole play (that is
   the ARV of dirt — nothing prices without it); no asking price still prices
   the ceiling (you are the one naming a number); unknown utilities price
   PROVISIONALLY with a named allowance inside site work and a "before this
   prices firm" entry, because "we assumed a septic and said so" is honest and
   "TBD" is a shrug. */

/* ── the constants, with their reasoning attached ──────────────────────────
   SALE_PCT   7% — listing commission plus seller-side closing on a lot sale.
              The design mock uses it; it is also the number the desk's flip
              uses for cost-of-sale, so the two rooms cannot quietly disagree.
   REACH_GAP  0.15 — the same line the desk draws: five to fifteen under ask
              is a conversation, past that you are waiting for a different
              seller. One constant SHARED across products is the point.
   TARGET     max($25,000, 12% of the finished value, rounded to the $2,500
              negotiations are conducted in). On the Wimberley worked example
              (finished $298,000) this derives $35,000 — the design doc's
              figure — from first principles rather than by decree.
   W_FINISHED 0.12 — land comps are thinner than house comps; an estimated
              finished-lot value carries a wider band than an estimated ARV.
   W_SITE     0.20 — site-work lumps are the loosest figure in this trade.
   SEPTIC     $18,000 — the allowance priced inside site work when no sewer is
              on record. Mid-range conventional system plus design and permit;
              engineered systems run far past it, which is exactly why the
              sheet says the payday moves when you confirm. */
export const SALE_PCT  = 0.07;
export const REACH_GAP = 0.15;
export const W_FINISHED = 0.12;
export const W_SITE     = 0.20;
export const SEPTIC_ALLOWANCE = 18000;
export const targetFor = finished =>
  Math.max(25000, Math.round(finished * 0.12 / 2500) * 2500);

const num = x => (x && typeof x.v === 'number' && Number.isFinite(x.v) && x.v > 0) ? x.v : null;
const est = x => !!(x && x.prov === 'estimate');
const R = Math.round;

/* ── site work + carry ─────────────────────────────────────────────────────
   Two honest shapes, because the workflow has two moments. Early, site work
   is a LUMP — a gut figure, marked an estimate, and that is fine because it
   is marked. Later it is ITEMS — the driveway bid, the power-drop quote, the
   septic design — and the moment items exist they win, because a sum of
   quotes outranks a gut figure the same way a contractor's bid outranks a
   slider. Carry is months × a monthly figure (taxes, insurance, the money);
   the lump-vs-items choice does not apply to time. */
export function siteCarryOf(input){
  const months  = num(input.months)  ?? 0;
  const carryMo = num(input.carryMo) ?? 0;
  const carry = R(months * carryMo);
  const items = Array.isArray(input.site) ? input.site.filter(i => typeof i.v === 'number' && i.v > 0) : [];
  const lump = num(input.siteLump);

  const firm = [];   // what has to be confirmed before this prices firm
  let site, siteEst, assumed = 0;

  if (items.length){
    site = R(items.reduce((t, i) => t + i.v, 0));
    siteEst = items.some(i => i.prov === 'estimate');
    /* utilities unknown → the allowance is priced IN, as an item we add and
       name, not as a footnote the total quietly excludes */
    if (input.sewer === 'unknown' && !items.some(i => i.id === 'septic' || i.id === 'sewer')){
      site += SEPTIC_ALLOWANCE; assumed += SEPTIC_ALLOWANCE; siteEst = true;
      firm.push({ id:'septic', assumed: SEPTIC_ALLOWANCE,
        say: 'No sewer on record. A septic install is priced at $' + SEPTIC_ALLOWANCE.toLocaleString('en-US')
           + ' inside site work until you confirm — the payday moves if you do.' });
    }
  } else if (lump !== null){
    site = R(lump); siteEst = est(input.siteLump);
    if (input.sewer === 'unknown')
      firm.push({ id:'septic', assumed: 0,
        say: 'No sewer on record, and site work is one figure. Confirm that figure includes a septic '
           + '— a conventional install runs about $' + SEPTIC_ALLOWANCE.toLocaleString('en-US') + '.' });
  } else {
    return { missing: true, firm };
  }
  if (input.access === 'unverified')
    firm.push({ id:'access', assumed: 0,
      say: 'Road access is not verified. A lot you cannot legally reach is not a lot — confirm the '
         + 'frontage or the easement before this number leaves the screen.' });
  return { site, carry, months, siteCarry: site + carry, siteEst, assumed, firm, missing:false };
}

/* ── the model ─────────────────────────────────────────────────────────────
   Returns either a refusal that says exactly what it needs, or the priced
   play with the working shown. Never both, never neither. */
export function landModel(input){
  const finished = num(input.finished);
  const asking   = num(input.asking);
  const acres    = num(input.acres);

  /* the one figure nothing prices without — the ARV of dirt */
  if (finished === null) return {
    refused: { why: 'it needs what the finished lot sells for',
      needs: ['finished'],
      say: 'Nothing on this screen prices until the finished lot has a sold price. Comps for '
         + 'finished lots nearby are the way in — the same way the house sheet builds its ARV.' } };

  const sc = siteCarryOf(input);
  if (sc.missing) return {
    refused: { why: 'it needs the site work figure',
      needs: ['siteLump'],
      say: 'Site work is the whole difference between dirt and a lot. One lump figure is enough '
         + 'to open the play — mark it an estimate and firm it into quotes as they arrive.' } };

  const saleCost = R(finished * SALE_PCT);
  const target = num(input.target) ?? targetFor(finished);
  const ceiling = R(finished - sc.siteCarry - saleCost - target);

  const clears = asking === null ? null : R(finished - asking - sc.siteCarry - saleCost);
  const clearsAt = price => R(finished - price - sc.siteCarry - saleCost);

  /* the reach question, on the desk's own constant: is their number close
     enough to the ceiling that this is a conversation rather than a wait */
  const reaches = asking === null ? true : (asking - ceiling) / asking <= REACH_GAP;
  const gap = asking === null ? null : asking - ceiling;

  /* the band: what the estimates could move. The finished value swings the
     whole line by its width; the site figure swings it by its own. Bands add
     — pessimism on both at once is the cautious end, and the cautious end is
    the one a lender reads first. */
  const wF = est(input.finished) ? W_FINISHED * finished : 0;
  const wS = sc.siteEst ? W_SITE * sc.site : 0;
  const spread = R(wF + wS);
  const band = clears === null ? null : { lo: clears - spread, hi: clears + spread };

  const estimates = [
    est(input.finished) && 'finished',
    sc.siteEst && 'site',
    est(input.acres) && 'acres',
  ].filter(Boolean);

  return {
    refused: null,
    finished, asking, acres,
    perAcre: (asking !== null && acres !== null) ? R(asking / acres) : null,
    saleCost, salePct: SALE_PCT,
    site: sc.site, carry: sc.carry, months: sc.months, siteCarry: sc.siteCarry,
    target, ceiling, clears, clearsAt, reaches, gap,
    band, spread, estimates,
    firm: sc.firm,
    /* one sentence, assembled here so every surface prints the same one */
    concession: 'To clear $' + target.toLocaleString('en-US') + ', buy at $'
      + ceiling.toLocaleString('en-US') + ' or less.',
  };
}
