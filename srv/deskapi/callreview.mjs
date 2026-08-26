/* ══ THE CALL, REVIEWED ════════════════════════════════════════════════════
   After a call with a transcript, one question: what would have made it
   better? Not a grade for its own sake — a wholesaler doing eighty dials a
   day does not want a report card, they want THE ONE THING to do differently
   on the next call. So the scorecard exists to produce its last line.

   Everything here is rules over the transcript — no model, no API, works on
   an aeroplane. It rides on the same machinery as everything else: the
   sentence splitter and the extract engine already know who said what and
   what was learned. This module only asks what was NOT learned, and a couple
   of things about conduct that the findings cannot see.

   And the product's honesty rule bends here in an interesting way: this is
   COACHING, not fact. A finding says "the seller said X" and must carry the
   quote. A review says "you might have asked about the payoff" — an opinion
   with a rationale. The screen labels it coaching, and nothing in it is ever
   written onto the lead as data.                                           */

/* ── what a discovery call is for ─────────────────────────────────────────
   The eight things worth knowing by the end of a first real conversation.
   Each maps onto the extract engine's own fields, so "covered" means the
   extractor actually found it — the same standard of evidence as the sheet. */
export const DISCOVERY = [
  { key:'situation', label:'Why they might sell',
    fields:['situation'],
    ask:"What's got you thinking about selling?" },
  { key:'condition', label:'Condition of the house',
    fields:['condition.roof','condition.hvac','condition.water','condition.bath',
            'condition.kitchen','condition.foundation','condition.electric'],
    ask:'If I walked through tomorrow, what would you warn me about first?' },
  { key:'occupancy', label:'Who lives there',
    fields:['occupancy'],
    ask:'Is anybody living in it right now?' },
  { key:'timeline', label:'Their clock',
    fields:['timeline'],
    ask:'If everything went smoothly, when would you want this done by?' },
  { key:'asking', label:'Their number',
    fields:['asking'],
    ask:'Have you thought about what you’d want for it?' },
  { key:'owed', label:'What is owed against it',
    fields:['owed'],
    ask:'Is there anything still owed on it — mortgage, line of credit, taxes?' },
  { key:'decision_maker', label:'Who has to agree',
    fields:['decision_maker'],
    ask:'Is this your call alone, or does somebody else need to sign off?' },
  { key:'competing_offer', label:'Who else is circling',
    fields:['competing_offer'],
    ask:'Has anyone else made you an offer?' },
];

/* ── conduct: things the findings cannot see ──────────────────────────────── */

/* A price is a digit with a $ on it, or number-words that END in a unit —
   "ninety thousand" is money, "ninety" alone is an age, and the first draft
   demanded two number-words BEFORE the unit, which made "ninety thousand"
   not money. */
const MONEY_RE = /\$\s?\d|(?:\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b[\s-]*)+(?:thousand|hundred k?|k\b)|\b\d{2,3}\s?k\b/i;

/* Who put a number on the table first. The discipline every negotiation
   drill teaches: let them name it — their number is information, yours is a
   concession. "agent" here is anyone who is not the seller. */
export function firstNumber(sents){
  for (const s of sents){
    if (!MONEY_RE.test(s.text)) continue;
    const who = s.speaker === 'seller' ? 'seller' : s.speaker ? 'agent' : null;
    if (who) return { who, quote: s.text };
  }
  return { who: null, quote: null };
}

/* Talk balance by word count. Not a virtue score — a discovery call simply
   cannot work if the caller does most of the talking, because the facts are
   on the other end of the line. */
export function talkBalance(sents){
  let agent = 0, seller = 0;
  for (const s of sents){
    const words = s.text.split(/\s+/).filter(Boolean).length;
    if (s.speaker === 'seller') seller += words;
    else if (s.speaker) agent += words;
  }
  const total = agent + seller;
  return { agentWords: agent, sellerWords: seller,
    agentShare: total ? Math.round(agent / total * 100) : null,
    speakers: total > 0 };
}

/* A next step, in words with a time in them. "I'll call you sometime" is not
   a next step; "tomorrow at 2:30" is. */
const NEXT_STEP_RE = /\b(tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week)\b|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\bin (an hour|the morning|the afternoon)\b/i;

export function nextStepAgreed(sents){
  for (let i = sents.length - 1; i >= 0; i--){
    const s = sents[i];
    if (s.speaker && s.speaker !== 'seller' && NEXT_STEP_RE.test(s.text))
      return { agreed: true, quote: s.text };
  }
  return { agreed: false, quote: null };
}

/* ── the review ───────────────────────────────────────────────────────────
   deps: { extract, sentences } — the injected extract engine, so the review
   and the sheet can never disagree about what was learned. */
export function reviewCall(transcript, deps){
  const { extract, sentences } = deps;
  const text = String(transcript || '');
  if (!text.trim()) return null;
  const sents = sentences(text);
  const r = extract(text);
  const found = new Set(r.findings.map(f => f.field));

  const coverage = DISCOVERY.map(d => ({
    key: d.key, label: d.label, ask: d.ask,
    covered: d.fields.some(f => found.has(f)),
  }));
  const covered = coverage.filter(c => c.covered).length;

  const first = firstNumber(sents);
  const balance = talkBalance(sents);
  const next = nextStepAgreed(sents);

  /* the one thing — chosen by cost, not by order. An uncovered payoff is the
     most expensive gap (it reprices the whole deal); then the decision-maker
     (a deal one signature short is not a deal); then their clock; then
     conduct. One suggestion, because two is a lecture. */
  let oneThing = null;
  const gap = k => coverage.find(c => c.key === k && !c.covered);
  if (balance.speakers && balance.agentShare != null && balance.agentShare > 65)
    oneThing = { key:'talk', text:'You did ' + balance.agentShare + '% of the talking. '
      + 'The facts are on their end of the line — ask, then wait.' };
  else if (first.who === 'agent')
    oneThing = { key:'anchor', text:'You named a number first. Their number is '
      + 'information; yours is a concession. Next time: "have you thought about '
      + 'what you’d want for it?"', quote: first.quote };
  else if (gap('owed'))
    oneThing = { key:'owed', text:'You never asked what is owed against the house. '
      + 'A payoff, a lien or back taxes reprices the whole deal — it is the most '
      + 'expensive question to skip.', ask: gap('owed').ask };
  else if (gap('decision_maker'))
    oneThing = { key:'decision_maker', text:'You never established who has to agree. '
      + 'A deal one signature short is not a deal.', ask: gap('decision_maker').ask };
  else if (gap('timeline'))
    oneThing = { key:'timeline', text:'You never got their clock. Urgency decides '
      + 'price more than condition does.', ask: gap('timeline').ask };
  else if (!next.agreed)
    oneThing = { key:'next', text:'The call ended without a next step that has a '
      + 'time in it. "I’ll call you sometime" is how leads go quiet.' };
  else {
    const g = coverage.find(c => !c.covered);
    oneThing = g
      ? { key: g.key, text:'Good call. The one gap: ' + g.label.toLowerCase()
          + '. Next time: "' + g.ask + '"' }
      : { key:'none', text:'Nothing to coach — every discovery area covered, they '
          + 'named the number, and a next step is on the clock. Go price it.' };
  }

  return {
    coverage, covered, of: DISCOVERY.length,
    firstNumber: first, balance, nextStep: next,
    findings: r.findings.length,
    oneThing,
    /* labelled for what it is, everywhere it travels */
    kind: 'coaching',
  };
}
