// the regression board — run in small batches so no single call outlives the shell
import { execFile } from 'child_process';

// the core nineteen, then everything auth touches, then the new surfaces
const NAMES = [
  'v3','comps-verify','demo-verify','gating-verify','offline-demo','dist-handoff',
  'dist-priors','demo-walk','handoff-verify','arcade-handoff','exits-verify','drill-verify',
  'offer-model-verify','desk-v2-verify','desk-priors-verify','desk-hostile','desk-ux','drag-verify',
  'rules-verify','desk-verify',
  // the account is the thing that changed, so everything that reads one runs
  '_tauth','t-acct','t-acct2','t-guest','t-keep','t-flags','t-plans','t-pay','t-hub','t-first',
  // and the surfaces built since the last full board
  't-letter','t-bulk','t-photo','t-cond','t-legal','_twait','_tpay','_tcap','t-laws','t-ask','t-comp',
  // the paint itself: a var() that names nothing takes the whole declaration with it
  '_tvars','_tspace','_tcontrast','_tround','_ttabs',
  // the two gates that decide who spends money and who gets the best screen
  '_tphoto2','_tcomps',
  // a loss in green, and a demo that teaches the opposite of its own card
  '_tsign','_tdemos',
  // the first ninety seconds of the arcade
  '_tarcade','_tcompare','_tstreet',
  // S3: the bid check, both halves
  '_tbid','_tobj',
  /* one sheet, one verdict: every panel that names an exit or states a verdict
     must name the same one, on all five demos — and the two artefacts that
     leave the building (the letter, the printout) must carry it too */
  '_taudit','_tlock',
  // S5: the land desk — the page held to the approved ledger at both widths,
  // and the demo floor whose sixth door opens it
  '_tland','_tdemofloor','_tgutter','_tstage',
  /* the condition panel drives the ceiling, and "Sound" is $0 — a user found
     this one before we did, which is the reason it now has a harness */
  '_tcond',
  /* the bench: a loss must never wear the colour of a gain, and a ranking of
     walk-aways must never be presented as a pick */
  '_tbench',
  /* a best-fitting exit's NAME above a different exit's CEILING, with nothing
     between them — the bench, the deck, and the document a customer forwards */
  '_texit',
  /* a sample banner is a fact about a SHEET, a paid photo read is work, and a
     reload must land where the click landed */
  '_tcase',
  /* zero is a number somebody can type, and need() only catches null */
  '_tzero',
  /* the arcade: a game that forgets you, and a drill that could be played by
     reading the adjective instead of the numbers */
  '_dstreet','_tdrill2',
  /* one number, three cabinets, and it can go down */
  '_tbank',
  /* from the second audit: a sheet that leaves this browser must come back
     knowing its numbers; a demo must never reach a real sheet by any exit;
     and tierOf() paints while entitled() decides */
  '_tround2','_tdemoleak','_tgate',
  /* a figure the person gave us outranks one we worked out — the adopted
     contractor bid, the typed repairs, and the sliders they dragged */
  '_town',
  /* the photo read may not put a price on anything, and a zero ask is no ask */
  '_tprose',
  /* "how far away are we" is answered by the exit that can pay the MOST, not
     by the one that fits the seller best */
  '_treach',
  /* the verdict, the rankbar and the sensitivity sweep all rank kind-first —
     a ceiling and a room are not the same quantity and never were */
  '_tverdict',
  /* an unknown is not the best case, and a house that sold for nothing did
     not sell */
  '_tcomp0',
  /* "if you are wrong" means wrong AFTER you bought it, and one repair number
     renders the same in all three places */
  '_tsens',
  /* a missing repair figure answers the question it poses — how much work
     could this need and still work at their number — and a negative novation
     cheque refuses instead of dressing itself as a structural win */
  '_twork',
  /* the paperwork reader, held to the one rule it exists to obey: a figure the
     person gave us outranks one we were handed — and a read never lands as
     ENTERED, on the sheet OR in the comp workbench */
  '_tintake',
  /* two rooms, one answer: the tier grammar is written down twice on purpose,
     and this is the harness that makes that safe — by behaviour, not by text */
  '_tcross',
  /* the funnel is a SEQUENCE, not a set of pages, and the failures that matter
     live in the joins — a wall naming a plan the pricing page does not sell, a
     promise enforced differently in two rooms, a room nothing links to */
  '_tfunnel',
  /* ── FOUND OFF THE BOARD ─────────────────────────────────────────────────
     A sweep of everything on disk against everything in this list turned up
     twelve harnesses that could go red and never had. That is worse than no
     coverage, because the count at the bottom of this file reads like a
     promise. t-packet was the proof: it had been failing for as long as the
     demo gate has existed, and it took a deliberate audit to hear it.

     The buy box, the lender packet, and the four invariant audits written
     during the feature sweep: */
  't-box','t-packet','_tcompaudit','_tcondaudit','_texits8','_tofferaudit',
  /* and six older ones that still guard something real — the failure copy,
     the corner sweep, the comp arithmetic, the saved-data contract, the
     navigation graph, and the plain-language pass */
  't-fail','t-corners','t-cmp','t-data','t-nav','t-clarity',
  /* ── AND THE SCREEN NOBODY HAD TOUCHED ───────────────────────────────────
     _tspace, _tround and _tgutter all measure narrow widths by making a
     DESKTOP window small. `(hover:none)` and `(pointer:coarse)` never match
     there, so every rule this product writes for a thumb was invisible to the
     board — and the first page opened with hasTouch on had its phone-only
     answer height silently overridden by a later line. */
  '_ttouch',
  /* "Delete everything" cleared a browser and left the account, the profile
     and every synced sheet on the server — which the sync layer then restored
     on the next sign-in. The privacy page promises deletion in three rows. */
  '_tdelete',
];
/* ── WHAT IS DELIBERATELY *NOT* HERE ────────────────────────────────────────
   · _tlive — signs up a real person against the real Supabase project. It
     creates a row per run and goes red whenever the service rate-limits it,
     which is a red light meaning "the internet". Run it by hand at release,
     against a build made with the real keys. It now says so itself.
   · _d*.mjs — debug probes, kept because they are cheap to re-point.
   · thirty-odd t-*.mjs one-shots that print observations and always exit 0.
     A harness that cannot go red does not belong on a board; it makes the
     count larger and the protection identical. If one of them is guarding
     something worth guarding, give it an assertion first, then add it. */
/* srv/test-api.mjs, srv/test-pay.mjs and srv/test-urls.mjs run from their own
   directory and are not in this list:
     cd srv && node test-api.mjs && node test-pay.mjs && node test-urls.mjs
   test-urls stages dist/*.html beside the server and removes them again, so it
   wants a fresh `node publish.mjs` in front of it to be checking what ships. */

/* ── HOW LONG A HARNESS IS ALLOWED ─────────────────────────────────────────
   One flat 300s budget reported _tpay RED on two boards running while it
   passed perfectly on its own. It stands up a stub Stripe, a stub Supabase and
   a live-stage build, and then it WAITS — twenty-three seconds in one section,
   because the product's give-up window for a missing webhook is twenty and the
   harness has to outlast it. Under a six-wide board, with six Chromiums
   competing, even 480s was not enough.

   A red light that means "the harness ran out of clock" is worse than no light
   at all: it trains you to skim past red. So the two that legitimately take
   their time are named, and everything else still fails fast — a harness that
   hangs is a bug and should be caught, not accommodated. */
const SLOW = { _tpay: 900000, _tcap: 900000 };
const BUDGET = n => SLOW[n] || 300000;

const BATCH = Number(process.argv[2] || 6);
const only  = process.argv[3] ? process.argv.slice(3) : null;
const LIST  = only || NAMES;

const run = n => new Promise(res => {
  const t0 = Date.now();
  execFile('node', [n + '.mjs'], { cwd:'/home/claude', timeout: BUDGET(n), maxBuffer: 1<<24 },
    (err, so, se) => res({ n, code: err ? (err.code ?? 1) : 0,
      s: ((Date.now()-t0)/1000).toFixed(0),
      tail: (so+se).trim().split('\n').slice(-16).join('\n') }));
});

const bad = [];
for (let i = 0; i < LIST.length; i += BATCH){
  const slice = LIST.slice(i, i + BATCH);
  const rs = await Promise.all(slice.map(run));
  for (const r of rs){
    console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.n}  (${r.s}s)`);
    if (r.code !== 0){ bad.push(r.n); console.log(r.tail.split('\n').map(l => '      ' + l).join('\n')); }
  }
}
console.log('\n' + (bad.length ? 'RED: ' + bad.join(', ') : `ALL ${LIST.length} GREEN`));
process.exit(bad.length ? 1 : 0);
