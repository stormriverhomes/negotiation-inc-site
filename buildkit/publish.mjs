// ─────────────────────────────────────────────────────────────────────────────
// publish.mjs — turn portfolio.html into a folder you can drag onto any free
// static host. There is no server here on purpose.
//
// The obvious way to make a shared link preview itself is a serverless function
// that renders the card on demand. That costs money eventually, breaks when the
// free tier changes, has cold starts, and is one more thing to keep alive.
//
// There are only forty deeds and they never change. So all eighty cards (plain
// and foil) are rendered ONCE, at build time, into static PNGs — and each deed
// gets a one-kilobyte stub page carrying the og:image tags and an instant hop
// into the game. Every link previews. Nothing runs. It costs nothing anywhere,
// and it works identically on Vercel, Netlify, Cloudflare Pages, GitHub Pages,
// or a folder on a hard drive.
//
//   node publish.mjs [--base https://negotiation.inc]
//
// Output: dist/
//   index.html            the game
//   d/<era>-<n>.html      40 stubs, each ~1 KB
//   og/<era>-<n>.png      40 preview images (1200×630, the size every scraper wants)
//   card/<era>-<n>.png    40 shareable cards (480×672, what a person saves)
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import fs from 'fs';
import crypto from 'node:crypto';
import path from 'path';
import { execFileSync } from 'child_process';
import zlib from 'node:zlib';

const argBase = (process.argv.find(a => a.startsWith('--base=')) || '').split('=')[1]
  || (process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : '');
const BASE = (argBase || '').replace(/\/+$/, '');

/* ══ THE LAUNCH SWITCH ═════════════════════════════════════════════════════
   One constant decides whether this site is selling. Everything that has to
   differ between "not selling yet" and "selling" is expressed in exactly one
   of two ways, and no third way is permitted:

     · <!--SOON--> … <!--/SOON-->   survives only before launch
     · <!--LIVE--> … <!--/LIVE-->   survives only after it

   The blocks are STRIPPED at build time rather than hidden at runtime, so a
   pre-launch page does not ship the checkout copy for a curious person to
   find, and a live page does not ship a waitlist form that could still be
   submitted to a dead endpoint.

   And then — this is the part that makes the flip safe rather than merely
   possible — the build ASSERTS the stage it just built. A page that still
   says "opens soon" in a live build fails the build. A checkout link in a
   pre-launch build fails the build. There is no state where the site is half
   launched, because the only way to reach it is a build that refuses to run.

   To launch:  NI_STAGE=live node publish.mjs
   That is the whole switch. LAUNCH.md lists the four human things that go
   with it, and none of them are in the markup. */
const STAGE = (process.env.NI_STAGE || 'prelaunch').toLowerCase();
if (STAGE !== 'prelaunch' && STAGE !== 'live')
  throw new Error(`NI_STAGE must be "prelaunch" or "live", not "${STAGE}"`);
const LIVE = STAGE === 'live';

/* strip the half that does not apply. Both markers must be balanced — an
   unclosed block would silently swallow the rest of a page. */
function stage(doc, file){
  const pairs = [['SOON', !LIVE], ['LIVE', LIVE]];
  for (const [tag, keep] of pairs){
    const open = new RegExp(`<!--${tag}-->`, 'g'), close = new RegExp(`<!--/${tag}-->`, 'g');
    const nOpen = (doc.match(open) || []).length, nClose = (doc.match(close) || []).length;
    if (nOpen !== nClose)
      throw new Error(`${file}: ${nOpen} <!--${tag}--> against ${nClose} <!--/${tag}--> — an unbalanced stage block eats the rest of the page`);
    doc = keep
      ? doc.replace(open, '').replace(close, '')
      : doc.replace(new RegExp(`<!--${tag}-->[\\s\\S]*?<!--/${tag}-->`, 'g'), '');
  }
  return doc;
}
/* ── THE TIER GRAMMAR, INTO EVERY ROOM THAT DECIDES ───────────────────────
   The Desk and the Land Desk both have to answer "who is this and what may
   they do", and until now only one of them could: land.html had no account
   layer at all. One module, injected into both, so the answer cannot differ
   between two rooms of the same product. */
const TIER_SRC = fs.readFileSync('shared/tier.mjs', 'utf8').replace(/^export /gm, '');
function injectTier(html, who){
  if (!html.includes('/*__TIER_GRAMMAR__*/'))
    throw new Error(who + ' lost its /*__TIER_GRAMMAR__*/ marker — nothing in it would know who is signed in');
  return html.replace('/*__TIER_GRAMMAR__*/', () => TIER_SRC);
}

/* one flag, injected into every page, for the handful of decisions that are
   genuinely runtime rather than markup */
const SB_URL  = process.env.NI_SUPABASE_URL  || '';
const SB_ANON = process.env.NI_SUPABASE_ANON || '';
/* the harnesses stand a stub GoTrue up on a loopback port, which is the only
   legitimate reason this would ever not be a supabase.co URL — so it needs a
   door, and the door is an environment variable nobody sets by accident
   rather than a hole in the pattern */
const SB_LOCAL_OK = process.env.NI_ALLOW_LOCAL_SB === '1'
  && /^http:\/\/127\.0\.0\.1:\d+$/.test(SB_URL);
if (SB_URL && !SB_LOCAL_OK && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SB_URL))
  throw new Error(`NI_SUPABASE_URL does not look like a Supabase project URL: ${SB_URL}`);
/* ── THE SECRET KEY MUST NEVER REACH A BROWSER ─────────────────────────────
   Checked by SHAPE rather than by name, because the way this goes wrong is
   somebody pasting the wrong one of two keys that sit next to each other on
   the same screen and differ by one word.

   There are now TWO key formats and the guard has to know both. The original
   check decoded the JWT payload and looked for "service_role" — which is
   correct for the legacy `eyJ…` keys and DOES NOTHING AT ALL for the new
   `sb_secret_…` ones: they are not JWTs, so `split('.')[1]` is undefined, the
   decode yields an empty string, and the check passes happily on the most
   dangerous credential in the project. A guard that silently stops guarding
   is worse than no guard, because you stop looking. */
const SB_LEGACY_SERVICE = /service_role/.test(
  Buffer.from((SB_ANON.split('.')[1] || ''), 'base64').toString('utf8'));
const SB_NEW_SECRET = /^sb_secret_/i.test(SB_ANON.trim());
if (SB_ANON && (SB_LEGACY_SERVICE || SB_NEW_SECRET))
  throw new Error('NI_SUPABASE_ANON is a SECRET key — that key bypasses every row-level policy and must never be served to a browser');
/* and positively: it has to look like one of the two things it may be, so a
   truncated paste or the wrong field entirely fails loudly at build time
   rather than as a silent 401 on somebody's first sign-in */
if (SB_ANON && !/^sb_publishable_/.test(SB_ANON.trim()) && !/^eyJ[\w-]+\.[\w-]+\./.test(SB_ANON.trim()))
  throw new Error(`NI_SUPABASE_ANON is neither a publishable key (sb_publishable_…) nor a legacy anon JWT (eyJ…): ${SB_ANON.slice(0, 12)}…`);
const STAGEJS = `<script>window.NI_LIVE=${LIVE};`
  + (SB_URL ? `window.NI_SUPABASE_URL=${JSON.stringify(SB_URL)};` : '')
  + (SB_ANON ? `window.NI_SUPABASE_ANON=${JSON.stringify(SB_ANON)};` : '')
  + `</script>`;

const out = process.env.OUT || 'dist';
for (const d of ['', 'd', 'og', 'card']) fs.mkdirSync(path.join(out, d), { recursive: true });

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + path.resolve('portfolio.html'));
await p.waitForTimeout(900);

// ── the cards ──────────────────────────────────────────────────────────────
const deeds = await p.evaluate(() =>
  ERAS.flatMap(E => (CLAIM_DISTRICTS[E.id] || CLAIM_DISTRICTS.now)
    .map((n, i) => ({ eid: E.id, i, name: n, era: E.name, year: /\d/.test(E.year || '') ? E.year : E.name }))));

for (const d of deeds) {
  const png = await p.evaluate(({ eid, i }) => {
    const cv = document.createElement('canvas');
    drawDeedShare(cv, eid, i, { foil: true, who: 'Staked once. Never sold.' });
    return cv.toDataURL('image/png');
  }, d);
  fs.writeFileSync(path.join(out, 'card', `${d.eid}-${d.i}.png`), Buffer.from(png.split(',')[1], 'base64'));

  // The OG image is a different shape from the card. Scrapers crop 1200×630;
  // a 5:7 portrait pasted into that gets its head and feet cut off. So the
  // preview is the card SET ON a landscape sheet, with the pitch beside it —
  // which is also the only text most people will ever read about this game.
  const og = await p.evaluate(({ eid, i, name, era, year }) => {
    const W = 1200, H = 630;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#23201c'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 3000; k++) { g.fillStyle = 'rgba(255,255,255,.014)'; g.fillRect((k * 71) % W, (k * 53) % H, 2, 1); }

    const card = document.createElement('canvas');
    drawDeedShare(card, eid, i, { foil: true, who: 'Staked once. Never sold.' });
    const CH = 500, CW = Math.round(CH * 480 / 672);
    g.save();
    g.shadowColor = 'rgba(0,0,0,.75)'; g.shadowBlur = 44; g.shadowOffsetY = 18;
    g.drawImage(card, 0, 0, card.width, card.height, 76, (H - CH) / 2, CW, CH);
    g.restore();

    const x = 76 + CW + 62;
    g.textBaseline = 'top';
    g.fillStyle = '#a8873a'; g.font = '600 15px ui-monospace, Menlo, monospace';
    g.letterSpacing = '4px'; g.fillText('NEGOTIATION INC', x, 128); g.letterSpacing = '0px';
    g.fillStyle = '#e8e2d4'; g.font = '600 56px "Iowan Old Style", Palatino, Georgia, serif';
    let s = 56, nm = name;
    while (g.measureText(nm).width > W - x - 76 && s > 30) { s -= 2; g.font = `600 ${s}px "Iowan Old Style", Palatino, Georgia, serif`; }
    g.fillText(nm, x, 162);
    g.fillStyle = '#8a8072'; g.font = '22px "Iowan Old Style", Palatino, Georgia, serif';
    g.fillText(era + (year === era ? '' : '  ·  ' + year), x + 1, 232);
    g.fillStyle = '#c2b8a2'; g.font = '21px "Iowan Old Style", Palatino, Georgia, serif';
    for (const [k, line] of ['One of forty pieces of ground across', 'eight eras. Each one costs a whole', 'career, and no sale ever takes it back.'].entries())
      g.fillText(line, x, 296 + k * 32);
    g.fillStyle = '#6b6153'; g.font = '600 13px ui-monospace, Menlo, monospace';
    g.letterSpacing = '2.4px';
    g.fillText('AN ARCADE ABOUT BUYING HOUSES', x, 432);
    g.letterSpacing = '0px';
    return cv.toDataURL('image/png');
  }, d);
  fs.writeFileSync(path.join(out, 'og', `${d.eid}-${d.i}.png`), Buffer.from(og.split(',')[1], 'base64'));
}

// ── one mark, per Design pass 3 item 08: the serif N over the baseline rule.
//    The drawn deed retires into the arcade as interior art — scenery, not a
//    second mark. At 16px the deed read as a smudge; the N-rule reads. ──
/* ── THE MARK ──────────────────────────────────────────────────────────────
   In bookkeeping a DOUBLE RULE under a figure means the total is final: no
   more entries below it, the number you can act on. That is what an
   underwriting desk sells, and it happens to be two lines, which is the most
   a favicon can carry.

   Dark ground rather than the cream this used to be, because a tab strip is
   pale in light mode and a pale icon dissolves into it. The letter is a PATH
   rather than <text font-family="Georgia">, so it is the same N on a machine
   that has never heard of Georgia.

   Below 24px the two rules become three grey smudges, so art/icon-small.svg
   draws one thicker rule instead and favicon.ico carries both — a mark that
   degrades into a cleaner mark was designed; one that degrades into mush was
   scaled. */
const icon = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2064%2064'%3E%3Crect%20width='64'%20height='64'%20rx='14'%20fill='%23101a2c'/%3E%3Cpath%20fill='%23f4efe2'%20d='M15%2015h9.5l14%2021.5V15H47v2.6h-3.4v27.1h-7.9L20.3%2021.1v21h3.6V45H15v-2.6h3.5V17.6H15Z'/%3E%3Crect%20x='15'%20y='50.2'%20width='34'%20height='2.6'%20rx='1.3'%20fill='%23c9a227'/%3E%3Crect%20x='15'%20y='55.4'%20width='34'%20height='2.6'%20rx='1.3'%20fill='%23c9a227'/%3E%3C/svg%3E";
/* every page gets the whole set: the inline SVG for anything that understands
   one, the .ico for everything that does not and for the bare /favicon.ico a
   browser asks for unprompted, and the touch icon for a home screen. */
/* RELATIVE, not root-absolute. Every harness loads these pages over file://,
   where `/favicon.ico` resolves to the filesystem root and fails — the same
   trap the internal page links were deliberately kept out of, walked straight
   into with the icons. `favicon.ico` from /desk resolves to /favicon.ico on
   the server and to dist/favicon.ico on disk, and both are right.
   The deed pages sit a directory down, so they pass '../'. */
const ICONS = (up = '') => `<link rel="icon" href="${icon}" type="image/svg+xml">
<link rel="icon" href="${up}favicon.ico" sizes="16x16 24x24 32x32 48x48 64x64">
<link rel="apple-touch-icon" href="${up}art/apple-touch-icon.png">
<link rel="manifest" href="${up}site.webmanifest">
<meta name="theme-color" content="#101a2c">
`;

// ── shipped pages are minified; sources stay literate ──────────────────────
// The sources carry their reasoning in comments — that is the project's
// memory and it stays. The shipped copy is for browsers: the game's script
// alone is a third commentary and whitespace no phone should download.
// Top-level names survive (the harnesses and the console are allowed to poke
// the game); everything inside is mangled. A minify failure FAILS THE BUILD —
// quietly shipping the unminified page would bury a syntax error for later.
import { minify } from 'terser';
async function minifyInline(html, label){
  const m = html.match(/<script>\n?([\s\S]*?)<\/script>/);
  if (!m) throw new Error(label + ': no inline script found');
  const r = await minify(m[1], { compress: { passes: 2 }, mangle: true });
  if (!r.code) throw new Error(label + ': minify produced nothing');
  return html.replace(m[0], '<script>' + r.code + '</script>');
}
/* ══ LINK PREVIEWS ═════════════════════════════════════════════════════════
   These tags carried a title and a description and NO IMAGE, on every page.
   summary — not summary_large_image — so every share of this site on X,
   LinkedIn, Slack, Reddit, Discord or iMessage rendered as a grey text box
   with a favicon. The forty share cards in og/ are for the arcade's deeds;
   the product's own pages had none.

   That is a strange thing for a product whose entire argument is a document.
   A person deciding whether to click is looking at one rectangle, and ours
   was empty, next to competitors' screenshots.

   Each page now gets a real 1200x630 card, drawn from the site's own type and
   the site's own paper — with the sheet on it, because the sheet is the
   argument. And a canonical, because /desk and /desk.html are both served and
   a search engine has no way to know they are the same page. */
const SITE = (process.env.NI_SITE_URL || 'https://negotiationinc.com').replace(/\/+$/, '');
const OGCARDS = new Set();          // filled in below, once the cards are drawn
const OGFIELDS = [];                // the flat colours the card's panels are made of
const OG = (t, d, slug) => {
  const key = slug === undefined ? null : (slug || 'site');
  /* A page with no card of its own borrows the nearest one that means the same
     thing rather than falling back to the front door. The three cabinets are
     the arcade; the legal pages are the company. */
  const NEAR = { 'comp-run':'arcade', 'daily-street':'arcade', 'exit-drill':'arcade' };
  const img = !key ? 'site'
    : OGCARDS.has(key) ? key
    : OGCARDS.has(NEAR[key]) ? NEAR[key] : 'site';
  return `<meta property="og:type" content="website">
<meta property="og:site_name" content="Negotiation Inc">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${SITE}/og/page-${img}.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${t}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${SITE}/og/page-${img}.png">
${key === null ? '' : `<meta property="og:url" content="${SITE}/${key === 'site' ? '' : key}">
<link rel="canonical" href="${SITE}/${key === 'site' ? '' : key}">`}\n`;
};

// ── the typeface ───────────────────────────────────────────────────────────
// Georgia is on every machine, which is exactly the problem: a page set in the
// default serif reads as a page nobody chose a typeface for, and that is a
// large part of what "looks AI-generated" actually means. Fraunces has a face.
// Self-hosted, so the objection that killed the webfont last time — a
// third-party round trip before first paint plus every visitor's IP handed to
// Google — does not apply: same origin, 37 KB, preloaded, swap.
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
for (const f of fs.readdirSync('fonts')) fs.copyFileSync(path.join('fonts', f), path.join(out, 'fonts', f));
/* OFFLINE=1 inlines the face as a data: URL and drops the preload link.
   The preload is the reason: `crossorigin` forces a CORS-mode fetch, and
   Chrome gives every file:// document an opaque origin, so that one fetch
   is refused and logs an error. Measured on both builds, the @font-face
   itself is unaffected and Fraunces paints either way (836.9px vs Georgia's
   739.0px on the same string) — so this buys a clean console and a demo
   tree that survives being moved or emailed, not a rescued typeface.
   The hosted build keeps the linked file: over https the preload works as
   intended and one cached download serves all seven pages. */
const OFFLINE = process.env.OFFLINE === '1';
const FONT_SRC = OFFLINE
  ? `url('data:font/woff2;base64,${fs.readFileSync('fonts/fraunces.woff2').toString('base64')}')`
  : `url('fonts/fraunces.woff2')`;
/* ══ ONE ARCADE ═══════════════════════════════════════════════════════════
   Four pages carried three golds, three greens and three reds, two grounds
   and two ink scales, and Elijah could feel it without being able to name it.
   A meaning does not get to have three values. What it gets is one name and
   two inks — one that passes on dark, one that passes on paper — and the
   ground selects. A cabinet declares its ground once and never names a colour
   again. (Claude Design's fourth pass; the rule is theirs.)

   THE GROUND RULE, which is the part worth more than the palette: paper is
   never a page background. It is only ever an object ON the dark — finite
   width, one edge, one shadow. The moment a paper colour reaches the browser
   edge it reads as a second, older website, which is exactly what a visitor
   said about revision 2 of the landing page. The moment it stops short, it
   reads as a document lying on a desk in a dark room. That single restriction
   turns "two grounds" into one ground and one material.

   AND THE PAPER INKS ARE NOT THE ONES THE DESIGN HANDED OVER. Its note said
   the contrast failure was designed out — #a8873a fails on white, so brass on
   paper resolves to #9a6b1f and the class is gone. Measured: #9a6b1f is
   3.61:1 on the paper ground and 2.83:1 on the manila well, so it fails AA
   text on one and the 3:1 graphic floor on the other. The failure had moved,
   not gone. Every paper ink below is solved against the DARKEST paper in the
   set (#d9c8a4) at 4.5:1, so it passes at any size on any of the three. */
const PIXEL_SRC = OFFLINE
  ? `url('data:font/woff2;base64,${fs.readFileSync('fonts/pixelify.woff2').toString('base64')}')`
  : `url('fonts/pixelify.woff2')`;
/* ══ THE CABINET COUNTS IN PIXELS ══════════════════════════════════════════
   Claude Design's type ruling, and the scope is the whole of it: this face
   sets DIGITS AND MONEY MARKS AND NEVER A WORD. A sentence in a pixel face is
   a costume; a figure in one is a score, and these cabinets keep score.

   It survives the no-monospace rule on a technicality that is not a
   technicality — Press Start 2P and VT323, the two faces anybody reaches for
   first, are monospace by construction and would have walked straight into
   the purge. Pixelify Sans is proportional. It passed the rule before it
   passed taste, which is the correct order.

   SIL OFL, 7.7KB, self-hosted from our own origin like Fraunces, because the
   privacy page makes a promise about third-party round trips and a font CDN
   is a third party that learns every visitor's IP. Sizes are locked to whole
   multiples: a pixel face at a fractional size shimmers, and shimmer reads as
   error in a product whose subject is exactness. */
const ARCADE = `<style>
@font-face{font-family:'Pixelify';src:${PIXEL_SRC} format('woff2');
 font-weight:400 700;font-style:normal;font-display:swap}
.pix{font-family:'Pixelify',var(--sans);font-variant-numeric:tabular-nums;
 letter-spacing:.01em;font-weight:600}
:root{--sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}
.on-dark{--ground:#0d1420;--raise:#141c2b;--edge:#223047;--well:#101825;
 --ink:#e8e2d4;--ink-2:#aeb8c8;--ink-3:#8b98ac;
 --brass:#a8873a;--pays:#3fa06a;--refuses:#d96a5a;--desk:#4881ea}
.on-paper{--ground:#e9e2d0;--raise:#f6f1e3;--edge:#c9bfa6;--well:#d9c8a4;
 --ink:#22201c;--ink-2:#4a4438;--ink-3:#5a5447;
 --brass:#704e17;--pays:#2a5f3e;--refuses:#a1251e;--desk:#1a50af}
/* paper is a thing on the dark, never the dark itself */
.sheet{background:var(--ground);border:1px solid var(--edge);
 box-shadow:0 12px 30px rgba(0,0,0,.5)}
/* the spine: same corner, same shape, every cabinet. brass is the bankroll
   and the one press about to spend it, and brass is nothing else. */
.nifloor{display:flex;justify-content:space-between;align-items:center;gap:18px;
 padding:14px 18px;border-bottom:1px solid var(--edge)}
.nifloor .out{font-family:var(--sans);font-size:14px;color:var(--ink-2);
 text-decoration:none;padding:8px 2px}
.nifloor .out:hover{color:var(--ink)}
.nifloor .slots{display:flex;gap:26px;align-items:flex-end}
.nifloor .slot{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.nifloor .k{font-family:var(--sans);font-size:10px;letter-spacing:.18em;
 text-transform:uppercase;color:var(--ink-3);font-weight:600}
.nifloor .v{font-size:20px;font-weight:600;letter-spacing:-.01em;
 font-variant-numeric:tabular-nums;color:var(--ink)}
.nifloor .slot.bank .v{color:var(--brass)}
@media(max-width:560px){.nifloor{padding:11px 13px}.nifloor .v{font-size:17px}
 .nifloor .slots{gap:16px}}
</style>
`;

const FONTS = `${OFFLINE ? '' : `<link rel="preload" href="fonts/fraunces.woff2" as="font" type="font/woff2" crossorigin>`}
<style>
/* Fraunces ships its "wonk" letterforms on by default — the single-storey f
   and its friends. They read as a novelty at body sizes and Elijah clipped
   them immediately. WONK 0 keeps the face and drops the party trick. */
@font-face{font-family:'Fraunces';src:${FONT_SRC} format('woff2-variations');
 font-weight:100 900;font-style:normal;font-display:swap;
 font-variation-settings:'WONK' 0}
:root{
 --serif:'Fraunces',Georgia,'Iowan Old Style',serif !important;
 /* NO MONOSPACE ANYWHERE IN THE SOFTWARE. Small letterspaced caps set in a
    monospace face is the single most recognisable "an AI made this" tell on
    the internet right now, and it was on every label we shipped. The eyebrows
    keep their letterspacing; they lose the typewriter. Tabular figures come
    from font-feature-settings instead, which is what they were always for.
    (The arcade keeps its own type. It is a different world on purpose.) */
 --mono:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif !important;
}
.mono,.num,[class*="fig"],[class*="num"]{font-variant-numeric:tabular-nums}
h1,h2,h3,.app h1,.app h2{font-family:var(--serif);font-variation-settings:'WONK' 0}
</style>
`;

/* ══ THE CARD EVERY SHARED LINK SHOWS ══════════════════════════════════════
   Drawn as a page and photographed, not painted into a canvas — the deed
   cards are canvas because they are pixel art and have to be; this is
   typography, and typography belongs to the thing that already knows how to
   set it. It uses the site's own face, off the built copy, so the card cannot
   drift away from the pages it advertises.

   Each card carries the sheet, small, on the right. Not decoration: the sheet
   IS the argument — a stranger scrolling past a link has four seconds, and
   four numbers and a verdict make the case faster than any sentence could.
   The one number in green is the only green on the card, because green means
   money that pays and it means nothing else anywhere in this product. */
{
  /* ── THE CARD, AS CLAUDE DESIGN SPECIFIED IT ─────────────────────────────
     Three of their decisions are load-bearing and worth naming, because each
     one fixes something the first version got wrong:

     · THE RIGHT COLUMN IS THE LEDGER, NOT A PICTURE OF ONE. It was a
       screenshot-shaped thing that was not a screenshot. It is now four
       inputs, the double rule that means final in any book ever kept by
       hand, the one figure — and THE EXIT THE SOFTWARE REFUSED TO PRICE,
       with the reason named. Every calculator on the internet gives you a
       number. This is the only one that says "the wholetail cannot be
       priced, repairs are 14% of ARV and it needs a figure you have not
       given" — and it was nowhere in the thing advertising it.

     · THE LEFT COLUMN IS BOTTOM-ALIGNED. Fixed type, top-aligned, meant a
       four-line headline pushed 200px of dead space down the card while a
       two-line headline left a third of it empty. Anchored to the baseline,
       a long headline grows UP into air that was doing nothing anyway.

     · ONE SLOT TAKES TWO SHAPES. mode:'rows' is a sheet being priced;
       mode:'list' is the eight exits by name, for the page that argues about
       them. One template, and no headline is hand-tuned.

     Four things are sized to survive the ~300px thumbnail a feed actually
     renders: the wordmark and its rule, the headline, the green figure, and
     the pink refusal. Everything else is credibility for the second look. */
  /* The two flat fields the card's structure is made of, named once so the
     check after the squeeze can ask for them BY VALUE rather than guessing
     which light tones in the palette were meant to be panels. */
  OGFIELDS.push([255, 255, 255], [238, 241, 246]);        // the page, and the ledger's field
  const REFUSAL = ['Will not price', 'The wholetail',
                   'Repairs are 14% of ARV and it needs a figure you have not given.'];
  const SHEET = [['Asking', '$184,500'], ['ARV — sells for, fixed up', '$291,000'],
                 ['Repairs', '$41,300'], ['Exits priced', '7 of 8']];
  const EIGHT = [['Wholesale'], ['Fix and flip'], ['Wholetail'], ['Buy and hold'],
                 ['BRRRR'], ['Subject-to'], ['Novation'], ['The land play']];
  const CARDS = {
    /* the headline matches the page it advertises, and the page's headline is
       now the question rather than the benefit — a card promising one thing
       and a page opening with another is a bounce with extra steps */
    site: { eyebrow:'Underwriting · est. of record', tag:'The desk is free',
      head:'What should you pay for this house?',
      sub:'Eight ways to make money on the same house, each priced against the seller’s situation rather than the property’s — arithmetic shown, and the ones it cannot price named instead of guessed.',
      formNo:'Form D-1', mode:'rows', rows:SHEET,
      figEyebrow:'Best of the eight · the fix and flip', fig:'$23,280',
      figCap:'What the house pays you, line by line, at the price it says to offer.' },
    desk: { eyebrow:'The desk · underwriting worksheet', tag:'Free, no account',
      head:'Tell it four things. It prices eight.',
      sub:'The two hardest numbers in underwriting get done properly, every figure shows its working, and nothing is calculated until you say so.',
      formNo:'Form D-1', mode:'rows', rows:SHEET,
      figEyebrow:'Best of the eight · the fix and flip', fig:'$23,280',
      figCap:'What the house pays you, line by line, at the price it says to offer.' },
    plans: { eyebrow:'Plans', tag:'Pricing is free forever',
      head:'Pricing a property is free.',
      sub:'A plan buys back the half hour: the condition read off your photographs, the comps pulled and scored, the street read, the lender packet with your name on it.',
      formNo:'Form D-1', mode:'rows', rows:SHEET,
      figEyebrow:'Best of the eight · the fix and flip', fig:'$23,280',
      figCap:'Free forever on the desk. A plan buys the typing, never the answer.' },
    exits: { eyebrow:'The eight exits', tag:'The argument',
      head:'The same house is worth eight different maximums.',
      sub:'The gap between the best exit and the worst is usually the entire margin. Ranked against the seller, not the property.',
      formNo:'Form D-1 · all exits', mode:'list', rows:EIGHT,
      figEyebrow:'Best of the eight · the fix and flip', fig:'$23,280',
      figCap:'One of the eight, on 1128 Marrow Lane. The page prices all of them.' },
    arcade: { eyebrow:'The arcade · free, no account', tag:'Ninety seconds',
      head:'Or train the instinct the fun way.',
      sub:'Three cabinets running the desk’s own arithmetic, with the clock and the money turned into a game. Same read, no account, nothing to buy.',
      formNo:'Form D-1', mode:'rows', rows:SHEET,
      figEyebrow:'Best of the eight · the fix and flip', fig:'$23,280',
      figCap:'The number the game teaches you to see before the sheet prints it.' },
    land: { eyebrow:'The land desk', tag:'The eighth exit',
      head:'Dirt is not a house with the house removed.',
      sub:'Frontage, slope, utilities, the flood zone at the exact coordinates, and the lots that actually sold — priced on their own arithmetic.',
      formNo:'Form L-1 · 1847 Saddleback', mode:'rows',
      rows:[['Acreage', '2.61 ac'], ['Zoning', 'RR — rural res.'], ['Finished lot', '$298,000'], ['Parcels', '5 of 7']],
      figEyebrow:'The number nobody publishes', fig:'$21,640',
      figCap:'What the parcel clears at the ask, after site work, carry and the sale.' },
    demo: { eyebrow:'See how it works', tag:'Nothing to fill in',
      head:'Five sheets, already worked.',
      sub:'Every exit priced or refused, every number showing where it came from, on properties that do not exist. Nothing here is a mock-up.',
      formNo:'Form D-1', mode:'rows', rows:SHEET,
      figEyebrow:'Best of the eight · the fix and flip', fig:'$23,280',
      figCap:'One of five worked examples. Open it and the real software prices it.' },
  };
  const cardPage = (c) => `<!doctype html><html><head><meta charset="utf-8">
<style>
@font-face{font-family:'Fraunces';src:url('file://${path.resolve(out, 'fonts/fraunces.woff2')}') format('woff2-variations');
 font-weight:100 900;font-style:normal;font-variation-settings:'WONK' 0}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#fff;overflow:hidden;
 font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
 color:#101725;display:grid;grid-template-columns:1fr 428px}
.l{padding:44px 46px 52px 60px;display:flex;flex-direction:column}
/* the mark, and the double rule that means a total is final — this product is
   styled as an instrument of record, and that convention is where it comes from */
.mk{display:flex;align-items:baseline;gap:9px}
.mk b{font-family:'Fraunces',Georgia,serif;font-variation-settings:'WONK' 0;font-weight:700;
 font-size:21px;letter-spacing:.085em}
.mk i{font-style:normal;color:#1f5fd0;font-size:11.5px;font-weight:800;letter-spacing:.2em;vertical-align:2px}
.rule{border-top:2px solid #101725;border-bottom:1px solid #101725;height:4px;margin-top:7px;width:268px}
.gap{flex:1 1 auto;min-height:16px}
.k{font-size:13px;font-weight:800;letter-spacing:.19em;text-transform:uppercase;color:#677187}
h1{font-family:'Fraunces',Georgia,serif;font-variation-settings:'WONK' 0;font-weight:700;
 font-size:55px;line-height:1.03;letter-spacing:-.024em;margin-top:15px;max-width:15ch}
.s{font-size:19px;line-height:1.47;color:#41495a;margin-top:19px;max-width:47ch}
.tag{align-self:flex-start;margin-top:22px;font-size:12px;font-weight:800;letter-spacing:.16em;
 text-transform:uppercase;color:#1f5fd0;background:#eaf0fc;border:1px solid #c3d4f5;
 border-radius:999px;padding:7px 14px}
/* ── A TINT IS NOT A STRUCTURE ────────────────────────────────────────────
   This column was #f6f8fb against a #fff page — nine units of difference, and
   the whole reason the ledger reads as a separate object. The build indexes
   every PNG to a 256-colour palette, and median cut splits boxes by span:
   two enormous flat fields nine units apart sit in one box and come out of it
   AVERAGED. So the shipped card had no second panel at all, while the HTML it
   was rendered from did. Invisible in the browser, invisible in review, and
   the only place it shows is the file that represents the company.
   The separation is a LINE and a real field now, not a whisper of tint. */
.r{background:#eef1f6;border-left:1px solid #d3d9e3;padding:40px 34px;display:flex;
 flex-direction:column;justify-content:center;gap:0}
.led{background:#fff;border:1px solid #d3d9e3;border-radius:14px;padding:20px 22px 22px;
 box-shadow:0 1px 2px rgba(16,23,37,.05)}
.fn{font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#677187;
 border-bottom:1.5px solid #101725;padding-bottom:9px}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;
 padding:9px 0;border-bottom:1px solid #e4e8ef}
.row .lb{font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#677187}
.row .vl{font-family:'Fraunces',Georgia,serif;font-variation-settings:'WONK' 0;font-weight:700;
 font-size:19px;font-variant-numeric:tabular-nums;white-space:nowrap}
.row.li .lb{font-size:14.5px;font-weight:600;letter-spacing:0;text-transform:none;color:#101725}
/* the same double rule, closing the column: everything above it is added up */
.dbl{border-top:2px solid #101725;border-bottom:1px solid #101725;height:4px;margin-top:10px}
/* GREEN IS MONEY THAT PAYS AND IT IS NOTHING ELSE, ANYWHERE IN THIS PRODUCT */
.win{margin-top:14px}
.win .k2{font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#177a4d}
.win .big{font-family:'Fraunces',Georgia,serif;font-variation-settings:'WONK' 0;font-weight:700;
 font-size:52px;color:#177a4d;letter-spacing:-.028em;line-height:1;margin-top:3px;
 font-variant-numeric:tabular-nums}
.win .p{font-size:12.5px;line-height:1.42;color:#41495a;margin-top:7px}
/* AND RED IS ONLY EVER A REFUSAL — never an error we caused, never urgency */
.no{margin-top:16px;background:#faeeec;border:1px solid #f0d2ce;border-radius:11px;padding:11px 13px}
.no .k3{font-size:9.5px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#b3372c}
.no .t{font-family:'Fraunces',Georgia,serif;font-variation-settings:'WONK' 0;font-weight:700;
 font-size:17px;color:#b3372c;margin-top:1px}
.no .why{font-size:12px;line-height:1.4;color:#41495a;margin-top:4px}
</style></head><body>
<div class="l">
 <div class="mk"><b>NEGOTIATION</b><i>INC</i></div>
 <div class="rule"></div>
 <div class="gap"></div>
 <div class="k">${c.eyebrow}</div>
 <h1>${c.head}</h1>
 <div class="s">${c.sub}</div>
 <div class="tag">${c.tag}</div>
</div>
<div class="r"><div class="led">
 <div class="fn">${c.formNo}</div>
 ${c.rows.map(r => `<div class="row${c.mode === 'list' ? ' li' : ''}"><span class="lb">${r[0]}</span>${
   r[1] ? `<span class="vl">${r[1]}</span>` : ''}</div>`).join('')}
 <div class="dbl"></div>
 <div class="win"><div class="k2">${c.figEyebrow}</div><div class="big">${c.fig}</div>
  <div class="p">${c.figCap}</div></div>
 <div class="no"><div class="k3">${REFUSAL[0]}</div><div class="t">${REFUSAL[1]}</div>
  <div class="why">${REFUSAL[2]}</div></div>
</div></div></body></html>`;

  const cp = await b.newPage({ viewport:{ width:1200, height:630 }, deviceScaleFactor:1 });
  for (const [slug, card] of Object.entries(CARDS)){
    await cp.setContent(cardPage(card), { waitUntil:'load' });
    /* the face has to be THERE before the shutter, or the card ships in
       Georgia and looks like a different company */
    await cp.evaluate(() => document.fonts.ready);
    await cp.waitForTimeout(120);
    await cp.screenshot({ path: path.join(out, 'og', `page-${slug}.png`) });
    OGCARDS.add(slug);
  }
  await cp.close();
  if (!OGCARDS.has('site'))
    throw new Error('the default link-preview card was not drawn — every share would fall back to nothing');
}

/* ══ THE BANKROLL, INJECTED ═══════════════════════════════════════════════
   arcade/bank.mjs is the one place the money is defined, and it is unit-tested
   under node. The four surfaces that touch it are standalone classic-script
   pages, so the module is inlined into each rather than fetched — a game
   should not wait on a network round-trip to know what you are worth, and a
   fourth copy of these rules maintained by hand is how three cabinets stop
   agreeing about one number.

   Same pattern as the land engine, and the same guard: a page that lost its
   marker fails the BUILD rather than shipping a cabinet whose money silently
   does nothing. */
const BANK_SRC = fs.readFileSync('arcade/bank.mjs', 'utf8').replace(/^export /gm, '');
const bankInto = (html, who) => {
  if (!html.includes('/*__ARCADE_BANK__*/'))
    throw new Error(who + ' lost its /*__ARCADE_BANK__*/ marker — the bankroll would not be defined');
  return html.replace('/*__ARCADE_BANK__*/', () => BANK_SRC);
};

// ── the game, told where its share links live ──────────────────────────────
let html = fs.readFileSync('portfolio.html', 'utf8');
html = html.replace('</head>', ICONS() + '</head>');
if (BASE) html = html.replace('</head>', `<meta name="ni-share-base" content="${BASE}/d">\n</head>`);
else html = html.replace('</head>', `<meta name="ni-share-base" content="d">\n</head>`);
html = html.replace('</head>', OG('Comp Run · Negotiation Inc',
  'Eight eras of ground, a daily street, and a phone that rings. The instinct, trained the fun way.', 'comp-run') + '</head>');
/* THE TYPEWRITER SURVIVED IN TWO OF THE FOUR ARCADE PAGES. The purge that took
   monospace out of the software went in through FONTS, and FONTS was wired to
   the hub and the drill and not to these two — the note above it even says the
   arcade keeps its own type, which was true of the hub and the drill for about
   a day and then stopped being true. So Elijah was looking at a floor where two
   cabinets are Fraunces and two are Georgia, two have letterspaced caps in a
   typewriter and two do not, and there is no reading of that which is on
   purpose. Both games now take the same face as everything else we ship. */
html = html.replace('</head>', FONTS + ARCADE + '</head>');
html = bankInto(html, 'portfolio.html (Comp Run)');
html = await minifyInline(html, 'index');
fs.writeFileSync(path.join(out, 'comp-run.html'), html);

/* ── cabinet 02: the daily street, standing on its own ────────────────────
   This was a mode reached by a hash inside the long game, which meant the two
   most different things on the arcade floor were the same URL. A cabinet you
   cannot link to, cannot bookmark and cannot lose a run in without leaving
   somebody else's save file behind is not a cabinet. It ships as its own
   page. */
let street = fs.readFileSync('daily-street.html', 'utf8');
street = street.replace('</head>', ICONS() + '</head>');
street = street.replace('</head>', OG('The Daily Street · Negotiation Inc',
  'Three streets, three minutes, one sealed offer each. The same houses for everybody who plays today.', 'daily-street') + '</head>');
for (const must of ['The Daily Street', 'href="arcade.html"', 'How it works'])
  if (!street.includes(must)) throw new Error('daily-street.html lost: ' + must);
if (/fonts\.googleapis|fonts\.gstatic|https?:\/\/cdn/.test(street)) throw new Error('daily-street.html reaches off-origin');
street = street.replace('</head>', FONTS + ARCADE + '</head>');
street = await minifyInline(street, 'street');
street = bankInto(street, 'daily-street.html');
fs.writeFileSync(path.join(out, 'daily-street.html'), street);

// ── the course ─────────────────────────────────────────────────────────────
// The Eight Exits ships beside the game. In the built copy its arcade link
// points at index.html, because that is what the game is called out there.
let course = fs.readFileSync('the-eight-exits.html', 'utf8');
course = course.replace(/href="portfolio\.html"/g, 'href="arcade.html"');
// its own nav now points at itself, and out there it is called exits.html
course = course.replace(/href="the-eight-exits\.html(#[a-z]*)?"/g, (m, h) => `href="exits.html${h||''}"`);
course = course.replace('</head>', ICONS() + '</head>');
course = course.replace('</head>', FONTS + '</head>');
course = course.replace('</head>', OG('The Eight Exits · Negotiation Inc',
  'Every way out of a property deal, with the arithmetic shown. Fifteen minutes. No email, nothing to buy.', 'exits') + '</head>');
course = await minifyInline(course, 'exits');
fs.writeFileSync(path.join(out, 'exits.html'), course);

// ── the desk ───────────────────────────────────────────────────────────────
let desk = fs.readFileSync('desk.html', 'utf8');
desk = desk.replace(/href="portfolio\.html"/g, 'href="arcade.html"');
desk = desk.replace(/the-eight-exits\.html/g, 'exits.html');
desk = desk.replace('</head>', ICONS() + '</head>');
desk = desk.replace('</head>', FONTS + '</head>');
desk = desk.replace('</head>', OG('The Desk · Negotiation Inc',
  'Type what you know about a property. The sheet runs every exit, shows its working, and says what it is estimating.', 'desk') + '</head>');
/* Rules that took a pass each to establish and would cost nothing to undo by
   accident. Asserted on the SOURCE, before minification, because the whole
   point is to catch an edit — not a mangled identifier.

   · An account is memory. `premium()` must not read `signedIn()` directly
     again; that is exactly how registering came to switch the product on.
   · The skip button stays dead. It taught readers the three screens were
     ceremony, and on a prefilled demo it produced a number nobody watched
     being made.
   · The condition panel writes the repair estimate itself. The apply button
     that used to sit there wrote invisibly and never saved. */
{
  const src = fs.readFileSync('desk.html','utf8');
  for (const must of ['function syncRepairs', 'S.repairsOwn', 'function onPlan',
                      'lockRow(', "location.hash||'').toLowerCase() === '#new'",
                      /* the comparison prices both sheets with the ONE engine — a forked
                         copy of exitsFor is the fastest way to two answers that disagree */
                      /* free-with-an-account has to be visibly different from
                         free-without-one, and the difference must not be a price */
                      'function renderGuestShell', 'Working as a guest', 'A free account adds',
                      'office.html?want=save', 'Second sheet — free',
                      /* renaming happens where the name is; the corner text links are gone */
                      'function startRename', 'function armRemove', 'class="pt-b"',
                      'function priceProp', 'function flipPoints', 'function topCeil',
                      "'#compare'", 'id="rn-cmp"', 'function wireDeck', 'data-slot=', 'class="deck"',
                      /* a locked feature has to name the plan that has it — "Pro" means
                         nothing once there are three of them */
                      "tier:'Underwriter'", "tier:'The Office'",
                      /* the packet, the boundary and the honest storage failure */
                      'function packetHTML', 'WHERE THE ARV CAME FROM', 'function renderCore',
                      "setTrouble(full ? 'quota'", 'function dumpSheets'])
    if (!src.includes(must)) throw new Error('desk.html lost a rule: ' + must);
  if (/function\s+exitsForProp|const\s+exitsForProp/.test(src))
    throw new Error('desk.html: the exit engine has been forked for the comparison');
  /* `.demo` is already a blue call-to-action in this stylesheet. Any new
     element that reuses the bare class inherits a blue background it never
     asked for — this exact collision has shipped twice. */
  if (/class="cmp-grid demo"/.test(src))
    throw new Error('desk.html: the comparison grid is wearing the .demo button');
  /* matched against rendered markup, not prose — the comments above these two
     retirements explain why they went, and a comment is not a regression */
  for (const never of ['>Skip to the answer<', 'id="s-run2"', '>Use as the repair estimate<',
                       '<span class="tag pro">Pro</span>', "state:'pro'",
                       /* a second sheet is free — asking for money here was a funnel bug */
                       "plans.html#properties", 'prompt(\'Name this property'])
    if (src.includes(never)) throw new Error('desk.html brought back a retired device: ' + never);
  /* A refusal is the sheet's strongest opinion and has to look like one. It
     shipped for weeks as grey-on-grey, indistinguishable from a caption. */
  if (!/flag ref">Refused</.test(src)) throw new Error('desk.html: the refusal flag lost its word');
  if (!/\.flag\.ref\{[^}]*var\(--red\)/.test(src)) throw new Error('desk.html: the refusal flag is not red any more');
  /* The entitlement is a LEVEL now, but the invariant is unchanged: it is
     derived in exactly one place, from exactly one record, and an account on
     its own never buys anything. */
  /* ── THE SAME INVARIANT, ASSERTED IN BOTH PLACES IT LIVES ──────────────
     The entitlement is derived from exactly one record, and an account on its
     own never buys anything. desk.html holds one copy and shared/tier.mjs —
     which the Land Desk runs on — holds the other. They are not injected into
     each other on purpose (see the comment above TIERS in desk.html), so both
     are guarded here, and _tcross.mjs proves they agree by BEHAVIOUR. */
  const tier = src.match(/function tierOf\(\)\{[\s\S]{0,900}?\n\}/);
  if (!tier) throw new Error('desk.html: tierOf() is not where the build expects it');
  if (!/a\.plan/.test(tier[0]) || !/trialLeft\(\)/.test(tier[0]))
    throw new Error('tierOf() no longer reads the plan and the trial');
  {
    const t = TIER_SRC;
    const tf = t.match(/function tierFor\(acct, opts\)\{[\s\S]*?\n\}/);
    if (!tf) throw new Error('shared/tier.mjs: tierFor() is not where the build expects it');
    if (!/planTier\(acct\)/.test(tf[0]) || !/trialDaysLeft\(/.test(tf[0]))
      throw new Error('tierFor() no longer reads the plan and the trial');
    const pt = t.match(/function planTier\(acct\)\{[\s\S]*?\n\}/);
    if (!pt || !/acct\.plan/.test(pt[0]))
      throw new Error('planTier() no longer reads the plan off the account');
    if (!/if \(!k\) return 0;/.test(pt[0]))
      throw new Error('planTier(): a blank plan string buys a tier again');
    const ef = t.match(/function entitledFor\(acct, n, opts\)\{[\s\S]*?\n\}/);
    if (!ef) throw new Error('shared/tier.mjs: entitledFor() is not where the build expects it');
    if (!/if \(o\.demo\) return false;/.test(ef[0]))
      throw new Error('entitledFor(): a demo can spend money again');
    if (/preview/.test(ef[0]))
      throw new Error('entitledFor() consults the preview flag — a paint job is not a purchase');
    /* the asymmetry that decides whether an unrecognised plan label is worth
       anything: generous to PAINT, worth nothing to DECIDE. Routing entitled
       through the generous reading handed Solo to any string nobody knew. */
    if (!/paidTier\(acct\) >= n/.test(ef[0]))
      throw new Error('entitledFor() no longer uses the strict plan reading — an unknown label buys a tier');
    const st = t.match(/function paidTier\(acct\)\{[\s\S]*?\n\}/);
    if (!st || !/TIERS\[k\] \|\| 0/.test(st[0]))
      throw new Error('paidTier() went generous — that is the painting function\'s job');
    const gen = t.match(/function planTier\(acct\)\{[\s\S]*?\n\}/);
    if (!gen || !/TIERS\[k\] \|\| 1/.test(gen[0]))
      throw new Error('planTier() went strict — a legacy plan label would blank somebody\'s screen');
    const wf = t.match(/function whyNotFor\(acct, n, opts\)\{[\s\S]*?\n\}/);
    if (!wf || !/paidTier\(acct\)/.test(wf[0]))
      throw new Error('whyNotFor() reads a different tier than entitledFor() — the reason would not match the refusal');
  }
  const prem = src.match(/function premium\(\)\{[^}]*\}/);
  if (!prem) throw new Error('desk.html: premium() is not where the build expects it');
  if (/signedIn\(\)/.test(prem[0]))
    throw new Error('premium() reads signedIn() again — an account is memory, not a plan');
  if (!/atLeast\(1\)/.test(prem[0]))
    throw new Error('premium() stopped deriving from the tier ladder');
  /* Losing this is losing the whole sheet: a demo that persists overwrites the
     property somebody was working on, and "new sheet" that clears in place
     deletes it. Both shipped once. */
  /* Any class that sets its own `display` beats the browser's [hidden] rule.
     This has now shipped twice — an empty navy rail beside a stranger, and a
     28px red bar pinned to the bottom of every page. Every element in this
     file that is toggled with `hidden` needs the guard. */
  for (const cls of ['rail-nav', 'trouble'])
    if (!new RegExp('\\.' + cls + '\\[hidden\\]\\{display:none\\}').test(src))
      throw new Error('desk.html: .' + cls + ' can paint while [hidden] again');
  if (!/if \(DEMO\) return true;/.test(src))
    throw new Error('desk.html: a demo can write to storage again');
  if (!/function newSheet\(\)/.test(src) || !/P\.props\.push\(newProp\(\)\);\n    loadInto/.test(src))
    throw new Error('desk.html: "new sheet" no longer makes a new sheet');
}
desk = await minifyInline(desk, 'desk');
/* Eight ranked rows, each opening into its own arithmetic, and for a long
   time the only thing that said so was cursor:pointer — invisible until the
   mouse is on it, absent entirely on a phone. The chevron is the affordance;
   the rail track is the bug that let one long address spill the selected
   property's fill out over the sheet. */
for (const must of ['.exit-h .chev', 'class="chev" aria-hidden', '[aria-expanded="true"] .chev',
                    'grid-template-columns:minmax(0,1fr)'])
  if (!desk.includes(must)) throw new Error('desk.html lost a control affordance: ' + must);
/* ── the four things that were unreadable ─────────────────────────────────
   The ledger: "how it got there" as a sum on paper rather than two 13-px grey
   sentences. The jump: a row that names a missing number opens the step that
   holds it instead of calling focus() into a hidden div. The sample chip: a
   demo, an arcade hand-off or a lesson's figures say so wherever the property
   is named. The bench: two, three or four by plan, and the locked seat names
   the plan. Each of these is one careless refactor from reverting to a version
   that LOOKS fine and silently is not, which is why they are assertions. */
/* checked against the MINIFIED page, so the patterns are whitespace-free —
   terser leaves top-level names alone but eats every space around them */
for (const must of [/ledHTML=/, /class="led"/, /class="lrow/, /The cost of holding it/,
                    /\.askfor\{animation/, /classList\.add\("askfor"\)/, /scrollIntoView/,
                    /sampleChip=/, /class="smp"/, /sample=\["demo","arcade","lesson"\]/,
                    /CMP_CAP=\[2,2,3,4\]/, /cmpMax=/, /lockedSlotHTML/,
                    /class="bench"/, /CMP\.picks/,
                    /* the deck is a tray at the BOTTOM: you lift a property up onto the
                       bench. Above it, you were dragging downward — the gesture every
                       operating system has spent thirty years teaching means "bin it". */
                    /class="tray"/, /\.tray\{position:fixed/, /drag one <b>up<\/b>/i,
                    /* the suggested order, and one press to seat it */
                    /function rankAll/, /rankbarHTML/, /id="cmp-take"/,
                    /* the bench is written down, or it empties every time you glance at a sheet */
                    /CMPKEY=/, /saveCmp/,
                    /* nmOf(-1) read .name off undefined: one unpriced sheet on the bench
                       threw a TypeError out of the verdict and took the screen with it */
                    /the others/])
  if (!must.test(desk)) throw new Error('desk.html lost a clarity fix: ' + must);
/* the flip walk is 324 passes through the engine and it used to run BEFORE the
   table painted, so every card press paid for it up front */
if (!/setTimeout\(\(\)=>\{if\(\w+!==FLIPTOK\)/.test(desk.replace(/\s/g,''))
    && !/FLIPTOK/.test(desk))
  throw new Error('desk.html: the flip walk is back on the render path');
/* "Read the condition" and "Price a property" pointed at the same blank step */
if (!desk.includes('#condition')) throw new Error('desk.html lost the condition route');
/* The offer is built from ONE exit's ceiling. For a long time the page never
   said which, so a reader who had decided on the BRRRR was handed the flip's
   maximum price. It names the exit, and it follows the one you choose. */
for (const must of [/function exitPickHTML/, /data-oexit=/, /offerExit/, /This offer is built for/i,
                    /\.oxp\{/])
  if (!must.test(desk)) throw new Error('desk.html: the offer stopped naming its exit: ' + must);
/* The privacy page says, in as many words, that one press hands you every
   sheet and one press deletes the lot. Writing that down and not shipping it
   is the exact thing regulators call a deceptive practice. Both surfaces. */
for (const [name, doc] of [['desk.html', desk]])
  for (const must of [/id="ac-exp"/, /id="ac-del"/, /id="ac-file"/, /function importSheets/,
                      /function wipeAll/, /acctRestore/])
    if (!must.test(doc)) throw new Error(`${name} lost a data right: ${must}`);
/* and the tray reserves its own height rather than guessing at 196px — a
   guess left the last rows of the table under it on a phone */
if (!/function fitTray/.test(desk)) throw new Error('desk.html went back to guessing the tray height');
/* ── PART V · THE ASK ──────────────────────────────────────────────────────
   The arithmetic ends at a number and the deal ends at a sentence. Four rules
   hold the drafts up, and every one of them is a promise on the plans page:
     · three drafts, all generated from offerModel() — never a second model
     · nothing claimed that the software cannot support (the financing picker
       exists precisely so "cash" is a statement the person made, not one the
       page invented)
     · the ceiling is never printed — that is your side of the table
     · an edit is never overwritten by a slider */
for (const must of [/function letterModel/, /function draftText/, /function draftEmail/,
                    /function draftLOI/, /function renderLetters/, /id="letters"/,
                    /id="wletter"/, /data-lt=/, /data-fin=/, /LT_TABS=/,
                    /not a contract and it binds neither of us/i,
                    /\.ltdirty\{/, /leadWith=/, /wantRank=/, /LT_PRICE=/])
  if (!must.test(desk)) throw new Error('desk.html lost the offer letter: ' + must);
/* the letter is Underwriter's, and free/Solo see the REAL opening line rather
   than a picture of one — a taste that is a screenshot is a lie about output */
if (!/class="lttaste"/.test(desk) || !/LEAD\[\w+\.rank\]\(\w+\)/.test(desk))
  throw new Error('desk.html: the letter gate stopped showing real output');
/* "This seller is buying the number itself first. Lead with that, not with
   your price." — a sentence that contradicted itself, on screen, for four of
   the six sellers, because price is the top weight for nearly all of them. */
if (/first\. Lead with that, not with your price\.`\);/.test(desk.replace(/\s+/g,' ')) &&
    !/leadWith/.test(desk))
  throw new Error('desk.html: the offer note went back to contradicting itself');
/* ── your name on it ───────────────────────────────────────────────────────
   The Office pays for the masthead. A packet that still says NEGOTIATION INC
   at the top after somebody paid $249 for it to say their name is the feature
   not shipping. And a plan that did not pay for it must not quietly get it. */
/* The privacy page promised photographs were "deleted within 24 hours",
   which meant writing a purge job. The service stores nothing at all, so the
   stronger promise replaced it — and the weaker one must not creep back,
   because it would describe a deletion job that does not exist, which is the
   exact thing regulators call a deceptive practice. */
/* ── THE LEGAL PERSON ──────────────────────────────────────────────────────
   "Negotiation Inc" is a product name. The party to the agreement is a
   registered company, and each of the three documents has to say so once,
   properly, or the short name is an unregistered trade name signing a
   contract — which is the single most reliable way to make a terms page
   unenforceable. Named in the terms (who it is between), the privacy page
   (who the controller is) and the billing page (what the bank will show). */
for (const f of ['terms.html','privacy.html','refunds.html']){
  const doc = fs.readFileSync(f, 'utf8');
  if (!/limited liability company trading as Negotiation Inc/.test(doc))
    throw new Error(f + ': the legal entity is not named — "Negotiation Inc" is signing on its own');
  if (/\bDelaware\b/.test(doc))
    throw new Error(f + ': the placeholder governing-law state is back');
}
{ const pv = fs.readFileSync('privacy.html', 'utf8');
  if (/within 24 hours/i.test(pv))
    throw new Error('privacy.html: the 24-hour purge promise is back, and there is no purge job');
  for (const must of [/never store the photograph/i, /nothing to delete/i,
                      /re-encoding is what removes the metadata/i])
    if (!must.test(pv)) throw new Error('privacy.html lost a photo promise: ' + must); }
/* ── THE ACCOUNT, ON A SERVER ──────────────────────────────────────────────
   Three invariants, and every one of them is the difference between an auth
   layer and the appearance of one:

     · THE PLAN IS SERVER TRUTH. The client reads `profiles.plan` and never
       writes it. The moment a browser can set its own tier, there is nothing
       for a subscription to mean.
     · THE SERVICE ROLE KEY NEVER REACHES A BROWSER. Checked by shape at build
       time, because the way this goes wrong is pasting the wrong one of two
       keys that look identical into the wrong variable.
     · UNCONFIGURED IS THE OLD PRODUCT, EXACTLY. The site is live; a
       half-finished auth layer must not be able to lock anybody out of
       something that works today. */
/* ── AND THESE RUN AFTER THE FILES EXIST ──────────────────────────────────
   These three blocks read desk.html and office.html back off disk, on purpose:
   asserting against the MINIFIED, assembled output is the whole point, because
   that is what a browser gets. But they sat ABOVE the writes, so on every run
   they were reading the PREVIOUS build — a green build could ship a desk whose
   auth module had been gutted, and you would not find out until the run after.
   On a clean checkout with no dist/ at all they simply threw ENOENT, which is
   how this was finally noticed. Same assertions, same output, called once both
   files are actually on disk. */
const assertAccountAndBilling = () => {
  for (const f of ['desk.html','office.html']){
    const d = fs.readFileSync(path.join(out, f), 'utf8');
    for (const must of [/function authSignIn/, /function authBoot/, /function mergeSheets/,
                        /ni-session-v1/, /grant_type=refresh_token/])
      if (!must.test(d)) throw new Error(`${f}: the auth module is missing ${must}`);
    /* the client may PATCH its name and its market. If a plan ever appears in
       that payload the policy is the only thing left standing between a user
       and a free subscription — and policies get edited. */
    const push = d.match(/function pushProfile[\s\S]{0,700}/);
    if (!push) throw new Error(f + ': pushProfile is not where the build expects it');
    if (/\bplan\b/.test(push[0]))
      throw new Error(f + ': the client is writing a plan onto the profile');
    if (!/plan:\s*\w+\.plan\s*\|\|\s*null/.test(d.replace(/\s+/g,' ')))
      throw new Error(f + ': the cached plan is no longer taken from the server profile');
  }
  /* and signing out must end the SESSION, not merely forget the cache: a
     refresh token left on the machine quietly signs the next person back in */
  for (const f of ['desk.html','office.html']){
    const d = fs.readFileSync(path.join(out, f), 'utf8').replace(/\s+/g,'');
    /* Two of the worst bugs this product has had were "the fix was applied to
       a file that does not ship". _auth.js and _tail2a.js both contain this
       sync layer and NEITHER is built — this inline copy is the live one. So
       the build asserts the fixes are actually in the bytes. */
    for (const [needle, why] of [
      ['__propWire',     'the sync would upload the raw prop and strip every dollar figure on the other device'],
      ['deleteSheets',   'a deleted property would come back on the next visit'],
    ]) if (!d.includes(needle)) throw new Error('desk.html is missing ' + needle + ' — ' + why);
    if (!/__authSignOut/.test(d))
      throw new Error(f + ': sign-out does not end the server session');
  }
  /* ── THE PAYMENT RAIL, THE BROWSER HALF ────────────────────────────────────
     Two things, and the second one is the expensive one.

       · NOTHING HERE DECIDES A TIER. The browser asks for a checkout and asks
         what the plan is; it never sets one. If a `plan:` assignment ever
         appears in this file the whole server-truth design is decorative.
       · THE RETURN FROM STRIPE WAITS FOR THE WEBHOOK. The redirect beats the
         webhook nearly every time, so a page that reads the plan once shows a
         free account to somebody who has just been charged — and the next thing
         that person does is either email you or call their bank. */
  for (const f of ['desk.html','office.html']){
    const d = fs.readFileSync(path.join(out, f), 'utf8');
    const flat = d.replace(/\s+/g,'');
    for (const must of [/__checkout=/, /__portal=/, /\/api\/checkout/, /\/api\/portal/])
      if (!must.test(flat)) throw new Error(`${f}: the billing module is missing ${must}`);
    const back = d.match(/async function afterStripe[\s\S]{0,1800}/);
    if (!back) throw new Error(f + ': afterStripe is not where the build expects it');
    if (!/while\s*\(/.test(back[0]))
      throw new Error(f + ': the return from Stripe reads the plan once instead of waiting for the webhook');
    if (!/support@negotiationinc\.com/.test(back[0]))
      throw new Error(f + ': a payment the webhook never confirmed has nobody to email');
    /* the client setting its own plan, in any spelling */
    const pay = d.slice(d.indexOf('PAYING, FROM THE BROWSER'));
    if (pay && /\.plan\s*=|plan['"]?\s*:\s*['"](solo|underwriter|the office)/i.test(pay.slice(0, 6000)))
      throw new Error(f + ': the billing module is assigning a plan in the browser');
  }
};
/* ── THE PHOTO READ, THE BROWSER HALF ──────────────────────────────────────
   Four properties, each of which is the feature rather than a detail of it:
     · the bytes that leave are RE-ENCODED, which is the resize and the EXIF
       strip in one operation — a canvas has no metadata on the far side of a
       drawImage, so nobody's camera coordinates leave the machine
     · a line the read REFUSED is left exactly where it was and named on the
       page. Zeroing it, or filling it from the year built, would be the whole
       failure this product exists to refuse
     · the resulting figure is an ESTIMATE, wider than a walk-through, and
       wider still the less of the house was visible
     · the page cannot send a prompt, a system message or a model — the client
       posts images, house facts and a note, and nothing else */
for (const must of [/function shrink/, /createImageBitmap/, /imageOrientation:"from-image"|imageOrientation:'from-image'/,
                    /toDataURL\("image\/jpeg"|toDataURL\('image\/jpeg'/,
                    /function applyRead/, /function runRead/, /function photoReport/,
                    /id="ai-file"/, /id="ai-go"/, /x-ni-access/, /refusedIds/,
                    /left exactly where they were/i, /PHOTOKEY=/])
  if (!must.test(desk)) throw new Error('desk.html lost the photo read: ' + must);
/* a refused line must be LEFT, never zeroed — the branch that does it reads
   `else refused.push(...)` with no assignment to S.sys in it */
{ const ap = desk.match(/function applyRead\([\s\S]{0,700}/);
  if (!ap) throw new Error('desk.html: applyRead is not where the build expects it');
  /* exactly one assignment to S.sys in the whole function: the one on the
     branch where the read actually saw the thing */
  const writes = (ap[0].match(/S\.sys\[/g) || []).length;
  if (writes !== 1)
    throw new Error(`desk.html: applyRead writes to S.sys ${writes} times — a refused line is being guessed`); }
/* and the request body carries nothing the server does not read */
if (/body:JSON\.stringify\(\{[^}]*?(system|prompt|tools|max_tokens)/.test(desk.replace(/\s+/g,'')))
  throw new Error('desk.html: the client is trying to send a prompt to the proxy');
/* ── THE FIRST THREE MINUTES, AND YOUR MARKET ──────────────────────────────
   Two promises kept. The coach is three beats rather than a modal, because a
   modal teaches people to press Skip before reading. The market default is a
   FALLBACK and never a substitute: it fires only where the address has no ZIP
   of its own, it labels itself on the chip and in the provenance that follows
   it onto the packet, and it carries more uncertainty than the real ZIP —
   a default that quietly poses as a measurement is worse than no default. */
for (const must of [/COACHKEY=/, /function renderCoach/, /COACH_BEATS=/, /id="coach"/,
                    /id="co-off"/, /\.coach\[hidden\]\{display:none\}/,
                    /function marketZip/, /id="ac-mkt"/, /Your market/,
                    /from your saved market/])
  if (!must.test(desk)) throw new Error('desk.html lost the first run or the market default: ' + must);
/* an empty plan string is no plan. `TIERS[k] || 1` exists to be generous
   about a plan NAME we do not recognise; without the blank guard it handed
   Solo to anybody with a stray '' written to disk. Both surfaces. */
if (!/return\s*\w+\s*\?\s*TIERS\[\w+\]\|\|1\s*:\s*0/.test(desk.replace(/\s+/g,'')))
  throw new Error('desk.html: a blank plan string buys a tier again');
if (!/plan\.trim\(\)\?\(TIERS/.test(fs.readFileSync('office.html','utf8').replace(/\s+/g,'')))
  throw new Error('office.html: a blank plan string buys a tier again');
/* ── UNDERWRITING A LIST ───────────────────────────────────────────────────
   The Office's other half-week. Three things have to survive any refactor,
   and each of them is a way this feature could quietly become a lie:
     · it prices through priceProp(), not through a copy of the arithmetic
     · a draft is popped off in a `finally`, so a throw mid-list cannot leave
       phantom properties in somebody's workspace
     · the two triage guesses are marked as ESTIMATES (so the bands widen and
       the confidence drops exactly as a typed guess would) and the ranking
       uses the CAUTIOUS end of a guessed row's band — two assumptions that
       both run in your favour is how a list talks somebody into a drive. */
for (const must of [/function priceBatch/, /function bulkParse/, /function bulkDraft/,
                    /function renderBulk/, /id="bulk"/, /id="rn-bulk"/, /id="bk-text"/,
                    /data-bcol=/, /BULKKEY=/, /roomLo/, /at the cautious end/i])
  if (!must.test(desk)) throw new Error('desk.html lost bulk underwriting: ' + must);
if (!/finally\{P\.props\.length=/.test(desk.replace(/\s+/g,'')))
  throw new Error('desk.html: the bulk drafts are no longer popped off in a finally');
if (/function priceBatch[\s\S]{0,1400}?save\(\)/.test(desk))
  throw new Error('desk.html: priceBatch calls save() — a draft can become a sheet by accident');
/* both guesses write into the same est/prov/unc records a typed guess uses,
   which is what makes every downstream honesty consequence automatic */
for (const must of [/est\.arv=!0|est\.arv=true/, /est\.repairs=!0|est\.repairs=true/,
                    /median home value/, /not a walk-through and not a bid/])
  if (!must.test(desk.replace(/\s+/g,' ')))
    throw new Error('desk.html: a bulk guess stopped declaring itself: ' + must);
for (const must of [/function brandOf/, /id="ac-co"/, /id="ac-logo"/, /id="ac-lf"/,
                    /!atLeast\(3\)\)return null|atLeast\(3\)\)return null/,
                    /prepared with Negotiation Inc/i])
  if (!must.test(desk)) throw new Error('desk.html lost the branding: ' + must);

/* ── the buy box ───────────────────────────────────────────────────────────
   The Office plan sells the WEEK, and this is the part of a week that is
   actually expensive: the houses you drove to that were never going to work.
   Three things have to survive any refactor — the rules run, a rule it cannot
   check SAYS it could not (a silent pass is a wasted morning), and the switch
   belongs to the plan that sells it rather than leaking on a downgrade. */
for (const must of [/function boxCheck/, /function boxChip/, /BOX_DEFAULTS=/, /function renderBuyBox/,
                    /id="buybox"/, /id="rn-box"/, /id="boxsay"/, /skip:!0|skip:true/,
                    /\.on\|\|!atLeast\(3\)/])
  if (!must.test(desk)) throw new Error('desk.html lost the buy box: ' + must);
/* the rail's own property links are fragments on the page they live on, so a
   browser does not reload for them — without a hashchange branch the single
   most used control in the product is dead on the screen it was built for */
{ const hc = desk.slice(desk.indexOf('hashchange'), desk.indexOf('hashchange') + 900);
  if (!/#open=/.test(hc))
    throw new Error('desk.html: the rail property links stopped working from inside the desk'); }
/* the ledger replaced the old grey run-on entirely — if working:[] comes back
   there are two ways to render the same arithmetic and they will disagree */
if (/working:\[/.test(desk)) throw new Error('desk.html: the grey run-on arithmetic is back');
if (/CMP=\{a:null/.test(desk)) throw new Error('desk.html: the comparison went back to two fixed slots');
if (!/\.sample\b/.test(desk)) throw new Error('desk.html stopped storing where a sheet came from');
{ /* the arcade is a side door in the software: last in the rail, and labelled
     with what it is rather than with the name we gave it */
  const foot = desk.slice(desk.indexOf('class="rn-foot"'), desk.indexOf('class="rn-foot"') + 600);
  if (!/rn-lnk side/.test(foot)) throw new Error('the desk rail made the arcade a peer of the software again');
  if (foot.indexOf('arcade') < foot.indexOf('exits'))
    throw new Error('the desk rail leads with the optional thing again'); }
fs.writeFileSync(path.join(out, 'desk.html'), desk);

// priors ride along when they exist — and the script tag is injected only
// then, so a build without priors has no tag and logs no 404
if (fs.existsSync('priors.js')) {
  fs.copyFileSync('priors.js', path.join(out, 'priors.js'));
  // a URL, not the file: the desk fetches it only once an address yields a ZIP
  desk = desk.replace('</head>', '<script>window.NI_PRIORS_URL="priors.js"</script>\n</head>');
  fs.writeFileSync(path.join(out, 'desk.html'), desk);
}

// ── the land desk ──────────────────────────────────────────────────────────
/* The eighth exit's room. The engine is INJECTED from land/engine.mjs — the
   same bytes the test suite runs — so the page, the module and the design
   doc's ledger cannot drift apart. Then the build proves it: the module is
   imported right here and run on the page's own worked example, and the
   figures the design was approved on are asserted to the dollar. */
{
  let land = fs.readFileSync('land.html', 'utf8');
  const engineSrc = fs.readFileSync('land/engine.mjs', 'utf8').replace(/^export /gm, '');
  land = injectTier(land, 'land.html');
  if (!land.includes('/*__LAND_ENGINE__*/')) throw new Error('land.html lost the engine marker');
  land = land.replace('/*__LAND_ENGINE__*/', () => engineSrc);
  if (/^export /m.test(land)) throw new Error('land.html: an export survived the injection');

  const { landModel } = await import('./land/engine.mjs');
  const wim = landModel({
    asking:{ v:214000, prov:'entered' }, acres:{ v:2.61, prov:'entered' },
    finished:{ v:298000, prov:'estimate' }, siteLump:{ v:41500, prov:'estimate' },
    sewer:'unknown',
  });
  for (const [got, want, name] of [
    [wim.clears, 21640, 'clears'], [wim.ceiling, 200640, 'ceiling'],
    [wim.target, 35000, 'target'], [wim.perAcre, 81992, 'per-acre'],
    [wim.saleCost, 20860, 'cost of sale'],
  ]) if (got !== want) throw new Error(`land engine: ${name} is ${got}, the approved ledger says ${want}`);
  /* and the page's demo fixture is the same parcel the engine was proven on */
  for (const must of ["asking:'214,000'", "acres:'2.61'", "finished:'298,000'", "lump:'41,500'",
                      'sewer:\'unknown\'', '1847 Saddleback Pass'])
    if (!land.includes(must)) throw new Error('land.html demo fixture lost: ' + must);
  /* the floor rule: no Google credit without Google imagery. The tiles URL
     and the CDN loader live in SCRIPT — legitimate, they run only when the
     server says the ground is open. What may never exist is the word Google
     in the static MARKUP: credit belongs to imagery, and the flat page shows
     none. So comments and scripts are stripped and the visible document is
     checked. */
  const visible = land.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');   // rules and their comments are not text on a page
  if (/Google|gstatic|googleapis/i.test(visible))
    throw new Error('land.html shows Google credit in static markup — credit belongs to rendered imagery');
  /* and the ground never arrives unpinned or unguarded */
  if (!/CESIUM_V = '\d+\.\d+'/.test(land)) throw new Error('land.html: the Cesium version is not pinned');
  if (!/api\/land\/config/.test(land)) throw new Error('land.html no longer asks the server before spending a tile session');
  if (!/showCreditsOnScreen: true/.test(land)) throw new Error('land.html lost the attribution flag — that is a terms violation, not a style choice');
  if (!/createGooglePhotorealistic3DTileset/.test(land))
    throw new Error('land.html is hand-building the tiles URL again — the helper owns the session token, and without it the root loads and nothing renders');
  if (!/CreditDisplay\.cesiumCredit/.test(land))
    throw new Error('land.html lost the ion-watermark clear — the floor is for the people whose imagery it is');
  if (!land.includes('--ground:#0A0F18')) throw new Error('land.html lost the dark-surface tokens');

  land = land.replace('</head>', ICONS() + '</head>');
  land = land.replace('</head>', FONTS + '</head>');
  land = land.replace('</head>', OG('The Land Desk · Negotiation Inc',
    'The eighth exit needs dirt. Price the dirt: what the finished lot sells for, what it costs to get there, and the most you can pay — with the working shown.', 'land') + '</head>');
  land = await minifyInline(land, 'land');
  fs.writeFileSync(path.join(out, 'land.html'), land);
}

// ── the landing ────────────────────────────────────────────────────────────
// The front door: ships as index.html, the game lives at /arcade.html.
let landing = fs.readFileSync('ni-landing-v3.html', 'utf8');
landing = landing.replace(/href="portfolio\.html"/g, 'href="arcade.html"');
landing = landing.replace(/href="the-eight-exits\.html(#[a-z]*)?"/g, (m, h) => `href="exits.html${h||''}"`);
landing = landing.replace(/href="desk-page"/g, 'href="desk.html"');   // masthead AND seam
// ── no THIRD-PARTY webfont ───────────────────────────────────────────────
// The rule was never "no webfonts", it was "nothing blocks first paint on a
// server we don't control, and no visitor's IP goes to a font CDN". Fraunces
// and JB Mono now ship from our own origin (see FONTS above), which satisfies
// both. A Google Fonts link sneaking back in still fails the build.
if (/fonts\.googleapis|fonts\.gstatic/.test(landing)) throw new Error('index.html requests a third-party webfont');
landing = landing.replace('</head>', ICONS() + '</head>');
landing = landing.replace('</head>', FONTS + '</head>');
// The build fails loudly rather than shipping a front door missing a limb.
for (const must of ['Know what to pay', 'href="demo.html"', 'href="arcade.html"',
                    'href="office.html"', 'href="plans.html"', 'art/door-now.png',
                    'art/demo-condition.png', 'getElementById(\'stage\')', 'Fraunces',
                    'Four jobs, one sheet', 'What it replaces',
                    /* Not the last word any more — the three doors moved to the
                       top, so this carries a modifier now and an exact-match
                       needle went red for the move rather than for a fault.
                       What is being protected is that the doors EXIST and are
                       real links, which is what the two needles say. */
                    'class="finish', 'class="ways"', '<figure><a href="arcade.html">',
                    /* the front page has to say what a plan adds, not just link to it */
                    'class="adds"', 'plans.html#bid', 'plans.html#objections'])
  if (!landing.includes(must)) throw new Error('index.html lost: ' + must);
/* ── THE FRONT DOOR'S WEIGHT IS A FEATURE, AND FEATURES ROT ────────────────
   The six stage screenshots are stacked at opacity 0 inside the viewport, so
   `loading="lazy"` never deferred one of them: a phone downloaded 1.25MB to
   look at a single picture, before the headline painted. They are deferred by
   hand now (`data-src`, fetched one ahead of the reader) and they are PNG,
   which for screenshots of an interface is both smaller and sharper than
   JPEG. Both facts are load-bearing and neither is visible in a diff, so the
   build checks them. */
{
  const stage = landing.slice(landing.indexOf('id="stage"'), landing.indexOf('class="showbar"'));
  const eager = (stage.match(/\ssrc="/g) || []).length;
  if (eager !== 1)
    throw new Error(`index.html: ${eager} stage frames load eagerly — exactly one (the first) should`);
  if (/\.jpg/.test(stage))
    throw new Error('index.html: a stage frame is a JPEG again — these are screenshots of an interface, and PNG is both smaller and sharper for them');
  if (!/data-src="art\/demo-/.test(stage))
    throw new Error('index.html: the stage frames are no longer deferred');
  if (!landing.includes("matchMedia('(max-width:700px)')"))
    throw new Error('index.html: the carousel autoplays on a phone again');
}
/* ══ THE HERO IS A SCREENSHOT OF THE DESK, IN MARKUP ═══════════════════════
   It says so in its own comment, which is the problem: a comment cannot fail.
   The hero prints one sheet — 1128 Marrow Lane, the same one the desk loads
   from "Load a worked example" — so the two have to agree on the asking price,
   or the front door advertises an answer the product does not give.

   This caught it once already. The desk's payday panel learned to refuse a
   deal whose best exit lands more than 15% under the seller, and at the old
   $249,500 ask every exit on this sheet refused — while the landing went on
   showing a payday and the demo button opened on a closed door. */
{
  const dsrc = fs.readFileSync('desk.html', 'utf8');
  const m = dsrc.match(/Object\.assign\(S\.raw,\{asking:'([\d,]+)',arv:'([\d,]+)',repairs:'([\d,]+)'/);
  if (!m) throw new Error('index.html: cannot find the desk\'s worked example to check the hero against');
  for (const [what, v] of [['asking', m[1]], ['ARV', m[2]], ['repairs', m[3]]])
    if (landing.indexOf('\u0024' + v) < 0)
      throw new Error('index.html: the hero does not show the desk\'s ' + what + ' (' + v + '). ' +
        'The front door and the worked example are meant to be the same sheet.');
  for (const fig of ['23,280', '14,000', 'nine-thousand-dollar'])
    if (!landing.includes(fig)) throw new Error('index.html: the hero lost ' + fig);
  if (landing.includes('23,680'))
    throw new Error('index.html: the payline quotes 23,680, a figure the desk has never returned');
}
// The course left the front door on purpose: a company that leads with a course
// looks like it sells courses. The material lives on as the optional
// walk-through a new workspace is offered. If a link to it reappears out here,
// that decision has been undone by accident and the build should say so.
/* ── THE HERO READOUT IS PRESSABLE NOW, AND THE OLD RULES STILL APPLY ──────
   These three guards were written for five static rows and named the markup
   of that version, so they went red the moment the readout became eight
   buttons and a panel. The RULES they were protecting are unchanged and are
   the reason the first attempt at this hero had to be redrawn: a refusal must
   never be louder than the money, or the eye lands on the exits that fail
   before the ones that pay, and the landing looks nothing like the product it
   is advertising. Restated against the markup that exists. */
if (!/class="vfig"/.test(landing))
  throw new Error('index.html: the hero readout has no figure — the money left the front door');
{
  const px = (re) => { const m = landing.match(re); return m ? parseFloat(m[1]) : null; };
  const money   = px(/\.vfig\{[^}]*?font-size:([\d.]+)px/);
  const refusal = px(/\.vno \.vhead\{[^}]*?font-size:([\d.]+)px/);
  if (money === null || refusal === null)
    throw new Error('index.html: cannot measure the readout — the figure or the refusal lost its rule');
  if (!(refusal < money))
    throw new Error(`index.html: a refusal is set at ${refusal}px against ${money}px of money. `
      + 'A refusal is the smallest thing on the panel, not the biggest.');
  if (!/\.vfig\{[^}]*?color:var\(--green\)/.test(landing))
    throw new Error('index.html: the money stopped being green');
  /* the three ways of NOT answering are three different facts, and the page
     paints them apart on purpose: a figure it wants, a house it refuses, and a
     desk next door. If they collapse into one state the page is telling the
     same lie every other calculator tells. */
  for (const k of ['k-need', 'k-no', 'k-else'])
    if (!landing.includes(k))
      throw new Error('index.html: the readout lost its "' + k + '" state — the kinds of refusal have been flattened into one');
  const chips = (landing.match(/id:'[a-z]+', ?n:'/g) || []).length;
  if (chips !== 8)
    throw new Error(`index.html: the readout offers ${chips} exits and there are eight`);
}
for (const never of ['not part of the page', 'Notes back to Design', 'manila', 'seam-paper',
                     'href="exits.html"', '>Course<', 'Start the course'])
  if (landing.includes(never)) throw new Error('index.html still contains a retired device: ' + never);
landing = landing.replace('</head>', OG('Negotiation Inc',
  'Price every exit on one property, ranked against the seller, with the arithmetic shown. No account, nothing leaves your browser.', '') + '</head>');
/* The landing has behaviour again — the eight exits are pressable and the
   verdict panel re-renders from a table read out of desk.html. It is left
   unminified on purpose: it is four kilobytes, and it is the one script on
   this site a curious person might actually View Source on. */
fs.writeFileSync(path.join(out, 'index.html'), landing);


// ── plans: the feature ladder, with every row's state on it ──────────────
let plans = fs.readFileSync('plans.html', 'utf8');
plans = plans.replace(/href="portfolio\.html"/g, 'href="arcade.html"');
plans = plans.replace(/the-eight-exits\.html/g, 'exits.html');
plans = plans.replace('</head>', ICONS() + '</head>');
plans = plans.replace('</head>', FONTS + '</head>');
plans = plans.replace('</head>', OG('Plans · Negotiation Inc',
  'Pricing a property is free forever. A plan buys back the half hour: the photo condition read, comps pulled and scored, the lender packet, and a portfolio that remembers.', 'plans') + '</head>');
/* the page sells; one sentence at the top says it is pre-launch. Both have to
   survive, and the per-row hedging has to stay gone. */
/* Four tiers, and the two prices that carry the model. If a price string
   disappears from this page it has almost certainly disappeared inconsistently
   — the landing, the desk's upsells and the office all quote it too. */
/* No "pre-launch", no "under review", no "coming soon" anywhere a customer
   can see. The site is meant to look like the finished product; the caveats
   about what is not wired up yet belong in launch-plan.md, not on the page. */
{ /* matched against RENDERED markup, not the source's own comments — the
     comment explaining why the pill went is not the pill coming back */
  const visible = plans.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const never of ['class="prelaunch"', 'Pre-launch', 'pre-launch', 'under review', 'Coming soon'])
    if (visible.includes(never)) throw new Error('plans.html is hedging on the live site again: ' + never); }
for (const must of ['desk.html#new', 'class="spot"',
                    'id="compare"', 'Compare two deals', 'Where the answer flips',
                    /* the picture that answers "why would I pay" before the
                       prices, and the three doors that replaced two buttons */
                    'class="worth"', 'Seventy-six fields', 'class="ways"',
                    /* the two that shipped built and unadvertised */
                    'id="bid"', 'id="objections"', 'The other side of the table',
                    'class="founding"', '>Solo<', '$39', '$129', '$249',
                    '<th>Solo</th>', 'Two months free on annual',
                    '$1,290 a year'])
  if (!plans.includes(must)) throw new Error('plans.html lost: ' + must);
/* The desk prices SEVEN exits and tells you on the sheet that the eighth needs
   land. A plans page claiming eight is the marketing contradicting the product,
   and in a product whose entire pitch is "it shows its working" that is the
   most expensive kind of small lie. Same for "unlimited" properties against a
   hard cap of forty — forty is plenty, so say forty. */
if (/All eight exits priced/.test(plans))
  throw new Error('plans.html claims eight priced exits; the desk prices seven and says so');
if (/>Unlimited</.test(plans))
  throw new Error('plans.html says unlimited properties; the cap is forty');
if (/\$29 <small>/.test(plans) || /the plan is\s+twenty-nine/.test(plans))
  throw new Error('plans.html still quotes the retired $29 price');
if (/class="tier">in build/i.test(plans) || /s-soon/.test(plans))
  throw new Error('plans.html went back to hedging on every row');
/* The read shipped on 5 August 2026, pre-launch, and the price is simply
   $129. Two kinds of copy are banned here for the same reason: both narrate a
   history no customer lived through. "Until the photo read ships" claims the
   read does not exist (it does, it is metered and live). "It was $99" performs
   a price rise at people who never saw $99 (nobody did; the product had not
   launched). A page that asks for money states the price. It does not
   dramatise it. */
if (/photo (condition )?read ships\b/.test(plans) || /not shipped yet/.test(plans)
    || /It was \$99/.test(plans) || /then \$129/.test(plans))
  throw new Error('plans.html is narrating price history again — pre-launch there is none. The price is $129; say so and stop.');
/* ══ THE PLANS PAGE'S HEADLINE IS A NUMBER, SO IT IS COUNTED ═══════════════
   "Seventy-six fields decide what a house is worth" is a factual claim about
   the product, printed on the page that asks for money, on a site whose whole
   argument is that it does not make numbers up. So it is counted here, out of
   desk.html, and the build fails if somebody adds a condition line or a
   seventh assumption and the marketing goes on quietly saying seventy-six.

   The boxes are counted too. The picture IS the claim — a column of 76 empty
   boxes beside a column of 3 — so a drifting box count is a drifting claim
   rather than a cosmetic problem. */
{
  const src = fs.readFileSync('desk.html', 'utf8');
  const list = (open) => {
    const i = src.indexOf(open);
    if (i < 0) throw new Error('plans: cannot count ' + open + ' — desk.html moved it');
    return src.slice(i, src.indexOf('\n];', i));
  };
  const nLines  = (list('const LINES = [').match(/\{ g:'/g) || []).length;
  const nAssump = (list('const A_SPEC = [').match(/\n \{ id:'/g) || []).length;
  const nFields = (list('const FIELDS = [').match(/\n \{ id:'/g) || []).length;
  /* the eight a person types on one comp; id and use are not typed */
  const push = src.slice(src.indexOf('S.comps.push({'), src.indexOf('S.comps.push({') + 320);
  const COMP_TYPED = ['addr','price','sqft','beds','baths','sold','dist','cond'];
  const gone = COMP_TYPED.filter(k => !new RegExp('\\b' + k + ':').test(push));
  if (gone.length) throw new Error('plans: the comp lost a field the page counts: ' + gone);
  const nComp = COMP_TYPED.length, COMPS = 6;
  const TOTAL = nFields + nLines + nAssump + nComp * COMPS;
  if (TOTAL !== 76)
    throw new Error('plans.html says seventy-six fields; the desk now asks for ' + TOTAL +
      ' (' + nFields + ' house + ' + nLines + ' condition + ' + nAssump + ' assumptions + ' +
      nComp + '×' + COMPS + ' comps). Rewrite the headline and the labels, then move this number.');

  const wr = [...plans.matchAll(/<div class="wr([^"]*)">((?:<i><\/i>)+)<\/div>/g)]
              .map(m => ({ cls: m[1].trim(), n: (m[2].match(/<i>/g) || []).length }));
  const want = [['', nFields], ['', nLines], ['', nAssump], ['', nComp * COMPS],
                ['you', 3], ['done', nLines], ['done', nComp * COMPS], ['done', nAssump]];
  if (wr.length !== want.length)
    throw new Error('plans.html: expected ' + want.length + ' box rows in the picture, found ' + wr.length);
  want.forEach(([cls, n], i) => {
    if (wr[i].cls !== cls || wr[i].n !== n)
      throw new Error('plans.html box row ' + i + ': drew "' + wr[i].cls + '"×' + wr[i].n +
                      ', the desk says "' + cls + '"×' + n);
  });
  const left = wr.slice(0, 4).reduce((a, r) => a + r.n, 0);
  if (left !== TOTAL) throw new Error('plans.html: the left column draws ' + left + ' boxes, not ' + TOTAL);
}
/* ══ EVERY METERED FEATURE HAS TO BE ON THE PAGE THAT ASKS FOR MONEY ═══════
   The bid check and the objections panel shipped built, tested, metered and
   completely unadvertised: two of the five things a subscription buys were
   invisible on the only page where somebody decides whether to buy one. That
   is not a marketing oversight, it is revenue left on the floor, and it
   happened because "add it to the plans page" was a thing to remember.

   So it is a thing the build knows. billing.js is the register of what a plan
   includes; this reads it and refuses to ship a plans page that does not name
   every entry, at the right monthly number, for both tiers that get one.

   Adding a sixth feature now fails the build until the page sells it. */
{
  const bill = fs.readFileSync('srv/billing.js', 'utf8');
  const i0 = bill.indexOf('const CAP_DEFAULT = {');
  const block = bill.slice(i0, bill.indexOf('};', i0));
  const caps = {};
  for (const m of block.matchAll(/^\s*(\w+):\s*(\d+),/gm)) caps[m[1]] = Number(m[2]);
  if (Object.keys(caps).length < 3)
    throw new Error('plans.html: could not read CAP_DEFAULT out of billing.js — the register moved');

  /* the row on the page that sells each one. If a feature is added to
     billing.js and not to this map, the build says so rather than the page
     quietly not mentioning it. */
  const SOLD = {
    airead:    'Photo condition reads a month',
    aistreet:  'Street briefs a month',
    aicompare: 'Written comparisons a month',
    aibid:     'Bid checks a month',
    ailetter:  'The other side of the table, a month',
    aiintake:  'Reading the paperwork, a month',
    /* one meter, two things it buys — the comp pull and the rent lookup are
       each one RentCast request on our key, so they share an allowance and the
       page names it once. It used to be called "Comps pulled and scored, a
       month", which was two mistakes in one label: they arrive UNSCORED, and
       the row is now also what pays for the rent. */
    aicomps:   'Property lookups a month',
  };
  for (const feat of Object.keys(caps)){
    const label = SOLD[feat];
    if (!label) throw new Error(
      `billing.js meters "${feat}" and plans.html has no row for it. A feature nobody can see is `
      + 'a feature nobody buys — add the row, then add it here.');
    const i = plans.indexOf('<b>' + label + '</b>');
    if (i < 0) throw new Error(`plans.html lost the row that sells ${feat}: "${label}"`);
    const row = plans.slice(i, plans.indexOf('</tr>', i));
    /* Underwriter gets the base number, The Office three times it — the same
       arithmetic capFor() does, asserted against what the page prints */
    for (const [tier, n] of [['Underwriter', caps[feat]], ['The Office', caps[feat] * 3]])
      if (!new RegExp('>' + n + '<').test(row))
        throw new Error(`plans.html: ${feat} is metered at ${caps[feat]} a month, so ${tier} should `
          + `read ${n} — the row says "${row.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()}"`);
  }

  /* and the number in the headline is counted rather than remembered */
  const spots = (plans.match(/class="spot"/g) || []).length;
  const WORD = { 5:'Five', 6:'Six', 7:'Seven', 8:'Eight', 9:'Nine', 10:'Ten', 11:'Eleven', 12:'Twelve' };
  const said = (plans.match(/<h2>(\w+) things that give you the afternoon back\.<\/h2>/) || [])[1];
  if (said !== WORD[spots])
    throw new Error(`plans.html says "${said} things that give you the afternoon back" and draws `
      + `${spots} of them. It said "Six" while drawing seven for a while, which is the kind of small `
      + 'wrongness this whole product is selling against.');
}
fs.writeFileSync(path.join(out, 'plans.html'), plans);

// ── the three legal pages ─────────────────────────────────────────────────
/* Terms, privacy, billing. They ship as finished documents: no "under review",
   no "pre-launch", no square brackets waiting for a lawyer. Everything Elijah
   and a lawyer have to settle before launch lives in legal-review.md, which is
   a document, not a page — a site that hedges at you in the footer reads as a
   site that is not open for business.

   The assertions here are the promises. Each of these sentences is a
   commitment the product makes elsewhere — the desk really does keep free work
   in the browser, the plans page really does publish the price rise, the
   account panel really does export and delete. If one of them is edited out of
   a legal page the product starts lying, quietly, in the one place where that   matters most. */
{
  const LEGAL = [
    ['terms.html',   'Terms · Negotiation Inc',
     'What the software does, what it costs, and — the part that matters — what it is not. Not financial advice, not an appraisal, not a contractor bid.',
     ['This is not advice', 'is not an appraisal']],
    ['privacy.html', 'Privacy · Negotiation Inc',
     'Use the desk without an account and we collect nothing. With one we hold your email and your sheets. No analytics, no ad pixels, no data sold, no model trained on your deals.',
     ['no analytics', 'never train']],
    ['refunds.html', 'Billing & refunds · Negotiation Inc',
     'Fourteen days free with a card on file. Thirty days money back. Cancel in two clicks and keep working to the end of the period you paid for.',
     ['thirty days', 'cancel', 'price they joined at', 'card on file']],
  ];
  for (const [file, title, desc, promises] of LEGAL){
    let doc = fs.readFileSync(file, 'utf8');
    /* a legal page that hedges reads as a company that is not open yet */
    for (const never of ['under review', 'TBD', '[ ]', 'coming soon'])
      if (new RegExp(never.replace(/[[\]]/g, '\\$&'), 'i').test(doc.replace(/<!--[\s\S]*?-->/g, '')))
        throw new Error(`${file} is still hedging: ${never}`);
    /* and each one carries a promise the product keeps elsewhere */
    for (const promise of promises)
      if (!new RegExp(promise, 'i').test(doc))
        throw new Error(`${file} lost the promise it exists to make: ${promise}`);
    doc = doc.replace('</head>', ICONS() + '</head>');
    doc = doc.replace('</head>', FONTS + '</head>');
    doc = doc.replace('</head>', OG(title, desc, file.replace('.html', '')) + '</head>');
    fs.writeFileSync(path.join(out, file), doc);
  }
}

/* ── THE TRIAL IS SOLD ONE WAY, ON EVERY PAGE ──────────────────────────────
   The plans page said "card on file, nothing charged for 14 days". The
   workspace door said "No card. Fourteen days of the whole product come with
   it". The billing page said "every new account gets fourteen days of the full
   product". Three pages of one site describing the same fortnight in three
   incompatible ways, and the two that were wrong were the two a person reads
   BEFORE deciding — so somebody registers expecting the product and finds a
   free account.

   checkout now pins `payment_method_collection: 'always'` and the no-card
   grant column is off by default, so the code has one answer. This is the
   copy holding the same line: no page may promise the fortnight without a
   card. It is a crude check on purpose — a sentence that puts "no card" within
   eighty characters of the trial is a sentence worth re-reading, and the two
   legitimate uses ("no card to open it", "no card, no account" about the free
   desk) do not mention the fourteen days at all. */
{
  const NEAR = /(no card|without a card|card is not|never asks for a card)/i;
  /* by SOURCE filename — the landing page is ni-landing-v3.html until the
     build renames it, and a guard that reads dist/ checks the thing after it
     is too late to stop */
  for (const f of ['plans.html', 'office.html', 'refunds.html', 'terms.html',
                   'ni-landing-v3.html', 'demo-page.html']){
    /* HTML comments and JS block comments both come out: this checks the copy
       a person reads, and a note to the next developer is not a promise to a
       customer. It found a stale one on the way past all the same — office's
       offer panel was still described as "one button, no card" long after the
       button started leading to a checkout that takes one. */
    const doc = fs.readFileSync(f, 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of doc.matchAll(/(fourteen days|14 days|14-day|fourteen-day)/gi)){
      const around = doc.slice(Math.max(0, m.index - 80), m.index + 80);
      if (NEAR.test(around))
        throw new Error(`${f} sells the trial without a card: "…${around.replace(/\s+/g,' ').trim()}…"`);
    }
  }
}

// ── the office: the signed-in side of the desk ─────────────────────────────
/* No og tags on purpose — it is behind a sign-in, so a link preview of it is
   a preview of somebody else's front door. */
{
  let office = fs.readFileSync('office.html', 'utf8');
  office = office.replace(/href="portfolio\.html"/g, 'href="arcade.html"');
  office = office.replace(/the-eight-exits\.html/g, 'exits.html');
  office = office.replace('</head>', ICONS() + '</head>');
  office = office.replace('</head>', FONTS + '</head>');
  /* the same ZIP priors the desk uses — the office prices sheets too */
  if (fs.existsSync('priors.js'))
    office = office.replace('</head>', '<script>window.NI_PRIORS_URL="priors.js"</script>\n</head>');
  for (const must of ['id="rail-nav"', 'plans.html', 'desk.html'])
    if (!office.includes(must)) throw new Error('office.html lost: ' + must);
  fs.writeFileSync(path.join(out, 'office.html'), office);
}

// ── the arcade floor ───────────────────────────────────────────────────────
/* The select screen. "The arcade" that opens straight into one game is a game
   with an ambitious name; this is the floor the cabinets stand on. */
{
  let hub = fs.readFileSync('arcade-hub.html', 'utf8');
  hub = hub.replace(/href="portfolio\.html"/g, 'href="comp-run.html"');
  hub = hub.replace(/the-eight-exits\.html/g, 'exits.html');
  hub = hub.replace('</head>', ICONS() + '</head>');
  hub = hub.replace('</head>', FONTS + ARCADE + '</head>');
  hub = hub.replace('</head>', OG('The Arcade · Negotiation Inc',
    'Cabinets that train the read: Comp Run, the daily street, and the drills. Free, no account.', 'arcade') + '</head>');
  for (const must of ['comp-run.html', 'daily-street.html', 'exit-drill.html'])
    if (!hub.includes(must)) throw new Error('arcade.html lost a cabinet: ' + must);
  hub = bankInto(hub, 'arcade-hub.html');
  fs.writeFileSync(path.join(out, 'arcade.html'), hub);
}

// ── the demo: five sheets somebody else already filled in ──────────────────
{
  let demo = fs.readFileSync('demo-page.html', 'utf8');
  demo = demo.replace(/href="portfolio\.html"/g, 'href="arcade.html"');
  demo = demo.replace(/the-eight-exits\.html/g, 'exits.html');
  demo = demo.replace('</head>', ICONS() + '</head>');
  demo = demo.replace('</head>', FONTS + '</head>');
  demo = demo.replace('</head>', OG('See how it works · Negotiation Inc',
    'Six properties that do not exist, each with a different right answer — five houses and one piece of dirt. Open one and the real software prices it.', 'demo') + '</head>');
  /* ── THE FLOOR AND THE SHEETS CANNOT DRIFT APART ─────────────────────────
     Every card on this page promises a scenario that exists. The five house
     keys are read out of the desk's own DEMOS table, so adding a card
     without a sheet — or renaming a sheet and orphaning its card — fails the
     build rather than shipping a door that opens on nothing. */
  {
    const dsrc = fs.readFileSync('desk.html', 'utf8');
    const i0 = dsrc.indexOf('const DEMOS = {');
    const keys = [...dsrc.slice(i0, dsrc.indexOf('\n};', i0)).matchAll(/^\s(\w+):\s*\{/gm)].map(m => m[1]);
    if (keys.length < 5) throw new Error('demo floor: could not read the desk\'s DEMOS table');
    for (const k of keys)
      if (!demo.includes(`key:'${k}'`)) throw new Error(`demo.html has no card for the desk's "${k}" sheet`);
    for (const m of demo.matchAll(/key:'(\w+)'/g))
      if (m[1] !== 'land' && !keys.includes(m[1]))
        throw new Error(`demo.html offers "${m[1]}", which is not a sheet the desk can load`);
    /* the land card is the one that leaves the desk, so it is checked against
       the room it actually opens */
    if (!demo.includes("to:'land.html#demo=land'"))
      throw new Error('demo.html lost the land card\'s door');
    const lsrc = fs.readFileSync('land.html', 'utf8');
    if (!/#demo=land/.test(lsrc))
      throw new Error('land.html no longer answers the door the demo floor knocks on');
    if (!demo.includes('Five houses, and one piece of dirt'))
      throw new Error('demo.html headline no longer counts what is on the floor');
  }
  fs.writeFileSync(path.join(out, 'demo.html'), demo);
}

// ── the drill ──────────────────────────────────────────────────────────────
{
  let drill = fs.readFileSync('exit-drill.html', 'utf8');
  drill = drill.replace(/href="portfolio\.html"/g, 'href="arcade.html"');
  drill = drill.replace(/the-eight-exits\.html/g, 'exits.html');
  drill = drill.replace('</head>', ICONS() + '</head>');
  drill = drill.replace('</head>', FONTS + ARCADE + '</head>');
  drill = drill.replace('</head>', OG('Exit Drill · Negotiation Inc',
    'Sixty seconds, one house at a time: flip it, hold it, take the payments, run the listing, or walk.', 'exit-drill') + '</head>');
  drill = bankInto(drill, 'exit-drill.html');
  fs.writeFileSync(path.join(out, 'exit-drill.html'), drill);
}

/* ── the share pages ───────────────────────────────────────────────────────
   One per deed. A scraper wants meta tags and a human wants the game, so each
   one is a card for the first and a redirect for the second. Three ways out —
   a refresh, a link, and a script — because the one thing this page must not
   do is strand somebody who arrived from a group chat. */
for (const d of deeds){
  const tag  = `${d.eid}-${d.i}`;
  const ttl  = `${d.name} — ${d.era}${d.year === d.era ? '' : ', ' + d.year}`;
  const desc = 'One of forty pieces of ground across eight eras. Each one costs a whole career, and no sale ever takes it back.';
  const img  = BASE ? `${BASE}/og/${tag}.png` : `../og/${tag}.png`;
  const go   = `../comp-run.html?deed=${encodeURIComponent(d.eid + ':' + d.i)}&f=1`;
  fs.writeFileSync(path.join(out, 'd', `${tag}.html`),
`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${ICONS('../')}<title>${ttl} · Negotiation Inc</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:title" content="${ttl}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${ttl}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${img}">
<meta http-equiv="refresh" content="0; url=${go.replace(/&/g, '&amp;')}">
<link rel="canonical" href="./${tag}.html">
<style>html,body{margin:0;height:100%;background:#23201c;color:#8a8072;
font:14px ui-monospace,Menlo,monospace;display:flex;align-items:center;justify-content:center}</style>
</head><body>
<a href="${go.replace(/&/g, '&amp;')}" style="color:#a8873a">Opening the desk…</a>
<script>location.replace(${JSON.stringify(go)})</script></body></html>
`);
}

// ── the pictures ───────────────────────────────────────────────────────────
/* art/ is drawn by hand and lives in the repo. The jpgs ship as they are; the
   pngs go back through a canvas, which is a real saving on screenshots saved
   by a heavy encoder and costs nothing when it is not. */
fs.mkdirSync(path.join(out, 'art'), { recursive: true });
for (const f of fs.readdirSync('art')) fs.copyFileSync(path.join('art', f), path.join(out, 'art', f));
/* /favicon.ico is requested by name, with no link tag, by browsers and by
   every link-preview crawler. It has to be at the root or it is a 404 in
   somebody's log forever. */
fs.copyFileSync(path.join('art', 'favicon.ico'), path.join(out, 'favicon.ico'));
fs.writeFileSync(path.join(out, 'site.webmanifest'), JSON.stringify({
  name: 'Negotiation Inc', short_name: 'Negotiation',
  description: 'Price a property against eight exits. The sheet shows its working.',
  start_url: '/', display: 'standalone',
  background_color: '#101a2c', theme_color: '#101a2c',
  icons: [{ src:'art/icon-192.png', sizes:'192x192', type:'image/png' },
          { src:'art/icon-512.png', sizes:'512x512', type:'image/png' },
          { src:'art/apple-touch-icon.png', sizes:'180x180', type:'image/png' }],
}, null, 1) + '\n');

/* ── an indexed PNG, written by hand ────────────────────────────────────────
   The deed cards and the screenshots are flat colour: a few hundred distinct
   values across a million pixels. Truecolour PNG stores three or four bytes
   per pixel anyway, which is how 80 cards became 26 MB. Indexed PNG stores one
   byte and a palette, and for this kind of picture that is not a compromise —
   under 256 colours it is bit-exact.  */

const CRC = (() => { const t = new Int32Array(256);
  for (let n = 0; n < 256; n++){ let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c; } return t; })();
const crc32 = (buf) => { let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0; };

function chunk(type, data){
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Decode the only PNG shapes this build produces: 8-bit RGB or RGBA, no
 *  interlace. Anything else is handed back untouched rather than guessed at. */
function decodePNG(buf){
  if (buf.readUInt32BE(0) !== 0x89504E47) return null;
  let i = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (i < buf.length){
    const len = buf.readUInt32BE(i), type = buf.toString('ascii', i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR'){
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    i += len + 12;
  }
  if (depth !== 8 || interlace !== 0 || (ctype !== 2 && ctype !== 6)) return null;
  const bpp = ctype === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++){
    const f = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++){
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= bpp) ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4){
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xFF;
    }
  }
  return { w, h, bpp, px };
}

/** Median cut. Exact when the picture has 256 colours or fewer, which most of
 *  ours do; a nearest-neighbour map with a cache when it does not. */
function quantize(px, bpp, n = 256){
  const counts = new Map();
  for (let i = 0; i < px.length; i += bpp){
    const k = (px[i] << 24 | px[i+1] << 16 | px[i+2] << 8 | (bpp === 4 ? px[i+3] : 255)) >>> 0;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const uniq = [...counts.keys()];
  const unpack = k => [(k >>> 24) & 255, (k >>> 16) & 255, (k >>> 8) & 255, k & 255];
  if (uniq.length <= n) return { pal: uniq.map(unpack), exact: true, lookup: new Map(uniq.map((k, i) => [k, i])) };

  let boxes = [uniq];
  while (boxes.length < n){
    let bi = -1, best = -1;
    for (let i = 0; i < boxes.length; i++){
      if (boxes[i].length < 2) continue;
      let lo = [255,255,255,255], hi = [0,0,0,0];
      for (const k of boxes[i]){ const c = unpack(k);
        for (let j = 0; j < 4; j++){ if (c[j] < lo[j]) lo[j] = c[j]; if (c[j] > hi[j]) hi[j] = c[j]; } }
      const span = Math.max(hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2], hi[3]-lo[3]) * boxes[i].length;
      if (span > best){ best = span; bi = i; }
    }
    if (bi < 0) break;
    const box = boxes[bi];
    let lo = [255,255,255,255], hi = [0,0,0,0];
    for (const k of box){ const c = unpack(k);
      for (let j = 0; j < 4; j++){ if (c[j] < lo[j]) lo[j] = c[j]; if (c[j] > hi[j]) hi[j] = c[j]; } }
    let ch = 0, w = -1;
    for (let j = 0; j < 4; j++) if (hi[j]-lo[j] > w){ w = hi[j]-lo[j]; ch = j; }
    box.sort((a, b) => unpack(a)[ch] - unpack(b)[ch]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  const pal = boxes.map(box => {
    let s = [0,0,0,0], t = 0;
    for (const k of box){ const c = unpack(k), q = counts.get(k); t += q;
      for (let j = 0; j < 4; j++) s[j] += c[j] * q; }
    return s.map(v => Math.round(v / t));
  });
  const lookup = new Map();
  boxes.forEach((box, i) => { for (const k of box) lookup.set(k, i); });
  return { pal, exact: false, lookup };
}

/** Returns an indexed PNG, or null when indexing would not be an improvement. */
function squeezePNG(buf){
  const img = decodePNG(buf);
  if (!img) return null;
  const { w, h, bpp, px } = img;
  const { pal, lookup } = quantize(px, bpp);
  const idx = Buffer.alloc(h * (w + 1));
  let o = 0;
  for (let y = 0; y < h; y++){
    idx[o++] = 0;                                   // filter: none — indices do not gradient
    for (let x = 0; x < w; x++){
      const i = (y * w + x) * bpp;
      const k = (px[i] << 24 | px[i+1] << 16 | px[i+2] << 8 | (bpp === 4 ? px[i+3] : 255)) >>> 0;
      idx[o++] = lookup.get(k) ?? 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const plte = Buffer.alloc(pal.length * 3);
  pal.forEach((c, i) => { plte[i*3] = c[0]; plte[i*3+1] = c[1]; plte[i*3+2] = c[2]; });
  const parts = [Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
                 chunk('IHDR', ihdr), chunk('PLTE', plte)];
  if (pal.some(c => c[3] < 255))
    parts.push(chunk('tRNS', Buffer.from(pal.map(c => c[3]))));
  parts.push(chunk('IDAT', zlib.deflateSync(idx, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  const out = Buffer.concat(parts);
  return out.length < buf.length ? out : null;
}

const squeezeDirs = ['art', 'card', 'og'];
let rawBytes = 0, thinBytes = 0;
for (const dir of squeezeDirs){
  for (const f of fs.readdirSync(path.join(out, dir))){
    if (!/\.png$/i.test(f)) continue;
    const q = path.join(out, dir, f);
    const src = fs.readFileSync(q);
    rawBytes += src.length;
    const thin = squeezePNG(src);
    if (thin) fs.writeFileSync(q, thin);
    thinBytes += (thin || src).length;
  }
}

// ── what shipped ───────────────────────────────────────────────────────────
const dirBytes = (d) => fs.readdirSync(path.join(out, d))
  .reduce((a, f) => a + fs.statSync(path.join(out, d, f)).size, 0);
const bytes = [
  ...['index.html','arcade.html','comp-run.html','office.html','exits.html','desk.html']
      .map(f => [f, fs.statSync(path.join(out, f)).size]),
  ...['d','og','card'].map(d => [d, dirBytes(d)]),
];
const totalMB = +(bytes.reduce((a, [, n]) => a + n, 0) / 1048576).toFixed(2);
console.log(JSON.stringify({
  deeds: deeds.length,
  base: BASE || '(relative)',
  errs,
  squeeze: `${(rawBytes / 1048576).toFixed(1)} MB -> ${(thinBytes / 1048576).toFixed(1)} MB`,
  bytes, totalMB,
}, null, 1));


/* ── THE PAGE KNOWS YOU ──────────────────────────────────────────────────
   Appended to every page a signed-in person can reach: the masthead learns
   their name, the arcade floor learns their best run, and the calls to action
   stop asking somebody who already said yes. Lifted from the built output
   when the build script was rebuilt — it is the same bytes the site shipped. */
const KNOWSYOU = `<style>
.whoami{border:1px solid currentColor!important;border-radius:999px;padding:5px 12px!important;
 font-weight:650;opacity:.75;transition:opacity .13s;white-space:nowrap}
.whoami:hover{opacity:1}
</style>
<script>
(function(){
 var a=null; try{ a=JSON.parse(localStorage.getItem('ni-account-v1')); }catch(e){}
 if(!a || typeof a.name!=='string' || !a.name.trim()) return;
 try{
 var first=a.name.trim().split(/\\s+/)[0]||'You';
 document.body.classList.add('signedin');
 var hdr=document.querySelector('header')||document.body;

 var m=hdr.querySelector('a.mark,a.marklink');
 if(m){ m.setAttribute('href','office.html'); m.setAttribute('title','Your desk'); }

 /* "Sign in" is not a thing you do twice */
 var got=false, ls=hdr.querySelectorAll('a[href="office.html"]');
 for(var i=0;i<ls.length;i++){
  var t=(ls[i].textContent||'').trim().toLowerCase().replace(/[\\s\\u2192]+$/,'');
  if(t==='sign in'||t==='your desk'||t==='open a workspace'){
   ls[i].textContent=first+' \\u2192'; ls[i].className+=' whoami'; got=true; }
 }
 if(!got){
  var nav=hdr.querySelector('.masknav')||hdr.querySelector('nav');
  if(nav){ var l=document.createElement('a'); l.href='office.html';
   l.className='whoami'; l.textContent=first+' \\u2192';
   /* insertBefore wants a CHILD, and querySelector returns a descendant — on a
      masthead whose primary button is wrapped in a div that is a TypeError and
      the whole page's script dies with it. Anchor to the button's own parent. */
   var p=nav.querySelector('.btn');
   if(p && p.parentNode) p.parentNode.insertBefore(l,p); else nav.appendChild(l); }
 }

 /* the arcade floor, once it has met you */
 var eye=document.getElementById('ark-eye');
 if(eye){
  var best=0; try{ best=+(localStorage.getItem('ni-drill-best')||0)||0; }catch(e){}
  var R=[[0,'Door-knocker'],[450,'Bird dog'],[900,'Apprentice'],
         [1500,'Underwriter'],[2300,'Closer'],[3200,'The Desk']], nm='';
  for(var j=0;j<R.length;j++) if(best>=R[j][0]) nm=R[j][1];
  eye.textContent = best
    ? first+'\\u2019s floor \\u00b7 '+nm+' \\u00b7 best '+best.toLocaleString('en-US')
    : first+'\\u2019s floor \\u00b7 nothing played yet';
 }
 var out=document.getElementById('ark-out');
 if(out && out.parentNode){
  var b=document.createElement('a');
  b.href='office.html'; b.className='btn p'; b.textContent='Back to your desk \\u2192';
  out.parentNode.insertBefore(b,out);
  out.textContent='Price a property'; out.href='desk.html#new';
 }
 }catch(e){ try{ console.warn('account chrome', e); }catch(_){}}
})();
</script>
`;

/* ── THE ACCOUNT, ON A SERVER ────────────────────────────────────────────
   Sign-in, sign-up, the session refresh and the sheet merge. Only the two
   pages that need it get it — desk.html and office.html. */
const NIAUTH = `<script>
(function(){

/* ══ THE ACCOUNT, ON A SERVER ══════════════════════════════════════════════
   Until now an account was a record in localStorage with no password on it.
   That was honest about itself — the door said so in as many words — but it
   has two consequences that block everything else:

     · the plan is a field a stranger can edit in developer tools, so there is
       nothing for Stripe to write a subscription onto
     · "the portfolio on every device" is a promise the plans page makes and
       the software cannot keep

   This fixes both, and it does it with NO DEPENDENCIES. Supabase's auth and
   REST endpoints are plain HTTP; a client library would be forty kilobytes
   and a supply chain to shoulder for six fetch calls. The desk has no build
   step and no bundler, and it is not acquiring either for this.

   ── FOUR RULES ───────────────────────────────────────────────────────────

   1 · IT DEGRADES TO EXACTLY WHAT WAS THERE BEFORE. With nothing configured,
       every function here returns early and the product behaves precisely as
       it does today. The site is live; a half-finished auth layer must not be
       able to break it.

   2 · THE CACHE IS STILL localStorage. \`signedIn()\` stays synchronous and the
       nine hundred lines that call it do not change. What changes is WHERE
       the cache comes from: the server fills it, and the client never writes
       a plan into it.

   3 · THE PLAN IS SERVER-TRUTH, ALWAYS. \`profiles.plan\` is readable by its
       owner and writable only by the service role — which is the Stripe
       webhook and nothing else. Editing the cached copy in devtools buys you
       nothing past the next page load, which is the entire point.

   4 · SYNC IS LAST-WRITE-WINS PER PROPERTY, and the export format is the
       schema. A sheet is a blob with an id and a timestamp. Normalising it
       into columns would mean a migration every time a field is added, and
       there will be a lot of new fields. ══════════════════════════════════ */

/* ── WHERE THESE COME FROM, AND WHY IT CHANGED ─────────────────────────────
   They used to come from window.NI_SUPABASE_URL / NI_SUPABASE_ANON, written
   into every page at BUILD time. The build runs wherever the build runs, and
   that is not the machine holding the configuration — so the live site served
   pages with neither value while the SERVER had both. The server correctly
   demanded an account for every paid feature; the browser had no way to make
   one; the door silently fell back to a local-only workspace with no password
   and no sync, and looked entirely normal. Nothing anywhere said a word.

   The build-time values still WIN when present, because a preview build or a
   file:// copy has no server to ask. But when they are absent the module asks
   /api/config, which reads the same two variables from the process that
   actually holds them. A rebuild can no longer strip the account layer, and
   there is no second place to remember. */
const SB = {
  url: (window.NI_SUPABASE_URL || '').replace(/\\/+$/, ''),
  key: window.NI_SUPABASE_ANON || '',
};
/* Resolved before anything else runs. Everything downstream reads SB.url and
   SB.key through SB_ON(), never through a value captured at parse time. */
let SB_READY = (async () => {
  if (SB.url && SB.key) return true;              // baked in — nothing to ask
  /* A page opened from disk has no server to ask, and the attempt is not
     merely pointless: the browser logs "Fetch API cannot load file:///…" as a
     console error that no catch can suppress, and half this product's
     harnesses load pages over file:// and assert a clean console. */
  if (location.protocol === 'file:') return false;
  try {
    const r = await fetch('/api/config', { cache:'no-store' });
    if (!r.ok) return false;
    const j = await r.json();
    if (j && j.accounts && j.supabaseUrl && j.supabaseAnon){
      SB.url = String(j.supabaseUrl).replace(/\\/+$/, '');
      SB.key = String(j.supabaseAnon);
      return true;
    }
  } catch(e){}
  return false;
})();
window.__authReady = () => SB_READY;
/* ── AND THE PAGE IS TOLD, RATHER THAN HAVING TO ASK AT THE RIGHT MOMENT ───
   This module is appended at the END of the document, so anything in the
   page's own script that awaits window.__authReady() finds it undefined and
   falls through to the build-time globals — which is precisely the state that
   shipped. The door did exactly that and quietly stayed local-only.

   So the module CALLS the page instead. The hook is defined by the page's own
   script, which runs first, and is invoked once with the answer. No ordering
   to get right, in either direction. */
SB_READY.then(on => { try { if (typeof window.__authDoorInit === 'function') window.__authDoorInit(on); } catch(e){} });
/* The anon key is PUBLIC by design and is safe only because row-level
   security is on. SUPABASE.md has the policies; without them this key would
   let anybody read every row in the project. */
/* A FUNCTION, not a constant. It was evaluated once at parse time, which is
   before the answer from /api/config can possibly have arrived — so every
   caller would have seen false forever.
   (And the first version of this comment quoted the old line inside
   backticks. This whole module is a template literal, so a backtick in a
   COMMENT closes it and the build dies on the next keyword. Same class of
   mistake as the eaten backslash that deleted this module once already: in
   here, prose is code.) */
const SB_ON = () => !!(SB.url && SB.key);
const SESSKEY = 'ni-session-v1';
let SESS = null;
try { SESS = JSON.parse(localStorage.getItem(SESSKEY) || 'null'); } catch(e){}

const sbHead = (tok) => ({
  'content-type': 'application/json',
  apikey: SB.key,
  authorization: 'Bearer ' + (tok || SB.key),
});
const saveSess = s => {
  SESS = s;
  try { s ? localStorage.setItem(SESSKEY, JSON.stringify(s)) : localStorage.removeItem(SESSKEY); } catch(e){}
};

/* an access token that has not expired, refreshing it if it has */
async function token(){
  if (!SB_ON() || !SESS) return null;
  if (SESS.expires_at && Date.now() < SESS.expires_at - 60000) return SESS.access_token;
  if (!SESS.refresh_token) { saveSess(null); return null; }
  try {
    const r = await fetch(\`\${SB.url}/auth/v1/token?grant_type=refresh_token\`, {
      method:'POST', headers: sbHead(), body: JSON.stringify({ refresh_token: SESS.refresh_token }) });
    if (!r.ok){ saveSess(null); return null; }
    const j = await r.json();
    saveSess({ access_token:j.access_token, refresh_token:j.refresh_token,
               expires_at: Date.now() + (j.expires_in || 3600) * 1000, user: j.user });
    return SESS.access_token;
  } catch(e){ return null; }
}

/* ── signing up and in ─────────────────────────────────────────────────── */
/* ── WHERE A CONFIRMATION LINK GOES ────────────────────────────────────────
   Supabase sends it to the project's Site URL, which defaults to
   localhost:3000 and is easy to leave that way — the link works perfectly for
   whoever set the project up and for nobody else. Passing emailRedirectTo
   explicitly means the link points at the page it came from, on whatever
   origin that is, so a preview deploy and production each send people back to
   themselves. (The address must still be on Supabase's Redirect URLs
   allowlist; anything else is refused, which is the correct behaviour and the
   reason this is not a security hole.) */
const authBack = (page) => {
  try { return new URL(page, location.origin).toString(); }
  catch(e){ return undefined; }
};

async function authSignUp(email, password, name){
  if (!SB_ON()) return { ok:false, offline:true };
  try {
    const r = await fetch(\`\${SB.url}/auth/v1/signup\`, { method:'POST', headers: sbHead(),
      body: JSON.stringify({ email, password, data:{ name },
                             options:{ emailRedirectTo: authBack('office.html?confirmed=1') },
                             gotrue_meta_security:{} }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok:false, error: authSay(j) };
    /* With e-mail confirmation switched on Supabase returns a user and no
       session. That is not a failure — it is a person who has to go and click
       a link — and it has to read differently. */
    if (!j.access_token) return { ok:true, confirm:true };
    saveSess({ access_token:j.access_token, refresh_token:j.refresh_token,
               expires_at: Date.now() + (j.expires_in || 3600) * 1000, user:j.user });
    return { ok:true, user:j.user };
  } catch(e){ return { ok:false, error:'Could not reach the server.' }; }
}
async function authSignIn(email, password){
  if (!SB_ON()) return { ok:false, offline:true };
  try {
    const r = await fetch(\`\${SB.url}/auth/v1/token?grant_type=password\`, { method:'POST',
      headers: sbHead(), body: JSON.stringify({ email, password }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok:false, error: authSay(j) };
    saveSess({ access_token:j.access_token, refresh_token:j.refresh_token,
               expires_at: Date.now() + (j.expires_in || 3600) * 1000, user:j.user });
    return { ok:true, user:j.user };
  } catch(e){ return { ok:false, error:'Could not reach the server.' }; }
}
async function authSignOut(){
  const t = await token();
  if (t) try { await fetch(\`\${SB.url}/auth/v1/logout\`, { method:'POST', headers: sbHead(t) }); } catch(e){}
  saveSess(null);
}
/* upstream error text is written for developers; this is the one place it is
   turned into something a person can act on */
function authSay(j){
  const m = String((j && (j.msg || j.error_description || j.message || j.error)) || '').toLowerCase();
  if (/already registered|already been registered/.test(m)) return 'There is already an account on that email. Sign in instead.';
  if (/invalid login/.test(m))       return 'That email and password do not match an account.';
  if (/password/.test(m) && /short|least/.test(m)) return 'That password is too short — six characters or more.';
  if (/email/.test(m) && /invalid/.test(m)) return 'That email address is not valid.';
  if (/rate limit|too many/.test(m)) return 'Too many attempts. Wait a minute and try again.';
  return 'That did not work. Try again in a moment.';
}

/* ── the profile, which is where the PLAN lives ────────────────────────── */
async function pullProfile(){
  const t = await token(); if (!t) return null;
  try {
    const r = await fetch(\`\${SB.url}/rest/v1/profiles?select=name,market,plan,trial&limit=1\`,
      { headers: sbHead(t) });
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch(e){ return null; }
}
/* the client may write its name and its market. It may NOT write its plan —
   the policy refuses, and this simply never asks. */
async function pushProfile(patch){
  const t = await token(); if (!t) return false;
  const safe = {};
  if (typeof patch.name === 'string')   safe.name = patch.name.slice(0,60);
  if (typeof patch.market === 'string') safe.market = patch.market.slice(0,80);
  if (!Object.keys(safe).length) return true;
  try {
    const r = await fetch(\`\${SB.url}/rest/v1/profiles?id=eq.\${SESS.user.id}\`,
      { method:'PATCH', headers:{ ...sbHead(t), Prefer:'return=minimal' }, body: JSON.stringify(safe) });
    return r.ok;
  } catch(e){ return false; }
}

/* ── the sheets ────────────────────────────────────────────────────────────
   One row per property. The blob is the same object the export writes, which
   means the file somebody downloads and the row on the server are the same
   shape, and neither needs a migration when a field is added. */
async function pullSheets(){
  const t = await token(); if (!t) return null;
  try {
    const r = await fetch(\`\${SB.url}/rest/v1/sheets?select=pid,updated,blob&order=updated.desc\`,
      { headers: sbHead(t) });
    if (!r.ok) return null;
    return await r.json();
  } catch(e){ return null; }
}
async function pushSheets(rows){
  const t = await token(); if (!t || !rows.length) return false;
  try {
    const r = await fetch(\`\${SB.url}/rest/v1/sheets\`, { method:'POST',
      headers:{ ...sbHead(t), Prefer:'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.map(x => ({ ...x, uid: SESS.user.id }))) });
    return r.ok;
  } catch(e){ return false; }
}
/* ── A DELETE THAT DELETES ─────────────────────────────────────────────────
   There was no DELETE anywhere in this layer — only POST, PATCH and GET. So
   removing a property spliced it out of localStorage and left the row on the
   server, and the very next visit had mergeSheets find a remote pid with no
   local twin, decide it was a sheet from another device, and put it back. A
   deleted property came back on every load, and the same mechanism quietly
   undid "delete everything".

   Failure is soft on purpose: a delete that could not reach the network must
   not block the local one, because the local one is what the person just
   watched happen. A row that outlives its property is a far smaller problem
   than a UI that refuses to respond. */
async function deleteSheets(pids){
  const t = await token(); if (!t || !pids || !pids.length) return false;
  try {
    const list = pids.filter(x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(x));
    if (!list.length) return false;
    const q = 'pid=in.(' + list.map(encodeURIComponent).join(',') + ')';
    const r = await fetch(\`\${SB.url}/rest/v1/sheets?\${q}\`, { method:'DELETE',
      headers:{ ...sbHead(t), Prefer:'return=minimal' } });
    return r.ok;
  } catch(e){ return false; }
}
window.__deleteSheets = deleteSheets;

/* ── LAST WRITE WINS, PER PROPERTY ─────────────────────────────────────────
   Not per workspace. A person who edits one sheet on a phone and a different
   one on a laptop must end up with both, and a whole-workspace blob would
   silently drop one of them — which is the single most damaging bug a sync
   layer can have, because the person cannot tell it happened. */
function mergeSheets(local, remote){
  const by = new Map();
  for (const p of local) by.set(p.id, { p, at: +(p.updated || 0), from:'local' });
  for (const r of (remote || [])){
    const at = Date.parse(r.updated) || 0;
    const cur = by.get(r.pid);
    /* the RAW blob is kept beside the cleaned prop: cleanProp() builds a fresh
       property and copies only the keys it knows, so anything workspace-level
       riding along — the assumptions — is stripped before it can be read */
    if (!cur || at > cur.at) by.set(r.pid, { p: cleanProp(r.blob), raw: r.blob, at, from:'remote' });
  }
  const out = [...by.values()].sort((a,b) => b.at - a.at).slice(0, 40).map(x => x.p);
  /* ── AND THE ASSUMPTIONS COME BACK WITH THE NEWEST SHEET ─────────────────
     They are workspace-level, not per-property, so "last write wins per
     property" does not answer the question on its own — the newest sheet
     anywhere is the one that saw them last, and that is the answer. Only from
     a REMOTE row: a local one is already in P.adv, and re-applying it would
     overwrite a change made in this tab a second ago. Every value is
     re-validated against the slider that drew it on the way in. */
  let adv = null;
  const newest = [...by.values()].sort((a,b) => b.at - a.at)[0];
  if (newest && newest.from === 'remote' && typeof window.__advRead === 'function')
    adv = window.__advRead(newest.raw && newest.raw.adv);
  return { props: out, adv, pulled: [...by.values()].filter(x => x.from === 'remote').length };
}

/* ── the boot pass ─────────────────────────────────────────────────────────
   Fills the localStorage cache from the server, so that everything already
   written keeps reading a synchronous \`signedIn()\` and knows nothing about
   any of this. */
let AUTH_BOOTED = false;
/* the cache-fill on its own, so that the moment after a payment can ask again
   without re-running the sheet sync — see __authRefresh below */
async function fillFromServer(){
  const t = await token(); if (!t) return null;
  const prof = await pullProfile();
  if (prof){
    let a = null; try { a = JSON.parse(localStorage.getItem('ni-account-v1') || 'null'); } catch(e){}
    const next = { ...(a || {}),
      name: prof.name || (a && a.name) || (SESS.user && SESS.user.email) || 'You',
      email: (SESS.user && SESS.user.email) || (a && a.email) || '',
      market: prof.market || (a && a.market) || '',
      /* SERVER TRUTH. Whatever the cached copy said, this is what it is now —
         which is how a subscription that started on a laptop reaches a phone,
         and how a plan typed into devtools stops mattering. */
      plan: prof.plan || null,
      trial: prof.trial || null,
    };
    const changed = JSON.stringify(next) !== JSON.stringify(a);
    try { localStorage.setItem('ni-account-v1', JSON.stringify(next)); } catch(e){}
    if (changed && typeof window.__render === 'function') try { window.__render(); } catch(e){}
    return next;
  }
  return null;
}
async function authBoot(){
  if (!SB_ON() || AUTH_BOOTED) return;
  AUTH_BOOTED = true;
  await fillFromServer();
  /* a zero-spend read, so the comp workbench knows the week's balance before
     it draws the button rather than after somebody has pressed it */
  try { if (await window.__compUse(0)) {
    if (typeof window.__render === 'function') window.__render(); } } catch(e){}
  await syncSheets();
}
let SYNCING = false;
async function syncSheets(){
  if (!SB_ON() || SYNCING || typeof P === 'undefined') return;
  SYNCING = true;
  try {
    const remote = await pullSheets();
    if (remote){
      const m = mergeSheets(P.props, remote);
      if (m.pulled){
        P.props = m.props;
        /* the assumptions this account last set, on whichever device set them.
           Assigned INTO the existing object rather than replacing it, because
           S.adv is the same object by reference and half the arithmetic on the
           desk is already holding it. */
        if (m.adv) Object.assign(P.adv, m.adv);
        P.active = Math.max(0, Math.min(P.active, P.props.length - 1));
        loadInto(P.active); save();
        if (typeof window.__render === 'function') window.__render();
      }
    }
    await pushLocal();
  } finally { SYNCING = false; }
}
async function pushLocal(){
  if (!SB_ON() || typeof P === 'undefined' || !SESS) return;
  /* ── THROUGH THE DESK'S OWN SERIALISER ───────────────────────────────────
     This sent \`blob: p\` — the raw in-memory prop — while the loader on the
     other end restored figures only from the \`f\` map that save() builds. The
     prop has no \`f\`, so every money field arrived as NOTHING: sign in on a
     second device and the sheet came back with its name, address, comps and
     sliders, and asking, ARV, repairs, rent, balance, PITI and arrears all
     reading NEEDED. Then that device pushed the gutted blob back over the good
     row and both were ruined, silently, with no error.

     propWire is the one serialiser save() and the file export also use, so the
     shape we store and the shape we send cannot drift apart again — which is
     the only reason this was possible. */
  const wire = (typeof window !== 'undefined' && window.__propWire) || (x => x);
  const rows = P.props.map(p => ({ pid: p.id, updated: new Date(+(p.updated || Date.now())).toISOString(),
    blob: wire(p) }));
  await pushSheets(rows);
}
/* saving is a keystroke away from constant, so the push is debounced hard —
   a sync layer that fires on every character is a sync layer that gets you
   rate limited on the free tier */
let pushT = null;
function syncSoon(){
  if (!SB_ON()) return;
  clearTimeout(pushT);
  pushT = setTimeout(() => { pushLocal(); }, 4000);
}
/* ══ THE WEEKLY COMP ALLOWANCE ═════════════════════════════════════════════
   Scoring a comp costs nothing to run — it is arithmetic in this file's own
   process, not a model call — so this meter is not a cost control. It is the
   rung that was missing from the ladder: until now a FREE ACCOUNT bought you
   nothing at all on the comp workbench, which meant the best thing in the
   product gave nobody a reason to sign up.

   The count lives on the SERVER, in the profile, for one reason: a counter in
   localStorage is reset by clearing site data, and that is not a determined
   attack, it is something people do by accident. A column the browser cannot
   write is the difference between a limit and a suggestion.

   It cannot stop somebody who edits the JavaScript — nothing client-side can,
   and pretending otherwise would be the kind of security theatre this codebase
   avoids saying out loud. It stops the easy bypass, which is the one that
   actually happens.

   DEGRADES TO TODAY. If the function is not in the database yet — the site
   deploys before the SQL is run, which is the normal order — this returns null
   and the desk falls back to the free-tier limit it has always used. A missing
   migration must never lock somebody out of something that worked yesterday. */
let COMPQ = null;                    // last known {used, cap, remaining}
window.__compAllowance = () => COMPQ;
window.__compUse = async function(n){
  if (!SB_ON() || !SESS) return null;
  try {
    const t = await token(); if (!t) return null;
    const r = await fetch(SB.url + '/rest/v1/rpc/ni_use_comps', {
      method:'POST',
      headers: sbHead(t),
      body: JSON.stringify({ n: Math.max(0, Math.min(50, n|0)) }),
    });
    if (!r.ok) return null;          // no function yet, or a policy said no
    const j = await r.json();
    const row = Array.isArray(j) ? j[0] : j;
    if (!row || typeof row.remaining !== 'number') return null;
    COMPQ = { used: row.used|0, cap: row.cap|0, remaining: Math.max(0, row.remaining|0) };
    return COMPQ;
  } catch(e){ return null; }
};

/* an access token for the one service allowed to ask Stripe anything */
window.__authToken = token;
/* ── THE HEADER THAT PROVES WHO IS ASKING ─────────────────────────────────
   Any request to our own service that spends money or reveals a paid feature
   carries this, and the service re-derives the plan from it rather than
   believing anything the page says about itself. Returns an EMPTY object when
   there is no session, so the caller composes it unconditionally and an
   unconfigured build sends no header rather than sending "Bearer null". */
window.__authHeader = async function(){
  try { const t = await token(); return t ? { authorization: 'Bearer ' + t } : {}; }
  catch(e){ return {}; }
};
/* ask the server what the plan is NOW. The only caller that needs this is the
   moment somebody comes back from Stripe: the redirect and the webhook are
   racing each other, and the redirect usually wins. */
window.__authRefresh = fillFromServer;
window.__authBoot = authBoot;
window.__syncSoon = syncSoon;
window.__authSignIn = authSignIn;
window.__authSignUp = authSignUp;
/* ── THE THREE DOORS THAT WERE NOT THERE ───────────────────────────────────
   A product with accounts and no password reset is a product that loses a
   customer permanently the first time somebody forgets one — and they will,
   because this is a tool you open on a Tuesday every few weeks, which is
   exactly the interval at which people forget passwords.

   Supabase does all three; none of them was wired.

   Note what these DO NOT do: none of them says whether the address exists.
   "No account with that email" is a free membership check for anybody with a
   list, so all three answer the same way whatever happened — which is also
   the honest answer, because from here we genuinely do not know whether the
   mail was delivered. */
async function authRecover(email){
  if (!SB_ON()) return { ok:false, offline:true };
  try {
    const r = await fetch(\`\${SB.url}/auth/v1/recover\`, { method:'POST', headers: sbHead(),
      body: JSON.stringify({ email, options:{ emailRedirectTo: authBack('office.html?reset=1') } }) });
    /* a 429 is Supabase's rate limit and it is a real answer, not a failure of
       ours: saying "try again in a minute" is better than a shrug */
    if (r.status === 429) return { ok:false, error:'Too many attempts just now — wait a minute and try again.' };
    return { ok: r.ok || r.status === 200 };
  } catch(e){ return { ok:false, error:'Could not reach the server.' }; }
}
async function authResend(email){
  if (!SB_ON()) return { ok:false, offline:true };
  try {
    const r = await fetch(\`\${SB.url}/auth/v1/resend\`, { method:'POST', headers: sbHead(),
      body: JSON.stringify({ type:'signup', email,
                             options:{ emailRedirectTo: authBack('office.html?confirmed=1') } }) });
    if (r.status === 429) return { ok:false, error:'Too many attempts just now — wait a minute and try again.' };
    return { ok: r.ok };
  } catch(e){ return { ok:false, error:'Could not reach the server.' }; }
}
/* Setting the new one. Supabase puts a recovery token in the URL FRAGMENT, so
   it never reaches a server log — ours or anybody's — and the page has to read
   it out of location.hash and then remove it, because a token left in the
   address bar is a token in the next screenshot. */
function authResetToken(){
  try {
    const h = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    const t = h.get('access_token'), type = h.get('type');
    if (t && (type === 'recovery' || type === 'signup')) return { token:t, type };
    const e = h.get('error_description');
    /* a literal + is a space in a query fragment. split/join rather than a
       regex: this block lives inside a template literal, so a backslash gets
       eaten on the way through and /\+/ shipped as /+/ — "nothing to repeat",
       which threw at parse time and took the whole auth module with it. */
    if (e) return { error: e.split('+').join(' ') };
  } catch(err){}
  return null;
}
async function authSetPassword(token, password){
  if (!SB_ON()) return { ok:false, offline:true };
  try {
    const r = await fetch(\`\${SB.url}/auth/v1/user\`, { method:'PUT',
      headers: { ...sbHead(), authorization:'Bearer ' + token },
      body: JSON.stringify({ password }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok:false, error: authSay(j) };
    /* the recovery token IS a session — signing them straight in is the
       difference between "your password is changed, now go and use it" and
       being where they were trying to get to */
    saveSess({ access_token: token, refresh_token: j.refresh_token || null,
               expires_at: Date.now() + 3600 * 1000, user: j });
    return { ok:true, user:j };
  } catch(e){ return { ok:false, error:'Could not reach the server.' }; }
}
window.__authRecover = authRecover;
window.__authResend = authResend;
window.__authResetToken = authResetToken;
window.__authSetPassword = authSetPassword;

window.__authSignOut = authSignOut;
window.__authOn = () => SB_ON();
window.__mergeSheets = mergeSheets;


/* ══ PAYING, FROM THE BROWSER ══════════════════════════════════════════════
   Four small things, and one of them is the only interesting one.

   The interesting one: WHEN SOMEBODY COMES BACK FROM STRIPE, THE WEBHOOK HAS
   USUALLY NOT ARRIVED YET. Stripe redirects the browser and calls the webhook
   at roughly the same moment, and the browser almost always wins — it is one
   hop and the webhook is a queue. So the naive version of this page reads the
   profile, finds no plan, and tells somebody who has just been charged that
   they are on the free tier. They then either email you or ask their bank for
   the money back, and the second one costs $15 and a dispute rate.

   So \`?paid=1\` does not read the plan once. It waits for it, says so while it
   is waiting, and only gives up after twenty seconds — at which point it says
   something true and specific rather than showing a free account.

   Nothing here decides what anybody gets. \`tierOf()\` reads \`plan\` off the
   cached profile and the cached profile comes from the server. This file only
   ever asks a question. ═══════════════════════════════════════════════════ */

const PAY_ON = () => !!(window.__authOn && window.__authOn());

async function payFetch(path, body){
  const t = window.__authToken ? await window.__authToken() : null;
  if (!t) return { ok:false, error:'Sign in first.' };
  try {
    const r = await fetch(path, { method:'POST',
      headers:{ 'content-type':'application/json', authorization:'Bearer ' + t },
      body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok:false, error: j.error || 'That did not work just now.' };
    return j;
  } catch(e){ return { ok:false, error:'Could not reach the server.' }; }
}

/* ── start a subscription ───────────────────────────────────────────────── */
async function startCheckout(plan){
  if (!PAY_ON()) return { ok:false, error:'Subscriptions are not switched on yet.' };
  const r = await payFetch('/api/checkout', { plan });
  if (r.ok && r.url){ location.href = r.url; return { ok:true, going:true }; }
  return r;
}
/* ── cancel, change the card, read the invoices ─────────────────────────── */
async function openPortal(){
  if (!PAY_ON()) return { ok:false, error:'Subscriptions are not switched on yet.' };
  const r = await payFetch('/api/portal', {});
  if (r.ok && r.url){ location.href = r.url; return { ok:true, going:true }; }
  return r;
}

/* ── the wait ───────────────────────────────────────────────────────────── */
function payNote(msg, kind, action){
  let n = document.getElementById('paynote');
  if (!n){
    n = document.createElement('div'); n.id = 'paynote';
    n.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:22px;z-index:9999;'
      + 'max-width:min(560px,92vw);padding:12px 16px;border-radius:10px;font:15px/1.45 inherit;'
      + 'box-shadow:0 6px 28px rgba(0,0,0,.28)';
    document.body.appendChild(n);
  }
  n.style.background = kind === 'bad' ? '#3a1f1f' : '#1f2c24';
  n.style.color = '#f3efe6';
  n.style.border = '1px solid ' + (kind === 'bad' ? '#7a4040' : '#3d6b52');
  n.textContent = msg;
  /* ── A REFUSAL THAT NAMES THE DOOR SHOULD OPEN IT ─────────────────────────
     The server now refuses a second subscription to somebody who already has
     one — otherwise a stale ?join=underwriter bookmark billed them twice a
     month, indefinitely, and the product looked completely normal. The refusal
     says the change belongs in the billing portal. Saying that and then making
     them go and find it is how a correct answer still loses a customer, so the
     sentence carries the button. */
  if (action && action.label && typeof action.fn === 'function'){
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = action.label;
    b.style.cssText = 'display:block;margin-top:10px;padding:7px 13px;border-radius:8px;'
      + 'font:inherit;font-weight:600;cursor:pointer;color:#f3efe6;background:transparent;'
      + 'border:1px solid currentColor';
    b.onclick = () => { b.disabled = true; b.textContent = 'One moment…'; action.fn(); };
    n.appendChild(b);
  }
  return n;
}
async function afterStripe(){
  if (!PAY_ON()) return;
  const q = new URLSearchParams(location.search);
  if (!q.get('paid')) return;
  /* take it out of the address bar immediately: a refresh, a back button or a
     shared link must not re-enter this */
  try { history.replaceState(null, '', location.pathname); } catch(e){}

  payNote('Payment taken. Putting your subscription in place…');
  const t0 = Date.now();
  while (Date.now() - t0 < 20000){
    const a = window.__authRefresh ? await window.__authRefresh() : null;
    if (a && a.plan){
      payNote('You are on ' + a.plan + '. Everything it opens is open.');
      if (typeof window.__render === 'function') try { window.__render(); } catch(e){}
      setTimeout(() => { const n = document.getElementById('paynote'); if (n) n.remove(); }, 6000);
      return;
    }
    await new Promise(r => setTimeout(r, 1600));
  }
  /* Twenty seconds is a long time for a webhook, so this is either a Stripe
     backlog or something genuinely wrong. Either way the person HAS PAID, and
     the worst possible reply is a page that quietly shows a free account. */
  payNote('Your payment went through, but the confirmation has not reached us yet. '
        + 'Reload in a minute — and if it is still not here, email support@negotiationinc.com '
        + 'and it will be sorted the same day.', 'bad');
}

/* ── arriving from the plans page ───────────────────────────────────────────
   The plans page cannot start a checkout: nobody is signed in on it. So it
   sends people here with the plan they clicked, and this picks it up once
   there is a session to attach it to. */
async function joinFromQuery(){
  if (!PAY_ON()) return;
  const q = new URLSearchParams(location.search);
  const plan = (q.get('join') || '').trim().toLowerCase();
  if (!plan) return;
  try { history.replaceState(null, '', location.pathname); } catch(e){}
  const a = (typeof signedIn === 'function') ? signedIn() : null;
  if (!a) { try { sessionStorage.setItem('ni-join', plan); } catch(e){} return; }
  const r = await startCheckout(plan);
  if (!r.ok) payNote(r.error, 'bad', r.portal ? PORTAL_ACTION : null);
}
/* and the same thing again for somebody who had to sign up on the way */
async function joinAfterDoor(){
  if (!PAY_ON()) return;
  let plan = null; try { plan = sessionStorage.getItem('ni-join'); } catch(e){}
  if (!plan) return;
  try { sessionStorage.removeItem('ni-join'); } catch(e){}
  const r = await startCheckout(plan);
  if (!r.ok) payNote(r.error, 'bad', r.portal ? PORTAL_ACTION : null);
}
/* the one refusal that has somewhere for the person to go */
const PORTAL_ACTION = { label: 'Manage your plan', fn: async () => {
  const p = await openPortal();
  if (!p.ok) payNote(p.error || 'The billing portal could not be opened just now.', 'bad');
} };

window.__checkout   = startCheckout;
window.__portal     = openPortal;
window.__joinAfterDoor = joinAfterDoor;
window.__payNote    = payNote;
window.__payOn      = PAY_ON;

try{ authBoot(); }catch(e){ try{ console.warn('auth', e); }catch(_){} }
/* the two moments that only exist once money is involved: coming back from
   Stripe, and arriving from the plans page with a tier already chosen */
try{ afterStripe(); }catch(e){}
try{ joinFromQuery(); }catch(e){}
})();
</script>
`;

/* ── THE WAITLIST ────────────────────────────────────────────────────────
   Pre-launch only. It never silently loses an address: if the endpoint is
   unreachable it says so and hands over the mailbox, because a form that says
   thank-you into a void is worse than no form at all. */
/* ── THIS CARD BRINGS ITS OWN COLOURS ──────────────────────────────────────
   Every value here used to be var(--ink, #101725) — read the page's variable,
   fall back to a sane literal. That is the right pattern for something that
   belongs to a page and the wrong one for something INJECTED into eleven of
   them, because the card paints itself #fff and then borrows ink from
   whatever it landed on.

   On the arcade — a warm DARK theme whose --ink, --mid and --soft are tuned
   against #14100c — that put pale text on a white card. Measured: the status
   line, the one that says "You are on the list" or names the error, came out
   at 3.88:1. That is below AA, on the last step of the only funnel there
   currently is, and it read as fine on every light page so nothing noticed.

   A widget with its own surface owns its own palette. No var() below this
   line. The literals are the same ones the light pages use. */
const WAITLIST = `<style>
.wl{border:1px solid #c9d0dc;border-radius:16px;background:#fff;padding:15px 17px;text-align:left}
.wl .wt{display:block;font-family:Georgia,'Times New Roman',serif;font-size:17px;font-weight:700;color:#101725}
.wl .ws{display:block;font-size:12.5px;line-height:1.55;color:#3f4759;margin-top:5px}
.wl .ws b{color:#101725}
.wl .wf{display:flex;gap:7px;flex-wrap:wrap;margin-top:11px}
/* 16px, not 14 — under 16px iOS Safari zooms the whole page the moment the
   field takes focus, which on the one form that is the entire pre-launch
   funnel is a real cost. And 44px of height because this was a 30px target
   on a phone, which is smaller than a fingertip. */
.wl .wf input{flex:1 1 170px;min-width:0;font:inherit;font-size:16px;padding:10px 12px;border-radius:10px;
 min-height:44px;border:1px solid #c9d0dc;background:#fff;color:#101725}
.wl .wf input::placeholder{color:#6b7488;opacity:1}
.wl .wf input:focus{outline:none;border-color:#1f5fd0;box-shadow:0 0 0 3px #eaf0fc}
/* The card sets its own 16px corner and the field beside this button sets its
   own 10px one — but the button borrowed .btn from whatever page it landed on,
   and on the arcade, the course and the drill that class is square. So the one
   form the entire pre-launch funnel runs through was shipping a rounded field
   sitting against a sharp button, on three pages, and nothing greps for it
   because a square corner is an absence. The widget states its own corner. */
/* and the button's fill too, for the same reason: the arcade's blue is a
   lighter one, chosen to sit on a dark page, and white on it measured 4.71 */
.wl .wf button{flex:none;cursor:pointer;min-height:44px;padding-left:18px;padding-right:18px;border-radius:10px;
 background:#1f5fd0;border:1.5px solid #1f5fd0;color:#fff;font-size:13px;font-weight:650;letter-spacing:0;text-transform:none}
.wl .wf button:hover{background:#1a4fb0;border-color:#1a4fb0;color:#fff;transform:none;box-shadow:none}
/* side by side, a phone gives the address field about nine characters. Stack. */
/* ── flex:1 1 170px MEANS SOMETHING ELSE IN A COLUMN ──────────────────────
   The input carries flex:1 1 170px, which in the row layout is "at least
   170px wide, take the rest". Turn the container into a column and the basis
   becomes a HEIGHT — 170px of it, plus grow — so on every phone on the site
   the one control that captures an address was drawn as a 330px-tall empty
   box with the placeholder floating in the middle of it. Found in a
   screenshot, not by a harness: nothing was measuring the shape of a field,
   only whether it existed. */
@media(max-width:560px){.wl .wf{flex-direction:column;align-items:stretch}
 .wl .wf input,.wl .wf button{width:100%;flex:0 0 auto}}
.wl .wn{font-size:12px;line-height:1.45;margin-top:7px;min-height:1em;color:#4a5162}
.wl .wn.ok{color:#12633e} .wl .wn.bad{color:#a32a20}
.wl.done{border-color:#bfe0cd;background:#eaf6f0}
/* bare: the slot is inside a card that already has a border, a background and
   a heading of its own, so it brings none of those and only contributes the
   sentence and the field */
.wl.bare{border:0;background:none;padding:0;border-radius:0}
.wl.bare .ws{margin-top:0}
</style>
<script>
(function(){
 var SUPPORT='support@negotiationinc.com', KEY='ni-wait-v1';
 function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){
   return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function sent(){ try{ return localStorage.getItem(KEY)==='1'; }catch(e){ return false; } }
 function doneHTML(){ return '<div class="wl done"><span class="wt">You are on the list.</span>'+
   '<span class="ws">You will get one email the day it opens, and nothing else.</span></div>'; }
 /* The default sentence is written for somebody standing on the plans page,
    who has just read a price. A person who has been playing the arcade for
    ten minutes has not, and the same paragraph read to them is a non-sequitur
    that costs the capture. So a slot may carry its own line, and the ones that
    sit at the end of a game or a lesson do. */
 var LINE='The desk is <b>free and finished</b> \\u2014 pricing, the seven exits, the comparison, the print. '+
   'The paid tiers are being wired to a payment rail. Leave an address and you get <b>one</b> email the day they '+
   'open, with the founding price on it.';
 /* ── A SLOT THAT SITS INSIDE SOMETHING ELSE ───────────────────────────────
    The founding offer used to say "Claim a place" with a grey box directly
    beneath it headed "The paid desk opens soon." — a page arguing with itself
    about whether it is selling, which is exactly how it read to the first
    person who looked at it. There is now one block, not two: the offer states
    the price, and the field under it is the way to take it. A bare slot drops
    the heading, because the card it lives in already has one. */
 function formHTML(tier, line, bare){ return '<div class="wl'+(bare?' bare':'')+'">'+
   (bare ? '' : '<span class="wt">'+esc(tier)+' opens soon.</span>')+
   '<span class="ws">'+(line||LINE)+'</span>'+
   '<form class="wf"><input type="email" required placeholder="you@example.com" aria-label="Your email" '+
   'autocomplete="email" spellcheck="false"><button type="submit" class="btn p sm">Tell me when it opens</button></form>'+
   '<div class="wn" role="status"></div></div>'; }
 function wire(box, from){
  var f=box.querySelector('form'), note=box.querySelector('.wn');
  if(!f) return;
  function say(t,bad){ if(note){ note.textContent=t; note.className='wn'+(bad?' bad':' ok'); } }
  f.addEventListener('submit', function(ev){
   ev.preventDefault();
   var i=f.querySelector('input'), btn=f.querySelector('button');
   var email=(i.value||'').trim().slice(0,160);
   if(!/^[^@\\s]+@[^@\\s.]+\\.[^@\\s]{2,}$/.test(email)) return say('That does not look like an email address.',true);
   btn.disabled=true; say('Adding you\\u2026');
   fetch('/api/list',{method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify({email:email,from:from||'plans'})})
    .then(function(r){
      if(r.ok){ try{localStorage.setItem(KEY,'1');}catch(e){} box.outerHTML=doneHTML(); return; }
      throw new Error('list');
    })
    .catch(function(){
      say('The list is not reachable right now \\u2014 email '+SUPPORT+' and you will be added by hand.',true);
      btn.disabled=false;
    });
  });
 }
 /* ── WHERE DID THEY ACTUALLY COME FROM ────────────────────────────────────
    A link carrying ?r=reddit tags every address captured on that visit, so the
    ops page can say "eleven from the Reddit post, two from the plans page"
    without a single byte of tracking: nothing is recorded unless somebody
    chooses to type their address into a form. The privacy page promises there
    is no anonymous telemetry hiding behind its sentences, and that promise is
    worth more than an analytics dashboard.

    Sanitised here and again on the server, and short, because it becomes a
    column somebody reads. */
 function tag(){
  try {
   var m = /[?&]r=([^&]{1,24})/.exec(location.search);
   if (!m) return '';
   var t = decodeURIComponent(m[1]).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16);
   return t ? '-r-' + t : '';
  } catch(e){ return ''; }
 }
 function paint(){
  var slots=document.querySelectorAll('[data-waitlist]');
  for(var k=0;k<slots.length;k++){
   var el=slots[k], tier=el.getAttribute('data-waitlist')||'Paid plans';
   var from=(el.getAttribute('data-from')||'plans')+tag();
   el.innerHTML = sent() ? doneHTML() : formHTML(tier, el.getAttribute('data-line'), el.hasAttribute('data-bare'));
   if(!sent()) wire(el.firstChild, from);
  }
 }
 if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',paint); else paint();
})();
</script>
`;

/* Comp Run and the Daily Street take none of what follows: no stage flag, no
   masthead that knows you, no waitlist. They are played by people who are not
   signed in and are not being sold to mid-run. */
for (const f of ['index.html','desk.html','office.html','plans.html','exits.html','arcade.html',
                 'demo.html','exit-drill.html','terms.html','privacy.html','refunds.html',
                 /* land.html was missing from this list, which is why the Land Desk had no
                    account, no masthead and no wall — it was outside the product */
                 'land.html']){
  const q = path.join(out, f);
  let doc = fs.readFileSync(q, 'utf8');
  if (!doc.includes('</body>')) throw new Error(f + ': no </body> to append the account script to');
  /* the stage flag goes in the HEAD, because desk.html reads it while it is
     still deciding what to render */
  if (!doc.includes('</title>')) throw new Error(f + ': no </title> to put the stage flag after');
  doc = doc.replace('</title>', '</title>' + STAGEJS);
  doc = stage(doc, f);
  const needsAuth = (f === 'desk.html' || f === 'office.html' || f === 'land.html');
  /* stage() has already run, so any slot that only exists pre-launch is in the
     document by now — which means we can ask the honest question: does this
     page actually have somewhere to PUT a form? Eight of these twelve did not,
     and were shipping the card's stylesheet and its script to fill nothing.
     The four that do are the four the funnel lands on. */
  const wantsWaitlist = !LIVE && /data-waitlist=/.test(doc);
  /* ── A REPLACEMENT STRING IS NOT A STRING ────────────────────────────────
     String.replace treats $&, $`, $', $$ and $1 in the REPLACEMENT as
     patterns, not as characters. These three blocks are JavaScript, and
     JavaScript is full of dollars and backticks — the moment the auth module
     gained a template literal whose text survives to the page, one `$` + a
     backtick meant "insert everything before the match here", which silently
     ate the opening of the block before it and shipped a `catch` with no
     `try`. The whole account layer threw at parse time on the ONLY builds
     that have an account layer, so the unconfigured build looked fine.

     A replacer FUNCTION has no such patterns. Nothing else about this line
     changes, and now nothing that gets injected can corrupt what it lands in. */
  /* ── AND IT GOES AT THE *LAST* </body>, NOT THE FIRST ────────────────────
     String.replace with a string replaces the first match, and the first match
     is wherever the characters happen to appear — including inside a comment
     in the page's own JavaScript. A comment in office.html that used the words
     "appended before </body>" put the entire account layer INTO THE MIDDLE OF
     A COMMENT, truncating the main script at that point and leaving the
     closing brace of a `try` block stranded. The page threw at parse time,
     every auth function became undefined, and it happened only on builds that
     have an account layer — so the unconfigured build looked perfect.

     There is exactly one closing </body> in a document. Assert that, and split
     on the LAST one, and a page can talk about its own markup safely. */
  {
    const at = doc.lastIndexOf('</body>');
    if (at < 0) throw new Error(f + ': no </body> to append the account script to');
    /* prose may mention it; markup may not have two of them */
    const closers = (doc.match(/<\/body\s*>/gi) || []).length;
    if (closers > 1 && /<\/body\s*>[\s\S]*<\/body\s*>/i.test(doc.replace(/\/\*[\s\S]*?\*\//g, '')))
      throw new Error(f + ': two </body> tags in the markup — which one closes the document?');
    doc = doc.slice(0, at)
        + KNOWSYOU + (needsAuth ? NIAUTH : '') + (wantsWaitlist ? WAITLIST : '')
        + doc.slice(at);
  }
  fs.writeFileSync(q, doc);
}

/* Now, and not before: these read the assembled, minified files back off disk,
   which is the whole point of them — a browser gets the assembled file, so
   that is what gets asserted. */
assertAccountAndBilling();

/* ── THE STAGE, ASSERTED ──────────────────────────────────────────────────
   The flip is one environment variable, and this is what makes that safe:
   a half-launched site cannot be built, because the build refuses. */
{
  const built = fs.readFileSync(path.join(out, 'plans.html'), 'utf8');
  const marks = [];
  for (const f of ['index.html','desk.html','office.html','plans.html','arcade.html','exits.html']){
    const d = fs.readFileSync(path.join(out, f), 'utf8');
    if (/<!--\/?(SOON|LIVE)-->/.test(d)) marks.push(f);
  }
  if (marks.length) throw new Error('stage markers survived the build in: ' + marks.join(', '));

  if (LIVE){
    /* every page, not just this one. The stripping is structurally safe today
       — one ternary decides it for all twelve — but the assertion covered a
       single file, so a future edit that special-cased one page would ship a
       waitlist onto a live site and the build would still say yes. */
    for (const f of ['index.html','desk.html','office.html','plans.html','exits.html','arcade.html',
                     'demo.html','exit-drill.html','terms.html','privacy.html','refunds.html','land.html']){
      const d = fs.readFileSync(path.join(out, f), 'utf8');
      /* the needles have to be unique to the WAITLIST, and 'ni-wait-v1' is
         not: it is a localStorage key, and office.html lists it among the keys
         that "delete everything" clears. The pre-launch half of this guard had
         already been bitten by exactly that and fixed; this half had not, so
         the only two harnesses that build with NI_STAGE=live went red and the
         live build could not be produced at all. */
      if (/data-waitlist=|opens soon|Tell me when it opens|querySelectorAll\('\[data-waitlist\]'\)/i.test(d))
        throw new Error(`${f}: a live build still carries the waitlist — it catches people who came to buy`);
    }
    if (/window\.NI_LIVE=false/.test(built))
      throw new Error('plans.html: a live build is flagged pre-launch');
  } else {
    /* and pre-launch, the inverse pairing: a page carries the form AND the
       script that works it, or neither. A slot with no script is a dead box. */
    for (const f of ['index.html','desk.html','office.html','plans.html','exits.html','arcade.html',
                     'demo.html','exit-drill.html','terms.html','privacy.html','refunds.html','land.html']){
      const d = fs.readFileSync(path.join(out, f), 'utf8');
      /* the needle has to be unique to the SCRIPT. It was 'ni-wait-v1' — the
         localStorage key — and the moment office.html listed that key in the
         set that "delete everything" clears, this guard called a page with no
         waitlist a page with a broken waitlist. The querySelector the script
         runs is a thing only the script contains. */
      const slot = /data-waitlist=/.test(d), code = /querySelectorAll\('\[data-waitlist\]'\)/.test(d);
      if (slot !== code) throw new Error(`${f}: waitlist slot=${slot} but script=${code} — one without the other`);
    }
    if (!/data-waitlist/.test(built))
      throw new Error('plans.html: a pre-launch build has no waitlist — every visitor is spent and gone');
    if (!/window\.NI_LIVE=false/.test(built))
      throw new Error('plans.html: the stage flag is missing');
  }

  /* ── WHERE AN ADDRESS CAN BE LEFT ────────────────────────────────────────
     For most of this build the plans page held the only form on the site that
     could take one — and it is the page fewest people reach. Before there is
     anything to sell, a visitor who cannot be written to again IS the cost of
     the traffic, so the pages the funnel actually lands on each carry one. */
  if (!LIVE) for (const f of ['index.html','plans.html']){
    const d = fs.readFileSync(path.join(out, f), 'utf8');
    if (!/data-waitlist/.test(d))
      throw new Error(`${f}: a pre-launch build with no way to leave an address`);
    if (!/ni-wait-v1/.test(d))
      throw new Error(`${f}: the waitlist markup is there and the script that works it is not`);
  }
  console.log(`stage: ${STAGE}`);
}

/* the drill's ladder is duplicated in that script — six names, and if the game
   renames one the arcade floor starts announcing a rank that does not exist */
{ const drillSrc = fs.readFileSync('exit-drill.html', 'utf8');
  for (const r of ['Door-knocker','Bird dog','Apprentice','Underwriter','Closer','The Desk'])
    if (!drillSrc.includes(`n:'${r}'`))
      throw new Error(`the drill renamed a rank the arcade floor still announces: ${r}`); }

/* and every page must be able to reach them — an unreachable terms page is the
   same as no terms page, and it is the footer that does the reaching */
for (const f of ['index.html', 'desk.html', 'office.html', 'plans.html',
                 'exits.html', 'arcade.html', 'demo.html', 'exit-drill.html']){
  const s = fs.readFileSync(path.join(out, f), 'utf8');
  for (const l of ['terms.html', 'privacy.html', 'refunds.html'])
    if (!s.includes(`href="${l}"`)) throw new Error(`${f} cannot reach ${l}`);
}

await b.close();

/* ── LAST, BECAUSE THE SITEMAP CHECKS ITS OWN CLAIMS ────────────────────────
   server.js has always tried to send 404.html and always fallen back to nine
   bytes of plain text, because the file did not exist. That is the one page
   guaranteed to be seen by somebody who is already slightly lost, and it was
   the only page that offered them nothing.

   robots.txt and sitemap.xml matter more than usual right now: every URL on
   this site changed shape this week. A sitemap listing the CLEAN addresses is
   how a crawler learns that /desk is the real one and /desk.html is the
   redirect, rather than working it out a page at a time.

   Both are generated from PUBLIC_PAGES so they cannot drift from what exists
   — a sitemap listing a page that 404s is worse than no sitemap. Which is why
   this block sits at the END of the build and not beside the landing page,
   where it was first written: there it ran before demo.html existed and threw
   on its own guard. The guard was right and the placement was not. */
{
  let nf = fs.readFileSync('404.html', 'utf8');
  nf = nf.replace('</head>', ICONS() + '</head>');
  nf = nf.replace('</head>', FONTS + '</head>');
  fs.writeFileSync(path.join(out, '404.html'), nf);

  /* the clean address of every page a stranger is meant to find. office is
     behind a sign-in and 404 is noindex, so neither belongs here. */
  const PUBLIC_PAGES = ['', 'desk', 'demo', 'exits', 'arcade', 'comp-run', 'daily-street',
                        'exit-drill', 'land', 'plans', 'terms', 'privacy', 'refunds'];
  const SITE_URL = (process.env.NI_SITE_URL || 'https://negotiationinc.com').replace(/\/+$/, '');
  for (const page of PUBLIC_PAGES){
    const f = (page || 'index') + '.html';
    if (!fs.existsSync(path.join(out, f)))
      throw new Error(`the sitemap would list /${page} and ${f} was not built`);
  }
  const day = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(out, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + PUBLIC_PAGES.map(p => `  <url><loc>${SITE_URL}/${p}</loc><lastmod>${day}</lastmod></url>`).join('\n')
    + '\n</urlset>\n');

  /* ── EVERY PAGE A STRANGER MIGHT SHARE ────────────────────────────────────
     The link preview is the first impression the funnel makes, and until this
     build there was not one: title, description, and no image, on every page,
     with twitter:card set to `summary` — the small one. So a link to this
     product landed in a group chat, a subreddit or a LinkedIn post as a grey
     box with a favicon in it, next to competitors' screenshots.

     Three things are asserted, because all three fail silently and none of
     them fails in a browser:
       · the card is named AND the file is actually there — a 404 in an
         og:image is worse than no og:image, because the scraper caches the
         miss and shows nothing for days
       · the page names its own clean address as canonical: /desk and
         /desk.html are both served, and nothing else tells a search engine
         they are one page
       · there is a plain meta description, which is what a search result
         actually prints. og:description is a different tag read by different
         software, and two pages had one and not the other. */
  for (const page of PUBLIC_PAGES){
    const f = (page || 'index') + '.html';
    const q = path.join(out, f);
    let d = fs.readFileSync(q, 'utf8');

    const img = (d.match(/og:image["'] content=["']([^"']+)/) || [])[1];
    if (!img) throw new Error(`${f}: no link-preview image — every share of this page is a grey box`);
    const local = img.replace(SITE_URL, '').replace(/^\//, '');
    if (!fs.existsSync(path.join(out, local)))
      throw new Error(`${f}: names ${local} as its preview and the file was not built`);
    if (!/twitter:card["'] content=["']summary_large_image/.test(d))
      throw new Error(`${f}: the preview card is set to the small one, and a small card is a favicon`);

    const want = `${SITE_URL}/${page}`;
    const canon = (d.match(/rel=["']canonical["'] href=["']([^"']+)/) || [])[1];
    if (canon !== want) throw new Error(`${f}: canonical is ${canon || 'missing'}, should be ${want}`);

    /* ── AND THE CARD STILL HAS TWO SIDES AFTER IT WAS OPTIMISED ──────────
       The ledger sat on #f6f8fb against a #fff page: nine units, and the only
       thing making it read as a separate object. Every PNG here is indexed to
       a 256-colour palette by median cut, which splits boxes by SPAN — two
       enormous flat fields nine units apart land in one box and come back out
       of it averaged. The HTML had two panels. The file that shipped had one.

       Nothing could see that: not the browser, not a review of the source,
       not a screenshot taken before the squeeze. Only the bytes. So the bytes
       are what gets asked, after the squeeze has had its go at them. */
    if (page === '' && local.startsWith('og/')){
      /* The squeeze rewrites these as INDEXED pngs, which decodePNG does not
         read — and it does not need to. The palette is the evidence: if the
         page and the ledger's field survived as two colours, two distinct
         light entries are in the PLTE. If median cut merged them, there is
         one. Reading the palette asks the question directly and needs about
         six lines instead of a second decoder. */
      const buf = fs.readFileSync(path.join(out, local));
      const pal = [];
      for (let i = 8; i + 8 <= buf.length; ){
        const len = buf.readUInt32BE(i), type = buf.toString('ascii', i + 4, i + 8);
        if (type === 'PLTE') for (let k = 0; k < len; k += 3)
          pal.push([buf[i + 8 + k], buf[i + 9 + k], buf[i + 10 + k]]);
        if (type === 'IEND') break;
        i += 12 + len;
      }
      if (!pal.length) throw new Error(local + ': no palette — the preview card was not optimised, or is not the file this build wrote');
      /* Ask for the two fields BY VALUE. The first version of this looked for
         "two light tones far enough apart", which the pink refusal block
         answered on its own — so the check passed on a card whose panels had
         merged, which is the one thing it existed to catch. A test that can be
         satisfied by something other than the thing it is testing is worse
         than none, because it reports green while the bug ships. */
      for (const want of OGFIELDS){
        const near = pal.some(c => c.every((v, k) => Math.abs(v - want[k]) <= 3));
        if (!near) throw new Error(`${local}: rgb(${want}) is one of the two flat fields this card `
          + `is built from and it is not in the palette after optimisation — median cut merged it `
          + `into its neighbour, so the shipped card has one panel where the HTML has two. `
          + `Separate them with a line or a real step, not a whisper of tint.`);
      }
    }

    /* a description written once, used by both kinds of reader */
    if (!/<meta name=["']description["']/i.test(d)){
      const od = (d.match(/og:description["'] content=["']([^"']*)/) || [])[1];
      if (!od) throw new Error(`${f}: no description of any kind — the search result would be a guess`);
      d = d.replace('</head>', `<meta name="description" content="${od}">\n</head>`);
      fs.writeFileSync(q, d);
    }
  }

  /* Allow everything: nothing on this site is secret, and the things that ARE
     secret are refused by the server rather than asked about politely. The one
     job this file has is naming the sitemap. */
  fs.writeFileSync(path.join(out, 'robots.txt'),
    'User-agent: *\nAllow: /\n\nSitemap: ' + SITE_URL + '/sitemap.xml\n');
}

/* ══ NO PAGE NAMES THE MACHINE IT IS RUNNING ON ════════════════════════════
   The lender packet — a document a customer PRINTS AND HANDS TO A BANK —
   shipped with "negotiation-inc-site.onrender.com/plans" written across the
   upsell block. Wrong address, and an advertisement for the fact that this is
   a side project on a platform-as-a-service.

   It survived because nothing was looking. A hostname is exactly the sort of
   thing that gets typed once, early, while the custom domain is still being
   argued with, and then never re-read: it is not a bug, it does not throw, it
   simply says the wrong name in front of the person you most want to impress.

   So the build refuses. A dev host in a built page is always a mistake — the
   only reason to name one is that the code has not decided what it is yet,
   and a page that has not decided is not a page that ships. Comments are
   exempt on purpose: the prose that explains WHY emailRedirectTo has to be
   set must be free to say the word "localhost". */
{
  /* ── THE FOUR ARCADE SOURCES MUST DECLARE EVERY TOKEN THE BUILD INJECTS ───
     The tokens live in one place (ARCADE, above) and the build's selectors sit
     closer to the content, so the injected values are the ones that paint. But
     a source that USES var(--brass) and never declares it is a file that is one
     page through the build and a different, broken page opened off disk — an
     undefined var() with no fallback does not degrade, it invalidates the whole
     declaration and the property snaps to its initial value. _tvars caught that
     within a minute of the tokens going in. This asserts the local copies keep
     existing, by name, so the next person to add a token cannot forget. */
  const NEED = [...ARCADE.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1])
    .filter(n => n !== '--sans');
  for (const f of ['arcade-hub.html', 'exit-drill.html', 'portfolio.html', 'daily-street.html']){
    const src = fs.readFileSync(f, 'utf8');
    const has = new Set([...src.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
    const missing = [...new Set(NEED)].filter(n => !has.has(n));
    if (missing.length) throw new Error(`${f} uses the arcade tokens but declares none of `
      + `${missing.join(', ')} itself — opened off disk it is a different page. `
      + 'Copy the block from ARCADE in publish.mjs into its :root.');
  }
}

{
  /* NI_ALLOW_LOCAL_SB already means one thing and one thing only: this build
     is pointed at a Supabase STUB on a loopback port, for a harness. _tpay
     stands one up and builds against it, so the loopback rules would refuse
     the very build that proves payments work. The provider rules still apply
     — a test build has no business naming onrender either. */
  const LOCAL_OK = !!process.env.NI_ALLOW_LOCAL_SB;
  /* _tstamp edits a real source file to prove the build id moves, and restores
     it in a finally. A finally does not run when the process is killed, and one
     was — so "<!-- stamp probe -->" sat in plans.html waiting for the next
     batch to carry it to the internet. A harness that can leave litter in the
     source tree needs the build to sweep for it. */
  /* ── LITTER IS CHECKED ON THE RAW BYTES, HOSTNAMES ON THE PROSE ─────────
     The first version of this put the probe pattern in with the hostnames,
     which run against a DECOMMENTED copy so that a paragraph explaining why
     emailRedirectTo matters is free to say the word "localhost". A probe left
     behind by a harness IS a comment, so the check that was meant to catch it
     stripped it first and reported green. Two lists, two passes: one asks
     what the page SAYS, the other asks what is in the file. */
  /* AND THE HARNESS THAT PLANTS THE PROBE HAS TO BE ABLE TO BUILD. _tstamp
     proves the id moves by writing "<!-- stamp probe -->" into plans.html and
     building, which is the exact string this sweep exists to catch — so the
     sweep and the test that justifies it deadlocked, and _tstamp went red the
     hour the sweep started reading raw bytes. The exemption is the output
     directory rather than a flag: _tstamp builds into dist-stamp, nothing but
     `dist` is ever copied to the repo, and a directory a deploy cannot reach
     is a guarantee no environment variable can be set wrong. */
  const SHIPS = out === 'dist';
  const LITTER = SHIPS ? [
    [/stamp probe|__TEST_PROBE__|TODO: remove|XXX HACK/i, 'a test probe or a note left behind'],
  ] : [];
  const HOSTS = [
    [/onrender\.com/i,               'the hosting provider'],
    [/negotiation-inc-site\./i,      'the pre-domain service name'],
    ...(LOCAL_OK ? [] : [
      [/https?:\/\/localhost/i,      'a localhost URL'],
      [/https?:\/\/127\.0\.0\.1/,    'a loopback URL'],
    ]),
  ];
  /* strip both comment forms first, so the explanation of a rule is never
     mistaken for a breach of it */
  const decomment = s => s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  /* the demo pages live one directory down and are just as printable */
  const pages = fs.readdirSync(out).filter(f => f.endsWith('.html'))
    .concat(fs.existsSync(path.join(out, 'd'))
      ? fs.readdirSync(path.join(out, 'd')).filter(f => f.endsWith('.html')).map(f => 'd/' + f) : []);
  for (const f of pages){
    const raw = fs.readFileSync(path.join(out, f), 'utf8');
    for (const [re, what] of LITTER){
      const m = raw.match(re);
      if (m) throw new Error(`${f} carries ${what} (${m[0]}) — a harness edited a source file and did `
        + 'not put it back. Its finally block does not run when the process is killed.');
    }
    const body = decomment(raw);
    for (const [re, what] of HOSTS){
      const m = body.match(re);
      if (m) throw new Error(`${f} names ${what} (${m[0]}) — a built page must only ever say negotiationinc.com`);
    }
  }
}

/* ══ THE BUILD STAMP ═══════════════════════════════════════════════════════
   Three batches in a row were built, tested, packaged and never reached the
   internet, and nobody could tell — the site looked like a site, the health
   endpoint said "on" to everything, and the only way to find out was to read
   the live HTML looking for a sentence you remembered changing.

   That is the most expensive kind of missing instrument: not one that reports
   a problem, one whose ABSENCE makes a problem invisible. So every build now
   signs itself, the server reports the signature, and "is what I just pushed
   the thing that is running" is a URL rather than an archaeology exercise.

   The id is a hash of the built bytes, so it is the same for the same output
   and different for any change — including a change nobody meant to make. It
   is NOT a git sha: the repo holds built HTML, the deploy is a file copy, and
   a git sha would tell you which commit exists rather than which bytes are
   being served. */
{
  /* ── THE STAMP MAY NOT HASH ITSELF ───────────────────────────────────────
     build.json from the PREVIOUS run was sitting in the output directory and
     going into the digest, so the id was a function of the last build as well
     as this one. Three builds of untouched sources produced three different
     ids, which quietly cost the stamp the only property that makes it worth
     having: same bytes, same id. It also meant build.json always showed as
     modified, so the deploy script's "nothing to push, the repo already
     matches" branch could never once have been reached.

     An instrument that reads differently every time you look at it is not
     measuring the thing you pointed it at. */
  /* ── AND THE LINK-PREVIEW CARDS, WHICH ARE PAGES ─────────────────────────
     A redesign of the cards changes seven PNGs and nothing else, so the id did
     not move — and the deploy script polls for the id. It would have reported
     "LIVE, running build X" against the build already running, while the new
     cards sat on a laptop. The stamp answering "yes" to a deploy that did not
     happen is worse than having no stamp.

     Only page-*.png. The forty deed cards in the same directory are drawn on a
     canvas and do not come out byte-identical between runs, so hashing those
     would move the id on every build and cost the stamp the property that
     makes it worth having. These are screenshots of a static page: same input,
     same bytes, checked. */
  const cards = fs.existsSync(path.join(out, 'og'))
    ? fs.readdirSync(path.join(out, 'og')).filter(f => /^page-.*\.png$/.test(f)).sort()
        .map(f => 'og/' + f) : [];
  const files = fs.readdirSync(out)
    .filter(f => /\.(html|js|css|json|xml|txt)$/i.test(f) && f !== 'build.json').sort()
    .concat(cards);
  const h = crypto.createHash('sha256');
  for (const f of files){ h.update(f); h.update(fs.readFileSync(path.join(out, f))); }
  const id = h.digest('hex').slice(0, 12);
  const stamp = { id, at: new Date().toISOString(), stage: LIVE ? 'live' : 'prelaunch',
                  files: files.length };
  fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify(stamp, null, 1) + '\n');
  console.log('build ' + id + ' · ' + stamp.stage + ' · ' + files.length + ' files');
}
