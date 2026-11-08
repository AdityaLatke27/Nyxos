import { useEffect, useMemo, useState } from 'react'
import { type Zone } from '../../../analysis/crater'
import type { CpuTerrain } from '../../terrain/cpuTerrain'

/** A surface location whose sunlight history is computed from its terrain horizon. */
export interface Cell {
  lat: number
  lon: number
  hKm: number
  zone?: Zone | null
}

/** Horizon sampling: azimuth step 2.5° (0.27° sun disc is interpolated), 170 log-spaced ray steps to 650 km. */
export const HORIZON_AZ = 144
export const HORIZON_STEPS = 170

const horizons = new Map<string, Float32Array>()
const keyOf = (t: CpuTerrain, c: Cell) => `${c.lat.toFixed(5)},${c.lon.toFixed(5)}@${t.resolutionKmAt(c.lat, c.lon)}`

export function horizonOf(terrain: CpuTerrain, c: Cell): Float32Array | undefined {
  return horizons.get(keyOf(terrain, c))
}

/**
 * Computes missing horizon profiles a few at a time, yielding to the browser between cells so
 * the 3D view stays responsive. Results are cached for the session.
 */
export function useHorizons(terrain: CpuTerrain, cells: Cell[] | null, enabled: boolean) {
  const keys = useMemo(() => (cells ? cells.map((c) => keyOf(terrain, c)).join('|') : ''), [terrain, cells])
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    if (!enabled || !cells) return
    const todo = cells.filter((c) => !horizons.has(keyOf(terrain, c)))
    setDone(0)
    setTotal(todo.length)
    if (!todo.length) return
    let dead = false
    ;(async () => {
      for (let i = 0; i < todo.length; i++) {
        if (dead) return
        const c = todo[i]
        horizons.set(keyOf(terrain, c), terrain.horizonProfile(c.lat, c.lon, HORIZON_AZ, 0.002, HORIZON_STEPS))
        setDone(i + 1)
        await new Promise((r) => setTimeout(r, 0))
      }
    })()
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, keys, enabled])

  const ready = enabled && !!cells && cells.length > 0 && cells.every((c) => horizons.has(keyOf(terrain, c)))
  return { ready, done, total, progress: total ? done / total : ready ? 1 : 0 }
}
