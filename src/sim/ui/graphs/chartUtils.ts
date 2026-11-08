import { useEffect, useRef } from 'react'

export const COLORS = {
  axis: 'rgba(170,190,220,0.55)',
  grid: 'rgba(150,175,215,0.12)',
  text: 'rgba(205,220,242,0.82)',
  line: '#6aa8ff',
  fill: 'rgba(106,168,255,0.16)',
  warm: '#ffb86b',
  cool: '#7fe0b0',
  rose: '#ff8a9b',
  cursor: 'rgba(255,255,255,0.7)',
}

/** Sizes a canvas to its CSS box (sharp on high-DPI screens), redraws on resize and when deps change. */
export function useChartCanvas(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, deps: React.DependencyList) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const paint = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = c.clientWidth
      const h = c.clientHeight
      if (!w || !h) return
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
      const g = c.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      draw(g, w, h)
    }
    paint()
    const ro = new ResizeObserver(paint)
    ro.observe(c)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

/** "Nice" axis ticks (1, 2, 5 × 10^k) covering [min, max]. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) return [min]
  const raw = (max - min) / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toPrecision(12))
  return out
}

export const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US')
export const fmtTick = (v: number) => (Math.abs(v) >= 1000 ? fmtInt(v) : `${+v.toPrecision(4)}`)
