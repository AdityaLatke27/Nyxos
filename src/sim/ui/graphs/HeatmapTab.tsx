import { useEffect, useMemo, useRef, useState } from 'react'
import { interpolateGreatCircle, dirFromLatLon, latLonFromDir, type LatLon } from '../../../analysis/geo'
import type { Feature } from '../../data/types'
import { fmtLat, fmtLon, fmtUtc } from '../../state/frame'
import { useSim, WINDOW_HOURS } from '../../state/store'
import type { CpuTerrain } from '../../terrain/cpuTerrain'
import { COLORS, useChartCanvas } from './chartUtils'
import { Chip, ExportButton, FRAME_NOTE, coordFile, downloadCsv } from './exportUtils'
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
const STOPS = [[16, 22, 52], [120, 60, 110], [236, 120, 70], [255, 226, 120]]
function shade(p: number) {
  const t = Math.max(0, Math.min(1, p / 100))
  const x = t * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const f = x - i
  const a = STOPS[i]
  const b = STOPS[i + 1]
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`
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
  const [sorted, setSorted] = useState(false)

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
      regionDisc: mode === 'groups' && region ? { center: region.center, radiusKm: region.zonal ? region.radiusKm * 1.3 : region.radiusKm } : null,
      transectLine: mode === 'line' ? line : null,
    })
    return () => useSim.getState().set({ regionDisc: null, transectLine: null })
  }, [mode, region, line])

  const labelled = useMemo(
    () =>
      illum.groups.map((r) => {
        const g = groups.find((x) => x.id === r.id)
        const single = g && g.cells.length === 1 ? g.cells[0] : null
        const hasCoord = /°/.test(r.label)
        return { ...r, label: single && !hasCoord ? `${r.label} ${fmtLat(single.lat)} ${fmtLon(single.lon)}` : `${r.label}${g && g.cells.length > 1 ? ` (${g.cells.length} cells)` : ''}` }
      }),
    [illum.groups, groups],
  )
  const rows = useMemo(() => (sorted ? [...labelled].sort((a, b) => b.meanLit - a.meanLit) : labelled), [labelled, sorted])
  const N = illum.track.n
  const PAD = { l: 250, r: 10, t: 6, b: 20 }
  const fracNow = Math.max(0, Math.min(1, offsetHours / WINDOW_HOURS))

  // The coloured grid, row names and date ticks only change with the data or the canvas size; the live clock line and
  // the hover box move constantly. The static layer is painted once into an off-screen bitmap and copied back 1:1.
  const layer = useRef<{ rows: unknown; w: number; h: number; dpr: number; N: number; bmp: HTMLCanvasElement } | null>(null)
  const ref = useChartCanvas(
    (g, W, H) => {
      if (!rows.length) return
      const x = timeX(W, PAD.l, PAD.r)
      const dpr = g.getTransform().a
      const L = layer.current
      if (L && L.rows === rows && L.w === W && L.h === H && L.dpr === dpr && L.N === N) {
        g.save()
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.drawImage(L.bmp, 0, 0)
        g.restore()
        drawOverlay(g, W, H, x)
        return
      }
      const bmp = document.createElement('canvas')
      bmp.width = Math.round(W * dpr)
      bmp.height = Math.round(H * dpr)
      const real = g
      g = bmp.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
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
        const pct = Math.round(r.meanLit * 100)
        const name = r.label.length > 34 ? r.label.slice(0, 33) + '…' : r.label
        g.fillText(`${name} · ${pct}%`, PAD.l - 6, y + rh / 2 + 3)
      })
      g.textAlign = 'center'
      for (let d = 0; d <= 30; d += 5) {
        const t = new Date(illum.track.startMs + d * 86400000)
        g.fillStyle = COLORS.text
        g.fillText(`${t.getUTCDate()}/${t.getUTCMonth() + 1}`, x(d / 30), H - 6)
      }
      layer.current = { rows, w: W, h: H, dpr, N, bmp }
      real.save()
      real.setTransform(1, 0, 0, 1, 0, 0)
      real.drawImage(bmp, 0, 0)
      real.restore()
      drawOverlay(real, W, H, x)
    },
    [rows, hover, fracNow, N],
  )
  function drawOverlay(g: CanvasRenderingContext2D, W: number, H: number, x: (f: number) => number) {
    const rh = (H - PAD.t - PAD.b) / rows.length
    g.strokeStyle = '#fff'
    g.beginPath()
    g.moveTo(x(fracNow), PAD.t)
    g.lineTo(x(fracNow), H - PAD.b)
    g.stroke()
    if (hover) {
      g.strokeStyle = COLORS.cursor
      g.strokeRect(PAD.l, PAD.t + hover.row * rh, W - PAD.l - PAD.r, rh - 1)
    }
  }

  const locate = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const f = (e.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r)
    const i = Math.max(0, Math.min(N - 1, Math.round(f * (N - 1))))
    const rh = (r.height - PAD.t - PAD.b) / Math.max(1, rows.length)
    const row = Math.max(0, Math.min(rows.length - 1, Math.floor((e.clientY - r.top - PAD.t) / rh)))
    return { i, row }
  }
  const doExport = () => {
    if (!rows.length) return
    downloadCsv(
      `nyxos_illumination_${point ? coordFile(point.lat, point.lon) : 'heatmap'}.csv`,
      [
        `NYXOS illumination heatmap, 30 days from ${new Date(illum.track.startMs).toISOString()}, 30-minute steps`,
        'lit_pct: one location = % of the Sun disc (0.2666 deg radius) above the DEM horizon; a group = % of its sampled cells with at least half the disc visible. Direct sunlight only.',
        'Row summaries: ' + rows.map((r) => `${r.label} = ${(r.meanLit * 100).toFixed(1)}% of area-time lit`).join('; '),
        FRAME_NOTE,
      ],
      ['time_utc', ...rows.map((r) => `lit_pct[${r.label}]`)],
      Array.from({ length: N }, (_, i) => [new Date(illum.track.startMs + i * illum.track.stepMs).toISOString(), ...rows.map((r) => +r.lit[i].toFixed(2))]),
    )
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
        <button className={`btn ${sorted ? 'on' : ''}`} onClick={() => setSorted((v) => !v)} title="Order rows from most to least illuminated">
          Sort by illumination
        </button>
        <div className="gd-legend" aria-label="Colour scale: 0 to 100 percent lit">
          <span>0%</span>
          <i />
          <span>100% lit</span>
        </div>
        <ExportButton disabled={!rows.length} onClick={doExport} />
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
              setHover((prev) => (prev && prev.i === h.i && prev.row === h.row ? prev : h))
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
              <>Dark blue = shadow, bright = full sunlight. Click or drag to move the 3D view to that time. The percentage after each name is the average share of that row's area in sunlight over the 30 days.</>
            )}
          </div>
          <p className="gd-stats">
            Each row is computed from the terrain horizon at its location(s); zone rows show the share of the sampled cells lit at each moment. Direct sunlight only (no earthshine or scattering).{' '}
            <Chip source="modelled" />{' '}
            30 days from the start date of the time bar, 30-minute steps, UTC. {FRAME_NOTE}
          </p>
        </>
      )}
    </div>
  )
}
