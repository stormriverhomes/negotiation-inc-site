/* ══ THE DESK API ══════════════════════════════════════════════════════════
   Express, and nothing else — the same dependency posture as billing.js.
   Mount into the existing Render service; it does not want a box of its own.

   ── THE RULE THIS FILE EXISTS TO ENFORCE ──────────────────────────────────
   THE BROWSER IS NOT TRUSTED TO DECIDE WHETHER A CALL IS LEGAL.

   The dial button in the app is disabled by canDial(), which is good product
   and worth nothing as a control: a disabled button is a CSS class, and the
   endpoint behind it is a POST anyone can craft. So /voice/outbound runs the
   identical check again, server-side, against the same module, and refuses
   with spoken TwiML if the answer changed — because between the page loading
   at 8:55pm and the click at 9:01pm, it did change.

   Two checks, one module, no second opinion. If the two ever disagree, the
   server wins and the audit log records that they disagreed.

   ── SECRETS ───────────────────────────────────────────────────────────────
   Every credential is read from the environment at request time and never
   logged. TWILIO_AUTH_TOKEN in particular must never reach a response body:
   it is the webhook signing key, and anyone holding it can forge a status
   callback that un-suppresses a number.                                    */

import express from 'express';
import { canDial, toE164, nextOpen } from './dialrules.mjs';
import { classify, validateMessage, withFooter, isSuppressed, makeMailer }
  from './mail.mjs';
import { makeServiceDb, startScheduler, tick } from './scheduler.mjs';
import * as sequences from './sequences.mjs';
import { accessToken, verifySignature, twimlOutbound, twimlInbound, twimlWhisper,
         twimlVoicemail, twimlReject, twimlSms, classifyInbound } from './telephony.mjs';

export function mountDesk(app, opts = {}){
  const {
    /* injectable so the tests run without a database or an account */
    db = null,
    env = process.env,
    baseUrl = () => env.DESK_BASE_URL || 'https://api.negotiationinc.com',
    log = () => {},
  } = opts;

  const cred = () => ({
    accountSid:   env.TWILIO_ACCOUNT_SID,
    authToken:    env.TWILIO_AUTH_TOKEN,
    apiKeySid:    env.TWILIO_API_KEY_SID,
    apiKeySecret: env.TWILIO_API_KEY_SECRET,
    twimlAppSid:  env.TWILIO_TWIML_APP_SID,
  });

  const form = express.urlencoded({ extended: false });
  const xml  = (res, body) => res.type('text/xml').send(body);

  /* Twilio signs the URL it actually called. Behind Render's proxy the
     request thinks it is http on an internal host, so the public base is
     configured rather than inferred — getting this wrong makes every
     signature fail in production and pass in development, which is the
     worst possible arrangement. */
  const fullUrl = req => baseUrl().replace(/\/+$/,'') + req.originalUrl;

  function signed(req, res, next){
    const { authToken } = cred();
    if (!authToken){ log('webhook refused: no auth token configured'); return res.sendStatus(500); }
    if (!verifySignature(fullUrl(req), req.body || {}, authToken,
                         req.get('X-Twilio-Signature'))){
      log('webhook refused: bad signature', { path: req.path });
      return res.sendStatus(403);
    }
    next();
  }

  /* ── the softphone's credential ─────────────────────────────────────────
     Guarded by the caller's own session, not by a Twilio signature: this is
     the one endpoint the browser calls directly. `requireUser` is supplied
     by the host app so this file does not grow its own idea of auth. */
  app.post('/desk/voice/token', express.json(), async (req, res) => {
    const user = opts.requireUser ? await opts.requireUser(req) : null;
    if (opts.requireUser && !user) return res.status(401).json({ error:'sign in' });
    const c = cred();
    if (!c.accountSid || !c.apiKeySid || !c.apiKeySecret)
      return res.status(503).json({ error:'telephony is not configured yet' });
    try {
      const identity = 'u-' + String(user ? user.id : 'demo').replace(/[^A-Za-z0-9_.\-]/g,'');
      res.json({ token: accessToken({ ...c, identity }), identity, ttl: 3600 });
    } catch (e){
      log('token mint failed', { message: e.message });
      res.status(500).json({ error:'could not issue a token' });
    }
  });

  /* ── OUTBOUND: the second, real compliance check ────────────────────────── */
  app.post('/desk/voice/outbound', form, signed, async (req, res) => {
    const to = toE164(req.body.To || req.body.to);
    const from = req.body.From || req.body.callerId;
    const leadId = req.body.leadId || null;
    if (!to) return xml(res, twimlReject('That number is not dialable.'));

    let ctx = { e164: to, state: req.body.state || null, timezone: req.body.timezone || null };
    let callsToday = 0, suppressed = false, suppressionReason = null;
    if (db){
      const s = await db.suppression(to);            // { suppressed, reason } | null
      if (s && s.suppressed){ suppressed = true; suppressionReason = s.reason; }
      callsToday = await db.callsToday(to);
      const l = leadId ? await db.leadContext(leadId) : null;
      if (l){ ctx.state = ctx.state || l.state; ctx.timezone = ctx.timezone || l.timezone; }
    }

    const verdict = canDial({ ...ctx, suppressed, suppressionReason, callsToday });
    if (!verdict.allowed){
      log('outbound refused server-side', { code: verdict.code, leadId });
      if (db) await db.audit({ actor:'system', action:'dial_refused',
        detail:{ code: verdict.code, why: verdict.why, to, leadId } });
      return xml(res, twimlReject(verdict.why));
    }

    const callerId = from || (db ? await db.callerIdFor(leadId, to) : null);
    if (!callerId) return xml(res, twimlReject('No outbound number is configured.'));

    if (db) await db.callStarted({ to, from: callerId, leadId,
      userId: req.body.userId || null, twilioSid: req.body.CallSid });

    const b = baseUrl().replace(/\/+$/,'');
    xml(res, twimlOutbound({ to, callerId,
      record: String(req.body.record ?? 'true') !== 'false',
      statusCallback:    `${b}/desk/voice/status`,
      recordingCallback: `${b}/desk/voice/recording` }));
  });

  /* ── INBOUND ────────────────────────────────────────────────────────────── */
  app.post('/desk/voice/inbound', form, signed, async (req, res) => {
    const from = toE164(req.body.From);
    const ours = toE164(req.body.To);
    const b = baseUrl().replace(/\/+$/,'');
    let identity = null, mobile = env.DESK_FALLBACK_MOBILE || null, line = 'Call from a lead.';
    if (db){
      const who = await db.ownerOfNumber(ours);      // { identity, mobile } | null
      if (who){ identity = who.identity; mobile = who.mobile || mobile; }
      const lead = await db.leadByPhone(from);
      if (lead) line = `Call from ${lead.name || 'a lead'} about ${lead.address || 'a property'}.`;
      await db.callStarted({ to: ours, from, inbound:true, leadId: lead ? lead.id : null,
        twilioSid: req.body.CallSid });
    }
    xml(res, twimlInbound({ identity, mobile,
      whisper: `${b}/desk/voice/whisper?line=${encodeURIComponent(line)}`,
      voicemailAction: `${b}/desk/voice/voicemail` }));
  });

  app.post('/desk/voice/whisper', form, signed, (req, res) =>
    xml(res, twimlWhisper({ line: req.query.line })));

  app.post('/desk/voice/voicemail', form, signed, async (req, res) => {
    /* DialCallStatus tells us whether a human took it. Only an unanswered
       call becomes a missed call and a voicemail; a completed one just ends. */
    const status = req.body.DialCallStatus;
    if (status === 'completed') return xml(res, '<?xml version="1.0" encoding="UTF-8"?><Response/>');
    if (db) await db.markMissed({ twilioSid: req.body.CallSid });
    const b = baseUrl().replace(/\/+$/,'');
    xml(res, twimlVoicemail({ recordingCallback: `${b}/desk/voice/recording` }));
  });

  app.post('/desk/voice/status', form, signed, async (req, res) => {
    if (db) await db.callEnded({
      twilioSid: req.body.CallSid,
      status:    req.body.CallStatus || req.body.DialCallStatus,
      duration:  parseInt(req.body.CallDuration || req.body.DialCallDuration || '0', 10) || 0,
    });
    res.sendStatus(204);
  });

  app.post('/desk/voice/recording', form, signed, async (req, res) => {
    if (db) await db.recordingReady({
      twilioSid: req.body.CallSid,
      url:       req.body.RecordingUrl,
      seconds:   parseInt(req.body.RecordingDuration || '0', 10) || 0,
    });
    res.sendStatus(204);
  });

  /* ── SMS ────────────────────────────────────────────────────────────────
     The one place an opt-out can arrive, so the one place it is recognised.
     A STOP writes a suppression row BEFORE anything else happens, because
     the next thing after this handler might be a dial. */
  app.post('/desk/sms/inbound', form, signed, async (req, res) => {
    const from = toE164(req.body.From);
    const ours = toE164(req.body.To);
    const body = req.body.Body || '';
    const verdict = classifyInbound(body);

    if (db){
      if (verdict.kind === 'stop')
        await db.suppress({ e164: from, reason:'sms_stop', source:'inbound sms' });
      if (verdict.kind === 'start')
        await db.unsuppress({ e164: from, reason:'sms_stop' });
      await db.messageReceived({ from, to: ours, body, kind: verdict.kind,
        twilioSid: req.body.MessageSid });
      await db.audit({ actor:'system', action:'sms_in',
        detail:{ from, kind: verdict.kind } });
    }
    xml(res, twimlSms(verdict.reply));
  });

  /* ── a read-only answer for the UI, so the button and the server agree ── */
  app.post('/desk/can-dial', express.json(), async (req, res) => {
    const to = toE164(req.body.e164);
    if (!to) return res.json({ allowed:false, code:'bad_number', why:'Not a dialable number.' });
    let suppressed = false, suppressionReason = null, callsToday = 0;
    if (db){
      const s = await db.suppression(to);
      if (s && s.suppressed){ suppressed = true; suppressionReason = s.reason; }
      callsToday = await db.callsToday(to);
    }
    const args = { e164:to, state:req.body.state, timezone:req.body.timezone,
                   suppressed, suppressionReason, callsToday };
    const v = canDial(args);
    res.json(v.allowed ? v : { ...v, opensAt: nextOpen(args) });
  });

  /* ── readiness ────────────────────────────────────────────────────────
     Reports which secrets are PRESENT and never what they are. A health
     endpoint that echoes configuration is a health endpoint that leaks it,
     and this one is unauthenticated on purpose so the app can ask before
     anybody has signed in. Booleans only — and the names of the missing ones,
     which are already public knowledge in the runbook. */
  /* bumped whenever the calling rules change shape, so a browser running an
     old cached build can be told rather than quietly dialling on old law */
  const RULES_VERSION = 'dialrules-1';

  const NEEDED = {
    twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY_SID', 'TWILIO_API_KEY_SECRET',
             'TWILIO_TWIML_APP_SID', 'TWILIO_AUTH_TOKEN'],
    database: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE'],
    email: ['RESEND_API_KEY'],
    streetview: ['GOOGLE_TILES_KEY'],
    assist: ['ANTHROPIC_API_KEY'],
  };


  /* ══ THE SCHEDULER ══════════════════════════════════════════════════════
     The tick STOPS things and never sends things — the full argument lives
     at the top of desk/scheduler.mjs. It runs only when the database is
     configured, and its due list is served to any signed-in desk so the
     Follow-ups badge is right even on a laptop that has been shut all day. */
  let scheduler = null;
  function ensureScheduler(){
    if (scheduler) return scheduler;
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) return null;
    const sdb = opts.serviceDb || makeServiceDb({ url: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_ROLE, fetchImpl: opts.fetchImpl });
    scheduler = startScheduler({ db: sdb, sequences, log,
      gate: (e164, facts) => canDial({ e164, state: facts.state,
        timezone: facts.timezone, suppressed: facts.suppressed }),
      intervalMs: +env.NI_TICK_MS || 5 * 60 * 1000 });
    return scheduler;
  }
  if (env.NI_SCHEDULER !== 'off') ensureScheduler();

  app.get('/desk/followups/due', async (_, res) => {
    const sch = ensureScheduler();
    if (!sch) return res.status(503).json({ ok:false,
      why:'The scheduler needs SUPABASE_URL and SUPABASE_SERVICE_ROLE.' });
    const r = sch.last() || await sch.run();
    res.json({ ok: !r.error, ...r });
  });

  app.post('/desk/followups/tick', async (_, res) => {
    const sch = ensureScheduler();
    if (!sch) return res.status(503).json({ ok:false, why:'not configured' });
    res.json({ ok:true, ...(await sch.run()) });
  });

  /* ══ THE ASSIST ═════════════════════════════════════════════════════════
     The command bar's model pass, exactly as the resolver contract promised
     on the day the registry was written: THE MODEL PICKS WHICH TYPED TOOL,
     AND NOTHING ELSE MOVES. The registry, the gates, and the provenance
     rule are the client's; this endpoint returns a tool name and arguments,
     never performs anything, and a tool name outside the allowlist is
     discarded as if the model had said nothing.

     The key lives in Render's environment. It is read at request time,
     never logged, and cannot appear in a response because the response is
     built only from the allowlist and the model's routing choice. */
  const ASSIST_TOOLS = ['search_leads','summarize_call','prefill_underwrite',
    'update_lead','draft_sms','queue_sequence','draft_offer','draft_contract',
    'draft_option'];

  app.post('/desk/assist', express.json(), async (req, res) => {
    const key = env.ANTHROPIC_API_KEY;
    if (!key) return res.status(503).json({ ok:false,
      why:'ANTHROPIC_API_KEY is not set — the desk falls back to its own resolver.' });
    const text = String((req.body || {}).text || '').slice(0, 500);
    if (!text.trim()) return res.status(400).json({ ok:false, why:'nothing to resolve' });
    const onLead = !!(req.body || {}).onLead;
    try {
      const f = opts.fetchImpl || fetch;
      const r = await f('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers: { 'x-api-key': key, 'anthropic-version':'2023-06-01',
          'content-type':'application/json' },
        body: JSON.stringify({
          model: env.NI_ASSIST_MODEL || 'claude-3-5-haiku-latest',
          max_tokens: 200,
          system: 'You route a CRM command to exactly one tool. Tools: '
            + ASSIST_TOOLS.join(', ') + '. '
            + (onLead ? 'A lead is open. ' : 'No lead is open — only search_leads works without one. ')
            + 'Reply with ONLY a JSON object: {"tool":"<name>","arg":"<the user\\u0027s text, '
            + 'trimmed to what the tool needs>"}. Unknown or unsafe requests route to search_leads.',
          messages: [{ role:'user', content: text }],
        }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) return res.status(502).json({ ok:false,
        why:'the model said ' + r.status });
      const out = (((body || {}).content || [])[0] || {}).text || '';
      let pick = null;
      try { pick = JSON.parse(out.replace(/^[^{]*/, '').replace(/[^}]*$/, '')); }
      catch(_){}
      if (!pick || !ASSIST_TOOLS.includes(pick.tool))
        return res.json({ ok:true, tool:'search_leads', arg: text, fallback:true });
      res.json({ ok:true, tool: pick.tool,
        arg: String(pick.arg || text).slice(0, 500) });
    } catch(e){
      res.status(502).json({ ok:false, why:'could not reach the model' });
    }
  });


  /* ══ EMAIL ══════════════════════════════════════════════════════════════
     THE SAME DOCTRINE AS THE DIAL BUTTON. The browser classifies a message
     and refuses to send a commercial one with no address and no opt-out —
     good product, worth nothing as a control, because the endpoint behind
     the disabled button is a POST anyone can craft. So the classification
     and the validation both run AGAIN here, against the same module, and
     the server's answer wins.

     Two things this route will not do, on purpose:
       · it will not accept a `kind` from the client as final. A caller may
         DECLARE transactional; the server re-reads the text, and a declared
         transactional that reads as a pitch is treated as commercial and
         must carry its footer. Lying to your own compliance check is the
         only way this system fails, so it is the one input not trusted.
       · it will not send to an address on the suppression ledger, whatever
         the caller believes about it.

     RESEND_API_KEY stays in this process. It rides in a request header to
     Resend and appears in no response, no log line and no error message. */
  app.post('/desk/email/send', express.json({ limit:'12mb' }), async (req, res) => {
    const user = opts.requireUser ? await opts.requireUser(req) : null;
    if (opts.requireUser && !user) return res.status(401).json({ ok:false, why:'sign in' });

    const key = env.RESEND_API_KEY;
    if (!key) return res.status(503).json({ ok:false,
      why:'RESEND_API_KEY is not set — email is not live yet.' });

    const b = req.body || {};
    const to = String(b.to || '').trim();
    const from = String(b.from || env.DESK_MAIL_FROM || '').trim();
    const subject = String(b.subject || '').slice(0, 200);
    let body = String(b.body || '').slice(0, 40000);
    const postalAddress = String(b.postalAddress || '').trim();
    const unsubscribeUrl = String(b.unsubscribeUrl || '').trim() || null;

    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(to))
      return res.status(400).json({ ok:false, why:'that is not an address' });

    /* THE SERVER RE-READS THE TEXT. A declared kind is a hint, never a pass. */
    const kind = classify(subject, body, null) === 'commercial'
      ? 'commercial' : classify(subject, body, b.kind);

    if (db && db.emailSuppressed){
      const sup = await db.emailSuppressed(to);
      if (sup && sup.suppressed){
        log('email refused: suppressed', { reason: sup.reason });
        return res.status(409).json({ ok:false, code:'suppressed',
          why: 'That address asked not to be written to' + (sup.reason ? ' — ' + sup.reason : '') + '.' });
      }
    }

    /* A commercial message the caller forgot to dress gets dressed, once,
       rather than bounced — but only if there is a real address to dress it
       with. Without one it is refused, because the footer would be a lie. */
    if (kind === 'commercial' && postalAddress
        && !validateMessage({ subject, body, kind, from, postalAddress,
                              unsubscribeUrl }).ok)
      body = withFooter(body, { postalAddress, unsubscribeUrl,
        sender: String(b.sender || '').trim() || null });

    const v = validateMessage({ subject, body, kind, from, postalAddress,
                               unsubscribeUrl });
    if (!v.ok){
      log('email refused', { kind: v.kind, problems: v.problems });
      return res.status(400).json({ ok:false, code:'invalid', kind: v.kind,
        problems: v.problems });
    }

    /* Attachments arrive as base64 from the browser, which already holds the
       signed bytes — the server never re-derives a document it did not build. */
    const attachments = Array.isArray(b.attachments)
      ? b.attachments.slice(0, 4)
          .filter(a => a && a.filename && a.content)
          .map(a => ({ filename: String(a.filename).slice(0, 120),
                       content: String(a.content) }))
      : [];

    try {
      const mailer = opts.mailer || makeMailer({ apiKey: key,
        fetchImpl: opts.fetchImpl });
      const sent = await mailer.send({ from, to, subject, text: body,
        replyTo: b.replyTo || undefined,
        attachments: attachments.length ? attachments : undefined });
      if (db && db.audit) await db.audit({ actor: user ? user.id : 'system',
        action:'email_sent', detail:{ to, kind: v.kind, subject,
          leadId: b.leadId || null, providerId: sent.id } });
      res.json({ ok:true, id: sent.id, kind: v.kind });
    } catch(e){
      /* e.message carries the provider's status and its own words. It cannot
         carry the key: the key never enters the message, only a header. */
      log('email send failed', { status: e.status || 0, retryable: !!e.retryable });
      res.status(e.retryable ? 503 : 502).json({ ok:false, code:'provider',
        retryable: !!e.retryable, why: e.message });
    }
  });


  /* ══ STREET VIEW, PROXIED ═══════════════════════════════════════════════
     The image comes from Google; the key stays here. A key in a client-side
     URL is a key in every seller's browser history, so the browser asks THIS
     server for the picture and never learns how the picture was paid for. */
  app.get('/desk/streetview', async (req, res) => {
    const key = env.GOOGLE_TILES_KEY;
    if (!key) return res.status(503).json({ ok:false,
      why:'GOOGLE_TILES_KEY is not set.' });
    const q = String(req.query.q || '').slice(0, 200);
    if (!q.trim()) return res.status(400).json({ ok:false, why:'no address' });
    try {
      const f = opts.fetchImpl || fetch;
      const r = await f('https://maps.googleapis.com/maps/api/streetview'
        + '?size=640x360&fov=75&source=outdoor&location='
        + encodeURIComponent(q) + '&key=' + encodeURIComponent(key));
      if (!r.ok) return res.status(502).json({ ok:false, why:'google said ' + r.status });
      const buf = Buffer.from(await r.arrayBuffer());
      res.set('content-type', r.headers && r.headers.get
        ? (r.headers.get('content-type') || 'image/jpeg') : 'image/jpeg');
      res.set('cache-control', 'private, max-age=86400');
      res.send(buf);
    } catch(_){
      res.status(502).json({ ok:false, why:'could not reach street view' });
    }
  });

  app.get('/desk/health', (_, res) => {
    const env = process.env || {};
    const has = k => typeof env[k] === 'string' && env[k].trim().length > 0;
    const systems = {};
    for (const [name, keys] of Object.entries(NEEDED)){
      const missing = keys.filter(k => !has(k));
      systems[name] = { ready: missing.length === 0, missing };
    }
    res.json({
      ok: true, service:'desk',
      stage: env.NI_STAGE === 'live' ? 'live' : 'test',
      systems,
      /* the one number worth reporting: whether the calling rules are the
         same build the browser is running */
      rules: RULES_VERSION,
    });
  });


  return app;
}

/* Stand-alone for local development: `node desk/server.mjs` */
if (import.meta.url === `file://${process.argv[1]}`){
  const app = express();
  app.get('/health', (_, res) => res.json({ ok:true, service:'desk' }));
  mountDesk(app, { log: (...a) => console.log('[desk]', ...a) });
  const port = process.env.PORT || 8787;
  app.listen(port, () => console.log('desk api on :' + port));
}
