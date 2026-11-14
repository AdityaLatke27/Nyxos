import { useEffect, useRef, useState } from 'react'
import { accessSummary, fmtSpan, nextChangeText } from '../compare'
import type { Assessment } from '../engine'

interface Step { title: string; target: string; body: (a: Assessment) => string }

const peakSunElev = (a: Assessment) => {
  const n = Math.min(a.timeline.n, Math.round((a.stayDays * 86400000) / a.timeline.stepMs) + 1)
  let m = -90
  for (let i = 0; i < n; i++) if (a.timeline.sunElev[i] > m) m = a.timeline.sunElev[i]
  return m
}

/** Every number is read from the current analysis, so the tour explains the site on screen. */
const STEPS: Step[] = [
  {
    title: 'Why the Moon\'s pole is hard',
    target: 'ld-access',
    body: (a) =>
      `The Moon's axis is tilted only about 1.5° from the plane of its orbit around the Sun, so near the pole the Sun skims the horizon and never climbs high. Here, during this stay, it peaks at ${peakSunElev(a).toFixed(1)}° above the horizon. Low light means long shadows: a ridge or crater rim can hide the Sun for days, and a lit spot can sit beside one that is dark all year.`,
  },
  {
    title: 'Power and radio both depend on the horizon',
    target: 'ld-access',
    body: (a) => {
      const x = accessSummary(a)
      return `Solar panels need the Sun and the radio needs Earth in view, and the terrain blocks both. Here the Sun is up ${x.litPct.toFixed(0)}% of the stay (longest gap ${fmtSpan(x.longestDarkH)}) and Earth is in view ${x.earthPct.toFixed(0)}% (longest gap ${fmtSpan(x.longestEarthOutH)}). The longest gaps matter most: a battery or a data buffer has to last through them.`
    },
  },
  {
    title: 'Small moves change the answer',
    target: 'ld-neighbours',
    body: () => 'Press "Check 1 km around" to run the same analysis at eight points around this site. Sunlight, Earth visibility and the verdicts can change within a kilometre, which is why a site is judged at its exact coordinates and not by region.',
  },
  {
    title: 'The date matters too',
    target: 'ld-access',
    body: (a) => `From landing: ${nextChangeText(a, 'sun')}; ${nextChangeText(a, 'earth')}. Earth's direction from the pole swings over the month, so a landing a week later can look very different. Open Compare and choose "Compare landing dates" to see this site at several landing times side by side.`,
  },
  {
    title: 'How to read the verdicts',
    target: 'ld-verdicts',
    body: () => 'Safety asks "can we land?", Operations asks "can we complete the mission?", and Science asks "is it worth visiting?". They are kept separate and never combined into a score. Rows marked Info or Not evaluated are shown for transparency. Boulders are not assessed, so a Pass is never a landing certificate, and cold or shadowed ground is evidence, not proof of ice.',
  },
]

export default function GuidedTour({ a }: { a: Assessment | null }) {
  const [open, setOpen] = useState(false)
  const [i, setI] = useState(0)
  const btn = useRef<HTMLButtonElement>(null)

  const go = (n: number) => {
    setI(n)
    const el = document.getElementById(STEPS[n].target)
    if (el) el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  }
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button ref={btn} className="ghost" disabled={!a} onClick={() => { setOpen(true); go(0) }} aria-expanded={open}>Guided tour</button>
      {open && a && (
        <aside className="ld-tour" role="dialog" aria-label="Guided tour" aria-live="polite">
          <p className="ld-tour-step">Step {i + 1} of {STEPS.length}</p>
          <h3>{STEPS[i].title}</h3>
          <p>{STEPS[i].body(a)}</p>
          <div className="ld-tour-nav">
            <button className="ghost" disabled={i === 0} onClick={() => go(i - 1)}>Back</button>
            {i < STEPS.length - 1 ? <button onClick={() => go(i + 1)}>Next</button> : <a className="ld-tour-link" href="/app/compare">Open Compare</a>}
            <button className="ghost" onClick={() => { setOpen(false); btn.current?.focus() }}>Close</button>
          </div>
        </aside>
      )}
    </>
  )
}
