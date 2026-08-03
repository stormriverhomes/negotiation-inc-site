/* ══ THE ONE ENDPOINT THAT HOLDS A KEY ═════════════════════════════════════
   The desk is client-side and stays that way: pricing a property never
   reaches this process, which is what makes the free tier genuinely free and
   what makes "nothing leaves your browser" a sentence the product can keep.

   This service exists for exactly one reason that cannot be done in a page:
   it holds the Anthropic key. The key is in Render's environment, never in a
   response, never in a log line, and never in anything served to a browser.

   FOUR THINGS THIS FILE IS RESPONSIBLE FOR, in order of how expensive they
   are to get wrong:

   1 · THE KEY DOES NOT LEAK. It is read once from process.env and referenced
       nowhere else. No route echoes the environment. No error message carries
       an upstream response body.

   2 · THE ENDPOINT IS NOT A FREE LLM FOR THE INTERNET. An open vision
       endpoint on a public domain is somebody else's compute budget, and they
       will find it. Three independent limits, and it FAILS CLOSED: with no
       access code configured, the route is disabled rather than open.

   3 · NOTHING IS STORED. The photographs exist in memory for the length of
       one request and are never written to disk, never logged, never cached.
       That is a stronger privacy promise than the one currently on the
       privacy page ("deleted within 24 hours") and it should replace it —
       there is no purge job to write because there is nothing to purge.

   4 · A DISHONEST ANSWER IS REJECTED HERE. The model is asked to refuse lines
       it cannot see; this file checks that it actually did, and drops any
       line that came back scored while claiming not to have been seen. The
       honesty is not left to the prompt alone. ═══════════════════════════ */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, SYSTEM, TOOL, LINES, LINE_IDS, RARELY_VISIBLE, userBlock } from './prompt.js';
import { mountBilling, billingState } from './billing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);              // Render terminates TLS in front of us

const KEY    = process.env.ANTHROPIC_API_KEY || '';
const ACCESS = process.env.NI_ACCESS_CODE || '';
const MOCK   = process.env.NI_MOCK === '1';
const PORT   = process.env.PORT || 10000;

/* every limit is an env var with a deliberately small default: a service that
   is generous by default is one nobody notices is being drained */
const N = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= 0 ? v : d; };
const LIM = {
  perIpHour:  N('NI_PER_IP_HOUR', 20),
  perDay:     N('NI_PER_DAY', 200),
  dailyUsd:   N('NI_DAILY_USD', 5),
  maxImages:  N('NI_MAX_IMAGES', 8),
  maxImageKb: N('NI_MAX_IMAGE_KB', 1600),   // AFTER the browser has resized
  maxTotalKb: N('NI_MAX_TOTAL_KB', 9000),
};
/* Sonnet 4.5 list price, used only to convert usage into a spend ceiling.
   Wrong by a factor of two is fine; the point is a ceiling that exists. */
const USD_IN = 3 / 1e6, USD_OUT = 15 / 1e6;

/* ── the counters ──────────────────────────────────────────────────────────
   In process, because a second instance costing twice the ceiling is a much
   smaller problem than a Redis dependency on a service with one route. Every
   window resets on its own clock rather than at midnight, so a burst at 23:59
   cannot buy a second allowance sixty seconds later. */
const hits = new Map();                 // ip → [timestamps]
let day = { at: Date.now(), n: 0, usd: 0 };
const rollDay = () => { if (Date.now() - day.at > 864e5) day = { at: Date.now(), n: 0, usd: 0 }; };
function ipOk(ip){
  const now = Date.now(), win = now - 36e5;
  const a = (hits.get(ip) || []).filter(t => t > win);
  if (a.length >= LIM.perIpHour) { hits.set(ip, a); return false; }
  a.push(now); hits.set(ip, a);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => t > win)) hits.delete(k);
  return true;
}

/* ── logging that cannot leak ──────────────────────────────────────────────
   Counts, milliseconds and outcomes. Never a photograph, never the note,
   never an upstream body, never a header. */
const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ══ THE READ ══════════════════════════════════════════════════════════════ */
app.post('/api/read', express.json({ limit: (LIM.maxTotalKb + 1000) + 'kb' }), async (req, res) => {
  const t0 = Date.now();
  const fail = (code, why, extra) => { log('read', code, why); res.status(code).json({ ok:false, error:why, ...extra }); };

  /* fails closed. An unconfigured deploy is a disabled endpoint, never an
     open one — this is the single most important line in the file. */
  if (!ACCESS) return fail(503, 'The photo read is not switched on for this deployment.');
  if (!KEY && !MOCK) return fail(503, 'The photo read is not switched on for this deployment.');
  if ((req.get('x-ni-access') || '') !== ACCESS)
    return fail(401, 'That access code is not right.');

  rollDay();
  if (day.n >= LIM.perDay || day.usd >= LIM.dailyUsd)
    return fail(429, 'The photo read has hit its cap for today. It resets within 24 hours.', { retryHours: 24 });
  const ip = req.ip || 'unknown';
  if (!ipOk(ip)) return fail(429, `That is ${LIM.perIpHour} reads in an hour from one place. Try again shortly.`);

  /* ── the request is a stranger, even when you wrote the page that sent it ── */
  const body = req.body;
  if (!body || typeof body !== 'object') return fail(400, 'No request body.');
  const images = Array.isArray(body.images) ? body.images : null;
  if (!images || !images.length) return fail(400, 'No photographs were sent.');
  if (images.length > LIM.maxImages) return fail(400, `That is more than ${LIM.maxImages} photographs.`);

  const OKTYPE = ['image/jpeg','image/png','image/webp'];
  let totalKb = 0;
  const content = [];
  for (let i = 0; i < images.length; i++){
    const im = images[i];
    if (!im || typeof im !== 'object') return fail(400, `Photograph ${i+1} is not readable.`);
    const mt = String(im.media_type || '');
    if (OKTYPE.indexOf(mt) < 0) return fail(400, `Photograph ${i+1} is not a JPEG, PNG or WebP.`);
    const data = String(im.data || '');
    /* SIZE FIRST, then shape. The cheap check that protects the process has to
       run before the one that inspects the payload, and an oversized image
       must report that it is oversized rather than reporting a format problem
       it does not have — a wrong error message sends somebody debugging the
       wrong thing for an afternoon. */
    const kb = Math.round(data.length * 0.75 / 1024);
    if (kb > LIM.maxImageKb) return fail(413, `Photograph ${i+1} is ${kb}KB — the limit is ${LIM.maxImageKb}KB after resizing.`);
    /* standard base64: no whitespace, padding only at the end, length a
       multiple of four. Anything else never reaches the upstream. */
    if (data.length < 64 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
      return fail(400, `Photograph ${i+1} is not valid image data.`);
    totalKb += kb;
    if (totalKb > LIM.maxTotalKb) return fail(413, 'Those photographs come to more than the request limit.');
    content.push({ type:'text', text:`Photograph ${i+1}` });
    content.push({ type:'image', source:{ type:'base64', media_type:mt, data } });
  }

  /* the client sends FACTS and a note. It does not send a prompt, a system
     message, a model name or a tool — none of those are read from the body,
     so this endpoint cannot be turned into a general-purpose LLM by anybody
     who can open developer tools. */
  const house = (body.house && typeof body.house === 'object') ? body.house : {};
  const num = v => { const n2 = Number(String(v ?? '').replace(/[^0-9.]/g,'')); return Number.isFinite(n2) && n2 > 0 ? n2 : null; };
  const facts = { sqft:num(house.sqft), beds:num(house.beds), baths:num(house.baths),
                  year:num(house.year), arv:num(house.arv) };
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 400) : '';
  content.push({ type:'text', text: userBlock(facts, notes, images.length) });

  try {
    const out = MOCK ? mockAnswer() : await callAnthropic(content);
    const clean = validate(out.data);
    day.n += 1;
    day.usd += (out.usage.input_tokens || 0) * USD_IN + (out.usage.output_tokens || 0) * USD_OUT;
    log('read ok', images.length + 'img', totalKb + 'kb', (Date.now()-t0) + 'ms',
        'seen ' + clean.stats.seen + '/17', 'day $' + day.usd.toFixed(3));
    res.json({ ok:true, ...clean, model: MOCK ? 'mock' : MODEL,
               usage: { in: out.usage.input_tokens || 0, out: out.usage.output_tokens || 0 } });
  } catch (e){
    /* an upstream body can contain anything, including things about the
       account. It is logged as a code and a class, and never forwarded. */
    const code = e && e.niStatus ? e.niStatus : 502;
    log('read upstream-fail', code, e && e.niKind || 'unknown');
    fail(code === 429 ? 429 : 502,
      code === 429 ? 'The read is busy. Try again in a moment.'
                   : 'The read could not be completed. Nothing was stored.');
  }
});

async function callAnthropic(content){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type:'tool', name: TOOL.name },
        messages: [{ role:'user', content }],
      }),
    });
  } finally { clearTimeout(timer); }
  if (!r.ok){ const e = new Error('upstream'); e.niStatus = r.status; e.niKind = 'http'; throw e; }
  const j = await r.json();
  const use = (j.content || []).find(c => c.type === 'tool_use');
  if (!use){ const e = new Error('no tool call'); e.niKind = 'shape'; throw e; }
  return { data: use.input, usage: j.usage || {} };
}

/* ── THE HONESTY CHECK ─────────────────────────────────────────────────────
   The prompt asks the model to refuse what it cannot see. This checks that it
   did, and it is not decoration: a line that comes back with a number while
   claiming not to have been seen is DROPPED rather than trusted, and the
   count of those is returned so the calibration pass can see it happening. */
function validate(d){
  const lines = {}, unseen = [], contradicted = [];
  const src = (d && typeof d.lines === 'object' && d.lines) ? d.lines : {};
  let seen = 0;
  for (const l of LINES){
    const r = src[l.id] || {};
    const sawIt = r.seen === true;
    let pc = (typeof r.pc === 'number' && Number.isFinite(r.pc)) ? Math.round(r.pc) : null;
    if (pc !== null) pc = Math.max(0, Math.min(100, pc));
    if (!sawIt && pc !== null){ contradicted.push(l.id); pc = null; }
    if (sawIt && pc === null){ contradicted.push(l.id); }
    const ok = sawIt && pc !== null;
    if (ok) seen++; else unseen.push(l.id);
    lines[l.id] = {
      seen: ok,
      pc: ok ? pc : null,
      conf: ok && ['high','med','low'].indexOf(r.conf) >= 0 ? r.conf : (ok ? 'low' : null),
      why: typeof r.why === 'string' ? r.why.slice(0, 240) : '',
      /* the lines a listing gallery almost never shows. Flagged so the desk
         can say "this one is unusual to be able to see" rather than treating
         a scored panel exactly like a scored kitchen. */
      rare: RARELY_VISIBLE.indexOf(l.id) >= 0,
    };
  }
  const flags = (Array.isArray(d && d.flags) ? d.flags : []).slice(0, 12).map(f => ({
    what:  String((f && f.what)  || '').slice(0, 160),
    where: String((f && f.where) || '').slice(0, 120),
    why:   String((f && f.why)   || '').slice(0, 200),
  })).filter(f => f.what);
  return {
    lines, flags,
    summary: String((d && d.summary) || '').slice(0, 600),
    stats: { seen, unseen: unseen.length, contradicted: contradicted.length,
             rareScored: LINE_IDS.filter(id => lines[id].seen && lines[id].rare).length },
    unseenIds: unseen,
  };
}

/* A deterministic answer so the whole pipeline — the browser resize, the
   gate, the caps, the validator, the panel that drops it onto the sliders —
   is testable end to end without spending a cent or holding a key. It also
   deliberately contains one CONTRADICTED line, so the honesty check is
   exercised on every mock run rather than only in theory. */
function mockAnswer(){
  const lines = {};
  const say = (id, seen, pc, conf, why) => lines[id] = { seen, pc, conf, why };
  say('roof',    false, null,  null,  'No photograph shows the roof plane. A shot from the street corner would.');
  say('found',   false, null,  null,  'No crawlspace, basement or foundation wall is visible.');
  say('siding',  true,  35,    'med', 'Chalking paint and two soft-looking boards below the front window, photo 1.');
  say('windows', true,  60,    'high','Single-glazed aluminium sliders throughout, photo 1 and photo 4.');
  say('hvac',    false, null,  null,  'No furnace, condenser or air handler in any frame.');
  say('plumb',   false, null,  null,  'Nothing under a sink is shown.');
  say('elec',    false, 55,    'low', 'CONTRADICTION FIXTURE: claims not seen and scores anyway.');
  say('water',   false, null,  null,  'No water heater in any frame.');
  say('kitchen', true,  85,    'high','Original oak cabinets, laminate counters, no dishwasher, photo 2.');
  say('bath1',   true,  70,    'high','Pink tile surround and a wall-hung basin, photo 5.');
  say('bath2',   true,  55,    'med', 'Second bath partially visible through the doorway in photo 6.');
  say('floors',  true,  75,    'high','Carpet over most of the plan, worn at the thresholds, photos 2-4.');
  say('paint',   true,  80,    'high','Original trim colour and scuffed walls in every interior frame.');
  say('doors',   true,  45,    'med', 'Hollow-core doors, hardware mismatched, photo 4.');
  say('drive',   true,  30,    'med', 'Cracked concrete apron at the kerb, photo 1.');
  say('yard',    true,  40,    'med', 'Overgrown to the fence line and one panel down, photo 7.');
  say('misc',    true,  35,    'low', 'Scope implies permits for the kitchen and the electrical work.');
  lines.elec.seen = false;                       // the contradiction, explicitly
  return { data: { lines, flags: [
    { what:'Water stain on the ceiling near the hall', where:'photo 3, top right',
      why:'It is a question about the roof or a supply line, not an answer about either. Look in the attic.' },
    { what:'Fresh paint on one basement wall only', where:'photo 8',
      why:'A single repainted wall is the classic cover for a moisture line. Ask when and why.' },
  ], summary:'These photographs show the inside well and the outside barely. Nothing here lets anybody conclude anything about the roof, the mechanicals or the foundation.' },
    usage: { input_tokens: 4200, output_tokens: 900 } };
}

/* ══ THE WAITLIST ══════════════════════════════════════════════════════════
   Before the payment rail exists, this is the only thing standing between a
   month of visitors and nothing at all. Every person the arcade and the drill
   bring in during pre-launch either lands in this table or is spent and gone,
   so the one behaviour that matters is that it NEVER SILENTLY SUCCEEDS: with
   no store configured it returns 503 and the page hands over the mailbox,
   rather than saying "thanks" into a void and being discovered on launch day
   with nobody to send to.

   It stores to Supabase, which is the same free tier auth will use — one
   dependency rather than two — and it has its own rate window so that a
   signup cannot spend the photo read's allowance or vice versa. */
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const LIST_ON = !!(SB_URL && SB_KEY);
const listHits = new Map();
function listOk(ip){
  const now = Date.now(), win = now - 36e5;
  const a = (listHits.get(ip) || []).filter(t => t > win);
  if (a.length >= 5) { listHits.set(ip, a); return false; }
  a.push(now); listHits.set(ip, a);
  if (listHits.size > 5000) for (const [k, v] of listHits) if (!v.some(t => t > win)) listHits.delete(k);
  return true;
}
app.post('/api/list', express.json({ limit: '4kb' }), async (req, res) => {
  if (!LIST_ON) { log('list 503 unconfigured'); return res.status(503).json({ ok:false, error:'The list is not open yet.' }); }
  if (!listOk(req.ip || 'unknown')) return res.status(429).json({ ok:false, error:'Too many, too fast.' });
  const b2 = req.body || {};
  const email = String(b2.email || '').trim().slice(0, 160).toLowerCase();
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(email))
    return res.status(400).json({ ok:false, error:'That is not an email address.' });
  const from = String(b2.from || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'plans';
  try {
    const r = await fetch(`${SB_URL}/rest/v1/waitlist`, {
      method: 'POST',
      headers: { 'content-type':'application/json', apikey: SB_KEY,
                 authorization: `Bearer ${SB_KEY}`,
                 /* a second signup from the same address is a person pressing
                    twice, not an error to show them */
                 Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ email, source: from }]),
    });
    if (!r.ok){ log('list upstream', r.status); return res.status(502).json({ ok:false, error:'The list could not be reached.' }); }
    /* the address itself is never written to a log — the count and the source
       are all that is needed to know the thing is working */
    log('list ok', from);
    res.json({ ok:true });
  } catch(e){
    log('list fail', (e && e.name) || 'unknown');
    res.status(502).json({ ok:false, error:'The list could not be reached.' });
  }
});

/* ══ BILLING ═══════════════════════════════════════════════════════════════
   Three routes in their own file, because the rule they exist to protect is
   worth stating in one place: the only thing that decides what somebody gets
   is `profiles.plan`, and the webhook is the only writer of it.

   Mounted HERE, above the static allowlist, so that /api/stripe reaches its
   raw-body parser before anything else touches the bytes a signature is
   computed over. */
mountBilling(app);

/* ══ HEALTH ════════════════════════════════════════════════════════════════
   Enough to diagnose a deploy, and nothing that helps anybody attack it: no
   key, no code, no counts by IP. */
app.get('/api/health', (_req, res) => {
  rollDay();
  res.json({ ok:true, service:'negotiation-inc', mock:MOCK,
    read: (ACCESS && (KEY || MOCK)) ? 'on' : 'off',
    list: LIST_ON ? 'on' : 'off',
    billing: billingState(),
    today: { reads: day.n, capReads: LIM.perDay, capUsd: LIM.dailyUsd },
    limits: { maxImages: LIM.maxImages, maxImageKb: LIM.maxImageKb, perIpHour: LIM.perIpHour } });
});

/* ══ THE SITE ══════════════════════════════════════════════════════════════
   The same static files Render has been serving all along, from the same
   origin as the API — which is why the page needs no CORS, and why a session
   cookie will work the day auth arrives.

   The repo root also now contains the server itself, so it is served from an
   allowlist of what a browser is ever meant to fetch rather than by handing
   out the directory and hoping. */
const SERVE = /\.(html|css|js|mjs|json|png|jpe?g|gif|svg|webp|ico|woff2?|txt|xml|webmanifest|map)$/i;
const NEVER = /^(server\.js|prompt\.js|billing\.js|package(-lock)?\.json|render\.yaml|test-api\.mjs|test-pay\.mjs|LAUNCH\.md|SUPABASE\.md|STRIPE\.md|\.env.*)$/i;
app.use((req, res, next) => {
  const p = decodeURIComponent(req.path).replace(/^\/+/, '');
  if (!p || p.endsWith('/')) return next();
  const base = p.split('/').pop();
  if (NEVER.test(base) || base.startsWith('.')) return res.status(404).type('txt').send('Not found');
  if (p.indexOf('..') >= 0) return res.status(400).type('txt').send('No');
  if (!SERVE.test(base)) return res.status(404).type('txt').send('Not found');
  next();
});
app.use(express.static(__dirname, {
  dotfiles: 'deny',
  index: 'index.html',
  extensions: ['html'],
  setHeaders(res, fp){
    if (/\.(woff2?|png|jpe?g|svg|webp|ico)$/i.test(fp)) res.setHeader('cache-control','public,max-age=604800');
    else if (/\.html$/i.test(fp)) res.setHeader('cache-control','no-cache');
  },
}));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok:false, error:'No such endpoint.' });
  res.status(404).sendFile(path.join(__dirname, '404.html'), err => {
    if (err) res.status(404).type('txt').send('Not found');
  });
});

if (process.env.NI_NO_LISTEN !== '1'){
  app.listen(PORT, () => log(`up on ${PORT} · read ${(ACCESS && (KEY||MOCK)) ? 'on' : 'OFF'}${MOCK ? ' · MOCK' : ''}`));
}
export default app;
