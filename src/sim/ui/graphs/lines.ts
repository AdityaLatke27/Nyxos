import { useMemo } from 'react'
import { offsetLatLon, type LatLon } from '../../../analysis/geo'
import { useSim } from '../../state/store'

/** The cross-section line as the user has defined it (a bearing through the point, or two clicks). */
export function useProfileLine(point: LatLon | null): { a: LatLon; b: LatLon } | null {
  const mode = useSim((s) => s.profileMode)
  const lineA = useSim((s) => s.lineA)
  const lineB = useSim((s) => s.lineB)
  const bearing = useSim((s) => s.bearingDeg)
  const half = useSim((s) => s.halfLengthKm)
  return useMemo(() => {
    if (mode === 'points') return lineA && lineB ? { a: lineA, b: lineB } : null
    if (!point) return null
    const th = (bearing * Math.PI) / 180
    return {
      a: offsetLatLon(point, -half * Math.sin(th), -half * Math.cos(th)),
      b: offsetLatLon(point, half * Math.sin(th), half * Math.cos(th)),
    }
  }, [mode, lineA, lineB, point, bearing, half])
}
