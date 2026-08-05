# Launch, in one command

Everything that differs between "not selling yet" and "selling" is decided by a
single environment variable. The build strips the half that does not apply, and
then **asserts the stage it just built** — so a half-launched site is not
something you can accidentally ship, because the build refuses to produce one.

```bash
NI_STAGE=live node publish.mjs        # the switch
```

That is it for the markup. What follows is the short list of things that live
outside the repo, and the order they have to happen in.

---

## How the switch works

Two markers, and no third way of doing it is allowed:

```html
<!--SOON--> …survives only before launch… <!--/SOON-->
<!--LIVE--> …survives only after it…      <!--/LIVE-->
```

Blocks are removed at **build** time, not hidden at runtime. So a pre-launch
page does not ship checkout copy for a curious person to find in view-source,
and a live page does not ship a waitlist form that could still be submitted to
an endpoint you have switched off.

For the two pages that build their markup in JavaScript, the same single source
reaches them as `window.NI_LIVE`, injected into every `<head>`. `PRELAUNCH` in
`desk.html` and `office.html` derives from it. Nothing else may decide the stage.

**What the build refuses to do:**

| Building | It fails if |
|---|---|
| `prelaunch` | the plans page has no waitlist · it still offers a 14-day trial · the stage flag is missing |
| `live` | the plans page still carries the waitlist · it still says "opens soon" · there is no way to subscribe |
| either | a `<!--SOON-->` or `<!--LIVE-->` marker survived into a shipped page · a block is unbalanced |

---

## Before you flip it

Four things, none of them in the repo.

**1 · The entity.** Incorporate, then change one line in `legal_build.py`:

```python
ENTITY = "Negotiation Inc"          # once the corporation exists
```

Re-run `python3 legal_build.py`, rebuild. The build already fails if the three
legal pages lose the entity name or if "Delaware" comes back.

**2 · Stripe, live.** The integration is built and tested — `srv/STRIPE.md` is
the setup, `srv/test-pay.mjs` and `_tpay.mjs` are the proof — so this is a key
swap plus Stripe's business verification. Two things that are easy to get wrong
and expensive to notice late, both of which the harness now refuses to let
regress:

- **Grandfathered prices must be separate price objects**, never a computed
  discount. Billing §6 promises $99 subscribers keep $99 and the founding
  hundred keep $49, permanently. A discount coupon does not survive a price
  change; a distinct price object does. And the plan is read from the
  subscription's metadata, never from the price id — otherwise raising the
  price puts every founding member's account dark.
- **The webhook writes exactly one field** — `plan` on the profile. `tierOf()`
  reads exactly that one field and nothing else. Keep it that way.

**3 · The two mailboxes.** `support@` and `privacy@` on negotiationinc.com,
forwarding to wherever you read mail. Cloudflare Email Routing is free and takes
about ten minutes. These are on three legal pages already; a bouncing address on
a legal page is worse than no address.

**4 · The waitlist has somewhere to land.** Set `SUPABASE_URL` and
`SUPABASE_SERVICE_KEY` on the Render service and create the table:

```sql
create table waitlist (
  email   text primary key,
  source  text,
  created timestamptz default now()
);
```

Until those are set, `/api/list` returns **503 on purpose** and the page hands
over the support mailbox instead. It will never tell somebody they are on a list
they are not on — you would find that out on launch day, with a month of
visitors gone and nobody to send to. Check `/api/health` shows `"list":"on"`.

---

## Launch day, in order

1. `NI_STAGE=live node publish.mjs` — and read the `stage: live` line it prints.
2. Run the suite. Everything green, including the legal and stage assertions.
3. Upload `dist/` to the repo. Render deploys in about three minutes.
4. Check `/plans` — no waitlist, real subscribe buttons, `NI_LIVE=true` in the head.
5. Put one real card through a real subscription and then refund it. The refund
   is the half people forget to test, and Billing §2 promises 30 days no reason
   needed.
6. Email the waitlist. One email, from a person, with the founding price on it —
   which is exactly what the pre-launch form promised, so it has to be true.

## Going back

`node publish.mjs` with no `NI_STAGE` rebuilds pre-launch. The switch is
symmetrical on purpose: if something is wrong on launch day you can be back to
"opens soon" in the time it takes to deploy, rather than editing pages under
pressure.

---

## The AI features, and the one key each needs

Three routes now spend the Anthropic key, and all three ride the same rails:
the access code says whether the deployment has them on, the **account** says
who may use them, and a per-account monthly meter says how many.

| Route | Feature | Tier | Underwriter / Office |
|---|---|---|---|
| `/api/read` | The photo condition read | Underwriter | 100 / 300 a month |
| `/api/compare` | The written comparison | Underwriter | 30 / 90 a month |
| `/api/street` | The street brief | Underwriter | 40 / 120 a month |

Every cap is an environment variable — `NI_CAP_AIREAD`, `NI_CAP_AICOMPARE`,
`NI_CAP_AISTREET`, and `_OFFICE` variants. The right number is discovered from
usage, not from a meeting, and changing it should not be a deploy.

### What each one needs in Render

- **All three need `ANTHROPIC_API_KEY` and the Supabase trio.** That is it.

  `NI_ACCESS_CODE` is a PRIVATE-BETA switch and is **optional**. Leave it unset
  in normal operation. When it was the only gate, "no code means off" was right;
  now that entitlement comes from the account, requiring it as well would mean
  every paying subscriber typing a shared password into a box before using a
  feature they had already bought. So:

  | code set | accounts configured | result |
  |---|---|---|
  | yes | yes | code checked, then the account decides — private beta |
  | no  | yes | the account decides — **normal operation** |
  | no  | no  | off. This is the fail-closed case and it still holds |

  `/api/health` reports which of the three you are in, as `gate`.
- **The street brief also wants `CENSUS_KEY`** — free, no card, about two
  minutes: https://api.census.gov/data/key_signup.html . Without it the brief
  still runs: it gives the FEMA flood position and the search, and says in
  plain words that the tract figures could not be read. `/api/health` reports
  `street: "partial"` in that state so you can see it from outside.

### The migrations

`srv/sql/002-comp-allowance.sql` then `003-usage-table.sql`, in that order, in
the Supabase SQL editor. Both are safe to run twice, and the site is safe to
deploy before either — a missing meter does not block a paying customer.
