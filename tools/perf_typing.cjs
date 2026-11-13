// Main-thread blocking while editing mission fields on the Landing page: node tools/perf_typing.cjs  (vite dev server on 5199)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)) });
  await p.addInitScript(() => { window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(e.duration) }).observe({ entryTypes: ['longtask'] }) });
  await p.goto('http://127.0.0.1:5199/app/landing?map=2d&lat=-89.78&lon=-155.73', { waitUntil: 'load' });
  await p.waitForSelector('.ld-table', { timeout: 240000 });
  await p.waitForFunction(() => !document.body.innerText.includes('Scanning') , null, { timeout: 120000 }).catch(() => {});
  await p.waitForTimeout(6000);
  await p.evaluate(() => { window.__lt.length = 0 });
  const t0 = Date.now();
  const stay = p.locator('input[type="number"][max="30"], input[type="number"][min="1"]').first();
  await stay.click(); await stay.press('Control+a');
  for (const ch of '9.5') { await stay.type(ch, { delay: 120 }) }
  await p.click('summary:has-text("Link budget")');
  const link = p.locator('input[min="0.001"]');
  await link.click(); await link.press('Control+a');
  for (const ch of '12') { await link.type(ch, { delay: 120 }) }
  await p.waitForTimeout(5000);
  const lt = await p.evaluate(() => window.__lt);
  const row = await p.$$eval('.ld-row', r => r.filter(x => /link margin/i.test(x.innerText)).map(x => x.innerText.slice(0, 90)));
  console.log(JSON.stringify({ longTasks: lt.length, totalBlockedMs: Math.round(lt.reduce((a, c) => a + c, 0)), worstMs: Math.round(Math.max(0, ...lt)), linkRow: row, errors: errs.slice(0, 3) }));
  await b.close();
})();
