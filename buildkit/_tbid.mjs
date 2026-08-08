import { chromium } from 'playwright';
import { fillSheet, step } from './harness-util.mjs';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const F=[], ck=(c,m)=>{ if(!c) F.push(m); };
const out = {};
const p = await b.newPage({ viewport:{width:1200,height:1100} });
/* file:// cannot fetch a woff2 — that is the protocol, not the page */
const noise = t => /CORS policy|ERR_FAILED|fonts\/[a-z-]+\.woff2/.test(t);
const errs=[]; p.on('pageerror',e=>{ if(!noise(e.message)) errs.push(e.message); });
p.on('console',m=>{ if(m.type()==='error' && !noise(m.text())) errs.push(m.text()); });
await p.goto('file:///home/claude/dist/desk.html'); await p.waitForTimeout(400);
await p.evaluate(()=>localStorage.clear()); await p.reload(); await p.waitForTimeout(500);

// 1 · nothing at all before there is an estimate
await step(p,'condition');
out.beforeEstimate = await p.evaluate(()=>document.getElementById('bidcheck').innerHTML.length);
ck(out.beforeEstimate === 0, 'bid: a card is showing before the sheet has an estimate to check');

// 2 · a signed-out reader with an estimate sees the locked card, not the box
await fillSheet(p,{ asking:'184,500', arv:'291,000' });
await p.evaluate(()=>{ S.sys.roof=60; S.sys.elec=50; S.sys.kitchen=70; S.sys.hvac=40; save(); render(); });
await step(p,'condition'); await p.waitForTimeout(250);
out.locked = await p.evaluate(()=>({
  locked: !!document.querySelector('#bidcheck .bidc.locked'),
  box:    !!document.getElementById('bd-open'),
  says:   (document.querySelector('#bidcheck .bidc b')||{}).textContent }));
ck(out.locked.locked && !out.locked.box, 'bid: a signed-out reader is being offered the paste box');

// 3 · entitled: the offer, then the textarea
await p.evaluate(()=>{ window.__entitleOverride = true; });
out.lines = await p.evaluate(()=>{
  // stand the entitlement up the way a trial does
  localStorage.setItem('ni-account-v1', JSON.stringify({ name:'T', email:'t@example.com', plan:'underwriter' }));
  return null; });
await p.reload(); await p.waitForTimeout(600);
await step(p,'condition'); await p.waitForTimeout(250);
out.open = await p.evaluate(()=>({ offer: !!document.getElementById('bd-open'),
  locked: !!document.querySelector('#bidcheck .bidc.locked') }));
ck(out.open.offer, 'bid: an entitled reader is not being offered the check');

// 4 · the sheet it would send is the panel's own arithmetic
out.sheet = await p.evaluate(()=>bidSheetLines());
out.panelTotal = await p.evaluate(()=>Math.round(condTotalOf(val('arv'))));
const sum = Object.values(out.sheet||{}).reduce((a,n)=>a+n,0);
ck(Math.abs(sum - out.panelTotal) <= 17,
  `bid: the sheet it sends (${sum}) is not the estimate the panel prints (${out.panelTotal})`);

// 5 · a stubbed answer renders, and the honest figure is the one in big type
await p.evaluate(()=>{
  BIDC.data = { rows: LINES.map(l=>({ id:l.id, lab:l.lab,
      est: ({roof:15000,elec:9000,kitchen:26000,hvac:11000})[l.id]||0,
      bid: ({roof:14200,elec:6850,kitchen:28400})[l.id]||0,
      delta: ({roof:-800,elec:-2150,kitchen:2400})[l.id] ?? null,
      priced: ['roof','elec','kitchen'].includes(l.id), quoted: ['roof','elec','kitchen'].includes(l.id),
      items: ['roof','elec','kitchen'].includes(l.id) ? [{text:'a line', amount:1, line:l.id}] : [] })),
    missing:[{id:'hvac',lab:'HVAC',est:11000}], missingTotal:11000,
    provisional:[], provisionalTotal:0, extra:[], other:{lab:'Not one of the seventeen',bid:3200,items:[{text:'Dumpster'}]},
    bidTotal:52650, statedTotal:52650, statedGap:0, sheetTotal:61000, gap:-8350,
    withMissing:63650, counts:{items:4,dropped:1,unpriced:0,systemsQuoted:3,systemsOnSheet:4},
    dropped:[], exclusions:['Excludes permits.'], unreadable:null };
  BIDC.month = { used:1, cap:20, left:19 };
  renderBid(); wireBid();
});
await p.waitForTimeout(200);
out.render = await p.evaluate(()=>({
  big: (document.querySelector('#bidcheck .bv .n')||{}).textContent,
  over: !!document.querySelector('#bidcheck .bv.over'),
  label: (document.querySelector('#bidcheck .bv .l')||{}).textContent,
  missing: [...document.querySelectorAll('#bidcheck .bmiss li')].map(l=>l.textContent.trim()),
  rows: document.querySelectorAll('#bidcheck .btab tbody tr').length,
  use: (document.getElementById('bd-use')||{}).textContent,
  dropped: /1 figure was dropped/.test(document.querySelector('#bidcheck .bv .s').textContent),
}));
ck(/2,650/.test(out.render.big), `bid: the big figure is "${out.render.big}", not the 2,650 the sheet is over by`);
ck(out.render.over, 'bid: a bid that is over once completed is not drawn as over');
ck(out.render.missing.length === 1 && /HVAC/.test(out.render.missing[0]), 'bid: the omission is not listed');
ck(/63,650/.test(out.render.use||''), `bid: the button offers "${out.render.use}", not the honest figure`);
ck(out.render.dropped, 'bid: the dropped figure is not disclosed to the reader');

// 6 · the button writes the honest figure AND says where it came from
await p.click('#bd-use'); await p.waitForTimeout(300);
out.used = await p.evaluate(()=>({ repairs: S.raw.repairs, est: S.est.repairs, prov: S.prov.repairs }));
ck(out.used.repairs === '63,650', `bid: the repair field took "${out.used.repairs}"`);
ck(out.used.est === false, 'bid: the figure it wrote is still flagged an estimate');
ck(/plus .*for the work it does not price/.test(out.used.prov||''),
   `bid: the provenance does not say what it added — "${out.used.prov}"`);

// 7 · typing in the box survives a render
await p.evaluate(()=>{ BIDC.data=null; BIDC.open=true; BIDC.text=''; renderBid(); wireBid(); });
await p.click('#bd-text');
await p.type('#bd-text', 'Tear off and replace roof, 30yr arch shingle .......... $14,200');
await p.evaluate(()=>render());
await p.waitForTimeout(150);
out.typing = await p.evaluate(()=>({ v: document.getElementById('bd-text')?.value || '',
  focused: document.activeElement && document.activeElement.id }));
ck(/14,200/.test(out.typing.v), `bid: a render threw away what was being typed — "${out.typing.v}"`);

out.errs = errs;
ck(!errs.length, 'bid: console errors — ' + errs.join('; '));
console.log(JSON.stringify(out,null,1));
console.log(F.length ? 'FAIL\n - ' + F.join('\n - ')
  : 'PASS — nothing before there is an estimate, locked for the free tier, the sheet it sends is the\n  + panel it prints, the big figure is the completed one, the button writes it with its provenance,\n  + and a re-render does not eat what somebody is pasting');
await b.close();
process.exit(F.length ? 1 : 0);
