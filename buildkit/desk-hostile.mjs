// ── the desk under hostile input ────────────────────────────────────────────
// The hash is an attack surface: anyone can mail a crafted desk link. These
// assert that no hash and no typed text can execute, inject markup, or smuggle
// absurd numbers onto the sheet — and that garbage saved state cannot brick it.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const F=[], ck=(c,m)=>{ if(!c) F.push(m); };
const p = await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));

const CASES = [
  { h:'#asking=1&from=I&title=%3Cimg%20src%3Dx%20onerror%3Dwindow.__pwned%3D1%3E', loads:true },
  { h:'#asking=1&from=%3Cscript%3E&title=x', loads:false },        // sender unknown → refused
  { h:'#asking=1e300&from=I&title=ok', loads:false },              // over the cap → refused
  { h:'#asking=-5&arv=999999999999&from=arcade&title=hi', loads:false },
  { h:'#asking=100000&from=I&est=__proto__,constructor&exit=%3Cb%3E&sit=evil&title='+'A'.repeat(500), loads:true },
];
for (const c of CASES){
  await p.goto('about:blank');
  await p.goto('file:///home/claude/desk.html');
  await p.evaluate(()=>localStorage.clear());
  await p.goto('file:///home/claude/desk.html'+c.h); await p.reload(); await p.waitForTimeout(400);
  const r = await p.evaluate(()=>({ pwned: window.__pwned||false,
    injected: document.querySelectorAll('.fromc img, .fromc script, #printdoc img').length,
    asking: document.querySelector('[data-f="asking"]')?.value ?? '',
    striplen: (document.querySelector('.fromc')?.innerText||'').length,
    protoClean: !({}).polluted && Object.getPrototypeOf({}) === Object.prototype }));
  ck(!r.pwned, c.h.slice(0,40)+': script executed');
  ck(r.injected===0, c.h.slice(0,40)+': markup injected');
  ck(r.protoClean, c.h.slice(0,40)+': prototype polluted');
  if (c.loads) ck(r.asking!=='', c.h.slice(0,40)+': a legal case failed to load');
  else ck(r.asking==='', c.h.slice(0,40)+': an illegal case loaded anyway');
  if (c.loads) ck(r.striplen<400, 'a 500-char title was not length-capped');
}

// typed injection: address and a money field, then the print rendering
await p.goto('file:///home/claude/desk.html'); await p.evaluate(()=>localStorage.clear());
await p.reload(); await p.waitForTimeout(300);
await p.fill('#addr','<img src=x onerror=window.__p2=1> Evil St');
await p.fill('[data-f="asking"]','"><img src=x onerror=window.__p3=1>');
await p.waitForTimeout(400);
const typed = await p.evaluate(()=>{ window.__showResults();
  return { p2:window.__p2||false, p3:window.__p3||false,
    imgs: document.querySelectorAll('.sheet img, #printdoc img').length }; });
ck(!typed.p2 && !typed.p3 && typed.imgs===0, 'typed markup escaped somewhere');

// garbage saved state must not brick the boot
await p.evaluate(()=>{ localStorage.setItem('ni-desk-v3','{"active":9,"props":[{"id":5,"name":{},"addr":42,"sit":[],"sys":"no","f":{"asking":{"v":{"a":1},"e":"yes","u":"NaN"}}}]}');
  localStorage.setItem('ni-desk-v2','{"addr":42,"sit":[],"f":{"asking":{"v":{"a":1},"e":"yes","u":"NaN"}}}');
  localStorage.setItem('ni-desk-case','<script>x</script>'); });
await p.reload(); await p.waitForTimeout(400);
const booted = await p.evaluate(()=>({ ok: !!document.querySelector('#flow .step, #results .docket'),
  scripts: document.querySelectorAll('.fromc script').length }));
ck(booted.ok && booted.scripts===0, 'garbage saved state bricked the boot or injected');

ck(!errs.length, 'page errors: '+errs.join('; ').slice(0,200));
console.log(F.length ? 'FAIL:\n- '+F.join('\n- ') : 'PASS — hostile input executes nothing, injects nothing, bricks nothing');
await b.close(); process.exit(F.length?1:0);
