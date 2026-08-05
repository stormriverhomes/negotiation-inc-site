/* _tvars — every var(--x) that names a custom property nothing ever defines.
   An undefined var() with no fallback does not fall back to "something close":
   the whole declaration becomes invalid at computed-value time and the property
   snaps to its INITIAL value. For a `border:1px solid var(--nope)` shorthand
   that means border-style:none — the border does not get lighter, it vanishes.
   That is a silent, total failure and there is no way to see it except to look. */
import fs from 'fs';

const FILES = fs.readdirSync('/home/claude').filter(f => /\.html$/.test(f));
const bad = [];
for (const f of FILES){
  const src = fs.readFileSync('/home/claude/' + f, 'utf8');
  /* only the <style> blocks + inline style attrs — var() inside JS strings counts too,
     since it lands in the DOM either way */
  const defined = new Set();
  for (const m of src.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  const used = new Map();
  for (const m of src.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)){
    if (!used.has(m[1])) used.set(m[1], !!m[2]);      // has a fallback?
    else if (!m[2]) used.set(m[1], false);            // any use without one is the risk
  }
  for (const [name, hasFallback] of used){
    if (defined.has(name)) continue;
    const line = src.slice(0, src.indexOf('var(' + name)).split('\n').length;
    bad.push({ file:f, name, line, hasFallback });
  }
}
const fatal = bad.filter(b => !b.hasFallback);
if (bad.length) console.log(JSON.stringify(bad, null, 1));
if (fatal.length){
  console.log('FAIL — ' + fatal.length + ' var() name a property nothing defines and carry no fallback');
  process.exit(1);
}
console.log('PASS — every var() either names a defined property or carries a fallback'
  + (bad.length ? ` (${bad.length} set at runtime, all with fallbacks)` : ''));
