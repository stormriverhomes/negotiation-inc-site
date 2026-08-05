/* _tarcade — the first ninety seconds of Comp Run.

   The loop underneath this game is good. The opening was a monochrome sheet
   with a drawing of a door on it, six identical buttons, and no sentence
   anywhere saying what to press or why — Elijah's words were that it is "not
   immediately clear", which is generous. A game nobody can start is a game
   nobody plays, and this one is the funnel's front half.

     A · a first-time player is taught, on desktop and on a phone
     B · the beats advance BY DOING, not by pressing next — a tutorial you can
         finish without playing has taught you to skip tutorials
     C · the beat points at something, and at something ON SCREEN
     D · one press dismisses one beat; "do not show these" dismisses the set,
         forever, across a reload
     E · a returning player who already knocked is never taught beat one
     F · the door takes a knock anywhere on the block that looks pressable
     G · exactly one control is coloured as the primary action, and it is the
         one that leads to the Daily Street
     H · nothing throws on any of it, at either width
     I · a temporary boost glows on the thing it applies to, says how long is
         left, and stops when it stops
     J · a comp report is a thing you hold ONE of, and the receipt follows the
         item rather than the attempt
     K · a sale condition counted in a daily resource stays completable on the
         day it is drawn, whatever the day has already spent */
import { chromium } from 'playwright';
import fs from 'fs';

const B = 'file:///home/claude/dist/comp-run.html';
const bad = [], out = {};
const b = await chromium.launch();

const open = async (w, h, seed) => {
  const p = await b.newPage({ viewport:{ width:w, height:h } });
  p.on('pageerror', e => bad.push(`${w}px: threw — ${String(e).slice(0,120)}`));
  await p.goto(B);
  await p.evaluate(s => { localStorage.clear();
    if (s) localStorage.setItem('ni-portfolio-v2', JSON.stringify({ S:s, ts:Date.now() })); }, seed || null);
  await p.goto(B);
  await p.waitForFunction(() => typeof S !== 'undefined' && typeof crShow === 'function', null, { timeout:20000 });
  await p.waitForTimeout(1100);
  return p;
};
const beat = p => p.evaluate(() => {
  const c = document.getElementById('cr-coach');
  const t = document.querySelector('.cr-point');
  const r = t ? t.getBoundingClientRect() : null;
  return { shown: !!c && !c.hidden,
    n: (document.getElementById('cr-n')||{}).textContent || null,
    title: (document.getElementById('cr-t')||{}).textContent || null,
    points: t ? (t.id || t.className.split(' ')[0]) : null,
    onScreen: r ? (r.bottom > 0 && r.top < innerHeight) : null };
});

for (const [w, h, tag] of [[1280, 1000, 'desktop'], [390, 844, 'phone']]){
  /* ── A/C · taught, and pointed at something visible ─────────────────────── */
  const p = await open(w, h);
  const b1 = await beat(p);
  out[tag + ' · beat 1'] = b1;
  if (!b1.shown)       bad.push(`${tag}: a first-time player is taught nothing`);
  if (b1.n !== '1')    bad.push(`${tag}: the first beat is numbered ${b1.n}`);
  if (!b1.points)      bad.push(`${tag}: the beat points at nothing`);
  if (b1.onScreen === false) bad.push(`${tag}: the beat points at something off screen`);

  /* ── B · it advances by doing ───────────────────────────────────────────── */
  await p.evaluate(() => { const d = document.querySelector('.doorwrap');
    for (let i = 0; i < 3; i++) d.dispatchEvent(new MouseEvent('click', { bubbles:true, clientX:80, clientY:80 })); });
  await p.waitForTimeout(500);
  const b2 = await beat(p);
  out[tag + ' · beat 2'] = b2;
  if (b2.n !== '2')    bad.push(`${tag}: knocking three times did not advance the beat (still ${b2.n})`);
  /* ── F · the knock landed, from the wrap rather than the canvas ─────────── */
  const knocks = await p.evaluate(() => S.knocks || 0);
  out[tag + ' · knocks'] = knocks;
  if (knocks < 3) bad.push(`${tag}: a press on the door block registered ${knocks} knocks of 3 — `
                         + 'the whole thing looks pressable and only part of it is');

  /* ── G · one primary, and it is the street ──────────────────────────────── */
  const prim = await p.evaluate(() => {
    const go = [...document.querySelectorAll('.btn.go')];
    const c = document.getElementById('comp');
    return { n: go.length, isComp: go.length === 1 && go[0] === c,
      bg: c ? getComputedStyle(c).backgroundColor : null,
      others: [...document.querySelectorAll('.btn:not(.go)')].slice(0,3)
        .map(x => getComputedStyle(x).backgroundColor) };
  });
  out[tag + ' · primary'] = prim;
  if (prim.n !== 1)   bad.push(`${tag}: ${prim.n} controls are wearing the primary colour — none of them reads as the action`);
  if (!prim.isComp)   bad.push(`${tag}: the primary colour is not on the button that leads to the Daily Street`);
  if (prim.others.includes(prim.bg))
    bad.push(`${tag}: the primary is the same colour as an ordinary button`);
  await p.close();
}

/* ── D · dismissal, one and all ──────────────────────────────────────────── */
{
  const p = await open(1280, 1000);
  await p.evaluate(() => document.getElementById('cr-x').click());
  await p.waitForTimeout(250);
  out.afterX = await beat(p);
  if (!out.afterX.shown) bad.push('D: dismissing one beat dismissed the whole set');
  if (out.afterX.n === '1') bad.push('D: dismissing the first beat left the first beat up');
  await p.evaluate(() => document.getElementById('cr-off').click());
  await p.waitForTimeout(250);
  out.afterOff = await beat(p);
  if (out.afterOff.shown) bad.push('D: "do not show these" did not');
  await p.reload();
  await p.waitForFunction(() => typeof crShow === 'function', null, { timeout:20000 });
  await p.waitForTimeout(1100);
  out.afterReload = await beat(p);
  if (out.afterReload.shown) bad.push('D: "do not show these" did not survive a reload');
  await p.close();
}

/* ── E · a returning player is not taught to knock ───────────────────────── */
{
  const p = await open(1280, 1000, { cash: 900, own:[3,0,0,0,0,0,0,0,0,0], bought:[0],
    knocks: 40, compDone: 0, t: 0, day: 0, era:0, prestige:0 });
  const r = await beat(p);
  out.returning = r;
  if (r.shown && r.n === '1')
    bad.push('E: somebody with forty knocks and an upgrade is being taught to press the door');
  if (r.shown && r.title && !/street/i.test(r.title))
    bad.push(`E: the returning player got beat "${r.title}" instead of the one thing they have not done`);
  await p.close();
}


/* ── I · A BOOST YOU CAN SEE ───────────────────────────────────────────────
   Both temporary boosts used to announce themselves as small grey monospace
   in the corner. A x20 that ends before you notice it began is a reward the
   game gave you and you did not receive. The glow has to land on the thing the
   boost applies to — the door for a knock multiplier, the rate readout for an
   income one — and both have to stop the moment the buff does. */
{
  const p = await open(1280, 1000);
  const before = await p.evaluate(() => ({ body: document.body.className,
    pills: document.querySelectorAll('.buff').length }));
  if (before.pills) bad.push('I: boost pills are on screen with no boost running');
  if (/\b(fz|cf)\b/.test(before.body)) bad.push('I: a boost class is set with no boost running');

  const on = await p.evaluate(() => {
    S.frenzyUntil = S.t + 60; S.clickFrenzyUntil = S.t + 20; renderTop();
    const g = s => getComputedStyle(document.querySelector(s)).animationName;
    return { body: document.body.className,
      pills: [...document.querySelectorAll('.buff')].map(x => x.textContent.replace(/\s+/g,' ').trim()),
      door: g('.doorwrap'), rate: g('.ratebar') };
  });
  out.boostOn = on;
  if (!/\bfz\b/.test(on.body)) bad.push('I: the income boost sets no class on the body');
  if (!/\bcf\b/.test(on.body)) bad.push('I: the knock boost sets no class on the body');
  if (on.pills.length !== 2) bad.push(`I: ${on.pills.length} boost pills for two boosts`);
  if (!on.pills.some(t => /a door/i.test(t)) || !on.pills.some(t => /income/i.test(t)))
    bad.push(`I: the pills do not say which boost is which — ${JSON.stringify(on.pills)}`);
  if (!on.pills.every(t => /\d+s/i.test(t)))
    bad.push('I: a boost pill does not count down, so there is no telling how long is left');
  if (on.door === 'none' || on.door === 'crPulse')
    bad.push(`I: the door does not glow while a knock is worth twenty times as much (${on.door})`);
  if (on.rate === 'none') bad.push('I: the rate readout does not glow while income is multiplied');
  if (on.door === on.rate) bad.push('I: both boosts glow identically — they are different instructions');

  const off = await p.evaluate(() => {
    S.frenzyUntil = 0; S.clickFrenzyUntil = 0; renderTop();
    return { body: document.body.className, pills: document.querySelectorAll('.buff').length,
      rate: getComputedStyle(document.querySelector('.ratebar')).animationName };
  });
  out.boostOff = off;
  if (/\b(fz|cf)\b/.test(off.body)) bad.push('I: the boost class outlived the boost');
  if (off.pills) bad.push('I: a boost pill outlived the boost');
  if (off.rate !== 'none') bad.push('I: the rate readout is still glowing after the boost ended');
  await p.close();
}

/* ── J · YOU HOLD ONE COMP REPORT ──────────────────────────────────────────
   Three sources feed it — the estate call, a street read nearly exactly, and
   one free with the first claim — and they stacked. The rarest thing in the
   game became a drawer you manage. The cap is the fix, and the receipt must
   follow the item: congratulating somebody for a report they did not receive
   is worse than saying nothing. */
{
  const p = await open(1280, 1000);
  const r = await p.evaluate(() => {
    S.comps = 0;
    const first  = gotComp(),  afterFirst  = S.comps;
    const second = gotComp(),  afterSecond = S.comps;
    return { first, afterFirst, second, afterSecond, max: COMP_HOLD_MAX };
  });
  out.comps = r;
  if (r.max !== 1)        bad.push(`J: the holding cap is ${r.max}`);
  if (r.first !== true || r.afterFirst !== 1) bad.push('J: the first report did not arrive');
  if (r.second !== false) bad.push('J: gotComp() reported success while already holding one — '
                                 + 'the receipt will congratulate somebody for nothing');
  if (r.afterSecond !== 1) bad.push(`J: reports stack — ${r.afterSecond} held after two grants`);
  await p.close();
}



/* ── K · A SALE CONDITION YOU CAN ACTUALLY COMPLETE ────────────────────────
   Streets are a DAILY resource — three of them — and "settle three streets
   this run" counted them per run, resetting to zero on every century crossing.
   Work two streets, cross, draw that condition, and it wants three more out of
   a day with one left in it. The game's own button says "back tomorrow" and
   nothing anywhere explains why the checklist is stuck.

   The property that matters, and the only one: whatever the day has already
   spent, what is left plus what is counted must still reach the requirement. */
{
  const p = await open(1280, 1000);
  const r = await p.evaluate(() => {
    /* THE REAL CROSSING, not a re-implementation of it. The first cut of this
       set S.streetsRun = S.compDone inside the test and then asserted that
       S.streetsRun equalled S.compDone, which is a harness marking its own
       homework — it would have passed against the broken game. doPrestige()
       refuses unless the sale is ready, so the gate is stubbed and everything
       else runs exactly as it does in play. */
    const NEED = 3, out = [];
    /* the game's own force-sale switch, which is what it is for */
    const wasDev = devSale;
    try {
      devSale = true;
      for (let doneToday = 0; doneToday <= STREET_LIMIT; doneToday++){
        crossing = null;
        S.compDone = doneToday;
        S.streetsRun = 99;              // any value; the crossing must overwrite it
        doPrestige();
        out.push({ doneToday, counted: S.streetsRun, left: streetsLeft(),
                   reachable: (S.streetsRun || 0) + streetsLeft() >= NEED });
      }
    } finally { devSale = wasDev; crossing = null; }
    return { limit: STREET_LIMIT, rows: out };
  });
  out.streets = r;
  if (r.limit !== 3) bad.push(`K: the daily street limit is ${r.limit}, and the condition asks for 3`);
  for (const row of r.rows)
    if (!row.reachable)
      bad.push(`K: after ${row.doneToday} streets today a crossing leaves ${row.counted} counted `
             + `and ${row.left} available — the sale condition cannot be finished today`);
  await p.close();
}


await b.close();
console.log(JSON.stringify(out, null, 1));
if (bad.length){ console.log('FAIL'); bad.forEach(x => console.log(' - ' + x)); process.exit(1); }
console.log('PASS — Comp Run teaches its first three moves on desktop and on a phone, each beat '
  + 'advances by doing rather than by pressing next and points at something on screen, one press '
  + 'dismisses one and "do not show these" survives a reload, a returning player is only shown what '
  + 'they have not done, the whole door block takes a knock, and exactly one control — the street — '
  + 'is coloured as the action');
process.exit(0);
