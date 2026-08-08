/* ── THE ACCOUNT LAYER WAS DEAD ON THE LIVE SITE AND NOTHING SAID SO ───────
   Found in a browser, on the second page of a walk-through, by asking the
   live page what it thought it had:

     NI_SUPABASE_URL   MISSING
     NI_SUPABASE_ANON  MISSING
     __authOn()        false

   Both values were written into every page at BUILD time. The build runs
   wherever the build runs, and that is not the machine holding the
   configuration — so the SERVER had Supabase and demanded an account for
   every paid feature, while the pages it served had no way to make one. The
   door fell back to a local-only workspace with no password, no sign-in and
   no sync, and looked entirely normal. Anybody who signed up got a browser
   record and believed they had an account.

   That is the worst shape a bug can take: a promise the product keeps making
   in words, with the machinery quietly absent, and no error anywhere.

   THE FIX IS ARCHITECTURAL. The pages ask the server, which is the process
   that actually holds the values. A build-time secret is a secret that has to
   be present in a second place nobody thinks about, and its failure mode is
   silence. Now a rebuild cannot strip the account layer, and there is no
   second place to remember.

   Four things are asserted, and the fourth is the one that keeps it honest:
     · the route serves both PUBLIC values when they are configured
     · it says accounts are off, rather than half-on, when they are not
     · it REFUSES to serve a service key that has been put in the anon slot —
       that key bypasses every row-level policy, and this route would hand it
       to every browser on the site
     · the page ends up with a working account layer having been given
       NOTHING at build time, which is the exact condition that shipped */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

let n = 0, bad = 0;
const ok = (t, p, x) => { n++; if (!p){ bad++; console.log('✗ ' + t + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0,240) : '')); } else console.log('✓ ' + t); };

const boot = (env) => {
  const port = 3940 + Math.floor(Math.random() * 40);
  const p = spawn('node', ['server.js'], { cwd:'/home/claude/srv', stdio:'ignore',
    env:{ ...process.env, PORT:String(port), NI_MOCK:'1', ...env } });
  return { p, B:`http://127.0.0.1:${port}` };
};
const wait = async (B) => { for (let i=0;i<60;i++){
  try { const r = await fetch(B + '/api/health'); if (r.ok) return true; } catch(e){}
  await new Promise(r => setTimeout(r, 250)); } return false; };

/* ── 1 · configured ────────────────────────────────────────────────────────*/
{
  const { p, B } = boot({ SUPABASE_URL:'https://demo.supabase.co',
    SUPABASE_ANON_KEY:'sb_publishable_abcdefgh', SUPABASE_SERVICE_KEY:'sb_secret_never_leaves' });
  await wait(B);
  const d = await fetch(B + '/api/config').then(r => r.json());
  ok('a configured deployment says accounts are on', d.accounts === true, d);
  ok('and hands over the URL', d.supabaseUrl === 'https://demo.supabase.co', d);
  ok('and the PUBLIC key', d.supabaseAnon === 'sb_publishable_abcdefgh', d);
  /* the one that must never be in this response */
  ok('and never the service key', !JSON.stringify(d).includes('sb_secret_never_leaves'), d);
  p.kill();
}

/* ── 2 · unconfigured says so, rather than half-answering ──────────────────*/
{
  const { p, B } = boot({ SUPABASE_URL:'', SUPABASE_ANON_KEY:'' });
  await wait(B);
  const d = await fetch(B + '/api/config').then(r => r.json());
  ok('an unconfigured deployment says accounts are off', d.accounts === false, d);
  ok('and offers no half-configuration to act on', !d.supabaseUrl && !d.supabaseAnon, d);
  p.kill();
}

/* ── 3 · a service key in the anon slot is refused, not forwarded ──────────
   That key bypasses every row-level policy. This route would hand it to every
   browser that loads the site, so it is the last place it can be caught. */
{
  for (const key of ['sb_secret_oops', 'service_role_key_pasted_here']){
    const { p, B } = boot({ SUPABASE_URL:'https://demo.supabase.co', SUPABASE_ANON_KEY:key });
    await wait(B);
    const d = await fetch(B + '/api/config').then(r => r.json());
    ok(`a ${key.split('_')[0]}_ key in the anon slot is refused`, d.accounts === false, d);
    ok('  and the key itself is not in the reply', !JSON.stringify(d).includes(key), d);
    ok('  and it says why', /service/i.test(String(d.why || '')), d);
    p.kill();
  }
}

/* ── 4 · the page ends up with a working account layer from a build that was
   given nothing — which is exactly the build that shipped ─────────────────*/
{
  /* built with NO NI_SUPABASE_* at all, deliberately */
  const OUT = 'dist-cfg';
  const { execFileSync } = await import('node:child_process');
  execFileSync('node', ['publish.mjs'], { cwd:'/home/claude', stdio:'ignore',
    env:{ ...process.env, OUT, NI_SUPABASE_URL:'', NI_SUPABASE_ANON:'' } });

  const site = http.createServer((q, r) => {
    if (q.url.startsWith('/api/config')){
      r.writeHead(200, {'content-type':'application/json'});
      return r.end(JSON.stringify(CFG));
    }
    if (q.url.startsWith('/api/')){ r.writeHead(200, {'content-type':'application/json'}); return r.end('{"ok":true}'); }
    const f = path.join('/home/claude/' + OUT, q.url === '/' ? 'index.html' : q.url.split('?')[0].split('#')[0]);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()){ r.writeHead(404); return r.end('no'); }
    r.writeHead(200, {'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream'});
    fs.createReadStream(f).pipe(r);
  });
  let CFG = {};
  const port = await new Promise(r => site.listen(0, '127.0.0.1', () => r(site.address().port)));
  const b = await chromium.launch();

  const look = async (cfg) => {
    CFG = cfg;
    const pg = await b.newPage({ viewport:{ width:1240, height:1000 } });
    const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0,160)));
    await pg.goto(`http://127.0.0.1:${port}/office.html`);
    await pg.waitForTimeout(1400);
    const out = await pg.evaluate(() => ({
      baked: !!(window.NI_SUPABASE_URL || window.NI_SUPABASE_ANON),
      on: typeof window.__authOn === 'function' ? window.__authOn() : null,
      tabs: (document.getElementById('g-tabs') || {}).hidden,
      tabsPainted: (() => { const t = document.getElementById('g-tabs');
        return t ? getComputedStyle(t).display !== 'none' : false; })(),
      pw: (document.getElementById('g-pwwrap') || {}).hidden,
      fine: ((document.getElementById('g-fine') || {}).innerText || '').slice(0, 200),
    }));
    out.errs = errs; await pg.close(); return out;
  };

  const on = await look({ ok:true, accounts:true,
    supabaseUrl:'https://demo.supabase.co', supabaseAnon:'sb_publishable_abcdefgh' });
  ok('the build was given nothing', on.baked === false, on);
  ok('and the page still ends up with accounts ON', on.on === true, on);
  ok('and shows the password field', on.pw === false, on);
  ok('and shows both doors', on.tabs === false && on.tabsPainted === true, on);
  ok('and stops claiming there is no password to lose',
     !/no password to lose/i.test(on.fine), on.fine);

  const off = await look({ ok:true, accounts:false });
  ok('a deployment with no accounts still opens the local door', off.on === false, off);
  ok('and hides the password field', off.pw === true, off);
  /* the bug that made the dead state look alive: `hidden` is an attribute
     that sets display:none, and a later rule of equal specificity beats it.
     .gtabs{display:grid} did exactly that, so a build with ONE door showed
     two tabs and "Sign in" did nothing. */
  ok('and the tab strip is not merely marked hidden but actually hidden',
     off.tabs === true && off.tabsPainted === false, off);
  ok('no page errors in either state', !on.errs.length && !off.errs.length, on.errs[0] || off.errs[0]);

  await b.close(); site.close();
  try { fs.rmSync('/home/claude/' + OUT, { recursive:true, force:true }); } catch(e){}
}

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nall ${n} hold — the pages ask the process that holds the configuration, a service key in the anon slot is refused, and a hidden control is actually hidden`);
process.exit(bad ? 1 : 0);
