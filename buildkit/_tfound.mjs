/* ── THE FOUNDING OFFER IS RETIRED, AND RETIREMENT IS A TESTABLE STATE ─────
   Elijah: "just get rid of the gold founding user thing since it's priced at
   $129 anyways we might as well keep it like a normal pricing page."

   This harness used to prove the offer counted itself, closed itself, and
   refused to sell what it could not count — four properties across two
   hundred lines and a fake Stripe. All of that machinery is still in
   billing.js and still correct; what changed is that nothing may reach it.

   THE RIGHT TEST FOR A REMOVED FEATURE IS NOT NO TEST. A deleted harness is
   indistinguishable from a harness that was never written, and the failure it
   was guarding against did not go away — it inverted. Before, the danger was
   a page that promised $79 while checkout charged $129. Now the danger is the
   same sentence with the roles swapped: a page that says $129 while checkout
   quietly issues $79, because somebody pasted STRIPE_PRICE_FOUNDING into
   Render while wiring the live keys and nothing on the page would show it.

   So this asserts the retirement, and it is a SHORTER test than the offer was,
   which is the honest shape of the change:

     · no shipped page names a founding place, a founding price, or $79
     · /api/founding reports the offer off
     · a checkout for underwriter is issued at the standard price EVEN WHEN
       STRIPE_PRICE_FOUNDING is set — the flag is code, not configuration, and
       this is the assertion that proves it
     · the plans card still sells Underwriter at $129 with the trial */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

let n = 0, bad = 0;
const ok = (t, p, x) => { n++; if (!p){ bad++; console.log('✗ ' + t + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0,240) : '')); } else console.log('✓ ' + t); };

/* ── the built pages say nothing about it ──────────────────────────────────*/
{
  const dir = 'dist';
  const pages = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
  ok('there are pages to check', pages.length > 4, pages.length);
  /* the prose, not the bytes — a comment explaining WHY the offer went is not
     the offer, and the plans page carries a long one on purpose */
  const decomment = s => s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const f of pages){
    const body = decomment(fs.readFileSync(path.join(dir, f), 'utf8'));
    ok(`${f} does not name a founding place`, !/founding (price|place|twenty-five)/i.test(body),
       (body.match(/.{40}founding (price|place|twenty-five).{40}/i) || [])[0]);
    ok(`${f} does not quote $79 a month`, !/\$79 a month/.test(body),
       (body.match(/.{50}\$79 a month.{30}/) || [])[0]);
  }
  const plans = fs.readFileSync(path.join(dir, 'plans.html'), 'utf8');
  ok('the offer card survived as a plain Underwriter card', /class="offercard"/.test(plans));
  ok('and it is not gold any more', !/offercard\{[^}]*var\(--gold\)/.test(plans));
  ok('and it still names the price and the trial',
     /\$129 a month/.test(plans) && /14 days free/i.test(plans));
  ok('the seat-counting script is gone', !/api\/founding/.test(plans));
}

/* ── the server refuses to issue it even when the variable IS set ──────────*/
let TAKEN = 0, made = [];
const FOUND_PRICE = 'price_founding_25';
const stripeStub = http.createServer(async (q, r) => {
  const body = await new Promise(res => { let b = ''; q.on('data', c => b += c); q.on('end', () => res(b)); });
  r.writeHead(200, { 'content-type':'application/json' });
  if (q.url.startsWith('/v1/customers/search')) return r.end(JSON.stringify({ data:[{ id:'cus_1' }] }));
  if (q.url.startsWith('/v1/customers')) return r.end(JSON.stringify({ id:'cus_1' }));
  if (q.url.startsWith('/v1/checkout/sessions')){
    made.push(new URLSearchParams(body));
    return r.end(JSON.stringify({ id:'cs_1', url:'https://checkout.stripe.test/x' }));
  }
  if (q.url.startsWith('/v1/subscriptions')){
    if (q.url.includes('price=' + FOUND_PRICE))
      return r.end(JSON.stringify({ has_more:false,
        data: Array.from({ length: TAKEN }, (_, i) => ({ id:'sub_' + i, status:'active' })) }));
    return r.end(JSON.stringify({ has_more:false, data:[] }));
  }
  r.end('{}');
});
const spPort = await new Promise(r => stripeStub.listen(0, '127.0.0.1', () => r(stripeStub.address().port)));

const sb = http.createServer((q, r) => {
  r.writeHead(200, { 'content-type':'application/json' });
  if (q.url.includes('/auth/v1/user')) return r.end(JSON.stringify({ id:'u1', email:'a@b.c' }));
  if (q.url.includes('profiles')) return r.end(JSON.stringify([{ uid:'u1', plan:null, trial_ends:null }]));
  r.end('[]');
});
const sbPort = await new Promise(r => sb.listen(0, '127.0.0.1', () => r(sb.address().port)));

const PORT = 8931;
const srv = spawn(process.execPath, ['srv/server.js'], {
  env: { ...process.env, PORT: String(PORT), NI_MOCK:'1',
         /* THE VARIABLE IS SET ON PURPOSE. That is the whole point: the offer
            must stay off because the code says so, not because nobody filled
            the field in. */
         STRIPE_PRICE_FOUNDING: FOUND_PRICE,
         /* the rail has to be ON or the checkout route refuses before it ever
            reaches the price map, and the assertion below would pass for the
            wrong reason — a 503 issues no founding price either */
         STRIPE_PRICE_SOLO: 'price_solo', STRIPE_PRICE_UNDERWRITER: 'price_uw',
         STRIPE_PRICE_OFFICE: 'price_office', STRIPE_WEBHOOK_SECRET: 'whsec_x',
         STRIPE_SECRET: 'sk_test_x', STRIPE_API_BASE: `http://127.0.0.1:${spPort}`,
         NI_SUPABASE_URL: `http://127.0.0.1:${sbPort}`, NI_SUPABASE_ANON: 'anon',
         /* billing reads the SERVICE pair, not the browser pair — PAY_ON is
            (secret && url && service key), and without these the route 503s
            before the price map is ever consulted */
         SUPABASE_URL: `http://127.0.0.1:${sbPort}`, SUPABASE_SERVICE_KEY: 'svc',
         /* whoIs() fails closed without the anon key, on purpose — see the
            note in billing.js. Without it every checkout is a 401 and this
            harness would prove nothing about prices. */
         SUPABASE_ANON_KEY: 'anon',
         NI_ALLOW_LOCAL_SB: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let boot = '';
srv.stdout.on('data', d => boot += d); srv.stderr.on('data', d => boot += d);
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 60; i++){
  try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch(e){}
  await new Promise(r => setTimeout(r, 250));
}

{
  const r = await fetch(base + '/api/founding');
  const j = await r.json().catch(() => ({}));
  ok('/api/founding reports the offer off', j && j.on === false, j);
  ok('and does not leak a seat count', j && j.left === undefined && j.taken === undefined, j);
  ok('the boot log says the variable is being ignored',
     /founding offer is retired/i.test(boot), boot.slice(-200));
}

{
  /* the one that matters: a real checkout, with the founding price available
     to the server, must still be created at the standard price */
  made = [];
  const r = await fetch(base + '/api/checkout', {
    method:'POST', headers:{ 'content-type':'application/json', authorization:'Bearer tok' },
    body: JSON.stringify({ plan:'underwriter' }),
  });
  const j = await r.json().catch(() => ({}));
  ok('a checkout is still created', r.ok || j.url || j.ok, { status:r.status, j });
  const prices = made.flatMap(p => [...p.entries()].filter(([k]) => /price/.test(k)).map(([,v]) => v));
  ok('and it is NOT on the founding price', !prices.includes(FOUND_PRICE), prices);
  const meta = made.flatMap(p => [...p.entries()].filter(([k]) => /founding/.test(k)));
  ok('and nothing is stamped as a founding place', meta.length === 0, meta);
}

/* ── and the page a customer actually reads ────────────────────────────────*/
{
  const site = http.createServer((q, r) => {
    const f = path.join('dist', (q.url.split('?')[0] || '/').replace(/^\//, '') || 'index.html');
    try { r.writeHead(200, { 'content-type':'text/html' }); r.end(fs.readFileSync(f)); }
    catch(e){ r.writeHead(404); r.end('no'); }
  });
  const port = await new Promise(r => site.listen(0, '127.0.0.1', () => r(site.address().port)));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pg = await b.newPage({ viewport:{ width:1280, height:900 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0,140)));
  await pg.goto(`http://127.0.0.1:${port}/plans.html`, { waitUntil:'load' });
  await pg.waitForTimeout(600);
  const card = await pg.evaluate(() => {
    const el = document.querySelector('.offercard');
    if (!el) return null;
    const cta = el.querySelector('a.btn, .wl');
    return { k: (el.querySelector('.k')||{}).textContent || '',
             h: (el.querySelector('h3')||{}).textContent || '',
             p: (el.querySelector('p')||{}).textContent || '',
             cta: cta ? cta.textContent.trim() : '',
             gold: getComputedStyle(el).borderColor };
  });
  ok('the card is on the page', !!card, card);
  if (card){
    ok('it is headed Underwriter', /underwriter/i.test(card.k), card.k);
    ok('it names $129', /\$129/.test(card.h + card.p), card.h);
    ok('it does not name $79', !/\$79/.test(card.h + card.p), card.h + card.p);
    ok('it does not count places', !/places|twenty-five|left|taken/i.test(card.k + card.h), card.k);
    ok('it offers the trial rather than a place', !/take a place/i.test(card.cta), card.cta);
  }
  ok('the page throws nothing', !errs.length, errs[0]);
  await b.close(); site.close();
}

srv.kill(); stripeStub.close(); sb.close();
console.log(bad ? `\n${bad} of ${n} FAILED`
  : `\nall ${n} hold — the offer is retired on the page, off at the endpoint, and cannot be `
    + `switched back on by an environment variable`);
process.exit(bad ? 1 : 0);
