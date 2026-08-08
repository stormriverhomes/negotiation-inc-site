/* t-box — the buy box: the rules that refuse the drive-out.
   The feature is a "no" said early enough to save a morning, so the tests are
   about honesty rather than arithmetic: a rule that cannot be checked must SAY
   it was not checked, the switch must belong to the plan that sells it, and a
   downgrade must actually turn it off rather than quietly leaving it running. */
import { chromium } from 'playwright';

const B = 'file:///home/claude/dist/';
const b = await chromium.launch();
const out = {}; const bad = [];
const NOISE = /fraunces\.woff2|ERR_FAILED/;

const seed = plan => {
  localStorage.clear();
  localStorage.setItem('ni-account-v1', JSON.stringify({name:'E', email:'e@x.com', plan, trial:null}));
  const mk = (n, ask, arv, rep, rent) => ({ name:n, addr:n + ', Atlanta GA 30310', mode:'simple',
    comps:[{},{}], sit:'estate', sys:{}, subj:{}, compAdj:{},
    f:{ asking:{v:ask}, arv:{v:arv}, repairs:{v:rep}, rent:{v:rent} } });
  localStorage.setItem('ni-desk-v3', JSON.stringify({ active:0, props:[
    mk('Fat spread','120000','260000','20000','1900'),     // should fit
    mk('Too much work','160000','240000','62000','1700'),  // repairs 26% of ARV
    { name:'Nothing typed', addr:'Somewhere', mode:'simple', comps:[], sit:'unknown',
      sys:{}, subj:{}, compAdj:{}, f:{} },                 // unpriceable
  ]}));
};
const open = async (p, hash) => {   /* a fragment nav does not reload; go home first */
  await p.goto(B + 'desk.html'); await p.waitForTimeout(500);
  await p.goto(B + 'desk.html' + hash); await p.waitForTimeout(1000);
};

const p = await b.newPage({ viewport:{width:1400,height:1100} });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
p.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(m.text()); });

/* ── A · The Office: the switch is real, the count is live ─────────────── */
await p.goto(B + 'desk.html');
await p.evaluate(seed, 'the office');
await open(p, '#buybox');
out.A = await p.evaluate(() => ({
  screen: !document.getElementById('buybox').hidden,
  chrome: getComputedStyle(document.getElementById('deskh1')).display,
  dials: document.querySelectorAll('[data-box]').length,
  exits: document.querySelectorAll('[data-boxexit]').length,
  items: document.querySelectorAll('.bxitem').length,
  hasSwitch: !!document.getElementById('bx-on'),
  locked: !!document.querySelector('.bxswitch.lk'),
  count: (document.querySelector('.bxcount b')||{}).textContent }));
if (!out.A.screen)    bad.push('A: the buy-box screen did not open');
if (out.A.chrome !== 'none') bad.push('A: the sheet chrome is still stacked above it');
if (out.A.dials !== 5) bad.push('A: wrong number of rules — ' + out.A.dials);
if (out.A.exits !== 7) bad.push('A: not every exit can be switched off');
if (out.A.items !== 3) bad.push('A: the list does not cover every property');
if (!out.A.hasSwitch || out.A.locked) bad.push('A: The Office is being sold the plan it is on');

/* moving a rule moves the count — that IS the feature */
const before = out.A.count;
await p.evaluate(() => { const r = document.querySelector('[data-box="minSpread"]');
  r.value = r.max; r.dispatchEvent(new Event('input',{bubbles:true}));
  r.dispatchEvent(new Event('change',{bubbles:true})); });
await p.waitForTimeout(500);
out.Amoved = await p.evaluate(() => ({ count:(document.querySelector('.bxcount b')||{}).textContent,
  spread: P.box.minSpread }));
if (out.Amoved.count === before && out.Amoved.spread <= 20000)
  bad.push('A: moving a rule did not change what survives it');
await p.evaluate(() => { P.box.minSpread = 20000; P.box.maxRepPc = 20; save(); renderBuyBox(); });
await p.waitForTimeout(300);

/* ── B · a rule it cannot check says so, and never silently passes ─────── */
/* rules set explicitly, so "fits" and "fails" are claims about the ENGINE
   rather than about whichever defaults happened to ship */
await p.evaluate(() => {
  P.box.on = true; P.box.minSpread = 20000; P.box.minRoom = -50000; P.box.maxRepPc = 20;
  P.box.minPrice = 0; P.box.maxPrice = 400000; P.box.zips = '';
  for (const k in P.box.exits) P.box.exits[k] = 1;
  save();
});
await open(p, '#open=2');                       // the sheet with nothing on it
out.B = await p.evaluate(() => {
  const box = document.getElementById('boxsay');
  return { txt: box.innerText,
           skips: box.querySelectorAll('li.skip').length,
           fails: box.querySelectorAll('li.no').length,
           chip: (box.querySelector('.bxchip')||{}).className };
});
if (!out.B.skips)  bad.push('B: an unpriceable sheet reports no skipped rules');
if (/^Fits your buy box/.test(out.B.txt))
  bad.push('B: a sheet with nothing on it was declared a fit outright');

/* ── C · the failing sheet names the rule it failed ────────────────────── */
await open(p, '#open=1');
out.C = await p.evaluate(() => ({ txt: document.getElementById('boxsay').innerText,
  fails: document.querySelectorAll('#boxsay li.no').length }));
if (!out.C.fails) bad.push('C: a sheet needing 26% of ARV in work passed the 20% rule');
if (!/Repairs/.test(out.C.txt)) bad.push('C: the failure does not name the rule');

/* and the one that should fit, fits */
await open(p, '#open=0');
out.Cfit = await p.evaluate(() => document.getElementById('boxsay').innerText.split('\n')[0]);
if (!/Fits/.test(out.Cfit)) bad.push('C: the sheet built to pass did not: ' + out.Cfit +
  ' — ' + JSON.stringify(await p.evaluate(() => document.getElementById('boxsay').innerText)));

/* ── D · the bench and the deck carry it too ───────────────────────────── */
await open(p, '#compare');
await p.evaluate(() => { CMP.picks = [0,1]; renderCompare(); });
await p.waitForTimeout(700);
out.D = await p.evaluate(() => ({
  deck: document.querySelectorAll('.dk .bxchip').length,
  bench: document.querySelectorAll('.slot .bxchip').length,
  row: [...document.querySelectorAll('.cmp-r')].some(r => /Your buy box/.test(r.innerText)) }));
if (out.D.deck < 3) bad.push('D: the deck cards do not carry the verdict');
if (out.D.bench < 2) bad.push('D: the bench seats do not carry the verdict');
if (!out.D.row) bad.push('D: the comparison table has no buy-box row');

/* ── E · the plan owns the switch, and a downgrade turns it off ────────── */
for (const plan of ['solo','underwriter']){
  await p.evaluate(pl => { const a = JSON.parse(localStorage.getItem('ni-account-v1'));
    a.plan = pl; localStorage.setItem('ni-account-v1', JSON.stringify(a)); }, plan);
  await open(p, '#buybox');
  const r = await p.evaluate(() => ({
    locked: !!document.querySelector('.bxswitch.lk'),
    hasSwitch: !!document.getElementById('bx-on'),
    /* the rules still run on their own properties — showing it is the argument */
    items: document.querySelectorAll('.bxitem').length,
    disabled: document.querySelectorAll('[data-box]:disabled').length,
    plans: !!document.querySelector('.bxswitch.lk a[href="plans.html"]') }));
  out['E:' + plan] = r;
  if (!r.locked || r.hasSwitch) bad.push(`E: ${plan} can switch on an Office feature`);
  if (r.items !== 3) bad.push(`E: ${plan} is not shown the box running on their own properties`);
  if (r.disabled !== 5) bad.push(`E: ${plan} can edit rules they cannot use`);
  if (!r.plans) bad.push(`E: ${plan} is not told which plan opens it`);
  /* and with the flag still set from the Office run, nothing may be enforced */
  await open(p, '#open=1');
  const on = await p.evaluate(() => ({ flag: P.box.on,
    said: (document.getElementById('boxsay')||{}).innerText }));
  out['E:' + plan + ':enforced'] = on;
  if (on.said.trim()) bad.push(`E: the box is still refusing houses on ${plan}`);
}

out.errs = errs;
if (errs.length) bad.push('console errors: ' + errs.slice(0,2).join(' | '));
await b.close();
console.log(JSON.stringify(out, null, 1));
console.log(bad.length ? 'FAIL\n - ' + bad.join('\n - ')
  : 'PASS — the box refuses what it should, says what it could not check, and belongs to the plan that sells it');
process.exit(bad.length ? 1 : 0);
