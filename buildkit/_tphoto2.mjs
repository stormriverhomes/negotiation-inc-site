/* _tphoto2 — nobody uploads a photograph who has not paid for one.

   The photo read is the only feature in this product that spends money per
   use, on our key, at somebody else's request. So it is the one gate that has
   to hold from both ends, and this harness attacks both.

   IN THE BROWSER — five people, and only two of them get a file picker:
     A · a stranger with no account
     B · somebody inside the DEMO, where tierOf() deliberately says 3
     C · a free account
     D · a Solo account
     E · an Underwriter account            ← gets it
     F · a free account inside the trial   ← gets it, that is what a trial is
   and in every refused case: no <input type=file> in the document at all, the
   card says the true reason, and its button goes somewhere that can actually
   fix the problem — an account for a stranger, not a price list.

   ON THE WIRE — the browser is not consulted:
     G · runRead() called directly from the console, with files planted in
         state, sends NOTHING when the account is not entitled
     H · the request, when it is entitled, carries the account's bearer token
   The server half is covered by srv/test-read.mjs, which drives the route
   itself; this file proves the page never gets that far. */
import { chromium } from 'playwright';
import fs from 'fs';
import http from 'node:http';

const bad = [], out = {};
const site = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/read'){ out.HIT = (out.HIT || 0) + 1;
    res.writeHead(403, {'content-type':'application/json'});
    return res.end('{"ok":false,"error":"nope"}'); }
  const p = u.pathname === '/' ? '/index.html' : u.pathname;
  const f = '/home/claude/dist' + p;
  if (fs.existsSync(f) && fs.statSync(f).isFile()){
    res.writeHead(200, {'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html'});
    return res.end(fs.readFileSync(f)); }
  res.writeHead(404); res.end('no');
});
const port = await new Promise(r => site.listen(0, '127.0.0.1', () => r(site.address().port)));
const BASE = `http://127.0.0.1:${port}`;


/* a REAL image, not seven bytes pretending to be one: runRead() re-encodes
   every file through a canvas (that is the resize and the EXIF strip), and a
   fake JPEG fails to decode — which would make this harness pass for the
   wrong reason, by proving only that broken files are not sent. */
const PLANT = `(async () => {
  const c = document.createElement('canvas'); c.width = 24; c.height = 24;
  const g = c.getContext('2d'); g.fillStyle = '#8899aa'; g.fillRect(0,0,24,24);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
  PHOTO.files = [{ file: new File([blob], 'a.jpg', { type:'image/jpeg' }), thumb: null }];
})()`;

const today = new Date().toISOString().slice(0,10);
const CASES = [
  ['A signed out',          null,                                        false, 'signedout'],
  ['C free account',        { name:'E', email:'e@x.com', plan:null,  trial:null }, false, 'free'],
  ['D solo',                { name:'E', email:'e@x.com', plan:'solo', trial:null }, false, 'lowtier'],
  ['E underwriter',         { name:'E', email:'e@x.com', plan:'underwriter', trial:null }, true,  null],
  ['F free, in trial',      { name:'E', email:'e@x.com', plan:null,  trial:today },  true,  null],
];

const b = await chromium.launch();
const errs = [];
const open = async acct => {
  const p = await b.newPage({ viewport:{width:1280,height:1000} });
  p.on('pageerror', e => errs.push(String(e).slice(0,120)));
  await p.goto(BASE + '/desk.html');
  await p.evaluate(a => { localStorage.clear();
    if (a) localStorage.setItem('ni-account-v1', JSON.stringify(a)); }, acct);
  await p.goto(BASE + '/desk.html');
  await p.waitForFunction(() => typeof render === 'function' && typeof window.__photoEntitled === 'function',
    null, { timeout:20000 });
  await p.evaluate(() => { S.raw.arv='250000'; S.raw.asking='170000'; save(); showStep('condition'); });
  await p.waitForTimeout(400);
  return p;
};
const look = p => p.evaluate(() => ({
  entitled: window.__photoEntitled(),
  why: window.__entitleWhy(),
  tier: window.__tier(),
  picker: !!document.getElementById('ai-file'),
  anyFileInput: document.querySelectorAll('input[type=file]').length,
  lock: (document.getElementById('ai-zone')||{dataset:{}}).dataset.lock || null,
  cta: (document.querySelector('#ai-zone a.btn')||{}).getAttribute
        ? document.querySelector('#ai-zone a.btn').getAttribute('href') : null,
}));

for (const [nm, acct, shouldGet, why] of CASES){
  const p = await open(acct);
  const r = await look(p);
  out[nm] = r;
  if (r.entitled !== shouldGet) bad.push(`${nm}: entitled=${r.entitled}, expected ${shouldGet}`);
  if (shouldGet && !r.picker)   bad.push(`${nm}: paid for the read and got no file picker`);
  if (!shouldGet && r.anyFileInput)
    bad.push(`${nm}: THERE IS A FILE INPUT ON THE PAGE for somebody who has not paid for a read`);
  if (!shouldGet && r.why !== why) bad.push(`${nm}: the card blames "${r.why}", expected "${why}"`);
  if (!shouldGet && r.lock !== why) bad.push(`${nm}: the card is marked "${r.lock}", expected "${why}"`);
  await p.close();
}

/* ── B · the demo, which runs at tier 3 on purpose ────────────────────────── */
{
  const p = await open(null);
  const keys = await p.evaluate(() => Object.keys(typeof DEMOS !== 'undefined' ? DEMOS : {}));
  if (!keys.length) bad.push('B: there are no demos to test, which cannot be right');
  else {
    await p.evaluate(k => { loadDemo(k); render(); showStep('condition'); }, keys[0]);
    await p.waitForTimeout(500);
    const r = await look(p);
    out['B demo'] = r;
    if (r.tier < 3)      bad.push(`B: the demo is not running at tier 3 any more (${r.tier}) — this test proves nothing`);
    if (r.entitled)      bad.push('B: THE DEMO CAN UPLOAD PHOTOGRAPHS — an open vision endpoint with a friendly front end');
    if (r.anyFileInput)  bad.push('B: the demo has a file input on the page');
    if (r.why !== 'demo')bad.push(`B: the demo card blames "${r.why}"`);
  }
  await p.close();
}

/* ── G · the console, going round the button ─────────────────────────────── */
{
  const p = await open({ name:'E', email:'e@x.com', plan:'solo', trial:null });
  out.G = await p.evaluate(async PLANT => {
    /* plant a real image in state the way the picker would, then call the
       function the button calls. Nothing on this path consults the DOM. */
    await eval(PLANT);
    const planted = PHOTO.files.length;
    await window.__runRead();
    return { planted, left: PHOTO.files.length, err: PHOTO.err };
  }, PLANT);
  if (out.G.planted !== 1) bad.push('G: the harness failed to plant a readable image, so it proved nothing');
  if (out.HIT) bad.push(`G: A SOLO ACCOUNT REACHED /api/read FROM THE CONSOLE (${out.HIT} request(s))`);
  if (!out.G.err) bad.push('G: the refusal said nothing — a silent no-op reads as a broken button');
  await p.close();
}

/* ── H · an entitled request carries the token ───────────────────────────── */
{
  const p = await open({ name:'E', email:'e@x.com', plan:'underwriter', trial:null });
  const seen = [];
  p.on('request', r => { if (r.url().includes('/api/read')) seen.push(r.headers()); });
  const planted = await p.evaluate(async PLANT => {
    window.__authHeader = async () => ({ authorization: 'Bearer HARNESS-TOKEN' });
    await eval(PLANT);
    const n = PHOTO.files.length;
    await window.__runRead();
    return n;
  }, PLANT);
  if (planted !== 1) bad.push('H: the harness failed to plant a readable image, so it proved nothing');
  await p.waitForTimeout(800);
  out.H = { requests: seen.length, auth: seen[0] && seen[0]['authorization'] };
  if (!seen.length) bad.push('H: an entitled account sent no request at all');
  else if (out.H.auth !== 'Bearer HARNESS-TOKEN')
    bad.push('H: the request went out WITHOUT the account token — the server has nothing to check');
  await p.close();
}

if (errs.length) bad.push('something threw — ' + errs[0]);
await b.close(); site.close();
console.log(JSON.stringify(out, null, 1));
if (bad.length){ console.log('FAIL'); bad.forEach(x => console.log(' - ' + x)); process.exit(1); }
console.log('PASS — the demo, a stranger, a free account and a Solo account cannot put a photograph '
  + 'on the wire (no file input exists for them, and the function refuses when called directly); '
  + 'Underwriter and the trial can, and their request carries the account token the server checks');
process.exit(0);
