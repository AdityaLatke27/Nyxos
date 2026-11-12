/**
 * Uncertainty and sensitivity of the verdicts: how far the inputs would have to be wrong to change an answer.
 * Nothing here invents an error bar. Every number is one of:
 *   - measured (agreement with NASA maps and JPL Horizons, see validation.ts),
 *   - a published map error carried with the data, or
 *   - a what-if (the horizon raised or lowered by δ degrees) reported as "the verdict flips at δ".
 */
import type { LanderProfile } from './profile'
import type { Status } from './engine'
import { ILLUMINATION_VALIDATION } from './validation'

export type Robustness = 'ROBUST' | 'SENSITIVE' | 'FRAGILE'

/** Sunlight verdict as a function of lit share, identical to the row built in evaluate(). */
export function sunStatus(litPct: number, lim: LanderProfile, coarse: boolean): Status {
  if (lim.requireLitWholeStay.value) return litPct >= 100 ? (coarse ? 'WARNING' : 'PASS') : 'FAIL'
  return litPct > 0 ? 'INFO' : 'FAIL'
}
/** Earth line-of-sight verdict as a function of visible share, identical to the row built in evaluate(). */
export function earthStatus(earthPct: number, lim: LanderProfile, coarse: boolean): Status {
  if (!lim.requireDirectEarth.value) return 'INFO'
  if (earthPct >= 100) return coarse ? 'WARNING' : 'PASS'
  return earthPct <= 0 ? 'FAIL' : 'WARNING'
}

export interface Flip {
  /** smallest uniform horizon rise (deg) that changes the status, null if none up to the search limit */
  raise: number | null
  /** smallest uniform horizon drop (deg) that changes the status */
  lower: number | null
}
export interface Sensitivity {
  level: Robustness
  /** why the level is what it is, one line per driver */
  drivers: string[]
  searchLimitDeg: number
  flip: { sun: Flip; earth: Flip }
  /** lit and Earth-visible share over the stay as the horizon is moved (for the chart) */
  curve: { offsetDeg: number[]; litPct: number[]; earthPct: number[] }
  /** lit share under three definitions of "lit" */
  litDefinitions: { anyPartPct: number; halfDiscPct: number; wholeDiscPct: number }
  slope: { marginDeg: number; errDeg: number; sensitive: boolean } | null
  ephemeris: { source: string; angularErrDeg: number }
  measured: { sunRmsPp: number; earthRmsPp: number; n: number }
  /** terrain height (m) that corresponds to a horizon shift of δ at the given distance */
  heightAt: (deg: number, distM: number) => number
}

const STEP = 0.02
const LIMIT = 1.0

export interface SensitivityInput {
  /** lit and Earth-visible share of the stay with the whole horizon shifted by offsetDeg (+ = higher) */
  statsAt: (offsetDeg: number) => { litPct: number; earthPct: number }
  /** lit share of the stay with at least `thr` of the Sun's disc above the horizon, thr in [0,1] */
  litShareAt: (thr: number) => number
  lim: LanderProfile
  coarse: boolean
  /** distance from the 100 m slope to its limit, with the map's own slope error */
  slope: { worstDeg: number; errDeg: number; limitDeg: number } | null
  ephemeris: 'JPL DE440' | 'analytic model'
}

export function computeSensitivity(inp: SensitivityInput): Sensitivity {
  const { lim, coarse } = inp
  const base = inp.statsAt(0)
  const bs = sunStatus(base.litPct, lim, coarse)
  const be = earthStatus(base.earthPct, lim, coarse)
  const flip = { sun: { raise: null, lower: null } as Flip, earth: { raise: null, lower: null } as Flip }
  for (const dir of [1, -1] as const) {
    for (let k = 1; k * STEP <= LIMIT + 1e-9; k++) {
      const d = dir * k * STEP
      const s = inp.statsAt(d)
      const key = dir > 0 ? 'raise' : 'lower'
      if (flip.sun[key] === null && sunStatus(s.litPct, lim, coarse) !== bs) flip.sun[key] = k * STEP
      if (flip.earth[key] === null && earthStatus(s.earthPct, lim, coarse) !== be) flip.earth[key] = k * STEP
      if (flip.sun[key] !== null && flip.earth[key] !== null) break
    }
  }
  const offs: number[] = []
  for (let d = -LIMIT; d <= LIMIT + 1e-9; d += 0.1) offs.push(Math.round(d * 100) / 100)
  const pts = offs.map((d) => inp.statsAt(d))

  // which verdicts actually matter for this profile
  const gates: { name: string; f: Flip }[] = []
  if (lim.requireLitWholeStay.value) gates.push({ name: 'sunlight', f: flip.sun })
  if (lim.requireDirectEarth.value) gates.push({ name: 'Earth line of sight', f: flip.earth })
  const hDeg = (deg: number) => `${deg.toFixed(2)}° (≈ ${(Math.tan((deg * Math.PI) / 180) * 1000).toFixed(1)} m of terrain height at 1 km)`
  const drivers: string[] = []
  let minFlip = Infinity
  for (const g of gates) {
    const m = Math.min(g.f.raise ?? Infinity, g.f.lower ?? Infinity)
    if (m === Infinity) drivers.push(`The ${g.name} verdict does not change for any horizon shift up to ±${LIMIT}°.`)
    else {
      minFlip = Math.min(minFlip, m)
      const which = (g.f.raise ?? Infinity) <= (g.f.lower ?? Infinity) ? 'raised' : 'lowered'
      drivers.push(`The ${g.name} verdict flips if the whole horizon is ${which} by ${hDeg(m)}.`)
    }
  }
  let slope: Sensitivity['slope'] = null
  let slopeSensitive = false
  if (inp.slope) {
    const margin = inp.slope.limitDeg - inp.slope.worstDeg
    slopeSensitive = Math.abs(margin) <= inp.slope.errDeg
    slope = { marginDeg: margin, errDeg: inp.slope.errDeg, sensitive: slopeSensitive }
    drivers.push(
      slopeSensitive
        ? `The steepest 100 m slope is ${Math.abs(margin).toFixed(1)}° ${margin >= 0 ? 'under' : 'over'} the limit, within the map's own slope error (${inp.slope.errDeg.toFixed(1)}°), so the slope verdict could go either way.`
        : `The steepest 100 m slope is ${Math.abs(margin).toFixed(1)}° ${margin >= 0 ? 'under' : 'over'} the limit, more than the map's slope error (${inp.slope.errDeg.toFixed(1)}°).`,
    )
  }
  let level: Robustness = 'ROBUST'
  if (minFlip <= 0.25 || slopeSensitive) level = 'SENSITIVE'
  if (minFlip <= 0.1) level = 'FRAGILE'

  const v = ILLUMINATION_VALIDATION
  return {
    level, drivers, searchLimitDeg: LIMIT, flip,
    curve: { offsetDeg: offs, litPct: pts.map((p) => p.litPct), earthPct: pts.map((p) => p.earthPct) },
    litDefinitions: { anyPartPct: inp.litShareAt(1e-6), halfDiscPct: inp.litShareAt(0.5), wholeDiscPct: inp.litShareAt(0.999) },
    slope,
    ephemeris: inp.ephemeris === 'JPL DE440' ? { source: 'JPL DE440', angularErrDeg: 0.001 } : { source: 'analytic model', angularErrDeg: 0.26 },
    measured: { sunRmsPp: v.sun.rmse * 100, earthRmsPp: v.earthAny.rmse * 100, n: v.n },
    heightAt: (deg, distM) => Math.tan((deg * Math.PI) / 180) * distM,
  }
}

/** Plain-language label for the stability of the answer (not for its quality: a stable FAIL is still a FAIL). */
export const ROBUSTNESS_LABEL: Record<Robustness, string> = {
  ROBUST: 'Answer is stable',
  SENSITIVE: 'Answer is sensitive',
  FRAGILE: 'Answer is fragile',
}
