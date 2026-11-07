import gsap from 'gsap'
import { distanceForRadiusPx, intro, MOON_RADIUS_KM, START_ALTITUDE_KM } from './introState'
import type { LogoController } from '../ui/logo/LogoController'

interface Targets {
  logo: LogoController
  curtain: HTMLElement
  revealEls: HTMLElement[]
  onComplete: () => void
}

const START_ALT = START_ALTITUDE_KM / MOON_RADIUS_KM

/**
 * Altitude is interpolated in log space: perceived zoom speed is proportional
 * to d(log altitude)/dt, so a 400x pull-back reads as one even, continuous
 * glide instead of crawling at first and then lurching.
 */
function logAltitudeTween(from: number, to: number, onAltitude?: (alt: number) => void) {
  const p = { t: 0 }
  const a = Math.log(from)
  const b = Math.log(to)
  return {
    target: p,
    onUpdate: () => {
      intro.altitude = Math.exp(a + (b - a) * p.t)
      onAltitude?.(intro.altitude)
    },
  }
}

const smooth = (x: number) => x * x * (3 - 2 * x)

export function heroRadiusPx(w: number, h: number) {
  return Math.min(h * 0.34, w * 0.4)
}

export function buildIntroTimeline({ logo, curtain, revealEls, onComplete }: Targets) {
  const W = window.innerWidth
  const H = window.innerHeight
  const altO = distanceForRadiusPx(logo.moonAsORadiusPx(W, H), H) - 1
  const altHero = distanceForRadiusPx(heroRadiusPx(W, H), H) - 1

  // Auto-exposure and dust both key off how far we've climbed.
  const exposureAt = (alt: number) => {
    const k = Math.min(1, Math.max(0, (Math.log(alt) - Math.log(START_ALT)) / (Math.log(0.7) - Math.log(START_ALT))))
    const e = smooth(k)
    intro.exposure = 2.4 + (1.0 - 2.4) * e
    intro.dust = 1 - smooth(Math.min(1, Math.max(0, (k - 0.25) / 0.55)))
  }

  intro.altitude = START_ALT
  intro.earthshine = 1
  exposureAt(START_ALT)
  Object.assign(intro.logo, { opacity: 0, settle: 0, oMix: 0, oOpacity: 0, tagline: 0 })
  intro.controlsEnabled = false
  gsap.set(revealEls, { opacity: 0, y: 14 })
  gsap.set(curtain, { opacity: 1 })

  const tl = gsap.timeline()

  // 1 — open on the surface: 74 km above Sinus Medii, low morning Sun
  tl.to(curtain, { opacity: 0, duration: 1.8, ease: 'sine.out' }, 0)

  // 2 — one continuous radial pull-back until the moon is the size of an "O"
  const zoomOut = logAltitudeTween(START_ALT, altO, exposureAt)
  tl.to(zoomOut.target, { t: 1, duration: 7.2, ease: 'power2.inOut', onUpdate: zoomOut.onUpdate }, 1.1)
  // letters glide in from the edges, hugging the shrinking disc
  tl.to(intro.logo, { opacity: 1, duration: 2.2, ease: 'sine.out' }, 5.2)
  tl.addLabel('formed', 8.3)

  // 3 — hold on the full wordmark
  tl.to(intro.logo, { tagline: 1, duration: 0.9, ease: 'sine.out' }, 'formed-0.2')

  // 4 — the moon hands the "O" to a glyph, the wordmark docks top-left and
  //     the moon swells into the hero
  tl.addLabel('settle', 'formed+1.9')
  tl.to(intro.logo, { tagline: 0, duration: 0.45, ease: 'sine.in' }, 'settle')
  tl.to(intro.logo, { oMix: 1, duration: 0.8, ease: 'power2.inOut' }, 'settle')
  tl.to(intro.logo, { oOpacity: 1, duration: 0.6, ease: 'sine.inOut' }, 'settle+=0.12')
  tl.to(intro.logo, { settle: 1, duration: 1.9, ease: 'power3.inOut' }, 'settle')
  const dolly = logAltitudeTween(altO, altHero)
  tl.to(dolly.target, { t: 1, duration: 3.6, ease: 'power2.inOut', onUpdate: dolly.onUpdate }, 'settle+=0.3')
  // the night side only needs to read while the moon is the "O"; the hero
  // keeps the terminator's real, near-black contrast
  tl.to(intro, { earthshine: 0.3, duration: 2.6, ease: 'sine.inOut' }, 'settle+=0.8')

  tl.to(revealEls, { opacity: 1, y: 0, duration: 1.2, ease: 'power2.out', stagger: 0.12 }, 'settle+=2.3')

  // Any input fast-forwards the intro rather than cutting it.
  const skip = () => {
    if (tl.progress() < 1) tl.timeScale(6)
  }
  const events = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const
  events.forEach((e) => window.addEventListener(e, skip, { passive: true }))
  tl.eventCallback('onComplete', () => {
    events.forEach((e) => window.removeEventListener(e, skip))
    intro.controlsEnabled = true
    onComplete()
  })

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) tl.progress(1)

  return tl
}
