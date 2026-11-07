import { moonState } from '../../astro/ephemeris'
import { horizonAt, R_KM, siteFrame, type V3 } from '../terrain/cpuTerrain'

export const SUN_RADIUS_DEG = 0.2666
export const EARTH_RADIUS_KM = 6371

const DEG = Math.PI / 180
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export interface SkyState {
  sunElev: number
  sunAz: number
  earthElev: number
  earthAz: number
  earthLit: number
  earthRadiusDeg: number
}

/** Topocentric Sun and Earth positions (degrees; azimuth clockwise from north) at a site. */
export function skyAt(latDeg: number, lonDeg: number, heightKm: number, timeMs: number): SkyState {
  const s = moonState(new Date(timeMs))
  const f = siteFrame(latDeg, lonDeg)
  const r = R_KM + heightKm
  const sun = s.sunDir
  const e: V3 = [
    s.earthDir[0] * s.earthDistKm - f.up[0] * r,
    s.earthDir[1] * s.earthDistKm - f.up[1] * r,
    s.earthDir[2] * s.earthDistKm - f.up[2] * r,
  ]
  const eLen = Math.hypot(e[0], e[1], e[2])
  const en: V3 = [e[0] / eLen, e[1] / eLen, e[2] / eLen]
  const elevAz = (d: V3) => [
    Math.asin(Math.max(-1, Math.min(1, dot(d, f.up)))) / DEG,
    ((Math.atan2(dot(d, f.east), dot(d, f.north)) / DEG) + 360) % 360,
  ]
  const [sunElev, sunAz] = elevAz(sun)
  const [earthElev, earthAz] = elevAz(en)
  return {
    sunElev,
    sunAz,
    earthElev,
    earthAz,
    earthLit: s.earthIlluminated,
    earthRadiusDeg: Math.asin(EARTH_RADIUS_KM / eLen) / DEG,
  }
}

/** Fraction of a disc above the terrain horizon (linear in elevation across the disc). */
export function discAbove(elev: number, horizon: number, radiusDeg: number) {
  return Math.min(1, Math.max(0, (elev - horizon + radiusDeg) / (2 * radiusDeg)))
}

export interface SiteNow {
  sky: SkyState
  sunVisible: number
  earthVisible: number
  sunHorizon: number
  earthHorizon: number
  linkOpen: boolean
  powerPct: number
}

export function siteNow(profile: Float32Array, lat: number, lon: number, hKm: number, timeMs: number): SiteNow {
  const sky = skyAt(lat, lon, hKm, timeMs)
  const sunHorizon = horizonAt(profile, sky.sunAz)
  const earthHorizon = horizonAt(profile, sky.earthAz)
  const sunVisible = discAbove(sky.sunElev, sunHorizon, SUN_RADIUS_DEG)
  const earthVisible = discAbove(sky.earthElev, earthHorizon, sky.earthRadiusDeg)
  return {
    sky,
    sunVisible,
    earthVisible,
    sunHorizon,
    earthHorizon,
    linkOpen: earthVisible >= 0.5,
    // vertical, sun-tracking array: output ~ visible fraction of the solar disc
    powerPct: Math.round(sunVisible * 100),
  }
}

export interface Series {
  startMs: number
  stepMs: number
  sun: Float32Array
  earth: Float32Array
  sunElev: Float32Array
  earthElev: Float32Array
  sunlightPct: number
  earthPct: number
  linkPct: number
  bothPct: number
}

/** Sun / Earth visibility every `stepMin` minutes across the 30-day window. */
export function series30(profile: Float32Array, lat: number, lon: number, hKm: number, startMs: number, stepMin = 20): Series {
  const stepMs = stepMin * 60000
  const n = Math.round((30 * 86400000) / stepMs) + 1
  const sun = new Float32Array(n)
  const earth = new Float32Array(n)
  const sunElev = new Float32Array(n)
  const earthElev = new Float32Array(n)
  let s = 0
  let e = 0
  let both = 0
  let link = 0
  for (let i = 0; i < n; i++) {
    const t = startMs + i * stepMs
    const now = siteNow(profile, lat, lon, hKm, t)
    sun[i] = now.sunVisible
    earth[i] = now.earthVisible
    sunElev[i] = now.sky.sunElev
    earthElev[i] = now.sky.earthElev
    if (now.sunVisible >= 0.5) s++
    if (now.earthVisible >= 0.5) e++
    if (now.linkOpen) link++
    if (now.linkOpen && now.sunVisible > 0.5) both++
  }
  return {
    startMs,
    stepMs,
    sun,
    earth,
    sunElev,
    earthElev,
    sunlightPct: (100 * s) / n,
    earthPct: (100 * e) / n,
    linkPct: (100 * link) / n,
    bothPct: (100 * both) / n,
  }
}

/** Hours from `nowMs` until the series crosses `threshold` in the given direction, if within the window. */
export function nextCrossing(series: Series, arr: Float32Array, nowMs: number, rising: boolean, threshold = 0.5) {
  const i0 = Math.max(0, Math.floor((nowMs - series.startMs) / series.stepMs))
  for (let i = i0; i < arr.length - 1; i++) {
    const a = arr[i]
    const b = arr[i + 1]
    if (rising ? a < threshold && b >= threshold : a >= threshold && b < threshold) {
      const f = (threshold - a) / (b - a || 1)
      const t = series.startMs + (i + f) * series.stepMs
      if (t >= nowMs) return (t - nowMs) / 3.6e6
    }
  }
  return Infinity
}
