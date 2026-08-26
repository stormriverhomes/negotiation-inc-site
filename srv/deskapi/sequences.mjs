/* ══ FOLLOW-UP ═════════════════════════════════════════════════════════════
   The Gone quiet list exists because everybody in this business builds one.
   You speak to somebody, it goes well, nothing happens, and three weeks later
   they are in a pile you have stopped looking at. The deal was not lost — it
   was dropped, and it was dropped by a person who was busy rather than by a
   person who decided.

   A sequence is the machine that stops that. It is also, if built carelessly,
   the single most dangerous thing in this product: an automation that texts
   strangers on a timer is a TCPA incident generator with a nice UI. So three
   rules hold this file together.

   1 · A STEP IS CHECKED WHEN IT FIRES, NEVER WHEN IT WAS SCHEDULED.
       A text queued on Tuesday for Friday is a text queued against Tuesday's
       facts. By Friday they may have replied STOP, the number may be dead,
       and it is certainly a different hour of the day in their zone. Every
       step is re-checked against the calling rules and the suppression list
       at the moment it comes due, and the check is the same module the dial
       button uses.

   2 · NOTHING LEAVES THE BUILDING WITHOUT A PERSON.
       Steps are PREPARED, not sent. They land in a batch you approve. A
       wholesaler with five hundred leads cannot tap five hundred times, so
       the batch approves together — but somebody looks at it, and the thing
       they are approving is the actual text, not a count.

   3 · A REPLY ENDS IT.
       The most expensive mistake a sequence makes is sending step four to
       somebody who answered step three. Every sequence carries its exit
       conditions and they are checked before anything else.                */

export const CHANNELS = ['call', 'sms', 'email', 'letter', 'task'];

/* Why a sequence stopped. Kept as words rather than codes because these get
   shown to a person and "exited: they replied" is a sentence. */
export const EXIT_REASONS = {
  replied:        'they replied',
  connected:      'you got them on the phone',
  stage:          'the lead moved on',
  suppressed:     'they asked not to be contacted',
  finished:       'the sequence ran out',
  stopped:        'you stopped it',
  dead:           'the lead was marked dead',
  no_phone:       'there is no number to work with',
};

/* ── the sequences themselves ─────────────────────────────────────────────
   Cadence matters more than copy. The shape that works on a stalled probate
   is patient and low-pressure: something useful, then a long gap, then
   something useful again. The shape that works on a fresh list is the
   opposite. Neither of them is seven texts in nine days, which is what most
   of this software ships with and what gets numbers labelled by carriers
   inside a fortnight. */
export const SEQUENCES = [
  {
    key: 'probate',
    name: 'Probate — the long patient one',
    why: 'For somebody who inherited a house and has not started the paperwork. '
       + 'Four touches over ten weeks. Nothing in it asks them to sell.',
    exits: ['replied', 'connected', 'stage', 'suppressed', 'dead'],
    steps: [
      { day: 0,  channel:'sms',   name:'The no-ask opener',
        body: "{{first}} — it's {{me}}. No ask here, nothing's changed on my end. "
            + "I was thinking about {{address}}. If it'd ever help, I'll find a probate "
            + "attorney near you and set up the appointment — you wouldn't owe me anything "
            + "for that. And if you'd rather leave it be, that's a fine answer. "
            + "Reply STOP to opt out." },
      { day: 4,  channel:'call',  name:'One call, no voicemail if they are busy',
        note: 'If they did not answer the text, ring once. Leave a voicemail only if '
            + 'you have something to say that is not "checking in".' },
      { day: 18, channel:'sms',   name:'Something useful, not a nudge',
        body: "{{first}} — one thing worth knowing: opening an estate is usually a "
            + "filing, not a lawsuit, and in a simple one it is often cheaper and faster "
            + "than people expect. Happy to find out the actual number for {{address}} "
            + "if you want it. Reply STOP to opt out." },
      { day: 45, channel:'letter', name:'A letter, because a letter gets opened',
        note: 'Short. Handwritten envelope. Say the same thing the texts said and put '
            + 'your number on it.' },
      { day: 70, channel:'call',  name:'Last call on this cycle',
        note: 'If nothing here lands, move them to Gone quiet and come back in six '
            + 'months. A lead you stop pestering is a lead you can call again.' },
    ],
  },
  {
    key: 'quiet',
    name: 'Gone quiet — you spoke, then nothing',
    why: 'For somebody you actually got on the phone who then went silent. '
       + 'Three touches over three weeks, all of them referencing the conversation.',
    exits: ['replied', 'connected', 'stage', 'suppressed', 'dead'],
    steps: [
      { day: 0,  channel:'sms',  name:'Pick the conversation back up',
        body: "{{first}} — {{me}} again about {{address}}. You mentioned you weren't in "
            + "a rush and I didn't want to be a pest about it. Still happy to do it on "
            + "your timing whenever that is. Reply STOP to opt out." },
      { day: 7,  channel:'call', name:'Ring once',
        note: 'Same time of day they answered last time — it is in the timeline.' },
      { day: 21, channel:'sms',  name:'The graceful exit',
        body: "{{first}} — I'll stop bothering you about {{address}}. If it ever comes "
            + "back around, my number is the same. Reply STOP to opt out." },
    ],
  },
  {
    key: 'fresh',
    name: 'New list — work it properly once',
    why: 'For a list you just imported. Two calls and a text inside a week, then stop. '
       + 'Most of a fresh list is dead and the point is finding out which part fast.',
    exits: ['replied', 'connected', 'stage', 'suppressed', 'dead'],
    steps: [
      { day: 0, channel:'call', name:'First call' },
      { day: 1, channel:'sms',  name:'Text if they did not pick up',
        body: "Hi {{first}} — {{me}} here, I called about {{address}}. If you'd ever "
            + "consider selling it as-is I'd make you a cash offer with no repairs and "
            + "no commission. No pressure at all. Reply STOP to opt out." },
      { day: 5, channel:'call', name:'Second call, different time of day',
        note: 'Morning if the first was afternoon. Then leave it.' },
    ],
  },
  {
    key: 'offered',
    name: 'After an offer — do not let it go cold',
    why: 'You made an offer and heard nothing. Three touches over two weeks. '
       + 'Never repeat the number unless they ask.',
    exits: ['replied', 'connected', 'stage', 'suppressed', 'dead'],
    steps: [
      { day: 2, channel:'sms',  name:'Confirm they got it',
        body: "{{first}} — just making sure the offer on {{address}} reached you. "
            + "Happy to walk through how I got to it if any of it looks odd. "
            + "Reply STOP to opt out." },
      { day: 6, channel:'call', name:'Ring and ask what they think',
        note: 'Ask what number WOULD work. The answer is the deal.' },
      /* The one place email beats a text outright: an offer is arithmetic,
         and arithmetic wants more than 320 characters and a screen you can
         scroll back up. It is also the one message a seller forwards to the
         relative who actually decides. */
      { day: 9, channel:'email', name:'The numbers, in writing, where they can be read',
        subject: 'The offer on {{address}}, and how I got to it',
        body: "{{first}} — I promised you the arithmetic, so here it is in one place "
            + "rather than in a text you'd have to scroll.\n\n"
            + "The offer on {{address}} still stands exactly as it did. Everything "
            + "behind it — what I think it's worth fixed up, what the work costs, what "
            + "I make — is on the one-page sheet, and every figure marked ~ is my "
            + "estimate rather than a fact.\n\n"
            + "If one of those numbers is wrong, tell me which one and I'll move mine. "
            + "And if the timing is wrong, that's a fine answer.\n\n{{me}}" },
      { day: 14, channel:'task', name:'Decide: chase, re-price, or let it go',
        note: 'Write the honest reason in the lead either way.' },
    ],
  },
];

export const sequenceByKey = key => SEQUENCES.find(s => s.key === key) || null;

/* enSeq, not seq — ops.html already has one, and the build refuses to write
   the page when two declarations share a name. Fourth time that guard has
   earned itself. */
let enSeq = 0;

/* ── enrolling ────────────────────────────────────────────────────────────
   An enrolment is a lead, a sequence, when it started, and how far through it
   is. Deliberately small: the sequence definition is the program, the
   enrolment is the program counter. */
export function enrol({ leadId, sequenceKey, now = Date.now(), startAt = null }){
  const seq = sequenceByKey(sequenceKey);
  if (!seq) throw new Error(`there is no sequence called "${sequenceKey}"`);
  if (!leadId) throw new Error('an enrolment needs a lead');
  return {
    /* A COUNTER, not a function of the clock. Enrolling a list enrols every
       lead in the same millisecond, and an id derived only from `now` gave all
       of them the SAME id — after which the store returned the first one for
       every lookup, the whole batch of texts went to one seller, and two
       enrolments advanced while one never moved. Silent, and it looked like a
       UI bug for twenty minutes. */
    id: 'en' + now.toString(36) + (++enSeq).toString(36),
    leadId, sequenceKey,
    startedAt: new Date(startAt || now).toISOString(),
    at: 0,                       /* how many steps have been done */
    status: 'running',
    exitReason: null, exitedAt: null,
    history: [],
  };
}

export function exitEnrolment(en, reason, { now = Date.now() } = {}){
  if (en.status !== 'running') return en;
  return { ...en, status:'exited', exitReason: reason,
           exitedAt: new Date(now).toISOString(),
           history: [...en.history, { type:'exited', reason, at: new Date(now).toISOString() }] };
}

/* ── has something happened that should stop this? ────────────────────────
   Checked before anything else, every time. `facts` is assembled by the
   caller from its own store so this stays a pure function. */
export function exitCheck(en, facts = {}){
  const seq = sequenceByKey(en.sequenceKey);
  if (!seq) return 'finished';
  const on = seq.exits || [];
  const since = Date.parse(en.startedAt);
  if (on.includes('suppressed') && facts.suppressed) return 'suppressed';
  if (on.includes('dead') && facts.dead) return 'dead';
  if (facts.noPhone) return 'no_phone';
  if (on.includes('replied') && facts.lastInboundAt
      && Date.parse(facts.lastInboundAt) >= since) return 'replied';
  if (on.includes('connected') && facts.lastConnectedAt
      && Date.parse(facts.lastConnectedAt) >= since) return 'connected';
  if (on.includes('stage') && facts.stageChangedAt
      && Date.parse(facts.stageChangedAt) >= since
      && facts.stage !== facts.stageAtEnrol) return 'stage';
  return null;
}

const DAY = 86400000;

/* When the next undone step is due. */
export function nextDueAt(en){
  const seq = sequenceByKey(en.sequenceKey);
  if (!seq || en.at >= seq.steps.length) return null;
  return Date.parse(en.startedAt) + seq.steps[en.at].day * DAY;
}

/* ── what is due, and what is merely scheduled ────────────────────────────
   Returns one row per enrolment: either a step to do, a reason it is being
   held, or the fact that it is not due yet. Nothing is silently dropped —
   the same discipline the call list runs on, for the same reason. */
export function dueSteps({ enrolments = [], factsFor = () => ({}),
                           gate = () => ({ allowed:true }), now = Date.now(),
                           render = null } = {}){
  const due = [], held = [], exited = [], waiting = [];

  for (const en of enrolments){
    if (en.status !== 'running'){ exited.push(en); continue; }
    const seq = sequenceByKey(en.sequenceKey);
    if (!seq){ exited.push(exitEnrolment(en, 'finished', { now })); continue; }
    const facts = factsFor(en) || {};

    /* 3 · A REPLY ENDS IT — before anything else is considered. */
    const why = exitCheck(en, facts);
    if (why){ exited.push(exitEnrolment(en, why, { now })); continue; }

    if (en.at >= seq.steps.length){
      exited.push(exitEnrolment(en, 'finished', { now })); continue;
    }

    const at = nextDueAt(en);
    if (at > now){ waiting.push({ en, seq, step: seq.steps[en.at], dueAt: at }); continue; }

    const step = seq.steps[en.at];
    const row = { enrolmentId: en.id, leadId: en.leadId, sequenceKey: en.sequenceKey,
                  sequenceName: seq.name, stepIndex: en.at, step, dueAt: at,
                  overdueDays: Math.floor((now - at) / DAY), facts };

    /* 1 · CHECKED NOW, NOT WHEN IT WAS SCHEDULED. A letter or a task is not a
       contact attempt and does not go through the calling rules; anything that
       rings or buzzes somebody's phone does. */
    if (step.channel === 'call' || step.channel === 'sms'){
      const v = gate(facts.e164, facts) || {};
      if (!v.allowed){ held.push({ ...row, code: v.code || 'blocked', why: v.why }); continue; }
    }

    /* Email has no hours — a message arriving at 3am wakes nobody, so the
       calling rules do not apply to it. It has the other two conditions
       though, and they are checked at the same moment for the same reason:
       an address that was on file on Tuesday may have replied STOP by
       Friday, and a step prepared against Tuesday's facts is the bug this
       whole file exists to prevent. */
    if (step.channel === 'email'){
      if (!facts.email){ held.push({ ...row, code:'no_email',
        why:'No email address on file for them.' }); continue; }
      if (facts.emailSuppressed){ held.push({ ...row, code:'suppressed',
        why:'That address asked not to be written to.' }); continue; }
    }

    /* an email carries a subject, and the subject takes the same tokens the
       body does — a subject line reading "the offer on {{address}}" going out
       verbatim is the sort of thing that ends a conversation */
    due.push(render
      ? { ...row, body: render(step, facts),
          subject: step.subject ? render({ ...step, body: step.subject }, facts) : null }
      : row);
  }

  /* most overdue first — a follow-up you promised a week ago outranks one
     that came due this morning */
  due.sort((a, b) => a.dueAt - b.dueAt);
  held.sort((a, b) => a.dueAt - b.dueAt);
  waiting.sort((a, b) => a.dueAt - b.dueAt);
  return { due, held, exited, waiting };
}

/* ── doing a step ─────────────────────────────────────────────────────────
   Advancing is separate from due-ness on purpose: a step that was prepared
   and then not approved must NOT advance, or the sequence walks past a text
   nobody sent. */
export function completeStep(en, { now = Date.now(), outcome = 'done', note = null } = {}){
  const seq = sequenceByKey(en.sequenceKey);
  if (!seq) return en;
  if (en.status !== 'running') return en;
  const step = seq.steps[en.at];
  const history = [...en.history, { type:'step', index: en.at,
    channel: step ? step.channel : null, name: step ? step.name : null,
    outcome, note, at: new Date(now).toISOString() }];
  const at = en.at + 1;
  if (at >= seq.steps.length)
    return { ...en, at, history, status:'exited', exitReason:'finished',
             exitedAt: new Date(now).toISOString() };
  return { ...en, at, history };
}

export function skipStep(en, { now = Date.now(), reason = null } = {}){
  return completeStep(en, { now, outcome:'skipped', note: reason });
}

/* ── the words ────────────────────────────────────────────────────────────
   The same {{token}} vocabulary as the templates, deliberately, so somebody
   who has learned one has learned both. */
export function renderBody(step, facts = {}){
  if (!step || !step.body) return null;
  const first = String(facts.name || '').trim().split(/\s+/)[0] || 'there';
  const values = {
    first,
    name: facts.name || '',
    address: facts.address || 'the property',
    me: facts.me || 'me',
    city: facts.city || '',
  };
  return step.body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, k) => {
    const v = values[k.toLowerCase()];
    return v === undefined ? whole : v;
  });
}

/* Every text this product prepares carries its own opt-out, and it is checked
   here rather than trusted — a sequence whose fourth step lost its STOP line
   in an edit is a sequence that generates a claim per send. */
export function validateSequences(list = SEQUENCES){
  const problems = [];
  for (const seq of list){
    if (!seq.key || !seq.name || !seq.why) problems.push(`${seq.key || '?'}: missing name or reason`);
    if (!seq.steps || !seq.steps.length) problems.push(`${seq.key}: no steps`);
    let last = -1;
    for (const [i, s] of (seq.steps || []).entries()){
      if (!CHANNELS.includes(s.channel)) problems.push(`${seq.key} step ${i}: unknown channel`);
      if (typeof s.day !== 'number' || s.day < 0) problems.push(`${seq.key} step ${i}: bad day`);
      if (s.day < last) problems.push(`${seq.key} step ${i}: goes backwards in time`);
      last = s.day;
      if (s.channel === 'sms'){
        if (!s.body) problems.push(`${seq.key} step ${i}: a text with no words`);
        else if (!/reply stop/i.test(s.body))
          problems.push(`${seq.key} step ${i}: A TEXT WITH NO OPT-OUT`);
        else if (s.body.length > 320)
          problems.push(`${seq.key} step ${i}: ${s.body.length} characters — that is three segments`);
      }
      if (s.channel === 'email'){
        if (!s.subject) problems.push(`${seq.key} step ${i}: an email with no subject`);
        else if (/^(re:|fwd:)/i.test(s.subject.trim()))
          problems.push(`${seq.key} step ${i}: A SUBJECT FAKED AS A REPLY`);
        if (!s.body) problems.push(`${seq.key} step ${i}: an email with no words`);
      }
      if (!s.body && !s.note && s.channel !== 'call')
        problems.push(`${seq.key} step ${i}: nothing tells the operator what to do`);
    }
    if (!(seq.exits || []).includes('replied'))
      problems.push(`${seq.key}: DOES NOT STOP WHEN SOMEBODY REPLIES`);
  }
  return { ok: problems.length === 0, problems };
}
