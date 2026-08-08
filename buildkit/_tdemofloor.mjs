/* the demo floor: six doors, and every one of them opens */
import { chromium } from 'playwright';
import path from 'node:path';
const b = await chromium.launch();
const pg = await b.newPage({ viewport:{ width:1280, height:1000 }, deviceScaleFactor:2 });
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,120)));
await pg.goto('file://' + path.resolve('dist/demo.html'));
await pg.waitForTimeout(600);
const r = await pg.evaluate(() => ({
  n: document.querySelectorAll('.deal').length,
  hrefs: [...document.querySelectorAll('.deal')].map(a => a.getAttribute('href')),
  land: (()=>{ const a=[...document.querySelectorAll('.deal')].find(x=>/land\.html/.test(x.getAttribute('href')));
    if(!a) return null;
    const cv=a.querySelector('canvas'); const g=cv.getContext('2d');
    const d=g.getImageData(0,0,cv.width,cv.height).data;
    let ink=0; for(let i=0;i<d.length;i+=4) if(d[i]+d[i+1]+d[i+2] > 90) ink++;
    return { tag:a.querySelector('.tag').textContent, go:a.querySelector('.go').textContent,
             figs:[...a.querySelectorAll('.fig div')].map(x=>x.textContent),
             painted: ink > 2000 }; })(),
  h1: document.querySelector('h1').textContent,
}));
let bad=0; const ok=(t,p)=>{ if(!p){bad++;console.log('✗ '+t);} else console.log('✓ '+t); };
ok('six doors on the floor', r.n === 6);
ok('the land card opens the Land Desk', r.hrefs.some(h=>h==='land.html#demo=land'));
ok('the other five open the desk', r.hrefs.filter(h=>/^desk\.html#demo=/.test(h)).length === 5);
ok('the land card is drawn, not blank', r.land && r.land.painted);
ok('its second figure is the finished lot, not comps', r.land && /Finished lot/.test(r.land.figs[1]));
ok('its call to action names the room it opens', r.land && /Land Desk/.test(r.land.go));
ok('the headline counts what is actually there', /Five houses, and one piece of dirt/.test(r.h1));
ok('no page errors', errs.length === 0);
if (errs.length) console.log('   '+errs.join('\n   '));
await pg.locator('.deal').last().screenshot({ path:'shot/demo-land.png' });
await b.close();
console.log('\n' + (bad ? '✗ '+bad+' failed' : '✓ the floor holds'));
process.exit(bad?1:0);
