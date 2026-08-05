// ── the demo floor, held to its promise ─────────────────────────────────────
// The pitch on the page is "nothing here is a mock-up" and "five different
// right answers". Both are testable, and both would be embarrassing to get
// wrong on the first screen a stranger sees.
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.png':'image/png','.woff2':'font/woff2'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r);}).listen(8093);
const B='http://localhost:8093';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const F=[], ck=(c,m)=>{ if(!c) F.push(m); };
const R={};
const p = await b.newPage({ viewport:{width:1200,height:1000} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });

// ── A · the floor: five deals, five drawn houses, all links live ───────────
await p.goto(B+'/demo.html'); await p.waitForTimeout(900);
R.A = await p.evaluate(()=>({
  cards:document.querySelectorAll('.deal').length,
  links:[...document.querySelectorAll('.deal')].map(a=>a.getAttribute('href')),
  drawn:[...document.querySelectorAll('.deal canvas')].filter(c=>{
    const g=c.getContext('2d'); const d=g.getImageData(0,0,c.width,c.height).data;
    const seen=new Set(); for(let i=0;i<d.length;i+=4) seen.add(d[i]+','+d[i+1]+','+d[i+2]);
    return seen.size > 6; }).length }));
ck(R.A.cards===5, 'A: the floor does not carry five deals');
ck(R.A.drawn===5, `A: only ${R.A.drawn} of the houses actually drew something`);
ck(R.A.links.every(h=>/^desk\.html#demo=[a-z]+$/.test(h)), 'A: a card does not open a demo: '+R.A.links.join(' '));

// ── B · the landing sends people here, not into an empty sheet ─────────────
await p.goto(B+'/'); await p.waitForTimeout(800);
R.B = await p.evaluate(()=>({
  hero:document.querySelector('.hero .cta a')?.getAttribute('href'),
  heroTxt:document.querySelector('.hero .cta a')?.textContent.trim(),
  demoLinks:document.querySelectorAll('a[href="demo.html"]').length }));
ck(R.B.hero==='demo.html', 'B: the hero no longer leads to the demo: '+R.B.hero);
ck(/see how it works/i.test(R.B.heroTxt||''), 'B: the hero CTA still offers the tool rather than showing it: '+R.B.heroTxt);
ck(R.B.demoLinks>=2, 'B: the landing only points at the demo once');

// ── C · each deal opens the real software on a DIFFERENT answer ────────────
const WANT = { flip:'flip', hold:'hold', subto:'subto', novation:'novation', walk:'(walk)' };
R.C = {};
for (const k of Object.keys(WANT)){
  await p.goto(B+'/desk.html'); await p.evaluate(()=>localStorage.clear());
  await p.goto(B+'/desk.html#demo='+k); await p.reload(); await p.waitForTimeout(1100);
  R.C[k] = await p.evaluate(()=>{
    const EX = rankExits().filter(x=>!x.na && x.fit!==null).sort((a,b)=>b.fit-a.fit);
    const top = EX[0];
    return { top: (!top || top.fit < 25) ? '(walk)' : top.id, fit: top?top.fit:0,
      comps:S.comps.length, arv:S.raw.arv, arvEntered: !S.est.arv && !!S.raw.arv,
      /* The demo used to ship a panel ESTIMATE, which meant every walk-through
         opened at "confidence medium · 1 estimate" — the weakest version of the
         answer, shown to the one person we most need to impress. It now ships
         the contractor's bid on top of a dragged panel, which is what a deal
         anybody is seriously buying actually looks like. */
      repairsFromBid: /bid/i.test(S.prov.repairs||'') && !S.est.repairs,
      condDragged: LINES.filter(l=>(S.sys[l.id]||0)>0).length,
      noEstimates: [...FIELDS,...LOANFIELDS].every(f=>!S.est[f.id]),
      priced:[...document.querySelectorAll('.exit')].filter(x=>x.innerText.length>40).length,
      strip: document.querySelector('.fromc .k')?.textContent||'' };
  });
  ck(R.C[k].top === WANT[k], `C: ${k} ranks ${R.C[k].top} first, not ${WANT[k]}`);
  ck(R.C[k].comps >= 3, `C: ${k} arrived with only ${R.C[k].comps} comps`);
  ck(R.C[k].arvEntered, `C: ${k} did not take its ARV from its own comps as an entered fact`);
  ck(R.C[k].repairsFromBid, `C: ${k} did not arrive with a contractor's bid on the repairs`);
  ck(R.C[k].condDragged >= 3, `C: ${k} arrived with the condition panel untouched`);
  ck(R.C[k].noEstimates, `C: ${k} still shows an estimate — a demo has to price at high confidence`);
  ck(R.C[k].priced >= 4, `C: ${k} only priced ${R.C[k].priced} exits`);
  ck(/Demo/i.test(R.C[k].strip), `C: ${k} does not announce itself as a demo: "${R.C[k].strip}"`);
}
// the whole point: they are not all the same answer
{ const answers = new Set(Object.values(R.C).map(x=>x.top));
  ck(answers.size >= 4, 'C: the five demos only produce '+answers.size+' distinct answers — the argument collapses'); }

// ── D · it is the real software, so it still re-prices ─────────────────────
R.D = await p.evaluate(()=>{
  const before = rankExits().find(x=>x.id==='flip')?.ceil ?? 0;
  S.raw.repairs = '5,000'; window.__render();
  const after = rankExits().find(x=>x.id==='flip')?.ceil ?? 0;
  return { before:Math.round(before), after:Math.round(after) }; });
ck(R.D.after > R.D.before + 1000, 'D: changing a figure on a demo did not re-price it — it is a mock after all');

ck(!errs.length, 'errors: '+errs.join('; ').slice(0,220));
console.log(JSON.stringify(R,null,1));
console.log(F.length ? 'FAIL:\n- '+F.join('\n- ') : 'PASS — five drawn deals, five different answers, all of it the real software');
await b.close(); srv.close(); process.exit(F.length?1:0);
