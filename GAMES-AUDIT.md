# GAMES-AUDIT.md — the arcade, played as a stranger

Method: every game driven fresh with Playwright against the shipped build
(`bf6f0a8bb429`), screens read before code. The bar, per the owner: *each game a
full standalone game people could play for hours, even with no real-estate
background.* Sizes: S = copy/one control · M = one component · L = new mode.

## Shipped already (found during this audit, live in batches 75–76)

1. ✅ **Exit Drill had no visible way forward** after a verdict — "Space or
   click" in the faintest text, no spacebar on phones. Real 44px "Next house →"
   button now, both verdict branches. *(S — batch 76)*
2. ✅ **The dashboard's arcade card printed Comp Run's empire millions as
   "Cash."** Two currencies, one label. It reads the shared $150k bankroll now,
   labelled, with best-ever and runs. *(S — batch 76)*
3. ✅ **Era captions were antialiased text on a pixelated canvas** — grey mush
   at any zoom. 3×5 bitmap font now. *(S — batch 75)*
4. ✅ **"Kerb appeal"** and 39 other Britishisms. *(S — batch 75)*

## Corrections to this audit — FOUR of seven findings were over-called

Implementing this audit was also a test of it, and it did not do well. Four
of the seven findings described a gap the product did not have. The cause is
the same in every case: I ranked them from a partial playthrough and
**inferred** what the other states did instead of driving them. The findings
that survived were the ones I had actually watched.

Recorded here rather than quietly deleted, because an audit whose misses are
invisible is worse than no audit — the next one should be read knowing this
one was 3-for-7 on first pass.

- **F2 "right answers teach less than wrong ones"** — WRONG. `working()` is
  called in BOTH verdict branches: a correct answer already shows the full
  ledger, every exit's ceiling and the arithmetic. I had only ever driven a
  wrong answer when I wrote the finding.
- **F5 "era transitions arrive without ceremony"** — WRONG. There is a
  5.5-second animated crossing (`drawTransition`) and a named arrival that
  writes the era and its note into the file. *(One real crumb inside it was
  fixed — see below.)*
- **F4 "ARV appears unglossed"** — WRONG. `ARV` appears exactly once in
  daily-street.html, inside a code comment. Never shown to a player. The rule
  of the game is already the title screen's headline.
- **"the broke state is only explained on the hub"** — WRONG. The Daily
  Street's title screen already carries the road back.

Two of the S-fixes I listed were **already handled in the product** — the
audit over-called them, and saying so is cheaper than shipping a change
nobody needed:

- **"ARV appears unglossed" (was F4)** — WRONG. `ARV` appears exactly once in
  daily-street.html, inside a code comment. It is never shown to a player.
  The rule of the game is already stated plainly on the title screen: *"Buy a
  house for less than it is worth. Fix what is worth fixing. Keep the
  difference."*
- **"the broke state is only explained on the hub"** — WRONG. The Daily
  Street's own title screen already carries it: *"Every house on the street
  is borrowed money now... The drill pays a fee for a right read — that is
  the way back."*

**F6 was real and is now fixed** (batch 79): only the hub said the bankroll
is shared. The Daily Street's entry screen now names it ("it is the same
bankroll in all three games on the floor") and Exit Drill's HUD labels its
figure "Bankroll · the floor's".

## The reset question — answered by what already exists

Owner suggestion: a reset button for arcade cash. **Recommend: no free reset,
and no work needed.** The design already has the road back — the hub's broke
state says it: *"You are cleaned out. The drill pays a fee for every read you
get right — that is the way back."* Exit Drill pays a finder's fee into the
bankroll on every correct answer, so a busted player earns back by getting
good, which is the whole teaching loop. A free reset would delete the stakes
that make the floor mean anything. **One S-fix worth making instead:** the
broke state is only explained on the hub — Daily Street's PLAY screen should
say the same sentence when the bankroll can't cover a street, with a "Run the
drill →" link. Today a broke player inside Daily Street has to find out why
they can't play. *(S)*

## Findings still open, ranked

### F1 · ~~Daily Street's offer instrument~~ — SHIPPED (batch 78)
Three bars became one axis where every distance is money; the band's width IS
the unchecked repair bill, and the button that narrows it lives in the
readout. The design pass also found a real honesty bug on the way — a loss
printed as a gain, because the money formatter used Math.abs (batch 77).

### F2 · ~~Exit Drill: right answers teach less than wrong ones~~ — WITHDRAWN
Driven to an actual correct answer: the full teardown is already there.

### F3 · ~~Exit Drill: no run shape~~ — TWO-THIRDS OVER-CALLED, then SHIPPED (batch 81)
Driven with `_tloop.mjs` before writing the brief, and the finding did not
survive contact:

- **"no difficulty ladder"** — WRONG. Doors per house across one run:
  `5,5,5,6,6,6,8,8,8`, hints off at the top tier, position closing doors from
  house seven. A good ramp.
- **"no ladder"** — WRONG. Six ranks with lore, persisted, drawn below the
  game with your rung marked, and the end card names the gap to the next.
- **"no daily"** — RIGHT, and it was the whole finding.

What was actually wrong was sharper: **the ladder was a plaque, not a door.**
`tierFor()` read the house number and nothing else, so a Closer opened on five
doors with hints on, every run, forever — while a comment in the source
claimed *"somebody on their fortieth run never sees five."* The comment
described a feature the code did not have.

Shipped in batch 81: **The Ten** (ten houses seeded from the date, the same
ten for everybody, twenty seconds a house, a timeout is a miss and not the
end), the street's record shape (`ni.drill.v1`), a share grid that carries
speed as well as accuracy, and `rankStep()` — which makes the comment true.
Full spec and the driven evidence: `DAILY-DRILL-BRIEF.md`. Harness:
`_tdaily.mjs`, 28 assertions, proved red against the pre-fix seed.

### F4 · ~~Daily Street: jargon at first contact~~ — WITHDRAWN
Checked against the source while implementing: ARV is never shown to a
player, and the rule of the game is already the title screen's headline. See
the corrections at the top.

### F5 · ~~Comp Run: silent era transitions~~ — MOSTLY WITHDRAWN, one crumb fixed
The ceremony exists: a 5.5-second animated crossing and a named arrival. The
one real gap was that the arrival named the YEAR but not the HOUR the skies
pass had just given every era — the same fact told in two places, one of them
silently. The arrival now reads "The Industrial Age — noon behind smoke."
*(batch 80)*

### F6 · ~~Cross-game currency legibility~~ — SHIPPED (batch 79)
The Daily Street's entry screen names the shared floor, and Exit Drill's HUD
labels its figure "Bankroll · the floor's".

### F7 · ~~Daily Street: looks don't feel scarce~~ — SHIPPED (batch 80)
Real, and confirmed: spending a look was a silent full re-render. The HUD
counter now holds its old value, counts down through it and takes the warning
colour for the length of the count. Reduced-motion goes straight to the
number.

## What is already excellent and must not be broken

The wrong-answer teardowns in Exit Drill; the sealed-bid tension and daily
seeds in Daily Street; Comp Run's opening arc and era palettes (now with
hours); the one-bankroll economy with drill-fee earn-back; the honesty rules
everywhere — no invented figures, samples labelled, colour law held.

## The scoreboard on this audit

**Seven findings. Three were right as written, one was a third right, three
were wrong.** Every miss has the same cause and it is recorded twice in this
document now: a finding written from a partial playthrough, inferring the
states I had not driven.

The correction that matters for the next audit: **F3 was the finding I was
most confident in, and it was the one I had driven least.** The two thirds of
it that were wrong took four minutes to disprove with a harness — less time
than I spent writing them down. Drive the state first. Every time.

## What is actually left

**Nothing on this list.** Everything is shipped or withdrawn.

The next question is no longer an audit question. The Ten now gives the drill
a reason to come back tomorrow; whether anyone does is a thing to watch in the
numbers, not to reason about. The honest next move is to let real players hit
it and read what they actually do.
