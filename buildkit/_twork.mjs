/* THE QUESTION AN UNKNOWN ASKS.
   A missing repair figure used to leave the payday box blank. Now it answers
   the question the unknown poses — how much work could this house need and
   still work at their number — by bisecting the same engine every other panel
   stands on. This harness holds the line it draws to the engine itself, in
   both directions: AT the line the deal must reach, one step past it it must
   not. A workable-line that disagrees with the sheet it sits on would be the
   product contradicting itself in the one panel built to resolve an unknown. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/desk.html');
let n = 0, bad = 0;
const ok = (t, p, x) => { n++; if (!p){ bad++; console.log('✗ ' + t + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0, 260) : '')); } else console.log('✓ ' + t); };

const b = await chromium.launch();
const pg = await b.newPage({ viewport:{ width: 1400, height: 1200 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 180)));
await pg.goto(FILE); await pg.waitForTimeout(600);

const sheet = async (fields) => pg.evaluate((f) => {
  P.props.length = 0; P.props.push(newProp('12 Workable Way')); P.active = 0; loadInto(0);
  for (const [k, v] of Object.entries(f)){
    S.raw[k] = v; S.est[k] = false; S.prov[k] = 'typed'; S.unc[k] = 0.03;
  }
  if (typeof recompute === 'function') recompute();
  if (typeof showResults === 'function') showResults();
  render();
  const box = document.getElementById('payday');
  return { html: box ? box.innerHTML : '', text: box ? box.innerText.replace(/\s+/g, ' ') : '' };
}, fields);

/* ── 1 · the workable line rides the verdict, and agrees with the engine ───
   On an ARV+ask sheet the novation prices (it never buys the house), so the
   verdict box is occupied — and the buying exits sit refused behind the
   missing repair figure. The line is a subordinate clause on the verdict,
   naming no second exit, so every panel still tells one story. */
{
  const r = await sheet({ arv:'240,000', asking:'180,000' });
  ok('the verdict still leads', /This one pays you/i.test(r.text), r.text.slice(0, 140));
  const m = r.text.match(/buy the house are waiting on the walk-through.*?under \$([\d,]+)/);
  ok('the buying exits get their line', !!m, r.text.slice(0, 340));
  if (m){
    const line = Number(m[1].replace(/,/g, ''));
    ok('the line is a real figure', line > 0 && line < 240000, line);
    ok('no second exit is named beside the verdict — one sheet, one story',
       !/waiting on the walk-through[^.]*\b(flip|wholetail|wholesale|hold|brrrr)\b/i.test(r.text), r.text.slice(0,340));
    /* the two directions: AT the line it reaches, one step past it it fails —
       checked against the page's own engine, not against a re-derivation */
    const holds = await pg.evaluate((L) => {
      const at = r => { S.raw.repairs = String(r);
        const payers = exitsFor().filter(x => !x.refused && typeof x.ceil === 'number');
        if (!payers.length) return false;
        const top = payers.reduce((a, c) => (c.ceil > a.ceil ? c : a));
        return reachesPrice(top, val('asking')); };
      const atLine = at(L), pastLine = at(L + 1500);
      S.raw.repairs = '';
      return { atLine, pastLine };
    }, line);
    ok('AT the line, the engine reaches', holds.atLine === true, holds);
    ok('one step past it, the engine refuses', holds.pastLine === false, holds);
    /* and the sentence speaks the product's own condition words */
    ok('the line is placed against the presets', /(light|medium|heavy) turn/.test(r.text), r.text.slice(0, 300));
  }
}

/* ── 2 · a hopeless ask is told the truth before the walk-through ──────────
   At $600k over a $240k ARV the novation's own cheque is minus $390,775 —
   which used to stay "priced" and get presented as winning on STRUCTURE.
   It refuses now, the box empties, and the truth panel takes the slot. */
{
  const r = await sheet({ arv:'240,000', asking:'600,000' });
  ok('an unreachable ask is named before condition matters',
     /fails before the condition matters/.test(r.text), r.text.slice(0, 200));
  ok('and says the gap is the price, not the condition',
     /gap is the price, not the condition/.test(r.text));
  ok('and no negative cheque is dressed as a structural win',
     !/wins on structure/i.test(r.text), r.text.slice(0, 200));
}

/* ── 2b · in the zone where the buying exits can NEVER reach but the
   novation still pays, the clause says why that is the point ─────────────── */
{
  const r = await sheet({ arv:'240,000', asking:'215,000' });
  if (/This one pays you/i.test(r.text)){
    ok('past the buying exits\' reach, the clause explains the play',
       /never reach their number at any condition/.test(r.text), r.text.slice(0, 340));
  } else {
    ok('or nothing prices and the empty-box panel answers', /fails before the condition matters|What it would have to be/.test(r.text), r.text.slice(0, 200));
  }
}

/* ── 3 · no ask, no inversion — the ceiling stands alone ─────────────────── */
{
  const r = await sheet({ arv:'240,000' });
  ok('with no ask there is nothing to invert', !/What it would have to be/.test(r.text), r.text.slice(0, 120));
}

/* ── 4 · with repairs KNOWN and out of reach, the gap names its parts ────── */
{
  const r = await sheet({ arv:'240,000', asking:'220,000', repairs:'60,000' });
  ok('the no-reach panel still leads', /No exit reaches their price/.test(r.text), r.text.slice(0, 120));
  const m = r.text.match(/at repairs under \$([\d,]+) their number comes back inside reach/);
  ok('it says how much of the gap is the condition', !!m, r.text.slice(0, 400));
  if (m){
    const line = Number(m[1].replace(/,/g, ''));
    ok('and that line is under the sheet\'s own figure', line < 60000, line);
    ok('and the sheet\'s figure is named beside it', /carries \$60,000/.test(r.text));
  }
}

/* ── 5 · a truly hopeless gap refuses the repair conversation too ────────── */
{
  const r = await sheet({ arv:'240,000', asking:'600,000', repairs:'20,000' });
  ok('past all hope, no repair figure is dangled',
     /Even at \$0 of repairs it does not reach/.test(r.text), r.text.slice(0, 400));
}

/* ── 6 · the probe borrows and restores — the sheet is untouched ─────────── */
{
  const clean = await pg.evaluate(() => ({ repairs: S.raw.repairs, sys: JSON.stringify(S.sys) }));
  ok('the probe put the repairs figure back', clean.repairs === '20,000' || clean.repairs === '', clean.repairs);
  const again = await pg.evaluate(() => { render(); return S.raw.repairs; });
  ok('and a re-render does not resurrect a probe value', again === clean.repairs, again);
}

ok('no page errors', errs.length === 0, errs[0]);
await b.close();
console.log('\n' + (bad ? '✗ ' + bad + ' of ' + n + ' failed' : '✓ all ' + n + ' hold'));
process.exit(bad ? 1 : 0);
