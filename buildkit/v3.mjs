import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const srv=http.createServer((q,r)=>{
  /* ── THE API EXISTS ON THE REAL SERVER, SO IT EXISTS HERE ────────────────
     This served dist/ and nothing else, so the moment the plans page started
     asking how many founding places were left, every run logged a console 404
     and this file went red — for a route the real deployment mounts
     unconditionally and always answers.

     A harness whose server is less complete than production reports failures
     that only exist in the harness, and the fix people reach for is to stop
     asking, which removes a real feature to satisfy a fake constraint. So the
     stub answers /api/ the way the real one does when nothing is configured:
     a 200 with the "off" shape. It is a static-page harness; anything that
     actually depends on an API has its own file. */
  if (q.url.startsWith('/api/')){
    r.writeHead(200,{'content-type':'application/json'});
    return r.end(JSON.stringify({ ok:true, on:false }));
  }
  let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8096);
const B='http://localhost:8096';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const F=[],ck=(c,m)=>{if(!c)F.push(m)}; const out={};
// every page: fonts load, logo goes home, no errors, no dead links
for (const [name,u] of [['index','/'],['desk','/desk.html'],['exits','/exits.html'],['office','/office.html'],['plans','/plans.html'],['hub','/arcade.html'],['drill','/exit-drill.html'],['arcade','/comp-run.html']]) {
  const p=await b.newPage({viewport:{width:1280,height:900}});
  const errs=[],fails=[];
  p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  p.on('requestfailed',r=>fails.push(r.url()));
  await p.goto(B+u); await p.waitForTimeout(name==='arcade'?3000:1500);
  const r=await p.evaluate(async ()=>{
    await document.fonts.ready;
    const home=[...document.querySelectorAll('a')].filter(a=>/^(index\.html|\/)$/.test(a.getAttribute('href')||''));
    const links=[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href'))
      .filter(h=>h && !/^https?:|^#|^mailto:/.test(h));
    return { fraunces: document.fonts.check('700 40px Fraunces'),
      jb: document.fonts.check('400 12px "JB Mono"'),
      homeLinks: home.length, links:[...new Set(links)],
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  out[name]={...r, errs, fails};
  ck(r.homeLinks>0, `${name}: no way home`);
  ck(!r.overflow, `${name}: horizontal overflow`);
  ck(!errs.length, `${name}: errors ${errs.join(';').slice(0,120)}`);
  ck(!fails.length, `${name}: failed requests ${fails.join(';').slice(0,120)}`);
  if(name!=='arcade') ck(r.fraunces, `${name}: Fraunces did not load`);
  // every internal link resolves
  for (const h of r.links) {
    const f = path.join('dist', h.split('#')[0].split('?')[0]);
    ck(fs.existsSync(f), `${name}: dead link → ${h}`);
  }
  if(name==='index'||name==='office') await p.screenshot({path:`v3-${name}.png`, fullPage:name==='office'});
  await p.close();
}
// the landing must be one world: nothing paper-coloured left
const q=await b.newPage({viewport:{width:1440,height:900}});
await q.goto(B+'/'); await q.waitForTimeout(800);
const paper=await q.evaluate(()=>{
  const bad=[]; for(const el of document.querySelectorAll('*')){
    const bg=getComputedStyle(el).backgroundColor;
    const m=bg.match(/rgb\((\d+), (\d+), (\d+)\)/); if(!m) continue;
    const [r,g,bl]=[+m[1],+m[2],+m[3]];
    if(r>200&&g>185&&bl>150&&bl<r-25) bad.push(el.className||el.tagName);  // manila-ish
  } return bad.slice(0,5);
});
ck(!paper.length, 'landing still has paper-coloured surfaces: '+paper.join(','));
out.paper=paper;

// ── the hero readout must be the ranking the desk actually produces ─────────
// The landing's hero is hand-written HTML mocking the desk. It shipped once
// claiming the novation won a house the desk now refuses to novate, because a
// refusal gate moved and the marketing did not. A page selling "every number
// shows its working" cannot advertise a working the product disowns — so the
// hero's exits and figures are checked against desk.html running the same sheet.
const heroRows = await q.evaluate(()=>[...document.querySelectorAll('.ex')].map(e=>{
  const s=[...e.querySelectorAll('span')].map(x=>x.textContent.trim());
  return { nm:s[1], fig:s[2] }; }));
/* The sheet is READ OUT OF THE DESK rather than pinned here. It was pinned,
   at 249,500, and when the worked example moved to an asking price the deal
   could survive, this harness went on driving the old one and reported the
   landing as wrong — which is the failure mode a cross-check is supposed to
   prevent, running backwards. There is one sheet on this site and both the
   hero and this test now read it from the same place. */
const SHEET = (() => {
  const m = fs.readFileSync('desk.html', 'utf8')
    .match(/Object\.assign\(S\.raw,\{asking:'([\d,]+)',arv:'([\d,]+)',repairs:'([\d,]+)'/);
  if (!m) throw new Error('v3: cannot find the desk\'s worked example');
  const n = v => v.replace(/,/g, '');
  return { asking:n(m[1]), arv:n(m[2]), repairs:n(m[3]),
           shownAsking:m[1], shownArv:m[2], shownRepairs:m[3] };
})();
/* and the hero has to be showing that sheet, not merely ranking it right */
{ const givens = await q.evaluate(()=>[...document.querySelectorAll('.given .v')].map(v=>v.textContent.trim()));
  for (const v of [SHEET.shownAsking, SHEET.shownArv, SHEET.shownRepairs])
    ck(givens.some(g => g.includes(v)), `hero does not show the worked example's $${v}`); }

const truth = await (async () => {
  const d = await b.newPage();
  await d.goto(B+'/desk.html');
  await d.evaluate(()=>localStorage.clear()); await d.reload(); await d.waitForTimeout(500);
  const r = await d.evaluate((SHEET)=>{
    S.raw={asking:SHEET.asking,arv:SHEET.arv,repairs:SHEET.repairs}; S.est={repairs:true};
    S.unc={repairs:0.12}; S.sit='estate';
    const EX=exitsFor().map(x=>Object.assign(x,fitFor(x)));
    EX.sort((a,c)=>{ if(a.na!==c.na) return a.na?1:-1; return (c.fit??-1)-(a.fit??-1); });
    return EX.map(x=>({ nm:x.nm, refused:!!x.refused, na:!!x.na,
      key:x.key==null?null:Math.round(x.key).toLocaleString('en-US') })); }, SHEET);
  await d.close(); return r;
})();
out.hero = { shown:heroRows, deskSays:truth.slice(0,5) };
/* The hero's exit name now carries a REFUSED pill inside the same span, the
   way the desk draws it, so the name read off the page is "The wholetail
   Refused". Strip the pill before matching — the cross-check is about the
   ranking agreeing, not about the badge markup. */
const cleanNm = n => String(n).replace(/\s*(refused|not priced|runs on estimates|recommended)\s*$/i,'').trim();
const byName = Object.fromEntries(truth.map(x=>[x.nm,x]));
for (const row of heroRows) {
  const t = byName[cleanNm(row.nm)];
  ck(!!t, `hero advertises "${cleanNm(row.nm)}", which the desk does not produce`);
  if (!t) continue;
  /* the word is "Refused" now, and it is red on both pages — this cross-check
     cares that the landing agrees with the desk, not which tense it uses */
  /* A refusal now reads as a pill on the NAME and "not priced" in the figure
     column, which is how the desk draws it — so the check looks in both. */
  if (t.refused) ck(/refus/i.test(row.nm) || /not priced/i.test(row.fig),
    `hero shows ${cleanNm(row.nm)} priced at "${row.fig}" but the desk refuses it`);
  else if (t.na)  ck(/needs/i.test(row.fig),   `hero prices ${row.nm} but the desk says it needs more input`);
  else ck(row.fig.includes(t.key), `hero shows ${row.nm} at ${row.fig}; the desk says $${t.key}`);
}
// the winner the hero highlights must be the winner the desk ranks first
{ const best = await q.evaluate(()=>document.querySelector('.ex.best span:nth-child(2)')?.textContent.trim());
  ck(best === truth[0].nm, `hero crowns "${best}"; the desk ranks "${truth[0].nm}" first`); }
// the dashboard reads real saves
const o=await b.newPage({viewport:{width:1280,height:1000}});
await o.goto(B+'/desk.html#example'); await o.waitForTimeout(900);
await o.goto(B+'/exits.html'); await o.waitForTimeout(600);
await o.evaluate(()=>{seen.add(0);seen.add(1);seen.add(2);go(3,1);});
await o.waitForTimeout(400);
await o.goto(B+'/office.html'); await o.waitForTimeout(700);
// ── the door now asks one question and routes on the answer ────────────────
// Signing up no longer just opens the hub: where a brand-new workspace lands
// is the retention decision. Beginners go to the walk-through (a blank
// underwriting sheet is where they quietly leave); everyone else goes to a
// BLANK desk. Nobody gets advanced mode for registering any more — an account
// is memory, the product is a plan, and the fourteen days start on purpose.
await o.fill('#g-name','Elijah Payne'); await o.fill('#g-email','elijah@example.com');
await o.fill('#g-market','Atlanta, GA 30310');
await o.click('[data-lvl="some"]');
await o.click('#g-go'); await o.waitForTimeout(1100);
out.route = { some: o.url().split('/').pop().split('#')[0] };
ck(out.route.some === 'desk.html', 'a few-deals signup did not land on the desk: '+out.route.some);

// the professional route, from a clean workspace
{ const r = await b.newPage();
  await r.goto(B+'/office.html'); await r.evaluate(()=>localStorage.clear());
  await r.reload(); await r.waitForTimeout(500);
  await r.fill('#g-name','Pro'); await r.fill('#g-email','pro@example.com');
  await r.click('[data-lvl="pro"]'); await r.click('#g-go'); await r.waitForTimeout(1100);
  out.route.pro = r.url().split('/').pop().split('#')[0];
  out.route.proAdvanced = await r.evaluate(()=>{ try {
    return (JSON.parse(localStorage.getItem('ni-desk-v3')||'{}').mode) === 'advanced'; } catch(e){ return false; } });
  out.route.proAccount = await r.evaluate(()=>{ try {
    const a = JSON.parse(localStorage.getItem('ni-account-v1')||'{}');
    return { trial:a.trial === null || a.trial === undefined, plan:!a.plan }; } catch(e){ return null; } });
  /* the hash is dropped by clearCase on arrival — a spent instruction should
     not survive a reload — so what gets asserted is the emptiness itself */
  out.route.proBlank = await r.evaluate(()=>({ prem: premium(), step: V.step,
    filled: [...FIELDS, ...LOANFIELDS].filter(f=>val(f.id)!==null).length,
    comps: S.comps.length, addr: S.addr }));
  ck(out.route.pro === 'desk.html', 'the professional route did not reach the desk: '+out.route.pro);
  ck(!out.route.proAdvanced, 'registering switched advanced mode on — an account is memory, not a plan');
  ck(out.route.proAccount && out.route.proAccount.trial && out.route.proAccount.plan,
     'registering spent the trial the person never started');
  ck(out.route.proBlank.prem === false, 'a brand-new account is running the paid product');
  ck(out.route.proBlank.filled === 0 && out.route.proBlank.comps === 0 && !out.route.proBlank.addr,
     'a new workspace did not land on a blank sheet: '+JSON.stringify(out.route.proBlank));
  ck(out.route.proBlank.step === 'property', 'a new workspace did not open on step one');
  // and the beginner
  await r.goto(B+'/office.html'); await r.evaluate(()=>localStorage.clear());
  await r.reload(); await r.waitForTimeout(500);
  await r.fill('#g-name','New'); await r.fill('#g-email','new@example.com');
  await r.click('[data-lvl="new"]'); await r.click('#g-go'); await r.waitForTimeout(1100);
  out.route.beginner = r.url().split('/').pop().split('#')[0];
  /* A beginner used to be REDIRECTED into the course with no way past it.
     Everybody lands on a blank sheet now; the beginner is FLAGGED so the desk
     can offer the eight exits once, dismissibly, rather than impose them. */
  ck(out.route.beginner === 'desk.html', 'a beginner no longer lands on their own sheet: '+out.route.beginner);
  await r.close(); }

await o.goto(B+'/office.html'); await o.waitForTimeout(800);
out.office=await o.evaluate(()=>({
  hi:document.getElementById('hi').textContent,
  strip:document.getElementById('strip').innerText.replace(/\n/g,' | ').slice(0,160),
  props:document.getElementById('props').innerText.replace(/\n/g,' | ').slice(0,120),
  course:document.getElementById('course').innerText.replace(/\n/g,' | ').slice(0,80),
  planbar:(document.getElementById('planbar')||{}).innerText||'',
  planbarHref:(document.querySelector('#planbar a.btn.p')||{}).getAttribute
    ? document.querySelector('#planbar a.btn.p').getAttribute('href') : '',
  footProps:(document.getElementById('props-foot')||{}).innerText||'',
  market:document.getElementById('market').innerText.replace(/\n/g,' | ').slice(0,120),
  gateHidden:document.getElementById('gate').classList.contains('hidden') }));
ck(/Elijah/.test(out.office.hi), 'the workspace did not open');
ck(out.office.gateHidden, 'the door stayed shut after signing in');
/* The signup now lands on #new, which empties the sheet on purpose — so the
   hub is checked for the things that survive that, not for the property the
   walk had typed before registering. What it must show is the account, the
   tier, and the unstarted trial offer, which is the one thing worth selling
   to somebody who has already said yes once. */
/* The plan moved off the hub's strip and into the rail's account panel, where
   it is asked for rather than shouted. The strip is two numbers now. */
ck(/on the desk/i.test(out.office.strip) && /spread/i.test(out.office.strip),
   'the hub strip stopped saying what is open and what it is worth: '+out.office.strip);
/* The trial now begins at checkout rather than with a click here, so what the
   hub must do is OFFER it and send the reader to the plans — the fourteen days
   are still free, they just come with a card on file, which is worth roughly
   six times as many paying customers at the end of them. */
ck(out.office.planbar && /14 days free/i.test(out.office.planbar),
   'hub does not offer the trial: '+String(out.office.planbar).slice(0,90));
ck(out.office.planbarHref && /plans\.html/.test(out.office.planbarHref),
   'the hub trial offer does not lead to the plans: '+out.office.planbarHref);
ck(!/Load a worked example/.test(out.office.props + String(out.office.footProps||'')),
   'the hub still offers a member a pretend property');
ck(/Median value|30310/.test(out.office.market), 'hub did not read the market');
await o.screenshot({path:'v3-office.png'});
await o.close();
console.log(JSON.stringify(out,null,1).slice(0,2600));
console.log(F.length?'FAIL:\n- '+F.join('\n- '):'PASS — one world, fonts load, every page has a way home, dashboard reads the saves');
await b.close(); srv.close(); process.exit(F.length?1:0);
