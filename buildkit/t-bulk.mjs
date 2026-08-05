/* t-bulk — underwriting a list.

     A · the parser survives the shapes a real list arrives in: commas inside
         an address, tabs, pipes, "168k", a header row, a short line above a
         wide one (which used to truncate every line beneath it)
     B · ONE ENGINE — a row's ceiling here is identical, to the dollar, to the
         same sheet priced on the desk. If these two ever diverge the product
         has two versions of its own arithmetic.
     C · a draft is never a sheet. Pricing forty rows must leave the workspace
         exactly as it found it, even when something throws mid-list.
     D · the guesses are opt-in, flagged on the row, and ranked at the CAUTIOUS
         end of their own band — an assumed ARV and an assumed repair figure
         both run in your favour, and a table that sorted on the best case
         would send somebody driving on two guesses stacked.
     E · a row that cannot price says which number it wants.
     F · the tier line: The Office prices, everybody else sees the parser and
         the gate. */
import { chromium } from 'playwright';

const B = 'file:///home/claude/dist/';
const b = await chromium.launch();
const out = {}; const bad = []; const errs = [];
const p = await b.newPage({ viewport:{ width:1440, height:1100 } });
p.on('pageerror', e => errs.push(String(e)));
p.on('console', m => { if (m.type() === 'error' && !/fraunces|ERR_FAILED/.test(m.text())) errs.push(m.text()); });

const land = async plan => {
  await p.goto(B + 'desk.html');
  await p.evaluate(pl => { localStorage.clear();
    localStorage.setItem('ni-account-v1', JSON.stringify({ name:'Elijah', email:'e@x.com', plan:pl, trial:null }));
    localStorage.setItem('ni-desk-v3', JSON.stringify({ active:0, props:[
      { name:'Kept sheet', addr:'9 Keep Street', sit:'unknown', sys:{}, comps:[], subj:{}, compAdj:{},
        f:{ asking:{v:'100000'}, arv:{v:'200000'}, repairs:{v:'20000'} } }] }));
  }, plan);
  await p.goto(B + 'desk.html'); await p.waitForTimeout(500);
  await p.goto(B + 'desk.html#bulk'); await p.waitForTimeout(700);
};
const paste = async t => { await p.fill('#bk-text', t); await p.waitForTimeout(1100); };

/* ── A · the shapes a list actually arrives in ─────────────────────────── */
await land('the office');
await paste([
  '1104 Elm Street, Atlanta, GA 30310, 168000, 249000, 46000',   // commas inside the address
  '88 Ostend Street\t132000\t196000\t38000\t1650',               // tabs
  '1900 Lucile Ave | 214000 | 300000 | 20500 | 2100',            // pipes, and the widest line
  '640 Sells Avenue, Atlanta, GA 30310, 149k',                   // "149k"
].join('\n'));
out.A = await p.evaluate(() => bulkParse().recs);
if (out.A.length !== 4) bad.push(`A: ${out.A.length} of 4 lines parsed`);
if (out.A[0].addr !== '1104 Elm Street, Atlanta, GA 30310')
  bad.push(`A: the commas inside an address were eaten — "${out.A[0].addr}"`);
if (out.A[0].asking !== '168000') bad.push('A: the trailing figures were not peeled off');
if (out.A[1].rent !== '1650')     bad.push('A: a tab-separated line lost its last column');
if (out.A[2].rent !== '2100')     bad.push('A: the widest line was truncated to the first line’s width');
if (out.A[3].asking !== '149000') bad.push(`A: "149k" did not read as 149000 — "${out.A[3].asking}"`);

/* a header row decides the columns, in whatever order it names them */
await paste('Address\tRehab\tARV\tList price\n77 Ostend Street\t18000\t196000\t132000');
out.Ahead = await p.evaluate(() => ({ head: bulkParse().head, cols: bulkParse().cols, r: bulkParse().recs[0] }));
if (!out.Ahead.head)                  bad.push('A: a header row was read as a property');
if (out.Ahead.r.repairs !== '18000')  bad.push('A: the header row did not map its own column order');
if (out.Ahead.r.asking !== '132000')  bad.push('A: "List price" did not read as the asking price');

/* ── B · one engine ────────────────────────────────────────────────────── */
await land('the office');
await paste('1104 Elm Street, Atlanta, GA 30310, 168000, 249000, 46000');
out.B = await p.evaluate(() => {
  const bulkRowCeil = BULK.rows[0].top.ceil, bulkBest = BULK.rows[0].best.id;
  /* the same numbers, typed onto the desk */
  S.addr = '1104 Elm Street, Atlanta, GA 30310';
  S.raw.asking = '168000'; S.raw.arv = '249000'; S.raw.repairs = '46000';
  const EX = rankExits();
  const c = EX.filter(x => !x.na && typeof x.ceil === 'number' && x.ceil > 0)
              .sort((a2,b2) => b2.ceil - a2.ceil)[0];
  const best = EX.filter(x => !x.na && x.fit !== null).sort((a2,b2) => b2.fit - a2.fit)[0];
  return { bulkRowCeil, bulkBest, deskCeil: c.ceil, deskBest: best.id };
});
if (Math.round(out.B.bulkRowCeil) !== Math.round(out.B.deskCeil))
  bad.push(`B: the list says ${Math.round(out.B.bulkRowCeil)} and the desk says ${Math.round(out.B.deskCeil)}`);
if (out.B.bulkBest !== out.B.deskBest)
  bad.push(`B: the list picks ${out.B.bulkBest} and the desk picks ${out.B.deskBest}`);

/* ── C · a draft is never a sheet ──────────────────────────────────────── */
await land('the office');
const before = await p.evaluate(() => ({ n: P.props.length, active: P.active,
  saved: JSON.parse(localStorage.getItem('ni-desk-v3')).props.length }));
await paste(Array.from({length: 12}, (_,i) => `${i+1} Draft Road, Atlanta, GA 30310, ${100000+i*1000}, 200000, 20000`).join('\n'));
const after = await p.evaluate(() => ({ n: P.props.length, active: P.active,
  saved: JSON.parse(localStorage.getItem('ni-desk-v3')).props.length,
  rows: BULK.rows.length, open: S.addr }));
out.C = { before, after };
if (after.n !== before.n)         bad.push(`C: pricing a list left ${after.n - before.n} phantom properties behind`);
if (after.saved !== before.saved) bad.push('C: pricing a list wrote drafts to disk');
if (after.rows !== 12)            bad.push(`C: ${after.rows} of 12 rows priced`);
if (after.open !== '9 Keep Street') bad.push(`C: the open sheet was left as "${after.open}"`);

/* and keeping them is deliberate, bounded, and does write down */
await p.click('#bk-addall'); await p.waitForTimeout(700);
out.Ckeep = await p.evaluate(() => ({ n: P.props.length,
  saved: JSON.parse(localStorage.getItem('ni-desk-v3')).props.length }));
if (out.Ckeep.n !== before.n + 12) bad.push(`C: keeping the list produced ${out.Ckeep.n - before.n} of 12`);
if (out.Ckeep.saved !== out.Ckeep.n) bad.push('C: the kept properties were not written down');

/* ── D · the guesses ───────────────────────────────────────────────────── */
await land('the office');
await paste('640 Sells Avenue, Atlanta, GA 30310, 149000');
out.D = await p.evaluate(() => {
  const r = BULK.rows[0];
  return { from: r.from, est: r.est, room: r.room, roomLo: r.roomLo,
    flags: document.querySelectorAll('.bkt .bkfl').length,
    priced: !!r.best };
});
if (!out.D.priced)                    bad.push('D: an address and an asking price priced nothing at all');
if (out.D.from.indexOf('zip') < 0)    bad.push('D: the ZIP median did not fill the missing ARV');
if (out.D.from.indexOf('rep') < 0)    bad.push('D: no repair figure was assumed');
if (out.D.est < 2)                    bad.push(`D: ${out.D.est} of the two guesses were marked as estimates`);
if (out.D.flags < 2)                  bad.push('D: the row does not say on its face what was guessed');
if (!(out.D.roomLo < out.D.room))     bad.push('D: the cautious room is not below the optimistic one');

/* and switching them off leaves the row honestly unpriceable */
await p.evaluate(() => document.getElementById('bk-zip').click()); await p.waitForTimeout(800);
out.Doff = await p.evaluate(() => ({ priced: !!BULK.rows[0].best,
  txt: (document.querySelector('.bkt tbody tr')||{}).innerText || '' }));
if (out.Doff.priced) bad.push('D: turning the ZIP fill off still priced a row with no ARV');
if (!/Needs an ARV/i.test(out.Doff.txt)) bad.push('D: the unpriceable row does not say what it wants');

/* ── E · the refusals name the number ──────────────────────────────────── */
await land('the office');
await paste('7 Nowhere Lane\n8 Nothing Street, 90000');
out.E = await p.evaluate(() => [...document.querySelectorAll('.bkt tbody tr')]
  .map(t => (t.innerText||'').replace(/\s+/g,' ')));
if (!out.E.some(t => /Needs/i.test(t))) bad.push('E: a row that could not price gave no reason');

/* ── F · the tier line ─────────────────────────────────────────────────── */
for (const [plan, paid] of [['', false], ['solo', false], ['underwriter', false], ['the office', true]]){
  await land(plan);
  await paste('1104 Elm Street, Atlanta, GA 30310, 168000, 249000, 46000');
  const r = await p.evaluate(() => ({ table: !!document.querySelector('.bkt'),
    gate: !!document.querySelector('.bkgate'),
    parsed: bulkParse().recs.length,
    railed: !!document.getElementById('rn-bulk') }));
  out['F:' + (plan||'free')] = r;
  if (paid && !r.table) bad.push(`F: ${plan||'free'} paid for this and gets no table`);
  if (paid && r.gate)   bad.push(`F: ${plan||'free'} is being sold what it already has`);
  if (!paid && r.table) bad.push(`F: ${plan||'free'} got the whole feature`);
  if (!paid && !r.gate) bad.push(`F: ${plan||'free'} gets neither a table nor a reason`);
  if (r.parsed !== 1)   bad.push(`F: ${plan||'free'} cannot even see its list parse`);
  if (!r.railed)        bad.push(`F: ${plan||'free'} has no door to this room`);
}

out.errs = errs;
if (errs.length) bad.push('console errors — ' + errs.slice(0,2).join(' | '));

await b.close();
console.log(JSON.stringify(out, null, 1));
console.log(bad.length ? 'FAIL\n - ' + bad.join('\n - ')
  : 'PASS — the parser survives real lists, the list and the desk agree to the dollar, a draft is never a sheet, and a guessed row is ranked on its cautious end');
process.exit(bad.length ? 1 : 0);
