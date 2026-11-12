const { chromium } = require('playwright'); const fs = require('fs');
const rows = fs.readFileSync('/tmp/avgvis_ref.csv','utf8').trim().split('\n').slice(1).map(l=>{const c=l.split(',');return {map:c[0],lat:+c[1],lon:+c[2],sun:+c[5],earth:+c[6]}});
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
    const start = Date.UTC(2027, 0, 1), days = 365.25 * 3;
    const out = [];
    for (const r of rows) {
      const h = t.horizonProfile(r.lat, r.lon);
      const hKm = t.heightAtLatLon(r.lat, r.lon);
      const tl = buildTimeline(h, r.lat, r.lon, hKm, start, days);
      let any = 0, half = 0, mean = 0, eany = 0, ehalf = 0, emean = 0;
      for (let i = 0; i < tl.n; i++) { const s = tl.sunFrac[i], e = tl.earthFrac[i]; if (s > 0) any++; if (s >= 0.5) half++; mean += s; if (e > 0) eany++; if (e >= 0.5) ehalf++; emean += e }
      out.push({ ...r, demM: t.resolutionKmAt(r.lat, r.lon) * 1000, sAny: any / tl.n, sHalf: half / tl.n, sMean: mean / tl.n, eAny: eany / tl.n, eHalf: ehalf / tl.n, eMean: emean / tl.n });
    }
    return out;
  }, rows);
  fs.writeFileSync('/tmp/validate.json', JSON.stringify(res));
  console.log('done', res.length);
  await b.close();
})();
