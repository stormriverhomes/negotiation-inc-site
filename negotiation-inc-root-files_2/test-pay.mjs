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
    if (u.pathname === '/v1/checkout/sessions') return send({ id:'cs_1', url:'https://checkout.stripe.test/cs_1' });
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
      WROTE.push({ who: u.searchParams.get('id'), body: JSON.parse(b || '{}') });
      res.writeHead(204); return res.end();
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
  const ok        = (await call('/api/checkout', { method:'POST', headers:hdr('good'), body:JSON.stringify({plan:'underwriter'}) }));
  out.G_ok = { s: ok.s, url: ok.j && ok.j.url };
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

srv.close(); stripeStub.close(); sbStub.close();
console.log(JSON.stringify(out, null, 1));
if (bad.length){ console.log('FAIL'); bad.forEach(x => console.log(' - ' + x)); process.exit(1); }
console.log('PASS — fails closed, refuses a forged webhook, keeps a grandfathered subscriber on their plan when the price changes, survives replayed and out-of-order events, gives a mid-upgrade customer the higher plan, and writes nothing but the plan');
