import { useEffect, useMemo, useState } from 'react'
import { histogram, summarize, type Histogram, type Summary } from '../../../analysis/stats'
import type { LatLon } from '../../../analysis/geo'
import { SOURCE_EXPLAIN } from '../../../analysis/provenance'
import type { Feature } from '../../data/types'
import { useSim } from '../../state/store'
import type { CpuTerrain } from '../../terrain/cpuTerrain'
import { COLORS, fmtTick, niceTicks, useChartCanvas } from './chartUtils'
import RegionBar from './RegionBar'
import { inZoneSet, useRegion, useRegionGrid } from './region'

interface Props {
  terrain: CpuTerrain
  features: Feature[]
  point: LatLon | null
  hasTerrain: boolean
}

function Hist({ h, unit, color, mean, median, onBin, bin }: { h: Histogram; unit: string; color: string; mean: number; median: number; onBin: (i: number | null) => void; bin: number | null }) {
  const PAD = { l: 44, r: 10, t: 10, b: 28 }
  const ref = useChartCanvas(
    (g, W, H) => {
      if (!h.counts.length) return
      const lo = h.edges[0]
      const hi = h.edges[h.edges.length - 1]
      const cmax = Math.max(...h.counts, 1)
      const xs = (v: number) => PAD.l + ((v - lo) / (hi - lo)) * (W - PAD.l - PAD.r)
      const ys = (c: number) => H - PAD.b - (c / cmax) * (H - PAD.b - PAD.t)
      g.font = '10px "Space Grotesk", sans-serif'
      g.fillStyle = COLORS.text
      g.strokeStyle = COLORS.grid
      g.textAlign = 'right'
      for (const c of niceTicks(0, cmax, 4)) {
        g.beginPath()
        g.moveTo(PAD.l, ys(c))
        g.lineTo(W - PAD.r, ys(c))
        g.stroke()
        g.fillText(fmtTick(c), PAD.l - 5, ys(c) + 3)
      }
      g.textAlign = 'center'
      for (const v of niceTicks(lo, hi, 5)) g.fillText(fmtTick(v), xs(v), H - PAD.b + 13)
      g.fillText(unit, (PAD.l + W - PAD.r) / 2, H - 3)
      g.save()
      g.translate(10, (PAD.t + H - PAD.b) / 2)
      g.rotate(-Math.PI / 2)
      g.fillText('samples', 0, 0)
      g.restore()
      h.counts.forEach((c, i) => {
        g.fillStyle = bin === i ? '#fff' : color
        const x0 = xs(h.edges[i])
        g.fillRect(x0 + 0.5, ys(c), Math.max(1, xs(h.edges[i + 1]) - x0 - 1), H - PAD.b - ys(c))
      })
      for (const [v, dash, label] of [[mean, [], 'mean'], [median, [4, 3], 'median']] as const) {
        if (v < lo || v > hi) continue
        g.strokeStyle = COLORS.cursor
        g.setLineDash([...dash])
        g.beginPath()
        g.moveTo(xs(v), PAD.t)
        g.lineTo(xs(v), H - PAD.b)
        g.stroke()
        g.setLineDash([])
        g.fillStyle = COLORS.text
        g.textAlign = 'left'
        g.fillText(label, xs(v) + 3, PAD.t + (label === 'mean' ? 9 : 20))
      }
      g.strokeStyle = COLORS.axis
      g.beginPath()
      g.moveTo(PAD.l, H - PAD.b)
      g.lineTo(W - PAD.r, H - PAD.b)
      g.stroke()
    },
    [h, bin, color, mean, median, unit],
  )
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const f = (e.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r)
    onBin(f >= 0 && f <= 1 ? Math.min(h.counts.length - 1, Math.floor(f * h.counts.length)) : null)
  }
  return <canvas ref={ref} className="gd-canvas" onPointerMove={move} onPointerLeave={() => onBin(null)} />
}

const f1 = (v: number, d = 1) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })

function StatRow({ label, unit, s, d }: { label: string; unit: string; s: Summary | null; d: number }) {
  if (!s) return null
  return (
    <tr>
      <th>
        {label} ({unit})
      </th>
      <td>{s.n.toLocaleString('en-US')}</td>
      <td>{f1(s.min, d)}</td>
      <td>{f1(s.p5, d)}</td>
      <td>{f1(s.median, d)}</td>
      <td>{f1(s.mean, d)}</td>
      <td>{f1(s.p95, d)}</td>
      <td>{f1(s.max, d)}</td>
      <td>{f1(s.std, d)}</td>
    </tr>
  )
}

/** Graph 2: elevation and slope distributions of a crater zone, or of any area the user clicks. */
export default function DistributionTab({ terrain, features, point, hasTerrain }: Props) {
  const region = useRegion(features, point)
  const rg = useRegionGrid(terrain, region, hasTerrain)
  const [binE, setBinE] = useState<number | null>(null)
  const [binS, setBinS] = useState<number | null>(null)

  useEffect(() => {
    useSim.getState().set({ regionDisc: region ? { center: region.center, radiusKm: region.crater ? region.radiusKm * 1.3 : region.radiusKm } : null })
    return () => useSim.getState().set({ regionDisc: null })
  }, [region])

  const data = useMemo(() => {
    if (!rg || !region) return null
    const elev: number[] = []
    const slope: number[] = []
    for (let k = 0; k < rg.grid.n; k++) {
      if (rg.zones && !inZoneSet(region.kind, rg.zones[k])) continue
      elev.push(rg.grid.elevM[k])
      slope.push(rg.grid.slopeDeg[k])
    }
    if (!elev.length) return null
    return { elev, slope, se: summarize(elev)!, ss: summarize(slope)!, he: histogram(elev, 32), hs: histogram(slope, 30, [0, Math.max(10, Math.ceil(Math.max(...slope) / 5) * 5)]) }
  }, [rg, region])

  const g = rg?.grid
  const res = g?.demResolutionKm
  const fmtRes = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`)
  const binLabel = (h: Histogram, i: number | null, u: string) => (i == null ? '' : `${f1(h.edges[i], 1)} to ${f1(h.edges[i + 1], 1)} ${u}: ${h.counts[i]} samples (${((100 * h.counts[i]) / h.n).toFixed(1)}%)`)

  return (
    <div className="gd-body">
      <div className="gd-controls">
        <RegionBar region={region} />
      </div>
      {data && g ? (
        <>
          <div className="gd-two">
            <div className="gd-half">
              <h3>Elevation</h3>
              <Hist h={data.he} unit="elevation (m above 1737.4 km sphere)" color={COLORS.line} mean={data.se.mean} median={data.se.median} onBin={setBinE} bin={binE} />
              <div className="gd-readout">{binLabel(data.he, binE, 'm') || ' '}</div>
            </div>
            <div className="gd-half">
              <h3>Slope</h3>
              <Hist h={data.hs} unit="slope (°, from horizontal)" color={COLORS.warm} mean={data.ss.mean} median={data.ss.median} onBin={setBinS} bin={binS} />
              <div className="gd-readout">{binLabel(data.hs, binS, '°') || ' '}</div>
            </div>
          </div>
          <table className="gd-table">
            <thead>
              <tr>
                <th />
                <th>n</th>
                <th>min</th>
                <th>5%</th>
                <th>median</th>
                <th>mean</th>
                <th>95%</th>
                <th>max</th>
                <th>std</th>
              </tr>
            </thead>
            <tbody>
              <StatRow label="Elevation" unit="m" s={data.se} d={0} />
              <StatRow label="Slope" unit="°" s={data.ss} d={1} />
            </tbody>
          </table>
          <p className="gd-stats">
            <abbr className="src src-dem" title={SOURCE_EXPLAIN.dem}>
              DEM
            </abbr>{' '}
            LOLA, {res != null ? fmtRes(res) : 'unknown'} cells; sampled on a {fmtRes(g.cellKm)} grid, {data.elev.length.toLocaleString('en-US')} samples ≈{' '}
            {(data.elev.length * g.cellAreaKm2).toFixed(1)} km². Slope from neighbouring samples one grid cell apart, so it is smoothed at that scale.{' '}
            <abbr className="src src-unavailable" title={SOURCE_EXPLAIN.unavailable}>
              N/A
            </abbr>{' '}
            Roughness: no LOLA roughness product is loaded.{rg?.note ? ' ' + rg.note : ''}
          </p>
        </>
      ) : (
        <p className="note gd-empty">{point ? 'No elevation data for this area.' : 'Click a point on the Moon to see its terrain distribution.'}</p>
      )}
    </div>
  )
}
