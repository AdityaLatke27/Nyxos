import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Scene from './scene/Scene'
import Logo from './ui/logo/Logo'
import type { LogoController } from './ui/logo/LogoController'
import HeroCopy from './ui/HeroCopy'
import Hud from './ui/Hud'
import Loader from './ui/Loader'
import NavRail from './ui/nav/NavRail'
import { computeLighting } from './astro/lighting'
import { loadMoonAssets, type MoonAssets } from './moon/loadMoonAssets'
import { buildIntroTimeline } from './intro/timeline'
import { intro } from './intro/introState'

export default function App() {
  const lighting = useMemo(() => computeLighting(), [])
  const [assets, setAssets] = useState<MoonAssets | null>(null)
  const [bytes, setBytes] = useState({ loaded: 0, total: 0 })
  const [bake, setBake] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logo, setLogo] = useState<LogoController | null>(null)

  const curtain = useRef<HTMLDivElement>(null)
  const hero = useRef<HTMLDivElement>(null)
  const hud = useRef<HTMLDivElement>(null)
  const rail = useRef<HTMLElement>(null)

  useEffect(() => {
    let raf = 0
    let pending = { loaded: 0, total: 0 }
    loadMoonAssets((loaded, total) => {
      pending = { loaded, total }
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0
        setBytes(pending)
      })
    })
      .then(setAssets)
      .catch((e: Error) => setError(`Couldn't load lunar data: ${e.message}`))
    return () => cancelAnimationFrame(raf)
  }, [])

  const onBakeProgress = useCallback((f: number) => setBake(f), [])
  const onReady = useCallback(() => setReady(true), [])

  useEffect(() => {
    if (!ready || !logo || !curtain.current || !hero.current || !hud.current || !rail.current) return
    const tl = buildIntroTimeline({
      logo,
      curtain: curtain.current,
      revealEls: [rail.current, hero.current, hud.current],
      onComplete: () => {},
    })
    if (import.meta.env.DEV) Object.assign(window, { __nyxosIntro: tl, __nyxosState: intro })
    return () => {
      tl.kill()
    }
  }, [ready, logo])

  const stage = ready ? 'ready' : assets ? 'bake' : 'download'

  return (
    <div className="app-root">
      <div className="canvas-layer">
        <Scene
          assets={assets}
          lighting={lighting}
          logo={logo}
          onBakeProgress={onBakeProgress}
          onReady={onReady}
        />
      </div>
      <div className="curtain" ref={curtain} />
      <Logo onReady={setLogo} />
      <NavRail ref={rail} intro />
      <HeroCopy ref={hero} />
      <Hud ref={hud} lighting={lighting} />
      <Loader stage={stage} downloaded={bytes.loaded} total={bytes.total} bake={bake} error={error} />
    </div>
  )
}
