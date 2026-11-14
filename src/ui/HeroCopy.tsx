import { forwardRef, useCallback, useRef, useState } from 'react'
import HowItWorks from './HowItWorks'
import './heroCopy.css'

const HeroCopy = forwardRef<HTMLDivElement>(function HeroCopy(_, ref) {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    opener.current?.focus()
  }, [])
  return (
    <div className="hero-copy" ref={ref}>
      <p className="hero-eyebrow">NASA Space Apps 2026 · Lunar Landing Site Navigator</p>
      <h1 className="hero-title">Read the light before you land.</h1>
      <p className="hero-sub">
        Compare landing sites and dates in seconds: when the Sun clears the horizon, how long the
        power lasts, and when Earth is in view to talk home.
      </p>
      <div className="hero-actions">
        <a className="hero-cta primary" href="/app/?site=im2">
          Launch Navigator
        </a>
        <button ref={opener} className="hero-cta ghost" type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">
          How it works
        </button>
      </div>
      {open && <HowItWorks onClose={close} />}
    </div>
  )
})

export default HeroCopy
