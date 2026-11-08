import { useMemo } from 'react'
import { findEvents, litPercent, pointSeries, sunTrack, type Events, type PointSeries, type SunTrack } from '../../../analysis/illumination'
import type { LatLon } from '../../../analysis/geo'
import { WINDOW_HOURS } from '../../state/store'
import type { CpuTerrain } from '../../terrain/cpuTerrain'
import { useHorizons, horizonOf, type Cell } from './illumRun'
import type { Region, RegionGrid } from './region'
import { inZoneSet } from './region'

export interface Group {
  id: string
  label: string
  cells: Cell[]
}

const PER_GROUP = 14
export const STEP_MS = 30 * 60 * 1000
export const N_STEPS = WINDOW_HOURS * 2 + 1

function pick(list: Cell[], max: number): Cell[] {
  if (list.length <= max) return list
  const out: Cell[] = []
  for (let i = 0; i < max; i++) out.push(list[Math.floor(((i + 0.5) * list.length) / max)])
  return out
}

const pinLabel = (p: LatLon) => `${Math.abs(p.lat).toFixed(2)}°${p.lat < 0 ? 'S' : 'N'} ${Math.abs(p.lon).toFixed(2)}°${p.lon < 0 ? 'W' : 'E'}`

/** The locations to track: the clicked point, zones of its crater (or a disc around it), and pinned points. */
export function buildGroups(point: LatLon | null, region: Region | null, rg: RegionGrid | null, pinned: LatLon[]): Group[] {
  if (!point) return []
  const cell = (p: LatLon, h = 0): Cell => ({ lat: p.lat, lon: p.lon, hKm: h })
  const groups: Group[] = [{ id: 'point', label: 'Selected point', cells: [cell(point)] }]
  if (rg && region) {
    const all: Cell[] = []
    const byZone: Record<string, Cell[]> = { floor: [], wall: [], rim: [] }
    for (let k = 0; k < rg.grid.n; k++) {
      const c = cell({ lat: rg.grid.lat[k], lon: rg.grid.lon[k] }, rg.grid.elevM[k] / 1000)
      if (rg.zones) {
        const z = rg.zones[k]
        if (z && byZone[z]) byZone[z].push(c)
      } else all.push(c)
    }
    if (region.zonal) {
      const parts: Cell[] = []
      for (const [z, label] of [['floor', 'Floor'], ['wall', 'Walls'], ['rim', 'Rim']] as const) {
        const cs = pick(byZone[z], PER_GROUP)
        if (cs.length) groups.push({ id: z, label, cells: cs })
        parts.push(...cs)
      }
      void inZoneSet
      groups.push({ id: 'entire', label: 'Entire crater', cells: parts })
    } else if (all.length) groups.push({ id: 'region', label: `Within ${region.radiusKm} km`, cells: pick(all, PER_GROUP * 3) })
  }
  pinned.forEach((p, i) => groups.push({ id: `pin${i}`, label: `Pin ${i + 1}: ${pinLabel(p)}`, cells: [cell(p)] }))
  return groups
}

export interface GroupSeries {
  id: string
  label: string
  /** percentage of the group's cells with the Sun's centre-weighted disc ≥ 50% visible (for one cell: the disc fraction) */
  lit: Float32Array
  events: Events
  /** mean of lit over the window, 0..1: for a group, the average share of its area in direct sunlight */
  meanLit: number
  n: number
}

export interface Illum {
  ready: boolean
  progress: number
  track: SunTrack
  groups: GroupSeries[]
  /** Sun elevation / azimuth at the selected point */
  sun: PointSeries | null
}

/** Sunlight history of every group over the 30-day window, from the real terrain horizon of each cell. */
export function useIllum(terrain: CpuTerrain, groups: Group[], startDay: number, enabled = true): Illum {
  const cells = useMemo(() => {
    const seen = new Set<string>()
    const out: Cell[] = []
    for (const g of groups) for (const c of g.cells) {
      const k = `${c.lat},${c.lon}`
      if (!seen.has(k)) {
        seen.add(k)
        out.push(c)
      }
    }
    return out
  }, [groups])
  const { ready, progress } = useHorizons(terrain, cells, enabled && cells.length > 0)
  const track = useMemo(() => sunTrack(startDay, STEP_MS, N_STEPS), [startDay])

  const result = useMemo(() => {
    if (!ready) return { groups: [] as GroupSeries[], sun: null as PointSeries | null }
    const cache = new Map<string, PointSeries>()
    const series = (c: Cell) => {
      const k = `${c.lat},${c.lon}`
      let s = cache.get(k)
      if (!s) {
        s = pointSeries(horizonOf(terrain, c)!, c.lat, c.lon, track)
        cache.set(k, s)
      }
      return s
    }
    const out: GroupSeries[] = groups.map((g) => {
      const fr = g.cells.map((c) => series(c).frac)
      let lit: Float32Array
      if (g.cells.length === 1) lit = fr[0].map((v) => v * 100)
      else lit = litPercent(fr, track.n)
      let sum = 0
      for (let i = 0; i < lit.length; i++) sum += lit[i]
      return { id: g.id, label: g.label, lit, meanLit: sum / lit.length / 100, events: findEvents(Float32Array.from(lit, (v) => v / 100), track), n: g.cells.length }
    })
    const first = groups[0]?.cells[0]
    return { groups: out, sun: first ? series(first) : null }
  }, [ready, groups, terrain, track])

  return { ready, progress, track, groups: result.groups, sun: result.sun }
}
