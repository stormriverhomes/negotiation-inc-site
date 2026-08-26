/* ══ THE OFFER PACKET ══════════════════════════════════════════════════════
   One page, handed across a kitchen table at the exact moment trust decides
   everything. Every wholesaler in the county shows up with a number; this is
   the only one that shows up with the arithmetic.

   Two rules make it worth printing.

   1 · THE LEDGER RECONCILES TO THE PENNY. Worth-when-fixed minus repairs
       minus selling minus holding minus my profit EQUALS the offer, exactly,
       because the profit line is computed as the remainder rather than
       asserted. Showing the margin is the one move the untrustworthy cannot
       copy — and if an override pushed the offer above the ceiling, the
       margin line goes small or negative ON THE PAGE, because it is true.

   2 · THE OTHER ROAD IS SHOWN HONESTLY — including when it wins. Listing
       with an agent frequently nets a seller more money than a cash offer,
       and this packet says so in ink when the numbers say so. Slower,
       showings, it can fall through — but more. No competitor prints that
       sentence, which is exactly why printing it closes deals: the seller
       stops defending themselves and starts choosing.

   Dependency-free like every injected module: the ceiling guard's verdict
   arrives as an argument, and everything here is arithmetic over it.       */

const round50 = n => Math.round(n / 50) * 50;

/* the flip ceiling is ARV × 0.78 − repairs; the missing 22 points of ARV are
   what it costs to sell, to hold, and to be paid for the risk. The split of
   that 22 into named lines is presentational — each wears a tilde — but the
   TOTAL is exact by construction, because profit is the remainder. */
export const SELL_SHARE = 0.08;   /* agent + closing when the house resells */
export const HOLD_SHARE = 0.06;   /* taxes, insurance, money, lights — months */

export function buildLedger({ arv, repairs, offer } = {}){
  if (![arv, repairs, offer].every(v => v != null && isFinite(v))) return null;
  const selling = round50(arv * SELL_SHARE);
  const holding = round50(arv * HOLD_SHARE);
  const profit = arv - repairs - selling - holding - offer;
  return {
    lines: [
      { key:'arv',     label:'What the house is worth once it’s put right',
        amount: arv, est:true, sign:+1 },
      { key:'repairs', label:'What putting it right will cost',
        amount: repairs, est:true, sign:-1 },
      { key:'selling', label:'Selling it when the work is done — agent, closing',
        amount: selling, est:true, sign:-1 },
      { key:'holding', label:'Owning it meanwhile — taxes, insurance, the money',
        amount: holding, est:true, sign:-1 },
      { key:'profit',  label:'What I have to earn to take the risk',
        amount: profit, est:false, sign:-1 },
    ],
    offer,
    /* the proof, computable by anyone at the table with a phone calculator */
    reconciles: arv - repairs - selling - holding - profit === offer,
    thinMargin: profit < arv * 0.05,
    negativeMargin: profit < 0,
  };
}

/* ── the other road ───────────────────────────────────────────────────────
   Selling as-is with an agent: a buyer who will do the work pays roughly the
   fixed-up value minus the work, then the agent and the closing take their
   share, and the months take theirs. Deliberately conservative — this page
   must survive the seller's sharpest relative reading it. */
export function buildRoads({ arv, repairs, offer, closingDays = 21 } = {}){
  if (![arv, repairs, offer].every(v => v != null && isFinite(v))) return null;
  const asIsPrice = round50(arv - repairs);
  const agentCosts = round50(asIsPrice * 0.07);
  const listNet = asIsPrice - agentCosts;
  return {
    listing: {
      price: asIsPrice, costs: agentCosts, net: listNet,
      time: '3–6 months', est: true,
      caveats: ['showings and strangers walking through',
                'the buyer’s inspector renegotiating at the end',
                'an appraisal, and it can fall through'],
    },
    cash: {
      net: offer, time: closingDays + ' days',
      caveats: ['no repairs, no cleaning out, no showings',
                'no commission, no closing costs to you',
                'earnest money is yours if I walk'],
    },
    /* THE HONEST VERDICT — the sentence no competitor prints */
    listingNetsMore: listNet > offer,
    difference: Math.abs(listNet - offer),
  };
}

/* ── the packet ───────────────────────────────────────────────────────────
   guard is priceGuard's verdict, computed by the caller against the same
   exits everything else uses. A packet with no verdict does not print. */
export function buildPacket(ctx = {}){
  const { property = {}, seller = {}, buyer = {}, arv, repairs, offer,
          closingDays = 21, guard = null, today = null } = ctx;

  const missing = [];
  if (!property.address) missing.push('the property address');
  if (!(buyer.entity || buyer.name)) missing.push('who you are (Settings)');
  if (arv == null || !isFinite(arv)) missing.push('an ARV');
  if (repairs == null || !isFinite(repairs)) missing.push('a repair estimate');
  if (offer == null || !isFinite(offer)) missing.push('the offer price');
  if (missing.length) return { ok:false, missing,
    why:'The packet needs ' + missing.join(', ') + '.' };

  if (guard && !guard.ok) return { ok:false, missing:[], guard,
    why: guard.why };

  const ledger = buildLedger({ arv, repairs, offer });
  const roads = buildRoads({ arv, repairs, offer, closingDays });
  const sellerFirst = String(seller.name || '').trim().split(/\s+/)[0] || null;
  const buyerLine = buyer.entity
    ? buyer.entity + (buyer.name ? ' — ' + buyer.name : '')
    : buyer.name;

  return {
    ok: true,
    property, sellerFirst, sellerName: seller.name || null, buyerLine,
    buyerPhone: buyer.phone || null, buyerEmail: buyer.email || null,
    today: today || new Date().toISOString().slice(0, 10),
    offer, closingDays, ledger, roads, guard,
    /* what happens next — three steps, no step hiding a commitment */
    next: [
      'You say yes, or you tell me the number that would work.',
      'I send a one-page agreement in plain English — read it with anyone you like.',
      `${closingDays} days later, or whatever date suits you, you get a cheque.`,
    ],
    footnotes: [
      'Every figure marked ~ is my estimate, and I’ll show you where each one '
        + 'came from, line by line, if you want to check my work.',
      'This page is not a contract and signing nothing today is a fine answer.',
    ],
  };
}
