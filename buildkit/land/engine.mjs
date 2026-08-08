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

/* ══ THE WAY IN ═════════════════════════════════════════════════════════════
   The refusal at the bottom of this file has said, since the first commit:
   "Comps for finished lots nearby are the way in — the same way the house
   sheet builds its ARV." This is that way in. Up to five sold lots, each
   scored for how much it deserves to be believed, and one suggested finished
   value with its basis stated.

   The residential bench taught three lessons the hard way and they are all
   applied here from birth rather than re-learned:
     · AN UNKNOWN IS NOT THE BEST CASE — a blank distance or age scores the
       neutral 60 and gates at 0.9, never the same-pocket 1.0 (the house
       bench shipped that bug twice, once in the weights and once in the gate)
     · A LOT THAT SOLD FOR NOTHING DID NOT SELL — a typed zero scores zero
     · THE SUGGESTION IS CLAMPED to the sales that produced it — a weighted
       mean may not claim support above every comp in the set

   What it deliberately does NOT have, yet: a market-rate time adjustment.
   That is a knob, and this sheet has not earned the knob — the score already
   discounts stale sales, and a rate nobody set silently repricing sold lots
   is exactly the kind of quiet arithmetic this product refuses. If the desk
   ever grows one, it arrives as a visible, movable figure, like everything
   else here.

   Distances gate wider than the house bench's, because acreage country IS
   wider: the next sold lot is rarely on the same street, and treating three
   miles of ranchland like three miles of subdivision would refuse every comp
   a rural buyer can actually find.

   BASIS: when the subject's acreage and a comp's are both known, the comp
   speaks in $/acre and the suggestion is $/acre × subject acres; otherwise it
   speaks in whole-lot dollars. Per-acre flattens the real curve — big
   parcels sell for less per acre — so a comp far from the subject's size
   says so in its why-line and pays for it in its score. */
export function lotComps(list, subjAcres){
  const n = v => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
  const rows = (Array.isArray(list) ? list.slice(0, 8) : []).map(c => {
    const price = n(c.price), acres = n(c.acres);
    const months = n(c.months) === null ? null : Math.max(0, c.months);
    const dist   = n(c.dist)   === null ? null : Math.max(0, c.dist);
    const row = { ...c, price, acres, months, dist,
                  ok: price !== null && price > 0,
                  noPrice: price !== null && !(price > 0) };
    if (!row.ok){ row.score = 0; row.perAcre = null; return row; }
    row.perAcre = (acres !== null && acres > 0) ? price / acres : null;

    const sRec  = months === null ? 60 : Math.max(0, 100 - months * (100/18));
    const sDist = dist   === null ? 60 : Math.max(0, 100 - dist * 18);
    const ratio = (subjAcres && acres) ? Math.min(subjAcres, acres) / Math.max(subjAcres, acres) : null;
    const sSize = ratio === null ? 60 : Math.max(0, 100 - (1 - ratio) * 120);
    const base = 0.35*sRec + 0.35*sDist + 0.30*sSize;
    const loc = dist === null ? 0.9 : dist <= 1 ? 1 : dist <= 3 ? 0.92 : dist <= 6 ? 0.8 : 0.6;
    const age = months === null ? 0.9 : months <= 6 ? 1 : months <= 12 ? 0.94 : months <= 24 ? 0.8 : 0.62;
    row.score = Math.round(Math.max(2, base * loc * age));
    row.why = [
      months === null ? 'age unknown' : months <= 4 ? 'sold recently' : Math.round(months) + ' months old',
      dist === null ? 'distance unknown' : dist <= 1 ? 'nearby' : dist.toFixed(1) + ' mi out',
      ratio === null ? 'size unknown'
        : ratio >= 0.72 ? 'similar size'
        : (acres > subjAcres ? 'much larger — per-acre understates a small lot\u2019s worth'
                             : 'much smaller — per-acre overstates a big parcel'),
    ];
    return row;
  });

  const live = rows.filter(r => r.ok);
  if (live.length < 2) return { rows, n: live.length, suggest: null };

  /* the basis: per-acre when the subject and enough comps can speak it */
  const usable = (subjAcres && live.filter(r => r.perAcre !== null).length >= 2)
    ? live.filter(r => r.perAcre !== null).map(r => ({ r, v: r.perAcre * subjAcres }))
    : live.map(r => ({ r, v: r.price }));
  const basis = (subjAcres && live.filter(r => r.perAcre !== null).length >= 2) ? 'peracre' : 'lot';

  const w = usable.map(x => Math.pow(x.r.score / 100, 2));
  const W = w.reduce((a, b) => a + b, 0) || 1;
  const mean = usable.reduce((t, x, i) => t + x.v * w[i], 0) / W;
  const vals = usable.map(x => x.v).sort((a, b) => a - b);
  const value = Math.round(Math.min(vals[vals.length - 1], Math.max(vals[0], mean)) / 500) * 500;

  return { rows, n: live.length, basis,
           suggest: { value, lo: Math.round(vals[0]), hi: Math.round(vals[vals.length - 1]),
                      perAcre: basis === 'peracre' ? Math.round(value / subjAcres) : null } };
}
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
  let site, siteEst, assumed = 0, displaced = null;

  if (items.length){
    site = R(items.reduce((t, i) => t + i.v, 0));
    siteEst = items.some(i => i.prov === 'estimate');
    /* ── IT TAKES OVER, AND IT SAYS WHAT IT TOOK ───────────────────────────
       "A sum of quotes outranks a gut figure" is the right rule when the
       quotes are IN. It is the wrong rule at two lines of eight, and the
       moment the panel grew one-press benchmarks that stopped being a corner
       case: pressing two of them silently replaced a $41,500 lump with
       $13,700 and moved the ceiling twenty-eight thousand dollars in the
       buyer's favour. Nothing on screen said the sheet had just thrown a
       figure away.

       The takeover stands — it is what pricing a line means — but it is not
       allowed to be invisible. It is the same consent grammar the house
       sheet uses when a photo read displaces typed repairs: do the useful
       thing, then say what you did, and name the figure you replaced so it
       can be argued with. A ceiling that rose because the sheet forgot
       something is the single most expensive way this product could be
       wrong. */
    if (lump !== null && R(lump) > site){
      displaced = { was: R(lump), now: site, by: R(lump) - site, lines: items.length };
      firm.push({ id:'siteitems', assumed: 0,
        say: items.length + (items.length === 1 ? ' line is' : ' lines are') + ' priced, totalling $'
           + site.toLocaleString('en-US') + ', and a sum of priced lines outranks a lump figure — so '
           + 'they have replaced the $' + R(lump).toLocaleString('en-US') + ' you had in. That is $'
           + (R(lump) - site).toLocaleString('en-US') + ' less site work, and every dollar of it went '
           + 'straight into what you can pay. If those ' + items.length + ' are genuinely all this '
           + 'parcel needs, good. If they are not, the ceiling above is too high by whatever is '
           + 'still missing — price the rest of the lines, or clear them and keep the lump.' });
    }
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
  return { site, carry, months, siteCarry: site + carry, siteEst, assumed, displaced, firm, missing:false };
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
    firm: sc.firm, displaced: sc.displaced,
    /* one sentence, assembled here so every surface prints the same one */
    concession: 'To clear $' + target.toLocaleString('en-US') + ', buy at $'
      + ceiling.toLocaleString('en-US') + ' or less.',
  };
}

/* ══ WHAT THE DIRT COSTS TO BECOME A LOT ═══════════════════════════════════
   The parcel facts used to be decoration. Acreage, slope and tree cover sat
   on the sketch as chips, changed no number anywhere, and the site-work bench
   below them was eight empty boxes with an em-dash for a placeholder. That is
   the exact sin this codebase calls out on the carry row — "a months box that
   changes no number is worse than no box" — committed at larger scale, on the
   single largest variable on the sheet.

   So the facts now price the work. Slope, tree cover, the length of the drive
   and the distance to the nearest pole are asked for because each one buys a
   benchmark, and a benchmark you can press is the difference between a panel a
   beginner uses and a panel a beginner closes.

   ── THE PART THAT MATTERS MORE THAN THE NUMBERS ───────────────────────────
   Three of these eight lines are ones this tool must NOT guess at, and saying
   so is worth more than eight confident figures would be:

     · A WELL. Depth is the cost and depth is unknowable until somebody
       drills. Two 2026 national averages disagree with each other by two
       times; the state spread runs seven to eight; two wells 500 feet apart
       on the same parcel differ by two. A confident number here is the kind
       of wrong that makes somebody distrust every other number on the sheet.
     · THE UTILITY TAP. Aid-in-construction is a tariff, not a market. $0 to
       $30,000 depending on one co-op's free-footage allowance.
     · IMPACT FEES. $0 to $40,000+, purely jurisdictional. A lookup, not an
       estimate — and on a well-and-septic lot the water and sewer components
       drop out, which in the one county fee schedule we can cite was 73% of
       the bill.

   For those three the panel gives a SCRIPT instead of a figure: who to ring,
   what to ask, and what the answer changes. A well-aimed refusal beats a bad
   estimate, and it is the same promise the rest of the product makes — the
   sheet refuses rather than guesses.

   Every figure below is a 2025–2026 national mid with the assumption named in
   the sentence that rides with it. They land as ESTIMATES, always: a rule of
   thumb is not a quote, and the engine widens the answer for every one of
   them. Regional labour spread on the estimable lines is about 1.33× top to
   bottom (RSMeans city index) — real, bounded, and named in the copy.        */

/* Grade bands. The multiplier is the lowest-confidence number in this file
   and it says so on screen: no industry body publishes a validated
   slope-to-cost table. It is synthesised from the one published driveway
   markup (20–50% for steep), one builder's tiered site-prep figures whose
   RATIOS are more useful than its dollars, and the earthwork geometry —
   balanced cut/fill volume on a slope goes as s·W²/4, linear in slope. The
   superlinearity in the real world is not the dirt; it is what the dirt
   FORCES: retaining, benching, a switchbacked drive, an engineered
   foundation, and above one in four, a discretionary planning review. */
export const GRADES = [
  { id:'flat',   lab:'Flat to gentle · under 5%',  mult:1.0,  say:'flat' },
  { id:'roll',   lab:'Rolling · 5–12%',            mult:1.5,  say:'rolling' },
  { id:'steep',  lab:'Steep · 12–25%',             mult:2.5,  say:'steep' },
  { id:'severe', lab:'Severe · over 25%',          mult:4.5,  say:'severe' },
];
export const TREES = [
  { id:'open',    lab:'Open · pasture or grass',        ac:1200 },
  { id:'scatter', lab:'Scattered trees, light brush',   ac:2750 },
  { id:'wooded',  lab:'Wooded',                          ac:5000 },
  { id:'heavy',   lab:'Heavy timber or thick brush',     ac:8500 },
];
const gradeOf = id => GRADES.find(g => g.id === id) || null;
const treesOf = id => TREES.find(t => t.id === id) || null;

/* The cleared area is NOT the parcel. A minimum-disturbance build clears the
   pad and its construction buffer, a staging area, the drainfield and its
   required reserve, and the drive corridor — about three quarters of an acre
   before the drive, plus roughly a 20-foot corridor along it. A flat one acre
   over-bills a short drive by a third and under-bills a long one badly: a
   1,000-foot drive is nearly half an acre of clearing on its own. */
export function clearedAcres(acres, driveFt){
  const drive = (Number.isFinite(driveFt) && driveFt > 0 ? driveFt : 0) * 0.00046;
  const want = 0.75 + drive;
  return acres && acres > 0 ? Math.min(acres, want) : want;
}

const R2 = n => Math.round(n / 100) * 100;

/* Each line answers with one of three shapes:
     { chips:[…], note }   — press a figure, it lands as an estimate
     { call:{…}, note }    — no figure; who to ring and what to ask
     { note }              — it needs a fact it has not been given yet
   `needs` names the missing fact in the person's words, so the panel can send
   them to the box that unlocks it instead of showing an empty row. */
export function benchFor(id, ctx = {}){
  const acres  = Number.isFinite(ctx.acres)  && ctx.acres  > 0 ? ctx.acres  : null;
  const drive  = Number.isFinite(ctx.driveFt)&& ctx.driveFt> 0 ? ctx.driveFt: null;
  const pole   = Number.isFinite(ctx.poleFt) && ctx.poleFt > 0 ? ctx.poleFt : null;
  const g  = gradeOf(ctx.grade);
  const tr = treesOf(ctx.trees);
  const cleared = clearedAcres(acres, drive);

  switch (id){

  case 'clear': {
    if (!tr) return { needs:'tree cover',
      note:'Say what is standing on it and this prices itself — clearing is a rate per acre, '
         + 'and the rate is the vegetation.' };
    const v = R2(tr.ac * cleared * (g ? Math.min(1.6, 1 + (g.mult - 1) * 0.25) : 1));
    return { chips:[{ t:'≈ ' + tr.lab.split(' ·')[0].toLowerCase(), v,
      why:'$' + tr.ac.toLocaleString('en-US') + ' an acre GRUBBED across the '
        + cleared.toFixed(2) + ' acres a single lot actually disturbs — pad, buffer, staging, '
        + 'drainfield and its reserve, and the drive corridor' }],
      note:'Grubbed, not mulched. A mulching quote comes in at a third of this and leaves the '
         + 'stumps and root mass in the ground — which is fine for a view and useless under a '
         + 'foundation or a drainfield. If a quote looks cheap, that is usually why.' };
  }

  case 'access': {
    if (!drive) return { needs:'driveway length',
      note:'A drive is priced by the foot, so it needs a length. Measure the route, not the '
         + 'straight line — on anything but flat ground they are different numbers.' };
    const base = 32;                                   // $/LF, 12ft gravel, 6–8" base
    const v = R2(base * drive * (g ? g.mult : 1));
    return { chips:[{ t:'≈ gravel, ' + drive.toLocaleString('en-US') + ' ft', v,
      why:'$' + base + ' a foot for 12-foot gravel on a proper base'
        + (g && g.mult > 1 ? ', × ' + g.mult + ' for ' + g.say + ' ground' : '') }],
      note:'Culvert and headwall are not in this — add $500 to $2,000 if the drive crosses a '
         + 'ditch. Above about one in eight, most codes cap the grade and the drive stops '
         + 'running straight: switchbacks add half again to double the length you measured.' };
  }

  case 'septic': {
    /* the two-branch estimate, because the uncertainty here is BINARY and a
       blended number hides the one purchase that resolves it */
    const pump = g && (g.id === 'steep' || g.id === 'severe') ? 5000 : 0;
    return { chips:[
        { t:'≈ it percs', v: R2(11000 + pump),
          why:'a conventional gravity drainfield'
            + (pump ? ' plus a pump — over about one in five, gravity distribution stops being allowed' : '') },
        { t:'≈ it fails',  v: R2(24000 + pump),
          why:'an aerobic or mound system — what slow clay, fast sand, a seasonal water table or '
            + 'shallow bedrock forces you into. It is two to three times conventional, not thirty per cent more' },
      ],
      /* the lead sentence is the one that gets read, so it is the one that
         costs money — and on this line that is not a warning, it is an
         instruction. A perc test is the cheapest thing anybody buys in this
         whole trade: a thousand dollars ends a thirteen-thousand-dollar
         question, and it is the best moment the sheet has. It does not go
         behind a "why". */
      note:'A perc test is $800 to $1,200 and it collapses this thirteen-thousand-dollar '
         + 'question to a quote — buy it before you argue about the price. It is the cheapest '
         + 'uncertainty on the whole sheet to end, and the only one where a thousand dollars '
         + 'buys you a number instead of an opinion.' };
  }

  case 'water':
    return { call:{
      who:'two well drillers who work that county',
      ask:'what they are getting for depth on recent wells nearby, their price a foot, and — '
        + 'this is the one people forget — what happens if they miss. You pay for the hole either way.',
      why:'Depth is the cost, and depth is not knowable until somebody drills. Two wells five '
        + 'hundred feet apart on the same parcel come in at double each other.' },
      note:'A national average would be a made-up number here: the two published for 2026 '
         + 'disagree with each other by two times, and the state spread runs seven. Several states '
         + 'publish well logs with real depths from neighbouring parcels — that is a better answer '
         + 'than any average, and it is free.' };

  case 'power': {
    if (!pole) return { needs:'distance to the nearest pole',
      note:'The wire is priced by the foot from the nearest energised pole. Pace it or measure it '
         + 'on a map — this is the one utility figure that behaves.' };
    /* the pole count goes IN THE LABEL. At four hundred feet the two options
       price within a few hundred dollars of each other, and two chips showing
       the same figure read as a broken calculator unless the sheet says why
       they met — which is the actual lesson: overhead is cheaper right up
       until it needs poles, and then it stops being. */
    const nPoles = Math.max(0, Math.round(pole / 250) - 1);
    return { chips:[
        { t:'≈ overhead' + (nPoles ? ' · ' + nPoles + ' pole' + (nPoles===1?'':'s') : ' · no new poles'),
          v: R2(10 * pole + nPoles * 2800),
          why:'$10 a foot for the run'
            + (nPoles ? ', plus ' + nPoles + ' pole' + (nPoles===1?'':'s') + ' at $2,800 — one every 250 feet'
                      : ' — short enough to span from the existing pole') },
        { t:'≈ underground · trenched', v: R2(17 * pole),
          why:'$17 a foot — trench, conduit and conductor, and no poles to set' },
      ],
      note:'The transformer and the co-op’s own connection charge are NOT in this, and they '
         + 'are the ones that surprise people. Ring the co-op: "I need a line extension quote to '
         + 'this parcel, 200 amp single phase." It is free, it takes fifteen minutes, and their '
         + 'free-footage allowance can swing this from nothing to thirty thousand.' };
  }

  case 'survey': {
    if (!acres) return { needs:'acreage',
      note:'A boundary survey is priced off the perimeter, so it needs the acreage — and it is '
         + 'the one line here that behaves almost perfectly.' };
    const v = R2(Math.max(600, 900 * Math.pow(acres, 0.45)));
    return { chips:[{ t:'≈ boundary survey', v,
      why:'fitted to 2026 survey pricing across half an acre to a hundred — cost tracks the '
        + 'perimeter and the corner count, not the area, so it scales far slower than the acreage' }],
      note:'A long thin parcel costs more than a square one twice its size. Heavy tree cover '
         + 'pushes it up too — canopy blocks GPS and the crew has to traverse it. Platting is a '
         + 'separate bill and a separate problem: a by-right lot split runs $2,000 to $8,000, and '
         + 'one that trips a frontage, stormwater or traffic standard runs $15,000 to $40,000 and '
         + 'takes a year. Ask the county which one you are before you budget either.' };
  }

  case 'permit':
    return { chips:[{ t:'≈ hard permits & site plan', v: 4500,
      why:'building permit and plan review, the driveway and land-disturbance permits, the well '
        + 'and septic permits, and a civil site plan for one lot' }],
      note:'IMPACT FEES ARE NOT IN THIS, and they are a lookup rather than an estimate: nothing '
         + 'to $40,000+, entirely down to the jurisdiction. Many rural counties have none at all. '
         + 'Ask for the county fee schedule by name — and note that on a well-and-septic lot the '
         + 'water and sewer components drop out, which in the one schedule we can point at was '
         + 'nearly three quarters of the bill.' };

  case 'drain': {
    if (!g) return { needs:'the grade',
      note:'Earthwork is the one line slope really moves. Say roughly how the ground falls and '
         + 'this prices — leave it and the sheet will not guess.' };
    const v = R2((2000 * cleared + 3000 + 2000) * g.mult);
    return { chips:[{ t:'≈ ' + g.say + ' ground', v,
      why:'rough grading at $2,000 an acre across ' + cleared.toFixed(2) + ' disturbed acres, a '
        + '$3,000 building pad and $2,000 of silt fence and stabilisation, × ' + g.mult
        + ' for ' + g.say + ' ground' }],
      note:'ROUGH grading — moving dirt so you can build on it, not finishing it to lawn '
         + 'tolerance, which is fifteen times the rate and a different job. The grade multiplier '
         + 'is the softest figure on this page: nobody publishes a validated slope-to-cost table, '
         + 'so it is built from earthwork geometry and two thin sources.'
         + (g.mult >= 2.5 ? ' On ground this steep the band is wider than it is useful — retaining '
            + 'and benching are engineering, and engineering wants a quote.' : '') };
  }

  default: return { note:'' };
  }
}

/* ══ THE PLAN IS A SCALE DRAWING, OR IT IS NOT DRAWN ════════════════════════
   A picture beside a column of numbers makes a claim, whether or not it means
   to. Somebody looking at a driveway drawn across a parcel reads a LENGTH out
   of it, because that is what a drawing on a plot of land is for.

   So the returned design's ground had one flaw, and it is the flaw that would
   have mattered most on this product: the marks were at fixed coordinates. The
   drive was the same line at 150 feet and at 1,200. The cleared area was the
   same rectangle on half an acre and on forty. The power run did not lengthen
   when the pole got further away. It LOOKED quantitative and it encoded
   nothing — and a picture that encodes nothing, drawn next to numbers that do,
   quietly teaches somebody that the numbers might not either. On a sheet whose
   entire position is "it shows its working," that is the most expensive
   decoration available.

   Everything below is therefore derived. The acreage fixes a scale — feet per
   unit of the drawing — and every mark is placed at its true size in that
   scale. Change the driveway from 300 feet to 900 and the line gets three
   times longer; when it no longer fits across the parcel it doubles back,
   which is exactly what a real drive does and exactly what the cost model
   already assumes. There is a scale bar, because a scale bar is the
   difference between a drawing and a picture.

   AND WITH NO ACREAGE THERE IS NO SCALE, SO THERE IS NO PLAN. Just the
   boundary. That is not a degraded state, it is the same refusal the rest of
   this engine makes: it would rather show nothing than show something it
   cannot stand behind.

   None of this is ever drawn on the photorealistic ground. The sketch hides
   entirely when the 3D tiles come up — a schematic over real terrain is one
   short step from an invented survey, and this product does not invent facts
   about somebody's land. ═══════════════════════════════════════════════════ */

/** The surveyor's sketch, in a square 100×100 plan space. Illustrative — it is
 *  not this parcel's real shape, and nothing in the product claims it is. */
export const PARCEL = [[26,32],[62,24],[84,46],[66,72],[34,74],[22,52]];
export const SQFT_PER_ACRE = 43560;

/** Shoelace. Plan units². */
export function polyArea(pts){
  let a = 0;
  for (let i = 0; i < pts.length; i++){
    const [x1,y1] = pts[i], [x2,y2] = pts[(i+1) % pts.length];
    a += x1*y2 - x2*y1;
  }
  return Math.abs(a) / 2;
}
/** Feet per plan unit, from the one figure that can set a scale. */
export function planScale(acres){
  if (!(Number.isFinite(acres) && acres > 0)) return null;
  return Math.sqrt((acres * SQFT_PER_ACRE) / polyArea(PARCEL));
}
/** Is a point inside the sketch? Ray cast — used to fold a drive that has run
 *  out of parcel rather than letting it march off the edge. */
export function inParcel(x, y, pts = PARCEL){
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++){
    const [xi,yi] = pts[i], [xj,yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* real dimensions, in feet, of the things a single lot actually buys */
const PAD_FT   = [60, 40];    // a modest building pad
const FIELD_FT = [70, 30];    // a conventional drainfield
const GATE     = [24, 52];    // where the drive meets the road, on the sketch
const PAD_AT   = [55, 45];    // where the pad sits, on the sketch

const rd = n => Math.round(n * 100) / 100;

/** A polyline of a given TRUE length in feet, walking from the road toward the
 *  pad and folding back on itself when it runs out of parcel. A drive that is
 *  too long to fit in a straight line is a real fact about a parcel, and the
 *  drawing should say so rather than quietly rescaling until it fits. */
function driveRun(ft, ftPerUnit){
  const want = ft / ftPerUnit;                 // plan units of path length
  const pts = [GATE.slice()];
  let [x, y] = GATE, left = want;
  let dir = Math.atan2(PAD_AT[1] - y, PAD_AT[0] - x);
  let folds = 0;
  const STEP = 1.2;
  while (left > 0.01 && pts.length < 400){
    const s = Math.min(STEP, left);
    let nx = x + Math.cos(dir) * s, ny = y + Math.sin(dir) * s;
    if (!inParcel(nx, ny)){
      /* out of parcel: turn back across it. This is a switchback, and it is
         why steep and long drives cost what they cost. */
      dir += Math.PI * (folds % 2 ? -0.72 : 0.72); folds++;
      nx = x + Math.cos(dir) * s; ny = y + Math.sin(dir) * s;
      if (!inParcel(nx, ny)){ dir += Math.PI; nx = x + Math.cos(dir)*s; ny = y + Math.sin(dir)*s; }
    }
    x = nx; y = ny; left -= s;
    pts.push([x, y]);
  }
  return { pts, folds, reachesPad: folds === 0 };
}

/** A rectangle of a given TRUE area in square feet, centred on a point, kept
 *  to a sane aspect so it reads as ground rather than as a ribbon. */
function areaRect(sqft, ftPerUnit, cx, cy, aspect = 1.35){
  const units2 = sqft / (ftPerUnit * ftPerUnit);
  const h = Math.sqrt(units2 / aspect), w = h * aspect;
  return { x: rd(cx - w/2), y: rd(cy - h/2), w: rd(w), h: rd(h) };
}
function ftRect(wFt, hFt, ftPerUnit, cx, cy){
  const w = wFt / ftPerUnit, h = hFt / ftPerUnit;
  return { x: rd(cx - w/2), y: rd(cy - h/2), w: rd(w), h: rd(h) };
}

/** A scale bar that lands on a round number of feet and renders somewhere
 *  between a sixth and a third of the drawing wide. */
export function scaleBar(ftPerUnit){
  for (const ft of [10, 25, 50, 100, 200, 300, 500, 1000, 2000, 5000]){
    const u = ft / ftPerUnit;
    if (u >= 14 && u <= 34) return { ft, units: rd(u) };
  }
  const ft = Math.round((22 * ftPerUnit) / 25) * 25 || 25;
  return { ft, units: rd(ft / ftPerUnit) };
}

/**
 * The plan. Every mark is derived from a figure on the sheet; a line with no
 * figure draws nothing, and a sheet with no acreage draws no plan at all.
 *
 * `priced` is the set of site-work line ids that currently carry a number, so
 * the drawing shows what has been PRICED rather than what could be.
 */
export function sitePlan(ctx = {}){
  const acres   = Number.isFinite(ctx.acres)   && ctx.acres   > 0 ? ctx.acres   : null;
  const driveFt = Number.isFinite(ctx.driveFt) && ctx.driveFt > 0 ? ctx.driveFt : null;
  const poleFt  = Number.isFinite(ctx.poleFt)  && ctx.poleFt  > 0 ? ctx.poleFt  : null;
  const priced  = new Set(Array.isArray(ctx.priced) ? ctx.priced : []);
  const ftPerUnit = planScale(acres);

  if (!ftPerUnit) return { scale:null, ftPerUnit:null, marks:[], bar:null,
    why:'The boundary is a sketch until the acreage is in. Nothing else is drawn, because '
      + 'without acres there is no scale, and a plan without a scale is a picture.' };

  const marks = [];
  const cleared = clearedAcres(acres, driveFt);

  /* the disturbed ground, at its true area — this is the same figure the
     clearing benchmark charges for, so the drawing and the invoice agree */
  if (priced.has('clear'))
    marks.push({ id:'clear', kind:'rect', tone:'faint', dash:'2 4',
      ...areaRect(cleared * SQFT_PER_ACRE, ftPerUnit, PAD_AT[0], PAD_AT[1], 1.5),
      lab: cleared.toFixed(2) + ' acres cleared' });

  /* the drive, at its true length, folding when the parcel runs out */
  if (driveFt && priced.has('access')){
    const run = driveRun(driveFt, ftPerUnit);
    marks.push({ id:'access', kind:'path', tone:'strong', dash:'6 4', width:2.4,
      d: 'M' + run.pts.map(p => rd(p[0]) + ',' + rd(p[1])).join(' L'),
      folds: run.folds,
      lab: driveFt.toLocaleString('en-US') + ' ft of drive'
         + (run.folds ? ' — it does not fit straight, so it doubles back' : '') });
  }

  /* the pad: a real 60 × 40 building envelope, not a decorative box */
  if (priced.has('clear') || priced.has('drain'))
    marks.push({ id:'pad', kind:'rect', tone:'strong', width:1.6,
      ...ftRect(PAD_FT[0], PAD_FT[1], ftPerUnit, PAD_AT[0], PAD_AT[1]),
      lab: PAD_FT[0] + ' × ' + PAD_FT[1] + ' ft pad' });

  /* the drainfield and the reserve area the county makes you keep beside it —
     two of them, because that is what a septic permit actually requires */
  if (priced.has('septic')){
    const a = ftRect(FIELD_FT[0], FIELD_FT[1], ftPerUnit, PAD_AT[0] + 14 / ftPerUnit * 4, PAD_AT[1] + 9);
    const b = { ...a, y: rd(a.y + a.h + 2.2 / ftPerUnit * 4) };
    marks.push({ id:'septic', kind:'rect', tone:'mid', width:1.2, ...a,
      lab: FIELD_FT[0] + ' × ' + FIELD_FT[1] + ' ft drainfield' });
    marks.push({ id:'septic-reserve', kind:'rect', tone:'faint', dash:'3 3', width:1.2, ...b,
      lab:'the reserve area the permit makes you keep' });
  }

  /* the wire, at its true length, from the pole it actually comes from */
  if (poleFt && priced.has('power')){
    /* the run is drawn at its TRUE length, and on a small parcel that means
       the pole lands outside the boundary — which is the fact, not a glitch:
       four hundred feet is further than a two-acre parcel is wide. The angle
       is chosen so a long run stays on the DRAWING rather than marching off
       the edge of it, because a line that leaves the picture has stopped
       being a measurement. */
    const u = poleFt / ftPerUnit;
    let ang = Math.atan2(PAD_AT[1] - 30, PAD_AT[0] - 8) + 0.25, px = 0, py = 0, fits = false;
    for (let i = 0; i < 36; i++){
      px = PAD_AT[0] - Math.cos(ang) * u; py = PAD_AT[1] - Math.sin(ang) * u;
      if (px >= 3 && px <= 97 && py >= 3 && py <= 97){ fits = true; break; }
      ang += Math.PI / 18;
    }
    if (fits){
      marks.push({ id:'power', kind:'path', tone:'mid', dash:'9 5', width:1.2,
        d:'M' + rd(px) + ',' + rd(py) + ' L' + PAD_AT[0] + ',' + PAD_AT[1],
        pole:[rd(px), rd(py)], inside: inParcel(px, py), offDrawing:false,
        lab: poleFt.toLocaleString('en-US') + ' ft to the pole'
           + (inParcel(px, py) ? '' : ' — the pole is off the parcel') });
    } else {
      /* ── A MEASUREMENT THAT DOES NOT FIT IS SAID, NOT SHRUNK ────────────
         The first version clamped the far end back inside the frame, which
         drew an eight-hundred-foot run four hundred and forty feet long. That
         is the one thing this drawing may never do: every other line on it is
         its own length, so a line that quietly is not poisons all of them.
         When the pole is further away than the picture can hold, the picture
         stops claiming to hold it — a stub pointing the right way, and the
         distance in words. */
      const dx = Math.cos(ang), dy = Math.sin(ang), stub = 9;
      marks.push({ id:'power', kind:'ray', tone:'mid', dash:'9 5', width:1.2,
        d:'M' + rd(PAD_AT[0] - dx * stub) + ',' + rd(PAD_AT[1] - dy * stub)
          + ' L' + PAD_AT[0] + ',' + PAD_AT[1],
        tip:[rd(PAD_AT[0] - dx * stub), rd(PAD_AT[1] - dy * stub)],
        offDrawing:true, inside:false,
        lab: poleFt.toLocaleString('en-US') + ' ft to the pole — further than this drawing reaches, '
           + 'so it is not drawn to length' });
    }
  }

  /* survey pins on the corners the survey is actually priced off */
  if (priced.has('survey'))
    marks.push({ id:'survey', kind:'pins', tone:'strong', at: PARCEL.map(p => [p[0], p[1]]),
      lab: PARCEL.length + ' corners to set' });

  /* THE REFUSAL, ON THE DIRT. A well is the one thing here nobody can place or
     price from a desk, and the drawing says so in the only warm colour the
     ground has, rather than putting a confident dot somewhere. */
  if (!priced.has('water'))
    marks.push({ id:'water', kind:'unknown', tone:'refusal',
      x: rd(PAD_AT[0] - 16), y: rd(PAD_AT[1] - 12), size: rd(Math.min(8, 40 / ftPerUnit)),
      lab:'a well goes somewhere here — depth decides the cost, and nobody knows it yet' });

  return { scale:true, ftPerUnit: rd(ftPerUnit), cleared: rd(cleared), marks,
    bar: scaleBar(ftPerUnit),
    why:'Everything drawn is at its true size for ' + acres + ' acres. '
      + 'One inch of this drawing is not a guess — it is the figures above, to scale.' };
}
