/* ══ THE LAND DESK, WALKED ══════════════════════════════════════════════════
   The page is held to the same ledger the engine's tests and the build guard
   hold the module to — but HERE it is the RENDERED text that answers, because
   a page can disagree with its own engine in the wiring. Then the grammar:
   refusals that say what they need, the septic named inside the estimate, the
   firm list, no Google credit on a page with no Google imagery, and the sheet
   below the ground at 390 with the verdict present. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve('dist/land.html');

let n = 0, bad = 0;
const ok = (name, pass) => { n++; if (!pass){ bad++; console.log('✗ ' + name); } else console.log('✓ ' + name); };

/* ── IS THIS THE BUILD, OR THE SOURCE WEARING ITS NAME? ────────────────────
   The source and the artefact are both called land.html. I copied the source
   over the built file on the way to the server and shipped a page whose very
   first line of arithmetic threw `landModel is not defined` — every figure
   gone, the floor blank, and nothing on the page admitting it. A file that
   still carries the injection marker is not a build, and no harness that
   loads it should report anything else first. */
{
  const src = (await import('node:fs')).readFileSync('dist/land.html', 'utf8');
  ok('dist/land.html is BUILT (engine injected, marker gone)',
     !src.includes('__LAND_ENGINE__') && /function landModel/.test(src));
  if (bad){ console.log('\n✗ refusing to test an unbuilt file — run publish.mjs'); process.exit(1); }
}

const b = await chromium.launch();
for (const W of [1440, 390]){
  const pg = await b.newPage({ viewport:{ width: W, height: 950 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(FILE);
  await pg.waitForTimeout(300);

  /* blank sheet: refused, and the refusal names the need */
  let t = await pg.evaluate(() => document.getElementById('sheet').innerText.replace(/\s+/g,' '));
  ok(W+': blank sheet refuses rather than guesses', /Not priced — it needs what the finished lot sells for/.test(t));
  ok(W+': the refusal is a door, not a shrug', /Comps for finished lots/.test(t));

  /* the worked example: the approved ledger, to the dollar, in rendered text */
  await pg.click('#demo');
  await pg.waitForTimeout(250);
  t = await pg.evaluate(() => document.getElementById('sheet').innerText.replace(/\s+/g,' '));
  ok(W+': clears $21,640',            t.includes('$21,640'));
  ok(W+': cost of sale −$20,860',     t.includes('$20,860'));
  /* the target lives in an input — innerText cannot see a placeholder, so it
     is read as the component it is, then the sentence around it */
  const target = await pg.evaluate(() => { const el = document.querySelector('[data-k="target"]');
    return el ? (el.value || el.placeholder) : null; });
  ok(W+': concession — the derived $35,000 target', target === '35,000');
  ok(W+': concession — buy at $200,640 or less', /To clear \$.*buy at \$200,640 or less/.test(t));
  ok(W+': per-acre $81,992 — the figure the design doc got wrong', t.includes('$81,992 per acre'));
  ok(W+': septic named INSIDE the site line', /inside it: septic install, unconfirmed \$18,000/.test(t));
  ok(W+': before this prices firm', /Before this prices firm/i.test(t));
  ok(W+': access unverified is on the firm list', /Road access is not verified/.test(t));

  /* the ground: chips carry provenance; the floor carries no false credit */
  const g = await pg.evaluate(() => ({
    body: document.body.innerText,
    floor: document.getElementById('floor').innerText,
    chipTags: [...document.querySelectorAll('#chips .chip .tag, #rail .tag')].map(x => x.textContent),
    railN: document.querySelectorAll('#rail .pill').length,
    chipN: document.querySelectorAll('#chips .chip').length,
  }));
  ok(W+': six facts on the ground', (W > 1000 ? g.chipN : g.railN) === 6);
  ok(W+': a fact still missing reads NEEDED', g.chipTags.includes('NEEDED'));
  ok(W+': no Google credit without Google imagery', !/google/i.test(g.body));
  ok(W+': the floor says why the ground is a sketch', /prices without the ground/.test(g.floor));

  /* ── AND THE FLOOR SURVIVES A RE-PRICE ───────────────────────────────────
     renderGround() runs on every keystroke. With the 3D ground up it must
     leave the floor alone, because the floor is where Google's attribution
     lives — tearing it out mid-session while tiles keep rendering is a terms
     violation caused by typing. Simulated here without Cesium: raise the
     flag, plant a marker in the floor, re-price, and check it is still there. */
  const kept = await pg.evaluate(() => {
    G3.on = true;
    document.getElementById('floor').innerHTML = '<span id="credit-probe">ATTRIBUTION</span>';
    renderSheet();
    const still = !!document.getElementById('credit-probe');
    G3.on = false; renderSheet();
    return still;
  });
  ok(W+': a re-price cannot tear the attribution out of the floor', kept);

  /* the walk-away shape: raise the ask past the line, the page says so */
  await pg.evaluate(() => { const el = document.querySelector('[data-k="asking"]');
    el.value = '329,000'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await pg.waitForTimeout(200);
  t = await pg.evaluate(() => document.getElementById('sheet').innerText.replace(/\s+/g,' '));
  ok(W+": past the line, the play refuses to price at their number", /doesn.t price at their number/.test(t));
  ok(W+': the working number is still stated', t.includes('$200,640'));

  /* ── CARRY MOVES THE LEDGER, BECAUSE IT IS PASSED NOW ────────────────────
     months and carryMo were never handed to the engine: the row said "site
     work + carry, 9 mo" while carry multiplied nothing by nothing. Type a
     monthly figure and the payday must fall by months × monthly — on the
     worked example at the reduced ask, 9 × $600 = $5,400. */
  await pg.evaluate(() => { const el = document.querySelector('[data-k="asking"]');
    el.value = '214,000'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await pg.waitForTimeout(150);
  await pg.evaluate(() => { const el = document.querySelector('[data-k="carryMo"]');
    el.value = '600'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await pg.waitForTimeout(200);
  t = await pg.evaluate(() => document.getElementById('sheet').innerText.replace(/\s+/g,' '));
  ok(W+': a monthly carry figure actually costs months × monthly', t.includes('$5,400'));
  ok(W+': and the payday falls by exactly that', t.includes('$16,240'));
  await pg.evaluate(() => { const el = document.querySelector('[data-k="carryMo"]');
    el.value = ''; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await pg.waitForTimeout(150);
  t = await pg.evaluate(() => document.getElementById('sheet').innerText.replace(/\s+/g,' '));
  ok(W+': empty carry says it is in the site figure, not that it is zero', /in site work/.test(t));
  ok(W+': and the ledger returns to the approved figure', t.includes('$21,640'));

  /* ── THE PRICE IS A THING YOU CAN HOLD ───────────────────────────────────
     clearsAt() existed from the first commit and no surface used it. Drag
     the try-price and the payday must answer — at the ask it must agree with
     the headline to the dollar, and past the ceiling the sentence must turn. */
  const slide = await pg.evaluate(() => {
    const tp = document.getElementById('tryprice');
    if (!tp) return null;
    const read = () => tp.nextElementSibling.textContent.replace(/\s+/g,' ');
    tp.value = '214000'; tp.dispatchEvent(new Event('input'));
    const atAsk = read();
    tp.value = '200600'; tp.dispatchEvent(new Event('input'));   // within the detent
    const under = read();
    return { atAsk, under };
  });
  ok(W+': the try-price slider exists', !!slide);
  ok(W+': at their number it clears what the headline says', !!slide && /\$21,640/.test(slide.atAsk));
  ok(W+': near the ceiling the detent lands ON it, to the dollar',
     !!slide && /\$200,640 → the play clears \$35,000/.test(slide.under) && /your ceiling, to the dollar/.test(slide.under));
  ok(W+': at the ask, above the ceiling, it says the clear is thin', !!slide && /thinner than your/.test(slide.atAsk));

  /* ── THE GROUND IS A PRESS, AND file:// SAYS SO ──────────────────────────
     Loading tiles on arrival spent a billed session on every drive-by and
     failed SILENTLY when rate-limited — the "maps are buggy" report. The
     button makes every state a sentence. Under file:// it must be disabled
     and say why, not pretend a press would work. */
  const raise = await pg.evaluate(() => { const b = document.getElementById('raise');
    return b ? { disabled: b.disabled, text: b.textContent } : null; });
  ok(W+': the raise button exists', !!raise);
  ok(W+': and under file:// it is honest about needing the live site',
     !!raise && raise.disabled && /live site/.test(raise.text));
  const cam = await pg.evaluate(() =>
    [...document.querySelectorAll('.gctl button:not(#raise)')].every(b => b.disabled));
  ok(W+': the camera pills stay disabled until the ground is up', cam);

  /* ── THE WAY IN, DELIVERED ───────────────────────────────────────────────
     The refusal has said since the first commit: "Comps for finished lots
     nearby are the way in." Now there is a door where that sentence points.
     Two sold lots draw a line and land as an ESTIMATE; a third makes a
     cluster and lands as ENTERED — the same earned-narrowness rule the house
     bench uses. Driven through the page's own inputs, not through state. */
  await pg.evaluate(() => { document.getElementById('clear').click(); });
  await pg.waitForTimeout(200);
  const typeLot = async (i, vals) => {
    for (const [k, v] of Object.entries(vals))
      await pg.evaluate(([i2, k2, v2]) => {
        const el = document.querySelector(`[data-lot="${k2}"][data-li="${i2}"]`);
        el.value = v2; el.dispatchEvent(new Event('change'));
      }, [i, k, v]);
  };
  await pg.evaluate(() => { const el = document.querySelector('[data-k="acres"]');
    el.value = '2.61'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await pg.waitForTimeout(120);
  await pg.evaluate(() => { const el = document.querySelector('[data-k="lump"]');
    el.value = '41,500'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await pg.waitForTimeout(120);
  await pg.click('#lots-toggle'); await pg.waitForTimeout(150);
  t = await pg.evaluate(() => document.getElementById('sheet').innerText.replace(/\s+/g,' '));
  ok(W+': the door opens with the case for sold lots', /beat any guess/.test(t), t.slice(0,200));
  await typeLot(0, { price:'300,000', acres:'2.5', months:'3', dist:'0.8' });
  await pg.click('#lots-add'); await pg.waitForTimeout(120);
  await typeLot(1, { price:'280,000', acres:'2.4', months:'14', dist:'2.2' });
  await pg.waitForTimeout(150);
  t = await pg.evaluate(() => document.getElementById('sheet').innerText.replace(/\s+/g,' '));
  ok(W+': two lots draw a line and say so', /two sales are a line, not a cluster/i.test(t), t.slice(0,400));
  const sug = await pg.evaluate(() => { const b = document.getElementById('lots-take');
    return b ? b.textContent : null; });
  ok(W+': the suggestion is offered', !!sug && /Use \$/.test(sug), sug);
  await pg.click('#lots-take'); await pg.waitForTimeout(200);
  let fin = await pg.evaluate(() => ({ raw: S.raw.finished, est: !!S.est.finished }));
  ok(W+': two lots land the figure as an ESTIMATE', fin.est === true && !!fin.raw, fin);
  ok(W+': and the play prices on it', await pg.evaluate(() =>
      /the most you can pay|what the play clears/i.test(document.getElementById('sheet').innerText)));
  await pg.click('#lots-add'); await pg.waitForTimeout(120);
  await typeLot(2, { price:'310,000', acres:'2.7', months:'5', dist:'1.1' });
  await pg.waitForTimeout(150);
  await pg.click('#lots-take'); await pg.waitForTimeout(200);
  fin = await pg.evaluate(() => ({ raw: S.raw.finished, est: !!S.est.finished }));
  ok(W+': a third sold lot earns ENTERED', fin.est === false && !!fin.raw, fin);
  /* the suggestion sits inside the sales that produced it, per acre */
  const inside = await pg.evaluate(() => {
    const v = parseFloat(String(S.raw.finished).replace(/[^0-9.]/g,''));
    const per = [300000/2.5, 280000/2.4, 310000/2.7].map(x => x*2.61).sort((a,b)=>a-b);
    return { v, lo: per[0], hi: per[2], inside: v >= per[0]-500 && v <= per[2]+500 };
  });
  ok(W+': the adopted figure sits inside its own sales', inside.inside, inside);
  /* and the lots survive a reload with the sheet */
  await pg.reload(); await pg.waitForTimeout(300);
  const keptLots = await pg.evaluate(() => (S.lots||[]).length);
  ok(W+': the sold lots survive a reload', keptLots === 3, keptLots);
  /* leave the worked example loaded for the reload assertion below */
  await pg.evaluate(() => { document.getElementById('demo').click(); });
  await pg.waitForTimeout(250);
  await pg.evaluate(() => { const el = document.querySelector('[data-k="asking"]');
    el.value = '329,000'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await pg.waitForTimeout(200);

  /* ── SITE WORK BY LINE: THE ITEMS TAKE OVER FROM THE LUMP ────────────────
     siteCarryOf() has taken an items array since the first commit — "the
     moment items exist they win" — and no surface ever built one, so the
     sheet's largest variable stayed a single gut figure long after the
     person had quotes. Deliberately figures, not sliders: a driveway costs
     what a driveway costs and does not scale with the finished lot value. */
  await pg.evaluate(() => { document.getElementById('demo').click(); });
  await pg.waitForTimeout(250);
  const lumpFirst = await pg.evaluate(() => document.getElementById('sheet').innerText.replace(/\s+/g,' '));
  ok(W+': the lump alone still prices the approved ledger', lumpFirst.includes('$21,640'), lumpFirst.slice(0,120));
  await pg.click('#site-toggle'); await pg.waitForTimeout(200);
  t = await pg.evaluate(() => document.getElementById('sheet').innerText.replace(/\s+/g,' '));
  ok(W+': the lines explain the handover from the lump', /a sum of quotes outranks a gut figure/.test(t), t.slice(0,200));
  const setSite = async (id, v) => pg.evaluate(([i2,v2]) => {
    const el = document.querySelector(`[data-site="${i2}"]`);
    el.value = v2; el.dispatchEvent(new Event('change'));
  }, [id, v]);
  await setSite('access', '18,000');
  await setSite('power',  '9,500');
  await pg.waitForTimeout(200);
  t = await pg.evaluate(() => document.getElementById('sheet').innerText.replace(/\s+/g,' '));
  ok(W+': two priced lines total themselves', /\$27,500/.test(t), t.slice(0,300));
  ok(W+': and say they replace the lump', /these replace the lump above/.test(t));
  /* the engine adds its own $18,000 septic while none is priced, so the
     total the sheet carries is 27,500 + 18,000 */
  const carried = await pg.evaluate(() => { const m = model(); return { site: m.site, refused: !!m.refused }; });
  ok(W+': the unpriced septic allowance is still inside the total',
     carried.site === 27500 + 18000, carried);
  ok(W+': and the sheet says the assumption is still standing',
     /still carrying its own \$18,000 allowance/.test(t), t.slice(0,400));
  await setSite('septic', '21,000');
  await pg.waitForTimeout(200);
  const after = await pg.evaluate(() => model().site);
  ok(W+': pricing the septic line retires the allowance', after === 27500 + 21000, after);
  t = await pg.evaluate(() => document.getElementById('sheet').innerText.replace(/\s+/g,' '));
  ok(W+': and the assumption sentence goes away', !/still carrying its own/.test(t));
  /* items win over the lump, which is the engine's own documented rule */
  ok(W+': the ledger prices on the items, not the lump',
     /\$48,500/.test(t), t.slice(0,400));
  /* and they survive a reload with everything else */
  await pg.reload(); await pg.waitForTimeout(300);
  const keptSite = await pg.evaluate(() => (S.site||[]).filter(x => x.v).length);
  ok(W+': the priced lines survive a reload', keptSite === 3, keptSite);
  await pg.evaluate(() => { document.getElementById('demo').click(); });
  await pg.waitForTimeout(250);
  await pg.evaluate(() => { const el = document.querySelector('[data-k="asking"]');
    el.value = '329,000'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await pg.waitForTimeout(200);

  /* state survives a reload — it is a sheet, not a toy */
  await pg.reload(); await pg.waitForTimeout(300);
  t = await pg.evaluate(() => document.getElementById('sheet').innerText.replace(/\s+/g,' '));
  ok(W+': the sheet survives a reload', t.includes('$200,640'));

  ok(W+': no page errors', errs.length === 0);
  if (errs.length) console.log('   ' + errs.join('\n   '));
  await pg.close();
}

/* ══ THE FACTS PRICE THE WORK ══════════════════════════════════════════════
   Acreage, slope and tree cover used to be captions on a picture: they moved
   no number anywhere, which is the exact sin the carry row's own comment names
   — "a months box that changes no number is worse than no box" — committed on
   the largest variable on the sheet. They price site work now, and this holds
   the wiring between the two.

   The refusals matter more than the figures. A well cannot be honestly
   estimated — depth is the cost, depth is unknowable before somebody drills,
   and the two published 2026 national averages disagree by a factor of two —
   so the panel must offer NO chip there, ever. A confident number on that line
   is the kind of wrong that makes somebody distrust every other figure on the
   page. */
{
  const pg = await b.newPage({ viewport:{ width:1500, height:1200 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0,160)));
  await pg.goto(FILE); await pg.waitForTimeout(400);
  await pg.evaluate(() => { loadWorked(); S.siteOpen = true; save(); renderSheet(); });
  await pg.waitForTimeout(300);
  const B = 'bench';

  const look = () => pg.evaluate(() => ({
    chips: [...document.querySelectorAll('[data-sb]')].map(x => x.dataset.sb),
    calls: [...document.querySelectorAll('.sbcall')].length,
    needs: [...document.querySelectorAll('.sbneed')].map(x => x.innerText),
    text:  document.getElementById('sheet').innerText.replace(/\s+/g,' '),
  }));
  let r = await look();
  ok(B+': the facts put figures on the lines', r.chips.length >= 8);
  ok(B+': a well offers no figure to press — it cannot be honestly guessed',
     !r.chips.some(c => c.startsWith('water:')));
  ok(B+': and says so as a phone call, with who to ring', r.calls === 1
     && /This one is a phone call/.test(r.text) && /well drillers/.test(r.text));
  ok(B+': the power line refuses the tap without refusing the wire',
     r.chips.some(c => c.startsWith('power:')) && /transformer/i.test(r.text));
  ok(B+': the permit line refuses impact fees out loud', /IMPACT FEES ARE NOT IN THIS/.test(r.text));
  ok(B+': septic prices both branches', r.chips.filter(c => c.startsWith('septic:')).length === 2
     && /it percs/.test(r.text) && /it fails/.test(r.text));
  ok(B+': and points at the perc test as the way out of the fork', /perc test is \$800/.test(r.text));

  /* the notes are load-bearing and there are eight of them — the sentence that
     costs somebody money is visible, the paragraph is one press away */
  ok(B+': the clearing warning that saves a foundation is NOT hidden',
     /Grubbed, not mulched\./.test(r.text));
  ok(B+': but the paragraph behind it is', !/mulching quote comes in at a third/.test(r.text));
  await pg.click('[data-sw="clear"]'); await pg.waitForTimeout(200);
  r = await look();
  ok(B+': and it opens on a press', /mulching quote comes in at a third/.test(r.text));
  await pg.click('[data-sw="clear"]'); await pg.waitForTimeout(200);
  ok(B+': and closes again',
     !/mulching quote comes in at a third/.test((await look()).text));

  /* a fact taken away takes its figure with it — the panel asks rather than
     inventing, which is the whole difference between this and a calculator */
  await pg.evaluate(() => { S.trees = ''; save(); renderSheet(); });
  await pg.waitForTimeout(200);
  r = await look();
  ok(B+': pull the tree cover and the clearing figure goes with it',
     !r.chips.some(c => c.startsWith('clear:')));
  ok(B+': and the line asks for the fact by name', r.needs.some(x => /tree cover/.test(x)));
  await pg.evaluate(() => { S.trees = 'wooded'; save(); renderSheet(); });
  await pg.waitForTimeout(200);
  ok(B+': put it back and the figure returns',
     (await look()).chips.some(c => c.startsWith('clear:')));

  /* the grade moves the lines it should. Steeper ground is more earthwork; a
     permit fee does not care how the ground falls. */
  const drainAt = async g => { await pg.evaluate(x => { S.slope = x; save(); renderSheet(); }, g);
    await pg.waitForTimeout(160);
    return pg.evaluate(() => { const el = [...document.querySelectorAll('[data-sb]')]
      .find(x => x.dataset.sb.startsWith('drain:')); return el ? el.innerText : ''; }); };
  const flat = await drainAt('flat'), steep = await drainAt('severe');
  const money = t => Number((t.match(/\$([\d,]+)/)||[0,'0'])[1].replace(/,/g,''));
  ok(B+': severe ground costs multiples of flat', money(steep) > money(flat) * 3);
  await pg.evaluate(() => { S.slope = 'roll'; save(); renderSheet(); });
  await pg.waitForTimeout(200);

  /* ── PRESSING ONE IS TAKING AN ESTIMATE ────────────────────────────────
     A rule of thumb is not a quote. It lands marked, the engine widens the
     whole answer for it, and the flip beside it is how it becomes yours. */
  const before = await pg.evaluate(() => ({ site: model().site, spread: model().spread }));
  await pg.click('[data-sb="clear:0"]'); await pg.waitForTimeout(250);
  const after = await pg.evaluate(() => ({ site: model().site, spread: model().spread,
    est: (S.site.find(x => x.id === 'clear')||{}).est,
    v: (S.site.find(x => x.id === 'clear')||{}).v,
    input: (document.getElementById('si-clear')||{}).value }));
  ok(B+': the figure lands in the line', Number(after.v) > 0 && after.input === String(after.v));
  ok(B+': as an ESTIMATE, never as a quote', after.est === true);
  ok(B+': and the answer widens for it', after.spread > 0);

  /* ── THE TAKEOVER SAYS WHAT IT TOOK ────────────────────────────────────
     One press replaced a $41,500 lump with $2,700 and moved the ceiling
     nearly forty thousand dollars — in the buyer's favour, with nothing on
     screen admitting it. The takeover is correct; being silent was not. */
  r = await look();
  ok(B+': a takeover that moves the ceiling says so on screen',
     /have replaced the \$41,500/.test(r.text));
  ok(B+': naming the swing in dollars', /less site work/.test(r.text));
  ok(B+': and telling them how to put it back', /clear them and keep the lump/.test(r.text));
  const disp = await pg.evaluate(() => model().displaced);
  ok(B+': the model carries the displacement', disp && disp.was === 41500 && disp.by > 0);

  /* the parcel block says why it is asking, because "why am I being asked
     this" is the question that closes a form */
  ok(B+': the facts block names what each one prices',
     /price the site work below/.test(r.text) && /PRICES CLEARING|prices clearing/i.test(
       await pg.evaluate(() => document.querySelector('.facts').innerText)));

  ok(B+': no page errors', errs.length === 0);
  if (errs.length) console.log('   ' + errs.join('\n   '));
  await pg.close();
}

/* ══ THIS ROOM KNOWS WHO IS IN IT ══════════════════════════════════════════
   It did not. grep for tierOf, entitled or signedIn in land.html returned
   ZERO, and the page was not on the build's list of pages that get the account
   script — the Land Desk was outside the product.

   The consequence was a pricing page contradicting itself. plans.html sells
   "The comp workbench — score sales yourself. Three in this browser, twelve a
   week with a free account", and the sold-lot bench handed a total stranger
   EIGHT while the house sheet two clicks away told the same person three. */
{
  const acct = a => `localStorage.clear(); ${a ? `localStorage.setItem('ni-account-v1', ${JSON.stringify(JSON.stringify(a))});` : ''}`;
  const W = 'account';
  const open = async a => {
    const pg = await b.newPage({ viewport:{ width:1400, height:1100 } });
    pg.on('pageerror', e => bad += (console.log('✗ ' + W + ': page error — ' + e), 1));
    await pg.goto(FILE);
    await pg.evaluate(js => eval(js), acct(a));
    await pg.goto(FILE);
    await pg.waitForFunction(() => typeof renderSheet === 'function' && typeof tierOf === 'function',
      null, { timeout: 20000 });
    await pg.evaluate(() => { S.lotsOpen = true; save(); renderSheet(); });
    await pg.waitForTimeout(200);
    return pg;
  };
  const fill = async pg => { for (let i = 0; i < 12; i++){
      const el = await pg.$('#lots-add'); if (!el) break; await el.click(); await pg.waitForTimeout(70); }
    return pg.evaluate(() => ({ lots:(S.lots||[]).length, room:lotRoom().room, rung:lotRoom().rung,
      add: !!document.getElementById('lots-add'),
      wall: (document.querySelector('.lwall')||{innerText:''}).innerText.replace(/\s+/g,' ') })); };

  /* a stranger gets the number the pricing page promises a stranger */
  {
    const pg = await open(null);
    ok(W+': the room can tell a stranger from a customer', await pg.evaluate(() => tierOf()) === 0);
    const r = await fill(pg);
    ok(W+': a stranger gets THREE sold lots, not eight', r.lots === 3);
    ok(W+': and the bench closes rather than pretending', r.add === false && r.room === 0);
    ok(W+': the wall names the number it stopped at', /Three sold lots in this browser\./.test(r.wall));
    ok(W+': and sends them somewhere that would actually help — an account, not a price list',
       /free account/.test(r.wall) && !/See plans/.test(r.wall));
    ok(W+': and says the allowance is shared, because it is',
       /across the house sheet and this one/.test(r.wall));
    await pg.close();
  }
  /* ── THE RUNG THAT USED TO WEAR THE GUEST'S CLOTHES ────────────────────
     Signed in, allowance unreadable — the deliberate degrade for a server
     function that is not deployed yet. It fell through to the guest wall in
     BOTH rooms, so a member was told to go and make an account they already
     had. The house desk's own comment says that block exists to prevent
     exactly this, and it survived in the one branch nobody reads. */
  {
    const pg = await open({ name:'E', email:'e@x.com', plan:null });
    const r = await fill(pg);
    ok(W+': a member with no readable balance is not treated as a stranger',
       r.rung === 'account-unknown');
    ok(W+': and is NOT told to make an account they already have',
       !/A free account carries/.test(r.wall) && !/Make an account/.test(r.wall));
    ok(W+': the wall says the true thing instead', /allowance could not be read/.test(r.wall));
    ok(W+': and promises nothing they scored is lost', /goes anywhere/.test(r.wall));
    await pg.close();
  }
  /* a plan buys the whole bench */
  {
    const pg = await open({ name:'E', email:'e@x.com', plan:'underwriter' });
    ok(W+': a plan paints as a plan', await pg.evaluate(() => tierOf()) >= 2);
    const r = await fill(pg);
    ok(W+': and buys the whole bench', r.lots === 8 && r.rung === 'paid');
    ok(W+': which still stops — eight is the bench, not a spreadsheet', r.add === false);
    await pg.close();
  }
  /* the grammar is the SHARED one: a demo may paint, it may never spend, and
     a blank plan string is not a plan */
  {
    const pg = await open({ name:'E', email:'e@x.com', plan:'   ' });
    ok(W+': a stray blank plan string does not buy a tier',
       await pg.evaluate(() => tierOf()) === 0);
    ok(W+': and entitled() agrees', await pg.evaluate(() => entitled(1)) === false);
    await pg.close();
  }
  {
    const pg = await open({ name:'E', email:'e@x.com', plan:null,
                            trial:new Date().toISOString().slice(0,10) });
    ok(W+': a live trial is the paid product with the invoice deferred',
       await pg.evaluate(() => tierOf()) === 3 && await pg.evaluate(() => entitled(2)) === true);
    await pg.close();
  }
  /* and the account layer actually arrived on this page */
  {
    const src = (await import('node:fs')).readFileSync('dist/land.html', 'utf8');
    ok(W+': the tier grammar was injected, marker gone',
       !src.includes('__TIER_GRAMMAR__') && /function tierFor\(/.test(src));
    ok(W+': and the account script came with it', /__authHeader|__compAllowance/.test(src));
  }
}

/* ══ THE DRAWING MEANS SOMETHING, OR IT IS NOT DRAWN ═══════════════════════
   The geometry is held to the foot in engine.test.mjs. This is the wiring:
   that the page actually paints what the engine returns, that a chip's dot
   lands on the drawing it is describing, and that the one failure that would
   undo all of it — a number that does not reach the picture — cannot happen
   silently. */
{
  const pg = await b.newPage({ viewport:{ width:1500, height:1000 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0,160)));
  await pg.goto(FILE); await pg.waitForTimeout(400);
  const D = 'plan';
  const priceAll = () => pg.evaluate(() => {
    ['access','clear','septic','power','survey','permit','drain'].forEach(id => {
      const bb = benchFor(id, benchCtx()); if (!bb.chips || !bb.chips[0]) return;
      let r = (S.site||[]).find(x => x.id === id);
      if (!r){ r = { id, v:'', est:true }; S.site.push(r); }
      r.v = String(Math.round(bb.chips[0].v)); r.est = true; });
    save(); renderSheet(); });
  const look = () => pg.evaluate(() => ({
    marks: [...document.querySelectorAll('#plan > *')].length,
    bar: (document.querySelector('.sbar span')||{}).textContent || '',
    why: (document.getElementById('planwhy')||{innerText:''}).innerText,
    chips: [...document.querySelectorAll('#chips .chip')].map(c => c.style.left + '/' + c.style.top),
    warm: [...document.querySelectorAll('#plan [stroke*="refusal"], #plan g')]
            .filter(el => (el.getAttribute('stroke')||'').includes('refusal')).length,
  }));

  await pg.evaluate(() => { loadWorked(); S.siteOpen = true; save(); renderSheet(); });
  await priceAll(); await pg.waitForTimeout(250);
  let r = await look();
  ok(D+': the plan is painted', r.marks >= 6);
  ok(D+': with a scale bar, which is what makes it a drawing', /\d+ ft/i.test(r.bar));
  ok(D+': and it says it is to scale', /Drawn to scale/.test(r.why));

  /* ── NO CHIP MAY BE PLACED AT NaN ─────────────────────────────────────
     offsetLeft does not exist on an <svg>, so the placement arithmetic came
     out NaN, the browser silently dropped the declaration, and all six chips
     left the ground at once — with no error anywhere. A silent NaN is the
     worst failure shape there is. */
  ok(D+': every chip is placed at a real position', r.chips.length === 6
     && r.chips.every(c => /^[\d.]+%\/[\d.]+%$/.test(c)), r.chips);

  /* the figures reach the picture */
  const len = () => pg.evaluate(() => {
    const p = sitePlan({ ...benchCtx(), priced: siteItems().map(x => x.id) });
    const d = p.marks.find(m => m.id === 'access');
    if (!d) return 0;
    const pts = d.d.slice(1).split(' L').map(s => s.split(',').map(Number));
    let L = 0; for (let i = 1; i < pts.length; i++)
      L += Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]);
    return L; });
  const short = await len();
  await pg.evaluate(() => { S.raw.driveFt = '1200'; save(); renderSheet(); });
  await priceAll(); await pg.waitForTimeout(200);
  const long = await len();
  ok(D+': a longer driveway is a longer line on the ground', long > short * 3);
  r = await look();
  ok(D+': and when it stops fitting, the drawing says so', /doubles back/.test(r.why));

  /* the scale follows the acreage — the same pad on forty acres is a speck */
  await pg.evaluate(() => { S.raw.acres = '40'; S.raw.driveFt = '300'; save(); renderSheet(); });
  await priceAll(); await pg.waitForTimeout(200);
  const big = await pg.evaluate(() => (document.querySelector('.sbar span')||{}).textContent);
  ok(D+': forty acres needs a bigger scale bar than two',
     Number(String(big).replace(/[^0-9]/g,'')) > Number(String(r.bar).replace(/[^0-9]/g,'')));

  /* ── AND WITH NO SCALE, NOTHING IS DRAWN ─────────────────────────────── */
  await pg.evaluate(() => { S.raw.acres = ''; save(); renderSheet(); });
  await pg.waitForTimeout(200);
  r = await look();
  ok(D+': pull the acreage and the plan refuses rather than guessing', r.marks === 0);
  ok(D+': and says why, where the caption was', /no scale/.test(r.why));
  ok(D+': the boundary is still there — it never claimed to be measured',
     await pg.evaluate(() => !!document.querySelector('#parcel polygon')));

  ok(D+': no page errors', errs.length === 0);
  if (errs.length) console.log('   ' + errs.join('\n   '));
  await pg.close();
}

/* ══ THE WALK ══════════════════════════════════════════════════════════════
   "It doesn't take you through the process before arriving at the number."
   Both halves of that sentence are assertions here, and the second half was
   the real offence: the ceiling was on screen before anybody had typed
   anything, and the parcel's facts — the first thing you know and the thing
   four benchmarks are computed from — were at the BOTTOM of the sheet, under
   the answer.

   The fix is not a wizard. The ledger never breaks, nothing is hidden and
   nothing is locked; a rail paces attention down one sheet and a region whose
   arithmetic does not exist yet sits LATENT. So the two things this has to
   hold are opposites, and both matter: the number may not arrive early, and
   no step may ever be shut. */
{
  const pg = await b.newPage({ viewport:{ width:1460, height:940 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0,160)));
  await pg.goto(FILE); await pg.waitForTimeout(400);
  const W = 'walk';
  const clean = () => pg.evaluate(() => { S = blank(); save(); renderSheet(); });
  const look = () => pg.evaluate(() => {
    const sh = document.getElementById('sheet');
    const regions = [...sh.querySelectorAll('[data-region]')];
    return {
      order: regions.map(r => +r.getAttribute('data-region')),
      latent: regions.filter(r => r.classList.contains('latent')).map(r => +r.getAttribute('data-region')),
      counts: [...sh.querySelectorAll('.rph .rcount')].map(x => x.textContent),
      next: (sh.querySelector('.rnext .s')||{}).textContent || '',
      phase: PHASE,
      text: sh.innerText.replace(/\s+/g,' '),
      /* where the parcel's facts sit in the document, and where the answer does */
      factsAt: sh.innerText.indexOf('Four of these price the site work'),
      answerAt: sh.innerText.indexOf('what the play clears'),
      ceilingAt: sh.innerText.indexOf('or less.'),
    };
  });

  await clean(); await pg.waitForTimeout(250);
  let r = await look();
  ok(W+': the sheet is one document in four regions, in order',
     JSON.stringify(r.order) === '[1,2,3,4]', r.order);
  ok(W+': the rail counts all four', r.counts.length === 4, r.counts);

  /* ── THE NUMBER MAY NOT ARRIVE EARLY ─────────────────────────────────── */
  ok(W+': on an empty sheet there is no ceiling on screen', r.ceilingAt === -1);
  ok(W+': and no payday either', r.answerAt === -1);
  ok(W+': the fourth phase reads as latent, not as broken',
     r.counts[3] === 'latent' && r.latent.includes(4), { c:r.counts[3], l:r.latent });
  ok(W+': and the subtraction is still THERE, waiting rather than hidden',
     /Finished lot, sold/.test(r.text) && /resolves the moment the rows above it do/.test(r.text));

  /* ── THE FACTS COME FIRST, WHICH IS THE WHOLE REORDER ────────────────── */
  ok(W+': the parcel is asked for before anything is answered',
     r.factsAt > 0 && (r.answerAt === -1 || r.factsAt < r.answerAt), { f:r.factsAt, a:r.answerAt });

  /* ── AND NOTHING IS LOCKED ────────────────────────────────────────────
     A latent region is not a closed door. The rail is a map of where you are,
     never a gate on where you may be — the desk deliberately lets you jump
     around and this room must not be stricter than the room it came from. */
  await pg.evaluate(() => goPhase(4));
  await pg.waitForTimeout(500);
  ok(W+': pressing the latent phase goes there anyway',
     await pg.evaluate(() => PHASE) === 4);
  await pg.evaluate(() => goPhase(1)); await pg.waitForTimeout(400);

  /* the next step names something real, and it MOVES as the sheet fills */
  const n1 = (await look()).next;
  ok(W+': the empty sheet is sent to the figure that sets the scale', /Acres/.test(n1), n1);
  await pg.evaluate(() => { S.raw.acres = '2.61'; S.slope='roll'; S.trees='scatter'; save(); renderSheet(); });
  await pg.waitForTimeout(250);
  const n2 = (await look()).next;
  ok(W+': and it moves on once that is answered', n2 !== n1 && /finished lot/i.test(n2), n2);

  /* ── LATENCY IS ARITHMETIC ────────────────────────────────────────────
     The fourth region stops being latent the moment the figures it needs
     exist — not when a button is pressed, not when a step is "completed". */
  await pg.evaluate(() => { loadWorked(); save(); renderSheet(); });
  await pg.waitForTimeout(300);
  r = await look();
  ok(W+': a priced sheet has no latent region left', r.latent.length === 0, r.latent);
  ok(W+': the number is on screen now, and only now', r.ceilingAt > 0 && r.answerAt > 0);
  ok(W+': and it is still below the parcel it came from', r.factsAt < r.answerAt);
  ok(W+': the rail carries the figure rather than the word',
     /^\$[\d,]+$/.test(r.counts[3]), r.counts[3]);

  /* remove the one figure nothing prices without, and it goes latent again */
  await pg.evaluate(() => { S.raw.finished = ''; save(); renderSheet(); });
  await pg.waitForTimeout(250);
  r = await look();
  ok(W+': take the finished value away and the number goes latent again',
     r.latent.includes(4) && r.counts[3] === 'latent', { l:r.latent, c:r.counts[3] });
  ok(W+': naming what it needs, not just refusing',
     /what the finished lot sells for/i.test(r.text));

  /* ── THE GROUND ANSWERS THE PHASE IT IS ON ──────────────────────────── */
  await pg.evaluate(() => { loadWorked(); save(); renderSheet(); });
  await pg.waitForTimeout(300);
  const chipOp = async k => { await pg.evaluate(x => { PHASE = x; groundPhase(); }, k);
    await pg.waitForTimeout(160);
    return pg.evaluate(() => [...document.querySelectorAll('#chips .chip')]
      .map(c => ({ lab:(c.querySelector('.lab')||{}).textContent, op:+c.style.opacity })));
  };
  const p1 = await chipOp(1), p2 = await chipOp(2), p3 = await chipOp(3), p4 = await chipOp(4);
  ok(W+': on the parcel, every chip is lit — the ground is inventory',
     p1.every(c => c.op === 1));
  ok(W+': on what-it-becomes only the acreage stays lit, because per-acre is the basis',
     p2.find(c => c.lab === 'Acreage').op === 1 && p2.filter(c => c.op < 1).length === 5, p2);
  ok(W+': on what-it-takes the parcel falls back and the drawing is the subject',
     p3.every(c => c.op < 0.3));
  ok(W+': on the number everything re-lights — the whole play is in shot',
     p4.every(c => c.op === 1));

  ok(W+': no page errors', errs.length === 0);
  if (errs.length) console.log('   ' + errs.join('\n   '));
  await pg.close();
}

/* ── THE GROUND IS A DOOR NOW, NOT A DECORATION ──────────────────────────
   Every other failure of the 3D ground is weather — quota, rate, unreachable.
   Being signed out is a DECISION, so it reads as one: what it costs (nothing),
   what it needs (an account), and no pretence that the drawing beside it is a
   consolation prize, because the drawing is to scale either way. */
{
  const pg = await b.newPage({ viewport:{ width:1400, height:900 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0,140)));
  await pg.goto(FILE); await pg.waitForTimeout(300);
  const G = 'ground';
  const say = async why => pg.evaluate(async w => {
    /* answer the config call the way the server would for this caller */
    window.fetch = async () => ({ json: async () => w ? { ok:false, why:w } : { ok:false } });
    await groundUp();
    return { btn: (document.getElementById('raise')||{}).textContent || '',
             floor: (document.getElementById('floor')||{innerText:''}).innerText.replace(/\s+/g,' ') };
  }, why);

  let r = await say('account');
  ok(G+': signed out, the button names the door rather than an error',
     /free account/i.test(r.btn), r.btn);
  ok(G+': the floor says what it costs — nothing', /no card/i.test(r.floor), r.floor.slice(0,110));
  ok(G+': and offers the account, not a price list',
     /Make an account/.test(r.floor) && !/plans\.html/.test(r.floor));
  ok(G+': and does not sell the drawing short — it is to scale either way',
     /to scale either way/.test(r.floor));

  await pg.reload(); await pg.waitForTimeout(300);
  r = await say('share');
  ok(G+': a share refusal is weather, and reads as weather',
     /share of today/i.test(r.btn) && !/account/i.test(r.btn), r.btn);
  await pg.reload(); await pg.waitForTimeout(300);
  r = await say('quota');
  ok(G+': so is the day\'s quota', /midnight UTC/.test(r.btn), r.btn);

  ok(G+': no page errors', errs.length === 0);
  await pg.close();
}
await b.close();
console.log('\n' + (bad ? '✗ ' + bad + ' of ' + n + ' failed' : '✓ all ' + n + ' hold'));
process.exit(bad ? 1 : 0);
