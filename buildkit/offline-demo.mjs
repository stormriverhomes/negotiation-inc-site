// The demo the user opens from disk, with the network physically cut.
// Anything that needs a server, a CDN or a font host fails here, loudly.
import { chromium } from 'playwright';
import { fillSheet, underwrite } from './harness-util.mjs';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport:{width:1280,height:900} });
const external = [];
await ctx.route('**/*', route => {
  const u = route.request().url();
  if (/^file:/.test(u)) return route.continue();
  external.push(u); return route.abort();          // no network, at all
});
const F=[], ck=(c,m)=>{ if(!c) F.push(m); };
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
const D = 'file://' + (process.env.DEMO_DIR || '/home/claude/demo');
const out = {};

for (const [name, file, must] of [
  ['landing','index.html', /underwrit|offer|exit/i],
  ['arcade','arcade.html', /Comp Run/],
  ['desk','desk.html', /FORM D-1|asking/i],
  ['plans','plans.html', /Underwriter/],
  ['office','office.html', /workspace|your desk/i],
  ['drill','exit-drill.html', /Exit Drill/],
  ['course','exits.html', /lesson|exit/i],
  ['game','comp-run.html', /./],
]) {
  await p.goto(`${D}/${file}`); await p.waitForTimeout(900);
  const t = await p.evaluate(()=>document.body.innerText);
  out[name] = { chars:t.length, ok:must.test(t) };
  ck(t.length > 200, `${name}: rendered almost nothing offline (${t.length} chars)`);
  ck(must.test(t), `${name}: its defining content is missing offline`);
}
// the desk still prices with no network — priors are the only optional part
await p.goto(`${D}/desk.html`);
await p.evaluate(()=>localStorage.clear()); await p.reload(); await p.waitForTimeout(500);
// fields live on their steps now, so the demo is filled the way a person fills it
await fillSheet(p, { asking:'214000', arv:'291000', repairs:'41300' });
await underwrite(p);
out.priced = await p.evaluate(()=>[...document.querySelectorAll('.exit')].filter(x=>x.innerText.length>40).length);
ck(out.priced >= 4, `the desk priced only ${out.priced} exits with no network`);
// the self-hosted font must actually be the one that painted
// Declaring the family proves nothing, and neither does document.fonts —
// Chrome marks a CORS-refused face "loaded" and then quietly paints Georgia.
// Measuring the glyphs is the only witness that cannot be lied to: if Fraunces
// and Georgia set the same string to the same width, Fraunces never arrived.
out.font = await p.evaluate(async ()=>{ try { await document.fonts.ready; } catch(e){}
  const w = fam => { const s=document.createElement('span');
    s.textContent='Handgloves affix quickly 0123456789';
    s.style.cssText=`position:absolute;visibility:hidden;white-space:nowrap;font:400 48px ${fam}`;
    document.body.appendChild(s); const x=s.getBoundingClientRect().width; s.remove(); return x; };
  return { stack:getComputedStyle(document.querySelector('h1,h2,.nm')||document.body).fontFamily,
    fraunces:w("'Fraunces',Georgia,serif"), georgia:w('Georgia,serif'),
    faces:[...document.fonts].map(f=>f.family+':'+f.status) }; });
ck(/Fraunces/.test(out.font.stack), 'the shipped font is not in the stack: '+out.font.stack);
ck(Math.abs(out.font.fraunces - out.font.georgia) > 1,
   `Fraunces is declared but Georgia is what painted (${out.font.fraunces}px vs ${out.font.georgia}px) — the demo lost its typeface`);
out.external = [...new Set(external)];
ck(out.external.length===0, 'the demo reached for the network: '+out.external.slice(0,4).join(', '));
ck(!errs.length, 'errors offline: '+errs.join('; ').slice(0,300));

console.log(JSON.stringify(out,null,1));
console.log(F.length ? 'FAIL:\n- '+F.join('\n- ') : 'PASS — the whole demo runs from disk with the network cut');
await b.close(); process.exit(F.length?1:0);
