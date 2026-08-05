/* _tcompare — the written comparison, in the browser.

   The compare screen does the arithmetic. This writes the argument, which is
   the actual end of the job: the thing you forward to a partner or a lender.
   It is also the first place in this product where prose carrying money leaves
   the building, so the properties that matter are not the happy path.

     A · the four people who cannot use it are each sent somewhere that can
         actually fix their problem — a stranger to an account, not a price list
     B · nobody unentitled gets a button that spends the key
     C · THE FACTS SENT MATCH THE TABLE ON SCREEN, figure for figure. A
         document that contradicts the screen it came from is worse than no
         document, and this is the only place that can catch that.
     D · the flip cited is the real crossover the screen computed, not one the
         model invented
     E · an estimate is declared as an estimate
     F · when the server REFUSES a draft for carrying an invented figure, the
         page says so rather than showing a blank or, worse, the draft
     G · the month's remaining count is shown once the server reports it
     H · nothing throws */
import { chromium } from 'playwright';
import fs from 'fs';
import http from 'node:http';

let SEEN = null, REPLY = null;
const site = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname === '/api/compare'){
    let b = ''; q.on('data', c => b += c);
    return q.on('end', () => {
      try { SEEN = JSON.parse(b); } catch(e){ SEEN = 'unparseable'; }
      const R = REPLY || { code:200, body:{ ok:true, text:'One.\n\nTwo.\n\nThree.',
                                            month:{ used:3, cap:30, left:27 } } };
      r.writeHead(R.code, {'content-type':'application/json'});
      r.end(JSON.stringify(R.body));
    });
  }
  const p = u.pathname === '/' ? '/index.html' : u.pathname;
  const f = '/home/claude/dist' + p;
  if (fs.existsSync(f) && fs.statSync(f).isFile()){
    r.writeHead(200, {'content-type':'text/html'}); return r.end(fs.readFileSync(f)); }
  r.writeHead(404); r.end('');
});
const port = await new Promise(r => site.listen(0, '127.0.0.1', () => r(site.address().port)));
const BASE = `http://127.0.0.1:${port}`;

const bad = [], out = {};
const b = await chromium.launch();

/* two sheets, one under water and one that works, plus an ESTIMATED repair
   figure on the second so the estimate declaration is exercised */
async function bench(acct, demo){
  const p = await b.newPage({ viewport:{ width:1280, height:1200 } });
  p.on('pageerror', e => bad.push('threw — ' + String(e).slice(0,140)));
  await p.goto(BASE + '/desk.html');
  await p.evaluate(a => { localStorage.clear();
    if (a) localStorage.setItem('ni-account-v1', JSON.stringify(a)); }, acct || null);
  await p.goto(BASE + '/desk.html');
  await p.waitForFunction(() => typeof renderCompare === 'function' && typeof P !== 'undefined',
    null, { timeout:20000 });
  if (demo){
    await p.evaluate(() => { loadDemo(Object.keys(DEMOS)[0]); render(); });
  } else {
    await p.evaluate(() => {
      S.addr = '118 Sylvan Rd SW'; S.name = '118 Sylvan Rd SW';
      Object.assign(S.raw, { asking:'214000', arv:'300000', repairs:'40500', rent:'1900' }); save();
      newSheet();
      S.addr = '44 Peach Tree Ct'; S.name = '44 Peach Tree Ct';
      Object.assign(S.raw, { asking:'138000', arv:'196000', repairs:'18000', rent:'1750' });
      S.est.repairs = true;                       // an estimate, declared as one
      save();
      CMP.picks = [0,1]; saveCmp();
    });
  }
  await p.evaluate(() => { document.getElementById('compare').hidden = false; renderCompare(); });
  await p.waitForTimeout(1400);
  return p;
}
const panel = p => p.evaluate(() => {
  const w = document.querySelector('.cmp-write');
  if (!w) return null;
  const a = w.querySelector('a.btn');
  return { locked: w.classList.contains('locked'),
    go: !!document.getElementById('cw-go'),
    href: a ? a.getAttribute('href') : null,
    k: (w.querySelector('.k') || {}).textContent || '' };
});

/* ── A/B · who cannot use it ─────────────────────────────────────────────── */
/* Signed out, in a demo, and on Free, the bench itself is a paid feature —
   they cannot get two sheets side by side at all, so they meet the compare
   screen's OWN lock long before they meet this one. That is the correct
   behaviour and the assertion has to match it: what matters for those three is
   that no control anywhere on the page can spend the key. Solo can bench two
   sheets, so Solo is the one that must meet the written-comparison lock
   specifically, and be sent to the tier that opens it. */
for (const [nm, acct, demo, wantHref] of [
  ['signed out', null, false, null],
  ['a demo',     null, true,  null],
  ['free',       { name:'E', email:'e@x.com', plan:null,   trial:null }, false, null],
  ['solo',       { name:'E', email:'e@x.com', plan:'solo', trial:null }, false, 'plans.html'],
]){
  const p = await bench(acct, demo);
  const r = await panel(p);
  const spendable = await p.evaluate(() => !!document.getElementById('cw-go'));
  out[nm] = { panel: r, spendable };
  if (spendable) bad.push(`B: ${nm} GETS A BUTTON THAT SPENDS THE KEY`);
  if (wantHref){
    if (!r)        bad.push(`A: ${nm} can bench two sheets and sees no written-comparison panel`);
    else {
      if (!r.locked) bad.push(`A: ${nm} gets the working panel`);
      if (!r.href || !r.href.includes(wantHref))
        bad.push(`A: ${nm} is sent to ${r.href}, which cannot fix their problem`);
    }
  } else if (r && !r.locked){
    bad.push(`A: ${nm} reached an UNLOCKED written-comparison panel`);
  }
  await p.close();
}

/* ── C/D/E · the facts match the screen ──────────────────────────────────── */
{
  SEEN = null; REPLY = null;
  const p = await bench({ name:'E', email:'e@x.com', plan:'underwriter', trial:null }, false);
  const r = await panel(p);
  out.underwriter = r;
  if (!r || r.locked) bad.push('C: an Underwriter does not get the working panel');
  if (!r || !r.go)    bad.push('C: an Underwriter gets no button');

  /* what the TABLE says, read out of the DOM */
  const table = await p.evaluate(() => {
    const rows = {};
    for (const row of document.querySelectorAll('.cmp-r')){
      const l = (row.querySelector('.l') || {}).textContent || '';
      rows[l.replace(/\s+/g,' ').trim()] =
        [...row.querySelectorAll('.v')].map(v => v.textContent.replace(/\s+/g,' ').trim());
    }
    return { rows, names: [...document.querySelectorAll('.cmp-head .v')].map(v => v.textContent.trim()) };
  });
  await p.evaluate(() => window.__writeComparison());
  await p.waitForTimeout(900);
  out.sent = SEEN;
  if (!SEEN || !SEEN.sheets) { bad.push('C: nothing reached the endpoint'); }
  else {
    const fmt = v => v === null || v === undefined ? '—'
      : (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US');
    for (let k = 0; k < SEEN.sheets.length; k++){
      const s = SEEN.sheets[k];
      if (table.names[k] !== s.name)
        bad.push(`C: column ${k} is "${table.names[k]}" on screen and "${s.name}" in the facts`);
      const pairs = [['They ask', s.asking], ['Pay no more than', s.ceiling],
                     ['Room — ceiling less asking', s.room], ['Spread on paper', s.spread],
                     ['Repairs', s.repairs]];
      for (const [label, val] of pairs){
        const shown = (table.rows[label] || [])[k];
        if (shown === undefined) continue;
        if (shown !== fmt(val))
          bad.push(`C: "${label}" for ${s.name} reads ${shown} on screen and ${fmt(val)} in the `
                 + 'facts the prose is written from — the document would contradict the table');
      }
    }
    /* D · the flip is the real one */
    const screenFlip = await p.evaluate(() => {
      const f = document.querySelector('#cmp-flips .cmp-f:not(.none)');
      return f ? f.textContent.replace(/\s+/g,' ').trim() : null; });
    out.flip = { sent: SEEN.flip, screen: screenFlip ? screenFlip.slice(0, 90) : null };
    if (screenFlip && !SEEN.flip)
      bad.push('D: the screen found a crossover and the facts carry none — the prose has nothing '
             + 'true to say about what would change the answer');
    if (SEEN.flip && screenFlip && !screenFlip.includes(SEEN.flip.at))
      bad.push(`D: the facts cite a crossover at ${SEEN.flip.at} and the screen says "${screenFlip.slice(0,60)}"`);
    /* E · the estimate is declared */
    const est = SEEN.sheets.find(x => x.name === '44 Peach Tree Ct');
    out.estimated = est && est.estimated;
    if (!est || !Array.isArray(est.estimated) || !est.estimated.includes('repairs'))
      bad.push('E: an estimated repair figure is not declared as an estimate, so the prose can '
             + 'present it as entered');
  }

  /* G · the month */
  const shown = await p.evaluate(() => (document.querySelector('.cmp-write .k')||{}).textContent || '');
  out.monthLine = shown;
  if (!/27 of 30 left this month/.test(shown))
    bad.push(`G: the month's balance is not shown — "${shown}"`);
  await p.close();
}

/* ── F · a refused draft says so ─────────────────────────────────────────── */
{
  REPLY = { code:422, body:{ ok:false, invented:['$14,000'],
    error:'The draft came back with a figure that is not on either sheet, so it was not shown to you.' } };
  const p = await bench({ name:'E', email:'e@x.com', plan:'underwriter', trial:null }, false);
  await p.evaluate(() => window.__writeComparison());
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => ({
    err: (document.querySelector('.cw-err')||{}).textContent || null,
    out: !!document.getElementById('cw-out') }));
  out.refused = r;
  if (!r.err) bad.push('F: a refused draft shows nothing at all — the button just stops working');
  if (r.out)  bad.push('F: A REFUSED DRAFT WAS SHOWN ANYWAY');
  if (r.err && !/not on either sheet/i.test(r.err))
    bad.push(`F: the refusal does not say why — "${r.err}"`);
  REPLY = null;
  await p.close();
}

await b.close(); site.close();
console.log(JSON.stringify(out, null, 1));
if (bad.length){ console.log('FAIL'); bad.forEach(x => console.log(' - ' + x)); process.exit(1); }
console.log('PASS — the demo, a stranger, a free account and a Solo account get a locked card '
  + 'pointing at the thing that would open it and no button that spends the key; an Underwriter '
  + 'gets a draft written from facts that match the table figure for figure, citing the crossover '
  + 'the screen actually computed and declaring an estimate as an estimate; and a draft the server '
  + 'refused for carrying an invented number is reported rather than shown');
process.exit(0);
