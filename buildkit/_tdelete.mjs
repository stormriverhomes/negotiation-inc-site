/* ── "DELETE EVERYTHING" HAS TO DELETE EVERYTHING ──────────────────────────
   The hub's delete button called wipeAll(), which looped a list of
   localStorage keys and removed them. That was the whole of it. The auth
   user, the profile row and every synced sheet stayed on the server — and
   because mergeSheets() treats a remote sheet with no local twin as "a sheet
   from another device", signing back in RESTORED all of it.

   The privacy page promises deletion in three rows, with retention periods
   printed beside them. So this was not a missing feature, it was a written
   promise the software broke.

   Four things are asserted, and the last two are the ones that matter:
     · the button asks the server before it clears the browser
     · the server route exists, requires an identity, and deletes in the order
       sheets → usage → profile → login (the login last, because deleting it
       first revokes the token the other three authenticate with)
     · a server that says NO leaves the browser untouched and says so —
       telling somebody their data is gone while it sits in a table is the one
       failure here that cannot be walked back
     · the privacy page and the product agree about what happens

   The server half runs against a STUB Supabase, because the real one would
   mean creating and destroying a real person to test it. */
import { chromium } from 'playwright';
import http from 'node:http';
import { spawn } from 'node:child_process';

let n = 0, bad = 0;
const ok = (t, p, x) => { n++; if (!p){ bad++; console.log('✗ ' + t + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0, 240) : '')); } else console.log('✓ ' + t); };

/* ── a Supabase that records what was asked of it ──────────────────────────*/
const seen = [];
let refuse = null;                       // set to a path fragment to make it fail
const stub = http.createServer((q, r) => {
  seen.push({ m: q.method, u: q.url });
  if (q.url.startsWith('/auth/v1/user')){
    r.writeHead(200, { 'content-type': 'application/json' });
    return r.end(JSON.stringify({ id: 'user-abc-123', email: 'e@x.com' }));
  }
  if (q.url.includes('/rest/v1/profiles') && q.method === 'GET'){
    r.writeHead(200, { 'content-type': 'application/json' });
    return r.end(JSON.stringify([{ plan: 'solo', trial: null }]));
  }
  if (refuse && q.url.includes(refuse)){ r.writeHead(500); return r.end('no'); }
  r.writeHead(q.method === 'DELETE' ? 204 : 200, { 'content-type': 'application/json' });
  r.end('[]');
});
const sbPort = await new Promise(r => stub.listen(0, '127.0.0.1', () => r(stub.address().port)));

/* ── the service, pointed at it ────────────────────────────────────────────*/
const PORT = 3900 + (process.pid % 90);
const srv = spawn('node', ['server.js'], { cwd: '/home/claude/srv', env: { ...process.env,
  PORT: String(PORT), NI_MOCK: '1',
  SUPABASE_URL: `http://127.0.0.1:${sbPort}`,
  SUPABASE_SERVICE_KEY: 'service-stub', SUPABASE_ANON_KEY: 'anon-stub',
  ANTHROPIC_API_KEY: '', NI_ACCESS_CODE: '' }, stdio: 'ignore' });
const B = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 60; i++){
  try { const r = await fetch(B + '/api/health'); if (r.ok) break; } catch(e){}
  await new Promise(r => setTimeout(r, 250));
}

const call = (tok) => fetch(B + '/api/account/delete', { method: 'POST',
  headers: { 'content-type':'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) },
  body: '{}' }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

/* ── 1 · no identity, no deletion ──────────────────────────────────────────*/
{
  seen.length = 0;
  const r = await call(null);
  ok('a request with no session is refused', r.status === 401, r);
  ok('and nothing was deleted on the way to refusing it',
     !seen.some(x => x.m === 'DELETE'), seen.filter(x => x.m === 'DELETE'));
}

/* ── 2 · a real session deletes all four, in the right order ───────────────*/
{
  seen.length = 0; refuse = null;
  const r = await call('token-abc');
  ok('a signed-in request is accepted', r.status === 200 && r.body && r.body.ok === true, r);
  const dels = seen.filter(x => x.m === 'DELETE').map(x => x.u);
  const at = frag => dels.findIndex(u => u.includes(frag));
  ok('the sheets are deleted',  at('/sheets')   >= 0, dels);
  ok('the usage rows are deleted', at('/usage') >= 0, dels);
  ok('the profile is deleted',  at('/profiles') >= 0, dels);
  ok('the login itself is deleted', at('/admin/users') >= 0, dels);
  /* the login LAST: deleting it first revokes the token the rest authenticate
     with, and orphans every row with nobody left who can name them */
  ok('and the login goes last, after the rows it authorises',
     at('/admin/users') === Math.max(at('/sheets'), at('/usage'), at('/profiles'), at('/admin/users')),
     dels);
  ok('every delete is scoped to one uid — never a bare table',
     dels.every(u => /uid=eq\.|id=eq\.|admin\/users\/[^/?]+$/.test(u)), dels);
}

/* ── 3 · a refusal is a refusal, not a shrug ───────────────────────────────*/
{
  seen.length = 0; refuse = '/rest/v1/sheets';
  const r = await call('token-abc');
  ok('a partial failure does NOT report success', r.body && r.body.ok === false, r);
  ok('and it names what survived', !!(r.body && /sheets/.test(String(r.body.say))), r.body);
  ok('and it points somewhere a person can actually go',
     !!(r.body && /support@negotiationinc\.com/.test(String(r.body.say))), r.body);
  refuse = null;
}
srv.kill(); stub.close();

/* ── 4 · the browser half: ask first, clear second ─────────────────────────*/
{
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await pg.goto('file:///home/claude/dist/office.html'); await pg.waitForTimeout(1000);

  const shape = await pg.evaluate(() => ({
    async: typeof wipeAll === 'function' ? wipeAll.constructor.name : 'missing',
    local: typeof wipeLocal,
    route: /api\/account\/delete/.test(document.documentElement.innerHTML) }));
  ok('the button waits for an answer', shape.async === 'AsyncFunction', shape);
  ok('clearing the browser is its own step', shape.local === 'function', shape);
  ok('and it calls the route that does the deleting', shape.route, shape);

  /* the one that matters: a server that says no must leave the work alone */
  const held = await pg.evaluate(async () => {
    localStorage.setItem('ni-session-v1', JSON.stringify({ access_token:'t', refresh_token:'r',
      expires_at: Date.now() + 3600000, user:{ id:'u1' } }));
    localStorage.setItem('ni-desk-v3', JSON.stringify({ active:0, props:[{ id:'p1', name:'keep me' }] }));
    window.fetch = async () => ({ ok:false, status:500, json: async () => ({ ok:false, say:'nope' }) });
    let told = null; const out = await wipeAll(m => { told = m; });
    return { returned: out, sheetsStillHere: !!localStorage.getItem('ni-desk-v3'),
             stillSignedIn: !!localStorage.getItem('ni-session-v1'), told };
  });
  ok('a refused delete leaves the sheets on the machine', held.sheetsStillHere, held);
  ok('a refused delete leaves you signed in', held.stillSignedIn, held);
  ok('a refused delete returns false rather than pretending', held.returned === false, held);
  ok('and it tells you nothing was deleted anywhere',
     /nothing was deleted|nothing has been removed|Nothing is half-deleted/i.test(String(held.told)), held);
  ok('no page errors', !errs.length, errs[0]);
  await b.close();
}

/* ── 5 · and the privacy page still describes what happens ─────────────────*/
{
  const b = await chromium.launch();
  const pg = await b.newPage();
  await pg.goto('file:///home/claude/dist/privacy.html'); await pg.waitForTimeout(400);
  const t = await pg.evaluate(() => document.body.innerText);
  ok('the privacy page still promises deletion', /delete the account|delete them/i.test(t));
  await b.close();
}

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nall ${n} hold — the button asks the server, the server deletes all four in order, and a refusal is honest about it`);
process.exit(bad ? 1 : 0);
