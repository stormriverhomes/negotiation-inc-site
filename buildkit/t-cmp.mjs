import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8301);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1400,height:1200},deviceScaleFactor:2});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CON '+m.text().slice(0,140))});
const B='http://localhost:8301';
await p.goto(B+'/desk.html'); await p.evaluate(()=>localStorage.clear());

// two sheets, both priced
const fill = async (addr,ask,arv,rep,rent)=>{
  await p.evaluate(v=>{ S.addr=v.addr; Object.assign(S.raw,{asking:v.ask,arv:v.arv,repairs:v.rep,rent:v.rent});
    save(); render(); }, {addr,ask,arv,rep,rent});
};
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(500);
await fill('118 Sylvan Rd SW','214000','300000','40500','1850');
await p.evaluate(()=>{ P.props.push(cleanProp({id:'x2',name:'',addr:'44 Peach Tree Ct',f:{}})); save(); loadInto(1); });
await fill('44 Peach Tree Ct','138000','196000','18000','1500');

// free tier → the worked example, and a door to plans
await p.goto(B+'/desk.html#compare'); await p.waitForTimeout(600);
const free = await p.evaluate(()=>({ shown:!document.getElementById('compare').hidden,
  lock:!!document.querySelector('.cmp-lock'),
  plans:(document.querySelector('.cmp-lock a')||{}).getAttribute?.('href'),
  rows:document.querySelectorAll('.cmp-r').length,
  pro:!!document.querySelector('#rn-cmp .rn-pro') }));
console.log('free:', free);
if (!free.shown || !free.lock || free.plans!=='plans.html' || free.rows < 6)
  throw new Error('compare: the free tier does not show a worked example with a door to plans');

// on a plan → the real thing
await p.evaluate(()=>{ const t=new Date().toISOString().slice(0,10);
  localStorage.setItem('ni-account-v1',JSON.stringify({name:'Elijah Payne',email:'e@x.co',since:t,trial:null,plan:'Underwriter'})); });
await p.goto(B+'/desk.html'); await p.waitForTimeout(200);
await p.goto(B+'/desk.html#compare'); await p.waitForTimeout(900);
/* The two fixed slots became a BENCH that grows with the plan: two on Solo,
   three on Underwriter, four on The Office. Empty, it is one drop target
   waiting; full, it is a row of properties in the order you put them. */
const empty = await p.evaluate(()=>({ cards:document.querySelectorAll('.dk').length,
  slots:document.querySelectorAll('.slot').length,
  emptySlots:document.querySelectorAll('.slot.empty').length,
  grid:!!document.querySelector('.cmp-grid'),
  wait:!!document.querySelector('.cmp-wait') }));
console.log('deck:', empty);
if (empty.cards !== 2) throw new Error('compare: the deck is not showing every property: '+empty.cards);
if (empty.slots !== 1 || empty.emptySlots !== 1)
  throw new Error('compare: the bench does not start as one empty drop target: '+JSON.stringify(empty));
if (empty.grid || !empty.wait) throw new Error('compare: it drew a table with nothing on it');
// pressing a card places it; pressing a second fills the other side
await p.click('.dk[data-card="0"]'); await p.waitForTimeout(250);
await p.click('.dk[data-card="1"]'); await p.waitForTimeout(500);
const paid = await p.evaluate(()=>({ lock:!!document.querySelector('.cmp-lock'),
  picks:document.querySelectorAll('.slot:not(.empty)').length,
  placed:document.querySelectorAll('.dk.placed').length,
  dials:document.querySelectorAll('[data-cmpadv]').length,
  names:[...document.querySelectorAll('.cmp-head .v')].map(e=>e.textContent.trim()),
  rows:document.querySelectorAll('.cmp-r').length,
  wins:document.querySelectorAll('.cmp-r .v.win').length,
  verdict:(document.querySelector('.cmp-verdict h3')||{}).textContent||'',
  flips:document.querySelectorAll('.cmp-f').length,
  crossed:document.querySelectorAll('.cmp-f:not(.none)').length,
  locked:document.querySelectorAll('.lockbit').length,
  cap3:window.__cmpMax ? window.__cmpMax() === 3 : null,
  emptyLeft:document.querySelectorAll('.slot.empty').length }));
console.log('paid:', paid);
if (paid.lock) throw new Error('compare: a paying member is still being shown the example');
if (paid.picks !== 2) throw new Error('compare: two cards did not fill two slots');
if (!paid.cap3) throw new Error('compare: an Underwriter is not offered a third seat on the bench');
if (paid.placed !== 2) throw new Error('compare: the deck does not mark what is on the table');
if (paid.dials < 3) throw new Error('compare: the shared assumptions are missing');
if (!paid.names.some(n=>/Sylvan/.test(n)) || !paid.names.some(n=>/Peach/.test(n)))
  throw new Error('compare: it is not showing the real sheets: '+JSON.stringify(paid.names));
if (paid.rows < 8) throw new Error('compare: too few rows to be a comparison');
if (!paid.wins) throw new Error('compare: nothing is marked as winning');
if (!/,/.test(paid.verdict)) throw new Error('compare: no verdict: '+paid.verdict);
if (paid.flips < 6) throw new Error('compare: the flip points are missing');
if (!paid.locked) throw new Error('compare: the next tier is not advertised');

// moving a shared dial re-prices both sides
const before = await p.evaluate(()=>document.querySelector('.cmp-r .v').textContent);
await p.evaluate(()=>{ const r=document.querySelector('[data-cmpadv="rate"]');
  r.value = r.max; r.dispatchEvent(new Event('input',{bubbles:true}));
  r.dispatchEvent(new Event('change',{bubbles:true})); });
await p.waitForTimeout(600);
const moved = await p.evaluate(()=>({ rate:P.adv.rate,
  ceil:[...document.querySelectorAll('.cmp-r')].find(r=>/Pay no more/.test(r.innerText))?.innerText }));
console.log('after the dial:', moved);
if (moved.rate < 11) throw new Error('compare: the shared dial did not move the model');
// taking a card back out empties the slot again
await p.click('[data-clear="1"]'); await p.waitForTimeout(350);
const cleared = await p.evaluate(()=>({ picks:CMP.picks.length,
  empty:document.querySelectorAll('.slot.empty').length,
  grid:!!document.querySelector('.cmp-grid') }));
console.log('cleared:', cleared);
if (cleared.picks !== 1 || cleared.grid) throw new Error('compare: taking a card out left the table up');
// pressing that card again puts it back
await p.click('.dk[data-card="1"]'); await p.waitForTimeout(350);
const refilled = await p.evaluate(()=>({ picks:CMP.picks.slice(),
  grid:!!document.querySelector('.cmp-grid') }));
console.log('refilled:', refilled);
if (!refilled.grid || refilled.picks.length !== 2 || refilled.picks[0] === refilled.picks[1])
  throw new Error('compare: the second card did not join the bench: '+JSON.stringify(refilled));
/* dropping a card onto a seat its twin already occupies must not put the same
   sheet on the bench twice — comparing a property with itself is the one
   answer this screen must never produce */
await p.evaluate(()=>{ CMP.picks = [0,1]; renderCompare(); });
await p.waitForTimeout(300);
await p.evaluate(()=>{ const dt=new DataTransfer(); dt.setData('text/plain','c0');
  document.querySelector('[data-slot="1"]').dispatchEvent(
    new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true})); });
await p.waitForTimeout(400);
const selfless = await p.evaluate(()=>({ picks:CMP.picks.slice() }));
console.log('self:', selfless);
if (new Set(selfless.picks).size !== selfless.picks.length)
  throw new Error('compare: a sheet was compared with itself');
// and the bench is reorderable: dragging seat 1 onto seat 0 swaps them
await p.evaluate(()=>{ CMP.picks = [0,1]; renderCompare(); });
await p.waitForTimeout(300);
await p.evaluate(()=>{ const dt=new DataTransfer(); dt.setData('text/plain','s1');
  document.querySelector('[data-slot="0"]').dispatchEvent(
    new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true})); });
await p.waitForTimeout(400);
const reordered = await p.evaluate(()=>CMP.picks.slice());
console.log('reordered:', reordered);
if (reordered[0] !== 1) throw new Error('compare: the bench cannot be reordered: '+JSON.stringify(reordered));

/* ── the tray, the shortlist, and the sheet that cannot be priced ────────
   Three things that were wrong or missing: the deck sat ABOVE the bench so you
   dragged downward (the gesture every OS teaches means "bin it"); nothing
   suggested an order across nine properties; and one unpriced sheet on the
   bench threw a TypeError out of the verdict and took the whole screen with
   it — nmOf(-1) reading .name off undefined. */
const tray = await p.evaluate(()=>{
  const t = document.getElementById('tray'), d = document.getElementById('cmp-deck');
  const bench = document.getElementById('bench');
  const cs = getComputedStyle(t);
  return { fixed: cs.position === 'fixed', bottom: cs.bottom,
           belowBench: !!(bench && t.compareDocumentPosition(bench) & Node.DOCUMENT_POSITION_PRECEDING),
           says: /drag one up/i.test(t.innerText),
           ranked: [...d.querySelectorAll('.dk-rank')].map(e=>e.textContent),
           shortlist: !!document.querySelector('.rankbar ol'),
           seat: !!document.getElementById('cmp-take'),
           pad: getComputedStyle(document.body).paddingBottom };
});
console.log('tray:', tray);
if (!tray.fixed || tray.bottom !== '0px') throw new Error('compare: the deck is not a tray at the bottom');
if (!tray.belowBench) throw new Error('compare: the deck is still above the bench — that is dragging into the bin');
if (!tray.says) throw new Error('compare: the tray does not say which way to drag');
if (tray.ranked.length !== 2) throw new Error('compare: the deck is not ranked: '+JSON.stringify(tray.ranked));
if (!tray.shortlist || !tray.seat) throw new Error('compare: an Underwriter gets no suggested order');
if (parseFloat(tray.pad) < 100) throw new Error('compare: the tray covers the bottom of the page');

// one press seats the shortlist
await p.evaluate(()=>{ CMP.picks=[]; renderCompare(); });
await p.waitForTimeout(300);
await p.click('#cmp-take'); await p.waitForTimeout(500);
const seated = await p.evaluate(()=>CMP.picks.slice());
console.log('seated:', seated);
if (seated.length !== 2) throw new Error('compare: seating the shortlist did nothing: '+JSON.stringify(seated));

// a sheet with nothing on it must not take the screen down
const blank = await p.evaluate(async ()=>{
  const errs=[]; const h=e=>errs.push(String(e.error||e.message)); window.addEventListener('error',h);
  P.props.push({id:'zz',name:'Blank',addr:'',raw:{},est:{},prov:{},unc:{},noAsk:false,
    comps:[],subj:{sqft:'',beds:'',baths:''},compAdj:{},sit:'unknown',sitPc:0,sys:{},sample:null});
  CMP.picks = [0, P.props.length-1];
  try { renderCompare(); } catch(e){ errs.push(String(e)); }
  await new Promise(r=>setTimeout(r,250));
  window.removeEventListener('error',h);
  return { errs, grid: !!document.querySelector('.cmp-grid'),
           verdict: (document.querySelector('.cmp-verdict h3')||{}).textContent||'',
           junk: /undefined|NaN/.test(document.body.innerText) };
});
console.log('blank sheet on the bench:', blank);
if (blank.errs.length) throw new Error('compare: an unpriced sheet still crashes it: '+blank.errs[0]);
if (!blank.grid) throw new Error('compare: an unpriced sheet emptied the table');
if (blank.junk) throw new Error('compare: undefined or NaN on screen');
await p.evaluate(()=>{ P.props.pop(); CMP.picks=[0,1]; renderCompare(); });
await p.waitForTimeout(300);

// the bench survives leaving the room
await p.evaluate(()=>{ CMP.picks=[1,0]; renderCompare(); });
await p.waitForTimeout(300);
await p.goto(B+'/desk.html'); await p.waitForTimeout(400);
await p.goto(B+'/desk.html#compare'); await p.waitForTimeout(900);
const kept = await p.evaluate(()=>CMP.picks.slice());
console.log('bench after a round trip:', kept);
if (kept.length !== 2 || kept[0] !== 1) throw new Error('compare: the bench emptied itself: '+JSON.stringify(kept));

// closing puts the sheet back
await p.click('#cmp-close'); await p.waitForTimeout(400);
const back = await p.evaluate(()=>({ cmp:document.getElementById('compare').hidden,
  res:document.getElementById('results').hidden, flow:document.getElementById('flow').hidden }));
console.log('closed:', back);
if (!back.cmp || (back.res && back.flow)) throw new Error('compare: closing left the desk on nothing');

// the sheet that was open is still the sheet that is open
const act = await p.evaluate(()=>({ active:P.active, addr:S.addr, n:P.props.length }));
console.log('after:', act);
if (act.n !== 2) throw new Error('compare: it lost a property');
if (errs.length) throw new Error('compare: page errors '+JSON.stringify(errs));
console.log('PASS — the comparison prices both sheets with one engine and says where it flips');
await b.close(); srv.close();
