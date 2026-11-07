import { useEffect, useMemo, useState } from 'react'
import { analyzeCrater, ZONE_LIMITS, type CraterGeometry } from '../../analysis/crater'
import { craterAt, searchCraters } from '../../analysis/craterLookup'
import { greatCircleKm } from '../../analysis/geo'
import { SOURCE_EXPLAIN, SOURCE_SHORT, type Source } from '../../analysis/provenance'
import type { Feature } from '../data/types'
import { fmtLat, fmtLon } from '../state/frame'
import { useSim } from '../state/store'
import type { CpuTerrain } from '../terrain/cpuTerrain'

interface Props {
  features: Feature[]
  terrain: CpuTerrain
  point: { lat: number; lon: number } | null
  /** changes when a higher-resolution site patch finishes loading, so the numbers are redone */
  hasTerrain: boolean
}

const fmtRes = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`)
const fmtM = (m: number) => `${Math.round(m).toLocaleString('en-US')} m`
const fmtKm = (km: number) => `${km < 10 ? km.toFixed(2) : km.toFixed(1)} km`

function Chip({ source }: { source: Source }) {
  return (
    <abbr className={`src src-${source}`} title={SOURCE_EXPLAIN[source]}>
      {SOURCE_SHORT[source]}
    </abbr>
  )
}

function Row({ label, value, source }: { label: string; value: string; source: Source }) {
  return (
    <div className="ov-row">
      <span>{label}</span>
      <span className="ov-val">{value}</span>
      <Chip source={source} />
    </div>
  )
}

export default function CraterOverview({ features, terrain, point, hasTerrain }: Props) {
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<Feature | null>(null)
  const [result, setResult] = useState<{ crater: Feature; geometry: CraterGeometry } | null>(null)

  const matches = useMemo(() => searchCraters(features, query), [features, query])

  // A crater picked from the search stays in force while the selected point is at its centre;
  // otherwise the smallest catalogued crater containing the selected point is used.
  const crater = useMemo(() => {
    if (!point) return null
    if (chosen && greatCircleKm(point, { lat: chosen[1], lon: chosen[2] }) < 0.5) return chosen
    return craterAt(features, point.lat, point.lon)
  }, [features, point, chosen])

  useEffect(() => {
    if (!crater) return
    const id = setTimeout(() => {
      const geometry = analyzeCrater(terrain, { lat: crater[1], lon: crater[2], diameterKm: crater[3] })
      setResult({ crater, geometry })
    }, 60)
    return () => clearTimeout(id)
  }, [terrain, crater, hasTerrain])

  const pickCrater = (f: Feature) => {
    setChosen(f)
    setQuery('')
    useSim.getState().pick({ lat: f[1], lon: f[2] })
  }

  const ready = crater && result && result.crater === crater ? result.geometry : null
  const zone = (name: string) => (ready?.status === 'ok' ? ready.zones.find((z) => z.zone === name) : undefined)

  return (
    <section className="crater-ov">
      <h2>Crater overview</h2>
      <input
        type="search"
        className="ov-search"
        placeholder="Search a crater, e.g. Shackleton"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search craters by name"
      />
      {matches.length > 0 && (
        <ul className="ov-matches">
          {matches.map((f) => (
            <li key={`${f[0]}${f[1]}${f[2]}`}>
              <button className="btn" onClick={() => pickCrater(f)}>
                {f[0]} <em>{fmtKm(f[3])}</em>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!crater && (
        <p className="note">
          No catalogued crater of 2 km or more contains this point. Search above, or click inside a crater on the map.
        </p>
      )}

      {crater && (
        <>
          <p className="ov-name">
            <strong>{crater[0]}</strong>
          </p>
          <Row label="Centre" value={`${fmtLat(crater[1])} ${fmtLon(crater[2])}`} source="catalogue" />
          <Row label="Diameter" value={fmtKm(crater[3])} source="catalogue" />

          {!ready && <p className="muted">Measuring from the elevation model…</p>}
          {ready?.status === 'unavailable' && (
            <p className="note">
              <Chip source="unavailable" /> Depth and terrain not measured: {ready.reason}.
            </p>
          )}
          {ready?.status === 'ok' && (
            <>
              <Row label="Depth" value={fmtKm(ready.depthM / 1000)} source="dem" />
              <Row label="Rim elevation" value={fmtM(ready.rimElevM)} source="dem" />
              <Row label="Floor elevation" value={fmtM(ready.floorElevM)} source="dem" />
              <Row label="Depth / diameter" value={ready.depthToDiameter.toFixed(3)} source="dem" />
              <Row label="Rim irregularity" value={`± ${Math.round(ready.rimSpreadM)} m`} source="dem" />
              <Row label="Floor slope (mean)" value={`${zone('floor')?.slopeDeg?.mean.toFixed(1) ?? '–'}°`} source="dem" />
              <Row label="Wall slope (mean)" value={`${zone('wall')?.slopeDeg?.mean.toFixed(1) ?? '–'}°`} source="dem" />
              <Row label="Wall slope (95th pct)" value={`${zone('wall')?.slopeDeg?.p95.toFixed(1) ?? '–'}°`} source="dem" />
              <Row label="Rim slope (mean)" value={`${zone('rim')?.slopeDeg?.mean.toFixed(1) ?? '–'}°`} source="dem" />
              <Row label="Ellipticity, axes" value="not loaded" source="unavailable" />
              <Row label="Surface roughness" value="not loaded" source="unavailable" />
              <p className="note">
                LOLA DEM, {ready.grid.demResolutionKm != null ? fmtRes(ready.grid.demResolutionKm) : 'unknown'} cells;
                analysed on a {fmtRes(ready.grid.cellKm)} grid. Heights are above the 1737.4 km reference sphere. Floor =
                inner {Math.round(ZONE_LIMITS.floorCore * 100)}% of the radius (median); rim = median of the highest
                point in each of 36 sectors. Ellipticity needs the Robbins catalogue and roughness a LOLA roughness
                product, neither of which is loaded.
              </p>
            </>
          )}
        </>
      )}
    </section>
  )
}
