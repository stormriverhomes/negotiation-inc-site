/* t-data — the two sentences on the privacy page that were not yet true.
     "From the account panel, one click gives you a file containing every sheet,
      comp, note and assumption you have. It is plain readable JSON, not a
      locked format, and it is yours to take elsewhere."
     "Delete everything. Also from the account panel."
   A privacy page describing a control that does not exist is the exact thing
   regulators treat as a deceptive practice. These are the tests that keep the
   page honest — and the delete test is the one that matters, because a delete
   that leaves the sheets behind is worse than no delete at all. */
import { chromium } from 'playwright';

const B = 'file:///home/claude/dist/';
const b = await chromium.launch();
const out = {}; const bad = [];
const NOISE = /fraunces\.woff2|ERR_FAILED/;

const seed = () => {
  localStorage.clear();
  localStorage.setItem('ni-account-v1', JSON.stringify({name:'Elijah', email:'e@x.com', plan:'underwriter', trial:null}));
  const mk = (n,ask,arv,rep) => ({ name:n, addr:n, mode:'simple', comps:[{},{}], sit:'estate',
    sys:{}, subj:{}, compAdj:{}, f:{ asking:{v:ask}, arv:{v:arv}, repairs:{v:rep} } });
  localStorage.setItem('ni-desk-v3', JSON.stringify({ active:0, props:[
    mk('1104 Elm','168000','249000','46000'), mk('88 Ostend','132000','196000','38000') ]}));
  localStorage.setItem('ni-exits-v1', JSON.stringify({ ex:2, seen:[0,1] }));
  localStorage.setItem('ni-drill-best', '1740');
};

for (const page of ['desk.html', 'office.html']){
  const p = await b.newPage({ viewport:{width:1400,height:1000} });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(m.text()); });
  await p.goto(B + page);
  await p.evaluate(seed);
  await p.goto(B + page); await p.waitForTimeout(900);
  await p.click('#rn-who'); await p.waitForTimeout(300);

  const panel = await p.evaluate(() => ({
    exp: !!document.getElementById('ac-exp'),
    del: !!document.getElementById('ac-del'),
    out: !!document.getElementById('ac-out'),
    note: (document.getElementById('ac-note')||{}).textContent || null }));
  out[page + ':panel'] = panel;
  if (!panel.exp) bad.push(`${page}: the privacy page promises an export and there is no button`);
  if (!panel.del) bad.push(`${page}: the privacy page promises a delete and there is no button`);

  /* the export actually writes a file, and the file is readable JSON */
  const dl = p.waitForEvent('download', { timeout: 6000 }).catch(() => null);
  await p.click('#ac-exp');
  const d = await dl;
  out[page + ':export'] = d ? { name: d.suggestedFilename() } : null;
  if (!d) bad.push(`${page}: pressing export produced no file`);
  else {
    const path = await d.path();
    const txt = (await import('fs')).readFileSync(path, 'utf8');
    let j = null; try { j = JSON.parse(txt); } catch(e){}
    out[page + ':file'] = j ? { props: (j.props||[]).length, keys: Object.keys(j) } : 'unparseable';
    if (!j) bad.push(`${page}: the export is not readable JSON`);
    else if ((j.props||[]).length !== 2) bad.push(`${page}: the export lost sheets — ${(j.props||[]).length} of 2`);
    else if (!/1104 Elm/.test(txt)) bad.push(`${page}: the export does not contain the work`);
  }

  /* delete arms first — there is no undo and it sits beside "export" */
  await p.click('#ac-del'); await p.waitForTimeout(200);
  const armed = await p.evaluate(() => ({
    txt: document.getElementById('ac-del').textContent,
    armed: document.getElementById('ac-del').classList.contains('armed'),
    stillThere: !!localStorage.getItem('ni-desk-v3') }));
  out[page + ':armed'] = armed;
  if (!armed.armed) bad.push(`${page}: delete fires on the first press`);
  if (!armed.stillThere) bad.push(`${page}: the first press already deleted the sheets`);
  if (!/\?$/.test(armed.txt.trim())) bad.push(`${page}: the armed delete does not ask`);

  /* and the second press takes everything, not just the login */
  await p.click('#ac-del'); await p.waitForTimeout(900);
  const gone = await p.evaluate(() => ({
    keys: Object.keys(localStorage),
    acct: localStorage.getItem('ni-account-v1'),
    sheets: localStorage.getItem('ni-desk-v3'),
    drill: localStorage.getItem('ni-drill-best') }));
  out[page + ':deleted'] = gone;
  if (gone.acct || gone.sheets || gone.drill)
    bad.push(`${page}: delete left data behind — ${JSON.stringify(gone.keys)}`);

  out[page + ':errs'] = errs;
  if (errs.length) bad.push(`${page}: console errors — ${errs.slice(0,2).join(' | ')}`);
  await p.close();
}

/* ── the import: a file you exported must load back in, and a hostile one
      must not get past the same typing every record off disk goes through ── */
{
  const p = await b.newPage({ viewport:{width:1400,height:1000} });
  await p.goto(B + 'desk.html');
  await p.evaluate(seed);
  await p.goto(B + 'desk.html'); await p.waitForTimeout(900);
  /* the panel is a toggle; open it and make sure it stayed open */
  for (let k = 0; k < 3; k++){
    if (await p.evaluate(() => !!document.getElementById('ac-file'))) break;
    await p.click('#rn-who'); await p.waitForTimeout(350);
  }
  out.panelOpen = await p.evaluate(() => ({ file: !!document.getElementById('ac-file'),
    acct: !!document.getElementById('rn-acct'),
    hidden: (document.getElementById('rn-acct')||{}).hidden }));
  if (!out.panelOpen.file) bad.push('import: the account panel would not open: ' + JSON.stringify(out.panelOpen));
  const good = JSON.stringify({ props: [
    { name:'Imported One', addr:'12 Somewhere', f:{ asking:{v:'99000'}, arv:{v:'180000'} } },
    { name:'<img src=x onerror=alert(1)>', addr:'x', f:{ asking:{v:'50000'} } } ]});
  if (out.panelOpen.file) await p.setInputFiles('#ac-file', { name:'sheets.json', mimeType:'application/json',
    buffer: Buffer.from(good) });
  await p.waitForTimeout(900);
  out.imported = await p.evaluate(() => ({
    n: P.props.length,
    names: P.props.map(x => x.name),
    note: (document.getElementById('ac-note')||{}).textContent || null,
    /* the hostile name must be text on the page, never markup */
    injected: !!document.querySelector('.ptab img, .rn-p img') }));
  if (out.imported.n !== 4) bad.push('import: the file did not load — ' + out.imported.n + ' of 4');
  if (!out.imported.names.includes('Imported One')) bad.push('import: the sheet did not arrive');
  if (out.imported.injected) bad.push('import: a name from a file became markup');

  /* nonsense must be refused, and refused out loud */
  if (out.panelOpen.file) await p.setInputFiles('#ac-file', { name:'junk.json', mimeType:'application/json',
    buffer: Buffer.from('not json at all') });
  await p.waitForTimeout(600);
  out.junk = await p.evaluate(() => ({ n: P.props.length,
    note: (document.getElementById('ac-note')||{}).textContent || null }));
  if (out.junk.n !== 4) bad.push('import: junk changed the workspace');
  if (!/not a sheets file/i.test(out.junk.note || '')) bad.push('import: junk was swallowed silently');
  await p.close();
}

await b.close();
console.log(JSON.stringify(out, null, 1));
console.log(bad.length ? 'FAIL\n - ' + bad.join('\n - ')
  : 'PASS — export writes the work, import types it on the way in, and delete takes everything it says it takes');
process.exit(bad.length ? 1 : 0);
