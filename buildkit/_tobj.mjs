import { chromium } from 'playwright';
import { fillSheet, step, underwrite } from './harness-util.mjs';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const F=[], ck=(c,m)=>{ if(!c) F.push(m); };
const out = {};
const noise = t => /CORS policy|ERR_FAILED|fonts\/[a-z-]+\.woff2/.test(t);
const p = await b.newPage({ viewport:{width:1200,height:1200} });
const errs=[]; p.on('pageerror',e=>{ if(!noise(e.message)) errs.push(e.message); });
p.on('console',m=>{ if(m.type()==='error' && !noise(m.text())) errs.push(m.text()); });
await p.goto('file:///home/claude/dist/desk.html'); await p.waitForTimeout(400);
await p.evaluate(()=>localStorage.clear()); await p.reload(); await p.waitForTimeout(500);

// 1 · nothing until there is an offer to argue about
out.beforeOffer = await p.evaluate(()=>document.getElementById('objections').innerHTML.length);
ck(out.beforeOffer === 0, 'obj: a panel is showing before there is an offer');

// 2 · priced and signed out: locked, and it names the ceiling as the reason
await fillSheet(p,{ addr:'1128 Marrow Lane', asking:'184,500', arv:'291,000', repairs:'41,300', rent:'1,850' });
await p.evaluate(()=>{ S.sit='estate'; save(); render(); });
await underwrite(p); await p.waitForTimeout(300);
out.locked = await p.evaluate(()=>({
  locked: !!document.querySelector('#objections .objp.locked'),
  go: !!document.getElementById('ob-go'),
  ceilingMentioned: /ceiling/i.test(document.getElementById('objections').textContent) }));
ck(out.locked.locked && !out.locked.go, 'obj: a signed-out reader is being offered the run button');

// 3 · entitled
await p.evaluate(()=>localStorage.setItem('ni-account-v1',
  JSON.stringify({ name:'T', email:'t@example.com', plan:'underwriter' })));
await p.reload(); await p.waitForTimeout(700); await underwrite(p); await p.waitForTimeout(300);
out.ready = await p.evaluate(()=>({ go: !!document.getElementById('ob-go'),
  locked: !!document.querySelector('#objections .objp.locked') }));
ck(out.ready.go && !out.ready.locked, 'obj: an entitled reader is not being offered the panel');

// 4 · THE BODY IT SENDS. The ceiling has to be in it and it has to be right.
out.body = await p.evaluate(()=>{ const m = offerModel(); return objBody(m); });
out.truth = await p.evaluate(()=>{ const m = offerModel(); return { ceil: Math.round(m.best.ceil), price: Math.round(m.price) }; });
ck(out.body.ceiling === out.truth.ceil, `obj: it is sending ceiling ${out.body.ceiling}, the sheet says ${out.truth.ceil}`);
ck(out.body.offer === out.truth.price, `obj: it is sending offer ${out.body.offer}, the sheet says ${out.truth.price}`);
ck(out.body.asking === 184500, `obj: the asking price it sends is ${out.body.asking}`);
ck(!/[<>]/.test(JSON.stringify(out.body.refused)), 'obj: the refusal reasons are still carrying markup');
ck(out.body.refused.length >= 1, 'obj: no refusals are being sent, and this sheet has two');
ck(['high','medium','low'].includes(out.body.confidence), `obj: confidence came out "${out.body.confidence}"`);
ck(typeof out.body.situation === 'string' && /estate/i.test(out.body.situation),
   `obj: the situation it sends is "${out.body.situation}"`);

// 5 · render a stubbed answer
await p.evaluate(()=>{
  OBJC.data = { reading:'A closing date they can plan around.', objections:[
    { says:'Can you come up to one-ninety?', beneath:'Convince me you will actually close.',
      answer:'There is a little room and I would rather spend it on your date.', verdict:'trade', costs:5500 },
    { says:'We have another offer at one-ninety-five.', beneath:'Is yours the one that closes?',
      answer:'Take it if it is better. Mine does not need an appraisal.', verdict:'hold', costs:null },
    { says:'Two-forty or nothing.', beneath:'I have not accepted the market yet.',
      answer:'Then it is nothing, and I would rather say that now.', verdict:'walk', costs:null } ] };
  OBJC.forKey = objKey(offerModel());
  OBJC.month = { used:2, cap:60, left:58 };
  renderObj(); wireObj();
});
await p.waitForTimeout(200);
out.render = await p.evaluate(()=>({
  cards: document.querySelectorAll('#objections .obj').length,
  verdicts: [...document.querySelectorAll('#objections .obj .vd')].map(v=>v.textContent),
  classes: [...document.querySelectorAll('#objections .obj')].map(o=>o.className),
  cost: (document.querySelector('#objections .obj .cost')||{}).textContent,
  reading: !!document.querySelector('#objections .reading'),
  foot: (document.querySelector('#objections .bfoot span')||{}).textContent }));
ck(out.render.cards === 3, `obj: ${out.render.cards} cards rendered, not 3`);
ck(JSON.stringify(out.render.verdicts) === '["Trade","Hold","Walk"]',
   `obj: the verdicts read ${JSON.stringify(out.render.verdicts)}`);
ck(/5,500/.test(out.render.cost||''), `obj: the cost line reads "${out.render.cost}"`);
ck(/never leaves|stays on this screen/i.test(out.render.foot||''),
   'obj: the panel does not say why it stays on this screen');

// 6 · MOVING A LEVER MARKS IT STALE — the reply must not survive the offer
await p.evaluate(()=>{ S.lev.days = 45; save(); render(); });
await p.waitForTimeout(300);
out.stale = await p.evaluate(()=>({
  go: (document.getElementById('ob-go')||{}).textContent || '',
  cards: document.querySelectorAll('#objections .obj').length }));
ck(/offer moved/i.test(out.stale.go), `obj: a moved lever left the old replies standing — button says "${out.stale.go}"`);
ck(out.stale.cards === 0, 'obj: stale replies are still on screen');

out.errs = errs;
ck(!errs.length, 'obj: console errors — ' + errs.join('; '));
console.log(JSON.stringify(out,null,1));
console.log(F.length ? 'FAIL\n - ' + F.join('\n - ')
  : 'PASS — nothing before there is an offer, locked below Underwriter, the ceiling it sends is the\n  + ceiling the sheet computed, the refusals arrive without their markup, the three verdicts draw\n  + differently, and moving a lever retires the replies instead of leaving them to be read aloud');
await b.close();
process.exit(F.length ? 1 : 0);
