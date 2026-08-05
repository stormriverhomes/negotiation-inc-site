// ── shared helpers for driving the stepped desk ─────────────────────────────
// The desk stopped being one long page: fields live on the step that asks for
// them, and the exits only appear once you underwrite. Harnesses that were
// written against the old single-page layout do not need rewriting so much as
// they need to know how to walk. These are the two moves they all make.

/** Walk the flow to a named step, so its controls are on screen and clickable. */
export async function step(page, id){
  // the seller and the money merged into one step; harnesses that still name
  // the old container get sent where its fields actually live
  const MOVED = { money:'deal', seller:'deal' };
  await page.evaluate(s => window.showStep ? window.showStep(s) : null, MOVED[id] || id);
  await page.waitForTimeout(220);
}

/** Fill the sheet the way a person would: each field on its own step, in order.
 *  Blur is explicit because the desk formats money on blur. */
export async function fillSheet(page, vals){
  /* asking and arv are still the same STEP — the workbench just sits between
     their two grids now, so the walk is unchanged */
  const WHERE = { asking:'property', arv:'property', repairs:'condition',
                  rent:'deal', balance:'deal', piti:'deal', arrears:'deal' };
  if (vals.addr !== undefined){
    await step(page, 'property');
    await page.fill('#addr', vals.addr);
    await page.waitForTimeout(700);              // the ZIP debounce
  }
  const loan = ['balance','piti','arrears'];
  if (Object.keys(vals).some(k => loan.includes(k))){
    await page.evaluate(()=>{ S.mode='advanced'; save(); render(); });
  }
  for (const [k, v] of Object.entries(vals)){
    if (k === 'addr' || v === undefined) continue;
    await step(page, WHERE[k] || 'property');
    if (loan.includes(k)) await page.evaluate(()=>{ const d=document.getElementById('loan'); if(d) d.open = true; });
    const sel = `[data-f="${k}"]`;
    await page.waitForSelector(sel, { timeout: 4000 });
    await page.fill(sel, String(v));
    await page.press(sel, 'Tab');
    await page.waitForTimeout(180);
  }
}

/** Ask for the answer, skipping the loading theatre a real click would play. */
export async function underwrite(page){
  await page.evaluate(()=>window.__showResults());
  await page.waitForTimeout(320);
}

/** Open a ranked exit row by id (they collapse by default). */
export async function openExit(page, id){
  await page.evaluate(x => {
    if (!document.querySelector(`#x-${x} .working`)) document.querySelector(`[data-row="${x}"]`)?.click();
  }, id);
  await page.waitForTimeout(180);
}
