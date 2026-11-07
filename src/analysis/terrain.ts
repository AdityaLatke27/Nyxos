import { greatCircleKm, interpolateGreatCircle, dirFromLatLon, latLonFromDir, offsetLatLon, toDeg, type LatLon } from './geo'

/**
 * Terrain-analysis primitives that work on any height source. The viewer's CpuTerrain
 * implements HeightSampler, so every number computed here comes from the same DEM
 * pyramid, in the same coordinate frame, as the terrain drawn on screen.
 */

export interface HeightSampler {
  /** Height in km above the 1737.4 km reference sphere. */
  heightAtLatLon(latDeg: number, lonDeg: number): number
  /** Cell size (km) of the finest DEM level that fully covers the point. Optional. */
  resolutionKmAt?(latDeg: number, lonDeg: number): number
}

export interface SlopeAspect {
  /** degrees from horizontal */
  slopeDeg: number
  /** azimuth the surface faces (downslope direction), degrees clockwise from north */
  aspectDeg: number
}

/** Slope and aspect from a central difference with the given step (use >= the DEM cell size). */
export function slopeAspectAt(h: HeightSampler, p: LatLon, stepKm: number): SlopeAspect {
  const e = offsetLatLon(p, stepKm, 0)
  const w = offsetLatLon(p, -stepKm, 0)
  const n = offsetLatLon(p, 0, stepKm)
  const s = offsetLatLon(p, 0, -stepKm)
  const dzdx = (h.heightAtLatLon(e.lat, e.lon) - h.heightAtLatLon(w.lat, w.lon)) / (2 * stepKm)
  const dzdy = (h.heightAtLatLon(n.lat, n.lon) - h.heightAtLatLon(s.lat, s.lon)) / (2 * stepKm)
  return {
    slopeDeg: toDeg(Math.atan(Math.hypot(dzdx, dzdy))),
    aspectDeg: (toDeg(Math.atan2(-dzdx, -dzdy)) + 360) % 360,
  }
}

export interface Transect {
  lengthKm: number
  /** distance from the start point, km */
  distKm: number[]
  lat: number[]
  lon: number[]
  /** elevation above the reference sphere, metres */
  elevM: number[]
  /** along-track slope, degrees (positive = climbing toward the end point) */
  slopeDeg: number[]
  stepKm: number
}

export const MAX_TRANSECT_SAMPLES = 4000

/** Elevation profile along the great circle between two points. */
export function sampleTransect(h: HeightSampler, a: LatLon, b: LatLon, stepKm: number): Transect {
  const lengthKm = greatCircleKm(a, b)
  const intervals = Math.max(1, Math.min(MAX_TRANSECT_SAMPLES - 1, Math.ceil(lengthKm / stepKm)))
  const da = dirFromLatLon(a.lat, a.lon)
  const db = dirFromLatLon(b.lat, b.lon)
  const distKm: number[] = []
  const lat: number[] = []
  const lon: number[] = []
  const elevM: number[] = []
  for (let i = 0; i <= intervals; i++) {
    const t = i / intervals
    const [la, lo] = latLonFromDir(interpolateGreatCircle(da, db, t))
    distKm.push(t * lengthKm)
    lat.push(la)
    lon.push(lo)
    elevM.push(h.heightAtLatLon(la, lo) * 1000)
  }
  const slopeDeg = elevM.map((_, i) => {
    const i0 = Math.max(0, i - 1)
    const i1 = Math.min(elevM.length - 1, i + 1)
    const run = (distKm[i1] - distKm[i0]) * 1000
    return run > 0 ? toDeg(Math.atan((elevM[i1] - elevM[i0]) / run)) : 0
  })
  return { lengthKm, distKm, lat, lon, elevM, slopeDeg, stepKm: lengthKm / intervals }
}

/** Regular grid of terrain samples inside a disc around a centre point. */
export interface DiscGrid {
  center: LatLon
  radiusKm: number
  cellKm: number
  /** number of samples inside the disc */
  n: number
  /** tangent-plane position relative to the centre, km (x east, y north) */
  xKm: Float32Array
  yKm: Float32Array
  rKm: Float32Array
  /** bearing from the centre, degrees clockwise from north */
  azDeg: Float32Array
  lat: Float32Array
  lon: Float32Array
  elevM: Float32Array
  slopeDeg: Float32Array
  aspectDeg: Float32Array
  /** area represented by one sample, km² (tangent-plane approximation) */
  cellAreaKm2: number
  /** coarsest finest-level DEM cell size found at the centre and four edge points, km; null if unknown */
  demResolutionKm: number | null
}

export const MAX_DISC_CELLS_PER_SIDE = 400

/**
 * Samples elevation, slope and aspect on a square grid clipped to a disc. Slope uses the
 * neighbouring grid samples (central differences), so cellKm should be >= the DEM cell size.
 */
export function sampleDisc(h: HeightSampler, center: LatLon, radiusKm: number, cellKm: number): DiscGrid {
  const m = Math.ceil(radiusKm / cellKm)
  if (2 * m + 3 > MAX_DISC_CELLS_PER_SIDE) {
    throw new Error(`Grid too large: ${2 * m + 3} cells per side (limit ${MAX_DISC_CELLS_PER_SIDE}); use a larger cell size`)
  }
  const side = 2 * m + 3 // one-cell margin for the neighbour differences
  const hKm = new Float32Array(side * side)
  const pos = new Array<LatLon>(side * side)
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const p = offsetLatLon(center, (i - m - 1) * cellKm, (j - m - 1) * cellKm)
      pos[j * side + i] = p
      hKm[j * side + i] = h.heightAtLatLon(p.lat, p.lon)
    }
  }
  const xs: number[] = []
  const ys: number[] = []
  const rs: number[] = []
  const azs: number[] = []
  const lats: number[] = []
  const lons: number[] = []
  const el: number[] = []
  const sl: number[] = []
  const asp: number[] = []
  for (let j = 1; j < side - 1; j++) {
    for (let i = 1; i < side - 1; i++) {
      const x = (i - m - 1) * cellKm
      const y = (j - m - 1) * cellKm
      const r = Math.hypot(x, y)
      if (r > radiusKm) continue
      const dzdx = (hKm[j * side + i + 1] - hKm[j * side + i - 1]) / (2 * cellKm)
      const dzdy = (hKm[(j + 1) * side + i] - hKm[(j - 1) * side + i]) / (2 * cellKm)
      xs.push(x)
      ys.push(y)
      rs.push(r)
      azs.push((toDeg(Math.atan2(x, y)) + 360) % 360)
      lats.push(pos[j * side + i].lat)
      lons.push(pos[j * side + i].lon)
      el.push(hKm[j * side + i] * 1000)
      sl.push(toDeg(Math.atan(Math.hypot(dzdx, dzdy))))
      asp.push((toDeg(Math.atan2(-dzdx, -dzdy)) + 360) % 360)
    }
  }

  let demResolutionKm: number | null = null
  if (h.resolutionKmAt) {
    const probes = [center, ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => offsetLatLon(center, dx * radiusKm, dy * radiusKm))]
    demResolutionKm = Math.max(...probes.map((p) => h.resolutionKmAt!(p.lat, p.lon)))
  }

  return {
    center,
    radiusKm,
    cellKm,
    n: xs.length,
    xKm: Float32Array.from(xs),
    yKm: Float32Array.from(ys),
    rKm: Float32Array.from(rs),
    azDeg: Float32Array.from(azs),
    lat: Float32Array.from(lats),
    lon: Float32Array.from(lons),
    elevM: Float32Array.from(el),
    slopeDeg: Float32Array.from(sl),
    aspectDeg: Float32Array.from(asp),
    cellAreaKm2: cellKm * cellKm,
    demResolutionKm,
  }
}
