# Pointing negotiationinc.com at the product

Right now `negotiationinc.com` resolves to `76.223.105.230` — GoDaddy's parking
page. The product is only reachable at its Render URLs, which means the arcade,
the desk and the course are invisible to anybody you send there, and the social
push you want to start has nowhere to send them.

This is the last physical wire. It costs nothing.

---

## First, the choice that matters

There are two Render services, both building from the same repo:

| Service | What it is | Serves |
|---|---|---|
| `negotiation-inc-site` | Static Site | the pages, from a CDN, always warm |
| `negotiation-inc-srv` | Web Service, free | the pages **and** `/api/*` |

The waitlist posts to `/api/list` on **its own origin**. So whichever host the
domain points at has to be the one that answers `/api/*`, or every address
somebody leaves gets the "email support@ instead" fallback.

That argues for pointing the domain at **`negotiation-inc-srv`**, and that is
the recommendation — with one thing to know going in:

> **A free web service spins down after about fifteen minutes of no traffic.**
> The next visitor waits ~50 seconds for it to wake. On a site being promoted
> on social, where most visits are the first in a while, that is most of your
> visitors. It is the single strongest argument for the $7/month Starter plan
> once there is $7 to spend — not for performance, for not losing the click.

If the cold start is unacceptable before there is money, the alternative is to
point the domain at the **static site** and accept that the waitlist hands over
the mailbox until launch. Pages stay instant; captures stop working. Given the
whole point of this month is collecting addresses, the cold start is the lesser
loss — so: **the web service**.

---

## 1 · Render — add the domain

`negotiation-inc-srv` → **Settings** → **Custom Domains** → **Add Custom Domain**.

Add both, one at a time:

```
negotiationinc.com
www.negotiationinc.com
```

Render then shows you the exact records to create, and they are the only
authoritative source — **copy them from that screen rather than from here**,
because the CNAME target is specific to the service and Render has changed its
apex address before. It will look like:

- **apex** (`negotiationinc.com`) → an `A` record to a Render IP
- **www** → a `CNAME` to `negotiation-inc-srv.onrender.com`

> When I tried to do this for you the Custom Domains panel sat on "Loading…"
> in both services and never rendered — the section is there in the left-hand
> nav, it just would not paint in that browser session. If it does the same for
> you, a hard reload usually fixes it.

## 2 · GoDaddy — create the records

GoDaddy → **My Products** → the domain → **DNS** → **Manage Zones**.

**Delete first:** GoDaddy parking leaves an `A` record on `@` pointing at its own
IP, and often a `CNAME` on `www`. Both have to go, or the old records win.

Then add exactly what Render showed you:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | *(the IP from Render)* | 600 |
| CNAME | `www` | `negotiation-inc-srv.onrender.com` | 600 |

Set TTL to ten minutes while you are testing. You can put it back to an hour
once it works.

## 3 · Wait, then check

Render verifies within a few minutes of the records propagating and issues a
TLS certificate itself — free, automatic, nothing to buy. GoDaddy will try to
sell you an SSL certificate at some point in this process. **You do not need
it.**

Check, in this order:

1. Render's Custom Domains panel shows both domains **Verified** with a cert.
2. `https://negotiationinc.com` loads the landing page — not a GoDaddy page,
   not a certificate warning.
3. `https://negotiationinc.com/api/health` returns JSON. This is the one that
   proves the domain landed on the web service and not the static site.
4. The waitlist form on the landing page: put a real address in. Before
   Supabase is configured it should say *"The list is not reachable right
   now — email support@…"*. That is the correct answer, and it is how you know
   the form is wired rather than silently dropping people.

## 4 · The thing that is still not true

`support@negotiationinc.com` does not exist. Until it does, the waitlist's
fallback tells people to write to an address that bounces — which is worse than
the form simply failing, because they think they have done something.

**Cloudflare Email Routing is free and takes about ten minutes**, but it wants
the domain's nameservers. Since the DNS above is being done at GoDaddy, the
simpler path today is GoDaddy's own email forwarding, or moving nameservers to
Cloudflare and doing both DNS and mail there. Either way this should happen the
same week as the domain — three legal pages already print that address.

The fastest ordering, if you only have one evening: **Supabase first** (then
the waitlist works and the mailbox rarely gets used), **domain second**,
**mailbox third**.
