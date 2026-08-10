/* _tsync — THE SECOND DEVICE MUST NOT EAT THE FIRST DEVICE'S WORK.

   The production audit reproduced this end to end and it is the only defect
   found that destroys a customer's work rather than costing money or looking
   wrong:

     save() stamped `updated = Date.now()` unconditionally. renderCore() ends
     in save(). boot() reaches renderCore(). So LOADING THE PAGE re-stamped the
     active sheet to now — and mergeSheets() keeps the remote row only if it is
     strictly newer, which "now" never is. The stale copy then won the merge
     AND was pushed over the server row, silently.

   Every assertion here drives the REAL desk through the REAL UI against a stub
   Supabase that stores sheet rows the way the real one does. No internals are
   called directly: if the fix only works when a test pokes it, it does not
   work. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';

const OUT = 'dist-tsync-' + process.pid;
const OUT_ABS = '/home/claude/' + OUT;
process.on('exit', () => { try { fs.rmSync(OUT_ABS, {recursive:true, force:true}); } catch(e){} });

const bad = [], out = {};
const SB_STUB_KEY = 'sb_publishable_tsync_stub_not_a_real_key';

/* ══ stub Supabase: the sheets table, keyed on pid, last write wins ══════ */
let SHEETS = new Map();                       // pid -> {pid, updated, blob, uid}
let PULL_FAILS = false;                       // make the GET answer 500
let PUSHES = 0;
const j = (res, code, o) => { res.writeHead(code, {'content-type':'application/json',
  'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'});
  res.end(JSON.stringify(o)); };

const sb = http.createServer((req, res) => {
  let b=''; req.on('data',d=>b+=d); req.on('end',()=>{
    if (req.method === 'OPTIONS') return j(res,200,{});
    const u = new URL(req.url,'http://x');
    const body = (()=>{ try{ return JSON.parse(b||'{}'); }catch(e){ return {}; } })();
    const sess = (email) => ({ access_token:'at-'+email, refresh_token:'rt-'+email,
      expires_in:3600, user:{ id:'u-1', email, user_metadata:{name:'Elijah'} } });
    if (u.pathname === '/auth/v1/signup') return j(res,200,sess(body.email));
    if (u.pathname === '/auth/v1/token'){
      if (u.searchParams.get('grant_type')==='refresh_token') return j(res,200,sess('e@x.com'));
      return j(res,200,sess(body.email||'e@x.com'));
    }
    if (u.pathname === '/rest/v1/profiles'){
      if (req.method === 'PATCH') return j(res,204,{});
      return j(res,200,[{ name:'Elijah', market:'30310', plan:null, trial:null }]);
    }
    if (u.pathname === '/rest/v1/sheets'){
      if (req.method === 'GET'){
        if (PULL_FAILS){ res.writeHead(500); return res.end('{}'); }
        return j(res,200,[...SHEETS.values()]);
      }
      if (req.method === 'POST'){
        PUSHES++;
        for (const row of (Array.isArray(body)?body:[body])) SHEETS.set(row.pid, row);
        return j(res,201,{});
      }
      if (req.method === 'DELETE') return j(res,204,{});
    }
    j(res,200,{});
  });
});

/* ══ stub site ══════════════════════════════════════════════════════════ */
const site = http.createServer((req,res)=>{
  const u = new URL(req.url,'http://x');
  if (u.pathname.startsWith('/api/')) return j(res,200,{ ok:true, accounts:false });
  let p = u.pathname === '/' ? '/desk.html' : u.pathname;
  if (!path.extname(p)) p += '.html';
  const f = OUT_ABS + p;
  if (fs.existsSync(f) && fs.statSync(f).isFile()){
    const e = path.extname(f);
    res.writeHead(200,{'content-type': e==='.js'?'text/javascript':'text/html'});
    return res.end(fs.readFileSync(f));
  }
  res.writeHead(404); res.end('no');
});
const listen = s => new Promise(r => s.listen(0,'127.0.0.1',()=>r(s.address().port)));
const sbPort = await listen(sb), sitePort = await listen(site);
const BASE = `http://127.0.0.1:${sitePort}`;

execFileSync('node', ['publish.mjs'], { cwd:'/home/claude', stdio:'ignore',
  env: { ...process.env, OUT, NI_ALLOW_LOCAL_SB:'1',
         NI_SUPABASE_URL:`http://127.0.0.1:${sbPort}`, NI_SUPABASE_ANON:SB_STUB_KEY } });

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });

/* a signed-in browser: the session the real door would have left behind */
const device = async (label) => {
  const ctx = await b.newContext();
  await ctx.addInitScript(`try{
    localStorage.setItem('ni-session-v1', JSON.stringify({access_token:'at-e@x.com',
      refresh_token:'rt-e@x.com', expires_at: Date.now()+3.6e6, user:{id:'u-1', email:'e@x.com'}}));
    localStorage.setItem('ni-account-v1', JSON.stringify({name:'Elijah', email:'e@x.com',
      market:'30310', plan:null, trial:null}));
  }catch(e){}`);
  const p = await ctx.newPage();
  p.on('pageerror', e => { out.errs = out.errs || []; out.errs.push(label + ': ' + e.message.slice(0,110)); });
  return { ctx, p };
};
/* the desk renders each field into its own step container and hides the steps
   you are not on, so Playwright's fill() blocks on visibility for anything off
   the current step. Setting the value and firing the real input/change events
   runs the same handlers the same way — this harness is about the sync, not
   about the mouse. */
const typeInto = async (p, id, v) => p.evaluate(([id,v]) => {
  const el = document.getElementById(id); if (!el) return false;
  el.value = String(v);
  el.dispatchEvent(new Event('input',  { bubbles:true }));
  el.dispatchEvent(new Event('change', { bubbles:true }));
  return true;
}, [id, String(v)]);
/* the desk commits a typed figure as a formatted string — 412000 becomes
   "412,000" on blur — so every comparison here is on digits only */
const digits = v => (v==null?null:String(v).replace(/[^0-9.]/g,''));
const val=(blob,k)=>{ const x=blob&&blob.f&&blob.f[k]; if(x==null)return null;
  return digits((typeof x==='object')?(x.v??''):x); };
const serverRow = (pid) => { const r = pid ? SHEETS.get(pid) : [...SHEETS.values()][0];
  return r ? { pid:r.pid, updated:r.updated, arv:val(r.blob,'arv'), rep:val(r.blob,'repairs') } : null; };

/* ══ A · THE LAPTOP DOES FORTY MINUTES ═══════════════════════════════════ */
{
  const L = await device('laptop');
  await L.p.goto(BASE + '/desk.html'); await L.p.waitForTimeout(1600);
  await typeInto(L.p, 'addr', '142 Marigold Lane, Atlanta GA 30310');
  await typeInto(L.p, 'fi-asking', '184500');
  await typeInto(L.p, 'fi-arv', '412000');
  await typeInto(L.p, 'fi-repairs', '96500');
  /* syncSoon() debounces the push by 4000ms — every wait here has to clear it */
  await L.p.waitForTimeout(5200);
  out.A_server = serverRow();
  if (!out.A_server || out.A_server.arv !== '412000')
    bad.push('A: the laptop never got its work to the server, so nothing below can mean anything');
  await L.ctx.close();
}

/* ══ B · THE PHONE OPENS THE DESK AND TOUCHES NOTHING ════════════════════
   It holds an OLDER copy of the same property. This is the whole bug: no
   typing, no clicking, just a page load. */
{
  const P = await device('phone');
  /* the phone's stale workspace: same pid, older content, older timestamp */
  const stale = { active:0, mode:'simple', adv:null, props:[{
    id: out.A_server.pid, name:'142 Marigold Lane', addr:'142 Marigold Lane, Atlanta GA 30310',
    updated: Date.parse('2026-08-01T09:00:00Z'),
    f:{ asking:{v:'184500'}, arv:{v:'340000'}, repairs:{v:'48000'} },
    raw:{ asking:'184500', arv:'340000', repairs:'48000' },
    est:{}, prov:{}, unc:{}, sys:{}, comps:[], subj:{}, compAdj:{}, src:{} }] };
  await P.ctx.addInitScript(`try{ localStorage.setItem('ni-desk-v3', ${JSON.stringify(JSON.stringify(stale))}); }catch(e){}`);
  const p2 = await P.ctx.newPage();
  await p2.goto(BASE + '/desk.html'); await p2.waitForTimeout(5600);

  out.B_server = serverRow(out.A_server.pid);
  out.B_shown  = await p2.evaluate(() => {
    const g = id => { const el = document.getElementById(id); return el ? el.value : null; };
    const d=v=>(v==null?null:String(v).replace(/[^0-9.]/g,''));
    return { arv: d(g('fi-arv')), repairs: d(g('fi-repairs')) };
  });

  if (out.B_server && out.B_server.arv === '340000')
    bad.push('B: A DEVICE THAT WAS ONLY OPENED OVERWROTE FORTY MINUTES OF WORK ON ANOTHER DEVICE '
           + '— the server now holds the stale copy and nothing was shown');
  if (!out.B_server || out.B_server.arv !== '412000')
    bad.push('B: the server no longer holds the newer work after the second device opened');
  if (out.B_shown.arv !== '412000')
    bad.push('B: the second device did not PULL the newer sheet — it is showing the stale one ('
           + out.B_shown.arv + ')');
  await P.ctx.close();
}

/* ══ C · AND A REAL EDIT ON THE SECOND DEVICE STILL WINS ═════════════════
   The fix must not go too far the other way: if the stamp stopped moving at
   all, every edit after the first would be silently discarded instead, which
   is the same bug pointing the other way.

   The device is seeded with the SAME pid already in sync — a phone that has
   caught up — because a device with no workspace at all creates a blank
   starter sheet, the pull adds the server's sheet beside it, and P.active
   stays on the blank one. That is correct product behaviour and it made the
   first draft of this section edit the wrong sheet. */
{
  const pid = out.A_server.pid;
  const P = await device('phone-2');
  const synced = { active:0, mode:'simple', adv:null, props:[{
    id: pid, name:'142 Marigold Lane', addr:'142 Marigold Lane, Atlanta GA 30310',
    updated: Date.parse(out.B_server.updated),
    f:{ asking:{v:'184500'}, arv:{v:'412000'}, repairs:{v:'96500'} },
    raw:{ asking:'184500', arv:'412000', repairs:'96500' },
    est:{}, prov:{}, unc:{}, sys:{}, comps:[], subj:{}, compAdj:{}, src:{} }] };
  await P.ctx.addInitScript(`try{ localStorage.setItem('ni-desk-v3', ${JSON.stringify(JSON.stringify(synced))}); }catch(e){}`);
  const p3 = await P.ctx.newPage();
  await p3.goto(BASE + '/desk.html'); await p3.waitForTimeout(5600);
  await typeInto(p3, 'fi-repairs', '73250');
  await p3.waitForTimeout(5600);
  out.C_server = serverRow(pid);
  if (!out.C_server || out.C_server.rep !== '73250')
    bad.push('C: a REAL edit on the second device did not reach the server ('
           + (out.C_server && out.C_server.rep) + ') — the stamp stopped moving entirely');
  if (out.C_server && out.C_server.arv !== '412000')
    bad.push('C: editing one field discarded the other fields on the sheet');
  await P.ctx.close();
}

/* ══ D · A FAILED PULL MUST NOT PUSH ═════════════════════════════════════
   pushLocal() sat outside the `if (remote)` block, so one 500 on the sheets
   GET let a stale browser upsert its whole workspace over newer server rows. */
{
  const before = serverRow();
  PULL_FAILS = true; PUSHES = 0;
  const P = await device('offline-ish');
  const stale = { active:0, mode:'simple', adv:null, props:[{
    id: before.pid, name:'142 Marigold Lane', addr:'142 Marigold Lane',
    updated: Date.parse('2026-07-01T09:00:00Z'),
    f:{ asking:{v:'1'}, arv:{v:'1'}, repairs:{v:'1'} }, raw:{ asking:'1', arv:'1', repairs:'1' },
    est:{}, prov:{}, unc:{}, sys:{}, comps:[], subj:{}, compAdj:{}, src:{} }] };
  await P.ctx.addInitScript(`try{ localStorage.setItem('ni-desk-v3', ${JSON.stringify(JSON.stringify(stale))}); }catch(e){}`);
  const p2 = await P.ctx.newPage();
  await p2.goto(BASE + '/desk.html'); await p2.waitForTimeout(5600);
  out.D_pushes = PUSHES;
  out.D_server = serverRow(before.pid);
  PULL_FAILS = false;
  if (out.D_server && out.D_server.arv === '1')
    bad.push('D: A FAILED PULL STILL PUSHED — a stale browser overwrote the server because the '
           + 'sheets GET returned 500');
  if (out.D_pushes !== 0)
    bad.push(`D: ${out.D_pushes} push(es) went out after a failed pull; it must be none`);
  await P.ctx.close();
}

await b.close(); sb.close(); site.close();
console.log(JSON.stringify(out, null, 1));
if (out.errs && out.errs.length) bad.push('page errors: ' + out.errs[0]);
if (bad.length){ console.log('FAIL'); bad.forEach(x => console.log(' - ' + x)); process.exit(1); }
console.log('PASS — opening the desk on a second device does not overwrite the first device\'s work, '
  + 'a real edit still wins, and a failed pull never pushes');
