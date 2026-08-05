/* ══ THE LAND DESK, WALKED ══════════════════════════════════════════════════
   The page is held to the same ledger the engine's tests and the build guard
   hold the module to — but HERE it is the RENDERED text that answers, because
   a page can disagree with its own engine in the wiring. Then the grammar:
   refusals that say what they need, the septic named inside the estimate, the
   firm list, no Google credit on a page with no Google imagery, and the sheet
   below the ground at 390 with the verdict present. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve('dist/land.html');

let n = 0, bad = 0;
const ok = (name, pass) => { n++; if (!pass){ bad++; console.log('✗ ' + name); } else console.log('✓ ' + name); };

const b = await chromium.launch();
for (const W of [1440, 390]){
  const pg = await b.newPage({ viewport:{ width: W, height: 950 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(FILE);
  await pg.waitForTimeout(300);

  /* blank sheet: refused, and the refusal names the need */
  let t = await pg.evaluate(() => document.getElementById('sheet').innerText.replace(/\s+/g,' '));
  ok(W+': blank sheet refuses rather than guesses', /Not priced — it needs what the finished lot sells for/.test(t));
  ok(W+': the refusal is a door, not a shrug', /Comps for finished lots/.test(t));

  /* the worked example: the approved ledger, to the dollar, in rendered text */
  await pg.click('#demo');
  await pg.waitForTimeout(250);
  t = await pg.evaluate(() => document.getElementById('sheet').innerText.replace(/\s+/g,' '));
  ok(W+': clears $21,640',            t.includes('$21,640'));
  ok(W+': cost of sale −$20,860',     t.includes('$20,860'));
  /* the target lives in an input — innerText cannot see a placeholder, so it
     is read as the component it is, then the sentence around it */
  const target = await pg.evaluate(() => { const el = document.querySelector('[data-k="target"]');
    return el ? (el.value || el.placeholder) : null; });
  ok(W+': concession — the derived $35,000 target', target === '35,000');
  ok(W+': concession — buy at $200,640 or less', /To clear \$.*buy at \$200,640 or less/.test(t));
  ok(W+': per-acre $81,992 — the figure the design doc got wrong', t.includes('$81,992 per acre'));
  ok(W+': septic named INSIDE the site line', /inside it: septic install, unconfirmed \$18,000/.test(t));
  ok(W+': before this prices firm', /Before this prices firm/i.test(t));
  ok(W+': access unverified is on the firm list', /Road access is not verified/.test(t));

  /* the ground: chips carry provenance; the floor carries no false credit */
  const g = await pg.evaluate(() => ({
    body: document.body.innerText,
    floor: document.getElementById('floor').innerText,
    chipTags: [...document.querySelectorAll('#chips .chip .tag, #rail .tag')].map(x => x.textContent),
    railN: document.querySelectorAll('#rail .pill').length,
    chipN: document.querySelectorAll('#chips .chip').length,
  }));
  ok(W+': six facts on the ground', (W > 1000 ? g.chipN : g.railN) === 6);
  ok(W+': a fact still missing reads NEEDED', g.chipTags.includes('NEEDED'));
  ok(W+': no Google credit without Google imagery', !/google/i.test(g.body));
  ok(W+': the floor says why the ground is a sketch', /prices without the ground/.test(g.floor));

  /* the walk-away shape: raise the ask past the line, the page says so */
  await pg.evaluate(() => { const el = document.querySelector('[data-k="asking"]');
    el.value = '329,000'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await pg.waitForTimeout(200);
  t = await pg.evaluate(() => document.getElementById('sheet').innerText.replace(/\s+/g,' '));
  ok(W+": past the line, the play refuses to price at their number", /doesn.t price at their number/.test(t));
  ok(W+': the working number is still stated', t.includes('$200,640'));

  /* state survives a reload — it is a sheet, not a toy */
  await pg.reload(); await pg.waitForTimeout(300);
  t = await pg.evaluate(() => document.getElementById('sheet').innerText.replace(/\s+/g,' '));
  ok(W+': the sheet survives a reload', t.includes('$200,640'));

  ok(W+': no page errors', errs.length === 0);
  if (errs.length) console.log('   ' + errs.join('\n   '));
  await pg.close();
}
await b.close();
console.log('\n' + (bad ? '✗ ' + bad + ' of ' + n + ' failed' : '✓ all ' + n + ' hold'));
process.exit(bad ? 1 : 0);
