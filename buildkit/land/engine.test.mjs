/* The land engine, held to the design doc's worked example and to its own
   grammar. The Wimberley figures are the contract: if the engine cannot
   reproduce the ledger the design was approved on, one of them is lying. */
import { landModel, targetFor, siteCarryOf, SEPTIC_ALLOWANCE , lotComps,
         benchFor, clearedAcres, GRADES, TREES,
         sitePlan, planScale, polyArea, scaleBar, PARCEL, SQFT_PER_ACRE } from './engine.mjs';

let n = 0, bad = 0;
const ok = (name, got, want) => {
  n++;
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass){ bad++; console.log('✗ ' + name + '\n    got  ' + JSON.stringify(got) + '\n    want ' + JSON.stringify(want)); }
  else console.log('✓ ' + name);
};

/* ── 1 · the Wimberley worked example, lump path ──────────────────────────
   2.61 treed sloped acres, asking $214,000, finished lot $298,000, site work
   + carry $41,500 over 9 months as one estimated lump, 7% cost of sale. The
   design doc's ledger: clears $21,640; to clear $35,000 buy at $200,640. */
const wim = landModel({
  asking:   { v: 214000, prov: 'entered' },
  acres:    { v: 2.61,   prov: 'entered' },
  finished: { v: 298000, prov: 'estimate' },
  siteLump: { v: 41500,  prov: 'estimate' },
  sewer: 'unknown',
});
ok('wimberley clears',      wim.clears,   21640);
ok('wimberley saleCost',    wim.saleCost, 20860);
ok('wimberley target (derived, not decreed)', wim.target, 35000);
ok('wimberley ceiling',     wim.ceiling,  200640);
ok('wimberley concession sentence', wim.concession,
   'To clear $35,000, buy at $200,640 or less.');
ok('wimberley per-acre — the figure the design doc got wrong', wim.perAcre, 81992);
ok('wimberley reaches (214,000 ask vs 200,640 ceiling → 6.2%, a conversation)', wim.reaches, true);
ok('wimberley firm: septic named, not silently assumed',
   wim.firm.map(f => f.id), ['septic']);
ok('wimberley band exists (finished and site are estimates)',
   wim.band !== null && wim.band.lo < wim.clears && wim.band.hi > wim.clears, true);

/* ── 2 · targetFor derives the design's number ───────────────────────────── */
ok('targetFor(298000)', targetFor(298000), 35000);
ok('targetFor floor',   targetFor(100000), 25000);

/* ── 3 · refusals say what they need ─────────────────────────────────────── */
const noFin = landModel({ asking:{v:214000,prov:'entered'} });
ok('no finished value → refused', !!noFin.refused, true);
ok('refusal names the need', noFin.refused.needs, ['finished']);
const noSite = landModel({ asking:{v:214000,prov:'entered'}, finished:{v:298000,prov:'estimate'} });
ok('no site figure → refused', noSite.refused.needs, ['siteLump']);

/* ── 4 · no asking price still prices the ceiling ────────────────────────── */
const noAsk = landModel({ finished:{v:298000,prov:'estimate'}, siteLump:{v:41500,prov:'estimate'} });
ok('no ask: clears is null, not zero', noAsk.clears, null);
ok('no ask: ceiling stands', noAsk.ceiling, 200640);
ok('no ask: reach question does not arise', noAsk.reaches, true);

/* ── 5 · items beat the lump, and the unknown septic is priced IN ────────── */
const sc = siteCarryOf({
  site: [ { id:'clearing', v: 9000, prov:'estimate' },
          { id:'drive',    v: 6500, prov:'entered'  },
          { id:'power',    v: 2500, prov:'entered'  } ],
  siteLump: { v: 999999, prov:'estimate' },        // must be ignored
  months: { v: 9, prov:'entered' }, carryMo: { v: 600, prov:'estimate' },
  sewer: 'unknown',
});
ok('items win over the lump', sc.site, 9000 + 6500 + 2500 + SEPTIC_ALLOWANCE);
ok('septic allowance is inside the total, not a footnote', sc.assumed, SEPTIC_ALLOWANCE);
ok('carry = months × monthly', sc.carry, 5400);

/* ── 6 · the walk-away shape: a gap past the line is said, not softened ──── */
const walk = landModel({
  asking:   { v: 329000, prov:'entered' },
  finished: { v: 298000, prov:'estimate' },
  siteLump: { v: 41500,  prov:'estimate' },
});
ok('walk: the play does not reach their number', walk.reaches, false);
ok('walk: the gap is stated in dollars', walk.gap, 329000 - walk.ceiling);
ok('walk: clears is negative and printed as such', walk.clears < 0, true);

/* ── 7 · unverified access lands on the firm list ────────────────────────── */
const acc = landModel({
  asking:{v:214000,prov:'entered'}, finished:{v:298000,prov:'estimate'},
  siteLump:{v:41500,prov:'estimate'}, access:'unverified',
});
ok('unverified access must be confirmed before this prices firm',
   acc.firm.some(f => f.id === 'access'), true);

/* ── the way in: sold lots, scored, with the three inherited lessons ───────
   The residential bench learned these the hard way; the land bench is born
   knowing them: an unknown is not the best case, a lot that sold for nothing
   did not sell, and the suggestion may not claim support outside the sales
   that produced it. */
{
  const subj = 2.61;
  const out = lotComps([
    { price: 300000, acres: 2.5,  months: 3,  dist: 0.8 },   // the good one
    { price: 280000, acres: 2.4,  months: 14, dist: 2.2 },   // stale-ish, farther
    { price: 250000, acres: null, months: null, dist: null },// nothing but a price
    { price: 0,      acres: 2.6,  months: 1,  dist: 0.5 },   // "sold" for nothing
  ], subj);
  const [good, stale, bare, zero] = out.rows;
  ok('lots: a documented lot outranks an undocumented one', good.score > bare.score, true);
  ok('lots: and outranks the stale, farther one', good.score > stale.score, true);
  ok('lots: unknown distance does not wear the nearby gate',
     bare.score < good.score && /distance unknown/.test(bare.why.join(' ')), true);
  ok('lots: a lot that sold for nothing did not sell', zero.ok === false && zero.score === 0, true);
  ok('lots: three live comps counted, not four', out.n, 3);
  ok('lots: per-acre basis when the subject can speak it', out.basis, 'peracre');
  const b = [300000/2.5*subj, 280000/2.4*subj].sort((x,y)=>x-y);
  ok('lots: the suggestion sits inside the sales that produced it',
     out.suggest.value >= Math.floor(b[0]/500)*500 - 500 && out.suggest.value <= Math.ceil(b[1]/500)*500 + 500, true);
  ok('lots: and leans toward the better comp',
     Math.abs(out.suggest.value - b[1]) < Math.abs(out.suggest.value - b[0]), true);
}
{
  const out = lotComps([ { price: 210000, acres: null, months: 2, dist: 1 },
                         { price: 195000, acres: null, months: 5, dist: 2 } ], 2.61);
  ok('lots: without comp acreage the basis is whole lots', out.basis, 'lot');
  ok('lots: and the value stays inside the two sales',
     out.suggest.value >= 195000 && out.suggest.value <= 210000, true);
}
{
  const out = lotComps([ { price: 300000, acres: 2.5, months: 3, dist: 1 } ], 2.61);
  ok('lots: one sold lot is a data point, not a suggestion', out.suggest === null && out.n === 1, true);
}


/* ══ THE SITE-WORK BENCHMARKS ══════════════════════════════════════════════
   These are numbers this product puts on screen and invites somebody to press,
   in a trade where being wrong costs them a parcel. Three things have to hold
   and none of them is "the figure is right" — that is a research question, not
   an arithmetic one:

     · a line that CANNOT be honestly guessed must never produce a chip. The
       well is the test case: depth is the cost, depth is unknowable, and two
       published 2026 national averages disagree by a factor of two.
     · a line that NEEDS a fact must ask for it, not invent one.
     · every figure that lands must land as an ESTIMATE, and the sheet must
       widen for it. A rule of thumb painted as a quote is the failure mode
       this whole grammar exists to prevent. */
const CTX = { acres:2.61, trees:'wooded', grade:'roll', driveFt:300, poleFt:400 };
const chips = (id, c=CTX) => (benchFor(id, c).chips || []).map(x => x.v);

/* the refusals — the strongest thing on the panel */
ok('bench: a well is a phone call, not a figure', !!benchFor('water', CTX).call, true);
ok('bench: and it offers no chip to press', chips('water').length, 0);
ok('bench: the refusal names who to ring', typeof benchFor('water', CTX).call.who, 'string');
ok('bench: and what to ask them', benchFor('water', CTX).call.ask.length > 40, true);
/* the tap and the impact fees are refusals INSIDE a priced line — the wire
   prices, the co-op's aid-in-construction does not; the permits price, the
   impact fees do not. Both have to be said in the note or the figure lies by
   omission, which on these two lines is a five-figure omission. */
ok('bench: the power note refuses the tap out loud',
   /transformer|connection charge|allowance/i.test(benchFor('power', CTX).note), true);
ok('bench: the permit note refuses impact fees out loud',
   /IMPACT FEES ARE NOT IN THIS/.test(benchFor('permit', CTX).note), true);
ok('bench: the survey note separates platting from the survey',
   /[Pp]latting is a separate bill/.test(benchFor('survey', CTX).note), true);

/* what it asks for rather than guessing */
ok('bench: no tree cover, no clearing figure', benchFor('clear', { acres:2.61 }).needs, 'tree cover');
ok('bench: no length, no driveway figure', benchFor('access', { acres:2.61 }).needs, 'driveway length');
ok('bench: no grade, no earthwork figure', benchFor('drain', { acres:2.61 }).needs, 'the grade');
ok('bench: no acreage, no survey figure', benchFor('survey', {}).needs, 'acreage');
ok('bench: no distance, no power figure', benchFor('power', { acres:2 }).needs,
   'distance to the nearest pole');
/* and a line that needs nothing still prices — permits do not depend on the dirt */
ok('bench: permits price off an empty sheet', chips('permit', {}).length, 1);

/* the septic two-branch: the uncertainty here is BINARY, and a blended number
   would hide the one $1,000 purchase that ends it */
{
  const b = benchFor('septic', CTX);
  ok('bench: septic prices both branches', b.chips.length, 2);
  ok('bench: and the failure branch costs more', b.chips[1].v > b.chips[0].v * 1.8, true);
  ok('bench: and the note surfaces the perc test as the way out',
     /perc test is \$800 to \$1,200 and it collapses/.test(b.note), true);
  /* over about one in five, gravity distribution stops being allowed */
  const steep = benchFor('septic', { ...CTX, grade:'steep' });
  ok('bench: steep ground adds the pump', steep.chips[0].v > b.chips[0].v, true);
  ok('bench: flat ground does not', benchFor('septic', { ...CTX, grade:'flat' }).chips[0].v, b.chips[0].v);
}

/* the cleared area is not the parcel — a flat acre over-bills a short drive by
   a third and under-bills a long one badly */
ok('cleared: the envelope before any drive', clearedAcres(10, 0), 0.75);
ok('cleared: a 1,000ft drive is nearly half an acre on its own',
   Math.round((clearedAcres(10, 1000) - 0.75) * 100) / 100, 0.46);
ok('cleared: it never exceeds the parcel', clearedAcres(0.3, 1000), 0.3);
ok('cleared: an unknown parcel still clears an envelope', clearedAcres(null, 300) > 0.8, true);

/* the grade multiplier moves the lines it should and leaves alone the ones it
   should not — a permit fee does not care how the ground falls */
{
  const flat = v => benchFor(v, { ...CTX, grade:'flat' }).chips[0].v;
  const sev  = v => benchFor(v, { ...CTX, grade:'severe' }).chips[0].v;
  ok('grade: severe ground multiplies the drive', Math.round(sev('access') / flat('access') * 10) / 10, 4.5);
  ok('grade: and the earthwork', Math.round(sev('drain') / flat('drain') * 10) / 10, 4.5);
  ok('grade: it touches clearing only lightly — equipment access, not earthwork',
     sev('clear') / flat('clear') < 1.7, true);
  ok('grade: and never the permits', sev('permit'), flat('permit'));
  ok('grade: nor the survey', sev('survey'), flat('survey'));
  ok('grade: the bands are ordered', GRADES.map(g => g.mult), [1.0, 1.5, 2.5, 4.5]);
  ok('grade: and the steepest says the band is wider than it is useful',
     /wider than it is useful/.test(benchFor('drain', { ...CTX, grade:'severe' }).note), true);
}

/* clearing tracks the vegetation, which is the whole rate */
{
  const at = t => benchFor('clear', { ...CTX, trees:t, grade:'flat' }).chips[0].v;
  ok('trees: the four bands climb', at('open') < at('scatter') && at('scatter') < at('wooded')
     && at('wooded') < at('heavy'), true);
  ok('trees: heavy timber is several times open pasture', at('heavy') / at('open') > 5, true);
  ok('trees: and the note refuses a mulching quote for a pad',
     /Grubbed, not mulched/.test(benchFor('clear', CTX).note), true);
  ok('trees: every band is a real rate', TREES.every(t => t.ac >= 500 && t.ac <= 15000), true);
}

/* the survey scales sublinearly, because cost tracks the perimeter and the
   corner count, not the area — 100× the acreage is about 10× the bill */
{
  const s = a => benchFor('survey', { acres:a }).chips[0].v;
  ok('survey: it climbs with acreage', s(1) < s(10) && s(10) < s(100), true);
  ok('survey: but far slower than the acreage does', s(100) / s(1) < 12, true);
  ok('survey: a one-acre boundary is a four-figure job', s(1) >= 600 && s(1) <= 1200, true);
  ok('survey: a hundred acres has not run away', s(100) >= 5000 && s(100) <= 9500, true);
}

/* every chip carries the assumption it was computed under, because a figure
   somebody presses without knowing what it assumed is a figure they cannot
   argue with — and this whole sheet exists to be argued with */
{
  const bad2 = [];
  for (const id of ['clear','access','septic','power','survey','permit','drain']){
    const b = benchFor(id, CTX);
    for (const c of (b.chips || [])){
      if (!c.why || c.why.length < 25) bad2.push(id + ': a chip with no assumption named');
      if (!(c.v > 0)) bad2.push(id + ': a chip with no figure');
      if (!c.t) bad2.push(id + ': a chip with no label');
    }
    if (!b.note) bad2.push(id + ': a line with nothing said about it');
  }
  ok('bench: every chip names what it assumed', bad2, []);
}

/* ── THE TAKEOVER SAYS WHAT IT TOOK ───────────────────────────────────────
   "A sum of quotes outranks a gut figure" is right when the quotes are in and
   wrong at two lines of eight. Pressing two benchmarks used to replace a
   $41,500 lump with $13,700 and move the ceiling twenty-eight thousand
   dollars — in the buyer's favour, silently. The takeover stands; being
   invisible does not. */
{
  const two = siteCarryOf({ siteLump:{ v:41500, prov:'estimate' }, months:{v:9}, carryMo:null,
    site:[{id:'clear', v:2700, prov:'estimate'}, {id:'septic', v:11000, prov:'estimate'}],
    sewer:'unknown', access:'verified' });
  ok('takeover: the lines win, as they always did', two.site, 13700);
  ok('takeover: and the sheet records what it threw away',
     two.displaced, { was:41500, now:13700, by:27800, lines:2 });
  ok('takeover: it is on the before-this-prices-firm list',
     two.firm.some(f => f.id === 'siteitems'), true);
  ok('takeover: naming both figures and the swing',
     /\$41,500/.test(two.firm.find(f=>f.id==='siteitems').say)
     && /\$27,800/.test(two.firm.find(f=>f.id==='siteitems').say), true);
  /* lines that come to MORE than the lump are not a windfall and need no
     warning — nobody is harmed by a ceiling that fell */
  const over = siteCarryOf({ siteLump:{ v:10000, prov:'estimate' }, months:{v:9}, carryMo:null,
    site:[{id:'clear', v:30000, prov:'entered'}], sewer:'yes', access:'verified' });
  ok('takeover: pricing MORE than the lump warns about nothing', over.displaced, null);
  /* and with no lump at all there is nothing to displace */
  const clean = siteCarryOf({ siteLump:null, months:{v:9}, carryMo:null,
    site:[{id:'clear', v:30000, prov:'entered'}], sewer:'yes', access:'verified' });
  ok('takeover: no lump, no warning', clean.displaced, null);
  /* it reaches the model, or the page cannot show it */
  const m = landModel({ finished:{v:298000,prov:'estimate'}, asking:{v:214000,prov:'entered'},
    acres:{v:2.61,prov:'entered'}, siteLump:{v:41500,prov:'estimate'}, months:{v:9},
    site:[{id:'clear', v:2700, prov:'estimate'}, {id:'septic', v:11000, prov:'estimate'}],
    sewer:'unknown', access:'verified', target:null, carryMo:null });
  ok('takeover: and the model carries it to the page', m.displaced.by, 27800);
}


/* ══ THE PLAN IS A SCALE DRAWING, OR IT IS NOT DRAWN ══════════════════════
   A returned design put the marks at fixed coordinates: the drive was the same
   line at 150 feet and at 1,200, the cleared area the same rectangle on half an
   acre and on forty. It LOOKED quantitative and encoded nothing — and a picture
   that encodes nothing, drawn beside numbers that do, teaches somebody the
   numbers might not either. On a sheet whose whole position is "it shows its
   working" that is the most expensive decoration available.

   So these assertions are not about how it looks. They are about whether the
   geometry is a FUNCTION OF THE FIGURES. If a mark can be drawn without the
   figure that gives it a size, this file should go red. */
const ALL = ['clear','access','septic','power','survey','drain'];
const plan = (o) => sitePlan({ acres:2.61, driveFt:300, poleFt:400, priced:ALL, ...o });
const mark = (p, id) => p.marks.find(m => m.id === id);
/* the true length of a polyline, in plan units */
const pathLen = d => { const pts = d.slice(1).split(' L').map(s => s.split(',').map(Number));
  let L = 0; for (let i = 1; i < pts.length; i++)
    L += Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]);
  return L; };

/* ── no scale, no drawing. The refusal is the default, not the fallback ── */
{
  const p = sitePlan({ driveFt:300, poleFt:400, priced:ALL });
  ok('plan: with no acreage there is no scale', p.scale, null);
  ok('plan: and therefore nothing is drawn at all', p.marks.length, 0);
  ok('plan: and it says why, in words', /without acres there is no scale/.test(p.why), true);
  ok('plan: a zero acreage is not a scale either', sitePlan({ acres:0, priced:ALL }).marks.length, 0);
}

/* ── the scale itself: derived from the one figure that can set it ─────── */
{
  ok('scale: the sketch has a real area to divide into', polyArea(PARCEL) > 1000, true);
  const s1 = planScale(2.61), s4 = planScale(2.61 * 4);
  ok('scale: four times the acreage is twice the feet per unit',
     Math.abs(s4 / s1 - 2) < 0.001, true);
  /* the sanity check that catches a units error: 2.61 acres is about 337 feet
     square, so the drawing's 100 units must be a few hundred feet across */
  const across = planScale(2.61) * 100;
  ok('scale: 2.61 acres is a few hundred feet across, not a few or a few thousand',
     across > 400 && across < 1200, true);
  ok('scale: no acreage, no scale', planScale(null), null);
}

/* ── EVERY MARK IS A FUNCTION OF A FIGURE ──────────────────────────────── */
{
  /* the drive: its drawn length IS its length */
  const p3 = plan({ driveFt:300 }), p9 = plan({ driveFt:900 });
  const l3 = pathLen(mark(p3,'access').d), l9 = pathLen(mark(p9,'access').d);
  ok('drive: three hundred feet is drawn three hundred feet long',
     Math.abs(l3 * p3.ftPerUnit - 300) < 12, true);
  ok('drive: nine hundred is drawn three times as long', Math.abs(l9 / l3 - 3) < 0.06, true);
  ok('drive: and a drive too long for the parcel doubles back rather than leaving it',
     mark(p9,'access').folds > 0, true);
  ok('drive: a short one does not', mark(p3,'access').folds, 0);
  ok('drive: the fold is said in words, because it is a fact about the parcel',
     /doubles back/.test(mark(p9,'access').lab), true);
  /* and no length, no drive */
  ok('drive: no length figure, no drive drawn', mark(plan({ driveFt:null }), 'access'), undefined);

  /* the cleared ground: its drawn AREA is the area being charged for */
  const c = mark(plan({}), 'clear'), pl = plan({});
  const drawnAc = (c.w * c.h * pl.ftPerUnit * pl.ftPerUnit) / SQFT_PER_ACRE;
  ok('cleared: the rectangle drawn is the acreage being invoiced',
     Math.abs(drawnAc - clearedAcres(2.61, 300)) < 0.02, true);
  ok('cleared: a longer drive clears more ground, on the drawing too',
     mark(plan({ driveFt:1200 }), 'clear').w > c.w, true);

  /* the pad is a real building envelope, and it shrinks against a big parcel */
  const small = mark(plan({}), 'pad'), big = mark(plan({ acres:40 }), 'pad');
  ok('pad: sixty by forty feet, whatever the parcel',
     Math.abs(small.w * plan({}).ftPerUnit - 60) < 1.5, true);
  ok('pad: which is a speck on forty acres and not on two', big.w < small.w / 3, true);

  /* the wire: true length, and it stays on the drawing */
  const pw = plan({ poleFt:800 });
  const wl = pathLen(mark(pw,'power').d);
  ok('power: a run that FITS is drawn at its true length',
     mark(pw,'power').offDrawing === true || Math.abs(wl * pw.ftPerUnit - 800) < 12, true);
  ok('power: and its pole stays inside the picture',
     mark(pw,'power').offDrawing === true || mark(pw,'power').pole.every(v => v >= 3 && v <= 97), true);
  /* the one thing this drawing may never do: shorten a line and keep calling
     it a measurement. Too far to draw → say so, do not shrink it. */
  const far = mark(plan({ acres:0.3, poleFt:4000 }), 'power');
  ok('power: a run too long for the frame is NOT drawn to length', far.offDrawing, true);
  ok('power: and says so in words rather than lying quietly',
     /not drawn to length/.test(far.lab), true);
  ok('power: a pole further than the parcel is wide says so',
     /off the parcel|not drawn to length/.test(mark(plan({ poleFt:600 }),'power').lab), true);
  ok('power: no distance, no wire', mark(plan({ poleFt:null }), 'power'), undefined);
}

/* ── a line with no figure draws nothing. The drawing shows what has been
      PRICED, not what could be — or it is promising work nobody bought. ── */
{
  const none = plan({ priced: [] });
  for (const id of ['clear','access','pad','septic','power','survey'])
    ok('unpriced: nothing is drawn for ' + id, mark(none, id), undefined);
  ok('unpriced: the boundary is still there to be drawn on', none.scale, true);
  const only = plan({ priced: ['survey'] });
  ok('priced: pricing ONE line draws exactly that one',
     only.marks.filter(m => m.id !== 'water').map(m => m.id), ['survey']);
  ok('survey: the pins sit on the corners the survey is priced off',
     mark(only,'survey').at.length, PARCEL.length);
}

/* ── THE REFUSAL, ON THE DIRT ──────────────────────────────────────────────
   A well is the one thing here nobody can place or price from a desk. The
   drawing says so in the only warm colour the ground has, rather than putting
   a confident dot somewhere — and the moment somebody prices it themselves,
   the refusal goes. */
{
  ok('well: unpriced, the drawing refuses out loud', mark(plan({}), 'water').tone, 'refusal');
  ok('well: and says what it does not know', /nobody knows it yet/.test(mark(plan({}),'water').lab), true);
  ok('well: priced, the refusal goes',
     mark(plan({ priced:[...ALL,'water'] }), 'water'), undefined);
  ok('well: it is the ONLY warm mark on the drawing',
     plan({}).marks.filter(m => m.tone === 'refusal').map(m => m.id), ['water']);
}

/* ── the scale bar, which is what makes it a drawing rather than a picture ─ */
{
  for (const ac of [0.25, 1, 2.61, 10, 40, 160, 640]){
    const b = scaleBar(planScale(ac));
    ok('bar: ' + ac + ' acres gets a bar of a sane width',
       b.units >= 10 && b.units <= 40, true);
    ok('bar: ' + ac + ' acres reads a round number of feet',
       b.ft % 5 === 0 && b.ft > 0, true);
  }
  ok('bar: a bigger parcel needs a bigger bar',
     scaleBar(planScale(160)).ft > scaleBar(planScale(2.61)).ft, true);
}

console.log('\n' + (bad ? '✗ ' + bad + ' of ' + n + ' failed' : '✓ all ' + n + ' hold'));
process.exit(bad ? 1 : 0);
