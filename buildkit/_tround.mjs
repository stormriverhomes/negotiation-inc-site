/* _tround — square corners painted on top of round ones.
   The fault Elijah found twice, described exactly right both times: "it still
   looks like the sharp edges are overlayed."

   The shape is always the same. A container is given a radius and a background
   (often a grey that shows through 1px grid gaps to draw the hairlines). Its
   children are opaque, square-cornered, and reach the container's edge. With
   overflow VISIBLE nothing clips them, so each square child corner paints over
   the container's curve — you get an arc emerging from behind a hard corner,
   which reads as a rendering glitch rather than as a design.

   The fix is one property: overflow:hidden on the container, which clips the
   children to the curve (CSS clips to the padding box INCLUDING its radius).
   This finds every place it can happen, at two widths, so it cannot come back
   somewhere else. */
import { chromium } from 'playwright';
import fs from 'fs';

const PAGES = process.argv[2] ? process.argv.slice(2)
  : fs.readdirSync('/home/claude/dist').filter(f => /\.html$/.test(f));

const SCAN = () => {
  const px = v => parseFloat(v) || 0;
  const opaque = c => { const m = c.match(/[\d.]+/g);
    return !!m && (m.length < 4 || parseFloat(m[3]) > 0.9); };
  const out = [];
  for (const e of document.querySelectorAll('body *')){
    const c = getComputedStyle(e);
    if (c.display === 'none' || c.visibility === 'hidden') continue;
    if (/hidden|clip|auto|scroll/.test(c.overflow)) continue;      // already clipped
    const R = [c.borderTopLeftRadius, c.borderTopRightRadius,
               c.borderBottomRightRadius, c.borderBottomLeftRadius].map(px);
    const maxR = Math.max(...R);
    if (maxR < 4) continue;
    /* a radius on a box that paints NOTHING at its corners rounds nothing.
       A transparent layout grid with gaps between separate cards is not a
       card, and flagging it teaches you to ignore this harness. */
    const paints = opaque(c.backgroundColor)
      || [c.borderTopWidth, c.borderRightWidth, c.borderBottomWidth, c.borderLeftWidth].some(v => px(v) > 0)
      || (c.boxShadow && c.boxShadow !== 'none')
      || (c.backgroundImage && c.backgroundImage !== 'none');
    if (!paints) continue;
    const b = e.getBoundingClientRect();
    if (b.width < 24 || b.height < 24) continue;
    /* the corner squares of the container, in page coords */
    const corners = [[b.left, b.top, R[0]], [b.right, b.top, R[1]],
                     [b.right, b.bottom, R[2]], [b.left, b.bottom, R[3]]];
    for (const k of e.children){
      const kc = getComputedStyle(k);
      if (kc.display === 'none' || kc.visibility === 'hidden') continue;
      if (kc.position === 'absolute' || kc.position === 'fixed') continue;
      if (!opaque(kc.backgroundColor)) continue;
      if (kc.backgroundColor === c.backgroundColor) continue;      // same paint: invisible either way
      const kr = k.getBoundingClientRect();
      if (!kr.width || !kr.height) continue;
      const KR = [kc.borderTopLeftRadius, kc.borderTopRightRadius,
                  kc.borderBottomRightRadius, kc.borderBottomLeftRadius].map(px);
      for (let i = 0; i < 4; i++){
        const [cx, cy, r] = corners[i];
        if (r < 4 || KR[i] >= r - 0.5) continue;                   // child follows the curve
        /* does the child actually occupy that corner square? */
        const inX = kr.left <= cx + 1.5 && kr.right >= cx - 1.5;
        const inY = kr.top  <= cy + 1.5 && kr.bottom >= cy - 1.5;
        if (!(inX && inY)) continue;
        out.push({ parent: e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className
                     ? '.' + e.className.trim().split(/\s+/).slice(0,2).join('.') : ''),
                   child: k.tagName.toLowerCase() + (typeof k.className === 'string' && k.className
                     ? '.' + k.className.trim().split(/\s+/).slice(0,2).join('.') : ''),
                   corner: ['top-left','top-right','bottom-right','bottom-left'][i],
                   radius: r, childRadius: KR[i],
                   parentBg: c.backgroundColor, childBg: kc.backgroundColor });
        break;
      }
    }
  }
  const seen = new Set();
  return out.filter(o => { const k = o.parent + o.child + o.corner;
    if (seen.has(k)) return false; seen.add(k); return true; });
};

const b = await chromium.launch();
const bad = [];
for (const f of PAGES){
  for (const w of [1280, 390]){
    const p = await b.newPage({ viewport:{ width:w, height:900 } });
    try {
      await p.goto('file:///home/claude/dist/' + f, { waitUntil:'domcontentloaded', timeout:20000 });
      await p.waitForTimeout(1000);
      for (const o of await p.evaluate(SCAN))
        bad.push(`${f} @${w}  ${o.parent} (radius ${o.radius}px, overflow visible) — ${o.child} `
               + `paints a square ${o.corner} over it  [${o.parentBg} under ${o.childBg}]`);
    } catch(e){ bad.push(`${f} @${w} — ${String(e).slice(0,90)}`); }
    await p.close();
  }
}
await b.close();
if (bad.length){
  console.log('FAIL — ' + bad.length + ' square corner(s) painted over a rounded one:');
  bad.forEach(x => console.log(' - ' + x));
  console.log('\nThe fix is overflow:hidden on the container (and zeroing the children\'s own radii\n'
    + 'if they had any), which is what .readout on the landing page already does.');
  process.exit(1);
}
console.log('PASS — every rounded container clips its children to its own curve; no square corner '
  + 'is painted over a round one anywhere');
process.exit(0);
