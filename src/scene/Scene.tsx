import { useEffect, useMemo, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import type { MoonAssets } from '../moon/loadMoonAssets'
import { bakeVisibility, type VisibilityMaps } from '../moon/bakeVisibility'
import type { Lighting } from '../astro/lighting'
import type { LogoController } from '../ui/logo/LogoController'
import { FOV_DEG, intro } from '../intro/introState'
import Moon, { HEIGHT_SCALE } from './Moon'
import Sky from './Sky'
import Dust from './Dust'
import CameraRig, { type Coverage } from './CameraRig'

interface WorldProps {
  assets: MoonAssets
  lighting: Lighting
  onBakeProgress: (fraction: number) => void
  onReady: () => void
}

function World({ assets, lighting, onBakeProgress, onReady }: WorldProps) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const [vis, setVis] = useState<VisibilityMaps | null>(null)

  useEffect(() => {
    let cancelled = false
    bakeVisibility(gl, assets, lighting.sunDir, HEIGHT_SCALE, onBakeProgress).then((v) => {
      if (cancelled) v.dispose()
      else setVis(v)
    })
    return () => {
      cancelled = true
    }
  }, [gl, assets, lighting, onBakeProgress])

  useEffect(() => {
    if (!vis) return
    // Compile every program up front so the first intro frame doesn't hitch.
    const id = requestAnimationFrame(() => {
      gl.compile(scene, camera)
      requestAnimationFrame(() => onReady())
    })
    return () => cancelAnimationFrame(id)
  }, [vis, gl, scene, camera, onReady])

  const small = Math.min(window.innerWidth, window.innerHeight) < 700

  return (
    <>
      <Sky stars={assets.stars} icrfToScene={lighting.icrfToScene} />
      {vis && (
        <Moon
          assets={assets}
          vis={vis}
          sunDir={lighting.sunDir}
          earthDir={lighting.earthDir}
          earthIlluminated={lighting.earthIlluminated}
          segments={small ? 512 : 1024}
        />
      )}
      {vis && <Dust />}
    </>
  )
}

interface SceneProps {
  assets: MoonAssets | null
  lighting: Lighting
  logo: LogoController | null
  onBakeProgress: (fraction: number) => void
  onReady: () => void
}

export default function Scene({ assets, lighting, logo, onBakeProgress, onReady }: SceneProps) {
  const coverage = useMemo<Coverage | null>(
    () =>
      assets && {
        patches: assets.manifest.patches.map((p, i) => ({
          halfExtentDeg: p.extentDeg / 2,
          texelKm: assets.patches[i].texelKm,
        })),
        globalTexelKm: assets.global.texelKm,
      },
    [assets],
  )

  return (
    <Canvas
      flat
      dpr={[1, 1.75]}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: FOV_DEG, near: 0.001, far: 2400, position: [0, 0, 1 + intro.altitude] }}
    >
      <color attach="background" args={['#000000']} />
      <CameraRig logo={logo} coverage={coverage} />
      {assets && <World assets={assets} lighting={lighting} onBakeProgress={onBakeProgress} onReady={onReady} />}
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={0.82} luminanceSmoothing={0.25} intensity={0.5} radius={0.72} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.28} darkness={0.5} />
        <Noise opacity={0.03} blendFunction={BlendFunction.OVERLAY} />
      </EffectComposer>
    </Canvas>
  )
}
