/* ══ WHAT A PHONE ACTUALLY DOWNLOADS ═══════════════════════════════════════
   Every page here is one self-contained file, which is a real virtue — no
   waterfall, no framework, works offline. The risk that comes with it is
   that a page's WEIGHT is invisible: nobody notices a stylesheet growing
   because there is no stylesheet. This measures what a cold phone pays for
   each door on the site, and how long before the thing is legible. */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
const PAGES = ['index.html','demo.html','plans.html','arcade.html','desk.html',
               'office.html','exits.html','land.html','comp-run.html','exit-drill.html'];
const rows = [];
const b = await chromium.launch();
for (const f of PAGES){
  const pg = await b.newPage({ viewport:{ width:390, height:844 } });
  let bytes = 0; const assets = [];
  pg.on('response', async r => {
    try { const buf = await r.body(); bytes += buf.length;
      if (buf.length > 40000) assets.push([r.url().split('/').pop().slice(0,28), buf.length]); } catch(e){}
  });
  const t0 = Date.now();
  await pg.goto('file://' + path.resolve('dist/'+f), { waitUntil:'load' });
  const load = Date.now() - t0;
  await pg.waitForTimeout(400);
  const paint = await pg.evaluate(() => {
    const e = performance.getEntriesByType('paint').find(x => x.name === 'first-contentful-paint');
    return e ? Math.round(e.startTime) : null;
  });
  const raw = fs.statSync('dist/'+f).size;
  rows.push({ f, raw, bytes, load, paint, assets: assets.sort((a,b2)=>b2[1]-a[1]).slice(0,3) });
  await pg.close();
}
await b.close();
const kb = n => (n/1024).toFixed(0).padStart(5) + 'KB';
console.log('page              html    total   fcp   load   heaviest assets');
for (const r of rows){
  console.log(r.f.padEnd(16) + kb(r.raw) + ' ' + kb(r.bytes)
    + String(r.paint ?? '—').padStart(6) + 'ms' + String(r.load).padStart(5) + 'ms   '
    + r.assets.map(a => a[0] + ' ' + (a[1]/1024).toFixed(0) + 'KB').join(' · '));
}
