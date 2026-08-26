/* ══ YOUR PAPER, NOT MINE ══════════════════════════════════════════════════
   The four documents in docs.mjs were the wrong thing to build and it is
   worth writing down why, because the reasoning generalises.

   A wholesaler who has been doing this for more than a month already has a
   contract. Their attorney wrote it, or their state's realtor association
   did, or they bought it in a course, and it has been through a closing. They
   are never going to sign my plain-English purchase agreement instead — and
   they should not, because I do not know their state's law and said so in red
   at the top of every page I generated. Shipping templates makes this software
   the drafter of a contract. Filling THEIR template makes it a merge engine,
   which is both far more useful and the honest description of what it is.

   So this module opens a .docx that a lawyer wrote, puts the deal's numbers
   into it, and hands it back byte-for-byte identical except for the values.
   No library, no upload to anybody's server, no conversion that mangles the
   formatting somebody paid for.

   THE HARD PART IS NOT THE ZIP.
   Word does not store "{{purchase_price}}" as a string. It stores runs, and a
   run breaks wherever anything changes — a spell-check mark, a language tag,
   a stray italic, the cursor having been parked there once. A perfectly
   ordinary token comes out of Word as

     <w:r><w:t>{{purchase</w:t></w:r>
     <w:r><w:t>_pr</w:t></w:r>
     <w:r><w:t>ice}}</w:t></w:r>

   and every naive find-and-replace in every "fill a docx" tutorial silently
   fails on it — silently, because the document opens fine and simply has the
   placeholder still in it. So this works on the joined text of each paragraph
   and maps its findings back onto the runs, which is what a real mail merge
   does and the reason a real mail merge is more than a string replace.      */

/* ── CRC-32, because a zip entry without one is a corrupt file ──────────── */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++){
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes){
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const te = new TextEncoder();
const td = new TextDecoder();

async function inflateRaw(bytes){
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}
async function deflateRaw(bytes){
  const cs = new CompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(cs));
  return new Uint8Array(await out.arrayBuffer());
}

/* ── read a zip ───────────────────────────────────────────────────────────
   Walked from the End of Central Directory backwards, the way the format is
   meant to be read — not by scanning for local headers, which is what breaks
   on files that have anything at all before the first entry. */
export async function unzip(bytes){
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--){
    if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  const order = [];
  for (let n = 0; n < count; n++){
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip directory is damaged');
    const method  = dv.getUint16(p + 10, true);
    const csize   = dv.getUint32(p + 20, true);
    const usize   = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen= dv.getUint16(p + 30, true);
    const cmtLen  = dv.getUint16(p + 32, true);
    const lho     = dv.getUint32(p + 42, true);
    const name    = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    /* the local header's own extra field length is authoritative — it is
       routinely a different length from the central one */
    const lNameLen  = dv.getUint16(lho + 26, true);
    const lExtraLen = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + csize);
    entries.set(name, { method, raw, usize });
    order.push(name);
    p += 46 + nameLen + extraLen + cmtLen;
  }
  const files = new Map();
  for (const name of order){
    const e = entries.get(name);
    files.set(name, e.method === 0 ? e.raw.slice() : await inflateRaw(e.raw));
  }
  files._order = order;
  return files;
}

/* ── write a zip ─────────────────────────────────────────────────────────── */
export async function zipFiles(files, order){
  /* The original order first, so a rewritten archive stays as close to the
     one Word wrote as it can be — and then ANYTHING ADDED SINCE. The first
     version trusted _order alone, so the signature PNG was written into the
     map, referenced by the relationship, referenced by the DrawingML, and
     then quietly left out of the zip. Word opens that file and shows a blank
     box where the signature is: no error, no warning, no signature. */
  const names = order || (files._order
    ? [...new Set([...files._order, ...files.keys()])]
    : [...files.keys()]);
  const chunks = [], dir = [];
  let offset = 0;
  for (const name of names){
    const data = files.get(name);
    if (!data) continue;
    const nameBytes = te.encode(name);
    const crc = crc32(data);
    /* a directory entry is stored; everything else is deflated unless
       deflating made it bigger, which happens on tiny files */
    const isDir = name.endsWith('/');
    let method = 0, payload = data;
    if (!isDir && data.length){
      const d = await deflateRaw(data);
      if (d.length < data.length){ method = 8; payload = d; }
    }
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);            /* version needed */
    lv.setUint16(6, 0, true);             /* flags — no data descriptor */
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true);  /* fixed time/date */
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    chunks.push(local, payload);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(38, isDir ? 0x10 : 0, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    dir.push(cen);
    offset += local.length + payload.length;
  }
  const dirSize = dir.reduce((a, d) => a + d.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, dir.length, true);
  ev.setUint16(10, dir.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...dir, end];
  const total = all.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of all){ out.set(c, o); o += c.length; }
  return out;
}

/* ══ THE FIELD CATALOGUE ═══════════════════════════════════════════════════
   The contract between this module and the desk. The catalogue lives here
   because it is what a person copies into their own document; the VALUES are
   computed by the page from docs.mjs, so there is still exactly one place
   that knows how to spell a number out or count business days.             */
/* TEMPLATE_FIELDS, not FIELDS. ops.html already has a FIELDS — the CSV
   importer's column list — and two of them in one scope is a SyntaxError,
   not a shadow. The build refuses to write the page when it happens, which
   is how this was caught rather than shipped. */
export const TEMPLATE_FIELDS = [
  { key:'property_address', group:'Property', label:'Street address',   example:'4715 Hunter Rd' },
  { key:'property_full',    group:'Property', label:'Full address',     example:'4715 Hunter Rd, Winston, GA 30187' },
  { key:'property_city',    group:'Property', label:'City',             example:'Winston' },
  { key:'property_state',   group:'Property', label:'State',            example:'GA' },
  { key:'property_zip',     group:'Property', label:'ZIP',              example:'30187' },
  { key:'property_county',  group:'Property', label:'County',           example:'Douglas' },
  { key:'property_parcel',  group:'Property', label:'Parcel number',    example:'' },
  { key:'property_beds',    group:'Property', label:'Bedrooms',         example:'3' },
  { key:'property_baths',   group:'Property', label:'Bathrooms',        example:'1' },
  { key:'property_sqft',    group:'Property', label:'Square feet',      example:'1,152' },
  { key:'property_year',    group:'Property', label:'Year built',       example:'1966' },

  { key:'seller_name',      group:'Seller', label:'Seller name',            example:'James Lonny George' },
  { key:'seller_mailing',   group:'Seller', label:'Seller mailing address', example:'PO Box 152, Villa Rica, GA' },
  { key:'seller_role',      group:'Seller', label:'Seller role',            example:'heir' },

  { key:'buyer_name',       group:'Buyer', label:'Buyer, as it signs', example:'StormRiver Homes LLC (by Elijah Payne)' },
  { key:'buyer_entity',     group:'Buyer', label:'Buyer entity only',  example:'StormRiver Homes LLC' },
  { key:'buyer_person',     group:'Buyer', label:'Buyer person only',  example:'Elijah Payne' },
  { key:'buyer_phone',      group:'Buyer', label:'Buyer phone',        example:'(770) 555-0100' },
  { key:'buyer_email',      group:'Buyer', label:'Buyer email',        example:'you@example.com' },
  { key:'closing_agent',    group:'Buyer', label:'Closing agent',      example:'' },

  { key:'purchase_price',       group:'Money', label:'Purchase price',          example:'$90,000' },
  { key:'purchase_price_words', group:'Money', label:'Purchase price in words', example:'Ninety Thousand and 00/100 Dollars' },
  { key:'earnest_money',        group:'Money', label:'Earnest money',           example:'$1,000' },
  { key:'earnest_money_words',  group:'Money', label:'Earnest money in words',  example:'One Thousand and 00/100 Dollars' },
  { key:'option_fee',           group:'Money', label:'Option fee',              example:'$3,000' },
  { key:'option_fee_words',     group:'Money', label:'Option fee in words',     example:'Three Thousand and 00/100 Dollars' },
  { key:'assignment_fee',       group:'Money', label:'Assignment fee',          example:'$8,000' },
  { key:'arv',                  group:'Money', label:'After-repair value',      example:'$190,000' },
  { key:'repairs',              group:'Money', label:'Repair estimate',         example:'$40,000' },
  { key:'asking',               group:'Money', label:'What they asked',         example:'$90,000' },

  { key:'today',            group:'Dates', label:"Today's date",          example:'August 25, 2026' },
  { key:'acceptance_date',  group:'Dates', label:'Date of acceptance',    example:'August 25, 2026' },
  { key:'closing_date',     group:'Dates', label:'Closing date',          example:'September 15, 2026' },
  { key:'inspection_end',   group:'Dates', label:'End of inspection',     example:'September 1, 2026' },
  { key:'option_expiry',    group:'Dates', label:'Option expires',        example:'December 23, 2026' },
  { key:'offer_expiry',     group:'Dates', label:'Offer expires',         example:'August 30, 2026' },
  { key:'closing_days',     group:'Dates', label:'Days to closing',       example:'21' },
  { key:'inspection_days',  group:'Dates', label:'Inspection days',       example:'7' },
  { key:'option_days',      group:'Dates', label:'Option length in days', example:'120' },

  { key:'best_exit',        group:'Deal', label:'Best exit',            example:'flip' },
  { key:'ceiling',          group:'Deal', label:'Your ceiling',         example:'$108,200' },
  { key:'room',             group:'Deal', label:'Room at this price',   example:'$18,200' },
];

export const TEMPLATE_FIELD_KEYS = TEMPLATE_FIELDS.map(f => f.key);

/* Tokens are matched loosely on purpose. Somebody's attorney wrote
   {{Purchase Price}} and somebody's course sold them {{PURCHASE-PRICE}}, and
   refusing both to insist on one spelling is the kind of correctness that
   loses the customer. */
export function normaliseKey(raw){
  return String(raw || '').trim().toLowerCase()
    .replace(/[\s\-.]+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/^_+|_+$/g, '');
}

const CHEV_OPEN = String.fromCharCode(171);   /* the guillemets, by code point, */
const CHEV_CLOSE = String.fromCharCode(187);  /* so this file stays plain ASCII */
const TOKEN_SRC = '\\{\\{\\s*([^{}]{1,80}?)\\s*\\}\\}'
  + '|' + CHEV_OPEN + '\\s*([^' + CHEV_OPEN + CHEV_CLOSE + ']{1,80}?)\\s*' + CHEV_CLOSE;
const newTokenRe = () => new RegExp(TOKEN_SRC, 'g');

/* A signature slot is not a merge field and must never be treated as one.
   {{sig_seller}} has no text to put in it — it is an anchor saying "the
   picture of a name goes HERE", filled at signing rather than at fill time.
   Marked as its own kind, because the first version reported every signature
   slot as an unrecognised field and asked the operator to map it to something,
   which is advice to break their own contract. */
export const isSignatureKey = key => /^sig(_|$)/.test(String(key || ''));

export function scanTokens(text){
  const out = [], seen = new Set();
  const re = newTokenRe();
  let m;
  while ((m = re.exec(String(text || '')))){
    const raw = (m[1] !== undefined ? m[1] : m[2]).trim();
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    const key = normaliseKey(raw);
    const signature = isSignatureKey(key);
    out.push({ raw, token: m[0], key, signature,
               kind: signature ? 'signature' : 'field',
               known: signature || TEMPLATE_FIELD_KEYS.includes(key) });
  }
  return out;
}

/* map: { tokenKey -> fieldKey }, for the tokens an attorney's document calls
   something else. Set once per template and remembered. */
function resolver(values, map){
  const m = map || {};
  return key => {
    const v = (values || {})[m[key] || key];
    if (v === undefined || v === null) return undefined;
    /* a drawing passes through as itself; everything else becomes text */
    return (typeof v === 'object' && v.__drawing) ? v : String(v);
  };
}

export function mergeText(text, values, map){
  const resolve = resolver(values, map);
  const filled = [], unknown = [];
  const out = String(text || '').replace(newTokenRe(), (whole, a, b) => {
    const raw = (a !== undefined ? a : b).trim();
    const key = normaliseKey(raw);
    const v = resolve(key);
    if (v === undefined){ unknown.push({ token: whole, raw, key }); return whole; }
    /* a plain-text file has nowhere to put a drawing, so the token stays */
    if (typeof v === 'object'){ unknown.push({ token: whole, raw, key }); return whole; }
    filled.push({ token: whole, key, value: v });
    return v;
  });
  return { out, filled, unknown };
}

/* ── XML ──────────────────────────────────────────────────────────────────── */
const XML_ESC = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' };
const escapeXml = s => String(s).replace(/[&<>"']/g, c => XML_ESC[c]);
const unescapeXml = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, '&');

/* A value with a line break in it becomes a real Word line break, not the two
   characters backslash-n printed in the middle of a contract. */
/* A signature is not text. When a value is a drawing rather than a string it
   has to break OUT of the w:t and out of the run, sit in a run of its own, and
   let the text resume after it — Word will not render a w:drawing inside a
   w:t, and puts up "unreadable content" if you try. The sentinel is a NUL,
   which cannot occur in XML character data, so it can never collide with the
   document's own text. */
const RAW = '\u0000';

function runText(value, attrs, raws){
  const a = /xml:space=/.test(attrs) ? attrs : attrs + ' xml:space="preserve"';
  const asText = line => '<w:t' + a + '>' + escapeXml(line) + '</w:t>';
  return String(value).split(RAW).map((part, i) => {
    if (i % 2 === 1) return '</w:r><w:r>' + (raws[+part] || '') + '</w:r><w:r>';
    return part.split(/\r?\n/).map(asText).join('<w:br/>');
  }).join('');
}

const P_RE = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
const newTRe = () => /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(\s[^>]*)?\/>/g;

/* ── the merge that actually works on a Word file ─────────────────────────
   Joins every w:t in the paragraph, finds the tokens in the JOINED text, and
   writes each value back into the run where its token started, deleting the
   token's characters from every run it ran through. Formatting outside the
   token is untouched; the value takes the formatting of the run the token
   began in, which is what a person expects and what Word's own mail merge
   does. */
export function mergeDocxXml(xml, values, map){
  const resolve = resolver(values, map);
  const filled = [], unknown = [];

  const out = String(xml).replace(P_RE, para => {
    const raws = [];
    const segs = [];
    const tre = newTRe();
    let m;
    while ((m = tre.exec(para))){
      const selfClosing = m[2] === undefined;
      segs.push({ start: m.index, end: tre.lastIndex,
        attrs: (selfClosing ? m[3] : m[1]) || '',
        text: selfClosing ? '' : unescapeXml(m[2]) });
    }
    if (!segs.length) return para;

    let joined = '';
    const bounds = [];
    for (const s of segs){
      bounds.push([joined.length, joined.length + s.text.length]);
      joined += s.text;
    }
    if (joined.indexOf('{') < 0 && joined.indexOf(CHEV_OPEN) < 0) return para;

    const matches = [];
    const tokre = newTokenRe();
    while ((m = tokre.exec(joined))){
      const raw = (m[1] !== undefined ? m[1] : m[2]).trim();
      matches.push({ a: m.index, b: tokre.lastIndex, whole: m[0],
                     raw, key: normaliseKey(raw) });
    }
    if (!matches.length) return para;

    const pieces = segs.map(() => '');
    const segAt = i => {
      for (let k = 0; k < bounds.length; k++)
        if (i >= bounds[k][0] && i < bounds[k][1]) return k;
      return bounds.length - 1;
    };

    let i = 0, mi = 0;
    while (i < joined.length){
      const nxt = matches[mi];
      if (nxt && i === nxt.a){
        const v = resolve(nxt.key);
        const where = segAt(i);
        if (v === undefined){
          unknown.push({ token: nxt.whole, raw: nxt.raw, key: nxt.key });
          pieces[where] += nxt.whole;
        } else if (v && typeof v === 'object' && v.__drawing){
          filled.push({ token: nxt.whole, key: nxt.key, value:'[drawing]' });
          raws.push(v.__drawing);
          pieces[where] += RAW + (raws.length - 1) + RAW;
        } else {
          filled.push({ token: nxt.whole, key: nxt.key, value: v });
          pieces[where] += v;
        }
        i = nxt.b; mi++;
        continue;
      }
      pieces[segAt(i)] += joined[i];
      i++;
    }

    /* rebuilt back to front so the earlier offsets stay valid */
    let outPara = para;
    for (let k = segs.length - 1; k >= 0; k--){
      outPara = outPara.slice(0, segs[k].start)
        + runText(pieces[k], segs[k].attrs, raws)
        + outPara.slice(segs[k].end);
    }
    return outPara;
  });

  return { xml: out, filled, unknown };
}

/* Every part of a docx that can carry visible text. Headers and footers are
   where the property address and the date usually live, and a merge that only
   touched document.xml left every page showing the raw token. */
const MERGEABLE = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

export async function fillDocx(bytes, values, map){
  const files = await unzip(bytes);
  const filled = [], unknown = [];
  for (const name of [...files.keys()]){
    if (!MERGEABLE.test(name)) continue;
    const xml = td.decode(files.get(name));
    const r = mergeDocxXml(xml, values, map);
    if (r.filled.length || r.unknown.length) files.set(name, te.encode(r.xml));
    filled.push(...r.filled);
    unknown.push(...r.unknown);
  }
  return { bytes: await zipFiles(files), report: { filled, unknown } };
}

export function fillPlain(text, values, map){
  return mergeText(text, values, map);
}

/* Scanning has to join the runs too. A token Word split across three runs is
   invisible to a scan of the raw markup, and a template whose fields all
   "could not be found" is a template somebody deletes. */
export async function scanDocx(bytes){
  const files = await unzip(bytes);
  const out = [], seen = new Set();
  for (const name of files.keys()){
    if (!MERGEABLE.test(name)) continue;
    const xml = td.decode(files.get(name));
    for (const para of (xml.match(P_RE) || [])){
      let joined = '', m;
      const tre = newTRe();
      while ((m = tre.exec(para))) joined += m[2] === undefined ? '' : unescapeXml(m[2]);
      for (const t of scanTokens(joined)){
        if (seen.has(t.token)) continue;
        seen.add(t.token);
        out.push(t);
      }
    }
  }
  return out;
}

export function detectKind(filename, bytes){
  const ext = String(filename || '').toLowerCase().split('.').pop();
  if (ext === 'docx') return (bytes && bytes[0] === 0x50 && bytes[1] === 0x4B)
    ? 'docx' : 'not_a_docx';
  if (['md','markdown','txt','text','html','htm'].includes(ext)) return 'text';
  if (ext === 'doc') return 'legacy_doc';
  if (ext === 'pdf') return 'pdf';
  return 'unsupported';
}

/* A refusal is only useful if it says what to do instead. */
export const KIND_REFUSALS = {
  not_a_docx: 'That file is named .docx but is not one. Open it in Word and use '
    + 'Save As, then Word Document (.docx).',
  legacy_doc: 'That is the old .doc format from before 2007. Open it in Word and use '
    + 'Save As, then Word Document (.docx).',
  pdf: 'A PDF has no text to merge into. Upload the Word file it was made from, and '
    + 'print the filled copy back to PDF.',
  unsupported: 'That file type cannot be merged. Word (.docx), Markdown, HTML and '
    + 'plain text all work.',
};

/* ══ PUTTING A SIGNATURE INTO SOMEBODY'S WORD FILE ═════════════════════════
   A signature is not text, so it cannot be merged the way a price is. It is a
   picture, and a picture in a .docx is four separate things that all have to
   agree with each other:

     · the PNG itself, added to the archive as word/media/xxx.png;
     · a Default extension entry in [Content_Types].xml, or Word declares the
       file corrupt and refuses to open it at all — no warning, no partial
       render, just "Word found unreadable content";
     · a relationship in word/_rels/document.xml.rels giving it an rId;
     · and the DrawingML that references that rId, inside a run, sized in
       EMU — English Metric Units, 914,400 to the inch, which exist because
       914,400 divides evenly by both 72 and 96 and by 254.

   Get any one of the four wrong and the document opens empty or not at all,
   so all four are done here and tested together against a file that a
   different implementation then opens.                                     */

const EMU_PER_INCH = 914400;

/* Read a PNG's own idea of how big it is. The IHDR chunk is always the first
   one and always at the same offset, so this is eight bytes of arithmetic
   rather than a decoder. Getting it from the file rather than from the caller
   means a signature drawn on a phone at 3x pixel density is not stamped into
   a contract three times too large. */
export function pngSize(bytes){
  if (bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) };
}

/* A signature is sized by its HEIGHT, because that is what makes it look
   right on a line of a contract, and the width follows the aspect ratio. A
   signature stretched to a fixed box is the single most obvious tell that
   something automated touched the document. */
export function stampExtent(png, heightInches = 0.42, maxWidthInches = 2.6){
  const size = pngSize(png);
  const ratio = size && size.height ? size.width / size.height : 3;
  let h = heightInches, w = h * ratio;
  if (w > maxWidthInches){ w = maxWidthInches; h = w / ratio; }
  return { cx: Math.round(w * EMU_PER_INCH), cy: Math.round(h * EMU_PER_INCH) };
}

const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export function drawingXml({ relId, cx, cy, id, name }){
  return '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="' + WP_NS + '">'
    + '<wp:extent cx="' + cx + '" cy="' + cy + '"/>'
    + '<wp:docPr id="' + id + '" name="' + name + '" descr="' + name + '"/>'
    + '<wp:cNvGraphicFramePr/>'
    + '<a:graphic xmlns:a="' + A_NS + '">'
    + '<a:graphicData uri="' + PIC_NS + '">'
    + '<pic:pic xmlns:pic="' + PIC_NS + '">'
    + '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr>'
    + '<pic:blipFill><a:blip xmlns:r="' + R_NS + '" r:embed="' + relId + '"/>'
    + '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
    + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>'
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
}

function nextRelId(relsXml){
  let max = 0;
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) max = Math.max(max, +m[1]);
  return 'rId' + (max + 1);
}

function ensurePngDefault(ctXml){
  if (/<Default[^>]+Extension="png"/i.test(ctXml)) return ctXml;
  return ctXml.replace(/<Types([^>]*)>/, '<Types$1><Default Extension="png" ContentType="image/png"/>');
}

/* ── the one entry point ──────────────────────────────────────────────────
   stamps: { tokenKey -> { png: Uint8Array, heightInches?, alt? } }
   Anything not stamped is left exactly as it was, token and all, so a
   half-signed contract shows plainly which signature is still missing. */
export async function stampDocx(bytes, stamps){
  const files = await unzip(bytes);
  const dec = new TextDecoder(), enc = new TextEncoder();

  const docRelsName = 'word/_rels/document.xml.rels';
  if (!files.has('word/document.xml')) throw new Error('that is not a Word document');
  let rels = files.has(docRelsName) ? dec.decode(files.get(docRelsName))
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';

  /* one media part per DISTINCT image, so the same signature used in three
     places is stored once — a drawn signature is 20-40KB and a contract with
     six initials boxes should not be a quarter of a megabyte of the same PNG */
  const byPng = new Map();
  const values = {};
  let seq = 0, added = 0;
  const applied = [], missing = [];

  for (const [key, spec] of Object.entries(stamps || {})){
    if (!spec || !spec.png || !spec.png.length){ missing.push(key); continue; }
    const fingerprint = spec.png.length + ':' + Array.from(spec.png.slice(0, 24)).join(',');
    let entry = byPng.get(fingerprint);
    if (!entry){
      added++;
      const media = 'word/media/sig' + added + '.png';
      const relId = nextRelId(rels);
      rels = rels.replace('</Relationships>',
        '<Relationship Id="' + relId + '" Type="' + R_NS + '/image" Target="media/sig'
        + added + '.png"/></Relationships>');
      files.set(media, spec.png);
      entry = { relId };
      byPng.set(fingerprint, entry);
    }
    const ext = stampExtent(spec.png, spec.heightInches);
    values[key] = { __drawing: drawingXml({ relId: entry.relId, cx: ext.cx, cy: ext.cy,
      id: 1000 + (++seq), name: (spec.alt || 'Signature').replace(/[<>&"]/g, '') }) };
    applied.push(key);
  }

  if (!applied.length) return { bytes: await zipFiles(files), report: { applied, missing } };

  files.set(docRelsName, enc.encode(rels));
  if (files.has('[Content_Types].xml'))
    files.set('[Content_Types].xml',
      enc.encode(ensurePngDefault(dec.decode(files.get('[Content_Types].xml')))));

  let filledAny = 0;
  for (const name of [...files.keys()]){
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(name)) continue;
    const r = mergeDocxXml(dec.decode(files.get(name)), values);
    if (r.filled.length){ files.set(name, enc.encode(r.xml)); filledAny += r.filled.length; }
  }

  return { bytes: await zipFiles(files),
           report: { applied, missing, placed: filledAny } };
}


/* ── reading a Word file back as words ────────────────────────────────────
   The browser cannot render a .docx, and a signing screen that asks somebody
   to sign a file they cannot see is not a signing screen. This pulls the text
   out, paragraph by paragraph, so the person putting their name to it can
   read it on the screen they are holding — with the real file one tap away
   for anyone who wants the formatting. */
export function docxTextFromXml(xml){
  const out = [];
  for (const para of (String(xml).match(P_RE) || [])){
    let line = '';
    const tre = newTRe();
    let m;
    while ((m = tre.exec(para))) line += m[2] === undefined ? '' : unescapeXml(m[2]);
    /* a w:br is a line break the author asked for and worth keeping */
    if (/<w:br\s*\/>/.test(para) && !line) line = '';
    out.push(line);
  }
  /* collapse runs of blank paragraphs — Word files are full of them and a
     signing screen with nine inches of nothing in it looks broken */
  return out.filter((l, i) => l.trim() || (out[i - 1] || '').trim()).join('\n');
}

export async function docxText(bytes){
  const files = await unzip(bytes);
  const doc = files.get('word/document.xml');
  if (!doc) throw new Error('that is not a Word document');
  return docxTextFromXml(td.decode(doc));
}
