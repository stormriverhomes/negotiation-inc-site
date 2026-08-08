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
    /* ── PAINT, NOT THE ATTRIBUTE ─────────────────────────────────────────
       This harness used to read $('g-have').hidden and call that an answer.
       It is not one: the way back out of the recover screen sat INSIDE
       #g-pwwrap, which recover hides, so setMode set hidden = false on a
       link that painted at zero height and the assertion passed while the
       screen was a dead end. An element's own flag says nothing about
       whether a person can see it — only the box does. */
    const paints = id => { const e = $(id); if (!e) return false;
      return e.getBoundingClientRect().height > 0 && !!e.offsetParent; };
    window.__setGateMode('in');
    out.in = { forgot: paints('g-forgot'), go: $('g-go').innerText.trim() };
    window.__setGateMode('recover');
    out.recover = { go: $('g-go').innerText.trim(), pwHidden: $('g-pwwrap').hidden,
                    back: paints('g-have'), backText: $('g-have').textContent.trim() };
    window.__setGateMode('reset');
    out.reset = { go: $('g-go').innerText.trim(), emailHidden: $('g-email').style.display === 'none',
                  back: paints('g-have'), signup: paints('g-forgot') };
    window.__setGateMode('up');
    out.up = { go: $('g-go').innerText.trim(), forgot: paints('g-forgot'), have: paints('g-have') };
    return out;
  });
  ok('signing in offers a way out of a forgotten password', m.in.forgot, m.in);
  /* ── THE TWO DOORS ARE TOLD APART BEFORE ANYTHING IS TYPED ───────────────
     There was one form, and the only thing distinguishing it from the other
     one was a small text link underneath reading "I already have an account".
     So a returning customer met a page headed "Open your workspace" with a
     NAME field on it, asking them to register again, and the way out was
     sized like a footnote. */
  const tabs = await pg.evaluate(() => {
    const $ = id => document.getElementById(id), t = $('g-tabs');
    if (!t) return { missing: true };
    const read = () => ({ shown: !t.hidden,
      sel: [...t.querySelectorAll('[data-mode]')].filter(x => x.getAttribute('aria-selected') === 'true')
             .map(x => x.dataset.mode)[0] || null,
      h: $('gate-h').textContent, go: $('g-go').innerText.trim(),
      name: $('g-name').style.display !== 'none' });
    const out = {};
    t.querySelector('[data-mode=up]').click(); out.up = read();
    t.querySelector('[data-mode=in]').click(); out.in = read();
    window.__setGateMode('recover'); out.recover = { shown: !t.hidden };
    window.__setGateMode('reset');   out.reset = { shown: !t.hidden };
    return out;
  });
  ok('the door shows two tabs, not one form with a footnote', !tabs.missing, tabs);
  ok('and the selected one is the mode you are in',
     tabs.up.sel === 'up' && tabs.in.sel === 'in', { up:tabs.up.sel, in:tabs.in.sel });
  ok('signing in does not ask for a name', tabs.in.name === false, tabs.in);
  ok('and does not greet a returning customer as a stranger',
     /welcome back/i.test(tabs.in.h) && !/open your workspace/i.test(tabs.in.h), tabs.in.h);
  ok('while making an account still says what it makes',
     /open your workspace/i.test(tabs.up.h), tabs.up.h);
  /* the two modes you ARRIVE in rather than choose have no tab, because a
     selected tab that no longer describes the screen is worse than none */
  ok('recover and reset hide the strip rather than leaving a stale tab selected',
     tabs.recover.shown === false && tabs.reset.shown === false, tabs);
  /* This strip only exists on a CONFIGURED build, and this is the only file
     that makes one — so the paint harnesses never see it and the contrast
     check has to live here. The first version was styled for the dark column
     beside the form and shipped pale grey on white: a control whose second
     option cannot be read is a control that still has one option. */
  /* the block above left the door in 'reset', where the strip is deliberately
     hidden — measuring it there measures nothing. Put it back on a screen
     that HAS tabs before reading their paint. */
  await pg.evaluate(() => window.__setGateMode('up'));
  const paint = await pg.evaluate(() => {
    const lum = c => { const s = c.map(v => { v /= 255;
      return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
      return 0.2126*s[0] + 0.7152*s[1] + 0.0722*s[2]; };
    const rgb = t => (String(t).match(/\d+(\.\d+)?/g) || [0,0,0]).slice(0,3).map(Number);
    const cr = (a, b) => { const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x,y) => y-x);
      return +((hi + .05) / (lo + .05)).toFixed(2); };
    const strip = document.getElementById('g-tabs');
    const track = getComputedStyle(strip).backgroundColor;
    return [...strip.querySelectorAll('button')].map(b => { const cs = getComputedStyle(b);
      return { m: b.dataset.mode, sel: b.getAttribute('aria-selected'),
        cr: cr(cs.color, cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? track : cs.backgroundColor),
        h: Math.round(b.getBoundingClientRect().height) }; });
  });
  for (const t of paint){
    ok(`the ${t.m} tab is readable (${t.cr}:1)`, t.cr >= 4.5, t);
    ok(`  and is a real target (${t.h}px)`, t.h >= 40, t);
  }
  ok('recover asks for an address and not a password', m.recover.pwHidden, m.recover);
  ok('reset asks for a password and not an address', m.reset.emailHidden, m.reset);
  ok('making an account is not offered a password reset', !m.up.forgot, m.up);
  /* ── NEITHER ARRIVED-AT SCREEN IS A DEAD END ────────────────────────────
     recover and reset both hide the tab strip on purpose, so the strip
     cannot be the way back. If the link is not DRAWN, the only exit from
     either screen is the browser's own back button — and a reset link from
     an email is exactly the thing people click after it has expired. */
  ok('the recover screen draws a way back to signing in', m.recover.back, m.recover);
  ok('and it is worded as a return, not as a second signup',
     /back to signing in/i.test(m.recover.backText), m.recover.backText);
  ok('the reset screen draws one too, for an expired link', m.reset.back, m.reset);
  ok('and offers no password reset from inside the password reset',
     m.reset.signup === false, m.reset);
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
