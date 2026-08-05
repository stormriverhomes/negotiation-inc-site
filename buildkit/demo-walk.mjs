// ── the whole product, walked the way a stranger walks it ───────────────────
// Landing → sign in → hub → desk (dials) → course → arcade floor → a cabinet.
// This is the acceptance test for the demo build.
import { chromium } from 'playwright';
import { step, underwrite, openExit, fillSheet } from './harness-util.mjs';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.txt':'text/plain'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8094);
const B='http://localhost:8094';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const F=[],ck=(c,m)=>{if(!c)F.push(m)}; const out={};
const p=await b.newPage({viewport:{width:1360,height:900}});
const errs=[],fails=[];
p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text())});
p.on('requestfailed',r=>fails.push(r.url()));

// 1 · the front door
await p.goto(B+'/'); await p.waitForTimeout(1200);
ck(await p.evaluate(()=>document.fonts.check('700 40px Fraunces')), 'landing: Fraunces missing');
// the slideshow: every frame present, autoplay running, a click takes control
out.show = await p.evaluate(()=>({frames:document.querySelectorAll('#stage img').length,
  tabs:document.querySelectorAll('#showtabs button').length,
  on:document.querySelectorAll('#stage img.on').length,
  cap:document.getElementById('showcap').innerText.split('\n')[0]}));
ck(out.show.frames===out.show.tabs && out.show.frames>=6 && out.show.on===1, 'the slideshow is not wired');
await p.click('#showtabs button:nth-child(4)'); await p.waitForTimeout(600);
out.showAfter = await p.evaluate(()=>document.getElementById('showcap').innerText.split('\n')[0]);
ck(out.showAfter !== out.show.cap, 'clicking a slideshow tab did nothing');
// no typewriter anywhere in the software
out.mono = await p.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>{
  const f = getComputedStyle(e).fontFamily.toLowerCase();
  return /mono|courier|consolas|menlo/.test(f); }).length);
ck(out.mono===0, out.mono+' elements still set in a monospace face');
await p.click('a[href="office.html"]'); await p.waitForTimeout(800);

// 2 · sign in
out.gate = await p.evaluate(()=>!document.getElementById('gate').classList.contains('hidden'));
ck(out.gate, 'the door did not appear');
await p.fill('#g-name','Elijah Payne'); await p.fill('#g-email','elijah@stormriver.co');
await p.fill('#g-market','Atlanta, GA 30310');
// signing up now routes by experience — "a few deals" goes straight to the
// desk, which is the point of asking. Come back for the hub.
await p.click('[data-lvl="some"]');
await p.click('#g-go'); await p.waitForTimeout(1400);
out.routed = p.url().split('/').pop().split('#')[0];
ck(out.routed==='desk.html', 'signing up did not route to the desk: '+out.routed);
await p.goto(B+'/office.html'); await p.waitForTimeout(900);
out.hub = await p.evaluate(()=>({hi:document.getElementById('hi').textContent,
  named:document.getElementById('whoname').textContent,
  strip:document.getElementById('strip').innerText.replace(/\n/g,' | ')}));
ck(/Elijah/.test(out.hub.hi) && out.hub.named==='Elijah', 'sign-in did not personalise the hub');
/* Registering is memory, not the product, and the trial now starts at checkout
   with a card rather than with a free click here. So the walk checks that the
   hub OFFERS it and points at the plans — then puts a plan on the account the
   way a completed checkout will, because everything after this point is the
   paying view. */
out.trialOffer = await p.evaluate(()=>{ const g=document.getElementById('pb-go');
  return g ? { text:g.textContent.trim(), href:g.getAttribute('href') } : null; });
ck(out.trialOffer && /14 days free/i.test(out.trialOffer.text),
   'the hub did not offer the trial: '+JSON.stringify(out.trialOffer));
ck(out.trialOffer && /plans\.html/.test(out.trialOffer.href),
   'the hub trial offer does not lead to checkout: '+JSON.stringify(out.trialOffer));
await p.evaluate(()=>{ const a=JSON.parse(localStorage.getItem('ni-account-v1'));
  a.plan='underwriter'; a.trial=new Date().toISOString().slice(0,10);
  localStorage.setItem('ni-account-v1', JSON.stringify(a)); });
out.trialOn = await p.evaluate(()=>{ try {
  return !!JSON.parse(localStorage.getItem('ni-account-v1')).plan; } catch(e){ return false; } });
ck(out.trialOn, 'the plan did not record on the account');

// 3 · the desk, walked step by step the way it now asks to be
await p.goto(B+'/desk.html'); await p.waitForTimeout(900);
out.startsOnStepOne = await p.evaluate(()=>V.step);
ck(out.startsOnStepOne==='property', 'a fresh desk did not open on step one: '+out.startsOnStepOne);
// numbers first, address last: typing an address re-renders the field grid on
// a debounce, and a fill landing mid-rebuild writes into a detached node
await p.fill('[data-f="asking"]','214000'); await p.press('[data-f="asking"]','Tab');
await p.waitForTimeout(300);
await p.fill('#addr','512 Joseph E Lowery Blvd SW, Atlanta GA 30310');
await p.waitForTimeout(1600);                       // ZIP priors arrive
const zipChip = await p.evaluate(()=>{const c=document.querySelector('#fb-arv [data-est]'); return c?c.innerText.replace(/\n/g,' '):null;});
ck(/ZIP 30310/.test(zipChip||''), 'the ZIP chip did not offer itself: '+zipChip);
await p.click('#fb-arv [data-est]'); await p.waitForTimeout(500);
// step two: a preset first, because that is the rung most people take
await p.click('#s-next'); await p.waitForTimeout(400);
out.onCondition = await p.evaluate(()=>V.step);
ck(out.onCondition==='condition', 'Continue did not reach the condition step');
// the desk promises three steps in its own standfirst; it has to have three
out.stepCount = await p.evaluate(()=>document.querySelectorAll('#rail [data-goto]').length);
out.standfirst = await p.evaluate(()=>document.getElementById('deskstand').textContent);
ck(out.stepCount===3, 'the rail shows '+out.stepCount+' steps, not three');
ck(/Three steps/.test(out.standfirst), 'the desk advertises a different number of steps: '+out.standfirst.slice(0,50));
await p.click('[data-preset="medium"]'); await p.waitForTimeout(400);
out.preset = await p.evaluate(()=>({ on:!!document.querySelector('[data-preset="medium"].on'),
  moved:[...document.querySelectorAll('[data-sysr]')].map(r=>+r.value).filter(v=>v>0).length,
  total:document.getElementById('cond-total').textContent }));
ck(out.preset.on && out.preset.moved>=4 && /\$/.test(out.preset.total),
   'the Medium preset did not drive the sliders: '+JSON.stringify(out.preset));
// then the sliders themselves, on top of the preset
await p.evaluate(()=>{ for (const [k,v] of [['shell',100],['kb',60],['mech',30]]){
  const r=document.querySelector('[data-sysr="'+k+'"]'); if(!r) throw new Error('no group '+k);
  r.value=v; r.dispatchEvent(new Event('input')); } });
await p.waitForTimeout(400);
/* the apply button is retired: the panel writes the repair estimate as you
   move it, so what this checks is that moving it MOVED the number */
const condBtn = await p.evaluate(()=>({ repairs:S.raw.repairs, est:!!S.est.repairs,
  prov:S.prov.repairs||'', applyBtnGone:document.getElementById('cond-go').hidden }));
await p.waitForTimeout(300);
await p.click('#s-next'); await p.waitForTimeout(400);
await p.evaluate(()=>{const r=document.getElementById('sit-range'); r.value=80; r.dispatchEvent(new Event('input'));});
await p.waitForTimeout(400);
// advanced mode: signed in from step 2, so the assumptions open
await p.click('#m-adv'); await p.waitForTimeout(700);
await step(p,'assumptions');
out.advanced = await p.evaluate(()=>({ sliders:document.querySelectorAll('[data-adv]').length,
  sens:document.querySelectorAll('.sens td').length, locked:!!document.querySelector('.lockwrap') }));
ck(out.advanced.sliders===7 && out.advanced.sens>0 && !out.advanced.locked, 'advanced mode did not open for a signed-in user');
// advanced condition is every line item, not a group dial: kitchen and each
// bath priced separately, the small site work kept in its own group
out.lines = await p.evaluate(()=>{ const ids=[...document.querySelectorAll('[data-liner]')].map(r=>r.dataset.liner);
  return { n:ids.length, kitchen:ids.includes('kitchen'), baths:ids.includes('bath1')&&ids.includes('bath2'),
    site:ids.includes('yard')&&ids.includes('drive') }; });
ck(out.lines.n===17 && out.lines.kitchen && out.lines.baths && out.lines.site,
   'advanced condition is not every individual line: '+JSON.stringify(out.lines));
await underwrite(p);
out.desk = await p.evaluate(()=>({
  arv:S.raw.arv,
  repairs:S.raw.repairs,
  repState:S.est.repairs ? 'ESTIMATE' : 'ENTERED',
  sit:SITS.find(x=>x[0]===S.sit)[1],
  priced:[...document.querySelectorAll('.exit')].filter(x=>x.innerText.length>40).length,
  conf:document.querySelector('.confchip')?.innerText.replace(/\n/g,' ')||'' }));
out.condBtn = condBtn;
ck(out.desk.arv!=='' && out.desk.repairs!=='', 'the dials did not fill the sheet');
ck(out.desk.repState==='ESTIMATE', 'the condition dial wrote a fact instead of an estimate');
ck(/Behind|Motivated|yesterday/i.test(out.desk.sit), 'the seller dial did not move');
ck(out.desk.priced>=4, 'the exits did not price from dial input alone');

// 3b · the offer: levers move both meters, and the notes follow the seller
out.offer = await p.evaluate(()=>({ levers:document.querySelectorAll('[data-lev]').length,
  notes:document.querySelectorAll('.notes li').length,
  score:document.querySelectorAll('.meter .mh .v')[1]?.textContent||'',
  print:!!document.getElementById('print') }));
ck(out.offer.levers===6 && out.offer.notes>1 && out.offer.print, 'the offer view is not wired');
await p.evaluate(()=>{const r=document.querySelector('[data-lev="days"]'); r.value=7; r.dispatchEvent(new Event('input'));});
await p.waitForTimeout(500);
out.offerFast = await p.evaluate(()=>document.querySelectorAll('.meter .mh .v')[1].textContent);
ck(out.offerFast !== out.offer.score, 'closing faster did not change how the offer reads');

// the terms are the calibrated claim on this page: 9% of price, measured
// against the cash-vs-financed discount, apportioned by what this seller
// weights. A number that never moves is a number nobody should trust.
const worthNum = () => p.evaluate(()=>{
  const t = document.querySelector('.worth')?.innerText || '';
  const m = t.match(/\$([\d,]+)/); return m ? +m[1].replace(/,/g,'') : null; });
out.worthFast = await worthNum();
ck(out.worthFast > 0, 'the offer does not price what the terms are worth');
await p.evaluate(()=>{ for (const [k,v] of [['days',60],['earnest',0.5],['inspection',0]]){
  const r=document.querySelector('[data-lev="'+k+'"]'); if(r){ r.value=v; r.dispatchEvent(new Event('input')); } } });
await p.waitForTimeout(500);
out.worthSlow = await worthNum();
ck(out.worthSlow !== null && out.worthSlow < out.worthFast,
   `weaker terms did not cost anything: ${out.worthFast} → ${out.worthSlow}`);
ck(out.worthFast < 0.35 * 214000, 'the terms claim more than the measured discount can support');
// print for a lender belongs to the offer and nowhere else
out.printPlacement = await p.evaluate(()=>({ onOffer:!!document.getElementById('print'),
  inSheet:!!document.querySelector('.sheet #print') }));
ck(out.printPlacement.onOffer && !out.printPlacement.inSheet, 'print for a lender leaked off the offer page');
// the estimate switch was removed on purpose — typing over a figure is the toggle
out.noEstToggle = await p.evaluate(()=>!document.querySelector('[data-esttoggle], .esttoggle, #est-switch'));
ck(out.noEstToggle, 'the estimate switch came back');

// 4 · the course, and its handoff
await p.goto(B+'/exits.html'); await p.waitForTimeout(900);
await p.evaluate(()=>go(0,3)); await p.waitForTimeout(400);
await p.click('.handoff a.btn'); await p.waitForTimeout(1000);
ck(/desk\.html#/.test(p.url()), 'the course handoff did not reach the desk');
// a sheet is already in progress from step 3, so the desk asks before replacing it —
// which is the consent rule working, and the walk has to answer it
out.consentAsked = await p.evaluate(()=>!!document.getElementById('c-load'));
ck(out.consentAsked, 'the desk overwrote a sheet in progress without asking');
await p.click('#c-load'); await p.waitForTimeout(700);
await p.click('#c-blank'); await p.waitForTimeout(250); await p.click('#c-blank'); await p.waitForTimeout(700);
// clearing the sheet must put you back at the beginning, not leave you parked
// on an empty results screen with nothing to do
out.afterClear = await p.evaluate(()=>({ step:V.step, flow:!document.getElementById('flow').hidden,
  results:!document.getElementById('results').hidden }));
ck(out.afterClear.step==='property' && out.afterClear.flow && !out.afterClear.results,
   'clearing the sheet did not return to step one: '+JSON.stringify(out.afterClear));

// 3c · the portfolio: a second property, compared
// (step 4 emptied the first sheet on purpose, so give it numbers again — the
//  point of this section is two priced properties side by side)
await p.goto(B+'/desk.html'); await p.waitForTimeout(700);
await fillSheet(p, { addr:'512 Lowery Blvd', asking:'214000', arv:'300000', repairs:'38000' });
out.tier = await p.evaluate(()=>({prem:premium(), left:trialLeft(), plan:onPlan(),
  acct:JSON.parse(localStorage.getItem('ni-account-v1')||'null'), props:P.props.length}));
out.freeAdd = await p.evaluate(()=>document.getElementById('p-add')?.textContent.trim() || '(bar hidden)');
ck(out.freeAdd !== '(bar hidden)', 'the property bar did not appear for a signed-in workspace');
/* clicked for real, immediately after a field blur — the exact sequence that
   used to eat the click when render() rebuilt the bar underneath it.
   Scrolled first: the bar sits at the top of the page, and an element resolved
   at y≈0 is a coin toss between the button and the masthead above it. */
{ const el = await p.$('#p-add'); await el.scrollIntoViewIfNeeded();
  await p.waitForTimeout(150);
  const bx2 = await el.boundingBox();
  out.addHit = await p.evaluate(([x,y])=>{ const e=document.elementFromPoint(x,y);
    return e ? (e.id || e.className || e.tagName) : null; },
    [bx2.x+bx2.width/2, bx2.y+bx2.height/2]);
  ck(out.addHit === 'p-add', 'something is sitting on top of the add-property button: '+out.addHit);
  await p.mouse.click(bx2.x + bx2.width/2, bx2.y + bx2.height/2); }
await p.waitForTimeout(700);
out.afterAdd = await p.evaluate(()=>({props:P.props.length, active:P.active,
  tabs:document.querySelectorAll('.ptab').length}));
ck(out.afterAdd.props===2, 'the add-property click was eaten by a re-render: '+JSON.stringify(out.afterAdd));
await fillSheet(p, { addr:'88 Ostend Street', asking:'162000', arv:'240000', repairs:'51000' });
out.tabs = await p.evaluate(()=>document.querySelectorAll('.ptab').length);
ck(out.tabs===2, 'a second property did not open for a signed-in user');
await p.evaluate(()=>document.querySelector('[data-prop="0"]').click()); await p.waitForTimeout(700);
out.switched = await p.evaluate(()=>({asking:document.querySelector('[data-f="asking"]').value, active:P.active}));
ck(out.switched.active===0 && out.switched.asking!=='', 'switching properties lost the first sheet');
await p.goto(B+'/office.html'); await p.waitForTimeout(900);
/* The hub used to list properties as table rows. It lists them as cards now —
   a deck you can read at a glance, with the spread set large because that is
   the number you came back for. So the check is: two cards, both naming their
   property, both carrying a figure, both a way back into the sheet. */
out.hub2 = await p.evaluate(()=>{
  const cards=[...document.querySelectorAll('#props .pcard')];
  return { props:cards.length,
           named:cards.every(c=>(c.innerText||'').trim().length>8),
           figures:cards.filter(c=>/\$/.test(c.innerText)).length,
           opens:cards.filter(c=>c.querySelector('a[href*="desk.html"]')||/desk\.html/.test(c.getAttribute('href')||'')).length };
});
ck(out.hub2.props===2 && out.hub2.named && out.hub2.figures>=1 && out.hub2.opens===2,
   'the hub does not show the portfolio as a readable deck: '+JSON.stringify(out.hub2));

/* 4b · plans: the page sells the product and hedges nowhere. It used to carry
   a LIVE or IN BUILD chip on every row — a product apologising for itself
   twelve times over — and then one "pre-launch" sentence at the top, which was
   the same apology in a smaller font. Both are gone: the site is meant to look
   like the finished thing, and what is not wired up yet belongs in
   launch-plan.md. So the harness now checks the OPPOSITE — that no hedge has
   crept back — plus that nothing on the page is asking for a card, and that
   the legal pages are reachable from here. */
await p.goto(B+'/plans.html'); await p.waitForTimeout(700);
out.plans = await p.evaluate(()=>({
  cards:document.querySelectorAll('.plan').length,
  spots:document.querySelectorAll('.spot').length,
  rows:document.querySelectorAll('tbody tr').length,
  hedge:/pre-?launch|under review|coming soon/i.test(document.body.innerText),
  legal:['terms.html','privacy.html','refunds.html']
        .filter(l=>document.querySelector('a[href=\"'+l+'\"]')).length,
  toDesk:[...document.querySelectorAll('a[href]')].some(a=>/desk\.html#new/.test(a.getAttribute('href'))),
  noCard:!document.querySelector('input[type=\"text\"],input[type=\"number\"],input[type=\"password\"]') }));
ck(out.plans.cards===4, 'the plans page does not show the four tiers: '+out.plans.cards);
ck(out.plans.spots>=5 && out.plans.rows>=20, 'the plans page lost its feature detail');
ck(!out.plans.hedge, 'the plans page is hedging at the customer again');
ck(out.plans.legal===3, 'the plans page cannot reach all three legal pages: '+out.plans.legal);
ck(out.plans.toDesk, 'the plans page has no way into the product');
ck(out.plans.noCard, 'the plans page asks for something it should not');

// 5 · the arcade floor, then a cabinet
await p.goto(B+'/arcade.html'); await p.waitForTimeout(900);
out.floor = await p.evaluate(()=>({cabs:document.querySelectorAll('.cab').length,
  soon:document.querySelectorAll('.cab.soon').length,
  titles:[...document.querySelectorAll('.cab h2')].map(h=>h.textContent)}));
// three cabinets, all real now — Exit Drill shipped, so zero "coming soon"
ck(out.floor.cabs===3 && out.floor.soon===0, 'the arcade floor is not a floor of built cabinets');
/* Ordered by what they teach: the drill, then the street, then the long game.
   The floor used to lead with the idle game and point two cabinets at one URL,
   so this checks both the order and that each button opens a DIFFERENT thing. */
ck(JSON.stringify(out.floor.titles)===JSON.stringify(['Exit Drill','The Daily Street','Comp Run']),
   'the arcade floor is not ordered drill, street, long game: '+out.floor.titles.join(' / '));
out.hrefs = await p.evaluate(()=>[...document.querySelectorAll('.cab .btn.p')].map(a=>a.getAttribute('href')));
ck(new Set(out.hrefs).size===3, 'two cabinets point at the same game: '+out.hrefs.join(', '));
out.cabs = {};
for (let i=0;i<3;i++){
  await p.goto(B+'/arcade.html'); await p.waitForTimeout(500);
  const links = await p.$$('.cab .btn.p');
  await links[i].click(); await p.waitForTimeout(i===2?3500:1600);
  out.cabs[out.floor.titles[i]] = await p.evaluate(()=>({
    url: location.pathname.split('/').pop(),
    playable: !!document.querySelector('button, .btn, .ans'),
    home: !!document.querySelector('a[href="index.html"], a[href="arcade.html"]'),
    errors: 0 }));
}
for (const [nm, r] of Object.entries(out.cabs)){
  ck(r.playable, `${nm} opened with nothing to press`);
  ck(r.home, `${nm} has no way back to the floor`);
}
ck(out.cabs['Comp Run'].url==='comp-run.html' && out.cabs['The Daily Street'].url==='daily-street.html'
   && out.cabs['Exit Drill'].url==='exit-drill.html',
   'a cabinet opened the wrong game: '+JSON.stringify(Object.fromEntries(Object.entries(out.cabs).map(([k,v])=>[k,v.url]))));
out.game = await p.evaluate(()=>({ booted: typeof S!=='undefined', cash: typeof S!=='undefined'?S.cash:null,
  home: !!document.querySelector('a[href="index.html"]') }));
ck(out.game.booted && out.game.home, 'the long game did not open, or has no way home');
// the daily-street deep link opens the street on arrival
await p.goto(B+'/comp-run.html#street'); await p.waitForTimeout(3500);
out.street = await p.evaluate(()=>document.querySelectorAll('[data-lot]').length);
ck(out.street>0, 'the daily-street cabinet did not deal a street');

ck(!errs.length, 'errors: '+errs.join(' ; ').slice(0,200));
ck(!fails.length, 'failed requests: '+fails.join(' ; ').slice(0,160));
console.log(JSON.stringify(out,null,1));
console.log(F.length?'FAIL:\n- '+F.join('\n- '):'PASS — the whole product walks: door, hub, dials, course, floor, cabinet');
await b.close(); srv.close(); process.exit(F.length?1:0);
