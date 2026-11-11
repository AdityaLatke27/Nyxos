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
