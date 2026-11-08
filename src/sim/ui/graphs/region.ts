import { useMemo } from 'react'
import { analyzeCrater, zoneOf, type Zone } from '../../../analysis/crater'
import { craterAt } from '../../../analysis/craterLookup'
import type { LatLon } from '../../../analysis/geo'
import { sampleDisc, type DiscGrid } from '../../../analysis/terrain'
import type { Feature } from '../../data/types'
import { useSim, type RegionKind } from '../../state/store'
import type { CpuTerrain } from '../../terrain/cpuTerrain'

/** The crater (if any) the selected point is inside, and the effective region being analysed. */
export interface Region {
  /** the catalogued crater containing the point, if any (kept even when analysing a disc around the point) */
  crater: Feature | null
  /** true when the region is a crater zone; false for a disc around the point */
  zonal: boolean
  kind: RegionKind
  center: LatLon
  /** radius of the analysed disc, km (crater radius for crater zones) */
  radiusKm: number
}

export function useRegion(features: Feature[], point: LatLon | null): Region | null {
  const kind = useSim((s) => s.regionKind)
  const regionKm = useSim((s) => s.regionKm)
  const crater = useMemo(() => (point ? craterAt(features, point.lat, point.lon) : null), [features, point])
  return useMemo(() => {
    if (!point) return null
    if (crater && kind !== 'around') {
      return { crater, zonal: true, kind, center: { lat: crater[1], lon: crater[2] }, radiusKm: crater[3] / 2 }
    }
    return { crater, zonal: false, kind: 'around', center: point, radiusKm: regionKm }
  }, [point, crater, kind, regionKm])
}

export interface RegionGrid {
  grid: DiscGrid
  /** per-sample zone (craters only) */
  zones: (Zone | null)[] | null
  note: string | null
}

const ZONE_SETS: Record<RegionKind, Zone[]> = {
  whole: ['floor', 'wall', 'rim'],
  floor: ['floor'],
  wall: ['wall'],
  rim: ['rim'],
  outside: ['outside'],
  around: [],
}

/** Samples of the selected region (slope / elevation grid), restricted to the chosen zone. */
export function useRegionGrid(terrain: CpuTerrain, region: Region | null, hasTerrain: boolean): RegionGrid | null {
  return useMemo(() => {
    if (!region) return null
    try {
      if (region.zonal && region.crater) {
        const g = analyzeCrater(terrain, { lat: region.center.lat, lon: region.center.lon, diameterKm: region.crater[3] })
        if (g.grid) {
          const Rc = region.crater[3] / 2
          return { grid: g.grid, zones: Array.from(g.grid.rKm, (r) => zoneOf(r, Rc)), note: null }
        }
      }
      const radius = region.zonal ? 3 : region.radiusKm
      const res = terrain.resolutionKmAt(region.center.lat, region.center.lon)
      const grid = sampleDisc(terrain, region.center, radius, Math.max(res, radius / 45))
      return { grid, zones: null, note: region.zonal ? 'This crater is too large to sample in full; showing 3 km around the point.' : null }
    } catch {
      return null
    }
    // hasTerrain: redo when a finer site patch finishes loading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, region, hasTerrain])
}

export function inZoneSet(kind: RegionKind, z: Zone | null) {
  return kind === 'around' ? true : z != null && ZONE_SETS[kind].includes(z)
}
