// @ts-nocheck -- reads fixtures with node:fs; vitest runs under Node
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { ephemerisSource, installEphemerisTable, moonState, moonStateAnalytic } from './ephemeris'

const DEG = Math.PI / 180
function azEl(sun: [number, number, number], lat: number, lon: number) {
  // scene frame: x = 90E, y = north, z = 0E
  const la = lat * DEG, lo = lon * DEG
  const up = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)]
  const east = [Math.cos(lo), 0, -Math.sin(lo)]
  const north = [-Math.sin(la) * Math.sin(lo), Math.cos(la), -Math.sin(la) * Math.cos(lo)]
  const d = (a: number[]) => a[0] * sun[0] + a[1] * sun[1] + a[2] * sun[2]
  return { el: Math.asin(d(up)) / DEG, az: ((Math.atan2(d(east), d(north)) / DEG) + 360) % 360 }
}

const rows = readFileSync('tools/horizons_ref.csv', 'utf8').trim().split('\n').slice(1).map((l) => {
  const [site, lon, lat, t, az, el] = l.split(',')
  const m = /(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/.exec(t.trim())!
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m[2])
  return { site, lon: +lon, lat: +lat, ms: Date.UTC(+m[1], mon, +m[3], +m[4], +m[5]), az: +az, el: +el }
})

function worst(fn: (d: Date) => ReturnType<typeof moonState>) {
  let e = 0, a = 0
  for (const r of rows) {
    const p = azEl(fn(new Date(r.ms)).sunDir, r.lat, r.lon)
    e = Math.max(e, Math.abs(p.el - r.el))
    if (Math.abs(r.lat) < 89.5) a = Math.max(a, Math.abs(((p.az - r.az + 540) % 360) - 180))
  }
  return { e, a }
}

describe('Sun position vs JPL Horizons (847 samples, 7 sites)', () => {
  beforeAll(() => {
    const meta = JSON.parse(readFileSync('public/landing/eph.json', 'utf8'))
    const b = readFileSync('public/landing/eph.f32')
    installEphemerisTable({ startMs: Date.parse(meta.epochUtc), stepMs: meta.stepSeconds * 1000, count: meta.count, data: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4) })
  })
  it('uses the DE440 table inside its span', () => expect(ephemerisSource(new Date('2026-11-12T00:00:00Z'))).toBe('JPL DE440'))
  it('table agrees with Horizons to 0.002 deg', () => {
    const w = worst(moonState)
    console.log('table worst error deg', w)
    expect(w.e).toBeLessThan(0.002)
    expect(w.a).toBeLessThan(0.002)
  })
  it('analytic fallback is within 0.1 deg', () => {
    const w = worst(moonStateAnalytic)
    console.log('analytic worst error deg', w)
    expect(w.e).toBeLessThan(0.1)
  })
})
