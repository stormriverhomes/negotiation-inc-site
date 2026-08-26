/* ══ THE NUMBERS THE BUSINESS STEERS BY ════════════════════════════════════
   The desk knows everything that happened — every dial, every connect, every
   document, every stage move — and until now it could not answer the only
   question that decides whether any of it was worth doing: is this working?

   Two disciplines hold this file together, and they are the desk's own two.

   1 · EVERY RATE CARRIES ITS n. A connect rate is a fraction, and a fraction
       on twelve calls is a rumour wearing a percent sign. Rates computed on
       fewer than THIN observations are flagged, and the screen dresses them
       in gold — the same gold an unverified seller quote wears, because it is
       the same claim: a number nobody should act on yet.

   2 · NOTHING IS ANNUALISED, PROJECTED, OR SMOOTHED. Every figure here is a
       count of things that actually happened in a window that actually
       elapsed. The moment a report starts extrapolating, the operator starts
       steering by the extrapolation, and an extrapolation from three weeks of
       one person dialling is astrology. The desk shows what happened; what it
       means is the operator's job.

   Everything takes `now` as an argument. A report that reads the wall clock
   is a report whose tests rot at midnight — the daily-seed lesson, learned
   once, applied everywhere since.                                          */

export const THIN = 30;

/* DAY_MS, not DAY — sequences.mjs already claimed DAY, and both modules are
   injected into one page scope. Fifth catch for the build guard. */
const DAY_MS = 86400000;

export const rate = (num, den) => den > 0 ? num / den : null;
export const pct = r => r == null ? null : Math.round(r * 100);
export const isThin = n => n < THIN;

/* A rate, packaged with its honesty: the fraction, the n it stands on, and
   whether anybody should trust it yet. */
export function measured(num, den){
  return { value: rate(num, den), pct: pct(rate(num, den)), n: den, num,
           thin: isThin(den) };
}

const dayKey = (iso) => String(iso).slice(0, 10);

function startOfDay(now){
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* ── the day-by-day rhythm ────────────────────────────────────────────────
   One row per calendar day, most recent last, every day present even when
   nothing happened — a gap in a bar chart is information, and a chart that
   silently skips quiet days turns "you did not dial Tuesday" into a lie. */
export function byDay({ calls = [], days = 14, now = Date.now() } = {}){
  const out = [];
  const today = startOfDay(now);
  for (let i = days - 1; i >= 0; i--){
    const start = today - i * DAY_MS;
    const key = dayKey(new Date(start).toISOString());
    out.push({ key, start,
      label: new Date(start).toLocaleDateString('en-US', { weekday:'short' }),
      dials: 0, connects: 0, talkSeconds: 0 });
  }
  const index = new Map(out.map(r => [r.key, r]));
  for (const c of calls){
    if (c.direction !== 'outbound') continue;
    const row = index.get(dayKey(c.started_at));
    if (!row) continue;
    row.dials++;
    if (c.duration_s > 0){ row.connects++; row.talkSeconds += c.duration_s; }
  }
  return out;
}

/* ── the week, against the week before ────────────────────────────────────
   Trailing seven days against the seven before them — calendar weeks make
   Monday mornings report on two days of data. The comparison is only offered
   when both windows have enough in them to mean something. */
export function weekReport({ calls = [], documents = [], now = Date.now() } = {}){
  const t0 = now - 7 * DAY_MS, t1 = now - 14 * DAY_MS;
  const inWin = (iso, a, b) => { const t = Date.parse(iso); return t >= a && t < b; };
  const week = calls.filter(c => c.direction === 'outbound' && inWin(c.started_at, t0, now));
  const prior = calls.filter(c => c.direction === 'outbound' && inWin(c.started_at, t1, t0));
  const connects = week.filter(c => c.duration_s > 0);
  const priorConnects = prior.filter(c => c.duration_s > 0);
  const docs = documents.filter(d => inWin(d.created_at, t0, now));
  const talk = connects.reduce((a, c) => a + c.duration_s, 0);
  return {
    dials: week.length,
    connects: connects.length,
    connectRate: measured(connects.length, week.length),
    talkMinutes: Math.round(talk / 60),
    documents: docs.length,
    prior: { dials: prior.length, connects: priorConnects.length },
    /* a delta is only a delta when both sides are real */
    comparable: week.length >= 10 && prior.length >= 10,
  };
}

/* ── the funnel ───────────────────────────────────────────────────────────
   Counts and money by stage. The money is the sum of best ceilings, and it is
   marked for what it is: every ceiling is an estimate, so the total is one
   too, and the screen must dress it in gold. */
export const STAGE_LABELS = {
  new:'New', contacted:'Contacted', negotiating:'Negotiating',
  under_contract:'Under contract', closed:'Closed', dead:'Dead',
};

export function funnel({ leads = [], ceilingFor = () => null } = {}){
  const order = ['new','contacted','negotiating','under_contract','closed','dead'];
  const rows = order.map(stage => ({ stage, label: STAGE_LABELS[stage],
    count: 0, value: 0, priced: 0 }));
  const at = new Map(rows.map(r => [r.stage, r]));
  for (const l of leads){
    const row = at.get(l.stage);
    if (!row) continue;
    row.count++;
    const c = ceilingFor(l);
    if (c != null && isFinite(c)){ row.value += c; row.priced++; }
  }
  const live = rows.filter(r => !['closed','dead'].includes(r.stage));
  return { rows,
    pipelineValue: live.reduce((a, r) => a + r.value, 0),
    pipelineCount: live.reduce((a, r) => a + r.count, 0),
    unpriced: live.reduce((a, r) => a + (r.count - r.priced), 0) };
}

/* ── what a hundred dials buys ────────────────────────────────────────────
   The wholesaler's exchange rates: dials → conversations → offers on paper →
   contracts. Computed over everything, because the point of the number is the
   long run, and flagged thin until the long run exists. */
export function per100({ calls = [], documents = [], leads = [] } = {}){
  const dials = calls.filter(c => c.direction === 'outbound').length;
  const connects = calls.filter(c => c.direction === 'outbound' && c.duration_s > 0).length;
  const offers = documents.filter(d =>
    ['offer_letter','psa','option','template'].includes(d.kind)).length;
  const contracts = leads.filter(l => ['under_contract','closed'].includes(l.stage)).length;
  const per = n => dials > 0 ? Math.round(n / dials * 1000) / 10 : null;
  return { dials,
    connectsPer100: per(connects), offersPer100: per(offers),
    contractsPer100: per(contracts),
    connects, offers, contracts, thin: isThin(dials) };
}

/* ── which list actually produces ─────────────────────────────────────────
   Grouped by the lead's source. "Reached" means a call to that lead ever
   connected — the first honest hurdle, since a list whose phone numbers are
   wrong fails here and nowhere else. */
export function bySource({ leads = [], calls = [], ceilingFor = () => null } = {}){
  const connectedLeads = new Set(calls
    .filter(c => c.duration_s > 0 && c.lead_id).map(c => c.lead_id));
  const groups = new Map();
  for (const l of leads){
    const key = (l.source || 'no source recorded').trim() || 'no source recorded';
    let g = groups.get(key);
    if (!g){ g = { source: key, leads: 0, reached: 0, negotiating: 0,
                   contracts: 0, dead: 0, value: 0 }; groups.set(key, g); }
    g.leads++;
    if (connectedLeads.has(l.id)) g.reached++;
    if (l.stage === 'negotiating') g.negotiating++;
    if (['under_contract','closed'].includes(l.stage)) g.contracts++;
    if (l.stage === 'dead') g.dead++;
    const c = ceilingFor(l);
    if (c != null && isFinite(c) && !['closed','dead'].includes(l.stage)) g.value += c;
  }
  return [...groups.values()]
    .map(g => ({ ...g, reachRate: measured(g.reached, g.leads) }))
    .sort((a, b) => b.contracts - a.contracts || b.reached - a.reached
      || b.leads - a.leads);
}

/* ── when people actually answer ──────────────────────────────────────────
   Connect rate by hour of the OPERATOR's day, because that is the clock the
   operator plans with. Hours with almost nothing in them are reported —
   hiding them would hide "you have never once dialled before 10am", which is
   frequently the finding. */
export function byHour({ calls = [] } = {}){
  const hours = [];
  for (let h = 8; h <= 20; h++) hours.push({ hour: h,
    label: (h % 12 || 12) + (h < 12 ? 'a' : 'p'), dials: 0, connects: 0 });
  const at = new Map(hours.map(r => [r.hour, r]));
  for (const c of calls){
    if (c.direction !== 'outbound') continue;
    const row = at.get(new Date(c.started_at).getHours());
    if (!row) continue;
    row.dials++;
    if (c.duration_s > 0) row.connects++;
  }
  const out = hours.map(r => ({ ...r, rate: measured(r.connects, r.dials) }));
  const enough = out.filter(r => !r.rate.thin && r.rate.value != null);
  const best = enough.length
    ? enough.reduce((a, b) => b.rate.value > a.rate.value ? b : a) : null;
  return { hours: out, best, thin: !enough.length };
}

/* ── speed to lead ────────────────────────────────────────────────────────
   How long a missed inbound call waits before somebody calls it back. The
   most perishable number in the business: an inbound caller is the warmest
   lead there is, and every hour unreturned is measurable money. Median, not
   mean — one forgotten weekend would otherwise poison the figure forever. */
export function speedToLead({ calls = [] } = {}){
  const misses = calls.filter(c =>
    (c.direction === 'inbound' && !c.duration_s) || (c.direction === 'inbound' && c.missed));
  const samples = [];
  let unreturned = 0;
  for (const m of misses){
    const t = Date.parse(m.started_at);
    const back = calls
      .filter(c => c.direction === 'outbound' && c.their_e164 === m.their_e164
        && Date.parse(c.started_at) > t)
      .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))[0];
    if (back) samples.push((Date.parse(back.started_at) - t) / 60000);
    else unreturned++;
  }
  samples.sort((a, b) => a - b);
  const median = samples.length
    ? samples[Math.floor((samples.length - 1) / 2)] : null;
  return { missed: misses.length, returned: samples.length, unreturned,
    medianMinutes: median == null ? null : Math.round(median),
    thin: isThin(misses.length) };
}

/* ── the compliance pulse ─────────────────────────────────────────────────
   Opt-outs per hundred texts sent. Above about one per hundred, carriers
   start treating the traffic as somebody's problem, and the correct response
   is to send less and say it better — this is the number that says so before
   the carriers do. */
export function optOutReport({ messages = [], suppressions = [] } = {}){
  const sent = messages.filter(m => m.direction === 'outbound').length;
  const stops = suppressions.filter(s =>
    /sms|stop/i.test(String(s.reason || ''))).length;
  return { sent, stops, rate: measured(stops, sent),
    worrying: sent >= THIN && stops / sent > 0.01 };
}

/* ── one call ─────────────────────────────────────────────────────────────
   The whole report, assembled from the raw tables, so the screen makes one
   call and the tests exercise exactly what the screen shows. */
export function fullReport({ leads = [], calls = [], documents = [],
                             messages = [], suppressions = [],
                             ceilingFor = () => null, now = Date.now() } = {}){
  return {
    week: weekReport({ calls, documents, now }),
    days: byDay({ calls, days: 14, now }),
    funnel: funnel({ leads, ceilingFor }),
    per100: per100({ calls, documents, leads }),
    sources: bySource({ leads, calls, ceilingFor }),
    hours: byHour({ calls }),
    speed: speedToLead({ calls }),
    optOut: optOutReport({ messages, suppressions }),
  };
}
