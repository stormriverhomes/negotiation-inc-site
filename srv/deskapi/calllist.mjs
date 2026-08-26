/* ══ WHO YOU ARE ABOUT TO CALL, AND IN WHAT ORDER ══════════════════════════
   The first version of Start calling took every lead the filter happened to
   return and dialled them. It was correct and it felt like a slot machine:
   you pressed a button and a stranger's phone rang somewhere, and you found
   out who it was at the same moment they did.

   That is a trust problem, not a feature problem, and it has one fix — the
   operator sees the list before it dials, in the order it will dial, with the
   people it is refusing to call and the reason for each. Everything else in a
   dialer is a nice-to-have on top of that.

   This module decides the list. It touches no DOM and no telephony, takes the
   calling-rules gate as an argument, and is therefore the same list on the
   screen, on the server, and in a test.                                     */

/* ── the lists somebody actually works ────────────────────────────────────
   Named for what a person would say out loud, not for the filter underneath.
   "Everyone I haven't tried yet" is a sentence; "stage=new AND calls=0" is a
   query, and nobody starts their morning by writing a query. */
export const BUILTIN_LISTS = [
  { key:'untried', name:"Everyone I haven't tried yet",
    why:'Never dialled, never spoken to. The top of the funnel.',
    sort:'value',
    pick: r => !r.dead && !r.closed && r.calls === 0 },

  { key:'callback', name:'Owe them a callback',
    why:'An action is due, or they rang you and you missed it.',
    sort:'overdue',
    pick: r => !r.dead && !r.closed && (r.due || r.missedInbound) },

  { key:'warm', name:'Warm — you have spoken before',
    why:'You got them on the phone at least once. These close.',
    sort:'close',
    pick: r => !r.dead && !r.closed && r.connected > 0 },

  { key:'nudge', name:'Gone quiet',
    why:"Spoken to, then nothing for a fortnight. The pile everybody abandons.",
    sort:'overdue',
    pick: r => !r.dead && !r.closed && r.connected > 0 && r.daysSinceContact >= 14 },

  { key:'negotiating', name:'Everyone in Negotiating',
    why:'The live ones. Keep them live.', sort:'overdue',
    pick: r => r.stage === 'negotiating' },

  { key:'new', name:'Everyone in New', why:'Straight down the fresh list.',
    sort:'value', pick: r => r.stage === 'new' },

  { key:'all', name:'Everything callable',
    why:'Every lead with a live number that the rules allow.', sort:'overdue',
    pick: r => !r.dead && !r.closed },
];

export const SORTS = [
  { key:'overdue', name:'Most overdue first' },
  { key:'never',   name:'Never tried first' },
  { key:'close',   name:'Furthest along first' },
  { key:'value',   name:'Biggest ceiling first' },
  { key:'az',      name:'Address A–Z' },
];

const STAGE_ORDER = ['new','contacted','negotiating','under_contract','closed','dead'];

/* Why somebody is not being called, said the way you would say it. The codes
   come from the calling rules; the sentences are for a person at 8am. */
export const HELD_LABELS = {
  no_contact:     'nobody attached to the lead',
  no_phone:       'no phone number on file',
  no_email:       'no email address on file',
  bad_number:     'the number on file is not dialable',
  suppressed:     'asked not to be contacted',
  quiet_hours:    "outside their local calling hours",
  no_calling_today:'their state does not allow calls today',
  daily_cap:      'already hit the daily cap for that state',
  blocked:        'the calling rules refused it',
};

/* ── the one function ─────────────────────────────────────────────────────
   rows are plain objects the caller assembles from its own store; gate is
   (e164, lead) -> { allowed, code, why }. Nothing here knows about a browser. */
export function buildQueue({ rows = [], listKey = 'all', manualIds = null,
                             sort = null, gate = () => ({ allowed:true }),
                             now = new Date() } = {}){
  const list = manualIds
    ? { key:'manual', name:'Your selection', why:'The leads you picked.', sort:'overdue' }
    : (BUILTIN_LISTS.find(l => l.key === listKey) || BUILTIN_LISTS[BUILTIN_LISTS.length - 1]);

  const chosen = manualIds
    ? rows.filter(r => manualIds.includes(r.leadId))
    : rows.filter(r => { try { return list.pick(r); } catch(_){ return false; } });

  const sortKey = sort || list.sort || 'overdue';
  const ordered = [...chosen].sort(comparator(sortKey, manualIds));

  /* ONE list, in one order, with the refusals left in place. An earlier
     version returned ready and held as two piles, and the pile boundary threw
     away the only thing the screen is for: WHERE in your morning the refusal
     sits. "The most overdue call on your list is the one it is 6:12am for,
     and it opens at 8" is a useful sentence. "9 ready, 3 held" is not. */
  const ordered2 = ordered.map(r => {
    if (!r.contactId) return { ...r, held:true, code:'no_contact' };
    if (!r.e164) return { ...r, held:true, code:'no_phone' };
    const v = gate(r.e164, r) || {};
    if (!v.allowed) return { ...r, held:true, code: v.code || 'blocked',
      why: v.why, opensAt: v.opensAt || null };
    return { ...r, held:false };
  });
  const ready = ordered2.filter(r => !r.held).map((r, i) => ({ ...r, position: i + 1 }));
  const held = ordered2.filter(r => r.held);

  /* Grouped, because "9 held" is a number and "6 outside their local hours,
     2 asked not to be contacted, 1 with no number" is an actionable morning. */
  const heldBy = {};
  for (const h of held) (heldBy[h.code] = heldBy[h.code] || []).push(h);

  return { list: { key:list.key, name:list.name, why:list.why }, sort:sortKey,
           ordered: ordered2, ready, held, heldBy, total: chosen.length };
}

function comparator(sortKey, manual){
  const byAddr = (a, b) => String(a.address || '').localeCompare(String(b.address || ''));
  switch (sortKey){
    case 'overdue':
      /* something overdue outranks something merely scheduled, and the oldest
         overdue thing outranks the rest — a callback you promised on Tuesday
         is the most expensive item on this screen */
      return (a, b) => (dueRank(a) - dueRank(b)) || byAddr(a, b);
    case 'never':
      return (a, b) => (a.calls - b.calls) || (dueRank(a) - dueRank(b)) || byAddr(a, b);
    case 'close':
      return (a, b) => (STAGE_ORDER.indexOf(b.stage) - STAGE_ORDER.indexOf(a.stage))
        || (dueRank(a) - dueRank(b)) || byAddr(a, b);
    case 'value':
      return (a, b) => ((b.ceiling || 0) - (a.ceiling || 0)) || byAddr(a, b);
    case 'az':
      return byAddr;
    default:
      return manual ? () => 0 : byAddr;
  }
}

/* Lower is more urgent. Overdue sorts by how overdue; everything not overdue
   sorts after everything that is. */
function dueRank(r){
  if (r.dueAt == null) return 1e15;
  return r.dueAt;
}

/* ── turning a store into rows ────────────────────────────────────────────
   Kept here rather than in the page so the shape the list logic sees is
   defined once and the tests build the same thing the app does. */
export function rowsFrom({ leads = [], contactFor, phoneFor, statsFor, ceilingFor,
                           now = new Date() } = {}){
  const t = now.getTime();
  return leads.map(l => {
    const c = contactFor ? contactFor(l) : null;
    const ph = c && phoneFor ? phoneFor(c) : null;
    const st = statsFor ? statsFor(l) : {};
    const dueAt = l.next_action_at ? new Date(l.next_action_at).getTime() : null;
    return {
      leadId: l.id, stage: l.stage,
      dead: l.stage === 'dead', closed: l.stage === 'closed',
      contactId: c ? c.id : null,
      name: c ? c.name : null,
      e164: ph ? ph.e164 : null,
      address: st.address || null,
      ceiling: ceilingFor ? ceilingFor(l) : null,
      calls: st.calls || 0,
      connected: st.connected || 0,
      missedInbound: !!st.missedInbound,
      lastContactAt: st.lastContactAt || null,
      daysSinceContact: st.lastContactAt
        ? Math.floor((t - new Date(st.lastContactAt).getTime()) / 86400000) : 9999,
      due: dueAt != null && dueAt <= t,
      dueAt: dueAt != null && dueAt <= t ? dueAt : null,
      nextActionAt: dueAt,
      nextAction: l.next_action || null,
      timezone: l.timezone || null,
      state: st.state || null,
    };
  });
}

/* A count for every list, so the picker shows what is in each one before you
   choose it rather than after. */
export function listCounts({ rows, gate, now }){
  return BUILTIN_LISTS.map(l => {
    const q = buildQueue({ rows, listKey:l.key, gate, now });
    return { key:l.key, name:l.name, why:l.why, sort:l.sort,
             ready:q.ready.length, held:q.held.length, total:q.total };
  });
}
