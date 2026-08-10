/* _tpay — the browser half of the payment rail, against a stub Stripe and a
   stub Supabase, in a live-stage build.

   The client cannot decide a tier and this harness exists mostly to prove it
   still cannot. What it actually tests:

     A · with nothing configured the pages are exactly the product they are
         today — no billing controls, no console errors
     B · a plan clicked on the plans page survives the door and becomes a
         checkout, for somebody who had to sign up on the way
     C · THE RETURN FROM STRIPE WAITS. The webhook lands four seconds after
         the redirect and the page must not have shown a free account in the
         meantime
     D · and when the webhook never lands, the page says so and names the
         mailbox rather than showing a free account
     E · the billing portal is one click from the account panel
     F · the browser cannot promote itself: a plan written into localStorage
         is gone on the next load, with checkout configured or not
*/
import http from 'node:http';
import { chromium } from 'playwright';
import fs from 'fs';
import { execFileSync } from 'child_process';

/* The build refuses a key that is not shaped like a real one — that guard is
   the thing standing between a browser and a pasted service_role key, so it
   does not get a test exemption. The stub server does not read the key at all,
   so the harness simply hands over a correctly-shaped fake. */
const SB_STUB_KEY = 'sb_publishable_harness_stub_not_a_real_key';
/* ── ITS OWN dist, NOT THE SHARED ONE ────────────────────────────────────
   This harness rebuilds the site several times with different environments.
   So does _tpay. Run them in the same batch and they overwrite each other's
   dist/ mid-assertion — which is not a flaky test, it is two tests writing to
   one file. publish.mjs already takes OUT; use it, and the harnesses stop
   caring what else is running. */
const OUT = 'dist-tpay-' + process.pid;
const OUT_ABS = '/home/claude/' + OUT;
process.on('exit', () => { try { fs.rmSync(OUT_ABS, {recursive:true, force:true}); } catch(e){} });

const bad = [], out = {};

/* ══ stub Supabase ═══════════════════════════════════════════════════════ */
let PLAN = null;                                   // what the server says, now
let USERS = {};
const j = (res, code, o) => { res.writeHead(code, {'content-type':'application/json',
  'access-control-allow-origin':'*', 'access-control-allow-headers':'*',
  'access-control-allow-methods':'*'}); res.end(JSON.stringify(o)); };
const sb = http.createServer((req, res) => {
  let b=''; req.on('data',d=>b+=d); req.on('end',()=>{
    if (req.method === 'OPTIONS') return j(res,200,{});
    const u = new URL(req.url,'http://x'); const body = (()=>{ try{return JSON.parse(b||'{}')}catch(e){return{}} })();
    const sess = (email,name) => ({ access_token:'at-'+email, refresh_token:'rt-'+email,
      expires_in:3600, user:{ id:'u-'+email, email, user_metadata:{name} } });
    if (u.pathname === '/auth/v1/signup'){ USERS[body.email]={pw:body.password,name:(body.data||{}).name||''};
      return j(res,200,sess(body.email,(body.data||{}).name)); }
    if (u.pathname === '/auth/v1/token'){ const e=body.email||'';
      if (u.searchParams.get('grant_type')==='refresh_token') return j(res,200,sess((body.refresh_token||'').slice(3),''));
      if (!USERS[e] || USERS[e].pw!==body.password) return j(res,400,{msg:'Invalid login credentials'});
      return j(res,200,sess(e,USERS[e].name)); }
    if (u.pathname === '/auth/v1/logout') return j(res,204,{});
    if (u.pathname === '/rest/v1/profiles'){
      if (req.method === 'PATCH') return j(res,204,{});
      return j(res,200,[{ name:'Elijah', market:'30310', plan:PLAN, trial:null }]); }
    if (u.pathname === '/rest/v1/sheets') return j(res,200, req.method==='GET'?[]:{});
    j(res,404,{});
  });
});
/* ══ stub site + stub /api/checkout|/api/portal ══════════════════════════ */
let LASTCHECKOUT = null;
/* ── AND THE SETTINGS THE LIVE SITE ACTUALLY HAS ──────────────────────────
   Null means "answer the way section A needs" — accounts off. Section J sets
   it to the real shape: the Supabase settings arriving from the SERVER, a
   moment after the page has parsed, which is the only configuration the
   production site has ever had and the one no section here ever built. */
let CONFIG = null, CONFIG_DELAY = 0;
const site = http.createServer((req,res)=>{
  let b=''; req.on('data',d=>b+=d); req.on('end',()=>{
    const u = new URL(req.url,'http://x');
    if (u.pathname === '/api/checkout'){ LASTCHECKOUT = JSON.parse(b||'{}');
      return j(res,200,{ ok:true, url:'/office.html?paid=1' }); }
    if (u.pathname === '/api/portal') return j(res,200,{ ok:true, url:'/office.html?portal=1' });
    /* Section A builds with NOTHING configured, and the page is right to ask
       the server whether accounts exist — that question is the whole fix for
       the batch where the account layer was dead on the live site. A 404 here
       is a console error the page cannot suppress, and section A asserts
       there are none, so this stub has to answer. Section B bakes the values
       in and never asks. */
    if (u.pathname === '/api/config' && CONFIG){
      const c = CONFIG, d = CONFIG_DELAY;
      setTimeout(() => j(res,200,c), d); return;
    }
    if (u.pathname.startsWith('/api/')) return j(res,200,{ ok:true, accounts:false });
    const p = u.pathname === '/' ? '/office.html' : u.pathname;
    const f = OUT_ABS + p;
    if (fs.existsSync(f) && fs.statSync(f).isFile()){
      res.writeHead(200,{'content-type': p.endsWith('.js')?'text/javascript':'text/html'});
      return res.end(fs.readFileSync(f)); }
    res.writeHead(404); res.end('no');
  });
});
const listen = s => new Promise(r => s.listen(0,'127.0.0.1',()=>r(s.address().port)));
const sbPort = await listen(sb), sitePort = await listen(site);
const BASE = `http://127.0.0.1:${sitePort}`;

/* ══ A · unconfigured is today's product ═════════════════════════════════ */
execFileSync('node', ['publish.mjs'], { cwd:'/home/claude', stdio:'ignore', env:{ ...process.env, OUT } });
const b0 = await chromium.launch();
{
  const p = await b0.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type()==='error' && !/favicon|ERR_/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE + '/office.html'); await p.waitForTimeout(700);
  out.A = await p.evaluate(() => ({ authOn: !!(window.__authOn && window.__authOn()),
    payOn: !!(window.__payOn && window.__payOn()),
    hasCheckout: typeof window.__checkout === 'function',
    bill: !!document.getElementById('ac-bill') }));
  out.A_errs = errs;
  if (out.A.authOn || out.A.payOn || out.A.bill) bad.push('A: an unconfigured build offered billing');
  if (!out.A.hasCheckout) bad.push('A: the billing module did not load at all');
  if (errs.length) bad.push('A: console errors on an unconfigured build — ' + errs[0]);
  await p.close();
}

/* ══ the live, configured build ══════════════════════════════════════════ */
execFileSync('node', ['publish.mjs'], { cwd:'/home/claude', stdio:'ignore',
  env: { ...process.env, OUT, NI_STAGE:'live', NI_ALLOW_LOCAL_SB:'1',
         NI_SUPABASE_URL:`http://127.0.0.1:${sbPort}`, NI_SUPABASE_ANON:SB_STUB_KEY } });

const page = async () => { const p = await b0.newPage();
  p.on('pageerror', e => { out.errs = out.errs || []; out.errs.push(e.message); });
  return p; };

/* ══ B2 · THE CUSTOMER WHO ALREADY HAS AN ACCOUNT ════════════════════════
   Section B tested the person who signs up ON THE WAY to a plan, and it passed
   for months while the commonest buyer of all could not check out at all.

   Elijah, from inside his own live product: "when I click on the free trial
   when I'm logged in it just takes me to my account rather than directing me
   to pay."

   The cause was a name. The block that turns ?join=<plan> into a checkout is
   injected into both the desk and the office; it asked whether a function
   called signedIn() existed, which is the DESK's name for it — the office
   calls the identical function account(). So on the office, which is where
   every "Start 14 days free" link points, the answer was always no, every
   buyer was treated as signed out, and the plan was parked in a sessionStorage
   key that only the sign-in door ever read. A person already signed in does
   not walk through that door. The plan sat there forever.

   The lesson is bigger than the fix: section B only ever exercised the path
   where a stranger becomes a customer, so the assertion set had a hole shaped
   exactly like a returning customer. This is that hole, closed. */
{
  PLAN = null;
  const p = await page();
  /* ── A RETURNING CUSTOMER HAS A SESSION, NOT JUST A RECORD ─────────────
     The first draft of this section planted ni-account-v1 and nothing else,
     and it failed — correctly, and for the wrong reason. The workspace record
     is what the PAGE reads to know who you are; the Supabase session is what
     the SERVER reads to know you may spend. Checkout refused for want of a
     token, which is exactly what it should do, and told me nothing about the
     bug I was chasing. So the session is made the way a real one is: through
     the door, with the stub answering. */
  await p.goto(BASE + '/office.html');
  await p.fill('#g-name','Returning'); await p.fill('#g-email','back@x.com');
  await p.fill('#g-pw','sixchars');
  await p.click('#g-go'); await p.waitForTimeout(1400);
  /* and nothing may be parked before the real test begins */
  await p.evaluate(() => { try { sessionStorage.removeItem('ni-join'); } catch(e){} });
  LASTCHECKOUT = null;
  await p.goto(BASE + '/office.html?join=underwriter');
  await p.waitForTimeout(1500);
  out.B2_checkout = LASTCHECKOUT;
  out.B2_parked   = await p.evaluate(() => sessionStorage.getItem('ni-join'));
  if (!LASTCHECKOUT || LASTCHECKOUT.plan !== 'underwriter')
    bad.push('B2: a signed-in customer clicking a plan did NOT reach checkout — '
           + 'this is the path from the plans page to money');
  if (out.B2_parked)
    bad.push('B2: the plan was parked in sessionStorage instead of being spent');

  /* and the sweep: a plan parked by an interrupted attempt is picked up on the
     next load rather than stranding somebody who already decided to pay */
  LASTCHECKOUT = null;
  await p.evaluate(() => sessionStorage.setItem('ni-join', 'solo'));
  await p.goto(BASE + '/office.html');
  await p.waitForTimeout(1500);
  out.B2_swept = LASTCHECKOUT;
  if (!LASTCHECKOUT || LASTCHECKOUT.plan !== 'solo')
    bad.push('B2: an interrupted checkout was never resumed — the parked plan is a dead end');
  await p.close();
}

/* ══ B · a tier clicked on the plans page survives the door ══════════════ */
{
  PLAN = null;
  const p = await page();
  await p.goto(BASE + '/plans.html');
  out.B_href = await p.evaluate(() => { const a = [...document.querySelectorAll('a.btn')]
    .find(x => /join=/.test(x.getAttribute('href')||'')); return a ? a.getAttribute('href') : null; });
  if (!/join=/.test(out.B_href || '')) bad.push('B: the live plans page does not carry the tier through the door');

  await p.goto(BASE + '/office.html?join=underwriter'); await p.waitForTimeout(500);
  out.B_held = await p.evaluate(() => sessionStorage.getItem('ni-join'));
  out.B_url  = p.url();
  if (out.B_held !== 'underwriter') bad.push('B: the chosen tier was lost at the door');
  if (/join=/.test(out.B_url)) bad.push('B: the tier stayed in the address bar, so a refresh would re-enter it');

  /* sign up, and checkout must start on the far side of it */
  await p.fill('#g-name','Elijah'); await p.fill('#g-email','e@x.com'); await p.fill('#g-pw','sixchars');
  await p.click('#g-go'); await p.waitForTimeout(1400);
  out.B_checkout = LASTCHECKOUT;
  if (!LASTCHECKOUT || LASTCHECKOUT.plan !== 'underwriter')
    bad.push('B: signing up on the way to a plan did not start the checkout');
  await p.close();
}

/* ══ C · the return from Stripe waits for the webhook ════════════════════ */
{
  PLAN = null;                                     // the webhook has NOT landed
  const p = await page();
  await p.goto(BASE + '/office.html');
  await p.evaluate(() => localStorage.setItem('ni-session-v1', JSON.stringify({
    access_token:'at-e@x.com', refresh_token:'rt-e@x.com',
    expires_at: Date.now()+3.6e6, user:{ id:'u-e@x.com', email:'e@x.com' } })));
  await p.goto(BASE + '/office.html?paid=1'); await p.waitForTimeout(900);
  const early = await p.evaluate(() => ({
    note: (document.getElementById('paynote')||{}).textContent || null,
    plan: JSON.parse(localStorage.getItem('ni-account-v1')||'{}').plan || null }));
  out.C_early = early;
  if (!early.note || !/putting your subscription in place/i.test(early.note))
    bad.push('C: somebody back from Stripe was not told the subscription was being set up');
  if (/paid=1/.test(p.url())) bad.push('C: paid=1 stayed in the address bar');

  setTimeout(() => { PLAN = 'underwriter'; }, 2500);   // the webhook, late
  await p.waitForTimeout(6000);
  out.C_late = await p.evaluate(() => ({
    note: (document.getElementById('paynote')||{}).textContent || null,
    plan: JSON.parse(localStorage.getItem('ni-account-v1')||'{}').plan || null }));
  if (out.C_late.plan !== 'underwriter')
    bad.push('C: the plan never arrived even though the webhook did');
  await p.close();
}

/* ══ D · the webhook that never comes ════════════════════════════════════ */
{
  PLAN = null;
  const p = await page();
  await p.goto(BASE + '/office.html');
  await p.evaluate(() => localStorage.setItem('ni-session-v1', JSON.stringify({
    access_token:'at-e@x.com', refresh_token:'rt-e@x.com',
    expires_at: Date.now()+3.6e6, user:{ id:'u-e@x.com', email:'e@x.com' } })));
  await p.goto(BASE + '/office.html?paid=1');
  await p.waitForTimeout(23000);
  out.D = await p.evaluate(() => ({
    note: (document.getElementById('paynote')||{}).textContent || null,
    plan: JSON.parse(localStorage.getItem('ni-account-v1')||'{}').plan || null }));
  if (!out.D.note || !/support@negotiationinc\.com/.test(out.D.note))
    bad.push('D: a payment with no confirmation left somebody with nobody to email');
  if (out.D.plan) bad.push('D: a plan appeared without the server ever saying so');
  await p.close();
}

/* ══ E · cancelling is one click from the account panel ══════════════════ */
{
  PLAN = 'underwriter';
  const p = await page();
  await p.goto(BASE + '/office.html');
  await p.evaluate(() => localStorage.setItem('ni-session-v1', JSON.stringify({
    access_token:'at-e@x.com', refresh_token:'rt-e@x.com',
    expires_at: Date.now()+3.6e6, user:{ id:'u-e@x.com', email:'e@x.com' } })));
  await p.goto(BASE + '/office.html'); await p.waitForTimeout(1200);
  out.E_plan = await p.evaluate(() => JSON.parse(localStorage.getItem('ni-account-v1')||'{}').plan);
  await p.evaluate(() => { const w = document.getElementById('rn-who'); if (w) w.click(); });
  await p.waitForTimeout(400);
  out.E_bill = await p.evaluate(() => !!document.getElementById('ac-bill'));
  if (!out.E_bill) bad.push('E: a paying subscriber has no way to cancel from the account panel');
  else {
    await p.click('#ac-bill'); await p.waitForTimeout(900);
    out.E_went = p.url();
    if (!/portal=1/.test(p.url())) bad.push('E: the cancel button did not reach the billing portal');
  }
  await p.close();
}

/* ══ F · the browser cannot promote itself ═══════════════════════════════ */
{
  PLAN = null;
  const p = await page();
  await p.goto(BASE + '/office.html');
  await p.evaluate(() => {
    localStorage.setItem('ni-session-v1', JSON.stringify({ access_token:'at-e@x.com',
      refresh_token:'rt-e@x.com', expires_at: Date.now()+3.6e6, user:{ id:'u-e@x.com', email:'e@x.com' } }));
    localStorage.setItem('ni-account-v1', JSON.stringify({ name:'Elijah', email:'e@x.com', plan:'the office' }));
  });
  await p.goto(BASE + '/desk.html'); await p.waitForTimeout(1400);
  out.F = await p.evaluate(() => ({
    plan: JSON.parse(localStorage.getItem('ni-account-v1')||'{}').plan,
    tier: typeof tierOf === 'function' ? tierOf() : 'n/a' }));
  if (out.F.plan || out.F.tier > 0)
    bad.push('F: a plan typed into localStorage survived a page load');
  await p.close();
}

/* ══ G · the pre-launch preview does not fight the server ════════════════
   Before launch the account panel switches tiers locally so the product can
   be tested at every price. That used to be done by writing a plan onto the
   account record — which is the same field the server now owns, so the next
   page load reverted it and the switcher silently stopped working. Since the
   Supabase project gets set up BEFORE launch, this would have looked exactly
   like the gating being broken, on the day it most needed to be trusted. */
{
  PLAN = null;
  execFileSync('node', ['publish.mjs'], { cwd:'/home/claude', stdio:'ignore',
    env: { ...process.env, OUT, NI_ALLOW_LOCAL_SB:'1',
           NI_SUPABASE_URL:`http://127.0.0.1:${sbPort}`, NI_SUPABASE_ANON:SB_STUB_KEY } });
  const p = await page();
  await p.goto(BASE + '/desk.html');
  await p.evaluate(() => localStorage.setItem('ni-session-v1', JSON.stringify({
    access_token:'at-e@x.com', refresh_token:'rt-e@x.com',
    expires_at: Date.now()+3.6e6, user:{ id:'u-e@x.com', email:'e@x.com' } })));
  await p.goto(BASE + '/desk.html'); await p.waitForTimeout(1200);
  out.G_before = await p.evaluate(() => tierOf());
  await p.evaluate(() => localStorage.setItem('ni-preview-plan','Underwriter'));
  await p.goto(BASE + '/desk.html'); await p.waitForTimeout(1500);   // a full reload, with authBoot
  out.G_after = await p.evaluate(() => ({ tier: tierOf(),
    plan: JSON.parse(localStorage.getItem('ni-account-v1')||'{}').plan || null }));
  if (out.G_before !== 0) bad.push('G: a fresh account was not on the free tier');
  if (out.G_after.tier !== 2)
    bad.push('G: the pre-launch preview did not survive the server filling the account cache');
  if (out.G_after.plan !== null)
    bad.push('G: previewing a plan wrote one onto the account record');
  await p.close();
}

/* ══ H · A REFUSAL THAT NAMES A DOOR OPENS IT ═══════════════════════════════
   The server now refuses a second subscription to somebody who already has
   one: office.html's joinFromQuery() fires startCheckout() straight off
   ?join=underwriter with no plan check, so a stale bookmark used to bill an
   existing subscriber twice a month, indefinitely, with the product looking
   completely normal. The refusal says the change belongs in the billing
   portal — and saying that while making them go and find it is how a correct
   answer still loses a customer. So the sentence carries the button. */
{
  const p = await page();
  await p.goto(BASE + '/office.html'); await p.waitForTimeout(900);
  const r = await p.evaluate(() => {
    if (typeof window.__payNote !== 'function') return { no:'payNote' };
    let opened = 0;
    const n = window.__payNote('This account is already on underwriter.', 'bad',
      { label:'Manage your plan', fn: () => { opened++; } });
    const btn = n.querySelector('button');
    if (!btn) return { text:n.textContent, btn:false };
    btn.click();
    return { btn:true, label:btn.textContent, opened,
             says: n.textContent.indexOf('already on underwriter') >= 0,
             after: btn.textContent, disabled: btn.disabled };
  });
  out.H_refusal = r;
  if (r.no) bad.push('H: payNote is not exposed, so the refusal cannot carry an action');
  else {
    if (!r.btn) bad.push('H: an "already subscribed" refusal is a dead end — no way to the portal');
    if (r.opened !== 1) bad.push(`H: the button did not open the portal (${r.opened} times)`);
    if (!r.says) bad.push('H: the refusal stopped saying what was wrong once it grew a button');
    if (!r.disabled) bad.push('H: the button can be clicked twice, which opens two portal sessions');
  }
  /* and an ordinary refusal stays a plain sentence rather than growing a
     button to nowhere */
  const plain = await p.evaluate(() =>
    !window.__payNote('Sign in first.', 'bad').querySelector('button'));
  if (!plain) bad.push('H: every refusal grew a portal button, including ones the portal cannot fix');
  await p.close();
}

/* ══ J · THE SHAPE THE LIVE SITE IS ACTUALLY IN ════════════════════════════
   Every section above this one builds with the Supabase settings BAKED INTO
   THE PAGE, because that is convenient and because the harness said so out
   loud: "Section B bakes the values in and never asks."

   The live site does not have them baked in. They are fetched from
   /api/config, deliberately, so that a rebuild cannot strip the account layer
   out of a page whose server still has it. That fetch takes a network hop.

   Everything at the bottom of the billing module — authBoot, afterStripe,
   joinFromQuery — opened by asking whether the account layer was on. Baked in,
   the answer was yes at parse time and all three worked, which is why B2 went
   green while Elijah, signed in to his own live product, clicked Start 14 days
   free and landed on his account with nothing happening and nothing said. Not
   fetched yet meant off, and off meant return quietly.

   So this section builds the site the way the site is built, answers
   /api/config three hundred milliseconds late the way a server does, and then
   asserts the two things that spend or take money:

     · a signed-in customer clicking a plan reaches a checkout
     · somebody coming back from Stripe is TOLD something

   Anything that only holds when the settings are already in the page is not a
   test of this product. ════════════════════════════════════════════════════ */
{
  PLAN = null;
  execFileSync('node', ['publish.mjs'], { cwd:'/home/claude', stdio:'ignore',
    env: { ...process.env, OUT, NI_STAGE:'live' } });     // NOTHING baked in
  CONFIG = { ok:true, accounts:true,
             supabaseUrl:`http://127.0.0.1:${sbPort}`, supabaseAnon:SB_STUB_KEY };
  CONFIG_DELAY = 300;

  const p = await page();
  await p.goto(BASE + '/office.html'); await p.waitForTimeout(1200);
  out.J_authOn = await p.evaluate(() => !!(window.__authOn && window.__authOn()));
  if (!out.J_authOn)
    bad.push('J: the page never picked the account settings up from /api/config, '
           + 'so nothing below this can mean anything');

  /* a real session, made the way a real one is */
  await p.fill('#g-name','Live'); await p.fill('#g-email','live@x.com');
  await p.fill('#g-pw','sixchars');
  await p.click('#g-go'); await p.waitForTimeout(1800);
  await p.evaluate(() => { try { sessionStorage.removeItem('ni-join'); } catch(e){} });

  /* ── the click that is the whole funnel ── */
  LASTCHECKOUT = null;
  await p.goto(BASE + '/office.html?join=underwriter'); await p.waitForTimeout(2600);
  out.J_checkout = LASTCHECKOUT;
  out.J_parked   = await p.evaluate(() => sessionStorage.getItem('ni-join'));
  if (!LASTCHECKOUT || LASTCHECKOUT.plan !== 'underwriter')
    bad.push('J: on the live configuration a signed-in customer clicking a plan did NOT '
           + 'reach checkout — this is the exact failure a paying customer reported');
  if (out.J_parked)
    bad.push('J: the plan was parked instead of spent, on the live configuration');

  /* ── and the wordmark stops throwing a customer back to the sales page ── */
  out.J_mark = await p.evaluate(() => {
    const el = document.querySelector('a.marklink, a.mark, a.rn-mark');
    return el ? el.getAttribute('href') : null; });
  if (out.J_mark && out.J_mark.indexOf('index.html') >= 0)
    bad.push('J: signed in, the wordmark still points at the sales page — '
           + 'the biggest control on the screen is a trapdoor out of the product');
  await p.close();

  /* ── the return from Stripe, on the same configuration ── */
  {
    PLAN = null;
    const q = await page();
    await q.goto(BASE + '/office.html'); await q.waitForTimeout(1200);
    await q.evaluate(() => localStorage.setItem('ni-session-v1', JSON.stringify({
      access_token:'at-live@x.com', refresh_token:'rt-live@x.com',
      expires_at: Date.now()+3.6e6, user:{ id:'u-live@x.com', email:'live@x.com' } })));
    await q.goto(BASE + '/office.html?paid=1'); await q.waitForTimeout(2200);
    out.J_paidnote = await q.evaluate(() =>
      (document.getElementById('paynote')||{}).textContent || null);
    if (!out.J_paidnote)
      bad.push('J: somebody back from a real charge was shown nothing at all — '
             + 'silence after a payment is how you get a chargeback');
    await q.close();
  }
  CONFIG = null; CONFIG_DELAY = 0;
}

await b0.close(); sb.close(); site.close();
/* leave the tree the way it was found */
execFileSync('node', ['publish.mjs'], { cwd:'/home/claude', stdio:'ignore', env:{ ...process.env, OUT } });

console.log(JSON.stringify(out, null, 1));
if (bad.length){ console.log('FAIL'); bad.forEach(x => console.log(' - ' + x)); process.exit(1); }
console.log('PASS — unconfigured is unchanged, a chosen tier survives the door, the return from Stripe waits for the webhook and says so if it never comes, cancelling is one click, and a plan typed into localStorage is gone on the next load');
