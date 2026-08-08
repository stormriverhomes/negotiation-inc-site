/* t-nav — the site knows who you are, and only then.
   Two claims to hold at once:
     · anonymous, every page is byte-for-byte the page a stranger sees — no
       class, no rewritten link, no "You →" flashing in the corner;
     · signed in, the wordmark goes to your desk on EVERY page, "Sign in"
       becomes your name, and the arcade stops dumping subscribers into the
       front of house.
   The second is the feature. The first is the one that breaks quietly. */
import { chromium } from 'playwright';
import { step } from './harness-util.mjs';

const B = 'file:///home/claude/dist/';
const PAGES = ['index.html','plans.html','exits.html','arcade.html','demo.html',
               'exit-drill.html','terms.html','privacy.html','refunds.html'];

const b = await chromium.launch();
const out = {}; const bad = [];
const mark = () => ({
  href: (document.querySelector('header a.mark, header a.marklink')||{}).getAttribute
        ? document.querySelector('header a.mark, header a.marklink').getAttribute('href') : null,
  who: (document.querySelector('.whoami')||{}).textContent || null,
  signin: [...document.querySelectorAll('header a')].map(a=>a.textContent.trim())
            .filter(t=>/^sign in$/i.test(t)).length,
  cls: document.body.className.includes('signedin'),
});

/* ── A · anonymous: nothing at all happens ─────────────────────────────── */
{
  const p = await b.newPage();
  for (const f of PAGES){
    await p.goto(B + f); await p.waitForTimeout(250);
    const r = await p.evaluate(mark);
    out['anon:' + f] = r;
    if (r.cls)  bad.push(`${f}: anonymous visitor got the signedin class`);
    if (r.who)  bad.push(`${f}: anonymous visitor was greeted by name`);
    if (r.href !== 'index.html') bad.push(`${f}: anonymous wordmark does not go home (${r.href})`);
  }
  await p.close();
}

/* ── B · signed in: the wordmark is the way back to the desk ───────────── */
{
  const p = await b.newPage();
  await p.goto(B + 'index.html');
  await p.evaluate(() => localStorage.setItem('ni-account-v1',
    JSON.stringify({ name:'Elijah Payne', email:'e@x.com', plan:'underwriter', trial:null })));
  /* the account chrome runs on EVERY page including the two that build their
     own — a TypeError in it kills whatever script comes after, so a silent
     console is part of the contract, not a nicety */
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  for (const f of [...PAGES, 'office.html', 'desk.html']){
    await p.goto(B + f); await p.waitForTimeout(400);
    const r = await p.evaluate(mark);
    out['in:' + f] = r;
    if (f === 'office.html' || f === 'desk.html') continue;   // rail pages hide the masthead
    if (!r.cls) bad.push(`${f}: signed in but the page does not know it`);
    if (r.href !== 'office.html') bad.push(`${f}: signed-in wordmark still goes to the sales page (${r.href})`);
    if (r.signin) bad.push(`${f}: still asking a member to sign in`);
    if (!/Elijah/.test(r.who || '')) bad.push(`${f}: no name in the masthead (${r.who})`);
  }
  out.pageErrors = errs;
  if (errs.length) bad.push('the account chrome threw: ' + errs.slice(0,2).join(' | '));

  /* the arcade, which is the one that was leaking */
  await p.goto(B + 'arcade.html'); await p.waitForTimeout(250);
  out.arcadeFresh = await p.evaluate(() => ({
    eye: document.getElementById('ark-eye').textContent,
    outs: [...document.querySelectorAll('.rail a')].map(a => [a.textContent.trim(), a.getAttribute('href')]),
  }));
  if (!/Elijah/.test(out.arcadeFresh.eye)) bad.push('the arcade floor does not know whose floor it is');
  if (!out.arcadeFresh.outs.some(([,h]) => h === 'office.html'))
    bad.push('the arcade still has no way back to your desk');

  /* and it carries the rank the drill actually gave you */
  await p.evaluate(() => localStorage.setItem('ni-drill-best','1740'));
  await p.reload(); await p.waitForTimeout(250);
  out.arcadeRanked = await p.evaluate(() => document.getElementById('ark-eye').textContent);
  if (!/Underwriter/.test(out.arcadeRanked) || !/1,740/.test(out.arcadeRanked))
    bad.push('the arcade floor does not carry the drill rank: ' + out.arcadeRanked);

  /* no navy rail in the arcade — that was the decision, and it is easy to
     undo by accident once every other page has one */
  const rail = await p.evaluate(() => !!document.getElementById('rail-nav'));
  out.arcadeRail = rail;
  if (rail) bad.push('the arcade grew a SaaS rail and stopped being a place');
  await p.close();
}

/* ── C · the member rail's own wordmark ────────────────────────────────── */
{
  const p = await b.newPage();
  await p.goto(B + 'office.html');
  await p.evaluate(() => {
    localStorage.setItem('ni-account-v1', JSON.stringify({ name:'Elijah', email:'e@x.com', plan:'solo', trial:null }));
    localStorage.setItem('ni-desk-v3', JSON.stringify({ active:0, props:[
      { name:'1104 Elm', addr:'1104 Elm Street', mode:'simple', comps:[],
        f:{ asking:{v:'168000'}, arv:{v:'249000'}, repairs:{v:'46000'} } }]}));
  });
  for (const f of ['office.html','desk.html']){
    await p.goto(B + f); await p.waitForTimeout(900);
    const r = await p.evaluate(() => ({
      rail: !!document.getElementById('rail-nav'),
      href: (document.querySelector('.rn-mark')||{}).getAttribute
            ? document.querySelector('.rn-mark').getAttribute('href') : null }));
    out['rail:' + f] = r;
    if (!r.rail) bad.push(`${f}: the member rail did not render`);
    if (r.href !== 'office.html') bad.push(`${f}: the rail wordmark still goes to the sales page (${r.href})`);
  }
  /* a guest on the desk has no desk to go back to — that wordmark stays home */
  await p.evaluate(() => { localStorage.removeItem('ni-account-v1'); });
  await p.goto(B + 'desk.html'); await p.waitForTimeout(500);
  /* the guest rail only appears once there is work to lose */
  await step(p, 'property');
  await p.fill('#addr', '42 Anywhere Road'); await p.waitForTimeout(800);
  out.guestRail = await p.evaluate(() => {
    const m = document.querySelector('.rn-mark');
    return m ? m.getAttribute('href') : 'no rail'; });
  if (out.guestRail === 'office.html')
    bad.push('the guest rail sends a stranger to a desk they do not have');
  await p.close();
}

/* ── D · there is a way OUT, and it lands on the anonymous product ───────
   On desktop the rail hides the masthead, and the masthead held the only
   "Sign out" button — so from 1081px up a signed-in state had no exit at all.
   Elijah hit it as "even when I'm not signed in it takes me to my dashboard":
   the record was stale and nothing on screen offered to clear it. */
{
  const p = await b.newPage({ viewport:{width:1400,height:1000} });
  await p.goto(B + 'office.html');
  await p.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('ni-account-v1', JSON.stringify({name:'Elijah', email:'e@x.com', plan:'underwriter', trial:null}));
    localStorage.setItem('ni-desk-v3', JSON.stringify({active:0, props:[
      {name:'1104 Elm', addr:'1104 Elm', mode:'simple', comps:[],
       f:{asking:{v:'168000'}, arv:{v:'249000'}, repairs:{v:'46000'}}}]}));
  });
  await p.reload(); await p.waitForTimeout(900);
  out.hubPanel = await p.evaluate(() => ({
    mastHidden: getComputedStyle(document.querySelector('header')).display === 'none',
    whoBtn: !!document.getElementById('rn-who') }));
  if (!out.hubPanel.whoBtn) bad.push('D: the hub rail has no account control');
  await p.click('#rn-who'); await p.waitForTimeout(350);
  out.hubOpen = await p.evaluate(() => ({
    out: !!document.getElementById('ac-out'),
    switcher: document.querySelectorAll('[data-plan]').length,
    next: (document.querySelector('.ac-up .k')||{}).textContent || null }));
  if (!out.hubOpen.out)         bad.push('D: no way to sign out from the hub');
  if (out.hubOpen.switcher !== 4) bad.push('D: the plan preview is missing from the hub');
  await p.click('#ac-out'); await p.waitForTimeout(900);
  out.signedOut = await p.evaluate(() => ({
    acct: localStorage.getItem('ni-account-v1'),
    gate: !document.getElementById('gate').classList.contains('hidden'),
    hub: !document.getElementById('hub').classList.contains('hidden'),
    rail: !document.getElementById('rail-nav').hidden,
    sheets: !!localStorage.getItem('ni-desk-v3') }));
  if (out.signedOut.acct)   bad.push('D: signing out left the account record behind');
  if (!out.signedOut.gate || out.signedOut.hub) bad.push('D: signing out left you on the dashboard');
  if (out.signedOut.rail)   bad.push('D: signing out left the member rail up');
  if (!out.signedOut.sheets) bad.push('D: signing out deleted the work — it must not');
  await p.goto(B + 'desk.html'); await p.waitForTimeout(800);
  out.deskAfter = await p.evaluate(() => ({
    asguest: document.body.classList.contains('asguest'),
    member: !!document.getElementById('rn-who'),
    label: (document.querySelector('.rn-nm')||{}).textContent || null,
    mark: (document.querySelector('.rn-mark')||{}).getAttribute('href'),
    whoami: !!document.querySelector('.whoami') }));
  if (!out.deskAfter.asguest) bad.push('D: the desk still dresses a signed-out visitor as a member');
  if (out.deskAfter.member)   bad.push('D: the member account button survived a sign out');
  if (out.deskAfter.mark !== 'index.html') bad.push('D: a signed-out wordmark still points at a desk they do not have');
  if (out.deskAfter.whoami)   bad.push('D: a signed-out visitor is still greeted by name');
  await p.close();
}

await b.close();
console.log(JSON.stringify(out, null, 1));
console.log(bad.length ? 'FAIL\n - ' + bad.join('\n - ')
  : 'PASS — anonymous sees the same site; signed in, every wordmark is the way back to the desk');
process.exit(bad.length ? 1 : 0);
