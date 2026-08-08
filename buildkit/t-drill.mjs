import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1120,height:900}});
p.on('pageerror',e=>console.log('ERR',e.message));
await p.addInitScript(()=>{ window.__seed=1337; window.__strict=true; });
await p.goto('file:///home/claude/exit-drill.html'); await p.waitForTimeout(300);
console.log(JSON.stringify(await p.evaluate(()=>{
  const out={};
  for (const shape of ['flip','hold','subto','novation','walk','wholetail','wholesale','brrrr']){
    let ok=0, bad=[], margins=[];
    for(let i=0;i<40;i++){
      try{ const d=deal(shape); const a=answerFor(d);
        const allow=allowsOf(d); const R=rank(d).filter(x=>!allow||allow.indexOf(x.id)>=0);
        margins.push(R[0].fit-(R[1]?R[1].fit:0));
        if(a===shape) ok++; else bad.push([a,d.ask,d.arv,d.rep]);
      } catch(e){ bad.push('THROW '+e.message); }
    }
    out[shape]={ok, bad:bad.slice(0,2), minMargin:Math.min(...margins)};
  }
  return out;
}),null,1));
await b.close();
