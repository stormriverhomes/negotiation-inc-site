/* auth, against a stub Supabase — the whole flow without a project */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs'; import path from 'node:path';

const bad=[]; const out={};
const ck=(c,m)=>{ if(!c) bad.push(m); };
/* ── the stub: GoTrue + PostgREST, enough of them to be real ───────────── */
const DB = { profiles:[{ id:'u1', name:'Elijah Payne', market:'Atlanta, GA 30310', plan:'the office', trial:null }],
             sheets:[{ pid:'remote1', updated:'2026-08-03T12:00:00.000Z',
                       blob:{ id:'remote1', name:'From the phone', addr:'9 Phone Street', updated: Date.parse('2026-08-03T12:00:00Z'),
                              raw:{asking:'1'}, est:{},prov:{},unc:{},sys:{},comps:[],subj:{},compAdj:{},sit:'unknown' } }] };
const seen = [];
const sb = http.createServer((q,r)=>{
  /*__API_STUB__*/ /* a static directory is a deployment with no accounts configured, and saying
     so is the honest answer to /api/config — a 404 is a console error the page
     cannot suppress and the harness cannot tell from a real one */
  if (/^\/api\//.test(q.url)){ r.writeHead(200, {'content-type':'application/json'});
    return r.end(JSON.stringify({ ok:true, accounts:false })); }

  let body=''; q.on('data',c=>body+=c);
  q.on('end',()=>{
    seen.push({m:q.method,u:q.url,auth:q.headers.authorization,body});
    const j=(o,code=200)=>{ r.writeHead(code,{'content-type':'application/json','access-control-allow-origin':'*'}); r.end(JSON.stringify(o)); };
    if (q.method==='OPTIONS'){ r.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}); return r.end(); }
    if (q.url.startsWith('/auth/v1/signup')){
      const b=JSON.parse(body||'{}');
      if (/taken@/.test(b.email)) return j({msg:'User already registered'},400);
      return j({access_token:'tok1',refresh_token:'ref1',expires_in:3600,user:{id:'u1',email:b.email}});
    }
    if (q.url.startsWith('/auth/v1/token')){
      const b=JSON.parse(body||'{}');
      if (b.password==='wrongpass') return j({msg:'Invalid login credentials'},400);
      return j({access_token:'tok1',refresh_token:'ref1',expires_in:3600,user:{id:'u1',email:b.email||'e@x.co'}});
    }
    if (q.url.startsWith('/auth/v1/logout')) return j({});
    if (q.url.startsWith('/rest/v1/profiles')){
      if (q.method==='PATCH'){ Object.assign(DB.profiles[0], JSON.parse(body||'{}')); return j({}); }
      return j(DB.profiles);
    }
    /* the weekly comp allowance. Added when the free account stopped being a
       rung that bought nothing: without this the stub 404s, the page logs a
       console error, and this harness fails for a reason that has nothing to
       do with auth. Answering it also proves the boot path picks the balance
       up before the desk draws the comp button. */
    if (q.url.startsWith('/rest/v1/rpc/ni_use_comps')){
      const b=JSON.parse(body||'{}');
      DB.compUsed = (DB.compUsed||0) + (b.n|0);
      return j([{ used:DB.compUsed, cap:12, remaining:Math.max(0,12-DB.compUsed) }]);
    }
    if (q.url.startsWith('/rest/v1/sheets')){
      if (q.method==='POST'){ JSON.parse(body||'[]').forEach(row=>{
        const i=DB.sheets.findIndex(x=>x.pid===row.pid);
        if(i>=0) DB.sheets[i]=row; else DB.sheets.push(row); }); return j({},201); }
      return j(DB.sheets);
    }
    j({},404);
  });
}).listen(0);
const SBURL='http://127.0.0.1:'+sb.address().port;

/* serve dist with the config injected, so the page thinks it is configured */
const MIME={'.html':'text/html','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.svg':'image/svg+xml'};
const site=http.createServer((q,r)=>{
  let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('');}
  let d=fs.readFileSync(f);
  if(f.endsWith('.html')){
    /* the stage flag is `false` before launch and `true` after, and this
       matched only the pre-launch spelling — so against a live build the
       replace silently missed, Supabase was never injected, __authOn() went
       false, and the password field this harness exists to test stayed
       hidden. A harness that hard-codes one stage can only audit one stage. */
    d=d.toString().replace(/window\.NI_LIVE=(?:true|false);/,
      m => `${m}window.NI_SUPABASE_URL=${JSON.stringify(SBURL)};window.NI_SUPABASE_ANON="anon";`);
  }
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  r.end(d);
}).listen(0);
const B='http://127.0.0.1:'+site.address().port;

const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1280,height:1000}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
p.on('console',m=>{if(m.type()==='error'&&!/fraunces|ERR_FAILED|favicon/.test(m.text()))errs.push(m.text())});

/* ── A · the door signs you up against the server ───────────────────────── */
await p.goto(B+'/office.html'); await p.evaluate(()=>localStorage.clear());
await p.goto(B+'/office.html'); await p.waitForTimeout(700);
out.A_pw = await p.evaluate(()=>({ shown: !document.getElementById('g-pwwrap').hidden,
  authOn: !!(window.__authOn && window.__authOn()) }));
ck(out.A_pw.shown, 'A: the password field is hidden even though a server is configured');
ck(out.A_pw.authOn, 'A: the page does not think auth is on');
await p.fill('#g-name','Elijah Payne'); await p.fill('#g-email','e@x.co'); await p.fill('#g-pw','hunter22');
await p.click('#g-go'); await p.waitForTimeout(1400);
out.A_after = await p.evaluate(()=>({ sess: !!JSON.parse(localStorage.getItem('ni-session-v1')||'null'),
  acct: JSON.parse(localStorage.getItem('ni-account-v1')||'null') }));
ck(out.A_after.sess, 'A: no session was stored after signing up');

/* ── B · the PLAN comes from the server, not the cache ──────────────────── */
await p.evaluate(()=>{ const a=JSON.parse(localStorage.getItem('ni-account-v1')); a.plan='free-lunch';
  localStorage.setItem('ni-account-v1',JSON.stringify(a)); });
await p.goto(B+'/desk.html'); await p.waitForTimeout(1800);
out.B = await p.evaluate(()=>({ plan:(JSON.parse(localStorage.getItem('ni-account-v1'))||{}).plan,
  tier: window.__tier ? window.__tier() : null }));
ck(out.B.plan==='the office', `B: a plan typed into devtools survived a page load — ${out.B.plan}`);
ck(out.B.tier===3, `B: the tier did not follow the server plan — ${out.B.tier}`);

/* ── C · the sheets come down, and go up ────────────────────────────────── */
out.C = await p.evaluate(()=>({ names: P.props.map(x=>x.name), n:P.props.length }));
ck(out.C.names.includes('From the phone'), `C: the remote sheet never arrived — ${out.C.names}`);
await p.evaluate(()=>{ S.addr='55 Local Road'; S.name='Made here'; S.raw.arv='250000'; save(); });
await p.waitForTimeout(5200);
out.C_push = { rows: DB.sheets.map(x=>x.pid).length, has: DB.sheets.some(x=>x.blob && x.blob.addr==='55 Local Road') };
ck(out.C_push.has, 'C: a local edit never reached the server');

/* ── D · merge is PER PROPERTY, and the newer side wins ─────────────────── */
out.D = await p.evaluate(()=>{
  const mk=(id,at,nm)=>({id,name:nm,addr:nm,updated:at,raw:{},est:{},prov:{},unc:{},sys:{},comps:[],subj:{},compAdj:{},sit:'unknown'});
  const local=[mk('a',2000,'A local newer'), mk('b',1000,'B local older')];
  const remote=[{pid:'a',updated:new Date(1000).toISOString(),blob:mk('a',1000,'A remote older')},
                {pid:'b',updated:new Date(2000).toISOString(),blob:mk('b',2000,'B remote newer')},
                {pid:'c',updated:new Date(3000).toISOString(),blob:mk('c',3000,'C only remote')}];
  const m=window.__mergeSheets(local,remote);
  return { names:m.props.map(x=>x.name), n:m.props.length };
});
ck(out.D.names.includes('A local newer'), 'D: an older remote copy clobbered a newer local one');
ck(out.D.names.includes('B remote newer'), 'D: a newer remote copy did not win');
ck(out.D.names.includes('C only remote'), 'D: a sheet that exists only on the server was dropped');
ck(out.D.n===3, `D: ${out.D.n} sheets after merging 2 and 3 — a per-property merge should give 3`);

/* ── E · signing out ends the SESSION, not just the cache ───────────────── */
const before = seen.filter(x=>/logout/.test(x.u)).length;
await p.goto(B+'/office.html'); await p.waitForTimeout(900);
await p.evaluate(()=>{ const b2=document.getElementById('out'); if(b2) b2.click(); });
await p.waitForTimeout(900);
out.E = { logout: seen.filter(x=>/logout/.test(x.u)).length > before,
  sess: await p.evaluate(()=>localStorage.getItem('ni-session-v1')) };
ck(out.E.logout, 'E: signing out never told the server');
ck(!out.E.sess, 'E: a refresh token was left on the machine after signing out');

/* ── F · with nothing configured it is exactly the old product ──────────── */
{
  const p2=await b.newPage({viewport:{width:1280,height:1000}});
  const e2=[]; p2.on('pageerror',x=>e2.push(String(x)));
  await p2.goto('file://'+process.cwd()+'/dist/office.html'); await p2.waitForTimeout(800);
  out.F = await p2.evaluate(()=>({ authOn: !!(window.__authOn && window.__authOn()),
    pwHidden: document.getElementById('g-pwwrap').hidden,
    fine: (document.getElementById('g-fine')||{}).textContent||'' }));
  ck(!out.F.authOn, 'F: unconfigured and it still thinks auth is on');
  ck(out.F.pwHidden, 'F: it is asking for a password with nowhere to send it');
  ck(/no password to lose/.test(out.F.fine), 'F: the fine print no longer matches what actually happens');
  ck(!e2.length, 'F: unconfigured throws — '+e2.slice(0,2).join(' | '));
  await p2.close();
}

out.errs=errs;
if(errs.length) bad.push('console errors — '+errs.slice(0,3).join(' | '));
await b.close(); sb.close(); site.close();
console.log(JSON.stringify(out,null,1));
console.log(bad.length?'FAIL\n - '+bad.join('\n - ')
 :'PASS — the door signs up against the server, the plan is server truth, sheets merge per property with the newer side winning, sign-out ends the session, and nothing configured is exactly the old product');
process.exit(bad.length?1:0);
