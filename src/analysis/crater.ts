import { sampleDisc, type DiscGrid, type HeightSampler } from './terrain'
import { summarize, type Summary } from './stats'

/**
 * Crater geometry measured from the DEM.
 *
 * Zones are NYXOS-defined geometric rings, as fractions of the crater radius Rc. They are a
 * practical split of the analysis area, not published morphological units, and they do not
 * assume a crater has a flat floor, a central peak or terraces.
 *   floor   r <= 0.40 Rc      (floor *elevation* uses the inner core, r <= 0.30 Rc)
 *   wall    0.40 < r <= 0.85 Rc
 *   rim     0.85 < r <= 1.15 Rc   (rim crest = median of the highest point in each of 36 sectors)
 *   outside 1.15 < r <= 1.30 Rc   (immediate surroundings)
 */

export type Zone = 'floor' | 'wall' | 'rim' | 'outside'
export const ZONES: Zone[] = ['floor', 'wall', 'rim', 'outside']
export const ZONE_LIMITS = { floorCore: 0.3, floor: 0.4, wall: 0.85, rim: 1.15, outside: 1.3 }
export const RIM_SECTORS = 36

export function zoneOf(rKm: number, craterRadiusKm: number): Zone | null {
  const f = rKm / craterRadiusKm
  if (f <= ZONE_LIMITS.floor) return 'floor'
  if (f <= ZONE_LIMITS.wall) return 'wall'
  if (f <= ZONE_LIMITS.rim) return 'rim'
  if (f <= ZONE_LIMITS.outside) return 'outside'
  return null
}

export interface ZoneStats {
  zone: Zone
  n: number
  areaKm2: number
  elevM: Summary | null
  slopeDeg: Summary | null
}

export interface CraterInput {
  lat: number
  lon: number
  /** catalogue diameter, km */
  diameterKm: number
}

export type CraterGeometry =
  | {
      status: 'ok'
      input: CraterInput
      rimElevM: number
      floorElevM: number
      depthM: number
      /** depth / diameter, both measured by NYXOS from the DEM and the catalogue diameter */
      depthToDiameter: number
      /** spread (std dev) of the per-sector rim crest heights, m; large = irregular or breached rim */
      rimSpreadM: number
      rimSectorsFound: number
      zones: ZoneStats[]
      grid: DiscGrid
    }
  | { status: 'unavailable'; input: CraterInput; reason: string; grid: DiscGrid | null }

/** Choose a grid cell: no finer than the crater needs, no finer than the DEM can support. */
export function defaultCellKm(diameterKm: number, demCellKm = 0.1) {
  return Math.max(demCellKm, diameterKm / 110)
}

export function analyzeCrater(
  h: HeightSampler,
  input: CraterInput,
  opts: { cellKm?: number } = {},
): CraterGeometry {
  const Rc = input.diameterKm / 2
  const center = { lat: input.lat, lon: input.lon }
  const cellKm = opts.cellKm ?? defaultCellKm(input.diameterKm, h.resolutionKmAt?.(input.lat, input.lon))
  let grid: DiscGrid
  try {
    grid = sampleDisc(h, center, Rc * ZONE_LIMITS.outside, cellKm)
  } catch (e) {
    return { status: 'unavailable', input, reason: (e as Error).message, grid: null }
  }

  const floorCore: number[] = []
  const sectorMax = new Array<number>(RIM_SECTORS).fill(-Infinity)
  const per: Record<Zone, { elev: number[]; slope: number[] }> = {
    floor: { elev: [], slope: [] },
    wall: { elev: [], slope: [] },
    rim: { elev: [], slope: [] },
    outside: { elev: [], slope: [] },
  }
  for (let k = 0; k < grid.n; k++) {
    const zone = zoneOf(grid.rKm[k], Rc)
    if (!zone) continue
    per[zone].elev.push(grid.elevM[k])
    per[zone].slope.push(grid.slopeDeg[k])
    if (grid.rKm[k] <= Rc * ZONE_LIMITS.floorCore) floorCore.push(grid.elevM[k])
    if (zone === 'rim') {
      const s = Math.min(RIM_SECTORS - 1, Math.floor((grid.azDeg[k] / 360) * RIM_SECTORS))
      if (grid.elevM[k] > sectorMax[s]) sectorMax[s] = grid.elevM[k]
    }
  }

  const sectors = sectorMax.filter((v) => Number.isFinite(v))
  if (sectors.length < RIM_SECTORS * 0.8) {
    return { status: 'unavailable', input, reason: `Rim covered in only ${sectors.length} of ${RIM_SECTORS} sectors at this resolution`, grid }
  }
  if (floorCore.length < 12) {
    return { status: 'unavailable', input, reason: `Only ${floorCore.length} DEM samples inside the floor core; resolution too coarse for this crater`, grid }
  }
  const rim = summarize(sectors)!
  const floor = summarize(floorCore)!
  const depthM = rim.median - floor.median
  if (!(depthM > 0)) {
    return { status: 'unavailable', input, reason: 'No rim crest above the floor was found in the DEM', grid }
  }

  const zones: ZoneStats[] = (['floor', 'wall', 'rim', 'outside'] as Zone[]).map((zone) => ({
    zone,
    n: per[zone].elev.length,
    areaKm2: per[zone].elev.length * grid.cellAreaKm2,
    elevM: summarize(per[zone].elev),
    slopeDeg: summarize(per[zone].slope),
  }))

  return {
    status: 'ok',
    input,
    rimElevM: rim.median,
    floorElevM: floor.median,
    depthM,
    depthToDiameter: depthM / 1000 / input.diameterKm,
    rimSpreadM: rim.std,
    rimSectorsFound: sectors.length,
    zones,
    grid,
  }
}
