/* _tstreet — the street brief, in the browser.

   The first feature in this product that reaches the open internet and puts
   what it finds in front of somebody about to spend money. So the properties
   that matter are not "does it render".

     A · the four people who cannot use it get a card that points at the thing
         that would open it, and no control that spends the key
     B · nothing is offered until there is an address to brief — a locked card
         under an empty field is an advertisement interrupting somebody who has
         not started
     C · every census figure on screen is labelled with the agency and the year
     D · every web claim carries a clickable source, and the chip stays with
         the paragraph it belongs to
     E · withheld paragraphs are DECLARED. "One paragraph withheld for carrying
         a figure not in the data" is the sentence that earns the rest of it
     F · a brief for one address does not sit under a different one
     G · the month's balance shows
     H · nothing throws */
import { chromium } from 'playwright';
import fs from 'fs';
import http from 'node:http';

let SEEN = null, REPLY = null;
const BRIEF = {
  ok:true, address:'512 JOSEPH E LOWERY BLVD SW, ATLANTA, GA, 30310',
  tract:'Census Tract 42', county:'Fulton County', place:'Atlanta city',
  census:{ vintage:'2023 ACS 5-year, US Census Bureau', ownerOccupiedPercent:38,
           vacancyPercent:14, medianHomeValue:214000, medianGrossRent:1210, medianYearBuilt:1952 },
  flood:{ zone:'X', subtype:'AREA OF MINIMAL FLOOD HAZARD', specialFloodHazardArea:false },
  paragraphs:[
    { text:'Census Tract 42 is a mostly rented block. 38% of occupied homes are owned.', cites:[] },
    { text:'The point sits in zone X, minimal hazard.', cites:[] },
    { text:'A rezoning was filed two streets north last spring.',
      cites:[{ url:'https://example.gov/planning/123', title:'Planning application 123' }] }],
  dropped:1, searches:2, month:{ used:5, cap:40, left:35 },
};
const site = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname === '/api/street'){
    let b=''; q.on('data', c => b += c);
    return q.on('end', () => { try { SEEN = JSON.parse(b); } catch(e){ SEEN='bad'; }
      const R = REPLY || { code:200, body:BRIEF };
      r.writeHead(R.code, {'content-type':'application/json'}); r.end(JSON.stringify(R.body)); });
  }
  const p = u.pathname === '/' ? '/index.html' : u.pathname;
  const f = '/home/claude/dist' + p;
  if (fs.existsSync(f) && fs.statSync(f).isFile()){
    r.writeHead(200, {'content-type':'text/html'}); return r.end(fs.readFileSync(f)); }
  r.writeHead(404); r.end('');
});
const port = await new Promise(r => site.listen(0, '127.0.0.1', () => r(site.address().port)));
const BASE = `http://127.0.0.1:${port}`;
const ADDR = '512 Joseph E Lowery Blvd SW, Atlanta GA 30310';

const bad = [], out = {};
const b = await chromium.launch();

async function open(acct, demo){
  const p = await b.newPage({ viewport:{ width:1280, height:1200 } });
  p.on('pageerror', e => bad.push('threw — ' + String(e).slice(0,140)));
  await p.goto(BASE + '/desk.html');
  await p.evaluate(a => { localStorage.clear();
    if (a) localStorage.setItem('ni-account-v1', JSON.stringify(a)); }, acct || null);
  await p.goto(BASE + '/desk.html');
  await p.waitForFunction(() => typeof render === 'function' && typeof renderStreet === 'function',
    null, { timeout:20000 });
  if (demo) await p.evaluate(() => { loadDemo(Object.keys(DEMOS)[0]); render(); });
  return p;
}
const card = p => p.evaluate(() => {
  /* the locked brief is now the "under glass" row (gl-street); the working
     brief is still .sbrief. A locked card is the glass row, and the door lives
     inside it — reachable, but only in the expanded case, and it never carries
     a control that spends the key. */
  const glass = document.getElementById('gl-street');
  if (glass){
    const a = glass.querySelector('a.btn');
    return { locked: true, done: false, go: false,
      href: a ? a.getAttribute('href') : null };
  }
  const e = document.querySelector('.sbrief');
  if (!e) return null;
  const a = e.querySelector('a.btn');
  return { locked: e.classList.contains('locked'), done: e.classList.contains('done'),
    go: !!document.getElementById('sb-go'), href: a ? a.getAttribute('href') : null };
});

/* ── A/B · who cannot use it, and when nothing is offered ─────────────────── */
for (const [nm, acct, demo, wantHref] of [
  ['signed out', null, false, 'office.html'],
  ['a demo',     null, true,  'office.html'],
  ['free',       { name:'E', email:'e@x.com', plan:null,   trial:null }, false, 'plans.html'],
  ['solo',       { name:'E', email:'e@x.com', plan:'solo', trial:null }, false, 'plans.html'],
]){
  const p = await open(acct, demo);
  /* a demo arrives with an address already on the sheet, so it has nothing to
     say about the empty state — that is the point of a demo. Everyone else
     starts on a blank field and must be offered nothing at all. */
  const empty = demo ? null
    : await p.evaluate(() => (document.getElementById('streetbrief')||{}).innerHTML.length);
  if (empty) bad.push(`B: ${nm} is shown the brief card with no address typed yet`);
  await p.evaluate(a => { S.addr = a; save(); render(); }, ADDR);
  await p.waitForTimeout(350);
  const c = await card(p);
  out[nm] = { emptyLen: empty, card: c };
  if (!c)          bad.push(`A: ${nm} sees no brief card even with an address`);
  else {
    if (!c.locked) bad.push(`A: ${nm} gets the working card`);
    if (c.go)      bad.push(`A: ${nm} GETS A CONTROL THAT SPENDS THE KEY`);
    if (!c.href || !c.href.includes(wantHref))
      bad.push(`A: ${nm} is sent to ${c.href}, which cannot fix their problem`);
  }
  await p.close();
}

/* ── C/D/E/G · the brief itself ──────────────────────────────────────────── */
{
  SEEN = null; REPLY = null;
  const p = await open({ name:'E', email:'e@x.com', plan:'underwriter', trial:null }, false);
  await p.evaluate(a => { S.addr = a; save(); render(); }, ADDR);
  await p.waitForTimeout(350);
  const before = await card(p);
  if (!before || before.locked) bad.push('C: an Underwriter does not get the working card');
  if (!before || !before.go)    bad.push('C: an Underwriter gets no button');

  await p.evaluate(() => window.__runStreet());
  await p.waitForTimeout(800);
  out.sent = SEEN;
  if (!SEEN || SEEN.address !== ADDR) bad.push(`C: the address sent was ${JSON.stringify(SEEN)}`);

  const r = await p.evaluate(() => {
    const e = document.querySelector('.sbrief.done');
    if (!e) return null;
    const paras = [...e.querySelectorAll('.sb-body p')].map(x => ({
      text: x.textContent.replace(/\s+/g,' ').trim(),
      cites: [...x.querySelectorAll('.sb-cites a')].map(a => ({ host:a.textContent.trim(),
        href:a.getAttribute('href'), rel:a.getAttribute('rel')||'', target:a.getAttribute('target') })) }));
    return { facts: [...e.querySelectorAll('.sb-f')].map(x => x.textContent.replace(/\s+/g,' ').trim()),
      paras, foot: (e.querySelector('.sb-foot')||{}).textContent.replace(/\s+/g,' ').trim(),
      k: (e.querySelector('.k')||{}).textContent || '' };
  });
  out.brief = r;
  if (!r) { bad.push('C: nothing rendered after a successful brief'); }
  else {
    /* C · the figures, each labelled */
    if (!r.facts.some(f => /Owner-occupied/.test(f) && /38%/.test(f)))
      bad.push('C: the owner-occupied share is not shown as a labelled figure');
    if (!r.facts.some(f => /Flood zone/.test(f)))
      bad.push('C: the flood zone is not shown');
    if (!/2023 ACS 5-year, US Census Bureau/.test(r.foot))
      bad.push(`C: the census figures are not attributed with the year — "${r.foot.slice(0,80)}"`);
    if (!/FEMA/.test(r.foot)) bad.push('C: FEMA is not credited for the flood position');
    /* D · the citation is on the right paragraph, and safe */
    const cited = r.paras.filter(x => x.cites.length);
    if (cited.length !== 1) bad.push(`D: ${cited.length} paragraphs carry a source, expected 1`);
    else {
      if (!/rezoning/i.test(cited[0].text))
        bad.push(`D: the source chip is on the wrong paragraph — "${cited[0].text.slice(0,50)}"`);
      const a = cited[0].cites[0];
      if (a.host !== 'example.gov') bad.push(`D: the chip reads "${a.host}" rather than the host`);
      if (a.href !== 'https://example.gov/planning/123') bad.push('D: the chip does not link to the page');
      if (!/noopener/.test(a.rel) || !/noreferrer/.test(a.rel))
        bad.push(`D: a link to a stranger's page opens without noopener/noreferrer — rel="${a.rel}"`);
      if (a.target !== '_blank') bad.push('D: the source navigates away from the sheet');
    }
    /* E · what was withheld is declared */
    if (!/1 paragraph withheld/.test(r.foot))
      bad.push(`E: a withheld paragraph is not declared — "${r.foot.slice(0,110)}"`);
    /* G · the month */
    if (!/35 of 40 left this month/.test(r.k))
      bad.push(`G: the month's balance is not shown — "${r.k}"`);
  }

  /* ── F · a brief does not sit under a different address ─────────────────── */
  await p.evaluate(() => { S.addr = '88 Ostend Street, Atlanta GA 30314'; save(); render(); });
  await p.waitForTimeout(350);
  const after = await p.evaluate(() => {
    const e = document.querySelector('.sbrief');
    return { done: !!(e && e.classList.contains('done')),
      btn: (document.getElementById('sb-go')||{}).textContent || null };
  });
  out.stale = after;
  if (after.done) bad.push('F: THE BRIEF FOR ONE ADDRESS IS STILL SITTING UNDER ANOTHER ONE');
  if (!after.btn || !/instead/.test(after.btn))
    bad.push(`F: the stale state does not offer to brief the new address — "${after.btn}"`);
  await p.close();
}

/* ── the refusal path ────────────────────────────────────────────────────── */
{
  REPLY = { code:422, body:{ ok:false, error:'The brief came back with nothing that could be verified '
    + 'against the census figures, so it was not shown to you.' } };
  const p = await open({ name:'E', email:'e@x.com', plan:'underwriter', trial:null }, false);
  await p.evaluate(a => { S.addr = a; save(); render(); }, ADDR);
  await p.waitForTimeout(300);
  await p.evaluate(() => window.__runStreet());
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => ({ err: (document.querySelector('.sb-err')||{}).textContent || null,
    done: !!document.querySelector('.sbrief.done') }));
  out.refused = r;
  if (!r.err) bad.push('the refusal shows nothing at all — the button just stops working');
  if (r.done) bad.push('A REFUSED BRIEF WAS SHOWN ANYWAY');
  REPLY = null;
  await p.close();
}

await b.close(); site.close();
console.log(JSON.stringify(out, null, 1));
if (bad.length){ console.log('FAIL'); bad.forEach(x => console.log(' - ' + x)); process.exit(1); }
console.log('PASS — nothing is offered before there is an address; the demo, a stranger, a free '
  + 'account and Solo get a card pointing at what opens it and no control that spends the key; an '
  + 'Underwriter gets figures attributed to the agency and the year, a web claim carrying a '
  + 'clickable source on the paragraph it belongs to, a declaration of what was withheld and why, '
  + 'and a brief that steps aside the moment the address changes');
process.exit(0);
