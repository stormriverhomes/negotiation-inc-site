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

/* ══ THE FOUNDING TWENTY-FIVE, WHICH COUNTS AND CLOSES ITSELF ══════════════
   A scarce offer somebody has to keep track of by hand is an offer that stays
   open too long, or closes early because nobody was sure. Both are worse than
   no offer: the first gives the discount away past the point it bought
   anything, and the second turns a promise into a thing that moved.

   So the count is not a number anybody types. It is asked of Stripe: how many
   subscriptions exist on the founding price. That is the only definition that
   cannot drift from what people were actually charged, and it is right the
   first time after a refund, a cancellation inside the window, or a
   subscription created by hand in the dashboard.

   THREE THINGS FOLLOW FROM IT AUTOMATICALLY, with nothing to remember:
     · the plans page says how many places are left, and stops saying it when
       there are none
     · checkout hands out the founding price while places remain and the
       normal price the moment they do not — inside one request, so two people
       arriving at place 25 cannot both get it
     · /ops shows the count

   A CANCELLED FOUNDER FREES THEIR PLACE. That is the honest reading of "25
   places": the promise is a price held for whoever holds a place, and somebody
   who left is not holding one. It also cannot be gamed — leaving costs the
   founding price permanently, since re-subscribing takes whatever is open. */
/* ── RETIRED, AND SWITCHED OFF AT THE SOURCE ──────────────────────────────
   The plans page no longer sells a founding place, so the checkout must not
   issue a founding price — and "must not" cannot be left resting on an
   environment variable that is currently unset. The whole point of the machine
   below is that it fails CLOSED, and the safest closed state is the one that
   does not depend on a dashboard field nobody is looking at.

   So the flag is code, not configuration. The counting, the seat maths and the
   webhook stamping stay exactly as they were and are all reachable again by
   flipping one boolean — the reasoning above was sound and the offer may come
   back. What it may not do is come back by accident, on the day somebody
   pastes STRIPE_PRICE_FOUNDING into Render out of habit while wiring the live
   keys, and quietly starts charging $79 to a page that says $129. */
const FOUNDING_ON    = false;
const FOUNDING_PRICE = FOUNDING_ON ? (process.env.STRIPE_PRICE_FOUNDING || '') : '';
if (!FOUNDING_ON && process.env.STRIPE_PRICE_FOUNDING)
  console.warn('[billing] STRIPE_PRICE_FOUNDING is set but the founding offer is retired '
    + '(FOUNDING_ON = false in billing.js). No founding price will be issued and the plans '
    + 'page does not name one. Unset the variable, or flip the flag deliberately.');
const FOUNDING_SEATS = Number(process.env.NI_FOUNDING_SEATS || 25);
const FOUNDING_TIER  = 'underwriter';       // what a founding place actually buys

/* Cached, because the plans page asks on every visit and Stripe is a network
   hop with a rate limit. Ninety seconds is short enough that "3 left" is never
   meaningfully stale and long enough that a front page does not become a
   denial-of-service on our own billing account. CHECKOUT DOES NOT USE THE
   CACHE — see foundingClaim below. */
let foundCache = { at: 0, taken: null };
/* the window is a variable so a harness can set it to zero and watch the count
   actually move — and so the number can be tightened in production from the
   dashboard, without a deploy, on the day the last few places are going */
const FOUND_TTL = Number(process.env.NI_FOUNDING_TTL_MS ?? 90000);
async function foundingTaken(force = false){
  if (!FOUNDING_PRICE || !SK) return null;
  if (!force && foundCache.taken !== null && Date.now() - foundCache.at < FOUND_TTL)
    return foundCache.taken;
  try {
    let taken = 0, url = `/v1/subscriptions?limit=100&status=all&price=${encodeURIComponent(FOUNDING_PRICE)}`;
    for (let page = 0; page < 5; page++){
      const j = await stripe('GET', url);
      for (const sub of (j.data || [])) if (LIVE_STATUS.has(sub.status)) taken++;
      if (!j.has_more || !j.data || !j.data.length) break;
      url = `/v1/subscriptions?limit=100&status=all&price=${encodeURIComponent(FOUNDING_PRICE)}`
          + `&starting_after=${encodeURIComponent(j.data[j.data.length - 1].id)}`;
    }
    foundCache = { at: Date.now(), taken };
    return taken;
  } catch(e){
    /* Stripe unreachable must not hand out an unbounded number of founding
       places. Unknown means the offer is closed until we can count again —
       failing closed on a discount is the same rule as failing closed on a key. */
    log('founding count failed');
    return null;
  }
}
export async function foundingState(){
  if (!FOUNDING_PRICE) return { on:false };
  const taken = await foundingTaken();
  if (taken === null) return { on:true, known:false, seats: FOUNDING_SEATS };
  return { on:true, known:true, seats: FOUNDING_SEATS, taken,
           left: Math.max(0, FOUNDING_SEATS - taken), open: taken < FOUNDING_SEATS,
           tier: FOUNDING_TIER };
}
/* the checkout-time question, and it is deliberately a different function:
   it never reads the cache, because two people arriving at place 25 within the
   same ninety seconds must not both be told yes. */
async function foundingClaim(plan){
  if (!FOUNDING_PRICE || plan !== FOUNDING_TIER) return null;
  const taken = await foundingTaken(true);
  if (taken === null || taken >= FOUNDING_SEATS) return null;
  return FOUNDING_PRICE;
}
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
    let price = Object.hasOwn(PRICE, plan) ? PRICE[plan] : '';
    if (!price) return res.status(400).json({ ok:false, error:'That is not a plan you can subscribe to here.' });
    /* ── AND IF THERE IS A FOUNDING PLACE LEFT, THIS IS IT ─────────────────
       Decided HERE, at the moment of purchase, from a live count — not from
       the number the page happened to be showing when it loaded. Somebody who
       opened the page while three places remained and checks out an hour later
       gets whatever is true when they press the button, in either direction.

       The plan the subscription BUYS is unchanged; only the price id differs.
       reconcile() reads the plan out of subscription metadata first and falls
       back to the price map, so the metadata below is what keeps a founding
       subscriber correctly on Underwriter rather than on no plan at all. */
    const founding = await foundingClaim(plan);
    if (founding) price = founding;

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
      /* every subscription that ever actually STARTED for this customer — see
         the note on trial_period_days below */
      const hadTrial = (have.data || []).some(s => STARTED_STATUS.has(s.status));
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
          /* `founding` is stamped so a place can be recognised later without
             re-deriving it from a price id that may be archived by then */
          metadata: { uid: who.uid, plan, ...(founding ? { founding: '1' } : {}) },
          /* ── FOURTEEN DAYS FREE, ONCE ─────────────────────────────────────
             The refusal above discards everything that is not currently live,
             which is right for "are you already subscribed" and wrong for
             "have you had the free fortnight". `trialing` is in LIVE_STATUS,
             so reconcile writes the full plan the moment a trial starts and
             before a cent is charged — so subscribe, use The Office free for
             thirteen days, cancel, subscribe again, forever, on one account
             and one card. The rows needed to see it were already in hand and
             were being thrown away.
             `incomplete` and `incomplete_expired` are deliberately NOT here: a
             card that failed at the checkout screen is somebody who never got
             the trial, and charging them for their own declined card the
             second time is punishing the wrong person. */
          ...(TRIAL_DAYS > 0 && !hadTrial ? { trial_period_days: TRIAL_DAYS } : {}),
        },
        /* ── THE TRIAL PUTS A CARD ON FILE ─────────────────────────────────
           Stripe collects one by default for a subscription, so this was
           already true — and something being true by default is something a
           future flag can quietly change. The plans page and the workspace
           door both promise "card on file, nothing charged for fourteen
           days", and a promise the product makes in words should be pinned
           in the request rather than inherited from an upstream default. */
        payment_method_collection: 'always',
        metadata: { uid: who.uid, plan },
        success_url: `${base}/office?paid=1`,
        cancel_url:  `${base}/plans`,
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
        { customer: cust, return_url: `${base}/office` });
      res.json({ ok:true, url: s.url });
    } catch(e){
      res.status(502).json({ ok:false, error:'The billing page could not be opened just now.' });
    }
  });

  /* ── HOW MANY PLACES ARE LEFT ────────────────────────────────────────────
     Public and unauthenticated on purpose: it is a number printed on a
     marketing page, it names nobody, and requiring a session to read it would
     mean the one page where the offer matters most could not show it.
     Cached upstream, so a front page cannot become a load test on Stripe. */
  app.get('/api/founding', async (_req, res) => {
    res.set('cache-control', 'public, max-age=60');
    res.json({ ok:true, ...(await foundingState()) });
  });

  /* ══ IS THIS CARD ACTUALLY WORKING ═══════════════════════════════════════
     Stripe retries a declined card for about two weeks and then cancels the
     subscription. During those two weeks the customer keeps the product —
     which is right, `past_due` is in LIVE_STATUS on purpose — and NOBODY TELLS
     THEM. Then one morning it cancels, they drop to free, and from where they
     are sitting the product broke. That is a cancellation you caused and did
     not have to.

     No new column, no migration: Stripe already knows, and this asks it. The
     answer is the subscription's own status plus the date the retries run out,
     so the account panel can say the true thing with a real deadline on it.

     It reports on the CALLER'S OWN subscription and nobody else's — whoIs()
     establishes that first, and the customer id is looked up from the uid
     rather than taken from the request. */
  app.get('/api/billing/state', async (req, res) => {
    if (!PAY_ON) return res.json({ ok:true, state:'unconfigured' });
    const who = await whoIs(req);
    if (!who) return res.status(401).json({ ok:false, error:'Sign in first.' });
    const cust = await customerOf(who.uid);
    if (!cust) return res.json({ ok:true, state:'none' });
    try {
      const subs = await stripe('GET',
        `/v1/subscriptions?limit=10&status=all&customer=${encodeURIComponent(cust)}`);
      const all = subs.data || [];
      /* ── WHAT COUNTS AS LIVE, AND WHAT COUNTS AS WORTH SAYING ────────────
         Not the same set, on purpose, and it is the same distinction as
         tierOf/entitled elsewhere: LIVE_STATUS decides what somebody is still
         ENTITLED to, and `unpaid` is correctly not in it — Stripe has stopped
         retrying and the money is not coming.

         But reporting only on LIVE_STATUS meant an `unpaid` subscription came
         back as "none", and "none" renders nothing at all — so the one person
         whose subscription has actually failed was the one person told
         nothing. This set is wider than that one BECAUSE it is only used to
         choose a sentence. */
      const SPEAKABLE = new Set(['active','trialing','past_due','unpaid','incomplete']);
      const live = all.filter(s => SPEAKABLE.has(s.status));
      /* the worst live status is the one worth saying: a customer with two
         subscriptions, one healthy and one failing, still has a problem */
      const rank = { past_due:3, unpaid:3, incomplete:2, trialing:1, active:0 };
      let worst = 'active', at = null, cancels = false;
      for (const s of live){
        if ((rank[s.status] || 0) > (rank[worst] || 0)) worst = s.status;
        if (s.cancel_at_period_end) cancels = true;
        if (s.current_period_end) at = Math.max(at || 0, s.current_period_end);
      }
      if (!live.length){
        const gone = all.find(s => s.status === 'canceled');
        return res.json({ ok:true, state: gone ? 'canceled' : 'none' });
      }
      res.json({ ok:true, state: worst, cancelsAtPeriodEnd: cancels,
                 periodEnd: at ? new Date(at * 1000).toISOString().slice(0, 10) : null });
    } catch(e){
      /* Stripe being unreachable is not "your card failed" — saying so would
         alarm somebody whose card is fine, which is worse than saying nothing */
      res.json({ ok:true, state:'unknown' });
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

/* ── AND WHAT COUNTS AS "HAS BEEN A SUBSCRIBER BEFORE" ────────────────────
   A wider set than LIVE_STATUS and used for exactly one decision: whether the
   fourteen free days have already been spent. Everything that ever billed or
   ever ran a trial is in it. `incomplete` and `incomplete_expired` are not —
   those are checkouts that died at the card screen, and their owner has had
   nothing. */
const STARTED_STATUS = new Set(['active', 'trialing', 'past_due', 'unpaid', 'canceled', 'paused']);

export function planOfSub(sub){
  if (!sub || !LIVE_STATUS.has(sub.status)) return null;
  const m = (sub.metadata && sub.metadata.plan) || '';
  const k = String(m).trim().toLowerCase();
  const pid = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price
            && sub.items.data[0].price.id;
  /* ── WHAT THE PRICE SAYS, WHEN THE PRICE IS ONE WE STILL SELL ─────────────
     Trap 1 at the top of this file says the plan must not be derived from the
     price id, and that is right — for a GRANDFATHERED price. It is exactly
     wrong for a current one, and the difference is the whole fix.

     Stripe's customer portal changes a subscription's PRICE. It has no way to
     write subscription metadata. So if plan switching is ever enabled on the
     portal configuration — and the 409 this file returns tells customers to go
     there for exactly that: "changing plan is done in the billing portal" —
     then a subscriber who moves from The Office to Solo pays $39 and keeps a
     metadata stamp that says "the office", forever. The reverse pays $249 and
     is served Solo, which the comment in reconcile() calls, correctly, theft.

     The disambiguation is already in the data. A grandfathered price is by
     definition one that is NOT in the current price map — that is what makes
     it grandfathered. So: if the price they are paying today is one we still
     sell, that is the plan they are on, whatever the metadata remembers about
     the day they joined. If it is not in the map, the price lock is in play
     and the metadata is the only honest answer. Both traps closed, and neither
     at the other's expense. */
  if (pid) for (const [name, id] of Object.entries(PRICE)){
    if (!id || id !== pid) continue;
    if (k && k !== name && PRICE.hasOwnProperty(k))
      log('sub price and metadata disagree — price wins');
    return name;
  }
  if (k && PRICE.hasOwnProperty(k)) return k;
  /* A subscription created by hand in the Stripe dashboard has no metadata and
     may be on a price we do not sell. Nothing left to read. */
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
/* ── READ AT CALL TIME, LIKE EVERY OTHER SETTING IN THIS FILE ─────────────
   Captured at import, both of these were unreachable to anything that boots
   the service twice — Node caches a module by URL, so the second boot got the
   first boot's numbers. Which made the claim three lines above ("NI_TRIAL_TIER
   can move it without a deploy") false, and, worse, made the switch untestable:
   the harness set it to 2, imported, and got 0. An untested switch on the one
   grant that hands out the paid product for free is the kind that turns out to
   have been stuck in the wrong position all along. */
const TRIAL_LEN  = () => NUMENV('NI_TRIAL_DAYS', 14);
/* ── AND NO CARD MEANS NO PRODUCT ──────────────────────────────────────────
   The fourteen days are sold as "card on file, nothing charged" — that is what
   the plans page says and what the workspace door now says. This column is the
   OTHER kind of trial: a grant with no card behind it, which nothing in the
   product writes and which would quietly contradict the offer if it did.

   So it grants nothing by default. The mechanism stays, because support
   comping somebody a fortnight is a real thing to want, and NI_TRIAL_TIER=2
   turns it on deliberately for as long as that is the intention. What it will
   not do is be the default and disagree with the price list. */
const TRIAL_TIER = () => NUMENV('NI_TRIAL_TIER', 0);
export function trialLeft(v, now = Date.now(), days = TRIAL_LEN()){
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
    /* ── A DATABASE THAT DID NOT ANSWER IS NOT AN ACCOUNT THAT DOES NOT EXIST ─
       Anything other than a 2xx fell through to 'noprofile', and every route
       maps that to a 403 reading "needs an account". So a rotated service key
       or a statement timeout told PAYING SUBSCRIBERS they had no account, in
       the tone of a refusal rather than an outage — and left a log trail that
       looks like a gate working correctly. 'lookup' is the same fail-closed
       answer said honestly, and the routes already map it to a 503. */
    if (!r.ok){ log('profile lookup', r.status); return { ok:false, why:'lookup' }; }
    const j = await r.json(); row = Array.isArray(j) ? j[0] : null;
  } catch(e){ return { ok:false, why:'lookup' }; }
  if (!row) return { ok:false, why:'noprofile' };

  const trialDaysLeft = trialLeft(row.trial);
  const tier = TIER[String(row.plan || '').trim().toLowerCase()] || 0;

  /* ── AND THE TRIAL BRANCH HAS TO CLEAR THE SAME BAR ────────────────────────
     This returned ok:true from inside the trial branch without ever looking at
     `need`. TRIAL_TIER defaults to 0 — the comment above it says so, out loud,
     as the safe default that "grants nothing" — so a row with a trial date and
     no plan came back {ok:true, tier:0} and EVERY route that asks for tier 2
     accepted it. Not a reduced grant either: capFor(feature, 0) hands back the
     full Underwriter allowance, so it was the paid product, free, for fourteen
     days, on our model key and our RentCast bill.

     Nothing in this repo writes `trial` and the signup trigger leaves it null,
     which is the only reason this has not already cost money. But the two ways
     it becomes real are both ordinary: support comping somebody a fortnight —
     the exact case the comment above calls "a real thing to want" — and the
     browser, because the row-level policy pins `plan` in its WITH CHECK and
     does NOT pin `trial`; only the column grant in 004 stands in the way, and
     005 exists precisely because that grant is easy to lose.

     A trial is a TIER, and a tier is compared against what the route needs.
     Same rule as every other path, and it keeps working when a future feature
     asks for 3. */
  const trialTier = Math.max(tier, TRIAL_TIER());
  if (trialDaysLeft > 0 && trialTier >= need)
    return { ok:true, uid:who.uid, tier:trialTier, trial:trialDaysLeft };
  if (tier >= need) return { ok:true, uid:who.uid, tier, trial:0 };
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

   ── AND THE GAP BETWEEN THEM, WHICH WAS NOT "ONE READ OF SLACK" ───────────
   This comment used to claim the exposure was a read of slack per person per
   month. It was not: ten PARALLEL requests at used=99 all read 99, all pass a
   cap of 100, and all reach the model — nine paid reads over the sold cap and
   ten real model calls, comfortably inside the per-IP limit. The window was
   bounded by concurrency, not by arithmetic.

   The obvious fixes are both worse than the bug:
     · enforcing inside ni_use cannot work — it runs AFTER the model call, so
       by the time it could refuse, the money is spent;
     · claim-before-work with a release on failure is the distributed
       transaction this file refuses on principle, and its failure mode is
       charging a customer's month for OUR error — the exact thing the
       two-call split exists to prevent.

   So the race is closed the way every other counter in server.js closes one:
   IN PROCESS. A request that passes the cap check places a HOLD; the check
   counts live holds on top of the database figure; the compare and the hold
   are synchronous inside one event-loop continuation, so two requests cannot
   both pass the last slot. The hold is dropped when countUse() lands the real
   count, and self-expires otherwise — a failed request never spends anything,
   it just keeps the boundary slot warm for two minutes.

   The trade, stated so nobody rediscovers it angrily: a second server
   instance would reopen the window to one instance's worth — the same
   accepted trade as the day budget, and a much smaller problem than a Redis
   dependency. And at the EXACT last read of a month, a failed attempt can
   shadow the boundary for up to HOLD_MS — the customer retries two minutes
   later, which is the right side to err on when the other side is unmetered
   spend. */
const HOLD_MS = 120_000;                 // the upstream abort is 90s; this outlives it
const holds = new Map();                 // `${uid}|${feature}` → [timestamps]
const liveHolds = k => (holds.get(k) || []).filter(t => t > Date.now() - HOLD_MS);
export function meterHolds(uid, feature){
  const k = uid + '|' + feature, a = liveHolds(k);
  if (a.length) holds.set(k, a); else holds.delete(k);
  return a.length;
}
export function meterHold(uid, feature){
  const k = uid + '|' + feature, a = liveHolds(k);
  a.push(Date.now()); holds.set(k, a);
  if (holds.size > 5000)
    for (const [key, v] of holds) if (!v.some(t => t > Date.now() - HOLD_MS)) holds.delete(key);
}
/* dropped only once the database HOLDS the count — dropping before the RPC
   commits would reopen the race in the gap between the two */
function meterDrop(uid, feature){
  const k = uid + '|' + feature, a = liveHolds(k);
  a.shift();
  if (a.length) holds.set(k, a); else holds.delete(k);
}
/* and the failure half of the same bargain: a request that placed a hold and
   then died — bad input, the daily budget, an upstream error — must give the
   slot back when its RESPONSE closes, or three garbage requests at cap−3
   shadow a customer's last reads for two minutes. Holds are a fungible count,
   so releasing "a" hold and releasing "this request's" hold are the same
   operation; the 200/non-200 split between countUse and the close-hook is
   what makes exactly one of them fire per request. The expiry stays as the
   backstop for the response that never closes at all. */
export function meterRelease(uid, feature){ meterDrop(uid, feature); }

/* Both meter calls return null where the function or table is not in the
   database yet, and every caller treats null as "do not block". A site
   deployed ahead of its migration must not switch off something people are
   paying for. */

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
  aiintake:   80,   // reading the paperwork — cheap per call, and the one
                    // people will reach for on every property they look at
  /* ── THE ONE METER THAT IS NOT A MODEL CALL ────────────────────────────
     Every other feature here bills tokens. This one bills a third party per
     REQUEST, on a plan with a fixed monthly allowance and an overage rate, so
     the cap is doing a different job: it is not rationing our compute, it is
     bounding a bill somebody else sends us. Forty a month is two comp pulls a
     working day, which is more than anybody underwriting properly needs, and
     on the worst tier it is eight dollars against a hundred-and-twenty-nine
     dollar subscription. */
  aicomps:    40,   // comps pulled and scored, on our key
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
  /* ── A CAP THAT IS NOT A NUMBER IS A METER THAT NEVER COUNTS ──────────────
     ni_use(who uuid, feat text, cap int) has three required arguments and no
     default. JSON.stringify DROPS an undefined value, so a caller that forgot
     the third argument sent {who, feat}, PostgREST could not resolve the
     overload, answered 404, and this function returned null — which every
     caller reads as "no figure to report" and answers 200 anyway. The meter
     read stayed at zero forever and the cap was never once enforced.
     That is how /api/comps and /api/lookup/rent spent an uncapped RentCast
     bill for weeks while /api/health said the cap was 40. */
  if (!Number.isFinite(Number(cap))){
    log('usage NOT COUNTED — no cap passed', feature);
    return null;
  }
  try {
    const r = await fetch(`${sbUrl()}/rest/v1/rpc/ni_use`, {
      method:'POST',
      headers:{ 'content-type':'application/json', apikey:sbKey(),
                authorization:'Bearer ' + sbKey() },
      body: JSON.stringify({ who: uid, feat: feature, cap: Math.floor(Number(cap)) }),
    });
    /* ── AND A WRITE THAT FAILED IS NOT A WRITE ──────────────────────────────
       The read half was hardened so that only a 404 means "no meter" and
       anything else refuses. The write half returned null on every failure and
       said NOTHING — no log line, nothing on /api/health — so a renamed
       function or a changed grant uncaps every metered feature for every
       account, permanently, and the first sign of it is the bill. */
    if (!r.ok){ log('usage write', r.status, feature); return null; }
    const j = await r.json();
    const row = Array.isArray(j) ? j[0] : j;
    /* the database holds the count now, so the in-flight hold that was
       standing in for it comes down. Only here: on any failure path above,
       the hold outlives the request and expires on its own — a use that was
       never recorded must keep its slot warm, or the race reopens in the gap
       between the RPC and this line. */
    meterDrop(uid, feature);
    return (row && typeof row.remaining === 'number')
      ? { used: row.used|0, remaining: row.remaining|0, cap } : null;
  } catch(e){ log('usage write failed', feature); return null; }
}

/* ── WHICH MONEY IS THIS ───────────────────────────────────────────────────
   `pay: on` said the checkout was wired. It did not say whether it was wired
   to REAL money, and those are different launch states: a site live on test
   keys takes no card anybody owns, and the failure is invisible from the
   outside — every button works, every redirect lands, and nothing arrives.

   The mode is read off the key's PREFIX, which is the one part of a Stripe
   secret that is not secret: sk_test_ / sk_live_ (rk_ for restricted keys).
   The key itself is never read, logged, or returned — only which of the two
   worlds it belongs to. */
const stripeMode = () => {
  const k = String(process.env.STRIPE_SECRET || '');
  if (!k) return 'unset';
  if (/^(sk|rk)_live_/.test(k)) return 'live';
  if (/^(sk|rk)_test_/.test(k)) return 'test';
  return 'unknown';
};
export const billingState = () => ({
  pay: PAY_ON ? 'on' : 'off',
  hook: HOOK_ON ? 'on' : 'off',
  mode: stripeMode(),
  plans: Object.entries(PRICE).filter(([, v]) => v).map(([k]) => k),
  trialDays: TRIAL_DAYS,
});
