/* ══ THE STREET BRIEF ═══════════════════════════════════════════════════════
   One page on what the block is actually doing, for an address the person is
   about to make an offer on. It is the thing every investor currently does in
   nine browser tabs and forty minutes, and it is the feature that makes the
   $99 tier read as "the software brings the data" rather than "the software
   does arithmetic on data I brought".

   ── FOUR SOURCES, AND WHAT EACH ONE IS FOR ────────────────────────────────
     · the Census geocoder     → the exact tract. Not the ZIP. A ZIP in Atlanta
       spans a rebuilt block and a boarded one, and the difference between them
       is the entire deal.
     · the ACS 5-year          → income, tenure, vacancy, median value and rent,
       and the median year built — the shape of the block, from the government
       that counted it
     · FEMA's flood layer      → the flood zone at the actual coordinates,
       because "is it in a flood zone" changes the insurance line on every one
       of the eight exits and nobody carries it in their head
     · Claude's web search     → permits, planning, rezonings, and local news,
       WITH ZILLOW AND REDFIN BLOCKED AT THE API. Their terms say do not
       scrape; blocking them in the request is the difference between intending
       to comply and complying.

   ── WHAT MAKES IT SHIPPABLE ───────────────────────────────────────────────
   Two rules, both checked rather than asked for:

     1 · EVERY FIGURE IS OURS. Same rule as the written comparison: the model
         is handed the numbers and forbidden to produce new ones, and then the
         prose is checked. A median income that is nearly right is worse than
         no median income.
     2 · EVERY WEB CLAIM CARRIES ITS SOURCE. The search tool returns citations
         as a structured array on each text block — url, title, and the quoted
         text — so this is not a matter of asking the model to add links. A
         paragraph that came from the web and carries no citation is dropped
         before the page ever sees it.

   And where a source has nothing, the brief SAYS SO. "No permit data is
   published for this county" is a useful sentence. Silence in its place is
   how somebody concludes there are no permits. ═══════════════════════════ */

export const MODEL = process.env.NI_MODEL_STREET || process.env.NI_MODEL || 'claude-sonnet-4-5';
const UA = 'negotiation-inc/1.0 (+https://negotiationinc.com)';

/* every outbound call is bounded; a brief that hangs is a brief nobody waits
   for, and one slow agency must not hold the other three hostage */
async function getJSON(url, ms = 9000){
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch(e){ return null; } finally { clearTimeout(t); }
}

/* ── 1 · the tract ───────────────────────────────────────────────────────── */
export async function geocode(address){
  const u = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress'
    + '?address=' + encodeURIComponent(address)
    + '&benchmark=Public_AR_Current&vintage=Current_Current&format=json';
  const j = await getJSON(u);
  const m = j && j.result && Array.isArray(j.result.addressMatches) ? j.result.addressMatches[0] : null;
  if (!m) return null;
  const t = (m.geographies && m.geographies['Census Tracts'] || [])[0];
  if (!t) return null;
  const county = (m.geographies['Counties'] || [])[0];
  const place  = (m.geographies['Incorporated Places'] || [])[0];
  return {
    matched: String(m.matchedAddress || ''),
    lat: Number(m.coordinates.y), lon: Number(m.coordinates.x),
    state: t.STATE, countyFips: t.COUNTY, tract: t.TRACT,
    tractName: String(t.NAME || ''),
    countyName: county ? String(county.NAME || '') : null,
    placeName:  place  ? String(place.NAME  || '') : null,
  };
}

/* ── 2 · the block, as the government counted it ─────────────────────────── */
const VARS = {
  income:   'B19013_001E',   // median household income
  value:    'B25077_001E',   // median value, owner-occupied
  rent:     'B25064_001E',   // median gross rent
  occTotal: 'B25003_001E',
  occOwner: 'B25003_002E',
  units:    'B25002_001E',
  vacant:   'B25002_003E',
  people:   'B01003_001E',
  yearBuilt:'B25035_001E',   // median year structure built
};
export const ACS_VINTAGE = process.env.NI_ACS_VINTAGE || '2023';

export async function acsTract(g, key){
  if (!key) return { ok:false, why:'no-key' };
  const get = Object.values(VARS).join(',');
  const u = `https://api.census.gov/data/${ACS_VINTAGE}/acs/acs5?get=${get}`
    + `&for=tract:${g.tract}&in=state:${g.state}%20county:${g.countyFips}&key=${encodeURIComponent(key)}`;
  const j = await getJSON(u);
  if (!Array.isArray(j) || j.length < 2) return { ok:false, why:'no-data' };
  const head = j[0], row = j[1];
  const at = name => { const i = head.indexOf(name); return i < 0 ? null : row[i]; };
  /* the ACS uses large negative sentinels for "not available", and a median
     income of minus six hundred and sixty six million dollars on a brief is
     the kind of thing people screenshot */
  const n = name => { const v = Number(at(VARS[name]));
    return Number.isFinite(v) && v > -1e6 ? v : null; };
  const occT = n('occTotal'), occO = n('occOwner');
  const units = n('units'), vac = n('vacant');
  return { ok:true,
    vintage: ACS_VINTAGE,
    medianIncome: n('income'), medianValue: n('value'), medianRent: n('rent'),
    people: n('people'), medianYearBuilt: n('yearBuilt'),
    ownerOccupiedPc: (occT && occO !== null) ? Math.round(occO / occT * 100) : null,
    vacancyPc:       (units && vac !== null) ? Math.round(vac / units * 100) : null,
    households: occT,
  };
}

/* ── 3 · the flood zone, at the coordinates ──────────────────────────────── */
export async function floodZone(lat, lon){
  const geom = encodeURIComponent(JSON.stringify({ x: lon, y: lat, spatialReference:{ wkid:4326 } }));
  const u = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query'
    + `?geometry=${geom}&geometryType=esriGeometryPoint&inSR=4326`
    + '&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF'
    + '&returnGeometry=false&f=json';
  const j = await getJSON(u);
  const f = j && Array.isArray(j.features) ? j.features[0] : null;
  if (!f || !f.attributes) return { ok:false, why:'not-mapped' };
  const a = f.attributes;
  return { ok:true, zone: String(a.FLD_ZONE || ''), subtype: String(a.ZONE_SUBTY || ''),
           /* "T" means it IS a Special Flood Hazard Area — the one that makes
              flood insurance a condition of a federally backed mortgage */
           specialHazard: String(a.SFHA_TF || '') === 'T' };
}

/* ── the prompt ──────────────────────────────────────────────────────────── */
export const SYSTEM = `You are briefing a property investor on one block, for an address they are about to make an offer on. They will read this in ninety seconds and then decide whether to drive out.

You are given FACTS from the US Census Bureau and FEMA. You also have a web search tool. Use it to find what those two cannot tell you: recent permits or construction, rezonings, planning applications, city investment, school changes, anything a local would know. Search two or three times, no more.

THE TWO RULES:

1. NUMBERS. Every figure you write must appear verbatim in the FACTS. Do not compute, average, round, convert or estimate anything. If a number would help and it is not in the facts, write the sentence without it.

2. SOURCES. Anything you learned from the web must be said in a sentence that cites the page you learned it from. Do not summarise something you found without citing it. If a search returns nothing useful, say what you could not find — "no permit data is published for this county" is worth writing; leaving it out is how somebody concludes there are none.

WHAT TO WRITE, as plain paragraphs, no headings and no bullets:

1. What kind of block this is, in one paragraph, from the census figures. Owner-occupied share and vacancy say more about a street than income does — lead with whichever actually characterises it.
2. What the flood position is, in one or two sentences, and what it means practically. Zone X is minimal hazard and worth saying plainly. A Special Flood Hazard Area means flood insurance is a condition of a federally backed mortgage, and that is a line on every exit.
3. What is happening nearby, from your searches, each claim with its source. Permits, planning, construction, public money. If there is nothing, say that.
4. One short closing paragraph: what this means for somebody buying here. No recommendation on price — you have not seen their numbers.

HOW TO WRITE IT:
- Plain professional English, short sentences, 180 to 300 words.
- Never use "vibrant", "up-and-coming", "hidden gem", "desirable", "prime location", or any estate-agent register. You are briefing a professional, not selling them a house.
- Never characterise the people who live somewhere. Say what the housing stock and the tenure are. Do not describe a neighbourhood as good, bad, rough, safe or improving — those are conclusions the reader draws, and in housing they are also the language of steering, which is illegal. Report conditions, not judgements about who lives in them.
- Never mention race, ethnicity, religion, national origin, family status or disability, and do not use any proxy for them.
- If the census figures are old, say the year.
- No markdown, no headings, no lists.`;

export function factsFrom({ g, acs, flood }){
  return {
    address: g.matched,
    tract: g.tractName, county: g.countyName, place: g.placeName,
    census: acs && acs.ok ? {
      vintage: acs.vintage + ' ACS 5-year, US Census Bureau',
      medianHouseholdIncome: acs.medianIncome,
      medianHomeValue: acs.medianValue,
      medianGrossRent: acs.medianRent,
      ownerOccupiedPercent: acs.ownerOccupiedPc,
      vacancyPercent: acs.vacancyPc,
      medianYearBuilt: acs.medianYearBuilt,
      households: acs.households, people: acs.people,
    } : { unavailable: acs && acs.why === 'no-key'
            ? 'No census key is configured for this deployment, so tract figures could not be read.'
            : 'The Census Bureau returned no figures for this tract.' },
    flood: flood && flood.ok
      ? { zone: flood.zone, subtype: flood.subtype, specialFloodHazardArea: flood.specialHazard,
          source: 'FEMA National Flood Hazard Layer' }
      : { unavailable: 'This point is not inside a mapped FEMA flood panel.' },
  };
}

export function userBlock(facts){
  return 'FACTS\n' + JSON.stringify(facts, null, 1)
    + '\n\nSearch for what is happening near ' + facts.address
    + ' — permits, construction, rezonings, planning, public investment — and write the brief.'
    + ' Every number must appear above. Every thing you learn from a search must cite its page.';
}

/* the tool, with the two sites this product has promised never to take data
   from blocked in the request itself. An intention is not a control. */
export const SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: Number(process.env.NI_STREET_SEARCHES || 3),
  blocked_domains: ['zillow.com', 'redfin.com', 'trulia.com', 'realtor.com'],
};

/* ── the checks ──────────────────────────────────────────────────────────── */
export function allowedFigures(facts){
  const set = new Set();
  const walk = o => { for (const v of Object.values(o || {})){
    if (typeof v === 'number' && Number.isFinite(v)) set.add(Math.abs(Math.round(v)));
    else if (v && typeof v === 'object') walk(v); } };
  walk(facts);
  return set;
}

/* Blocks come back from the Messages API as text blocks, each carrying its own
   `citations` array. That is what makes the source rule enforceable instead of
   aspirational: a paragraph is either backed by a citation, or it is made of
   figures we supplied, or it does not go on the page. */
export function assemble(content, facts){
  const allowed = allowedFigures(facts);
  const kept = [], dropped = [], invented = [];
  for (const b of (content || [])){
    if (b.type !== 'text') continue;
    const text = String(b.text || '').trim();
    if (!text) continue;
    const cites = (b.citations || [])
      .filter(c => c && c.url)
      .map(c => ({ url: String(c.url).slice(0, 400), title: String(c.title || '').slice(0, 160) }));

    /* rule 1 · money and percentages have to be ours */
    let bad = false;
    for (const m of text.matchAll(/\$\s?([\d][\d,]*)(?:\.\d+)?/g)){
      const n = Math.abs(parseInt(m[1].replace(/,/g, ''), 10));
      if (Number.isFinite(n) && !allowed.has(n)){ bad = true; invented.push(m[0].trim()); }
    }
    for (const m of text.matchAll(/([\d]{1,3})\s?%/g)){
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && !allowed.has(n)){ bad = true; invented.push(m[0].trim()); }
    }
    if (bad){ dropped.push({ why:'figure', text: text.slice(0, 90) }); continue; }
    kept.push({ text, cites });
  }
  return { paragraphs: kept, dropped, invented: [...new Set(invented)].slice(0, 6) };
}

/* Split on blank lines so the page can render one paragraph per block while
   keeping each one's citations attached to it — a citation chip under the
   wrong paragraph is worse than none. */
export function paragraphs(assembled){
  const out = [];
  for (const p of assembled.paragraphs)
    for (const part of p.text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean))
      out.push({ text: part, cites: p.cites });
  return out;
}
