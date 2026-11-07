import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { SimAssets } from '../data/types'
import { frame } from '../state/frame'
import { LIGHTING, useSim, type Layer } from '../state/store'
import { createCapGeometry, createMapMaterials } from './moonMaterials'
import { createEarthMaterial, createSunMaterial, earthAxes, sunQuadSize } from './bodies'
import SimSky from './SimSky'

const R_KM = 1737.4
const EARTH_RADIUS_KM = 6371
const SUN_DISTANCE = 2500

const LAYER_INDEX: Record<Layer, number> = { sun: 0, earth: 1, link: 2, heat: 3, photo: 4 }

interface Props {
  assets: SimAssets
  heat: THREE.Texture
  heatReady: boolean
  onSunMesh?: (m: THREE.Mesh | null) => void
}

export default function MapScene({ assets, heat, heatReady, onSunMesh }: Props) {
  const mats = useMemo(() => createMapMaterials(assets, heat), [assets, heat])
  const globeGeo = useMemo(() => new THREE.SphereGeometry(1, 1024, 512), [])
  const capGeo = useMemo(() => createCapGeometry(1024), [])
  const earthMat = useMemo(() => createEarthMaterial(assets), [assets])
  const sunMat = useMemo(() => createSunMaterial(), [])
  const earth = useRef<THREE.Mesh>(null)
  const sun = useRef<THREE.Mesh>(null)
  const exposure = useRef(1.3)

  useEffect(
    () => () => {
      mats.globe.dispose()
      mats.cap.dispose()
      globeGeo.dispose()
      capGeo.dispose()
      earthMat.dispose()
      sunMat.dispose()
    },
    [mats, globeGeo, capGeo, earthMat, sunMat],
  )

  useEffect(() => {
    onSunMesh?.(sun.current)
    return () => onSunMesh?.(null)
  }, [onSunMesh])

  useFrame(({ camera }, dt) => {
    const s = useSim.getState()
    const u = mats.shared
    u.uSunDir.value.copy(frame.sunDir)
    u.uEarthPos.value.copy(frame.earthDir).multiplyScalar(frame.earthDistKm)
    u.uHeightScale.value = s.heightScale
    u.uHaze.value += ((s.showHaze ? 1 : 0) - u.uHaze.value) * Math.min(1, dt * 4)
    const light = LIGHTING[s.lighting]
    u.uFill.value += (light.fill - u.uFill.value) * Math.min(1, dt * 5)
    u.uCompress.value += (light.compress - u.uCompress.value) * Math.min(1, dt * 5)
    u.uEarthshine.value = 0.02 * frame.earthLit
    u.uTime.value = frame.timeMs / 1000
    const targetExp = s.view === 'pole' ? 1.55 : 1.35
    exposure.current += (targetExp - exposure.current) * Math.min(1, dt * 2)
    u.uExposure.value = exposure.current
    mats.cap.uniforms.uLayer.value = LAYER_INDEX[s.layer]
    mats.cap.uniforms.uHeatReady.value = heatReady ? 1 : 0

    if (earth.current) {
      const d = frame.earthDistKm / R_KM
      earth.current.position.copy(frame.earthDir).multiplyScalar(d)
      earth.current.scale.setScalar(EARTH_RADIUS_KM / R_KM)
      const ax = earthAxes(frame.timeMs, frame.icrfToScene)
      const eu = earthMat.uniforms
      eu.uSunDir.value.copy(frame.sunDir)
      eu.uAxisX.value.copy(ax.x)
      eu.uAxisY.value.copy(ax.y)
      eu.uAxisZ.value.copy(ax.z)
    }
    if (sun.current) {
      sun.current.position.copy(frame.sunDir).multiplyScalar(SUN_DISTANCE).add(camera.position)
      sun.current.quaternion.copy(camera.quaternion)
      sun.current.scale.setScalar(sunQuadSize(SUN_DISTANCE))
    }
  })

  return (
    <>
      <SimSky stars={assets.moon.stars} radius={4000} intensity={0.45} />
      <mesh ref={sun} material={sunMat} renderOrder={-5} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={earth} material={earthMat}>
        <sphereGeometry args={[1, 96, 48]} />
      </mesh>
      <mesh geometry={globeGeo} material={mats.globe} />
      <mesh geometry={capGeo} material={mats.cap} frustumCulled={false} />
    </>
  )
}
