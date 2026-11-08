import { interpolateGreatCircle, offsetLatLon, type LatLon } from '../../analysis/geo'
import type { CpuTerrain } from '../terrain/cpuTerrain'
import { dirFromLatLon } from '../terrain/cpuTerrain'
import { useSim } from '../state/store'

type Pt = { x: number; y: number; dist: number; facing: number }
type ToScreen = (d: ArrayLike<number>, hKm: number, out: Pt) => boolean

/**
 * Draws what the analysis graphs are looking at, on the map overlay: the cross-section line
 * with its ends, the analysed disc, and the chart-hover marker. Heights come from the same
 * terrain as the picture, so the lines sit on the surface.
 */
export function drawGraphOverlay(g: CanvasRenderingContext2D, toScreen: ToScreen, pt: Pt, terrain: CpuTerrain) {
  const s = useSim.getState()
  if (!s.graphOpen) return

  const onSurface = (p: LatLon): boolean => {
    const d = dirFromLatLon(p.lat, p.lon)
    return toScreen(d, terrain.heightAt(d, 0.05), pt) && pt.facing > 0.02
  }

  if (s.transectLine) {
    const { a, b } = s.transectLine
    const da = dirFromLatLon(a.lat, a.lon)
    const db = dirFromLatLon(b.lat, b.lon)
    g.strokeStyle = 'rgba(255,196,110,0.95)'
    g.lineWidth = 2
    g.setLineDash([])
    g.beginPath()
    let started = false
    for (let i = 0; i <= 64; i++) {
      const d = interpolateGreatCircle(da, db, i / 64)
      if (toScreen(d, terrain.heightAt(d, 0.05), pt) && pt.facing > 0.02) {
        if (!started) g.moveTo(pt.x, pt.y)
        else g.lineTo(pt.x, pt.y)
        started = true
      } else started = false
    }
    g.stroke()
    for (const [p, label] of [[a, 'A'], [b, 'B']] as const) {
      if (!onSurface(p)) continue
      g.fillStyle = '#ffc46e'
      g.beginPath()
      g.arc(pt.x, pt.y, 5, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#fff'
      g.font = '600 11px "Space Grotesk", sans-serif'
      g.fillText(label, pt.x + 8, pt.y - 7)
    }
  }

  if (s.regionDisc) {
    const { center, radiusKm } = s.regionDisc
    g.strokeStyle = 'rgba(120,200,255,0.9)'
    g.lineWidth = 1.6
    g.setLineDash([6, 4])
    g.beginPath()
    let started = false
    for (let i = 0; i <= 72; i++) {
      const th = (i / 72) * 2 * Math.PI
      const p = offsetLatLon(center, radiusKm * Math.sin(th), radiusKm * Math.cos(th))
      if (onSurface(p)) {
        if (!started) g.moveTo(pt.x, pt.y)
        else g.lineTo(pt.x, pt.y)
        started = true
      } else started = false
    }
    g.stroke()
    g.setLineDash([])
  }

  if (s.probe && onSurface(s.probe)) {
    g.lineWidth = 2
    g.strokeStyle = '#fff'
    g.fillStyle = 'rgba(80,160,255,0.9)'
    g.beginPath()
    g.arc(pt.x, pt.y, 6, 0, Math.PI * 2)
    g.fill()
    g.stroke()
  }
}
