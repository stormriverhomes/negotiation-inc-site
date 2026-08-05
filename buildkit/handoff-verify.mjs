// ── the seam between the course and the desk ────────────────────────────────
// Asserts, for all seven desk-priceable exits: the link the course builds carries
// figures that actually appear in that lesson's own worked example (no drift),
// the desk loads them, opens the right exit, prices it, and says out loud that
// they are teaching figures — and that an in-progress sheet is never clobbered.
import { chromium } from 'playwright';
import fs from 'node:fs';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const F = [], ck = (c,m) => { if(!c) F.push(m); };
const out = {};

const p = await b.newPage({ viewport:{width:1200,height:1000} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
await p.goto('file:///home/claude/the-eight-exits.html'); await p.waitForTimeout(400);

// 1. every link the course generates, and the lesson text it must agree with
const links = await p.evaluate(()=>EXITS.map(E=>({
  n:E.n, id:E.id, title:E.title, url:E.desk?deskURL(E):null, desk:E.desk||null,
  dealText:E.turn.deal.map(d=>d[0]+' '+d[1]).join(' | '),
  sliderDef:E.turn.slider.def })));
out.links = links.map(l=>({n:l.n, url:l.url}));
ck(links.filter(l=>l.url).length===7, 'seven exits hand off; the land play does not');
ck(links.find(l=>l.id==='land').url===null, 'the land play refuses rather than faking a sheet');

// no drift: every number in a desk: block must appear in that lesson's own
// figures (the deal strip or the slider's default) — not a nearby made-up one
for (const l of links.filter(x=>x.desk)){
  const nums = String(l.dealText).match(/[\d,]+/g)?.map(s=>+s.replace(/,/g,'')) || [];
  nums.push(l.sliderDef);
  for (const [k,v] of Object.entries(l.desk)){
    if (typeof v !== 'number') continue;
    ck(nums.includes(v), `${l.n}: ${k}=${v} is not a figure in that lesson (${l.dealText})`);
  }
}

// 2. the strip is present on a worked-example pane, and on the land pane it refuses
await p.evaluate(()=>go(0,3)); await p.waitForTimeout(250);
out.paneStrip = await p.evaluate(()=>document.querySelector('.handoff')?.innerText.replace(/\n/g,' ')||'(none)');
ck(/Price this on the desk/.test(out.paneStrip), 'worked-example pane offers the desk');
await p.evaluate(()=>go(7,3)); await p.waitForTimeout(250);
out.landStrip = await p.evaluate(()=>document.querySelector('.handoff')?.innerText.replace(/\n/g,' ')||'(none)');
ck(/does not price this one/i.test(out.landStrip), 'the land pane says why it cannot');
await p.evaluate(()=>go(8,0)); await p.waitForTimeout(250);
out.ninth = await p.evaluate(()=>({ carry:[...document.querySelectorAll('.carry a')].map(a=>a.textContent),
  primary:document.querySelector('.row .btn.primary')?.innerText }));
ck(out.ninth.carry.length===7, 'the closing section carries all seven');
ck(/price your own deal/i.test(out.ninth.primary), 'the closing CTA leads with the blank sheet');
await p.close();

// 3. each link, followed for real: the desk fills, opens and prices it
out.landed = {};
for (const l of links.filter(x=>x.url)){
  const q = await b.newPage({ viewport:{width:1200,height:1200} });
  const e2=[]; q.on('pageerror',x=>e2.push(x.message)); q.on('console',m=>{if(m.type()==='error')e2.push(m.text())});
  await q.addInitScript(()=>{ try{ localStorage.clear(); }catch(e){} });
  await q.goto('file:///home/claude/desk.html'); await q.waitForTimeout(200);
  await q.goto('file:///home/claude/'+l.url); await q.waitForTimeout(700);
  const r = await q.evaluate(id=>({
    strip: document.querySelector('.fromc')?.innerText.replace(/\n/g,' ')||'(none)',
    fields: Object.fromEntries([...document.querySelectorAll('.field input')].map(i=>[i.dataset.f,i.value])),
    open: document.querySelector('.exit .exit-b') ? document.querySelector('.exit.open, .exit')?.id : null,
    named: !!document.getElementById('x-'+id),
    priced: (document.getElementById('x-'+id)?.innerText||'').length > 40,
    ranked: [...document.querySelectorAll('.exit')].length,
  }), l.desk.exit);
  out.landed[l.n] = { exit:l.desk.exit, ...r, errs:e2 };
  for (const [k,v] of Object.entries(l.desk)){
    if (typeof v !== 'number') continue;
    ck(r.fields[k] === v.toLocaleString('en-US'), `${l.n}: ${k} did not land on the sheet (got ${r.fields[k]})`);
  }
  ck(/Teaching example/i.test(r.strip), `${l.n}: the sheet does not say these are teaching figures`);
  ck(new RegExp(l.n+'\\b').test(r.strip), `${l.n}: the strip does not name the lesson`);
  ck(r.named, `${l.n}: ${l.desk.exit} is not on the ranked list`);
  ck(r.priced, `${l.n}: ${l.desk.exit} rendered but priced nothing`);
  ck(!e2.length, `${l.n}: console errors — ${e2.join('; ')}`);
  await q.close();
}

// 4. consent: an in-progress sheet is never overwritten without a yes
{
  const q = await b.newPage({ viewport:{width:1200,height:1000} });
  const e3=[]; q.on('pageerror',x=>e3.push(x.message));
  await q.goto('file:///home/claude/desk.html'); await q.waitForTimeout(200);
  await q.evaluate(()=>localStorage.clear());
  await q.reload(); await q.waitForTimeout(300);
  await q.fill('#addr','88 My Own Deal Rd');
  await q.fill('[data-f="asking"]','333,000'); await q.waitForTimeout(500);
  await q.goto('file:///home/claude/desk.html#asking=118000&arv=240000&repairs=38000&exit=wholesale&from=I&title=The%20wholesale');
  await q.waitForTimeout(600);
  const asked = await q.evaluate(()=>({ strip:document.querySelector('.fromc')?.innerText.replace(/\n/g,' ')||'(none)',
    asking:document.querySelector('[data-f="asking"]').value, addr:document.getElementById('addr').value }));
  await q.click('#c-keep'); await q.waitForTimeout(300);
  const kept = await q.evaluate(()=>({ strip:document.querySelector('.fromc')?.innerText||'', asking:document.querySelector('[data-f="asking"]').value }));
  await q.goto('file:///home/claude/desk.html#asking=118000&arv=240000&repairs=38000&exit=wholesale&from=I&title=The%20wholesale');
  await q.waitForTimeout(600);
  await q.click('#c-load'); await q.waitForTimeout(400);
  const loaded = await q.evaluate(()=>({ asking:document.querySelector('[data-f="asking"]').value,
    addr:document.getElementById('addr').value }));
  await q.click('#c-blank'); await q.waitForTimeout(150);   // arms
  const armedTxt = await q.evaluate(()=>document.getElementById('c-blank').textContent);
  const armedKept = await q.evaluate(()=>document.querySelector('[data-f="asking"]').value);
  await q.click('#c-blank'); await q.waitForTimeout(400);   // clears
  const blank = await q.evaluate(()=>({ asking:document.querySelector('[data-f="asking"]').value,
    strip:document.querySelector('.fromc')?document.querySelector('.fromc').innerText:'(gone)',
    saved:localStorage.getItem('ni-desk-case') }));
  out.consent = { asked, kept, loaded, armedTxt, armedKept, blank, e3 };
  ck(/Clear everything/.test(armedTxt) && armedKept==='118,000', 'first click arms; nothing is wiped yet');
  ck(/already have a sheet/i.test(asked.strip) && asked.asking==='333,000', 'an in-progress sheet is not overwritten on arrival');
  ck(kept.asking==='333,000' && !/wants to load/i.test(kept.strip), '"keep my sheet" keeps the sheet');
  ck(loaded.asking==='118,000' && loaded.addr==='', '"load the example" replaces the sheet');
  ck(blank.asking==='' && blank.strip==='(gone)' && !blank.saved, '"start a blank sheet" clears everything, strip included');
  ck(!e3.length, 'no errors in the consent path');
  await q.close();
}

// 5. the landing's sample obeys the same rule: labelled, and one click to empty
{
  const q = await b.newPage({ viewport:{width:1200,height:1000} });
  const e4=[]; q.on('pageerror',x=>e4.push(x.message)); q.on('console',m=>{if(m.type()==='error')e4.push(m.text())});
  await q.addInitScript(()=>{ try{ localStorage.clear(); }catch(e){} });
  await q.goto('file:///home/claude/desk.html#example'); await q.waitForTimeout(700);
  const filled = { strip:await q.evaluate(()=>document.querySelector('.fromc')?.innerText.replace(/\n/g,' ')||'(none)'),
    asking:await q.inputValue('[data-f="asking"]') };
  await q.click('#c-blank'); await q.waitForTimeout(150);   // arm
  await q.click('#c-blank'); await q.waitForTimeout(400);   // clear
  const empty = { asking:await q.inputValue('[data-f="asking"]'), addr:await q.inputValue('#addr'),
    strip:await q.evaluate(()=>document.querySelector('.fromc')?'(there)':'(gone)'),
    saved:await q.evaluate(()=>localStorage.getItem('ni-desk-case')) };
  out.sample = { filled, empty, e4 };
  /* the asking price is read out of desk.html rather than pinned here: when
     the worked example moved to a price the deal could survive, a pinned copy
     of the old one turned a correct product into a red test. */
  const EX_ASK = (fs.readFileSync('desk.html','utf8')
    .match(/Object\.assign\(S\.raw,\{asking:'([\d,]+)'/) || [])[1];
  ck(!!EX_ASK, 'handoff: cannot find the worked example in desk.html');
  ck(/Sample sheet/i.test(filled.strip) && filled.asking===EX_ASK, 'the landing sample says it is a sample');
  ck(empty.asking==='' && empty.addr==='' && empty.strip==='(gone)' && !empty.saved, 'arm-then-clear empties the sample sheet');
  ck(!e4.length, 'no errors on the sample path');
  await q.close();
}

console.log(JSON.stringify(out,null,1));
console.log(errs.length?('course errors: '+errs.join('; ')):'');
ck(!errs.length, 'no console errors on the course');
console.log(F.length ? 'FAIL:\n- '+F.join('\n- ') : 'PASS — the course hands off to the desk, both ways verified');
await b.close();
process.exit(F.length?1:0);
