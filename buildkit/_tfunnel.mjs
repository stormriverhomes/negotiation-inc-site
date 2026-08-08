/* ══ THE FUNNEL, WALKED AS A STRANGER WALKS IT ═════════════════════════════
   Every page in this product has its own harness. The PATH between them has
   never had one — and a funnel is not a set of pages, it is a sequence, so
   the failures that matter most are the ones that live in the joins: a wall
   that names a plan the pricing page does not sell, a call to action that
   goes somewhere real but useless, a promise made on one page and enforced
   differently on another, a room that is not reachable from anywhere.

   This walks it in a browser, in order, as somebody with no account:

       the landing  →  a demo  →  the desk  →  the wall  →  the account
                                     →  the plans  →  the checkout

   and holds three things at every step: the door exists, the door leads
   somewhere that exists, and what the door SAID is what the next room does. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';

let n = 0, bad = 0;
const ok = (name, pass, x) => { n++; if (!pass){ bad++;
  console.log('✗ ' + name + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0,220) : '')); }
  else console.log('✓ ' + name); };

const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  if (!/\.[a-z0-9]+$/i.test(p)) p += '.html';
  const f = '/home/claude/dist' + p;
  if (fs.existsSync(f) && fs.statSync(f).isFile()){
    res.writeHead(200, {'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html'});
    return res.end(fs.readFileSync(f));
  }
  res.writeHead(404); res.end('no');
});
const port = await new Promise(r => site.listen(0, '127.0.0.1', () => r(site.address().port)));
const BASE = `http://127.0.0.1:${port}`;
const PAGES = fs.readdirSync('/home/claude/dist').filter(f => f.endsWith('.html'));

const b = await chromium.launch();
const errs = [];
const open = async (path, acct) => {
  const p = await b.newPage({ viewport:{ width:1400, height:1000 } });
  p.on('pageerror', e => errs.push(path + ': ' + String(e).slice(0,130)));
  await p.goto(BASE + path);
  if (acct !== undefined){
    await p.evaluate(a => { localStorage.clear();
      if (a) localStorage.setItem('ni-account-v1', JSON.stringify(a)); }, acct);
    await p.goto(BASE + path);
  }
  await p.waitForTimeout(450);
  return p;
};
/* every href a stranger can actually press, resolved against this server */
const links = pg => pg.evaluate(() => [...document.querySelectorAll('a[href]')]
  .filter(a => a.offsetParent !== null || a.closest('header,footer,nav'))
  .map(a => ({ href: a.getAttribute('href'), text: (a.textContent||'').trim().slice(0,60) }))
  .filter(l => l.href && !/^(#|mailto:|https?:|tel:)/.test(l.href)));

/* ── 1 · NOTHING LEADS NOWHERE ──────────────────────────────────────────
   A dead link in a funnel is not a broken page, it is a lost customer, and it
   is the single cheapest thing to check mechanically. */
{
  const dead = [], seen = new Set();
  for (const f of PAGES){
    const pg = await open('/' + f, null);
    for (const l of await links(pg)){
      let target = l.href.split('#')[0].split('?')[0];
      if (!target || seen.has(f + '>' + target)) continue;
      seen.add(f + '>' + target);
      /* "/" and "./" are the root, which is index.html — not a file called
         ".html". The clean-URL middleware resolves extensionless paths too. */
      const t2 = target.replace(/^\.?\//, '') || 'index';
      const file = /\.[a-z0-9]+$/i.test(t2) ? t2 : t2 + '.html';
      if (!fs.existsSync('/home/claude/dist/' + file)) dead.push(f + ' → ' + l.href + ' ("' + l.text + '")');
    }
    await pg.close();
  }
  ok('funnel: every link a stranger can press leads to a page that exists', dead.length === 0, dead);
}

/* ── 2 · THE STRANGER'S PATH HAS NO DEAD END ────────────────────────────
   At each stop, the next stop has to be findable without knowing the URL. */
{
  const landing = await open('/index.html', null);
  const L = (await links(landing)).map(l => l.href);
  ok('path: the landing offers the desk', L.some(h => /desk/.test(h)), L.slice(0,14));
  ok('path: and a way to see it working before signing anything',
     L.some(h => /demo|exits|arcade/.test(h)), L.slice(0,14));
  ok('path: and the prices, without having to hunt', L.some(h => /plans/.test(h)));
  await landing.close();

  /* the desk, as a stranger: it must price, and it must ask for nothing */
  const desk = await open('/desk.html', null);
  const d = await desk.evaluate(() => ({
    tier: window.__tier(),
    canPrice: !!document.querySelector('[data-f="asking"]'),
    paywall: /sign in to continue|create an account to price/i.test(document.body.innerText),
  }));
  ok('path: a stranger can price a house without an account', d.canPrice && d.tier === 0 && !d.paywall, d);
  const dl = (await links(desk)).map(l => l.href);
  ok('path: and the desk knows where the account is', dl.some(h => /office/.test(h)), dl.slice(0,10));
  ok('path: and where the plans are', dl.some(h => /plans/.test(h)));
  await desk.close();

  /* the account page, arrived at from a wall */
  const acct = await open('/office.html?want=comps', null);
  const at = await acct.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
  ok('path: the account page opens on a want and does not 404', at.length > 400);
  ok('path: and says an account costs nothing', /free|no card/i.test(at), at.slice(0,180));
  await acct.close();

  /* ── THE LAST STEP DEPENDS ON THE STAGE, AND THE HARNESS HAS TO KNOW IT ──
     This asserted "the plans page offers a way to buy" and went red — on a
     build that is deliberately pre-launch. A funnel test that does not know
     which funnel it is looking at will either cry wolf before launch or, far
     worse, go quiet about a missing checkout after it. So it reads the stage
     flag the build sets and holds the path that stage is supposed to have. */
  const plans = await open('/plans.html', null);
  const pl = await plans.evaluate(() => ({
    live: window.NI_LIVE === true,
    text: document.body.innerText.replace(/\s+/g,' '),
    buys: [...document.querySelectorAll('button,a')].filter(e =>
      /start|choose|get |subscribe|upgrade|trial/i.test(e.textContent||'')).length,
    waits: [...document.querySelectorAll('button,a')].filter(e =>
      /tell me when|claim a place|waitlist/i.test(e.textContent||'')).length,
    checkout: typeof window.__checkout === 'function',
    prices: /\$\d/.test(document.body.innerText),
  }));
  if (pl.live){
    ok('path/live: the plans page offers a way to actually buy', pl.buys > 0, pl.buys);
    ok('path/live: and the checkout it presses actually exists', pl.checkout === true);
  } else {
    ok('path/waitlist: pre-launch, the plans page collects the address instead',
       pl.waits > 0, { waits: pl.waits, buys: pl.buys });
    ok('path/waitlist: and does NOT offer a purchase it cannot complete',
       pl.buys === 0, pl.buys);
    ok('path/waitlist: while still showing what it will cost — the prices are the pitch',
       pl.prices, pl.text.slice(0,120));
  }
  await plans.close();
}

/* ── 3 · A WALL MAY NOT NAME A PLAN THE PRICING PAGE DOES NOT SELL ──────
   This is the join that rots quietly: a tier gets renamed on one page and the
   locked cards elsewhere go on naming the old one. */
{
  const plans = await open('/plans.html', null);
  const sold = await plans.evaluate(() => document.body.innerText.toLowerCase());
  await plans.close();
  const named = new Set();
  for (const f of ['desk.html','land.html','office.html']){
    const pg = await open('/' + f, null);
    const t = await pg.evaluate(() => document.body.innerText);
    for (const m of t.matchAll(/\b(Solo|Underwriter|The Office)\b/g)) named.add(m[1]);
    await pg.close();
  }
  const missing = [...named].filter(x => !sold.includes(x.toLowerCase()));
  ok('walls: every plan a locked card names is a plan the pricing page sells',
     missing.length === 0, { named:[...named], missing });
}

/* ── 4 · ONE PROMISE, ONE NUMBER ────────────────────────────────────────
   The pricing page sells "three in this browser, twelve a week with a free
   account". Both rooms with a comp bench have to mean the same thing by it —
   this is the exact promise the Land Desk was contradicting by handing a
   stranger eight scored sold lots while the house sheet said three. */
{
  const plans = await open('/plans.html', null);
  const t = await plans.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
  await plans.close();
  const m = t.match(/(\w+)\s+in this browser,\s+(\w+)\s+a week/i);
  ok('promise: the pricing page still states the comp allowance', !!m, t.slice(0,120));
  if (m){
    const words = { one:1, two:2, three:3, four:4, five:5, six:6, twelve:12, twenty:20 };
    const inBrowser = words[m[1].toLowerCase()] ?? +m[1];
    const perWeek   = words[m[2].toLowerCase()] ?? +m[2];
    const desk = await open('/desk.html', null);
    const dRoom = await desk.evaluate(() => compRoom().room);
    await desk.close();
    const land = await open('/land.html', null);
    const lRoom = await land.evaluate(() => lotRoom().room);
    await land.close();
    ok('promise: the house bench gives a stranger exactly what was promised',
       dRoom === inBrowser, { dRoom, promised: inBrowser });
    ok('promise: and so does the land bench — one number across the product',
       lRoom === inBrowser, { lRoom, promised: inBrowser });
    ok('promise: the weekly figure is a real number the copy can stand behind',
       perWeek > inBrowser, { perWeek, inBrowser });
  }
}

/* ── 5 · THE ROOMS ARE REACHABLE ────────────────────────────────────────
   The Land Desk was built, tested, deployed — and for a while the only way in
   was the desk's land refusal. A room nobody can find is a room nobody paid
   for. */
{
  const reach = {};
  for (const f of PAGES){
    const pg = await open('/' + f, null);
    for (const l of await links(pg)) {
      const to = l.href.split('#')[0].split('?')[0].replace(/\.html$/,'') || 'index';
      (reach[to] ||= new Set()).add(f);
    }
    await pg.close();
  }
  for (const room of ['land','desk','plans','arcade','exits','office'])
    ok('reach: ' + room + ' is reachable from somewhere', (reach[room] || new Set()).size > 0,
       [...(reach[room] || [])]);
}

ok('funnel: no page threw while being walked', errs.length === 0, [...new Set(errs)]);

await b.close(); site.close();
console.log('\n' + (bad ? '✗ ' + bad + ' of ' + n + ' failed'
  : '✓ all ' + n + ' hold — the stranger can get from the front door to the checkout, '
    + 'and every room says the same thing about what it costs'));
process.exit(bad ? 1 : 0);
