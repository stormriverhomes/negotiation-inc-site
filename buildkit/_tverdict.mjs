/* THE VERDICT AND THE RANKBAR MUST NAME THE SAME WINNER.
   rankAll sorts KIND FIRST — a sheet scored in `room` (what you can pay less
   what they want) outranks one scored in `ceil`, because a ceiling with no
   asking price against it does not answer the same question. The verdict box
   re-derived the winner with a plain max(v) that ignored kind entirely, so a
   large ceiling beat a modest room and the box contradicted the rankbar
   rendered inches above it.

   And then it printed the difference: "B, by $118,000 of room over A" — a
   ceiling minus a room, two incommensurable quantities subtracted and labelled
   with the name of one of them. On Solo the rankbar is a locked placeholder,
   so the user saw only the wrong verdict with nothing to contradict it. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/desk.html');
let n=0,bad=0;
const ok=(t,p,x)=>{n++; if(!p){bad++;console.log('✗ '+t+(x!==undefined?'  ← '+JSON.stringify(x).slice(0,280):''));}else console.log('✓ '+t);};

const b=await chromium.launch();
const pg=await b.newPage({viewport:{width:1400,height:1200}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,180)));
await pg.goto(FILE); await pg.waitForTimeout(600);

/* the audit's own bench: A has an asking price and modest room; B has none and
   a large ceiling. Kind-first says A wins; raw max(v) says B. */
const bench = async () => pg.evaluate(()=>{
  /* ── A REAL ACCOUNT, NOT THE PREVIEW FLAG ─────────────────────────────────
     `ni-preview-plan` is a PAINT-ONLY device: previewTier() returns null the
     moment NI_LIVE is true, so every harness leaning on it went red against a
     live build — the suite could only be run in the stage we were not
     shipping. It was also testing the wrong thing, because a preview is not a
     purchase and entitled() has never honoured one. A planted account is what
     a customer actually has. */
  try { localStorage.setItem('ni-account-v1', JSON.stringify(
    { name:'E', email:'e@x.com', plan:'the office' })); } catch(e){}
  P.props.length = 0;
  const mk = (name, arv, rep, ask) => {
    const p = newProp(name);
    const put = (k,v) => { p.raw[k]=v; p.est[k]=true; p.prov[k]='typed'; p.unc[k]=.05; };
    put('arv', arv); put('repairs', rep); if (ask) put('asking', ask);
    p.repairsOwn = true; return p;
  };
  P.props.push(mk('A · has their number', '250,000', '40,000', '150,000'));
  P.props.push(mk('B · no number yet',    '200,000', '30,000', null));
  P.active = 0; loadInto(0);
  CMP.picks = [0,1]; if (typeof saveCmp==='function') saveCmp();
  const el = document.getElementById('compare'); if (el) el.hidden = false;
  renderCompare();
  const cards = P.props.map((_,i) => priceProp(i));
  const scores = cards.map(scoreOf);
  const order  = rankAll(cards);
  const vd = document.querySelector('.cmp-verdict');
  const rb = document.querySelector('.rankbar');
  return {
    scores: scores.map(s => ({ v: s.v === null ? null : Math.round(s.v), kind: s.kind })),
    rankbarFirst: order[0] ? order[0].r.name : null,
    verdict: vd ? vd.textContent.replace(/\s+/g,' ').trim() : null,
    verdictCls: vd ? vd.className : null,
    rankbarText: rb ? rb.textContent.replace(/\s+/g,' ').trim().slice(0,140) : null,
  };
});

const r = await bench();
console.log('   ' + JSON.stringify({ scores: r.scores, first: r.rankbarFirst }));
console.log('   verdict: ' + String(r.verdict).slice(0, 220));

ok('the two sheets are scored on DIFFERENT kinds',
   r.scores[0] && r.scores[1] && r.scores[0].kind !== r.scores[1].kind, r.scores);
ok('and raw max(v) would pick the other one — so this case is real',
   r.scores[1].v > r.scores[0].v, r.scores);
ok('the rankbar puts the sheet with an asking price first',
   /^A/.test(String(r.rankbarFirst)), r.rankbarFirst);
ok('and the verdict names the SAME sheet',
   !!r.verdict && r.verdict.includes(String(r.rankbarFirst).split('·')[0].trim()), r.verdict);
ok('the verdict does not name the other one as the winner',
   !!r.verdict && !/^The verdict B\b/.test(r.verdict), r.verdict);
ok('it never subtracts a ceiling from a room and calls it room',
   !!r.verdict && !/by \$[\d,]+ of room over/.test(r.verdict), r.verdict);
ok('it says plainly that they are not answering the same question',
   !!r.verdict && /not answering the same question|no single figure that separates/.test(r.verdict), r.verdict);
ok('it does not claim "No asking price on these" when one of them has one',
   !!r.verdict && !/No asking price on these/.test(r.verdict), r.verdict);

/* ── and when both are the same kind, the delta comes back ──────────────── */
const same = await pg.evaluate(()=>{
  P.props.length = 0;
  const mk = (name, arv, rep, ask) => {
    const p = newProp(name);
    const put = (k,v) => { p.raw[k]=v; p.est[k]=true; p.prov[k]='typed'; p.unc[k]=.05; };
    put('arv', arv); put('repairs', rep); put('asking', ask);
    p.repairsOwn = true; return p;
  };
  P.props.push(mk('A · roomy', '300,000', '30,000', '140,000'));
  P.props.push(mk('B · tighter', '260,000', '30,000', '150,000'));
  P.active = 0; loadInto(0);
  CMP.picks = [0,1]; if (typeof saveCmp==='function') saveCmp();
  const el = document.getElementById('compare'); if (el) el.hidden = false;
  renderCompare();
  const cards = P.props.map((_,i) => priceProp(i));
  const scores = cards.map(scoreOf);
  const vd = document.querySelector('.cmp-verdict');
  return { kinds: scores.map(s=>s.kind),
           verdict: vd ? vd.textContent.replace(/\s+/g,' ').trim() : null };
});
console.log('   same-kind verdict: ' + String(same.verdict).slice(0, 180));
ok('both sheets score on the same kind', same.kinds[0] === same.kinds[1], same.kinds);
ok('and the verdict states the delta again',
   !!same.verdict && /by \$[\d,]+ of (room|ceiling) over/.test(same.verdict), same.verdict);

ok('no page errors', errs.length===0, errs[0]);
await b.close();
console.log('\n'+(bad? '✗ '+bad+' of '+n+' failed' : '✓ all '+n+' hold'));
process.exit(bad?1:0);
