import { polarXY } from './hazard'

/**
 * Crater context from the Robbins (2019) Lunar Crater Database (USGS Astrogeology release of 2018-08-15,
 * JGR Planets 124, 871–892), craters poleward of 80°S. The catalogue is approximately complete for craters larger than
 * about 1–2 km, so it describes large-crater density. It says nothing about the small craters and rocks that
 * threaten a landing. Checked against the IAU-named polar craters: 36 of 36 matched, median diameter ratio 0.99.
 */
export interface CraterData {
  source: string
  columns: string[]
  /** [longitude °E, latitude °, diameter km], largest first */
  craters: [number, number, number][]
}
export interface CraterContext {
  radiusKm: number
  count1: number
  count2: number
  /** craters ≥ 1 km per 1000 km² inside the radius */
  density1: number
  density2: number
  /** the same density averaged over 80–90°S, for scale */
  capDensity1: number
  /** crater ≥ 1 km whose centre is nearest, km, and its diameter */
  nearestKm: number
  nearestDiamKm: number
  /** the largest crater whose circle contains the site, if any (the site is on that crater's floor, wall or rim zone) */
  insideDiamKm: number | null
}

export async function loadCraters(base = '/landing'): Promise<CraterData | null> {
  try {
    const r = await fetch(`${base}/craters.json`)
    return r.ok ? ((await r.json()) as CraterData) : null
  } catch {
    return null
  }
}

const CAP_AREA_KM2 = Math.PI * 303.5 ** 2 // 80–90°S, polar-stereographic plane

export function craterContext(d: CraterData, lat: number, lon: number, radiusKm = 10): CraterContext | null {
  if (lat > -80.5) return null
  const s = polarXY(lat, lon)
  let c1 = 0, c2 = 0, nearest = Infinity, nearestD = 0, inside: number | null = null
  for (const c of d.craters) {
    const p = polarXY(c[1], c[0])
    const dist = Math.hypot(p.x - s.x, p.y - s.y) / 1000
    if (dist <= radiusKm) {
      c1++
      if (c[2] >= 2) c2++
    }
    if (dist < nearest) { nearest = dist; nearestD = c[2] }
    if (dist <= c[2] / 2 && inside === null) inside = c[2] // list is largest first
  }
  const area = Math.PI * radiusKm * radiusKm
  return {
    radiusKm, count1: c1, count2: c2, density1: (1000 * c1) / area, density2: (1000 * c2) / area,
    capDensity1: (1000 * d.craters.length) / CAP_AREA_KM2, nearestKm: nearest, nearestDiamKm: nearestD, insideDiamKm: inside,
  }
}
