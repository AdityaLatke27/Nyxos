import { describe, expect, it } from 'vitest'
import { HazardField, polarToLatLon, polarXY, type Manifest } from './hazard'
import { evaluate, evaReach, feasibleStarts, runs, type Timeline } from './engine'
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
