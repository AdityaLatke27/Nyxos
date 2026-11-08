import { useEffect, useMemo, useState } from 'react'
import type { LatLon } from '../../../analysis/geo'
import { SOURCE_EXPLAIN } from '../../../analysis/provenance'
import type { Feature } from '../../data/types'
import { fmtDuration, fmtUtc } from '../../state/frame'
import { useSim, WINDOW_HOURS } from '../../state/store'
import type { CpuTerrain } from '../../terrain/cpuTerrain'
import { COLORS, fmtTick, niceTicks, useChartCanvas } from './chartUtils'
import { buildGroups, useIllum, type Illum } from './illumData'
import RegionBar from './RegionBar'
import { useRegion, useRegionGrid } from './region'

interface Props {
  terrain: CpuTerrain
  features: Feature[]
  point: LatLon | null
  hasTerrain: boolean
}

const DAY_MS = 86400000
export const MAX_PINS = 6

export function PinBar({ point }: { point: LatLon | null }) {
  const pinned = useSim((s) => s.pinned)
  const set = useSim((s) => s.set)
  return (
    <div className="gd-chips">
      <button className="btn" disabled={!point || pinned.length >= MAX_PINS} onClick={() => point && set({ pinned: [...pinned, { lat: point.lat, lon: point.lon }] })}>
        Pin this point ({pinned.length}/{MAX_PINS})
      </button>
      {pinned.length > 0 && (
        <button className="btn" onClick={() => set({ pinned: [] })}>
          Clear pins
        </button>
      )}
    </div>
  )
}

/** Shared by the timeline and heatmap: group / region / pin setup and the computed series. */
export function useIllumSetup(terrain: CpuTerrain, features: Feature[], point: LatLon | null, hasTerrain: boolean) {
  const region = useRegion(features, point)
  const rg = useRegionGrid(terrain, region, hasTerrain)
  const pinned = useSim((s) => s.pinned)
  const startDay = useSim((s) => s.startDay)
  const groups = useMemo(() => buildGroups(point, region, rg, pinned), [point, region, rg, pinned])
  const illum = useIllum(terrain, groups, startDay)
  useEffect(() => {
    useSim.getState().set({ regionDisc: region ? { center: region.center, radiusKm: region.crater ? region.radiusKm * 1.3 : region.radiusKm } : null })
    return () => useSim.getState().set({ regionDisc: null })
  }, [region])
  return { region, rg, groups, illum, startDay }
}

export function Progress({ illum, count }: { illum: Illum; count: number }) {
  return (
    <p className="note gd-empty">
      Tracing the Sun against the terrain horizon at {count} locations… {Math.round(illum.progress * 100)}%
    </p>
  )
}

/** Time-axis setup shared by the time charts: x from window start to end. */
export function timeX(W: number, padL: number, padR: number) {
  return (frac: number) => padL + frac * (W - padL - padR)
}

export function setSimTime(ms: number, startDay: number) {
  useSim.getState().setOffsetHours((ms - startDay) / 3.6e6)
}

/** Graph 3: sunlight and shadow through time at the clicked point and its surroundings. */
export default function TimelineTab({ terrain, features, point, hasTerrain }: Props) {
  const { region, groups, illum, startDay } = useIllumSetup(terrain, features, point, hasTerrain)
  const gid = useSim((s) => s.timelineGroup)
  const offsetHours = useSim((s) => s.offsetHours)
  const set = useSim((s) => s.set)
  const [hover, setHover] = useState<number | null>(null)

  const cur = illum.groups.find((g) => g.id === gid) ?? illum.groups[0]
  const sun = illum.sun
  const N = illum.track.n
  const PAD = { l: 44, r: 12, t: 8, b: 20 }
  const fracNow = Math.max(0, Math.min(1, offsetHours / WINDOW_HOURS))

  const ref = useChartCanvas(
    (g, W, H) => {
      if (!cur || !sun) return
      const x = timeX(W, PAD.l, PAD.r)
      const aTop = PAD.t
      const aBot = Math.round(H * 0.5)
      const eTop = aBot + 14
      const eBot = H - PAD.b
      g.font = '10px "Space Grotesk", sans-serif'
      // long darkness (>= 24 h) shading across both panels
      g.fillStyle = 'rgba(255,120,140,0.10)'
      for (const d of cur.events.dark) {
        if (d.endMs - d.startMs < DAY_MS) continue
        const a = x((d.startMs - illum.track.startMs) / (WINDOW_HOURS * 3.6e6))
        const b = x((d.endMs - illum.track.startMs) / (WINDOW_HOURS * 3.6e6))
        g.fillRect(a, aTop, b - a, eBot - aTop)
      }
      // day ticks
      g.fillStyle = COLORS.text
      g.strokeStyle = COLORS.grid
      g.textAlign = 'center'
      for (let d = 0; d <= 30; d += 5) {
        const px = x(d / 30)
        g.beginPath()
        g.moveTo(px, aTop)
        g.lineTo(px, eBot)
        g.stroke()
        const t = new Date(illum.track.startMs + d * DAY_MS)
        g.fillText(`${t.getUTCDate()}/${t.getUTCMonth() + 1}`, px, H - 6)
      }
      // illuminated / shadowed %
      const ya = (v: number) => aBot - (v / 100) * (aBot - aTop)
      g.textAlign = 'right'
      for (const v of [0, 50, 100]) {
        g.fillStyle = COLORS.text
        g.fillText(`${v}%`, PAD.l - 5, ya(v) + 3)
        g.strokeStyle = COLORS.grid
        g.beginPath()
        g.moveTo(PAD.l, ya(v))
        g.lineTo(W - PAD.r, ya(v))
        g.stroke()
      }
      g.fillStyle = 'rgba(40,52,84,0.75)'
      g.fillRect(PAD.l, aTop, W - PAD.l - PAD.r, aBot - aTop)
      g.fillStyle = 'rgba(255,196,110,0.85)'
      g.beginPath()
      g.moveTo(x(0), aBot)
      for (let i = 0; i < N; i++) g.lineTo(x(i / (N - 1)), ya(cur.lit[i]))
      g.lineTo(x(1), aBot)
      g.closePath()
      g.fill()
      // sunrise (up) and sunset (down) markers
      for (const [list, up] of [[cur.events.sunrises, true], [cur.events.sunsets, false]] as const) {
        g.fillStyle = up ? '#ffe9a8' : '#ff8a9b'
        for (const t of list) {
          const px = x((t - illum.track.startMs) / (WINDOW_HOURS * 3.6e6))
          g.beginPath()
          const y0 = aBot + 3
          if (up) {
            g.moveTo(px, y0)
            g.lineTo(px - 3, y0 + 6)
            g.lineTo(px + 3, y0 + 6)
          } else {
            g.moveTo(px, y0 + 6)
            g.lineTo(px - 3, y0)
            g.lineTo(px + 3, y0)
          }
          g.fill()
        }
      }
      // solar elevation and azimuth (azimuth faint, 0-360 on the same band)
      let emin = Infinity
      let emax = -Infinity
      for (let i = 0; i < N; i++) {
        emin = Math.min(emin, sun.sunElev[i])
        emax = Math.max(emax, sun.sunElev[i])
      }
      emin = Math.min(emin, 0)
      emax = Math.max(emax, 1)
      const ye = (v: number) => eBot - ((v - emin) / (emax - emin)) * (eBot - eTop)
      g.textAlign = 'right'
      g.fillStyle = COLORS.text
      for (const v of niceTicks(emin, emax, 3)) g.fillText(`${fmtTick(v)}°`, PAD.l - 5, ye(v) + 3)
      g.strokeStyle = COLORS.axis
      g.beginPath()
      g.moveTo(PAD.l, ye(0))
      g.lineTo(W - PAD.r, ye(0))
      g.stroke()
      g.strokeStyle = 'rgba(127,224,176,0.35)'
      g.lineWidth = 1
      g.beginPath()
      for (let i = 0; i < N; i++) {
        const y = eBot - (sun.sunAz[i] / 360) * (eBot - eTop)
        if (i === 0 || Math.abs(sun.sunAz[i] - sun.sunAz[i - 1]) > 180) g.moveTo(x(i / (N - 1)), y)
        else g.lineTo(x(i / (N - 1)), y)
      }
      g.stroke()
      g.strokeStyle = COLORS.line
      g.lineWidth = 1.6
      g.beginPath()
      for (let i = 0; i < N; i++) (i ? g.lineTo : g.moveTo).call(g, x(i / (N - 1)), ye(sun.sunElev[i]))
      g.stroke()
      g.lineWidth = 1
      g.fillStyle = COLORS.text
      g.textAlign = 'left'
      g.fillText('illuminated % (shaded = dark)', PAD.l + 4, aTop + 10)
      g.fillStyle = COLORS.line
      g.fillText('Sun elevation', PAD.l + 4, eTop + 10)
      g.fillStyle = 'rgba(127,224,176,0.9)'
      g.fillText('azimuth', PAD.l + 84, eTop + 10)
      // selected time and hover
      const cx = x(fracNow)
      g.strokeStyle = '#fff'
      g.beginPath()
      g.moveTo(cx, aTop)
      g.lineTo(cx, eBot)
      g.stroke()
      if (hover != null) {
        g.strokeStyle = COLORS.cursor
        g.setLineDash([3, 3])
        const hx = x(hover / (N - 1))
        g.beginPath()
        g.moveTo(hx, aTop)
        g.lineTo(hx, eBot)
        g.stroke()
        g.setLineDash([])
      }
    },
    [cur, sun, hover, fracNow, N],
  )

  const idxAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const f = (e.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r)
    return Math.max(0, Math.min(N - 1, Math.round(f * (N - 1))))
  }
  const [drag, setDrag] = useState(false)
  const apply = (i: number) => setSimTime(illum.track.startMs + i * illum.track.stepMs, startDay)

  const shown = hover ?? Math.min(N - 1, Math.max(0, Math.round(fracNow * (N - 1))))
  const ev = cur?.events
  const hrs = (iv: { startMs: number; endMs: number; clipped: boolean } | null) => (iv ? `${iv.clipped ? '≥ ' : ''}${fmtDuration((iv.endMs - iv.startMs) / 3.6e6)}` : 'none')

  return (
    <div className="gd-body">
      <div className="gd-controls">
        <RegionBar region={region} />
        <div className="gd-chips" role="group" aria-label="Location group">
          <span>Show</span>
          {groups.map((g) => (
            <button key={g.id} className={`btn ${cur?.id === g.id || (!cur && g.id === 'point') ? 'on' : ''}`} onClick={() => set({ timelineGroup: g.id })}>
              {g.label}
            </button>
          ))}
        </div>
        <PinBar point={point} />
      </div>
      {!point ? (
        <p className="note gd-empty">Click a point on the Moon to see when the Sun reaches it.</p>
      ) : !illum.ready || !cur || !sun ? (
        <Progress illum={illum} count={groups.reduce((a, g) => a + g.cells.length, 0)} />
      ) : (
        <>
          <canvas
            ref={ref}
            className="gd-canvas"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              setDrag(true)
              apply(idxAt(e))
            }}
            onPointerMove={(e) => {
              const i = idxAt(e)
              setHover(i)
              if (drag) apply(i)
            }}
            onPointerUp={() => setDrag(false)}
            onPointerLeave={() => setHover(null)}
          />
          <div className="gd-readout">
            <strong>{fmtUtc(illum.track.startMs + shown * illum.track.stepMs)}</strong> · {cur.label}: <strong>{cur.lit[shown].toFixed(0)}% lit</strong>, {(100 - cur.lit[shown]).toFixed(0)}% shadowed · Sun at selected point:
            elevation {sun.sunElev[shown].toFixed(1)}°, azimuth {sun.sunAz[shown].toFixed(0)}° {hover == null && <em>(click or drag the graph to move the 3D view to that time)</em>}
          </div>
          <p className="gd-stats">
            {cur.label} ({cur.n} {cur.n === 1 ? 'location' : 'locations'}): direct sunlight {(ev!.litFraction * 100).toFixed(0)}% of the next 30 days · sunrises {ev!.sunrises.length}, sunsets {ev!.sunsets.length} (▲ rise, ▼ set
            {cur.n > 1 ? ', where over half the sampled area is lit' : ''}) · longest darkness {hrs(ev!.longestDark)} · longest daylight {hrs(ev!.longestLight)}. Red shading = darkness of 24 h or more. “≥” means the interval runs past
            the window. Direct sunlight only: the Sun's disc (0.27° radius) against the DEM horizon; no earthshine, scattering or crater-wall glow.{' '}
            <abbr className="src src-modelled" title={SOURCE_EXPLAIN.modelled}>
              MODEL
            </abbr>{' '}
            Sun position: Meeus + IAU lunar orientation, not yet checked against JPL Horizons.
          </p>
        </>
      )}
    </div>
  )
}
