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
       Billing §6 promises the $99 subscribers keep $99 and the founding
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
    log('stripe', r.status, (j.error && j.error.code) || 'error', path);
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
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_ANON || SB_KEY, authorization: 'Bearer ' + tok } });
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
  const r = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    headers: { 'content-type':'application/json', apikey: SB_KEY,
               authorization: 'Bearer ' + SB_KEY, Prefer: 'return=minimal' },
    body: JSON.stringify({ plan }),
  });
  log('plan', r.ok ? 'set' : 'FAILED', plan === null ? 'none' : plan);
  return r.ok;
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
    const price = PRICE[plan];
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

    /* Answer Stripe immediately and reconcile afterwards. A handler that does
       its work before replying is a handler that gets retried every time the
       database is slow, and every retry is another write. */
    res.json({ received: true });
    try { await reconcile(ev); } catch(e){ log('hook', (e && e.message) || 'failed'); }
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
  log('sub with no plan', sub.id);
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

  await write(uid, plan);
  return { uid, plan, subs: live.length };
}

export const billingState = () => ({
  pay: PAY_ON ? 'on' : 'off',
  hook: HOOK_ON ? 'on' : 'off',
  plans: Object.entries(PRICE).filter(([, v]) => v).map(([k]) => k),
  trialDays: TRIAL_DAYS,
});
