import { moonState } from '../astro/ephemeris'
import { horizonAt, siteFrame } from '../sim/terrain/cpuTerrain'
import { discAbove, SUN_RADIUS_DEG } from '../sim/analysis/siteAnalysis'

/**
 * Direct-sunlight analysis from terrain horizon profiles.
 *
 * Method: for a surface point the terrain horizon elevation is found for every azimuth by
 * marching rays across the DEM (CpuTerrain.horizonProfile, including lunar curvature). At each
 * time the Sun's centre direction (NYXOS ephemeris, body-fixed scene frame) is converted to
 * the point's local elevation / azimuth. The fraction of the Sun's disc (radius 0.2666°) above
 * the horizon is the direct-sunlight fraction. A point counts as "illuminated" when at least
 * half the disc is visible.
 *
 * Direct sunlight only. Earthshine, scattered light and thermal effects are not modelled, and
 * the Sun is treated as a uniform disc (no limb darkening).
 */

export { SUN_RADIUS_DEG }
export const LIT_THRESHOLD = 0.5
const DEG = Math.PI / 180

export interface SunTrack {
  startMs: number
  stepMs: number
  n: number
  /** unit Sun direction in the body-fixed scene frame, 3 numbers per step */
  dir: Float64Array
}

export function sunTrack(startMs: number, stepMs: number, n: number): SunTrack {
  const dir = new Float64Array(n * 3)
  for (let i = 0; i < n; i++) {
    const d = moonState(new Date(startMs + i * stepMs)).sunDir
    dir[3 * i] = d[0]
    dir[3 * i + 1] = d[1]
    dir[3 * i + 2] = d[2]
  }
  return { startMs, stepMs, n, dir }
}

export interface PointSeries {
  /** fraction of the Sun's disc visible above the terrain horizon (0..1) */
  frac: Float32Array
  /** Sun elevation / azimuth at the point, degrees (azimuth clockwise from north) */
  sunElev: Float32Array
  sunAz: Float32Array
}

/** Direct-sunlight fraction through time at one point, given its horizon profile. */
export function pointSeries(profile: Float32Array, lat: number, lon: number, track: SunTrack): PointSeries {
  const f = siteFrame(lat, lon)
  const frac = new Float32Array(track.n)
  const sunElev = new Float32Array(track.n)
  const sunAz = new Float32Array(track.n)
  for (let i = 0; i < track.n; i++) {
    const sx = track.dir[3 * i]
    const sy = track.dir[3 * i + 1]
    const sz = track.dir[3 * i + 2]
    const up = sx * f.up[0] + sy * f.up[1] + sz * f.up[2]
    const east = sx * f.east[0] + sy * f.east[1] + sz * f.east[2]
    const north = sx * f.north[0] + sy * f.north[1] + sz * f.north[2]
    const elev = Math.asin(Math.max(-1, Math.min(1, up))) / DEG
    const az = (Math.atan2(east, north) / DEG + 360) % 360
    sunElev[i] = elev
    sunAz[i] = az
    frac[i] = discAbove(elev, horizonAt(profile, az), SUN_RADIUS_DEG)
  }
  return { frac, sunElev, sunAz }
}

/** Percentage of cells illuminated at every step (cells weigh equally: they share one grid). */
export function litPercent(cellFrac: Float32Array[], n: number): Float32Array {
  const out = new Float32Array(n)
  if (!cellFrac.length) return out
  for (let i = 0; i < n; i++) {
    let c = 0
    for (const f of cellFrac) if (f[i] >= LIT_THRESHOLD) c++
    out[i] = (100 * c) / cellFrac.length
  }
  return out
}

export interface Interval {
  startMs: number
  endMs: number
  /** the interval touches the start or end of the analysed window, so its true length is longer */
  clipped: boolean
}

export interface Events {
  sunrises: number[]
  sunsets: number[]
  /** fraction of the window with direct sunlight, 0..1 */
  litFraction: number
  longestDark: Interval | null
  longestLight: Interval | null
  dark: Interval[]
  light: Interval[]
}

/** Sunrise / sunset times and lit / dark intervals from a 0..1 fraction series (crossing 0.5). */
export function findEvents(frac: ArrayLike<number>, track: SunTrack): Events {
  const n = track.n
  const t = (i: number) => track.startMs + i * track.stepMs
  const lit = (i: number) => frac[i] >= LIT_THRESHOLD
  const sunrises: number[] = []
  const sunsets: number[] = []
  const dark: Interval[] = []
  const light: Interval[] = []
  let litCount = lit(0) ? 1 : 0
  // the current run began at runStartMs; it is clipped while that is the window start
  let runStartMs = t(0)
  let clipped = true
  for (let i = 1; i < n; i++) {
    if (lit(i)) litCount++
    if (lit(i) === lit(i - 1)) continue
    const x = t(i - 1) + ((LIT_THRESHOLD - frac[i - 1]) / (frac[i] - frac[i - 1])) * track.stepMs
    ;(lit(i) ? sunrises : sunsets).push(x)
    ;(lit(i - 1) ? light : dark).push({ startMs: runStartMs, endMs: x, clipped })
    runStartMs = x
    clipped = false
  }
  ;(lit(n - 1) ? light : dark).push({ startMs: runStartMs, endMs: t(n - 1), clipped: true })
  const longest = (list: Interval[]) =>
    list.reduce<Interval | null>((b, x) => (!b || x.endMs - x.startMs > b.endMs - b.startMs ? x : b), null)
  return { sunrises, sunsets, litFraction: litCount / n, longestDark: longest(dark), longestLight: longest(light), dark, light }
}
