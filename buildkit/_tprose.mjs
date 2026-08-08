/* THE PHOTO READ MAY NOT PUT A PRICE ON ANYTHING, AND A ZERO ASK IS NO ASK.

   Two findings, both about a number that should not exist.

   1 · Four of the five AI features check every dollar figure against a set we
       supplied. The photo read checked none — and it is the only one whose
       output is SAVED INTO THE SHEET and printed on a lender packet. A model
       whose own system prompt demonstrates converting scores to dollars could
       write "Kitchen and baths need roughly $45,000 of work" and have it
       render as the report's lead paragraph, directly above a repairs total of
       about $21,000 computed from the sliders that same read just set.

       The check can be absolute: this model is asked for `seen` and a
       percentage per line and is never handed a price, so any money token is
       invented by definition.

   2 · A TYPED zero in the asking box made `(ceil - 0)/0` Infinity, pinning
       every positive-ceiling exit to fit 96 — the ranking stopped carrying
       information — and `(0 - ceil)/0` is −Infinity, so it flagged
       "Recommended" too. offerModel had always read the same zero as ABSENT.
       Two panels, one figure, opposite readings. */
import { chromium } from 'playwright';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
let n=0,bad=0;
const ok=(t,p,x)=>{n++; if(!p){bad++;console.log('✗ '+t+(x!==undefined?'  ← '+JSON.stringify(x).slice(0,240):''));}else console.log('✓ '+t);};

/* ── 1 · the money stripper, on the server ───────────────────────────────── */
{
  const src = fs.readFileSync('srv/server.js', 'utf8');
  const i = src.indexOf('const SIZE_AFTER'), j = src.indexOf('function validate(d){');
  ok('the stripper exists in server.js', i >= 0 && j > i);
  if (i >= 0 && j > i){
    const mod = src.slice(i, j);
    const noMoney = new Function(mod + '; return noMoney;')();
    const t = [];
    const CASES = [
      /* invented prices go, and take their sentence with them */
      ['Kitchen and baths need roughly $45,000 of work; the mechanicals could not be seen.',
       'the mechanicals could not be seen.', 'a dollar figure'],
      ['The roof is at end of life. Budget 12k for it.', 'The roof is at end of life.', 'a k-suffixed figure'],
      ['Replacement runs 18,500 dollars.', '', 'a figure spelled with the word dollars'],
      ['Comps nearby sold for 310,000.', '', 'a bare comma-grouped figure'],
      /* honest prose stays */
      ['Dated but sound.', 'Dated but sound.', 'a plain observation'],
      ['Three bedrooms and 2 baths.', 'Three bedrooms and 2 baths.', 'small counts'],
      ['Built 1948, roughly 1,450 sq ft.', 'Built 1948, roughly 1,450 sq ft.', 'a square footage'],
      ['1,450 square feet and the kitchen is original.', '1,450 square feet and the kitchen is original.', 'a size in words'],
    ];
    for (const [inp, want, what] of CASES){
      const got = noMoney(inp, t);
      const drops = /\$|dollars|12k|310,000|18,500/.test(inp) && !/sq|square/.test(inp);
      ok(`${drops ? 'strips' : 'keeps'} ${what}`, got.trim() === want.trim(), { inp, got, want });
    }
    ok('and every stripped token is reported, not swallowed',
       t.includes('$45,000') && t.includes('12k') && t.includes('310,000'), t);
    ok('a square footage is never reported as a price', !t.some(x => /1,450/.test(x)), t);
  }
}

/* ── the whole server still passes its own suite ─────────────────────────── */
{
  const r = spawnSync('node', ['test-api.mjs'], { cwd:'srv', encoding:'utf8', timeout: 240000 });
  ok('srv/test-api.mjs still passes', r.status === 0, (r.stdout||'').split('\n').slice(-3).join(' '));
}

/* ── 2 · a zero ask, in the browser ──────────────────────────────────────── */
{
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport:{ width:1400, height:1100 } });
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,160)));
  await pg.goto('file://' + path.resolve('dist/desk.html')); await pg.waitForTimeout(600);

  const set = (asking) => pg.evaluate((ask)=>{
    P.props.length = 0; P.props.push(newProp('450 Chestnut St')); P.active = 0; loadInto(0);
    S.raw.arv = '200,000';  S.est.arv = true;  S.prov.arv = 'typed'; S.unc.arv = .05;
    S.raw.repairs = '10,000'; S.est.repairs = true; S.prov.repairs = 'typed'; S.unc.repairs = .05;
    S.raw.asking = ask;     S.est.asking = true; S.prov.asking = 'typed'; S.unc.asking = .05;
    S.repairsOwn = true;
    if (typeof recompute === 'function') recompute();
    if (typeof showResults === 'function') showResults();
    const R = rankedExits();
    const m = (typeof offerModel === 'function') ? offerModel() : null;
    return { ask: val('asking'),
      fits: R.live.map(x => x.fit),
      ids: R.live.map(x => x.id),
      recommended: /Recommended/.test(document.body.innerHTML),
      offerSaysNoAsk: !!(m && m.ask === null),
      infinite: R.live.some(x => !Number.isFinite(x.fit)) };
  }, asking);

  const zero = await set('0');
  console.log('   zero ask: ' + JSON.stringify(zero));
  ok('a typed zero is still read as a zero by val()', zero.ask === 0, zero);
  ok('no fit is Infinity or NaN', zero.infinite === false, zero);
  ok('the fits are NOT all pinned to one value',
     new Set(zero.fits).size > 1 || zero.fits.length <= 1, zero.fits);
  /* Two exits legitimately reach 96 with or without an ask — the novation
     caps against its own cheque benchmark, and the best-ceiling exit is 96 by
     construction in the no-ask branch. So "count the 96s" tests nothing.
     The property that actually matters is that a TYPED zero and a BLANK box
     produce the same ranking, because they now mean the same thing. */
  const blank = await set('');
  console.log('   blank ask: ' + JSON.stringify(blank.fits));
  ok('a typed zero ranks exactly as a blank ask does',
     JSON.stringify(zero.fits) === JSON.stringify(blank.fits) &&
     JSON.stringify(zero.ids)  === JSON.stringify(blank.ids),
     { zero: zero.fits, blank: blank.fits });
  ok('the offer page and the ranking agree it is no ask',
     zero.offerSaysNoAsk === true, zero);

  /* a real ask must still rank on the ask, or the fix has flattened the sheet */
  const real = await set('120,000');
  console.log('   real ask: ' + JSON.stringify(real));
  ok('a real asking price still drives the fits',
     new Set(real.fits).size > 1, real.fits);
  ok('and the offer page reads it as an ask', real.offerSaysNoAsk === false, real);
  ok('the two cases genuinely rank differently',
     JSON.stringify(zero.fits) !== JSON.stringify(real.fits), { zero: zero.fits, real: real.fits });

  ok('no page errors', errs.length===0, errs[0]);
  await b.close();
}

console.log('\n'+(bad? '✗ '+bad+' of '+n+' failed' : '✓ all '+n+' hold'));
process.exit(bad?1:0);
