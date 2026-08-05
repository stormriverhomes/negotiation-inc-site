/* ══ THE BID CHECK ══════════════════════════════════════════════════════════
   A contractor's bid arrives as a wall of text. The question a person actually
   has about it is not "is this a fair price" — nobody can answer that from a
   desk — it is the narrower and far more answerable one:

       WHAT IS ON MY SHEET THAT IS NOT IN THIS BID?

   That is where the money goes. A bid that comes in eight thousand under the
   estimate because it does not mention the panel is not eight thousand
   cheaper; it is the same job with the panel moved to a change order, and the
   change order is priced after you own the house.

   The desk already has an opinion about all seventeen systems, built line by
   line from the condition read. So the bid check is a JOIN, and a join is
   arithmetic, and arithmetic is not a thing a language model should be doing
   on somebody's money.

   ── THE DIVISION OF LABOUR ────────────────────────────────────────────────
   The model does exactly ONE job: read the pasted bid and say which of the
   seventeen systems each line belongs to. That is a language problem —
   "R&R 30yr arch. shingle w/ synthetic underlayment, incl. tear-off" is a roof
   and nothing else in this file could reliably know that.

   Everything with a dollar sign on it is done here, in JavaScript:
     · the per-line differences
     · the omissions, and what the sheet had for each
     · the scope in the bid that the sheet never priced
     · every total, and whether the bid's own stated total agrees with its own
       line items, which is worth checking more often than you would think

   ── AND THEN IT IS CHECKED ────────────────────────────────────────────────
   Every amount the model reports has to appear, verbatim, in the text it was
   given. A model that has misread £1,450 as $14,500 fails that test, and so
   does one that has helpfully totalled two lines for us. Items that fail are
   dropped and counted, and the count is returned, because a bid where four
   lines could not be read honestly is a bid the person should look at
   themselves rather than one we quietly summarise.

   No prose is generated here at all. The output is a table and a list of
   omissions, and the desk renders it. There is nothing for a model to be
   eloquent about, and every sentence it did not write is a sentence that
   cannot be wrong. ═══════════════════════════════════════════════════════ */

import { LINES, LINE_IDS } from './prompt.js';

export const MODEL = process.env.NI_MODEL_BID || process.env.NI_MODEL || 'claude-sonnet-4-5';

/* the longest bid we will look at. Past this it is a set of plans, not a bid,
   and truncating it would produce an omission list that is mostly an artefact
   of where we cut. */
export const MAX_BID_CHARS = Number(process.env.NI_BID_MAX_CHARS || 14000);

export const SYSTEM = `You are reading a contractor's bid for a house renovation and sorting its line items into a fixed set of building systems, for an investor who has already priced the same work themselves.

You are a reader, not an estimator and not a calculator.

THE ABSOLUTE RULES:

1. Every amount you report must appear IN THE BID TEXT, exactly as written there. Do not add two lines together. Do not convert, round, annualise or apportion anything. If a line has no price of its own — it is included in another line, or the bid says "TBD" — report it with a null amount rather than a guess.

2. Assign each line to ONE system id from the list you are given, or to "other". Use "other" when the work is real but is not one of the seventeen: a dumpster, a permit expediter, general conditions, a swimming pool, a detached garage. Do not force a line into a system it does not belong to just to avoid "other" — a misfiled line makes the investor's omission list wrong, which is the one thing this must not do.

3. If one bid line clearly covers several systems ("gut kitchen and both baths, $46,000"), assign it to the system carrying most of the work and name the others in the note. Do not split the money between them; you would be guessing at the split.

4. Report exclusions separately. Bids say what they are not doing — "excludes permits", "does not include appliances", "asbestos abatement by others" — and that sentence is often worth more to the reader than any line with a price on it. Quote it as written.

5. Do not editorialise about whether a price is high or low. You do not know this market and you have not seen the house.

WHAT COUNTS AS A LINE: something the bid presents as a unit of work. Section headers with no price are not lines. Subtotals and the grand total are not lines — put the grand total in "statedTotal" if the bid states one, and leave it out of the items.`;

/* ── the tool ───────────────────────────────────────────────────────────────
   Structured output, with the seventeen ids as an enum, so the model cannot
   return a system that does not exist. `other` is in the enum on purpose: a
   category for what does not fit is what stops a classifier inventing a fit. */
export const TOOL = {
  name: 'bid_lines',
  description: 'Sort the bid into line items against a fixed set of building systems, reporting only amounts that appear in the bid.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'One entry per line of work the bid prices. Not headers, not subtotals, not the grand total.',
        items: {
          type: 'object',
          properties: {
            text:   { type: 'string', description: 'The line as the bid words it, shortened to at most 90 characters. Do not paraphrase it into something friendlier.' },
            amount: { type: ['number','null'], description: 'The figure printed against this line, as a plain number. Null when the line carries no price of its own.' },
            line:   { type: 'string', enum: [...LINE_IDS, 'other'],
                      description: 'Which system this belongs to, or "other".' },
            note:   { type: 'string', description: 'Only when something needs saying: that it covers more than one system, that the price is provisional, that it is an allowance rather than a price.' },
          },
          required: ['text','amount','line'],
          additionalProperties: false,
        },
      },
      statedTotal: { type: ['number','null'], description: 'The grand total the bid states, if it states one. Null otherwise. Never your own sum.' },
      exclusions: {
        type: 'array',
        description: 'What the bid says it is NOT doing, quoted as written.',
        items: { type: 'string' },
      },
      unreadable: { type: 'string', description: 'One sentence, only if part of the bid could not be read as line items — a scanned table, a foreign currency, a price list with no work attached. Otherwise omit.' },
    },
    required: ['items','statedTotal','exclusions'],
    additionalProperties: false,
  },
};

/* ── what we send it ────────────────────────────────────────────────────────
   The bid, and the seventeen labels. NOT the sheet's own numbers: telling a
   classifier what we expect each line to cost is inviting it to nudge an
   amount toward the expectation, and the amounts are the one thing we need it
   to read rather than reason about. */
export function userBlock(text){
  const list = LINES.map(l => `  ${l.id}  ${l.lab}`).join('\n');
  return `THE SEVENTEEN SYSTEMS:\n${list}\n  other  work that is real but is none of the above\n\n`
       + `THE BID, exactly as it was pasted:\n<<<BID\n${text}\nBID>>>\n\n`
       + `Sort it. Report only amounts that are printed in the text above.`;
}

/* ── every money-shaped token in the source ─────────────────────────────────
   The guarantee behind the whole endpoint. A model that reports an amount not
   printed in the bid has either misread it or worked it out, and both are
   disqualifying. Written to be generous about FORMAT — $12,400 · 12400.00 ·
   12,400 · £12,400 all reduce to 12400 — and strict about VALUE. */
export function figuresIn(text){
  const set = new Set();
  const re = /[$£€]?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null){
    const whole = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(whole)) continue;
    const cents = m[2] ? Number('0.' + m[2]) : 0;
    set.add(whole);
    if (cents) set.add(Math.round((whole + cents) * 100) / 100);
    /* "12.4k" and "12,400" are the same money to a person writing a bid, and
       a reader who normalises the first into the second has not invented
       anything — so both forms of a k-suffixed figure are allowed. */
  }
  for (const k of String(text || '').matchAll(/(\d+(?:\.\d+)?)\s?k\b/gi)){
    const v = Number(k[1]) * 1000;
    if (Number.isFinite(v)) set.add(v);
  }
  return set;
}

/* ── the sheet, as the desk sees it ─────────────────────────────────────────
   `est` is what the desk's own condition read put on each line, in dollars.
   Lines the desk put nothing on are still carried: a bid that prices the roof
   the sheet thought was fine is not an omission, it is a disagreement, and the
   reader wants to see it. */
export function sheetFrom(body){
  const src = (body && typeof body.sheet === 'object' && body.sheet) || {};
  const sheet = {};
  let total = 0;
  for (const l of LINES){
    const v = Number(src[l.id]);
    const est = Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
    sheet[l.id] = { id: l.id, lab: l.lab, est };
    total += est;
  }
  return { sheet, total };
}

/* ── the join ───────────────────────────────────────────────────────────────
   All of the arithmetic in this feature happens in this function, and none of
   it anywhere else. */
export function reconcile(data, sheetIn, bidText){
  const { sheet, total: sheetTotal } = sheetIn;
  const allowed = figuresIn(bidText);
  const raw = Array.isArray(data && data.items) ? data.items : [];

  const items = [], dropped = [];
  for (const it of raw.slice(0, 200)){
    const line = LINE_IDS.includes(it.line) ? it.line : 'other';
    const text = String(it.text || '').slice(0, 90).trim();
    if (!text) continue;
    let amount = (typeof it.amount === 'number' && Number.isFinite(it.amount)) ? it.amount : null;
    if (amount !== null){
      amount = Math.round(amount * 100) / 100;
      if (!allowed.has(amount) && !allowed.has(Math.round(amount))){
        /* reported a figure that is not printed in the bid. Not repaired,
           not rounded into acceptance — dropped, and counted. */
        dropped.push({ text, amount, line });
        continue;
      }
    }
    items.push({ text, amount, line, note: it.note ? String(it.note).slice(0, 160) : undefined });
  }

  /* per system: what the bid prices against what the sheet expected */
  const byLine = {};
  for (const l of LINES) byLine[l.id] = { ...sheet[l.id], bid: 0, items: [], priced: false };
  const other = { id:'other', lab:'Not on the sheet', est: 0, bid: 0, items: [], priced: false };
  for (const it of items){
    const bucket = it.line === 'other' ? other : byLine[it.line];
    bucket.items.push(it);
    if (it.amount !== null){ bucket.bid += it.amount; bucket.priced = true; }
  }

  const rows = LINES.map(l => {
    const b = byLine[l.id];
    const bid = Math.round(b.bid);
    return {
      id: l.id, lab: l.lab, est: b.est, bid,
      /* a delta only means something when both sides have a number on them */
      delta: (b.priced && b.est > 0) ? bid - b.est : null,
      priced: b.priced,
      quoted: b.items.length > 0,
      items: b.items,
    };
  });

  /* THE LIST THIS FEATURE EXISTS FOR: on the sheet, absent from the bid. */
  const missing = rows.filter(r => r.est > 0 && !r.quoted)
                      .sort((a, b) => b.est - a.est)
                      .map(r => ({ id:r.id, lab:r.lab, est:r.est }));
  const missingTotal = missing.reduce((a, r) => a + r.est, 0);

  /* THE OMISSION'S QUIETER COUSIN: the bid names the work and puts no price on
     it — "permits: TBD", "flooring allowance", "by others". It is not missing
     from the bid, so it does not read as a gap, and it costs exactly as much
     as one. It gets its own list. */
  const provisional = rows.filter(r => r.est > 0 && r.quoted && !r.priced)
                          .sort((a, b) => b.est - a.est)
                          .map(r => ({ id:r.id, lab:r.lab, est:r.est,
                                       said: (r.items[0] && r.items[0].text) || '' }));
  const provisionalTotal = provisional.reduce((a, r) => a + r.est, 0);

  /* and its mirror: priced by the contractor, never priced by the sheet */
  const extra = rows.filter(r => r.priced && r.est === 0)
                    .map(r => ({ id:r.id, lab:r.lab, bid:r.bid }));
  const otherRow = other.items.length
    ? { lab:'Not one of the seventeen', bid: Math.round(other.bid), items: other.items }
    : null;

  const bidTotal = Math.round(items.reduce((a, i) => a + (i.amount || 0), 0));
  const stated = (typeof data?.statedTotal === 'number' && Number.isFinite(data.statedTotal)
                  && allowed.has(Math.round(data.statedTotal)))
    ? Math.round(data.statedTotal) : null;
  /* a bid whose own total does not match its own lines is worth saying out
     loud. Under a hundred dollars it is rounding; over it is a missing page. */
  const statedGap = stated === null ? null : stated - bidTotal;

  const unpriced = items.filter(i => i.amount === null).length;

  return {
    rows,
    missing, missingTotal,
    provisional, provisionalTotal,
    extra, other: otherRow,
    bidTotal, statedTotal: stated, statedGap,
    sheetTotal,
    gap: bidTotal - sheetTotal,
    /* what the bid would cost with the sheet's own figure for everything it
       did not mention OR did not price — the number a person is actually
       comparing against, and usually the only line of this that gets read */
    withMissing: bidTotal + missingTotal + provisionalTotal,
    counts: {
      items: items.length,
      dropped: dropped.length,
      unpriced,
      systemsQuoted: rows.filter(r => r.quoted).length,
      systemsOnSheet: rows.filter(r => r.est > 0).length,
    },
    dropped,
    exclusions: Array.isArray(data?.exclusions)
      ? data.exclusions.slice(0, 12).map(s => String(s).slice(0, 200)) : [],
    unreadable: data?.unreadable ? String(data.unreadable).slice(0, 240) : null,
  };
}

/* ── is there enough here to be worth returning? ────────────────────────────
   A bid we could read two lines out of produces an omission list with fifteen
   entries on it, which reads as a damning finding and is actually a parsing
   failure. Say so instead. */
export function readable(out){
  if (out.counts.items < 2) return 'Only one line could be read out of that. Paste the bid as text rather than a screenshot, or type the main lines in.';
  if (out.counts.dropped > out.counts.items) return 'Most of the figures that came back are not printed in the bid, so nothing here can be trusted. Nothing has been saved.';
  return null;
}
