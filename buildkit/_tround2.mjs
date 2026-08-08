/* THE ROUND TRIP: does a sheet survive leaving this browser and coming back?
   save() serialises figures into an `f: {v,e,p,u}` map and cleanProp restores
   them ONLY from that map. But the sync uploads `blob: p` — the raw in-memory
   prop, which has raw/est/prov/unc and no `f` at all — and the file export
   writes the same shape. So the loop in cleanProp never runs, every money
   field comes back NEEDED, and all four provenance records are destroyed.
   Then the second device pushes the gutted blob back over the good row.

   This asserts the property that actually matters: a prop that goes out
   through EITHER route and comes back must still know its numbers. */
import { chromium } from 'playwright';
import path from 'node:path';
const FILE = 'file://' + path.resolve(process.argv[2] || 'dist/desk.html');
let n=0,bad=0;
const ok=(t,p,x)=>{n++; if(!p){bad++;console.log('✗ '+t+(x!==undefined?'  ← '+JSON.stringify(x).slice(0,300):''));}else console.log('✓ '+t);};

const b = await chromium.launch();
const pg = await b.newPage({ viewport:{ width:1280, height:900 } });
const errs=[]; pg.on('pageerror',e=>errs.push(String(e).slice(0,160)));
await pg.goto(FILE); await pg.waitForTimeout(600);

const FIELDS = ['asking','arv','repairs','rent'];

const made = await pg.evaluate((F)=>{
  P.props.length = 0;
  const p = newProp('1104 Elm Street');
  p.addr = '1104 Elm Street, Atlanta GA';
  const vals = { asking:'168,000', arv:'296,500', repairs:'41,300', rent:'1,875' };
  for (const k of F){
    p.raw[k] = vals[k]; p.est[k] = false;
    p.prov[k] = 'you typed it'; p.unc[k] = null;
  }
  p.comps = [['88 Ostend St','271000','1290','3','1.5','5','0.4',-1]];
  P.props.push(p); P.active = 0; loadInto(0); save();
  return { raw: { ...p.raw }, hasF: 'f' in p };
}, FIELDS);
ok('a sheet with four typed figures exists', Object.keys(made.raw).length === 4, made);
ok('the in-memory prop has no `f` map (the shape both exports use)', made.hasF === false, made);

/* ── ROUTE 1 · the wire. Exactly what pushLocal uploads and what the other
      device runs it through on the way back in. ─────────────────────────── */
const wire = await pg.evaluate((F)=>{
  const p = P.props[0];
  const blob = JSON.parse(JSON.stringify(p));      // what pushLocal sends
  const back = cleanProp(blob);                     // what the other device does
  const lost = F.filter(k => !String(back.raw[k]||'').trim());
  return { lost, sample: back.raw, prov: back.prov };
}, FIELDS);
ok('a synced sheet keeps its figures on the other device',
   wire.lost.length === 0, { lost: wire.lost, got: wire.sample });
ok('and keeps why it believes them', !!wire.prov.arv, wire.prov);

/* ── ROUTE 2 · the file. "Yours to keep, and yours to load back in." ────── */
const file = await pg.evaluate((F)=>{
  /* dumpSheets downloads rather than returns, so intercept the Blob it builds
     — the bytes a user actually gets are what this has to assert on */
  if (typeof dumpSheets !== 'function') return { skip:true };
  let captured = null;
  const RealBlob = window.Blob;
  window.Blob = function(parts, opts){ captured = String(parts[0]); return new RealBlob(parts, opts); };
  const clickWas = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function(){};       // do not actually download
  try { dumpSheets(); } finally { window.Blob = RealBlob; HTMLAnchorElement.prototype.click = clickWas; }
  if (!captured) return { skip:false, lost:F, why:'no blob captured' };
  const parsed = JSON.parse(captured);
  const props = parsed.props || [];
  if (!props.length) return { skip:false, lost:F, why:'export produced no props' };
  const back = cleanProp(props[0]);
  return { skip:false, lost: F.filter(k => !String(back.raw[k]||'').trim()), sample: back.raw,
           prov: back.prov.arv };
}, FIELDS);
if (!file.skip)
  ok('an exported sheet loads back in with its figures', file.lost.length === 0, file);

/* ── the belt and braces: a blob ALREADY on the server is in the broken
      shape, so the loader has to cope with both forms ─────────────────── */
const legacy = await pg.evaluate(()=>{
  const withF = cleanProp({ id:'pabc123', name:'via f', f:{ arv:{ v:'300,000', e:true, p:'the panel', u:0.15 } } });
  const withRaw = cleanProp({ id:'pdef456', name:'via raw', raw:{ arv:'300,000' }, est:{arv:true},
                              prov:{arv:'the panel'}, unc:{arv:0.15} });
  return { f: withF.raw.arv, raw: withRaw.raw.arv,
           fProv: withF.prov.arv, rawProv: withRaw.prov.arv,
           fUnc: withF.unc.arv, rawUnc: withRaw.unc.arv };
});
ok('the localStorage shape still loads', legacy.f === '300,000', legacy);
ok('the wire/file shape loads too', legacy.raw === '300,000', legacy);
ok('both carry provenance', !!legacy.fProv && !!legacy.rawProv, legacy);
ok('both carry uncertainty', legacy.fUnc === 0.15 && legacy.rawUnc === 0.15, legacy);

ok('no page errors', errs.length===0, errs[0]);
await b.close();
console.log('\n'+(bad? '✗ '+bad+' of '+n+' failed' : '✓ all '+n+' hold'));
process.exit(bad?1:0);
