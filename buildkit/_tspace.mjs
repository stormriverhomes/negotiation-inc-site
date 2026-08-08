/* _tspace — the layout audit, measured rather than squinted at.
   Five faults a person notices before they can name them:
     1 OVERFLOW  something wider than the window (a sideways scrollbar on a phone)
     2 CROWD     two blocks of text whose gap is smaller than the text is tall —
                 the "clouded" look: paragraphs that read as one grey mass
     3 OVERLAP   two siblings whose boxes actually intersect
     4 TAP       something you press that is under 34px tall on a phone
     5 MEASURE   a line of prose longer than ~100 characters
   Reported per page per width. Hidden things and decoration are skipped. */
import { chromium } from 'playwright';
import fs from 'fs';

const PAGES = fs.readdirSync('/home/claude/dist').filter(f => /\.html$/.test(f));
const WIDTHS = [[1280, 'desktop'], [390, 'phone']];
const only = process.argv[2] ? process.argv.slice(2) : null;

const AUDIT = () => {
  const R = { overflow:[], trapped:[], crowd:[], overlap:[], tap:[], measure:[], zoom:[] };
  const vw = document.documentElement.clientWidth;
  const nm = e => e.tagName.toLowerCase() +
    (e.id ? '#' + e.id : '') +
    (e.className && typeof e.className === 'string'
      ? '.' + e.className.trim().split(/\s+/).slice(0,2).join('.') : '');
  const txt = e => (e.textContent || '').trim();
  const vis = e => { const c = getComputedStyle(e);
    return c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > .05; };

  const all = [...document.querySelectorAll('body *')].filter(vis);
  for (const e of all){
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const c = getComputedStyle(e);

    /* 1 · overflow — ignore anything deliberately scrolled or clipped */
    let clipped = false;
    for (let a = e.parentElement; a; a = a.parentElement){
      const ac = getComputedStyle(a);
      if (/hidden|auto|scroll/.test(ac.overflowX)) { clipped = true; break; }
    }
    if (!clipped && c.position !== 'fixed' && (r.right > vw + 1.5 || r.left < -1.5))
      R.overflow.push({ el:nm(e), left:+r.left.toFixed(0), right:+r.right.toFixed(0), vw });

    /* ── CLIPPED IS NOT THE SAME AS SCROLLABLE, AND THIS FILE TREATED THEM
       AS ONE ────────────────────────────────────────────────────────────
       The check above skips anything inside a container whose overflow-x is
       hidden, auto OR scroll — "deliberately clipped, fine". But `auto` means
       the reader can reach it and `hidden` means they never can, and lumping
       them together is why eighty-four green harnesses said nothing while the
       pricing page's most expensive column sat 108px past the right edge of a
       338px box with overflow:hidden. Not scrolled past. UNREACHABLE.

       So: a container that hides its own overflow while HAVING overflow is a
       trap, and content nobody can reach is content that does not exist. */
    if (/hidden/.test(c.overflowX) && e.scrollWidth > e.clientWidth + 8 && e.clientWidth > 0){
      /* A backdrop that bleeds past its box is not a trap — the land desk's
         contour rings sit at inset:-20% ON PURPOSE and nothing is lost. What
         matters is whether READABLE OR PRESSABLE content is stranded out
         there, so the check looks for it rather than trusting the number. */
      const box = e.getBoundingClientRect();
      const lost = [...e.querySelectorAll('td,th,p,h1,h2,h3,li,button,a,input,select,label,span')]
        .filter(d => {
          const dr = d.getBoundingClientRect();
          if (dr.width === 0 || dr.height === 0) return false;
          if (dr.left > box.right + 4000) return false;          // off-canvas by design
          const txt = (d.textContent || '').trim();
          const pressable = /^(BUTTON|A|INPUT|SELECT)$/.test(d.tagName);
          if (!txt && !pressable) return false;
          return dr.right > box.right + 8;                        // stranded past the clip
        })
        .slice(0, 4)
        .map(d => (d.tagName + ' "' + (d.textContent || '').trim().replace(/\s+/g,' ').slice(0, 26) + '"'));
      if (lost.length)
        R.trapped.push({ el:nm(e), holds:e.scrollWidth, shows:e.clientWidth,
                         past: e.scrollWidth - e.clientWidth, lost });
    }

    /* 4 · tap targets */
    /* HEIGHT ALONE IS NOT THE TEST. The wordmark is 29px tall and 150px wide;
       nobody has ever missed it. A target is hard to hit when it is small in
       BOTH directions, so require that too — otherwise the report is mostly
       logos and you stop reading it. */
    /* a 16px dot with a 44px transparent ::after under it IS a 44px target —
       that is how you keep a marker looking like a marker and still let a
       thumb hit it, so the audit has to know the pattern or it punishes the fix */
    const grown = ['::after', '::before'].some(q => {
      const pc = getComputedStyle(e, q);
      return pc.content !== 'none' && pc.position === 'absolute'
        && parseFloat(pc.width) >= 40 && parseFloat(pc.height) >= 40; });
    if (!grown && window.__phone && /^(button|a)$/.test(e.tagName.toLowerCase()) && txt(e)
        && r.height > 0 && r.height < 34 && r.width < 120
        && c.display !== 'inline' && !e.closest('nav,footer,.foot'))
      R.tap.push({ el:nm(e), h:+r.height.toFixed(0), w:+r.width.toFixed(0), t:txt(e).slice(0,34) });

    /* 6 · iOS zoom — Safari on iPhone zooms the whole page when a field under
       16px takes focus, and it does not zoom back out. The layout survives it
       badly and the person has to pinch their way back to the button they were
       about to press. It is a one-character fix and an invisible bug. */
    if (window.__phone && /^(input|textarea|select)$/.test(e.tagName.toLowerCase())
        && !/^(checkbox|radio|range|hidden|submit|button|color)$/.test(e.type || '')
        && parseFloat(c.fontSize) < 16)
      R.zoom.push({ el:nm(e), fs:parseFloat(c.fontSize) });

    /* 5 · measure */
    if (/^(p|li|h1|h2|h3)$/.test(e.tagName.toLowerCase()) && !e.querySelector('*')){
      const ch = txt(e).length, fs_ = parseFloat(c.fontSize);
      const perLine = r.width / (fs_ * 0.5);      // ~0.5em average glyph advance
      if (ch > 60 && perLine > 100)
        R.measure.push({ el:nm(e), ch:Math.round(perLine), w:+r.width.toFixed(0) });
    }
  }

  /* 2 + 3 · siblings */
  for (const parent of all){
    const kids = [...parent.children].filter(vis).filter(k => {
      const kc = getComputedStyle(k);
      return !/inline$/.test(kc.display) && kc.position === 'static';
    });
    /* SORT BY GEOMETRY, NOT BY DOM ORDER. A one-column grid on a phone gives
       the sign-in column `order:-1`, so the second child paints first — and a
       naive DOM-order comparison reads that as an 879px overlap. It is not an
       overlap; it is a layout doing exactly what it was told. */
    kids.sort((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top);
    for (let i = 1; i < kids.length; i++){
      const a = kids[i-1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
      if (!a.height || !b.height) continue;
      if (Math.abs(a.left - b.left) > 4 || Math.abs(a.width - b.width) > 8) continue; // side by side
      const gap = b.top - a.bottom;
      const fa = parseFloat(getComputedStyle(kids[i-1]).fontSize);
      const fb = parseFloat(getComputedStyle(kids[i]).fontSize);
      const both = txt(kids[i-1]).length > 12 && txt(kids[i]).length > 12;
      const ca = getComputedStyle(kids[i-1]), cb = getComputedStyle(kids[i]);
      /* a gap of zero is not crowding when something is drawn in it. These pages
         separate rows with a 1px grid gap over a grey parent, or with a border
         on the row itself — both read as a rule, not as text touching text. */
      /* air inside the box is still air: a list item with 11px of padding is
         not crowded because its margins are 2px apart. And a table row is
         ruled by a border on its CELLS, not on the row. */
      const padded = parseFloat(ca.paddingBottom) >= 6 || parseFloat(cb.paddingTop) >= 6
        || [...kids[i-1].children, ...kids[i].children].some(t =>
             parseFloat(getComputedStyle(t).paddingTop) >= 6
             || parseFloat(getComputedStyle(t).paddingBottom) >= 6);
      const cellRuled = [...kids[i-1].children, ...kids[i].children].some(t =>
        parseFloat(getComputedStyle(t).borderBottomWidth) > 0
        || parseFloat(getComputedStyle(t).borderTopWidth) > 0);
      const ruled = padded || cellRuled
        || parseFloat(ca.borderBottomWidth) > 0 || parseFloat(cb.borderTopWidth) > 0
        || ca.backgroundColor !== cb.backgroundColor
        || (gap > 0 && gap <= 2 && getComputedStyle(parent).backgroundColor !== cb.backgroundColor);
      /* and a label sitting on its own value is a pair, not two paragraphs */
      const pair = Math.max(fa, fb) <= 11 || Math.abs(fa - fb) >= 2.5;
      if (gap < -1.5)
        R.overlap.push({ a:nm(kids[i-1]), b:nm(kids[i]), by:+(-gap).toFixed(0) });
      else if (both && !ruled && !pair && gap >= 0 && gap < Math.min(fa, fb) * 0.34)
        R.crowd.push({ a:nm(kids[i-1]), b:nm(kids[i]), gap:+gap.toFixed(1),
                       fs:Math.min(fa,fb), t:txt(kids[i]).slice(0,44) });
    }
  }
  for (const k of Object.keys(R)){
    const seen = new Set();
    R[k] = R[k].filter(x => { const s = JSON.stringify(x); if (seen.has(s)) return false;
      seen.add(s); return true; }).slice(0, 14);
  }
  return R;
};

const b = await chromium.launch();
const report = {};
let total = 0;
for (const f of (only || PAGES)){
  for (const [w, label] of WIDTHS){
    const p = await b.newPage({ viewport:{ width:w, height:900 } });
    try {
      console.error('  → ' + f + ' @' + w);
      await p.goto('file:///home/claude/dist/' + f, { waitUntil:'domcontentloaded', timeout:20000 });
      await p.addScriptTag({ content:'window.__phone=' + (w < 700) }).catch(()=>{});
      await p.waitForTimeout(1100);
      const r = await Promise.race([p.evaluate(AUDIT),
        new Promise((_,rj)=>setTimeout(()=>rj(new Error('audit hung')), 25000))]);
      const n = Object.values(r).reduce((s,x)=>s+x.length,0);
      if (n){ report[f + ' · ' + label] = r; total += n; }
    } catch(e){ report[f + ' · ' + label] = { error:String(e).slice(0,120) }; }
    await p.close();
  }
}
/* overflow, overlap, a field that zooms iOS, and a target small in BOTH
   directions are defects. Crowding and measure are judgement, so they print
   and do not fail — a harness that cries wolf gets muted. */
const bad = [];
for (const [k, r] of Object.entries(report)){
  if (r.error) { bad.push(k + ' — ' + r.error); continue; }
  for (const o of r.overflow || []) bad.push(`${k} · overflows the window: ${o.el} right=${o.right} vw=${o.vw}`);
  for (const o of r.overlap  || []) bad.push(`${k} · overlaps by ${o.by}px: ${o.a} / ${o.b}`);
  for (const o of r.zoom     || []) bad.push(`${k} · ${o.el} is ${o.fs}px — iOS zooms the page on focus`);
  for (const o of r.trapped  || []) bad.push(`${k} · ${o.el} clips ${o.past}px it cannot scroll to — `
    + `stranded: ${o.lost.join(', ')}. Nobody can reach that.`);
  for (const o of r.tap      || []) if (o.h < 30 && o.w < 60)
    bad.push(`${k} · ${o.el} is ${o.w}×${o.h} — "${o.t}"`);
}
console.log(JSON.stringify(report, null, 1));
console.log('\n' + total + ' findings across ' + (only||PAGES).length + ' pages');

await b.close();
if (bad.length){ console.log('FAIL'); bad.forEach(x => console.log(' - ' + x)); process.exit(1); }
console.log('PASS — nothing overflows, nothing is clipped past reach, nothing overlaps, no field '
  + 'zooms an iPhone, and every target is reachable with a thumb');
process.exit(0);
