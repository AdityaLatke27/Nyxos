import { useEffect, useRef, useState } from 'react'
import { offsetLatLon } from '../../analysis/geo'
import { accessSummary, fmtSpan } from '../compare'
import { evaluate, type Assessment, type EvalInput } from '../engine'
import { yieldToBrowser } from '../nearby'
import { fmtLat, fmtLon } from './format'

const DIRS: [string, number, number][] = [
  ['North', 0, 1], ['North-east', 1, 1], ['East', 1, 0], ['South-east', 1, -1],
  ['South', 0, -1], ['South-west', -1, -1], ['West', -1, 0], ['North-west', -1, 1],
]
const STATUS: Record<string, string> = { PASS: 'Pass', WARNING: 'Warning', FAIL: 'Fail', INFO: 'Info', NOT_EVALUATED: 'Not evaluated' }

interface Row { dir: string; lat: number; lon: number; a: Assessment | null }

/**
 * Re-runs the same assessment at eight points 1 km around the site, to show how fast the answer changes with place.
 * It uses the same terrain, lander and landing time; link, power, hydrogen and crater rows are left out because they do
 * not change with a 1 km move in a way that matters here.
 */
export default function NeighbourScan({ base, stepKm = 1 }: { base: Omit<EvalInput, 'link' | 'power' | 'hydrogen' | 'craters'>; stepKm?: number }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const run = useRef(0)
  const key = `${base.lat},${base.lon},${base.startMs},${base.profile.name},${base.profile.stayDays?.value ?? ''}`
  // an older result must not stay on screen after the site, time or lander changes
  useEffect(() => { run.current++; setRows(null); setBusy(false) }, [key])
  const go = async () => {
    const id = ++run.current
    setBusy(true)
    const out: Row[] = []
    for (const [dir, e, n] of DIRS) {
      await yieldToBrowser()
      if (id !== run.current) return
      const k = Math.hypot(e, n)
      const p = offsetLatLon({ lat: base.lat, lon: base.lon }, (e / k) * stepKm, (n / k) * stepKm)
      let a: Assessment | null = null
      try { a = evaluate({ ...base, lat: p.lat, lon: p.lon }) } catch { a = null }
      out.push({ dir, lat: p.lat, lon: p.lon, a })
      setRows([...out])
    }
    if (id === run.current) setBusy(false)
  }
  return (
    <section className="ld-sec">
      <h2>How fast does the answer change with place?</h2>
      <p className="ld-hint">Same lander, landing time and stay, eight points {stepKm} km around the site. Small moves can change the answer; this shows by how much.</p>
      <button type="button" className="ghost" disabled={busy} onClick={go}>{busy ? 'Checking…' : rows ? 'Check again' : `Check ${stepKm} km around`}</button>
      {rows && rows.length > 0 && (
        <div className="cmp-scroll">
          <table className="cmp-table">
            <thead><tr><th scope="col">Point</th><th scope="col">Safety</th><th scope="col">Operations</th><th scope="col">Sunlit</th><th scope="col">Earth in view</th><th scope="col">Longest without sunlight</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const x = r.a ? accessSummary(r.a) : null
                return (
                  <tr key={r.dir}>
                    <th scope="row">{r.dir}<i>{fmtLat(r.lat)}, {fmtLon(r.lon)}</i></th>
                    <td>{r.a ? <span className={`ld-chip st-${r.a.safety.status}`}>{STATUS[r.a.safety.status] ?? r.a.safety.status}</span> : '–'}</td>
                    <td>{r.a ? <span className={`ld-chip st-${r.a.operations.status}`}>{STATUS[r.a.operations.status] ?? r.a.operations.status}</span> : '–'}</td>
                    <td className="num">{x ? `${x.litPct.toFixed(0)}%` : '–'}</td>
                    <td className="num">{x ? `${x.earthPct.toFixed(0)}%` : '–'}</td>
                    <td className="num">{x ? `${fmtSpan(x.longestDarkH)}${x.darkClipped && x.longestDarkH > 0 ? '+' : ''}` : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
