/* ── WHAT EACH TIER ACTUALLY SEES ──────────────────────────────────────────
   Elijah: "the plans page and teaser stuff shouldn't be there if you've
   already purchased. It shouldn't be showing up unless you don't have the
   features available to you."

   That is one rule and it is checkable, so it should be checked by a machine
   rather than by signing in five times and squinting. For every tier this
   product sells, this loads the pages a customer actually lives on and counts
   what is still trying to sell them something:

     · locked cards      .locked / [data-plans] — a feature shown switched off
     · plans links       any visible anchor pointing at the plans page
     · upsell chips      "Underwriter" / "The Office" worn as a price tag

   THE ASSERTION IS MONOTONIC, which is the only form of this rule that cannot
   be argued with: whatever The Office sees, Underwriter may see no less of,
   and so on down. A teaser that survives to the top tier is selling somebody
   something they already own, and the count at tier 3 should be zero.

   It plants the account record directly rather than signing in, because there
   is no server here and the record is what every gate on the page reads. The
   preview switcher is deliberately NOT used: it paints a tier without buying
   one, and half the point of this harness is to find the places where those
   two answers differ. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

let n = 0, bad = 0;
const ok = (t, p, x) => { n++; if (!p){ bad++; console.log('✗ ' + t + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0,300) : '')); } else console.log('✓ ' + t); };

const site = http.createServer((q, r) => {
  const p = (q.url.split('?')[0] || '/').replace(/^\/+/, '') || 'index.html';
  const f = path.join('dist', p);
  try {
    const b = fs.readFileSync(f);
    r.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
    r.end(b);
  } catch(e){ r.writeHead(404); r.end('no'); }
});
const port = await new Promise(r => site.listen(0, '127.0.0.1', () => r(site.address().port)));
const base = `http://127.0.0.1:${port}/`;

const TIERS = [
  { key:'signedout',   plan:null,          label:'signed out' },
  { key:'free',        plan:'',            label:'free account' },
  { key:'solo',        plan:'solo',        label:'Solo' },
  { key:'underwriter', plan:'underwriter', label:'Underwriter' },
  { key:'office',      plan:'the office',  label:'The Office' },
];
const PAGES = ['desk.html', 'office.html'];

const SCAN = () => {
  const vis = el => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    if (el.hidden || el.closest('[hidden]')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  const name = el => {
    const id = el.id ? '#' + el.id : '';
    const cls = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\s+/).slice(0,2).join('.') : '';
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 54);
    return (el.tagName.toLowerCase() + id + cls + ' :: ' + txt);
  };
  const outer = list => list.filter(el => !list.some(o => o !== el && o.contains(el)));

  const locked = outer(Array.from(document.querySelectorAll('.locked,[data-plans],[data-lock]')).filter(vis));
  const links  = Array.from(document.querySelectorAll('a[href]')).filter(a =>
    /plans\.html|\/plans(\?|#|$)/.test(a.getAttribute('href') || '') && vis(a));
  /* a tier NAME shown as a price tag. The word appears legitimately in prose,
     so this only counts it when it is wearing one of the chip classes the
     product uses to mean "this costs money" */
  const chips = Array.from(document.querySelectorAll('.k,.tag,.tier,.wk,.eyebrow')).filter(el =>
    vis(el) && /^(underwriter|the office|solo)$/i.test((el.textContent || '').trim()));

  return { locked: locked.map(name), links: links.map(name), chips: chips.map(name) };
};

const results = {};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const t of TIERS){
  results[t.key] = {};
  for (const page of PAGES){
    const ctx = await b.newContext({ viewport:{ width:1280, height:1000 } });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e).slice(0,140)));
    await pg.addInitScript(acc => {
      try {
        localStorage.removeItem('ni-preview-plan');
        if (acc) localStorage.setItem('ni-account-v1', JSON.stringify(acc));
        else localStorage.removeItem('ni-account-v1');
      } catch(e){}
    }, t.plan === null ? null
       : { name:'Harness', email:'h@example.com', market:'30310', level:'pro',
           since:'2026-08-01', trial:null, plan: t.plan });
    await pg.goto(base + page, { waitUntil:'load' });
    await pg.waitForTimeout(700);
    /* the desk only offers most of this once there is an address — a locked
       card under an empty field is deliberately not drawn, and auditing the
       empty state would report every tier as clean */
    if (page === 'desk.html'){
      await pg.fill('#addr', '512 Joseph E Lowery Blvd SW, Atlanta GA 30310').catch(() => {});
      await pg.dispatchEvent('#addr', 'change').catch(() => {});
      await pg.waitForTimeout(900);
    }
    const r = await pg.evaluate(SCAN);
    results[t.key][page] = r;
    ok(`${t.label} · ${page} throws nothing`, !errs.length, errs[0]);
    await ctx.close();
  }
}
await b.close(); site.close();

/* ── the report ──────────────────────────────────────────────────────────*/
const count = k => PAGES.reduce((s, p) =>
  s + results[k][p].locked.length + results[k][p].links.length + results[k][p].chips.length, 0);

console.log('\n══ WHAT EACH TIER IS STILL BEING SOLD ' + '═'.repeat(34));
console.log('   tier            locked   plans-links   tier-chips   total');
console.log('   ' + '─'.repeat(58));
for (const t of TIERS){
  const L = PAGES.reduce((s,p)=>s+results[t.key][p].locked.length,0);
  const K = PAGES.reduce((s,p)=>s+results[t.key][p].links.length,0);
  const C = PAGES.reduce((s,p)=>s+results[t.key][p].chips.length,0);
  console.log('   ' + t.label.padEnd(16) + String(L).padStart(5)
    + String(K).padStart(13) + String(C).padStart(13) + String(L+K+C).padStart(8));
}

console.log('\n══ THE OFFENDERS, TIER BY TIER ' + '═'.repeat(41));
for (const t of TIERS){
  for (const p of PAGES){
    const r = results[t.key][p];
    const all = [...r.locked.map(x=>['locked',x]), ...r.links.map(x=>['plans link',x]),
                 ...r.chips.map(x=>['tier chip',x])];
    if (!all.length) continue;
    console.log(`\n── ${t.label} · ${p}`);
    for (const [k, v] of all) console.log(`   ${k.padEnd(11)} ${v}`);
  }
}

/* ── the assertions ──────────────────────────────────────────────────────*/
console.log('');
/* MONOTONIC FROM free UPWARD, NOT FROM signed-out. The first version chained
   signed-out into the ladder and it failed — correctly, on the arithmetic, and
   wrongly on the meaning. A signed-out visitor on office.html sees the signup
   gate, not a dashboard: there is less PAGE, so there is less selling, and a
   free account "seeing more offers than a stranger" is just a customer seeing
   the features their dashboard could hold. The rule this harness exists for is
   narrower and absolute: nobody is sold a thing they already own. That starts
   being comparable at `free`, where everybody is looking at the same rooms. */
const order = ['free','solo','underwriter','office'];
for (let i = 1; i < order.length; i++){
  const lo = count(order[i-1]), hi = count(order[i]);
  ok(`${order[i]} is sold no more than ${order[i-1]} (${hi} ≤ ${lo})`, hi <= lo,
     { [order[i-1]]: lo, [order[i]]: hi });
}
ok('The Office is sold nothing at all — it already owns everything', count('office') === 0,
   results.office);

console.log(bad ? `\n${bad} of ${n} FAILED`
  : `\nall ${n} hold — nothing is advertised to somebody who already bought it`);
process.exit(bad ? 1 : 0);
