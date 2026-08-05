/* t-first — the first three minutes, and the market that stops the sheet asking.

     A · three beats, one per place a first-timer actually hesitates, each in
         the right room and each shown once
     B · dismissing one dismisses one; "do not show these" dismisses all of
         them, forever, across a reload
     C · a member never sees any of it — they have already been somewhere else
         in this product
     D · the saved market fills in for an address with no ZIP on it, and says
         it is doing so, and carries MORE uncertainty than the real ZIP would
     E · a real ZIP on the address always beats the saved market
     F · and the market is a plan feature, so a free account does not get it —
         including the case that used to leak it, an account carrying a blank
         plan string, which the `|| 1` fallback quietly read as Solo */
import { chromium } from 'playwright';

const B = 'file:///home/claude/dist/';
const b = await chromium.launch();
const out = {}; const bad = []; const errs = [];
const p = await b.newPage({ viewport:{ width:1280, height:1000 } });
p.on('pageerror', e => errs.push(String(e)));
p.on('console', m => { if (m.type() === 'error' && !/fraunces|ERR_FAILED/.test(m.text())) errs.push(m.text()); });

const land = async acct => {
  await p.goto(B + 'desk.html');
  await p.evaluate(a => { localStorage.clear();
    if (a) localStorage.setItem('ni-account-v1', JSON.stringify(a)); }, acct || null);
  await p.goto(B + 'desk.html');
  /* WAIT FOR THE PAGE, NOT FOR THE CLOCK. 600ms was enough on an idle machine
     and not enough with five other browsers competing, so every caller that
     went straight on to touch `S` raced the script tag and threw "S is not
     defined" — about one run in two, and only inside the full board. A test
     that fails half the time under load teaches you to re-run it rather than
     read it. */
  await p.waitForFunction(() => typeof S !== 'undefined' && typeof render === 'function',
    null, { timeout: 20000 });
};
const coach = () => p.evaluate(() => ({ shown: !document.getElementById('coach').hidden,
  t: (document.querySelector('.coach .ct')||{}).textContent || null }));

/* ── A · three beats, three rooms ──────────────────────────────────────── */
await land(null);
out.A = { property: await coach() };
await p.evaluate(() => showStep('condition')); await p.waitForTimeout(350);
out.A.condition = await coach();
await p.evaluate(() => { S.raw.arv='250000'; S.raw.asking='170000'; S.raw.repairs='30000';
  save(); window.__showResults(); });
await p.waitForTimeout(500);
out.A.results = await coach();
for (const k of ['property','condition','results'])
  if (!out.A[k].shown) bad.push(`A: no beat on the ${k} step`);
const titles = new Set(Object.values(out.A).map(x => x.t));
if (titles.size !== 3) bad.push('A: the same beat is being shown in more than one room');

/* ── B · dismissal, one and all ────────────────────────────────────────── */
await p.evaluate(() => document.getElementById('co-x').click()); await p.waitForTimeout(250);
out.B = { afterX: await coach() };
if (out.B.afterX.shown) bad.push('B: dismissing a beat did not dismiss it');
await p.evaluate(() => showStep('property')); await p.waitForTimeout(300);
out.B.other = await coach();
if (!out.B.other.shown) bad.push('B: dismissing one beat killed the others');
await p.evaluate(() => document.getElementById('co-off').click()); await p.waitForTimeout(250);
await p.evaluate(() => showStep('condition')); await p.waitForTimeout(300);
out.B.afterOff = await coach();
if (out.B.afterOff.shown) bad.push('B: "do not show these" did not');
await p.goto(B + 'desk.html'); await p.waitForTimeout(600);
out.B.afterReload = await coach();
if (out.B.afterReload.shown) bad.push('B: "do not show these" did not survive a reload');

/* ── C · a member is not a stranger ────────────────────────────────────── */
await land({ name:'Elijah', email:'e@x.com', plan:null, trial:null });
out.C = await coach();
if (out.C.shown) bad.push('C: somebody with an account is being taught what a sheet is');

/* ── D/E/F · the market ────────────────────────────────────────────────── */
const chips = () => p.evaluate(() => [...document.querySelectorAll('[data-est]')]
  .map(x => (x.textContent||'').trim()));
const MKT = { name:'Elijah', email:'e@x.com', trial:null, market:'Atlanta, GA 30310' };

await land({ ...MKT, plan:'solo' });
await p.evaluate(() => { S.addr = 'A house with no ZIP on it yet'; render(); });
await p.waitForTimeout(1500);
out.D = { zip: await p.evaluate(() => marketZip()), chips: await chips(),
  unc: await p.evaluate(() => { const c = chipsFor(FIELDS.find(f=>f.id==='arv'))[0];
    return c ? c.unc : null; }) };
if (out.D.zip !== '30310')                          bad.push('D: the saved market yielded no ZIP');
if (!out.D.chips.some(t => /Your market median value/.test(t)))
  bad.push('D: an address with no ZIP got no market default');
if (!out.D.chips.some(t => /Your market median rent/.test(t)))
  bad.push('D: the market default covers value but not rent');
if (!(out.D.unc > 0.18)) bad.push(`D: a market-wide figure carries the same uncertainty as the house's own ZIP (${out.D.unc})`);

await p.evaluate(() => { S.addr = '88 Ostend Street, Atlanta, GA 30314'; render(); });
await p.waitForTimeout(1200);
out.E = await chips();
if (!out.E.some(t => /ZIP 30314/.test(t)))    bad.push('E: the address’s own ZIP was ignored');
if (out.E.some(t => /Your market/.test(t)))   bad.push('E: the saved market overrode the real ZIP');

for (const [plan, gets] of [[null, false], ['', false], ['solo', true], ['underwriter', true]]){
  await land({ ...MKT, plan });
  await p.evaluate(() => { S.addr = 'No ZIP here'; render(); });
  await p.waitForTimeout(1200);
  const c = await chips();
  const got = c.some(t => /Your market/.test(t));
  out['F:' + (plan === null ? 'null' : plan || 'blank')] = { got, tier: await p.evaluate(() => window.__tier()) };
  if (gets && !got)  bad.push(`F: a ${plan} account paid for market defaults and did not get them`);
  if (!gets && got)  bad.push(`F: a plan of ${JSON.stringify(plan)} got a feature it did not buy`);
}
if (out['F:blank'].tier !== 0)
  bad.push(`F: a blank plan string reads as tier ${out['F:blank'].tier} — it bought a plan with an empty string`);

out.errs = errs;
if (errs.length) bad.push('console errors — ' + errs.slice(0,2).join(' | '));

await b.close();
console.log(JSON.stringify(out, null, 1));
console.log(bad.length ? 'FAIL\n - ' + bad.join('\n - ')
  : 'PASS — three beats in three rooms, dismissible one at a time or forever, hidden from members; and the saved market fills in only where the address cannot, says so, and costs a plan');
process.exit(bad.length ? 1 : 0);
