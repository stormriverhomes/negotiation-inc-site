import { chromium } from 'playwright';
const B='file:///home/claude/dist/';
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1180,height:1000},deviceScaleFactor:2});
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto(B+'plans.html'); await p.evaluate(()=>localStorage.clear());
await p.goto(B+'plans.html'); await p.waitForTimeout(700);

/* ── THE WAITLIST IS A PRE-LAUNCH DEVICE ──────────────────────────────────
   It exists to collect an address during the months when there is nothing to
   sell. Once the site can take money it is a funnel LEAK — it invites somebody
   ready to buy to type an email instead, and the build strips it for exactly
   that reason. Live, the assertion inverts: the form must be gone. */
if (await p.evaluate(() => window.NI_LIVE === true)){
  const left = await p.evaluate(() => ({
    forms: document.querySelectorAll('#waitlist form, [data-waitlist]').length,
    wl: document.querySelectorAll('.wl').length,
    says: /waitlist/i.test(document.body.innerText),
  }));
  console.log('live stage:', JSON.stringify(left));
  if (left.forms || left.wl){ console.log('FAIL — a waitlist form is on a LIVE build, catching people who came to buy'); process.exit(1); }
  if (left.says){ console.log('FAIL — the page still talks about a waitlist it no longer has'); process.exit(1); }
  console.log('PASS — the waitlist is gone, and the page no longer mentions one');
  await b.close(); process.exit(0);
}
/* ── THE PRE-LAUNCH HALF USED TO ASSERT NOTHING ────────────────────────────
   Everything below this line printed observations and exited 0, which put a
   green light on the board for a form that could have been broken in any way
   at all. Right now that form IS the funnel: there is nothing to buy, so the
   only thing a visitor can do that we keep is leave an address. It gets real
   assertions. */
const F = [], ck = (c, m) => { if (!c) F.push(m); };

/* ── the card is INJECTED into eleven pages, so it must not read their CSS ──
   It paints itself white and then used to borrow --ink/--mid/--soft from
   whatever it landed on. On the arcade, a warm dark theme, that produced a
   3.88:1 status line — the line that says "You are on the list" or names the
   error, below AA, on the last step of the funnel, invisible on every light
   page so nothing caught it. Two assertions: every colour clears AA, and the
   card looks the SAME everywhere, which is the property that made it safe. */
const lum = c => { const s = c.map(v => { v /= 255;
  return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
  return 0.2126*s[0] + 0.7152*s[1] + 0.0722*s[2]; };
const rgb = s => (String(s).match(/\d+(\.\d+)?/g) || [0,0,0]).slice(0,3).map(Number);
const cr  = (a, b) => { const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x,y) => y-x);
  return +((hi + .05) / (lo + .05)).toFixed(2); };

const READ = () => p.evaluate(() => {
  const box = document.querySelector('.wl'); if (!box) return null;
  /* ── WHAT COLOUR IS BEHIND THIS, REALLY ──────────────────────────────────
     Reading the card's own backgroundColor and stopping there was fine while
     every slot painted itself white. A BARE slot — one that sits inside a
     card which already has a border, a background and a heading — paints
     nothing, so that read came back rgba(0,0,0,0) and the contrast maths
     divided by a transparent colour and produced 2.26:1 for black-ish text on
     a cream card. The check has to answer the question a reader's eye asks,
     which is what is actually behind the letters. */
  const behind = el => { for (let n = el; n && n !== document.documentElement; n = n.parentElement){
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; }
    return getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)'; };
  const bare = box.classList.contains('bare');
  const seen = [];
  for (const el of box.querySelectorAll('.wt,.ws,.wn,input,button')){
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    seen.push({ k: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\s+/)[0] : ''),
      fg: cs.color, bg: cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? behind(el) : cs.backgroundColor,
      size: parseFloat(cs.fontSize), w: Math.round(r.width), h: Math.round(r.height) });
  }
  return { cardBg: behind(box), bare, seen };
});

const PAGES = ['plans.html','index.html','arcade.html','exits.html'];
let fingerprint = null;
for (const f of PAGES){
  await p.goto(B + f); await p.waitForTimeout(700);
  const r = await READ();
  if (!r){ ck(false, `${f}: the waitlist card is not on the page at all`); continue; }
  for (const x of r.seen){
    const ratio = cr(x.fg, x.bg);
    /* 3:1 is the large-text threshold; nothing in this card is large */
    ck(ratio >= 4.5, `${f}: ${x.k} is ${ratio}:1 on its own background (${x.fg} on ${x.bg}) — below AA`);
  }
  for (const x of r.seen) if (x.k.startsWith('input') || x.k.startsWith('button'))
    ck(x.h >= 44, `${f}: ${x.k} is ${x.h}px tall — under a fingertip`);
  /* Every page must produce the same card, and the COLOURS are the property
     worth asserting — a colour that changes with the host is the bug that was
     here. Size is checked separately and loosely: a widget adopting a host's
     type scale is a decision somebody could reasonably make, so a harness
     that goes red over half a pixel would be crying wolf about the wrong
     thing and would eventually be silenced along with the real assertion. */
  /* A BARE slot is exempt from this one, and only this one. It has
     deliberately given up its own chrome to sit inside a host card, so "does
     it look identical everywhere" is not a question being asked of it — while
     "is it readable where it landed" still is, and is checked above on the
     background actually behind it. Every slot that paints its own card is
     still held to looking the same on all of them. */
  if (!r.bare){
    const fp = JSON.stringify(r.seen.map(x => [x.k, x.fg, x.bg]));
    if (fingerprint === null) fingerprint = { f, fp };
    else ck(fp === fingerprint.fp,
      `the card is a different COLOUR on ${f} than on ${fingerprint.f} — it is reading the page's variables again`);
  }
  for (const x of r.seen) ck(x.size >= 12, `${f}: ${x.k} is set at ${x.size}px`);
}

await p.goto(B + 'plans.html'); await p.evaluate(()=>localStorage.clear());
await p.goto(B + 'plans.html'); await p.waitForTimeout(700);
const shape = await p.evaluate(()=>({
  live: window.NI_LIVE,
  form: !!document.querySelector('#waitlist form'),
  ctas: [...document.querySelectorAll('.pf .btn')].map(a=>a.textContent.trim()),
  founding: (document.querySelector('.spot .btn, .founding .btn')||{}).textContent,
  trial: /Start 14 days free/.test(document.body.innerText),
}));
console.log(JSON.stringify(shape, null, 1));
ck(shape.form, 'plans.html has no waitlist form, and pre-launch there is nothing else to do there');

// ── it posts somewhere, and it remembers ────────────────────────────────────
await p.evaluate(()=>{ window.__hit=null; window.fetch = async (u,o)=>{ window.__hit={u,body:o.body}; return {ok:true}; }; });
await p.fill('#waitlist input','elijah@example.com');
await p.click('#waitlist button');
await p.waitForTimeout(500);
const sent = await p.evaluate(()=>({ hit: window.__hit, done: !!document.querySelector('.wl.done'),
  stored: localStorage.getItem('ni-wait-v1'), txt: (document.querySelector('.wl')||{}).innerText }));
console.log('after submit:', JSON.stringify({...sent, txt: undefined}));
ck(!!sent.hit,   'the address went nowhere — no request was made');
ck(sent.done,    'a successful signup does not switch the card to its done state');
ck(sent.stored === '1', 'a successful signup is not remembered on this browser');
ck(/elijah@example\.com/.test(String(sent.hit && sent.hit.body)), 'the request did not carry the address');

// reload → still says you're on it
await p.goto(B+'plans.html'); await p.waitForTimeout(600);
const kept = await p.evaluate(()=>!!document.querySelector('.wl.done'));
console.log('after reload:', kept);
ck(kept, 'a reload asks somebody who already signed up to sign up again');

/* ── the failure path is the one that matters ───────────────────────────────
   A form that says "thanks" when the request failed loses the address AND the
   person, because they will not do it twice. It must say so, and it must not
   set the flag that would stop it asking again. */
await p.evaluate(()=>{ localStorage.clear(); });
await p.goto(B+'plans.html'); await p.waitForTimeout(600);
await p.evaluate(()=>{ window.fetch = async ()=>({ok:false,status:503}); });
await p.fill('#waitlist input','x@example.com'); await p.click('#waitlist button');
await p.waitForTimeout(500);
const failed = await p.evaluate(()=>({ note: (document.querySelector('.wn')||{}).textContent || '',
  cls: (document.querySelector('.wn')||{}).className || '',
  done: !!document.querySelector('.wl.done'), stored: localStorage.getItem('ni-wait-v1') }));
console.log('on failure:', JSON.stringify(failed));
ck(failed.note.trim().length > 0, 'a failed signup says nothing at all');
ck(/bad/.test(failed.cls), 'a failed signup is not marked as a failure');
ck(!failed.done,   'a failed signup shows the success card');
ck(failed.stored !== '1', 'a failed signup is remembered as a success, so it will never be asked again');
ck(/support@negotiationinc\.com|email|try/i.test(failed.note),
   'a failed signup does not offer the person any way through: ' + JSON.stringify(failed.note));

await p.evaluate(()=>{const e=document.getElementById('waitlist'); if(e)e.scrollIntoView({block:'center'});});
await p.waitForTimeout(300);
await p.screenshot({path:'shot-waitlist.png'});

ck(!errs.length, 'page errors: ' + errs.join(' · ').slice(0,180));

/* ── AND THE SHAPE OF THE FIELD, ON A PHONE ────────────────────────────────
   The input carries flex:1 1 170px, which in the row layout means "at least
   170px WIDE, take the rest". Below 560px the container becomes a column, and
   in a column that basis is a HEIGHT: 170px of it, plus grow. So on every
   phone that reached this site, the one control that captures an address was
   drawn as a 330px-tall empty box with the placeholder floating in the middle
   of it, on every page carrying a slot.

   Nothing caught it because nothing was measuring the SHAPE of a control —
   only whether it existed and whether it posted. A field can exist, post
   correctly, and still look broken enough that nobody types in it. */
{
  const ph = await b.newPage({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true,
    deviceScaleFactor:2 });
  for (const page of ['plans.html','index.html']){
    await ph.goto(B + page); await ph.waitForTimeout(700);
    const m = await ph.evaluate(() => {
      const i = document.querySelector('.wl .wf input'), btn = document.querySelector('.wl .wf button');
      if (!i) return null;
      const a = i.getBoundingClientRect(), b = btn.getBoundingClientRect();
      return { h: Math.round(a.height), w: Math.round(a.width),
               bh: Math.round(b.height), stacked: Math.abs(a.left - b.left) < 2 };
    });
    ck(m, `${page}: no waitlist field on a phone at all`);
    if (!m) continue;
    /* a single-line text input. 44 is the tap target floor, 72 is generous
       for one line of 16px text with padding — 330 is a paragraph box. */
    ck(m.h >= 44 && m.h <= 72, `${page}: the email field is ${m.h}px tall on a phone — one line of text is not a box`);
    ck(m.bh >= 44, `${page}: the submit button is ${m.bh}px on a phone`);
    ck(m.stacked, `${page}: the field and the button did not stack on a phone`);
    ck(m.w > 200, `${page}: the field is only ${m.w}px wide on a 390px screen`);
  }
  await ph.close();
}

await b.close();
if (F.length){ console.log('\nFAIL:'); F.forEach(f=>console.log(' -', f)); process.exit(1); }
console.log('\nPASS — the card owns its own colours on every page it paints one, it is readable on the card it sits inside where it does not, it is one line tall on a phone, it posts, it remembers, and it is honest when it fails');
