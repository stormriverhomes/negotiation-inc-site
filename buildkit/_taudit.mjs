/* ══ THE CROSS-PANEL AUDIT ══════════════════════════════════════════════════
   Every panel on the sheet that names an exit is naming the SAME decision. If
   the top of the page says "closest fit — this cannot reach their price" and
   Part IV says "the recommendation", the software has told the reader two
   different things about the same house on one screen, and the reader will
   believe the second one because it is the one with a price next to it.

   This walks all five demos and prints, side by side, every place a name or a
   verdict is stated. It asserts nothing on its own — it is the instrument. */
import { chromium } from 'playwright';
import path from 'node:path';

const KEYS = ['flip','hold','subto','novation','walk'];
const FILE = 'file://' + path.resolve('dist/desk.html');

const b = await chromium.launch();
const rows = [];
for (const k of KEYS){
  const pg = await b.newPage({ viewport:{ width:1280, height:1000 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(FILE + '#demo=' + k);
  await pg.waitForTimeout(400);
  await pg.evaluate(() => { try { showResults(); } catch(e){ document.title='ERR '+e.message; } });
  await pg.waitForTimeout(500);

  const out = await pg.evaluate(() => {
    const T = el => el ? el.textContent.replace(/\s+/g,' ').trim() : null;
    const exits = [...document.querySelectorAll('#exits .exit')].slice(0,4).map(e => ({
      nm: T(e.querySelector('.nm')) || T(e.querySelector('.exit-h .n')) || T(e.querySelector('h3')),
      flag: [...e.querySelectorAll('.flag')].map(f => T(f)).join(' / '),
      cls: e.className,
    }));
    const oxp = [...document.querySelectorAll('.oxp-b')].map(x => ({
      nm: T(x.querySelector('.n')), on: x.classList.contains('on'), rec: x.classList.contains('rec') }));
    let model = null;
    try { const m = offerModel();
      model = { best:m.best.nm, win:m.win.nm, top:m.top && m.top.nm, winIsTop:m.winIsTop,
                topReaches:m.topReaches, pricePos:Math.round(m.pricePos), picked:m.picked, bestCeil:Math.round(m.best.ceil),
                winCeil:Math.round(m.win.ceil), ask:m.ask, price:Math.round(m.price),
                liveN:m.live.length, fits:m.live.map(x=>x.nm+':'+x.fit).join(', ') }; } catch(e){ model = {err:String(e)}; }
    let top = null;
    try { const EX = rankExits(); const L = EX.filter(x=>!x.na && x.key!==null);
      L.sort((p,q)=> (q.fit??-1)-(p.fit??-1) || (typeof q.key==='number'?q.key:0)-(typeof p.key==='number'?p.key:0));
      top = { nm:L[0] && L[0].nm, fit:L[0] && L[0].fit, n:L.length,
              all:L.map(x=>x.nm+':'+x.fit+(x.ceil!==undefined?'/c'+Math.round(x.ceil):'/c—')+(x.band?'/b':'/nob')).join(' | ') };
    } catch(e){ top = {err:String(e)}; }
    return {
      exits, oxp, model, top,
      oxpWord: T(document.querySelector('.oxp-w')),
      against: T(document.querySelector('.offer .read div')),
      h2: T(document.querySelector('.offer h2')),
      objHead: T(document.querySelector('#objections b')),
      objBody: (()=>{ try { const m=offerModel(); const o=objBody(m);
        return {exit:o.exit, recommendation:o.recommendation, onRecommendation:o.onRecommendation,
                reachesAsking:o.reachesAsking, asking:o.asking, offer:o.offer, ceiling:o.ceiling,
                refused:(o.refused||[]).map(r=>r.exit).join(', ')}; } catch(e){ return {err:String(e)}; } })(),
    };
  });
  /* ── AND THE TWO ARTEFACTS THAT LEAVE THE BUILDING ────────────────────── */
  out.letter = await pg.evaluate(() => {
    const T = el => el ? el.textContent.replace(/\s+/g,' ').trim() : '';
    try { showLetters(); } catch(e){ return { err:String(e) }; }
    const d = letterModel();
    return { basis: T(document.querySelector('.ltbasis')),
             cls: (document.querySelector('.ltbasis')||{}).className || '',
             fin: d && d.f && d.f.lab, sub: T(document.querySelector('.ltop .sub')).slice(0,120) };
  });
  await pg.waitForTimeout(200);
  out.print = await pg.evaluate(() => {
    try { const R = rankedExits(); buildPrint(R.order, ['','','','Confidence high','']);
      const t = document.getElementById('printdoc').textContent.replace(/\s+/g,' ');
      return { verdict: /No exit on this sheet reaches the asking price/.test(t) }; }
    catch(e){ return { err:String(e) }; }
  });
  out.key = k; out.errs = errs;
  rows.push(out);
  await pg.close();
}
/* ── AND A DEMO LEAVES NO RESIDUE ─────────────────────────────────────────
   Open a scenario, then come back to the desk plain — the way the nav does.
   The sheet must be the visitor's own (step one, no work) and must not be
   wearing the demo's banner. This was real: the persisted case label dressed
   every return visit in "The tired ranch is not a real property…". */
let residue;
{
  const pg = await b.newPage({ viewport:{ width:1280, height:1000 } });
  await pg.goto(FILE + '#demo=flip');
  await pg.waitForTimeout(500);
  await pg.goto(FILE, { waitUntil:'load' });   // plain visit, same origin, same storage
  await pg.waitForTimeout(500);
  residue = await pg.evaluate(() => ({
    label: (()=>{ try { return localStorage.getItem('ni-desk-case'); } catch(e){ return null; } })(),
    banner: (document.querySelector('#fromcourse .fromc') || {}).textContent || '',
    work: typeof sheetHasWork === 'function' ? sheetHasWork() : null,
  }));
  await pg.close();
}
await b.close();

let bad = 0;
for (const r of rows){
  console.log('\n════ ' + r.key.toUpperCase() + ' ' + '═'.repeat(60 - r.key.length));
  if (r.errs.length) console.log('  PAGE ERRORS: ' + r.errs.join(' | '));
  console.log('  top-of-page order : ' + (r.top.all || r.top.err));
  console.log('  #1 exit           : ' + (r.exits[0] ? r.exits[0].nm + '   [' + r.exits[0].flag + ']' : '—'));
  console.log('  offerModel.win    : ' + r.model.win + '   (ceil ' + r.model.winCeil + ')');
  console.log('  offerModel.best   : ' + r.model.best + '   (ceil ' + r.model.bestCeil + ')');
  console.log('  live in Part IV   : ' + r.model.liveN + ' → ' + r.model.fits);
  console.log('  Part IV "against" : ' + r.against);
  console.log('  Part IV sentence  : ' + (r.oxpWord || '(no picker — fewer than two live exits)'));
  console.log('  objections built on: ' + JSON.stringify(r.objBody));

  const say = (r.oxpWord || '');
  const flag = (r.exits[0] || {}).flag || '';
  const fail = t => { bad++; console.log('  ✗ ' + t); };

  /* 1 · one ranking. The page's #1 and offerModel.top must be the same exit. */
  if (r.top.nm !== r.model.top) fail('RANK: page #1 is "' + r.top.nm + '", offerModel.top is "' + r.model.top + '"');

  /* 2 · the badge and Part IV must use the same word about the same deal */
  if (!/Recommended/i.test(flag) && !/closest fit, not a recommendation/i.test(say))
    fail('WORD: badge is "' + flag + '" but Part IV does not say closest-fit → "' + say.slice(0,90) + '…"');

  /* 3 · when the offer is not built for the sheet's top exit, Part IV must NAME
         the top exit rather than promoting the runner-up to "the recommendation" */
  if (r.model.top !== r.model.win){
    if (!say.toLowerCase().includes(r.model.top.toLowerCase()))
      fail('SILENT SWAP: offer is built for "' + r.model.win + '" and the sentence never names "' + r.model.top + '"');
    if (/^The recommendation, by fit/.test(say))
      fail('SILENT SWAP: "' + r.model.win + '" is being called the recommendation');
  }

  /* 4 · the writer gets the sheet's verdict, not just the plan */
  if (r.objBody.recommendation === undefined) fail('FACTS: objections are not told what the sheet recommends');
  if (r.objBody.reachesAsking === undefined)  fail('FACTS: objections are not told whether anything reaches the ask');

  /* 5 · and the sheet never OPENS on an offer it has already said cannot work */
  if (r.model.price > r.model.bestCeil)
    fail('DEFAULT: opens at ' + r.model.price.toLocaleString() + ', which is '
       + (r.model.price - r.model.bestCeil).toLocaleString() + ' over the ' + r.model.best + ' ceiling');

  /* 6 · the letter and the printout carry the verdict too */
  console.log('  letter paperwork  : ' + r.letter.fin);
  console.log('  letter banner     : ' + (r.letter.basis ? '[' + r.letter.cls + '] ' + r.letter.basis.slice(0,110) : '(none)'));
  console.log('  printout verdict  : ' + (r.print.verdict ? 'present' : (r.model.topReaches ? 'n/a' : 'MISSING')));
  if (!r.model.topReaches && !/does not think this house prices/i.test(r.letter.basis))
    fail('LETTER: sheet refuses the deal and Part V says nothing');
  if (!r.model.winIsTop && !/not the play the sheet picked/i.test(r.letter.basis))
    fail('LETTER: offer is not on the recommendation and Part V says nothing');
  if (!r.model.topReaches && !r.print.verdict)
    fail('PRINT: the lender document omits the refusal');
  if (r.model.top === 'The subject-to' && !/taking over the loan/i.test(r.letter.fin || ''))
    fail('LETTER: sheet recommends a subject-to and the draft defaults to ' + r.letter.fin);
  if (r.model.top === 'The novation' && !/sells/i.test(r.letter.fin || ''))
    fail('LETTER: sheet recommends a novation and the draft defaults to ' + r.letter.fin);
}
console.log('\nresidue check       : label=' + JSON.stringify(residue.label)
  + ' · banner=' + (residue.banner ? JSON.stringify(residue.banner.slice(0,40)) : 'none')
  + ' · work=' + residue.work);
if (residue.label && residue.label.indexOf('demo:') === 0){ bad++; console.log('  ✗ RESIDUE: demo label survived the visit'); }
if (/not a real property/.test(residue.banner)){ bad++; console.log('  ✗ RESIDUE: a plain visit is wearing the demo banner'); }
if (residue.work){ bad++; console.log('  ✗ RESIDUE: the demo state persisted as the visitor’s own sheet'); }

console.log('\n' + (bad ? '✗ ' + bad + ' contradiction(s)' : '✓ every panel agrees'));
process.exit(bad ? 1 : 0);
