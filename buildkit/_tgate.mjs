/* A DEMO MAY SHOW YOU THE OFFICE DESK. IT MAY NOT RUN IT FOR YOU.
   tierOf() returns 3 inside a demo — deliberately, so a stranger can SEE the
   paid desk working. Five paid features that compute entirely in the browser
   were gated on it, so `desk.html#demo=flip` handed the list underwriter, the
   buy box, full letter drafts, the lender packet and document branding to any
   visitor, signed out, no account.

   The AI features were never exposed (the server checks entitlementOf on all
   five routes), so this asserts the local surface — and it asserts BOTH sides:
   a demo is refused, and a real paying customer is still served. A gate that
   locks everybody is not a fix, it is a different bug. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/desk.html');
let n=0,bad=0;
const ok=(t,p,x)=>{n++; if(!p){bad++;console.log('✗ '+t+(x!==undefined?'  ← '+JSON.stringify(x).slice(0,260):''));}else console.log('✓ '+t);};

const b=await chromium.launch();
const pg=await b.newPage({viewport:{width:1400,height:1000}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,180)));
await pg.goto(FILE); await pg.waitForTimeout(600);

/* One reader for all three panels. A locked panel sends you to the plans page;
   the "Nothing to write yet" empty state ALSO has no plans link, so the two
   have to be told apart or the assertion measures nothing. */
const PANELS = `(function(){
  const out = {};
  for (const [id, fn] of [['bulk','renderBulk'],['buybox','renderBuyBox'],['letters','renderLetters']]){
    const el = document.getElementById(id);
    if (el){ el.hidden = false; try { eval(fn + '()'); } catch(e){ out[id+'Err'] = e.message; } }
    const h = el ? el.innerHTML : '';
    out[id+'Len']    = h.length;
    out[id+'Empty']  = /Nothing to write yet|needs an exit that prices/i.test(h);
    out[id+'Locked'] = /plans\\.html/.test(h);
  }
  /* three distinguishable states, not two: WALL (the upsell card), SAMPLE (a
     drawn packet stamped as one) and REAL (a drawn packet with no stamp). */
  out.packet = (typeof packetHTML === 'function')
    ? (/Not included/.test(packetHTML()) ? 'wall'
      : /Sample packet/i.test(packetHTML()) ? 'sample' : 'real') : null;
  out.brand  = (typeof brandOf === 'function') ? brandOf() : 'n/a';
  out.model  = (typeof letterModel === 'function') ? !!letterModel() : null;
  return out;
})()`;

/* ── the two functions, and the gap between them ─────────────────────────── */
const gap = await pg.evaluate(()=>{
  loadDemo('flip');
  return { tier: tierOf(), entitled3: entitled(3), entitled1: entitled(1),
           mayUse3: typeof mayUse === 'function' ? mayUse(3) : 'MISSING',
           mayUse1: typeof mayUse === 'function' ? mayUse(1) : 'MISSING' };
});
ok('a demo still paints at tier 3 (so the desk still SHOWS)', gap.tier === 3, gap);
ok('and is entitled to nothing', gap.entitled3 === false && gap.entitled1 === false, gap);
ok('mayUse follows entitled, not tierOf', gap.mayUse3 === false && gap.mayUse1 === false, gap);

/* ── the five features, from inside a demo ───────────────────────────────── */
const inDemo = await pg.evaluate((src)=>{
  loadDemo('flip');
  if (typeof showResults === 'function') showResults();
  return eval(src);
}, PANELS);
ok('the demo sheet prices, so the letter has something to be built from',
   inDemo.model === true, inDemo);
ok('a demo gets the LOCKED bulk panel', inDemo.bulkLocked === true, inDemo);
ok('a demo gets the LOCKED buy box', inDemo.buyboxLocked === true, inDemo);
ok('a demo gets the LOCKED letters, not the empty state',
   inDemo.lettersLocked === true && inDemo.lettersEmpty === false, inDemo);
/* ── the one place this rule bends, and why ────────────────────────────────
   The other four locked features all DO something with the visitor's own
   material: the bulk panel underwrites their list, the buy box screens their
   deals, the letters get sent to a real seller, the branding puts a real
   company's name on a document. Refusing those inside a demo is refusing to
   work for free.

   The lender packet inside a demo is none of that. It is a picture of a
   document about 1104 Elm Street — a house we invented, with comps we
   invented — and nobody can take it to a lender. Refusing to DRAW it deleted
   the single best answer to "what does $39 buy" from the only screen built to
   answer that question, in exchange for protecting nothing.

   So the demo draws it, stamped. The stamp is the assertion: a packet a demo
   produced must be impossible to mistake for one a customer produced. */
ok('a demo DRAWS the lender packet, because a fictional house costs nothing',
   inDemo.packet === 'sample', inDemo);
ok('a demo puts no branding on a document', !inDemo.brand, inDemo);

/* the sharpest version of the same rule: an account that IS entitled, reading
   a demo, still gets the demo's entitlements — the flag wins over the plan */
const brandedDemo = await pg.evaluate(()=>{
  localStorage.setItem('ni-account-v1', JSON.stringify({ email:'e@x.com', plan:'the office', name:'E', co:'Storm River Homes' }));
  loadDemo('flip');
  return { brand: brandOf(), tier: tierOf(), entitled: entitled(3) };
});
ok('even a real Office account gets no branding while reading a demo',
   brandedDemo.brand === null, brandedDemo);

/* ── and a real paying customer is still served ──────────────────────────── */
const paid = await pg.evaluate((src)=>{
  /* leaving the demo the way the product does */
  P.props.length = 0; P.props.push(newProp('450 Chestnut St'));
  P.active = 0; loadInto(0);                      // clears DEMO
  S.raw.asking='168,000'; S.est.asking=false; S.prov.asking='typed';
  S.raw.arv='296,500';    S.est.arv=false;    S.prov.arv='typed';
  S.raw.repairs='41,300'; S.est.repairs=false;S.prov.repairs='typed';
  S.raw.rent='1,875';     S.est.rent=false;   S.prov.rent='typed';
  S.repairsOwn = true;
  const acct = { email:'e@x.com', plan:'the office', name:'E Payne', co:'Storm River Homes' };
  localStorage.setItem('ni-account-v1', JSON.stringify(acct));
  if (typeof ACC !== 'undefined') ACC = acct;
  if (typeof showResults === 'function') showResults();
  const out = eval(src);
  out.tier = tierOf(); out.entitled3 = entitled(3); out.demo = DEMO;
  return out;
}, PANELS);
ok('an Office account is entitled', paid.entitled3 === true, paid);
ok('and its sheet prices', paid.model === true, paid);
ok('and gets the WORKING bulk panel', paid.bulkLocked === false, paid);
ok('and the working buy box', paid.buyboxLocked === false, paid);
ok('and full letter drafts', paid.lettersLocked === false && paid.lettersEmpty === false, paid);
ok('and the full lender packet, with no sample stamp on it', paid.packet === 'real', paid);
ok('and its company name on the documents',
   !!paid.brand && paid.brand !== 'n/a' && paid.brand.co === 'Storm River Homes', paid.brand);

ok('no page errors', errs.length===0, errs[0]);
await b.close();
console.log('\n'+(bad? '✗ '+bad+' of '+n+' failed' : '✓ all '+n+' hold'));
process.exit(bad?1:0);
