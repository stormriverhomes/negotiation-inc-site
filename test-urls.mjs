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
  for (const f of fs.readdirSync(DIST).filter(f => /\.html$|^robots\.txt$|^sitemap\.xml$|^favicon\.ico$|^site\.webmanifest$|^priors\.js$/.test(f))){
    const to = path.join(HERE, f);
    if (!fs.existsSync(to)){ fs.copyFileSync(path.join(DIST, f), to); staged.push(to); }
  }
/* art/ too: the manifest names icons under it, and a manifest that lists a
   404 is a manifest that installs a broken home-screen tile. */
const ART = path.join(HERE, 'art');
let madeArt = false;
if (fs.existsSync(path.join(DIST, 'art'))){
  if (!fs.existsSync(ART)){ fs.mkdirSync(ART); madeArt = true; }
  for (const f of fs.readdirSync(path.join(DIST, 'art'))){
    const to = path.join(ART, f);
    if (!fs.existsSync(to)){ fs.copyFileSync(path.join(DIST, 'art', f), to); staged.push(to); }
  }
}
const unstage = () => { for (const f of staged) try { fs.unlinkSync(f); } catch(e){}
  if (madeArt) try { fs.rmdirSync(ART); } catch(e){} };
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
  const SECRET = ['server','billing','prompt','compare','street','bid','objections','intake'];
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
                   /* the .js rule is an ALLOWLIST of one now — priors.js, the only
                      script a page fetches. A module nobody remembered to add to a
                      blocklist is how compare.js shipped servable for a deploy and
                      how intake.js was servable the day it was written. */
                   '/anything-at-all.js','/a-new-module.js','/srv/compare.js',
                   '/.env','/SUPABASE.md'])
    check((await get(p)).s === 404, `${p} was served`);
  /* and the one that IS fetched still is, or every page loses its priors */
  check((await get('/priors.js')).s === 200, 'priors.js stopped being served — the pages fetch it');
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

/* ── 7 · THE PAGE NOBODY MEANS TO VISIT, AND THE TWO CRAWLERS ASK FOR ──────
   server.js has always tried to send 404.html and, until the file existed,
   always fell back to nine bytes of plain text on a white screen. And every
   URL on this site changed shape this week, so a sitemap naming the CLEAN
   address of each page is how a crawler learns which one is real. */
{
  const nf = await fetch(base + '/not-a-page');
  const body = await nf.text();
  out.notfound = { status: nf.status, bytes: body.length,
                   type: (nf.headers.get('content-type') || '').split(';')[0] };
  check(nf.status === 404, `a missing page answered ${nf.status}`);
  check(/text\/html/.test(out.notfound.type),
    `the 404 came back as ${out.notfound.type} — a mistyped address gets plain text`);
  check(body.length > 1500, `the 404 body is ${body.length} bytes — that is the bare fallback, not a page`);
  check(/NEGOTIATION/.test(body), 'the 404 does not carry the masthead, so it reads as broken hosting');
  check(/href="\/desk"/.test(body), 'the 404 offers no way back to the desk');
  check(/name="robots" content="noindex"/.test(body), 'the 404 page is indexable');
  /* it says the address back, and it must never do that as MARKUP — a 404
     that writes location.pathname with innerHTML is reflected XSS on the one
     page nobody reviews. The check is on ASSIGNMENT, not on the word: the
     page's own comment explains why it uses textContent, and an assertion
     that fires on prose about the bug is an assertion you learn to skip. */
  check(/textContent\s*=/.test(body), 'the 404 does not use textContent to say the address back');
  check(!/innerHTML\s*=/.test(body), 'the 404 writes the requested path into the DOM as markup');

  /* /favicon.ico is asked for BY NAME, with no link tag, by browsers and by
     every link-preview crawler. It has to be at the root or it is a 404 in
     somebody's log forever — which is exactly what it was. */
  const fav = await get('/favicon.ico');
  out.favicon = fav.s;
  check(fav.s === 200, `/favicon.ico answered ${fav.s}`);
  const man = await fetch(base + '/site.webmanifest');
  out.manifest = man.status;
  check(man.status === 200, `/site.webmanifest answered ${man.status}`);
  const mj = await man.json().catch(() => null);
  check(mj && Array.isArray(mj.icons) && mj.icons.length >= 2, 'the manifest names no icons');
  /* manifest srcs are relative to the manifest, which sits at the root — so
     they need the leading slash putting back before they are a path */
  for (const ic of (mj && mj.icons) || []){
    const at = ic.src.startsWith('/') ? ic.src : '/' + ic.src;
    check((await get(at)).s === 200, `the manifest names ${ic.src} and it 404s`);
  }
  /* and every page carries the set, not just the ones somebody remembered */
  for (const p2 of ['/', '/desk', '/plans', '/office', '/arcade']){
    const h = await (await fetch(base + p2)).text();
    check(/rel="icon" href="(\.\.\/)?favicon\.ico"/.test(h), `${p2} does not point at favicon.ico`);
    check(/rel="apple-touch-icon"/.test(h), `${p2} has no touch icon`);
  }

  const rb = await fetch(base + '/robots.txt');
  const rbody = await rb.text();
  out.robots = { status: rb.status };
  check(rb.status === 200, `robots.txt answered ${rb.status}`);
  check(/Sitemap:\s*https?:\/\/\S+\/sitemap\.xml/.test(rbody), 'robots.txt does not name the sitemap');

  const sm = await fetch(base + '/sitemap.xml');
  const xml = await sm.text();
  out.sitemap = { status: sm.status, urls: (xml.match(/<loc>/g) || []).length };
  check(sm.status === 200, `sitemap.xml answered ${sm.status}`);
  check(out.sitemap.urls >= 10, `the sitemap lists ${out.sitemap.urls} pages`);
  /* a sitemap that lists a dead page is worse than no sitemap, and one that
     lists the .html form teaches the crawler the address we just retired */
  check(!/\.html<\/loc>/.test(xml), 'the sitemap lists .html addresses — the ones that redirect');
  check(!/office<\/loc>|404/.test(xml), 'the sitemap lists a page behind a sign-in, or the 404 itself');
  for (const m of xml.matchAll(/<loc>[^<]*?\/([^<\/]*)<\/loc>/g)){
    const p = m[1] ? '/' + m[1] : '/';
    const r = await get(p);
    check(r.s === 200, `the sitemap lists ${p} and it answers ${r.s}`);
  }
}

srv.close();
console.log(JSON.stringify(out, null, 1));
if (bad.length){ console.log('FAIL'); bad.forEach(b => console.log(' - ' + b)); process.exit(1); }
console.log(`PASS — ${PAGES.length} pages, each on exactly one URL, with .html permanently `
  + 'redirected, the query string carried across, the source allowlist still closed, a real 404 '
  + `for a mistyped address, and a sitemap of ${out.sitemap.urls} pages that every one of them answers`);
