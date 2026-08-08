/* the stage still works: six frames, tabs load what they show, and a phone
   pays for one picture instead of six */
import { chromium } from 'playwright';
import path from 'node:path';
let n=0,bad=0; const ok=(t,p)=>{n++; if(!p){bad++;console.log('✗ '+t)} else console.log('✓ '+t)};
const b = await chromium.launch();
for (const W of [1280, 390]){
  const pg = await b.newPage({ viewport:{ width:W, height:900 } });
  let bytes = 0;
  pg.on('response', async r => { try { bytes += (await r.body()).length; } catch(e){} });
  await pg.goto('file://' + path.resolve('dist/index.html'), { waitUntil:'load' });
  await pg.waitForTimeout(900);
  const first = await pg.evaluate(() => ({
    frames: document.querySelectorAll('#stage img').length,
    loaded: [...document.querySelectorAll('#stage img')].filter(i=>i.getAttribute('src')).length,
    shown: [...document.querySelectorAll('#stage img')].filter(i=>i.className==='on').length,
    broken: [...document.querySelectorAll('#stage img')].filter(i=>i.getAttribute('src') && !i.complete).length,
  }));
  ok(W+': six frames on the stage', first.frames === 6);
  ok(W+': exactly one is showing', first.shown === 1);
  ok(W+': a phone fetches one frame, a desktop two',
     first.loaded === (W < 700 ? 1 : 2));
  ok(W+': first paint under 300KB', bytes < 300*1024);
  /* and a tab press still works */
  const t = await pg.$$('#showtabs button');
  await t[4].click(); await pg.waitForTimeout(700);
  const after = await pg.evaluate(() => {
    const on = [...document.querySelectorAll('#stage img')].findIndex(i=>i.className==='on');
    const el = document.querySelectorAll('#stage img')[on];
    return { on, src: el && el.getAttribute('src'), ok: el && el.complete && el.naturalWidth > 0 };
  });
  ok(W+': pressing a tab shows that frame', after.on === 4);
  ok(W+': and the frame it shows actually loaded', !!after.ok);
  ok(W+': the frames are PNG', /\.png$/.test(after.src||''));
  await pg.close();
}
await b.close();
console.log('\n' + (bad ? '✗ '+bad+' of '+n : '✓ all '+n+' hold'));
process.exit(bad?1:0);
