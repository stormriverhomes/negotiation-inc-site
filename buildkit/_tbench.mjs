/* THE BENCH TELLS THE TRUTH ABOUT A LOSS.
   Two sheets, both asked far above anything any exit can pay. The grid used to
   crown the least-negative room in money-green with a tick, and the verdict
   below it read "118 Sylvan Rd SW, by $13,000 of room over 44 Peach Tree Ct" —
   a recommendation to buy the less bad walk-away. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE='file://'+path.resolve(process.argv[2] || 'dist/desk.html');
let n=0,bad=0;
const ok=(t,p,x)=>{n++; if(!p){bad++;console.log('✗ '+t+(x!==undefined?'  ← '+JSON.stringify(x).slice(0,220):''));}else console.log('✓ '+t);};

const b=await chromium.launch();
const pg=await b.newPage({viewport:{width:1400,height:1200}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,160)));
await pg.goto(FILE); await pg.waitForTimeout(600);

/* put two hopeless sheets on the bench, straight into the store the desk reads */
const built = await pg.evaluate(()=>{
  if (typeof P === 'undefined' || !P.props || typeof newProp !== 'function')
    return { ok:false, why:'no P.props / newProp' };
  const mk = (name, arv, rep, ask) => {
    const p = newProp();
    p.name = name;
    p.raw.arv = String(arv); p.est.arv = true; p.prov.arv = 'typed'; p.unc.arv = .05;
    p.raw.repairs = String(rep); p.est.repairs = true; p.prov.repairs = 'typed'; p.unc.repairs = .05;
    p.raw.asking = String(ask); p.est.asking = true; p.prov.asking = 'typed'; p.unc.asking = .05;
    p.repairsOwn = true;                       // the typed repair figure keeps the pen
    return p;
  };
  P.props.length = 0;
  P.props.push(mk('118 Sylvan Rd SW', 300000, 40500, 214000));
  P.props.push(mk('44 Peach Tree Ct', 196000, 30000, 205000));
  P.active = 0; loadInto(0);
  return { ok:true, n:P.props.length, keys:Object.keys(P.props[0]).slice(0,14) };
});
ok('two sheets are on the bench', built.ok, built);

const model = await pg.evaluate(()=>{
  const rooms = P.props.map((_,i)=>{ try { return roomOf(priceProp(i)); } catch(e){ return 'ERR:'+e.message; } });
  const scores = P.props.map((_,i)=>{ try { return scoreOf(priceProp(i)); } catch(e){ return null; } });
  return { rooms, scores };
});
console.log('   rooms: '+JSON.stringify(model.rooms));
const allNeg = model.rooms.every(r => typeof r === 'number' && r < 0);
ok('both sheets genuinely have negative room', allNeg, model.rooms);

if (allNeg){
  const opened = await pg.evaluate(()=>{
    /* the bench is a paid surface; the harness asserts what a paying customer
       sees, so it uses the desk's OWN preview hook rather than reaching past
       the gate — same door the screenshots use, and it is inert when live */
    /* ── A REAL ACCOUNT, NOT THE PREVIEW FLAG ─────────────────────────────────
       `ni-preview-plan` is a PAINT-ONLY device: previewTier() returns null the
       moment NI_LIVE is true, so every harness leaning on it went red against a
       live build — the suite could only be run in the stage we were not
       shipping. It was also testing the wrong thing, because a preview is not a
       purchase and entitled() has never honoured one. A planted account is what
       a customer actually has. */
    try { localStorage.setItem('ni-account-v1', JSON.stringify(
      { name:'E', email:'e@x.com', plan:'the office' })); } catch(e){}
    CMP.picks = [0,1]; if (typeof saveCmp==='function') saveCmp();
    const el = document.getElementById('compare');
    if (el){ el.hidden = false; }
    if (typeof renderCompare === 'function') renderCompare();
    return { premium: (typeof premium==='function') ? premium() : null,
             hidden: el ? el.hidden : 'no #compare',
             picks: CMP.picks };
  });
  console.log('   open: '+JSON.stringify(opened));
  await pg.waitForTimeout(500);
  const grid = await pg.evaluate(()=>{
    const g = document.querySelector('.cmp-grid:not(.is-demo)');
    if (!g) return { found:false };
    const rows = [...g.querySelectorAll('.cmp-r')].map(r=>({
      lab: r.querySelector('.l').textContent.trim(),
      cells: [...r.querySelectorAll('.v')].map(v=>({
        t:v.textContent.trim(), win:v.classList.contains('win'),
        neg: !!v.querySelector('.neg'),
        colour: getComputedStyle(v.querySelector('.neg') || v).color })),
    }));
    const vd = document.querySelector('.cmp-verdict');
    return { found:true, rows, verdict: vd ? { cls:vd.className, t:vd.textContent.replace(/\s+/g,' ').trim() } : null };
  });
  ok('the comparison grid rendered', grid.found, grid);
  if (grid.found){
    const money = grid.rows.filter(r=>/Room|Spread on paper/i.test(r.lab));
    ok('the money rows are present', money.length===2, grid.rows.map(r=>r.lab));
    for (const r of money){
      ok('no green tick on a negative "'+r.lab.replace(/&\w+;/g,'')+'"',
         r.cells.every(c=>!(c.win && /^−|^-/.test(c.t))), r.cells);
      /* a positive winner is fine and normal; the rule is that a row where
         EVERY figure is a loss must crown nobody */
      const allLoss = r.cells.length && r.cells.every(c=>/^−|^-/.test(c.t));
      if (allLoss) ok('an all-losing "'+r.lab.replace(/&\w+;/g,'')+'" crowns nobody',
         r.cells.every(c=>!c.win), r.cells);
      else ok('a mixed "'+r.lab.replace(/&\w+;/g,'')+'" crowns only the positive one',
         r.cells.filter(c=>c.win).every(c=>!/^−|^-/.test(c.t)), r.cells);
      ok('negative figures in "'+r.lab.replace(/&\w+;/g,'')+'" wear the refusal colour',
         r.cells.filter(c=>/^−|^-/.test(c.t)).every(c=>c.neg), r.cells);
    }
    ok('the verdict does not crown a walk-away',
       grid.verdict && /None of these reach/.test(grid.verdict.t), grid.verdict && grid.verdict.t.slice(0,180));
    ok('the verdict names how far short it is',
       grid.verdict && /still \$[\d,]+ short/.test(grid.verdict.t), grid.verdict && grid.verdict.t.slice(0,180));
    ok('the verdict is not styled as a pick',
       grid.verdict && /none/.test(grid.verdict.cls), grid.verdict && grid.verdict.cls);
  }
}
ok('no page errors', errs.length===0, errs[0]);
await b.close();
console.log('\n'+(bad? '✗ '+bad+' of '+n+' failed' : '✓ all '+n+' hold'));
process.exit(bad?1:0);
