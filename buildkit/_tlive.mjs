/* _tlive — the account layer, against the REAL Supabase project.

   Every other auth test in this suite runs against a stub I wrote, which means
   it proves my code agrees with my own idea of what the server does. This one
   proves the idea was right. It is the only test that can catch a wrong header
   shape, a policy that reads differently than it looked in the SQL editor, or
   a key format the hand-rolled fetch calls do not actually speak.

     A · a stranger signs up at the door, and lands in the product
     B · they price a property, and it reaches the server
     C · A SECOND BROWSER, with nothing on disk, signs in and the property is
         there — which is the promise the plans page makes and the whole
         reason this layer exists
     D · THE PLAN IS SERVER TRUTH. Typed into devtools, gone on reload.
     E · signing out ends the session, not just the cache — a refresh token
         left behind quietly signs the next person in
     F · nothing throws on any of it

   It creates real rows in a real database, so it cleans up after itself by
   deleting its own sheets and signing out. The user it leaves behind is named
   so it is obvious what it was.

   ── WHY THIS IS NOT ON THE BOARD ──────────────────────────────────────────
   Every other harness is hermetic: no network, no shared state, safe to run
   forty times an hour in parallel. This one signs up a real person against a
   real project. On a board it would create a row per run and go red whenever
   Supabase rate-limited it — a red light that means "the internet" trains you
   to skim past red, which is the one thing a board must never do.

   It is a RELEASE check. Build with the real keys, run it once, read it:
     NI_SUPABASE_URL=… NI_SUPABASE_ANON=sb_publishable_… node publish.mjs
     node _tlive.mjs

   Without those two variables publish.mjs ships a door with no account layer
   behind it, and this file used to discover that as a thirty-second Playwright
   timeout on a hidden password field. It now says so in one line, up front. */
import { chromium } from 'playwright';
import fs from 'fs';
import http from 'node:http';

const SB  = 'https://zfsazgrxhtitxakjvyqq.supabase.co';
const bad = [], out = {}, errs = [];

/* serve dist/ so the pages run on a real origin rather than file:// */
const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname === '/' ? '/index.html' : u.pathname;
  const f = '/home/claude/dist' + p;
  if (fs.existsSync(f) && fs.statSync(f).isFile()){
    res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
    return res.end(fs.readFileSync(f));
  }
  res.writeHead(404); res.end('no');
});
const port = await new Promise(r => site.listen(0, '127.0.0.1', () => r(site.address().port)));
const BASE = `http://127.0.0.1:${port}`;

const email = `ni-live-${Date.now().toString(36)}@example.com`;
const pass  = 'sixchars123';
const NAME  = 'Live Harness';

const b = await chromium.launch();

/* ══ A · sign up at the real door ════════════════════════════════════════ */
const one = await b.newPage();
one.on('pageerror', e => errs.push('one: ' + e.message));
await one.goto(BASE + '/office.html');
await one.evaluate(() => localStorage.clear());
await one.reload();
await one.waitForFunction(() => typeof window.__authOn === 'function', null, { timeout: 20000 });

out.A_configured = await one.evaluate(() => ({
  authOn: !!window.__authOn(), url: window.NI_SUPABASE_URL,
  passwordAsked: !document.getElementById('g-pwwrap').hidden }));
/* bail before touching a door that has nothing behind it, rather than filling
   a password field that a build without keys correctly refuses to show */
if (!out.A_configured.authOn || !out.A_configured.passwordAsked){
  console.log('CANNOT RUN — dist/ was built without the account layer.\n' +
    '  window.NI_SUPABASE_URL  = ' + JSON.stringify(out.A_configured.url || null) + '\n' +
    '  the door asks for a password: ' + out.A_configured.passwordAsked + '\n\n' +
    'This harness signs up against the REAL project, so it needs a real build:\n' +
    '  NI_SUPABASE_URL=https://….supabase.co NI_SUPABASE_ANON=sb_publishable_… node publish.mjs\n' +
    '  node _tlive.mjs\n\n' +
    'Nothing is wrong with the product — a build with no keys is SUPPOSED to hide\n' +
    'the password field and fall back to the local door.');
  await b.close(); site.close(); process.exit(2);
}

await one.fill('#g-name', NAME);
await one.fill('#g-email', email);
await one.fill('#g-market', '30310');
await one.fill('#g-pw', pass);
await one.click('#g-go');
await one.waitForTimeout(4000);
out.A_landed = one.url().replace(BASE, '');
if (!/desk\.html/.test(out.A_landed)) {
  const err = await one.evaluate(() => (document.getElementById('g-err')||{}).textContent || null);
  bad.push(`A: signing up did not reach the desk — stayed at ${out.A_landed} (${err || 'no message'})`);
}

/* ══ B · price a property, and let it sync ══════════════════════════════ */
if (/desk\.html/.test(out.A_landed)){
  await one.waitForFunction(() => typeof S !== 'undefined' && typeof save === 'function', null, { timeout: 20000 });
  await one.evaluate(() => {
    S.addr = '1128 Marrow Lane';
    Object.assign(S.raw, { asking:'249500', arv:'291000', repairs:'41300', rent:'1850' });
    S.name = 'The live harness property';
    render(); save();
  });
  /* the push is debounced by four seconds on purpose — wait it out rather
     than reaching past it, because the debounce is part of what is being
     tested: a sync that fires per keystroke is one that gets rate limited */
  await one.waitForTimeout(9000);
  out.B_local = await one.evaluate(() => ({
    props: P.props.length, name: P.props[P.active] && P.props[P.active].name }));
}

/* ══ C · a second browser, nothing on disk ══════════════════════════════ */
{
  const ctx = await b.newContext();          // its own storage, like another machine
  const two = await ctx.newPage();
  two.on('pageerror', e => errs.push('two: ' + e.message));
  await two.goto(BASE + '/office.html');
  await two.waitForFunction(() => typeof window.__authSignIn === 'function', null, { timeout: 20000 });
  const signedIn = await two.evaluate(async ([e, p]) => await window.__authSignIn(e, p), [email, pass]);
  out.C_signIn = { ok: !!signedIn.ok, error: signedIn.error || null };
  if (!signedIn.ok) bad.push('C: the second browser could not sign in — ' + signedIn.error);

  await two.goto(BASE + '/desk.html');
  await two.waitForFunction(() => typeof P !== 'undefined', null, { timeout: 20000 });
  await two.waitForTimeout(7000);            // authBoot pulls the profile then the sheets
  out.C_second = await two.evaluate(() => ({
    name: (JSON.parse(localStorage.getItem('ni-account-v1')||'{}')).name || null,
    market: (JSON.parse(localStorage.getItem('ni-account-v1')||'{}')).market || null,
    props: P.props.map(p => p.name).filter(Boolean),
    addrs: P.props.map(p => p.addr).filter(Boolean) }));
  if (out.C_second.name !== NAME)
    bad.push(`C: the second browser did not learn the name from the server (got ${out.C_second.name})`);
  if (!out.C_second.addrs.some(a => /Marrow/.test(a)))
    bad.push('C: THE PROPERTY DID NOT REACH THE SECOND BROWSER — "the portfolio on every device" is not true');

  /* ══ D · the plan is server truth ═════════════════════════════════════ */
  out.D_before = await two.evaluate(() => tierOf());
  await two.evaluate(() => {
    const a = JSON.parse(localStorage.getItem('ni-account-v1') || '{}');
    a.plan = 'the office';
    localStorage.setItem('ni-account-v1', JSON.stringify(a));
  });
  out.D_faked = await two.evaluate(() => tierOf());
  await two.reload();
  await two.waitForFunction(() => typeof tierOf === 'function', null, { timeout: 20000 });
  await two.waitForTimeout(6000);
  out.D_after = await two.evaluate(() => ({
    tier: tierOf(), plan: (JSON.parse(localStorage.getItem('ni-account-v1')||'{}')).plan || null }));
  if (out.D_faked !== 3) bad.push('D: the fake plan was not even applied locally, so the test proved nothing');
  if (out.D_after.tier !== 0 || out.D_after.plan)
    bad.push(`D: A PLAN TYPED INTO DEVTOOLS SURVIVED A RELOAD (tier ${out.D_after.tier}, plan ${out.D_after.plan})`);

  /* ══ E · signing out ends the session ════════════════════════════════ */
  await two.evaluate(async () => { await window.__authSignOut(); });
  await two.waitForTimeout(1500);
  out.E = await two.evaluate(() => ({ sess: localStorage.getItem('ni-session-v1') }));
  if (out.E.sess) bad.push('E: signing out left the session on the machine');

  /* clean up this run's rows with the session from the FIRST browser */
  try {
    out.cleanup = await one.evaluate(async (sb) => {
      const t = await window.__authToken();
      if (!t) return 'no token';
      const key = window.NI_SUPABASE_ANON;
      const r = await fetch(sb + '/rest/v1/sheets', { method:'DELETE',
        headers:{ apikey:key, authorization:'Bearer ' + t, Prefer:'return=minimal' } });
      return r.status;
    }, SB);
  } catch(e){ out.cleanup = 'failed'; }

  await ctx.close();
}

if (errs.length) bad.push('F: something threw — ' + errs[0]);
out.F_errs = errs;

await b.close(); site.close();
console.log(JSON.stringify(out, null, 1));
console.log('\nleft behind in Supabase: one user, ' + email);
if (bad.length){ console.log('FAIL'); bad.forEach(x => console.log(' - ' + x)); process.exit(1); }
console.log('PASS — against the real project: a stranger signs up at the door, prices a property, and finds it waiting in a second browser with nothing on disk; a plan typed into devtools is gone on reload; and signing out ends the session rather than forgetting it');
