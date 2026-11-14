import { useEffect, useMemo, useRef, useState } from 'react'
import NavRail from '../ui/nav/NavRail'
import '../landing/ui/landing.css'
import './history.css'
import { COUNTRY_COLOR, FAST_FACTS, KIND_LABEL, MISSIONS, QUIZ, craterHref, landingHref, placeOf, type Kind, type Mission, type Place } from './data'

interface SiteRow { id: string; lat: number; lon: number }
const YEARS = { min: 1959, max: 2026 }
type Filter = 'all' | Kind

const MAP_W = 720, MAP_H = 360
const mx = (lon: number) => ((((lon + 180) % 360) + 360) % 360) * (MAP_W / 360)
const my = (lat: number) => (90 - lat) * (MAP_H / 180)

export default function HistoryApp() {
  const [sites, setSites] = useState<SiteRow[]>([])
  const [year, setYear] = useState(YEARS.max)
  const [filter, setFilter] = useState<Filter>('all')
  const [sel, setSel] = useState<string>('apollo11')
  const detail = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/sim/sites.json').then((r) => r.json()).then((d: SiteRow[]) => setSites(d)).catch(() => setSites([]))
  }, [])

  const placed = useMemo(() => MISSIONS.map((m) => ({ m, p: placeOf(m, sites) })), [sites])
  const visible = placed.filter(({ m }) => m.year <= year && (filter === 'all' || m.kind === filter))
  const current = MISSIONS.find((m) => m.id === sel) ?? MISSIONS[0]
  const currentPlace = placed.find((x) => x.m.id === current.id)?.p ?? null
  const mapDots = placed.filter((x): x is { m: Mission; p: Place } => !!x.p && x.m.year <= year)

  const choose = (id: string, scroll = false) => {
    setSel(id)
    if (scroll) detail.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="ld-root">
      <NavRail active="history" />
      <main className="ld-main hs-main">
        <header className="ld-head">
          <div>
            <h1>Moon history</h1>
            <p>How people and robots reached the Moon, and where they landed. Slide through the years, tap a dot on the Moon, and then go and look at the real landing spot.</p>
          </div>
        </header>

        <ul className="hs-facts" aria-label="Quick facts">
          {FAST_FACTS.map((f) => (
            <li key={f.big}><b>{f.big}</b><span>{f.small}</span></li>
          ))}
        </ul>

        <section className="hs-machine" aria-labelledby="hs-tm">
          <h2 id="hs-tm">Time machine</h2>
          <label className="hs-slider">
            <span>Show everything up to <b>{year}</b></span>
            <input type="range" min={YEARS.min} max={YEARS.max} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-valuetext={`${year}`} />
            <span className="hs-count">{mapDots.length} landings on the map, {MISSIONS.filter((m) => m.year <= year).length} missions in the story</span>
          </label>

          <div className="hs-mapwrap">
            <svg className="hs-map" viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="group" aria-label="Map of the whole Moon with landing spots">
              <defs>
                <radialGradient id="hs-g" cx="50%" cy="50%" r="75%"><stop offset="0" stopColor="#2a3040" /><stop offset="1" stopColor="#12151f" /></radialGradient>
              </defs>
              <rect width={MAP_W} height={MAP_H} rx="14" fill="url(#hs-g)" />
              {[-60, -30, 0, 30, 60].map((lat) => <line key={lat} x1="0" x2={MAP_W} y1={my(lat)} y2={my(lat)} className={lat === 0 ? 'hs-eq' : 'hs-grid'} />)}
              {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((lon) => <line key={lon} y1="0" y2={MAP_H} x1={mx(lon)} x2={mx(lon)} className={lon === 0 ? 'hs-eq' : 'hs-grid'} />)}
              <text x={MAP_W / 2} y="20" className="hs-lbl" textAnchor="middle">Near side: the face we see from Earth</text>
              <text x="12" y="20" className="hs-lbl">Far side</text>
              <text x={MAP_W - 12} y="20" className="hs-lbl" textAnchor="end">Far side</text>
              <text x="12" y={my(0) - 6} className="hs-lbl">Equator</text>
              <text x="12" y={MAP_H - 10} className="hs-lbl">South pole is the bottom edge</text>
              {mapDots.map(({ m, p }) => (
                <g key={m.id} className={`hs-dot${sel === m.id ? ' on' : ''}`} transform={`translate(${mx(p.lon)} ${my(p.lat)})`} tabIndex={0} role="button" aria-label={`${m.title}, ${m.date}`} onClick={() => choose(m.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), choose(m.id))}>
                  <circle r="14" fill="transparent" />
                  <circle r={sel === m.id ? 8 : 5.5} fill={COUNTRY_COLOR[m.country]} stroke="#060a14" strokeWidth="2" />
                </g>
              ))}
            </svg>
            <p className="ld-hint">Left to right goes west to east around the Moon, and the bottom edge is the south pole. Dots appear only for landings whose position we have from a published source.</p>
          </div>

          <div className="hs-detail" ref={detail} aria-live="polite">
            <div className="hs-dhead">
              <span className="hs-tag" style={{ borderColor: COUNTRY_COLOR[current.country], color: COUNTRY_COLOR[current.country] }}>{current.country}</span>
              <span className="hs-date">{current.date}</span>
            </div>
            <h3>{current.title}</h3>
            <p className="hs-story">{current.story}</p>
            <p className="hs-fact"><b>Did you know?</b> {current.fact}</p>
            {currentPlace ? (
              <>
                <p className="hs-pos">Landing spot: {Math.abs(currentPlace.lat).toFixed(2)}°{currentPlace.lat < 0 ? 'S' : 'N'}, {Math.abs(currentPlace.lon).toFixed(2)}°{currentPlace.lon < 0 ? 'W' : 'E'}. Source: {currentPlace.note}.</p>
                <div className="ld-actions">
                  <a className="hs-btn" href={craterHref(current, currentPlace)}>See where it landed</a>
                  <a className="hs-btn ghost" href={landingHref(current, currentPlace)}>Is the Sun up there?</a>
                </div>
              </>
            ) : (
              <p className="hs-pos">We do not have a published landing position for this one, so it is not on the map.</p>
            )}
          </div>
        </section>

        <section className="ld-sec" aria-labelledby="hs-story">
          <h2 id="hs-story">The story, mission by mission</h2>
          <div className="hs-chips" role="group" aria-label="Show missions of one kind">
            {(['all', 'crew', 'robot', 'water', 'today'] as Filter[]).map((f) => (
              <button key={f} className={`hs-chip${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? 'Everything' : KIND_LABEL[f]}</button>
            ))}
          </div>
          {visible.length === 0 && <p className="ld-sub">Nothing here yet. Slide the time machine forward.</p>}
          <ol className="hs-timeline">
            {visible.map(({ m, p }) => (
              <li key={m.id} className={`hs-item${sel === m.id ? ' on' : ''}`}>
                <div className="hs-year">{m.year}</div>
                <div className="hs-card">
                  <h3>{m.title}</h3>
                  <p className="hs-story">{m.story}</p>
                  <div className="ld-actions">
                    {p ? (
                      <>
                        <a className="hs-btn" href={craterHref(m, p)}>See where it landed</a>
                        <button className="ghost" onClick={() => choose(m.id, true)}>Show on the map</button>
                      </>
                    ) : (
                      <button className="ghost" onClick={() => choose(m.id, true)}>Read the fun fact</button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <Quiz />

        <p className="ld-hint hs-foot">Dates are the public mission dates from the space agencies and companies involved. Landing positions are published ones; the sources are shown with each. The Moon's south pole is covered in more detail on the Landing and Compare pages.</p>
      </main>
    </div>
  )
}

function Quiz() {
  const [i, setI] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const done = i >= QUIZ.length
  const q = QUIZ[Math.min(i, QUIZ.length - 1)]
  const answer = (n: number) => {
    if (picked !== null) return
    setPicked(n)
    if (n === q.answer) setScore((s) => s + 1)
  }
  return (
    <section className="ld-sec hs-quiz" aria-labelledby="hs-quiz">
      <h2 id="hs-quiz">Quick quiz</h2>
      {done ? (
        <div className="hs-qcard">
          <p className="hs-qq">You got {score} out of {QUIZ.length}.</p>
          <button className="hs-btn" onClick={() => { setI(0); setPicked(null); setScore(0) }}>Play again</button>
        </div>
      ) : (
        <div className="hs-qcard">
          <p className="hs-qn">Question {i + 1} of {QUIZ.length}</p>
          <p className="hs-qq">{q.q}</p>
          <div className="hs-opts">
            {q.options.map((o, n) => (
              <button key={o} disabled={picked !== null} className={`hs-opt${picked !== null && n === q.answer ? ' right' : ''}${picked === n && n !== q.answer ? ' wrong' : ''}`} onClick={() => answer(n)}>{o}</button>
            ))}
          </div>
          {picked !== null && (
            <div className="hs-why-a" role="status">
              <p><b>{picked === q.answer ? 'Yes!' : 'Not quite.'}</b> {q.why}</p>
              <button className="hs-btn" onClick={() => { setI(i + 1); setPicked(null) }}>{i + 1 < QUIZ.length ? 'Next question' : 'See my score'}</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
