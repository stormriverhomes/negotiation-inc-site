// the regression board — run in small batches so no single call outlives the shell
import { execFile } from 'child_process';

// the core nineteen, then everything auth touches, then the new surfaces
const NAMES = [
  'v3','comps-verify','demo-verify','gating-verify','offline-demo','dist-handoff',
  'dist-priors','demo-walk','handoff-verify','arcade-handoff','exits-verify','drill-verify',
  'offer-model-verify','desk-v2-verify','desk-priors-verify','desk-hostile','desk-ux','drag-verify',
  'rules-verify','desk-verify',
  // the account is the thing that changed, so everything that reads one runs
  '_tauth','t-acct','t-acct2','t-guest','t-keep','t-flags','t-plans','t-pay','t-hub','t-first',
  // and the surfaces built since the last full board
  't-letter','t-bulk','t-photo','t-cond','t-legal','_twait','_tpay','_tcap','t-laws','t-ask','t-comp',
  // the paint itself: a var() that names nothing takes the whole declaration with it
  '_tvars','_tspace','_tcontrast','_tround','_ttabs',
  // the two gates that decide who spends money and who gets the best screen
  '_tphoto2','_tcomps',
  // a loss in green, and a demo that teaches the opposite of its own card
  '_tsign','_tdemos',
  // the first ninety seconds of the arcade
  '_tarcade','_tcompare','_tstreet',
];
/* srv/test-api.mjs and srv/test-pay.mjs run from their own directory and are
   not in this list — `cd srv && node test-api.mjs && node test-pay.mjs`. */

const BATCH = Number(process.argv[2] || 6);
const only  = process.argv[3] ? process.argv.slice(3) : null;
const LIST  = only || NAMES;

const run = n => new Promise(res => {
  const t0 = Date.now();
  execFile('node', [n + '.mjs'], { cwd:'/home/claude', timeout: 300000, maxBuffer: 1<<24 },
    (err, so, se) => res({ n, code: err ? (err.code ?? 1) : 0,
      s: ((Date.now()-t0)/1000).toFixed(0),
      tail: (so+se).trim().split('\n').slice(-16).join('\n') }));
});

const bad = [];
for (let i = 0; i < LIST.length; i += BATCH){
  const slice = LIST.slice(i, i + BATCH);
  const rs = await Promise.all(slice.map(run));
  for (const r of rs){
    console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.n}  (${r.s}s)`);
    if (r.code !== 0){ bad.push(r.n); console.log(r.tail.split('\n').map(l => '      ' + l).join('\n')); }
  }
}
console.log('\n' + (bad.length ? 'RED: ' + bad.join(', ') : `ALL ${LIST.length} GREEN`));
process.exit(bad.length ? 1 : 0);
