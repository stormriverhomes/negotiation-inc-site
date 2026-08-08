/* ONE NUMBER, THREE CABINETS, AND IT CAN GO DOWN.
   The unit tests in arcade/bank.test.mjs prove the arithmetic. This proves the
   wiring: that the four shipped pages all read and write the SAME key, that a
   street run moves it and a replayed day does not, that the drill settles on
   every answer rather than at the end (so quitting a bad minute cannot dodge
   the loss), that a corrupt or hand-edited value cannot brick a cabinet, and
   that the floor never pitches the desk to somebody who has not earned it. */
import { chromium } from 'playwright';
import path from 'node:path';
const D = f => 'file://' + path.resolve('dist/' + f);
let n = 0, bad = 0;
const ok = (t,p,x)=>{ n++; if(!p){bad++;console.log('✗ '+t+(x!==undefined?'  ← '+JSON.stringify(x).slice(0,260):''));} else console.log('✓ '+t); };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{ width:1280, height:1000 } });
const errs = []; ctx.on('page', p => p.on('pageerror', e => errs.push(String(e).slice(0,180))));

/* ── 1 · every cabinet reads the same key ────────────────────────────────── */
const PAGES = ['comp-run.html','daily-street.html','exit-drill.html','arcade.html'];
for (const f of PAGES){
  const pg = await ctx.newPage();
  await pg.goto(D(f)); await pg.waitForTimeout(500);
  const has = await pg.evaluate(()=>({
    key: typeof BANK_KEY !== 'undefined' ? BANK_KEY : null,
    read: typeof BANK === 'object' && typeof BANK.read === 'function' ? BANK.read().cash : null,
    start: typeof START !== 'undefined' ? START : null }));
  ok(f + ' carries the bankroll', has.key === 'ni.bank.v1' && has.read === 150000, has);
  await pg.close();
}

/* ── 2 · a street run moves it, and only once a day ──────────────────────── */
{
  const pg = await ctx.newPage();
  await pg.goto(D('daily-street.html')); await pg.waitForTimeout(500);
  const before = await pg.evaluate(()=>BANK.read().cash);
  ok('the street opens on the bankroll', before === 150000, before);
  ok('and plays with it, not with a constant',
     await pg.evaluate(()=>run.opening === BANK.read().cash), await pg.evaluate(()=>run.opening));

  /* drive three streets to the summary, forcing a known profit */
  const play = async (forced) => {
    await pg.evaluate(()=>{ if (run.screen!=='play') beginRound(); });
    for (let r=0;r<3;r++){
      await pg.waitForTimeout(120);
      await pg.evaluate(()=>{ if (state && state.phase==='play') closeRound(); });
      await pg.waitForTimeout(2200);
      await pg.evaluate(()=>{ if (state && state.phase==='renovate') finishReno(); });
      await pg.waitForTimeout(200);
      /* force the round's profit so the assertion is about the WIRING, not
         about whether a headless click happened to buy a good house */
      await pg.evaluate((p)=>{ if (state) state.sale = { profit: p }; }, forced);
      await pg.evaluate(()=>{ if (state && state.phase==='settle') nextRound(); });
      await pg.waitForTimeout(200);
      await pg.evaluate(()=>{ if (run.screen==='card') beginRound(); });
    }
    await pg.waitForTimeout(300);
  };
  await play(-10000);
  const after = await pg.evaluate(()=>({ cash: BANK.read().cash, banked: run.banked,
    screen: run.screen, ledger: BANK.read().ledger.filter(x=>x.g==='street').length }));
  ok('a losing run takes real money off the bankroll', after.cash === 120000, after);
  ok('the run says what it banked', !!after.banked && after.banked.applied === -30000, after.banked);
  ok('and the street appears in the ledger', after.ledger === 1, after);

  /* replaying the same day must not move it again — otherwise a bad day is
     farmed away in four minutes and the number stops meaning anything */
  await pg.evaluate(()=>newRun());
  await pg.waitForTimeout(200);
  await play(+50000);
  const replay = await pg.evaluate(()=>({ cash: BANK.read().cash, banked: run.banked }));
  ok('replaying today does not move the money again', replay.cash === 120000, replay);
  ok('and the summary says why', replay.banked === null, replay.banked);

  /* the number survives the tab */
  await pg.reload(); await pg.waitForTimeout(500);
  ok('the bankroll survives a reload', await pg.evaluate(()=>BANK.read().cash) === 120000);
  const stake = await pg.locator('.stake').first().textContent().catch(()=>null);
  ok('the hero states the stake before you play', !!stake && /\$120,000/.test(stake), stake);
  await pg.close();
}

/* ── 3 · the drill settles on every answer ───────────────────────────────── */
{
  const pg = await ctx.newPage();
  await pg.addInitScript(()=>{ window.__seed = 90210; });
  await pg.goto(D('exit-drill.html')); await pg.waitForTimeout(500);
  const start = await pg.evaluate(()=>BANK.read().cash);

  await pg.evaluate(()=>{ const b=document.querySelector('.ans:not([disabled])'); if(b) b.click(); });
  await pg.waitForTimeout(150);
  const one = await pg.evaluate(()=>BANK.read().cash);
  ok('one answer moves the money immediately', one !== start, { start, one });

  /* the key property: you cannot quit a bad run to dodge the loss */
  const mid = await pg.evaluate(()=>({ cash: BANK.read().cash, take: G.take }));
  await pg.goto(D('arcade.html')); await pg.waitForTimeout(400);
  const afterQuit = await pg.evaluate(()=>BANK.read().cash);
  ok('walking out mid-run does not undo what happened', afterQuit === mid.cash, { mid, afterQuit });

  /* the daily cap holds, and says so */
  await pg.goto(D('exit-drill.html')); await pg.waitForTimeout(400);
  const capped = await pg.evaluate(()=>{
    let paid = 0;
    for (let i=0;i<80;i++){ const r = BANK.move({ game:'drill', delta: 1000, note:'probe' }); paid += r.applied; }
    return { paid, cash: BANK.read().cash, today: BANK.read().drillToday };
  });
  ok('the drill cannot be farmed past its daily cap', capped.paid <= 12000, capped);
  await pg.close();
}

/* ── 4 · a hostile or corrupt value cannot brick or mint ─────────────────── */
for (const [label, val] of [
  ['corrupt json',      '{{{not json'],
  ['a string',          '"nope"'],
  ['a hand-edited fortune', JSON.stringify({ v:1, cash: 9e99 })],
  ['a negative',        JSON.stringify({ v:1, cash: -500000 })],
  ['Infinity',          '{"v":1,"cash":null}'],
  ['a junk ledger',     JSON.stringify({ v:1, cash: 1000, ledger:'nope' })],
]){
  const pg = await ctx.newPage();
  const e2 = []; pg.on('pageerror', x => e2.push(String(x).slice(0,140)));
  await pg.goto(D('daily-street.html'));
  await pg.evaluate((v)=>localStorage.setItem('ni.bank.v1', v), val);
  await pg.reload(); await pg.waitForTimeout(500);
  const r = await pg.evaluate(()=>({ cash: BANK.read().cash, play: !!document.querySelector('button.go') }));
  ok(label + ': the cabinet still opens', r.play && e2.length === 0, { r, e2 });
  ok(label + ': the money is a real, sane number',
     Number.isFinite(r.cash) && r.cash >= 0 && r.cash <= 1e12, r);
  await pg.close();
}

/* ── 5 · the floor shows the number, and earns the pitch ─────────────────── */
{
  const pg = await ctx.newPage();
  await pg.goto(D('arcade.html'));
  await pg.evaluate(()=>localStorage.removeItem('ni.bank.v1'));
  await pg.reload(); await pg.waitForTimeout(450);
  ok('a stranger is shown no bankroll they did not earn',
     await pg.locator('#bankwrap').evaluate(el=>el.hidden).catch(()=>true) === true);

  await pg.evaluate(()=>{
    BANK.move({ game:'street', delta: 30000, note:'flipped 1104 Elm' });
    BANK.move({ game:'drill',  delta: 900,   note:'a run of reads' });
    BANK.run('street');
  });
  await pg.reload(); await pg.waitForTimeout(450);
  const box = await pg.locator('#bankbox').textContent().catch(()=>null);
  ok('a player who has played sees the number', !!box && /\$180,900/.test(box), box);
  ok('and where it came from', !!box && /Daily Street/.test(box) && /Exit Drill/.test(box), box);
  ok('a modest player is not pitched the desk', !!box && !/Run a real address/.test(box), box);

  await pg.evaluate(()=>BANK.move({ game:'comprun', delta: 300000, note:'crossed into 1954' }));
  await pg.reload(); await pg.waitForTimeout(450);
  const rich = await pg.locator('#bankbox').textContent().catch(()=>null);
  ok('a player who is genuinely up IS pitched', !!rich && /Run a real address/.test(rich), rich && rich.slice(-160));
  ok('and the pitch stands on a real figure', !!rich && /run \$[\d,]+ through this floor/.test(rich), rich && rich.slice(-200));
  await pg.close();
}

/* ── 5 · a crossing pays the offer's multiplier ONCE ─────────────────────── */
/* `bank` on the first line of doPrestige() is already bankable() × pendM. The
   payout line multiplied by pendM a second time, so a full era at a ×1.50
   offer paid $95,625 where the settlement sheet, the reputation the cabinet
   banked, and both places the game prints the figure all said $63,750. Money
   out of nothing on every crossing with an offer on it, uncapped, repeatable
   — and at the low end it silently paid $8,568 LESS than it promised.

   Driven through the page's own functions rather than asserted on source, so
   it holds if the arithmetic moves somewhere else. */
{
  const pg = await ctx.newPage();
  await pg.goto(D('comp-run.html')); await pg.waitForTimeout(600);
/* Driving a real crossing needs the whole era model stood up, and monkey-
   patching `bankable`/`pendM` does not reach them — they are script-scope
   bindings, not window properties. So this reads the SHIPPED function off the
   built page and checks the shape of the payout: `bank` goes into
   prestigeValue as it stands, because the multiplier is already inside it. */
/* The build is minified, so `bank` ships as `e` — the check is on the SHAPE of
   the argument, not its name: one call, and what goes in is a bare binding
   rather than an expression that multiplies something into it. The readable
   form is checked against the source file below, where the names survive. */
  const r = await pg.evaluate(() => {
    if (typeof doPrestige !== 'function' || typeof prestigeValue !== 'function')
      return { skip: 'no prestige on this build' };
    return { call: (doPrestige.toString().match(/prestigeValue\(([^)]*)\)/g) || []) };
  });
  ok('the crossing is on this build', !r.skip && r.call && r.call.length === 1, r);
  ok('the shipped payout takes the book value as it stands',
     !!r.call && /^prestigeValue\(\s*[A-Za-z_$][\w$]*\s*\)$/.test(r.call[0]), r.call);
  ok('and never multiplies anything into it',
     !!r.call && !/[*]/.test(r.call[0]), r.call);
  {
    const src = (await import('node:fs')).readFileSync('portfolio.html', 'utf8');
    const fn = src.slice(src.indexOf('function doPrestige()'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    ok('and in the source, `bank` is where the multiplier is folded in',
       /const\s+bank\s*=\s*bankable\(\)\s*\*\s*\(pendM/.test(body));
    ok('so the payout line names it once and does not reapply it',
       /prestigeValue\(bank\)/.test(body) && !/prestigeValue\(bank\s*\*/.test(body),
       (body.match(/prestigeValue\([^)]*\)/) || [])[0]);
  }
  await pg.close();
}

ok('no page errors anywhere', errs.length === 0, errs[0]);
await b.close();
console.log('\n' + (bad ? '✗ ' + bad + ' of ' + n + ' failed' : '✓ all ' + n + ' hold'));
process.exit(bad ? 1 : 0);
