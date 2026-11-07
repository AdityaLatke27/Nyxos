import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, GodRays, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { loadSimAssets, loadSiteTerrain } from './data/loadSimAssets'
import type { SimAssets, SiteTerrain } from './data/types'
import { CpuTerrain } from './terrain/cpuTerrain'
import { useSim } from './state/store'
import { fmtUtc, frame, tickClock } from './state/frame'
import { series30, siteNow, type SiteNow } from './analysis/siteAnalysis'
import MapScene from './scene/MapScene'
import MapCamera from './scene/MapCamera'
import Labels, { OverlaySizer } from './scene/Labels'
import HoverPick, { type HoverInfo } from './scene/HoverPick'
import StandScene, { EYE_KM, nudgeLook } from './scene/StandScene'
import StandLabels from './scene/StandLabels'
import Panel from './ui/Panel'
import TimeBar from './ui/TimeBar'
import ShowMenu from './ui/ShowMenu'
import NavRail from '../ui/nav/NavRail'
import { HeatmapBaker, useHeatmap } from './analysis/useHeatmap'
import './sim.css'

function ClockDriver() {
  useFrame((_, dt) => tickClock(dt), -50)
  return null
}

// Floating UI around the full-bleed canvas (keep in step with sim.css): rail on the left,
// panel on the right, time bar along the bottom. The projection centre is shifted so the
// Moon sits in the middle of the open space rather than behind the panel.
const INSET_LEFT = 14 + 76 + 12
const INSET_RIGHT = 14 + 300 + 12
const INSET_BOTTOM = 14 + 54 + 12

function ViewCenter() {
  const { camera, size } = useThree()
  useFrame(() => {
    const persp = camera as THREE.PerspectiveCamera
    const wide = size.width > 820
    const x = wide ? (INSET_RIGHT - INSET_LEFT) / 2 : 0
    const y = wide ? INSET_BOTTOM / 2 : 0
    persp.setViewOffset(size.width, size.height, x, y, size.width, size.height)
  })
  return null
}

function Post({ sunMesh, haze }: { sunMesh: THREE.Mesh | null; haze: boolean }) {
  return (
    <EffectComposer multisampling={4} autoClear={false}>
      <Bloom mipmapBlur luminanceThreshold={0.85} luminanceSmoothing={0.25} intensity={0.55} radius={0.7} />
      {haze && sunMesh ? (
        <GodRays sun={sunMesh} samples={60} density={0.94} decay={0.93} weight={0.42} exposure={0.34} clampMax={1} blur />
      ) : (
        <></>
      )}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.3} darkness={0.45} />
    </EffectComposer>
  )
}

export default function SimApp() {
  const [assets, setAssets] = useState<SimAssets | null>(null)
  const [bytes, setBytes] = useState({ l: 0, t: 0 })
  const [error, setError] = useState<string | null>(null)
  const view = useSim((s) => s.view)
  const siteId = useSim((s) => s.siteId)
  const picked = useSim((s) => s.picked)
  const startDay = useSim((s) => s.startDay)
  const showHaze = useSim((s) => s.showHaze)
  const showPhoto = useSim((s) => s.showPhoto)
  const live = useSim((s) => s.live)
  const aim = useSim((s) => s.aim)
  const overlay = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [sunMesh, setSunMesh] = useState<THREE.Mesh | null>(null)

  useEffect(() => {
    let raf = 0
    let pending = { l: 0, t: 0 }
    loadSimAssets((l, t) => {
      pending = { l, t }
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0
          setBytes(pending)
        })
    })
      .then(setAssets)
      .catch((e: Error) => setError(e.message))
    return () => cancelAnimationFrame(raf)
  }, [])

  const terrain = useMemo(() => (assets ? new CpuTerrain(assets) : null), [assets])
  const site = useMemo(() => assets?.sites.find((s) => s.id === siteId) ?? null, [assets, siteId])

  const [siteTerrain, setSiteTerrain] = useState<SiteTerrain | null>(null)
  useEffect(() => {
    let cancelled = false
    if (site?.near) loadSiteTerrain(site).then((t) => !cancelled && setSiteTerrain(t)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [site])

  const base = useMemo(() => {
    if (siteId === 'picked' && picked) return { name: 'Picked point', lat: picked.lat, lon: picked.lon }
    if (site) return { name: site.name, lat: site.lat, lon: site.lon }
    return null
  }, [siteId, picked, site])
  const activeTerrain = siteId !== 'picked' && siteTerrain && site && siteTerrain.site.id === site.id ? siteTerrain : null

  // horizon profile for the current site (720 azimuths, true heights)
  const [analysis, setAnalysis] = useState<{ profile: Float32Array; heightKm: number; key: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!terrain || !base) return
    terrain.setSite(activeTerrain)
    setBusy(true)
    const id = setTimeout(() => {
      const profile = terrain.horizonProfile(base.lat, base.lon)
      const heightKm = terrain.heightAtLatLon(base.lat, base.lon)
      setAnalysis({ profile, heightKm, key: `${base.lat},${base.lon},${!!activeTerrain}` })
      setBusy(false)
    }, 30)
    return () => clearTimeout(id)
  }, [terrain, base, activeTerrain])

  const series = useMemo(
    () => (analysis && base ? series30(analysis.profile, base.lat, base.lon, analysis.heightKm, startDay) : null),
    [analysis, base, startDay],
  )

  const [now, setNow] = useState<SiteNow | null>(null)
  useEffect(() => {
    if (!analysis || !base) return
    const tick = () => setNow(siteNow(analysis.profile, base.lat, base.lon, analysis.heightKm, frame.timeMs))
    tick()
    const id = setInterval(tick, 200)
    return () => clearInterval(id)
  }, [analysis, base])

  const current = useMemo(
    () => (base ? { ...base, heightKm: analysis?.heightKm ?? 0, hasTerrain: !!activeTerrain } : null),
    [base, analysis, activeTerrain],
  )
  const standSite = useMemo(
    () => (base && analysis ? { lat: base.lat, lon: base.lon, heightKm: analysis.heightKm } : null),
    [base, analysis],
  )

  const heat = useHeatmap(assets, startDay)
  const onHover = useCallback((h: HoverInfo | null) => setHover(h), [])

  if (error)
    return (
      <div className="sim-loading">
        <p className="err">Couldn't load lunar data: {error}</p>
      </div>
    )

  return (
    <div className="sim-root">
      <NavRail active="craters" />
      <div className="sim-stage">
        {assets && terrain ? (
          <Canvas
            flat
            dpr={[1, 1.25]}
            gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
            camera={{ fov: 40, near: 0.001, far: 6000, position: [0, -2.6, 2.2] }}
          >
            <color attach="background" args={['#000000']} />
            <ClockDriver />
            <HeatmapBaker heat={heat} />
            <OverlaySizer overlay={overlay} />
            <MapCamera />
            <ViewCenter />
            {view !== 'stand' && (
              <>
                <MapScene assets={assets} heat={heat.texture} heatReady={heat.ready} onSunMesh={setSunMesh} />
                <Labels overlay={overlay} features={assets.features} sites={assets.sites} terrain={terrain} current={base} />
                <HoverPick terrain={terrain} onHover={onHover} />
              </>
            )}
            {view === 'stand' && standSite && (
              <>
                <StandScene assets={assets} site={standSite} siteTerrain={activeTerrain} onSunMesh={setSunMesh} />
                <StandLabels overlay={overlay} features={assets.features} site={standSite} profile={analysis?.profile ?? null} />
              </>
            )}
            <Post sunMesh={sunMesh} haze={showHaze && aim === 'wide'} />
          </Canvas>
        ) : (
          <div className="sim-loading">
            <div className="bar">
              <span style={{ transform: `scaleX(${bytes.t ? bytes.l / bytes.t : 0})` }} />
            </div>
            <p>
              Loading NASA lunar terrain · {(bytes.l / 1e6).toFixed(1)}
              {bytes.t ? ` / ${(bytes.t / 1e6).toFixed(1)}` : ''} MB
            </p>
          </div>
        )}
        <canvas ref={overlay} className="sim-overlay" />
        {hover && view !== 'stand' && (
          <div className="sim-tip" style={{ left: hover.x + 14, top: hover.y + 12 }}>
            {hover.text}
          </div>
        )}
        {view === 'stand' && current && (
          <div className="stand-hud">
            <strong>{current.name}</strong>
            <p>
              {live && <span className="live">LIVE</span>} {fmtUtc(frame.timeMs, true).replace(/^\w+, /, '')}
            </p>
            {now && (
              <>
                <p>
                  Sun {now.sky.sunElev.toFixed(2)}° · {now.sunVisible > 0.99 ? 'In sunlight' : now.sunVisible < 0.01 ? 'In shadow' : `${Math.round(now.sunVisible * 100)}% visible`}
                </p>
                <p>
                  Earth {now.sky.earthElev.toFixed(2)}° · {now.earthVisible >= 0.5 ? 'In view' : 'Hidden'}, {Math.round(now.sky.earthLit * 100)}% lit
                </p>
                <p>
                  Link {now.linkOpen ? 'open' : 'closed'} · Power {now.powerPct}%
                </p>
              </>
            )}
            <p className="eye">Eye height {(EYE_KM * 1000).toFixed(1)} m</p>
          </div>
        )}
        {view === 'stand' && (
          <div className="look-pad">
            <button aria-label="Look up" className="up" onClick={() => nudgeLook(0, 6)}>
              ▲
            </button>
            <button aria-label="Look left" className="left" onClick={() => nudgeLook(-15, 0)}>
              ◀
            </button>
            <button aria-label="Look right" className="right" onClick={() => nudgeLook(15, 0)}>
              ▶
            </button>
            <button aria-label="Look down" className="down" onClick={() => nudgeLook(0, -6)}>
              ▼
            </button>
          </div>
        )}
        {view === 'stand' && showPhoto && site?.photo && (
          <figure className="photo-inset">
            <div className="photo-frame">
              <img src={`/sim/${site.photo}`} alt={`Orbital photo around ${site.name}`} />
              <span className="photo-mark" />
            </div>
            <figcaption>
              20 km around the site, north up. LRO Wide Angle Camera global mosaic, NASA/GSFC/Arizona State University.
            </figcaption>
          </figure>
        )}
        {heat.progress < 1 && assets && (
          <div className="sim-compute">Computing 30-day horizon map · {Math.round(heat.progress * 100)}%</div>
        )}
      </div>
      {assets && terrain && (
        <>
          <TimeBar />
          <ShowMenu />
          <Panel sites={assets.sites} features={assets.features} terrain={terrain} current={current} now={now} series={series} busy={busy} />
        </>
      )}
    </div>
  )
}
