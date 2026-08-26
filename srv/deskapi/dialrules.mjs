/* ══ MAY WE DIAL THIS NUMBER, RIGHT NOW? ═══════════════════════════════════
   One pure function answers it, and the dial button is wired to nothing else.
   That is the whole design: there is no code path in the product that places
   a call without asking this first, because the button is disabled by its
   answer rather than checked against it.

   WHY THIS IS THE FIRST THING BUILT, BEFORE THE PHONE ITSELF.
   TCPA statutory damages are $500 a call, $1,500 if a court finds it willful,
   and the plaintiff's bar in this space is organised and fast. Texas SB140
   added $5,000 per violation with a private right of action; Florida's FTSA
   and Oklahoma's OTSA define an autodialer broadly enough that equipment
   which is fine federally is not fine there. A wholesaler cold-calling
   homeowners is calling cell phones with no consent on file — which means
   the only defences that hold are WHEN you called, HOW OFTEN, and whether
   you honoured the list. Those are exactly the three things below.

   Compliance built into the schema and the button is also the marketing:
   every operator running a dialer is quietly frightened of this, and no
   incumbent sells them a product that refuses on their behalf.

   THE POSTURE, STATED ONCE:
     · The window is the CALLED PARTY'S local time, never the caller's.
     · Where the state is known but the timezone is not, and the state spans
       more than one, EVERY zone in it must be inside the window. We refuse
       in the ambiguous hour rather than guess in it.
     · Suppression is absolute and is checked first — a DNC hit or an opt-out
       is never weighed against anything.
     · Nothing here is legal advice and this file does not pretend to be a
       compliance department. It encodes the well-documented federal window
       and the four strictest state regimes, conservatively, and it is a
       floor rather than a ceiling.                                          */

/* ── the strict states ─────────────────────────────────────────────────────
   Federal is 8am–9pm local. These are narrower, so they win where they
   apply. `days` is indexed 0=Sunday … 6=Saturday; a null entry means no
   calling that day at all. `cap` is calls to one number in one local day. */
const FEDERAL = { start: 8, end: 21 };

export const STATE_RULES = {
  /* Florida FTSA — 8am–8pm, three calls a day to one number */
  FL: { days: [[8,20],[8,20],[8,20],[8,20],[8,20],[8,20],[8,20]], cap: 3,
        cite: 'Florida FTSA' },
  /* Oregon HB 3865 (Jan 2026) — 8am–8pm, three-call cap */
  OR: { days: [[8,20],[8,20],[8,20],[8,20],[8,20],[8,20],[8,20]], cap: 3,
        cite: 'Oregon HB 3865' },
  /* Texas SB140 — 9am–9pm Mon–Sat, noon–9pm Sunday */
  TX: { days: [[12,21],[9,21],[9,21],[9,21],[9,21],[9,21],[9,21]], cap: null,
        cite: 'Texas SB140' },
  /* Rhode Island — 8am–6pm weekdays; weekends fall back to federal */
  RI: { days: [[8,21],[8,18],[8,18],[8,18],[8,18],[8,18],[8,21]], cap: null,
        cite: 'Rhode Island' },
  /* Maine — 9am–9pm weekdays, 9am–5pm Saturday, no Sunday calling */
  ME: { days: [null,[9,21],[9,21],[9,21],[9,21],[9,21],[9,17]], cap: null,
        cite: 'Maine' },
};

/* ── where a state is, in time ─────────────────────────────────────────────
   Single-zone states carry one IANA name. The split states carry every zone
   they contain, and the rule above applies: all of them must be inside the
   window before the dial is allowed. Arizona is listed as Phoenix because it
   does not observe DST and getting that wrong is a whole hour of wrong. */
export const STATE_ZONES = {
  AL:['America/Chicago'], AK:['America/Anchorage','America/Adak'],
  AZ:['America/Phoenix'], AR:['America/Chicago'],
  CA:['America/Los_Angeles'], CO:['America/Denver'],
  CT:['America/New_York'], DE:['America/New_York'], DC:['America/New_York'],
  FL:['America/New_York','America/Chicago'], GA:['America/New_York'],
  HI:['Pacific/Honolulu'], ID:['America/Boise','America/Los_Angeles'],
  IL:['America/Chicago'], IN:['America/Indiana/Indianapolis','America/Chicago'],
  IA:['America/Chicago'], KS:['America/Chicago','America/Denver'],
  KY:['America/New_York','America/Chicago'], LA:['America/Chicago'],
  ME:['America/New_York'], MD:['America/New_York'], MA:['America/New_York'],
  MI:['America/Detroit','America/Menominee'], MN:['America/Chicago'],
  MS:['America/Chicago'], MO:['America/Chicago'],
  MT:['America/Denver'], NE:['America/Chicago','America/Denver'],
  NV:['America/Los_Angeles'], NH:['America/New_York'], NJ:['America/New_York'],
  NM:['America/Denver'], NY:['America/New_York'], NC:['America/New_York'],
  ND:['America/Chicago','America/Denver'], OH:['America/New_York'],
  OK:['America/Chicago'], OR:['America/Los_Angeles','America/Boise'],
  PA:['America/New_York'], RI:['America/New_York'], SC:['America/New_York'],
  SD:['America/Chicago','America/Denver'], TN:['America/New_York','America/Chicago'],
  TX:['America/Chicago','America/Denver'], UT:['America/Denver'],
  VT:['America/New_York'], VA:['America/New_York'],
  WA:['America/Los_Angeles'], WV:['America/New_York'],
  WI:['America/Chicago'], WY:['America/Denver'],
};

/* ── area code → state ─────────────────────────────────────────────────────
   The last resort, and marked as such in the result: a mobile number keeps
   its area code across a move, so this tells you where somebody GOT their
   phone, not where they are. Good enough to pick a window, never good enough
   to claim certainty — `precision:'areacode'` rides along so the UI can say
   so. Covers the NANP US states; anything unknown falls back to federal
   across the continental zones, which is the strictest honest answer. */
const AREA_STATE = {
  205:'AL',251:'AL',256:'AL',334:'AL',659:'AL',938:'AL',
  907:'AK', 480:'AZ',520:'AZ',602:'AZ',623:'AZ',928:'AZ',
  479:'AR',501:'AR',870:'AR',
  209:'CA',213:'CA',279:'CA',310:'CA',323:'CA',341:'CA',350:'CA',408:'CA',415:'CA',
  424:'CA',442:'CA',510:'CA',530:'CA',559:'CA',562:'CA',619:'CA',626:'CA',628:'CA',
  650:'CA',657:'CA',661:'CA',669:'CA',707:'CA',714:'CA',747:'CA',760:'CA',805:'CA',
  818:'CA',820:'CA',831:'CA',840:'CA',858:'CA',909:'CA',916:'CA',925:'CA',949:'CA',951:'CA',
  303:'CO',719:'CO',720:'CO',970:'CO',983:'CO',
  203:'CT',475:'CT',860:'CT',959:'CT', 302:'DE', 202:'DC',
  239:'FL',305:'FL',321:'FL',352:'FL',386:'FL',407:'FL',448:'FL',561:'FL',656:'FL',
  689:'FL',727:'FL',754:'FL',772:'FL',786:'FL',813:'FL',850:'FL',863:'FL',904:'FL',
  941:'FL',954:'FL',
  229:'GA',404:'GA',470:'GA',478:'GA',678:'GA',706:'GA',762:'GA',770:'GA',912:'GA',943:'GA',
  808:'HI', 208:'ID',986:'ID',
  217:'IL',224:'IL',309:'IL',312:'IL',331:'IL',447:'IL',464:'IL',618:'IL',630:'IL',
  708:'IL',730:'IL',773:'IL',779:'IL',815:'IL',847:'IL',872:'IL',
  219:'IN',260:'IN',317:'IN',463:'IN',574:'IN',765:'IN',812:'IN',930:'IN',
  319:'IA',515:'IA',563:'IA',641:'IA',712:'IA',
  316:'KS',620:'KS',785:'KS',913:'KS',
  270:'KY',364:'KY',502:'KY',606:'KY',859:'KY',
  225:'LA',318:'LA',337:'LA',504:'LA',985:'LA',
  207:'ME', 227:'MD',240:'MD',301:'MD',410:'MD',443:'MD',667:'MD',
  339:'MA',351:'MA',413:'MA',508:'MA',617:'MA',774:'MA',781:'MA',857:'MA',978:'MA',
  231:'MI',248:'MI',269:'MI',313:'MI',517:'MI',586:'MI',616:'MI',679:'MI',734:'MI',
  810:'MI',906:'MI',947:'MI',989:'MI',
  218:'MN',320:'MN',507:'MN',612:'MN',651:'MN',763:'MN',952:'MN',
  228:'MS',601:'MS',662:'MS',769:'MS',
  314:'MO',417:'MO',557:'MO',573:'MO',636:'MO',660:'MO',816:'MO',975:'MO',
  406:'MT', 308:'NE',402:'NE',531:'NE',
  702:'NV',725:'NV',775:'NV', 603:'NH',
  201:'NJ',551:'NJ',609:'NJ',640:'NJ',732:'NJ',848:'NJ',856:'NJ',862:'NJ',908:'NJ',973:'NJ',
  505:'NM',575:'NM',
  212:'NY',315:'NY',332:'NY',347:'NY',363:'NY',516:'NY',518:'NY',585:'NY',607:'NY',
  631:'NY',646:'NY',680:'NY',716:'NY',718:'NY',838:'NY',845:'NY',914:'NY',917:'NY',929:'NY',934:'NY',
  252:'NC',336:'NC',704:'NC',743:'NC',828:'NC',910:'NC',919:'NC',980:'NC',984:'NC',
  701:'ND',
  216:'OH',220:'OH',234:'OH',326:'OH',330:'OH',380:'OH',419:'OH',440:'OH',513:'OH',
  567:'OH',614:'OH',740:'OH',937:'OH',
  405:'OK',539:'OK',572:'OK',580:'OK',918:'OK',
  458:'OR',503:'OR',541:'OR',971:'OR',
  215:'PA',223:'PA',267:'PA',272:'PA',412:'PA',445:'PA',484:'PA',570:'PA',582:'PA',
  610:'PA',717:'PA',724:'PA',814:'PA',835:'PA',878:'PA',
  401:'RI', 803:'SC',839:'SC',843:'SC',854:'SC',864:'SC', 605:'SD',
  423:'TN',615:'TN',629:'TN',731:'TN',865:'TN',901:'TN',931:'TN',
  210:'TX',214:'TX',254:'TX',281:'TX',325:'TX',346:'TX',361:'TX',409:'TX',430:'TX',
  432:'TX',469:'TX',512:'TX',682:'TX',713:'TX',726:'TX',737:'TX',806:'TX',817:'TX',
  830:'TX',832:'TX',903:'TX',915:'TX',936:'TX',940:'TX',945:'TX',956:'TX',972:'TX',979:'TX',
  385:'UT',435:'UT',801:'UT', 802:'VT',
  276:'VA',434:'VA',540:'VA',571:'VA',703:'VA',757:'VA',804:'VA',826:'VA',948:'VA',
  206:'WA',253:'WA',360:'WA',425:'WA',509:'WA',564:'WA',
  304:'WV',681:'WV', 262:'WI',274:'WI',414:'WI',534:'WI',608:'WI',715:'WI',920:'WI',
  307:'WY',
};

const CONTINENTAL = ['America/New_York','America/Chicago','America/Denver','America/Los_Angeles'];

export function digitsOf(s){ return String(s == null ? '' : s).replace(/\D/g, ''); }

/** '+13364928001' | '(336) 492-8001' → '+13364928001', or null if not a
 *  plausible North American number. One normaliser, used everywhere, so a
 *  suppression list can never miss a match on formatting alone. */
export function toE164(input){
  const d = digitsOf(input);
  const t = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  if (t.length !== 10) return null;
  if (t[0] === '0' || t[0] === '1') return null;      // invalid NPA
  return '+1' + t;
}

export function areaCodeState(e164){
  const d = digitsOf(e164);
  const t = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  return AREA_STATE[+t.slice(0,3)] || null;
}

/** Which zones must all be inside the window, and how sure we are of them.
 *  precision: 'zone' (told outright) | 'state' | 'areacode' | 'none' */
export function zonesFor({ timezone, state, e164 }){
  if (timezone) return { zones: [timezone], precision: 'zone', state: state || null };
  const st = (state || '').toUpperCase().slice(0,2);
  if (STATE_ZONES[st]) return { zones: STATE_ZONES[st], precision: 'state', state: st };
  const guess = e164 ? areaCodeState(e164) : null;
  if (guess && STATE_ZONES[guess])
    return { zones: STATE_ZONES[guess], precision: 'areacode', state: guess };
  return { zones: CONTINENTAL, precision: 'none', state: null };
}

/** Local weekday (0=Sun) and fractional hour in an IANA zone. Intl is the
 *  only thing in the platform that knows about DST, so it does the work. */
export function localAt(when, tz){
  const d = when instanceof Date ? when : new Date(when);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false,
      weekday: 'short', hour: '2-digit', minute: '2-digit', day: '2-digit' })
      .formatToParts(d).map(p => [p.type, p.value]));
  const DOW = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0;                    // some ICU builds say 24 at midnight
  return { dow: DOW[parts.weekday], hour, minute: parseInt(parts.minute, 10),
           hourF: hour + parseInt(parts.minute, 10) / 60,
           dayKey: tz + ':' + parts.day };
}

/** The window that applies in one state on one weekday, federal unless a
 *  state rule is narrower. Returns null when calling is barred outright. */
export function windowFor(state, dow){
  const r = STATE_RULES[state];
  if (!r) return { ...FEDERAL, cite: 'federal' };
  const w = r.days[dow];
  if (!w) return null;
  return { start: Math.max(w[0], FEDERAL.start), end: Math.min(w[1], FEDERAL.end),
           cite: r.cite };
}

export function dailyCapFor(state){
  const r = STATE_RULES[state];
  return r && r.cap != null ? r.cap : null;
}

/* ── THE ANSWER ────────────────────────────────────────────────────────────
   canDial(...) → { allowed, code, why, detail }
   `code` is machine-readable so the UI can style it and the audit log can
   count it; `why` is the sentence a human reads on the disabled button. */
export function canDial({
  e164, state, timezone, now = new Date(),
  suppressed = false, suppressionReason = null,
  callsToday = 0, consent = false,
} = {}){
  const num = toE164(e164);
  if (!num) return { allowed:false, code:'bad_number',
    why:'That is not a dialable US number.', detail:{ given:e164 } };

  /* 1 — the list, first and absolutely. Nothing outranks an opt-out. */
  if (suppressed) return { allowed:false, code:'suppressed',
    why: suppressionReason === 'sms_stop' ? 'They replied STOP. This number is closed.'
       : suppressionReason && suppressionReason.startsWith('dnc') ? 'On the Do Not Call registry.'
       : 'On your do-not-contact list.',
    detail:{ reason: suppressionReason } };

  const { zones, precision, state: st } = zonesFor({ timezone, state, e164: num });

  /* 2 — the clock, in their time, in every zone it might be. */
  const checks = zones.map(tz => {
    const L = localAt(now, tz);
    const w = windowFor(st, L.dow);
    return { tz, L, w, ok: !!w && L.hourF >= w.start && L.hourF < w.end };
  });
  const blocked = checks.filter(c => !c.ok);
  if (blocked.length){
    const b = blocked[0];
    const DAY = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const hhmm = String(b.L.hour).padStart(2,'0') + ':' + String(b.L.minute).padStart(2,'0');
    const why = !b.w
      ? `No calling in ${st} on a ${DAY[b.L.dow]} (${b.w === null ? STATE_RULES[st].cite : ''}).`
      : precision === 'zone' || zones.length === 1
        ? `It is ${hhmm} where they are. The window is ${b.w.start}:00–${b.w.end}:00 (${b.w.cite}).`
        : `Part of ${st || 'their area'} is at ${hhmm} — outside ${b.w.start}:00–${b.w.end}:00 (${b.w.cite}). ` +
          `We wait until every timezone it could be is inside the window.`;
    return { allowed:false, code: b.w ? 'quiet_hours' : 'no_calling_today', why,
      detail:{ zone:b.tz, localHour:b.L.hourF, window:b.w, precision, state:st } };
  }

  /* 3 — how many times today. */
  const cap = dailyCapFor(st);
  if (cap != null && callsToday >= cap)
    return { allowed:false, code:'daily_cap',
      why:`${cap} calls to this number today is the limit in ${st} (${STATE_RULES[st].cite}).`,
      detail:{ cap, callsToday, state:st } };

  const w = checks[0].w;
  return { allowed:true, code:'ok',
    why: precision === 'areacode'
      ? `Inside ${w.start}:00–${w.end}:00. Timezone guessed from the area code — set the lead's timezone to be sure.`
      : `Inside ${w.start}:00–${w.end}:00 (${w.cite}).`,
    detail:{ zones, precision, state:st, window:w, cap, callsToday, consent } };
}

/** The next moment a blocked number becomes dialable, so the UI can say
 *  "opens at 9:00 their time" instead of just refusing. Walks forward in
 *  15-minute steps for up to four days; returns null if nothing opens. */
export function nextOpen(args, from = new Date()){
  const step = 15 * 60 * 1000;
  for (let i = 1; i <= 4 * 24 * 4; i++){
    const t = new Date(from.getTime() + i * step);
    const r = canDial({ ...args, now: t, callsToday: 0 });
    if (r.allowed) return t;
  }
  return null;
}
