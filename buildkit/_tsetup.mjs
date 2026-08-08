import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:900,height:1200}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
await p.context().grantPermissions(['clipboard-read','clipboard-write']);
await p.goto('file:///home/claude/setup.html'); await p.waitForTimeout(400);
// copy the SQL and read it back off the clipboard
await p.click('button[data-copy="sql-main"]');
await p.waitForTimeout(300);
const clip = await p.evaluate(()=>navigator.clipboard.readText());
await p.click('button[data-val="SUPABASE_SERVICE_KEY"]');
await p.waitForTimeout(300);
const clip2 = await p.evaluate(()=>navigator.clipboard.readText());
// progress
for (const s of ['s1','s2','s3']) { await p.click(`button[data-done="${s}"]`); await p.waitForTimeout(120); }
const st = await p.evaluate(()=>({ n:document.getElementById('ndone').textContent,
  w:document.getElementById('bar').style.width,
  doneSecs:[...document.querySelectorAll('section.done')].map(s=>s.id) }));
await p.click('button[data-done="s2"]'); await p.waitForTimeout(150);
const st2 = await p.evaluate(()=>document.getElementById('ndone').textContent);
console.log(JSON.stringify({
  sqlCopied: clip.startsWith('-- ── PROFILES') && clip.includes('not distinct from') && clip.includes('waitlist'),
  sqlLen: clip.length,
  nameCopied: clip2, progress: st, afterUndo: st2, errs }, null, 1));
await b.close();
