/* ══ SIGNING ═══════════════════════════════════════════════════════════════
   The thing that makes an electronic signature worth anything is not the
   picture of the name. It is the RECORD: who signed, when, what exactly they
   were looking at when they did it, that they agreed to do business
   electronically at all, and that the document has not changed since. A
   scribble on a screen with none of that behind it is a JPEG.

   So the centre of this module is the audit trail, and the signature image is
   a detail hung off it.

   WHAT THIS IS HONEST ABOUT
   -------------------------
   Federal law (ESIGN) and every state's version of UETA make an electronically
   signed purchase contract ordinary and unremarkable. They do NOT make every
   real-estate instrument electronically signable: a DEED that has to be
   notarised and recorded is a different animal from the contract that leads to
   it, and the rules for those live in state law and in what a particular
   county recorder will accept. This module raises that as a question rather
   than answering it, exactly like every other legal question in this product.

   And a second honesty, about evidence rather than law: a signature captured
   in person on YOUR laptop is a weaker record than one captured through a
   third party who emailed a unique link to an address only the signer
   controls, logged an IP you have no access to, and will testify to its own
   logs. In-person capture is fine and normal and is how a great many deals
   actually get signed at kitchen tables — but where it matters, or where the
   other side is not in the room, route it through a provider. The adapter at
   the bottom of this file is for exactly that.                             */

export const ESIGN_VERSION = 'ni-esign-1';

/* ── the consent, which is the part people skip ───────────────────────────
   ESIGN conditions the validity of an electronic record, in a consumer
   transaction, on the consumer having affirmatively consented to receive it
   electronically after being told certain things. Reciting them in five lines
   costs nothing and is the difference between a record and an argument. */
export const CONSENT_TEXT =
  'I agree to sign this document electronically. I understand that my '
+ 'electronic signature has the same effect as a handwritten one, that I may '
+ 'ask for a paper copy instead at no charge, that I may withdraw this consent '
+ 'before I sign, and that I will be given a copy of what I signed together '
+ 'with a record of when and how I signed it. To read and keep this document I '
+ 'need a device that opens PDF or Word files and an email address or another '
+ 'way to receive a copy.';

export const SIGN_STATES = ['draft', 'sent', 'viewed', 'partial', 'completed',
                            'declined', 'voided'];

/* A status may only move where it is allowed to move. The value of a status
   field is entirely in what it REFUSES: an envelope that can go from draft
   straight to completed is a field that records a wish. */
const ALLOWED = {
  draft:     ['sent', 'voided'],
  sent:      ['viewed', 'partial', 'completed', 'declined', 'voided'],
  viewed:    ['partial', 'completed', 'declined', 'voided'],
  partial:   ['completed', 'declined', 'voided'],
  completed: [],
  declined:  ['voided'],
  voided:    [],
};

export function canTransition(from, to){
  return !!(ALLOWED[from] || []).includes(to);
}

/* ── hashing what was actually signed ─────────────────────────────────────
   Not the template, not the terms — the exact bytes the signer looked at. If
   the file changes by one byte afterwards, this stops matching, and that is
   the whole point. */
export async function sha256Hex(bytes){
  const buf = await crypto.subtle.digest('SHA-256',
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Short, spoken-aloud form of a hash, for a certificate a human will read.
   Nobody checks 64 hex characters; a lot of people will check eight. */
export function shortHash(hex){
  return String(hex || '').slice(0, 8).toUpperCase().replace(/(.{4})(.{4})/, '$1-$2');
}

let seq = 0;
const rid = (now) => 'e' + (now || 0).toString(36) + (++seq).toString(36);

/* ── an envelope ──────────────────────────────────────────────────────────
   signers: [{ id?, name, role, email?, phone?, order? }]
   Routing order matters: a buyer countersigning before the seller has signed
   is a document nobody can explain later. */
export function newEnvelope({ documentId, documentName, documentHash,
                              signers = [], now = Date.now(), method = 'in_person',
                              note = null } = {}){
  if (!documentId) throw new Error('an envelope needs a document');
  if (!documentHash) throw new Error('an envelope needs the hash of what is being signed');
  if (!signers.length) throw new Error('an envelope needs somebody to sign it');
  const ordered = signers.map((s, i) => ({
    id: s.id || rid(now) + i,
    name: String(s.name || '').trim(),
    role: s.role || 'signer',
    email: s.email || null,
    phone: s.phone || null,
    order: s.order == null ? i + 1 : s.order,
    status: 'pending',
    signedAt: null, consentAt: null, signature: null, ip: null, agent: null,
  }));
  const unnamed = ordered.filter(s => !s.name);
  if (unnamed.length) throw new Error('every signer needs a name');
  return {
    id: rid(now), version: ESIGN_VERSION,
    documentId, documentName: documentName || null, documentHash,
    method, note,
    status: 'draft', createdAt: new Date(now).toISOString(),
    signers: ordered.sort((a, b) => a.order - b.order),
    audit: [event('created', { documentHash, signers: ordered.length }, now)],
  };
}

function event(type, detail, now){
  return { type, at: new Date(now || Date.now()).toISOString(), detail: detail || {} };
}

function put(env, patch, ev){
  return { ...env, ...patch, audit: [...env.audit, ev] };
}

/* ── who may sign right now ───────────────────────────────────────────────
   The rule is a rule, not a hint: the screen disables the button AND this
   refuses, because a disabled button is a CSS class. */
export function nextSigner(env){
  const pending = env.signers.filter(s => s.status === 'pending')
    .sort((a, b) => a.order - b.order);
  if (!pending.length) return null;
  const lowest = pending[0].order;
  return pending.filter(s => s.order === lowest);
}

export function canSign(env, signerId){
  if (env.status === 'completed') return { ok:false, why:'It is already signed by everybody.' };
  if (env.status === 'voided') return { ok:false, why:'This envelope was voided.' };
  if (env.status === 'declined') return { ok:false, why:'Somebody declined to sign it.' };
  if (env.status === 'draft') return { ok:false, why:'It has not been sent for signature yet.' };
  const s = env.signers.find(x => x.id === signerId);
  if (!s) return { ok:false, why:'That signer is not on this envelope.' };
  if (s.status === 'signed') return { ok:false, why:`${s.name} has already signed.` };
  if (s.status === 'declined') return { ok:false, why:`${s.name} declined.` };
  const turn = nextSigner(env) || [];
  if (!turn.some(x => x.id === signerId)){
    const waiting = turn.map(x => x.name).join(' and ');
    return { ok:false, why:`It is ${waiting}'s turn first.` };
  }
  return { ok:true };
}

export function send(env, { now = Date.now() } = {}){
  if (!canTransition(env.status, 'sent'))
    throw new Error(`an envelope cannot go from ${env.status} to sent`);
  return put(env, { status:'sent', sentAt: new Date(now).toISOString() },
    event('sent', { signers: env.signers.map(s => s.name) }, now));
}

export function markViewed(env, signerId, { now = Date.now(), ip = null, agent = null } = {}){
  const s = env.signers.find(x => x.id === signerId);
  if (!s) throw new Error('that signer is not on this envelope');
  const next = env.status === 'sent' ? 'viewed' : env.status;
  return put(env, { status: next,
    signers: env.signers.map(x => x.id === signerId
      ? { ...x, viewedAt: x.viewedAt || new Date(now).toISOString() } : x) },
    event('viewed', { signer: s.name, ip, agent }, now));
}

/* ── signing ──────────────────────────────────────────────────────────────
   Four things are recorded together or not at all: consent, intent, the
   image, and the hash of what was in front of them. */
export function sign(env, signerId, { signature, consent, documentHash,
                                      now = Date.now(), ip = null, agent = null,
                                      typed = null } = {}){
  const gate = canSign(env, signerId);
  if (!gate.ok) throw new Error(gate.why);
  if (consent !== true)
    throw new Error('a signature without recorded consent is not a signature');
  if (!signature && !typed)
    throw new Error('nothing was signed — no drawn or typed signature');
  if (!documentHash)
    throw new Error('nothing recorded what was on the screen when they signed');
  if (documentHash !== env.documentHash)
    throw new Error('the document has changed since this envelope was made. '
      + 'Make a new envelope rather than signing a different file.');

  const at = new Date(now).toISOString();
  const signers = env.signers.map(x => x.id === signerId
    ? { ...x, status:'signed', signedAt: at, consentAt: at,
        signature: signature || null, typed: typed || null, ip, agent }
    : x);
  const done = signers.every(s => s.status === 'signed');
  const status = done ? 'completed' : 'partial';
  if (!canTransition(env.status, status))
    throw new Error(`an envelope cannot go from ${env.status} to ${status}`);
  const s = env.signers.find(x => x.id === signerId);
  return put(env, { status, signers,
    completedAt: done ? at : (env.completedAt || null) },
    /* typed means TYPED, not "typed and we had nowhere to put a picture". A
       typed signature is still rendered to an image so it can be stamped into
       the document, so `signature` is set either way — and an earlier version
       read that as proof it had been drawn, which quietly recorded every typed
       signature as a drawn one on the certificate. */
    event('signed', { signer: s.name, role: s.role, ip, agent,
      consent: CONSENT_TEXT, documentHash, typed: !!typed }, now));
}

export function decline(env, signerId, { reason = null, now = Date.now() } = {}){
  const s = env.signers.find(x => x.id === signerId);
  if (!s) throw new Error('that signer is not on this envelope');
  if (!canTransition(env.status, 'declined'))
    throw new Error(`an envelope cannot go from ${env.status} to declined`);
  return put(env, { status:'declined',
    signers: env.signers.map(x => x.id === signerId
      ? { ...x, status:'declined', declinedAt: new Date(now).toISOString(), reason } : x) },
    event('declined', { signer: s.name, reason }, now));
}

export function voidEnvelope(env, { reason = null, now = Date.now() } = {}){
  if (!canTransition(env.status, 'voided'))
    throw new Error(`an envelope cannot go from ${env.status} to voided`);
  return put(env, { status:'voided', voidedAt: new Date(now).toISOString() },
    event('voided', { reason }, now));
}

/* ── the certificate ──────────────────────────────────────────────────────
   Built as the same block vocabulary docs.mjs uses, so it renders with the
   components already in the product and prints on the back of the contract
   with no new code at all. */
export function certificate(env, { title = 'Certificate of completion' } = {}){
  const fmt = iso => iso
    ? new Date(iso).toLocaleString('en-US', { dateStyle:'long', timeStyle:'long' })
    : null;
  const blocks = [
    { t:'title', text: title },
    { t:'meta', rows: [
      ['Document', env.documentName || env.documentId],
      ['Fingerprint', shortHash(env.documentHash) + '  (SHA-256)'],
      ['Envelope', env.id],
      ['Status', env.status],
      env.completedAt ? ['Completed', fmt(env.completedAt)] : null,
    ].filter(Boolean) },
    { t:'p', text: 'This record accompanies the document above. The fingerprint is a '
      + 'SHA-256 hash of the exact file each person signed; if the file changes by a '
      + 'single character the fingerprint no longer matches.' },
    { t:'h', text:'Who signed' },
  ];
  for (const s of env.signers){
    blocks.push({ t:'clause', n: s.order, h: `${s.name} — ${s.role}`, text:
      (s.status === 'signed'
        ? `Signed ${fmt(s.signedAt)}.`
        : s.status === 'declined' ? `Declined${s.reason ? ': ' + s.reason : ''}.`
        : 'Has not signed yet.')
      + (s.email ? ` Contact: ${s.email}.` : '')
      + (s.ip ? ` Recorded from ${s.ip}.` : '')
      + (s.status === 'signed'
        ? ` Consent to sign electronically was recorded at the same moment${
            s.typed ? ', with a typed signature' : ', with a drawn signature'}.`
        : '') });
  }
  blocks.push({ t:'h', text:'What happened, in order' });
  blocks.push({ t:'list', items: env.audit.map(a =>
    `${fmt(a.at)} — ${a.type}${a.detail && a.detail.signer ? ' · ' + a.detail.signer : ''}`) });
  blocks.push({ t:'h', text:'The consent each signer agreed to' });
  blocks.push({ t:'p', text: CONSENT_TEXT });
  return { blocks, status: env.status };
}

/* ── the questions signing raises ─────────────────────────────────────────
   Same grammar as every other legal flag in this product: what is federal and
   settled says so and cites itself; everything that moves by state is a
   question for an attorney, never an answer invented here. */
export const ESIGN_FLAGS = [
  { key:'esign_valid', level:'VERIFIED', severity:'medium',
    title:'An electronically signed contract is a contract',
    body:'Federal law provides that a signature, contract or record may not be denied '
       + 'legal effect solely because it is electronic, and that a contract may not be '
       + 'denied legal effect solely because an electronic signature was used in its '
       + 'formation. Nearly every state has adopted a version of the same rule.',
    cite:'Electronic Signatures in Global and National Commerce Act, '
       + '15 U.S.C. § 7001(a); Uniform Electronic Transactions Act § 7' },

  { key:'esign_consumer_consent', level:'VERIFIED', severity:'high',
    title:'Consent has to be taken before, not assumed after',
    body:'Where a record is one the law requires be given to a consumer in writing, the '
       + 'federal rule conditions electronic delivery on the consumer having '
       + 'affirmatively consented, after being told what hardware and software they '
       + 'need and that they can have paper instead. The desk records that consent '
       + 'with every signature — do not remove it to save a tap.',
    cite:'15 U.S.C. § 7001(c)' },

  { key:'esign_deed', level:'QUESTION', severity:'high',
    title:'A deed is not the same as a contract',
    body:'The purchase agreement is ordinary to sign electronically. The instrument '
       + 'that actually conveys the property is a different question: it usually has to '
       + 'be notarised and recorded, and whether an electronic notarisation and an '
       + 'electronic recording are accepted depends on the state AND on what that '
       + 'county recorder takes. This is a closing-table question, not a software one.',
    ask:'Ask your closing attorney: does this county accept remote online notarisation '
      + 'and electronic recording, or does the deed need wet ink?' },

  { key:'esign_in_person', level:'QUESTION', severity:'medium',
    when: env => !env || env.method === 'in_person',
    title:'Signed on your own device — know what that record is worth',
    body:'A signature captured here is a good contemporaneous record and it is how a '
       + 'great many deals are signed at kitchen tables. It is still weaker evidence '
       + 'than a third party who emailed a unique link to an address only the signer '
       + 'controls and keeps its own logs. If the other side is not in the room, or the '
       + 'deal is big enough to be worth arguing about, route it through a provider.',
    ask:'Decide per deal: in the room, sign here. Not in the room, send a link.' },

  { key:'esign_copy', level:'QUESTION', severity:'medium',
    title:'They have to end up with a copy',
    body:'A signer is entitled to a copy of what they signed and the record of how they '
       + 'signed it. Send both, the same day, and keep proof that you did.',
    ask:'Send the signed file and the certificate to the seller before you leave.' },
];

export function esignFlags(env){
  return ESIGN_FLAGS.filter(f => { try { return f.when ? f.when(env) : true; }
    catch(_){ return true; } })
    .map(({ when, ...rest }) => rest)
    .sort((a, b) => (a.severity === b.severity) ? 0 : a.severity === 'high' ? -1 : 1);
}

/* ── remote signing, through somebody who does it for a living ────────────
   One adapter shape, so the product does not learn a vendor's vocabulary. The
   fetch is injected, which is why this is testable today, with no account and
   no key — and why the key, when there is one, lives in a server environment
   variable and never comes near this file. */
export function makeAdapter({ name, baseUrl, token, fetchImpl } = {}){
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) throw new Error('no fetch available');
  if (!baseUrl) throw new Error('an adapter needs a base URL');

  const call = async (method, path, body) => {
    const res = await f(baseUrl.replace(/\/$/, '') + path, {
      method,
      headers: {
        'content-type':'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = res && typeof res.text === 'function' ? await res.text() : '';
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch(_){}
    if (!res || !res.ok){
      const detail = (json && (json.message || json.error)) || text || '';
      const err = new Error(`${name || 'provider'} said ${res ? res.status : '?'}`
        + (detail ? ': ' + String(detail).slice(0, 200) : ''));
      err.status = res ? res.status : 0;
      err.retryable = !!res && (res.status === 429 || res.status >= 500);
      throw err;
    }
    return json;
  };

  return {
    name: name || 'provider',
    async createEnvelope({ documentName, fileBase64, signers, subject, message }){
      const out = await call('POST', '/api/v1/documents', {
        title: documentName, subject, message,
        recipients: signers.map((s, i) => ({ name: s.name, email: s.email,
          role: (s.role || 'SIGNER').toUpperCase(), signingOrder: s.order == null ? i + 1 : s.order })),
        document: fileBase64,
      });
      return { providerId: String(out && (out.id ?? out.documentId ?? '')),
               raw: out };
    },
    async send(providerId){
      return call('POST', `/api/v1/documents/${providerId}/send`, {});
    },
    async status(providerId){
      const out = await call('GET', `/api/v1/documents/${providerId}`);
      return { status: normaliseStatus(out && out.status),
               signers: (out && (out.recipients || [])).map(r => ({
                 name: r.name, email: r.email,
                 status: normaliseStatus(r.signingStatus || r.status),
                 signedAt: r.signedAt || null })),
               raw: out };
    },
    async download(providerId){
      const out = await call('GET', `/api/v1/documents/${providerId}/download`);
      return out && (out.downloadUrl || out.url) ? { url: out.downloadUrl || out.url } : { url:null, raw:out };
    },
    async voidEnvelope(providerId, reason){
      return call('DELETE', `/api/v1/documents/${providerId}`, { reason });
    },
  };
}

/* Providers each have their own words for the same five things. Mapping them
   once here means the rest of the product never learns a vendor's vocabulary
   and swapping provider does not touch a single screen. */
export function normaliseStatus(raw){
  const s = String(raw || '').toLowerCase();
  if (/complete|signed|finish/.test(s)) return 'completed';
  if (/declin|reject/.test(s)) return 'declined';
  if (/void|cancel|delete/.test(s)) return 'voided';
  if (/partial/.test(s)) return 'partial';
  if (/view|open/.test(s)) return 'viewed';
  if (/sent|pending|waiting/.test(s)) return 'sent';
  if (/draft|created/.test(s)) return 'draft';
  return 'sent';
}
