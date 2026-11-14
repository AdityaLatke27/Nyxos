import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './howItWorks.css'

const STEPS = [
  { t: 'Pick a place and a day', d: 'Choose a landing site from the list or type any lunar coordinates, then set the landing date and how long the lander stays.' },
  { t: 'We work out the light', d: 'Sun and Earth positions come from the JPL DE440 ephemeris. We trace the horizon over real NASA LOLA terrain, including the Moon\'s curve, to see when the Sun and Earth clear it.' },
  { t: 'Three separate answers', d: 'Safety (slope), Operations (sunlight, Earth link and your lander\'s limits) and Science (shadowed, cold ground). Each shows PASS, WARNING, FAIL or NOT EVALUATED with its source. There is no single score.' },
  { t: 'Compare and plan', d: 'Put sites or dates side by side to see what a delay does, then export a report. Every number states where it came from and how detailed the data is.' },
]

const LINKS = [
  { href: '/app/?site=im2', label: 'Crater explorer' },
  { href: '/app/landing', label: 'Landing analysis' },
  { href: '/app/compare', label: 'Compare' },
  { href: '/app/history', label: 'Moon history' },
]

export default function HowItWorks({ onClose }: { onClose: () => void }) {
  const closeBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="hiw-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hiw-card" role="dialog" aria-modal="true" aria-labelledby="hiw-title">
        <button ref={closeBtn} className="hiw-x" onClick={onClose} aria-label="Close">×</button>
        <h2 id="hiw-title">How NYXOS works</h2>
        <p className="hiw-lead">NYXOS helps you decide quickly whether a place on the Moon is worth landing at, and when.</p>
        <ol className="hiw-steps">
          {STEPS.map((s) => (
            <li key={s.t}><b>{s.t}</b><span>{s.d}</span></li>
          ))}
        </ol>
        <div className="hiw-links">
          {LINKS.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
        </div>
        <p className="hiw-note">Slope screening only: boulders and small craters are not assessed. Cold or shadowed ground is evidence, not proof of ice.</p>
      </div>
    </div>,
    document.body,
  )
}
