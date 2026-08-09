/* drive The Daily Street end to end twice: once to file a record, once to
   prove the record survives the reload and that the second finish does not
   overwrite the first. Also asserts THE READ renders a real dollar figure. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/daily-street.html');
let n=0, bad=0;
const ok=(t,p,extra)=>{n++; if(!p){bad++;console.log('✗ '+t+(extra?'  ← '+extra:''));} else console.log('✓ '+t);};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:390,height:844} });
const pg = await ctx.newPage();
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,200)));
await pg.goto(FILE); await pg.waitForTimeout(400);

ok('boots clean', errs.length===0, errs[0]);

// first-timer sees no record bar
ok('a first-timer sees no record bar', await pg.locator('.rec').count()===0);

async function playRun(bidEvery){
  await pg.evaluate(()=>{ if (run.screen!=='play') beginRound(); });
  for (let r=0;r<3;r++){
    await pg.waitForTimeout(120);
    await pg.evaluate((doBid)=>{
      if (state && state.phase==='play'){
        if (doBid){
          state.at=0; doLook('walk'); doLook('ask'); toOffer();
          // offer something plausible: the low end of what the sheet suggests
          const c = board.cards[0];
          state.price = Math.round((c.ask ?? state.price ?? 100000) * 0.86);
        }
        closeRound();
      }
    }, bidEvery);
    /* WAIT FOR THE REVEAL TO FINISH, NOT FOR A GUESS AT ITS LENGTH. This was a
       flat 2200ms, which cleared a walk of five 340ms fades. The walk is now
       800ms a house and a 1200ms hold on the one you bid — Claude Design's
       ruling that time is flat and the held beat IS the animation — so the
       guess expired and the harness went red about a record it never got far
       enough to write. A harness that sleeps for a duration is a harness that
       breaks the next time somebody improves the pacing, and its red will
       point at the wrong thing. */
    await pg.waitForFunction(() => !state || state.phase !== 'resolve', null, { timeout: 30000 });
    await pg.evaluate(()=>{ if (state && state.phase==='renovate') finishReno(); });
    await pg.waitForTimeout(250);
    await pg.evaluate(()=>{ if (state && state.phase==='settle') nextRound(); });
    await pg.waitForTimeout(250);
    await pg.evaluate(()=>{ if (run.screen==='card') beginRound(); });
  }
  await pg.waitForTimeout(300);
}

await playRun(true);
const st = await pg.evaluate(()=>({ screen: run.screen, cap: run.capital,
  read: document.querySelector('.read') ? document.querySelector('.read').textContent : null }));
ok('a run reaches the summary', st.screen==='summary', st.screen);

const rec = await pg.evaluate(()=> JSON.parse(localStorage.getItem('ni.street.v1')||'null'));
ok('the finish is written to localStorage', !!rec && rec.v===1, JSON.stringify(rec));
ok('the record counts one day', rec && rec.played===1, rec&&rec.played);
ok('the streak starts at 1', rec && rec.streak===1, rec&&rec.streak);
ok('a best finish is recorded', rec && typeof rec.best==='number', rec&&rec.best);

const firstBest = rec && rec.best;

// the summary carries the record line
const sum = await pg.locator('.runtot .cap.rl').first().textContent().catch(()=>null);
ok('the summary states the record', !!sum && /first street on the board|best finish/.test(sum), sum);

// reload: the hero must now greet a returning player
await pg.reload(); await pg.waitForTimeout(350);
const heroTxt = await pg.locator('.rec').first().textContent().catch(()=>null);
ok('the record survives a reload', !!heroTxt, heroTxt);
ok('the hero names the best finish', !!heroTxt && /best finish/.test(heroTxt), heroTxt);
ok('the hero says today is already on the board', !!heroTxt && /already on the board/.test(heroTxt), heroTxt);
ok('the button reads "Play again"', (await pg.locator('button.go').first().textContent()).trim()==='Play again');

// replaying today must NOT overwrite the filed number
await pg.evaluate(()=>{ run.capital = 999999; });
await playRun(false);
const rec2 = await pg.evaluate(()=> JSON.parse(localStorage.getItem('ni.street.v1')||'null'));
ok('replaying today does not overwrite the record', rec2 && rec2.best===firstBest, rec2&&rec2.best);
ok('replaying today does not inflate the day count', rec2 && rec2.played===1, rec2&&rec2.played);

// a corrupt record must not brick the door
await pg.evaluate(()=> localStorage.setItem('ni.street.v1','{{{not json'));
const errs2=[]; pg.on('pageerror',e=>errs2.push(String(e).slice(0,200)));
await pg.reload(); await pg.waitForTimeout(350);
ok('a corrupt record still opens the door', await pg.locator('button.go').count()>0 && errs2.length===0, errs2[0]);

// THE READ — the counterfactual in dollars
await pg.evaluate(()=> localStorage.removeItem('ni.street.v1'));
await pg.reload(); await pg.waitForTimeout(300);
await pg.evaluate(()=>{ beginRound(); state.at=0; doLook('walk'); doLook('ask'); toOffer();
  state.price = Math.round(board.cards[0].ask*0.8); closeRound(); });
await pg.waitForTimeout(2400);
const readTxt = await pg.locator('.read').first().textContent().catch(()=>null);
ok('the read renders', !!readTxt, readTxt);
ok('the read names a dollar figure of room', !!readTxt && /\$[\d,]+ of room/.test(readTxt), readTxt);
ok('the read names the house that was the play', !!readTxt && /The play/.test(readTxt), (readTxt||'').slice(0,120));
ok('the read never paints the counterfactual green',
   await pg.evaluate(()=>{ const el=document.querySelector('.read .left .n'); if(!el) return false;
     const c = getComputedStyle(el).color; return c !== 'rgb(47, 107, 70)' || document.querySelector('.read.perfect')!==null; }));
ok('no page errors through a full round', errs.length===0, errs[0]);

await b.close();
console.log('\n'+(bad? '✗ '+bad+' of '+n+' failed' : '✓ all '+n+' hold'));
process.exit(bad?1:0);
