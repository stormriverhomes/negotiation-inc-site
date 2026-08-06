/* ══ THE PAYMENT RAIL ══════════════════════════════════════════════════════
   Three routes and one rule: THE ONLY THING THAT DECIDES WHAT SOMEBODY GETS
   IS `profiles.plan`, and the only writer of that column is this file.

   `tierOf()` in the desk reads exactly one field. The webhook writes exactly
   one field. Everything between them — the price, the coupon, the trial, the
   proration, the invoice — is Stripe's problem and never becomes the
   product's. That is the whole design, and it is worth defending, because
   every billing system that has ever gone wrong went wrong by letting a
   second thing decide.

   ── NO SDK ────────────────────────────────────────────────────────────────
   Stripe's REST API is form-encoded HTTP and its webhook signature is an
   HMAC. The npm package is two megabytes and a supply chain to carry for six
   calls and thirty lines of crypto. `server.js` depends on Express and
   nothing else, and it is staying that way.

   ── THE TWO TRAPS ─────────────────────────────────────────────────────────

   1 · THE PLAN MUST NOT BE DERIVED FROM THE PRICE ID.
       Billing §6 promises every subscriber keeps the price they joined at
       and the founding
       hundred keep $49, permanently — which means grandfathered subscribers
       sit on price objects that are no longer the current ones. Map price →
       plan and the day you raise the price, every founding member's webhook
       looks up a price that is not in the environment any more and their
       account goes dark. So the plan is written into the SUBSCRIPTION'S
       METADATA at checkout and read back from there. Prices may change
       forever; the metadata is what the subscription was sold as.

   2 · WEBHOOKS ARRIVE OUT OF ORDER.
       A `deleted` for last month's cancelled subscription can land after an
       `updated` for this month's new one, and a naive handler would wipe a
       paying customer. So no event body is trusted for state: an event is a
       nudge that says "this customer changed", and the handler answers by
       ASKING STRIPE what is true right now and writing that. Replays,
       reorders and duplicates all converge on the same answer.
   ═══════════════════════════════════════════════════════════════════════ */

import express from 'express';
import crypto from 'node:crypto';

const SK      = process.env.STRIPE_SECRET || '';
const WHSEC   = process.env.STRIPE_WEBHOOK_SECRET || '';
/* ── READ AT CALL TIME, NOT AT IMPORT ─────────────────────────────────────
   These were captured once when the module loaded. That is fine right up
   until you try to prove the fail-closed path works: a harness that boots the
   service twice, once unconfigured and once configured, gets the FIRST boot's
   configuration both times, because Node caches a module by its URL and the
   second import of server.js resolves to the same billing.js. The second boot
   silently ran with no account layer and answered "not switched on" — which
   looks exactly like the gate working, and is the gate not being tested.

   An untested fail-closed path is the one that turns out to fail open. So the
   configuration is read where it is used. It is three env lookups on a route
   that is about to make an HTTPS call to a model; the cost is not measurable
   and the property — that this can be reconfigured and therefore verified —
   is worth having. */
const sbUrl  = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const sbKey  = () => process.env.SUPABASE_SERVICE_KEY || '';
const sbAnon = () => process.env.SUPABASE_ANON_KEY || '';
const SB_URL  = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const SB_ANON = process.env.SUPABASE_ANON_KEY || '';
const SITE    = (process.env.NI_SITE_URL || '').replace(/\/+$/, '');
const API     = (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '');

/* what a NEW subscriber pays today. Changing these does not touch anybody who
   already subscribed — that is the entire mechanism behind the price lock. */
const PRICE = {
  'solo':        process.env.STRIPE_PRICE_SOLO || '',
  'underwriter': process.env.STRIPE_PRICE_UNDERWRITER || '',
  'the office':  process.env.STRIPE_PRICE_OFFICE || '',
};
const TRIAL_DAYS = Number(process.env.STRIPE_TRIAL_DAYS || 14);

/* fails closed, exactly like the photo read: an unconfigured deploy has no
   checkout rather than a broken one */
const PAY_ON  = !!(SK && SB_URL && SB_KEY);
const HOOK_ON = !!(SK && WHSEC && SB_URL && SB_KEY);

const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ── Stripe, form-encoded ──────────────────────────────────────────────────
   Stripe takes nested objects as bracketed keys, so this flattens rather than
   asking every call site to spell out `subscription_data[metadata][uid]`. */
function form(obj, prefix = '', out = []){
  for (const [k, v] of Object.entries(obj)){
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) form(v, key, out);
    else if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object'
      ? form(x, `${key}[${i}]`, out)
      : out.push([`${key}[${i}]`, String(x)])));
    else out.push([key, String(v)]);
  }
  return out;
}
const safePath = p => String(p).split('?')[0]
  .replace(/\/(cus|sub|price|cs|in|pi|seti)_[A-Za-z0-9]+/g, '/$1_…');

async function stripe(method, path, body){
  const init = { method, headers: {
    authorization: 'Bearer ' + SK,
    'stripe-version': '2024-06-20',
  } };
  if (body){
    init.headers['content-type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(form(body)).toString();
  }
  const r = await fetch(API + path, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok){
    /* the upstream message is written for a developer reading a dashboard and
       may quote an id or an amount — it is logged by TYPE only and never
       returned to a browser */
    /* the PATH carries identifiers — /v1/customers/cus_XXXX from reconcile, and
       a query string containing the caller's own Supabase uid from
       customerOf(). The comment above promises a type and nothing else, so the
       path is stripped to its shape before it reaches a log line. */
    log('stripe', r.status, (j.error && j.error.code) || 'error', safePath(path));
    const e = new Error('stripe'); e.status = r.status; e.code = (j.error && j.error.code) || ''; throw e;
  }
  return j;
}

/* ── who is asking ─────────────────────────────────────────────────────────
   The access token is Supabase's, so Supabase is the one that says whether it
   is real. This service never parses a JWT itself: reading the claims out of
   a token you have not verified is how you end up trusting one that was typed
   by hand, and verification means holding the project's signing key here too.
   One round trip, no second key, no chance of getting it wrong. */
async function whoIs(req){
  const h = String(req.get('authorization') || '');
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!tok || tok.length > 4000) return null;
  if (!sbAnon()) { log('auth: SUPABASE_ANON_KEY is not set — nobody can sign in'); return null; }
  try {
    const r = await fetch(`${sbUrl()}/auth/v1/user`, {
      /* NOT `sbAnon() || sbKey()`. SUPABASE_ANON_KEY is sync:false in
         render.yaml while ACCOUNTS_ON() needs only the URL and the service key,
         so a deploy that sets the two required vars and forgets the anon key
         used to put the key that bypasses every row-level policy into the
         apikey header of every sign-in round trip — on the one call whose whole
         purpose is to avoid needing a second key. Fail closed instead. */
      headers: { apikey: sbAnon(), authorization: 'Bearer ' + tok } });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) ? { uid: u.id, email: u.email || '' } : null;
  } catch(e){ return null; }
}

/* ── the one column ────────────────────────────────────────────────────────
   Written here and nowhere else. The row-level policy on `profiles` refuses
   this write to every key except the service role, which is what makes a plan
   typed into developer tools worth nothing. */
async function setPlan(uid, plan){
  /* read at call time, like every other reader in this file. Captured at
     import, the fail-closed behaviour the comment at the top describes could
     not be exercised by a harness that boots twice — and this is the ONE
     function that writes the column, so it was the one that mattered most. */
  const r = await fetch(`${sbUrl()}/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    headers: { 'content-type':'application/json', apikey: sbKey(),
               authorization: 'Bearer ' + sbKey(),
               /* representation, not minimal: `Prefer: return=minimal` made a
                  PATCH that matched ZERO ROWS answer 204, so a uid with no
                  profiles row logged "plan set" and changed nothing. A write
                  that wrote nothing is a failure, and the webhook has to be
                  able to tell — it is the difference between Stripe retrying
                  and a cancelled customer keeping their tier forever. */
               Prefer: 'return=representation' },
    body: JSON.stringify({ plan }),
  });
  if (!r.ok){ log('plan FAILED', r.status, plan === null ? 'none' : plan); return false; }
  const rows = await r.json().catch(() => null);
  const hit = Array.isArray(rows) ? rows.length : 0;
  if (!hit){ log('plan NO ROW', plan === null ? 'none' : plan); return false; }
  log('plan set', plan === null ? 'none' : plan);
  return true;
}

/* ── finding somebody's customer record ────────────────────────────────────
   By searching Stripe for the uid rather than by keeping a customer id in a
   column of our own. A stored id is a second copy of a fact, and a second
   copy can be stale or — much worse — belong to the wrong person, which in a
   billing portal means showing a stranger somebody's card. Stripe owns the
   customer, the database owns the plan, and neither is duplicated.

   Search is indexed asynchronously, so a customer created seconds ago may not
   be findable yet. That only matters to somebody who subscribes and then
   immediately opens the billing portal, and the honest answer to them is a
   sentence saying so rather than an error. */
async function customerOf(uid){
  const q = `metadata['uid']:'${String(uid).replace(/'/g, '')}'`;
  try {
    const j = await stripe('GET', `/v1/customers/search?limit=1&query=${encodeURIComponent(q)}`);
    return (j.data && j.data[0]) ? j.data[0].id : null;
  } catch(e){ return null; }
}

/* ══ ROUTES ═══════════════════════════════════════════════════════════════ */
export function mountBilling(app){

  /* ── start a subscription ─────────────────────────────────────────────── */
  app.post('/api/checkout', express.json({ limit:'4kb' }), async (req, res) => {
    if (!PAY_ON) return res.status(503).json({ ok:false, error:'Subscriptions are not switched on yet.' });
    const who = await whoIs(req);
    if (!who) return res.status(401).json({ ok:false, error:'Sign in first.' });

    const plan = String((req.body || {}).plan || '').trim().toLowerCase();
    /* Object.hasOwn, not a truthiness check on PRICE[plan]: PRICE['constructor']
       is Object, which is truthy, so a caller could send a prototype key and
       have `function Object() { [native code] }` forwarded to Stripe as a
       price id. It dies upstream as a 502 rather than a clean 400 — a wasted
       round trip and a misleading error. planOfSub already does this properly. */
    const price = Object.hasOwn(PRICE, plan) ? PRICE[plan] : '';
    if (!price) return res.status(400).json({ ok:false, error:'That is not a plan you can subscribe to here.' });

    try {
      /* one customer per person, found by the uid rather than by the email —
         people change their email and two accounts must never collide */
      let cust = await customerOf(who.uid);
      if (!cust){
        const c = await stripe('POST', '/v1/customers',
          { email: who.email || undefined, metadata: { uid: who.uid } });
        cust = c.id;
      }
      /* ── AND NOT A SECOND ONE ────────────────────────────────────────────
         Nothing here checked whether this person already had a live
         subscription. `office.html`'s joinFromQuery() fires startCheckout()
         straight off `?join=underwriter` with no plan check, so an existing
         subscriber following that link from a bookmark or from the marketing
         site completed a second checkout against the same Stripe customer and
         was billed twice a month, indefinitely. `reconcile` takes the higher
         of the two, so the product looked completely normal — which is how it
         would have stayed until somebody read a bank statement. That is the
         shape of thing that becomes a chargeback and a refund thread rather
         than a bug report.

         Upgrades and downgrades belong in the portal, which prorates them and
         cancels the old one. This says so instead of selling another. */
      const have = await stripe('GET',
        `/v1/subscriptions?limit=20&status=all&customer=${encodeURIComponent(cust)}`);
      const live = (have.data || []).filter(s => LIVE_STATUS.has(s.status));
      if (live.length){
        const now = live.map(planOfSub).filter(Boolean);
        log('checkout refused: already subscribed', live.length);
        return res.status(409).json({ ok:false, portal:true,
          error: now.length
            ? `This account is already on ${now[0]}. Changing plan is done in the billing `
              + 'portal, which prorates it and cancels the old one — subscribing again here '
              + 'would bill you twice.'
            : 'This account already has a live subscription. Manage it in the billing portal '
              + 'rather than starting a second one.' });
      }
      const base = SITE || `${req.protocol}://${req.get('host')}`;
      const s = await stripe('POST', '/v1/checkout/sessions', {
        mode: 'subscription',
        customer: cust,
        client_reference_id: who.uid,
        line_items: [{ price, quantity: 1 }],
        allow_promotion_codes: true,
        /* THE PLAN TRAVELS WITH THE SUBSCRIPTION, not with the price. See the
           first trap at the top of this file. */
        subscription_data: {
          metadata: { uid: who.uid, plan },
          ...(TRIAL_DAYS > 0 ? { trial_period_days: TRIAL_DAYS } : {}),
        },
        metadata: { uid: who.uid, plan },
        success_url: `${base}/office.html?paid=1`,
        cancel_url:  `${base}/plans.html`,
      });
      log('checkout', plan);
      res.json({ ok:true, url: s.url });
    } catch(e){
      res.status(502).json({ ok:false, error:'Stripe could not start that just now. Try again in a moment.' });
    }
  });

  /* ── cancel, change card, read invoices ───────────────────────────────────
     Refunds §2 promises thirty days no reason needed and the plans page
     promises cancelling takes two clicks. Stripe's own portal is those two
     clicks, and a portal we wrote ourselves would be a worse one with more
     ways to strand somebody mid-cancellation. */
  app.post('/api/portal', express.json({ limit:'4kb' }), async (req, res) => {
    if (!PAY_ON) return res.status(503).json({ ok:false, error:'Subscriptions are not switched on yet.' });
    const who = await whoIs(req);
    if (!who) return res.status(401).json({ ok:false, error:'Sign in first.' });
    const cust = await customerOf(who.uid);
    if (!cust) return res.status(404).json({ ok:false,
      error:'No billing record yet. If you have only just subscribed, give it a minute and try again.' });
    try {
      const base = SITE || `${req.protocol}://${req.get('host')}`;
      const s = await stripe('POST', '/v1/billing_portal/sessions',
        { customer: cust, return_url: `${base}/office.html` });
      res.json({ ok:true, url: s.url });
    } catch(e){
      res.status(502).json({ ok:false, error:'The billing page could not be opened just now.' });
    }
  });

  /* ── the webhook ──────────────────────────────────────────────────────────
     express.raw, because a signature is over the BYTES. Parse the body first
     and re-serialise it and the signature will not match — which is the
     classic way this is broken, and it is broken silently, in production, on
     the one day it matters. */
  app.post('/api/stripe', express.raw({ type:'*/*', limit:'1mb' }), async (req, res) => {
    if (!HOOK_ON) return res.status(503).send('off');
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''));
    if (!verify(raw, req.get('stripe-signature') || '')) { log('hook bad-signature'); return res.status(400).send('bad signature'); }

    let ev; try { ev = JSON.parse(raw.toString('utf8')); } catch(e){ return res.status(400).send('bad json'); }

    /* ── AND THE RETRY IS THE POINT ────────────────────────────────────────
       This used to answer Stripe first and reconcile afterwards, on the
       reasoning that a handler doing its work before replying gets retried
       whenever the database is slow. That is true, and it is the wrong trade,
       because reconcile() is IDEMPOTENT — it reads the truth from Stripe and
       writes one column — so a retry costs one extra read and a duplicate
       write of the same value. What the old order cost is much worse.

       `customer.subscription.deleted` is the LAST event a cancelled customer
       will ever generate. No invoice follows it, no update, nothing. So if the
       plan write failed — a 502 from Supabase's gateway, a service key rotated
       an hour ago returning 401 — the process had already put 200 on the wire,
       Stripe would never redeliver, and one log line went by: `plan FAILED
       none`. That customer keeps The Office, free, permanently, and nothing in
       the system will ever notice. The subscribe side self-heals because more
       events follow it; the cancel side is terminal. That asymmetry is exactly
       backwards from the one you want.

       So: reconcile, then answer. A 500 here means Stripe retries with backoff
       for three days, which is the behaviour the endpoint was built to have. */
    try {
      const r = await reconcile(ev);
      res.json({ received: true, ...(r && r.skipped ? { skipped: r.skipped } : {}) });
    } catch(e){
      /* Never the upstream message: it can carry a customer id or an amount. */
      log('hook FAILED', (e && e.niKind) || 'error', String((ev && ev.type) || ''));
      res.status(500).json({ received: false });
    }
  });
}

/* ── the signature ────────────────────────────────────────────────────────
   t=<unix>,v1=<hex>. HMAC over `${t}.${body}`, compared in constant time,
   inside a five-minute window so a captured request cannot be replayed back
   at the endpoint tomorrow. */
export function verify(raw, sig, secret = WHSEC, nowMs = Date.now()){
  if (!secret || !sig) return false;
  const parts = Object.fromEntries(String(sig).split(',').map(s => {
    const i = s.indexOf('='); return [s.slice(0, i).trim(), s.slice(i + 1).trim()]; }));
  const t = Number(parts.t);
  if (!Number.isFinite(t)) return false;
  if (Math.abs(nowMs / 1000 - t) > 300) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${raw.toString('utf8')}`).digest();
  /* several v1 signatures may be present during a secret rotation */
  for (const v of String(sig).split(',').filter(s => s.trim().startsWith('v1='))){
    const got = Buffer.from(v.trim().slice(3), 'hex');
    if (got.length === want.length && crypto.timingSafeEqual(got, want)) return true;
  }
  return false;
}

/* ── what a subscription is worth ─────────────────────────────────────────
   `past_due` KEEPS the plan. Stripe retries a failed card for about three
   weeks, and most of those retries succeed — usually it is an expiry date, not
   a decision. Cutting somebody off on the first decline turns a card that
   needed updating into a customer who left. `unpaid` is where the retries have
   run out, and that is where access ends. */
const LIVE_STATUS = new Set(['active', 'trialing', 'past_due']);

export function planOfSub(sub){
  if (!sub || !LIVE_STATUS.has(sub.status)) return null;
  const m = (sub.metadata && sub.metadata.plan) || '';
  const k = String(m).trim().toLowerCase();
  if (k && PRICE.hasOwnProperty(k)) return k;
  /* A subscription created by hand in the Stripe dashboard has no metadata.
     Falling back to the price map is right for exactly that case, and it is a
     fallback rather than the rule for the reason at the top of this file. */
  const pid = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price
            && sub.items.data[0].price.id;
  for (const [name, id] of Object.entries(PRICE)) if (id && id === pid) return name;
  log('sub with no plan');
  return null;
}

/* ── reconcile ────────────────────────────────────────────────────────────
   The event says WHO changed. Stripe says WHAT IS TRUE. This never reads
   state out of the event body, so replays and out-of-order deliveries all
   land on the same answer — which is the second trap at the top of the file.
*/
export async function reconcile(ev, deps = {}){
  const call = deps.stripe || stripe;
  const write = deps.setPlan || setPlan;
  const obj = (ev && ev.data && ev.data.object) || {};
  const kind = String((ev && ev.type) || '');

  let cust = null, uid = null;
  if (kind.startsWith('customer.subscription.')){ cust = obj.customer; uid = obj.metadata && obj.metadata.uid; }
  else if (kind === 'checkout.session.completed'){ cust = obj.customer; uid = obj.client_reference_id || (obj.metadata && obj.metadata.uid); }
  else if (kind.startsWith('invoice.')){ cust = obj.customer; }
  else return { skipped: kind };
  if (!cust) return { skipped: 'no customer' };

  /* every live subscription this customer has, from Stripe, right now */
  const subs = await call('GET', `/v1/subscriptions?limit=20&status=all&customer=${encodeURIComponent(cust)}`);
  const live = (subs.data || []).filter(s => LIVE_STATUS.has(s.status));

  if (!uid){
    uid = (live.find(s => s.metadata && s.metadata.uid) || {}).metadata?.uid
       || (await call('GET', `/v1/customers/${encodeURIComponent(cust)}`)).metadata?.uid;
  }
  if (!uid){ log('hook no uid for customer'); return { skipped: 'no uid' }; }

  /* Somebody who upgrades mid-month can briefly hold two subscriptions. Give
     them the HIGHER one — the alternative is charging for The Office and
     serving Solo, which is the one direction of this mistake that is theft. */
  const RANK = { 'solo':1, 'underwriter':2, 'the office':3 };
  let plan = null, best = 0;
  for (const s of live){ const p = planOfSub(s); const r = RANK[p] || 0; if (p && r > best){ best = r; plan = p; } }

  /* the return value was discarded. A write that failed then looked exactly
     like a write that worked, all the way up to the 200 the endpoint sent. */
  const wrote = await write(uid, plan);
  if (wrote === false){
    const e = new Error('plan not written'); e.niKind = 'plan-write'; throw e;
  }
  return { uid, plan, subs: live.length };
}

/* ── THE ENTITLEMENT, DERIVED HERE ─────────────────────────────────────────
   Exported because /api/read needs exactly this and must not reimplement it.
   Two facts, both from the database, neither from the request body:

     · the plan, which only the service role can write, so a plan typed into
       developer tools is worth nothing here
     · the trial, which is a date the signup trigger set — and which is checked
       against the SERVER's clock, because a trial checked against the caller's
       clock is a trial that never ends

   Returns a small object rather than a boolean so the route can say WHY, and
   so a future feature at a different tier can ask the same question.
   Fails closed: with Supabase unconfigured there is no account layer, and
   without an account layer nothing is entitled to spend the key. */
const TIER = { 'solo':1, 'underwriter':2, 'the office':3 };

/* ── THE TRIAL WAS THREE BUGS STACKED ──────────────────────────────────────
   1 · `Date.parse(String(row.trial) + 'T00:00:00Z')`. SUPABASE.md declares
       `trial timestamptz`, and PostgREST returns
       "2026-08-06T14:23:11.123456+00:00" — so the concatenation produced
       "...+00:00T00:00:00Z" and Date.parse gave NaN. Every trial was zero days
       old and zero days long, while the refusal it produced read "…and with
       the fourteen-day trial". It failed CLOSED, which is why nobody has been
       charged for it, but the column is described as load-bearing in three
       documents and anybody backfilling it by hand — support granting a
       courtesy trial is the obvious case — got silence.
   2 · `TRIAL_DAYS` is `STRIPE_TRIAL_DAYS`, doing double duty. Setting it to 0
       to drop Stripe's card-first trial also deleted the in-app one for every
       account; raising it to 30 for a promotion retroactively resurrected
       trials that expired weeks ago. They are two different decisions and now
       they are two different variables.
   3 · `Math.max(tier, 3)` handed THE OFFICE — three times every cap — to
       anyone inside the window, including a Solo customer paying $49. The copy
       everywhere says the trial is Underwriter, so that is what it now grants,
       and NI_TRIAL_TIER can move it without a deploy if that turns out wrong.

   Takes a date or a timestamp, in either shape, and refuses anything else. */
const NUMENV = (k, d) => { const v = Number(process.env[k]);
  return Number.isFinite(v) && v >= 0 ? v : d; };
const TRIAL_LEN  = NUMENV('NI_TRIAL_DAYS', 14);
const TRIAL_TIER = NUMENV('NI_TRIAL_TIER', 2);          // Underwriter, as advertised
export function trialLeft(v, now = Date.now(), days = TRIAL_LEN){
  if (!v) return 0;
  const s = String(v).trim();
  /* a bare date is midnight UTC; anything with a time in it already says so */
  const started = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00Z' : s);
  if (!Number.isFinite(started)) return 0;
  /* a trial that has not started yet is not a trial with extra days on it */
  if (started > now) return 0;
  return Math.max(0, days - Math.floor((now - started) / 86400000));
}
export async function entitlementOf(req, need = 2){
  if (!sbUrl() || !sbKey()) return { ok:false, why:'unconfigured' };
  const who = await whoIs(req);
  if (!who) return { ok:false, why:'nosession' };
  let row = null;
  try {
    const r = await fetch(`${sbUrl()}/rest/v1/profiles?id=eq.${encodeURIComponent(who.uid)}`
      + '&select=plan,trial', { headers:{ apikey:sbKey(), authorization:'Bearer ' + sbKey() } });
    if (r.ok){ const j = await r.json(); row = Array.isArray(j) ? j[0] : null; }
  } catch(e){ return { ok:false, why:'lookup' }; }
  if (!row) return { ok:false, why:'noprofile' };

  const trialDaysLeft = trialLeft(row.trial);
  const tier = TIER[String(row.plan || '').trim().toLowerCase()] || 0;

  if (trialDaysLeft > 0) return { ok:true, uid:who.uid, tier:Math.max(tier, TRIAL_TIER), trial:trialDaysLeft };
  if (tier >= need)      return { ok:true, uid:who.uid, tier, trial:0 };
  return { ok:false, why: tier === 0 ? 'free' : 'lowtier', uid:who.uid, tier };
}

/* ══ THE METER ═════════════════════════════════════════════════════════════
   One table, one function, a row per (person, feature, month). This replaced
   two columns on `profiles` the moment there was going to be a second AI
   feature: five features would have been ten columns, five copies of the same
   roll-the-month arithmetic, and a schema migration on every ship.

   TWO CALLS, NOT ONE, and the split is deliberate:
     · usedThisMonth() before the work, to refuse somebody who is out
     · countUse() after it succeeded, so an upstream failure does not spend a
       month on our error
   The gap between them is a read of slack per person per month, which is a
   much better trade than a reservation that has to be handed back whenever a
   model call errors — that is a distributed transaction for a rounding error.

   Both return null where the function or table is not in the database yet, and
   every caller treats null as "do not block". A site deployed ahead of its
   migration must not switch off something people are paying for. */

/* Caps are per feature per tier, and The Office is 3x Underwriter throughout.
   Every one is overridable from the environment because the right number is
   discovered from usage, not from a meeting — and changing it should not be a
   deploy. NI_CAP_AIREAD=150 sets Underwriter; Office follows unless
   NI_CAP_AIREAD_OFFICE says otherwise. */
const CAP_DEFAULT = {
  airead:    100,   // the photo condition read
  aicompare:  30,   // the written comparison
  aistreet:   40,   // the street brief
  aibid:      20,   // the contractor bid check
  ailetter:   60,   // the other side of the table
};
export const FEATURES = Object.keys(CAP_DEFAULT);
/* ── AND A CAP OF ZERO MEANT UNLIMITED ─────────────────────────────────────
   `Number('')` is 0 and `Number.isFinite(0)` is true. So NI_CAP_AIREAD added
   to Render with the value field left EMPTY read as an explicit cap of zero —
   and the route's guard is `if (cap > 0 && …)`, so zero skipped the check and
   handed every subscriber unlimited reads. An operator setting a cap to 0 to
   switch a feature off got the exact opposite of what they typed, on the one
   env var whose whole purpose is to bound spend.

   A blank value is now "not set", and a real zero is honoured as zero. The
   route reads `cap === 0` as off rather than as unlimited. */
const capEnv = name => {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return null;   // not set
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};
export function capFor(feature, tier){
  const two = capEnv('NI_CAP_' + feature.toUpperCase()) ?? CAP_DEFAULT[feature];
  if (two === undefined) return 0;
  if (tier < 3) return two;
  return capEnv('NI_CAP_' + feature.toUpperCase() + '_OFFICE') ?? two * 3;
}

const monthStart = () => new Date().toISOString().slice(0, 8) + '01';

/* A sentinel no cap can be below, so a caller whose meter could not be read
   is refused rather than waved through. It is a VALUE rather than a second
   return channel on purpose: every route already compares `used >= cap`, so
   there is no new branch anybody can forget to write. */
export const NOMETER = Number.MAX_SAFE_INTEGER;

/* what this person has already spent on this feature this month */
export async function usedThisMonth(uid, feature){
  if (!sbUrl() || !sbKey() || !uid) return null;
  try {
    const q = `${sbUrl()}/rest/v1/usage?uid=eq.${encodeURIComponent(uid)}`
      + `&feature=eq.${encodeURIComponent(feature)}&month=eq.${monthStart()}&select=used`;
    const r = await fetch(q, { headers:{ apikey:sbKey(), authorization:'Bearer ' + sbKey() } });
    /* ── "NO TABLE YET" IS A 404, AND NOTHING ELSE IS ────────────────────
       This returned null on EVERY non-200, and null means "do not block" all
       the way up. The missing-migration case is deliberate and stays: a site
       deployed ahead of its migration must not switch off a paid feature. But
       the branch could not tell a 404 from anything else, so a renamed column
       (400), a rotated service key (401), or a statement timeout on the usage
       index (500/504) silently uncapped all five metered features for every
       subscriber — with `profiles` untouched, so nothing else would notice
       until the model bill arrived.
       404 means the meter is not there. Anything else means the meter is
       there and broken, and a broken meter is not a licence. */
    if (r.status === 404) return null;
    if (!r.ok){ log('usage lookup', r.status, feature); return NOMETER; }
    const j = await r.json();
    return Array.isArray(j) && j[0] ? (j[0].used|0) : 0;
  } catch(e){ log('usage lookup failed', feature); return NOMETER; }
}

/* spend one, and say what is left */
export async function countUse(uid, feature, cap){
  if (!sbUrl() || !sbKey() || !uid) return null;
  try {
    const r = await fetch(`${sbUrl()}/rest/v1/rpc/ni_use`, {
      method:'POST',
      headers:{ 'content-type':'application/json', apikey:sbKey(),
                authorization:'Bearer ' + sbKey() },
      body: JSON.stringify({ who: uid, feat: feature, cap }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const row = Array.isArray(j) ? j[0] : j;
    return (row && typeof row.remaining === 'number')
      ? { used: row.used|0, remaining: row.remaining|0, cap } : null;
  } catch(e){ return null; }
}

export const billingState = () => ({
  pay: PAY_ON ? 'on' : 'off',
  hook: HOOK_ON ? 'on' : 'off',
  plans: Object.entries(PRICE).filter(([, v]) => v).map(([k]) => k),
  trialDays: TRIAL_DAYS,
});
