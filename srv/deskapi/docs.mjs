/* ══ THE PAPERWORK ═════════════════════════════════════════════════════════
   Every competitor stops at "here is a lead". This one prices the house,
   tells you the most you can pay, and then writes the paper that captures it
   — with the number taken FROM the ceiling, so the document can never
   contradict the underwriting that produced it. That is the whole reason
   this module exists and the reason it lives next to dialrules.mjs rather
   than inside a template file somewhere.

   THREE RULES, and they are the same three the rest of the desk runs on.

   1 · A DOCUMENT NEVER GUESSES. If a term is missing it does not get a
       blank, an "N/A", or a plausible default — the document refuses to
       render and says which term it is waiting for. A contract with a
       confident-looking blank in it is worse than no contract, because
       somebody signs it.

   2 · A DOCUMENT NEVER BEATS THE CEILING. The price on the paper is checked
       against the exits before it is written. You can override it, but the
       override is a decision with a reason attached and it is recorded.

   3 · THE LAW GETS THE SAME PROVENANCE GRAMMAR AS THE MONEY. A requirement
       this software has actually verified states itself. A requirement that
       varies by state, or that nobody here has checked, is raised as a
       QUESTION FOR HIS ATTORNEY and marked unverified — the legal equivalent
       of the gold chip. This module does not invent law. Where it is sure,
       it says so and cites; where it is not, it asks.

   And the standing disclaimer, which is in the code because it belongs in
   the code: nothing here is legal advice, nothing here has been reviewed by
   a lawyer, and every document this produces is a draft for one.          */

/* ── money, spelled out ───────────────────────────────────────────────────
   Contracts write the number twice — figures and words — because a figure
   is one typo away from an order of magnitude and the words are what a
   court reads when they disagree. */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
  'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
  'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy',
  'Eighty', 'Ninety'];
const SCALE = ['', 'Thousand', 'Million', 'Billion'];

function under1000(n){
  const out = [];
  if (n >= 100){ out.push(ONES[Math.floor(n / 100)], 'Hundred'); n %= 100; }
  /* Compound numbers are hyphenated — "Thirty-Four", not "Thirty Four". It is
     the convention every contract uses and the one thing about spelled-out
     money that a closing attorney will notice immediately. */
  if (n >= 20){
    const t = TENS[Math.floor(n / 10)]; n %= 10;
    out.push(n ? t + '-' + ONES[n] : t);
  }
  else if (n) out.push(ONES[n]);
  return out.join(' ');
}

export function moneyWords(amount){
  if (amount == null || !isFinite(amount)) return null;
  const neg = amount < 0;
  const cents = Math.round(Math.abs(amount) * 100);
  let dollars = Math.floor(cents / 100);
  const rem = cents % 100;
  if (dollars >= 1e12) return null;           /* beyond the scale table; refuse */
  let words = '';
  if (dollars === 0) words = 'Zero';
  else {
    const parts = [];
    for (let i = 0; dollars > 0; i++){
      const chunk = dollars % 1000;
      if (chunk) parts.unshift(under1000(chunk) + (SCALE[i] ? ' ' + SCALE[i] : ''));
      dollars = Math.floor(dollars / 1000);
    }
    words = parts.join(' ');
  }
  return (neg ? 'Negative ' : '') + words + ' and ' +
    String(rem).padStart(2, '0') + '/100 Dollars';
}

/* Named usd() and not usd() on purpose. ops.html already has a usd()
   that renders a missing value as an em-dash, which is right on a screen and
   catastrophic on a contract — "Buyer will pay —" is a document that looks
   finished. This one returns null so the hole detector catches it. The two
   must never be confused, so they are not even spelled the same. */
export function usd(n){
  if (n == null || !isFinite(n)) return null;
  return '$' + Math.round(n).toLocaleString('en-US');
}

/* ── dates that land on days people work ──────────────────────────────────
   "Twenty-one days from acceptance" landing on Thanksgiving is how a closing
   slips a week. Federal holidays only — a state courthouse closure is a
   question for his closing attorney, not a thing to hard-code here. */
const nth = (y, m, weekday, n) => {           /* n-th <weekday> of month m */
  const d = new Date(Date.UTC(y, m, 1));
  let count = 0;
  while (true){
    if (d.getUTCDay() === weekday && ++count === n) return d.getUTCDate();
    d.setUTCDate(d.getUTCDate() + 1);
  }
};
const lastWeekday = (y, m, weekday) => {
  const d = new Date(Date.UTC(y, m + 1, 0));
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
  return d.getUTCDate();
};

export function federalHolidays(year){
  const fixed = [[0,1,"New Year's Day"], [5,19,'Juneteenth'],
                 [6,4,'Independence Day'], [10,11,'Veterans Day'],
                 [11,25,'Christmas Day']];
  const out = [];
  for (const [m, day, name] of fixed){
    /* observed: Saturday slides back to Friday, Sunday forward to Monday */
    const d = new Date(Date.UTC(year, m, day));
    if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
    else if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
    out.push({ date: d.toISOString().slice(0,10), name });
  }
  out.push({ date: `${year}-01-${String(nth(year,0,1,3)).padStart(2,'0')}`, name:'Martin Luther King Jr. Day' });
  out.push({ date: `${year}-02-${String(nth(year,1,1,3)).padStart(2,'0')}`, name:"Washington's Birthday" });
  out.push({ date: `${year}-05-${String(lastWeekday(year,4,1)).padStart(2,'0')}`, name:'Memorial Day' });
  out.push({ date: `${year}-09-${String(nth(year,8,1,1)).padStart(2,'0')}`, name:'Labor Day' });
  out.push({ date: `${year}-10-${String(nth(year,9,1,2)).padStart(2,'0')}`, name:'Columbus Day' });
  out.push({ date: `${year}-11-${String(nth(year,10,4,4)).padStart(2,'0')}`, name:'Thanksgiving Day' });
  return out.sort((a,b) => a.date < b.date ? -1 : 1);
}

const holidaySet = (() => {
  const cache = {};
  return year => cache[year] || (cache[year] =
    new Set(federalHolidays(year).map(h => h.date)));
})();

export function isBusinessDay(iso){
  const d = new Date(iso + 'T12:00:00Z');
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const y = d.getUTCFullYear();
  /* NEXT year's table too, because when 1 January falls on a Saturday the
     observed holiday is 31 December of the year before — and a holiday table
     keyed only on its own year does not contain it. A closing scheduled for
     New Year's Eve is not a hypothetical; it is the busiest day in December. */
  return !holidaySet(y).has(iso) && !holidaySet(y + 1).has(iso);
}

export function addBusinessDays(startISO, n){
  let d = new Date(startISO + 'T12:00:00Z');
  let left = n;
  while (left > 0){
    d.setUTCDate(d.getUTCDate() + 1);
    if (isBusinessDay(d.toISOString().slice(0,10))) left--;
  }
  return d.toISOString().slice(0,10);
}

export function addCalendarDays(startISO, n){
  const d = new Date(startISO + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0,10);
}

/* A calendar deadline that lands on a weekend or a federal holiday rolls
   FORWARD to the next business day, which is what almost every real estate
   contract says and what everybody assumes even when it doesn't. */
export function rollForward(iso){
  let d = iso;
  let guard = 0;
  while (!isBusinessDay(d) && guard++ < 14) d = addCalendarDays(d, 1);
  return d;
}

export function longDate(iso){
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US',
    { month:'long', day:'numeric', year:'numeric', timeZone:'UTC' });
}

/* ── the ceiling guard ────────────────────────────────────────────────────
   The one thing a pricing engine buys you is the discipline to walk away,
   and the one place that discipline actually gets tested is the moment
   somebody types a number into a contract. */
export function priceGuard({ offer, exits, override } = {}){
  const priced = Object.entries(exits || {}).filter(([,v]) => v != null && isFinite(v));
  if (!priced.length) return { ok:false, code:'unpriced',
    why:'There is no ceiling to check this against. Price the house first.' };
  const [bestName, ceiling] = priced.sort((a,b) => b[1] - a[1])[0];
  if (offer == null || !isFinite(offer)) return { ok:false, code:'no_price',
    why:'No offer price.', best:bestName, ceiling };
  if (offer <= ceiling) return { ok:true, code:'within', best:bestName, ceiling,
    room: ceiling - offer,
    why:`${usd(offer)} is ${usd(ceiling - offer)} under your ${bestName} ceiling.` };
  if (override && String(override).trim().length >= 8) return { ok:true, code:'overridden',
    best:bestName, ceiling, over: offer - ceiling, override: String(override).trim(),
    why:`${usd(offer)} is ${usd(offer - ceiling)} ABOVE your ${bestName} ceiling of ${
      usd(ceiling)}. Overridden: "${String(override).trim()}"` };
  return { ok:false, code:'over_ceiling', best:bestName, ceiling, over: offer - ceiling,
    why:`${usd(offer)} is ${usd(offer - ceiling)} above your ${bestName} ceiling of ${
      usd(ceiling)}. Give a reason if you want it anyway — it goes on the record.` };
}

/* ── what varies, and what does not ═══════════════════════════════════════
   VERIFIED entries are federal, settled, and cited. QUESTION entries are the
   legal equivalent of a gold chip: this software has not checked them, they
   move by state and by year, and the only correct thing to do with them is
   put them in front of a lawyer. Nothing in here is an answer about state
   law, because this module does not know state law and will not pretend to. */
export const LEGAL_FLAGS = [
  { key:'lead_paint', level:'VERIFIED', severity:'high',
    when: c => c.yearBuilt && +c.yearBuilt < 1978,
    title:'Lead-based paint disclosure is required',
    body:'Federal law requires the seller of most housing built before 1978 to '
       + 'disclose known lead-based paint and hazards, hand over the EPA pamphlet, '
       + 'and give the buyer a 10-day opportunity to test. The disclosure is signed '
       + 'by both sides and attached to the contract.',
    cite:'Residential Lead-Based Paint Hazard Reduction Act of 1992 § 1018; '
       + '24 CFR Part 35 subpart A / 40 CFR Part 745 subpart F' },

  { key:'firpta', level:'QUESTION', severity:'high', when: () => true,
    title:'Is the seller a U.S. person?',
    body:'If the seller is a foreign person, federal law makes the BUYER responsible '
       + 'for withholding tax from the purchase price at closing — the liability lands '
       + 'on you, not on them. Your closing agent handles it, but only if somebody asks '
       + 'the question. Get the certification signed.',
    ask:'Ask your closing attorney: what FIRPTA certification do you need from this seller?',
    cite:'Internal Revenue Code § 1445' },

  { key:'probate_authority', level:'QUESTION', severity:'high',
    when: c => /probate|inherit|estate|passed|deceased/i.test(
      [c.situation, c.notes, c.sellerRole].filter(Boolean).join(' ')),
    title:'Who actually has authority to sign?',
    body:'An heir is not automatically the owner. Until an estate is opened and the '
       + 'court appoints someone, there may be nobody with authority to convey — and a '
       + 'contract signed by somebody without authority is not a contract, it is a '
       + 'delay you paid for. This is the single most common way a probate deal dies '
       + 'after everyone has agreed.',
    ask:'Ask the attorney: has the estate been opened, and who holds letters '
      + 'testamentary or letters of administration? Does the sale need court approval?' },

  { key:'assignment_disclosure', level:'QUESTION', severity:'high',
    when: c => c.assignable !== false,
    title:'Wholesaling rules — check this state, this year',
    body:'A number of states have recently written rules about assigning a purchase '
       + 'contract: what has to be disclosed to the seller, whether a licence is '
       + 'required, caps on how it can be marketed. These changed fast and they change '
       + 'again. Disclosing your intent to assign in writing costs you nothing and is '
       + 'the right thing regardless of what the statute says.',
    ask:'Ask the attorney: does this state regulate contract assignment or wholesaling, '
      + 'and what must be disclosed to the seller in writing?' },

  { key:'closing_practice', level:'QUESTION', severity:'medium', when: () => true,
    title:'Who closes it here — attorney or title company?',
    body:'Some states run closings through an attorney, some through a title company, '
       + 'some either. It changes who drafts what, what your contract should say about '
       + 'the closing agent, and who you call first.',
    ask:'Ask locally: attorney closing or title company, and who pays for what?' },

  { key:'seller_disclosure', level:'QUESTION', severity:'medium', when: () => true,
    title:'What must the seller disclose?',
    body:'Most states require a written property condition disclosure, with exemptions '
       + 'that often include estate sales — which is exactly the situation you are most '
       + 'often in. An exemption is not a licence to stay quiet about something you know.',
    ask:'Ask the attorney: is a property disclosure required here, and does an estate '
      + 'sale change it?' },

  { key:'spousal_signature', level:'QUESTION', severity:'medium',
    when: c => c.sellerCount === 1 && c.sellerRole !== 'estate',
    title:'Does a spouse have to sign?',
    body:'Several states give a non-owner spouse rights in a home that mean the deed is '
       + 'not clean without their signature — sometimes even when they are not on title.',
    ask:'Ask the attorney: does a spouse need to sign here, and is this property '
      + 'homestead?' },

  { key:'liens', level:'QUESTION', severity:'high',
    when: c => c.owed == null,
    title:'Nobody has established what is owed against it',
    body:'A payoff, a tax lien, a code-enforcement lien, a contractor lien, and in an '
       + 'estate a Medicaid estate-recovery claim all come out of the same money you are '
       + 'paying. Priced without them, a deal that works on paper closes at a loss.',
    ask:'Order a title search before you go hard on earnest money.' },
];

export function flagsFor(ctx = {}){
  return LEGAL_FLAGS.filter(f => { try { return f.when(ctx); } catch(_){ return false; } })
    .map(({ when, ...rest }) => rest)
    .sort((a,b) => (a.severity === b.severity) ? 0 : a.severity === 'high' ? -1 : 1);
}

/* ══ THE DOCUMENTS ═════════════════════════════════════════════════════════
   Written in plain language on purpose. There is a school of thought that a
   contract should sound like a contract, and there is a better one that says
   the person signing it should be able to read it. The seller across the
   table is frequently grieving, frequently older, and frequently being
   approached by six other people that month with three pages of
   "WHEREAS". Being the one they can understand is not only decent, it wins.

   Plain language is not the same as loose language. Every term that decides
   money or timing is named exactly once, in one place, and computed rather
   than typed.                                                              */

const REQUIRED = {
  offer_letter: [
    ['property.address', 'the property address'],
    ['seller.name|seller.entity', "the seller's name"],
    ['buyer.name|buyer.entity',   'your name or your entity'],
    ['price',            'the offer price'],
  ],
  psa: [
    ['property.address', 'the property address'],
    ['property.state',   'the state the property is in'],
    ['seller.name|seller.entity', "the seller's legal name"],
    ['buyer.name|buyer.entity',   'your legal name or entity'],
    ['price',            'the purchase price'],
    ['earnest',          'the earnest money'],
    ['closingDays',      'how many days to closing'],
  ],
  option: [
    ['property.address', 'the property address'],
    ['property.state',   'the state the property is in'],
    ['seller.name|seller.entity', "the seller's legal name"],
    ['buyer.name|buyer.entity',   'your legal name or entity'],
    ['price',            'the price the option locks in'],
    ['optionFee',        'the option fee — what you pay for the right'],
    ['optionDays',       'how long the option runs'],
  ],
  assignment: [
    ['property.address', 'the property address'],
    ['buyer.name|buyer.entity',       'you, as the assignor'],
    ['assignee.name|assignee.entity', 'who you are assigning to'],
    ['assignmentFee',    'the assignment fee'],
    ['price',            'the price in the underlying contract'],
  ],
};

const dig = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

const present = v => !(v === null || v === undefined || v === '' ||
  (typeof v === 'number' && !isFinite(v)));

/* A required term may be satisfied by more than one field. Somebody who buys
   in an LLC has no personal name to put on the contract and should not be
   asked for one — "buyer.name|buyer.entity" means either will do. The first
   version of this insisted on a personal name and refused to write a contract
   for a company, which is most of them. */
export function missingFor(kind, ctx){
  return (REQUIRED[kind] || []).filter(([spec]) =>
    !spec.split('|').some(path => present(dig(ctx, path)))
  ).map(([spec, label]) => ({ field: spec.split('|')[0], label }));
}

/* "4715 Hunter Rd Winston, GA 30187" is not an address, it is two addresses
   with the comma missing. The parts are joined with the punctuation a postal
   address actually uses. */
const addressLine = pr => {
  const cityState = [pr.city, pr.state].filter(Boolean).join(', ');
  const tail = [cityState, pr.zip].filter(Boolean).join(' ');
  return [pr.address, tail].filter(Boolean).join(', ');
};

const party = p => p.entity
  ? `${p.entity}${p.name ? ` (by ${p.name})` : ''}`
  : (p.name || '');

/* ── the shared head every document carries ─────────────────────────────── */
function heading(kind, ctx, title){
  const today = ctx.today || new Date().toISOString().slice(0,10);
  return [
    { t:'title', text: title },
    { t:'meta', rows: [
      ['Property', addressLine(ctx.property)],
      ['Prepared', longDate(today)],
      ctx.property.county ? ['County', ctx.property.county] : null,
      ctx.property.parcel ? ['Parcel', ctx.property.parcel] : null,
    ].filter(Boolean) },
  ];
}

/* The one block that is never optional, on every document this produces. */
function draftNotice(){
  return { t:'notice', text:
    'DRAFT — NOT LEGAL ADVICE. This document was generated from your own deal '
  + 'figures by software. It has not been reviewed by a lawyer and it is not '
  + 'tailored to the law of any state. Have your attorney read it before anyone '
  + 'signs. Terms in [brackets] are placeholders you or your attorney must fill.' };
}

/* ── 1 · the offer letter ─────────────────────────────────────────────────
   Not a contract. A letter, because a contract arriving cold reads as a trap
   and a letter reads as a person. It says the number, says where the number
   came from, and says what happens next. */
function offerLetter(ctx){
  const pr = ctx.property, s = ctx.seller, b = ctx.buyer;
  const close = ctx.closingDays || 21;
  const blocks = [
    ...heading('offer_letter', ctx, 'Offer to purchase'),
    { t:'p', text: `${s.name},` },
    { t:'p', text: `I'd like to buy ${addressLine(pr)} for ${usd(ctx.price)}, `
      + `in cash, exactly as it stands today. You don't clean it out, you don't `
      + `fix anything, and you don't pay a commission.` },
    { t:'h', text:'Where that number comes from' },
    { t:'p', text: ctx.arv && ctx.repairs
      ? `I think the house is worth about ${usd(ctx.arv)} once it's put right, `
      + `and I think putting it right costs about ${usd(ctx.repairs)}. What's left `
      + `after the work, the holding costs and the fees is what I can pay. I'm happy `
      + `to walk you through the arithmetic line by line — I'd rather you `
      + `understood the offer than just accepted it.`
      : `I'm happy to walk you through how I got there line by line.` },
    { t:'h', text:'What happens next' },
    { t:'list', items: [
      `You say yes, or you tell me what number would work.`,
      `I send a purchase agreement — one page of terms, in plain English.`,
      `${close} days later, or whatever date suits you, you get a cheque.`,
      ctx.assignable === false ? null
        : `I may bring in a partner to close it. Either way the price you're `
        + `promised is the price you're paid.`,
    ].filter(Boolean) },
    { t:'p', text: `If the timing is wrong, or you'd rather do nothing at all, that's `
      + `a fine answer and I'll leave you alone. If you want to talk it through, `
      + `call me any time.` },
    { t:'sig', lines: [
      { role:'', name: party(b), sub: [b.phone, b.email].filter(Boolean).join(' · '),
        dated:false },
    ] },
  ];
  return blocks;
}

/* ── 2 · the purchase and sale agreement ───────────────────────────────── */
function psa(ctx){
  const pr = ctx.property, s = ctx.seller, b = ctx.buyer;
  const accepted = ctx.acceptedOn || ctx.today || new Date().toISOString().slice(0,10);
  const inspDays = ctx.inspectionDays == null ? 7 : ctx.inspectionDays;
  const closeDays = ctx.closingDays || 21;
  const inspEnd = rollForward(addCalendarDays(accepted, inspDays));
  const closeOn = rollForward(addCalendarDays(accepted, closeDays));
  const blocks = [
    ...heading('psa', ctx, 'Purchase and sale agreement'),
    { t:'p', text: `This agreement is between ${party(s)} ("Seller") and `
      + `${party(b)} ("Buyer") for the property at ${addressLine(pr)}`
      + `${pr.parcel ? `, parcel ${pr.parcel}` : ''} (the "Property").` },

    { t:'clause', n:1, h:'Price',
      text: `Buyer will pay ${moneyWords(ctx.price)} (${usd(ctx.price)}) for the `
        + `Property, in cash at closing. There is no financing contingency: this `
        + `offer does not depend on Buyer obtaining a loan.` },

    { t:'clause', n:2, h:'Earnest money',
      text: `Buyer will deposit ${moneyWords(ctx.earnest)} (${usd(ctx.earnest)}) `
        + `with ${ctx.escrowAgent || '[the closing agent named in §6]'} within three (3) `
        + `business days of the date both parties sign. The deposit is applied to the `
        + `price at closing. If Buyer terminates under §3 the deposit is returned to `
        + `Buyer. If Buyer fails to close for any other reason, Seller keeps it as the `
        + `full and only remedy.` },

    { t:'clause', n:3, h:'Inspection period',
      text: inspDays === 0
        ? `Buyer has inspected the Property and takes it as-is with no inspection period.`
        : `Buyer may inspect the Property, at Buyer's cost, through `
          + `${longDate(inspEnd)} (${inspDays} days from acceptance). Until that date `
          + `Buyer may terminate for any reason or none, in writing, and the earnest `
          + `money is returned. After it, the deposit is at risk.` },

    { t:'clause', n:4, h:'Condition',
      text: `Buyer takes the Property as-is, in its present condition, with everything `
        + `presently attached to it. Seller is not asked to repair, clean, or remove `
        + `anything, and may leave behind whatever Seller does not want. Seller makes `
        + `no warranty about condition. Nothing in this paragraph relieves Seller of `
        + `any disclosure the law requires.` },

    { t:'clause', n:5, h:'Title',
      text: `Seller will convey good and marketable title by [warranty deed — confirm `
        + `the correct deed for this state with the closing attorney], free of liens `
        + `except those Buyer agrees in writing to take. Seller's payoffs, unpaid `
        + `property taxes, and any liens against the Property are paid out of Seller's `
        + `proceeds at closing. If title cannot be delivered, Buyer may terminate and `
        + `the earnest money is returned.` },

    { t:'clause', n:6, h:'Closing',
      text: `Closing will be on or before ${longDate(closeOn)} (${closeDays} days from `
        + `acceptance), at ${ctx.escrowAgent || '[closing attorney or title company — '
        + 'see the legal questions attached]'}, or on any earlier date the parties `
        + `agree in writing. Possession passes to Buyer at closing.` },

    { t:'clause', n:7, h:'Costs',
      text: `Buyer pays the closing fee, the title search, title insurance, and `
        + `recording. Seller pays any transfer tax, Seller's own payoffs and liens, and `
        + `Seller's own attorney. Property taxes are prorated to the closing date.` },

    ctx.assignable === false
      ? { t:'clause', n:8, h:'Assignment',
          text: `Buyer may not assign this agreement without Seller's written consent.` }
      : { t:'clause', n:8, h:'Assignment — read this one',
          text: `Buyer may assign this agreement to another buyer, and Buyer tells `
            + `Seller plainly that Buyer may do exactly that and may be paid a fee for `
            + `it. Seller's price and Seller's closing date do not change if that `
            + `happens. Buyer remains responsible under this agreement until closing.` },

    { t:'clause', n:9, h:'Access',
      text: `Seller will let Buyer, and anyone Buyer sends, into the Property on `
        + `reasonable notice to inspect, measure, photograph, and show it.` },

    { t:'clause', n:10, h:'If somebody does not perform',
      text: `If Buyer does not close, Seller keeps the earnest money and that is the `
        + `end of it — Seller has no other claim against Buyer. If Seller does not `
        + `close, Buyer may have the earnest money back, or may ask a court to make `
        + `Seller go through with the sale.` },

    { t:'clause', n:11, h:'The whole agreement',
      text: `This is the entire agreement. Nothing said before it counts. Changes must `
        + `be in writing and signed by both. This agreement is governed by the law of `
        + `${pr.state || '[state]'}. Signatures sent electronically or by photograph `
        + `count as originals.` },

    { t:'clause', n:12, h:'Offer expires',
      text: ctx.expiresOn
        ? `This offer is open until ${longDate(ctx.expiresOn)} and is withdrawn after that.`
        : `This offer is open for five (5) days from the date above and is withdrawn `
          + `after that.` },

    { t:'sig', lines: [
      { role:'Seller', name: party(s), dated:true },
      { role:'Buyer',  name: party(b), dated:true },
    ] },
  ];
  return blocks;
}

/* ── 3 · the purchase option ──────────────────────────────────────────────
   Buys TIME rather than the house — which is the right instrument when the
   seller cannot convey yet. An heir who has not opened an estate cannot sell
   you a house today and can absolutely sell you the right to buy it when
   they can, and being paid for that right is often what finally moves
   somebody who has been stalling for four years. */
function option(ctx){
  const pr = ctx.property, s = ctx.seller, b = ctx.buyer;
  const start = ctx.acceptedOn || ctx.today || new Date().toISOString().slice(0,10);
  const days = ctx.optionDays;
  const end = rollForward(addCalendarDays(start, days));
  const closeDays = ctx.closingDays || 21;
  const blocks = [
    ...heading('option', ctx, 'Purchase option agreement'),
    { t:'p', text: `${party(s)} ("Owner") gives ${party(b)} ("Holder") the exclusive `
      + `right — not the obligation — to buy ${addressLine(pr)} (the "Property") on `
      + `the terms below.` },

    { t:'clause', n:1, h:'The option fee',
      text: `Holder pays Owner ${moneyWords(ctx.optionFee)} (${usd(ctx.optionFee)}) `
        + `for this option. Owner keeps it whether or not Holder buys. `
        + `${ctx.optionFeeCredited === false
            ? 'It is not credited against the price.'
            : 'If Holder buys, it is credited against the purchase price.'}` },

    { t:'clause', n:2, h:'The price, locked',
      text: `If Holder exercises, the price is ${moneyWords(ctx.price)} `
        + `(${usd(ctx.price)}), in cash, as-is. That price does not move for the `
        + `length of this option, whatever the market does.` },

    { t:'clause', n:3, h:'How long',
      text: `This option runs from ${longDate(start)} through ${longDate(end)} `
        + `(${days} days).${ctx.extensionDays
            ? ` Holder may extend it once by ${ctx.extensionDays} days by paying a `
              + `further ${usd(ctx.extensionFee || ctx.optionFee)} before it expires.`
            : ''}` },

    { t:'clause', n:4, h:'How Holder exercises it',
      text: `Holder exercises by giving Owner written notice — by hand, by post, or by `
        + `email — before the option expires. Closing then happens within `
        + `${closeDays} days of that notice.` },

    { t:'clause', n:5, h:'What Owner promises meanwhile',
      text: `While this option is alive, Owner will not sell, list, option, mortgage or `
        + `otherwise encumber the Property, and will not accept an offer from anyone `
        + `else. Owner will keep the taxes and any insurance current and will not let `
        + `the Property be forfeited, foreclosed, or condemned.` },

    { t:'clause', n:6, h:'What Owner will do to be able to sell',
      text: ctx.performance || `Owner will take the steps needed to be able to convey `
        + `clear title — including, where the Property passed through an estate, `
        + `opening probate and obtaining authority to sell — and will do so promptly. `
        + `Holder will pay up to ${usd(ctx.legalHelp || 3000)} of Owner's reasonable `
        + `legal costs of doing so, on request, against invoices.` },

    { t:'clause', n:7, h:'If Owner cannot deliver',
      text: `If Owner cannot convey clear title by the end of this option, Holder may `
        + `extend it for as long as it reasonably takes Owner to fix the problem, on `
        + `written notice, at no further fee.` },

    { t:'clause', n:8, h:'Recording',
      text: `Holder may record a memorandum of this option in the county records so `
        + `that the world knows the Property is spoken for. Holder will release it if `
        + `the option expires unexercised. [Confirm with the closing attorney whether `
        + `this state records memoranda of option and in what form.]` },

    ctx.assignable === false
      ? { t:'clause', n:9, h:'Assignment',
          text: `Holder may not assign this option without Owner's written consent.` }
      : { t:'clause', n:9, h:'Assignment — read this one',
          text: `Holder may assign this option, and Holder tells Owner plainly that `
            + `Holder may do so and may be paid for it. Owner's price and Owner's `
            + `obligations do not change.` },

    { t:'clause', n:10, h:'The whole agreement',
      text: `This is the entire agreement, governed by the law of `
        + `${pr.state || '[state]'}. Changes must be in writing and signed by both. `
        + `Signatures sent electronically or by photograph count as originals. This `
        + `option binds and benefits the parties' heirs, executors and successors.` },

    { t:'sig', lines: [
      { role:'Owner',  name: party(s), dated:true },
      { role:'Holder', name: party(b), dated:true },
    ] },
  ];
  return blocks;
}

/* ── 4 · the assignment ──────────────────────────────────────────────────── */
function assignment(ctx){
  const pr = ctx.property, b = ctx.buyer, a = ctx.assignee || {};
  const blocks = [
    ...heading('assignment', ctx, 'Assignment of purchase agreement'),
    { t:'p', text: `${party(b)} ("Assignor") assigns to ${party(a)} ("Assignee") all `
      + `of Assignor's rights under the purchase agreement dated `
      + `${ctx.underlyingDate ? longDate(ctx.underlyingDate) : '[date of the contract]'} `
      + `for ${addressLine(pr)} (the "Contract").` },
    { t:'clause', n:1, h:'The fee',
      text: `Assignee pays Assignor ${moneyWords(ctx.assignmentFee)} `
        + `(${usd(ctx.assignmentFee)}) for this assignment, `
        + `${ctx.feeAtClosing === false
            ? 'on signing, non-refundable.'
            : 'at closing, through the closing agent, shown on the settlement statement.'}` },
    { t:'clause', n:2, h:'What Assignee takes on',
      text: `Assignee assumes every obligation under the Contract, including the `
        + `purchase price of ${usd(ctx.price)} and the closing date in it, and will `
        + `perform them.` },
    { t:'clause', n:3, h:'What Assignor promises',
      text: `Assignor promises the Contract is real, is in force, has not been assigned `
        + `to anyone else, and that Assignor has not breached it. Assignor makes no `
        + `promise at all about the condition or value of the Property — Assignee has `
        + `looked at it or chosen not to.` },
    { t:'clause', n:4, h:'Earnest money',
      text: `Assignee ${ctx.earnest ? `replaces Assignor's ${usd(ctx.earnest)} deposit `
        + `with its own, and Assignor's is returned at closing`
        : 'places its own earnest money as the Contract requires'}.` },
    { t:'clause', n:5, h:'If Assignee does not close',
      text: `If Assignee does not close, this assignment ends, the Contract returns to `
        + `Assignor, and Assignor keeps any fee already paid.` },
    { t:'sig', lines: [
      { role:'Assignor', name: party(b), dated:true },
      { role:'Assignee', name: party(a), dated:true },
    ] },
  ];
  return blocks;
}

const BUILDERS = { offer_letter: offerLetter, psa, option, assignment };

export const DOC_TITLES = {
  offer_letter:'Offer letter', psa:'Purchase & sale agreement',
  option:'Purchase option', assignment:'Assignment of contract',
};

/* A rendered document may not contain an empty substitution. This has caught
   more real bugs in this module than any other check in it: a template string
   is one undefined away from "Buyer will pay undefined for the Property", and
   that sentence looks enough like the others to survive a read-through.
   Exported so the tests can prove the detector detects, rather than trusting
   a check that would pass just as quietly if it were broken. */
export function findHoles(blocks){
  const text = blocks.map(b => JSON.stringify(b)).join(' ');
  return ['undefined', 'null', 'NaN'].filter(h =>
    new RegExp('(^|[\\s">($])' + h + '([\\s"<).,]|$)').test(text));
}

/* ── the one entry point ─────────────────────────────────────────────────── */
export function renderDoc(kind, ctx = {}){
  const build = BUILDERS[kind];
  if (!build) return { ok:false, kind, code:'unknown_kind',
    why:`There is no document called "${kind}".`, missing:[], blocks:[], flags:[] };

  const c = { ...ctx, property: ctx.property || {}, seller: ctx.seller || {},
              buyer: ctx.buyer || {} };

  /* RULE 1 — a document never guesses. */
  const missing = missingFor(kind, c);
  if (missing.length) return { ok:false, kind, code:'missing_terms',
    title: DOC_TITLES[kind], missing, blocks:[], flags:[],
    why: `This document needs ${missing.length} more thing${missing.length === 1 ? '' : 's'} `
       + `before it can be written: ${missing.map(m => m.label).join(', ')}.` };

  /* RULE 2 — a document never beats the ceiling. */
  let guard = null;
  if (kind !== 'assignment' && c.exits){
    guard = priceGuard({ offer: c.price, exits: c.exits, override: c.override });
    if (!guard.ok && guard.code !== 'unpriced')
      return { ok:false, kind, code: guard.code, title: DOC_TITLES[kind],
        missing:[], blocks:[], flags:[], guard, why: guard.why };
  }

  /* RULE 3 — the law wears its provenance. */
  const flags = flagsFor({
    yearBuilt: c.property.yearBuilt, state: c.property.state,
    situation: c.situation, notes: c.notes, sellerRole: c.seller.role,
    sellerCount: c.sellerCount == null ? 1 : c.sellerCount,
    assignable: c.assignable, owed: c.owed,
  });

  const blocks = [draftNotice(), ...build(c)];

  /* A last sweep: no rendered document may contain an empty substitution.
     This has caught more real bugs than any other check in the module —
     a template string is one undefined away from "Buyer will pay undefined". */
  const holes = findHoles(blocks);
  if (holes.length) return { ok:false, kind, code:'hole', title: DOC_TITLES[kind],
    missing:[], blocks:[], flags, guard,
    why:`The document came out with a hole in it (${holes.join(', ')}). That is a bug `
      + `in the template, not something for you to fix — nothing was saved.` };

  return { ok:true, kind, title: DOC_TITLES[kind], blocks, flags, guard,
    missing:[], why: guard ? guard.why : null };
}
