import { DataUtils } from 'three'
import type { CpuGrid, SimAssets, SiteTerrain } from '../data/types'

/**
 * CPU mirror of the GPU terrain pyramid. Same levels, same blending, used for
 * label placement, hover picking and per-site horizon profiles.
 *
 * Frames: scene +Y = lunar north, +Z = 0°N 0°E (toward Earth), +X = 0°N 90°E.
 */

export type V3 = [number, number, number]

export const R_KM = 1737.4
const DEG = Math.PI / 180

const HALF = new Float32Array(65536)
for (let i = 0; i < 65536; i++) HALF[i] = DataUtils.fromHalfFloat(i)

function bilinear(g: CpuGrid, px: number, py: number, wrapX = false) {
  const { w, h, data } = g
  let x0 = Math.floor(px)
  const y0f = Math.floor(py)
  const fx = px - x0
  const fy = py - y0f
  const y0 = Math.min(Math.max(y0f, 0), h - 1)
  const y1 = Math.min(Math.max(y0f + 1, 0), h - 1)
  let x1: number
  if (wrapX) {
    x0 = ((x0 % w) + w) % w
    x1 = (x0 + 1) % w
  } else {
    x1 = Math.min(Math.max(x0 + 1, 0), w - 1)
    x0 = Math.min(Math.max(x0, 0), w - 1)
  }
  const a = HALF[data[y0 * w + x0]] * (1 - fx) + HALF[data[y0 * w + x1]] * fx
  const b = HALF[data[y1 * w + x0]] * (1 - fx) + HALF[data[y1 * w + x1]] * fx
  return a * (1 - fy) + b * fy
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function edgeWeight(u: number, v: number) {
  const e = Math.min(u, 1 - u, v, 1 - v)
  return e <= 0 ? 0 : smoothstep(0, 0.06, e)
}

export function dirFromLatLon(latDeg: number, lonDeg: number): V3 {
  const la = latDeg * DEG
  const lo = lonDeg * DEG
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)]
}

export function latLonFromDir(p: V3): [number, number] {
  const n = Math.hypot(p[0], p[1], p[2])
  return [Math.asin(Math.max(-1, Math.min(1, p[1] / n))) / DEG, Math.atan2(p[0], p[2]) / DEG]
}

export interface Frame {
  up: V3
  east: V3
  north: V3
}

/** Local east/north/up at a surface point. At the pole, "north" points toward 0°E. */
export function siteFrame(latDeg: number, lonDeg: number): Frame {
  const la = latDeg * DEG
  const lo = lonDeg * DEG
  return {
    up: [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)],
    east: [Math.cos(lo), 0, -Math.sin(lo)],
    north: [-Math.sin(la) * Math.sin(lo), Math.cos(la), -Math.sin(la) * Math.cos(lo)],
  }
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export class CpuTerrain {
  private assets: SimAssets
  site: SiteTerrain | null = null
  private siteFrame: Frame | null = null
  private globalGrid: CpuGrid
  private nearSide: { grid: CpuGrid; info: { x: number; y: number; z: number }; texelKm: number }[]

  constructor(assets: SimAssets) {
    this.assets = assets
    const mip0 = (t: { mipmaps: unknown }) => (t.mipmaps as { data: Uint16Array }[])[0].data
    const g = assets.moon.global
    this.globalGrid = { data: mip0(g.texture), w: g.width, h: g.height }
    // coarse -> fine
    this.nearSide = [...assets.moon.patches].reverse().map((l) => ({
      grid: { data: mip0(l.texture), w: l.width, h: l.height },
      info: l.info,
      texelKm: l.texelKm,
    }))
  }

  setSite(site: SiteTerrain | null) {
    this.site = site
    this.siteFrame = site ? siteFrame(site.site.lat, site.site.lon) : null
  }

  /** Height (km above the 1737.4 km sphere) at a unit direction. lodKm suppresses finer levels. */
  heightAt(p: V3, lodKm = 0): number {
    const { poleFine, poleWide } = this.assets
    const lat = Math.asin(Math.max(-1, Math.min(1, p[1])))
    const lon = Math.atan2(p[0], p[2])

    const gg = this.globalGrid
    let h = bilinear(gg, (lon / (2 * Math.PI)) * gg.w - 0.5, (0.5 - lat / Math.PI) * gg.h - 0.5, true)

    // near-side pyramid (coarse -> fine)
    let coarser = this.assets.moon.global.texelKm
    for (const level of this.nearSide) {
      const info = level.info
      const u = (lon - info.y) / (2 * info.z) + 0.5
      const v = (info.x - lat) / (2 * info.z) + 0.5
      const w = edgeWeight(u, v) * (1 - smoothstep(0.5 * coarser, coarser, lodKm))
      if (w <= 0) break
      h += (bilinear(level.grid, u * level.grid.w - 0.5, v * level.grid.h - 0.5) - h) * w
      coarser = level.texelKm
    }

    // south polar pyramid
    if (p[1] < -0.85) {
      const d = 1 - p[1]
      const X = (2 * R_KM * p[0]) / d
      const Y = (2 * R_KM * p[2]) / d
      let c = this.assets.moon.global.texelKm
      for (const level of [poleWide, poleFine]) {
        const u = X / (2 * level.halfExtentKm) + 0.5
        const v = Y / (2 * level.halfExtentKm) + 0.5
        const w = edgeWeight(u, v) * (1 - smoothstep(0.5 * c, c, lodKm))
        if (w <= 0) break
        h += (bilinear(level.cpu, u * level.cpu.w - 0.5, v * level.cpu.h - 0.5) - h) * w
        c = level.cellKm
      }
    }

    // site patches (local tangent planes)
    if (this.site && this.siteFrame) {
      const f = this.siteFrame
      const cu = dot(p, f.up)
      if (cu > 0.9) {
        const x = (R_KM * dot(p, f.east)) / cu
        const y = (R_KM * dot(p, f.north)) / cu
        let c = 0.4
        for (const patch of [this.site.mid, this.site.near]) {
          const u = x / (2 * patch.halfExtentKm) + 0.5
          const v = 0.5 - y / (2 * patch.halfExtentKm)
          const w = edgeWeight(u, v) * (1 - smoothstep(0.5 * c, c, lodKm))
          if (w <= 0) break
          h += (bilinear(patch.cpu, u * patch.cpu.w - 0.5, v * patch.cpu.h - 0.5) - h) * w
          c = patch.cellKm
        }
      }
    }
    return h
  }

  heightAtLatLon(latDeg: number, lonDeg: number, lodKm = 0) {
    return this.heightAt(dirFromLatLon(latDeg, lonDeg), lodKm)
  }

  /** Fraction of the solar (or any) disc visible from a surface point, by ray-marching the terrain. */
  discVisibility(p: V3, dir: V3, discRadiusDeg: number, eyeKm = 0.002): number {
    const R = R_KM
    const h0 = this.heightAt(p) + eyeKm
    const o: V3 = [p[0] * (R + h0), p[1] * (R + h0), p[2] * (R + h0)]
    const sinE = dot(p, dir)
    const rr = discRadiusDeg * DEG
    if (sinE < -0.12) return 0
    const relief = 11
    const sMax = Math.min(700, Math.max(1, R * (-sinE + Math.sqrt(sinE * sinE + (2 * relief) / R))))
    let s = 0.03
    const steps = 160
    const k = Math.pow(sMax / s, 1 / steps)
    let vis = 1
    for (let i = 0; i < steps; i++) {
      const x: V3 = [o[0] + dir[0] * s, o[1] + dir[1] * s, o[2] + dir[2] * s]
      const r = Math.hypot(x[0], x[1], x[2])
      const q: V3 = [x[0] / r, x[1] / r, x[2] / r]
      const ht = this.heightAt(q, s * 0.004)
      const clear = (r - R - ht) / s
      vis = Math.min(vis, smoothstep(-rr, rr, clear))
      if (vis <= 0) return 0
      s *= k
    }
    return vis
  }

  /**
   * Terrain horizon elevation (degrees) around a site for `n` azimuths, clockwise
   * from north. Includes Moon curvature; observer at eyeKm above the ground.
   */
  horizonProfile(latDeg: number, lonDeg: number, n = 720, eyeKm = 0.002): Float32Array {
    const f = siteFrame(latDeg, lonDeg)
    const R = R_KM
    const h0 = this.heightAt(f.up) + eyeKm
    const out = new Float32Array(n)
    const steps = 340
    const s0 = 0.02
    const sMax = 650
    const k = Math.pow(sMax / s0, 1 / steps)
    for (let i = 0; i < n; i++) {
      const th = (i / n) * 2 * Math.PI
      const ce = Math.sin(th)
      const cn = Math.cos(th)
      const dirT: V3 = [f.east[0] * ce + f.north[0] * cn, f.east[1] * ce + f.north[1] * cn, f.east[2] * ce + f.north[2] * cn]
      let best = -90
      let s = s0
      for (let j = 0; j < steps; j++) {
        const a = s / R
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        const q: V3 = [f.up[0] * ca + dirT[0] * sa, f.up[1] * ca + dirT[1] * sa, f.up[2] * ca + dirT[2] * sa]
        const h = this.heightAt(q, s * 0.003)
        const sh = Math.sin(a / 2)
        const vert = -(R + h) * 2 * sh * sh + (h - h0)
        const horiz = (R + h) * sa
        const e = Math.atan2(vert, horiz) / DEG
        if (e > best) best = e
        s *= k
      }
      out[i] = best
    }
    return out
  }
}

/** Horizon elevation at an azimuth (deg, clockwise from north), linearly interpolated. */
export function horizonAt(profile: Float32Array, azDeg: number) {
  const n = profile.length
  const x = ((((azDeg % 360) + 360) % 360) / 360) * n
  const i0 = Math.floor(x) % n
  const i1 = (i0 + 1) % n
  const f = x - Math.floor(x)
  return profile[i0] * (1 - f) + profile[i1] * f
}
