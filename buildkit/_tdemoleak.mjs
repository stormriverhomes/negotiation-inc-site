/* A DEMO MUST NEVER TOUCH A REAL SHEET, BY ANY ROUTE OUT OF IT.
   `DEMO` is a global, and a global is a thing that escapes. Three routes out
   of a demo each broke differently:

     · "+ New sheet" cleared the flag and THEN saved, copying the showroom's
       name, address and figures over the real property and syncing it;
     · the property tabs never cleared it, so the real sheet displayed under a
       "not a real property" banner and every later save() silently no-opped —
       a whole session's typing gone on reload, with no warning at any point;
     · #open=N reached the real sheet with the flag still up, same result.

   The fix is structural: loadInto() is the single function that puts a real
   property into S, so it is where the demo ends. This walks every exit and
   asserts the two things that matter — the real figures survive, and the
   sheet can be saved afterwards. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/desk.html');
let n=0,bad=0;
const ok=(t,p,x)=>{n++; if(!p){bad++;console.log('✗ '+t+(x!==undefined?'  ← '+JSON.stringify(x).slice(0,260):''));}else console.log('✓ '+t);};

const b = await chromium.launch();
const pg = await b.newPage({ viewport:{ width:1400, height:1000 } });
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,180)));
await pg.goto(FILE); await pg.waitForTimeout(600);
ok('the desk boots (no dead zone on the hoisted globals)', errs.length===0, errs[0]);

/* a real property with real money on it, and a second one to switch to */
const seed = async () => pg.evaluate(()=>{
  P.props.length = 0;
  const a = newProp('450 Chestnut St');
  a.addr = '450 Chestnut St';
  a.raw.asking='250,000'; a.est.asking=false; a.prov.asking='you typed it';
  a.raw.arv='300,000';    a.est.arv=false;    a.prov.arv='you typed it';
  a.raw.repairs='40,000'; a.est.repairs=false;a.prov.repairs='you typed it';
  a.repairsOwn = true;
  const b2 = newProp('88 Ostend St');
  P.props.push(a, b2); P.active = 0; loadInto(0); save();
  return true;
});

const realStill = () => pg.evaluate(()=>({
  name: P.props[0].name, asking: P.props[0].raw.asking,
  arv: P.props[0].raw.arv, demo: DEMO,
  saved: (()=>{ try { const d=JSON.parse(localStorage.getItem('ni-desk-v3')||'{}');
    const p=(d.props||[])[0]; return p && p.f ? p.f.asking.v : null; } catch(e){ return 'ERR'; } })(),
}));

/* ── ROUTE 1 · "+ New sheet" ──────────────────────────────────────────── */
{
  await seed();
  await pg.evaluate(()=>{ loadDemo('flip'); });
  await pg.waitForTimeout(250);
  ok('the demo is up and the real prop is untouched underneath',
     await pg.evaluate(()=>DEMO === 'flip' && P.props[0].raw.asking === '250,000'));
  await pg.evaluate(()=>newSheet());
  await pg.waitForTimeout(250);
  const r = await realStill();
  ok('+ New sheet: the real sheet keeps its own figures', r.asking === '250,000' && r.name === '450 Chestnut St', r);
  ok('+ New sheet: the demo flag is down', !r.demo, r);
  ok('+ New sheet: localStorage was not overwritten with the demo', r.saved === '250,000', r);
}

/* ── ROUTE 2 · the property tabs ──────────────────────────────────────── */
{
  await seed();
  await pg.evaluate(()=>{ loadDemo('flip'); });
  await pg.waitForTimeout(250);
  await pg.evaluate(()=>{ save(); loadInto(0); save(); render(); });   // what the tab handler does
  await pg.waitForTimeout(250);
  const r = await realStill();
  ok('tabs: the demo flag is down after switching to a real sheet', !r.demo, r);
  ok('tabs: the real figures are on screen', r.asking === '250,000', r);

  /* and the sheet can actually be saved again — this is the half that cost a
     session's work: save() returning early forever, looking like success */
  const persisted = await pg.evaluate(()=>{
    S.raw.asking = '255,000'; S.est.asking = false; S.prov.asking = 'you typed it';
    save();
    try { const d = JSON.parse(localStorage.getItem('ni-desk-v3')||'{}');
      return (d.props||[])[0].f.asking.v; } catch(e){ return 'ERR'; }
  });
  ok('tabs: a later edit actually persists', persisted === '255,000', persisted);
}

/* ── ROUTE 3 · #open=N, including the same-index case ─────────────────── */
for (const idx of [0, 1]){
  await seed();
  await pg.evaluate((i)=>{ P.active = 0; loadDemo('flip'); }, idx);
  await pg.waitForTimeout(200);
  await pg.evaluate((i)=>{ loadInto(i); save(); }, idx);   // what the #open route does
  await pg.waitForTimeout(200);
  const r = await realStill();
  ok(`#open=${idx}: the demo flag is down`, !r.demo, r);
  ok(`#open=${idx}: 450 Chestnut still has its figures`, r.asking === '250,000', r);
}

/* ── and the demo itself still works ──────────────────────────────────── */
{
  await seed();
  const d = await pg.evaluate(()=>{ loadDemo('flip'); return { demo: DEMO, name: S.name, asking: S.raw.asking }; });
  ok('a demo still loads and still says it is a demo', d.demo === 'flip' && !!d.asking, d);
  const untouched = await pg.evaluate(()=>P.props[0].raw.asking);
  ok('and still leaves the real property alone', untouched === '250,000', untouched);
  const wrote = await pg.evaluate(()=>{
    const before = localStorage.getItem('ni-desk-v3');
    S.raw.arv = '999,999'; save();
    return localStorage.getItem('ni-desk-v3') === before;
  });
  ok('a demo still cannot write to disk', wrote === true);
}

/* ── AND A DEMO CANNOT SPEND, BY ANY PAID ROUTE ────────────────────────────
   The other half of the demo boundary. A demo is a showroom: it shows what a
   paid feature's OUTPUT looks like, pre-baked, but the feature itself must not
   run — otherwise the demo hands out for free the exact thing the tier sells.
   entitled(n) returns false whenever DEMO is set, so every paid gate should be
   shut; this proves it at the two layers that matter — the entitlement itself,
   and any request actually leaving the page. */
{
  await seed();
  await pg.evaluate(()=>{ loadDemo('flip'); });
  await pg.waitForTimeout(200);

  const ent = await pg.evaluate(()=>({
    demo: DEMO,
    e2: (typeof entitled==='function') ? entitled(2) : 'n/a',
    e3: (typeof entitled==='function') ? entitled(3) : 'n/a',
    photo: (typeof window.__photoEntitled==='function') ? window.__photoEntitled() : 'n/a',
  }));
  ok('a demo is entitled to nothing paid', ent.demo==='flip' && ent.e2===false && ent.e3===false && ent.photo===false, ent);

  /* watch the wire: try to fire every paid feature and assert nothing reaches
     a paid endpoint. The functions are reachable from window on purpose —
     "the button is gone" is not a security boundary, the entitlement is. */
  const paidHits = [];
  await pg.route('**/api/**', route => { paidHits.push(new URL(route.request().url()).pathname); route.abort(); });
  await pg.evaluate(async ()=>{
    const tries = ['__runRead','__runStreet','__runComps','__runBid','__runObjections','__runLetters','__walkGo'];
    for (const k of tries){ try { if (typeof window[k]==='function') await window[k](0); } catch(e){} }
    /* and the direct payFetch path, if the page exposes it */
    try { if (window.__payFetch) await window.__payFetch('/api/read', {}); } catch(e){}
  });
  await pg.waitForTimeout(400);
  const paid = paidHits.filter(p => /\/api\/(read|comps|street|walk|bid|objections|lookup)/.test(p));
  ok('a demo firing every paid feature reaches no paid endpoint', paid.length===0, paid);
  await pg.unroute('**/api/**');
}

ok('no page errors through any route', errs.length===0, errs[0]);
await b.close();
console.log('\n'+(bad? '✗ '+bad+' of '+n+' failed' : '✓ all '+n+' hold'));
process.exit(bad?1:0);
