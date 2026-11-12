// Runs NYXOS illumination at the 130 Wueller et al. (2026) candidate sites for 2026-2032 and lists
// every lit run (disc fraction >= 0.5) of >= 1 day, so it can be compared with their SunDays/SunEarth tables.
const { chromium } = require('playwright'); const fs = require('fs');
const rows = fs.readFileSync(__dirname + '/wueller_sites.csv','utf8').trim().split('\n').slice(1).map(l=>{const c=l.replace(/"/g,'').split(',');return {name:c[5],lat:+c[3],lon:+c[4]}}).filter(r=>isFinite(r.lat));
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto('http://127.0.0.1:5199/app/landing?map=2d', { waitUntil: 'load' });
  const res = await p.evaluate(async (rows) => {
    const { loadSimAssets } = await import('/src/sim/data/loadSimAssets.ts');
    const { CpuTerrain } = await import('/src/sim/terrain/cpuTerrain.ts');
    const { buildTimeline } = await import('/src/landing/engine.ts');
    const { loadEphemerisTable } = await import('/src/astro/ephemerisTable.ts');
    await loadEphemerisTable();
    const assets = await loadSimAssets(() => {});
    const t = new CpuTerrain(assets);
    const start = Date.UTC(2026, 0, 1), days = 2557; // 2026-01-01 .. 2032-12-31
    const out = [];
    for (const r of rows) {
      const h = t.horizonProfile(r.lat, r.lon);
      const hKm = t.heightAtLatLon(r.lat, r.lon);
      const tl = buildTimeline(h, r.lat, r.lon, hKm, start, days);
      const dt = days * 86400000 / tl.n;
      const runs = (arr) => { const o = []; let s = -1; for (let i = 0; i <= tl.n; i++) { const on = i < tl.n && arr[i] >= 0.5; if (on && s < 0) s = i; if (!on && s >= 0) { const d = (i - s) * dt / 86400000; if (d >= 1) o.push([+(start + s * dt) / 1, +d.toFixed(2)]); s = -1 } } return o };
      out.push({ ...r, demM: t.resolutionKmAt(r.lat, r.lon) * 1000, sun: runs(tl.sunFrac), earth: runs(tl.earthFrac) });
    }
    return out;
  }, rows);
  fs.writeFileSync('/tmp/wueller_nyxos.json', JSON.stringify(res));
  console.log('done', res.length);
  await b.close();
})();
