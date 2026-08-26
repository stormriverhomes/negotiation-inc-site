/* ══ THE CALL FILLS THE SHEET ══════════════════════════════════════════════
   This is the seam where the two halves of the product fuse, and the reason
   no incumbent can copy the feature without rebuilding their core: they have
   a CRM with a phone attached, so a transcript can only ever become a note.
   We have an underwriting engine, so a transcript becomes INPUTS — the
   seller's own account of the roof, the timeline and the brother who wants
   his half, landing in the fields that decide what the house is worth.

   ── THE RULE THAT MAKES IT TRUSTWORTHY ────────────────────────────────────
   NOTHING EXTRACTED HERE IS EVER A FACT.

   Every finding carries the exact words it came from. The desk already
   distinguishes ENTERED from ESTIMATE and refuses to print a number it
   cannot justify; this extends that grammar to the phone. An operator
   looking at "roof: ~10 years" can see, without clicking, that it came from
   "roof's about ten years old I think" — and can tell the difference
   between that and having climbed up there.

   A machine that quietly upgrades a seller's guess into a measurement is
   the single most dangerous thing this product could contain, so the
   provenance is not decoration and is not optional: `quote` is required on
   every finding, and there is a test that fails if one is missing.

   ── WHY IT IS PATTERN-MATCHING TODAY ──────────────────────────────────────
   `extract()` is deterministic and dependency-free so it can be exercised,
   argued with, and unit-tested without an API key or a network. The Claude
   pass slots in as `extractWithModel()` — same output shape, same required
   provenance, and the local pass stays as the fallback and the test oracle.
   A model that returns a finding without a quote is discarded rather than
   trusted, which is the same rule applied to a smarter reader.            */

/* ── normalising, lightly ─────────────────────────────────────────────────
   Transcripts arrive with speaker labels, timecodes and filler. We keep the
   sentence as it was spoken for quoting, and match against a cleaned copy. */
const WORD_NUM = {
  zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8,
  nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15,
  sixteen:16, seventeen:17, eighteen:18, nineteen:19, twenty:20, thirty:30,
  forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90,
  hundred:100, thousand:1000,
};

export function sentences(transcript){
  const out = [];
  const lines = String(transcript || '').split(/\r?\n/);
  for (const raw of lines){
    /* strip "SELLER:" / "[00:14] Agent:" style prefixes but remember who */
    const m = raw.match(/^\s*(?:\[[\d:.]+\]\s*)?([A-Z][A-Za-z ]{1,18}?)\s*:\s*(.*)$/);
    const speaker = m ? m[1].trim().toLowerCase() : null;
    const body = m ? m[2] : raw;
    for (const s of body.split(/(?<=[.!?])\s+/)){
      const t = s.trim();
      if (t) out.push({ text: t, speaker });
    }
  }
  return out;
}

const clean = s => String(s).toLowerCase()
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/\s+/g, ' ').trim();

/** Sellers say numbers out loud, so this has to read all of these:
 *    "$120,000" · "120k" · "one hundred twenty thousand" · "eighty two"
 *
 *  THE LAST ONE IS THE INTERESTING CASE. "Another guy offered me eighty two"
 *  means eighty-two THOUSAND, and reading it as $82 would quietly turn a
 *  competing offer into a rounding error. So a bare figure under a thousand,
 *  in a sentence that is plainly about money, is scaled — for digits and for
 *  words alike, since the first version of this only did it for digits and
 *  lost every spoken number in the test call. */
const MONEY_CONTEXT = /\b(want|wanted|need|needs|asking|ask|offer|offered|get|got|take|paid|pay|worth|owe|owed|balance|payoff|repairs?|fix|quoted|price)\b/;

function wordsToNumber(t){
  let total = 0, cur = 0, saw = false;
  for (const w of t.replace(/[-,]/g,' ').split(/\s+/)){
    const v = WORD_NUM[w];
    if (v == null) continue;
    saw = true;
    if (v === 100) cur = (cur || 1) * 100;
    else if (v === 1000){ total += (cur || 1) * 1000; cur = 0; }
    else cur += v;
  }
  return saw ? total + cur : null;
}

export function parseMoney(text){
  const t = clean(text);
  let n = null, hadUnit = false;

  const digit = t.match(/\$?\s?(\d[\d,]*(?:\.\d+)?)\s*(k\b|thousand\b|m\b|million\b)?/);
  if (digit){
    n = parseFloat(digit[1].replace(/,/g,''));
    const unit = digit[2];
    if (unit && /^k|thousand/.test(unit)){ n *= 1000; hadUnit = true; }
    else if (unit && /^m|million/.test(unit)){ n *= 1e6; hadUnit = true; }
  } else {
    n = wordsToNumber(t);
    hadUnit = /\b(thousand|million)\b/.test(t);
  }
  if (n == null || !(n > 0)) return null;

  if (!hadUnit && n < 1000 && MONEY_CONTEXT.test(t)) n *= 1000;
  return Math.round(n);
}

/* ── WHAT WE LISTEN FOR ────────────────────────────────────────────────────
   Ordered most-specific first: a sentence is claimed by the first rule that
   matches so "my mother passed and I need to sell fast" becomes probate
   rather than generic urgency. Each rule names the field it fills, so the
   output maps onto the intake form rather than onto a summary nobody types
   back in. */
const RULES = [
  /* ── the seller's situation: what the desk calls the lead type ── */
  { field:'situation', value:'probate', confidence:'high',
    re:/\b(passed away|passed|died|deceased|inherit(ed|ance)?|my (mother|mom|father|dad|aunt|uncle|grandmother|grandfather)(?:'s)? (house|place|home|property)|estate|probate|executor|heir)\b/ },
  { field:'situation', value:'preforeclose', confidence:'high',
    re:/\b(behind on (the )?(payments|mortgage)|foreclos\w*|auction date|notice of default|catch up on payments|sale date)\b/ },
  { field:'situation', value:'divorce', confidence:'high',
    re:/\b(divorc\w+|split(ting)? (up|the house)|my ex\b|separat(ed|ion))\b/ },
  { field:'situation', value:'tired', confidence:'medium',
    re:/\b(tired of (being a )?landlord|done being a landlord|sick of (the )?tenants?|rental headache|tenant (from hell|nightmare)|not cut out for)\b/ },
  { field:'situation', value:'vacant', confidence:'medium',
    re:/\b(sitting (empty|vacant)|been (empty|vacant)|nobody('s| is| has been) (living|been) (there|in it)|it'?s empty)\b/ },
  { field:'situation', value:'relocating', confidence:'medium',
    re:/\b(moving (out of state|to|away)|relocat\w+|new job in|transferred)\b/ },

  /* ── the clock: the single most valuable thing a seller says ── */
  { field:'timeline', value:'hard date', confidence:'high',
    re:/\b(by the (\d{1,2}(st|nd|rd|th)?|first|fifteenth|thirtieth|end of the month)|before (the )?\w+ \d{1,2}|deadline|closing date|has to be (done|closed|sold) by)\b/ },
  { field:'timeline', value:'urgent', confidence:'medium',
    re:/\b(as soon as possible|asap|right away|quickly|in a hurry|need to move fast|yesterday)\b/ },
  { field:'timeline', value:'no rush', confidence:'medium',
    re:/\b(no (real )?(rush|hurry)|whenever|not in a hurry|take (my|our) time|no deadline)\b/ },

  /* ── who actually decides ── */
  /* A RELATIVE IN A SENTENCE IS NOT A CO-DECIDER.
     The first version matched "my mother" and so read "My mother passed and
     I inherited it" as evidence that somebody else has to agree — sending
     the operator chasing a co-owner who has been dead for five years. What
     actually signals a shared decision is a relative PLUS agreement or
     ownership language, or an explicit phrase on its own. */
  { field:'decision_maker', value:'shared', confidence:'high',
    re:/\b(we'?d both|(has|have|would have) to agree|talk to (my|the) (family|kids|siblings|brother|sister)|co-?owner|other heirs?|half (his|hers|theirs|mine)|my (brother|sister|wife|husband|partner|son|daughter)\b[^.]*\b(agree|agrees|half|owns?|share|signs?|wants?|says?)\b)/ },
  { field:'decision_maker', value:'sole', confidence:'medium',
    re:/\b(it'?s (just )?me|i'?m the only|sole (heir|owner)|no (siblings|brothers|sisters|other heirs))\b/ },

  /* ── occupancy: decides possession and the rehab start date ── */
  { field:'occupancy', value:'vacant', confidence:'high',
    re:/\b(tenant (moved out|left|is gone)|it'?s (vacant|empty)|nobody'?s (in|there)|moved out (last|in) \w+)\b/ },
  { field:'occupancy', value:'tenant', confidence:'high',
    re:/\b(tenant('s| is) still|renters? (in|are)|they'?re still (in|living)|lease (runs|until|through))\b/ },
  { field:'occupancy', value:'owner', confidence:'medium',
    re:/\b(i live (there|in it)|we live (there|in it)|it'?s my home|still living there myself)\b/ },

  /* ── condition, line by line, in the seller's words ── */
  { field:'condition.roof', confidence:'medium',
    re:/\broof\b/, value: m => /new|replaced|last year|\b(20\d\d)\b/.test(m) ? 'recent'
      : /leak|bad|needs|old|shot|going/.test(m) ? 'needs work' : 'mentioned' },
  { field:'condition.hvac', confidence:'medium',
    re:/\b(hvac|furnace|air conditioning|a\/?c\b|heat pump|heating)\b/,
    value: m => /new|replaced|works fine/.test(m) ? 'recent'
      : /out|broke|dead|doesn'?t work|not working|old/.test(m) ? 'needs work' : 'mentioned' },
  { field:'condition.plumbing', confidence:'medium',
    re:/\b(plumbing|pipes|water heater|septic|sewer)\b/,
    value: m => /new|replaced/.test(m) ? 'recent'
      : /leak|burst|backed up|bad|old|galvani/.test(m) ? 'needs work' : 'mentioned' },
  { field:'condition.electrical', confidence:'medium',
    re:/\b(electrical|wiring|breaker|fuse box|panel|knob and tube|aluminum wiring)\b/,
    value: m => /new|updated|replaced/.test(m) ? 'recent'
      : /old|fuse box|knob and tube|aluminum|needs/.test(m) ? 'needs work' : 'mentioned' },
  { field:'condition.foundation', confidence:'high',
    re:/\b(foundation|settling|crack(s|ing)? in the (wall|floor|slab)|crawl ?space)\b/,
    value: m => /fine|no (issues|problems)|solid/.test(m) ? 'recent' : 'needs work' },
  { field:'condition.water', confidence:'high',
    re:/\b(water damage|flood(ed|ing)?|mold|mildew|leak(ed|ing)? (into|through))\b/,
    value: () => 'needs work' },
  { field:'condition.kitchen', confidence:'low',
    re:/\b(kitchen|cabinets|countertops?|appliances)\b/,
    value: m => /new|remodel|updated|redone/.test(m) ? 'recent'
      : /original|dated|old|needs/.test(m) ? 'needs work' : 'mentioned' },
  { field:'condition.bath', confidence:'low',
    re:/\b(bathroom|bath\b|shower|tub)\b/,
    value: m => /new|remodel|updated|redone/.test(m) ? 'recent'
      : /original|dated|old|only one/.test(m) ? 'needs work' : 'mentioned' },
  { field:'condition.cosmetic', confidence:'low',
    re:/\b(paint|carpet|flooring|floors|cosmetic|needs? a? ?(clean|refresh))\b/,
    value: () => 'mentioned' },
];

/* money sentences get their own pass because the NUMBER is the payload */
/* Ordered: a sentence is claimed once. "Another guy offered me eighty two"
   is a competing offer, not their ask, even though both rules could fire. */
const MONEY_RULES = [
  { field:'competing_offer',
    re:/\b(offered me|another (guy|buyer|investor|company)|someone (else )?offered|got an offer|other offer)\b/ },
  { field:'owed',
    re:/\b(owe|payoff|pay ?off|balance|mortgage is|line of credit|lien)\b/ },
  { field:'repairs_estimate',
    re:/\b(contractor (said|quoted)|quoted me|estimate (was|of)|repairs? (would|will|are going to) (be|cost)|cost to fix)\b/ },
  { field:'asking',
    re:/\b(i'?d (want|like|need)|looking (for|to get)|asking|hoping for|need (at least|around|about)|i want|we want|take)\b/ },
];

/* ── OBJECTIONS ────────────────────────────────────────────────────────────
   Not an intake field — a coaching signal. The live-call screen shows these
   back so the operator can see what they are actually up against. */
const OBJECTIONS = [
  { key:'price_low',   label:'Thinks the number is low',
    re:/\b(too low|low ?ball|insult|that'?s not (enough|much)|worth (a lot )?more|zillow says)\b/ },
  { key:'agent',       label:'Considering an agent',
    re:/\b(realtor|real estate agent|list(ing)? it|mls|broker)\b/ },
  { key:'trust',       label:'Not sure who you are',
    re:/\b(who are you|how do i know|scam|legit|never heard of)\b/ },
  { key:'thinking',    label:'Stalling for time',
    re:/\b(think about it|let me think|call me back|not ready|sleep on it)\b/ },
  { key:'other_offer', label:'Shopping other buyers',
    re:/\b(other (offers|buyers|investors)|shopping (it )?around|see what else)\b/ },
];

/** THE ONE ENTRY POINT.
 *  → { findings, objections, summary, suggested }
 *  Every finding: { field, value, confidence, quote, speaker } */
export function extract(transcript, opts = {}){
  const sents = sentences(transcript);
  const findings = [];
  const seen = new Set();
  const objections = [];

  for (const s of sents){
    const c = clean(s.text);
    if (!c) continue;
    /* the agent's own words are not evidence about the house */
    const fromSeller = s.speaker == null || !/agent|me\b|elijah|caller|rep/.test(s.speaker);

    /* ONE CLAIM PER FIELD, NOT ONE PER SENTENCE.
       The first version broke out of the loop after any match, which meant
       "It's just me, I'm the only heir, no siblings" was claimed by the
       probate rule (it contains "heir") and the sole-decision-maker fact —
       the more useful of the two — was thrown away. A sentence routinely
       carries two different KINDS of fact; what it must not do is answer the
       same question twice. So the guard is per-field. */
    const claimed = new Set();
    for (const r of RULES){
      if (claimed.has(r.field)) continue;
      if (!r.re.test(c)) continue;
      if (!fromSeller && r.field !== 'timeline') continue;
      const value = typeof r.value === 'function' ? r.value(c) : r.value;
      claimed.add(r.field);
      const key = r.field + '|' + value;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ field:r.field, value, confidence:r.confidence,
                      quote:s.text, speaker:s.speaker || 'seller' });
    }

    for (const r of MONEY_RULES){
      if (!r.re.test(c)) continue;
      const amount = parseMoney(c);
      if (amount == null || amount < 500) continue;
      const key = r.field + '|' + amount;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ field:r.field, value:amount, confidence:'medium',
                      quote:s.text, speaker:s.speaker || 'seller' });
      break;
    }

    for (const o of OBJECTIONS){
      if (o.re.test(c) && !objections.some(x => x.key === o.key))
        objections.push({ key:o.key, label:o.label, quote:s.text });
    }
  }

  /* ── the summary is built FROM the findings, never written freehand ──
     so there is no sentence in it that isn't traceable to something the
     seller said. */
  const by = f => findings.find(x => x.field === f);
  const summary = [];
  const sit = by('situation');
  if (sit) summary.push(`Situation: ${SIT_LABEL[sit.value] || sit.value}.`);
  const tl = by('timeline');
  if (tl) summary.push(`Timeline: ${tl.value === 'hard date' ? 'a fixed date is driving them'
    : tl.value === 'urgent' ? 'they want it done quickly' : 'no urgency'}.`);
  const ask = by('asking');
  if (ask) summary.push(`They named ${'$' + ask.value.toLocaleString('en-US')}.`);
  const comp = by('competing_offer');
  if (comp) summary.push(`Another buyer is at ${'$' + comp.value.toLocaleString('en-US')}.`);
  const dm = by('decision_maker');
  if (dm) summary.push(dm.value === 'shared'
    ? 'Not the only decision-maker — somebody else has to agree.'
    : 'They can decide on their own.');
  const occ = by('occupancy');
  if (occ) summary.push(`The house is ${occ.value === 'owner' ? 'owner-occupied'
    : occ.value === 'tenant' ? 'still tenanted' : 'vacant'}.`);
  const work = findings.filter(f => f.field.startsWith('condition.') && f.value === 'needs work');
  if (work.length) summary.push(`Condition flags: ${work.map(f =>
    f.field.split('.')[1]).join(', ')}.`);
  if (objections.length) summary.push(`Pushback: ${objections.map(o => o.label).join('; ')}.`);

  /* ── what to do next, as a SUGGESTION the operator confirms ── */
  const suggested = {};
  if (sit) suggested.situation = sit.value;
  if (ask) suggested.asking = ask.value;
  if (findings.some(f => f.field === 'timeline' && f.value === 'hard date'))
    suggested.nextAction = 'Confirm the date and work backwards from it';
  else if (objections.some(o => o.key === 'price_low'))
    suggested.nextAction = 'Send the working — show them how the number is built';
  else if (objections.some(o => o.key === 'thinking'))
    suggested.nextAction = 'Book the callback now rather than leaving it open';
  if (work.length >= 2) suggested.stage = 'negotiating';

  return { findings, objections, summary, suggested,
           sentences: sents.length,
           generatedAt: opts.now || new Date().toISOString() };
}

const SIT_LABEL = {
  probate:'probate / inherited', preforeclose:'behind on payments',
  divorce:'divorce', tired:'tired landlord', vacant:'vacant',
  relocating:'relocating',
};

/** Every finding must be able to point at the words it came from. A model
 *  that returns one without a quote is discarded, not trusted. */
export function validateFindings(findings){
  const bad = [];
  for (const f of findings || []){
    if (!f || typeof f !== 'object'){ bad.push('not an object'); continue; }
    if (!f.field) bad.push('missing field');
    if (f.value === undefined || f.value === null) bad.push(`${f.field}: no value`);
    if (!f.quote || !String(f.quote).trim()) bad.push(`${f.field}: NO PROVENANCE`);
  }
  return { ok: bad.length === 0, problems: bad };
}

/** The Claude pass, later. Same shape, same rule: anything the model returns
 *  without a quote is dropped and the deterministic pass fills the gap. */
export async function extractWithModel(transcript, { callModel, now } = {}){
  const local = extract(transcript, { now });
  if (!callModel) return local;
  try {
    const raw = await callModel(transcript);
    const kept = (raw && raw.findings || []).filter(f =>
      f && f.field && f.value != null && f.quote &&
      String(transcript).includes(String(f.quote).slice(0, 24)));
    if (!kept.length) return local;
    return { ...local, findings: kept, model:true,
             summary: raw.summary && raw.summary.length ? raw.summary : local.summary };
  } catch (e){
    return { ...local, modelError: e.message };
  }
}
