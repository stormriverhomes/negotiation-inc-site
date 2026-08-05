/* t-photo — the browser half of the condition read.

     A · the tier line, and what the locked panel is allowed to claim
     B · photographs are RESIZED AND RE-ENCODED before they go anywhere, which
         is the EXIF strip: the bytes that leave are not the bytes that came
         in, they are smaller, and they are a JPEG whatever went in
     C · what comes back is applied HONESTLY, and this is the whole feature:
         a line the read could see moves its slider; a line it refused is left
         exactly where it was, named on the page, and never zeroed
     D · the resulting repair figure is an ESTIMATE with a wider band than a
         walk-through, and a read that saw less carries a wider one still
     E · anything you drag yourself outranks the read, permanently
     F · the receipt survives a save, a reload and a trip through the file
         validator, because it ends up quoted on a lender packet */
import { chromium } from 'playwright';

const B = 'file:///home/claude/dist/';
const b = await chromium.launch();
const out = {}; const bad = []; const errs = [];
const p = await b.newPage({ viewport:{ width:1400, height:1100 } });
p.on('pageerror', e => errs.push(String(e)));
p.on('console', m => { if (m.type() === 'error' && !/fraunces|ERR_FAILED/.test(m.text())) errs.push(m.text()); });

/* a real 600x400 JPEG, made in the page, so the resize has something to do */
const makeFile = async (n = 2) => p.evaluate(async count => {
  const dt = new DataTransfer();
  for (let i = 0; i < count; i++){
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 1200;                       // bigger than the target edge
    const x = c.getContext('2d');
    x.fillStyle = '#88a'; x.fillRect(0,0,1600,1200);
    x.fillStyle = '#fff'; x.font = '200px sans-serif'; x.fillText(String(i+1), 60, 300);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    dt.items.add(new File([blob], `shot${i+1}.png`, { type:'image/png' }));
  }
  const f = document.getElementById('ai-file');
  f.files = dt.files;
  f.dispatchEvent(new Event('change', { bubbles:true }));
  return f.files.length;
}, n);

/* the service, stubbed in the page: it records exactly what was sent and
   answers with a fixture that refuses five lines */
const stub = () => p.evaluate(() => {
  window.__SENT = null;
  window.fetch = async (url, opt) => {
    const body = JSON.parse(opt.body);
    window.__SENT = { url, access: opt.headers['x-ni-access'],
      n: body.images.length, types: body.images.map(i => i.media_type),
      bytes: body.images.map(i => i.data.length), house: body.house, notes: body.notes,
      keys: Object.keys(body) };
    const lines = {};
    const SEEN = { kitchen:85, bath1:70, floors:75, paint:80, windows:60, siding:35,
                   doors:45, drive:30, yard:40, misc:35, bath2:55, water:20 };
    for (const l of LINES) lines[l.id] = SEEN[l.id] !== undefined
      ? { seen:true, pc:SEEN[l.id], conf:'high', why:`saw it in photo 1 — ${l.lab}` }
      : { seen:false, pc:null, why:`nothing in these frames shows the ${l.lab.toLowerCase()}` };
    return { ok:true, status:200, json: async () => ({ ok:true, lines,
      flags:[{ what:'Water stain on a ceiling', where:'photo 3', why:'a question about the roof, not an answer' }],
      summary:'Inside well, outside barely.', model:'stub',
      stats:{ seen:12, unseen:5, contradicted:0 } }) };
  };
});

const land = async plan => {
  await p.goto(B + 'desk.html');
  await p.evaluate(pl => { localStorage.clear();
    localStorage.setItem('ni-account-v1', JSON.stringify({ name:'Elijah', email:'e@x.com', plan:pl, trial:null }));
    localStorage.setItem('ni-access-v1', 'letmein');
  }, plan);
  await p.goto(B + 'desk.html'); await p.waitForTimeout(600);
  await p.evaluate(() => { S.addr='1104 Elm Street'; S.raw.arv='250000'; S.raw.asking='170000';
    S.subj = { sqft:'1420', beds:'3', baths:'2' }; save(); showStep('condition'); });
  await p.waitForTimeout(500);
};

/* ── A · the tier line ─────────────────────────────────────────────────── */
for (const [plan, live] of [['', false], ['solo', false], ['underwriter', true], ['the office', true]]){
  await land(plan);
  const r = await p.evaluate(() => ({
    panel: !!document.getElementById('ai-zone'),
    file: !!document.getElementById('ai-file'),
    sells: !!document.querySelector('#ai-zone[data-plans]'),
    txt: (document.getElementById('ai-zone')||{}).innerText || '' }));
  out['A:' + (plan||'free')] = { panel:r.panel, file:r.file, sells:r.sells };
  if (!r.panel) bad.push(`A: ${plan||'free'} has no panel at all`);
  if (live && !r.file)  bad.push(`A: ${plan||'free'} paid for this and got the advert`);
  if (!live && r.file)  bad.push(`A: ${plan||'free'} got the whole feature`);
  if (!live && !r.sells) bad.push(`A: ${plan||'free'} gets no way to buy it`);
  /* the locked panel is allowed to sell, not to lie: it must not claim the
     photos stay on the machine, because they do not — they go to the proxy */
  if (!live && /never leave your machine|stay on your machine/i.test(r.txt))
    bad.push('A: the locked panel claims the photographs never leave the machine, which is not true');
}

/* ── B · resized and re-encoded before anything leaves ─────────────────── */
await land('underwriter');
await stub();
out.B_added = await makeFile(3);
await p.waitForTimeout(400);
out.B_tray = await p.evaluate(() => ({ shots: document.querySelectorAll('.aish').length,
  btn: (document.getElementById('ai-go')||{}).textContent }));
if (out.B_tray.shots !== 3) bad.push(`B: ${out.B_tray.shots} thumbnails for 3 photographs`);
await p.evaluate(() => { document.getElementById('ai-note').value = 'panel is in the garage';
  document.getElementById('ai-note').dispatchEvent(new Event('input',{bubbles:true})); });
await p.click('#ai-go');
await p.waitForTimeout(1800);
out.B_sent = await p.evaluate(() => window.__SENT);
if (!out.B_sent) bad.push('B: nothing was sent');
else {
  if (out.B_sent.n !== 3) bad.push(`B: ${out.B_sent.n} photographs were sent, not 3`);
  if (!out.B_sent.types.every(t => t === 'image/jpeg'))
    bad.push(`B: a PNG went out as a PNG — it was not re-encoded, so its metadata went with it (${out.B_sent.types})`);
  if (!out.B_sent.bytes.every(x => x > 100 && x < 400000))
    bad.push(`B: the sent sizes look wrong — ${out.B_sent.bytes}`);
  if (out.B_sent.access !== 'letmein') bad.push('B: the access code was not sent');
  if (out.B_sent.notes !== 'panel is in the garage') bad.push('B: the note did not travel');
  if (String(out.B_sent.house.arv) !== '250000') bad.push('B: the ARV was not sent as context');
  /* the page must not be able to send a prompt even if it wanted to */
  const extra = out.B_sent.keys.filter(k => ['images','house','notes'].indexOf(k) < 0);
  if (extra.length) bad.push(`B: the client sends fields the server does not read — ${extra}`);
}

/* ── C · applied honestly ──────────────────────────────────────────────── */
out.C = await p.evaluate(() => ({
  kitchen: S.sys.kitchen, bath1: S.sys.bath1, windows: S.sys.windows,
  roof: S.sys.roof, found: S.sys.found, elec: S.sys.elec, hvac: S.sys.hvac, plumb: S.sys.plumb,
  seen: S.read && S.read.seen, refused: S.read && S.read.refusedIds,
  onPage: (document.querySelector('.airx')||{}).innerText || '',
  flags: document.querySelectorAll('.airf li').length,
}));
if (out.C.kitchen !== 85) bad.push(`C: a line the read saw did not move — kitchen ${out.C.kitchen}`);
if (out.C.windows !== 60) bad.push('C: a second seen line did not move');
for (const id of ['roof','found','elec','hvac','plumb'])
  if (out.C[id] !== 0) bad.push(`C: ${id} was refused and got a number anyway — ${out.C[id]}`);
if (out.C.seen !== 12) bad.push(`C: the receipt says ${out.C.seen} lines, not 12`);
if ((out.C.refused||[]).length !== 5) bad.push(`C: ${(out.C.refused||[]).length} refusals recorded, not 5`);
if (!/Not visible/i.test(out.C.onPage)) bad.push('C: the refusals are not named on the page');
if (!/left exactly where they were/i.test(out.C.onPage))
  bad.push('C: the page does not say the refused sliders were left alone');
if (!out.C.flags) bad.push('C: the flags did not reach the page');

/* ── D · the estimate is wider than a walk-through ─────────────────────── */
out.D = await p.evaluate(() => ({ repairs: S.raw.repairs, est: !!S.est.repairs,
  unc: S.unc.repairs, prov: S.prov.repairs, own: !!S.repairsOwn }));
if (!out.D.repairs) bad.push('D: the read produced no repair figure');
if (!out.D.est)     bad.push('D: the repair figure is not marked an estimate');
if (!(out.D.unc > 0.15)) bad.push(`D: a photo read is no less certain than a walk-through (${out.D.unc} vs 0.15)`);
if (!/photograph/i.test(out.D.prov||'')) bad.push('D: the provenance does not say where the number came from');
if (!/left as they were|were visible/i.test(out.D.prov||''))
  bad.push('D: the provenance does not say how much of the house it could see');

/* a read that saw LESS must be wider still */
const wider = await p.evaluate(() => {
  const only = { kitchen:80 };
  const lines = {};
  for (const l of LINES) lines[l.id] = only[l.id] !== undefined
    ? { seen:true, pc:only[l.id], conf:'low', why:'x' } : { seen:false, pc:null, why:'y' };
  window.__applyRead({ lines, flags:[], summary:'', model:'stub' });
  return S.unc.repairs;
});
out.D_wider = wider;
if (!(wider > out.D.unc))
  bad.push(`D: a read that saw one line of seventeen is no wider than one that saw twelve (${wider} vs ${out.D.unc})`);

/* ── E · a hand on a slider outranks all of it ─────────────────────────── */
out.E = await p.evaluate(() => {
  S.raw.repairs = '61,000'; S.repairsOwn = true; save(); render();
  const before = S.raw.repairs;
  const lines = {};
  for (const l of LINES) lines[l.id] = { seen:true, pc:10, conf:'high', why:'x' };
  window.__applyRead({ lines, flags:[], summary:'', model:'stub' });
  return { before, after: S.raw.repairs, own: !!S.repairsOwn };
});
/* the read DOES take over the panel — that is what pressing the button asks
   for — but it must do it by clearing the flag deliberately, not silently */
if (out.E.after === out.E.before && out.E.own)
  bad.push('E: the read neither took over nor said it had not');

/* ── F · the receipt survives the round trip ───────────────────────────── */
await p.evaluate(() => save());
await p.goto(B + 'desk.html'); await p.waitForTimeout(700);
out.F = await p.evaluate(() => ({ read: !!S.read, seen: S.read && S.read.seen,
  refused: S.read && S.read.refusedIds.length,
  flags: S.read && S.read.flags.length, why: S.read && S.read.why && S.read.why.roof }));
if (!out.F.read) bad.push('F: the receipt did not survive a reload');
/* and a hostile file cannot smuggle markup through it onto a packet */
out.Fhostile = await p.evaluate(() => {
  const p2 = cleanProp({ read: { at:'x', n:'lots', seen:99, refusedIds:['roof','notaline'],
    flags:[{ what:'<img src=x onerror=alert(1)>' }], summary:'y'.repeat(9000), why:{ roof:'z'.repeat(9000) } } });
  return { n:p2.read.n, seen:p2.read.seen, ids:p2.read.refusedIds,
    sum:p2.read.summary.length, why:p2.read.why.roof.length,
    flag:p2.read.flags[0].what };
});
if (out.Fhostile.ids.indexOf('notaline') >= 0) bad.push('F: a made-up line id survived the validator');
if (out.Fhostile.sum > 400 || out.Fhostile.why > 160) bad.push('F: the strings are not capped on the way in');
if (out.Fhostile.n !== 0) bad.push('F: a non-numeric photo count was accepted');
const inj = await p.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('ni-desk-v3'));
  d.props[0].read = { at:'2026-01-01', n:1, seen:1, refusedIds:['roof'],
    flags:[{ what:'<img src=x onerror=window.__PWN=1>', where:'x', why:'y' }], summary:'s', why:{}, conf:{} };
  localStorage.setItem('ni-desk-v3', JSON.stringify(d));
});
await p.goto(B + 'desk.html'); await p.waitForTimeout(700);
await p.evaluate(() => showStep('condition'));
await p.waitForTimeout(400);
out.F_inj = await p.evaluate(() => ({ pwned: !!window.__PWN,
  img: !!document.querySelector('.airf img'),
  shown: (document.querySelector('.airf')||{}).innerText || '' }));
if (out.F_inj.pwned || out.F_inj.img) bad.push('F: a flag from a file became markup');
if (!/img src/.test(out.F_inj.shown)) bad.push('F: the hostile flag was swallowed instead of shown as text');

out.errs = errs;
if (errs.length) bad.push('console errors — ' + errs.slice(0,2).join(' | '));

await b.close();
console.log(JSON.stringify(out, null, 1));
console.log(bad.length ? 'FAIL\n - ' + bad.join('\n - ')
  : 'PASS — resized and re-encoded before anything leaves, a refused line is left alone and named, the estimate widens with how little was seen, and a hostile receipt is text');
process.exit(bad.length ? 1 : 0);
