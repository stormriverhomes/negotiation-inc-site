/* ── THE BOARD HAS NEVER TOUCHED THE SCREEN ────────────────────────────────
   _tspace, _tround and _tgutter all measure narrow widths, and every one of
   them opens a plain desktop page and makes the window small:

     b.newPage({ viewport: { width: 390, height: 900 } })

   A 390px desktop window is not a phone. `@media (hover:none)` does not
   match, `(pointer:coarse)` does not match, and any CSS or JS written for a
   thumb is invisible to the measurement. So the three places this product
   deliberately behaves differently on a phone had no coverage at all — and
   the first time one was opened with hasTouch on, the drill's answer rows
   turned out to be 48px instead of the 52 the rule asked for, because an
   unconditional line further down the file was quietly winning.

   This file is the same pages, opened the way a phone opens them.

     · exit-drill — key chips are desk furniture and must go; the row reflows
       to two columns; the prompt stops offering keyboard shortcuts that do
       not exist on the device it is being read on
     · desk — the intake control says "Add photos", not "Drop the listing
       here", because there is nothing to drop from
     · and everywhere: nothing a thumb must hit is smaller than a thumb, and
       no page scrolls sideways

   The width is 390 (an iPhone 14/15/16 in portrait, and close enough to the
   modal Android) and 360 (the narrowest phone still worth serving). */
import { chromium } from 'playwright';

const B = 'file:///home/claude/dist/';
const F = [], ok = (t, c, x) => { if (!c) F.push(t + (x !== undefined ? '  ← ' + JSON.stringify(x).slice(0, 220) : '')); };

const b = await chromium.launch();
const phone = async (w = 390) => {
  const ctx = await b.newContext({ viewport: { width: w, height: 844 },
    hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  return ctx;
};

/* ── 0 · the context really is a phone ─────────────────────────────────────
   asserted first, because if this is wrong every assertion under it passes
   for the wrong reason — which is exactly how the gap being closed here
   survived a hundred green boards */
{
  const ctx = await phone(); const p = await ctx.newPage();
  await p.goto(B + 'index.html'); await p.waitForTimeout(400);
  const m = await p.evaluate(() => ({ hoverNone: matchMedia('(hover:none)').matches,
    coarse: matchMedia('(pointer:coarse)').matches, touchPoints: navigator.maxTouchPoints }));
  ok('the harness is actually holding a phone', m.hoverNone && m.coarse, m);
  await ctx.close();
}

/* ── 1 · the drill ─────────────────────────────────────────────────────────*/
{
  const ctx = await phone(); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  await p.goto(B + 'exit-drill.html'); await p.waitForTimeout(1200);
  const d = await p.evaluate(() => {
    const a = document.querySelector('.ans'), k = document.querySelector('.ans .key');
    return { cols: a ? getComputedStyle(a).gridTemplateColumns.split(' ').length : null,
      key: k ? getComputedStyle(k).display : 'none present',
      h: a ? Math.round(a.getBoundingClientRect().height) : null,
      minH: a ? getComputedStyle(a).minHeight : null,
      prompt: (document.querySelector('.prompt') || {}).innerText || '',
      body: document.body.innerText };
  });
  ok('the drill drops the keyboard chips a phone cannot use', d.key === 'none', d);
  ok('and reflows the answer row to two columns', d.cols === 2, d);
  /* the rule for phones must actually be the rule that applies */
  ok('and the answer rows are the size written for a thumb, not the desk floor',
     d.minH === '52px' && d.h >= 52, d);
  ok('and the prompt does not offer number keys to a device with no number row',
     !/Keys 1|number key/i.test(d.prompt), d.prompt.slice(0, 120));
  ok('the drill throws nothing on a phone', !errs.length, errs[0]);
  await ctx.close();
}

/* ── 2 · the desk's intake control ─────────────────────────────────────────
   "Drop the listing here" is an instruction you cannot follow on a phone.
   This one is JS, not CSS, so no amount of narrowing a desktop window would
   ever have reached it. */
{
  const ctx = await phone(); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  await p.goto(B + 'desk.html'); await p.waitForTimeout(500);
  await p.evaluate(() => {
    localStorage.setItem('ni-account-v1', JSON.stringify({ name:'E Payne', email:'e@x.com', plan:'underwriter' }));
  });
  await p.goto(B + 'desk.html'); await p.waitForTimeout(1400);
  const t = await p.evaluate(() => {
    const box = document.getElementById('intake');
    if (box) { box.hidden = false; try { renderIntake(); } catch (e) { return { err: e.message }; } }
    return { html: box ? box.innerText : null,
      coarse: matchMedia('(pointer:coarse)').matches };
  });
  if (t && t.err) ok('the intake panel renders on a phone', false, t);
  else if (t && t.html !== null){
    ok('the intake control does not ask a phone to drag and drop',
       !/Drop the listing here/i.test(t.html), t.html.slice(0, 140));
    ok('and offers the thing a phone can actually do',
       /Add photos|Choose photos/i.test(t.html), t.html.slice(0, 140));
  }
  ok('the desk throws nothing on a phone', !errs.length, errs[0]);
  await ctx.close();
}

/* ── 2b · the arcade's two grids, which a phone could not open at all ──────
   Sixty-nine records and forty deeds were wired to onmouseenter and nothing
   else, under copy that said "Hover a square to read it." That is the whole
   written reward for playing the cabinet, behind an input the device does not
   have, described with a verb the reader cannot perform. */
{
  const ctx = await phone(); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  await p.goto(B + 'comp-run.html'); await p.waitForTimeout(1700);
  const verb = await p.evaluate(() => (document.getElementById('achverb') || {}).textContent || '');
  ok('the record panel names a verb a phone can perform', /tap/i.test(verb), { verb });
  for (const [sel, what] of [['.ac','the record'], ['.regd','the register']]){
    const el = await p.$(sel);
    if (!el){ ok(`${what} grid has squares to open`, false, sel); continue; }
    await el.click(); await p.waitForTimeout(300);
    const open = await p.evaluate(() => { const t = document.querySelector('.tip'); return t ? t.textContent.trim().slice(0, 60) : null; });
    ok(`${what} opens on a tap`, !!open && open.length > 3, { sel, open });
    await p.mouse.click(4, 4); await p.waitForTimeout(200);
    ok(`${what} closes again on a tap outside`,
       !(await p.evaluate(() => !!document.querySelector('.tip'))), sel);
  }
  ok('comp-run throws nothing on a phone', !errs.length, errs[0]);
  await ctx.close();
}

/* ── 3 · geometry, but measured by a device that has fingers ───────────────
   The same sweep _tspace does, at the two widths that matter, with touch on —
   so a rule that only exists under (hover:none) is included rather than
   skipped. Sideways scroll and undersized targets are the two failures a
   person actually feels. */
const PAGES = ['index.html','plans.html','arcade.html','exits.html','exit-drill.html',
               'demo.html','desk.html','land.html','comp-run.html','daily-street.html',
               'terms.html','privacy.html','refunds.html','office.html'];
for (const w of [390, 360]){
  for (const f of PAGES){
    const ctx = await phone(w); const p = await ctx.newPage();
    await p.goto(B + f); await p.waitForTimeout(900);
    const g = await p.evaluate(() => {
      /* ── WCAG 2.5.8 (Target Size, Minimum), which is AA ──────────────────
         24×24 CSS px, with two exemptions the standard grants and this
         product genuinely relies on:
           · INLINE — a link inside a sentence is read, not aimed at, and
             enlarging it would break the line
           · SPACING — a small target is fine if a 24px circle centred on it
             touches no other target's circle, because a mistap costs nothing

         The first draft of this used a flat 40px and flagged the wordmark,
         every nav item and every footer link on fourteen pages. A rule that
         fires 180 times is not a rule, it is noise, and noise is how a real
         finding gets scrolled past. 24 with the exemptions is the published
         standard and it names things worth fixing. */
      const MIN = 24;
      const wide = [], small = [];
      const targets = [];
      for (const el of document.querySelectorAll('a,button,input,select,summary,[role="button"],[tabindex]')){
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || !el.offsetParent) continue;
        if (el.disabled) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        targets.push({ el, cs, r });
      }
      const centre = t => ({ x: t.r.left + t.r.width/2, y: t.r.top + t.r.height/2 });
      for (const t of targets){
        const { el, cs, r } = t;
        if (r.width >= MIN && r.height >= MIN) continue;
        /* exemption 1 · inline in a run of text */
        const par = el.closest('p,li,td,figcaption,blockquote,label,.sub,.prose,.note');
        if (par && el.tagName === 'A' && /inline/.test(cs.display) &&
            par.innerText.trim().length > el.innerText.trim().length + 12) continue;
        /* exemption 2 · nothing else within a 24px circle of it */
        const c = centre(t);
        const crowded = targets.some(o => o !== t && (() => {
          const d = centre(o);
          return Math.hypot(c.x - d.x, c.y - d.y) < MIN;
        })());
        if (!crowded) continue;
        small.push({ t: (el.innerText || el.getAttribute('aria-label') || el.title || el.type || el.tagName).trim().slice(0, 26),
                     w: Math.round(r.width), h: Math.round(r.height) });
      }
      /* ── a bordered label that breaks across two lines draws its box TWICE ──
         "3 bed" came apart on the Daily Street's comp table at 390px: a boxed
         "3" on one line and a boxed "bed" underneath, which reads as two
         facts. An INLINE element with a border and more than one client rect
         is exactly that and nothing else — block containers always return
         one rect, so this cannot fire on a paragraph in a card. */
      const split = [];
      for (const el of document.querySelectorAll('body *')){
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width > 2 && r.right > innerWidth + 2 && cs.position !== 'fixed')
          wide.push({ k: el.tagName + '.' + (typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : ''),
                      right: Math.round(r.right) });
        if (!/^inline/.test(cs.display)) continue;
        const bordered = ['Top','Right','Bottom','Left'].every(s => parseFloat(cs['border'+s+'Width']) > 0);
        if (bordered && el.getClientRects().length > 1)
          split.push({ t: (el.innerText || '').trim().slice(0, 28),
                       k: el.tagName + '.' + (typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '') });
      }
      const impossible = [];
      for (const m of document.body.innerText.matchAll(
        /[^.\n]*\b(hover(?!ing over the idea)|right[- ]click|mouse over|with your mouse|keyboard shortcut|drop (?:the|it|them|your) [a-z]+ here)\b[^.\n]*/gi))
        impossible.push(m[0].trim().slice(0, 90));

      return { docW: document.documentElement.scrollWidth, winW: innerWidth,
               wide: wide.slice(0, 4), small: small.slice(0, 6), smallN: small.length,
               split: split.slice(0, 5), splitN: split.length,
               impossible: [...new Set(impossible)].slice(0, 4) };
    });
    ok(`${f} @${w} does not scroll sideways`, g.docW <= g.winW + 1, { docW: g.docW, winW: g.winW, wide: g.wide });
    ok(`${f} @${w} meets WCAG 2.5.8 on target size`, g.smallN === 0,
       { n: g.smallN, first: g.small });
    ok(`${f} @${w} draws no label's border twice`, g.splitN === 0,
       { n: g.splitN, first: g.split });
    /* ── and it never tells a phone to do something a phone cannot do ──────
       "Hover a square to read it" and "Drop the listing here" were both
       shipping. Drag is deliberately absent from this list: dragging a slider
       is a thing a thumb does perfectly well. */
    ok(`${f} @${w} asks for no input this device does not have`, g.impossible.length === 0, g.impossible);
    await ctx.close();
  }
}

await b.close();
if (F.length){ console.log('FAIL:'); F.forEach(x => console.log(' -', x)); process.exit(1); }
console.log(`PASS — ${PAGES.length} pages at two phone widths, held by something with fingers`);
