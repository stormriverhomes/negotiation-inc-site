/* t-cond — the condition panel and the repair figure.

   The previous version of this file clicked a "carry it over" button that no
   longer exists, because the panel no longer asks: pressing a preset writes
   the number straight onto the sheet. The button survived for exactly one
   case — when somebody has TYPED a repair figure of their own, the panel must
   not silently overwrite it, so it offers instead. That distinction is the
   whole behaviour worth testing, and it is what this now tests.

     A · a preset moves every one of the seventeen lines and lands a figure
     B · the figure that lands is the panel's total, to the dollar
     C · a typed bid outranks the panel, and the panel offers rather than
         overwriting
     D · taking the panel's number back is one press, and it persists */
import { chromium } from 'playwright';

const B = 'file:///home/claude/dist/';
const b = await chromium.launch();
const out = {}; const bad = []; const errs = [];
const p = await b.newPage({ viewport:{ width:1280, height:1000 } });
p.on('pageerror', e => errs.push(String(e)));
p.on('console', m => { if (m.type() === 'error' && !/fraunces|ERR_FAILED/.test(m.text())) errs.push(m.text()); });

const num = s => (s === null || s === undefined) ? null : +String(s).replace(/[^0-9.]/g, '');

await p.goto(B + 'desk.html');
await p.evaluate(() => localStorage.clear());
await p.goto(B + 'desk.html'); await p.waitForTimeout(600);
await p.evaluate(() => showStep('property'));
await p.fill('[data-f="arv"]', '250000'); await p.press('[data-f="arv"]', 'Tab');
await p.waitForTimeout(300);
await p.evaluate(() => showStep('condition')); await p.waitForTimeout(350);

/* ── A · a preset moves everything ─────────────────────────────────────── */
out.A0 = await p.evaluate(() => ({ set: Object.values(S.sys).filter(v => v > 0).length,
  repairs: S.raw.repairs || null }));
await p.click('[data-preset="medium"]'); await p.waitForTimeout(450);
out.A = await p.evaluate(() => ({ set: Object.values(S.sys).filter(v => v > 0).length,
  lines: LINES.length, repairs: S.raw.repairs || null,
  total: (document.getElementById('cond-total')||{}).textContent || null }));
if (out.A0.set !== 0)          bad.push('A: the sheet did not start empty');
if (out.A.set !== out.A.lines) bad.push(`A: a preset set ${out.A.set} of ${out.A.lines} lines`);
if (!out.A.repairs)            bad.push('A: pressing a preset left the repair field empty');

/* ── B · to the dollar ─────────────────────────────────────────────────── */
out.B = { field: num(out.A.repairs), panel: num(out.A.total) };
if (Math.abs(out.B.field - out.B.panel) > 500)
  bad.push(`B: the sheet says ${out.B.field} and the panel says ${out.B.panel}`);

/* ── C · a typed bid outranks the panel ────────────────────────────────── */
/* the repair field lives on the condition step, beside the panel that argues
   with it — which is the whole point of the layout */
await p.fill('[data-f="repairs"]', '61000'); await p.press('[data-f="repairs"]', 'Tab');
await p.waitForTimeout(450);
await p.click('[data-preset="light"]'); await p.waitForTimeout(450);
out.C = await p.evaluate(() => ({ own: !!S.repairsOwn, repairs: S.raw.repairs,
  offers: !document.getElementById('cond-go').hidden,
  says: (document.getElementById('cond-go').textContent || '').trim() }));
if (!out.C.own)                   bad.push('C: a typed repair figure did not mark itself as yours');
if (num(out.C.repairs) !== 61000) bad.push(`C: the panel overwrote a typed bid — ${out.C.repairs}`);
if (!out.C.offers)                bad.push('C: the panel disagrees with the sheet and says nothing about it');

/* ── D · and taking the panel's number back is one press ───────────────── */
await p.click('#cond-go'); await p.waitForTimeout(500);
out.D = await p.evaluate(() => ({ own: !!S.repairsOwn, repairs: S.raw.repairs,
  saved: (() => { try { return JSON.parse(localStorage.getItem('ni-desk-v3')).props[0].f.repairs.v; }
    catch(e){ return 'unreadable'; } })() }));
if (out.D.own)                    bad.push('D: taking the panel back left the sheet still flagged as typed');
if (num(out.D.repairs) === 61000) bad.push('D: the press did nothing');
if (num(out.D.saved) !== num(out.D.repairs))
  bad.push(`D: the change was not written down — ${out.D.saved} on disk, ${out.D.repairs} on screen`);

out.errs = errs;
if (errs.length) bad.push('console errors — ' + errs.slice(0,2).join(' | '));

await b.close();
console.log(JSON.stringify(out, null, 1));
console.log(bad.length ? 'FAIL\n - ' + bad.join('\n - ')
  : 'PASS — a preset lands the panel total on the sheet, a typed bid outranks it, and taking the panel back is one press that persists');
process.exit(bad.length ? 1 : 0);
