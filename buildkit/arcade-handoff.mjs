// ── the arcade's door into the software ─────────────────────────────────────
// Plays a real street to settlement, follows the handoff, and checks the two
// things that make it honest: the ratios survive the crossing, and the digits
// are never presented as a property.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const F=[], ck=(c,m)=>{ if(!c) F.push(m); }; const out={};

const p = await b.newPage({ viewport:{width:1280,height:1000} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
await p.goto('file:///home/claude/portfolio.html'); await p.waitForTimeout(900);

// the scaling law, checked directly against six generated lots of every archetype
out.scaling = await p.evaluate(()=>{
  const s = makeStreet();
  return s.lots.map(l=>{
    const u = new URLSearchParams(deskLink(l, l.floor+1).split('#')[1]);
    return { id:l.a.id, value:l.value, ask:l.ask, repairs:l.repairs, paid:l.floor+1,
      asking:+u.get('asking'), arv:+u.get('arv'), rep:+u.get('repairs'),
      sit:u.get('sit'), from:u.get('from'), est:u.get('est') };
  });
});
for (const r of out.scaling){
  const k = r.arv / r.value;
  ck(r.arv === 300000, `${r.id}: ARV is not the modern anchor`);
  ck(Math.abs(r.asking - r.paid*k) <= 250, `${r.id}: asking ratio drifted (${r.asking} vs ${Math.round(r.paid*k)})`);
  ck(Math.abs(r.rep - r.repairs*k) <= 250, `${r.id}: repairs ratio drifted`);
  ck(r.est === 'arv,repairs', `${r.id}: the two revealed figures do not cross as estimates`);
  ck(r.from === 'arcade', `${r.id}: source not declared`);
  ck(['unknown','nohurry','motivated','urgent','estate','behind'].includes(r.sit), `${r.id}: unknown situation ${r.sit}`);
}
// no era leaks its own currency: same archetype on stone-age ground still anchors modern
out.eraProof = await p.evaluate(()=>{
  const before = S.era; const seen = [];
  for (const e of [0, 3, 7]) { S.era = e; const s = makeStreet();
    const u = new URLSearchParams(deskLink(s.lots[0], s.lots[0].floor+1).split('#')[1]);
    seen.push({ era:e, rawValue:Math.round(s.lots[0].value), arv:+u.get('arv'), asking:+u.get('asking') }); }
  S.era = before; return seen;
});
ck(out.eraProof.every(x=>x.arv===300000 && x.asking>0 && x.asking<3e6),
   'an era priced in its own money leaked into the sheet');

// play one lot through to settlement and follow the link that appears
out.played = await p.evaluate(async ()=>{
  street = makeStreet(); street.picked = 0; renderStreet();
  const l = street.lots[0];
  settle(Math.round(Math.max(l.floor, l.rival) + 1));      // win it
  const a = document.getElementById('s-desk-go');
  return { shown: getComputedStyle(document.getElementById('s-desk')).display,
           href: a.getAttribute('href'), target: a.getAttribute('target'),
           note: document.getElementById('s-desk-note').textContent };
});
ck(out.played.shown === 'block', 'the settlement offers no way to the software');
ck(/^desk\.html#/.test(out.played.href), 'the handoff does not point at the desk');
ck(out.played.target === '_blank', 'following it would abandon the run');
await p.close();

// the sheet on the other side
{
  const q = await b.newPage({ viewport:{width:1280,height:1200} });
  const e2=[]; q.on('pageerror',x=>e2.push(x.message)); q.on('console',m=>{if(m.type()==='error')e2.push(m.text())});
  await q.addInitScript(()=>{ try{ localStorage.clear(); }catch(e){} });
  await q.goto('file:///home/claude/'+out.played.href); await q.waitForTimeout(800);
  out.landed = await q.evaluate(()=>({
    strip: document.querySelector('.fromc')?.innerText.replace(/\n/g,' ')||'(none)',
    arv: document.getElementById('fi-arv').value,
    arvState: document.querySelector('#fb-arv .stchip').textContent,
    repState: document.querySelector('#fb-repairs .stchip').textContent,
    prov: document.querySelector('#fb-arv .prov')?.innerText||'',
    ranked: [...document.querySelectorAll('.exit')].length,
    priced: [...document.querySelectorAll('.exit')].filter(x=>x.innerText.length>40).length,
  }));
  out.landed.e2 = e2;
  await q.screenshot({ path:'shot-desk-fromarcade.png' });
  ck(/arcade/i.test(out.landed.strip) && /not a property/i.test(out.landed.strip),
     'the sheet does not say where these came from');
  ck(out.landed.arv === '300,000', 'the modern anchor did not land');
  ck(out.landed.arvState === 'ESTIMATE' && out.landed.repState === 'ESTIMATE',
     'figures the arcade knew for a fact arrived as facts');
  ck(/the world does not/i.test(out.landed.prov), 'the provenance does not explain the widening');
  ck(out.landed.ranked === 7 && out.landed.priced >= 3, 'the exits did not price it');
  ck(!out.landed.e2.length, 'errors on the landing sheet');
  await q.close();
}

console.log(JSON.stringify(out,null,1));
ck(!errs.length, 'console errors in the arcade: '+errs.join('; '));
console.log(F.length ? 'FAIL:\n- '+F.join('\n- ') : 'PASS — the arcade hands a shape, not a property');
await b.close(); process.exit(F.length?1:0);
