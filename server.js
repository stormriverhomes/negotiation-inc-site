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
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MODEL, SYSTEM, TOOL, LINES, LINE_IDS, RARELY_VISIBLE, userBlock } from './prompt.js';
import * as CMP from './compare.js';
import * as ST from './street.js';
import * as BID from './bid.js';
import * as OBJ from './objections.js';
import * as INTAKE from './intake.js';
import { mountBilling, billingState, foundingState, entitlementOf, usedThisMonth, countUse, capFor, FEATURES, NOMETER, meterHold, meterHolds, meterRelease, cancelAllFor } from './billing.js';

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
  /* ── THE CEILING ACROSS ALL LANES ───────────────────────────────────────
     perIpHour is now PER ROUTE (see ipOk), so nine routes at twenty would let
     one address make 180 paid calls an hour if there were no total. This is
     that total. Three lanes' worth: enough that somebody doing real work on
     one property — read the photos, pull the comps, brief the street, check a
     bid — never meets it, and far short of nine lanes run flat out. */
  perIpAll:   N('NI_PER_IP_HOUR_ALL', 60),
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

/* ══ WHAT WENT WRONG, AND HOW OFTEN ════════════════════════════════════════
   If a route throws in production, nobody finds out. There is no alerting, no
   log anybody reads, and the browser turns every 500 into the same polite
   sentence — so the failure mode of this service is silence, and the way you
   learn is a customer who has already given up writing in to say so.

   This is deliberately NOT a logging service. It is a ring buffer in memory:
   the last forty distinct problems, each with a count and the times it was
   first and last seen. That shape is chosen on purpose — a route failing two
   hundred times is ONE thing to look at, and a list of two hundred identical
   lines is how a real signal gets buried.

   It holds no bodies, no addresses, no uids and no tokens. A message is
   truncated hard, because an upstream error string is the most likely place
   for somebody's data to end up somewhere it was never meant to be. */
const ERRS = new Map();                       // key → { route, code, msg, n, first, last }
const ERR_MAX = 40;
function noteErr(route, code, err){
  try {
    const msg = String((err && (err.message || err)) || 'unknown').slice(0, 160);
    const key = route + ' ' + code + ' ' + msg.slice(0, 60);
    const now = Date.now();
    const cur = ERRS.get(key);
    if (cur){ cur.n += 1; cur.last = now; return; }
    /* full: drop the oldest thing nobody has seen recently, never the newest */
    if (ERRS.size >= ERR_MAX){
      let oldestKey = null, oldest = Infinity;
      for (const [k, v] of ERRS) if (v.last < oldest){ oldest = v.last; oldestKey = k; }
      if (oldestKey) ERRS.delete(oldestKey);
    }
    ERRS.set(key, { route, code, msg, n: 1, first: now, last: now });
  } catch(e){}
}
const errList = () => [...ERRS.values()].sort((a, b) => b.last - a.last)
  .map(e => ({ ...e, first: new Date(e.first).toISOString(), last: new Date(e.last).toISOString() }));
const errCount = () => [...ERRS.values()].reduce((t, e) => t + e.n, 0);
/* the last hour is the number worth putting on a health check — a total since
   boot goes up forever and stops meaning anything after a week of uptime */
const errRecent = () => { const cut = Date.now() - 3600000;
  return [...ERRS.values()].filter(e => e.last >= cut).reduce((t, e) => t + e.n, 0); };

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
/* ── THE TWO LEVERS, DECLARED HERE ─────────────────────────────────────────
   Above budgetFails, which reads them, rather than beside the route that
   writes them. `let` has a temporal dead zone and even `typeof` throws inside
   it — this file has been bitten by exactly that once already, on the land
   desk, where a state object declared below its first reader threw silently
   inside the function that drew the floor. Declaration order is the fix and
   it costs nothing. */
let OPS = { pausedUntil: 0, pauseWhy: '', budgetOverride: null };
const opsPaused = () => OPS.pausedUntil > Date.now();
const opsBudget = () => Number.isFinite(OPS.budgetOverride) ? OPS.budgetOverride : null;

function budgetFails(uid, what){
  rollDay();
  /* ── THE BIG RED SWITCH ──────────────────────────────────────────────────
     It goes HERE because this is the one function every metered route already
     calls — five copies of a pause is five places for it to be forgotten, and
     the route that forgets is the one still spending. */
  if (opsPaused())
    return [503, (what || 'This service') + ' is paused for a few minutes while something is '
              + 'checked. Nothing was sent and nothing was counted against your allowance.',
            { paused: true }];
  /* the ceiling: a runaway is refused whoever it is, and this is the only
     refusal here that is allowed to be indiscriminate */
  if (day.usd >= hardUsd() || day.n >= hardN())
    return [429, (what || 'This service') + ' has hit its ceiling for today. It resets within 24 hours.',
            { retryHours: 24, ceiling: true }];
  /* under budget: nobody is refused, which is almost always the case */
  const budget = opsBudget() !== null ? opsBudget() : LIM.dailyUsd;
  if (day.n < LIM.perDay && day.usd < budget) return null;
  /* over budget: only the accounts above their share */
  const heads  = Math.max(1, day.by.size);
  const mine   = day.by.get(uid || 'anon') || { n: 0, usd: 0 };
  if (mine.usd >= budget / heads || mine.n >= LIM.perDay / heads)
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
/* ── ONE BUCKET PER LANE, PLUS A CEILING ACROSS THEM ───────────────────────
   This was a single bucket keyed on the address alone, shared by nine
   routes at twenty an hour. What that actually meant to a person: brief
   twenty streets and the photo read stops working — a feature they are
   paying for, refused because of a different feature they already used, with
   a message that says "twenty requests in an hour" and names neither. The
   opposite failure was live too: an attacker got twenty shots at the single
   most expensive route rather than twenty spread across nine.

   A lane is a route. Each lane gets perIpHour of its own, and every request
   also spends one from a shared ceiling so nine lanes cannot be added up.
   The lane is passed in by the caller rather than derived from req.path,
   because two routes that spend the same upstream budget (the comp pull and
   the rent lookup are both one RentCast request) belong in one lane and the
   path cannot know that.

   Returns null when allowed, and the name of the wall when not, so the 429
   can say WHICH limit was met — a refusal a person cannot act on is a bug
   even when the refusal itself is correct. */
function ipOk(ip, lane){
  const now = Date.now(), win = now - 36e5;
  const keys = [ip + ' ' + (lane || 'all'), ip + ' *'];
  const caps = [LIM.perIpHour, Math.max(LIM.perIpHour, LIM.perIpAll)];
  const lists = keys.map(k => (hits.get(k) || []).filter(t => t > win));
  for (let i = 0; i < keys.length; i++){
    if (lists[i].length >= caps[i]){
      /* write the pruned list back even on refusal, so a bucket that has
         aged out cannot keep somebody locked on stale timestamps */
      hits.set(keys[i], lists[i]);
      return i === 0 ? 'lane' : 'all';
    }
  }
  for (let i = 0; i < keys.length; i++){ lists[i].push(now); hits.set(keys[i], lists[i]); }
  if (hits.size > 8000) for (const [k, v] of hits) if (!v.some(t => t > win)) hits.delete(k);
  return null;
}
/* the sentence a person reads when they meet one of the two walls */
const ipWall = (which, noun) => which === 'all'
  ? `That is ${Math.max(LIM.perIpHour, LIM.perIpAll)} requests in an hour from one place, across `
    + `everything. Try again shortly — nothing was spent.`
  : `That is ${LIM.perIpHour} ${noun || 'requests'} in an hour from one place. Other tools still `
    + `work; this one is back within the hour.`;

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
  /* the label is a NOUN, never a noun with its article already attached: the
     sentence supplies "The". Two routes handed it "the comp pull" and shipped
     "The the comp pull is not switched on" — a sentence a person reads as a
     product that is not being looked after. */
  if (/^the\s/i.test(String(what))) what = String(what).replace(/^the\s+/i, '');
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

/* ══ THE DOOR BEFORE THE PARSER ════════════════════════════════════════════
   express.json() is the SECOND argument to these routes, which means the full
   body is buffered and JSON.parse'd before the handler's first line runs —
   before the fail-closed check, before gateFails(), before entitlementOf(),
   and long before ipOk(). Every limit in this file sits downstream of a parse
   that has already happened.

   Measured on the shipped build: 100 concurrent 7.4MB POSTs to /api/read with
   the route switched OFF still peaked at 609MB RSS — past Render starter's
   512MB — and 30 concurrent 9.9MB POSTs with no Authorization header at all
   killed the process outright with a heap OOM. Health latency went from p95
   1.8ms to p95 1098ms on the way down.

   And the kill is not just downtime. `day` is module state, re-initialised at
   import, and rollDay() rolls 24h after BOOT rather than at midnight — so
   every crash resets the daily spend ceiling and the service will spend the
   whole thing again.

   This runs ahead of the parser, reads one header, and allocates nothing. It
   is deliberately generous: the real per-request limits still apply below. It
   exists only to stop an anonymous caller turning bytes into a restart. */
const MAXBODY = (LIM.maxTotalKb + 1200) * 1024;
const bodyGate = (req, res, next) => {
  const n = Number(req.get('content-length') || 0);
  if (Number.isFinite(n) && n > MAXBODY){
    log('body refused', Math.round(n / 1024) + 'kb');
    return res.status(413).json({ ok:false,
      error:'That request is larger than this endpoint accepts. Nothing was sent.' });
  }
  next();
};

/* ══ THE READ ══════════════════════════════════════════════════════════════ */
app.post('/api/read', bodyGate, express.json({ limit: (LIM.maxTotalKb + 1000) + 'kb' }), async (req, res) => {
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
  { const wall = ipOk(ip, 'read');
    if (wall) return fail(429, ipWall(wall, 'photo reads')); }

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
app.post('/api/compare', bodyGate, express.json({ limit: '256kb' }), async (req, res) => {
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
  { const wall = ipOk(req.ip || 'unknown', 'compare');
    if (wall) return fail(429, ipWall(wall, 'written comparisons')); }

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
app.post('/api/street', bodyGate, express.json({ limit: '8kb' }), async (req, res) => {
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
  { const wall = ipOk(req.ip || 'unknown', 'street');
    if (wall) return fail(429, ipWall(wall, 'street briefs')); }

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
app.post('/api/bid', bodyGate, express.json({ limit: '128kb' }), async (req, res) => {
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
  { const wall = ipOk(req.ip || 'unknown', 'bid');
    if (wall) return fail(429, ipWall(wall, 'bid checks')); }

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


/* ══ THE INTAKE ════════════════════════════════════════════════════════════
   Photographs of paperwork in, figures out, each one quoted from the model's
   own transcript of what it read. Nothing here prices anything: the sheet has
   a home for these figures and a NEEDED state for the ones nobody supplied,
   so the whole feature is a faster way to fill a form the desk already has.

   The image validation is the read's, character for character, because the
   two routes accept the same thing and a second, subtly different copy of a
   size check is how one of them ends up with the looser one. */
app.post('/api/intake', bodyGate, express.json({ limit: (LIM.maxTotalKb + 1000) + 'kb' }), async (req, res) => {
  const t0 = Date.now();
  const fail = (code, why, extra) => { log('intake', code, why); res.status(code).json({ ok:false, error:why, ...extra }); };

  if (!KEY && !MOCK) return fail(503, 'The intake is not switched on for this deployment.');
  { const g = gateFails(req, 'intake'); if (g) return fail(g[0], g[1]); }

  const ent = await entitlementOf(req, 2);
  if (!ent.ok){
    const SAY = {
      unconfigured: 'The intake is not switched on for this deployment.',
      nosession:    'The intake needs an account. Nothing was sent.',
      noprofile:    'The intake needs an account. Nothing was sent.',
      lookup:       'The account could not be checked just now. Nothing was sent.',
      free:         'The intake comes with Underwriter, and with the fourteen-day trial. Nothing was sent.',
      lowtier:      'The intake comes with Underwriter. Nothing was sent.',
    };
    const code = (ent.why === 'unconfigured' || ent.why === 'lookup') ? 503 : 403;
    return fail(code, SAY[ent.why] || SAY.nosession, { entitlement: ent.why });
  }

  const meter = await meterFails(res, ent, 'aiintake', 'intakes');
  if (meter.fail) return fail(meter.fail[0], meter.fail[1], meter.fail[2]);
  const cap = meter.cap;

  { const b = budgetFails(ent.uid, 'The intake'); if (b) return fail(b[0], b[1], b[2]); }
  { const wall = ipOk(req.ip || 'unknown', 'intake');
    if (wall) return fail(429, ipWall(wall, 'listing reads')); }

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
    const kb = Math.round(data.length * 0.75 / 1024);
    if (kb > LIM.maxImageKb) return fail(413, `Photograph ${i+1} is ${kb}KB — the limit is ${LIM.maxImageKb}KB after resizing.`);
    if (data.length < 64 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
      return fail(400, `Photograph ${i+1} is not valid image data.`);
    totalKb += kb;
    if (totalKb > LIM.maxTotalKb) return fail(413, 'Those photographs come to more than the request limit.');
    content.push({ type:'text', text:`Photograph ${i+1}` });
    content.push({ type:'image', source:{ type:'base64', media_type:mt, data } });
  }
  /* one line of context, fenced with a nonce. No prompt, no system, no model,
     no tool is read from the body — the same rule as every other route. */
  const hint = typeof body.note === 'string' ? body.note.slice(0, 200) : '';
  content.push({ type:'text', text: INTAKE.userBlock(images.length, hint) });

  try {
    let data, usage = {};
    if (MOCK){
      /* the mock TRANSCRIBES a fixture and reports against it, so a test
         exercises the rail rather than a hand-written pass */
      data = { transcript: 'List price $249,500\nLiving area 1,412 sq ft\n3 beds · 2 baths\nYear built 1968\nAnnual taxes $3,240\nSold as-is, seller has never occupied',
        fields: [ { id:'asking', value:249500, saw:'List price $249,500' },
                  { id:'sqft',   value:1412,   saw:'Living area 1,412 sq ft' },
                  { id:'beds',   value:3,      saw:'3 beds' },
                  { id:'baths',  value:2,      saw:'2 baths' },
                  { id:'year',   value:1968,   saw:'Year built 1968' },
                  { id:'taxes',  value:3240,   saw:'Annual taxes $3,240' },
                  /* the failure that actually happens: an ARV inferred from
                     the list price, cited to a line that does not say it */
                  { id:'lot',    value:287000, saw:'Estimated value $287,000' } ],
        notes: ['Sold as-is, seller has never occupied'] };
    } else {
      const r = await callTool(INTAKE.MODEL, INTAKE.SYSTEM, INTAKE.TOOL,
                               content, 4000);
      data = r.data; usage = r.usage;
    }
    const out = INTAKE.validate(data);
    charge(ent.uid, usage);

    const why = INTAKE.readable(out);
    if (why){ log('intake UNREADABLE', out.counts.read, out.counts.dropped); return fail(422, why, { counts: out.counts }); }

    log('intake ok', images.length + 'img', totalKb + 'kb', (Date.now()-t0) + 'ms',
        'read ' + out.counts.read, 'dropped ' + out.counts.dropped);
    const month = await countUse(ent.uid, 'aiintake', cap).catch(() => null);
    res.json({ ok:true, ...out, model: MOCK ? 'mock' : INTAKE.MODEL,
               ...(month ? { month: { used: month.used, cap: month.cap, left: month.remaining } } : {}),
               usage: { in: usage.input_tokens || 0, out: usage.output_tokens || 0 } });
  } catch(e){
    const code = e && e.niStatus ? e.niStatus : 502;
    log('intake upstream-fail', code, (e && e.niKind) || 'unknown');
    fail(code === 429 ? 429 : 502,
      code === 429 ? 'The intake is busy. Try again in a moment.'
                   : 'The intake could not be completed. Nothing was stored.');
  }
});

/* ══ THE OTHER SIDE OF THE TABLE ═══════════════════════════════════════════
   The only route that is allowed to reason from the investor's CEILING. The
   letter of intent may never print it — what they could have paid is theirs —
   and this panel exists on the other side of exactly that rule: it never
   leaves their screen, and the ceiling is the whole point of it. "Can you come
   up five?" has a true answer and this is where it gets computed. */
app.post('/api/objections', bodyGate, express.json({ limit: '32kb' }), async (req, res) => {
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
  { const wall = ipOk(req.ip || 'unknown', 'objections');
    if (wall) return fail(429, ipWall(wall, 'objection reads')); }

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

app.post('/api/list', bodyGate, express.json({ limit: '4kb' }), async (req, res) => {
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
/* ── WHERE A KEY REQUEST IS ALLOWED TO COME FROM ──────────────────────────
   Comma-separated origins in NI_ALLOW_ORIGIN. UNSET MEANS NO CHECK, on
   purpose: this file has to keep working on a laptop and inside a harness
   that serves from 127.0.0.1 on a random port, and a guard that cannot be
   turned off in development is a guard people delete in production. The
   deployment sets it; the default is the honest one for everywhere else. */
const ALLOW_ORIGIN = String(process.env.NI_ALLOW_ORIGIN || '')
  .split(',').map(x => x.trim().replace(/\/+$/, '')).filter(Boolean);

/* ══ COMPS, ON OUR KEY ═════════════════════════════════════════════════════
   The workbench has always been able to import candidate sales from RentCast,
   and until now it did it BRING-YOUR-OWN-KEY, in the browser. That was the
   right answer for one reason and the wrong answer for another.

   Right: RentCast's free tier is fifty requests a month. A shared key behind a
   public site would be spent in an afternoon, so the free desk cannot have one.
   That part was never wrong and the free desk still types its comps in.

   Wrong: plans.html sells "the comps arrive pulled and scored" under
   Underwriter, and they did not arrive — the customer still had to go and get
   a vendor account, generate a key, paste it into their own browser, and live
   inside somebody else's fifty-a-month. A pricing page that names something
   the product does not do is the one bug this codebase has build guards for,
   and it was on the page people pay from.

   And RentCast say, in their own documentation, that API keys "should never be
   exposed in any client-side, front-end or publicly-accessible code." Asking a
   paying customer to do the thing the vendor warns against is not a feature.

   So: paid gets it on our key, server-side, metered per account, exactly like
   every other paid feature, and BYOK is gone from the product entirely — a
   password box on a public page asking for a live vendor credential is the
   thing the vendor warns against, and offering it only to the free desk did
   not make it a better idea, only a quieter one. The key is an environment
   variable and it is never in this file, the repository, or any response.

   THEIR ESTIMATE IS STILL DISCARDED. The endpoint returns a value estimate
   alongside the comparables and we read only the comparables. The claim of the
   workbench is that you arrive at your own ARV from sales you scored yourself;
   printing somebody else's AVM at the top of it would make that sentence
   false, and the sentence is the product. */
const RENTCAST_KEY = process.env.RENTCAST_KEY || '';
/* what one request costs us, charged into the SAME daily budget the model
   calls spend from — one ceiling protects the whole bill rather than each
   vendor having a private allowance nobody is watching. Defaults to the
   free plan's overage rate, which is the most expensive tier: a budget that
   assumes the cheap plan under-counts exactly when it matters. */
const RENTCAST_USD = (() => { const v = Number(process.env.NI_RENTCAST_USD);
  return Number.isFinite(v) && v >= 0 ? v : 0.20; })();

/* ══ DELETING AN ACCOUNT, WHICH USED TO BE A LIE ═══════════════════════════
   The hub's "Delete everything" button called wipeAll(), which loops over a
   list of localStorage keys and removes them. That is the whole of what it
   did. The Supabase auth user, the profile row and every synced sheet stayed
   exactly where they were — and because the sync layer treats a remote sheet
   with no local twin as "a sheet from another device", signing back in put
   all of them back. The button emptied a browser and called it deletion.

   The privacy page promises deletion in three separate rows, with retention
   periods. So this was not a missing feature, it was a written promise the
   software broke, which is the one category of bug this product cannot have.

   It has to be here rather than in the browser: removing an auth user needs
   the service role key, and that key exists in exactly one process. The
   browser can only ask.

   ORDER MATTERS, AND IT IS SHEETS → USAGE → PROFILE → USER. Deleting the auth
   user first would revoke the token the other three deletes authenticate
   with, and leave the rows orphaned with nobody left who can name them. Each
   step is reported separately so a partial failure says which part survived
   rather than "something went wrong". */
app.post('/api/account/delete', bodyGate, express.json({ limit: '1kb' }), async (req, res) => {
  /* fail() is a per-route closure everywhere else in this file, and the first
     version of this route reached for it as if it were global — which is a
     ReferenceError inside the handler, i.e. a 500 with no body on the one
     route whose job is to be trustworthy. Its own harness caught it. */
  const fail = (code, why, extra) => { log('delete', code, why);
    res.status(code).json({ ok:false, error:why, ...extra }); };
  const ent = await entitlementOf(req, 0);     // an account, any plan, even none
  if (!ent.ok) return fail(401,
    ent.why === 'unconfigured' ? 'Accounts are not configured on this deployment.'
                               : 'Sign in first — this deletes the account making the request.');
  const uid = ent.uid;
  const SB = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const KEYSB = process.env.SUPABASE_SERVICE_KEY || '';
  const H = { apikey: KEYSB, authorization: 'Bearer ' + KEYSB, 'content-type': 'application/json' };
  const done = {};
  const drop = async (name, url, method = 'DELETE') => {
    try { const r = await fetch(url, { method, headers: { ...H, Prefer: 'return=minimal' } });
      done[name] = r.ok ? 'gone' : ('http ' + r.status); return r.ok; }
    catch (e) { done[name] = 'unreachable'; return false; }
  };
  /* ── THE SUBSCRIPTION GOES FIRST, AND IT CAN REFUSE THE DELETE ──────────
     There was no cancellation anywhere in this service, so this route wiped
     the profile and the login and left the card being charged — with the
     customer's way back in destroyed, so they could not reach the billing
     portal to stop it either. And the webhook half was worse: with the profile
     row gone, setPlan()'s PATCH matches zero rows, reconcile() throws, and
     /api/stripe answers 500 — which Stripe retries with backoff for three days
     PER EVENT and, if it keeps failing, DISABLES THE ENDPOINT. A disabled
     endpoint stops plan writes for every customer you have.
     So: cancel first, and if the cancel does not succeed, do not delete. An
     account removed while its card keeps billing is strictly worse than a
     refusal that says why. */
  const cx = await cancelAllFor(uid);
  if (!cx.ok) return fail(503,
    'Your subscription could not be cancelled just now, so nothing was deleted — '
    + 'removing the account while the card is still being charged would be worse. '
    + 'Try again in a minute, or email support@negotiationinc.com and it will be done by hand today.',
    { stage:'billing' });
  done.subscription = cx.none ? 'none' : ('cancelled ' + cx.cancelled);

  const q = encodeURIComponent(uid);
  await drop('sheets',  `${SB}/rest/v1/sheets?uid=eq.${q}`);
  await drop('usage',   `${SB}/rest/v1/usage?uid=eq.${q}`);
  await drop('profile', `${SB}/rest/v1/profiles?id=eq.${q}`);
  /* the auth user last, and through the admin API — the only call in this
     service that uses the service key as an ADMIN rather than as a bypass of
     row-level policy, which is why it is named and logged */
  const userGone = await drop('login', `${SB}/auth/v1/admin/users/${q}`);

  /* the subscription key reports 'none' or 'cancelled N', both of which are
     success — only the Supabase drops report 'gone' */
  const stubborn = Object.entries(done)
    .filter(([k, v]) => k !== 'subscription' && v !== 'gone').map(([k]) => k);
  console.log(new Date().toISOString() + ' account delete ' + uid.slice(0, 8) + ' · '
    + JSON.stringify(done));
  if (stubborn.length) return res.status(207).json({ ok:false, deleted:done,
    say: 'Some of it would not delete: ' + stubborn.join(', ')
       + '. Nothing has been half-removed on purpose — email support@negotiationinc.com '
       + 'and it will be finished by hand, today.' });
  res.json({ ok:true, deleted:done });
});

/* ══ WHAT IT RENTS FOR ═════════════════════════════════════════════════════
   The plans page had a row reading "Address-level values and rents ✓" on two
   paid tiers, and NEITHER HALF EXISTED. There is no code anywhere in this
   product that surfaces a rent estimate or a value estimate — the one RentCast
   call it makes reads `comparables` and discards everything else on the reply,
   deliberately and by name.

   Only one of those halves should be built, and it is the rent.

   THE VALUE IS NOT COMING BACK. "No automated valuation model was used" is
   printed on the lender packet, and an address-level value estimate is exactly
   an automated valuation model. Shipping one would make the sentence on the
   most important document this product produces untrue, in exchange for a
   number the whole design exists to refuse. The row comes off the page.

   THE RENT IS A DIFFERENT CLAIM. The desk already asks for monthly rent as an
   input, and already fills it with a rule of thumb — 0.65% of ARV — marked as
   an ESTIMATE that widens every band it touches. An address-level figure from
   actual nearby rentals is strictly better than that rule, it is the same KIND
   of object, and the sheet's grammar already knows what to do with it.

   So it lands as an ESTIMATE with its provenance attached, never as ENTERED,
   and it rides the SAME monthly allowance as the comp pull: both are one
   RentCast request on our key, and inventing a second number would be
   advertising an allowance that does not exist. */
app.post('/api/lookup/rent', bodyGate, express.json({ limit: '4kb' }), async (req, res) => {
  const fail = (code, why, extra) => { log('rent', code, why); res.status(code).json({ ok:false, error:why, ...extra }); };
  if (!RENTCAST_KEY) return fail(503, 'The rent lookup is not switched on for this deployment.');
  { const g = gateFails(req, 'rent lookup'); if (g) return fail(g[0], g[1]); }

  const ent = await entitlementOf(req, 2);
  if (!ent.ok){
    const SAY = {
      unconfigured: 'The rent lookup is not switched on for this deployment.',
      nosession:    'The rent lookup needs an account. Nothing was sent.',
      noprofile:    'The rent lookup needs an account. Nothing was sent.',
      lookup:       'The account could not be checked just now. Nothing was sent.',
      free:         'The rent lookup arrives with Underwriter, and with the fourteen-day trial. On the free desk, type the rent in.',
      lowtier:      'The rent lookup arrives with Underwriter. On this plan, type the rent in.',
    };
    const code = (ent.why === 'unconfigured' || ent.why === 'lookup') ? 503 : 403;
    return fail(code, SAY[ent.why] || SAY.nosession, { entitlement: ent.why });
  }

  /* the SAME meter as the comp pull, on purpose — see the note above */
  const meter = await meterFails(res, ent, 'aicomps', 'of these');
  if (meter.fail) return fail(meter.fail[0], meter.fail[1], meter.fail[2]);
  { const b = budgetFails(ent.uid, 'The rent lookup'); if (b) return fail(b[0], b[1], b[2]); }
  { const wall = ipOk(req.ip || 'unknown', 'lookup');
    if (wall) return fail(429, ipWall(wall, 'property lookups')); }

  const addr = String((req.body && req.body.address) || '').trim().slice(0, 160);
  if (addr.length < 6) return fail(400, 'That is not enough address to look up. Street, city and ZIP work best.');

  let j = null, status = 200;
  if (MOCK){
    j = { rent: 1875, rentRangeLow: 1700, rentRangeHigh: 2050,
          comparables: [{ formattedAddress:'9 Mock Row', price:1850 },
                        { formattedAddress:'11 Mock Row', price:1900 }] };
  } else
  try {
    const u = new URL('https://api.rentcast.io/v1/avm/rent/long-term');
    u.searchParams.set('address', addr);
    u.searchParams.set('compCount', '8');
    const r = await fetch(u, { headers: { 'X-Api-Key': RENTCAST_KEY, accept:'application/json' },
                               signal: AbortSignal.timeout(15000) });
    status = r.status;
    if (r.ok) j = await r.json();
  } catch(e){
    return fail(502, 'The rent source did not answer. Nothing was spent from your allowance.');
  }
  if (status === 404){ charge(ent.uid, {}, RENTCAST_USD);
    return fail(404, 'There is no rental record near that address. Type the rent instead — three real listings beat any estimate.'); }
  if (status === 429) return fail(429, 'The rent source is rate-limiting us this minute. Try again shortly.');
  if (status === 401 || status === 403)
    return fail(503, 'The rent lookup is not switched on for this deployment.');
  if (!j){ charge(ent.uid, {}, RENTCAST_USD);
    return fail(502, 'The rent source returned ' + status + '.'); }

  const num = v => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.round(x) : null; };
  const rent = num(j.rent), lo = num(j.rentRangeLow), hi = num(j.rentRangeHigh);
  charge(ent.uid, {}, RENTCAST_USD);
  if (rent === null) return fail(404, 'No rent came back for that address. Type it instead.');

  const n = Array.isArray(j.comparables) ? j.comparables.length : 0;
  /* the cap, which was missing. ni_use takes three arguments and JSON.stringify
     drops an undefined one, so this call has been resolving to nothing and the
     RentCast meter has never once incremented — see the note in countUse. */
  const month = await countUse(ent.uid, 'aicomps', meter.cap);
  res.json({ ok:true, rent, lo, hi, comps: n,
    ...(month ? { month: { used: month.used, cap: month.cap, left: month.remaining } } : {}),
    /* the sentence the sheet will print beside the figure. It says where the
       number came from and how wide it is, because a rent estimate with no
       range is a rent estimate pretending to be a fact. */
    prov: 'the rent for this address, from ' + (n ? n + ' nearby rental' + (n === 1 ? '' : 's') : 'nearby rentals')
        + (lo && hi ? ' · they range ' + lo.toLocaleString('en-US') + '–' + hi.toLocaleString('en-US') : '')
        + ' · check three real listings before you lean on it' });
});

app.post('/api/comps', bodyGate, express.json({ limit: '4kb' }), async (req, res) => {
  const fail = (code, why, extra) => { log('comps', code, why); res.status(code).json({ ok:false, error:why, ...extra }); };
  if (!RENTCAST_KEY) return fail(503, 'Pulling comps is not switched on for this deployment.');
  { const g = gateFails(req, 'comp pull'); if (g) return fail(g[0], g[1]); }

  const ent = await entitlementOf(req, 2);
  if (!ent.ok){
    const SAY = {
      unconfigured: 'Pulling comps is not switched on for this deployment.',
      nosession:    'Pulling comps needs an account. Nothing was sent.',
      noprofile:    'Pulling comps needs an account. Nothing was sent.',
      lookup:       'The account could not be checked just now. Nothing was sent.',
      free:         'Comps arrive pulled with Underwriter, and with the fourteen-day trial. On the free desk, add them by hand — a row you type is scored the same way.',
      lowtier:      'Comps arrive pulled with Underwriter. On this plan, add them by hand — a row you type is scored the same way.',
    };
    const code = (ent.why === 'unconfigured' || ent.why === 'lookup') ? 503 : 403;
    return fail(code, SAY[ent.why] || SAY.nosession, { entitlement: ent.why });
  }

  const meter = await meterFails(res, ent, 'aicomps', 'of these');
  if (meter.fail) return fail(meter.fail[0], meter.fail[1], meter.fail[2]);

  { const b = budgetFails(ent.uid, 'The comp pull'); if (b) return fail(b[0], b[1], b[2]); }
  { const wall = ipOk(req.ip || 'unknown', 'lookup');
    if (wall) return fail(429, ipWall(wall, 'property lookups')); }

  const addr = String((req.body && req.body.address) || '').trim().slice(0, 160);
  if (addr.length < 6) return fail(400, 'That is not enough address to look up. Street, city and ZIP work best.');

  let j = null, status = 200;
  if (MOCK){
    /* the same shape RentCast returns, INCLUDING the value estimate — so the
       test can prove the estimate is discarded rather than merely absent */
    j = { price: 402000, priceRangeLow: 380000, priceRangeHigh: 424000,
      comparables: [
        { formattedAddress:'11 Mock Row', price:296000, squareFootage:1480, bedrooms:3, bathrooms:2,
          lastSeenDate:new Date(Date.now() - 60*864e5).toISOString(), distance:0.31 },
        { formattedAddress:'14 Mock Row', price:312000, squareFootage:1595, bedrooms:3, bathrooms:2,
          lastSeenDate:new Date(Date.now() - 120*864e5).toISOString(), distance:0.72 },
        { formattedAddress:'2 No Price Lane', price:0, squareFootage:1500, bedrooms:3, bathrooms:2,
          lastSeenDate:new Date().toISOString(), distance:0.4 },
      ] };
  } else
  try {
    const u = new URL('https://api.rentcast.io/v1/avm/value');
    u.searchParams.set('address', addr);
    u.searchParams.set('compCount', '10');
    const r = await fetch(u, { headers: { 'X-Api-Key': RENTCAST_KEY, accept:'application/json' },
                               signal: AbortSignal.timeout(15000) });
    status = r.status;
    if (r.ok) j = await r.json();
  } catch(e){
    return fail(502, 'The comp source did not answer. Nothing was spent from your allowance.');
  }
  /* the money is charged only for a request that actually reached them, and
     the meter is only counted for one that came back with sales */
  if (status === 404) { charge(ent.uid, {}, RENTCAST_USD);
    return fail(404, 'There is no record at that address. Try the full street address with the ZIP.'); }
  if (status === 429) return fail(429, 'The comp source is rate-limiting us this minute. Try again shortly.');
  if (status === 401 || status === 403)
    return fail(503, 'Pulling comps is not switched on for this deployment.');
  if (!j) { charge(ent.uid, {}, RENTCAST_USD);
    return fail(502, 'The comp source returned ' + status + '.'); }

  const raw = Array.isArray(j.comparables) ? j.comparables : [];   // and NOTHING else off this reply
  charge(ent.uid, {}, RENTCAST_USD);
  if (!raw.length) return fail(404, 'No comparable sales came back near that address.');

  const monthsSince = d => { const t = Date.parse(d); if (!Number.isFinite(t)) return '';
    return String(Math.max(0, Math.round((Date.now() - t) / 2629800000))); };
  const rows = raw.slice(0, 12).map((c, i) => ({
    id: 'rc' + i + Math.random().toString(36).slice(2, 6),
    addr: String(c.formattedAddress || c.addressLine1 || 'Comparable ' + (i + 1)).slice(0, 90),
    price: c.price ? String(Math.round(c.price)) : '',
    sqft:  c.squareFootage ? String(Math.round(c.squareFootage)) : '',
    beds:  c.bedrooms  != null ? String(c.bedrooms)  : '',
    baths: c.bathrooms != null ? String(c.bathrooms) : '',
    sold:  monthsSince(c.lastSeenDate || c.listedDate || c.removedDate),
    dist:  c.distance != null ? (Math.round(c.distance * 100) / 100).toFixed(2) : '',
    cond: 0, use: true, src: 'rentcast',
  })).filter(c => c.price && c.sqft);
  if (!rows.length) return fail(404, 'The sales that came back had no price or floor area on them.');

  await countUse(ent.uid, 'aicomps', meter.cap);
  const used = await usedThisMonth(ent.uid, 'aicomps');
  /* ── AND EXACTLY ONE HAND PUTS THE HOLD DOWN ──────────────────────────────
     countUse() retires the hold itself once the database holds the count. This
     line dropped a SECOND one — and holds are a fungible count, so the extra
     drop ate another in-flight request's slot and reopened the very race the
     hold exists to close. It was invisible only because the call above was
     failing: with no cap passed it returned before ever reaching meterDrop, so
     this line was doing the one drop. Fixing that made this line a bug in the
     same instant. The close hook in meterFails covers every non-200 path. */
  res.json({ ok:true, rows, month: { used: used === NOMETER ? null : used, cap: meter.cap,
    left: (used === NOMETER || meter.cap <= 0) ? null : Math.max(0, meter.cap - used) } });
});

const TILES_KEY = process.env.GOOGLE_TILES_KEY || '';
const TILES_CAP  = N('NI_TILES_DAY_CAP', 150);   // the soft budget: sharing starts here
/* the ceiling nobody gets past. Twice the budget, so a fair share has somewhere
   to be fair IN — a share enforced at the ceiling is just a race with extra
   arithmetic. */
const TILES_HARD = N('NI_TILES_DAY_HARD', 0) || TILES_CAP * 2;
let tiles = { day: new Date().toISOString().slice(0, 10), n: 0, by: new Map() };
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
app.get('/api/land/config', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  if (tiles.day !== today) tiles = { day: today, n: 0, by: new Map() };
  if (!tiles.by) tiles.by = new Map();
  if (!TILES_KEY) return res.json({ ok:false, why:'unconfigured' });

  /* ── THE GROUND IS WORTH AN ACCOUNT NOW, AND IT WAS NOT BEFORE ──────────
     This endpoint hands a Google Maps key to whoever asks, and every yes is
     about six dollars a thousand on somebody's card. It was open because the
     3D ground was the only thing making this room feel real: the sketch was
     wallpaper, so the imagery was carrying the demo.

     That changed. The sketch is a SCALE DRAWING now — it answers every figure
     on the sheet, refuses when it has no acreage to scale from, and draws the
     play at its true size. It is the better demo, and it costs nothing. So the
     photorealistic ground can sit behind the one rung that has always been
     free and has always been worth asking for.

     AN ACCOUNT, NOT A PLAN. need=0 means any real profile passes — this is a
     cost control and a reason to sign up, not a paid feature, and pricing it
     as one would be a lie about what the plans buy.

     It fails CLOSED, unlike the comp allowance, and the difference is who
     pays for being wrong: a meter that cannot be read costs somebody three
     comps, and a key handed to a stranger costs money on every request until
     somebody notices. */
  const ent = await entitlementOf(req, 0);
  if (!ent.ok){
    log('land config refused', ent.why);
    return res.status(403).json({ ok:false, why:'account',
      error:'The photorealistic ground comes with an account — free, no card. '
          + 'The drawing prices without it, and is drawn to scale either way.' });
  }

  /* ── AND ONLY FROM THIS SITE ──────────────────────────────────────────
     A referrer restriction in the Google console stops the key being USED
     elsewhere; it does nothing about the harvesting, and a script with a
     stolen session should not be able to collect it from a terminal either.
     Absent Origin AND Referer is a non-browser caller. */
  const from = String(req.get('origin') || req.get('referer') || '');
  if (ALLOW_ORIGIN.length && !ALLOW_ORIGIN.some(o => from.startsWith(o))){
    log('land config refused origin', from.slice(0, 60) || '(none)');
    return res.status(403).json({ ok:false, why:'origin',
      error:'That request did not come from this site.' });
  }

  /* checked BEFORE the counter moves, so a blocked caller cannot spend the
     allowance it is being refused */
  if (!tileOk(req.ip || 'unknown')){
    log('land config 429 per-ip');
    return res.status(429).json({ ok:false, why:'rate',
      error:'That is a lot of map in one hour from one place. The flat drawing still works.' });
  }
  /* ── FAIR SHARE, THE SAME SHAPE THE AI BUDGET USES ─────────────────────
     One global counter means the first person through the door can flatten
     the map for everybody else for the rest of the day — which is not a
     budget, it is a race. Under the cap nobody is refused; over it, only the
     accounts above their share of it are. */
  /* ── A SOFT BUDGET WITH A HARD CEILING ABOVE IT ────────────────────────
     The first version put the fair share UNDER a single cap, and the test
     showed what that actually does: the greedy account takes the cap, and the
     second account through the door is refused because of it — which is the
     exact race the share was added to prevent. A share needs room to work in.
     So TILES_CAP is the soft budget where sharing STARTS, and the ceiling
     above it is what nobody gets past. Same shape as the AI day budget, and
     for the same reason. */
  if (tiles.n >= TILES_HARD){
    log('land config 429 ceiling', tiles.n);
    return res.status(429).json({ ok:false, why:'quota' });
  }
  const heads = Math.max(1, tiles.by.size);
  const mine = tiles.by.get(ent.uid) || 0;
  if (tiles.n >= TILES_CAP && mine >= TILES_CAP / heads){
    log('land config 429 share', mine + '/' + Math.round(TILES_CAP / heads));
    return res.status(429).json({ ok:false, why:'share',
      error:'That is this account\u2019s share of today\u2019s 3D ground. It resets at midnight UTC, '
          + 'and the drawing prices without it.' });
  }
  tiles.n++; tiles.by.set(ent.uid, mine + 1);
  log('land config ok', tiles.n + '/' + TILES_CAP);
  res.json({ ok:true, key: TILES_KEY });
});
/* ══ WALK THE STREET ═══════════════════════════════════════════════════════
   Elijah: "being able to check it at the end so you can go back and walk
   through the neighborhood and get a better feel for the property and/or the
   comps."

   THE ONE QUESTION THE SHEET CANNOT ANSWER. Every figure on the desk is a
   figure — asking price, repairs, the band, the exit that clears. None of them
   tell you that the house two doors down has a boat on the lawn, that the
   block turns from kept to tired halfway along, or that the "comparable" three
   streets over faces a six-lane road. That is a judgement people currently
   make by leaving the product, opening a map, and coming back — which is the
   forty minutes of tabs this whole desk exists to delete.

   IT COSTS NOTHING PER VIEW, AND THAT CHANGES WHAT THE GATE MEANS. The Maps
   Embed API is documented as free with unlimited requests, Street View mode
   included — unlike the photorealistic 3D ground next door, which is billed
   per session and is why THAT endpoint carries a daily cap, a fair-share
   split and a hard ceiling. None of that machinery belongs here and copying it
   would be cargo cult: a meter that measures nothing still refuses people.

   So this is gated because it is a paid feature, and for no other reason. That
   is worth being straight about in the code, because "it costs us money" is
   the comfortable justification and it is not the true one here. What the gate
   buys is a reason to pay; what the reader loses by not paying is an addition,
   never a figure they worked out. The free desk still prices the house.

   WHAT IS AND IS NOT HANDED OUT. The same browser key the ground uses, behind
   the same origin check — a referrer restriction in the Google console stops
   the key being USED elsewhere and does nothing about it being harvested from
   a terminal, so absent Origin AND Referer is a non-browser caller and gets
   nothing. The address is never logged, same rule as the geocoder below and
   the waitlist. */
app.get('/api/walk/config', async (req, res) => {
  if (!TILES_KEY) return res.json({ ok:false, why:'unconfigured' });

  /* A PLAN, NOT AN ACCOUNT — and that is the one line of difference from the
     ground below it. The ground is a cost control priced at "sign up"; this is
     something the plans page sells, so it has to be entitled at the tier the
     plans page names or the pricing table is lying. */
  const ent = await entitlementOf(req, 2);
  if (!ent.ok){
    log('walk config refused', ent.why);
    return res.status(403).json({ ok:false, why: ent.why || 'plan',
      error:'Walking the street comes with Underwriter, and with the fourteen-day trial.' });
  }

  const from = String(req.get('origin') || req.get('referer') || '');
  if (ALLOW_ORIGIN.length && !ALLOW_ORIGIN.some(o => from.startsWith(o))){
    log('walk config refused origin', from.slice(0, 60) || '(none)');
    return res.status(403).json({ ok:false, why:'origin',
      error:'That request did not come from this site.' });
  }
  /* the per-IP limit stays even though the requests are free: this hands out a
     key, and a key handed out ten thousand times in an hour is a harvesting
     run whatever Google charges for the embed */
  if (!tileOk(req.ip || 'unknown')){
    log('walk config 429 per-ip');
    return res.status(429).json({ ok:false, why:'rate',
      error:'That is a lot of requests in one hour from one place. Try again shortly.' });
  }
  log('walk config ok');
  res.json({ ok:true, key: TILES_KEY });
});

app.get('/api/land/geo', async (req, res) => {
  { const wall = ipOk(req.ip || 'unknown', 'geo');
    if (wall) return res.status(429).json({ ok:false, error: ipWall(wall, 'address lookups') }); }
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
/* ── WHICH BUILD IS ACTUALLY RUNNING ───────────────────────────────────────
   publish.mjs signs its output and drops build.json beside the pages. Three
   batches in a row were built, tested, packaged and never pushed, and there
   was no way to tell from outside: the site looked like a site and this
   endpoint said "on" to everything it knew about.

   Read once at boot, deliberately. The file cannot change under a running
   process — a deploy is a new process — so re-reading it per request would be
   a filesystem hit on the one endpoint that must never be slow, in exchange
   for information that cannot have changed. */
const BUILD = (() => {
  for (const p of ['build.json', path.join(__dirname, 'build.json'),
                   path.join(__dirname, '..', 'build.json')]){
    try { const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j && j.id) return { id:String(j.id).slice(0,32), at:String(j.at||'').slice(0,32),
                              stage:String(j.stage||'').slice(0,12) }; } catch(e){}
  }
  /* unstamped is a FACT, not an error: an older deploy predates the stamp, and
     saying so is more useful than an empty object that reads like a bug here */
  return { id:'unstamped', at:'', stage:'' };
})();

/* ══ THE OPS PAGE ══════════════════════════════════════════════════════════
   Everything on this page already existed. The meters, the day budget, the
   billing state, the build stamp, the error ring — every number was being kept
   and none of it was ever shown anywhere, so "how is the business doing" and
   "is anything broken" were both answered by reading source code.

   ONE TOKEN, AND IT FAILS CLOSED. Unset means the route does not exist, so a
   deploy that forgets it exposes nothing rather than everything. The token is
   compared in constant time, because a naive === on a secret leaks its prefix
   to anybody willing to time a few thousand requests.

   AND IT NAMES NOBODY. Counts, sums, tiers and rates — never an email, never
   a uid, never a sheet. An ops page is a page you will open on a phone on a
   train, and one that lists your customers is one screenshot from being a
   breach. Everything here would be fine on a slide. */
const OPS_TOKEN = process.env.NI_OPS_TOKEN || '';
const opsOk = (given) => {
  if (!OPS_TOKEN || !given) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(OPS_TOKEN);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch(e){ return false; }
};
/* ── AND THE TOKEN STOPS RIDING IN THE URL ─────────────────────────────────
   ?k=… is the only way to open the page the first time, and it is a bad place
   for a secret to live afterwards: query strings land in browser history, in
   proxy logs, in a Referer header, and in the screenshot somebody takes of the
   dashboard. So the first valid load sets it as a cookie and every later
   request — including the control forms — carries it there instead.

   HttpOnly so no script on the page can read it, SameSite=Strict so it is not
   sent from anywhere else at all, Secure in production. The cookie IS the
   token rather than a session derived from it: a second secret would need
   storage, expiry and rotation to protect something that already has all
   three, badly, in an environment variable. */
const opsFrom = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  || (req.query && req.query.k)
  || (String(req.headers.cookie || '').match(/(?:^|;\s*)ni_ops=([^;]+)/) || [])[1]
  || (req.body && req.body.k);
const opsRemember = (req, res) => {
  if (String(req.headers.cookie || '').includes('ni_ops=')) return;
  const secure = (req.get('x-forwarded-proto') || req.protocol) === 'https';
  res.cookie ? res.cookie('ni_ops', OPS_TOKEN, { httpOnly:true, sameSite:'strict', secure, maxAge: 12*3600*1000 })
             : res.setHeader('set-cookie', 'ni_ops=' + OPS_TOKEN
                 + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200' + (secure ? '; Secure' : ''));
};

async function opsData(){
  rollDay();
  const bill = billingState();
  const caps = {};
  for (const f of FEATURES) caps[f] = capFor(f, 3);
  /* the account layer answers "how many people are there" better than we can:
     it is the only place that knows. HEAD with a count header is one row of
     traffic rather than a table download. */
  const countOf = async (table, q) => {
    const SB = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const K = process.env.SUPABASE_SERVICE_KEY || '';
    if (!SB || !K) return null;
    try {
      const r = await fetch(`${SB}/rest/v1/${table}?select=id${q ? '&' + q : ''}`,
        { method:'HEAD', headers:{ apikey:K, authorization:'Bearer ' + K, Prefer:'count=exact' } });
      const cr = r.headers.get('content-range') || '';
      const n = Number(String(cr).split('/')[1]);
      return Number.isFinite(n) ? n : null;
    } catch(e){ return null; }
  };
  const since = d => new Date(Date.now() - d * 86400000).toISOString();
  /* ── THE ONLY FUNNEL THERE IS RIGHT NOW ──────────────────────────────────
     Before launch nothing can be bought, so the waitlist IS the funnel — and
     this page showed accounts, plans, spend, errors and founding places while
     saying nothing at all about the one number that moves. Finding out how
     many addresses came in meant opening Supabase.

     The breakdown by source is what makes it actionable. Every capture already
     records which surface it came from, and a link can carry a campaign tag,
     so "the Reddit post brought eleven and the plans page brought two" is a
     question this can answer WITHOUT a single byte of telemetry: nothing is
     recorded unless somebody chose to type their address into a form. The
     privacy page promises there is no anonymous tracking hiding behind its
     sentences, and that promise is worth more than an analytics dashboard. */
  const listCount = q => countOf('waitlist', q);
  const listSources = async () => {
    const SB = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const K = process.env.SUPABASE_SERVICE_KEY || '';
    if (!SB || !K) return null;
    try {
      const r = await fetch(`${SB}/rest/v1/waitlist?select=source&order=created_at.desc&limit=500`,
        { headers:{ apikey:K, authorization:'Bearer ' + K } });
      if (!r.ok) return null;
      const rows = await r.json();
      const by = new Map();
      for (const row of rows) by.set(row.source || 'unknown', (by.get(row.source || 'unknown') || 0) + 1);
      return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, v]) => ({ source: k, n: v }));
    } catch(e){ return null; }
  };
  const [people, wk, day1, solo, uw, off, trialing,
         listAll, listDay, listWk, listBy] = await Promise.all([
    countOf('profiles'),
    countOf('profiles', 'created_at=gte.' + since(7)),
    countOf('profiles', 'created_at=gte.' + since(1)),
    countOf('profiles', 'plan=eq.solo'),
    countOf('profiles', 'plan=eq.underwriter'),
    countOf('profiles', 'plan=in.(the office,office)'),
    countOf('profiles', 'trial=not.is.null&plan=is.null'),
    listCount(),
    listCount('created_at=gte.' + since(1)),
    listCount('created_at=gte.' + since(7)),
    listSources(),
  ]);
  /* MRR from the prices actually charged, not from the plans page — the page
     is marketing and this is the books. Unknown price means unknown MRR, said
     as null rather than guessed as zero. */
  const PRICE = { solo: 39, underwriter: 129, office: 249 };
  const mrr = (solo === null || uw === null || off === null) ? null
            : solo * PRICE.solo + uw * PRICE.underwriter + off * PRICE.office;
  return {
    build: BUILD,
    at: new Date().toISOString(),
    uptimeH: +(process.uptime() / 3600).toFixed(1),
    people: { total: people, newToday: day1, newThisWeek: wk, trialing },
    plans: { solo, underwriter: uw, office: off, mrr },
    list: { on: LIST_ON, total: listAll, today: listDay, week: listWk, by: listBy },
    billing: bill,
    today: { calls: day.n, usd: +day.usd.toFixed(3), accounts: day.by.size,
             budgetUsd: LIM.dailyUsd, ceilingUsd: hardUsd(),
             budgetCalls: LIM.perDay, ceilingCalls: hardN(),
             pctOfBudget: LIM.dailyUsd ? Math.round(day.usd / LIM.dailyUsd * 100) : null },
    features: {
      read:    (KEY || MOCK) ? 'on' : 'off',
      comps:   RENTCAST_KEY ? 'on' : 'off',
      land:    TILES_KEY ? (tiles.n >= TILES_CAP ? 'quota' : 'on') : 'flat',
      walk:    TILES_KEY ? 'on' : 'off',
      census:  process.env.CENSUS_KEY ? 'on' : 'partial',
      accounts: ACCOUNTS_ON() ? 'on' : 'off',
    },
    capsAtTopTier: caps,
    founding: await foundingState(),
    control: { paused: opsPaused(),
               pausedFor: opsPaused() ? Math.round((OPS.pausedUntil - Date.now()) / 60000) : 0,
               pauseWhy: OPS.pauseWhy || '',
               budgetUsd: opsBudget() ?? LIM.dailyUsd,
               budgetIsOverride: opsBudget() !== null },
    errors: { lastHour: errRecent(), sinceBoot: errCount(), list: errList() },
  };
}

/* ── THE CONTROLS ──────────────────────────────────────────────────────────
   Elijah: "in my developer dashboard I should be able to have a high degree of
   control over the service."

   The honest version of that is narrow, and the narrowness is the design. Two
   levers, both reversible, both taking effect on the next request:

     · PAUSE THE SPEND. Every metered feature stops and says the true thing.
       This is the control you want at 2am when a bill is running away, and
       nothing else does that job — the daily budget is a ceiling, not a
       switch, and Render's environment variables need a redeploy.
     · CHANGE TODAY'S BUDGET, without a deploy. Same reason.

   WHAT IS DELIBERATELY NOT HERE: nothing that grants a plan, refunds a
   payment, edits a sheet or reads a customer's work. A dashboard that can hand
   out an Underwriter subscription is a dashboard whose token is worth stealing
   and whose actions have to be audited; every one of those jobs already has a
   place it belongs — Stripe for money, Supabase for accounts — and doing them
   here would mean two systems that can disagree about the same fact.

   Both levers live in memory and die with the process, ON PURPOSE. A pause
   that survives a restart is a pause somebody sets at 2am and rediscovers on
   Thursday when a customer writes in. A deploy is the natural end of an
   emergency, and this is an emergency control. */
/* urlencoded as well as JSON: the buttons on the page are plain <form> posts,
   because a control panel that needs JavaScript to work is a control panel
   that does not work on the morning you most need it */
app.post('/api/ops/control', express.urlencoded({ extended:false, limit:'2kb' }),
                             express.json({ limit:'2kb' }), (req, res) => {
  const given = opsFrom(req);
  if (!opsOk(given)) return res.status(404).json({ ok:false, error:'No such endpoint.' });
  const b = req.body || {};
  const act = String(b.action || '');
  if (act === 'pause'){
    const mins = Math.max(1, Math.min(720, Number(b.minutes) || 60));
    OPS.pausedUntil = Date.now() + mins * 60000;
    OPS.pauseWhy = String(b.why || '').slice(0, 120);
    log('OPS pause', mins + 'm', OPS.pauseWhy);
  } else if (act === 'resume'){
    OPS.pausedUntil = 0; OPS.pauseWhy = '';
    log('OPS resume');
  } else if (act === 'budget'){
    const v = Number(b.usd);
    OPS.budgetOverride = (Number.isFinite(v) && v >= 0 && v <= 5000) ? v : null;
    log('OPS budget', OPS.budgetOverride);
  } else return res.status(400).json({ ok:false, error:'Unknown action.' });
  /* a browser that posted a form gets sent back to the page it pressed on;
     a script gets JSON. Same route, same rules, two callers. */
  if (/text\/html/.test(String(req.headers.accept || '')))
    return res.redirect(303, '/ops');
  res.json({ ok:true, paused: opsPaused(),
             pausedFor: opsPaused() ? Math.round((OPS.pausedUntil - Date.now()) / 60000) : 0,
             budgetUsd: opsBudget() ?? LIM.dailyUsd });
});

app.get('/api/ops', async (req, res) => {
  const given = opsFrom(req);
  /* 404, not 403: an endpoint that says "wrong token" has confirmed it exists */
  if (!opsOk(given)) return res.status(404).json({ ok:false, error:'No such endpoint.' });
  res.set('cache-control', 'no-store');
  res.json(await opsData());
});

/* the same numbers, drawn. No build step, no framework, no external anything —
   a page that needs a bundler is a page that stops working on the day you most
   need to look at it. */
app.get('/ops', async (req, res) => {
  const given = opsFrom(req);
  if (!opsOk(given)) return res.status(404).type('txt').send('Not found');
  opsRemember(req, res);
  const d = await opsData();
  const esc = t => String(t === null || t === undefined ? '' : t)
    .replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const n = v => v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US');
  const usd = v => v === null || v === undefined ? '—' : '$' + Number(v).toLocaleString('en-US');
  const card = (label, value, note, tone) =>
    `<div class="c ${tone || ''}"><div class="l">${esc(label)}</div>`
    + `<div class="v">${esc(value)}</div>${note ? `<div class="n">${esc(note)}</div>` : ''}</div>`;
  /* the two states that look identical from outside and are not: a live site
     on a test key takes no money, and a stamped build that is not the one you
     pushed means the deploy did not happen */
  const modeTone = d.billing.mode === 'live' ? 'good' : d.billing.mode === 'test' ? 'bad' : 'warn';
  const errTone  = d.errors.lastHour > 0 ? 'bad' : 'good';
  const budgTone = d.today.pctOfBudget === null ? '' : d.today.pctOfBudget >= 100 ? 'bad'
                 : d.today.pctOfBudget >= 60 ? 'warn' : 'good';
  res.set('cache-control', 'no-store').type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>ops · negotiation inc</title>
<style>
:root{--ink:#0d1420;--mid:#3f4759;--soft:#6b7488;--line:#dfe4ec;--wash:#f6f8fb;
 --good:#12633e;--goodbg:#eaf6f0;--warn:#8a6206;--warnbg:#fdf6e6;--bad:#a32a20;--badbg:#fdefed}
*{box-sizing:border-box}
body{margin:0;background:#eef1f6;color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.w{max-width:960px;margin:0 auto;padding:22px 16px 60px}
h1{font-family:Georgia,serif;font-size:24px;margin:0}
.sub{color:var(--soft);font-size:12.5px;margin-top:4px}
h2{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:var(--soft);margin:26px 0 8px;font-weight:800}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:9px}
.c{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.c .l{font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--soft);font-weight:700}
.c .v{font-family:Georgia,serif;font-size:25px;font-weight:700;line-height:1.1;margin-top:5px;word-break:break-word}
.c .n{font-size:12px;color:var(--soft);margin-top:3px}
.c.good{background:var(--goodbg);border-color:#bfe0cd} .c.good .v{color:var(--good)}
.c.warn{background:var(--warnbg);border-color:#e8d5a3} .c.warn .v{color:var(--warn)}
.c.bad{background:var(--badbg);border-color:#f0c9c4} .c.bad .v{color:var(--bad)}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}
th{text-align:left;font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:var(--soft);padding:9px 12px;border-bottom:1px solid var(--line)}
td{padding:9px 12px;border-bottom:1px solid var(--wash);font-size:13.5px;vertical-align:top}
tr:last-child td{border-bottom:0}
td.r,th.r{text-align:right;white-space:nowrap}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.none{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px;color:var(--soft);font-size:13.5px}
.ctl{background:#fff;border:1px solid var(--line);border-radius:12px;padding:13px 15px;display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center}
.ctl .cf{display:flex;gap:8px;align-items:center;margin:0}
.ctl label{font-size:12.5px;color:var(--soft)}
.ctl input{font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;width:70px}
.ctl button{font:inherit;font-size:13px;font-weight:650;padding:8px 13px;border-radius:9px;cursor:pointer;
 border:1px solid var(--line);background:var(--wash);color:var(--ink);min-height:38px}
.ctl button:hover{border-color:var(--soft)}
.ctl button.stop{background:var(--badbg);border-color:#f0c9c4;color:var(--bad)}
.ctl button.go{background:var(--goodbg);border-color:#bfe0cd;color:var(--good)}
.ctl p{flex:1 1 100%;margin:2px 0 0;font-size:12px;color:var(--soft);line-height:1.5}
@media(max-width:560px){.w{padding:16px 12px 50px}.c .v{font-size:21px}}
</style></head><body><div class="w">
<h1>Ops</h1>
<div class="sub">${esc(d.at)} · up ${esc(d.uptimeH)}h · build <span class="mono">${esc(d.build.id)}</span> · ${esc(d.build.stage || 'unstamped')}</div>

<h2>Money</h2>
<div class="g">
 ${card('MRR', usd(d.plans.mrr), 'from live plan counts')}
 ${card('Paying', n((d.plans.solo || 0) + (d.plans.underwriter || 0) + (d.plans.office || 0)),
        `${n(d.plans.solo)} solo · ${n(d.plans.underwriter)} uw · ${n(d.plans.office)} office`)}
 ${card('In trial', n(d.people.trialing), 'no plan yet')}
 ${card('Stripe', d.billing.mode, d.billing.mode === 'test' ? 'NOBODY CAN PAY YOU' : d.billing.pay === 'on' ? 'checkout on' : 'checkout off', modeTone)}
</div>

<h2>People</h2>
<div class="g">
 ${card('Accounts', n(d.people.total))}
 ${card('New today', n(d.people.newToday))}
 ${card('New this week', n(d.people.newThisWeek))}
 ${card('Webhook', d.billing.hook, d.billing.hook === 'on' ? 'signing secret set' : 'plans will not update', d.billing.hook === 'on' ? 'good' : 'bad')}
</div>

<h2>The list</h2>
<div class="g">
 ${d.list.on
   ? card('Addresses', n(d.list.total), `${n(d.list.today)} today · ${n(d.list.week)} this week`,
          (d.list.today || 0) > 0 ? 'good' : '')
   : card('The list', 'off', 'no Supabase — nothing can be captured', 'bad')}
 ${card('Where they came from',
        (d.list.by && d.list.by.length) ? d.list.by[0].source : '—',
        (d.list.by && d.list.by.length)
          ? d.list.by.map(x => x.source + ' ' + x.n).join(' · ')
          : 'nobody yet')}
</div>
<div class="ctl"><p>Every capture records the surface it came from, and a link
 carrying <span class="mono">?r=name</span> tags it — so
 <span class="mono">negotiationinc.com/plans?r=reddit</span> arrives here as
 <span class="mono">plans-founding-r-reddit</span>. Nothing is recorded unless
 somebody typed their address in: there is no page tracking on this site and
 the privacy page says so in as many words.</p></div>

<h2>Today's spend</h2>
<div class="g">
 ${card('Spent', usd(d.today.usd), `${n(d.today.calls)} calls · ${n(d.today.accounts)} accounts`, budgTone)}
 ${card('Of budget', d.today.pctOfBudget === null ? '—' : d.today.pctOfBudget + '%', `budget ${usd(d.today.budgetUsd)}`, budgTone)}
 ${card('Ceiling', usd(d.today.ceilingUsd), 'hard stop')}
 ${card('Errors, 1h', n(d.errors.lastHour), `${n(d.errors.sinceBoot)} since boot`, errTone)}
</div>

<h2>Control</h2>
<div class="ctl">
 <form method="POST" action="/api/ops/control" class="cf">
  <input type="hidden" name="action" value="${d.control.paused ? 'resume' : 'pause'}">
  ${d.control.paused ? '' : '<input type="hidden" name="minutes" value="60">'}
  <button class="${d.control.paused ? 'go' : 'stop'}">${d.control.paused
    ? 'Resume — paused ' + d.control.pausedFor + ' more min'
    : 'Pause everything metered · 60 min'}</button>
 </form>
 <form method="POST" action="/api/ops/control" class="cf">
  <input type="hidden" name="action" value="budget">
  <label>Today's budget $<input name="usd" inputmode="decimal" value="${esc(d.control.budgetUsd)}" size="5"></label>
  <button>Set</button>
 </form>
 <p>Pause stops every metered feature and tells the person the truth about why.
  Both levers take effect on the next request and both die with a deploy, which
  is the natural end of an emergency.</p>
</div>

<h2>The founding twenty-five</h2>
<div class="g">
 ${d.founding && d.founding.on
   ? (d.founding.known
      ? card('Places taken', n(d.founding.taken) + ' of ' + n(d.founding.seats),
             d.founding.open ? n(d.founding.left) + ' left — it closes itself' : 'closed automatically',
             d.founding.open ? '' : 'warn')
      : card('Places taken', '—', 'Stripe could not be counted — no founding price is being issued', 'bad'))
   : card('Founding offer', 'off', 'no STRIPE_PRICE_FOUNDING set')}
</div>

<h2>Switched on</h2>
<div class="g">
 ${Object.entries(d.features).map(([k, v]) =>
    card(k, v, '', v === 'on' ? 'good' : v === 'off' ? 'bad' : 'warn')).join('')}
</div>

<h2>What went wrong</h2>
${d.errors.list.length ? `<table><thead><tr><th>Route</th><th>Message</th><th class="r">Count</th><th class="r">Last</th></tr></thead><tbody>`
 + d.errors.list.map(e => `<tr><td class="mono">${esc(e.route)}</td><td>${esc(e.msg)}</td>`
   + `<td class="r">${n(e.n)}</td><td class="r mono">${esc(String(e.last).slice(11, 19))}</td></tr>`).join('')
 + `</tbody></table>`
 : '<div class="none">Nothing has thrown since this process started.</div>'}

<h2>Monthly caps at the top tier</h2>
<table><tbody>${Object.entries(d.capsAtTopTier).map(([k, v]) =>
  `<tr><td>${esc(k)}</td><td class="r mono">${n(v)}</td></tr>`).join('')}</tbody></table>

</div></body></html>`);
});

/* ══ THE TWO PUBLIC VALUES THE BROWSER NEEDS ═══════════════════════════════
   The account layer was DEAD on the live site and nothing said so. Both
   values were baked into every page at BUILD time from NI_SUPABASE_URL and
   NI_SUPABASE_ANON — and the build runs wherever the build runs, which is not
   the machine holding the configuration. So the server had Supabase and
   demanded an account for every paid feature, while the pages it served had
   no way to make one: the door silently fell back to a local-only workspace
   with no password, no sync and no sign-in, and looked completely normal.

   A build-time secret is a secret that has to be present in a second place
   nobody thinks about, and the failure mode is silence rather than an error.
   So the pages ask instead.

   BOTH VALUES ARE PUBLIC. The URL is a hostname. The anon key is designed to
   be served to every browser that loads the site — it is safe because
   row-level security is on, and if it were not, baking it into the HTML would
   have been exactly as exposed. Nothing here is a secret being handed out;
   the SERVICE key, which is a secret, is never in this response and never
   leaves this process.

   Cached hard at the edge: it changes when the deployment changes, and a
   deployment is a new process. */
app.get('/api/config', (_req, res) => {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_ANON_KEY || '';
  /* a SERVICE key in the anon slot would be handed to every browser on the
     site — refuse to serve it rather than pass it on. The build has the same
     assertion; this is the second place because this is the one that ships. */
  const looksService = /^(sb_secret_|service_role)/.test(key)
    || (/^eyJ/.test(key) && /service_role/.test(Buffer.from(key.split('.')[1] || '', 'base64').toString('utf8')));
  res.set('cache-control', 'public, max-age=300');
  if (looksService){
    log('CONFIG REFUSED: SUPABASE_ANON_KEY looks like a service key');
    return res.json({ ok:true, accounts:false, why:'anon-key-looks-like-a-service-key' });
  }
  res.json({ ok:true, accounts: !!(url && key), supabaseUrl: url || null, supabaseAnon: key || null });
});

app.get('/api/health', (_req, res) => {
  rollDay();
  checkGrants();                      // refreshes in the background; never blocks
  /* ── READABLE FROM ANYWHERE, ON PURPOSE ─────────────────────────────────
     This endpoint is already public: every field in it can be had by anyone
     with curl and has been since the day it shipped. Withholding the CORS
     header therefore protects nothing — it only stops BROWSERS doing what
     every other client can already do, which in practice means it stops the
     owner of the site building a dashboard against his own status page.

     So the header goes on, and the reasoning is worth writing down because
     the instinct that put it off is a good instinct pointed at the wrong
     door: `*` here is not a decision to publish this data, it is an
     acknowledgement that it is already published. The line that actually
     guards anything is the one above /api/ops, which holds the private
     numbers — accounts, MRR, spend — behind a token and answers 404 rather
     than 403, and which does NOT get this header. */
  res.set('access-control-allow-origin', '*');
  res.set('cache-control', 'no-store');
  res.json({ ok:true, service:'negotiation-inc', mock:MOCK, build:BUILD,
    read:    ((ACCESS || ACCOUNTS_ON()) && (KEY || MOCK)) ? 'on' : 'off',
    compare: ((ACCESS || ACCOUNTS_ON()) && (KEY || MOCK)) ? 'on' : 'off',
    street:  ((ACCESS || ACCOUNTS_ON()) && (KEY || MOCK))
               ? (process.env.CENSUS_KEY ? 'on' : 'partial') : 'off',
    bid:     ((ACCESS || ACCOUNTS_ON()) && (KEY || MOCK)) ? 'on' : 'off',
    object:  ((ACCESS || ACCOUNTS_ON()) && (KEY || MOCK)) ? 'on' : 'off',
    intake:  ((ACCESS || ACCOUNTS_ON()) && (KEY || MOCK)) ? 'on' : 'off',
    land: TILES_KEY ? (tiles.n >= TILES_CAP ? 'quota' : 'on') : 'flat',
    walk: TILES_KEY ? 'on' : 'off',
    comps:   ((ACCESS || ACCOUNTS_ON()) && (RENTCAST_KEY || MOCK)) ? 'on' : 'off',
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
    /* the number worth seeing from a phone: not a total since boot, which goes
       up forever, but whether anything is throwing RIGHT NOW */
    errors: { lastHour: errRecent() },
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
/* ── AND THE .js RULE IS AN ALLOWLIST NOW, FOR THE SAME REASON ─────────────
   This was a list of server modules to BLOCK, matched on the basename. It
   named seven and it was wrong twice: compare.js and street.js were servable
   for a deploy — neither holds a secret, but both hold a system prompt, and a
   prompt you can read is a prompt you can steer around — and intake.js was
   servable the afternoon it was written, caught by this file's own harness.

   Exactly one .js is FETCHED by a page: priors.js, via window.NI_PRIORS_URL.
   That is a list of one, checkable against the pages, and a new module in
   this directory cannot join it by being forgotten. `.mjs` came off the
   ALLOW list entirely for the same reason earlier today.

   The rest of NEVER stays a blocklist because those are files with no
   extension rule to hang an allowlist on. */
const JS_OK = new Set(['priors.js']);
const NEVER = /^package(-lock)?\.json$|^render\.yaml$|^(publish|suite2?|harness-util|test-api|test-pay|test-urls|_.*|t-.*|v\d+)\.mjs$|^(LAUNCH|SUPABASE|STRIPE|DOMAIN|README)\.md$|^\.env/i;
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
/* ══ ONE HOST, OR THE WORKSPACE IS ON THE WRONG SIDE OF THE ORIGIN ═════════
   Elijah, signed in, pressed the wordmark and got "a blank screen". The page
   was not blank — it was the landing page served from
   negotiation-inc-srv.onrender.com, and that is worse than blank. Every sheet
   this product keeps lives in localStorage, which is scoped to the ORIGIN, so
   on the Render hostname a signed-in customer is a stranger: no account, no
   properties, no bankroll. Anything they then type is written to a workspace
   they will never find again from their own domain.

   The platform host answers on purpose — Render needs it — and any stale
   link, cached redirect, old bookmark or crawler can land somebody there. So
   the app itself names its canonical host and bounces every other one to it,
   path and query intact, before any page or API route runs. NI_CANON, or the
   first entry of NI_ALLOW_ORIGIN, which is already the list of hosts this
   deployment says it serves.

   HEAD and GET only: a redirected POST loses its body, and the one thing
   worse than the wrong host is a payment webhook bounced into a 301. */
const CANON = (() => {
  const pick = [process.env.NI_CANON, ...ALLOW_ORIGIN]
    .map(x => String(x || '').trim().replace(/\/+$/, '')).filter(Boolean);
  for (const raw of pick){
    let h = null;
    try { h = new URL(raw.includes('://') ? raw : 'https://' + raw).host; } catch(e){ continue; }
    /* never canonicalise ONTO the platform host. If the allow-list happens to
       name it first, using it would redirect the custom domain to Render —
       the exact bug this exists to stop, pointed the wrong way, and cached
       by every browser for as long as a 301 lives. */
    if (/\.onrender\.com$/i.test(h) || /^localhost/i.test(h)) continue;
    return h;
  }
  return null;
})();
app.use((req, res, next) => {
  if (!CANON) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const host = String(req.headers.host || '').toLowerCase();
  if (!host || host === CANON.toLowerCase()) return next();
  /* localhost and the private network stay reachable — a canonical redirect
     that breaks the harnesses and the health probe is a self-inflicted outage */
  if (/^(localhost|127\.|0\.0\.0\.0|\[?::1)/.test(host)) return next();
  log('canon redirect from', host.slice(0, 60));
  return res.redirect(301, 'https://' + CANON + req.originalUrl);
});
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
  if (/\.js$/i.test(base) && !JS_OK.has(base)) return res.status(404).type('txt').send('Not found');
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

/* ── THE ONE THAT CATCHES EVERYTHING ELSE ──────────────────────────────────
   Express swallows a thrown handler into a generic 500 with no trace unless
   there is a four-argument middleware at the very end. Without it a route that
   throws produces a blank error to the caller and NOTHING anywhere else: no
   line in the log, no counter, no way to know it is happening. Every 500 this
   service has ever served was invisible.

   The caller still gets a sentence and never a stack — a stack trace names
   file paths and library versions and is a gift to anybody probing. */
app.use((err, req, res, _next) => {
  const route = String(req.path || '').slice(0, 60);
  noteErr(route, 500, err);
  log('ERROR', route, String((err && err.message) || err).slice(0, 200));
  if (res.headersSent) return;
  if (route.startsWith('/api/'))
    return res.status(500).json({ ok:false, error:'Something failed on our side. It has been recorded.' });
  res.status(500).type('txt').send('Something failed on our side.');
});

if (process.env.NI_NO_LISTEN !== '1'){
  app.listen(PORT, () => log(`up on ${PORT} · read ${(ACCESS && (KEY||MOCK)) ? 'on' : 'OFF'}${MOCK ? ' · MOCK' : ''}`));
}
export default app;
