import { chromium } from 'playwright';
import fs from 'fs';
const PAGES = fs.readdirSync('/home/claude/dist').filter(f=>/\.html$/.test(f));
const b = await chromium.launch();
const bad = [];
for (const f of PAGES){
  const p = await b.newPage({viewport:{width:1280,height:1000}});
  try{
    await p.goto('file:///home/claude/dist/'+f,{waitUntil:'domcontentloaded',timeout:15000});
    await p.waitForTimeout(900);
    const r = await p.evaluate(()=>{
      const out=[];
      for (const e of document.querySelectorAll('body *')){
        const c=getComputedStyle(e);
        if (c.display==='none'||c.visibility==='hidden') continue;
        const rr=e.getBoundingClientRect(); if(!rr.width||!rr.height) continue;
        const radii=[c.borderTopLeftRadius,c.borderTopRightRadius,
                     c.borderBottomRightRadius,c.borderBottomLeftRadius].map(parseFloat);
        const sides=[c.borderTopWidth,c.borderRightWidth,c.borderBottomWidth,c.borderLeftWidth].map(parseFloat);
        const mixedRadius = Math.max(...radii)>=4 && Math.min(...radii)===0;
        const openEdge = sides.some(s=>s===0) && sides.some(s=>s>0);
        if (mixedRadius && openEdge){
          /* it is only a fault if nothing is touching the open edge */
          const below=document.elementFromPoint(rr.left+rr.width/2, Math.min(rr.bottom+3, innerHeight-1));
          out.push({ el:e.tagName.toLowerCase()+'.'+String(e.className||'').split(/\s+/)[0],
            radii, sides, touching: below===e||e.contains(below) });
        }
      }
      const seen=new Set();
      return out.filter(o=>{const k=o.el+o.radii+o.sides; if(seen.has(k))return false; seen.add(k); return true;});
    });
    if (r.length){ console.log(f, JSON.stringify(r)); r.forEach(o=>{ if(!o.touching) bad.push(f+' '+o.el); }); }
  }catch(e){ console.log(f,'ERR',String(e).slice(0,60)); }
  await p.close();
}
await b.close();
if (bad.length){ console.log('FAIL — a tab-shaped element with an open edge that touches nothing:');
  bad.forEach(x=>console.log(' - '+x)); process.exit(1); }
console.log('PASS — nothing is drawn as a tab (open edge, half-rounded) while floating free of the '
  + 'surface it is supposed to be attached to');
process.exit(0);
