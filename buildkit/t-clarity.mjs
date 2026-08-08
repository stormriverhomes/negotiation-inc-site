/* t-clarity — the four things Elijah could not tell from looking.
     A · a row that says "Needs rent" must GO to rent. It used to call focus()
         on an input sitting on a step that was not on screen, so clicking it
         did nothing at all and left you staring at the answer page.
     B · a refused row has said everything it has to say in its header, so it
         must not wear a chevron and must not open on an empty body.
     C · a sheet loaded from a demo, the arcade or a lesson is a worked example
         and has to say so wherever it is named — otherwise it sits in the list
         looking exactly as authoritative as a house you actually walked.
     D · the bench holds two, three or four by plan, and the locked seat names
         the plan that opens it rather than pretending there is no more. */
import { chromium } from 'playwright';
import { step, fillSheet, underwrite } from './harness-util.mjs';

const B = 'file:///home/claude/dist/';
const b = await chromium.launch();
const out = {}; const bad = [];
const errs = [];

const p = await b.newPage({ viewport:{width:1180,height:1000} });
p.on('pageerror', e => errs.push(String(e)));
/* file:// refuses the preloaded woff2 with a CORS error on every page — a
   protocol artefact of running the shipped build off disk, not a defect */
const NOISE = /fraunces\.woff2|ERR_FAILED/;
p.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(m.text()); });

/* ── A · the row that names a missing number goes and gets it ───────────── */
await p.goto(B + 'desk.html');
await p.evaluate(() => localStorage.clear());
await p.reload(); await p.waitForTimeout(500);
await fillSheet(p, { addr:'1104 Elm Street', asking:'168000', arv:'249000', repairs:'46000' });
await underwrite(p);

out.A = await p.evaluate(() => {
  const row = document.querySelector('[data-row="hold"]');        // hold needs rent
  return { exists: !!row, na: !!document.querySelector('#x-hold.na'),
           says: /Add it|Add them/.test((row||{}).innerText || ''),
           chev: !!(row && row.querySelector('.chev')) };
});
await p.click('[data-row="hold"]'); await p.waitForTimeout(700);
out.Ajump = await p.evaluate(() => ({
  step: (document.querySelector('.step:not([hidden])')||{}).dataset
        ? document.querySelector('.step:not([hidden])').dataset.step : null,
  onScreen: (() => { const f = document.getElementById('fi-rent');
    return !!f && f.offsetParent !== null; })(),
  focused: (document.activeElement || {}).id,
  flashed: !!document.querySelector('.askfor'),
}));
if (!out.A.na)        bad.push('A: the hold row is not waiting on a number, so this proves nothing');
if (!out.A.says)      bad.push('A: the row does not offer to go and get the number');
if (out.Ajump.step !== 'deal')     bad.push('A: clicking it did not open the step the field lives on: ' + out.Ajump.step);
if (!out.Ajump.onScreen)           bad.push('A: the field it sent you to is not on screen');
if (out.Ajump.focused !== 'fi-rent') bad.push('A: the field is not focused: ' + out.Ajump.focused);
if (!out.Ajump.flashed)            bad.push('A: nothing on screen said which field it wants');

/* ── B · a refused row is not a button ──────────────────────────────────── */
await underwrite(p);
out.B = await p.evaluate(() => {
  const ids = [...document.querySelectorAll('.exit.refused')].map(e => e.id);
  const r = document.querySelector('.exit.refused .exit-h');
  return { n: ids.length, ids,
           chev: !!(r && r.querySelector('.chev')),
           cursor: r ? getComputedStyle(r).cursor : null };
});
if (!out.B.n)               bad.push('B: no refused row on a sheet with 18% repairs — the gates stopped firing');
if (out.B.chev)             bad.push('B: a refused row still wears a chevron it cannot honour');
if (out.B.cursor !== 'default') bad.push('B: a refused row still says it is pressable: ' + out.B.cursor);
{ const before = await p.evaluate(() => S.openId);
  await p.click('.exit.refused .exit-h'); await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({ open:S.openId,
    undef: /undefined/.test(document.body.innerText) }));
  out.Bclick = { before, ...after };
  if (after.open !== before) bad.push('B: clicking a refused row moved what is open');
  if (after.undef)           bad.push('B: "undefined" is on the page'); }

/* ── C · a worked example says it is one, everywhere it is named ─────────── */
await p.evaluate(() => { localStorage.clear(); });
await p.goto(B + 'desk.html'); await p.waitForTimeout(500);
await underwrite(p);
await p.click('#demo'); await p.waitForTimeout(600);
out.C = await p.evaluate(() => ({
  onSheet: typeof S !== 'undefined' && !!S.sample,
  chips: document.querySelectorAll('.ptab .smp').length,
  saved: (() => { try { const d = JSON.parse(localStorage.getItem('ni-desk-v3'));
    return d.props.filter(x => x.sample).length; } catch(e){ return 'unreadable'; } })(),
}));
if (out.C.onSheet !== true) bad.push('C: the demo did not mark the sheet a worked example');
if (!out.C.chips)           bad.push('C: the property tab does not say it is a sample');
if (out.C.saved !== 1)      bad.push('C: the flag did not survive a save: ' + out.C.saved);

/* it has to reach the hub too, because that is where they pile up */
await p.evaluate(() => localStorage.setItem('ni-account-v1',
  JSON.stringify({ name:'Elijah', email:'e@x.com', plan:'solo', trial:null })));
await p.goto(B + 'office.html'); await p.waitForTimeout(900);
out.Chub = await p.evaluate(() => ({
  card: document.querySelectorAll('.pcard .smp').length,
  rail: document.querySelectorAll('.rn-p .smp').length,
  text: (document.querySelector('.pcard .smp')||{}).textContent || null }));
if (!out.Chub.card) bad.push('C: the hub does not mark a worked example');
if (!out.Chub.rail) bad.push('C: the rail does not mark a worked example');

/* and clearing the sheet clears the flag — a sample you have replaced is yours */
await p.goto(B + 'desk.html'); await p.waitForTimeout(700);
await p.evaluate(() => { clearCase(); });
await p.waitForTimeout(400);
out.Cclear = await p.evaluate(() => ({ onSheet: typeof S !== 'undefined' && !!S.sample,
  chips: document.querySelectorAll('.ptab .smp').length }));
if (out.Cclear.onSheet || out.Cclear.chips)
  bad.push('C: emptying the sheet left it wearing a sample badge');

/* ── D · the bench widens with the plan ─────────────────────────────────── */
for (const [plan, cap] of [['solo',2],['underwriter',3],['the office',4]]){
  await p.evaluate(pl => {
    /* a fresh browser per tier — the bench is written down now, so a run left
       over from the previous plan would be sitting in it */
    localStorage.removeItem('ni-cmp-v1');
    localStorage.setItem('ni-account-v1', JSON.stringify({ name:'E', email:'e@x.com', plan:pl, trial:null }));
    const P = (name, ask, arv, rep, rent) => ({ name, addr:name, mode:'simple', comps:[{},{}],
      sit:'estate', sys:{}, subj:{}, compAdj:{},
      f:{ asking:{v:ask}, arv:{v:arv}, repairs:{v:rep}, rent:{v:rent} } });
    localStorage.setItem('ni-desk-v3', JSON.stringify({ active:0, props:[
      P('A Road','214000','300000','20500','2100'), P('B Court','138000','196000','18000','1650'),
      P('C Street','162000','240000','21000','1800'), P('D Lane','150000','230000','19000','1700'),
      P('E Way','170000','260000','22000','1900') ]}));
  }, plan);
  await p.goto(B + 'desk.html'); await p.waitForTimeout(400);
  await p.goto(B + 'desk.html#compare'); await p.waitForTimeout(900);
  const r = await p.evaluate(n => {
    /* press cards until the bench is full — pressing one already on it takes
       it back off, so "click n+2 of them" would undo its own work */
    for (let i = 0; i < 12 && CMP.picks.length < n; i++){
      const c = document.querySelector(`.dk[data-card="${i}"]`);
      if (c && CMP.picks.indexOf(i) < 0) c.click(); }
    return { cap: window.__cmpMax(), picks: CMP.picks.length,
             seats: document.querySelectorAll('.slot:not(.empty):not(.locked)').length,
             cols: document.querySelectorAll('.cmp-head .v').length,
             locked: document.querySelectorAll('.slot.locked').length,
             lockText: (document.querySelector('.slot.locked .lkt')||{}).textContent || null };
  }, cap);
  out['D:' + plan] = r;
  if (r.cap !== cap)   bad.push(`D: ${plan} gets a bench of ${r.cap}, not ${cap}`);
  if (r.picks !== cap) bad.push(`D: ${plan} could seat ${r.picks} of ${cap}`);
  if (r.cols !== cap)  bad.push(`D: ${plan} drew ${r.cols} columns for ${cap} properties`);
  if (cap < 4 && !r.locked) bad.push(`D: ${plan} is not shown the seat the next plan opens`);
  if (cap === 4 && r.locked) bad.push('D: the top plan is being sold a plan');
}

out.errs = errs;
if (errs.length) bad.push('console errors: ' + errs.slice(0,2).join(' | '));

await b.close();
console.log(JSON.stringify(out, null, 1));
console.log(bad.length ? 'FAIL\n - ' + bad.join('\n - ')
  : 'PASS — a row that wants a number goes and gets it, a refusal is not a button, a sample says so, and the bench widens with the plan');
process.exit(bad.length ? 1 : 0);
