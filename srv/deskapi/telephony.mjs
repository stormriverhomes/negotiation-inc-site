/* ══ THE PHONE, WITHOUT THE SDK ════════════════════════════════════════════
   Twilio's node library is a large dependency and a supply chain to carry
   for what turns out to be four things: a JWT, an HMAC check, some XML, and
   form-encoded POSTs. billing.js already made this argument and won it; the
   same argument holds here, and the same rule follows — everything in this
   file is a pure function of its inputs, so all of it is testable without a
   network, an account, or a credential.

   WHAT LIVES HERE
     · accessToken()      the JWT the browser softphone authenticates with
     · verifySignature()  proof a webhook really came from Twilio
     · twiml*()           the XML answers to Twilio's questions
     · classifyInbound()  STOP/HELP detection, which is a legal obligation
                          and therefore not something we improvise at the
                          call site

   NOTHING HERE READS process.env. The service passes credentials in, so the
   tests can pass fakes in, so this file can be exercised completely.        */

import crypto from 'node:crypto';

const b64url = buf => Buffer.from(buf).toString('base64')
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

/* ── THE SOFTPHONE'S CREDENTIAL ────────────────────────────────────────────
   A Twilio "Access Token" is a JWT with one unusual header — cty must be
   `twilio-fpa;v=1` or the client library rejects it without saying why,
   which is a pleasant hour of one's life. Signed HS256 with the API Key
   SECRET, issued by the API Key SID, subject the Account SID.

   `identity` is who the browser is. We use the user's id, never their email:
   identities show up in Twilio's console and logs, and an email address in a
   vendor's logs is a small permanent leak nobody asked for.                */
export function accessToken({
  accountSid, apiKeySid, apiKeySecret, twimlAppSid, identity,
  ttlSeconds = 3600, now = Date.now(),
}){
  if (!accountSid || !apiKeySid || !apiKeySecret)
    throw new Error('accessToken: missing Twilio credentials');
  if (!identity) throw new Error('accessToken: identity is required');
  if (!/^[A-Za-z0-9_.\-]{1,121}$/.test(identity))
    throw new Error('accessToken: identity must be url-safe and short');

  const iat = Math.floor(now / 1000);
  const header = { typ:'JWT', alg:'HS256', cty:'twilio-fpa;v=1' };
  const payload = {
    jti: `${apiKeySid}-${iat}`,
    iss: apiKeySid,
    sub: accountSid,
    iat, nbf: iat,
    exp: iat + ttlSeconds,
    grants: {
      identity,
      voice: {
        incoming: { allow: true },
        ...(twimlAppSid ? { outgoing: { application_sid: twimlAppSid } } : {}),
      },
    },
  };
  const signing = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', apiKeySecret).update(signing).digest());
  return signing + '.' + sig;
}

/* ── PROOF A WEBHOOK IS REALLY TWILIO ──────────────────────────────────────
   Their scheme: take the full URL, append every POST parameter as key then
   value, sorted by key, with no separators; HMAC-SHA1 with the auth token;
   base64. Compare in constant time, because a webhook endpoint that leaks
   timing is a webhook endpoint that eventually leaks the token.

   An unsigned request is not a request. Every handler in server.mjs refuses
   before it reads a body — a forged status callback could otherwise mark
   somebody's number as opted-in, or worse, un-suppress it.                 */
export function signatureFor(url, params, authToken){
  let data = url;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data,'utf8')).digest('base64');
}
export function verifySignature(url, params, authToken, given){
  if (!authToken || !given) return false;
  const want = signatureFor(url, params, authToken);
  const a = Buffer.from(want), b = Buffer.from(String(given));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ── XML ───────────────────────────────────────────────────────────────────
   Escaping matters more than it looks: a seller called O'Brien & Sons, or a
   street with an ampersand in it, will otherwise produce XML Twilio rejects
   with a 12100 and no call. */
export const xesc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const doc = inner => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;

/* THE RECORDING DISCLOSURE IS NOT OPTIONAL AND NOT CONFIGURABLE.
   A dozen states require every party to consent to a recording. Playing the
   line and continuing the call is the accepted way to obtain it, so the
   product plays it on every recorded call in every state — the alternative
   is a per-state matrix that is wrong the first time somebody's mobile has
   travelled. It costs three seconds and it removes an entire category of
   problem. */
export const DISCLOSURE = 'This call may be recorded for quality and training purposes.';

/** Outbound: the browser asked to be bridged to a seller. */
export function twimlOutbound({ to, callerId, record = true, statusCallback, recordingCallback }){
  if (!to || !callerId) throw new Error('twimlOutbound: to and callerId are required');
  const dialAttrs = [
    `callerId="${xesc(callerId)}"`,
    'answerOnBridge="true"',                 /* ring, don't play silence */
    'timeout="20"',
    record ? 'record="record-from-answer-dual"' : '',
    record && recordingCallback ? `recordingStatusCallback="${xesc(recordingCallback)}"` : '',
    statusCallback ? `action="${xesc(statusCallback)}"` : '',
  ].filter(Boolean).join(' ');
  return doc(
    (record ? `<Say voice="Polly.Joanna">${xesc(DISCLOSURE)}</Say>` : '') +
    `<Dial ${dialAttrs}><Number>${xesc(to)}</Number></Dial>`
  );
}

/** Inbound: somebody is calling one of our numbers back.
 *  Ring the browser softphone AND the operator's mobile at once — whoever
 *  picks up first gets it. The mobile leg is screened so a returned call
 *  never arrives as an anonymous ring on a personal phone: the operator
 *  hears who it is and presses a key to take it, which also stops voicemail
 *  on the mobile from swallowing calls the softphone could have answered. */
export function twimlInbound({ identity, mobile, whisper, voicemailAction, statusCallback }){
  const clients = (Array.isArray(identity) ? identity : [identity]).filter(Boolean);
  if (!clients.length && !mobile)
    return doc(`<Say voice="Polly.Joanna">Sorry, nobody is available. Please try again.</Say><Hangup/>`);
  const dialAttrs = [
    'timeout="20"', 'answerOnBridge="true"',
    voicemailAction ? `action="${xesc(voicemailAction)}"` : '',
    statusCallback ? '' : '',
  ].filter(Boolean).join(' ');
  const legs =
    clients.map(c => `<Client>${xesc(c)}</Client>`).join('') +
    (mobile ? `<Number${whisper ? ` url="${xesc(whisper)}"` : ''}>${xesc(mobile)}</Number>` : '');
  return doc(`<Dial ${dialAttrs}>${legs}</Dial>`);
}

/** The screening line the mobile hears before it is bridged. */
export function twimlWhisper({ line }){
  return doc(`<Gather numDigits="1" timeout="6">` +
    `<Say voice="Polly.Joanna">${xesc(line || 'Call from a lead.')} Press any key to accept.</Say>` +
    `</Gather><Hangup/>`);
}

/** Nobody answered: take a message. */
export function twimlVoicemail({ greeting, recordingCallback, maxSeconds = 120 }){
  return doc(
    `<Say voice="Polly.Joanna">${xesc(greeting ||
      'Sorry we missed you. Please leave a message after the tone and we will call you right back.')}</Say>` +
    `<Record maxLength="${maxSeconds}" playBeep="true" timeout="4"` +
    (recordingCallback ? ` recordingStatusCallback="${xesc(recordingCallback)}"` : '') + `/>` +
    `<Hangup/>`
  );
}

export function twimlReject(reason){
  return doc(`<Say voice="Polly.Joanna">${xesc(reason || 'This call cannot be completed.')}</Say><Hangup/>`);
}
export function twimlSms(body){
  return doc(body ? `<Message>${xesc(body)}</Message>` : '');
}

/* ── WHAT AN INBOUND TEXT MEANS ────────────────────────────────────────────
   Carriers handle STOP themselves on registered A2P traffic, but the
   obligation to stop is ours and the record of it has to be in OUR database
   — the FCC's revoke-all rule (Jan 2027) makes one opt-out cover every
   channel, so an SMS STOP has to be able to silence the dialer too. Hence
   one classifier, used at the one place inbound messages arrive.

   Deliberately generous on what counts as a stop. A false positive costs one
   lead. A false negative costs $500 to $1,500 a message and is the single
   most-litigated fact pattern in the whole statute.                        */
const STOP_WORDS = ['stop','stopall','unsubscribe','cancel','end','quit',
                    'optout','opt-out','remove','removeme','stop2quit','stopall'];
const HELP_WORDS = ['help','info'];
const START_WORDS = ['start','unstop','yes'];

export function classifyInbound(body){
  const raw = String(body == null ? '' : body).trim();
  const norm = raw.toLowerCase().replace(/[^a-z\s-]/g,'').replace(/\s+/g,' ').trim();
  const first = norm.split(' ')[0] || '';
  const squashed = norm.replace(/[\s-]/g,'');

  if (STOP_WORDS.includes(squashed) || STOP_WORDS.includes(first))
    return { kind:'stop', reply:'You will not receive further messages from this number.' };
  /* a sentence that plainly asks to be left alone, even dressed politely */
  if (/\b(stop (texting|calling|contacting)|do ?not (text|call|contact)|take me off|leave me alone|not interested,? (stop|remove))\b/.test(norm))
    return { kind:'stop', reply:'Understood — you will not hear from this number again.' };
  if (HELP_WORDS.includes(squashed))
    return { kind:'help', reply:'Negotiation Inc. Reply STOP to opt out. Msg & data rates may apply.' };
  if (START_WORDS.includes(squashed))
    return { kind:'start', reply:'You are opted back in. Reply STOP to opt out.' };
  return { kind:'message', reply:null };
}

/* ── FORM-ENCODED POSTS TO TWILIO'S REST API ───────────────────────────────
   Six calls, thirty lines. `fetchImpl` is injectable so tests never touch a
   network and never need a credential. */
export function twilioClient({ accountSid, authToken, fetchImpl = fetch,
                               base = 'https://api.twilio.com/2010-04-01' }){
  const auth = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  async function post(path, form){
    const r = await fetchImpl(`${base}/Accounts/${accountSid}${path}`, {
      method:'POST',
      headers:{ Authorization:auth, 'Content-Type':'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch(e){}
    if (!r.ok) throw new Error(`twilio ${r.status}: ${json ? json.message : text.slice(0,200)}`);
    return json;
  }
  return {
    sendSms: ({ to, from, body, statusCallback }) =>
      post('/Messages.json', { To:to, From:from, Body:body,
        ...(statusCallback ? { StatusCallback:statusCallback } : {}) }),
    buyNumber: ({ areaCode, voiceUrl, smsUrl, friendlyName }) =>
      post('/IncomingPhoneNumbers.json', { AreaCode:areaCode, VoiceUrl:voiceUrl,
        SmsUrl:smsUrl, FriendlyName:friendlyName || 'Operating Desk' }),
    releaseNumber: sid => post(`/IncomingPhoneNumbers/${sid}.json`, { _method:'DELETE' }),
  };
}
