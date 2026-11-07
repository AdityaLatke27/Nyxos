import { dirFromLatLon, latLonFromDir, R_KM, siteFrame, type V3 } from '../sim/terrain/cpuTerrain'

/**
 * Lunar geodesy helpers for the analysis engine.
 *
 * Conventions (same as the 3D scene and the data build scripts, see astro/ephemeris.ts):
 *  - Mean-Earth / polar-axis body frame, planetocentric latitude (north positive),
 *    east-positive longitude, reference sphere R = 1737.4 km.
 *  - Scene frame: +Y = north pole, +Z = 0°N 0°E, +X = 0°N 90°E.
 *  - Elevations are km above the 1737.4 km reference sphere (LOLA convention).
 *  - Distances along the surface are measured on the reference sphere.
 */

export { R_KM, dirFromLatLon, latLonFromDir }
export type { V3 }

const DEG = Math.PI / 180

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2])
  return [a[0] / l, a[1] / l, a[2] / l]
}

export interface LatLon {
  lat: number
  lon: number
}

/** Wrap a longitude to (-180, 180]. */
export function wrapLon(lonDeg: number) {
  const w = ((((lonDeg + 180) % 360) + 360) % 360) - 180
  return w === -180 ? 180 : w
}

/** Central angle between two unit vectors, radians (robust for tiny angles). */
export function angularDistance(a: V3, b: V3) {
  const cx = a[1] * b[2] - a[2] * b[1]
  const cy = a[2] * b[0] - a[0] * b[2]
  const cz = a[0] * b[1] - a[1] * b[0]
  return Math.atan2(Math.hypot(cx, cy, cz), dot(a, b))
}

export function greatCircleKm(a: LatLon, b: LatLon) {
  return R_KM * angularDistance(dirFromLatLon(a.lat, a.lon), dirFromLatLon(b.lat, b.lon))
}

/** Point a fraction t (0..1) of the way along the great circle from a to b. */
export function interpolateGreatCircle(a: V3, b: V3, t: number): V3 {
  const d = angularDistance(a, b)
  if (d < 1e-12) return a
  const s = Math.sin(d)
  const wa = Math.sin((1 - t) * d) / s
  const wb = Math.sin(t * d) / s
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb]
}

/**
 * Point offset from a centre by (east, north) km on the local tangent plane, projected
 * radially back onto the sphere: P = normalize(up + x/R * east + y/R * north).
 * This is the projection used by the site patches (scripts/build_sim_data.py).
 */
export function offsetLatLon(center: LatLon, eastKm: number, northKm: number): LatLon {
  const f = siteFrame(center.lat, center.lon)
  const p = norm([
    f.up[0] + (eastKm / R_KM) * f.east[0] + (northKm / R_KM) * f.north[0],
    f.up[1] + (eastKm / R_KM) * f.east[1] + (northKm / R_KM) * f.north[1],
    f.up[2] + (eastKm / R_KM) * f.east[2] + (northKm / R_KM) * f.north[2],
  ])
  const [lat, lon] = latLonFromDir(p)
  return { lat, lon }
}

/** Inverse of offsetLatLon: tangent-plane (east, north) km of a point relative to a centre. */
export function tangentOffset(center: LatLon, p: LatLon): { x: number; y: number } {
  const f = siteFrame(center.lat, center.lon)
  const d = dirFromLatLon(p.lat, p.lon)
  const cu = dot(d, f.up)
  return { x: (R_KM * dot(d, f.east)) / cu, y: (R_KM * dot(d, f.north)) / cu }
}

/** Degrees, rounded for display. */
export const toDeg = (rad: number) => rad / DEG
