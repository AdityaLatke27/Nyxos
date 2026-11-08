import { useEffect, useMemo, useState } from 'react'
import { greatCircleKm, type LatLon } from '../../../analysis/geo'
import { sampleTransect, type Transect } from '../../../analysis/terrain'
import { summarize } from '../../../analysis/stats'
import { fmtLat, fmtLon } from '../../state/frame'
import { useSim } from '../../state/store'
import type { CpuTerrain } from '../../terrain/cpuTerrain'
import { COLORS, fmtInt, fmtTick, niceTicks, useChartCanvas } from './chartUtils'
import { ExportButton, Chip, FRAME_NOTE, coordFile, downloadCsv } from './exportUtils'
import { useProfileLine } from './lines'

interface Props {
  terrain: CpuTerrain
  /** the selected point on the map */
  point: LatLon | null
  hasTerrain: boolean
}

const LENGTHS = [2, 5, 10, 25, 50, 100]

/** Graph 1: elevation cross-section from the DEM, linked to a line and marker on the 3D terrain. */
export default function ProfileTab({ terrain, point, hasTerrain }: Props) {
  const s = useSim()
  const [hover, setHover] = useState<number | null>(null)
  const [locked, setLocked] = useState<number | null>(null)
  const [trueScale, setTrueScale] = useState(false)

  const ends = useProfileLine(point)

  // tell the map what to draw
  useEffect(() => {
    useSim.getState().set({ transectLine: ends })
    return () => useSim.getState().set({ transectLine: null, probe: null })
  }, [ends])

  const t = useMemo<Transect | null>(() => {
    if (!ends) return null
    const len = greatCircleKm(ends.a, ends.b)
    if (len < 0.05) return null
    const res = Math.max(terrain.resolutionKmAt(ends.a.lat, ends.a.lon), terrain.resolutionKmAt(ends.b.lat, ends.b.lon))
    return sampleTransect(terrain, ends.a, ends.b, Math.max(res, len / 800))
    // hasTerrain: redo when a finer site patch finishes loading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, ends, hasTerrain])

  const idx = locked ?? hover
  const mid = ends ? { lat: (ends.a.lat + ends.b.lat) / 2, lon: (ends.a.lon + ends.b.lon) / 2 } : null
  const resKm = ends ? Math.max(terrain.resolutionKmAt(ends.a.lat, ends.a.lon), mid ? terrain.resolutionKmAt(mid.lat, mid.lon) : 0) : 0

  const PAD = { l: 54, r: 12, t: 14, b: 24 }
  const ref = useChartCanvas(
    (g, W, H) => {
      if (!t) return
      const split = Math.round(H * 0.68)
      const x0 = PAD.l
      const x1 = W - PAD.r
      const xs = (d: number) => x0 + (d / t.lengthKm) * (x1 - x0)
      const ev = summarize(t.elevM)!
      const span = Math.max(1, ev.max - ev.min)
      const plotH = split - 8 - PAD.t
      let lo = ev.min - span * 0.08
      let hi = ev.max + span * 0.08
      if (trueScale) {
        // equal metres per pixel horizontally and vertically (1:1), unless the relief cannot fit
        const rangeM = (plotH * t.lengthKm * 1000) / (x1 - x0)
        if (rangeM >= span * 1.02) {
          const c = (ev.min + ev.max) / 2
          lo = c - rangeM / 2
          hi = c + rangeM / 2
        }
      }
      const exag = (plotH * t.lengthKm * 1000) / ((hi - lo) * (x1 - x0))
      const ys = (m: number) => split - 8 - ((m - lo) / (hi - lo)) * plotH
      g.font = '10.5px "Space Grotesk", sans-serif'
      g.textBaseline = 'middle'

      // grid + y axis (elevation)
      g.textAlign = 'right'
      for (const v of niceTicks(lo, hi, 4)) {
        g.strokeStyle = COLORS.grid
        g.beginPath()
        g.moveTo(x0, ys(v))
        g.lineTo(x1, ys(v))
        g.stroke()
        g.fillStyle = COLORS.text
        g.fillText(fmtTick(v), x0 - 6, ys(v))
      }
      g.save()
      g.translate(11, (PAD.t + split) / 2)
      g.rotate(-Math.PI / 2)
      g.textAlign = 'center'
      g.fillStyle = COLORS.axis
      g.fillText('Elevation (m)', 0, 0)
      g.restore()

      g.textAlign = 'right'
      g.fillStyle = COLORS.axis
      g.fillText(`vertical exaggeration ×${exag < 10 ? exag.toFixed(1) : Math.round(exag)}${Math.abs(exag - 1) < 0.05 ? ' (true scale)' : ''}`, x1 - 16, PAD.t + 4)

      // terrain fill + line
      g.beginPath()
      g.moveTo(xs(0), split - 8)
      t.distKm.forEach((d, i) => g.lineTo(xs(d), ys(t.elevM[i])))
      g.lineTo(xs(t.lengthKm), split - 8)
      g.closePath()
      g.fillStyle = COLORS.fill
      g.fill()
      g.beginPath()
      t.distKm.forEach((d, i) => (i ? g.lineTo(xs(d), ys(t.elevM[i])) : g.moveTo(xs(d), ys(t.elevM[i]))))
      g.strokeStyle = COLORS.line
      g.lineWidth = 1.6
      g.stroke()

      // slope strip
      const sm = Math.max(5, ...t.slopeDeg.map(Math.abs))
      const sTop = split + 14
      const sBot = H - PAD.b
      const sy = (v: number) => sBot - ((v + sm) / (2 * sm)) * (sBot - sTop)
      g.strokeStyle = COLORS.grid
      g.beginPath()
      g.moveTo(x0, sy(0))
      g.lineTo(x1, sy(0))
      g.stroke()
      g.beginPath()
      t.distKm.forEach((d, i) => (i ? g.lineTo(xs(d), sy(t.slopeDeg[i])) : g.moveTo(xs(d), sy(t.slopeDeg[i]))))
      g.strokeStyle = COLORS.warm
      g.lineWidth = 1.2
      g.stroke()
      g.textAlign = 'right'
      g.fillStyle = COLORS.text
      g.fillText(`${sm.toFixed(0)}°`, x0 - 6, sy(sm))
      g.fillText(`−${sm.toFixed(0)}°`, x0 - 6, sy(-sm))
      g.fillStyle = COLORS.warm
      g.fillText('slope', x0 - 6, (sTop + sBot) / 2)

      // x axis (distance)
      g.textAlign = 'center'
      g.fillStyle = COLORS.text
      for (const v of niceTicks(0, t.lengthKm, 6)) g.fillText(fmtTick(v), xs(v), H - 8)
      g.fillStyle = COLORS.axis
      g.textAlign = 'right'
      g.fillText('km along line', W - 2, H - 8)

      // ends + centre of a through-point line
      g.fillStyle = COLORS.warm
      g.textAlign = 'left'
      g.fillText('A', xs(0) + 3, PAD.t + 4)
      g.textAlign = 'right'
      g.fillText('B', xs(t.lengthKm) - 3, PAD.t + 4)
      if (useSim.getState().profileMode === 'bearing') {
        g.setLineDash([3, 4])
        g.strokeStyle = COLORS.axis
        g.beginPath()
        g.moveTo(xs(t.lengthKm / 2), PAD.t)
        g.lineTo(xs(t.lengthKm / 2), sBot)
        g.stroke()
        g.setLineDash([])
        g.textAlign = 'center'
        g.fillStyle = COLORS.axis
        g.fillText('selected point', xs(t.lengthKm / 2), PAD.t + 4)
      }

      // cursor
      if (idx != null && idx < t.distKm.length) {
        const cx = xs(t.distKm[idx])
        g.strokeStyle = COLORS.cursor
        g.lineWidth = 1
        g.beginPath()
        g.moveTo(cx, PAD.t)
        g.lineTo(cx, sBot)
        g.stroke()
        g.fillStyle = '#fff'
        g.beginPath()
        g.arc(cx, ys(t.elevM[idx]), 3.5, 0, Math.PI * 2)
        g.fill()
      }
    },
    [t, idx, trueScale],
  )

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!t || locked != null) return
    const r = e.currentTarget.getBoundingClientRect()
    const f = (e.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r)
    const i = Math.max(0, Math.min(t.distKm.length - 1, Math.round(f * (t.distKm.length - 1))))
    setHover(i)
    useSim.getState().set({ probe: { lat: t.lat[i], lon: t.lon[i] } })
  }
  const onLeave = () => {
    if (locked != null) return
    setHover(null)
    useSim.getState().set({ probe: null })
  }
  const onClick = () => {
    if (locked != null) {
      setLocked(null)
      return
    }
    if (hover != null) setLocked(hover)
  }

  const doExport = () => {
    if (!t || !ends) return
    downloadCsv(
      `nyxos_profile_${coordFile(ends.a.lat, ends.a.lon)}_to_${coordFile(ends.b.lat, ends.b.lon)}.csv`,
      [
        'NYXOS cross-section',
        `A: ${ends.a.lat.toFixed(5)}, ${ends.a.lon.toFixed(5)}  B: ${ends.b.lat.toFixed(5)}, ${ends.b.lon.toFixed(5)}  length ${t.lengthKm.toFixed(3)} km  step ${(t.stepKm * 1000).toFixed(1)} m`,
        `Source: LOLA DEM via NYXOS terrain pyramid, finest cell ${(resKm * 1000).toFixed(0)} m. Great-circle path. Slope = along-track central difference.`,
        FRAME_NOTE,
      ],
      ['distance_km', 'latitude_deg', 'longitude_deg', 'elevation_m', 'along_track_slope_deg'],
      t.distKm.map((d, i) => [d, t.lat[i], t.lon[i], t.elevM[i], t.slopeDeg[i]]),
    )
  }

  const ev = t ? summarize(t.elevM) : null
  const steep = t ? Math.max(...t.slopeDeg.map(Math.abs)) : 0
  const meanAbs = t ? t.slopeDeg.reduce((a, b) => a + Math.abs(b), 0) / t.slopeDeg.length : 0

  return (
    <div className="gd-body">
      <div className="gd-controls">
        <div className="seg">
          <button className={`btn ${s.profileMode === 'bearing' ? 'on' : ''}`} onClick={() => s.set({ profileMode: 'bearing', picking: null })}>
            Through selected point
          </button>
          <button className={`btn ${s.profileMode === 'points' ? 'on' : ''}`} onClick={() => s.set({ profileMode: 'points' })}>
            Two points
          </button>
        </div>
        {s.profileMode === 'bearing' ? (
          <>
            <label className="gd-field">
              Direction {s.bearingDeg}° {s.bearingDeg === 0 ? 'N' : s.bearingDeg === 90 ? 'E' : s.bearingDeg === 180 ? 'S' : s.bearingDeg === 270 ? 'W' : ''}
              <input type="range" min={0} max={359} value={s.bearingDeg} onChange={(e) => s.set({ bearingDeg: +e.target.value })} />
            </label>
            <div className="gd-chips" role="group" aria-label="Half length">
              <span>Reach ±</span>
              {LENGTHS.map((L) => (
                <button key={L} className={`btn ${s.halfLengthKm === L ? 'on' : ''}`} onClick={() => s.set({ halfLengthKm: L })}>
                  {L} km
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="gd-chips">
            <button className={`btn ${s.picking === 'a' ? 'on' : ''}`} onClick={() => s.set({ picking: 'a' })}>
              {s.picking === 'a' ? 'Click the map…' : s.lineA ? `A ${fmtLat(s.lineA.lat)} ${fmtLon(s.lineA.lon)}` : 'Set A on the map'}
            </button>
            <button className={`btn ${s.picking === 'b' ? 'on' : ''}`} onClick={() => s.set({ picking: 'b' })}>
              {s.picking === 'b' ? 'Click the map…' : s.lineB ? `B ${fmtLat(s.lineB.lat)} ${fmtLon(s.lineB.lon)}` : 'Set B on the map'}
            </button>
          </div>
        )}
        <div className="seg" role="group" aria-label="Vertical scale">
          <button className={`btn ${!trueScale ? 'on' : ''}`} onClick={() => setTrueScale(false)} title="Stretch the elevation range to fill the chart">
            Fit relief
          </button>
          <button className={`btn ${trueScale ? 'on' : ''}`} onClick={() => setTrueScale(true)} title="Same scale vertically and horizontally">
            True scale 1:1
          </button>
        </div>
        <ExportButton disabled={!t} onClick={doExport} />
      </div>

      {t ? (
        <>
          <canvas ref={ref} className="gd-canvas" onPointerMove={onMove} onPointerLeave={onLeave} onClick={onClick} />
          <div className="gd-readout">
            {idx != null && idx < t.distKm.length ? (
              <>
                <strong>{t.distKm[idx].toFixed(2)} km</strong> · {fmtLat(t.lat[idx])} {fmtLon(t.lon[idx])} · <strong>{fmtInt(t.elevM[idx])} m</strong> · slope{' '}
                {t.slopeDeg[idx].toFixed(1)}° {locked != null && <em>(locked, click to release)</em>}
              </>
            ) : (
              <>Hover the graph to see a point on the terrain; click to lock it.</>
            )}
          </div>
          <p className="gd-stats">
            Length {t.lengthKm.toFixed(1)} km · {t.distKm.length} samples every {(t.stepKm * 1000).toFixed(0)} m · min {fmtInt(ev!.min)} m · max {fmtInt(ev!.max)} m · relief{' '}
            {fmtInt(ev!.max - ev!.min)} m · mean |slope| {meanAbs.toFixed(1)}° · steepest {steep.toFixed(1)}° · <Chip source="dem" /> LOLA DEM, {resKm < 1 ? `${Math.round(resKm * 1000)} m` : `${resKm.toFixed(1)} km`} cells. {FRAME_NOTE}
          </p>
        </>
      ) : (
        <p className="note gd-empty">
          {s.profileMode === 'points' ? 'Set points A and B on the map to draw a cross-section.' : 'Click a point on the Moon to draw a cross-section through it.'}
        </p>
      )}
    </div>
  )
}
