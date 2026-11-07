import type { Feature } from '../sim/data/types'
import { greatCircleKm } from './geo'

/** Smallest catalogued crater the overview will analyse. Smaller ones are below useful DEM resolution. */
export const MIN_CRATER_KM = 2

const KM_PER_DEG = 30.3234

const isCrater = (f: Feature) => f[4] === 'crater' && f[3] >= MIN_CRATER_KM

/** The smallest catalogued crater whose circle (centre and IAU diameter) contains the point. */
export function craterAt(features: Feature[], lat: number, lon: number): Feature | null {
  let best: Feature | null = null
  for (const f of features) {
    if (!isCrater(f) || (best && f[3] >= best[3])) continue
    if (Math.abs(f[1] - lat) > f[3] / 2 / KM_PER_DEG + 0.01) continue // cheap latitude reject
    if (greatCircleKm({ lat, lon }, { lat: f[1], lon: f[2] }) <= f[3] / 2) best = f
  }
  return best
}

/** Craters whose name matches the query: names that start with it first, then larger craters first. */
export function searchCraters(features: Feature[], query: string, limit = 8): Feature[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const hits = features.filter((f) => isCrater(f) && f[0].toLowerCase().includes(q))
  hits.sort((a, b) => {
    const sa = a[0].toLowerCase().startsWith(q) ? 0 : 1
    const sb = b[0].toLowerCase().startsWith(q) ? 0 : 1
    return sa - sb || b[3] - a[3]
  })
  return hits.slice(0, limit)
}
