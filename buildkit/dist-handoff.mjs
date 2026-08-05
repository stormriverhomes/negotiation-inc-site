// the funnel, walked the way a reader walks it, on the shipped build over HTTP
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'};
const srv=http.createServer((q,r)=>{ let f=path.join('dist',decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if(f.endsWith('/'))f+='index.html';
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nope');}
  r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(r); }).listen(8098);

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport:{width:1280,height:1000} });
const errs=[], fails=[];
p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
p.on('requestfailed',r=>fails.push(r.url()));

await p.goto('http://localhost:8098/exits.html'); await p.waitForTimeout(400);
await p.evaluate(()=>go(0,3)); await p.waitForTimeout(300);          // I · worked example
await p.click('.handoff a.btn'); await p.waitForTimeout(900);
const landed = { url:p.url(),
  strip: await p.evaluate(()=>document.querySelector('.fromc')?.innerText.replace(/\n/g,' ')||'(none)'),
  asking: await p.inputValue('[data-f="asking"]'),
  arv: await p.inputValue('[data-f="arv"]'),
  ranked: await p.evaluate(()=>[...document.querySelectorAll('.exit')].length),
  wholesalePriced: await p.evaluate(()=>(document.getElementById('x-wholesale')?.innerText||'').length>40) };
// and back out to a clean sheet — two clicks by design: the first arms, the
// second clears. One click wiping a sheet is the bug, not the feature.
await p.click('#c-blank'); await p.waitForTimeout(150);
const armed = await p.evaluate(()=>document.getElementById('c-blank').textContent);
const stillThere = await p.inputValue('[data-f="asking"]');
await p.click('#c-blank'); await p.waitForTimeout(400);
const cleaned = { armed, stillThere, url:p.url(), asking:await p.inputValue('[data-f="asking"]'),
  strip: await p.evaluate(()=>document.querySelector('.fromc')?'(still there)':'(gone)') };
// The walk-through left every masthead on purpose — a company that leads with
// a course looks like it sells courses. What must still resolve is the link the
// walk-through itself uses to hand a worked example to the desk, which the
// handoff section below exercises. Here we only assert the door is shut.
const courseInNav = await p.evaluate(()=>!!document.querySelector('header a[href*="exits"]'));
const backToCourse = courseInNav ? '(course link still in the desk masthead)' : '(retired)';

// and the arcade's door, on the shipped game
await p.goto('http://localhost:8098/comp-run.html'); await p.waitForTimeout(1200);
await p.evaluate(()=>{ try{ localStorage.clear(); }catch(e){} });
await p.reload(); await p.waitForTimeout(1200);
const arcadeHref = await p.evaluate(()=>{
  street = makeStreet(); street.picked = 0; renderStreet();
  const l = street.lots[0]; settle(Math.round(Math.max(l.floor,l.rival)+1));
  return document.getElementById('s-desk-go').getAttribute('href'); });
await p.goto('http://localhost:8098/'+arcadeHref); await p.waitForTimeout(900);
const fromArcade = { url:p.url(),
  strip: await p.evaluate(()=>document.querySelector('.fromc')?.innerText.replace(/\n/g,' ')||'(none)'),
  arv: await p.inputValue('[data-f="arv"]'),
  state: await p.evaluate(()=>document.querySelector('#fb-arv .stchip').textContent) };

console.log(JSON.stringify({landed,cleaned,backToCourse,arcadeHref,fromArcade,errs,fails},null,1));
const ok = /desk\.html#/.test(landed.url) && landed.asking==='118,000' && landed.arv==='240,000'
  && /Teaching example/i.test(landed.strip) && landed.ranked===7 && landed.wholesalePriced
  && /Clear everything/.test(cleaned.armed) && cleaned.stillThere==='118,000'
  && cleaned.asking==='' && cleaned.strip==='(gone)' && !/#/.test(cleaned.url)
  && backToCourse === '(retired)'
  && /^desk\.html#/.test(arcadeHref) && fromArcade.arv==='300,000'
  && fromArcade.state==='ESTIMATE' && /arcade/i.test(fromArcade.strip)
  && !errs.length && !fails.length;
console.log(ok ? 'PASS — the shipped funnel walks end to end' : 'FAIL');
await b.close(); srv.close(); process.exit(ok?0:1);
