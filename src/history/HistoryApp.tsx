import { useEffect, useMemo, useState } from 'react'
import NavRail from '../ui/nav/NavRail'
import '../landing/ui/landing.css'
import './history.css'
import { COUNTRY_COLOR, FAST_FACTS, INFO, KIND_LABEL, MISSIONS, QUIZ, craterHref, eyesUrl, landingHref, placeOf, type Kind, type Mission, type Place } from './data'

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
  const [open, setOpen] = useState<string | null>(null)
  const [eyesFor, setEyesFor] = useState<string | null>(null)
  const [eyesLoaded, setEyesLoaded] = useState(false)

  useEffect(() => {
    fetch('/sim/sites.json').then((r) => r.json()).then((d: SiteRow[]) => setSites(d)).catch(() => setSites([]))
  }, [])

  const placed = useMemo(() => MISSIONS.map((m) => ({ m, p: placeOf(m, sites) })), [sites])
  const visible = placed.filter(({ m }) => m.year <= year && (filter === 'all' || m.kind === filter))
  const mapDots = placed.filter((x): x is { m: Mission; p: Place } => !!x.p && x.m.year <= year)
  const selected = MISSIONS.find((m) => m.id === sel)

  const toggle = (id: string) => {
    setSel(id)
    setOpen((o) => (o === id ? null : id))
  }
  const fromMap = (id: string) => {
    setSel(id)
    setOpen(id)
    setFilter('all')
    setTimeout(() => document.getElementById(`hs-m-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }
  const launchEyes = (id: string) => {
    setEyesLoaded(false)
    setEyesFor(id)
  }

  return (
    <div className="ld-root">
      <NavRail active="history" />
      <main className="ld-main hs-main">
        <header className="ld-head">
          <div>
            <h1>Moon history</h1>
            <p>How people and robots reached the Moon. Slide through the years, tap a dot on the Moon or a mission below, and open it to see the facts and fly to it in NASA's 3D viewer.</p>
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
                <g key={m.id} className={`hs-dot${sel === m.id ? ' on' : ''}`} transform={`translate(${mx(p.lon)} ${my(p.lat)})`} tabIndex={0} role="button" aria-label={`${m.title}, ${m.date}. Open its details`} onClick={() => fromMap(m.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fromMap(m.id))}>
                  <circle r="14" fill="transparent" />
                  <circle r={sel === m.id ? 8 : 5.5} fill={COUNTRY_COLOR[m.country]} stroke="#060a14" strokeWidth="2" />
                </g>
              ))}
            </svg>
            <p className="ld-hint" aria-live="polite">
              {selected ? `Selected: ${selected.title}. ` : ''}Left to right goes west to east around the Moon, and the bottom edge is the south pole. Dots appear only for landings whose position we have from a published source.
            </p>
          </div>
        </section>

        <section className="ld-sec" aria-labelledby="hs-story">
          <h2 id="hs-story">The story, mission by mission</h2>
          <p className="ld-sub">Tap a mission to open it.</p>
          <div className="hs-chips" role="group" aria-label="Show missions of one kind">
            {(['all', 'crew', 'robot', 'water', 'today'] as Filter[]).map((f) => (
              <button key={f} className={`hs-chip${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? 'Everything' : KIND_LABEL[f]}</button>
            ))}
          </div>
          {visible.length === 0 && <p className="ld-sub">Nothing here yet. Slide the time machine forward.</p>}
          <ol className="hs-timeline">
            {visible.map(({ m, p }) => {
              const info = INFO[m.id]
              const isOpen = open === m.id
              return (
                <li key={m.id} id={`hs-m-${m.id}`} className={`hs-item${isOpen ? ' open' : ''}${sel === m.id ? ' on' : ''}`}>
                  <div className="hs-year">{m.year}</div>
                  <div className="hs-card">
                    <button className="hs-head" aria-expanded={isOpen} aria-controls={`hs-p-${m.id}`} onClick={() => toggle(m.id)}>
                      <span className="hs-dotc" style={{ background: COUNTRY_COLOR[m.country] }} aria-hidden="true" />
                      <span className="hs-htext">
                        <span className="hs-title">{m.title}</span>
                        <span className="hs-meta">{m.country} · {m.date}</span>
                      </span>
                      <span className="hs-chev" aria-hidden="true">▾</span>
                    </button>
                    <div id={`hs-p-${m.id}`} className="hs-panel" hidden={!isOpen}>
                      <p className="hs-story">{m.story}</p>
                      {info && (
                        <dl className="hs-grid">
                          <div><dt>Launched</dt><dd>{info.launched}</dd></div>
                          <div><dt>Arrived</dt><dd>{info.arrived}</dd></div>
                          <div className="wide"><dt>Purpose</dt><dd>{info.purpose}</dd></div>
                          <div className="wide"><dt>How it went</dt><dd>{info.result}</dd></div>
                          {info.parts && <div className="wide"><dt>Who and what</dt><dd>{info.parts}</dd></div>}
                          {info.place && <div className="wide"><dt>Where</dt><dd>{info.place}</dd></div>}
                        </dl>
                      )}
                      <p className="hs-fact"><b>Did you know?</b> {m.fact}</p>
                      {p && <p className="hs-pos">Landing spot: {Math.abs(p.lat).toFixed(2)}°{p.lat < 0 ? 'S' : 'N'}, {Math.abs(p.lon).toFixed(2)}°{p.lon < 0 ? 'W' : 'E'}. Source: {p.note}.</p>}
                      <div className="ld-actions">
                        {info && eyesFor !== m.id && <button className="hs-btn" onClick={() => launchEyes(m.id)}>Fly there in NASA Eyes</button>}
                        {p && <a className="hs-btn ghost" href={craterHref(m, p)}>See where it landed</a>}
                        {p && <a className="hs-btn ghost" href={landingHref(m, p)}>Is the Sun up there?</a>}
                      </div>
                      {info && eyesFor === m.id && (
                        <div className="hs-eyes">
                          <div className="hs-frame">
                            <iframe title={`NASA Eyes: ${m.title}`} src={eyesUrl(info.eyes)} allow="accelerometer; fullscreen" allowFullScreen onLoad={() => setEyesLoaded(true)} />
                            {!eyesLoaded && <div className="hs-note">Loading NASA's 3D viewer…</div>}
                          </div>
                          <p className="ld-hint">NASA's Eyes on the Solar System, set to the Moon at this mission's moment. Drag to look around and scroll to zoom. Spacecraft models appear only where NASA's viewer has them. <a href={eyesUrl(info.eyes)} target="_blank" rel="noreferrer">Open it full screen</a>. <button className="hs-linkbtn" onClick={() => setEyesFor(null)}>Close the viewer</button></p>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>

        <Quiz />

        <p className="ld-hint hs-foot">Dates are the public mission dates from the space agencies and companies involved. Landing positions are published ones; the sources are shown with each. The 3D viewer is NASA's Eyes on the Solar System. The Moon's south pole is covered in more detail on the Landing and Compare pages.</p>
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
