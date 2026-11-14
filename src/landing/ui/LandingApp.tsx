import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import NavRail from '../../ui/nav/NavRail'
import Loader from '../../ui/Loader'
import { loadSimAssets, loadSiteTerrain } from '../../sim/data/loadSimAssets'
import { CpuTerrain } from '../../sim/terrain/cpuTerrain'
import type { SimAssets } from '../../sim/data/types'
import { searchCraters, craterAt } from '../../analysis/craterLookup'
import { HazardField, browserLoader, loadManifest, polarXY } from '../hazard'
import { validationSentence } from '../validation'
import { ROBUSTNESS_LABEL } from '../sensitivity'
import { loadTerrainField, type TerrainField } from '../terrain'
import { loadCraters, type CraterData } from '../craters'
import { loadLpHydrogen, type LpHydrogenData } from '../hydrogen'
import { evaluate, type Assessment } from '../engine'
import { loadEphemerisTable } from '../../astro/ephemerisTable'
import { NASA_HLS, customProfile, type LanderProfile } from '../profile'
import { INSTRUMENTS, nearbyFeatures, nearbyMissions, shadowScan, yearSunDirs, type ShadowScan } from '../nearby'
import { accessSummary, fmtSpan, litDefinitionsText, nextChangeText } from '../compare'
import { buildReport, downloadText, reportCsv, type ReportContext } from '../report'
import { DEFAULT_LINK, type LinkInputs } from '../linkBudget'
import LinkForm from './LinkForm'
import PowerForm from './PowerForm'
import NeighbourScan from './NeighbourScan'
import GuidedTour from './GuidedTour'
import { DEFAULT_POWER, type PowerInputs } from '../power'
import PolarPicker from './PolarPicker'
import Landing3D, { webglAvailable } from './Landing3D'
import { DARK, HazardMap, HorizonChart, SensitivityChart, ShadowMap, SlopeHistogram, TimelineChart, WindowCalendar } from './Charts'
import { STATUS_GLYPH, STATUS_LABEL, fmtDur, fmtLat, fmtLon, fmtUtc, windowLines } from './format'
import './landing.css'

const nextMidnight = () => {
  const d = new Date()
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}
const toInput = (ms: number) => new Date(ms).toISOString().slice(0, 16)

function Chip({ s }: { s: keyof typeof STATUS_LABEL }) {
  return (
    <span className={`ld-chip st-${s}`}>
      <b aria-hidden>{STATUS_GLYPH[s]}</b>
      {STATUS_LABEL[s]}
    </span>
  )
}

function AccessStrip({ a }: { a: Assessment }) {
  const x = accessSummary(a)
  const items: [string, string, string][] = [
    ['Sunlit', `${x.litPct.toFixed(0)}%`, 'of the stay'],
    ['Longest without sunlight', `${fmtSpan(x.longestDarkH)}${x.darkClipped && x.longestDarkH > 0 ? '+' : ''}`, 'sizes the battery'],
    ['Earth in view', `${x.earthPct.toFixed(0)}%`, 'of the stay, direct line of sight'],
    ['Longest without Earth', fmtSpan(x.longestEarthOutH), 'longest communication gap'],
    ['Neither Sun nor Earth', fmtSpan(x.longestNeitherH) + (x.neitherClipped && x.longestNeitherH > 0 ? '+' : ''), 'longest, 30 min resolution'],
  ]
  return (
    <dl id="ld-access" className="ld-access" aria-label="Sunlight and Earth access over the stay">
      {items.map(([k, v, h]) => <div key={k}><dt>{k}</dt><dd>{v}</dd><small>{h}</small></div>)}
      <p className="ld-access-note"><b>From landing:</b> {nextChangeText(a, 'sun')}; {nextChangeText(a, 'earth')}.</p>
      <p className="ld-access-note">{litDefinitionsText(a)}</p>
      <p className="ld-access-note"><b>{ROBUSTNESS_LABEL[a.sensitivity.level]}.</b> {a.sensitivity.drivers[0] ?? ''}</p>
    </dl>
  )
}

export default function LandingApp() {
  const [assets, setAssets] = useState<SimAssets | null>(null)
  const [bytes, setBytes] = useState({ l: 0, t: 0 })
  const [error, setError] = useState<string | null>(null)
  const [hazard, setHazard] = useState<HazardField | null>(null)
  const [hazardNote, setHazardNote] = useState('Loading slope tiles…')
  const [lunar, setLunar] = useState<TerrainField | null>(null)
  const [hydrogen, setHydrogen] = useState<LpHydrogenData | null>(null)
  const [craters, setCraters] = useState<CraterData | null>(null)

  useEffect(() => {
    loadSimAssets((l, t) => setBytes({ l, t })).then(setAssets).catch((e: Error) => setError(e.message))
    loadLpHydrogen().then(setHydrogen)
    loadCraters().then(setCraters)
    loadTerrainField().then(setLunar)
    loadManifest().then((m) => {
      if (m) {
        setHazard(new HazardField(m, browserLoader()))
        setHazardNote(`Slope tiles: ${m.tiers.map((t) => `${t.nativeM} m`).join(', ')} native`)
      } else setHazardNote('Slope tiles are not part of this build')
    })
  }, [])

  const terrain = useMemo(() => (assets ? new CpuTerrain(assets) : null), [assets])
  const params = new URLSearchParams(window.location.search)
  const [site, setSite] = useState({
    name: params.get('name') ?? 'Shackleton rim S',
    lat: Number(params.get('lat') ?? -89.78),
    lon: Number(params.get('lon') ?? -155.73),
  })
  const [profileId, setProfileId] = useState<'nasa-hls' | 'custom'>('nasa-hls')
  const [cust, setCust] = useState({ slope: 10, evaSlope: 20, lit: false, earth: false, polar: false })
  const [stay, setStay] = useState(NASA_HLS.stayDays.value)
  const [link, setLink] = useState<LinkInputs>(DEFAULT_LINK)
  const [power, setPower] = useState<PowerInputs>(DEFAULT_POWER)
  const [start, setStart] = useState(nextMidnight())
  const [query, setQuery] = useState('')
  const [mode3d, setMode3d] = useState(() => params.get('map') !== '2d' && webglAvailable())

  const profile: LanderProfile = useMemo(() => {
    const base = profileId === 'nasa-hls' ? NASA_HLS : customProfile({ slope: cust.slope, evaSlope: cust.evaSlope, lit: cust.lit, earth: cust.earth, band: cust.polar ? 6 : null })
    return { ...base, stayDays: { ...base.stayDays, value: stay, source: stay === NASA_HLS.stayDays.value ? base.stayDays.source : 'User-defined in NYXOS' } }
  }, [profileId, cust, stay])

  const [a, setA] = useState<Assessment | null>(null)
  const [busy, setBusy] = useState(false)
  const [shadow, setShadow] = useState<ShadowScan | 'running' | null>(null)
  const runId = useRef(0)
  const setupId = useRef(0)
  const scanId = useRef(0)

  const coldReach = profile.coldTrapReachM.value
  const near = useMemo(() => {
    if (!assets) return null
    const hit = assets.sites.find((s) => s.near && Math.abs(s.lat - site.lat) < 0.5 && Math.hypot((s.lat - site.lat) * 30.3, (s.lon - site.lon) * 30.3 * Math.cos((site.lat * Math.PI) / 180)) < 12)
    return hit ?? null
  }, [assets, site])

  // 1. Terrain for the chosen site: runs only when the site (or the layers) change, never while typing in the mission fields.
  const siteKey = `${site.lat},${site.lon},${near?.id ?? ''}`
  const [readyKey, setReadyKey] = useState('')
  useEffect(() => {
    if (!terrain || !assets) return
    const id = ++setupId.current
    setReadyKey('')
    setBusy(true)
    setShadow(null)
    const timer = setTimeout(async () => {
      terrain.setSite(null)
      if (near) {
        try {
          terrain.setSite(await loadSiteTerrain(near))
        } catch {
          /* fall back to the global pyramid */
        }
      }
      if (id !== setupId.current) return
      if (hazard && site.lat < -55) {
        const p = polarXY(site.lat, site.lon)
        await hazard.ensure(p.x, p.y, 3500)
      }
      if (lunar && site.lat < -55) {
        const p = polarXY(site.lat, site.lon)
        await lunar.ensure(p.x, p.y, coldReach + 600)
      }
      await loadEphemerisTable()
      if (id !== setupId.current) return
      setReadyKey(siteKey)
    }, 120)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, assets, hazard, lunar, siteKey, coldReach])

  // 2. The assessment: cheap once the site's horizon and year timeline are cached, so editing the stay, lander, link or time is quick.
  useEffect(() => {
    if (!terrain || readyKey !== siteKey) return
    const id = ++runId.current
    const timer = setTimeout(() => {
      if (id !== runId.current) return
      const res = evaluate({ lat: site.lat, lon: site.lon, startMs: start, profile, terrain, hazard, lunar, link, power, hydrogen, craters })
      setA(res)
      setBusy(false)
    }, 150)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, readyKey, siteKey, hazard, lunar, hydrogen, craters, site, profile, start, link, power])

  // 3. Persistent-shadow scan: depends only on the site and the start time, and stops as soon as either changes.
  useEffect(() => {
    if (!terrain || readyKey !== siteKey) return
    const id = ++scanId.current
    const timer = setTimeout(async () => {
      if (id !== scanId.current) return
      setShadow('running')
      const sc = await shadowScan(terrain, site.lat, site.lon, yearSunDirs(start), 4, 9, undefined, () => id !== scanId.current)
      if (sc && id === scanId.current) setShadow(sc)
    }, 400)
    return () => {
      clearTimeout(timer)
      scanId.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, readyKey, siteKey, site.lat, site.lon, start])

  const pick = useCallback((lat: number, lon: number, name?: string) => setSite({ lat, lon, name: name ?? `Point ${fmtLat(lat)} ${fmtLon(lon)}` }), [])

  const ctx: ReportContext | null = useMemo(() => {
    if (!a || !assets || shadow === 'running') return null
    return {
      a,
      shadow: shadow,
      crater: craterAt(assets.features, a.site.lat, a.site.lon),
      features: nearbyFeatures(assets.features, a.site.lat, a.site.lon),
      missions: nearbyMissions(assets.sites, a.site.lat, a.site.lon),
      name: site.name,
      generated: new Date().toISOString(),
      hazardNote,
    }
  }, [a, assets, shadow, site.name, hazardNote])

  if (error) return <div className="ld-root"><NavRail active="landing" /><p className="ld-error">{error}</p></div>
  if (!assets) return <Loader stage="download" downloaded={bytes.l} total={bytes.t} bake={0} error={null} />

  const matches = searchCraters(assets.features, query, 6)
  const candidates = assets.sites.filter((s) => ['Artemis III region', 'Candidate site', 'Landmark'].includes(s.group))
  const sci = ctx
  const missionEnd = a ? a.startMs + a.stayDays * 86400000 : 0

  return (
    <div className="ld-root">
      <NavRail active="landing" />
      <main className="ld-main">
        <header className="ld-head">
          <div>
            <h1>Landing analysis</h1>
            <p>Can a lander touch down here, can it stay, and what is nearby worth studying? Each answer shows its limit, source and data resolution.</p>
          </div>
          <div className="ld-actions">
            <GuidedTour a={a} />
            <button disabled={!ctx} onClick={() => ctx && downloadText(`nyxos-landing-${site.name.replace(/\W+/g, '-')}.html`, buildReport(ctx), 'text/html')}>Download report</button>
            <button className="ghost" disabled={!ctx} onClick={() => { if (!ctx) return; const w = window.open('', '_blank'); if (w) { w.document.write(buildReport(ctx, true)); w.document.close() } }}>Print / save PDF</button>
            <button className="ghost" disabled={!ctx} onClick={() => ctx && downloadText(`nyxos-landing-${site.name.replace(/\W+/g, '-')}.csv`, reportCsv(ctx), 'text/csv')}>CSV</button>
            <button className="ghost" disabled={!ctx} onClick={() => ctx && downloadText(`nyxos-landing-${site.name.replace(/\W+/g, '-')}.json`, JSON.stringify({ ...ctx, a: { ...ctx.a, timeline: undefined, horizon: undefined, grid: undefined, eva: ctx.a.eva && { ...ctx.a.eva, slopes: undefined } } }, null, 1), 'application/json')}>JSON</button>
          </div>
        </header>

        <section className="ld-setup" aria-label="Site and mission">
          <div className="ld-mapwrap">
            <div className="ld-seg" role="group" aria-label="Map type">
              <button className={mode3d ? 'on' : ''} onClick={() => setMode3d(true)}>3D terrain</button>
              <button className={!mode3d ? 'on' : ''} onClick={() => setMode3d(false)}>2D map</button>
            </div>
            {mode3d && terrain ? (
              <Landing3D assets={assets} terrain={terrain} site={site} timeMs={start} onPick={pick} />
            ) : (
              <PolarPicker sites={candidates} lat={site.lat} lon={site.lon} onPick={pick} imgSrc="/sim/lro_pole.webp" />
            )}
            <p className="ld-hint">{mode3d ? 'Shadows show the Sun at your landing time. Click any ground to analyse it; use the place list for named sites.' : 'Click the map or a marker. Amber markers are NASA Artemis III regions and candidate sites in NYXOS.'}</p>
          </div>
          <div className="ld-form">
            <label>Place
              <select value={candidates.find((s) => s.lat === site.lat && s.lon === site.lon)?.id ?? ''} onChange={(e) => { const s = assets.sites.find((x) => x.id === e.target.value); if (s) pick(s.lat, s.lon, s.name) }}>
                <option value="">Custom point</option>
                {['Artemis III region', 'Candidate site', 'Landmark'].map((g) => (
                  <optgroup key={g} label={g}>{candidates.filter((s) => s.group === g).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
                ))}
                <optgroup label="Apollo (outside HLS envelope)">{assets.sites.filter((s) => s.group === 'Apollo').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
              </select>
            </label>
            <label>Search a crater
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Haworth" />
            </label>
            {matches.length > 0 && <ul className="ld-matches">{matches.map((f) => <li key={f[0] + f[1]}><button onClick={() => { pick(f[1], f[2], f[0]); setQuery('') }}>{f[0]} <i>{f[3].toFixed(0)} km</i></button></li>)}</ul>}
            <div className="ld-two">
              <label>Latitude (°)<input type="number" step="0.001" value={site.lat} onChange={(e) => pick(Math.max(-90, Math.min(90, +e.target.value)), site.lon)} /></label>
              <label>Longitude (°E)<input type="number" step="0.001" value={site.lon} onChange={(e) => pick(site.lat, +e.target.value)} /></label>
            </div>
            <label>Lander
              <select value={profileId} onChange={(e) => setProfileId(e.target.value as 'nasa-hls' | 'custom')}>
                <option value="nasa-hls">{NASA_HLS.name}</option>
                <option value="custom">Custom lander</option>
              </select>
            </label>
            {profileId === 'custom' && (
              <div className="ld-custom">
                <div className="ld-two">
                  <label>Landing slope (°)<input type="number" min={1} max={30} value={cust.slope} onChange={(e) => setCust({ ...cust, slope: +e.target.value })} /></label>
                  <label>EVA slope (°)<input type="number" min={1} max={40} value={cust.evaSlope} onChange={(e) => setCust({ ...cust, evaSlope: +e.target.value })} /></label>
                </div>
                <label className="ld-check"><input type="checkbox" checked={cust.lit} onChange={(e) => setCust({ ...cust, lit: e.target.checked })} /> Needs sunlight the whole stay</label>
                <label className="ld-check"><input type="checkbox" checked={cust.earth} onChange={(e) => setCust({ ...cust, earth: e.target.checked })} /> Needs direct-to-Earth link</label>
                <label className="ld-check"><input type="checkbox" checked={cust.polar} onChange={(e) => setCust({ ...cust, polar: e.target.checked })} /> Limit to within 6° of the south pole</label>
              </div>
            )}
            <div className="ld-two">
              <label>Landing time (UTC)<input type="datetime-local" value={toInput(start)} onChange={(e) => { const v = Date.parse(e.target.value + 'Z'); if (!Number.isNaN(v)) setStart(v) }} /></label>
              <label>Stay (days)<input type="number" min={1} max={30} step={0.5} value={stay} onChange={(e) => setStay(Math.max(1, Math.min(30, +e.target.value || 1)))} /></label>
            </div>
            <LinkForm value={link} onChange={setLink} />
            <PowerForm value={power} onChange={setPower} />
            <p className="ld-hint">Stay default is an assumption for Artemis III and can be changed. {hazardNote}.</p>
          </div>
        </section>

        {!a ? (
          <p className="ld-busy">Analysing terrain, sunlight and Earth visibility…</p>
        ) : (
          <div className={busy ? 'ld-stale' : ''}>
            <section className="ld-verdict" aria-label="Verdict">
              <div className="ld-where">
                <h2>{site.name}</h2>
                <p>{fmtLat(a.site.lat)}, {fmtLon(a.site.lon)} · surface height {a.site.heightM.toFixed(0)} m · {a.profile.name} · {fmtUtc(a.startMs)} for {a.stayDays} d</p>
              </div>
              <p className={`ld-headline lv-${a.headline.level}`}>{a.headline.text}</p>
              <AccessStrip a={a} />
              <div className="ld-cards">
                <article className="ld-card">
                  <h3>Safety <Chip s={a.safety.status} /></h3>
                  <p className="q">Can we land?</p>
                  <ul>{a.safety.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                </article>
                <article className="ld-card">
                  <h3>Operations <Chip s={a.operations.status} /></h3>
                  <p className="q">Can we complete the mission?</p>
                  <ul>{a.operations.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                </article>
                <article className="ld-card">
                  <h3>Science <Chip s={a.science.status} /></h3>
                  <p className="q">Is it worth visiting? <span className="ld-hint">Evidence, never proof of ice.</span></p>
                  <ul>
                    {a.science.reasons.map((r) => <li key={r}>{r}</li>)}
                    {sci?.crater && <li>Inside {sci.crater[0]} ({sci.crater[3].toFixed(1)} km across).</li>}
                    {shadow === 'running' && <li>Scanning for permanently shadowed ground…</li>}
                    {shadow && shadow !== 'running' && <li>{shadow.persistentPct > 0 ? `${shadow.persistentPct.toFixed(0)}% of the 4 km neighbourhood receives no direct sunlight in a model year${shadow.nearestPersistentKm !== null ? `; nearest ${shadow.nearestPersistentKm.toFixed(1)} km away` : ''} (NYXOS model scan, a cross-check of the NASA PSR map).` : 'No persistently shadowed ground found within 4 km in the model year.'}</li>}
                    <li>Hydrogen is regional context only (Lunar Prospector); LEND, UV and radar evidence are not loaded.</li>
                  </ul>
                </article>
              </div>
            </section>

            <section className="ld-sec" id="ld-verdicts">
              <h2>Constraints</h2>
              <p className="ld-sub">Gating rows decide Safety and Operations. Rows marked info or not evaluated are shown for transparency and never count as a pass.</p>
              <div className="ld-table" role="table">
                {a.rows.map((r) => (
                  <details key={r.id} className={`ld-row st-${r.status}`}>
                    <summary>
                      <span className="n">{r.label}{!r.gating && <i> · not gating</i>}</span>
                      <span className="v">{r.value}</span>
                      <Chip s={r.status} />
                    </summary>
                    <dl>
                      <dt>Why</dt><dd>{r.why}</dd>
                      <dt>Limit</dt><dd>{r.limit}</dd>
                      <dt>Limit source</dt><dd>{r.limitSource}</dd>
                      <dt>Data</dt><dd><code>{r.tag}</code> {r.basis}</dd>
                    </dl>
                  </details>
                ))}
              </div>
            </section>

            <section className="ld-sec">
              <h2>Figures</h2>
              <div className="ld-figs">
                <figure><figcaption>Sun and Earth during the stay</figcaption><TimelineChart a={a} t={DARK} /><p>Lines show disc-centre elevation. The strips below show when at least half of each disc clears the terrain horizon.</p></figure>
                <figure><figcaption>Terrain horizon and sky tracks</figcaption><HorizonChart a={a} t={DARK} /><p>A dot above the grey horizon means that body is visible at that moment.</p></figure>
                <figure><figcaption>Slope hazard map (2 km)</figcaption><HazardMap a={a} t={DARK} /><p>Gold circle: {a.profile.landingZoneRadiusM.value} m landing zone. Dashed: 2 km EVA radius. Hatched: 95th-percentile slope above {a.profile.maxLandingSlopeDeg.value}°.</p></figure>
                <figure><figcaption>How sure is this?</figcaption><SensitivityChart a={a} t={DARK} />
                  <p><span className={`ld-chip st-${a.sensitivity.level === 'ROBUST' ? 'INFO' : a.sensitivity.level === 'SENSITIVE' ? 'WARNING' : 'FAIL'}`}>{ROBUSTNESS_LABEL[a.sensitivity.level]}</span> {a.sensitivity.drivers.join(' ')}</p></figure>
                <figure><figcaption>Slope distribution</figcaption><SlopeHistogram a={a} t={DARK} /><p>Share of 2 km hazard cells per slope class. Hatched bars exceed the EVA limit.</p></figure>
                <figure className="wide"><figcaption>When can a {a.stayDays}-day stay start?</figcaption><WindowCalendar a={a} t={DARK} /><p>
                  {a.windows.litAndEarth.length ? `First sunlit + Earth-visible start: ${windowLines(a, 'litAndEarth', 1)[0]}` : a.windows.litOnly.length ? `First fully sunlit start: ${windowLines(a, 'litOnly', 1)[0]}. No start keeps Earth in view throughout.` : 'No start time in the next year keeps the surface sunlit for the whole stay.'}</p></figure>
              </div>
            </section>

            {terrain && readyKey === siteKey && <NeighbourScan base={{ lat: site.lat, lon: site.lon, startMs: start, profile, terrain, hazard, lunar }} />}

            <section className="ld-sec">
              <h2>What is nearby</h2>
              <div className="ld-near">
                <div>
                  <h3>Persistently shadowed ground</h3>
                  {shadow && shadow !== 'running' ? <ShadowMap s={shadow} t={DARK} /> : <p className="ld-hint">Scanning…</p>}
                  <p className="ld-hint">Blue squares: no direct sunlight in any 6-hourly sample of one model year at ≈ {shadow && shadow !== 'running' ? Math.round(shadow.demM) : '…'} m terrain resolution. Shadow alone is not evidence of ice.</p>
                </div>
                <div>
                  <h3>Craters within 40 km</h3>
                  <table className="ld-t"><tbody>{(ctx?.features ?? []).map((f) => <tr key={f.name + f.distKm}><td>{f.name}</td><td>{f.diameterKm.toFixed(0)} km</td><td>{f.distKm.toFixed(0)} km @ {f.bearingDeg.toFixed(0)}°</td></tr>)}</tbody></table>
                  <h3>Previous missions within 250 km</h3>
                  {ctx?.missions.length ? <table className="ld-t"><tbody>{ctx.missions.map((m) => <tr key={m.name}><td>{m.name}</td><td>{m.distKm.toFixed(0)} km</td></tr>)}</tbody></table> : <p className="ld-hint">None in the catalogue.</p>}
                  <h3>Evidence not yet loaded</h3>
                  <table className="ld-t"><tbody>{INSTRUMENTS.map((i) => <tr key={i.id}><td>{i.name}</td><td>{i.answers}</td></tr>)}</tbody></table>
                </div>
              </div>
            </section>

            <section className="ld-sec">
              <h2>Data and method</h2>
              <p className="ld-sub">Open the downloadable report for the full methods, validation and reference list.</p>
              <table className="ld-t"><tbody>
                <tr><td>Landing slope (verdict)</td><td>NASA PGDA LOLA plane-fit slope over a 100 m baseline (50 m pixels), the same baseline as the NASA requirement. Covers 80°S to the pole.</td></tr>
                <tr><td>Slope cross-check, EVA map</td><td>NASA PGDA LOLA slope maps (10–60 m native). Cell value = 95th-percentile slope of the native pixels; 60°S to the pole.</td></tr>
                <tr><td>EVA slope (verdict)</td><td>NASA PGDA LOLA plane-fit slope over a 1600 m baseline, the nearest published baseline to the 2 km of the requirement. 80°S to the pole.</td></tr>
                <tr><td>Roughness, elevation, shadowed regions</td><td>PGDA LOLA roughness (100 m baseline), LDEM height (20 m) and permanently shadowed region map (20 m); 80°S to the pole.</td></tr>
                <tr><td>Temperature and ice stability</td><td>LRO Diviner maximum and mean temperature, ice-table depth and cold-trap fraction, 240 m bins, 80°S to the pole (Williams et al. 2019; Schorghofer and Williams 2020).</td></tr>
                <tr><td>Terrain for shadows</td><td>NYXOS elevation pyramid, 20–500 m cells from LOLA / SLDEM2015; local resolution ≈ {Math.round(a.demResolutionM)} m here.</td></tr>
                <tr><td>Sun and Earth position</td><td>{a.ephemeris === 'JPL DE440' ? 'JPL DE440 (SPICE, Moon mean-Earth frame), hourly table with cubic interpolation; matches JPL Horizons within 0.001°.' : 'Analytic model (the requested dates are outside the DE440 table, 2026–2035); good to about 0.26° in azimuth.'} Direct sunlight only, disc half-lit counts as lit.</td></tr>
                <tr><td>Illumination check</td><td>{validationSentence()}</td></tr>
                <tr><td>Not assessed</td><td>{a.gaps.join(' ')}</td></tr>
              </tbody></table>
              <p className="ld-hint">Ends {fmtUtc(missionEnd)} · stay length {fmtDur(a.stayDays * 24)}.</p>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
