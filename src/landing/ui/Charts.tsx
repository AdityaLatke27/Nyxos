import type { ReactNode } from 'react'
import type { Assessment, Run } from '../engine'
import type { ShadowScan } from '../nearby'

/**
 * SVG figures shared by the on-screen workspace and the downloadable report.
 * Pure functions of their props: the report renders the same components to static markup.
 */
export interface Theme {
  bg: string
  fg: string
  mute: string
  grid: string
  axis: string
  sun: string
  earth: string
  horizon: string
  pass: string
  warn: string
  fail: string
  /** sequential ramp, low to high slope */
  ramp: string[]
  limit: string
}

export const DARK: Theme = {
  bg: '#0c111c', fg: '#e4ecf8', mute: '#93a3bd', grid: 'rgba(150,175,215,0.14)', axis: 'rgba(170,190,220,0.55)',
  sun: '#ffc24d', earth: '#62b0ff', horizon: '#7f8da8', pass: '#5fd6a0', warn: '#ffb86b', fail: '#ff7a8a',
  ramp: ['#17324f', '#245483', '#3578b5', '#59a0dd', '#9fd0f5'], limit: '#ff7a8a',
}
export const LIGHT: Theme = {
  bg: '#ffffff', fg: '#17202e', mute: '#5b6a80', grid: 'rgba(40,60,90,0.12)', axis: 'rgba(40,60,90,0.6)',
  sun: '#d98a00', earth: '#1f6fd1', horizon: '#6b7a93', pass: '#16875a', warn: '#b56a00', fail: '#c4283d',
  ramp: ['#e6f0fa', '#b5d4ef', '#78aede', '#3c80c0', '#144f88'], limit: '#c4283d',
}

const FONT = "'Space Grotesk', system-ui, sans-serif"
export const SLOPE_CLASSES = [5, 10, 15, 20] // class upper edges, deg

export function slopeClass(p95: number) {
  for (let i = 0; i < SLOPE_CLASSES.length; i++) if (p95 <= SLOPE_CLASSES[i]) return i
  return SLOPE_CLASSES.length
}

function ticks(min: number, max: number, target = 5) {
  const raw = (max - min) / target || 1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toPrecision(10))
  return out
}

const T = (props: { x: number; y: number; t: Theme; s?: number; a?: 'start' | 'middle' | 'end'; fill?: string; w?: number; children: ReactNode; rot?: number }) => (
  <text x={props.x} y={props.y} fontSize={props.s ?? 11} textAnchor={props.a ?? 'start'} fill={props.fill ?? props.t.mute} fontWeight={props.w ?? 400} fontFamily={FONT}
    transform={props.rot ? `rotate(${props.rot} ${props.x} ${props.y})` : undefined}>
    {props.children}
  </text>
)

const fmtDay = (ms: number) => new Date(ms).toISOString().slice(5, 10)
const fmtDT = (ms: number) => new Date(ms).toISOString().slice(5, 16).replace('T', ' ')

/* ---------------------------------------------------------------- 1. timeline */
export function TimelineChart({ a, t, w = 720, h = 330, label = true }: { a: Assessment; t: Theme; w?: number; h?: number; label?: boolean }) {
  const tl = a.timeline
  const n = Math.min(tl.n, Math.round((a.stayDays * 86400000) / tl.stepMs) + 1)
  const m = { l: 64, r: 14, t: 16, b: 74 }
  const pw = w - m.l - m.r
  const ph = h - m.t - m.b
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < n; i++) for (const v of [tl.sunElev[i], tl.earthElev[i]]) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
  lo = Math.floor(Math.min(lo, 0) - 1); hi = Math.ceil(Math.max(hi, 0) + 1)
  const X = (i: number) => m.l + (i / (n - 1)) * pw
  const Y = (v: number) => m.t + (1 - (v - lo) / (hi - lo)) * ph
  const path = (arr: Float32Array) => Array.from({ length: n }, (_, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(arr[i]).toFixed(1)}`).join('')
  const yt = ticks(lo, hi)
  const day = 86400000 / tl.stepMs
  const xd = []
  for (let d = 0; d * day <= n - 1; d += Math.max(1, Math.round(a.stayDays / 6))) xd.push(d)
  const strip = (y: number, pred: (i: number) => boolean, color: string, name: string) => {
    const rs: Run[] = []
    let s = -1
    for (let i = 0; i < n; i++) { if (pred(i)) { if (s < 0) s = i } else if (s >= 0) { rs.push({ start: s, end: i }); s = -1 } }
    if (s >= 0) rs.push({ start: s, end: n })
    return (
      <g>
        <rect x={m.l} y={y} width={pw} height={14} fill="none" stroke={t.grid} />
        {rs.map((r, k) => <rect key={k} x={X(r.start)} y={y} width={Math.max(1, X(Math.min(r.end, n - 1)) - X(r.start))} height={14} fill={color} />)}
        <T x={m.l - 6} y={y + 11} a="end" t={t} s={10}>{name}</T>
      </g>
    )
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="Sun and Earth elevation and visibility during the stay">
      {yt.map((v) => (
        <g key={v}>
          <line x1={m.l} x2={w - m.r} y1={Y(v)} y2={Y(v)} stroke={v === 0 ? t.axis : t.grid} strokeDasharray={v === 0 ? '' : '2 3'} />
          <T x={m.l - 6} y={Y(v) + 4} a="end" t={t}>{v}</T>
        </g>
      ))}
      {xd.map((d) => (
        <g key={d}>
          <line x1={X(d * day)} x2={X(d * day)} y1={m.t} y2={m.t + ph} stroke={t.grid} />
          <T x={X(d * day)} y={m.t + ph + 14} a="middle" t={t}>{`+${d} d`}</T>
        </g>
      ))}
      <path d={path(tl.sunElev)} fill="none" stroke={t.sun} strokeWidth={2} />
      <path d={path(tl.earthElev)} fill="none" stroke={t.earth} strokeWidth={2} strokeDasharray="6 3" />
      {strip(m.t + ph + 24, (i) => tl.sunFrac[i] >= 0.5, t.sun, 'Sun lit')}
      {strip(m.t + ph + 42, (i) => tl.earthFrac[i] >= 0.5, t.earth, 'Earth seen')}
      <T x={m.l} y={h - 6} t={t} s={10}>{`UTC, start ${fmtDT(a.startMs)}Z · elevation of disc centre above the geometric horizon (deg)`}</T>
      <T x={14} y={m.t + ph / 2} t={t} a="middle" rot={-90}>elevation (°)</T>
      {label && (
        <g fontFamily={FONT} fontSize={11}>
          <line x1={w - 190} x2={w - 170} y1={m.t + 6} y2={m.t + 6} stroke={t.sun} strokeWidth={2} /><T x={w - 166} y={m.t + 10} t={t} fill={t.fg}>Sun</T>
          <line x1={w - 130} x2={w - 110} y1={m.t + 6} y2={m.t + 6} stroke={t.earth} strokeWidth={2} strokeDasharray="6 3" /><T x={w - 106} y={m.t + 10} t={t} fill={t.fg}>Earth</T>
        </g>
      )}
    </svg>
  )
}

/* ---------------------------------------------------------------- 2. horizon */
export function HorizonChart({ a, t, w = 720, h = 280 }: { a: Assessment; t: Theme; w?: number; h?: number }) {
  const m = { l: 46, r: 14, t: 16, b: 40 }
  const pw = w - m.l - m.r, ph = h - m.t - m.b
  const hz = a.horizon
  const tl = a.timeline
  const n = Math.min(tl.n, Math.round((a.stayDays * 86400000) / tl.stepMs) + 1)
  let lo = Infinity, hi = -Infinity
  for (const v of hz) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
  for (let i = 0; i < n; i++) for (const v of [tl.sunElev[i], tl.earthElev[i]]) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
  lo = Math.floor(lo - 1); hi = Math.ceil(hi + 1)
  const X = (az: number) => m.l + (az / 360) * pw
  const Y = (v: number) => m.t + (1 - (v - lo) / (hi - lo)) * ph
  const area = `M${X(0)},${Y(lo)}` + Array.from(hz, (v, i) => `L${X((i / hz.length) * 360).toFixed(1)},${Y(v).toFixed(1)}`).join('') + `L${X(360)},${Y(lo)}Z`
  const dots = (az: Float32Array, el: Float32Array, c: string) => {
    const stride = Math.max(1, Math.floor(n / 220))
    const out = []
    for (let i = 0; i < n; i += stride) out.push(<circle key={i} cx={X(az[i])} cy={Y(el[i])} r={2} fill={c} opacity={0.85} />)
    return out
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="Terrain horizon with Sun and Earth tracks">
      {ticks(lo, hi).map((v) => (<g key={v}><line x1={m.l} x2={w - m.r} y1={Y(v)} y2={Y(v)} stroke={v === 0 ? t.axis : t.grid} /><T x={m.l - 6} y={Y(v) + 4} a="end" t={t}>{v}</T></g>))}
      {[0, 45, 90, 135, 180, 225, 270, 315, 360].map((v) => (<g key={v}><line x1={X(v)} x2={X(v)} y1={m.t} y2={m.t + ph} stroke={t.grid} /><T x={X(v)} y={m.t + ph + 14} a="middle" t={t}>{v}</T></g>))}
      <path d={area} fill={t.horizon} opacity={0.5} stroke={t.horizon} strokeWidth={1.5} />
      {dots(tl.sunAz, tl.sunElev, t.sun)}
      {dots(tl.earthAz, tl.earthElev, t.earth)}
      <T x={m.l + pw / 2} y={h - 6} a="middle" t={t}>azimuth, clockwise from local north (°)</T>
      <T x={14} y={m.t + ph / 2} a="middle" t={t} rot={-90}>elevation (°)</T>
      <g fontFamily={FONT} fontSize={11}>
        <rect x={w - 250} y={m.t + 1} width={12} height={9} fill={t.horizon} opacity={0.5} /><T x={w - 234} y={m.t + 10} t={t} fill={t.fg}>terrain horizon</T>
        <circle cx={w - 140} cy={m.t + 6} r={3} fill={t.sun} /><T x={w - 132} y={m.t + 10} t={t} fill={t.fg}>Sun</T>
        <circle cx={w - 92} cy={m.t + 6} r={3} fill={t.earth} /><T x={w - 84} y={m.t + 10} t={t} fill={t.fg}>Earth</T>
      </g>
    </svg>
  )
}

/* ---------------------------------------------------------------- 3. slope distribution */
export function SlopeHistogram({ a, t, w = 720, h = 260 }: { a: Assessment; t: Theme; w?: number; h?: number }) {
  const eva = a.eva
  if (!eva) return <NoData t={t} w={w} h={h / 2} msg="No lander-scale slope data here" />
  const lim = a.profile.maxEvaSlopeDeg.value
  const edges = [0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 25, 30, 90]
  const counts = new Array(edges.length - 1).fill(0)
  for (const s of eva.slopes) { const k = edges.findIndex((e, i) => i < edges.length - 1 && s >= e && s < edges[i + 1]); counts[k < 0 ? counts.length - 1 : k]++ }
  const pct = counts.map((c) => (100 * c) / eva.slopes.length)
  const m = { l: 46, r: 14, t: 16, b: 46 }
  const pw = w - m.l - m.r, ph = h - m.t - m.b
  const ymax = Math.max(5, Math.ceil(Math.max(...pct) / 10) * 10)
  const bw = pw / counts.length
  const Y = (v: number) => m.t + (1 - v / ymax) * ph
  const limX = m.l + edges.findIndex((e) => e === lim) * bw
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="Distribution of 95th percentile slope across the 2 km neighbourhood">
      <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill={t.fail} opacity={0.18} /><line x1="0" y1="0" x2="0" y2="6" stroke={t.fail} strokeWidth="2" /></pattern></defs>
      {ticks(0, ymax).map((v) => (<g key={v}><line x1={m.l} x2={w - m.r} y1={Y(v)} y2={Y(v)} stroke={t.grid} /><T x={m.l - 6} y={Y(v) + 4} a="end" t={t}>{v}%</T></g>))}
      {pct.map((p, i) => {
        const over = edges[i] >= lim
        return (
          <g key={i}>
            <rect x={m.l + i * bw + 2} y={Y(p)} width={bw - 4} height={Math.max(0, m.t + ph - Y(p))} rx={3} fill={over ? 'url(#hatch)' : t.ramp[3]} stroke={over ? t.fail : 'none'} />
            <T x={m.l + i * bw + bw / 2} y={m.t + ph + 14} a="middle" t={t} s={10}>{i === counts.length - 1 ? `${edges[i]}+` : `${edges[i]}–${edges[i + 1]}`}</T>
          </g>
        )
      })}
      <line x1={limX} x2={limX} y1={m.t} y2={m.t + ph} stroke={t.limit} strokeWidth={1.5} strokeDasharray="5 3" />
      <T x={limX + 5} y={m.t + 11} t={t} fill={t.limit} s={10}>{`EVA limit ${lim}°`}</T>
      <T x={m.l + pw / 2} y={h - 6} a="middle" t={t}>95th-percentile slope of each hazard cell (°) — share of cells within 2 km</T>
    </svg>
  )
}

/* ---------------------------------------------------------------- 4. window calendar */
export function WindowCalendar({ a, t, w = 720, h = 150 }: { a: Assessment; t: Theme; w?: number; h?: number }) {
  const tl = a.timeline
  const m = { l: 76, r: 14, t: 14, b: 38 }
  const pw = w - m.l - m.r
  const spanStarts = tl.n
  const X = (i: number) => m.l + (i / spanStarts) * pw
  const row = (y: number, rs: Run[], c: string, name: string) => (
    <g>
      <rect x={m.l} y={y} width={pw} height={22} fill="none" stroke={t.grid} />
      {rs.map((r, k) => <rect key={k} x={X(r.start)} y={y} width={Math.max(1.5, X(r.end) - X(r.start))} height={22} fill={c} />)}
      <T x={m.l - 6} y={y + 15} a="end" t={t} s={10}>{name}</T>
    </g>
  )
  const months: ReactNode[] = []
  const d0 = new Date(tl.startMs)
  for (let k = 0; k < 13; k++) {
    const d = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + k, 1)
    const i = (d - tl.startMs) / tl.stepMs
    if (i < 0 || i > tl.n) continue
    months.push(<g key={k}><line x1={X(i)} x2={X(i)} y1={m.t} y2={m.t + 54} stroke={t.grid} /><T x={X(i) + 2} y={m.t + 68} t={t} s={10}>{new Date(d).toISOString().slice(2, 7)}</T></g>)
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="Start dates from which the whole stay is sunlit">
      {months}
      {row(m.t, a.windows.litOnly, t.sun, 'Sun only')}
      {row(m.t + 30, a.windows.litAndEarth, t.pass, 'Sun + Earth')}
      <T x={m.l} y={h - 4} t={t} s={10}>{`A filled bar marks start times from which all ${a.stayDays} days are inside the condition (UTC, 30-min resolution)`}</T>
    </svg>
  )
}

/* ---------------------------------------------------------------- 5. hazard map */
export function HazardMap({ a, t, size = 420 }: { a: Assessment; t: Theme; size?: number }) {
  const g = a.grid
  if (!g) return <NoData t={t} w={size} h={size / 2} msg="No lander-scale slope data here" />
  const N = g.radiusCells
  const side = 2 * N + 1
  const pad = 22
  const cs = (size - 2 * pad) / side
  const cx = pad + (N + 0.5) * cs, cy = pad + (N + 0.5) * cs
  const mPer = g.cellM
  const px = (m: number) => (m / mPer) * cs
  const sbar = a.profile.evaRadiusM.value >= 1000 ? 1000 : 500
  return (
    <svg viewBox={`0 0 ${size} ${size + 24}`} width="100%" role="img" aria-label="Slope hazard cells around the landing point">
      <defs><pattern id="hatch2" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke={t.fail} strokeWidth="1.6" /></pattern></defs>
      <rect x={pad} y={pad} width={side * cs} height={side * cs} fill={t.bg} stroke={t.grid} />
      {g.cells.map((c, k) => {
        const x = pad + (c.i + N) * cs, y = pad + (N - c.j) * cs
        const cls = slopeClass(c.p95)
        const over = c.p95 > a.profile.maxLandingSlopeDeg.value
        return (
          <g key={k}>
            <rect x={x} y={y} width={cs + 0.4} height={cs + 0.4} fill={t.ramp[cls]} />
            {over && <rect x={x} y={y} width={cs + 0.4} height={cs + 0.4} fill="url(#hatch2)" />}
          </g>
        )
      })}
      <circle cx={cx} cy={cy} r={px(a.profile.evaRadiusM.value)} fill="none" stroke={t.fg} strokeDasharray="4 4" opacity={0.7} />
      <circle cx={cx} cy={cy} r={Math.max(3, px(a.profile.landingZoneRadiusM.value))} fill="none" stroke={t.sun} strokeWidth={2} />
      <circle cx={cx} cy={cy} r={2} fill={t.sun} />
      <path d={`M${size - pad - 6},${pad + 26} l5,-14 l5,14 l-5,-4z`} fill={t.fg} /><T x={size - pad + 4} y={pad + 8} a="middle" t={t} s={10}>N</T>
      <line x1={pad} x2={pad + px(sbar)} y1={size - 4} y2={size - 4} stroke={t.fg} strokeWidth={2} /><T x={pad + px(sbar) + 6} y={size} t={t} s={10}>{`${sbar / 1000} km`}</T>
      {/* legend */}
      {[...SLOPE_CLASSES, 90].map((e, i) => (
        <g key={e}><rect x={pad + 90 + i * 62} y={size + 4} width={10} height={10} fill={t.ramp[i]} /><T x={pad + 104 + i * 62} y={size + 13} t={t} s={10}>{i === 0 ? '≤5°' : i === SLOPE_CLASSES.length ? '>20°' : `≤${e}°`}</T></g>
      ))}
    </svg>
  )
}

/* ---------------------------------------------------------------- 6. persistent shadow scan */
export function ShadowMap({ s, t, size = 300 }: { s: ShadowScan; t: Theme; size?: number }) {
  const pad = 16
  const r = s.radiusKm
  const X = (d: number) => pad + ((d + r) / (2 * r)) * (size - 2 * pad)
  const Y = (d: number) => pad + ((r - d) / (2 * r)) * (size - 2 * pad)
  const cell = ((size - 2 * pad) / (2 * r)) * ((2 * r) / 8) * 0.92
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" role="img" aria-label="Persistently shadowed candidates within 4 km">
      <rect x={pad} y={pad} width={size - 2 * pad} height={size - 2 * pad} fill="none" stroke={t.grid} />
      {s.cells.map((c, k) => (
        <rect key={k} x={X(c.dxKm) - cell / 2} y={Y(c.dyKm) - cell / 2} width={cell} height={cell} rx={2}
          fill={c.persistent ? t.earth : t.sun} opacity={c.persistent ? 0.85 : 0.25 + 0.6 * Math.min(1, c.litPct / 50)} stroke={c.persistent ? t.fg : 'none'} strokeWidth={0.8} />
      ))}
      <circle cx={X(0)} cy={Y(0)} r={4} fill="none" stroke={t.fg} strokeWidth={2} />
      <T x={size - pad} y={size - 3} a="end" t={t} s={10}>{`±${r} km · N up`}</T>
    </svg>
  )
}

/* ------------------------------------------- sensitivity to the terrain horizon */
export function SensitivityChart({ a, t, w = 720, h = 300 }: { a: Assessment; t: Theme; w?: number; h?: number }) {
  const sn = a.sensitivity
  const { offsetDeg: xs, litPct, earthPct } = sn.curve
  const m = { l: 46, r: 64, t: 16, b: 52 }
  const pw = w - m.l - m.r, ph = h - m.t - m.b
  const X = (d: number) => m.l + ((d + sn.searchLimitDeg) / (2 * sn.searchLimitDeg)) * pw
  const Y = (v: number) => m.t + (1 - v / 100) * ph
  const path = (ys: number[]) => ys.map((v, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  const flips = [
    ...(sn.flip.sun.raise !== null ? [{ d: sn.flip.sun.raise, c: t.sun, k: 'Sun' }] : []),
    ...(sn.flip.sun.lower !== null ? [{ d: -sn.flip.sun.lower, c: t.sun, k: 'Sun' }] : []),
    ...(sn.flip.earth.raise !== null ? [{ d: sn.flip.earth.raise, c: t.earth, k: 'Earth' }] : []),
    ...(sn.flip.earth.lower !== null ? [{ d: -sn.flip.earth.lower, c: t.earth, k: 'Earth' }] : []),
  ]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="Share of the stay lit and in view of Earth as the terrain horizon is raised or lowered">
      {[0, 25, 50, 75, 100].map((v) => (<g key={v}><line x1={m.l} x2={w - m.r} y1={Y(v)} y2={Y(v)} stroke={t.grid} /><T x={m.l - 6} y={Y(v) + 4} a="end" t={t}>{v}%</T></g>))}
      {[-1, -0.5, 0, 0.5, 1].map((d) => (<g key={d}><line x1={X(d)} x2={X(d)} y1={m.t + ph} y2={m.t + ph + 4} stroke={t.axis} /><T x={X(d)} y={m.t + ph + 16} a="middle" t={t}>{d > 0 ? `+${d}` : d}°</T></g>))}
      <line x1={X(0)} x2={X(0)} y1={m.t} y2={m.t + ph} stroke={t.axis} strokeDasharray="4 3" />
      <T x={X(0) + 5} y={m.t + 11} t={t} s={10}>as modelled</T>
      <path d={path(earthPct)} fill="none" stroke={t.earth} strokeWidth={2} strokeDasharray="7 4" />
      <path d={path(litPct)} fill="none" stroke={t.sun} strokeWidth={2.5} />
      {flips.map((f, i) => (<g key={i}><circle cx={X(f.d)} cy={m.t + ph + 28} r={4} fill={f.c} stroke={t.bg} strokeWidth={1.5} /></g>))}
      <T x={w - m.r + 6} y={Y(litPct[litPct.length - 1]) + 4} t={t} fill={t.sun} w={600}>Sun lit</T>
      <T x={w - m.r + 6} y={Y(earthPct[earthPct.length - 1]) + (Math.abs(Y(litPct[litPct.length - 1]) - Y(earthPct[earthPct.length - 1])) < 14 ? 18 : 4)} t={t} fill={t.earth} w={600}>Earth seen</T>
      <T x={m.l + pw / 2} y={h - 4} a="middle" t={t}>Whole terrain horizon moved up (+) or down (−) by this many degrees; dots mark where a verdict changes</T>
    </svg>
  )
}

function NoData({ t, w, h, msg }: { t: Theme; w: number; h: number; msg: string }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%"><rect x={1} y={1} width={w - 2} height={h - 2} rx={6} fill="none" stroke={t.grid} strokeDasharray="4 4" /><T x={w / 2} y={h / 2 + 4} a="middle" t={t}>{msg}</T></svg>
  )
}

export { fmtDay, fmtDT }
