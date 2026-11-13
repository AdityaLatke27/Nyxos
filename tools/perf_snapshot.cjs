// Snapshot of analysis outputs for regression checks: node tools/perf_snapshot.cjs <out.json>  (vite dev server on 5199)
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto('http://127.0.0.1:5199/app/landing?map=2d', { waitUntil: 'load' });
  await p.waitForSelector('.ld-table', { timeout: 240000 });
  const r = await p.evaluate(async () => {
    const { loadSimAssets, loadSiteTerrain } = await import('/src/sim/data/loadSimAssets.ts');
    const { CpuTerrain } = await import('/src/sim/terrain/cpuTerrain.ts');
    const eng = await import('/src/landing/engine.ts');
    const near = await import('/src/landing/nearby.ts');
    const { loadEphemerisTable } = await import('/src/astro/ephemerisTable.ts');
    const { NASA_HLS } = await import('/src/landing/profile.ts');
    const { DEFAULT_LINK } = await import('/src/landing/linkBudget.ts');
    const { loadCraters } = await import('/src/landing/craters.ts');
    const { loadLpHydrogen } = await import('/src/landing/hydrogen.ts');
    const { loadTerrainField } = await import('/src/landing/terrain.ts');
    const { HazardField, browserLoader, loadManifest, polarXY } = await import('/src/landing/hazard.ts');
    await loadEphemerisTable();
    const assets = await loadSimAssets(() => {});
    const t = new CpuTerrain(assets);
    const craters = await loadCraters(), hydrogen = await loadLpHydrogen(), lunar = await loadTerrainField();
    const man = await loadManifest(); const hazard = man ? new HazardField(man, browserLoader()) : null;
    const sites = [[-89.78, -155.73], [-89.45, 222.0], [-85.4, 31.0], [-86.8, -76.0], [-84.2, 25.6], [-89.0, 130.0]];
    const starts = [Date.UTC(2027, 0, 1), Date.UTC(2028, 6, 9, 13)];
    const out = [];
    const strip = (a) => JSON.parse(JSON.stringify({ ...a, timeline: undefined, horizon: undefined, grid: undefined, eva: a.eva && { ...a.eva, slopes: undefined } }));
    for (const [lat, lon] of sites) for (const start of starts) for (const stay of [6.5, 14]) {
      const p0 = polarXY(lat, lon);
      if (hazard) await hazard.ensure(p0.x, p0.y, 3500);
      await lunar.ensure(p0.x, p0.y, 10600);
      const prof = { ...NASA_HLS, stayDays: { ...NASA_HLS.stayDays, value: stay } };
      const a = eng.evaluate({ lat, lon, startMs: start, profile: prof, terrain: t, hazard, lunar, link: DEFAULT_LINK, hydrogen, craters });
      const tl = a.timeline; let h = 0; for (let i = 0; i < tl.n; i += 7) h = (h * 31 + Math.round(tl.sunFrac[i] * 1e6) + 7 * Math.round(tl.earthFrac[i] * 1e6)) >>> 0;
      let hz = 0; for (let i = 0; i < a.horizon.length; i++) hz = (hz * 31 + Math.round(a.horizon[i] * 1e5)) >>> 0;
      out.push({ lat, lon, start, stay, a: strip(a), tlHash: h, hzHash: hz });
    }
    const sc = [];
    for (const [lat, lon] of sites.slice(0, 3)) sc.push(await near.shadowScan(t, lat, lon, near.yearSunDirs(starts[0]), 4, 9, async () => {}));
    return { out, sc };
  });
  fs.writeFileSync(process.argv[2], JSON.stringify(r));
  console.log('saved', process.argv[2], r.out.length, 'evaluations', r.sc.length, 'scans');
  await b.close();
})();
