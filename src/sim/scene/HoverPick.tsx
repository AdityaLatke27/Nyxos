import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { CpuTerrain, V3 } from '../terrain/cpuTerrain'
import { latLonFromDir, R_KM } from '../terrain/cpuTerrain'
import { frame, fmtLat, fmtLon } from '../state/frame'
import { useSim } from '../state/store'

export interface HoverInfo {
  x: number
  y: number
  text: string
}

const ray = new THREE.Raycaster()
const ndc = new THREE.Vector2()

/** Iterative ray / displaced-Moon intersection (heights exaggerated like the view). */
function hitMoon(o: THREE.Vector3, d: THREE.Vector3, terrain: CpuTerrain, scale: number): V3 | null {
  let r = 1
  let p: V3 | null = null
  for (let i = 0; i < 7; i++) {
    const b = o.dot(d)
    const c = o.lengthSq() - r * r
    const disc = b * b - c
    if (disc < 0) return p
    const t = -b - Math.sqrt(disc)
    if (t < 0) return null
    const x = o.clone().addScaledVector(d, t)
    const n = x.length()
    p = [x.x / n, x.y / n, x.z / n]
    r = 1 + (terrain.heightAt(p) * scale) / R_KM
  }
  return p
}

export default function HoverPick({ terrain, onHover }: { terrain: CpuTerrain; onHover: (h: HoverInfo | null) => void }) {
  const { camera, gl } = useThree()

  useEffect(() => {
    const el = gl.domElement
    let last = 0
    let down: { x: number; y: number } | null = null

    const probe = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      return hitMoon(ray.ray.origin, ray.ray.direction, terrain, useSim.getState().heightScale)
    }

    const move = (e: PointerEvent) => {
      if (useSim.getState().view === 'stand') return onHover(null)
      if (e.buttons) return onHover(null)
      const now = performance.now()
      if (now - last < 50) return
      last = now
      const p = probe(e)
      if (!p) return onHover(null)
      const [lat, lon] = latLonFromDir(p)
      const hM = Math.round(terrain.heightAt(p) * 1000)
      const sun = terrain.discVisibility(p, [frame.sunDir.x, frame.sunDir.y, frame.sunDir.z], 0.2666)
      const lit = sun >= 0.99 ? 'in sunlight' : sun <= 0.01 ? 'in shadow' : `${Math.round(sun * 100)}% sunlit`
      const rect = el.getBoundingClientRect()
      onHover({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        text: `${fmtLat(lat)} ${fmtLon(lon)} · ${hM} m · ${lit} · click to pick`,
      })
    }
    const pdown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY })
    const pup = (e: PointerEvent) => {
      if (!down || useSim.getState().view === 'stand') return
      const moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y)
      down = null
      if (moved > 5 || e.button !== 0) return
      const p = probe(e)
      if (!p) return
      const [lat, lon] = latLonFromDir(p)
      useSim.getState().pick({ lat, lon })
    }
    const leave = () => onHover(null)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerdown', pdown)
    el.addEventListener('pointerup', pup)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerdown', pdown)
      el.removeEventListener('pointerup', pup)
      el.removeEventListener('pointerleave', leave)
    }
  }, [camera, gl, terrain, onHover])

  return null
}
