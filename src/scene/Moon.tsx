import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { MoonAssets } from '../moon/loadMoonAssets'
import type { VisibilityMaps } from '../moon/bakeVisibility'
import { createMoonMaterial } from '../moon/moonMaterial'
import { intro } from '../intro/introState'

export const HEIGHT_SCALE = 1 // true relief — no vertical exaggeration

interface Props {
  assets: MoonAssets
  vis: VisibilityMaps
  sunDir: THREE.Vector3
  earthDir: THREE.Vector3
  earthIlluminated: number
  segments: number
}

export default function Moon({ assets, vis, sunDir, earthDir, earthIlluminated, segments }: Props) {
  const material = useMemo(
    () => createMoonMaterial(assets, vis, sunDir, earthDir, earthIlluminated, HEIGHT_SCALE),
    [assets, vis, sunDir, earthDir, earthIlluminated],
  )
  const geometry = useMemo(() => new THREE.SphereGeometry(1, segments, segments / 2), [segments])

  useEffect(
    () => () => {
      material.dispose()
      geometry.dispose()
    },
    [material, geometry],
  )

  const earthshineBase = material.uniforms.uEarthshine.value as number
  useFrame(() => {
    material.uniforms.uExposure.value = intro.exposure
    material.uniforms.uEarthshine.value = earthshineBase * intro.earthshine
  })

  return <mesh geometry={geometry} material={material} />
}
