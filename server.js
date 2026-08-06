/* ══ THE ONE ENDPOINT THAT HOLDS A KEY ═════════════════════════════════════
   The desk is client-side and stays that way: pricing a property never
   reaches this process, which is what makes the free tier genuinely free and
   what makes "nothing leaves your browser" a sentence the product can keep.

   This service exists for exactly one reason that cannot be done in a page:
   it holds the Anthropic key. The key is in Render's environment, never in a
   response, never in a log line, and never in anything served to a browser.

   FOUR THINGS THIS FILE IS RESPONSIBLE FOR, in order of how expensive they
   are to get wrong:

   1 · THE KEY DOES NOT LEAK. It is read once from process.env and referenced
       nowhere else. No route echoes the environment. No error message carries
       an upstream response body.

   2 · THE ENDPOINT IS NOT A FREE LLM FOR THE INTERNET. An open vision
       endpoint on a public domain is somebody else's compute budget, and they
       will find it. Three independent limits, and it FAILS CLOSED: with no
       access code configured, the route is disabled rather than open.

   3 · NOTHING IS STORED. The photographs exist in memory for the length of
       one request and are never written to disk, never logged, never cached.
       That is a stronger privacy promise than the one currently on the
       privacy page ("deleted within 24 hours") and it should replace it —
       there is no purge job to write because there is nothing to purge.

   4 · A DISHONEST ANSWER IS REJECTED HERE. The model is asked to refuse lines
       it cannot see; this file checks that it actually did, and drops any
       line that came back scored while claiming not to have been seen. The
       honesty is not left to the prompt alone. ═══════════════════════════ */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, SYSTEM, TOOL, LINES, LINE_IDS, RARELY_VISIBLE, userBlock } from './prompt.js';
import * as CMP from './compare.js';
import * as ST from './street.js';
import * as BID from './bid.js';
import * as OBJ from './objections.js';
import { mountBilling, billingState, entitlementOf, usedThisMonth, countUse, capFor, FEATURES, NOMETER, meterHold, meterHolds, meterRelease } from './billing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);              // Render terminates TLS in front of us

const KEY    = process.env.ANTHROPIC_API_KEY || '';
const ACCESS = process.env.NI_ACCESS_CODE || '';
const MOCK   = process.env.NI_MOCK === '1';
const PORT   = process.env.PORT || 10000;

/* every limit is an env var with a deliberately small default: a service that
   is generous by default is one nobody notices is being drained */
const N = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= 0 ? v : d; };
const LIM = {
  perIpHour:  N('NI_PER_IP_HOUR', 20),
  perDay:     N('NI_PER_DAY', 200),
  dailyUsd:   N('NI_DAILY_USD', 5),
  maxImages:  N('NI_MAX_IMAGES', 8),
  maxImageKb: N('NI_MAX_IMAGE_KB', 1600),   // AFTER the browser has resized
  maxTotalKb: N('NI_MAX_TOTAL_KB', 9000),
};
/* Sonnet 4.5 list price, used only to convert usage into a spend ceiling.
   Wrong by a factor of two is fine; the point is a ceiling that exists. */
const USD_IN = 3 / 1e6, USD_OUT = 15 / 1e6;

/* ── the counters ──────────────────────────────────────────────────────────
   In process, because a second instance costing twice the ceiling is a much
   smaller problem than a Redis dependency on a service with one route. Every
   window resets on its own clock rather than at midnight, so a burst at 23:59
   cannot buy a second allowance sixty seconds later. */
const hits = new Map();                 // ip → [timestamps]
let day = { at: Date.now(), n: 0, usd: 0, by: new Map() };
const rollDay = () => { if (Date.now() - day.at > 864e5) day = { at: Date.now(), n: 0, usd: 0, by: new Map() }; };

/* ══ THE DAY'S BUDGET IS NOT A QUEUE ═══════════════════════════════════════
   The monthly meter above exists — its own comment says so — because "one user
   could spend the day's budget by lunchtime and the rest got 429s for
   something they had paid for". And then, four lines later, sat the gate that
   produced exactly that outcome:

       if (day.n >= LIM.perDay || day.usd >= LIM.dailyUsd) return 429

   One number, one process, every account. The heaviest user on the service
   decides when everybody else's day ends. Worse, the default was $5 — and one
   Underwriter subscription sells 250 AI calls a month, so a single subscriber
   doing a day's real work can spend the whole ceiling by mid-afternoon. It was
   not a backstop for a runaway; it was the binding constraint in normal
   operation, sitting in front of five features people have paid for.

   The shape it should have had:

     · WHILE THE BUDGET LASTS, nobody is refused. Same as before.
     · ONCE IT IS SPENT, refuse only the callers who are ABOVE their share of
       it — where the share is the budget divided by the accounts that have
       actually used it today. The account that ate the budget is stopped; the
       one arriving with nothing spent is served. That is the whole fix, and it
       has the property that matters: a newcomer is never refused for something
       somebody else did.
     · AND THERE IS STILL A CEILING, because the reason a global cap existed at
       all is real — a bug, or a stolen session, must not be able to run up an
       unbounded bill. It is now set well above the budget rather than at it,
       which is what a backstop means.

   The share moves as the day goes on: one account alone owns the whole budget
   until a second one appears, at which point the first is over its half and
   stops. Arrival order therefore decides nothing, which is the point.

   `day.by` is per process and dies with it, like every other counter here. It
   is keyed by account, not by IP, because the entitlement check above has
   already established who is asking — and an account is the thing that was
   sold, so it is the thing a share belongs to. */
const hardUsd = () => { const v = Number(process.env.NI_DAILY_USD_HARD);
  return Number.isFinite(v) && v > 0 ? v : LIM.dailyUsd * 4; };
const hardN   = () => { const v = Number(process.env.NI_PER_DAY_HARD);
  return Number.isFinite(v) && v > 0 ? v : LIM.perDay * 4; };

/* one bill, two books: the process total and the account that caused it */
function charge(uid, usage, extraUsd){
  const usd = ((usage && usage.input_tokens)  || 0) * USD_IN
            + ((usage && usage.output_tokens) || 0) * USD_OUT
            + (Number.isFinite(extraUsd) ? extraUsd : 0);
  day.n += 1; day.usd += usd;
  const who = uid || 'anon';
  const m = day.by.get(who) || { n: 0, usd: 0 };
  m.n += 1; m.usd += usd; day.by.set(who, m);
  return usd;
}

/* null to proceed, or [status, message, extra] — one gate, five routes, so it
   cannot drift between them the way five copies of two lines always do */
function budgetFails(uid, what){
  rollDay();
  /* the ceiling: a runaway is refused whoever it is, and this is the only
     refusal here that is allowed to be indiscriminate */
  if (day.usd >= hardUsd() || day.n >= hardN())
    return [429, (what || 'This service') + ' has hit its ceiling for today. It resets within 24 hours.',
            { retryHours: 24, ceiling: true }];
  /* under budget: nobody is refused, which is almost always the case */
  if (day.n < LIM.perDay && day.usd < LIM.dailyUsd) return null;
  /* over budget: only the accounts above their share */
  const heads  = Math.max(1, day.by.size);
  const mine   = day.by.get(uid || 'anon') || { n: 0, usd: 0 };
  if (mine.usd >= LIM.dailyUsd / heads || mine.n >= LIM.perDay / heads)
    return [429, 'That is this account\'s share of what the service can run today, and it is '
              + 'busier than usual. It resets within 24 hours — your monthly allowance is untouched.',
            { retryHours: 24, share: true }];
  return null;
}

/* ── AND A BUDGET BELOW WHAT WAS SOLD IS A BUG YOU FIND FROM A COMPLAINT ────
   The caps in billing.js are a promise printed on the plans page. This checks,
   once at boot, that the day's budget could actually honour ONE subscriber of
   the top tier working at the rate they bought — because if it cannot, the
   ceiling is not protecting the service from customers, it is protecting the
   service from having any. It only warns: the right number is discovered from
   usage, and a deploy that refuses to boot over a guess is worse. */
const NOMINAL_USD = 0.04;   // rough cost of one AI call here; used ONLY for this warning
setTimeout(() => {
  let month = 0;
  for (const f of FEATURES) month += capFor(f, 3);
  const perDay = month / 30;
  if (LIM.perDay < perDay)
    console.warn(`[budget] NI_PER_DAY is ${LIM.perDay} and one Office subscription sells `
      + `${Math.ceil(perDay)} calls a day. Raise NI_PER_DAY.`);
  if (LIM.dailyUsd < perDay * NOMINAL_USD)
    console.warn(`[budget] NI_DAILY_USD is $${LIM.dailyUsd} and one Office subscription's daily `
      + `share costs roughly $${(perDay * NOMINAL_USD).toFixed(2)}. Raise NI_DAILY_USD.`);
}, 2000).unref?.();
function ipOk(ip){
  const now = Date.now(), win = now - 36e5;
  const a = (hits.get(ip) || []).filter(t => t > win);
  if (a.length >= LIM.perIpHour) { hits.set(ip, a); return false; }
  a.push(now); hits.set(ip, a);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => t > win)) hits.delete(k);
  return true;
}

/* ── logging that cannot leak ──────────────────────────────────────────────
   Counts, milliseconds and outcomes. Never a photograph, never the note,
   never an upstream body, never a header. */
const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ── THE ACCESS CODE IS NOW A BETA SWITCH, NOT THE GATE ───────────────────
   When this file was written the shared access code was the ONLY thing
   standing between the internet and our key, so "no code configured means the
   route is off" was exactly right — fail closed, always.

   There is an account layer now, and it is strictly stronger: a Supabase
   token, verified by Supabase, against a plan column only the service role can
   write. Leaving the code as a hard requirement on top of that would mean
   every paying subscriber typing a shared password into a box before they can
   use a feature they have already bought — a second lock on a door they hold
   the key to, and the kind of thing people email about on day one.

   So: the route is available when there is a real gate of ANY kind, and each
   gate that IS configured is enforced.
     · code set          → it is checked, exactly as before (private beta)
     · code not set, accounts configured → the account is the gate
     · neither           → off, which is the fail-closed case that matters
   Nothing here loosens the entitlement check below; it only stops the beta
   switch from locking out the people the entitlement is for. */
const ACCOUNTS_ON = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const gateFails = (req, what) => {
  if (!ACCESS && !ACCOUNTS_ON())
    return [503, `The ${what} is not switched on for this deployment.`];
  if (ACCESS && (req.get('x-ni-access') || '') !== ACCESS)
    return [401, 'That access code is not right.'];
  return null;
};

/* ══ THE MONTH SOMEBODY PAID FOR ═══════════════════════════════════════════
   Five routes had five copies of this, and the copies are why it took a
   second read of billing.js to notice that `usedThisMonth` could return a
   third thing. One gate now, returning the cap the caller needs afterwards
   for countUse(), so a new AI feature cannot be written with four of the
   three cases handled.

     · null    — the meter is not in the database yet. Deliberately does NOT
                 block: a site deployed ahead of its migration must not switch
                 off a feature somebody is paying for.
     · NOMETER — the meter IS there and could not be read. That is not a
                 licence, and it is not the caller's fault either, so it is a
                 503 that says try again rather than a 429 that says you are
                 out.
     · a number — the ordinary case.

   And a cap of exactly 0 now means OFF rather than unlimited. It used to mean
   unlimited, because the guard read `cap > 0 &&`. */
async function meterFails(res, ent, feature, plural){
  const cap  = capFor(feature, ent.tier);
  const used = await usedThisMonth(ent.uid, feature);
  if (used === NOMETER)
    return { cap, fail: [503, 'Your allowance for this month could not be checked just now, so '
      + 'nothing was sent. Try again in a moment.', { meter: 'unreadable' }] };
  if (cap === 0)
    return { cap, fail: [403, 'That is not switched on for this deployment.', { capped: true }] };
  /* ── THE LAST SLOT CANNOT BE PASSED TWICE ────────────────────────────────
     Ten parallel requests at used=99 all read 99 and all passed a cap of 100:
     the gap between the read above and the count after the work is bounded by
     concurrency, not arithmetic. So the check charges live in-flight HOLDS on
     top of the database figure, and a request that passes places one — the
     compare and the hold are synchronous in one event-loop continuation, so
     no await separates them and two requests cannot both take the last slot.
     countUse() retires the hold when the real count lands; a request that
     dies keeps its slot warm until the hold expires, which errs on the side
     that is not unmetered spend. The full reasoning lives above meterHold in
     billing.js. */
  if (cap > 0 && used !== null){
    if (used + meterHolds(ent.uid, feature) >= cap)
      return { cap, fail: [429, `That is ${cap} ${plural} this month, which is what this plan `
        + 'includes. It resets on the first. Nothing was sent.', { monthly: true, used, cap }] };
    meterHold(ent.uid, feature);
    /* the hold comes down by exactly one of two hands: countUse(), when the
       real count lands in the database, or this — when the response closes on
       anything that is not a success. Without the second, a request refused
       for bad input two lines further down would shadow the boundary until
       the hold expired. The split on statusCode is what stops them both
       firing for one request. */
    res.on('close', () => { if (res.statusCode !== 200) meterRelease(ent.uid, feature); });
  }
  return { cap, fail: null };
}

/* ══ THE READ ══════════════════════════════════════════════════════════════ */
app.post('/api/read', express.json({ limit: (LIM.maxTotalKb + 1000) + 'kb' }), async (req, res) => {
  const t0 = Date.now();
  const fail = (code, why, extra) => { log('read', code, why); res.status(code).json({ ok:false, error:why, ...extra }); };

  /* fails closed. An unconfigured deploy is a disabled endpoint, never an
     open one — this is the single most important line in the file. */
  if (!KEY && !MOCK) return fail(503, 'The photo read is not switched on for this deployment.');
  { const g = gateFails(req, 'photo read'); if (g) return fail(g[0], g[1]); }

  /* ── AND WHO IS ASKING ───────────────────────────────────────────────────
     The access code above says whether this DEPLOYMENT has the read switched
     on. It does not say who may use it: it is one shared string, typed by a
     person, kept in a browser, and one of them posting it in a forum makes it
     everybody's. That is fine as a deployment switch and useless as an
     entitlement.

     The entitlement is the account. The token is Supabase's, Supabase says
     whether it is real, and the plan behind it is a column only the service
     role can write — which is the same chain that makes a subscription mean
     something. A demo cannot reach here, because a demo has no session; a
     free account cannot, because its tier is 0; and a browser claiming
     otherwise is not consulted.

     403 rather than 401: the credential was understood, it simply does not
     buy this. The distinction matters to the page, which shows "that code is
     wrong" for one and "this comes with Underwriter" for the other. */
  const ent = await entitlementOf(req, 2);
  if (!ent.ok){
    const SAY = {
      unconfigured: 'The photo read is not switched on for this deployment.',
      nosession:    'The photo read needs an account. Nothing was sent.',
      noprofile:    'The photo read needs an account. Nothing was sent.',
      lookup:       'The account could not be checked just now. Nothing was sent.',
      free:         'The photo read comes with Underwriter, and with the fourteen-day trial. Nothing was sent.',
      lowtier:      'The photo read comes with Underwriter. Nothing was sent.',
    };
    const code = ent.why === 'unconfigured' ? 503 : ent.why === 'lookup' ? 503 : 403;
    return fail(code, SAY[ent.why] || SAY.nosession, { entitlement: ent.why });
  }

  /* ── AND THE MONTH THEY BOUGHT ───────────────────────────────────────────
     The plans page prints a number of reads a month against each tier. Before
     this there was one global daily cap and nothing counted per account, so
     the number was decorative in both directions: unenforceable if somebody
     ran hot, and unprotectable for everybody else when they did — one user
     could spend the day's budget by lunchtime and the rest got 429s for
     something they had paid for.

     Read before the work, counted after it succeeds. Skipped entirely where
     the meter is not in the database yet, because a site deployed ahead of
     its migration must not switch off a feature somebody is paying for. */
  const meter = await meterFails(res, ent, 'airead', 'photo reads');
  if (meter.fail) return fail(meter.fail[0], meter.fail[1], meter.fail[2]);
  const cap = meter.cap;

  { const b = budgetFails(ent.uid, 'The photo read'); if (b) return fail(b[0], b[1], b[2]); }
  const ip = req.ip || 'unknown';
  if (!ipOk(ip)) return fail(429, `That is ${LIM.perIpHour} reads in an hour from one place. Try again shortly.`);

  /* ── the request is a stranger, even when you wrote the page that sent it ── */
  const body = req.body;
  if (!body || typeof body !== 'object') return fail(400, 'No request body.');
  const images = Array.isArray(body.images) ? body.images : null;
  if (!images || !images.length) return fail(400, 'No photographs were sent.');
  if (images.length > LIM.maxImages) return fail(400, `That is more than ${LIM.maxImages} photographs.`);

  const OKTYPE = ['image/jpeg','image/png','image/webp'];
  let totalKb = 0;
  const content = [];
  for (let i = 0; i < images.length; i++){
    const im = images[i];
    if (!im || typeof im !== 'object') return fail(400, `Photograph ${i+1} is not readable.`);
    const mt = String(im.media_type || '');
    if (OKTYPE.indexOf(mt) < 0) return fail(400, `Photograph ${i+1} is not a JPEG, PNG or WebP.`);
    const data = String(im.data || '');
    /* SIZE FIRST, then shape. The cheap check that protects the process has to
       run before the one that inspects the payload, and an oversized image
       must report that it is oversized rather than reporting a format problem
       it does not have — a wrong error message sends somebody debugging the
       wrong thing for an afternoon. */
    const kb = Math.round(data.length * 0.75 / 1024);
    if (kb > LIM.maxImageKb) return fail(413, `Photograph ${i+1} is ${kb}KB — the limit is ${LIM.maxImageKb}KB after resizing.`);
    /* standard base64: no whitespace, padding only at the end, length a
       multiple of four. Anything else never reaches the upstream. */
    if (data.length < 64 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
      return fail(400, `Photograph ${i+1} is not valid image data.`);
    totalKb += kb;
    if (totalKb > LIM.maxTotalKb) return fail(413, 'Those photographs come to more than the request limit.');
    content.push({ type:'text', text:`Photograph ${i+1}` });
    content.push({ type:'image', source:{ type:'base64', media_type:mt, data } });
  }

  /* the client sends FACTS and a note. It does not send a prompt, a system
     message, a model name or a tool — none of those are read from the body,
     so this endpoint cannot be turned into a general-purpose LLM by anybody
     who can open developer tools. */
  const house = (body.house && typeof body.house === 'object') ? body.house : {};
  const num = v => { const n2 = Number(String(v ?? '').replace(/[^0-9.]/g,'')); return Number.isFinite(n2) && n2 > 0 ? n2 : null; };
  const facts = { sqft:num(house.sqft), beds:num(house.beds), baths:num(house.baths),
                  year:num(house.year), arv:num(house.arv) };
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 400) : '';
  content.push({ type:'text', text: userBlock(facts, notes, images.length) });

  try {
    const out = MOCK ? mockAnswer() : await callAnthropic(content);
    const clean = validate(out.data);
    charge(ent.uid, out.usage);
    log('read ok', images.length + 'img', totalKb + 'kb', (Date.now()-t0) + 'ms',
        'seen ' + clean.stats.seen + '/17', 'day $' + day.usd.toFixed(3));
    /* the read worked, so it counts. Awaited rather than fired and forgotten:
       a count that loses a race is a cap that does not hold on exactly the
       traffic pattern it exists for. Failure here is not the caller's problem
       — they get their read either way and the number is a business fact, not
       a correctness one. */
    const month = await countUse(ent.uid, 'airead', cap).catch(() => null);
    res.json({ ok:true, ...clean, model: MOCK ? 'mock' : MODEL,
               ...(month ? { month: { used: month.used, cap: month.cap, left: month.remaining } } : {}),
               usage: { in: out.usage.input_tokens || 0, out: out.usage.output_tokens || 0 } });
  } catch (e){
    /* an upstream body can contain anything, including things about the
       account. It is logged as a code and a class, and never forwarded. */
    const code = e && e.niStatus ? e.niStatus : 502;
    log('read upstream-fail', code, e && e.niKind || 'unknown');
    fail(code === 429 ? 429 : 502,
      code === 429 ? 'The read is busy. Try again in a moment.'
                   : 'The read could not be completed. Nothing was stored.');
  }
});

async function callAnthropic(content){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type:'tool', name: TOOL.name },
        messages: [{ role:'user', content }],
      }),
    });
  } finally { clearTimeout(timer); }
  if (!r.ok){ const e = new Error('upstream'); e.niStatus = r.status; e.niKind = 'http'; throw e; }
  const j = await r.json();
  const use = (j.content || []).find(c => c.type === 'tool_use');
  if (!use){ const e = new Error('no tool call'); e.niKind = 'shape'; throw e; }
  return { data: use.input, usage: j.usage || {} };
}

/* ── THE HONESTY CHECK ─────────────────────────────────────────────────────
   The prompt asks the model to refuse what it cannot see. This checks that it
   did, and it is not decoration: a line that comes back with a number while
   claiming not to have been seen is DROPPED rather than trusted, and the
   count of those is returned so the calibration pass can see it happening. */
/* ── THE PHOTO READ MAY NOT PUT A PRICE ON ANYTHING ────────────────────────
   Four of the five AI features check every dollar figure against a set of
   figures we supplied. The photo read checked NONE — and it is the only one
   whose output is written into saved sheet state and printed on a lender
   packet.

   What that allowed: a model whose own system prompt demonstrates converting
   scores to dollars returns "Kitchen and baths need roughly $45,000 of work",
   `validate()` waves it through, `applyRead` stores it in S.read.summary and
   SAVES THE SHEET, and the photo report renders it as the lead paragraph —
   directly above a repairs total of about $21,000 computed from the very
   sliders that same read just set. Two contradictory repair figures, one of
   them invented, one paragraph apart, both persisted.

   The check here can be absolute, and that is the point. This model is asked
   for `seen` and a percentage-of-budget score per line. It is never given a
   dollar figure and never asked for one, so there is no legitimate money
   token for it to emit — any money-shaped string in its prose is invented by
   definition. Nothing to compare against, nothing to allow: strip it.

   Stripped rather than refused, unlike compare and objections. Those produce
   a document whose whole content is prose, so one invented figure poisons the
   draft. Here the prose is a caption on top of seventeen scored lines that are
   independently checked — throwing the read away over one sentence would cost
   the user a paid read to punish the model. The sentence goes; the read
   stands; the count is reported. */
/* A comma-grouped number is money-shaped, and so is a square footage. The
   exemption is narrow and explicit — a figure immediately followed by a size
   unit is a size, and "roughly 1,450 sq ft" is an honest thing for a caption
   to say. Everything else that looks like money is treated as money, because
   this model is never handed a price and so can never be right about one. */
const SIZE_AFTER = /^\s?(?:sq\.?\s?f(?:ee)?t|sqft|square\s?feet|sf\b)/i;
const MONEY_TOKEN = /(?:[$£€]\s?\d[\d,]*(?:\.\d{1,2})?)|(?:\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b)|(?:\b\d+(?:\.\d+)?\s?[kK]\b)|(?:\b\d[\d,]*\s?(?:dollars|USD)\b)/g;
/** every money token in `t` that is not immediately followed by a size unit */
function moneyHits(t){
  const out = [];
  MONEY_TOKEN.lastIndex = 0;
  let m;
  while ((m = MONEY_TOKEN.exec(t)) !== null){
    const after = t.slice(m.index + m[0].length);
    if (SIZE_AFTER.test(after)) continue;
    out.push({ tok: m[0].trim(), at: m.index });
  }
  MONEY_TOKEN.lastIndex = 0;
  return out;
}
function noMoney(text, tally){
  const t = String(text || '');
  const hits = moneyHits(t);
  if (!hits.length) return t;
  if (tally) for (const h of hits) tally.push(h.tok);
  /* the sentence carrying it goes, not just the token — "roughly of work" is
     a worse thing to print than nothing at all */
  /* split on the semicolon too, not just the full stop. "Kitchen and baths
     need roughly $45,000 of work; the mechanicals could not be seen" carries
     one invented figure and one honest observation, and dropping the honest
     half with it costs the reader something they paid for. */
  const kept = t.split(/(?<=[.!?;])\s+/).filter(sent => moneyHits(sent).length === 0);
  return kept.join(' ').replace(/^[;,\s]+/, '').replace(/\s+([.;,])/g, '$1').trim();
}

function validate(d){
  const lines = {}, unseen = [], contradicted = [];
  /* every money token this model tried to emit, so the count is reportable */
  const priced = [];
  const src = (d && typeof d.lines === 'object' && d.lines) ? d.lines : {};
  let seen = 0;
  for (const l of LINES){
    const r = src[l.id] || {};
    const sawIt = r.seen === true;
    let pc = (typeof r.pc === 'number' && Number.isFinite(r.pc)) ? Math.round(r.pc) : null;
    if (pc !== null) pc = Math.max(0, Math.min(100, pc));
    if (!sawIt && pc !== null){ contradicted.push(l.id); pc = null; }
    if (sawIt && pc === null){ contradicted.push(l.id); }
    const ok = sawIt && pc !== null;
    if (ok) seen++; else unseen.push(l.id);
    lines[l.id] = {
      seen: ok,
      pc: ok ? pc : null,
      conf: ok && ['high','med','low'].indexOf(r.conf) >= 0 ? r.conf : (ok ? 'low' : null),
      why: noMoney(typeof r.why === 'string' ? r.why.slice(0, 240) : '', priced),
      /* the lines a listing gallery almost never shows. Flagged so the desk
         can say "this one is unusual to be able to see" rather than treating
         a scored panel exactly like a scored kitchen. */
      rare: RARELY_VISIBLE.indexOf(l.id) >= 0,
    };
  }
  const flags = (Array.isArray(d && d.flags) ? d.flags : []).slice(0, 12).map(f => ({
    what:  noMoney(String((f && f.what)  || '').slice(0, 160), priced),
    where: noMoney(String((f && f.where) || '').slice(0, 120), priced),
    why:   noMoney(String((f && f.why)   || '').slice(0, 200), priced),
  })).filter(f => f.what);
  return {
    lines, flags,
    summary: noMoney(String((d && d.summary) || '').slice(0, 600), priced),
    stats: { seen, unseen: unseen.length, contradicted: contradicted.length,
             rareScored: LINE_IDS.filter(id => lines[id].seen && lines[id].rare).length,
             /* said out loud, so the report can tell the reader a sentence was
                withheld rather than quietly handing them a shorter one */
             priced: priced.length },
    priced: [...new Set(priced)].slice(0, 6),
    unseenIds: unseen,
  };
}

/* A deterministic answer so the whole pipeline — the browser resize, the
   gate, the caps, the validator, the panel that drops it onto the sliders —
   is testable end to end without spending a cent or holding a key. It also
   deliberately contains one CONTRADICTED line, so the honesty check is
   exercised on every mock run rather than only in theory. */
function mockAnswer(){
  const lines = {};
  const say = (id, seen, pc, conf, why) => lines[id] = { seen, pc, conf, why };
  say('roof',    false, null,  null,  'No photograph shows the roof plane. A shot from the street corner would.');
  say('found',   false, null,  null,  'No crawlspace, basement or foundation wall is visible.');
  say('siding',  true,  35,    'med', 'Chalking paint and two soft-looking boards below the front window, photo 1.');
  say('windows', true,  60,    'high','Single-glazed aluminium sliders throughout, photo 1 and photo 4.');
  say('hvac',    false, null,  null,  'No furnace, condenser or air handler in any frame.');
  say('plumb',   false, null,  null,  'Nothing under a sink is shown.');
  say('elec',    false, 55,    'low', 'CONTRADICTION FIXTURE: claims not seen and scores anyway.');
  say('water',   false, null,  null,  'No water heater in any frame.');
  say('kitchen', true,  85,    'high','Original oak cabinets, laminate counters, no dishwasher, photo 2.');
  say('bath1',   true,  70,    'high','Pink tile surround and a wall-hung basin, photo 5.');
  say('bath2',   true,  55,    'med', 'Second bath partially visible through the doorway in photo 6.');
  say('floors',  true,  75,    'high','Carpet over most of the plan, worn at the thresholds, photos 2-4.');
  say('paint',   true,  80,    'high','Original trim colour and scuffed walls in every interior frame.');
  say('doors',   true,  45,    'med', 'Hollow-core doors, hardware mismatched, photo 4.');
  say('drive',   true,  30,    'med', 'Cracked concrete apron at the kerb, photo 1.');
  say('yard',    true,  40,    'med', 'Overgrown to the fence line and one panel down, photo 7.');
  say('misc',    true,  35,    'low', 'Scope implies permits for the kitchen and the electrical work.');
  lines.elec.seen = false;                       // the contradiction, explicitly
  return { data: { lines, flags: [
    { what:'Water stain on the ceiling near the hall', where:'photo 3, top right',
      why:'It is a question about the roof or a supply line, not an answer about either. Look in the attic.' },
    { what:'Fresh paint on one basement wall only', where:'photo 8',
      why:'A single repainted wall is the classic cover for a moisture line. Ask when and why.' },
  ], summary:'These photographs show the inside well and the outside barely. Nothing here lets anybody conclude anything about the roof, the mechanicals or the foundation.' },
    usage: { input_tokens: 4200, output_tokens: 900 } };
}

/* ══ THE WAITLIST ══════════════════════════════════════════════════════════
   Before the payment rail exists, this is the only thing standing between a
   month of visitors and nothing at all. Every person the arcade and the drill
   bring in during pre-launch either lands in this table or is spent and gone,
   so the one behaviour that matters is that it NEVER SILENTLY SUCCEEDS: with
   no store configured it returns 503 and the page hands over the mailbox,
   rather than saying "thanks" into a void and being discovered on launch day
   with nobody to send to.

   It stores to Supabase, which is the same free tier auth will use — one
   dependency rather than two — and it has its own rate window so that a
   signup cannot spend the photo read's allowance or vice versa. */
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const LIST_ON = !!(SB_URL && SB_KEY);
const listHits = new Map();
function listOk(ip){
  const now = Date.now(), win = now - 36e5;
  const a = (listHits.get(ip) || []).filter(t => t > win);
  if (a.length >= 5) { listHits.set(ip, a); return false; }
  a.push(now); listHits.set(ip, a);
  if (listHits.size > 5000) for (const [k, v] of listHits) if (!v.some(t => t > win)) listHits.delete(k);
  return true;
}

/* ══ THE WRITTEN COMPARISON ════════════════════════════════════════════════
   The second thing on this service that spends the key, and it rides on
   exactly the rails the photo read already laid: the same access-code switch,
   the same account entitlement, the same per-account monthly meter. The only
   thing new is what it refuses.

   A model writing about money produces numbers that are NEARLY right, and a
   number that is nearly right on a document somebody forwards to a lender is
   worse than no document at all. So the model is handed every figure it could
   want — including the differences between sheets, precomputed, because "X
   more room than Y" is the one number it would otherwise work out and get
   subtly wrong — and then the prose is CHECKED. Every dollar amount in the
   reply has to be one we supplied. One invented figure fails the whole draft,
   because a draft that is right about four numbers and wrong about the fifth
   reads exactly as well as a correct one. */
app.post('/api/compare', express.json({ limit: '256kb' }), async (req, res) => {
  const t0 = Date.now();
  const fail = (code, why, extra) => { log('compare', code, why); res.status(code).json({ ok:false, error:why, ...extra }); };

  if (!KEY && !MOCK) return fail(503, 'The written comparison is not switched on for this deployment.');
  { const g = gateFails(req, 'written comparison'); if (g) return fail(g[0], g[1]); }

  const ent = await entitlementOf(req, 2);
  if (!ent.ok){
    const SAY = {
      unconfigured: 'The written comparison is not switched on for this deployment.',
      nosession:    'The written comparison needs an account. Nothing was sent.',
      noprofile:    'The written comparison needs an account. Nothing was sent.',
      lookup:       'The account could not be checked just now. Nothing was sent.',
      free:         'The written comparison comes with Underwriter, and with the fourteen-day trial. Nothing was sent.',
      lowtier:      'The written comparison comes with Underwriter. Nothing was sent.',
    };
    const code = (ent.why === 'unconfigured' || ent.why === 'lookup') ? 503 : 403;
    return fail(code, SAY[ent.why] || SAY.nosession, { entitlement: ent.why });
  }

  const meter = await meterFails(res, ent, 'aicompare', 'written comparisons');
  if (meter.fail) return fail(meter.fail[0], meter.fail[1], meter.fail[2]);
  const cap = meter.cap;

  { const b = budgetFails(ent.uid); if (b) return fail(b[0], b[1], b[2]); }
  if (!ipOk(req.ip || 'unknown'))
    return fail(429, `That is ${LIM.perIpHour} requests in an hour from one place. Try again shortly.`);

  /* the body is a stranger. Nothing here is a prompt: the facts are rebuilt
     from a fixed shape, so this endpoint cannot be turned into a general
     writing service by anybody who can open developer tools. */
  const facts = CMP.factsFrom(req.body);
  if (!facts) return fail(400, 'A comparison needs at least two sheets priced far enough to rank.');

  try {
    let text, usage = {};
    if (MOCK){
      const a = facts.sheets[facts.winner ?? 0], b = facts.sheets[facts.runner ?? 1];
      text = `Take ${a.name}, as ${a.bestExit}. It leaves ${money(a.room)} of room against `
           + `what they are asking, and the ceiling behind that is ${money(a.ceiling)}.\n\n`
           + `${b.name} is not a bad deal. Its spread on paper is ${money(b.spread)}.\n\n`
           + `What would change it: ${facts.flip ? facts.flip.assumption : 'nothing inside the ranges tested'}.\n\n`
           + `Send the offer on ${a.name} first.`;
    } else {
      const r = await callText(CMP.SYSTEM, CMP.userBlock(facts), 900);
      text = r.text; usage = r.usage;
    }
    const check = CMP.validate(text, facts);
    charge(ent.uid, usage);

    if (!check.ok){
      /* refused, not repaired. A draft with an invented figure quietly removed
         is still a draft written by something that invents figures. */
      log('compare REFUSED', check.invented.join(' '));
      return fail(422, 'The draft came back with a figure that is not on either sheet, so it was '
        + 'not shown to you. Nothing was stored. Try again.', { invented: check.invented });
    }
    const month = await countUse(ent.uid, 'aicompare', cap).catch(() => null);
    log('compare ok', facts.sheets.length + 'sheets', (Date.now()-t0) + 'ms', 'day $' + day.usd.toFixed(3));
    res.json({ ok:true, text, model: MOCK ? 'mock' : CMP.MODEL,
      ...(month ? { month:{ used: month.used, cap: month.cap, left: month.remaining } } : {}),
      usage: { in: usage.input_tokens || 0, out: usage.output_tokens || 0 } });
  } catch (e){
    log('compare FAILED', e.niKind || 'error', e.niStatus || '');
    return fail(502, 'The comparison did not come back. Nothing was stored, and nothing on your '
      + 'sheets changed.');
  }
});
const money = v => v === null || v === undefined ? '—'
  : (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US');

/* plain text out of the model, for the routes that want prose rather than a
   tool call. Same key, same timeout discipline, same refusal to forward an
   upstream body — an upstream error can contain anything. */
async function callText(system, user, maxTokens){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type':'application/json', 'x-api-key': KEY, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model: CMP.MODEL, max_tokens: maxTokens || 900,
        system, messages: [{ role:'user', content: user }] }),
    });
  } finally { clearTimeout(timer); }
  if (!r.ok){ const e = new Error('upstream'); e.niStatus = r.status; e.niKind = 'http'; throw e; }
  const j = await r.json();
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
  if (!text){ const e = new Error('empty'); e.niKind = 'shape'; throw e; }
  return { text, usage: j.usage || {} };
}


/* ══ THE STREET BRIEF ══════════════════════════════════════════════════════
   One page on what the block is actually doing. Four sources: the Census
   geocoder for the tract, the ACS for what the government counted, FEMA for
   the flood position at the actual coordinates, and a web search for permits
   and planning — with Zillow and Redfin blocked IN THE REQUEST, because this
   product has promised never to take their data and an intention is not a
   control.

   The three agency calls run in parallel and fail independently. If FEMA is
   down, the brief says the point is not in a mapped panel and goes on; if the
   census key is missing, it says so. A brief that returns nothing because one
   of four sources was slow is a brief nobody trusts to be there when they need
   it — and each absence is stated rather than left as a silence somebody reads
   as an absence of the thing itself. */
app.post('/api/street', express.json({ limit: '8kb' }), async (req, res) => {
  const t0 = Date.now();
  const fail = (code, why, extra) => { log('street', code, why); res.status(code).json({ ok:false, error:why, ...extra }); };

  if (!KEY && !MOCK) return fail(503, 'The street brief is not switched on for this deployment.');
  { const g = gateFails(req, 'street brief'); if (g) return fail(g[0], g[1]); }

  const ent = await entitlementOf(req, 2);
  if (!ent.ok){
    const SAY = {
      unconfigured: 'The street brief is not switched on for this deployment.',
      nosession:    'The street brief needs an account. Nothing was sent.',
      noprofile:    'The street brief needs an account. Nothing was sent.',
      lookup:       'The account could not be checked just now. Nothing was sent.',
      free:         'The street brief comes with Underwriter, and with the fourteen-day trial. Nothing was sent.',
      lowtier:      'The street brief comes with Underwriter. Nothing was sent.',
    };
    const code = (ent.why === 'unconfigured' || ent.why === 'lookup') ? 503 : 403;
    return fail(code, SAY[ent.why] || SAY.nosession, { entitlement: ent.why });
  }

  const meter = await meterFails(res, ent, 'aistreet', 'street briefs');
  if (meter.fail) return fail(meter.fail[0], meter.fail[1], meter.fail[2]);
  const cap = meter.cap;

  { const b = budgetFails(ent.uid); if (b) return fail(b[0], b[1], b[2]); }
  if (!ipOk(req.ip || 'unknown'))
    return fail(429, `That is ${LIM.perIpHour} requests in an hour from one place. Try again shortly.`);

  /* an address is a string a stranger typed. It goes into a government URL and
     into a prompt, so it is capped and stripped of anything that is not part
     of an address before either. */
  const address = String((req.body && req.body.address) || '')
    .replace(/[^\w\s,.'#/-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (address.length < 8)
    return fail(400, 'That does not look like a full address. The brief needs a street, a city and a state.');

  try {
    const g = await ST.geocode(address);
    if (!g) return fail(404, 'The Census Bureau could not find that address, so there is no tract to '
      + 'brief. Check the street and the city — nothing was sent.');

    /* independent, and none of them can hold the others up */
    const [acs, flood] = await Promise.all([
      ST.acsTract(g, process.env.CENSUS_KEY || '').catch(() => ({ ok:false, why:'error' })),
      ST.floodZone(g.lat, g.lon).catch(() => ({ ok:false, why:'error' })),
    ]);
    const facts = ST.factsFrom({ g, acs, flood });

    let content, usage = {}, searches = 0;
    if (MOCK){
      content = [{ type:'text', text:
        `Census Tract 42 in Atlanta city. ${facts.census.ownerOccupiedPercent !== undefined
          && facts.census.ownerOccupiedPercent !== null
          ? facts.census.ownerOccupiedPercent + '% of the occupied homes are owned rather than rented.'
          : 'The tract figures could not be read for this deployment.'}` },
        { type:'text', text:'The flood position is zone ' + (facts.flood.zone || 'unmapped') + '.' },
        { type:'text', text:'A rezoning was filed two streets north last spring.',
          citations:[{ type:'web_search_result_location', url:'https://example.gov/planning/123',
                       title:'Planning application 123' }] }];
    } else {
      const r = await callSearch(ST.SYSTEM, ST.userBlock(facts));
      content = r.content; usage = r.usage; searches = r.searches;
    }

    const A = ST.assemble(content, facts);
    const paras = ST.paragraphs(A);
    charge(ent.uid, usage, searches * 0.01);         // web search, $10 per 1,000

    if (!paras.length)
      return fail(422, 'The brief came back with nothing that could be verified against the census '
        + 'figures, so it was not shown to you. Nothing was stored.', { invented: A.invented });

    const month = await countUse(ent.uid, 'aistreet', cap).catch(() => null);
    log('street ok', g.tractName, searches + 'searches', A.dropped.length + 'dropped',
        (Date.now()-t0) + 'ms', 'day $' + day.usd.toFixed(3));
    res.json({ ok:true, address: g.matched, tract: g.tractName, county: g.countyName,
      place: g.placeName, census: facts.census, flood: facts.flood,
      paragraphs: paras, dropped: A.dropped.length, searches,
      /* how much of this brief is standing on a page somebody can open */
      sourced: A.sourced ?? 0, unsourced: A.unsourced ?? 0,
      model: MOCK ? 'mock' : ST.MODEL,
      ...(month ? { month:{ used: month.used, cap: month.cap, left: month.remaining } } : {}),
      usage: { in: usage.input_tokens || 0, out: usage.output_tokens || 0 } });
  } catch (e){
    log('street FAILED', e.niKind || 'error', e.niStatus || '');
    return fail(502, 'The brief did not come back. Nothing was stored.');
  }
});

/* the model, with the search tool attached. Returns the raw content blocks
   because the CITATIONS live on them, and the citations are the feature — a
   brief whose web claims cannot be clicked through to is a brief that is
   asking to be believed. */
async function callSearch(system, user){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST', signal: ctrl.signal,
      headers:{ 'content-type':'application/json', 'x-api-key': KEY, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model: ST.MODEL, max_tokens: 1600, system,
        tools: [ST.SEARCH_TOOL],
        messages: [{ role:'user', content: user }] }),
    });
  } finally { clearTimeout(timer); }
  if (!r.ok){ const e = new Error('upstream'); e.niStatus = r.status; e.niKind = 'http'; throw e; }
  const j = await r.json();
  const searches = (j.content || []).filter(c => c.type === 'server_tool_use').length;
  return { content: j.content || [], usage: j.usage || {}, searches };
}


/* ══ THE BID CHECK ═════════════════════════════════════════════════════════
   The only route on this service where the model writes no prose at all. It
   reads a pasted contractor's bid and says which of the seventeen systems
   each line belongs to; every figure in the answer is arithmetic done in
   bid.js against the desk's own condition read.

   The honesty control is the tightest of the three: an amount that is not
   printed in the pasted text is dropped, whatever it is. There is no draft to
   refuse and no sentence to check, because there is no sentence. */
app.post('/api/bid', express.json({ limit: '128kb' }), async (req, res) => {
  const t0 = Date.now();
  const fail = (code, why, extra) => { log('bid', code, why); res.status(code).json({ ok:false, error:why, ...extra }); };

  if (!KEY && !MOCK) return fail(503, 'The bid check is not switched on for this deployment.');
  { const g = gateFails(req, 'bid check'); if (g) return fail(g[0], g[1]); }

  const ent = await entitlementOf(req, 2);
  if (!ent.ok){
    const SAY = {
      unconfigured: 'The bid check is not switched on for this deployment.',
      nosession:    'The bid check needs an account. Nothing was sent.',
      noprofile:    'The bid check needs an account. Nothing was sent.',
      lookup:       'The account could not be checked just now. Nothing was sent.',
      free:         'The bid check comes with Underwriter, and with the fourteen-day trial. Nothing was sent.',
      lowtier:      'The bid check comes with Underwriter. Nothing was sent.',
    };
    const code = (ent.why === 'unconfigured' || ent.why === 'lookup') ? 503 : 403;
    return fail(code, SAY[ent.why] || SAY.nosession, { entitlement: ent.why });
  }

  const meter = await meterFails(res, ent, 'aibid', 'bid checks');
  if (meter.fail) return fail(meter.fail[0], meter.fail[1], meter.fail[2]);
  const cap = meter.cap;

  { const b = budgetFails(ent.uid); if (b) return fail(b[0], b[1], b[2]); }
  if (!ipOk(req.ip || 'unknown'))
    return fail(429, `That is ${LIM.perIpHour} requests in an hour from one place. Try again shortly.`);

  const text = String(req.body && req.body.bid || '').trim();
  if (text.length < 40)
    return fail(400, 'That is too short to be a bid. Paste the whole thing, prices included.');
  if (text.length > BID.MAX_BID_CHARS)
    return fail(413, `That is longer than ${BID.MAX_BID_CHARS.toLocaleString('en-US')} characters. `
      + 'Paste the schedule of works rather than the whole contract.');
  const sheetIn = BID.sheetFrom(req.body);
  if (sheetIn.total <= 0)
    return fail(400, 'Price the condition on the sheet first — the check is against your own estimate, and there is not one yet.');

  try {
    let data, usage = {};
    if (MOCK){
      /* the mock reads the pasted text the same way the route does, so a test
         exercises the join and the figure check rather than a fixture */
      const seen = [...BID.figuresIn(text)].filter(n => n >= 100).sort((a, b) => b - a);
      data = { statedTotal: null, exclusions: ['Excludes permits and asbestos abatement.'],
        items: seen.slice(0, 6).map((n, i) => ({
          text: 'Mock line ' + (i + 1), amount: n,
          line: ['roof','hvac','kitchen','elec','floors','other'][i % 6] })) };
    } else {
      const r = await callTool(BID.MODEL, BID.SYSTEM, BID.TOOL, BID.userBlock(text), 4000);
      data = r.data; usage = r.usage;
    }
    const out = BID.reconcile(data, sheetIn, text);
    charge(ent.uid, usage);

    const why = BID.readable(out);
    if (why){ log('bid UNREADABLE', out.counts.items, out.counts.dropped); return fail(422, why, { counts: out.counts }); }

    const month = await countUse(ent.uid, 'aibid', cap);
    log('bid ok', `${out.counts.items} lines`, `${out.missing.length} missing`,
        `${out.counts.dropped} dropped`, `${Date.now() - t0}ms`);
    return res.json({ ok:true, ...out,
      ...(month ? { month:{ used: month.used, cap: month.cap, left: month.remaining } } : {}),
      usage: { in: usage.input_tokens || 0, out: usage.output_tokens || 0 } });
  } catch (e){
    log('bid FAILED', e.niKind || 'error', e.niStatus || '');
    return fail(502, 'The bid check did not come back. Nothing was stored.');
  }
});

/* the same shape as callAnthropic, with the model and tool passed in, because
   there are two structured-output routes now and one of them should not have
   to borrow the other's constants */
async function callTool(model, system, tool, user, maxTokens){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST', signal: ctrl.signal,
      headers:{ 'content-type':'application/json', 'x-api-key': KEY, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens || 4000, system,
        tools: [tool], tool_choice: { type:'tool', name: tool.name },
        messages: [{ role:'user', content: user }] }),
    });
  } finally { clearTimeout(timer); }
  if (!r.ok){ const e = new Error('upstream'); e.niStatus = r.status; e.niKind = 'http'; throw e; }
  const j = await r.json();
  const use = (j.content || []).find(c => c.type === 'tool_use');
  if (!use){ const e = new Error('no tool call'); e.niKind = 'shape'; throw e; }
  return { data: use.input, usage: j.usage || {} };
}


/* ══ THE OTHER SIDE OF THE TABLE ═══════════════════════════════════════════
   The only route that is allowed to reason from the investor's CEILING. The
   letter of intent may never print it — what they could have paid is theirs —
   and this panel exists on the other side of exactly that rule: it never
   leaves their screen, and the ceiling is the whole point of it. "Can you come
   up five?" has a true answer and this is where it gets computed. */
app.post('/api/objections', express.json({ limit: '32kb' }), async (req, res) => {
  const t0 = Date.now();
  const fail = (code, why, extra) => { log('object', code, why); res.status(code).json({ ok:false, error:why, ...extra }); };

  if (!KEY && !MOCK) return fail(503, 'The other side of the table is not switched on for this deployment.');
  { const g = gateFails(req, 'objections panel'); if (g) return fail(g[0], g[1]); }

  const ent = await entitlementOf(req, 2);
  if (!ent.ok){
    const SAY = {
      unconfigured: 'The other side of the table is not switched on for this deployment.',
      nosession:    'The other side of the table needs an account. Nothing was sent.',
      noprofile:    'The other side of the table needs an account. Nothing was sent.',
      lookup:       'The account could not be checked just now. Nothing was sent.',
      free:         'The other side of the table comes with Underwriter, and with the fourteen-day trial. Nothing was sent.',
      lowtier:      'The other side of the table comes with Underwriter. Nothing was sent.',
    };
    const code = (ent.why === 'unconfigured' || ent.why === 'lookup') ? 503 : 403;
    return fail(code, SAY[ent.why] || SAY.nosession, { entitlement: ent.why });
  }

  const meter = await meterFails(res, ent, 'ailetter', 'of these');
  if (meter.fail) return fail(meter.fail[0], meter.fail[1], meter.fail[2]);
  const cap = meter.cap;

  { const b = budgetFails(ent.uid); if (b) return fail(b[0], b[1], b[2]); }
  if (!ipOk(req.ip || 'unknown'))
    return fail(429, `That is ${LIM.perIpHour} requests in an hour from one place. Try again shortly.`);

  const facts = OBJ.factsFrom(req.body);
  if (!facts) return fail(400, 'This needs an offer and a ceiling — price the deal first.');

  try {
    let data, usage = {};
    if (MOCK){
      const m = v => '$' + Math.abs(v).toLocaleString('en-US');
      data = { reading: 'Speed, and a closing date they can plan around.',
        objections: [
          { says:'Can you come up a bit?', beneath:'Convince me you will actually close.',
            answer: facts.headroom > 0
              ? `There is ${m(facts.headroom)} between this and the point where it stops working for me, and I would rather spend it on your date than on the price.`
              : 'There is nothing left above this one. I would rather tell you that than find out at the closing table.',
            verdict: facts.headroom > 0 ? 'trade' : 'hold', costs: facts.headroom > 0 ? facts.headroom : null },
          { says:'We have another offer.', beneath:'Is yours the one that closes?',
            answer:'Take it if it is better. Mine is the one that does not need an appraisal.', verdict:'hold', costs:null },
          { says: facts.asking !== null ? `We are asking ${m(facts.asking)}.` : 'We were hoping for more.',
            beneath:'Justify the difference.',
            answer: facts.gap !== null ? `I know. The difference is ${m(facts.gap)} and it is all in the work.` : 'I know.',
            verdict:'hold', costs: facts.gap },
        ] };
    } else {
      const r = await callTool(OBJ.MODEL, OBJ.SYSTEM, OBJ.TOOL, OBJ.userBlock(facts), 2200);
      data = r.data; usage = r.usage;
    }
    const check = OBJ.validate(data, facts);
    charge(ent.uid, usage);

    if (!check.ok){
      log('object REFUSED', check.empty ? 'empty' : check.invented.join(' '));
      return fail(422, check.empty
        ? 'Nothing usable came back. Nothing was stored.'
        : 'The draft came back with a figure that is not on this sheet, so it was refused rather '
          + 'than tidied up. Nothing was stored. Try again.',
        { invented: check.invented.slice(0, 6) });
    }

    const month = await countUse(ent.uid, 'ailetter', cap);
    const out = OBJ.clean(data);
    log('object ok', `${out.objections.length} back`, `${Date.now() - t0}ms`);
    return res.json({ ok:true, ...out,
      ...(month ? { month:{ used: month.used, cap: month.cap, left: month.remaining } } : {}),
      usage: { in: usage.input_tokens || 0, out: usage.output_tokens || 0 } });
  } catch (e){
    log('object FAILED', e.niKind || 'error', e.niStatus || '');
    return fail(502, 'That did not come back. Nothing on your sheet changed.');
  }
});

app.post('/api/list', express.json({ limit: '4kb' }), async (req, res) => {
  if (!LIST_ON) { log('list 503 unconfigured'); return res.status(503).json({ ok:false, error:'The list is not open yet.' }); }
  if (!listOk(req.ip || 'unknown')) return res.status(429).json({ ok:false, error:'Too many, too fast.' });
  const b2 = req.body || {};
  const email = String(b2.email || '').trim().slice(0, 160).toLowerCase();
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(email))
    return res.status(400).json({ ok:false, error:'That is not an email address.' });
  const from = String(b2.from || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'plans';
  try {
    const r = await fetch(`${SB_URL}/rest/v1/waitlist`, {
      method: 'POST',
      headers: { 'content-type':'application/json', apikey: SB_KEY,
                 authorization: `Bearer ${SB_KEY}`,
                 /* a second signup from the same address is a person pressing
                    twice, not an error to show them */
                 Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ email, source: from }]),
    });
    if (!r.ok){ log('list upstream', r.status); return res.status(502).json({ ok:false, error:'The list could not be reached.' }); }
    /* the address itself is never written to a log — the count and the source
       are all that is needed to know the thing is working */
    log('list ok', from);
    res.json({ ok:true });
  } catch(e){
    log('list fail', (e && e.name) || 'unknown');
    res.status(502).json({ ok:false, error:'The list could not be reached.' });
  }
});

/* ══ THE LAND DESK'S TWO SMALL SERVICES ════════════════════════════════════
   No model, no billing — the land arithmetic runs in the page. What the page
   cannot do alone is (1) hold the Google Map Tiles key and say when the
   ground is open, and (2) turn an address into a coordinate.

   THE KEY IS HANDED, NOT SHIPPED. A Map Tiles key is built to live in a
   browser — Google's own docs put it in the tileset URL — and its real
   protection is the referrer restriction set in the Google console, not
   secrecy. But a key baked into a static page is a key in every mirror and
   cache forever, with no off switch. Served from here it can be rotated,
   capped and refused in one place, and the day's budget is OURS to enforce
   before Google's meter starts running:

     · 1,000 root-tile sessions a month are free; $6 per 1,000 after.
     · One session lasts 3+ hours, so a visit is ONE root request — the page
       never re-fetches the root on a re-render.
     · NI_TILES_DAY_CAP (default 150) is the wallet guard. In-memory, resets
       with the process — Google's own 10k/day ceiling is the backstop, and
       an undercounted day costs cents, not dollars.

   THE GEOCODER IS THE CENSUS BUREAU'S, because it is free, keyless, public
   infrastructure, and this product already stands on Census data for its
   priors. Proxied rather than called from the page so the address never
   picks up a third-party key requirement, and so the FEMA read can join the
   same answer later — the server is where facts get computed. */
const TILES_KEY = process.env.GOOGLE_TILES_KEY || '';
const TILES_CAP = N('NI_TILES_DAY_CAP', 150);
let tiles = { day: new Date().toISOString().slice(0, 10), n: 0 };
/* ── THE ONE ENDPOINT THAT HANDS OUT A KEY ────────────────────────────────
   This had no per-IP limit while /api/land/geo directly below it did, which is
   the wrong way round: the geocoder is free and this one costs $6 per thousand
   sessions. A loop from a single address could take the whole daily allowance
   in a few seconds — the map goes flat for every real visitor for the rest of
   the day — and collect the key on every pass. The referrer restriction in the
   Google console is what stops the key being USED elsewhere; it does nothing
   about the drain, and a key you can harvest at will is a key you will
   eventually have to rotate.

   A real visitor asks once per page load and gets a session that lasts three
   hours or more. Six an hour is generous for a person reloading, and nothing
   at all for a script. */
const tileHits = new Map();
function tileOk(ip){
  const now = Date.now(), win = now - 36e5;
  const a = (tileHits.get(ip) || []).filter(t => t > win);
  /* 6/hour was set when the page spent a session on every ARRIVAL, and it
     silently flattened the map for anybody who opened the desk seven times in
     an hour — which is one person actually working, and is exactly the
     "sometimes the map is just broken" report. The ground is a deliberate
     press now, so a config call means somebody asked; twenty an hour is a
     person, and the daily cap still bounds the spend. */
  if (a.length >= 20){ tileHits.set(ip, a); return false; }
  a.push(now); tileHits.set(ip, a);
  if (tileHits.size > 5000) for (const [k, v] of tileHits) if (!v.some(t => t > win)) tileHits.delete(k);
  return true;
}
app.get('/api/land/config', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  if (tiles.day !== today) tiles = { day: today, n: 0 };
  if (!TILES_KEY) return res.json({ ok:false, why:'unconfigured' });
  /* checked BEFORE the counter moves, so a blocked caller cannot spend the
     allowance it is being refused */
  if (!tileOk(req.ip || 'unknown')){
    log('land config 429 per-ip');
    return res.status(429).json({ ok:false, why:'rate',
      error:'That is a lot of map in one hour from one place. The flat drawing still works.' });
  }
  if (tiles.n >= TILES_CAP){ log('land config 429 quota', tiles.n); return res.json({ ok:false, why:'quota' }); }
  tiles.n++;
  log('land config ok', tiles.n + '/' + TILES_CAP);
  res.json({ ok:true, key: TILES_KEY });
});
app.get('/api/land/geo', async (req, res) => {
  if (!ipOk(req.ip || 'unknown'))
    return res.status(429).json({ ok:false, error:`That is ${LIM.perIpHour} requests in an hour from one place. Try again shortly.` });
  const q = String(req.query.q || '').trim().slice(0, 160);
  if (q.length < 6) return res.status(400).json({ ok:false, error:'That is not enough address to place.' });
  /* "lat, lng" pasted straight in skips the geocoder — rural parcels are
     exactly where address files run out, and a pin is already an answer */
  const m = q.match(/^(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/);
  if (m){ const lat = +m[1], lon = +m[2];
    if (lat >= 18 && lat <= 72 && lon >= -180 && lon <= -60)
      return res.json({ ok:true, lat, lon, matched: q, how:'pin' }); }
  try {
    const u = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(q);
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
    if (!r.ok){ log('land geo upstream', r.status); return res.status(502).json({ ok:false, error:'The geocoder could not be reached.' }); }
    const j = await r.json();
    const hit = j && j.result && j.result.addressMatches && j.result.addressMatches[0];
    if (!hit) return res.json({ ok:false, error:'No match in the Census address file. Paste "lat, lng" from any map and the pin does the same job.' });
    /* the address itself is never logged — same rule as the waitlist */
    log('land geo ok');
    res.json({ ok:true, lat: hit.coordinates.y, lon: hit.coordinates.x,
               matched: String(hit.matchedAddress || '').slice(0, 160), how:'census' });
  } catch(e){
    log('land geo fail', (e && e.name) || 'unknown');
    res.status(502).json({ ok:false, error:'The geocoder could not be reached.' });
  }
});

/* ══ BILLING ═══════════════════════════════════════════════════════════════
   Three routes in their own file, because the rule they exist to protect is
   worth stating in one place: the only thing that decides what somebody gets
   is `profiles.plan`, and the webhook is the only writer of it.

   Mounted HERE, above the static allowlist, so that /api/stripe reaches its
   raw-body parser before anything else touches the bytes a signature is
   computed over. */
mountBilling(app);

/* ══ IS THE CAGE ACTUALLY LOCKED? ══════════════════════════════════════════
   Migration 004 took table-level UPDATE on `profiles` away from the browser
   and granted back two harmless columns, which is what stops a user PATCHing
   their own `trial` date or zeroing their own `comp_used`. That protection is
   a fact about the live database, not about this repository — a migration in
   git that nobody ran protects nothing, and it fails SILENTLY. That is exactly
   how 002 and 003 looked successful while doing nothing.

   So the server asks, on a schedule, and /api/health says the answer out loud.
   Three states and no comforting default: `locked` means we looked and the
   only writable columns are name and market; `OPEN` means we looked and found
   a money column writable, and it names them; `unknown` means migration 005
   has not been run and nobody has checked — which is not the same as fine.

   Cached for an hour: the grant state changes when somebody runs SQL, not
   between requests, and health should not be a way to make the database work. */
const WRITABLE_OK = new Set(['name', 'market']);
let grantState = { v:'unknown', at:0, open:[] };
async function checkGrants(){
  if (!(SB_URL && SB_KEY)) return grantState;
  if (Date.now() - grantState.at < 36e5 && grantState.v !== 'unknown') return grantState;
  try {
    const r = await fetch(SB_URL + '/rest/v1/entitlement_grants?select=role,col,priv',
      { headers:{ apikey:SB_KEY, authorization:'Bearer ' + SB_KEY } });
    if (!r.ok){ grantState = { v:'unknown', at:Date.now(), open:[] }; return grantState; }
    const rows = await r.json();
    if (!Array.isArray(rows)){ grantState = { v:'unknown', at:Date.now(), open:[] }; return grantState; }
    const open = [...new Set(rows.filter(x => !WRITABLE_OK.has(x.col)).map(x => x.col))].sort();
    grantState = { v: open.length ? 'OPEN' : 'locked', at:Date.now(), open };
  } catch(e){ grantState = { v:'unknown', at:Date.now(), open:[] }; }
  return grantState;
}
/* one probe at boot, so a bad deploy is visible before a customer finds it */
if (SB_URL && SB_KEY) setTimeout(() => { checkGrants().then(g => {
  if (g.v === 'OPEN') console.error('[grants] WRITABLE FROM THE BROWSER: ' + g.open.join(', ') + ' — run srv/sql/004-column-grants.sql');
  else if (g.v === 'unknown') console.warn('[grants] not checked — run srv/sql/005-grant-audit.sql');
  else console.log('[grants] locked');
}); }, 4000).unref?.();

/* ══ HEALTH ════════════════════════════════════════════════════════════════
   Enough to diagnose a deploy, and nothing that helps anybody attack it: no
   key, no code, no counts by IP. */
app.get('/api/health', (_req, res) => {
  rollDay();
  checkGrants();                      // refreshes in the background; never blocks
  res.json({ ok:true, service:'negotiation-inc', mock:MOCK,
    read:    ((ACCESS || ACCOUNTS_ON()) && (KEY || MOCK)) ? 'on' : 'off',
    compare: ((ACCESS || ACCOUNTS_ON()) && (KEY || MOCK)) ? 'on' : 'off',
    street:  ((ACCESS || ACCOUNTS_ON()) && (KEY || MOCK))
               ? (process.env.CENSUS_KEY ? 'on' : 'partial') : 'off',
    bid:     ((ACCESS || ACCOUNTS_ON()) && (KEY || MOCK)) ? 'on' : 'off',
    object:  ((ACCESS || ACCOUNTS_ON()) && (KEY || MOCK)) ? 'on' : 'off',
    land: TILES_KEY ? (tiles.n >= TILES_CAP ? 'quota' : 'on') : 'flat',
    gate: ACCESS ? 'code+account' : ACCOUNTS_ON() ? 'account' : 'none',
    list: LIST_ON ? 'on' : 'off',
    /* named columns only when something IS open — a health endpoint that lists
       the writable columns on a locked database is a menu */
    grants: grantState.v === 'OPEN' ? { state:'OPEN', writable:grantState.open } : grantState.v,
    billing: billingState(),
    /* accounts, not who they are: a health endpoint that names the heavy user
       is a health endpoint you cannot leave open */
    today: { reads: day.n, capReads: LIM.perDay, capUsd: LIM.dailyUsd,
             ceilingReads: hardN(), ceilingUsd: hardUsd(),
             accounts: day.by.size,
             share: day.by.size ? +(LIM.dailyUsd / day.by.size).toFixed(3) : LIM.dailyUsd },
    limits: { maxImages: LIM.maxImages, maxImageKb: LIM.maxImageKb, perIpHour: LIM.perIpHour } });
});

/* ══ THE SITE ══════════════════════════════════════════════════════════════
   The same static files Render has been serving all along, from the same
   origin as the API — which is why the page needs no CORS, and why a session
   cookie will work the day auth arrives.

   The repo root also now contains the server itself, so it is served from an
   allowlist of what a browser is ever meant to fetch rather than by handing
   out the directory and hoping. */
/* ── .mjs IS OFF THE LIST ENTIRELY ─────────────────────────────────────────
   Not one shipped page loads a module — every .mjs in this repo is build or
   test tooling — so `mjs` on the ALLOW list was doing nothing except making
   the block list below responsible for naming each one. It named five, and
   test-urls.mjs made six: the harness caught the new file the same afternoon
   it was written, which is the good outcome, but the shape of the mistake was
   the one the comment below already describes happening to compare.js.

   A list of what may be fetched is a list you can check against the pages. A
   list of what may not is a list somebody has to remember to add to. */
const SERVE = /\.(html|css|js|json|png|jpe?g|gif|svg|webp|ico|woff2?|txt|xml|webmanifest|map)$/i;
/* Every server-side file by NAME, matched on the basename, so a stray copy in
   a subdirectory is refused too — /srv/compare.js is as blocked as /compare.js.
   compare.js and street.js were missing from this list for one deploy: neither
   holds a secret, but both hold the system prompt, and a prompt you can read is
   a prompt you can steer around. Anything added to srv/ belongs here. */
const NEVER = /^(server|prompt|billing|compare|street|bid|objections)\.js$|^package(-lock)?\.json$|^render\.yaml$|^(publish|suite2?|harness-util|test-api|test-pay|_.*|t-.*|v\d+)\.mjs$|^(LAUNCH|SUPABASE|STRIPE|DOMAIN|README)\.md$|^\.env/i;
/* ── ONE URL PER PAGE, AND IT HAS NO .html ON THE END ──────────────────────
   `/desk` rather than `/desk.html`. express.static's `extensions:['html']`
   below already resolves the clean form — what stopped it was the allowlist
   gate, which refused anything without a recognised extension and so 404'd
   every clean URL before static ever saw it.

   Two halves, and the second is the one that matters:

     · the gate lets an extensionless path through, still checking it against
       NEVER and `..`. It cannot leak a server file: `extensions` only ever
       APPENDS .html, so /server looks for server.html and finds nothing.
     · and /desk.html permanently redirects to /desk, so there is exactly one
       address for each page rather than two that both work. Two live URLs for
       one page is how a site ends up with its own pages competing in search
       results and half its inbound links pointing at the loser.

   301 rather than 302 on purpose: browsers cache it, so the redirect is paid
   once per link per browser and internal navigation costs nothing thereafter.
   The query string is carried across — the arcade hands the desk a whole
   house in one, and a redirect that drops it loses the handoff. */
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const m = /^(\/.*)\.html$/i.exec(decodeURIComponent(req.path));
  if (!m) return next();
  const q = req.originalUrl.slice(req.path.length);        // '?a=1' or ''
  const to = (m[1] === '/index' ? '/' : m[1]) + q;
  return res.redirect(301, to);
});
app.use((req, res, next) => {
  const p = decodeURIComponent(req.path).replace(/^\/+/, '');
  if (!p || p.endsWith('/')) return next();
  const base = p.split('/').pop();
  if (NEVER.test(base) || base.startsWith('.')) return res.status(404).type('txt').send('Not found');
  if (p.indexOf('..') >= 0) return res.status(400).type('txt').send('No');
  /* an extensionless name is a page request; static resolves it to .html or
     nothing at all. Anything WITH an extension still has to be on the list. */
  if (/\./.test(base) && !SERVE.test(base)) return res.status(404).type('txt').send('Not found');
  next();
});
app.use(express.static(__dirname, {
  dotfiles: 'deny',
  index: 'index.html',
  extensions: ['html'],
  setHeaders(res, fp){
    if (/\.(woff2?|png|jpe?g|svg|webp|ico)$/i.test(fp)) res.setHeader('cache-control','public,max-age=604800');
    else if (/\.html$/i.test(fp)) res.setHeader('cache-control','no-cache');
  },
}));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok:false, error:'No such endpoint.' });
  res.status(404).sendFile(path.join(__dirname, '404.html'), err => {
    if (err) res.status(404).type('txt').send('Not found');
  });
});

if (process.env.NI_NO_LISTEN !== '1'){
  app.listen(PORT, () => log(`up on ${PORT} · read ${(ACCESS && (KEY||MOCK)) ? 'on' : 'OFF'}${MOCK ? ' · MOCK' : ''}`));
}
export default app;
