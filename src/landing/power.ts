import type { Timeline } from './engine'

/**
 * Solar power and battery model for the stay. Inputs are the user's own assumptions about the spacecraft; NYXOS
 * supplies the Sun's elevation and the lit fraction of the Sun's disc every 30 minutes (terrain horizon included).
 *
 * Power at each sample = array peak power x lit fraction x incidence factor, where the incidence factor is
 *   flat (horizontal):                     sin(Sun elevation)        (the array lies on the ground)
 *   vertical (turns to face the Sun):      cos(Sun elevation)        (the array stands upright and rotates in azimuth)
 *   tracking (two axes, always facing Sun): 1
 * The array peak is the output at normal incidence in full Sun; the solar constant is taken as constant over the stay
 * (it varies by about 3% with the Earth-Moon-Sun distance over a year), and dust, temperature and shadowing by the
 * lander itself are not modelled. The battery starts full at landing and is limited to its usable capacity.
 */
export type ArrayType = 'flat' | 'vertical' | 'tracking'

export interface PowerInputs {
  arrayType: ArrayType
  /** array output at normal incidence in full sunlight, end of life (W) */
  arrayPeakW: number
  /** usable battery energy (Wh) */
  batteryWh: number
  /** constant electrical load (W) */
  loadW: number
}

export const DEFAULT_POWER: PowerInputs = { arrayType: 'vertical', arrayPeakW: 1000, batteryWh: 5000, loadW: 300 }
export const POWER_SOURCE = 'User-defined placeholder inputs; not a NASA value or a specific spacecraft. Replace with your spacecraft values.'

export const ARRAY_LABEL: Record<ArrayType, string> = {
  flat: 'Flat on the ground',
  vertical: 'Upright, turns to face the Sun',
  tracking: 'Tracks the Sun on two axes',
}

export interface PowerResult {
  /** mean array output over the stay, W */
  meanW: number
  /** mean output as a share of the array peak */
  meanPctOfPeak: number
  /** total energy generated, Wh */
  generatedWh: number
  /** total energy the load needs, Wh */
  neededWh: number
  /** lowest battery charge reached as a share of usable capacity */
  minChargePct: number
  /** hours in which the load could not be fully supplied */
  unmetH: number
  /** how long the full battery alone can carry the load, h (Infinity for no load) */
  autonomyH: number
  /** the battery was never exhausted */
  survives: boolean
}

export function incidenceFactor(type: ArrayType, sunElevDeg: number): number {
  if (sunElevDeg <= 0) return 0
  if (type === 'tracking') return 1
  const e = (sunElevDeg * Math.PI) / 180
  return type === 'flat' ? Math.sin(e) : Math.cos(e)
}

export function powerResult(tl: Pick<Timeline, 'stepMs' | 'sunFrac' | 'sunElev'>, n: number, p: PowerInputs): PowerResult {
  const dt = tl.stepMs / 3.6e6
  let soc = p.batteryWh
  let minSoc = soc, gen = 0, unmet = 0
  for (let i = 0; i < n; i++) {
    const w = p.arrayPeakW * tl.sunFrac[i] * incidenceFactor(p.arrayType, tl.sunElev[i])
    gen += w * dt
    const net = (w - p.loadW) * dt
    soc += net
    if (soc > p.batteryWh) soc = p.batteryWh
    if (soc < 0) {
      // the 1e-9 slack keeps rounding from reporting an exactly spent battery as a shortfall
      if (soc < -1e-9) unmet += dt
      soc = 0
    }
    if (soc < minSoc) minSoc = soc
  }
  return {
    meanW: n ? gen / (n * dt) : 0,
    meanPctOfPeak: p.arrayPeakW > 0 && n ? (100 * gen) / (n * dt) / p.arrayPeakW : 0,
    generatedWh: gen,
    neededWh: p.loadW * n * dt,
    minChargePct: p.batteryWh > 0 ? (100 * minSoc) / p.batteryWh : 0,
    unmetH: unmet,
    autonomyH: p.loadW > 0 ? p.batteryWh / p.loadW : Infinity,
    survives: unmet === 0,
  }
}
