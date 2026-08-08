/* ── THE PAGE THAT MAKES THIS RUNNABLE ─────────────────────────────────────
   Every number on /ops already existed. The meters, the day budget, the
   billing state, the build stamp — all of it was being kept and none of it was
   ever shown, so "how is the business doing" and "is anything broken" were
   both answered by reading source code.

   Two properties matter more than any number on it:

     · IT FAILS CLOSED. No NI_OPS_TOKEN means the route does not exist. A
       deploy that forgets the variable must expose nothing, not everything —
       and the wrong token gets a 404 rather than a 403, because an endpoint
       that says "wrong token" has already confirmed it exists.

     · IT NAMES NOBODY. Counts, sums and rates; never an email, a uid or a
       sheet. This is a page you open on a phone on a train, and one that lists
       your customers is one screenshot away from being a breach.

   And separately: until now a route that threw produced a blank 500 and
   nothing anywhere else. No log line, no counter, no way to know. The last
   section here throws something on purpose and checks that it was counted. */
import http from 'node:http';
import { spawn } from 'node:child_process';

let n = 0, bad = 0;
const ok = (t, p, x) => { n++; if (!p){ bad++; console.log('✗ ' + t + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0, 240) : '')); } else console.log('✓ ' + t); };

const TOKEN = 'ops-token-for-the-harness';
const PORT = 3960 + (process.pid % 30);
const B = `http://127.0.0.1:${PORT}`;

/* a Supabase that answers the HEAD counts, so the people/plans half is
   exercised rather than skipped as null */
const counts = { profiles: 41, 'plan=eq.solo': 7, 'plan=eq.underwriter': 3 };
const stub = http.createServer((q, r) => {
  /* the waitlist source breakdown is a GET, not a HEAD count */
  if (q.url.includes('waitlist') && q.url.includes('select=source')){
    r.writeHead(200, { 'content-type':'application/json' });
    return r.end(JSON.stringify([{source:'plans-founding-r-reddit'},{source:'plans-founding-r-reddit'},
      {source:'index'},{source:'plans-founding'},{source:'plans-founding-r-reddit'}]));
  }
  let total = counts.profiles;
  for (const [k, v] of Object.entries(counts)) if (k !== 'profiles' && q.url.includes(k)) total = v;
  if (q.url.includes('plan=in.')) total = 1;
  if (q.url.includes('trial=not.is.null')) total = 5;
  if (q.url.includes('waitlist')) total = 12;
  if (q.url.includes('created_at=gte')) total = 4;
  r.writeHead(200, { 'content-range': `0-0/${total}`, 'content-type':'application/json' });
  r.end('[]');
});
const sbPort = await new Promise(r => stub.listen(0, '127.0.0.1', () => r(stub.address().port)));

const srv = spawn('node', ['server.js'], { cwd:'/home/claude/srv', stdio:'ignore', env:{ ...process.env,
  PORT: String(PORT), NI_MOCK:'1', NI_OPS_TOKEN: TOKEN,
  SUPABASE_URL: `http://127.0.0.1:${sbPort}`,
  SUPABASE_SERVICE_KEY:'service-stub', SUPABASE_ANON_KEY:'anon-stub',
  STRIPE_SECRET:'sk_test_stub', NI_DAILY_USD:'25' }});
for (let i = 0; i < 60; i++){
  try { const r = await fetch(B + '/api/health'); if (r.ok) break; } catch(e){}
  await new Promise(r => setTimeout(r, 250));
}
const get = (p) => fetch(B + p).then(async r => ({ status:r.status, ct:r.headers.get('content-type') || '',
  text: await r.text() }));

/* ── 1 · the gate ──────────────────────────────────────────────────────────*/
{
  const none = await get('/ops');
  const wrong = await get('/ops?k=' + TOKEN + 'x');
  const short = await get('/ops?k=a');
  const right = await get('/ops?k=' + TOKEN);
  ok('no token is a 404, not a login page', none.status === 404, none.status);
  ok('a wrong token is a 404 too — never a 403 that confirms the route exists',
     wrong.status === 404, wrong.status);
  ok('a token of the wrong length is refused without comparing',
     short.status === 404, short.status);
  ok('the right token opens it', right.status === 200, right.status);
  ok('and it is a page, not JSON', /text\/html/.test(right.ct), right.ct);
  ok('and it asks not to be indexed', /noindex/.test(right.text), right.text.slice(0, 200));
  /* the same rules on the JSON twin, which is the one a script would hit */
  const jn = await get('/api/ops');
  const jr = await get('/api/ops?k=' + TOKEN);
  ok('the JSON endpoint is gated the same way', jn.status === 404 && jr.status === 200, { jn:jn.status, jr:jr.status });
}

/* ── 2 · it says what is true, including the thing that costs money ────────*/
{
  const r = await get('/api/ops?k=' + TOKEN);
  const d = JSON.parse(r.text);
  ok('it reports which build is running', !!(d.build && d.build.id), d.build);
  ok('it counts the accounts', d.people.total === 41, d.people);
  ok('it counts who is paying', d.plans.solo === 7 && d.plans.underwriter === 3, d.plans);
  /* the number the whole page exists for */
  ok('and turns that into MRR', d.plans.mrr === 7 * 39 + 3 * 129 + 1 * 249, d.plans);
  ok('it knows the day budget it is working against', d.today.budgetUsd === 25, d.today);
  /* a live site on a test key takes no money and looks exactly like a live
     site on which nobody has subscribed */
  ok('it names the Stripe mode', d.billing.mode === 'test', d.billing);
  const html = (await get('/ops?k=' + TOKEN)).text;
  ok('and the page shouts when that mode means nobody can pay',
     /NOBODY CAN PAY YOU/.test(html), html.slice(0, 300));
}

/* ── 3 · it names nobody ───────────────────────────────────────────────────*/
{
  const r = await get('/api/ops?k=' + TOKEN);
  const html = (await get('/ops?k=' + TOKEN)).text;
  for (const [what, re] of [
    ['an email address', /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i],
    ['a uuid', /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i],
    ['a bearer token', /sk_(live|test)_[A-Za-z0-9]{8}/],
  ]){
    /* the harness's own token is passed in the URL, so it appears in neither
       body — checking the body is the point */
    ok(`the JSON contains no ${what}`, !re.test(r.text), (r.text.match(re) || [])[0]);
    ok(`the page contains no ${what}`, !re.test(html), (html.match(re) || [])[0]);
  }
  /* The token must not be in the JSON at all, and must not appear in a URL on
     the page — a query string lands in browser history, in a proxy log, in a
     Referer header and in the screenshot somebody takes of the dashboard.
     The first valid load moves it into an HttpOnly cookie and every request
     after that carries it there, so the forms do not need it. */
  ok('the JSON never echoes the token', !r.text.includes(TOKEN), '');
  ok('and no URL on the page carries it', !/[?&]k=/.test(html), (html.match(/.{30}[?&]k=.{20}/) || [])[0]);
  ok('and the page does not contain it at all', !html.includes(TOKEN), '');
}

/* ── 4 · a thrown route is counted rather than silent ──────────────────────
   This is the half that has never existed. Express turns a thrown handler into
   a blank 500 and tells nobody — no log, no counter, no signal at all. */
{
  const before = JSON.parse((await get('/api/ops?k=' + TOKEN)).text).errors.sinceBoot;
  /* a request the server will genuinely fail on: a body that is not JSON on a
     route that parses JSON. That is a real 4xx/5xx path, not a synthetic one. */
  await fetch(B + '/api/comps', { method:'POST',
    headers:{ 'content-type':'application/json' }, body:'{not json at all' }).catch(() => {});
  await new Promise(r => setTimeout(r, 300));
  const d = JSON.parse((await get('/api/ops?k=' + TOKEN)).text);
  ok('a malformed request is counted rather than silent', d.errors.sinceBoot > before,
     { before, after: d.errors.sinceBoot });
  ok('and it is on the page with a route and a count',
     d.errors.list.length > 0 && d.errors.list[0].n >= 1, d.errors.list[0]);
  ok('the message is truncated, so nobody\'s data rides out in an error string',
     d.errors.list.every(e => e.msg.length <= 160), d.errors.list.map(e => e.msg.length));
  /* health carries the recent count, so a spike is visible without the token */
  const h = JSON.parse((await get('/api/health')).text);
  ok('health reports errors in the last hour', typeof h.errors.lastHour === 'number', h.errors);
  ok('but health still names nothing', !h.errors.list, h.errors);
}

/* ── 5 · the ring is bounded ───────────────────────────────────────────────
   A route failing two hundred times is ONE thing to look at. A list of two
   hundred identical lines is how a real signal gets buried. */
{
  for (let i = 0; i < 12; i++)
    await fetch(B + '/api/comps', { method:'POST',
      headers:{ 'content-type':'application/json' }, body:'{still not json' }).catch(() => {});
  await new Promise(r => setTimeout(r, 400));
  const d = JSON.parse((await get('/api/ops?k=' + TOKEN)).text);
  ok('repeats collapse into one row with a count', d.errors.list.length <= 4, d.errors.list.length);
  ok('and the count went up', d.errors.sinceBoot >= 12, d.errors.sinceBoot);
  ok('the list never grows past its bound', d.errors.list.length <= 40, d.errors.list.length);
}

/* ── 5b · the token moves into a cookie on first load ──────────────────────*/
{
  const r = await fetch(B + '/ops?k=' + TOKEN);
  const setc = r.headers.get('set-cookie') || '';
  ok('the first valid load sets a cookie', /ni_ops=/.test(setc), setc.slice(0, 80));
  ok('and no script on the page can read it', /HttpOnly/i.test(setc), setc);
  ok('and it is not sent from anywhere else', /SameSite=Strict/i.test(setc), setc);
  /* and the cookie alone opens it, with no token in the URL */
  const c = await fetch(B + '/ops', { headers:{ cookie:'ni_ops=' + TOKEN } });
  ok('the cookie alone opens the page', c.status === 200, c.status);
  const w = await fetch(B + '/ops', { headers:{ cookie:'ni_ops=' + TOKEN + 'x' } });
  ok('and a wrong cookie is still a 404', w.status === 404, w.status);
}

/* ── 6 · the two levers ────────────────────────────────────────────────────
   "In my developer dashboard I should be able to have a high degree of control
   over the service." The honest version is narrow: pause the spend, and change
   today's budget. Both reversible, both effective on the next request, both
   dead after a deploy — a pause that survives a restart is a pause somebody
   sets at 2am and rediscovers on Thursday. */
{
  const post = (body) => fetch(B + '/api/ops/control?k=' + TOKEN, { method:'POST',
    headers:{ 'content-type':'application/json' }, body: JSON.stringify(body) })
    .then(async r => ({ status:r.status, j: await r.json().catch(() => null) }));

  const nope = await fetch(B + '/api/ops/control', { method:'POST',
    headers:{ 'content-type':'application/json' }, body:'{"action":"pause"}' });
  ok('the controls are behind the same token as the page', nope.status === 404, nope.status);

  const p = await post({ action:'pause', minutes:30, why:'a bill running away' });
  ok('pause takes', p.j && p.j.paused === true && p.j.pausedFor === 30, p.j);
  const d = JSON.parse((await get('/api/ops?k=' + TOKEN)).text);
  ok('and the page knows it is paused', d.control.paused === true, d.control);
  ok('and remembers why', /bill running away/.test(String(d.control.pauseWhy)), d.control);

  const r = await post({ action:'resume' });
  ok('resume takes', r.j && r.j.paused === false, r.j);

  const b1 = await post({ action:'budget', usd:42 });
  ok("today's budget can be changed without a deploy", b1.j && b1.j.budgetUsd === 42, b1.j);
  const d2 = JSON.parse((await get('/api/ops?k=' + TOKEN)).text);
  ok('and the page says it is an override rather than the configured number',
     d2.control.budgetIsOverride === true, d2.control);
  /* bounds, because a control panel that accepts anything is a way to break
     the thing it exists to protect */
  const junk = await post({ action:'budget', usd:'not a number' });
  ok('a budget that is not a number falls back rather than becoming NaN',
     junk.j && Number.isFinite(junk.j.budgetUsd), junk.j);
  const huge = await post({ action:'budget', usd:999999 });
  ok('and an absurd one is refused', huge.j && huge.j.budgetUsd !== 999999, huge.j);
  await post({ action:'budget', usd:'' });

  const bad2 = await post({ action:'delete-everything' });
  ok('an action nobody wrote is refused rather than ignored', bad2.status === 400, bad2);

  /* a pause is a HELD position: it must survive being asked about */
  await post({ action:'pause', minutes:1 });
  const held = JSON.parse((await get('/api/ops?k=' + TOKEN)).text);
  ok('and reading the page does not clear the pause', held.control.paused === true, held.control);
  await post({ action:'resume' });
}

/* ── THE LIST, WHICH IS THE WHOLE FUNNEL UNTIL PAYMENTS ARE ON ─────────────
   This page showed accounts, plans, spend, errors and founding places and said
   nothing about the one number that actually moves before launch. Finding out
   how many addresses had come in meant opening Supabase — which is the same
   failure the whole page exists to fix.

   The breakdown is what makes it worth looking at, and it is honest: every row
   is somebody who chose to type their address into a form. There is no page
   tracking on this site, the privacy page says so in as many words, and this
   must not quietly become the thing that makes that untrue. */
{
  const d = JSON.parse((await get('/api/ops?k=' + TOKEN)).text);
  ok('ops reports the list at all', !!d.list, Object.keys(d));
  ok('and how many addresses there are', d.list.total === 12, d.list);
  ok('and how many arrived today', d.list.today === 4, d.list);
  ok('and where they came from, commonest first',
     Array.isArray(d.list.by) && d.list.by[0].source === 'plans-founding-r-reddit' && d.list.by[0].n === 3,
     d.list.by);
  ok('and it carries the campaign tag through, so a post can be told from a page',
     d.list.by.some(x => /-r-reddit$/.test(x.source)), d.list.by);
  /* the reply is a tally and must never become a list of people */
  const body = JSON.stringify(d);
  ok('and no address of any kind is in the reply', !/@/.test(body), (body.match(/.{20}@.{20}/) || [])[0]);

  const page = (await get('/ops?k=' + TOKEN)).text;
  ok('the page draws it', /The list/.test(page) && /plans-founding-r-reddit/.test(page), '');
  ok('and says out loud that nothing is tracked', /no page tracking/i.test(page), '');
}

srv.kill(); stub.close();
console.log(bad ? `\n${bad} of ${n} FAILED` : `\nall ${n} hold — it fails closed, it names nobody, and a route that throws is finally counted`);
process.exit(bad ? 1 : 0);
