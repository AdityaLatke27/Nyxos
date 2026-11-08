import { fmtLat, fmtLon } from '../../state/frame'
import { useSim, type RegionKind } from '../../state/store'
import type { Region } from './region'

const ZONES: [RegionKind, string][] = [
  ['whole', 'Whole crater'],
  ['floor', 'Floor'],
  ['wall', 'Walls'],
  ['rim', 'Rim'],
  ['around', 'Around point'],
]
const RADII = [1, 3, 10, 25]

/** Chooses which part of the terrain a graph analyses: a crater zone, or a disc around the clicked point. */
export default function RegionBar({ region }: { region: Region | null }) {
  const s = useSim()
  if (!region) return <span className="muted">Click a point on the Moon to analyse it.</span>
  return (
    <div className="gd-chips" role="group" aria-label="Region">
      {region.crater ? (
        <>
          <span>
            <strong>{region.crater[0]}</strong> ({region.crater[3] < 10 ? region.crater[3].toFixed(1) : Math.round(region.crater[3])} km)
          </span>
          {ZONES.map(([k, label]) => (
            <button key={k} className={`btn ${region.kind === k ? 'on' : ''}`} onClick={() => s.set({ regionKind: k })}>
              {label}
            </button>
          ))}
        </>
      ) : (
        <span>No catalogued crater here. Region radius</span>
      )}
      {region.kind === 'around' &&
        RADII.map((r) => (
          <button key={r} className={`btn ${s.regionKm === r ? 'on' : ''}`} onClick={() => s.set({ regionKm: r })}>
            {r} km
          </button>
        ))}
      {region.kind === 'around' && (
        <span>
          around {fmtLat(region.center.lat)} {fmtLon(region.center.lon)}
        </span>
      )}
    </div>
  )
}
