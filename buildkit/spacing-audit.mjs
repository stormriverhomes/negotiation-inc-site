/* ══ THE SPACING AUDIT ═════════════════════════════════════════════════════
   "Which pages have spacing issues" is not a taste question and should not be
   answered by looking at twenty screenshots and forming an impression. Every
   symptom people MEAN by bad spacing has a measurement:

     A · side-scroll        something is wider than the window
     B · edge crowding      readable text within 8px of the window edge
     C · rhythm breaks      sibling gaps in one stack that disagree by >2x
     D · cramped targets    a tap target under 32px, or two under 6px apart
     E · collisions         two text boxes overlapping in both axes

   Each is counted per page per width, so the output is a RANKING — the thing
   that was actually asked for — rather than a list of everything wrong with
   everything, which is the same as no list at all.

   Run: node spacing-audit.mjs [--widths 390,768,1440] [--page desk.html]
   Needs `python3 -m http.server 8899` inside dist — the site 301s .html to
   extensionless and file:// breaks the font preload, so neither is usable. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ARG = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i+1] : null; };
const WIDTHS = (ARG('--widths') || '390,768,1024,1440').split(',').map(Number);
const ONLY   = ARG('--page');
const BASE   = 'http://127.0.0.1:8899/';
const SHOTS  = ARG('--shots') !== null || process.argv.includes('--shots');

const pages = ONLY ? [ONLY]
  : fs.readdirSync('dist').filter(f => f.endsWith('.html') && f !== '404.html');

/* ── the probe, run inside the page ──────────────────────────────────────── */
const PROBE = () => {
  const W = window.innerWidth;
  const vis = el => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const sel = el => {
    if (!el || el === document.body) return 'body';
    const id = el.id ? '#' + el.id : '';
    if (id) return el.tagName.toLowerCase() + id;
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\s+/).slice(0,2).join('.') : '';
    return el.tagName.toLowerCase() + cls;
  };
  /* text this element owns itself, not what its children own — otherwise every
     wrapper up to <body> counts as a text box and the collision check explodes */
  const ownText = el => Array.from(el.childNodes)
    .filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('').length;

  const all = Array.from(document.querySelectorAll('body *')).filter(vis);
  const textEls = all.filter(el => ownText(el) > 1);
  const out = { A:[], B:[], C:[], D:[], E:[], F:[], G:[], H:[], J:[], K:[] };

  /* ── THE DENSITY HALF ────────────────────────────────────────────────────
     The spacing checks above find things that are BROKEN. These find the thing
     that is worse and never throws: prose that is technically laid out and
     still repels the eye. Four independent causes, each with a number that
     typography settled long before us —

       F · measure   45–75 characters a line. Past 75 the eye loses its place
                     on the return sweep and re-reads the line it just left.
       G · leading   under 1.45 the descenders of one line crowd the caps of
                     the next. This is literally "the words are too close
                     together" and it is one property.
       H · wall      a paragraph over 55 words has no landing place in it.
       J · separation a gap between paragraphs smaller than 0.6 of a line is
                     not a gap — the block does not read as a block.

     Measured on rendered text, so a paragraph that WRAPS to 40 characters on a
     phone is not reported at 390 and is reported at 1440 if it runs to 110. */
  const CH = el => {                       // rendered characters per line
    const s = getComputedStyle(el);
    const cw = parseFloat(s.fontSize) * 0.5;   // mean advance ≈ half the em for text faces
    return cw > 0 ? Math.round(el.getBoundingClientRect().width / cw) : 0;
  };
  const proseEls = textEls.filter(el => {
    if (/^(BUTTON|A|LABEL|OPTION|TH|CODE|SUP|SUB)$/.test(el.tagName)) return false;
    const s = getComputedStyle(el);
    if (parseFloat(s.fontSize) < 12) return false;
    return ownText(el) >= 40;                  // a sentence, not a chip or a figure
  });
  for (const el of proseEls){
    const s = getComputedStyle(el);
    const fs = parseFloat(s.fontSize);
    const lh = parseFloat(s.lineHeight) || fs * 1.2;
    const ch = CH(el);
    const words = (el.textContent.trim().match(/\S+/g) || []).length;
    if (ch > 78) out.F.push({ what: sel(el), ch, words });
    /* DISPLAY TYPE IS SUPPOSED TO BE TIGHT. A 46px headline at 1.62 looks like
       a ransom note; the first version of this check reported every h1 on the
       site and buried the four real findings under them. Leading is judged
       against what the type is FOR: 1.45 for reading, 1.15 for display. */
    const display = /^H[1-4]$/.test(el.tagName) || fs >= 24;
    if (lh / fs < (display ? 1.15 : 1.45))
      out.G.push({ what: sel(el), lh: +(lh/fs).toFixed(2), size: Math.round(fs), words });
    if (words > 55) out.H.push({ what: sel(el), words, ch });
    /* K · SMALL TYPE. Not a spacing fault and it produces the same complaint:
       13.5px running text asks the eye to work before it has read anything.
       15px is the floor for something somebody is expected to READ rather than
       glance at, which is why captions and chips are excluded above. */
    if (fs < 14.5) out.K.push({ what: sel(el), size: +fs.toFixed(1), words });
  }
  /* J · does one paragraph end before the next begins, visually */
  for (let i = 1; i < proseEls.length; i++){
    const a = proseEls[i-1], b = proseEls[i];
    if (a.parentElement !== b.parentElement) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const gap = rb.top - ra.bottom;
    if (gap < -1) continue;
    const lh = parseFloat(getComputedStyle(b).lineHeight) || 16;
    /* A LIST IS A TIGHTER GENRE THAN A RUN OF PARAGRAPHS and asking it for the
       same gap is asking it to stop being a list. Indentation and markers
       already do the grouping work that white space has to do alone between
       paragraphs, so the bar is lower — but it is not zero, because eight
       pixels in a twenty-six pixel line is what "too close together" means. */
    const need = lh * (a.tagName === 'LI' && b.tagName === 'LI' ? 0.4 : 0.6);
    if (gap < need)
      out.J.push({ what: sel(a) + ' → ' + sel(b), gap: Math.round(gap), needs: Math.round(need) });
  }
  const bodyWords = (document.body.innerText.match(/\S+/g) || []).length;
  const screens = Math.max(1, document.documentElement.scrollHeight / window.innerHeight);

  /* A · side-scroll. The page-level fact first, then who caused it. */
  if (document.documentElement.scrollWidth > W + 1){
    for (const el of all){
      const r = el.getBoundingClientRect();
      if (r.right <= W + 1 && r.left >= -1) continue;
      /* a parent that clips is not a bug — the overflow never reaches the window */
      let p = el.parentElement, clipped = false;
      while (p && p !== document.body){
        const s = getComputedStyle(p);
        if (s.overflowX === 'hidden' || s.overflowX === 'auto' || s.overflowX === 'scroll'){ clipped = true; break; }
        p = p.parentElement;
      }
      if (clipped) continue;
      out.A.push({ what: sel(el), by: Math.round(Math.max(r.right - W, -r.left)) });
    }
  }

  /* B · edge crowding. Text, not scenery: a full-bleed canvas SHOULD touch the
     edge — that is the ground rule. Prose within 8px of it is a bug. */
  for (const el of textEls){
    const r = el.getBoundingClientRect();
    if (r.top > 6000) continue;
    const gapL = r.left, gapR = W - r.right;
    if (gapL < 8 || gapR < 8)
      out.B.push({ what: sel(el), left: Math.round(gapL), right: Math.round(gapR) });
  }

  /* C · rhythm. For every stack of three or more block siblings, the gaps
     between them should agree. A stack that goes 8, 34, 9 reads as a mistake
     even to somebody who cannot say why. Only flagged when the tight gap is
     genuinely tight — two roomy gaps of different sizes are a layout, not a
     fault. */
  const seen = new Set();
  for (const el of all){
    const kids = Array.from(el.children).filter(k => {
      if (!vis(k)) return false;
      const s = getComputedStyle(k);
      return s.position === 'static' || s.position === 'relative';
    });
    if (kids.length < 3) continue;
    const cs = getComputedStyle(el);
    if (cs.display.includes('flex') && cs.flexDirection.startsWith('row')) continue;
    if (cs.display.includes('grid')) continue;
    const rects = kids.map(k => k.getBoundingClientRect());
    if (rects.some((r,i) => i && r.top < rects[i-1].bottom - 1)) continue;  // not a vertical stack
    const gaps = rects.slice(1).map((r,i) => Math.round(r.top - rects[i].bottom));
    if (gaps.some(g => g < 0)) continue;
    const lo = Math.min(...gaps), hi = Math.max(...gaps);
    if (hi >= 10 && lo < 10 && hi >= lo * 2 + 6){
      const k = sel(el) + gaps.join(',');
      if (!seen.has(k)){ seen.add(k); out.C.push({ what: sel(el), gaps }); }
    }
  }

  /* D · targets. 32px is below every published guideline on purpose — this is
     looking for the ones that are actually hard to hit, not scoring against a
     standard. Pairs matter as much as sizes: two 40px buttons 2px apart are a
     worse phone experience than one 30px button on its own. */
  /* A LINK INSIDE A SENTENCE IS NOT A TAP TARGET, and counting it as one was
     the first version's whole error — it put terms.html and privacy.html at
     the top of the ranking on the strength of their own prose. What counts is
     a control: something laid out as a block or inline-block, or sitting in a
     parent that owns no running text of its own. */
  const isControl = el => {
    if (/^(BUTTON|SELECT|INPUT|TEXTAREA)$/.test(el.tagName)) return true;
    if (el.getAttribute('role') === 'button') return true;
    if (el.tagName !== 'A') return false;
    const d = getComputedStyle(el).display;
    if (d === 'inline') return !(el.parentElement && ownText(el.parentElement) > 1);
    return true;
  };
  const hits = all.filter(isControl);
  for (const el of hits){
    const r = el.getBoundingClientRect();
    if (r.top > 6000) continue;
    if (getComputedStyle(el).position === 'absolute') continue;
    if (r.height < 32 || r.width < 24)
      out.D.push({ what: sel(el), w: Math.round(r.width), h: Math.round(r.height), why: 'small' });
  }
  for (let i = 0; i < hits.length; i++){
    for (let j = i+1; j < hits.length; j++){
      const a = hits[i].getBoundingClientRect(), b = hits[j].getBoundingClientRect();
      if (a.top > 6000 || b.top > 6000) continue;
      if (hits[i].contains(hits[j]) || hits[j].contains(hits[i])) continue;
      const dx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
      const dy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
      if (dx === 0 && dy === 0) continue;                 // overlap is check E's job
      const d = Math.round(Math.hypot(dx, dy));
      if (d > 0 && d < 6)
        out.D.push({ what: sel(hits[i]) + ' ↔ ' + sel(hits[j]), gap: d, why: 'tight pair' });
    }
  }

  /* E · collisions. Two boxes that each own text and overlap in both axes.
     Overlays are excluded by position, not by guessing at intent. */
  /* Anything DELIBERATELY lifted out of flow — absolute, fixed, sticky, a
     float, or a relative box that has been nudged — is allowed to sit on top
     of its neighbours; that is what those properties are for. A collision only
     means something when both boxes believed they were in the flow. */
  const inFlow = el => {
    const s = getComputedStyle(el);
    if (s.position === 'absolute' || s.position === 'fixed' || s.position === 'sticky') return false;
    if (s.float !== 'none') return false;
    if (s.position === 'relative' && [s.top, s.left, s.bottom, s.right]
        .some(v => v !== 'auto' && parseFloat(v))) return false;
    if (s.transform !== 'none') return false;
    return true;
  };
  const flow = textEls.filter(inFlow).slice(0, 400);
  for (let i = 0; i < flow.length; i++){
    for (let j = i+1; j < flow.length; j++){
      if (flow[i].contains(flow[j]) || flow[j].contains(flow[i])) continue;
      const a = flow[i].getBoundingClientRect(), b = flow[j].getBoundingClientRect();
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 4 && oy > 4)
        out.E.push({ what: sel(flow[i]) + ' ✕ ' + sel(flow[j]), overlap: Math.round(Math.min(ox, oy)) });
    }
  }
  return { out, scrollW: document.documentElement.scrollWidth, W,
           words: bodyWords, screens: +screens.toFixed(1),
           perScreen: Math.round(bodyWords / screens) };
};

/* ── the run ─────────────────────────────────────────────────────────────── */
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const rows = [];
for (const p of pages){
  for (const w of WIDTHS){
    const ctx = await b.newContext({ viewport: { width: w, height: 900 },
                                     deviceScaleFactor: 1, isMobile: w < 500 });
    const pg = await ctx.newPage();
    let r = null;
    try {
      await pg.goto(BASE + p, { waitUntil: 'load', timeout: 30000 });
      await pg.waitForTimeout(w < 500 ? 900 : 600);
      r = await pg.evaluate(PROBE);
      if (SHOTS) await pg.screenshot({ path: `sp-${p.replace(/\.html$/,'')}-${w}.png`, fullPage: false });
    } catch(e){ r = { out:{A:[],B:[],C:[],D:[],E:[],F:[],G:[],H:[],J:[],K:[]}, err: String(e).slice(0,90) }; }
    await ctx.close();
    const o = r.out;
    const n = k => (o[k] || []).length;
    rows.push({ page:p, w, err:r.err || null,
                words:r.words||0, screens:r.screens||0, perScreen:r.perScreen||0,
                A:n('A'), B:n('B'), C:n('C'), D:n('D'), E:n('E'),
                F:n('F'), G:n('G'), H:n('H'), J:n('J'), K:n('K'),
                broken: n('A')+n('B')+n('C')+n('D')+n('E'),
                dense:  n('F')+n('G')+n('H')+n('J')+n('K'), detail:o });
  }
}
await b.close();

/* ── the report ──────────────────────────────────────────────────────────── */
const byPage = new Map();
for (const r of rows){
  const g = byPage.get(r.page) || { page:r.page, broken:0, dense:0, words:0, perScreen:0,
                                    A:0,B:0,C:0,D:0,E:0,F:0,G:0,H:0,J:0,K:0 };
  g.broken += r.broken; g.dense += r.dense;
  for (const k of 'ABCDEFGHJK') g[k] += r[k];
  g.words = Math.max(g.words, r.words);
  g.perScreen = Math.max(g.perScreen, r.perScreen);
  byPage.set(r.page, g);
}
const rank = [...byPage.values()].sort((x,y) => y.dense - x.dense);

console.log('\n══ READING DENSITY ' + '═'.repeat(54));
console.log('   F measure >78ch · G leading · H paragraph >55 words · J gap too small · K type <14.5px\n');
console.log('   page                   words  /screen   dense    F    G    H    J    K');
console.log('   ' + '─'.repeat(72));
for (const g of rank){
  const flag = g.perScreen > 260 ? ' ←' : '';
  console.log('   ' + g.page.padEnd(21) + String(g.words).padStart(6)
    + String(g.perScreen).padStart(9) + String(g.dense).padStart(8)
    + String(g.F).padStart(5) + String(g.G).padStart(5)
    + String(g.H).padStart(5) + String(g.J).padStart(5) + String(g.K).padStart(5) + flag);
}
console.log('\n   ← more than 260 words per screenful — the eye has nowhere to rest\n');

console.log('══ LAYOUT FAULTS ' + '═'.repeat(56));
console.log('   A side-scroll · B edge crowding · C rhythm · D targets · E collisions\n');
console.log('   page                  faults    A    B    C    D    E');
console.log('   ' + '─'.repeat(56));
for (const g of [...byPage.values()].sort((x,y)=>y.broken-x.broken)){
  if (!g.broken) continue;
  console.log('   ' + g.page.padEnd(21) + String(g.broken).padStart(6)
    + String(g.A).padStart(5) + String(g.B).padStart(5) + String(g.C).padStart(5)
    + String(g.D).padStart(5) + String(g.E).padStart(5));
}

console.log('\n══ THE OFFENDERS ' + '═'.repeat(56));
const LABEL = { A:'side-scroll', B:'edge crowding', C:'rhythm', D:'targets', E:'collisions',
                F:'measure', G:'leading', H:'wall of words', J:'no separation', K:'small type' };
for (const g of rank.filter(x => x.dense || x.broken).slice(0, 8)){
  console.log('\n── ' + g.page + ' ' + '─'.repeat(Math.max(0, 66 - g.page.length)));
  const widths = [...new Set(rows.filter(x=>x.page===g.page).map(x=>x.w))];
  for (const w of widths){
    const r = rows.find(x => x.page === g.page && x.w === w);
    if (!r || (!r.dense && !r.broken)) continue;
    console.log(`   @${w}px  ${r.words} words over ${r.screens} screens` + (r.err ? '  ERROR ' + r.err : ''));
    for (const k of 'FGHJKABCDE'){
      const list = r.detail[k] || []; if (!list.length) continue;
      const shown = list.slice(0, 3).map(x => JSON.stringify(x)).join('\n           ');
      console.log(`     ${LABEL[k].padEnd(14)} ${list.length}`
        + (list.length > 3 ? ' (first 3)' : '') + '\n           ' + shown);
    }
  }
}
fs.writeFileSync('spacing-audit.json', JSON.stringify(rows, null, 1));
console.log('\n   full detail → spacing-audit.json');
console.log(`   densest page: ${rank[0].page} (${rank[0].dense} findings, ${rank[0].perScreen} words a screen)\n`);
