import { useEffect, useRef } from 'react'
import { LogoController } from './LogoController'
import './logo.css'

export default function Logo({ onReady }: { onReady: (c: LogoController) => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const group = useRef<SVGGElement>(null)
  const n = useRef<SVGTextElement>(null)
  const y = useRef<SVGTextElement>(null)
  const x = useRef<SVGTextElement>(null)
  const o = useRef<SVGTextElement>(null)
  const s = useRef<SVGTextElement>(null)
  const tagline = useRef<SVGTextElement>(null)

  useEffect(() => {
    const c = new LogoController(
      svg.current!,
      group.current!,
      { N: n.current!, Y: y.current!, X: x.current!, O: o.current!, S: s.current! },
      tagline.current!,
    )
    let cancelled = false
    c.init().then(() => !cancelled && onReady(c))
    return () => {
      cancelled = true
    }
  }, [onReady])

  return (
    <svg className="logo-svg" ref={svg} aria-label="NYXOS" role="img">
      <g ref={group}>
        <text ref={n} className="logo-letter">N</text>
        <text ref={y} className="logo-letter">Y</text>
        <text ref={x} className="logo-letter">X</text>
        <text ref={o} className="logo-letter logo-o">O</text>
        <text ref={s} className="logo-letter">S</text>
        <text ref={tagline} className="logo-tagline" x="0" textAnchor="middle">
          LUNAR LANDING SITE NAVIGATOR
        </text>
      </g>
    </svg>
  )
}
