/* _tintake — the paperwork reader, held to the one rule it exists to obey.

   A figure the person gave us outranks one we were handed. That sentence is
   the whole feature. It is the same rule as the adopted contractor bid, the
   typed repairs and the dragged condition sliders, and this harness attacks it
   from every side a photograph can come at it:

     A · a read lands as an ESTIMATE with a receipt — never as ENTERED
     B · typing over it clears the estimate AND the receipt in one keystroke
     C · a row the person already filled is LEFT ALONE, and the receipt says so
     D · a row filled by an EARLIER read is not sacred — a re-read replaces it
     E · the chip is the audit door: the exact quotation, in one press, no hover
     F · the transcript drawer highlights the lines that were placed
     G · a figure with no box on this sheet is QUOTED, never typed into one
     H · a refused figure never lands, and the refusal is explained in words
     I · `unquoted` — the loud one — places nothing and says so
     J · the comp workbench's three subject figures obey A, B and E as well
     K · nobody who has not paid for a read gets a file picker, or a request
     L · one sentence to a screen reader at the end, not six as they land

   The server half is srv/test-api.mjs (the route) and the validate() rails in
   srv/intake.js. This file is the page: what a figure looks like once it has
   landed, and who owns it. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';

const bad = [], out = {};
let LAST = null, HITS = 0, NEXT = null;

const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/intake'){
    HITS++;
    let body = ''; req.on('data', c => body += c);
    return req.on('end', () => {
      try { LAST = JSON.parse(body); } catch(e){ LAST = { parseError:true }; }
      const r = NEXT || { status:200, json:{ ok:true } };
      res.writeHead(r.status, {'content-type':'application/json'});
      res.end(JSON.stringify(r.json));
    });
  }
  const p = u.pathname === '/' ? '/index.html' : u.pathname;
  const f = '/home/claude/dist' + p;
  if (fs.existsSync(f) && fs.statSync(f).isFile()){
    res.writeHead(200, {'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html'});
    return res.end(fs.readFileSync(f));
  }
  res.writeHead(404); res.end('no');
});
const port = await new Promise(r => site.listen(0, '127.0.0.1', () => r(site.address().port)));
const BASE = `http://127.0.0.1:${port}`;

/* the shape the route actually returns, copied from the brief and from
   validate() in srv/intake.js — the transcript is the spine and every `saw`
   below is a real substring of it */
const TRANSCRIPT = [
  'List price $249,500',
  'Living area 1,412 sq ft',
  '3 beds · 2 baths',
  'Year built 1968',
  'Annual taxes $3,240',
  'Sold as-is, seller has never occupied',
].join('\n');

const READ = {
  ok: true,
  transcript: TRANSCRIPT,
  fields: {
    asking: { value: 249500, saw: 'List price $249,500' },
    sqft:   { value: 1412,   saw: 'Living area 1,412 sq ft' },
    beds:   { value: 3,      saw: '3 beds' },
    baths:  { value: 2,      saw: '2 baths' },
  },
  context: {
    year:  { value: 1968, saw: 'Year built 1968' },
    taxes: { value: 3240, saw: 'Annual taxes $3,240' },
  },
  notes: ['Sold as-is, seller has never occupied'],
  dropped: [{ id:'lot', value:287000, why:'invented', saw:'Estimated value $287,000' }],
  noteDropped: [],
  counts: { read:4, context:2, dropped:1, unquoted:0, notesDropped:0 },
  unreadable: null,
  month: { used:3, cap:80, left:77 },
};

const b = await chromium.launch();
const errs = [];
const today = new Date().toISOString().slice(0,10);
const UW = { name:'E', email:'e@x.com', plan:'underwriter', trial:null };

const open = async (acct = UW) => {
  const p = await b.newPage({ viewport:{ width:1300, height:1100 } });
  p.on('pageerror', e => errs.push(String(e).slice(0,160)));
  await p.goto(BASE + '/desk.html');
  await p.evaluate(a => { localStorage.clear();
    if (a) localStorage.setItem('ni-account-v1', JSON.stringify(a)); }, acct);
  await p.goto(BASE + '/desk.html');
  await p.waitForFunction(() => typeof render === 'function' && typeof window.__tier === 'function',
    null, { timeout:20000 });
  await p.evaluate(() => { window.__NI_API = ''; showStep('property'); render(); });
  await p.waitForTimeout(300);
  return p;
};
/* drive applyIntake() directly for the state rules: the choreography settles
   on a timer, so the harness waits it out rather than racing it */
const land = async (p, j = READ) => {
  await p.evaluate(x => applyIntake(x), j);
  await p.waitForTimeout(1500);
};

/* ── A · a read is an estimate with a receipt, and never ENTERED ─────────── */
{
  const p = await open();
  await land(p);
  const r = await p.evaluate(() => ({
    raw: S.raw.asking, est: S.est.asking, src: S.src.asking, unc: S.unc.asking,
    prov: S.prov.asking || '',
    cls: ($('fb-asking') || {className:''}).className,
    chip: (document.querySelector('#fb-asking .stchip') || {}).textContent || '',
    isBtn: (document.querySelector('#fb-asking .stchip') || {}).tagName || '',
    provOnScreen: (document.querySelector('#fb-asking .prov') || {}).textContent || '',
  }));
  out.A = r;
  if (r.raw !== '249,500')      bad.push(`A: the asking price landed as "${r.raw}"`);
  if (r.est !== true)           bad.push('A: a read figure did not land as an estimate — the bands do not widen');
  if (r.src !== 'photo')        bad.push('A: the figure landed without a receipt (S.src)');
  if (!(r.unc > 0))             bad.push('A: a read figure landed with no uncertainty at all');
  if (/entered/i.test(r.cls))   bad.push('A: A READ FIGURE PAINTED AS ENTERED — it is not theirs until they look at it');
  if (!/photo/.test(r.cls))     bad.push(`A: the row is not marked as read (class "${r.cls}")`);
  if (!/READ/.test(r.chip))     bad.push(`A: the chip says "${r.chip.trim()}"`);
  if (r.isBtn !== 'BUTTON')     bad.push('A: the READ chip is not a button — there is no way in without a mouse');
  if (!/List price \$249,500/.test(r.prov)) bad.push(`A: the provenance does not quote the line: "${r.prov}"`);
  if (!/List price/.test(r.provOnScreen))   bad.push('A: the quotation is not on screen under the figure');
  await p.close();
}

/* ── B · one keystroke makes it yours ────────────────────────────────────── */
{
  const p = await open();
  await land(p);
  await p.fill('#fi-asking', '191000');
  await p.waitForTimeout(260);
  const r = await p.evaluate(() => ({
    raw: S.raw.asking, est: S.est.asking, src: S.src.asking, prov: S.prov.asking,
    cls: ($('fb-asking')||{className:''}).className,
    chip: (document.querySelector('#fb-asking .stchip')||{}).textContent || '',
    prov2: !!document.querySelector('#fb-asking .prov'),
  }));
  out.B = r;
  // the desk formats money on blur, so either spelling of the same number is right
  if (!/^191,?000$/.test(r.raw || '')) bad.push(`B: typing did not take ("${r.raw}")`);
  if (r.est !== false)     bad.push('B: the estimate flag survived a keystroke');
  if (r.src)               bad.push('B: THE RECEIPT SURVIVED — the chip goes on saying READ over a number they typed');
  if (r.prov)              bad.push('B: the provenance sentence survived the keystroke');
  if (!/entered/.test(r.cls)) bad.push(`B: the row did not become ENTERED (class "${r.cls}")`);
  if (!/ENTERED/.test(r.chip))bad.push(`B: the chip says "${r.chip.trim()}" over a typed figure`);
  if (r.prov2)             bad.push('B: the quotation is still under a figure the person typed');
  await p.close();
}

/* ── C · a row they already filled is left alone ─────────────────────────── */
{
  const p = await open();
  await p.evaluate(() => { S.raw.asking = '190,000'; S.est.asking = false; save(); render(); });
  await land(p);
  const r = await p.evaluate(() => ({
    raw: S.raw.asking, est: S.est.asking, src: S.src.asking,
    held: INTAKE.receipt.held, placed: INTAKE.receipt.placed,
    card: ($('intake')||{innerText:''}).innerText.replace(/\s+/g,' '),
  }));
  out.C = r;
  if (r.raw !== '190,000') bad.push(`C: A PHOTOGRAPH OVERWROTE A TYPED FIGURE — "${r.raw}"`);
  if (r.est === true)      bad.push('C: their own typed figure was demoted to an estimate');
  if (r.src)               bad.push('C: their own typed figure was given a photo receipt');
  if (!r.held.includes('asking')) bad.push(`C: the receipt does not record the hold (${JSON.stringify(r.held)})`);
  if (r.placed.includes('asking')) bad.push('C: the receipt claims to have placed a figure it did not place');
  if (!/left alone/i.test(r.card)) bad.push(`C: the card never says a row was left alone — "${r.card.slice(0,160)}"`);
  await p.close();
}

/* ── D · an earlier READ is not sacred; a re-read replaces it ─────────────
   The rule protects figures the PERSON gave us. A number this feature put
   there itself has no such claim, and a second, clearer photograph that could
   not correct the first would make the feature unusable exactly when it is
   needed most. */
{
  const p = await open();
  await land(p);
  const two = JSON.parse(JSON.stringify(READ));
  two.fields.asking = { value: 239000, saw: 'Reduced to $239,000' };
  two.transcript = 'Reduced to $239,000\n' + TRANSCRIPT;
  await land(p, two);
  const r = await p.evaluate(() => ({ raw:S.raw.asking, src:S.src.asking,
    prov:S.prov.asking, held:INTAKE.receipt.held }));
  out.D = r;
  if (r.raw !== '239,000') bad.push(`D: a second read could not correct its own figure ("${r.raw}")`);
  if (r.src !== 'photo')   bad.push('D: the replacement lost its receipt');
  if (!/Reduced to/.test(r.prov||'')) bad.push('D: the provenance still quotes the old line');
  if (r.held.includes('asking')) bad.push('D: the sheet treated its own read as a figure the person owned');
  await p.close();
}

/* ── E · the chip is the audit door ──────────────────────────────────────── */
{
  const p = await open();
  await land(p);
  await p.click('#fb-asking .stchip');
  await p.waitForTimeout(200);
  const r = await p.evaluate(() => {
    const a = document.querySelector('#fb-asking .audit');
    return { open:!!a, q:(a && a.querySelector('.q')||{}).textContent || '',
             role:a ? a.getAttribute('role') : null,
             tr: !!(a && a.querySelector('[data-tr]')) };
  });
  out.E = r;
  if (!r.open)  bad.push('E: pressing the chip opened nothing');
  if (!/List price \$249,500/.test(r.q)) bad.push(`E: the popover does not carry the quotation ("${r.q}")`);
  if (r.role !== 'dialog') bad.push('E: the popover is not announced as a dialog');
  if (!r.tr)    bad.push('E: no way through to the transcript from the figure');
  // and it closes on Escape, because a popover that traps the page reads as broken
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  const gone = await p.evaluate(() => !document.querySelector('.audit') && INTAKE.audit === null);
  if (!gone) bad.push('E: Escape did not close the popover');
  await p.close();
}

/* ── F · the transcript, with the placed lines lit ───────────────────────── */
{
  const p = await open();
  await land(p);
  await p.click('#fb-asking .stchip');
  await p.waitForTimeout(180);
  await p.click('#fb-asking .audit [data-tr]');
  await p.waitForTimeout(250);
  const r = await p.evaluate(() => {
    const d = document.querySelector('.idraw');
    const rows = [...(d ? d.querySelectorAll('#ik-db > div') : [])];
    return { open:!!d, lines:rows.length,
             hit: rows.filter(x => x.className === 'hit').map(x => x.textContent),
             used: rows.filter(x => x.className === 'used').map(x => x.textContent),
             plain: rows.filter(x => !x.className).length };
  });
  out.F = r;
  if (!r.open)         bad.push('F: the transcript never opened');
  if (r.lines !== 6)   bad.push(`F: the drawer shows ${r.lines} lines, the transcript has 6`);
  if (r.hit.length !== 1 || !/List price/.test(r.hit[0]))
    bad.push(`F: the line the figure came from is not the one lit (${JSON.stringify(r.hit)})`);
  if (r.used.length < 2) bad.push(`F: the other placed lines are not marked (${JSON.stringify(r.used)})`);
  if (!r.plain)        bad.push('F: every line is highlighted, so the highlight says nothing');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  if (await p.evaluate(() => !!document.querySelector('.idraw')))
    bad.push('F: Escape did not close the transcript');
  await p.close();
}

/* ── G · a figure with no box is quoted, never typed in ──────────────────── */
{
  const p = await open();
  await land(p);
  const r = await p.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')].map(i => i.value).join('|');
    return { quoted: ($('intake')||{innerText:''}).innerText.replace(/\s+/g,' '),
             inputs, ctx: Object.keys(S.intake.context || {}),
             stray: /1968|3,?240/.test(inputs) };
  });
  out.G = r;
  if (!/QUOTED, NOT PRICED/i.test(r.quoted)) bad.push('G: the quoted-not-priced block never appeared');
  /* an empty array is truthy, and the card once opened with "0 rows you had
     already filled were left alone" — a sentence about nothing, in the place
     the feature explains itself */
  if (/\b0 rows?\b/i.test(r.quoted)) bad.push(`G: the card counts a hold that did not happen — "${r.quoted.slice(0,110)}"`);
  if (!/Year built 1968/.test(r.quoted))     bad.push('G: the year it read is nowhere on screen');
  if (!/Annual taxes/.test(r.quoted))        bad.push('G: the taxes it read are nowhere on screen');
  if (r.stray) bad.push('G: A FIGURE WITH NO BOX WAS TYPED INTO ONE — it landed in an input');
  if (r.ctx.length !== 2) bad.push(`G: the context did not survive onto the sheet (${JSON.stringify(r.ctx)})`);
  if (!/seller has never occupied/i.test(r.quoted)) bad.push('G: the note it read is not shown');
  await p.close();
}

/* ── H · a refusal never lands, and it is explained ──────────────────────── */
{
  const p = await open();
  await land(p);
  await p.click('#ik-ref');
  await p.waitForTimeout(200);
  const r = await p.evaluate(() => ({
    txt: ($('intake')||{innerText:''}).innerText.replace(/\s+/g,' '),
    anyInput: [...document.querySelectorAll('input')].some(i => /287,?000/.test(i.value)),
    lot: S.raw.lot,
  }));
  out.H = r;
  if (r.anyInput) bad.push('H: A REFUSED FIGURE LANDED ON THE SHEET');
  if (r.lot)      bad.push('H: a refused figure was written to state');
  if (!/NOT PLACED/.test(r.txt)) bad.push('H: the refusal panel never opened');
  if (!/not printed in what it read/i.test(r.txt))
    bad.push(`H: the refusal is not explained in words — "${r.txt.slice(0,200)}"`);
  if (!/the rail working/i.test(r.txt)) bad.push('H: nothing tells the person a refusal is the system working');
  await p.close();
}

/* ── I · unquoted is the loud one ────────────────────────────────────────── */
{
  const p = await open();
  const j = JSON.parse(JSON.stringify(READ));
  j.fields = {};
  j.dropped = [{ id:'asking', value:249500, why:'unquoted', saw:'List price $310,000' }];
  j.counts = { read:0, context:0, dropped:1, unquoted:1, notesDropped:0 };
  j.context = {};
  await land(p, j);
  const r = await p.evaluate(() => ({
    txt: ($('intake')||{innerText:''}).innerText.replace(/\s+/g,' '),
    asking: S.raw.asking || '', placed: INTAKE.receipt.placed.length,
    live: ($('intake-live')||{textContent:''}).textContent,
  }));
  out.I = r;
  if (r.asking) bad.push('I: something landed off a reply that cited a line it never read');
  if (r.placed) bad.push('I: the receipt claims figures were placed');
  if (!/None of this read was placed/i.test(r.txt))
    bad.push(`I: the loud failure is not loud — "${r.txt.slice(0,200)}"`);
  if (!/Nothing on your sheet changed/i.test(r.txt))
    bad.push('I: it never says the sheet is untouched, which is the one thing they need to hear');
  await p.close();
}

/* ── J · the comp workbench's subject figures play by the same rules ─────── */
{
  const p = await open();
  await p.evaluate(() => { S.compOpen = true; save(); render(); });
  await land(p);
  const r1 = await p.evaluate(() => ({
    subj: { ...S.subj }, src: { ...S.src },
    marks: [...document.querySelectorAll('.subj .sjr')].map(x => x.dataset.audit),
  }));
  out.J1 = r1;
  if (r1.subj.sqft !== '1412') bad.push(`J: the living area did not reach the workbench ("${r1.subj.sqft}")`);
  if (r1.subj.beds !== '3' || r1.subj.baths !== '2')
    bad.push(`J: beds/baths did not reach the workbench (${JSON.stringify(r1.subj)})`);
  if (r1.marks.length !== 3)
    bad.push(`J: A PHOTOGRAPH PUT FIGURES ON SCREEN WEARING NOTHING — ${r1.marks.length} of 3 marked`);
  // the same audit door
  if (r1.marks.length){
    await p.click('.subj .sjr[data-audit="sqft"]');
    await p.waitForTimeout(200);
    const q = await p.evaluate(() => (document.querySelector('.subj .audit .q')||{}).textContent || '');
    if (!/Living area 1,412 sq ft/.test(q)) bad.push(`J: the subject chip carries no quotation ("${q}")`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(120);
  }
  // and one keystroke takes ownership here too
  await p.fill('#sj-sqft', '1500');
  await p.evaluate(() => $('sj-sqft').blur());
  await p.waitForTimeout(250);
  const r2 = await p.evaluate(() => ({ sqft:S.subj.sqft, src:S.src.sqft,
    marks: document.querySelectorAll('.subj .sjr').length }));
  out.J2 = r2;
  if (r2.sqft !== '1500') bad.push(`J: typing over the subject figure did not take ("${r2.sqft}")`);
  if (r2.src)  bad.push('J: THE RECEIPT SURVIVED on a subject figure they typed themselves');
  if (r2.marks !== 2) bad.push(`J: the READ mark is still on a typed figure (${r2.marks} marks left)`);
  // a figure they had already put in is left alone
  const p2 = await open();
  await p2.evaluate(() => { S.compOpen = true; S.subj.beds = '4'; save(); render(); });
  await land(p2);
  const r3 = await p2.evaluate(() => ({ beds:S.subj.beds, held:INTAKE.receipt.held }));
  out.J3 = r3;
  if (r3.beds !== '4') bad.push(`J: a photograph overwrote a subject figure they typed ("${r3.beds}")`);
  if (!r3.held.includes('beds')) bad.push('J: the receipt does not record the subject hold');
  await p2.close();
  await p.close();
}

/* ── K · nobody unpaid gets a picker, and nobody unpaid reaches the wire ─── */
{
  const CASES = [
    ['signed out', null],
    ['free',       { name:'E', email:'e@x.com', plan:null, trial:null }],
    ['solo',       { name:'E', email:'e@x.com', plan:'solo', trial:null }],
  ];
  for (const [nm, acct] of CASES){
    const p = await open(acct);
    const r = await p.evaluate(() => ({
      files: document.querySelectorAll('#intake input[type=file]').length,
      drop:  !!document.getElementById('ik-drop'),
      txt:   ($('intake')||{innerText:''}).innerText.replace(/\s+/g,' '),
    }));
    out['K ' + nm] = r;
    if (r.files) bad.push(`K/${nm}: THERE IS A FILE INPUT for somebody who has not paid for a read`);
    if (r.drop)  bad.push(`K/${nm}: the drop zone is live for somebody who cannot use it`);
    if (!/Underwriter/.test(r.txt)) bad.push(`K/${nm}: the locked card does not name the plan — "${r.txt.slice(0,120)}"`);
    /* and going round the button: call the sender directly with a real file */
    const before = HITS;
    await p.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 20; c.height = 20;
      c.getContext('2d').fillRect(0,0,20,20);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .8));
      await intakeSend([new File([blob], 'a.jpg', { type:'image/jpeg' })]);
    });
    await p.waitForTimeout(300);
    if (HITS !== before) bad.push(`K/${nm}: AN UNPAID ACCOUNT REACHED /api/intake FROM THE CONSOLE`);
    await p.close();
  }
  // the demo, which paints at tier 3 on purpose, must not spend a read either
  const p = await open(null);
  const keys = await p.evaluate(() => Object.keys(typeof DEMOS !== 'undefined' ? DEMOS : {}));
  if (keys.length){
    await p.evaluate(k => { loadDemo(k); render(); showStep('property'); }, keys[0]);
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => ({ tier: window.__tier(),
      files: document.querySelectorAll('#intake input[type=file]').length }));
    out['K demo'] = r;
    if (r.tier < 3) bad.push(`K/demo: the demo no longer paints at tier 3 (${r.tier}) — this proves nothing`);
    if (r.files)    bad.push('K/demo: THE DEMO CAN READ PAPERWORK — an open vision endpoint with a friendly front end');
  }
  await p.close();
}

/* ── L · one sentence, at the end ────────────────────────────────────────── */
{
  const p = await open();
  await p.evaluate(() => { S.raw.asking = '190,000'; S.est.asking = false; save(); render(); });
  await land(p);
  const say = await p.evaluate(() => ($('intake-live')||{textContent:''}).textContent);
  out.L = say;
  if (!say) bad.push('L: a form filled itself in and said nothing to a screen reader');
  if (!/placed as estimates/i.test(say)) bad.push(`L: the announcement does not say they are estimates — "${say}"`);
  if (!/left alone/i.test(say))          bad.push(`L: the announcement does not mention the held row — "${say}"`);
  if (!/quoted/i.test(say))              bad.push(`L: the announcement never mentions the quoted figures — "${say}"`);
  if (!/refused/i.test(say))             bad.push(`L: the announcement never mentions the refusal — "${say}"`);
  if ((say.match(/\./g)||[]).length > 5) bad.push(`L: the announcement is a running commentary — "${say}"`);
  await p.close();
}

/* ── M · the round trip, over the wire, with the token ───────────────────── */
{
  const p = await open();
  NEXT = { status:200, json:READ };
  const before = HITS;
  await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 30; c.height = 30;
    const g = c.getContext('2d'); g.fillStyle = '#7788aa'; g.fillRect(0,0,30,30);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .8));
    await intakeSend([new File([blob], 'listing.jpg', { type:'image/jpeg' })]);
  });
  await p.waitForTimeout(1800);
  const r = await p.evaluate(() => ({ raw:S.raw.asking, src:S.src.asking,
    txt: ($('intake')||{innerText:''}).innerText.replace(/\s+/g,' ') }));
  out.M = { sent: HITS - before, images: LAST && (LAST.images||[]).length,
            media: LAST && LAST.images && LAST.images[0] && LAST.images[0].media_type,
            b64: LAST && LAST.images && LAST.images[0] && (LAST.images[0].data||'').length, ...r };
  if (HITS - before !== 1) bad.push(`M: the drop sent ${HITS-before} requests`);
  if (out.M.images !== 1)  bad.push('M: the image never reached the wire');
  if (!/^image\//.test(out.M.media || '')) bad.push(`M: the wire carries no media type ("${out.M.media}")`);
  if (!(out.M.b64 > 100))  bad.push('M: the image arrived empty — the resize path is broken');
  if (r.raw !== '249,500') bad.push(`M: the reply did not reach the sheet ("${r.raw}")`);
  if (!/reads this month/i.test(r.txt)) bad.push('M: the monthly allowance is not shown after a read');
  await p.close();
}

/* ── N · the failures a person can actually hit, in words ────────────────── */
{
  const FAILS = [
    [429, { ok:false, error:'That is 80 reads this month, which is the Underwriter allowance.' }, /80 reads this month/],
    [422, { ok:false, error:'Nothing on those images could be read as a listing.' }, /Nothing on those images/],
    [502, { ok:false, error:'The reader did not answer. Nothing on your sheet changed.' }, /did not answer/],
  ];
  for (const [status, json, want] of FAILS){
    const p = await open();
    NEXT = { status, json };
    await p.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 20; c.height = 20;
      c.getContext('2d').fillRect(0,0,20,20);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .8));
      await intakeSend([new File([blob], 'a.jpg', { type:'image/jpeg' })]);
    });
    await p.waitForTimeout(700);
    const r = await p.evaluate(() => ({ txt:($('intake')||{innerText:''}).innerText.replace(/\s+/g,' '),
      asking: S.raw.asking || '', retry: !!document.getElementById('ik-pick') }));
    out['N' + status] = r;
    if (!want.test(r.txt)) bad.push(`N/${status}: the server's sentence never reached the person — "${r.txt.slice(0,140)}"`);
    if (r.asking)          bad.push(`N/${status}: something landed on a failed read`);
    if (!r.retry)          bad.push(`N/${status}: a dead end — no way to try again`);
    await p.close();
  }
  NEXT = null;
}

/* ── O · it survives a reload, and it travels between properties ─────────── */
{
  const p = await open();
  await land(p);
  await p.evaluate(() => save());
  await p.reload();
  await p.waitForFunction(() => typeof render === 'function', null, { timeout:20000 });
  await p.evaluate(() => { showStep('property'); render(); });
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({
    raw:S.raw.asking, src:S.src.asking, tr: !!(S.intake && S.intake.transcript),
    saw: (S.intake && S.intake.saw && S.intake.saw.asking || {}).saw,
    chip: (document.querySelector('#fb-asking .stchip')||{}).textContent || '',
  }));
  out.O = r;
  if (r.raw !== '249,500') bad.push('O: the read did not survive a reload');
  if (r.src !== 'photo')   bad.push('O: the receipt did not survive a reload — the figure lost its source');
  if (!r.tr)               bad.push('O: the transcript did not survive a reload, so the audit door leads nowhere');
  if (!/List price/.test(r.saw||'')) bad.push('O: the quotation did not survive a reload');
  if (!/READ/.test(r.chip))bad.push(`O: the chip forgot after a reload ("${r.chip.trim()}")`);
  await p.close();
}

/* ── P · reduced motion is still legible ─────────────────────────────────── */
{
  const p = await b.newPage({ viewport:{ width:1300, height:1100 } });
  await p.emulateMedia({ reducedMotion:'reduce' });
  p.on('pageerror', e => errs.push(String(e).slice(0,160)));
  await p.goto(BASE + '/desk.html');
  await p.evaluate(a => { localStorage.clear(); localStorage.setItem('ni-account-v1', JSON.stringify(a)); }, UW);
  await p.goto(BASE + '/desk.html');
  await p.waitForFunction(() => typeof render === 'function', null, { timeout:20000 });
  await p.evaluate(() => { showStep('property'); render(); });
  await p.evaluate(x => applyIntake(x), READ);
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({
    landing: document.querySelectorAll('.field.landing').length,
    raw: S.raw.asking, live: ($('intake-live')||{textContent:''}).textContent,
  }));
  out.P = r;
  if (r.raw !== '249,500') bad.push('P: the figure did not land under reduced motion');
  if (!r.landing) bad.push('P: reduced motion dropped the wash as well as the stagger — which row changed is information');
  if (!r.live)    bad.push('P: reduced motion lost the announcement');
  await p.close();
}

await b.close();
site.close();

if (errs.length) bad.push('page errors: ' + [...new Set(errs)].join(' | '));
console.log(JSON.stringify(out, null, 1).slice(0, 3200));
if (bad.length){ console.log('\n✗ ' + bad.length + ' PROBLEM(S)\n' + bad.map(x => '  · ' + x).join('\n')); process.exit(1); }
console.log('\n✓ the intake obeys the rule: a figure the person gave us outranks one we were handed');
