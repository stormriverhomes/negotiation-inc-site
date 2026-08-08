/* ══ THE CONDITION PANEL, AUDITED ═══════════════════════════════════════════
   Seventeen sliders produce ONE figure — repairs — and every ceiling on the
   sheet is that figure subtracted from something. It is the second-highest
   consequence arithmetic in the product after the comps, and it carried six
   assertions.

   Invariants, not examples. The bug this catches is not "the total is wrong on
   this house", it is "the total behaves wrongly for every house". */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve('desk.html');
let n = 0, bad = 0;
const ok = (t, p, x) => { n++; if (!p){ bad++; console.log('✗ ' + t + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0,240) : '')); } else console.log('✓ ' + t); };

const b = await chromium.launch();
const pg = await b.newPage({ viewport:{ width:1400, height:1100 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0,150)));
await pg.goto(FILE);
await pg.waitForFunction(() => typeof LINES !== 'undefined' && typeof condTotalOf === 'function',
  null, { timeout:20000 });

const IDS = await pg.evaluate(() => LINES.map(l => l.id));
/* set every slider to pc, or a named map, and read what the panel produces */
const run = (pc, arv = '300000', over = {}) => pg.evaluate(([p, a, o]) => {
  P.props.length = 0; P.props.push(newProp('cond')); P.active = 0; loadInto(0);
  S.raw = { arv:a }; S.est = {}; S.unc = {}; S.prov = {}; S.repairsOwn = false;
  S.sys = Object.fromEntries(LINES.map(l => [l.id, typeof p === 'number' ? p : (p[l.id] ?? 0)]));
  Object.assign(S.sys, o);
  syncRepairs();
  return { total: condTotalOf(Number(a)), raw: S.raw.repairs, est: S.est.repairs,
           unc: S.unc.repairs, prov: S.prov.repairs || '', own: S.repairsOwn };
}, [pc, arv, over]);

/* ── 1 · SOUND IS ZERO, AND ZERO IS A KNOWN FIGURE ────────────────────────
   A user found this one before we did: clearing a sound house to EMPTY made
   the flip refuse for want of a repair number, and the ceiling landed on the
   same figure heavy condition gave. A sound house is the best flip on the
   board and must show the highest ceiling. */
{
  const r = await run(0);
  ok('sound: every system sound totals nothing', r.total === 0, r.total);
  /* syncRepairs() alone deliberately does NOT write the zero on a fresh sheet —
     an untouched sheet must stay NEEDED. The affirmative press is what makes it
     a zero, so the real path is the preset, and that is what gets tested. */
  const press = await pg.evaluate(() => {
    P.props.length = 0; P.props.push(newProp('cond')); P.active = 0; loadInto(0);
    S.raw = { arv:'300000' }; S.est = {}; S.unc = {}; S.prov = {}; S.repairsOwn = false;
    S.sys = Object.fromEntries(LINES.map(l => [l.id, 0]));
    render();
    const el = [...document.querySelectorAll('button')]
      .find(x => /sound|nothing needed/i.test(x.textContent || ''));
    if (!el) return { missing:true };
    el.click();
    return { raw:S.raw.repairs, est:S.est.repairs, prov:S.prov.repairs || '' };
  });
  ok('sound: the "nothing needed" press exists to be pressed', !press.missing, press);
  ok('sound: and it WRITES the zero rather than leaving the field needed',
     press.raw === '0', press.raw);
  ok('sound: pressing "nothing needed" and getting back "needed" would be the sheet '
     + 'contradicting the user', press.est === true && /nothing to do|sound/.test(press.prov), press.prov);
}

/* ── 2 · MONOTONIC IN EVERY SINGLE LINE ───────────────────────────────────
   Seventeen sliders, each of which must only ever add. One inverted sign in
   one line would be invisible: the total still moves, just the wrong way for
   one system out of seventeen. */
{
  const base = (await run(0)).total;
  const wrong = [];
  for (const id of IDS){
    const half = (await run(0, '300000', { [id]: 50 })).total;
    const full = (await run(0, '300000', { [id]: 100 })).total;
    if (!(half >= base)) wrong.push({ id, base, half });
    if (!(full >= half))  wrong.push({ id, half, full });
    if (full === base)    wrong.push({ id, note:'this slider changes nothing at all' });
  }
  ok('lines: all ' + IDS.length + ' sliders only ever add, and every one of them does something',
     wrong.length === 0, wrong.slice(0,4));
}

/* ── 3 · THE TOTAL SCALES WITH THE HOUSE ──────────────────────────────────
   Every line is a share of ARV, so doubling the ARV must double the work. If
   it did not, the panel would be pricing a mansion's roof like a bungalow's. */
{
  const a = (await run(60, '200000')).total, c = (await run(60, '400000')).total;
  ok('scale: twice the house is twice the work', Math.abs(c - 2*a) <= Math.max(600, a*0.03),
     { at200k:a, at400k:c });
  ok('scale: and no house has negative work', (await run(0, '50000')).total >= 0);
}

/* ── 4 · A FULL GUT IS A PLAUSIBLE SHARE OF THE HOUSE ─────────────────────
   Every line at 100 is the worst house on the street. If that came to 8% of
   ARV the panel would be useless, and if it came to 200% it would refuse every
   deal on the board. */
{
  const worst = (await run(100, '300000')).total;
  const pc = worst / 300000;
  ok('gut: everything at its worst is a serious but plausible share of the house',
     pc > 0.25 && pc < 0.90, { total:worst, share:+(pc*100).toFixed(1)+'%' });
}

/* ── 5 · THE FIGURE IS AN ESTIMATE, AND IT SAYS SO ────────────────────────
   It is derived from sliders, not from a bid. Presenting it as ENTERED would
   be the sheet claiming a confidence nobody gave it. */
{
  const r = await run(55);
  ok('provenance: a panel-derived repair figure is marked an estimate', r.est === true, r.est);
  ok('provenance: with a real uncertainty on it', typeof r.unc === 'number' && r.unc > 0, r.unc);
  ok('provenance: and a sentence naming the panel', /condition panel/.test(r.prov), r.prov);
}

/* ── 6 · A FIGURE THE PERSON TYPED OUTRANKS THE PANEL ─────────────────────
   The rule the whole product runs on. syncRepairs() must not overwrite a
   number somebody typed. */
{
  const held = await pg.evaluate(() => {
    P.props.length = 0; P.props.push(newProp('cond')); P.active = 0; loadInto(0);
    S.raw = { arv:'300000', repairs:'12,345' }; S.est = {}; S.unc = {}; S.prov = {};
    S.repairsOwn = true;                       // they typed it
    S.sys = Object.fromEntries(LINES.map(l => [l.id, 80]));
    const moved = syncRepairs();
    return { moved, raw: S.raw.repairs, est: S.est.repairs };
  });
  ok('ownership: the panel does not overwrite a repair figure they typed',
     held.raw === '12,345' && held.moved === false, held);
  ok('ownership: and does not demote it to an estimate', !held.est, held.est);
}

/* ── 7 · THE ROUNDING IS DONE ONCE ────────────────────────────────────────
   Rounded in two places is two different numbers on one sheet — the panel
   saying one thing and the ledger another about the same house. */
{
  const r = await run(37, '287500');
  const parsed = Number(String(r.raw).replace(/[^0-9.]/g,''));
  ok('rounding: the written figure and the computed total are the same number',
     Math.abs(parsed - r.total) < 1, { written:r.raw, computed:r.total });
}

/* ── 8 · IT SURVIVES THE HOSTILE SLIDER ───────────────────────────────────
   localStorage is writable by anything that ever ran on this origin. */
{
  const hostile = await pg.evaluate(() => {
    P.props.length = 0; P.props.push(newProp('cond')); P.active = 0; loadInto(0);
    S.raw = { arv:'300000' }; S.est = {}; S.unc = {}; S.prov = {}; S.repairsOwn = false;
    S.sys = Object.fromEntries(LINES.map(l => [l.id, 0]));
    /* the real defence is cleanProp() on the way in, so drive THAT — and then
       hit the pure function directly too, because it is used in five places
       and none of them should be able to make it print $NaN */
    const dirty = cleanProp({ id:'abc123', sys:{ roof:5000, found:-900, hvac:NaN, plumb:'lots' } });
    const viaClean = Object.values(dirty.sys).every(v => typeof v === 'number' && v >= 0 && v <= 100);
    S.sys.roof = 5000; S.sys.found = -900; S.sys.hvac = NaN; S.sys.plumb = 'lots';
    const t = condTotalOf(300000);
    return { viaClean, t, finite: Number.isFinite(t) };
  });
  ok('hostile: a tampered store is scrubbed to real percentages on the way in', hostile.viaClean, hostile);
  ok('hostile: and the total is finite even if something reaches it unscrubbed', hostile.finite, hostile);
  ok('hostile: and it is not negative', hostile.t >= 0, hostile.t);
  ok('hostile: nor larger than the house', hostile.t <= 300000, hostile.t);
}

ok('no page errors', errs.length === 0, [...new Set(errs)]);
await b.close();
console.log('\n' + (bad ? '✗ ' + bad + ' of ' + n + ' failed' : '✓ all ' + n + ' hold'));
process.exit(bad ? 1 : 0);
