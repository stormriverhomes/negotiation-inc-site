/* _thero — the hero takes the first address, and the greeting knows the hour.
   The address box is the whole reason the dashboard's first action is at depth
   zero, so what has to hold is that it REACHES THE SHEET — a box that looks
   like an input and loses what you typed is worse than no box. */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright';
const DIST='/home/claude/dist'; const bad=[], out={};
const site=http.createServer((req,res)=>{let p=new URL(req.url,'http://x').pathname;
 if(p.startsWith('/api/')){res.writeHead(200,{'content-type':'application/json'});return res.end('{"ok":true,"accounts":false}');}
 if(p==='/')p='/index.html'; if(!path.extname(p))p+='.html';
 const f=path.join(DIST,p);
 if(fs.existsSync(f)){const e=path.extname(f);res.writeHead(200,{'content-type':e==='.js'?'text/javascript':'text/html'});return res.end(fs.readFileSync(f));}
 res.writeHead(404);res.end('no');});
const port=await new Promise(r=>site.listen(0,'127.0.0.1',()=>r(site.address().port)));
const B=`http://127.0.0.1:${port}`;
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const acct=`try{localStorage.setItem('ni-account-v1',JSON.stringify({name:'Elijah',email:'e@x.com',market:'30310',plan:null,trial:null}))}catch(e){}`;

/* ══ A · the greeting tracks the clock ══════════════════════════════════ */
{
  const ctx=await b.newContext(); const p=await ctx.newPage();
  await p.addInitScript(acct);
  await p.goto(B+'/office.html'); await p.waitForTimeout(1200);
  out.A = await p.evaluate(()=>{
    const g=window.__greetFor; if(typeof g!=='function') return {no:true};
    return { h2:g(2), h8:g(8), h14:g(14), h19:g(19), h23:g(23), junk:g(NaN),
      shown:(document.getElementById('hi')||{}).textContent };
  });
  if(out.A.no) bad.push('A: the greeting is not exposed, so it cannot be tested');
  else {
    const want={h2:'Still up',h8:'Good morning',h14:'Good afternoon',h19:'Good evening',h23:'Still at it'};
    for(const k of Object.keys(want)) if(out.A[k]!==want[k])
      bad.push(`A: ${k} greeted "${out.A[k]}", expected "${want[k]}"`);
    if(!/Elijah\.$/.test(out.A.shown||'')) bad.push('A: the greeting stopped using the first name');
    if(out.A.junk!=='Good to see you') bad.push('A: a broken clock did not fall back to a plain greeting');
  }
  await ctx.close();
}

/* ══ B · empty desk shows the box; a full desk does not ═════════════════ */
{
  const ctx=await b.newContext(); const p=await ctx.newPage();
  await p.addInitScript(acct);
  await p.goto(B+'/office.html'); await p.waitForTimeout(1300);
  out.B_empty = await p.evaluate(()=>{
    const f=document.getElementById('heroask');
    const i=document.getElementById('hero-addr');
    return { shown:!!(f&&!f.hidden), fontPx: i?parseFloat(getComputedStyle(i).fontSize):null,
      depth:+(((f?f.getBoundingClientRect().top+scrollY:0))/innerHeight).toFixed(2) };
  });
  if(!out.B_empty.shown) bad.push('B: an empty desk did not offer the address box');
  if(out.B_empty.fontPx < 16) bad.push(`B: the hero input is ${out.B_empty.fontPx}px — under 16 and iOS zooms the page on focus`);
  if(out.B_empty.depth > 0.9) bad.push(`B: the first action is ${out.B_empty.depth} screens down; the point of it is depth zero`);

  await p.evaluate(()=>{ localStorage.setItem('ni-desk-v3', JSON.stringify({active:0,mode:'simple',adv:null,
    props:[{id:'p1',name:'142 Marigold',addr:'142 Marigold Lane',updated:Date.now(),
      f:{asking:{v:'184500'}},raw:{asking:'184500'},est:{},prov:{},unc:{},sys:{},comps:[],subj:{},compAdj:{},src:{}}]})); });
  await p.goto(B+'/office.html'); await p.waitForTimeout(1400);
  out.B_full = await p.evaluate(()=>{ const f=document.getElementById('heroask'); return !!(f&&!f.hidden); });
  if(out.B_full) bad.push('B: the address box stayed up once there were properties on the desk');
  await ctx.close();
}

/* ══ C · THE ADDRESS REACHES THE SHEET ═════════════════════════════════ */
{
  const ctx=await b.newContext(); const p=await ctx.newPage();
  await p.addInitScript(acct);
  await p.goto(B+'/office.html'); await p.waitForTimeout(1300);
  await p.fill('#hero-addr','512 Joseph E Lowery Blvd SW, Atlanta GA 30310');
  await p.click('#heroask button[type=submit]');
  await p.waitForTimeout(2000);
  out.C = await p.evaluate(()=>({
    url: location.pathname + location.hash,
    addr: (document.getElementById('addr')||{}).value || null,
    /* it must not survive a second blank sheet */
    seedLeft: (()=>{ try{ return localStorage.getItem('ni-new-addr'); }catch(e){ return 'ERR'; } })(),
  }));
  /* the desk consumes #new and clears it, so the landing URL is /desk.html —
     what matters is which page we are on and whether the address came with */
  if(!/desk\.html/.test(out.C.url)) bad.push('C: the button did not open a sheet ('+out.C.url+')');
  if(out.C.addr !== '512 Joseph E Lowery Blvd SW, Atlanta GA 30310')
    bad.push('C: THE ADDRESS DID NOT ARRIVE ON THE SHEET — got '+JSON.stringify(out.C.addr));
  if(out.C.seedLeft) bad.push('C: the address is still in storage after being used — the next blank sheet inherits it');

  /* and it is not in the URL, where it would land in history and screenshots */
  if(/lowery|atlanta|30310/i.test(out.C.url)) bad.push('C: the address rode in the URL');
  await ctx.close();
}
await b.close(); site.close();
console.log(JSON.stringify(out,null,1));
if(bad.length){ console.log('FAIL'); bad.forEach(x=>console.log(' - '+x)); process.exit(1); }
console.log('PASS — the greeting tracks the hour, the box appears only on an empty desk at 16px and depth zero, and the address reaches the sheet without riding in the URL');
