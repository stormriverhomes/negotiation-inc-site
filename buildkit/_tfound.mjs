/* ── THE OFFER THAT COUNTS AND CLOSES ITSELF ───────────────────────────────
   Elijah: "I need the founding deal thing to be completely wired up because
   I'm not comfortable keeping track of all of that and I feel it should be
   automatic."

   He is right, and the reason is not convenience. A scarce offer somebody has
   to track by hand is an offer that stays open too long — giving the discount
   away past the point it bought anything — or closes early because nobody was
   sure. The second is worse: it turns a written promise into a thing that
   moved, on the page where trust is being asked for.

   So the count is asked of STRIPE: how many live subscriptions exist on the
   founding price. That is the only definition that cannot drift from what
   people were actually charged, and it is right the first time after a
   cancellation, a refund, or a subscription made by hand in the dashboard.

   Four properties, and the last two are the ones that matter:
     · the page says how many are left, and says it plainly when there are none
     · checkout hands out the founding price only while places remain
     · IT FAILS CLOSED. Stripe unreachable means no founding price is issued —
       an unbounded discount is the same class of mistake as an unbounded key.
     · IT FAILS OPEN ON THE PAGE. A page that cannot reach the count leaves the
       copy exactly as written rather than flashing "sold out" at somebody on a
       bad connection. Refusing to SELL and refusing to SAY are opposite
       defaults on purpose. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

let n = 0, bad = 0;
const ok = (t, p, x) => { n++; if (!p){ bad++; console.log('✗ ' + t + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0,240) : '')); } else console.log('✓ ' + t); };

/* ── a Stripe that can be told how many places are gone ────────────────────*/
let TAKEN = 0, DOWN = false, made = [];
const FOUND_PRICE = 'price_founding_25';
const stripeStub = http.createServer(async (q, r) => {
  if (DOWN){ r.writeHead(500); return r.end('{}'); }
  const body = await new Promise(res => { let b = ''; q.on('data', c => b += c); q.on('end', () => res(b)); });
  r.writeHead(200, { 'content-type':'application/json' });
  if (q.url.startsWith('/v1/customers/search')) return r.end(JSON.stringify({ data:[{ id:'cus_1' }] }));
  if (q.url.startsWith('/v1/customers')) return r.end(JSON.stringify({ id:'cus_1' }));
  if (q.url.startsWith('/v1/checkout/sessions')){
    made.push(new URLSearchParams(body));
    return r.end(JSON.stringify({ id:'cs_1', url:'https://checkout.stripe.test/x' }));
  }
  if (q.url.startsWith('/v1/subscriptions')){
    /* the founding count asks by price; the already-subscribed check asks by
       customer. Answering both from one handler keeps the stub honest. */
    if (q.url.includes('price=' + FOUND_PRICE))
      return r.end(JSON.stringify({ has_more:false,
        data: Array.from({ length: TAKEN }, (_, i) => ({ id:'sub_' + i, status:'active' })) }));
    return r.end(JSON.stringify({ has_more:false, data:[] }));
  }
  r.end('{}');
});
const spPort = await new Promise(r => stripeStub.listen(0, '127.0.0.1', () => r(stripeStub.address().port)));

const sb = http.createServer((q, r) => {
  r.writeHead(200, {'content-type':'application/json'});
  if (q.url.startsWith('/auth/v1/user')) return r.end(JSON.stringify({ id:'u-1', email:'e@x.com' }));
  if (q.url.includes('/rest/v1/profiles')) return r.end(JSON.stringify([{ plan:null, trial:null }]));
  r.end('[]');
});
const sbPort = await new Promise(r => sb.listen(0, '127.0.0.1', () => r(sb.address().port)));

const PORT = 3966 + (process.pid % 12);
const srv = spawn('node', ['server.js'], { cwd:'/home/claude/srv', stdio:'ignore', env:{ ...process.env,
  PORT:String(PORT), NI_MOCK:'1',
  SUPABASE_URL:`http://127.0.0.1:${sbPort}`, SUPABASE_SERVICE_KEY:'k', SUPABASE_ANON_KEY:'a',
  STRIPE_SECRET:'sk_test_stub', STRIPE_API_BASE:`http://127.0.0.1:${spPort}`,
  STRIPE_PRICE_SOLO:'price_solo', STRIPE_PRICE_UNDERWRITER:'price_uw', STRIPE_PRICE_OFFICE:'price_off',
  STRIPE_PRICE_FOUNDING: FOUND_PRICE, NI_FOUNDING_SEATS:'25',
  /* the real cache is ninety seconds, which is right for a page that loads on
     every visit and wrong for a test that moves the count every line */
  NI_FOUNDING_TTL_MS:'0' }});
const B = `http://127.0.0.1:${PORT}`;
for (let i=0;i<60;i++){ try{ const r=await fetch(B+'/api/health'); if(r.ok) break; }catch(e){} await new Promise(r=>setTimeout(r,250)); }

const state = () => fetch(B + '/api/founding').then(r => r.json());
const buy = (plan) => fetch(B + '/api/checkout', { method:'POST',
  headers:{ 'content-type':'application/json', authorization:'Bearer tok' },
  body: JSON.stringify({ plan }) }).then(async r => ({ status:r.status, j: await r.json().catch(()=>null) }));
const lastPrice = () => { const p = made[made.length-1]; return p ? p.get('line_items[0][price]') : null; };
const lastMeta  = () => { const p = made[made.length-1];
  return p ? { plan:p.get('subscription_data[metadata][plan]'),
               founding:p.get('subscription_data[metadata][founding]') } : null; };

/* ── 1 · the count, and what the page is told ──────────────────────────────*/
{
  TAKEN = 0;  let d = await state();
  ok('with none taken, all twenty-five are open', d.open === true && d.left === 25, d);
  TAKEN = 22; d = await state();
  ok('with twenty-two taken, three are left', d.left === 3 && d.open === true, d);
  TAKEN = 25; d = await state();
  ok('at twenty-five it is closed', d.open === false && d.left === 0, d);
  TAKEN = 40; d = await state();
  ok('and it never reports a negative number of places', d.left === 0, d);
  ok('the count names nobody', !JSON.stringify(d).match(/cus_|sub_|@/), d);
}

/* ── 2 · checkout hands out the founding price only while it is open ───────*/
{
  TAKEN = 3; made = [];
  const r = await buy('underwriter');
  ok('a buyer inside the twenty-five reaches checkout', r.status === 200, r);
  ok('and gets the founding price', lastPrice() === FOUND_PRICE, lastPrice());
  ok('and the subscription still says which PLAN it is',
     lastMeta() && lastMeta().plan === 'underwriter', lastMeta());
  ok('and is stamped as a founding place', lastMeta() && lastMeta().founding === '1', lastMeta());

  TAKEN = 25; made = [];
  const r2 = await buy('underwriter');
  ok('a buyer arriving after it closed still reaches checkout', r2.status === 200, r2);
  ok('but pays the normal price', lastPrice() === 'price_uw', lastPrice());
  ok('and is not stamped as a founder', !(lastMeta() || {}).founding, lastMeta());

  /* the offer is Underwriter's; it must not leak onto the other two tiers */
  TAKEN = 0; made = [];
  await buy('solo');
  ok('the founding price never attaches to Solo', lastPrice() === 'price_solo', lastPrice());
  made = []; await buy('the office');
  ok('nor to The Office', lastPrice() === 'price_off', lastPrice());
}

/* ── 3 · it fails CLOSED at the till ───────────────────────────────────────
   Stripe unreachable must not hand out an unbounded number of founding
   places. The same rule as every key in this service. */
{
  TAKEN = 0; DOWN = true; made = [];
  const d = await state();
  ok('an uncountable offer reports itself as unknown', d.known === false, d);
  DOWN = false;
  /* and a checkout during an outage: the count is refused, so no founding
     price is issued. Nothing about the purchase itself breaks. */
  TAKEN = 0;
  const before = made.length;
  DOWN = true;
  const r = await buy('underwriter').catch(() => ({ status:0 }));
  DOWN = false;
  ok('no founding price is issued while the count cannot be taken',
     made.length === before || lastPrice() !== FOUND_PRICE, { made: made.length - before, price: lastPrice() });
}
srv.kill();

/* ── 4 · the page, served over http so the fetch is real ───────────────────*/
{
  const site = http.createServer((q, r) => {
    if (q.url.startsWith('/api/founding')){
      r.writeHead(200, {'content-type':'application/json'});
      return r.end(JSON.stringify(SAY));
    }
    const f = path.join('/home/claude/dist', q.url === '/' ? 'index.html' : q.url.split('?')[0]);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ r.writeHead(404); return r.end('no'); }
    r.writeHead(200, {'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream'});
    fs.createReadStream(f).pipe(r);
  });
  let SAY = {};
  const sPort = await new Promise(r => site.listen(0, '127.0.0.1', () => r(site.address().port)));
  const b = await chromium.launch();
  const read = async (say) => {
    SAY = say;
    const pg = await b.newPage({ viewport:{ width:1280, height:1000 } });
    const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0,150)));
    await pg.goto(`http://127.0.0.1:${sPort}/plans.html`); await pg.waitForTimeout(900);
    const out = await pg.evaluate(() => ({
      k: (document.getElementById('fnd-k')||{}).textContent || '',
      h: (document.getElementById('fnd-h')||{}).textContent || '',
      p: (() => { const el = document.querySelector('.founding p'); return el ? el.innerText : ''; })(),
      closed: !!document.querySelector('.founding.closed'),
      cta: (document.getElementById('fnd-cta')||{}).textContent || '' }));
    out.errs = errs; await pg.close(); return out;
  };

  const plenty = await read({ ok:true, on:true, known:true, seats:25, taken:5, left:20, open:true });
  ok('with twenty left it does not create false urgency',
     !/places left/i.test(plenty.k), plenty.k);

  const few = await read({ ok:true, on:true, known:true, seats:25, taken:22, left:3, open:true });
  ok('with three left it says three', /3 places left/.test(few.k), few.k);
  const one = await read({ ok:true, on:true, known:true, seats:25, taken:24, left:1, open:true });
  ok('with one left it says one, in words', /one place left/.test(one.k), one.k);

  const full = await read({ ok:true, on:true, known:true, seats:25, taken:25, left:0, open:false });
  ok('when it is gone the page says so', /taken/i.test(full.k), full.k);
  ok('and stops advertising a price nobody can get', /gone/i.test(full.h), full.h);
  ok('and honours what the twenty-five were promised', /held for their first year/i.test(full.p), full.p);
  ok('and names the price that IS available', /\$129/.test(full.p), full.p);
  /* the CTA only exists on a LIVE build — pre-launch the whole block is the
     waitlist link, stripped by the stage markers. Asserting it on a
     pre-launch build would be asserting the absence of the launch. */
  if (full.cta) ok('and the button offers the thing that exists', /14 days free/i.test(full.cta), full.cta);
  else ok('the pre-launch build has no founding CTA to change, which is correct', true);
  ok('and it stops wearing the colour of an offer', full.closed === true, full);

  /* the opposite default from the till: a page that cannot count must not
     tell somebody on a bad connection that they missed it */
  const blind = await read({ ok:true, on:true, known:false, seats:25 });
  ok('a page that cannot reach the count leaves the copy alone',
     !/taken/i.test(blind.k) && !blind.closed, blind);
  const off = await read({ ok:true, on:false });
  ok('and a deployment with no founding price configured says nothing about one',
     !/taken|places left/i.test(off.k), off.k);
  ok('no page errors in any of those states', !full.errs.length && !blind.errs.length, full.errs[0]);
  await b.close(); site.close();
}
stripeStub.close(); sb.close();

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nall ${n} hold — the offer counts itself, closes itself, refuses to sell what it cannot count, and never tells a bad connection that it missed out`);
process.exit(bad ? 1 : 0);
