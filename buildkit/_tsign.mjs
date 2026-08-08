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
  /*__API_STUB__*/ /* a static directory is a deployment with no accounts configured, and saying
     so is the honest answer to /api/config — a 404 is a console error the page
     cannot suppress and the harness cannot tell from a real one */
  if (/^\/api\//.test(req.url)){ res.writeHead(200, {'content-type':'application/json'});
    return res.end(JSON.stringify({ ok:true, accounts:false })); }

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
/* ── THE FIXTURE HAS TO PRODUCE A LOSS, OR THIS HARNESS PROVES NOTHING ─────
   The negative figure this used to catch came from the rail's SPREAD, which
   the rail no longer prints — it prints the ceiling now, and a ceiling is
   never negative. Losing the loss did not make the guard pass, which is
   exactly right: it reported that the run was empty.

   The loss it watches now is the one the desk still legitimately prints —
   an exit whose key figure is below zero. `p-under` is priced so the flip's
   profit at the top of its own band is negative: they want $249,500 for a
   house worth $190,000 finished with $42,500 of work in it. That is a real
   sheet somebody could type, and the number it produces must never be
   green. */
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
    /* ── A POSITIVE NUMBER IS NOT ALWAYS A GAIN ──────────────────────────
       This guard assumes sign tells you the mood: unsigned money is good
       news and must not be red. Most of the desk works that way. It does not
       work for a quantity of BADNESS measured positively — "over the ceiling
       by $144,400", "$28,850 under their price", "$9,100 too dear". Those are
       correctly red and correctly unsigned, and flagging them would push
       somebody to paint an overage green to satisfy a test.

       So the sentence around the figure gets a vote. Only the sentence — the
       figure's own sign still rules everywhere else, and a real gain in red
       still fails. */
    const near = ((el.closest('div,li,p,td,span') || el).textContent || '').toLowerCase();
    const gap = /\b(over|above|under|short|shortfall|too dear|costs?|owe[sd]?)\b/.test(near);
    /* kept in the scan, not dropped from it: a gap figure still proves the
       loss path rendered, it is just exempt from "a gain must not be red" */
    out.push({ text: t, gap, negative: /^[\s]*[−-]/.test(t),
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
    if (!f.negative && !f.gap && near(f.rgb, BAD))
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
  /* ── THE NON-VACUITY CHECK, HONESTLY RESTATED ────────────────────────────
     This used to demand that the run find a MINUS-SIGNED figure, on the
     theory that a desk with no losses on it proves nothing about how losses
     are painted. That theory has expired, and for a good reason: the desk
     now says badness in words with an unsigned number — "over the ceiling by
     $144,400", "$28,850 under their price", "$9,100 too dear" — because a
     minus sign is the easiest thing on a screen to miss and the word "over"
     is not. Chasing a minus sign would mean contorting the fixture to force
     a shape the product deliberately moved away from, or worse, adding minus
     signs back to satisfy a test.

     What still proves the run was real: it found money, and it found money
     painted in the alarm colour — so the loss path rendered and was
     inspected. The rule those figures are held to (no loss in green, no gain
     in red) is unchanged and runs above. */
  /* the losing sheet is opened deliberately rather than hoped for: the alarm
     colour lives in ITS payday box and ITS band, and whichever sheet the rail
     happens to have open first is not a thing to build a guard on */
  await p.evaluate(() => { try {
    const i = P.props.findIndex(x => /Underwater/.test(x.addr || ''));
    if (i >= 0) loadInto(i);
    S.userToggled = true; S.openId = 'flip';
    render(); if (typeof showResults === 'function') showResults();
  } catch(e){} });
  await p.waitForTimeout(900);
  const n2 = await look(p, 'desk · the losing sheet, open');
  const all = n1.concat(n2);
  const alarm = all.filter(f => near(f.rgb, BAD)).length;
  if (all.length < 6)
    bad.push(`desk: only ${all.length} money figures across both sheets — this run proved nothing`);
  else if (!alarm && !all.some(f => f.negative))
    bad.push('desk: nothing on either sheet was painted as a loss — this run proved nothing');

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
