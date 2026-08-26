/* ══ EMAIL ═════════════════════════════════════════════════════════════════
   The desk has been telling people to do something it would not help with.
   The signing certificate says, in the product's own words, that a signer is
   entitled to a copy of what they signed and of how they signed it — and
   there was no way to send one. `email` has sat in the sequence channel list
   since the day sequences shipped, declared and dead. Both close here.

   THE RULE THIS FILE EXISTS TO ENFORCE

   Not all email is the same email, and treating it as if it were is how an
   honest business acquires a spam problem. Federal law draws the line at
   PURPOSE, not at volume:

     · A TRANSACTIONAL or relationship message — here is the contract you
       just signed, here is the appointment we agreed — is exempt from most
       of CAN-SPAM's requirements, because it is a message the recipient
       asked for by transacting.

     · A COMMERCIAL message — one whose primary purpose is to advertise or
       promote — must carry a valid physical postal address and a working
       opt-out, must not deceive in its header or subject line, and the
       opt-out must be honoured within ten business days.
       [15 U.S.C. § 7704; 16 CFR Part 316]

   So every message this module sends is CLASSIFIED first, and a commercial
   message with no address and no opt-out is REFUSED — the same way a text
   with no STOP line is refused, for the same reason. The classifier is
   deliberately eager to call something commercial: a false commercial adds
   a footer nobody minds, a false transactional is a violation.

   And the suppression ledger applies here too. A person who told you to stop
   told you to stop.                                                        */

export const KINDS = ['transactional', 'commercial'];

/* Phrases whose presence means somebody is being sold to, whatever the
   sender believed they were writing. Kept blunt on purpose. */
const COMMERCIAL_RE = /\b(cash offer|make you an offer|buy your (house|home|property)|sell(ing)? your (house|home|property)|no commission|as-?is|free consultation|market value|we buy|interested in (buying|purchasing)|would you (ever )?consider)\b/i;

/* Phrases that mean this is the tail of a transaction already underway. */
const TRANSACTIONAL_RE = /\b(you signed|your signed|certificate of completion|copy of (what|the) (you signed|contract|agreement)|as agreed|our appointment|the agreement you|attached is the (contract|agreement|option)|per our (call|conversation))\b/i;

export function classify(subject, body, declared){
  if (declared && KINDS.includes(declared)) return declared;
  const text = `${subject || ''}\n${body || ''}`;
  /* transactional only wins when nothing in it is also selling — a message
     that delivers a contract AND pitches the next deal is commercial */
  if (TRANSACTIONAL_RE.test(text) && !COMMERCIAL_RE.test(text)) return 'transactional';
  return 'commercial';
}

/* ── what a commercial message must carry ─────────────────────────────────
   Checked, not trusted, exactly like the sequences' opt-out validator. */
export function validateMessage({ subject, body, kind, from, postalAddress,
                                  unsubscribeUrl } = {}){
  const problems = [];
  const k = classify(subject, body, kind);
  if (!from || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(String(from).replace(/^.*</, '').replace(/>$/, '')))
    problems.push('the from address is not an address');
  if (!subject || !String(subject).trim()) problems.push('no subject line');
  if (!body || !String(body).trim()) problems.push('no message');
  if (String(subject || '').length > 120)
    problems.push('the subject is longer than a subject line');
  /* a deceptive subject is a violation and also just bad manners */
  if (/^(re:|fwd:)/i.test(String(subject || '').trim()) )
    problems.push('a subject faked as a reply is deceptive');

  if (k === 'commercial'){
    if (!postalAddress || String(postalAddress).trim().length < 10)
      problems.push('A COMMERCIAL EMAIL NEEDS A REAL POSTAL ADDRESS');
    /* The opt-out test must recognise the footer THIS FILE WRITES. The first
       version listed exact phrasings and did not include "reply with the word
       STOP" — so the module's own compliant footer failed its own validator,
       which would have blocked every packet email while looking like a bug in
       the copy. Match the shape, not a phrase book. */
    const optOut = /unsubscribe|opt[-\s]?out|\breply\b[^.\n]{0,40}\bSTOP\b/i;
    if (!unsubscribeUrl && !optOut.test(String(body)))
      problems.push('A COMMERCIAL EMAIL NEEDS A WORKING OPT-OUT');
  }
  return { ok: problems.length === 0, kind: k, problems };
}

/* The footer a commercial message earns. Appended, never assumed: if the
   caller already wrote an opt-out into the body, this only adds the address. */
export function commercialFooter({ postalAddress, unsubscribeUrl, sender } = {}){
  const bits = [];
  if (sender) bits.push(sender);
  if (postalAddress) bits.push(postalAddress);
  bits.push(unsubscribeUrl
    ? 'Don’t want these? Unsubscribe: ' + unsubscribeUrl
    : 'Reply with the word STOP and I will not write again.');
  return bits.join('\n');
}

export function withFooter(body, opts){
  const foot = commercialFooter(opts);
  return String(body || '').replace(/\s+$/, '') + '\n\n—\n' + foot;
}

/* ── the suppression check, shared with the phone ─────────────────────────
   Matched case-insensitively on the whole address; an email opt-out and a
   text opt-out live on the same ledger because a person who said stop said
   stop. */
export const normEmail = e => String(e || '').trim().toLowerCase();

export function isSuppressed(email, suppressions = []){
  const e = normEmail(email);
  if (!e || !e.includes('@')) return false;
  /* Only rows that carry an ADDRESS. The one ledger holds both kinds now, and
     comparing an address against a phone row can only ever produce a false
     positive — which here means refusing to send somebody their own signed
     contract because a stranger's number looks like their email. */
  return suppressions.some(s => s.email && normEmail(s.email) === e);
}

/* ── the provider ─────────────────────────────────────────────────────────
   One adapter shape so the product never learns a vendor's vocabulary, the
   fetch injected so this is fully tested with no account and no key. The key
   lives in the server's environment; nothing in this file ever logs it or
   returns it. */
export function makeMailer({ name = 'Resend', baseUrl = 'https://api.resend.com',
                             apiKey, fetchImpl } = {}){
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) throw new Error('no fetch available');
  if (!apiKey) throw new Error('the mailer needs an API key');
  const base = String(baseUrl).replace(/\/$/, '');

  return {
    name,
    async send({ from, to, subject, text, replyTo, attachments }){
      const res = await f(base + '/emails', {
        method:'POST',
        headers:{ authorization:'Bearer ' + apiKey, 'content-type':'application/json' },
        body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to],
          subject, text,
          ...(replyTo ? { reply_to: replyTo } : {}),
          ...(attachments && attachments.length ? { attachments } : {}) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok){
        const err = new Error(`${name} said ${res.status}`
          + (body && body.message ? ': ' + String(body.message).slice(0, 200) : ''));
        err.status = res.status;
        err.retryable = res.status === 429 || res.status >= 500;
        throw err;
      }
      return { id: body && (body.id || body.messageId) || null };
    },
  };
}

/* ── the messages the desk actually sends ─────────────────────────────────
   Written here so their classification is settled at authoring time and the
   validator can be run against them in a test, exactly as the sequences'
   own copy is. */
export function signedCopyEmail({ sellerFirst, filename, buyerLine, address }){
  return {
    kind: 'transactional',
    subject: `Your signed copy — ${address || filename}`,
    body: `${sellerFirst || 'Hello'},\n\n`
      + `Attached is the agreement you signed, and the certificate that records `
      + `when and how you signed it. Both are yours to keep.\n\n`
      + `If anything in either one looks different from what we agreed, tell me `
      + `today and I will fix it before anything else happens.\n\n`
      + `${buyerLine}`,
  };
}

export function attorneyFundingEmail({ firm, sellerName, address, cap = 3000,
                                       buyerLine, buyerPhone }){
  return {
    kind: 'transactional',
    subject: `Funding a probate matter — ${sellerName || 'an estate'}`,
    body: `${firm ? firm + ',' : 'Hello,'}\n\n`
      + `I have a purchase option on ${address || 'a property'} with `
      + `${sellerName || 'the heir'}, who inherited it and has not yet opened an `
      + `estate. He is not my client and I am not asking you to represent me.\n\n`
      + `I am offering to pay your fee, directly to you, up to $${cap.toLocaleString()}, `
      + `so he can get the estate opened. Two questions:\n\n`
      + `  1. What does it cost to open the estate and obtain authority to sell?\n`
      + `  2. Can that be billed at closing, or on a payment plan?\n\n`
      + `If it helps, I will make the appointment and drive him to it.\n\n`
      + `${buyerLine}${buyerPhone ? '\n' + buyerPhone : ''}`,
  };
}

export function packetEmail({ sellerFirst, address, offerText, buyerLine,
                              postalAddress }){
  return {
    kind: 'commercial',
    subject: `The offer on ${address}, in writing`,
    body: `${sellerFirst || 'Hello'},\n\n`
      + `Attached is the one-page version of what we talked about: the offer on `
      + `${address}${offerText ? ' — ' + offerText : ''}, and every line of the `
      + `arithmetic behind it, including what I make.\n\n`
      + `Check my numbers. If one of them is wrong, tell me which and I will move `
      + `mine. And if the timing is wrong, that is a fine answer and I will leave `
      + `you alone.\n\n`
      + `${buyerLine}`,
    needsFooter: true,
    postalAddress,
  };
}
