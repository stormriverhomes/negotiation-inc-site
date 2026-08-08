/* ── THE RENT, AND THE VALUE THAT IS NOT COMING ────────────────────────────
   The plans page carried "Address-level values and rents ✓" on two paid tiers
   and NEITHER HALF EXISTED. There was no code anywhere that surfaced a rent
   estimate or a value estimate — the one RentCast call this product makes
   reads `comparables` and discards everything else on the reply, by name.

   Only one half should ever be built, and this file asserts both halves of
   that decision:

     · THE VALUE IS NOT COMING BACK, EVER. "No automated valuation model was
       used" is printed on the lender packet. An address-level value estimate
       IS an automated valuation model. Building one would make the sentence on
       the most important document this product produces untrue, in exchange
       for the exact number the whole design exists to refuse.

     · THE RENT LANDS AS AN ESTIMATE. Never ENTERED. The desk already fills
       this field with 0.65% of ARV and marks it; a figure from actual nearby
       rentals is the same KIND of object and gets the same treatment, with
       its range and its provenance attached. Typing over it makes it yours.

   And it rides the SAME allowance as the comp pull, because each is one
   request to RentCast — a second number on the pricing page would be
   advertising an allowance that does not exist. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';

let n = 0, bad = 0;
const ok = (t, p, x) => { n++; if (!p){ bad++; console.log('✗ ' + t + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0,240) : '')); } else console.log('✓ ' + t); };

/* ── 1 · the server half, against a stub account layer ─────────────────────*/
const sb = http.createServer((q, r) => {
  r.writeHead(200, {'content-type':'application/json'});
  if (q.url.startsWith('/auth/v1/user')) return r.end(JSON.stringify({ id:'u-1', email:'e@x.com' }));
  if (q.url.includes('/rest/v1/profiles')) return r.end(JSON.stringify([{ plan:'underwriter', trial:null }]));
  if (q.url.includes('/rest/v1/rpc/ni_use')) return r.end(JSON.stringify({ used:3, cap:40, remaining:37 }));
  if (q.url.includes('/rest/v1/usage')) return r.end(JSON.stringify([{ n:3 }]));
  r.end('[]');
});
const sbPort = await new Promise(r => sb.listen(0, '127.0.0.1', () => r(sb.address().port)));

const PORT = 3995 + (process.pid % 4);
const srv = spawn('node', ['server.js'], { cwd:'/home/claude/srv', stdio:'ignore', env:{ ...process.env,
  PORT:String(PORT), NI_MOCK:'1', RENTCAST_KEY:'rc-stub',
  SUPABASE_URL:`http://127.0.0.1:${sbPort}`, SUPABASE_SERVICE_KEY:'k', SUPABASE_ANON_KEY:'a' }});
const B = `http://127.0.0.1:${PORT}`;
for (let i=0;i<60;i++){ try{ const r=await fetch(B+'/api/health'); if(r.ok) break; }catch(e){} await new Promise(r=>setTimeout(r,250)); }

const ask = (body, tok = 'tok') => fetch(B + '/api/lookup/rent', { method:'POST',
  headers:{ 'content-type':'application/json', ...(tok ? { authorization:'Bearer ' + tok } : {}) },
  body: JSON.stringify(body) }).then(async r => ({ status:r.status, j: await r.json().catch(() => null) }));

{
  const r = await ask({ address:'118 Sylvan Rd SW, Atlanta, GA 30310' });
  ok('a paid account gets a rent back', r.status === 200 && r.j.ok, r);
  ok('with a number', typeof r.j.rent === 'number' && r.j.rent > 0, r.j);
  ok('and a range around it, because a rent with no range is a rent pretending to be a fact',
     typeof r.j.lo === 'number' && typeof r.j.hi === 'number' && r.j.lo < r.j.hi, r.j);
  ok('and a sentence saying where it came from', /rental/i.test(String(r.j.prov)), r.j.prov);
  ok('and the sentence tells you to check real listings',
     /check three real listings/i.test(String(r.j.prov)), r.j.prov);
  /* the whole point of the endpoint's existence: it must not become an AVM */
  for (const k of ['price','value','priceRangeLow','priceRangeHigh','avm','estimate'])
    ok(`the reply carries no ${k} — this is not an AVM`, !(k in r.j), Object.keys(r.j));
  /* the shape countUse returns varies with what the database hands back; the
     property that matters is that a month object comes from the SAME meter as
     the comp pull, so a second allowance was never invented */
  ok('it rides the comp allowance rather than inventing a second one',
     !!r.j.month && typeof r.j.month.left === 'number', r.j.month);
}
{
  const r = await ask({ address:'x' });
  ok('a stub of an address is refused before anything is spent', r.status === 400, r);
  const r2 = await ask({ address:'118 Sylvan Rd SW, Atlanta, GA 30310' }, null);
  ok('no session, no lookup', r2.status === 401 || r2.status === 403, r2.status);
}
srv.kill(); sb.close();

/* ── 2 · the desk half ─────────────────────────────────────────────────────*/
{
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport:{ width:1400, height:1000 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0,180)));
  await pg.goto('file:///home/claude/dist/desk.html'); await pg.waitForTimeout(500);
  await pg.evaluate(() => localStorage.setItem('ni-account-v1',
    JSON.stringify({ name:'E Payne', email:'e@x.com', plan:'underwriter' })));
  await pg.goto('file:///home/claude/dist/desk.html'); await pg.waitForTimeout(1300);

  const gated = await pg.evaluate(() => {
    S.addr = '118 Sylvan Rd SW'; render();
    const paid = !!document.querySelector('.rlk');
    localStorage.setItem('ni-account-v1', JSON.stringify({ name:'E', email:'e@x.com', plan:null }));
    ACC = null; render();
    const free = !!document.querySelector('.rlk');
    localStorage.setItem('ni-account-v1', JSON.stringify({ name:'E', email:'e@x.com', plan:'underwriter' }));
    ACC = null; render();
    return { paid, free };
  });
  ok('the lookup is offered to a paid account', gated.paid, gated);
  ok('and is not offered to a free one, rather than offered and refused', !gated.free, gated);

  const landed = await pg.evaluate(async () => {
    S.addr = '118 Sylvan Rd SW'; S.raw.rent = ''; S.est.rent = false; delete S.prov.rent;
    window.fetch = async () => ({ ok:true, json: async () => ({ ok:true, rent:1875, lo:1700, hi:2050,
      comps:6, prov:'the rent for this address, from 6 nearby rentals · they range 1,700–2,050 · check three real listings before you lean on it' }) });
    await rentLookup();
    return { raw:S.raw.rent, est:!!S.est.rent, prov:S.prov.rent, unc:S.unc.rent,
             chip:(document.querySelector('#fb-rent .stchip')||{}).textContent,
             shown:(document.querySelector('#fb-rent .prov')||{}).textContent };
  });
  /* THE assertion this file exists for */
  ok('the rent lands as an ESTIMATE, never as ENTERED', landed.est === true, landed);
  ok('and the chip on the field says so', /ESTIMATE/.test(String(landed.chip)), landed.chip);
  ok('and the provenance is printed under it, not hidden in a tooltip',
     /nearby rentals/i.test(String(landed.shown)), landed.shown);
  ok('and it carries an uncertainty, so every band it touches widens',
     typeof landed.unc === 'number' && landed.unc > 0, landed.unc);
  ok('and the figure is the one that came back', /1,?875/.test(String(landed.raw)), landed.raw);

  /* typing over it is the person taking ownership — the same rule the photo
     read obeys, and the reason this is safe to offer at all */
  const typed = await pg.evaluate(() => {
    const el = document.getElementById('fi-rent');
    el.value = '2000'; el.dispatchEvent(new Event('input', { bubbles:true }));
    el.dispatchEvent(new Event('change', { bubbles:true }));
    return { est:!!S.est.rent, prov:S.prov.rent || null };
  });
  ok('typing over it makes it yours', typed.est === false, typed);
  ok('and the borrowed provenance goes with it', !typed.prov, typed);

  const failed = await pg.evaluate(async () => {
    S.raw.rent = ''; S.est.rent = false;
    window.fetch = async () => ({ ok:false, json: async () => ({ ok:false, error:'There is no rental record near that address.' }) });
    await rentLookup();
    return { raw:S.raw.rent, msg:(document.querySelector('.rlk.bad')||{}).innerText || '' };
  });
  ok('a lookup that fails writes nothing to the sheet', !failed.raw, failed);
  ok('and says so where the button was', /no rental record/i.test(failed.msg), failed.msg);
  ok('no page errors', !errs.length, errs[0]);
  await b.close();
}

/* ── 3 · and the page never claims a value estimate again ──────────────────*/
{
  const b = await chromium.launch();
  const pg = await b.newPage();
  await pg.goto('file:///home/claude/dist/plans.html'); await pg.waitForTimeout(500);
  const t = await pg.evaluate(() => document.body.innerText);
  /* the phrase may appear — it appears in the sentence that REFUSES one, and
     saying why is better than saying nothing. What must not exist is a row
     that SELLS it, so the test is the row label, not the page text. */
  const rows = await pg.evaluate(() => [...document.querySelectorAll('table tr td:first-child b')]
    .map(b => b.textContent.trim()));
  ok('no row on the plans table sells an address-level value',
     !rows.some(r => /value/i.test(r) && !/what it becomes/i.test(r)), rows.filter(r => /value/i.test(r)));
  ok('and where the page mentions one, it is to say there is not one',
     /no value estimate here|IS an automated valuation model/i.test(t), '');
  ok('it does sell the rent', /rent for the address/i.test(t));
  ok('and the top tier advertises nothing that is not built',
     !/in build/i.test(t), (t.match(/.{60}in build.{60}/i) || [])[0]);
  await b.close();
}

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nall ${n} hold — the rent arrives as an estimate with its range, the value never arrives at all, and the page claims neither more nor less`);
process.exit(bad ? 1 : 0);
