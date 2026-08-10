/* _funnelwalk — the whole funnel, on a phone and on a desktop, against the
   live-stage build. Measures what a promo click actually experiences:

     · console errors and page errors, per page
     · every internal link resolves to a file that exists
     · horizontal overflow (the mobile deal-breaker)
     · how many screens down the FIRST PRIMARY ACTION sits
     · total page height in screens

   Nothing here fixes anything. It is the instrument. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const DIST = '/home/claude/dist';
const PAGES = ['index.html','arcade.html','demo.html','plans.html','office.html',
               'daily-street.html','comp-run.html','exit-drill.html','exits.html','land.html'];

/* what counts as "the primary action" per page — the thing a visitor came to press */
const ACTION = {
  'index.html':  'a[href*="arcade"], a[href*="demo"], a.btn, [data-arcade], [data-desk]',
  'arcade.html': 'a[href*="comp-run"], a[href*="daily"], a[href*="exit"], .cab a, a.btn',
  'demo.html':   'button, input, select, a[href*="desk"], a.btn',
  'plans.html':  'a[href*="join="], a.btn',
  'office.html': '#g-name, #g-email, input',
  'daily-street.html': 'button, a.btn, input, [data-play]',
  'comp-run.html':     'button, canvas, a.btn',
  'exit-drill.html':   'button, a.btn, input',
  'exits.html':  'a, button',
  'land.html':   'input, button, a.btn',
};

const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')){
    res.writeHead(200, {'content-type':'application/json'});
    return res.end(JSON.stringify({ ok:true, accounts:false }));
  }
  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  if (!path.extname(p)) p += '.html';
  const f = path.join(DIST, p);
  if (fs.existsSync(f) && fs.statSync(f).isFile()){
    const ext = path.extname(f);
    res.writeHead(200, {'content-type': ext === '.js' ? 'text/javascript'
      : ext === '.css' ? 'text/css' : ext === '.png' ? 'image/png'
      : ext === '.woff2' ? 'font/woff2' : 'text/html'});
    return res.end(fs.readFileSync(f));
  }
  res.writeHead(404); res.end('no');
});
const port = await new Promise(r => site.listen(0, '127.0.0.1', () => r(site.address().port)));
const BASE = `http://127.0.0.1:${port}`;

/* ── the link crawl needs no browser ── */
const missing = [];
for (const f of PAGES.concat(fs.readdirSync(path.join(DIST,'d')).map(x=>'d/'+x))){
  const fp = path.join(DIST, f);
  if (!fs.existsSync(fp)) continue;
  const s = fs.readFileSync(fp, 'utf8');
  for (const m of s.matchAll(/href="([^"#?]+)[^"]*"/g)){
    const h = m[1];
    if (/^(https?:|mailto:|data:|javascript:|tel:)/.test(h)) continue;
    let t = h.replace(/^\//,'');
    if (!t) continue;
    if (f.startsWith('d/') && !t.startsWith('d/')) t = t.replace(/^\.\.\//,'');
    if (!path.extname(t)) t += '.html';
    if (!fs.existsSync(path.join(DIST, t))) missing.push(`${f} -> ${h}`);
  }
}

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const out = { missing: [...new Set(missing)] };

for (const [label, vp] of [['phone', {width:390, height:844}], ['desktop', {width:1280, height:800}]]){
  const ctx = await b.newContext({ viewport: vp });
  out[label] = {};
  for (const pg of PAGES){
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERR ' + e.message.slice(0,140)));
    p.on('console', m => { if (m.type() === 'error' && !/favicon|net::|Failed to load resource/.test(m.text()))
      errs.push('CONSOLE ' + m.text().slice(0,140)); });
    try {
      await p.goto(BASE + '/' + pg, { waitUntil:'load', timeout: 20000 });
      await p.waitForTimeout(1200);
      const r = await p.evaluate((sel) => {
        const vh = window.innerHeight;
        const doc = document.documentElement;
        const overflowX = doc.scrollWidth - window.innerWidth;
        /* the first VISIBLE primary action, by document position */
        let firstTop = null, firstWhat = null;
        for (const el of document.querySelectorAll(sel)){
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const b = el.getBoundingClientRect();
          if (b.width < 8 || b.height < 8) continue;
          const top = b.top + window.scrollY;
          if (firstTop === null || top < firstTop){ firstTop = top; firstWhat =
            (el.tagName + ' ' + (el.id ? '#'+el.id : (el.textContent||'').trim().slice(0,30))).trim(); }
        }
        /* and the widest offender if there is overflow */
        let widest = null;
        if (overflowX > 2){
          let max = 0;
          for (const el of document.querySelectorAll('body *')){
            const b = el.getBoundingClientRect();
            if (b.right > window.innerWidth && b.right - window.innerWidth > max){
              max = b.right - window.innerWidth;
              widest = (el.tagName + (el.id ? '#'+el.id : '') + ' .' + String(el.className).split(' ')[0]).slice(0,60);
            }
          }
        }
        return { screens: +(doc.scrollHeight / vh).toFixed(2),
                 actionScreens: firstTop === null ? null : +(firstTop / vh).toFixed(2),
                 action: firstWhat, overflowX, widest };
      }, ACTION[pg] || 'a.btn, button, input');
      out[label][pg] = { ...r, errs };
    } catch(e){ out[label][pg] = { failed: String(e).slice(0,160), errs }; }
    await p.close();
  }
  await ctx.close();
}
await b.close(); site.close();
console.log(JSON.stringify(out, null, 1));
