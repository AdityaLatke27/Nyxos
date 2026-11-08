import type { Feature, SiteInfo } from '../data/types'
import type { CpuTerrain } from '../terrain/cpuTerrain'
import { fmtDuration, fmtLat, fmtLon } from '../state/frame'
import { useSim } from '../state/store'
import type { Series, SiteNow } from '../analysis/siteAnalysis'
import { nextCrossing } from '../analysis/siteAnalysis'
import SiteChart from './SiteChart'
import CraterOverview from './CraterOverview'
import { GRAPH_TABS } from './graphs/GraphDrawer'

interface Props {
  sites: SiteInfo[]
  features: Feature[]
  terrain: CpuTerrain
  current: { name: string; lat: number; lon: number; heightKm: number; hasTerrain: boolean } | null
  now: SiteNow | null
  series: Series | null
  busy: boolean
}

export default function Panel({ sites, features, terrain, current, now, series, busy }: Props) {
  const s = useSim()
  const timeMs = s.startDay + s.offsetHours * 3.6e6
  const standing = s.view === 'stand'

  const status = (vis: number, upWord: string, downWord: string) =>
    vis >= 0.99 ? upWord : vis <= 0.01 ? downWord : `${Math.round(vis * 100)}% of disc visible`

  let events: { label: string; hours: number }[] = []
  if (series && now) {
    const t = timeMs
    events = [
      now.sunVisible >= 0.5
        ? { label: 'Sunset', hours: nextCrossing(series, series.sun, t, false) }
        : { label: 'Sunrise', hours: nextCrossing(series, series.sun, t, true) },
      now.linkOpen
        ? { label: 'Earthset (link closes)', hours: nextCrossing(series, series.earth, t, false) }
        : { label: 'Earthrise (link opens)', hours: nextCrossing(series, series.earth, t, true) },
    ]
  }

  return (
    <aside className="sim-panel">
      <header className="sim-panel-head">
        <div>
          <h1>Crater Analysis</h1>
          <p>The Moon · NASA LRO data</p>
        </div>
        <a className="btn" href="/">
          ← NYXOS
        </a>
      </header>

      <section>
        <h2>Where</h2>
        <div className="row">
          <button className={`btn ${s.view === 'globe' ? 'on' : ''}`} onClick={() => s.setView('globe')}>
            Whole Moon
          </button>
          <button className={`btn ${s.view === 'pole' ? 'on' : ''}`} onClick={() => s.setView('pole')}>
            South pole
          </button>
        </div>

        {standing && (
          <button className="btn wide" onClick={() => s.setView(current && current.lat < -75 ? 'pole' : 'globe')}>
            ← Back to the map
          </button>
        )}

        <label className="field">
          <span>Stand at a site</span>
          <select value={s.siteId} onChange={(e) => s.selectSite(e.target.value)}>
            {s.picked && <option value="picked">Picked point · {fmtLat(s.picked.lat)} {fmtLon(s.picked.lon)}</option>}
            {groupBy(sites).map(([group, list]) => (
              <optgroup key={group} label={group}>
                {list.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button className="btn wide primary" onClick={() => s.setView('stand')} disabled={!current}>
          Stand here
        </button>
      </section>

      <CraterOverview features={features} terrain={terrain} point={current} hasTerrain={!!current?.hasTerrain} />

      <section className="graphs-launch">
        <h2>Analysis graphs</h2>
        <p className="note">Click anywhere on the Moon, then open a graph. Graphs are computed from the elevation model for that spot.</p>
        <div className="row">
          {GRAPH_TABS.map((t) => (
            <button key={t.id} className={`btn ${s.graphOpen && s.graphTab === t.id ? 'on' : ''}`} onClick={() => s.set({ graphOpen: true, graphTab: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <section className="site">
        <h2>{standing ? 'Standing at' : 'Selected site'}</h2>
        {current ? (
          <>
            <p className="site-name">
              <strong>{current.name}</strong> · {fmtLat(current.lat)} {fmtLon(current.lon)}
            </p>
            {busy && <p className="muted">Tracing the horizon…</p>}
            {now && (
              <>
                <p>
                  Sun: {now.sky.sunElev.toFixed(2)}° · {status(now.sunVisible, 'In sunlight', 'In shadow')}
                </p>
                <p>
                  Earth: {now.sky.earthElev.toFixed(2)}° · {status(now.earthVisible, 'In view', 'Below the horizon')},{' '}
                  {Math.round(now.sky.earthLit * 100)}% lit
                </p>
                <p>
                  Link to Earth {now.linkOpen ? 'open' : 'closed'} · power {now.powerPct}%
                </p>
                {events.map((ev) => (
                  <p key={ev.label} className="muted">
                    {ev.label} in {fmtDuration(ev.hours)}
                    {!isFinite(ev.hours) && ' (not within these 30 days)'}
                  </p>
                ))}
              </>
            )}
            {series && (
              <>
                <p className="muted stats">
                  Over 30 days: sunlight {series.sunlightPct.toFixed(0)}% · Earth in view {series.earthPct.toFixed(0)}% ·
                  sun + link {series.bothPct.toFixed(0)}%
                </p>
                <SiteChart series={series} />
              </>
            )}
          </>
        ) : (
          <p className="muted">Pick a site, or click the map.</p>
        )}
      </section>

    </aside>
  )
}

function groupBy(sites: SiteInfo[]) {
  const map = new Map<string, SiteInfo[]>()
  for (const s of sites) {
    if (!map.has(s.group)) map.set(s.group, [])
    map.get(s.group)!.push(s)
  }
  return [...map.entries()]
}
