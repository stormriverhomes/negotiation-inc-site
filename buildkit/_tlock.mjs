/* ══ THE FIVE LOCKED CARDS, MEASURED ═══════════════════════════════════════
   These are the only five places in the product that ask a stranger to start
   paying. Each one lives on a different screen, so this walks to each screen
   rather than asserting from the stylesheet — the number that decides it is
   the gap between the last line of prose and the top of the blue button, on
   the page, at both widths.

   Run as `node _tlock.mjs check` to assert instead of report. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve('dist/desk.html');
const tag = process.argv[2] || 'shot';
const CHECK = tag === 'check' || !process.argv[2];
const MIN = 14;                       /* below this it reads as one object */

const measure = node => {
  const btn = node.querySelector('.btn');
  if (!btn) return { err:'no button' };
  let prev = btn.previousElementSibling;
  while (prev && !prev.textContent.trim()) prev = prev.previousElementSibling;
  const c = btn.getBoundingClientRect(), box = node.getBoundingClientRect();
  const a = prev ? prev.getBoundingClientRect() : null;
  return { gap: a ? Math.round(c.top - a.bottom) : null,
           floor: Math.round(box.bottom - c.bottom),
           tap: Math.round(c.height) };
};

const b = await chromium.launch();
let bad = 0;
for (const W of [1280, 390]){
  const pg = await b.newPage({ viewport:{ width:W, height:1100 }, deviceScaleFactor:2 });
  const out = [];
  const shoot = async (nm, sel) => {
    const el = await pg.$(sel);
    if (!el || !(await el.isVisible())){ out.push(nm.padEnd(7) + ' NOT VISIBLE'); bad++; return; }
    try { await el.scrollIntoViewIfNeeded({ timeout:3000 }); } catch(e){}
    await pg.waitForTimeout(100);
    if (!CHECK) try { await el.screenshot({ path:`shot/${tag}-${W}-${nm}.png`, timeout:5000 }); } catch(e){}
    const m = await el.evaluate(measure);
    const ok = m.gap !== null && m.gap >= MIN && m.tap >= 30;
    if (!ok) bad++;
    out.push((ok ? '  ' : '✗ ') + nm.padEnd(7) + ' gap ' + String(m.gap).padStart(3)
             + 'px · floor ' + String(m.floor).padStart(2) + 'px · tap ' + m.tap + 'px');
  };

  await pg.goto(FILE + '#demo=flip');
  await pg.waitForTimeout(400);
  await pg.evaluate(() => { showResults(); });
  await pg.waitForTimeout(800);
  await shoot('objp', '#objections .objp.locked');
  /* The written comparison only exists once two priced sheets are in the
     bench, which is more setup than this harness should own. Its markup comes
     from cmpWriteHTML() and its CSS is the same cascade as the other four, so
     the card is rendered from the product's own function into the product's
     own compare container and measured there. */
  await pg.evaluate(() => { try {
    showCompare();
    const host = document.getElementById('compare');
    host.insertAdjacentHTML('beforeend', '<div class="cmp-wrap">' + cmpWriteHTML(null) + '</div>');
  } catch(e){ document.title = 'CMP ' + e.message; } });
  await pg.waitForTimeout(600);
  await shoot('cmp', '.cmp-write.locked');
  await pg.evaluate(() => { document.body.classList.remove('comparing');
    const c = document.getElementById('compare'); if (c) c.hidden = true;
    const r = document.getElementById('results'); if (r) r.hidden = true; showStep('property'); });
  await pg.waitForTimeout(600);
  await shoot('sbrief', '#streetbrief .sbrief.locked');
  await pg.evaluate(() => { showStep('condition'); });
  await pg.waitForTimeout(600);
  await shoot('bidc',   '#bidcheck .bidc.locked');
  await shoot('airead', '.airead[data-lock]');

  console.log('@' + W + 'px');
  console.log('  ' + out.join('\n  '));
  await pg.close();
}
await b.close();
console.log(bad ? '\n✗ ' + bad + ' locked card(s) too tight (want ≥' + MIN + 'px)' : '\n✓ all five breathe');
if (CHECK) process.exit(bad ? 1 : 0);
