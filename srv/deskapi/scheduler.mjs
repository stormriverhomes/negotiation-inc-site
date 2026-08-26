/* ══ THE CLOCK THAT DOES NOT NEED THE LAPTOP OPEN ══════════════════════════
   Until now a sequence only moved when somebody opened the Follow-ups
   screen, because the browser was the only thing that could compute what was
   due. Honest, and it has a failure mode with money in it: a seller replies
   at 9pm, nobody opens the desk that night, and the 8am text queued for the
   morning goes out to somebody who already answered — the exact mistake the
   engine exists to prevent, committed by scheduling.

   So the server ticks. And the scope of the tick is deliberately narrow:

   THE TICK STOPS THINGS. IT NEVER SENDS THINGS.

   It walks the running enrolments against the same sequences module the
   client runs, writes the EXITS back to the database — replied, connected,
   suppressed, dead — and computes the due list for anyone who asks. Sending
   still happens where it always happened: in front of a person, in a batch
   they read. An automation that stops a text needs no permission; one that
   sends a text is a different machine, and this file refuses to become it by
   not containing the code.

   Everything is injected — the database is a REST adapter with a fetch
   handed in, the clock is an argument — so the whole thing runs headless in
   a test against a fake Supabase, on a Tuesday of the test's choosing.     */

/* ── the service-role database, over PostgREST ────────────────────────────
   The server holds SUPABASE_SERVICE_ROLE, which bypasses row security — it
   is the janitor's key, and it exists here and in Render's environment and
   NOWHERE else. It never appears in a URL, a log line, or a response body. */
export function makeServiceDb({ url, serviceKey, fetchImpl } = {}){
  if (!url || !serviceKey) throw new Error('the service db needs a URL and the service key');
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) throw new Error('no fetch available');
  const base = String(url).replace(/\/$/, '');

  async function call(method, path, body, headers){
    const res = await f(base + path, { method,
      headers: { apikey: serviceKey, authorization:'Bearer ' + serviceKey,
        'content-type':'application/json', ...(headers || {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = res && typeof res.text === 'function' ? await res.text() : '';
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch(_){}
    if (!res || !res.ok){
      const err = new Error('supabase said ' + (res ? res.status : 0)
        + (text ? ': ' + text.slice(0, 200) : ''));
      err.status = res ? res.status : 0;
      throw err;
    }
    return json;
  }

  return {
    select: (table, query) => call('GET', `/rest/v1/${table}?${query || 'select=*'}`),
    update: (table, id, patch) =>
      call('PATCH', `/rest/v1/${table}?id=eq.${id}`, patch,
        { prefer:'return=minimal' }),
  };
}

/* ── facts, from the database's shape ─────────────────────────────────────
   The same facts the client assembles from its mirror, assembled from rows
   the service db returned. Kept as a pure function of the loaded tables so
   the tests can hand it a world and read its mind. */
export function factsFromRows(en, { leads = [], properties = [], contacts = [],
                                    phones = [], suppressions = [], calls = [],
                                    messages = [] } = {}){
  const lead = leads.find(l => l.id === (en.leadId || en.lead_id));
  if (!lead) return { dead: true };
  const prop = properties.find(p => p.id === lead.property_id) || null;
  const contact = contacts.find(c => c.lead_id === lead.id) || null;
  const phone = contact
    ? phones.find(ph => ph.contact_id === contact.id && !ph.bad) || null : null;
  /* matched on the last ten digits — a suppression recorded without the +1
     must never fail to match the +1 form of the same number. Being MORE
     eager to suppress is the only safe direction for this comparison. */
  const tenOf = v => String(v || '').replace(/\D/g, '').slice(-10);
  const suppressed = !!(phone && suppressions.some(s =>
    tenOf(s.e164) === tenOf(phone.e164) && tenOf(s.e164).length === 10));
  const inbound = messages.filter(m =>
    m.lead_id === lead.id && m.direction === 'inbound');
  const connected = calls.filter(c => c.lead_id === lead.id && c.duration_s > 0);
  return {
    name: contact ? contact.name : null,
    address: prop ? prop.address : null,
    e164: phone ? phone.e164 : null,
    noPhone: !phone,
    suppressed,
    dead: lead.stage === 'dead',
    stage: lead.stage,
    stageAtEnrol: en.stageAtEnrol || en.stage_at_enrol || lead.stage,
    lastInboundAt: inbound.map(m => m.created_at).sort().pop() || null,
    lastConnectedAt: connected.map(c => c.started_at).sort().pop() || null,
    stageChangedAt: lead.updated_at || null,
    timezone: lead.timezone || null,
    state: prop ? prop.state : null,
  };
}

/* server rows are snake_case; the sequences engine grew up on the client's
   camel. One translation, at the edge, same policy as the team store. */
export const enFromServer = row => ({
  id: row.id, leadId: row.lead_id, sequenceKey: row.sequence_key,
  startedAt: row.started_at, at: row.at, status: row.status,
  exitReason: row.exit_reason, exitedAt: row.exited_at,
  stageAtEnrol: row.stage_at_enrol, history: row.history || [],
});

/* ── one tick ─────────────────────────────────────────────────────────────
   deps.sequences is the client's own module ({ dueSteps }), injected so the
   scheduler and the screen can never disagree about what "due" means. */
export async function tick({ db, sequences, gate = () => ({ allowed:true }),
                             now = Date.now(), log = () => {} } = {}){
  const [enrolRows, leads, properties, contacts, phones, suppressions,
         calls, messages] = await Promise.all([
    db.select('enrolments', 'select=*&status=eq.running'),
    db.select('leads'), db.select('properties'), db.select('contacts'),
    db.select('contact_phones'), db.select('suppressions'),
    db.select('calls', 'select=id,lead_id,duration_s,started_at'),
    db.select('messages', 'select=id,lead_id,direction,created_at'),
  ]);
  const world = { leads, properties, contacts, phones, suppressions, calls, messages };
  const enrolments = (enrolRows || []).map(enFromServer);

  const r = sequences.dueSteps({ enrolments,
    factsFor: en => factsFromRows(en, world), gate, now });

  /* THE WRITE-BACK — the safety-critical half. An exit computed and not
     written is an exit that un-happens when the process restarts. */
  let exited = 0;
  for (const ex of r.exited){
    const was = enrolments.find(e => e.id === ex.id);
    if (!was || was.status !== 'running' || ex.status !== 'exited') continue;
    await db.update('enrolments', ex.id, {
      status:'exited', exit_reason: ex.exitReason,
      exited_at: ex.exitedAt || new Date(now).toISOString(),
      history: ex.history || [] });
    exited++;
    log('enrolment exited', { id: ex.id, reason: ex.exitReason });
  }

  /* the due list is REPORTED, never acted on. No message leaves this
     function; there is deliberately nothing here that could send one. */
  return {
    at: new Date(now).toISOString(),
    running: enrolments.length,
    exited,
    due: r.due.map(d => ({ enrolmentId: d.enrolmentId, leadId: d.leadId,
      sequenceKey: d.sequenceKey, stepIndex: d.stepIndex,
      channel: d.step.channel, name: d.step.name || d.step.channel,
      dueAt: new Date(d.dueAt).toISOString(), overdueDays: d.overdueDays })),
    held: r.held.map(h => ({ enrolmentId: h.enrolmentId, leadId: h.leadId,
      code: h.code, why: h.why })),
    waiting: r.waiting.length,
  };
}

/* ── the loop the server runs ─────────────────────────────────────────────
   A tick that throws must not kill the interval, and a tick that is still
   running must not be joined by its successor. */
export function startScheduler({ db, sequences, gate, intervalMs = 5 * 60 * 1000,
                                 log = () => {}, setIntervalImpl } = {}){
  let last = null, running = false;
  const si = setIntervalImpl || setInterval;
  const run = async () => {
    if (running) return last;
    running = true;
    try { last = await tick({ db, sequences, gate, log }); }
    catch(e){ last = { error: e.message, at: new Date().toISOString() };
      log('scheduler tick failed', { error: e.message }); }
    finally { running = false; }
    return last;
  };
  const handle = si(run, intervalMs);
  return { run, last: () => last, stop: () => clearInterval(handle) };
}
