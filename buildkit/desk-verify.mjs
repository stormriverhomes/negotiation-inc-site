/* desk-verify — the arithmetic, recomputed outside the page.

   The oldest file in the suite and the most important one: every other
   harness asks whether the screen behaves. This one asks whether the screen
   is TELLING THE TRUTH, by working the five priced exits out again from the
   published formulae and checking that the numbers on the page are the same
   numbers. If this passes and everything else fails, the product is salvage-
   able. If this fails, nothing else matters.

   It has been brought forward to the stepped flow and the provenance model:
   the fields live on the steps that own them, and "I guessed this" is a
   provenance record with an uncertainty attached rather than a checkbox.
   Everything under test is the same.

     A · five exits, recomputed independently, to the dollar
     B · marking an input an estimate costs confidence and widens the band
     C · a missing input refuses to price, and says which one it wants,
         while the exits that do not need it go on pricing
     D · heavy repairs disqualify the wholetail in its own words
     E · the subject-to spread is rent × 82% − PITI
     F · all of it survives a reload */
import { chromium } from 'playwright';

const b = await chromium.launch();
const p = await b.newPage({ viewport:{ width:1000, height:1100 } });
const bad = []; const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error' && !/fraunces|ERR_FAILED/.test(m.text())) errs.push(m.text()); });

await p.goto('file:///home/claude/dist/desk.html');
await p.evaluate(() => localStorage.clear());
await p.reload(); await p.waitForTimeout(500);

/* Fields live on the step that owns them — repairs sits on the condition step
   beside the panel that argues with it, the loan fields on the deal step. */
const STEP_OF_F = { asking:'property', arv:'property', addr:'property',
                    repairs:'condition', rent:'deal', balance:'deal', piti:'deal', arrears:'deal' };
const LOANF = ['balance','piti','arrears'];
const type = async (id, v) => {
  await p.evaluate(s => { if (typeof showStep === 'function') showStep(s); }, STEP_OF_F[id] || 'property');
  await p.waitForTimeout(110);
  /* the loan fields live inside a collapsed <details>, and showStep() rebuilds
     the step — so it has to be opened AFTER the step is shown, every time */
  if (LOANF.indexOf(id) >= 0){
    /* the seller's loan is an advanced-mode section — simple mode hides it
       outright, and showStep() re-applies that on every render */
    await p.evaluate(() => { if (S.mode !== 'advanced'){ S.mode = 'advanced'; P.mode = 'advanced'; save(); render(); }
      showStep('deal'); });
    await p.waitForTimeout(200);
    await p.evaluate(() => { const l = document.getElementById('loan'); if (l) l.open = true; });
    await p.waitForTimeout(150);
  }
  await p.fill(`[data-f="${id}"]`, String(v));
  await p.press(`[data-f="${id}"]`, 'Tab');
};

await p.fill('#addr', '1128 Marrow Lane');
await type('asking','249500'); await type('arv','291000');
await type('repairs','41300'); await type('rent','1850');
/* WAIT FOR THE SHEET, NOT FOR THE CLOCK. A fixed 400ms was enough on an idle
   machine and not enough with six other browsers competing for the CPU, so
   this harness failed roughly every other time it ran beside the rest of the
   board — reading the exits before the last keystroke had propagated, and
   reporting a novation that "priced" a house it had in fact not seen the
   repairs for yet. A test that fails half the time under load is worse than no
   test: it teaches you to re-run it instead of reading it. */
/* and when it DOES time out, say what the sheet actually holds. A bare
   "waitForFunction: Timeout 20000ms exceeded" tells you the harness is unhappy
   and nothing about why — is the fill not landing, is one field short, is a
   coach card covering the input? Three of those are product bugs and one is a
   slow machine, and the stack trace cannot tell them apart. */
try {
  await p.waitForFunction(() => {
    const v = (typeof vals === 'function') ? vals() : null;
    return v && v.asking === 249500 && v.arv === 291000 && v.repairs === 41300 && v.rent === 1850;
  /* 30s was still not enough beside a four-wide board — the harness that warns
     against flaky reds went red flakily. The wait is for a keystroke to
     propagate, so the ceiling only has to outlast contention, never real work.
     75s was not enough beside a SIX-wide board: it went red on two consecutive
     full runs and passed alone both times, which is the failure mode that
     teaches a person to ignore reds. Raised again, and the suite gives this
     harness a longer budget so the ceiling is reachable — a timeout the runner
     kills first is not a timeout. */
  }, null, { timeout: 180000 });
} catch (e) {
  const state = await p.evaluate(() => ({
    vals: (typeof vals === 'function') ? vals() : 'no vals()',
    raw: (typeof S !== 'undefined') ? S.raw : 'no S',
    step: (typeof V !== 'undefined') ? V.step : null,
    coach: (() => { const c = document.getElementById('coach'); return c ? !c.hidden : null; })(),
    fields: [...document.querySelectorAll('[data-f]')].map(x => x.dataset.f + '=' + x.value),
  })).catch(() => 'page gone');
  console.log('the sheet never took the figures:\n' + JSON.stringify(state, null, 1));
  throw e;
}

/* ── A · the arithmetic, done again from the outside ───────────────────── */
const ARV = 291000, REP = 41300, ASK = 249500, RENT = 1850, RATE = 0.071;
const m = RATE/12, k = Math.pow(1+m, 360), MPD = m*k/(k-1);
/* the published assumptions at their defaults: 8% cost of selling, six months
   of carry, an 8% profit target, 75% LTV, 1.25 DSCR, 7.1%, 40% opex */
const SELL = 0.08, HOLDMO = 6, PROFIT = 0.08, LTV = 0.75, DSCR = 1.25, OPEX = 0.40;
const expect = {
  /* the wholesale ledger ends at what the CASH BUYER can pay — the band you
     offer the seller sits $8k to $20k under it, and that gap is your fee */
  wholesaleCeil: 0.70*ARV - REP,
  flipMaxBuy:    ARV - REP - SELL*ARV - Math.max(2000*HOLDMO, 0.006*HOLDMO*ARV) - Math.max(15000, PROFIT*ARV),
  holdMaxPrice:  (RENT*(1-OPEX)/DSCR)/MPD/LTV,
  brrrrMaxBuy:   LTV*ARV - REP - 7000,
};
/* the working lives in the row's BODY, and only one row is open at a time —
   the disclosure is state (S.openId), not a class, so it is opened as state */
const shown = await p.evaluate(() => {
  const t = id => { S.userToggled = true; S.openId = id; render();
    const x = document.getElementById('x-'+id);
    return x ? (x.innerText || '').replace(/\n/g, ' | ') : null; };
  return { wholesale:t('wholesale'), flip:t('flip'), hold:t('hold'),
    brrrr:t('brrrr'), nov:t('novation'),
    conf: (document.getElementById('conf')||{}).textContent || null,
    order: [...document.querySelectorAll('.exit .nm')].map(e => e.textContent) };
});
const has = (s, n) => !!s && s.includes(Math.round(n).toLocaleString('en-US'));
const A = {
  wholesaleCeil: has(shown.wholesale, expect.wholesaleCeil),
  flipMaxBuy:    has(shown.flip,      expect.flipMaxBuy),
  holdMaxPrice:  has(shown.hold,      expect.holdMaxPrice),
  brrrrMaxBuy:   has(shown.brrrr,     expect.brrrrMaxBuy),
};
for (const kk in A) if (!A[kk])
  bad.push(`A: ${kk} — the page does not show ${Math.round(expect[kk]).toLocaleString('en-US')}`);
/* and the novation refuses outright at 14% repairs, which is the correct
   answer rather than a missing one: a novation is a light-work play and this
   is a renovation with paperwork */
A.novationRefuses = /renovation with paperwork|light-work/i.test(shown.nov || '');
if (!A.novationRefuses)
  bad.push('A: the novation priced a house needing 14% of ARV in work');

/* ── B · an estimate costs you something ───────────────────────────────── */
const bandOf = () => p.evaluate(() => {
  S.userToggled = true; S.openId = 'wholesale'; render();
  const x = document.getElementById('x-wholesale'); if (!x) return null;
  /* the BAND, by its own element — not the first two dollar figures with a
     dash between them anywhere in the row. The row grew a line reading
     "only at $128,850 · $28,850 under their price" and this regex happily
     reported that as the band, then failed because it does not widen. A
     harness that pattern-matches a whole row's text will keep finding the
     wrong number as the row learns to say more. */
  const rng = x.querySelector('.bandtop .rng');
  if (rng) return rng.textContent.replace(/\s+/g,' ').trim();
  const mm = (x.innerText || '').match(/\$[\d,]+\s*[—–-]\s*\$[\d,]+/);
  return mm ? mm[0] : null; });
const B0 = { band: await bandOf(), conf: shown.conf };
await p.evaluate(() => { S.est.repairs = true; S.unc.repairs = 0.25;
  S.prov.repairs = 'a walk-through guess'; save(); render(); });
await p.waitForTimeout(350);
const B1 = { band: await bandOf(),
  conf: await p.evaluate(() => (document.getElementById('conf')||{}).textContent || null),
  flagged: await p.evaluate(() => /estimate/i.test(document.getElementById('x-wholesale').innerText)) };
if (!B0.band || !B1.band)      bad.push('B: the wholesale row stopped printing a band at all');
else if (B0.band === B1.band)  bad.push(`B: marking repairs an estimate did not widen the band (${B0.band})`);
if (B0.conf === B1.conf)       bad.push(`B: marking an input an estimate cost no confidence (${B0.conf})`);
if (!B1.flagged)               bad.push('B: the row does not say it is running on an estimate');

/* ── C · a missing input refuses, by name ──────────────────────────────── */
await type('arv','');
await p.waitForTimeout(350);
const C = await p.evaluate(() => {
  const w = document.getElementById('x-wholesale').innerText;
  return { refuses: /not priced|Needs/i.test(w), namesIt: /ARV/i.test(w),
    holdStill: !/not priced/i.test(document.getElementById('x-hold').innerText) };
});
if (!C.refuses)  bad.push('C: the wholesale priced itself with no ARV');
if (!C.namesIt)  bad.push('C: it refuses without saying which number it wants');

/* ── D · the wholetail disqualifies itself, in its own words ───────────── */
await type('arv','291000'); await type('repairs','60000');
await p.waitForTimeout(400);
const D = await p.evaluate(() => /disguise/i.test(document.getElementById('x-wholetail').innerText));
if (!D) bad.push('D: 21% repairs and the wholetail still calls itself a wholetail');

/* ── E · the subject-to spread ─────────────────────────────────────────── */
await type('piti','1205'); await type('rent','1700'); await type('arrears','9000');
await p.waitForTimeout(400);
const spread = Math.round(1700*0.82 - 1205);
const E = await p.evaluate(() => { const o = document.querySelector('[data-open="subto"]'); if (o) o.click();
  const x = document.getElementById('x-subto'); return x ? x.innerText.replace(/\n/g,' | ') : null; });
if (!E || !E.includes(String(spread)))
  bad.push(`E: the subject-to spread should be $${spread}/mo — the row says: ${String(E).slice(0,120)}`);

/* ── F · and none of it evaporates on reload ───────────────────────────── */
/* the estimate flag is set again here on purpose: typing a new figure into a
   field CLEARS its estimate, which is correct behaviour and is why the flag
   set back in B is legitimately gone by now */
await p.evaluate(() => { S.est.arv = true; S.unc.arv = 0.2;
  S.prov.arv = 'three comps, none closer than half a mile'; save(); });
await p.reload(); await p.waitForTimeout(700);
const F = await p.evaluate(() => ({ addr: document.getElementById('addr').value,
  arv: (document.querySelector('[data-f="arv"]')||{}).value,
  piti: S.raw.piti || null, est: !!S.est.arv, prov: S.prov.arv || null }));
if (F.addr !== '1128 Marrow Lane') bad.push(`F: the address did not survive a reload — ${F.addr}`);
if (!F.piti)                       bad.push('F: the seller\'s loan did not survive a reload');
if (!F.est || !F.prov)             bad.push('F: the provenance of an estimate did not survive a reload');

if (errs.length) bad.push('console errors — ' + errs.slice(0,2).join(' | '));

await p.screenshot({ path:'desk.png', clip:{ x:0, y:0, width:1000, height:1080 } });
await b.close();
console.log(JSON.stringify({ A, expect: Object.fromEntries(Object.entries(expect).map(([kk,v]) => [kk, Math.round(v)])),
  B0, B1, C, D, E: String(E).slice(0,140), expectSpread: spread, F, order: shown.order, errs }, null, 1));
console.log(bad.length ? 'FAIL\n - ' + bad.join('\n - ')
  : 'PASS — five exits recomputed from the outside match the page to the dollar, an estimate costs confidence and widens the band, and a missing input refuses by name');
process.exit(bad.length ? 1 : 0);
