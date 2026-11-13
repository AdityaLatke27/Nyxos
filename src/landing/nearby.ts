import type { Feature, SiteInfo } from '../sim/data/types'
import { craterAt } from '../analysis/craterLookup'
import { greatCircleKm, offsetLatLon } from '../analysis/geo'
import { moonState } from '../astro/ephemeris'
import { siteFrame } from '../sim/terrain/cpuTerrain'
import { SUN_RADIUS_DEG, discAbove } from '../sim/analysis/siteAnalysis'
import type { TerrainLike } from './engine'

export interface NearFeature {
  name: string
  kind: string
  diameterKm: number
  distKm: number
  bearingDeg: number
}

export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180
  const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r)
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export function nearbyFeatures(features: Feature[], lat: number, lon: number, radiusKm = 40, limit = 10): NearFeature[] {
  const p = { lat, lon }
  return features
    .filter((f) => f[4] === 'crater' && f[3] >= 2)
    .map((f) => ({ name: f[0], kind: f[4], diameterKm: f[3], distKm: greatCircleKm(p, { lat: f[1], lon: f[2] }), bearingDeg: bearing(p, { lat: f[1], lon: f[2] }) }))
    .filter((f) => f.distKm - f.diameterKm / 2 <= radiusKm)
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, limit)
}

export function nearbyMissions(sites: SiteInfo[], lat: number, lon: number, radiusKm = 250) {
  return sites
    .filter((s) => s.group === 'Apollo' || s.group === 'CLPS')
    .map((s) => ({ name: s.name, group: s.group, distKm: greatCircleKm({ lat, lon }, { lat: s.lat, lon: s.lon }) }))
    .filter((s) => s.distKm <= radiusKm)
    .sort((a, b) => a.distKm - b.distKm)
}

export { craterAt }

export interface ShadowCell {
  dxKm: number
  dyKm: number
  /** share of the 1-year model samples with any direct sunlight */
  litPct: number
  persistent: boolean
}
export interface ShadowScan {
  radiusKm: number
  cells: ShadowCell[]
  persistentPct: number
  nearestPersistentKm: number | null
  samples: number
  demM: number
}

/** Sun directions every 6 h over one year (shared by all scanned points). */
export function yearSunDirs(startMs: number) {
  const n = 365 * 4
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const s = moonState(new Date(startMs + i * 6 * 3600000)).sunDir
    out.set(s, i * 3)
  }
  return out
}

/**
 * Persistent-shadow candidates around the site: points that receive no direct sunlight in any
 * 6-hourly sample of a model year. This is a model result at the local DEM resolution, a
 * cold-trap *candidate* only: shadow is not proof of ice and temperature is not modelled.
 */
/** Gives the browser a turn between chunks of work. A message-channel hop avoids the 4 ms floor of nested timeouts. */
export function yieldToBrowser(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0))
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => { ch.port1.close(); resolve() }
    ch.port2.postMessage(0)
  })
}

const cellHorizons = new Map<string, Float32Array>()
function cellHorizon(terrain: TerrainLike, lat: number, lon: number): Float32Array {
  const tk = terrain.cacheKey?.()
  const key = tk === undefined ? null : `${tk}|${lat}|${lon}`
  const hit = key ? cellHorizons.get(key) : undefined
  if (hit) return hit
  const h = terrain.horizonProfile(lat, lon, 360, 0.002, 240)
  if (key) {
    cellHorizons.set(key, h)
    if (cellHorizons.size > 400) cellHorizons.delete(cellHorizons.keys().next().value as string)
  }
  return h
}

/**
 * `cancelled` is checked after every grid cell; a cancelled scan resolves to null and never reports a partial result.
 * Horizons per cell are reused, so changing only the start date re-tests the Sun without re-tracing the terrain.
 */
export async function shadowScan(
  terrain: TerrainLike,
  lat: number,
  lon: number,
  sunDirs: Float32Array,
  radiusKm = 4,
  grid = 9,
  yieldFn: () => Promise<void> = yieldToBrowser,
  cancelled: () => boolean = () => false,
): Promise<ShadowScan | null> {
  const cells: ShadowCell[] = []
  const nT = sunDirs.length / 3
  for (let gj = 0; gj < grid; gj++) {
    for (let gi = 0; gi < grid; gi++) {
      const dx = ((gi / (grid - 1)) * 2 - 1) * radiusKm
      const dy = ((gj / (grid - 1)) * 2 - 1) * radiusKm
      if (Math.hypot(dx, dy) > radiusKm) continue
      const p = offsetLatLon({ lat, lon }, dx, dy)
      const h = cellHorizon(terrain, p.lat, p.lon)
      const f = siteFrame(p.lat, p.lon)
      let lit = 0
      for (let t = 0; t < nT; t++) {
        const sx = sunDirs[3 * t], sy = sunDirs[3 * t + 1], sz = sunDirs[3 * t + 2]
        const up = sx * f.up[0] + sy * f.up[1] + sz * f.up[2]
        const el = (Math.asin(Math.max(-1, Math.min(1, up))) * 180) / Math.PI
        if (el < -SUN_RADIUS_DEG - 3) continue
        const e = sx * f.east[0] + sy * f.east[1] + sz * f.east[2]
        const n = sx * f.north[0] + sy * f.north[1] + sz * f.north[2]
        const az = ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360
        const k = (az / 360) * h.length
        const i0 = Math.floor(k) % h.length
        const hz = h[i0] + (h[(i0 + 1) % h.length] - h[i0]) * (k - Math.floor(k))
        if (discAbove(el, hz, SUN_RADIUS_DEG) > 0) lit++
      }
      cells.push({ dxKm: dx, dyKm: dy, litPct: (100 * lit) / nT, persistent: lit === 0 })
      await yieldFn()
      if (cancelled()) return null
    }
  }
  const pers = cells.filter((c) => c.persistent)
  return {
    radiusKm,
    cells,
    persistentPct: (100 * pers.length) / cells.length,
    nearestPersistentKm: pers.length ? Math.min(...pers.map((c) => Math.hypot(c.dxKm, c.dyKm))) : null,
    samples: nT,
    demM: terrain.resolutionKmAt(lat, lon) * 1000,
  }
}

export const INSTRUMENTS = [
  { id: 'lend', name: 'LRO LEND neutron flux (finer than Lunar Prospector)', answers: 'Is hydrogen enhanced? (coarse, ~10 km footprint)' },
  { id: 'lamp', name: 'LRO LAMP far-UV albedo', answers: 'Is there frost-like surface reflectance in shadow?' },
  { id: 'minirf', name: 'LRO Mini-RF radar (CPR)', answers: 'Is there a radar signature consistent with ice or just rough rock?' },
  { id: 'lroc', name: 'LROC NAC imagery', answers: 'Boulders, small craters and surface texture at ~1 m' },
]
