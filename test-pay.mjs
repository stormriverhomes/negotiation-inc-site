/* test-pay — the payment rail, against a Stripe that lies to it.

   A billing bug is not a bug you find in production, it is a bug a customer
   finds in production and then tells other people about. So this harness does
   not check that a happy path works; it checks the four ways this specific
   design can go wrong, each of which is silent, and two of which only appear
   months after launch:

     A · it fails closed, and a forged webhook is refused
     B · the signature is over the BYTES, inside a window, and survives a
         secret rotation
     C · A GRANDFATHERED SUBSCRIBER DOES NOT GO DARK when the price changes
     D · OUT-OF-ORDER EVENTS DO NOT WIPE A PAYING CUSTOMER
     E · a failing card is not an eviction notice, but running out of retries is
     F · somebody mid-upgrade gets the HIGHER plan, never the lower one
     G · checkout wants a real session and a real plan
     H · the service never serves its own source

   The stubs are deliberately hostile: the Stripe stub returns a subscription
   on a price id that is not in the environment, and the events carry stale
   state that contradicts it. Both are what really happens.
*/
import http from 'node:http';
import crypto from 'node:crypto';

const P = (n, f) => ({ n, f });
const out = {}; const bad = [];

/* ══ the stubs ═══════════════════════════════════════════════════════════ */
let SUBS = [];                                  // what Stripe says is true NOW
let CUSTOMERS = { cus_1: { id:'cus_1', metadata:{ uid:'u-1' } } };
let WROTE = [];                                 // every plan write, in order
let NO_ROW = false;                             // the PATCH matches nothing
let WRITE_FAILS = false;                        // Supabase answers 5xx
let SESSIONS = [];                              // the raw body of each checkout session

const stripeStub = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const send = o => { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(o)); };
    if (u.pathname === '/v1/subscriptions') return send({ data: SUBS });
    if (u.pathname === '/v1/customers/search'){
      const m = /uid'\]:'([^']+)/.exec(decodeURIComponent(u.searchParams.get('query') || ''));
      const uid = m ? m[1] : '';
      return send({ data: Object.values(CUSTOMERS).filter(c => c.metadata.uid === uid) });
    }
    if (/^\/v1\/customers\/cus_/.test(u.pathname)) return send(CUSTOMERS[u.pathname.split('/').pop()] || {});
    if (u.pathname === '/v1/customers'){ const id='cus_new';
      CUSTOMERS[id] = { id, metadata:{ uid:/uid%5D=([^&]+)/.exec(b)?.[1] || '' } }; return send(CUSTOMERS[id]); }
    if (u.pathname === '/v1/checkout/sessions'){ SESSIONS.push(b);
      return send({ id:'cs_1', url:'https://checkout.stripe.test/cs_1' }); }
    if (u.pathname === '/v1/billing_portal/sessions') return send({ id:'bps_1', url:'https://portal.stripe.test/bps_1' });
    res.writeHead(404); res.end('{}');
  });
});
const sbStub = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/auth/v1/user'){
      const t = (req.headers.authorization || '').replace('Bearer ','');
      if (t === 'good') { res.writeHead(200, {'content-type':'application/json'});
        return res.end(JSON.stringify({ id:'u-1', email:'e@x.com' })); }
      res.writeHead(401); return res.end('{}');
    }
    if (u.pathname === '/rest/v1/profiles'){
      const who = String(u.searchParams.get('id') || '').replace(/^eq\./, '');
      WROTE.push({ who: u.searchParams.get('id'), body: JSON.parse(b || '{}') });
      /* PostgREST with `Prefer: return=representation` answers 200 and the rows
         it actually changed. NO_ROW makes it answer with none, which is what a
         PATCH against a uid that has no profiles row really does — and which
         `return=minimal` used to render as an indistinguishable 204. */
      if (NO_ROW || who === 'u-missing'){
        res.writeHead(200, {'content-type':'application/json'}); return res.end('[]');
      }
      if (WRITE_FAILS){ res.writeHead(502); return res.end('{}'); }
      res.writeHead(200, {'content-type':'application/json'});
      return res.end(JSON.stringify([{ id: who, ...JSON.parse(b || '{}') }]));
    }
    res.writeHead(404); res.end('{}');
  });
});
const listen = (s) => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const sPort = await listen(stripeStub), bPort = await listen(sbStub);

const sub = (id, status, plan, price, uid='u-1') => ({ id, status, customer:'cus_1',
  metadata: plan === null ? {} : { uid, plan },
  items: { data: [{ price: { id: price } }] } });

/* ══ A · fails closed ════════════════════════════════════════════════════ */
{
  process.env.NI_NO_LISTEN = '1'; process.env.NI_ACCESS_CODE = ''; process.env.SUPABASE_URL = '';
  process.env.STRIPE_SECRET = ''; process.env.STRIPE_WEBHOOK_SECRET = '';
  const { mountBilling } = await import('./billing.js?off');
  const express = (await import('express')).default;
  const app = express(); mountBilling(app);
  const srv = app.listen(0); const port = srv.address().port;
  const j = async (p, o) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, o); return r.status; };
  out.A_checkout = await j('/api/checkout', { method:'POST', headers:{'content-type':'application/json'}, body:'{}' });
  out.A_portal   = await j('/api/portal',   { method:'POST', headers:{'content-type':'application/json'}, body:'{}' });
  out.A_hook     = await j('/api/stripe',   { method:'POST', body:'{}' });
  srv.close();
  if (out.A_checkout !== 503 || out.A_portal !== 503 || out.A_hook !== 503)
    bad.push('A: an unconfigured deploy did not disable billing');
}

/* ══ configure, and bring the real thing up ══════════════════════════════ */
process.env.STRIPE_SECRET = 'sk_test_stub';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_stub';
process.env.STRIPE_API_BASE = `http://127.0.0.1:${sPort}`;
process.env.SUPABASE_URL = `http://127.0.0.1:${bPort}`;
process.env.SUPABASE_SERVICE_KEY = 'service-stub';
process.env.SUPABASE_ANON_KEY = 'anon-stub';
process.env.NI_SITE_URL = 'https://negotiationinc.test';
process.env.STRIPE_PRICE_SOLO = 'price_solo_now';
process.env.STRIPE_PRICE_UNDERWRITER = 'price_uw_now';
process.env.STRIPE_PRICE_OFFICE = 'price_office_now';

const B = await import('./billing.js?on');
const express = (await import('express')).default;
const app = express(); B.mountBilling(app);
const srv = app.listen(0); const port = srv.address().port;
const call = async (p, o = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, o);
  let j = null; try { j = await r.json(); } catch(e){}
  return { s: r.status, j };
};

/* ══ B · the signature ═══════════════════════════════════════════════════ */
{
  const body = Buffer.from(JSON.stringify({ type:'ping' }));
  const sign = (t, secret='whsec_stub') =>
    `t=${t},v1=` + crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const now = Math.floor(Date.now()/1000);
  out.B = {
    good:    B.verify(body, sign(now)),
    forged:  B.verify(body, `t=${now},v1=` + 'a'.repeat(64)),
    stale:   B.verify(body, sign(now - 4000)),
    future:  B.verify(body, sign(now + 4000)),
    tampered:B.verify(Buffer.from(JSON.stringify({ type:'pong' })), sign(now)),
    /* during a rotation Stripe sends the old and the new signature together */
    rotating:B.verify(body, sign(now) + ',v1=' + crypto.createHmac('sha256','other').update(`${now}.${body}`).digest('hex')),
    nosig:   B.verify(body, ''),
  };
  if (!out.B.good || !out.B.rotating) bad.push('B: a valid signature was refused');
  if (out.B.forged || out.B.stale || out.B.future || out.B.tampered || out.B.nosig)
    bad.push('B: an invalid signature was accepted');
  /* and the route itself, end to end, over the raw bytes */
  const t = Math.floor(Date.now()/1000);
  out.B_route_bad  = (await call('/api/stripe', { method:'POST',
    headers:{ 'stripe-signature':`t=${t},v1=${'0'.repeat(64)}`, 'content-type':'application/json' }, body })).s;
  out.B_route_good = (await call('/api/stripe', { method:'POST',
    headers:{ 'stripe-signature':sign(t), 'content-type':'application/json' }, body })).s;
  if (out.B_route_bad !== 400 || out.B_route_good !== 200)
    bad.push('B: the webhook route did not verify over the raw bytes');
}

/* ══ C · THE PRICE LOCK ══════════════════════════════════════════════════
   The founding hundred sit on price_uw_founding, which is not in the
   environment any more because the price went up. Their plan must still be
   underwriter. This is the failure that would arrive months after launch, hit
   only the earliest and most loyal customers, and look like a database
   problem rather than a billing one. */
{
  out.C_grandfathered = B.planOfSub(sub('sub_old','active','underwriter','price_uw_founding'));
  out.C_current       = B.planOfSub(sub('sub_new','active','solo','price_solo_now'));
  /* a subscription made by hand in the dashboard has no metadata — the price
     map is the fallback for exactly that, and only that */
  out.C_dashboard     = B.planOfSub(sub('sub_hand','active',null,'price_office_now'));
  out.C_orphan        = B.planOfSub(sub('sub_orph','active',null,'price_gone'));
  if (out.C_grandfathered !== 'underwriter') bad.push('C: a grandfathered subscriber lost their plan when the price changed');
  if (out.C_current !== 'solo' || out.C_dashboard !== 'the office') bad.push('C: a live subscription did not resolve');
  if (out.C_orphan !== null) bad.push('C: a subscription with no plan and no known price resolved to something');
}

/* ══ E · statuses ════════════════════════════════════════════════════════ */
{
  out.E = {};
  for (const st of ['active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused'])
    out.E[st] = B.planOfSub(sub('s','' + st,'solo','price_solo_now'));
  if (out.E.past_due !== 'solo') bad.push('E: a card that needs updating was treated as a cancellation');
  if (out.E.unpaid !== null || out.E.canceled !== null || out.E.incomplete !== null || out.E.paused !== null)
    bad.push('E: a dead subscription still carried a plan');
  if (out.E.trialing !== 'solo') bad.push('E: a trial did not carry its plan');
}

/* ══ D · OUT OF ORDER ════════════════════════════════════════════════════
   Stripe replays. The event says the subscription was deleted — and it was,
   last month — but this customer subscribed again since. A handler that reads
   the event body cancels a paying customer. */
{
  WROTE = [];
  SUBS = [ sub('sub_old','canceled','underwriter','price_uw_founding'),
           sub('sub_now','active','the office','price_office_now') ];
  await B.reconcile({ type:'customer.subscription.deleted',
    data:{ object:{ id:'sub_old', status:'canceled', customer:'cus_1', metadata:{ uid:'u-1', plan:'underwriter' } } } });
  out.D = WROTE.map(w => w.body.plan);
  if (out.D[0] !== 'the office')
    bad.push('D: a replayed cancellation cleared the plan of a customer who is currently paying');
}

/* ══ F · mid-upgrade ═════════════════════════════════════════════════════
   Proration can leave two live subscriptions for a few seconds. Charging for
   the higher and serving the lower is the one direction of this mistake that
   takes money for nothing. */
{
  WROTE = [];
  SUBS = [ sub('a','active','solo','price_solo_now'), sub('b','active','the office','price_office_now') ];
  await B.reconcile({ type:'customer.subscription.updated', data:{ object:{ id:'a', customer:'cus_1', metadata:{ uid:'u-1' } } } });
  out.F = WROTE.map(w => w.body.plan);
  if (out.F[0] !== 'the office') bad.push('F: somebody holding two subscriptions was given the cheaper one');

  /* and the end of the road: nothing live, plan cleared */
  WROTE = []; SUBS = [ sub('a','canceled','solo','price_solo_now') ];
  await B.reconcile({ type:'customer.subscription.deleted', data:{ object:{ id:'a', customer:'cus_1', metadata:{ uid:'u-1' } } } });
  out.F_end = WROTE.map(w => w.body.plan);
  if (out.F_end[0] !== null) bad.push('F: a fully cancelled customer kept their plan');

  /* the uid is not in the event at all — it comes off the customer record */
  WROTE = []; SUBS = [ sub('a','active','solo','price_solo_now') ];
  await B.reconcile({ type:'invoice.paid', data:{ object:{ customer:'cus_1' } } });
  out.F_uid = WROTE.map(w => w.who);
  if (!/u-1/.test(out.F_uid[0] || '')) bad.push('F: an event without a uid did not find one');

  /* THE ONE COLUMN — every write, in every case above, touched plan alone */
  WROTE = []; SUBS = [ sub('a','active','solo','price_solo_now') ];
  await B.reconcile({ type:'customer.subscription.updated', data:{ object:{ id:'a', customer:'cus_1', metadata:{ uid:'u-1' } } } });
  out.F_fields = Object.keys(WROTE[0].body);
  if (out.F_fields.length !== 1 || out.F_fields[0] !== 'plan')
    bad.push('F: the webhook wrote something other than the plan');
}

/* ══ G · checkout wants a real session and a real plan ═══════════════════ */
{
  const hdr = t => ({ 'content-type':'application/json', authorization:'Bearer ' + t });
  out.G_nosession = (await call('/api/checkout', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({plan:'solo'}) })).s;
  out.G_badtoken  = (await call('/api/checkout', { method:'POST', headers:hdr('forged'), body:JSON.stringify({plan:'solo'}) })).s;
  out.G_badplan   = (await call('/api/checkout', { method:'POST', headers:hdr('good'), body:JSON.stringify({plan:'free'}) })).s;
  out.G_injected  = (await call('/api/checkout', { method:'POST', headers:hdr('good'), body:JSON.stringify({plan:'the office ; drop'}) })).s;
  /* a person who is not subscribed to anything yet — earlier blocks left live
     subscriptions on this customer, and this one is about a first purchase */
  SUBS = [];
  const ok        = (await call('/api/checkout', { method:'POST', headers:hdr('good'), body:JSON.stringify({plan:'underwriter'}) }));
  out.G_ok = { s: ok.s, url: ok.j && ok.j.url };

  /* ── AND NOT A SECOND SUBSCRIPTION ────────────────────────────────────────
     office.html's joinFromQuery() fires startCheckout() straight off
     ?join=underwriter with no plan check, so an existing subscriber following
     that link from a bookmark completed a second checkout against the same
     Stripe customer and was billed twice a month, indefinitely. reconcile()
     takes the higher of the two, so the product looked completely normal. */
  SUBS = [ sub('live','active','underwriter','price_uw_now') ];
  const dbl = (await call('/api/checkout', { method:'POST', headers:hdr('good'), body:JSON.stringify({plan:'the office'}) }));
  out.G_double = { s: dbl.s, portal: dbl.j && dbl.j.portal, err: dbl.j && dbl.j.error };
  if (dbl.s !== 409)
    bad.push(`G: AN EXISTING SUBSCRIBER WAS SOLD A SECOND SUBSCRIPTION (${dbl.s}) — that is two charges a month, forever`);
  if (!(dbl.j && dbl.j.portal))
    bad.push('G: refused the second subscription without pointing at the portal, which is where a plan change belongs');
  if (dbl.j && dbl.j.url)
    bad.push('G: refused it and handed back a checkout URL anyway');
  /* a trial and a past-due card are live subscriptions too */
  for (const st of ['trialing','past_due']){
    SUBS = [ sub('live', st, 'solo','price_solo_now') ];
    const r = await call('/api/checkout', { method:'POST', headers:hdr('good'), body:JSON.stringify({plan:'underwriter'}) });
    if (r.s !== 409) bad.push(`G: a ${st} subscription did not count as one, so it could be doubled`);
  }
  /* a dead one does not block a genuine re-subscribe */
  SUBS = [ sub('gone','canceled','solo','price_solo_now') ];
  const again = await call('/api/checkout', { method:'POST', headers:hdr('good'), body:JSON.stringify({plan:'solo'}) });
  out.G_resub = again.s;
  if (again.s !== 200) bad.push(`G: somebody who cancelled could not come back (${again.s})`);
  SUBS = [];
  const por       = (await call('/api/portal', { method:'POST', headers:hdr('good'), body:'{}' }));
  out.G_portal = { s: por.s, url: por.j && por.j.url };
  if (out.G_nosession !== 401 || out.G_badtoken !== 401) bad.push('G: checkout started without a verified session');
  if (out.G_badplan !== 400 || out.G_injected !== 400)    bad.push('G: checkout accepted a plan that is not on the price list');
  if (out.G_ok.s !== 200 || !out.G_ok.url)                bad.push('G: a signed-in subscriber could not start checkout');
  if (out.G_portal.s !== 200 || !out.G_portal.url)        bad.push('G: cancelling was not two clicks away');
}

/* ══ H · never serves its own source ═════════════════════════════════════ */
{
  process.env.NI_NO_LISTEN = '1';
  const mod = await import('./server.js?pay');
  const s2 = mod.default.listen(0); const p2 = s2.address().port;
  const g = async u => (await fetch(`http://127.0.0.1:${p2}${u}`)).status;
  out.H = { billing: await g('/billing.js'), stripeMd: await g('/STRIPE.md'), health: await g('/api/health') };
  const h = await (await fetch(`http://127.0.0.1:${p2}/api/health`)).json();
  out.H_health = h.billing;
  s2.close();
  if (out.H.billing !== 404 || out.H.stripeMd !== 404) bad.push('H: the service served its own billing source');
  if (!out.H_health || out.H_health.pay !== 'on')      bad.push('H: health does not report the billing state');
}

/* ══ I · A FAILED PLAN WRITE MUST NOT ANSWER 200 ══════════════════════════
   The handler used to reply to Stripe FIRST and reconcile afterwards, on the
   reasoning that work-before-reply gets retried whenever the database is slow.
   reconcile() is idempotent, so a retry costs one read and a duplicate write
   of the same value. What the old order cost is much worse:

   `customer.subscription.deleted` is the LAST event a cancelled customer ever
   generates. Nothing follows it. So a failed plan write there was terminal —
   200 already on the wire, Stripe never redelivers, one log line goes by, and
   that customer keeps The Office free, permanently, with nothing in the system
   left to notice. The subscribe side self-heals because more events follow it.
   The asymmetry was exactly backwards. */
{
  const post = async (ev) => {
    const body = JSON.stringify(ev);
    const t = Math.floor(Date.now()/1000);
    const v1 = crypto.createHmac('sha256', 'whsec_stub').update(`${t}.${body}`).digest('hex');
    return call('/api/stripe', { method:'POST',
      headers:{ 'content-type':'application/json', 'stripe-signature': `t=${t},v1=${v1}` }, body });
  };
  const CANCEL = { type:'customer.subscription.deleted',
    data:{ object:{ id:'a', customer:'cus_1', metadata:{ uid:'u-1' } } } };

  SUBS = [ sub('a','canceled','the office','price_office_now') ];

  WROTE = []; NO_ROW = false; WRITE_FAILS = false;
  out.I_ok = (await post(CANCEL)).s;
  if (out.I_ok !== 200) bad.push(`I: a good cancellation got ${out.I_ok} instead of 200`);
  if (!WROTE.length || WROTE[0].body.plan !== null)
    bad.push('I: a cancellation did not clear the plan');

  WRITE_FAILS = true; WROTE = [];
  out.I_5xx = (await post(CANCEL)).s;
  WRITE_FAILS = false;
  if (out.I_5xx === 200)
    bad.push('I: SUPABASE REFUSED THE WRITE AND STRIPE WAS TOLD 200 — that cancellation is gone forever and the customer keeps the tier');
  if (out.I_5xx !== 500) bad.push(`I: a failed plan write answered ${out.I_5xx}, not 500`);

  /* PATCH matched no rows. `Prefer: return=minimal` rendered this as 204 and
     it was logged as "plan set" — a write that wrote nothing, reported as a
     success, on the event that has no follow-up. */
  NO_ROW = true; WROTE = [];
  out.I_norow = (await post(CANCEL)).s;
  NO_ROW = false;
  if (out.I_norow === 200)
    bad.push('I: a PATCH that matched no rows was reported as a successful plan write');

  /* and an event this service does not care about still answers 200, or
     Stripe retries it for three days for nothing */
  out.I_skip = (await post({ type:'customer.created', data:{ object:{ id:'cus_1' } } })).s;
  if (out.I_skip !== 200) bad.push(`I: an unrelated event got ${out.I_skip} and will be retried for three days`);
}

/* ══ J · THE TRIAL, WHICH NEVER ONCE RAN ══════════════════════════════════
   `Date.parse(String(row.trial) + 'T00:00:00Z')` against a timestamptz column
   produced "…+00:00T00:00:00Z" → NaN → zero days, while the refusal it caused
   read "…and with the fourteen-day trial". It failed closed, so nobody was
   ever charged for it — but three documents describe the column as
   load-bearing, and anybody backfilling it by hand got silence. */
{
  const DAY = 86400000, NOW = Date.parse('2026-08-06T12:00:00Z');
  const L = (v, d) => B.trialLeft(v, NOW, d === undefined ? 14 : d);
  out.J = {
    date:      L('2026-08-01'),
    stampZ:    L('2026-08-01T00:00:00Z'),
    stampOff:  L('2026-08-01T00:00:00.123456+00:00'),   // what PostgREST actually sends
    expired:   L('2026-07-01'),
    fresh:     L('2026-08-06T11:00:00+00:00'),
    future:    L('2026-09-01'),
    junk:      L('not a date'),
    empty:     L(''),
    nul:       L(null),
  };
  if (out.J.stampOff !== 9)
    bad.push(`J: A TIMESTAMPTZ TRIAL READS AS ${out.J.stampOff} DAYS — this is the shape PostgREST returns`);
  if (out.J.date !== 9)    bad.push(`J: a bare date trial reads as ${out.J.date} days, not 9`);
  if (out.J.stampZ !== 9)  bad.push('J: a Z-suffixed timestamp does not agree with a bare date');
  if (out.J.expired !== 0) bad.push('J: an expired trial is still running');
  if (out.J.fresh !== 14)  bad.push(`J: a trial started an hour ago has ${out.J.fresh} days, not 14`);
  if (out.J.future !== 0)  bad.push('J: a trial dated in the future reads as a trial with extra days on it');
  if (out.J.junk !== 0 || out.J.empty !== 0 || out.J.nul !== 0)
    bad.push('J: junk in the trial column granted a trial');
  /* and the length is its own decision, not Stripe's card-first window */
  if (L('2026-08-01', 30) !== 25) bad.push('J: the trial length is not configurable on its own');
}

/* ══ K · A CAP OF ZERO MEANS OFF, NOT UNLIMITED ═══════════════════════════
   Number('') is 0 and Number.isFinite(0) is true, so NI_CAP_AIREAD added to
   Render with the value field left EMPTY read as an explicit cap of zero — and
   the route's guard was `if (cap > 0 && …)`, so zero skipped the check and
   handed every subscriber unlimited reads. An operator switching a feature off
   got the exact opposite, on the one variable that bounds spend. */
{
  const keep = { ...process.env };
  const set = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  out.K = {};
  set('NI_CAP_AIREAD', undefined);
  out.K.default = B.capFor('airead', 2);
  out.K.office  = B.capFor('airead', 3);
  set('NI_CAP_AIREAD', '');
  out.K.blank   = B.capFor('airead', 2);
  set('NI_CAP_AIREAD', '0');
  out.K.zero    = B.capFor('airead', 2);
  set('NI_CAP_AIREAD', '150');
  out.K.set     = B.capFor('airead', 2);
  out.K.setOff  = B.capFor('airead', 3);
  set('NI_CAP_AIREAD', 'nonsense');
  out.K.junk    = B.capFor('airead', 2);
  for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
  Object.assign(process.env, keep);

  if (out.K.blank !== out.K.default)
    bad.push(`K: AN EMPTY ENV VALUE READ AS A CAP OF ${out.K.blank} — a blank field in Render must mean "not set"`);
  if (out.K.zero !== 0)   bad.push('K: a cap of zero was not honoured as zero');
  if (out.K.default !== 100 || out.K.office !== 300) bad.push('K: the defaults moved');
  if (out.K.set !== 150 || out.K.setOff !== 450)     bad.push('K: an override did not carry to The Office');
  if (out.K.junk !== 100) bad.push('K: junk in a cap env var was not ignored');
}

/* ══ L · THE TRIAL PUTS A CARD ON FILE ════════════════════════════════════
   The plans page says "card on file, nothing charged for 14 days". The
   workspace door used to say "No card. Fourteen days of the whole product
   come with it" — the same fortnight, described two incompatible ways, on two
   pages of one site. Somebody registers on the strength of the second and
   finds a free account.

   Two things hold the promise now, and neither is a default:
     · checkout asks Stripe for the card explicitly
     · and the no-card grant column is off unless somebody turns it on */
{
  const hdr = t => ({ 'content-type':'application/json', authorization:'Bearer ' + t });
  SUBS = []; SESSIONS.length = 0;
  await call('/api/checkout', { method:'POST', headers:hdr('good'), body:JSON.stringify({plan:'underwriter'}) });
  /* form-encoded and bracket-nested, so subscription_data[trial_period_days]
     arrives as subscription_data%5Btrial_period_days%5D — decode before asking */
  const sent = decodeURIComponent(SESSIONS[SESSIONS.length - 1] || '');
  out.L_raw = sent.slice(0, 400);
  out.L_checkout = {
    collects: /payment_method_collection=always/.test(sent),
    trialDays: /trial_period_days\]?=(\d+)/.exec(sent)?.[1] || null,
  };
  if (!out.L_checkout.collects)
    bad.push('L: CHECKOUT DOES NOT ASK FOR THE CARD — the fourteen days are sold as "card on file"');
  if (out.L_checkout.trialDays !== '14')
    bad.push(`L: the trial is ${out.L_checkout.trialDays} days at checkout, not 14`);

  /* and the other kind of trial — a grant with no card behind it — must not
     be what a fresh account gets by default */
  const keep = process.env.NI_TRIAL_TIER;
  delete process.env.NI_TRIAL_TIER;
  const B2 = await import('./billing.js?trial=' + Math.random());
  out.L_nocard = { days: B2.trialLeft('2026-08-01', Date.parse('2026-08-06T12:00:00Z')) };
  if (keep !== undefined) process.env.NI_TRIAL_TIER = keep;
  /* the clock still runs — the mechanism is intact for support to use */
  if (out.L_nocard.days !== 9)
    bad.push('L: the no-card trial mechanism was removed rather than switched off');
}

srv.close(); stripeStub.close(); sbStub.close();
console.log(JSON.stringify(out, null, 1));
if (bad.length){ console.log('FAIL'); bad.forEach(x => console.log(' - ' + x)); process.exit(1); }
console.log('PASS — fails closed, refuses a forged webhook, keeps a grandfathered subscriber on their plan when the price changes, survives replayed and out-of-order events, gives a mid-upgrade customer the higher plan, and writes nothing but the plan');
