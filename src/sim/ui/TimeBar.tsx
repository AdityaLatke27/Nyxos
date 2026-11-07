import type { CSSProperties } from 'react'
import { fmtUtc } from '../state/frame'
import { SPEEDS, useSim, WINDOW_HOURS } from '../state/store'

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Time controls docked along the bottom: play, speed, the 30-day scrubber, start date, Now / Live. */
export default function TimeBar() {
  const s = useSim()
  const timeMs = s.startDay + s.offsetHours * 3.6e6
  const progress = { '--p': `${(s.offsetHours / WINDOW_HOURS) * 100}%` } as CSSProperties

  return (
    <div className="time-bar" role="group" aria-label="Time">
      <button className={`tb-btn tb-play ${s.playing ? 'on' : ''}`} onClick={s.togglePlay} aria-label={s.playing ? 'Pause' : 'Play'}>
        {s.playing ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3.5" y="3" width="3" height="10" rx="0.8" />
            <rect x="9.5" y="3" width="3" height="10" rx="0.8" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.3-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5z" />
          </svg>
        )}
      </button>
      <select className="tb-select" value={s.speed} onChange={(e) => s.setSpeed(Number(e.target.value))} aria-label="Speed">
        {SPEEDS.map((sp) => (
          <option key={sp.label} value={sp.hoursPerSecond}>
            {sp.label}
          </option>
        ))}
      </select>

      <div className="tb-track">
        <input
          className="tb-slider"
          type="range"
          min={0}
          max={WINDOW_HOURS}
          step={0.25}
          value={s.offsetHours}
          style={progress}
          aria-label="Time within the 30 days"
          onChange={(e) => s.setOffsetHours(Number(e.target.value))}
        />
        <div className="tb-scale" aria-hidden="true">
          {[1, 10, 20, 30].map((d) => (
            <span key={d} style={{ left: `${((d - 1) / 30) * 100}%` }}>
              {d === 1 ? 'Day 1' : d}
            </span>
          ))}
        </div>
      </div>

      <span className="tb-time">{fmtUtc(timeMs)}</span>

      <label className="tb-date">
        <span>From</span>
        <input
          type="date"
          value={isoDay(s.startDay)}
          aria-label="Start of the 30 days"
          onChange={(e) => {
            const ms = Date.parse(e.target.value + 'T00:00:00Z')
            if (!Number.isNaN(ms)) s.setStartDay(ms)
          }}
        />
      </label>
      <button className="tb-btn" onClick={s.goNow}>
        Now
      </button>
      <button className={`tb-btn ${s.live ? 'on live' : ''}`} onClick={s.toggleLive}>
        Live
      </button>
    </div>
  )
}
