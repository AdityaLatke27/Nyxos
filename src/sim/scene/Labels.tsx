import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Feature, SiteInfo } from '../data/types'
import type { CpuTerrain } from '../terrain/cpuTerrain'
import { dirFromLatLon, R_KM } from '../terrain/cpuTerrain'
import { useSim } from '../state/store'
import { haloText } from './labelText'
import { drawGraphOverlay } from './graphOverlay'

interface Props {
  overlay: React.RefObject<HTMLCanvasElement | null>
  features: Feature[]
  sites: SiteInfo[]
  terrain: CpuTerrain
  current: { name: string; lat: number; lon: number } | null
}

interface Packed {
  dir: Float32Array
  h: Float32Array
}

const v = new THREE.Vector3()
const w = new THREE.Vector3()

/** Keeps the 2D label canvas matched to the WebGL canvas size (used by every view). */
export function OverlaySizer({ overlay }: { overlay: React.RefObject<HTMLCanvasElement | null> }) {
  const { size } = useThree()
  useEffect(() => {
    const c = overlay.current
    if (!c) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = size.width * dpr
    c.height = size.height * dpr
    c.style.width = `${size.width}px`
    c.style.height = `${size.height}px`
    c.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [overlay, size])
  return null
}

/** Map-view labels: IAU features (size-based LOD), site pins, polar grid. */
export default function Labels({ overlay, features, sites, terrain, current }: Props) {
  const { camera, size } = useThree()

  const packed = useMemo<Packed>(() => {
    const dir = new Float32Array(features.length * 3)
    const h = new Float32Array(features.length)
    features.forEach((f, i) => {
      const d = dirFromLatLon(f[1], f[2])
      dir.set(d, i * 3)
      h[i] = terrain.heightAt(d, Math.max(0.5, f[3] * 0.1))
    })
    return { dir, h }
  }, [features, terrain])

  const sitePts = useMemo(
    () => sites.map((s) => ({ s, d: dirFromLatLon(s.lat, s.lon), h: terrain.heightAt(dirFromLatLon(s.lat, s.lon)) })),
    [sites, terrain],
  )

  useFrame(() => {
    const c = overlay.current
    if (!c) return
    const s = useSim.getState()
    if (s.view === 'stand') return
    const g = c.getContext('2d')!
    const W = size.width
    const H = size.height
    g.clearRect(0, 0, W, H)
    const persp = camera as THREE.PerspectiveCamera
    const scale = s.heightScale
    const cam = persp.position
    const focal = H / 2 / Math.tan(THREE.MathUtils.degToRad(persp.fov / 2))

    const toScreen = (d: ArrayLike<number>, hKm: number, out: { x: number; y: number; dist: number; facing: number }) => {
      const r = 1 + (hKm * scale) / R_KM
      v.set(d[0] * r, d[1] * r, d[2] * r)
      w.copy(cam).sub(v)
      out.dist = w.length()
      out.facing = (d[0] * w.x + d[1] * w.y + d[2] * w.z) / out.dist
      v.project(persp)
      out.x = (v.x * 0.5 + 0.5) * W
      out.y = (-v.y * 0.5 + 0.5) * H
      return v.z < 1
    }

    const pt = { x: 0, y: 0, dist: 0, facing: 0 }
    const taken: number[] = []
    const free = (x: number, y: number, bw: number, bh: number) => {
      for (let i = 0; i < taken.length; i += 4) {
        if (x < taken[i] + taken[i + 2] && x + bw > taken[i] && y < taken[i + 1] + taken[i + 3] && y + bh > taken[i + 1])
          return false
      }
      taken.push(x, y, bw, bh)
      return true
    }

    // ---- site pins (drawn first so they win collisions)
    g.textBaseline = 'middle'
    const pins: { x: number; y: number; name: string; sel: boolean }[] = []
    const all = [...sitePts]
    if (s.siteId === 'picked' && current) {
      const d = dirFromLatLon(current.lat, current.lon)
      all.push({ s: { id: 'picked', name: 'Picked point', lat: current.lat, lon: current.lon, group: '' }, d, h: terrain.heightAt(d) })
    }
    for (const p of all) {
      if (!toScreen(p.d, p.h, pt) || pt.facing < 0.02) continue
      if (pt.x < -50 || pt.x > W + 50 || pt.y < -50 || pt.y > H + 50) continue
      // In the globe view only show pins that are reasonably large on screen.
      if (s.view === 'globe' && pt.dist > 2.6 && p.s.id !== s.siteId) continue
      pins.push({ x: pt.x, y: pt.y, name: p.s.name, sel: p.s.id === s.siteId })
    }
    for (const p of pins) {
      g.strokeStyle = p.sel ? 'rgba(255,190,90,0.95)' : 'rgba(235,240,250,0.8)'
      g.lineWidth = 1.2
      g.beginPath()
      g.moveTo(p.x, p.y)
      g.lineTo(p.x, p.y - 16)
      g.stroke()
      g.fillStyle = p.sel ? '#ffb347' : '#f2f5fb'
      g.beginPath()
      g.arc(p.x, p.y - 18, p.sel ? 5 : 3.6, 0, Math.PI * 2)
      g.fill()
      g.font = `${p.sel ? 600 : 500} ${p.sel ? 12.5 : 11}px "Space Grotesk", sans-serif`
      const tw = g.measureText(p.name).width
      if (!p.sel && !free(p.x + 6, p.y - 26, tw + 4, 16)) continue
      if (p.sel) free(p.x + 6, p.y - 26, tw + 4, 16)
      haloText(g, p.name, p.x + 8, p.y - 18, p.sel ? '#ffc773' : 'rgba(240,244,252,0.95)')
    }

    // ---- polar grid (80° ring + four meridians) around the south pole
    if (s.view === 'globe' || s.view === 'pole') {
      g.font = '500 10.5px "Space Grotesk", sans-serif'
      g.fillStyle = 'rgba(170,200,240,0.7)'
      g.strokeStyle = 'rgba(150,185,235,0.22)'
      g.setLineDash([3, 5])
      for (const lat of [-80, -85]) {
        g.beginPath()
        let started = false
        for (let lon = -180; lon <= 180; lon += 3) {
          const d = dirFromLatLon(lat, lon)
          if (toScreen(d, terrain.heightAt(d, 2), pt) && pt.facing > 0) {
            if (!started) g.moveTo(pt.x, pt.y)
            else g.lineTo(pt.x, pt.y)
            started = true
          } else started = false
        }
        g.stroke()
      }
      g.setLineDash([])
      const marks: [number, string][] = [
        [0, '0° · toward Earth'],
        [90, '90°E'],
        [180, '180°'],
        [-90, '90°W'],
      ]
      for (const [lon, label] of marks) {
        const d = dirFromLatLon(-80, lon)
        if (toScreen(d, terrain.heightAt(d, 2), pt) && pt.facing > 0.02) g.fillText(label, pt.x + 4, pt.y)
      }
      const d80 = dirFromLatLon(-80, 45)
      if (toScreen(d80, terrain.heightAt(d80, 2), pt) && pt.facing > 0.02) g.fillText('80°S', pt.x + 4, pt.y)
    }

    drawGraphOverlay(g, toScreen, pt, terrain)

    // ---- IAU features, largest first, until the screen is busy
    if (!s.showCraters) return
    const n = features.length
    let shown = 0
    for (let i = 0; i < n && shown < 260; i++) {
      const f = features[i]
      const kind = f[4]
      const diam = Math.max(f[3], kind === 'mare' ? 300 : 0)
      const d = packed.dir.subarray(i * 3, i * 3 + 3)
      if (!toScreen(d, packed.h[i], pt) || pt.facing < 0.08) continue
      if (pt.x < 0 || pt.x > W || pt.y < 0 || pt.y > H) continue
      const px = ((diam / R_KM) * focal) / pt.dist
      const min = kind === 'satellite' ? 70 : kind === 'crater' ? 30 : kind === 'vallis' ? 60 : 20
      if (px < min) continue
      const fontPx = Math.min(15, 9.5 + Math.log2(px / min) * 1.6)
      g.font = `${kind === 'mare' || kind === 'mons' ? 500 : 400} italic ${fontPx.toFixed(1)}px "Space Grotesk", sans-serif`
      const name = kind === 'mare' ? f[0].toUpperCase() : f[0]
      const tw = g.measureText(name).width
      const x = pt.x - tw / 2
      if (!free(x - 2, pt.y - fontPx / 2 - 1, tw + 4, fontPx + 2)) continue
      haloText(g, name, x, pt.y, kind === 'mare' ? 'rgba(195,215,245,0.85)' : 'rgba(232,238,248,0.92)')
      shown++
    }
  }, 2)

  return null
}
