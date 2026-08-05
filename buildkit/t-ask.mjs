/* t-ask — the letter never contradicts the sheet it came from.

   This is the highest-stakes artefact in the product: the only thing that
   leaves the building with somebody's name on it and a price in it. Everything
   else is a screen you can argue with. A letter is a number a seller has been
   told.

   The offer builder already turns a meter red when an offer costs more than
   the exit can carry. But the letter is a DIFFERENT SCREEN — you move the
   slider on one, then switch to the other to write the thing — and the summary
   you press Copy beside is six tidy rows with the price at the top. The screen
   that knows was not the screen the decision happens on.

     A · WHENEVER THE ALL-IN COST EXCEEDS THE CEILING, THE LETTER PANEL SAYS
         SO, in the panel, next to the price, before the Copy button.
     B · AND WHEN ROUNDING IS WHAT PUT IT OVER, it says that specifically.
         "Round the number" is a checkbox that reads as cosmetic; at the
         boundary it moves a compliant offer to a non-compliant one, by up to
         $250, invisibly. It is the only way this goes wrong that nobody could
         otherwise have seen.
     C · A COMPLIANT OFFER IS NOT NAGGED. A warning that is always on is
         wallpaper, and the next real one gets ignored with it.
     D · THE PRICE IN THE DOCUMENT IS THE PRICE IN THE SUMMARY. If the body
         says one number and "Carried from the offer" says another, one of them
         is a lie and there is no way to know which.
     E · NO DRAFT CONTAINS NaN, undefined, null, or an unfilled placeholder.
         A letter with "undefined" in it is not a bug a seller forgives.
     F · NO DRAFT NAMES THE CEILING, THE EXIT, THE SPREAD OR THE MARGIN. The
         working may be shown — ARV and repairs — because those are checkable.
         What you would have paid is yours.
*/
import { chromium } from 'playwright';

const b = await chromium.launch();
const p = await b.newPage({ viewport:{ width:1280, height:1400 } });
const bad = [], out = {}, errs = [];
p.on('pageerror', e => errs.push(e.message));

await p.goto('file:///home/claude/dist/desk.html');
await p.evaluate(() => { localStorage.clear();
  /* The Office, so every draft and the branding fields are reachable */
  localStorage.setItem('ni-account-v1', JSON.stringify({
    name:'Elijah Payne', email:'elijah@example.com', co:'StormRiver', plan:'the office' })); });
await p.reload(); await p.waitForTimeout(700);

const ask = (house, lev, round, tab) => p.evaluate(([h, lv, rd, tb]) => {
  for (const k of ['asking','arv','repairs','rent']) delete S.raw[k];
  for (const k in h) if (h[k] !== null && h[k] !== '') S.raw[k] = String(h[k]);
  S.lev.price = lv; LT.round = rd; LT.tab = tb; LT.dirty = {}; LT.text = {};
  S.toName = 'Ms Alvarez'; S.addr = '1128 Marrow Lane';
  showStep('results'); render(); renderLetters();
  const m = offerModel(); if (!m) return null;
  const d = letterModel();
  const el = document.querySelector('.ltover');
  const carry = document.querySelector('.ltcarry');
  const body = (document.getElementById('lt-body') || {}).value || '';
  return {
    hi: m.hi, ceil: m.best.ceil, exit: m.best.id, exitName: m.best.nm,
    raw: Math.round(m.price), price: d.price, extra: m.credit + m.stayCost,
    warn: el ? el.innerText.replace(/\s+/g, ' ') : null,
    carry: carry ? carry.innerText.replace(/\s+/g, ' ') : '',
    body,
  };
}, [house, lev, round, tab]);

const money = v => '$' + Math.round(v).toLocaleString('en-US');

/* ── the grid ─────────────────────────────────────────────────────────────
   Two houses, a seller asking well above and well below the ceiling, the price
   lever swept, and the rounding checkbox both ways. The asking price is what
   decides where the lever's range sits, so it is the axis that matters. */
const HOUSES = [
  { arv:291000, repairs:41300,  rent:1850 },
  { arv:180000, repairs:12000,  rent:1400 },
];
const ASKS  = ['', '99000', '120000', '160000', '249500'];
const LEVS  = [0, 25, 50, 75, 82.6, 90, 100];
const TABS  = ['email','text','loi'];

let n = 0, warned = 0, quiet = 0, roundCases = 0;
for (const base of HOUSES)
 for (const a of ASKS)
  for (const lv of LEVS)
   for (const rd of [false, true]){
     const r = await ask({ ...base, asking:a }, lv, rd, 'email');
     if (!r) continue;
     n++;
     const all = r.price + r.extra;
     const over = all > r.hi;
     const rawIn = (r.raw + r.extra) <= r.hi;

     /* A · over the ceiling is always said */
     if (over && !r.warn){
       bad.push(`A: ${money(all)} all-in against a ${money(r.hi)} ceiling and the letter panel says nothing  [ask ${a||'none'} · lever ${lv} · round ${rd}]`);
     }
     /* C · a compliant offer is not nagged */
     if (!over && r.warn){
       bad.push(`C: a compliant offer was warned about  [ask ${a||'none'} · lever ${lv} · round ${rd}]`);
     }
     if (over) warned++; else quiet++;

     /* B · rounding alone crossing the line says so in those words */
     if (over && rd && rawIn){
       roundCases++;
       if (!/Rounding did that on its own/i.test(r.warn || ''))
         bad.push(`B: rounding alone put ${money(r.raw)} over to ${money(r.price)} and the panel did not say rounding did it  [ask ${a||'none'} · lever ${lv}]`);
     }

     /* D · the summary and the document agree on the price */
     if (r.carry && !r.carry.includes(money(r.price)))
       bad.push(`D: "Carried from the offer" does not show ${money(r.price)}  [ask ${a||'none'} · lever ${lv} · round ${rd}]`);
   }

/* ── E and F, over every draft ───────────────────────────────────────────── */
for (const base of HOUSES)
 for (const a of ['', '160000'])
  for (const tab of TABS){
    const r = await ask({ ...base, asking:a }, 60, true, tab);
    if (!r) continue;
    const body = r.body;
    if (!body){ bad.push(`E: the ${tab} draft is empty  [ask ${a||'none'}]`); continue; }
    /* E · nothing unfilled reaches a seller */
    for (const rot of [/\bNaN\b/, /\bundefined\b/, /\bnull\b/, /\$\s*[-−]/, /\[\s*\]/, /\{\{/])
      if (rot.test(body))
        bad.push(`E: the ${tab} draft contains ${rot}  [ask ${a||'none'}]`);
    /* F · the draft is about the house, not about your position */
    if (new RegExp(money(r.ceil).replace(/[$,]/g, '\\$&')).test(body))
      bad.push(`F: the ${tab} draft names your ceiling ${money(r.ceil)}  [ask ${a||'none'}]`);
    for (const word of ['ceiling','margin','spread','assign','wholesale','the flip','BRRRR'])
      if (new RegExp('\\b' + word + '\\b', 'i').test(body))
        bad.push(`F: the ${tab} draft says "${word}" to the seller  [ask ${a||'none'}]`);
    /* D again, on the body itself */
    if (!body.includes(money(r.price)))
      bad.push(`D: the ${tab} draft body does not contain its own price ${money(r.price)}  [ask ${a||'none'}]`);
  }

if (errs.length) bad.push('the page threw: ' + errs[0]);
out.offersChecked = n;
out.overCeiling = warned;
out.compliant = quiet;
out.roundingCrossings = roundCases;

await b.close();
console.log(JSON.stringify(out, null, 1));
if (bad.length){
  console.log('FAIL');
  const seen = new Set();
  for (const x of bad){ const k = x.slice(0, x.indexOf('[')) || x; if (seen.has(k)) continue; seen.add(k); console.log(' - ' + x); }
  console.log(` (${bad.length} violations, ${seen.size} distinct)`);
  process.exit(1);
}
if (!roundCases) console.log('NOTE: no rounding-boundary case in this grid — law B was not exercised');
console.log(`PASS — ${n} offers across three drafts: every one that costs more than the exit can carry says so beside the Copy button, rounding that crosses the line says it was the rounding, a compliant offer is left alone, the document and the summary agree on the price, and no draft names your ceiling or your exit`);
