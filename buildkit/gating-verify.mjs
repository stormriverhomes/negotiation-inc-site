// ── the account decision, held to what it promises ──────────────────────────
// The rule this product chose: pricing is free, anonymous and unlimited
// forever; an account buys MEMORY; a plan buys the professional layer. The
// dangerous failure is scope creep in the gate — the day a number the user
// derived themselves is hidden behind a wall, the honesty grammar is dead and
// so is the wedge. These assertions exist to make that regression loud.
import { chromium } from 'playwright';
import { underwrite } from './harness-util.mjs';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const F=[], ck=(c,m)=>{ if(!c) F.push(m); };
const R={};
const p = await b.newPage({ viewport:{width:1120,height:1200} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });

const anon = async () => { await p.goto('file:///home/claude/desk.html');
  await p.evaluate(()=>localStorage.clear()); await p.reload(); await p.waitForTimeout(350); };
/* `daysAgo` is now how long ago the TRIAL was started, not the account. An
   account with no trial is a member on the free tier, which section G tests. */
const withAccount = async daysAgo => p.evaluate(d => {
  const since = new Date(Date.now() - d*86400000).toISOString().slice(0,10);
  localStorage.setItem('ni-account-v1', JSON.stringify({name:'Elijah Payne',email:'e@x.co',
    since, trial:since, plan:null}));
  window.__render(); }, daysAgo);
const withMemberNoTrial = async () => p.evaluate(() => {
  localStorage.setItem('ni-account-v1', JSON.stringify({name:'Elijah Payne',email:'e@x.co',
    since:new Date().toISOString().slice(0,10), trial:null, plan:null}));
  window.__render(); });
const fill = () => p.evaluate(()=>{ Object.assign(S.raw,
  { asking:'200000', arv:'280000', repairs:'30000', rent:'1800' }); save(); window.__showResults(); });

// ── A · anonymous gets the whole answer, with nothing hidden ────────────────
await anon(); await fill(); await p.waitForTimeout(400);
R.A = await p.evaluate(()=>({
  priced:[...document.querySelectorAll('.exit')].filter(x=>x.innerText.length>40).length,
  offer:!!document.querySelector('.offer'),
  levers:document.querySelectorAll('[data-lev]').length,
  comps:!!document.getElementById('cw-toggle'),
  /* case-insensitive: the label is upper-cased in CSS now, and innerText
     reports what the reader sees rather than what the markup says */
  terms:/your terms are worth/i.test(document.body.innerText),
  print:!!document.getElementById('print'),
  // nothing anywhere may be visually redacted
  blurred:[...document.querySelectorAll('*')].filter(e=>{
    const f = getComputedStyle(e).filter||''; return /blur/.test(f); }).length,
  redacted:/•••|\*\*\*|unlock to see|upgrade to see/i.test(document.body.innerText) }));
ck(R.A.priced >= 5, 'A: an anonymous visitor did not get every exit priced');
ck(R.A.offer && R.A.levers === 6, 'A: the offer view is gated');
ck(R.A.comps, 'A: the comp workbench is gated');
ck(R.A.terms, 'A: the terms calibration is gated');
ck(R.A.print, 'A: printing for a lender is gated');
ck(R.A.blurred === 0, `A: ${R.A.blurred} elements are blurred behind a paywall`);
ck(!R.A.redacted, 'A: something is redacted with dots or an upgrade prompt');

// ── B · the ask comes AFTER the work, and speaks about memory ──────────────
R.B = await p.evaluate(()=>{
  const k = document.querySelector('.keep'); if (!k) return null;
  const res = document.getElementById('results');
  return { txt:k.innerText, insideResults: res.contains(k),
    afterOffer: !!document.querySelector('.offer') &&
      (k.compareDocumentPosition(document.querySelector('.offer')) & Node.DOCUMENT_POSITION_PRECEDING) > 0 }; });
ck(R.B, 'B: nothing ever asks the user to keep their work');
ck(R.B && R.B.afterOffer, 'B: the account ask appears before the answer it is trading on');
ck(R.B && /memory/i.test(R.B.txt), 'B: the ask does not sell memory, it sells a gate');
ck(R.B && /free|no account/i.test(R.B.txt), 'B: the ask does not restate that pricing stays free');
// and it must not appear before there is anything to keep
await anon(); await p.evaluate(()=>window.__showResults()); await p.waitForTimeout(300);
R.Bempty = await p.evaluate(()=>!document.querySelector('.keep'));
ck(R.Bempty, 'B: an empty sheet is already asking for an account');

// ── C · the reverse trial: everything on, then a soft landing ──────────────
await anon(); await withAccount(0); await fill(); await p.waitForTimeout(400);
R.C = { fresh: await p.evaluate(()=>({ left:trialLeft(), premium:premium(),
  advSteps:document.querySelectorAll('#rail [data-goto]').length })) };
ck(R.C.fresh.left === 14 && R.C.fresh.premium, 'C: a new workspace does not start with everything on');
/* The locked tab no longer flips the mode — pressing it is what asks for the
   explanation, so the harness presses it like a person would. */
await p.evaluate(()=>window.showStep('property')); await p.waitForTimeout(250);
await p.click('#m-adv'); await p.waitForTimeout(400);
R.C.advOpen = await p.evaluate(()=>({ sliders:document.querySelectorAll('[data-adv]').length,
  locked:!!document.querySelector('.lockwrap') }));
ck(R.C.advOpen.sliders === 7 && !R.C.advOpen.locked, 'C: advanced mode is not open during the trial');

await withAccount(20); await p.waitForTimeout(400);
R.C.after = await p.evaluate(()=>({ premium:premium(),
  priced:[...document.querySelectorAll('.exit')].filter(x=>x.innerText.length>40).length,
  /* the lock stopped being a grey strip at the bottom of the document and
     became a panel under the rail, where the click actually happened */
  lock:document.querySelector('.advlock')?.innerText||'',
  lockAtBottom:(()=>{ const a=document.querySelector('.advlock'), f=document.querySelector('footer');
    return !!(a && f && a.getBoundingClientRect().top > f.getBoundingClientRect().top); })(),
  lockClickable:(()=>{ const a=document.querySelector('.advlock');
    return !!a && !!a.onclick && getComputedStyle(a).cursor === 'pointer'; })(),
  offerStill:!!document.querySelector('.offer') }));
ck(!R.C.after.premium, 'C: the trial never ends');
ck(R.C.after.priced >= 5 && R.C.after.offerStill,
   'C: when the trial ended the product stopped working — it is supposed to settle, not lock out');
ck(/stays exactly where it is|already worked out/i.test(R.C.after.lock),
   'C: the lock does not promise that their own work stays visible: '+R.C.after.lock.slice(0,90));
ck(/DSCR|target profit|holding|grid/i.test(R.C.after.lock), 'C: the lock does not name what is behind it');
/* it rendered below the footer for weeks, which is why clicking Advanced
   looked like it did nothing at all */
ck(!R.C.after.lockAtBottom, 'C: the advanced panel is rendering below the footer again');
ck(R.C.after.lockClickable, 'C: the advanced panel does not read as clickable');

// ── D · a demo walks every screen, prefilled ───────────────────────────────
await p.goto('file:///home/claude/desk.html#demo=hold');
await p.evaluate(()=>localStorage.clear()); await p.reload(); await p.waitForTimeout(900);
R.D = await p.evaluate(()=>({ step:V.step,
  /* the rail must NOT be pre-opened. A demo that lets you click straight to
     the answer shows a number nobody watched being made, which is the exact
     thing the walk-through exists to prevent. */
  reachable:[...document.querySelectorAll('#rail [data-goto]')].filter(x=>!x.disabled).length,
  rails:document.querySelectorAll('#rail [data-goto]').length,
  skipBtn:!!document.getElementById('s-run2'),
  resultsShowing:!document.getElementById('results').hidden,
  compsShown:document.querySelectorAll('.comp').length,
  condDragged:LINES.filter(l=>(S.sys[l.id]||0)>0).length,
  premiumOn:premium(), sliders:document.querySelectorAll('[data-sysr]').length,
  keepHidden:!document.querySelector('.keep') }));
ck(R.D.step === 'property', 'D: the demo still jumps to the answer instead of walking: '+R.D.step);
ck(R.D.reachable === 1, `D: the demo pre-opens ${R.D.reachable} of ${R.D.rails} steps — the answer is skippable`);
ck(!R.D.skipBtn, 'D: the skip-to-the-answer button is back');
ck(!R.D.resultsShowing, 'D: the demo opened on the answer');
// and walking it actually arrives
R.Dwalk = await p.evaluate(async ()=>{
  for (let i=0;i<6 && document.getElementById('s-next'); i++){
    document.getElementById('s-next').click();
    await new Promise(r=>setTimeout(r,120));
  }
  const run = document.getElementById('s-run');
  if (run) run.click();
  /* WAIT FOR THE ANSWER, NOT FOR A NUMBER OF MILLISECONDS. This was a fixed
     1400ms, which was comfortably longer than the underwriting beat until the
     beat grew — the loading lines were 170ms each and unreadable, so they got
     their own durations and jitter and the run now takes about two seconds.
     A harness that sleeps for a guess is a harness that will go red the next
     time somebody improves the thing it is timing, and the red will say
     nothing about what broke. */
  const t0 = Date.now();
  while (document.getElementById('results').hidden && Date.now() - t0 < 20000)
    await new Promise(r=>setTimeout(r,60));
  await new Promise(r=>setTimeout(r,140));
  return { onAnswer:!document.getElementById('results').hidden,
           priced:[...document.querySelectorAll('.exit')].filter(x=>x.innerText.length>40).length }; });
ck(R.Dwalk.onAnswer && R.Dwalk.priced >= 5,
   'D: walking the demo does not reach a priced answer: '+JSON.stringify(R.Dwalk));
ck(R.D.compsShown >= 3, 'D: the demo opened the comp workbench empty');
ck(R.D.condDragged >= 3, 'D: the demo did not arrive with the condition already read');
ck(R.D.premiumOn && R.D.sliders >= 5,
   'D: the demo runs on the free tier, so it shows a stranger the version that sells nothing');
ck(R.D.keepHidden, 'D: a demo property is asking to be saved — it is not theirs to keep');

// ── E · the free tier limits precision, never access ───────────────────────
await anon(); await fill(); await p.waitForTimeout(400);
R.E = await p.evaluate(()=>{
  S.compOpen = true;
  S.comps = [0,1,2].map(i=>({id:'c'+i,addr:'C'+i,price:String(280000+i*4000),sqft:'1500',
    beds:'3',baths:'2',sold:'2',dist:'0.3',cond:0,use:true}));
  save(); window.__render();
  const before = S.comps.length; addComp(); const after = S.comps.length;
  return { cap:before===3 && after===3,
    addBtn:!!document.getElementById('cw-add'),
    note:document.querySelector('.capnote')?.innerText||'',
    rangeStillDrawn:!!document.querySelector('.rtrack'),
    arvSettable:!!document.getElementById('arv-take'),
    sliders:document.querySelectorAll('[data-sysr]').length,
    presets:document.querySelectorAll('[data-preset]').length,
    condNote:[...document.querySelectorAll('.cond .capnote')].map(e=>e.innerText).join(' ') };
});
ck(R.E.cap, 'E: the free tier accepted a fourth comp');
ck(!R.E.addBtn, 'E: the add button is still offered after the cap');
ck(R.E.rangeStillDrawn && R.E.arvSettable,
   'E: capping the comps also took away the range — that is access, not precision');
ck(/Three comps/.test(R.E.note) && /narrow/.test(R.E.note),
   'E: the cap note does not explain what more comps buy: '+R.E.note.slice(0,90));
ck(R.E.sliders === 0, 'E: the per-system sliders are open on the free tier');
ck(R.E.presets >= 4, 'E: the free tier lost its Light/Medium/Heavy presets — it cannot price a rehab at all');
ck(/line\s+items/.test(R.E.condNote),
   'E: the condition note does not say the presets are real profiles: '+R.E.condNote.slice(0,90));
// and a free-tier sheet still closes a deal
R.Efree = await p.evaluate(()=>{
  const pr = PRESETS.find(x=>x.id==='medium'); LINES.forEach(l=>S.sys[l.id]=pr.sys[l.id]||0);
  save(); window.__showResults();
  return { priced:[...document.querySelectorAll('.exit')].filter(x=>x.innerText.length>40).length,
    rec:document.querySelectorAll('.flag.rec').length,
    offer:!!document.querySelector('.offer'), print:!!document.getElementById('print') }; });
ck(R.Efree.priced >= 5 && R.Efree.offer && R.Efree.print && R.Efree.rec === 1,
   'E: a free-tier sheet cannot close a deal: '+JSON.stringify(R.Efree));

// ── F · the winner is named, once ──────────────────────────────────────────
R.F = await p.evaluate(()=>{
  const rec = document.querySelector('.flag.rec');
  const bestRow = document.querySelector('.exit.best');
  return { n:document.querySelectorAll('.flag.rec').length,
           onBest: !!rec && !!bestRow && bestRow.contains(rec),
           txt: rec?rec.textContent.trim():'' }; });
ck(R.F.n === 1, 'F: '+R.F.n+' exits are marked recommended');
ck(R.F.onBest, 'F: the recommendation is not on the top-ranked exit');
ck(/recommended/i.test(R.F.txt), 'F: the badge does not say what it is: '+R.F.txt);

// ── G · an account is memory; a plan is the product ────────────────────────
/* The load-bearing new rule. Registering used to switch everything on, which
   spent the trial on people who had not decided to try anything. A member with
   no trial started must sit on the free tier exactly like a stranger, and the
   only difference must be that their work is kept. */
await anon(); await withMemberNoTrial(); await p.waitForTimeout(250);
R.G = await p.evaluate(()=>({ prem:premium(), left:trialLeft(), plan:onPlan(),
  advLocked:!!document.querySelector('#m-adv.lk'),
  assumptionsStep:!!document.querySelector('[data-goto="assumptions"]') }));
ck(R.G.prem === false, 'G: registering an account switched the product on');
ck(R.G.left === 0, 'G: an unstarted trial is already counting down');
ck(R.G.advLocked, 'G: advanced mode is not marked as a plan feature for a member');
ck(!R.G.assumptionsStep, 'G: the assumptions step is open to a member with no plan');
// and the trial, once started deliberately, is the whole product
R.G2 = await p.evaluate(()=>{ startTrial();
  return { prem:premium(), left:trialLeft(),
    stored:JSON.parse(localStorage.getItem('ni-account-v1')).trial }; });
ck(R.G2.prem === true && R.G2.left === 14 && !!R.G2.stored,
   'G: starting the trial did not open the product: '+JSON.stringify(R.G2));

// ── H · nothing pretends to be built that is not ───────────────────────────
/* The locked shelf is allowed to advertise. It is not allowed to lie: a
   feature that does not exist yet has to say so in the chip itself, not only
   in a tooltip nobody opens. */
await anon(); await p.waitForTimeout(200);
R.H = await p.evaluate(()=>{ S.compOpen = true; showStep('property'); render();
  const bits = [...document.querySelectorAll('.lockbit')];
  return { n:bits.length,
    soonSayInBuild: bits.filter(x=>x.querySelector('.tag.soon'))
      .every(x=>/in build/i.test(x.querySelector('.tag').textContent)),
    anyClaimsWorking: bits.filter(x=>x.querySelector('.tag.soon'))
      .some(x=>/available now|working|included/i.test(x.textContent)),
    hrefs:[...new Set(bits.map(x=>x.getAttribute('href')))] }; });
/* was `>= 2`, which was only ever true because two of the three cards on this
   shelf advertised street view and satellite imagery — neither of which is
   implemented anywhere, and neither of which can be until there is a Google
   Cloud account. A locked card is an advertisement, and an advertisement for
   something nobody can buy at any price is the one kind this product must not
   run. The shelf still has to RENDER, which is what this assertion is for. */
ck(R.H.n >= 1, 'H: the locked shelf did not render: '+JSON.stringify(R.H));
/* The photo read is now BUILT, which changes what this block has to police.
   While it was unbuilt the danger was advertising vapour. Now that the
   photographs genuinely go somewhere, the danger is the opposite and worse:
   the panel used to promise "they never leave your machine", and that promise
   was true right up until the moment the feature shipped. A sentence that
   quietly stops being true is the single thing this product cannot do.

   So the old claim is now FORBIDDEN, and the replacement claims — resized and
   stripped of their location data here, stored by nobody at either end — are
   required in its place. */
R.Hai = await p.evaluate(()=>{ showStep('condition'); render();
  const z = document.getElementById('ai-zone'); if (!z) return null;
  const step = document.querySelector('[data-step="condition"]');
  const kids = [...step.children];
  return { first: kids.indexOf(document.getElementById('cond-ai')) <= 1,
    chip: (z.querySelector('.aihead .tag')||{}).textContent||'',
    /* the claim that must NOT come back */
    saysNoUpload: /never leave your machine|stay on your machine|not uploaded|no server/i.test(z.innerText),
    /* and the two that must be there instead */
    saysStripped: /location data|resized|stripped/i.test(z.innerText),
    saysNoStore: /stores them|stored|never stored|nobody stores/i.test(z.innerText),
    drop: !!document.getElementById('ai-drop'),
    href: (z.querySelector('a.btn')||{}).getAttribute ? z.querySelector('a.btn').getAttribute('href') : '' }; });
ck(R.Hai && R.Hai.drop, 'H: the photo read did not render on the condition step');
ck(R.Hai.first, 'H: the photo read is not the first thing on the condition step');
ck(/underwriter|office|solo/i.test(R.Hai.chip),
   'H: the photo read does not name the plan that has it: '+R.Hai.chip);
ck(!/^pro$/i.test(R.Hai.chip.trim()),
   'H: "Pro" means nothing now there are three paid plans — name the tier');
/* The promise about the reader's files, now that there is a server to send
   them to. Everything else on this panel describes a feature; this describes
   what happens to somebody's photographs. */
ck(!R.Hai.saysNoUpload,
   'H: the panel still promises the photographs never leave the machine — they do now, and that is a lie with a price tag');
ck(R.Hai.saysStripped, 'H: the panel does not say the photographs are resized and stripped before they go');
ck(R.Hai.saysNoStore,  'H: the panel does not say nobody stores them');
/* It used to have to lead to plans.html. It now leads to whichever thing this
   particular person actually needs next: a signed-out visitor cannot buy a
   plan until they have an account, so sending them to a price list made them
   work out the missing step for themselves. This runs signed out, so the
   correct destination is the door — and the assertion is that it goes
   SOMEWHERE that opens the feature, not that it goes to one fixed page. */
ck(/plans\.html|office\.html/.test(R.Hai.href),
   'H: the locked photo read leads nowhere that opens it: '+R.Hai.href);
ck(/office\.html/.test(R.Hai.href),
   'H: a signed-out visitor is sent to a price list before they have an account: '+R.Hai.href);
/* and the whole card is the target, not just the one word that is a link */
R.Hclick = await p.evaluate(()=>{ const z=document.getElementById('ai-zone');
  return { clickable: !!z && (!!z.onclick || z.getAttribute('role')==='link'),
    cursor: z ? getComputedStyle(z).cursor : '' }; });
ck(R.Hclick.clickable && R.Hclick.cursor === 'pointer',
   'H: the photo read does not read as clickable: '+JSON.stringify(R.Hclick));
ck(R.H.soonSayInBuild, 'H: an unbuilt feature is not labelled as unbuilt');
ck(!R.H.anyClaimsWorking, 'H: an unbuilt feature claims to work');
ck(R.H.hrefs.every(h=>/office\.html|plans\.html/.test(h)),
   'H: a locked feature leads somewhere other than the funnel: '+R.H.hrefs.join(','));

ck(!errs.length, 'errors: '+errs.join('; ').slice(0,200));
console.log(JSON.stringify(R,null,1));
console.log(F.length ? 'FAIL:\n- '+F.join('\n- ') : 'PASS — free closes deals at low precision, nothing is hidden, the ask follows the answer, one exit is recommended');
await b.close(); process.exit(F.length?1:0);
