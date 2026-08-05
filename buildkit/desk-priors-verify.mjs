import { chromium } from 'playwright';
import { step, underwrite } from './harness-util.mjs';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const R = {};

// ── A. no priors at all: nothing changes, nothing is requested, nothing logs ──
{
  const p = await b.newPage({ viewport:{width:1000,height:1100} });
  const errs=[], reqs=[];
  p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
  p.on('request',r=>{ if(/priors\.js/.test(r.url())) reqs.push(r.url()); });
  await p.goto('file:///home/claude/desk.html');
  await p.evaluate(()=>localStorage.clear()); await p.reload(); await p.waitForTimeout(300);
  await p.fill('#addr','44 Test St, Anytown 30310'); await p.waitForTimeout(600);
  R.A = { zipChips: await p.evaluate(()=>[...document.querySelectorAll('[data-est]')].filter(x=>/ZIP/.test(x.innerText)).length),
          priorsRequests: reqs.length, errs };
  await p.close();
}

// ── B. synthetic fixture preloaded: consent, provenance, 18%, max-rule ───────
{
  const p = await b.newPage({ viewport:{width:1000,height:1100} });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(()=>{ window.NI_PRIORS = { meta:{source:'TEST FIXTURE',vintage:'0000',built:'never',scale:100,note:'synthetic'},
    z:{ '30310':[2874, 1385] } }; try{ localStorage.clear(); }catch(e){} });
  await p.goto('file:///home/claude/desk.html'); await p.waitForTimeout(300);
  await p.fill('#addr','512 Joseph E Lowery Blvd SW, Atlanta GA 30310'); await p.waitForTimeout(600);
  const chip = await p.evaluate(()=>document.querySelector('#fb-arv [data-est]')?.innerText.replace(/\n/g,' '));
  await p.click('#fb-arv [data-est]'); await p.waitForTimeout(220);
  await step(p,'condition');
  await p.fill('[data-f="repairs"]','20000'); await p.press('[data-f="repairs"]','Tab');
  await underwrite(p);
  const wrote = await p.evaluate(()=>({ v:document.getElementById('fi-arv').value,
    st:document.querySelector('#fb-arv .stchip').textContent,
    prov:document.querySelector('#fb-arv .prov')?.innerText||'' }));
  // open it only if it is closed — clicking an open exit closes it again
  const band = async () => p.evaluate(()=>{
    if (!document.querySelector('#x-wholesale .bandnote')) document.querySelector('[data-row="wholesale"]')?.click();
    return document.querySelector('#x-wholesale .bandnote')?.innerText||'(none)'; });
  const b1 = await band();
  // the estimate toggle is gone; typing over a figure is what un-estimates it,
  // so the max-rule is checked by adding a second, less certain estimate instead
  await p.evaluate(()=>{ S.est.repairs=true; S.unc.repairs=0.12; save(); });
  await underwrite(p);
  const b2 = await band();
  R.B = { chip, wrote, bandAfterZip:b1, bandAfterManual12:b2, errs };
  await p.close();
}

// ── C. the REAL file, lazily: no request until a ZIP exists, then real data ──
{
  const p = await b.newPage({ viewport:{width:1000,height:1100} });
  const errs=[], reqs=[]; p.on('pageerror',e=>errs.push(e.message));
  p.on('request',r=>{ if(/priors\.js/.test(r.url())) reqs.push(1); });
  await p.addInitScript(()=>{ window.NI_PRIORS_URL='priors.js'; try{ localStorage.clear(); }catch(e){} });
  await p.goto('file:///home/claude/desk.html'); await p.waitForTimeout(500);
  const before = reqs.length;
  await p.fill('#addr','no zip here yet, just a street'); await p.waitForTimeout(600);
  const afterNoZip = reqs.length;
  await p.fill('#addr','512 Joseph E Lowery Blvd SW, Atlanta GA 30310'); await p.waitForTimeout(1500);
  const chips = await p.evaluate(()=>[...document.querySelectorAll('[data-est]')].map(x=>x.innerText.replace(/\n/g,' ')).filter(t=>/ZIP/.test(t)));
  R.C = { reqOnLoad:before, reqAfterNoZip:afterNoZip, reqAfterZip:reqs.length, chips, errs };
  await p.close();
}

// ── D. a top-coded ZIP must read as a floor, not a median ───────────────────
{
  const p = await b.newPage({ viewport:{width:1000,height:1100} });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(()=>{ window.NI_PRIORS_URL='priors.js'; try{ localStorage.clear(); }catch(e){} });
  await p.goto('file:///home/claude/desk.html'); await p.waitForTimeout(300);
  await p.fill('#addr','1 Summit Dr, Beverly Hills CA 90210'); await p.waitForTimeout(1600);
  const chip = await p.evaluate(()=>document.querySelector('#fb-arv [data-est]')?.innerText.replace(/\n/g,' '));
  await p.click('#fb-arv [data-est]'); await p.waitForTimeout(220);
  await step(p,'condition');
  await p.fill('[data-f="repairs"]','50000'); await p.press('[data-f="repairs"]','Tab');
  await underwrite(p);
  const out = await p.evaluate(()=>({ v:document.getElementById('fi-arv').value,
    prov:document.querySelector('#fb-arv .prov')?.innerText||'',
    band:(document.querySelector('[data-row="wholesale"]')?.click(),
          document.querySelector('#x-wholesale .bandnote')?.innerText||'(none)') }));
  R.D = { chip, ...out, errs };
  await p.close();
}

// ── assertions ──────────────────────────────────────────────────────────────
const F = [];
const ck = (c,m) => { if(!c) F.push(m); };
ck(R.A.zipChips===0 && R.A.priorsRequests===0 && !R.A.errs.length, 'A: quiet when absent');
ck(/≈ \$287,400/.test(R.B.chip), 'B: chip previews the scaled figure');
ck(R.B.wrote.v==='287,400' && R.B.wrote.st==='ESTIMATE' && /TEST FIXTURE/.test(R.B.wrote.prov), 'B: accept writes value+state+provenance');
ck(/\+18%/.test(R.B.bandAfterZip), 'B: band widens 18% for a ZIP prior');
ck(/\+18%/.test(R.B.bandAfterManual12), 'B: a 12% manual estimate does not shrink the 18% max');
ck(R.C.reqOnLoad===0 && R.C.reqAfterNoZip===0, 'C: nothing fetched before a ZIP exists');
ck(R.C.reqAfterZip===1, 'C: fetched exactly once, when a ZIP appears');
ck(R.C.chips.some(t=>/\$295,800/.test(t)) && R.C.chips.some(t=>/\$1,099/.test(t)), 'C: real Census figures reach the chips');
ck(/≥ \$2,000,000/.test(R.D.chip) && /ceiling/.test(R.D.chip), 'D: top-coded chip reads as a floor');
ck(/stops counting/i.test(R.D.prov), 'D: provenance names the ceiling');
ck(/\+25%/.test(R.D.band), 'D: top-coded prior widens 25%');
ck(![R.A,R.B,R.C,R.D].some(x=>x.errs.length), 'no console/page errors anywhere');

console.log(JSON.stringify(R,null,1));
console.log(F.length ? 'FAIL:\n- '+F.join('\n- ') : 'PASS — all priors assertions hold');
await b.close();
process.exit(F.length?1:0);
