/* The land engine, held to the design doc's worked example and to its own
   grammar. The Wimberley figures are the contract: if the engine cannot
   reproduce the ledger the design was approved on, one of them is lying. */
import { landModel, targetFor, siteCarryOf, SEPTIC_ALLOWANCE } from './engine.mjs';

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

console.log('\n' + (bad ? '✗ ' + bad + ' of ' + n + ' failed' : '✓ all ' + n + ' hold'));
process.exit(bad ? 1 : 0);
