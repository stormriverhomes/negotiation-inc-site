# Getting paid — setup

Built and tested in the sandbox. What follows is the account work, which is
yours to do, and the two things that are easy to get wrong and expensive to
notice late.

**Nothing here is switched on until the environment variables are set.** With
`STRIPE_SECRET` empty, `/api/checkout` and `/api/portal` return 503 and the
plans page is exactly what it is today. That is deliberate and it is the same
rule the photo read follows: an unconfigured deploy has no checkout, never a
broken one.

---

## The one rule

**The only thing that decides what somebody gets is `profiles.plan`, and the
webhook is the only writer of it.**

`tierOf()` in the desk reads one field. The webhook writes one field. The
price, the coupon, the trial, the proration and the invoice are all Stripe's
problem and never become the product's. Every billing system that has gone
wrong went wrong by letting a second thing decide.

---

## 1 · The account

stripe.com, **Test mode on** for everything below. Business verification can
wait until you flip to live keys; test mode needs nothing but an email.

## 2 · The products

Three products, one recurring monthly price each. **Write the price IDs down.**

| Product | Price now | What it is |
|---|---|---|
| Negotiation Inc · Solo | $49/mo | `STRIPE_PRICE_SOLO` |
| Negotiation Inc · Underwriter | $99/mo | `STRIPE_PRICE_UNDERWRITER` |
| Negotiation Inc · The Office | $249/mo | `STRIPE_PRICE_OFFICE` |

> ### The price lock, and why it is not a discount
>
> Billing §6 promises the $99 subscribers keep $99 and the founding hundred
> keep $49, permanently. **Never do that with a coupon.** A coupon does not
> survive a price change; a separate price object does. When you raise the
> price, you make a NEW price object and point the environment variable at it.
> Everybody already subscribed stays on the old one, untouched, forever — you
> do not migrate them, and there is no code that could.
>
> That is why the plan is written into the subscription's **metadata** at
> checkout and read back from there rather than looked up from the price. If
> the plan were derived from the price id, the day you raise the price every
> founding member's webhook would look up a price that is no longer in the
> environment and their account would go dark — months after launch, hitting
> only your earliest customers, looking like a database fault. `test-pay.mjs`
> section C exists entirely to keep that from ever shipping.

**The founding hundred:** make a fourth price object at $49 on the Underwriter
product, point `STRIPE_PRICE_UNDERWRITER` at it, and when the hundredth
subscriber lands, point the variable back at the $99 price. Nothing else
changes and nobody's bill moves.

## 3 · The customer portal

**Settings → Billing → Customer portal.** Switch on: cancel subscriptions,
update payment method, invoice history. Set cancellation to **at end of
period**.

This is what the account panel's "Manage billing or cancel" button opens, and
it is how the plans page keeps its promise that cancelling takes two clicks. A
cancel flow written by hand would be a worse one with more ways to strand
somebody halfway through.

## 4 · The webhook

**Developers → Webhooks → Add endpoint**, pointed at
`https://negotiationinc.com/api/stripe`. Send these five:

```
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.payment_failed
```

Copy the signing secret (`whsec_…`).

> ### Webhooks arrive out of order, and they replay
>
> A `deleted` for last month's cancelled subscription can land after an
> `updated` for this month's new one. A handler that reads state out of the
> event body cancels a paying customer.
>
> So no event body is ever trusted for state. An event is a nudge saying "this
> customer changed"; the handler answers by asking Stripe what is true right
> now and writing that. Replays, reorders and duplicates all converge on the
> same answer. `test-pay.mjs` section D replays exactly that sequence.

## 5 · The environment

On Render, alongside the two Supabase variables from `SUPABASE.md`:

```
STRIPE_SECRET             sk_test_…      (then sk_live_… on launch day)
STRIPE_WEBHOOK_SECRET     whsec_…
STRIPE_PRICE_SOLO         price_…
STRIPE_PRICE_UNDERWRITER  price_…
STRIPE_PRICE_OFFICE       price_…
STRIPE_TRIAL_DAYS         14
NI_SITE_URL               https://negotiationinc.com
SUPABASE_ANON_KEY         eyJ…           (the PUBLIC one — used only to verify a session)
```

`/api/health` should then show `"billing":{"pay":"on","hook":"on",…}`.

---

## What happens when somebody subscribes

1. They click a tier on the plans page → `office.html?join=underwriter`.
2. No session yet, so the tier is held and the door asks them to sign up.
3. On the far side of the door, checkout starts with the tier they picked. A
   person who has already decided to pay is never sent back to find the plans
   page again.
4. Stripe takes the card and redirects to `office.html?paid=1`.
5. **The page waits.** The redirect beats the webhook nearly every time — one
   hop against a queue — so a page that reads the plan once shows a free
   account to somebody who has just been charged, and the next thing that
   person does is either email you or call their bank. Instead it says
   "putting your subscription in place", asks every 1.6 seconds for twenty
   seconds, and if the webhook still has not landed it says so plainly and
   names the support mailbox. It never shows a free account to somebody who
   paid.
6. The webhook writes `plan`. The next page load reads it and everything the
   tier opens is open.

## Failing cards

`past_due` **keeps** the plan. Stripe retries a failed card for about three
weeks and most of those retries succeed — it is usually an expiry date, not a
decision. Cutting somebody off on the first decline turns a card that needed
updating into a customer who left. `unpaid` is where the retries have run out,
and that is where access ends.

## Launch day

1. Swap the five test values for live ones. Nothing else changes.
2. Re-point the webhook at the live endpoint and copy the LIVE signing secret —
   test and live secrets are different, and a live webhook signed with a test
   secret fails verification silently, which looks exactly like "nobody is
   subscribing".
3. Put one real card through a real subscription, **then refund it**. The
   refund is the half people forget to test, and Refunds §2 promises thirty
   days no reason needed.
4. Cancel from the account panel and check the subscription really ends at the
   period end rather than immediately.

## Testing it now

```bash
cd srv && node test-pay.mjs      # the server half, against a hostile stub Stripe
node _tpay.mjs                   # the browser half, in a live-stage build
```

Neither needs a Stripe account, a key, or a network. Both are in the board.
