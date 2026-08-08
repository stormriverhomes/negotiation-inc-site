/* ── rules-verify ──────────────────────────────────────────────────────────
   The rules added in the "blank canvas" pass, each one written as the failure
   it is meant to catch rather than as the feature it is meant to confirm.

   1 · no button on the sheet does nothing
   2 · a new sheet is blank, including after a demo
   3 · the condition panel IS the repair estimate, and it persists
   4 · a typed bid beats the panel, permanently, and says so
   5 · every entry point marked "price your own" lands on an empty sheet
   6 · nothing on the locked shelf claims to work when it does not
   ────────────────────────────────────────────────────────────────────────── */
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.png':'image/png',
            '.svg':'image/svg+xml','.woff2':'font/woff2'};
const srv=http.createServer((q,r)=>{
  /*__API_STUB__*/ /* a static directory is a deployment with no accounts configured, and saying
     so is the honest answer to /api/config — a 404 is a console error the page
     cannot suppress and the harness cannot tell from a real one */
  if (/^\/api\//.test(q.url)){ r.writeHead(200, {'content-type':'application/json'});
    return r.end(JSON.stringify({ ok:true, accounts:false })); }
 let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8151);
const B='http://localhost:8151';

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{width:1280,height:1000} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
const F=[], ck=(c,m)=>{ if(!c) F.push(m); }; const R={};

const fresh = async (hash='') => {
  await p.goto(B+'/desk.html'); await p.evaluate(()=>localStorage.clear());
  await p.goto(B+'/desk.html'+hash); await p.waitForTimeout(800);
};

/* ── 1 · every visible button has an effect ─────────────────────────────────
   The specific bug: "Use as the repair estimate" wrote a number two screens
   away and never saved it, so to the person clicking it, nothing happened. The
   general rule this now enforces is that a control the sheet renders in its
   default state must change something the person can see. */
await fresh('#new');
await p.fill('[data-f="arv"]','250000'); await p.press('[data-f="arv"]','Tab');
await p.waitForTimeout(250);
await p.evaluate(()=>showStep('condition')); await p.waitForTimeout(250);
R.deadButtons = await p.evaluate(()=>{
  const vis = el => { const s = getComputedStyle(el);
    return !el.hidden && s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null; };
  return [...document.querySelectorAll('.step:not([hidden]) button')]
    .filter(vis).filter(el => !el.onclick && !el.dataset.preset && !el.dataset.goto &&
      !el.dataset.sysr && !el.dataset.liner && el.type !== 'submit')
    .map(el => (el.id || el.className || el.textContent.trim()).slice(0,40));
});
ck(R.deadButtons.length === 0, '1: buttons with no handler on screen: '+R.deadButtons.join(', '));

/* ── 2 · the condition panel writes the estimate, and it survives a reload ── */
await p.click('[data-preset="medium"]'); await p.waitForTimeout(400);
R.panel = await p.evaluate(()=>({ repairs:S.raw.repairs, est:!!S.est.repairs,
  prov:S.prov.repairs||'', swapHidden:document.getElementById('cond-go').hidden }));
ck(!!R.panel.repairs && R.panel.est,
   '2: picking a preset did not write the repair estimate: '+JSON.stringify(R.panel));
ck(/condition panel/.test(R.panel.prov),
   '2: the repair estimate does not say where it came from: '+R.panel.prov);
ck(R.panel.swapHidden, '2: the swap-back button shows when there is nothing to swap');
await p.reload(); await p.waitForTimeout(700);
R.persisted = await p.evaluate(()=>S.raw.repairs);
ck(R.persisted === R.panel.repairs,
   `2: the estimate did not survive a reload (${R.panel.repairs} → ${R.persisted})`);

/* ── 3 · a typed bid outranks the panel, permanently ───────────────────────
   A contractor's number must not be quietly overwritten the next time somebody
   nudges a slider. It must also be recoverable, which is what makes the swap
   button a real decision rather than decoration. */
await p.evaluate(()=>showStep('condition')); await p.waitForTimeout(250);
await p.fill('[data-f="repairs"]','62000'); await p.press('[data-f="repairs"]','Tab');
await p.waitForTimeout(350);
R.bid = await p.evaluate(()=>({ own:S.repairsOwn, raw:S.raw.repairs,
  swapShown:!document.getElementById('cond-go').hidden,
  swapTxt:document.getElementById('cond-go').textContent,
  why:document.getElementById('cond-why').innerText }));
ck(R.bid.own === true && R.bid.raw === '62,000', '3: the typed bid did not take: '+JSON.stringify(R.bid));
ck(R.bid.swapShown, '3: no way back to the panel after typing a bid');
ck(/not overwriting you/i.test(R.bid.why), '3: the panel does not say it is standing down: '+R.bid.why);
// a slider move must NOT clobber the bid
await p.evaluate(()=>{ const r=document.querySelector('[data-sysr="shell"]');
  if (r){ r.value = 20; r.dispatchEvent(new Event('input')); } });
await p.waitForTimeout(350);
R.bidHeld = await p.evaluate(()=>S.raw.repairs);
ck(R.bidHeld === '62,000', '3: a slider overwrote a typed bid: '+R.bidHeld);
// and the swap gives the pen back
await p.click('#cond-go'); await p.waitForTimeout(350);
R.swapped = await p.evaluate(()=>({ own:S.repairsOwn, raw:S.raw.repairs }));
ck(R.swapped.own === false && R.swapped.raw !== '62,000',
   '3: the swap-back did nothing: '+JSON.stringify(R.swapped));

/* ── 4 · a blank sheet is blank, especially after a demo ───────────────────
   The failure: walk off a demo, click "price your own property", and underwrite
   a real house against a fictional one's four comps without being told. */
await p.goto(B+'/desk.html#demo=flip'); await p.waitForTimeout(1100);
R.demoLoaded = await p.evaluate(()=>({ comps:S.comps.length, sqft:S.subj.sqft, addr:S.addr }));
ck(R.demoLoaded.comps >= 3, '4: the demo did not load, so the clear test proves nothing');
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(900);
R.blank = await p.evaluate(()=>({
  comps:S.comps.length, sqft:S.subj.sqft, beds:S.subj.beds, addr:S.addr, name:S.name,
  arv:S.raw.arv||'', asking:S.raw.asking||'', repairs:S.raw.repairs||'',
  sys:Object.values(S.sys).filter(Boolean).length, demo:DEMO, step:V.step,
  own:S.repairsOwn, strip:(document.getElementById('fromcourse')||{}).innerHTML||'',
  results:!document.getElementById('results').hidden }));
for (const k of ['comps','sys']) ck(R.blank[k] === 0, `4: a new sheet kept ${k}: ${R.blank[k]}`);
for (const k of ['sqft','beds','addr','name','arv','asking','repairs'])
  ck(R.blank[k] === '', `4: a new sheet kept ${k}: "${R.blank[k]}"`);
ck(R.blank.demo === null, '4: a new sheet is still flagged as a demo');
ck(R.blank.step === 'property', '4: a new sheet did not open on step one: '+R.blank.step);
ck(R.blank.own === false, '4: a new sheet inherited the previous bid ownership');
ck(R.blank.strip.trim() === '', '4: the demo strip survived onto a blank sheet');
ck(!R.blank.results, '4: a new sheet opened on an empty answer');

/* ── 5 · every "price your own" lands on an empty sheet ─────────────────── */
R.ctas = {};
for (const [name, url] of [['landing','/'], ['demo','/demo.html'], ['office','/office.html']]){
  const q = await b.newPage({ viewport:{width:1280,height:900} });
  await q.goto(B+url); await q.waitForTimeout(600);
  R.ctas[name] = await q.evaluate(()=>[...document.querySelectorAll('a[href*="desk.html"]')]
    .filter(a=>/price (your own |a )?propert|price another|start a sheet/i.test(a.textContent))
    .map(a=>a.getAttribute('href')));
  await q.close();
}
for (const [name, hrefs] of Object.entries(R.ctas)){
  // office's are behind the account gate, so an empty list there is fine
  ck(hrefs.every(h=>/#new$/.test(h)),
     `5: on ${name} a "price your own" link does not clear the sheet: ${hrefs.join(', ')}`);
}
ck(R.ctas.landing.length >= 1, '5: the landing lost its price-your-own call to action');
ck(R.ctas.demo.length >= 1, '5: the demo floor lost its price-your-own call to action');

/* ── 6 · the retired skip, and the retired course, stay retired ─────────── */
R.gone = await p.evaluate(()=>({
  skip:!!document.getElementById('s-run2'),
  txt:/skip to the answer/i.test(document.body.innerText) }));
ck(!R.gone.skip && !R.gone.txt, '6: the skip button came back');

/* ── 6b · money reads as money, and a refusal reads as a refusal ─────────
   Two opposite failures with the same cause: a results page where every figure
   is the same colour. The reader came for one number and the sheet's strongest
   opinion is a second one; both have to survive a two-second glance. */
await p.goto(B+'/desk.html#demo=flip'); await p.waitForTimeout(1300);
await p.evaluate(()=>window.__showResults()); await p.waitForTimeout(500);
R.money = await p.evaluate(()=>{
  const g = getComputedStyle(document.querySelector('.keyfig.pay')||document.body).color;
  const pay = document.querySelector('.payday');
  const ref = document.querySelector('.flag.ref');
  const num = document.querySelector('.payday .pv');
  return { greens:document.querySelectorAll('.keyfig.pay').length,
    payText:num?num.textContent:'', payColour:num?getComputedStyle(num).color:'',
    says:pay?pay.innerText:'', keyColour:g,
    refText:ref?ref.textContent:'', refColour:ref?getComputedStyle(ref).color:'',
    /* the BRRRR's "$0 left in" is not a payout and must never wear green */
    brrrrGreen: !!document.querySelector('#x-brrrr .keyfig.pay'),
    holdGreen: !!document.querySelector('#x-hold .keyfig.pay') };
});
const isGreen = c => { const m=(c||'').match(/\d+/g); return m && +m[1] > +m[0] && +m[1] > +m[2]; };
const isRed   = c => { const m=(c||'').match(/\d+/g); return m && +m[0] > +m[1]+40 && +m[0] > +m[2]+40; };
ck(R.money.greens >= 1, '6b: no exit shows its payout in green');
ck(isGreen(R.money.payColour), '6b: the payday figure is not green: '+R.money.payColour);
ck(/\$/.test(R.money.payText), '6b: the payday line has no money in it: '+R.money.payText);
ck(!R.money.brrrrGreen && !R.money.holdGreen,
   '6b: a ratio or a shortfall is being coloured as if it were money in your pocket');
ck(/estimates|range|band/i.test(R.money.says),
   '6b: the payday line sells a number without saying what kind of number it is');
ck(R.money.refText === 'Refused', '6b: the refusal flag reads "'+R.money.refText+'"');
ck(isRed(R.money.refColour), '6b: the refusal is not red: '+R.money.refColour);
ck(!/next best exit pays \$0/i.test(R.money.says),
   '6b: the runner-up comparison is comparing a cheque to a shortfall');

/* ── 6c · the badges sit on one line ──────────────────────────────────────
   Two classes named `est` — a chip-row container with a top margin, and a
   badge modifier — collided for weeks and pushed "Runs on estimates" four
   pixels below "Recommended" beside it. Nothing in a flex row should ever be
   able to do that again, so the row is measured rather than eyeballed. */
/* The demos ship at high confidence now — a contractor's bid, no estimates —
   so a demo row no longer carries an estimate badge to measure against. The
   measurement needs a sheet that HAS one, which is any ordinary sheet where a
   figure came off a chip rather than out of a bid. */
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(800);
await p.evaluate(()=>{ Object.assign(S.raw,{asking:'200000',arv:'280000',repairs:'30000',rent:'1800'});
  S.est.repairs = true; S.unc.repairs = 0.15; save(); window.__showResults(); });
await p.waitForTimeout(500);
R.badges = await p.evaluate(()=>{
  const tags = [...document.querySelectorAll('.exit-h .tags')]
    .filter(t => t.querySelectorAll('.flag').length > 1)[0];
  if (!tags) return null;
  const mids = [...tags.querySelectorAll('.flag')].map(f => {
    const r = f.getBoundingClientRect(); return { mid: r.top + r.height/2, h: r.height }; });
  return { n:mids.length, spread: Math.max(...mids.map(m=>m.mid)) - Math.min(...mids.map(m=>m.mid)),
           heights: [...new Set(mids.map(m=>Math.round(m.h)))] };
});
ck(R.badges && R.badges.n >= 2, '6c: could not find a row with two badges to measure');
ck(R.badges && R.badges.spread < 0.6,
   `6c: the badges are ${R.badges && R.badges.spread.toFixed(1)}px out of line with each other`);
ck(R.badges && R.badges.heights.length === 1,
   '6c: the badges are different heights: '+JSON.stringify(R.badges && R.badges.heights));

/* ── 6d · the offer does not leave a column of white ─────────────────────
   The levers ran out at half the height of the readout beside them. The
   closing band exists to use that space, so it has to actually be there. */
R.offer = await p.evaluate(()=>{
  const lev = document.querySelector('.levers'), read = document.querySelector('.read');
  const band = document.querySelector('.closeband');
  if (!lev || !read) return null;
  return { band: !!band, notes: document.querySelectorAll('.closeband .notes li').length,
    worth: !!document.querySelector('.closeband .worth .wv'),
    gap: Math.abs(lev.getBoundingClientRect().height - read.getBoundingClientRect().height) };
});
ck(R.offer && R.offer.band, '6d: the offer lost its closing band');
ck(R.offer && R.offer.worth, '6d: the closing band does not say what the terms are worth');
ck(R.offer && R.offer.notes >= 1, '6d: the closing band has no notes in it');

/* ── 6e · advanced mode does something visible, in a readable tab ─────────
   Two failures in one control. Clicking Advanced rendered its panel below the
   FOOTER, so to the reader the button did nothing at all. And the tab itself
   lost its label to a cascade collision — white text on a white pill — so it
   read as an empty box with a padlock in it. */
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(800);
await p.click('#m-adv'); await p.waitForTimeout(500);
R.adv = await p.evaluate(()=>{
  const tab=document.getElementById('m-adv'), s=getComputedStyle(tab);
  const rgb=c=>(c.match(/\d+/g)||[0,0,0]).map(Number);
  const fg=rgb(s.color), bg=rgb(s.backgroundColor);
  const panel=document.querySelector('.advlock'), foot=document.querySelector('footer');
  return { label:tab.textContent.trim(),
    contrast: Math.abs(fg[0]-bg[0])+Math.abs(fg[1]-bg[1])+Math.abs(fg[2]-bg[2]),
    panel: !!panel, cursor: panel?getComputedStyle(panel).cursor:'',
    belowFooter: !!(panel && foot && panel.getBoundingClientRect().top > foot.getBoundingClientRect().top),
    inViewport: !!panel && panel.getBoundingClientRect().top < 900,
    names: panel ? /DSCR|target profit|holding/i.test(panel.innerText) : false,
    modeHeld: S.mode === 'simple' };
});
ck(/^Advanced/.test(R.adv.label), '6e: the advanced tab does not say what it is: "'+R.adv.label+'"');
ck(/Solo/.test(R.adv.label), '6e: the locked advanced tab does not name the plan that opens it');
ck(R.adv.modeHeld, '6e: the locked tab still switches the mode it cannot deliver');
ck(R.adv.contrast > 120, '6e: the advanced tab is unreadable against its own background');
ck(R.adv.panel && !R.adv.belowFooter && R.adv.inViewport,
   '6e: clicking Advanced put its panel somewhere the reader will never see it');
ck(R.adv.cursor === 'pointer', '6e: the advanced panel does not read as clickable');
ck(R.adv.names, '6e: the advanced panel does not name what is behind it');

/* ── 6f · opening an exit opens a drawer, not a tooltip ──────────────────
   The optionality IS the product — eight ways out of one house, each priced,
   each showing its own working. A row that expands into one run-on sentence
   of middot-separated arithmetic wastes the best argument the sheet has. */
await p.goto(B+'/desk.html#demo=flip'); await p.waitForTimeout(1300);
await p.evaluate(()=>window.__showResults()); await p.waitForTimeout(450);
await p.evaluate(()=>{ const r=document.querySelector('[data-row="hold"]'); if(r) r.click(); });
await p.waitForTimeout(400);
R.opened = await p.evaluate(()=>{
  const bod = document.querySelector('.exit-b'); if (!bod) return null;
  const band = document.querySelector('.bandtrack');
  return { fig: !!bod.querySelector('.xb-v'), figText:(bod.querySelector('.xb-v')||{}).textContent||'',
    ring: !!bod.querySelector('.xb-ring'),
    /* the working is a ledger now — an operator gutter, a plain-English name
       and a figure per row — so "not one run-on line" means rows, and it also
       means the rows are legible: ink, not the 13px grey it used to be. */
    lines: bod.querySelectorAll('.led .lrow').length,
    ledTotal: !!bod.querySelector('.led .lrow.tot'),
    ledNamed: [...bod.querySelectorAll('.led .ll')].every(e=>(e.textContent||'').trim().length>6),
    ledSize: parseFloat(getComputedStyle(bod.querySelector('.led .ll')||document.body).fontSize),
    verdict: (bod.querySelector('.exit-verdict')||{}).innerText||'',
    bandRadius: band ? getComputedStyle(band).borderRadius : '' };
});
ck(R.opened, '6f: opening an exit produced nothing');
ck(R.opened.fig && /\d/.test(R.opened.figText), '6f: the opened exit does not lead with its figure');
ck(R.opened.ring, '6f: the opened exit does not show the fit as a shape');
ck(R.opened.lines >= 4, '6f: the arithmetic is back to being one run-on line');
ck(R.opened.ledTotal, '6f: the ledger does not end in an answer');
ck(R.opened.ledNamed, '6f: a ledger row has no plain-English name');
ck(R.opened.ledSize >= 14, '6f: the arithmetic went back to fine print: ' + R.opened.ledSize + 'px');
ck(R.opened.verdict.length > 30, '6f: the opened exit lost its verdict');
/* the band is the product's signature shape and must be identical wherever it
   is drawn — the desk, the offer panel and the lesson */
ck(/999px|9999px/.test(R.opened.bandRadius),
   '6f: the band on the desk is a different shape from the one in the lesson: '+R.opened.bandRadius);
/* ── the band has to carry information, not just colour ───────────────────
   It shipped for a while as a blue segment in a grey bar with no endpoints
   and no reference point, which made it a decoration. A band is only worth
   drawing if it answers "and where does their number fall?" */
R.bandInfo = await p.evaluate(()=>{
  const w = document.querySelector('.bandwrap'); if (!w) return null;
  return { scale: (w.querySelector('.bandscale')||{}).innerText||'',
    ask: !!w.querySelector('.askmark'),
    askLabel: (w.querySelector('.askmark')||{}).dataset ? w.querySelector('.askmark').dataset.l : '',
    gap: (w.querySelector('.bandgap')||{}).innerText||'' };
});
ck(R.bandInfo, '6f: the band did not render');
ck(/\$/.test(R.bandInfo.scale), '6f: the band axis has no endpoints, so its width means nothing');
ck(R.bandInfo.ask, "6f: the band does not show where the seller's price falls on it");
ck(/they ask \$/.test(R.bandInfo.askLabel), '6f: the asking marker is unlabelled: '+R.bandInfo.askLabel);
ck(/above|inside/.test(R.bandInfo.gap),
   '6f: the band does not say the distance between your ceiling and their price: '+R.bandInfo.gap);
{ const q = await b.newPage({ viewport:{width:1100,height:900} });
  await q.goto(B+'/exits.html'); await q.waitForTimeout(900);
  R.lessonBand = await q.evaluate(()=>{ go(0,3);
    const el = document.querySelector('.band');
    return el ? getComputedStyle(el).borderRadius : ''; });
  await q.close(); }
ck(/999px|9999px/.test(R.lessonBand),
   '6f: the lesson draws the band square while the desk draws it round: '+R.lessonBand);

/* ── 6g · the signed-in shell ─────────────────────────────────────────────
   Registering has to change the shape of the room, not just what one panel
   says. And it must NOT appear for a stranger — the anonymous desk stays the
   blank canvas it was rebuilt to be. */
await p.goto(B+'/desk.html'); await p.evaluate(()=>localStorage.clear());
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(700);
R.shellAnon = await p.evaluate(()=>({ shown:!document.getElementById('rail-nav').hidden,
  pad:getComputedStyle(document.body).paddingLeft }));
ck(!R.shellAnon.shown && R.shellAnon.pad === '0px',
   '6g: a stranger is being shown the signed-in shell: '+JSON.stringify(R.shellAnon));
await p.evaluate(()=>{ const t=new Date().toISOString().slice(0,10);
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'Elijah Payne',email:'e@x.co',since:t,trial:null,plan:null})); });
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(700);
await p.setViewportSize({width:1400,height:1000});
await p.evaluate(()=>{ Object.assign(S.raw,{asking:'214000',arv:'300000',repairs:'40000'}); save(); render(); });
await p.waitForTimeout(400);
R.shell = await p.evaluate(()=>({ shown:!document.getElementById('rail-nav').hidden,
  pad:getComputedStyle(document.body).paddingLeft,
  props:document.querySelectorAll('.rn-p').length,
  spread:(document.querySelector('.rn-p .s')||{}).innerText||'',
  toggle:!!document.getElementById('rn-toggle'),
  dupMast:(()=>{ const h=document.querySelector('.wrap > header');
    return !!h && getComputedStyle(h).display !== 'none'; })() }));
ck(R.shell.shown && R.shell.pad === '232px', '6g: the shell did not appear for a member: '+JSON.stringify(R.shell));
ck(R.shell.props >= 1, '6g: the shell carries no live state — it is a nav bar on its side');
/* the rail used to print SPREAD — value minus repairs minus asking, gross —
   which is a different quantity from anything on the offer page and does not
   move when a lever does. It prints the CEILING now: the same number the
   offer's chips, band and room meter are built on, so the two cannot
   disagree. "figure(s)" is still allowed: a sheet too empty to price says how
   many figures it has. */
ck(/pay up to|figure/.test(R.shell.spread), '6g: the shell does not show what each property is worth: '+R.shell.spread);
ck(R.shell.toggle, '6g: the shell cannot be collapsed, so it costs width it may not deserve');
ck(!R.shell.dupMast, '6g: the page masthead is duplicating the shell');

/* the office is the other half of the account — the same rail, from the same
   record, or walking between the two pages moves the furniture */
await p.goto(B+'/office.html'); await p.waitForTimeout(800);
R.shellOffice = await p.evaluate(()=>({ shown:!document.getElementById('rail-nav').hidden,
  pad:getComputedStyle(document.body).paddingLeft,
  props:document.querySelectorAll('.rn-p').length,
  spread:(document.querySelector('.rn-p .s')||{}).innerText||'',
  mast:getComputedStyle(document.querySelector('header')).display,
  dupArcade:(()=>{ const a=document.getElementById('hero-arcade');
    return !!a && getComputedStyle(a).display !== 'none'; })() }));
ck(R.shellOffice.shown && R.shellOffice.pad === '232px',
   '6g: the office did not grow the shell: '+JSON.stringify(R.shellOffice));
ck(R.shellOffice.props >= 1, '6g: the office shell lists no properties');
ck(R.shellOffice.mast === 'none', '6g: the office masthead is duplicating the shell');
ck(!R.shellOffice.dupArcade, '6g: the office hero repeats a link the shell already carries');
await p.evaluate(()=>localStorage.removeItem('ni-account-v1'));
await p.goto(B+'/office.html'); await p.waitForTimeout(600);
R.officeAnon = await p.evaluate(()=>{ const el=document.getElementById('rail-nav');
  return { shown:!el.hidden, vis:getComputedStyle(el).display,
    pad:getComputedStyle(document.body).paddingLeft }; });
ck(!R.officeAnon.shown && R.officeAnon.vis === 'none' && R.officeAnon.pad === '0px',
   '6g: the office door still has the members-only rail beside it: '+JSON.stringify(R.officeAnon));

/* ── 7 · the offline demo tree obeys the same rules ─────────────────────── */
if (fs.existsSync('demo/desk.html')){
  const off = fs.readFileSync('demo/desk.html','utf8');
  ck(!/Skip to the answer/.test(off), '7: the offline build still ships the skip button');
  ck(/repairsOwn/.test(off), '7: the offline build predates the live condition panel');
}

ck(!errs.length, 'errors: '+errs.join('; ').slice(0,240));
console.log(JSON.stringify(R,null,1));
console.log(F.length ? 'FAIL:\n- '+F.join('\n- ')
  : 'PASS — no dead buttons, the panel is the estimate, a bid beats it, a blank sheet is blank');
await b.close(); srv.close(); process.exit(F.length?1:0);
