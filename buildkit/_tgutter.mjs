/* ══ NOTHING TOUCHES THE GLASS ═════════════════════════════════════════════
   Every shipped page, at phone width: no horizontal overflow, and no text
   sitting against the edge of the screen. The landing lost its gutter to a
   `padding: Xpx 0` shorthand on an element that was also the page's own
   `.wrap` — a class of mistake that is invisible on a desktop and ruins a
   phone, so it is checked rather than remembered. */
import { chromium } from 'playwright';
import path from 'node:path';
/* the games were not on this list, and one of them — the drill — has been
   shipping with its text flush to both edges of every phone that opened it.
   A guard that covers the pages you remember to name is a guard with a hole
   the exact shape of what you forgot. */
const PAGES = ['index.html','demo.html','plans.html','arcade.html','desk.html',
               'office.html','exits.html','land.html',
               'comp-run.html','exit-drill.html','daily-street.html'];
const MIN = 12;                       // less gutter than this reads as broken
let n=0, bad=0;
const b = await chromium.launch();
for (const f of PAGES){
  const pg = await b.newPage({ viewport:{ width:390, height:844 } });
  await pg.goto('file://' + path.resolve('dist/'+f));
  await pg.waitForTimeout(700);
  const r = await pg.evaluate((MIN) => {
    const out = { over: document.documentElement.scrollWidth > innerWidth + 1, tight: [] };
    /* the first version watched only headings, prose and buttons — and passed
         a page whose entire MASTHEAD was flush to the glass, because a wordmark
         is a span and a nav link is a bare anchor. A gutter check that only
         looks at the body is a gutter check with a hole in the top of it. */
      for (const el of document.querySelectorAll('h1,h2,p,li,.lede,.trust div,.btn,header a,header span,nav a,.mark .nm')){
      if (!el.offsetParent && el.tagName !== 'BODY') continue;
      const t = (el.textContent||'').trim(); if (!t) continue;
      const r2 = el.getBoundingClientRect();
      if (r2.width < 4 || r2.height < 4) continue;
      if (r2.left < MIN || r2.right > innerWidth - MIN + 0.5)
        out.tight.push(el.tagName.toLowerCase() + '.' + (el.className||'').split(' ')[0]
          + ' @' + Math.round(r2.left) + '→' + Math.round(r2.right) + ' “' + t.slice(0,28) + '”');
    }
    out.tight = [...new Set(out.tight)].slice(0,4);
    return out;
  }, MIN);
  n++;
  if (r.over){ bad++; console.log('✗ ' + f + ' scrolls sideways on a phone'); }
  else if (r.tight.length){ bad++; console.log('✗ ' + f + ' has text against the glass:\n    ' + r.tight.join('\n    ')); }
  else console.log('✓ ' + f);
  await pg.close();
}
await b.close();
console.log('\n' + (bad ? '✗ ' + bad + ' of ' + n + ' pages' : '✓ all ' + n + ' pages keep their gutter'));
process.exit(bad?1:0);
