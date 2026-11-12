import { describe, expect, it } from 'vitest'
import { HazardField, polarToLatLon, polarXY, type Manifest } from './hazard'
import { buildTimeline, crossingTime, evaluate, evaReach, feasibleStarts, runs, windowStats, type Timeline } from './engine'
import { NASA_HLS, customProfile } from './profile'

const flat = {
  horizonProfile: () => new Float32Array(720).fill(-0.5),
  heightAtLatLon: () => 0,
  resolutionKmAt: () => 0.1,
}

function field(tier: 'a' | 'b', p95: number, frac10: number, err = 5) {
  const cellM = tier === 'a' ? 100 : 200
  const half = 12800
  const cells = (2 * half) / cellM
  const T = 256
  const m: Manifest = {
    tileCells: T, source: 'test',
    tiers: [{ id: tier, product: 't', errProduct: 'e', nativeM: tier === 'a' ? 10 : 20, cellM, halfExtentM: half, cells, tilesPerSide: 1, tiles: [[0, 0]] }],
  }
  const d = new Uint8ClampedArray(T * T * 4)
  for (let i = 0; i < T * T; i++) { d[4 * i] = Math.round(p95 * 2); d[4 * i + 1] = frac10; d[4 * i + 2] = err; d[4 * i + 3] = 255 }
  return new HazardField(m, async () => d)
}

describe('polar projection', () => {
  it('round trips and puts +x at 90E, +y at 0E', () => {
    for (const [la, lo] of [[-89.5, 10], [-85, -120], [-80, 179]]) {
      const { x, y } = polarXY(la, lo)
      const r = polarToLatLon(x, y)
      expect(r.lat).toBeCloseTo(la, 6)
      expect(r.lon).toBeCloseTo(lo, 6)
    }
    const a = polarXY(-89, 90), b = polarXY(-89, 0)
    expect(a.x).toBeGreaterThan(0); expect(Math.abs(a.y)).toBeLessThan(1e-6)
    expect(b.y).toBeGreaterThan(0)
  })
})

describe('runs and windows', () => {
  it('finds runs', () => expect(runs(6, (i) => i === 1 || i === 2 || i === 5)).toEqual([{ start: 1, end: 3 }, { start: 5, end: 6 }]))
  it('feasible starts need the whole window lit', () => {
    const n = 10
    const tl = { n, sunFrac: Float32Array.from([1, 1, 1, 0, 1, 1, 1, 1, 1, 1]), earthFrac: new Float32Array(n).fill(1) } as unknown as Timeline
    expect(feasibleStarts(tl, 3, false)).toEqual([{ start: 0, end: 1 }, { start: 4, end: 8 }])
  })
})

describe('slope verdicts', () => {
  const [lat, lon] = [-89.5, 40]
  const run = async (f: HazardField | null, prof = NASA_HLS) => {
    const p = polarXY(lat, lon)
    await f?.ensure(p.x, p.y, 2500)
    return evaluate({ lat, lon, startMs: Date.UTC(2026, 10, 15), profile: prof, terrain: flat, hazard: f, scanDays: 8 })
  }
  const slope = (a: Awaited<ReturnType<typeof run>>) => a.rows.find((r) => r.id === 'slope')!
  it('PASS on gentle fine-resolution terrain', async () => expect(slope(await run(field('a', 3, 0))).status).toBe('PASS'))
  it('WARNING when error pushes past the limit', async () => expect(slope(await run(field('a', 9.8, 2, 10))).status).toBe('WARNING'))
  it('FAIL when most pixels are steep', async () => expect(slope(await run(field('a', 16, 80))).status).toBe('FAIL'))
  it('coarse tier is capped at WARNING', async () => expect(slope(await run(field('b', 2, 0))).status).toBe('WARNING'))
  it('no data -> NOT EVALUATED, safety cannot be assessed', async () => {
    const a = await run(null)
    expect(slope(a).status).toBe('NOT_EVALUATED')
    expect(a.headline.level).not.toBe('FEASIBLE')
  })
  it('latitude envelope fails far from the pole under HLS but not for a custom lander', async () => {
    const a = evaluate({ lat: 0.67, lon: 23.47, startMs: 0, profile: NASA_HLS, terrain: flat, hazard: null, scanDays: 8 })
    expect(a.rows.find((r) => r.id === 'band')!.status).toBe('FAIL')
    const b = evaluate({ lat: 0.67, lon: 23.47, startMs: 0, profile: customProfile({}), terrain: flat, hazard: null, scanDays: 8 })
    expect(b.rows.find((r) => r.id === 'band')).toBeUndefined()
  })
  it('boulders are always a stated data gap', async () => {
    const a = await run(field('a', 3, 0))
    expect(a.rows.find((r) => r.id === 'boulders')!.status).toBe('NOT_EVALUATED')
    expect(a.gaps.join(' ')).toMatch(/Boulder/)
  })
})

describe('headline', () => {
  it('names only the failed verdict', async () => {
    const f = field('a', 3, 0)
    const p = polarXY(-89.5, 40)
    await f.ensure(p.x, p.y, 2500)
    const a = evaluate({ lat: -89.5, lon: 40, startMs: Date.UTC(2026, 10, 15), profile: NASA_HLS, terrain: flat, hazard: f, scanDays: 8 })
    expect(a.safety.status).toBe('PASS')
    expect(a.headline.text).not.toMatch(/All gating constraints met/)
  })
})

describe('EVA reach', () => {
  it('is blocked when the landing cell itself is steeper than the limit', async () => {
    const f = field('a', 25, 100)
    await f.ensure(0, 0, 3000)
    const c = f.cellAt(50, 50)!
    expect(evaReach(f, c.x, c.y, 2000, 20, 100)!.reachablePct).toBe(0)
  })
  it('is fully reachable on flat ground', async () => {
    const f = field('a', 2, 0)
    await f.ensure(0, 0, 3000)
    const c = f.cellAt(50, 50)!
    expect(evaReach(f, c.x, c.y, 2000, 20, 100)!.reachablePct).toBe(100)
  })
})

import { ScienceGrid, TerrainField, type TerrainMeta } from './terrain'

function lunarField(slope: number, rough: number, tmaxK: number, withPsrAt?: { i: number; j: number }, evaSlope = 8) {
  const T = 256, half = 12800, cell = 100
  const meta: TerrainMeta = { tileCells: T, source: 't', tiers: [{ id: 'a', cellM: cell, halfExtentM: half, cells: 256, tilesPerSide: 1, tiles: [[0, 0]] }] }
  const t = new Uint8ClampedArray(T * T * 4), e = new Uint8ClampedArray(T * T * 4), v = new Uint8ClampedArray(T * T * 4)
  const hq = Math.round((1500 + 10000) / 0.5)
  for (let i = 0; i < T * T; i++) {
    t[4 * i] = Math.round(slope * 2); t[4 * i + 1] = Math.round(rough / 0.02); t[4 * i + 2] = 0; t[4 * i + 3] = 255
    v[4 * i] = Math.round(evaSlope * 2); v[4 * i + 1] = Math.round(evaSlope * 2); v[4 * i + 2] = Math.round(evaSlope * 2); v[4 * i + 3] = 255
    e[4 * i] = hq >> 8; e[4 * i + 1] = hq & 255; e[4 * i + 2] = 7; e[4 * i + 3] = 255
  }
  if (withPsrAt) { // a PSR block offset (in cells) from the test site
    const sp = polarXY(-89.5, 40)
    const c = Math.floor((sp.x + half) / cell) + withPsrAt.i, r = Math.floor((half - sp.y) / cell) - withPsrAt.j
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) t[4 * ((r + dr) * T + c + dc) + 2] = 100
  }
  const N = 100, sm = { halfExtentM: half, pixelM: 256, size: [N, N] as [number, number], sources: 's',
    layers: { Tmax: { lo: 41, hi: 328, step: 287 / 254, nodata: 255 }, Tmean: { lo: 29, hi: 183, step: 154 / 254, nodata: 255 }, zit: { lo: 0, hi: 1, step: 1 / 254, nodata: 255 },
      f110s: { lo: 0, hi: 1, step: 1 / 254, nodata: 255 }, f110w: { lo: 0, hi: 1, step: 1 / 254, nodata: 255 }, psr: { lo: 0, hi: 1, step: 1 / 254, nodata: 255 } } }
  const s1 = new Uint8ClampedArray(N * N * 4), s2 = new Uint8ClampedArray(N * N * 4)
  for (let i = 0; i < N * N; i++) { s1[4 * i] = Math.round((tmaxK - 41) / (287 / 254)); s1[4 * i + 1] = 100; s1[4 * i + 2] = 255; s1[4 * i + 3] = 255; s2[4 * i] = 127; s2[4 * i + 1] = 127; s2[4 * i + 2] = 0; s2[4 * i + 3] = 255 }
  return new TerrainField(meta, async () => t, async () => e, new ScienceGrid(sm, s1, s2), async () => v)
}

describe('100 m plane-fit slope, roughness, science', () => {
  const [lat, lon] = [-89.5, 40]
  const run = async (lf: TerrainField) => {
    const p = polarXY(lat, lon)
    await lf.ensure(p.x, p.y, 12000)
    return evaluate({ lat, lon, startMs: Date.UTC(2026, 10, 15), profile: NASA_HLS, terrain: flat, hazard: null, lunar: lf, scanDays: 8 })
  }
  const row = (a: Awaited<ReturnType<typeof run>>, id: string) => a.rows.find((r) => r.id === id)!
  it('PASS under the limit, FAIL over it, using the NASA baseline', async () => {
    expect(row(await run(lunarField(6, 0.4, 300)), 'slope').status).toBe('PASS')
    expect(row(await run(lunarField(12, 0.4, 300)), 'slope').status).toBe('FAIL')
  })
  it('reports roughness and elevation without gating', async () => {
    const a = await run(lunarField(4, 0.62, 300))
    expect(row(a, 'rough').gating).toBe(false)
    expect(row(a, 'rough').value).toContain('0.62')
    expect(row(a, 'elev').value).toContain('1500')
  })
  it('science: FAIL without any PSR or cold bin, PASS with a nearby PSR and cold bins', async () => {
    const none = await run(lunarField(4, 0.4, 300))
    expect(row(none, 'coldtrap').status).toBe('FAIL')
    expect(row(none, 'icetherm').status).toBe('FAIL')
    expect(none.science.status).toBe('FAIL')
    const near = await run(lunarField(4, 0.4, 90, { i: 5, j: 0 }))
    expect(row(near, 'coldtrap').status).toBe('PASS')
    expect(row(near, 'icetherm').status).toBe('PASS')
    expect(near.science.status).toBe('PASS')
    expect(row(near, 'hydrogen').status).toBe('NOT_EVALUATED')
  })
  it('EVA slope on the 1.6 km baseline gates Operations', async () => {
    expect(row(await run(lunarField(4, 0.4, 300, undefined, 8)), 'eva2km').status).toBe('PASS')
    const bad = await run(lunarField(4, 0.4, 300, undefined, 24))
    expect(row(bad, 'eva2km').status).toBe('FAIL')
    expect(bad.operations.status).toBe('FAIL')
  })
  it('PSR only beyond EVA reach is a WARNING', async () => {
    const far = await run(lunarField(4, 0.4, 300, { i: -40, j: 0 }))
    expect(row(far, 'coldtrap').status).toBe('WARNING')
  })
})

import { sunStatus, earthStatus } from './sensitivity'

describe('uncertainty and sensitivity', () => {
  const [lat, lon] = [-89.5, 40]
  const a = evaluate({ lat, lon, startMs: Date.UTC(2026, 10, 15), profile: NASA_HLS, terrain: flat, hazard: null, scanDays: 30 })
  it('helper statuses reproduce the verdict rows', () => {
    const sun = a.rows.find((r) => r.id === 'sun')!, earth = a.rows.find((r) => r.id === 'earth')!
    expect(sunStatus(a.stats.litPct, NASA_HLS, false)).toBe(sun.status)
    expect(earthStatus(a.stats.earthPct, NASA_HLS, false)).toBe(earth.status)
  })
  it('lit share never rises when the horizon is raised, and the curve spans ±1°', () => {
    const c = a.sensitivity.curve
    expect(c.offsetDeg[0]).toBe(-1)
    expect(c.offsetDeg[c.offsetDeg.length - 1]).toBe(1)
    for (let i = 1; i < c.litPct.length; i++) expect(c.litPct[i]).toBeLessThanOrEqual(c.litPct[i - 1] + 1e-9)
    for (let i = 1; i < c.earthPct.length; i++) expect(c.earthPct[i]).toBeLessThanOrEqual(c.earthPct[i - 1] + 1e-9)
  })
  it('a flip margin is exactly where the status first differs along the curve', () => {
    const c = a.sensitivity.curve
    const base = sunStatus(a.stats.litPct, NASA_HLS, false)
    const f = a.sensitivity.flip.sun
    c.offsetDeg.forEach((d, i) => {
      const st = sunStatus(c.litPct[i], NASA_HLS, false)
      const m = d > 0 ? f.raise : d < 0 ? f.lower : null
      if (m === null) { if (d !== 0) expect(st).toBe(base); return }
      if (Math.abs(d) >= m - 1e-9) expect(st).not.toBe(base)
      else if (Math.abs(d) <= m - 0.1) expect(st).toBe(base)
    })
  })
  it('lit definitions are ordered any ≥ half ≥ whole', () => {
    const d = a.sensitivity.litDefinitions
    expect(d.anyPartPct).toBeGreaterThanOrEqual(d.halfDiscPct)
    expect(d.halfDiscPct).toBeGreaterThanOrEqual(d.wholeDiscPct)
  })
  it('slope margin flags a verdict inside the map error as sensitive', async () => {
    const lf = lunarField(10.5, 0.4, 300)
    const p = polarXY(lat, lon)
    await lf.ensure(p.x, p.y, 12000)
    const b = evaluate({ lat, lon, startMs: Date.UTC(2026, 10, 15), profile: NASA_HLS, terrain: flat, hazard: null, lunar: lf, scanDays: 8 })
    expect(b.sensitivity.slope).not.toBeNull()
    // no map error in this synthetic field, so 0.5° over the limit is not inside an error bar
    expect(b.sensitivity.slope!.sensitive).toBe(false)
    expect(b.sensitivity.slope!.marginDeg).toBeCloseTo(-0.5, 1)
  })
})

describe('exact sunrise and sunset times', () => {
  // a 3 degree ridge in every direction: the Sun is lit when it is more than ~3 degrees up
  const ridge = new Float32Array(720).fill(3)
  const tl = buildTimeline(ridge, -85.5, 20, 0, Date.UTC(2027, 0, 1), 40)
  it('refined crossings lie inside their sample step and sit on the 0.5 threshold', () => {
    let checked = 0
    for (let i = 1; i < tl.n && checked < 6; i++) {
      if ((tl.sunFrac[i] >= 0.5) === (tl.sunFrac[i - 1] >= 0.5)) continue
      const t = crossingTime(tl, 'sun', i)
      const t0 = tl.startMs + (i - 1) * tl.stepMs
      expect(t).toBeGreaterThanOrEqual(t0)
      expect(t).toBeLessThanOrEqual(t0 + tl.stepMs)
      expect(Math.abs(tl.fracAt!(t).sun - 0.5)).toBeLessThan(0.02)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })
  it('window statistics report refined sunrise/sunset times and a refined longest dark run', () => {
    const w = windowStats(tl, 0, tl.n)
    expect(w.sunrises.length + w.sunsets.length).toBeGreaterThan(0)
    for (const t of [...w.sunrises, ...w.sunsets]) expect(t).toBeGreaterThan(tl.startMs)
    expect(w.longestDarkH).toBeGreaterThanOrEqual(0)
  })
})

import { compareCsv, rowDiffers, rowList, verdictSummary, type CompareResult } from './compare'
describe('site comparison helpers', () => {
  const mk = (name: string, st: 'PASS' | 'FAIL'): CompareResult => ({
    entry: { id: name, name, lat: -89, lon: 0 },
    a: {
      rows: [{ id: 'slope', label: 'Landing slope', status: st, value: '5°', limit: '', limitSource: '', tag: 'NASA' as never, basis: '', why: '', gating: true }],
      safety: { status: st, reasons: [] }, operations: { status: 'PASS', reasons: [] }, science: { status: 'INFO' as never, reasons: [] },
      sensitivity: { level: 'ROBUST' } as never, windows: { litAndEarth: [], litOnly: [] },
    } as never,
  })
  const rs = [mk('A', 'PASS'), mk('B', 'FAIL')]
  it('detects rows whose status differs and lists them once', () => {
    expect(rowList(rs).map((r) => r.id)).toEqual(['slope'])
    expect(rowDiffers(rs, 'slope')).toBe(true)
    expect(rowDiffers([mk('A', 'PASS'), mk('B', 'PASS')], 'slope')).toBe(false)
  })
  it('summarises each verdict separately and never produces a combined score', () => {
    const s = verdictSummary(rs)
    expect(s).toHaveLength(3)
    expect(s[0]).toBe('Safety — pass: A; fail: B')
    expect(s.join(' ')).not.toMatch(/score|rank/i)
  })
  it('exports csv with one column per site', () => {
    const c = compareCsv(rs, { profile: 'p', startIso: 't', stayDays: 6.5 })
    expect(c.split('\n').find((l) => l.startsWith('"Safety verdict"'))).toBe('"Safety verdict","PASS","FAIL"')
  })
})
