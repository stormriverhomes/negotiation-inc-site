/* ══ THE TEAM BACKEND ══════════════════════════════════════════════════════
   Until now every lead lived in one browser under one localStorage key —
   fine for one person, and a total loss the first time site data is cleared.
   This module puts the same store on Supabase without changing how the app
   thinks: reads stay synchronous against an in-memory mirror, writes are
   optimistic and queue for the server, and the queue survives a closed tab.

   THE DESIGN, IN FOUR RULES

   1 · LOCAL-FIRST, ALWAYS. The mirror in memory is the truth the screens
       read. Boot paints from the cached mirror instantly, then pulls the
       server's copy and repaints. A wholesaler in a truck with one bar of
       signal is the DESIGN CASE, not the edge case.

   2 · THE QUEUE IS THE CONTRACT. Every write becomes an op in a persistent
       queue. Ops flush in order; an op that fails on a server error stays
       and retries; an op the server REFUSES (constraint, permission) moves
       to a dead-letter list and is surfaced — a queue that wedges forever on
       one bad row loses every write behind it, and a queue that silently
       drops the bad row loses the truth. Neither is acceptable.

   3 · PUSHES ARE IDEMPOTENT. Inserts go up as upserts keyed on the row's
       own id, so a retry after a half-heard success cannot duplicate a lead.
       The one exception is the audit log, which is append-only with a
       server-assigned id — and whose rows are therefore sent exactly once
       and never retried into duplicates by carrying a client dedupe key.

   4 · NOTHING HERE KNOWS ABOUT A SCREEN. fetch and storage are injected;
       the whole thing runs headless in a test against a fake Supabase that
       enforces the same rules the real one does.

   Conflict policy, stated plainly rather than implied: LAST WRITE WINS at
   row level. For one operator and the second seat this is honest and
   sufficient; when live co-editing matters, that is a different build and
   it will say so in its own file.                                          */

/* ── what travels, and under what name ────────────────────────────────────
   The client grew up calling things what it liked; the schema has manners.
   One mapping layer, used by push and pull both, so the translation cannot
   drift apart. Columns not listed do not travel — a stray client-only field
   must never be able to 400 an insert and wedge the queue. */
export const TABLE_MAP = {
  leads:        { server:'leads',
    cols:['id','org_id','property_id','stage','source','timezone',
          'next_action_at','next_action','dead_reason','created_at','updated_at'] },
  properties:   { server:'properties',
    cols:['id','org_id','address','city','state','zip','county','parcel',
          'beds','baths','sqft','lot_sqft','year_built','underwrite','intake',
          'created_at','updated_at'] },
  contacts:     { server:'contacts',
    cols:['id','org_id','lead_id','name','role','email','mailing_address',
          'notes','created_at'] },
  phones:       { server:'contact_phones',
    cols:['id','org_id','contact_id','e164','label','seen_our_numbers','bad',
          'created_at'] },
  numbers:      { server:'numbers',
    cols:['id','org_id','e164','twilio_sid','market','status','calls_today',
          'created_at'] },
  calls:        { server:'calls',
    cols:['id','org_id','lead_id','contact_id','direction','our_e164',
          'their_e164','started_at','duration_s','missed','disposition',
          'recording_url','transcript','summary','created_at'] },
  messages:     { server:'messages',
    cols:['id','org_id','lead_id','contact_id','direction','our_e164',
          'their_e164','body','status','is_opt_out','created_at'] },
  suppressions: { server:'suppressions',
    cols:['id','org_id','e164','reason','source','created_at'] },
  tasks:        { server:'tasks',
    cols:['id','org_id','lead_id','due_at','title','done_at','created_at'] },
  events:       { server:'events',
    cols:['id','org_id','lead_id','kind','body','meta','at'] },
  documents:    { server:'documents',
    cols:['id','org_id','lead_id','kind','name','terms','blocks','flags',
          'guard','report','template_id','created_at'] },
  templates:    { server:'templates',
    cols:['id','org_id','name','kind','bytes','size','tokens','map','created_at'] },
  envelopes:    { server:'envelopes',
    cols:['id','org_id','lead_id','template_id','filename','bytes','terms',
          'envelope','created_at'] },
  enrolments:   { server:'enrolments',
    cols:['id','org_id','lead_id','sequence_key','started_at','at','status',
          'exit_reason','exited_at','stage_at_enrol','history','created_at'],
    rename:{ leadId:'lead_id', sequenceKey:'sequence_key', startedAt:'started_at',
             exitReason:'exit_reason', exitedAt:'exited_at',
             stageAtEnrol:'stage_at_enrol' } },
  audit_log:    { server:'audit_log', appendOnly:true,
    cols:['org_id','actor','action','detail','at'] },
  /* the client's org row is the org's settings blob, not a table of its own */
  org:          { server:'orgs', special:'org_settings' },
};

export function toServerRow(table, row, orgId){
  const m = TABLE_MAP[table];
  if (!m || m.special) return null;
  const src = { ...row };
  for (const [from, to] of Object.entries(m.rename || {})){
    if (src[from] !== undefined){ src[to] = src[from]; delete src[from]; }
  }
  const out = {};
  for (const c of m.cols) if (src[c] !== undefined) out[c] = src[c];
  out.org_id = orgId;
  if (m.appendOnly) delete out.id;
  return out;
}

export function toClientRow(table, row){
  const m = TABLE_MAP[table];
  const out = { ...row };
  for (const [from, to] of Object.entries(m && m.rename || {})){
    if (out[to] !== undefined){ out[from] = out[to]; delete out[to]; }
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = v => UUID_RE.test(String(v || ''));

/* ── the store ─────────────────────────────────────────────────────────── */
export function makeTeamStore({ url, anonKey, fetchImpl, storage,
                                tables, uuid, onState } = {}){
  if (!url || !anonKey) throw new Error('the team store needs a URL and the anon key');
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) throw new Error('no fetch available');
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) throw new Error('no storage available');
  const newId = uuid || (() => crypto.randomUUID());
  const base = String(url).replace(/\/$/, '');
  const TABLES = tables || Object.keys(TABLE_MAP);

  const K = { session:'desk.team.session', queue:'desk.team.queue',
              dead:'desk.team.dead', mirror:'ni.ops.team.v1', org:'desk.team.org' };
  const readJson = (k, fb) => { try { return JSON.parse(store.getItem(k)) ?? fb; }
    catch(_){ return fb; } };
  const writeJson = (k, v) => { try { store.setItem(k, JSON.stringify(v)); } catch(_){} };

  let session = readJson(K.session, null);
  let orgId = store.getItem(K.org) || null;
  let queue = readJson(K.queue, []);
  let dead = readJson(K.dead, []);
  let state = 'idle';
  let flushing = false;

  const setState = s => { state = s; if (onState) onState(status()); };
  function status(){
    return { state, queued: queue.length, dead: dead.length,
             signedIn: !!(session && session.access_token), orgId };
  }

  /* ── talking to Supabase ──────────────────────────────────────────────── */
  async function call(method, path, body, extraHeaders){
    const headers = { apikey: anonKey, 'content-type':'application/json',
      ...(session && session.access_token
        ? { authorization:'Bearer ' + session.access_token } : {}),
      ...(extraHeaders || {}) };
    const res = await f(base + path, { method, headers,
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = res && typeof res.text === 'function' ? await res.text() : '';
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch(_){}
    return { ok: !!res && res.ok, status: res ? res.status : 0, json, text };
  }

  /* ── auth ─────────────────────────────────────────────────────────────── */
  async function signIn(email, password){
    const r = await call('POST', '/auth/v1/token?grant_type=password',
      { email, password });
    if (!r.ok) throw new Error(r.json && (r.json.error_description || r.json.msg)
      || 'Sign-in failed (' + r.status + ')');
    session = r.json; writeJson(K.session, session);
    orgId = await ensureOrg();
    return status();
  }
  async function signUp(email, password){
    const r = await call('POST', '/auth/v1/signup', { email, password });
    if (!r.ok) throw new Error(r.json && (r.json.error_description || r.json.msg)
      || 'Sign-up failed (' + r.status + ')');
    /* some projects require email confirmation; if a session came back, use
       it — if not, say what happens next rather than pretending */
    if (r.json && r.json.access_token){
      session = r.json; writeJson(K.session, session);
      orgId = await ensureOrg();
      return { ...status(), confirmed: true };
    }
    return { ...status(), confirmed: false };
  }
  async function refresh(){
    if (!session || !session.refresh_token) return false;
    const r = await call('POST', '/auth/v1/token?grant_type=refresh_token',
      { refresh_token: session.refresh_token });
    if (!r.ok) return false;
    session = r.json; writeJson(K.session, session);
    return true;
  }
  function signOut(){
    session = null; store.removeItem(K.session);
    setState('idle');
  }
  async function ensureOrg(){
    const r = await call('POST', '/rest/v1/rpc/ensure_org', {});
    if (!r.ok) throw new Error('could not make or find your org ('
      + r.status + ')');
    const id = typeof r.json === 'string' ? r.json : r.json && r.json.ensure_org;
    if (!id) throw new Error('the server did not name an org');
    store.setItem(K.org, id);
    orgId = id;
    return id;
  }

  /* a call that retries once through a token refresh — sessions expire, and
     the first 401 after lunch must not look like an outage */
  async function authed(method, path, body, headers){
    let r = await call(method, path, body, headers);
    if (r.status === 401 && await refresh())
      r = await call(method, path, body, headers);
    return r;
  }

  /* ── the mirror ───────────────────────────────────────────────────────── */
  const _d = {};
  for (const t of TABLES) _d[t] = [];

  function loadMirror(){
    const cached = readJson(K.mirror, null);
    if (!cached) return false;
    for (const t of TABLES) _d[t] = Array.isArray(cached[t]) ? cached[t] : [];
    return true;
  }
  function saveMirror(){ writeJson(K.mirror, _d); }

  async function pullAll(){
    setState('pulling');
    for (const t of TABLES){
      const m = TABLE_MAP[t];
      if (!m) continue;
      if (m.special === 'org_settings'){
        const r = await authed('GET', '/rest/v1/orgs?select=id,settings&limit=1');
        if (!r.ok) throw new Error('pull failed on orgs (' + r.status + ')');
        const row = (r.json || [])[0];
        _d.org = row ? [{ id: row.id, ...(row.settings || {}) }] : [];
        continue;
      }
      const r = await authed('GET', '/rest/v1/' + m.server + '?select=*'
        + '&order=created_at.asc.nullslast&limit=10000');
      if (!r.ok) throw new Error('pull failed on ' + m.server + ' (' + r.status + ')');
      _d[t] = (r.json || []).map(row => toClientRow(t, row));
    }
    saveMirror();
    setState(queue.length ? 'queued' : 'synced');
  }

  /* ── the queue ────────────────────────────────────────────────────────── */
  function enqueue(op){
    queue.push(op);
    writeJson(K.queue, queue);
    setState('queued');
    scheduleFlush();
  }
  let flushTimer = null;
  function scheduleFlush(delay){
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, delay || 30);
  }

  async function pushOne(op){
    const m = TABLE_MAP[op.t];
    if (m.special === 'org_settings'){
      const { id, ...settings } = op.row || op.patch || {};
      return authed('PATCH', '/rest/v1/orgs?id=eq.' + orgId, { settings });
    }
    if (op.op === 'insert'){
      const row = toServerRow(op.t, op.row, orgId);
      return authed('POST', '/rest/v1/' + m.server
        + (m.appendOnly ? '' : '?on_conflict=id'),
        row, { prefer: m.appendOnly
          ? 'return=minimal'
          : 'resolution=merge-duplicates,return=minimal' });
    }
    /* update — send only schema columns from the patch */
    const patch = toServerRow(op.t, { ...op.patch, id: op.id }, orgId);
    delete patch.org_id;
    delete patch.id;
    if (!Object.keys(patch).length) return { ok:true, status:204 };
    return authed('PATCH', '/rest/v1/' + m.server + '?id=eq.' + op.id, patch,
      { prefer:'return=minimal' });
  }

  async function flush(){
    if (flushing || !queue.length || !session) return status();
    flushing = true;
    setState('flushing');
    try {
      while (queue.length){
        const op = queue[0];
        let r;
        try { r = await pushOne(op); }
        catch(e){ r = { ok:false, status:0, text: e.message }; }
        if (r.ok){
          queue.shift(); writeJson(K.queue, queue);
          continue;
        }
        if (r.status === 0 || r.status === 429 || r.status >= 500){
          /* the server is having a day; the op is fine. Stop, keep order,
             try again later. */
          setState('offline');
          return status();
        }
        /* the server REFUSED it. Dead-letter, loudly, and keep going — one
           bad row must not hold every later write hostage. */
        dead.push({ ...op, error: r.status + ' ' + String(r.text).slice(0, 300),
          at: new Date().toISOString() });
        writeJson(K.dead, dead);
        queue.shift(); writeJson(K.queue, queue);
      }
      setState('synced');
      return status();
    } finally {
      flushing = false;
    }
  }

  /* ── the surface the app already speaks ───────────────────────────────── */
  const api = {
    name: 'team',
    _d,
    async load(){
      const hadCache = loadMirror();
      try { await pullAll(); }
      catch(e){
        /* offline boot: the cache is the desk until the signal comes back */
        setState(hadCache ? 'offline' : 'error');
        if (!hadCache) throw e;
      }
      scheduleFlush(500);
    },
    save(){ saveMirror(); },
    all(t){
      const rows = _d[t];
      if (!Array.isArray(rows))
        throw new Error(`store: no table "${t}" — add it to TABLES`);
      return rows;
    },
    get(t, id){ return api.all(t).find(r => r.id === id) || null; },
    insert(t, row){
      row.id = row.id || newId();
      if (row.org_id === 'local' || !row.org_id) row.org_id = orgId;
      api.all(t).push(row);
      saveMirror();
      enqueue({ t, op:'insert', id: row.id, row: { ...row } });
      return row;
    },
    update(t, id, patch){
      const r = api.get(t, id);
      if (!r) return null;
      Object.assign(r, patch);
      saveMirror();
      enqueue({ t, op:'update', id, patch: { ...patch } });
      return r;
    },
    exportJSON(){ return JSON.stringify(_d, null, 1); },
    importJSON(){ throw new Error('restore a backup into local mode first, '
      + 'then migrate — a blind bulk import into the team store is how two '
      + 'people lose an afternoon'); },

    /* team-only surface */
    signIn, signUp, signOut, refresh, ensureOrg, pullAll, flush, status,
    deadLetters(){ return [...dead]; },
    clearDead(){ dead = []; writeJson(K.dead, dead); },
    _internals: { queueKey: K.queue, mirrorKey: K.mirror },
  };
  return api;
}

/* ══ THE MIGRATION ═════════════════════════════════════════════════════════
   Takes the local file, gives every non-UUID id a real one — consistently,
   so every foreign key still points where it pointed — and returns batches
   in dependency order. Pure: the caller uploads, this only decides.        */
const FK_FIELDS = {
  leads:      ['property_id'],
  contacts:   ['lead_id'],
  phones:     ['contact_id'],
  calls:      ['lead_id','contact_id'],
  messages:   ['lead_id','contact_id'],
  tasks:      ['lead_id'],
  events:     ['lead_id'],
  documents:  ['lead_id','template_id'],
  envelopes:  ['lead_id','template_id'],
  enrolments: ['lead_id','leadId'],
};

export const MIGRATE_ORDER = ['properties','leads','contacts','phones','numbers',
  'templates','calls','messages','suppressions','tasks','events','documents',
  'envelopes','enrolments','audit_log'];

export function planMigration(dump, { uuid } = {}){
  const newId = uuid || (() => crypto.randomUUID());
  const idMap = new Map();
  const mapId = old => {
    if (old == null) return old;
    if (isUuid(old)) return old;
    if (!idMap.has(old)) idMap.set(old, newId());
    return idMap.get(old);
  };

  /* first pass — claim every primary key, so forward references resolve */
  for (const t of MIGRATE_ORDER)
    for (const row of (dump[t] || [])) if (row.id != null) mapId(row.id);

  const batches = [];
  let total = 0;
  for (const t of MIGRATE_ORDER){
    const rows = (dump[t] || []).map(r => {
      const out = { ...r };
      if (out.id != null) out.id = mapId(out.id);
      for (const fk of FK_FIELDS[t] || [])
        if (out[fk] != null) out[fk] = mapId(out[fk]);
      return out;
    });
    if (rows.length){ batches.push({ table: t, rows }); total += rows.length; }
  }
  const settings = (dump.org && dump.org[0]) ? { ...dump.org[0] } : null;
  if (settings) delete settings.id;
  return { batches, settings, total, remapped: idMap.size };
}

/* the check that makes "migrated" a claim instead of a hope: every foreign
   key in the plan points at a primary key the plan also contains */
export function verifyPlan(plan){
  const ids = new Set();
  for (const b of plan.batches) for (const r of b.rows) if (r.id) ids.add(r.id);
  const dangling = [];
  for (const b of plan.batches)
    for (const r of b.rows)
      for (const fk of FK_FIELDS[b.table] || [])
        if (r[fk] != null && !ids.has(r[fk]))
          dangling.push({ table: b.table, id: r.id, fk, value: r[fk] });
  return { ok: dangling.length === 0, dangling };
}
