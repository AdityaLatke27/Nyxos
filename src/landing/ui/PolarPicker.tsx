import { useRef } from 'react'
import { polarToLatLon, polarXY } from '../hazard'

export interface PickSite {
  id: string
  name: string
  lat: number
  lon: number
  group: string
}

const HALF_KM = 204.8
const GROUP_COLOR: Record<string, string> = { 'Artemis III region': '#ffc24d', 'Candidate site': '#ffe29a', Landmark: '#9fd0f5', CLPS: '#ff9fb0', Apollo: '#ff9fb0' }

/** South-pole map (LRO WAC mosaic, 205 km half-width) for choosing a point. */
export default function PolarPicker({ sites, lat, lon, onPick, imgSrc, size = 460 }: { sites: PickSite[]; lat: number; lon: number; onPick: (lat: number, lon: number, label?: string) => void; imgSrc: string; size?: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const toPx = (la: number, lo: number) => {
    const p = polarXY(la, lo)
    return { x: size / 2 + (p.x / 1000 / HALF_KM) * (size / 2), y: size / 2 - (p.y / 1000 / HALF_KM) * (size / 2) }
  }
  const click = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * size
    const py = ((e.clientY - r.top) / r.height) * size
    const x = ((px - size / 2) / (size / 2)) * HALF_KM * 1000
    const y = -((py - size / 2) / (size / 2)) * HALF_KM * 1000
    if (Math.hypot(x, y) > HALF_KM * 1000) return
    const p = polarToLatLon(x, y)
    onPick(+p.lat.toFixed(4), +p.lon.toFixed(4))
  }
  const sel = lat < -83 ? toPx(lat, lon) : null
  const ring = (deg: number) => (Math.abs(HALF_KM) ? (2 * 1737.4 * Math.tan((deg * Math.PI) / 360) / HALF_KM) * (size / 2) : 0)
  return (
    <svg ref={ref} viewBox={`0 0 ${size} ${size}`} className="pp-map" onClick={click} role="img" aria-label="South polar map. Click to choose a landing point.">
      <defs><clipPath id="ppc"><circle cx={size / 2} cy={size / 2} r={size / 2 - 1} /></clipPath></defs>
      <g clipPath="url(#ppc)">
        <image href={imgSrc} x={0} y={0} width={size} height={size} preserveAspectRatio="none" style={{ filter: 'brightness(0.95)' }} />
        {[85, 87, 89].map((l) => (
          <circle key={l} cx={size / 2} cy={size / 2} r={ring(90 - l)} fill="none" stroke="rgba(255,255,255,0.28)" strokeDasharray="2 4" />
        ))}
      </g>
      <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill="none" stroke="rgba(255,255,255,0.25)" />
      {[85, 87, 89].map((l) => (<text key={l} x={size / 2 + 3} y={size / 2 - ring(90 - l) - 3} fontSize={9} fill="rgba(255,255,255,0.7)">{`${l}°S`}</text>))}
      <text x={size / 2} y={12} textAnchor="middle" fontSize={10} fill="rgba(255,255,255,0.75)">0°</text>
      <text x={size - 6} y={size / 2 + 3} textAnchor="end" fontSize={10} fill="rgba(255,255,255,0.75)">90°E</text>
      {sites.filter((s) => s.lat < -83.2).map((s) => {
        const p = toPx(s.lat, s.lon)
        const on = Math.abs(s.lat - lat) < 1e-3 && Math.abs(s.lon - lon) < 1e-3
        return (
          <g key={s.id} onClick={(e) => { e.stopPropagation(); onPick(s.lat, s.lon, s.name) }} style={{ cursor: 'pointer' }}>
            <circle cx={p.x} cy={p.y} r={11} fill="transparent" />
            <circle cx={p.x} cy={p.y} r={on ? 5.5 : 4} fill={GROUP_COLOR[s.group] ?? '#fff'} stroke="#0c111c" strokeWidth={1.5} />
            <title>{s.name}</title>
          </g>
        )
      })}
      {sel && (<g pointerEvents="none"><circle cx={sel.x} cy={sel.y} r={9} fill="none" stroke="#fff" strokeWidth={2} /><circle cx={sel.x} cy={sel.y} r={2} fill="#fff" /></g>)}
    </svg>
  )
}
