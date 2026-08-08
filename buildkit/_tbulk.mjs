import { chromium } from 'playwright';
const B='file:///home/claude/dist/';
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:1100}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
p.on('console',m=>{if(m.type()==='error'&&!/fraunces|ERR_FAILED/.test(m.text()))errs.push(m.text())});
await p.goto(B+'desk.html');
await p.evaluate(()=>{localStorage.clear();
 localStorage.setItem('ni-account-v1',JSON.stringify({name:'Elijah',email:'e@x.com',plan:'the office',trial:null}));});
await p.goto(B+'desk.html'); await p.waitForTimeout(700);
await p.goto(B+'desk.html#bulk'); await p.waitForTimeout(800);
console.log('open:', await p.evaluate(()=>!document.getElementById('bulk').hidden));
const list = `1104 Elm Street, Atlanta, GA 30310, 168000, 249000, 46000
88 Ostend Street, Atlanta, GA 30314, 132000, 196000, 38000
640 Sells Avenue, Atlanta, GA 30310, 149000
2210 Ashby Street, Atlanta, GA 30310
1900 Lucile Ave | 214000 | 300000 | 20500 | 2100`;
await p.fill('#bk-text', list);
await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(()=>({
  rows: document.querySelectorAll('.bkt tbody tr').length,
  parsed: bulkParse().recs,
  cols: bulkParse().cols,
  props: P.props.length,
  head: [...document.querySelectorAll('.bkt tbody tr')].map(t=>t.innerText.replace(/\s+/g,' ').slice(0,150)),
})), null, 1));
console.log('errs', errs);
await p.screenshot({path:'shot-bulk.png', fullPage:false});
await b.close();
