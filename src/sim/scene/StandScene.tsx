import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { SimAssets, SiteTerrain } from '../data/types'
import { siteFrame } from '../terrain/cpuTerrain'
import { setSiteUniforms } from '../terrain/simTerrainGLSL'
import { frame } from '../state/frame'
import { LIGHTING, useSim } from '../state/store'
import { skyAt } from '../analysis/siteAnalysis'
import { createRingGeometry, createRockGeometry, createRockMaterial, createStandMaterial } from './standMaterials'
import { createEarthMaterial, createSunMaterial, earthAxes, sunQuadSize } from './bodies'
import SimSky from './SimSky'

export const EYE_KM = 0.0017
const SKY_DIST = 90000
const GROWTH = 1.035

/** Look direction shared with the overlay and the look pad. Degrees; yaw clockwise from north. */
export const look = { yaw: 0, pitch: 3, fov: 60, tYaw: 0, tPitch: 3, tFov: 60, initialized: false }

export function nudgeLook(dYaw: number, dPitch: number) {
  look.tYaw += dYaw
  look.tPitch = THREE.MathUtils.clamp(look.tPitch + dPitch, -60, 85)
  useSim.getState().set({ aim: 'wide' })
}

export function lookDir(yawDeg: number, pitchDeg: number, out = new THREE.Vector3()) {
  const y = THREE.MathUtils.degToRad(yawDeg)
  const p = THREE.MathUtils.degToRad(pitchDeg)
  return out.set(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p))
}

interface Props {
  assets: SimAssets
  site: { lat: number; lon: number; heightKm: number } | null
  siteTerrain: SiteTerrain | null
  onSunMesh?: (m: THREE.Mesh | null) => void
}

export default function StandScene({ assets, site, siteTerrain, onSunMesh }: Props) {
  const { camera, gl } = useThree()
  const material = useMemo(() => createStandMaterial(assets), [assets])
  const geometry = useMemo(() => createRingGeometry(720, GROWTH), [])
  const rockMat = useMemo(() => createRockMaterial(material), [material])
  const rockGeo = useMemo(() => createRockGeometry(), [])
  const earthMat = useMemo(() => createEarthMaterial(assets), [assets])
  const sunMat = useMemo(() => createSunMaterial(), [])
  const sun = useRef<THREE.Mesh>(null)
  const earth = useRef<THREE.Mesh>(null)
  const persp = camera as THREE.PerspectiveCamera

  const basis = useMemo(() => {
    if (!site) return null
    const f = siteFrame(site.lat, site.lon)
    const east = new THREE.Vector3(...f.east)
    const up = new THREE.Vector3(...f.up)
    const south = new THREE.Vector3(...f.north).negate()
    const localToScene = new THREE.Matrix3().set(
      east.x, up.x, south.x,
      east.y, up.y, south.y,
      east.z, up.z, south.z,
    )
    const sceneToLocal = localToScene.clone().transpose()
    return { f, localToScene, sceneToLocal }
  }, [site])

  useEffect(() => {
    material.side = THREE.DoubleSide
    return () => {
      material.dispose()
      geometry.dispose()
      rockMat.dispose()
      rockGeo.dispose()
      earthMat.dispose()
      sunMat.dispose()
    }
  }, [material, geometry, rockMat, rockGeo, earthMat, sunMat])

  useEffect(() => {
    if (!basis || !site) return
    const u = material.uniforms as ReturnType<typeof createStandMaterial>['uniforms'] & Record<string, { value: unknown }>
    setSiteUniforms(u as never, siteTerrain && siteTerrain.site.lat === site.lat ? siteTerrain : null, basis.f)
    ;(u.uSiteUp.value as THREE.Vector3).fromArray(basis.f.up)
    ;(u.uSiteEast.value as THREE.Vector3).fromArray(basis.f.east)
    ;(u.uSiteNorth.value as THREE.Vector3).fromArray(basis.f.north)
    u.uSiteH.value = site.heightKm
    // first look: toward the Sun if it is up, otherwise toward Earth
    const sky = skyAt(site.lat, site.lon, site.heightKm, frame.timeMs)
    const yaw = sky.sunElev > -2 ? sky.sunAz : sky.earthAz
    look.yaw = look.tYaw = yaw
    look.pitch = look.tPitch = 3
    look.fov = look.tFov = 60
    look.initialized = true
  }, [basis, site, siteTerrain, material])

  useEffect(() => {
    onSunMesh?.(sun.current)
    return () => onSunMesh?.(null)
  }, [onSunMesh, basis])

  // drag to look, wheel to zoom
  useEffect(() => {
    const el = gl.domElement
    let drag: { x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      if (useSim.getState().view !== 'stand') return
      drag = { x: e.clientX, y: e.clientY }
    }
    const move = (e: PointerEvent) => {
      if (!drag) return
      const k = (0.75 * look.fov) / el.clientHeight
      look.tYaw -= (e.clientX - drag.x) * k
      look.tPitch = THREE.MathUtils.clamp(look.tPitch + (e.clientY - drag.y) * k, -60, 85)
      drag = { x: e.clientX, y: e.clientY }
      if (useSim.getState().aim !== 'wide') useSim.getState().set({ aim: 'wide' })
    }
    const up = () => (drag = null)
    const wheel = (e: WheelEvent) => {
      if (useSim.getState().view !== 'stand') return
      e.preventDefault()
      look.tFov = THREE.MathUtils.clamp(look.tFov * Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0009), 0.8, 100)
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      el.removeEventListener('wheel', wheel)
    }
  }, [gl])

  const rocks = useRef<THREE.Mesh>(null)
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__nyxosStand = { material, rocks, gl }
  }, [material, gl])

  const tmp = useMemo(() => ({ v: new THREE.Vector3(), w: new THREE.Vector3() }), [])

  useFrame((_, dt) => {
    if (!basis || !site) return
    const s = useSim.getState()
    const u = material.uniforms
    u.uSunDir.value.copy(frame.sunDir)
    u.uEarthPos.value.copy(frame.earthDir).multiplyScalar(frame.earthDistKm)
    u.uHaze.value += ((s.showHaze ? 1 : 0) - u.uHaze.value) * Math.min(1, dt * 4)
    const light = LIGHTING[s.lighting]
    u.uFill.value += (light.fill - u.uFill.value) * Math.min(1, dt * 5)
    u.uCompress.value += (light.compress - u.uCompress.value) * Math.min(1, dt * 5)
    u.uEarthshine.value = 0.025 * frame.earthLit

    // aim
    const sky = skyAt(site.lat, site.lon, site.heightKm, frame.timeMs)
    if (s.aim === 'sun') {
      look.tYaw = sky.sunAz
      look.tPitch = sky.sunElev
      look.tFov = 2.2
    } else if (s.aim === 'earth') {
      look.tYaw = sky.earthAz
      look.tPitch = sky.earthElev
      look.tFov = Math.max(5, sky.earthRadiusDeg * 4.5)
    }
    // shortest way round for yaw
    const dy = ((((look.tYaw - look.yaw) % 360) + 540) % 360) - 180
    const k = 1 - Math.exp(-dt * 6)
    look.yaw += dy * k
    look.pitch += (look.tPitch - look.pitch) * k
    look.fov = Math.exp(Math.log(look.fov) + (Math.log(look.tFov) - Math.log(look.fov)) * k)

    persp.position.set(0, EYE_KM, 0)
    persp.up.set(0, 1, 0)
    const dir = lookDir(look.yaw, look.pitch, tmp.v)
    persp.lookAt(tmp.w.copy(persp.position).add(dir))
    persp.fov = look.fov
    persp.near = 0.0008
    persp.far = 2.2e5
    persp.updateProjectionMatrix()
    u.uEye.value.copy(persp.position)

    // Sun and Earth at true angular size, far beyond the terrain
    const sunL = tmp.v.copy(frame.sunDir).applyMatrix3(basis.sceneToLocal)
    sunMat.uniforms.uGlow.value = THREE.MathUtils.smoothstep(look.fov, 3, 25)
    if (sun.current) {
      sun.current.position.copy(sunL).multiplyScalar(SKY_DIST)
      sun.current.quaternion.copy(persp.quaternion)
      sun.current.scale.setScalar(sunQuadSize(SKY_DIST))
    }
    if (earth.current) {
      const r = 1737.4 + site.heightKm
      const eM = tmp.w
        .copy(frame.earthDir)
        .multiplyScalar(frame.earthDistKm)
        .addScaledVector(new THREE.Vector3(...basis.f.up), -r)
      const eDist = eM.length()
      const eL = eM.normalize().applyMatrix3(basis.sceneToLocal)
      earth.current.position.copy(eL).multiplyScalar(SKY_DIST)
      earth.current.scale.setScalar(SKY_DIST * Math.tan(Math.asin(6371 / eDist)))
      const ax = earthAxes(frame.timeMs, frame.icrfToScene)
      const eu = earthMat.uniforms
      eu.uSunDir.value.copy(frame.sunDir).applyMatrix3(basis.sceneToLocal)
      eu.uAxisX.value.copy(ax.x).applyMatrix3(basis.sceneToLocal)
      eu.uAxisY.value.copy(ax.y).applyMatrix3(basis.sceneToLocal)
      eu.uAxisZ.value.copy(ax.z).applyMatrix3(basis.sceneToLocal)
    }
  })

  if (!basis) return null
  return (
    <>
      <SimSky stars={assets.moon.stars} radius={1.5e5} intensity={0.6} localToScene={basis.localToScene} />
      <mesh ref={sun} material={sunMat} renderOrder={-5} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={earth} material={earthMat} frustumCulled={false}>
        <sphereGeometry args={[1, 96, 48]} />
      </mesh>
      <mesh geometry={geometry} material={material} frustumCulled={false} />
      <mesh ref={rocks} geometry={rockGeo} material={rockMat} frustumCulled={false} />
    </>
  )
}
