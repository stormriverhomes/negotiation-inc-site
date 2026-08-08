/* ══ TWO ROOMS, ONE ANSWER ══════════════════════════════════════════════════
   The tier grammar exists twice: inline in desk.html, and in shared/tier.mjs,
   which is injected into land.html. That duplication is deliberate — nine
   harnesses load desk.html straight off disk over file://, and a page that
   cannot run until it is built is a page nobody can open to poke at — but a
   security-critical function written down twice is a drift hazard, and this
   file is the thing that makes it safe.

   The guarantee is BEHAVIOURAL, not textual, which is the stronger of the
   two: two copies can match character for character and still behave
   differently once their surroundings differ, and two copies can read nothing
   alike and agree perfectly. What matters is that the same person gets the
   same answer whichever room they are standing in. So both pages are opened,
   the same account is planted in both, and tierOf() and entitled() are asked
   the same questions on each.

   If this file ever goes red, the fix is NEVER to change one side to match the
   other without deciding which is right. One of the two rooms is wrong about
   who somebody is, and on the paid surface that is either giving away the
   product or refusing somebody who paid for it. */
import { chromium } from 'playwright';
import path from 'node:path';
import { tierFor, entitledFor, whyNotFor, planTier } from './shared/tier.mjs';

let n = 0, bad = 0;
const ok = (name, pass, x) => { n++; if (!pass){ bad++;
  console.log('✗ ' + name + (x !== undefined ? '  ← ' + JSON.stringify(x) : '')); }
  else console.log('✓ ' + name); };

const today   = new Date().toISOString().slice(0,10);
const longAgo = new Date(Date.now() - 40*86400000).toISOString().slice(0,10);

/* every rung on the ladder, plus the shapes that have caused bugs before */
const PEOPLE = [
  ['a stranger',              null],
  ['an account, no plan',     { name:'E', email:'e@x.com', plan:null }],
  ['a blank plan string',     { name:'E', email:'e@x.com', plan:'   ' }],
  ['an unknown plan label',   { name:'E', email:'e@x.com', plan:'legacy-pro' }],
  ['solo',                    { name:'E', email:'e@x.com', plan:'solo' }],
  ['underwriter',             { name:'E', email:'e@x.com', plan:'underwriter' }],
  ['the office',              { name:'E', email:'e@x.com', plan:'the office' }],
  ['office, other spelling',  { name:'E', email:'e@x.com', plan:'Office' }],
  ['a live trial',            { name:'E', email:'e@x.com', plan:null, trial: today }],
  ['a lapsed trial',          { name:'E', email:'e@x.com', plan:null, trial: longAgo }],
  ['a trial AND a plan',      { name:'E', email:'e@x.com', plan:'solo', trial: today }],
  ['a nonsense trial date',   { name:'E', email:'e@x.com', plan:null, trial:'not-a-date' }],
];

const b = await chromium.launch();
const errs = [];
const openRoom = async (file) => {
  const pg = await b.newPage({ viewport:{ width:1200, height:900 } });
  pg.on('pageerror', e => errs.push(file + ': ' + String(e).slice(0,140)));
  await pg.goto('file://' + path.resolve(file));
  await pg.waitForFunction(() => typeof tierOf === 'function' && typeof entitled === 'function',
    null, { timeout: 20000 });
  return pg;
};
/* the DESK is read from source, because that is what nine other harnesses do
   and this file exists to protect that arrangement. The LAND DESK is read
   from dist, because it cannot run unbuilt — its grammar is injected. */
const deskPg = await openRoom('desk.html');
const landPg = await openRoom('dist/land.html');

const ask = (pg, acct) => pg.evaluate(a => {
  localStorage.clear();
  if (a) localStorage.setItem('ni-account-v1', JSON.stringify(a));
  return { tier: tierOf(), e0: entitled(0), e1: entitled(1), e2: entitled(2), e3: entitled(3) };
}, acct);

for (const [who, acct] of PEOPLE){
  const d = await ask(deskPg, acct);
  const l = await ask(landPg, acct);
  ok('both rooms agree about ' + who, JSON.stringify(d) === JSON.stringify(l), { desk:d, land:l });
  /* and the pure module — the thing that can be reasoned about — agrees too */
  const m = { tier: tierFor(acct, { demo:false, preview:null }),
              e0: entitledFor(acct, 0, {}), e1: entitledFor(acct, 1, {}),
              e2: entitledFor(acct, 2, {}), e3: entitledFor(acct, 3, {}) };
  ok('  and the module agrees about ' + who, JSON.stringify(d) === JSON.stringify(m), { page:d, module:m });
}

/* ── THE TWO THINGS THAT MUST NEVER BE TRUE ────────────────────────────────
   These are not consistency checks. They are the product's money. */
{
  const strangerDesk = await ask(deskPg, null);
  const strangerLand = await ask(landPg, null);
  ok('nobody without an account is entitled to anything, in either room',
     !strangerDesk.e1 && !strangerDesk.e2 && !strangerLand.e1 && !strangerLand.e2,
     { strangerDesk, strangerLand });
  const blank = await ask(deskPg, { name:'E', plan:'   ' });
  const blankL = await ask(landPg, { name:'E', plan:'   ' });
  ok('a stray blank plan string buys nothing, in either room',
     blank.tier === 0 && blankL.tier === 0 && !blank.e1 && !blankL.e1, { blank, blankL });
  /* a lapsed trial is the case that decides whether the product has a business */
  const lapsed = await ask(deskPg, { name:'E', plan:null, trial: longAgo });
  const lapsedL = await ask(landPg, { name:'E', plan:null, trial: longAgo });
  ok('a lapsed trial goes back to nothing, in either room',
     lapsed.tier === 0 && lapsedL.tier === 0 && !lapsed.e1 && !lapsedL.e1, { lapsed, lapsedL });
}

/* whyNotFor is what a locked card SAYS, and a wrong reason sends somebody to
   the wrong place — a price list when they needed an account */
{
  const cases = [
    [null,                                'signedout'],
    [{ name:'E', plan:null },             'free'],
    [{ name:'E', plan:'solo' },           'lowtier'],
    [{ name:'E', plan:'underwriter' },    null],
    [{ name:'E', plan:null, trial:today },null],
  ];
  for (const [acct, want] of cases){
    const got = whyNotFor(acct, 2, {});
    const deskWhy = await deskPg.evaluate(a => { localStorage.clear();
      if (a) localStorage.setItem('ni-account-v1', JSON.stringify(a));
      return entitleWhy(2); }, acct);
    ok('the reason matches the desk for ' + (acct ? (acct.plan || 'trial/free') : 'a stranger'),
       got === deskWhy && got === want, { module:got, desk:deskWhy, want });
  }
  ok('a demo is refused for being a demo, never for being broke',
     whyNotFor({ name:'E', plan:'underwriter' }, 2, { demo:true }) === 'demo');
  ok('and a demo may never spend, whatever tier it paints',
     tierFor(null, { demo:true }) === 3 && entitledFor(null, 2, { demo:true }) === false);
}

/* planTier is the one function that reads money off a record */
ok('planTier: an object with no plan is tier zero', planTier({ name:'E' }) === 0, planTier({ name:'E' }));
ok('planTier: null is tier zero', planTier(null) === 0, planTier(null));
ok('planTier: a non-string plan is tier zero', planTier({ plan: 3 }) === 0, planTier({ plan: 3 }));

await deskPg.close(); await landPg.close(); await b.close();
if (errs.length){ bad++; console.log('✗ page errors: ' + [...new Set(errs)].join(' | ')); }
console.log('\n' + (bad ? '✗ ' + bad + ' of ' + n + ' failed'
  : '✓ all ' + n + ' hold — both rooms tell the same person the same thing'));
process.exit(bad ? 1 : 0);
