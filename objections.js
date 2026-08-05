/* ══ THE OTHER SIDE OF THE TABLE ════════════════════════════════════════════
   The sheet tells you what to pay. The offer panel tells you what to say. The
   thing neither of them tells you is the thing that actually decides it:

       WHAT ARE THEY GOING TO SAY BACK, AND IS ANY OF IT TRUE?

   Deals are not lost on the arithmetic. They are lost in the ninety seconds
   after somebody says "I've got another offer at two-ten" and the buyer, who
   has done forty minutes of work and knows exactly what the house is worth,
   says "…oh". This is the panel you read before that call.

   ── WHY THIS ONE CAN USE THE CEILING ──────────────────────────────────────
   The letter of intent is forbidden from printing your ceiling — what you
   COULD have paid is yours and stays yours. This panel is the opposite side of
   that rule: it is written FOR YOU and never leaves your screen, so the
   ceiling is exactly what it should be built on. It is the only place in the
   product where the honest answer to "can you come up?" gets computed:

     · what they are asking, against what you can actually pay
     · how far you can still move before the deal stops working
     · what each of the non-price levers is worth to THIS seller, so a
       concession can be paid for in something other than money

   ── THE HONESTY RAIL, SAME AS THE OTHERS ──────────────────────────────────
   The model writes the sentences; it does not do the arithmetic. Every figure
   it could reasonably want — the gap, the headroom, what a five-thousand-
   dollar concession leaves behind, what the terms are worth — is precomputed
   and handed over, and then every dollar amount in every field it returns is
   checked against that list. One invented figure and the whole draft is
   refused rather than repaired, because a draft with an invented figure
   quietly removed is still a draft written by something that invents figures.

   The one thing this must never do is coach somebody into a lie. The system
   prompt forbids inventing a competing offer, a contractor, a deadline or a
   lender, and forbids characterising the seller as a person — an estate is a
   situation, not a personality, and steering on anything protected is
   illegal as well as wrong. ═══════════════════════════════════════════════ */

export const MODEL = process.env.NI_MODEL_OBJECT || process.env.NI_MODEL || 'claude-sonnet-4-5';

export const SYSTEM = `You are preparing an investor for the conversation that happens after they make an offer on a house. They have already priced it. You are not pricing anything.

Your job: the four to six things the seller or their agent is most likely to say back, what is actually being asked underneath each one, and what this investor can say in reply that is TRUE ON THEIR OWN NUMBERS.

You are given FACTS computed by an underwriting engine. You are a writer, not a calculator.

THE ABSOLUTE RULE: every number you write must appear verbatim in the facts. Do not add, subtract, average, round or convert anything. The differences you would want — the gap, the headroom, what a concession leaves — are already computed. If a number you want is not in the facts, write the sentence without it.

WHAT MAKES AN OBJECTION WORTH LISTING:
- It is what a person actually says out loud, in their words, not a category. "We've got another offer" — not "competing bid concern".
- The reply is grounded in something on this sheet. A reply that could be sent to any seller about any house is worth nothing.
- Rank them by how likely they are, most likely first.

FOR EACH ONE:
- says: the sentence, as they would say it. One line. No quotation marks.
- beneath: what is actually being asked. Usually it is not the thing they said. "Can you come up" is often "convince me you will actually close".
- answer: what this investor says back. Two or three sentences. Plain, unrhetorical, and it may use the facts. It should end somewhere the other person can respond to rather than on a full stop that closes the conversation.
- verdict: hold, trade or walk.
    hold  — the answer is no, and the reply is how you say no without ending it
    trade — there is room, and it should be paid for with something: speed, certainty, occupancy, the inspection window
    walk  — what they are asking is past the point where this deal works at all
- costs: the dollar figure conceding this would cost, when the facts contain one. Otherwise null.

WHAT YOU MAY NOT DO:
- Do not invent a competing offer, a contractor, a lender, an inspection finding, a deadline, or a comparable sale. If the investor has not got one, they have not got one.
- Do not tell them to imply anything they have not said is true.
- Do not describe the SELLER as a person — not their age, their family, their health, their circumstances or their motives beyond what the situation field states. The situation is a fact about the sale. Anything else is both a guess and, in the United States, a fair-housing problem.
- Do not use the words "leverage", "rapport", "pain point", "win-win" or "circle back".
- No exclamation marks. No scripts that read as scripts.
- If the facts say the deal has no room at all, say so plainly in the walk verdicts rather than finding something encouraging.`;

/* ── the facts ──────────────────────────────────────────────────────────────
   Everything a writer might reach for, INCLUDING every difference, because a
   difference is the number a writer gets subtly wrong. Assembled here so the
   route cannot get the shape wrong and a caller cannot smuggle in a prompt. */
export function factsFrom(body){
  const n = v => (typeof v === 'number' && Number.isFinite(v)) ? Math.round(v) : null;
  const b = body && typeof body === 'object' ? body : {};

  const asking  = n(b.asking);
  const offer   = n(b.offer);
  const ceiling = n(b.ceiling);
  if (offer === null || ceiling === null) return null;

  const gap      = (asking !== null) ? asking - offer : null;
  const headroom = ceiling - offer;
  const over     = (asking !== null) ? asking - ceiling : null;

  /* the concession ladder. Three rungs plus the last one that still works, so
     "what does another five thousand do" is answered before it is asked. */
  const rungs = [];
  for (const step of [2500, 5000, 7500, 10000]){
    if (step > Math.max(0, headroom) + 10000) break;
    const at = offer + step;
    rungs.push({ step, at, leftAfter: ceiling - at, works: at <= ceiling });
  }
  if (headroom > 0) rungs.push({ step: headroom, at: ceiling, leftAfter: 0, works: true });

  /* ── AND THE ROUND NUMBERS ────────────────────────────────────────────────
     Nobody says "I'll go to a hundred and eighty-eight thousand nine hundred
     and fifty-three". They say a hundred and ninety. The offer is a computed
     figure with three digits of false precision on the end of it, so without
     this every round counter a writer might reasonably propose is a figure we
     did not supply — and the honesty check would refuse the draft for saying
     the one thing a person would actually say.

     These are ours: computed here, from the offer and the ceiling, at the
     interval negotiations are conducted in. */
  const STEP = 2500;
  for (let at = Math.ceil((offer + 1) / STEP) * STEP; at <= ceiling; at += STEP){
    if (rungs.some(r => r.at === at)) continue;
    rungs.push({ step: at - offer, at, leftAfter: ceiling - at, works: true, round: true });
    if (rungs.length > 24) break;
  }
  rungs.sort((a, b) => a.at - b.at);

  const levers = Array.isArray(b.levers) ? b.levers.slice(0, 8).map(l => ({
    id: String(l.id || '').slice(0, 20),
    lab: String(l.lab || '').slice(0, 40),
    now: String(l.now || '').slice(0, 40),
    cost: n(l.cost),
  })) : [];

  const refused = Array.isArray(b.refused) ? b.refused.slice(0, 6).map(r => ({
    exit: String(r.exit || '').slice(0, 40),
    why:  String(r.why || '').slice(0, 200),
  })) : [];

  return {
    exit: String(b.exit || 'the plan').slice(0, 40),
    situation: String(b.situation || 'unknown').slice(0, 30),
    asking, offer, ceiling, gap, headroom, over,
    /* negative headroom is a real state and the copy has to be able to say it:
       the offer on screen is already above what the deal can carry */
    overCommitted: headroom < 0,
    arv: n(b.arv), repairs: n(b.repairs), rent: n(b.rent),
    termsValue: n(b.termsValue),
    yourCost: n(b.yourCost),
    score: n(b.score),
    finance: String(b.finance || '').slice(0, 20),
    comps: n(b.comps),
    confidence: String(b.confidence || '').slice(0, 12),
    estimated: Array.isArray(b.estimated) ? b.estimated.slice(0, 6).map(s => String(s).slice(0, 20)) : [],
    rungs, levers, refused,
  };
}

export function userBlock(f){
  const money = v => v === null ? 'not given' : '$' + Math.abs(v).toLocaleString('en-US');
  const L = [];
  L.push(`THE PLAN: ${f.exit}. The seller's situation, as the investor read it: ${f.situation}.`);
  L.push(`THEY ARE ASKING: ${money(f.asking)}`);
  L.push(`THE OFFER ON THE TABLE: ${money(f.offer)}`);
  L.push(`THE MOST THIS INVESTOR CAN PAY and still have the deal work: ${money(f.ceiling)} — NEVER put this figure in an answer; it is theirs, not the seller's.`);
  if (f.gap !== null)
    L.push(`THE GAP between the asking price and the offer: ${money(f.gap)}${f.gap < 0 ? ' (the offer is ABOVE the asking price)' : ''}`);
  L.push(f.overCommitted
    ? `HEADROOM: none. The offer is already ${money(-f.headroom)} ABOVE what the deal can carry.`
    : `HEADROOM — how much further the offer can move before the deal stops working: ${money(f.headroom)}`);
  if (f.over !== null && f.over > 0)
    L.push(`WHAT THEY ARE ASKING ABOVE THE MAXIMUM: ${money(f.over)}. No amount of talking closes this at the asking price.`);
  if (f.rungs.length)
    L.push('THE CONCESSION LADDER:\n' + f.rungs.map(r =>
      `  · another ${money(r.step)} takes the offer to ${money(r.at)} — ${r.works
        ? `${money(r.leftAfter)} of headroom left after it`
        : 'past the maximum; the deal stops working'}`).join('\n'));
  if (f.termsValue !== null)
    L.push(`WHAT THE NON-PRICE TERMS ARE ALREADY WORTH TO THIS SELLER, in price: ${money(f.termsValue)}. This is the currency a concession can be paid for in.`);
  if (f.levers.length)
    L.push('THE TERMS AS THEY STAND:\n' + f.levers.map(l =>
      `  · ${l.lab}: ${l.now}${l.cost !== null ? ` (costs the investor ${money(l.cost)})` : ''}`).join('\n'));
  if (f.refused.length)
    L.push('EXITS THIS SHEET REFUSED TO PRICE, and why:\n' + f.refused.map(r => `  · ${r.exit} — ${r.why}`).join('\n'));
  const detail = [];
  if (f.arv !== null) detail.push(`repaired value ${money(f.arv)}`);
  if (f.repairs !== null) detail.push(`repairs ${money(f.repairs)}`);
  if (f.rent !== null) detail.push(`rent ${money(f.rent)} a month`);
  if (f.comps !== null) detail.push(`${f.comps} comparable sale${f.comps === 1 ? '' : 's'} behind the value`);
  if (f.confidence) detail.push(`confidence ${f.confidence}`);
  if (f.estimated.length) detail.push(`ESTIMATED rather than entered: ${f.estimated.join(', ')} — say so if an answer leans on one`);
  if (f.finance) detail.push(`the investor is paying: ${f.finance}`);
  if (detail.length) L.push('THE SHEET: ' + detail.join(' · '));
  L.push('\nWrite the objections.');
  return L.join('\n\n');
}

export const TOOL = {
  name: 'the_other_side',
  description: 'What the seller says back, what is underneath it, and the reply that is true on this sheet.',
  input_schema: {
    type: 'object',
    properties: {
      reading: { type: 'string', description: 'One sentence: what this seller is actually optimising for, from the situation and the terms. Not a personality sketch.' },
      objections: {
        type: 'array',
        minItems: 3, maxItems: 6,
        items: {
          type: 'object',
          properties: {
            says:    { type: 'string', description: 'The sentence as they would say it. One line, no quotation marks.' },
            beneath: { type: 'string', description: 'What is actually being asked. One line.' },
            answer:  { type: 'string', description: 'What the investor says back. Two or three sentences.' },
            verdict: { type: 'string', enum: ['hold','trade','walk'] },
            costs:   { type: ['number','null'], description: 'What conceding it would cost, when the facts contain the figure. Otherwise null.' },
          },
          required: ['says','beneath','answer','verdict'],
          additionalProperties: false,
        },
      },
    },
    required: ['reading','objections'],
    additionalProperties: false,
  },
};

/* ── every figure we supplied ───────────────────────────────────────────────
   The ceiling is deliberately IN this set: the panel is for the investor and
   an answer may reason from it even though the letter may not print it. */
export function allowedFigures(f){
  const s = new Set();
  const add = v => { if (typeof v === 'number' && Number.isFinite(v)) s.add(Math.abs(Math.round(v))); };
  ['asking','offer','ceiling','gap','headroom','over','arv','repairs','rent','termsValue','yourCost']
    .forEach(k => add(f[k]));
  for (const r of f.rungs){ add(r.step); add(r.at); add(r.leftAfter); }
  for (const l of f.levers) add(l.cost);
  return s;
}

/* ── and it is checked ──────────────────────────────────────────────────────
   Every dollar amount in every string the model returned, plus the `costs`
   field, against the figures we gave it. One miss refuses the draft. */
export function validate(data, facts){
  const ok = allowedFigures(facts);
  const invented = [];
  const seen = (text) => {
    for (const m of String(text || '').matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)){
      const v = Math.round(Number(m[1].replace(/,/g, '')));
      if (!Number.isFinite(v)) continue;
      /* single digits and small counts are days, percentages and bathrooms
         wearing a dollar sign by accident; the figures that matter are money */
      if (v < 100) continue;
      if (!ok.has(v)) invented.push('$' + m[1]);
    }
  };
  const list = Array.isArray(data && data.objections) ? data.objections : [];
  seen(data && data.reading);
  for (const o of list){
    seen(o.says); seen(o.beneath); seen(o.answer);
    if (typeof o.costs === 'number' && Number.isFinite(o.costs)
        && !ok.has(Math.abs(Math.round(o.costs)))) invented.push('$' + Math.round(o.costs));
  }
  if (!list.length) return { ok:false, invented:[], empty:true };
  return { ok: invented.length === 0, invented, empty:false };
}

/* the shape the browser gets: trimmed, verdicts normalised, nothing else */
export function clean(data){
  const V = new Set(['hold','trade','walk']);
  return {
    reading: String(data.reading || '').slice(0, 240),
    objections: data.objections.slice(0, 6).map(o => ({
      says:    String(o.says || '').slice(0, 200),
      beneath: String(o.beneath || '').slice(0, 240),
      answer:  String(o.answer || '').slice(0, 800),
      verdict: V.has(o.verdict) ? o.verdict : 'hold',
      costs:   (typeof o.costs === 'number' && Number.isFinite(o.costs)) ? Math.round(o.costs) : null,
    })).filter(o => o.says && o.answer),
  };
}
