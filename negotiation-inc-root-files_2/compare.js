/* ══ THE WRITTEN COMPARISON ═════════════════════════════════════════════════
   The compare screen already does the arithmetic: two or more sheets, one
   engine, a table of ceilings and room and fit, a verdict, and the point at
   which the answer flips. What it could not do is the thing a person actually
   needs at the end of it — hand somebody else the argument.

   That is what this writes. Not a summary of the table (they can read the
   table), but the CASE: why this one, what the other one has going for it,
   what would have to be true for the answer to change, and what to do next.

   ── THE ONE RULE THAT MAKES IT SHIPPABLE ──────────────────────────────────
   A model writing about money will produce a number that is nearly right, and
   a number that is nearly right on a document somebody forwards to a lender is
   worse than no document. So:

     · the model is given FACTS and no arithmetic to do. Every figure it could
       reasonably want — including the differences between sheets, which is the
       one thing it would otherwise be tempted to work out — is precomputed and
       handed over.
     · it is told, in the system prompt, that it may not write a number that is
       not in the facts.
     · and then it is CHECKED. validate() pulls every dollar amount out of the
       prose and refuses the whole draft if one of them is not a figure we
       supplied. The prompt is an instruction; this is the guarantee.

   The photo read does the same thing one layer down — it drops a line that
   scored what it claimed not to see. Same principle: the honesty is not left
   to the prompt. ═══════════════════════════════════════════════════════════ */

export const MODEL = process.env.NI_MODEL_COMPARE || process.env.NI_MODEL || 'claude-sonnet-4-5';

export const SYSTEM = `You are writing a short comparison of two or more property deals for the investor who priced them, so that they can forward it to a partner, a lender or a business partner without editing it.

You are given FACTS that were computed by an underwriting engine. You are a writer, not a calculator.

THE ABSOLUTE RULE: every number you write must appear verbatim in the facts you were given. Do not add, subtract, average, round, or convert anything. If you want to say one deal has more room than another, the difference is already in the facts — use it. If a number you want is not in the facts, write the sentence without it.

WHAT TO WRITE, in this order, as plain paragraphs with no headings:

1. The recommendation, in one sentence, naming the property and the exit.
2. The case for it — the two or three facts that actually decide it. "Room" is what the buyer can pay less what the seller wants; it is the figure that answers the question, and it should usually lead.
3. The honest case for the runner-up. Every deal has something. If the runner-up is better on spread or on confidence or on repairs, say so plainly. A comparison that only argues one side is a document nobody trusts twice.
4. What would change the answer. You are given the assumption that flips it and the value at which it flips — use them. If nothing flips it inside the ranges tested, say that instead.
5. One sentence on what to do next.

HOW TO WRITE IT:
- British-inflected plain English, in the register of a competent professional writing to another one. Short sentences. No exclamation marks, no salesmanship, no "exciting opportunity".
- Never use the words "leverage", "synergy", "robust", "unlock", "game-changer", or "deep dive".
- Do not open with "Based on the analysis" or "After reviewing". Open with the recommendation.
- Do not describe the process. Nobody wants to read that an engine ran.
- Between 120 and 220 words. Four or five short paragraphs. No bullet points, no headings, no markdown.
- If confidence on a sheet is low, or a figure is an estimate rather than entered, say so in the same breath as the number it affects. Never present an estimate as a fact.
- If a property has been refused by every exit, do not look for something nice to say about it. Say it does not work and why, and move on.`;

/* ── the facts, assembled here so the route cannot get the shape wrong ──────
   Everything the model might want, INCLUDING the differences, because the one
   number a writer reaches for that we would not otherwise supply is "X more
   than Y" — and that is exactly the number it would get subtly wrong. */
export function factsFrom(body){
  const sheets = Array.isArray(body && body.sheets) ? body.sheets.slice(0, 4) : [];
  if (sheets.length < 2) return null;

  const clean = s => ({
    name:    String(s.name || '').slice(0, 80),
    bestExit: String(s.bestExit || '').slice(0, 40),
    ceiling: num(s.ceiling), asking: num(s.asking), room: num(s.room),
    spread:  num(s.spread), repairs: num(s.repairs), arv: num(s.arv),
    fit:     num(s.fit),
    confidence: ['high','medium','low','none'].includes(String(s.confidence)) ? s.confidence : 'none',
    comps:   num(s.comps),
    estimated: Array.isArray(s.estimated) ? s.estimated.slice(0, 8).map(x => String(x).slice(0, 24)) : [],
    refused: !!s.refused,
  });
  const rows = sheets.map(clean);

  /* the winner, by room, which is what the screen ranks on */
  const withRoom = rows.map((r, i) => ({ i, room: r.room })).filter(x => x.room !== null);
  withRoom.sort((a, b) => b.room - a.room);
  const winner = withRoom.length ? withRoom[0].i : null;
  const runner = withRoom.length > 1 ? withRoom[1].i : null;

  /* every pairwise difference the prose could want, precomputed */
  const diffs = [];
  for (const k of ['room','ceiling','spread','repairs','arv']){
    for (let a = 0; a < rows.length; a++) for (let b = 0; b < rows.length; b++){
      if (a === b) continue;
      const x = rows[a][k], y = rows[b][k];
      if (x === null || y === null) continue;
      const d = Math.round(x - y);
      if (d > 0) diffs.push({ of:k, more: rows[a].name, than: rows[b].name, by: d });
    }
  }
  const flip = body && body.flip && typeof body.flip === 'object' ? {
    assumption: String(body.flip.assumption || '').slice(0, 40),
    at:         String(body.flip.at || '').slice(0, 40),
    winsAfter:  String(body.flip.winsAfter || '').slice(0, 80),
  } : null;

  return { sheets: rows, winner, runner, diffs: diffs.slice(0, 40), flip,
           note: 'Room is the ceiling less the asking price. A negative room means '
               + 'the seller wants more than any exit on that sheet can pay.' };
}
const num = v => (typeof v === 'number' && Number.isFinite(v)) ? Math.round(v) : null;

export function userBlock(facts){
  return 'FACTS\n' + JSON.stringify(facts, null, 1)
    + '\n\nWrite the comparison. Every number in your reply must appear above.';
}

/* ── THE GUARANTEE ─────────────────────────────────────────────────────────
   Pull every dollar amount out of the prose and check it against the set we
   supplied. A single invented figure fails the whole draft, because a draft
   that is right about four numbers and wrong about the fifth is the dangerous
   kind — it reads exactly as well as a correct one.

   Bare integers are not checked: "two right answers" and "four comps" are
   English, and a comparison that cannot say "three" is not worth having. Only
   money is checked, because money is what somebody acts on. */
export function allowedFigures(facts){
  const set = new Set();
  const add = v => { if (typeof v === 'number' && Number.isFinite(v)) set.add(Math.abs(Math.round(v))); };
  for (const s of facts.sheets){
    add(s.ceiling); add(s.asking); add(s.room); add(s.spread); add(s.repairs); add(s.arv);
  }
  for (const d of facts.diffs) add(d.by);
  return set;
}

export function validate(text, facts){
  const allowed = allowedFigures(facts);
  const bad = [];
  /* $1,234 / $1234 / −$1,234, and the same with a minus sign in front */
  for (const m of String(text).matchAll(/[−-]?\$\s?([\d][\d,]*)(?:\.\d+)?/g)){
    const n = Math.abs(parseInt(m[1].replace(/,/g, ''), 10));
    if (!Number.isFinite(n)) continue;
    if (!allowed.has(n)) bad.push(m[0].trim());
  }
  return { ok: bad.length === 0, invented: [...new Set(bad)].slice(0, 6) };
}
