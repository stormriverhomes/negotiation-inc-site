/* ── THE CANCELLATION YOU CAUSED ───────────────────────────────────────────
   Stripe retries a declined card for about two weeks and then cancels. Through
   all of it the customer keeps the product — `past_due` is in LIVE_STATUS on
   purpose — and NOBODY TELLS THEM. Then one morning it cancels, they drop to
   free, and from where they are sitting the product broke.

   Two rules, and the second is the one that keeps the first useful:
     · every state that means "your money is not arriving" is said out loud,
       with what happens next and by when
     · every state that is FINE says nothing at all. A green "your card is
       working" badge on every visit is noise, and noise is what teaches
       somebody to skip the one visit that mattered. */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

let n = 0, bad = 0;
const ok = (t, p, x) => { n++; if (!p){ bad++; console.log('✗ ' + t + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0,240) : '')); } else console.log('✓ ' + t); };

let SUBS = [];                       // what "Stripe" currently says
const stripeStub = http.createServer((q, r) => {
  r.writeHead(200, { 'content-type':'application/json' });
  /* customerOf() finds the customer by SEARCHING Stripe for the uid in
     metadata — the uid → customer mapping lives at Stripe, not in our
     database, which is why the profile stub below does not carry it */
  if (q.url.startsWith('/v1/customers/search')) return r.end(JSON.stringify({ data:[{ id:'cus_1' }] }));
  if (q.url.startsWith('/v1/subscriptions')) return r.end(JSON.stringify({ data: SUBS }));
  r.end('{}');
});
const spPort = await new Promise(r => stripeStub.listen(0, '127.0.0.1', () => r(stripeStub.address().port)));

const sbStub = http.createServer((q, r) => {
  if (q.url.startsWith('/auth/v1/user')){
    r.writeHead(200, {'content-type':'application/json'});
    return r.end(JSON.stringify({ id:'u-1', email:'e@x.com' }));
  }
  r.writeHead(200, {'content-type':'application/json'});
  /* the profile carries the stripe customer id, which is how the route finds
     the caller's own subscription without ever trusting the request for it */
  r.end(JSON.stringify([{ plan:'underwriter', trial:null, stripe_customer:'cus_1', id:'u-1' }]));
});
const sbPort = await new Promise(r => sbStub.listen(0, '127.0.0.1', () => r(sbStub.address().port)));

const PORT = 3980 + (process.pid % 15);
const srv = spawn('node', ['server.js'], { cwd:'/home/claude/srv', stdio:'ignore', env:{ ...process.env,
  PORT:String(PORT), NI_MOCK:'1',
  SUPABASE_URL:`http://127.0.0.1:${sbPort}`, SUPABASE_SERVICE_KEY:'k', SUPABASE_ANON_KEY:'a',
  STRIPE_SECRET:'sk_test_stub', STRIPE_API_BASE:`http://127.0.0.1:${spPort}`,
  STRIPE_PRICE_UNDERWRITER:'price_uw' }});
const B = `http://127.0.0.1:${PORT}`;
for (let i=0;i<60;i++){ try{ const r=await fetch(B+'/api/health'); if(r.ok) break; }catch(e){} await new Promise(r=>setTimeout(r,250)); }

const state = () => fetch(B + '/api/billing/state', { headers:{ authorization:'Bearer tok' } })
  .then(r => r.json()).catch(e => ({ err:String(e) }));

const now = Math.floor(Date.now()/1000) + 86400*20;
for (const [label, subs, expect] of [
  ['a healthy card',   [{ status:'active',   current_period_end:now }],            'active'],
  ['a declined card',  [{ status:'past_due', current_period_end:now }],            'past_due'],
  ['an unpaid one',    [{ status:'unpaid',   current_period_end:now }],            'unpaid'],
  ['a trial',          [{ status:'trialing', current_period_end:now }],            'trialing'],
  ['already cancelled',[{ status:'canceled' }],                                     'canceled'],
  ['never subscribed', [],                                                          'none'],
]){
  SUBS = subs;
  const d = await state();
  ok(`${label} reports "${expect}"`, d && d.state === expect, d);
}
/* one healthy and one failing is still a problem, and the worst one is the
   answer — a customer who upgraded mid-month can hold both */
{
  SUBS = [{ status:'active', current_period_end:now }, { status:'past_due', current_period_end:now }];
  const d = await state();
  ok('one healthy and one failing subscription reports the failing one', d.state === 'past_due', d);
}
{
  SUBS = [{ status:'active', current_period_end:now, cancel_at_period_end:true }];
  const d = await state();
  ok('a subscription set to end names the date it ends', d.cancelsAtPeriodEnd === true && !!d.periodEnd, d);
}
/* Stripe being unreachable is not "your card failed" — telling somebody whose
   card is fine that it is not is worse than saying nothing */
{
  stripeStub.close();
  const d = await state();
  ok('Stripe being unreachable never reads as a declined card',
     d.state === 'unknown' || d.state === 'none', d);
}
srv.kill(); sbStub.close();

/* ── and the panel: loud when it matters, silent when it does not ─────────*/
{
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport:{ width:1200, height:1000 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0,160)));
  await pg.goto('file:///home/claude/dist/office.html'); await pg.waitForTimeout(900);
  const paint = (st) => pg.evaluate(async s => {
    document.body.insertAdjacentHTML('beforeend', '<div id="ac-billstate"></div>');
    window.fetch = async () => ({ json: async () => ({ ok:true, ...s }) });
    await billingBanner();
    const el = document.getElementById('ac-billstate');
    const out = { html: el.innerHTML, text: el.innerText || '' };
    el.remove();
    return out;
  }, st);
  const past = await paint({ state:'past_due' });
  ok('a declined card is said out loud', /did not go through/i.test(past.text), past.text);
  ok('and it says what happens next', /cancel/i.test(past.text), past.text);
  ok('and how to fix it', /card/i.test(past.text), past.text);
  ok('and it is the one thing here allowed to be red', /ac-bs bad/.test(past.html), past.html.slice(0,120));

  const good = await paint({ state:'active' });
  ok('a working card says nothing at all', good.html.trim() === '', good.html);
  const trial = await paint({ state:'trialing' });
  ok('a trial says nothing at all', trial.html.trim() === '', trial.html);

  const ending = await paint({ state:'active', cancelsAtPeriodEnd:true, periodEnd:'2026-09-01' });
  ok('a subscription set to end names its date', /2026-09-01/.test(ending.text), ending.text);
  ok('and does not use the colour of a failure', !/ac-bs bad/.test(ending.html), ending.html.slice(0,120));

  const unknown = await paint({ state:'unknown' });
  ok('an unknown state alarms nobody', unknown.html.trim() === '', unknown.html);
  ok('no page errors', !errs.length, errs[0]);
  await b.close();
}

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nall ${n} hold — a failing card is named before Stripe cancels it, and a working one stays quiet`);
process.exit(bad ? 1 : 0);
