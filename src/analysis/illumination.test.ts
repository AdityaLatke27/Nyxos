import { describe, expect, it } from 'vitest'
import { dirFromLatLon } from './geo'
import { findEvents, litPercent, LIT_THRESHOLD, pointSeries, sunTrack, type SunTrack } from './illumination'
import { moonState } from '../astro/ephemeris'

const HOUR = 3600e3
const flat = (deg = 0) => new Float32Array(180).fill(deg)

/** A hand-made track: the Sun circles the equator in the x-z plane once per `periodH` hours. */
function circling(periodH: number, hours: number, stepMin = 10): SunTrack {
  const stepMs = stepMin * 60e3
  const n = Math.round((hours * HOUR) / stepMs) + 1
  const dir = new Float64Array(n * 3)
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i * stepMs) / (periodH * HOUR)
    dir[3 * i] = Math.sin(a) // +X = 90°E
    dir[3 * i + 2] = Math.cos(a) // +Z = 0°E
  }
  return { startMs: 0, stepMs, n, dir }
}

describe('direct sunlight from horizon profiles', () => {
  it('lights an equatorial point on a flat horizon for half of each cycle', () => {
    const tr = circling(24, 72)
    const { frac } = pointSeries(flat(), 0, 0, tr)
    const ev = findEvents(frac, tr)
    expect(ev.litFraction).toBeGreaterThan(0.49)
    expect(ev.litFraction).toBeLessThan(0.51)
    expect(ev.sunrises.length).toBe(3)
    expect(ev.sunsets.length).toBe(3)
    // Sun overhead at t = 0 (it starts at 0°E, directly above the point)
    expect(frac[0]).toBe(1)
    // sunset when the Sun's centre is half a disc below the horizon, i.e. a quarter cycle + ~0.27°
    expect(ev.sunsets[0] / HOUR).toBeCloseTo(6 + (0.2666 / 360) * 24, 1)
  })

  it('a raised horizon shortens daylight and shifts sunrise later', () => {
    const tr = circling(24, 48)
    const low = findEvents(pointSeries(flat(0), 0, 0, tr).frac, tr)
    const high = findEvents(pointSeries(flat(15), 0, 0, tr).frac, tr)
    expect(high.litFraction).toBeLessThan(low.litFraction)
    expect(high.sunrises[0]).toBeGreaterThan(low.sunrises[0])
    expect(high.sunsets[0]).toBeLessThan(low.sunsets[0])
  })

  it('a Sun that stays below the horizon gives permanent darkness, reported as clipped', () => {
    const n = 100
    const dir = new Float64Array(n * 3)
    for (let i = 0; i < n; i++) dir[3 * i + 2] = -1 // directly below 0°N 0°E
    const tr: SunTrack = { startMs: 0, stepMs: HOUR, n, dir }
    const { frac } = pointSeries(flat(0), 0, 0, tr)
    expect(Math.max(...frac)).toBe(0)
    const ev = findEvents(frac, tr)
    expect(ev.sunrises).toHaveLength(0)
    expect(ev.litFraction).toBe(0)
    expect(ev.longestDark?.clipped).toBe(true) // we only know it is dark for the whole window
  })

  it('terrain blocking one side casts the point into shadow only at that azimuth', () => {
    const tr = circling(24, 24)
    const wall = new Float32Array(180).fill(-5)
    for (let i = 40; i < 50; i++) wall[i] = 30 // 80°..100° (east)
    const base = pointSeries(flat(-5), 0, 0, tr).frac
    const blocked = pointSeries(wall, 0, 0, tr).frac
    const i = Math.round((4.5 * HOUR) / tr.stepMs) // Sun 22.5° up in the east, below the 30° wall
    expect(base[i]).toBe(1)
    expect(blocked[i]).toBe(0)
    const j = Math.round((18 * HOUR) / tr.stepMs) // descending in the west: unaffected
    expect(blocked[j]).toBe(base[j])
  })
})

describe('events and statistics', () => {
  const track = (n: number): SunTrack => ({ startMs: 0, stepMs: HOUR, n, dir: new Float64Array(n * 3) })

  it('finds interpolated crossings and the longest dark / light intervals', () => {
    // dark 0-3 h, lit 4-8 h (ramp 3->4), dark 9-14, lit 15-19
    const f = [0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
    const ev = findEvents(f, track(f.length))
    expect(ev.sunrises).toEqual([3.5 * HOUR, 14.5 * HOUR])
    expect(ev.sunsets).toEqual([8.5 * HOUR])
    expect(ev.longestDark!.endMs - ev.longestDark!.startMs).toBe(6 * HOUR)
    expect(ev.longestDark!.clipped).toBe(false)
    expect(ev.longestLight!.endMs - ev.longestLight!.startMs).toBe(5 * HOUR)
    expect(ev.longestLight!.clipped).toBe(false)
    expect(ev.light.at(-1)!.clipped).toBe(true) // the last lit interval runs off the end of the window
    expect(ev.dark[0].clipped).toBe(true) // and the first dark one starts before it
    expect(ev.litFraction).toBe(10 / 20)
  })

  it('interpolates partially visible steps at the 50% threshold', () => {
    const f = [0.2, 0.8]
    const ev = findEvents(f, track(2))
    expect(ev.sunrises[0] / HOUR).toBeCloseTo((LIT_THRESHOLD - 0.2) / 0.6, 9)
  })

  it('computes the percentage of cells lit at each step', () => {
    const a = Float32Array.from([1, 1, 0, 0])
    const b = Float32Array.from([1, 0, 0, 0.4])
    const c = Float32Array.from([1, 0.6, 0, 0.9])
    expect(Array.from(litPercent([a, b, c], 4)).map((v) => +v.toFixed(2))).toEqual([100, 66.67, 0, 33.33])
    expect(Array.from(litPercent([], 3))).toEqual([0, 0, 0])
  })
})

describe('sun track', () => {
  it('returns unit vectors and agrees with moonState', () => {
    const t0 = Date.UTC(2026, 10, 7, 12)
    const tr = sunTrack(t0, 6 * HOUR, 5)
    const ref = moonState(new Date(t0 + 12 * HOUR)).sunDir
    for (let k = 0; k < 3; k++) expect(tr.dir[6 + k]).toBeCloseTo(ref[k], 12)
    for (let i = 0; i < 5; i++) expect(Math.hypot(tr.dir[3 * i], tr.dir[3 * i + 1], tr.dir[3 * i + 2])).toBeCloseTo(1, 9)
  })

  it('keeps the Sun within 1.6° of the lunar equator plane (Moon obliquity 1.54°)', () => {
    const tr = sunTrack(Date.UTC(2026, 0, 1), 12 * HOUR, 60)
    for (let i = 0; i < tr.n; i++) expect(Math.abs(Math.asin(tr.dir[3 * i + 1]) / (Math.PI / 180))).toBeLessThan(1.7)
  })

  it('is near the polar horizon for a pole point all month', () => {
    // south pole: the Sun's elevation stays within ±1.6° of the horizon
    const tr = sunTrack(Date.UTC(2026, 10, 7), 6 * HOUR, 120)
    const up = dirFromLatLon(-90, 0)
    for (let i = 0; i < tr.n; i++) {
      const e = Math.asin(tr.dir[3 * i] * up[0] + tr.dir[3 * i + 1] * up[1] + tr.dir[3 * i + 2] * up[2]) / (Math.PI / 180)
      expect(Math.abs(e)).toBeLessThan(1.7)
    }
  })
})
