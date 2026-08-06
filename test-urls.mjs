/* ONE URL PER PAGE, AND IT HAS NO .html ON THE END.
   A routing change is the kind that breaks quietly: everything still 200s,
   and one page in fourteen is a 404 nobody clicks until launch week. So every
   page the site ships is asked for by BOTH names, and the allowlist that made
   this necessary is re-checked from the other side — because widening a gate
   to let clean URLs through is exactly how a gate stops holding. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const bad = [], out = {};
const check = (c, m) => { if (!c) bad.push(m); };

/* ── stage the built pages beside the server, as the repo has them ─────────
   In the repo the server and the pages are the same flat directory, which is
   what express.static serves. In this working tree the pages live in dist/.
   So they are copied in for the run and taken out again — the harness must
   not depend on somebody having remembered to copy them, and must not leave
   fourteen files behind for the next `git status` to be confusing about. */
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.join(HERE, '..', 'dist');
const staged = [];
if (fs.existsSync(DIST))
  for (const f of fs.readdirSync(DIST).filter(f => /\.html$/.test(f))){
    const to = path.join(HERE, f);
    if (!fs.existsSync(to)){ fs.copyFileSync(path.join(DIST, f), to); staged.push(to); }
  }
const unstage = () => { for (const f of staged) try { fs.unlinkSync(f); } catch(e){} };
process.on('exit', unstage);

process.env.NI_NO_LISTEN = '1';
const { default: app } = await import('./server.js?urls=' + Math.random());
const srv = app.listen(0);
const port = srv.address().port;
const base = `http://127.0.0.1:${port}`;

/* never follow a redirect: the whole point is WHICH answer comes back */
const get = async (p) => {
  const r = await fetch(base + p, { redirect: 'manual' });
  return { s: r.status, loc: r.headers.get('location'), type: r.headers.get('content-type') || '' };
};

/* the pages that actually exist next to the server, so this cannot pass by
   testing a list that has drifted from the directory */
const PAGES = fs.readdirSync(path.dirname(new URL(import.meta.url).pathname))
  .filter(f => /\.html$/.test(f) && f !== '404.html')
  .map(f => f.replace(/\.html$/, ''))
  .sort();
out.pages = PAGES;
check(PAGES.length >= 3, `no pages found next to the server — ${PAGES.length}`);

/* ── 1 · the clean name serves the page ─────────────────────────────────── */
for (const p of PAGES){
  const clean = p === 'index' ? '/' : '/' + p;
  const r = await get(clean);
  check(r.s === 200, `${clean} answered ${r.s}, not 200 — a clean URL that 404s is a dead page`);
  check(/text\/html/.test(r.type), `${clean} came back as ${r.type}, not html`);
}

/* ── 2 · and the .html name permanently redirects to it ─────────────────── */
for (const p of PAGES){
  const r = await get('/' + p + '.html');
  const want = p === 'index' ? '/' : '/' + p;
  check(r.s === 301, `/${p}.html answered ${r.s}, not 301 — two live URLs for one page`);
  check(r.loc === want, `/${p}.html redirects to ${r.loc}, not ${want}`);
}

/* ── 3 · the query string survives the redirect ─────────────────────────────
   The arcade hands the desk a whole house in a query string. A redirect that
   drops it turns a handoff into an empty sheet, and the player has no idea
   what they lost. */
{
  const q = '?arv=200000&repairs=30%2C000&from=arcade&title=Exit%20Drill';
  const r = await get('/desk.html' + q);
  out.handoff = r.loc;
  check(r.loc === '/desk' + q, `the handoff query was mangled: ${r.loc}`);
  const r2 = await get('/office.html?paid=1');
  check(r2.loc === '/office?paid=1', `Stripe's return URL loses its flag: ${r2.loc}`);
}

/* ── 4 · WIDENING THE GATE DID NOT OPEN IT ──────────────────────────────────
   The allowlist used to refuse anything without a known extension, which is
   what 404'd every clean URL. Letting extensionless names through is only
   safe because `extensions:['html']` can APPEND .html and nothing else — so
   /server looks for server.html and finds nothing. That is a property of the
   static handler, not of an intention, and it gets checked. */
{
  const SECRET = ['server','billing','prompt','compare','street','bid','objections'];
  out.secrets = {};
  for (const n of SECRET){
    const js    = await get('/' + n + '.js');
    const clean = await get('/' + n);
    out.secrets[n] = [js.s, clean.s];
    check(js.s === 404, `/${n}.js answered ${js.s} — the service is serving its own source`);
    check(clean.s === 404,
      `/${n} answered ${clean.s} — the clean-URL gate reached a server file`);
  }
  /* and the rest of the allowlist still holds. Every .mjs is here because no
     shipped page loads a module, so the extension is off the ALLOW list — the
     block list naming each tool by hand is what let test-urls.mjs be servable
     the day it was written. */
  for (const p of ['/package.json','/render.yaml','/publish.mjs','/test-api.mjs','/test-pay.mjs',
                   '/test-urls.mjs','/suite2.mjs','/_tbank.mjs','/anything-at-all.mjs',
                   '/.env','/SUPABASE.md','/srv/compare.js'])
    check((await get(p)).s === 404, `${p} was served`);
  check((await get('/../server.js')).s >= 400, 'a traversal was served');
}

/* ── 5 · a name that is not a page is still a 404, not a redirect loop ───── */
{
  const r = await get('/not-a-page');
  out.missing = r.s;
  check(r.s === 404, `/not-a-page answered ${r.s}`);
  const h = await get('/not-a-page.html');
  check(h.s === 301 && h.loc === '/not-a-page',
    'a missing page does not redirect to its clean form, so the 404 differs by URL shape');
  const api = await get('/api/nope');
  check(api.s === 404, `/api/nope answered ${api.s}`);
}

/* ── 6 · assets are untouched ───────────────────────────────────────────────
   art/door-now.png must not acquire opinions about extensions. */
{
  for (const a of ['/art/door-now.png'])
    if (fs.existsSync(path.join(path.dirname(new URL(import.meta.url).pathname), a.slice(1))))
      check((await get(a)).s === 200, `${a} stopped being served`);
}

srv.close();
console.log(JSON.stringify(out, null, 1));
if (bad.length){ console.log('FAIL'); bad.forEach(b => console.log(' - ' + b)); process.exit(1); }
console.log(`PASS — ${PAGES.length} pages, each on exactly one URL, with .html permanently `
  + 'redirected, the query string carried across, and the source allowlist still closed');
