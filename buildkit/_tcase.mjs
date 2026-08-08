/* A SAMPLE BANNER IS A FACT ABOUT A SHEET, NOT ABOUT THE ACCOUNT.
   The "from a lesson / from the arcade" label lived in ONE localStorage key
   read by every property, so a worked example loaded onto sheet A put "not a
   property" on sheet B — and on the lender packet printed from a real house.

   And two ways to lose work that the sheet called blank:
     · applyCase() wrote the example over the open property in place, keeping
       that property's comps, condition panel and paid photo read;
     · propHasWork() looked only at money fields, address and comps, so a sheet
       carrying a walked condition panel and a BOUGHT photo read counted as
       empty and "+ New sheet" overwrote it. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE='file://'+path.resolve(process.argv[2] || 'dist/desk.html');
let n=0,bad=0;
const ok=(t,p,x)=>{n++; if(!p){bad++;console.log('✗ '+t+(x!==undefined?'  ← '+JSON.stringify(x).slice(0,240):''));}else console.log('✓ '+t);};

const b=await chromium.launch();
const pg=await b.newPage({viewport:{width:1400,height:1100}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,180)));
await pg.goto(FILE); await pg.waitForTimeout(600);

/* ── 1 · the banner belongs to one sheet ──────────────────────────────── */
const banner = await pg.evaluate(()=>{
  P.props.length = 0;
  const real = newProp(); real.name = 'A real house of mine';
  real.raw.arv = '260,000'; real.est.arv = true; real.prov.arv = 'typed'; real.unc.arv = .05;
  real.raw.asking = '190,000'; real.est.asking = true;
  P.props.push(real);
  P.active = 0; loadInto(0); save();

  /* a lesson arrives */
  applyCase({ from:'3.2', title:'The tired ranch', raw:{ arv:'300,000', asking:'168,000' },
              est:{ arv:true }, sit:'motivated' });
  const onExample = { at:P.active, label: caseLabel(), sample:S.sample, n:P.props.length,
                      name:S.name };
  /* now go back to the real sheet */
  loadInto(0);
  const onReal = { at:P.active, label: caseLabel(), sample:S.sample,
                   arv:S.raw.arv, comps:(S.comps||[]).length };
  return { onExample, onReal, props: P.props.map(p=>({ name:p.name, sample:p.sample, caseLabel:p.caseLabel })) };
});
console.log('   '+JSON.stringify(banner));
ok('the example lands on its OWN sheet', banner.onExample.n === 2 && banner.onExample.at === 1, banner.onExample);
ok('the example wears the banner', /3\.2/.test(String(banner.onExample.label||'')), banner.onExample.label);
ok('the real sheet does NOT wear it', !banner.onReal.label, banner.onReal);
ok('the real sheet keeps its own figures', banner.onReal.arv === '260,000', banner.onReal);
ok('only one property is marked a sample',
   banner.props.filter(p=>p.sample).length === 1, banner.props);

/* ── 2 · the example does not inherit the previous sheet's material ───── */
const inherit = await pg.evaluate(()=>{
  P.props.length = 0;
  const mine = newProp(); mine.name = 'Elm Street';
  mine.raw.arv = '260,000'; mine.est.arv = true;
  mine.comps = [['88 Ostend St','271000','1290','3','1.5','5','0.4',-1]];
  mine.subj = { sqft:'1420', beds:'3', baths:'2' };
  mine.sys = { roof:70, hvac:80 };
  mine.read = { note:'a paid photo read', at:Date.now() };
  P.props.push(mine); P.active = 0; loadInto(0); save();
  applyCase({ from:'4.1', title:'Beecher Street', raw:{ arv:'410,000' }, est:{}, sit:'estate' });
  return { comps:(S.comps||[]).length, subjSqft:S.subj && S.subj.sqft,
           sys:Object.values(S.sys||{}).filter(v=>+v>0).length, read: !!S.read,
           name:S.name, mineStillThere: !!(P.props[0] && P.props[0].read && (P.props[0].comps||[]).length) };
});
console.log('   '+JSON.stringify(inherit));
ok('the example brings no comps of its own', inherit.comps === 0, inherit);
ok('the example brings no subject dimensions', !inherit.subjSqft, inherit);
ok('the example brings no condition panel', inherit.sys === 0, inherit);
ok('the example brings no photo read', inherit.read === false, inherit);
ok('the example is named for itself', /Beecher/.test(String(inherit.name||'')), inherit.name);
ok('and the sheet it came from is untouched', inherit.mineStillThere === true, inherit);

/* ── 3 · a bought photo read is work ──────────────────────────────────── */
const work = await pg.evaluate(()=>{
  const only = (mut) => { const p = newProp(); mut(p); return propHasWork(p); };
  return {
    blank:      only(()=>{}),
    money:      only(p=>{ p.raw.arv='100,000'; }),
    condition:  only(p=>{ p.sys = { roof:60 }; }),
    photoRead:  only(p=>{ p.read = { note:'bought', at:1 }; }),
    named:      only(p=>{ p.name='The one on Elm'; }),
    subj:       only(p=>{ p.subj = { sqft:'1420', beds:'', baths:'' }; }),
    letterTo:   only(p=>{ p.toName='Mrs Alvarez'; }),
    exitPicked: only(p=>{ p.offerExit='flip'; }),
  };
});
console.log('   '+JSON.stringify(work));
ok('a genuinely blank sheet is blank', work.blank === false, work);
for (const k of ['money','condition','photoRead','named','subj','letterTo','exitPicked'])
  ok(`"${k}" counts as work worth keeping`, work[k] === true, work);

/* and "+ New sheet" therefore opens a NEW one rather than overwriting */
const ns = await pg.evaluate(()=>{
  P.props.length = 0;
  const p = newProp(); p.read = { note:'a paid photo read', at:1 }; p.sys = { roof:60 };
  P.props.push(p); P.active = 0; loadInto(0);
  const before = P.props.length;
  newSheet();
  return { before, after:P.props.length, readSurvived: !!(P.props[0] && P.props[0].read) };
});
ok('"+ New sheet" does not overwrite a paid read', ns.after === ns.before + 1 && ns.readSurvived, ns);
/* ── 4 · the boot router knows every panel the click router knows ─────── */
const routes = {};
for (const h of ['#compare','#buybox','#letter','#bulk']){
  const p2 = await b.newPage({ viewport:{width:1400,height:1100} });
  const e2=[]; p2.on('pageerror',x=>e2.push(String(x).slice(0,140)));
  await p2.addInitScript(()=>{ try{ localStorage.setItem('ni-preview-plan','the office'); }catch(e){} });
  await p2.goto(FILE + h);
  await p2.waitForTimeout(700);
  routes[h] = await p2.evaluate(()=>{
    const vis = id => { const el=document.getElementById(id); return !!(el && !el.hidden); };
    return { compare:vis('compare'), buybox:vis('buybox'), letters:vis('letters'), bulk:vis('bulk'),
             errs:0 };
  });
  routes[h].errs = e2.length; routes[h].firstErr = e2[0];
  await p2.close();
}
console.log('   '+JSON.stringify(routes));
ok('#compare opens the comparison on a cold load', routes['#compare'].compare === true, routes['#compare']);
ok('#buybox opens the buy box on a cold load',    routes['#buybox'].buybox  === true, routes['#buybox']);
ok('#letter opens the letters on a cold load',    routes['#letter'].letters === true, routes['#letter']);
ok('#bulk opens the bulk panel on a cold load',   routes['#bulk'].bulk      === true, routes['#bulk']);
for (const h of Object.keys(routes)) ok(`${h} boots without an error`, routes[h].errs === 0, routes[h].firstErr);

ok('no page errors', errs.length===0, errs[0]);

await b.close();
console.log('\n'+(bad? '✗ '+bad+' of '+n+' failed' : '✓ all '+n+' hold'));
process.exit(bad?1:0);
