import { useEffect, useRef } from 'react'
import type { Series } from '../analysis/siteAnalysis'
import { useSim } from '../state/store'

/** 30-day strip: Sun visibility (gold), Earth in view (blue), link+power windows (green), current time cursor. */
export default function SiteChart({ series }: { series: Series | null }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const offsetHours = useSim((s) => s.offsetHours)
  const setOffset = useSim((s) => s.setOffsetHours)

  useEffect(() => {
    const c = canvas.current
    if (!c || !series) return
    const dpr = window.devicePixelRatio || 1
    const W = c.clientWidth
    const H = c.clientHeight
    c.width = W * dpr
    c.height = H * dpr
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    g.clearRect(0, 0, W, H)
    const n = series.sun.length
    const lane = (y: number, h: number, arr: Float32Array, color: string) => {
      g.fillStyle = 'rgba(255,255,255,0.04)'
      g.fillRect(0, y, W, h)
      g.fillStyle = color
      for (let i = 0; i < n - 1; i++) {
        const v = arr[i]
        if (v <= 0.02) continue
        const x0 = (i / (n - 1)) * W
        const x1 = ((i + 1) / (n - 1)) * W
        g.globalAlpha = 0.25 + 0.75 * v
        g.fillRect(x0, y, x1 - x0 + 0.6, h)
      }
      g.globalAlpha = 1
    }
    lane(4, 12, series.sun, '#f4c25b')
    lane(20, 12, series.earth, '#5fa8ff')
    const both = new Float32Array(n)
    for (let i = 0; i < n; i++) both[i] = series.sun[i] > 0.5 && series.earth[i] >= 0.5 ? 1 : 0
    lane(36, 6, both, '#4fe08a')
    g.fillStyle = 'rgba(160,190,230,0.35)'
    for (let d = 0; d <= 30; d += 5) {
      const x = (d / 30) * W
      g.fillRect(x, 44, 1, 4)
    }
  }, [series])

  const x = `${(offsetHours / 720) * 100}%`
  return (
    <div className="site-chart">
      <div
        className="site-chart-plot"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setOffset(((e.clientX - r.left) / r.width) * 720)
        }}
      >
        <canvas ref={canvas} />
        <span className="site-chart-cursor" style={{ left: x }} />
      </div>
      <div className="site-chart-legend">
        <span className="k sun">Sun</span>
        <span className="k earth">Earth</span>
        <span className="k both">Sun + link</span>
        <span className="days">0 → 30 days</span>
      </div>
    </div>
  )
}
