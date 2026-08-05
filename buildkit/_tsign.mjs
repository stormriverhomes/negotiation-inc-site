/* _tsign — a loss is never painted in the colour of a gain.

   Elijah found this one by eye: the demo built to be the deal you WALK AWAY
   FROM showed its spread as −$102,000 in mint green, in the rail, on every
   screen. Colour is read before a minus sign is — the eye takes "green, big
   number, good" and moves on. It was one CSS rule with no sign in it, in two
   files, on four render sites.

   Finding it by eye is luck. This finds it by law:

     THE LAW · Any element whose own text is a NEGATIVE money value must not
     be painted in an affirmative colour. And the converse, because a product
     that paints gains red is just as wrong: a positive value in a warning
     colour is reported too.

   Run against a portfolio deliberately built so that every screen has at
   least one property under water, because the fault only appears when a
   number is negative and most fixtures are not. */
import { chromium } from 'playwright';
import fs from 'fs';
import http from 'node:http';

/* the affirmative and the alarmed, as this product uses them — both palettes,
   because the navy rail and the white sheet do not share a green */
const GOOD = ['#177a4d', '#8fe0b4', '#3fa06a', '#2c6142', '#5f8a72', '#577f69'];
const BAD  = ['#b3372c', '#f2a49f', '#f0b4ac', '#d96a5a', '#b03a2e'];
const hex2rgb = h => h.replace('#','').match(/../g).map(x => parseInt(x,16));
const near = (rgb, list, tol = 26) => list.some(h => {
  const t = hex2rgb(h);
  return Math.abs(rgb[0]-t[0]) + Math.abs(rgb[1]-t[1]) + Math.abs(rgb[2]-t[2]) <= tol * 3;
});

const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname === '/' ? '/index.html' : u.pathname;
  const f = '/home/claude/dist' + p;
  if (fs.existsSync(f) && fs.statSync(f).isFile()){
    res.writeHead(200, {'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html'});
    return res.end(fs.readFileSync(f)); }
  res.writeHead(404); res.end('no');
});
const port = await new Promise(r => site.listen(0, '127.0.0.1', () => r(site.address().port)));
const BASE = `http://127.0.0.1:${port}`;

/* one property well under water, one comfortably above it, so both directions
   of the law are exercised on the same screen */
const PROPS = [
  { id:'p-under', name:'The one to leave', addr:'44 Underwater Way, Atlanta GA 30310',
    updated: 1, raw:{ asking:'249,500', arv:'190,000', repairs:'42,500', rent:'1,450' },
    est:{}, prov:{}, unc:{}, noAsk:false, sample:null, offerExit:null,
    comps:[], subj:{sqft:'',beds:'',baths:''}, compAdj:{}, sit:'unknown', sitPc:0, sys:{} },
  { id:'p-over',  name:'The one that works', addr:'12 Clear Street, Atlanta GA 30310',
    updated: 2, raw:{ asking:'120,000', arv:'260,000', repairs:'38,000', rent:'1,850' },
    est:{}, prov:{}, unc:{}, noAsk:false, sample:null, offerExit:null,
    comps:[], subj:{sqft:'',beds:'',baths:''}, compAdj:{}, sit:'unknown', sitPc:0, sys:{} },
];

const SCAN = () => {
  const out = [];
  /* both spellings, because the product had both until today: "−$102,000"
     and "$-102,000". A harness that only knows the correct one cannot see the
     screen that is wrong. */
  const MONEY = /^\s*[−-]?\s*\$\s*[−-]?[\d,]+(\.\d+)?\s*(\/mo|\/sec)?\s*$/;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()){
    const t = (n.nodeValue || '').trim();
    if (!t || !MONEY.test(t)) continue;
    const el = n.parentElement;
    if (!el) continue;
    const c = getComputedStyle(el);
    if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < .3) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const m = c.color.match(/[\d.]+/g);
    if (!m) continue;
    /* a zero has no sign and no opinion; skip it */
    const digits = t.replace(/[^\d]/g, '');
    if (!digits || Number(digits) === 0) continue;
    out.push({ text: t, negative: /^[\s]*[−-]/.test(t),
      rgb: [ +m[0], +m[1], +m[2] ],
      el: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className
        ? '.' + el.className.trim().split(/\s+/).slice(0,2).join('.') : ''),
      where: (el.closest('[class]') || el).className || '' });
  }
  const seen = new Set();
  return out.filter(o => { const k = o.el + o.text + o.rgb.join();
    if (seen.has(k)) return false; seen.add(k); return true; });
};

const bad = [], out = {};
const b = await chromium.launch();

async function look(page, label){
  const found = await page.evaluate(SCAN);
  out[label] = { values: found.length, negatives: found.filter(f => f.negative).length };
  for (const f of found){
    if (f.negative && near(f.rgb, GOOD))
      bad.push(`${label}: "${f.text}" — a LOSS painted in the affirmative colour `
             + `rgb(${f.rgb.join(',')}) on ${f.el}`);
    if (!f.negative && near(f.rgb, BAD))
      bad.push(`${label}: "${f.text}" — a GAIN painted in the alarm colour `
             + `rgb(${f.rgb.join(',')}) on ${f.el}`);
  }
  return found;
}

/* ── the desk, with a portfolio that includes a loser ─────────────────────── */
{
  const p = await b.newPage({ viewport:{ width:1280, height:1100 } });
  await p.goto(BASE + '/desk.html');
  await p.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('ni-account-v1', JSON.stringify({ name:'E', email:'e@x.com', plan:'the office', trial:null }));
  });
  await p.goto(BASE + '/desk.html');
  await p.waitForFunction(() => typeof render === 'function' && typeof P !== 'undefined', null, { timeout:20000 });
  /* built through the app's own API rather than by writing localStorage: every
     field is sanitised on the way in, and a hand-written blob that does not
     match the schema is correctly thrown away — which would make this harness
     pass by testing an empty desk */
  await p.evaluate(props => {
    for (let i = 0; i < props.length; i++){
      if (i > 0 && typeof newSheet === 'function') newSheet();
      S.addr = props[i].addr; S.name = props[i].name;
      Object.assign(S.raw, props[i].raw);
      save();
    }
    render(); if (typeof window.__showResults === 'function') window.__showResults();
  }, PROPS);
  await p.waitForTimeout(1200);
  const n1 = await look(p, 'desk · results, rail open');
  if (!n1.some(f => f.negative))
    bad.push('desk: the fixture produced no negative money at all — this run proved nothing');

  /* and the rail specifically, which is where he found it */
  const rail = await p.evaluate(() => {
    const b = document.querySelector('.rn-p .s b');
    if (!b) return null;
    return { text:b.textContent.trim(), color:getComputedStyle(b).color };
  });
  out.rail = rail;
  if (!rail) bad.push('desk: the rail shows no spread at all, so the case he reported is untested');
  await p.close();
}

/* ── the hub, and the door's "already in this browser" panel ──────────────── */
for (const [file, label] of [['office.html', 'office · hub'], ['office.html', 'office · door']]){
  const p = await b.newPage({ viewport:{ width:1280, height:1100 } });
  const door = label.endsWith('door');
  await p.goto(BASE + '/' + file);
  /* the hub and the door read the SAME storage the desk just wrote, so build it
     on the desk and walk over — which is also how a person gets there */
  await p.goto(BASE + '/desk.html');
  await p.evaluate(door => {
    localStorage.clear();
    if (!door) localStorage.setItem('ni-account-v1',
      JSON.stringify({ name:'E', email:'e@x.com', plan:'the office', trial:null }));
  }, door);
  await p.goto(BASE + '/desk.html');
  await p.waitForFunction(() => typeof render === 'function', null, { timeout:20000 });
  await p.evaluate(props => {
    for (let i = 0; i < props.length; i++){
      if (i > 0 && typeof newSheet === 'function') newSheet();
      S.addr = props[i].addr; S.name = props[i].name;
      Object.assign(S.raw, props[i].raw); save();
    }
  }, PROPS);
  /* leave the LOSING sheet active, because the door's "already in this browser"
     panel shows the active one and that panel had the same bug */
  await p.evaluate(() => { if (typeof loadInto === 'function'){ P.active = 0; loadInto(0); save(); } });
  await p.goto(BASE + '/' + file);
  await p.waitForTimeout(1400);
  await look(p, label);
  await p.close();
}

/* ── the landing page's readout, which shows a refused deal ───────────────── */
{
  const p = await b.newPage({ viewport:{ width:1280, height:1100 } });
  await p.goto(BASE + '/index.html');
  await p.waitForTimeout(1200);
  await look(p, 'landing');
  await p.close();
}

await b.close(); site.close();
console.log(JSON.stringify(out, null, 1));
if (bad.length){ console.log('FAIL'); bad.forEach(x => console.log(' - ' + x)); process.exit(1); }
console.log('PASS — on every screen carrying a portfolio with a property under water, no negative '
  + 'money is painted in an affirmative colour and no positive money is painted in an alarm one');
process.exit(0);
