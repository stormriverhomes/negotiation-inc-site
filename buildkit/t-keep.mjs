/* t-keep — the one moment the product asks for anything.

   The previous version of this file clicked a button that granted fourteen
   days of the whole product on the spot, no card. That button was removed on
   purpose: a trial with no card converts at 4–6% and one with a card at
   25–35%, and giving away metered compute to somebody who has not shown they
   will ever pay is the worst trade in the funnel. So the account keeps the
   memory — genuinely free — and the trial lives on the plans page behind a
   card. This file now tests the panel that replaced it.

     A · nothing is asked until there is an answer worth keeping
     B · a signed-out visitor is offered the keep, by name of what it does
     C · a member who has never trialled gets the one offer that matters, and
         it goes to the till rather than granting itself
     D · a member on a plan is not sold anything
     E · a demo is a showroom, so it never asks — asking somebody to keep a
         house that does not exist is the worst first impression available */
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
  await p.goto(B + 'desk.html'); await p.waitForTimeout(600);
};
const keep = () => p.evaluate(() => {
  const k = document.querySelector('.keep');
  return { there: !!k, txt: k ? (k.innerText || '').replace(/\s+/g,' ').trim() : null,
    links: k ? [...k.querySelectorAll('a')].map(a => a.getAttribute('href')) : [] };
});

/* ── A · nothing is asked of an empty sheet ────────────────────────────── */
await land(null);
out.A = await keep();
if (out.A.there) bad.push('A: an empty sheet is already asking for something');

/* ── B · a visitor with an answer is offered the keep ──────────────────── */
await p.evaluate(() => { showStep('property'); });
await p.fill('[data-f="arv"]', '250000'); await p.press('[data-f="arv"]', 'Tab');
await p.waitForTimeout(400);
await p.evaluate(() => window.__showResults && window.__showResults());
await p.waitForTimeout(500);
out.B = await keep();
if (!out.B.there)                    bad.push('B: a priced sheet never offers to remember itself');
if (!/office\.html/.test(out.B.links.join(' '))) bad.push('B: the keep does not lead anywhere');

/* ── C · a member who has never trialled ───────────────────────────────── */
await land({ name:'Elijah Payne', email:'e@x.com', trial:null, plan:null });
await p.evaluate(() => { S.raw.arv = '250000'; save();
  window.__showResults && window.__showResults(); });
await p.waitForTimeout(600);
out.C = await keep();
if (!out.C.there)                 bad.push('C: a member gets no confirmation the sheet is kept');
if (!/Elijah/.test(out.C.txt||'')) bad.push('C: the panel does not say it by name');
if (!/plans\.html/.test(out.C.links.join(' ')))
  bad.push('C: the trial offer does not go to the till — it is granting itself again');
if (/free.{0,14}(trial|days).{0,40}no card/i.test(out.C.txt||''))
  bad.push('C: the no-card trial came back');

/* ── D · a member on a plan is not sold anything ───────────────────────── */
await land({ name:'Elijah Payne', email:'e@x.com', trial:null, plan:'the office' });
await p.evaluate(() => { S.raw.arv = '250000'; save();
  window.__showResults && window.__showResults(); });
await p.waitForTimeout(600);
out.D = await keep();
if (!out.D.there)                                bad.push('D: a paying member gets no confirmation at all');
if (/plans\.html/.test(out.D.links.join(' ')))   bad.push('D: a paying member is being sold a plan');
if (!/switched on/i.test(out.D.txt||''))         bad.push('D: the panel does not say everything is on');

/* ── E · a showroom never asks ─────────────────────────────────────────── */
await land(null);
await p.goto(B + 'desk.html#demo=flip'); await p.waitForTimeout(900);
await p.evaluate(() => window.__showResults && window.__showResults());
await p.waitForTimeout(600);
out.E = { ...(await keep()), demo: await p.evaluate(() => !!DEMO) };
if (!out.E.demo)  bad.push('E: the demo did not load, so this proves nothing');
if (out.E.there)  bad.push('E: a made-up house is asking to be kept');

out.errs = errs;
if (errs.length) bad.push('console errors — ' + errs.slice(0,2).join(' | '));

await b.close();
console.log(JSON.stringify(out, null, 1));
console.log(bad.length ? 'FAIL\n - ' + bad.join('\n - ')
  : 'PASS — nothing is asked until there is an answer, the member is told by name, the trial goes to the till, and a showroom never asks');
process.exit(bad.length ? 1 : 0);
