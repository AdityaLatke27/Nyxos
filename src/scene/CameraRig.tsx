import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { FOV_DEG, intro, MOON_RADIUS_KM, moonRadiusPx } from '../intro/introState'
import type { LogoController } from '../ui/logo/LogoController'

/**
 * During the intro the camera rides the +Z axis (straight out from the
 * near-side center) at intro.altitude, always looking at the moon's center,
 * so the zoom is a pure radial dolly. Afterwards OrbitControls take over.
 * The wordmark is laid out here, in the same frame the camera moves, so the
 * letters can never drift from the moon by even a frame.
 */
export interface Coverage {
  /** fine -> coarse; halfExtentDeg around 0°N 0°E */
  patches: { halfExtentDeg: number; texelKm: number }[]
  globalTexelKm: number
}

/** Allow at most this much on-screen magnification of the finest data under the view. */
const MAX_MAGNIFICATION = 4

function finestTexelKm(latDeg: number, lonDeg: number, coverage: Coverage) {
  for (const p of coverage.patches) {
    const margin = p.halfExtentDeg * 0.9
    if (Math.abs(latDeg) < margin && Math.abs(lonDeg) < margin) return p.texelKm
  }
  return coverage.globalTexelKm
}

export default function CameraRig({ logo, coverage }: { logo: LogoController | null; coverage: Coverage | null }) {
  const { camera, size, viewport } = useThree()
  const controls = useRef<OrbitControlsImpl>(null)
  const persp = camera as THREE.PerspectiveCamera
  if (import.meta.env.DEV) Object.assign(window, { __nyxosCamera: persp, __nyxosControls: controls })

  useFrame(() => {
    if (controls.current) controls.current.enabled = intro.controlsEnabled
    if (!intro.controlsEnabled) {
      persp.position.set(0, 0, 1 + intro.altitude)
      persp.up.set(0, 1, 0)
      persp.lookAt(0, 0, 0)
    } else if (controls.current) {
      // Slow rotation and zoom down near the surface, where a fixed angular
      // speed would whip the terrain past far too fast.
      const alt = persp.position.length() - 1
      controls.current.rotateSpeed = THREE.MathUtils.clamp(alt * 0.25, 0.025, 0.4)
      controls.current.zoomSpeed = THREE.MathUtils.clamp(alt * 0.55, 0.1, 0.8)

      // Never let the camera get close enough to blur the data under it.
      if (coverage) {
        const p = persp.position.clone().normalize()
        const lat = THREE.MathUtils.radToDeg(Math.asin(p.y))
        const lon = THREE.MathUtils.radToDeg(Math.atan2(p.x, p.z))
        const texel = finestTexelKm(lat, lon, coverage)
        const devicePx = size.height * viewport.dpr
        const minAltKm = ((texel / MAX_MAGNIFICATION) * devicePx) / (2 * Math.tan(THREE.MathUtils.degToRad(FOV_DEG / 2)))
        const target = Math.max(1.09, 1 + minAltKm / MOON_RADIUS_KM)
        const c = controls.current
        c.minDistance += (target - c.minDistance) * 0.06
      }
    }

    const distance = persp.position.length()
    const altitude = distance - 1
    const near = THREE.MathUtils.clamp(altitude * 0.25, 0.0006, 0.5)
    if (Math.abs(persp.near - near) > 1e-6) {
      persp.near = near
      persp.far = 2400
      persp.updateProjectionMatrix()
    }

    const shift =
      logo?.render({
        width: size.width,
        height: size.height,
        moonRadiusPx: moonRadiusPx(distance, size.height),
        opacity: intro.logo.opacity,
        settle: intro.logo.settle,
        oMix: intro.logo.oMix,
        oOpacity: intro.logo.oOpacity,
        tagline: intro.logo.tagline,
      }) ?? 0

    // Slide the rendered image sideways (no rotation, so no parallax) to keep
    // the moon under the logo's "O" while the whole word is centered.
    if (Math.abs(shift) > 0.01) {
      persp.setViewOffset(size.width, size.height, -shift, 0, size.width, size.height)
    } else if (persp.view?.enabled) {
      persp.clearViewOffset()
    }
  })

  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      enableDamping
      dampingFactor={0.06}
      minDistance={1.09}
      maxDistance={9}
      target={[0, 0, 0]}
    />
  )
}
