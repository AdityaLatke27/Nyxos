import { useEffect, useMemo, useRef, useState } from 'react'
import NavRail from '../../ui/nav/NavRail'
import Loader from '../../ui/Loader'
import { loadSimAssets, loadSiteTerrain } from '../../sim/data/loadSimAssets'
import { CpuTerrain } from '../../sim/terrain/cpuTerrain'
import type { SimAssets } from '../../sim/data/types'
import { searchCraters } from '../../analysis/craterLookup'
import { HazardField, browserLoader, loadManifest, polarXY } from '../hazard'
import { loadTerrainField, type TerrainField } from '../terrain'
import { loadCraters, type CraterData } from '../craters'
import { loadLpHydrogen, type LpHydrogenData } from '../hydrogen'
import { evaluate, type Status } from '../engine'
import { loadEphemerisTable } from '../../astro/ephemerisTable'
import { NASA_HLS } from '../profile'
import { DEFAULT_LINK, type LinkInputs } from '../linkBudget'
import LinkForm from './LinkForm'
import PowerForm from './PowerForm'
import { DEFAULT_POWER, type PowerInputs } from '../power'
import { ROBUSTNESS_LABEL } from '../sensitivity'
import { yieldToBrowser } from '../nearby'
import { WUELLER_SITES } from '../candidateSites'
import { accessRows, compareCsv, rowDiffers, rowFor, rowList, slipTimes, verdictSummary, type CompareResult, type SiteEntry } from '../compare'
import { downloadText } from '../report'
import { STATUS_GLYPH, STATUS_LABEL, fmtLat, fmtLon, fmtUtc } from './format'
import './landing.css'

const MAX_SITES = 6
const MAX_DATES = 6
const nextMidnight = () => {
  const d = new Date()
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}
const toInput = (ms: number) => new Date(ms).toISOString().slice(0, 16)

function Chip({ s }: { s: Status }) {
  return (
    <span className={`ld-chip st-${s}`}>
      <b aria-hidden>{STATUS_GLYPH[s]}</b>
      {STATUS_LABEL[s]}
    </span>
  )
}

export default function CompareApp() {
  const [assets, setAssets] = useState<SimAssets | null>(null)
  const [bytes, setBytes] = useState({ l: 0, t: 0 })
  const [error, setError] = useState<string | null>(null)
  const [hazard, setHazard] = useState<HazardField | null>(null)
  const [lunar, setLunar] = useState<TerrainField | null>(null)
  const [hydrogen, setHydrogen] = useState<LpHydrogenData | null>(null)
  const [craters, setCraters] = useState<CraterData | null>(null)
  const [ready, setReady] = useState({ hazard: false, lunar: false })

  useEffect(() => {
    loadSimAssets((l, t) => setBytes({ l, t })).then(setAssets).catch((e: Error) => setError(e.message))
    loadLpHydrogen().then(setHydrogen)
    loadCraters().then(setCraters)
    loadTerrainField().then((f) => { setLunar(f); setReady((r) => ({ ...r, lunar: true })) })
    loadManifest().then((m) => {
      if (m) setHazard(new HazardField(m, browserLoader()))
      setReady((r) => ({ ...r, hazard: true }))
    })
  }, [])

  const terrain = useMemo(() => (assets ? new CpuTerrain(assets) : null), [assets])
  const [picked, setPicked] = useState<SiteEntry[]>([])
  const [start, setStart] = useState(nextMidnight())
  const [link, setLink] = useState<LinkInputs>(DEFAULT_LINK)
  const [power, setPower] = useState<PowerInputs>(DEFAULT_POWER)
  const [stay, setStay] = useState(NASA_HLS.stayDays.value)
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [mode, setMode] = useState<'sites' | 'dates'>('sites')
  const [slips, setSlips] = useState<number[]>([0, 7, 14, 30])
  const [slipText, setSlipText] = useState('')
  const [query, setQuery] = useState('')
  const [custom, setCustom] = useState({ lat: -89.5, lon: 0 })
  const [results, setResults] = useState<CompareResult[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const runId = useRef(0)

  // first load: start with the NYXOS candidate sites so the page is never empty
  const seeded = useRef(false)
  useEffect(() => {
    if (!assets || seeded.current) return
    seeded.current = true
    const c = assets.sites.filter((s) => s.group === 'Candidate site').slice(0, 3)
    setPicked(c.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon })))
  }, [assets])

  const profile = useMemo(() => ({ ...NASA_HLS, stayDays: { ...NASA_HLS.stayDays, value: stay, source: stay === NASA_HLS.stayDays.value ? NASA_HLS.stayDays.source : 'User-defined in NYXOS' } }), [stay])

  // What to analyse: several sites at one landing time, or one site (the first in the list) at several landing times.
  const jobs = useMemo(() => {
    if (mode === 'dates') {
      const site = picked[0]
      if (!site) return []
      return slipTimes(start, slips).slice(0, MAX_DATES).map((t) => ({
        entry: { ...site, id: `${site.id}@${t.slipDays}`, name: `${t.slipDays === 0 ? 'Base' : `+${t.slipDays} d`} (${new Date(t.startMs).toISOString().slice(0, 10)})` },
        startMs: t.startMs,
        slipDays: t.slipDays as number | undefined,
      }))
    }
    return picked.map((entry) => ({ entry, startMs: start, slipDays: undefined as number | undefined }))
  }, [mode, picked, start, slips])

  useEffect(() => {
    if (!terrain || !assets || !ready.hazard || !ready.lunar || jobs.length === 0) {
      if (jobs.length === 0) setResults([])
      return
    }
    const id = ++runId.current
    const handle = setTimeout(async () => {
      await loadEphemerisTable()
      const out: CompareResult[] = []
      setProgress({ done: 0, total: jobs.length })
      for (const { entry, startMs, slipDays } of jobs) {
        if (id !== runId.current) return
        try {
          terrain.setSite(null)
          const near = assets.sites.find((s) => s.near && Math.abs(s.lat - entry.lat) < 0.5 && Math.hypot((s.lat - entry.lat) * 30.3, (s.lon - entry.lon) * 30.3 * Math.cos((entry.lat * Math.PI) / 180)) < 12)
          if (near) {
            try { terrain.setSite(await loadSiteTerrain(near)) } catch { /* global pyramid */ }
          }
          if (entry.lat < -55) {
            const p = polarXY(entry.lat, entry.lon)
            if (hazard) await hazard.ensure(p.x, p.y, 3500)
            if (lunar) await lunar.ensure(p.x, p.y, profile.coldTrapReachM.value + 600)
          }
          await yieldToBrowser()
          if (id !== runId.current) return
          const a = evaluate({ lat: entry.lat, lon: entry.lon, startMs, profile, terrain, hazard, lunar, link, power, hydrogen, craters })
          out.push({ entry, a, startMs, slipDays })
        } catch (e) {
          out.push({ entry, a: null, error: (e as Error).message, startMs, slipDays })
        }
        if (id !== runId.current) return
        setProgress({ done: out.length, total: jobs.length })
        setResults([...out])
      }
      if (id === runId.current) setProgress(null)
    }, 300)
    return () => clearTimeout(handle)
  }, [terrain, assets, hazard, lunar, hydrogen, craters, ready, jobs, profile, link, power])

  if (error) return <div className="ld-root"><NavRail active="compare" /><p className="ld-error">{error}</p></div>
  if (!assets) return <Loader stage="download" downloaded={bytes.l} total={bytes.t} bake={0} error={null} />

  const add = (e: SiteEntry) => setPicked((p) => (p.length >= MAX_SITES || p.some((x) => Math.abs(x.lat - e.lat) < 1e-4 && Math.abs(x.lon - e.lon) < 1e-4) ? p : [...p, e]))
  const remove = (id: string) => setPicked((p) => p.filter((x) => x.id !== id))
  const full = picked.length >= MAX_SITES
  const matches = searchCraters(assets.features, query, 6)
  const nyxosSites = assets.sites.filter((s) => ['Artemis III region', 'Candidate site', 'Landmark'].includes(s.group))
  const wuellerRegions = [...new Set(WUELLER_SITES.map((s) => s[1]))]
  const rows = rowList(results)
  const shown = onlyDiff ? rows.filter((r) => rowDiffers(results, r.id)) : rows
  const done = results.length === jobs.length && !progress

  return (
    <div className="ld-root">
      <NavRail active="compare" />
      <main className="ld-main">
        <header className="ld-head">
          <div>
            <h1>Site comparison</h1>
            <p>{mode === 'sites'
              ? <>Put 2 to {MAX_SITES} candidate sites side by side with the same lander, landing time and stay.</>
              : <>Take one site and see what happens if the landing slips: up to {MAX_DATES} landing times with the same lander and stay.</>} Safety, Operations and Science stay separate; there is no combined score and no ranking.</p>
            <div className="cmp-mode" role="group" aria-label="What to compare">
              <button className={mode === 'sites' ? 'on' : ''} aria-pressed={mode === 'sites'} onClick={() => setMode('sites')}>Compare sites</button>
              <button className={mode === 'dates' ? 'on' : ''} aria-pressed={mode === 'dates'} onClick={() => setMode('dates')}>Compare landing dates</button>
            </div>
          </div>
          <div className="ld-actions">
            <button disabled={!done || results.length < 1} onClick={() => downloadText(mode === 'dates' ? 'nyxos-date-comparison.csv' : 'nyxos-site-comparison.csv', compareCsv(results, { profile: profile.name, startIso: new Date(start).toISOString(), stayDays: stay }), 'text/csv')}>Download CSV</button>
          </div>
        </header>

        <section className="cmp-pick" aria-label="Sites and mission">
          <div>
            <h3>Sites ({picked.length} of {MAX_SITES})</h3>
            <ul className="cmp-chips">
              {picked.map((p) => <li key={p.id}>{p.name}<button aria-label={`Remove ${p.name}`} onClick={() => remove(p.id)}>×</button></li>)}
              {picked.length === 0 && <li>None yet. Add a site on the right.</li>}
            </ul>
            <div className="ld-two">
              <label className="cmp-add">Landing time (UTC)<input type="datetime-local" value={toInput(start)} onChange={(e) => { const v = Date.parse(e.target.value + 'Z'); if (!Number.isNaN(v)) setStart(v) }} /></label>
              <label className="cmp-add">Stay (days)<input type="number" min={1} max={30} step={0.5} value={stay} onChange={(e) => setStay(Math.max(1, Math.min(30, +e.target.value || 1)))} /></label>
            </div>
            {mode === 'dates' && (
              <div className="cmp-slips">
                <h3>Landing slips ({Math.min(slipTimes(start, slips).length, MAX_DATES)} of {MAX_DATES} dates)</h3>
                <ul className="cmp-chips">
                  {slipTimes(start, slips).map((t) => <li key={t.slipDays}>{t.slipDays === 0 ? 'Planned date' : `+${t.slipDays} d`}{t.slipDays !== 0 && <button aria-label={`Remove slip of ${t.slipDays} days`} onClick={() => setSlips((x) => x.filter((d) => d !== t.slipDays))}>×</button>}</li>)}
                </ul>
                <div className="ld-two">
                  <label className="cmp-add">Add a slip (days later)<input type="number" min={0} max={365} step={1} value={slipText} placeholder="e.g. 10" onChange={(e) => setSlipText(e.target.value)} /></label>
                  <button disabled={slipText === '' || !(+slipText > 0) || slipTimes(start, slips).length >= MAX_DATES} onClick={() => { setSlips((x) => [...x, +slipText]); setSlipText('') }}>Add this slip</button>
                </div>
                <p className="ld-hint">{picked[0] ? `Site: ${picked[0].name} (the first site in the list). ` : 'Add a site first. '}The landing time above is the planned date; each slip moves it later by whole or part days.</p>
              </div>
            )}
            <LinkForm value={link} onChange={setLink} />
            <PowerForm value={power} onChange={setPower} />
            <p className="ld-hint">Lander: {NASA_HLS.name}. Stay default is an assumption for Artemis III and can be changed.</p>
          </div>
          <div className="cmp-add">
            <label>NYXOS places
              <select disabled={full} value="" onChange={(e) => { const s = assets.sites.find((x) => x.id === e.target.value); if (s) add({ id: s.id, name: s.name, lat: s.lat, lon: s.lon }) }}>
                <option value="">Add a named place…</option>
                {['Artemis III region', 'Candidate site', 'Landmark'].map((g) => <optgroup key={g} label={g}>{nyxosSites.filter((s) => s.group === g).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}
              </select>
            </label>
            <label>Published candidate sites (Wueller et al. 2026, 130 sites)
              <select disabled={full} value="" onChange={(e) => { const w = WUELLER_SITES.find((x) => x[0] === e.target.value); if (w) add({ id: `w-${w[0]}`, name: `${w[0]} (${w[1]})`, lat: w[2], lon: w[3] }) }}>
                <option value="">Add a candidate site…</option>
                {wuellerRegions.map((g) => <optgroup key={g} label={`Region ${g}`}>{WUELLER_SITES.filter((s) => s[1] === g).map((s) => <option key={s[0]} value={s[0]}>{s[0]}</option>)}</optgroup>)}
              </select>
            </label>
            <label>Search a crater
              <input value={query} disabled={full} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Haworth" />
            </label>
            {matches.length > 0 && query && <ul className="ld-matches">{matches.map((f) => <li key={f[0] + f[1]}><button disabled={full} onClick={() => { add({ id: `c-${f[0]}-${f[1].toFixed(3)}`, name: f[0], lat: f[1], lon: f[2] }); setQuery('') }}>{f[0]} <i>{f[3].toFixed(0)} km</i></button></li>)}</ul>}
            <div className="ld-two">
              <label>Latitude (°)<input type="number" step="0.001" value={custom.lat} onChange={(e) => setCustom({ ...custom, lat: Math.max(-90, Math.min(90, +e.target.value)) })} /></label>
              <label>Longitude (°E)<input type="number" step="0.001" value={custom.lon} onChange={(e) => setCustom({ ...custom, lon: +e.target.value })} /></label>
            </div>
            <button disabled={full} onClick={() => add({ id: `p-${custom.lat}-${custom.lon}`, name: `Point ${fmtLat(custom.lat)} ${fmtLon(custom.lon)}`, lat: custom.lat, lon: custom.lon })}>Add this point</button>
          </div>
        </section>

        {jobs.length > 0 && progress && <p className="cmp-prog" role="status">Analysing {mode === 'dates' ? 'date' : 'site'} {Math.min(progress.done + 1, progress.total)} of {progress.total}: terrain, sunlight and Earth visibility…</p>}
        {picked.length > 0 && !ready.lunar && <p className="cmp-prog">Loading terrain tiles…</p>}

        {results.length > 0 && (
          <section className="ld-sec" aria-label="Comparison">
            <div className="cmp-summary" aria-live="polite">
              {verdictSummary(results).map((l) => <p key={l}>{l}</p>)}
            </div>
            <div className="cmp-scroll">
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th scope="col">{mode === 'dates' ? `${picked[0]?.name ?? ''} · ${stay} d` : `${fmtUtc(start)} · ${stay} d`}</th>
                    {results.map((r) => <th scope="col" key={r.entry.id}>{r.entry.name}<small>{mode === 'dates' && r.startMs !== undefined ? `Landing ${fmtUtc(r.startMs)}` : `${fmtLat(r.entry.lat)}, ${fmtLon(r.entry.lon)}${r.a ? ` · ${r.a.site.heightM.toFixed(0)} m · terrain ≈ ${Math.round(r.a.demResolutionM)} m` : ''}`}</small></th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr className="sect"><th colSpan={results.length + 1} scope="colgroup">Verdicts</th></tr>
                  {([['safety', 'Safety', 'Can we land?'], ['operations', 'Operations', 'Can we complete the mission?'], ['science', 'Science', 'Is it worth visiting? Evidence, never proof of ice.']] as const).map(([k, l, qn]) => (
                    <tr key={k} className={new Set(results.map((r) => r.a?.[k].status)).size > 1 ? 'diff' : ''}>
                      <th scope="row">{l}<i>{qn}</i></th>
                      {results.map((r) => <td key={r.entry.id} className="cmp-cell">{r.a ? <><Chip s={r.a[k].status} /><span className="val">{r.a[k].reasons[0] ?? ''}</span></> : <span className="val">{r.error ?? 'Not analysed'}</span>}</td>)}
                    </tr>
                  ))}
                  <tr className="sect"><th colSpan={results.length + 1} scope="colgroup">Sunlight and Earth over the stay</th></tr>
                  {accessRows(results).map((r) => (
                    <tr key={r.label} className={new Set(r.cells).size > 1 ? 'diff' : ''}>
                      <th scope="row">{r.label}<i>{r.hint}</i></th>
                      {r.cells.map((c, i) => <td key={results[i].entry.id} className="cmp-cell"><span className="val num">{c}</span></td>)}
                    </tr>
                  ))}
                  <tr className="sect"><th colSpan={results.length + 1} scope="colgroup">
                    Constraints <label className="ld-check" style={{ display: 'inline-flex', marginLeft: 12, fontWeight: 400 }}><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Only rows where the sites differ</label>
                  </th></tr>
                  {shown.map((m) => (
                    <tr key={m.id} className={rowDiffers(results, m.id) ? 'diff' : ''}>
                      <th scope="row">{m.label}{!m.gating && <i>not gating</i>}</th>
                      {results.map((r) => { const row = rowFor(r, m.id); return <td key={r.entry.id} className="cmp-cell">{row ? <><Chip s={row.status} /><span className="val">{row.value}</span></> : '–'}</td> })}
                    </tr>
                  ))}
                  {onlyDiff && shown.length === 0 && <tr><td colSpan={results.length + 1}>All sites share the same status on every row.</td></tr>}
                  <tr className="sect"><th colSpan={results.length + 1} scope="colgroup">Timing and confidence</th></tr>
                  <tr>
                    <th scope="row">How sure is the answer<i>stability against a ±1° horizon shift</i></th>
                    {results.map((r) => <td key={r.entry.id} className="cmp-cell">{r.a ? ROBUSTNESS_LABEL[r.a.sensitivity.level] : '–'}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="cmp-note">Amber bar: the sites differ on this row. A stable answer can still be a Fail. Rows marked not gating never change a verdict. Each site was analysed with its own data resolution, so compare a terrain resolution of 100 m against 500 m with care. Cold-trap and temperature rows are evidence for volatile stability, not proof of ice. Open the Landing page for any one site to see the sources, limits and figures behind each row.</p>
          </section>
        )}
      </main>
    </div>
  )
}
