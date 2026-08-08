/* ── THE THREE DOORS THAT WERE NOT THERE ───────────────────────────────────
   The product had sign-up and sign-in and nothing else. No password reset, no
   way to resend a confirmation, and no emailRedirectTo — so Supabase sent its
   links to the project's Site URL, which defaults to localhost:3000.

   A tool you open on a Tuesday every few weeks is a tool people forget the
   password to. Without a reset that is a customer lost permanently, and they
   do not write in to say so.

   AND ONE THING THIS FILE EXISTS FOR MORE THAN ANY ASSERTION IN IT: the auth
   module is a template literal inside publish.mjs, so a backslash can be eaten
   on the way through. Writing /\+/ produced /+/ in the shipped page —
   "nothing to repeat" — which threw at PARSE time and took the entire module
   with it. Every auth function on the page became undefined. Nobody could sign
   in or sign up at all, on any account, and the page looked completely normal.
   Assertion one is that the module parses. */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

let n = 0, bad = 0;
const ok = (t, p, x) => { n++; if (!p){ bad++; console.log('✗ ' + t + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0, 240) : '')); } else console.log('✓ ' + t); };

/* a build WITH the account layer switched on — without keys the whole module
   is deliberately not injected, so an unconfigured build proves nothing */
const OUT = 'dist-auth';
execFileSync('node', ['publish.mjs'], { cwd:'/home/claude', stdio:'ignore', env:{ ...process.env,
  OUT, NI_SUPABASE_URL:'https://stub.supabase.co',
  NI_SUPABASE_ANON:'sb_publishable_stubstubstubstub' } });

const b = await chromium.launch();
const pg = await b.newPage({ viewport:{ width:1240, height:1000 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));

/* every request to the stub is recorded, so "did it ask the right endpoint
   with the right body" is a fact rather than an inference */
const asked = [];
await pg.route('**stub.supabase.co/**', async route => {
  const rq = route.request();
  let body = null; try { body = JSON.parse(rq.postData() || 'null'); } catch(e){}
  asked.push({ url: rq.url(), method: rq.method(), body });
  await route.fulfill({ status:200, contentType:'application/json', body:'{}' });
});

await pg.goto('file:///home/claude/' + OUT + '/office.html');
await pg.waitForTimeout(1100);

/* ── 1 · the module is there at all ────────────────────────────────────────*/
{
  const present = await pg.evaluate(() =>
    ['__authSignIn','__authSignUp','__authSignOut','__authToken',
     '__authRecover','__authResend','__authResetToken','__authSetPassword']
      .filter(k => typeof window[k] !== 'function'));
  ok('the auth module parses and every function is defined', present.length === 0, present);
  ok('and the page threw nothing on the way to that', !errs.length, errs[0]);
}

/* ── 2 · the door has four modes ───────────────────────────────────────────*/
{
  const m = await pg.evaluate(() => {
    const out = {}, $ = id => document.getElementById(id);
    window.__setGateMode('in');
    out.in = { forgot: !$('g-forgot').hidden, go: $('g-go').innerText.trim() };
    window.__setGateMode('recover');
    out.recover = { go: $('g-go').innerText.trim(), pwHidden: $('g-pwwrap').hidden };
    window.__setGateMode('reset');
    out.reset = { go: $('g-go').innerText.trim(), emailHidden: $('g-email').style.display === 'none',
                  haveHidden: $('g-have').hidden };
    window.__setGateMode('up');
    out.up = { go: $('g-go').innerText.trim(), forgot: !$('g-forgot').hidden };
    return out;
  });
  ok('signing in offers a way out of a forgotten password', m.in.forgot, m.in);
  ok('recover asks for an address and not a password', m.recover.pwHidden, m.recover);
  ok('reset asks for a password and not an address', m.reset.emailHidden, m.reset);
  ok('and reset offers no way to wander off into sign-up', m.reset.haveHidden, m.reset);
  ok('making an account is not offered a password reset', !m.up.forgot, m.up);
}

/* ── 3 · every outbound link points at THIS origin, not at localhost:3000 ──*/
{
  asked.length = 0;
  await pg.evaluate(async () => {
    window.__setGateMode('up');
    document.getElementById('g-name').value = 'E Payne';
    document.getElementById('g-email').value = 'e@example.com';
    document.getElementById('g-pw').value = 'sixchars';
    await window.__authSignUp('e@example.com', 'sixchars', 'E Payne');
    await window.__authRecover('e@example.com');
    await window.__authResend('e@example.com');
  });
  const byPath = f => asked.find(a => a.url.includes(f));
  const signup = byPath('/auth/v1/signup'), recover = byPath('/auth/v1/recover'), resend = byPath('/auth/v1/resend');
  ok('sign-up reaches Supabase', !!signup, asked.map(a => a.url));
  ok('recover reaches Supabase', !!recover, asked.map(a => a.url));
  ok('resend reaches Supabase', !!resend, asked.map(a => a.url));
  const redirectOf = a => a && a.body && ((a.body.options && a.body.options.emailRedirectTo)
                                          || a.body.emailRedirectTo);
  for (const [name, a] of [['sign-up', signup], ['recover', recover], ['resend', resend]]){
    const to = redirectOf(a);
    ok(`${name} tells Supabase where to send the person back to`, !!to, a && a.body);
    /* the failure this prevents: the link works for whoever set the project up
       and for nobody else, because Site URL is still localhost */
    ok(`  and it is not localhost`, !!to && !/localhost|127\.0\.0\.1/.test(String(to)), to);
  }
  ok('the recover link lands on the door, not on a dead page',
     /office\.html/.test(String(redirectOf(recover))), redirectOf(recover));
}

/* ── 4 · the reset token is read from the FRAGMENT and then removed ────────
   A recovery token in the query string reaches every server log between here
   and Supabase. In the fragment it reaches none of them — and it still must
   not survive in the address bar, because that is the next screenshot. */
{
  /* a fragment-only navigation does NOT reload the document, so goto() from
     the same URL with a new hash leaves the previous page sitting there and
     the assertion measures nothing. The blank page in between forces a real
     load — which is what a person clicking a link in an email actually does. */
  await pg.goto('about:blank');
  await pg.goto('file:///home/claude/' + OUT
    + '/office.html#access_token=tok-abc-123&type=recovery&expires_in=3600');
  await pg.waitForTimeout(900);
  const r = await pg.evaluate(() => ({
    hash: location.hash, go: (document.getElementById('g-go') || {}).innerText,
    err: (document.getElementById('g-err') || {}).innerText }));
  ok('arriving from a reset link opens the set-a-password screen',
     /Set it and sign me in/i.test(String(r.go)), r);
  ok('and the token is stripped from the address bar', r.hash === '' || r.hash === '#', r);
  ok('and it says what to do', /new password/i.test(String(r.err)), r);
}

/* ── 5 · an expired link says so and offers a fresh one ────────────────────*/
{
  await pg.goto('about:blank');
  await pg.goto('file:///home/claude/' + OUT
    + '/office.html#error=access_denied&error_description=Email+link+is+invalid+or+has+expired');
  await pg.waitForTimeout(900);
  const r = await pg.evaluate(() => ({
    go: (document.getElementById('g-go') || {}).innerText,
    err: (document.getElementById('g-err') || {}).innerText }));
  ok('an expired link explains itself in words, not a code',
     /expired|invalid/i.test(String(r.err)) && !/\+/.test(String(r.err)), r);
  ok('and puts you straight on the screen that fixes it',
     /Email me a reset link/i.test(String(r.go)), r);
}

/* ── 6 · a confirmed address lands on sign-in and says so ──────────────────*/
{
  await pg.goto('file:///home/claude/' + OUT + '/office.html?confirmed=1');
  await pg.waitForTimeout(900);
  const r = await pg.evaluate(() => ({
    go: (document.getElementById('g-go') || {}).innerText,
    err: (document.getElementById('g-err') || {}).innerText }));
  ok('confirming an address puts you on the sign-in screen',
     /Sign in/i.test(String(r.go)), r);
  ok('and tells you it worked', /confirmed/i.test(String(r.err)), r);
}

/* ── 7 · a reset never says whether the address exists ─────────────────────
   "No account with that email" is a free membership check for anybody holding
   a list. It is also the only honest answer: from the browser we do not know
   whether the mail was delivered. */
{
  await pg.goto('file:///home/claude/' + OUT + '/office.html');
  await pg.waitForTimeout(900);
  const said = await pg.evaluate(async () => {
    window.__setGateMode('recover');
    document.getElementById('g-email').value = 'nobody@example.com';
    document.getElementById('gate-form').dispatchEvent(new Event('submit', { cancelable:true }));
    await new Promise(r => setTimeout(r, 700));
    return (document.getElementById('g-err') || {}).innerText || '';
  });
  ok('a reset request is answered the same way whoever asked',
     /if there is an account/i.test(said), said);
  ok('and it never confirms or denies that the address is registered',
     !/no account|not found|does not exist|unknown/i.test(said), said);
}

ok('no page errors anywhere in this file', !errs.length, errs[0]);
await b.close();
try { fs.rmSync('/home/claude/' + OUT, { recursive:true, force:true }); } catch(e){}
console.log(bad ? `\n${bad} of ${n} FAILED` : `\nall ${n} hold — the module parses, four doors, links that point home, and a reset that tells nobody who is a member`);
process.exit(bad ? 1 : 0);
