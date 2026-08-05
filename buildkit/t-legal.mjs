/* t-legal — the three legal pages.
   They are the cheapest pages in the product to get wrong and the most
   embarrassing: a dead anchor in a terms page reads as a company that has not
   read its own terms. So: every contents link must land on a real section,
   every internal href must point at a file that exists, nothing may hedge, and
   the corners must match the rest of the software. */
import { chromium } from 'playwright';
import fs from 'fs';

const PAGES = ['terms.html', 'privacy.html', 'refunds.html'];
const KNOWN = new Set(['index.html','desk.html','plans.html','demo.html','exits.html','arcade.html',
                       'terms.html','privacy.html','refunds.html','the-eight-exits.html']);
const HEDGE = /under review|pre-?launch|coming soon|to be determined|\bTBD\b|placeholder|lorem ipsum/i;

const b = await chromium.launch();
const p = await b.newPage();
const out = {};
let bad = [];

for (const f of PAGES){
  const errs = [];
  p.removeAllListeners('console'); p.removeAllListeners('pageerror');
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto('file:///home/claude/' + f);

  const r = await p.evaluate(() => {
    const secs = [...document.querySelectorAll('main.body section')].map(s => s.id);
    const toc  = [...document.querySelectorAll('.toc a')].map(a => a.getAttribute('href').slice(1));
    const hrefs = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
    const sq = [];
    for (const el of document.querySelectorAll('.short,.note,.warn,.contact,table,.stamp,.btn,.crumb a')){
      const rr = parseFloat(getComputedStyle(el).borderTopLeftRadius);
      if (!(rr > 5)) sq.push(el.className || el.tagName);
    }
    return {
      secs, toc, hrefs,
      h1: (document.querySelector('h1')||{}).textContent,
      eff: (document.querySelector('.stamp')||{}).textContent,
      words: document.body.innerText.split(/\s+/).length,
      square: sq,
      /* the crumb row must mark the page you are on, or the three documents
         read as one undifferentiated wall */
      crumbOn: (document.querySelector('.crumb a.on')||{}).getAttribute
                 ? document.querySelector('.crumb a.on').getAttribute('href') : null,
      footerLegal: [...document.querySelectorAll('footer a')].map(a => a.getAttribute('href')),
    };
  });

  const missing = r.toc.filter(t => !r.secs.includes(t));
  const dead = [...new Set(r.hrefs)].filter(h => h && !h.startsWith('#') && !h.startsWith('mailto:')
                 && !h.startsWith('http') && !KNOWN.has(h.split('#')[0]));
  const src = fs.readFileSync('/home/claude/' + f, 'utf8');
  const hedged = HEDGE.test(src.replace(/<!--[\s\S]*?-->/g, ''));

  out[f] = { sections: r.secs.length, toc: r.toc.length, missing, dead, hedged,
             words: r.words, square: r.square, crumbOn: r.crumbOn, errs,
             linksAllThree: PAGES.every(x => r.footerLegal.includes(x)) };

  if (missing.length) bad.push(`${f}: contents links with no section — ${missing}`);
  if (dead.length)    bad.push(`${f}: link to a page that does not exist — ${dead}`);
  if (hedged)         bad.push(`${f}: hedging language on the live page`);
  if (r.square.length)bad.push(`${f}: square corners — ${r.square.slice(0,4)}`);
  if (r.crumbOn !== f)bad.push(`${f}: the crumb row does not mark the current page (${r.crumbOn})`);
  if (!out[f].linksAllThree) bad.push(`${f}: footer does not link all three legal pages`);
  if (errs.length)    bad.push(`${f}: console errors — ${errs.slice(0,2)}`);
  if (r.words < 900)  bad.push(`${f}: too thin at ${r.words} words to be a real document`);
}

/* every other page must reach them, or they are three orphans */
for (const f of ['ni-landing-v3.html', 'plans.html', 'office.html', 'desk.html',
                 'the-eight-exits.html', 'arcade-hub.html', 'demo-page.html', 'exit-drill.html']){
  const s = fs.readFileSync('/home/claude/' + f, 'utf8');
  const has = ['terms.html','privacy.html','refunds.html'].filter(x => s.includes('"' + x + '"'));
  out['links:' + f] = has.length;
  if (has.length < 3) bad.push(`${f} does not link all three legal pages (has ${has.length})`);
}

await b.close();
console.log(JSON.stringify(out, null, 1));
console.log(bad.length ? 'FAIL\n - ' + bad.join('\n - ')
  : 'PASS — three finished documents, every anchor lands, every page reaches them');
process.exit(bad.length ? 1 : 0);
