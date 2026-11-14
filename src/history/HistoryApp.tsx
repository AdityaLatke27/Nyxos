import { useState } from 'react'
import NavRail from '../ui/nav/NavRail'
import '../landing/ui/landing.css'
import './history.css'
import { CHAPTERS, MOMENTS, WHY_POLE, eyesUrl, landingLink, siteOf, type Moment } from './data'

export default function HistoryApp() {
  const [moment, setMoment] = useState<Moment | null>(null)
  const [loaded, setLoaded] = useState(false)

  const go = (id: string) => {
    const m = MOMENTS.find((x) => x.id === id)
    if (!m) return
    setLoaded(false)
    setMoment(m)
    document.getElementById('hs-viewer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="ld-root">
      <NavRail active="history" />
      <main className="ld-main hs-main">
        <header className="ld-head">
          <div>
            <h1>Moon history</h1>
            <p>People and robots have been visiting the Moon for more than 50 years. Jump through time, then see why the poles are the hard places everyone wants to go next.</p>
          </div>
        </header>

        <section id="hs-viewer" className="hs-viewer" aria-label="NASA Eyes on the Solar System">
          <div className="hs-chips" role="toolbar" aria-label="Moments in time">
            {MOMENTS.map((m) => (
              <button key={m.id} className={`hs-chip${moment?.id === m.id ? ' on' : ''}`} aria-pressed={moment?.id === m.id} onClick={() => go(m.id)} title={m.note}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="hs-frame">
            {moment ? (
              <>
                <iframe key={moment.id} title={`NASA Eyes: ${moment.label}`} src={eyesUrl(moment.path)} allow="accelerometer; fullscreen" allowFullScreen onLoad={() => setLoaded(true)} />
                {!loaded && <div className="hs-note">Loading NASA Eyes…</div>}
              </>
            ) : (
              <div className="hs-note hs-start">
                <p>Pick a moment above to travel there with NASA's Eyes on the Solar System. Drag to look around and scroll to zoom.</p>
                <button onClick={() => go('apollo11')}>Visit Apollo 11</button>
              </div>
            )}
          </div>
          <p className="ld-hint">{moment ? `${moment.label}: ${moment.note}. ` : ''}The viewer is NASA's, shown in a frame. It loads only when you pick a moment.</p>
        </section>

        <section className="ld-sec" aria-labelledby="hs-tl">
          <h2 id="hs-tl">Moon missions, one by one</h2>
          <p className="ld-sub">Landing positions of the newer missions are from published sources, listed in the Compare page.</p>
          <ol className="hs-timeline">
            {CHAPTERS.slice().sort((a, b) => a.year.localeCompare(b.year)).map((c) => {
              const s = siteOf(c.site)
              return (
                <li key={c.id} className="hs-item">
                  <div className="hs-year">{c.year}</div>
                  <div className="hs-card">
                    <h3>{c.title}</h3>
                    <p className="hs-who">{c.who}</p>
                    <p>{c.story}</p>
                    {s && <p className="hs-pos">Landing position: {Math.abs(s.lat).toFixed(2)}°{s.lat < 0 ? 'S' : 'N'}, {Math.abs(s.lon).toFixed(2)}°{s.lon < 0 ? 'W' : 'E'}. Source: <a href={s.url} target="_blank" rel="noreferrer">{s.source}</a></p>}
                    <div className="ld-actions">
                      {c.moment && <button onClick={() => go(c.moment!)}>See it in NASA Eyes</button>}
                      {c.site && <a className="hs-btn" href={landingLink(c.site)}>Check this site in NYXOS</a>}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>

        <section className="ld-sec" aria-labelledby="hs-why">
          <h2 id="hs-why">Why the poles are different</h2>
          <div className="hs-why">
            {WHY_POLE.map((w) => (
              <details key={w.q}>
                <summary>{w.q}</summary>
                <p>{w.a}</p>
              </details>
            ))}
          </div>
          <div className="ld-actions" style={{ marginTop: 14 }}>
            <a className="hs-btn" href="/app/landing">Try a landing site</a>
            <a className="hs-btn ghost" href="/app/compare">Compare two sites</a>
          </div>
        </section>
      </main>
    </div>
  )
}
