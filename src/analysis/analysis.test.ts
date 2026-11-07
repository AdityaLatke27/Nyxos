import { describe, expect, it } from 'vitest'
import {
  angularDistance,
  dirFromLatLon,
  greatCircleKm,
  latLonFromDir,
  offsetLatLon,
  R_KM,
  tangentOffset,
  wrapLon,
  type LatLon,
} from './geo'
import { histogram, summarize } from './stats'
import { sampleDisc, sampleTransect, slopeAspectAt, type HeightSampler } from './terrain'
import { analyzeCrater, ZONE_LIMITS, zoneOf } from './crater'

/** Height source defined analytically on the tangent plane around `center` (km in, km out). */
function plane(center: LatLon, fn: (x: number, y: number) => number): HeightSampler {
  return {
    heightAtLatLon: (lat, lon) => {
      const { x, y } = tangentOffset(center, { lat, lon })
      return fn(x, y)
    },
  }
}

/** Bowl crater: floor -depth at the centre, raised rim at r = Rc, rim ejecta decaying outward. */
function bowl(center: LatLon, Rc: number, depthKm: number, rimKm: number) {
  return plane(center, (x, y) => {
    const r = Math.hypot(x, y)
    return r <= Rc ? -depthKm + (depthKm + rimKm) * (r / Rc) ** 2 : rimKm * Math.exp(-(r - Rc) / (0.25 * Rc))
  })
}

/** One degree of arc on the 1737.4 km reference sphere (≈ 30.3234 km). */
const KM_PER_DEG = (R_KM * Math.PI) / 180

const near = (a: number[], b: number[], tol: number) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(tol))

describe('coordinate conventions', () => {
  it('maps known lunar locations to the scene frame (+Y north, +Z 0°E, +X 90°E)', () => {
    near(dirFromLatLon(0, 0), [0, 0, 1], 1e-12)
    near(dirFromLatLon(0, 90), [1, 0, 0], 1e-12)
    near(dirFromLatLon(90, 0), [0, 1, 0], 1e-12)
    near(dirFromLatLon(-90, 0), [0, -1, 0], 1e-12)
    near(dirFromLatLon(0, -90), [-1, 0, 0], 1e-12)
  })

  it('round-trips lat/lon through the direction vector, including negative longitudes', () => {
    for (const [lat, lon] of [[-89.67, 129.78], [-85.3, -150.2], [12.5, -179.9], [0, 0]]) {
      const [la, lo] = latLonFromDir(dirFromLatLon(lat, lon))
      expect(la).toBeCloseTo(lat, 9)
      expect(lo).toBeCloseTo(lon, 9)
    }
  })

  it('wraps longitudes into (-180, 180]', () => {
    expect(wrapLon(190)).toBe(-170)
    expect(wrapLon(-190)).toBe(170)
    expect(wrapLon(180)).toBe(180)
    expect(wrapLon(-180)).toBe(180)
    expect(wrapLon(360)).toBe(0)
  })

  it('measures great-circle distance on the 1737.4 km reference sphere', () => {
    expect(greatCircleKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(KM_PER_DEG, 9)
    // Shackleton (89.67°S) is 0.33° from the pole, about 10 km
    expect(greatCircleKm({ lat: -89.67, lon: 129.78 }, { lat: -90, lon: 0 })).toBeCloseTo(0.33 * KM_PER_DEG, 9)
    expect(angularDistance(dirFromLatLon(0, 0), dirFromLatLon(0, 180))).toBeCloseTo(Math.PI, 12)
  })

  it('converts tangent-plane offsets back and forth', () => {
    for (const c of [{ lat: -85, lon: 30 }, { lat: -89.9, lon: -120 }, { lat: 20, lon: 175 }]) {
      const p = offsetLatLon(c, 3.2, -4.7)
      const back = tangentOffset(c, p)
      expect(back.x).toBeCloseTo(3.2, 9)
      expect(back.y).toBeCloseTo(-4.7, 9)
    }
  })
})

describe('DEM sampling and slope', () => {
  const c = { lat: -89.5, lon: 40 } // close to the pole, where east/north are least forgiving

  it('returns the height of the source in metres along a transect', () => {
    const t = sampleTransect({ heightAtLatLon: () => 0.5 }, { lat: 0, lon: 0 }, { lat: 1, lon: 0 }, 0.5)
    expect(t.lengthKm).toBeCloseTo(KM_PER_DEG, 9)
    expect(t.distKm[0]).toBe(0)
    expect(t.distKm.at(-1)).toBeCloseTo(t.lengthKm, 9)
    expect(t.elevM.every((v) => v === 500)).toBe(true)
    expect(t.slopeDeg.every((v) => Math.abs(v) < 1e-9)).toBe(true)
  })

  it('recovers a known gradient along an equatorial transect', () => {
    const origin = { lat: 0, lon: 0 }
    const t = sampleTransect(plane(origin, (x) => 0.05 * x), origin, { lat: 0, lon: 10 / KM_PER_DEG }, 0.2)
    expect(t.lengthKm).toBeCloseTo(10, 6)
    t.distKm.forEach((d, i) => expect(Math.abs(t.elevM[i] - 50 * d)).toBeLessThan(0.5))
    expect(t.slopeDeg[5]).toBeCloseTo((Math.atan(0.05) * 180) / Math.PI, 1)
  })

  it('gives the right slope and aspect for east- and north-rising ramps', () => {
    const east = slopeAspectAt(plane(c, (x) => 0.1 * x), c, 0.1)
    expect(east.slopeDeg).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 3)
    expect(east.aspectDeg).toBeCloseTo(270, 3) // rises to the east, so it faces west
    const north = slopeAspectAt(plane(c, (_, y) => 0.2 * y), c, 0.1)
    expect(north.slopeDeg).toBeCloseTo((Math.atan(0.2) * 180) / Math.PI, 3)
    expect(north.aspectDeg).toBeCloseTo(180, 3) // rises to the north, so it faces south
  })

  it('samples a disc with the right count, area and gradient', () => {
    const g = sampleDisc(plane(c, (x) => 0.1 * x), c, 10, 0.25)
    expect(g.n * g.cellAreaKm2).toBeGreaterThan(Math.PI * 100 * 0.98)
    expect(g.n * g.cellAreaKm2).toBeLessThan(Math.PI * 100 * 1.02)
    for (let k = 0; k < g.n; k += 97) {
      expect(g.slopeDeg[k]).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 3)
      expect(g.elevM[k]).toBeCloseTo(100 * g.xKm[k], 1)
    }
  })

  it('refuses a grid larger than the limit instead of silently coarsening it', () => {
    expect(() => sampleDisc({ heightAtLatLon: () => 0 }, c, 500, 0.5)).toThrow(/too large/i)
  })
})

describe('statistics', () => {
  it('drops non-finite values and never treats them as zero', () => {
    const s = summarize([1, 2, 3, NaN, Infinity])!
    expect(s.n).toBe(3)
    expect(s.mean).toBe(2)
    expect(s.min).toBe(1)
    expect(summarize([NaN])).toBeNull()
    expect(summarize([])).toBeNull()
  })

  it('computes quantiles and spread', () => {
    const s = summarize(Array.from({ length: 101 }, (_, i) => i))!
    expect(s.median).toBe(50)
    expect(s.p5).toBeCloseTo(5, 9)
    expect(s.p95).toBeCloseTo(95, 9)
    expect(s.std).toBeCloseTo(Math.sqrt((101 * 101 - 1) / 12), 6)
  })

  it('builds histograms whose counts add up, including the top edge', () => {
    const h = histogram([0, 1, 2, 3, 4, 10, NaN], 5)
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(6)
    expect(h.counts.at(-1)).toBe(1)
    expect(h.edges).toHaveLength(6)
    expect(histogram([1, 2, 99], 2, [0, 10]).n).toBe(2)
    expect(histogram([], 4).counts).toEqual([])
  })
})

describe('crater geometry', () => {
  const center = { lat: -85, lon: 30 }
  const input = { ...center, diameterKm: 20 }
  const truth = { depthM: 1800, rimM: 300 }
  const dem = bowl(center, 10, 1.5, 0.3)

  it('classifies zones by fraction of the crater radius', () => {
    expect(zoneOf(0, 10)).toBe('floor')
    expect(zoneOf(10 * ZONE_LIMITS.floor, 10)).toBe('floor')
    expect(zoneOf(5, 10)).toBe('wall')
    expect(zoneOf(10, 10)).toBe('rim')
    expect(zoneOf(12, 10)).toBe('outside')
    expect(zoneOf(14, 10)).toBeNull()
  })

  it('measures rim, floor, depth and depth/diameter of a synthetic bowl', () => {
    const g = analyzeCrater(dem, input, { cellKm: 0.18 })
    if (g.status !== 'ok') throw new Error(g.reason)
    expect(Math.abs(g.rimElevM - truth.rimM)).toBeLessThan(40)
    // the floor is the median of the inner core, so a bowl reads slightly shallow (analytic: ~1719 m)
    expect(g.depthM).toBeGreaterThan(truth.depthM * 0.92)
    expect(g.depthM).toBeLessThan(truth.depthM)
    expect(g.depthToDiameter).toBeCloseTo(g.depthM / 1000 / 20, 9)
    expect(g.rimSectorsFound).toBe(36)
    expect(g.rimSpreadM).toBeLessThan(30)
  })

  it('reports zone areas that match the geometry', () => {
    const g = analyzeCrater(dem, input, { cellKm: 0.18 })
    if (g.status !== 'ok') throw new Error(g.reason)
    const floor = g.zones.find((z) => z.zone === 'floor')!
    expect(floor.areaKm2).toBeGreaterThan(Math.PI * 4 ** 2 * 0.97)
    expect(floor.areaKm2).toBeLessThan(Math.PI * 4 ** 2 * 1.03)
    const wall = g.zones.find((z) => z.zone === 'wall')!
    expect(wall.slopeDeg!.mean).toBeGreaterThan(floor.slopeDeg!.mean)
  })

  it('is stable when the analysis resolution is coarsened (resolution sensitivity)', () => {
    const depths = [0.18, 0.36, 0.72].map((cellKm) => {
      const g = analyzeCrater(dem, input, { cellKm })
      if (g.status !== 'ok') throw new Error(g.reason)
      return g.depthM
    })
    for (const d of depths) expect(Math.abs(d - depths[0]) / depths[0]).toBeLessThan(0.05)
  })

  it('says unavailable instead of inventing a depth', () => {
    const flat = analyzeCrater({ heightAtLatLon: () => 0 }, input, { cellKm: 0.18 })
    expect(flat.status).toBe('unavailable')
    const coarse = analyzeCrater(dem, input, { cellKm: 8 })
    expect(coarse.status).toBe('unavailable')
    if (coarse.status === 'unavailable') expect(coarse.reason).toMatch(/resolution|sectors/i)
  })
})
