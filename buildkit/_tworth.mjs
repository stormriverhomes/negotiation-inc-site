import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{ width:1280, height:900 } });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('file:///home/claude/dist/plans.html');
await p.waitForTimeout(400);
const o = await p.evaluate(()=>{
  const w=document.querySelector('.worth'), ways=document.querySelectorAll('.close .way');
  const r=w?w.getBoundingClientRect():null;
  const boxes=[...document.querySelectorAll('.wr')].map(x=>x.children.length);
  const wayInfo=[...ways].map(a=>({href:a.getAttribute('href'), h:Math.round(a.getBoundingClientRect().height), t:a.querySelector('.wt')?.textContent}));
  const h1=document.querySelector('h1')?.textContent;
  // overlap check on the worth grid
  const cols=[...document.querySelectorAll('.wcol')].map(c=>{const b=c.getBoundingClientRect();return {x:Math.round(b.x),w:Math.round(b.width),h:Math.round(b.height)};});
  return { worth:!!w, worthW:r&&Math.round(r.width), boxes, wayInfo, h1, cols,
           overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth };
});
console.log(JSON.stringify(o,null,1));
console.log('page errors:', errs);
await p.setViewportSize({width:390,height:844}); await p.waitForTimeout(300);
const m = await p.evaluate(()=>({
  overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
  wayH: [...document.querySelectorAll('.close .way')].map(a=>Math.round(a.getBoundingClientRect().height)),
  colW: [...document.querySelectorAll('.wcol')].map(c=>Math.round(c.getBoundingClientRect().width)),
}));
console.log('phone:', JSON.stringify(m));
await p.screenshot({ path:'_worth.png', fullPage:false });
await b.close();
