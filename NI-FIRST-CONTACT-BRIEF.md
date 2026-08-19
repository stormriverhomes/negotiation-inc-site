# Claude Design brief — Negotiation Inc, the front door

Redesign of the two first-contact pages of negotiationinc.com: **the landing
page** (`index.html`) and **the pricing page** (`plans.html`). Same product,
same tokens as the Negotiation Inc documents you have already produced (the
dashboard, the Land Desk, the Daily Street range instrument). This is the
biggest one: it is the first thing every stranger sees.

## The problem, in the owner's words

> "People who check it out have no idea what to look at, it makes no sense to
> them. The text is too dense, looks AI generated, and isn't intuitive to
> someone who doesn't already know about real estate. They're not immediately
> seeing how valuable this is."

## The problem, measured (screenshots attached)

- `aud-index-band1/2/3.png` — the landing page, all 6,764px of it.
  **1,471 words.** Six sections at identical visual volume, each the same
  recipe: serif headline, 60–80-word paragraph, card grid. 21 em-dashes.
- `aud-phone-hero.png` — the phone first screen is **text only**; the live
  demo card is a full screen below the fold. 11,405px tall in total.
- `aud-plans-hero.png` — the pricing page. **3,862 words, 120 em-dashes**,
  18,087px on a phone. Four tier cards each carrying 7–9 checklist items of
  15–30 words.
- `aud-full-demo.png` — the demo page, for reference: the best page in the
  funnel and mostly NOT in scope. Cards, pictures, numbers, one door each.

## What the product actually is (so the page can finally say it)

A worksheet that answers one question: **what is the most you can pay for a
house?** You type four numbers off any listing (asking price, what it sells
for fixed up, repairs, rent). It prices the house under each of the eight
ways investors make money — flip, rent out, resell the contract, and five
more — shows every step of the arithmetic, and tells you which way pays most
*for this seller*. Free, no account, nothing leaves the browser. Paid tiers
remove the typing (photos → condition, comps pulled on our key, lender
packet). $0 / $39 / $129 / $249.

The one fact that makes strangers care, already live in the hero specimen:
**the same house, priced two right ways, differs by $9,140.** Pick the wrong
way out and you lose the margin before you ever make an offer.

## Diagnosis to design against

1. **No hierarchy of moments.** Nothing says "look here first." Every screen
   must have exactly one moment; everything else on that screen is caption.
2. **The proof is buried under the essay about the proof.** The hero card IS
   the product, live — and it looks like a static form while 1,471 words
   explain it. Invert: the page is a demonstration with captions, not an
   argument with an illustration.
3. **Insider grammar at first contact.** ARV, BRRRR, novation, "exits",
   ENTERED — eleven terms, none taught. The product is never even named: the
   lede's word for it is "it". A stranger cannot say what category of thing
   they're looking at.
4. **Aphorism wallpaper — the AI tell.** Every caption is an epigram ("The
   subtraction, taken seriously", "The flip that refuses to sell"). Ration:
   ONE per screen, and every other line is a plain declarative sentence a
   tired person understands on first read.
5. **Nobody vouches.** No number, no person, no external fact anywhere.

## The ask

### Screen 1 · `index` — the landing page, redesigned (the main event)

A proposed skeleton to react against — improve it where you see further:

1. **HERO — the specimen leads.** On desktop, card right, words left; on the
   phone the card comes FIRST. Headline stays (it is the best line on the
   page): *"What should you pay for this house?"* New lede, ≤20 words, plain,
   naming the thing: *"A free worksheet. Type four numbers from any listing —
   it shows the most you can pay, eight different ways."* One primary CTA.
   The card must LOOK ALIVE at a glance: the exit pills styled as the
   interactive controls they are, one pill pulsing once on load, the
   instruction in readable type: **"Tap an exit — the price changes."** Kill
   the riddle ("Three price. Two want a figure…"). The trust line ("Free ·
   no account · nothing leaves your browser") promoted from fine print to a
   legible strip.
2. **THE $9,140 MOMENT.** One screen, one fact: the same four numbers, two
   right answers, $9,140 apart. Promote the spread diagram (currently buried
   at 2,400px — see band 2, it's good) to be this screen's visual. This is
   the "why do I care" and it deserves the loudest treatment on the page.
3. **HOW IT WORKS — three steps, three product screenshots** (they exist:
   the build screenshots the running product). Each step ≤12 words.
4. **WHO IT'S FOR — four jobs, one plain line each.** No card-grid of
   epigrams. "Wholesaling: know your number before you call." That register.
5. **THE ARCADE — one row.** The pixel doors art + one sentence + one link.
   It's the dessert, not a second thesis.
6. **THE PRICE — one line.** "Pricing is free forever. Plans from $39 remove
   the typing." One CTA. Done. Nothing else survives on this page.

**Word budget: ≤500 total.** Copy rules for every line you write: name the
actor ("the sheet" — one noun, held everywhere); teach a term in ≤4 words at
first use or don't use it; one em-dash per screen; one aphorism per screen;
no sentence over ~16 words; delete rather than compress.

### Screen 2 · `plans` — the pricing page, cut to a decision

Keep the four tiers and prices. The redesign: a **decision page, not a
contract**. $0 gets the visual crown it deserves (it's the differentiator —
"the calculator is free forever" — currently third in the row at equal
weight). One line under each tier naming WHO it is for; the 7–9-item
checklists become a compact compare table (rows = capabilities in plain
words, columns = tiers, check/dash), with at most one short sentence of
prose per tier. The "76 fields vs 3" comparison is a strong idea currently
drowned in its own annotation — keep it, halve its words. **Word budget:
≤900.** The FAQ prose blocks move behind disclosure or die.

## What must survive (the owner likes the elements — this is not a rebrand)

- The identity: ink-on-paper, the serif, the restraint, no webfonts beyond
  what ships today.
- The specimen card as the hero's engine, with its real numbers (1128 Marrow
  Lane, $184,500 / $291,000 / $41,300 → $191,140).
- The provenance chips: Entered / Estimate / Needed — but on the landing page
  they may only *appear*, not be *explained* (the explanation lives in the
  product).
- The colour law: green only for money that pays, red only for a refusal
  with a reason, gold only bankroll/premium. A negative number is never
  green.
- The pixel-art doors for the arcade row.
- The honesty stance, now in legible type: free, no account, nothing leaves
  the browser, every number shows its working.

## Honesty rules (non-negotiable, product-wide)

Every number on the page must be real and derivable from the specimen's four
inputs. No invented testimonials, no fake usage counts — if a vouching fact
is wanted, leave a clearly-marked slot for the owner to fill with a true one
rather than inventing it. Nothing labelled "live" that is a static image;
the screenshots section must keep saying screenshots.

## Deliverable

The usual `.dc.html` format (as with the Daily Street instrument): one
`<x-dc>` per screen, `data-screen-label` on each state, a `DCLogic` class
where interaction needs prototyping. Two screens: `index-redesign`,
`plans-redesign`. Desktop 1280 and phone 390 layouts for each. Include the
copy deck inline — the words are half this brief's deliverable, and they
must obey the budgets above.
