/* t-corners — the sharp-edge sweep.
   Elijah's note: "the dashboard and landing page has very sharp edges IN
   CONTRAST TO a lot of other stuff". He was right, and the reason it was hard
   to see in a diff is that a square corner is an ABSENCE — nothing in the CSS
   says "make this sharp", so nothing greps. It has to be measured in a browser.

   ── WHAT THE RULE ACTUALLY IS ────────────────────────────────────────────
   The first version of this harness asserted that every container everywhere
   is rounded, and it was wrong twice on its first real board. The arcade is
   square on purpose — it is a cabinet, drawn in pixels, and a soft corner
   would be the bug. The course reads as print, and print has no radii either.
   Both came up red for being consistently themselves.

   The two words that matter in Elijah's sentence are "in contrast to". A page
   where every object is square has a style. A page where ONE object is square
   among rounded ones has an oversight — somebody added a control and did not
   copy the corner. So the rule is per-page agreement, not a global constant:
   whichever way a page leans, everything on it leans the same way.

   Rule: anything that reads as a CONTAINER — it has a border or a fill and it
   holds other things — must agree with the rest of its page. Hairline rules,
   table cells and the page itself are exempt, because they are not objects. */
import { chromium } from 'playwright';

const PAGES = ['index.html','office.html','desk.html','plans.html','exits.html',
               'demo.html','arcade.html','exit-drill.html','terms.html','privacy.html','refunds.html'];

const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1440,height:1000} });
const out = {}; const bad = [];

for (const f of PAGES){
  await p.goto('file:///home/claude/dist/' + f);
  await p.waitForTimeout(500);
  /* the desk and the office only draw their real surface once there is an
     account and a sheet — a page measured in its empty state measures nothing */
  if (f === 'desk.html' || f === 'office.html'){
    await p.evaluate(() => {
      localStorage.setItem('ni-account-v1', JSON.stringify({name:'E', email:'e@x.com', plan:'underwriter', trial:null}));
      localStorage.setItem('ni-desk-v3', JSON.stringify({ active:0, props:[
        { name:'1104 Elm', addr:'1104 Elm Street', mode:'simple', comps:[{},{},{}],
          f:{ asking:{v:'168000'}, arv:{v:'249000',e:true}, repairs:{v:'46000',e:true} } }]}));
    });
    await p.reload(); await p.waitForTimeout(900);
  }

  const sq = await p.evaluate(() => {
    const hit = [];
    for (const el of document.querySelectorAll('body *')){
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 90 || r.height < 44) continue;            // not a container
      const tag = el.tagName;
      if (['TD','TH','TR','THEAD','TBODY','TABLE','BODY','HTML','MAIN','SECTION',
           'HEADER','FOOTER','NAV','SVG','PATH','CANVAS','IMG','P','H1','H2','H3',
           'LI','UL','OL','SPAN','LABEL','FIGCAPTION'].includes(tag)) continue;
      const bordered = ['Top','Right','Bottom','Left']
        .every(s => parseFloat(cs['border' + s + 'Width']) > 0);
      const filled = cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
                     && cs.backgroundColor !== 'transparent';
      const boxed = cs.boxShadow !== 'none';
      if (!(bordered || (filled && boxed))) continue;          // not an object
      hit.push({ sel: tag + (el.className && typeof el.className === 'string'
                   ? '.' + el.className.trim().split(/\s+/).slice(0,2).join('.') : ''),
                 w: Math.round(r.width), h: Math.round(r.height),
                 r: Math.round(parseFloat(cs.borderTopLeftRadius) || 0) });
    }
    /* one entry per selector — a deck of twelve square cards is one bug */
    const seen = new Map();
    for (const x of hit) if (!seen.has(x.sel)) seen.set(x.sel, x);
    return [...seen.values()];
  });

  /* which way does this page lean? The majority of its own containers decides,
     and the minority is the finding. A page with nothing to measure abstains
     rather than voting for square by default. */
  const round = sq.filter(x => x.r >= 6), square = sq.filter(x => x.r < 6);
  const lean  = !sq.length ? 'empty' : round.length >= square.length ? 'rounded' : 'square';
  const odd   = lean === 'rounded' ? square : lean === 'square' ? round : [];

  out[f] = { lean, of: sq.length, odd: odd.map(x => `${x.sel} r=${x.r}`) };
  if (odd.length) bad.push(`${f} reads ${lean} (${
    lean === 'rounded' ? round.length : square.length}/${sq.length}) — these disagree: ${
    odd.map(x => `${x.sel} r=${x.r}`).join(', ')}`);
}

await b.close();
console.log(JSON.stringify(out, null, 1));
console.log(bad.length ? 'FAIL — a corner that disagrees with its own page:\n - ' + bad.join('\n - ')
  : 'PASS — every page agrees with itself about corners');
process.exit(bad.length ? 1 : 0);
