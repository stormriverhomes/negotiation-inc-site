/* ══ CONDITION DRIVES THE CEILING, AND "SOUND" IS $0 NOT UNKNOWN ═══════════
   A user found it on the demo: clicking "Sound / nothing needed" showed the
   same sidebar number as "Heavy", because the sound branch cleared repairs to
   EMPTY (Needed) instead of $0 — so the flip refused and the rail fell to the
   buy-and-hold's ceiling, which happened to match. A sound house is the BEST
   flip and must show the HIGHEST ceiling, with the flip still priced.

   The flip demo is where condition unambiguously drives the number, so that is
   where this asserts. Each worse condition must lower the ceiling, all four
   must be distinct, and Sound must keep the flip priced rather than dropping
   to another exit. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve('dist/desk.html');
let n = 0, bad = 0;
const ok = (name, pass) => { n++; if (!pass){ bad++; console.log('✗ ' + name); } else console.log('✓ ' + name); };

const b = await chromium.launch();
const pg = await b.newPage({ viewport:{ width:1400, height:1000 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0,140)));
await pg.goto(FILE + '#demo=flip');
await pg.waitForTimeout(500);
await pg.evaluate(() => showResults());
await pg.waitForTimeout(500);

async function pick(preset){
  await pg.evaluate((pid) => {
    const el = document.querySelector(`#cond-presets [data-preset="${pid}"]`);
    if (el) el.click();
  }, preset);
  await pg.waitForTimeout(250);
  return pg.evaluate(() => {
    let top = null, priced = false;
    try { const R = rankedExits();
      top = R.priceable[0] ? { nm: R.priceable[0].nm, ceil: Math.round(R.priceable[0].ceil) } : null;
      priced = !!(R.EX.find(x => x.id === 'flip') && !R.EX.find(x => x.id === 'flip').na);
    } catch(e){}
    return { repairs: (typeof val === 'function') ? val('repairs') : null,
             top, flipPriced: priced };
  });
}

const light = await pick('light');
const medium = await pick('medium');
const heavy = await pick('heavy');
const sound = await pick('reset');

console.log('light ', JSON.stringify(light));
console.log('medium', JSON.stringify(medium));
console.log('heavy ', JSON.stringify(heavy));
console.log('sound ', JSON.stringify(sound));

ok('Sound sets repairs to $0, not unknown', sound.repairs === 0);
ok('Sound keeps the flip priced (does not refuse)', sound.flipPriced === true);
ok('the four presets give four distinct ceilings',
   new Set([light.top?.ceil, medium.top?.ceil, heavy.top?.ceil, sound.top?.ceil]).size === 4);
ok('a worse condition never RAISES the ceiling',
   sound.top.ceil >= light.top.ceil && light.top.ceil > medium.top.ceil && medium.top.ceil > heavy.top.ceil);
ok('Sound shows the highest ceiling of the four',
   sound.top.ceil === Math.max(light.top.ceil, medium.top.ceil, heavy.top.ceil, sound.top.ceil));
ok('no page errors', errs.length === 0);
if (errs.length) console.log('   ' + errs.join('\n   '));

await b.close();
console.log('\n' + (bad ? '✗ ' + bad + ' of ' + n + ' failed' : '✓ all ' + n + ' hold'));
process.exit(bad ? 1 : 0);
