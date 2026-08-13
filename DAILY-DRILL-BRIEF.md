# The Daily Drill — implementation brief

`exit-drill.html`. The last finding standing from GAMES-AUDIT.md, restated
from a **driven** run rather than a remembered one — because that document's
own correction note says four of its seven findings were written from a
partial playthrough, and it would be a poor joke to repeat the mistake on the
one survivor.

Harness of record: `_tloop.mjs` (16/16). Everything below marked *driven* is
something that harness watched happen.

---

## F3 was over-called too. Here is what is actually true.

The audit said: *"no ladder, no unlock, no daily."* One of those three is
right.

**There IS a difficulty ladder, and it works** *(driven)*. Doors per house
across one run: `1:5 2:5 3:5 4:6 5:6 6:6 7:8 8:8 9:8`. Hints on for the first
six houses, off at the top tier, and by house seven a line about your position
closes some doors. That is a good ramp and nothing about it needs changing.

**There IS a rank ladder, and it persists** *(driven)*. Six ranks with lore,
`0 / 450 / 900 / 1,500 / 2,300 / 3,200`, drawn below the game with your
current rung marked, and the end card tells you the gap to the next one.

So two-thirds of the finding was wrong. What is actually wrong is sharper and
more embarrassing, because the source already claims to have fixed it:

> ```js
> /* Difficulty arrives inside the run, not across sessions: house one is five
>    doors, and by house eight it is all eight plus a position that closes some
>    of them. A first-timer is never shown nine buttons; somebody on their
>    fortieth run never sees five. */
> ```

**The last sentence is false.** `tierFor()` reads `G.house` and nothing else
*(driven: `tierReadsBest === false`)*. Somebody on their fortieth run sees five
doors with hints on, every run, forever. The comment describes a feature the
code does not have.

And the memory is one integer:

- Mid-run, nine houses in, the drill has stored **nothing** of the run *(driven)*.
  Close the tab at fifty-five seconds and it never happened.
- After the run, the drill's entire persistence is `ni-drill-best` → `"140"`
  *(driven)*. A bare number. No day, no streak, no accuracy history, no count
  of houses ever read.
- Two openings of the drill give two different houses *(driven)*: seeded from
  `Date.now()`. There is no shared day, so there is nothing to compare and
  nothing to post.

Compare the street, which has had this the whole time *(driven)*:
`{ v, days, streak, best, bestDay, played, last }`.

**The honest F3, restated:** *Exit Drill's ladder is a plaque, not a door, and
its memory is one integer. There is no day, so there is no tomorrow.*

---

## The design

Two modes that are genuinely different, not one mode twice.

### The Minute — unchanged
Random houses, sixty seconds, wrong costs five, score attack, BEST. This is
practice, and it is already good. **Do not touch the loop.**

### The Ten — new
Ten houses from **today's seed**, the same ten for everybody, everywhere.

**Why ten fixed houses and not sixty seconds.** A sixty-second run answers a
variable number of houses, so two players never face the same set and the
scores are not comparable — which kills the only thing a daily is for. The set
must be fixed. So the clock moves from the run to the house.

| | The Minute | The Ten |
|---|---|---|
| Houses | as many as you can | exactly 10, everyone's the same |
| Clock | 60s across the run | **20s per house**, shown |
| Running out | ends the run | **misses that house, run continues** |
| Wrong | −5 seconds | costs the fee, as today |
| Ramp | h1–3 five doors, h4–6 six, h7+ eight | h1–3 five, h4–7 six, h8–10 eight |
| Keeps | BEST | the day record |

Twenty seconds is deliberate: long enough to actually read the seller line,
short enough that the eighth house with all eight doors open is a real
question. Worst case the run is 3m20s — the same length as a Daily Street run,
which is the cabinet next to it.

**A timeout is a miss, and a miss still teaches.** The full `working()`
teardown shows on a timeout exactly as it does on a wrong answer. A player who
freezes on house four learns the most of anybody in the building.

### One attempt counts
The street's rule, unchanged, because a product with two different daily rules
is the same defect as two currencies with one label: **the first finish of the
day is the one that goes on the record.** Replay as much as you like; the
screen says so; nothing overwrites.

### The record — `ni.drill.v1`
Field-for-field the street's shape. Not similar. The same.

```js
{ v:1, days:{ '2026-08-13': { score, right, secs } },
  streak:0, best:null, bestDay:null, played:0, last:null }
```

`ni-drill-best` stays exactly where it is and keeps meaning what it means —
the best **Minute**. The Ten's best is its own field. Two modes, two numbers,
neither borrowing the other's label.

### The share line
The street's grammar, one family, four glyphs that already mean these things:

```
Negotiation Inc — Drill 229
🟩🟨🟥🟩🟩⬜🟩🟩🟨🟩
8/10 · 1,240 · 2m 41s · day 6
```

- 🟩 called it right, inside the bonus window
- 🟨 called it right, slow
- 🟥 called it wrong
- ⬜ ran out of time

The grid encodes speed *and* accuracy in one row, which is more than the
street's does. Day number comes from the street's `dayNumber()` epoch, so
**Street 229 and Drill 229 are the same day** — the floor has one calendar.

### The ladder becomes a door
`tierFor(G.house)` → `tierFor(G.house + rankStep(best))`, where an earned rank
raises the tier you *open* on:

| Rank | Opens at |
|---|---|
| Door-knocker · Bird dog | five doors, hints on |
| Apprentice · Underwriter | six doors |
| Closer · The Desk | all eight, hints off, from house one |

One line of code, and it makes the comment quoted above true. It is also the
only reward in the cabinet that is a *door* rather than a *plaque* — every
other thing a rank does is print a nicer word.

### Two lines on the end card
From the record, which will finally exist: **the day streak** and **yesterday**.
"Day 6 in a row" is the strongest retention sentence this genre has, and it is
four fields away.

---

## What this is not

**Not a Claude Design job.** Design earned its keep on the range instrument
and the Land Desk because those were *visual* misreads — a player looking at a
correct screen and drawing a wrong conclusion. Nothing here is a misread. The
screens are right; there is no day behind them. This is seed, record, share
string, one tier offset. Assembly.

**Not a Fable job either.** The only genuinely tricky judgement is the
20s/ramp/tiebreak balance, and that is a thing to tune against a played run,
not to reason about in advance.

---

## Order of work

1. `dayNumber()` and a date-hashed seed in the drill — the street's epoch, copied.
2. Mode select on the door: **The Ten** first, **The Minute** second.
3. The Ten's loop: per-house clock, timeout-as-miss, ten and stop.
4. `ni.drill.v1`, first-finish-of-the-day, streak.
5. Share line + copy button, the street's glyph family.
6. `rankStep()` — the plaque becomes a door.
7. Streak and yesterday on both cards.
8. `_tdaily.mjs`: two browsers, same date, **same ten houses**; a replay does not
   move the record; a timeout scores a miss and still shows the teardown; a
   Closer's first house is eight doors.

## The honesty checks this must pass

- Green only where money pays. A right read pays a finder's fee into the
  bankroll, so 🟩 is earned; it is not decoration for "correct".
- The Ten's best and the Minute's best never share a label.
- If the day's record was already set, the screen says so **before** you play,
  not after.
- A run that is not being stored must not print a record as though it were —
  the drill already gets this right for the bankroll (`troubleLine`), and the
  same rule now applies to the day.
