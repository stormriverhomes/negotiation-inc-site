/* ══ WHO SOMEBODY IS ════════════════════════════════════════════════════════
   One definition of the tier grammar, injected into every room that has to
   decide what somebody may see or do.

   ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
   It exists because the Land Desk did not have it. Not a weaker version of
   it — NONE of it. `grep` for tierOf, entitled or signedIn in land.html
   returned zero, and the page was not even on the list that gets the account
   script appended at build time. It was an island: no account, no masthead,
   no stage flag, no wall.

   The consequence was not academic. plans.html promises, in a bullet somebody
   is asked to pay against: "The comp workbench — score sales yourself. Three
   in this browser, twelve a week with a free account." The Land Desk's sold-
   lot bench is a comp workbench on a different asset, and it handed a total
   stranger EIGHT, scored, with no account and no wall — while the house sheet
   two clicks away told the same person they had three. A promise on the
   pricing page that a second room quietly contradicts is worse than a missing
   feature; it teaches people the pricing page is decorative.

   ── THE RULE THIS FILE KEEPS ──────────────────────────────────────────────
   tierOf() PAINTS. entitled() DECIDES.

   tierOf is deliberately generous: a demo runs at tier 3 so a stranger can
   SEE the paid product working, and a pre-launch preview flag can paint any
   tier for a screenshot. Both are the right answer for deciding what to DRAW
   and the wrong answer for deciding what somebody may DO or what may be SPENT
   on their behalf. Entitlement is the narrower question — a real account,
   carrying a plan the SERVER put there — and it is the only one an upload
   control or a model call ever asks.

   Pure. No DOM, no fetch, no localStorage: every caller passes the account in
   and gets an answer back, so the same three functions can be tested directly
   and cannot drift between the two rooms that now share them. ══════════════ */

export const TIERS = { 'solo':1, 'underwriter':2, 'the office':3, 'office':3 };
export const TIER_NAME = ['Free','Solo','Underwriter','The Office'];
export const TRIAL_DAYS = 14;

/** Days left of a trial, or 0. The date is stored as YYYY-MM-DD, read as UTC
 *  so that a sheet does not gain or lose a day by crossing a timezone. */
export function trialDaysLeft(acct, now, days){
  if (!acct || !acct.trial) return 0;
  const started = Date.parse(acct.trial + 'T00:00:00Z');
  if (!Number.isFinite(started)) return 0;
  const gone = Math.floor(((now === undefined ? Date.now() : now) - started) / 86400000);
  return Math.max(0, (days === undefined ? TRIAL_DAYS : days) - gone);
}

/* ── TWO READINGS OF THE SAME PLAN LABEL, AND THE DIFFERENCE IS THE POINT ──
   "tierOf paints, entitled decides" is not only a rule about demos. It runs
   all the way down to what an UNRECOGNISED plan label means, and the two
   answers must differ:

     · to PAINT, an unknown label is generous — `|| 1`. A rename or a legacy
       label should not blank somebody's interface while we work out what it
       was. The cost of being wrong is a slightly richer screen.
     · to DECIDE, an unknown label is worth NOTHING — `|| 0`. The cost of
       being wrong here is handing the paid product, and the model spend
       behind it, to any string nobody recognises.

   desk.html has carried this asymmetry from the beginning: `TIERS[k] || 1` in
   tierOf and `TIERS[k] || 0` in entitled. When this module was first written
   it routed BOTH through the generous reading, which would have given Solo to
   an account carrying any unrecognised plan label. _tcross.mjs caught it on
   its first run by standing the two rooms side by side — which is the entire
   reason that harness exists.

   An EMPTY plan string is not an unrecognised plan in either reading: it is NO
   plan, and it is zero. Without that line a stray '' on disk bought a tier. */

/** What to PAINT from a plan label. Generous about names we do not know. */
export function planTier(acct){
  if (!acct || typeof acct.plan !== 'string') return 0;
  const k = acct.plan.trim().toLowerCase();
  if (!k) return 0;
  return TIERS[k] || 1;
}
/** What a plan label BUYS. A label nobody recognises buys nothing. */
export function paidTier(acct){
  if (!acct || typeof acct.plan !== 'string') return 0;
  const k = acct.plan.trim().toLowerCase();
  if (!k) return 0;
  return TIERS[k] || 0;
}

/** What to DRAW. Generous on purpose. `opts.demo` and `opts.preview` are the
 *  two paint-only overrides; preview is null unless a pre-launch flag is set. */
export function tierFor(acct, opts){
  const o = opts || {};
  if (o.demo || trialDaysLeft(acct, o.now) > 0) return 3;
  if (o.preview !== null && o.preview !== undefined) return o.preview;
  return planTier(acct);
}

/** What somebody may DO. Never a demo, never a preview — a paint job is not a
 *  purchase — and never without a real account. */
export function entitledFor(acct, n, opts){
  const o = opts || {};
  if (o.demo) return false;
  if (!acct) return false;
  if (trialDaysLeft(acct, o.now) > 0) return true;
  return paidTier(acct) >= n;      // paidTier, never planTier — see above
}

/** WHY not, so a locked card can say the true thing rather than the generic
 *  thing. The reason IS the call to action: a stranger needs an account, not
 *  a price list. Returns null when they are entitled. */
export function whyNotFor(acct, n, opts){
  const o = opts || {};
  if (o.demo)   return 'demo';
  if (!acct)    return 'signedout';
  if (trialDaysLeft(acct, o.now) > 0) return null;
  const t = paidTier(acct);        // the reason must match the decision
  if (t >= n) return null;
  return t === 0 ? 'free' : 'lowtier';
}

/* ── ONE COMPARABLE-SALES ALLOWANCE, ACROSS THE PRODUCT ────────────────────
   Houses and lots are scored by different benches on different pages, and
   they draw on ONE allowance, because the promise on the pricing page is one
   sentence and one number: three in this browser, twelve a week with a free
   account. Two meters would need two sentences, and the second sentence would
   be the one nobody reads before they are surprised by it.

   The cap is not a cost control — scoring a comp is arithmetic in the
   browser's own process, not a model call. It is the rung that would
   otherwise be missing from the ladder: without it a free ACCOUNT buys
   nothing at all on the best feature in the product.

   `room` is what is left HERE; `rung` is which wall they are standing at, so
   each wall can name its own number and its own next step rather than telling
   a registered member they are still a guest. */
export const FREE_IN_BROWSER = 3;   // signed out, this browser, per sheet
export function benchRoom({ paid, acct, quota, used, ceiling }){
  const cap = ceiling === undefined ? 24 : ceiling;
  if (paid) return { room: Math.max(0, cap - used), rung:'paid' };
  if (acct && quota)
    return { room: Math.min(quota.remaining, Math.max(0, cap - used)),
             rung:'account', used:quota.used, cap:quota.cap };
  return { room: Math.max(0, FREE_IN_BROWSER - used),
           rung: acct ? 'account-unknown' : 'guest' };
}
