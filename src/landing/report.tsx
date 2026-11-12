import { renderToStaticMarkup } from 'react-dom/server'
import type { Feature } from '../sim/data/types'
import type { Assessment } from './engine'
import { INSTRUMENTS, type NearFeature, type ShadowScan } from './nearby'
import { HazardMap, HorizonChart, LIGHT, ShadowMap, SlopeHistogram, TimelineChart, WindowCalendar } from './ui/Charts'
import { STATUS_GLYPH, STATUS_LABEL, fmtLat, fmtLon, fmtUtc, windowLines } from './ui/format'

export interface ReportContext {
  a: Assessment
  shadow: ShadowScan | 'running' | null
  crater: Feature | null
  features: NearFeature[]
  missions: { name: string; group: string; distKm: number }[]
  name: string
  generated: string
  hazardNote: string
}

export function downloadText(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const el = document.createElement('a')
  el.href = url
  el.download = name
  document.body.appendChild(el)
  el.click()
  el.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`

export function reportCsv(c: ReportContext) {
  const a = c.a
  const lines: string[] = []
  lines.push(`# NYXOS landing assessment,${csvCell(c.name)},lat ${a.site.lat},lon ${a.site.lon},start ${new Date(a.startMs).toISOString()},stay_days ${a.stayDays},profile ${csvCell(a.profile.name)}`)
  lines.push('# Frame: planetocentric latitude, east-positive longitude, mean-Earth/polar-axis; heights above 1737.4 km sphere')
  lines.push('section,id,label,status,value,limit,limit_source,data_tag,data_basis,why')
  for (const r of a.rows) lines.push(['constraint', r.id, r.label, r.status, r.value, r.limit, r.limitSource, r.tag, r.basis, r.why].map(csvCell).join(','))
  lines.push('')
  lines.push('timeline_utc,sun_elevation_deg,sun_azimuth_deg,sun_disc_visible_fraction,earth_elevation_deg,earth_azimuth_deg,earth_disc_visible_fraction')
  const tl = a.timeline
  const n = Math.min(tl.n, Math.round((a.stayDays * 86400000) / tl.stepMs) + 1)
  for (let i = 0; i < n; i++)
    lines.push([new Date(tl.startMs + i * tl.stepMs).toISOString(), tl.sunElev[i].toFixed(3), tl.sunAz[i].toFixed(2), tl.sunFrac[i].toFixed(3), tl.earthElev[i].toFixed(3), tl.earthAz[i].toFixed(2), tl.earthFrac[i].toFixed(3)].join(','))
  lines.push('')
  lines.push('horizon_azimuth_deg,horizon_elevation_deg')
  a.horizon.forEach((v, i) => lines.push(`${((i / a.horizon.length) * 360).toFixed(1)},${v.toFixed(3)}`))
  return lines.join('\n')
}

const CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{font:15px/1.55 'Space Grotesk',system-ui,sans-serif;color:#17202e;background:#fff;margin:0}
main{max-width:860px;margin:0 auto;padding:36px 28px 60px}
h1{font-size:30px;line-height:1.15;margin:0 0 6px}h2{font-size:20px;margin:34px 0 8px;padding-top:6px;border-top:1px solid #d9e0ea}h3{font-size:15px;margin:18px 0 4px}
.meta{color:#5b6a80;margin:0 0 18px}
.headline{font-size:17px;padding:14px 16px;border-left:5px solid #5b6a80;background:#f4f6f9;margin:16px 0}
.headline.FEASIBLE{border-color:#16875a}.headline.CONDITIONAL{border-color:#b56a00}.headline.NOT_RECOMMENDED{border-color:#c4283d}.headline.CANNOT_ASSESS{border-color:#5b6a80}
.three{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.box{border:1px solid #d9e0ea;border-radius:8px;padding:12px 14px;break-inside:avoid}.box h3{margin:0 0 2px}.box p{margin:2px 0;color:#5b6a80;font-size:13px}.box ul{margin:6px 0 0;padding-left:18px;font-size:13px}
.chip{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:10px;border:1.5px solid currentColor;white-space:nowrap}
.PASS{color:#16875a}.WARNING{color:#b56a00}.FAIL{color:#c4283d}.NOT_EVALUATED{color:#5b6a80}.INFO{color:#1f6fd1}
table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0}th,td{border-bottom:1px solid #e4e9f0;padding:6px 8px;text-align:left;vertical-align:top}th{color:#5b6a80;font-weight:600}
figure{margin:18px 0;break-inside:avoid}figcaption{font-weight:600;margin-bottom:4px}figure p{font-size:13px;color:#33425a;margin:4px 0}.how{color:#5b6a80}
code{font:12px ui-monospace,monospace;background:#f1f4f8;padding:0 4px;border-radius:3px}
.small{font-size:12.5px;color:#5b6a80}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media print{main{padding:0}h2{break-after:avoid}.noprint{display:none}}
@page{size:A4;margin:16mm}
`

function Chip({ s }: { s: keyof typeof STATUS_LABEL }) {
  return <span className={`chip ${s}`}>{STATUS_GLYPH[s]} {STATUS_LABEL[s]}</span>
}

function Report({ c, print }: { c: ReportContext; print: boolean }) {
  const a = c.a
  const t = LIGHT
  const shadow = c.shadow && c.shadow !== 'running' ? c.shadow : null
  return (
    <main>
      <h1>Landing assessment: {c.name}</h1>
      <p className="meta">{fmtLat(a.site.lat)}, {fmtLon(a.site.lon)} · {a.profile.name} · landing {fmtUtc(a.startMs)} · stay {a.stayDays} days · generated {c.generated.slice(0, 16).replace('T', ' ')}Z by NYXOS</p>
      <p className={`headline ${a.headline.level}`}><b>Result.</b> {a.headline.text}</p>
      <div className="three">
        <div className="box"><h3>Safety <Chip s={a.safety.status} /></h3><p>Can we land?</p><ul>{a.safety.reasons.map((r) => <li key={r}>{r}</li>)}</ul></div>
        <div className="box"><h3>Operations <Chip s={a.operations.status} /></h3><p>Can we complete the mission?</p><ul>{a.operations.reasons.map((r) => <li key={r}>{r}</li>)}</ul></div>
        <div className="box"><h3>Science <Chip s={a.science.status} /></h3><p>Is it worth visiting? Evidence, never proof of ice.</p><ul>
          {a.science.reasons.map((r) => <li key={r}>{r}</li>)}
          {c.crater && <li>Inside {c.crater[0]} ({c.crater[3].toFixed(1)} km).</li>}
          {shadow && <li>{shadow.persistentPct.toFixed(0)}% of the 4 km neighbourhood has no direct sunlight in a model year (NYXOS scan).</li>}
          <li>Hydrogen (LEND), UV and radar data not loaded.</li></ul></div>
      </div>
      <p className="small">NYXOS reports three separate verdicts and no combined score: a failed landing constraint cannot be offset by scientific interest. Statuses: Pass, Warning, Fail, Not evaluated (data missing or too coarse; never counted as a pass).</p>

      <h2>1. Assumptions</h2>
      <table><tbody>
        <tr><th>Lander profile</th><td>{a.profile.name}</td></tr>
        <tr><th>Landing slope limit</th><td>{a.profile.maxLandingSlopeDeg.value}° over {a.profile.landingZoneRadiusM.value * 2} m landing zone. <span className="small">{a.profile.maxLandingSlopeDeg.source}</span></td></tr>
        <tr><th>EVA slope limit</th><td>{a.profile.maxEvaSlopeDeg.value}° within {a.profile.evaRadiusM.value / 1000} km. <span className="small">{a.profile.maxEvaSlopeDeg.source}</span></td></tr>
        <tr><th>Sunlight requirement</th><td>{a.profile.requireLitWholeStay.value ? 'Lit for the whole stay' : 'None'}. <span className="small">{a.profile.requireLitWholeStay.source}</span></td></tr>
        <tr><th>Communication</th><td>{a.profile.requireDirectEarth.value ? 'Direct-to-Earth line of sight required, no relay' : 'Not required'}. <span className="small">{a.profile.requireDirectEarth.source}</span></td></tr>
        <tr><th>Latitude envelope</th><td>{a.profile.southPoleBandDeg.value === null ? 'None' : `within ${a.profile.southPoleBandDeg.value}° of the south pole`}</td></tr>
        <tr><th>Stay length</th><td>{a.stayDays} days. <span className="small">{a.profile.stayDays.source}</span></td></tr>
      </tbody></table>

      <h2>2. Constraint table</h2>
      <table>
        <thead><tr><th>Constraint</th><th>Status</th><th>Measured</th><th>Limit and source</th><th>Data basis</th></tr></thead>
        <tbody>{a.rows.map((r) => (
          <tr key={r.id}><td>{r.label}{!r.gating && <div className="small">not gating</div>}</td><td><Chip s={r.status} /></td><td>{r.value}<div className="small">{r.why}</div></td><td>{r.limit}<div className="small">{r.limitSource}</div></td><td><code>{r.tag}</code> {r.basis}</td></tr>
        ))}</tbody>
      </table>

      <h2>3. Figures</h2>
      <figure><figcaption>Figure 1. Sun and Earth during the stay</figcaption><TimelineChart a={a} t={t} />
        <p><span className="how">How to read:</span> solid amber line is the elevation of the Sun's centre, dashed blue the Earth's, above the geometric horizon of a smooth sphere. The strips show when at least half of each disc is above the <em>terrain</em> horizon, which is what matters for power and communications. Sun {a.stats.litPct.toFixed(1)}% lit, Earth {a.stats.earthPct.toFixed(1)}% visible; longest dark spell {a.stats.longestDarkH.toFixed(1)} h{a.stats.darkClipped && a.stats.longestDarkH > 0 ? ' (touches the window edge, so may be longer)' : ''}; longest Earth outage {a.stats.longestEarthOutH.toFixed(1)} h.</p></figure>
      <figure><figcaption>Figure 2. Terrain horizon with Sun and Earth tracks</figcaption><HorizonChart a={a} t={t} />
        <p><span className="how">How to read:</span> the grey area is the terrain horizon seen from the landing point (azimuth clockwise from north). Dots are positions of the Sun and Earth every few hours during the stay. A dot above the grey area is visible; below it, blocked by terrain. Horizon computed by ray-marching the elevation model out to 650 km with curvature included.</p></figure>
        <figure><figcaption>Figure 3. Slope hazard map</figcaption><div style={{maxWidth:420}}><HazardMap a={a} t={t} /></div>
          <p><span className="how">How to read:</span> each square is one hazard cell ({a.hazardCell ? `${a.hazardCell.cellM} m` : 'n/a'}) coloured by the 95th-percentile slope of the {a.hazardCell ? `${a.hazardCell.nativeM} m` : ''} native pixels inside it. Hatching marks cells above the landing-slope limit. Gold ring: landing zone. Dashed ring: 2 km EVA radius.</p></figure>
<figure><figcaption>Figure 4. Slope distribution</figcaption><SlopeHistogram a={a} t={t} />
          <p><span className="how">How to read:</span> bars give the share of hazard cells inside 2 km in each slope class. Cells right of the red line exceed the EVA limit. {a.eva ? `${a.eva.reachablePct.toFixed(0)}% of the area is reachable from the landing cell without crossing a cell above the limit.` : ''}</p></figure>

      <figure><figcaption>Figure 5. Start dates for a {a.stayDays}-day stay</figcaption><WindowCalendar a={a} t={t} />
        <p><span className="how">How to read:</span> a filled bar marks every start time (30-minute resolution, next 12 months) from which the entire stay stays inside the stated condition. {a.windows.litAndEarth.length ? `Sun + Earth windows (first ${Math.min(6, a.windows.litAndEarth.length)}): ` + windowLines(a, 'litAndEarth').join('; ') + '.' : a.windows.litOnly.length ? `Fully sunlit starts exist, for example ${windowLines(a, 'litOnly', 3).join('; ')}, but none that also keep Earth in view.` : 'No start in the next year keeps the whole stay sunlit.'}</p></figure>

      <h2>4. What is nearby</h2>
      <div className="grid2">
        <div>
          <h3>Persistently shadowed ground (model)</h3>
          {shadow ? <ShadowMap s={shadow} t={t} /> : <p className="small">Not computed.</p>}
          <p className="small">{shadow ? `Blue squares receive no direct sunlight in any of ${shadow.samples} 6-hourly samples across one model year, at ≈ ${Math.round(shadow.demM)} m terrain resolution; ${shadow.persistentPct.toFixed(0)}% of the ±${shadow.radiusKm} km area${shadow.nearestPersistentKm !== null ? `, nearest ${shadow.nearestPersistentKm.toFixed(1)} km away` : ''}. These are cold-trap candidates only: persistent shadow does not prove ice, and surface temperature is not modelled.` : ''}</p>
        </div>
        <div>
          <h3>Craters within 40 km</h3>
          <table><tbody>{c.features.map((f) => <tr key={f.name + f.distKm}><td>{f.name}</td><td>{f.diameterKm.toFixed(0)} km</td><td>{f.distKm.toFixed(0)} km @ {f.bearingDeg.toFixed(0)}°</td></tr>)}</tbody></table>
          <h3>Previous missions within 250 km</h3>
          {c.missions.length ? <table><tbody>{c.missions.map((m) => <tr key={m.name}><td>{m.name}</td><td>{m.distKm.toFixed(0)} km</td></tr>)}</tbody></table> : <p className="small">None in the NYXOS catalogue.</p>}
        </div>
      </div>
      <h3>Scientific evidence not assessed</h3>
      <table><tbody>{INSTRUMENTS.map((i) => <tr key={i.id}><td>{i.name}</td><td>{i.answers}</td><td><span className="chip NOT_EVALUATED">– Not loaded</span></td></tr>)}</tbody></table>
      <p className="small">A cold or shadowed place is a candidate for volatiles, not proof. Independent evidence (neutron, UV, radar) is needed and is not part of this build.</p>

      <h2>5. Methods</h2>
      <h3>Landing-zone slope</h3>
      <p>The verdict uses NASA PGDA's LOLA plane-fit slope over a 100 m baseline (product LDRM SLP_100M, 50 m pixels, 80°S to the pole), the same baseline as the NASA requirement of under 10° over 100 m. Each hazard cell (100 m near the pole, 200 m beyond 216 km) stores the steepest value in it. The landing zone is the cell containing the point and every cell within {a.profile.landingZoneRadiusM.value} m. PASS: the steepest cell is within the limit even with the map's slope error added; WARNING: within the limit but not once the error is added; FAIL: the steepest cell is over the limit. Outside 80°S the older native-pixel map is used instead (10–60 m pixels, 95th-percentile slope per cell, capped at Warning when coarser than 10 m), and it is also shown as a conservative cross-check where both exist. The EVA map still uses the native-pixel 95th-percentile slope, which is stricter than the 2 km baseline.</p>
      <h3>Roughness, elevation and temperature</h3>
      <p>Roughness is the spread of LOLA height residuals about the 100 m plane (PGDA LDRM ROUGH_100M); NASA publishes no roughness limit in the sources used, so it is reported without a verdict. Elevation and relief come from the 20 m LDEM. Temperatures are Diviner maximum and mean bolometric temperatures on 240 m bins (2009–2020), reported without a lander thermal limit.</p>
      <h3>Science: cold traps</h3>
      <p>The permanently shadowed region (PSR) map is NASA's LOLA illumination-based PSR product at 20 m. The site is checked for the nearest cell at least half PSR, within {(a.profile.coldTrapReachM.value / 1000).toFixed(0)} km. A second, independent check looks for a Diviner bin whose maximum temperature is at or below {a.profile.iceStableTempK.value} K, the cold-trap threshold of the Diviner polar products. PASS means such ground lies within the {(a.profile.evaRadiusM.value / 1000).toFixed(0)} km EVA radius, WARNING means only within the longer traverse reach, FAIL means none within reach. These distances are NYXOS assumptions and are editable. The result is evidence of thermally stable ground, not detection of ice.</p>
      <h3>Sunlight</h3>
      <p>The Sun's direction comes from {a.ephemeris === 'JPL DE440' ? 'JPL\'s DE440 ephemeris through SPICE, sampled hourly in the Moon mean-Earth/polar-axis frame (the frame of the LOLA maps) and interpolated with a four-point cubic. It agrees with JPL Horizons to 0.0007° in elevation and 0.0001° in azimuth over 847 test samples at seven sites (automated test in the repository).' : 'an analytic ephemeris (Meeus series; IAU 2009 lunar orientation), used here because the requested dates fall outside the DE440 table (2026–2035). Against JPL Horizons it differs by up to 0.26° in azimuth and 0.008° in elevation.'} At each 30-minute step the Sun's 0.2666° disc is tested against the terrain horizon; a step counts as lit when at least half of the disc is visible. Only direct sunlight is modelled: no scattered light, no atmospheric or regolith effects, no spacecraft shadowing.</p>
      <h3>Earth visibility</h3>
      <p>The Earth's direction and distance use the same ephemeris. The Earth disc (6371 km radius) is tested against the terrain horizon. This is geometric visibility only; a usable radio link also depends on antenna pointing, power and range.</p>
      <h3>Windows</h3>
      <p>For every 30-minute start time in the next year, the stay is checked against the lit (and Earth-visible) series using prefix sums. No interpolation across data gaps.</p>
      <h3>Persistent shadow</h3>
      <p>On a 9×9 grid over ±4 km the horizon is computed at each point and the Sun is stepped every 6 hours for one year. Points never lit are flagged. One year covers the 346.6-day cycle of the Sun's selenographic latitude but not every librational effect, so this is an approximation of long-term permanent shadow, not a replacement for the published PSR maps.</p>

      <h2>6. Data sources and resolution</h2>
      <table>
        <thead><tr><th>Layer</th><th>Source</th><th>Resolution</th><th>Used for</th></tr></thead>
        <tbody>
          <tr><td>Landing slope, roughness</td><td>NASA PGDA, LOLA plane-fit slope and roughness, 100 m baseline (LDRM SLP_100M, ROUGH_100M)</td><td>50 m pixels; 100–200 m cells, 80°S–pole</td><td>Landing verdict, roughness</td></tr>
          <tr><td>Elevation, PSR map</td><td>NASA PGDA, LOLA LDEM and LPSR</td><td>20 m pixels, 80°S–pole</td><td>Elevation, relief, cold-trap access</td></tr>
          <tr><td>Temperature, ice stability</td><td>LRO Diviner polar products (Williams et al. 2019; Schorghofer and Williams 2020), UCLA</td><td>240 m bins, 80°S–pole</td><td>Surface temperature, thermal cold traps</td></tr>
          <tr><td>Slope and slope error (cross-check, EVA)</td><td>NASA PGDA, LOLA slope products (LDSM, 60°S–pole)</td><td>10–60 m native; 100–480 m hazard cells</td><td>EVA terrain; landing slope outside 80°S</td></tr>
          <tr><td>Elevation for shadows</td><td>LOLA / SLDEM2015 via the NYXOS terrain pyramid</td><td>≈ {Math.round(a.demResolutionM)} m at this point (20–500 m by region)</td><td>Horizon, sunlight, Earth visibility</td></tr>
          <tr><td>Crater catalogue</td><td>IAU / USGS Gazetteer of Planetary Nomenclature</td><td>diameter ≥ 2 km</td><td>Context</td></tr>
          <tr><td>Sun / Earth position</td><td>{a.ephemeris === 'JPL DE440' ? 'JPL DE440 via SPICE (NAIF kernels moon_pa_de440, moon_de440 frame)' : 'Analytic ephemeris (outside DE440 table)'}</td><td>30 min steps</td><td>Sunlight, Earth visibility, windows</td></tr>
          <tr><td>Lander limits</td><td>{a.profile.id === 'nasa-hls' ? 'NASA Artemis HLS update, NTRS 20240009596' : 'user-defined'}</td><td>n/a</td><td>Pass / fail thresholds</td></tr>
        </tbody>
      </table>
      <p className="small">Frame: planetocentric latitude, east-positive longitude, mean-Earth / polar-axis (IAU 2009); heights above the 1737.4 km reference sphere. Data tags in the constraint table: DEM = derived from elevation data, MODEL = computed by NYXOS, CAT = catalogue value, N/A = no data.</p>

      <h2>7. Limitations</h2>
      <ul>
        <li>Boulders, small craters and surface texture are not assessed (no LROC-derived hazard map loaded). A site that passes here is not certified safe.</li>
        <li>The 100 m slope, roughness, elevation, PSR and temperature layers exist only from 80°S to the pole; between 60°S and 80°S only the native-pixel slope map exists, and north of 60°S the verdict is Not evaluated, not guessed.</li>
        <li>Illumination is limited by terrain resolution; relief smaller than the cell size can cast shadows that are not modelled.</li>
        <li>The landing slope uses the NASA 100 m baseline; the EVA map still uses native-pixel slopes, not a 2 km baseline.</li>
        <li>Hydrogen (LEND), UV and radar evidence is not included. Diviner temperatures describe the environment, not the presence of ice. Science is reported as evidence, never as a score.</li>
        <li>Stay length default ({a.stayDays} d) is an assumption and can be changed.</li>
      </ul>
      {a.gaps.length > 0 && <p><b>Gaps in this assessment:</b> {a.gaps.join(' ')}</p>}

      <h2>8. Reproducibility</h2>
      <p>Open NYXOS, go to Landing analysis, enter latitude {a.site.lat.toFixed(4)}, longitude {a.site.lon.toFixed(4)}, landing time {new Date(a.startMs).toISOString().slice(0, 16)} UTC, stay {a.stayDays} days, lander "{a.profile.name}". The accompanying CSV contains the 30-minute Sun and Earth series and the horizon profile used here. {c.hazardNote}.</p>

      <h2>9. References</h2>
      <ul className="small">
        <li>NASA, Artemis HLS update, NTRS 20240009596 (Key Artemis III landing requirements).</li>
        <li>NASA Planetary Geodesy Data Archive, LOLA digital elevation and slope products: https://pgda.gsfc.nasa.gov/products/90</li>
        <li>Smith, D. E., et al. (2017). Summary of the results from the Lunar Orbiter Laser Altimeter after seven years in lunar orbit. Icarus 283, 70–91.</li>
        <li>NASA (2022). NASA identifies candidate regions for landing the next Americans on the Moon.</li>
        <li>Meeus, J. Astronomical Algorithms. Willmann-Bell.</li>
        <li>Archinal, B. A., et al. IAU Working Group on Cartographic Coordinates and Rotational Elements reports.</li>
        <li>Park, R. S., et al. (2021). The JPL Planetary and Lunar Ephemerides DE440 and DE441. The Astronomical Journal 161, 105.</li>
        <li>JPL Horizons system, https://ssd.jpl.nasa.gov/horizons/; NAIF SPICE toolkit and lunar kernels, https://naif.jpl.nasa.gov/</li>
      </ul>
      {print && <script dangerouslySetInnerHTML={{ __html: 'window.addEventListener("load",function(){setTimeout(function(){window.print()},400)})' }} />}
    </main>
  )
}

export function buildReport(c: ReportContext, print = false): string {
  const body = renderToStaticMarkup(<Report c={c} print={print} />)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NYXOS landing assessment: ${esc(c.name)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600&display=swap" rel="stylesheet"><style>${CSS}</style></head><body>${body}</body></html>`
}
