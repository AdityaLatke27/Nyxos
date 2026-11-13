// Times the hot paths of the landing analysis in a real browser page (vite dev server on 5199). Run: node tools/perf_probe.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto('http://127.0.0.1:5199/app/landing?map=2d', { waitUntil: 'load' });
  await p.waitForSelector('.ld-table', { timeout: 240000 });
  const r = await p.evaluate(async () => {
    const T = async (f) => { const t = performance.now(); const v = await f(); return [performance.now() - t, v] };
    const { loadSimAssets } = await import('/src/sim/data/loadSimAssets.ts');
    const { CpuTerrain } = await import('/src/sim/terrain/cpuTerrain.ts');
    const eng = await import('/src/landing/engine.ts');
    const near = await import('/src/landing/nearby.ts');
    const { loadEphemerisTable } = await import('/src/astro/ephemerisTable.ts');
    const { NASA_HLS } = await import('/src/landing/profile.ts');
    await loadEphemerisTable();
    const assets = await loadSimAssets(() => {});
    const t = new CpuTerrain(assets);
    const lat = -89.78, lon = -155.73, start = Date.UTC(2027, 0, 1);
    const out = {};
    let h; [out.horizon720x340, h] = await T(() => t.horizonProfile(lat, lon));
    let tl; [out.timeline365d, tl] = await T(() => eng.buildTimeline(h, lat, lon, 0, start, 365));
    [out.timeline6p5d] = await T(() => eng.buildTimeline(h, lat, lon, 0, start, 6.5));
    [out.evaluateNoLayers] = await T(() => eng.evaluate({ lat, lon, startMs: start, profile: NASA_HLS, terrain: t, hazard: null, lunar: null }));
    [out.evaluateNoLayers2] = await T(() => eng.evaluate({ lat, lon, startMs: start, profile: NASA_HLS, terrain: t, hazard: null, lunar: null }));
    let sd; [out.yearSunDirs] = await T(() => near.yearSunDirs(start));
    [out.shadowScan] = await T(async () => { const d = near.yearSunDirs(start); return near.shadowScan(t, lat, lon, d, 4, 9, async () => {}) });
    out.moonStateCalls = 0;
    return out;
  });
  console.log(JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) + ' ms' : v])), null, 1));
  await b.close();
})();
