/* _tcomps — the comp ladder, which is now the reason a free account exists.

   Three rungs, and the whole point is that each one is visibly different from
   the one below it. The fault this replaces was subtle and expensive: a signed
   -out visitor and a signed-in free account hit the SAME three-comp wall and
   were shown the SAME sentence, so making an account appeared to buy nothing
   on the one screen where the product is most impressive.

     A · signed out — three, in this browser, and the wall points at the
         account rather than at a price list
     B · a free account with the server's allowance — twelve, and the button
         counts down in weeks rather than in comps
     C · a free account on a deployment where the SQL has NOT been run — the
         allowance call fails and the desk falls back to three. A missing
         migration must never lock somebody out of what worked yesterday.
     D · Solo and up — no weekly wall at all, and no call to the meter
     E · the meter is spent when a comp is ADDED and never on a render, an
         edit or a re-score. A counter that ticks while you look at the screen
         is one people learn to resent.
     F · the three controls that know about the limit — the button, the cap
         note and addComp() itself — cannot disagree, because they all ask the
         same function */
import { chromium } from 'playwright';
import fs from 'fs';
import http from 'node:http';

const bad = [], out = {};
const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname === '/' ? '/index.html' : u.pathname;
  const f = '/home/claude/dist' + p;
  if (fs.existsSync(f) && fs.statSync(f).isFile()){
    res.writeHead(200, {'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html'});
    return res.end(fs.readFileSync(f)); }
  res.writeHead(404); res.end('no');
});
const port = await new Promise(r => site.listen(0, '127.0.0.1', () => r(site.address().port)));
const BASE = `http://127.0.0.1:${port}`;

const b = await chromium.launch();
const errs = [];

/* `allow` is what the (stubbed) server says the week's balance is; null means
   the function is not in the database, which is the pre-migration deploy */
async function open(acct, allow){
  const p = await b.newPage({ viewport:{ width:1280, height:1100 } });
  p.on('pageerror', e => errs.push(String(e).slice(0,140)));
  await p.goto(BASE + '/desk.html');
  await p.evaluate(a => { localStorage.clear();
    if (a) localStorage.setItem('ni-account-v1', JSON.stringify(a)); }, acct || null);
  await p.goto(BASE + '/desk.html');
  await p.waitForFunction(() => typeof render === 'function' && typeof compRoom === 'function',
    null, { timeout:20000 });
  /* stand in for _auth.js, which is inert without a Supabase URL */
  await p.evaluate(a => {
    window.__COMPCALLS = [];
    window.__Q = a ? { used:0, cap:a.cap, remaining:a.remaining } : null;
    window.__compAllowance = () => window.__Q;
    window.__compUse = async n => { window.__COMPCALLS.push(n);
      if (!window.__Q) return null;
      window.__Q = { used: window.__Q.used + n, cap: window.__Q.cap,
                     remaining: Math.max(0, window.__Q.remaining - n) };
      return window.__Q; };
  }, allow || null);
  await p.evaluate(() => { S.comps = []; S.compOpen = true; save(); showStep('property'); render(); });
  await p.waitForTimeout(300);
  return p;
}
const look = p => p.evaluate(() => {
  const R = compRoom();
  const btn = document.getElementById('cw-add');
  const note = document.querySelector('.capnote');
  return { room:R.room, rung:R.rung, comps:S.comps.length,
    button: btn ? btn.textContent.replace(/\s+/g,' ').trim() : null,
    note: note ? note.textContent.replace(/\s+/g,' ').trim() : null,
    noteHref: note && note.querySelector('a') ? note.querySelector('a').getAttribute('href') : null,
    calls: (window.__COMPCALLS || []).slice() };
});
const addUntilStuck = p => p.evaluate(() => {
  let n = 0;
  for (let i = 0; i < 40; i++){ const before = S.comps.length; addComp();
    if (S.comps.length === before) break; n++; }
  return { added:n, total:S.comps.length };
});

/* ── A · signed out ───────────────────────────────────────────────────────── */
{
  const p = await open(null, null);
  out.A_start = await look(p);
  out.A_add = await addUntilStuck(p);
  await p.waitForTimeout(200);
  out.A_end = await look(p);
  if (out.A_add.total !== 3)   bad.push(`A: signed out got ${out.A_add.total} comps, not 3`);
  if (out.A_end.rung !== 'guest') bad.push(`A: rung is ${out.A_end.rung}`);
  if (!/free account/i.test(out.A_end.note || ''))
    bad.push('A: the signed-out wall does not mention the free account — it is the whole point of the wall');
  if (!/office\.html/.test(out.A_end.noteHref || ''))
    bad.push(`A: the signed-out wall points at ${out.A_end.noteHref}, which is not where an account is made`);
  if (out.A_end.calls.length)
    bad.push('A: a signed-out visitor called the server meter — there is no account to meter');
  await p.close();
}

/* ── B · a free account with an allowance ────────────────────────────────── */
{
  const p = await open({ name:'E', email:'e@x.com', plan:null, trial:null }, { cap:12, remaining:12 });
  out.B_start = await look(p);
  if (out.B_start.rung !== 'account') bad.push(`B: rung is ${out.B_start.rung}, expected account`);
  if (!/12\/12 left this week/.test(out.B_start.button || ''))
    bad.push(`B: the button does not count the week down — "${out.B_start.button}"`);
  out.B_add = await addUntilStuck(p);
  await p.waitForTimeout(300);
  out.B_end = await look(p);
  if (out.B_add.total !== 12) bad.push(`B: a free account got ${out.B_add.total} comps, not 12`);
  if (out.B_end.calls.filter(n => n > 0).length !== 12)
    bad.push(`B: the meter was spent ${out.B_end.calls.filter(n=>n>0).length} times for 12 comps`);
  if (!/resets on Monday/i.test(out.B_end.note || ''))
    bad.push('B: the weekly wall does not say it resets, so it reads as a permanent lockout');
  if (!/plans\.html/.test(out.B_end.noteHref || ''))
    bad.push('B: the account wall does not point at the plans');
  await p.close();
}

/* ── C · the SQL has not been run yet ────────────────────────────────────── */
{
  const p = await open({ name:'E', email:'e@x.com', plan:null, trial:null }, null);
  out.C = await addUntilStuck(p);
  const r = await look(p);
  out.C_rung = r.rung;
  if (out.C.total !== 3)
    bad.push(`C: with no meter in the database a free account got ${out.C.total} comps — a missing `
           + 'migration must fall back to the old limit, never open or close the gate by accident');
  await p.close();
}

/* ── D · a paid plan ─────────────────────────────────────────────────────── */
{
  const p = await open({ name:'E', email:'e@x.com', plan:'solo', trial:null }, { cap:12, remaining:12 });
  out.D = await addUntilStuck(p);
  const r = await look(p);
  out.D_rung = r.rung; out.D_calls = r.calls;
  if (out.D.total !== 24) bad.push(`D: a paid plan stopped at ${out.D.total} comps, not 24`);
  if (r.calls.length) bad.push('D: a paid plan called the weekly meter — it has no week');
  if (/left this week/.test(r.button || '')) bad.push('D: a paid plan is being shown a weekly count');
  await p.close();
}

/* ── E · the meter is not spent by looking ───────────────────────────────── */
{
  const p = await open({ name:'E', email:'e@x.com', plan:null, trial:null }, { cap:12, remaining:12 });
  await p.evaluate(() => { addComp(); });
  await p.waitForTimeout(200);
  const after1 = await p.evaluate(() => window.__COMPCALLS.filter(n => n > 0).length);
  await p.evaluate(() => { for (let i=0;i<6;i++) render(); S.comps[0].price='210000'; save(); render(); });
  await p.waitForTimeout(300);
  const after2 = await p.evaluate(() => window.__COMPCALLS.filter(n => n > 0).length);
  out.E = { afterOneAdd: after1, afterSevenRendersAndAnEdit: after2 };
  if (after1 !== 1) bad.push(`E: adding one comp spent the meter ${after1} times`);
  if (after2 !== 1) bad.push(`E: rendering and editing spent the meter — ${after2} charges for one comp`);
  await p.close();
}

/* ── F · the three controls agree ────────────────────────────────────────── */
{
  const p = await open({ name:'E', email:'e@x.com', plan:null, trial:null }, { cap:2, remaining:2 });
  await p.evaluate(() => { addComp(); addComp(); });
  await p.waitForTimeout(300);
  const r = await look(p);
  const stuck = await p.evaluate(() => { const n = S.comps.length; addComp(); return S.comps.length === n; });
  out.F = { room:r.room, button:r.button, note:!!r.note, addRefused:stuck };
  if (r.room !== 0)   bad.push(`F: the allowance is spent and compRoom says ${r.room}`);
  if (r.button)       bad.push('F: the add button is still on the page with nothing left to spend');
  if (!r.note)        bad.push('F: no wall was shown when the allowance ran out');
  if (!stuck)         bad.push('F: THE BUTTON WAS GONE AND addComp() ADDED ONE ANYWAY — the limit is drawn, not enforced');
  await p.close();
}

if (errs.length) bad.push('something threw — ' + errs[0]);
await b.close(); site.close();
console.log(JSON.stringify(out, null, 1));
if (bad.length){ console.log('FAIL'); bad.forEach(x => console.log(' - ' + x)); process.exit(1); }
console.log('PASS — three in a browser pointing at the account, twelve a week for an account counting '
  + 'down and saying it resets, unlimited for a paid plan that never calls the meter, a fall back to '
  + 'three where the migration has not run, one charge per comp added and none for looking, and the '
  + 'button, the note and addComp() all reading the same allowance');
process.exit(0);
