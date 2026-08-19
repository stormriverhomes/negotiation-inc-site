# FIRST-CONTACT-AUDIT.md — the funnel, read by a stranger

The feedback, verbatim: *"people who check it out have no idea what to look at,
it makes no sense to them"* — text too dense, reads as AI-generated, and the
value never lands for somebody who does not already work in real estate.

Method: every page driven fresh with Playwright at 1280px and 390px, and
**measured** before judged — words above the fold, total words, position of the
first pressable thing, sentence statistics, jargon counts (`_stranger.mjs`).
Audit ran against the local prelaunch-stage build; the live site differs only
in the two staged blocks (email capture vs live checkout CTAs) — every
structural finding applies to both.

## The numbers

| page | words | page height (phone) | first thing to DO | above-fold words (phone) |
|---|---|---|---|---|
| index | **1,471** | **11,405px** | Sign in (nav) | 124 |
| plans | **3,862** | **18,087px** | Sign in (nav) | 129 |
| demo | 600 | 4,234px | 3,914px down | 114 |
| arcade | 349 | 2,683px | 834px | 111 |
| daily-street | 170 | 931px | 671px | 98 |

For calibration: Stripe's homepage runs ~700 words; Linear's ~400. The
landing page is a **1,471-word essay**, and the pricing page is a
**3,862-word contract**. The games — which had real design passes — are
lean. The funnel pages never got one. This *is* the redesign's scope.

The AI-tell, quantified: **21 em-dashes on index, 120 on plans.** The word
"refuses/refusal" appears 5 times on index and 8 on plans. Every card caption
is a polished epigram. One aphorism is a voice; thirty is wallpaper, and
wallpaper made of aphorisms is exactly what machine-written copy looks like.

## Ranked findings

### F1 · The page has no hierarchy of moments — "no idea what to look at" is literal
Six sections at identical visual volume, each the same recipe: serif
headline, 60–80-word paragraph, card grid. Repeated to 6,764px. Nothing on
the page says *this one thing first*. A stranger's eye does a lap and gives
up. **This is the root finding; most others are symptoms.**

### F2 · The proof is buried under the essay about the proof
The hero's specimen card is the entire pitch — a real house, a live green
number, tap an exit and the answer changes. And it is presented as a static
form: the instruction to touch it is set in 8px caps inside the card
("The eight exits — tap one. **Three price. Two want a figure. Two say not
this house.**" — a riddle, not an instruction), while 1,471 words *around*
the card explain what the card would show if touched. On the phone the card
is a full screen below the fold; the first screenful is text only. The page
argues; the product demonstrates. Invert it.

### F3 · Insider grammar at first contact
The stranger's first screen contains: ARV, BRRRR, Subject-to, Novation,
Wholetail, "exits", FORM D-1, ENTERED/ESTIMATE. Eleven jargon terms on index,
four of them inside the first viewport, none glossed at first use. The
product's own interior pages may speak its language; the front door may not.
The lede's first word for the product is **"it"** — "Tell it four things" —
and "it" is never named. The stranger cannot even say what category of thing
they are looking at.

### F4 · Aphorism density — the "AI generated" tell
"The subtraction, taken seriously." "The number the lender underlines."
"The flip that refuses to sell." "You bought the payment, not the price."
"The number nobody publishes." — every one of these is good, and together
they are fatal, because *none of them carries information a stranger can
use*. Eight exit tiles, eight riddles, zero facts. The plans page does it
for 3,862 words. When every sentence performs, the reader stops believing
any sentence was written for them.

### F5 · Nobody and nothing vouches
No usage number, no testimonial, no named person, no "priced 40,000 houses."
The page makes 100% of its own case in its own voice — which compounds F4:
confident, ornate, and unwitnessed is precisely the AI-generated register.
Even one honest external fact would change the temperature.

### F6 · The pricing page is a second essay
3,862 words; four tier cards each carrying 7–9 checklist items of 15–30
words. The $0 tier — the single strongest fact the company has — is the
third thing in the row, visually equal to the rest. 120 em-dashes.

### F7 · Two CTAs, equal weight, no verb hierarchy
"See how it works" vs "Price your own property" — a stranger cannot rank
them (look at what? price with what?). Every section re-offers both. The
demo page then opens with its *own* riddle headline ("Five houses, and one
piece of dirt.") but is otherwise the best page in the funnel: pictures,
numbers, one door per card.

## What is right and must survive the redesign
The identity: ink-on-paper, the serif, the restraint. The specimen card as
the hero's engine. The spread diagram ($36,740 between best and worst exit —
the best single visual argument the site has, currently buried at 2,400px).
The provenance chips (Entered / Estimate / Needed). The colour law. The
pixel-art doors. The honesty stance — "free, no account, nothing leaves your
browser" is a real differentiator; it just reads as legal fine print where
it currently sits.

## Verdict
Not a rebrand — a **re-hierarchy and a rewrite**. One moment per screen, the
demo promoted over the essay, the essay cut to captions, the jargon taught
or cut, the aphorisms rationed, and one human fact. Index target: **≤500
words**. Plans target: **≤900**. The brief for Claude Design is
`NI-FIRST-CONTACT-BRIEF.md`.
