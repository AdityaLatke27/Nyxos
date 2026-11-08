import { useEffect, useMemo, useState } from 'react'
import { interpolateGreatCircle, dirFromLatLon, latLonFromDir, type LatLon } from '../../../analysis/geo'
import { SOURCE_EXPLAIN } from '../../../analysis/provenance'
import type { Feature } from '../../data/types'
import { fmtLat, fmtLon, fmtUtc } from '../../state/frame'
import { useSim, WINDOW_HOURS } from '../../state/store'
import type { CpuTerrain } from '../../terrain/cpuTerrain'
import { COLORS, useChartCanvas } from './chartUtils'
import { buildGroups, useIllum, type Group } from './illumData'
import { useProfileLine } from './lines'
import RegionBar from './RegionBar'
import { useRegion, useRegionGrid } from './region'
import { PinBar, Progress, setSimTime, timeX } from './TimelineTab'

interface Props {
  terrain: CpuTerrain
  features: Feature[]
  point: LatLon | null
  hasTerrain: boolean
}

const LINE_ROWS = 12

/** dark navy (shadow) to warm white (full sunlight) */
function shade(p: number) {
  const t = Math.max(0, Math.min(1, p / 100))
  const stops = [[16, 22, 52], [120, 60, 110], [236, 120, 70], [255, 226, 120]]
  const x = t * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const f = x - i
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/** Graph 4: when each place is lit, across 30 days — region zones, pinned points, or a line of points. */
export default function HeatmapTab({ terrain, features, point, hasTerrain }: Props) {
  const mode = useSim((s) => s.heatMode)
  const set = useSim((s) => s.set)
  const pinned = useSim((s) => s.pinned)
  const startDay = useSim((s) => s.startDay)
  const offsetHours = useSim((s) => s.offsetHours)
  const region = useRegion(features, point)
  const rg = useRegionGrid(terrain, region, hasTerrain)
  const line = useProfileLine(point)
  const [hover, setHover] = useState<{ i: number; row: number } | null>(null)
  const [drag, setDrag] = useState(false)

  const groups = useMemo<Group[]>(() => {
    if (mode === 'line') {
      if (!line) return []
      const da = dirFromLatLon(line.a.lat, line.a.lon)
      const db = dirFromLatLon(line.b.lat, line.b.lon)
      return Array.from({ length: LINE_ROWS }, (_, k) => {
        const [lat, lon] = latLonFromDir(interpolateGreatCircle(da, db, k / (LINE_ROWS - 1)))
        return { id: `l${k}`, label: `${k === 0 ? 'A ' : k === LINE_ROWS - 1 ? 'B ' : ''}${fmtLat(lat)} ${fmtLon(lon)}`, cells: [{ lat, lon, hKm: 0 }] }
      })
    }
    return buildGroups(point, region, rg, pinned)
  }, [mode, line, point, region, rg, pinned])

  const illum = useIllum(terrain, groups, startDay)

  useEffect(() => {
    useSim.getState().set({
      regionDisc: mode === 'groups' && region ? { center: region.center, radiusKm: region.crater ? region.radiusKm * 1.3 : region.radiusKm } : null,
      transectLine: mode === 'line' ? line : null,
    })
    return () => useSim.getState().set({ regionDisc: null, transectLine: null })
  }, [mode, region, line])

  const rows = illum.groups
  const N = illum.track.n
  const PAD = { l: 150, r: 10, t: 6, b: 20 }
  const fracNow = Math.max(0, Math.min(1, offsetHours / WINDOW_HOURS))

  const ref = useChartCanvas(
    (g, W, H) => {
      if (!rows.length) return
      const x = timeX(W, PAD.l, PAD.r)
      const rh = (H - PAD.t - PAD.b) / rows.length
      g.font = '10px "Space Grotesk", sans-serif'
      const colW = (W - PAD.l - PAD.r) / (N - 1)
      rows.forEach((r, ri) => {
        const y = PAD.t + ri * rh
        for (let i = 0; i < N; i++) {
          g.fillStyle = shade(r.lit[i])
          g.fillRect(x(i / (N - 1)) - colW / 2, y, colW + 0.6, rh - 1)
        }
        g.fillStyle = COLORS.text
        g.textAlign = 'right'
        const pct = Math.round(r.events.litFraction * 100)
        const name = r.label.length > 22 ? r.label.slice(0, 21) + '…' : r.label
        g.fillText(`${name} · ${pct}%`, PAD.l - 6, y + rh / 2 + 3)
      })
      g.textAlign = 'center'
      for (let d = 0; d <= 30; d += 5) {
        const t = new Date(illum.track.startMs + d * 86400000)
        g.fillStyle = COLORS.text
        g.fillText(`${t.getUTCDate()}/${t.getUTCMonth() + 1}`, x(d / 30), H - 6)
      }
      g.strokeStyle = '#fff'
      g.beginPath()
      g.moveTo(x(fracNow), PAD.t)
      g.lineTo(x(fracNow), H - PAD.b)
      g.stroke()
      if (hover) {
        g.strokeStyle = COLORS.cursor
        g.strokeRect(PAD.l, PAD.t + hover.row * rh, W - PAD.l - PAD.r, rh - 1)
      }
    },
    [rows, hover, fracNow, N],
  )

  const locate = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const f = (e.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r)
    const i = Math.max(0, Math.min(N - 1, Math.round(f * (N - 1))))
    const rh = (r.height - PAD.t - PAD.b) / Math.max(1, rows.length)
    const row = Math.max(0, Math.min(rows.length - 1, Math.floor((e.clientY - r.top - PAD.t) / rh)))
    return { i, row }
  }
  const hv = hover && rows[hover.row]
  const count = groups.reduce((a, g) => a + g.cells.length, 0)

  return (
    <div className="gd-body">
      <div className="gd-controls">
        <div className="seg">
          <button className={`btn ${mode === 'groups' ? 'on' : ''}`} onClick={() => set({ heatMode: 'groups' })}>
            Zones and pins
          </button>
          <button className={`btn ${mode === 'line' ? 'on' : ''}`} onClick={() => set({ heatMode: 'line' })}>
            Along the cross-section line
          </button>
        </div>
        {mode === 'groups' ? (
          <>
            <RegionBar region={region} />
            <PinBar point={point} />
          </>
        ) : (
          <span className="muted">Uses the line from the Cross-section tab (direction and reach set there), {LINE_ROWS} points from A to B.</span>
        )}
      </div>
      {!point ? (
        <p className="note gd-empty">Click a point on the Moon to compare its illumination through time.</p>
      ) : !illum.ready || !rows.length ? (
        <Progress illum={illum} count={count} />
      ) : (
        <>
          <canvas
            ref={ref}
            className="gd-canvas"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              setDrag(true)
              const h = locate(e)
              setSimTime(illum.track.startMs + h.i * illum.track.stepMs, startDay)
            }}
            onPointerMove={(e) => {
              const h = locate(e)
              setHover(h)
              if (drag) setSimTime(illum.track.startMs + h.i * illum.track.stepMs, startDay)
            }}
            onPointerUp={() => setDrag(false)}
            onPointerLeave={() => setHover(null)}
          />
          <div className="gd-readout">
            {hv && hover ? (
              <>
                <strong>{hv.label}</strong> · {fmtUtc(illum.track.startMs + hover.i * illum.track.stepMs)} · <strong>{hv.lit[hover.i].toFixed(0)}% lit</strong>
              </>
            ) : (
              <>Dark blue = shadow, bright = full sunlight. Click or drag to move the 3D view to that time. The percentage after each name is how much of the 30 days it is lit.</>
            )}
          </div>
          <p className="gd-stats">
            Each row is computed from the terrain horizon at its location(s); zone rows show the share of the sampled cells lit at each moment. Direct sunlight only (no earthshine or scattering).{' '}
            <abbr className="src src-modelled" title={SOURCE_EXPLAIN.modelled}>
              MODEL
            </abbr>{' '}
            30 days from the start date of the time bar, 30-minute steps.
          </p>
        </>
      )}
    </div>
  )
}
