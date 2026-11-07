import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useSim, type View } from '../state/store'

interface Pose {
  target: THREE.Vector3
  up: THREE.Vector3
  azimuth: number
  elevation: number
  distance: number
  minEl: number
  maxEl: number
  minDist: number
  maxDist: number
}

function poseFor(view: View): Pose {
  if (view === 'pole') {
    return {
      target: new THREE.Vector3(0, -1.0005, 0),
      up: new THREE.Vector3(0, -1, 0),
      azimuth: Math.PI / 2,
      elevation: THREE.MathUtils.degToRad(48),
      distance: 0.3,
      minEl: THREE.MathUtils.degToRad(10),
      maxEl: THREE.MathUtils.degToRad(89),
      minDist: 0.012,
      maxDist: 1.6,
    }
  }
  return {
    target: new THREE.Vector3(0, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    azimuth: -Math.PI / 2,
    elevation: THREE.MathUtils.degToRad(-52),
    distance: 3.3,
    minEl: THREE.MathUtils.degToRad(-89),
    maxEl: THREE.MathUtils.degToRad(89),
    minDist: 1.08,
    maxDist: 14,
  }
}

function basis(up: THREE.Vector3) {
  const a = Math.abs(up.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)
  const e1 = new THREE.Vector3().crossVectors(up, a).normalize()
  const e2 = new THREE.Vector3().crossVectors(up, e1).normalize()
  return { e1, e2 }
}

function positionOf(p: Pose, out = new THREE.Vector3()) {
  const { e1, e2 } = basis(p.up)
  const ce = Math.cos(p.elevation)
  return out
    .copy(p.target)
    .addScaledVector(e1, ce * Math.cos(p.azimuth) * p.distance)
    .addScaledVector(e2, ce * Math.sin(p.azimuth) * p.distance)
    .addScaledVector(p.up, Math.sin(p.elevation) * p.distance)
}

export interface MapCameraApi {
  isDragging: () => boolean
}

/** Orbit camera with a configurable up-axis, damping, and animated view changes. */
export default function MapCamera({ api }: { api?: React.MutableRefObject<MapCameraApi | null> }) {
  const { camera, gl } = useThree()
  const view = useSim((s) => s.view)
  const pose = useRef<Pose>(poseFor(view === 'stand' ? 'globe' : view))
  const vel = useRef({ az: 0, el: 0, zoom: 0, panX: 0, panY: 0 })
  const tween = useRef<{ from: { pos: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 }; to: Pose; t: number } | null>(null)
  const drag = useRef<{ x: number; y: number; button: number; moved: number } | null>(null)
  const persp = camera as THREE.PerspectiveCamera

  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), up: new THREE.Vector3(), target: new THREE.Vector3() }), [])

  // animate to the new pose when the view changes
  useEffect(() => {
    if (view === 'stand') return
    const to = poseFor(view)
    tween.current = {
      from: { pos: persp.position.clone(), target: pose.current.target.clone(), up: persp.up.clone() },
      to,
      t: 0,
    }
  }, [view, persp])

  useEffect(() => {
    if (api) api.current = { isDragging: () => !!drag.current && drag.current.moved > 4 }
    const el = gl.domElement
    const down = (e: PointerEvent) => {
      if (useSim.getState().view === 'stand') return
      drag.current = { x: e.clientX, y: e.clientY, button: e.button, moved: 0 }
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      d.x = e.clientX
      d.y = e.clientY
      d.moved += Math.abs(dx) + Math.abs(dy)
      const p = pose.current
      const pan = d.button === 2 || e.shiftKey
      if (pan && useSim.getState().view === 'pole') {
        vel.current.panX += -dx * p.distance * 0.0009
        vel.current.panY += dy * p.distance * 0.0009
      } else {
        // radians per pixel of drag (total, eased in over a few frames)
        const k = useSim.getState().view === 'pole' ? 0.003 : 0.003 * Math.min(1, (p.distance - 1) * 0.9 + 0.08)
        vel.current.az += -dx * k
        vel.current.el += dy * k
      }
    }
    const up = (e: PointerEvent) => {
      el.releasePointerCapture?.(e.pointerId)
      setTimeout(() => (drag.current = null), 0)
    }
    const wheel = (e: WheelEvent) => {
      if (useSim.getState().view === 'stand') return
      e.preventDefault()
      // ~13% per mouse-wheel notch; trackpads send many small deltas and scale with them
      vel.current.zoom += Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0012
    }
    const menu = (e: Event) => e.preventDefault()
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('contextmenu', menu)
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('contextmenu', menu)
    }
  }, [gl, api])

  useFrame((_, dt) => {
    if (useSim.getState().view === 'stand') return
    const p = pose.current
    const tw = tween.current
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / 1.6)
      const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2
      const endPos = positionOf(tw.to, tmp.pos)
      tmp.target.lerpVectors(tw.from.target, tw.to.target, e)
      // travel along an arc so the camera never cuts through the Moon
      const a = tw.from.pos.clone().lerp(endPos, e)
      const minR = 1.05 + Math.sin(Math.PI * e) * 0.6
      if (a.length() < minR) a.setLength(minR)
      persp.position.copy(a)
      tmp.up.copy(tw.from.up).lerp(tw.to.up, e).normalize()
      persp.up.copy(tmp.up)
      persp.lookAt(tmp.target)
      if (tw.t >= 1) {
        pose.current = tw.to
        tween.current = null
      }
    } else {
      // pending motion is eased in: each frame applies a fraction (1 - damp) of what
      // is left, so a drag or wheel notch moves the view by exactly its amount
      const v = vel.current
      const damp = Math.exp(-dt * 12)
      const f = 1 - damp
      p.azimuth += v.az * f
      p.elevation = THREE.MathUtils.clamp(p.elevation + v.el * f, p.minEl, p.maxEl)
      p.distance = THREE.MathUtils.clamp(
        p.target.length() < 0.5 ? 1 + (p.distance - 1) * Math.exp(v.zoom * f) : p.distance * Math.exp(v.zoom * f),
        p.minDist,
        p.maxDist,
      )
      if (v.panX || v.panY) {
        const { e1, e2 } = basis(p.up)
        const fwd = new THREE.Vector3().copy(p.target).sub(persp.position).projectOnPlane(p.up).normalize()
        const right = new THREE.Vector3().crossVectors(fwd, p.up).normalize()
        p.target.addScaledVector(right, v.panX * f).addScaledVector(fwd, v.panY * f)
        // keep the target on the pole region surface
        const off = p.target.clone().projectOnPlane(p.up)
        if (off.length() > 0.17) off.setLength(0.17)
        p.target.copy(off).addScaledVector(p.up, 1.0005)
        void e1
        void e2
      }
      v.az *= damp
      v.el *= damp
      v.zoom *= damp
      v.panX *= damp
      v.panY *= damp
      positionOf(p, persp.position)
      persp.up.copy(p.up)
      persp.lookAt(p.target)
    }
    const alt = Math.max(persp.position.length() - 1, 0.001)
    persp.near = THREE.MathUtils.clamp(alt * 0.2, 0.0004, 0.5)
    persp.far = 6000
    persp.updateProjectionMatrix()
  })

  return null
}
