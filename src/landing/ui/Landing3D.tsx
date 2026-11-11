import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import type { SimAssets } from '../../sim/data/types'
import type { CpuTerrain } from '../../sim/terrain/cpuTerrain'
import { useSim, utcMidnight } from '../../sim/state/store'
import { tickClock } from '../../sim/state/frame'
import MapScene from '../../sim/scene/MapScene'
import MapCamera from '../../sim/scene/MapCamera'
import Labels, { OverlaySizer } from '../../sim/scene/Labels'
import HoverPick, { type HoverInfo } from '../../sim/scene/HoverPick'

export function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

function ClockDriver() {
  useFrame((_, dt) => tickClock(dt), -50)
  return null
}

/**
 * The Crater tab's 3D south-pole terrain, embedded for choosing a landing point.
 * It reuses the same scene, camera and picking code; the shared sim clock is pinned to the
 * landing time so the shadows on screen are the ones the verdict was computed for.
 */
export default function Landing3D({
  assets,
  terrain,
  site,
  timeMs,
  onPick,
}: {
  assets: SimAssets
  terrain: CpuTerrain
  site: { name: string; lat: number; lon: number }
  timeMs: number
  onPick: (lat: number, lon: number) => void
}) {
  const overlay = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const onHover = useCallback((h: HoverInfo | null) => setHover(h), [])
  const heat = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
    t.needsUpdate = true
    return t
  }, [])

  // pole view, clock pinned to the landing time
  useEffect(() => {
    const day = utcMidnight(timeMs)
    useSim.getState().set({ view: 'pole', layer: 'sun', live: false, playing: false, startDay: day, offsetHours: (timeMs - day) / 3.6e6, picking: null })
  }, [timeMs])

  // clicks on the terrain arrive through the shared store
  const picked = useSim((s) => s.picked)
  const lastRef = useRef<typeof picked>(useSim.getState().picked)
  useEffect(() => {
    if (picked && picked !== lastRef.current) {
      lastRef.current = picked
      onPick(+picked.lat.toFixed(4), +picked.lon.toFixed(4))
    }
  }, [picked, onPick])

  const current = useMemo(() => ({ name: site.name, lat: site.lat, lon: site.lon }), [site.name, site.lat, site.lon])

  return (
    <div className="l3-stage">
      <Canvas flat dpr={[1, 1.25]} gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }} camera={{ fov: 40, near: 0.001, far: 6000, position: [0, -2.6, 2.2] }}>
        <color attach="background" args={['#000000']} />
        <ClockDriver />
        <OverlaySizer overlay={overlay} />
        <MapCamera />
        <MapScene assets={assets} heat={heat} heatReady={false} />
        <Labels overlay={overlay} features={assets.features} sites={assets.sites} terrain={terrain} current={current} />
        <HoverPick terrain={terrain} onHover={onHover} />
        <EffectComposer multisampling={0} autoClear={false}>
          <Bloom mipmapBlur luminanceThreshold={0.85} luminanceSmoothing={0.25} intensity={0.55} radius={0.7} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Vignette offset={0.3} darkness={0.45} />
        </EffectComposer>
      </Canvas>
      <canvas ref={overlay} className="l3-overlay" />
      {hover && (
        <div className="l3-tip" style={{ left: hover.x + 14, top: hover.y + 12 }}>
          {hover.text.replace(/ · (in sunlight|in shadow|\d+% sunlit)/, '')}
        </div>
      )}
      <p className="l3-help">Drag to rotate · scroll to zoom · right-drag to pan · click terrain to choose a point</p>
    </div>
  )
}
