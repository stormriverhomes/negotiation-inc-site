/* t-letter — Part V, the ask.
     A · every draft comes out of the offer, so moving a lever moves the letter.
         If these two ever disagree the product has told somebody a number it
         cannot defend, which is the one failure this thing cannot survive.
     B · the four rules the module is built on, tested as rules:
           · the ceiling never appears in a draft
           · "cash" only appears when the person said cash
           · the lead paragraph follows what THIS seller is buying
           · the LOI says in words that it is not a contract
     C · an edited draft stops being regenerated and says so, and the reset
         puts it back — losing typing is unforgivable in a text box.
     D · free and Solo get the real opening line and the gate; Underwriter
         gets all three drafts.
     E · the brand: The Office's name on the masthead, Negotiation Inc in the
         footer — and nobody else's plan gets it. */
import { chromium } from 'playwright';

const B = 'file:///home/claude/dist/';
const b = await chromium.launch();
const out = {}; const bad = [];
const NOISE = /fraunces\.woff2|ERR_FAILED/;
const errs = [];
const p = await b.newPage({ viewport:{ width:1400, height:1000 } });
p.on('pageerror', e => errs.push(String(e)));
p.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(m.text()); });

const seed = (plan, sit) => p.evaluate(([pl, st]) => {
  localStorage.clear();
  localStorage.setItem('ni-account-v1', JSON.stringify({ name:'Elijah Payne', email:'e@x.com', plan:pl, trial:null }));
  localStorage.setItem('ni-desk-v3', JSON.stringify({ active:0, props:[{
    name:'1104 Elm', addr:'1104 Elm Street', sit:st, sitPc:58, sys:{}, comps:[{},{}],
    subj:{ sqft:'1420', beds:'3', baths:'2' }, compAdj:{},
    f:{ asking:{v:'168000'}, arv:{v:'249000'}, repairs:{v:'46000'}, rent:{v:'1875'} } }] }));
}, [plan, sit]);

const openLetters = async (plan, sit) => {
  await p.goto(B + 'desk.html');
  await seed(plan, sit || 'motivated');
  await p.goto(B + 'desk.html'); await p.waitForTimeout(500);
  await p.goto(B + 'desk.html#letter'); await p.waitForTimeout(700);
};
const draft = tab => p.evaluate(t => {
  const b2 = document.querySelector(`[data-lt="${t}"]`); if (b2) b2.click();
  const ta = document.getElementById('lt-body');
  return ta ? ta.value : null;
}, tab);

/* ── A · the letter is the offer, in words ──────────────────────────────── */
await openLetters('underwriter');
out.A = await p.evaluate(() => ({
  open: !document.getElementById('letters').hidden,
  tabs: document.querySelectorAll('[data-lt]').length,
  price: (() => { const m = offerModel(); return m ? Math.round(m.price) : null; })(),
}));
if (!out.A.open)      bad.push('A: #letter did not open the room');
if (out.A.tabs !== 3) bad.push(`A: ${out.A.tabs} drafts, not 3`);

const em = await draft('email');
out.Aprice = { inDraft: em && em.indexOf(out.A.price.toLocaleString('en-US')) >= 0 };
if (!out.Aprice.inDraft) bad.push('A: the offer price is not in the email draft');

/* move a lever and the draft has to follow */
await p.evaluate(() => { S.lev.days = 9; S.lev.insp = 0; S.lev.stay = 21; renderLetters(); });
await p.waitForTimeout(250);
const em2 = await draft('email');
out.Afollow = { days9: /9 days from acceptance/.test(em2),
                waived: /No inspection contingency/i.test(em2),
                stay: /21 days after closing, rent-free/.test(em2) };
for (const k in out.Afollow) if (!out.Afollow[k]) bad.push(`A: the draft did not follow the lever — ${k}`);

/* ── B · the four rules ─────────────────────────────────────────────────── */
const all = { text: await draft('text'), email: await draft('email'), loi: await draft('loi') };
out.B = {};
const ceil = await p.evaluate(() => { const m = offerModel(); return m ? Math.round(m.hi) : null; });
const ceilStr = ceil.toLocaleString('en-US');
for (const k in all){
  if (all[k].indexOf(ceilStr) >= 0) bad.push(`B: the ceiling (${ceilStr}) is printed in the ${k} draft`);
  if (/ceiling|spread|margin|profit|ARV|BRRRR|wholesal/i.test(all[k]))
    bad.push(`B: a word from your side of the table leaked into the ${k} draft`);
}
out.B.noCeiling = true;
out.B.loiNotAContract = /not a contract and it binds neither of us/i.test(all.loi);
if (!out.B.loiNotAContract) bad.push('B: the letter of intent does not say it is not a contract');

/* "cash" is a claim, so it appears only when the person made it */
await p.evaluate(() => { document.querySelector('[data-fin="conv"]').click(); });
await p.waitForTimeout(400);
const fin = await draft('email');
out.B.finConv = { saysFinanced: /financed and I am already approved/i.test(fin),
                  saysCash: /\bThis is cash\b/.test(fin) };
if (!out.B.finConv.saysFinanced) bad.push('B: choosing a bank loan did not change what the draft claims');
if (out.B.finConv.saysCash)      bad.push('B: the draft still claims cash after the person said it was financed');
await p.evaluate(() => { document.querySelector('[data-fin="cash"]').click(); });
await p.waitForTimeout(300);

/* the lead follows the seller — an estate and a seller with a clock get
   different first paragraphs, which is the whole point of the weighting */
const leads = {};
for (const sit of ['urgent','estate','nohurry']){
  await openLetters('underwriter', sit);
  leads[sit] = (await draft('email')).split('\n').filter(Boolean)[2] || '';
}
out.Bleads = Object.fromEntries(Object.entries(leads).map(([k,v]) => [k, v.slice(0,52)]));
if (!/close on/i.test(leads.urgent))       bad.push('B: a seller who needs it gone is not led with the date');
if (!/actually close/i.test(leads.estate)) bad.push('B: an estate is not led with certainty');
if (!/My number/i.test(leads.nohurry))     bad.push('B: a seller in no hurry is not led with the number');
if (leads.urgent === leads.estate)         bad.push('B: two different sellers got the same letter');

/* ── C · an edited draft is never overwritten ───────────────────────────── */
await openLetters('underwriter');
await draft('email');
await p.click('#lt-body');
await p.evaluate(() => { const ta = document.getElementById('lt-body');
  ta.value = 'MY OWN WORDS'; ta.dispatchEvent(new Event('input', { bubbles:true })); });
await p.waitForTimeout(250);
out.C = await p.evaluate(() => ({ warned: !!document.querySelector('.ltdirty'),
  reset: !!document.getElementById('lt-reset') }));
if (!out.C.warned) bad.push('C: an edited draft gives no sign it has stopped being rewritten');
/* switching away and back must not eat it */
await p.evaluate(() => document.querySelector('[data-lt="text"]').click()); await p.waitForTimeout(200);
await p.evaluate(() => document.querySelector('[data-lt="email"]').click()); await p.waitForTimeout(250);
out.Ckept = await p.evaluate(() => document.getElementById('lt-body').value);
if (out.Ckept !== 'MY OWN WORDS') bad.push('C: an edit was thrown away by changing tabs');
await p.evaluate(() => document.getElementById('lt-reset').click()); await p.waitForTimeout(300);
out.Creset = await p.evaluate(() => (document.getElementById('lt-body').value || '').slice(0,8));
if (out.Creset === 'MY OWN ') bad.push('C: starting again from the sheet did nothing');

/* ── D · the tier line ──────────────────────────────────────────────────── */
for (const [plan, paid] of [['', false], ['solo', false], ['underwriter', true], ['the office', true]]){
  await openLetters(plan);
  const r = await p.evaluate(() => ({
    body: !!document.getElementById('lt-body'),
    taste: (document.querySelector('.lttaste')||{}).textContent || null,
    gate: !!document.querySelector('.ltgate') }));
  out['D:' + (plan || 'free')] = { body:r.body, gate:r.gate, tasteLen:(r.taste||'').length };
  if (paid && !r.body)  bad.push(`D: ${plan||'free'} cannot see the drafts`);
  if (paid && r.gate)   bad.push(`D: ${plan||'free'} is being sold something it already has`);
  if (!paid && r.body)  bad.push(`D: ${plan||'free'} was handed the whole draft`);
  if (!paid && !r.gate) bad.push(`D: ${plan||'free'} gets no gate and no drafts — a dead room`);
  if (!paid && (r.taste||'').length < 60)
    bad.push(`D: ${plan||'free'} sees no real opening line — the taste is ${(r.taste||'').length} chars`);
}

/* ── E · the brand ──────────────────────────────────────────────────────── */
for (const [plan, branded] of [['underwriter', false], ['the office', true]]){
  await p.goto(B + 'desk.html');
  await seed(plan, 'motivated');
  await p.evaluate(() => { const a = JSON.parse(localStorage.getItem('ni-account-v1'));
    a.co = 'Stormriver Homes'; localStorage.setItem('ni-account-v1', JSON.stringify(a)); });
  await p.goto(B + 'desk.html'); await p.waitForTimeout(800);
  const r = await p.evaluate(() => { render();
    const d = document.getElementById('printdoc');
    return { head: (d.textContent||'').slice(0, 160), brand: !!(window.brandOf && brandOf()) }; });
  out['E:' + plan] = { co: /Stormriver Homes/.test(r.head), ni: /NEGOTIATION/.test(r.head) };
  if (branded && !out['E:'+plan].co) bad.push('E: The Office paid for its name on the packet and did not get it');
  if (branded && out['E:'+plan].ni)  bad.push('E: a branded packet still wears the Negotiation Inc masthead');
  if (!branded && out['E:'+plan].co) bad.push('E: a plan that did not pay for branding got it anyway');
  if (!branded && !out['E:'+plan].ni) bad.push('E: an unbranded packet lost its masthead');
}

out.errs = errs;
if (errs.length) bad.push('console errors — ' + errs.slice(0,2).join(' | '));

await b.close();
console.log(JSON.stringify(out, null, 1));
console.log(bad.length ? 'FAIL\n - ' + bad.join('\n - ')
  : 'PASS — the letter is the offer in words, it claims nothing the sheet cannot support, it never prints your ceiling, and an edit is never eaten');
process.exit(bad.length ? 1 : 0);
