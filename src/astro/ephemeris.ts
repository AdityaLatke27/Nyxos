/**
 * Low-precision lunar ephemeris for lighting the scene.
 *
 * - Sun: Meeus, Astronomical Algorithms ch. 25 (~0.01°)
 * - Moon: Meeus ch. 47, main periodic terms (~0.05°)
 * - Lunar orientation: IAU WGCCRE 2009 model (mean-Earth / polar axis frame,
 *   the same frame LOLA and SLDEM2015 maps use)
 *
 * Scene frame (three.js): +Y = lunar north pole, +Z = 0°N 0°E (Earth-facing
 * center), +X = 0°N 90°E. Body frame: x = 0°E, y = 90°E, z = north.
 */

const DEG = Math.PI / 180
const AU_KM = 149597870.7

export type Vec3 = [number, number, number]

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const norm = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]))
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/** Days since J2000.0 in (approximately) TDB. */
function daysJ2000(date: Date) {
  return date.getTime() / 86400000 + 2440587.5 - 2451545.0 + 69.2 / 86400
}

/** Ecliptic (of date) longitude/latitude -> J2000 equatorial vector. */
function eclipticToEquatorial(lon: number, lat: number, r: number, T: number): Vec3 {
  const lonJ2000 = lon - 1.396971 * T * DEG // undo general precession in longitude
  const eps = 23.4392911 * DEG
  const x = r * Math.cos(lat) * Math.cos(lonJ2000)
  const y = r * Math.cos(lat) * Math.sin(lonJ2000)
  const z = r * Math.sin(lat)
  return [x, y * Math.cos(eps) - z * Math.sin(eps), y * Math.sin(eps) + z * Math.cos(eps)]
}

export function sunGeocentric(date: Date): Vec3 {
  const T = daysJ2000(date) / 36525
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * DEG
  const e = 0.016708634 - 0.000042037 * T
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M)
  const nu = M + C * DEG
  const r = ((1.000001018 * (1 - e * e)) / (1 + e * Math.cos(nu))) * AU_KM
  return eclipticToEquatorial((L0 + C) * DEG, 0, r, T)
}

// [D, M, M', F, coefficient] — Meeus table 47.A / 47.B (largest terms)
const MOON_LR: [number, number, number, number, number, number][] = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],
  [2, -2, 0, 0, 2236, -9884],
]

const MOON_B: [number, number, number, number, number][] = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
]

export function moonGeocentric(date: Date): Vec3 {
  const T = daysJ2000(date) / 36525
  const Lp = 218.3164477 + 481267.88123421 * T
  const D = (297.8501921 + 445267.1114034 * T) * DEG
  const M = (357.5291092 + 35999.0502909 * T) * DEG
  const Mp = (134.9633964 + 477198.8675055 * T) * DEG
  const F = (93.272095 + 483202.0175233 * T) * DEG
  const E = 1 - 0.002516 * T

  let sl = 0
  let sr = 0
  for (const [d, m, mp, f, cl, cr] of MOON_LR) {
    const arg = d * D + m * M + mp * Mp + f * F
    const e = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1
    sl += cl * e * Math.sin(arg)
    sr += cr * e * Math.cos(arg)
  }
  let sb = 0
  for (const [d, m, mp, f, cb] of MOON_B) {
    const e = Math.abs(m) === 1 ? E : 1
    sb += cb * e * Math.sin(d * D + m * M + mp * Mp + f * F)
  }
  const lon = (Lp + sl / 1e6) * DEG
  const lat = (sb / 1e6) * DEG
  const r = 385000.56 + sr / 1000
  return eclipticToEquatorial(lon, lat, r, T)
}

/** IAU WGCCRE 2009 lunar orientation: body axes expressed in ICRF. */
export function moonBodyAxes(date: Date): { x: Vec3; y: Vec3; z: Vec3 } {
  const d = daysJ2000(date)
  const T = d / 36525
  const E = [
    0,
    125.045 - 0.0529921 * d,
    250.089 - 0.1059842 * d,
    260.008 + 13.0120009 * d,
    176.625 + 13.3407154 * d,
    357.529 + 0.9856003 * d,
    311.589 + 26.4057084 * d,
    134.963 + 13.064993 * d,
    276.617 + 0.3287146 * d,
    34.226 + 1.7484877 * d,
    15.134 - 0.1589763 * d,
    119.743 + 0.0036096 * d,
    239.961 + 0.1643573 * d,
    25.053 + 12.9590088 * d,
  ].map((v) => v * DEG)
  const s = (i: number) => Math.sin(E[i])
  const c = (i: number) => Math.cos(E[i])

  const ra =
    269.9949 + 0.0031 * T - 3.8787 * s(1) - 0.1204 * s(2) + 0.07 * s(3) - 0.0172 * s(4) +
    0.0072 * s(6) - 0.0052 * s(10) + 0.0043 * s(13)
  const dec =
    66.5392 + 0.013 * T + 1.5419 * c(1) + 0.0239 * c(2) - 0.0278 * c(3) + 0.0068 * c(4) -
    0.0029 * c(6) + 0.0009 * c(7) + 0.0008 * c(10) - 0.0009 * c(13)
  const W =
    38.3213 + 13.17635815 * d - 1.4e-12 * d * d + 3.561 * s(1) + 0.1208 * s(2) - 0.0642 * s(3) +
    0.0158 * s(4) + 0.0252 * s(5) - 0.0066 * s(6) - 0.0047 * s(7) - 0.0046 * s(8) +
    0.0028 * s(9) + 0.0052 * s(10) + 0.004 * s(11) + 0.0019 * s(12) - 0.0044 * s(13)

  const a = ra * DEG
  const dd = dec * DEG
  const w = W * DEG
  const z: Vec3 = [Math.cos(dd) * Math.cos(a), Math.cos(dd) * Math.sin(a), Math.sin(dd)]
  const node: Vec3 = [-Math.sin(a), Math.cos(a), 0]
  const x = norm([
    node[0] * Math.cos(w) + cross(z, node)[0] * Math.sin(w),
    node[1] * Math.cos(w) + cross(z, node)[1] * Math.sin(w),
    node[2] * Math.cos(w) + cross(z, node)[2] * Math.sin(w),
  ])
  return { x, y: cross(z, x), z }
}

export interface MoonState {
  date: Date
  /** unit vector toward the Sun, scene frame */
  sunDir: Vec3
  /** unit vector toward the Earth, scene frame */
  earthDir: Vec3
  /** fraction of Earth's disc that is sunlit, as seen from the Moon */
  earthIlluminated: number
  /** Earth–Moon center distance, km */
  earthDistKm: number
  subsolarLatDeg: number
  subsolarLonDeg: number
  /** rows of the ICRF -> scene rotation (scene = M * icrf) */
  icrfToScene: [Vec3, Vec3, Vec3]
}

export function moonState(date: Date): MoonState {
  const sun = sunGeocentric(date)
  const moon = moonGeocentric(date)
  const ax = moonBodyAxes(date)
  const rows: [Vec3, Vec3, Vec3] = [ax.y, ax.z, ax.x] // scene x,y,z = body y,z,x
  const toScene = (v: Vec3): Vec3 => [dot(rows[0], v), dot(rows[1], v), dot(rows[2], v)]

  const sunDir = norm(toScene(sub(sun, moon)))
  const earthDir = norm(toScene(scale(moon, -1)))
  const cosPsi = dot(norm(sun), norm(moon))

  return {
    date,
    sunDir,
    earthDir,
    earthIlluminated: (1 + cosPsi) / 2,
    earthDistKm: Math.hypot(moon[0], moon[1], moon[2]),
    subsolarLatDeg: Math.asin(sunDir[1]) / DEG,
    subsolarLonDeg: Math.atan2(sunDir[0], sunDir[2]) / DEG,
    icrfToScene: rows,
  }
}

/** Sun elevation (deg) above the spherical horizon at a surface point. */
export function sunElevationDeg(date: Date, latDeg: number, lonDeg: number) {
  const { sunDir } = moonState(date)
  const la = latDeg * DEG
  const lo = lonDeg * DEG
  const up: Vec3 = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)]
  return Math.asin(dot(sunDir, up)) / DEG
}

/** First moment after `from` when the Sun rises through `elevationDeg` at the point. */
export function nextSunriseElevation(
  from: Date,
  latDeg: number,
  lonDeg: number,
  elevationDeg: number,
): Date {
  const HOUR = 3600000
  let t0 = from.getTime()
  let e0 = sunElevationDeg(from, latDeg, lonDeg)
  for (let i = 0; i < 24 * 40; i++) {
    const t1 = t0 + HOUR
    const e1 = sunElevationDeg(new Date(t1), latDeg, lonDeg)
    if (e0 < elevationDeg && e1 >= elevationDeg) {
      let lo = t0
      let hi = t1
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2
        if (sunElevationDeg(new Date(mid), latDeg, lonDeg) < elevationDeg) lo = mid
        else hi = mid
      }
      return new Date(Math.round(hi / 60000) * 60000)
    }
    t0 = t1
    e0 = e1
  }
  return from
}
