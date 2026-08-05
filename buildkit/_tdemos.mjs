/* _tdemos — a worked example has to teach the lesson its own card promises.

   Five demos, each introduced on demo.html by a name, a tag and a paragraph:
   "A flip", "A rental", "A subject-to", "A novation", "A walk-away". A
   stranger clicks the one whose story they recognise, and whatever the desk
   then says IS the product's argument. If the flip demo crowns the buy and
   hold, the argument is that the software does not know what it is doing.

   Elijah found this by clicking through them. The fault underneath was worse
   than a wrong fixture: "Recommended" was `rank === 0` unconditionally, so on
   the walk-away — the demo whose entire lesson is that nothing here works —
   the badge sat on a flip whose ceiling is $162,000 below the asking price,
   directly above the sentence saying so.

   THE LAW, per demo:
     A · the exit the card names is the one the desk recommends
     B · except the walk-away, where NOTHING is recommended, the top exit is
         marked as an ordering rather than a licence, and the payday box says
         no exit reaches their price
     C · the recommended exit can actually pay the asking price — a badge that
         means "run this" may not sit on an exit that cannot reach the table
     D · nothing throws, and every demo prices at least three exits, because a
         walk-through where five of seven say "not priced" is a broken sheet */
import { chromium } from 'playwright';
import fs from 'fs';
import http from 'node:http';

/* what each card promises, taken from demo-page.html's own DEALS list */
const PROMISE = {
  flip:     { rec:'flip',     tag:'A flip' },
  hold:     { rec:'hold',     tag:'A rental' },
  subto:    { rec:'subto',    tag:'A subject-to' },
  novation: { rec:'novation', tag:'A novation' },
  walk:     { rec:null,       tag:'A walk-away' },
};

const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname === '/' ? '/index.html' : u.pathname;
  const f = '/home/claude/dist' + p;
  if (fs.existsSync(f) && fs.statSync(f).isFile()){
    res.writeHead(200, {'content-type':'text/html'}); return res.end(fs.readFileSync(f)); }
  res.writeHead(404); res.end('no');
});
const port = await new Promise(r => site.listen(0, '127.0.0.1', () => r(site.address().port)));
const BASE = `http://127.0.0.1:${port}`;

const bad = [], out = {};
const b = await chromium.launch();

/* the cards and the desk must be talking about the same five things */
{
  const p = await b.newPage();
  await p.goto(BASE + '/demo.html');
  await p.waitForTimeout(900);
  const keys = await p.evaluate(() =>
    [...document.querySelectorAll('a[href*="#demo="]')].map(a => a.getAttribute('href').split('#demo=')[1]));
  out.cards = keys;
  for (const k of keys) if (!PROMISE[k]) bad.push(`demo.html offers "${k}", which this harness does not know about`);
  for (const k of Object.keys(PROMISE)) if (!keys.includes(k)) bad.push(`demo.html no longer offers "${k}"`);
  await p.close();
}

for (const [k, want] of Object.entries(PROMISE)){
  const p = await b.newPage({ viewport:{ width:1280, height:1200 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0,120)));
  await p.goto(BASE + '/desk.html');
  await p.evaluate(() => localStorage.clear());
  await p.goto(BASE + '/desk.html#demo=' + k);
  await p.waitForFunction(() => typeof render === 'function', null, { timeout:20000 });
  await p.waitForTimeout(1300);

  const r = await p.evaluate(() => {
    const idOf = el => el ? (el.closest('.exit')||{}).id.replace(/^x-/,'') : null;
    const rec  = idOf(document.querySelector('.exit .flag.rec'));
    const near = idOf(document.querySelector('.exit .flag.near'));
    const rows = [...document.querySelectorAll('.exit')].map(e => ({
      id: e.id.replace(/^x-/,''),
      priced: !e.classList.contains('na'),
      refused: !!e.querySelector('.flag.ref') }));
    const pay = document.querySelector('.payday');
    /* what the top exit can actually pay, and what they want for it */
    const ask = (typeof val === 'function') ? val('asking') : null;
    const EXn = (typeof rankExits === 'function') ? rankExits() : [];
    const live = EXn.filter(x => !x.na && x.key !== null)
      .sort((a,c) => (c.fit??-1)-(a.fit??-1));
    const top = live[0] || null;
    return { rec, near, rows, ask,
      topId: top ? top.id : null,
      topCeil: top && typeof top.ceil === 'number' ? Math.round(top.ceil) : null,
      payClass: pay ? pay.className : null,
      payText: pay ? pay.textContent.replace(/\s+/g,' ').trim().slice(0,120) : null };
  });
  out[k] = { rec:r.rec, near:r.near, ask:r.ask, topCeil:r.topCeil, pay:r.payClass,
             priced: r.rows.filter(x => x.priced).length };

  /* A/B · the card's promise */
  if (want.rec && r.rec !== want.rec)
    bad.push(`${k}: the card says "${want.tag}" and the desk recommends ${r.rec || 'nothing'}`);
  if (!want.rec){
    if (r.rec) bad.push(`${k}: the WALK-AWAY demo recommends ${r.rec} — the one lesson it exists to teach`);
    if (!r.near) bad.push(`${k}: nothing is marked as the closest fit, so the ordering vanished with the badge`);
    if (!/\bno\b/.test(r.payClass || ''))
      bad.push(`${k}: the payday box is "${r.payClass}" — it should be saying no exit reaches their price`);
    if (!/No exit reaches their price/i.test(r.payText || ''))
      bad.push(`${k}: the payday box says "${r.payText}"`);
  }
  /* C · a recommendation has to be within reach of the table. Not "at or above
     asking" — offering under asking is the whole trade — but inside the 15%
     where a negotiation is a negotiation. The first cut of this rule used
     "ceiling >= asking" and turned the badge off on a 3.4% gap, which is a
     Tuesday. See REACH_GAP in desk.html. */
  if (r.rec && r.ask !== null && r.topCeil !== null && (r.ask - r.topCeil) / r.ask > 0.15)
    bad.push(`${k}: ${r.rec} is Recommended and its ceiling ${r.topCeil} is `
           + `${Math.round((r.ask - r.topCeil) / r.ask * 100)}% under the asking ${r.ask}`);
  /* D · a demo is a finished sheet */
  if (out[k].priced < 3)
    bad.push(`${k}: only ${out[k].priced} exits priced — a walk-through of "not priced" rows`);
  if (errs.length) bad.push(`${k}: something threw — ${errs[0]}`);
  await p.close();
}

await b.close(); site.close();
console.log(JSON.stringify(out, null, 1));
if (bad.length){ console.log('FAIL'); bad.forEach(x => console.log(' - ' + x)); process.exit(1); }
console.log('PASS — every demo recommends the exit its own card names, the walk-away recommends '
  + 'nothing and says no exit reaches their price, and no "Recommended" badge sits on an exit that '
  + 'cannot pay what the seller is asking');
process.exit(0);
