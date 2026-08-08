/* ── THE INSTRUMENT THAT TELLS YOU A PUSH LANDED ───────────────────────────
   Three batches in a row were built, tested, packaged and never reached the
   internet, and nobody could tell. The build stamp exists so that "is the
   thing I just pushed the thing that is running" is a URL instead of an
   archaeology exercise: publish hashes the built bytes, the server reports
   the digest on /api/health, and the deploy script polls for it.

   That only works if the digest is a function of the OUTPUT. It was not.
   build.json from the PREVIOUS run was sitting in the output directory when
   the digest was taken, so every build folded the last build into the answer:

     $ node publish.mjs   build b621fede0901
     $ node publish.mjs   build b428ed97cbcb      ← nothing changed
     $ node publish.mjs   build 33366efd343b      ← still nothing changed

   Same sources, three answers. Which costs the stamp everything it was for:
   you cannot say "the repo matches the build" if building the repo twice
   disagrees with itself, and the deploy script's "nothing to push, the repo
   already matches" branch could never once have been reached, because
   build.json was guaranteed to differ every time.

   A measuring device whose reading changes when you look at it again is not
   measuring the thing you pointed it at. This harness is the one that keeps
   it pointed.

   It also asserts the stamp is HONEST about the two things a person reads it
   for — which stage was built, and how many files — and that a real change to
   a real page moves the id. A stamp that never moves is exactly as useless as
   one that always does. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let n = 0, bad = 0;
const ok = (t, p, x) => { n++; if (!p){ bad++; console.log('✗ ' + t + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0,200) : '')); } else console.log('✓ ' + t); };

const OUT = 'dist-stamp';
const DIR = '/home/claude/' + OUT;
const build = (env = {}) => {
  execFileSync('node', ['publish.mjs'], { cwd:'/home/claude', stdio:'ignore',
    env:{ ...process.env, OUT, ...env } });
  return JSON.parse(fs.readFileSync(path.join(DIR, 'build.json'), 'utf8'));
};

try {
  /* ── 1 · the same sources give the same answer, twice running ───────────*/
  const a = build();
  const b = build();
  ok('a rebuild of untouched sources produces the same id', a.id === b.id, { a:a.id, b:b.id });
  ok('and the stamp does not hash itself',
     !fs.readFileSync(path.join(DIR, 'build.json'), 'utf8').includes(a.id + a.id), a.id);

  /* ── 2 · and it is not stable because it is stuck ───────────────────────
     A digest that never moves would pass the test above and be worthless.
     Touch one page — the one every customer sees — and the id must move. */
  const src = '/home/claude/plans.html';   // the page that sells the thing
  const before = fs.readFileSync(src, 'utf8');
  try {
    fs.writeFileSync(src, before.replace('</body>', '<!-- stamp probe --></body>'));
    const c = build();
    ok('and a change to a shipped page moves it', c.id !== a.id, { a:a.id, c:c.id });
  } finally { fs.writeFileSync(src, before); }

  const back = build();
  ok('and putting the page back puts the id back', back.id === a.id, { a:a.id, back:back.id });

  /* ── 3 · the two facts a person reads off it ────────────────────────────*/
  ok('the stamp names the stage it was built for',
     back.stage === 'prelaunch' || back.stage === 'live', back);
  const live = build({ NI_STAGE:'live' });
  ok('and a live build says live, and is a different build',
     live.stage === 'live' && live.id !== back.id, { live:live.stage, same: live.id === back.id });
  const shipped = fs.readdirSync(DIR)
    .filter(f => /\.(html|js|css|json|xml|txt)$/i.test(f) && f !== 'build.json').length;
  ok('and counts the files it actually hashed', live.files === shipped, { said: live.files, are: shipped });
  ok('and carries a timestamp anyone can read', !Number.isNaN(Date.parse(live.at)), live.at);
  ok('and an id short enough to compare by eye', /^[0-9a-f]{12}$/.test(live.id), live.id);
} finally {
  try { fs.rmSync(DIR, { recursive:true, force:true }); } catch(e){}
}

console.log(bad ? `\n${bad} of ${n} FAILED`
  : `\nall ${n} hold — the build stamp is a function of the build, moves when the build moves, and does not fold the previous answer into this one`);
process.exit(bad ? 1 : 0);
