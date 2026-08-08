import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8361);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const B='http://localhost:8361';
const F=[], ck=(c,m)=>{ if(!c) F.push(m); };
const p=await b.newPage({viewport:{width:1300,height:1000}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));

// a demo sheet has comps scored and condition dragged — exactly what the packet needs
await p.goto(B+'/desk.html'); await p.evaluate(()=>localStorage.clear());
await p.goto(B+'/desk.html#demo=flip'); await p.waitForTimeout(900);
await p.evaluate(()=>__showResults()); await p.waitForTimeout(600);

/* ── a demo may SEE the packet, and must say it is a sample ──────────────────
   entitled() is false inside a demo on purpose — a demo may not SPEND. But
   drawing a document about a house that does not exist spends nothing, and
   the demo is the one screen whose whole job is showing what $39 buys. When
   the packet was moved from premium() to entitled() it silently vanished from
   every demo; this harness was not on the board, so nothing said so. */
const paid = await p.evaluate(()=>{ const d=document.getElementById('printdoc');
  return { txt:d.innerText, comps:/WHERE THE ARV CAME FROM/.test(d.innerText),
    cond:/WHAT THE REPAIR FIGURE IS MADE OF/.test(d.innerText),
    rows:d.querySelectorAll('table').length, name:/Prepared by/.test(d.innerText),
    noAvm:/No automated valuation model was used/.test(d.innerText),
    sample:/Sample packet/i.test(d.innerText),
    range:/The supported range/.test(d.innerText) }; });
console.log('paid:', {...paid, txt:undefined, len:paid.txt.length});
ck(paid.comps, 'the packet has no comp evidence');
ck(paid.cond, 'the packet does not break down the repair figure');
ck(paid.range, 'the packet does not state the supported range');
ck(paid.noAvm, 'the packet does not say it is not an AVM');
ck(paid.sample, 'a demo packet does not say it is a sample');
ck(paid.rows>=3, 'the packet is missing tables: '+paid.rows);
ck(!/undefined|NaN|\$NaN/.test(paid.txt), 'the packet prints undefined or NaN');

/* ── the thin packet: a real paid account, a typed ARV, no comps ─────────────
   Both evidence sections used to be wrapped in "if there is evidence", so a
   packet built on a typed ARV reached a lender carrying NO statement of where
   its central number came from and NO statement that no AVM produced it —
   the honesty claim disappearing at precisely the moment it was load-bearing.
   A document silent about its own provenance is worse than one that admits it
   has none. Both sections are now unconditional, and the thin case says the
   thin thing. */
await p.evaluate(()=>localStorage.clear());
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(400);
await p.evaluate(()=>{
  localStorage.setItem('ni-account-v1', JSON.stringify({ name:'Elijah Payne', email:'e@x.com', plan:'solo' }));
});
await p.goto(B+'/desk.html'); await p.waitForTimeout(600);
await p.evaluate(()=>{ S.addr='118 Sylvan Rd SW';
  Object.assign(S.raw,{asking:'214000',arv:'300000',repairs:'40500',rent:'1850'});
  S.est.arv=false; S.comps=[]; S.sys={}; S.repairsOwn=true; save(); __showResults(); });
await p.waitForTimeout(600);
const thin = await p.evaluate(()=>{ const d=document.getElementById('printdoc');
  return { txt:d.innerText, tier:tierOf(), ent:entitled(1),
    comps:/WHERE THE ARV CAME FROM/.test(d.innerText),
    cond:/WHAT THE REPAIR FIGURE IS MADE OF/.test(d.innerText),
    noAvm:/No automated valuation model was used/.test(d.innerText),
    range:/The supported range/.test(d.innerText),
    owns:/entered by the preparer|entered whole by the preparer/.test(d.innerText),
    admits:/No sales-comparison approach was run/.test(d.innerText),
    notStated:/not stated/.test(d.innerText),
    sample:/Sample packet/i.test(d.innerText),
    fakeRange:/supported range: \$/.test(d.innerText) }; });
console.log('thin:', {...thin, txt:undefined, len:thin.txt.length});
ck(thin.ent, 'the planted Solo account is not entitled — the fixture is wrong, not the product');
ck(thin.comps, 'a packet with no comps drops the ARV provenance section entirely');
ck(thin.noAvm, 'a packet with no comps stops saying no AVM was used');
ck(thin.admits, 'a packet with no comps does not admit no comparison approach was run');
ck(thin.owns, 'a packet with no comps does not say who supplied the ARV');
ck(thin.cond, 'a packet with an untouched condition panel drops the repair section entirely');
ck(thin.range && thin.notStated, 'a packet with no comps does not address the supported range');
ck(!thin.fakeRange, 'a packet with no comps invented a supported range');
ck(!thin.sample, 'a real sheet is wearing the sample stamp');
ck(!/undefined|NaN|\$NaN/.test(thin.txt), 'the thin packet prints undefined or NaN');

// ── free: the sheet still prints, the evidence does not, and it says why ────
await p.evaluate(()=>{ localStorage.clear(); });
await p.goto(B+'/desk.html#new'); await p.waitForTimeout(500);
await p.evaluate(()=>{ S.addr='118 Sylvan Rd SW';
  Object.assign(S.raw,{asking:'214000',arv:'300000',repairs:'40500',rent:'1850'});
  S.sys.roof=70; S.sys.kitchen=80; save(); __showResults(); });
await p.waitForTimeout(600);
const free = await p.evaluate(()=>{ const d=document.getElementById('printdoc');
  return { txt:d.innerText, comps:/WHERE THE ARV CAME FROM/.test(d.innerText),
    cond:/WHAT THE REPAIR FIGURE IS MADE OF/.test(d.innerText),
    offer:/Not included/.test(d.innerText), says:/lender packet/i.test(d.innerText),
    exits:/THE EXITS, RANKED/.test(d.innerText), price:/\$39/.test(d.innerText),
    name:/Prepared by/.test(d.innerText) }; });
console.log('free:', {...free, txt:undefined, len:free.txt.length});
ck(!free.comps && !free.cond, 'the free print is giving away the packet');
ck(free.exits, 'the free print lost the exits — the free sheet must stay whole');
ck(free.offer && free.says && free.price, 'the free print does not say what the packet is or what it costs');
ck(!/undefined|NaN/.test(free.txt), 'the free print prints undefined or NaN');
ck(!errs.length, 'page errors: '+errs.join(';').slice(0,150));
if (F.length){ console.log('FAIL:'); F.forEach(f=>console.log(' -',f)); await b.close(); srv.close(); process.exit(1); }
console.log('PASS — the free sheet is whole, the packet carries the evidence, and the line between them is stated');
await b.close(); srv.close();
