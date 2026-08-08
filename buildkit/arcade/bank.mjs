/* ══ THE BANKROLL ══════════════════════════════════════════════════════════
   One number, three cabinets, and it can go down.

   Until now the arcade had three incompatible currencies and not one of them
   could fall. The Exit Drill had no money at all — it scored in points and
   explained itself in "fit", a unit that exists nowhere in real estate. Daily
   Street handed you $150,000 that evaporated on refresh. Comp Run has a real
   save and offline earnings, but its bank only ever rises. A quiz that costs
   nothing is a quiz; nobody has ever felt they were learning a trade from a
   multiple-choice question with no stake.

   THE THING THE OBVIOUS DESIGN GETS WRONG. "One bankroll shared by all three"
   sounds right and breaks immediately on contact with the code. Comp Run's
   cash starts at $12, grows exponentially up an eight-rung ladder, and is
   RESET TO $12 on every prestige. Daily Street's houses cost $80,000 to
   $260,000. Wire those to the same variable and either Comp Run's first hour
   is trivial or Daily Street is unplayable. They are not the same kind of
   number and pretending otherwise would be the sort of tidy lie this product
   is built to avoid.

   SO: the bankroll is what you have taken OUT of the arcade, not what is in
   play inside it.

     · Daily Street plays WITH it. The street is where the money is at risk,
       because the street is the cabinet whose currency was already real-estate
       money. Win and it is yours; lose and it is gone, permanently.
     · The Exit Drill earns INTO it. A right read pays a finder's fee out of
       the room that exit actually had — you did not buy anything, you read it
       correctly, and reading correctly is worth a fee. Small, fast, capped
       daily. This is the lane you rebuild on after a bad street.
     · Comp Run pays INTO it at a prestige. A prestige is the moment an era's
       work is already being cashed out and reset — the natural seam, and
       taking the conversion there disturbs its balance not at all.

   Each cabinet keeps its own physics. There is still one number to care about.

   NO LOCKOUT. A player who tanks is not shut out: Daily Street already models
   leverage (bid above your capital and you pay points on the borrowed part),
   so a thin bankroll makes every deal more expensive rather than impossible.
   That is both kinder and truer than a velvet rope. The floor is zero — a
   negative bankroll is a number nobody can act on. */

export const BANK_KEY   = 'ni.bank.v1';
export const START      = 150000;   // what Daily Street always started a run with
export const DRILL_DAY_CAP = 12000; // the rebuild lane is a lane, not a printer
export const LEDGER_MAX = 40;

/* Comp Run's cash is exponential idle-game currency; its `rep` is the career
   figure that survives a prestige, and `bankable()` hands it a FRACTION —
   about 0.85 for a full climb to the top of an era, less for a quick one.

   So the rate is per unit of that fraction, pinned against the street: a full
   era banks about $42,500, which is a good street's work, and a hurried
   crossing banks proportionally less. An era of Comp Run should be worth
   roughly a good day on the street — neither cabinet should be the obvious
   way to farm the other. */
export const REP_TO_CASH = 50000;

export const GAMES = ['street', 'drill', 'comprun'];

const num = (v, d = 0) =>
  (typeof v === 'number' && Number.isFinite(v)) ? v : d;
const int = (v, d = 0) => Math.round(num(v, d));
const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';

export function fresh(){
  return { v:1, cash: START, best: START, low: START, staked: 0, earned: 0,
           ledger: [], runs: { street:0, drill:0, comprun:0 },
           drillDay: '', drillToday: 0, opened: 0 };
}

/* Everything typed on the way in. localStorage is writable by anything that
   ever ran on this origin — including the player with a console open — and a
   bankroll is exactly what somebody would edit. Typing it here does not stop
   a determined cheat (nothing client-side can), but it does stop a corrupt or
   hand-edited value from crashing a cabinet or minting Infinity. */
export function clean(d){
  const b = fresh();
  if (!d || typeof d !== 'object') return b;
  b.cash    = Math.max(0, Math.min(1e12, int(d.cash, START)));
  b.best    = Math.max(b.cash, Math.min(1e12, int(d.best, b.cash)));
  b.low     = Math.max(0, Math.min(b.best, int(d.low, b.cash)));
  b.staked  = Math.max(0, Math.min(1e12, int(d.staked, 0)));
  b.earned  = Math.max(0, Math.min(1e12, int(d.earned, 0)));
  b.opened  = Math.max(0, Math.min(1e6,  int(d.opened, 0)));
  b.drillDay   = str(d.drillDay, 10);
  b.drillToday = Math.max(0, Math.min(DRILL_DAY_CAP, int(d.drillToday, 0)));
  if (d.runs && typeof d.runs === 'object')
    for (const g of GAMES) b.runs[g] = Math.max(0, Math.min(1e6, int(d.runs[g], 0)));
  if (Array.isArray(d.ledger))
    b.ledger = d.ledger.slice(-LEDGER_MAX).filter(x => x && typeof x === 'object')
      .map(x => ({ g: GAMES.includes(x.g) ? x.g : 'street',
                   d: int(x.d, 0), t: int(x.t, 0), n: str(x.n, 90) }));
  return b;
}

/* ── the one mutation ──────────────────────────────────────────────────────
   Every change to the money goes through here, so there is exactly one place
   that can move it and exactly one place to read to know what may. Returns a
   NEW bank plus what actually happened — `applied` can differ from `delta`
   when the floor or the daily cap bites, and the caller is told rather than
   quietly given a different number than it asked for. */
export function settle(bank, { game, delta, note, day, at }){
  const b = clean(bank);
  const g = GAMES.includes(game) ? game : 'street';
  let d = int(delta, 0);
  let capped = false;

  /* the drill's daily cap. It pays out, so it is the one that could be farmed
     — sixty seconds a go, all night. It stays playable and stops paying. */
  if (g === 'drill' && d > 0){
    const key = str(day, 10);
    if (b.drillDay !== key){ b.drillDay = key; b.drillToday = 0; }
    const room = Math.max(0, DRILL_DAY_CAP - b.drillToday);
    if (d > room){ d = room; capped = true; }
    b.drillToday += d;
  }

  /* the floor. A bankroll below zero is a number nobody can act on. */
  const before = b.cash;
  b.cash = Math.max(0, before + d);
  const applied = b.cash - before;

  if (applied > 0) b.earned += applied; else b.staked += -applied;
  b.best = Math.max(b.best, b.cash);
  b.low  = Math.min(b.low,  b.cash);
  /* ── A LEDGER ROW IS A RECORD OF MONEY MOVING ──────────────────────────
     This read `applied !== 0 || note`, and the drill always sends a note. So
     once the daily cap was reached — which the drill invites, it says so on
     the card: "it still plays, it stops paying until tomorrow" — every further
     answer pushed a $0 row and evicted a real one from a forty-row window.

     Sixty capped answers and the whole ledger is sixty identical "$0 · read
     the flip on 12 Elm" lines: the street you won and the era you banked are
     both gone, replaced by play that moved nothing. The arcade hub's "where
     the money went" panel is the only audit trail the arcade has.

     A note is a description OF a movement, not a reason to record one. */
  if (applied !== 0)
    b.ledger = [...b.ledger, { g, d: applied, t: int(at, 0), n: str(note, 90) }].slice(-LEDGER_MAX);
  return { bank: b, applied, capped, floored: applied !== d };
}

export function noteRun(bank, game){
  const b = clean(bank);
  const g = GAMES.includes(game) ? game : 'street';
  b.runs[g] += 1;
  return b;
}

/* ── what the drill pays ───────────────────────────────────────────────────
   A right read is worth a fee, not a profit: you did not buy the house, you
   said what it was for. So the fee is a slice of the room that exit actually
   had, floored so a thin deal still pays something for being read right and
   capped so one fat deal is not the whole session.

   A wrong read costs. It costs LESS than the fee a right one pays, because
   being wrong on paper is cheap and being wrong with a cheque is not — the
   drill is where you are supposed to be wrong. */
export const DRILL_FEE_PC  = 0.03;
export const DRILL_FEE_MIN = 250;
export const DRILL_FEE_MAX = 3000;
export const DRILL_MISS    = 400;

export function drillFee(room){
  const r = num(room, 0);
  if (!(r > 0)) return DRILL_FEE_MIN;
  return Math.round(Math.max(DRILL_FEE_MIN, Math.min(DRILL_FEE_MAX, r * DRILL_FEE_PC)) / 50) * 50;
}

/** What a Comp Run prestige is worth banked. `rep` is the run's contribution
 *  to the career figure, which is already what that cabinet counts as an era's
 *  work — so this converts rather than invents. */
export function prestigeValue(rep){
  return Math.max(0, Math.round(num(rep, 0) * REP_TO_CASH));
}

/* ── how the number reads ──────────────────────────────────────────────────
   The arcade earns the right to mention the desk only once there is a figure
   worth mentioning. Under that, the line would be a sales pitch attached to
   nothing, which is the kind of thing that makes a person stop trusting a
   page. */
export const FUNNEL_AT = 400000;

export function standing(bank){
  const b = clean(bank);
  const up = b.cash - START;
  return {
    cash: b.cash, best: b.best, low: b.low, up,
    /* "through the arcade" is gross, not net — it is the honest way to say
       how much of this you have actually handled */
    through: b.earned,
    runs: b.runs.street + b.runs.drill + b.runs.comprun,
    broke: b.cash <= 0,
    thin: b.cash > 0 && b.cash < START * 0.25,
    /* earned the mention: you are up, and you are up by something real */
    funnel: b.cash >= FUNNEL_AT && up > 0,
  };
}

/* ── the only thing that touches disk ──────────────────────────────────────
   Everything above is pure, so it runs under node and is unit-tested. This is
   the browser half, guarded so the tests never reach it. One reader, one
   writer, and no cabinet is allowed its own: three games writing a shared key
   by three different routes is how a shared number stops being shared. */
/* ── AND THE THREE WAYS DISK LIES ──────────────────────────────────────────
   All three used to produce the same answer — a fresh $150,000 bankroll —
   and none of them told anybody:

     · THERE IS NO KEY. A new player. $150,000 is exactly right.
     · THERE IS A KEY AND IT WILL NOT PARSE. Somebody's money is in there and
       we cannot read it. Handing back $150,000 is a guess, and the next write
       — one drill answer, anything — overwrites the blob, so a recoverable
       corruption became unrecoverable inside one page load. A player at
       $612,000 finished the day at $150,250 and the original was gone.
     · WE CANNOT WRITE AT ALL. Private browsing, blocked site data, a full
       quota. `write` swallowed the exception and returned the bank as though
       it had persisted, so the drill's end card said "This run paid +$3,250"
       directly above "Your bankroll is $150,000", and the daily cap never
       engaged because drillToday never persisted — an unbounded lane that
       paid nothing.

   So `read` reports WHY, `write` reports WHETHER, and an unreadable blob is
   never overwritten: the money stays on disk where somebody could still get
   it back, and the cabinet says so instead of quietly starting again. */
export const BANK = {
  /** { bank, why } — why is 'ok' | 'new' | 'unreadable' | 'nostore' */
  readState(){
    if (typeof localStorage === 'undefined') return { bank: fresh(), why:'nostore' };
    let raw = null;
    try { raw = localStorage.getItem(BANK_KEY); } catch(e){ return { bank: fresh(), why:'nostore' }; }
    if (!raw) return { bank: fresh(), why:'new' };
    try { return { bank: clean(JSON.parse(raw)), why:'ok' }; }
    catch(e){ return { bank: fresh(), why:'unreadable' }; }
  },
  read(){ return this.readState().bank; },
  /** true when it is actually on disk. Callers that move money must check. */
  write(b){
    if (typeof localStorage === 'undefined') return false;
    try { localStorage.setItem(BANK_KEY, JSON.stringify(b)); return true; }
    catch(e){ return false; }
  },
  /** Move the money and persist it. Returns the same shape settle() does, plus
   *  `stored`, so a caller can tell the player when the floor or the daily cap
   *  bit AND when the number on screen is not the number on disk. */
  move(o){
    const s = this.readState();
    /* refuse to write over money we could not read. A cabinet that cannot
       read the bankroll must not be the thing that destroys it. */
    if (s.why === 'unreadable')
      return { bank: s.bank, applied: 0, capped: false, floored: false,
               stored: false, why: 'unreadable' };
    const r = settle(s.bank, { at: Date.now(), day: today(), ...o });
    r.stored = this.write(r.bank);
    r.why = r.stored ? 'ok' : 'nostore';
    return r;
  },
  run(game){ const b = noteRun(this.read(), game); this.write(b); return b; },
  standing(){ return standing(this.read()); },
  /** Is the bankroll on screen the bankroll on disk? Cabinets ask at boot. */
  trouble(){ const w = this.readState().why;
    return w === 'unreadable' || w === 'nostore' ? w : null; },
  /** Opening a cabinet is not a run, but it is worth knowing somebody looked. */
  opened(){ const b = this.read(); b.opened += 1; this.write(b); return b; },
};
/* One sentence, so all three cabinets say the same thing about the same
   problem. A player whose money is not being saved is owed the reason and, in
   the unreadable case, the fact that it has NOT been thrown away. */
export function troubleLine(why){
  if (why === 'unreadable')
    return 'Something is stored under this arcade’s bankroll and this browser cannot read it, '
         + 'so nothing is being saved right now. It has not been overwritten — whatever is in '
         + 'there is still in there.';
  if (why === 'nostore')
    return 'This browser is not letting the arcade save anything, so the bankroll will not '
         + 'survive a reload. Private browsing and blocked site data both do this.';
  return '';
}

export function today(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

export function money(n){
  const v = Math.round(Math.abs(num(n, 0)));
  return (num(n,0) < 0 ? '−$' : '$') + v.toLocaleString('en-US');
}
export function signed(n){
  const v = num(n, 0);
  return (v > 0 ? '+' : v < 0 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
}
