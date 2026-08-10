# Claude Design brief — Negotiation Inc: the dashboard, and every interface behind it

You are redesigning the working surfaces of a live real-estate underwriting SaaS.
It is at negotiationinc.com, it is taking real money through Stripe, and it is
about to go into promotion. The product is *good* — the arithmetic is honest, it
shows its working, it refuses to guess. It does not yet *look* like the best
tool in its category, and that gap is now the thing costing conversions.

Judge it against Linear, Stripe's dashboard, Vercel, Height, Retool, Figma —
not against other real-estate software, which is uniformly ugly and is not the
bar. The bar is: a professional opens this, and within three seconds believes
they are holding better equipment than they had yesterday.

---

## THE FEELING TO DESIGN FOR — read this twice, it is the actual brief

From the owner, verbatim, because the phrasing matters more than any spec:

> "It needs to feel like a robust tool with most of the really good features
> blocked behind paywall of course but the more cool icons for tools or
> sections in the sidebar especially ones that are blocked behind the paywall
> it makes it feel way more exciting especially once people make an account
> because it signals to them that this is a place where they can make deals out
> of. It should feel like the equivalent of a fortified military bunker of real
> estate where they can be safe in that dashboard and close deals out of that
> dashboard without feeling unprotected or unsafe. Like the fancy tech is more
> than enough to help you but also intuitive enough that it feels like playing
> a video game."

Unpack that into design intent:

- **Bunker, not brochure.** Enclosed, instrumented, load-bearing. The user is
  *inside* something built for the job. Weight, hierarchy, and a dark
  command-rail against a bright work surface — that contrast already exists and
  is the strongest thing in the current design. Keep it and push it.
- **Visible arsenal.** The count and variety of instruments is itself the
  message. A locked tool is not a wall — it is a rack you can see, that you
  will own. Locked state must read as *treasure*, never as *denial*. It is
  currently gold-on-navy and that instinct is correct.
- **Video-game legibility.** Instant read of state: what is mine, what is
  live, what is next, what is locked. Iconography that is *learnable*, glanceable
  and consistent. Satisfying, physical feedback on press. Not literal gaming
  chrome — no neon, no XP bars on the underwriting sheet.
- **Safe.** Nothing ever feels like it might silently lose your work or charge
  you by surprise. Provenance and confidence are always visible.

---

## WHAT THE PRODUCT ACTUALLY IS

A person is deciding what to pay for a house. The tool takes four numbers
(asking, ARV, repairs, rent) plus a condition read, and prices **eight exits** —
flip, rent, wholesale, wholetail, novation, subject-to, seller-finance,
walk-away — showing every step of the arithmetic and refusing to invent any
figure it was not given.

**Tiers:** Free ($0) · Solo ($39) · Underwriter ($129) · The Office ($249).

**Every real tool, and which tier opens it** — the design must not invent
features, and must not omit these:

| Tool | Tier | What it does |
|---|---|---|
| Price a property (the desk) | Free | three steps, eight exits, working shown |
| The eight ways out (course) | Free | what an exit is, and the number that decides it |
| The land desk | Free | prices raw ground, to the square foot |
| The arcade (3 games) | Free | practice, runs the desk's own arithmetic |
| Compare deals | Solo | 2–4 sheets side by side, and where the winner flips |
| Lender packet | Solo | one PDF: comps, condition read, every exit, your name |
| Read the condition | Underwriter | drop walk-through photos → 17 lines, each with its photo |
| Pull the comps | Underwriter | recent sales for the address, scored and adjusted |
| Walk the street | Underwriter | the block on Street View, from inside the sheet |
| Street brief | Underwriter | census, flood zone, permits for these coordinates |
| Offer letters | Underwriter | the letter and the text, from the winning exit |
| Read their bid | Underwriter | contractor's schedule vs your estimate, line by line |
| Handle objections | Underwriter | what they'll say back, answered on your own arithmetic |
| A week of leads | The Office | paste the list, every one priced at once |
| Buy-box rules | The Office | flag the fit, refuse the drive-out |

---

## THE SURFACES, IN PRIORITY ORDER

### 1 · THE DASHBOARD (`office.html`) — the highest-value screen

This is the first thing a new account sees and the screen they return to. It
currently has: a dark hero with a greeting and two stats; a grid of 8 action
cards; a properties panel; a workspace panel (market medians, course progress,
arcade); and a fixed dark left rail carrying identity, three primary buttons,
the property list, a 12-tool grouped arsenal with tier chips, and a foot.

**It was just improved and is a decent floor, not a ceiling.** The rail arsenal
and the 8-card grid landed today. What still needs a designer:

- The hero is a large dark slab carrying only a greeting and two stats. On an
  empty account it is mostly empty. It should be the **status board of the
  bunker** — earning its size, working hard when there is nothing on the desk.
- The empty state is the *majority* first experience and currently reads as a
  vacant room. This is the single biggest opportunity on the screen: an empty
  dashboard should feel like a powered-up console awaiting its first job, not
  an empty page.
- Rail and body both list the tools now — deliberate (the rail is desktop-only,
  the cards carry the phone) but the relationship between them needs designing
  rather than tolerating.
- No sense of momentum: no recent activity, no streak, no "what changed since
  you were last here."

### 2 · THE DESK (`desk.html`) — where the work happens

Three steps (The value / The condition / The deal), a comp workbench, a
condition read with 17 line items, and the eight priced exits with full
arithmetic. This is the best-engineered screen and the most visually dense.

**Two concrete problems, measured today:**

- **Upsell burial.** With an address entered on a free account, the sheet stacks
  **two full-width Underwriter panels with identical "Start the fourteen days →"
  buttons**, roughly 700px, *before* the user reaches any actual work. Two
  identical CTAs stacked is the pattern that makes good software feel like a
  pitch. The teasers should be *inline, seductive and small* — an instrument
  under glass — not two stacked billboards.
- **First-input depth.** The first input sits ~0.95 screens down on a 390px
  phone after today's fix. Better; still not good.

### 3 · THE LAND DESK (`land.html`)

Prices raw ground. Visually the *furthest* from the rest of the product — see
the token audit below. Needs to be brought into the system without losing its
scale-drawing, which is genuinely good.

### 4 · PLANS (`plans.html`)

Where money is decided. ~20 phone screens. Recently compressed but still the
longest page in the product.

### 5 · THE ARCADE (`arcade.html`, `comp-run.html`, `daily-street.html`, `exit-drill.html`)

Pixel-art games that train the same instincts. They have a strong, deliberate
aesthetic that is intentionally *different*. Do not homogenise them — but the
seams where they meet the software (the cabinet floor, the end-of-run handoff)
should be designed rather than abrupt.

---

## MEASURED: WHY IT DOES NOT FEEL LIKE ONE PRODUCT

Computed from the shipped pages today. This is the evidence, not an opinion.

**Border radius — 8 distinct values per page, and different leaders per page:**
```
office : 9px×10, 8px×10, 4px×9, 18px×8, 12px×8, 999px×7, 7px×4, 10px×3
desk   : 999px×10, 12px×9, 50%×6, 10px×5, 7px×4, 4px×4, 9px×2, 18px×2
land   : 999px×20, 8px×10, 50%×6, 9px×4, 10px×4, 7px×4, 18px×2, 11px×2
```
Ten radii in circulation (4, 7, 8, 9, 10, 11, 12, 18, 50%, 999). Linear and
Stripe run three or four. **Propose a radius scale of at most four steps and
map every existing value onto it.**

**Type — 10+ sizes per page, and each page leads with a different body size:**
```
office : 12.5px×20, 10px×16, 14px×16, 13px×14, 18px×12, 9px×10, 7.5px×9 …
desk   : 13px×13,   9.5px×7, 14.5px×6, 12px×4, 8px×4, 10px×3, 12.5px×3 …
land   : 8.5px×13,  9px×11,  13.5px×11, 9.5px×10, 13px×9, 12.5px×9 …
```
Three surfaces of one product with three different body sizes, and **the land
desk's most common text size is 8.5px** — caption size doing body's job.
There are 7.5px, 8px, 8.5px, 9px and 9.5px all in play as separate steps.
**Propose a type scale of six or seven steps with defined roles.**

**Shadow — 5 distinct elevations on the dashboard, 3 on the desk, 4 on land,
none shared.** Propose a single elevation ladder of three.

**The bright/dark relationship is the strongest thing you have** — a dark navy
command rail against a near-white work surface. Nothing else in the category
does it. Push it.

---

## THE DESIGN LANGUAGE THAT ALREADY EXISTS — preserve these

These are load-bearing product rules, not decoration. Breaking one is a bug.

- **Colour is meaning, strictly.** `--pays` marks only money that actually
  pays. `--refuses` marks only a decline *that carries a reason*. `--brass`
  (gold `#e8cf72`) marks only the bankroll and the locked/premium state.
  `--desk` blue appears once per arcade page. **A negative number is never the
  affirmative colour** — this was a real bug: a −$102,000 spread rendered in
  the green used for profit.
- **Provenance grammar, always visible:** every figure is `ENTERED`,
  `ESTIMATE`, or `NEEDED`. Never hide which.
- **The ground rule:** "The edge belongs to what you are inside of. Objects
  stop short of it."
- **Type:** Fraunces (self-hosted, 37KB) for display/serif, system sans for UI.
- **No third-party webfonts and no third-party CDNs.** Non-negotiable — inline
  everything, self-host everything.
- **Tier chips** currently read `SOLO` / `UNDERWRITER` / `THE OFFICE` in gold.
- **The product never claims a feature it does not have.** The build throws if
  the pricing page names something the code cannot do.

Current palette in use: ink `#101725`, mid `#4a5162`, soft `#677187`,
line `#e8ebf1`, blue `#1f5fd0`, blue-deep `#173f8a`, blue-soft `#e9effb`,
green `#177a4d`, gold `#e8cf72`, rail gradient `#101f38 → #16283f`.

**Accessibility is a hard requirement, not a nice-to-have.** WCAG 2.1 AA:
4.5:1 for body text, 3:1 for large text and UI components. A production audit
today found `--soft`/`--faint` greys failing AA on the `--wash` background —
including the trial disclosure under every paying button — and the Terms /
Privacy / **Billing** links at 3.7:1, which makes the route to *cancelling* the
least readable text on the page. Every colour you propose must state its
measured contrast ratio against its actual background.

---

## WHAT TO PRODUCE

Work in this order and do not skip step 1.

**1 · A design system, stated as tokens.** Radius scale (≤4 steps), type scale
(6–7 steps with roles), elevation ladder (3), spacing rhythm, the semantic
colour roles above with measured contrast ratios, and the icon language —
including what a locked instrument looks like and why it reads as desirable.
State how each existing loose value maps onto the new scale, so this is a
migration and not a parallel system.

**2 · The dashboard, fully designed**, in these states, because the empty one
is what most new accounts actually see:
   - free tier, empty (**the most important screen in this brief**)
   - free tier, three properties on the desk
   - Underwriter, five properties, mid-work
   - the collapsed 64px rail
   - 390px phone, where the rail is hidden entirely

**3 · The desk**, solving the stacked-upsell problem specifically: how does a
locked instrument sit *inside* a working sheet so it is enticing, honest and
small?

**4 · The pattern set** the rest of the product inherits: panel, card, stat,
empty state, locked/teaser state, primary and secondary action, tier chip,
provenance tag, confidence indicator, table row, form field, toast/notice.

**5 · The land desk** brought into the system.

### Deliverable format

Return **one self-contained HTML file** — inline CSS and JS, no external
requests, no CDN, no webfont — that presents:
- the token system as a rendered specimen sheet
- each designed screen at full fidelity, in the states listed
- the pattern set with every state visible (default / hover / active / focus /
  disabled / locked / loading / error / empty)
- short written rationale beside each decision — *why*, not what

Real content throughout: real addresses, real dollar figures, real exit names.
No lorem ipsum, no "Feature 1", no placeholder greys. Where you invent copy,
match the existing voice: plain, specific, unhurried, never salesy, and it
always says what a number means rather than just printing it.

### Explicitly out of scope
Do not redesign the arcade games' pixel art. Do not propose features that do
not exist in the table above. Do not introduce a component library, a CSS
framework, or a build step.

---

## THE THREE QUESTIONS I MOST WANT ANSWERED

1. **What does an empty dashboard look like when it is supposed to feel like a
   fortified, fully-equipped bunker?** Emptiness is the default first
   experience and currently the weakest screen in the product.

2. **How does a locked instrument read as treasure rather than as a wall?**
   Every locked tool must make someone want the tier *more*, and must never
   feel like the product is withholding something they already paid for.

3. **The rail and the body currently both list the tools** — the rail because
   it is the desktop command surface, the cards because the rail is hidden on
   phones. Is that duplication right? If not, what replaces it? Related: the
   desk's rail and the dashboard's rail have drifted apart — the desk carries
   "Your buy box" and "Underwrite a list" that the dashboard does not. Should
   one rail serve both, or should a working screen carry a leaner rail than the
   hub by design? Answer deliberately either way.
