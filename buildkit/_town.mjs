/* A NUMBER THE PERSON GAVE US OUTRANKS ONE WE WORKED OUT.
   Two paths broke that, both silently, both in the direction of a more
   generous ceiling:

     · "Use $52,300 as my repair figure" — a real contractor's bid, adopted on
       purpose — never took the pen, so the next slider nudge replaced it with
       the condition panel's own estimate and destroyed the provenance;
     · a photo read cleared the pen unconditionally, so a repairs figure TYPED
       by hand was replaced by a photo-derived estimate carrying up to 0.42
       uncertainty, and every line the read could see overwrote a slider the
       person had dragged — against the panel's on-screen promise that
       "anything you drag yourself outranks it for good."

   Both directions are asserted: the user's figure survives, AND the estimate
   still lands when there is nothing of the user's to protect. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/desk.html');
let n=0,bad=0;
const ok=(t,p,x)=>{n++; if(!p){bad++;console.log('✗ '+t+(x!==undefined?'  ← '+JSON.stringify(x).slice(0,240):''));}else console.log('✓ '+t);};

const b=await chromium.launch();
const pg=await b.newPage({viewport:{width:1400,height:1000}});
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,180)));
await pg.goto(FILE); await pg.waitForTimeout(600);

const seed = () => pg.evaluate(()=>{
  P.props.length = 0; P.props.push(newProp('450 Chestnut St'));
  P.active = 0; loadInto(0);
  S.raw.arv = '300,000'; S.est.arv = false; S.prov.arv = 'you typed it';
  LINES.forEach(l => S.sys[l.id] = 0);
  S.sysOwn = {}; S.repairsOwn = false; S.raw.repairs = '';
  S.est.repairs = false; S.prov.repairs = null;
});

/* ── the estimate still works when nothing of yours is in the way ────────── */
{
  await seed();
  const est = await pg.evaluate(()=>{
    S.sys[LINES[0].id] = 60; syncRepairs();
    return { repairs: S.raw.repairs, est: S.est.repairs, prov: S.prov.repairs };
  });
  ok('the condition panel still writes its estimate', !!est.repairs && est.est === true, est);
}

/* ── a typed figure keeps the pen against a photo read ───────────────────── */
{
  await seed();
  const r = await pg.evaluate(()=>{
    /* typed by hand, the way the input handler records it */
    S.raw.repairs = '40,000'; S.est.repairs = false; S.repairsOwn = true;
    S.prov.repairs = 'you typed it'; S.unc.repairs = null;
    /* and a slider dragged by hand, to 0, because they walked the house */
    const kitchen = LINES.find(l => /kitchen/i.test(l.id)) || LINES[0];
    S.sys[kitchen.id] = 0; S.sysOwn[kitchen.id] = true;
    if (typeof PHOTO === 'object' && PHOTO) PHOTO.files = [{ name:'a.jpg' }];
    const lines = {}; LINES.forEach(l => lines[l.id] = { seen:true, pc:85, conf:'high' });
    applyRead({ lines, summary:'', flags:[] });
    return { repairs: S.raw.repairs, est: S.est.repairs, prov: S.prov.repairs,
             own: S.repairsOwn, tookOver: S.tookOver, kitchen: S.sys[kitchen.id], kid: kitchen.id,
             others: LINES.filter(l => l.id !== kitchen.id).filter(l => S.sys[l.id] === 85).length };
  });
  /* The product's decision, made explicit rather than left to accident:
     pressing "read the condition" IS a request to fill the panel in, so the
     read takes over — but it must NAME the figure it displaced, because a
     ceiling that moved with nothing on screen to explain it is the failure
     mode either way. */
  ok('the read takes over the repairs figure (the button asks for that)',
     r.repairs !== '40,000', r);
  ok('and says out loud what it replaced', /replaced the 40,000/.test(String(r.prov||'')), r.prov);
  ok('and keeps the displaced figure so it can be offered back',
     r.tookOver && r.tookOver.v === '40,000', r.tookOver);
  ok('a slider you dragged yourself is left alone', r.kitchen === 0, r);
  ok('but the read still fills in the lines you did not touch', r.others > 0, r);
}

/* ── the adopted contractor bid keeps the pen ────────────────────────────── */
{
  await seed();
  const r = await pg.evaluate(()=>{
    /* exactly what the bd-use handler does */
    S.raw.repairs = '52,300'; S.est.repairs = false; S.unc.repairs = null;
    S.repairsOwn = true;
    S.prov.repairs = 'the contractor bid you pasted ($48,000), plus $4,300 for the work it does not price';
    /* then a slider is nudged, which is what used to destroy it */
    S.sys[LINES[0].id] = 45;
    syncRepairs();
    return { repairs: S.raw.repairs, est: S.est.repairs, prov: S.prov.repairs, own: S.repairsOwn };
  });
  ok('an adopted contractor bid survives a slider nudge', r.repairs === '52,300', r);
  ok('and is still a known figure', r.est === false, r);
  ok('and still says it came from the contractor', /contractor bid/.test(String(r.prov||'')), r);
}

/* ── a preset restates the whole panel, so it takes the pen back ─────────── */
{
  await seed();
  const r = await pg.evaluate(()=>{
    const kitchen = LINES.find(l => /kitchen/i.test(l.id)) || LINES[0];
    S.sys[kitchen.id] = 0; S.sysOwn[kitchen.id] = true;
    const btn = document.querySelector('#cond-presets [data-preset="heavy"]');
    if (btn) btn.click();
    return { own: Object.keys(S.sysOwn || {}).length, kitchen: S.sys[kitchen.id] };
  });
  ok('a preset clears every individual drag', r.own === 0, r);
  ok('and moves the line you had dragged', r.kitchen > 0, r);
}

ok('no page errors', errs.length===0, errs[0]);
await b.close();
console.log('\n'+(bad? '✗ '+bad+' of '+n+' failed' : '✓ all '+n+' hold'));
process.exit(bad?1:0);
