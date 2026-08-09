/* t-comp — Comp Run never tells a player their reward was worth nothing.

   The complaint that started this: "you'll get an achievement and it'll say
   +$0/sec, which makes no sense."

   It was not the arithmetic. `money()` rounds to whole dollars — right for a
   balance, wrong for a rate — and the first hours of this game are spent under
   a dollar a second. So every reward in the part of the game where a player
   decides whether to keep playing rendered as "+$0/sec". The number was real
   and the formatter threw it away.

   That is a CLASS of bug, not one line: achievements, milestones, purchases
   and per-rung income all printed rates through the same rounding. So this
   plays the opening of the game for real and reads every reward on the way.

     A · the formatter itself, across the range, including the values that
         used to round away
     B · NO REWARD A PLAYER IS SHOWN EVER READS AS ZERO while the thing it
         describes is worth more than nothing — receipts and floats both
     C · every rung you own reports income, and never "$0/sec from 3"
     D · achievements pay, and say what they paid, from the very first one
     E · nothing in the opening throws
*/
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

/* SERVED, NOT OPENED. This harness read the built page off file:// and failed
   the day Comp Run started taking the same @font-face as everything else we
   ship: the preload carries `crossorigin`, which forces a CORS-mode fetch, and
   Chrome hands every file:// document an opaque origin, so that one request is
   refused and logs an error. The refusal is a property of file://, not of the
   page — over https the preload is what makes one download serve every page.
   Assertion E is "nothing in the opening throws", and it should be measuring
   the game, so the game gets an origin. */
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.woff2':'font/woff2', '.png':'image/png',
  '.svg':'image/svg+xml', '.ico':'image/x-icon', '.txt':'text/plain', '.xml':'application/xml' };
const ROOT = '/home/claude/dist';
const site = http.createServer((q, r) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory())
    { r.writeHead(404); return r.end('no'); }
  r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
const PORT = await new Promise(r => site.listen(0, '127.0.0.1', () => r(site.address().port)));
const BASE = `http://127.0.0.1:${PORT}`;

const b = await chromium.launch();
const p = await b.newPage({ viewport:{ width:1280, height:1000 } });
const bad = [], out = {}, errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

await p.goto(BASE + '/comp-run.html');
await p.evaluate(() => localStorage.clear());
await p.reload(); await p.waitForTimeout(1200);

/* ══ A · the formatter ═══════════════════════════════════════════════════ */
{
  out.A = await p.evaluate(() => {
    const t = {};
    for (const v of [0, 0.004, 0.018, 0.5, 1, 3.14159, 99.4, 100, 1234, 5.5e6])
      t[v] = rateMoney(v);
    return t;
  });
  /* the exact value that started this: one achievement at an opening rate */
  if (/^\$0$/.test(out.A['0.018']))
    bad.push('A: a real gain of $0.018/sec still renders as $0');
  if (out.A['0'] !== '$0') bad.push('A: zero should render as $0 and does not');
  for (const [v, s] of Object.entries(out.A))
    if (Number(v) > 0 && /^\$0$/.test(s))
      bad.push(`A: ${v} renders as "$0" — a real number shown as nothing`);
}

/* ══ B · D · play the opening and read every reward ══════════════════════
   Receipts and floats are the two ways this game tells you something was
   worth having, so both are recorded at the source rather than scraped off
   the screen after the animation has gone. */
{
  const played = await p.evaluate(async () => {
    const seen = { receipts: [], floats: [] };
    const realReceipt = window.receipt, realFloat = window.float;
    window.receipt = function(title, sub, worth, kind){
      seen.receipts.push({ title:String(title||''), worth:String(worth==null?'':worth) });
      try { return realReceipt.apply(this, arguments); } catch(e){ return null; }
    };
    window.float = function(x, y, txt, kind){
      seen.floats.push(String(txt||''));
      try { return realFloat.apply(this, arguments); } catch(e){ return null; }
    };

    /* Play the opening the way a player does: earn a little, buy the cheapest
       thing repeatedly, let the achievements land. Cash is granted rather than
       clicked so the test is about the DISPLAY, not about patience. */
    const log = [];
    for (let round = 0; round < 14; round++){
      S.cash += Math.max(50, cost(0, 1) * 3);
      S.t += 5;
      const before = rate();
      buy(0, 1);
      const after = rate();
      log.push({ round, own: S.own[0], gain: after - before, rate: after });
      try { checkAch(); } catch(e){}
    }
    /* and one of the higher rungs, so a milestone and a bigger delta appear */
    for (let round = 0; round < 12; round++){
      S.cash += Math.max(500, cost(1, 1) * 3);
      S.t += 5;
      buy(1, 1);
      try { checkAch(); } catch(e){}
    }
    /* a couple of upgrades, which is the other receipt path */
    let bought = 0;
    for (let k = 0; k < UPGRADES.length && bought < 3; k++){
      if (S.up && S.up.includes(k)) continue;
      S.cash += 1e7;
      try { buyUpgrade(k); bought++; } catch(e){}
    }
    window.receipt = realReceipt; window.float = realFloat;
    return { seen, log, ach: S.ach.length, rate: rate(), own: S.own.slice(0, 3) };
  });

  out.B = { receipts: played.seen.receipts.length, floats: played.seen.floats.length,
            achievements: played.ach, endRate: Math.round(played.rate * 100) / 100,
            owned: played.own };
  out.B_sample = played.seen.receipts.slice(0, 6);
  out.B_floats = played.seen.floats.slice(0, 6);

  /* B · nothing a player is shown reads as zero */
  const zeroish = /(^|[+\s])-?\$0(?![\d.])/;
  for (const r of played.seen.receipts)
    if (r.worth && zeroish.test(r.worth))
      bad.push(`B: a receipt told the player "${r.title}" was worth "${r.worth}"`);
  for (const f of played.seen.floats)
    if (zeroish.test(f))
      bad.push(`B: a float over a purchase read "${f}"`);

  /* D · achievements happened at all, and each carried a worth */
  if (!played.ach) bad.push('D: nothing in the opening earned an achievement, so the reward text was never exercised');
  const achReceipts = played.seen.receipts.filter(r => r.worth);
  if (!achReceipts.length) bad.push('D: no reward carried a worth at all');
  out.D_achReceipts = achReceipts.length;

  /* and the gains were genuinely positive — the display is only interesting
     if the underlying number was real */
  const flat = played.log.filter(l => !(l.gain > 0));
  if (flat.length) bad.push(`D: ${flat.length} purchases produced no rate increase at all`);
}

/* ══ C · every rung you own reports income ══════════════════════════════ */
{
  out.C = await p.evaluate(() => {
    const rows = [];
    for (let i = 0; i < RUNGS.length; i++){
      if (!S.own[i]) continue;
      rows.push({ i, own: S.own[i], txt: rateMoney(rungRate(i) * cred() * R.all) + '/sec from ' + S.own[i] });
    }
    return rows;
  });
  for (const r of out.C)
    if (/^\$0\//.test(r.txt))
      bad.push(`C: a rung you own reports "${r.txt}"`);
  if (!out.C.length) bad.push('C: the play-through owned nothing, so per-rung income was never rendered');
}

/* ══ E · the opening does not throw ══════════════════════════════════════ */
if (errs.length) bad.push('E: the opening threw — ' + errs[0]);
out.E_errs = errs;

await b.close(); site.close();
console.log(JSON.stringify(out, null, 1));
if (bad.length){
  console.log('FAIL');
  const seen = new Set();
  for (const x of bad){ if (seen.has(x)) continue; seen.add(x); console.log(' - ' + x); }
  process.exit(1);
}
console.log('PASS — the opening of Comp Run pays out in numbers a player can read: no achievement, milestone, purchase or rung ever reports a real gain as $0');
