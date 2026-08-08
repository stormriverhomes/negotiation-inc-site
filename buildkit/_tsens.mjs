/* "IF YOU ARE WRONG" HAS TO MEAN WRONG AFTER YOU BOUGHT IT.

   With no asking price, the grid re-derived the purchase inside every cell
   from that cell's OWN stressed figures — so a repair overrun was absorbed by
   paying less for a house you have already bought. All four repair rows came
   out identical: "repairs +40%" showed the same profit as the base cell, a
   $12,000 overrun rendered as costing nothing, in green.

   And #23: the repair estimate was written to the sheet rounded to $500 while
   the condition panel rendered the exact total and said "this total IS the
   repair estimate — it is already on the sheet". Up to $250 of daylight
   between two renders of one quantity, with every ceiling on the rounded one. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/desk.html');
let n=0,bad=0;
const ok=(t,p,x)=>{n++; if(!p){bad++;console.log('✗ '+t+(x!==undefined?'  ← '+JSON.stringify(x).slice(0,280):''));}else console.log('✓ '+t);};

const b=await chromium.launch();
const pg=await b.newPage({viewport:{width:1400,height:1200}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,180)));
await pg.goto(FILE); await pg.waitForTimeout(600);

/* ── #24 · the grid, with no asking price ───────────────────────────────── */
const grid = async (asking) => pg.evaluate((ask)=>{
  P.props.length = 0; P.props.push(newProp('450 Chestnut St')); P.active = 0; loadInto(0);
  const put = (k,v) => { S.raw[k]=v; S.est[k]=true; S.prov[k]='typed'; S.unc[k]=.05; };
  put('arv','200,000'); put('repairs','30,000'); if (ask) put('asking', ask);
  S.repairsOwn = true;
  try { localStorage.setItem('ni-preview-plan','the office'); } catch(e){}
  S.mode = 'adv'; P.mode = 'adv';
  if (typeof recompute === 'function') recompute();
  if (typeof showResults === 'function') showResults();
  /* the grid lives inside renderAdvanced(), which is what the Advanced tab
     calls — invoke it directly rather than trying to click through the tab */
  if (typeof renderAdvanced === 'function') { try { renderAdvanced(); } catch(e){ return { none:true, err:e.message }; } }
  const el = document.getElementById('sens');
  if (!el || !el.querySelector('tbody')) return { none:true, html: el ? el.innerHTML.slice(0,120) : null };
  const rows = [...el.querySelectorAll('tbody tr')].map(tr => ({
    lab: tr.querySelector('td').textContent.trim(),
    cells: [...tr.querySelectorAll('td')].slice(1).map(td => ({
      v: +td.textContent.replace(/[^0-9−-]/g,'').replace('−','-'),
      cls: td.className })),
  }));
  return { none:false, rows, head: el.querySelector('.sh .n') ? el.querySelector('.sh .n').textContent : '' };
}, asking);

const g = await grid(null);
if (g.none){ ok('the sensitivity grid rendered', false, g); }
else {
  console.log('   head: ' + g.head);
  for (const r of g.rows) console.log('   ' + r.lab.padEnd(16) + r.cells.map(c=>String(c.v).padStart(9)).join(''));

  const base = g.rows.find(r => /repairs 0%|repairs \+0%|^repairs 0/.test(r.lab)) || g.rows[1];
  const over = g.rows.find(r => /\+40/.test(r.lab));
  ok('there is a base row and a +40% repairs row', !!base && !!over, g.rows.map(r=>r.lab));

  if (base && over){
    /* the middle column is ARV unstressed, so these two cells differ only in
       repairs — the whole question the row is asking */
    const mid = Math.floor(base.cells.length / 2);
    const d = base.cells[mid].v - over.cells[mid].v;
    console.log('   a 40% repair overrun costs: ' + d);
    ok('a repair overrun actually costs something', d > 0, { base: base.cells[mid].v, over: over.cells[mid].v });
    ok('and costs about what the overrun is (40% of $30,000)',
       Math.abs(d - 12000) < 500, d);
    ok('the four repair rows are not all identical',
       new Set(g.rows.map(r => r.cells[mid].v)).size === g.rows.length,
       g.rows.map(r => r.cells[mid].v));
  }

  /* ARV stress must move the profit by the ARV delta, less selling cost */
  const row0 = g.rows[0];
  ok('ARV stress moves the profit across the row',
     new Set(row0.cells.map(c=>c.v)).size === row0.cells.length, row0.cells.map(c=>c.v));
  ok('the header names the price the grid is holding fixed',
     /Flip profit at \$[\d,]+/.test(g.head), g.head);
}

/* with a real asking price it must behave the same way (it always did) */
const g2 = await grid('120,000');
if (!g2.none){
  const mid = Math.floor(g2.rows[0].cells.length / 2);
  const b0 = g2.rows.find(r=>/repairs 0/.test(r.lab)) || g2.rows[1];
  const o0 = g2.rows.find(r=>/\+40/.test(r.lab));
  if (b0 && o0) ok('with an asking price, an overrun still costs the overrun',
    Math.abs((b0.cells[mid].v - o0.cells[mid].v) - 12000) < 500,
    { base:b0.cells[mid].v, over:o0.cells[mid].v });
}

/* ── #23 · one repair number, three renders ─────────────────────────────── */
const round = await pg.evaluate(()=>{
  P.props.length = 0; P.props.push(newProp('x')); P.active = 0; loadInto(0);
  const put = (k,v) => { S.raw[k]=v; S.est[k]=true; S.prov[k]='typed'; S.unc[k]=.05; };
  put('arv','300,000');
  LINES.forEach(l => S.sys[l.id] = 0);
  const kitchen = LINES.find(l => /kitchen/i.test(l.id)) || LINES[0];
  S.sys[kitchen.id] = 37;
  S.repairsOwn = false; S.sysOwn = {};
  syncRepairs();
  if (typeof render === 'function') render();
  const panel = document.getElementById('cond-total');
  return { sheet: val('repairs'),
           exact: Math.round(condTotalOf(val('arv'))),
           panel: panel ? +panel.textContent.replace(/[^0-9]/g,'') : null };
});
console.log('   ' + JSON.stringify(round));
ok('the sheet is priced on the exact condition total',
   round.sheet === round.exact, round);
ok('and the panel renders the same number the sheet holds',
   round.panel === round.sheet, round);
ok('no $500 daylight between the two',
   Math.abs(round.panel - round.sheet) === 0, round);

ok('no page errors', errs.length===0, errs[0]);
await b.close();
console.log('\n'+(bad? '✗ '+bad+' of '+n+' failed' : '✓ all '+n+' hold'));
process.exit(bad?1:0);
