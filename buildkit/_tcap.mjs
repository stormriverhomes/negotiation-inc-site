/* _tcap — every page the funnel lands on can take an address.

   For most of this build the plans page held the ONLY form on the site that
   could take one, and it is the page fewest people reach. Somebody who plays
   the arcade, reads a lesson, or reads the whole front page and is not ready
   to open the desk today had no way to be heard from again — which, in the
   months before there is anything to sell, is the entire cost of the traffic.

     A · all four pages paint a form, and each says something that fits the
         page it is standing on rather than the plans page's paragraph
     B · a real address reaches the endpoint, TAGGED WITH WHERE IT CAME FROM,
         so the sources that actually convert are knowable
     C · a dead endpoint is never a silent success — the form says so and
         hands over the mailbox
     D · once you are on the list, every page knows, and none of them ask again
     E · a live build carries no form at all
*/
import http from 'node:http';
import fs from 'fs';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
/* ── ITS OWN dist, NOT THE SHARED ONE ────────────────────────────────────
   This harness rebuilds the site several times with different environments.
   So does _tpay. Run them in the same batch and they overwrite each other's
   dist/ mid-assertion — which is not a flaky test, it is two tests writing to
   one file. publish.mjs already takes OUT; use it, and the harnesses stop
   caring what else is running. */
const OUT = 'dist-tcap-' + process.pid;
const OUT_ABS = '/home/claude/' + OUT;
process.on('exit', () => { try { fs.rmSync(OUT_ABS, {recursive:true, force:true}); } catch(e){} });

const bad = [], out = {};
let GOT = [];                       // what the endpoint received
let UP = true;                      // whether the endpoint is answering

const site = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/list'){
      if (!UP){ res.writeHead(503, {'content-type':'application/json'}); return res.end('{"ok":false}'); }
      GOT.push(JSON.parse(b || '{}'));
      res.writeHead(200, {'content-type':'application/json'}); return res.end('{"ok":true}');
    }
    const p = u.pathname === '/' ? '/index.html' : u.pathname;
    const f = OUT_ABS + p;
    if (fs.existsSync(f) && fs.statSync(f).isFile()){
      res.writeHead(200, {'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html'});
      return res.end(fs.readFileSync(f));
    }
    res.writeHead(404); res.end('no');
  });
});
const port = await new Promise(r => site.listen(0, '127.0.0.1', () => r(site.address().port)));
const BASE = `http://127.0.0.1:${port}`;

execFileSync('node', ['publish.mjs'], { cwd:'/home/claude', stdio:'ignore', env:{ ...process.env, OUT } });
const b0 = await chromium.launch();

const PAGES = [
  { f: 'index.html',  from: 'landing' },
  { f: 'plans.html',  from: 'plans'   },
  { f: 'arcade.html', from: 'arcade'  },
  { f: 'exits.html',  from: 'course'  },
];

/* ══ A · every page paints a form, and the lines are not all the same ═════ */
{
  out.A = {}; const lines = [];
  for (const pg of PAGES){
    const p = await b0.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '/' + pg.f);
    await p.evaluate(() => localStorage.clear());
    await p.reload(); await p.waitForTimeout(600);
    const r = await p.evaluate(() => {
      const box = document.querySelector('.wl');
      return { form: !!(box && box.querySelector('form')),
               head: box ? (box.querySelector('.wt')||{}).textContent : null,
               line: box ? (box.querySelector('.ws')||{}).innerText : null };
    });
    out.A[pg.f] = { form: r.form, head: r.head, line: (r.line||'').slice(0, 60) };
    if (!r.form) bad.push(`A: ${pg.f} has no way to leave an address`);
    if (errs.length) bad.push(`A: ${pg.f} console error — ${errs[0]}`);
    lines.push(r.line || '');
    await p.close();
  }
  /* the arcade and the course must not be reading the plans page's paragraph
     at somebody who has been playing a game or reading a lesson */
  const uniq = new Set(lines.map(l => l.slice(0, 40)));
  out.A_distinct = uniq.size;
  if (uniq.size < 3) bad.push('A: the capture says the same thing everywhere, including where it does not fit');
}

/* ══ B · the address arrives, tagged with where it came from ═════════════ */
{
  GOT = []; UP = true;
  for (const pg of PAGES){
    const p = await b0.newPage();
    await p.goto(BASE + '/' + pg.f);
    await p.evaluate(() => localStorage.clear());
    await p.reload(); await p.waitForTimeout(600);
    await p.evaluate(() => { const f = document.querySelector('.wl form');
      f.querySelector('input').value = 'smoke@example.com';
      f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await p.waitForTimeout(900);
    out['B_' + pg.f] = await p.evaluate(() => {
      const d = document.querySelector('.wl.done');
      return { done: !!d, says: d ? (d.querySelector('.wt')||{}).textContent : null }; });
    if (!out['B_' + pg.f].done) bad.push(`B: ${pg.f} took an address and did not confirm it`);
    await p.close();
  }
  out.B_sources = GOT.map(g => g.from);
  const want = PAGES.map(p => p.from);
  for (const w of want) if (out.B_sources.indexOf(w) < 0)
    bad.push(`B: an address from "${w}" arrived untagged — the source that converts cannot be known`);
  if (GOT.some(g => g.email !== 'smoke@example.com'))
    bad.push('B: the address that arrived is not the address that was typed');
}

/* ══ C · a dead endpoint never reads as success ══════════════════════════ */
{
  UP = false; GOT = [];
  const p = await b0.newPage();
  await p.goto(BASE + '/arcade.html');
  await p.evaluate(() => localStorage.clear());
  await p.reload(); await p.waitForTimeout(600);
  await p.evaluate(() => { const f = document.querySelector('.wl form');
    f.querySelector('input').value = 'smoke@example.com';
    f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await p.waitForTimeout(1200);
  out.C = await p.evaluate(() => ({
    done: !!document.querySelector('.wl.done'),
    note: (document.querySelector('.wl .wn')||{}).textContent,
    remembered: localStorage.getItem('ni-wait-v1'),
    canRetry: !document.querySelector('.wl form button').disabled }));
  if (out.C.done) bad.push('C: a failed signup was shown as a success');
  if (!/support@negotiationinc\.com/.test(out.C.note || ''))
    bad.push('C: a failed signup did not hand over the mailbox');
  if (out.C.remembered) bad.push('C: a failed signup was remembered as sent — they can never try again');
  if (!out.C.canRetry) bad.push('C: a failed signup left no way to try again');
  await p.close();
  UP = true;
}

/* ══ D · one list, every page ════════════════════════════════════════════ */
{
  const p = await b0.newPage();
  await p.goto(BASE + '/plans.html');
  await p.evaluate(() => localStorage.setItem('ni-wait-v1','1'));
  out.D = {};
  for (const pg of PAGES){
    await p.goto(BASE + '/' + pg.f); await p.waitForTimeout(450);
    out.D[pg.f] = await p.evaluate(() => ({
      asksAgain: !!document.querySelector('.wl form'),
      says: (document.querySelector('.wl .wt')||{}).textContent }));
    if (out.D[pg.f].asksAgain)
      bad.push(`D: ${pg.f} asked somebody who is already on the list to join it again`);
  }
  await p.close();
}

/* ══ E · a live build carries none of it ═════════════════════════════════ */
{
  execFileSync('node', ['publish.mjs'], { cwd:'/home/claude', stdio:'ignore',
    env: { ...process.env, OUT, NI_STAGE:'live' } });
  const p = await b0.newPage();
  out.E = {};
  for (const pg of PAGES){
    await p.goto(BASE + '/' + pg.f); await p.waitForTimeout(400);
    out.E[pg.f] = await p.evaluate(() => ({ form: !!document.querySelector('.wl form'),
      soon: /opens soon/i.test(document.body.innerText) }));
    if (out.E[pg.f].form) bad.push(`E: ${pg.f} still carries a waitlist form after launch`);
  }
  await p.close();
  execFileSync('node', ['publish.mjs'], { cwd:'/home/claude', stdio:'ignore', env:{ ...process.env, OUT } });
}

await b0.close(); site.close();
console.log(JSON.stringify(out, null, 1));
if (bad.length){ console.log('FAIL'); bad.forEach(x => console.log(' - ' + x)); process.exit(1); }
console.log('PASS — all four pages the funnel lands on can take an address, each in words that fit the page, tagged with where it came from; a dead endpoint hands over the mailbox instead of lying; and a live build carries none of it');
