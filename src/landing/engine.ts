import { SUN_RADIUS_DEG, discAbove } from '../sim/analysis/siteAnalysis'
import { horizonAt } from '../sim/terrain/cpuTerrain'
import { ephemerisSource, moonState } from '../astro/ephemeris'
import { siteFrame } from '../sim/terrain/cpuTerrain'
import { greatCircleKm } from '../analysis/geo'
import { HazardField, polarXY, type HazardCell } from './hazard'
import type { LanderProfile } from './profile'

/**
 * Landing assessment. Three separate verdicts (Safety, Operations, Science); never a blended
 * score. Every row states its limit, its source, the data resolution behind it and the
 * method. Unknown or too-coarse data is reported as NOT EVALUATED, never guessed.
 */
export type Status = 'PASS' | 'WARNING' | 'FAIL' | 'NOT_EVALUATED' | 'INFO'
export type Tag = 'DEM' | 'MODEL' | 'CAT' | 'N/A'

export interface Row {
  id: string
  label: string
  status: Status
  /** the measured value, human readable */
  value: string
  /** the limit it was judged against, human readable */
  limit: string
  /** where the limit comes from */
  limitSource: string
  tag: Tag
  /** data resolution / basis of the measurement */
  basis: string
  /** why this status */
  why: string
  /** false = reported but does not change the verdict (e.g. a known data gap) */
  gating: boolean
}

export interface TerrainLike {
  horizonProfile(lat: number, lon: number, n?: number, eyeKm?: number, steps?: number): Float32Array
  heightAtLatLon(lat: number, lon: number): number
  resolutionKmAt(lat: number, lon: number): number
}

const STEP_MIN = 30
const DAY = 86400000

export interface Timeline {
  startMs: number
  stepMs: number
  n: number
  sunFrac: Float32Array
  earthFrac: Float32Array
  sunElev: Float32Array
  earthElev: Float32Array
  sunAz: Float32Array
  earthAz: Float32Array
}

/** Sun and Earth visibility (fraction of each disc above the terrain horizon) every 30 min. */
export function buildTimeline(profile: Float32Array, lat: number, lon: number, hKm: number, startMs: number, days: number): Timeline {
  const stepMs = STEP_MIN * 60000
  const n = Math.round((days * DAY) / stepMs) + 1
  const f = siteFrame(lat, lon)
  const sunFrac = new Float32Array(n)
  const earthFrac = new Float32Array(n)
  const sunElev = new Float32Array(n)
  const earthElev = new Float32Array(n)
  const sunAz = new Float32Array(n)
  const earthAz = new Float32Array(n)
  const DEGR = 180 / Math.PI
  const r = 1737.4 + hKm
  for (let i = 0; i < n; i++) {
    const s = moonState(new Date(startMs + i * stepMs))
    const ex = s.earthDir[0] * s.earthDistKm - f.up[0] * r
    const ey = s.earthDir[1] * s.earthDistKm - f.up[1] * r
    const ez = s.earthDir[2] * s.earthDistKm - f.up[2] * r
    const el = Math.hypot(ex, ey, ez)
    const dir = (v: number[]) => {
      const up = v[0] * f.up[0] + v[1] * f.up[1] + v[2] * f.up[2]
      const east = v[0] * f.east[0] + v[1] * f.east[1] + v[2] * f.east[2]
      const north = v[0] * f.north[0] + v[1] * f.north[1] + v[2] * f.north[2]
      return [Math.asin(Math.max(-1, Math.min(1, up))) * DEGR, ((Math.atan2(east, north) * DEGR) + 360) % 360]
    }
    const [se, sa] = dir(s.sunDir)
    const [ee, ea] = dir([ex / el, ey / el, ez / el])
    sunElev[i] = se
    earthElev[i] = ee
    sunAz[i] = sa
    earthAz[i] = ea
    sunFrac[i] = discAbove(se, horizonAt(profile, sa), SUN_RADIUS_DEG)
    earthFrac[i] = discAbove(ee, horizonAt(profile, ea), (Math.asin(6371 / el) * DEGR))
  }
  return { startMs, stepMs, n, sunFrac, earthFrac, sunElev, earthElev, sunAz, earthAz }
}

export interface Run {
  start: number
  end: number
}
/** Contiguous runs where pred(i) holds, indices inclusive start, exclusive end. */
export function runs(n: number, pred: (i: number) => boolean): Run[] {
  const out: Run[] = []
  let s = -1
  for (let i = 0; i < n; i++) {
    if (pred(i)) {
      if (s < 0) s = i
    } else if (s >= 0) {
      out.push({ start: s, end: i })
      s = -1
    }
  }
  if (s >= 0) out.push({ start: s, end: n })
  return out
}

export interface WindowStats {
  samples: number
  litPct: number
  earthPct: number
  bothPct: number
  longestDarkH: number
  longestEarthOutH: number
  sunrises: number[]
  sunsets: number[]
  /** runs touch the window edge, so their true length can be longer */
  darkClipped: boolean
}

export function windowStats(tl: Timeline, i0: number, i1: number): WindowStats {
  const lit = (i: number) => tl.sunFrac[i] >= 0.5
  const ear = (i: number) => tl.earthFrac[i] >= 0.5
  let l = 0, e = 0, b = 0
  const sunrises: number[] = []
  const sunsets: number[] = []
  for (let i = i0; i < i1; i++) {
    if (lit(i)) l++
    if (ear(i)) e++
    if (lit(i) && ear(i)) b++
    if (i > i0 && lit(i) !== lit(i - 1)) {
      const a = tl.sunFrac[i - 1], c = tl.sunFrac[i]
      const t = tl.startMs + (i - 1 + (0.5 - a) / (c - a || 1)) * tl.stepMs
      ;(lit(i) ? sunrises : sunsets).push(t)
    }
  }
  const n = i1 - i0
  const longest = (pred: (i: number) => boolean) => {
    let best = 0
    for (const r of runs(n, (k) => pred(i0 + k))) best = Math.max(best, r.end - r.start)
    return (best * tl.stepMs) / 3.6e6
  }
  const darkRuns = runs(n, (k) => !lit(i0 + k))
  return {
    samples: n,
    litPct: (100 * l) / n,
    earthPct: (100 * e) / n,
    bothPct: (100 * b) / n,
    longestDarkH: longest((i) => !lit(i)),
    longestEarthOutH: longest((i) => !ear(i)),
    sunrises,
    sunsets,
    darkClipped: darkRuns.some((r) => r.start === 0 || r.end === n),
  }
}

/** Start times (index ranges) from which a window of L samples is entirely lit (and Earth-visible if asked). */
export function feasibleStarts(tl: Timeline, L: number, needEarth: boolean): Run[] {
  const bad = new Int32Array(tl.n + 1)
  for (let i = 0; i < tl.n; i++) {
    const ok = tl.sunFrac[i] >= 0.5 && (!needEarth || tl.earthFrac[i] >= 0.5)
    bad[i + 1] = bad[i] + (ok ? 0 : 1)
  }
  return runs(tl.n - L + 1, (i) => bad[i + L] - bad[i] === 0)
}

export interface EvaResult {
  cells: number
  reachablePct: number
  steepPct: number
  radiusM: number
  /** p95 slope of each cell in the disc, for the histogram */
  slopes: number[]
}

/** Flood-fill from the landing cell over cells whose p95 slope is within the EVA limit. */
export function evaReach(h: HazardField, cx: number, cy: number, radiusM: number, limitDeg: number, cellM: number): EvaResult | null {
  const N = Math.ceil(radiusM / cellM)
  const side = 2 * N + 1
  const grid: (HazardCell | null)[] = new Array(side * side).fill(null)
  let total = 0
  const slopes: number[] = []
  for (let j = -N; j <= N; j++)
    for (let i = -N; i <= N; i++) {
      if (Math.hypot(i, j) * cellM > radiusM) continue
      const c = h.cellAt(cx + i * cellM, cy + j * cellM)
      grid[(j + N) * side + (i + N)] = c
      if (c) {
        total++
        slopes.push(c.p95)
      }
    }
  if (!total) return null
  const ok = (k: number) => !!grid[k] && grid[k]!.p95 <= limitDeg
  const start = N * side + N
  const seen = new Uint8Array(side * side)
  let reach = 0
  if (ok(start)) {
    const q = [start]
    seen[start] = 1
    while (q.length) {
      const k = q.pop()!
      reach++
      const ci = k % side, cj = (k - ci) / side
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ni = ci + di, nj = cj + dj
          if (ni < 0 || nj < 0 || ni >= side || nj >= side) continue
          const nk = nj * side + ni
          if (!seen[nk] && ok(nk)) {
            seen[nk] = 1
            q.push(nk)
          }
        }
    }
  }
  const steep = slopes.filter((s) => s > limitDeg).length
  return { cells: total, reachablePct: (100 * reach) / total, steepPct: (100 * steep) / total, radiusM, slopes }
}

export interface GridCell {
  /** offsets in cells east (+i) and north (+j) of the landing cell */
  i: number
  j: number
  p95: number
  frac10: number
}
export interface HazardGrid {
  cellM: number
  radiusCells: number
  cells: GridCell[]
}
/** Hazard cells in a square around the landing cell, for the map figure. */
export function hazardGrid(h: HazardField, cx: number, cy: number, radiusM: number, cellM: number): HazardGrid {
  const N = Math.ceil(radiusM / cellM)
  const cells: GridCell[] = []
  for (let j = -N; j <= N; j++)
    for (let i = -N; i <= N; i++) {
      const c = h.cellAt(cx + i * cellM, cy + j * cellM)
      if (c) cells.push({ i, j, p95: c.p95, frac10: c.frac10 })
    }
  return { cellM, radiusCells: N, cells }
}

export interface Assessment {
  site: { lat: number; lon: number; heightM: number }
  profile: LanderProfile
  startMs: number
  stayDays: number
  rows: Row[]
  safety: Verdict
  operations: Verdict
  headline: { level: 'FEASIBLE' | 'CONDITIONAL' | 'NOT_RECOMMENDED' | 'CANNOT_ASSESS'; text: string }
  hazardCell: HazardCell | null
  zoneWorst: HazardCell | null
  eva: EvaResult | null
  grid: HazardGrid | null
  timeline: Timeline
  stats: WindowStats
  windows: { litOnly: Run[]; litAndEarth: Run[] }
  horizon: Float32Array
  /** where the Sun/Earth directions came from over the whole analysed span */
  ephemeris: 'JPL DE440' | 'analytic model'
  demResolutionM: number
  gaps: string[]
}

export interface Verdict {
  status: Status
  reasons: string[]
}

function roll(rows: Row[]): Verdict {
  const g = rows.filter((r) => r.gating)
  const fails = g.filter((r) => r.status === 'FAIL')
  if (fails.length) return { status: 'FAIL', reasons: fails.map((r) => `${r.label}: ${r.why}`) }
  const ne = g.filter((r) => r.status === 'NOT_EVALUATED')
  if (ne.length) return { status: 'NOT_EVALUATED', reasons: ne.map((r) => `${r.label}: ${r.why}`) }
  const w = g.filter((r) => r.status === 'WARNING')
  if (w.length) return { status: 'WARNING', reasons: w.map((r) => `${r.label}: ${r.why}`) }
  return { status: 'PASS', reasons: ['All gating constraints met within the stated data limits.'] }
}

const fmtH = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h.toFixed(1)} h`)

export interface EvalInput {
  lat: number
  lon: number
  startMs: number
  profile: LanderProfile
  terrain: TerrainLike
  hazard: HazardField | null
  /** analysis horizon for the window finder (days) */
  scanDays?: number
}

export function evaluate(inp: EvalInput): Assessment {
  const { lat, lon, startMs, profile, terrain, hazard } = inp
  const stayDays = profile.stayDays.value
  const hKm = terrain.heightAtLatLon(lat, lon)
  const demM = terrain.resolutionKmAt(lat, lon) * 1000
  const horizon = terrain.horizonProfile(lat, lon)
  const scan = Math.max(inp.scanDays ?? 365, stayDays + 1)
  const tl = buildTimeline(horizon, lat, lon, hKm, startMs, scan)
  const L = Math.round((stayDays * DAY) / tl.stepMs)
  const stats = windowStats(tl, 0, Math.min(tl.n, L + 1))
  const windows = {
    litOnly: feasibleStarts(tl, L + 1, false),
    litAndEarth: feasibleStarts(tl, L + 1, true),
  }

  const rows: Row[] = []
  const gaps: string[] = []
  const lim = profile
  const slopeLim = lim.maxLandingSlopeDeg.value

  // ---- position envelope
  if (lim.southPoleBandDeg.value !== null) {
    const band = lim.southPoleBandDeg.value
    const inside = lat <= -90 + band
    rows.push({
      id: 'band',
      label: 'Latitude envelope',
      status: inside ? 'PASS' : 'FAIL',
      value: `${lat.toFixed(2)}°`,
      limit: `within ${band}° of the south pole (≤ ${(-90 + band).toFixed(0)}°)`,
      limitSource: lim.southPoleBandDeg.source,
      tag: 'CAT',
      basis: 'planetocentric latitude',
      why: inside ? 'inside the latitude band' : `outside the ${band}° polar band this lander profile is limited to`,
      gating: true,
    })
  }

  // ---- landing-zone slope
  const P = lat < -55 ? polarXY(lat, lon) : null
  let cell: HazardCell | null = null
  let zoneWorst: HazardCell | null = null
  let eva: EvaResult | null = null
  let grid: HazardGrid | null = null
  if (hazard && P) {
    cell = hazard.cellAt(P.x, P.y)
    if (cell) {
      const r = lim.landingZoneRadiusM.value
      zoneWorst = cell
      const n = Math.ceil(r / cell.cellM)
      for (let j = -n; j <= n; j++)
        for (let i = -n; i <= n; i++) {
          if (Math.hypot(i, j) * cell.cellM > r + cell.cellM / 2) continue
          const c = hazard.cellAt(cell.x + i * cell.cellM, cell.y + j * cell.cellM)
          if (c && c.p95 > zoneWorst!.p95) zoneWorst = c
        }
      eva = evaReach(hazard, cell.x, cell.y, lim.evaRadiusM.value, lim.maxEvaSlopeDeg.value, cell.cellM)
      grid = hazardGrid(hazard, cell.x, cell.y, lim.evaRadiusM.value + cell.cellM, cell.cellM)
    }
  }
  const slopeBasis = cell
    ? `LOLA slope map, ${cell.nativeM} m native pixels, ${cell.cellM} m hazard cells (${cell.tier.toUpperCase()})`
    : `terrain DEM ≈ ${Math.round(demM)} m cells`
  if (!cell || !zoneWorst) {
    rows.push({
      id: 'slope',
      label: 'Landing-zone slope',
      status: 'NOT_EVALUATED',
      value: 'no lander-scale slope data',
      limit: `< ${slopeLim}° over 100 m`,
      limitSource: lim.maxLandingSlopeDeg.source,
      tag: 'N/A',
      basis: slopeBasis,
      why: !P
        ? 'north of 55°S there is no lander-scale (≤ 60 m) slope product loaded; the ≈ 400 m global DEM cannot resolve landing-scale slope'
        : hazard
          ? 'this location lies outside the loaded slope tiles'
          : 'slope tiles are not available in this build',
      gating: true,
    })
    gaps.push('Lander-scale slope map not available at this location.')
  } else {
    const err = cell.errDeg ?? 0
    const worstP95 = zoneWorst.p95
    const fine = cell.tier === 'a'
    let status: Status
    let why: string
    if (worstP95 > slopeLim && zoneWorst.frac10 >= 50) {
      status = 'FAIL'
      why = `most pixels (${zoneWorst.frac10.toFixed(0)}%) in the steepest cell of the landing zone exceed 10° and the 95th-percentile slope is ${worstP95.toFixed(1)}°`
    } else if (!fine) {
      status = 'WARNING'
      why = `native resolution ${cell.nativeM} m is too coarse to certify a ${lim.landingZoneRadiusM.value} m zone; worst-cell 95th-percentile slope ${worstP95.toFixed(1)}°`
    } else if (worstP95 + err <= slopeLim) {
      status = 'PASS'
      why = `95th-percentile slope plus measurement error (${(worstP95 + err).toFixed(1)}°) is within the limit`
    } else {
      status = 'WARNING'
      why = `95th-percentile slope ${worstP95.toFixed(1)}° ${err ? `+ error ${err.toFixed(1)}° ` : ''}reaches the ${slopeLim}° limit; some of the zone is steeper than allowed`
    }
    if (cell.errDeg === null) gaps.push('Slope error product was unavailable; no uncertainty margin applied.')
    rows.push({
      id: 'slope',
      label: 'Landing-zone slope',
      status,
      value: `p95 ${worstP95.toFixed(1)}° (worst cell), ${zoneWorst.frac10.toFixed(0)}% of pixels > 10°`,
      limit: `< ${slopeLim}° over 100 m`,
      limitSource: lim.maxLandingSlopeDeg.source,
      tag: 'DEM',
      basis: slopeBasis,
      why,
      gating: true,
    })
  }

  // ---- EVA terrain (reported, no published coverage threshold)
  if (eva) {
    rows.push({
      id: 'eva',
      label: 'EVA terrain within 2 km',
      status: 'INFO',
      value: `${eva.reachablePct.toFixed(0)}% of the area reachable under ${lim.maxEvaSlopeDeg.value}°; ${eva.steepPct.toFixed(0)}% steeper`,
      limit: `slope < ${lim.maxEvaSlopeDeg.value}° over 2 km`,
      limitSource: lim.maxEvaSlopeDeg.source,
      tag: 'DEM',
      basis: slopeBasis,
      why: 'NASA publishes a slope limit but no required reachable-area share, so this is shown for judgement and does not change the verdict. Cells use 95th-percentile slope at their native pixel scale, which is stricter than a 2 km-baseline slope',
      gating: false,
    })
  } else {
    rows.push({
      id: 'eva', label: 'EVA terrain within 2 km', status: 'NOT_EVALUATED', value: 'no slope data', limit: `slope < ${lim.maxEvaSlopeDeg.value}° over 2 km`,
      limitSource: lim.maxEvaSlopeDeg.source, tag: 'N/A', basis: slopeBasis, why: 'needs the lander-scale slope map', gating: false,
    })
  }

  // ---- horizon obstruction (informational)
  let hMax = -90, hAz = 0
  for (let i = 0; i < horizon.length; i++) if (horizon[i] > hMax) { hMax = horizon[i]; hAz = (i / horizon.length) * 360 }
  rows.push({
    id: 'horizon', label: 'Terrain horizon', status: 'INFO', value: `up to ${hMax.toFixed(1)}° at azimuth ${hAz.toFixed(0)}°`,
    limit: 'n/a', limitSource: 'No NASA limit; drives the sunlight and Earth-visibility results below', tag: 'DEM',
    basis: `ray-marched over the NYXOS terrain pyramid, local DEM ≈ ${Math.round(demM)} m`, why: 'horizon elevation from terrain ray-march, curvature included', gating: false,
  })

  // ---- boulders: honest gap
  rows.push({
    id: 'boulders', label: 'Boulders and small craters', status: 'NOT_EVALUATED', value: 'no dataset loaded',
    limit: 'hazard-free zone', limitSource: 'Requires LROC NAC boulder / small-crater maps (not loaded in this build)', tag: 'N/A',
    basis: 'none', why: 'no boulder or small-crater map is loaded; a high-resolution hazard survey is still needed', gating: false,
  })
  gaps.push('Boulder and small-crater hazards are not assessed (no dataset loaded).')

  // ---- operations: sunlight, Earth
  const coarse = demM > 500
  const sunRow: Row = {
    id: 'sun', label: 'Sunlight during stay', status: 'PASS',
    value: `${stats.litPct.toFixed(1)}% lit, longest dark ${fmtH(stats.longestDarkH)}${stats.darkClipped && stats.longestDarkH > 0 ? '+' : ''}`,
    limit: lim.requireLitWholeStay.value ? 'lit for the whole stay' : 'reported only',
    limitSource: lim.requireLitWholeStay.source, tag: 'MODEL',
    basis: `direct sunlight, terrain horizon at ≈ ${Math.round(demM)} m DEM, 30 min steps from ${new Date(startMs).toISOString().slice(0, 16)}Z for ${stayDays} d`,
    why: '', gating: true,
  }
  if (lim.requireLitWholeStay.value) {
    if (stats.litPct >= 100) {
      sunRow.status = coarse ? 'WARNING' : 'PASS'
      sunRow.why = coarse ? `lit for the whole stay, but the terrain model is coarse (≈ ${Math.round(demM)} m) so shadows from small relief are not resolved` : 'lit for the whole stay'
    } else {
      sunRow.status = 'FAIL'
      sunRow.why = `dark for ${(100 - stats.litPct).toFixed(1)}% of the stay (longest ${fmtH(stats.longestDarkH)}); this profile requires continuous sunlight`
    }
  } else {
    sunRow.status = stats.litPct > 0 ? 'INFO' : 'FAIL'
    sunRow.why = stats.litPct > 0 ? 'no continuous-light requirement for this profile; survival through darkness must be planned' : 'never lit during the stay'
    sunRow.gating = stats.litPct === 0
  }
  rows.push(sunRow)

  const earthRow: Row = {
    id: 'earth', label: 'Direct-to-Earth line of sight', status: 'PASS',
    value: `${stats.earthPct.toFixed(1)}% visible, longest outage ${fmtH(stats.longestEarthOutH)}`,
    limit: lim.requireDirectEarth.value ? 'Earth in line of sight (no relay)' : 'reported only',
    limitSource: lim.requireDirectEarth.source, tag: 'MODEL',
    basis: 'Earth disc vs terrain horizon, geometric visibility only (not a link budget)', why: '', gating: lim.requireDirectEarth.value,
  }
  if (lim.requireDirectEarth.value) {
    if (stats.earthPct >= 100) {
      earthRow.status = coarse ? 'WARNING' : 'PASS'
      earthRow.why = 'Earth stays in line of sight (geometric); a usable radio link is not verified'
    } else if (stats.earthPct <= 0) {
      earthRow.status = 'FAIL'
      earthRow.why = 'Earth is never in line of sight during the stay'
    } else {
      earthRow.status = 'WARNING'
      earthRow.why = `communication gaps: Earth hidden ${(100 - stats.earthPct).toFixed(1)}% of the stay (longest ${fmtH(stats.longestEarthOutH)})`
    }
  } else {
    earthRow.status = 'INFO'
    earthRow.why = 'no direct-to-Earth requirement for this profile'
  }
  rows.push(earthRow)

  rows.push({
    id: 'window', label: 'Launch / landing windows (next year)', status: 'INFO',
    value: windows.litAndEarth.length ? `${windows.litAndEarth.length} window(s) with sunlight + Earth for ${stayDays} d` : windows.litOnly.length ? `${windows.litOnly.length} sunlit-only window(s); none with Earth too` : 'none in the next year',
    limit: `${stayDays} d fully lit${lim.requireDirectEarth.value ? ' and Earth-visible' : ''}`, limitSource: 'Derived from the two rows above', tag: 'MODEL',
    basis: `start times scanned every 30 min over ${scan} d`, why: 'scan of every start time in the next year', gating: false,
  })

  const safetyRows = rows.filter((r) => ['band', 'slope'].includes(r.id))
  const opsRows = rows.filter((r) => ['sun', 'earth'].includes(r.id))
  const safety = roll(safetyRows)
  const operations = roll(opsRows)

  let headline: Assessment['headline']
  const feasibleNow = windows.litAndEarth.length > 0
  if (safety.status === 'FAIL' || operations.status === 'FAIL') {
    const why = [safety, operations].filter((v) => v.status === 'FAIL').flatMap((v) => v.reasons)
    headline = { level: 'NOT_RECOMMENDED', text: `Not suitable for ${profile.name} as modelled. ${why.join(' ')}` }
  } else if (safety.status === 'NOT_EVALUATED') {
    headline = { level: 'CANNOT_ASSESS', text: 'Landing safety cannot be assessed here: the slope data is missing or too coarse. Operations results are shown, but they do not make a landing safe.' }
  } else if (safety.status === 'PASS' && operations.status === 'PASS') {
    headline = { level: 'FEASIBLE', text: `Landing and ${stayDays}-day stay are feasible in this model${feasibleNow ? `; ${windows.litAndEarth.length} window(s) found in the next year` : ''}. Boulder hazards are not assessed.` }
  } else {
    headline = { level: 'CONDITIONAL', text: 'Conditionally feasible: no hard failure, but at least one constraint is only partly met or limited by data resolution.' }
  }

  return {
    site: { lat, lon, heightM: hKm * 1000 }, profile, startMs, stayDays, rows, safety, operations, headline,
    hazardCell: cell, zoneWorst, eva, grid, timeline: tl, stats, windows, horizon,
    ephemeris: ephemerisSource(new Date(startMs)) === 'JPL DE440' && ephemerisSource(new Date(startMs + scan * DAY)) === 'JPL DE440' ? 'JPL DE440' : 'analytic model',
    demResolutionM: demM, gaps,
  }
}

export { greatCircleKm }
